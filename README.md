# Net Worth Tracker

A personal net worth dashboard built with **Next.js**, designed to deploy to
**Vercel**. Live equity prices are fetched **server-side** from the Yahoo
Finance v8 chart API through an API route, so the browser never hits Yahoo
directly (no CORS, no API key, no leaked secrets).

## Features

- **Dark theme**, monospace numbers, green gains / red losses.
- **Tabs:** Overview · Indian Stocks · Fixed Deposits · US Stocks · Algo · Retirement.
- **Overview:** live net worth, total assets, per-class P&L, and asset allocation.
- **Indian Stocks (NSE):** live table — qty, avg cost, LTP, invested, value, return %, day %.
- **US Stocks (Vested):** same, in USD **and** INR, converted at the live USD/INR rate. Sortable columns.
- **Live USD/INR** rate from Yahoo (`INR=X`).
- **Market status** pills for NSE and NYSE (open / closed) from Yahoo's `marketState`.
- **Auto-refresh** every 15 minutes, with a manual refresh button and a short sessionStorage cache.

## The API route

```
GET /api/quotes?symbols=COFORGE.NS,AAPL,INR=X
```

Returns:

```json
{
  "fetchedAt": "2026-06-05T20:00:00.000Z",
  "count": 3,
  "quotes": {
    "AAPL":       { "price": 201.5, "prevClose": 200.0, "change": 1.5, "pct": 0.75, "state": "REGULAR", "currency": "USD" },
    "COFORGE.NS": { "price": 1450.0, "prevClose": 1440.0, "change": 10, "pct": 0.69, "state": "CLOSED", "currency": "INR" },
    "INR=X":      { "price": 87.9, "prevClose": 87.8, "change": 0.1, "pct": 0.11, "state": "REGULAR", "currency": "INR" }
  }
}
```

- NSE symbols use the `.NS` suffix; USD/INR uses `INR=X`.
- Each symbol is fetched independently, with a `query1` → `query2` host fallback,
  an 8s timeout, and a browser User-Agent. A failed symbol returns
  `{ "error": "…" }` instead of failing the whole response.
- Responses are CDN-cached for 60s (`stale-while-revalidate`).

## Local development

```bash
npm install
npm run dev      # http://localhost:3000
```

> Note: the Yahoo endpoints must be reachable from wherever the server runs.
> In sandboxed CI/network-restricted environments the live fetch may return
> errors per symbol — this is expected; the UI still renders.

## Deploy to Vercel

This is a zero-config Next.js app. Either:

**Dashboard:** import the GitHub repo at <https://vercel.com/new>, keep all
defaults (framework auto-detected as Next.js), and deploy.

**CLI:**

```bash
npm i -g vercel
vercel          # preview
vercel --prod   # production
```

No environment variables are required.

## Editing the portfolio

All static cost-basis data (Indian stocks, US holdings, FDs, algo capital,
mutual fund, ELSS, loan, retirement projections) lives in
[`app/portfolio.js`](app/portfolio.js). Invested amounts are computed from
`qty × cost`. Update that file and redeploy.
