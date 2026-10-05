#!/bin/bash
# Pulls the newest official FreeShow release into our church version, keeping our enhancements.
source "$(dirname "$0")/lib.sh"
exec > >(tee "$LOG_DIR/update.log") 2>&1
find_git || die "git not found. Run: xcode-select --install"

# Make sure we have an 'upstream' remote pointing at the official repo.
if ! "$GIT" remote get-url upstream >/dev/null 2>&1; then
  if "$GIT" remote get-url origin | grep -qi "ChurchApps/FreeShow"; then
    UP=origin
  else
    "$GIT" remote add upstream "$UPSTREAM_URL"; UP=upstream
  fi
else
  UP=upstream
fi

if [ -n "$("$GIT" status --porcelain --untracked-files=no)" ]; then
  die "You have uncommitted changes. Commit them in GitHub Desktop first, then run this again."
fi

say "Checking official FreeShow for new releases"
"$GIT" fetch "$UP" --tags --force || die "Could not reach GitHub"

CHANNEL="${1:-stable}"   # pass 'beta' to also take beta releases
if [ "$CHANNEL" = "beta" ]; then
  LATEST="$("$GIT" tag -l 'v*' | sort -V | tail -1)"
else
  LATEST="$("$GIT" tag -l 'v*' | grep -v -- '-' | sort -V | tail -1)"
fi
CURRENT="$(cat "$CHURCH_DIR/BASE_VERSION" 2>/dev/null)"
echo "Our version is based on: ${CURRENT:-unknown}"
echo "Latest official release: $LATEST"

if [ "$LATEST" = "$CURRENT" ]; then
  ok "Already up to date."; pause_exit 0
fi

say "Merging $LATEST into $("$GIT" branch --show-current)"
if ! "$GIT" merge --no-edit -m "Update to official FreeShow $LATEST" "$LATEST"; then
  "$GIT" merge --abort
  die "Our changes conflict with $LATEST. Nothing was changed. Ask Claude to do this update."
fi
echo "$LATEST" > "$CHURCH_DIR/BASE_VERSION"
"$GIT" add "$CHURCH_DIR/BASE_VERSION" && "$GIT" commit -q -m "Base version $LATEST"
ok "Merged $LATEST"

ensure_node
say "Updating dependencies"
npm install --no-audit --no-fund || die "npm install failed"

echo
read -r -p "Rebuild the 'FreeShow Church' app now? [Y/n] " ans </dev/tty
if [ "${ans:-Y}" != "n" ] && [ "${ans:-Y}" != "N" ]; then
  exec "$CHURCH_DIR/3 - Build App.command"
fi
echo "Remember to push in GitHub Desktop so the update is saved to your GitHub."
pause_exit 0
