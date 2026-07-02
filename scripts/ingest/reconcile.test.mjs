// Reconcile-lib tests (pure). Locks: FY mappers, ledger/payslip FY sums,
// verdict bands, the report model (authority order, basis notes present,
// the impossible-salary flag, out-of-scope stores untouched).

import { describe, it, expect } from 'vitest';
import { fyOfAy, fyOfMonth, sumLedgerByFy, sumPayslipsByFy, verdict, buildReconcile } from './reconcile.mjs';

describe('FY mappers', () => {
  it('AY → the FY it assesses', () => {
    expect(fyOfAy('AY2025-26')).toBe('FY24-25');
    expect(fyOfAy('AY2026-27')).toBe('FY25-26');
    expect(fyOfAy('junk')).toBe(null);
  });
  it('month → Indian FY (Apr cutoff)', () => {
    expect(fyOfMonth('2026-03')).toBe('FY25-26');
    expect(fyOfMonth('2026-04')).toBe('FY26-27');
  });
});

describe('sums', () => {
  it('ledger nets by FY (net = gross − est when net absent)', () => {
    const rows = [
      { date: '2025-05-02', grossRealised: 1000, estCharges: 100 },       // FY25-26 → 900
      { date: '2025-06-02', net: 500, grossRealised: 600 },               // FY25-26 → 500
      { date: '2024-05-02', net: -200, grossRealised: -150, chargeSource: 'real' }, // FY24-25
    ];
    const s = sumLedgerByFy(rows);
    expect(s['FY25-26']).toMatchObject({ net: 1400, gross: 1600, days: 2 });
    expect(s['FY24-25']).toMatchObject({ net: -200, days: 1, realCharged: 1 });
  });
  it('payslip take-home by FY', () => {
    const s = sumPayslipsByFy([{ month: '2025-04', net: 100 }, { month: '2025-05', net: 100 }, { month: '2025-03', net: 50 }]);
    expect(s['FY25-26']).toEqual({ net: 200, months: 2 });
    expect(s['FY24-25']).toEqual({ net: 50, months: 1 });
  });
});

describe('verdict bands', () => {
  it('MATCH / NEAR / DRIFT / N/A', () => {
    expect(verdict(1000, 1050)).toBe('MATCH');
    expect(verdict(1000, 4000)).toBe('NEAR');
    expect(verdict(1000, 90000)).toBe('DRIFT');
    expect(verdict(null, 5)).toBe('N/A');
  });
});

describe('buildReconcile', () => {
  const candidate = {
    ayLabel: 'AY2025-26',
    anchors: {
      fnoBusinessIncome: { value: -391068 }, speculativeIncome: { value: -67310 },
      salaryGross: { value: 1500000 }, salaryNet: { value: 1400000 },
      cflNonSpecCF: { value: 513011 }, cflSpeculativeCF: { value: 84268 }, cflStcgCF: { value: 4700 },
    },
  };
  const seed = { cf: { nonSpec: 513011, speculative: 84307, stcgCarried: 0 } };

  it('assembles per-FY F&O with basis note and authority order', () => {
    const r = buildReconcile({
      candidates: [candidate], seed,
      ledgerRows: [{ date: '2024-06-03', net: -458000, grossRealised: -450000 }],
      brokerTaxFno: { fy: [{ label: 'FY24-25', amt: -450000 }] },
    });
    expect(r.authority).toMatch(/^parsed ITR JSON →/);
    const f = r.fno[0];
    expect(f.fy).toBe('FY24-25');
    expect(f.itrNet).toBe(-458378);
    expect(f.ledgerNet).toBe(-458000);
    expect(f.vsLedger).toBe('NEAR');                  // 378 apart — inside the charges band
    expect(f.note).toMatch(/bases differ/);
  });

  it('flags the impossible salary case only', () => {
    const ok = buildReconcile({ candidates: [candidate], seed, payslips: [{ month: '2024-05', net: 100000 }] });
    expect(ok.salary[0].flag).toBe(null);
    const bad = buildReconcile({ candidates: [candidate], seed, payslips: [{ month: '2024-05', net: 2000000 }] });
    expect(bad.salary[0].flag).toMatch(/IMPOSSIBLE/);
  });

  it('CFL verdicts are exact-tolerance (₹1)', () => {
    const r = buildReconcile({ candidates: [candidate], seed });
    expect(r.cfl[0].nonSpec.verdict).toBe('MATCH');
    expect(r.cfl[0].speculative.verdict).toBe('NEAR');   // 84268 vs 84307 — the real ₹39 gap
    expect(r.cfl[0].stcg.verdict).toBe('NEAR');
  });

  it('MF pending + corp-action guard present; out-of-scope stores listed untouched', () => {
    const r = buildReconcile({ candidates: [], seed, privateAsOf: { US_REALIZED: '08 Jun 2026' } });
    expect(r.mf.status).toMatch(/PENDING/);
    expect(r.mf.guard).toMatch(/corp-action/);
    expect(r.staleness).toEqual([{ store: 'US_REALIZED', asOf: '08 Jun 2026' }]);
  });
});
