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

### Sign via colour, not +/- glyphs
Direction (gain/loss, deploy/withdraw, above/below) is conveyed by **colour** —
`var(--grn)` / `var(--red)` (the `.up`/`.dn`, `.grn`/`.red` classes) — **never**
a leading `+` or `−` glyph on the figure. A value like `₹74,128` renders green
for a deposit, red for a withdrawal; no `+₹74,128`. If a metric only makes sense
as a signed comparison (e.g. "vs average"), prefer an absolute, unsigned figure
instead of reintroducing the glyph. (Equation connectors in prose — "X deployed
+ Y gains" — are fine; that `+` is arithmetic, not a sign indicator.)

### Deep cleanse = exhaustive sweep
"Fix all" means scan every file in `app/` for every variant of the pattern,
not just the ones flagged. When one instance of a hardcoded string is found,
grep the codebase before reporting done.

### Council/review checklist additions (user-flagged misses)
Any UI review (/council or otherwise) must also check:
- **₹ glyph scaling** — mono faces lack ₹; the body-font fallback renders
  oversized. Every ₹ next to mono digits goes through the `.rs` treatment.
- **Font tokens** — no raw px font sizes in CSS/JSX; use the global `--fs-*`
  scale.
- **Summaries/footers dynamic** — card prose must derive from live values
  (same rule as subtexts).
- **Theme-following colors** — no hex constants that ignore the day/night
  `--sc-*` / `--acc` tokens; resolve CSS vars at runtime for SVG.
- **Model assumptions derived** — projection contribution + step-up come from
  `deriveProjInputs` (ledger deployment + payslip growth), never typed in.

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

## Working Style / Task Execution

### Derive from the data the user pointed at — don't substitute a generic answer
When the user says "go through X, run the numbers, build Y from it" (e.g. "go
through the vests, run their return nos, come up with a portfolio"), the
deliverable must be **computed from X**. Load the data, actually run the rankings
/ stats, and construct the answer on top of that analysis. Producing a plausible
from-scratch answer out of general knowledge — while the pointed-at dataset sits
unused — is the failure mode. Show the numbers you ran.

### Stated intent beats a clarifying multiple-choice
A clicked AskUserQuestion option does NOT override the user's explicit
natural-language instruction. If the menu options don't match what they actually
asked (or were mis-framed by me), the words win. Don't hide behind "but you
selected X." When in doubt, do the thing they said in prose.

### Honour preferences evident from existing holdings
Build with what the user already demonstrably values. Their book signals intent:
SCHD (quality-dividend anchor), the crypto-miner sleeve (Blockchain Ecosystem
mirror), the AI/tech tilt. Omitting those from a "rebuild" reads as not paying
attention. Cross-check a proposed portfolio against current holdings before
presenting.

### Fewer upfront questions; do the work, then let them react
For analysis/strategy tasks, default to producing a concrete, data-grounded draft
and iterating on it — not a questionnaire. One short round of genuinely
blocking questions max.

## Communication Style

### No narration, no preamble
State what changed and what's next in one or two sentences after the work is
done. Don't enumerate every file you touched unless asked.

### Partial answers invite re-prompts
If the answer is "some are fixed, some aren't", say so immediately and list
the remainder — don't wait to be asked.
