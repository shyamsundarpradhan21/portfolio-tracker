// Daily net-worth snapshot → committed to the repo (permanent, cross-device).
//
// Boots the app headlessly and lets IT compute net worth with its own live
// math (quotes, FX, NAV, FD accrual, CMPF, loan) — the page records its daily
// snapshot to localStorage exactly as it does for a human visit; we harvest
// that entry and write two committed artifacts (zero duplicated formulas):
//   - data/SNAPSHOT.md            the NW/assets/invested row (human-readable)
//   - data/snapshot-sleeves.json  the per-sleeve {v,i} breakdown keyed by date,
//                                 so the gain-attribution waffles light up for
//                                 every window (week/month/year) from durable
//                                 history, not just the browser's localStorage.
// Then git add + commit + push — without that, a Remote (cloud) routine run
// loses the row when its workspace is torn down. SNAPSHOT_SKIP_GIT=1 writes the
// files without committing (local dry-run).
//
// Usage: node scripts/record-snapshot.mjs   (run after market close ideally)
// Exit codes: 0 ok · 1 snapshot not produced (quotes missing?) · 2 infra

import { spawn, execSync } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MD = path.join(ROOT, 'data', 'SNAPSHOT.md');
const SL_FILE = path.join(ROOT, 'data', 'snapshot-sleeves.json');
const PORT = 3217;

const log = (m) => console.log(`[snapshot] ${m}`);

const git = (args) => execSync(`git ${args}`, { cwd: ROOT, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();

// Bank the snapshot in the repo. A Remote routine runs in an ephemeral cloud
// workspace, so anything not committed+pushed is lost — that's why daily rows
// never accumulated before. Resilient: a push failure keeps the commit.
function commitAndPush(date) {
  try { if (!git('config user.email')) throw new Error('no identity'); }
  catch {
    try { git('config user.email "shyamsundar.pradhan21@gmail.com"'); git('config user.name "Shyamsundar Pradhan"'); } catch {}
  }
  try {
    git('add data/SNAPSHOT.md data/snapshot-sleeves.json');
    let changed = true;
    try { git('diff --cached --quiet'); changed = false; } catch { changed = true; }
    if (!changed) { log('no snapshot changes to commit.'); return; }
    git(`commit -m "chore: daily snapshot ${date}"`);
    log('committed.');
    try { git('push'); log('pushed.'); }
    catch (e) { log('push FAILED (commit kept locally): ' + (e.stderr?.toString() || e.message)); }
  } catch (e) { log('git step failed: ' + (e.stderr?.toString() || e.message)); }
}

async function main() {
  log('starting dev server…');
  const server = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx',
    ['next', 'dev', '-p', String(PORT)],
    { cwd: ROOT, stdio: 'pipe', shell: process.platform === 'win32' });
  const kill = () => { try { server.kill('SIGTERM'); } catch {} };
  process.on('exit', kill);

  await new Promise((res, rej) => {
    const t = setTimeout(() => rej(new Error('server start timeout')), 90e3);
    server.stdout.on('data', (b) => { if (String(b).includes('Ready')) { clearTimeout(t); res(); } });
    server.on('exit', () => rej(new Error('server died')));
  });

  log('launching headless browser…');
  const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
  try {
    const page = await browser.newPage();
    await page.goto(`http://localhost:${PORT}`, { waitUntil: 'domcontentloaded', timeout: 60e3 });

    log('waiting for the app to record today’s snapshot…');
    const today = new Date().toISOString().slice(0, 10);
    await page.waitForFunction((d) => {
      try {
        const a = JSON.parse(localStorage.getItem('nwTracker.snapshots') || '[]');
        return a.some((s) => s.d === d && Number.isFinite(s.nw));
      } catch { return false; }
    }, { timeout: 150e3, polling: 1000 }, today);

    const snap = await page.evaluate((d) =>
      JSON.parse(localStorage.getItem('nwTracker.snapshots')).find((s) => s.d === d), today);
    log(`got ${snap.d}: nw=${snap.nw} assets=${snap.assets} invested=${snap.invested}`);

    // Upsert the markdown row (same-date rows are replaced — last write wins)
    const row = `| ${snap.d} | ${snap.nw} | ${snap.assets ?? ''} | ${snap.invested ?? ''} |`;
    const md = readFileSync(MD, 'utf8');
    const lines = md.split('\n').filter((l) => !l.startsWith(`| ${snap.d} `));
    while (lines.length && lines[lines.length - 1].trim() === '') lines.pop();
    writeFileSync(MD, lines.join('\n') + '\n' + row + '\n');
    log('SNAPSHOT.md updated.');

    // Per-sleeve breakdown → sidecar JSON keyed by date, so the gain-attribution
    // waffles work for every window from durable history (SNAPSHOT.md only carries
    // NW). Skipped silently if the page didn't attach a per-sleeve breakdown.
    if (snap.sl && typeof snap.sl === 'object') {
      let sleeves = {};
      try { sleeves = JSON.parse(readFileSync(SL_FILE, 'utf8')) || {}; } catch {}
      sleeves[snap.d] = snap.sl;
      const sorted = Object.fromEntries(Object.keys(sleeves).sort().map((k) => [k, sleeves[k]]));
      writeFileSync(SL_FILE, JSON.stringify(sorted, null, 2) + '\n');
      log(`snapshot-sleeves.json updated (${Object.keys(snap.sl).length} sleeves).`);
    } else {
      log('no per-sleeve breakdown in snapshot — sidecar left unchanged.');
    }

    if (process.env.SNAPSHOT_SKIP_GIT) log('SNAPSHOT_SKIP_GIT set — not committing.');
    else commitAndPush(snap.d);
  } finally {
    await browser.close();
    kill();
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[snapshot] FAILED:', e.message);
  process.exit(e.message.includes('waitForFunction') || e.message.includes('Waiting failed') ? 1 : 2);
});
