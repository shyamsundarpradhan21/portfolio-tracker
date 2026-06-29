// Track B — Dhan Algos catalog → data/algo-catalog.json → KV `algo-catalog:v1`.
//
// MONTHLY research feed: the full algo universe + backtest/return/risk metrics, to
// drive capital-allocation maths. NOT live P&L (that's Track A = Stratzy).
//
// Source precedence (same adapter interface, only the source swaps):
//   1. browser-harvest JSON  (default data/algo-catalog.raw.json)  — preferred
//   2. paste/CSV             (--paste <file> or data/algo-catalog.paste.csv) — durable fallback
//
//   node scripts/import-dhan-catalog.mjs                         # auto: harvest file else paste
//   node scripts/import-dhan-catalog.mjs --harvest path.json     # force harvest source
//   node scripts/import-dhan-catalog.mjs --paste path.csv        # force paste source
//   node scripts/import-dhan-catalog.mjs --styles "Hedged Options,Naked Option Buying"  # scope by style
//   node scripts/import-dhan-catalog.mjs --dry                   # normalize + write file, skip KV
//
// We are scoped to HEDGED OPTIONS + NAKED OPTION BUYING (the two trading styles the
// user allocates across). The harvest snippet filters to those (tags Hedged/Buying);
// --styles is an extra safety filter at import time (default = both).
//
// HOW TO HARVEST (monthly, ~30 sec): log in at https://algos.dhan.co/all-algos, open
// DevTools console, run the snippet in scripts/lib/dhan-harvest.snippet.js — it reads
// the page's own full catalog cache (sessionStorage `dhan_all_algos_cache_v2`, rich
// fields incl. correlation matrices), filters to the wanted styles, and downloads
// algo-catalog.raw.json. Drop that file in data/ and run this importer.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fromHarvest, fromPaste } from './lib/dhan-algos-adapter.mjs';
import { kvSetJSON, kvConfigured } from './lib/kv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'algo-catalog:v1';
const OUT = join(ROOT, 'data', 'algo-catalog.json');
const HARVEST = join(ROOT, 'data', 'algo-catalog.raw.json');
const PASTE = join(ROOT, 'data', 'algo-catalog.paste.csv');

const argv = process.argv.slice(2);
const flag = (name) => { const i = argv.indexOf(name); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null; };
const dry = !!flag('--dry');

// ── pick source ──────────────────────────────────────────────────────────────
let rows, source;
const harvestPath = flag('--harvest') === true ? HARVEST : (flag('--harvest') || (flag('--paste') ? null : (existsSync(HARVEST) ? HARVEST : null)));
const pastePath = flag('--paste') === true ? PASTE : (flag('--paste') || (harvestPath ? null : (existsSync(PASTE) ? PASTE : null)));

if (harvestPath) {
  if (!existsSync(harvestPath)) { console.error(`harvest file not found: ${harvestPath}`); process.exit(1); }
  rows = fromHarvest(JSON.parse(readFileSync(harvestPath, 'utf8')));
  source = `browser-harvest (${harvestPath.replace(ROOT, '.')})`;
} else if (pastePath) {
  if (!existsSync(pastePath)) { console.error(`paste file not found: ${pastePath}`); process.exit(1); }
  rows = fromPaste(readFileSync(pastePath, 'utf8'));
  source = `paste/CSV (${pastePath.replace(ROOT, '.')})`;
} else {
  console.error(`no source found. Provide ${HARVEST.replace(ROOT, '.')} (browser-harvest) or ${PASTE.replace(ROOT, '.')} (paste), or pass --harvest/--paste <file>.`);
  process.exit(1);
}

// ── scope by trading style (default: the two the user allocates across) ───────
const DEFAULT_STYLES = ['Hedged Options', 'Naked Option Buying'];
const stylesArg = typeof flag('--styles') === 'string' ? flag('--styles') : null;
const styleAllow = stylesArg ? stylesArg.split(',').map((s) => s.trim()).filter(Boolean) : DEFAULT_STYLES;
const before = rows.length;
// Only filter when the data actually carries styles (cache source); paste/search
// rows without a style pass through untouched so the fallback path still works.
if (rows.some((r) => r.style)) rows = rows.filter((r) => styleAllow.includes(r.style));
const styleBreak = rows.reduce((m, r) => ((m[r.style || 'unstyled'] = (m[r.style || 'unstyled'] || 0) + 1), m), {});

// ── sanity guard — never write/push an obviously-broken catalog ───────────────
const withMetrics = rows.filter((r) => r.returns != null || r.cagr != null || r.rank != null || r.score != null);
console.log(`source: ${source} — ${before} algos → ${rows.length} in scope [${styleAllow.join(', ')}] ${JSON.stringify(styleBreak)}; ${withMetrics.length} with metrics`);
if (rows.length < 5 || withMetrics.length < rows.length / 2) {
  console.error('REFUSING: catalog looks empty/broken (too few rows or missing metrics). Re-harvest.');
  process.exit(1);
}

// ── write committed snapshot ──────────────────────────────────────────────────
const catalog = {
  source: 'dhan-algos/all-algos-cache',
  styles: styleAllow,
  asOf: new Date().toISOString(),
  count: rows.length,
  algos: rows.sort((a, b) => (b.score ?? -Infinity) - (a.score ?? -Infinity)),
};
writeFileSync(OUT, JSON.stringify(catalog, null, 2));
console.log(`wrote ${OUT.replace(ROOT, '.')} (${rows.length} algos)`);

// ── publish to KV ─────────────────────────────────────────────────────────────
if (dry) { console.log('--dry: skipped KV push'); process.exit(0); }
if (!kvConfigured()) { console.log('no KV creds (mcp/.kv.env) — wrote file only, skipped KV.'); process.exit(0); }
const ok = await kvSetJSON(KEY, catalog);
console.log(ok ? `pushed → KV ${KEY} (${rows.length} algos)` : `KV push failed`);
process.exit(ok ? 0 : 1);
