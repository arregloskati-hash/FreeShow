#!/bin/bash
# Shared helpers for the FreeShow Church scripts. Sourced by the .command files.
set -o pipefail

CHURCH_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "$CHURCH_DIR/.." && pwd)"
TOOLS_DIR="$HOME/.freeshow-dev"
LOG_DIR="$CHURCH_DIR/logs"
mkdir -p "$LOG_DIR" "$TOOLS_DIR"
cd "$REPO_DIR" || exit 1

APP_NAME="FreeShow Church"
UPSTREAM_URL="https://github.com/ChurchApps/FreeShow.git"
NODE_MAJOR=22

say()  { printf "\n\033[1;36m==> %s\033[0m\n" "$*"; }
ok()   { printf "\033[1;32m✔ %s\033[0m\n" "$*"; }
warn() { printf "\033[1;33m! %s\033[0m\n" "$*"; }
die()  { printf "\n\033[1;31m✘ %s\033[0m\n" "$*"; pause_exit 1; }
pause_exit() {
  echo
  read -r -p "Press Return to close this window..." _ </dev/tty 2>/dev/null || true
  exit "${1:-0}"
}

# ---------- git ----------
find_git() {
  if xcode-select -p >/dev/null 2>&1 && /usr/bin/git --version >/dev/null 2>&1; then
    GIT=/usr/bin/git; return 0
  fi
  for g in /opt/homebrew/bin/git /usr/local/bin/git \
           "/Applications/GitHub Desktop.app/Contents/Resources/app/git/bin/git" \
           "$HOME/Applications/GitHub Desktop.app/Contents/Resources/app/git/bin/git"; do
    if [ -x "$g" ]; then GIT="$g"; return 0; fi
  done
  return 1
}

# ---------- node ----------
node_ok() {
  command -v node >/dev/null 2>&1 || return 1
  local v; v="$(node -p 'process.versions.node' 2>/dev/null)" || return 1
  local major="${v%%.*}" rest="${v#*.}"; local minor="${rest%%.*}"
  [ "$major" -gt 22 ] || { [ "$major" -eq 22 ] && [ "$minor" -ge 12 ]; }
}

use_node() {
  # Prefer our private Node install, then whatever the Mac already has.
  if [ -x "$TOOLS_DIR/node/bin/node" ]; then
    export PATH="$TOOLS_DIR/node/bin:$PATH"
  fi
  for p in /opt/homebrew/bin /usr/local/bin; do
    [ -d "$p" ] && export PATH="$PATH:$p"
  done
  node_ok
}

install_node() {
  local arch; arch="$(uname -m)"; [ "$arch" = "x86_64" ] && arch="x64"
  say "Installing Node.js $NODE_MAJOR (private copy in ~/.freeshow-dev, no admin needed)"
  local base="https://nodejs.org/dist/latest-v${NODE_MAJOR}.x"
  local file; file="$(curl -fsSL "$base/SHASUMS256.txt" | awk '{print $2}' | grep "darwin-${arch}.tar.gz$" | head -1)"
  [ -n "$file" ] || die "Could not find a Node.js download for darwin-$arch"
  curl -fL --progress-bar "$base/$file" -o "$TOOLS_DIR/node.tar.gz" || die "Node.js download failed"
  rm -rf "$TOOLS_DIR/node" && mkdir -p "$TOOLS_DIR/node"
  tar -xzf "$TOOLS_DIR/node.tar.gz" -C "$TOOLS_DIR/node" --strip-components 1 || die "Could not unpack Node.js"
  rm -f "$TOOLS_DIR/node.tar.gz"
  export PATH="$TOOLS_DIR/node/bin:$PATH"
  node_ok || die "Node.js install did not work"
  ok "Node $(node -v) installed"
}

ensure_node() {
  if use_node; then ok "Node $(node -v) / npm $(npm -v)"; else install_node; fi
}

# ---------- app location ----------
app_dest_dir() {
  if [ -w /Applications ]; then echo /Applications; else mkdir -p "$HOME/Applications"; echo "$HOME/Applications"; fi
}
