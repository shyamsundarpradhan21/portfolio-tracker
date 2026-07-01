// Monthly review + self-learning (Phase 4, locked 2026-07-02). Pure functions: score last
// month's decisions against what ACTUALLY happened forward, compute calibration, and PROPOSE
// (never apply) threshold tweaks. Fixture-driven — the first real review is Aug 2026, so all
// logic is proven on constructed fixtures, not live data.
//
// The live series is per-TRADE-DAY RETURNS (%), additive — forward return = SUM of the
// in-window points (NOT a cumulative curve). Same convention as algoScreen.segmentMetrics.

import { maxDrawdown } from './algoScreen.mjs';
import { regimeForDate } from '../../app/lib/regime.mjs';

const round = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 100) / 100);
const pctS = (f) => (f == null ? '—' : `${Math.round(f * 100)}%`);
const dateMs = (d) => { const [dd, mm, yy] = String(d).split('/'); return Date.UTC(+yy, +mm - 1, +dd); };
export const THIN_FORWARD_DAYS = 15; // < this = LOW-CONFIDENCE window (never a verdict)

// Forward realised stats for one record over (startMs, ∞] — the days AFTER the decision.
function forwardStats(record, startMs) {
  const pts = (record?.stratzy?.split?.live || []).filter((p) => dateMs(p.date) > startMs && Number.isFinite(p.v));
  if (!pts.length) return { forwardReturn: null, realisedMaxDD: null, worstDay: null, daysObserved: 0, dates: [] };
  const v = pts.map((p) => p.v);
  return {
    forwardReturn: round(v.reduce((s, x) => s + x, 0)),
    realisedMaxDD: round(maxDrawdown(v)),
    worstDay: round(Math.min(...v)),
    daysObserved: v.length,
    dates: pts.map((p) => p.date),
  };
}

// Spearman rank correlation (ordinal ranks; ties broken by order — fine for our small n).
// +1 = perfect agreement, 0 = none, −1 = inverted. null if n < 3.
export function spearman(a, b) {
  const n = a.length;
  if (n < 3 || b.length !== n) return null;
  const ranks = (arr) => { const order = arr.map((v, i) => [v, i]).sort((x, y) => x[0] - y[0]); const r = new Array(n); order.forEach(([, i], k) => { r[i] = k + 1; }); return r; };
  const ra = ranks(a), rb = ranks(b);
  const mean = (xs) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra), mb = mean(rb);
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = ra[i] - ma, y = rb[i] - mb; num += x * y; da += x * x; db += y * y; }
  return da && db ? round(num / Math.sqrt(da * db)) : null;
}

// Review a month's artifact against fresh records. Returns per-pick forward stats,
// calibration, a KEEP/EXIT/ADD counterfactual, and a low-confidence flag for thin windows.
export function reviewMonth(artifact, freshRecords, { regimeCal = null } = {}) {
  const d0 = new Date(artifact.asOf);
  const startMs = Date.UTC(d0.getUTCFullYear(), d0.getUTCMonth(), d0.getUTCDate());
  const recByName = new Map(freshRecords.map((r) => [r.name, r]));
  const cands = artifact.candidates || [];
  const rankPos = new Map(cands.map((c, i) => [c.algo, i + 1]));           // decision rank (1 = best)
  const candByName = new Map(cands.map((c) => [c.algo, c]));
  const fundedNames = new Set((artifact.book?.picks || []).map((p) => p.algo));
  const fwdCache = new Map();
  const fwd = (name) => { if (!fwdCache.has(name)) fwdCache.set(name, forwardStats(recByName.get(name), startMs)); return fwdCache.get(name); };

  const stressForward = (name) => {
    const rec = recByName.get(name);
    let days = 0, ret = 0;
    if (regimeCal && rec) for (const p of (rec.stratzy?.split?.live || [])) {
      if (dateMs(p.date) <= startMs || !Number.isFinite(p.v)) continue;
      if (regimeForDate(regimeCal, p.date)?.vol === 'stressed') { days++; ret += p.v; }
    }
    return { stressDays: days, stressReturn: round(ret) };
  };

  // per-pick (funded) forward result
  const picks = (artifact.book?.picks || []).map((p) => {
    const c = candByName.get(p.algo);
    const f = fwd(p.algo);
    const gate = c?.gateMaxDD ?? p.gateMaxDD ?? null;
    return {
      algo: p.algo, label: c?.held ? 'KEEP' : 'ADD', held: !!c?.held,
      rankPosition: rankPos.get(p.algo) ?? null, persist2: c?.persist2 ?? null,
      gateMaxDD: gate, ...omitDates(f),
      ddBreach: f.realisedMaxDD != null && gate != null && f.realisedMaxDD < gate,
      ...stressForward(p.algo),
    };
  });

  // counterfactual — did KEEP/EXIT/ADD add value?
  const exited = (artifact.labels?.exit || []).map((name) => ({ algo: name, ...omitDates(fwd(name)) }));
  // top unfunded NEW candidates (held/exited ones are scored separately above — don't double-count)
  const topUnfunded = cands.filter((c) => !fundedNames.has(c.algo) && !c.held).slice(0, 5)
    .map((c) => ({ algo: c.algo, rankPosition: rankPos.get(c.algo), ...omitDates(fwd(c.algo)) }));
  const avg = (arr) => { const xs = arr.map((x) => x.forwardReturn).filter(Number.isFinite); return xs.length ? round(xs.reduce((s, x) => s + x, 0) / xs.length) : null; };
  const fundedAvg = avg(picks), exitedAvg = avg(exited), unfundedAvg = avg(topUnfunded);
  const counterfactual = {
    exited, topUnfunded, fundedAvg, exitedAvg, unfundedAvg,
    keepExitValueAdd: fundedAvg != null && exitedAvg != null ? round(fundedAvg - exitedAvg) : null, // >0 = funded beat what we dropped
    addValueAdd: fundedAvg != null && unfundedAvg != null ? round(fundedAvg - unfundedAvg) : null,  // >0 = funded beat the next-best unfunded
  };

  // calibration
  const withFwd = picks.filter((p) => Number.isFinite(p.forwardReturn));
  const hitRate = withFwd.length ? round(withFwd.filter((p) => p.forwardReturn > 0).length / withFwd.length) : null;
  const ddBreaches = picks.filter((p) => p.ddBreach).length;
  const scored = cands.map((c) => ({ algo: c.algo, drank: rankPos.get(c.algo), fr: fwd(c.algo).forwardReturn })).filter((x) => Number.isFinite(x.fr));
  const byFwd = [...scored].sort((a, b) => b.fr - a.fr);
  const rrank = new Map(byFwd.map((x, i) => [x.algo, i + 1]));
  const rankSpearman = scored.length >= 3 ? spearman(scored.map((x) => x.drank), scored.map((x) => rrank.get(x.algo))) : null;
  const stressedPicks = picks.filter((p) => p.stressDays > 0);

  // window / confidence
  const dates = new Set();
  for (const p of (artifact.book?.picks || [])) fwd(p.algo).dates.forEach((d) => dates.add(d));
  const tradingDays = dates.size;
  const lowConfidence = tradingDays < THIN_FORWARD_DAYS;

  return {
    window: { from: artifact.asOf, to: freshRecords?.[0]?.asOf ?? null, tradingDays },
    lowConfidence,
    params: { minLongVolShare: artifact.book?.minLongVolShare ?? null, catastrophicFloor: artifact.params?.catastrophicFloor ?? null },
    picks,
    counterfactual,
    calibration: {
      hitRate, ddBreaches, rankSpearman,
      stressedForward: stressedPicks.map((p) => ({ algo: p.algo, stressDays: p.stressDays, stressReturn: p.stressReturn })),
    },
  };
}
const omitDates = ({ dates, ...rest }) => rest;

// Self-learning: PROPOSED threshold tweaks from one review. Suggestions only — the caller
// prints them; NOTHING is auto-applied (locked: no silent refitting to a handful of months).
export function proposeTweaks(review) {
  const t = [];
  if (review.lowConfidence) {
    t.push(`LOW-CONFIDENCE window (${review.window.tradingDays} < ${THIN_FORWARD_DAYS} forward trading days) — every line below is provisional; do NOT retune on one thin month.`);
  }
  const cal = review.calibration;
  if (cal.rankSpearman != null && cal.rankSpearman < 0) {
    t.push(`Rank was anti-predictive (Spearman ${cal.rankSpearman}): the persistence signal underperformed this month. Watch — one month is not evidence to change the ranker.`);
  }
  if (cal.hitRate != null && cal.hitRate < 0.5) {
    t.push(`Hit rate ${pctS(cal.hitRate)} (<50%): most funded picks lost forward. If it persists 2–3 months, revisit the pool filters.`);
  }
  if (cal.ddBreaches > 0) {
    t.push(`${cal.ddBreaches} pick(s) drew down FORWARD deeper than their gate DD — the −100 floor / DD tolerance ran loose. Consider a tighter floor only if it repeats.`);
  }
  const lostInStress = cal.stressedForward.filter((s) => s.stressReturn != null && s.stressReturn < 0);
  if (lostInStress.length) {
    t.push(`${lostInStress.length} pick(s) hit a STRESSED regime forward and lost there — the long-vol hedge floor (${pctS(review.params.minLongVolShare)}) may need raising; this is the exact tail the hedge exists for.`);
  } else if (cal.stressedForward.length) {
    t.push(`${cal.stressedForward.length} pick(s) saw a stressed regime and held up — mild evidence the book survives stress (still thin).`);
  }
  const cf = review.counterfactual;
  if (cf.keepExitValueAdd != null && cf.keepExitValueAdd < 0) {
    t.push(`EXITed algos beat the funded book by ${Math.abs(cf.keepExitValueAdd)}% avg forward — the KEEP/EXIT call cost return this month. Review if it repeats.`);
  }
  if (cf.addValueAdd != null && cf.addValueAdd < 0) {
    t.push(`The top unfunded candidates beat the funded book by ${Math.abs(cf.addValueAdd)}% avg — capital/hedge caps may have crowded out better picks.`);
  }
  if (!t.length) t.push('No threshold changes suggested — calibration within normal range for this window.');
  return t;
}
