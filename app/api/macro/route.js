// Live macro CLOCK for the scenario engine. Two free sources:
//   - FRED official API (free FRED_API_KEY) for rates/credit/conditions series
//   - Yahoo Finance v8 chart for VIX/term-structure/DXY/USDINR/Brent
//
//   GET /api/macro
//   → { fetchedAt, live: { <metric>: { value, prev, change, asOf, source } | { stale } } }
//
// Every datum is tagged with its source + as-of timestamp. If a source fails we
// return an explicit { stale: true, error } for that metric — never a silent
// guess (the UI renders these as an unavailable cell).

import { regressVsVix } from '../../lib/calc';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// ── FRED (official API, free key) ────────────────────────────────────────────
// The keyless fredgraph.csv host is IP-blocked from Vercel (times out), so we use
// the official JSON API with a free key (FRED_API_KEY). Graceful no-op until the
// key is set — each series reads 'stale' meanwhile (Yahoo metrics still work). We
// keep the last two real observations (latest + prior) for a change.
const FRED_KEY = process.env.FRED_API_KEY;
async function fredSeries(id) {
  if (!FRED_KEY) return { stale: true, error: 'no FRED_API_KEY', source: `FRED ${id}` };
  const start = new Date();
  start.setDate(start.getDate() - 120); // ~120d window → ≥2 obs even for weekly series (NFCI)
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${id}` +
    `&api_key=${FRED_KEY}&file_type=json&sort_order=asc&observation_start=${start.toISOString().slice(0, 10)}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/json' },
      cache: 'no-store',
      signal: AbortSignal.timeout(9000),
    });
    if (!res.ok) return { stale: true, error: `FRED HTTP ${res.status}`, source: `FRED ${id}` };
    const obs = (await res.json())?.observations;
    if (!Array.isArray(obs)) return { stale: true, error: 'bad shape', source: `FRED ${id}` };
    const rows = obs
      .filter((o) => o && o.value !== '.' && o.value !== '' && o.value != null && isFinite(+o.value))
      .map((o) => ({ date: o.date, v: +o.value }));
    if (!rows.length) return { stale: true, error: 'no observations', source: `FRED ${id}` };
    const last = rows[rows.length - 1];
    const prev = rows.length > 1 ? rows[rows.length - 2] : null;
    return {
      value: last.v,
      prev: prev ? prev.v : null,
      change: prev ? last.v - prev.v : null,
      asOf: last.date,
      source: `FRED ${id}`,
    };
  } catch (e) {
    return { stale: true, error: e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'fetch failed'), source: `FRED ${id}` };
  }
}

// ── Yahoo v8 chart quote ─────────────────────────────────────────────────────
async function yhQuote(symbol, label) {
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  for (const host of hosts) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== 'number') continue;
      const value = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose ?? null;
      const asOf = meta.regularMarketTime ? new Date(meta.regularMarketTime * 1000).toISOString() : new Date().toISOString();
      return { value, prev, change: prev != null ? value - prev : null, asOf, source: `Yahoo ${symbol}` };
    } catch { /* try next host */ }
  }
  return { stale: true, error: 'fetch failed', source: `Yahoo ${symbol}` };
}

// Monthly closes for a Yahoo symbol → [{ month:'YYYY-MM', close }] (adjusted
// when available; one row per calendar month, ascending).
async function yhMonthly(symbol, range = '6y') {
  const hosts = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1mo&range=${range}`;
  for (const host of hosts) {
    try {
      const res = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(9000) });
      if (!res.ok) continue;
      const r = (await res.json())?.chart?.result?.[0];
      const ts = r?.timestamp, q = r?.indicators?.quote?.[0]?.close, adj = r?.indicators?.adjclose?.[0]?.adjclose;
      if (!Array.isArray(ts) || !Array.isArray(q)) continue;
      const byMonth = {};
      for (let i = 0; i < ts.length; i++) {
        const c = adj && adj[i] != null ? adj[i] : q[i];
        if (c == null || !isFinite(c)) continue;
        const d = new Date(ts[i] * 1000);
        byMonth[`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`] = c; // last wins
      }
      const months = Object.keys(byMonth).sort();
      if (!months.length) continue;
      return months.map((m) => ({ month: m, close: byMonth[m] }));
    } catch { /* try next host */ }
  }
  return null;
}

// Structural short-vol sensitivity from a LONG monthly history of SVXY (a public
// −0.5x short-VIX-futures ETF) regressed on ΔVIX — a defensible "what a short-vol
// book typically does per VIX point", independent of the Stratzy book's short
// life. Also returns the month-end ^VIX map so the client can align the book's
// own monthly P&L to the same VIX grid.
async function shortVolProxy() {
  const [svxy, vixM] = await Promise.all([yhMonthly('SVXY', '6y'), yhMonthly('^VIX', '6y')]);
  const vixMonthly = {};
  (vixM || []).forEach((o) => { vixMonthly[o.month] = o.close; });
  let proxy = { stale: true, error: 'insufficient SVXY/VIX history', source: 'Yahoo SVXY/^VIX (monthly)' };
  if (svxy && vixM && svxy.length >= 25) {
    const returns = [], vix = [];
    for (let i = 0; i < svxy.length; i++) {
      returns.push(i === 0 ? null : (svxy[i - 1].close > 0 ? svxy[i].close / svxy[i - 1].close - 1 : null));
      vix.push(vixMonthly[svxy[i].month] ?? null);
    }
    const reg = regressVsVix(returns, vix);
    if (reg) proxy = { ...reg, asOf: svxy[svxy.length - 1].month, source: 'Yahoo SVXY −0.5x short-VIX, monthly' };
  }
  return { proxy, vixMonthly };
}

export async function GET() {
  const [us10y, spread, hyOas, nfci, vix, vix3m, dxy, usdinr, brent, monthly] = await Promise.all([
    fredSeries('DGS10'),          // US 10Y yield (%)
    fredSeries('T10Y2Y'),         // 2s10s spread (pp)
    fredSeries('BAMLH0A0HYM2'),   // ICE BofA US HY OAS (%) — risk-off early warning
    fredSeries('NFCI'),           // Chicago Fed financial conditions index
    yhQuote('^VIX', 'VIX'),
    yhQuote('^VIX3M', 'VIX3M'),
    yhQuote('DX-Y.NYB', 'DXY'),
    yhQuote('INR=X', 'USDINR'),
    yhQuote('BZ=F', 'Brent'),
    shortVolProxy(),              // structural short-vol proxy + month-end ^VIX grid
  ]);

  // VIX term structure: VIX3M > VIX is contango (calm); VIX > VIX3M is
  // backwardation (stress). Derived only when both reads are live.
  let vixTerm = { stale: true, error: 'needs VIX + VIX3M' };
  if (!vix.stale && !vix3m.stale && vix3m.value) {
    const ratio = vix.value / vix3m.value;
    vixTerm = {
      ratio,
      state: ratio > 1 ? 'backwardation' : 'contango',
      asOf: vix.asOf,
      source: 'Yahoo ^VIX/^VIX3M',
    };
  }

  return Response.json(
    {
      fetchedAt: new Date().toISOString(),
      live: { us10y, spread2s10s: spread, hyOas, nfci, vix, vix3m, vixTerm, dxy, usdinr, brent },
      volProxy: monthly.proxy,      // structural short-vol sensitivity (SVXY, monthly)
      vixMonthly: monthly.vixMonthly, // { 'YYYY-MM': month-end ^VIX } for book alignment
    },
    { headers: { 'Cache-Control': 's-maxage=120, stale-while-revalidate=600' } },
  );
}
