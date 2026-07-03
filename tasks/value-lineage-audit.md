# Value-Lineage Audit — every rendered value and where it's captured

Audited 2026-07-02 by 8 parallel read-only auditors (one per surface + one for the data
backbone). Scope: every card, figure, badge, footer/subtext, tooltip and chart series in
`app/`, traced JSX ← state/prop ← fetch/hook ← route/lib ← KV key / data file / external
API ← generating script + cadence. File:line refs are as of commit `f8f956b`.

---

## 0. Capture families

Every chain in this document terminates in one of these:

| # | Family | How it's captured | Cadence |
|---|---|---|---|
| **F1** | **KV `portfolio:v1`** — private book (INDIAN/US/SWING holdings, TRANSACTIONS, CORPORATE_ACTIONS, FDS, LOAN, MF_*, CMPF/CMPS, PAYSLIPS, STATIC, ALGO, PROJECTION, INDIAN/US_REALIZED, US_DIVIDENDS, benchmark lists) | Edit gitignored `data/portfolio.private.json` → `scripts/seed-portfolio-kv.mjs` (empty-data sanity guard refuses a wipe). Served only via `/api/portfolio` (force-dynamic, no-store) → render-gate hydration (`page.js:184` → `hydratePortfolio`/`hydrateAppData`); private figures never ship in the JS bundle | Manual seed |
| **F2** | **Broker sync** — `data/broker-state.json` (SWING=Upstox holdings, F&O=Dhan/Upstox/Fyers positions+funds), `fno-ledger.json` (daily realised rows), `trades-log.json` | `scripts/sync-brokers.mjs` (read-only broker APIs; commits+pushes). INDIAN (Zerodha/Kite) is NOT in the headless sync — the manual Kite MCP reconcile routine writes `holdings.INDIAN`. Real contract-note charges from KV `ledger:fno:overlay` (contract-note parser → `build-fno-overlay.mjs`) are applied at request time in `/api/portfolio` | Daily 08:30 + 18:30 IST tasks; overlay manual |
| **F3** | **Capture daemon** — KV `intraday:<date>` (F&O), `intraday:eq:<date>`, `intraday:us:<date>`, `intraday:nifty:<date>` (all TTL 3d) + committed archives `fno/eq/us-intraday.json`, `nifty-ohlc.json` | `scripts/capture-daemon.mjs`: F&O MTM every 10s, IN equity day-change every 60s (Σ qty×(price−prevClose), Yahoo), US session (18:45→02:30 IST) 60s, NIFTY 1-min OHLC ~1/min; archives committed once at session close. Task Scheduler: CaptureIntradayIndia 09:10 + at-logon resume; CaptureIntradayUS 18:40 | Live during sessions |
| **F4** | **Nightly records** — KV `growth:<date>` (per-sleeve day-change, TTL 35d) + `data/growth.json`; KV `snapshots:nw:<owner>` (daily NW, cap 800) + committed `data/SNAPSHOT.md` / `snapshot-sleeves.json` | Growth: Vercel cron `/api/snapshot` 03:00 IST + host `snapshot-growth.mjs` (`upsertGrowth` skip-not-zero). Snapshots: recorded by the app itself on any fully-valued load (`page.js:1051` → POST `/api/snapshots`; ±30% day-move plausibility guard client AND server) and harvested headless nightly by `record-snapshot.mjs` into the committed files | Nightly |
| **F5** | **Live public APIs** (server routes; all `AbortSignal.timeout` + fall back to last-known) | Yahoo v8 chart (`/api/quotes` — 15-min client poll, `/api/history` 5y weekly, `/api/fx-history` INR=X, `/api/nifty-daily` ^NSEI); AMFI `api.mfapi.in` (`/api/mf-nav`, 24h cache, fallback casNav); FRED; NSE (allIndices, fiidiiTradeReact, participant-OI CSV); CNN Fear&Greed; MoSPI e-Sankhyiki; ForexFactory; RSS/Google News | Per request, CDN `s-maxage` |
| **F6** | **Hand-curated seeds & harvests** | `data/fno-verified.json` (ITR-verified FY seed — annual ritual); Vested statements → US_REALIZED / US_DIVIDENDS (asOf 08 Jun 2026, reseed to refresh); `vol_pnl.json`; `held-algos.json`; Stratzy browser harvest → `stratzy-daily.json` → `build-algo-screen.mjs`/`build-monthly-reco.mjs` → KV `algo-screen:v1` / `algo-monthly:latest` | Manual / monthly |
| **AI** | `/api/insights` → Claude `claude-haiku-4-5` | Fired ONLY by the ✨ toggle; cached `localStorage nwTracker.insights`. ₹-figure guard lives in the system prompt (`insights/route.js:95-111`) — prompt-level only, no post-response scrub | User-triggered |

Client-side last-known behavior: every Wrap/quote feed hydrates from
`sessionStorage nwTracker.*` on mount and only overwrites on a successful fresh fetch —
failed refreshes silently keep last-known data.

---

## 1. Source registry

### 1.1 KV keys

| Key | Holds | Writer + cadence | Readers |
|---|---|---|---|
| `portfolio:v1` | Entire private book | `seed-portfolio-kv.mjs` (manual; guard) | `loadPortfolio()` → `/api/portfolio`, `/api/mf-nav`, `/api/portfolio-news`, `/api/growth`, `/api/snapshot` |
| `intraday:<date>` | F&O tape `{tape,fills}` (TTL 3d) | daemon 10s (`captureTick`) | `/api/intraday?kind=fno` |
| `intraday:eq:<date>` | India-equity day-change tape (TTL 3d) | daemon 60s (`captureEquityTick`) | `/api/intraday?kind=eq` |
| `intraday:us:<date>` | US day-change tape in INR (TTL 3d) | daemon SESSION=us 60s | `/api/intraday?kind=us` |
| `intraday:nifty:<date>` | NIFTY 1-min OHLC (TTL 3d) | daemon ~1/min (`publishNifty`) | `/api/intraday?kind=nifty`; `/api/growth` (direct KV) |
| `growth:<date>` | Per-sleeve day-change record (TTL 35d) | `/api/snapshot` cron 03:00 IST; `snapshot-growth.mjs`; `backfill-growth.mjs` | `/api/growth` |
| `snapshots:nw:<owner>` | Daily NW snapshots `[{d,nw,assets,invested,sl}]`, cap 800 | POST `/api/snapshots` from the client render loop; `record-snapshot.mjs` nightly | GET `/api/snapshots`; `/api/growth` |
| `premarket:fiidiiTrail` | FII/DII cash trail, cap 20 sessions | `/api/premarket` per Wrap fetch + daily cron | `/api/india-sentiment`, `/api/premarket` |
| `ledger:cn:<note>` + index | Checksum-verified contract notes | `contract-parser/run.py` (manual) | `build-fno-overlay.mjs` |
| `ledger:fno:overlay` | Real NCLFO charges by Broker\|date | `build-fno-overlay.mjs --write` (manual) | `/api/portfolio` (`applyFnoOverlay`) |
| `fyers:refreshToken` | Fyers token handoff | `sync-brokers.mjs` | `sync-brokers.mjs` (cloud) |
| `algo-screen:v1` | Unbiased algo screen payload | `build-algo-screen.mjs` (monthly/manual) | `/api/algo-screen` |
| `algo-monthly:latest` | Monthly conviction decision | `build-monthly-reco.mjs` (monthly) | `/api/algo-monthly` |
| `stratzy-daily:v1` | Per-algo live/backtest series | `import-stratzy-daily.mjs` (manual harvest) | **no app reader** (scripts read local file) |
| `algo-catalog:v1` | Dhan Algos catalog | `import-dhan-catalog.mjs` (manual) | **no app reader** (research feed) |

Monthly reviews are deliberately NOT in KV — `loadAlgoReview` reads only local
`data/algo-monthly/reviews/`.

### 1.2 data/*.json (committed = generated, never hand-edit; gitignored = private/regenerable)

| File | Generator + cadence | App consumer |
|---|---|---|
| `broker-state.json` | `sync-brokers.mjs` daily (INDIAN via manual Kite reconcile) | `/api/portfolio` `_app` → `APP.brokerState`; `/api/snapshot`; `equity.mjs` |
| `fno-ledger.json` | evening sync `appendLedger`; history `backfill-fno-ledger.mjs` | `/api/portfolio` (+ overlay) |
| `trades-log.json` | evening sync `appendTrades` | none (durable record) |
| `market-wrap.json` | `wrapFyers` in sync (laptop) | static import `page.js:13` (currently a dead prop into MacroTab) |
| `fno/eq/us-intraday.json`, `nifty-ohlc.json` | daemon per-tick appends; ONE commit at close | `/api/portfolio` `_app`; `/api/intraday` fallback |
| `growth.json` | `snapshot-growth.mjs` nightly; `backfill-growth.mjs` | `/api/growth` fallback |
| `broker-tax.json` | `parse-broker-tax.py` over `data/reports/` (manual) | `/api/portfolio` (fnoRealized); seed overlay |
| `fno-verified.json` | hand-curated (annual ITR) | `/api/portfolio` (fySeed) → `deriveFY` |
| `vol_pnl.json`, `us_trades.json`, `indian_exits.json` | hand-curated / report imports | `/api/portfolio`; `/api/growth` (deposits) |
| `snapshot-sleeves.json` + `SNAPSHOT.md` | `record-snapshot.mjs` nightly (headless harvest, commits) | `/api/portfolio` → `historicalSnapshots()` |
| `nifty50.js` | hand-updated constituents (asOf 2026-06) | `/api/nifty50` |
| gitignored: `portfolio.private.json` (SOURCE OF TRUTH), `stratzy-*.json`, `dhan-full.raw.json`, `algo-catalog*.json`, `algo-screen.json`, `held-algos.json`, `regime-inputs.json`, `algo-monthly/**`, `reports/`, `.kite-*.json` | see §0 F1/F6 | seed + screen/reco scripts |

### 1.3 API route policies (cache / fallback)

| Route | Cache | Fallback |
|---|---|---|
| `/api/portfolio` | no-store | 503 if KV+file empty; overlay degrades to committed ledger |
| `/api/intraday` | no-store | KV 6s → committed archive (`archived` flag) |
| `/api/growth` | no-store | KV MGET → `growth.json`; Nifty tape KV→archive; sources called DIRECTLY (no sibling self-fetch — Vercel-protection rule verified) |
| `/api/snapshot` (cron) | no-store | CRON_SECRET; per-sleeve allSettled, skip-not-zero |
| `/api/snapshots` | no-store | `stale:true` empty; POST rejects >30% day moves |
| `/api/algo-screen`, `/api/algo-monthly` | no-store | KV → gitignored local JSON → null |
| `/api/quotes` | s-maxage=60, swr=300 | Yahoo 2-host failover; failed symbols dropped |
| `/api/history`, `/api/fx-history`, `/api/nifty-daily` | s-maxage=3600, swr=86400 | per-symbol null / empty closes |
| `/api/mf-nav` | s-maxage=86400, swr=43200 | last-known casNav |
| `/api/premarket`, `/api/nifty50` | s-maxage=90, swr=300 | per-cue `{stale}`; NSE→Yahoo |
| `/api/india-sentiment`, `/api/us-sentiment` | s-maxage=300, swr=1800 | per-signal stale; client fearGreed fallback |
| `/api/macro` | s-maxage=120, swr=600 | per-metric stale |
| `/api/macro-board` | s-maxage=3600, swr=86400 | per-cell stale; >366d obs guard |
| `/api/econ-calendar` | s-maxage=10800 (600 on fail) | `usSource:'unavailable'`; India computed locally |
| `/api/news`, `/api/portfolio-news` | s-maxage=600, swr=3600 | merge-what-resolves; portfolio-news no-store w/o KV |
| `/api/insights` | uncached POST | no key/model error → EMPTTY insights, HTTP 200 |

---

## 2. App shell + header/hero (`page.js`, `layout.js`)

Shared chains: **[P]** = `/api/portfolio` → KV `portfolio:v1` + `_app` committed JSONs (F1);
**[Q]** = `doRefresh()` 15-min poll → `/api/quotes` → Yahoo (F5); `INR=X` → `usdInr`;
`fxRate = usdInr || 88`.

| Value | Capture |
|---|---|
| **Hero net worth** | `ov.nw = indianEq.val + usData.val×fxRate + fdValue + mf.totVal + cmpfCorpus(now) − loanOutstanding(now)` (page.js:700-719). indianEq = `applyCorpActions(INDIAN)` [P]×[Q] + SWING broker-reconciled [F2]×[Q]; US [P]×[Q]×fx; FD = quarterly `compound()` from open+rate+clock; MF = units × AMFI NAV (fallback casNav); CMPF = contributions×2 + FY-rate sim (`cmpf.js`); loan = EMI simulation. `AnimatedNumber → InrC`; `.ath-moment` on all-time-high vs snapshot history; gated on live pricing |
| Assets figure + tooltip + "(incl. ₹ CMPF)" | `ov.totalAssets`, per-sleeve `inrFull` breakdown, `ov.pfValue` |
| "incl. trading ₹Y" + tooltip | `ov.nw + STATIC.algo + ytdTotal`; ytd = `FY.s01.current.net + FY.s02.current.net` (100% owner) ← `deriveFY(fno-verified seed + fno-ledger + charge overlay)` |
| Liabilities | `ov.loan`; red-by-color |
| Header cards (Indian/MF/FD/US/Trading) | Sleeve memos above; value `LiveInrC` (Trading: static `InrC` by design), sub `SInrC · pctS` via `cl()` |
| Topbar NSE/NYSE pills | `marketStateFromQuotes(prices)` — Yahoo per-quote `state` (holiday-aware), wall-clock fallback (`market.js:16`) |
| Status line | 'Connecting…' → 'Fetching…' → `Updated at HH:MM:SS` / `Cached (Xm ago)` / error |
| Theme | localStorage + `dayOrNight(geolocation)`; layout.js pre-paint 7am–7pm heuristic |
| Daily snapshot (invisible) | `{d, nw, assets, invested, sl}` → localStorage + KV `snapshots:nw:` (F4) once fully valued |

---

## 3. Overview tab

| Card | Values → capture |
|---|---|
| AI analysis (`AnalysisCard`) | `insights.overview` ← Claude; age chip `agoShort(ts)`; payload built from live memos (includes real ₹ as context) |
| Live P&L (`PortfolioLiveCurve`) | 12s poll `/api/intraday?kind=fno\|eq\|us&date=sessionIstIso()` → F3 tapes merged by `mergeLiveTapes` (`pnlDaily.js:167`); hover splits F&O/Equity/US in tab colors; hides <2 pts; session date rolls 06:00 IST |
| Projection scrubber (`ProjectionTab`) | see §10 |
| Allocation strip (`AllocBar`) | `projSleeves` (live: Indian/FD/US/MF jio/ELSS/CMPF values) or scrubbed drift (`PROJECTION.allocRules`); CMPF last + hatched; class split Equity/Hedged/Debt (hedged = arbitrage share of MF) |
| Capital deployment (`SipCard`) | All from ledgers [F1]: MF/US/Indian cashflows, FD flows, `CMPF emp×2`; US at dated FX from `/api/fx-history` (live fx until loaded); savings rate = gross deployed ÷ `PAYSLIPS.net`; heat grid = per-month net; sparkline median±MAD band |
| Wealth growth (`GrowthDashboard`) | `/api/growth?days=N` → KV `growth:<date>` + `growth.json` (F4); cumulative Σ per-sleeve nightly day-changes (CMPF INCLUDED here); waffle = largest-remainder sleeve mix |
| Loss carryforward (`CFMemo`) | `FY.cf.*` ← `fno-verified.json` (F6) pass-through; absorption `cf.currentRealised` derived live from ledger; FY names from `FY.labels` ✓ |

---

## 4. Indian tab

Chains: [B] INDIAN (F1) → `applyCorpActions` (calc.js:304 — **reconstructs post-bonus
qty/cost at render; ledger stores pre-corp-action**; bonus-only, splits NOT implemented);
[C] SWING (F1) → `reconcileSleeve` — broker qty/avg from `broker-state.json` OVERRIDE
curated, `inv` recomputed; [D] `indianRec` drift check vs `holdings.INDIAN` (manual Kite
reconcile — feeds SyncBadge only).

| Card | Values → capture |
|---|---|
| AI analysis | `insights.indian` ← Claude |
| SyncBadge + FreshnessTag | [D] `{source, syncedAt, drift}`; NSE state + `lastUpdate` |
| Equity P&L today (`EquityDayCurve kind=eq`) | seed `APP.eqIntraday` → 15s poll `/api/intraday?kind=eq` → KV `intraday:eq:` ← daemon 60s Σ qty×(price−prevClose) over INDIAN+SWING (F3). **Per-sleeve split discarded by `upsertPoint` — hover legs can never render** |
| Stat grid | Invested/Value/P&L/Day = [B]+[C] × Yahoo [Q]; CAGR = `weightedCagr(TRANSACTIONS + swing META dates)`; Realized YTD = `INDIAN_REALIZED.ytd` (F1, Zerodha tradebook offline, asOf 08 Jun 2026) |
| vs Benchmarks (`BenchmarkBars`) | you = `xirr(TRANSACTIONS + swing buys → live value)`; rows = `benchCounterfactual(hist.series[sym])` per `INDIAN_BENCHMARKS` (F1) ← `/api/history` 5y weekly; Winner/Drag/Largest minis from combined rows |
| Sector & Cap sunburst | Σ live val by ledger sector/cap; swing tags from hardcoded META (flag) |
| Holdings table | cells from [B]/[C]×[Q]; LTP flash by tick direction; dividers derive broker from `rec.source`; grand total "2 accounts" literal (flag) |
| Realized P&L panel | `INDIAN_REALIZED.{total, ytd, fy[], winners, losers}` (F1) |
| Portfolio Insights (`InsightsCard`) | β/α/Sharpe/σ/R²/ρ = weekly regression of basket vs ^NSEI (`computeBetaVol`, `/api/history`); NOT AI; uses curated SWING not reconciled (flag); `RF_ANNUAL=0.065` |
| Equity Tax CFMemo | **entirely hardcoded JSX** — ₹2,789 / ₹1,083 / FY24-25 ×3 / ₹1.25L ×2 (BUG, IndianTab.js:252-260) |

---

## 5. US tab

| Card | Values → capture |
|---|---|
| Stat grid | inv/val/P&L from `US[]` (F1, Vested-curated) × Yahoo; day = quote `pct`; CAGR = `weightedCagr(US_CASHFLOWS)`; ≈₹ subs × `fxRate` (fallback 88); Realized YTD = `US_REALIZED.ytdUsd` (F6 Vested lot-level, asOf 08 Jun 2026). **`usData` has no `valued` guard — partial quote outage understates P&L while rendering** |
| vs Benchmarks | you = `xirr(US_CASHFLOWS → usData.val)`; rows = `benchCounterfactual` into IVV/QQQ/EWG/FXI/GLD/BTC — subset hardcoded in JSX (USTab.js:68; 4 of 10 configured dropped) |
| Sector & Cap sunburst | ETF look-through via static `ETF_LOOKTHROUGH`/`ETF_CAP` weights (undated); `usSectorOf` overrides; unmapped stocks default 'Large' |
| Holdings table | USD Yahoo-priced cells; totals from `usData` |
| Realized P&L panel | `US_REALIZED` (F6); per-FY bars, winners/losers |
| Dividend Income | `US_DIVIDENDS` (F6 Vested statement): net/gross/tax/T12M/this-FY/top payers; "25% withholding" footer literal (flag) |
| Foreign tax CFMemo | `FY.cf.cgVerified.foreignStcg` = ₹27,694 ← `fno-verified.json` (ITR pass-through) ✓ |
| Day curve (`EquityDayCurve kind=us`) | KV `intraday:us:` ← daemon US session 60s; tape `{t, net(₹), usd, fx}` — INR at capture-time FX |

---

## 6. MF tab

| Card | Values → capture |
|---|---|
| Headline row | totCost = Σ `MF_FUNDS.cost` (F1); totVal = units × AMFI NAV (`/api/mf-nav`, 24h cache, fallback casNav → "Last-known NAV · 05-Jun-2026" literal `UNITS_AS_OF`); totRet derived |
| XIRR vs Benchmarks | port = `xirr(MF_CASHFLOWS → totVal)`; bench = cashflows replayed into AMFI benchmark NAV series; Δ chip label "vs Nifty 50" hardcoded vs data `benchName` (flag); extra bars = Yahoo counterfactuals per `INDIAN_BENCHMARKS` |
| Allocation ring | cap mix from per-fund `mcap` fractions (F1); class ring from **hardcoded fund-id whitelist** ('flexi','nifty50',…,'arb'; `debt:0`) — new fund ids silently drop (flag) |
| Holdings table | units/NAV/value/cost/return per fund; platform chips 'JioBLK'/'Zerodha' hardcoded strings + raw hex dots (flag) |
| Footers | SIP from `MF_SIP` (F1) ✓; seeds derived from cashflow ledger ✓; **ELSS unlock computed** from bought + `elssLockYears` ✓ |
| MF tax CFMemo | `FY.cf.cgVerified.mfStcg` ← `fno-verified.json` ✓ |

## 7. FD tab (+ pipeline/matured)

Everything computed live from open date + rate + clock — only principal/rate/dates stored
(F1). `compound(P,rate,yrs) = P·(1+rate/400)^(4yrs)`; recomputed on the hourly `now` tick.

| Value | Capture |
|---|---|
| Active deployed / accrued / at-maturity / blended rate | `deriveFds(now)` (page.js:118-155): Σ principal; Σ compound-accrued; Σ maturity value; principal-weighted rate |
| Table rows | bank/label/dates [F1]; progress % elapsed, accrued, maturity computed |
| Pipeline | planned open/maturity/amount [F1]; NEXT countdown computed; `tenure` is a stored label (can drift from dates — flag); footer "4 banks"/"₹40,000 TDS" literals (flag) |
| Matured cards | lifecycle derived from clock; early-close rows show full-term interest (stored `payout` ignored — observation) |

---

## 8. Trading (Algo) tab

Chains: C1 ledger = `APP.fnoLedger.rows` (F2 + real-charge overlay); C2 = `fnoLive()` over
`broker-state.json` (S01=Dhan+Zerodha, S02=Upstox+Fyers); C3 = `deriveFY(fno-verified +
ledger)`; C4 = `ALGO`/`STATIC` (F1); C5 = F3 F&O tape; C6/C7/C8 = algo screen / monthly
reco / review (F6 pipeline).

| Surface | Values → capture |
|---|---|
| Header card "Trading" | value `STATIC.algo` (static by design); sub = own-share FY P&L (C3×C4 split) |
| FreshnessTag | `FY.labels.current/verified`, `_lastCapture`, `_chargesReal`; `' · from Mon'` fallback literal (flag) |
| Capital line | `dep.total/used/free` ← C2 funds; fallback ALGO own capital |
| Six stat cards | `summaryStats(dailySeries(C1))` per period×broker: net (real-where-overlaid charges else est), win rate + donut, TWR returns on constant C4 base, profit factor, most/least profitable day, trading days + streaks |
| Year/Month heatmaps | quantile buckets (breakeven band ±5% of median \|net\|) over C1 daily nets |
| Day view | live MTM tape (C5, 12s poll, per-broker dashed legs — broker hexes hardcoded, flag), NIFTY 1-min candles + auto S/R (`niftyLevels`), buy/sell fill triangles (broker tradebooks ~1/min), realised row after evening sync; "3-day live cache" copy duplicates KV_TTL (flag) |
| Summary | capital composition from `ALGO.s01/s02` splits (F1); `brokerRealisedMatrix` per FY×broker over C1 |
| Review — AlgoMonthlyReco | KV `algo-monthly:latest` (C7): month, capital (client re-runs `allocateConviction` on edit; tier badge stays artifact-time), book summary, picks (KEEP/ADD/EXIT, vol-side chips, rank/sortino/DD rationale), warnings; last-month review from local reviews file (C8, null until first run) |
| Review — AlgoScreenReview | KV `algo-screen:v1` (C6): asOf = Stratzy harvest date (**days-stale by nature**), counts, held metrics (live-segment Sortino/CAGR/MaxDD/worstDay), structure outliers (median−2·MAD), flags, regime table (3y Nifty×VIX calendar), confront/dominance, capital tier + thresholds (surfaced from payload ✓) |
| Review — CF card | `FY.carryforward[]` ← `fno-verified.json` ✓ |
| Analytics (`AnalyticsTab`) | TWR paths (`cumPath` on C1/C4), CAGR, best/worst windows, summary stats, Sharpe/Sortino/Calmar/α/β vs `/api/nifty-daily` ^NSEI, drawdown episodes + underwater — pure `pnlDaily.js`; footer overclaims "real contract-note charges" (actual: real-where-overlaid, flag); literal `−` glyph on Avg Loss + always-green Success Ratio (flag) |

---

## 9. Macro tab + AI surfaces

| Surface | Values → capture |
|---|---|
| Ticker railines | `/api/premarket` cues ← Yahoo (^NSEI ^BSESN ^GSPC ^IXIC ^DJI ^N225 ^HSI, GC=F SI=F BZ=F INR=X ^TNX); India VIX + sectors ← NSE allIndices → Yahoo fallback; DXY ← `/api/macro`; news line ← `/api/news` RSS (CNBC/ET/MC/Google), keyword-lexicon sentiment |
| Pulse strip + SWOT cards | `insights.pulse` / `indian_swot` / `us_swot` ← one `/api/insights` POST → Claude Haiku; `swot.macro` is the only field allowed to cite public macro numbers; `pulse.drivers/drags` generated but never rendered (flag) |
| Sentiment cell | India: `indiaHeadline` blend (FII flow z-score .55 + VIX log-z .45) ← Yahoo ^INDIAVIX + KV FII/DII trail; US: CNN Fear&Greed composite + rows (Yahoo VIX term, FRED HY OAS, CNN put/call & breadth, ^GSPC vs 125D MA); client `fearGreed()` heuristic fallback |
| Hot sectors treemap | NSE sectoral / SPDR ETF day %; tile SIZES = hardcoded market-cap weight tables (flag, self-documented) |
| Day movers | India: `/api/nifty50` over static constituent list; US: Yahoo screeners, cap floor 10e9 |
| Portfolio news | `/api/portfolio-news`: top ~24 holdings by invested (from KV portfolio, server-side) → Google News RSS per company; 'Yahoo' source fallback misattributes (flag) |
| Econ calendar | India COMPUTED from release cadence (CPI~12th, WPI~14th, GDP quarter-end) + maintained `RBI_MPC_DATES`; US ← ForexFactory weekly JSON |
| FII/DII chart | KV `premarket:fiidiiTrail` (NSE cash, cap 20) + participant-OI derivatives stance (NSE CSV); ₹ Cr direction by color |
| Macro sliders | `/api/macro-board`: FRED series, Yahoo weekly, MoSPI India CPI/GDP/IIP, **hand-tracked RBI repo table** (staleness guard >366d); knob = linear range position while label says "%ile" (computed pctile never rendered — flag) |
| Regime accent | `classifyRegime(macro.live)` (FRED+Yahoo) → `data-regime` CSS tint; regime badge itself no longer rendered anywhere |

**AI-figure guard**: prompt clause `insights/route.js:104-107` — never quote portfolio ₹;
only public macro readings, only in pulse/`*_swot.macro`. Payload DOES contain real ₹
aggregates as context. No code-level post-filter (recommendation: regex scrub on non-pulse
fields). No violations found in rendering code.

---

## 10. Growth / Projection / Analytics

**Snapshot history** (`chartSnapshots`, page.js:1032): synthetic backfill (`buildBackfill`
from ledgers × Yahoo weekly + fx-history + NAV — `synth:true`, dashed) + committed
`SNAPSHOT.md`/`snapshot-sleeves.json` (F4) + real KV dailies; real wins from first real date.

| Value | Capture |
|---|---|
| NW line / invested dashed / today seam | snapshots above + live `ov.nw` |
| **XIRR** | `xirr()` over snapshot invested-deltas + terminal nw; ≥90d gate, sanity band (−0.5, 2) |
| Scenario rates | base = live XIRR ∓ `SPREAD` 0.03; long-run anchors + inflation + horizon from `PROJECTION` (F1); typed fallback `?? 0.12` only if data missing |
| **Contribution + step-up** | ✓ DERIVED via `deriveProjInputs`: trailing-12-mo net of `buildDepositLedger` (single shared deposit definition, client + `/api/growth`) snapped to ₹500; step-up = annualised payslip growth, clamped 0–25%, fading to inflation by yr 10 |
| Milestones / retirement flag | interpolated `MILESTONES` crossings; `cmpsRetirement` (fallback literal '2055-03-31', flag) |
| Growth pills + waffles | window NW change − deposits; MAX = Σ sleeve (v−i); attribution vs window-start snapshot `sl` |
| Growth view (₹ vs index) | `/api/growth?view=growth`: own line = running Σ `growth:<date>` sleeve nets (CMPF excluded); bench dashed = `buildDepositLedger` replayed into ^NSEI/^IXIC/000300.SS/^GDAXI/^FTSE/BTC-USD/GC=F (Yahoo weekly, DIRECT — no sibling self-fetch ✓); documented basis quirk: own line sums, benchmark compounds |
| Day attribution (closed-market rule) | client `daySleeveGain` (page.js:983): equity counts only if `premarket.sessions.*.asOf === today`; FD accrues `(P+accrued)×rate/365` daily; pf = `cmpfDailyAccrual`; server mirror in `scripts/lib/fd.mjs`/`cmpf.mjs`/`equity.mjs` + skip-not-zero merge |
| BenchmarkBars mounts | Indian (`eqStats`), US (`usStats`), MF (`mfx` + AMFI NAV benchmark) — all `xirr`/`benchCounterfactual` |

---

## 11. Findings

### 11.1 Hardcoded literals (house-rule violations, worst first)

1. `IndianTab.js:252-260` — **Equity Tax CFMemo fully hardcoded**: ₹2,789, ₹1,083, FY24-25 ×3, ₹1.25L ×2, Sec 112A, >12m. Only card with zero data source; rots after next ITR.
2. `page.js:614-620` — swing **META**: names/sectors/caps + `bought:'2026-02-09'` in component code; feeds sunburst, CAGR/XIRR cashflows.
3. `USTab.js:55` — "money-weighted · since Mar 2024" (derivable from first US cashflow); `USTab.js:200` — "25% US withholding" (derivable as tax/gross); `USTab.js:210` — statutory 12.5%/24m/112A prose.
4. `portfolio.js:40` — `UNITS_AS_OF='05-Jun-2026'` hand-bumped MF freshness date; `portfolio.js:42` — dead `REALIZED_PNL=-27862`.
5. **FX fallback drift**: `usdInr || 88` (page.js:383), `fx || 88` (deposits.js:25, projection.js:19, growth route default) but **`backfill.js:57` uses `?? 84`** — same concept, two numbers.
6. `cmps.js:20,22` — personal DOJ/DOB dates in lib source; `0.045` estimate rate; `cmpf.js:34,57` — silent `?? 0.076` rate fallback (changes hero NW unflagged).
7. `IndianTab.js:68,232` — "2 accounts" ×2; `:73,243` — "NSE LTP" provenance claim (actual source: Yahoo, delayed) + broker names in footer.
8. `MFTab.js:33` — "vs Nifty 50" label vs data-driven `benchName`; `page.js:103` — fund-id whitelist + `debt:0`; `MFTab.js:18,156-157` — 'JioBLK'/'Zerodha' strings + raw hex dots; `mf-nav/route.js:119` — proxy NAV pinned to date key '2026-03-20'.
9. `USTab.js:68` — benchmark subset in JSX (6 of 10); `page.js:588` — cap default 'Large'; `constants.js:18-42` — undated ETF look-through weights.
10. `FDTab.js:143-144` — "4 banks" + "₹40,000 Sec 194A"; `:81` — raw hex `#5FE3B0`; `:34` — "recalculated daily" vs hourly tick; SipCard `emp×2` employer-match assumption ×3 sites.
11. `calc.js:133` `RF_ANNUAL=0.065` vs `InsightsCard.js:17` `rfPct=6.5` — hand-synced pair; `page.js:730` US risk-free `0.043`; `page.js:913` — "₹40K TDS" prose inside the AI payload (can echo into AI text).
12. Trading: `AlgoTab.js:74` `' · from Mon'`; `:109` "100% of own"; `AnalyticsTab.js:227` literal `−` glyph; `:224` always-green Success Ratio; `:275` "after real contract-note charges" overclaim; `IntradayChart.js:17-21` broker raw hexes; `PnlDashboard.js:340` "3-day live cache"; `AlgoScreenReview.js:220` "3y" regime window; `AlgoMonthlyReco.js:125` input bounds.
13. `CFMemo.js:8` — "ITR-verified" badge unconditional for every caller; `MacroTab.js:390` — 'Yahoo' news-source fallback (feed is Google News).
14. Deliberate/maintained heuristic constants (keep, but know): treemap sector weights, fearGreed weights/bands, RBI repo table, MPC dates, regime thresholds, sentiment normalization bounds, InsightsCard badge tiers, news lexicons, Nifty-50 list, wall-clock session minutes, snapshot guards (CAP=800, MAX_DAY_MOVE=0.3 — duplicated client+server).

### 11.2 Silent data-integrity gaps

- **Eq intraday sleeve split discarded**: `captureEquityTick` emits `byBroker:{INDIAN,SWING}` but `upsertPoint` (`scripts/lib/intraday.mjs:41-43`) persists only dhan/upstox/fyers keys → per-sleeve hover on the equity day curve can never render.
- `applyCorpActions` (calc.js:309) implements **bonus only** — a split in `CORPORATE_ACTIONS` is silently ignored.
- `usData` (page.js:549) has **no `valued` guard** — partial Yahoo outage sums full inv against partial val (Indian sleeve has the guard).
- `indianRisk` (page.js:539) regresses curated SWING, not the broker-reconciled rows.
- Macro slider knob = linear min-max while label says "%ile" (pctile computed, never shown).
- MF freshness uses first fund's `navDate` (`.find()`) though latest is already computed.
- FD "Matured & Redeemed" shows full-term interest for early-closed rows (stored `payout` ignored).
- AI ₹-guard is prompt-only — no deterministic post-filter on model output.
- AlgoMonthlyReco tier badge stays artifact-time when capital is edited client-side.

### 11.3 Dead / orphaned surface area

- Orphan components (no importer): `TreeMap`, `InsightBanner`, `BrokerTable`, `SectorHeatmap`, `MarketOverview`, `NiftyOverview` (reads a field `/api/premarket` no longer returns), `PreMarketBriefing` (was the only regime-badge renderer), `FnoPositions`, `FnoHistory`, `YtdFno`, `lib/scenarios.js`.
- Dead props: MacroTab receives `marketWrap` (committed-wrap fallback therefore UNREACHABLE), `model` (real ₹ into a component that ignores it), `reg`, `fxRate`, `regime`, `markets`; AlgoTab receives 5 unused (`ytdTotal/ytdRealised/cfEntering/cfAfterRealised/fnoRealized`); IndianTab receives unused `indianDayPl/Pct`, `FY`, `CORPORATE_ACTIONS`, `swSort`; ProjectionTab `histSeries`/GrowthView `setRange` unused.
- Dead code: PnlDashboard `PeriodSummary`/`LivePnl` + a 12s `liveToday` poll feeding nothing; ProjectionTab `'D'` window branch + `attribution.D` unreachable; GrowthView 1D path unreachable from its only mount; `pulse.drivers/drags` schema-required but never rendered; `FreshnessTag` dead import in page.js; `monthlyRollup` no caller.
- KV written but never read by the app: `stratzy-daily:v1`, `algo-catalog:v1` (scripts read local files).
- Local formatter duplicates of `fmt.js`: OverviewTab `sFull`, RealizedPanel `compactInr`/`cl`, SunburstMix/IntradayChart `fmtFor`/`f()` (no Cr tier).

### 11.4 What checked out clean

Direction is color-only across the app (two exceptions flagged: InsightsCard alpha `+`
glyph, AnalyticsTab avg-loss `−`); headline figures use `Live*` count-ups (Trading card
static by design); FD/ELSS dates computed from data; FY labels flow from
`fno-verified.json`; private data reaches the client only through force-dynamic no-store
routes; brokers strictly read-only; every KV tier has a committed-file fallback;
`/api/growth` calls all sources directly (no sibling self-fetch); snapshot recording has
plausibility guards on both ends.
