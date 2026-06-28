// Roll the auto-captured realised-F&O ledger on top of the frozen FY seed so the
// Trading tab's current-FY (`current`) blocks drive themselves — no mid-year hand-
// edits. The seed (data/fno-verified.json → s0X.current) is the YTD realised
// through its `seedThrough` date; this adds every captured ledger day AFTER that,
// per sleeve. Pure: never mutates the seed. Both the seed and the ledger are
// passed in (hydrated at runtime, out of the bundle). Mirrors brokerState.js.

const r2 = (n) => Math.round(n * 100) / 100;

// Sum ledger rows for one sleeve, counting only days captured after the seed
// cutover (so the seed's YTD and the ledger never double-count).
function increment(rows, sleeve, after) {
  const got = rows.filter((r) => r.sleeve === sleeve && (!after || r.date > after));
  const days = new Set(), brokers = new Set();
  let gross = 0, charges = 0, net = 0, lastDate = '';
  for (const r of got) {
    gross += r.grossRealised || 0;
    // Phase 2c: prefer the REAL contract-note charge where the KV overlay marked the row 'real'
    // (net is already recomputed for those rows in applyFnoOverlay); else keep the estimate.
    charges += (r.chargeSource === 'real' ? (r.realCharge || 0) : (r.estCharges || 0));
    net += r.net || 0;
    days.add(r.date); brokers.add(r.broker);
    if (r.date > lastDate) lastDate = r.date;
  }
  // chargesReal: the whole increment is real-backed (every captured day overlaid with a real charge)
  // -> the 'est.' flag can drop. Any est day keeps it (the block is still partly estimated).
  const chargesReal = got.length > 0 && got.every((r) => r.chargeSource === 'real');
  return { gross, charges, net, days, brokers, lastDate, chargesReal };
}

function mergeBlock(seed, inc) {
  if (!inc.days.size) return { ...seed, auto: false }; // nothing captured yet → seed only
  return {
    ...seed,
    gross: r2(seed.gross + inc.gross),
    charges: r2(seed.charges + inc.charges),
    net: r2(seed.net + inc.net),
    auto: true,
    chargesReal: inc.chargesReal,   // drives whether YtdFno/FreshnessTag still show the 'est.' flag
    capturedDays: inc.days.size,
    lastCapture: inc.lastDate,
  };
}

// Returns a NEW FY object with fy2627 blocks (and cf.fy2627Realised) driven by the
// ledger. The rest of the FY object (prior-FY verified, carryforward, labels) is
// passed through untouched.
export function deriveFY(seedFY, ledger) {
  const rows = ledger?.rows || [];
  const s01seed = seedFY.s01.current, s02seed = seedFY.s02.current;
  const s01 = mergeBlock(s01seed, increment(rows, 'S01', s01seed.seedThrough));
  const s02 = mergeBlock(s02seed, increment(rows, 'S02', s02seed.seedThrough));
  const currentRealised = r2(s01.net + s02.net);
  const lastCapture = [s01.lastCapture, s02.lastCapture].filter(Boolean).sort().pop() || null;
  return {
    ...seedFY,
    s01: { ...seedFY.s01, current: s01 },
    s02: { ...seedFY.s02, current: s02 },
    cf: { ...seedFY.cf, currentRealised },
    _autoDriven: s01.auto || s02.auto,
    _lastCapture: lastCapture,
    // every captured block is real-backed (or seed-only) -> the tab can drop the 'est. charges' tag
    _chargesReal: [s01, s02].every((b) => !b.auto || b.chargesReal === true),
  };
}
