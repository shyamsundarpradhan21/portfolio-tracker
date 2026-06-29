// Run the unbiased screen over the assembled stratzy-daily records and print the
// data-Review payload (held set + survivors + confront). DESCRIPTIVE — eliminate &
// confront, no single ranking. This is the background compute the data-Review renders;
// figures come from code (scripts/lib/algoScreen.mjs), never the LLM.
//
//   node scripts/screen-algos.mjs                 # default thresholds
//   node scripts/screen-algos.mjs --top 15        # show N survivors
//   node scripts/screen-algos.mjs --style "Hedged Options"   # restrict survivor view

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runScreen } from './lib/algoScreen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const flag = (n, d) => { const i = argv.indexOf(n); return i >= 0 ? (argv[i + 1] ?? true) : d; };
const TOP = +flag('--top', 12);
const styleFilter = flag('--style', null);

const data = JSON.parse(readFileSync(join(ROOT, 'data', 'stratzy-daily.json'), 'utf8'));
const { heldIds } = JSON.parse(readFileSync(join(ROOT, 'data', 'held-algos.json'), 'utf8'));
const s = runScreen(data.algos, { heldIds });

const fl = (f) => [f.provisional && 'provisional', f.noOverfitCheck && 'noOverfitCheck', f.noCorrelation && 'noCorrelation'].filter(Boolean).join(',') || '—';
const m = (x) => (x == null ? ' n/a' : String(x).padStart(6));
const liveLine = (r) => r.live ? `cagr ${m(r.live.cagr)} | sharpe ${m(r.live.sharpe)} | sortino ${m(r.live.sortino)} | maxDD ${m(r.live.maxDD)} | worst ${m(r.live.worstDay)} | skew ${m(r.live.skew)}` : 'no live series';

console.log(`\n══ UNBIASED ALGO SCREEN ══  universe ${data.algos.length} · held ${s.held.length} · survivors ${s.survivors.length} · flagged-out ${s.flaggedOut.length}`);
console.log(`thresholds: maxDD>${s.params.maxDDFloor} · overfitRatio≥${s.params.overfitMin} · liveDays≥${s.params.minLiveDays} · redundant corr>${s.params.redundantCorr}`);

console.log(`\n── HELD SET (judged on LIVE evidence only) ──`);
for (const h of s.held) {
  console.log(`\n  ${h.name}  [${h.style}]  liveDays ${h.liveDays} (${h.confidence})`);
  console.log(`    LIVE     ${liveLine(h)}`);
  console.log(`    backtest ${h.backtest ? liveLine({ live: h.backtest }) : '— fully-live, no in-curve backtest'}`);
  console.log(`    overfit  ${h.overfit ? `sharpe×${h.overfit.sharpe} cagr×${h.overfit.cagr}` : '— (noOverfitCheck)'}  ·  corr-to-basket avg ${m(h.corr.avg)} max ${m(h.corr.max)}  ·  flags ${fl(h.flags)}`);
}

console.log(`\n── REDUNDANCY in held basket (corr > ${s.params.redundantCorr}) ──`);
console.log(s.redundant.length ? s.redundant.map((r) => `  REDUNDANT: "${r.a}" ↔ "${r.b}"  corr ${r.corr}`).join('\n') : '  none');

console.log(`\n── CONFRONT MY PICKS (same-style, higher live sortino, more diversifying) ──`);
for (const c of s.confrontations) {
  if (!c.dominatedBy.length) { console.log(`  "${c.held}" (sortino ${c.heldSortino}): no same-style candidate dominates it.`); continue; }
  for (const d of c.dominatedBy) console.log(`  ${d.line}  [${d.confidence}, liveDays ${d.liveDays}]`);
}

let survs = s.survivors;
if (styleFilter) survs = survs.filter((r) => r.style === styleFilter);
console.log(`\n── TOP SURVIVORS by live sortino${styleFilter ? ` · style="${styleFilter}"` : ''} (comparison, NOT a rank) ──`);
for (const r of survs.slice(0, TOP)) {
  console.log(`  ${r.name.slice(0, 38).padEnd(38)} [${r.style.slice(0, 18).padEnd(18)}] sortino ${m(r.live.sortino)} | cagr ${m(r.live.cagr)} | maxDD ${m(r.live.maxDD)} | corr→basket ${m(r.corr.avg)} | ${r.confidence} | ${fl(r.flags)}`);
}

// flagged-out reason tally
const tally = {};
for (const r of s.flaggedOut) for (const why of r.outReasons) { const k = why.split(' ')[0]; tally[k] = (tally[k] || 0) + 1; }
console.log(`\n── FLAGGED OUT reason tally ──\n  ${Object.entries(tally).map(([k, v]) => `${k}:${v}`).join('  ')}`);
