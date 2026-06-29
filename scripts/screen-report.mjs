// Emit the full unbiased-screen output as plain markdown → audit/algo-screen.md.
// Figures come from scripts/lib/algoScreen.mjs (never the LLM). Gitignored output.
//   node scripts/screen-report.mjs

import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { runScreen } from './lib/algoScreen.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const data = JSON.parse(readFileSync(join(ROOT, 'data', 'stratzy-daily.json'), 'utf8'));
const { heldIds } = JSON.parse(readFileSync(join(ROOT, 'data', 'held-algos.json'), 'utf8'));
const s = runScreen(data.algos, { heldIds });

const n = (x) => (x == null ? 'n/a' : String(x));
const flags = (f) => [f.provisional && 'provisional', f.noOverfitCheck && 'noOverfitCheck', f.noCorrelation && 'noCorrelation'].filter(Boolean).join(', ') || '—';
const L = [];
const p = (...x) => L.push(x.join(''));

p(`# Unbiased algo screen — data review`);
p('');
p(`_Source: \`data/stratzy-daily.json\` (asOf ${data.asOf}). Figures computed by \`scripts/lib/algoScreen.mjs\`. Descriptive — eliminate & confront, NOT a ranking or allocator._`);
p('');
p(`**Universe** ${data.algos.length} · **held** ${s.held.length} · **survivors** ${s.survivors.length} · **flagged out** ${s.flaggedOut.length}`);
p(`**Thresholds** (tunable): live maxDD > ${s.params.maxDDFloor}% · overfitRatio ≥ ${s.params.overfitMin} · liveDays ≥ ${s.params.minLiveDays} · redundant corr > ${s.params.redundantCorr}`);
p('');

// ── held set ──
p(`## Held set (judged on LIVE evidence only)`);
p('');
p(`| algo | style | liveDays | conf | live sortino | live CAGR% | live maxDD% | worstDay% | skew | corr→basket (avg/max) | flags |`);
p(`|---|---|--:|---|--:|--:|--:|--:|--:|--:|---|`);
for (const h of s.held) {
  const lv = h.live || {};
  p(`| ${h.name} | ${h.style} | ${n(h.liveDays)} | ${h.confidence} | ${n(lv.sortino)} | ${n(lv.cagr)} | ${n(lv.maxDD)} | ${n(lv.worstDay)} | ${n(lv.skew)} | ${n(h.corr.avg)} / ${n(h.corr.max)} | ${flags(h.flags)} |`);
}
p('');
// held vs the screen's own floors
const breaches = s.held.filter((h) => h.live && h.live.maxDD != null && h.live.maxDD < s.params.maxDDFloor);
p(`**Held vs the screen's own floors:** ` + (breaches.length
  ? breaches.map((h) => `⚠️ "${h.name}" live maxDD ${h.live.maxDD}% is worse than the ${s.params.maxDDFloor}% floor it would reject others for.`).join(' ')
  : `all held algos clear the screen's own thresholds.`));
p('');
p(`**Redundancy in held basket (corr > ${s.params.redundantCorr}):** ` + (s.redundant.length
  ? s.redundant.map((r) => `REDUNDANT "${r.a}" ↔ "${r.b}" (corr ${r.corr})`).join('; ')
  : 'none — held algos are mutually diversifying.'));
p('');

// ── confront my picks ──
p(`## Confront my picks`);
p('');
p(`_"Dominated by" = a same-style survivor with **higher live sortino AND lower correlation-to-basket** (adds diversification). Strict AND._`);
p('');
let anyDom = false;
for (const c of s.confrontations) {
  if (c.dominatedBy.length) { anyDom = true; for (const d of c.dominatedBy) p(`- ${d.line}  _[${d.confidence}, liveDays ${d.liveDays}]_`); }
}
if (!anyDom) p(`- None. No candidate beats a held algo on live sortino **and** adds diversification.`);
p('');
// supplementary: same-style, higher live sortino, but NOT more diversifying (so not a strict dominator)
p(`_Supplementary — same-style survivors with higher live sortino but **not** more diversifying (shown so the comparison isn't hidden; not "dominators"):_`);
p('');
for (const h of s.held) {
  if (!h.live) continue;
  const higher = s.survivors.filter((r) => r.style === h.style && r.live?.sortino != null && r.live.sortino > h.live.sortino);
  if (!higher.length) { p(`- "${h.name}" (sortino ${h.live.sortino}): no same-style survivor has higher live sortino.`); continue; }
  for (const r of higher) p(`- "${h.name}" (sortino ${h.live.sortino}) < "${r.name}" (sortino ${r.live.sortino}, corr→basket ${n(r.corr.avg)} vs held ${n(h.corr.avg)}) — higher sortino, ${r.corr.avg != null && h.corr.avg != null && r.corr.avg < h.corr.avg ? 'MORE' : 'not more'} diversifying`);
}
p('');

// ── all survivors, grouped by style ──
p(`## All surviving candidates (${s.survivors.length})`);
p('');
p(`_Comparison, not a rank. Grouped by style; sorted by live sortino within each._`);
const byStyle = {};
for (const r of s.survivors) (byStyle[r.style] ||= []).push(r);
for (const style of Object.keys(byStyle).sort()) {
  const rows = byStyle[style].sort((a, b) => (b.live?.sortino ?? -Infinity) - (a.live?.sortino ?? -Infinity));
  p('');
  p(`### ${style} (${rows.length})`);
  p('');
  p(`| algo | liveDays | conf | live sortino | live CAGR% | live maxDD% | corr→held | flags |`);
  p(`|---|--:|---|--:|--:|--:|--:|---|`);
  for (const r of rows) {
    const lv = r.live || {};
    p(`| ${r.name} | ${n(r.liveDays)} | ${r.confidence} | ${n(lv.sortino)} | ${n(lv.cagr)} | ${n(lv.maxDD)} | ${n(r.corr.avg)} | ${flags(r.flags)} |`);
  }
}
p('');

// ── flagged-out tally ──
const tally = {};
for (const r of s.flaggedOut) for (const why of r.outReasons) { const k = why.split(' ')[0].replace('no', 'no-live'); tally[k] = (tally[k] || 0) + 1; }
p(`## Flagged out (${s.flaggedOut.length})`);
p('');
p(`Reason tally (an algo can hit several): ` + Object.entries(tally).map(([k, v]) => `**${k}** ${v}`).join(' · '));
p('');

// ── legend ──
p(`## Flag & column legend`);
p('');
p(`- **provisional** — liveDays < 90 (thin live history; treat figures as tentative). Confidence: < 90d provisional · 90–180 moderate · > 180 ok.`);
p(`- **noOverfitCheck** — fully-live algo (no backtest segment in the curve), so live-vs-backtest overfit ratio can't be computed.`);
p(`- **noCorrelation** — algo isn't in Dhan's catalog (Stratzy-only), so no correlation matrix → \`corr→held\` is n/a and diversification can't be assessed.`);
p(`- **live sortino / CAGR% / maxDD%** — computed from \`split.live\` (per-trade-day return %); CAGR annualized additively (matches Stratzy's headline). maxDD = worst peak-to-trough of the additive cumulative curve.`);
p(`- **corr→held / corr→basket** — signed avg correlation to the held basket (low/negative = diversifying; high positive = redundant). \`max\` = most-positive correlation to any single held algo.`);
p(`- **Flag OUT rules** — live maxDD < ${s.params.maxDDFloor}% · overfitRatio < ${s.params.overfitMin} (where it exists) · liveDays < ${s.params.minLiveDays}. Held algos are never flagged out (always shown, judged on live).`);

mkdirSync(join(ROOT, 'audit'), { recursive: true });
writeFileSync(join(ROOT, 'audit', 'algo-screen.md'), L.join('\n') + '\n');
console.log(`wrote audit/algo-screen.md — ${L.length} lines · held ${s.held.length} · survivors ${s.survivors.length} · flagged ${s.flaggedOut.length}`);
