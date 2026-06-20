# Repo Prune + .claude Reshape (2026-06-21)

Goal: cut the tree to fruit + flowers. `.claude` was 333/484 tracked files
(11 MB, mostly generic design-skill bundles). Reshape it to the lean guide and
prune dead wood. **Destructive steps are PREPARED, NOT executed — review then run.**

## Done (additive, already on disk — untracked)
- [x] Built lean `.claude` structure:
  - agents/ — reviewer, debugger, test-writer, refactorer, doc-writer, security-auditor
  - commands/ — fix-issue, deploy, pr-review
  - hooks/ — pre-commit.sh, lint-on-save.sh
  - rules/ — frontend, data (guide's "database"; no SQL DB here), api
  - skills/ — frontend-design (new, project-tuned) + council (kept)
- [x] Verified orphans: `data/nifty50.js`, `data/vested_vests.json` — zero refs.
- [x] Verified `design/` = only `previews/`.

## EXECUTED 2026-06-21 (staged, NOT committed)
- 484 → **119 tracked files** (365 staged deletions + CLAUDE.md/README.md mods). Build ✓, tests 10/10 ✓.
- README.md ← consolidated from docs/OVERVIEW.md (deleted) + corrected ops sections.
- rules/ merged into CLAUDE.md (§ Project Rules); `.claude/rules/` dropped.
- Generic design skills + impeccable agent removed; kept `council` + new `frontend-design`.
- design/, .planning/ removed; untracked scripts/*.png + scripts/signals/ deleted.
- **CORRECTION:** `data/nifty50.js` was NOT an orphan (imported by `app/api/nifty50/route.js`)
  — my verify grep wrongly excluded that file; restored. Only `data/vested_vests.json` removed.
- New lean `.claude/{agents,commands,hooks,skills/frontend-design}` exist on disk but are
  **UNTRACKED** — `/.claude/` is gitignored (line 13). Tracking decision pending (settings.json).

## Commands run (record)

### 1. Strip the generic design-skill pile (~11 MB, ~325 files). Keep council + frontend-design.
```
git rm -r .claude/skills/animate .claude/skills/banner-design .claude/skills/brand \
  .claude/skills/brandkit .claude/skills/design .claude/skills/design-system \
  .claude/skills/design-taste-frontend .claude/skills/emil-design-eng \
  .claude/skills/full-output-enforcement .claude/skills/high-end-visual-design \
  .claude/skills/image-to-code .claude/skills/imagegen-frontend-mobile \
  .claude/skills/imagegen-frontend-web .claude/skills/impeccable \
  .claude/skills/industrial-brutalist-ui .claude/skills/minimalist-ui \
  .claude/skills/redesign-existing-projects .claude/skills/slides \
  .claude/skills/stitch-design-taste .claude/skills/ui-styling \
  .claude/skills/ui-ux-pro-max \
  .claude/agents/impeccable-manual-edit-applier.md
```
- Removes from disk too. To keep a LOCAL copy but untrack, append `--cached` to the line
  and add the paths to `.gitignore`. To keep any globally, first copy to `~/.claude/skills/`.

### 2. Stale planning docs (superseded by docs/OVERVIEW.md, which says so).
```
git rm -r .planning
```

### 3. One-off theme/font mockups (not referenced by app or build).
```
git rm -r design
```

### 4. Orphan data files (confirmed zero refs).
```
git rm data/nifty50.js data/vested_vests.json
```

### 5. Untracked junk (not in git — just delete from disk).
```
rm -f scripts/*.png && rm -rf scripts/signals
```

### 6. Stage the new lean .claude.
```
git add .claude/agents .claude/commands .claude/hooks .claude/rules .claude/skills/frontend-design
```

Then review `git status`, commit (footer: `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`).

## Decide (genuine conflicts with the guide)
- **settings.json** — your guide lists it, but `.claude/settings.json` is GITIGNORED
  (correct: it's local/secret-bearing). Hooks here won't auto-wire from it. Wire pre-commit
  via `.git/hooks/` (see file header) or commit a non-secret settings.json if you want it shared.
- **rules vs CLAUDE.md** — CLAUDE.md is already the brain; the new rules/ are scoped, thinner
  restatements. Fine to keep both, but don't let them drift apart.
- **Stale package.json** — name `networth-tracker`, desc mentions "Yahoo Finance"; update if you care.

---

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
