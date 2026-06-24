// Intraday P&L tape capture — snapshot the live F&O P&L (realised + open MTM)
// across Dhan/Upstox/Fyers and append a point to data/fno-intraday.json. Meant to
// run every few minutes during market hours (see SCHEDULE.md). Reads daily tokens
// off disk and NEVER mints — a broker without a token is skipped for the tick.
//
//   node scripts/capture-intraday.mjs            # capture + commit
//   SYNC_SKIP_GIT=1 node scripts/capture-intraday.mjs   # capture only
//   CAPTURE_FORCE=1 …                            # ignore the market-hours gate
//
// READ-ONLY broker access — only GETs positions/orders.

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { pullPositions } from './lib/brokers.mjs';
import { appendIntraday } from './lib/intraday.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const FILE = join(ROOT, 'data', 'fno-intraday.json');

// IST clock without pulling in a tz lib: shift the UTC instant by +5:30.
const istNow = () => new Date(Date.now() + 5.5 * 3600 * 1000);
const ist = istNow();
const iso = ist.toISOString();
const date = iso.slice(0, 10);
const hhmm = iso.slice(11, 16);
const dow = ist.getUTCDay(); // 0 Sun … 6 Sat (already shifted to IST)
const mins = ist.getUTCHours() * 60 + ist.getUTCMinutes();

// Market-hours gate: NSE 09:15–15:30 IST, Mon–Fri. Capture a few minutes either
// side so the open and the settle tick land. CAPTURE_FORCE bypasses (manual runs).
const OPEN = 9 * 60 + 13, CLOSE = 15 * 60 + 32;
if (!process.env.CAPTURE_FORCE && (dow === 0 || dow === 6 || mins < OPEN || mins > CLOSE)) {
  console.log(`capture-intraday: outside market hours (${hhmm} IST, dow ${dow}) — skipped`);
  process.exit(0);
}

const snap = await pullPositions();
if (!snap.any) {
  console.log(`capture-intraday @ ${hhmm}: no broker tokens available — nothing captured`);
  process.exit(0);
}

const istStamp = iso.replace(/\.\d+Z$/, '+05:30');
const count = appendIntraday(FILE, date, {
  t: hhmm, net: snap.net, byBroker: snap.byBroker, pending: snap.pending, istNow: istStamp,
});
console.log(`capture-intraday @ ${hhmm}: net ₹${snap.net} (${Object.keys(snap.byBroker).join('+') || 'none'})${snap.pending ? ' · pending order' : ''} — ${count} pts today`);

if (!process.env.SYNC_SKIP_GIT) {
  try {
    execSync(`git add data/fno-intraday.json`, { cwd: ROOT });
    if (execSync(`git status --porcelain data/fno-intraday.json`, { cwd: ROOT }).toString().trim()) {
      execSync(`git commit -m "chore: intraday P&L tape ${date} ${hhmm}"`, { cwd: ROOT, stdio: 'inherit' });
      execSync('git fetch origin main', { cwd: ROOT });
      try { execSync('git rebase origin/main', { cwd: ROOT, stdio: 'inherit' }); }
      catch { try { execSync('git rebase --abort', { cwd: ROOT }); } catch {} ; throw new Error('rebase conflict — next tick heals'); }
      const ahead = +execSync('git rev-list --count origin/main..HEAD', { cwd: ROOT }).toString().trim();
      if (ahead > 0) { execSync('git push origin HEAD:main', { cwd: ROOT, stdio: 'inherit' }); }
    }
  } catch (e) { console.error('git step:', e.message); }
}
