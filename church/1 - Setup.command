#!/bin/bash
# One-time setup: installs Node (if needed) and FreeShow's dependencies.
source "$(dirname "$0")/lib.sh"
exec > >(tee "$LOG_DIR/setup.log") 2>&1

say "FreeShow Church — setup"
echo "Source folder: $REPO_DIR"

find_git && ok "git: $GIT" || warn "git not found (updates need it). Install Xcode Command Line Tools: xcode-select --install"
if ! xcode-select -p >/dev/null 2>&1; then
  warn "Xcode Command Line Tools are not installed. Most things work without them, but if npm install fails"
  warn "with a 'gyp' or 'make' error, run:  xcode-select --install   and then run this setup again."
fi

# Safety: back up FreeShow settings + shows before running a dev build that uses the same data.
STAMP="$(date +%Y-%m-%d_%H%M)"
BK="$HOME/Documents/FreeShow-Backups/$STAMP"
if [ -d "$HOME/Library/Application Support/FreeShow" ] || [ -d "$HOME/Documents/FreeShow/Shows" ]; then
  say "Backing up your current FreeShow settings and shows to $BK"
  mkdir -p "$BK"
  [ -d "$HOME/Library/Application Support/FreeShow" ] && \
    rsync -a --exclude 'Cache*' --exclude 'Code Cache' --exclude 'GPUCache' --exclude 'blob_storage' \
      "$HOME/Library/Application Support/FreeShow/" "$BK/AppSupport/" 2>/dev/null
  [ -d "$HOME/Documents/FreeShow/Shows" ] && rsync -a "$HOME/Documents/FreeShow/Shows/" "$BK/Shows/" 2>/dev/null
  ok "Backup done"
fi

ensure_node

say "Installing FreeShow dependencies (first time takes a few minutes)"
npm install --no-audit --no-fund || die "npm install failed — see church/logs/setup.log"
ok "Dependencies installed"

say "Setup complete!"
echo "Next:"
echo "  • '2 - Start Dev.command'   → run FreeShow from source (live reload while we edit)"
echo "  • '3 - Build App.command'   → build the 'FreeShow Church' app into Applications"
echo "  • '4 - Update from FreeShow.command' → pull in new official FreeShow releases"
pause_exit 0
