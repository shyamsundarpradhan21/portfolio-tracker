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

### CMPF (pension) always renders LAST / to the right in any allocation visual
In every allocation view — donut, the horizontal bar, the legend, the deployment
strip — the **CMPF / pension (`pf`) sleeve sits last (right-most)**, after the
investable sleeves (FD · Indian · US · MF · ELSS · then CMPF), and always in its
grey/black diagonal **hatch** (`CMPF_HATCH`), never a solid colour. It's the
pension pool — conceptually separate from the investable book — so it's segregated
to the right; never lead with it. Match the app's existing order. Caught: mocked
the allocation bar with CMPF first (left) in solid grey.

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

### Build to the provided mockup/spec, not the house style
When the user shares a mockup, design file, or explicit spec ("remodel like
this", with an HTML/image), treat it as the source of truth: match its layout,
structure, and components precisely. Don't substitute the app's existing
card/design system because it's faster or familiar — that reads as ignoring the
brief. Translate the mockup's visuals into the app's theme tokens (no hardcoded
hex), but keep the structure faithful. If the mockup omits sections the app
currently has, confirm drop-vs-keep before removing. (This cost a full Wrap
rebuild: I shipped the data wiring in the house style when a detailed mockup
had already been provided.)

### Fewer upfront questions; do the work, then let them react
For analysis/strategy tasks, default to producing a concrete, data-grounded draft
and iterating on it — not a questionnaire. One short round of genuinely
blocking questions max.

### Check for the easy/official path; ask before a critical build
Before hand-rolling something significant — a custom server, a large refactor, a
big install, a multi-file sweep — first check whether an official / hosted /
one-command option already exists, then STOP and confirm before committing to the
build. Building the custom Dhan MCP server when an official hosted one existed
(`claude mcp add --transport http dhan https://mcp.dhan.co/mcp`, browser auth) was
wasted effort the user had to catch. This does NOT contradict "do the work, don't
questionnaire" — that's for analysis drafts; a large or hard-to-undo build is the
opposite, confirm scope first. Rule of thumb: if it's critical, costly to undo, or
a ready-made path might exist, ask before starting. (When docs won't render via
fetch, ask the user to check rather than assuming and building.)

### Verify external facts before asserting them — don't guess pricing / capability / limits
This session I stated several third-party facts from memory that were wrong, and the
user corrected each: Kite Connect "₹2,000/mo" (really ~₹500 base; the ₹2k is the
historical-data add-on a portfolio reader doesn't need), and Dhan "SMS-only, so
blocked" (only the *consumer* QR/SMS login is blocked — the DhanHQ *developer* TOTP
endpoint mints tokens fully headless). Before asserting a broker/API's pricing, auth
method, capability, or limit, **verify it** — inspect the live page, dispatch a
research agent, or ask the user (who knows their own account) — or explicitly mark it
"unconfirmed." Repeated confident-but-wrong claims erode trust and cause churn.
(Pairs with "Check for the easy/official path".)

### /sync drift check: apply corp actions before flagging INDIAN qty drift
The INDIAN ledger (`data/portfolio.private.json`) stores **pre-corp-action**
quantities by design; the app reconstructs the live broker position at render
time via `applyCorpActions()` in `app/lib/calc.js` (e.g. a 1:3 bonus on raw 141
→ `141 + floor(141/3)` = 188). So the broker (Kite) showing 188 while the ledger
shows 141 is **NOT drift** when a matching `CORPORATE_ACTIONS` bonus exists — the
app already renders 188. Before flagging an INDIAN qty/avg mismatch in the sync's
step-4 drift check, apply pending bonuses/splits (or just check `CORPORATE_ACTIONS`
for that sym). Caught: I "reconciled" CUB to raw 188, which double-applied the
bonus → app rendered 250. Reverted to 141. **Verifying in the live app (not just
the API payload) is what caught it** — the raw API returns pre-action qty; only
the rendered holding shows the post-action number. Always render-verify a
data-ledger edit.

### Render mocks BEFORE editing — for any visual/layout redesign
When the user asks for a design or layout change (card proportions, restructuring,
a redesign), build a **render mock first** — a served HTML page (e.g. via
`public/`, opened at `localhost:3000/...`) or rendered options — and share it so
they can visualize and pick **before** touching the real code. Do NOT jump straight
to editing `globals.css` / components. Live-editing the app and describing my own
screenshots is NOT the same as giving them a mock to choose from (they can't see my
screenshots). Caught: I rebalanced the Overview two-card layout by editing `.ov-top`
directly instead of mocking the proportion options first. (Pairs with Plan-Mode-Default.)

## Communication Style

### No narration, no preamble
State what changed and what's next in one or two sentences after the work is
done. Don't enumerate every file you touched unless asked.

### Partial answers invite re-prompts
If the answer is "some are fixed, some aren't", say so immediately and list
the remainder — don't wait to be asked.
