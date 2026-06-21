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

describe('yoy / yoyQ / mom — DATE-anchored transforms (gap-robust)', () => {
  // contiguous monthly series from (startY, startM), n points, value = valAt(i)
  const monthly = (startY, startM, n, valAt) =>
    Array.from({ length: n }, (_, i) => {
      const mo = startM - 1 + i, y = startY + Math.floor(mo / 12), m = (mo % 12) + 1;
      return { date: `${y}-${String(m).padStart(2, '0')}-01`, v: valAt(i) };
    });

  it('yoy compares against the value exactly 12 months earlier (contiguous)', () => {
    const rows = monthly(2025, 1, 13, (i) => (i === 12 ? 103 : 100)); // 2025-01..2026-01
    const last = yoy(rows).at(-1);
    expect(last.date).toBe('2026-01-01');
    expect(last.v).toBeCloseTo(3, 9);
  });

  it('yoy stays date-correct when a month is MISSING (the CPI bug)', () => {
    // strictly +1/month so the 12-mo-prior value is unambiguous; drop 2025-10.
    const rows = monthly(2024, 1, 29, (i) => 100 + i).filter((r) => r.date !== '2025-10-01');
    const last = yoy(rows).at(-1);
    expect(last.date).toBe('2026-05-01'); // v=128
    // 12-mo-prior BY DATE = 2025-05 (v=116) → 10.345%
    expect(last.v).toBeCloseTo((128 / 116 - 1) * 100, 9);
    // index-based (the bug) used 2025-04 (v=115) → 11.30%, a 13-month change
    expect(last.v).not.toBeCloseTo((128 / 115 - 1) * 100, 2);
  });

  it('yoy skips a point whose 12-mo-prior month is itself missing (no wrong base)', () => {
    const rows = monthly(2024, 1, 29, (i) => 100 + i).filter((r) => r.date !== '2025-05-01');
    const out = yoy(rows);
    expect(out.find((r) => r.date === '2026-05-01')).toBeUndefined();
  });

  it('yoyQ compares against ~12 months earlier for quarterly data', () => {
    const rows = [
      { date: '2024-12-31', v: 100 }, { date: '2025-03-31', v: 100 },
      { date: '2025-06-30', v: 100 }, { date: '2025-09-30', v: 100 },
      { date: '2025-12-31', v: 106 },
    ];
    const last = yoyQ(rows).at(-1);
    expect(last.date).toBe('2025-12-31');
    expect(last.v).toBeCloseTo(6, 9);
  });

  it('mom = change vs the prior month by date; a gap is skipped, not a 2-mo jump', () => {
    const rows = [
      { date: '2025-08-01', v: 100 }, { date: '2025-09-01', v: 175 },
      { date: '2025-11-01', v: 200 }, // Oct missing
    ];
    const out = mom(rows);
    expect(out).toContainEqual({ date: '2025-09-01', v: 75 });
    expect(out.find((r) => r.date === '2025-11-01')).toBeUndefined();
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
