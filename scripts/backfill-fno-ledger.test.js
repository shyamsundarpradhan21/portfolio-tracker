// Tests for the report→ledger daily backfill mapping (the pure core).
import { describe, it, expect } from 'vitest';
import { dailyToLedgerRows } from './backfill-fno-ledger.mjs';

describe('dailyToLedgerRows', () => {
  const daily = [
    { date: '2026-04-10', broker: 'dhan', sleeve: 'S01', gross: -47080, net: -49978 },
    { date: '2026-06-12', broker: 'dhan', sleeve: 'S01', gross: 50200, net: 47478 },
  ];
  const rows = dailyToLedgerRows(daily);

  it('maps the broker label to match the live sync rows (dhan → Dhan)', () =>
    expect(rows.map((r) => r.broker)).toEqual(['Dhan', 'Dhan']));

  it('recovers estCharges as gross − net so the ledger net equals the report net', () => {
    // gross -47080, net -49978 → charges = gross - net = 2898 ; appendLedger nets to -49978
    expect(rows[0].estCharges).toBe(2898);
    expect(+(rows[0].grossRealised - rows[0].estCharges).toFixed(2)).toBe(-49978);
    expect(rows[1].estCharges).toBe(2722); // 50200 - 47478
  });

  it('carries date + sleeve and tags the source as report', () => {
    expect(rows[0].date).toBe('2026-04-10');
    expect(rows[0].sleeve).toBe('S01');
    expect(rows[0].source).toBe('report');
  });

  it('drops malformed rows (missing date/broker/gross)', () => {
    const r = dailyToLedgerRows([{ date: '2026-01-01', broker: 'dhan' }, { broker: 'dhan', gross: 5 }, null]);
    expect(r).toEqual([]);
  });

  it('passes an unknown broker label through unchanged', () =>
    expect(dailyToLedgerRows([{ date: '2026-01-01', broker: 'newbroker', sleeve: 'S02', gross: 10, net: 9 }])[0].broker).toBe('newbroker'));

  it('allocates real FY charges (accounts gross − realized) across charge-less daily rows', () => {
    // Upstox-style: daily rows carry net=gross (charges lost); the FY summary `realized`
    // IS post-charges, so gross − realized is the REAL FY charge, allocated pro-rata by |gross|.
    const upDaily = [
      { date: '2025-05-01', broker: 'upstox', sleeve: 'S02', gross: 300, net: 300 },
      { date: '2025-06-01', broker: 'upstox', sleeve: 'S02', gross: 100, net: 100 },
    ];
    const accounts = [{ broker: 'upstox', fy: 'FY25-26', fno: { gross: 400, realized: 360 } }]; // charge 40
    const r = dailyToLedgerRows(upDaily, accounts);
    expect(r.reduce((a, x) => a + x.estCharges, 0)).toBe(40);   // ties to the FY charge exactly
    expect(r[0].estCharges).toBe(30);                            // 40 × 300/400
    expect(r[1].estCharges).toBe(10);                            // last row absorbs rounding → 40 − 30
    expect(+(r[1].grossRealised - r[1].estCharges).toFixed(2)).toBe(90);
  });

  it('leaves rows whose daily net ≠ gross untouched even when accounts are passed', () => {
    // Dhan already carries per-day charges (net ≠ gross) → no double-count from FY allocation.
    const accounts = [{ broker: 'dhan', fy: 'FY26-27', fno: { gross: 3120, realized: 0 } }];
    expect(dailyToLedgerRows(daily, accounts)[0].estCharges).toBe(2898);
  });
});
