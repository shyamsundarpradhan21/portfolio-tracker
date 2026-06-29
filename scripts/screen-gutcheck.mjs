// Gut-check: per-regime LIVE breakdown for the held algos + a few candidates, so the
// regime conditioning can be eyeballed BEFORE styling. Figures from algoScreen.mjs.
//   node scripts/screen-gutcheck.mjs
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRegimeCalendar, regimeDistribution } from './lib/regime.mjs';
import { runScreen } from './lib/algoScreen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'data', 'stratzy-daily.json'), 'utf8'));
const { heldIds, deployedCapital } = JSON.parse(readFileSync(join(ROOT, 'data', 'held-algos.json'), 'utf8'));
const { nifty, vix } = JSON.parse(readFileSync(join(ROOT, 'data', 'regime-inputs.json'), 'utf8'));
const cal = buildRegimeCalendar(nifty, vix);
const s = runScreen(data.algos, { heldIds, regimeCal: cal, capital: deployedCapital });

const status = (r) => r.held ? 'HELD' : s.survivors.includes(r) ? 'SURVIVOR' : s.parked.includes(r) ? 'PARKED' : 'OUT';
const m = (x) => (x == null ? '   —' : String(x).padStart(7));
const byName = (re) => s.held.concat(s.survivors, s.parked, s.out).find((r) => re.test(r.name));

const dist = regimeDistribution(cal);
console.log(`\n3y market regime mix → trend ${JSON.stringify(dist.trend)} · vol ${JSON.stringify(dist.vol)}`);
console.log(`Capital ₹${deployedCapital.toLocaleString('en-IN')} → ${s.tier.name} tier (admits ${s.tier.admit.join('/')}; defined DD tol ${s.tier.dd.defined}%, undefined ${s.tier.dd.undefined}%)`);
console.log(`structure-relative DD (median ± MAD): ` + Object.entries(s.structureDD).filter(([, v]) => v).map(([k, v]) => `${k} med ${v.median} mad ${v.mad} (n${v.n})`).join(' · '));

function show(label, r) {
  if (!r) { console.log(`\n${label}: NOT FOUND`); return; }
  const rg = r.regime, lv = r.live || {};
  console.log(`\n${label}: ${r.name}`);
  console.log(`  structure=${r.structure} · style=${r.style} · liveDays=${r.liveDays} (${r.confidence}) · STATUS=${status(r)}` +
    (r.revisitTier ? ` (revisit at ${r.revisitTier})` : '') + (r.structureOutlier ? ' · ⚠️STRUCTURE-OUTLIER' : ''));
  console.log(`  LIVE overall: sortino ${m(lv.sortino)} | cagr ${m(lv.cagr)} | maxDD ${m(lv.maxDD)} | flags ${[r.flags.provisional && 'provisional', r.flags.noOverfitCheck && 'noOverfitCheck', r.flags.noCorrelation && 'noCorrelation'].filter(Boolean).join(',') || '—'}`);
  if (r.parkReasons?.length) console.log(`  parked: ${r.parkReasons.join('; ')}`);
  if (r.outReasons?.length) console.log(`  out: ${r.outReasons.join('; ')}`);
  console.log(`  regime (matched ${rg.matched}/${rg.matched + rg.unmatched} live days):`);
  console.log(`    regime    | days | sortino |   cagr% |  maxDD% | tested?`);
  for (const k of ['up', 'down', 'chop', 'stressed']) {
    const b = rg[k];
    console.log(`    ${k.padEnd(9)} | ${String(b.dayCount).padStart(4)} | ${m(b.sortino)} | ${m(b.cagr)} | ${m(b.maxDD)} | ${b.dayCount === 0 ? 'EMPTY (finding)' : b.thin ? 'thin/untested' : 'ok'}`);
  }
}

console.log(`\n═══════════ HELD ═══════════`);
for (const h of s.held) show('HELD', h);
console.log(`\n═══════════ CANDIDATES ═══════════`);
show('CAND', byName(/Ratio-Fluxer Credit Spread/));
show('CAND', byName(/Curvature Credit Spread/));
show('CAND', byName(/^Wise-Move 25% TSL/));   // a naked-buying survivor (parked at this tier?)
