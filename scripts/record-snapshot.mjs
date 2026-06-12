// Daily net-worth snapshot → data/SNAPSHOT.md (committed, permanent).
//
// Boots the app headlessly and lets IT compute net worth with its own live
// math (quotes, FX, NAV, FD accrual, CMPF, loan) — the page records its daily
// snapshot to localStorage exactly as it does for a human visit; we harvest
// that entry and upsert it as a SNAPSHOT.md row. Zero duplicated formulas.
//
// Usage: node scripts/record-snapshot.mjs   (run after market close ideally)
// Exit codes: 0 ok · 1 snapshot not produced (quotes missing?) · 2 infra

import { spawn } from 'child_process';
import { readFileSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import path from 'path';
import puppeteer from 'puppeteer';

const ROOT = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const MD = path.join(ROOT, 'data', 'SNAPSHOT.md');
const PORT = 3217;

const log = (m) => console.log(`[snapshot] ${m}`);

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
  } finally {
    await browser.close();
    kill();
  }
}

main().then(() => process.exit(0)).catch((e) => {
  console.error('[snapshot] FAILED:', e.message);
  process.exit(e.message.includes('waitForFunction') || e.message.includes('Waiting failed') ? 1 : 2);
});
