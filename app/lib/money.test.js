// Locks the ₹/$ compact number cores and the mode-aware chart label (compactMoney) that
// drives the Live MTM + growth curves through the global ₹/$ toggle. The charts render
// glyph-free direction (colour), so these strings ARE the money the user reads — a wrong
// scale (L vs K vs M) or a dropped glyph would ship silently. certify.mjs proves the label
// is present in the DOM; this proves it says the right thing.
import { describe, it, expect } from 'vitest';
import { inrCd, usdCd, compactMoney } from './money.js';

describe('inrCd — ₹ compact core (Cr/L/K, glyph-free)', () => {
  it('tiers: plain / K / L / Cr', () => {
    expect(inrCd(625)).toBe('625');
    expect(inrCd(4318)).toBe('4.3K');
    expect(inrCd(185000)).toBe('1.85L');
    expect(inrCd(12500000)).toBe('1.25Cr');
  });
  it('keeps the sign for negatives (direction=colour callers pass abs)', () => {
    expect(inrCd(-4318)).toBe('-4.3K');
  });
});

describe('usdCd — $ compact core (M/K, glyph-free)', () => {
  it('tiers: plain / K / M', () => {
    expect(usdCd(49)).toBe('49');
    expect(usdCd(2102)).toBe('2.1K');
    expect(usdCd(1136363)).toBe('1.14M');
  });
});

describe('compactMoney — mode-aware chart label for a ₹-native value', () => {
  const fx = 88;
  it('₹-mode uses the ₹ scale (Cr/L/K) with glyph', () => {
    expect(compactMoney(625, 'inr', fx)).toBe('₹625');
    expect(compactMoney(4318, 'inr', fx)).toBe('₹4.3K');
    expect(compactMoney(185000, 'inr', fx)).toBe('₹1.85L');
    expect(compactMoney(12500000, 'inr', fx)).toBe('₹1.25Cr');
  });
  it('$-mode divides by fx and uses the $ scale (M/K) — never L/Cr', () => {
    expect(compactMoney(625, 'usd', fx)).toBe('$7');
    expect(compactMoney(4318, 'usd', fx)).toBe('$49');
    expect(compactMoney(185000, 'usd', fx)).toBe('$2.1K');
    expect(compactMoney(12500000, 'usd', fx)).toBe('$142.0K');
    expect(compactMoney(1e8, 'usd', fx)).toBe('$1.14M');
  });
  it('fx≤0 falls back to 88 (the CurrencyCtx default) rather than NaN', () => {
    expect(compactMoney(8800, 'usd', 0)).toBe('$100');
  });
});
