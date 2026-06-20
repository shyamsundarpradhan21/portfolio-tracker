# Portfolio Tracker — what it is and how it works

> A hand-off overview for anyone (human or agent) picking up this codebase.
> Reflects the repo as of 2026-06-20. The older `.planning/codebase/` docs predate
> the Macro tab and the entire broker-automation layer described below.

## What it is
A **single-owner personal net-worth dashboard** — a Next.js (App Router) single-page
app deployed on Vercel. One user, no auth. It aggregates every pocket of the owner's
wealth into one live view: Indian stocks, US stocks, mutual funds, fixed deposits, a
pension/PF corpus, and a separately-tracked F&O/swing trading book. It layers **live
prices, live broker holdings, AI commentary, and a macro read** on top of a
hand-curated ledger.

## The core design idea (most important thing to understand)
There are **two data planes**, deliberately separated:

1. **Curated static ledger** — [app/portfolio.js](../app/portfolio.js) is the **single
   source of truth** for cost basis, holdings metadata (sector/cap/name), corporate-
   action history, and dated cashflows. Plain JS arrays/objects, hand-maintained,
   committed to git.
2. **Live overlay** — current prices, broker quantities, MTM, NAVs, FX, macro. Fetched
   at runtime and **layered on top of** the curated ledger; it never mutates it.

So: curated data gives *what you own and what it cost*; the live plane gives *what it's
worth right now*. Everything the UI shows is a `useMemo` derivation merging the two.

## Architecture in one picture
```
Browser (app/page.js, 'use client')  ── all state, all derivations, tab routing
   │  fetch /api/*
   ▼
Next.js API routes (thin server proxies, no DB)
   quotes · history · fx-history · mf-nav · macro · nifty50 · premarket · insights
   │
   ▼
External: Yahoo Finance · AMFI (mfapi.in) · FRED · Anthropic API · Vercel KV
   +
Committed JSON snapshots in data/  ← written by the broker-automation layer (below)
```
**State lives entirely in [app/page.js](../app/page.js)** (no Redux/Context). Tab
components under [app/components/tabs/](../app/components/tabs/) are **pure renderers** —
they receive fully-derived props and never fetch.

## The tabs (`TAB_KEYS` in page.js)
| # | Tab | Shows |
|---|---|---|
| 0 | **Overview** | Net-worth total, history curve, forward projection, capital-deployment mix, tax memo |
| 1 | **Indian** | NSE delivery holdings, sector/cap mix, benchmarks, realized P&L, SWOT |
| 2 | **FD** | Fixed-deposit ladder, maturity timeline |
| 3 | **MF** | Mutual-fund NAVs, XIRR vs benchmark, cap allocation |
| 4 | **US** | US holdings (Vested/DriveWealth → migrating to Dhan GIFT City), ETF look-through, dividends |
| 5 | **Algo / Trading** | F&O book (S01 credit spreads, S02 active), swing positions, YTD realised P&L, tax carryforward. **Excluded from net worth** |
| 6 | **Macro** | "Pulse" — market regime (risk-on/off), VIX/HY-OAS, FII/DII flows, ±10% scenario impact on the book |

## Data sources / API routes ([app/api/](../app/api/))
- **[/api/quotes](../app/api/quotes/route.js)** — live prices (Yahoo Finance v8, batched,
  UA-spoofed, host failover). Refreshed on mount + a 15-min timer.
- **[/api/mf-nav](../app/api/mf-nav/route.js)** — mutual-fund NAVs (AMFI mfapi.in), 24h
  cached, falls back to CAS-statement NAV.
- **[/api/history](../app/api/history/route.js)** + **[/api/fx-history](../app/api/fx-history/route.js)**
  — 5y weekly benchmark series + USD/INR closes, used to **backfill** synthetic
  net-worth history before real snapshots existed.
- **[/api/macro](../app/api/macro/route.js)** — macro backdrop (FRED + Yahoo) feeding the
  regime classifier ([regime.js](../app/lib/regime.js)).
- **[/api/nifty50](../app/api/nifty50/route.js)** + **[/api/premarket](../app/api/premarket/route.js)**
  — index + FII/DII flows; premarket persists the FII/DII trail to **Vercel KV**.
- **[/api/insights](../app/api/insights/route.js)** — AI portfolio commentary via
  **Anthropic Claude Haiku**, structured-JSON output, hash-gated so it only re-calls
  when data changed.

## The broker-automation layer
The owner's actual holdings live across **4 brokers**: **Zerodha/Kite** (Indian
delivery), **Upstox** (swing), **Dhan** (F&O S01 + US GIFT City), **Fyers** (F&O S02).
These are read **live** and reconciled against the curated ledger:

- **MCP servers** under [mcp/](../mcp/) (`dhan`, `upstox`, `fyers` — Python; Kite is a
  hosted-OAuth MCP) expose read-only broker APIs.
- **Daily tokens:** SEBI killed refresh tokens, so each broker needs a fresh daily
  token. Dhan **self-mints** via pure-API TOTP; Upstox/Fyers mint via headless/headed
  **Playwright** login tasks; Kite needs an interactive OAuth click.
- **[scripts/sync-brokers.mjs](../scripts/sync-brokers.mjs)** is the engine: pulls
  holdings/positions/funds/trades, **mints-on-demand** if a token is stale, and writes
  **[data/broker-state.json](../data/broker-state.json)** (a committed read snapshot — no
  secrets). The **`/sync`** skill orchestrates this plus the Kite login.
- **[app/lib/brokerState.js](../app/lib/brokerState.js)** → `reconcileSleeve(curated, key)`
  overlays broker qty/avg/live-MTM onto the curated metadata **without mutating it**, and
  computes drift ("did I forget to log a trade?"). A `SyncBadge` shows
  synced/drifted/stale per sleeve.
- **Realised-F&O auto-driver** (the Trading tab's current-FY numbers):
  [data/fno-ledger.json](../data/fno-ledger.json) accumulates each day's realised F&O P&L
  (gross − modeled charges via [scripts/lib/fno-charges.mjs](../scripts/lib/fno-charges.mjs));
  [app/lib/fnoLedger.js](../app/lib/fnoLedger.js) `deriveFY()` rolls it on top of a frozen
  ITR seed in [data/fy2526_verified.json](../data/fy2526_verified.json). Capture runs
  **laptop-side (evening task)** and **cloud-side (Claude Remote routine)** — Dhan + Fyers
  run in the cloud so it works laptop-off; the only manual touch is the annual ITR
  reconcile. See [SCHEDULE.md](../SCHEDULE.md) for all jobs.

## Key computations ([app/lib/](../app/lib/))
- **[calc.js](../app/lib/calc.js)** — XIRR (Newton-Raphson + bisection), CAGR, beta/vol,
  **benchmark counterfactual** ("what if these cashflows had gone into Nifty?"),
  corporate-action application.
- **[projection.js](../app/lib/projection.js)** / **[scenarios.js](../app/lib/scenarios.js)**
  — forward net-worth projection + scenario stress.
- **[cmpf.js](../app/lib/cmpf.js)** / **[cmps.js](../app/lib/cmps.js)** — pension/provident-
  fund corpus from the contribution ledger.
- **[regime.js](../app/lib/regime.js)** / **[fiidii.js](../app/lib/fiidii.js)** — macro
  regime classification + FII/DII trail.
- **[backfill.js](../app/lib/backfill.js)** + **[snapshots.js](../app/lib/snapshots.js)** —
  synthetic pre-snapshot history + localStorage daily NW snapshots.
- **[fmt.js](../app/lib/fmt.js)** — all ₹/$/% formatting; **[market.js](../app/lib/market.js)**
  — NSE/NYSE open detection; **[suntimes.js](../app/lib/suntimes.js)** — auto day/night theme.

## Persistence model
**No backend database.** All durable data is **committed JSON in [data/](../data/)**
(`broker-state.json`, `fno-ledger.json`, `trades-log.json`, `snapshot-sleeves.json`,
`fy2526_verified.json`, etc.). The sync scripts commit + push → **Vercel rebuilds** → the
deployed app reads the new data. The browser uses `localStorage` (NW snapshots, AI
insights, theme) and `sessionStorage` (price/NAV cache). Vercel KV holds the FII/DII
trail + the Fyers refresh-token handoff.

## Invariants / gotchas
- **Trading capital is excluded from net worth** (`STATIC.algo`) — it's not
  marked-to-market daily; only the owner's *share* of P&L is shown.
- **Never mutate the curated ledger from the live plane** — the reconcile overlays; the
  ledger stays authoritative for cost basis/history.
- **The Indian sleeve is a drift-check, not value-driven** (its qty already reflects corp
  actions via `applyCorpActions`), while SWING is broker-driven. Mixing those
  double-counts.
- **Broker APIs are intraday-only** for trades/positions — historical realised P&L isn't
  in the API, hence the daily-accumulating ledgers ([data/trades-log.json](../data/trades-log.json),
  [data/fno-ledger.json](../data/fno-ledger.json)).
- All files are `.js` (no TypeScript). Tab components must stay pure (no fetching).

## Where things live (quick map)
| Concern | File(s) |
|---|---|
| Root state + all derivations + tab routing | [app/page.js](../app/page.js) |
| Curated ledger (cost basis, holdings, cashflows, corp actions) | [app/portfolio.js](../app/portfolio.js) |
| Tab renderers (pure) | [app/components/tabs/](../app/components/tabs/) |
| Shared UI (charts, badges, tables) | [app/components/shared/](../app/components/shared/) |
| Pure math + formatting + market/theme helpers | [app/lib/](../app/lib/) |
| Server proxies (no persistence) | [app/api/](../app/api/) |
| Committed data snapshots | [data/](../data/) |
| Broker MCP servers (Python) | [mcp/](../mcp/) |
| Sync engine + cloud/laptop capture | [scripts/sync-brokers.mjs](../scripts/sync-brokers.mjs), [scripts/lib/](../scripts/lib/) |
| Scheduled-job catalog | [SCHEDULE.md](../SCHEDULE.md) |
