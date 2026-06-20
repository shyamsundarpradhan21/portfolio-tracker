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

- [ ] Stage 1 (additive, non-regressive): extract private data → gitignored JSON
      (+ .example); `seed-portfolio-kv.mjs`; `/api/portfolio` route. App still
      uses static imports → behaviour unchanged. Verify build.
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
