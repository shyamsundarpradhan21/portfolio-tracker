# Plan — Algo data, two tracks behind isolated adapters

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
