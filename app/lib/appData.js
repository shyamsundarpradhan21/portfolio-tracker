'use client';
// Committed app JSONs pulled out of the CLIENT bundle. They stay committed (the
// daily sync pipeline writes broker-state/fno-ledger; the rest are curated), but
// instead of being statically imported into the client they are server-imported
// in /api/portfolio and served at runtime, then hydrated here in place before the
// dashboard mounts — so consumers read filled values. Mirrors portfolio.js.
//
// Use ONLY inside render/call paths that run after the gate (Dashboard), never at
// module-eval — the containers are empty until hydrateAppData() runs.
export const APP = {
  fySeed: {},
  fnoLedger: { rows: [] },
  fnoIntraday: { days: {} },   // intraday F&O P&L tape per day (data/fno-intraday.json)
  eqIntraday: { days: {} },    // intraday equity day-change tape (data/eq-intraday.json)
  volPnl: [],
  brokerState: {},
  usTrades: [],
  indianExits: [],
  snapSleeves: {},
  snapMd: '',
  fnoRealized: null,   // per-FY × broker F&O realized + all-time (data/broker-tax.json)
};

export function hydrateAppData(d) {
  if (d) Object.assign(APP, d);
}
