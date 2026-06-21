// Pure helpers for the Wrap news cards: dependency-free RSS/Atom parsing +
// a tiny lexicon sentiment for the green/red shading. Kept out of the route so
// it's unit-testable without a network round-trip.

// Parse an RSS or Atom feed string into [{ title, link, source, date }].
// Tolerant: handles <item> (RSS) and <entry> (Atom), CDATA, and href links.
export function parseRss(xml, source = '') {
  if (!xml || typeof xml !== 'string') return [];
  const blocks = xml.match(/<item[\s\S]*?<\/item>/gi) || xml.match(/<entry[\s\S]*?<\/entry>/gi) || [];
  const out = [];
  for (const b of blocks) {
    const title = decodeXml(pick(b, 'title'));
    if (!title) continue;
    let link = pick(b, 'link');
    if (!link) { const m = b.match(/<link[^>]*href=["']([^"']+)["']/i); link = m ? m[1] : ''; }
    out.push({
      title,
      link: link.trim(),
      source,
      date: (pick(b, 'pubDate') || pick(b, 'published') || pick(b, 'updated') || '').trim(),
    });
  }
  return out;
}

function pick(block, tag) {
  const m = block.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return m ? m[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').trim() : '';
}
function decodeXml(s) {
  return (s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&apos;/g, "'")
    .trim();
}

// Headline sentiment for the card shading: +1 positive, -1 negative, 0 neutral,
// from whole-word keyword hits (deliberately simple + transparent).
const POS = ['surge', 'surges', 'jump', 'jumps', 'rise', 'rises', 'rally', 'rallies', 'gain', 'gains', 'beat', 'beats', 'record', 'soar', 'soars', 'win', 'wins', 'upgrade', 'upgrades', 'raises', 'raised', 'strong', 'growth', 'profit', 'boost', 'rebound', 'outperform', 'outperforms', 'high', 'highs', 'tops', 'expands'];
const NEG = ['fall', 'falls', 'drop', 'drops', 'slump', 'slumps', 'plunge', 'plunges', 'loss', 'losses', 'miss', 'misses', 'cut', 'cuts', 'weak', 'warn', 'warns', 'decline', 'declines', 'slide', 'slides', 'sink', 'sinks', 'downgrade', 'downgrades', 'probe', 'fraud', 'lawsuit', 'recall', 'halt', 'ban', 'low', 'lows', 'soft', 'pressured', 'trims', 'trim'];
export function sentiment(title) {
  const t = (title || '').toLowerCase();
  let s = 0;
  for (const w of POS) if (new RegExp(`\\b${w}\\b`).test(t)) s++;
  for (const w of NEG) if (new RegExp(`\\b${w}\\b`).test(t)) s--;
  return s > 0 ? 1 : s < 0 ? -1 : 0;
}

// Relative "3h" / "2d" age from an RSS date string (or '' if unparseable).
export function ago(dateStr, now = Date.now()) {
  const t = Date.parse(dateStr);
  if (!isFinite(t)) return '';
  const s = Math.max(0, (now - t) / 1000);
  if (s < 3600) return `${Math.max(1, Math.round(s / 60))}m`;
  if (s < 86400) return `${Math.round(s / 3600)}h`;
  return `${Math.round(s / 86400)}d`;
}
