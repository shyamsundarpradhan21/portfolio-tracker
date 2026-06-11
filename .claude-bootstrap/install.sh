#!/usr/bin/env bash
# Install GSD (get-shit-done v1.42.3, full mode) into this machine's Claude
# user directory. Bundle captured from a working install via GSD's own file
# manifest. Idempotent — safe to re-run. Restart the Claude session afterwards
# so hooks and the /gsd-* skill set load.
#
#   bash .claude-bootstrap/install.sh
#
# Project-level skills (/council, /design-system, …) live in .claude/skills/
# inside the repo and need no installation.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEST="${CLAUDE_DIR:-$HOME/.claude}"
BUNDLE="$HERE/gsd-bundle"

mkdir -p "$DEST/skills" "$DEST/agents" "$DEST/hooks"

cp -R "$BUNDLE/get-shit-done" "$DEST/"
cp -R "$BUNDLE/skills/." "$DEST/skills/"
cp -R "$BUNDLE/agents/." "$DEST/agents/"
cp -R "$BUNDLE/hooks/." "$DEST/hooks/"

# Updater metadata so /gsd-update knows what's installed
cp "$BUNDLE/gsd-file-manifest.json" "$DEST/"
[ -f "$DEST/gsd-install-state.json" ] || cp "$BUNDLE/gsd-install-state.json" "$DEST/"

python3 "$HERE/merge-settings.py" "$BUNDLE/settings-fragment.json" "$DEST/settings.json"

echo "GSD v$(cat "$DEST/get-shit-done/VERSION") installed to $DEST — restart the session to load skills + hooks."
