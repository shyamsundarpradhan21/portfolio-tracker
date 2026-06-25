# Session Feedback — Standing Rules

Captured from live sessions. Read before starting any task.

---

## ALWAYS-READ (the terse layer — these fire most tasks)

- **Git:** never create/switch branches (default `main`). Auto-commit verified work to the currently checked-out branch; push to its `origin` counterpart ONLY on "push"/"ship".
- **No hardcoded subtexts/figures/dates** in JSX — derive from data or computed values.
- **Direction = colour**, never a `+`/`−` glyph on the figure.
- **CMPF (pension) renders LAST / right-most** in any allocation visual, always hatched, never solid.
- **AI surfaces never quote real portfolio ₹** — only public macro readings, only in `pulse` / `*_swot.macro`.
- **Derive from the data the user pointed at** — don't substitute a from-scratch answer; show the numbers you ran.
- **Build to the provided mockup/spec**, not the house style. "Mirror layout X" = build THAT layout; if exact `grid-template-areas` given, apply verbatim.
- **Render-mock BEFORE editing** any visual/layout redesign — they can't see my screenshots.
- **Render-verify any data-ledger edit** in the live app (raw API returns pre-corp-action qty).
- **Verify external facts (broker pricing/auth/limits) live** before asserting — or mark "unconfirmed".
- **Check for an official/hosted path before a big custom build**; confirm scope first. (But don't questionnaire analysis drafts — do the work, then iterate.)
- **"Fix all" = exhaustive grep sweep**, not just the flagged instances.
- **NEVER `npx graphify`** (resolves to an unrelated package); guard `command -v graphify`.
- **Comms:** no preamble; state what changed + what's next in 1–2 sentences. If partially done, say so and list the remainder unprompted.

Everything below is the detailed case file — consult the relevant entry when its situation comes up.

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

### Type scale is TIER-DRIVEN — a figure's size is set by its card's ROLE, never by the component, the card's dimensions, or the value's length
The app has a clean 9-step `--fs-*` scale, but the **value figure** on a card is sized
ad hoc — by whichever value class or inline `fontSize` the component happened to reach
for — so the SAME role renders at **5+ different sizes** and the hierarchy reads as
noise. A figure's size must be bound to a fixed **tier**, defined once in `globals.css`;
resizing a card (padding, width, content) must **never** change the figure size inside it,
and a shorter string must never render bigger than a longer one in the same row.

**The tiers (largest → smallest), driven ONLY by the card's role:**
- **Tier 0 — Hero net-worth** (`.hdr-val`): the single showpiece. Biggest, full glory
  (`--fs-h0`). Nothing else competes with it.
- **Tier 1 — Header cards**: the top-of-page head band (`.hdr-card`) AND the top
  summary-card row inside every tab (`.csm` headline / `.pnl-stat`). One fixed size
  everywhere (`--fs-2xl`) — a summary figure reads identically in the head band and
  inside its tab.
- **Tier 2 — Standard card values**: the headline number of a normal content card → one
  step down (`--fs-xl`).
- **Tier 3 — Dense / mini / secondary values**: nested minis, chips, table-adjacent
  stats → `--fs-lg` / `--fs-md` by context.

**Rules:**
- One source of truth: each value class maps to exactly ONE tier in `globals.css`.
  **Never** set `fontSize` inline on a figure to override its tier.
- A figure's size is independent of its string length: "50", "54%", "₹1,72,842" and
  "₹8.67L" in one summary row are the SAME height.

**Implemented** (this IS the live system — keep new figures on it):
- Classes: `.vt1`/`.vmd` = Tier 1 (`--fs-2xl`), `.vt2` = Tier 2 (`--fs-xl`), `.vt3`/`.vsm`
  = Tier 3 (`--fs-lg`, → `--fs-md` inside `.mini`). Old `.vlg` was folded into Tier 1 (it
  duplicated `.vmd`'s size); the ladder now has three real steps.
- Inline figure-size overrides removed → tier classes in `FnoHistory`, `MarketOverview`,
  `AlgoTab` (both splits). The two remaining `--fs-md` figures (`FnoPositions` leg P&L,
  `BenchmarkBars` bar %) are dense ROW/bar values (table-like Tier 3), left by design.
- Footers: `.csm .sub` clips to one line; `.sub.split` gives the two-value left/right
  split.
- App-wide rollout DONE (2026-06): every STANDARD content-card corner headline stepped
  Tier 1 → Tier 2 (`.vmd` → `.vt2`): `EquityDayCurve`, `RealizedPanel`, `FnoPositions`
  (net open MTM), `PortfolioLiveCurve`, `GrowthDashboard`, `SipCard`, and the US
  `Dividend Income` card (corner + its four `.csm` sub-stats together, so a breakdown
  never out-ranks its own headline). `CFMemo` `.vsm` tax memo left by design.
- The "mf @768 clip" was NOT a tier/CSS bug: `MFTab`'s Winner/Drag/Largest mini fed a
  full fund NAME into the symbol-width `.mini .vsm` slot (equity tabs put a short ticker
  there). Fixed locally — the name wraps to 2 lines + `-webkit-line-clamp:2`; the shared
  `.mini .vsm` nowrap rule (for tickers) is untouched. No `globals.css` change.

**Footers & alignment:**
- A card footer is a **single line, anchored to the LEFT, clipped with an ellipsis** on
  overflow — UNLESS it carries exactly **two values**, in which case the first is
  left-aligned and the second right-aligned (`space-between`). No wrapping footers (base
  `.sub` currently wraps; only `.hdr-card .sub` clips — unify on the clip).
- A value figure **hugs the left edge** of its card. The only right-aligned figures are
  **numeric table columns** (`.ra`).

(Trigger: the Trading-tab header row — TRADING CAPITAL / NET P&L / WIN RATE / MOST
PROFITABLE DAY / TRADING DAYS — rendered its figures at visibly different sizes because
each stat picked its own size. The user wants a definite, card-tier-driven scale: the hero
stands out, the header cards match, everything else falls in by context — and it's an
app-wide standard, not a one-card fix. Pairs with "Render mocks BEFORE editing": the tier
mock was built and approved before the `globals.css` re-map.)

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

### AI analysis stays free of actual portfolio figures
The AI insight surfaces (pulse, every sleeve card, both SWOT cards) must **never
quote the user's real portfolio numbers** — no ₹ amounts, holding/position values,
cost basis, units, P&L, or net worth. The only figures the AI may cite are PUBLIC
live-macro market readings (index levels, FX, yields, commodities) and only in
`pulse` and `*_swot.macro`. The portfolio snapshot passed to `/api/insights` is
context for a qualitative read, not material to quote back. Enforced in the
insights system prompt — keep that guard when editing the prompt or schema.

---

## Git Workflow

### Work directly on main — do NOT create feature branches
The user wants commits made **straight to `main`**. Skip the harness default of
"branch first on the default branch" and the old staging-branch habit: edit,
commit on `main`, push to `origin/main`. Do not create `claude/*` branches.
(Caught: I kept spinning up a `claude/*` branch per task; the user asked plainly
to stop and work on main — "ship to main.. work on main.. why are u creating branches".)

### Always commit finished work — to the current branch, don't leave it in the working tree
Once a change is done and verified, **commit it without being asked** ("commit it
always"), to **whatever branch is currently checked out** — on `main` → `main`; if the
user has checked out a branch → commit there. Don't create or switch branches to do it.
Don't stop to ask "want me to commit?" — the default is yes. Committing ≠ publishing:
**only push to `origin` when the user explicitly says so** (push the current branch to
its `origin` counterpart). So a normal task ends with a local commit on the current
branch and no push, unless they say push/ship/merge.
(Caught: I kept finishing edits and asking whether to commit; the user wants the
commit done automatically, just held back from origin until told.)

### "push" / "ship" = commit + push the current branch
When the user says **push** or **ship**, commit the work on the current branch and push
it to its `origin` counterpart (on `main` → `origin/main`) — no confirmation needed
unless something genuinely conflicts.

---

## Tooling

### Graphify — commit portable artifacts so every environment can use it
The graphify CLI exists only in Claude Code cloud workspaces (the public npm
`graphify` is an unrelated package — never `npm install` it). The user wants
full use of the knowledge graph everywhere:

- **NEVER `npx graphify`.** In cloud images graphify ships as a binary *on
  PATH*, and `npx graphify` only works because it runs that PATH binary. When
  the binary is absent (some cloud sessions provision without it), `npx` falls
  through to the public registry and pulls an UNRELATED package ("RGG / Random
  Graph Generator") — foreign code, downloaded and executed. Always invoke the
  PATH binary directly behind a guard:
  `command -v graphify >/dev/null && graphify <cmd>`. If it's not on PATH,
  skip silently — there's no graph to update in that environment.
- **In cloud sessions WITH the CLI**: after code changes run
  `command -v graphify >/dev/null && graphify hook-rebuild`; before committing
  artifacts run `graphify portable-check .graphify`, then commit the portable
  artifacts (`graph.json`, `GRAPH_REPORT.md`, `wiki/`) to the repo. Never
  commit `branch.json`, `worktree.json`, `needs_update`, or `cache/`.
- **Without the CLI** (local machines, or a cloud session that didn't
  provision it): read the committed `.graphify/graph.json`, `GRAPH_REPORT.md`
  and `wiki/index.md` directly for architecture questions instead of
  attempting CLI queries.

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

### "Mirror / copy / replicate layout X" = build THAT layout — don't redesign or copy the wrong source
When the user says "mirror the desktop layout in tablet," "copy this layout," or hands an explicit
layout spec (e.g. `grid-template-areas`), produce exactly that arrangement. Two failure modes to avoid:
(a) inventing new variations (50:50, transpose, custom column splits) when they asked to replicate
something specific; (b) literally copying the CSS of another breakpoint when they meant the visual
**layout** (grouping), not the **grid** definition. If they give exact areas/row-spans, apply them
verbatim. Render once and confirm the target, then build — cycling through several guessed
arrangements is the churn. (Caught: asked to mirror the Macro tab layout in tablet, I cycled through
50:50 → transpose → col3-as-row → a literal desktop-grid copy before the user spelled out the exact
`grid-template-areas`. They said "layout, not grid" — they meant the visual arrangement, which I
should have just built/confirmed up front. Pairs with "Build to the provided mockup/spec".)

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
user corrected each: Kite Connect "₹2,000/mo" (really ~₹500 base as of 2026-06; the ₹2k is the
historical-data add-on a portfolio reader doesn't need), and Dhan "SMS-only, so
blocked" (only the *consumer* QR/SMS login is blocked — the DhanHQ *developer* TOTP
endpoint mints tokens fully headless). Before asserting a broker/API's pricing, auth
method, capability, or limit, **verify it** — inspect the live page, dispatch a
research agent, or ask the user (who knows their own account) — or explicitly mark it
"unconfirmed." Repeated confident-but-wrong claims erode trust and cause churn.
(Pairs with "Check for the easy/official path".)

### Fyers is PARKED — no unattended auth exists; don't re-automate it
Fyers has **no** headless/unattended auth path (refresh-token API SEBI-disabled, AND
the browser login is Cloudflare-blocked as of 2026-06-25). It is parked:
`enabled:false` in `scripts/lib/brokers.mjs` pullPositions, `FyersDailyLogin` task
disabled. The only way to a token is a MANUAL login + `mcp/fyers/exchange-code.py`.
Don't burn time re-automating it — the user isn't trading on Fyers. Durable lesson:
trust the [[broker-mcp-unattended-auth]] memory and verify a broker's auth live before
recommending a path. (Other brokers, current: Dhan = headless pure-API TOTP self-mint;
Upstox = headless Playwright; Kite = hosted OAuth, interactive.) Full investigation
history in Archive at end of file.

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

### "Don't take stale values" ≠ "drop the data point" — fix per-component freshness
When the user flags staleness, correct the stale COMPONENT, don't skip/delete the whole
record. Caught: asked to keep net-worth snapshots free of stale values, I added a guard
that skipped recording on non-trading days (plus a DELETE route to purge points) — the
heaviest mechanism. They meant the opposite: keep the daily snapshot (the NW is correct —
equity holds at last close while FD + CMPF accrue daily, both date-based), and fix the
DAY *attribution* so closed-market equity reads 0 (no carried-forward session move) while
FD/CMPF show their daily accrual. Reach for the minimal correctness fix, not a skip/drop.
(Pairs with Demand-Elegance: I built skip+DELETE infra where a small attribution tweak was
the elegant answer.)

### Dev-server verification gotchas (Next.js + a live data daemon)
Two traps cost real time verifying live changes while the capture daemon rewrites
`data/*.json` every ~10s:
- **Same-URL `#hash` navigation does NOT reload.** Playwright `page.goto('…/#algo')`
  when already on that URL is a same-document hash change — React state persists, so a
  `useState` + `[]`-effect change (e.g. a poll that now sets an OBJECT instead of a
  number) keeps the STALE value while Fast Refresh hot-swaps the new component around
  it → you see `₹NaN` / old data even after "reloading". Force a real document load with
  a cache-bust query (`?r=N#algo`). Confirm the *logic* against the API payload directly
  (`fetch(...)` in the page) so you don't chase a phantom bug in correct code.
- **Fast Refresh churn from the daemon.** A static `import data from '…/data/x.json'`
  recompiles on every daemon write → constant "Fast Refresh rebuilding", which can serve
  a transitional bundle AND destroy a Playwright eval context mid-run ("Execution context
  was destroyed"). To verify cleanly, stop the daemon briefly (settle the rebuilds) or
  just retry the eval; the code is usually right — the dev loop is noisy. Prod (KV-backed,
  no static-JSON churn) doesn't have this.
After a hot change to a polling `useEffect`, prefer a cache-bust reload over trusting the
in-app tab nav, and restart a long-running daemon so it picks up edited modules (Node
caches them — a running daemon keeps the OLD code until restarted).

## Communication Style

### No narration, no preamble
State what changed and what's next in one or two sentences after the work is
done. Don't enumerate every file you touched unless asked.

### Partial answers invite re-prompts
If the answer is "some are fixed, some aren't", say so immediately and list
the remainder — don't wait to be asked.

---

## Archive (perishable / historical — do not treat as current truth)

### Fyers auth — full investigation trail (2026-06)
Original finding: `/validate-refresh-token` returned **code -16 "Refresh token API is
currently disabled to comply with SEBI regulations."** — killed the headless
refresh-mint path (`sync-brokers.mjs fyersRefreshMint`, and its stale "works headless
for ~15 days" comment). Left the daily headed TOTP browser login (`mcp/fyers/login.py`)
as the only path; Cloudflare blocked headless.
UPDATE 2026-06-25: the browser login died too — Fyers redesigned the login page and
Cloudflare now silently blocks the send-OTP API
(`api-t2 .../vagator/v2/send_login_otp_v3` → `net::ERR_FAILED`) for any automated
browser; no Turnstile widget to solve, only a real human's `cf_clearance` passes
(confirmed by driving it live + capturing the network). Net: no unattended Fyers auth
left → parked. Superseded by the one-line rule in Working Style; kept here for the trail.
