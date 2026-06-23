// Responsive QA audit harness (Phase 1 — AUDIT ONLY, no app code touched).
// Drives puppeteer across surfaces × themes × breakpoints, captures full-page
// screenshots into ./screens/<theme>/<surface>/, and runs an in-page overflow /
// clipping detector. Emits report.json (+ a console summary). Read-only on the app.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const SCREENS = path.join(DIR, 'screens');
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// 7 tabs + the macro tab's US region variant (different layout via .no-fii).
const SURFACES = [
  { id: 'overview', hash: 'overview', btn: '.hdr-hero' },
  { id: 'indian',   hash: 'indian',   btn: '.hdr-card.hc-indian' },
  { id: 'fd',       hash: 'fd',       btn: '.hdr-card.hc-fd' },
  { id: 'mf',       hash: 'mf',       btn: '.hdr-card.hc-mf' },
  { id: 'us',       hash: 'us',       btn: '.hdr-card.hc-us' },
  { id: 'algo',     hash: 'algo',     btn: '.hdr-card.hc-algo' },
  { id: 'macro-in', hash: 'macro',    btn: '.pulse-pill', region: 'india' },
  { id: 'macro-us', hash: 'macro',    btn: '.pulse-pill', region: 'us' },
];

const BREAKPOINTS = [
  { label: '0768x1024-tablet', w: 768,  h: 1024, group: 'tablet' },
  { label: '0820x1180-tablet', w: 820,  h: 1180, group: 'tablet' },
  { label: '1024x0768-tablet', w: 1024, h: 768,  group: 'tablet' },
  { label: '1280x0720-desktop', w: 1280, h: 720, group: 'desktop' },
  { label: '1366x0768-desktop', w: 1366, h: 768, group: 'desktop' },
  { label: '1440x0900-desktop', w: 1440, h: 900, group: 'desktop' },
  { label: '1536x0864-desktop', w: 1536, h: 864, group: 'desktop' },
  { label: '1728x1117-wide', w: 1728, h: 1117, group: 'wide' },
  { label: '1920x1080-wide', w: 1920, h: 1080, group: 'wide' },
  { label: '2560x1440-wide', w: 2560, h: 1440, group: 'wide' },
  { label: '3440x1440-wide', w: 3440, h: 1440, group: 'wide' },
];

const THEMES = ['night', 'day'];

// In-page detector: horizontal overflow (the headline signal) + per-element
// offenders escaping the viewport or clipping their own content.
function auditPage() {
  const vw = window.innerWidth;
  const de = document.documentElement;
  const docScrollW = Math.max(de.scrollWidth, document.body ? document.body.scrollWidth : 0);
  const docOverflow = docScrollW - vw;
  const offenders = [];
  const nodes = document.querySelectorAll('body *');
  for (const el of nodes) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const overRight = Math.round(rect.right - vw);
    const overLeft = Math.round(-rect.left);
    const sx = cs.overflowX, scrollableX = sx === 'auto' || sx === 'scroll';
    const contentOverflowX = scrollableX ? 0 : Math.round(el.scrollWidth - el.clientWidth);
    const sy = cs.overflowY, clipsY = sy === 'hidden';
    const contentClipY = clipsY ? Math.round(el.scrollHeight - el.clientHeight) : 0;
    if (overRight > 2 || overLeft > 2 || contentOverflowX > 2) {
      let cls = '';
      if (typeof el.className === 'string' && el.className.trim()) cls = '.' + el.className.trim().split(/\s+/).slice(0, 3).join('.');
      offenders.push({
        sel: el.tagName.toLowerCase() + cls,
        overRight: overRight > 2 ? overRight : 0,
        overLeft: overLeft > 2 ? overLeft : 0,
        contentOverflowX: contentOverflowX > 2 ? contentOverflowX : 0,
        clipY: contentClipY > 2 ? contentClipY : 0,
        w: Math.round(rect.width),
        pos: cs.position,
      });
    }
  }
  // rank: viewport-escapers first, then content overflow, biggest first
  offenders.sort((a, b) => (b.overRight + b.overLeft + b.contentOverflowX) - (a.overRight + a.overLeft + a.contentOverflowX));
  return { vw, docScrollW, docOverflow, hasHScroll: docOverflow > 1, bodyScrollH: document.body ? document.body.scrollHeight : 0, offenderCount: offenders.length, offenders: offenders.slice(0, 25) };
}

async function setEnv(page, theme, region) {
  await page.evaluate((t, r) => {
    try {
      localStorage.setItem('nwTracker.theme', t);
      if (r) localStorage.setItem('nwTracker.wrapRegion', r);
      document.documentElement.dataset.time = t;
    } catch (e) {}
  }, theme, region || null);
}

async function gotoSurface(page, surface, theme) {
  // ensure theme + region are in localStorage before the app boots, then load the tab
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await setEnv(page, theme, surface.region);
  await page.goto(`${BASE}/#${surface.hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  // force-set theme again post-nav (in case the app's effect re-applied), then click the tab button as a fallback
  await page.evaluate((t) => { try { document.documentElement.dataset.time = t; } catch (e) {} }, theme);
  await page.$eval(surface.btn, (e) => e.click()).catch(() => {});
  await sleep(1900);
}

async function run() {
  fs.mkdirSync(SCREENS, { recursive: true });
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  await page.setDefaultNavigationTimeout(30000);
  const results = [];
  let shots = 0;

  for (const theme of THEMES) {
    for (const surface of SURFACES) {
      await gotoSurface(page, surface, theme);
      for (const bp of BREAKPOINTS) {
        try {
          await page.setViewport({ width: bp.w, height: bp.h, deviceScaleFactor: 1 });
          await sleep(450); // let responsive reflow + ResizeObserver charts settle
          const audit = await page.evaluate(auditPage);
          const outDir = path.join(SCREENS, theme, surface.id);
          fs.mkdirSync(outDir, { recursive: true });
          const file = path.join(outDir, bp.label + '.jpg');
          await page.screenshot({ path: file, type: 'jpeg', quality: 70, fullPage: true });
          shots++;
          results.push({ theme, surface: surface.id, region: surface.region || null, breakpoint: bp.label, group: bp.group, w: bp.w, h: bp.h, screenshot: path.relative(DIR, file).replace(/\\/g, '/'), ...audit });
          process.stdout.write(`${theme}/${surface.id} @ ${bp.label}  hScroll=${audit.hasHScroll ? 'YES +' + audit.docOverflow : 'no'}  offenders=${audit.offenderCount}\n`);
        } catch (e) {
          results.push({ theme, surface: surface.id, breakpoint: bp.label, error: String(e && e.message || e) });
          process.stdout.write(`ERR ${theme}/${surface.id} @ ${bp.label}: ${e && e.message}\n`);
        }
      }
    }
  }

  // ---- Zoom stress (browser-zoom reflow approximation via documentElement.zoom) ----
  const zoomResults = [];
  for (const surfId of ['overview', 'indian', 'macro-in']) {
    const surface = SURFACES.find((s) => s.id === surfId);
    await gotoSurface(page, surface, 'night');
    await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await sleep(500);
    for (const z of [1.25, 1.5, 2]) {
      await page.evaluate((zz) => { document.documentElement.style.zoom = String(zz); }, z);
      await sleep(450);
      const audit = await page.evaluate(auditPage);
      const outDir = path.join(SCREENS, 'zoom');
      fs.mkdirSync(outDir, { recursive: true });
      const file = path.join(outDir, `${surfId}__zoom${Math.round(z * 100)}.jpg`);
      await page.screenshot({ path: file, type: 'jpeg', quality: 70, fullPage: true });
      shots++;
      zoomResults.push({ surface: surfId, zoom: z, screenshot: path.relative(DIR, file).replace(/\\/g, '/'), ...audit });
      process.stdout.write(`zoom ${surfId} @ ${z * 100}%  hScroll=${audit.hasHScroll ? 'YES +' + audit.docOverflow : 'no'}  offenders=${audit.offenderCount}\n`);
      await page.evaluate(() => { document.documentElement.style.zoom = '1'; });
    }
  }

  // ---- Content stress: inject a long unbreakable label + a huge value, measure overflow ----
  const stressResults = [];
  const LONG = 'THIS_IS_AN_EXTREMELY_LONG_LABEL_USED_FOR_RESPONSIVE_STRESS_TESTING';
  const BIG = '₹999,99,99,99,999.99';
  for (const surfId of ['overview', 'indian', 'us', 'macro-in']) {
    const surface = SURFACES.find((s) => s.id === surfId);
    await gotoSurface(page, surface, 'night');
    await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 1 });
    await sleep(500);
    const before = await page.evaluate(auditPage);
    const injected = await page.evaluate((long, big) => {
      const out = { labels: 0, values: 0 };
      // inject a long token into representative label-ish nodes
      document.querySelectorAll('.lbl, .seg-lbl, .ncard .nh, .ecal-t, .csm .lbl, th, .qh').forEach((el, i) => {
        if (i % 3 === 0 && el.childElementCount === 0) { el.textContent = long; out.labels++; }
      });
      // inject a huge number into value-ish nodes
      document.querySelectorAll('.vmd, .vlg, .vsm, .lv, td').forEach((el, i) => {
        if (i % 4 === 0 && el.childElementCount === 0) { el.textContent = big; out.values++; }
      });
      return out;
    }, LONG, BIG);
    await sleep(350);
    const after = await page.evaluate(auditPage);
    const outDir = path.join(SCREENS, 'stress');
    fs.mkdirSync(outDir, { recursive: true });
    const file = path.join(outDir, `${surfId}__longlabel-bigvalue.jpg`);
    await page.screenshot({ path: file, type: 'jpeg', quality: 70, fullPage: true });
    shots++;
    stressResults.push({ surface: surfId, injected, before: { hasHScroll: before.hasHScroll, docOverflow: before.docOverflow }, after: { hasHScroll: after.hasHScroll, docOverflow: after.docOverflow, offenderCount: after.offenderCount, offenders: after.offenders.slice(0, 15) }, screenshot: path.relative(DIR, file).replace(/\\/g, '/') });
    process.stdout.write(`stress ${surfId}  before hScroll=${before.hasHScroll}  after hScroll=${after.hasHScroll ? 'YES +' + after.docOverflow : 'no'}\n`);
  }

  await browser.close();

  // ---- Summary roll-up ----
  const matrix = results.filter((r) => !r.error);
  const byBpGroup = {};
  for (const r of matrix) {
    const g = r.group;
    byBpGroup[g] = byBpGroup[g] || { total: 0, hScroll: 0 };
    byBpGroup[g].total++;
    if (r.hasHScroll) byBpGroup[g].hScroll++;
  }
  const hScrollHits = matrix.filter((r) => r.hasHScroll)
    .map((r) => ({ theme: r.theme, surface: r.surface, breakpoint: r.breakpoint, docOverflow: r.docOverflow, topOffender: r.offenders && r.offenders[0] }));

  const report = {
    generatedFor: 'portfolio-tracker responsive QA — Phase 1 audit',
    base: BASE,
    note: 'Single-page Next.js app, 7 hash tabs + macro US-region variant. Custom CSS (no Tailwind). No modals/dialogs. Local data: committed JSON + live public market APIs; /api/snapshots (NW history) is 503 locally so the projection history renders its empty/fallback state.',
    counts: { surfaces: SURFACES.length, themes: THEMES.length, breakpoints: BREAKPOINTS.length, matrixCells: matrix.length, screenshots: shots },
    horizontalScrollByGroup: byBpGroup,
    horizontalScrollHits: hScrollHits,
    matrix: results,
    zoom: zoomResults,
    stress: stressResults,
  };
  fs.writeFileSync(path.join(DIR, 'report.json'), JSON.stringify(report, null, 2));
  process.stdout.write(`\nDONE. ${shots} screenshots. matrix cells=${matrix.length}. hScroll hits=${hScrollHits.length}.\n`);
  process.stdout.write(`hScroll by group: ${JSON.stringify(byBpGroup)}\n`);
}

run().catch((e) => { console.error('FATAL', e); process.exit(1); });
