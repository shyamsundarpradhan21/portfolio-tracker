// Daily per-sleeve GROWTH snapshot — the resilient end-of-day fallback the app
// reads when no intraday tape exists for a day (the capture host was off, or a
// slow sleeve like MF/CMPF that never had an intraday tape). Reads KV growth:<date>
// (republished by scripts/snapshot-growth.mjs), falling back to the committed
// archive (data/growth.json) for older days or when KV is unconfigured. Private
// aggregate (net ₹ per sleeve) but kept force-dynamic + no-store like the other
// private-data routes so nothing private ships in the client bundle.

import growthArchive from '../../../data/growth.json';
import { loadPortfolio } from '../../lib/serverPortfolio';

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
// A ₹ curve of money MADE (deposits stripped, re-baselined to 0 per window), with a
// same-dated-rupees benchmark counterfactual overlaid in ₹. ALL deposit math is
// server-side — the private ledger never reaches the client. Lifts the unit-replication
// core of calc.js benchCounterfactual, extended to emit a per-date ₹ series.

const OWNER = ((process.env.DASHBOARD_OWNER || 'primary').replace(/[^a-z0-9_-]/gi, '')) || 'primary';
// Public index symbols (same set the Performance curve compares against). Not private.
const BENCHMARKS = [
  { key: 'nifty', sym: '^NSEI' }, { key: 'nasdaq', sym: '^IXIC' }, { key: 'china', sym: '000300.SS' },
  { key: 'germany', sym: '^GDAXI' }, { key: 'uk', sym: '^FTSE' }, { key: 'crypto', sym: 'BTC-USD' }, { key: 'gold', sym: 'GC=F' },
];
const RANGE_DAYS = { '1M': 30, '6M': 182, '1Y': 365, max: null };
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

// Investable book value of a snapshot — the per-sleeve basis sums (sl.v), which exclude
// the loan/CMPF that net worth folds in; falls back to nw when no per-sleeve basis exists.
function investableBase(snap) {
  if (snap && snap.sl && typeof snap.sl === 'object') {
    let v = 0; for (const k in snap.sl) { const e = snap.sl[k]; if (e && Number.isFinite(e.v)) v += e.v; }
    if (v > 0) return v;
  }
  return snap && Number.isFinite(snap.nw) ? snap.nw : 0;
}

// Whole-book dated deposit ledger (₹) from the private object — net capital deployed:
// buys +, redemptions/sells −, US flows × fx. Mirrors deriveProjInputs' signs and the
// fdFlows/fdRedemptions logic, read off the loaded object (the portfolio.js module exports
// are empty server-side). Indian swing exits (appData, not in loadPortfolio) are out of
// scope here — minor net magnitude. Returns [{date, amt}] sorted ascending.
function depositLedger(d, fx, now) {
  const out = [];
  const push = (date, amt) => { if (date && Number.isFinite(amt) && amt !== 0) out.push({ date, amt }); };
  for (const t of (d.TRANSACTIONS || [])) push(t.date, t.invested);
  for (const c of (d.MF_CASHFLOWS || [])) push(c.date, -(c.amount || 0));   // amount<0 = money in
  for (const c of (d.US_CASHFLOWS || [])) push(c.date, (c.invested || 0) * fx);
  for (const f of (d.FDS || [])) {
    if (f.status !== 'pipeline') push(f.open, f.newMoney ?? f.principal);
    if (f.status === 'closed' && f.closedOn) push(f.closedOn, -(f.principal || 0));
    else if (f.status === 'active' && f.matures && new Date(f.matures) <= now) push(f.matures, -(f.principal || 0));
  }
  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}

// binary-search the index of the last element whose .date <= iso (arr sorted asc by .date)
const lastLE = (arr, iso) => {
  let lo = 0, hi = arr.length - 1, ans = -1;
  while (lo <= hi) { const m = (lo + hi) >> 1; if (arr[m].date <= iso) { ans = m; lo = m + 1; } else hi = m - 1; }
  return ans;
};

// Cumulative ₹ deposited up to & including a date (prefix sum over the ledger).
function cumDepositFn(ledger) {
  const pref = []; let s = 0;
  for (const e of ledger) { s += e.amt; pref.push(s); }
  return (iso) => { const i = lastLE(ledger, iso); return i < 0 ? 0 : pref[i]; };
}

// Same-dated-rupees counterfactual as a per-date ₹ series: replicate each deposit into the
// benchmark at its on-or-before close (units += amt/level), then value the holding at any
// later date (units × level − deposits). A flat-fx assumption makes the ₹ value a pure
// price-return ratio, so foreign indices need no FX series (consistent with the Perf-curve
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
    const origin = new URL(req.url).origin;
    const range = ['1D', '1M', '6M', '1Y', 'max'].includes(params.get('range')) ? params.get('range') : 'max';
    const fx = Math.max(1, parseFloat(params.get('fx')) || 88);
    const json = (body) => new Response(JSON.stringify(body), { headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } });

    // 1D — own line is client-supplied (live P&L); bench is Nifty intraday, scaled to ₹ on
    // the investable book base. Other benchmarks have no intraday tape → omitted on 1D.
    if (range === '1D') {
      let points = [], available = [];
      try {
        const [ir, snaps] = await Promise.all([
          fetch(`${origin}/api/intraday?kind=nifty&date=${istToday()}`, { cache: 'no-store', signal: AbortSignal.timeout(6000) }).then((r) => r.json()).catch(() => null),
          fetchSnapshots(),
        ]);
        const tape = Array.isArray(ir?.tape) ? ir.tape : [];
        const base = investableBase(snaps[snaps.length - 1] || {});
        const open = tape.length ? (Number.isFinite(tape[0].o) ? tape[0].o : tape[0].c) : null;
        if (open > 0 && base > 0) {
          points = tape.filter((cd) => Number.isFinite(cd.c)).map((cd) => ({ d: cd.t, growth_inr: null, bench: { nifty: Math.round(base * (cd.c / open - 1)) } }));
          if (points.length) available = ['nifty'];
        }
      } catch { /* honest blank */ }
      return json({ view: 'growth', range, points, available });
    }

    // 1M / 6M / 1Y / max — own line from snapshots, bench counterfactuals from weekly closes
    const snaps = (await fetchSnapshots()).filter((s) => s && s.d && Number.isFinite(s.nw)).sort((a, b) => (a.d < b.d ? -1 : 1));
    if (snaps.length < 2) return json({ view: 'growth', range, points: [], available: [] });

    const now = new Date();
    const priv = await loadPortfolio();
    const ledger = priv ? depositLedger(priv, fx, now) : [];
    // deposits(t): the ledger when available (spec-faithful, shared with the bench), else
    // fall back to the snapshot's own cumulative `invested` so the own line still strips
    // deposits in degraded mode (no private object reachable).
    const snapDates = snaps.map((s) => ({ date: s.d }));
    const depAt = ledger.length ? cumDepositFn(ledger) : (iso) => { const i = lastLE(snapDates, iso); return i < 0 ? 0 : (snaps[i].invested || 0); };

    // window slice + re-baseline point
    const days = RANGE_DAYS[range];
    const lastD = snaps[snaps.length - 1].d;
    const cutoffMs = days != null ? new Date(lastD + 'T00:00:00Z').getTime() - days * 864e5 : -Infinity;
    let win = snaps.filter((s) => new Date(s.d + 'T00:00:00Z').getTime() >= cutoffMs);
    if (win.length < 2) win = snaps.slice(-2);
    const w0 = win[0];

    // benchmark closes — fetch enough weekly history to cover the earliest deposit (5y for
    // max, else 2y; bumped if inception predates it). One fetch, sliced per window.
    const earliest = ledger.length ? ledger[0].date : w0.d;
    const yearsBack = (now.getTime() - new Date(earliest + 'T00:00:00Z').getTime()) / (365.25 * 864e5);
    const yRange = range === 'max' ? (yearsBack > 5 ? 'max' : '5y') : (yearsBack > 2 ? '5y' : '2y');
    let series = {};
    try {
      const hr = await fetch(`${origin}/api/history?symbols=${encodeURIComponent(BENCHMARKS.map((b) => b.sym).join(','))}&range=${yRange}`, { cache: 'no-store', signal: AbortSignal.timeout(12000) }).then((r) => r.json()).catch(() => null);
      series = hr?.series || {};
    } catch { series = {}; }

    const benchFns = {};
    for (const b of BENCHMARKS) {
      const fn = ledger.length ? benchCfFn(series[b.sym]?.closes, ledger) : null;
      if (fn) benchFns[b.key] = fn;
    }
    const dep0 = depAt(w0.d);
    const benchBase0 = {}; for (const k in benchFns) benchBase0[k] = benchFns[k](w0.d);

    const points = win.map((s) => {
      const own = (s.nw - w0.nw) - (depAt(s.d) - dep0);
      const bench = {};
      for (const k in benchFns) bench[k] = Math.round(benchFns[k](s.d) - benchBase0[k]);
      return { d: s.d, growth_inr: Math.round(own), bench };
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
