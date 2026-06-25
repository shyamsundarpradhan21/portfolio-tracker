// Regression guard for the Dhan F&O drop: Dhan tags positions NSE_FNO but uses a
// hyphenated tradingSymbol (NIFTY-Jun2026-23550-PE) that segmentOf can't parse, so a
// symbol-only filter silently excluded every Dhan F&O leg from the live P&L.
import { describe, it, expect } from 'vitest';
import { isFnoPosition, splitLegs } from './brokers.mjs';

describe('isFnoPosition', () => {
  it('matches Dhan F&O by exchangeSegment even when the symbol does not parse', () => {
    expect(isFnoPosition({ tradingSymbol: 'NIFTY-Jun2026-23550-PE', exchangeSegment: 'NSE_FNO' })).toBe(true);
  });

  it('matches BSE F&O too', () => {
    expect(isFnoPosition({ exchangeSegment: 'BSE_FNO' })).toBe(true);
  });

  it('rejects the same unparseable symbol on a cash segment (proves the old symbol-only filter failed)', () => {
    expect(isFnoPosition({ tradingSymbol: 'NIFTY-Jun2026-23550-PE', exchangeSegment: 'NSE_EQ' })).toBe(false);
  });

  it('rejects a plain cash-equity position', () => {
    expect(isFnoPosition({ tradingSymbol: 'RELIANCE', exchangeSegment: 'NSE_EQ' })).toBe(false);
  });
});

// The capture now splits each broker's P&L into realised (closed legs) + open MTM so the
// Day-view period bar can show them apart, not as one merged 'net'. splitLegs is the pure
// core each puller feeds with its own leg-test + field accessors.
describe('splitLegs', () => {
  const access = { isLeg: isFnoPosition, realised: (p) => p.realizedProfit, mtm: (p) => p.unrealizedProfit };

  it('splits realised vs open MTM over F&O legs; net = their sum', () => {
    const list = [
      { exchangeSegment: 'NSE_FNO', realizedProfit: 100, unrealizedProfit: 50 },
      { exchangeSegment: 'NSE_FNO', realizedProfit: -30, unrealizedProfit: 20 },
    ];
    expect(splitLegs(list, access)).toEqual({ realised: 70, mtm: 70, net: 140 });
  });

  it('excludes non-F&O legs from both components', () => {
    const list = [
      { exchangeSegment: 'NSE_FNO', realizedProfit: 100, unrealizedProfit: 0 },
      { exchangeSegment: 'NSE_EQ', realizedProfit: 999, unrealizedProfit: 999 },
    ];
    expect(splitLegs(list, access)).toEqual({ realised: 100, mtm: 0, net: 100 });
  });

  it('coerces missing / non-numeric P&L to 0', () => {
    const list = [{ exchangeSegment: 'NSE_FNO', realizedProfit: undefined, unrealizedProfit: '12.5' }];
    expect(splitLegs(list, access)).toEqual({ realised: 0, mtm: 12.5, net: 12.5 });
  });

  it('empty / null list → zeroes', () => {
    expect(splitLegs([], access)).toEqual({ realised: 0, mtm: 0, net: 0 });
    expect(splitLegs(null, access)).toEqual({ realised: 0, mtm: 0, net: 0 });
  });
});
