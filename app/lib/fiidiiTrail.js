// Server-side FII/DII cash-flow trail — bootstrap the NSE cookie, read the latest
// fiidiiTradeReact session, and persist one point/session into KV premarket:fiidiiTrail
// (cap ~20 ≈ a month). Cross-device + gap-free because it builds server-side. Shared by
// /api/premarket (the live Market Wrap) and /api/snapshot (the daily cron that keeps the
// trail building even when no browser is open). Without a KV store it's a graceful no-op
// and the client's localStorage trail (lib/fiidii.js) is the source of truth.

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// NSE gates its JSON behind a cookie set on the home page. Bootstrap it ONCE and reuse
// for every NSE endpoint (indices + FII/DII + participant OI). Returns '' on failure.
export async function nseCookie() {
  try {
    const boot = await fetch('https://www.nseindia.com/', {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    return (boot.headers.get('set-cookie') || '')
      .split(/,(?=[^ ;]+=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  } catch {
    return '';
  }
}

// NSE fiidiiTradeReact → today's FII + DII cash net. Often blocked from data-centre IPs,
// so on any failure returns { stale, error } and the UI shows the trail as unavailable.
export async function fetchFiiDii(cookie) {
  const src = 'NSE fiidiiTradeReact';
  try {
    const res = await fetch('https://www.nseindia.com/api/fiidiiTradeReact', {
      headers: {
        'User-Agent': UA,
        Accept: 'application/json',
        'Accept-Language': 'en-US,en;q=0.9',
        Referer: 'https://www.nseindia.com/reports/fii-dii',
        ...(cookie ? { Cookie: cookie } : {}),
      },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { stale: true, error: `NSE HTTP ${res.status}`, source: src };

    const json = await res.json();
    const rows = Array.isArray(json) ? json : json?.data;
    if (!Array.isArray(rows) || !rows.length) return { stale: true, error: 'no rows', source: src };

    const pick = (re) => rows.find((r) => re.test(String(r.category || '')));
    const fii = pick(/FII|FPI/i);
    const dii = pick(/DII/i);
    const num = (v) => { const n = parseFloat(String(v).replace(/,/g, '')); return isFinite(n) ? n : null; };
    const norm = (r) => r && ({ buy: num(r.buyValue), sell: num(r.sellValue), net: num(r.netValue), date: r.date });

    const latest = { fii: norm(fii), dii: norm(dii), date: (fii || dii)?.date || null, source: src };
    if (latest.fii?.net == null && latest.dii?.net == null) return { stale: true, error: 'unparseable', source: src };
    return { latest, asOf: latest.date, source: src };
  } catch (e) {
    return { stale: true, error: e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'fetch failed'), source: src };
  }
}

// Vercel KV / Upstash, injected under either naming depending on how the store is
// connected. Dynamic import so a route never hard-depends on the store being present.
const KV_KEY = 'premarket:fiidiiTrail';
const TRAIL_CAP = 20;

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function kvClient() {
  const creds = kvCreds();
  if (!creds) return null;
  try {
    const { createClient } = await import('@vercel/kv');
    return createClient(creds);
  } catch {
    return null;
  }
}

// Upsert today's FII/DII point into the KV trail (deduped by date, time-sorted, capped).
// Returns the trail array, or null when there's no store / nothing live to record.
export async function persistTrail(latest) {
  const kv = await kvClient();
  if (!kv || !latest?.date) return null;
  const fii = latest.fii?.net, dii = latest.dii?.net;
  try {
    const arr = (await kv.get(KV_KEY)) || [];
    if ((fii == null || !isFinite(fii)) && (dii == null || !isFinite(dii))) return arr.length ? arr : null;
    const point = { d: latest.date, fii: isFinite(fii) ? fii : null, dii: isFinite(dii) ? dii : null };
    const i = arr.findIndex((p) => p.d === point.d);
    if (i >= 0) arr[i] = point; else arr.push(point);
    arr.sort((a, b) => new Date(a.d) - new Date(b.d));
    const trimmed = arr.slice(-TRAIL_CAP);
    await kv.set(KV_KEY, trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

// Convenience for the cron: cookie → fetch → persist. Returns { fiidii, trail }.
export async function captureFiiDiiTrail() {
  const cookie = await nseCookie();
  const fiidii = await fetchFiiDii(cookie);
  const trail = await persistTrail(fiidii && !fiidii.stale ? fiidii.latest : null);
  return { fiidii, trail };
}
