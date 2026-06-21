// Market-news ticker for the Wrap — keyless RSS from a few public market feeds
// (global + India), merged, sentiment-tagged, newest first. Some Indian sources
// may be unreachable from Vercel (like NSE/FRED); we merge whatever resolves and
// return { stale } only if everything fails — never a fabricated headline.
import { parseRss, sentiment, ago } from '../../lib/news';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const FEEDS = [
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC' },
  { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', source: 'ET Markets' },
  { url: 'https://www.moneycontrol.com/rss/MCtopnews.xml', source: 'Moneycontrol' },
];

async function feed(f) {
  try {
    const res = await fetch(f.url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      cache: 'no-store',
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, f.source).slice(0, 8).map((it) => ({
      title: it.title, link: it.link, source: f.source,
      date: it.date, ago: ago(it.date), sentiment: sentiment(it.title),
    }));
  } catch { return []; }
}

export async function GET() {
  const lists = await Promise.all(FEEDS.map(feed));
  const seen = new Set();
  const items = lists.flat()
    .filter((i) => i.title && !seen.has(i.title) && seen.add(i.title))
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0, 18);
  return Response.json(
    { fetchedAt: new Date().toISOString(), count: items.length, items, stale: items.length === 0 },
    { headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=3600' } },
  );
}
