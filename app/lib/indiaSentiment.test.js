// Tests for the India-sentiment pure transforms — rolling stdev, percentile rank,
// the regime-aware VIX + FII scorers, the FII/DII absorption gap, and the LEADING-only
// re-normalized headline. Math only, not fetch. Expected values worked out by hand.
import { describe, it, expect } from 'vitest';
import {
  stdev, percentileRank, vixLogZScore, fiiFlowScore, absorptionGap,
  indiaHeadline, LEAD_WEIGHTS_V1, LEAD_WEIGHTS_V2,
} from './indiaSentiment.js';

describe('stdev — sample standard deviation', () => {
  it('computes a known sample stdev', () => expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(2.138, 3));
  it('ignores non-finite values', () => expect(stdev([1, NaN, 3])).toBeCloseTo(Math.sqrt(2), 6));
  it('null with fewer than 2 finite values', () => expect(stdev([5])).toBeNull());
});

describe('percentileRank', () => {
  const h = [10, 11, 12, 13, 14, 15, 16, 17, 18, 19];
  it('ranks by share <= v', () => {
    expect(percentileRank(15, h)).toBe(60); // 6 of 10 are <= 15
    expect(percentileRank(10, h)).toBe(10);
    expect(percentileRank(19, h)).toBe(100);
  });
  it('null on empty / bad input', () => {
    expect(percentileRank(5, [])).toBeNull();
    expect(percentileRank(NaN, h)).toBeNull();
  });
});

describe('vixLogZScore — log-z at the rolling median, magnitude-preserving', () => {
  // right-skewed VIX "year": body ~10-16 with a fat right tail to 28.
  const yr = [10, 10, 11, 11, 11, 12, 12, 12, 12, 13, 13, 13, 13, 14, 14, 14, 15, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28];
  const minN = 20;
  it('at the median scores exactly 50 (z = 0)', () => {
    const logs = yr.map(Math.log).sort((a, b) => a - b);
    const medV = Math.exp(logs[Math.floor(logs.length / 2)]);
    expect(vixLogZScore(medV, yr, { minN })).toBe(50);
  });
  it('high VIX = fear (low), low VIX = greed (high)', () => {
    expect(vixLogZScore(28, yr, { minN })).toBeLessThan(vixLogZScore(12, yr, { minN }));
    expect(vixLogZScore(9, yr, { minN })).toBeGreaterThan(60);
  });
  it('PRESERVES tail magnitude: 18 and 28 score meaningfully apart (the pct-rank failure)', () => {
    const s18 = vixLogZScore(18, yr, { minN }), s28 = vixLogZScore(28, yr, { minN });
    expect(s18 - s28).toBeGreaterThan(10);
  });
  it('GREED CEILING is deliberate: the year-floor VIX is greed-leaning but CANNOT reach extreme greed', () => {
    // low VIX = absence of fear, not euphoria — the upside is physically soft (downside
    // ~1σ vs panic ~3σ). Pin it so nobody "fixes" the asymmetry into false-greed.
    const floor = Math.min(...yr);
    const s = vixLogZScore(floor, yr, { minN });
    expect(s).toBeGreaterThan(55); // it IS calm/greed-leaning
    expect(s).toBeLessThan(80);    // but can't manufacture extreme greed from vol alone
  });
  it('cold-start: null below minN', () => expect(vixLogZScore(15, [12, 13, 14], { minN: 30 })).toBeNull());
});

describe('fiiFlowScore — zero-anchored, rolling-σ scaled', () => {
  const hist = [200, -200, 150, -150, 100, -100, 250, -250, 50, -50, 180, -180]; // 12 pts, mean 0
  const s = stdev(hist);
  it('net-zero flow is neutral regardless of σ', () => expect(fiiFlowScore(0, hist)).toBe(50));
  it('+3σ greed ceiling / -3σ fear floor', () => {
    expect(fiiFlowScore(3 * s, hist)).toBe(100);
    expect(fiiFlowScore(-3 * s, hist)).toBe(0);
  });
  it('a big OUTFLOW reads fear (the canary fires on FII alone)', () => {
    expect(fiiFlowScore(-2 * s, hist)).toBeLessThan(25);
  });
  it('monotonic in flow', () => {
    expect(fiiFlowScore(-500, hist)).toBeLessThan(fiiFlowScore(-100, hist));
    expect(fiiFlowScore(-100, hist)).toBeLessThan(fiiFlowScore(100, hist));
  });
  it('cold-start: returns null below minN (window too thin to trust σ)', () => {
    expect(fiiFlowScore(100, [1, 2, 3, 4, 5])).toBeNull();
  });
});

describe('absorptionGap — foreign flight soaked up by domestic buying', () => {
  const fh = [200, -200, 150, -150, 100, -100, 250, -250, 50, -50, 180, -180];
  const dh = [-200, 200, -150, 150, -100, 100, -250, 250, -50, 50, -180, 180];
  const sf = stdev(fh), sd = stdev(dh);
  it('fires when FII <= -1.5σ AND DII >= +1σ', () => {
    const g = absorptionGap(-1.6 * sf, 1.1 * sd, fh, dh);
    expect(g).toEqual({ fii: -1.6 * sf, dii: 1.1 * sd });
  });
  it('a synthetic foreign-flight day (FII -2σ, DII +1.5σ) fires with correctly-SIGNED values', () => {
    const g = absorptionGap(-2 * sf, 1.5 * sd, fh, dh);
    expect(g).not.toBeNull();
    expect(g.fii).toBeLessThan(0);    // outflow — the copy reads "Foreign outflow ₹X ..."
    expect(g.dii).toBeGreaterThan(0); // domestic buying — "... absorbed by ₹Y"
  });
  it('near-miss (FII -1.4σ, just shy of the -1.5σ trigger) stays silent', () => {
    expect(absorptionGap(-1.4 * sf, 1.5 * sd, fh, dh)).toBeNull();
  });
  it('silent when DII is not absorbing', () => {
    expect(absorptionGap(-1.6 * sf, -0.5 * sd, fh, dh)).toBeNull();
  });
  it('silent on a normal outflow (above -1.5σ)', () => {
    expect(absorptionGap(-0.5 * sf, 1.1 * sd, fh, dh)).toBeNull();
  });
  it('null during cold-start', () => {
    expect(absorptionGap(-9999, 9999, [1, 2], [1, 2])).toBeNull();
  });
});

describe('indiaHeadline — LEADING-only, re-normalized weights', () => {
  it('blends FII + VIX at v1 weights', () => {
    // 0.55*60 + 0.45*40 = 51
    expect(indiaHeadline({ fiiScore: 60, vixScore: 40 }, LEAD_WEIGHTS_V1)).toBe(51);
  });
  it('cold-start (FII null) runs VIX at a true 1.0, NOT vix*0.45 with dead scale', () => {
    expect(indiaHeadline({ fiiScore: null, vixScore: 72 }, LEAD_WEIGHTS_V1)).toBe(72);
    // red if it ever divides by the full weight sum instead of re-normalizing:
    expect(indiaHeadline({ fiiScore: null, vixScore: 72 }, LEAD_WEIGHTS_V1)).not.toBe(Math.round(72 * 0.45));
  });
  it('v2 folds PCR in', () => {
    // 0.45*60 + 0.30*40 + 0.25*80 = 27 + 12 + 20 = 59
    expect(indiaHeadline({ fiiScore: 60, vixScore: 40, pcrScore: 80 }, LEAD_WEIGHTS_V2)).toBe(59);
  });
  it('null when no factor is present', () => expect(indiaHeadline({}, LEAD_WEIGHTS_V1)).toBeNull());
});
