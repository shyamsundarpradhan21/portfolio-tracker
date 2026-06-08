# Monthly Update — Net Worth Dashboard

A ~20-minute routine to keep every record current. Most of the dashboard updates
itself; you only refresh the static inputs below (mostly in `app/portfolio.js`).

## The workflow
Drop these **3 exports** into the chat each month and Claude makes the edits +
opens a PR for you to review — or edit `app/portfolio.js` yourself using the map
below.

1. **Zerodha** → Holdings + Tradebook (Indian equities)
2. **Vested** → Transactions export (US equities, cashflows, dividends)
3. **CAS** (CDSL/NSDL/Karvy email) → mutual fund units
4. *(when available)* **Algo tax-compliant report** → algo realised P&L / capital

## Updates itself — do NOT touch
- Live prices (Indian, US, swing) — Yahoo via `/api/quotes`, every 15 min
- MF NAV & current value — `/api/mf-nav`, daily
- FD accrued interest, maturity, deploy countdowns — computed hourly
- XIRR / CAGR / benchmarks (Indian + US), Growth chart, donut, net worth, USD/INR
- Market open/closed pills — exchange clock
- AI insights — regenerated on refresh
- Bonus corporate actions — auto-applied on the ex-date

## What to update (`app/portfolio.js`)

| Records | Constant | From | Cadence |
|---|---|---|---|
| Indian equity qty/cost | `INDIAN[]` | Zerodha Holdings | monthly |
| Indian buy dates/amounts | `TRANSACTIONS[]` | Zerodha Tradebook | when you buy |
| US equity qty/cost | `US[]` | Vested Trades sheet | monthly |
| US deposits/withdrawals | `US_CASHFLOWS[]` | Vested Transfers sheet | monthly |
| US dividends | `US_DIVIDENDS` | Vested Income sheet | monthly |
| MF units + as-of date | `MF_FUNDS[].units`, `UNITS_AS_OF` | CAS | monthly |
| MF investments | `MF_CASHFLOWS[]` | CAS | when you invest |
| Algo swing book | `SWING[]` | broker | monthly |
| Corporate actions | `CORPORATE_ACTIONS[]` | announcements | as announced |
| Realised equity P&L | `REALIZED_PNL` | Zerodha tax P&L | after an exit |
| Loan balance | `STATIC.loan` | statement | when it moves |
| Algo capital | `STATIC.algo` | algo report | when it moves |

## Quarterly / annual
- **Quarterly:** move any deployed FD from `FD_PIPELINE[]` → `FDS[]`
- **Annually (post-ITR):** `data/fy2526_verified.json` + `ALGO` figures (F&O
  carryforward, capital-gains notes) — ITR-verified, once a year

## Verify before committing
1. Holdings-table **invested total** matches your broker
2. `npm run build` is clean
3. Net worth looks sane vs last month
