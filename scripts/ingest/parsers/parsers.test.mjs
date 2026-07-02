// Registry-wrapper tests: canHandle discrimination (the sniff layer that keeps
// one PDF type from being claimed by another parser) + the porcelain contract.
// The python engines have their own regression suites (test_engine.py) — these
// tests never spawn python.

import { describe, it, expect } from 'vitest';
import { lastJsonLine, isPdf } from './py.mjs';
import { casMfParser } from './cas-mf.mjs';
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
