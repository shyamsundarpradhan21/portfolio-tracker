---
last_mapped_commit: f327769e7739847e5a4fcf5cf032f6f21df3dc7a
---

# Technology Stack

**Analysis Date:** 2026-06-11

## Languages

**Primary:**
- JavaScript (ES2022+) — all application code: Next.js pages, API routes, React components, utilities
  - No TypeScript; plain `.js` files throughout `app/`

**Secondary:**
- CSS — global design-token stylesheet at `app/globals.css`
- HTML — static design preview files in `design/previews/`

## Runtime

**Environment:**
- Node.js 22.22.2 (detected from system node; no `.nvmrc` or `.node-version` present)

**Package Manager:**
- npm
- Lockfile: `package-lock.json` present (lockfileVersion 3)

## Frameworks

**Core:**
- Next.js 14.2.5 — full-stack React framework; App Router, Server Components, Route Handlers
- React 18.3.1 — UI library
- React DOM 18.3.1 — DOM renderer

**Build/Dev:**
- `next dev` — development server
- `next build` / `next start` — production build and server
- `next lint` — ESLint via Next.js built-in config
- Config: `next.config.mjs` — minimal, `reactStrictMode: true` only

## Key Dependencies

**Critical:**
- `@anthropic-ai/sdk` ^0.101.0 — Anthropic Claude API client; used in `app/api/insights/route.js` to call `claude-haiku-4-5` for AI portfolio insights. Requires `ANTHROPIC_API_KEY` env var.
- `echarts` ^5.5.0 — Apache ECharts charting library; used client-side for sunburst, treemap, and history curve charts. Loaded directly (no React wrapper). See `app/components/SunburstMix.js`, `app/components/shared/TreeMap.js`, `app/components/shared/HistoryCurve.js`.

**Infrastructure:**
- `@vercel/analytics` ^2.0.1 — Vercel Web Analytics (`<Analytics />` component in `app/layout.js`). No opt-in logic; always active.
- `@vercel/speed-insights` ^2.0.0 — Vercel Speed Insights (`<SpeedInsights />` component in `app/layout.js`).

**Dev-only:**
- `puppeteer` ^25.1.0 — headless Chromium; used by `scripts/snapshot-tabs.js` to capture tab screenshots + styled HTML for design review. Not bundled into the app.

## Configuration

**Environment:**
- No `.env` file committed; secrets passed via Vercel environment variables
- Required: `ANTHROPIC_API_KEY` (Claude API — insights degrade gracefully to `null` without it)
- No other required env vars detected; Yahoo Finance and AMFI API calls are unauthenticated

**Build:**
- `next.config.mjs` — ESM format, `reactStrictMode: true`, no custom webpack or rewrites
- `vercel.json` — declares `framework: nextjs`, `buildCommand: next build`; disables auto-deploy on `claude/wonderful-wright-lyx1nd` branch

## Fonts

Loaded via `next/font/google` (zero-layout-shift, self-hosted at build time):
- `Source_Sans_3` — body text (`--font-body` CSS variable)
- `Playfair_Display` — display/title text (`--font-title`)
- `JetBrains_Mono` — monospace/numeric values (`--font-mono`)

Subsets: `latin` + `latin-ext` (required for ₹ rupee sign U+20B9).

## Platform Requirements

**Development:**
- Node.js 22+ (no explicit minimum enforced; 22.22.2 in use)
- npm for package management
- Run `npm run dev` to start dev server

**Production:**
- Vercel (configured via `vercel.json`)
- Serverless Node.js runtime for all API routes (each route declares `export const runtime = 'nodejs'`)
- CDN caching via `Cache-Control` headers set in route responses

---

*Stack analysis: 2026-06-11*
