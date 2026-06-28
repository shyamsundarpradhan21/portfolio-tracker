// Shared Yahoo weekly-close fetcher. Used by BOTH /api/history (the client benchmark proxy)
// and the Growth route's ₹ counterfactual — so the route calls Yahoo DIRECTLY instead of
// self-fetching its sibling /api/history. A server-side self-fetch to the deployment's own
// URL carries no auth cookie, so Vercel Deployment Protection blocks it at the edge (the
// benchmark closes silently vanish on a protected deployment). One impl, no fork.

const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const isoDay = (sec) => new Date(sec * 1000).toISOString().slice(0, 10);

// One symbol → { symbol, closes:[{date,close}], latest, latestDate } | { symbol, error }.
// Tries both Yahoo hosts; on total failure logs and returns an error (callers map to null).
// interval defaults to '1wk' (weekly benchmark counterfactual); pass '1d' for the daily
// series the Trading-tab Analytics needs (alpha/beta aligned to exact trading days).
export async function fetchYahooSeries(symbol, range, interval = '1wk') {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=${encodeURIComponent(interval)}&range=${encodeURIComponent(range)}`;
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
      if (!Array.isArray(ts) || !Array.isArray(closeArr)) { lastErr = new Error('no series in payload'); continue; }
      const closes = [];
      for (let i = 0; i < ts.length; i++) {
        const c = closeArr[i];
        if (typeof c === 'number' && isFinite(c)) closes.push({ date: isoDay(ts[i]), close: c });
      }
      if (!closes.length) { lastErr = new Error('empty series'); continue; }
      const meta = result?.meta;
      const latest = meta && typeof meta.regularMarketPrice === 'number' ? meta.regularMarketPrice : closes[closes.length - 1].close;
      return { symbol, closes, latest, latestDate: closes[closes.length - 1].date };
    } catch (e) { lastErr = e; }
  }
  console.log(`[yahooHistory] ${symbol} unresolved:`, (lastErr && lastErr.message) || 'unknown');
  return { symbol, error: (lastErr && lastErr.message) || 'fetch failed' };
}

// Many symbols → { sym: { closes, latest, latestDate } | null }.
export async function fetchYahooSeriesMany(symbols, range, interval = '1wk') {
  const results = await Promise.all((symbols || []).map((s) => fetchYahooSeries(s, range, interval)));
  const series = {};
  for (const r of results) series[r.symbol] = r.error ? null : { closes: r.closes, latest: r.latest, latestDate: r.latestDate };
  return series;
}
