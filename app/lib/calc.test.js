// Tests for the money-critical pure math. Every expected value is derived
// INDEPENDENTLY of the implementation (by hand / first principles) so a real bug
// — a sign flip, an off-by-one, a wrong compounding base — fails here instead of
// being rubber-stamped. These feed net worth, XIRR, and the tax memo, so a silent
// error costs real money; this is the deterministic gate for /check + CI.
import { describe, it, expect } from 'vitest';
import { compound, xirr, weightedCagr, applyCorpActions, regressVsVix } from './calc.js';

const iso = (d) => d.toISOString().slice(0, 10);

describe('compound — quarterly P*(1+r/400)^(4y)', () => {
  it('100 @ 8% for 1y = 108.243216 (1.02^4)', () => {
    expect(compound(100, 8, 1)).toBeCloseTo(108.243216, 5);
  });
  it('0 principal stays 0', () => expect(compound(0, 12, 5)).toBe(0));
});

describe('xirr — sign + magnitude (where sign bugs hide)', () => {
  it('+10% on a 365-day single round trip', () => {
    const r = xirr([
      { date: new Date('2021-01-01'), amount: -100 },
      { date: new Date('2022-01-01'), amount: 110 },
    ]);
    expect(r).toBeCloseTo(0.10, 3);
  });
  it('a LOSS returns a NEGATIVE rate', () => {
    const r = xirr([
      { date: new Date('2021-01-01'), amount: -100 },
      { date: new Date('2022-01-01'), amount: 90 },
    ]);
    expect(r).toBeLessThan(0);
    expect(r).toBeCloseTo(-0.10, 3);
  });
  it('returns null on < 2 cashflows', () => {
    expect(xirr([{ date: new Date('2021-01-01'), amount: -1 }])).toBeNull();
  });
});

describe('weightedCagr', () => {
  it('100 -> 121 over ~2y is ~10%', () => {
    const { cagr } = weightedCagr([{ date: '2021-01-01', invested: 100 }], 121, new Date('2023-01-01'));
    expect(cagr).toBeGreaterThan(9.9);
    expect(cagr).toBeLessThan(10.1);
  });
});

describe('applyCorpActions — a bonus dilutes cost basis, not just qty', () => {
  const CA = [{ type: 'bonus', sym: 'X', ex: '2020-01-01', ratio: '1:1' }];
  it('1:1 bonus doubles qty, halves cost', () => {
    const [h] = applyCorpActions([{ sym: 'X', qty: 100, cost: 200 }], new Date('2024-01-01'), CA, iso);
    expect(h.qty).toBe(200);
    expect(h.cost).toBeCloseTo(100, 6);
  });
  it('1:3 bonus (CUB-style) 141@212.12 -> 188@159.09', () => {
    const ca = [{ type: 'bonus', sym: 'CUB', ex: '2025-01-01', ratio: '1:3' }];
    const [h] = applyCorpActions([{ sym: 'CUB', qty: 141, cost: 212.12 }], new Date('2026-01-01'), ca, iso);
    expect(h.qty).toBe(188);
    expect(h.cost).toBeCloseTo(159.09, 1);
  });
  it('does NOT apply before the ex-date', () => {
    const [h] = applyCorpActions([{ sym: 'X', qty: 100, cost: 200 }], new Date('2019-01-01'), CA, iso);
    expect(h.qty).toBe(100);
    expect(h.cost).toBe(200);
  });
});

describe('regressVsVix — slope = fractional return per +1 VIX point', () => {
  it('recovers a known slope of 0.5 with R^2 = 1', () => {
    const vix = [10, 12, 11, 13, 9];          // dVIX = [+2, -1, +2, -4]
    const ret = [null, 1.0, -0.5, 1.0, -2.0]; // exactly 0.5 * dVIX
    const o = regressVsVix(ret, vix);
    expect(o.perVixPt).toBeCloseTo(0.5, 6);
    expect(o.rsq).toBeCloseTo(1, 6);
    expect(o.n).toBe(4);
  });
});
