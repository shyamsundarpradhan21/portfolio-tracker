# Responsive & Layout-Integrity Audit — Phase 1 (AUDIT ONLY)

**Repository:** portfolio-tracker · **Date:** 2026-06-23 · **Scope:** every tab × 11 breakpoints × 2 themes + zoom + content stress
**Status:** Phase 1 complete. **No application code was modified.** Fixes are proposed, not applied.

Evidence: `audit/responsive/screens/` (189 screenshots), raw data `audit/responsive/report.json`, aggregation `audit/responsive/analyze.mjs`, issue inventory `audit/responsive/issues.json`. Harness: `audit/responsive/audit.mjs` (puppeteer, read-only).

---

## 0. Scope Reconciliation (this repo vs. the generic brief)

The brief assumes a multi-route dashboard with Tailwind, tables, modals, etc. The actual app differs, so the audit was retargeted to what exists:

| Brief assumption | Reality in this repo | Audit action |
|---|---|---|
| Multiple routes (/holdings, /transactions, /reports, /settings…) | **Single-page Next.js 14 app-router**; one `page.js` with **7 state-driven, hash-addressable tabs** (`#overview #indian #fd #mf #us #algo #macro`) | Audited the 7 tabs **as the routes** (+ the macro tab's US-region variant = 8 surfaces) |
| Tailwind (`w-*`, `grid-cols-*`, `overflow-hidden`…) | **Custom CSS** in `app/globals.css` with `--fs-*`/`--sc-*` design tokens; **no Tailwind** | Audited raw CSS (media queries, fixed px, overflow, grids) |
| Modals / dialogs / drawers / popovers | **None exist** — all interactivity is inline (SVG tooltips, button/tab state) | Section marked **N/A** |
| Charting library (ECharts/Recharts) | **None** — 6 hand-rolled responsive SVG charts (`viewBox` + `width:100%`) + CSS bars | Audited SVG scaling instead |
| Light + Dark | `localStorage 'nwTracker.theme'` → `<html data-time="day|night">` | Both themes captured at every cell |

**Local-data caveat:** the app renders from committed JSON + live **public** market APIs, so most surfaces populate. `/api/snapshots` (net-worth history) returns **503 locally**, so the Overview projection chart shows its empty/fallback state. Data-dense **table** states were exercised via **injected long-label / large-value stress** rather than a seeded book — re-run the harness against a seeded/production instance to certify max-row table density.

---

## 1. Executive Summary

The app is **excellently tuned for desktop and wide** and **degrades at tablet widths**, where the global header navigation and the holdings tables overflow and are **silently clipped** (not scrolled) by a root `overflow-x:hidden`. Charts, the macro grid, and theme parity are all solid.

### Responsive score
- **Tablet (768–1024): 5 / 10** — header asset-card nav clips (only ~4 of 5 cards reachable, active label truncated), holdings tables clip right-hand columns (P&L/Return%/Day% off-screen), some summary-card text escapes. All masked by `overflow-x:hidden` → silent content loss. Charts & macro grid reflow well.
- **Desktop (1280–1536): 9 / 10** — near-zero offenders (≤1 per cell, all tabs). Visually clean in both themes. Only caveat: zoom sensitivity (RSP-005).
- **Wide (1728–3440): 8.5 / 10** — **zero** layout offenders; `max-width` ladder (1560 → 1840@2100 → 2560@3200) centres content. Minor wasted gutter between 1080–2100px (RSP-009).

**Cross-cutting:** browser **zoom ≥150% introduces horizontal scroll** (+177px @150%, +715px @200%) — a WCAG 1.4.10 reflow concern (RSP-005). **Day/night parity is perfect** (0 theme-specific differences across 176 cells).

### Headline numbers
- 8 surfaces × 2 themes × 11 breakpoints = **176 matrix cells** + 9 zoom + 4 stress = **189 screenshots**.
- Document horizontal scroll in normal matrix: **0/176** — but this is **masked** by `html{overflow-x:hidden}`; the real overflow surfaces as **per-element offenders** (below).
- Offender load is **tablet-only** for data tabs: indian **108→1→0** (tablet→desktop→wide), us **125→1→0**, fd **71→1→0**, mf **23→1→0**, algo **19→1→0**, overview **22→6→8**.
- Macro tab shows 200–340 offenders at every width — **~95% are the off-screen ticker marquee** (`.tki/.tdot/.tkrow`, escapeR up to 23,700px), which is **intentional and masked** (RSP-006), not a bug.

---

## 2. Findings

| ID | Sev | Tab(s) | Component | File | Breakpoint | Theme | Issue | Root cause |
|----|-----|--------|-----------|------|-----------|-------|-------|-----------|
| RSP-001 | **High** | all (header) | Asset-card nav `.hdr-cards` | page.js:1134; globals.css:1407,1451 | 768/820/1024 | both | 5 nav cards don't fit; US/Trading escape ≤264px & clip; "INDIAN EQUIT…" truncates; only ~4 reachable | `repeat(5, minmax(130px,1fr))` (650px min) + overflow-x:auto fallback hides primary nav |
| RSP-002 | **High** | indian/us/mf/fd | Holdings tables `.ovx>table.tbl` | IndianTab/USTab/MFTab/FDTab; globals.css:551 | 768/820/1024 | both | Right columns (P&L/Return%/Day%) clip; long content overflows doc +158px | Wide fixed-column tables in narrow `.ovx`; no column priority; invisible scroll affordance |
| RSP-003 | **High** | global | Root overflow guard | globals.css:260 | tablet (+ any overflow) | both | `html{overflow-x:hidden}` masks overflow → silent clipping, no scrollbar | Band-aid suppresses symptom of child overflow instead of fitting layout |
| RSP-004 | **High** | overview/indian/fd/mf/us/algo | Summary cards `.csm .vmd/.lbl/.sub/.rs` | globals.css:390-424,1448 | tablet (worse @ zoom) | both | Card values/labels/subtitles escape ≤274px & clip | Fixed/min card widths + nowrap values + clamp fonts at floor |
| RSP-005 | Medium | all (a11y) | Layout under zoom | globals.css (fixed px) | 1440 @150%/200% | both | +177px / +715px horizontal scroll; `.sub` top offender | Fixed px widths don't reflow under zoom (WCAG 1.4.10) |
| RSP-006 | Low | macro | Ticker marquee `.tkw/.tkv/.tkrow` | MacroTab.js:38; globals.css:608-624 | all | both | 200–340 "offenders" = off-screen marquee (masked) | Duplicated-track marquee; **expected**, only mask-image lacks @supports fallback |
| RSP-007 | Low | indian/macro/projection | Fixed bar labels + grid gaps | globals.css:505,508,1884,1727,1169 | 720-999 / 561-759 | both | Fixed-px labels crush bars; growth/tornado grids have breakpoint gaps | Fixed px + missing intermediate media queries |
| RSP-008 | Low | macro/chips | Raw px fonts `.chip 12px`, `.ecal-i 11px` | globals.css:527,817 | all | both | Don't track root clamp; off-scale vs neighbours | Token convention violation (use `--fs-*`) |
| RSP-009 | Low | global (wide) | `.main` max-width gutter | globals.css:1351,1357 | 1728/1920 | both | ~180px gutters each side at 1920; wasted whitespace | 1020px gap in max-width ladder (1560→1840@2100) |
| RSP-010 | Low | tables | Sticky header `.ovx thead th` | globals.css:551-559 | all | both | `backdrop-filter` blur with no fallback → transparent header on unsupported browsers | No `@supports` graceful degradation |
| RSP-011 | Low | macro | `.macro-grid` single 920px breakpoint | globals.css:760-785 | 861-919 | both | 3-col stays cramped (~215px cols) before stacking | One breakpoint for a 3-region grid; no 2-col step |
| RSP-012 | Low | overview | SipCard sparkline fixed height | SipCard.js:176 | 768/820 | both | 110px fixed height doesn't scale vertically | Fixed px SVG height vs viewBox/aspect-ratio |

---

## 3. Root-Cause Groups

- **Layout / Overflow strategy** — RSP-003 (`html{overflow-x:hidden}` masking), RSP-001/002/004 all clipped by it. *The single highest-leverage theme: overflow is suppressed, not solved.*
- **Grid** — RSP-001 (`.hdr-cards` 5×130px min), RSP-007 (`.pjx-gcards` 760-999px gap), RSP-011 (`.macro-grid` 920px cliff), RSP-009 (max-width ladder gap).
- **Flexbox** — RSP-004 (missing `min-width:0` on card children lets nowrap text escape), RSP-007 (fixed-px label columns beside flex bars).
- **Tables** — RSP-002 (column clipping + long-content breakout), RSP-010 (sticky-header fallback).
- **Charts** — RSP-012 (SipCard fixed height). *All other 6 SVG charts are responsive (viewBox + width:100%) — clean.*
- **Typography** — RSP-008 (raw-px fonts), RSP-004 (clamp floors), RSP-001 (label truncation).
- **Navigation** — RSP-001 (header nav clip is the most user-facing issue — it's how you switch tabs).
- **Modals** — **N/A** (none exist).
- **Theme** — **Clean.** No day/night responsive differences in 176 cells.

---

## 4. JSON Issue Inventory

Full machine-readable inventory at **`audit/responsive/issues.json`** (12 issues, each with `id, severity, route, component, file, breakpoint, theme, issue, rootCause, recommendedFix`). Summary counts: **High ×4, Medium ×1, Low ×7.**

---

## 5. Remediation Plan (proposed — NOT implemented)

Ordered by severity / leverage. Each: exact file · change · expected impact · regression risk.

1. **RSP-003 — stop masking overflow (do this first; it's the lens for the rest).**
   - *File:* `app/globals.css:260`. *Change:* temporarily remove `overflow-x:hidden` from `html` in a branch and re-run the harness to see the true scrollbars; then resolve RSP-001/002/004 and re-add it only as a backstop on a content wrapper, not `html`.
   - *Impact:* converts silent clipping into either a fixed layout or an intentional scroll; makes regressions visible.
   - *Regression risk:* **Medium** — removing it transiently exposes existing overflow (expected); re-add scoped after fixes.

2. **RSP-001 — header nav must not hide tabs at tablet.**
   - *File:* `app/globals.css:1407` (+ the `≤1080px` block 1451-1456). *Change:* below ~1080px use `grid-template-columns: repeat(auto-fit, minmax(150px,1fr))` to **wrap** to 2 rows, or collapse to a 2–3 col grid; if horizontal scroll is kept, add an edge-fade + `scroll-snap` affordance and never truncate the active card's label.
   - *Impact:* all tabs reachable on tablet without guessing there's hidden scroll.
   - *Regression risk:* **Low-Medium** — header height grows a row at tablet; verify the sticky `.main-header` offset.

3. **RSP-002 — holdings tables.**
   - *Files:* `.ovx` in globals.css:551 + the 4 tab table renderers. *Change:* add a visible scroll affordance to `.ovx` (edge shadow); on tablet freeze col 1 or hide Return%/Day% behind a toggle; add `min-width:0; overflow-wrap:anywhere` to text cells so long content can't break out of `.ovx`.
   - *Impact:* no hidden columns / no document breakout under long content.
   - *Regression risk:* **Low** — purely additive affordances; verify sort-header clicks still align.

4. **RSP-004 — summary-card text.**
   - *File:* `app/globals.css:390-424,1448`. *Change:* `min-width:0` on `.csm`/`.hdr-card` flex/grid children, lower the clamp floors for `.vmd`/`.hdr-card .vmd`, allow value wrap or fluid downscale, ensure `text-overflow:ellipsis` where truncation is acceptable.
   - *Impact:* values/labels stay inside their cards at tablet and under zoom.
   - *Regression risk:* **Low** — visual-only; check the `.rs` ₹-glyph treatment still aligns.

5. **RSP-005 — zoom reflow.** Falls out of fixing RSP-001/004 (same fixed-px roots). *Change:* replace fixed px min-widths on cards/labels/nav with fluid units; retest at 200% targeting zero horizontal scroll. *Risk:* **Low** once 1/4 land.

6. **RSP-007/008/009/010/011/012 (Low).** Mechanical, low-risk: add the missing 760-999 / 561-759 breakpoints; swap `12px`/`11px` → `--fs-*`; optional 1600-1900px max-width step; add `@supports` fallback for sticky headers; optional macro 2-col intermediate; give SipCard a viewBox-driven height. Each is **Low** regression risk and independently shippable.

7. **RSP-006 — ticker.** No layout change; optionally add an `@supports (mask-image)` fallback. **No** regression risk.

---

## 6. Evidence Index

- `screens/<night|day>/<surface>/<WxH-group>.jpg` — full-page capture for every matrix cell (e.g. `screens/night/indian/0768x1024-tablet.jpg` shows the header-card + table clip; `screens/night/macro-in/0768x1024-tablet.jpg` shows the clean macro stack + ticker marquee).
- `screens/zoom/<surface>__zoom{125,150,200}.jpg` — zoom reflow evidence.
- `screens/stress/<surface>__longlabel-bigvalue.jpg` — long-label / large-value injection.
- `report.json` — every cell's `docOverflow`, `offenderCount`, ranked `offenders[]` (selector, escape px, content overflow). `analyze.mjs` reproduces the aggregations in §1.

---

## 7. Phase 2 (NOT started — awaiting review of this report)

On approval: (1) build the remediation checklist from §5; (2) fix in severity order (RSP-003 lens → 001 → 002 → 004 → 005 → lows); (3) re-run `audit.mjs` for before/after deltas; (4) verify zero new offenders and no desktop/wide regressions; (5) emit before/after screenshots and a final certification. **No code changes will be made until this report is reviewed and Phase 2 is authorised.**
