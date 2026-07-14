// Stock detail feed — ONE endpoint that powers the heatmap click-through panel for ANY
// symbol (India .NS or US). Merges two Yahoo sources:
//   • quoteSummary (crumb-gated, app/lib/yahooSummary.mjs) → fundamentals: P/E, EPS, beta,
//     float, market cap, next-earnings, dividends, income statement.
//   • v8 chart (keyless, range=1y) → multi-window performance (1W…1Y), day/52wk range and
//     dividend history — the fields quoteSummary does NOT carry.
//
//   GET /api/stock?symbol=NVDA
//   GET /api/stock?symbol=RELIANCE.NS
//
// Degrades honestly: if the crumb handshake fails, the chart half still returns (price,
// ranges, perf, dividends) and the fundamentals fields come back null — the panel blanks
// them rather than breaking. Never server-side self-fetches a sibling route (feedback.md).

import { fetchStockSummary, normalizeStock } from '../../lib/yahooSummary.mjs';
import { UA } from '../../lib/ua';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const DAY = 864e5;
const r2 = (n) => (n == null || !isFinite(n) ? null : Math.round(n * 100) / 100);
const pct = (a, b) => (a != null && b != null && b !== 0 ? r2(((a - b) / b) * 100) : null);

async function fetchChart(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1y&events=div`;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) continue;
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (r?.timestamp) return r;
    } catch { /* try next host */ }
  }
  return null;
}

// perf windows + ranges + dividend history from the 1y daily chart (mirrors nifty50-detail).
function chartDetail(r) {
  if (!r) return {};
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) if (closes[i] != null) pts.push([ts[i] * 1000, closes[i]]);
  if (pts.length < 2) return {};
  const now = pts[pts.length - 1][0];
  const last = pts[pts.length - 1][1];
  const at = (t) => { let c = null; for (const [tt, v] of pts) { if (tt <= t) c = v; else break; } return c; };
  const yStart = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  const perf = {
    w1: pct(last, at(now - 7 * DAY)),
    m1: pct(last, at(now - 30 * DAY)),
    m3: pct(last, at(now - 91 * DAY)),
    m6: pct(last, at(now - 182 * DAY)),
    ytd: pct(last, at(yStart)),
    y1: pct(last, pts[0][1]),
  };
  const vals = pts.map((p) => p[1]);
  const divs = r.events?.dividends ? Object.values(r.events.dividends).sort((a, b) => a.date - b.date) : [];
  const lastDiv = divs.length ? divs[divs.length - 1] : null;
  const ttmDiv = divs.filter((d) => d.date * 1000 > now - 365 * DAY).reduce((s, d) => s + d.amount, 0);
  const m = r.meta || {};
  // Recent daily closes + the most-recent complete OHLC bar — so an index/stock overview can
  // reuse the shared helpers (dailyReturns for the last-5 strip, a sparkline, computePivots for S&R).
  const hi = r.indicators?.quote?.[0]?.high || [], lo = r.indicators?.quote?.[0]?.low || [];
  const recentCloses = pts.slice(-35).map(([t, c]) => ({ close: r2(c), date: new Date(t).toISOString().slice(0, 10) }));
  let pivotBar = null;
  for (let i = ts.length - 1; i >= 0; i--) {
    if (hi[i] != null && lo[i] != null && closes[i] != null) { pivotBar = { high: r2(hi[i]), low: r2(lo[i]), close: r2(closes[i]), asOf: new Date(ts[i] * 1000).toISOString().slice(0, 10) }; break; }
  }
  return {
    perf,
    chartDayLow: r2(m.regularMarketDayLow),
    chartDayHigh: r2(m.regularMarketDayHigh),
    chartWeek52Low: r2(m.fiftyTwoWeekLow) ?? r2(Math.min(...vals)),
    chartWeek52High: r2(m.fiftyTwoWeekHigh) ?? r2(Math.max(...vals)),
    lastDivAmt: lastDiv ? r2(lastDiv.amount) : null,
    lastDivDate: lastDiv ? new Date(lastDiv.date * 1000).toISOString().slice(0, 10) : null,
    ttmDivChart: ttmDiv ? r2(ttmDiv) : null,
    closes: recentCloses,
    pivotBar,
  };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const symbol = (searchParams.get('symbol') || '').trim();
  if (!symbol || !/^[A-Za-z0-9.\-^=&]{1,20}$/.test(symbol)) {
    return Response.json({ error: 'pass ?symbol=NVDA (or RELIANCE.NS)' }, { status: 400 });
  }

  // Fundamentals (may reject) + chart (keyless) in parallel; neither blocks the other.
  const [sumRes, chart] = await Promise.all([
    fetchStockSummary(symbol).then((raw) => normalizeStock(raw, symbol)).catch((e) => ({ _err: e.message })),
    fetchChart(symbol),
  ]);

  const cd = chartDetail(chart);
  const fundamentalsOk = !sumRes._err;
  const base = fundamentalsOk ? sumRes : { symbol };

  const out = {
    ...base,
    // chart-derived (fill ranges when quoteSummary was blank)
    perf: cd.perf || null,
    dayLow: base.dayLow ?? cd.chartDayLow ?? null,
    dayHigh: base.dayHigh ?? cd.chartDayHigh ?? null,
    week52Low: base.week52Low ?? cd.chartWeek52Low ?? null,
    week52High: base.week52High ?? cd.chartWeek52High ?? null,
    lastDividend: base.lastDividend ?? cd.lastDivAmt ?? null,
    exDividendDate: base.exDividendDate ?? null,
    lastDivDate: cd.lastDivDate ?? null,
    closes: cd.closes || null,      // recent daily closes → sparkline + last-5 for an index overview
    pivotBar: cd.pivotBar || null,  // prior-session OHLC → S&R pivots
    fundamentals: fundamentalsOk ? 'live' : 'unavailable',
    fundamentalsError: fundamentalsOk ? undefined : base._err || sumRes._err,
    fetchedAt: new Date().toISOString(),
  };
  delete out._err;

  return Response.json(out, {
    headers: {
      // Fundamentals are slow-moving; let the CDN serve a warm copy and refresh in the
      // background. Price staleness is fine here — the heatmap tile carries the live tick.
      'Cache-Control': 's-maxage=120, stale-while-revalidate=600',
    },
  });
}
