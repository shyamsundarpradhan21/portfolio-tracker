// Unbiased algo SCREEN — descriptive filter + confront, NOT a ranking or allocator.
// Pure functions over the assembled stratzy-daily records. Figures come from here
// (the data-Review computes this in the background); the LLM never produces them.
//
// THE DATA: each algo's `performance` is a per-trade-day RETURN (%) series, split at
// liveSince into stratzy.split.live / .backtest (arrays of {date, v}). v IS the day's
// return — NOT a cumulative curve. CAGR ≈ sum(v) annualized additively, which matches
// Stratzy's own headline cagr (validated: Damper 166.6 vs 166.4). The reported
// backtest* fields read 0 on fully-live algos, so we compute backtest stats from the
// series, never from those fields.

import { regimeForDate } from './regime.mjs';

const DAY = 86400000;
const MIN_POINTS = 5;  // below this a segment is too thin to characterise
const THIN_DAYS = 25;  // a regime bucket below this is "untested" (flagged, not hidden)

// ── stat primitives (pure) ───────────────────────────────────────────────────
export const mean = (xs) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
export function std(xs) { // sample (n-1)
  if (xs.length < 2) return null;
  const m = mean(xs);
  return Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1));
}
export function downsideDeviation(xs, target = 0) { // sqrt(mean of squared shortfalls)
  if (!xs.length) return null;
  const d = xs.map((x) => Math.min(0, x - target) ** 2);
  return Math.sqrt(d.reduce((s, x) => s + x, 0) / xs.length);
}
export function skewness(xs) { // population third standardised moment
  if (xs.length < 3) return null;
  const m = mean(xs);
  const s = Math.sqrt(xs.reduce((a, x) => a + (x - m) ** 2, 0) / xs.length);
  if (!s) return 0;
  return xs.reduce((a, x) => a + ((x - m) / s) ** 3, 0) / xs.length;
}
// Max drawdown (most negative peak-to-trough) of the ADDITIVE cumulative curve of
// per-day returns. Returned as a negative number in return-points (0 if never down).
export function maxDrawdown(returns) {
  let cum = 0, peak = 0, mdd = 0;
  for (const r of returns) { cum += r; if (cum > peak) peak = cum; mdd = Math.min(mdd, cum - peak); }
  return mdd;
}

function spanDaysOf(points) {
  if (points.length < 2) return 0;
  const ms = (d) => { const [dd, mm, yy] = d.split('/'); return Date.UTC(+yy, +mm - 1, +dd); };
  return (ms(points[points.length - 1].date) - ms(points[0].date)) / DAY;
}

// ── per-segment metrics ───────────────────────────────────────────────────────
// points = [{date:'DD/MM/YYYY', v:number}] of per-trade-day returns (%). null if thin.
export function segmentMetrics(points) {
  if (!Array.isArray(points) || points.length < MIN_POINTS) return null;
  const v = points.map((p) => p.v).filter((x) => Number.isFinite(x));
  if (v.length < MIN_POINTS) return null;
  const span = spanDaysOf(points) || v.length; // guard zero span
  const perYear = (v.length * 365.25) / span;   // observation frequency
  const m = mean(v), sd = std(v), dd = downsideDeviation(v);
  return {
    n: v.length,
    spanDays: Math.round(span),
    cagr: round(v.reduce((s, x) => s + x, 0) * (365.25 / span)), // additive annualisation (matches Stratzy)
    sharpe: sd ? round((m / sd) * Math.sqrt(perYear)) : null,
    sortino: dd ? round((m / dd) * Math.sqrt(perYear)) : null,
    maxDD: round(maxDrawdown(v)),
    worstDay: round(Math.min(...v)),
    skew: round(skewness(v)),
  };
}
const round = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);

// overfitRatio: how much live decayed vs backtest. null when no backtest segment, or
// when backtest sharpe/cagr non-positive (overfit undefined — backtest itself failed).
export function overfitRatio(live, bt) {
  if (!bt) return null;
  return {
    sharpe: bt.sharpe > 0 && live.sharpe != null ? round(live.sharpe / bt.sharpe) : null,
    cagr: bt.cagr > 0 && live.cagr != null ? round(live.cagr / bt.cagr) : null,
  };
}

export function confidenceTier(liveDays) {
  if (liveDays == null) return 'unknown';
  if (liveDays < 90) return 'provisional';
  if (liveDays <= 180) return 'moderate';
  return 'ok';
}

// Signed correlation of `record` to a held basket (by name; overall matrix is name→coef).
// avg = mean corr to basket (low = diversifying); max = most-positive corr (high = redundant).
export function correlationToHeld(record, heldNames) {
  const m = record?.dhan?.correlations?.overall;
  if (!record?.correlationAvailable || !m) return { noCorrelation: true, avg: null, max: null, covered: 0 };
  const vals = heldNames.filter((n) => n !== record.name && n in m).map((n) => m[n]);
  if (!vals.length) return { noCorrelation: false, avg: null, max: null, covered: 0 };
  return { noCorrelation: false, avg: round(mean(vals)), max: round(Math.max(...vals)), covered: vals.length };
}

// Primary trading style of a record (for same-style confrontation).
export function styleOf(record) {
  const t = record?.dhan?.tags || [];
  if (t.includes('Hedged')) return 'Hedged Options';
  if (t.includes('Buying')) return 'Naked Option Buying';
  if (t.includes('Selling')) return 'Option Selling';
  if (t.includes('Non-directional')) return 'Non-Directional';
  if (t.includes('Directional')) return 'Directional';
  return record?.displayCategory || record?.category || 'Unknown';
}

// ── per-algo screen row ───────────────────────────────────────────────────────
export function screenAlgo(record, heldNames) {
  const live = segmentMetrics(record.stratzy.split.live);
  const bt = record.stratzy.hasBacktestSegment ? segmentMetrics(record.stratzy.split.backtest) : null;
  const liveDays = record.stratzy.liveDays;
  const corr = correlationToHeld(record, heldNames);
  return {
    id: record.id, name: record.name, style: styleOf(record),
    liveDays, confidence: confidenceTier(liveDays),
    live, backtest: bt, overfit: live ? overfitRatio(live, bt) : null, corr,
    flags: {
      provisional: liveDays != null && liveDays < 90,
      noOverfitCheck: !record.stratzy.hasBacktestSegment,
      noCorrelation: corr.noCorrelation,
    },
  };
}

// ── (1) regime conditioning — bucket LIVE returns by the day's regime ─────────
const median = (xs) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); const i = (s.length - 1) / 2; return s.length % 2 ? s[i] : (s[i - 0.5] + s[i + 0.5]) / 2; };
function livePeriodsPerYear(record) {
  const pts = record.stratzy.split.live;
  if (pts.length < 2) return null;
  const span = spanDaysOf(pts) || pts.length;
  return (pts.length * 365.25) / span;
}
// Per-regime metrics for an algo's LIVE returns. Thin buckets (<25 days) are FLAGGED,
// not hidden — an empty/thin trend bucket IS the finding.
export function regimeBuckets(record, cal) {
  const ppy = livePeriodsPerYear(record);
  const b = { up: [], down: [], chop: [], stressed: [] };
  let matched = 0, unmatched = 0;
  for (const pt of record.stratzy.split.live) {
    const r = regimeForDate(cal, pt.date);
    if (!r) { unmatched++; continue; }
    matched++;
    if (r.trend && b[r.trend]) b[r.trend].push(pt.v);
    if (r.vol === 'stressed') b.stressed.push(pt.v);
  }
  const M = (vs) => {
    const dayCount = vs.length;
    if (dayCount < MIN_POINTS) return { dayCount, thin: true, sortino: null, cagr: null, maxDD: null };
    const m = mean(vs), dd = downsideDeviation(vs);
    return { dayCount, thin: dayCount < THIN_DAYS, sortino: dd ? round((m / dd) * Math.sqrt(ppy)) : null, cagr: ppy ? round(m * ppy) : null, maxDD: round(maxDrawdown(vs)) };
  };
  return { matched, unmatched, up: M(b.up), down: M(b.down), chop: M(b.chop), stressed: M(b.stressed) };
}

// ── (4) risk STRUCTURE from style/category — defined vs undefined risk ────────
export function riskStructure(record) {
  const tags = record?.dhan?.tags || [];
  const cat = record?.displayCategory || record?.category || '';
  const name = record?.name || '';
  if (tags.includes('Hedged') || cat === 'Credit Spread' || /credit spread|iron condor|butterfly/i.test(name)) return 'defined';
  if (tags.includes('Buying') || tags.includes('Selling') ||
    ['Option Buying', 'Short Strangle', 'Short Straddle', 'Options', 'Stock Options'].includes(cat) ||
    /straddle|strangle/i.test(name)) return 'undefined';
  if (['Investing', 'Swing', 'Intraday Cash', 'Intraday'].includes(cat)) return 'equity';
  return 'other';
}

// ── (2) capital-tiered thresholds — looser DD + more structures as capital grows ─
// Defined-risk (spreads) tolerate less DD than naked; tolerance widens with capital.
// Today's deployed capital (~₹2.3L) → conservative/defined-risk tier. Tunable.
export const CAPITAL_TIERS = [
  { name: 'conservative', upTo: 500000, admit: ['defined'], dd: { defined: -25, undefined: -45, equity: -20, other: -30 } },
  { name: 'balanced', upTo: 1500000, admit: ['defined', 'undefined'], dd: { defined: -35, undefined: -60, equity: -25, other: -40 } },
  { name: 'aggressive', upTo: Infinity, admit: ['defined', 'undefined', 'equity', 'other'], dd: { defined: -45, undefined: -75, equity: -35, other: -55 } },
];
export const tierFor = (capital) => CAPITAL_TIERS.find((t) => (capital ?? Infinity) <= t.upTo) || CAPITAL_TIERS.at(-1);
// Lowest tier that would admit this row (structure admitted AND DD within tolerance).
function revisitTierFor(row) {
  for (const t of CAPITAL_TIERS) {
    if (!t.admit.includes(row.structure)) continue;
    const tol = t.dd[row.structure];
    if (row.live?.maxDD == null || tol == null || row.live.maxDD >= tol) return t.name;
  }
  return null; // too deep even for the top tier
}

// ── (3) split elimination: genuinely OUT vs PARKED (capital/drawdown watchlist) ─
export const DEFAULT_PARAMS = { overfitMin: 0.5, minLiveDays: 90, redundantCorr: 0.7, structureOutlierMAD: 2 };

// OUT = overfit / no-live / thin (genuine kills). PARK = structure-not-admitted or
// drawdown-below-tier (re-screened higher-octane algos for when capital scales).
export function classifyElimination(row, tier, p = DEFAULT_PARAMS) {
  const out = [], park = [];
  if (!row.live) out.push('no live series');
  if (row.overfit?.sharpe != null && row.overfit.sharpe < p.overfitMin) out.push(`overfitRatio ${row.overfit.sharpe} < ${p.overfitMin}`);
  if (row.liveDays != null && row.liveDays < p.minLiveDays) out.push(`liveDays ${row.liveDays} < ${p.minLiveDays} (thin)`);
  if (!tier.admit.includes(row.structure)) park.push(`structure '${row.structure}' not admitted at ${tier.name} tier`);
  const tol = tier.dd[row.structure];
  if (row.live?.maxDD != null && tol != null && row.live.maxDD < tol) park.push(`live maxDD ${row.live.maxDD} below ${tier.name} ${row.structure} tolerance ${tol}`);
  return { out, park };
}

// Full screen. Descriptive: held + survivors + OUT + PARKED + confront + redundancy.
// Optional regimeCal enables per-regime buckets; capital selects the tier.
export function runScreen(records, { heldIds = [], params = DEFAULT_PARAMS, regimeCal = null, capital = null } = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const tier = tierFor(capital);
  const heldSet = new Set(heldIds);
  const heldNames = records.filter((r) => heldSet.has(r.id)).map((r) => r.name);

  const rows = records.map((r) => {
    const row = { ...screenAlgo(r, heldNames), held: heldSet.has(r.id), structure: riskStructure(r) };
    row.regime = regimeCal ? regimeBuckets(r, regimeCal) : null;
    return row;
  });

  // (4) structure-relative DD: flag within-structure OUTLIERS (a spread drawing down
  // like a naked) instead of one flat floor. median ± k·MAD over same-structure peers.
  const structureDD = {};
  for (const st of ['defined', 'undefined', 'equity', 'other']) {
    const dds = rows.filter((r) => r.structure === st && r.live?.maxDD != null).map((r) => r.live.maxDD);
    const med = median(dds);
    structureDD[st] = dds.length ? { median: round(med), mad: round(median(dds.map((x) => Math.abs(x - med)))), n: dds.length } : null;
  }
  for (const row of rows) {
    const s = structureDD[row.structure];
    row.structureOutlier = !!(s && s.mad > 0 && row.live?.maxDD != null && row.live.maxDD < s.median - p.structureOutlierMAD * s.mad);
  }

  // classify into held / survivors / out / parked
  for (const row of rows) {
    const { out, park } = classifyElimination(row, tier, p);
    row.outReasons = out; row.parkReasons = park;
    row.revisitTier = !out.length && park.length ? revisitTierFor(row) : null;
  }
  const held = rows.filter((r) => r.held);
  const nonHeld = rows.filter((r) => !r.held);
  const outAlgos = nonHeld.filter((r) => r.outReasons.length > 0);
  const parked = nonHeld.filter((r) => r.outReasons.length === 0 && r.parkReasons.length > 0);
  const survivors = nonHeld.filter((r) => r.outReasons.length === 0 && r.parkReasons.length === 0);
  survivors.sort((a, b) => (b.live?.sortino ?? -Infinity) - (a.live?.sortino ?? -Infinity));

  // confront-my-picks: same-style survivors beating a held algo on live sortino AND
  // more diversifying (lower corr-to-basket than the incumbent).
  const confrontations = [];
  for (const h of held) {
    if (!h.live) continue;
    const incumbentCorr = h.corr.avg;
    const challengers = survivors
      .filter((c) => c.style === h.style && c.live?.sortino != null && c.live.sortino > h.live.sortino)
      .filter((c) => incumbentCorr == null || c.corr.avg == null || c.corr.avg < incumbentCorr)
      .sort((a, b) => b.live.sortino - a.live.sortino);
    confrontations.push({
      held: h.name, heldSortino: h.live.sortino, heldCorrToBasket: incumbentCorr, heldStructureOutlier: h.structureOutlier,
      dominatedBy: challengers.slice(0, 3).map((c) => ({
        name: c.name, sortino: c.live.sortino, corrToBasket: c.corr.avg, liveDays: c.liveDays, confidence: c.confidence,
        line: `held "${h.name}" (sortino ${h.live.sortino}) dominated by "${c.name}" (sortino ${c.live.sortino}` +
          (c.corr.avg != null && incumbentCorr != null ? `, corr-to-basket ${c.corr.avg} vs ${incumbentCorr}` : '') + ')',
      })),
    });
  }

  const redundant = [];
  for (let i = 0; i < held.length; i++) for (let j = i + 1; j < held.length; j++) {
    const a = records.find((r) => r.id === held[i].id);
    const c = a?.dhan?.correlations?.overall?.[held[j].name];
    if (c != null && c > p.redundantCorr) redundant.push({ a: held[i].name, b: held[j].name, corr: round(c) });
  }

  return { params: p, tier, capital, heldNames, structureDD, held, survivors, out: outAlgos, parked, flaggedOut: [...outAlgos, ...parked], confrontations, redundant };
}
