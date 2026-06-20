#!/usr/bin/env bash
# Pre-commit guard for portfolio-tracker.
# Wire it as a git hook:   ln -sf ../../.claude/hooks/pre-commit.sh .git/hooks/pre-commit
# (or call it from a .claude/settings.json PreToolUse hook — note settings.json is gitignored here).
set -euo pipefail

# 1. Block secrets / private data from ever being staged.
BLOCKED='(\.env($|\.)|\.kv\.env|\.token\.json|portfolio\.private\.json|tax_model.*\.xlsx)'
if git diff --cached --name-only | grep -nE "$BLOCKED"; then
  echo "✗ pre-commit: refusing to commit a secret/private file (see match above)."
  exit 1
fi

# 2. Tests must pass.
npm test --silent || { echo "✗ pre-commit: tests failing."; exit 1; }

echo "✓ pre-commit: clean."
