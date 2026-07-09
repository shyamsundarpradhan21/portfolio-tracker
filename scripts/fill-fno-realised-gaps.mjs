// Fill POST-REPORT gaps in the Dhan F&O realised ledger. The tax-P&L 'report' rows are
// authoritative but only cover up to the report's generation date; the live daily capture
// (source:'positions'/'trades') then takes over. Days that fell BETWEEN the two — captured by
// neither — leave holes in data/fno-ledger.json (e.g. 2026-06-22/06-23, which had real F&O
// trades but no row, dropping ~₹19.4k of realised). This re-derives realised for every recent
// Dhan F&O trade-day via FIFO over the trade-history (complete for recent dates) and ADDS only
// the days that are MISSING from the ledger — it never touches an existing row (report/trades/
// positions all win). Charges stay on the contract-note overlay (estCharges 0 here).
//
// DRY-RUN by default. Self-check: FIFO must reproduce the ledger EXACTLY on the overlapping
// 'trades' days (independent inputs) before any write is allowed. Pass --write to upsert.
//   node scripts/fill-fno-realised-gaps.mjs [--write] [lookback=2026-04-01]

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appendLedger } from './lib/fno-ledger.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => JSON.parse(readFileSync(join(ROOT, p), 'utf8'));
const tok = J('mcp/dhan/.token.json').accessToken;
const H = { 'access-token': tok, Accept: 'application/json' };
const num = (n) => (Number.isFinite(+n) ? +n : 0);
const r2 = (n) => Math.round(n * 100) / 100;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const WRITE = process.argv.includes('--write');
const LOOKBACK = process.argv.find((a) => /^\d{4}-\d{2}-\d{2}$/.test(a)) || '2026-04-01';
const END = new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);   // current IST date
const TODAY = END;   // today is owned by the live positions capture — never gap-filled

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
    out.push(...j); await sleep(200);
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
const fno = raw.filter((t) => /FNO|FO/.test(String(t.exchangeSegment || '')));
fno.sort((a, b) => String(a.exchangeTime || a.createTime).localeCompare(String(b.exchangeTime || b.createTime)));

// FIFO per contract → realised per day at the ORIGINAL entry price
const books = {}, dayReal = {}, dayTrades = {};
for (const t of fno) {
  const key = String(t.securityId || t.customSymbol);
  const date = String(t.exchangeTime || t.createTime).slice(0, 10);
  const isBuy = /BUY/i.test(t.transactionType);
  const qty = num(t.tradedQuantity), price = num(t.tradedPrice), sign = isBuy ? 1 : -1;
  dayTrades[date] = (dayTrades[date] || 0) + 1;
  const book = (books[key] ||= []); let rem = qty, rl = 0;
  while (rem > 0 && book.length && Math.sign(book[0].qty) !== sign) {
    const lot = book[0], mm = Math.min(rem, Math.abs(lot.qty));
    rl += lot.qty > 0 ? (price - lot.price) * mm : (lot.price - price) * mm;
    lot.qty += sign * mm; rem -= mm; if (lot.qty === 0) book.shift();
  }
  if (rem > 0) book.push({ qty: sign * rem, price });
  if (rl) dayReal[date] = r2((dayReal[date] || 0) + rl);
}

const ledger = J('data/fno-ledger.json');
const dhanRows = (ledger.rows || []).filter((r) => r.broker === 'Dhan');
const have = new Map(dhanRows.map((r) => [r.date, r]));
const sleeve = dhanRows.find((r) => r.sleeve)?.sleeve || 'S01';

// Self-check: FIFO must reproduce the existing 'trades' rows EXACTLY (independent inputs).
const overlap = dhanRows.filter((r) => r.source === 'trades' && dayReal[r.date] != null);
const mism = overlap.filter((r) => Math.abs(num(r.grossRealised) - num(dayReal[r.date])) > 1);
console.log(`FIFO ${LOOKBACK}→${END}: ${fno.length} F&O fills; self-check reproduces ${overlap.length - mism.length}/${overlap.length} existing 'trades' rows`);
if (mism.length) { console.log('  MISMATCH on:', mism.map((r) => `${r.date} led=${r.grossRealised} fifo=${dayReal[r.date]}`).join(' | ')); }

// Gaps = F&O trade-days with realised but NO ledger row (excluding today, owned by live capture)
const gaps = Object.keys(dayReal).filter((d) => d !== TODAY && !have.has(d)).sort();
console.log(`\nMISSING F&O trade-days (realised, no ledger row):`);
let sum = 0;
const addRows = gaps.map((d) => {
  sum += dayReal[d];
  console.log(`  ${d}  gross=${String(r2(dayReal[d])).padStart(10)}  trades=${dayTrades[d]}`);
  return { date: d, broker: 'Dhan', sleeve, grossRealised: r2(dayReal[d]), estCharges: 0, turnover: 0, orders: dayTrades[d], source: 'trades' };
});
console.log(`  ── ${gaps.length} day(s), Σ gross ₹${r2(sum)} (charges via contract-note overlay) ──`);

if (WRITE) {
  if (mism.length) { console.error('\nself-check FAILED — refusing to write'); process.exit(1); }
  const { added, updated } = appendLedger(addRows);
  console.log(`\nWROTE: ${added} added, ${updated} updated → data/fno-ledger.json`);
} else {
  console.log('\n(dry-run — re-run with --write)');
}
