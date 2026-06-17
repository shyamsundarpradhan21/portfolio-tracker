// Macro scenario engine — pure functions. Given the portfolio as it stands
// today (values + computed sensitivities), it answers ONE question: how does
// each sleeve respond under a defined macro shock? Every output is conditional
// (IF→THEN). There are NO point forecasts here — a scenario is a hypothetical
// shock the caller chooses, never a prediction that it will happen.
//
// Confidence is first-class. Each leg is tagged:
//   'hard'       — deterministic (e.g. FX conversion on a USD book)
//   'modelled'   — a regression with enough points AND a real fit; `weak` when R² is low
//   'indicative' — real data but TOO FEW points to fit: a descriptive average, n=N
//   'assumed'    — a STATED sensitivity with no series at all
// Sample-size insufficiency ('indicative') and a poor fit ('weak') are DIFFERENT
// failures and MUST render differently — never collapse both into one flag. The
// cardinal rule: a number must never render at a higher tier than its data supports.

export const LOW_RSQ = 0.4;        // below this an R²-flagged regression is "weak"
export const MIN_OBS_MONTHLY = 24; // a monthly regression is only 'modelled' at/above this

// Stated sensitivities for sleeves with no regressable P&L series. These are
// ASSUMPTIONS, surfaced as such in the UI and centralised here so they are easy
// to tune and impossible to mistake for measured numbers.
export const ASSUME = {
  volPerVixPt:    -0.012, // short-premium book P&L per +1 VIX pt (−1.2% → −12%/+10 VIX)
  backwardationMult: 1.4, // extra stress when VIX term structure inverts
  crudeIndiaEq:   -0.03,  // India-equity drag per +20% Brent (inflation/CAD channel)
  crudeUsdInrPct:  1.5,   // INR depreciation (%) per +20% Brent → tailwind to USD book
  hyVolPer150:    -0.12,  // short-credit/vol book P&L per +150bp HY OAS (risk-off)
  vixFallback:     18,    // used only if the live VIX read is missing (leg flagged weak)
};

// Display order + colour for the per-sleeve table/bars (tokens from globals.css).
export const SLEEVES = [
  { key: 'us',    label: 'US tech (Vested)', color: 'var(--cyn)' },
  { key: 'india', label: 'India equity',     color: 'var(--blu)' },
  { key: 'vol',   label: 'Vol — Stratzy',    color: 'var(--pur)' },
  { key: 'gold',  label: 'Gold',             color: 'var(--gld)' },
  { key: 'fd',    label: 'FD ladder',        color: 'var(--grn)' },
];

const weakRsq = (rsq) => rsq == null || rsq < LOW_RSQ;

// One impact leg: fractional shock `frac` applied to a sleeve's INR base.
// `meta` carries tier evidence the UI renders (n observations, rsq, ₹ CI range).
function leg(key, base, frac, conf, weak, meta) {
  return {
    key,
    inr: Math.round((base || 0) * frac),
    pct: frac * 100,        // % of THAT sleeve's value
    conf,                   // 'hard' | 'modelled' | 'indicative' | 'assumed'
    weak: !!weak,           // low-R² fit only (NOT sample-size — that's 'indicative')
    ...(meta || {}),        // { n?, rsq?, rangeInr? }
  };
}

// Resolve the vol sleeve's VIX sensitivity into exactly one tier from the data
// backing it (single source of truth for shockVix AND the sensitivity table).
export function volTier(m) {
  const book = m?.sleeves?.vol?.book; // { perVixPt, rsq, se, n, ciLo, ciHi } | null
  // Sample size is the gate for "modelled": with ≥MIN_OBS_MONTHLY points it is a
  // regression (weak-flagged downstream when R² is low). Too few points is a
  // DIFFERENT failure → 'indicative' (a descriptive average, no R²/CI published).
  if (book && book.n >= MIN_OBS_MONTHLY) {
    return { conf: 'modelled', perVixPt: book.perVixPt, n: book.n, rsq: book.rsq, ciLo: book.ciLo, ciHi: book.ciHi };
  }
  if (book && book.n >= 1) {
    return { conf: 'indicative', perVixPt: book.perVixPt, n: book.n, rsq: null };
  }
  return { conf: 'assumed', perVixPt: ASSUME.volPerVixPt, n: null, rsq: null };
}

// One-line human label of the active vol tier (for scenario notes).
export function volTierLabel(m) {
  const t = volTier(m);
  if (t.conf === 'modelled') return `regressed on the book's own monthly P&L (n=${t.n} mo${t.rsq != null ? `, R²=${t.rsq.toFixed(2)}` : ''})`;
  if (t.conf === 'indicative') return `INDICATIVE — a descriptive average over ${t.n} month${t.n === 1 ? '' : 's'} of book P&L, too few to fit (need ${MIN_OBS_MONTHLY})`;
  return 'a STATED assumption — no book P&L series yet';
}

// ── Scenario primitives (each returns { legs, note }) ────────────────────────

function shockRates(m, bps) {
  const us = m.sleeves.us;
  const frac = (us.perBp ?? 0) * bps; // perBp = fractional return per +1bp
  return {
    legs: [leg('us', us.v, frac, 'modelled', weakRsq(us.rsqDur))],
    note: 'US-tech duration proxy: weekly return regressed on Δ10Y (^TNX). India rate channel (banks, FII) is indirect — not separately modelled.',
  };
}

function shockVix(m, target, backwardation) {
  const cur = m.vix ?? ASSUME.vixFallback;
  const noLiveVix = m.vix == null;
  const dvix = target - cur;
  const cap = m.sleeves.vol.cap;
  const bw = backwardation ? ASSUME.backwardationMult : 1;
  const t = volTier(m); // 'modelled' | 'indicative' | 'assumed'
  const frac = t.perVixPt * dvix * bw;
  const meta = { n: t.n, rsq: t.rsq };
  // Only a real fit publishes a ₹ range; indicative/assumed never fake precision.
  if (t.conf === 'modelled' && t.ciLo != null && t.ciHi != null) {
    meta.rangeInr = [Math.round(cap * t.ciLo * dvix * bw), Math.round(cap * t.ciHi * dvix * bw)].sort((a, b) => a - b);
  }
  const weak = t.conf === 'modelled' && weakRsq(t.rsq); // sample size is NOT weakness
  return {
    legs: [leg('vol', cap, frac, t.conf, weak, meta)],
    note:
      `Stratzy short-premium book vs VIX — ${volTierLabel(m)}. ΔVIX ${cur.toFixed(0)} → ${target}${noLiveVix ? ' (VIX feed stale — fallback)' : ' (live)'}.` +
      (backwardation ? ` Backwardation amplifies ×${ASSUME.backwardationMult} (assumption).` : ''),
  };
}

function shockFx(m, target) {
  const cur = m.fx;
  const frac = target / cur - 1; // conversion effect on USD-denominated books
  return {
    legs: [
      leg('us', m.sleeves.us.v, frac, 'hard', false),
      leg('gold', m.sleeves.gold.v, frac, 'hard', false),
    ],
    note: `Pure FX conversion on the USD-denominated Vested + gold books, from ₹${cur.toFixed(2)}/$. India, FD and the algo book are rupee assets — unaffected on conversion.`,
  };
}

function shockNasdaq(m, pct) {
  const us = m.sleeves.us;
  const frac = (us.betaNdx ?? 1) * (pct / 100);
  return {
    legs: [leg('us', us.v, frac, 'modelled', weakRsq(us.rsqNdx))],
    note: `US-tech β to Nasdaq applied to a ${pct}% index move. India sleeve is a different market — co-movement only shows in the composite.`,
  };
}

function shockNifty(m, pct) {
  const ind = m.sleeves.india;
  const frac = (ind.betaNifty ?? 1) * (pct / 100);
  return {
    legs: [leg('india', ind.v, frac, 'modelled', weakRsq(ind.rsqNifty))],
    note: `India-equity β to Nifty applied to a ${pct}% index move.`,
  };
}

function shockCrude(m, pct) {
  // India inflation/CAD channel — qualitative, applied as a STATED drag scaled
  // off the +20% reference. INR depreciation is a tailwind to the USD book.
  const scale = pct / 20;
  const indFrac = ASSUME.crudeIndiaEq * scale;
  const usFrac = (ASSUME.crudeUsdInrPct / 100) * scale; // INR weaker → USD book worth more in ₹
  return {
    legs: [
      leg('india', m.sleeves.india.v, indFrac, 'assumed', false),
      leg('us', m.sleeves.us.v, usFrac, 'assumed', false),
      leg('gold', m.sleeves.gold.v, usFrac, 'assumed', false),
    ],
    note: `Brent +${pct}%: STATED India-equity drag (imported inflation / current-account) and a STATED INR-depreciation tailwind to the USD books. Channels are assumed, not regressed.`,
  };
}

function shockHy(m, bps) {
  const scale = bps / 150;
  const frac = ASSUME.hyVolPer150 * scale;
  // No monthly HY series for the book yet → STATED assumption (not the book's fit).
  return {
    legs: [leg('vol', m.sleeves.vol.cap, frac, 'assumed', false)],
    note: `HY OAS +${bps}bp is the risk-off early-warning: a STATED stress on the short-credit/short-premium book (no book-vs-HY series yet). Equity sleeves co-move — see the composite.`,
  };
}

// Merge legs from several primitives by sleeve key (for composites). Confidence
// of a merged leg drops to the WEAKEST of its parts (hard > modelled >
// indicative > assumed); `weak` if any part is a weak fit.
function mergeLegs(parts) {
  const order = ['hard', 'modelled', 'indicative', 'assumed'];
  const by = {};
  for (const p of parts) for (const l of p.legs) {
    const e = by[l.key] || (by[l.key] = { key: l.key, inr: 0, pct: 0, conf: 'hard', weak: false });
    e.inr += l.inr; e.pct += l.pct;
    if (order.indexOf(l.conf) > order.indexOf(e.conf)) e.conf = l.conf;
    e.weak = e.weak || l.weak;
  }
  return Object.values(by);
}

// ── Scenario catalogue ───────────────────────────────────────────────────────
// group drives the visual sectioning; build(model) → { legs, note }.
export const SCENARIOS = [
  { id: 'r+50',  group: 'Rates',  label: '10Y +50 bps',  build: (m) => shockRates(m, 50) },
  { id: 'r+100', group: 'Rates',  label: '10Y +100 bps', build: (m) => shockRates(m, 100) },
  { id: 'r-50',  group: 'Rates',  label: '10Y −50 bps',  build: (m) => shockRates(m, -50) },
  { id: 'v25',   group: 'Vol',    label: 'VIX → 25',     build: (m) => shockVix(m, 25, false) },
  { id: 'v30',   group: 'Vol',    label: 'VIX → 30',     build: (m) => shockVix(m, 30, false) },
  { id: 'v40',   group: 'Vol',    label: 'VIX → 40',     build: (m) => shockVix(m, 40, false) },
  { id: 'vbw',   group: 'Vol',    label: 'VIX 30 + backwardation', build: (m) => shockVix(m, 30, true) },
  { id: 'fx86',  group: 'FX',     label: 'USDINR → 86',  build: (m) => shockFx(m, 86) },
  { id: 'fx88',  group: 'FX',     label: 'USDINR → 88',  build: (m) => shockFx(m, 88) },
  { id: 'nq-10', group: 'Equity', label: 'Nasdaq −10%',  build: (m) => shockNasdaq(m, -10) },
  { id: 'nq-20', group: 'Equity', label: 'Nasdaq −20%',  build: (m) => shockNasdaq(m, -20) },
  { id: 'ni-10', group: 'Equity', label: 'Nifty −10%',   build: (m) => shockNifty(m, -10) },
  { id: 'br+20', group: 'Crude',  label: 'Brent +20%',   build: (m) => shockCrude(m, 20) },
  { id: 'hy150', group: 'Credit', label: 'HY OAS +150 bps', build: (m) => shockHy(m, 150) },
  {
    id: 'riskoff', group: 'Composite', label: 'Risk-off (combined)',
    composite: true,
    build: (m) => ({
      legs: mergeLegs([shockNasdaq(m, -15), shockVix(m, 35, false), shockFx(m, 88), shockHy(m, 150)]),
      note: `SIMULTANEOUS: Nasdaq −15% + VIX → 35 + USDINR → 88 + HY OAS +150bp. These shocks are CORRELATED in a real risk-off — this sums the legs and does NOT assume independence; treat the total as an approximation, not an additive certainty. Vol leg: ${volTierLabel(m)}.`,
    }),
  },
];

// Evaluate a scenario against the model → { id, group, label, composite, legs,
// note, total }. legs is keyed by sleeve; total sums ₹ and expresses it as % of
// the exposed-capital base.
export function evalScenario(scn, model) {
  const { legs, note } = scn.build(model);
  const inr = legs.reduce((s, l) => s + l.inr, 0);
  const base = SLEEVES.reduce((s, sl) => s + (sl.key === 'vol' ? model.sleeves.vol.cap : (model.sleeves[sl.key]?.v || 0)), 0);
  return {
    id: scn.id, group: scn.group, label: scn.label, composite: !!scn.composite,
    legs, note,
    total: { inr, pct: base ? (inr / base) * 100 : 0 },
  };
}

export function evalAll(model) {
  return SCENARIOS.map((s) => evalScenario(s, model));
}
