// Upcoming NSE dividends capture (laptop-run) → the market-wide corporate-actions
// calendar for the Wrap "Upcoming dividends" card. Mirrored to KV
// `marketwrap:corpactions` + the committed data/corp-actions.json. /api/dividends
// filters this down to the user's holdings at serve time, so what's captured/committed
// is non-personal public market data.
//
// WHY THE LAPTOP: NSE blocks data-centre IPs (Vercel can't reach corporate-actions),
// but the laptop's residential IP can — the same reason the wrap's other NSE feeds
// (indices, FII/DII, option chain) are laptop-captured.
//
//   node scripts/capture-corp-actions.mjs          # dry-run (print only)
//   node scripts/capture-corp-actions.mjs --write   # write KV + data/corp-actions.json
//
// Corp actions change ~daily — run it once a day alongside the other captures.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mapCorpActions } from '../app/lib/corpActions.mjs';
import { kvSetJSON, kvConfigured } from './lib/kv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'corp-actions.json');
const KEY = 'marketwrap:corpactions';
const KV_TTL = 2 * 24 * 3600; // a stopped capture falls back to the committed snapshot after ~2 days
const HORIZON = 60;
const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

async function nseCookie() {
  try {
    const boot = await fetch('https://www.nseindia.com/', {
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml', 'Accept-Language': 'en-US,en;q=0.9' },
      signal: AbortSignal.timeout(8000),
    });
    return (boot.headers.get('set-cookie') || '')
      .split(/,(?=[^ ;]+=)/).map((c) => c.split(';')[0].trim()).filter(Boolean).join('; ');
  } catch { return ''; }
}

async function fetchActions(cookie) {
  const res = await fetch('https://www.nseindia.com/api/corporates-corporateActions?index=equities', {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.nseindia.com/companies-listing/corporate-filings-actions',
      ...(cookie ? { Cookie: cookie } : {}),
    },
    signal: AbortSignal.timeout(12000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}

const todayISO = new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().slice(0, 10); // IST calendar date

let json = null;
try {
  json = await fetchActions(await nseCookie());
} catch (e1) {
  try { json = await fetchActions(await nseCookie()); } catch (e2) {
    console.error('[corp-actions] NSE fetch failed:', e2.message || e1.message);
    process.exit(1);
  }
}

const actions = mapCorpActions(json, { todayISO, horizonDays: HORIZON });
const tally = actions.reduce((a, r) => ((a[r.type] = (a[r.type] || 0) + 1), a), {});
console.log(`[corp-actions] ${actions.length} upcoming (≤${HORIZON}d): ${JSON.stringify(tally)}`);

if (!WRITE) {
  console.log('[corp-actions] dry-run — pass --write to commit KV + data/corp-actions.json');
  process.exit(0);
}

const out = {
  note: 'Upcoming NSE corp actions (dividend/bonus/split/rights, market-wide). Written by scripts/capture-corp-actions.mjs. /api/dividends filters to your holdings at serve time. Non-personal public market data.',
  capturedAt: new Date().toISOString(),
  actions,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('[corp-actions] wrote', OUT);

if (kvConfigured()) {
  const ok = await kvSetJSON(KEY, actions, KV_TTL);
  console.log('[corp-actions] KV', KEY, ok ? 'ok' : 'FAILED');
} else {
  console.log('[corp-actions] KV not configured — committed JSON only');
}
