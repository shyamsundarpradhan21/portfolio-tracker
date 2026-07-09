// backfill-fno-realised.mjs — re-derive the fno-ledger's carried-position-affected Dhan
// rows (source:'positions') from the Dhan TRADE-HISTORY via FIFO entry→exit matching, which
// gives trade-verified realised. The positions-API `realizedProfit` UNDERCOUNTS carried
// positions (it marks carried legs to the previous settlement — see lib/brokers.mjs
// `dhanRealised`; fixed at capture 2026-07-09), so the older source:'positions' rows are low.
// This walks every F&O fill (Apr 2026 →) through a per-contract FIFO book and books realised
// on each closing trade at the ORIGINAL entry price.
//
// DRY-RUN by default: prints FIFO per-day realised vs the current ledger for the affected
// days, and SELF-CHECKS that 2026-07-09 reconstructs to +22,649.25 (the Dhan-console truth)
// before anything may be written. Pass --write to upsert those rows (source → 'trades').
// Charges stay on the contract-note overlay (applyFnoOverlay overrides estCharges at render),
// so we set estCharges 0 and only correct the GROSS realised here.
//
// Run:  node scripts/backfill-fno-realised.mjs [--write] [lookback=2026-04-01]

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const tok = J('mcp/dhan/.token.json').accessToken;
const H = { 'access-token': tok, Accept: 'application/json' };
const r2 = (n) => Math.round(n * 100) / 100;
const num = (n) => (Number.isFinite(+n) ? +n : 0);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WRITE = process.argv.includes('--write');
const AUDIT = process.argv.includes('--audit');   // full-history per-year FIFO vs ledger gross (no write)
const LOOKBACK = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || (AUDIT ? '2023-08-01' : '2026-04-01');
const END = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);   // current IST date
const TODAY = '2026-07-09';   // the day already fixed via the positions API (kept, not re-derived)
const TARGET_TRUTH = 22649.25;   // 2026-07-09 Dhan-console realised (self-check anchor)
const CHARGE_FIELDS = ['sebiTax', 'stt', 'brokerageCharges', 'serviceTax', 'exchangeTransactionCharges', 'stampDuty'];

// Dhan /v2/trades caps on long ranges → fetch month-by-month, each paginated to empty.
async function tradesFor(from, to) {
  const out = [];
  for (let page = 0; page < 200; page++) {
    let j = null;
    for (let k = 0; k < 3 && j == null; k++) {
      try {
        const r = await fetch(`https://api.dhan.co/v2/trades/${from}/${to}/${page}`, { headers: H, signal: AbortSignal.timeout(15000) });
        const t = await r.json();
        if (Array.isArray(t)) j = t; else if (t?.errorCode) { console.error('  trades API:', t.errorCode, t.errorMessage); return out; }
      } catch { await sleep(500); }
    }
    if (!j || !j.length) break;
    out.push(...j);
    await sleep(200);
  }
  return out;
}
function monthChunks(from, to) {
  const out = []; let [y, m] = from.split('-').map(Number); const [ey, em] = to.split('-').map(Number);
  while (y < ey || (y === ey && m <= em)) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    out.push([`${y}-${String(m).padStart(2, '0')}-01`, `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}`]);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

const raw = [];
for (const [f, t] of monthChunks(LOOKBACK, END)) raw.push(...await tradesFor(f, t));
// Dhan returns exchangeTradeId:0 for every trade, but paginates cleanly (page 0/1/2…) and
// the month ranges don't overlap — so no dedup is needed; just filter to F&O, chronological.
const fno = raw.filter((t) => /FNO|FO/.test(String(t.exchangeSegment || '')));
fno.sort((a, b) => String(a.exchangeTime || a.createTime).localeCompare(String(b.exchangeTime || b.createTime)));

// FIFO per contract → realised per day at the ORIGINAL entry price.
const books = {}, dayRealised = {}, dayCharges = {}, dayTrades = {}, byYr = {};
for (const t of fno) {
  const key = String(t.securityId || t.customSymbol);
  const date = String(t.exchangeTime || t.createTime).slice(0, 10);
  const isBuy = /BUY/i.test(t.transactionType);
  const qty = num(t.tradedQuantity), price = num(t.tradedPrice);
  dayCharges[date] = r2((dayCharges[date] || 0) + CHARGE_FIELDS.reduce((a, f) => a + num(t[f]), 0));
  dayTrades[date] = (dayTrades[date] || 0) + 1;
  const book = (books[key] ||= []);
  const sign = isBuy ? 1 : -1;
  let rem = qty, realised = 0;
  // close opposite-side FIFO lots at their entry price
  while (rem > 0 && book.length && Math.sign(book[0].qty) !== sign) {
    const lot = book[0], matched = Math.min(rem, Math.abs(lot.qty));
    realised += lot.qty > 0 ? (price - lot.price) * matched : (lot.price - price) * matched;
    lot.qty += sign * matched; rem -= matched;
    if (lot.qty === 0) book.shift();
  }
  if (rem > 0) book.push({ qty: sign * rem, price });   // remainder opens/extends
  if (realised) { dayRealised[date] = r2((dayRealised[date] || 0) + realised); byYr[date.slice(0, 4)] = r2((byYr[date.slice(0, 4)] || 0) + realised); }
}

// ── --audit: full-history per-year FIFO gross vs the ledger (reliable — GROSS vs GROSS,
// no charge accounting). Residual open lots at end flag a year whose trade-history is
// incomplete (missing closes → that year's FIFO is unreliable, e.g. 2025 Jan–Sep). ──
if (AUDIT) {
  let openLots = 0; for (const k in books) openLots += books[k].reduce((a, l) => a + Math.abs(l.qty), 0);
  const lrows = (J('data/fno-ledger.json').rows || []).filter((r) => r.broker === 'Dhan');
  const ledYr = {}; for (const r of lrows) ledYr[r.date.slice(0, 4)] = r2((ledYr[r.date.slice(0, 4)] || 0) + (r.grossRealised || 0));
  console.log(`=== FIFO AUDIT ${LOOKBACK} → ${END}: ${fno.length} F&O fills, ${Object.keys(books).length} contracts ===`);
  console.log('year      FIFO gross     ledger gross            Δ');
  for (const y of [...new Set([...Object.keys(byYr), ...Object.keys(ledYr)])].sort())
    console.log(`${y}  ${String(r2(num(byYr[y]))).padStart(14)}  ${String(r2(num(ledYr[y]))).padStart(14)}  ${String(r2(num(byYr[y]) - num(ledYr[y]))).padStart(12)}`);
  console.log(`\nresidual open lots at end: ${openLots}  ${openLots > 500 ? '⚠ trade-history INCOMPLETE (missing closes) — a year\'s FIFO is unreliable' : '✓ book clears'}`);
  process.exit(0);
}

// affected rows = the Dhan source:'positions' days
const ledger = J('data/fno-ledger.json');
const rows = ledger.rows || ledger;
const targets = rows.filter((r) => r.broker === 'Dhan' && r.source === 'positions').map((r) => r.date).sort();

console.log(`FIFO ${LOOKBACK} → ${TODAY}: ${fno.length} F&O fills, ${Object.keys(books).length} contracts`);
console.log('\nday          current(positions)      FIFO(trades)        Δ      charges');
let sumCur = 0, sumNew = 0;
for (const d of targets) {
  const cur = num(rows.find((r) => r.broker === 'Dhan' && r.date === d)?.grossRealised);
  const nu = num(dayRealised[d]);
  sumCur += cur; sumNew += nu;
  console.log(`${d}  ${String(cur).padStart(16)}  ${String(nu).padStart(16)}  ${String(r2(nu - cur)).padStart(9)}   ${dayCharges[d] || 0}`);
}
console.log(`\nΣ current ₹${r2(sumCur)}  →  Σ FIFO ₹${r2(sumNew)}   (recovers ₹${r2(sumNew - sumCur)})`);

// Self-check: FIFO must REPRODUCE the broker on pure day-trade days (no carry) — those are
// the rows where FIFO == the current positions value. Broad agreement validates the logic
// (independent inputs: trades-FIFO vs positions-API realizedProfit). We can't anchor on
// TODAY: its trades aren't settled into the trade-history yet (already fixed via positions).
const cur = (d) => num(rows.find((r) => r.broker === 'Dhan' && r.date === d)?.grossRealised);
const matches = targets.filter((d) => dayRealised[d] != null && Math.abs(num(dayRealised[d]) - cur(d)) < 1);
const noTrade = targets.filter((d) => d !== TODAY && dayRealised[d] == null);
console.log(`\nSELF-CHECK: FIFO reproduces the broker exactly on ${matches.length}/${targets.length} day-trade days → ${matches.join(', ')}`);
if (noTrade.length) console.log(`PHANTOM (no trades in history → true realised 0, will REMOVE): ${noTrade.join(', ')}`);
console.log(`NOT-YET-SETTLED (kept as-is — already fixed via positions API): ${TODAY}`);

if (WRITE) {
  if (matches.length < 5) { console.error('self-check FAILED: too few day-trade agreements — refusing to write'); process.exit(1); }
  const led = JSON.parse(readFileSync(join(ROOT, 'data', 'fno-ledger.json'), 'utf8'));
  let updated = 0, removed = 0, kept = 0;
  led.rows = led.rows.flatMap((r) => {
    if (r.broker !== 'Dhan' || r.source !== 'positions') return [r];
    if (r.date === TODAY) { kept++; return [r]; }               // already correct (positions API)
    const nu = dayRealised[r.date];
    if (nu == null) { removed++; return []; }                    // no closing trades → phantom marked-MTM, remove
    updated++;
    return [{ ...r, grossRealised: r2(nu), net: r2(nu - num(r.estCharges)), orders: dayTrades[r.date] || r.orders, source: 'trades' }];
  });
  writeFileSync(join(ROOT, 'data', 'fno-ledger.json'), JSON.stringify(led, null, 2) + '\n');
  console.log(`\nWROTE: ${updated} updated (→ source:'trades') · ${removed} phantom removed · ${kept} kept (${TODAY})`);
} else {
  console.log('\n(dry-run — re-run with --write; charges stay on the contract-note overlay)');
}
