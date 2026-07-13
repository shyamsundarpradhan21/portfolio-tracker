// Daily-return + trend-window math. Hand-derived so a window off-by-one, a wrong
// base, or a sign flip fails here rather than on the Nifty Overview strips.
import { describe, it, expect } from 'vitest';
import { dailyReturns, trendWindows } from './niftyTrend.js';

describe('dailyReturns', () => {
  const closes = [
    { date: '2026-07-01', close: 100 },
    { date: '2026-07-02', close: 110 },   // +10%
    { date: '2026-07-03', close: 99 },    // -10%
    { date: '2026-07-06', close: 118.8 }, // +20%
    { date: '2026-07-07', close: 100.98 },// -15%
  ];
  it('returns each session own day-over-day move, newest last', () => {
    expect(dailyReturns(closes, 5)).toEqual([
      { date: '2026-07-02', pct: 10 },
      { date: '2026-07-03', pct: -10 },
      { date: '2026-07-06', pct: 20 },
      { date: '2026-07-07', pct: -15 },
    ]);
  });
  it('caps to the last n sessions', () => {
    expect(dailyReturns(closes, 2)).toEqual([
      { date: '2026-07-06', pct: 20 },
      { date: '2026-07-07', pct: -15 },
    ]);
  });
  it('empty on too-few points', () => {
    expect(dailyReturns([{ date: 'x', close: 1 }])).toEqual([]);
  });
});

describe('trendWindows', () => {
  const closes = [
    { date: '2026-04-13', close: 80 },
    { date: '2026-06-13', close: 96 },
    { date: '2026-07-06', close: 100 },
    { date: '2026-07-13', close: 120 },
  ];
  it('measures latest vs the close at/just-before each lookback', () => {
    const t = trendWindows(closes);
    expect(t['1W']).toBe(20);  // 120 vs 100 (2026-07-06)
    expect(t['1M']).toBe(25);  // 120 vs 96  (2026-06-13)
    expect(t['3M']).toBe(50);  // 120 vs 80  (2026-04-13, ≤ 91d ago)
    expect(t['6M']).toBeNull();
    expect(t['1Y']).toBeNull();
  });
  it('honours a fresher live level override', () => {
    const t = trendWindows(closes, 126, '2026-07-13');
    expect(t['1W']).toBe(26); // 126 vs 100
  });
  it('YTD vs the prior calendar year-end close', () => {
    const c = [
      { date: '2025-12-31', close: 100 }, // prior year-end
      { date: '2026-03-01', close: 110 },
      { date: '2026-07-13', close: 130 },
    ];
    expect(trendWindows(c).YTD).toBe(30); // 130 vs 100
  });
  it('all-null (6 windows incl. YTD) when history is too short', () => {
    expect(trendWindows([{ date: '2026-07-13', close: 1 }])).toEqual({
      '1W': null, '1M': null, '3M': null, '6M': null, YTD: null, '1Y': null,
    });
  });
});
