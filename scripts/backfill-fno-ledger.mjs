// Backfill the durable daily F&O ledger from parsed broker reports. The live sync
// only captures forward (one day at a time), so historical days are missing from
// data/fno-ledger.json — which leaves the Trading-tab calendar/heatmap empty for
// the past. parse-broker-tax.py reads each F&O trade's exact sell-date from the
// report and now emits broker-tax.json `fno_daily` (date + gross + net, non-PII);
// this upserts those into the ledger so the calendar fills with REAL history.
//
//   python scripts/parse-broker-tax.py      # drop reports in data/reports/ first
//   node   scripts/backfill-fno-ledger.mjs  # then this — fills data/fno-ledger.json
//   git add data/fno-ledger.json && commit
//
// Idempotent: upsert is keyed by (date, broker), so re-running is safe and a later
// live-sync row for the same day overwrites the report estimate (and vice-versa).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appendLedger } from './lib/fno-ledger.mjs';

// Broker labels must match the live sync's rows so upsert keys align (no double
// count when a day exists in both the report and the sync). sync uses 'Dhan' etc.
const LABEL = { dhan: 'Dhan', upstox: 'Upstox', fyers: 'Fyers', zerodha_self: 'Zerodha', astha: 'Astha' };

// Indian FY of a YYYY-MM-DD date (Apr–Mar) → "FY23-24", to match accounts[].fy.
export function fyOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  const s = d.getUTCMonth() >= 3 ? d.getUTCFullYear() : d.getUTCFullYear() - 1;
  return `FY${String(s).slice(2)}-${String(s + 1).slice(2)}`;
}

// Pure: broker-tax fno_daily rows → fno-ledger rows. estCharges is recovered as
// gross − net (the Dhan report gives both per trade), so the ledger's net matches
// the report's net exactly. Reports that give only per-trade GROSS (Upstox, Fyers)
// leave daily net=gross (charges=0) — but the FY summary's `realized` IS post-charges,
// so `accounts[].fno.gross − .realized` is the REAL FY charge. We allocate that across
// the FY's charge-less daily rows pro-rata by |gross| (a turnover proxy): the FY total
// ties to the report EXACTLY while the daily calendar nets out. Dhan rows (daily net ≠
// gross) already carry charges and are left untouched. Exported for unit tests.
export function dailyToLedgerRows(fnoDaily, accounts = []) {
  const fyCharge = new Map();   // `${label}:${fy}` → real FY charge (gross − realized)
  for (const a of accounts || []) {
    const g = a?.fno?.gross, n = a?.fno?.realized;
    if (g == null || n == null || !a.fy || !a.broker) continue;
    const ch = +(g - n).toFixed(2);
    if (Math.abs(ch) > 0.5) fyCharge.set(`${LABEL[a.broker] || a.broker}:${a.fy}`, ch);
  }
  const rows = (fnoDaily || [])
    .filter((r) => r && r.date && r.broker && r.gross != null)
    .map((r) => ({
      date: r.date,
      broker: LABEL[r.broker] || r.broker,
      sleeve: r.sleeve,
      grossRealised: r.gross,
      estCharges: r.net != null ? +(r.gross - r.net).toFixed(2) : 0,
      turnover: 0,
      orders: r.orders ?? null,   // = closed-trade count that day (reports have no order count)
      source: 'report',
      _fy: fyOf(r.date),
      _netless: r.net == null || Math.abs(r.net - r.gross) < 0.005,   // charges NOT in the daily net
    }));
  // Allocate each charge-less (broker, FY) group's real FY charge pro-rata by |gross|.
  const groups = new Map();
  for (const row of rows) {
    const k = `${row.broker}:${row._fy}`;
    if (row._netless && fyCharge.has(k)) (groups.get(k) || groups.set(k, []).get(k)).push(row);
  }
  for (const [k, grp] of groups) {
    const charge = fyCharge.get(k);
    const absSum = grp.reduce((a, r) => a + Math.abs(r.grossRealised), 0);
    let acc = 0;
    grp.forEach((r, i) => {
      const c = i === grp.length - 1
        ? +(charge - acc).toFixed(2)   // last row absorbs rounding → the FY ties to the rupee
        : +(charge * (absSum ? Math.abs(r.grossRealised) / absSum : 1 / grp.length)).toFixed(2);
      acc = +(acc + c).toFixed(2);
      r.estCharges = c;
    });
  }
  return rows.map(({ _fy, _netless, ...r }) => r);   // appendLedger computes net = gross − estCharges
}

// Run as a script (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('backfill-fno-ledger.mjs')) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const taxPath = process.argv[2] || join(ROOT, 'data', 'broker-tax.json');
  let tax;
  try { tax = JSON.parse(readFileSync(taxPath, 'utf8')); }
  catch (e) { console.error(`cannot read ${taxPath}: ${e.message}`); process.exit(1); }
  const rows = dailyToLedgerRows(tax.fno_daily, tax.accounts);
  if (!rows.length) {
    console.log('no fno_daily rows in broker-tax.json — run parse-broker-tax.py with a per-trade report (Dhan) first');
    process.exit(0);
  }
  const { added, updated } = appendLedger(rows);
  console.log(`backfill: ${rows.length} daily rows from report → fno-ledger.json (${added} added, ${updated} updated)`);
  console.log('next: git add data/fno-ledger.json && commit');
}
