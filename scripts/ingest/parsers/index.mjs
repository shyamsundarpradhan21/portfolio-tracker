// The registry roster. Order matters: classify() takes the FIRST parser whose
// canHandle claims the file, so specific content-sniffs go before generic ones.
//
// Populated phase by phase (plan v2 steps d/e/e2):
//   contract-note  → wraps scripts/contract-parser/run.py        (phase e-adjacent; wired with the others)
//   cas-mf         → NEW scripts/cas-parser/                     (phase d)
//   payslip        → wraps scripts/parse-payslip.py              (phase e)
//   broker-tax     → wraps scripts/parse-broker-tax.py           (phase e)
//   itr-json       → NEW per-AY schema validator + anchor diff   (phase e2)
//   vested         → wraps scripts/parse-vested.py -> data/us_trades.json

import { contractNoteParser } from './contract-note.mjs';
import { casMfParser } from './cas-mf.mjs';
import { payslipParser } from './payslip.mjs';
import { brokerTaxParser } from './broker-tax.mjs';
import { itrJsonParser } from './itr-json.mjs';
import { vestedParser } from './vested.mjs';

export const PARSERS = [
  contractNoteParser,   // most frequent doc (per trading day) — checked first
  casMfParser,
  payslipParser,
  brokerTaxParser,
  vestedParser,         // Vested_Transactions*.xlsx -> data/us_trades.json
  itrJsonParser,
];
