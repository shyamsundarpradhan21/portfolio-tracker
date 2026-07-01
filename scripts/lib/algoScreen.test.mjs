// Tests for the unbiased screen. The screen ELIMINATES and CONFRONTS — a mislabeled
// flag or a wrong domination line would mislead a real allocation decision, so the
// stat primitives are checked against hand values and the screen logic against a
// tiny constructed universe.
import { describe, it, expect } from 'vitest';
import {
  mean, std, downsideDeviation, skewness, maxDrawdown, segmentMetrics,
  overfitRatio, confidenceTier, correlationToHeld, styleOf,
  riskStructure, tierFor, CAPITAL_TIERS, classifyElimination, regimeBuckets,
  runScreen, DEFAULT_PARAMS, buildScreenPayload,
} from './algoScreen.mjs';
import { buildRegimeCalendar } from '../../app/lib/regime.mjs';

// points from a returns array with sequential weekday-ish dates in 2026.
const pts = (returns, startMs = Date.UTC(2026, 0, 1)) =>
  returns.map((v, i) => {
    const d = new Date(startMs + i * 3 * 86400000); // ~every 3 days
    const p = (n) => String(n).padStart(2, '0');
    return { date: `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)}/${d.getUTCFullYear()}`, v };
  });

describe('stat primitives (hand-checked)', () => {
  it('mean / std (sample) / downsideDeviation', () => {
    expect(mean([1, 2, 3, 4, 5])).toBe(3);
    expect(std([1, 2, 3, 4, 5])).toBeCloseTo(1.5811, 3);
    expect(downsideDeviation([1, -2, 1, -3, 2], 0)).toBeCloseTo(Math.sqrt(13 / 5), 4);
  });
  it('skewness sign: right-skewed > 0, symmetric ~ 0', () => {
    expect(skewness([1, 1, 1, 1, 10])).toBeGreaterThan(0);
    expect(skewness([-2, -1, 0, 1, 2])).toBeCloseTo(0, 5);
  });
  it('maxDrawdown of additive cumulative curve', () => {
    expect(maxDrawdown([1, -2, 1, -3, 2])).toBe(-4); // cum 1,-1,0,-3,-1; peak 1; min dd -4
    expect(maxDrawdown([1, 2, 3])).toBe(0); // only up
  });
});

describe('segmentMetrics', () => {
  it('returns null below the minimum point count', () => {
    expect(segmentMetrics(pts([1, 2, 3, 4]))).toBeNull();
  });
  it('computes maxDD/worstDay/skew exactly and annualizes positively', () => {
    const m = segmentMetrics(pts([1, -2, 1, -3, 2]));
    expect(m.n).toBe(5);
    expect(m.maxDD).toBe(-4);
    expect(m.worstDay).toBe(-3);
    expect(m.cagr).toBeLessThan(0); // sum = -1 → negative annualized
  });
});

describe('overfitRatio', () => {
  it('null when no backtest segment', () => {
    expect(overfitRatio({ sharpe: 1, cagr: 50 }, null)).toBeNull();
  });
  it('live/backtest ratio; null components when backtest non-positive', () => {
    expect(overfitRatio({ sharpe: 1, cagr: 50 }, { sharpe: 2, cagr: 100 })).toEqual({ sharpe: 0.5, cagr: 0.5 });
    expect(overfitRatio({ sharpe: 1, cagr: 50 }, { sharpe: -1, cagr: 0 })).toEqual({ sharpe: null, cagr: null });
  });
});

describe('confidenceTier', () => {
  it('boundaries: <90 provisional, 90-180 moderate, >180 ok', () => {
    expect(confidenceTier(89)).toBe('provisional');
    expect(confidenceTier(90)).toBe('moderate');
    expect(confidenceTier(180)).toBe('moderate');
    expect(confidenceTier(181)).toBe('ok');
    expect(confidenceTier(null)).toBe('unknown');
  });
});

describe('correlationToHeld', () => {
  const rec = { name: 'X', correlationAvailable: true, dhan: { correlations: { overall: { A: 0.1, B: 0.9, X: 1 } } } };
  it('signed avg + most-positive max, excludes self', () => {
    const c = correlationToHeld(rec, ['A', 'B', 'X']);
    expect(c.avg).toBeCloseTo(0.5, 5);
    expect(c.max).toBe(0.9);
    expect(c.covered).toBe(2);
  });
  it('flags noCorrelation when unavailable', () => {
    expect(correlationToHeld({ name: 'Y', correlationAvailable: false }, ['A']).noCorrelation).toBe(true);
  });
});

describe('(4) riskStructure', () => {
  it('defined = hedged/credit-spread; undefined = naked buying/selling; equity/other', () => {
    expect(riskStructure({ dhan: { tags: ['Hedged'] }, displayCategory: 'Credit Spread' })).toBe('defined');
    expect(riskStructure({ displayCategory: 'Index Strategies', name: 'Flow Credit Spread Overnight' })).toBe('defined');
    expect(riskStructure({ dhan: { tags: ['Buying'] }, displayCategory: 'Option Buying' })).toBe('undefined');
    expect(riskStructure({ displayCategory: 'Short Strangle' })).toBe('undefined');
    expect(riskStructure({ displayCategory: 'Investing' })).toBe('equity');
    expect(riskStructure({ displayCategory: 'Index Strategies', name: 'Something Else' })).toBe('other');
  });
});

describe('(2) capital tiers (retail-calibrated)', () => {
  it('tierFor maps capital → tier; ~2.3L = conservative/defined-only, full F&O by ~₹6–10L', () => {
    expect(tierFor(231216).name).toBe('conservative');
    expect(tierFor(231216).admit).toEqual(['defined']);
    expect(tierFor(800000).name).toBe('balanced');       // ₹8L → full F&O (defined+undefined)
    expect(tierFor(800000).admit).toEqual(['defined', 'undefined']);
    expect(tierFor(5_000_000).name).toBe('aggressive');
    expect(CAPITAL_TIERS[0].dd.defined).toBeGreaterThan(CAPITAL_TIERS[0].dd.undefined); // naked tolerates deeper DD
  });
});

describe('(3) classifyElimination — OUT (kills) vs PARK (capital/drawdown)', () => {
  const tier = tierFor(231216); // conservative, admit defined only
  it('overfit / no-live / thin → OUT', () => {
    expect(classifyElimination({ structure: 'defined', live: { maxDD: -10 }, overfit: { sharpe: 0.4 }, liveDays: 200 }, tier).out[0]).toMatch(/overfitRatio/);
    expect(classifyElimination({ structure: 'defined', live: null, liveDays: 200 }, tier).out).toContain('no live series');
    expect(classifyElimination({ structure: 'defined', live: { maxDD: -10 }, liveDays: 50 }, tier).out[0]).toMatch(/liveDays/);
  });
  it('undefined structure at conservative tier → PARK (not OUT)', () => {
    const r = classifyElimination({ structure: 'undefined', live: { maxDD: -10 }, liveDays: 200 }, tier);
    expect(r.out).toEqual([]);
    expect(r.park[0]).toMatch(/not admitted/);
  });
  it('defined algo too deep for tier tolerance → PARK on drawdown', () => {
    const r = classifyElimination({ structure: 'defined', live: { maxDD: -40 }, liveDays: 200 }, tier); // -40 < -35
    expect(r.park[0]).toMatch(/tolerance -35/);
  });
  it('young algo gates drawdown on the deeper full-curve DD, not the shallow live-only one', () => {
    // live-only maxDD -10 would pass, but the full-curve gateMaxDD -50 breaches the -35 tol.
    const r = classifyElimination({ structure: 'defined', live: { maxDD: -10 }, gateMaxDD: -50, liveDays: 120 }, tier);
    expect(r.park[0]).toMatch(/maxDD -50 below.*tolerance -35/);
  });
});

// ── the screen end-to-end on a tiny universe ─────────────────────────────────
function rec(id, name, cat, liveReturns, liveDays, corr, opts = {}) {
  return {
    id, name, displayCategory: cat, category: cat, correlationAvailable: !!corr,
    stratzy: {
      liveDays, hasBacktestSegment: !!opts.backtest,
      split: { live: pts(liveReturns, opts.start), backtest: opts.backtest ? pts(opts.backtest) : [] },
    },
    dhan: corr ? { tags: opts.tags || [], correlations: { overall: corr } } : null,
  };
}

describe('runScreen — out/parked split, confront, redundancy (aggressive tier to admit all)', () => {
  // Two held Credit-Spread (defined) algos, mutually correlated 0.8 (redundant). A
  // defined survivor C beats them on live sortino AND is more diversifying. A Selling
  // (undefined) survivor must not confront. A defined maxDD blowup is PARKED (drawdown),
  // not OUT. Use aggressive tier so structure-admit doesn't park C/D.
  const H1 = rec('h1', 'H1', 'Credit Spread', [1, -1, 1, -1, 2], 200, { H2: 0.8, C: 0.2, D: 0.1 }, { tags: ['Hedged'] });
  const H2 = rec('h2', 'H2', 'Credit Spread', [1, -1, 1, 0, 1], 200, { H1: 0.8, C: 0.3, D: 0.1 }, { tags: ['Hedged'] });
  const C = rec('c', 'C', 'Credit Spread', [2, -0.5, 2, 1, 3], 200, { H1: 0.2, H2: 0.3 }, { tags: ['Hedged'] });
  const Dother = rec('d', 'D', 'Short Strangle', [3, 1, 2, 1, 2], 200, { H1: 0.1, H2: 0.1 }, { tags: ['Selling'] });
  const BlowUp = rec('e', 'E', 'Credit Spread', [5, -50, 5, 5, 5], 200, { H1: 0.1 }, { tags: ['Hedged'] });
  const Overfit = rec('f', 'F', 'Credit Spread', [1, -1, 1, -1, 2], 200, { H1: 0.1 }, { tags: ['Hedged'], backtest: [10, 9, 11, 10, 12] });

  const out = runScreen([H1, H2, C, Dother, BlowUp, Overfit], { heldIds: ['h1', 'h2'], capital: 5_000_000 });

  it('held set surfaced (never eliminated)', () => {
    expect(out.held.map((h) => h.name).sort()).toEqual(['H1', 'H2']);
    expect(out.tier.name).toBe('aggressive');
  });
  it('maxDD blowup → PARKED (drawdown), not OUT', () => {
    expect(out.parked.map((r) => r.name)).toContain('E');
    expect(out.out.map((r) => r.name)).not.toContain('E');
    expect(out.parked.find((r) => r.name === 'E').revisitTier).toBeNull(); // -50 too deep even for aggressive (-45)
  });
  it('clean defined + undefined survive at aggressive tier', () => {
    expect(out.survivors.map((r) => r.name).sort()).toEqual(['C', 'D']);
  });
  it('confront: same-style higher-sortino more-diversifying candidate dominates held', () => {
    const h1 = out.confrontations.find((c) => c.held === 'H1');
    expect(h1.dominatedBy.map((d) => d.name)).toContain('C');
    expect(h1.dominatedBy.map((d) => d.name)).not.toContain('D'); // different style (undefined)
  });
  it('redundant held pair flagged (corr 0.8)', () => {
    expect(out.redundant).toEqual([{ a: 'H1', b: 'H2', corr: 0.8 }]);
  });
});

describe('buildScreenPayload — KV (algo-screen:v1) shape', () => {
  // reuse the runScreen universe; empty regime calendar → buckets all-empty (shape only)
  const H1 = rec('h1', 'H1', 'Credit Spread', [1, -1, 1, -1, 2], 200, { H2: 0.8, C: 0.2 }, { tags: ['Hedged'] });
  const H2 = rec('h2', 'H2', 'Credit Spread', [1, -1, 1, 0, 1], 200, { H1: 0.8, C: 0.3 }, { tags: ['Hedged'] });
  const C = rec('c', 'C', 'Credit Spread', [2, -0.5, 2, 1, 3], 200, { H1: 0.2, H2: 0.3 }, { tags: ['Hedged'] });
  const Dother = rec('d', 'D', 'Short Strangle', [3, 1, 2, 1, 2], 200, { H1: 0.1 }, { tags: ['Selling'] });
  const BlowUp = rec('e', 'E', 'Credit Spread', [5, -50, 5, 5, 5], 200, { H1: 0.1 }, { tags: ['Hedged'] });
  const Overfit = rec('f', 'F', 'Credit Spread', [1, -1, 1, -1, 2], 200, { H1: 0.1 }, { tags: ['Hedged'], backtest: [10, 9, 11, 10, 12] });
  const s = runScreen([H1, H2, C, Dother, BlowUp, Overfit], { heldIds: ['h1', 'h2'], capital: 5_000_000, regimeCal: new Map() });
  const pay = buildScreenPayload(s, { asOf: '2026-06-30' });

  it('top-level fields + counts reconcile to universe', () => {
    expect(pay.asOf).toBe('2026-06-30');
    expect(pay.capitalTier.name).toBe('aggressive');
    expect(pay.capitalTier.admit).toContain('defined');
    expect(pay.counts.universe).toBe(6);
    expect(pay.counts.held + pay.counts.survivors + pay.counts.parked + pay.counts.out).toBe(pay.counts.universe);
    expect(pay.counts.flaggedOut).toBe(pay.counts.parked + pay.counts.out);
  });
  it('held carries a 4-row regime breakdown (ordered, tested enum) + visible flags', () => {
    expect(pay.held.map((h) => h.algo).sort()).toEqual(['H1', 'H2']);
    const rb = pay.held[0].regimeBreakdown;
    expect(rb.map((r) => r.regime)).toEqual(['up', 'down', 'chop', 'stressed']);
    for (const r of rb) expect(['empty', 'thin', 'ok']).toContain(r.tested);
    expect(Array.isArray(pay.held[0].flags)).toBe(true);
  });
  it('confront: dominatedBy entry carries challenger + regimeCaveat field; supplementary is an array', () => {
    const d = pay.confront.dominatedBy.find((x) => x.held === 'H1' && x.challenger === 'C');
    expect(d).toBeTruthy();
    expect('regimeCaveat' in d).toBe(true); // caveat shown beside the "better" number
    expect(Array.isArray(pay.confront.supplementary)).toBe(true);
  });
  it('survivorsByStyle grouped; parked + flaggedOutTally populated', () => {
    expect(Object.keys(pay.survivorsByStyle)).toContain('Hedged Options');
    expect(pay.parked.find((r) => r.algo === 'E').parkReason.length).toBeGreaterThan(0);
    expect(pay.flaggedOutTally.overfit).toBe(1); // F overfit → OUT
  });
});

describe('(1) regimeBuckets — bucket live returns by regime, flag thin', () => {
  it('buckets by the day\'s trend and flags thin buckets', () => {
    // 22-day up-ramp calendar; an algo trading only the up-trend days → up bucket filled, others empty/thin.
    const nifty = Array.from({ length: 22 }, (_, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, c: 100 + i }));
    const vix = nifty.map((d) => ({ date: d.date, vix: 13 }));
    const cal = buildRegimeCalendar(nifty, vix);
    const live = [21, 22].map((d) => ({ date: `${String(d).padStart(2, '0')}/01/2026`, v: 1 }))
      .concat(Array.from({ length: 6 }, (_, i) => ({ date: `${String(21).padStart(2, '0')}/01/2026`, v: 1 }))); // pad to >=5 up-days
    const rb = regimeBuckets({ stratzy: { split: { live } } }, cal);
    expect(rb.up.dayCount).toBeGreaterThanOrEqual(5);
    expect(rb.up.thin).toBe(rb.up.dayCount < 25);
    expect(rb.down.dayCount).toBe(0);
    expect(rb.down.thin).toBe(true); // empty bucket IS the finding
  });
});
