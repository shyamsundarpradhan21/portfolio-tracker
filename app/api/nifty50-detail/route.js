// Nifty-50 heatmap DEEP-DIVE feed — the slow-moving per-stock detail the hover/click
// cards need beyond the live price: multi-window performance, 52-wk range, and dividends.
// Fully KEYLESS (Yahoo chart endpoint with events=div); market cap is NOT here — it's
// computed client-side as live price × committed shares (data/nifty50-fundamentals.json),
// so this route never depends on the crumb-gated quoteSummary. Heavy (50 constituents) and
// slow-moving, so it's CDN-cached for hours, fetched lazily when the heatmap opens.
//
//   GET /api/nifty50-detail
//   → { fetchedAt, count, stocks:{ [sym]: { perf:{w1,m1,m3,m6,ytd,y1}, hi52, lo52,
//                                            lastDivAmt, lastDivDate, ttmDiv } } }

import { UA } from '../../lib/ua';
import { NIFTY50 } from '../../../data/nifty50';

export const runtime = 'nodejs';
export const maxDuration = 60;

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const DAY = 864e5;
const r2 = (n) => (n == null || !isFinite(n) ? null : Math.round(n * 100) / 100);
const pct = (a, b) => (a != null && b != null && b !== 0 ? r2(((a - b) / b) * 100) : null);

async function fetchChart(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym + '.NS')}?interval=1d&range=1y&events=div`;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const j = await res.json();
      const r = j?.chart?.result?.[0];
      if (r?.timestamp) return r;
    } catch { /* try next host */ }
  }
  return null;
}

function detailFrom(r) {
  const ts = r.timestamp || [];
  const closes = r.indicators?.quote?.[0]?.close || [];
  const pts = [];
  for (let i = 0; i < ts.length; i++) if (closes[i] != null) pts.push([ts[i] * 1000, closes[i]]);
  if (pts.length < 2) return null;
  const now = pts[pts.length - 1][0];
  const last = pts[pts.length - 1][1];
  // close at-or-before a target time (date-based so market holidays don't skew fixed offsets)
  const at = (target) => { let c = null; for (const [t, v] of pts) { if (t <= target) c = v; else break; } return c; };
  const yStart = Date.UTC(new Date(now).getUTCFullYear(), 0, 1);
  const perf = {
    w1: pct(last, at(now - 7 * DAY)),
    m1: pct(last, at(now - 30 * DAY)),
    m3: pct(last, at(now - 91 * DAY)),
    m6: pct(last, at(now - 182 * DAY)),
    ytd: pct(last, at(yStart)),
    y1: pct(last, pts[0][1]), // oldest point in the 1y window ≈ 1 year ago
  };
  const m = r.meta || {};
  const vals = pts.map((p) => p[1]);
  const divs = r.events?.dividends ? Object.values(r.events.dividends).sort((a, b) => a.date - b.date) : [];
  const lastDiv = divs.length ? divs[divs.length - 1] : null;
  const ttm = divs.filter((d) => d.date * 1000 > now - 365 * DAY).reduce((s, d) => s + d.amount, 0);
  return {
    perf,
    hi52: r2(m.fiftyTwoWeekHigh ?? Math.max(...vals)),
    lo52: r2(m.fiftyTwoWeekLow ?? Math.min(...vals)),
    lastDivAmt: lastDiv ? r2(lastDiv.amount) : null,
    lastDivDate: lastDiv ? new Date(lastDiv.date * 1000).toISOString().slice(0, 10) : null,
    ttmDiv: r2(ttm) || null,
  };
}

// bounded concurrency — 50 upstream fetches without tripping Yahoo's rate limiter
async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

export async function GET() {
  const rows = await mapLimit(NIFTY50, 8, async (c) => {
    const r = await fetchChart(c.sym);
    const d = r && detailFrom(r);
    return d ? [c.sym, d] : null;
  });
  const stocks = Object.fromEntries(rows.filter(Boolean));
  return Response.json(
    { fetchedAt: new Date().toISOString(), count: Object.keys(stocks).length, stocks },
    { headers: { 'Cache-Control': 'public, s-maxage=21600, stale-while-revalidate=86400' } }, // 6h fresh, 1d SWR
  );
}
