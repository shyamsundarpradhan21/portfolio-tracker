---
description: Review the current branch's diff like a staff engineer before a PR.
---

Review the changes for: $ARGUMENTS (default: `git diff main...HEAD`).

1. Read `tasks/feedback.md` + `CLAUDE.md`.
2. Run the `reviewer` agent on the diff; for anything money-touching, also run `security-auditor`.
3. Confirm `npm test` + `npm run build` pass on the branch.
4. Produce a single verdict: blocking issues first, then nits, then what's good. End with a clear ship / don't-ship call.

Review only — do not edit unless asked.
