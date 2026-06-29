// Responsive screenshot harness — viewport PNGs across all 8 surfaces × {night,day}
// at every certify width. REUSES certify.mjs's surface list + gotoSurface/setEnv logic
// (theme + wrap-region via localStorage) so a shot lands on EXACTLY the same DOM the
// certify gate measures. Screenshots only — no measurement; pair with certify.mjs.
//
// Output:  audit/responsive/shots/<label>/<theme>-<surface>-<width>.png
//
// Env / args:
//   LABEL=<name>  or  argv[2]   output subdir under shots/ (default: before)
//   WIDTHS=768,1024,1280,1440,1920,2560   (default — the 6 certify widths)
//   SURFACES=overview,indian,...           (default: all 8)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.CERT_BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// — identical to certify.mjs (same 8 surfaces, same buttons/regions) —
const ALL_SURFACES = [
  { id: 'overview', hash: 'overview', btn: '.hdr-hero' },
  { id: 'indian',   hash: 'indian',   btn: '.hdr-card.hc-indian' },
  { id: 'fd',       hash: 'fd',       btn: '.hdr-card.hc-fd' },
  { id: 'mf',       hash: 'mf',       btn: '.hdr-card.hc-mf' },
  { id: 'us',       hash: 'us',       btn: '.hdr-card.hc-us' },
  { id: 'algo',     hash: 'algo',     btn: '.hdr-card.hc-algo' },
  { id: 'macro-in', hash: 'macro',    btn: '.pulse-pill', region: 'india' },
  { id: 'macro-us', hash: 'macro',    btn: '.pulse-pill', region: 'us' },
];

const LABEL = process.env.LABEL || process.argv[2] || 'before';
const WIDTHS = (process.env.WIDTHS || '768,1024,1280,1440,1920,2560').split(',').map(Number);
const SURF_FILTER = process.env.SURFACES ? process.env.SURFACES.split(',') : null;
const SURFACES = SURF_FILTER ? ALL_SURFACES.filter((s) => SURF_FILTER.includes(s.id)) : ALL_SURFACES;
const THEMES = ['night', 'day'];

// — identical to certify.mjs —
async function setEnv(page, theme, region) {
  await page.evaluate((t, r, sub, pv) => {
    try { localStorage.setItem('nwTracker.theme', t); if (r) localStorage.setItem('nwTracker.wrapRegion', r); if (sub) localStorage.setItem('nwTracker.algoSub', sub); if (pv) localStorage.setItem('nwTracker.pnlView', pv); document.documentElement.dataset.time = t; } catch (e) {}
  }, theme, region || null, process.env.ALGOSUB || null, process.env.PNLVIEW || null);
}
async function gotoSurface(page, surface, theme) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await setEnv(page, theme, surface.region);
  await page.goto(`${BASE}/#${surface.hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.evaluate((t) => { try { document.documentElement.dataset.time = t; } catch (e) {} }, theme);
  await page.$eval(surface.btn, (e) => e.click()).catch(() => {});
  await sleep(1700);
}

async function run() {
  const outDir = path.join(DIR, 'shots', LABEL);
  fs.mkdirSync(outDir, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  let shot = 0;
  for (const theme of THEMES) {
    for (const surface of SURFACES) {
      await gotoSurface(page, surface, theme);
      for (const w of WIDTHS) {
        await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
        await sleep(500);
        const file = path.join(outDir, `${theme}-${surface.id}-${w}.png`);
        await page.screenshot({ path: file, type: 'png' }); // viewport only (fullPage:false)
        shot++;
        process.stdout.write(`${theme}/${surface.id} @${w}  -> shots/${LABEL}/${theme}-${surface.id}-${w}.png\n`);
      }
    }
  }
  await browser.close();
  process.stdout.write(`\n[${LABEL}] wrote ${shot} screenshots to ${path.relative(process.cwd(), outDir)}\n`);
}
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
