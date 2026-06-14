'use client';

// CMPS (Coal Mines Pension Scheme) — defined-benefit annuity estimator.
//
// Unlike CMPF (a provident fund you withdraw), CMPS pays a monthly pension
// for life after superannuation (age 60). There is no "corpus" to withdraw.
//
// Pension formula (CMPS Rules, 1998 as amended):
//   Monthly pension = (Pensionable Salary × Pensionable Service in years) / 70
//
// Pensionable Salary = average of last 12 months' Basic Pay (capped at ₹15,000
//   for legacy tiers; uncapped for post-2017 officers — we use actual basic).
// Pensionable Service = calendar years from joining date to superannuation, max 35.
//
// Total contributions paid in = Σ emp × 2 (employee + matching employer).
// This is useful to show the "invested" dimension alongside the pension right.

import { CMPS_CONTRIBUTIONS } from '../portfolio';

const DOJ = new Date('2023-01-28'); // date of joining MCL
const SUPERANNUATION_AGE = 60;
const DOB = new Date('1995-03-02'); // date of birth — drives retirement date

// CMPS-1998 vests only after a minimum qualifying service: a monthly pension
// is payable only with ≥10 years of pensionable service. Leave before that and
// the benefit is a contribution refund (withdrawal benefit), NOT a pension.
// So the projected superannuation pension below is contingent on serving to 60.
export const CMPS_MIN_QUALIFYING_YEARS = 10;
export const CMPS_VEST_DATE = new Date(
  DOJ.getFullYear() + CMPS_MIN_QUALIFYING_YEARS, DOJ.getMonth(), DOJ.getDate()
);

// Superannuation date = last day of the birth month in the 60th year (CIL rules)
export const CMPS_RETIREMENT_DATE = new Date(
  DOB.getFullYear() + SUPERANNUATION_AGE,
  DOB.getMonth() + 1, // first day of next month minus 1 = last day of birth month
  0
);

// Total employee + employer contributions paid in up to atDate
export function cmpsTotalPaid(atDate) {
  const limit = typeof atDate === 'string' ? atDate.slice(0, 7) : atDate.toISOString().slice(0, 7);
  let total = 0;
  for (const c of CMPS_CONTRIBUTIONS) {
    if (c.month <= limit) total += c.emp * 2;
  }
  return Math.round(total);
}

// Latest known regular monthly contribution (excludes arrear months)
function latestRegular() {
  const sorted = [...CMPS_CONTRIBUTIONS].sort((a, b) => b.month.localeCompare(a.month));
  // Skip obvious arrear months (more than 1.5× the prior month)
  for (let i = 0; i < sorted.length - 1; i++) {
    if (sorted[i].emp < sorted[i + 1].emp * 2.5) return sorted[i].emp;
  }
  return sorted[0].emp;
}

// Estimate basic pay from the latest CMPS contribution.
// CMPS deduction ≈ basic × contribution_rate. Rate was 5% pre-2017, varies after.
// We back-calculate from the contribution amount (approximate).
function estimateBasicFromContrib(empContrib) {
  // CMPS rate for officers (Group-B/above) = ~4% of basic; use 4.5% as midpoint
  return Math.round(empContrib / 0.045);
}

// Projected monthly pension at superannuation
// atDate: valuation date (how much service to date, project forward)
export function cmpsMonthlyPension(atDate) {
  const now = typeof atDate === 'string' ? new Date(atDate) : atDate;

  // Pensionable service in years at retirement
  const serviceMs = CMPS_RETIREMENT_DATE - DOJ;
  const serviceYears = Math.min(35, serviceMs / (365.25 * 24 * 3600 * 1000));

  // Pensionable salary: use latest regular basic pay estimate
  const lastEmp = latestRegular();
  const pensionableSalary = estimateBasicFromContrib(lastEmp);

  const monthly = Math.round((pensionableSalary * serviceYears) / 70);
  return monthly;
}

// Service completed at atDate (years, decimal)
export function cmpsServiceYears(atDate) {
  const now = typeof atDate === 'string' ? new Date(atDate) : atDate;
  const ms = Math.max(0, now - DOJ);
  return ms / (365.25 * 24 * 3600 * 1000);
}
