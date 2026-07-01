// Tests for the unbiased screen. The screen ELIMINATES and CONFRONTS — a mislabeled
// flag or a wrong domination line would mislead a real allocation decision, so the
// stat primitives are checked against hand values and the screen logic against a
// tiny constructed universe.
import { describe, it, expect } from 'vitest';
import {
  mean, std, downsideDeviation, skewness, maxDrawdown, segmentMetrics,
  overfitRatio, confidenceTier, correlationToHeld, styleOf,
  riskStructure, volSideOf, tierFor, CAPITAL_TIERS, classifyElimination, regimeBuckets,
  runScreen, DEFAULT_PARAMS, buildScreenPayload, secondWorst, persistenceRanks,
  convictionCandidates,
} from './algoScreen.mjs';
import { allocateConviction, justify, labelBook } from './algoAllocate.mjs';
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
    expect(m.tradesPerYear).toBeGreaterThan(0); // observation frequency exposed (council #2)
  });
});

describe('persistence rank (2nd-worst horizon)', () => {
  it('secondWorst: 2nd-largest of many, the value if one, null if none', () => {
    expect(secondWorst([2, 2, 3, 4])).toBe(3);       // IV-Imbalance shape
    expect(secondWorst([9, 13, 14, 26])).toBe(14);   // Damper shape (worst 26 dropped)
    expect(secondWorst([10, 20])).toBe(10);          // 2 ranks → 2nd-largest = smaller
    expect(secondWorst([5])).toBe(5);                // single horizon → itself
    expect(secondWorst([])).toBeNull();
    expect(secondWorst([1, null, 3, undefined])).toBe(1); // ignores non-finite → [1,3] → 2nd-worst 1
  });
  it('persistenceRanks: full-universe desc rank per horizon, then 2nd-worst; nulls when no data', () => {
    const rec = (id, o) => ({ id, stratzy: { horizons: o } });
    const recs = [
      rec('A', { oneMonth: 100, threeMonth: 100, sixMonth: 100, oneYear: 100 }), // rank 1 everywhere
      rec('B', { oneMonth: 50, threeMonth: 50, sixMonth: 50, oneYear: 50 }),      // rank 2 everywhere
      rec('C', { oneMonth: 10, threeMonth: 10, sixMonth: 10, oneYear: null }),    // rank 3 on 3 horizons
      rec('D', { oneMonth: null, threeMonth: null, sixMonth: null, oneYear: null }),
    ];
    const m = persistenceRanks(recs);
    expect(m.get('A')).toBe(1);
    expect(m.get('B')).toBe(2);
    expect(m.get('C')).toBe(3);       // ranks [3,3,3] → 2nd-worst 3
    expect(m.get('D')).toBeNull();    // no horizon data → sorts last
  });
});

describe('volSideOf — regime-risk axis (short-vol vs long-vol)', () => {
  it('buying = long vol; credit spreads / selling / strangles = short vol; else neutral', () => {
    expect(volSideOf({ style: 'Naked Option Buying' })).toBe('long');
    expect(volSideOf({ style: 'Option Buying' })).toBe('long');
    expect(volSideOf({ structure: 'defined', style: 'Hedged Options' })).toBe('short'); // credit spread
    expect(volSideOf({ style: 'Option Selling' })).toBe('short');
    expect(volSideOf({ style: 'x', name: 'Bazaar Short Strangle' })).toBe('short');
    expect(volSideOf({ style: 'Index Strategies', structure: 'equity' })).toBe('neutral');
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
  it('regimeRisk block: short-vol share + stress-untested count + caveat (council #1)', () => {
    expect(pay.regimeRisk).toBeTruthy();
    expect(pay.regimeRisk.survivors).toBe(2);              // C (spread) + D (selling)
    expect(pay.regimeRisk.shortVolShare).toBe(100);        // both are short-vol
    expect(pay.regimeRisk.stressUntested).toBe(2);         // empty regime cal → none stress-tested
    expect(pay.regimeRisk.caveat).toMatch(/short-volatility.*stress regime/);
    // survivor entries carry the new axes
    const c = Object.values(pay.survivorsByStyle).flat().find((x) => x.algo === 'C');
    expect(c.volSide).toBe('short');
    expect(typeof c.stressTested).toBe('boolean');
    expect(c.liveMetrics.tradesPerYear).toBeGreaterThan(0);
  });
});

describe('convictionCandidates — monthly pool (conviction mode)', () => {
  it('pool = held+survivors+PARKED; OUT excluded; catastrophic-DD (≤-100) excluded', () => {
    const S = rec('s', 'S', 'Credit Spread', [1, -1, 1, -1, 2], 200, null, { tags: ['Hedged'] });     // clean → survivor
    const P = rec('p', 'P', 'Credit Spread', [5, -55, 5, 5, 5], 200, null, { tags: ['Hedged'] });      // maxDD ~-55 → parked (DD)
    const X = rec('x', 'X', 'Credit Spread', [5, -110, 5, 5, 5], 200, null, { tags: ['Hedged'] });     // maxDD ~-110 → catastrophic
    const O = rec('o', 'O', 'Credit Spread', [1, -1, 1, -1, 2], 200, null, { tags: ['Hedged'], backtest: [10, 9, 11, 10, 12] }); // overfit → OUT
    const screen = runScreen([S, P, X, O], { heldIds: [], capital: 5_000_000 });
    const names = convictionCandidates(screen, [S, P, X, O], []).map((c) => c.algo);
    expect(names).toContain('S');
    expect(names).toContain('P');        // PARKED is included in conviction mode (DD-park ignored)
    expect(names).not.toContain('X');    // catastrophic floor
    expect(names).not.toContain('O');    // quality kill (OUT) still excluded
  });

  it('ranks 2nd-worst persistence asc → live Sortino desc; Stratzy min/max carried', () => {
    const row = (id, name, horizons, sortino, min, max) => ({
      id, name, structure: 'defined', volSide: 'short', live: { maxDD: -20, sortino },
      gateMaxDD: -20, liveDays: 200, confidence: 'ok', downTested: true, downSortino: 2,
      stratzy: { horizons, minimumCapital: min, maximumCapital: max },
    });
    const A = row('a', 'A', { oneMonth: 100, threeMonth: 100, sixMonth: 100, oneYear: 100 }, 2, 100000, 300000); // persist2 1
    const B = row('b', 'B', { oneMonth: 50, threeMonth: 50, sixMonth: 50, oneYear: 50 }, 9, 100000, 300000);     // persist2 2 (higher sortino, still ranks below)
    const screen = { tier: { admit: ['defined', 'undefined'] }, held: [], survivors: [A, B], parked: [] };
    const c = convictionCandidates(screen, [A, B], []);
    expect(c.map((x) => x.algo)).toEqual(['A', 'B']); // persist2 dominates sortino
    expect(c[0].min).toBe(100000);
    expect(c[0].max).toBe(300000);
  });
});

describe('monthly engine — end-to-end artifact shape', () => {
  const S = rec('s', 'S', 'Credit Spread', [2, -0.5, 2, 1, 3], 200, null, { tags: ['Hedged'] });
  const T = rec('t', 'T', 'Option Buying', [3, -1, 2, 1, 2], 200, null, { tags: ['Buying'] }); // long-vol
  const recs = [S, T];
  const screen = runScreen(recs, { heldIds: ['s'], capital: 1_000_000, regimeCal: new Map() });
  const candidates = convictionCandidates(screen, recs, ['s']);
  const book = allocateConviction(candidates, { capital: 1_000_000 });
  const justification = justify(book, { regimeCaveat: 'caveat' });
  const labels = labelBook(book, candidates);

  it('candidates → allocate → justify → label assemble a complete artifact', () => {
    expect(candidates.length).toBeGreaterThan(0);
    for (const c of candidates) expect(c).toHaveProperty('persist2'); // present even if null
    expect(book.mode).toBe('conviction');
    expect(justification.headline).toMatch(/algos/);
    for (const k of ['keep', 'exit', 'add']) expect(labels).toHaveProperty(k);
    expect(labels.keep).toContain('S'); // held + funded
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
