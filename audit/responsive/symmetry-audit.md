# Symmetry audit — card/grid containers across all 8 surfaces

Read-only inventory + measurement. The original goal was to find where equal stat cards
rendered at **different widths** (the asymmetry) and converge them onto one shared primitive.

> **Revised invariant (Phase 4 final — what the certify gate enforces):** symmetry =
> **≤2 ROWS per converged stat grid at desktop**, balanced — NOT one fixed card width. Each
> `.statgrid` sets `columns = ceil(itemCount/2)` (≤3 items → one row), so a grid renders as
> 2×2 / 3×2 / one row; cards FILL (`1fr`) and their width **varies by viewport, by design**.
> Tablet (≤900) collapses to 2 columns, phone (≤560) to 1 — extra rows are fine on narrow
> only (not gated). The column count is derived from the live child count via `:has(> :nth-child(N):last-child)`
> quantity queries (no per-component wiring). `certify.mjs` asserts ≤2 rows at the desktop
> widths (1280/1920/2560) and `process.exit(1)` otherwise. The distinct-pixel-width tables
> below are the ORIGINAL inventory that motivated the convergence — kept for history.

- **Scope:** all 8 certify surfaces (overview, indian, fd, mf, us, algo, macro-in, macro-us).
- **Measured:** night theme, viewports 768 / 1280 / 1920 / 2560 inside the centered **1760px**
  band (`.main { max-width:1760px }`). Per grid: column count · first-card width · residual
  (= container width − used). `r` = residual px (high = sparse right edge).
- **Method:** measured the live DOM with puppeteer (dev server). Live-data-dependent, so a
  data sync shifts a few px — re-measure after one. No CSS was changed.

---

## (a) Asymmetry metric — distinct STAT-ROW card widths per breakpoint

The headline metric: how many *different* card widths the uniform stat rows render at each
width. Fewer = more symmetric.

| breakpoint | # distinct widths | widths (px × # grid instances) |
|---|---|---|
| **768**  | 5 | 340×12 · 339×1 · 328×5 · 243×1 · 103×1 |
| **1280** | 4 | 340×17 · 588×1 · 245×1 · 185×1 |
| **1920** | 4 | 340×17 · 819×1 · 338×1 · 258×1 |
| **2560** | 4 | 340×17 · 810×1 · 334×1 · 252×1 |

**Read:** at every width ≥1280 the stat cards cluster hard at **340px** (the `.g3/.g4/.g5`
auto-fit cap — 17 grid instances) with exactly **3 outliers** breaking symmetry:

- `ins-stats` → ~252–258px (6 metrics jammed into a fixed 3-col)
- `pnl-stats` → ~334–338px (5 stats in a fixed 4/5-col — close to 340 but not equal)
- `pnl-sumrow` → ~810–819px (a fixed 2-col row, very wide cards)

Converging those three onto the 340 primitive collapses the metric to **1–2 widths**.

**Second finding — sparsity (not asymmetry):** the 3-item `.g3` summary rows cap correctly at
340 but leave large residual at wide — `r593–634` (and `r923` on the 2-item ones) at
1920/2560. They are *symmetric but sparse*. That is the "pack like the header" gap and it
needs a **row-merge** (Indian/US's two 3-card `g3` rows → one 6-item grid), not a width change.

### Per-surface measurement (cols · card-px · residual)

```
overview
  g3          items 3   @768 2c·340(r7)    @1280 3c·340(r147)  @1920 3c·340(r593)  @2560 3c·340(r562)
  g4          items 4   @768 2c·340(r7)    @1280 3c·340(r147)  @1920 4c·340(r235)  @2560 4c·340(r201)
  hdr-cards   items 5   @768 5c·160(scroll)@1280 5c·175(r6)    @1920 5c·258(r6)    @2560 5c·254(r9)
  pjx-gcards  items 5   @768 3c·227(r0)    @1280 5c·231(r0)    @1920 5c·322(r-1)   @2560 5c·317(r-1)

indian
  g3 (×2 summary) items 3  @768 2c·340(r37)  @1280 3c·340(r180) @1920 3c·340(r634) @2560 3c·340(r610)
  g3#2,#3 (holdings) it 3  @768 1c·328(r0)   @1280 1c·340(r234) @1920 2c·340(r97)  @2560 2c·340(r76)
  g3#4            items 2  @768 2c·340(r7)   @1280 2c·340(r501) @1920 2c·340(r951) @2560 2c·340(r923)
  g2 (×2)         items 2  @768 2c·358(r1)   @1280 2c·607(r0)   @1920 2c·836(r0)   @2560 2c·826(r-1)
  ins-stats       items 6  @768 3c·103(r-1)  @1280 3c·185(r-1)  @1920 3c·258(r1)   @2560 3c·252(r1)
  hdr-cards       items 5  @768 5c·160(scr)  @1280 5c·163(r7)   @1920 5c·243(r9)   @2560 5c·240(r6)

fd
  g4              items 4  @768 2c·340(r37)  @1280 3c·340(r180) @1920 4c·340(r276) @2560 4c·340(r249)

mf
  g3              items 3  @768 2c·340(r37)  @1280 3c·340(r180) @1920 3c·340(r634) @2560 3c·340(r610)
  g3#1 (holdings) items 3  @768 1c·328(r0)   @1280 1c·340(r234) @1920 2c·340(r97)  @2560 2c·340(r76)
  g3#2            items 2  @768 2c·340(r7)   @1280 2c·340(r501) @1920 2c·340(r951) @2560 2c·340(r923)
  g2              items 2  @768 2c·358(r1)   @1280 2c·607(r0)   @1920 2c·836(r0)   @2560 2c·826(r-1)

us
  g3 (×2 summary) items 3  @768 2c·340(r37)  @1280 3c·340(r180) @1920 3c·340(r634) @2560 3c·340(r610)
  g3#2,#3         items 3  @768 1c·328(r0)   @1280 1c·340(r234) @1920 2c·340(r97)  @2560 2c·340(r76)
  g3#4            items 2  @768 2c·340(r7)   @1280 2c·340(r501) @1920 2c·340(r951) @2560 2c·340(r923)
  g2 (×2)         items 2  @768 2c·358(r1)   @1280 2c·607(r0)   @1920 2c·836(r0)   @2560 2c·826(r-1)
  g2#2 (usdet-ish)items 4  @768 2c·157(r0)   @1280 2c·280(r0)   @1920 2c·389(r-1)  @2560 2c·378(r0)

algo
  g4              items 4  @768 2c·340(r7)   @1280 3c·340(r147) @1920 4c·340(r235) @2560 4c·340(r201)
  pnl-stats       items 5  @768 3c·243(r0)   @1280 5c·245(r1)   @1920 5c·338(r-2)  @2560 5c·334(r0)
  pnl-sumrow      items 2  @768 2c·339(r1)   @1280 2c·588(r0)   @1920 2c·819(r0)   @2560 2c·810(r0)
  pnl-year        items 12 @768 6c·101(r3)   @1280 6c·184(r2)   @1920 6c·261(r2)   @2560 6c·258(r2)

macro-in
  feed            items 7  @768 —            @1280 2c·289(r3)   @1920 3c·266(r5)   @2560 3c·263(r5)
  mvcols          items 2  @768 2c·364(r1)   @1280 2c·164(r-28) @1920 2c·208(r0)   @2560 2c·206(r-1)
  usdet           items 2  @768 2c·347(r1)   @1280 2c·289(r0)   @1920 2c·405(r-1)  @2560 2c·400(r0)
```
*(`fdstats` is FII/DII-conditional and did not render in this data state — classified from
CSS as a fixed 3-col uniform stat row; measure live when FII/DII is present.)*

---

## (b) Classification + proposed mapping → shared primitives

### UNIFORM STAT ROWS → converge to one `.statgrid` primitive
**Final rule (row-balanced):** `display:grid; gap:var(--gap)`, `columns = ceil(itemCount/2)`
at desktop (≥901) via `:has(> :nth-child(N):last-child)`, cards `1fr` (fill). Tablet (≤900) →
2 cols, phone (≤560) → 1. Each grid renders in ≤2 rows at desktop; card width varies by
viewport. (The `repeat(auto-fit, minmax(220,260))` packed-cap below was the first cut — replaced
because fixed-width packing didn't read as "balanced." `pnl-sumrow` was kept bespoke, not folded.)

| class | rule today | surfaces | items | width @1920 | action |
|---|---|---|---|---|---|
| `.g3` | auto-fit `minmax(260,340)` | indian, us, mf, overview, RealizedPanel, CFMemo | 2–3 | 340 | **is the primitive** |
| `.g4` | auto-fit `minmax(260,340)` | fd, algo, overview | 4 | 340 | = primitive (alias) |
| `.g5` | auto-fit `minmax(260,340)` | *(defined; no live usage found)* | — | — | fold into primitive |
| `.fdstats` | `repeat(3,1fr)` fixed | macro (FII/DII) | 3 | *(conditional)* | → primitive |
| `.pnl-stats` / `.has-cap` | `repeat(4/5,1fr)` fixed | algo | 4–5 | 338 | → primitive |
| `.ins-stats` | `repeat(3,1fr)` fixed | InsightsCard (all tabs) | 4–6 | 258 | → primitive |
| `.pnl-sumrow` | `repeat(2,1fr)` fixed | algo | 2 | 819 | → primitive *(or keep as intentional 2-card hero — see open decisions)* |

### CONTENT GRIDS → leave (layout panes, not equal stat cards)
Deliberate 2-column / asymmetric content; out of the stat primitive.

| class | rule | surfaces | role |
|---|---|---|---|
| `.g2` | `repeat(2,1fr)` | indian, us, mf | benchmarks / sector 2-up |
| `.no-cards` | `1.5fr 1fr` | macro, no-trade | asymmetric content split |
| `.pm-context` | `1.7fr 1fr` | algo / projection | asymmetric content split |
| `.no-pivots` / `.no-movers-wrap` | `1fr 1fr` | macro | content pairs |
| `.usdet` | `1fr 1fr` | us | detail pairs |
| `.mvcols` | `1fr 1fr` | macro | movers columns |
| `.feed` | `1fr 1fr` (auto-fill in macro) | macro | news feed |
| `.ins-swot` | `1fr 1fr` | insights | SWOT pair |
| `.pulse-ov-grid` / `.pulse-dd` | `1fr 1fr` | macro pulse | pulse pairs |
| `.pm-cue-row` | auto-fill `minmax(150,1fr)` | algo / projection | cue chips |
| `.sgrid` | `1fr 1fr 1fr` | (mini) | mini 3-up |

---

## (c) Intentionally bespoke — leave, with reasons

| class | rule | why leave |
|---|---|---|
| `.macro-grid` | `grid-template-areas`, `minmax(0,1fr) minmax(0,1fr) minmax(0,2fr)` | named-area 50:50 dashboard with row-spans + capped scroll rows holding charts and lists — not a card row |
| `.mf-g3` | `1.15fr 1fr` | allocation table + donut chart; the 1.15:1 split is a deliberate asymmetry |
| `.pjx-gcards` | `repeat(5, minmax(0,1fr))` | projection scenario cards with their own 5→3→2 breakpoints |
| `.pnl-year` | `repeat(6,1fr)` | month calendar (12 cells) |
| `.pnl-grid` | `repeat(7,1fr)` | day-of-week heatmap |
| `.pnl-cal` | `repeat(7,1fr) 1.05fr` | calendar + week-total column |
| `.hdr-grid` | `auto minmax(0,1fr)` | header layout: hero (auto) + sleeve strip |
| `.hdr-cards` | `repeat(5, minmax(160px,260px))` | the header sleeve strip — already capped (Phase 3); this is the primitive the stat rows should *match* |
| `.topbar` | `1fr auto 1fr` | 3-zone top bar |
| echarts containers | — | charts, not grids |

---

## Net plan — DONE (as built)

1. ✅ `.statgrid` primitive = row-balanced `columns = ceil(itemCount/2)` (`:has()` quantity
   queries), cards `1fr`; tablet 2-col, phone 1-col. Replaces the first-cut auto-fit cap.
2. ✅ Mapped on: `g3 / g4 / g5 + fdstats + pnl-stats + ins-stats`. `pnl-sumrow` stays **bespoke**.
3. ✅ Content grids + bespoke set left untouched.

### Decisions (resolved)
1. **Cap → dropped.** No fixed card width; cards fill `1fr` (width varies by viewport, intended).
   The invariant is the **row count (≤2 at desktop)**, not a pixel width.
2. **Row-merge → done.** Indian/US's two 3-card `g3` rows merged into one 6-item `.statgrid`
   (`IndianTab.js` / `USTab.js`); renders 3×2 at desktop.
3. **`pnl-sumrow` → kept bespoke** (2-card, with `.g2`), not folded.

### The gate (certify.mjs)
`detect()` records each converged grid's row count; `run()` FAILS (prints `SYMMETRY *** FAIL ***`
+ `exit 1`) if any converged grid renders >2 rows at a desktop width (≥1280). Proven by a
deliberate-fail sanity (force a 6-item grid to 2 cols → 3 rows → FAIL). Companion
`compact values + title=exact`, the `FreshnessTag` wrap, and `pnl-sumrow` bespoke are retained.

_Per-grid row counts at the converged state (desktop): Indian/US `.statgrid` 6→3×2, MF `.g3`
3→1 row, FD/algo `.g4` 4→2×2, algo `.pnl-stats` 5→3+2, `.ins-stats` 6→3×2 — all ≤2 rows._
