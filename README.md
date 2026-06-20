# Portfolio Tracker

> A **single-owner personal net-worth dashboard** — a Next.js (App Router) single-page
> app deployed on Vercel. One user, no auth. It aggregates every pocket of the owner's
> wealth into one live view: Indian stocks, US stocks, mutual funds, fixed deposits, a
> pension/PF corpus, and a separately-tracked F&O/swing trading book. It layers **live
> prices, live broker holdings, AI commentary, and a macro read** on top of a
> hand-curated ledger.

## The core design idea (most important thing to understand)
There are **two data planes**, deliberately separated:

1. **Curated ledger** — the single source of truth for cost basis, holdings metadata
   (sector/cap/name), corporate-action history, and dated cashflows. The private figures
   live **out of the repo and out of the client bundle** (see *Data & persistence*);
   [app/portfolio.js](app/portfolio.js) holds the **logic + empty containers** that are
   hydrated at runtime.
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
   portfolio · quotes · history · fx-history · mf-nav · macro · nifty50 · premarket · insights
   │
   ▼
External: Yahoo Finance · AMFI (mfapi.in) · FRED · Anthropic API · Vercel KV
   +
Committed JSON snapshots in data/  ← written by the broker-automation layer (below)
```
**State lives entirely in [app/page.js](app/page.js)** (no Redux/Context). It gates render
on data load, then mounts the dashboard. Tab components under
[app/components/tabs/](app/components/tabs/) are **pure renderers** — they receive
fully-derived props and never fetch.

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

## Data sources / API routes ([app/api/](app/api/))
- **[/api/portfolio](app/api/portfolio/route.js)** — the private curated ledger, served at
  runtime (KV `portfolio:v1`, else the local gitignored JSON) so it never ships in the
  client bundle. `no-store`, `force-dynamic`.
- **[/api/quotes](app/api/quotes/route.js)** — live prices (Yahoo Finance v8, batched,
  UA-spoofed, host failover). Refreshed on mount + a 15-min timer.
- **[/api/mf-nav](app/api/mf-nav/route.js)** — mutual-fund NAVs (AMFI mfapi.in), 24h
  cached, falls back to CAS-statement NAV.
- **[/api/history](app/api/history/route.js)** + **[/api/fx-history](app/api/fx-history/route.js)**
  — 5y weekly benchmark series + USD/INR closes, used to **backfill** synthetic
  net-worth history before real snapshots existed.
- **[/api/macro](app/api/macro/route.js)** — macro backdrop (FRED + Yahoo) feeding the
  regime classifier ([regime.js](app/lib/regime.js)).
- **[/api/nifty50](app/api/nifty50/route.js)** + **[/api/premarket](app/api/premarket/route.js)**
  — index + FII/DII flows; premarket persists the FII/DII trail to **Vercel KV**.
- **[/api/insights](app/api/insights/route.js)** — AI portfolio commentary via
  **Anthropic Claude Haiku**, structured-JSON output, hash-gated so it only re-calls
  when data changed.

## The broker-automation layer
The owner's actual holdings live across **4 brokers**: **Zerodha/Kite** (Indian
delivery), **Upstox** (swing), **Dhan** (F&O S01 + US GIFT City), **Fyers** (F&O S02).
These are read **live** and reconciled against the curated ledger:

- **MCP servers** under [mcp/](mcp/) (`dhan`, `upstox`, `fyers` — Python; Kite is a
  hosted-OAuth MCP) expose read-only broker APIs.
- **Daily tokens:** SEBI killed refresh tokens, so each broker needs a fresh daily
  token. Dhan **self-mints** via pure-API TOTP; Upstox/Fyers mint via headless/headed
  **Playwright** login tasks; Kite needs an interactive OAuth click.
- **[scripts/sync-brokers.mjs](scripts/sync-brokers.mjs)** is the engine: pulls
  holdings/positions/funds/trades, **mints-on-demand** if a token is stale, and writes
  **[data/broker-state.json](data/broker-state.json)** (a committed read snapshot — no
  secrets).
- **[app/lib/brokerState.js](app/lib/brokerState.js)** → `reconcileSleeve(curated, key)`
  overlays broker qty/avg/live-MTM onto the curated metadata **without mutating it**, and
  computes drift ("did I forget to log a trade?"). A `SyncBadge` shows
  synced/drifted/stale per sleeve.
- **Realised-F&O auto-driver** (the Trading tab's current-FY numbers):
  [data/fno-ledger.json](data/fno-ledger.json) accumulates each day's realised F&O P&L
  (gross − modeled charges via [scripts/lib/fno-charges.mjs](scripts/lib/fno-charges.mjs));
  [app/lib/fnoLedger.js](app/lib/fnoLedger.js) `deriveFY()` rolls it on top of a frozen
  ITR seed in [data/fy2526_verified.json](data/fy2526_verified.json). Capture runs
  **laptop-side (evening task)** and **cloud-side (Claude Remote routine)** — Dhan + Fyers
  run in the cloud so it works laptop-off; the only manual touch is the annual ITR
  reconcile. See [SCHEDULE.md](SCHEDULE.md) for all jobs.

## Key computations ([app/lib/](app/lib/))
- **[calc.js](app/lib/calc.js)** — XIRR (Newton-Raphson + bisection), CAGR, beta/vol,
  **benchmark counterfactual** ("what if these cashflows had gone into Nifty?"),
  corporate-action application.
- **[projection.js](app/lib/projection.js)** / **[scenarios.js](app/lib/scenarios.js)**
  — forward net-worth projection + scenario stress.
- **[cmpf.js](app/lib/cmpf.js)** / **[cmps.js](app/lib/cmps.js)** — pension/provident-
  fund corpus from the contribution ledger.
- **[regime.js](app/lib/regime.js)** / **[fiidii.js](app/lib/fiidii.js)** — macro
  regime classification + FII/DII trail.
- **[backfill.js](app/lib/backfill.js)** + **[snapshots.js](app/lib/snapshots.js)** —
  synthetic pre-snapshot history + localStorage daily NW snapshots.
- **[fmt.js](app/lib/fmt.js)** — all ₹/$/% formatting; **[market.js](app/lib/market.js)**
  — NSE/NYSE open detection; **[suntimes.js](app/lib/suntimes.js)** — auto day/night theme.

## Data & persistence
**No backend database.** Three kinds of durable data:

- **Committed JSON snapshots** in [data/](data/) (`broker-state.json`, `fno-ledger.json`,
  `trades-log.json`, `snapshot-sleeves.json`, `fy2526_verified.json`, …) — written by the
  sync pipeline, server-imported at runtime (not bundled to the client). The browser also
  uses `localStorage` (NW snapshots, AI insights, theme) and `sessionStorage` (price/NAV
  cache).
- **Vercel KV** holds the FII/DII trail, the Fyers refresh-token handoff, and the **live
  private portfolio** (`portfolio:v1`).
- **Private financial data never sits in git or ships in the client bundle.** The deployed
  app reads it from KV via [/api/portfolio](app/api/portfolio/route.js) at runtime; local
  dev falls back to gitignored `data/portfolio.private.json`.
  `data/portfolio.private.example.json` documents the shape.

**To edit holdings / salary / loans:** edit `data/portfolio.private.json`, then run
`node scripts/seed-portfolio-kv.mjs` (pushes to KV; a sanity guard refuses to push
near-empty data). KV is the live source — **no redeploy needed for a data-only change.**

## Invariants / gotchas
- **Trading capital is excluded from net worth** (`STATIC.algo`) — it's not
  marked-to-market daily; only the owner's *share* of P&L is shown.
- **Never mutate the curated ledger from the live plane** — the reconcile overlays; the
  ledger stays authoritative for cost basis/history.
- **Never read the private-data exports at module-eval** — `app/portfolio.js` /
  `app/lib/appData.js` containers are empty until the render gate hydrates them.
- **The Indian sleeve is a drift-check, not value-driven** (its qty already reflects corp
  actions via `applyCorpActions`), while SWING is broker-driven. Mixing those
  double-counts.
- **Broker APIs are intraday-only** for trades/positions — historical realised P&L isn't
  in the API, hence the daily-accumulating ledgers ([data/trades-log.json](data/trades-log.json),
  [data/fno-ledger.json](data/fno-ledger.json)).
- All files are `.js` (no TypeScript). Tab components must stay pure (no fetching).

## Local development
```bash
npm install
npm run dev      # http://localhost:3000
npm test         # vitest (app/lib math/format)
npm run build    # production build
```
> Local dev reads `data/portfolio.private.json` (gitignored). Without it **and** without
> KV creds, `/api/portfolio` returns 503 — copy `data/portfolio.private.example.json`,
> fill it, and seed. Yahoo endpoints must be reachable from wherever the server runs; in
> sandboxed/network-restricted environments live fetches may return per-symbol errors —
> the UI still renders.

## Deploy (Vercel)
Zero-config Next.js (framework auto-detected). Push to `main` → Vercel rebuilds. The repo
is private with deployment protection.

- Set the project's KV/Upstash env so the live private data resolves:
  `KV_REST_API_URL`/`KV_REST_API_TOKEN` **or** `UPSTASH_REDIS_REST_URL`/`UPSTASH_REDIS_REST_TOKEN`.
  Seed it once: `node scripts/seed-portfolio-kv.mjs`.
- The FII/DII server trail uses the same store and a daily cron (`vercel.json`,
  `30 0 * * *` UTC ≈ 06:00 IST). Without a store, the trail falls back to per-browser
  `localStorage` and still works.

## The quotes API (example)
```
GET /api/quotes?symbols=COFORGE.NS,AAPL,INR=X
```
```json
{
  "fetchedAt": "2026-06-05T20:00:00.000Z",
  "count": 3,
  "quotes": {
    "AAPL":       { "price": 201.5, "prevClose": 200.0, "change": 1.5, "pct": 0.75, "state": "REGULAR", "currency": "USD" },
    "COFORGE.NS": { "price": 1450.0, "prevClose": 1440.0, "change": 10, "pct": 0.69, "state": "CLOSED", "currency": "INR" },
    "INR=X":      { "price": 87.9, "prevClose": 87.8, "change": 0.1, "pct": 0.11, "state": "REGULAR", "currency": "INR" }
  }
}
```
NSE symbols use the `.NS` suffix; USD/INR uses `INR=X`. Each symbol is fetched
independently with a `query1` → `query2` host fallback, an 8s timeout, and a browser
User-Agent; a failed symbol returns `{ "error": "…" }` instead of failing the response.
CDN-cached 60s (`stale-while-revalidate`).

## Where things live (quick map)
| Concern | File(s) |
|---|---|
| Root state + all derivations + tab routing | [app/page.js](app/page.js) |
| Curated ledger logic + hydrated containers | [app/portfolio.js](app/portfolio.js), [app/lib/appData.js](app/lib/appData.js) |
| Private-data loader (KV → local JSON) | [app/lib/serverPortfolio.js](app/lib/serverPortfolio.js) |
| Tab renderers (pure) | [app/components/tabs/](app/components/tabs/) |
| Shared UI (charts, badges, tables) | [app/components/shared/](app/components/shared/) |
| Pure math + formatting + market/theme helpers | [app/lib/](app/lib/) |
| Server proxies | [app/api/](app/api/) |
| Committed data snapshots | [data/](data/) |
| Broker MCP servers (Python) | [mcp/](mcp/) |
| Sync engine + cloud/laptop capture | [scripts/sync-brokers.mjs](scripts/sync-brokers.mjs), [scripts/lib/](scripts/lib/) |
| Scheduled-job catalog | [SCHEDULE.md](SCHEDULE.md) |
