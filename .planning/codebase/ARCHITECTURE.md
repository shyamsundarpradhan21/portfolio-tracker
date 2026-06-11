---
last_mapped_commit: f327769e7739847e5a4fcf5cf032f6f21df3dc7a
---

<!-- refreshed: 2026-06-11 -->
# Architecture

**Analysis Date:** 2026-06-11

## System Overview

```text
┌──────────────────────────────────────────────────────────────────────┐
│                      Browser (Client Layer)                          │
│                   `app/page.js` — 'use client'                       │
│                                                                      │
│  State: prices, usdInr, mfNav, hist, insights, snapshots, tab        │
│  Derived: indian, usData, swing, mf, fds, ov (useMemo chains)        │
│                                                                      │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │
│  │OverviewTab│ │IndianTab │ │  FDTab   │ │  MFTab   │ │  USTab   │  │
│  │`tabs/`   │ │`tabs/`   │ │`tabs/`   │ │`tabs/`   │ │`tabs/`   │  │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │
└─────────────────────────────┬────────────────────────────────────────┘
                              │ fetch /api/*
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│                  Next.js API Routes (Server Layer)                   │
│                                                                      │
│  /api/quotes      — Yahoo Finance v8 chart proxy (live prices)       │
│  /api/history     — Yahoo Finance weekly series (5y benchmark data)  │
│  /api/fx-history  — USD/INR daily closes (backfill FX conversion)    │
│  /api/mf-nav      — AMFI mfapi.in NAV resolver (24h cached)          │
│  /api/insights    — Anthropic Claude Haiku (AI portfolio analysis)   │
└─────────────────────────────┬────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────────────┐
│  External Data Sources                                               │
│  Yahoo Finance v8 API · AMFI mfapi.in · Anthropic API               │
└──────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| Page | Root state machine, data fetching, all `useMemo` derivations, tab routing | `app/page.js` |
| portfolio.js | Static ledger — cost basis, holdings, FD ladder, loan schedule, cashflows | `app/portfolio.js` |
| OverviewTab | Net worth summary, history curve, projection, capital deployment, tax memo | `app/components/tabs/OverviewTab.js` |
| IndianTab | NSE holdings table, SWOT, sector/cap breakdown, benchmarks, realized P&L | `app/components/tabs/IndianTab.js` |
| FDTab | FD ladder, maturity timeline, pipeline calendar | `app/components/tabs/FDTab.js` |
| MFTab | Mutual fund NAVs, XIRR vs benchmark, cap allocation | `app/components/tabs/MFTab.js` |
| USTab | US holdings table, sector (ETF look-through), realized P&L, dividends | `app/components/tabs/USTab.js` |
| AlgoTab | Algo capital tracking, swing book, YTD F&O P&L, carryforward pool | `app/components/tabs/AlgoTab.js` |
| calc.js | Pure math: XIRR (Newton-Raphson + bisection), CAGR, beta/vol, compounding | `app/lib/calc.js` |
| fmt.js | INR/USD formatters, color helpers, date helpers | `app/lib/fmt.js` |
| market.js | Market open detection (NSE/NYSE wall-clock + Yahoo marketState) | `app/lib/market.js` |
| snapshots.js | localStorage daily NW snapshots (read/write) | `app/lib/snapshots.js` |
| backfill.js | Synthetic pre-snapshot history reconstruction from dated ledgers | `app/lib/backfill.js` |
| suntimes.js | Sunrise/sunset computation for auto day/night theme | `app/lib/suntimes.js` |
| constants.js | ETF look-through sector maps, cap classifications | `app/lib/constants.js` |

## Pattern Overview

**Overall:** Single-page React application with server-side API proxies.

**Key Characteristics:**
- All portfolio state and derived computations live in one root component (`app/page.js`)
- Static ledger data (`app/portfolio.js`) is the single source of truth for cost basis — live prices layer on top
- Tab components are pure renderers: they receive fully derived props from the page, never fetch data themselves
- API routes act as thin proxies — no server-side persistence; they forward to Yahoo Finance / AMFI / Anthropic
- Client-side caching via `sessionStorage` (prices, MF nav, history) and `localStorage` (insights, daily NW snapshots, theme preference)

## Layers

**Static Ledger Layer:**
- Purpose: Authoritative cost-basis data for all five investment sleeves
- Location: `app/portfolio.js`
- Contains: `INDIAN`, `US`, `FDS`, `MF_FUNDS`, `SWING`, `TRANSACTIONS`, `US_CASHFLOWS`, `MF_CASHFLOWS`, `LOAN`, `ALGO`, `PROJECTION`, and related constants
- Depends on: Nothing (pure JS objects/functions)
- Used by: `app/page.js` (imports all), `app/api/mf-nav/route.js` (imports `MF_FUNDS`, `MF_BENCHMARK`, `MF_CASHFLOWS`)

**Client State + Derivation Layer:**
- Purpose: Fetch live prices, merge with ledger, compute all display values
- Location: `app/page.js`
- Contains: All `useState`/`useEffect`/`useMemo` hooks; pure derivation functions `deriveMf`, `deriveFds`, `mfXirr` defined at module scope
- Depends on: `app/portfolio.js`, `app/lib/*`, `data/*.json`
- Used by: Tab components (props passed down)

**UI / Tab Layer:**
- Purpose: Present one investment sleeve per tab; purely presentational
- Location: `app/components/tabs/*.js`, `app/components/shared/*.js`, `app/components/InsightsCard.js`, `app/components/ProjectionTab.js`, `app/components/RealizedPanel.js`, `app/components/SunburstMix.js`
- Contains: JSX renderers, local sort state in some tabs
- Depends on: `app/lib/fmt.js`, `app/lib/calc.js`, shared components
- Used by: `app/page.js`

**API / Server Layer:**
- Purpose: Proxy external APIs (CORS avoidance, UA spoofing, key protection)
- Location: `app/api/*/route.js`
- Contains: Five Next.js Route Handlers; all use `runtime = 'nodejs'`
- Depends on: Yahoo Finance v8, AMFI mfapi.in, Anthropic SDK
- Used by: `app/page.js` via `fetch('/api/*')`

**Pure Library Layer:**
- Purpose: Reusable computation and formatting helpers
- Location: `app/lib/*.js`
- Contains: `calc.js` (XIRR, CAGR, beta, compounding), `fmt.js` (currency formatters), `market.js`, `snapshots.js`, `backfill.js`, `suntimes.js`, `constants.js`
- Depends on: Nothing external
- Used by: `app/page.js`, tab components

## Data Flow

### Primary Request Path (price refresh)

1. `doRefresh()` called on mount / 15-min timer (`app/page.js:260`)
2. Parallel `fetch('/api/quotes?symbols=...')` for Indian + US symbols (`app/page.js:264`)
3. `app/api/quotes/route.js` fans out to Yahoo Finance v8 chart API with spoofed UA, host failover (`app/api/quotes/route.js:22`)
4. Merged `prices` map written to `setPrices` state + `sessionStorage` cache (`app/page.js:273–280`)
5. `useMemo` chains recompute: `indian → inStats → indianRisk → indianDay`, `usData → usStats`, `swing`, `mf → mfx`, `fds`, `ov` (`app/page.js:310–482`)
6. Tab components re-render with new derived props

### AI Insights Path

1. `requestInsights()` bumps `insightsReq` counter (`app/page.js:220`)
2. `useEffect([insightsReq])` builds compact summary strings from derived state (~500 tokens) (`app/page.js:494`)
3. Coarse hash check against `localStorage` — skips API call if data unchanged (`app/page.js:537–547`)
4. `POST /api/insights` with payload (`app/page.js:554`)
5. `app/api/insights/route.js` calls Anthropic Claude Haiku 4.5 with structured JSON output schema (`app/api/insights/route.js:147`)
6. Response written to `insights` state + `localStorage` for cross-session persistence

### Historical Backfill Path

1. `useEffect` on mount fetches `/api/history` (5y weekly) and `/api/fx-history` (USD/INR daily) (`app/page.js:254–607`)
2. `buildBackfill(hist.series, fxHist, usdInr)` reconstructs synthetic weekly NW snapshots from ledger dates (`app/lib/backfill.js`)
3. Synthetic snapshots merged with real localStorage snapshots in `chartSnapshots` (`app/page.js:608–613`)
4. Real daily snapshots win from their first date onward

**State Management:**
- No global state library (no Redux/Zustand/Context)
- All application state held in `app/page.js` via `useState`/`useRef`
- Client persistence: `sessionStorage` for prices/nav/history (session-scoped), `localStorage` for insights/snapshots/theme (cross-session)
- No server-side persistence

## Key Abstractions

**Static Ledger (`portfolio.js`):**
- Purpose: Immutable source of truth for cost basis, holdings, and cashflow schedules
- Examples: `INDIAN`, `US`, `FDS`, `MF_FUNDS`, `TRANSACTIONS`, `US_CASHFLOWS`, `MF_CASHFLOWS`
- Pattern: Plain JS arrays/objects exported as named constants; `loanOutstanding()` is the only function computing live state from the ledger

**deriveMf / deriveFds (module-scope pure functions):**
- Purpose: Compute full sleeve state from ledger + live inputs; called inside `useMemo`
- Location: `app/page.js:43` (`deriveMf`), `app/page.js:71` (`deriveFds`)
- Pattern: Pure functions taking minimal inputs, returning display-ready object trees

**Benchmark Counterfactual:**
- Purpose: Answer "what would cost-basis cashflows be worth if invested in index X?"
- Location: `app/lib/calc.js` (`benchCounterfactual`)
- Pattern: Replay each dated cashflow at the index series NAV, compute XIRR on terminal value

**Route Handler Proxies:**
- Purpose: Avoid CORS, protect API keys, add caching headers
- Location: `app/api/*/route.js`
- Pattern: `runtime = 'nodejs'`, fetch external API with UA header, transform JSON, return `Response.json()` with `Cache-Control`

## Entry Points

**Root Layout:**
- Location: `app/layout.js`
- Triggers: Every page render
- Responsibilities: Google Font loading (`Source_Sans_3`, `Playfair_Display`, `JetBrains_Mono`), Vercel Analytics + SpeedInsights, inline FOUC-prevention script for day/night theme

**Main Page:**
- Location: `app/page.js`
- Triggers: Browser navigation to `/`
- Responsibilities: All data fetching, state management, derivations, tab rendering

**API Routes:**
- `app/api/quotes/route.js` — `GET /api/quotes?symbols=...`
- `app/api/history/route.js` — `GET /api/history?range=5y&symbols=...`
- `app/api/fx-history/route.js` — `GET /api/fx-history?start=YYYY-MM-DD`
- `app/api/mf-nav/route.js` — `GET /api/mf-nav` (24h cached)
- `app/api/insights/route.js` — `POST /api/insights`

## Architectural Constraints

- **Threading:** Single-threaded browser event loop; all async work via `Promise.all` in `doRefresh`; no Web Workers
- **Global state:** None — all state is local to `app/page.js`; `app/lib/snapshots.js` uses `localStorage` directly (browser-only)
- **Circular imports:** None detected; the dependency graph is strictly hierarchical (page → portfolio, lib; tabs → lib only)
- **No server persistence:** History is per-browser via localStorage; cross-device sync would require adding a backend store at the `getSnapshots`/`recordSnapshot` seam in `app/lib/snapshots.js`
- **Algo capital excluded from NW:** `STATIC.algo` is deliberately kept off net-worth totals and the projection model — tracked only on the Algo tab header card

## Anti-Patterns

### Deriving state outside useMemo

**What happens:** `deriveMf` and `deriveFds` are defined as module-scope functions then called inside `useMemo` in `page.js`. Some inline derivations in `page.js` (e.g., `ytdRealised`, `cfEntering`) are computed directly on each render without memoization.
**Why it's wrong:** Inline computations on every render are fine for scalar values but could be expensive for arrays.
**Do this instead:** Keep scalar derivations inline; wrap array-heavy derivations in `useMemo` as already done for `indian`, `usData`, `mf`, `fds`.

### Tab components with local sort state duplicated across tabs

**What happens:** Sort state (`inSort`, `usSort`, `mfSort`, `swSort`) is all managed in `page.js` and passed as props along with sort handlers.
**Why it's wrong:** Requires threading four sort states through props; tabs cannot own their own sort state independently.
**Do this instead:** Move per-tab sort state and sorted arrays into the tab component itself; pass only the raw rows.

## Error Handling

**Strategy:** Defensive degradation — all async failures log to `status` state and allow the UI to render with stale or partial data.

**Patterns:**
- `doRefresh` wraps all fetches in `try/catch`; on error sets `status.type = 'err'` (`app/page.js:282`)
- API routes return `{ error: ... }` per symbol on Yahoo failures rather than aborting the batch
- `app/api/insights/route.js` returns `{ insights: EMPTY }` (all-null) on Anthropic failure so the dashboard renders without banners
- `app/api/mf-nav/route.js` falls back to `casNav` (CAS statement NAV) on any AMFI resolution failure
- `app/lib/calc.js` `xirr()` returns `null` (not throws) when convergence fails

## Cross-Cutting Concerns

**Logging:** `console.warn`/`console.error` only; no structured logging framework
**Validation:** Input validation at API route level (symbol count cap at 60, date format regex); no runtime schema validation on client
**Authentication:** None — single-owner personal dashboard, no auth layer
**Caching:** Two-tier: CDN/Vercel edge (via `Cache-Control` headers on API routes) + client-side `sessionStorage`/`localStorage`

---

*Architecture analysis: 2026-06-11*
