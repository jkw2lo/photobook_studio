#!/bin/bash
# Start Photobook Studio for the Mac launcher app (or by hand): clear leftover servers, rebuild the
# editor if the code changed, start the server in the background, wait until it answers.
# Prints the editor URL on success; exits non-zero with a message on failure.
#
#   PHOTOBOOK_PORT / PHOTOBOOK_DATA_DIR may be set to run a separate copy (used by tests).
set -u

PROJECT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PHOTOBOOK_PORT:-5174}"
DATA="${PHOTOBOOK_DATA_DIR:-$PROJECT/data}"
mkdir -p "$DATA"
LOG="$DATA/launcher.log"
PIDFILE="$DATA/server-$PORT.pid"
URL="http://127.0.0.1:$PORT"

# Apps opened from Finder get a minimal PATH; find node the way the user's shell would.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
if ! command -v node >/dev/null 2>&1; then
  NODE_DIR="$(/bin/zsh -lic 'dirname "$(command -v node)"' 2>/dev/null | tail -1)"
  [ -n "$NODE_DIR" ] && export PATH="$NODE_DIR:$PATH"
fi
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js was not found. Install it (e.g. from nodejs.org) and try again." >&2
  exit 1
fi
if [ ! -d "$PROJECT/node_modules" ]; then
  echo "Dependencies are missing. In Terminal, run: cd \"$PROJECT\" && npm install" >&2
  exit 1
fi

# Stop any Photobook server already holding the port (an old `npm start`/`npm run dev`, or a
# previous launch). Only processes running this project's server are touched.
"$PROJECT/scripts/launcher/stop.sh" >/dev/null 2>&1
for pid in $(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null); do
  if ps -o command= -p "$pid" | grep -q "src/server/main.ts"; then
    kill "$pid" 2>/dev/null
  else
    echo "Port $PORT is in use by another program ($(basename "$(ps -o comm= -p "$pid")")). Close it and try again." >&2
    exit 1
  fi
done
for _ in $(seq 1 20); do lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1 || break; sleep 0.25; done

cd "$PROJECT" || exit 1
echo "---- $(date) starting on port $PORT" >> "$LOG"

# Rebuild the editor when any source file is newer than the last build.
BUILT="$PROJECT/dist/web/index.html"
if [ ! -f "$BUILT" ] || [ -n "$(find src -newer "$BUILT" -type f -print -quit 2>/dev/null)" ]; then
  echo "building editor" >> "$LOG"
  if ! ./node_modules/.bin/vite build >> "$LOG" 2>&1; then
    echo "The editor failed to build. Details: $LOG" >&2
    exit 1
  fi
fi

NODE_ENV=production PHOTOBOOK_PORT="$PORT" PHOTOBOOK_DATA_DIR="$DATA" \
  nohup ./node_modules/.bin/tsx src/server/main.ts >> "$LOG" 2>&1 < /dev/null &
echo $! > "$PIDFILE"

for _ in $(seq 1 120); do
  if curl -s -m 1 "$URL/api/health" >/dev/null 2>&1; then
    echo "$URL"
    exit 0
  fi
  if ! kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
    echo "The server stopped while starting. Details: $LOG" >&2
    exit 1
  fi
  sleep 0.25
done
echo "The server did not answer within 30 seconds. Details: $LOG" >&2
exit 1
