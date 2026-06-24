// Tests for the deterministic FD day-change — locks the formula to the app's
// (app/lib/calc.js `compound`, app/lib/backfill.js valuation) and the growth rules
// (new-money excluded, redemptions excluded, matured deposits net to 0).
import { describe, it, expect } from 'vitest';
import { compound, fdDayChange } from './fd.mjs';

describe('compound (mirror of app/lib/calc.js)', () => {
  it('quarterly-compounds: 1L @ 7% for 1y ≈ 107,186', () => {
    expect(compound(100000, 7, 1)).toBeCloseTo(100000 * Math.pow(1.0175, 4), 4);
    expect(compound(100000, 7, 1)).toBeGreaterThan(107000);
  });
});

describe('fdDayChange', () => {
  const active = { status: 'active', open: '2025-06-25', matures: '2027-06-25', principal: 100000, rate: 7 };

  it('a held FD accrues ~one day of interest (not the principal, not zero)', () => {
    const net = fdDayChange([active], '2026-06-25');
    expect(net).toBeGreaterThan(0);
    expect(net).toBeLessThan(40);          // 1L @ 7% ≈ ₹20/day — never the ₹100k principal
  });

  it('excludes a deposit OPENED today — principal is new money, not growth', () => {
    const opensToday = { ...active, open: '2026-06-25' };
    expect(fdDayChange([opensToday], '2026-06-25')).toBe(0);
  });

  it('excludes pipeline (not-yet-deployed) deposits', () => {
    expect(fdDayChange([{ ...active, status: 'pipeline' }], '2026-06-25')).toBe(0);
  });

  it('a matured deposit nets to 0 (value frozen at maturity)', () => {
    const matured = { ...active, open: '2023-01-01', matures: '2025-01-01' };
    expect(fdDayChange([matured], '2026-06-25')).toBe(0);
  });

  it('excludes a redeemed deposit (redemption is NW-neutral cash)', () => {
    const redeemed = { ...active, closedOn: '2026-05-01' };
    expect(fdDayChange([redeemed], '2026-06-25')).toBe(0);
  });

  it('sums across deposits and ignores rate-less rows', () => {
    const a = { ...active };
    const b = { ...active, principal: 200000 };
    const noRate = { ...active, rate: null };
    const sum = fdDayChange([a, b, noRate], '2026-06-25');
    const each = fdDayChange([a], '2026-06-25') + fdDayChange([b], '2026-06-25');
    expect(sum).toBeCloseTo(each, 2);      // noRate contributes nothing
  });
});
