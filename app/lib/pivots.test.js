// Pivot S/R math. Round-number bar proves the formulae; the Nifty-shaped bar
// reproduces the exact ladder in the approved mock (S3 24,033.92 … R3 24,358.22),
// so a formula drift fails here, not on the S&R rail.
import { describe, it, expect } from 'vitest';
import { computePivots, pivotSourceBar } from './pivots.js';

describe('computePivots', () => {
  it('classic ladder from round OHLC', () => {
    // H100 L90 C95 -> PP95, range10
    expect(computePivots({ high: 100, low: 90, close: 95 })).toEqual({
      pp: 95, r1: 100, r2: 105, r3: 110, s1: 90, s2: 85, s3: 80, asOf: null,
    });
  });

  it('reproduces the approved-mock Nifty ladder', () => {
    const lv = computePivots({ high: 24228.44, low: 24120.34, close: 24206.91, asOf: '2026-07-10' });
    expect(lv.pp).toBe(24185.23);
    expect(lv.s1).toBe(24142.02);
    expect(lv.s2).toBe(24077.13);
    expect(lv.s3).toBe(24033.92);
    expect(lv.r1).toBe(24250.12);
    expect(lv.r2).toBe(24293.33);
    expect(lv.r3).toBe(24358.22);
    expect(lv.asOf).toBe('2026-07-10');
  });

  it('null when OHLC is incomplete', () => {
    expect(computePivots({ high: 100, low: null, close: 95 })).toBeNull();
    expect(computePivots(null)).toBeNull();
  });
});

describe('pivotSourceBar', () => {
  const bars = [
    { date: '2026-07-08', high: 1, low: 1, close: 1 },
    { date: '2026-07-09', high: 2, low: 2, close: 2 },
    { date: '2026-07-10', high: 3, low: 3, close: 3 },
  ];
  it('drops the live partial session (uses the prior completed bar)', () => {
    expect(pivotSourceBar(bars, true).date).toBe('2026-07-09');
  });
  it('uses the latest completed bar when market is not live', () => {
    expect(pivotSourceBar(bars, false).date).toBe('2026-07-10');
  });
  it('null on empty input', () => {
    expect(pivotSourceBar([], true)).toBeNull();
    expect(pivotSourceBar(null, false)).toBeNull();
  });
});
