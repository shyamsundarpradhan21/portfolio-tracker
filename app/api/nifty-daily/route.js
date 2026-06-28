// Daily NIFTY 50 (^NSEI) close series for the Trading-tab Analytics benchmark
// (alpha/beta vs the index + the benchmark curve). Public index data via Yahoo at
// DAILY resolution (interval=1d) — same provider as /api/history, which serves the
// slower weekly counterfactual. Daily closes change once a day, so cache hard and
// refresh in the background. Graceful: on a Yahoo failure return empty closes (the
// client drops the benchmark column rather than breaking the tab).
//
//   GET /api/nifty-daily?range=5y
//   → { fetchedAt, symbol:'^NSEI', closes:[{ date, close }], latest, latestDate }

import { fetchYahooSeries } from '../../lib/yahooHistory';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const ALLOWED = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']);
  const range = ALLOWED.has(searchParams.get('range')) ? searchParams.get('range') : '5y';

  const r = await fetchYahooSeries('^NSEI', range, '1d');
  if (r.error) {
    return Response.json(
      { error: r.error, closes: [] },
      { headers: { 'Cache-Control': 's-maxage=300' } }, // short cache so a transient Yahoo blip self-heals
    );
  }
  return Response.json(
    { fetchedAt: new Date().toISOString(), symbol: r.symbol, closes: r.closes, latest: r.latest, latestDate: r.latestDate },
    { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } },
  );
}
