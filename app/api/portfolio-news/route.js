// Per-holding news for the Wrap's sentiment cards. Reads the held tickers
// server-side (KV/file, never shipped to the client), pulls each symbol's Yahoo
// Finance headline RSS, tags sentiment, and returns a deduped, newest-first list.
// Keyless. { stale } only when nothing resolves.
import { loadPortfolio } from '../../lib/serverPortfolio';
import { parseRss, sentiment, ago } from '../../lib/news';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// Yahoo Finance per-symbol headline RSS → up to `take` recent items, tagged with
// the holding's display ticker.
async function symNews(yahooSym, label, take = 2) {
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(yahooSym)}&region=US&lang=en-US`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      cache: 'no-store',
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, 'Yahoo').slice(0, take).map((it) => ({
      ticker: label, title: it.title, link: it.link,
      date: it.date, ago: ago(it.date), sentiment: sentiment(it.title),
    }));
  } catch { return []; }
}

export async function GET() {
  const p = await loadPortfolio();
  if (!p) {
    return Response.json({ fetchedAt: new Date().toISOString(), count: 0, items: [], stale: true, error: 'no portfolio' },
      { headers: { 'Cache-Control': 'no-store' } });
  }
  // Indian holdings need the .NS suffix for Yahoo; US use the bare symbol.
  const syms = [
    ...(p.INDIAN || []).map((h) => ({ y: `${h.sym}.NS`, label: h.sym })),
    ...(p.US || []).map((h) => ({ y: h.sym, label: h.sym })),
  ].filter((s) => s.label).slice(0, 18);

  const lists = await Promise.all(syms.map((s) => symNews(s.y, s.label)));
  const seen = new Set();
  const items = lists.flat()
    .filter((i) => i.title && !seen.has(i.title) && seen.add(i.title))
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0, 14);

  return Response.json(
    { fetchedAt: new Date().toISOString(), count: items.length, items, stale: items.length === 0 },
    { headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=3600' } },
  );
}
