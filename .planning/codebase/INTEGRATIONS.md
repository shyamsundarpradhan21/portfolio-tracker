---
last_mapped_commit: f327769e7739847e5a4fcf5cf032f6f21df3dc7a
---

# External Integrations

**Analysis Date:** 2026-06-11

## APIs & External Services

**Market Data — Equities & FX:**
- Yahoo Finance v8 Chart API — live stock/ETF/index prices and FX rates; no API key required
  - Endpoints: `https://query1.finance.yahoo.com/v8/finance/chart/{symbol}` and `https://query2.finance.yahoo.com/v8/finance/chart/{symbol}` (dual-host failover)
  - Used by: `app/api/quotes/route.js` (real-time prices, max 60 symbols), `app/api/history/route.js` (weekly historical closes, 2y range), `app/api/fx-history/route.js` (daily USD/INR historical closes via `INR=X`)
  - Auth: None. Browser-spoofing User-Agent header used to avoid rate-limiting.
  - CDN cache: `s-maxage=60, stale-while-revalidate=300` for quotes; `s-maxage=3600, stale-while-revalidate=86400` for history

**Market Data — Indian Mutual Funds:**
- AMFI / mfapi.in API — mutual fund NAV data; no API key required
  - Endpoints: `https://api.mfapi.in/mf/search?q={name}` (scheme code resolution by name), `https://api.mfapi.in/mf/{code}/latest` (latest NAV), `https://api.mfapi.in/mf/{code}` (full NAV history for benchmark)
  - Used by: `app/api/mf-nav/route.js`
  - Auth: None.
  - CDN cache: `s-maxage=86400, stale-while-revalidate=43200` (NAV publishes once daily ~9–11 PM IST)

**AI / LLM:**
- Anthropic Claude API — portfolio insight generation
  - SDK: `@anthropic-ai/sdk` ^0.101.0
  - Model: `claude-haiku-4-5` (Haiku tier; cheapest, right-sized for 1–2 sentence insights)
  - Auth: `ANTHROPIC_API_KEY` environment variable (set in Vercel project settings)
  - Used by: `app/api/insights/route.js`
  - Structured output (JSON schema) enforced via `output_config.format.type = 'json_schema'`; max_tokens 700
  - Degrades gracefully: returns all-null insights when `ANTHROPIC_API_KEY` is absent

## Data Storage

**Databases:**
- None — no server-side database is used

**Client-side Persistence:**
- Browser `localStorage` — daily net-worth snapshots accumulated over time
  - Key: `nwTracker.snapshots` (capped at 800 entries ~2+ years)
  - Key: `nwTracker.theme` (user's day/night/auto theme preference)
  - Interface: `app/lib/snapshots.js` (`getSnapshots`, `recordSnapshot`)
  - Note: per-browser only; not cross-device. `app/lib/snapshots.js` has a comment identifying this as the seam for a future backend (Vercel KV/Blob) migration.

**Static JSON Data Files:**
- `data/fy2526_verified.json` — FY 2025-26 verified portfolio data
- `data/indian_exits.json` — realized Indian equity exits
- `data/us_trades.json` — US equity trade history
- `app/portfolio.js` — primary holdings master file; imports used by MF NAV and all tab components

**File Storage:**
- Local filesystem only (static data files)

**Caching:**
- Vercel CDN edge cache via `Cache-Control: s-maxage` headers on all API routes
- No Redis or in-memory cache layer

## Authentication & Identity

**Auth Provider:**
- None — no authentication system. This is a personal single-user dashboard with no login.

## Monitoring & Observability

**Analytics:**
- Vercel Web Analytics — `<Analytics />` injected in `app/layout.js` via `@vercel/analytics/next`; always active, no user opt-in

**Performance:**
- Vercel Speed Insights — `<SpeedInsights />` injected in `app/layout.js` via `@vercel/speed-insights/next`; always active

**Error Tracking:**
- None — no Sentry or equivalent. API route errors are returned as JSON with HTTP 200 status (graceful degradation pattern used throughout).

**Logs:**
- `console.log` used in `app/api/history/route.js` for flaky Yahoo ticker failures: `[history] {symbol} unresolved:`
- No structured logging framework

## CI/CD & Deployment

**Hosting:**
- Vercel (configured via `vercel.json`; `framework: nextjs`)

**CI Pipeline:**
- None detected — no GitHub Actions, CircleCI, or other CI config files present

**Deployment Branching:**
- Auto-deploy disabled on `claude/wonderful-wright-lyx1nd` branch (set in `vercel.json` `git.deploymentEnabled`)

## Environment Configuration

**Required env vars:**
- `ANTHROPIC_API_KEY` — Claude API access; insights silently disabled when absent (non-breaking)

**Optional env vars:**
- None detected; Yahoo Finance and AMFI calls are unauthenticated

**Secrets location:**
- Vercel project environment variables (not committed to repo)
- `.env` file: not present in repo

## Webhooks & Callbacks

**Incoming:**
- None

**Outgoing:**
- None; all external calls are client-initiated fetches from API routes

---

*Integration audit: 2026-06-11*
