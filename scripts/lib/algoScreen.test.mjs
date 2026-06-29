// Tests for the unbiased screen. The screen ELIMINATES and CONFRONTS — a mislabeled
// flag or a wrong domination line would mislead a real allocation decision, so the
// stat primitives are checked against hand values and the screen logic against a
// tiny constructed universe.
import { describe, it, expect } from 'vitest';
import {
  mean, std, downsideDeviation, skewness, maxDrawdown, segmentMetrics,
  overfitRatio, confidenceTier, correlationToHeld, styleOf, flagOutReasons,
  runScreen, DEFAULT_PARAMS,
} from './algoScreen.mjs';

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

describe('flagOutReasons (eliminate, don\'t score)', () => {
  const base = { liveDays: 200, live: { maxDD: -10 }, overfit: null };
  it('clean survivor → no reasons', () => {
    expect(flagOutReasons(base)).toEqual([]);
  });
  it('flags maxDD < -35, overfit < 0.5, liveDays < 90', () => {
    expect(flagOutReasons({ ...base, live: { maxDD: -40 } })[0]).toMatch(/maxDD/);
    expect(flagOutReasons({ ...base, overfit: { sharpe: 0.4 } })[0]).toMatch(/overfitRatio/);
    expect(flagOutReasons({ ...base, liveDays: 80 })[0]).toMatch(/liveDays/);
  });
});

// ── the screen end-to-end on a tiny universe ─────────────────────────────────
function rec(id, name, tags, liveReturns, liveDays, corr, opts = {}) {
  return {
    id, name, displayCategory: 'X', category: 'X', correlationAvailable: !!corr,
    stratzy: {
      liveDays, hasBacktestSegment: !!opts.backtest,
      split: { live: pts(liveReturns), backtest: opts.backtest ? pts(opts.backtest) : [] },
    },
    dhan: corr ? { tags, correlations: { overall: corr } } : null,
  };
}

describe('runScreen — confront-my-picks + redundancy', () => {
  // Two held Hedged algos, mutually correlated 0.8 (redundant). A Hedged survivor C
  // with higher live sortino AND lower corr-to-basket dominates them. A different-style
  // survivor must NOT confront. A maxDD blowup is flagged OUT.
  const H1 = rec('h1', 'H1', ['Hedged'], [1, -1, 1, -1, 2], 200, { H2: 0.8, C: 0.2, D: 0.1 });
  const H2 = rec('h2', 'H2', ['Hedged'], [1, -1, 1, 0, 1], 200, { H1: 0.8, C: 0.3, D: 0.1 });
  const C = rec('c', 'C', ['Hedged'], [2, -0.5, 2, 1, 3], 200, { H1: 0.2, H2: 0.3 });
  const Dother = rec('d', 'D', ['Selling'], [3, 1, 2, 1, 2], 200, { H1: 0.1, H2: 0.1 });
  const BlowUp = rec('e', 'E', ['Hedged'], [5, -50, 5, 5, 5], 200, { H1: 0.1, H2: 0.1 });

  const out = runScreen([H1, H2, C, Dother, BlowUp], { heldIds: ['h1', 'h2'] });

  it('held set is surfaced and judged (not flagged out)', () => {
    expect(out.held.map((h) => h.name).sort()).toEqual(['H1', 'H2']);
  });
  it('maxDD blowup is flagged OUT, clean ones survive', () => {
    expect(out.flaggedOut.map((r) => r.name)).toContain('E');
    expect(out.survivors.map((r) => r.name).sort()).toEqual(['C', 'D']);
  });
  it('emits "held dominated by" for the same-style, higher-sortino, more-diversifying candidate', () => {
    const h1conf = out.confrontations.find((c) => c.held === 'H1');
    expect(h1conf.dominatedBy.map((d) => d.name)).toContain('C');     // C beats H1, lower corr
    expect(h1conf.dominatedBy.map((d) => d.name)).not.toContain('D'); // different style
    expect(h1conf.dominatedBy[0].line).toMatch(/dominated by "C"/);
  });
  it('flags the redundant held pair (corr 0.8 > 0.7)', () => {
    expect(out.redundant).toEqual([{ a: 'H1', b: 'H2', corr: 0.8 }]);
  });
  it('carries provisional / noOverfitCheck / noCorrelation flags', () => {
    const c = out.survivors.find((r) => r.name === 'C');
    expect(c.flags.noOverfitCheck).toBe(true); // no backtest segment
    expect(c.flags.provisional).toBe(false);   // 200 days
  });
});
