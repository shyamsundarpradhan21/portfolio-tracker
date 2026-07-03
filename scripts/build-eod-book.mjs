// DORMANT EOD-book builder — Sub-step A (design: tasks/eod-book-design.md).
//
// Writes data/eod-book.json: the durable, reconciled daily anchor — per-sleeve EOD
// close values + composition + the day's contract-note reconcile fold (charges/trades,
// deferred, broker-vs-note drift). NOTHING reads this artifact yet (no wiring — page.js
// and serverPortfolio are untouched). It is inert.
//
// Run ONCE, manually:  node scripts/build-eod-book.mjs
// Optional: node scripts/build-eod-book.mjs 2026-07-03   (build for a specific IST date)
//
// Reuses the app's valuation logic: compound (fd.mjs), cmpfCorpus (cmpf.mjs),
// resolveCode/navHistory (mf.mjs); applyCorpActions / loanOutstanding / the Yahoo
// close fetch are replicated inline (their app-side source is app/lib/calc.js,
// app/portfolio.js, app/api/quotes) to keep this a self-contained node script.
// READ-ONLY of every source; the only write is data/eod-book.json. Aggregates only.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { compound } from './lib/fd.mjs';
import { cmpfCorpus } from './lib/cmpf.mjs';
import { resolveCode, navHistory } from './lib/mf.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const r2 = (n) => Math.round(n * 100) / 100;
const YEAR = 365.25 * 86400000;
const J = (p) => { try { return JSON.parse(readFileSync(join(ROOT, p), 'utf8')); } catch { return null; } };

// ── KV (best-effort; falls back to committed/gitignored files) ─────────────────
const env = {};
try { for (const l of readFileSync(join(ROOT, 'mcp', '.kv.env'), 'utf8').split('\n')) { const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(l); if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, '').trim(); } } catch {}
async function kv(cmd) {
  if (!env.KV_REST_API_URL) return null;
  try { const r = await fetch(env.KV_REST_API_URL, { method: 'POST', headers: { Authorization: `Bearer ${env.KV_REST_API_TOKEN}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd), signal: AbortSignal.timeout(8000) }); return (await r.json()).result; } catch { return null; }
}

// ── Yahoo v8 close (same endpoint /api/quotes + equity.mjs use) ────────────────
const YH = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
async function yahooClose(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1d&includePrePost=false`;
  for (const host of YH) {
    try {
      const r = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!r.ok) continue;
      const meta = (await r.json())?.chart?.result?.[0]?.meta;
      if (typeof meta?.regularMarketPrice === 'number') return meta.regularMarketPrice;   // post-close = the close
    } catch { /* next host */ }
  }
  return null;
}
async function priceMap(syms) {
  const out = {}; const uniq = [...new Set(syms.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 10) await Promise.all(uniq.slice(i, i + 10).map(async (s) => { out[s] = await yahooClose(s); }));
  return out;
}

// ── inline replicas of app-side pure fns ──────────────────────────────────────
function applyCorpActions(holdings, today, CA) {   // app/lib/calc.js:304
  return (holdings || []).map((h) => {
    let qty = h.qty, cost = h.cost;
    for (const a of CA || []) if (a.type === 'bonus' && a.sym === h.sym && a.ex <= today) {
      const [num, den] = a.ratio.split(':').map(Number); const bonus = Math.floor((qty * num) / den); const nq = qty + bonus;
      if (nq > 0) { cost = (qty * cost) / nq; qty = nq; }
    }
    return { ...h, qty, cost };
  });
}
const fdValueOn = (f, d) => {   // scripts/lib/fd.mjs fdValueOn (internal)
  const yrs = Math.min((new Date(d) - new Date(f.open)) / YEAR, (new Date(f.matures) - new Date(f.open)) / YEAR);
  return f.rate != null ? compound(f.principal, f.rate, yrs) : f.principal;
};
function loanOutstanding(LOAN, d) {   // app/portfolio.js:90
  if (!LOAN?.open || d < LOAN.open) return 0;
  let bal = null, lastD = null;
  for (const [bd, bv] of LOAN.balances || []) { if (bd <= d) { bal = bv; lastD = bd; } else break; }
  if (bal == null) return 0;
  let cur = new Date(lastD + 'T00:00:00Z'); const end = new Date(d + 'T00:00:00Z'); let accr = 0;
  while (cur < end && bal > 0) {
    cur = new Date(cur.getTime() + 86400000); accr += (bal * LOAN.rate) / 36500;
    if (cur.getUTCDate() === 5) bal = Math.max(0, bal - LOAN.emi);
    const next = new Date(cur.getTime() + 86400000);
    if (next.getUTCMonth() !== cur.getUTCMonth()) { bal += accr; accr = 0; }
  }
  return Math.round(bal);
}

// ── main ──────────────────────────────────────────────────────────────────────
const argDate = process.argv[2];
const today = argDate || new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10);   // IST date
const asOf = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace('Z', '+05:30');
const nf = (s) => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const lead = (s) => nf(String(s || '').toUpperCase().split(/[\s\-/]/)[0]);

const priv = (await kv(['GET', 'portfolio:v1']).then((r) => r ? JSON.parse(r) : null)) || J('data/portfolio.private.json');
const bs = J('data/broker-state.json');
if (!priv) { console.error('no private book (KV portfolio:v1 / file)'); process.exit(1); }

// composition
const heldIndian = applyCorpActions(priv.INDIAN || [], today, priv.CORPORATE_ACTIONS);
const swingRows = (bs?.holdings?.SWING?.rows || []).map((r) => ({ sym: r.sym, ns: (priv.SWING || []).find((s) => s.sym === r.sym)?.ns || `${r.sym}.NS`, qty: r.qty, cost: (priv.SWING || []).find((s) => s.sym === r.sym)?.cost ?? r.avg }));
const us = priv.US || [];

// prices (EOD close)
const prices = await priceMap([...heldIndian.map((h) => h.ns), ...swingRows.map((s) => s.ns), ...us.map((u) => u.sym), 'INR=X']);
const fx = prices['INR=X'] || 88;

const valueSleeve = (rows, symKey, mult = 1) => {
  const out = []; let val = 0, inv = 0, missing = 0;
  for (const h of rows) { const p = prices[h[symKey]]; if (p == null) { missing++; continue; } const v = h.qty * p * mult; val += v; inv += (h.inv ?? h.qty * h.cost); out.push({ sym: h.sym, qty: h.qty, cost: r2(h.cost), close: r2(p), value: r2(v) }); }
  return { rows: out, value: r2(val), inv: r2(inv), missing };
};
const INDIAN = valueSleeve(heldIndian, 'ns');
const SWING = valueSleeve(swingRows, 'ns');
const US = valueSleeve(us.map((u) => ({ ...u, cost: u.cost })), 'sym', fx);

// MF: units × latest AMFI NAV, split by cat (ELSS vs rest). RETRY until live —
// a transient AMFI miss must NOT silently fall back to casNav as if fresh (that
// caused a 3.43% silent skew). If it still fails after retries, TAG it stale/degraded.
const mfRows = { mf: [], elss: [] }; let mfVal = 0, elssVal = 0; let mfResolved = 0, mfNavDate = null; const mfDegraded = [];
async function fetchNavLive(f, tries = 4) {
  for (let i = 0; i < tries; i++) {
    try { const code = await resolveCode(f); if (code) { const h = await navHistory(code); const last = Object.keys(h).sort().pop(); if (last) return { nav: h[last], date: last, live: true }; } } catch {}
  }
  return { nav: f.casNav, date: null, live: false };   // exhausted retries → casNav, but TAGGED (below)
}
await Promise.all((priv.MF_FUNDS || []).map(async (f) => {
  if (!f.units) return;
  const { nav, date, live } = await fetchNavLive(f);
  if (live) { mfResolved++; mfNavDate = mfNavDate && mfNavDate > date ? mfNavDate : date; } else mfDegraded.push(f.id);
  const v = f.units * nav; const bucket = /elss/i.test(f.cat || '') ? 'elss' : 'mf';
  mfRows[bucket].push({ id: f.id, units: f.units, cost: f.cost, nav: r2(nav), value: r2(v), src: live ? 'amfi' : 'casNav', ...(live ? {} : { stale: true, degraded: true }) });
  if (bucket === 'elss') elssVal += v; else mfVal += v;
}));

// FD: Σ fdValueOn(active) ; CMPF corpus ; loan
const fds = (priv.FDS || []).filter((f) => f.status !== 'pipeline');
const fdRows = fds.map((f) => ({ id: f.id, principal: f.principal, rate: f.rate, value: r2(fdValueOn(f, today)), src: 'formula' }));
const fdVal = r2(fdRows.reduce((a, r) => a + r.value, 0));
const pfVal = cmpfCorpus(priv.CMPF_CONTRIBUTIONS, priv.CMPF_RATES, today);
const loan = loanOutstanding(priv.LOAN, today);

// ── reconcile fold: today's notes + broker-vs-note drift (the 3 gaps) ──────────
const idx = (await kv(['SMEMBERS', 'ledger:cn:index'])) || [];
const notes = [];
for (let i = 0; i < idx.length; i += 12) notes.push(...(await Promise.all(idx.slice(i, i + 12).map((n) => kv(['GET', `ledger:cn:${n}`]).then((r) => r ? JSON.parse(r) : null).catch(() => null)))).filter(Boolean));
const todays = notes.filter((n) => n.trade_date === today);
// broker-vs-note drift: reconstruct equity composition from note equity fills, diff vs broker truth
const eqFills = {};
for (const l of notes) for (const f of l.fills || []) if (f.segment === 'cash' || f.segment === 'unknown') (eqFills[l.broker] ||= []).push({ full: nf(f.instrument), lead: lead(f.instrument), q: (f.side === 'BUY' ? 1 : f.side === 'SELL' ? -1 : 0) * Math.abs(+f.qty || 0) });
const noteQty = (broker, sym) => { const S = nf(sym); return (eqFills[broker] || []).filter((f) => f.full.startsWith(S) || (S.startsWith(f.lead) && f.lead.length >= 4)).reduce((a, f) => a + f.q, 0); };
// corp bonus adds floor(base × num/den) — so a captured bonus isn't mistaken for a gap (CUB).
const corpAdd = (sym, base) => (priv.CORPORATE_ACTIONS || []).filter((c) => c.sym === sym && c.type === 'bonus').reduce((a, c) => { const [x, y] = String(c.ratio || '0:1').split(':').map(Number); return a + Math.floor(base * (x / y)); }, 0);
const drift = [];
for (const [rows, broker, sleeve] of [[bs?.holdings?.INDIAN?.rows || [], 'zerodha', 'INDIAN'], [bs?.holdings?.SWING?.rows || [], 'upstox', 'SWING']]) {
  for (const r of rows) { const nq = noteQty(broker, r.sym); const recon = nq + corpAdd(r.sym, nq); const delta = (+r.qty) - recon; if (Math.abs(delta) > 0.5) drift.push({ sleeve, sym: r.sym, brokerQty: +r.qty, noteReconQty: recon, delta, kind: 'un-noted (broker)' }); }
}
const chargesReal = r2(todays.reduce((a, n) => a + Object.values(n.charges || {}).reduce((x, v) => x + (typeof v === 'number' ? v : 0), 0), 0));

// ── assemble + write ───────────────────────────────────────────────────────────
const sleeves = {
  INDIAN: INDIAN.rows, SWING: SWING.rows, US: US.rows,
  MF: mfRows.mf, ELSS: mfRows.elss,
  FD: fdRows, CMPF: [{ value: pfVal, src: 'accrual' }],
};
const assets = r2(INDIAN.value + SWING.value + US.value + mfVal + elssVal + fdVal + pfVal);
const netWorth = r2(assets - loan);
const book = J('data/eod-book.json') || { version: 1, days: {} };
book.days[today] = {
  asOf, fx: r2(fx),
  sleeveValues: { indian: r2(INDIAN.value + SWING.value), swing: SWING.value, indianDelivery: INDIAN.value, us: US.value, mf: r2(mfVal), elss: r2(elssVal), fd: fdVal, pf: pfVal, loan, assets, netWorth },
  sleeves,
  reconcile: {
    notes: todays.map((n) => ({ cn: n.contract_note_no, broker: n.broker, trades: (n.fills || []).length, hasFno: !!n.has_fno })),
    chargesReal, tradesCount: todays.reduce((a, n) => a + (n.fills || []).length, 0),
    unreconciled: [],   // day-specific deferred: tracked in the ingest report; none folded for a manual back-build
    // drift is note-matched (symbol-fuzz) → PROVISIONAL, not authoritative. ISIN follow-up hardens it.
    drift, driftProvisional: true,
  },
  dataQuality: { mfDegraded, equityMissing: INDIAN.missing + SWING.missing + US.missing },
};
writeFileSync(join(ROOT, 'data', 'eod-book.json'), JSON.stringify(book, null, 2));

// Serving copy → KV: the deployed app reads KV, not the gitignored file. The BOOK OF
// RECORD stays the local JSON; KV is only a serving copy (same split as portfolio:v1).
// eod-book:latest = the latest day, self-contained, for the app's close-fallback loader.
// Best-effort; the durable file is already written above regardless.
if (env.KV_REST_API_URL) {
  const latest = { date: today, ...book.days[today] };
  const ok1 = await kv(['SET', 'eod-book:latest', JSON.stringify(latest)]);
  const ok2 = await kv(['SET', `eod-book:${today}`, JSON.stringify(book.days[today])]);
  console.log(`KV serving copy: eod-book:latest ${ok1 ? 'written' : 'FAILED'}, eod-book:${today} ${ok2 ? 'written' : 'FAILED'}`);
}

// ── GATE: per-sleeve reconciliation vs the app's recorded snapshot ─────────────
const snapArr = await kv(['GET', 'snapshots:nw:primary']).then((r) => r ? JSON.parse(r) : null);
const snap = Array.isArray(snapArr) ? snapArr.find((s) => s.d === today) || snapArr[snapArr.length - 1] : null;
console.log(`\n=== eod-book ${today} written (asOf ${asOf}, fx ${r2(fx)}) ===`);
console.log(`sleeves: INDIAN+SWING=${r2(INDIAN.value + SWING.value)} (deliv ${INDIAN.value} + swing ${SWING.value}) · US=${US.value} · MF=${r2(mfVal)} · ELSS=${r2(elssVal)} · FD=${fdVal} · CMPF=${pfVal} · loan=${loan}`);
console.log(`assets=${assets} · netWorth=${netWorth}`);
const mfTotal = (priv.MF_FUNDS || []).filter((f) => f.units).length;
console.log(`MF NAV: ${mfResolved}/${mfTotal} funds live AMFI NAV (asOf ${mfNavDate})${mfDegraded.length ? ` — ${mfDegraded.length} DEGRADED→casNav, TAGGED stale: ${mfDegraded.join(',')}` : ''}`);
console.log(`reconcile: ${todays.length} notes today · ${drift.length} drift holdings (the un-noted gaps)`);
for (const d of drift) console.log(`  drift ${d.sleeve} ${d.sym}: broker ${d.brokerQty} vs note-recon ${d.noteReconQty} → ${d.delta}`);
if (snap) {
  const s = snap.sl; const line = (name, book, ref) => { const d = r2(book - ref); console.log(`  ${name.padEnd(8)} book=${String(Math.round(book)).padStart(9)} snapshot=${String(Math.round(ref)).padStart(9)} Δ=${d} (${ref ? (100 * d / ref).toFixed(2) : '0'}%)`); };
  console.log(`\n=== GATE — book vs app snapshot (snapshots:nw:primary, d=${snap.d}) ===`);
  line('indian', INDIAN.value + SWING.value, s.indian?.v ?? 0);
  line('us', US.value, s.us?.v ?? 0);
  line('mf+elss', mfVal + elssVal, (s.mf?.v ?? 0) + (s.elss?.v ?? 0));
  line('fd', fdVal, s.fd?.v ?? 0);
  line('pf', pfVal, s.pf?.v ?? 0);
  line('assets', assets, snap.assets ?? 0);
  line('netWorth', netWorth, snap.nw ?? 0);
} else console.log('no snapshot to reconcile against');
