// Economic-calendar helpers for the Wrap "Upcoming" block. Keyless by design:
//   - US (+ optional global high-impact): ForexFactory weekly JSON, fetched in
//     the route and normalised by mapForexFactory().
//   - India: NO free feed exists, so we COMPUTE it from the stable release
//     cadence (MoSPI CPI/IIP ~12th, WPI ~14th, GDP at quarter-end months) plus a
//     maintained RBI MPC date list — same hand-maintained pattern as the repo
//     rate in macroBoard.js.
// Pure (no network, no Date.now — the caller passes `now`) so it unit-tests
// cleanly; the route owns all I/O.

// RBI MPC decision dates (the last day of each ~3-day meeting). Bi-monthly.
// MAINTAINED like the repo-rate constant — verify/extend against the published
// calendar at rbi.org.in (Monetary Policy → MPC meeting schedule).
export const RBI_MPC_DATES = ['2026-08-06', '2026-10-07', '2026-12-05', '2027-02-05'];

export const IMPACT = { high: 3, medium: 2, low: 1 };
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const ymd = (d) => d.toISOString().slice(0, 10);
const utc = (y, m, day) => new Date(Date.UTC(y, m, day));
const startOfDay = (now) => utc(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
const monthName = (y, m) => MONTH_ABBR[((m % 12) + 12) % 12];

// Dedupe by (date,title) and sort ascending by date, high-impact first on ties.
function dedupeSort(events) {
  const seen = new Set();
  const out = [];
  for (const e of events) {
    const k = e.date + '|' + e.title;
    if (!seen.has(k)) { seen.add(k); out.push(e); }
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || (IMPACT[b.impact] || 0) - (IMPACT[a.impact] || 0));
  return out;
}

// India's high-impact upcoming releases within `horizonDays` of `now`, computed
// from the publication cadence. Reference months are approximate (the schedule
// is stable; exact day can slip to the next working day).
export function indiaReleases(now, horizonDays = 45) {
  const today = startOfDay(now);
  const end = new Date(today.getTime() + horizonDays * 86400000);
  const within = (d) => d >= today && d <= end;
  const out = [];
  const monthsToScan = Math.ceil(horizonDays / 30) + 2;

  for (let k = 0; k <= monthsToScan; k++) {
    const y = now.getUTCFullYear();
    const m = now.getUTCMonth() + k;
    const yy = y + Math.floor(m / 12);
    const mm = ((m % 12) + 12) % 12;

    // CPI (prior month) + IIP (two months back) — MoSPI publishes both ~12th.
    const d12 = utc(yy, mm, 12);
    if (within(d12)) {
      out.push({ date: ymd(d12), title: `CPI inflation (${monthName(yy, mm - 1)})`, impact: 'high', region: 'india' });
      out.push({ date: ymd(d12), title: `IIP (${monthName(yy, mm - 2)})`, impact: 'medium', region: 'india' });
    }
    // WPI (prior month) ~14th.
    const d14 = utc(yy, mm, 14);
    if (within(d14)) out.push({ date: ymd(d14), title: `WPI inflation (${monthName(yy, mm - 1)})`, impact: 'medium', region: 'india' });

    // GDP at quarter-end release months: Feb→Q3, May→Q4, Aug→Q1, Nov→Q2 (~last day).
    const GDP = { 1: 'Q3', 4: 'Q4', 7: 'Q1', 10: 'Q2' }[mm];
    if (GDP) {
      const last = utc(yy, mm + 1, 0);
      if (within(last)) out.push({ date: ymd(last), title: `GDP growth (${GDP})`, impact: 'high', region: 'india' });
    }
  }

  // RBI MPC.
  for (const ds of RBI_MPC_DATES) {
    const d = new Date(ds + 'T00:00:00Z');
    if (within(d)) out.push({ date: ds, title: 'RBI MPC decision', impact: 'high', region: 'india' });
  }

  return dedupeSort(out);
}

// Normalise ForexFactory weekly events → upcoming US (+ optional global-high)
// rows. Each FF item is { title, country, date, impact, forecast, previous };
// `country` is a currency code (USD, EUR, …). Tolerant: skips malformed rows.
export function mapForexFactory(events, now, { horizonDays = 14, includeGlobalHigh = false } = {}) {
  if (!Array.isArray(events)) return [];
  const today = startOfDay(now);
  const end = new Date(today.getTime() + horizonDays * 86400000);
  const out = [];
  for (const e of events) {
    if (!e || !e.date || !e.title) continue;
    const d = new Date(e.date);
    if (isNaN(d.getTime()) || d < today || d > end) continue;
    const isUS = e.country === 'USD';
    const imp = String(e.impact || '').toLowerCase();
    const impact = imp === 'high' ? 'high' : imp === 'medium' ? 'medium' : 'low';
    if (!isUS && !(includeGlobalHigh && impact === 'high')) continue;
    out.push({
      date: e.date.slice(0, 10), // FF date is event-local; keep the calendar day
      title: e.title,
      impact,
      forecast: e.forecast || null,
      previous: e.previous || null,
      country: e.country,
      region: 'us',
    });
  }
  return dedupeSort(out);
}
