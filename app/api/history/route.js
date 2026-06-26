// Server-side weekly-history proxy for benchmark counterfactuals. Fetches ~2y of
// weekly closes from the Yahoo Finance v8 chart API (no CORS, no API key) so the
// Indian Stocks tab can value "same dated rupees" against each benchmark.
//
//   GET /api/history?symbols=^NSEI,NIFTYMIDSML400.NS,GOLDBEES.NS
//   → { series: { "^NSEI": { closes: [{ date, close }], latest, latestDate },
//                 ... } }
//
// Yahoo tickers for Indian indices are flaky; on any failure a symbol resolves
// to null and the client falls back to "—". Raw failures are logged server-side.

import { fetchYahooSeries } from '../../lib/yahooHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('symbols') || '';
  const ALLOWED = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']);
  const range = ALLOWED.has(searchParams.get('range')) ? searchParams.get('range') : '2y';
  const symbols = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) {
    return Response.json({ error: 'pass ?symbols=^NSEI,GOLDBEES.NS' }, { status: 400 });
  }
  if (symbols.length > 120) {
    return Response.json({ error: 'too many symbols (max 120)' }, { status: 400 });
  }

  const results = await Promise.all(symbols.map((s) => fetchYahooSeries(s, range)));
  const series = {};
  for (const r of results) {
    series[r.symbol] = r.error
      ? null
      : { closes: r.closes, latest: r.latest, latestDate: r.latestDate };
  }
  return Response.json(
    { fetchedAt: new Date().toISOString(), series },
    {
      headers: {
        // Weekly history changes slowly — cache hard, refresh in background.
        'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400',
      },
    },
  );
}
