// Tests for the equity day-change math (the pure core of the equity capture).
import { describe, it, expect } from 'vitest';
import { yahooSym, equityHoldings, computeDayChange } from './equity.mjs';

describe('yahooSym', () => {
  it('suffixes NSE tickers for Yahoo', () => {
    expect(yahooSym('AURIONPRO')).toBe('AURIONPRO.NS');
    expect(yahooSym(' bankbaroda ')).toBe('BANKBARODA.NS');
  });
});

describe('equityHoldings — pull qty/sym from broker-state INDIAN + SWING', () => {
  const state = {
    holdings: {
      INDIAN: { rows: [{ sym: 'AURIONPRO', qty: 35, avg: 840 }, { sym: 'X', qty: 0 }] },
      SWING: { rows: [{ sym: 'BANKBARODA', qty: 28, avg: 291 }] },
    },
  };
  it('takes rows with qty, tags the sleeve, drops zero-qty', () => {
    expect(equityHoldings(state)).toEqual([
      { sym: 'AURIONPRO', qty: 35, sleeve: 'INDIAN' },
      { sym: 'BANKBARODA', qty: 28, sleeve: 'SWING' },
    ]);
  });
  it('empty/missing state → []', () => {
    expect(equityHoldings(null)).toEqual([]);
    expect(equityHoldings({ holdings: {} })).toEqual([]);
  });
});

describe('computeDayChange — Σ qty×(price−prevClose)', () => {
  const holdings = [
    { sym: 'AURIONPRO', qty: 35, sleeve: 'INDIAN' },   // +5 × 35 = +175
    { sym: 'BANKBARODA', qty: 28, sleeve: 'SWING' },   // −2 × 28 = −56
  ];
  const quotes = {
    'AURIONPRO.NS': { price: 890, prevClose: 885 },
    'BANKBARODA.NS': { price: 277, prevClose: 279 },
  };
  it('nets day-change and splits by sleeve', () => {
    const r = computeDayChange(holdings, quotes);
    expect(r.net).toBe(119);                 // 175 − 56
    expect(r.bySleeve).toEqual({ INDIAN: 175, SWING: -56 });
    expect(r.covered).toBe(2);
    expect(r.missing).toEqual([]);
  });
  it('a holding with no quote is reported missing, not zeroed into the net', () => {
    const r = computeDayChange(holdings, { 'AURIONPRO.NS': { price: 890, prevClose: 885 } });
    expect(r.net).toBe(175);                  // only the covered holding
    expect(r.covered).toBe(1);
    expect(r.missing).toEqual(['BANKBARODA']);
  });
  it('skips quotes with null price/prevClose', () => {
    const r = computeDayChange(holdings, { 'AURIONPRO.NS': { price: null, prevClose: 885 }, 'BANKBARODA.NS': { price: 277, prevClose: 279 } });
    expect(r.covered).toBe(1);
    expect(r.missing).toEqual(['AURIONPRO']);
    expect(r.net).toBe(-56);
  });
});
