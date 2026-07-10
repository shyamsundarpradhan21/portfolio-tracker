// Server-side quote proxy. Fetches live prices from the Yahoo Finance v8 chart
// API so the browser never talks to Yahoo directly (no CORS, no API key).
//
//   GET /api/quotes?symbols=COFORGE.NS,AAPL,INR=X
//
// Returns: { "AAPL": { price, prevClose, change, pct, state, currency }, ... }

import { UA } from '../../lib/ua';
import { deriveMarketState } from '../../lib/market';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const HOSTS = [
  'https://query1.finance.yahoo.com',
  'https://query2.finance.yahoo.com',
];

// A browser-like UA keeps Yahoo from rate-limiting/blocking the request.

async function fetchOne(symbol) {
  const path =
    `/v8/finance/chart/${encodeURIComponent(symbol)}` +
    `?interval=1d&range=1d&includePrePost=false`;

  let lastErr;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': UA, Accept: 'application/json' },
        cache: 'no-store',
        // Yahoo can be slow; bail before the platform function timeout.
        signal: AbortSignal.timeout(8000),
      });
      if (!res.ok) {
        lastErr = new Error(`HTTP ${res.status}`);
        continue;
      }
      const json = await res.json();
      const meta = json?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== 'number') {
        lastErr = new Error('no price in payload');
        continue;
      }
      const price = meta.regularMarketPrice;
      const prevClose =
        meta.chartPreviousClose ??
        meta.previousClose ??
        meta.regularMarketPreviousClose ??
        price;
      const change = price - prevClose;
      const pct = prevClose ? (change / prevClose) * 100 : 0;
      return {
        symbol,
        price,
        prevClose,
        change,
        pct,
        state: deriveMarketState(meta),
        currency: meta.currency || null,
      };
    } catch (e) {
      lastErr = e;
    }
  }
  return { symbol, error: (lastErr && lastErr.message) || 'fetch failed' };
}

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const raw = searchParams.get('symbols') || '';
  const symbols = raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (symbols.length === 0) {
    return Response.json(
      { error: 'pass ?symbols=SYM1,SYM2 (e.g. AAPL,COFORGE.NS,INR=X)' },
      { status: 400 },
    );
  }
  if (symbols.length > 60) {
    return Response.json(
      { error: 'too many symbols (max 60 per request)' },
      { status: 400 },
    );
  }

  const results = await Promise.all(symbols.map(fetchOne));

  const out = {};
  let okCount = 0;
  for (const r of results) {
    if (r.error) {
      out[r.symbol] = { error: r.error };
    } else {
      okCount++;
      out[r.symbol] = {
        price: r.price,
        prevClose: r.prevClose,
        change: r.change,
        pct: r.pct,
        state: r.state,
        currency: r.currency,
      };
    }
  }

  return Response.json(
    { fetchedAt: new Date().toISOString(), count: okCount, quotes: out },
    {
      headers: {
        // Let the CDN serve a cached copy for a short window and refresh in
        // the background; keeps Yahoo load and latency down.
        'Cache-Control': 's-maxage=60, stale-while-revalidate=300',
      },
    },
  );
}
