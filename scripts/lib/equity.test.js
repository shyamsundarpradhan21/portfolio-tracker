// Tests for the equity day-change math (the pure core of the equity capture).
import { describe, it, expect } from 'vitest';
import { yahooSym, equityHoldings, computeDayChange, usHoldings, computeUsDayChange } from './equity.mjs';

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

describe('usHoldings — shape-tolerant pull from the private portfolio', () => {
  it('accepts sym|ticker|symbol and qty|units|shares, drops zero-qty', () => {
    const priv = { US: [{ ticker: 'aapl', shares: 10 }, { sym: 'MSFT', qty: 5 }, { symbol: 'X', units: 0 }] };
    expect(usHoldings(priv)).toEqual([{ sym: 'AAPL', qty: 10 }, { sym: 'MSFT', qty: 5 }]);
  });
  it('empty/missing → []', () => { expect(usHoldings(null)).toEqual([]); expect(usHoldings({})).toEqual([]); });
});

describe('computeUsDayChange — USD day-change × FX → INR', () => {
  const holdings = [{ sym: 'AAPL', qty: 10 }, { sym: 'MSFT', qty: 5 }];
  const quotes = { AAPL: { price: 232, prevClose: 230 }, MSFT: { price: 410, prevClose: 414 } };
  it('nets USD then converts at the FX rate', () => {
    // AAPL +2×10=+20 ; MSFT −4×5=−20 ; usd 0 → inr 0
    const r = computeUsDayChange(holdings, quotes, 86);
    expect(r.usd).toBe(0); expect(r.net).toBe(0); expect(r.covered).toBe(2);
  });
  it('applies FX to a non-zero day-change', () => {
    const r = computeUsDayChange([{ sym: 'AAPL', qty: 10 }], { AAPL: { price: 235, prevClose: 230 } }, 86);
    expect(r.usd).toBe(50);            // +5 × 10
    expect(r.net).toBe(4300);          // 50 × 86
  });
  it('net is null when FX is unavailable (→ daemon skips)', () => {
    const r = computeUsDayChange([{ sym: 'AAPL', qty: 10 }], { AAPL: { price: 235, prevClose: 230 } }, null);
    expect(r.usd).toBe(50); expect(r.net).toBe(null); expect(r.fx).toBe(null);
  });
});
