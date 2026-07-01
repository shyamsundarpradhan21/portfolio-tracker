// Fixture-driven tests for the monthly review — no real prior month exists until Aug 2026,
// so every conclusion is proven on constructed forward series with known numbers.
import { describe, it, expect } from 'vitest';
import { reviewMonth, proposeTweaks, spearman, THIN_FORWARD_DAYS } from './algoReview.mjs';
import { buildRegimeCalendar } from '../../app/lib/regime.mjs';

const day = (d) => `${String(d).padStart(2, '0')}/06/2026`;
const series = (startDay, vals) => vals.map((v, i) => ({ date: day(startDay + i), v }));
const rec = (name, live, asOf = '2026-06-25T00:00:00Z') => ({ name, asOf, stratzy: { split: { live } } });

describe('spearman', () => {
  it('+1 perfect, −1 inverted, null when n<3', () => {
    expect(spearman([1, 2, 3, 4], [1, 2, 3, 4])).toBe(1);
    expect(spearman([1, 2, 3, 4], [4, 3, 2, 1])).toBe(-1);
    expect(spearman([1, 2], [1, 2])).toBeNull();
  });
});

describe('reviewMonth — forward stats, calibration, counterfactual', () => {
  const artifact = {
    asOf: '2026-06-01T12:00:00Z',
    candidates: [
      { algo: 'A', held: true, gateMaxDD: -30, persist2: 1 },
      { algo: 'B', held: false, gateMaxDD: -40, persist2: 2 },
      { algo: 'C', held: true, gateMaxDD: -25, persist2: 3 },  // held → EXITed (unfunded)
      { algo: 'D', held: false, gateMaxDD: -50, persist2: 4 },
      { algo: 'E', held: false, gateMaxDD: -20, persist2: 5 },
    ],
    book: { minLongVolShare: 0.2, picks: [{ algo: 'A', gateMaxDD: -30 }, { algo: 'B', gateMaxDD: -40 }] },
    labels: { keep: ['A'], exit: ['C'], add: ['B'] },
    params: { catastrophicFloor: -100 },
  };
  const fresh = [
    rec('A', [{ date: day(1), v: 999 }, ...series(2, Array(20).fill(1))]),        // pre-window 01/06 EXCLUDED; fwd +20
    rec('B', series(2, [1, -50, ...Array(18).fill(1)])),                          // fwd -31; deep in-window DD -50
    rec('C', series(2, Array(20).fill(0.25))),                                    // exited; fwd +5
    rec('D', series(2, Array(20).fill(-0.15))),                                   // unfunded; fwd -3
    rec('E', series(2, Array(20).fill(0.4))),                                     // unfunded; fwd +8
  ];
  const r = reviewMonth(artifact, fresh);

  it('forward return = SUM of in-window points; pre-window points excluded', () => {
    const A = r.picks.find((p) => p.algo === 'A');
    expect(A.forwardReturn).toBe(20);       // the v:999 on the decision day is NOT counted
    expect(A.daysObserved).toBe(20);
    expect(A.ddBreach).toBe(false);
  });
  it('realised in-window DD vs gate — flags a forward breach', () => {
    const B = r.picks.find((p) => p.algo === 'B');
    expect(B.forwardReturn).toBe(-31);
    expect(B.realisedMaxDD).toBe(-50);
    expect(B.ddBreach).toBe(true);          // -50 forward < -40 gate
  });
  it('calibration: hit rate, DD breaches, rank→forward Spearman', () => {
    expect(r.calibration.hitRate).toBe(0.5);      // A up, B down → 1/2
    expect(r.calibration.ddBreaches).toBe(1);
    expect(r.calibration.rankSpearman).toBe(0.1); // decision rank barely predicted forward order
  });
  it('counterfactual: funded vs EXITed vs top-unfunded value-add', () => {
    expect(r.counterfactual.fundedAvg).toBe(-5.5);
    expect(r.counterfactual.exitedAvg).toBe(5);
    expect(r.counterfactual.keepExitValueAdd).toBe(-10.5); // EXITed C beat the funded book
    expect(r.counterfactual.unfundedAvg).toBe(2.5);
    expect(r.counterfactual.addValueAdd).toBe(-8);
  });
  it('not low-confidence with a 20-day forward window', () => {
    expect(r.window.tradingDays).toBe(20);
    expect(r.lowConfidence).toBe(false);
  });
});

describe('reviewMonth — thin window guard', () => {
  it('< 15 forward trading days → LOW-CONFIDENCE', () => {
    const artifact = { asOf: '2026-06-01T00:00:00Z', candidates: [{ algo: 'A', held: false, gateMaxDD: -30 }],
      book: { minLongVolShare: 0.2, picks: [{ algo: 'A', gateMaxDD: -30 }] }, labels: { keep: [], exit: [], add: ['A'] } };
    const r = reviewMonth(artifact, [rec('A', series(2, Array(10).fill(1)))]); // 10 forward days
    expect(r.window.tradingDays).toBe(10);
    expect(r.lowConfidence).toBe(true);
    expect(proposeTweaks(r)[0]).toMatch(/LOW-CONFIDENCE/);
  });
});

describe('reviewMonth — stress-regime forward', () => {
  it('detects a pick that traded through a stressed regime and lost there', () => {
    const days = Array.from({ length: 12 }, (_, i) => ({ date: `2026-06-${String(i + 2).padStart(2, '0')}`, c: 100 + i }));
    const vix = days.map((d, i) => ({ date: d.date, vix: i >= 5 ? 30 : 13 })); // 07/06+ stressed (VIX 30 ≥ 22)
    const cal = buildRegimeCalendar(days, vix);
    const artifact = { asOf: '2026-06-01T00:00:00Z', candidates: [{ algo: 'S', held: false, gateMaxDD: -30, persist2: 1 }],
      book: { minLongVolShare: 0.2, picks: [{ algo: 'S', gateMaxDD: -30 }] }, labels: { keep: [], exit: [], add: ['S'] } };
    const live = [...series(2, [1, 1, 1, 1, 1]), ...series(7, [-2, -2, -2, -2, -2])]; // calm 02-06, stressed 07-11
    const r = reviewMonth(artifact, [rec('S', live)], { regimeCal: cal });
    const s = r.calibration.stressedForward.find((x) => x.algo === 'S');
    expect(s.stressDays).toBe(5);
    expect(s.stressReturn).toBe(-10);
    expect(proposeTweaks(r).join(' ')).toMatch(/STRESSED regime forward and lost/);
  });
});

describe('proposeTweaks — suggestions only', () => {
  it('quiet when calibration is in range', () => {
    const clean = { lowConfidence: false, window: { tradingDays: 20 }, params: { minLongVolShare: 0.2 },
      calibration: { hitRate: 0.8, ddBreaches: 0, rankSpearman: 0.6, stressedForward: [] },
      counterfactual: { keepExitValueAdd: 3, addValueAdd: 2 } };
    expect(proposeTweaks(clean)).toEqual(['No threshold changes suggested — calibration within normal range for this window.']);
  });
  it('flags anti-predictive rank + EXIT that cost return', () => {
    const bad = { lowConfidence: false, window: { tradingDays: 20 }, params: { minLongVolShare: 0.2 },
      calibration: { hitRate: 0.5, ddBreaches: 0, rankSpearman: -0.4, stressedForward: [] },
      counterfactual: { keepExitValueAdd: -6, addValueAdd: 1 } };
    const t = proposeTweaks(bad).join(' ');
    expect(t).toMatch(/anti-predictive/);
    expect(t).toMatch(/EXITed algos beat the funded book/);
  });
});
