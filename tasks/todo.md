# KV Pullback — Private Data Out of the Client Bundle

Goal: the private financial data (holdings, salary, contributions, loans) must
not ship in the client JS bundle **or** sit in the committed repo. The deployed
app reads it from Vercel KV at runtime; local dev reads a gitignored JSON.

## Architecture (recommended: client-fetch)

- Source of truth: gitignored `data/portfolio.private.json` (local dev + seed
  source — OUT of repo). KV key `portfolio:v1` holds the same (deployed app —
  OUT of bundle). Committed `data/portfolio.private.example.json` documents shape.
- `app/api/portfolio/route.js` (server-only, not bundled): reads KV; in local
  dev falls back to the gitignored JSON. Reuses the `kvCreds()` pattern from
  `app/api/premarket/route.js` (KV infra already live on Vercel).
- `app/page.js` stays `'use client'`: fetches `/api/portfolio` on mount, gates
  render on it (the app already gates on price loads — same pattern), and the
  module-eval derivations (`SWING_R`, `STATIC.algo`, `SWING.map`) move INSIDE
  the component once data is present.
- Pure lib fns that read private data take it as a param; tab/shared components
  take it as props.

Why client-fetch over server-component SSR: the app is already a client SPA with
loading states; this keeps the static shell + KV-resilience (KV down → shell
still loads) and avoids splitting the 1.4k-line `page.js` across the RSC boundary.

## Blast radius (9 importers of `./portfolio` private data)

- `app/page.js` — biggest: fetch + state + gate + move eval-time derivations in
- `app/lib/cmpf.js` — `cmpfCorpus/cmpfPaid(data, atDate)`
- `app/lib/cmps.js` — `cmps*(data, atDate)` (also the pension fix lands here)
- `app/lib/projection.js` — `deriveProjInputs(data, …)`
- `app/lib/backfill.js` — `buildBackfill(data, …)`
- `app/components/ProjectionTab.js` — PROJECTION, FDS via props
- `app/components/shared/SipCard.js` — flows via props
- `app/components/tabs/MFTab.js` — MF_CASHFLOWS, MF_SIP via props
- `app/api/mf-nav/route.js` — read KV/JSON server-side (not import)
- `app/portfolio.js` — keep LOGIC (loanOutstanding, fdFlows, fdRedemptions,
  algoOwnFactor) + non-private constants (ALLOC_COLORS, CAT_COLORS, CMPF_HATCH,
  FY-derived); drop the private DATA exports.

## Stages (build + `npm test` gate after each)

- [x] Stage 1 (additive, non-regressive): extract private data → gitignored JSON
      (+ .example); `seed-portfolio-kv.mjs`; `/api/portfolio` route. App still
      uses static imports → behaviour unchanged. SHIPPED (137b9ff) — build ✓,
      tests 10/10 ✓, route returns 200 with full 27-key payload ✓.

## Stage 2 execution notes (confirmed by scoping)
- Architecture: runtime HYDRATION (lower risk than threading). portfolio.js
  exports become empty mutable containers filled in place by `hydratePortfolio(d)`
  (idempotent: arrays `len=0;push(...)`, objects `Object.assign`). Captured dump
  holds FINAL values, so NO re-derivation needed in hydrate.
- portfolio.js: 15 arrays (INDIAN, TRANSACTIONS, CORPORATE_ACTIONS,
  INDIAN_BENCHMARKS, US_CASHFLOWS, US_CORP_ACTIONS, US_BENCHMARKS, US, FDS,
  MF_FUNDS, MF_CASHFLOWS, CMPF_CONTRIBUTIONS, CMPS_CONTRIBUTIONS, PAYSLIPS,
  SWING) + 10 objects (INDIAN_REALIZED, US_REALIZED, US_DIVIDENDS, STATIC, LOAN,
  MF_SIP, MF_BENCHMARK, ALGO, CMPF_RATES, PROJECTION). KEEP STATIC: UNITS_AS_OF
  (date), REALIZED_PNL (unused externally), ALLOC_COLORS, CAT_COLORS, CMPF_HATCH,
  and ALL functions. DELETE eval-time derivations: `STATIC.algo = …` (line 464)
  and SWING's `.map` (dump already has the mapped value).
- page.js: rename body → `Dashboard()`; new default `Page()` fetches
  /api/portfolio → hydratePortfolio(d) → gate (render Dashboard only when ready,
  reusing existing loading UX). Move `SWING_R = reconcileSleeve(SWING,…)` (line
  43) INSIDE Dashboard (useMemo). It's the ONLY module-eval private read in page.
- mf-nav route: read KV/JSON server-side (its portfolio import is empty
  server-side — never hydrated there).
- Verify: build + tests + manual smoke of ALL 7 tabs (numbers match pre-refactor).
- [ ] Stage 2 (the switch): page.js fetch+thread; lib fns take data param;
      components take props; mf-nav reads KV; portfolio.js drops private data.
      Verify build + tests + manual smoke of every tab.
- [ ] Stage 3: run the seed once; confirm deployed app reads KV; confirm
      `portfolio.private.json` is gitignored and the bundle no longer contains
      the figures (grep the built chunks).

## Risks
- Runtime KV dependency for first paint (mitigated: client-fetch + graceful
  error; live-price loading gate already exists).
- Subtle regressions from threading — tests + per-tab smoke required.
- Pension fix (cmps.js) folds into Stage 2 once `data` is a param — still needs
  the basic-pay figures from the user.
