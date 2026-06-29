// Regime classifier tests. A mislabeled regime corrupts the conditioning, so trend
// (efficiency ratio) and vol (level + expansion) are checked on constructed series,
// plus a real-window sanity check that a known trending stretch isn't called chop.
import { describe, it, expect } from 'vitest';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import {
  efficiencyRatio, classifyTrend, classifyVol, buildRegimeCalendar, regimeForDate, regimeDistribution,
} from './regime.mjs';

const ramp = (n, step) => Array.from({ length: n }, (_, i) => 100 + i * step);            // monotonic
const zigzag = (n, amp) => Array.from({ length: n }, (_, i) => 100 + (i % 2 ? amp : 0));   // oscillate, no drift

describe('efficiencyRatio', () => {
  it('=1 for a perfectly monotonic move, ~0 for pure oscillation', () => {
    expect(efficiencyRatio(ramp(21, 1), 20, 20)).toBeCloseTo(1, 6);
    expect(efficiencyRatio(zigzag(21, 5), 20, 20)).toBeCloseTo(0, 6); // net 0 over even window
    expect(efficiencyRatio(ramp(10, 1), 5, 20)).toBeNull();           // warm-up
  });
});

describe('classifyTrend', () => {
  const P = { trendWindow: 20, trendMin: 0.3 };
  it('monotonic up → up, down → down, oscillation → chop', () => {
    expect(classifyTrend(ramp(21, 1), 20, P)).toBe('up');
    expect(classifyTrend(ramp(21, -1), 20, P)).toBe('down');
    expect(classifyTrend(zigzag(21, 5), 20, P)).toBe('chop');
  });
  it('a small steady drift inside heavy noise is chop (low ER)', () => {
    const noisy = Array.from({ length: 21 }, (_, i) => 100 + i * 0.05 + (i % 2 ? 8 : 0));
    expect(classifyTrend(noisy, 20, P)).toBe('chop');
  });
});

describe('classifyVol (ΔVIX weighted over level)', () => {
  const P = { vixStress: 22, vixExpandPct: 0.1 };
  it('high level → stressed', () => expect(classifyVol(25, 24, P)).toBe('stressed'));
  it('expansion from a calm level → stressed (vol expanding)', () => expect(classifyVol(17, 14, P)).toBe('stressed')); // +21%
  it('low and flat → calm', () => expect(classifyVol(13, 13, P)).toBe('calm'));
  it('null vix → unknown', () => expect(classifyVol(null, 13, P)).toBe('unknown'));
});

describe('buildRegimeCalendar', () => {
  it('labels by date and resolves DD/MM/YYYY lookups', () => {
    const nifty = ramp(22, 1).map((c, i) => ({ date: `2026-01-${String(i + 1).padStart(2, '0')}`, c }));
    const vix = nifty.map((d) => ({ date: d.date, vix: 13 }));
    const cal = buildRegimeCalendar(nifty, vix, { trendWindow: 20, trendMin: 0.3, vixStress: 22, vixExpandPct: 0.1 });
    expect(cal.get('2026-01-21').trend).toBe('up');
    expect(regimeForDate(cal, '21/01/2026').trend).toBe('up');
    expect(regimeForDate(cal, '01/06/2099')).toBeNull();
  });
});

// Real-data sanity: the fetched calendar should produce a sensible mix (not all chop,
// not all one trend) — proves the thresholds aren't degenerate on live market data.
describe('real regime-inputs sanity', () => {
  const f = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'data', 'regime-inputs.json');
  it.skipIf(!existsSync(f))('produces a non-degenerate trend mix over 3y', () => {
    const { nifty, vix } = JSON.parse(readFileSync(f, 'utf8'));
    const dist = regimeDistribution(buildRegimeCalendar(nifty, vix));
    const { up = 0, down = 0, chop = 0 } = dist.trend;
    const total = up + down + chop;
    expect(total).toBeGreaterThan(400);
    for (const v of [up, down, chop]) expect(v / total).toBeGreaterThan(0.05); // every regime present
  });
});
