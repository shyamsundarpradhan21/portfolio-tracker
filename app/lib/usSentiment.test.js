// Tests for the US-sentiment pure transforms — term-structure ratio, credit-spread
// + put/call scoring, 0-100 normalisation, the 125-day MA and momentum. Expected
// values worked out by hand. (Fetching/IO is intentionally not tested here.)
import { describe, it, expect } from 'vitest';
import {
  normalize, clampScore, vixTermStructure, hyOasScore, putCallScore,
  maMomentum, momentumScore, sma, scoreLabel,
} from './usSentiment.js';

describe('normalize — 0-100 with optional inversion', () => {
  it('maps the midpoint to 50', () => expect(normalize(5, 0, 10)).toBe(50));
  it('inverts: high raw → low score', () => {
    expect(normalize(0, 0, 10, true)).toBe(100);
    expect(normalize(10, 0, 10, true)).toBe(0);
    expect(normalize(5, 0, 10, true)).toBe(50);
  });
  it('clamps out-of-range to [0,100]', () => {
    expect(normalize(-5, 0, 10)).toBe(0);
    expect(normalize(15, 0, 10)).toBe(100);
  });
  it('returns null on bad input or zero range', () => {
    expect(normalize(NaN, 0, 10)).toBeNull();
    expect(normalize(5, 3, 3)).toBeNull();
    expect(normalize(undefined, 0, 10)).toBeNull();
  });
});

describe('clampScore', () => {
  it('bounds to [0,100]', () => {
    expect(clampScore(-3)).toBe(0);
    expect(clampScore(140)).toBe(100);
    expect(clampScore(60)).toBe(60);
  });
});

describe('vixTermStructure', () => {
  it('contango (calm → greed) when front << back', () => {
    const r = vixTermStructure(13.93, 16.78, 19.57);
    expect(r.signal).toBe('contango');
    expect(r.ratio).toBeCloseTo(0.712, 3);
    expect(r.score).toBeGreaterThan(56);
  });
  it('backwardation (stress → fear) when front > back', () => {
    const r = vixTermStructure(30, 28, 25);
    expect(r.signal).toBe('backwardation');
    expect(r.ratio).toBeGreaterThan(1);
    expect(r.score).toBeLessThan(25);
  });
  it('flat in the dead-band', () => {
    expect(vixTermStructure(9.6, 10, 10).signal).toBe('flat'); // ratio 0.96
  });
  it('returns null when 3M missing or non-positive', () => {
    expect(vixTermStructure(14, 16, null)).toBeNull();
    expect(vixTermStructure(14, 16, 0)).toBeNull();
  });
});

describe('hyOasScore — tight = greed, wide = fear', () => {
  it('endpoints', () => {
    expect(hyOasScore(2.5)).toBe(100);
    expect(hyOasScore(8)).toBe(0);
  });
  it('midpoint', () => expect(hyOasScore(5.25)).toBeCloseTo(50, 1));
  it('null on bad input', () => expect(hyOasScore(undefined)).toBeNull());
});

describe('putCallScore — low ratio = greed, high = fear', () => {
  it('endpoints', () => {
    expect(putCallScore(0.6)).toBe(100);
    expect(putCallScore(1.2)).toBe(0);
  });
  it('typical reading', () => expect(putCallScore(0.9)).toBeCloseTo(50, 1));
});

describe('maMomentum — % vs the 125-day MA', () => {
  it('above the MA is positive', () => expect(maMomentum(110, 100)).toBeCloseTo(10, 6));
  it('below the MA is negative', () => expect(maMomentum(90, 100)).toBeCloseTo(-10, 6));
  it('null on zero / missing MA', () => {
    expect(maMomentum(100, 0)).toBeNull();
    expect(maMomentum(100, null)).toBeNull();
  });
});

describe('momentumScore — ±8% spans the scale, above MA = greed', () => {
  it('flat is neutral', () => expect(momentumScore(0)).toBe(50));
  it('well above MA reads greedy', () => expect(momentumScore(8)).toBe(100));
  it('well below MA reads fearful', () => expect(momentumScore(-8)).toBe(0));
});

describe('sma — trailing average of last n closes', () => {
  it('averages the last n', () => expect(sma([1, 2, 3, 4, 5], 3)).toBe(4));
  it('ignores non-finite values when counting', () => expect(sma([NaN, 2, 4], 2)).toBe(3));
  it('null when fewer than n finite closes', () => expect(sma([1, 2], 3)).toBeNull());
});

describe('scoreLabel — band names', () => {
  it('maps each band', () => {
    expect(scoreLabel(10)).toBe('extreme fear');
    expect(scoreLabel(35)).toBe('fear');
    expect(scoreLabel(50)).toBe('neutral');
    expect(scoreLabel(65)).toBe('greed');
    expect(scoreLabel(90)).toBe('extreme greed');
  });
  it('null on bad input', () => expect(scoreLabel(NaN)).toBeNull());
});
