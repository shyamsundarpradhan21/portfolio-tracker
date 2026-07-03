// Trading-business contributions/drawings ledger — Sub-step 3a (design:
// tasks/business-entity-model.md). Pulls broker fund-transfer events, classifies them
// on the LIVE-VERIFIED taxonomy, writes data/trading-ledger.json (gitignored, private),
// and runs the reconciliation tie-out as a DRIFT FLAG.
//
// SEMI-AUTO: Dhan fund-ins/outs auto-populate; the owner-vs-client tag is MANUAL
// (data/trading-ledger-tags.json: { "<ref>": "own"|"client" }). Upstox (3b) is added
// once its payin/payout fields are live-verified in-window — NOT trusted from the doc.
//
// DORMANT: nothing reads the artifact yet (the TRADING_EQUITY line is 3c).
// Run: node scripts/build-trading-ledger.mjs        (reads mcp/dhan/.token.json)

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const J = (p) => { try { return JSON.parse(readFileSync(join(ROOT, p), 'utf8')); } catch { return null; } };
const r2 = (n) => Math.round(n * 100) / 100;
const num = (s) => { const n = parseFloat(String(s ?? '').replace(/,/g, '')); return Number.isFinite(n) ? n : 0; };

const dhanTok = J('mcp/dhan/.token.json')?.accessToken;
if (!dhanTok) { console.error('no Dhan token (mcp/dhan/.token.json)'); process.exit(1); }

// ── classification — LIVE-VERIFIED 2026-07-04 (see business-entity-model.md) ──
const CLASSIFY = { 'Funds Deposited': 'contribution', 'Funds Withdrawal': 'drawing', 'Monthly Settlement': 'drawing', 'Quarterly Settlement': 'drawing' };
// account-level charges (NOT trading charges — those live in fno-ledger) → business EXPENSES,
// which the reconciliation subtracts. Surfaced by the full-history (2024→) live pull, not the
// recent-month verify — the reason the full pull matters.
const EXPENSE = /^(DP Transaction Charges|Delayed Payment Charges|Margin Interest|Auto square off\/Call & Trade Charges|Bank Update Charges|Intraday Square Off Charges|SLB Fees)$/i;
const TRADES = /^Trades Executed$/i;   // daily net F&O settlement cash = realised (full history, from the ledger itself)
const OPENING = /^OPENING BALANCE$/i;
const CLOSING = /^CLOSING BALANCE$/i;

async function dhanLedger(from, to) {
  const r = await fetch(`https://api.dhan.co/v2/ledger?from-date=${from}&to-date=${to}`, { headers: { 'access-token': dhanTok, Accept: 'application/json' }, signal: AbortSignal.timeout(10000) });
  const j = await r.json();
  return Array.isArray(j) ? j : [];
}
// the endpoint 500s on ranges > ~1 month → pull month-by-month
function monthChunks(sy, sm, ey, em) {
  const out = []; let y = sy, m = sm;
  while (y < ey || (y === ey && m <= em)) {
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
    const mm = String(m).padStart(2, '0');
    out.push([`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, '0')}`]);
    m++; if (m > 12) { m = 1; y++; }
  }
  return out;
}

// ── pull the full ledger history (empty months return []) ──
const endArg = process.argv[2] || '2026-07';       // YYYY-MM; default current
const [ey, em] = endArg.split('-').map(Number);
const entries = [];
for (const [f, t] of monthChunks(2024, 1, ey, em)) { try { entries.push(...await dhanLedger(f, t)); } catch { /* skip a bad month */ } }

// ── classify + dedup (by vouchernumber) ──
const seen = new Set(); const rows = []; const unclassified = {}; let expenses = 0, tradeNet = 0, openingBal = null;
for (const e of entries) {
  const narr = String(e.narration || '').trim();
  if (CLOSING.test(narr)) continue;
  if (OPENING.test(narr)) { if (openingBal == null) openingBal = num(e.credit) - num(e.debit) || num(e.runbal); continue; }  // earliest opening = balance before the pulled window
  if (TRADES.test(narr)) { tradeNet += num(e.credit) - num(e.debit); continue; }                                            // net trading cash = realised (full history)
  if (EXPENSE.test(narr)) { expenses += num(e.debit) - num(e.credit); continue; }                                           // account-level charge → business expense
  const type = CLASSIFY[narr];
  if (!type) { if (narr) unclassified[narr] = (unclassified[narr] || 0) + 1; continue; }   // surface, never silently drop
  const ref = e.vouchernumber || `${narr}|${e.voucherdate}`;
  if (seen.has(ref)) continue; seen.add(ref);
  const amount = r2(type === 'contribution' ? num(e.credit) : num(e.debit));   // deposit→credit, withdrawal/settlement→debit
  rows.push({ date: e.voucherdate, broker: 'dhan', type, amount, ownerTag: 'unknown', narration: narr, ref });
}
expenses = r2(expenses); tradeNet = r2(tradeNet); openingBal = r2(openingBal || 0);
rows.sort((a, b) => new Date(a.date) - new Date(b.date));

// ── manual owner/client overlay (Dhan s01 holds client capital → each fund-in ambiguous) ──
const tags = J('data/trading-ledger-tags.json') || {};
for (const row of rows) if (tags[row.ref]) row.ownerTag = tags[row.ref];
const untagged = rows.filter((r) => r.ownerTag === 'unknown').length;

// ── summary ──
const sum = (t) => r2(rows.filter((r) => r.type === t).reduce((a, r) => a + r.amount, 0));
const contributions = sum('contribution'), drawings = sum('drawing'), netCapital = r2(contributions - drawings);

// ── reconciliation tie-out (DRIFT FLAG): account_value ≈ netCapital + cumulative net-realised (Dhan) ──
const bs = J('data/broker-state.json');
const dhanFunds = r2((bs?.funds?.dhan?.available || 0) + (bs?.funds?.dhan?.utilized || 0));
const dhanMtm = r2((bs?.positions?.DHAN_FNO?.rows || []).filter((r) => (+r.netQty || 0) !== 0).reduce((a, r) => a + (r.unrealized || 0), 0));
const fnoRows = (J('data/fno-ledger.json')?.rows || []).filter((r) => /dhan/i.test(r.broker || ''));
const cumRealisedFno = r2(fnoRows.reduce((a, r) => a + (r.net ?? ((r.grossRealised || 0) - (r.estCharges || 0))), 0));   // windowed cross-check for tradeNet
// ledger CASH tie-out (full history, from the ledger itself; open MTM excluded — it is not in cash):
const expectedCash = r2(openingBal + netCapital + tradeNet - expenses);
const drift = r2(dhanFunds - expectedCash);

const out = {
  version: 1, builtFor: 'dhan', asOf: (process.argv[3] || 'run-time'),
  rows,
  summary: { fundTransferRows: rows.length, contributions, drawings, netCapital, expenses, openingBal, tradeNet, untaggedOwnerClient: untagged, unclassifiedNarrations: unclassified },
  reconcile: {
    dhanFunds, dhanMtm, openingBal, netCapital, tradeNet, expenses, expectedCash, drift, cumRealisedFno,
    note: 'CASH tie-out: dhanFunds vs opening + netCapital + tradeNet − expenses. Residual drift = client-profit-paid + Other Debit/Credit + any MISSING event. cumRealisedFno = the windowed fno-ledger cross-check for tradeNet.',
  },
};
writeFileSync(join(ROOT, 'data', 'trading-ledger.json'), JSON.stringify(out, null, 2));

console.log('=== trading-ledger (Dhan) — SEMI-AUTO fund transfers ===');
console.log('fund-transfer rows:', rows.length, '| contributions ₹' + contributions, '| drawings ₹' + drawings, '| netCapital ₹' + netCapital, '| expenses ₹' + expenses);
console.log('opening ₹' + openingBal, '| tradeNet(realised) ₹' + tradeNet, '| fno-ledger cross-check ₹' + cumRealisedFno);
console.log('unclassified narrations (surfaced, not dropped — review these):', Object.keys(unclassified).length ? JSON.stringify(unclassified) : 'none');
console.log('owner/client UNTAGGED (need manual tag):', untagged, 'of', rows.length, '(Dhan has client capital → ambiguous)');
console.log('\n=== CASH reconciliation drift flag ===');
console.log('dhanFunds ₹' + dhanFunds + '  vs  opening ₹' + openingBal + ' + netCapital ₹' + netCapital + ' + tradeNet ₹' + tradeNet + ' − expenses ₹' + expenses + ' = ₹' + expectedCash);
console.log('DRIFT = ₹' + drift, Math.abs(drift) > 50000 ? '  ⚠ >₹50k — investigate (client-profit-paid + Other Debit/Credit + missing event)' : '  ✓ ties out (residual = client-profit-paid + Other Debit/Credit)');
