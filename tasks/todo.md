# Plan — Wire the algo screen into the app (computed data-review in Review sub-tab)

Status: **BUILT — awaiting user eyeball before commit.** All steps (a)–(f) done; 34
vitest green; certify normal+stress PASS (001/002/004=0, docOverflow=0, symmetry/
direction/value-size PASS); 6 shots saved to `audit/algo-review-shots/` (gitignored).

### Review (what shipped)
- `app/lib/regime.mjs` — shared classifier (moved from scripts/lib; market-wrap will reuse).
- `buildScreenPayload()` in `scripts/lib/algoScreen.mjs` + 4 shape tests.
- `scripts/build-algo-screen.mjs` — writes `data/algo-screen.json` (gitignored) + seeds KV `algo-screen:v1`.
- `app/api/algo-screen/route.js` + `loadAlgoScreen()` (KV+local, edge-protected like /api/portfolio).
- `app/components/shared/AlgoScreenReview.js` — lazy-fetched in AlgoTab Review sub-tab, below the AI prose.
- Render: held + per-regime tables (caveats visible) → confront w/ regime caveat → tier line → survivors-by-style (collapsible) → parked + tally + legend (collapsible). Tokens only, direction=colour.
- **NOT committed yet** (per instruction). Excludes daemon-written data/*.json + the public/*-mock.html scratch.

---

# (superseded) Plan — Wire the algo screen — original AWAITING-APPROVAL draft below
Status: **AWAITING APPROVAL** (discovery done; no build code written yet).

Goal: surface the COMPUTED screen result BESIDE the AI prose in the AlgoTab → Review
sub-tab. Precompute → KV → render; the frontend never runs `algoScreen` at render.

### Architecture decisions (flagged for sign-off)
1. **Shared regime lib → `app/lib/regime.mjs`** (move from `scripts/lib/regime.mjs`).
   `.mjs`, not `.js`: package.json has no `"type":"module"`, so Node would parse a
   `app/lib/regime.js` as CommonJS and throw on `export` in the precompute script.
   `.mjs` is unambiguously ESM for BOTH the Node precompute AND the Next bundler (the
   upcoming market-wrap imports it too). `scripts/lib/algoScreen.mjs` + the tests
   re-point to `../../app/lib/regime.mjs`. No logic change → 30 tests stay green.
2. **Screen JSON rides the PRIVATE payload, not a new route.** Held names + capital
   tier are private-ish → route through `/api/portfolio` (`force-dynamic`, `no-store`)
   so it never ships in the static client bundle. Add `loadAlgoScreen()` to
   `serverPortfolio.js` (KV `algo-screen:v1` + local `data/algo-screen.json` fallback,
   mirroring `loadFnoOverlay`); include as `_app.algoScreen`. No sibling self-fetch
   (per feedback.md). `data/algo-screen.json` gitignored (derived from gitignored
   held-algos.json).

### Steps
- [ ] **(a) Move regime lib** → `app/lib/regime.mjs`; re-point `algoScreen.mjs`,
      `regime.test.mjs`, `algoScreen.test.mjs`, `screen-gutcheck.mjs`. Run vitest (30 green).
- [ ] **(b) Payload serializer** `buildScreenPayload(screenResult)` in `algoScreen.mjs`
      (pure) → the exact spec shape: `{asOf, capitalTier, thresholds, counts, held[],
      confront{dominatedBy,supplementary}, survivorsByStyle, parked[], flaggedOutTally}`.
      Add a vitest case locking the shape (figures-from-calc guarantee).
- [ ] **(c) Build script** `scripts/build-algo-screen.mjs` → runs `runScreen` with
      `regimeCal` + `capital` (like gut-check), serializes, writes `data/algo-screen.json`
      + seeds KV `algo-screen:v1` (KV REST POST, like seed-portfolio-kv). Note: hook into
      the monthly routine.
- [ ] **(d) Read path**: `loadAlgoScreen()` in `serverPortfolio.js`; `_app.algoScreen`
      in `/api/portfolio`; thread the prop page.js → AlgoTab.
- [ ] **(e) Render** `app/components/shared/AlgoScreenReview.js`, in Review sub-tab
      BELOW the AnalysisCard prose (distinct block). Prioritized:
      1. HELD — live metrics + per-regime `.ovx` table (up/down/chop/stressed:
         days·sortino·maxDD·tested); honest flags VISIBLE (thin/untested, IV's thin
         -39% up bucket, park-reason "wouldn't clear conservative gate today").
      2. CONFRONT (dominatedBy + supplementary) WITH regime caveat (e.g. Ratio-Fluxer
         EMPTY chop bucket beside its -4.2%).
      3. Capital tier + thresholds line.
      4. SURVIVORS by style — collapsible per style (`<details>`).
      5. PARKED + flagged-out tally + legend — collapsible footer.
      Tokens only: `.card/.csm/.statgrid/.ovx`, direction=colour (no +/- glyph),
      `--fs-*`, both themes.
- [ ] **(f) Verify**: vitest green · `certify.mjs` normal+stress · render-verify live ·
      SAVE shots (Review sub-tab, 768/1920/2560 × day+night). **Hold commit** until shots
      saved + user confirms.

### Out of scope (this task)
- The market-wrap consumer of `regime.mjs` (future).
- Styling/figures in the AI prose card (unchanged — LLM writes prose only).

---

# Plan — Algo data, two tracks behind isolated adapters (PRIOR — superseded context)

Status: **AWAITING APPROVAL** (discovery done; no build code written yet).

Two distinct goals, two adapters, no conflation:
- **Track A — Stratzy = live per-algo P&L** (attribution; reconciled to broker sleeve net).
- **Track B — Dhan all-algos = monthly research feed** for capital-allocation optimisation (maths).

---

## Discovery (DONE, captured live 2026-06-30, read-only)

### Track A source — Stratzy web app (`stratzy.in`, P&L tab → `/portfolio`)
Auth = httpOnly session cookie + AWS WAF token (same-origin GET; no JS-readable bearer).
- **`/api/algo/portfolio`** → `{success,message, activeAlgos:{<algoId>:{…}}}` (map, 46 algos):
  name=`algoData.name` · sleeve/"Kind"=`algoData.category` · net=`overallPnL`
  (=`realizedPnl`+`unrealizedPnL`; split `overallPnlOrders`/`overallPnlPositions`) ·
  per-day=`dailyPnL` · deployed=`amountDeployed`/`investedAmount` ·
  trades=`activeTrades`/`tradesExecuted` · state=`automationEnabled`/`isManual`/`isDisabled` ·
  ids=`_id`/`advisorId`/`userId`/`broker`. No charges field (net only).
- **`/api/algo/liveReturns`** → `data.returns{<algoId>:number}` (sum = headline) — cross-check.

### Track B source — Dhan Algos (`algos.dhan.co`, API host `algo-api.dhan.co`)
User has **0 deployed on Dhan** (My Algos ₹0; `getSubscribedAlgos` empty) — so Dhan is NOT a P&L
source. It is the **catalog/universe** of all algos (published by `/managers/stratzy/…`), with
research metrics. Endpoints:
- **`/algo/sub/UniversalAlgoSearch`** (POST) — catalog search/list (the all-algos grid).
- `/algo/sub/getSubscribedAlgos` (POST), `/algo/sub/GetStrategyWisePosition` — user-side (empty).
- detail page `/managers/stratzy/<slug>/<id>` — per-algo backtest metrics + past trades.
- Visible research fields: name, category, min capital, **1Y returns**; detail adds backtest
  drawdown/sharpe/recovery/rank/score (cf. Stratzy `/api/web/algo/list` which has the same family).
- TODO at build time: capture full `UniversalAlgoSearch` response schema (needs cross-origin
  auth replication — token, not the same httpOnly cookie as Stratzy).

---

## Track A — Stratzy per-algo P&L  (propose; primary)
- [ ] `scripts/lib/stratzy-adapter.mjs` — ONE interface, two sources, same normalized row
      `{id,name,sleeve,deployed,net,daily,realized,unrealized,activeTrades,tradesExecuted,state}`:
      - `fromEndpoint({cookie})` → `/api/algo/portfolio` (+ `liveReturns`); timeout, validate, null on WAF/expiry
      - `fromPaste(text|csv)` → manual paste/CSV → same shape (durable fallback, first-class)
- [ ] `scripts/import-stratzy.mjs`: normalize → **reconcile** (scale ACTIVE algos' net to the broker
      F&O sleeve net — broker=truth for total, Stratzy=split; keep raw alongside scaled; stopped algos'
      realized P&L kept labeled-historical/unreconciled) → write `data/algos.private.json`
      (+`.example.json`) → publish KV `algos:v1` (`kvSetJSON`) → near-empty sanity guard.
- [ ] Cookie in gitignored `mcp/.stratzy.env` (mirror `.kv.env`); document paste format + cookie export.

## Track B — Dhan all-algos monthly research  (DONE 2026-06-30)
- [x] `scripts/lib/dhan-algos-adapter.mjs` — ONE interface, two sources, one normalized row:
      `fromHarvest()` (browser-harvested plaintext JSON) + `fromPaste()` (CSV fallback). Parses
      `ALGO_RETURNS` horizon map, preserves `correlations{overall,category}` matrices, coerces
      strings/"--"→null. (`fromEndpoint` is NOT a Node call — request body is AES-encrypted; see below.)
- [x] `scripts/lib/dhan-harvest.snippet.js` — console harvester: hooks fetch on algos.dhan.co,
      accumulates plaintext `UniversalAlgoSearch` responses, `__dumpCatalog()` downloads raw JSON.
- [x] `scripts/import-dhan-catalog.mjs` — source precedence (harvest file → paste/CSV), sanity guard
      (refuse <5 rows / missing metrics), writes `data/algo-catalog.json`, pushes KV `algo-catalog:v1`.
      Flags: `--harvest`/`--paste`/`--dry`.
- [x] `.gitignore`: catalog files (raw/paste/json) — reproducible + KV-backed, large (correlation matrices).
- [ ] Allocation optimiser = its own later task (consumes `algo-catalog:v1`).

### Track B review — SCOPED to Hedged Options + Naked Option Buying (final)
- **Better harvest mechanism found:** the page caches the FULL catalog (79 algos, rich fields incl.
  per-algo correlation matrices) in sessionStorage `dhan_all_algos_cache_v2`. Read it directly — no
  fetch/XHR interception (the agent's JS tool guardrail blocks XHR hooks anyway), no AES request to
  reproduce, COMPLETE in one shot. This supersedes the earlier UniversalAlgoSearch browser-harvest.
- **Trading style = `tags`, not `category`:** tag `Hedged`→Hedged Options (29), tag `Buying`→Naked
  Option Buying (12). Confirmed against both filtered grids (Hedged=all Credit Spreads; Buying=RR/TSL/GRID
  /SkewHunter). category is coarser (Index Strategies/Options/Investing/Swing).
- VERIFIED on REAL data: harvested 41 scoped algos via `dhan-harvest.snippet.js` → importer mapped the
  camelCase cache schema (algoReturns→returns horizon map, sharpeRatio, maxDrawdown, hitRatio, minAmount→
  minCapital, deployedCount, AlgoScore→score) → style derived (29 Hedged + 12 Naked, 0 missing) → 102-peer
  correlation matrices kept (0 missing) → wrote `data/algo-catalog.json` (356KB) → pushed `algo-catalog:v1`.
  Sanity guard (1 row → REFUSE, exit 1) and scalar paste/CSV fallback tested green.
- Importer scopes by `--styles` (default `Hedged Options,Naked Option Buying`); snippet pre-filters too.
- Data-layer only — nothing in the app reads `algo-catalog:v1` yet (next: the allocation optimiser).

## Out of scope / unchanged
- Sleeve-level totals unchanged. Brokers READ-ONLY, no order writes.
- ToS: user's own data, gentle/occasional polling. AWS-WAF/httpOnly → manual cookie refresh expected;
  paste/CSV is the durable backstop for both tracks.

## Open questions
1. Build order: Track A first (live attribution), then Track B (monthly research)? (recommended)
2. KV keys `algos:v1` (A) and `algo-catalog:v1` (B) ok? App reads now, or data-layer only for now?
3. Track A reconcile target = F&O sleeve net, stopped algos labeled-historical — confirm?

---

## Stratzy daily capture + Dhan join (DONE 2026-06-30) — data only, no screen yet
B+C built behind the same adapter pattern (paste fallback intact). Discovery in feedback.md.
- [x] `scripts/lib/stratzy-adapter.mjs` — pure normalizer + the LIVE/BACKTEST SPLIT at `liveSince`
      (date < liveSince = backtest, ≥ = live); `hasBacktestSegment` only at ≥5 backtest days (off-by-one
      excluded); `liveDays`; headline + backtest metrics. `fromHarvest`/`fromPaste`.
- [x] `scripts/lib/stratzy-adapter.test.mjs` — 10 tests: backtest-head, fully-live, <5-day-head fixtures
      assert every point labeled + the ≥5 threshold. Green.
- [x] `scripts/lib/stratzy-harvest.snippet.js` — one `GET /api/web/algo/list` (credentials:include) → download.
- [x] `scripts/import-stratzy-daily.mjs` — normalize 148 → JOIN Dhan on `_id==id` (prefers full-79
      `data/dhan-full.raw.json`, falls back to scoped-41 `algo-catalog.raw.json`) → `record.dhan` |
      `correlationAvailable` → `data/stratzy-daily.json` → KV `stratzy-daily:v1`.
- [x] gitignore the Stratzy/dhan-full data files.

### Review (verified on real data)
- 148 algos: 140 with curve, **62 with ≥5-day backtest segment**, 41/148 correlation-joined (scoped Dhan).
- Split verified: Wave-Return 78 backtest + 52 live (overfit case: clean backtest, live −50% mdd); held
  IV-Imbalance/Damper fully-live (0 backtest); BTST split fine despite empty `liveSinceBacktested`.
- KV push 1.43 MB OK. DATA ONLY — no scores computed (next step: the screen).
- **GAP:** Dhan-full 79 download was blocked by Chrome's multi-download prompt → join used scoped 41.
  Drop `data/dhan-full.raw.json` (79) in and re-run → coverage jumps to ~79 (importer already prefers it).
- SKIPPED per instruction: per-algo `advisorMetrics` loop (per-range winRatio/avgProfit/booksizes).
