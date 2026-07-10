// Historical USD/INR daily closes from the Yahoo Finance v8 chart API, so
// dollar outflows can be converted at the rate of their own deployment date.
//
//   GET /api/fx-history?start=2026-04-01
//
// Returns: { rates: { "2026-04-27": 94.83, ... } } — one close per trading
// day from `start` to today. Callers map a date to the nearest prior close.

import { UA } from '../../lib/ua';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
];

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const start = searchParams.get('start');
  if (!start || !/^\d{4}-\d{2}-\d{2}$/.test(start)) {
    return Response.json({ error: 'pass ?start=YYYY-MM-DD' }, { status: 400 });
  }
  const p1 = Math.floor(new Date(start + 'T00:00:00Z').getTime() / 1000);
  const p2 = Math.floor(Date.now() / 1000);
  const path =
    `/v8/finance/chart/INR=X?interval=1d&period1=${p1}&period2=${p2}` +
    `&includePrePost=false`;

  let lastErr;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) { lastErr = new Error(`HTTP ${res.status}`); continue; }
      const json = await res.json();
      const r = json?.chart?.result?.[0];
      const ts = r?.timestamp || [];
      const closes = r?.indicators?.quote?.[0]?.close || [];
      if (!ts.length) { lastErr = new Error('no data in payload'); continue; }
      const rates = {};
      ts.forEach((t, i) => {
        if (closes[i] != null) {
          rates[new Date(t * 1000).toISOString().slice(0, 10)] = +closes[i].toFixed(4);
        }
      });
      return Response.json(
        { fetchedAt: new Date().toISOString(), rates },
        // Historical closes barely change — cache aggressively at the CDN.
        { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } },
      );
    } catch (e) {
      lastErr = e;
    }
  }
  return Response.json({ error: (lastErr && lastErr.message) || 'fetch failed' }, { status: 502 });
}
