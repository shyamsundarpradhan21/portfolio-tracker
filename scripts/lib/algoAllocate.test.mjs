// Tests for the capital allocation gate. A wrong cap here would size a real book, so the
// constraints are checked against a constructed candidate universe with known numbers.
import { describe, it, expect } from 'vitest';
import { allocate, ddScale, downScale, justify, DEFAULT_CAPS } from './algoAllocate.mjs';

// helper: a ranked candidate
const cand = (algo, volSide, over = {}) => ({
  algo, volSide, structure: over.structure ?? (volSide === 'short' ? 'defined' : 'undefined'),
  gateMaxDD: over.gateMaxDD ?? -20, downTested: over.downTested ?? true, downSortino: over.downSortino ?? 2,
  min: over.min ?? 0, max: over.max ?? Infinity,
});

describe('ddScale — drawdown → weight multiplier', () => {
  it('full at/above -20, quarter at/below -60, linear between', () => {
    expect(ddScale(-10)).toBe(1);
    expect(ddScale(-20)).toBe(1);
    expect(ddScale(-60)).toBe(0.25);
    expect(ddScale(-80)).toBe(0.25);
    expect(ddScale(-45)).toBeCloseTo(0.53, 2); // ~half at -45
    expect(ddScale(null)).toBe(1);             // unknown DD → unscaled
  });
});

describe('downScale — down-regime health haircut', () => {
  it('negative down-sortino → 0.5; not down-tested → 0.75; healthy → 1', () => {
    expect(downScale({ downSortino: -1, downTested: true })).toBe(0.5);
    expect(downScale({ downSortino: 3, downTested: false })).toBe(0.75);
    expect(downScale({ downSortino: 3, downTested: true })).toBe(1);
  });
});

describe('allocate — caps enforced', () => {
  it('single-algo cap: no pick exceeds 30% × scale of capital', () => {
    const book = allocate([cand('A', 'short'), cand('B', 'long'), cand('C', 'neutral')], { capital: 1_000_000 });
    for (const p of book.picks) expect(p.rupees).toBeLessThanOrEqual(300_000);
  });

  it('short-vol cluster capped at 60% of capital', () => {
    // four short-vol algos, each could take 30% → cluster would be 120% without the cap
    const cands = ['A', 'B', 'C', 'D'].map((n) => cand(n, 'short'));
    const book = allocate(cands, { capital: 1_000_000 });
    expect(book.shortVol).toBeLessThanOrEqual(600_000);
    expect(book.shortVolShare).toBeLessThanOrEqual(0.6);
  });

  it('deeper drawdown → smaller allocation', () => {
    const shallow = allocate([cand('S', 'neutral', { gateMaxDD: -20 })], { capital: 1_000_000 }).picks[0];
    const deep = allocate([cand('D', 'neutral', { gateMaxDD: -60 })], { capital: 1_000_000 }).picks[0];
    expect(deep.rupees).toBeLessThan(shallow.rupees);
    expect(deep.rupees).toBe(75_000);   // 30% × 0.25
    expect(shallow.rupees).toBe(300_000); // 30% × 1
  });

  it('guarantees a long-vol sleeve even when short-vol ranks higher', () => {
    // three short-vol first, one long-vol last — long-vol still gets funded
    const cands = [cand('A', 'short'), cand('B', 'short'), cand('C', 'short'), cand('L', 'long')];
    const book = allocate(cands, { capital: 1_000_000 });
    expect(book.longVol).toBeGreaterThanOrEqual(1);
    expect(book.picks.find((p) => p.algo === 'L')).toBeTruthy();
  });

  it('respects a per-algo minimum — skips (with reason) when caps leave too little', () => {
    // B's deep drawdown caps it at ₹75k (30% × 0.25), but it needs a ₹400k minimum → unfundable
    const book = allocate([cand('B', 'neutral', { gateMaxDD: -60, min: 400_000 })], { capital: 1_000_000 });
    const skB = book.skipped.find((s) => s.algo === 'B');
    expect(skB).toBeTruthy();
    expect(skB.reason).toMatch(/needs ₹400000 min/);
    expect(book.picks.length).toBe(0);
  });

  it('respects the algo maxCapital ceiling', () => {
    const book = allocate([cand('A', 'neutral', { max: 120_000 })], { capital: 1_000_000 });
    expect(book.picks[0].rupees).toBe(120_000);
    expect(book.picks[0].bindingReason).toMatch(/algo cap/);
  });

  it('deterministic — same input, same book', () => {
    const cands = [cand('A', 'short'), cand('B', 'long'), cand('C', 'short', { gateMaxDD: -50 })];
    expect(allocate(cands, { capital: 1_000_000 })).toEqual(allocate(cands, { capital: 1_000_000 }));
  });

  it('throws on non-positive capital', () => {
    expect(() => allocate([cand('A', 'short')], { capital: 0 })).toThrow();
  });
});

describe('justify — per-pick reasons + book summary', () => {
  const book = allocate([cand('A', 'short'), cand('B', 'long'), cand('C', 'neutral', { gateMaxDD: -50 })], { capital: 1_000_000 });
  const j = justify(book, { regimeCaveat: 'X% short-vol …' });
  it('headline + per-pick lines + vol mix + passthrough caveat', () => {
    expect(j.headline).toMatch(/algos ·.*deployed/);
    expect(j.perPick.length).toBe(book.picks.length);
    expect(j.perPick[0].line).toMatch(/sized by/);
    expect(j.bookSummary.volMix).toBeTruthy();
    expect(j.regimeCaveat).toBe('X% short-vol …');
  });
});
