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

## Status — intraday capture LIVE (confirmed on laptop 24 Jun 2026)
- CaptureIntradayUS daemon running on the Windows laptop; real ticks publishing
  to KV, US tab curve rendering in preview. India daemon registered too.
- OPEN (deferred, user's call): "little UI tweaks" on the live curves — to be
  specified later. Candidates to confirm with user: curve height/density, axis
  labels (US session times), the headline/curve spacing, day vs eq vs us visual
  consistency, empty/pre-open state copy.

---

# PLAN (NOT STARTED) — Resilient two-tier capture + schedule consolidation

## Goal (from the user, this session)
All sleeves' growth captured reliably and laptop-independent where possible;
broker auth all mint-on-demand; fewer/cleaner schedules; the app reads captured
values instead of fetching prices separately. Survive a fully-laptop-off day.

## Target architecture — two tiers
- **Cloud baseline (always-on, Vercel cron):** daily day-change snapshot per sleeve
  → KV. Covers equity / US / MF (Yahoo/NAV, no auth) + **Dhan & Fyers F&O**
  (Dhan TOTP self-mint, Fyers refresh-token — both headless). Acts as the FALLBACK
  for laptop-off days AND the catch-up source. Only **Upstox F&O** can't go cloud.
- **Laptop intraday (when on):** F&O (all 3) + equity + US tick-level → KV, finer
  resolution. All broker auth mint-on-demand.
- The app reads these KV values; the duplicate live-Yahoo fetches are retired (phased).

## Findings that shaped this
- `/api/premarket` = Market Wrap (indices/sectors/movers/VIX/FII-DII). Its cron's only
  persistent job is the KV FII/DII trail; `lib/fiidii.js` is a client fallback trail.
  → DROP the cron, keep the route (Wrap still works on demand). Not covered by — and
  not redundant with — the captures (different feature).
- Cloud F&O feasible for **Dhan** (pure-API TOTP) + **Fyers** (refresh-token, ~15-day,
  laptop refreshes it); **Upstox** can't (browser-only). Tradeoff: broker secrets move
  to Vercel env/KV (read-only).

## OPEN DECISION (confirm before Phase 0b)
- [ ] **Broker secrets in Vercel** for cloud Dhan+Fyers F&O (strictly read-only). Yes/No.
      If No: cloud baseline = equity/US/MF only; ALL F&O stays laptop-bound.

## DEPLOYMENT PIVOT (decided this session)
Build PORTABLE now (option D), self-host on the user's own always-on box as the
production target (option A) — see [[production-cross-platform-target]]. Consequence:
NO Vercel cron / NO cloud secrets needed; the always-on box mints tokens like the
laptop. Trigger = Task Scheduler now → systemd/cron on the box later; store = KV via
scripts/lib/kv.mjs (env or mcp/.kv.env) + committed archive. Same Node code runs on
laptop / box / Vercel unchanged.

GROWTH = net-worth ASSET sleeves ONLY (eq/us/fd/mf/cmpf/cmps). F&O is EXCLUDED — it's
business income (non-speculative), trading capital is off-NW; it stays in the F&O
pipeline (fno-ledger via the evening sync + intraday tape + Trading tab), never summed
into asset growth.

## Phase 0 — portable daily GROWTH snapshot (the resilient fallback)
- [x] 0a. **DONE** — `scripts/lib/intraday.mjs` upsertGrowth/writeGrowth (merge, carry-
      forward, skip-not-zero) + `intradayTick.mjs` captureGrowth (eq + us asset sleeves;
      F&O excluded) + `scripts/snapshot-growth.mjs` entry + `app/api/growth` read route +
      `data/growth.json` seed. 12 tests; live run captured real eq/us; route serves
      KV→archive. Schema reserves fd/mf/cmpf/cmps keys.
- [x] 0b. Slow sleeves into captureGrowth (each its own cadence) — DONE:
      - [x] **fd**  — daily accrued interest from `FDS[]` (deterministic, no fetch) — DONE (08619a4)
      - [x] **mf**  — daily NAV via api.mfapi.in (scripts/lib/mf.mjs, mirrors mf-nav
            resolveCode); Σ units×(latest−prev NAV), skip-not-zero per fund — DONE (056e2c3)
      - [x] **cmpf** — daily PF interest accrual (scripts/lib/cmpf.mjs, mirrors app/lib/cmpf
            cmpfDailyAccrual = corpus×rate/365; monthly contributions = new money, excluded) — DONE
      - [—] **cmps** — EXCLUDED: defined-benefit pension (no corpus / no daily asset value)
      Asset sleeves complete: eq · us · fd · mf · cmpf.
- [ ] 0c. Fold the daily **FII/DII** capture into the snapshot routine → KV
      `premarket:fiidiiTrail` (20-session) + committed `data/fiidii-trail.json`.
      REMOVE the Vercel premarket cron; KEEP the `/api/premarket` route (live Wrap).
- [ ] 0d. Register `snapshot-growth` on a daily schedule (Task Scheduler now), hardened
      like the capture tasks; app reads `growth:<date>` as the fallback when no intraday
      tape exists. Monthly: salary-slip upload (PII-safe `data/reports/` method) refreshes
      cmpf/cmps/salary.

## Phase 1 — Mint-on-demand + schedule consolidation
- [ ] 1a. Lift the `MINT` map from sync-brokers.mjs into shared brokers.mjs so the
      capture daemon self-mints too.
- [ ] 1b. Register BrokerSyncEvening (Mon–Fri 18:30) + hardening (WakeToRun/battery/keep-awake).
- [ ] 1c. DELETE tasks: DailyBrokerSync, UpstoxDailyLogin, FyersDailyLogin.
- [ ] 1d. Drop the local market-wrap refresh from the sync.

## Phase 2 — Single price source / retire duplicate Yahoo (PHASED, recommended)
- [ ] 2a. Pipeline becomes the single writer of per-sleeve values to KV.
- [ ] 2b. Migrate app readers (frontend day-change + API routes) to read KV, not live Yahoo.
- [ ] 2c. Retire the redundant live-Yahoo fetches (Yahoo still used once, inside the pipeline).

## Phase 3 — Catch-up on laptop-off
- [ ] 3a. StartWhenAvailable on remaining laptop tasks.
- [ ] 3b. On wake, run the daily-growth snapshot for missed days (NOT an intraday replay);
      mostly already covered by the Phase-0 cloud baseline.

## Verification per phase
- Unit tests for new pure calc; full `vitest run` green each phase.
- Confirm captures still mint with the login tasks removed; deleted tasks gone.
- Render-check affected tabs; confirm app renders the `growth` fallback when intraday absent.

---

# NIFTY S/R (swing) + volume on the Day-view watermark (DONE)

User decisions: method = (c) detected intraday swing highs/lows, anchored by day H/L;
layout = stays in the BACKGROUND watermark (no separate panel) — S/R as faint dashed
lines, volume as a faint bottom histogram, both behind the P&L curve.

## Tasks
- [x] 1. `scripts/lib/equity.mjs niftyCandles()` — captures `v` (Yahoo `quote.volume[i]`), additive.
- [x] 2. `app/lib/pnlDaily.js`: `scaleCandles` now returns `lo/hi/y0/y1/vmax/priceY` + per-bar `v`;
      new pure `niftyLevels(candles)` (swing pivots → clustered, touch-ranked S/R + day H/L anchors).
- [x] 3. `IntradayChart.js` — faint volume histogram (bottom band) + faint dashed S/R lines with
      price labels, behind the P&L; gated on `nifty`/`vmax`.
- [x] 4. +9 unit tests (sparse, flat, anchors, R>last/S<last, swing detection, scaleCandles fields).
- [x] 5. `vitest run` green (214); S/R render-verified on the live watermark
      (R 24261/24199/24067 · S 24042 around the ~24056 close). Volume pending the daemon restart
      that picks up `v`.
- [ ] 6. Adversarial multi-agent review — deferred (user interrupted to polish the hover card);
      feature ships verified via the 9 unit tests + live render. Offer the review as a follow-up.

## Review
- S/R method = swing pivots (±5-bar local extremes), clustered within 0.08%, touch-ranked,
  split around last close, with day H/L as outer anchors — faint dashed lines + R/S price
  labels, kept neutral (not green/red) so they don't fight the P&L colours.
- Volume = faint bottom-band histogram (≤16% height), coloured by candle up/down; renders
  only once the capture's new `v` field populates (daemon restart).
- Layout per user: everything stays in the BACKGROUND watermark, no separate panel.
- Hover card (same session): dropped the tint → plain frosted glass; ₹ sized to 1em body
  font so it sits flush (was over-shrunk to .82em → looked tiny).
