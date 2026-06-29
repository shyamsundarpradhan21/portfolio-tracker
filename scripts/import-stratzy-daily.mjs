// Stratzy daily capture + Dhan join → data/stratzy-daily.json → KV `stratzy-daily:v1`.
//
// DATA ONLY — no screen/scores here. Builds one record per algo:
//   Stratzy: live series + backtest series (split at liveSince) + backtest metrics
//   Dhan (joined on Stratzy._id == Dhan.id): correlation matrices + marketplace meta.
// Correlation exists only for the ~79 algos Dhan lists; Stratzy-only algos get
// dhan:null + correlationAvailable:false (flagged, NOT zeroed).
//
//   node scripts/import-stratzy-daily.mjs                 # data/stratzy-raw.json → join → KV
//   node scripts/import-stratzy-daily.mjs --paste f.csv   # scalar paste fallback
//   node scripts/import-stratzy-daily.mjs --dry           # write file, skip KV
//
// HARVEST: run scripts/lib/stratzy-harvest.snippet.js in a logged-in stratzy.in tab →
// data/stratzy-raw.json. For max correlation coverage, also drop the FULL Dhan harvest
// (STYLE=null → 79) at data/dhan-full.raw.json; otherwise the join falls back to the
// scoped Dhan file (data/algo-catalog.raw.json) and covers fewer algos.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { fromHarvest, fromPaste } from './lib/stratzy-adapter.mjs';
import { normalizeCatalog } from './lib/dhan-algos-adapter.mjs';
import { kvSetJSON, kvConfigured } from './lib/kv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'stratzy-daily:v1';
const OUT = join(ROOT, 'data', 'stratzy-daily.json');
const RAW = join(ROOT, 'data', 'stratzy-raw.json');
const PASTE = join(ROOT, 'data', 'stratzy-daily.paste.csv');
const DHAN_FULL = join(ROOT, 'data', 'dhan-full.raw.json');     // 79 (preferred)
const DHAN_SCOPED = join(ROOT, 'data', 'algo-catalog.raw.json'); // 41 (fallback)

const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : true) : null; };
const dry = !!flag('--dry');
const asOf = new Date();

// ── 1. Stratzy records ────────────────────────────────────────────────────────
let records, source;
const pastePath = flag('--paste') === true ? PASTE : flag('--paste');
if (pastePath) {
  if (!existsSync(pastePath)) { console.error(`paste not found: ${pastePath}`); process.exit(1); }
  records = fromPaste(readFileSync(pastePath, 'utf8'), { asOf });
  source = `paste/CSV (${pastePath.replace(ROOT, '.')})`;
} else {
  if (!existsSync(RAW)) { console.error(`no ${RAW.replace(ROOT, '.')} — run the stratzy harvest snippet first (or pass --paste).`); process.exit(1); }
  records = fromHarvest(JSON.parse(readFileSync(RAW, 'utf8')), { asOf });
  source = `browser-harvest (${RAW.replace(ROOT, '.')})`;
}

// ── 2. Dhan join source (prefer full 79, else scoped 41) ──────────────────────
const dhanPath = existsSync(DHAN_FULL) ? DHAN_FULL : (existsSync(DHAN_SCOPED) ? DHAN_SCOPED : null);
const dhanById = new Map();
if (dhanPath) {
  for (const d of normalizeCatalog(JSON.parse(readFileSync(dhanPath, 'utf8')))) if (d.id) dhanById.set(d.id, d);
}
const dhanLabel = dhanPath ? `${dhanPath.replace(ROOT, '.')} (${dhanById.size})` : 'NONE';

// ── 3. merge ──────────────────────────────────────────────────────────────────
let joined = 0;
for (const rec of records) {
  const d = dhanById.get(rec.id);
  if (d && d.correlations) {
    rec.dhan = { correlations: d.correlations, tags: d.tags, minAmount: d.minCapital, maxCapital: d.maxCapital, slotsLeft: d.slotsLeft, category: d.category };
    rec.correlationAvailable = true;
    joined++;
  } else {
    rec.dhan = null;
    rec.correlationAvailable = false;
  }
}

// ── 4. sanity guard ───────────────────────────────────────────────────────────
const withPerf = records.filter((r) => Object.keys(r.stratzy.performance).length > 0);
const withBacktest = records.filter((r) => r.stratzy.hasBacktestSegment);
console.log(`source: ${source} — ${records.length} algos (${withPerf.length} with curve, ${withBacktest.length} with backtest segment)`);
console.log(`dhan join: ${dhanLabel} → ${joined}/${records.length} have correlations`);
if (records.length < 50 || withPerf.length < records.length / 2) {
  console.error('REFUSING: too few algos or missing curves. Re-harvest.');
  process.exit(1);
}

// ── 5. write + KV ─────────────────────────────────────────────────────────────
const out = {
  source: 'stratzy/api/web/algo/list + dhan-catalog join',
  asOf: asOf.toISOString(),
  count: records.length,
  correlationCoverage: joined,
  algos: records,
};
writeFileSync(OUT, JSON.stringify(out));
console.log(`wrote ${OUT.replace(ROOT, '.')} (${records.length} algos, ${(JSON.stringify(out).length / 1e6).toFixed(2)} MB)`);

if (dry) { console.log('--dry: skipped KV'); process.exit(0); }
if (!kvConfigured()) { console.log('no KV creds — wrote file only.'); process.exit(0); }
const ok = await kvSetJSON(KEY, out);
console.log(ok ? `pushed → KV ${KEY}` : 'KV push failed (likely size) — file written regardless.');
process.exit(0);
