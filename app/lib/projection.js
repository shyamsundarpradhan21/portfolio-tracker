'use client';

// Forward net-worth model, shared by the Projected Outlook card and the
// trajectory chart so the two can never disagree. Monthly compounding on a
// live base; the contribution and its annual step-up are DERIVED from the
// ledgers (below) — never typed in.

import { MF_CASHFLOWS, US_CASHFLOWS, TRANSACTIONS, fdFlows, fdRedemptions, PAYSLIPS, PROJECTION } from '../portfolio';
import INDIAN_EXITS from '../../data/indian_exits.json';

// Projection inputs derived from real money movement:
//   monthly — average NET deployment (buys − redemptions/sells, all sleeves)
//             over the trailing 12 calendar months, snapped to ₹500.
//   stepUp  — annualised growth of net take-home across the payslip ledger,
//             clamped to a sane 0–25% band.
// fx converts US flows; callers pass the live rate.
export function deriveProjInputs(fx) {
  const rate = fx || 88; // last-resort technical fallback while quotes load
  const now = new Date();
  const mKey = (d) => d.slice(0, 7);
  const start = new Date(now.getFullYear(), now.getMonth() - 11, 1);
  const startKey = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}`;
  const inWin = (d) => mKey(d) >= startKey;

  let net = 0;
  net += MF_CASHFLOWS.filter((c) => inWin(c.date)).reduce((s, c) => s - c.amount, 0);
  net += US_CASHFLOWS.filter((c) => inWin(c.date)).reduce((s, c) => s + c.invested * rate, 0);
  net += TRANSACTIONS.filter((t) => inWin(t.date)).reduce((s, t) => s + t.invested, 0);
  net += fdFlows().filter((f) => inWin(f.date)).reduce((s, f) => s + f.amount, 0);
  net -= fdRedemptions().filter((r) => inWin(r.date)).reduce((s, r) => s + r.amount, 0);
  net += INDIAN_EXITS.trades.filter(([e]) => inWin(e)).reduce((s, [, , buy]) => s + buy, 0);
  net -= INDIAN_EXITS.trades.filter(([, x]) => inWin(x)).reduce((s, [, , , sell]) => s + sell, 0);
  const monthly = Math.max(0, Math.round(net / 12 / 500) * 500);

  let stepUp = 0;
  const ps = [...PAYSLIPS].sort((a, b) => (a.month < b.month ? -1 : 1));
  if (ps.length >= 2) {
    const span = (new Date(ps[ps.length - 1].month + '-01') - new Date(ps[0].month + '-01')) / (365.25 * 864e5);
    if (span > 0.5) stepUp = Math.pow(ps[ps.length - 1].net / ps[0].net, 1 / span) - 1;
  }
  stepUp = Math.min(0.25, Math.max(0, stepUp));

  return { monthly, stepUp, inflation: PROJECTION.inflation };
}

// Monthly series for one scenario: corpus[m] / invested[m], m = 0 … months.
// rates = { start, longRun }; inp = deriveProjInputs output.
//
// Long-horizon realism — neither today's XIRR nor today's wage growth
// survives 30 years, so both mean-revert instead of compounding flat:
//   return  — holds the live starting rate for 5 years, then glides
//             linearly to the scenario's long-run anchor by year 15
//   step-up — fades from the derived payslip growth to inflation by year 10
export function simMonthly(rates, base, inv0, months, inp) {
  const mr = (m) => {
    const y = m / 12;
    const w = y <= 5 ? 0 : y >= 15 ? 1 : (y - 5) / 10;
    return (rates.start + (rates.longRun - rates.start) * w) / 12;
  };
  let c = base, inv = inv0, monthly = inp.monthly;
  const corpus = [c], invested = [inv];
  for (let m = 1; m <= months; m++) {
    if (m > 1 && (m - 1) % 12 === 0) {
      const yIdx = (m - 1) / 12; // completed years
      const su = inp.stepUp + (inp.inflation - inp.stepUp) * Math.min(1, yIdx / 10);
      monthly *= 1 + Math.max(0, su);
    }
    c = c * (1 + mr(m)) + monthly; inv += monthly;
    corpus.push(c); invested.push(inv);
  }
  return { corpus, invested };
}
