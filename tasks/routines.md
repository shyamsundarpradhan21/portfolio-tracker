# Claude Routines — versioned reference

The Claude Routines run **outside the repo** (in the Claude Routines panel), so their schedules
+ prompts were never version-controlled — a wiped panel would lose them with no trace (the
loophole flagged in the resilience audit). This file captures them so the panel can be rebuilt.
Cross-referenced from `SCHEDULE.md` §4d/§5.

**Two routines** (down from three — the old weekly-Dhan + monthly-stratzy folded into one Local
weekly review: only the cadence differed, and Stratzy data is laptop-side so both must be Local):
- `CloudFnoCapture` — a shell **command** (fully reproduced below).
- `Weekly portfolio review` — a Claude **prompt** (fully reproduced below).

---

## CloudFnoCapture — Dhan S01 + Fyers S02 F&O realised, laptop-off (Remote, daily ~18:45 IST)
Captures Dhan (S01) + Fyers (S02) realised F&O laptop-off. Full context: `SCHEDULE.md` §4d.

**Command:**
```
SYNC_ONLY=dhan,fyers SYNC_NO_BROWSER=1 node scripts/sync-brokers.mjs
```

**Env (Remote workspace):** `DHAN_CLIENT_ID`, `DHAN_PIN`, `DHAN_TOTP_SEED`, `FYERS_APP_ID`,
`FYERS_SECRET_ID`, `FYERS_PIN`, `KV_REST_API_URL`, `KV_REST_API_TOKEN` (reads the Fyers
refresh-token the laptop pushed to KV). Read-only — GETs only, never places an order.

---

## Weekly portfolio review (Local, Sat 09:00 IST)
Weekly Dhan US (GIFT City) sleeve review; folds in the monthly algo briefing on the last Saturday
of the month. **Local** (not Remote) because the algo/Stratzy data is browser-harvested laptop-side.
Replaces the former separate §5 (weekly Dhan) + §6 (monthly stratzy) routines.

> ⚠ **DEPENDENCY — `tasks/dhan-portfolio.md` is NOT on origin/main** (it lived on a side branch,
> `claude/rm-dhan-portfolio`; the 2026-07-11 restore was local-only and unpushed → stranded
> off-origin). Restore + push it, or the review has no plan to read against.

**Prompt:**
```
Weekly review of my Dhan US (GIFT City) sleeve — runs Sat 09:00 IST, laptop-side.

DATA REALITY (verified 2026-07-11): the GIFT City US book is NOT reachable from any automated
source — the DhanHQ API (mcp/dhan) is domestic-India only (no US/GIFT segment), and data/us_*.json
is the SEPARATE Vested/DriveWealth sleeve. First SIP is Jul 2026, so it may be barely funded.
Until a real holdings feed exists this is a PRICE-ONLY watch of the planned names — don't hunt for
a holdings API; state the target-weight proxy caveat up front.

-- ALWAYS: Dhan US sleeve --
1. Read tasks/dhan-portfolio.md for the target names, weights, theses, and band policy.
2. Pull each name's week price action via Yahoo (the app's keyless pricer, same as /api/quotes).
   Sanity-check any figure that looks off before using it.
3. Target-weight-weighted sleeve move + biggest contributors / drags (move x weight).
4. Flag: thesis breaks, intra-theme divergence, band drift (+/-5% abs / +/-25% rel), and a
   new-money SIP steer toward laggards. Read + flag only, no orders. (Swap in actual qty if a
   Dhan-US feed ever becomes reachable.)

-- MONTH-END ONLY (if today is the last Saturday of the month): also the algo briefing --
1. Per-algo perf for my HELD algos -- realised/unrealised/overall P&L, deployed, live returns
   (Stratzy /api/algo/portfolio + /api/web/algo/list; feedback.md "Stratzy endpoint" for the
   response shapes + the live-vs-backtest liveSince split).
2. Per algo: month P&L, LIVE-only perf (drop any backtest head), tracking vs degrading.
3. Reallocation screen: underperforming holds; catalog candidates (Dhan sessionStorage cache --
   CAGR/Sharpe/drawdown/correlation); flag over-fit (compute backtest stats from the SPLIT series).
4. Short allocation call for the coming month -- hold/trim/add, and why. Read-only, no orders.

Constraints: broker + Stratzy read-only; private review; public market data + my own figures only.
```
