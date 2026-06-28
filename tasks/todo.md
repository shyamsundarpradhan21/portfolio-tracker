# Growth Card — Net worth ↔ Growth toggle (per spec)

Replace the `ProjectionTab` Value/Return toggle with **Net worth ↔ Growth**. "Net worth"
= existing value path, byte-for-byte. "Growth" = new ₹ curve (money made, deposits
stripped, re-baselined to 0 per window) + a ₹-counterfactual benchmark overlay.

## Phase 0 — Recon (DONE — reported, awaiting go-ahead for Phase 1)
- [x] Locate the ₹-counterfactual → `benchCounterfactual()` in `app/lib/calc.js:52`.
- [x] Confirm `loadPortfolio()` returns deposit arrays (TRANSACTIONS / MF_CASHFLOWS /
      US_CASHFLOWS / FDS) — yes, keyed exactly so in the private object.
- [x] Confirm server-reachable NW series — `snapshots:nw:<owner>` KV (api/snapshots),
      points {d, nw, invested, sl}; `invested` = cumulative net deposits.
- [x] Surface the nuances that shape Phase 1 (see report) — STOP before writing.

## Phase 1 — Server (commit 1, revertible) — DONE
- [x] `app/api/growth/route.js`: new mode `?view=growth&range=<1D|1M|6M|1Y|max>`.
- [x] Own growth line (₹) = (nw(t)−nw(winStart)) − (deposits(t)−deposits(winStart)),
      deposits from the loadPortfolio ledger (snapshot-`invested` fallback in degraded mode).
- [x] Benchmark counterfactual (₹): lifted the unit-replication core from
      `benchCounterfactual` (`levelOnOrBefore` + `units += amt/lvl`), extended to a per-date
      ₹ series (units×close(t) − deposits), re-baselined to 0 at window start. Whole-book
      dated deposit stream (Indian + MF + US×fx + FD). Flat-fx → currency-agnostic ratio.
- [x] range=max → Yahoo `5y`/`max`; non-max bumped to 5y if inception predates 2y.
- [x] 1D special: bench from `/api/intraday?kind=nifty` (Nifty only, scaled to ₹ on the
      investable base); own line null (client-supplied live P&L). Others null on 1D.
- [x] Returns `{view, range, points:[{d, growth_inr, bench:{…}}], available:[…]}`.
      No private ledger in the response; force-dynamic + no-store kept.

### Phase 1 REVISION (commit 2 of Phase 1) — verification caught 3 real issues
Real-data verification (pulled prod KV snapshots via Vercel MCP) caught: (A) CMPF phantom
gain — NW−ledger-deposits double-counted the ₹9.58L CMPF corpus (~₹8.7L phantom); (B) only
5 recorded NW snapshots exist server-side → snapshot-sourced own line collapses on long
windows; (#3) 1D base included CMPF (56% overstatement); (#4) deposit logic forked.
Fixes (all done):
- [x] Own line → cumulative INVESTMENT-sleeve (eq+us+fd+mf, **exclude cmpf**) daily P&L from
      the 365-day `growth:<date>` archive, re-baselined to 0 per window. Deposit-free, deep,
      no CMPF. Commented: summed P&L (no compounding) drifts slightly under true on long
      windows + differs from the bench's unit-replication basis; reconstruct from NW deltas
      if it ever must match exactly.
- [x] 1D `investableBase` excludes `pf` (CMPF) → consistent with the 1M+ deposit basis.
- [x] Extracted `app/lib/deposits.js` `buildDepositLedger(arrays)` — ONE pure impl both
      `deriveProjInputs` (client) and the route consume; now includes the swing-exits term.
      Proven behavior-preserving: deriveProjInputs net + monthly contribution byte-identical
      on real data (net ₹1,238,740, ₹103,000/mo old==new).
- [x] Revised suite (17 assertions) green; own line returns real local data; homepage 200.
- [x] Push branch → Vercel preview (real KV) → hit ?view=growth all ranges → GREEN.
      1D: 376 intraday pts, own null (client-supplied), bench.nifty ₹−6,068…9,198 ✓.
      1M/1Y/max: own ₹32,626/₹1.25L/₹1.33L, bench believable, == local. CMPF excluded.
      (Preview was SSO-gated; user disabled Deployment Protection for the fetch — RE-ENABLE.)

## Phase 2 — Client (commit 3, revertible) — DONE
- [x] `GrowthView.js`: fetches `/api/growth?view=growth&range=&fx=`; window 1D·1M·6M·1Y·Max;
      two+ ₹ lines (own solid --acc, benchmarks dashed); reuses PerformanceCurve chrome
      (pjx-cmp chips, smoothPath, niceScale/RsSvg, pjx-perf-legend with ₹ deltas, NO +/-
      glyph — direction by colour), 0-baseline emphasised. 1D own line = merged intraday
      tape (mergeLiveTapes, client live P&L) vs Nifty intraday bench. Range/data race guard
      (only render when data.range === range) — caught a NaN-path bug in render-verify.
- [x] `ProjectionTab.js`: toggle relabelled Net worth ↔ Growth (view 'return'→'growth'),
      renders GrowthView (PerformanceCurve import dropped), footnote block deleted, scrubber
      disabled on growth. Value/projection path untouched (verified: scrubber+pills+NW curve).
- [x] Render-verified live: Max ₹1.33L vs Nifty ₹49,451 · 1M ₹32,626 vs ₹29,207 · 1D
      ₹1,239 live (own accumulating tape) — no NaN, 0 console errors on clean load,
      direction by colour, CMPF excluded. Net worth view intact on toggle-back.
- [x] `certify.mjs`: Overview (this change's tab) = 004:0 across all 6 widths × both themes
      on the canonical gate. Pre-existing 004 clips on indian/fd/mf/us @768 are unrelated
      (no globals.css change; those tabs import none of the changed files). STRESSHARD is a
      broad torture probe (every tab fails) — not the merge gate.

## Post-ship fix (commit 4) — benchmark chips missing on protected deployment
Symptom: on the SSO-protected preview the Growth view showed the own line but NO benchmark
chips/lines. Root cause (confirmed via runtime logs: 22 /api/growth calls vs only 2
/api/history): the route did a server-side **self-fetch** to `${origin}/api/history` (+
`/api/intraday` for 1D), which a protected deployment blocks at the edge (no auth cookie on
the server-internal request) → `available: []`. The browser's own calls succeed because the
USER is authed — that's why it worked with protection off and breaks with it on.
- [x] Extract `app/lib/yahooHistory.js` (`fetchYahooSeries`/`Many`); /api/history + the
      growth route both use it — Yahoo called DIRECTLY, no self-fetch. No fork.
- [x] 1D Nifty bench reads KV `intraday:nifty:<date>` + the committed niftyOhlc archive
      directly (no /api/intraday self-fetch).
- [x] Local: history route unchanged shape; growth available=[all 7] via direct Yahoo.

## Review — Net worth ↔ Growth (DONE, shipped & live-verified)
Replaced the ProjectionTab Value/Return toggle with **Net worth ↔ Growth**. Net worth =
the untouched value + projection-scrubber path. Growth = a ₹ "money made" curve (investment
sleeves, CMPF excluded, from the 365-day growth archive) overlaid with a same-dated-rupees
benchmark counterfactual in ₹, re-baselined to 0 per window (1D·1M·6M·1Y·Max); 1D own line
is the client's live accumulating intraday P&L vs Nifty intraday.

Commits (origin/claude/ecstatic-wozniak-svdlxb): `b80054a` server route → `3342396` revision
(CMPF fix + shared `buildDepositLedger`) → `4612cf9` client toggle + `GrowthView` → `ad224d6`
no-self-fetch fix → `c928040` cleanup (drop `PerformanceCurve`, file @768 task) → `c4dfea2`
build nudge. (The feedback/review docs commit is local — push on "push".)

Verified: 17-assertion math suite; `deriveProjInputs` behavior-preserving; live render-verify
(caught a NaN race + the CMPF phantom-gain + the self-fetch bug); certify Overview-clean;
fix confirmed LIVE on the protected preview via the bypass (`available:[all 7]`, screenshot
shows all chips + the Nifty line).

Key lessons recorded in `feedback.md`: never server-side self-fetch a sibling API route
(Deployment Protection blocks it); verify against real KV/prod data, not just local.

## Open / optional (not started — user's call)
- Fix the pre-existing @768 certify clips — see `tasks/responsive-768-clips.md` (filed, deferred).
- Merge the branch to `main` when ready (awaiting "merge"/"ship").
- Deployment Protection is back ON (re-enabled after the verification fetch). ✓

### Phase 1 verification
- Existing modes (`?days=N`, single-date) unaffected — `?days=30` still serves.
- New endpoint returns valid shape, no 500, at all ranges (empty points locally — KV
  snapshots are empty in dev; computes live in prod where KV is populated).
- Pure math proven by a 17-assertion synthetic harness: deposit-ledger signs,
  cumulative deposits, the counterfactual (100@idx100 + 100@idx200 → ₹250 @idx300),
  per-window re-baseline to 0, and deposit-stripping (mid-window 10k deposit excluded).

## Phase 2 — Client (commit 2, revertible)
- [ ] `ProjectionTab.js`: relabel toggle → "Net worth" (value, untouched) / "Growth"
      (new). Delete the old NAV footnote. Scrubber stays value-only.
- [ ] New `app/components/shared/GrowthView.js` — fetches the route, renders two ₹ lines
      (yours solid `--acc`, benchmarks dashed), window selector `1D·1M·6M·1Y·Max`, reuses
      PerformanceCurve chrome (pjx-cmp chips, smoothPath, seam dashing, pjx-perf-legend
      showing ₹ delta not %), zero-baseline emphasised. Owns zero private data.
- [ ] 1D: own line vs Nifty intraday only; hide non-Nifty chips. Honest blanks otherwise.
- [ ] `certify.mjs` passes at all breakpoints × both themes before merge.

## Open decisions (flagged in the report — confirm before Phase 1)
1. Max bench span → 5y (recommended; route already allows it).
2. 1D own-line "live P&L" source: client-supplied (it already has dayGain) vs server
   re-derive from eq/us intraday + fx. Recommend client-supplied to stay truly live.
3. Bench deposit source: raw cross-sleeve ledger (accurate) vs snapshot invested-deltas
   (simpler). Recommend raw ledger.

## Constraints
- --fs-* tokens only; private data server-side only (no deposit ledger in client bundle);
  two revertible commits (server then client); commit to current branch; no footnote;
  don't touch the certified Net-worth/value path; lift the counterfactual, don't reinvent.

---

# Algo Tab → "Trading Journal" redesign (STEP 2 — implementation plan, AWAITING APPROVAL)

STEP 1 done: metric audit + render-mock approved across all 4 sub-tabs.
Mock: `audit/responsive/algo-journal-mock.html` (gitignored). IA = 4 sub-tabs:
Overview · Summary · Review · Analytics. This plan implements it for real. NOT started.

## Decisions locked (from STEP 1)
- Returns % denominator = **deployed (utilised) capital** (`fnoLive().byStrategy.*.fundsUsed`).
- Least Profitable Day already exists (`summaryStats.leastProfit`) — just surface it.
- Profit Factor = Σ(win-day net) / |Σ(loss-day net)| — NEW in summaryStats.
- F&O Realised table is broker-wise (broker × FY net + all-time + charges + days).
- Analytics = cumulative curve (S01/S02/Overall vs Nifty) · Performance (Cum Return, CAGR)
  · Best-vs-Worst duration · Key Metrics table · Efficiency Ratios table · Worst-5 DD · Underwater.

## Phase A — pure calc layer (`app/lib/pnlDaily.js` + tests first) — commit 1
- [ ] `seriesByStrategy(rows)` — split `dailySeries` per sleeve (S01=Dhan+Zerodha, S02=Upstox+Fyers) + combined.
- [ ] Extend `summaryStats`: add `profitFactor`, `winSum`, `lossSum` (sum of +/− day nets).
- [ ] `returnsPct(net, deployed)` — net ÷ utilised capital.
- [ ] `equityCurve(series)` — cumulative net, rebased to 0 per window; window slice 1M/3M/6M/Max.
- [ ] `cagr(series)`, `volatility(series)` (annualised σ of daily returns).
- [ ] `drawdownSeries(series)` → underwater %; `drawdownEpisodes(series)` → worst-N {depth, peak, trough, recoveryDays}; `maxDrawdown`, `avgDrawdown`.
- [ ] `bestWorstWindows(series, win)` — strongest/weakest rolling window curves.
- [ ] `sharpe`, `sortino`, `calmar`, `alpha`, `beta` (vs benchmark daily returns).
- [ ] `riskReward(stats)`, `freqOfTrade(series, orders)`, `successRatio` (=winPct), `riskOMeterBand()` → Low/Moderate/Elevated/High.
- [ ] Extend `app/lib/pnlDaily.test.js` — one case per new fn (edge: empty, single day, all-wins, all-loss, flat).

## Phase B — benchmark data (daily NIFTY 50) — commit 1 (same)
- [ ] Decide source: `app/lib/yahooHistory.js` daily ^NSEI close over window (already have intraday `nifty-ohlc.json`; analytics needs *daily* closes). Confirm route vs build-time.
- [ ] Expose a daily Nifty close→returns series to the client for alpha/beta/benchmark curve
      (public market data, so a cached `s-maxage` route is fine — NOT force-dynamic).

## Phase C — components — commit 2
- [ ] `AlgoTab.js`: top-level 4 sub-tab segmented control (persisted to localStorage), accent per tab.
- [ ] **Overview**: reuse existing `PnlDashboard` (Day/Month/Year/All + IntradayChart already built) + the 6-card statgrid (add Profit Factor, Returns%, surface Least-Profitable). Header capital line stays.
- [ ] **Summary**: F&O Positions (broker split: utilised/available from `fnoLive().brokers[].funds`) + broker-wise F&O Realised (from `fnoRealized`/ledger by broker×FY).
- [ ] **Review**: cadence segmented control (W/M/Q/SA/A) + AnalysisCard wired to `insights.trading` scoped to the window (placeholder copy until insights feed extended).
- [ ] **Analytics**: new `AnalyticsTab.js` — cumulative multi-line curve (reuse PerformanceCurve/scaleLines chrome), best-vs-worst, underwater, Key-Metrics table, Efficiency-Ratios table, Worst-5 DD table. Period (1M/3M/6M/Max) + Overall/S01/S02 toggles drive the slice.
- [ ] Wire props in `app/page.js` (pass benchmark series + existing FY/ALGO/fno props).

## Phase D — verify — before "done"
- [ ] `npm test` green (pnlDaily.test.js).
- [ ] Live render-verify in the running app (real ledger data) — figures sane vs current AlgoTab.
- [ ] `node audit/responsive/certify.mjs` GREEN normal + stress (layout/CSS change → mandatory gate).
- [ ] reviewer pass on the diff; then commit to current branch.

## Open questions before coding
- Benchmark: build-time committed daily Nifty series vs a cached route? (leaning cached route)
- Per-strategy equity needs each ledger row's sleeve — confirm `fno-ledger.json` rows carry `sleeve` (S01/S02) for ALL brokers, else map broker→sleeve.
- Risk-o-meter band thresholds (what σ / drawdown → Low/Moderate/Elevated/High)?

## Constraints
- --fs-* tokens only; colour-only direction (no +/− glyphs in figures); both themes; certify-gated.
- Pure calc in `pnlDaily.js` (no JSX); private data rules unchanged; commit to current branch.
- Reuse existing chrome (PnlDashboard, IntradayChart, PerformanceCurve, .statgrid, .tbl) — don't reinvent.
