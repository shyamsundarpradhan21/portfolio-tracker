// Push the private portfolio data to Vercel KV (key `portfolio:v1`), which the
// deployed app reads at runtime via /api/portfolio.
//
// SOURCE OF TRUTH: data/portfolio.private.json (gitignored). To change holdings/
// salary/loans, edit that file then run:  node scripts/seed-portfolio-kv.mjs
//
// (The one-time extraction from app/portfolio.js is done — portfolio.js now ships
// empty containers, so this NEVER reads it. A sanity guard refuses to push data
// that looks empty, so a stale/empty source can't wipe KV.)

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'portfolio:v1';
const SRC = join(ROOT, 'data', 'portfolio.private.json');

// Minimal .env reader (mirrors sync-brokers): strips quotes, ignores comments.
function loadEnv(p) {
  try {
    const out = {};
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
      if (m) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
    }
    return out;
  } catch { return {}; }
}
const KV_ENV = loadEnv(join(ROOT, 'mcp', '.kv.env'));
const kvUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || KV_ENV.KV_REST_API_URL || KV_ENV.UPSTASH_REDIS_REST_URL;
const kvTok = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || KV_ENV.KV_REST_API_TOKEN || KV_ENV.UPSTASH_REDIS_REST_TOKEN;

const data = JSON.parse(readFileSync(SRC, 'utf8'));

// Realized P&L is *derived* from the broker tax reports, not hand-curated. If the
// committed canonical store exists, it owns INDIAN_REALIZED / US_REALIZED (regen
// it with scripts/parse-broker-tax.py). Overlaid here so realized still reaches
// the app via KV (never the client bundle), staying out of source-of-truth drift.
try {
  const bt = JSON.parse(readFileSync(join(ROOT, 'data', 'broker-tax.json'), 'utf8'));
  if (bt.indian_realized) data.INDIAN_REALIZED = bt.indian_realized;
  if (bt.us_realized) data.US_REALIZED = bt.us_realized;
  console.log(`overlay: data/broker-tax.json → INDIAN_REALIZED, US_REALIZED (derived, asOf ${bt.asOf})`);
} catch { /* no broker-tax.json yet — fall back to whatever is in the private seed */ }

const keys = Object.keys(data);

// Sanity guard — never push obviously-empty data (a populated container has
// length / keys / a scalar value). Aborts rather than wiping KV.
const populated = keys.filter((k) => {
  const v = data[k];
  return Array.isArray(v) ? v.length > 0 : (v && typeof v === 'object' ? Object.keys(v).length > 0 : v != null);
});
console.log(`source: data/portfolio.private.json — ${populated.length}/${keys.length} keys populated`);
if (!keys.length || populated.length < keys.length / 2) {
  console.error('REFUSING to push: data looks empty/stale. Fix data/portfolio.private.json first.');
  process.exit(1);
}

if (!kvUrl || !kvTok) {
  console.error('no KV creds (mcp/.kv.env or env) — cannot push.');
  process.exit(1);
}
const r = await fetch(kvUrl, {
  method: 'POST',
  headers: { Authorization: `Bearer ${kvTok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(['SET', KEY, JSON.stringify(data)]),
});
const j = await r.json();
console.log(j?.result === 'OK' ? `pushed → KV ${KEY} (${keys.length} keys)` : `KV push failed: ${JSON.stringify(j).slice(0, 160)}`);
process.exit(j?.result === 'OK' ? 0 : 1);
