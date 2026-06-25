// Regression guard for the Dhan F&O drop: Dhan tags positions NSE_FNO but uses a
// hyphenated tradingSymbol (NIFTY-Jun2026-23550-PE) that segmentOf can't parse, so a
// symbol-only filter silently excluded every Dhan F&O leg from the live P&L.
import { describe, it, expect } from 'vitest';
import { isFnoPosition, splitLegs, parseFills } from './brokers.mjs';

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

// Executed order fills drive the buy/sell markers on the curve. parseFills is the pure
// core each puller feeds its order book + accessors (mirrors the Dhan accessor here).
describe('parseFills', () => {
  const dhanA = {
    isFilled: (o) => /TRADED/i.test(String(o.orderStatus || '')),
    side: (o) => o.transactionType, sym: (o) => o.tradingSymbol,
    qty: (o) => o.quantity, price: (o) => o.averageTradedPrice,
    time: (o) => o.updateTime, id: (o) => o.orderId,
  };

  it('keeps only filled orders; normalises side + HH:MM, strips the exchange prefix', () => {
    const orders = [
      { orderId: 'A1', orderStatus: 'TRADED', transactionType: 'BUY', tradingSymbol: 'NSE:NIFTY-23550-PE', quantity: 50, averageTradedPrice: 120.5, updateTime: '2026-06-25 14:23:45' },
      { orderId: 'A2', orderStatus: 'PENDING', transactionType: 'SELL', tradingSymbol: 'NIFTY', quantity: 25, averageTradedPrice: 0, updateTime: '2026-06-25 14:24:00' },
    ];
    expect(parseFills(orders, dhanA)).toEqual([
      { id: 'A1', t: '14:23', side: 'BUY', sym: 'NIFTY-23550-PE', qty: 50, price: 120.5 },
    ]);
  });

  it('drops a filled order with no parseable time', () => {
    const orders = [{ orderId: 'X', orderStatus: 'TRADED', transactionType: 'SELL', tradingSymbol: 'BANKNIFTY', quantity: 15, averageTradedPrice: 50, updateTime: null }];
    expect(parseFills(orders, dhanA)).toEqual([]);
  });

  it('empty / null → []', () => {
    expect(parseFills([], dhanA)).toEqual([]);
    expect(parseFills(null, dhanA)).toEqual([]);
  });
});
