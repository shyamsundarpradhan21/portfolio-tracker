# Responsive scaling — fluid system, then a centered 1760 cap

Goal: type, spacing, and column count scale with viewport so widescreen looks like a
fuller 1440 (not stretched) and tablet isn't cramped.

> **Direction pivot (Phase 3.5):** the original direction was "fill width, no cap/center".
> After seeing the fluid system at 2560 we switched to a **centered ~1760px container** —
> full-bleed ≤1760, centered with gutters above (1920 ≈ 80px margins, basically full).
> Inside the cap the grids/cards sit tight at `--gap` (no `space-between`) and the type
> ceilings stop growing AT the container, not the viewport.

## Guardrails (binding — from CLAUDE.md)
- Type sizes via `--fs-*` tokens only; no raw px for type **in components** (px is used only
  in the token *ceilings*, to cap growth at the container — see Phase 3.5).
- Every change holds in BOTH day and night themes.
- Never remove `html{overflow-x:hidden}` (globals.css).
- Not complete until `certify.mjs` is green AND screenshots reviewed.

## Phase 0 — prerequisites ✅
- [x] `audit/responsive/shoot.mjs` — puppeteer screenshots 768/1024/1280/1440/1920/2560 × {day,night}, all 8 surfaces
- [x] Baseline `before` shots captured

## Phase 1 — fluid type ✅
- [x] `--fs-2xs … --fs-h0` → `clamp(floor, base + vw, ceiling)`; floors = prior fixed sizes (tablet unchanged)
- [x] Regression hunt: the pre-existing `indian@768`/`fd@768` RSP-004 reds were dense `.vsm`/`.sub`
      truncation, not the type change → fixed in the dense-cell pass (commit `d96e261`)

## Phase 1.5 — hero fit-to-width ✅ (commit `5d9b85d`)
- [x] JS fitter (`page.js`): net-worth figure grows so its width = the widest subtext line
      ("till the last L of Liabilities"). Pure font-size, no scaleX/letter-spacing distortion.
      useLayoutEffect + ResizeObserver(grid); fits on the settled `ov.nw`; suppresses the
      font-size transition during measure (overshoot fix). `AnimatedNumber`/`Live*` intact.

## Phase 2 — fluid spacing ✅
- [x] `--gap` / `--pad` / `--shell-pad` clamp tokens
- [x] Migrate fixed spacing: `.g2–.g5` gap, `.card` padding, `.main` side gutter (+ the coupled
      `.main-header` bleed). Bespoke/dense spacing (`.csm`, `.mini`, macro cells) left untouched.

## Phase 3 — responsive columns ✅
- [x] `.g3/.g4/.g5` → `repeat(auto-fit, minmax(260px, 340px))` — gains columns as width grows,
      sheds to 1 below ~560. (Finding: a fixed-px MAX drives the auto-fit column COUNT, not the MIN.)
- [x] `.hdr-cards` → cap cards at 260px so all 5 sleeves fit from ~1280, scroll below — no balloon
- [x] `.g2` left fixed (Phase 4); `.mf-g3`/`.macro-grid`/`.pjx-gcards` untouched

## Phase 3.5 — centered container ✅
- [x] `.main` → `max-width: 1760px; margin-inline: auto` (full ≤1760, centered above)
- [x] Dropped `justify-content: space-between` from `.g3/.g4/.g5` + `.hdr-cards` — bounded container
      leftover is small, cards sit tight at `--gap` (fixes the Phase-3 header airiness)
- [x] Capped `--fs-*` ceilings at the container: a rem ceiling can't cap (the root font-size is
      itself a vw clamp + each token adds `+vw`), so the ceilings are now the **px value at 1760px**
      — type stops at the container, not the viewport. Hero caps too (fitter output ∝ capped subtext).

## Phase 4 — widescreen polish (optional, not started)
- [ ] `.g2` responsive treatment (2-item grids are sparse at wide either way)
- [ ] Per-surface density tweaks where a grid looks sparse/tight at a specific width
- [ ] Optionally bump the `.hdr-cards` cap if the 5 sleeves still read airy near the cap

## Verification (gate to "done") ✅ through Phase 3.5
- [x] Screenshots: 6 widths × 2 themes — centered cap reads clean, nothing stretched/cramped
- [x] `certify.mjs`: 001/002/004 = 0 and docOverflow = 0, normal AND stress, both themes
- [x] Day + night both confirmed
- New gate counter: an `ellipsis` bucket in `certify.mjs` separates intentional single-line
  truncation from real layout clips (see `tasks/feedback.md`).
