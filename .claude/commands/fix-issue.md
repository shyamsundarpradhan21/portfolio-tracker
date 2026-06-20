---
description: Reproduce, root-cause, fix, and verify a reported bug end to end.
---

Fix the issue described in: $ARGUMENTS

1. Read `tasks/feedback.md` for standing rules.
2. Reproduce it — run the failing test, build, or curl the route. Don't guess.
3. Root-cause it (delegate to the `debugger` agent if the data pipeline is involved). No band-aids.
4. Apply the minimal fix.
5. Verify: `npm test` + `npm run build` green, and demonstrate the original symptom is gone.
6. Summarize root cause + fix. Do not commit unless asked.
