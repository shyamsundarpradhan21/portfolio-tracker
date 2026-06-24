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
