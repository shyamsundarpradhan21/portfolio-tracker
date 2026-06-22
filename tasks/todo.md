# Realized unification (2026-06-22) — fold self-equity, de-year the F&O file, add all-time F&O

## 1. Fold user's own equities into INDIAN_REALIZED
- Parser: add **YXA918** (Zerodha self) equity per-FY + **Groww** (Trade Level, bucket by sell-date FY: P&L = sellVal − buyVal) to `indian_per_fy`, on top of mom's GWS919.
- Winners/losers aggregate across mom + self + Groww. Upstox swing = ₹0 (held).
- Update panel source label → "Zerodha (mom + self) + Groww · realized".
- Re-run parser → broker-tax.json.

## 2. De-year the F&O tax file (forward-compat)
- Rename `data/fy2526_verified.json` → `data/<NAME>.json`.
- Generic keys: `s0X.fy2526`→`s0X.verified`, `s0X.fy2627`→`s0X.current`, `combined2526`→`combinedVerified`,
  `cf.fy2627Realised`→`cf.currentRealised`, `cf.fy2627Swing`→`cf.currentSwing`, `cg2526`→`cgVerified`.
- Update consumers: `app/api/portfolio/route.js`, `app/lib/fnoLedger.js`, `scripts/lib/fno-ledger.mjs`, `app/components/tabs/AlgoTab.js`.
- Year-roll then = edit `labels` + swap values only; no key/component churn.

## 3. All-time F&O realized
- Parser: compute `fno_alltime` (sum across all brokers/FYs) into broker-tax.json.
- Surface on the Algo/Trading tab — DECISION: single cumulative figure vs full per-FY F&O view.

## Open decisions
- New filename for the F&O tax file.
- All-time F&O presentation.

## Review
_(after build)_
