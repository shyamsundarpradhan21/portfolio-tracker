// Monthly algo DECISION ENGINE (conviction mode — locked 2026-07-02, see tasks/todo.md).
// Assembles the frozen pipeline into ONE runnable command and emits the month's book with
// a written justification: fresh screen → conviction candidate pool → 2nd-worst-horizon
// persistence rank → allocateConviction (mandatory long-vol hedge) → justify → artifact + KV.
//
//   node scripts/build-monthly-reco.mjs --capital 1000000        # writes data/algo-monthly/<YYYY-MM>.json + KV
//   node scripts/build-monthly-reco.mjs --capital 1000000 --dry  # file only, skip KV
//
// Source is STRATZY ONLY (Dhan numbers are inflated — dropped): min/max = stratzy
// minimumCapital/maximumCapital, ranking on the live series + horizon PnLs. Refresh the
// harvest first (browser → import-stratzy-daily.mjs). Figures come from scripts/lib/*, never the LLM.

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRegimeCalendar } from '../app/lib/regime.mjs';
import { runScreen, buildScreenPayload, convictionCandidates, CATASTROPHIC_DD } from './lib/algoScreen.mjs';
import { allocateConviction, justify, labelBook } from './lib/algoAllocate.mjs';
import { kvSetJSON, kvConfigured } from './lib/kv.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const KEY = 'algo-monthly:latest';

const argv = process.argv.slice(2);
const flagVal = (n) => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : null; };
const dry = argv.includes('--dry');
const capital = Number(flagVal('--capital'));
if (!Number.isFinite(capital) || capital <= 0) {
  console.error('ERROR: --capital <rupees> is REQUIRED (a positive number). e.g. --capital 1000000');
  process.exit(1);
}

const data = JSON.parse(readFileSync(join(ROOT, 'data', 'stratzy-daily.json'), 'utf8'));
const { heldIds } = JSON.parse(readFileSync(join(ROOT, 'data', 'held-algos.json'), 'utf8'));
const { nifty, vix } = JSON.parse(readFileSync(join(ROOT, 'data', 'regime-inputs.json'), 'utf8'));

// ── 1. screen + persistence ────────────────────────────────────────────────────
const cal = buildRegimeCalendar(nifty, vix);
const screen = runScreen(data.algos, { heldIds, regimeCal: cal, capital });
const payload = buildScreenPayload(screen, { asOf: data.asOf }); // for the regimeRisk caveat

// ── 2. conviction candidate pool (pure — see algoScreen.convictionCandidates) ───
const candidates = convictionCandidates(screen, data.algos, heldIds);

// ── 3. allocate + justify + label ──────────────────────────────────────────────
const book = allocateConviction(candidates, { capital });
const justification = justify(book, { regimeCaveat: payload.regimeRisk?.caveat ?? null });
const labels = labelBook(book, candidates);
const heldNames = new Set(candidates.filter((c) => c.held).map((c) => c.algo));

// ── 4. artifact ────────────────────────────────────────────────────────────────
const asOf = new Date().toISOString();
const month = asOf.slice(0, 7); // YYYY-MM (the decision month)
const artifact = {
  asOf, month, capital, dataAsOf: data.asOf,
  params: {
    mode: book.mode, rank: '2nd-worst-horizon persistence → live Sortino',
    minLongVolShare: book.minLongVolShare, catastrophicFloor: CATASTROPHIC_DD,
    tier: screen.tier.name, admit: screen.tier.admit, source: 'stratzy',
  },
  candidates,        // metrics-at-decision (full ranked pool — for the monthly review to compare)
  book, justification, labels,
};

// Refuse-on-empty guard (mirrors build-algo-screen.mjs) — never publish a blank book.
if (!book.picks.length || candidates.length < 3) {
  console.error(`REFUSING to publish: book looks empty (picks ${book.picks.length}, pool ${candidates.length}). Check data/stratzy-daily.json + --capital.`);
  process.exit(1);
}

const OUTDIR = join(ROOT, 'data', 'algo-monthly');
mkdirSync(OUTDIR, { recursive: true });
const OUT = join(OUTDIR, `${month}.json`);
writeFileSync(OUT, JSON.stringify(artifact, null, 2) + '\n');

// ── 5. print — structure-first; backtest only as a survivorship-caveated aside ──
const inr = (n) => '₹' + Math.round(n).toLocaleString('en-IN');
console.log(`\n═══ Monthly algo book — ${month} · ${inr(capital)} · ${screen.tier.name} tier ═══`);
console.log(justification.headline);
if (justification.regimeCaveat) console.log('\n⚠ ' + justification.regimeCaveat);
console.log('\nPICKS (structure-first):');
for (const p of justification.perPick) {
  const label = heldNames.has(p.algo) ? 'KEEP' : 'ADD';
  console.log(`  [${label}] ${p.line}`);
}
if (labels.exit.length) console.log(`\nEXIT (held, no longer a top pick this month): ${labels.exit.join(', ')}`);
if (book.warnings.length) console.log('\n⚠ ' + book.warnings.join('\n⚠ '));
console.log('\n— aside (backtest, survivorship-biased — NOT the basis for the pick): live CAGR shown per algo in the artifact —');
console.log(`\nwrote ${OUT.replace(ROOT, '.')} · KEEP ${labels.keep.length} · ADD ${labels.add.length} · EXIT ${labels.exit.length}`);

// ── 6. KV ────────────────────────────────────────────────────────────────────
if (dry) { console.log('--dry: skipped KV'); process.exit(0); }
if (!kvConfigured()) { console.log('no KV creds (mcp/.kv.env) — wrote file only.'); process.exit(0); }
const ok = await kvSetJSON(KEY, artifact);
console.log(ok ? `pushed → KV ${KEY}` : 'KV push failed');
process.exit(ok ? 0 : 1);
