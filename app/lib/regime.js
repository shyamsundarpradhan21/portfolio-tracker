// Deterministic market-regime classifier — NO LLM. Reads the live macro clock
// (the `live` block from /api/macro) and returns:
//   state   — current LEVEL of conditions: risk-on | neutral | watch | risk-off
//   lean    — DIRECTION of travel (from the CHANGES, not the levels):
//             easing | stable | tightening
//   score   — the transparent net stress score behind `state`
//   drivers — the 2-3 fields actually moving it, as computed {label,value,change}
//
// It STATES current conditions; it never predicts direction. Stale inputs are
// excluded; with too few live inputs the state is 'unavailable' (never guessed).

// Tunable thresholds — named + visible, not magic numbers buried in the logic.
export const REGIME_TH = {
  vix:   { calm: 14, mild: 16, elevated: 20, stress: 28 }, // ^VIX level
  hyOas: { tight: 3.5, elevated: 4.5, wide: 6.0 },         // ICE BofA US HY OAS, %
  nfci:  { loose: -0.3, tight: 0.3 },                      // Chicago Fed NFCI (0 = avg)
  bucket: { riskOn: -2, neutral: 1, watch: 4 },            // net stress score → state
  chg:   { hyOas: 0.05, us10y: 0.05, dxy: 0.2, vix: 1 },   // min |change| to count for lean
};

const ok = (d) => !!d && !d.stale && d.value != null && isFinite(d.value);

// Per-field display config — produces computed strings the UI renders verbatim.
const FIELD = {
  vix:     { label: 'VIX',      val: (v) => v.toFixed(1),         chg: (c) => `${Math.abs(c).toFixed(1)} pt` },
  vixTerm: { label: 'VIX term', val: (s) => s,                    chg: () => '' },
  hyOas:   { label: 'HY OAS',   val: (v) => v.toFixed(2) + '%',   chg: (c) => `${Math.round(Math.abs(c) * 100)}bp` },
  us10y:   { label: 'US 10Y',   val: (v) => v.toFixed(2) + '%',   chg: (c) => `${Math.round(Math.abs(c) * 100)}bp` },
  nfci:    { label: 'NFCI',     val: (v) => v.toFixed(2),         chg: (c) => Math.abs(c).toFixed(2) },
  dxy:     { label: 'DXY',      val: (v) => v.toFixed(1),         chg: (c) => Math.abs(c).toFixed(1) },
};

export function classifyRegime(live) {
  if (!live) return { state: 'unavailable', lean: null, score: 0, drivers: [] };
  const T = REGIME_TH;
  let score = 0, nLive = 0;
  const contrib = [];
  const push = (key, points, value, change) => { score += points; if (points !== 0) contrib.push({ key, points, value, change }); };

  if (ok(live.vix)) {
    nLive++; const v = live.vix.value;
    const p = v > T.vix.stress ? 3 : v > T.vix.elevated ? 2 : v > T.vix.mild ? 1 : v < T.vix.calm ? -2 : -1;
    push('vix', p, v, live.vix.change);
  }
  if (live.vixTerm && !live.vixTerm.stale && live.vixTerm.state) {
    nLive++; push('vixTerm', live.vixTerm.state === 'backwardation' ? 2 : -1, live.vixTerm.state, null);
  }
  if (ok(live.hyOas)) {
    nLive++; const v = live.hyOas.value;
    const p = v > T.hyOas.wide ? 2 : v > T.hyOas.elevated ? 1 : v < T.hyOas.tight ? -1 : 0;
    push('hyOas', p, v, live.hyOas.change);
  }
  if (ok(live.nfci)) {
    nLive++; const v = live.nfci.value;
    const p = v > T.nfci.tight ? 1 : v < T.nfci.loose ? -1 : 0;
    push('nfci', p, v, live.nfci.change);
  }
  // Not enough live signal to call a regime honestly.
  if (nLive < 2) return { state: 'unavailable', lean: null, score: 0, drivers: [] };

  const b = T.bucket;
  const state = score <= b.riskOn ? 'risk-on' : score <= b.neutral ? 'neutral' : score <= b.watch ? 'watch' : 'risk-off';

  // LEAN — net direction of the CHANGES (what's moving), risk-off-ward = +.
  let lean = 0;
  const dir = (d, th) => (ok(d) && d.change != null && isFinite(d.change) ? (d.change > th ? 1 : d.change < -th ? -1 : 0) : 0);
  lean += dir(live.hyOas, T.chg.hyOas);
  lean += dir(live.us10y, T.chg.us10y);
  lean += dir(live.dxy, T.chg.dxy);
  lean += dir(live.vix, T.chg.vix);
  const leanState = lean > 0 ? 'tightening' : lean < 0 ? 'easing' : 'stable';

  // DRIVERS — biggest movers of the state, rendered as computed fields.
  const drivers = contrib
    .sort((a, c) => Math.abs(c.points) - Math.abs(a.points))
    .slice(0, 3)
    .map((c) => {
      const f = FIELD[c.key];
      const hasChg = c.change != null && isFinite(c.change) && f.chg;
      return {
        key: c.key,
        label: f.label,
        valueStr: f.val(c.value),
        changeStr: hasChg ? f.chg(c.change) : '',
        changeDir: hasChg ? (c.change > 0 ? 1 : c.change < 0 ? -1 : 0) : 0,
        dir: c.points > 0 ? 'stress' : 'calm', // colours the chip
      };
    });

  return { state, lean: leanState, score, drivers };
}
