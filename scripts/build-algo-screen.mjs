// Build the structured algo-screen payload and publish it for the Review sub-tab.
// Precompute → KV (read at runtime by /api/algo-screen) + a gitignored local fallback
// (data/algo-screen.json) for dev where KV is empty. The frontend NEVER runs the screen
// at render — it reads this artifact. Refresh monthly (or after a held-basket change):
//
//   node scripts/build-algo-screen.mjs
//
// Figures are computed by scripts/lib/algoScreen.mjs over data/stratzy-daily.json;
// regime calendar from app/lib/regime.mjs over data/regime-inputs.json. Never the LLM.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRegimeCalendar } from '../app/lib/regime.mjs';
import { runScreen, buildScreenPayload } from './lib/algoScreen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'algo-screen:v1';
const OUT = join(ROOT, 'data', 'algo-screen.json');

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

const data = JSON.parse(readFileSync(join(ROOT, 'data', 'stratzy-daily.json'), 'utf8'));
const { heldIds, deployedCapital } = JSON.parse(readFileSync(join(ROOT, 'data', 'held-algos.json'), 'utf8'));
const { nifty, vix } = JSON.parse(readFileSync(join(ROOT, 'data', 'regime-inputs.json'), 'utf8'));

// Optional `--capital <rupees>` overrides the tier's capital basis (e.g. to screen the
// month's target allocation) WITHOUT editing data/held-algos.json's real deployedCapital.
const cIdx = process.argv.indexOf('--capital');
const capital = (cIdx >= 0 && Number(process.argv[cIdx + 1])) ? Number(process.argv[cIdx + 1]) : deployedCapital;

const cal = buildRegimeCalendar(nifty, vix);
const screen = runScreen(data.algos, { heldIds, regimeCal: cal, capital });
const payload = buildScreenPayload(screen, { asOf: data.asOf });

// Sanity guard — refuse to publish an empty/degenerate screen (would blank the tab).
if (!payload.held.length || payload.counts.universe < 5) {
  console.error(`REFUSING to publish: screen looks empty (held ${payload.held.length}, universe ${payload.counts.universe}). Check data/stratzy-daily.json + data/held-algos.json.`);
  process.exit(1);
}

writeFileSync(OUT, JSON.stringify(payload, null, 2) + '\n');
const c = payload.counts;
console.log(`wrote data/algo-screen.json — asOf ${payload.asOf} · ${payload.capitalTier.name} tier · universe ${c.universe} · held ${c.held} · survivors ${c.survivors} · parked ${c.parked} · out ${c.out}`);

if (!kvUrl || !kvTok) {
  console.warn('no KV creds (mcp/.kv.env or env) — wrote local fallback only; prod will serve the committed-empty default until seeded.');
  process.exit(0);
}
const r = await fetch(kvUrl, {
  method: 'POST',
  headers: { Authorization: `Bearer ${kvTok}`, 'Content-Type': 'application/json' },
  body: JSON.stringify(['SET', KEY, JSON.stringify(payload)]),
});
const j = await r.json();
console.log(j?.result === 'OK' ? `pushed → KV ${KEY}` : `KV push failed: ${JSON.stringify(j).slice(0, 160)}`);
process.exit(j?.result === 'OK' ? 0 : 1);
