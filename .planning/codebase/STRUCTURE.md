---
last_mapped_commit: f327769e7739847e5a4fcf5cf032f6f21df3dc7a
---

# Codebase Structure

**Analysis Date:** 2026-06-11

## Directory Layout

```
portfolio-tracker/
├── app/                    # Next.js App Router root
│   ├── layout.js           # Root layout: fonts, Vercel analytics, FOUC script
│   ├── page.js             # Main page: all state, fetching, derivations, tab routing
│   ├── portfolio.js        # Static ledger: holdings, FDs, loan, MF funds, constants
│   ├── globals.css         # Global CSS: custom properties, layout, theme variables
│   ├── api/                # Next.js Route Handlers (server-side proxies)
│   │   ├── quotes/         # GET /api/quotes — Yahoo Finance live price proxy
│   │   ├── history/        # GET /api/history — Yahoo Finance weekly series proxy
│   │   ├── fx-history/     # GET /api/fx-history — USD/INR historical closes
│   │   ├── mf-nav/         # GET /api/mf-nav — AMFI mutual fund NAV resolver
│   │   └── insights/       # POST /api/insights — Anthropic Claude Haiku analysis
│   ├── components/
│   │   ├── tabs/           # One component per investment tab (full-width panels)
│   │   │   ├── OverviewTab.js
│   │   │   ├── IndianTab.js
│   │   │   ├── FDTab.js
│   │   │   ├── MFTab.js
│   │   │   ├── USTab.js
│   │   │   └── AlgoTab.js
│   │   ├── shared/         # Reusable sub-components (used across multiple tabs)
│   │   │   ├── BrokerTable.js
│   │   │   ├── CFMemo.js
│   │   │   ├── FreshnessTag.js
│   │   │   ├── HistoryCurve.js
│   │   │   ├── InsightBanner.js
│   │   │   ├── SipCard.js
│   │   │   ├── Skel.js
│   │   │   ├── TreeMap.js
│   │   │   └── YtdFno.js
│   │   ├── InsightsCard.js     # AI insights card (tab-level wrapper)
│   │   ├── ProjectionTab.js    # Forward NW projection (used in OverviewTab)
│   │   ├── RealizedPanel.js    # Realized P&L panel (used in Indian/US tabs)
│   │   └── SunburstMix.js      # Sunburst allocation chart
│   └── lib/                # Pure helpers — no React, no external state
│       ├── calc.js         # XIRR, CAGR, beta/vol, compounding, bench counterfactual
│       ├── fmt.js          # INR/USD formatters, color helpers, date helpers
│       ├── market.js       # NSE/NYSE open detection from wall-clock + Yahoo state
│       ├── snapshots.js    # localStorage daily NW snapshot read/write
│       ├── backfill.js     # Synthetic pre-snapshot history from dated ledgers
│       ├── suntimes.js     # Sunrise/sunset for auto day/night theme
│       └── constants.js    # ETF sector look-through maps, US cap classifications
├── data/                   # Static JSON data files (committed, not generated)
│   ├── fy2526_verified.json    # ITR-verified FY25-26 / FY26-27 F&O P&L data
│   ├── us_trades.json          # Vested/DriveWealth US trade ledger (for backfill)
│   └── indian_exits.json       # Exited Indian position history (for backfill)
├── scripts/
│   └── snapshot-tabs.js    # Dev utility: capture browser tab screenshots
├── design/                 # Design assets (not consumed by the app at runtime)
│   └── previews/fonts/
├── .claude/skills/         # Project AI skills (design, UI, brand tooling)
├── .planning/codebase/     # Architecture documents (this directory)
├── next.config.mjs         # Minimal Next.js config (reactStrictMode only)
├── vercel.json             # Vercel deployment config
├── package.json
└── package-lock.json
```

## Directory Purposes

**`app/`:**
- Purpose: Entire Next.js App Router application
- Contains: Page, layout, API routes, components, lib helpers
- Key files: `app/page.js` (root component), `app/portfolio.js` (static ledger)

**`app/api/`:**
- Purpose: Server-side API proxies — each subdirectory is one Route Handler
- Contains: One `route.js` per endpoint; all use `runtime = 'nodejs'`
- Key files: `app/api/quotes/route.js`, `app/api/insights/route.js`

**`app/components/tabs/`:**
- Purpose: One full-panel component per investment tab, rendered by `app/page.js`
- Contains: Six tab components covering Overview, Indian Equity, Fixed Deposits, Mutual Funds, US Equity, Algo
- Key constraint: Tab components are **purely presentational** — they receive derived props from `page.js` and do not fetch data

**`app/components/shared/`:**
- Purpose: Reusable sub-components used across multiple tabs
- Contains: Charts (`HistoryCurve`, `TreeMap`, `SunburstMix`), UI primitives (`Skel`, `FreshnessTag`, `InsightBanner`), data panels (`BrokerTable`, `CFMemo`, `SipCard`, `YtdFno`)

**`app/lib/`:**
- Purpose: Pure utility modules — no React hooks, no external imports beyond `portfolio.js` for `backfill.js`
- Contains: Math helpers, formatters, browser storage, market-status logic
- Key constraint: Files in `lib/` must not import from `components/`; `snapshots.js` and `backfill.js` are marked `'use client'` because they access browser APIs

**`data/`:**
- Purpose: Static JSON snapshots sourced from broker exports (Vested DriveWealth, Zerodha tradebook)
- Contains: `fy2526_verified.json` (F&O P&L, carryforward), `us_trades.json` (US trade ledger for backfill), `indian_exits.json` (exited Indian positions for backfill)
- Generated: No — manually maintained from broker statements
- Committed: Yes

## Key File Locations

**Entry Points:**
- `app/layout.js`: Root HTML shell, fonts, analytics
- `app/page.js`: Application entry point (single-page app)

**Static Data / Ledger:**
- `app/portfolio.js`: All cost basis, holdings arrays, loan schedule, projection config
- `data/fy2526_verified.json`: F&O P&L imported as `FY` in `page.js`
- `data/us_trades.json`: US trade ledger used by `app/lib/backfill.js`
- `data/indian_exits.json`: Exited Indian positions used by `app/lib/backfill.js`

**API Proxies:**
- `app/api/quotes/route.js`: Live price batch fetch (Yahoo Finance)
- `app/api/mf-nav/route.js`: Daily NAV fetch + AMFI scheme resolution (24h cached)
- `app/api/history/route.js`: 5-year weekly benchmark series
- `app/api/fx-history/route.js`: USD/INR historical daily closes
- `app/api/insights/route.js`: AI analysis via Anthropic Claude Haiku

**Core Logic:**
- `app/lib/calc.js`: XIRR, CAGR, beta, bench counterfactual
- `app/lib/fmt.js`: All formatting functions (INR/USD display)
- `app/lib/snapshots.js`: NW snapshot persistence (localStorage seam)
- `app/lib/backfill.js`: Synthetic historical NW reconstruction

**Styling:**
- `app/globals.css`: CSS custom properties (design tokens), layout rules, day/night theme via `data-time` attribute on `<html>`

## Naming Conventions

**Files:**
- PascalCase for React components: `OverviewTab.js`, `InsightBanner.js`, `BrokerTable.js`
- camelCase for lib/utility modules: `calc.js`, `fmt.js`, `snapshots.js`, `backfill.js`
- kebab-case for API route directories: `fx-history/`, `mf-nav/`
- All files are `.js` (no TypeScript in this project)

**Directories:**
- Lowercase: `tabs/`, `shared/`, `lib/`, `api/`, `data/`

**Exports (portfolio.js):**
- `SCREAMING_SNAKE_CASE` for constants and arrays: `INDIAN`, `US`, `FDS`, `MF_FUNDS`, `PROJECTION`
- PascalCase for classes/objects with methods: `LOAN` (object with `loanOutstanding` function)
- Camel-prefixed for derived export functions: `loanOutstanding`, `fdFlows`, `fdRedemptions`

**React components:**
- PascalCase function names matching the filename
- Props are camelCase

## Where to Add New Code

**New investment sleeve (e.g., crypto direct holdings):**
- Add ledger data to `app/portfolio.js` (new array + cashflow constant)
- Add derivation logic inline in `app/page.js` (new `useMemo`)
- Add a new tab component to `app/components/tabs/NewTab.js`
- Register in the `TAB_KEYS` array and `tab === N` conditional block in `app/page.js`
- Add a header card to the `headerCards` array in `app/page.js`

**New API endpoint:**
- Create `app/api/<endpoint-name>/route.js`
- Follow the existing pattern: `export const runtime = 'nodejs'`, `export const dynamic = 'force-dynamic'`, export named `GET` or `POST` function

**New calculation / financial metric:**
- Add pure function to `app/lib/calc.js`
- No React, no imports beyond standard JS

**New shared UI component:**
- Add to `app/components/shared/NewComponent.js`
- Add `'use client'` directive at top
- Accept all data as props (never fetch from within)

**New formatting helper:**
- Add to `app/lib/fmt.js`

**New static data file:**
- Add to `data/` as `.json`
- Import directly in the file that needs it (e.g., `import DATA from '../../data/new.json'`)

**Updating the ledger:**
- Edit `app/portfolio.js` — the single source of truth for all cost basis
- After adding/removing holdings, check that `TRANSACTIONS` (Indian), `US_CASHFLOWS` (US), and `MF_CASHFLOWS` (MF) stay in sync
- Update `UNITS_AS_OF` constant when MF units change after a SIP installment

## Special Directories

**`.planning/codebase/`:**
- Purpose: Architecture reference documents for GSD planning commands
- Generated: No (written by mapping agents)
- Committed: Yes

**`.claude/skills/`:**
- Purpose: Project-level AI skill definitions for UI styling, design, branding
- Generated: No
- Committed: Yes

**`.next/`:**
- Purpose: Next.js build cache and output
- Generated: Yes
- Committed: No

**`node_modules/`:**
- Purpose: npm dependencies
- Generated: Yes
- Committed: No

**`design/`:**
- Purpose: Font preview assets and design references; not imported by the app
- Generated: No
- Committed: Yes

---

*Structure analysis: 2026-06-11*
