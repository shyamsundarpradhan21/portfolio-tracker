// Options-chain mapper. A trimmed NSE payload with a near + far expiry; the far
// expiry's huge OI must be ignored (nearest-expiry only), and PCR / ATM IV / max
// pain / expiry-in are hand-derived so a wrong reduction fails here, not live.
import { describe, it, expect } from 'vitest';
import { mapOptionChain, parseNseDate, expiryInDays } from './niftyOptions.mjs';

const CHAIN = {
  records: {
    expiryDates: ['15-Jul-2026', '22-Jul-2026'],
    underlyingValue: 100,
    timestamp: '13-Jul-2026 15:30:00',
    data: [
      { strikePrice: 90,  expiryDate: '15-Jul-2026', CE: { openInterest: 100, impliedVolatility: 12 }, PE: { openInterest: 50,  impliedVolatility: 0 } },
      { strikePrice: 100, expiryDate: '15-Jul-2026', CE: { openInterest: 200, impliedVolatility: 10 }, PE: { openInterest: 300, impliedVolatility: 14 } },
      { strikePrice: 110, expiryDate: '15-Jul-2026', CE: { openInterest: 100, impliedVolatility: 0 },  PE: { openInterest: 150, impliedVolatility: 16 } },
      // far expiry — must be excluded entirely
      { strikePrice: 100, expiryDate: '22-Jul-2026', CE: { openInterest: 9999, impliedVolatility: 99 }, PE: { openInterest: 9999, impliedVolatility: 99 } },
    ],
  },
};

describe('mapOptionChain', () => {
  const o = mapOptionChain(CHAIN, '2026-07-13');
  it('PCR from nearest-expiry OI only', () => expect(o.pcr).toBe(1.25)); // 500/400
  it('ATM IV = mean of CE/PE IV at the nearest strike', () => expect(o.atmIV).toBe(12)); // (10+14)/2
  it('ATM strike nearest the underlying', () => expect(o.atmStrike).toBe(100));
  it('max pain minimises writer intrinsic', () => expect(o.maxPain).toBe(100));
  it('expiry countdown in whole days', () => expect(o.expiryInDays).toBe(2));
  it('carries expiry + underlying + as-of', () => {
    expect(o.expiryDate).toBe('15-Jul-2026');
    expect(o.underlying).toBe(100);
    expect(o.asOf).toBe('13-Jul-2026 15:30:00');
  });

  it('null on empty / malformed input', () => {
    expect(mapOptionChain({}, '2026-07-13')).toBeNull();
    expect(mapOptionChain({ records: { data: [] } }, '2026-07-13')).toBeNull();
    expect(mapOptionChain(null, '2026-07-13')).toBeNull();
  });
});

describe('date helpers', () => {
  it('parseNseDate -> UTC midnight ms', () => {
    expect(parseNseDate('31-Jul-2026')).toBe(Date.UTC(2026, 6, 31));
    expect(parseNseDate('garbage')).toBeNull();
  });
  it('expiryInDays: 0 today, 1 tomorrow', () => {
    expect(expiryInDays('13-Jul-2026', '2026-07-13')).toBe(0);
    expect(expiryInDays('14-Jul-2026', '2026-07-13')).toBe(1);
    expect(expiryInDays('bad', '2026-07-13')).toBeNull();
  });
});
