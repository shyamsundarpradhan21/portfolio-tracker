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

import { regimeForDate } from '../../app/lib/regime.mjs';

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
    tradesPerYear: Math.round(perYear), // observation frequency — exposes the √ppy annualisation baked
    // into sharpe/sortino, so a high-frequency algo's higher ratio is read with eyes open (council #2).
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

// ── persistence rank (the frozen ranking signal, locked 2026-07-02) ───────────
// Rank the FULL universe on each horizon PnL (desc, rank 1 = best), then per algo take
// the 2nd-WORST of its horizon ranks — robust to one outlier horizon, so a single hot or
// cold month can't dominate (the fix for the Fixed-RR / Zik-Zak brittleness). Records need
// `stratzy.horizons {oneMonth,threeMonth,sixMonth,oneYear}`. Returns Map(id → persist2);
// null when an algo has no horizon data (the caller sorts nulls last).
export const PERSIST_HORIZONS = ['oneMonth', 'threeMonth', 'sixMonth', 'oneYear'];

// 2nd-largest (2nd-worst) finite value; the only value if one; null if none.
export function secondWorst(ranks) {
  const xs = (ranks || []).filter((x) => Number.isFinite(x));
  if (!xs.length) return null;
  if (xs.length === 1) return xs[0];
  const sorted = [...xs].sort((a, b) => a - b);
  return sorted[sorted.length - 2];
}

export function persistenceRanks(records) {
  const byHorizon = {};
  for (const h of PERSIST_HORIZONS) {
    const ranked = records
      .filter((r) => Number.isFinite(r?.stratzy?.horizons?.[h]))
      .sort((a, b) => b.stratzy.horizons[h] - a.stratzy.horizons[h]);
    const m = new Map();
    ranked.forEach((r, i) => m.set(r.id, i + 1)); // rank 1 = best
    byHorizon[h] = m;
  }
  const out = new Map();
  for (const r of records) {
    const ranks = PERSIST_HORIZONS.map((h) => byHorizon[h].get(r.id)).filter((x) => x != null);
    out.set(r.id, secondWorst(ranks));
  }
  return out;
}

// ── conviction candidate pool (the monthly engine's input to allocateConviction) ─
// held + survivors + PARKED (DD-park IGNORED in conviction mode); screen OUTs (quality
// kills) are excluded by construction. Structure ∈ tier.admit; catastrophic floor
// gateMaxDD ≤ CATASTROPHIC_DD excluded (wiped-out algos). Sizing from Stratzy
// minimumCapital/maximumCapital (NOT the Dhan-joined min/max). Ranked by 2nd-worst
// persistence asc (nulls last) → live Sortino desc. Pure; unit-tests on a runScreen result.
export const CATASTROPHIC_DD = -100;
export function convictionCandidates(screen, records, heldIds, { catastrophicDD = CATASTROPHIC_DD, persist } = {}) {
  const heldSet = new Set(heldIds);
  const recById = new Map(records.map((a) => [a.id, a]));
  const pmap = persist || persistenceRanks(records);
  const pool = [...screen.held, ...screen.survivors, ...screen.parked]
    .filter((r) => screen.tier.admit.includes(r.structure))
    .filter((r) => r.gateMaxDD == null || r.gateMaxDD > catastrophicDD);
  const cands = pool.map((r) => {
    const rec = recById.get(r.id);
    return {
      algo: r.name, volSide: r.volSide, structure: r.structure,
      gateMaxDD: r.gateMaxDD, liveMaxDD: r.live?.maxDD ?? null,
      sortino: r.live?.sortino ?? null, cagr: r.live?.cagr ?? null,
      worstDay: r.live?.worstDay ?? null, skew: r.live?.skew ?? null,
      liveDays: r.liveDays, confidence: r.confidence,
      downTested: r.downTested, downSortino: r.downSortino,
      held: heldSet.has(r.id), persist2: pmap.get(r.id) ?? null,
      min: rec?.stratzy?.minimumCapital ?? null, max: rec?.stratzy?.maximumCapital ?? null,
    };
  });
  cands.sort((a, b) => {
    const pa = a.persist2 == null ? Infinity : a.persist2;
    const pb = b.persist2 == null ? Infinity : b.persist2;
    return pa - pb || (b.sortino ?? -Infinity) - (a.sortino ?? -Infinity);
  });
  return cands;
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
  // A young algo's live-only metrics extrapolate a short window: CAGR/Sortino annualise a
  // few hot months (overstated) and its live maxDD hasn't seen a full cycle (understated).
  // shortLive flags it; and when a backtest segment exists we GATE drawdown on the DEEPER of
  // the live and the full (backtest+live) curve, so an as-yet-unlived crash isn't hidden.
  const shortLive = liveDays != null && liveDays <= 180;
  let gateMaxDD = live ? live.maxDD : null;
  if (live && shortLive && record.stratzy.hasBacktestSegment) {
    const full = [...(record.stratzy.split.backtest || []), ...(record.stratzy.split.live || [])].map((p) => p.v);
    gateMaxDD = Math.min(live.maxDD, round(maxDrawdown(full)));
  }
  return {
    id: record.id, name: record.name, style: styleOf(record),
    liveDays, confidence: confidenceTier(liveDays),
    live, backtest: bt, overfit: live ? overfitRatio(live, bt) : null, corr, gateMaxDD,
    flags: {
      provisional: liveDays != null && liveDays < 90,
      shortLive,
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

// Volatility side — the regime-risk axis the /council flagged: short-vol strategies
// (credit spreads, option selling, strangles/straddles) all lose together in a vol
// spike, so their CALM-regime low correlations understate crash risk. long = premium
// BUYING (long vol/gamma); short = premium selling / defined credit spreads; else neutral.
export function volSideOf(row) {
  const style = row.style || '';
  const name = row.name || '';
  if (/buying/i.test(style)) return 'long';
  if (row.structure === 'defined' || /selling/i.test(style) || /strangle|straddle/i.test(name)) return 'short';
  return 'neutral';
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
// RETAIL-calibrated (not institutional): full F&O admission (defined hedged + undefined
// naked buying/selling) opens at the BALANCED band from ~₹5–6L up to ₹10L — it is NOT
// gated behind ₹15L. Defined-risk (spreads) tolerate less DD than naked; tolerance widens
// with capital. Tunable. (See tasks/feedback.md "retail-calibrated algo tiers".)
export const CAPITAL_TIERS = [
  { name: 'conservative', upTo: 500000, admit: ['defined'], dd: { defined: -35, undefined: -60, equity: -25, other: -35 } },
  { name: 'balanced', upTo: 1000000, admit: ['defined', 'undefined'], dd: { defined: -45, undefined: -75, equity: -30, other: -45 } },
  { name: 'aggressive', upTo: Infinity, admit: ['defined', 'undefined', 'equity', 'other'], dd: { defined: -48, undefined: -80, equity: -35, other: -55 } },
];
export const tierFor = (capital) => CAPITAL_TIERS.find((t) => (capital ?? Infinity) <= t.upTo) || CAPITAL_TIERS.at(-1);
// Lowest tier that would admit this row (structure admitted AND DD within tolerance).
function revisitTierFor(row) {
  const dd = row.gateMaxDD ?? row.live?.maxDD;
  for (const t of CAPITAL_TIERS) {
    if (!t.admit.includes(row.structure)) continue;
    const tol = t.dd[row.structure];
    if (dd == null || tol == null || dd >= tol) return t.name;
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
  const dd = row.gateMaxDD ?? row.live?.maxDD; // full-curve DD for young algos (see screenAlgo)
  if (dd != null && tol != null && dd < tol) park.push(`maxDD ${dd} below ${tier.name} ${row.structure} tolerance ${tol}`);
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
    row.volSide = volSideOf(row);
    // stress-tested = ≥THIN_DAYS live days inside a stressed (high-VIX) regime — i.e. actually
    // traded through a vol spike. NOTE: the 2023–26 sample is a low-vol era (~5% stressed days),
    // so this is near-uniformly FALSE and non-discriminating right now — the book-level caveat is
    // the useful output, and the allocator (Phase 2) defends via the short-vol cap + DOWN-regime
    // health below, which has real sample (down-trend days are common). Kept for when vol returns.
    row.stressTested = !!(row.regime && row.regime.stressed && row.regime.stressed.dayCount >= THIN_DAYS);
    row.downTested = !!(row.regime && row.regime.down && row.regime.down.dayCount >= THIN_DAYS);
    row.downSortino = row.regime?.down?.sortino ?? null; // risk-adjusted return in down-trend days
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
  // Established (≥180 live days, confidence 'ok') rank ABOVE short-live algos, THEN by live
  // sortino — a young algo's annualised sortino extrapolates a hot window and must not top
  // the list (fixes the Sookshma-Nazar 112-day "#1" artifact). See screenAlgo shortLive.
  const estFirst = (r) => (r.confidence === 'ok' ? 0 : 1);
  survivors.sort((a, b) => estFirst(a) - estFirst(b) || (b.live?.sortino ?? -Infinity) - (a.live?.sortino ?? -Infinity));

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

// ── structured payload for KV (algo-screen:v1) — the Review component READS this ──
// Pure serialization of a runScreen() result into the render-ready shape. Figures are
// already computed (never the LLM); this only reshapes. asOf is the data vintage.
export function buildScreenPayload(s, { asOf = null } = {}) {
  const liveOf = (r) => r.live
    ? { sortino: r.live.sortino, cagr: r.live.cagr, maxDD: r.live.maxDD, gateMaxDD: r.gateMaxDD ?? r.live.maxDD, sharpe: r.live.sharpe, worstDay: r.live.worstDay, skew: r.live.skew, n: r.live.n, tradesPerYear: r.live.tradesPerYear }
    : null;
  const flagsList = (f) => ['provisional', 'shortLive', 'noOverfitCheck', 'noCorrelation'].filter((k) => f[k]);
  // per-regime rows: tested ∈ empty (the finding) | thin (<25d, untested) | ok
  const regimeRows = (rg) => rg ? ['up', 'down', 'chop', 'stressed'].map((k) => {
    const b = rg[k];
    return { regime: k, days: b.dayCount, sortino: b.sortino, cagr: b.cagr, maxDD: b.maxDD, tested: b.dayCount === 0 ? 'empty' : (b.thin ? 'thin' : 'ok') };
  }) : [];
  const caveatOf = (rg) => regimeRows(rg).filter((x) => x.tested !== 'ok').map((x) => `${x.regime} ${x.tested.toUpperCase()}`).join(', ') || null;

  const held = s.held.map((r) => ({
    algo: r.name, style: r.style, structure: r.structure, volSide: r.volSide, stressTested: r.stressTested, downTested: r.downTested, downSortino: r.downSortino,
    liveDays: r.liveDays, confidence: r.confidence,
    liveMetrics: liveOf(r),
    regimeBreakdown: regimeRows(r.regime),
    regimeMatched: r.regime ? { matched: r.regime.matched, unmatched: r.regime.unmatched } : null,
    flags: flagsList(r.flags), structureOutlier: r.structureOutlier,
    parkReason: r.parkReasons?.length ? r.parkReasons : null, revisitTier: r.revisitTier,
  }));

  // confront — dominatedBy (strict: higher sortino AND more diversifying) WITH the
  // challenger's regime caveat, so a "better" number can't mislead without its samples.
  const survByName = new Map(s.survivors.map((r) => [r.name, r]));
  const dominatedBy = [];
  for (const c of s.confrontations) for (const d of c.dominatedBy) {
    const ch = survByName.get(d.name);
    dominatedBy.push({
      held: c.held, heldSortino: c.heldSortino, heldCorrToBasket: c.heldCorrToBasket,
      challenger: d.name, sortino: d.sortino, corrToBasket: d.corrToBasket,
      liveDays: d.liveDays, confidence: d.confidence,
      regimeCaveat: ch ? caveatOf(ch.regime) : null, line: d.line,
    });
  }
  // supplementary — same-style survivors with higher live sortino but NOT a strict
  // dominator (shown so the comparison isn't hidden; not "dominators").
  const supplementary = [];
  for (const h of s.held) {
    if (!h.live) continue;
    const dom = new Set((s.confrontations.find((c) => c.held === h.name)?.dominatedBy || []).map((d) => d.name));
    for (const r of s.survivors.filter((x) => x.style === h.style && x.live?.sortino != null && x.live.sortino > h.live.sortino && !dom.has(x.name))) {
      supplementary.push({
        held: h.name, heldSortino: h.live.sortino, challenger: r.name, sortino: r.live.sortino,
        corrToBasket: r.corr.avg, heldCorrToBasket: h.corr.avg,
        moreDiversifying: r.corr.avg != null && h.corr.avg != null ? r.corr.avg < h.corr.avg : null,
        liveDays: r.liveDays, confidence: r.confidence, regimeCaveat: caveatOf(r.regime),
      });
    }
  }

  const survivorsByStyle = {};
  for (const r of s.survivors) (survivorsByStyle[r.style] ||= []).push({
    algo: r.name, liveDays: r.liveDays, confidence: r.confidence, liveMetrics: liveOf(r),
    corrToBasket: r.corr.avg, structure: r.structure, volSide: r.volSide, stressTested: r.stressTested, downTested: r.downTested, downSortino: r.downSortino,
    structureOutlier: r.structureOutlier, flags: flagsList(r.flags),
  });
  const est = (x) => (x.confidence === 'ok' ? 0 : 1); // established-first, matching runScreen
  for (const k of Object.keys(survivorsByStyle)) survivorsByStyle[k].sort((a, b) => est(a) - est(b) || (b.liveMetrics?.sortino ?? -Infinity) - (a.liveMetrics?.sortino ?? -Infinity));

  const parked = s.parked.map((r) => ({
    algo: r.name, style: r.style, structure: r.structure, volSide: r.volSide, stressTested: r.stressTested, downTested: r.downTested, downSortino: r.downSortino,
    liveDays: r.liveDays, confidence: r.confidence,
    liveMetrics: liveOf(r), parkReason: r.parkReasons, revisitTier: r.revisitTier,
    structureOutlier: r.structureOutlier, flags: flagsList(r.flags),
  }));

  // Book-level regime-risk caveat (council #1): what share of surviving candidates is short-vol,
  // and how many are UNTESTED in a stress regime — the low mutual correlation is calm-regime only.
  const survForRisk = s.survivors;
  const shortVolN = survForRisk.filter((r) => r.volSide === 'short').length;
  const stressUntestedN = survForRisk.filter((r) => !r.stressTested).length;
  const shortVolShare = survForRisk.length ? Math.round((shortVolN / survForRisk.length) * 100) : 0;
  const regimeRisk = {
    survivors: survForRisk.length, shortVol: shortVolN, shortVolShare,
    stressUntested: stressUntestedN, longVol: survForRisk.filter((r) => r.volSide === 'long').length,
    caveat: survForRisk.length
      ? `${shortVolShare}% of surviving candidates are short-volatility and ${stressUntestedN}/${survForRisk.length} are untested in a stress regime — their low mutual correlation is calm-regime only and converges toward 1 in a vol spike. Cap short-vol exposure and prefer stress-tested / long-vol sleeves.`
      : null,
  };

  const flaggedOutTally = {};
  for (const r of s.out) for (const why of r.outReasons) {
    const k = why.startsWith('overfit') ? 'overfit' : why.startsWith('liveDays') ? 'thin' : why.startsWith('no live') ? 'no-live' : why.split(' ')[0];
    flaggedOutTally[k] = (flaggedOutTally[k] || 0) + 1;
  }

  const universe = s.held.length + s.survivors.length + s.out.length + s.parked.length;
  return {
    asOf,
    capitalTier: { name: s.tier.name, capital: s.capital, admit: s.tier.admit, dd: s.tier.dd },
    thresholds: { overfitMin: s.params.overfitMin, minLiveDays: s.params.minLiveDays, redundantCorr: s.params.redundantCorr, structureOutlierMAD: s.params.structureOutlierMAD, thinDays: THIN_DAYS },
    structureDD: s.structureDD,
    counts: { universe, held: s.held.length, survivors: s.survivors.length, parked: s.parked.length, out: s.out.length, flaggedOut: s.out.length + s.parked.length },
    held, confront: { dominatedBy, supplementary }, survivorsByStyle, parked, redundant: s.redundant, flaggedOutTally,
    regimeRisk,
  };
}
