// Upcoming US dividends for the Wrap "Upcoming corp actions" card — the US half of the
// corp-actions calendar. Yahoo quoteSummary calendarEvents (crumb-gated, laptop residential
// IP) gives an ANNOUNCED upcoming ex-dividend date; the keyless chart endpoint gives the last
// actual per-share payout as the expected amount. Only names with a FUTURE ex-date are emitted
// — nothing projected. US splits/bonus aren't sourced (no reliable keyless upcoming feed), so
// this is dividends-only; coverage is partial (only names whose next ex-date is announced).
// Mirrored to KV `marketwrap:corpactions:us` + committed data/corp-actions-us.json (public).
//
//   node scripts/capture-corp-actions-us.mjs          # dry-run (print only)
//   node scripts/capture-corp-actions-us.mjs --write   # write KV + data/corp-actions-us.json

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { kvSetJSON, kvConfigured } from './lib/kv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'corp-actions-us.json');
const KEY = 'marketwrap:corpactions:us';
const KV_TTL = 2 * 24 * 3600; // a stopped capture falls back to the committed snapshot after ~2 days
const HORIZON = 90;
const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';
const r2 = (n) => (n == null || !isFinite(+n) ? null : Math.round(+n * 100) / 100);

// US holdings (private, gitignored) — only the symbols are used to scope the scan; the
// calendar written (ex-dates + payouts) is public market data, not holdings.
const priv = JSON.parse(readFileSync(join(ROOT, 'data', 'portfolio.private.json'), 'utf8'));
const SYMS = [...new Set((priv.US || []).map((h) => String(h?.sym || h?.ticker || '').trim().toUpperCase()).filter(Boolean))];

// Yahoo cookie → crumb (same flow as seed-nifty-fundamentals.mjs).
async function getCrumb() {
  const r1 = await fetch('https://fc.yahoo.com/', { headers: { 'User-Agent': UA } });
  const setC = r1.headers.getSetCookie ? r1.headers.getSetCookie() : [r1.headers.get('set-cookie')].filter(Boolean);
  const cookie = setC.map((c) => c.split(';')[0]).join('; ');
  if (!cookie) throw new Error('no cookie from fc.yahoo.com');
  const rc = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', { headers: { 'User-Agent': UA, Cookie: cookie } });
  const crumb = (await rc.text()).trim();
  if (!crumb || crumb.length > 24 || /[<{]/.test(crumb)) throw new Error('bad crumb: ' + crumb.slice(0, 40));
  return { cookie, crumb };
}

const todayISO = new Date().toISOString().slice(0, 10);
const daysTo = (iso) => Math.round((Date.parse(iso + 'T00:00:00Z') - Date.parse(todayISO + 'T00:00:00Z')) / 86400000);

async function nextExDate({ cookie, crumb }, sym) {
  const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=calendarEvents,summaryDetail,price&crumb=${encodeURIComponent(crumb)}`;
  const j = await (await fetch(url, { headers: { 'User-Agent': UA, Cookie: cookie }, signal: AbortSignal.timeout(12000) })).json();
  const res = j?.quoteSummary?.result?.[0];
  const exRaw = res?.calendarEvents?.exDividendDate?.raw ?? res?.summaryDetail?.exDividendDate?.raw;
  if (!exRaw) return null;
  return { exDate: new Date(exRaw * 1000).toISOString().slice(0, 10), name: res.price?.longName || res.price?.shortName || sym };
}

// Last actual per-share dividend (keyless chart) → the expected amount for the upcoming one.
async function lastPayout(sym) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=1y&events=div`;
    const j = await (await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10000) })).json();
    const divs = j?.chart?.result?.[0]?.events?.dividends;
    if (!divs) return null;
    const last = Object.values(divs).sort((a, b) => a.date - b.date).pop();
    return last ? r2(last.amount) : null;
  } catch { return null; }
}

const { cookie, crumb } = await getCrumb();
console.log('crumb ok; scanning', SYMS.length, 'US symbols…');
const actions = [];
for (const sym of SYMS) {
  try {
    const nx = await nextExDate({ cookie, crumb }, sym);
    if (nx) {
      const days = daysTo(nx.exDate);
      if (days >= 0 && days <= HORIZON) {
        const amount = await lastPayout(sym);
        actions.push({ sym, name: nx.name, exDate: nx.exDate, type: 'dividend', amount, market: 'US' });
        console.log(`  ${sym.padEnd(6)} ex ${nx.exDate} (${String(days).padStart(2)}d)  $${amount ?? '?'}`);
      }
    }
  } catch { /* skip a bad symbol, keep the scan going */ }
  await new Promise((r) => setTimeout(r, 200));
}
actions.sort((a, b) => (a.exDate < b.exDate ? -1 : a.exDate > b.exDate ? 1 : 0));
console.log(`\n[corp-actions-us] ${actions.length} upcoming US dividends (≤${HORIZON}d) of ${SYMS.length} holdings`);

if (!WRITE) { console.log('[corp-actions-us] dry-run — pass --write to commit KV + data/corp-actions-us.json'); process.exit(0); }
const out = {
  note: 'Upcoming US dividends (announced ex-dates), from Yahoo. Written by scripts/capture-corp-actions-us.mjs. /api/dividends filters to your US holdings at serve time. Non-personal public market data.',
  capturedAt: new Date().toISOString(),
  actions,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('[corp-actions-us] wrote', OUT);
if (kvConfigured()) { const ok = await kvSetJSON(KEY, actions, KV_TTL); console.log('[corp-actions-us] KV', KEY, ok ? 'ok' : 'FAILED'); }
else console.log('[corp-actions-us] KV not configured — committed JSON only');
