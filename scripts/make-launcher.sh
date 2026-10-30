#!/bin/bash
# Build "Photobook Studio.app": a double-clickable launcher for this project.
#
#   npm run launcher                 build into dist/ and install into ~/Applications
#   scripts/make-launcher.sh --no-install
#   scripts/make-launcher.sh --port 5394 --data /tmp/x --name "Photobook Test" --no-install   (testing)
#
# The app points at this folder; if you move the project, run it again.
set -euo pipefail

PROJECT="$(cd "$(dirname "$0")/.." && pwd)"
NAME="Photobook Studio"
PORT=""
DATA=""
INSTALL=1
OPEN=true
while [ $# -gt 0 ]; do
  case "$1" in
    --port) PORT="$2"; shift 2 ;;
    --data) DATA="$2"; shift 2 ;;
    --name) NAME="$2"; shift 2 ;;
    --no-install) INSTALL=0; shift ;;
    --no-browser) OPEN=false; shift ;;   # tests only
    *) echo "unknown option $1" >&2; exit 2 ;;
  esac
done

case "$PROJECT" in *\"*|*\\*) echo "The project path can't contain quotes or backslashes: $PROJECT" >&2; exit 1 ;; esac

ENV_PREFIX=""
[ -n "$PORT" ] && ENV_PREFIX+="PHOTOBOOK_PORT=$PORT "
[ -n "$DATA" ] && ENV_PREFIX+="PHOTOBOOK_DATA_DIR='$DATA' "

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
APP="$PROJECT/dist/$NAME.app"
mkdir -p "$PROJECT/dist"
rm -rf "$APP"

sed -e "s|__PROJECT__|$PROJECT|" -e "s|__ENV__|$ENV_PREFIX|" -e "s|__OPEN__|$OPEN|" "$PROJECT/scripts/launcher/app.applescript" > "$WORK/app.applescript"
# -s: stay-open applet, so it can stop the server when you quit it.
osacompile -s -o "$APP" "$WORK/app.applescript"

# Icon
"$PROJECT/node_modules/.bin/tsx" "$PROJECT/scripts/launcher/make-icon.ts" "$WORK/icon.png"
ICONSET="$WORK/icon.iconset"
mkdir -p "$ICONSET"
for s in 16 32 128 256 512; do
  sips -z $s $s "$WORK/icon.png" --out "$ICONSET/icon_${s}x${s}.png" >/dev/null
  sips -z $((s * 2)) $((s * 2)) "$WORK/icon.png" --out "$ICONSET/icon_${s}x${s}@2x.png" >/dev/null
done
iconutil -c icns "$ICONSET" -o "$APP/Contents/Resources/applet.icns"
# osacompile also ships a default icon in an asset catalog, which would win over applet.icns.
rm -f "$APP/Contents/Resources/Assets.car"

PLIST="$APP/Contents/Info.plist"
plutil -remove CFBundleIconName "$PLIST" 2>/dev/null || true
plutil -replace CFBundleName -string "$NAME" "$PLIST"
plutil -replace CFBundleIdentifier -string "local.photobook-studio.$(echo "$NAME" | tr -cd '[:alnum:]' | tr '[:upper:]' '[:lower:]')" "$PLIST"
plutil -replace CFBundleShortVersionString -string "$(node -p "require('$PROJECT/package.json').version")" "$PLIST"

# Changing the bundle invalidates osacompile's signature; re-sign ad hoc so macOS runs it.
codesign --force --deep --sign - "$APP" >/dev/null 2>&1
touch "$APP"
echo "Built: $APP"

if [ "$INSTALL" = 1 ]; then
  mkdir -p "$HOME/Applications/$NAME.app"
  # Update the installed app in place rather than deleting and copying it: the Dock keeps track
  # of the app's folder, and a deleted folder drops the app from the Dock.
  rsync -a --delete "$APP/" "$HOME/Applications/$NAME.app/"
  touch "$HOME/Applications/$NAME.app"
  echo "Installed: $HOME/Applications/$NAME.app"
fi
