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

// Pure: broker-tax fno_daily rows → fno-ledger rows. estCharges is recovered as
// gross − net (the Dhan report gives both per trade), so the ledger's net matches
// the report's net exactly. Exported for unit tests.
export function dailyToLedgerRows(fnoDaily) {
  return (fnoDaily || [])
    .filter((r) => r && r.date && r.broker && r.gross != null)
    .map((r) => ({
      date: r.date,
      broker: LABEL[r.broker] || r.broker,
      sleeve: r.sleeve,
      grossRealised: r.gross,
      estCharges: r.net != null ? +(r.gross - r.net).toFixed(2) : 0,
      turnover: 0,
      orders: null,
      source: 'report',
    }));
}

// Run as a script (not when imported by tests).
if (process.argv[1] && process.argv[1].endsWith('backfill-fno-ledger.mjs')) {
  const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
  const taxPath = process.argv[2] || join(ROOT, 'data', 'broker-tax.json');
  let tax;
  try { tax = JSON.parse(readFileSync(taxPath, 'utf8')); }
  catch (e) { console.error(`cannot read ${taxPath}: ${e.message}`); process.exit(1); }
  const rows = dailyToLedgerRows(tax.fno_daily);
  if (!rows.length) {
    console.log('no fno_daily rows in broker-tax.json — run parse-broker-tax.py with a per-trade report (Dhan) first');
    process.exit(0);
  }
  const { added, updated } = appendLedger(rows);
  console.log(`backfill: ${rows.length} daily rows from report → fno-ledger.json (${added} added, ${updated} updated)`);
  console.log('next: git add data/fno-ledger.json && commit');
}
