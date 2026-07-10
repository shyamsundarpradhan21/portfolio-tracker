// Macro board for the Wrap percentile sliders. Per metric: current value + where
// it sits in its trailing ~1-yr range (knob position + rank percentile + lo/hi) +
// a regime tone. Keyless, same discipline as /api/macro:
//   - FRED CSV (rates / credit / inflation / growth / labour)
//   - Yahoo v8 chart (VIX / DXY)
// Every cell is { value, pos, pctile, lo, hi, tone, asOf, unit, source } or
// { stale, source } — a failed series renders as an unavailable slider, never a
// fabricated reading.
import { UA } from '../../lib/ua';
import https from 'node:https';
import { MACRO_GROUPS, boardCell, yoy, yoyQ, mom } from '../../lib/macroBoard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// FRED data via the official FRED API (windowed JSON) → ascending [{date,v}].
// FRED's keyless fredgraph.csv is IP-blocked from Vercel (times out), so we use
// the official API with a free key (FRED_API_KEY). Graceful no-op until the key
// is set — the sliders just read 'unavailable' meanwhile (Yahoo cells still work).
const FRED_KEY = process.env.FRED_API_KEY;
async function fredObs(id, days) {
  if (!FRED_KEY) throw new Error('no FRED_API_KEY');
  const start = new Date();
  start.setDate(start.getDate() - days);
  const url =
    `https://api.stlouisfed.org/fred/series/observations?series_id=${id}` +
    `&api_key=${FRED_KEY}&file_type=json&sort_order=asc&observation_start=${start.toISOString().slice(0, 10)}`;
  const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(9000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const obs = (await res.json())?.observations;
  if (!Array.isArray(obs)) throw new Error('bad shape');
  const out = obs.filter((o) => o && o.value !== '.' && o.value != null && isFinite(+o.value)).map((o) => ({ date: o.date, v: +o.value }));
  if (!out.length) throw new Error('no obs');
  return out;
}

// Yahoo weekly closes over ~1y → ascending [{date,v}].
const YH = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
async function yhHist(sym) {
  const path = `/v8/finance/chart/${encodeURIComponent(sym)}?interval=1wk&range=1y`;
  for (const host of YH) {
    try {
      const res = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, cache: 'no-store', signal: AbortSignal.timeout(8000) });
      if (!res.ok) continue;
      const r = (await res.json())?.chart?.result?.[0];
      const ts = r?.timestamp, q = r?.indicators?.quote?.[0]?.close;
      if (!Array.isArray(ts) || !Array.isArray(q)) continue;
      const out = [];
      for (let i = 0; i < ts.length; i++) if (q[i] != null && isFinite(q[i])) out.push({ date: new Date(ts[i] * 1000).toISOString().slice(0, 10), v: q[i] });
      if (out.length) return out;
    } catch { /* next host */ }
  }
  return null;
}

// India CPI + GDP from MoSPI e-Sankhyiki (api.mospi.gov.in) — keyless, live.
// Its TLS chain isn't in Node's trust store (self-signed intermediate), so the
// global fetch rejects it; scope a cert-skip to THIS host only via a dedicated
// https.Agent — never globally (that would weaken the FRED/Yahoo/KV calls).
// Read-only public data, shape-validated, last-known fallback → the narrow risk
// (no cert pinning on one gov endpoint) is acceptable.
const MOSPI = 'https://api.mospi.gov.in/api';
const mospiAgent = new https.Agent({ rejectUnauthorized: false, keepAlive: false });
function mospiGet(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { agent: mospiAgent, headers: { 'User-Agent': UA, Accept: 'application/json' }, timeout: 9000 }, (res) => {
      if (res.statusCode !== 200) { res.resume(); return reject(new Error('HTTP ' + res.statusCode)); }
      let d = ''; res.setEncoding('utf8');
      res.on('data', (c) => { d += c; if (d.length > 5_000_000) req.destroy(new Error('too large')); });
      res.on('end', () => { try { resolve(JSON.parse(d)); } catch { reject(new Error('bad json')); } });
    });
    req.on('error', reject);
    req.on('timeout', () => req.destroy(new Error('timeout')));
  });
}
const mospiRows = (j) => j?.data || j?.records || [];
const MONTHS = { January: '01', February: '02', March: '03', April: '04', May: '05', June: '06', July: '07', August: '08', September: '09', October: '10', November: '11', December: '12' };

// India headline CPI inflation (YoY %, All-India Combined) → ascending [{date,v}].
// getCPIIndex (2012 base) is the clean monthly General/Combined feed but ends
// Dec-2025; getCPIData (2024 base, current) carries the live month but explodes
// the full item hierarchy, so we only pull page 1 for the latest reading.
// Inflation % is base-independent, so we stitch the 2012-base history beneath the
// live 2024-base point → a real 1-yr range plus the current value.
async function indiaCpiSeries() {
  const out = [];
  const [hist, cur] = await Promise.allSettled([
    mospiGet(`${MOSPI}/cpi/getCPIIndex?base_year=2012&series=Current&state_code=99&sector_code=3&Format=JSON&limit=300&page=1`),
    mospiGet(`${MOSPI}/cpi/getCPIData?base_year=2024&series=Current&state_code=1&sector_code=3&Format=JSON&limit=10&page=1`),
  ]);
  if (hist.status === 'fulfilled') for (const r of mospiRows(hist.value)) {
    if (r.group === 'General' && (r.subgroup === 'General-Overall' || !r.subgroup)) {
      const mm = MONTHS[r.month], v = +r.inflation;
      if (mm && isFinite(v)) out.push({ date: `${r.year}-${mm}-01`, v });
    }
  }
  if (cur.status === 'fulfilled') {
    const g = mospiRows(cur.value).find((r) => r.division === 'CPI (General)');
    if (g) { const mm = MONTHS[g.month], v = +g.inflation; if (mm && isFinite(v)) out.push({ date: `${g.year}-${mm}-01`, v }); }
  }
  const byDate = new Map();
  for (const r of out) byDate.set(r.date, r.v);
  const series = [...byDate.entries()].map(([date, v]) => ({ date, v })).sort((a, b) => a.date.localeCompare(b.date));
  if (!series.length) throw new Error('no CPI data');
  return series;
}

// India IIP growth (YoY %, monthly General, 2011-12 base) → ascending [{date,v}].
// The `type=General` filter returns one clean headline row per month (growth_rate
// is already the YoY %, no transform), so a single page is the whole series.
async function indiaIipSeries() {
  const j = await mospiGet(`${MOSPI}/iip/getIIPData?base_year=2011-12&frequency=Monthly&type=General&Format=JSON&limit=24&page=1`);
  const out = [];
  for (const r of mospiRows(j)) {
    if (r.type !== 'General') continue;
    const mm = MONTHS[r.month], v = +r.growth_rate;
    if (mm && isFinite(v)) out.push({ date: `${r.year}-${mm}-01`, v });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  if (!out.length) throw new Error('no IIP data');
  return out;
}

// India real GDP growth (YoY %, quarterly, 2011-12 base) → ascending [{date,v}].
// indicator 22 returns the growth rate directly (constant_price = real); the
// base year (2011-12) has 0% rows we drop. FY quarters map to calendar
// quarter-ends (Q4 = Jan-Mar of the next calendar year).
const FY_Q_END = { Q1: '06-30', Q2: '09-30', Q3: '12-31', Q4: '03-31' };
async function indiaGdpSeries() {
  const j = await mospiGet(`${MOSPI}/nas/getNASData?base_year=2011-12&series=Current&frequency_code=Quarterly&indicator_code=22&Format=JSON&limit=100&page=1`);
  const out = [];
  for (const r of mospiRows(j)) {
    const v = +r.constant_price, fy = String(r.year || ''), q = r.quarter;
    if (!isFinite(v) || v === 0 || !FY_Q_END[q]) continue;
    const sy = parseInt(fy.slice(0, 4), 10);
    if (!isFinite(sy)) continue;
    out.push({ date: `${q === 'Q4' ? sy + 1 : sy}-${FY_Q_END[q]}`, v });
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  if (!out.length) throw new Error('no GDP data');
  return out;
}

// Trailing 1 year of a series, falling back to the full series when too sparse
// (e.g. quarterly GDP) so the percentile still has something to rank against.
function lastYear(series) {
  if (!series || !series.length) return series;
  const cut = new Date(series[series.length - 1].date);
  cut.setFullYear(cut.getFullYear() - 1);
  const w = series.filter((r) => new Date(r.date) >= cut);
  return w.length >= 6 ? w : series.slice(-12);
}

async function cellFor(cfg) {
  const source = cfg.track ? 'RBI (tracked)' : cfg.yahoo ? `Yahoo ${cfg.yahoo}` : cfg.mospi ? `MoSPI ${cfg.mospi}` : `FRED ${cfg.src}`;
  let raw;
  try {
    raw = cfg.track
      ? cfg.track
      : cfg.yahoo
      ? await yhHist(cfg.yahoo)
      : cfg.mospi === 'cpi'
      ? await indiaCpiSeries()
      : cfg.mospi === 'gdp'
      ? await indiaGdpSeries()
      : cfg.mospi === 'iip'
      ? await indiaIipSeries()
      : await fredObs(cfg.src, cfg.kind === 'yoy' ? 1100 : (cfg.kind === 'yoyq' || cfg.src === 'A191RL1Q225SBEA') ? 2200 : 550);
  } catch (e) {
    return { stale: true, source, error: e?.name === 'TimeoutError' ? 'timeout' : (e?.message || 'fetch failed') };
  }
  if (!raw || !raw.length) return { stale: true, source, error: 'no data' };
  if (cfg.scale) raw = raw.map((r) => ({ date: r.date, v: r.v * cfg.scale }));
  let series = cfg.kind === 'yoy' ? yoy(raw) : cfg.kind === 'yoyq' ? yoyQ(raw) : cfg.kind === 'mom' ? mom(raw) : raw;
  const cell = boardCell(cfg, lastYear(series));
  // Guard: a discontinued/lagged feed (e.g. FRED's OECD India mirror, stuck >1yr)
  // must not show stale data as current — render it unavailable instead.
  if (cell.asOf && Date.now() - Date.parse(cell.asOf) > 366 * 86400 * 1000) {
    return { stale: true, source, error: `stale (last obs ${cell.asOf})` };
  }
  return { ...cell, source };
}

export async function GET() {
  const flat = MACRO_GROUPS.flatMap((g) => g.series);
  const entries = await Promise.all(flat.map(async (s) => [s.key, await cellFor(s)]));
  const byKey = Object.fromEntries(entries);
  const groups = MACRO_GROUPS.map((g) => ({
    group: g.group,
    series: g.series.map((s) => ({ key: s.key, label: s.label, d: s.d, region: s.region || 'global', ...byKey[s.key] })),
  }));
  return Response.json(
    { fetchedAt: new Date().toISOString(), groups },
    { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } },
  );
}
