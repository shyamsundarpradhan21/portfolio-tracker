// seed-nifty-fundamentals.mjs — one-time / periodic seed of the slow-moving fundamentals
// the Nifty-50 heatmap deep-dive needs but the KEYLESS Yahoo feed can't give: shares-
// outstanding (→ live market cap = live price × shares) and the long company name.
//
// Yahoo's quoteSummary is crumb-gated (Invalid Crumb without a cookie+crumb) — that flow
// works from a laptop but is fragile on Vercel's datacenter IPs, so we seed it HERE and
// COMMIT data/nifty50-fundamentals.json. The runtime /api/nifty50-detail then stays fully
// keyless (price, perf, dividends via the chart endpoint) and just multiplies by the
// committed shares. Re-run on index reconstitution or major buybacks/splits.
//
//   node scripts/seed-nifty-fundamentals.mjs           # dry-run (prints a table)
//   node scripts/seed-nifty-fundamentals.mjs --write   # + write data/nifty50-fundamentals.json

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { NIFTY50 } from '../data/nifty50.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'nifty50-fundamentals.json');
const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

// Yahoo cookie → crumb. Retries: the consent endpoint occasionally 302s to an EU consent
// wall; fc.yahoo.com returns the A3 cookie directly, which is what getcrumb wants.
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
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${sym}.NS`
    + `?modules=defaultKeyStatistics,price&crumb=${encodeURIComponent(crumb)}`;
  const r = await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(12000) });
  const j = await r.json();
  const res = j?.quoteSummary?.result?.[0];
  if (!res) return { sym, error: j?.quoteSummary?.error?.description || 'no result' };
  const sharesOut = res.defaultKeyStatistics?.sharesOutstanding?.raw ?? null;
  const name = res.price?.longName || res.price?.shortName || null;
  return { sym, sharesOut, name };
}

const { cookie, crumb } = await getCrumb();
console.log('crumb ok:', crumb.slice(0, 8) + '…\n');

const out = {};
let ok = 0, fail = 0;
// serial with a tiny gap — 50 calls, avoid tripping the rate limiter
for (const c of NIFTY50) {
  let row;
  try { row = await fetchOne(c, { cookie, crumb }); }
  catch (e) { row = { sym: c.sym, error: String(e.message || e).slice(0, 60) }; }
  if (row.sharesOut) { out[c.sym] = { sharesOut: row.sharesOut, name: row.name }; ok++; }
  else { fail++; }
  console.log(`${c.sym.padEnd(12)} ${row.sharesOut ? (row.sharesOut / 1e9).toFixed(3) + 'B  ' + (row.name || '') : 'FAIL — ' + row.error}`);
  await new Promise((r) => setTimeout(r, 250));
}

console.log(`\nresolved ${ok}/${NIFTY50.length} (${fail} failed)`);
const payload = {
  note: 'Slow-moving Nifty-50 fundamentals (shares-outstanding + name) for the heatmap deep-dive. '
    + 'Seeded via scripts/seed-nifty-fundamentals.mjs (Yahoo quoteSummary, crumb-gated → laptop-only). '
    + 'Market cap is computed LIVE at runtime = price × sharesOut; re-seed on reconstitution/buybacks.',
  asOf: new Date().toISOString().slice(0, 10),
  source: 'Yahoo quoteSummary defaultKeyStatistics (sharesOutstanding)',
  stocks: out,
};
if (WRITE) {
  if (ok < NIFTY50.length * 0.8) { console.error(`\nREFUSED to write — only ${ok}/${NIFTY50.length} resolved (guard: need ≥80%).`); process.exit(1); }
  writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
  console.log('wrote', OUT);
} else {
  console.log('\n(dry-run — pass --write to persist)');
}
