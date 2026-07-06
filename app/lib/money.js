// JSX-free money number cores — extracted from fmt.js so the pure formatting logic
// unit-tests directly (fmt.js carries 'use client' + JSX and can't be imported in vitest;
// this mirrors how direction.js holds cl()). fmt.js re-exports inrCd/inrFd/compactMoney and
// keeps the glyph-carrying, context-aware wrappers. No React, no JSX here.

// ₹ compact (Cr/L/K) and grouped; keeps the sign for negatives.
export function inrCd(n) {
  const a = Math.abs(n);
  if (a >= 1e7) return (n / 1e7).toFixed(2) + 'Cr';
  if (a >= 1e5) return (n / 1e5).toFixed(2) + 'L';
  if (a >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return '' + Math.round(n);
}
export const inrFd = (n) => Math.round(n).toLocaleString('en-IN');

// $ compact (M/K) and grouped; carries the sign.
export const usdCd = (n) => {
  const a = Math.abs(n), s = n < 0 ? '-' : '';
  if (a >= 1e6) return s + (a / 1e6).toFixed(2) + 'M';
  if (a >= 1e3) return s + (a / 1e3).toFixed(1) + 'K';
  return s + Math.round(a);
};
export const usdFd = (n) => Math.round(n).toLocaleString('en-US');

// compactMoney — mode-aware compact label for a ₹-NATIVE value. The charts pass the live
// { mode, fx } from CurrencyCtx so their axis/value labels recompute on the ₹/$ toggle
// without depending on fmt.js's module mirror. $-mode divides by fx and uses the $ scale
// (M/K); ₹-mode uses inrCd (Cr/L/K). Glyph-carrying; keeps the value's sign (an unsigned
// badge caller passes Math.abs(v)). fx≤0 falls back to 88, the CurrencyCtx default.
export const compactMoney = (vInr, mode, fx) =>
  mode === 'usd' ? '$' + usdCd(vInr / (fx > 0 ? fx : 88)) : '₹' + inrCd(vInr);
