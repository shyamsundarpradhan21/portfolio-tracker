// Fetch the regime classifier's inputs: NIFTY 50 daily OHLC + India VIX daily close,
// over the algos' live span. Same Yahoo v8 feed the macro board uses (^NSEI, ^INDIAVIX).
// Public index data → data/regime-inputs.json (committed-safe, but gitignored as a
// regenerable input). Run occasionally: node scripts/fetch-regime-inputs.mjs
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const UA = 'Mozilla/5.0 (regime-inputs)';
const HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];

async function chart(symbol, range = '3y') {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=${range}`;
  for (const host of HOSTS) {
    try {
      const res = await fetch(host + path, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
      if (!res.ok) continue;
      const r = (await res.json())?.chart?.result?.[0];
      const ts = r?.timestamp, q = r?.indicators?.quote?.[0];
      if (!ts || !q) continue;
      const out = [];
      for (let i = 0; i < ts.length; i++) {
        const c = q.close?.[i];
        if (c == null) continue;
        const d = new Date(ts[i] * 1000);
        const iso = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`;
        out.push({ date: iso, o: q.open?.[i] ?? null, h: q.high?.[i] ?? null, l: q.low?.[i] ?? null, c });
      }
      return out;
    } catch { /* next host */ }
  }
  return null;
}

const nifty = await chart('^NSEI');
const vix = await chart('^INDIAVIX');
if (!nifty || !vix) { console.error('fetch failed for', !nifty ? 'NIFTY' : '', !vix ? 'INDIAVIX' : ''); process.exit(1); }

const out = {
  note: 'Daily NIFTY 50 OHLC + India VIX close for the algo-screen regime classifier. Public index data (Yahoo ^NSEI/^INDIAVIX).',
  fetchedAt: new Date().toISOString(),
  nifty,                                       // [{date, o, h, l, c}]
  vix: vix.map((d) => ({ date: d.date, vix: d.c })),
};
writeFileSync(join(ROOT, 'data', 'regime-inputs.json'), JSON.stringify(out));
console.log(`wrote data/regime-inputs.json — nifty ${nifty.length} days (${nifty[0].date}..${nifty.at(-1).date}), vix ${vix.length} days`);
