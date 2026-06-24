# FII derivatives positioning → Market Wrap (CSV path)

Goal: surface FII (and retail) **derivative positioning** under the existing
"FII / DII · net flow" card, sourced from NSE's participant-wise OI CSV
(`fao_participant_oi_<DDMMYYYY>.csv`) — no new dependency. Reveals the stance the
cash row hides (cash flat, but net-short futures + long puts = bearish) plus the
FII-vs-retail divergence.

Decision (user): enrich the EXISTING card with a positioning strip; do NOT touch
the existing cash chart; no separate card; no grid restructure.

## Tasks
- [x] 1. `app/api/premarket/route.js`: `toDDMMYYYY()` + `fetchParticipantStats(cookie, date)`
      — parses the OI CSV by column index; FII & retail nets; `stance` + `divergence`. Defensive.
- [x] 2. GET: keyed to `fiidii.latest.date` (IST-today fallback); attached as `fiiDerivs`.
- [x] 3. `MacroTab.js`: `FiiDerivStrip` in `.fdcard` after `<FiiDiiChart>`; `showFii` extended.
      Direction by colour + long/short word, no glyph.
- [x] 4. `globals.css`: `.fdderiv*` styles via tokens.
- [x] 5. Verified: feed matches the probe (FII idxFut −228,561, retail +163,438, bearish,
      divergence); strip renders in night + day; console 0 errors.

## Review
- Bug caught in verify: `/^Client/` grabbed the "Client Type" HEADER row (parsed to 0s) —
  anchored both picks (`/^FII$/`, `/^Client$/`). FII never collided (no "FII" header cell).
- Followed the house rule: net positions shown as magnitude + colour + long/short word
  (red short / green long), NOT a signed figure — deviated from the mock's "−2.29L".
- Graceful deg: NSE archives may be blocked from Vercel data-centre IPs (like the cash feed);
  on `{stale}` the strip simply doesn't render — the cash card is unaffected.
- Deferred (not in chosen mock): the idxFut over-sessions sparkline trail. Data accrues
  forward if wired later; flagged to user as the next step.

---

# Next: Groww-style Trading tab + live broker reads (scoped, not started)

Two linked workstreams, kicked off once the user supplies a real Groww
PnL-dashboard screenshot to match.

## A. Groww-style Trading tab (AlgoTab.js redesign)
- [ ] Match the real Groww screenshot (user to provide); mock built at
      scratchpad/trading-mock.html (day+night, approved as direction)
- [ ] Hero net P&L card: realised / open-MTM / charges / win-days split
- [ ] Headline **cumulative daily-realised P&L curve** — driven from logs
      (fnoRealized / data/trades-log.json), per user's choice
- [ ] Gross → charges → net waterfall (reuse FY.combinedVerified)
- [ ] Keep per-strategy (S01/S02) rows + carryforward grid
- [ ] Rules: color-only direction, --fs-* tokens, holds in day+night

## B. Live broker reads (Groww Trade API + existing Dhan/Upstox/Fyers)
- [ ] READ-ONLY only — never place/modify/cancel (project hard rule)
- [ ] Goal: intraday-live MTM via day's token stashed server-side (KV/env),
      not just the morning snapshot. Floor: once-daily token mint stays
      (SEBI: no refresh tokens). Dhan self-mints; Upstox/Fyers need laptop.
- [ ] Secrets stay out of client bundle + committed JSON; private route =
      force-dynamic + no-store
- [ ] Evaluate Groww Trade API read endpoints (positions/holdings/trades/LTP
      ws) as a standardized feed for the cumulative-P&L curve

## Decisions (locked this session)
- Layout: Groww dashboard (stat panel + daily heatmap + monthly table) becomes
  the TOP of AlgoTab; existing strategy cards / ITR panels / carryforward stay below.
- Heatmap buckets: intensity RELATIVE to user's own daily P&L distribution
  (quantiles), not fixed ₹ thresholds.
- Reference: real Groww 915 + Dhan Traders Diary screenshots; mock v2 at
  scratchpad/trading-mock2.html (approved direction).
- Data source: data/fno-ledger.json (per date×broker net + orders) → daily/monthly
  aggregation; trades-log.json as fallback for order counts.

## Scope correction (this session)
- BUILD TARGET: Fyers, Upstox, Dhan only — that's where the F&O runs. Groww 915
  dashboard + Groww Trade API were REFERENCE ONLY, not a dependency.
- These three already expose everything the views need: on-demand positions/funds,
  intraday quotes + websocket feed, and timestamped fills (trade book). The only
  new work is OUR pipeline capturing intraday price + fill-time data.
- Daily (P&L Charts) view rules: single "Your P&L" line, green above 0 / red below;
  NO NIFTY-50 reference line; NO fixed target. Dashed reference line tracks the
  CURRENT P&L level (pill = live P&L). A target line appears ONLY when the API
  reports a pending order.
- Buildable today on existing data: Year (heatmap) + Month (calendar) + day summary.
  Gated on new intraday capture: the full intraday P&L-Charts curve.

## Review — Groww-style P&L dashboard (BUILT this session)
- app/lib/pnlDaily.js — pure aggregation: dailySeries (broker merge), summaryStats
  (net/win%/streaks/most-profitable), quantileBuckets (relative-to-own-days, strict
  terciles), monthMatrix (Sun-first calendar), monthlyRollup, fyOf. 17 unit tests.
- app/components/shared/PnlDashboard.js — Day/Month/Year views: stat panel, year
  heatmap, month calendar + week-overview, day summary (+ intraday-pending note),
  monthly table. Reads APP.fnoLedger at render; optional `rows` prop for tests.
- app/globals.css — .pnl-* styles; bucket tints via color-mix off --grn/--red so
  day+night Just Work. Colour-only direction, --fs-* tokens, mobile breakpoint.
- Wired as the new TOP of AlgoTab; strategy/ITR/carryforward panels kept below.
- Verified: prod build clean, 115/115 tests pass, rendered all 3 views x both
  themes via a throwaway /verify page (full page needs private data).
- DEFERRED (needs new pipeline): intraday fill-by-fill P&L curve — per-fill
  timestamps + minute price feed from Fyers/Upstox/Dhan websockets.

## Intraday capture pipeline (BUILT this session)
- data/fno-intraday.json — committed tape: { days: { 'YYYY-MM-DD': [{t,net,dhan,upstox,fyers,pending}] } }.
- scripts/lib/intraday.mjs — pure upsertPoint (minute-dedupe, time-sorted, no mutate) + appendIntraday disk wrapper. 6 tests.
- scripts/lib/brokers.mjs — positions-only puller; reads daily tokens off disk, NEVER mints; sums realised+open MTM per broker + pending-order flag; AbortSignal timeouts; skips (never zeroes) a broker on failure. READ-ONLY.
- scripts/capture-intraday.mjs — market-hours-gated (09:15–15:30 IST wkdys; CAPTURE_FORCE bypass), appends a point, commits/pushes to main like the sync. Verified: 3 scripts node --check; dry-run skips gracefully (no tokens) and the hours-gate no-ops.
- Read path: route.js _app.fnoIntraday + appData default { days:{} }.
- app/lib/pnlDaily.js scaleIntraday() — pure chart geometry (0 always on-chart, cur=last, ud=sign). 4 tests.
- PnlDashboard DayPanel/IntradayChart — green-above-0/red-below curve, dashed line + dot at CURRENT P&L, time axis, pending-order line only when flagged; falls back to summary + note when <2 points. Verified: rendered in both themes.
- SCHEDULE.md — IntradayCapture row + section.
- FUTURE: dedupe token/pull layer shared with sync-brokers.mjs (left separate now to avoid touching the money-critical daily sync, which can't be run in this env).

## Adversarial review fixes (applied)
Reviewed the daemon/KV/API/client diff across 4 dimensions, each finding verified
by a skeptical second pass (18 raised → 8 confirmed, 10 dismissed). Fixed:
- intraday.mjs: pending flag now STICKY within a minute (OR with prior same-minute
  point) — the ~1/min orders-check tick was being clobbered by later net-only ticks.
- capture-daemon.mjs: set `committed` only after a successful push; `git rebase
  --autostash origin/main` so a dirty tree at close can't strand the commit.
- sync-brokers.mjs: same --autostash hardening (shared flaw).
- PnlDashboard DayPanel: headline P&L now tracks the LIVE tape when present (no
  longer contradicts the curve / shows "—" on the current day); keyed by date to
  kill the stale-frame flash on day-switch.
- pnlDaily.summaryStats: a flat latest day reads as "no streak", not a 0-len win.
- SCHEDULE.md: rewrote IntradayCapture → IntradayDaemon (10s long-running loop,
  KV publish, one commit at close); corrected the one-shot's no-commit note.
- +11 tests (sticky pending, flat/loss streaks). 136 pass; build clean.
Dismissed (verified non-issues): orders-throttle "drift", force-push claim (it's a
fast-forward, not --force), date-param enumeration, two-writer/commit races (latent,
single-writer topology), KV-TTL handoff, midnight-poll edge.

## F&O daily backfill from reports (BUILT) — answers "fill the vacuum"
The daily calendar was empty because fno-ledger only captures forward; historical
daily detail lived in the raw Dhan report but parse-broker-tax.py collapsed it to
per-FY and discarded the day.
- parse-broker-tax.py: parse_dhan now also buckets each F&O trade by exact sell-DATE
  (fnoByDay); main() emits non-PII `fno_daily` [{date,broker,sleeve,gross,net}].
- scripts/backfill-fno-ledger.mjs: upserts fno_daily into fno-ledger.json (broker
  label matched to the sync so no double-count; estCharges = gross−net → real net).
  Idempotent. 5 unit tests + e2e fixture run verified.
- RUN LOCALLY (reports are gitignored, not in cloud): drop reports in data/reports/
  → python scripts/parse-broker-tax.py → node scripts/backfill-fno-ledger.mjs →
  commit data/fno-ledger.json. Only Dhan (S01) has per-trade dates today; other
  brokers stay FY-level until their tradewise sheets are wired.

## Live equities — day-change tape + Indian-tab curve (BUILT)
Answers "KV can do the same for equities" + "did you forget Kite MCP?".
Finding: Kite is a hosted-OAuth MCP (interactive) — a headless 10s daemon can't
drive it. It doesn't need to: the delivery holdings (qty/avg) are already in
broker-state.json, and live prices come keyless from Yahoo (the /api/quotes source).
So the curve is Σ qty×(price−prevClose), no Kite token in the loop. P&L meaning:
intraday day-change (vs prev close), per the user's pick.
- scripts/lib/equity.mjs: equityHoldings (INDIAN+SWING from broker-state),
  computeDayChange (pure, skip-not-zero on missing quote), pullEquityDayChange
  (keyless Yahoo v8, bounded concurrency). 6 unit tests.
- intradayTick.mjs: captureEquityTick + shared publish(); kvKeyEq intraday:eq:<date>.
- capture-daemon.mjs: INDEPENDENT loops — F&O 10s, equity 60s (EQUITY_MS), separate
  in-flight guards so a slow Yahoo fetch can't stall F&O. Commits both archives at close.
- data/eq-intraday.json seed; /api/intraday?kind=eq (KV + archive fallback); appData
  eqIntraday + portfolio route hydration.
- IntradayChart extracted to shared/ (axis labels now from scaled pts — single source);
  reused by the F&O Day view and the new shared/EquityDayCurve.js (polls kind=eq every
  15s, current-day only), mounted on the Indian tab.
- Verified: 147 tests; build clean; daemon dual-loop dry-run (F&O unblocked by blocked
  Yahoo); equity curve rendered end-to-end via the live read path in both themes.
- US sleeve (Vested + FX) is the remaining follow-up. Live Yahoo is proxy-blocked in
  cloud (degrades to null gracefully); fetches real on the laptop.

## US sleeve added to the live equity capture (BUILT)
Extends the previous India-equity build (which already includes Kite — those
delivery holdings are in broker-state.json under INDIAN).
- marketHours.mjs: usMarketState (NSE 18:45 IST → 02:30 IST window, absorbs DST)
  and usSessionDate (overnight buckets under the evening date so one US session
  is one tape entry). 5 unit tests.
- equity.mjs: usHoldings (shape-tolerant pull from private US sleeve),
  computeUsDayChange (pure, USD × FX → INR, skip-not-zero on missing quote/FX),
  pullUsDayChange (keyless Yahoo + INR=X FX in parallel). 4 unit tests.
- intradayTick.mjs: captureUsTick + kvKeyUs intraday:us:<date>.
- capture-daemon.mjs: SESSION=us mode — runs ONLY usTick on its own loop with
  session-aware windowOpen() that idles before the open and stops after the
  past-midnight close. India session (default) still does F&O + Indian equity.
  Schedule TWO instances: morning (default) + evening (SESSION=us).
- data/us-intraday.json seed; route gains kind=us; appData usIntraday hydration.
- EquityDayCurve generalized to {kind, archive, dateOf, title, note} — Indian tab
  uses kind=eq, US tab uses kind=us (US session date logic mirrors the daemon).
- Verified: 159 tests; build clean; SESSION=us dry-run gates correctly.
