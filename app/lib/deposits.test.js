// Locks usBuyLedger — the US sleeve's deployment/return basis. The US sleeve is
// measured on ACTUAL SECURITIES BOUGHT (cost basis), NOT Vested account deposits,
// so idle cash + funding transfers never dilute the deployed/return figures. This
// ledger (net buys per date, from us_trades.json) is the US analogue of the Indian
// TRANSACTIONS buy line and feeds the Capital Deployment card, the US XIRR/benchmark,
// the projection, and the growth backfill. A wrong sign or a missed sell would show
// as a phantom deploy/withdrawal, so pin the shape here.
import { describe, it, expect } from 'vitest';
import { usBuyLedger, buildDepositLedger } from './deposits.js';

describe('usBuyLedger — US net buys per date (Buy +, Sell −)', () => {
  it('sums flows + other across symbols per date, drops net-zero, sorts ascending', () => {
    const usTrades = {
      flows: {
        AAPL: [['2026-01-10', 50], ['2026-02-05', 30]],
        NVDA: [['2026-01-10', 20], ['2026-02-05', -30]], // Feb NVDA sell cancels the AAPL buy → net 0, dropped
      },
      other: [['2026-01-15', -40]],                       // a fully-exited name: net sell = withdrawal
    };
    expect(usBuyLedger(usTrades)).toEqual([
      { date: '2026-01-10', invested: 70 },              // 50 + 20 same day
      { date: '2026-01-15', invested: -40 },             // sell → negative (withdrawal)
      // 2026-02-05: 30 + (−30) = 0 → dropped
    ]);
  });

  it('a net-sell date is negative (a withdrawal), mirroring Indian sells', () => {
    const led = usBuyLedger({ flows: { TSLA: [['2026-03-01', -283.68]] }, other: [] });
    expect(led).toEqual([{ date: '2026-03-01', invested: -283.68 }]);
  });

  it('returns [] for null / empty / malformed tradebooks', () => {
    expect(usBuyLedger(null)).toEqual([]);
    expect(usBuyLedger({})).toEqual([]);
    expect(usBuyLedger({ flows: {}, other: [] })).toEqual([]);
  });

  it('rounds to cents (no float dust)', () => {
    const led = usBuyLedger({ flows: { X: [['2026-01-01', 0.1], ['2026-01-01', 0.2]] }, other: [] });
    expect(led).toEqual([{ date: '2026-01-01', invested: 0.3 }]);
  });
});

describe('buildDepositLedger — US term sources from net buys, not deposits', () => {
  it('folds US net buys (×fx) into the whole-book signed ledger', () => {
    const out = buildDepositLedger(
      {
        TRANSACTIONS: [{ date: '2026-01-02', invested: 1000 }],
        usTrades: { flows: { QQQM: [['2026-01-03', 100]] }, other: [] },
      },
      80,
    );
    expect(out).toEqual([
      { date: '2026-01-02', amt: 1000 },
      { date: '2026-01-03', amt: 8000 }, // 100 USD × 80
    ]);
  });

  it('a US sell nets out as a withdrawal in the ledger', () => {
    const out = buildDepositLedger(
      { usTrades: { flows: { QQQM: [['2026-02-01', -50]] }, other: [] } },
      80,
    );
    expect(out).toEqual([{ date: '2026-02-01', amt: -4000 }]);
  });
});
