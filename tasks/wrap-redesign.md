# Wrap tab — Koyfin-style rebuild (Phase 1c)

Locked design after render iteration (HTML mockups in chat). Build for real in
`app/components/tabs/MacroTab.js` + data routes. Keyless-first; one keyed API (FMP)
for the econ calendar (and Phase-2 estimates), graceful no-op until the key is set.

## Locked layout (per region, India · Global · All toggle; default All)
1. **KEPT**: Portfolio-overview (AI pulse) + India/US SWOT — unchanged, pinned on top.
2. **Animated 3-line ticker** — (a) benchmark indices, (b) commodities·FX, (c) market
   news. Marquee scroll (opposite directions), hover-to-pause. Region-aware content.
3. **Row: [Sectors card] | [Portfolio news]**
   - Sectors card = sector heatmap + **breadth (% advancing by cap tier + A/D ratio
     header)** + **FII/DII net-composition chart** (below).
   - Portfolio news = sentiment cards: company **tag** + headline + source·time, card
     tinted **green/red** by news sentiment; 2-col, scrollable.
4. **Macro card** — sliders grouped Rates · Inflation · Growth · Labour; knob =
   **1-yr percentile**, with **min/max endpoint labels**; zone colour = regime
   (calm/watch/stress).

### FII/DII chart (final behaviour)
- Bars = FII (teal) + DII (violet) **stacked to the net**, white tick = net.
- **No legend.** **No permanent latest-highlight.**
- **Hover a column** → that column highlights (others dim) **and** the caption shows
  that date's `FII / DII / net`. **Mouse-out** → caption = 15-session summary
  (`FII Σ · DII Σ · net Σ · N up / M down`). Trail data already exists (lib/fiidii + KV).

### Region toggle
- India: NSE sectors+breadth, India rail, India macro (VIX/10Y/repo/CPI/IIP/PMI),
  India-holding news. Global: US SPDR sectors (breadth = n/a, no free US feed), world
  rail, US macro, US-holding news. All: combined.

## Data sourcing
| Block | Source | Key? |
|---|---|---|
| Sectors / breadth (A/D) / India VIX / Nifty | NSE `allIndices` (extend existing call — it carries `advances`/`declines`/`unchanged`) | keyless |
| Benchmarks / commodities / FX rail | Yahoo v8 (existing `/api/premarket` cues+sessions) | keyless |
| FII/DII trend | NSE fiidii + existing trail (localStorage/KV) | keyless |
| Macro sliders + 1-yr percentile | FRED `fredgraph.csv` (series + 1-yr window for percentile): DGS10, T10Y2Y, BAMLH0A0HYM2, DFF, CPIAUCSL, CPILFESL, PCEPILFE, GDPC1, UNRATE, PAYEMS, ICSA, UMCSENT; India: FRED India CPI/repo where available | keyless |
| Market news + portfolio-holding news (+ sentiment) | RSS (Yahoo per-symbol, Moneycontrol/ET, CNBC); simple lexicon sentiment | keyless |
| Econ calendar (+ Phase-2 estimates) | **FMP** free tier | **key** (env `FMP_API_KEY`, graceful no-op until set) |

## Staged build (build + `npm test` gate each)
- [ ] **S1 — data: breadth A/D.** Extend `mapAllIndices` to emit `advances/declines/
      unchanged` per index → breadth A/D + % advancing by cap (Nifty50/Midcap100/
      Smallcap100). Unit-test mapper. Verify fields on Vercel preview.
- [ ] **S2 — data: macro + percentile.** New/extended route returns each FRED series'
      latest + 1-yr percentile + regime tone. Pure percentile fn unit-tested.
- [ ] **S3 — data: news.** New `/api/news` (market RSS) + `/api/portfolio-news`
      (per-holding RSS, server-reads holdings) with lexicon sentiment. Tolerant parse.
- [ ] **S4 — UI: MacroTab rebuild.** Strip to KEPT (overview+SWOT). Build ticker,
      sectors+breadth+FII/DII card (hover interaction), portfolio-news sentiment cards,
      macro percentile sliders, region toggle. Reuse `data-driven` label rules.
- [ ] **S5 — calendar (FMP).** Wire FMP behind `FMP_API_KEY`; no-op cell until set.
- [ ] **S6 — verify.** Build + tests; Vercel preview check each feed live; `prefers-
      reduced-motion` disables ticker animation; mobile/responsive pass.

## Notes / rules
- Honour feedback.md: data-driven UI text (no hardcoded numbers/dates), sign via
  colour, `--fs-*` tokens, theme-following colours, graceful `stale`/`n-a` never faked.
- `prefers-reduced-motion`: freeze the ticker.
- Keep `market-wrap.json` fallback intact (Phase 1a).

## Review
(fill after build)
