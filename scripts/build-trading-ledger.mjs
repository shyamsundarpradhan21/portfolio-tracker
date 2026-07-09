// Trading-business contributions/drawings ledger — Sub-step 3a (design:
// tasks/business-entity-model.md). Pulls the Dhan /v2/ledger, classifies fund transfers
// on the LIVE-VERIFIED taxonomy, writes data/trading-ledger.json (gitignored, private),
// and reconciles against the ledger's OWN CLOSING BALANCE (the authoritative cash) as a
// drift flag. The account is 100% owner capital (wholly owned).
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
const H = { 'access-token': dhanTok, Accept: 'application/json' };

// ── classification — LIVE-VERIFIED against the full 2024→ history ──
const CLASSIFY = { 'Funds Deposited': 'contribution', 'Funds Withdrawal': 'drawing', 'Monthly Settlement': 'drawing', 'Quarterly Settlement': 'drawing' };
const EXPENSE = /^(DP Transaction Charges|Delayed Payment Charges|Margin Interest|Auto square off\/Call & Trade Charges|Bank Update Charges|Intraday Square Off Charges|SLB Fees)$/i;
const OPENING = /^OPENING BALANCE$/i, CLOSING = /^CLOSING BALANCE$/i, TRADES = /^Trades Executed$/i;

// endpoint 500s on >1-month ranges; retry each month (transient failures)
async function ledger(f, t, tries = 4) { for (let i = 0; i < tries; i++) { try { const r = await fetch(`https://api.dhan.co/v2/ledger?from-date=${f}&to-date=${t}`, { headers: H, signal: AbortSignal.timeout(15000) }); const j = await r.json(); if (Array.isArray(j)) return j; } catch { /* retry */ } } return []; }
function monthChunks(sy, sm, ey, em) { const o = []; let y = sy, m = sm; while (y < ey || (y === ey && m <= em)) { const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); const mm = String(m).padStart(2, '0'); o.push([`${y}-${mm}-01`, `${y}-${mm}-${String(last).padStart(2, '0')}`]); m++; if (m > 12) { m = 1; y++; } } return o; }

const endArg = process.argv[2] || '2026-07';
const [ey, em] = endArg.split('-').map(Number);
const entries = [];
for (const [f, t] of monthChunks(2024, 1, ey, em)) entries.push(...await ledger(f, t));
entries.sort((a, b) => new Date(a.voucherdate) - new Date(b.voucherdate));

// ── classify + capture the ledger's own opening/closing balances (cash ground-truth) ──
const seen = new Set(); const rows = []; const unclassified = {};
let contributions = 0, drawings = 0, expenses = 0, openingBal = null, ledgerCash = null;
for (const e of entries) {
  const narr = String(e.narration || '').trim();
  if (OPENING.test(narr)) { if (openingBal == null) openingBal = num(e.credit) - num(e.debit); continue; }   // earliest opening
  if (CLOSING.test(narr)) { ledgerCash = num(e.credit) - num(e.debit); continue; }                          // latest closing = current cash
  if (TRADES.test(narr)) continue;                                                                          // realised is DERIVED (below) — summing Trades Executed credit/debit is margin-polluted
  if (EXPENSE.test(narr)) { expenses += num(e.debit) - num(e.credit); continue; }
  const type = CLASSIFY[narr];
  if (!type) { if (narr) unclassified[narr] = (unclassified[narr] || 0) + 1; continue; }   // surface, never drop
  const ref = e.vouchernumber || `${narr}|${e.voucherdate}`;
  if (seen.has(ref)) continue; seen.add(ref);
  const amount = r2(type === 'contribution' ? num(e.credit) : num(e.debit));
  if (type === 'contribution') contributions += amount; else drawings += amount;
  rows.push({ date: e.voucherdate, broker: 'dhan', type, amount, narration: narr, ref });   // all owner — no tag
}
contributions = r2(contributions); drawings = r2(drawings); expenses = r2(expenses);
openingBal = r2(openingBal || 0); ledgerCash = r2(ledgerCash || 0);
const netCapital = r2(contributions - drawings);                       // ALL owner capital (incl. the ₹2.5L Mar-2026 deposit)
const realisedDerived = r2(ledgerCash - openingBal - netCapital + expenses);   // complete realised, from the identity

// ── owner equity + reconciliation (100% owner: equity = account value + MTM, NO client subtraction) ──
const bs = J('data/broker-state.json');
const dhanFunds = r2((bs?.funds?.dhan?.available || 0) + (bs?.funds?.dhan?.utilized || 0));
const dhanMtm = r2((bs?.positions?.DHAN_FNO?.rows || []).filter((r) => (+r.netQty || 0) !== 0).reduce((a, r) => a + (r.unrealized || 0), 0));
const ownerEquity = r2(dhanFunds + dhanMtm);
const drift = r2(dhanFunds - ledgerCash);   // ledger cash vs broker-state cash → snapshot-timing residual only

// ── GUARD: the Trading-tab realised ledger must tie to this cash-account truth ───
// realisedDerived is NET of trading charges — they're baked into the cash "Trades Executed"
// entries (the cash-ledger has no separate STT/brokerage lines). So the ledger GROSS should
// EXCEED realisedDerived by the real charges: true gross ≈ realisedDerived + realCharges, and
// UNDERCOUNT = that − ledger gross. (A naive gross-vs-realisedDerived diff conflates the
// undercount with the charges and gives false comfort — that was the original bug in this
// guard.) Real charges are overlay-only (contract notes), so pre-2025 charges are missing here,
// but 2023/24 ledger gross is FIFO-EXACT (verified) so their omission doesn't distort the gap —
// the residual localises to 2025 (Jan–Sep notes unparsed). Precise per-year check:
//   node scripts/backfill-fno-realised.mjs --audit
const overlay = J('data/fno-overlay.json')?.byKey || {};
const dhanCharges = r2(Object.entries(overlay).filter(([k]) => k.startsWith('Dhan|')).reduce((a, [, v]) => a + (v.realCharge || 0), 0));
const fnoDhan = (J('data/fno-ledger.json')?.rows || []).filter((r) => r.broker === 'Dhan');
const fnoGross = r2(fnoDhan.reduce((a, r) => a + (r.grossRealised || 0), 0));
const fnoPositionsRows = fnoDhan.filter((r) => r.source === 'positions').length;
const trueGross = r2(realisedDerived + dhanCharges);      // cash-net realised + real charges
const fnoUndercount = r2(trueGross - fnoGross);           // >0 ⇒ the ledger under-books realised

const out = {
  version: 2, builtFor: 'dhan', ownerOnly: true, asOf: (process.argv[3] || 'run-time'),
  rows,
  summary: { fundTransferRows: rows.length, contributions, drawings, netCapital, expenses, openingBal, ledgerCash, realisedDerived, unclassifiedNarrations: unclassified },
  reconcile: {
    ledgerCash, dhanFunds, dhanMtm, ownerEquity, drift,
    fnoLedgerGross: fnoGross, fnoPositionsRows, realCharges: dhanCharges, trueGross, fnoUndercount,
    note: '100% OWNER capital — no client, no subtraction. ownerEquity = dhanFunds + open MTM. Cash tie-out = the Dhan CLOSING BALANCE (ledgerCash) vs broker-state dhanFunds → drift is snapshot timing only. Realised is DERIVED from the identity (ledgerCash − opening − netCapital + expenses), NOT summed (Trades Executed credit/debit is F&O-margin-polluted); it is NET of trading charges. fnoUndercount = (realisedDerived + real charges) − fno-ledger Dhan gross: >0 means the ledger under-books realised (carried-position undercount / a period the parser missed). Precise per-year check: backfill-fno-realised.mjs --audit.',
  },
};
writeFileSync(join(ROOT, 'data', 'trading-ledger.json'), JSON.stringify(out, null, 2));

console.log('=== trading-ledger (Dhan) — OWNER-ONLY fund transfers ===');
console.log('rows', rows.length, '| contributions ₹' + contributions, '| drawings ₹' + drawings, '| netCapital ₹' + netCapital, '| expenses ₹' + expenses);
console.log('opening ₹' + openingBal, '| ledgerCash(CLOSING) ₹' + ledgerCash, '| realised(derived) ₹' + realisedDerived);
console.log('unclassified (surfaced):', Object.keys(unclassified).length ? JSON.stringify(unclassified) : 'none');
console.log('\n=== owner equity + cash reconciliation ===');
console.log('owner equity = dhanFunds ₹' + dhanFunds + ' + MTM ₹' + dhanMtm + ' = ₹' + ownerEquity);
console.log('cash tie-out: ledgerCash ₹' + ledgerCash + ' vs dhanFunds ₹' + dhanFunds + ' → DRIFT ₹' + drift, Math.abs(drift) > 5000 ? '  ⚠ >₹5k — investigate' : '  ✓ ties out (snapshot timing)');
console.log('\n=== fno-ledger reconcile (carried-position guard) ===');
console.log('ledger Dhan gross ₹' + fnoGross + ' (' + fnoDhan.length + ' rows, ' + fnoPositionsRows + " source:'positions')");
console.log('true gross ≈ realisedDerived ₹' + realisedDerived + ' + real charges ₹' + dhanCharges + ' = ₹' + trueGross);
console.log('→ UNDERCOUNT ₹' + fnoUndercount, Math.abs(fnoUndercount) > 20000 ? '  ⚠ >₹20k — a period is under-booked; run `node scripts/backfill-fno-realised.mjs --audit` to localise' : '  ✓ within tolerance');
