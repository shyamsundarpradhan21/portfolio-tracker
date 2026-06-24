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
