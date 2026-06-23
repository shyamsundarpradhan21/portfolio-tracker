# Responsive Remediation — Phase 2 (RSP-001 / RSP-002 / RSP-004)

**Repo:** portfolio-tracker · **Date:** 2026-06-23 · **Scope:** tablet (768/820/1024), desktop (1280/1366/1440/1536), wide (1728/1920/2560/3440), both themes. Phone (<768) and zoom/WCAG reflow (RSP-005) **explicitly descoped** per the Phase-2 brief.

**Method:** every claim below is certified by **measurement**, never by "looks fixed" or absence of a scrollbar. The mask (`html{overflow-x:hidden}`) stayed **ON** for all fixes; certification reads per-element `scrollWidth/clientWidth` and `documentElement.scrollWidth − innerWidth` from `certify.mjs` (which detects overflow regardless of the mask). Harness, logs and per-cell JSON are in `audit/responsive/`.

---

## Step 0a — where the stress overflow fired (the gate finding)

The Phase-1 stress injection ran at **one width: `1280×800` (DESKTOP)** for all four surfaces. Results: overview 0, **indian +158px**, us 0, macro-in 0. So the Indian document breakout fired at **desktop**, not tablet — which is why RSP-002 was re-scoped as **width-independent overflow-ownership** and certified at tablet **and** desktop **and** wide.

**Important reconciliation:** with the corrected, realistic-targeted harness, the +158px breakout **did not reproduce** under realistic content. It reproduces only with an **unbreakable 66-char no-space token** injected into table cells (Phase-1 used such a token). Real holding names contain spaces and wrap. So the breakout is a *pathological* case — but the fix below contains it anyway (proven in Step 4).

---

## The detector refinement that reframed the work

Phase-1 counted any element whose rect extended past the viewport as an "offender" (escapeR up to 274px). Phase-2's detector splits those into:
- **clipped** — escapes/overflows with **no** scrollable-x ancestor → a real silent clip.
- **scrollable** — inside an `overflow-x:auto` ancestor (the header strip, `.ovx`) → acceptable, user can scroll.

Re-measured, **the app had ZERO document-level horizontal overflow even in the baseline** (`docOverflow=0`), and **RSP-001/RSP-002 normal-content `clipped=0`** — the header cards and tables were already scroll-*contained*. The genuine residuals were: **label/value truncation** (RSP-004 + header labels), **no scroll affordance** (silent scroll), and **stress fragility**. The fixes target exactly those.

---

## Per-RSP before → after (clipped offenders; `cert-00-baseline` → `cert-05-final-stress`)

| RSP | Before (measured) | Root cause | Fix | After (certified) |
|-----|-------------------|-----------|-----|-------------------|
| **RSP-004** summary cards | clipped **5**@indian768, **4**@mf768, **2**@mf1024, **1**@1280 every tab (`.lbl`/`.vsm` ellipsis cX≤49; `.hdr-card .sub` cX4) | fixed/min card width + `nowrap` label/value + clamp fonts at floor | `.lbl` **wraps** (overflow-wrap:anywhere, min-width:0); `.g3`→**2-col ≤1080** so values fit; `.hdr-card .sub`→`--fs-sm` | **004:0** at all 6 widths × both themes (normal **and** realistic stress) |
| **RSP-001** header nav | clipped **0** (already scroll-contained) but **labels truncate** ("INDIAN EQUIT…", `.lbl` cX≤36), no scroll affordance, and overflow goes **visible ≥1080** (a big injected header value would escape) | desktop-first 130px min + overflow only ≤1080 + no min-width:0 ownership + no affordance | **always** a single-row strip that **owns** overflow (`overflow-x:auto; min-width:0`); **160px** card min (labels fit); `.sub`→`--fs-sm`; **state-driven edge-fade** affordance (page.js `ResizeObserver`+scroll → `.edge-l/.edge-r`) | **001:0** all widths/themes; **labelTruncates=0** (live-verified); **edge-r active @768** (live-verified); stress-safe |
| **RSP-002** holdings tables | clipped **0** normal; **+158px doc breakout** under unbreakable token @1280 (desktop); no scroll affordance | wide table in `.ovx` with no `max-width`/`min-width:0` containment guarantee; invisible scroll | `.ovx` **owns** overflow (`max-width:100%; min-width:0`); **faint state-driven scroll-shadow** (Lea Verou local/scroll background) | **002:0 + doc0** under **realistic AND unbreakable** stress, all widths/themes, **mask on and off** |

**Step-3 full certification** (`cert-05-final-stress`, realistic stress, **8 surfaces × 11 widths × 2 themes = 176 cells**): `docOverflow cells=0, maxDoc=0, clippedMax 001=0 / 002=0 / 004=0`.

---

## Step 3b — vertical-clip check (Phase-1 only tested horizontal)

Bounded check for elements with a constrained height (`height`/`max-height`) **and** `overflow:hidden` where `scrollHeight > clientHeight`. Across all surfaces/widths the **only** hit is `.ncard .nh` (+4px) — the **intentional** 4-line news-headline clamp (`-webkit-line-clamp:4`). The **6 SVG charts** (projection, performance curve, sunburst, FII/DII, savings sparkline, realized P&L) and the fixed-height cards (incl. SipCard 110px) show **no** vertical clip. The Phase-1 "charts clean" verdict now holds **vertically** too.

---

## Step 4 — mask-removal decision

With every source overflow certified fixed, `overflow-x:hidden` was removed **in a test build** (injected `html{overflow-x:visible}`) and the full matrix re-run:

- **`cert-06-maskoff`** (mask off, normal content, 176 cells): **docOverflow cells = 0**.
- **`cert-07-maskoff-hard`** (mask off **+ unbreakable** content): **docOverflow cells = 0**.

**The mask is inert** — it is not currently hiding any document-level overflow (the scroll containers own it), even under pathological content.

**Recommendation — your call (not silently changed):**
- **Drop it.** Pro: a *future* regression that introduces real overflow becomes immediately visible (a page scrollbar) instead of being silently clipped — exactly the failure mode this audit fought. Con: until that regression is fixed, users briefly see a horizontal scrollbar.
- **Keep it** as a zero-cost cosmetic backstop. Con: it would **silently clip** any future overflow (invisible to users and casual QA).

**My recommendation: drop it**, because `certify.mjs` now catches per-element overflow by measurement regardless of the mask — wire it into CI and you lose nothing by removing the mask while gaining visible regressions. If the harness won't run in CI, keeping the mask is defensible but must be paired with the harness. **I left `globals.css:260` untouched** awaiting your decision.

### 🚧 BLOCKING prerequisite for the mask-drop commit (must fix IN THE SAME commit)

The mask is currently hiding **one real pre-existing overflow** that will become visible the instant `overflow-x:hidden` comes off:

- **`.page-header-lbl`** — the net-worth hero label ("NET WORTH — LIVE ✦", `app/page.js:1117`, CSS `globals.css:1555`) clips **3–4px** at **night theme, overview tab, ≥1440px wide**. It is **pre-existing** (present in the baseline, untouched by the Phase-2 commits — verified via `git show`), **not** a summary card (RSP-004), and so out of this remediation's scope. It surfaced only because the certifier's RSP-004 tag once matched the `lbl` substring; the tag was tightened to exact-class membership.
- **Why it's blocking, not nice-to-have:** with the mask ON it is silently clipped and harmless. With the mask OFF it produces a 3–4px document overflow on the most prominent element on the page (the net-worth hero). The mask-drop commit MUST resolve this `.page-header-lbl` clip (e.g. `min-width:0` / wrap / width budget on the hero label) **in the same commit**, or dropping the mask trades a silent clip for a visible scrollbar on the hero. Re-run `certify.mjs` with `MASKOFF=1` and assert `docOverflow cells = 0` before that commit lands.

---

## Residual (out of the three target RSPs — not fixed, by scope)

- `other` clipped ≤ 8 (normal) / ≤ 14 (stress), all **contentX ≤ 7px**, never document-breaking: `.pjx-viewtoggle/scrubrow/rail/notches` (projection scrubber internals) and `.ins-stats`. Pre-existing minor internal overflow, outside RSP-001/002/004. Trivial `min-width:0` hygiene if you want them at zero.
- The Macro **ticker marquee** (`.tkw/.tkv/.tkrow/.tki/.tdot`) remains an intentional off-screen scroll — **excluded** from all counts (RSP-006).
- **RSP-005 (zoom)** and **phone <768** untouched, per scope.

---

## Files changed (CSS + minimal reflow JSX only — no logic/data/API)

- **`app/globals.css`** — `.lbl` wrap + min-width:0; `.g3` 2-col ≤1080; `.hdr-card .lbl` nowrap-preserve; `.hdr-cards` always-own-overflow strip (160px min, padding for glow) + `.hdr-cards-wrap` edge-fade affordance; `.hdr-card .sub` → `--fs-sm`; `.ovx` overflow-ownership (`max-width:100%;min-width:0`) + scroll-shadow.
- **`app/page.js`** — header scroll-affordance hook (`useRef`+`useState`+`ResizeObserver`+`onScroll` → `.edge-l/.edge-r`) and the `.hdr-cards-wrap` wrapper. No data/logic touched.
- **`audit/responsive/certify.mjs`** — new measurement harness (clipped-vs-scrollable, per-RSP tagging, realistic + hard stress, vertical-clip, mask-off; ticker excluded). Cert artifacts: `cert-00-baseline` … `cert-07-maskoff-hard` (`.log` + `.json`).
- **Untouched:** `html{overflow-x:hidden}` (globals.css:260) — your decision; `--fs-*` tokens only (no raw px added); no Tailwind; no app logic/data/API.

---

## Certification summary

| Gate | Run | Result |
|------|-----|--------|
| RSP-004 normal | cert-02 | 004:0 all data tabs × 6 widths × 2 themes |
| RSP-001 normal | cert-02 | 001:0, doc0; no truncation; affordance live |
| RSP-002 realistic stress | cert-03 | 002:0, doc0 all widths/themes |
| RSP-002 unbreakable stress | cert-04 | doc0 all widths/themes |
| **Step-3 all-surfaces realistic stress** | **cert-05** | **doc0; 001/002/004 = 0 across 176 cells** |
| **Step-4 mask off (normal)** | **cert-06** | **doc0 across 176 cells** |
| **Step-4 mask off + unbreakable** | **cert-07** | **doc0** |

**Stopping here for your review before anything merges**, per the brief.
