#!/bin/bash
# Builds the enhanced version as a normal Mac app: "FreeShow Church.app"
source "$(dirname "$0")/lib.sh"
exec > >(tee "$LOG_DIR/build.log") 2>&1
use_node || die "Node not found — run '1 - Setup.command' first"
[ -d node_modules ] || die "Dependencies missing — run '1 - Setup.command' first"

ARCH="$(uname -m)"; [ "$ARCH" = "x86_64" ] && ARCH="x64"
# Put the source back in dev mode afterwards (the production build rewrites public/index.html).
trap 'node scripts/cleanBuilds.js >/dev/null 2>&1' EXIT

say "Building FreeShow from source ($ARCH) — takes a few minutes"
npm run build || die "Build failed — see church/logs/build.log"

say "Packaging the Mac app"
rm -rf dist
npx electron-builder --config church/electron-builder.church.js --mac dir --"$ARCH" --publish never \
  || die "Packaging failed — see church/logs/build.log"

SRC_APP="$(ls -d dist/mac*/FreeShow.app 2>/dev/null | head -1)"
[ -d "$SRC_APP" ] || die "Could not find the packaged app in dist/"

node scripts/cleanBuilds.js >/dev/null 2>&1   # restore dev-mode source files

# Ad-hoc sign so macOS (Apple Silicon) will run it.
codesign --force --deep --sign - "$SRC_APP" || warn "codesign reported a problem"

DEST="$(app_dest_dir)/$APP_NAME.app"
say "Installing to $DEST"
osascript -e "tell application \"$APP_NAME\" to quit" >/dev/null 2>&1 || true
sleep 1
rm -rf "$DEST"
ditto "$SRC_APP" "$DEST" || die "Could not copy app to $DEST"
VERSION="$(node -p 'require("./package.json").version')"
COMMIT="$("${GIT:-git}" rev-parse --short HEAD 2>/dev/null || echo '?')"
echo "$VERSION ($COMMIT) built $(date)" > "$CHURCH_DIR/logs/last-build.txt"
ok "Installed $APP_NAME $VERSION ($COMMIT)"
echo "Tip: drag '$APP_NAME' to your Dock. Don't run it at the same time as the official FreeShow."
open -R "$DEST"
pause_exit 0
