// Registry-wrapper tests: canHandle discrimination (the sniff layer that keeps
// one PDF type from being claimed by another parser) + the porcelain contract.
// The python engines have their own regression suites (test_engine.py) — these
// tests never spawn python.

import { describe, it, expect } from 'vitest';
import { lastJsonLine, isPdf, venvPythonStrict } from './py.mjs';
import { casMfParser } from './cas-mf.mjs';
import { contractNoteParser, mapCnStatus } from './contract-note.mjs';
import { payslipParser, nextFormName } from './payslip.mjs';
import { brokerTaxParser } from './broker-tax.mjs';
import { classify } from '../registry.mjs';
import { loadParsers } from '../registry.mjs';

const PDF = Buffer.from('%PDF-1.7 blah');
const TXT = Buffer.from('hello');

describe('py helpers', () => {
  it('lastJsonLine takes the LAST parseable JSON line', () => {
    const out = 'noise\n{"status":"FAIL"}\nlog line\n{"status":"PASS","key":"K"}\n';
    expect(lastJsonLine(out)).toEqual({ status: 'PASS', key: 'K' });
  });
  it('lastJsonLine → null on no JSON', () => {
    expect(lastJsonLine('nothing here')).toBe(null);
    expect(lastJsonLine('')).toBe(null);
  });
  it('isPdf sniffs the magic', () => {
    expect(isPdf(PDF)).toBe(true);
    expect(isPdf(TXT)).toBe(false);
    expect(isPdf(undefined)).toBeFalsy();
  });
  it('venvPythonStrict: missing venv → actionable error, NEVER a PATH fallback', () => {
    const missing = venvPythonStrict('scripts/no-such-tool/.venv');
    expect(missing.python).toBeUndefined();
    expect(missing.error).toMatch(/missing.*README.*refusing PATH-python fallback/s);
    const real = venvPythonStrict('scripts/cas-parser/.venv');
    expect(real.error).toBeUndefined();
    expect(real.python).toMatch(/cas-parser.*python\.exe$/);
  });
});

describe('cas-mf canHandle', () => {
  const claims = (name, head = PDF) => casMfParser.canHandle({ name, head });
  it('claims CAS-looking PDFs', () => {
    expect(claims('CAS_JUN2026.pdf')).toBe(true);
    expect(claims('a1b2c3d4-CAMSOnline_Statement.pdf')).toBe(true);
    expect(claims('KFINTECH-CAS-2026.pdf')).toBe(true);
    expect(claims('ConsolidatedAccountStatement-Jun.pdf')).toBe(true);
  });
  it('rejects non-CAS names and non-PDF bytes', () => {
    expect(claims('ContractNote_NSE_2026.pdf')).toBe(false);
    expect(claims('Form (12).pdf')).toBe(false);
    expect(claims('payslip-june.pdf')).toBe(false);
    expect(claims('CAS_JUN2026.pdf', TXT)).toBe(false);   // pdf magic required
  });
});

describe('contract-note', () => {
  const claims = (name, head = PDF) => contractNoteParser.canHandle({ name, head });
  it('claims contract-note PDFs', () => {
    expect(claims('ContractNote_NSE_FO_2026-07-01.pdf')).toBe(true);
    expect(claims('99887766-contract_note_XY123.pdf')).toBe(true);
  });
  it('rejects CAS/payslip/non-pdf', () => {
    expect(claims('CAS_JUN2026.pdf')).toBe(false);
    expect(claims('Form (12).pdf')).toBe(false);
    expect(claims('ContractNote.pdf', TXT)).toBe(false);
  });
  it('maps run.py statuses: PUSHED/OK/CARRY → PASS, REFUSED/HELD/SKIP → FAIL', () => {
    expect(mapCnStatus({ status: 'PUSHED', cn: 'CN1' })).toMatchObject({ status: 'PASS', naturalKey: 'CN1', target: 'ledger:cn:CN1' });
    expect(mapCnStatus({ status: 'OK', cn: 'CN1', reason: 'dry-run' }).status).toBe('PASS');
    expect(mapCnStatus({ status: 'CARRY', cn: 'CN2' })).toMatchObject({ status: 'PASS', target: null });
    expect(mapCnStatus({ status: 'REFUSED', cn: 'CN3', reason: 'checksum FAIL' }).status).toBe('FAIL');
    expect(mapCnStatus({ status: 'HELD', cn: 'CN4' }).status).toBe('FAIL');
    expect(mapCnStatus({ status: 'SKIP' }).status).toBe('FAIL');
    expect(mapCnStatus(null).status).toBe('FAIL');
  });
});

describe('payslip', () => {
  const claims = (name, head = PDF) => payslipParser.canHandle({ name, head });
  it('claims Form (N).pdf incl. gmail-prefixed, and payslip-named PDFs', () => {
    expect(claims('Form (13).pdf')).toBe(true);
    expect(claims('a1b2c3d4-Form (2).pdf')).toBe(true);
    expect(claims('payslip-june-2026.pdf')).toBe(true);
  });
  it('rejects others', () => {
    expect(claims('ContractNote.pdf')).toBe(false);
    expect(claims('Form (13).pdf', TXT)).toBe(false);
  });
  it('nextFormName picks max+1, ignoring unrelated files', () => {
    expect(nextFormName(['Form (1).pdf', 'Form (12).pdf', 'taxpnl-x.xlsx'])).toBe('Form (13).pdf');
    expect(nextFormName([])).toBe('Form (1).pdf');
  });
});

describe('broker-tax', () => {
  const claims = (name) => brokerTaxParser.canHandle({ name, head: TXT });
  it('claims exactly the python dispatch conventions', () => {
    expect(claims('taxpnl-YXA918-2025.xlsx')).toBe(true);
    expect(claims('FYERS_tax_pnl_FY2526.csv')).toBe(true);
    expect(claims('TAX_PNL_REPORT.xls')).toBe(true);
    expect(claims('Profit-Loss Statement 2026.xlsx')).toBe(true);
    expect(claims('realizedPnL_FY2526.zip')).toBe(true);
    expect(claims('AG4907_trades.csv')).toBe(true);
    expect(claims('Stocks_PnL_Report_Q1.xlsx')).toBe(true);
  });
  it('rejects near-misses', () => {
    expect(claims('taxpnl-YXA918.csv')).toBe(false);       // wrong ext
    expect(claims('mystery.xlsx')).toBe(false);
    expect(claims('TAX_PNL_REPORT.xlsx')).toBe(false);     // dhan is .xls exactly
  });
});

describe('classification is mutually exclusive across the roster', () => {
  it('each fixture lands on exactly one parser', async () => {
    const parsers = await loadParsers();
    const cases = [
      ['ContractNote_2026.pdf', PDF, 'contract-note'],
      ['CAS_JUN2026.pdf', PDF, 'cas-mf'],
      ['Form (3).pdf', PDF, 'payslip'],
      ['taxpnl-YXA918-2025.xlsx', TXT, 'broker-tax'],
      ['random.docx', TXT, null],
    ];
    for (const [name, head, want] of cases) {
      const claimants = parsers.filter((p) => { try { return p.canHandle({ name, head, headText: head.toString() }); } catch { return false; } });
      expect(claimants.length, `${name} claimed by ${claimants.map((p) => p.id)}`).toBe(want ? 1 : 0);
      expect(classify({ name, head, headText: head.toString() }, parsers)?.id ?? null).toBe(want);
    }
  });
});

describe('registry roster', () => {
  it('loads and validates every registered parser', async () => {
    const parsers = await loadParsers();
    expect(parsers.length).toBeGreaterThanOrEqual(1);
    for (const p of parsers) {
      expect(typeof p.id).toBe('string');
      expect(typeof p.canHandle).toBe('function');
      expect(typeof p.run).toBe('function');
      expect(p.expects?.cadence).toBeTruthy();
    }
  });
});
