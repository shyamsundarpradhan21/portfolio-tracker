# Implementation prompt — 6-region responsive app shell

**For Claude Code.** Design + region map are LOCKED (this was speced in a Cowork session).
Build to this spec; do NOT re-derive it. Branch: `shell-6region` (commit here, no push until
told; keep the stray `.claude/*` edits OUT of scope). Plan checklist mirrors `tasks/todo.md`.

Source mock (approved): `mock-shell-responsive.html`. Verify-first rule applies (feedback.md):
render-verify each tab in the live app, and the responsive gate must be GREEN before "done".

---

## Locked decisions

- **Header (global):** net-worth hero + utility topbar ONLY, PLUS the 3 Market-Wrap ticker rails
  (`TickerLine`: `Indices` · `Commod·FX` · `News`) lifted up from `MacroTab`. The asset-class
  cards LEAVE the header (they were doubling as nav; the sidebar owns nav now).
- **Sidebar (global, ≥1024):** the 7-tab nav rail. Below 1024 it renders as the existing top
  pills. ONE `tab`/`selectTab` state drives BOTH renderings — do not fork selection state.
- **Footer (global):** `FreshnessTag` · `SyncBadge` · data-as-of · AI-refresh · the `CFMemo` tax
  memos · disclaimer — moved out of the individual tabs.
- **Statistics region:** the AI `AnalysisCard` lives here on EVERY tab (fixed, predictable slot).
- **FD widget:** build a NEW maturity-timeline widget (FD has no native 2nd visual).
- **US:** dividend income STAYS in statistics (keeps the widget symmetric with the other sleeve
  tabs, which pair allocation + day curve).
- **Wide tiers:** CAP the shell (`max-width` + center); do NOT let `main` sprawl to 2100px at 2560.

## Per-tab region map (main / widget / statistics)

| Tab | Main | Widget | Statistics (AI card always here) |
|---|---|---|---|
| Overview | Net-worth live curve · projection | Allocation bar (`AllocBar`) | Asset summary cards · SIP · cashflow memo · AI |
| Indian | Holdings table | Sunburst alloc · equity day curve | Realized P&L · benchmark bars · AI |
| FD | FD ladder table | ★ NEW maturity-timeline | Principal · accrued · maturity value · AI |
| MF | MF holdings table | Sunburst alloc · XIRR chart | Benchmark bars · AI |
| US | US holdings table | Sunburst alloc · equity day curve | Realized P&L · dividend income · benchmark bars · AI |
| Trading | P&L dashboard · analytics | Live F&O positions · monthly reco | F&O summary · loss carry-forward · AI |
| Wrap | Nifty-50 heatmap · sector map | Macro board · pre-market briefing | FII/DII trail · sentiment · SWOT · full NewsFeed |

---

## Phase 0 — grid scaffolding (`app/globals.css`)

Add a `.shell` grid. Use the app's tokens (fluid `--fs-*`, `--gap`, `--acc`, `--brd`, `--sc-*`);
NO raw hex. Translate the mock's 4-tier `grid-template-areas` verbatim (mock is source of truth):

```css
.shell { display:grid; gap:var(--gap); max-width:1680px; margin-inline:auto;
  grid-template-columns:1fr;
  grid-template-areas:"header" "main" "widget" "stats" "footer"; }
.shell > * { min-width:0; min-height:0; }               /* STRESSHARD-safe (feedback) */
.shell-header{grid-area:header} .shell-sidebar{grid-area:sidebar;display:none}
.shell-main{grid-area:main} .shell-widget{grid-area:widget}
.shell-stats{grid-area:stats} .shell-footer{grid-area:footer}

@media (min-width:768px){ .shell{ grid-template-columns:1fr 1fr;
  grid-template-areas:"header header" "main main" "widget stats" "footer footer"; } }

@media (min-width:1024px){ .shell{ grid-template-columns:12rem 1fr 1fr;
  grid-template-areas:"header header header" "sidebar main main"
                      "sidebar widget stats" "footer footer footer"; }
  .shell-sidebar{display:block} }

@media (min-width:1440px){ .shell{ grid-template-columns:12rem 1fr 16rem;
  grid-template-areas:"header header header" "sidebar main widget"
                      "sidebar main stats" "footer footer footer"; } }
```

- Header ticker rails MUST clip: `.hdr-rail{overflow:hidden;white-space:nowrap}` — a marquee that
  scrolls its content must never contribute to `docOverflow` (this is the #1 cert risk).
- Keep `html{overflow-x:hidden}` (globals.css:260) — do NOT remove it (see CLAUDE.md backstop rule).

## Phase 1 — header (`app/page.js` + new `app/components/shared/TickerRails.js`)

- Strip `.hdr-grid` down: keep the `.topbar` utility row + `.hdr-hero` net-worth block; REMOVE the
  `.hdr-cards-wrap` asset-card strip from the header.
- Extract `TickerLine` (currently local in `MacroTab.js`, line ~31) into a shared component; render
  the 3 rails (`Indices` / `Commod·FX` / `News`) inside the header region. Remove those 3
  `<TickerLine>` calls from `MacroTab` (lines ~536-538). Keep `MacroTab`'s `NewsFeed` (full feed).
- The relocated asset summary cards move into Overview's statistics region (Phase 4).

## Phase 2 — sidebar nav

- Render a vertical rail (the 7 tabs) into `.shell-sidebar`, shown ≥1024 via the CSS above; the
  existing top pills render <1024. BOTH read/write the same `tab`/`selectTab`. Active item = `tab`.

## Phase 3 — global footer (`.shell-footer`)

- Move `FreshnessTag` / `SyncBadge` / data-as-of / AI-refresh / `CFMemo` tax memos / disclaimer out
  of the tab bodies into the footer region. De-dupe (they currently appear per-tab).

## Phase 4 — per-tab region wiring + FD widget

- Refactor each tab so page.js can place its content into the three regions. Contract: each tab
  module exposes three pieces — `main`, `widget`, `stats` — and page.js's `tab===N` switch drops
  them into `.shell-main` / `.shell-widget` / `.shell-stats`. Keep props/data flow unchanged; this
  is a LAYOUT move of existing subcomponents per the map, not a data rewrite.
- Move `AnalysisCard` into the stats slot on all 5 tabs that render it.
- FD: build the new maturity-timeline widget (`app/components/shared/FdMaturity.js` or inside
  `FDTab`): a per-FD accrual/maturity timeline from each FD's `bought` + tenor + rate (derive
  dates — no hardcoded dates, per feedback). Direction by colour, `--fs-*` sizing, both themes.

## Phase 5 — VERIFY (blocking, do not skip)

- `node audit/responsive/certify.mjs` — pass = `001/002/004 = 0` AND `docOverflow = 0` across all 6
  widths (768/1024/1280/1440/1920/2560) × BOTH themes, in normal AND stress mode.
- `STRESSHARD=1 node audit/responsive/certify.mjs` — clean (header rails + region tracks are the
  risk). Re-cert after any data/ledger sync (normal mode reads the live DOM).
- Run `audit/responsive/sanity-ellipsis.mjs` if you touch `detect()` (don't).
- Render-verify each of the 7 tabs in the live app (not just the API payload).
- `npm run index` if symbols moved; `command -v graphify >/dev/null && graphify hook-rebuild`.

## Phase 6 — commit

- Commit to `shell-6region`, scoped to shell files (exclude `.claude/*`). No push unless told.
- Append any correction encountered to `tasks/feedback.md`.
