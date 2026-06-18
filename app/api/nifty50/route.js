// Nifty 50 heatmap + movers feed for Pre-Market Insights. Fetched lazily (only
// when the Pre-Market tab is open) since it pulls 50 constituent quotes — too
// heavy to ride the 15-min whole-app price refresh.
//
//   GET /api/nifty50
//   → { fetchedAt, asOf, count, stocks:[{ sym, name, sector, price, pct,
//       change, state }], movers:{ gainers:[…5], losers:[…5] } }
//
// Each constituent is fetched independently with a query1→query2 host fallback
// (same contract as /api/quotes); a failed symbol is dropped, never faked, so a
// partial Yahoo outage still yields an honest heatmap of whatever resolved.

import { NIFTY50, NIFTY50_ASOF } from '../../../data/nifty50';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

async function fetchOne(c) {
  const path = `/v8/finance/chart/${encodeURIComponent(c.sym + '.NS')}?interval=1d&range=2d`;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(7000),
      });
      if (!res.ok) continue;
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== 'number') continue;
      const price = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose ?? null;
      return {
        sym: c.sym, name: c.name, sector: c.sector,
        price,
        change: prev != null ? price - prev : null,
        pct: prev ? ((price - prev) / prev) * 100 : null,
        state: meta.marketState || null,
      };
    } catch { /* try next host */ }
  }
  return null; // dropped — never a fabricated row
}

export async function GET() {
  const results = (await Promise.all(NIFTY50.map(fetchOne))).filter((r) => r && r.pct != null);
  const ranked = [...results].sort((a, b) => b.pct - a.pct);
  return Response.json(
    {
      fetchedAt: new Date().toISOString(),
      asOf: NIFTY50_ASOF,
      count: results.length,
      stocks: results,
      movers: { gainers: ranked.slice(0, 5), losers: ranked.slice(-5).reverse() },
    },
    { headers: { 'Cache-Control': 's-maxage=90, stale-while-revalidate=300' } },
  );
}
