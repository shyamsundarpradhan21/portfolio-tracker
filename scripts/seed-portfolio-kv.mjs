// Seed the private portfolio data into Vercel KV (and a gitignored local JSON).
//
// Source of truth during the migration is app/portfolio.js. This imports it,
// captures every PRIVATE export (all data except presentation constants + the
// logic functions), and:
//   • always writes data/portfolio.private.json   (gitignored — local dev source)
//   • pushes it to KV key `portfolio:v1`           (deployed app source) if creds
//
// Run:  node scripts/seed-portfolio-kv.mjs           (dump + push if creds)
//       node scripts/seed-portfolio-kv.mjs --dump    (dump only, no KV)
//
// Captured values are the FINAL runtime values — i.e. after portfolio.js's own
// eval-time derivations (STATIC.algo, SWING's .map) — so the consumer side never
// re-derives; it just hydrates these objects in place.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'portfolio:v1';
const OUT = join(ROOT, 'data', 'portfolio.private.json');

// Presentation constants + logic stay in portfolio.js. The two scalars stay too:
// they can't be hydrated in place (a string/number binding isn't mutable) and are
// non-sensitive (a CAS date; a legacy realised-P&L figure unused outside this file).
const KEEP_STATIC = new Set(['ALLOC_COLORS', 'CAT_COLORS', 'CMPF_HATCH', 'UNITS_AS_OF', 'REALIZED_PNL']);

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

const P = await import(pathToFileURL(join(ROOT, 'app', 'portfolio.js')).href);
const data = {};
for (const [k, v] of Object.entries(P)) {
  if (typeof v === 'function') continue;   // logic stays in portfolio.js
  if (KEEP_STATIC.has(k)) continue;        // presentation constants stay
  data[k] = v;                             // private financial data → KV/JSON
}
const keys = Object.keys(data);

writeFileSync(OUT, JSON.stringify(data, null, 2) + '\n');
console.log(`dumped ${keys.length} private exports → data/portfolio.private.json`);
console.log('  ', keys.join(', '));

if (!process.argv.includes('--dump')) {
  if (!kvUrl || !kvTok) { console.log('no KV creds (mcp/.kv.env or env) — skipped KV push'); process.exit(0); }
  const r = await fetch(kvUrl, {
    method: 'POST',
    headers: { Authorization: `Bearer ${kvTok}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(['SET', KEY, JSON.stringify(data)]),
  });
  const j = await r.json();
  console.log(j?.result === 'OK' ? `pushed → KV ${KEY}` : `KV push: ${JSON.stringify(j).slice(0, 120)}`);
}
