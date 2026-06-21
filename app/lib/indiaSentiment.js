// Pure transforms for the India market-sentiment headline + LEADING signals. Free of
// fetch/IO so the math is unit-tested directly (indiaSentiment.test.js). Every *score*
// is 0-100 fear→greed (0 = max fear, 100 = max greed, 50 = neutral); null when an input
// is missing/too thin — never a fabricated 0.
//
// Design (reviewed): the gauge is a LEADING-ONLY composite (forward risk appetite),
// so breadth + price-momentum live in the coincident column and do NOT touch it. The
// two leading factors are normalized in DIFFERENT regime-aware ways, on purpose:
//   - FII net flow has a meaningful ZERO (net-zero = neutral) → zero-anchored, scaled
//     by the rolling stdev of recent FII flows. Scores FII ALONE (not FII+DII), so a
//     foreign-outflow day reads as fear even when domestic (DII) buying absorbs it.
//   - India VIX has NO zero (always positive; "neutral" is its own typical level) →
//     log-z anchored at the rolling MEDIAN of ln(VIX). Same z-machinery as FII; only
//     the anchor differs (FII: zero; VIX: rolling median). Log space handles VIX's
//     right-skew and KEEPS tail magnitude — plain percentile-rank flattens it (P85 18.4
//     and max 27.9 score alike), losing the distinction exactly where a forward-risk
//     gauge matters. (Fixed 11-22 band put 12.97 at ~82 "strong greed"; log-z → 46 mild
//     fear; 18 → 24; 28 → 0 — tail preserved.)
import { isNum, clampScore } from './usSentiment';

// Sample standard deviation of the finite values; null if fewer than 2.
export function stdev(xs) {
  const a = (xs || []).filter(isNum);
  if (a.length < 2) return null;
  const m = a.reduce((s, x) => s + x, 0) / a.length;
  return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / (a.length - 1));
}

// Percentile rank of v within history: % of samples <= v, 0-100. null if empty.
export function percentileRank(v, history) {
  const a = (history || []).filter(isNum);
  if (!isNum(v) || !a.length) return null;
  return (a.filter((x) => x <= v).length / a.length) * 100;
}

// India VIX score — log-z anchored at the rolling median of ln(VIX). z = (ln(vix) −
// median(ln history)) / σ(ln history); high VIX → high z → fear → low score; ±3σ spans
// the gauge. Magnitude-preserving at the tail (the percentile-rank failure). `history`
// is the trailing-year daily VIX; needs ~a month (minN) for a stable log-σ.
// (`percentileRank` above is retained for the row's human context — "Nth pct, yr".)
export function vixLogZScore(vix, history, { minN = 30 } = {}) {
  const a = (history || []).filter((x) => isNum(x) && x > 0);
  if (!isNum(vix) || vix <= 0 || a.length < minN) return null;
  const logs = a.map(Math.log).sort((x, y) => x - y);
  const med = logs[Math.floor(logs.length / 2)];
  const s = stdev(logs);
  if (s == null || s === 0) return null;
  return clampScore(50 - ((Math.log(vix) - med) / s / 3) * 50);
}

// FII net-flow score — the lead canary. Zero-anchored, scaled by the rolling stdev of
// recent FII NET flows (NOT FII+DII) over a fixed window. ±3σ spans the gauge. Returns
// null when the window is too short to trust σ (cold-start → the headline holds FII out
// and re-normalizes its weight onto VIX, rather than running at half-scale).
export function fiiFlowScore(fiiNetToday, fiiHistory, { window = 15, minN = 10 } = {}) {
  if (!isNum(fiiNetToday)) return null;
  const recent = (fiiHistory || []).filter(isNum).slice(-window);
  if (recent.length < minN) return null;
  const s = stdev(recent);
  if (s == null || s === 0) return null;
  return clampScore(50 + (fiiNetToday / s / 3) * 50); // z = fii/σ (zero-anchored)
}

// FII-vs-DII absorption: a big foreign OUTFLOW soaked up by domestic buying — the event
// the combined sum hides. Thresholds (-1.5σ FII / +1σ DII) on the SAME window as the
// score, so the row and the callout never disagree. Returns the raw nets for the copy.
export function absorptionGap(fiiNet, diiNet, fiiHistory, diiHistory, { window = 15, minN = 10 } = {}) {
  if (!isNum(fiiNet) || !isNum(diiNet)) return null;
  const fr = (fiiHistory || []).filter(isNum).slice(-window);
  const dr = (diiHistory || []).filter(isNum).slice(-window);
  if (fr.length < minN || dr.length < minN) return null;
  const sf = stdev(fr), sd = stdev(dr);
  if (!sf || !sd) return null;
  return (fiiNet <= -1.5 * sf && diiNet >= sd) ? { fii: fiiNet, dii: diiNet } : null;
}

// LEADING-only headline (v1: FII + VIX; v2 adds PCR). Weighted mean RE-NORMALIZED over
// whatever scores are present — so cold-start runs VIX at a true 1.0, not VIX@0.45 with
// 0.55 of the scale dead. Capped at FII 0.55 in v1 so the gauge isn't a near-pure proxy
// for the least-settled (provisional, T+1-final) number.
export const LEAD_WEIGHTS_V1 = { fii: 0.55, vix: 0.45 };
export const LEAD_WEIGHTS_V2 = { fii: 0.45, vix: 0.30, pcr: 0.25 };

export function indiaHeadline({ vixScore, fiiScore, pcrScore } = {}, weights = LEAD_WEIGHTS_V1) {
  const parts = [];
  if (isNum(fiiScore) && isNum(weights.fii)) parts.push([weights.fii, fiiScore]);
  if (isNum(vixScore) && isNum(weights.vix)) parts.push([weights.vix, vixScore]);
  if (isNum(pcrScore) && isNum(weights.pcr)) parts.push([weights.pcr, pcrScore]);
  if (!parts.length) return null;
  const w = parts.reduce((a, [x]) => a + x, 0);
  return Math.round(parts.reduce((a, [x, v]) => a + x * v, 0) / w);
}
