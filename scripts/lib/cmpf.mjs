// CMPF (Coal Mines Provident Fund) daily growth for the growth snapshot. CMPF is a
// withdrawable PF corpus that accrues interest, so its day's growth is the daily
// interest accrual (corpus × rate / 365) — the CMPF analogue of an FD's daily
// interest. Monthly salary-slip CONTRIBUTIONS are new money (not growth) and are
// excluded, exactly like an FD's principal. Mirrors app/lib/cmpf.js
// cmpfCorpus/cmpfDailyAccrual, but PURE (takes the data) so it reads from the private
// file rather than the client hydration. cmpf.test.js locks the formula.
//
// CMPS is deliberately NOT here: it's a defined-benefit pension with no corpus and no
// daily asset value (app/lib/cmps.js) — a future income right, not accruing wealth.
//
// READ-ONLY of the private CMPF terms; emits only an aggregate ₹.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DEFAULT_RATE = 0.076;

// 'YYYY-MM' → FY string 'YYYY-YY' (Apr-starting).
function monthFy(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m >= 4 ? `${y}-${String(y + 1).slice(2)}` : `${y - 1}-${String(y).slice(2)}`;
}

// CMPF corpus at atDate (pure): month-stepped EPF-style sim. Contributions ×2 for the
// 50:50 employer match; interest accrues monthly (rate/12 on opening balance), credited
// at FY-end (March). Mirrors app/lib/cmpf.js cmpfCorpus.
export function cmpfCorpus(contributions, rates, atDate) {
  const limit = (typeof atDate === 'string' ? atDate : atDate.toISOString()).slice(0, 7);
  const map = {};
  for (const c of Array.isArray(contributions) ? contributions : []) map[c.month] = (map[c.month] || 0) + c.emp;
  const months = Object.keys(map).sort();
  if (!months.length) return 0;
  let [y, mo] = months[0].split('-').map(Number);
  const [ey, em] = limit.split('-').map(Number);
  let corpus = 0, pendingInt = 0;
  while (y < ey || (y === ey && mo <= em)) {
    const ym = `${y}-${String(mo).padStart(2, '0')}`;
    const contrib = (map[ym] || 0) * 2;
    const rate = (rates || {})[monthFy(ym)] ?? DEFAULT_RATE;
    pendingInt += corpus * (rate / 12);   // interest on opening balance this month
    corpus += contrib;
    if (mo === 3) { corpus += pendingInt; pendingInt = 0; } // FY-end: credit interest
    mo++; if (mo > 12) { mo = 1; y++; }
  }
  return Math.round(corpus);
}

// The day's CMPF growth = interest accruing per day at the current corpus + FY rate
// (corpus × rate / 365). Smooth daily; excludes contributions. Mirrors app/lib/cmpf.js.
export function cmpfDailyAccrual(contributions, rates, atDate) {
  const ym = (typeof atDate === 'string' ? atDate : atDate.toISOString()).slice(0, 7);
  const rate = (rates || {})[monthFy(ym)] ?? DEFAULT_RATE;
  return Math.round((cmpfCorpus(contributions, rates, atDate) * rate) / 365);
}

// Reads private CMPF terms → { net } = today's interest accrual, or null.
export function pullCmpfDayChange(dateIso, priv) {
  // `priv` injected by the cloud route (KV portfolio:v1); else read the gitignored file.
  if (!priv) {
    try { priv = JSON.parse(readFileSync(join(ROOT, 'data', 'portfolio.private.json'), 'utf8')); }
    catch { return null; }
  }
  const contributions = priv?.CMPF_CONTRIBUTIONS;
  if (!Array.isArray(contributions) || !contributions.length) return null;
  const net = cmpfDailyAccrual(contributions, priv?.CMPF_RATES || {}, dateIso);
  return Number.isFinite(net) ? { net } : null;
}
