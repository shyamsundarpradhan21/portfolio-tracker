// Server-side FII/DII cash-flow trail — bootstrap the NSE cookie, read the latest
// fiidiiTradeReact session, and persist one point/session into KV premarket:fiidiiTrail
// (cap ~20 ≈ a month). Cross-device + gap-free because it builds server-side. Shared by
// /api/premarket (the live Market Wrap) and /api/snapshot (the daily cron that keeps the
// trail building even when no browser is open). Without a KV store it's a graceful no-op
// and the client's localStorage trail (lib/fiidii.js) is the source of truth.

import { UA } from './ua';
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

// ── FII derivative positioning (NSE participant-wise OI CSV) ─────────────────
// Underneath the cash net (fiidiiTradeReact, above) sits the F&O book. NSE's
// participant-wise open-interest CSV breaks every participant (FII / DII / Pro /
// retail "Client") across index & stock futures and index & stock options, in
// number of contracts. We read it to derive the FII *stance* the cash row hides
// (e.g. cash flat, but net-short futures + long puts = bearish) and the classic
// FII-vs-retail divergence. Plain CSV, no parser dependency. Keyed to the
// authoritative cash session date so it never asks NSE for a non-existent file.
// Shared by /api/premarket (live Wrap) and captureFiiDiiTrail (the snapshot cron).
const MON = { jan: '01', feb: '02', mar: '03', apr: '04', may: '05', jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12' };
// 'DD-Mon-YYYY' (cash feed) → 'DDMMYYYY' (CSV filename); null if unrecognised.
function toDDMMYYYY(d) {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(String(d || ''));
  const mm = m && MON[m[2].toLowerCase()];
  return mm ? `${m[1]}${mm}${m[3]}` : null;
}
// IST 'today' as DDMMYYYY — fallback when the cash feed gave no session date.
function istDDMMYYYY() {
  const ist = new Date(Date.now() + 5.5 * 3600 * 1000);
  const dd = String(ist.getUTCDate()).padStart(2, '0');
  const mm = String(ist.getUTCMonth() + 1).padStart(2, '0');
  return `${dd}${mm}${ist.getUTCFullYear()}`;
}

export async function fetchParticipantStats(cookie, sessionDate) {
  const src = 'NSE fao_participant_oi';
  const ddmmyyyy = toDDMMYYYY(sessionDate) || istDDMMYYYY();
  try {
    const res = await fetch(`https://nsearchives.nseindia.com/content/nsccl/fao_participant_oi_${ddmmyyyy}.csv`, {
      headers: { 'User-Agent': UA, Accept: 'text/csv,*/*', 'Accept-Language': 'en-US,en;q=0.9', Referer: 'https://www.nseindia.com/', Cookie: cookie || '' },
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return { stale: true, error: `NSE HTTP ${res.status}`, source: src };
    const rows = (await res.text()).trim().split('\n').map((l) => l.split(',').map((c) => c.trim().replace(/^"|"$/g, '')));
    if (rows.length < 3) return { stale: true, error: 'no rows', source: src };
    const num = (v) => { const n = parseInt(String(v).replace(/[", ]/g, ''), 10); return isFinite(n) ? n : 0; };
    // Cols by position (header has trailing-space labels, so index not name):
    // 1 FutIdxLong 2 FutIdxShort 3 FutStkLong 4 FutStkShort
    // 5 OptIdxCallLong 6 OptIdxPutLong 7 OptIdxCallShort 8 OptIdxPutShort
    const pick = (re) => rows.find((r) => re.test(String(r[0] || '')));
    const net = (r) => r && ({
      idxFut: num(r[1]) - num(r[2]),       // long − short  (net position, in contracts)
      stkFut: num(r[3]) - num(r[4]),
      idxCall: num(r[5]) - num(r[7]),      // call long − call short
      idxPut: num(r[6]) - num(r[8]),       // put  long − put  short
    });
    // Exact match: the header row is "Client Type", which a /^Client/ prefix would
    // wrongly grab before the "Client" data row (parsing its labels to 0).
    const fii = net(pick(/^FII$/i));
    const retail = net(pick(/^Client$/i));
    if (!fii) return { stale: true, error: 'no FII row', source: src };

    // Stance: net-short futures, long puts and short calls each read bearish.
    const bear = (fii.idxFut < 0 ? 1 : 0) + (fii.idxPut > 0 ? 1 : 0) + (fii.idxCall < 0 ? 1 : 0);
    const bull = (fii.idxFut > 0 ? 1 : 0) + (fii.idxPut < 0 ? 1 : 0) + (fii.idxCall > 0 ? 1 : 0);
    const stance = bear > bull ? 'bearish' : bull > bear ? 'bullish' : 'mixed';
    // Divergence: retail leaning the opposite way on index futures (the classic split).
    const divergence = !!retail && fii.idxFut !== 0 && retail.idxFut !== 0 && Math.sign(fii.idxFut) !== Math.sign(retail.idxFut);

    return { asOf: sessionDate || null, source: src, fii, retail: retail || null, stance, divergence };
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
export async function persistTrail(latest, derivs) {
  const kv = await kvClient();
  if (!kv || !latest?.date) return null;
  const fii = latest.fii?.net, dii = latest.dii?.net;
  try {
    const arr = (await kv.get(KV_KEY)) || [];
    if ((fii == null || !isFinite(fii)) && (dii == null || !isFinite(dii))) return arr.length ? arr : null;
    const point = { d: latest.date, fii: isFinite(fii) ? fii : null, dii: isFinite(dii) ? dii : null };
    if (derivs && !derivs.stale && derivs.fii) {
      point.der = { ...derivs.fii, stance: derivs.stance, divergence: derivs.divergence, rIdxFut: derivs.retail?.idxFut };
    }
    const i = arr.findIndex((p) => p.d === point.d);
    if (i >= 0 && !point.der && arr[i].der) point.der = arr[i].der;
    if (i >= 0) arr[i] = point; else arr.push(point);
    arr.sort((a, b) => new Date(a.d) - new Date(b.d));
    const trimmed = arr.slice(-TRAIL_CAP);
    await kv.set(KV_KEY, trimmed);
    return trimmed;
  } catch {
    return null;
  }
}

// Convenience for the cron: cookie → fetch (cash + derivative positioning) → persist.
// Captures the FII derivative stance onto the same session point so the daily cron
// builds the positioning history too, not just cash — parity with the on-demand Wrap
// load (/api/premarket), which is the whole point of not needing a second cron.
// Returns { fiidii, trail }.
export async function captureFiiDiiTrail() {
  const cookie = await nseCookie();
  const fiidii = await fetchFiiDii(cookie);
  const live = fiidii && !fiidii.stale ? fiidii.latest : null;
  const derivs = live ? await fetchParticipantStats(cookie, live.date) : null;
  const trail = await persistTrail(live, derivs);
  return { fiidii, trail };
}
