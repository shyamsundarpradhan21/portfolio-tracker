'use client';

// CMPF corpus at any date: month-by-month EPF-style simulation.
// Contributions are employee (from payslip) × 2 for the 50:50 employer match.
// Interest accrues monthly (rate/12 on opening balance) and is credited to the
// corpus at the end of each financial year (March 31).
// Arrear contributions are treated as received in the month they appear.

import { CMPF_CONTRIBUTIONS, CMPF_RATES } from '../portfolio';

// 'YYYY-MM' → FY string 'YYYY-YY'
function monthFy(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

export function cmpfCorpus(atDate) {
  const limit = typeof atDate === 'string' ? atDate.slice(0, 7) : atDate.toISOString().slice(0, 7);

  // Month-indexed map of employee contributions (arrears merged into their payslip month)
  const map = {};
  for (const c of CMPF_CONTRIBUTIONS) map[c.month] = (map[c.month] || 0) + c.emp;

  const first = Object.keys(map).sort()[0]; // '2023-02'
  let [y, mo] = first.split('-').map(Number);
  const [ey, em] = limit.split('-').map(Number);

  let corpus = 0;
  let pendingInt = 0;

  while (y < ey || (y === ey && mo <= em)) {
    const ym = `${y}-${String(mo).padStart(2, '0')}`;
    const contrib = ((map[ym] || 0)) * 2; // employee + employer
    const rate = CMPF_RATES[monthFy(ym)] ?? 0.076;

    pendingInt += corpus * (rate / 12); // interest on opening balance this month
    corpus += contrib;

    if (mo === 3) {                      // FY ends March — credit accumulated interest
      corpus += pendingInt;
      pendingInt = 0;
    }

    mo++;
    if (mo > 12) { mo = 1; y++; }
  }

  return Math.round(corpus);
}

// Total contributions paid in (employee + employer match) up to atDate — the
// CMPF "invested" basis, so corpus − paid = accrued interest. Used to attribute
// the sleeve's market gain (interest) separately from fresh contributions.
export function cmpfPaid(atDate) {
  const limit = typeof atDate === 'string' ? atDate.slice(0, 7) : atDate.toISOString().slice(0, 7);
  let paid = 0;
  for (const c of CMPF_CONTRIBUTIONS) if (c.month <= limit) paid += c.emp * 2;
  return Math.round(paid);
}
