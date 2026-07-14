// seed-nasdaq100-fundamentals.mjs — shares-outstanding + long name for the Nasdaq-100 heatmap
// hover market cap (mcap = live price × committed shares). Mirrors seed-nifty-fundamentals.mjs.
// Yahoo quoteSummary is crumb-gated (fragile on Vercel's datacenter IPs) so this is seeded HERE
// and the JSON committed; the heatmap stays keyless and just multiplies by the committed shares.
// Re-run on index reconstitution or major buybacks/splits.
//
//   node scripts/seed-nasdaq100-fundamentals.mjs           # dry-run (prints a table)
//   node scripts/seed-nasdaq100-fundamentals.mjs --write   # + write data/nasdaq100-fundamentals.json

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { NASDAQ100 } from '../data/nasdaq100.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'nasdaq100-fundamentals.json');
const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

async function getCrumb() {
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  const setC = r1.headers.getSetCookie ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie')].filter(Boolean);
  const cookie = setC.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('no cookie from fc.yahoo.com');
  const r2 = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } });
  const crumb = (await r2.text()).trim();
  if (!crumb || crumb.length > 24 || /[<{]/.test(crumb)) throw new Error('bad crumb: ' + crumb.slice(0, 60));
  return { cookie, crumb };
}

async function fetchOne({ sym }, { cookie, crumb }) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}`
    + `?modules=defaultKeyStatistics,price&crumb=${encodeURIComponent(crumb)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  const res = j?.quoteSummary?.result?.[0];
  if (!res) return { sym, error: j?.quoteSummary?.error?.description || 'no result' };
  const K = res.defaultKeyStatistics || {}, P = res.price || {};
  let sharesOut = K.sharesOutstanding?.raw ?? null;
  if (sharesOut == null && P.marketCap?.raw && P.regularMarketPrice?.raw) sharesOut = Math.round(P.marketCap.raw / P.regularMarketPrice.raw); // ETFs lack sharesOutstanding
  return { sym, sharesOut, name: P.longName || P.shortName || null };
}

const { cookie, crumb } = await getCrumb();
console.log('crumb ok:', crumb.slice(0, 8) + '…\n');

const out = {};
let ok = 0, fail = 0;
for (const c of NASDAQ100) {
  let row;
  try { row = await fetchOne(c, { cookie, crumb }); }
  catch (e) { row = { sym: c.sym, error: String(e.message || e).slice(0, 60) }; }
  if (row.sharesOut) { out[c.sym] = { sharesOut: row.sharesOut, name: row.name }; ok++; }
  else { fail++; }
  console.log(`${c.sym.padEnd(8)} ${row.sharesOut ? (row.sharesOut / 1e9).toFixed(3) + 'B  ' + (row.name || '') : 'FAIL — ' + row.error}`);
  await new Promise((r) => setTimeout(r, 250));
}

console.log(`\nresolved ${ok}/${NASDAQ100.length} (${fail} failed)`);
const payload = {
  note: 'Slow-moving Nasdaq-100 fundamentals (shares-outstanding + name) for the heatmap hover market cap. '
    + 'Seeded via scripts/seed-nasdaq100-fundamentals.mjs (Yahoo quoteSummary, crumb-gated → laptop-only). '
    + 'Market cap is computed LIVE at runtime = price × sharesOut; re-seed on reconstitution/buybacks.',
  asOf: new Date().toISOString().slice(0, 10),
  source: 'Yahoo quoteSummary defaultKeyStatistics (sharesOutstanding)',
  stocks: out,
};
if (WRITE) {
  if (ok < NASDAQ100.length * 0.8) { console.error(`\nREFUSED to write — only ${ok}/${NASDAQ100.length} resolved (guard: need ≥80%).`); process.exit(1); }
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log('wrote', OUT);
} else {
  console.log('\n(dry-run — pass --write to persist)');
}
