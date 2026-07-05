// Capital allocation gate — turns the screen's RANKED survivors into a concrete
// ₹-per-algo book, bounded by risk caps, with the binding reason for every size.
// Pure + deterministic (no I/O, no clock) so it unit-tests on a constructed universe.
//
// Philosophy: the user's method is "max-out the top pick, then move to the next" — this
// keeps that greedy rank order but BOUNDS every fill by (locked 2026-07-02 defaults):
//   • single algo ≤ 30% of capital                         (concentration)
//   • short-vol CLUSTER ≤ 60% of capital                    (regime risk — credit spreads +
//       option-selling all lose together in a vol spike; their calm-regime low corr is a lie)
//   • drawdown-scaled: max weight shrinks as |gateMaxDD| deepens (−20%→full, −45%→~½, −60%→¼)
//   • down-regime haircut: not-down-tested → ×0.75; lost money in down-trends → ×0.5
//       (this is the OPERATIVE adverse-condition defence — stress-tested is non-discriminating
//        in the 2023–26 low-vol era, so we lean on down-trend evidence which has real sample)
//   • ≥1 long-vol (premium-BUYING) sleeve if one exists      (structural diversification)
//   • respect each algo's real minAmount / maxCapital
// Concentration is therefore OPT-IN (bounded), not the default.

const round = (x) => (x == null || !Number.isFinite(x) ? null : Math.round(x));
const pct = (f) => `${Math.round(f * 100)}%`;

export const DEFAULT_CAPS = {
  singleAlgo: 0.30,     // any one algo ≤ 30% of capital
  shortVolShare: 0.60,  // short-vol cluster ≤ 60% of capital
  minLongVol: 1,        // fund at least 1 long-vol sleeve if a candidate exists
  ddFull: 20,           // |maxDD| at/below which weight is unscaled (full)
  ddQuarter: 60,        // |maxDD| at/above which weight is scaled to ¼
};

// Drawdown → weight multiplier, linear between the two knots, clamped [0.25, 1].
export function ddScale(gateMaxDD, caps = DEFAULT_CAPS) {
  if (gateMaxDD == null) return 1;
  const dd = Math.abs(gateMaxDD);
  if (dd <= caps.ddFull) return 1;
  if (dd >= caps.ddQuarter) return 0.25;
  const t = (dd - caps.ddFull) / (caps.ddQuarter - caps.ddFull);
  return Math.max(0.25, 1 - t * 0.75);
}

// Down-regime health → weight multiplier. Losing money in down-trends is the clearest
// adverse-condition tell we have real sample for; unproven in down-trends is a mild haircut.
export function downScale(c) {
  if (c.downSortino != null && c.downSortino < 0) return 0.5;
  if (!c.downTested) return 0.75;
  return 1;
}

const minOf = (c) => c.min ?? 0;
const pickBase = (c) => ({ algo: c.algo, volSide: c.volSide ?? 'neutral', structure: c.structure ?? null });

// Per-algo rupee ceiling = the tightest of: single-algo weight cap (× dd × down scales) and
// the algo's own maxCapital. Returns { ceiling, weightCap, reasonIfWeightBound }.
function ceilingFor(c, capital, caps) {
  const scaled = caps.singleAlgo * ddScale(c.gateMaxDD, caps) * downScale(c);
  const weightCap = Math.round(scaled * capital);
  const maxCap = c.max ?? Infinity;
  const ceiling = Math.min(weightCap, maxCap);
  return { ceiling, weightCap, maxCap };
}

/**
 * allocate(candidates, { capital, caps }) → book.
 * candidates: RANKED array of { algo, volSide, structure, gateMaxDD, downTested, downSortino, min, max }.
 * Returns { picks[], skipped[], deployed, idle, capital, shortVol, shortVolShare, longVol, warnings[] }.
 */
export function allocate(candidates, { capital, caps = DEFAULT_CAPS } = {}) {
  if (!Number.isFinite(capital) || capital <= 0) throw new Error('allocate: capital must be a positive number');
  const c0 = { ...DEFAULT_CAPS, ...caps };
  const svBudget = Math.round(c0.shortVolShare * capital);

  // Guarantee a long-vol sleeve: process the top-ranked long-vol candidate FIRST so the
  // short-vol names can't exhaust the budget before it. (No-op if none exists / already first.)
  let order = candidates;
  if (c0.minLongVol >= 1) {
    const i = candidates.findIndex((c) => c.volSide === 'long');
    if (i > 0) order = [candidates[i], ...candidates.slice(0, i), ...candidates.slice(i + 1)];
  }

  const picks = [], skipped = [];
  let spent = 0, shortVolSpent = 0;

  for (const c of order) {
    const remaining = capital - spent;
    if (remaining <= 0) { skipped.push({ ...pickBase(c), reason: 'capital exhausted' }); continue; }

    const { ceiling, weightCap, maxCap } = ceilingFor(c, capital, c0);
    let target = Math.min(ceiling, remaining);
    let bound = target === maxCap ? `algo cap ₹${round(maxCap)}`
      : target === weightCap ? `30% single-cap × DD/down scale`
      : 'remaining budget';

    if (c.volSide === 'short') {
      const svHeadroom = svBudget - shortVolSpent;
      if (svHeadroom <= 0) { skipped.push({ ...pickBase(c), reason: `short-vol cluster full (≤${pct(c0.shortVolShare)})` }); continue; }
      if (svHeadroom < target) { target = svHeadroom; bound = `short-vol headroom (cluster ≤${pct(c0.shortVolShare)})`; }
    }

    if (target < minOf(c)) {
      skipped.push({ ...pickBase(c), reason: `needs ₹${round(minOf(c))} min, only ₹${round(target)} left within caps` });
      continue;
    }

    picks.push({ ...pickBase(c), rupees: target, weight: +(target / capital).toFixed(4), gateMaxDD: c.gateMaxDD ?? null, bindingReason: bound });
    spent += target;
    if (c.volSide === 'short') shortVolSpent += target;
  }

  const longVol = picks.filter((p) => p.volSide === 'long').length;
  const warnings = [];
  if (c0.minLongVol >= 1 && longVol === 0 && candidates.some((c) => c.volSide === 'long')) {
    warnings.push('no long-vol sleeve funded despite a candidate — book is entirely short-vol/neutral (regime-fragile)');
  }
  if (candidates.every((c) => c.volSide === 'short')) warnings.push('candidate pool is entirely short-vol — diversification impossible from this screen');

  return {
    capital, caps: c0,
    picks, skipped,
    deployed: spent, idle: capital - spent,
    shortVol: shortVolSpent, shortVolShare: +(shortVolSpent / capital).toFixed(4),
    longVol,
    warnings,
  };
}

// Human-readable justification for the month's book — WHY each pick, WHY that size, and the
// book-level structure/regime summary. Pure; the orchestrator prints it + stores it in the
// monthly artifact. `regimeCaveat` is the screen's book-level regimeRisk.caveat (council #1).
export function justify(book, { regimeCaveat = null } = {}) {
  const inr = (n) => `₹${Number(n).toLocaleString('en-IN')}`;
  const mix = book.picks.reduce((m, p) => { m[p.volSide] = (m[p.volSide] || 0) + 1; return m; }, {});
  const perPick = book.picks.map((p) => ({
    algo: p.algo, rupees: p.rupees, weight: p.weight, volSide: p.volSide, structure: p.structure,
    gateMaxDD: p.gateMaxDD, bindingReason: p.bindingReason,
    line: `${p.algo} — ${inr(p.rupees)} (${pct(p.weight)}), ${p.volSide}-vol${p.structure ? `/${p.structure}` : ''}`
      + `${p.gateMaxDD != null ? `, DD ${p.gateMaxDD}%` : ''}; sized by ${p.bindingReason}.`,
  }));
  const headline = `${book.picks.length} algos · ${inr(book.deployed)} deployed (${pct(book.deployed / book.capital)})`
    + ` · idle ${inr(book.idle)} · short-vol ${pct(book.shortVolShare)} · ${book.longVol} long-vol sleeve(s)`;
  return {
    headline, perPick,
    bookSummary: { deployed: book.deployed, idle: book.idle, shortVolShare: book.shortVolShare, longVol: book.longVol, volMix: mix },
    warnings: book.warnings,
    regimeCaveat,
  };
}

// ── CONVICTION mode (locked 2026-07-02) ───────────────────────────────────────
// The user chose to CHASE RETURNS: rank the candidates (persistence → live Sortino),
// then max-out each to its OWN maxCapital in order — NO single-algo cap, NO short-vol
// cluster cap, NO drawdown scaling (drawdown is shown per-pick, not a limit). TWO enforced
// safety elements: (1) a mandatory LONG-VOL (premium-BUYING) hedge of ≥ this share of capital
// — long-vol GAINS in a vol spike, capping the short-vol cluster's correlated give-back (the
// defence against "a single event wiping out months of gains"); and (2) a QUALITY FLOOR (see
// CONVICTION_FUNDABLE) — money-losers / deep persistence-rank / DD-parked names are NEVER sized,
// and capital with no fundable home is left IDLE rather than force-deployed (added 2026-07-05).
export const CONVICTION_MIN_LONGVOL_SHARE = 0.20;

// KEEP / EXIT / ADD verdict for the month's holdings vs the funded book. Held+funded = KEEP,
// held+unfunded = EXIT (the method dropped it — the signal the monthly review exists to catch),
// new+funded = ADD. Pure.
export function labelBook(book, candidates) {
  const funded = new Set(book.picks.map((p) => p.algo));
  const heldNames = new Set(candidates.filter((c) => c.held).map((c) => c.algo));
  return {
    keep: book.picks.filter((p) => heldNames.has(p.algo)).map((p) => p.algo),
    exit: candidates.filter((c) => c.held && !funded.has(c.algo)).map((c) => c.algo),
    add: book.picks.filter((p) => !heldNames.has(p.algo)).map((p) => p.algo),
  };
}

// ── quality floor for CONVICTION funding (added 2026-07-05) ────────────────────
// A candidate BELOW the bar stays in the pool (still listed in the "all candidates" table)
// but is NEVER sized — capital with no fundable home is left IDLE, not force-deployed into a
// money-loser, a deep persistence-rank name, or a DD-parked one. Null-safe: an ABSENT field
// never disqualifies, so a universe without these fields funds exactly as before.
export const CONVICTION_FUNDABLE = { maxRank: 40, requirePositiveSortino: true, excludeParked: true };

function fundableAt(c, f) {
  if (!f) return true;
  if (f.requirePositiveSortino && c.sortino != null && c.sortino <= 0) return false;
  if (f.excludeParked && Array.isArray(c.parkReason) && c.parkReason.length) return false;
  if (f.maxRank != null && c.persist2 != null && c.persist2 > f.maxRank) return false;
  return true;
}
function floorReason(c, f) {
  const bits = [];
  if (f.requirePositiveSortino && c.sortino != null && c.sortino <= 0) bits.push(`Sortino ${c.sortino} ≤ 0`);
  if (f.excludeParked && Array.isArray(c.parkReason) && c.parkReason.length) bits.push('DD-parked');
  if (f.maxRank != null && c.persist2 != null && c.persist2 > f.maxRank) bits.push(`rank #${c.persist2} > ${f.maxRank}`);
  return `below quality floor${bits.length ? ` (${bits.join(' · ')})` : ''}`;
}

export function allocateConviction(cands, { capital, minLongVolShare = CONVICTION_MIN_LONGVOL_SHARE, fundableFloor = CONVICTION_FUNDABLE } = {}) {
  if (!Number.isFinite(capital) || capital <= 0) throw new Error('allocateConviction: capital must be a positive number');
  const earmark = Math.round(minLongVolShare * capital); // capital non-long picks may NOT touch
  const picks = [], skipped = [], funded = new Set();
  let spent = 0, longSpent = 0, shortSpent = 0;
  const minOf = (c) => c.min ?? 0;
  const ceilOf = (c) => (c.max == null ? capital : c.max);
  const inr = (n) => '₹' + round(n).toLocaleString('en-IN');
  const fund = (c, target, reason) => {
    picks.push({ algo: c.algo, volSide: c.volSide ?? 'neutral', structure: c.structure ?? null, rupees: target,
      weight: +(target / capital).toFixed(4), gateMaxDD: c.gateMaxDD ?? null, liveMaxDD: c.liveMaxDD ?? null, bindingReason: reason });
    funded.add(c.algo); spent += target;
    if (c.volSide === 'long') longSpent += target; else if (c.volSide === 'short') shortSpent += target;
  };

  // Quality floor — split the ranked pool: fundable names get sized; below-bar names are
  // recorded in `skipped` (still shown in the pool's background table) but NEVER sized, so
  // capital with no fundable home is left idle, not dumped into a money-loser / deep-rank / parked name.
  const eligible = [];
  let belowFloor = 0;
  for (const c of cands) {
    if (fundableAt(c, fundableFloor)) eligible.push(c);
    else { skipped.push({ algo: c.algo, volSide: c.volSide ?? 'neutral', reason: floorReason(c, fundableFloor) }); belowFloor++; }
  }

  // Main pass — conviction max-out by rank over the ELIGIBLE pool. Non-long picks may not
  // consume the long-vol earmark, so ≥ minLongVolShare of capital stays reserved for a long-vol sleeve.
  for (const c of eligible) {
    const totalRem = capital - spent;
    if (totalRem <= 0) break;
    const earmarkLeft = Math.max(0, earmark - longSpent);
    const avail = c.volSide === 'long' ? totalRem : Math.max(0, totalRem - earmarkLeft);
    const target = Math.min(ceilOf(c), avail);
    if (target < minOf(c)) { skipped.push({ algo: c.algo, volSide: c.volSide ?? 'neutral', reason: `needs ${inr(minOf(c))} min, ${inr(avail)} available` }); continue; }
    const reason = c.volSide === 'long'
      ? (target === c.max ? `long-vol hedge · maxed to capacity ${inr(c.max)}` : 'long-vol hedge sleeve')
      : (target === c.max ? `maxed to algo capacity ${inr(c.max)}` : 'filled remaining capital');
    fund(c, target, reason);
  }

  // Cleanup — if too little long-vol could be funded, don't force idle cash: release the
  // earmark to the best remaining non-long picks, and WARN the hedge is incomplete.
  const warnings = [];
  if (longSpent < earmark) {
    warnings.push(`long-vol hedge INCOMPLETE: ${inr(longSpent)} of ${inr(earmark)} target (${pct(minLongVolShare)}) — too few long-vol candidates to fully hedge the short-vol cluster`);
    // Release the earmark to the best remaining ELIGIBLE non-long picks (never below the floor):
    // grow already-funded ones toward max, then fund new ones — junk still can't be funded.
    for (const c of eligible) {
      if (c.volSide === 'long') continue;
      const rem = capital - spent; if (rem <= 0) break;
      const existing = picks.find((p) => p.algo === c.algo);
      const curr = existing ? existing.rupees : 0;
      const add = Math.min(ceilOf(c), curr + rem) - curr;
      if (add <= 0) continue;
      if (existing) {
        existing.rupees += add; existing.weight = +(existing.rupees / capital).toFixed(4);
        existing.bindingReason += ' (+hedge earmark released)';
        spent += add; if (c.volSide === 'short') shortSpent += add;
      } else if (add >= minOf(c)) {
        fund(c, add, `${add === c.max ? `maxed to algo capacity ${inr(c.max)}` : 'filled remaining capital'} (hedge earmark released)`);
      }
    }
  }

  // Quality-floor idle — capital left over BECAUSE below-bar names were held back, not force-funded.
  const idle = capital - spent;
  if (idle > 0 && belowFloor > 0) {
    warnings.push(`left ${inr(idle)} idle — ${belowFloor} candidate(s) below the quality floor (rank ≤ ${fundableFloor?.maxRank ?? '∞'} · positive Sortino · not DD-parked) left unfunded rather than force-deployed`);
  }

  return {
    capital, mode: 'conviction', minLongVolShare, fundableFloor,
    picks, skipped,
    deployed: spent, idle,
    shortVol: shortSpent, shortVolShare: +(shortSpent / capital).toFixed(4),
    longVol: picks.filter((p) => p.volSide === 'long').length, longVolRupees: longSpent, longVolShare: +(longSpent / capital).toFixed(4),
    warnings,
  };
}
