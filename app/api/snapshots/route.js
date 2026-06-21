// Daily net-worth snapshots, persisted server-side (Vercel KV) so the Overview growth
// curve is cross-device instead of per-browser. The client (lib/snapshots.js) keeps a
// localStorage copy for instant render and syncs through here.
//
// OWNER-NAMESPACED ON PURPOSE: the key carries an owner id so this personal dashboard
// stays clean if it ever becomes a FAMILY one — each member's NW history lives under its
// own `snapshots:nw:<owner>` namespace, never commingled. Today the owner comes from env
// (single user); a future multi-user build resolves it from the authenticated session.
//
// Private financial data: runtime nodejs, force-dynamic, no-store, server-only — the KV
// creds and the data never reach the client bundle. Read-only externally; the only writer
// is our own POST.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 15;

const OWNER = ((process.env.DASHBOARD_OWNER || 'primary').replace(/[^a-z0-9_-]/gi, '')) || 'primary';
const KEY = `snapshots:nw:${OWNER}`;
const CAP = 800;            // ~2+ years of daily points
const MAX_DAY_MOVE = 0.3;   // reject partial-quote spikes (a sleeve reading ₹0), same as the client

const NO_STORE = { headers: { 'Cache-Control': 'no-store' } };

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}
async function kv() {
  const creds = kvCreds();
  if (!creds) return null;
  try { const { createClient } = await import('@vercel/kv'); return createClient(creds); } catch { return null; }
}

export async function GET() {
  const k = await kv();
  if (!k) return Response.json({ snapshots: [], owner: OWNER, stale: true }, NO_STORE);
  try {
    const arr = await k.get(KEY);
    return Response.json({ snapshots: Array.isArray(arr) ? arr : [], owner: OWNER }, NO_STORE);
  } catch {
    return Response.json({ snapshots: [], owner: OWNER, stale: true }, NO_STORE);
  }
}

export async function POST(req) {
  const k = await kv();
  if (!k) return Response.json({ ok: false, error: 'no store' }, { status: 503, ...NO_STORE });
  let snap;
  try { snap = await req.json(); } catch { return Response.json({ ok: false, error: 'bad json' }, { status: 400, ...NO_STORE }); }
  if (!snap || !snap.d || !Number.isFinite(snap.nw)) return Response.json({ ok: false, error: 'invalid snapshot' }, { status: 400, ...NO_STORE });
  try {
    const arr = (await k.get(KEY)) || [];
    // Plausibility vs the most recent prior day, net of fresh deposits — a ₹0-sleeve
    // partial-quote write never persists (same guard the client applies).
    const prior = arr.filter((s) => s.d < snap.d).pop();
    if (prior && prior.nw > 0) {
      const dep = (snap.invested || 0) - (prior.invested || 0);
      if (Math.abs(snap.nw - prior.nw - dep) / prior.nw > MAX_DAY_MOVE) {
        return Response.json({ ok: false, error: 'implausible move (partial quotes?)' }, { status: 422, ...NO_STORE });
      }
    }
    // Persist the per-sleeve allocation/basis (`sl`) too — the historical-allocation
    // waffles read it when scrubbing past dates, so it has to survive the round-trip.
    const point = { d: snap.d, nw: snap.nw, assets: snap.assets ?? undefined, invested: snap.invested ?? undefined, sl: (snap.sl && typeof snap.sl === 'object') ? snap.sl : undefined };
    const i = arr.findIndex((s) => s.d === snap.d);
    if (i >= 0) arr[i] = point; else arr.push(point);
    arr.sort((a, b) => (a.d < b.d ? -1 : 1));
    const trimmed = arr.slice(-CAP);
    await k.set(KEY, trimmed);
    return Response.json({ ok: true, count: trimmed.length, snapshots: trimmed }, NO_STORE);
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'kv error' }, { status: 500, ...NO_STORE });
  }
}

// Remove one snapshot by date (?d=YYYY-MM-DD) — purges a stale non-trading-day point.
export async function DELETE(req) {
  const k = await kv();
  if (!k) return Response.json({ ok: false, error: 'no store' }, { status: 503, ...NO_STORE });
  const d = new URL(req.url).searchParams.get('d');
  if (!d) return Response.json({ ok: false, error: 'missing d' }, { status: 400, ...NO_STORE });
  try {
    const arr = (await k.get(KEY)) || [];
    const next = arr.filter((s) => s && s.d !== d);
    if (next.length !== arr.length) await k.set(KEY, next);
    return Response.json({ ok: true, count: next.length }, NO_STORE);
  } catch (e) {
    return Response.json({ ok: false, error: e?.message || 'kv error' }, { status: 500, ...NO_STORE });
  }
}
