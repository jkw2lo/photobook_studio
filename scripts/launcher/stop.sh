#!/bin/bash
# Stop the Photobook Studio server started by start.sh (and its child processes).
set -u
PROJECT="$(cd "$(dirname "$0")/../.." && pwd)"
PORT="${PHOTOBOOK_PORT:-5174}"
DATA="${PHOTOBOOK_DATA_DIR:-$PROJECT/data}"
PIDFILE="$DATA/server-$PORT.pid"

kill_tree() {
  local pid=$1
  for child in $(pgrep -P "$pid" 2>/dev/null); do kill_tree "$child"; done
  kill "$pid" 2>/dev/null
}

if [ -f "$PIDFILE" ]; then
  kill_tree "$(cat "$PIDFILE")"
  rm -f "$PIDFILE"
fi
# Anything of ours still listening on the port.
for pid in $(lsof -nP -t -iTCP:"$PORT" -sTCP:LISTEN 2>/dev/null); do
  ps -o command= -p "$pid" | grep -q "src/server/main.ts" && kill "$pid" 2>/dev/null
done
exit 0
