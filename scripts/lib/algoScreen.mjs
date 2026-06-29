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

const DAY = 86400000;
const MIN_POINTS = 5; // below this a segment is too thin to characterise

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

// ── the screen: eliminate, don't score ───────────────────────────────────────
export const DEFAULT_PARAMS = { maxDDFloor: -35, overfitMin: 0.5, minLiveDays: 90, redundantCorr: 0.7 };

// Reasons an algo is flagged OUT of "consider". Empty array = survivor.
export function flagOutReasons(row, p = DEFAULT_PARAMS) {
  const out = [];
  if (row.live?.maxDD != null && row.live.maxDD < p.maxDDFloor) out.push(`maxDD ${row.live.maxDD} < ${p.maxDDFloor}`);
  if (row.overfit?.sharpe != null && row.overfit.sharpe < p.overfitMin) out.push(`overfitRatio ${row.overfit.sharpe} < ${p.overfitMin}`);
  if (row.liveDays != null && row.liveDays < p.minLiveDays) out.push(`liveDays ${row.liveDays} < ${p.minLiveDays}`);
  if (!row.live) out.push('no live series');
  return out;
}

// Full screen over the universe. Descriptive: returns held rows, survivors,
// flagged-out, and confront-my-picks lines. NOT a single ranking.
export function runScreen(records, { heldIds = [], params = DEFAULT_PARAMS } = {}) {
  const p = { ...DEFAULT_PARAMS, ...params };
  const heldSet = new Set(heldIds);
  const heldNames = records.filter((r) => heldSet.has(r.id)).map((r) => r.name);

  const rows = records.map((r) => ({ ...screenAlgo(r, heldNames), held: heldSet.has(r.id) }));
  const byId = new Map(rows.map((r) => [r.id, r]));

  for (const row of rows) row.outReasons = flagOutReasons(row, p);
  const held = rows.filter((r) => r.held);
  const survivors = rows.filter((r) => !r.held && r.outReasons.length === 0);
  const flaggedOut = rows.filter((r) => !r.held && r.outReasons.length > 0);

  // sort survivors for PRESENTATION only (live sortino desc, then diversification).
  survivors.sort((a, b) => (b.live?.sortino ?? -Infinity) - (a.live?.sortino ?? -Infinity));

  // confront-my-picks: per held algo, same-style survivors that beat it on live
  // sortino AND are more diversifying (lower corr-to-basket than the incumbent).
  const confrontations = [];
  for (const h of held) {
    if (!h.live) continue;
    const incumbentCorr = h.corr.avg; // held's own corr to the rest of the basket
    const challengers = survivors
      .filter((c) => c.style === h.style && c.live?.sortino != null && h.live.sortino != null && c.live.sortino > h.live.sortino)
      .filter((c) => incumbentCorr == null || c.corr.avg == null || c.corr.avg < incumbentCorr)
      .sort((a, b) => (b.live.sortino - a.live.sortino));
    confrontations.push({
      held: h.name, heldSortino: h.live.sortino, heldCorrToBasket: incumbentCorr,
      dominatedBy: challengers.slice(0, 3).map((c) => ({
        name: c.name, sortino: c.live.sortino, corrToBasket: c.corr.avg, liveDays: c.liveDays, confidence: c.confidence,
        line: `held "${h.name}" (sortino ${h.live.sortino}) dominated by "${c.name}" (sortino ${c.live.sortino}` +
          (c.corr.avg != null && incumbentCorr != null ? `, corr-to-basket ${c.corr.avg} vs ${incumbentCorr}` : '') + ')',
      })),
    });
  }

  // redundancy: held pairs whose mutual correlation exceeds the threshold.
  const redundant = [];
  for (let i = 0; i < held.length; i++) for (let j = i + 1; j < held.length; j++) {
    const a = records.find((r) => r.id === held[i].id), b = held[j];
    const c = a?.dhan?.correlations?.overall?.[b.name];
    if (c != null && c > p.redundantCorr) redundant.push({ a: held[i].name, b: held[j].name, corr: round(c) });
  }

  return { params: p, heldNames, held, survivors, flaggedOut, confrontations, redundant };
}
