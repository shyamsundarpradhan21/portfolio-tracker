// Pure transforms for the US market-sentiment panel. Kept free of fetch/IO so the
// math — term-structure ratio, credit-spread scoring, 0-100 normalisation, the
// 125-day moving average — is unit-tested directly (see usSentiment.test.js).
//
// Every *score* is a 0-100 "fear → greed" reading: 0 = maximum fear, 100 = maximum
// greed, 50 = neutral. A missing or non-finite input returns `null`, never a 0 —
// callers render a "no data" state rather than a fake calm/panic.

export const isNum = (v) => typeof v === 'number' && isFinite(v);
export const clampScore = (v) => Math.max(0, Math.min(100, v));

// Map v within [lo, hi] to 0-100. invert=true → a HIGH raw value yields a LOW
// score (for "more of this = more fear" inputs: credit spreads, put/call, VIX).
export function normalize(v, lo, hi, invert = false) {
  if (!isNum(v) || lo === hi) return null;
  const t = (v - lo) / (hi - lo);
  return clampScore((invert ? 1 - t : t) * 100);
}

// VIX term structure: front-month (VIX9D) vs 3-month (VIX3M) implied vol.
// ratio = 9D / 3M. >1 = backwardation (short-dated vol bid over long → stress);
// <~0.95 = contango (the calm, upward-sloping default). The score maps the
// typical 0.75–1.10 ratio band to 100–0 (deep contango = greed, inverted = fear).
export function vixTermStructure(vix9d, vix, vix3m) {
  if (!isNum(vix9d) || !isNum(vix3m) || vix3m <= 0) return null;
  const ratio = vix9d / vix3m;
  const signal = ratio >= 1 ? 'backwardation' : ratio <= 0.95 ? 'contango' : 'flat';
  return { ratio, signal, score: normalize(ratio, 0.75, 1.10, true), vix9d, vix: isNum(vix) ? vix : null, vix3m };
}

// ICE BofA US HY OAS (%). Tight ~2.5 (risk-on / greed) → wide ~8 (stress / fear).
export function hyOasScore(oas) { return normalize(oas, 2.5, 8, true); }

// CBOE total put/call (raw ratio). Low ~0.6 (complacent / greed) → high ~1.2 (fear).
export function putCallScore(pc) { return normalize(pc, 0.6, 1.2, true); }

// S&P 500 last price vs its 125-day SMA → % above (+) / below (-) the average.
export function maMomentum(price, sma125) {
  if (!isNum(price) || !isNum(sma125) || sma125 <= 0) return null;
  return ((price - sma125) / sma125) * 100;
}

// Coincident momentum score: ±8% around the MA spans 0-100 (above = greed).
export function momentumScore(pct) { return normalize(pct, -8, 8, false); }

// Trailing simple moving average of the last n finite closes; null if too few.
export function sma(closes, n) {
  const xs = (closes || []).filter(isNum);
  if (xs.length < n) return null;
  return xs.slice(-n).reduce((a, b) => a + b, 0) / n;
}

// Shared fear/greed label for any 0-100 score (same bands as the gauge).
export function scoreLabel(s) {
  if (!isNum(s)) return null;
  return s < 25 ? 'extreme fear' : s < 45 ? 'fear' : s < 56 ? 'neutral' : s < 76 ? 'greed' : 'extreme greed';
}
