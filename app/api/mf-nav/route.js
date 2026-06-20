// Server-side mutual-fund NAV resolver. NAV publishes once daily (~9–11 PM IST),
// so this route is cached for 24h — do NOT refetch per request.
//
//   GET /api/mf-nav
//   → { funds: { id: { nav, date, fresh, hist: [[iso, nav], …] } }, benchmark: {...}, asOf }
//
// For each fund we resolve the AMFI scheme code at runtime by name (via
// api.mfapi.in/mf/search), then read its full NAV series: latest NAV for the
// live view plus a weekly-downsampled history (from the first MF cashflow)
// that the Overview backfill uses to value the sleeve as units × NAV(t).
// On any failure we fall back to the last-known casNav (date null, fresh
// false, no hist) so the UI never breaks.

// MF_FUNDS / MF_BENCHMARK / MF_CASHFLOWS are private data — loaded server-side at
// request time (the portfolio.js exports are empty on the server, hydrated only
// on the client).
import { loadPortfolio } from '../../lib/serverPortfolio';

export const runtime = 'nodejs';
// Reads private data at runtime (loadPortfolio) + the external NAV API, so it must
// NOT be statically prerendered at build. CDN caching is handled by the response
// Cache-Control header below (s-maxage 24h), so freshness is unchanged.
export const dynamic = 'force-dynamic';

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

// Full NAV series for a scheme → latest point + weekly-downsampled history.
// histFrom = earliest MF cashflow date (history window start), passed in by GET.
async function fundSeries(code, histFrom) {
  const j = await jget(`https://api.mfapi.in/mf/${code}`);
  const rows = (j?.data || [])
    .map((r) => ({ iso: toIso(r.date), nav: +r.nav }))
    .filter((r) => r.iso && isFinite(r.nav))
    .sort((a, b) => (a.iso < b.iso ? -1 : 1)); // ascending
  if (!rows.length) return null;
  const latest = rows[rows.length - 1];
  const hist = [];
  let lastKept = '';
  for (const r of rows) {
    if (r.iso < histFrom) continue;
    // keep ~weekly points: at least 6 days since the last kept NAV
    if (!lastKept || (new Date(r.iso) - new Date(lastKept)) / 86400000 >= 6) {
      hist.push([r.iso, r.nav]);
      lastKept = r.iso;
    }
  }
  if (lastKept !== latest.iso) hist.push([latest.iso, latest.nav]);
  return { latest, hist };
}

async function resolveFund(f, histFrom) {
  try {
    const code = await resolveCode(f);
    if (!code) throw new Error('no code');
    const s = await fundSeries(code, histFrom);
    if (!s || !isFinite(s.latest.nav)) throw new Error('no nav');
    return [f.id, { nav: s.latest.nav, date: s.latest.iso, fresh: true, hist: s.hist }];
  } catch {
    return [f.id, { nav: f.casNav, date: null, fresh: false }];
  }
}

// Build the Nifty 50 benchmark: NAV on-or-before each cashflow date + latest NAV.
async function resolveBenchmark(liveNifty50, MF_BENCHMARK, dates) {
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
      name: (MF_BENCHMARK.name || 'Nifty 50') + ' (proxy)',
      navByDate: { ...(MF_BENCHMARK.proxy || {}) },
      latestNav: liveNifty50 || MF_BENCHMARK.proxy?.['2026-03-20'] || null,
      latestDate: null,
      fresh: false,
    };
  }
}

export async function GET() {
  const data = await loadPortfolio();
  if (!data) return Response.json({ funds: {}, benchmark: null, asOf: null, error: 'portfolio data unavailable' }, { status: 503 });
  const MF_FUNDS = data?.MF_FUNDS || [];
  const MF_BENCHMARK = data?.MF_BENCHMARK || {};
  const dates = (data?.MF_CASHFLOWS || []).map((c) => c.date);
  const histFrom = [...dates].sort()[0];

  const entries = await Promise.all(MF_FUNDS.map((f) => resolveFund(f, histFrom)));
  const funds = Object.fromEntries(entries);
  const benchmark = await resolveBenchmark(funds.nifty50?.nav, MF_BENCHMARK, dates);

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
