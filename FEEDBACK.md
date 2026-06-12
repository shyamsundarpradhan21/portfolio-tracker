# Session Feedback — Standing Rules

Captured from live sessions. Read before starting any task.

---

## UI / Data Layer

### No hardcoded subtexts or summaries
Every card label, badge, footer note, or summary that references a number,
date, FY name, or computed quantity **must derive from data or a computed
value** — never a string literal.

- FY names live in `data/fy2526_verified.json → labels.*`. Every component
  reads `FY.labels.verified / .current / .currentShort` etc. When the data
  file rolls to a new FY, the whole UI follows with zero JSX edits.
- Amounts hardcoded in JSX (e.g. `'+₹27,694'`, `'₹5.97L'`, `'₹7.3L'`) are
  bugs — read from the data object instead.
- Dates in prose (e.g. `"unlocks 26-Feb-2027"`, `"seeded 13-Jan-26"`) must
  be computed from the fund's `bought` date + lock period, not typed in.
- Fallback / caveat text that quotes a magic number (e.g. `"12%"`,
  `"~3 months"`, `"~2-year"`, `"~5-month"`) must reference the constant
  the simulation actually uses, or the live computed stat.

### Deep cleanse = exhaustive sweep
"Fix all" means scan every file in `app/` for every variant of the pattern,
not just the ones flagged. When one instance of a hardcoded string is found,
grep the codebase before reporting done.

---

## Git Workflow

### "push" = push to main
When the user says **push**, merge the feature branch into main (fast-forward
if clean) and push to `origin/main`. Do not stop at the feature branch and
ask for confirmation unless there is a merge conflict.

### Feature branch is staging, not a destination
Develop on the designated `claude/*` branch. When work is done and user says
push/ship/merge, take it to main in the same step.

---

## Tooling

### Graphify — commit portable artifacts so every environment can use it
The graphify CLI exists only in Claude Code cloud workspaces (the public npm
`graphify` is an unrelated package — never `npm install` it). The user wants
full use of the knowledge graph everywhere:

- **In cloud sessions**: after code changes run `npx graphify hook-rebuild`;
  before committing artifacts run `graphify portable-check .graphify`, then
  commit the portable artifacts (`graph.json`, `GRAPH_REPORT.md`, `wiki/`)
  to the repo. Never commit `branch.json`, `worktree.json`, `needs_update`,
  or `cache/`.
- **On local machines** (no CLI): read the committed `.graphify/graph.json`,
  `GRAPH_REPORT.md` and `wiki/index.md` directly for architecture questions
  instead of attempting CLI queries.

### This machine (Windows laptop) quirks
- Wi-Fi DNS is set to Google (8.8.8.8/8.8.4.4) because the ISP resolver
  intermittently fails on github.com. If pushes fail with "could not resolve
  host", check DNS first.
- Repo-local git identity: shyamsundar.pradhan21@gmail.com.

---

## Communication Style

### No narration, no preamble
State what changed and what's next in one or two sentences after the work is
done. Don't enumerate every file you touched unless asked.

### Partial answers invite re-prompts
If the answer is "some are fixed, some aren't", say so immediately and list
the remainder — don't wait to be asked.
