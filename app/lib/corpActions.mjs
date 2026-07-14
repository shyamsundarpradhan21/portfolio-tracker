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

// Classify an NSE corp-action subject into the value-bearing types we surface. Everything
// else (AGM/EGM, board meeting, name change, record-date-only) → null and is skipped.
export function classify(subject) {
  const s = String(subject || '');
  if (/dividend/i.test(s)) return 'dividend';
  if (/bonus/i.test(s)) return 'bonus';
  if (/split|sub-?division|face\s*value/i.test(s)) return 'split';
  if (/rights/i.test(s)) return 'rights';
  return null;
}

// Ratio "num:den" for bonus/split/rights. "Bonus 1:1" → "1:1". A face-value split
// "From Rs 10/- To Rs 2/-" → "5:1" (each share becomes 5). Null when unparseable.
export function actionRatio(subject, type) {
  const s = String(subject || '');
  const explicit = s.match(/(\d+)\s*:\s*(\d+)/);
  if (explicit) return `${explicit[1]}:${explicit[2]}`;
  if (type === 'split') {
    const fv = s.match(/(?:Rs\.?|₹|INR)?\s*(\d+(?:\.\d+)?)\s*(?:\/-)?\s*(?:to|-|→)\s*(?:Rs\.?|₹|INR)?\s*(\d+(?:\.\d+)?)/i);
    if (fv) { const from = +fv[1], to = +fv[2]; if (from > to && to > 0) return `${Math.round(from / to)}:1`; }
  }
  return null;
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

// Whole days from `todayISO` (YYYY-MM-DD) to an ex-date. 0 = today, 1 = tomorrow.
// Accepts an NSE date ("15-Jul-2026") or an ISO date ("2026-08-20", the US feed's form).
export function daysUntil(exDate, todayISO) {
  const ex = parseNseDate(exDate) ?? Date.parse(`${String(exDate || '').slice(0, 10)}T00:00:00Z`);
  const t = Date.parse(`${String(todayISO || '').slice(0, 10)}T00:00:00Z`);
  if (!isFinite(ex) || !isFinite(t)) return null;
  return Math.round((ex - t) / 86400000);
}

/**
 * NSE corporate-actions JSON -> upcoming value-bearing corp actions within `horizonDays`,
 * ex-date today or later. `[{ sym, name, exDate, type, amount, ratio }]`, soonest first
 * (type = dividend|bonus|split|rights; amount for dividends, ratio for bonus/split/rights).
 * Pure; `todayISO` is injected so the window is deterministic/testable.
 */
export function mapCorpActions(json, { todayISO, horizonDays = 60 } = {}) {
  const rows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
  const out = [];
  for (const row of rows) {
    const subject = row?.subject ?? row?.purpose;
    const type = classify(subject);
    if (!type) continue;
    const exDate = row?.exDate ?? row?.exdate ?? row?.ex_date;
    const days = daysUntil(exDate, todayISO);
    if (days == null || days < 0 || days > horizonDays) continue;
    out.push({
      sym: String(row?.symbol ?? row?.symbolName ?? '').trim().toUpperCase(),
      name: (row?.comp ?? row?.companyName ?? row?.symbol ?? '').trim(),
      exDate,
      type,
      amount: type === 'dividend' ? dividendAmount(subject, row?.faceVal ?? row?.faceValue) : null,
      ratio: type === 'dividend' ? null : actionRatio(subject, type),
    });
  }
  return out
    .filter((d) => d.sym)
    .sort((a, b) => (parseNseDate(a.exDate) ?? Infinity) - (parseNseDate(b.exDate) ?? Infinity));
}
