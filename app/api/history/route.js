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

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const isoDay = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);

async function fetchSeries(symbol, range) {
  const path =
    `/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1wk&range=${encodeURIComponent(range)}`;
  let lastErr;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) { lastErr = new Error('HTTP ' + res.status); continue; }
      const json = await res.json();
      const result = json?.chart?.result?.[0];
      const ts = result?.timestamp;
      const closeArr = result?.indicators?.quote?.[0]?.close;
      if (!Array.isArray(ts) || !Array.isArray(closeArr)) {
        lastErr = new Error('no series in payload');
        continue;
      }
      const closes = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closeArr[i];
        if (typeof c === 'number' && isFinite(c)) {
          closes.push({ date: isoDay(ts[i]), close: c });
        }
      }
      if (!closes.length) { lastErr = new Error('empty series'); continue; }
      // Prefer the live meta price for "today" if present.
      const meta = result?.meta;
      const latest =
        meta && typeof meta.regularMarketPrice === 'number'
          ? meta.regularMarketPrice
          : closes[closes.length - 1].close;
      return {
        symbol,
        closes,
        latest,
        latestDate: closes[closes.length - 1].date,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  // Flaky Indian index tickers: log the raw failure, resolve to null.
  console.log(`[history] ${symbol} unresolved:`, (lastErr && lastErr.message) || 'unknown');
  return { symbol, error: (lastErr && lastErr.message) || 'fetch failed' };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('symbols') || '';
  const ALLOWED = new Set(['1mo', '3mo', '6mo', '1y', '2y', '5y', '10y', 'max']);
  const range = ALLOWED.has(searchParams.get('range')) ? searchParams.get('range') : '2y';
  const symbols = raw.split(',').map((s) => s.trim()).filter(Boolean);
  if (symbols.length === 0) {
    return Response.json({ error: 'pass ?symbols=^NSEI,GOLDBEES.NS' }, { status: 400 });
  }
  if (symbols.length > 70) {
    return Response.json({ error: 'too many symbols (max 70)' }, { status: 400 });
  }

  const results = await Promise.all(symbols.map((s) => fetchSeries(s, range)));
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
