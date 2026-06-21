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

// Curated market feeds + locale-tuned Google News RSS, each tagged by region so the
// Wrap can filter the ticker by India/Global cleanly (vs guessing from the source name).
const G = (q, loc) => `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${loc}`;
const FEEDS = [
  { url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html', source: 'CNBC', region: 'global' },
  { url: 'https://economictimes.indiatimes.com/markets/rssfeeds/1977021501.cms', source: 'ET Markets', region: 'india' },
  { url: 'https://www.moneycontrol.com/rss/latestnews.xml', source: 'Moneycontrol', region: 'india' },
  { url: G('stock market', 'hl=en-US&gl=US&ceid=US:en'), source: 'Google News', region: 'global', google: true },
  { url: G('Sensex OR Nifty stock market', 'hl=en-IN&gl=IN&ceid=IN:en'), source: 'Google News', region: 'india', google: true },
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
    return parseRss(xml, f.source).slice(0, 8).map((it) => {
      // Google titles are "Headline - Publisher"; split out the real publisher.
      let title = it.title, source = f.source;
      if (f.google) { const dash = it.title.lastIndexOf(' - '); if (dash > 0) { title = it.title.slice(0, dash); source = it.title.slice(dash + 3); } }
      return { title, link: it.link, source, region: f.region, date: it.date, ago: ago(it.date), sentiment: sentiment(title) };
    });
  } catch { return []; }
}

export async function GET() {
  const lists = await Promise.all(FEEDS.map(feed));
  const seen = new Set();
  const cut = Date.now() - 14 * 86400 * 1000; // ticker = current headlines only (drops dead/stale feeds like MCtopnews)
  const items = lists.flat()
    .filter((i) => { const t = Date.parse(i.date); return isFinite(t) && t >= cut && i.title && !seen.has(i.title) && seen.add(i.title); })
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0, 18);
  return Response.json(
    { fetchedAt: new Date().toISOString(), count: items.length, items, stale: items.length === 0 },
    { headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=3600' } },
  );
}
