# Shell-6region — status + continue-here (2026-07-05)

Continue in Claude Code. Full spec: `tasks/shell-6region-prompt.md`. Plan checklist:
`tasks/todo.md` (§ "6-region responsive app shell"). Branch: `shell-6region` (commit
here, no push until told; keep stray `.claude/*` edits OUT of scope).

---

## DONE — Phase 1 (header ticker rails), compile-verified, NOT committed

The 3 Market-Wrap marquees now live in the global header instead of the Wrap tab.

- **NEW** `app/components/shared/TickerRails.js` — the 3 rails (`Indices` · `Commod·FX`
  · `News`) + their data derivation + the local helpers (`cls/apct/fmt/sdot`) + the
  `TickerLine` presentational sub-component. Props: `premarket, macro, marketNews,
  region='india'`. Region defaults to India (Wrap keeps its own interactive toggle).
- `app/page.js` — imports `TickerRails`; renders `<TickerRails premarket={premarket}
  macro={macro} marketNews={marketNews} />` in the header, under the net-worth hero
  (inside `.main-header`, after `.hdr-grid`).
- `app/components/tabs/MacroTab.js` — removed the 3 `<TickerLine>` calls + their now-
  orphaned derivations (`idx/fx/newsRaw/news/q/dxy`), the local `TickerLine` def, and
  the orphaned `sdot` helper. Kept `showIN/showUS`, `c/ind/ivix/asOf` (used elsewhere)
  and the full `NewsFeed`.
- `app/globals.css` — added `.hdr-rails` wrapper (margin + `overflow:hidden` backstop;
  each `.tkw/.tkv` already clips, so marquees are cert-safe by construction).

All four verified with `npx esbuild <file> --loader:.js=jsx` (see gotchas). NOT yet
render-verified or certified — do that first in Claude Code.

Deferred out of Phase 1: stripping the asset-class cards from the header. They stay as
nav until Phase 2's sidebar exists (removing them first would break navigation).

---

## Environment gotchas discovered this session (READ before touching files)

1. **Mount writes can TRUNCATE.** A `page.js` edit silently cut the file off mid-token
   at line 1348 (the failure `feedback.md` warns about). ALWAYS re-verify after any
   edit: `wc -l`, `tail`, and esbuild. If truncated, rebuild from the object store:
   `git show HEAD:app/page.js > /tmp/x.js`, reapply edits in `/tmp` (local FS, safe),
   verify, then `cp` back and re-verify byte-identity (`diff`).
2. **Verify JSX fast, no dev server:** `npx esbuild@0.21.5 <file> "--loader:.js=jsx"
   --format=esm >/dev/null` — parses/transpiles a single file; non-zero exit = syntax
   error. `next dev`/`next build` do NOT fit a 45s sandbox call and don't survive
   between calls. Full `certify.mjs` needs Chromium (absent) + a running dev server —
   run it on the Windows side.
3. **`MacroTab.js` has a pre-existing NUL byte (~line 573).** grep calls it "binary";
   SWC/Next tolerate it, esbuild does not. To esbuild-lint it: `tr -d '\000' <
   app/components/tabs/MacroTab.js > /tmp/mt.js` then esbuild `/tmp/mt.js`. Do NOT
   "fix" the NUL as part of this work — out of scope, and the app builds with it.
4. **Stale `.git/index.lock`** (from a crashed git process) blocks all git writes and
   can't be removed from the Linux mount (permission-mapped). Clear it Windows-side
   before committing: `del .git\index.lock` (with no git running).
5. **Global CRLF/LF mismatch** in the working tree — `git diff` reports ~236 files /
   ~38k lines of pure EOL churn. Normalize (`.gitattributes` / `core.autocrlf`) before
   committing Phase 1, or the real diff is unreadable. Pre-existing, not this work.

---

## DONE — Phase 0 (partial) + Phase 2, cert-green, committed on `shell-6region`

- **Phase 0 grid (partial):** `.main` doubles as the `.shell` grid — REDUCED to header/sidebar/
  main areas (base 1-col → ≥1024 `12rem minmax(0,1fr)`). The full 4-tier areas with widget/stats/
  footer land VERBATIM in Phases 3–4 (an empty widget/stats row now = broken intermediate). `.shell
  > *{min-width:0}` STRESSHARD-safe; `main` keeps its 1760px cap.
- **Phase 2 sidebar/pills:** `.shell-sidebar` (`.snav-*`) ≥1024 + `.tab-pills` (`.tpill-*`) <1024,
  ONE `tab/selectTab` drives both. Sidebar sticky beneath the header (`--snav-top` = measured
  header height, set by a ResizeObserver effect on `headerRef`). Asset-card strip (`.hdr-cards-wrap`)
  REMOVED from the header (Phase 1 deferral cleared); `headerCards` array kept computed for its
  Phase-4 move to Overview stats. `certify.mjs` ALL_SURFACES repointed indian/fd/mf/us/algo →
  `.snav-*` (`.hdr-hero`/`.pulse-pill` unchanged; hash nav is primary, click is a caught fallback).
- **Rails inline (user refinement 2026-07-06):** the 3 ticker rails moved from below the header into
  the hero row, running INLINE beside the NW hero. `.hdr-rails` spans the row behind the hero (z-1);
  the hero floats on a masking gradient panel (`rgba(--hdr-bg-base) 96%→0%`, z-2) so each marquee
  dissolves under the NW figure. `.tkw` is `row-reverse` (labels anchor on the RIGHT), frameless.
- **VERIFIED:** render-verified (sidebar ≥1024 / pills <1024 / nav both ways / cards gone / rails
  dissolve behind hero, day+night) + certify GREEN — docOverflow=0, RSP-001/002/004=0, SYMMETRY/
  DIRECTION/VALUE-SIZE PASS across 6 widths × both themes × normal + STRESSHARD.
- **NOTE:** `affordRun` (certify AFFORD mode, NOT in the default gate) targets the removed
  `.hdr-cards` strip — now obsolete (the header no longer has a scroll strip). Left as dead code;
  retire it in Phase 4 when the cards land in Overview stats as a non-scrolling stat grid.

---

## REMAINING — Phases 3–6 (build to `shell-6region-prompt.md`)

- **Phase 3** global footer: `FreshnessTag`/`SyncBadge`/data-as-of/AI-refresh/`CFMemo`
  tax memos/disclaimer out of the tabs.
- **Phase 4** per-tab main/widget/statistics slots per the locked map (see prompt table);
  `AnalysisCard` → statistics everywhere; build the NEW FD maturity-timeline widget.
- **Phase 5** certify GREEN (6 widths × both themes × normal + STRESSHARD, docOverflow 0)
  + render-verify each of the 7 tabs live.
- **Phase 6** commit to `shell-6region` (exclude `.claude/*`), no push unless told.

### Locked region map (main / widget / statistics; header/sidebar/footer are global)

| Tab | Main | Widget | Statistics (AI card always here) |
|---|---|---|---|
| Overview | Net-worth curve · projection | Allocation bar | Asset cards · SIP · cashflow · AI |
| Indian | Holdings table | Sunburst · day curve | Realized P&L · benchmark bars · AI |
| FD | FD ladder | ★ NEW maturity timeline | Principal · accrued · maturity · AI |
| MF | MF holdings | Sunburst · XIRR | Benchmark bars · AI |
| US | US holdings | Sunburst · day curve | Realized · dividends · benchmark · AI |
| Trading | P&L dashboard · analytics | Live F&O · monthly reco | F&O summary · loss c/f · AI |
| Wrap | Nifty-50 heatmap · sectors | Macro board · pre-market | FII/DII · sentiment · SWOT · NewsFeed |
