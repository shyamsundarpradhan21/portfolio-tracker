// Tests for the daemon's market-session gate. Epoch ms are built with Date.UTC so
// the cases are unambiguous; IST = UTC + 5:30. 2026-06-24 is a Wednesday,
// 2026-06-27 a Saturday.
import { describe, it, expect } from 'vitest';
import { istParts, marketState, usMarketState, usSessionDate } from './marketHours.mjs';

const at = (y, mo, d, h, mi) => Date.UTC(y, mo, d, h, mi); // mo 0-indexed

describe('istParts — UTC→IST wall clock', () => {
  it('shifts +5:30 and reads IST date/time/dow', () => {
    const p = istParts(at(2026, 5, 24, 4, 30)); // 04:30Z → 10:00 IST Wed
    expect(p.date).toBe('2026-06-24');
    expect(p.hhmm).toBe('10:00');
    expect(p.dow).toBe(3);
    expect(p.mins).toBe(600);
    expect(p.iso).toBe('2026-06-24T10:00:00+05:30');
  });
  it('rolls the date when IST crosses midnight', () => {
    // 20:00Z on the 24th → 01:30 IST on the 25th
    expect(istParts(at(2026, 5, 24, 20, 0)).date).toBe('2026-06-25');
  });
});

describe('marketState — NSE 09:13–15:32 IST gate, Mon–Fri', () => {
  it('open mid-session', () => expect(marketState(at(2026, 5, 24, 4, 30))).toBe('open')); // 10:00 IST
  it('pre before the open window', () => expect(marketState(at(2026, 5, 24, 3, 0))).toBe('pre')); // 08:30 IST
  it('post after close', () => expect(marketState(at(2026, 5, 24, 10, 30))).toBe('post')); // 16:00 IST
  it('weekend regardless of time', () => expect(marketState(at(2026, 5, 27, 5, 0))).toBe('weekend')); // Sat 10:30 IST
  it('open boundary: 09:14 IST is open, 09:12 IST is pre', () => {
    expect(marketState(at(2026, 5, 24, 3, 44))).toBe('open'); // 09:14 IST
    expect(marketState(at(2026, 5, 24, 3, 42))).toBe('pre');  // 09:12 IST
  });
  it('close boundary: 15:31 IST is open, 15:33 IST is post', () => {
    expect(marketState(at(2026, 5, 24, 10, 1))).toBe('open'); // 15:31 IST
    expect(marketState(at(2026, 5, 24, 10, 3))).toBe('post'); // 15:33 IST
  });
});

describe('usMarketState — NYSE in IST (evening → overnight)', () => {
  // 2026-06-24 Wed, 2026-06-26 Fri, 2026-06-27 Sat, 2026-06-28 Sun (IST)
  it('open Wed evening IST (20:00 = 14:30Z)', () => expect(usMarketState(at(2026, 5, 24, 14, 30))).toBe('open'));
  it('open in the past-midnight tail (Thu 01:00 IST = Wed 19:30Z) — still Wed US session', () =>
    expect(usMarketState(at(2026, 5, 24, 19, 30))).toBe('open'));
  it('closed in IST daytime (Wed 11:00 IST = 05:30Z)', () => expect(usMarketState(at(2026, 5, 24, 5, 30))).toBe('closed'));
  it('closed Sat evening IST (no US session)', () => expect(usMarketState(at(2026, 5, 27, 15, 0))).toBe('closed'));
  it('open Sat early-AM IST tail (Fri US session): Sat 01:00 IST', () =>
    expect(usMarketState(at(2026, 5, 26, 19, 30))).toBe('open')); // 2026-06-26 19:30Z = Sat 01:00 IST
});

describe('usSessionDate — overnight buckets under the evening date', () => {
  it('Wed 20:00 IST → 2026-06-24', () => expect(usSessionDate(at(2026, 5, 24, 14, 30))).toBe('2026-06-24'));
  it('Thu 01:00 IST → still 2026-06-24 (the Wed-evening session)', () =>
    expect(usSessionDate(at(2026, 5, 24, 19, 30))).toBe('2026-06-24'));
});
