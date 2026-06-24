// Pure NSE market-session helpers, kept dependency-free and side-effect-free so
// the daemon's gate logic unit-tests without a clock. Everything takes the epoch
// ms in (never reads Date.now itself) → deterministic tests.

// Epoch ms → a Date shifted into IST, so getUTC* on it reads IST wall-clock.
export const toIst = (ms) => new Date(ms + 5.5 * 3600 * 1000);

export const istParts = (ms) => {
  const d = toIst(ms);
  return {
    date: d.toISOString().slice(0, 10),
    hhmm: d.toISOString().slice(11, 16),
    dow: d.getUTCDay(),                       // 0 Sun … 6 Sat (IST)
    mins: d.getUTCHours() * 60 + d.getUTCMinutes(),
    iso: d.toISOString().replace(/\.\d+Z$/, '+05:30'),
  };
};

// NSE cash/F&O continuous session is 09:15–15:30 IST. We open the capture window a
// touch early (09:13) and close it a touch late (15:32) so the open print and the
// settle tick both land.
const OPEN = 9 * 60 + 13, CLOSE = 15 * 60 + 32;

// 'weekend' | 'pre' (before open) | 'open' | 'post' (after close)
export function marketState(ms) {
  const { dow, mins } = istParts(ms);
  if (dow === 0 || dow === 6) return 'weekend';
  if (mins < OPEN) return 'pre';
  if (mins > CLOSE) return 'post';
  return 'open';
}

// ── US (NYSE) session, expressed in IST ──
// NYSE 09:30–16:00 ET is 19:00–01:30 IST (EDT, summer) or 20:00–02:30 IST (EST,
// winter). We use ONE wide window 18:45→02:30 IST that absorbs the DST shift —
// capturing a little early/late is harmless (flat pre/post points). The session
// spans IST midnight, so it runs Mon-evening … Sat-early-morning IST.
const US_OPEN = 18 * 60 + 45;   // 18:45 IST
const US_CLOSE = 2 * 60 + 30;   // 02:30 IST (next calendar day)

// 'open' during the evening/overnight window on a US trading session, else 'closed'.
// A US session that starts Fri evening IST and ends Sat ~02:30 IST is still valid
// (Friday's US session), so the Saturday-early-morning tail counts; pure Sat/Sun
// daytime IST does not.
export function usMarketState(ms) {
  const { dow, mins } = istParts(ms);
  if (mins >= US_OPEN) {              // evening: Mon–Fri IST → US Mon–Fri sessions
    return dow >= 1 && dow <= 5 ? 'open' : 'closed';
  }
  if (mins <= US_CLOSE) {            // past-midnight tail belongs to the prior evening
    return dow >= 2 && dow <= 6 ? 'open' : 'closed'; // Tue–Sat early AM = Mon–Fri sessions
  }
  return 'closed';
}

// US session date = the IST date the session STARTED (evening). The past-midnight
// tail (IST < 06:00) buckets under the previous IST date, so one US session is one
// tape entry rather than split across two IST days.
export function usSessionDate(ms) {
  const d = toIst(ms);
  if (d.getUTCHours() < 6) d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}
