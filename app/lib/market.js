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
