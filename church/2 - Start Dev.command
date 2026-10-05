#!/bin/bash
# Runs FreeShow from source with live reload. Close this window (or Ctrl+C) to stop.
source "$(dirname "$0")/lib.sh"
use_node || die "Node not found — run '1 - Setup.command' first"
[ -d node_modules ] || die "Dependencies missing — run '1 - Setup.command' first"
say "Starting FreeShow (dev). Quit the normal FreeShow app first so they don't both use the same data."
npm start 2>&1 | tee "$LOG_DIR/dev.log"
pause_exit 0
