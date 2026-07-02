// Registry parser: broker-tax — broker tax/P&L reports (Zerodha taxpnl-*.xlsx,
// FYERS_tax_pnl*.csv, Dhan TAX_PNL_REPORT.xls, Vested "Profit-Loss Statement",
// Upstox realizedPnL_*.zip, Astha AG4907*.csv, Groww Stocks_PnL_Report*.xlsx).
// Wraps the PROVEN scripts/parse-broker-tax.py. naturalKey = broker + FY set
// (from the --one probe; an UPDATED all-time report carries a grown FY set →
// a genuinely new document, not a DUP). PASS flow: copy into data/reports/
// (the engine's corpus — it regenerates data/broker-tax.json from ALL reports)
// then re-run the full corpus parse. Re-seeding KV to publish realized figures
// stays a separate explicit step (parse-broker-tax's own documented workflow).

import { copyFileSync, mkdirSync } from 'node:fs';
import { join, basename } from 'node:path';
import { runPy, lastJsonLine, ROOT } from './py.mjs';

const SCRIPT = join(ROOT, 'scripts', 'parse-broker-tax.py');
const REPORTS = join(ROOT, 'data', 'reports');

export const BROKER_TAX_NAME = /^(taxpnl-.*\.xlsx|FYERS_tax_pnl.*\.csv|TAX_PNL_REPORT\.xls|Profit-Loss Statement.*\.xlsx|realizedPnL_.*\.zip|AG4907.*\.csv|Stocks_PnL_Report.*\.xlsx)$/i;

export const brokerTaxParser = {
  id: 'broker-tax',
  expects: { cadence: 'annual', label: 'broker tax/P&L report' },
  // filename conventions ARE the python dispatch table — mirror it exactly;
  // no PDF sniff (these are xlsx/xls/csv/zip)
  canHandle: ({ name }) => BROKER_TAX_NAME.test(name),
  async run(file, { dry }) {
    const probe = await runPy('python', SCRIPT, ['--one', file.path, '--porcelain']);
    const st = lastJsonLine(probe.stdout);
    if (!st?.broker || !st?.fys?.length) {
      return { status: 'FAIL', reason: st?.error || `probe failed (exit ${probe.code})` };
    }
    const naturalKey = `${st.broker}:${st.fys.join('+')}`;
    if (dry) return { status: 'PASS', naturalKey, target: 'data/broker-tax.json (dry)', parserVersion: 'parse-broker-tax' };

    mkdirSync(REPORTS, { recursive: true });
    copyFileSync(file.path, join(REPORTS, basename(file.path)));   // same-name convention: newer download replaces
    const full = await runPy('python', SCRIPT, []);                // regenerates data/broker-tax.json from the corpus
    if (full.code !== 0) {
      return { status: 'FAIL', naturalKey, reason: `parse-broker-tax exit ${full.code} (report already copied to data/reports/)` };
    }
    return { status: 'PASS', naturalKey, target: 'data/broker-tax.json (re-seed KV to publish)', parserVersion: 'parse-broker-tax' };
  },
};
