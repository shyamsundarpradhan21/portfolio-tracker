// Daily per-sleeve GROWTH snapshot — the resilient end-of-day fallback the app
// reads when no intraday tape exists for a day (the capture host was off, or a
// slow sleeve like MF/CMPF that never had an intraday tape). Reads KV growth:<date>
// (republished by scripts/snapshot-growth.mjs), falling back to the committed
// archive (data/growth.json) for older days or when KV is unconfigured. Private
// aggregate (net ₹ per sleeve) but kept force-dynamic + no-store like the other
// private-data routes so nothing private ships in the client bundle.

import growthArchive from '../../../data/growth.json';
import indianExits from '../../../data/indian_exits.json';
import niftyOhlc from '../../../data/nifty-ohlc.json';
import { loadPortfolio } from '../../lib/serverPortfolio';
import { buildDepositLedger } from '../../lib/deposits';
import { fetchYahooSeriesMany } from '../../lib/yahooHistory';

export const dynamic = 'force-dynamic';

const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function fromKV(date) {
  const creds = kvCreds();
  if (!creds) return null;
  try {
    const r = await fetch(creds.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', `growth:${date}`]),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    return j?.result ? JSON.parse(j.result) : null;
  } catch { return null; }
}

// The last N IST dates, oldest first — the window the growth dashboard charts.
function lastNDates(n) {
  const out = [];
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  for (let i = 0; i < n; i++) {
    const d = new Date(ist);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

// One MGET for the whole window (recent days live in KV; older fall back to the archive).
async function fromKVMany(dates) {
  const creds = kvCreds();
  if (!creds || !dates.length) return {};
  try {
    const r = await fetch(creds.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['MGET', ...dates.map((d) => `growth:${d}`)]),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const vals = (await r.json())?.result || [];
    const out = {};
    dates.forEach((d, i) => { if (vals[i]) { try { out[d] = JSON.parse(vals[i]); } catch { /* skip */ } } });
    return out;
  } catch { return {}; }
}

// ── Growth view (?view=growth) ───────────────────────────────────────────────
// A ₹ curve of money MADE — cumulative daily P&L of the INVESTMENT sleeves (CMPF/pension
// excluded), re-baselined to 0 per window — overlaid with a same-dated-rupees benchmark
// counterfactual in ₹. The own line reads the resilient growth:<date> archive (deposit-free
// by construction, ~1y deep); the benchmark lifts the unit-replication core of calc.js
// benchCounterfactual, extended to a per-date ₹ series. ALL deposit math is server-side —
// the private ledger never reaches the client.

const OWNER = ((process.env.DASHBOARD_OWNER || 'primary').replace(/[^a-z0-9_-]/gi, '')) || 'primary';
// Public index symbols (same set the Performance curve compares against). Not private.
const BENCHMARKS = [
  { key: 'nifty', sym: '^NSEI' }, { key: 'nasdaq', sym: '^IXIC' }, { key: 'china', sym: '000300.SS' },
  { key: 'germany', sym: '^GDAXI' }, { key: 'uk', sym: '^FTSE' }, { key: 'crypto', sym: 'BTC-USD' }, { key: 'gold', sym: 'GC=F' },
];
// Own line sums these sleeves' daily net; CMPF (pension) is EXCLUDED — its accrual isn't
// investment performance and its corpus would swamp the curve (see the Perf-curve note).
const INVEST_SLEEVES = ['eq', 'us', 'fd', 'mf'];
const GROWTH_DAYS = { '1M': 30, '3M': 91, '6M': 182, '1Y': 365 };
const istToday = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);

async function fetchSnapshots() {
  const creds = kvCreds();
  if (!creds) return [];
  try {
    const { createClient } = await import('@vercel/kv');
    const arr = await createClient(creds).get(`snapshots:nw:${OWNER}`);
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// NIFTY 50 intraday 1-min tape for `date` — read DIRECTLY from KV (intraday:nifty:<date>),
// falling back to the committed archive. NOT a self-fetch to /api/intraday: a server-side
// fetch to the deployment's own URL carries no auth cookie, so Deployment Protection blocks
// it at the edge (the 1D bench would silently vanish on a protected deployment).
async function niftyIntradayTape(date) {
  const creds = kvCreds();
  if (creds) {
    try {
      const r = await fetch(creds.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', `intraday:nifty:${date}`]),
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      });
      const j = await r.json();
      const v = j?.result ? JSON.parse(j.result) : null;
      const tape = Array.isArray(v) ? v : (Array.isArray(v?.tape) ? v.tape : null);
      if (tape) return tape;
    } catch { /* fall back to archive */ }
  }
  return niftyOhlc?.days?.[date] || [];
}

// The window's growth:<date> records (recent days from KV, older from the committed
// archive) — the same resilient tier the cumulative-accrual dashboard reads.
async function fetchGrowthRecords(range) {
  const records = {};
  if (range === 'max') {
    Object.assign(records, growthArchive?.days || {});
    const recent = lastNDates(45);
    const kv = await fromKVMany(recent);
    for (const d of recent) if (kv[d]) records[d] = kv[d];
  } else {
    const dates = lastNDates(GROWTH_DAYS[range] || 30);
    const kv = await fromKVMany(dates);
    for (const d of dates) { const rec = kv[d] || growthArchive?.days?.[d] || null; if (rec) records[d] = rec; }
  }
  return records;
}

// Investable book value of a snapshot (INVESTMENT sleeves' sl.v) — used only to scale the
// 1D Nifty counterfactual. EXCLUDES `pf` (CMPF/pension) and the loan net worth folds in, so
// 1D shares the deposit-ledger basis the 1M+ windows use. Returns 0 (→ honest blank) when
// no per-sleeve basis exists, rather than falling back to CMPF/loan-laden net worth.
function investableBase(snap) {
  if (snap && snap.sl && typeof snap.sl === 'object') {
    let v = 0;
    for (const k in snap.sl) { if (k === 'pf') continue; const e = snap.sl[k]; if (e && Number.isFinite(e.v)) v += e.v; }
    if (v > 0) return v;
  }
  return 0;
}

// binary-search the index of the last element whose .date <= iso (arr sorted asc by .date)
const lastLE = (arr, iso) => {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].date <= iso) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
};

// Same-dated-rupees counterfactual as a per-date ₹ series: replicate each deposit into the
// benchmark at its on-or-before close (units += amt/level), then value the holding at any
// later date (units × level − deposits). NOTE a basis mismatch with the own line: this
// COMPOUNDS (units ride price) whereas the own line is summed daily P&L — over long windows
// the two treatments diverge slightly. A flat-fx assumption makes the ₹ value a pure
// price-return ratio, so foreign indices need no FX series (matches the Perf-curve
// footnote). Returns null when the closes can't price the earliest deposit.
function benchCfFn(closes, ledger) {
  const cl = (closes || []).filter((c) => c && c.close > 0).map((c) => ({ date: c.date, close: c.close })).sort((a, b) => (a.date < b.date ? -1 : 1));
  if (cl.length < 8 || !ledger.length) return null;
  if (cl[0].date > ledger[0].date) return null;                  // can't price the earliest deposit
  const level = (iso) => { const i = lastLE(cl, iso); return i < 0 ? cl[0].close : cl[i].close; };
  const cumU = [], cumD = []; let u = 0, dp = 0;
  for (const e of ledger) { const lv = level(e.date); if (!(lv > 0)) return null; u += e.amt / lv; dp += e.amt; cumU.push(u); cumD.push(dp); }
  return (iso) => { const i = lastLE(ledger, iso); if (i < 0) return 0; return cumU[i] * level(iso) - cumD[i]; };
}

export async function GET(req) {
  const params = new URL(req.url).searchParams;

  // ── Growth view: money made (deposits stripped) + ₹ benchmark counterfactual ──
  if (params.get('view') === 'growth') {
    const range = ['1D', '1M', '3M', '6M', '1Y', 'max'].includes(params.get('range')) ? params.get('range') : 'max';
    const fx = Math.max(1, parseFloat(params.get('fx')) || 88);
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    // 1D — own line is client-supplied (live P&L); bench is Nifty intraday, scaled to ₹ on
    // the investable book base. Other benchmarks have no intraday tape → omitted on 1D.
    if (range === '1D') {
      let points = [], available = [];
      try {
        const [tape, snaps] = await Promise.all([
          niftyIntradayTape(istToday()),
          fetchSnapshots(),
        ]);
        const base = investableBase(snaps[snaps.length - 1] || {});
        const open = tape.length ? (Number.isFinite(tape[0].o) ? tape[0].o : tape[0].c) : null;
        if (open > 0 && base > 0) {
          points = tape.filter((cd) => Number.isFinite(cd.c)).map((cd) => ({ d: cd.t, growth_inr: null, bench: { nifty: Math.round(base * (cd.c / open - 1)) } }));
          if (points.length) available = ['nifty'];
        }
      } catch { /* honest blank */ }
      return json({ view: 'growth', range, points, available });
    }

    // 1M / 6M / 1Y / max — own line = cumulative INVESTMENT-sleeve daily P&L from the growth
    // archive (deposit-free, CMPF-excluded); bench = same-dated-rupees counterfactual.
    const records = await fetchGrowthRecords(range);
    const dates = Object.keys(records).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    if (dates.length < 2) return json({ view: 'growth', range, points: [], available: [] });

    // own line: cumulative daily net across INVEST_SLEEVES, re-baselined to 0 at the window's
    // first day. This is SUMMED daily P&L — it does NOT compound, so on long windows (1Y/Max)
    // it drifts slightly below the true (compounded) figure and uses a different basis than
    // the benchmark's unit-replication line. Acceptable for now; if it ever needs to match
    // exactly, reconstruct from NW deltas instead.
    const ownByDate = {}; let cum = 0;
    dates.forEach((d, i) => {
      if (i > 0) { const r = records[d]; for (const k of INVEST_SLEEVES) cum += (r[k]?.net || 0); }
      ownByDate[d] = Math.round(cum);
    });

    // whole-book dated deposit ledger (server-side only) → benchmark counterfactual fns
    const now = new Date();
    const priv = await loadPortfolio();
    const ledger = priv
      ? buildDepositLedger({ TRANSACTIONS: priv.TRANSACTIONS, MF_CASHFLOWS: priv.MF_CASHFLOWS, US_CASHFLOWS: priv.US_CASHFLOWS, FDS: priv.FDS, indianExits }, fx, now)
      : [];
    let series = {};
    if (ledger.length) {
      // fetch enough weekly history to cover the earliest deposit (5y for max, else 2y;
      // bumped to 5y/max if inception predates it). One fetch, evaluated per window date.
      const yearsBack = (now.getTime() - new Date(ledger[0].date + 'T00:00:00Z').getTime()) / (365.25 * 864e5);
      const yRange = range === 'max' ? (yearsBack > 5 ? 'max' : '5y') : (yearsBack > 2 ? '5y' : '2y');
      try { series = await fetchYahooSeriesMany(BENCHMARKS.map((b) => b.sym), yRange); }
      catch { series = {}; }
    }
    const benchFns = {};
    for (const b of BENCHMARKS) { const fn = benchCfFn(series[b.sym]?.closes, ledger); if (fn) benchFns[b.key] = fn; }

    // both lines re-baseline to 0 at the window's first day
    const winStart = dates[0];
    const benchBase0 = {}; for (const k in benchFns) benchBase0[k] = benchFns[k](winStart);
    const points = dates.map((d) => {
      const bench = {};
      for (const k in benchFns) bench[k] = Math.round(benchFns[k](d) - benchBase0[k]);
      return { d, growth_inr: ownByDate[d], bench };
    });
    return json({ view: 'growth', range, points, available: Object.keys(benchFns) });
  }

  const date = params.get('date');
  const daysParam = params.get('days') || '';
  const isMax = daysParam === 'max';
  const days = Math.min(370, Math.max(0, parseInt(daysParam, 10) || 0));

  // Range mode (?days=N) or Max (?days=max → ALL committed history + the recent KV
  // window). Range MGETs the window's dates; Max takes the whole archive and overlays
  // the recent KV (avoids a huge MGET over years of keys).
  if (isMax || days > 0) {
    const records = {};
    if (isMax) {
      Object.assign(records, growthArchive?.days || {});
      const recent = lastNDates(45);
      const kv = await fromKVMany(recent);
      for (const d of recent) if (kv[d]) records[d] = kv[d];
    } else {
      const dates = lastNDates(days);
      const kv = await fromKVMany(dates);
      for (const d of dates) { const rec = kv[d] || growthArchive?.days?.[d] || null; if (rec) records[d] = rec; }
    }
    return new Response(JSON.stringify({ days: isMax ? 'max' : days, records, source: 'kv+archive' }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  // Single-date mode (existing).
  if (!isoDate(date)) {
    return Response.json({ error: 'date must be YYYY-MM-DD, or pass ?days=N' }, { status: 400 });
  }
  const live = await fromKV(date);
  const record = live || growthArchive?.days?.[date] || null;
  return new Response(JSON.stringify({ date, record, source: live ? 'kv' : 'archive' }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
