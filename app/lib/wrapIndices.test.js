// Tests for the live Market Wrap index mappers. Sample payloads mirror the real
// NSE /api/allIndices and Yahoo quote shapes; expected values are derived by hand
// so a sign flip, a wrong sort, or a dropped field fails here — not on a deploy.
import { describe, it, expect } from 'vitest';
import { mapAllIndices, mapYahooIndices } from './wrapIndices.js';

// Trimmed allIndices payload: the indices the wrap cares about + an unrelated one
// (NIFTY 100) that must be ignored, and a sector we DON'T map (NIFTY MEDIA absent).
const NSE_SAMPLE = {
  timestamp: '19-Jun-2026 17:35:04',
  data: [
    { index: 'NIFTY 50', last: 24013.1, previousClose: 24168, variation: -154.9, percentChange: -0.64, advances: 19, declines: 31, unchanged: 0 },
    { index: 'NIFTY NEXT 50', last: 100, previousClose: 100.33, percentChange: -0.33 },
    { index: 'NIFTY 500', last: 100, previousClose: 100.27, percentChange: -0.27, advances: '290', declines: '195', unchanged: 15 },
    { index: 'NIFTY MIDCAP 100', last: 100, previousClose: 99.78, percentChange: 0.22, advances: 61, declines: 39 },
    { index: 'NIFTY SMALLCAP 100', last: 100, previousClose: 99.58, percentChange: 0.42, advances: 67, declines: 33 },
    { index: 'NIFTY 100', last: 100, previousClose: 100.5, percentChange: -0.5 }, // not in our maps -> ignored
    { index: 'NIFTY IT', last: 100, previousClose: 103.65, percentChange: -3.65 },
    { index: 'NIFTY BANK', last: 100, previousClose: 100.48, percentChange: -0.48 },
    { index: 'NIFTY PHARMA', last: 100, previousClose: 99.27, percentChange: 0.73 },
    { index: 'NIFTY FINANCIAL SERVICES', last: 100, previousClose: 100.57, percentChange: -0.57 },
    { index: 'INDIA VIX', last: 12.97, previousClose: 12.67, variation: 0.3, percentChange: 2.37, high: 13.64, low: 12.07 },
  ],
};

describe('mapAllIndices — NSE allIndices -> wrap shape', () => {
  const out = mapAllIndices(NSE_SAMPLE);

  it('selects only mapped sectors, sorted worst-first', () => {
    expect(out.sectors).toEqual([
      { name: 'IT', pct: -3.65 },
      { name: 'Fin Services', pct: -0.57 },
      { name: 'Bank', pct: -0.48 },
      { name: 'Pharma', pct: 0.73 },
    ]);
  });

  it('selects breadth in map order (NIFTY 100 ignored)', () => {
    expect(out.breadth).toEqual([
      { name: 'Nifty 50', pct: -0.64 },
      { name: 'Next 50', pct: -0.33 },
      { name: 'Nifty 500', pct: -0.27 },
      { name: 'Midcap 100', pct: 0.22 },
      { name: 'Smallcap 100', pct: 0.42 },
    ]);
  });

  it('parses Nifty 50 level + India VIX (variation as change)', () => {
    expect(out.nifty).toEqual({ last: 24013.1, prevClose: 24168, pct: -0.64 });
    expect(out.vix).toEqual({ last: 12.97, prevClose: 12.67, change: 0.3, pct: 2.37, high: 13.64, low: 12.07 });
  });

  it('normalises the NSE timestamp to ISO and tags the source', () => {
    expect(out.source).toBe('NSE allIndices (live)');
    expect(new Date(out.asOf).getUTCFullYear()).toBe(2026);
  });

  it('tolerates missing rows — returns what resolved', () => {
    const partial = mapAllIndices({ timestamp: 't', data: [{ index: 'NIFTY IT', percentChange: -1.2 }] });
    expect(partial.sectors).toEqual([{ name: 'IT', pct: -1.2 }]);
    expect(partial.breadth).toEqual([]);
    expect(partial.vix).toBeNull();
  });

  it('builds real breadth from advances/declines (A/D ratio + % advancing by tier)', () => {
    expect(out.breadthAD).toEqual({
      caps: [
        { name: 'Nifty 50', pctUp: 38 },     // 19 / (19+31)
        { name: 'Midcap 100', pctUp: 61 },   // 61 / 100
        { name: 'Smallcap 100', pctUp: 67 }, // 67 / 100
      ],
      adv: 290, dec: 195, unch: 15,
      ratio: 1.49,   // 290/195
      pctUp: 60,     // 290 / (290+195)
    });
  });

  it('breadthAD is null when NSE omits advances/declines', () => {
    expect(mapAllIndices({ data: [{ index: 'NIFTY 50', percentChange: -0.64 }] }).breadthAD).toBeNull();
  });

  it('returns null when nothing usable is present', () => {
    expect(mapAllIndices({ data: [] })).toBeNull();
    expect(mapAllIndices({ data: [{ index: 'NIFTY MEDIA', percentChange: 1 }] })).toBeNull();
    expect(mapAllIndices(null)).toBeNull();
  });
});

describe('mapYahooIndices — fallback from already-fetched quotes', () => {
  const Q = {
    '^CNXIT': { pct: -3.65, price: 100, prev: 103.65, change: -3.65, asOf: '2026-06-19' },
    '^NSEBANK': { pct: -0.48, price: 100, prev: 100.48, change: -0.48 },
    '^INDIAVIX': { price: 12.97, prev: 12.67, change: 0.3, pct: 2.37, asOf: '2026-06-19' },
    '^NSEI': { price: 24013.1, prev: 24168, change: -154.9, pct: -0.64 },
    '^CNXPHARMA': { stale: true }, // a stale quote must be dropped, not rendered
  };

  it('builds the wrap shape and sorts sectors worst-first', () => {
    const out = mapYahooIndices((s) => Q[s]);
    expect(out.sectors).toEqual([
      { name: 'IT', pct: -3.65 },
      { name: 'Bank', pct: -0.48 },
    ]);
    expect(out.breadth).toEqual([{ name: 'Nifty 50', pct: -0.64 }]);
    expect(out.vix).toEqual({ last: 12.97, prevClose: 12.67, change: 0.3, pct: 2.37, high: null, low: null });
    expect(out.nifty).toEqual({ last: 24013.1, prevClose: 24168, pct: -0.64 });
    expect(out.source).toBe('Yahoo NSE indices (fallback)');
  });

  it('returns null when no quotes resolve', () => {
    expect(mapYahooIndices(() => null)).toBeNull();
    expect(mapYahooIndices(() => ({ stale: true }))).toBeNull();
  });
});
