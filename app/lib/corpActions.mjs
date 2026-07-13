// Upcoming dividends from NSE corporate-actions, for the Wrap "Upcoming dividends"
// card. Pure — shared by the laptop capture (Node, residential IP reaches NSE) and
// the serving route, so a committed/KV snapshot and a live pull are the same shape.
// The route filters this market-wide calendar down to the user's holdings at serve
// time (private), so the committed snapshot itself is non-personal public data.
//
// NSE row: { symbol, comp, subject, exDate:'13-Jul-2026', faceVal, series, ... }.
// Amount lives in `subject` free-text ("Interim Dividend - Rs 12 Per Share", or a
// "…-250%" percentage of face value) — parsed here, null when it can't be read.

import { parseNseDate } from './niftyOptions.mjs';

const r2 = (n) => (n == null || !isFinite(+n) ? null : Math.round(+n * 100) / 100);

// A corp-action subject is a dividend (interim/final/special) — not a bonus/split/AGM.
export function isDividend(subject) {
  return /dividend/i.test(String(subject || ''));
}

/**
 * Per-share dividend amount from the subject text. Handles "Rs 12 Per Share",
 * "Rs 20/- Per Share", "₹0.65 per share", and "…-250%" (percentage of face value,
 * needs `faceVal`). Returns null when nothing parseable.
 */
export function dividendAmount(subject, faceVal) {
  const s = String(subject || '');
  const rs = s.match(/(?:Rs\.?|₹|INR)\s*([\d]+(?:\.\d+)?)/i);
  if (rs) return r2(+rs[1]);
  const pc = s.match(/([\d]+(?:\.\d+)?)\s*%/);
  if (pc && isFinite(+faceVal)) return r2((+pc[1] / 100) * +faceVal);
  return null;
}

// Whole days from `todayISO` (YYYY-MM-DD) to an NSE ex-date. 0 = today, 1 = tomorrow.
export function daysUntil(exDate, todayISO) {
  const ex = parseNseDate(exDate);
  const t = Date.parse(`${String(todayISO || '').slice(0, 10)}T00:00:00Z`);
  if (ex == null || !isFinite(t)) return null;
  return Math.round((ex - t) / 86400000);
}

/**
 * NSE corporate-actions JSON -> upcoming dividends within `horizonDays`, ex-date
 * today or later. `[{ sym, name, exDate, amount }]`, soonest first. Pure; `todayISO`
 * is injected so the window is deterministic/testable.
 */
export function mapCorpActions(json, { todayISO, horizonDays = 60 } = {}) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const out = [];
  for (const row of rows) {
    const subject = row?.subject ?? row?.purpose;
    if (!isDividend(subject)) continue;
    const exDate = row?.exDate ?? row?.exdate ?? row?.ex_date;
    const days = daysUntil(exDate, todayISO);
    if (days == null || days < 0 || days > horizonDays) continue;
    out.push({
      sym: String(row?.symbol ?? row?.symbolName ?? '').trim().toUpperCase(),
      name: (row?.comp ?? row?.companyName ?? row?.symbol ?? '').trim(),
      exDate,
      amount: dividendAmount(subject, row?.faceVal ?? row?.faceValue),
    });
  }
  return out
    .filter((d) => d.sym)
    .sort((a, b) => (parseNseDate(a.exDate) ?? Infinity) - (parseNseDate(b.exDate) ?? Infinity));
}
