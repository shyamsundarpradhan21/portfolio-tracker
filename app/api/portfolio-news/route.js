// Per-holding news for the Wrap's sentiment cards. Reads held tickers + names
// server-side (KV/file, never shipped to the client), then pulls each company's
// Google News RSS BY NAME — far more accurate than Yahoo's per-ticker RSS, which
// returned the wrong company for some Indian .NS symbols (LT → a Finnish firm)
// and content-farm clickbait for ETFs. Funds (ETF/Bond/Commodity) are skipped —
// they have no company-specific news. Region-tagged + sentiment-shaded, deduped,
// newest-first. Keyless. { stale } only when nothing resolves.
import { UA } from '../../lib/ua';
import { loadPortfolio } from '../../lib/serverPortfolio';
import { parseRss, sentiment, ago } from '../../lib/news';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Funds carry no company-specific news — only ETF/index clickbait, so skip them.
const FUND_CATS = new Set(['ETF', 'Bond', 'Commodity']);
// Drop trailing corporate suffixes so the search matches news that uses the
// common name ("Coforge Ltd" → Coforge, "Riot Platforms" → Riot, "Alphabet Inc C" → Alphabet).
const SUFFIX = /\s+(Inc\.?\s*[A-Z]?|Corp(?:oration)?|Ltd|Limited|Co|Company|Holdings?|Platforms?|Group|Technologies|Solutions|plc|NV|SA|AG)\.?$/i;
const cleanName = (n) => { let s = String(n || '').trim(); for (let i = 0; i < 2; i++) s = s.replace(SUFFIX, '').trim(); return s || String(n || '').trim(); };

// Google News RSS for one company (locale-tuned by region) → up to `take` recent
// items. Google titles are "Headline - Publisher"; we split out the publisher.
async function companyNews(name, ticker, region, take = 2) {
  const q = encodeURIComponent(`"${cleanName(name)}"`);
  const loc = region === 'in' ? 'hl=en-IN&gl=IN&ceid=IN:en' : 'hl=en-US&gl=US&ceid=US:en';
  const url = `https://news.google.com/rss/search?q=${q}&${loc}`;
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/xml, text/xml, */*' },
      cache: 'no-store',
      signal: AbortSignal.timeout(7000),
    });
    if (!res.ok) return [];
    const xml = await res.text();
    return parseRss(xml, 'Google News').slice(0, take).map((it) => {
      const dash = it.title.lastIndexOf(' - ');
      const title = dash > 0 ? it.title.slice(0, dash) : it.title;
      const pub = dash > 0 ? it.title.slice(dash + 3) : 'Google News';
      return { ticker, region, title, link: it.link, source: pub, date: it.date, ago: ago(it.date), sentiment: sentiment(title) };
    });
  } catch { return []; }
}

export async function GET() {
  const p = await loadPortfolio();
  if (!p) {
    return Response.json({ fetchedAt: new Date().toISOString(), count: 0, items: [], stale: true, error: 'no portfolio' },
      { headers: { 'Cache-Control': 'no-store' } });
  }
  const byInv = (a, b) => (b.inv || 0) - (a.inv || 0);
  const indian = (p.INDIAN || []).filter((h) => h.sym && h.name).sort(byInv)
    .map((h) => ({ name: h.name, ticker: h.sym, region: 'in' }));
  const us = (p.US || []).filter((h) => h.sym && h.name && !FUND_CATS.has(h.cat)).sort(byInv)
    .map((h) => ({ name: h.name, ticker: h.sym, region: 'us' }));
  // Bound the fan-out: the largest India names + the largest US names (~24 fetches).
  const CAP = 24, inN = Math.min(indian.length, 14);
  const holdings = [...indian.slice(0, inN), ...us.slice(0, CAP - inN)];

  const lists = await Promise.all(holdings.map((h) => companyNews(h.name, h.ticker, h.region)));
  const seen = new Set();
  const cut = Date.now() - 30 * 86400 * 1000; // last ~30 days (drops stale feeds)
  const items = lists.flat()
    .filter((i) => { const t = Date.parse(i.date); return isFinite(t) && t >= cut && i.title && !seen.has(i.title) && seen.add(i.title); })
    .sort((a, b) => (Date.parse(b.date) || 0) - (Date.parse(a.date) || 0))
    .slice(0, 14);

  return Response.json(
    { fetchedAt: new Date().toISOString(), count: items.length, items, stale: items.length === 0 },
    { headers: { 'Cache-Control': 's-maxage=600, stale-while-revalidate=3600' } },
  );
}
