#!/usr/bin/env bash
# Lint a single file on save. Wire to your editor's on-save action, or a
# Claude Code PostToolUse hook on Edit/Write. Arg: the saved file path.
set -euo pipefail
file="${1:-}"
[ -z "$file" ] && { echo "usage: lint-on-save.sh <file>"; exit 0; }
case "$file" in
  *.js|*.mjs|*.jsx) npx next lint --file "$file" 2>/dev/null || npx eslint "$file" || true ;;
  *) : ;;  # nothing to lint
esac
