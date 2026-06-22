# Broker-tax parser — reusable realized-P&L extraction (2026-06-22)

**Goal:** one parser that reads `data/reports/*` (gitignored, transient) and emits a
committed, PII-stripped canonical store `data/broker-tax.json` so realized figures
are *derived from the reports*, never stale, and persist without re-uploading.

## Report inventory (account → owner → sleeve)
- `taxpnl-GWS919-*.xlsx` — Zerodha, **TULASI PRADHAN (mom)** → indian_equity → **INDIAN_REALIZED**
- `taxpnl-YXA918-*.xlsx` — Zerodha, **SHYAM (self)**, equity+F&O → trading
- `FYERS_tax_pnl_YS59535_*.csv` — Fyers (self), F&O → trading
- `TAX_PNL_REPORT.xls` / `PNL_REPORT.xls` — Dhan (self), equity+F&O → trading
- `Profit-Loss Statement … .xlsx` — Vested/DriveWealth (self), US → **US_REALIZED**
- `Vested_Transactions.xlsx` — Vested trades/transfers/income (cashflow)
- _pending uploads:_ Upstox (swing equity → INDIAN, F&O → trading), salary slips

## Tasks
- [ ] `scripts/parse-broker-tax.py` — label-based (robust to 0–6 row top offset)
- [ ] Emit `data/broker-tax.json`: per-account/FY/segment + top movers + derived
      `indian_realized` & `us_realized` (RealizedPanel shape) + `fno` corroboration.
      Labels not client-IDs; no PAN / names / account numbers / raw trade lists.
- [ ] Reconcile vs current curated (Indian total −22,491 / FY25-26 −27,966; US $343.56)
- [ ] Wire `seed-portfolio-kv.mjs` to overlay broker-tax.json → KV (realized out of bundle)
- [ ] Delete temp inspectors; verify; commit

## Decisions to confirm
- Commit `broker-tax.json` (PII-stripped aggregates, like committed `fy2526_verified.json`)
  vs gitignored. Default: commit (matches "stays in the cloud").
- YXA918 (self Zerodha) equity → trading, not INDIAN_REALIZED (mom's GWS919 only).

## Review
_(to fill after build)_
