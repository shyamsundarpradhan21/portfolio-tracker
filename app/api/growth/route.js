// Daily per-sleeve GROWTH snapshot — the resilient end-of-day fallback the app
// reads when no intraday tape exists for a day (the capture host was off, or a
// slow sleeve like MF/CMPF that never had an intraday tape). Reads KV growth:<date>
// (republished by scripts/snapshot-growth.mjs), falling back to the committed
// archive (data/growth.json) for older days or when KV is unconfigured. Private
// aggregate (net ₹ per sleeve) but kept force-dynamic + no-store like the other
// private-data routes so nothing private ships in the client bundle.

import growthArchive from '../../../data/growth.json';

export const dynamic = 'force-dynamic';

const isoDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s || '');

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function fromKV(date) {
  const creds = kvCreds();
  if (!creds) return null;
  try {
    const r = await fetch(creds.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', `growth:${date}`]),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const j = await r.json();
    return j?.result ? JSON.parse(j.result) : null;
  } catch { return null; }
}

// The last N IST dates, oldest first — the window the growth dashboard charts.
function lastNDates(n) {
  const out = [];
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  for (let i = 0; i < n; i++) {
    const d = new Date(ist);
    d.setUTCDate(d.getUTCDate() - i);
    out.push(d.toISOString().slice(0, 10));
  }
  return out.reverse();
}

// One MGET for the whole window (recent days live in KV; older fall back to the archive).
async function fromKVMany(dates) {
  const creds = kvCreds();
  if (!creds || !dates.length) return {};
  try {
    const r = await fetch(creds.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['MGET', ...dates.map((d) => `growth:${d}`)]),
      cache: 'no-store',
      signal: AbortSignal.timeout(6000),
    });
    const vals = (await r.json())?.result || [];
    const out = {};
    dates.forEach((d, i) => { if (vals[i]) { try { out[d] = JSON.parse(vals[i]); } catch { /* skip */ } } });
    return out;
  } catch { return {}; }
}

export async function GET(req) {
  const params = new URL(req.url).searchParams;
  const date = params.get('date');
  const daysParam = params.get('days') || '';
  const isMax = daysParam === 'max';
  const days = Math.min(370, Math.max(0, parseInt(daysParam, 10) || 0));

  // Range mode (?days=N) or Max (?days=max → ALL committed history + the recent KV
  // window). Range MGETs the window's dates; Max takes the whole archive and overlays
  // the recent KV (avoids a huge MGET over years of keys).
  if (isMax || days > 0) {
    const records = {};
    if (isMax) {
      Object.assign(records, growthArchive?.days || {});
      const recent = lastNDates(45);
      const kv = await fromKVMany(recent);
      for (const d of recent) if (kv[d]) records[d] = kv[d];
    } else {
      const dates = lastNDates(days);
      const kv = await fromKVMany(dates);
      for (const d of dates) { const rec = kv[d] || growthArchive?.days?.[d] || null; if (rec) records[d] = rec; }
    }
    return new Response(JSON.stringify({ days: isMax ? 'max' : days, records, source: 'kv+archive' }), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }

  // Single-date mode (existing).
  if (!isoDate(date)) {
    return Response.json({ error: 'date must be YYYY-MM-DD, or pass ?days=N' }, { status: 400 });
  }
  const live = await fromKV(date);
  const record = live || growthArchive?.days?.[date] || null;
  return new Response(JSON.stringify({ date, record, source: live ? 'kv' : 'archive' }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
