// Cloud daily GROWTH snapshot — the laptop-off-proof tier of the two-tier capture.
// A Vercel cron (03:00 IST, AFTER the US close so the whole day's run is in) re-computes
// each net-worth ASSET sleeve's day-change for the just-completed trading day and
// persists it to KV growth:<date>, so the app's growth fallback (/api/growth) keeps
// building even when no capture host ran. Reads the PRIVATE book from KV portfolio:v1
// (Vercel has no gitignored file) and the committed broker-state via a static import.
// READ-ONLY external fetches (Yahoo / AMFI); FD + CMPF are deterministic. F&O is
// excluded (business income — the fno-ledger pipeline), as is CMPS (defined-benefit).
//
//   Cron: vercel.json "30 21 * * *" (21:30 UTC = 03:00 IST). Guard with CRON_SECRET.
//   Prereq on Vercel: portfolio:v1 must be seeded in KV (scripts/seed-portfolio-kv.mjs);
//   without it the private sleeves (us/fd/mf/cmpf) are omitted — only eq (committed
//   broker-state) is captured. The response carries NO ₹ figures (private).

import { pullEquityDayChange, pullUsDayChange } from '../../../scripts/lib/equity.mjs';
import { pullMfDayChange } from '../../../scripts/lib/mf.mjs';
import { pullFdDayChange } from '../../../scripts/lib/fd.mjs';
import { pullCmpfDayChange } from '../../../scripts/lib/cmpf.mjs';
import { upsertGrowth } from '../../../scripts/lib/intraday.mjs';
import { kvGetJSON, kvSetJSON, kvConfigured } from '../../../scripts/lib/kv.mjs';
import { captureFiiDiiTrail } from '../../lib/fiidiiTrail';
import { JOB_META, classify, maxDateKey, maxRowDate, isoDate } from '../../../scripts/lib/scheduleHealth.mjs';
import { sendAlert, alertConfigured } from '../../lib/alert';
import brokerState from '../../../data/broker-state.json';
import snapshotSleeves from '../../../data/snapshot-sleeves.json';
import fnoLedger from '../../../data/fno-ledger.json';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const GROWTH_TTL = 35 * 24 * 3600; // recent records live in KV; older served from the committed file

// The trading day just completed. Before 06:00 IST the run belongs to the PRIOR IST
// date — the US session that just closed (~01:30 IST) is the prior US trading day and
// the Indian session was the prior daytime — so a 03:00 IST cron buckets under yesterday.
function tradingDay(nowMs) {
  const ist = new Date(nowMs + 5.5 * 3600 * 1000);
  if (ist.getUTCHours() < 6) ist.setUTCDate(ist.getUTCDate() - 1);
  return ist.toISOString().slice(0, 10);
}
const istIso = (nowMs) => new Date(nowMs + 5.5 * 3600 * 1000).toISOString().replace('Z', '+05:30');

export async function GET(req) {
  // Cron auth: Vercel sends `Authorization: Bearer $CRON_SECRET` when CRON_SECRET is set.
  const secret = process.env.CRON_SECRET;
  if (secret && (req.headers.get('authorization') || '') !== `Bearer ${secret}`) {
    return Response.json({ error: 'unauthorized' }, { status: 401 });
  }
  const now = Date.now();
  const date = tradingDay(now);
  const istNow = istIso(now);

  // Private book: KV on Vercel (portfolio:v1); on the laptop it's null → each pull falls
  // back to the gitignored file. broker-state is committed → static import (Vercel-safe).
  const priv = await kvGetJSON('portfolio:v1');

  const [eqR, usR, mfR] = await Promise.allSettled([
    pullEquityDayChange(brokerState),
    pullUsDayChange(priv),
    pullMfDayChange(priv),
  ]);
  const val = (r) => (r.status === 'fulfilled' ? r.value : null);
  const eqS = val(eqR), usS = val(usR), mfS = val(mfR);
  const eq = eqS ? { net: eqS.net, bySleeve: eqS.bySleeve, covered: eqS.covered } : null;
  const us = usS ? { net: usS.net, usd: usS.usd, fx: usS.fx, covered: usS.covered } : null;
  const mf = mfS ? { net: mfS.net, covered: mfS.covered, byFund: mfS.byFund } : null;
  let fd = null, cmpf = null;
  try { fd = pullFdDayChange(date, priv); } catch { /* private FDS unavailable → omit */ }
  try { cmpf = pullCmpfDayChange(date, priv); } catch { /* private CMPF unavailable → omit */ }

  // Merge into the existing KV record (skip-not-zero carry-forward), write it back.
  const partial = { eq, us, fd, mf, cmpf, istNow };
  let kv = false;
  if (kvConfigured()) {
    const existing = await kvGetJSON(`growth:${date}`);
    const record = upsertGrowth({ days: { [date]: existing || {} } }, date, partial).days[date];
    kv = await kvSetJSON(`growth:${date}`, record, GROWTH_TTL);
  }
  // FII/DII cash-flow trail — folded in from the (now-dropped) premarket cron, so the
  // server-side trail keeps building on this one daily run. Best-effort; null if NSE is
  // unreachable or no store. Carries no portfolio figures (public market data).
  let fiidii = null;
  try { const r = await captureFiiDiiTrail(); fiidii = r.trail ? r.trail.length : (r.fiidii?.stale ? 'stale' : null); } catch { /* NSE unreachable → skip */ }

  // ── Health watch ── This nightly cron is the only always-on cloud tick, so it's where a
  // laptop-side freeze becomes visible. Read the committed fingerprints of the laptop-side
  // CRITICAL jobs; on a FRESH stale (deduped on the stale-set so it doesn't nag nightly)
  // push one alert. No-op until TELEGRAM_* is set — same graceful pattern as KV. Note the
  // cron can't check ITSELF (if it didn't fire, nothing runs) — that's a dead-man's-switch
  // job for an external pinger (healthchecks.io). Must NEVER break the snapshot.
  let health = alertConfigured() ? 'wired' : 'off';
  if (alertConfigured()) {
    try {
      const today = new Date(now + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST today
      const fp = {
        'daily-networth-snapshot': maxDateKey(snapshotSleeves),
        'daily-broker-sync': isoDate(brokerState?.syncedAt),
        'fno-realised': maxRowDate(fnoLedger?.rows),
      };
      const stale = JOB_META.filter((j) => j.critical && j.id in fp && classify(fp[j.id], j.maxAgeDays, today) === 'STALE');
      const sig = stale.map((s) => `${s.id}:${fp[s.id]}`).join('|');
      const prev = kvConfigured() ? await kvGetJSON('health:alertSig') : null;
      if (stale.length && sig !== prev) {
        const lines = stale.map((s) => `⚠ ${s.label} — last ${fp[s.id] || 'never'} (expected ${s.cadence})`);
        await sendAlert(`portfolio-tracker · schedule health (${today})\n${lines.join('\n')}`);
      }
      if (sig !== prev && kvConfigured()) await kvSetJSON('health:alertSig', sig, GROWTH_TTL);
      health = stale.length ? `stale:${stale.length}` : 'ok';
    } catch { health = 'error'; /* alerting must never break the snapshot */ }
  }

  const captured = ['eq', 'us', 'fd', 'mf', 'cmpf'].filter((k) => partial[k]);
  return Response.json(
    { ok: true, date, captured, kv, privSource: priv ? 'kv' : 'file', fiidiiTrail: fiidii, health },
    { headers: { 'Cache-Control': 'no-store' } },
  );
}
