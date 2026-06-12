'use client';

// Forward net-worth model, shared by the Projected Outlook card and the
// trajectory chart so the two can never disagree. Monthly compounding on a
// live base; the contribution and its annual step-up are DERIVED from the
// ledgers (below) — never typed in.

import { MF_CASHFLOWS, US_CASHFLOWS, TRANSACTIONS, fdFlows, fdRedemptions, PAYSLIPS } from '../portfolio';
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

  return { monthly, stepUp };
}

// Monthly series for one rate: corpus[m] / invested[m], m = 0 … months.
// inp = { monthly, stepUp } from deriveProjInputs.
export function simMonthly(rate, base, inv0, months, inp) {
  const mr = rate / 12;
  let c = base, inv = inv0;
  const corpus = [c], invested = [inv];
  for (let m = 1; m <= months; m++) {
    const x = inp.monthly * Math.pow(1 + inp.stepUp, Math.floor((m - 1) / 12));
    c = c * (1 + mr) + x; inv += x;
    corpus.push(c); invested.push(inv);
  }
  return { corpus, invested };
}
