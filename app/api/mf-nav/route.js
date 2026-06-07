// Server-side mutual-fund NAV resolver. NAV publishes once daily (~9–11 PM IST),
// so this route is cached for 24h — do NOT refetch per request.
//
//   GET /api/mf-nav
//   → { funds: { id: { nav, date, fresh } }, benchmark: {...}, asOf }
//
// For each fund we resolve the AMFI scheme code at runtime by name (via
// api.mfapi.in/mf/search), then read the latest NAV. On any failure we fall
// back to the last-known casNav (date null, fresh false) so the UI never breaks.

import { MF_FUNDS, MF_BENCHMARK, MF_CASHFLOWS } from '../../portfolio';

export const runtime = 'nodejs';
export const revalidate = 86400; // 24h

const SEARCH = 'https://api.mfapi.in/mf/search?q=';
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// "DD-MM-YYYY" → "YYYY-MM-DD"
const toIso = (d) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(d || '');
  return m ? `${m[3]}-${m[2]}-${m[1]}` : d || null;
};

async function jget(url) {
  const res = await fetch(url, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

// Resolve a scheme code by matching name: require ALL `inc` terms, reject any `exc`.
async function resolveCode(spec) {
  const list = await jget(SEARCH + encodeURIComponent(spec.q));
  if (!Array.isArray(list)) return null;
  const match = list.find((it) => {
    const n = norm(it.schemeName);
    return spec.inc.every((t) => n.includes(t)) && !spec.exc.some((t) => n.includes(t));
  });
  return match ? match.schemeCode : null;
}

async function latestNav(code) {
  const j = await jget(`https://api.mfapi.in/mf/${code}/latest`);
  const d = j?.data?.[0];
  return d ? { nav: +d.nav, date: toIso(d.date) } : null;
}

async function resolveFund(f) {
  try {
    const code = await resolveCode(f);
    if (!code) throw new Error('no code');
    const latest = await latestNav(code);
    if (!latest || !isFinite(latest.nav)) throw new Error('no nav');
    return [f.id, { nav: latest.nav, date: latest.date, fresh: true }];
  } catch {
    return [f.id, { nav: f.casNav, date: null, fresh: false }];
  }
}

// Build the Nifty 50 benchmark: NAV on-or-before each cashflow date + latest NAV.
async function resolveBenchmark(liveNifty50) {
  const dates = MF_CASHFLOWS.map((c) => c.date);
  try {
    const code = await resolveCode(MF_BENCHMARK);
    if (!code) throw new Error('no code');
    const j = await jget(`https://api.mfapi.in/mf/${code}`);
    const hist = (j?.data || [])
      .map((d) => ({ iso: toIso(d.date), nav: +d.nav }))
      .filter((d) => d.iso && isFinite(d.nav))
      .sort((a, b) => (a.iso < b.iso ? 1 : -1)); // newest first
    if (!hist.length) throw new Error('no history');
    const navByDate = {};
    for (const dt of dates) {
      const hit = hist.find((h) => h.iso <= dt);
      navByDate[dt] = hit ? hit.nav : hist[hist.length - 1].nav;
    }
    return {
      name: MF_BENCHMARK.name,
      navByDate,
      latestNav: hist[0].nav,
      latestDate: hist[0].iso,
      fresh: true,
    };
  } catch {
    // Proxy fallback: given NAVs for the two big contributions, live JioBLK
    // Nifty 50 NAV for today.
    return {
      name: MF_BENCHMARK.name + ' (proxy)',
      navByDate: { ...MF_BENCHMARK.proxy },
      latestNav: liveNifty50 || MF_BENCHMARK.proxy['2026-03-20'],
      latestDate: null,
      fresh: false,
    };
  }
}

export async function GET() {
  const entries = await Promise.all(MF_FUNDS.map(resolveFund));
  const funds = Object.fromEntries(entries);
  const benchmark = await resolveBenchmark(funds.nifty50?.nav);

  return Response.json(
    { funds, benchmark, asOf: new Date().toISOString() },
    {
      headers: {
        // NAV is once-daily — cache hard, refresh in the background.
        'Cache-Control': 's-maxage=86400, stale-while-revalidate=43200',
      },
    },
  );
}
