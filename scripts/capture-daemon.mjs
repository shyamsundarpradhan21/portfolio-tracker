// Intraday P&L capture DAEMON — the live path. One long-running process per
// session that snapshots P&L, appends a local archive, and publishes each day's
// tape to KV so the deployed app reads it near-live with NO git/redeploy in the
// loop. Git is touched exactly ONCE — a single archive commit at the session close.
//
// Two session modes (run as two scheduled instances):
//   SESSION=in  (default) — 09:13–15:32 IST: F&O (10s) + Indian equity (60s)
//   SESSION=us            — 18:45 IST→02:30 IST: US equity day-change (60s, INR)
//
//   node scripts/capture-daemon.mjs                 # India session (default)
//   SESSION=us node scripts/capture-daemon.mjs      # US session (evening)
//   CAPTURE_FORCE=1 …                               # ignore the market gate (debug)
//
// READ-ONLY broker access — only GETs positions/orders.

import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { captureTick, captureEquityTick, captureUsTick } from './lib/intradayTick.mjs';
import { marketState, usMarketState, istParts } from './lib/marketHours.mjs';
import { keepSystemAwake } from './lib/keepAwake.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SESSION = process.env.SESSION === 'us' ? 'us' : 'in';
const TICK_MS = +process.env.TICK_MS || 10_000;        // F&O cadence (10s)
const EQUITY_MS = +process.env.EQUITY_MS || 60_000;     // equity cadence (60s, Yahoo-polite)
const ORDERS_EVERY = +process.env.ORDERS_EVERY || 6;    // pending-order check ~1/min at 10s
const FORCE = !!process.env.CAPTURE_FORCE;

// Each capture runs on its own loop with its own in-flight guard, so a slow
// quote-fetch can never stall (or skip) another loop's cadence.
let fnoBusy = false, eqBusy = false, usBusy = false;
let started = false;   // US session: has the window opened yet (to detect close)?
let n = 0;             // F&O tick counter (drives the orders throttle)
const timers = [];
let committed = false;  // archive committed once at close
let timer = null;
let releaseAwake = () => {};  // power request held while capturing (set at start)

function commitArchive() {
  if (committed || process.env.SYNC_SKIP_GIT) return;
  try {
    const FILES = 'data/fno-intraday.json data/eq-intraday.json data/us-intraday.json';
    execSync(`git add ${FILES}`, { cwd: ROOT });
    if (!execSync(`git status --porcelain ${FILES}`, { cwd: ROOT }).toString().trim()) { committed = true; return; }
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
  timers.forEach(clearInterval);
  try { releaseAwake(); } catch {}   // let the laptop sleep normally again
  commitArchive();
  console.log(`capture-daemon: ${reason} — exiting`);
  process.exit(0);
}

// Returns true while this session's market window is open (or FORCE); calls stop()
// once the session is over. India gates on marketState (pre/open/post/weekend);
// US gates on usMarketState (open/closed) over its evening→overnight window.
function windowOpen() {
  const now = Date.now();
  if (SESSION === 'us') {
    if (FORCE) return true;
    if (usMarketState(now) === 'open') { started = true; return true; }
    // Before the evening open we idle; once it has opened and then closed, stop.
    if (started) { stop('US session closed'); return false; }
    return false; // launched early — idle until the US open
  }
  const state = marketState(now);
  if (!FORCE && (state === 'post' || state === 'weekend')) { stop(`market ${state}`); return false; }
  if (!FORCE && state === 'pre') return false; // launched early — idle until the open
  return true;
}

async function fnoTick() {
  if (!windowOpen() || fnoBusy) return;
  fnoBusy = true;
  const now = Date.now();
  try {
    const withOrders = n % ORDERS_EVERY === 0;   // heavier pending-order check ~1/min
    const r = await captureTick({ withOrders, nowMs: now });
    if (r.ok) console.log(`${r.t} F&O net ₹${r.net} · ${r.brokers.join('+') || 'none'}${r.pending ? ' · pending' : ''} · ${r.count} pts${r.kv ? ' · kv' : ''}`);
    else console.log(`${r.t || istParts(now).hhmm} F&O ${r.reason}`);
  } catch (e) { console.error('F&O tick error:', e?.message || e); }
  finally { fnoBusy = false; n++; }
}

async function eqTick() {
  if (!windowOpen() || eqBusy) return;
  eqBusy = true;
  const now = Date.now();
  try {
    const e = await captureEquityTick({ nowMs: now });
    if (e.ok) console.log(`${e.t} EQ  net ₹${e.net} · ${e.covered} held${e.missing?.length ? ` · ${e.missing.length} no-quote` : ''} · ${e.count} pts${e.kv ? ' · kv' : ''}`);
    else console.log(`${e.t || istParts(now).hhmm} EQ  ${e.reason}`);
  } catch (e) { console.error('EQ tick error:', e?.message || e); }
  finally { eqBusy = false; }
}

async function usTick() {
  if (!windowOpen() || usBusy) return;
  usBusy = true;
  const now = Date.now();
  try {
    const e = await captureUsTick({ nowMs: now });
    if (e.ok) console.log(`${e.t} US  net ₹${e.net} ($${e.usd}) · ${e.covered} held${e.missing?.length ? ` · ${e.missing.length} no-quote` : ''} · ${e.count} pts${e.kv ? ' · kv' : ''}`);
    else console.log(`${e.t || istParts(now).hhmm} US  ${e.reason}`);
  } catch (e) { console.error('US tick error:', e?.message || e); }
  finally { usBusy = false; }
}

process.on('SIGTERM', () => stop('SIGTERM'));
process.on('SIGINT', () => stop('SIGINT'));

// Hold a system power request so idle sleep can't suspend the session mid-window
// (released in stop()). No-op off Windows; never blocks capture if it fails.
releaseAwake = keepSystemAwake();

if (SESSION === 'us') {
  console.log(`capture-daemon: starting US session (EQ ${EQUITY_MS}ms, force=${FORCE})`);
  usTick();
  timers.push(setInterval(usTick, EQUITY_MS));
} else {
  console.log(`capture-daemon: starting India session (F&O ${TICK_MS}ms, EQ ${EQUITY_MS}ms, orders 1/${ORDERS_EVERY}, force=${FORCE})`);
  await fnoTick();                    // immediate first F&O point
  eqTick();                          // kick equity (independent; don't await — it's slower)
  timers.push(setInterval(fnoTick, TICK_MS), setInterval(eqTick, EQUITY_MS));
}
