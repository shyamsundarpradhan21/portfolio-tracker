// Mutual-fund daily NAV growth for the growth snapshot. NAV publishes once a day
// (~9–11 PM IST), so the day's growth = units × (latest NAV − previous NAV) per
// fund, from AMFI's public api.mfapi.in. Each fund is resolved to its AMFI scheme
// code by name (mirrors app/api/mf-nav resolveCode — the capture layer stays
// self-contained from the app). Skip-not-zero: a fund that can't resolve/fetch is
// omitted (never zeroed); MF returns null only when NONE resolve. Accurate when the
// snapshot runs AFTER NAV publication (evening); earlier it captures the latest
// available daily change (a one-day lag), which the scheduler (Phase 0d) handles.
//
// READ-ONLY of the private MF_FUNDS terms; emits only aggregate ₹.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const r2 = (n) => Math.round(n * 100) / 100;
const SEARCH = 'https://api.mfapi.in/mf/search?q=';
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
const toIso = (d) => { const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d || ''); return m ? `${m[3]}-${m[2]}-${m[1]}` : null; };

async function jget(url) {
  const r = await fetch(url, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

// Resolve a fund spec { q, inc[], exc[] } to its AMFI scheme code (mirrors mf-nav):
// require ALL `inc` terms in the scheme name, reject any `exc`.
async function resolveCode(spec) {
  const list = await jget(SEARCH + encodeURIComponent(spec.q));
  if (!Array.isArray(list)) return null;
  const hit = list.find((it) => {
    const n = norm(it.schemeName);
    return (spec.inc || []).every((t) => n.includes(t)) && !(spec.exc || []).some((t) => n.includes(t));
  });
  return hit ? hit.schemeCode : null;
}

// Latest two DAILY NAVs for a scheme → { latest, prev } numbers, or null.
async function lastTwoNavs(code) {
  const j = await jget(`https://api.mfapi.in/mf/${code}`);
  const navs = (j?.data || [])
    .map((r) => ({ iso: toIso(r.date), nav: +r.nav }))
    .filter((r) => r.iso && Number.isFinite(r.nav))
    .sort((a, b) => (a.iso < b.iso ? -1 : 1));
  return navs.length >= 2 ? { latest: navs[navs.length - 1].nav, prev: navs[navs.length - 2].nav } : null;
}

// Pure: Σ units × (latest − prev) over funds whose NAVs resolved. navByFund =
// { <fund.id>: { latest, prev } }. → { net, covered, total, byFund } | null.
export function sumMfDayChange(funds, navByFund) {
  let net = 0, covered = 0;
  const byFund = {};
  for (const f of Array.isArray(funds) ? funds : []) {
    const n = navByFund?.[f?.id];
    if (!f?.units || !n || !Number.isFinite(n.latest) || !Number.isFinite(n.prev)) continue;
    const dc = f.units * (n.latest - n.prev);
    byFund[f.id] = r2(dc);
    net += dc;
    covered++;
  }
  return covered ? { net: r2(net), covered, total: (funds || []).length, byFund } : null;
}

// Reads private MF_FUNDS, resolves each to live AMFI NAVs, returns the day's MF
// growth { net, covered, total, byFund } or null when unavailable.
export async function pullMfDayChange(priv) {
  // `priv` injected by the cloud route (KV portfolio:v1); else read the gitignored file.
  if (!priv) {
    try { priv = JSON.parse(readFileSync(join(ROOT, 'data', 'portfolio.private.json'), 'utf8')); }
    catch { return null; }
  }
  const funds = priv?.MF_FUNDS;
  if (!Array.isArray(funds) || !funds.length) return null;
  const navByFund = {};
  await Promise.all(funds.map(async (f) => {
    if (!f?.units || !f?.q) return;
    try {
      const code = await resolveCode(f);
      if (!code) return;
      const two = await lastTwoNavs(code);
      if (two) navByFund[f.id] = two;
    } catch { /* skip this fund — never zero */ }
  }));
  return sumMfDayChange(funds, navByFund);
}
