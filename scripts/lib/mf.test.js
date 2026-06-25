// Tests for the pure MF day-change summation — units × (latest − prev) NAV per
// fund, skip-not-zero on unresolved funds.
import { describe, it, expect } from 'vitest';
import { sumMfDayChange } from './mf.mjs';

const funds = [{ id: 'flexi', units: 100 }, { id: 'nifty50', units: 200 }];

describe('sumMfDayChange', () => {
  it('sums units × (latest − prev) over resolved funds', () => {
    const nav = { flexi: { latest: 10.5, prev: 10.0 }, nifty50: { latest: 9.4, prev: 9.5 } };
    const r = sumMfDayChange(funds, nav);
    expect(r.net).toBe(30);            // 100×0.5 + 200×(−0.1) = 50 − 20
    expect(r.covered).toBe(2);
    expect(r.total).toBe(2);
    expect(r.byFund).toEqual({ flexi: 50, nifty50: -20 });
  });

  it('skips a fund whose NAV did not resolve (never zeroes it)', () => {
    const r = sumMfDayChange(funds, { flexi: { latest: 10.5, prev: 10.0 } }); // nifty50 missing
    expect(r.net).toBe(50);
    expect(r.covered).toBe(1);
    expect(r.total).toBe(2);
    expect(r.byFund).toEqual({ flexi: 50 });
  });

  it('returns null when nothing resolves', () => {
    expect(sumMfDayChange(funds, {})).toBeNull();
  });

  it('ignores funds with no units and rounds to 2dp', () => {
    const r = sumMfDayChange([{ id: 'x', units: 3 }, { id: 'y' }], { x: { latest: 100.333, prev: 100 }, y: { latest: 1, prev: 0 } });
    expect(r.covered).toBe(1);         // y has no units → skipped
    expect(r.byFund.x).toBeCloseTo(1.0, 2); // 3 × 0.333 = 0.999 → 1.0
  });
});
