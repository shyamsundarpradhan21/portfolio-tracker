// NIFTY option-chain capture (laptop-run) → the Nifty 50 Overview "Options analysis"
// read (PCR / ATM IV / max pain / expiry-in), mirrored to KV `marketwrap:options`
// + the committed seed data/nifty-options.json.
//
// WHY THE LAPTOP: NSE blocks data-centre IPs, so Vercel can't reliably pull the
// option chain (same block that makes the wrap fall back to Yahoo for indices). The
// laptop's residential IP reaches NSE, so it is the reliable PRIMARY; the serving
// route (/api/premarket) still tries NSE live as a refresh and falls back to this
// snapshot, so the block degrades to "last snapshot", never a blank. Public market
// data — safe to commit.
//
//   node scripts/capture-nifty-options.mjs          # dry-run (print only)
//   node scripts/capture-nifty-options.mjs --write   # write KV + data/nifty-options.json
//
// Wire it into the existing intraday capture cadence (a few times a session) the
// same way the other laptop captures run; the KV TTL bridges a stopped capture and
// the route hides a snapshot once its expiry has passed.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { mapOptionChain } from '../app/lib/niftyOptions.mjs';
import { kvSetJSON, kvConfigured } from './lib/kv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'nifty-options.json');
const KEY = 'marketwrap:options';
const KV_TTL = 3 * 24 * 3600; // a stopped capture falls back to the committed seed after ~3 days
const WRITE = process.argv.includes('--write');
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

// One NSE cookie bootstrap (same as app/lib/fiidiiTrail.nseCookie).
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

async function fetchChain(cookie) {
  const res = await fetch('https://www.nseindia.com/api/option-chain-indices?symbol=NIFTY', {
    headers: {
      'User-Agent': UA,
      Accept: 'application/json',
      'Accept-Language': 'en-US,en;q=0.9',
      Referer: 'https://www.nseindia.com/option-chain',
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
  const cookie = await nseCookie();
  json = await fetchChain(cookie);
} catch (e1) {
  // NSE frequently 401s the first cold call — re-bootstrap once and retry.
  try { json = await fetchChain(await nseCookie()); } catch (e2) {
    console.error('[nifty-options] NSE fetch failed:', e2.message || e1.message);
    process.exit(1);
  }
}

const options = mapOptionChain(json, todayISO);
if (!options) {
  console.error('[nifty-options] chain returned no usable strikes — leaving snapshot unchanged');
  process.exit(1);
}
console.log('[nifty-options]', JSON.stringify(options));

if (!WRITE) {
  console.log('[nifty-options] dry-run — pass --write to commit KV + data/nifty-options.json');
  process.exit(0);
}

// Committed seed (fallback for the route; overwrites the checked-in placeholder).
const prev = (() => { try { return JSON.parse(readFileSync(OUT, 'utf8')); } catch { return {}; } })();
const out = {
  note: prev.note || 'NIFTY option-chain read for the Nifty 50 Overview. Written by scripts/capture-nifty-options.mjs (laptop, residential IP) → KV marketwrap:options. Non-personal public market data; safe to commit.',
  capturedAt: new Date().toISOString(),
  options,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
console.log('[nifty-options] wrote', OUT);

if (kvConfigured()) {
  const ok = await kvSetJSON(KEY, options, KV_TTL);
  console.log('[nifty-options] KV', KEY, ok ? 'ok' : 'FAILED');
} else {
  console.log('[nifty-options] KV not configured — committed JSON only');
}
