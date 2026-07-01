// Monthly REVIEW + self-learning (Phase 4, locked 2026-07-02). Scores LAST month's decision
// artifact against what actually happened forward, writes a review record, and PROPOSES
// threshold tweaks — never applies them (locked: no silent refitting to a handful of months;
// confirmed lessons graduate to tasks/feedback.md BY HAND).
//
//   node scripts/review-monthly.mjs          # reviews the latest artifact strictly older than this month
//   node scripts/review-monthly.mjs --dry    # same, but don't write the review file
//
// Needs a FRESH data/stratzy-daily.json (re-harvest first) — the forward window is the days
// SINCE the decision, so stale data has nothing to review. Runs from the Cowork scheduled task.

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildRegimeCalendar } from '../app/lib/regime.mjs';
import { reviewMonth, proposeTweaks } from './lib/algoReview.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const MONTHLY_DIR = join(ROOT, 'data', 'algo-monthly');
const REVIEW_DIR = join(MONTHLY_DIR, 'reviews');
const dry = process.argv.includes('--dry');

const nowMonth = new Date().toISOString().slice(0, 7); // YYYY-MM

// ── 1. latest artifact STRICTLY older than this month ───────────────────────────
if (!existsSync(MONTHLY_DIR)) { console.log('Nothing to review yet — no data/algo-monthly/ artifacts exist.'); process.exit(0); }
const priorMonths = readdirSync(MONTHLY_DIR)
  .filter((f) => /^\d{4}-\d{2}\.json$/.test(f))
  .map((f) => f.slice(0, 7))
  .filter((m) => m < nowMonth)
  .sort();
if (!priorMonths.length) {
  console.log(`Nothing to review yet — the only artifact(s) are from the current month (${nowMonth}). The first real review runs next month-start.`);
  process.exit(0);
}
const month = priorMonths[priorMonths.length - 1];
const artifact = JSON.parse(readFileSync(join(MONTHLY_DIR, `${month}.json`), 'utf8'));

// ── 2. fresh data (warn HARD if stale — the forward window needs days since the decision) ─
const data = JSON.parse(readFileSync(join(ROOT, 'data', 'stratzy-daily.json'), 'utf8'));
const { nifty, vix } = JSON.parse(readFileSync(join(ROOT, 'data', 'regime-inputs.json'), 'utf8'));
const staleDays = Math.round((Date.now() - Date.parse(data.asOf)) / 86400000);
if (staleDays > 2) {
  console.warn(`\n⚠⚠  data/stratzy-daily.json is ${staleDays} days stale (asOf ${data.asOf}). RE-HARVEST first —`);
  console.warn('    reviewing against stale data understates the forward window and the calibration is meaningless.\n');
}

// ── 3. review ───────────────────────────────────────────────────────────────────
const cal = buildRegimeCalendar(nifty, vix);
const review = reviewMonth(artifact, data.algos, { regimeCal: cal });
review.reviewedAt = new Date().toISOString();
review.month = month;
review.dataAsOf = data.asOf;
review.proposals = proposeTweaks(review);

// ── 4. write + print (proposals ONLY — never auto-applied) ──────────────────────
if (!dry) {
  mkdirSync(REVIEW_DIR, { recursive: true });
  writeFileSync(join(REVIEW_DIR, `${month}.json`), JSON.stringify(review, null, 2) + '\n');
}

const pctS = (f) => (f == null ? '—' : `${Math.round(f * 100)}%`);
const c = review.calibration;
console.log(`\n═══ Monthly review — ${month} (forward to ${data.asOf.slice(0, 10)}, ${review.window.tradingDays} trading days) ═══`);
if (review.lowConfidence) console.log('⚠ LOW-CONFIDENCE window — every line below is provisional, NOT a verdict.');
console.log(`\nCalibration:`);
console.log(`  rank → forward-return agreement (Spearman): ${c.rankSpearman ?? '—'}   (+1 = the rank predicted the forward order; ~0 = no skill)`);
console.log(`  hit rate (funded picks positive forward):   ${pctS(c.hitRate)}`);
console.log(`  forward DD breaches (deeper than gate):     ${c.ddBreaches}`);
console.log(`  picks that hit a stressed regime forward:   ${c.stressedForward.length ? c.stressedForward.map((s) => `${s.algo} (${s.stressDays}d, ${s.stressReturn}%)`).join(', ') : 'none'}`);
console.log(`\nCounterfactual (did KEEP/EXIT/ADD add value?):`);
console.log(`  funded book avg forward:  ${review.counterfactual.fundedAvg ?? '—'}%`);
console.log(`  EXITed algos avg forward: ${review.counterfactual.exitedAvg ?? '—'}%   → KEEP/EXIT value-add ${review.counterfactual.keepExitValueAdd ?? '—'}%`);
console.log(`  top unfunded avg forward: ${review.counterfactual.unfundedAvg ?? '—'}%   → ADD value-add ${review.counterfactual.addValueAdd ?? '—'}%`);
console.log(`\nPer pick:`);
for (const p of review.picks) {
  console.log(`  [${p.label}] ${p.algo} — forward ${p.forwardReturn ?? '—'}% over ${p.daysObserved}d · realised DD ${p.realisedMaxDD ?? '—'}% (gate ${p.gateMaxDD ?? '—'}%)${p.ddBreach ? ' ⚠BREACH' : ''}`);
}
console.log(`\nPROPOSED tweaks (suggestions only — nothing is applied; graduate confirmed lessons to tasks/feedback.md by hand):`);
for (const t of review.proposals) console.log(`  • ${t}`);
console.log(dry ? '\n--dry: review not written.' : `\nwrote ${join(REVIEW_DIR, `${month}.json`).replace(ROOT, '.')}`);
