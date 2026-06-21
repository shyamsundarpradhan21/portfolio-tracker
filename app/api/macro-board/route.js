// Macro board for the Wrap percentile sliders. Per metric: current value + where
// it sits in its trailing ~1-yr range (knob position + rank percentile + lo/hi) +
// a regime tone. Keyless, same discipline as /api/macro:
//   - FRED CSV (rates / credit / inflation / growth / labour)
//   - Yahoo v8 chart (VIX / DXY)
// Every cell is { value, pos, pctile, lo, hi, tone, asOf, unit, source } or
// { stale, source } — a failed series renders as an unavailable slider, never a
// fabricated reading.
import { MACRO_GROUPS, boardCell, yoy, mom } from '../../lib/macroBoard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

const UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

// FRED CSV → ascending [{date,v}] over the last `days`.
async function fredObs(id, days) {
  const start = new Date();
  start.setDate(start.getDate() - days);
  const url = `https://fred.stlouisfed.org/graph/fredgraph.csv?id=${id}&cosd=${start.toISOString().slice(0, 10)}`;
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/csv' }, cache: 'no-store', signal: AbortSignal.timeout(9000) });
    if (!res.ok) return null;
    const text = await res.text();
    return text.trim().split('\n').slice(1)
      .map((ln) => ln.split(','))
      .filter((c) => c.length >= 2 && c[1] !== '.' && c[1] !== '' && isFinite(+c[1]))
      .map((c) => ({ date: c[0], v: +c[1] }));
  } catch { return null; }
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

// Trailing 1 year of a series, falling back to the full series when too sparse
// (e.g. quarterly GDP) so the percentile still has something to rank against.
function lastYear(series) {
  if (!series || !series.length) return series;
  const cut = new Date(series[series.length - 1].date);
  cut.setFullYear(cut.getFullYear() - 1);
  const w = series.filter((r) => new Date(r.date) >= cut);
  return w.length >= 6 ? w : series;
}

async function cellFor(cfg) {
  const source = cfg.yahoo ? `Yahoo ${cfg.yahoo}` : `FRED ${cfg.src}`;
  let raw = cfg.yahoo
    ? await yhHist(cfg.yahoo)
    : await fredObs(cfg.src, cfg.kind === 'yoy' ? 1500 : cfg.src === 'A191RL1Q225SBEA' ? 2200 : 500);
  if (!raw || !raw.length) return { stale: true, source };
  if (cfg.scale) raw = raw.map((r) => ({ date: r.date, v: r.v * cfg.scale }));
  let series = cfg.kind === 'yoy' ? yoy(raw) : cfg.kind === 'mom' ? mom(raw) : raw;
  return { ...boardCell(cfg, lastYear(series)), source };
}

export async function GET() {
  const flat = MACRO_GROUPS.flatMap((g) => g.series);
  const entries = await Promise.all(flat.map(async (s) => [s.key, await cellFor(s)]));
  const byKey = Object.fromEntries(entries);
  const groups = MACRO_GROUPS.map((g) => ({
    group: g.group,
    series: g.series.map((s) => ({ key: s.key, label: s.label, d: s.d, ...byKey[s.key] })),
  }));
  return Response.json(
    { fetchedAt: new Date().toISOString(), groups },
    { headers: { 'Cache-Control': 's-maxage=3600, stale-while-revalidate=86400' } },
  );
}
