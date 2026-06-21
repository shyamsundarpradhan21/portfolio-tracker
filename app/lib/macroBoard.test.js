// Tests for the macro-board pure helpers — percentile-in-range, regime tone, and
// the YoY/MoM transforms. Expected values worked out by hand.
import { describe, it, expect } from 'vitest';
import { rangeStat, tone, yoy, yoyQ, mom, boardCell } from './macroBoard.js';

describe('rangeStat — knob position + rank percentile + range', () => {
  it('places v linearly between the 1-yr low/high and ranks it', () => {
    const s = rangeStat(5, [2, 3, 4, 5, 6]);
    expect(s).toEqual({ pos: 75, pctile: 80, lo: 2, hi: 6 }); // (5-2)/4=75%; 4 of 5 ≤ 5
  });
  it('clamps + handles a flat history', () => {
    expect(rangeStat(4, [4, 4, 4])).toEqual({ pos: 50, pctile: 100, lo: 4, hi: 4 });
  });
  it('returns null on empty / non-finite', () => {
    expect(rangeStat(5, [])).toBeNull();
    expect(rangeStat(null, [1, 2])).toBeNull();
  });
});

describe('tone — regime from per-metric thresholds', () => {
  it('higher-is-worse (VIX): calm / watch / stress', () => {
    const c = { dir: -1, warn: 18, stress: 25 };
    expect(tone(12, c)).toBe('calm');
    expect(tone(20, c)).toBe('warn');
    expect(tone(30, c)).toBe('stress');
  });
  it('higher-is-better (GDP): inverted bands', () => {
    const c = { dir: 1, warn: 1.5, stress: 0 };
    expect(tone(2.4, c)).toBe('calm');
    expect(tone(1.0, c)).toBe('warn');
    expect(tone(-1, c)).toBe('stress');
  });
});

describe('yoy / mom transforms', () => {
  it('yoy = v[i]/v[i-12]-1 (×100)', () => {
    const rows = Array.from({ length: 13 }, (_, i) => ({ date: `m${i}`, v: i === 12 ? 103 : 100 }));
    const out = yoy(rows);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe('m12');
    expect(out[0].v).toBeCloseTo(3, 9);
  });
  it('yoyQ = v[i]/v[i-4]-1 (×100) for quarterly', () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ date: `q${i}`, v: i === 4 ? 106 : 100 }));
    const out = yoyQ(rows);
    expect(out).toHaveLength(1);
    expect(out[0].date).toBe('q4');
    expect(out[0].v).toBeCloseTo(6, 9);
  });
  it('mom = consecutive difference', () => {
    expect(mom([{ date: 'a', v: 100 }, { date: 'b', v: 175 }])).toEqual([{ date: 'b', v: 75 }]);
  });
});

describe('boardCell — slider cell from a series', () => {
  it('uses the latest value, derives pos/tone/asOf', () => {
    const cell = boardCell({ unit: '%', dir: -1, warn: 4.5, stress: 5 }, [
      { date: 'a', v: 4 }, { date: 'b', v: 4.45 },
    ]);
    expect(cell).toEqual({ value: 4.45, pos: 100, pctile: 100, lo: 4, hi: 4.45, tone: 'calm', asOf: 'b', unit: '%' });
  });
  it('stale on empty series', () => {
    expect(boardCell({ unit: '%' }, [])).toEqual({ stale: true });
  });
});
