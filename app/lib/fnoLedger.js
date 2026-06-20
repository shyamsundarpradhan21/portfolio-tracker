// Roll the auto-captured realised-F&O ledger on top of the frozen FY seed so the
// Trading tab's current-FY (fy2627) blocks drive themselves — no mid-year hand-
// edits. The seed (data/fy2526_verified.json → s0X.fy2627) is the YTD realised
// through its `seedThrough` date; this adds every captured ledger day AFTER that,
// per sleeve. Pure: never mutates the imported seed. Mirrors brokerState.js.

import LEDGER from '../../data/fno-ledger.json';

const r2 = (n) => Math.round(n * 100) / 100;

// Sum ledger rows for one sleeve, counting only days captured after the seed
// cutover (so the seed's YTD and the ledger never double-count).
function increment(rows, sleeve, after) {
  const got = rows.filter((r) => r.sleeve === sleeve && (!after || r.date > after));
  const days = new Set(), brokers = new Set();
  let gross = 0, charges = 0, net = 0, lastDate = '';
  for (const r of got) {
    gross += r.grossRealised || 0;
    charges += r.estCharges || 0;
    net += r.net || 0;
    days.add(r.date); brokers.add(r.broker);
    if (r.date > lastDate) lastDate = r.date;
  }
  return { gross, charges, net, days, brokers, lastDate };
}

function mergeBlock(seed, inc) {
  if (!inc.days.size) return { ...seed, auto: false }; // nothing captured yet → seed only
  return {
    ...seed,
    gross: r2(seed.gross + inc.gross),
    charges: r2(seed.charges + inc.charges),
    net: r2(seed.net + inc.net),
    auto: true,
    capturedDays: inc.days.size,
    lastCapture: inc.lastDate,
  };
}

// Returns a NEW FY object with fy2627 blocks (and cf.fy2627Realised) driven by the
// ledger. The rest of the FY object (prior-FY verified, carryforward, labels) is
// passed through untouched.
export function deriveFY(seedFY, ledger = LEDGER) {
  const rows = ledger?.rows || [];
  const s01seed = seedFY.s01.fy2627, s02seed = seedFY.s02.fy2627;
  const s01 = mergeBlock(s01seed, increment(rows, 'S01', s01seed.seedThrough));
  const s02 = mergeBlock(s02seed, increment(rows, 'S02', s02seed.seedThrough));
  const fy2627Realised = r2(s01.net + s02.net);
  const lastCapture = [s01.lastCapture, s02.lastCapture].filter(Boolean).sort().pop() || null;
  return {
    ...seedFY,
    s01: { ...seedFY.s01, fy2627: s01 },
    s02: { ...seedFY.s02, fy2627: s02 },
    cf: { ...seedFY.cf, fy2627Realised },
    _autoDriven: s01.auto || s02.auto,
    _lastCapture: lastCapture,
  };
}
