// Intraday P&L capture DAEMON — the live path. One long-running process for the
// trading session: every 10s it snapshots F&O P&L (realised + open MTM) across
// Dhan/Upstox/Fyers, appends to the local archive, and publishes the day's tape
// to KV (intraday:<date>) so the deployed app reads it near-live with NO git /
// redeploy in the loop. Git is touched exactly ONCE — a single archive commit at
// market close. Launch it near 09:10 IST (Task Scheduler / launchd); it gates on
// the clock, exits cleanly after 15:32 IST, and is relaunched fresh each day.
//
//   node scripts/capture-daemon.mjs            # run the session loop
//   CAPTURE_FORCE=1 node scripts/capture-daemon.mjs   # ignore the market gate (debug)
//   TICK_MS=10000 ORDERS_EVERY=6 …             # tune cadence / orders throttle
//
// READ-ONLY broker access — only GETs positions/orders.

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { captureTick } from './lib/intradayTick.mjs';
import { marketState, istParts } from './lib/marketHours.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TICK_MS = +process.env.TICK_MS || 10_000;        // 10s default
const ORDERS_EVERY = +process.env.ORDERS_EVERY || 6;    // pending-order check ~1/min at 10s
const FORCE = !!process.env.CAPTURE_FORCE;

let inFlight = false;   // never let a slow poll stack onto the next tick
let n = 0;              // tick counter (drives the orders throttle)
let committed = false;  // archive committed once at close
let timer = null;

function commitArchive() {
  if (committed || process.env.SYNC_SKIP_GIT) return;
  try {
    execSync('git add data/fno-intraday.json', { cwd: ROOT });
    if (!execSync('git status --porcelain data/fno-intraday.json', { cwd: ROOT }).toString().trim()) { committed = true; return; }
    const { date } = istParts(Date.now());
    execSync(`git commit -m "chore: intraday P&L tape ${date}"`, { cwd: ROOT, stdio: 'inherit' });
    execSync('git fetch origin main', { cwd: ROOT });
    // --autostash so an unrelated dirty working tree (dev edits, other generated
    // files) at the 15:32 close doesn't abort the rebase and strand the commit.
    try { execSync('git rebase --autostash origin/main', { cwd: ROOT, stdio: 'inherit' }); }
    catch {
      try { execSync('git rebase --abort', { cwd: ROOT }); } catch {}
      console.error('archive: rebase onto main conflicted — commit left local, next close bundles it');
      return; // committed stays false: the local commit survives and next day's push carries it
    }
    const ahead = +execSync('git rev-list --count origin/main..HEAD', { cwd: ROOT }).toString().trim();
    if (ahead > 0) { execSync('git push origin HEAD:main', { cwd: ROOT, stdio: 'inherit' }); console.log('archive pushed'); }
    committed = true; // only now is the archive durably on origin/main
  } catch (e) { console.error('archive commit:', e.message); }
}

function stop(reason) {
  if (timer) clearInterval(timer);
  commitArchive();
  console.log(`capture-daemon: ${reason} — exiting`);
  process.exit(0);
}

async function tick() {
  const now = Date.now();
  const state = marketState(now);
  if (!FORCE && (state === 'post' || state === 'weekend')) return stop(`market ${state}`);
  if (!FORCE && state === 'pre') return; // launched early — idle until the open

  if (inFlight) { console.log(`${istParts(now).hhmm} tick skipped (in-flight)`); return; }
  inFlight = true;
  try {
    const withOrders = n % ORDERS_EVERY === 0;   // heavier pending-order check ~1/min
    const r = await captureTick({ withOrders, nowMs: now });
    if (r.ok) console.log(`${r.t} net ₹${r.net} · ${r.brokers.join('+') || 'none'}${r.pending ? ' · pending' : ''} · ${r.count} pts${r.kv ? ' · kv' : ''}`);
    else console.log(`${r.t || istParts(now).hhmm} ${r.reason}`);
  } catch (e) { console.error('tick error:', e?.message || e); }
  finally { inFlight = false; n++; }
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

console.log(`capture-daemon: starting (tick ${TICK_MS}ms, orders 1/${ORDERS_EVERY}, force=${FORCE})`);
await tick();                         // immediate first point
timer = setInterval(tick, TICK_MS);
