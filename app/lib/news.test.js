// Tests for the news helpers — RSS/Atom parsing, lexicon sentiment, relative age.
import { describe, it, expect } from 'vitest';
import { parseRss, sentiment, ago } from './news.js';

const RSS = `<?xml version="1.0"?><rss><channel>
  <item><title><![CDATA[Nifty jumps 1.2% as banks rally]]></title><link>https://x.com/a</link><pubDate>Fri, 19 Jun 2026 10:00:00 +0530</pubDate></item>
  <item><title>Infosys cuts FY guidance; stock slides</title><link>https://x.com/b</link><pubDate>Fri, 19 Jun 2026 08:00:00 +0530</pubDate></item>
</channel></rss>`;
const ATOM = `<feed><entry><title>Apple unveils on-device AI</title><link href="https://y.com/c"/><updated>2026-06-19T12:00:00Z</updated></entry></feed>`;

describe('parseRss', () => {
  it('parses RSS items (CDATA title + link + date)', () => {
    const items = parseRss(RSS, 'Moneycontrol');
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ title: 'Nifty jumps 1.2% as banks rally', link: 'https://x.com/a', source: 'Moneycontrol' });
  });
  it('parses Atom entries with href links', () => {
    const items = parseRss(ATOM, 'Reuters');
    expect(items[0]).toMatchObject({ title: 'Apple unveils on-device AI', link: 'https://y.com/c' });
  });
  it('returns [] on junk', () => {
    expect(parseRss('', 's')).toEqual([]);
    expect(parseRss(null)).toEqual([]);
  });
});

describe('sentiment', () => {
  it('reads positive / negative / neutral from whole words', () => {
    expect(sentiment('Nifty jumps 1.2% as banks rally')).toBe(1);
    expect(sentiment('Infosys cuts FY guidance; stock slides')).toBe(-1);
    expect(sentiment('Company holds annual general meeting')).toBe(0);
  });
  it("doesn't match substrings (no false 'low' in 'below')", () => {
    expect(sentiment('Trading volumes below average')).toBe(0);
  });
});

describe('ago', () => {
  it('formats minutes / hours / days', () => {
    const now = Date.parse('2026-06-19T12:00:00Z');
    expect(ago('2026-06-19T11:30:00Z', now)).toBe('30m');
    expect(ago('2026-06-19T09:00:00Z', now)).toBe('3h');
    expect(ago('2026-06-17T12:00:00Z', now)).toBe('2d');
    expect(ago('not a date', now)).toBe('');
  });
});
