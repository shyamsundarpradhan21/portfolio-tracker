// Tests for the pure CMPF corpus + daily-accrual — locks the formula to app/lib/cmpf.js
// (contributions ×2 employer match, monthly interest credited at FY-end, daily growth
// = corpus × rate / 365).
import { describe, it, expect } from 'vitest';
import { cmpfCorpus, cmpfDailyAccrual } from './cmpf.mjs';

const rates = { '2023-24': 0.076, '2024-25': 0.078 };

describe('cmpfCorpus', () => {
  it('doubles the contribution for the 50:50 employer match', () => {
    expect(cmpfCorpus([{ month: '2023-04', emp: 1000 }], rates, '2023-04')).toBe(2000);
  });

  it('accrues interest monthly, credited at FY-end (March)', () => {
    const c = cmpfCorpus([{ month: '2023-04', emp: 1000 }], rates, '2024-03');
    expect(c).toBeGreaterThan(2000);   // 11 months interest on 2000 @ 7.6%
    expect(c).toBeLessThan(2200);
  });

  it('empty contributions → 0', () => {
    expect(cmpfCorpus([], rates, '2024-01')).toBe(0);
  });
});

describe('cmpfDailyAccrual', () => {
  it('= corpus × rate / 365 (the daily interest, the FD analogue)', () => {
    // corpus ~200000 @ 7.6% → ~41.6/day
    const acc = cmpfDailyAccrual([{ month: '2023-04', emp: 100000 }], rates, '2023-05');
    expect(acc).toBeGreaterThan(35);
    expect(acc).toBeLessThan(50);
  });

  it('no contributions → 0 accrual', () => {
    expect(cmpfDailyAccrual([], rates, '2024-01')).toBe(0);
  });
});
