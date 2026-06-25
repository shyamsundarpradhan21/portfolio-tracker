// Regression guard for the Dhan F&O drop: Dhan tags positions NSE_FNO but uses a
// hyphenated tradingSymbol (NIFTY-Jun2026-23550-PE) that segmentOf can't parse, so a
// symbol-only filter silently excluded every Dhan F&O leg from the live P&L.
import { describe, it, expect } from 'vitest';
import { isFnoPosition } from './brokers.mjs';

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
