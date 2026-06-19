// Merge the Kite/Zerodha holdings into data/broker-state.json, then commit the whole
// file. Kite is the one broker Claude must drive interactively (hosted-OAuth MCP), so
// the /sync skill fetches the holdings and dumps the RAW mcp__kite__get_holdings
// response to a temp file; this script does the mapping + write + commit
// deterministically, so the skill never hand-edits the JSON (that was the fragile,
// prompt-heavy seam). Run as /sync step 3.
//
//   node scripts/merge-kite.mjs [path-to-kite-holdings.json]   (default data/.kite-holdings.json)
//   SYNC_SKIP_GIT=1 ...   to merge without committing (dry-run/tests)
//
// No Kite temp (login skipped) → INDIAN is left stale and only the 3 zero-touch
// sleeves already written by sync-brokers.mjs are committed.

import { readFileSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = join(ROOT, 'data', 'broker-state.json');
const KITE_TMP = join(ROOT, process.argv[2] || 'data/.kite-holdings.json');

const nowIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, '+05:30');
const readJSON = (p, fb = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };

const state = readJSON(STATE_PATH);
if (!state) { console.error('broker-state.json missing/unreadable — run sync-brokers.mjs first'); process.exit(1); }

// Map + merge the Kite sleeve, if a fresh dump is present.
let merged = 'skipped (no login this run)';
const raw = readJSON(KITE_TMP);
if (raw) {
  const list = Array.isArray(raw) ? raw : (raw.data || raw.holdings || []);
  const rows = list
    .filter((h) => h && (h.tradingsymbol || h.trading_symbol))
    .map((h) => ({
      sym: h.tradingsymbol || h.trading_symbol,
      qty: h.quantity ?? h.qty,
      avg: h.average_price ?? h.avg,
      ltp: h.last_price ?? h.ltp ?? null,
      pnl: h.pnl ?? null,
      dayPct: h.day_change_percentage ?? null,
    }));
  if (rows.length) {
    state.holdings.INDIAN = { source: 'Zerodha', syncedAt: nowIst(), rows };
    state.brokers.kite = { ok: true, note: '' };
    merged = `${rows.length} holdings`;
  } else {
    merged = 'empty payload — INDIAN left stale';
  }
}

state.syncedAt = nowIst();
const out = JSON.stringify(state, null, 2) + '\n';
JSON.parse(out); // guard: never write malformed JSON
writeFileSync(STATE_PATH, out);
if (existsSync(KITE_TMP)) { try { rmSync(KITE_TMP); } catch {} }
console.log(`kite: ${merged}`);

if (!process.env.SYNC_SKIP_GIT) {
  try {
    execSync('git add data/broker-state.json', { cwd: ROOT });
    if (execSync('git status --porcelain data/broker-state.json', { cwd: ROOT }).toString().trim()) {
      execSync(`git commit -m "chore: broker sync ${nowIst().slice(0, 10)}"`, { cwd: ROOT, stdio: 'inherit' });
      execSync('git push', { cwd: ROOT, stdio: 'inherit' });
      console.log('committed + pushed');
    } else { console.log('no change — skip commit'); }
  } catch (e) { console.error('git step failed:', e.message); }
}
