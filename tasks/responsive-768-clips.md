# Task — pre-existing `004` clips at @768 (tablet) on indian / fd / mf / us tabs

`audit/responsive/certify.mjs` reports per-element `004` clips at the **768** breakpoint on
the **indian, fd, mf, us** tabs (both themes). These FAIL the house pass criterion
(`001/002/004 = 0` at all 6 widths × both themes). `docOverflow = 0` throughout, and the
Overview tab is clean — so these are localized element clips, not page overflow.

## Confirmed pre-existing (NOT from the Growth-view work)
`git diff --name-only b80054a~1..HEAD` (the entire growth/projection feature) touched only:
`app/api/growth`, `app/api/history`, `ProjectionTab.js`, `GrowthView.js`, `app/lib/deposits.js`,
`app/lib/projection.js`, `app/lib/yahooHistory.js`, `tasks/*`. **No `globals.css` change and
none of IndianTab/FDTab/MFTab/USTab** — so these tabs' DOM/CSS are byte-identical to before
the feature. The clips predate it (or are data-driven via the daemon-rewritten fixtures).

## Observed (run `node audit/responsive/certify.mjs`)
Normal mode — `004` offenders, all @768:
- day/indian @768 = 4 · night/indian @768 = 1
- day/fd @768 = 3 · night/fd @768 = 3
(Overview @768 = 0 both themes.) Summary: `clippedMax 004=4`.

STRESSHARD (`STRESSHARD=1 …`) is the unbreakable-token torture probe — it breaks broadly
(indian/us @768 = 7, mf = 5, even day/overview @768 = 2); that's expected for any text
container and is NOT the merge gate. The gate is the plain run.

## To do
1. Identify the clipped elements at 768 on each tab (certify logs counts, not selectors —
   add a verbose/selector dump, or inspect each tab at 768 in the browser).
2. Fix the element-level clipping (likely a min-width/nowrap on a holdings-table cell,
   benchmark bar, or stat chip) so `004 = 0` at 768 on these tabs.
3. Re-cert: plain `certify.mjs` must show `001/002/004 = 0` and `docOverflow = 0` across all
   6 widths × both themes. Re-cert after any data/ledger sync (normal mode reads live DOM).

## Notes
- 768 is in scope (tablet); phone (<768) is known-broken / out of scope.
- Don't remove `html{overflow-x:hidden}` (globals.css:260) as part of this — see the BLOCKING
  item in `audit/responsive/PHASE2.md`.
