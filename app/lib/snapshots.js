'use client';

// Daily net-worth snapshots, persisted in localStorage so the Overview can show
// a *real* historical growth curve that accumulates over time. One snapshot per
// calendar day (same-day re-records overwrite with the latest live values).
//
// There's no server-side store in this app, so history is per-browser. To make
// it cross-device we'd persist to a backend (e.g. Vercel KV/Blob) instead — the
// read/write surface here (getSnapshots / recordSnapshot) is the seam for that.

const KEY = 'nwTracker.snapshots';
const CAP = 800; // ~2+ years of daily points

export function getSnapshots() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    return Array.isArray(a) ? a : [];
  } catch { return []; }
}

// snap: { d:'YYYY-MM-DD', nw, assets, invested }
export function recordSnapshot(snap) {
  if (!snap || !snap.d || !Number.isFinite(snap.nw)) return getSnapshots();
  try {
    const arr = getSnapshots();
    const i = arr.findIndex((s) => s.d === snap.d);
    if (i >= 0) arr[i] = snap; else arr.push(snap);
    arr.sort((a, b) => (a.d < b.d ? -1 : 1));
    const trimmed = arr.slice(-CAP);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch { return getSnapshots(); }
}
