# Implementation prompt — Algo → Analytics Stratzy-style revamp (mock approved 2026-07-05)

Approved render mock: `public/mock-analytics-revamp.html` (delete it in the final commit).
Scope: render-layer revamp of 4 chart cards in `app/components/shared/AnalyticsTab.js`.
Key Metrics + Efficiency Ratios tables are UNTOUCHED. Build to the mock, not the house
style; translate everything through theme tokens (no hex), both themes must hold.

## Cards

### 1. Best Vs Worst Duration (replaces the current two-line `bwLines` card)
- Render the SELECTED strategy's cumulative TWR curve (existing `cumPath`) in `var(--txt)`
  at ~2.4px, with two shaded vertical bands: worst window `var(--red-bg)`, best window
  `var(--grn-bg)`, each with dashed `var(--txt3)` edge strokes (3 4, opacity .5).
- Band extents come from the existing `bestWorstWindows(cur.series, subWin)` start/end
  dates mapped to x. Keep the legend chips (dashed-border swatches like the mock).
- Axis: month labels along the bottom, 3 % ticks at left — add a tiny shared axis helper
  in the component (the mock's `axes()` translated to JSX).

### 2. Underwater Plot
- Same `cur.dd.curve` data. Fill `var(--gld)` at .22 opacity, stroke `var(--gld)` 2px.
- Horizontal rule at avg drawdown (`cur.dd.avgDD` if that's the mean of the curve —
  otherwise compute mean of curve dd values) in `var(--red)` 1.6px.
- Add the same axis ticks (%, months). Legend: drawdown / avg drawdown.

### 3. Worst 5 Drawdown Periods (replaces the Worst-5 TABLE — user-approved drop)
- Cumulative curve of the selected strategy, stroke `var(--grn)` 2.2px, under-fill a
  vertical gradient `var(--grn)` .28 → 0 (SVG linearGradient; resolve the CSS var at
  runtime for the SVG stops — theme rule).
- Shade each of `cur.episodes.slice(0,5)` as a `var(--red-bg)` band from peakDate →
  (recoveryDate if recovered else last point).
- Hover/tooltip per band: depth (pct1, red), peak→trough dates (existing `fmtD`),
  recovery days or "ongoing". Title attribute is acceptable minimum; an in-SVG tooltip
  matching existing hover patterns is preferred. Tooltip sleeve/label colours follow the
  hover rule in tasks/feedback.md (labels = identity colour, values = direction colour).

### 4. Returns Comparison (NEW card, placed after Efficiency Ratios)
- Chart: S01 (`var(--grn)` 1.6), S02 (`var(--cyn)` 1.6), Overall (`var(--acc)` 2.8 bold),
  NIFTY (`var(--txt3)` 1.4 dashed, .8 opacity) cumulative % over the selected window —
  reuse `cumPath`/`benchPath`.
- Table: rows Overall/S01/S02/NIFTY with a 5×16px colour swatch; columns 1M / 3M / 6M /
  1Y / Max DD. Fixed-horizon returns are computed per row REGARDLESS of the selected
  period pill (they're anchored on the latest ledger day, like `cutMs` today):
  `returnsPct(win(series, horizonDays), cap)` for 30/90/180/365; NIFTY row from
  compounded `niftyRet` over the same date range. Max DD = `drawdown(...).maxDD` over
  Max window (strategy rows) / peak-to-trough of closes (NIFTY row).
- Direction by colour ONLY — no +/− glyphs; Max DD magnitude in red (`uPct`).
- A horizon with insufficient data renders '—'.

## Constraints (binding, from CLAUDE.md / tasks/feedback.md)
- No hardcoded figures/dates/subtexts; sizes via `--fs-*`; no raw px font sizes.
- Direction = colour; the ONLY signed labels allowed are the multi-line chart end-labels
  (`sPct`) where colour = series identity.
- Resolve CSS vars at runtime for any SVG attribute that can't take `var()` (gradient stops).
- Both themes; verify day + night.
- Responsive gate: finish with a green `node audit/responsive/certify.mjs` (all 6 widths ×
  both themes, normal + stress). The new table gets the standard `.an-tblwrap` scroll wrap.
- Verify against real data (dev with daemon data or prod bypass) — not just synthetic.
- Commit to the current branch when verified; no push unless told.
- `command -v graphify >/dev/null && graphify hook-rebuild` after the change.

## Files
- `app/components/shared/AnalyticsTab.js` — all four cards.
- `app/globals.css` — only if a new class is genuinely needed (prefer existing `.an-*`).
- `app/lib/pnlDaily.js` — NO new math expected; only touch if a fixed-horizon helper is
  cleaner there than inline.
- Delete `public/mock-analytics-revamp.html` in the final commit.
