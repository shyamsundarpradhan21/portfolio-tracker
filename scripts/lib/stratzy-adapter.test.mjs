// Tests for the live/backtest split — the crux of the unbiased screen. If a point is
// mislabeled or hasBacktestSegment fires on a 1-day off-by-one head, the overfit
// signal is wrong, so these assert exact membership + the >=5-day threshold by hand.
import { describe, it, expect } from 'vitest';
import { normalizeAlgo, splitPerformance, dateKeyMs, fromHarvest } from './stratzy-adapter.mjs';

const ASOF = new Date('2026-07-01T00:00:00Z');

// Backtest-head: curve 2026-01-01 … 2026-01-12 (7 trade-days < liveSince 2026-01-15,
// then 3 live). liveSinceBacktested < liveSince.
const backtestHead = {
  _id: 'aaa', name: 'BacktestHead', category: 'Credit Spread',
  liveSince: '2026-01-15T06:00:00.000Z', liveSinceBacktested: '2026-01-01T00:00:00.000Z',
  performance: {
    '01/01/2026': 100, '02/01/2026': 101, '05/01/2026': 102, '06/01/2026': 103,
    '07/01/2026': 104, '08/01/2026': 105, '09/01/2026': 106, // 7 backtest
    '15/01/2026': 110, '16/01/2026': 111, '19/01/2026': 112, // 3 live
  },
  sharpeRatio: 1.2, maxDrawdown: -10, cagr: 30, winRatio: 60, drawDown: -8,
  backtestSharpeRatio: 1.5, backtestMaxDrawdown: -12, backtestAvgTimeToRecovery: 20, backTestingPeriod: '2 Years',
};

// Fully-live: liveSinceBacktested == liveSince; every point >= liveSince.
const fullyLive = {
  _id: 'bbb', name: 'FullyLive',
  liveSince: '2025-06-02T07:30:00.000Z', liveSinceBacktested: '2025-06-02T07:30:00.000Z',
  performance: { '02/06/2025': 100, '03/06/2025': 101, '04/06/2025': 102 },
};

// <5-day head: only 3 points before liveSince → split keeps them but hasBacktestSegment false.
const shortHead = {
  _id: 'ccc', name: 'ShortHead',
  liveSince: '2026-03-10T00:00:00.000Z', liveSinceBacktested: '2026-03-05T00:00:00.000Z',
  performance: {
    '05/03/2026': 100, '06/03/2026': 101, '09/03/2026': 102, // 3 backtest (<5)
    '10/03/2026': 103, '11/03/2026': 104, // 2 live
  },
};

describe('splitPerformance — boundary is liveSince (date < = backtest, >= = live)', () => {
  it('labels every backtest-head point correctly', () => {
    const { backtest, live } = splitPerformance(backtestHead.performance, backtestHead.liveSince);
    expect(backtest.map((p) => p.date)).toEqual(['01/01/2026','02/01/2026','05/01/2026','06/01/2026','07/01/2026','08/01/2026','09/01/2026']);
    expect(live.map((p) => p.date)).toEqual(['15/01/2026','16/01/2026','19/01/2026']);
    expect(backtest.length + live.length).toBe(Object.keys(backtestHead.performance).length); // every point labeled, none dropped
  });

  it('fully-live (liveSinceBacktested==liveSince) has zero backtest points', () => {
    const { backtest, live } = splitPerformance(fullyLive.performance, fullyLive.liveSince);
    expect(backtest).toHaveLength(0);
    expect(live).toHaveLength(3);
  });

  it('sorts by date and keeps values', () => {
    const { live } = splitPerformance({ '03/06/2025': 101, '02/06/2025': 100 }, '2025-01-01');
    expect(live.map((p) => p.date)).toEqual(['02/06/2025', '03/06/2025']);
    expect(live[0].v).toBe(100);
  });
});

describe('normalizeAlgo — hasBacktestSegment fires only at >= 5 backtest days', () => {
  it('backtest-head (7 days) → true', () => {
    const r = normalizeAlgo(backtestHead, { asOf: ASOF });
    expect(r.stratzy.hasBacktestSegment).toBe(true);
    expect(r.stratzy.backtestDays).toBe(7);
  });
  it('fully-live (0 days) → false', () => {
    expect(normalizeAlgo(fullyLive, { asOf: ASOF }).stratzy.hasBacktestSegment).toBe(false);
  });
  it('short head (3 days, < 5) → false but split still keeps the 3 points', () => {
    const r = normalizeAlgo(shortHead, { asOf: ASOF });
    expect(r.stratzy.hasBacktestSegment).toBe(false);
    expect(r.stratzy.backtestDays).toBe(3);
    expect(r.stratzy.split.backtest).toHaveLength(3);
    expect(r.stratzy.split.live).toHaveLength(2);
  });
});

describe('normalizeAlgo — record shape', () => {
  it('liveDays = calendar days liveSince→asOf', () => {
    // 2026-01-15 → 2026-07-01 = 167 days
    expect(normalizeAlgo(backtestHead, { asOf: ASOF }).stratzy.liveDays).toBe(167);
  });
  it('carries headline + backtest metrics and identity', () => {
    const r = normalizeAlgo(backtestHead, { asOf: ASOF });
    expect(r.id).toBe('aaa');
    expect(r.stratzy.headline.sharpeRatio).toBe(1.2);
    expect(r.stratzy.backtestMetrics.backtestSharpeRatio).toBe(1.5);
  });
  it('fromHarvest dedupes by id and accepts {data:[…]}', () => {
    const recs = fromHarvest({ data: [backtestHead, fullyLive, backtestHead] }, { asOf: ASOF });
    expect(recs).toHaveLength(2);
  });
});

describe('dateKeyMs', () => {
  it('parses DD/MM/YYYY as UTC midnight', () => {
    expect(dateKeyMs('15/01/2026')).toBe(Date.UTC(2026, 0, 15));
    expect(dateKeyMs('bad')).toBeNull();
  });
});
