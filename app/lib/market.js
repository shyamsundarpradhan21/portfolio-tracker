/** Market open/closed by exchange wall-clock — deterministic, Mon-Fri only. */
export function marketOpenByClock(timeZone, startMin, endMin) {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone, weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false,
    }).formatToParts(new Date());
    const get = (t) => p.find((x) => x.type === t)?.value;
    const wd = get('weekday');
    if (wd === 'Sat' || wd === 'Sun') return false;
    let hh = parseInt(get('hour'), 10); if (hh === 24) hh = 0;
    const mins = hh * 60 + parseInt(get('minute'), 10);
    return mins >= startMin && mins < endMin;
  } catch { return null; }
}

export const nseOpenNow  = () => marketOpenByClock('Asia/Kolkata',   555, 930);
export const nyseOpenNow = () => marketOpenByClock('America/New_York', 570, 960);

/** Derive a Yahoo-style session state from a v8 chart `meta`.
 *  Yahoo removed `meta.marketState` from the chart payload (mid-2026) and locked
 *  the v7 quote endpoint (401), so we read `currentTradingPeriod` instead — Yahoo
 *  computes that window against the exchange calendar, so it stays holiday-aware
 *  (on a holiday it points at a real session, not today's phantom one). start/end
 *  are UTC epoch seconds. Returns 'REGULAR' | 'PRE' | 'POST' | 'CLOSED' | 'UNKNOWN'. */
export function deriveMarketState(meta, nowMs = Date.now()) {
  const tp = meta && meta.currentTradingPeriod;
  if (!tp) return 'UNKNOWN';
  const now = Math.floor(nowMs / 1000);
  const inWin = (p) => p && typeof p.start === 'number' && now >= p.start && now < p.end;
  if (inWin(tp.regular)) return 'REGULAR';
  if (inWin(tp.pre)) return 'PRE';
  if (inWin(tp.post)) return 'POST';
  return 'CLOSED';
}

/** Reduce Yahoo per-symbol marketState values to one exchange state.
 *  Yahoo knows about exchange holidays and half-days — the wall-clock
 *  check above doesn't — so prefer this whenever quotes are available.
 *  Returns 'REGULAR' | 'PRE' | 'POST' | 'CLOSED' | null (no usable quotes). */
export function marketStateFromQuotes(prices, isExchangeSym) {
  const states = Object.entries(prices || {})
    .filter(([sym, q]) => isExchangeSym(sym) && q && !q.error && q.state && q.state !== 'UNKNOWN')
    .map(([, q]) => q.state);
  if (!states.length) return null;
  if (states.includes('REGULAR')) return 'REGULAR';
  if (states.some((s) => s.startsWith('PRE'))) return 'PRE';
  if (states.some((s) => s.startsWith('POST'))) return 'POST';
  return 'CLOSED';
}
