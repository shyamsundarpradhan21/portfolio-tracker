'use client';

// Daily net-worth snapshots, persisted in localStorage so the Overview can show
// a *real* historical growth curve that accumulates over time. One snapshot per
// calendar day (same-day re-records overwrite with the latest live values).
//
// There's no server-side store in this app, so history is per-browser. To make
// it cross-device we'd persist to a backend (e.g. Vercel KV/Blob) instead — the
// read/write surface here (getSnapshots / recordSnapshot) is the seam for that.

// SNAPSHOT.md (committed historical NW figures) + snapshot-sleeves.json (per-sleeve
// {v,i} keyed by date) are hydrated at runtime (server-imported in /api/portfolio,
// out of the client bundle). Read them at call time via the APP store.
import { APP } from './appData';

const KEY = 'nwTracker.snapshots';
const CAP = 800; // ~2+ years of daily points

// data/SNAPSHOT.md — committed, human-edited historical figures. Rows are
// authoritative for their dates: they override the synthetic backfill and
// feed the live XIRR. Parsed from the markdown table: | date | nw | assets | invested |
const num = (s) => { const n = +String(s || '').replace(/[,₹\s]/g, ''); return Number.isFinite(n) && n > 0 ? n : null; };
export function historicalSnapshots() {
  return (APP.snapMd || '').split('\n')
    .map((l) => l.match(/^\|\s*(\d{4}-\d{2}-\d{2})\s*\|([^|]*)\|([^|]*)\|([^|]*)\|/))
    .filter(Boolean)
    .map((m) => ({ d: m[1], nw: num(m[2]), assets: num(m[3]) ?? undefined, invested: num(m[4]) ?? undefined, sl: APP.snapSleeves[m[1]] || undefined }))
    .filter((s) => s.nw != null)
    .sort((a, b) => (a.d < b.d ? -1 : 1));
}

// Largest deposit-adjusted day-over-day NW move accepted as real. A diversified
// book doesn't move 30% in a day — but it does exactly that when a quote batch
// fails and a whole sleeve reads ₹0, which is the artifact this filters.
const MAX_DAY_MOVE = 0.3;

// A spike entry deviates >30% from BOTH neighbours while the neighbours agree
// with each other — the crash+recovery signature of a partial-quote snapshot,
// never of a real market move that persists across days.
const dropSpikes = (arr) => arr.filter((s, i) => {
  if (i === 0 || i === arr.length - 1) return true;
  const a = arr[i - 1].nw, b = arr[i + 1].nw;
  if (!(a > 0 && b > 0)) return true;
  return !(Math.abs(s.nw - a) / a > MAX_DAY_MOVE &&
           Math.abs(s.nw - b) / b > MAX_DAY_MOVE &&
           Math.abs(b - a) / a <= MAX_DAY_MOVE);
});

export function getSnapshots() {
  try {
    const a = JSON.parse(localStorage.getItem(KEY) || '[]');
    if (!Array.isArray(a)) return [];
    // Self-heal: purge spike entries already persisted by older builds so the
    // chart cliff disappears without the user clearing localStorage by hand.
    const healed = dropSpikes(a);
    if (healed.length !== a.length) localStorage.setItem(KEY, JSON.stringify(healed));
    return healed;
  } catch { return []; }
}

// snap: { d:'YYYY-MM-DD', nw, assets, invested }
export function recordSnapshot(snap) {
  if (!snap || !snap.d || !Number.isFinite(snap.nw)) return getSnapshots();
  try {
    const arr = getSnapshots();
    // Plausibility vs the most recent PRIOR day, net of fresh deposits, so a
    // big genuine contribution doesn't trip the filter. Same-day overwrites
    // are exempt — they're how an early bad write heals once quotes land.
    const prior = arr.filter((s) => s.d < snap.d).pop();
    if (prior && prior.nw > 0) {
      const dep = (snap.invested || 0) - (prior.invested || 0);
      if (Math.abs(snap.nw - prior.nw - dep) / prior.nw > MAX_DAY_MOVE) {
        console.warn(`snapshot rejected: NW ${snap.nw} vs ${prior.nw} on ${prior.d} — partial quotes?`);
        return arr;
      }
    }
    const i = arr.findIndex((s) => s.d === snap.d);
    if (i >= 0) arr[i] = snap; else arr.push(snap);
    arr.sort((a, b) => (a.d < b.d ? -1 : 1));
    const trimmed = arr.slice(-CAP);
    localStorage.setItem(KEY, JSON.stringify(trimmed));
    return trimmed;
  } catch { return getSnapshots(); }
}
