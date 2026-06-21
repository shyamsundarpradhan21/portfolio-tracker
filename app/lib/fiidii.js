'use client';

// FII/DII flow trail, accumulated in localStorage — one point per NSE session,
// keyed by the session date NSE stamps the figures with. NSE's public endpoint
// only returns the latest session, so (exactly like the net-worth dailies in
// snapshots.js) the trail builds forward: each day the dashboard sees a new
// session, it appends a point, and we keep the last ~20 to surface recurring
// buying/selling streaks.
//
// This is the FALLBACK path. The primary trail is the cross-device server store
// (Vercel KV, persisted by /api/premarket + the daily cron in vercel.json), which
// page.js prefers whenever the pre-market feed carries it. This per-browser
// localStorage trail is used only when no store is wired — e.g. local dev.

const KEY = 'nwTracker.fiidiiTrail';
const CAP = 20; // 20-session fallback trail (server KV trail is the primary source)

export function getFiiDiiTrail() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}

// latest: { fii:{net}, dii:{net}, date } as returned by /api/premarket. Records
// one point per session date; a same-date re-read overwrites (NSE revises the
// provisional figure to final the next morning). Non-numeric nets are skipped so
// a stale/garbled fetch never pollutes the trail with a zero that reads as flat.
export function recordFiiDii(latest) {
  if (!latest || !latest.date) return getFiiDiiTrail();
  const fii = latest.fii?.net, dii = latest.dii?.net;
  if ((fii == null || !isFinite(fii)) && (dii == null || !isFinite(dii))) return getFiiDiiTrail();
  try {
    const arr = getFiiDiiTrail();
    const point = { d: latest.date, fii: isFinite(fii) ? fii : null, dii: isFinite(dii) ? dii : null };
    const i = arr.findIndex((p) => p.d === point.d);
    if (i >= 0) arr[i] = point; else arr.push(point);
    // NSE dates are 'DD-Mon-YYYY'; sort by parsed time so ordering is stable.
    arr.sort((a, b) => new Date(a.d) - new Date(b.d));
    const trimmed = arr.slice(-CAP);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch { return getFiiDiiTrail(); }
}
