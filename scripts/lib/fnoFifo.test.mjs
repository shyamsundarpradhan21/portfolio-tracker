// Tests for the per-contract FIFO realised engine + contract-key helpers.
import { describe, it, expect } from 'vitest';
import { fifoRealisedByDay, normContractKey, isCompleteContract } from './fnoFifo.mjs';

const f = (key, date, side, qty, price) => ({ key, date, side, qty, price });

describe('fifoRealisedByDay', () => {
  it('books a carried LONG at the original entry price on the closing day', () => {
    // open 50 @100 on d1, sell 50 @120 on d2 -> +1000 booked on d2 (not d1)
    const { dayRealised, residualLots } = fifoRealisedByDay([
      f('X', '2026-04-01', 'BUY', 50, 100),
      f('X', '2026-04-10', 'SELL', 50, 120),
    ]);
    expect(dayRealised).toEqual({ '2026-04-10': 1000 });
    expect(residualLots).toBe(0);
  });

  it('books a carried SHORT (sell first, cover later) as entry - exit', () => {
    const { dayRealised, residualLots } = fifoRealisedByDay([
      f('X', '2026-04-01', 'SELL', 50, 120),
      f('X', '2026-04-10', 'BUY', 50, 100),
    ]);
    expect(dayRealised).toEqual({ '2026-04-10': 1000 });
    expect(residualLots).toBe(0);
  });

  it('matches FIFO order across two open lots at different prices', () => {
    // buy 50@100, buy 50@110, sell 60@120 -> 50*(120-100) + 10*(120-110) = 1100
    const { dayRealised, openByKey } = fifoRealisedByDay([
      f('X', '2026-04-01', 'BUY', 50, 100),
      f('X', '2026-04-01', 'BUY', 50, 110),
      f('X', '2026-04-01', 'SELL', 60, 120),
    ]);
    expect(dayRealised).toEqual({ '2026-04-01': 1100 });
    expect(openByKey).toEqual({ X: 40 }); // 40 long lots left @110
  });

  it('nets a same-day round trip regardless of leg order', () => {
    const a = fifoRealisedByDay([f('X', '2026-04-01', 'BUY', 25, 10), f('X', '2026-04-01', 'SELL', 25, 12)]);
    const b = fifoRealisedByDay([f('X', '2026-04-01', 'SELL', 25, 12), f('X', '2026-04-01', 'BUY', 25, 10)]);
    expect(a.dayRealised).toEqual({ '2026-04-01': 50 });
    expect(b.dayRealised).toEqual({ '2026-04-01': 50 });
  });

  it('surfaces residual open lots when the history is incomplete (missing close)', () => {
    const { dayRealised, residualLots, openByKey } = fifoRealisedByDay([
      f('X', '2026-04-01', 'BUY', 50, 100),
      f('X', '2026-04-02', 'SELL', 20, 110),
    ]);
    expect(dayRealised).toEqual({ '2026-04-02': 200 }); // 20 * (110-100)
    expect(residualLots).toBe(30);
    expect(openByKey).toEqual({ X: 30 });
  });

  it('keeps distinct contracts in separate books', () => {
    const { dayRealised } = fifoRealisedByDay([
      f('A', '2026-04-01', 'BUY', 10, 100), f('A', '2026-04-01', 'SELL', 10, 105),
      f('B', '2026-04-01', 'SELL', 10, 200), f('B', '2026-04-01', 'BUY', 10, 190),
    ]);
    expect(dayRealised).toEqual({ '2026-04-01': 150 }); // 50 + 100
  });

  it('ignores zero-qty fills and rounds to 2dp', () => {
    const { dayRealised } = fifoRealisedByDay([
      f('X', '2026-04-01', 'BUY', 3, 10.111),
      f('X', '2026-04-01', 'SELL', 3, 10.222),
      f('X', '2026-04-01', 'BUY', 0, 99),
    ]);
    expect(dayRealised).toEqual({ '2026-04-01': 0.33 });
  });
});

describe('normContractKey', () => {
  it('strips the exchange suffix and all whitespace', () => {
    expect(normContractKey('NIFTY25SEP24650PE - NSE')).toBe('NIFTY25SEP24650PE');
    expect(normContractKey('OPTSTK ANGEL ONE LIMITED 28JUL26 PE 290.00')).toBe('OPTSTKANGELONELIMITED28JUL26PE290.00');
    expect(normContractKey('BANKNIFTY 26JUN24 52000 CE')).toBe('BANKNIFTY26JUN2452000CE');
  });
});

describe('isCompleteContract', () => {
  it('accepts real complete contract keys (expiry + FUT/CE/PE)', () => {
    for (const k of [
      'OPTSTKHDFCLIFE28MAR24620.00CE', 'OPTIDXNIFTY30DEC202525950CE',
      'FUTSTKASHOKLEYLND26JUN25', 'OPTSTKANGELONELIMITED28JUL26PE290.00', 'NIFTY25SEP24800CE',
    ]) expect(isCompleteContract(k)).toBe(true);
  });

  it('rejects fragmented note rows (missing underlying/expiry/strike)', () => {
    for (const k of ['105CE', '25400CE', '23300PE', 'OPTSTKSHRIRAMFIN', 'OPTIDXNIFTY19SEP2024'])
      expect(isCompleteContract(k)).toBe(false);
  });
});
