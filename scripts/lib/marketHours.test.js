// Tests for the daemon's market-session gate. Epoch ms are built with Date.UTC so
// the cases are unambiguous; IST = UTC + 5:30. 2026-06-24 is a Wednesday,
// 2026-06-27 a Saturday.
import { describe, it, expect } from 'vitest';
import { istParts, marketState } from './marketHours.mjs';

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
