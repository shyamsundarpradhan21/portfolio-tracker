// Fixed-deposit day-change for the growth snapshot. FD value is DETERMINISTIC (no
// market price), so the day's growth = accrued interest = value(today) −
// value(yesterday), computed straight from the deposit terms — no fetch, always
// succeeds. Mirrors app/lib/backfill.js's FD valuation and app/lib/calc.js
// `compound` (quarterly compounding, smooth via fractional quarters) so the captured
// growth matches the FD figures the app shows; fd.test.js locks the formula.
//
// READ-ONLY of the private FDS terms; emits only an aggregate ₹ (no PII).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const DAY = 86400000;
const YEAR = 365.25 * DAY;                       // matches app/lib/backfill.js
const r2 = (n) => Math.round(n * 100) / 100;

// P × (1 + rate%/400)^(4×years) — quarterly compounding; fractional years → smooth.
export const compound = (P, ratePct, years) => P * Math.pow(1 + ratePct / 400, 4 * years);

// Value of ONE deposit on ISO date d: compounded and clamped at maturity (a matured
// FD stops accruing), or flat principal when no rate is recorded.
function fdValueOn(f, d) {
  const yrs = Math.min((new Date(d) - new Date(f.open)) / YEAR, (new Date(f.matures) - new Date(f.open)) / YEAR);
  return f.rate != null ? compound(f.principal, f.rate, yrs) : f.principal;
}

// ISO date shifted by `days` (UTC-safe; FD dates are date-only).
const shiftIso = (iso, days) => new Date(new Date(iso + 'T00:00:00Z').getTime() + days * DAY).toISOString().slice(0, 10);

// Pure: the day's FD interest = Σ value(date) − value(date−1) over deposits that
// were ALREADY OPEN yesterday (one opened TODAY is new money, not growth) and not
// yet redeemed (a redemption is NW-neutral cash, not growth). Matured deposits net
// to 0 (value frozen at maturity). → ₹ accrued that day.
export function fdDayChange(fds, dateIso) {
  const prev = shiftIso(dateIso, -1);
  let net = 0;
  for (const f of Array.isArray(fds) ? fds : []) {
    if (!f || f.status === 'pipeline') continue;        // not deployed yet
    if (!(f.open <= prev)) continue;                    // opened today/later → principal isn't growth
    if (f.closedOn && f.closedOn <= dateIso) continue;  // redeemed → NW-neutral, not growth
    if (f.rate == null) continue;                       // no rate → no accrual
    net += fdValueOn(f, dateIso) - fdValueOn(f, prev);
  }
  return r2(net);
}

// Reads the private FDS terms and returns { net } for `dateIso` (IST date), or null
// when the private file / FDS is unavailable. Same private-file source as US/MF.
export function pullFdDayChange(dateIso, priv) {
  // `priv` injected by the cloud route (KV portfolio:v1); else read the gitignored file.
  if (!priv) {
    try { priv = JSON.parse(readFileSync(join(ROOT, 'data', 'portfolio.private.json'), 'utf8')); }
    catch { return null; }
  }
  const fds = priv?.FDS;
  if (!Array.isArray(fds) || !fds.length) return null;
  return { net: fdDayChange(fds, dateIso) };
}
