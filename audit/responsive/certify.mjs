// Phase 2 certification harness — measurement-only (no screenshots), fast, re-runnable.
// Distinguishes CLIPPED offenders (real bugs, escape with no scrollable ancestor) from
// SCROLLABLE offenders (inside an overflow-x:auto/scroll ancestor — acceptable for the
// header strip + tables). Tags each by RSP id. Supports stress injection, vertical-clip,
// and mask-off modes. Excludes the macro ticker marquee (intentional off-screen scroll).
//
// Env flags:
//   LABEL=<name>     output → cert-<name>.json
//   WIDTHS=768,1024,1280,1440,1920,2560   (default)
//   SURFACES=overview,indian,...           (default: all 8)
//   STRESS=1         inject long names + 7-figure values before measuring
//   VCLIP=1          also run the bounded vertical-clip check
//   MASKOFF=1        inject html{overflow-x:visible} to test mask removal
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const DIR = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.CERT_BASE || 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

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

const LABEL = process.env.LABEL || 'run';
const WIDTHS = (process.env.WIDTHS || '768,1024,1280,1440,1920,2560').split(',').map(Number);
const SURF_FILTER = process.env.SURFACES ? process.env.SURFACES.split(',') : null;
const SURFACES = SURF_FILTER ? ALL_SURFACES.filter((s) => SURF_FILTER.includes(s.id)) : ALL_SURFACES;
const STRESSHARD = process.env.STRESSHARD === '1';  // unbreakable no-space token (pathological)
const STRESS = process.env.STRESS === '1' || STRESSHARD;
const VCLIP = process.env.VCLIP === '1';
const MASKOFF = process.env.MASKOFF === '1';
const AFFORD = process.env.AFFORD === '1';  // header edge-fade state-machine assertions
const THEMES = ['night', 'day'];

// in-page detector (serialized to the browser)
function detect(opts) {
  const EXCLUDE = /(^|\s)(tkw|tkv|tkrow|tki|tdot)(\s|$)/; // ticker marquee — intentional off-screen scroll
  const vw = window.innerWidth;
  const de = document.documentElement;
  const docScrollW = Math.max(de.scrollWidth, document.body.scrollWidth);
  const docOverflow = docScrollW - vw;
  const clsOf = (el) => (typeof el.className === 'string' ? el.className : (el.getAttribute && el.getAttribute('class')) || '');
  const rspOf = (el, sel) => {
    if (/\bhdr-cards\b|\bhdr-card\b|\bhdr-hero\b/.test(sel)) return 'RSP-001';
    const tag = el.tagName.toLowerCase();
    if (/\bovx\b|\btbl\b/.test(sel) || ['table', 'thead', 'tbody', 'tr', 'td', 'th'].includes(tag)) return 'RSP-002';
    // exact class membership — NOT a substring (the substring form mis-tagged
    // .page-header-lbl, the net-worth hero label, as a summary card via "lbl").
    if (['vmd', 'lbl', 'sub', 'rs', 'live-dot', 'csm', 'vlg', 'vsm'].some((k) => el.classList && el.classList.contains(k))) return 'RSP-004';
    return 'other';
  };
  const inScrollX = (el) => {
    let p = el.parentElement;
    while (p && p !== document.body && p !== de) {
      const cs = getComputedStyle(p);
      if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true;
      p = p.parentElement;
    }
    return false;
  };
  const clipped = [], scrollable = [], ellipsis = [];
  for (const el of document.querySelectorAll('body *')) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const cls = clsOf(el);
    if (EXCLUDE.test(' ' + cls + ' ') || el.closest('.tkw')) continue; // ticker + descendants
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) continue;
    const overRight = Math.round(rect.right - vw);
    const overLeft = Math.round(-rect.left);
    const selfScrollX = cs.overflowX === 'auto' || cs.overflowX === 'scroll';
    const contentX = selfScrollX ? 0 : Math.round(el.scrollWidth - el.clientWidth);
    const escapes = overRight > 2 || overLeft > 2;  // box pushes past viewport / negative-left — a REAL layout overflow
    if (escapes || contentX > 2) {
      const sel = el.tagName.toLowerCase() + (cls.trim() ? '.' + cls.trim().split(/\s+/).slice(0, 3).join('.') : '');
      const rec = { sel, overRight: overRight > 2 ? overRight : 0, overLeft: overLeft > 2 ? overLeft : 0, contentX: contentX > 2 ? contentX : 0, rsp: rspOf(el, sel) };
      // Ellipsis refinement: an element whose ONLY offence is contentX>2 AND whose computed
      // style is a single-line ellipsis truncation (white-space:nowrap + text-overflow:ellipsis
      // + overflow[-x]:hidden) is INTENTIONAL truncation, not a layout clip — scrollWidth always
      // exceeds clientWidth once text is ellipsised, so counting it as RSP-004 would permanently
      // red-flag every truncated footer (e.g. .csm .sub). Route it to the 'ellipsis' bucket
      // (counted + printed, like 'scrollable') and EXCLUDE from the clipped/RSP-004 count.
      // Escapes (overRight/overLeft) and docOverflow are UNCHANGED — a real escape still fails,
      // even on an ellipsis element (escapes wins, so it lands in clipped).
      const isEllipsis = cs.whiteSpace === 'nowrap' && cs.textOverflow === 'ellipsis'
        && (cs.overflow === 'hidden' || cs.overflowX === 'hidden');
      if (!escapes && isEllipsis) ellipsis.push(rec);
      else (inScrollX(el) ? scrollable : clipped).push(rec);
    }
  }
  const byRsp = (arr) => arr.reduce((a, r) => { a[r.rsp] = (a[r.rsp] || 0) + 1; return a; }, {});
  const out = {
    vw, docOverflow,
    clippedCount: clipped.length, scrollableCount: scrollable.length, ellipsisCount: ellipsis.length,
    clippedByRsp: byRsp(clipped), scrollableByRsp: byRsp(scrollable), ellipsisByRsp: byRsp(ellipsis),
    topClipped: clipped.sort((a, b) => (b.overRight + b.overLeft + b.contentX) - (a.overRight + a.overLeft + a.contentX)).slice(0, 10),
    topEllipsis: ellipsis.sort((a, b) => b.contentX - a.contentX).slice(0, 10),
  };
  if (opts && opts.vclip) {
    const vclip = []; let checked = 0;
    for (const el of document.querySelectorAll('body *')) {
      const cs = getComputedStyle(el);
      if (cs.overflowY !== 'hidden' && cs.overflow !== 'hidden') continue;
      const cls = clsOf(el);
      if (EXCLUDE.test(' ' + cls + ' ') || el.closest('.tkw')) continue;
      // only flag elements whose height is actually constrained (fixed/max), not auto content
      const constrained = (cs.height !== 'auto') || (cs.maxHeight !== 'none');
      if (!constrained) continue;
      checked++;
      const overY = el.scrollHeight - el.clientHeight;
      if (overY > 3) {
        const sel = el.tagName.toLowerCase() + (cls.trim() ? '.' + cls.trim().split(/\s+/).slice(0, 2).join('.') : '');
        vclip.push({ sel, overY: Math.round(overY), h: Math.round(el.getBoundingClientRect().height) });
      }
    }
    out.vclipChecked = checked;        // # of constrained overflow:hidden elements actually measured
    out.vclip = vclip.sort((a, b) => b.overY - a.overY).slice(0, 25);
    // explicit probe of every SVG chart (the 6 hand-rolled charts are <svg>) — proves
    // they were measured at this width and pass (overY<=0 = no vertical clip)
    out.svgProbe = [...document.querySelectorAll('svg')].filter((s) => !s.closest('.tkw')).map((s) => {
      const c = s.getAttribute('class') || ''; const r = s.getBoundingClientRect();
      return { sel: 'svg' + (c ? '.' + c.trim().split(/\s+/)[0] : ''), h: Math.round(r.height), overY: Math.round(s.scrollHeight - s.clientHeight) };
    });
    out.svgMaxOverY = Math.max(0, ...out.svgProbe.map((x) => x.overY));
  }
  return out;
}

function injectStress(hard) {
  // LOAD-BEARING ASSUMPTION: the default (CI) stress injects REALISTIC spaced content —
  // company names with spaces + formatted ₹ values, which wrap. It does NOT, by default,
  // test unbreakable NO-SPACE tokens. That pathological case (the Phase-1 +158 artifact)
  // is exercised ONLY under STRESSHARD and is NOT part of default/CI coverage. A genuinely
  // long no-space identifier in real data would re-test table resilience and is currently
  // outside the default harness coverage — run STRESSHARD=1 to cover it.
  //
  // Inject into the places that actually hold DYNAMIC text — table cells, movers /
  // sector lists, news headlines, calendar titles, and value cells. NOT static card
  // labels (.lbl is a fixed string like "INDIAN EQUITY"). hard=unbreakable token.
  const NAME = hard
    ? 'THIS_IS_AN_EXTREMELY_LONG_UNBREAKABLE_HOLDING_NAME_WITH_NO_SPACES_FOR_STRESS_TESTING'
    : 'Cholamandalam Investment & Finance Company Limited';
  const VAL = hard ? '₹99,99,99,99,999.99' : '₹1,23,45,678';
  let names = 0, vals = 0;
  document.querySelectorAll('td:first-child, .no-mover-name, .no-sector-name, .ncard .nh, .ecal-t').forEach((el) => {
    if (el.childElementCount === 0) { el.textContent = NAME; names++; }
  });
  document.querySelectorAll('.vmd, .vlg, .vsm, .lv, td.ra, td.mono').forEach((el) => {
    if (el.childElementCount === 0) { el.textContent = VAL; vals++; }
  });
  return { names, vals, hard: !!hard };
}

async function setEnv(page, theme, region) {
  await page.evaluate((t, r) => {
    try { localStorage.setItem('nwTracker.theme', t); if (r) localStorage.setItem('nwTracker.wrapRegion', r); document.documentElement.dataset.time = t; } catch (e) {}
  }, theme, region || null);
}
async function gotoSurface(page, surface, theme) {
  await page.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await setEnv(page, theme, surface.region);
  await page.goto(`${BASE}/#${surface.hash}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  await page.evaluate((t) => { try { document.documentElement.dataset.time = t; } catch (e) {} }, theme);
  await page.$eval(surface.btn, (e) => e.click()).catch(() => {});
  await sleep(1700);
  if (MASKOFF) await page.addStyleTag({ content: 'html{overflow-x:visible !important}' }).catch(() => {});
}

// AFFORD: assert the header edge-fade state machine against scroll position, at a
// tablet width (overflowing) and desktop/wide widths (fits), both themes.
async function affordRun(page) {
  const surface = ALL_SURFACES.find((s) => s.id === 'overview');
  const rows = [];
  for (const theme of THEMES) {
    for (const w of [768, 1440, 1920]) {
      await gotoSurface(page, surface, theme);
      await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
      await sleep(600);
      const r = await page.evaluate(async () => {
        const strip = document.querySelector('.hdr-cards');
        const wrap = document.querySelector('.hdr-cards-wrap');
        const nap = (ms) => new Promise((res) => setTimeout(res, ms));
        const read = () => ({ l: wrap.classList.contains('edge-l'), r: wrap.classList.contains('edge-r') });
        const scrollable = strip.scrollWidth - strip.clientWidth;
        const set = async (sl) => { strip.scrollLeft = sl; await nap(280); return read(); };  // real scroll event → React onScroll → class update
        return { scrollable, start: await set(0), mid: await set(Math.round(scrollable / 2)), end: await set(scrollable) };
      });
      rows.push({ theme, w, ...r });
    }
  }
  console.log('AFFORDANCE STATE-MACHINE ASSERTIONS — overview header strip (edge-l/edge-r vs scroll state)\n');
  let allPass = true;
  for (const x of rows) {
    const fits = x.scrollable <= 2;
    const exp = fits
      ? { start: { l: false, r: false }, mid: { l: false, r: false }, end: { l: false, r: false } }
      : { start: { l: false, r: true }, mid: { l: true, r: true }, end: { l: true, r: false } };
    const eq = (a, e) => a.l === e.l && a.r === e.r;
    const pass = eq(x.start, exp.start) && eq(x.mid, exp.mid) && eq(x.end, exp.end);
    if (!pass) allPass = false;
    const f = (s) => `{l:${s.l ? 1 : 0},r:${s.r ? 1 : 0}}`;
    console.log(`  ${x.theme.padEnd(5)} @${x.w} ${(fits ? 'FITS' : 'OVERFLOWS').padEnd(9)} scrollable=${String(x.scrollable).padStart(4)}  actual start=${f(x.start)} mid=${f(x.mid)} end=${f(x.end)}   expected start=${f(exp.start)} mid=${f(exp.mid)} end=${f(exp.end)}   => ${pass ? 'PASS' : '*** FAIL ***'}`);
  }
  console.log(`\nAFFORDANCE: ${allPass ? 'ALL PASS' : '*** FAIL ***'}`);
}

async function run() {
  const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const page = await browser.newPage();
  if (AFFORD) { await affordRun(page); await browser.close(); return; }
  const cells = [];
  for (const theme of THEMES) {
    for (const surface of SURFACES) {
      await gotoSurface(page, surface, theme);
      let injected = null;
      for (const w of WIDTHS) {
        await page.setViewport({ width: w, height: 900, deviceScaleFactor: 1 });
        await sleep(420);
        if (STRESS && injected === null) { injected = await page.evaluate(injectStress, STRESSHARD); await sleep(300); }
        const m = await page.evaluate(detect, { vclip: VCLIP });
        cells.push({ theme, surface: surface.id, w, stress: STRESS, injected, ...m });
        const cb = m.clippedByRsp, dot = m.docOverflow > 1 ? `DOC+${m.docOverflow}` : 'doc0';
        process.stdout.write(`${theme}/${surface.id} @${w}  ${dot}  clipped=${m.clippedCount}{001:${cb['RSP-001']||0},002:${cb['RSP-002']||0},004:${cb['RSP-004']||0},other:${cb.other||0}}  scrollOK=${m.scrollableCount}  ellipsis=${m.ellipsisCount}\n`);
      }
    }
  }
  await browser.close();

  // roll-up: per-RSP worst clipped + max docOverflow across the run
  const roll = { 'RSP-001': { maxClipped: 0, cells: 0 }, 'RSP-002': { maxClipped: 0, cells: 0 }, 'RSP-004': { maxClipped: 0, cells: 0 }, other: { maxClipped: 0 } };
  let maxDoc = 0, docHits = 0, ellipsisCells = 0, maxEllipsis = 0;
  for (const c of cells) {
    if (c.docOverflow > 1) { docHits++; maxDoc = Math.max(maxDoc, c.docOverflow); }
    if (c.ellipsisCount > 0) { ellipsisCells++; maxEllipsis = Math.max(maxEllipsis, c.ellipsisCount); }
    for (const k of ['RSP-001', 'RSP-002', 'RSP-004', 'other']) {
      const n = (c.clippedByRsp || {})[k] || 0;
      if (n > 0) { roll[k].maxClipped = Math.max(roll[k].maxClipped, n); if (roll[k].cells != null) roll[k].cells++; }
    }
  }
  const summary = { label: LABEL, stress: STRESS, maskoff: MASKOFF, widths: WIDTHS, surfaces: SURFACES.map((s) => s.id), docOverflowCells: docHits, maxDocOverflow: maxDoc, ellipsisCells, maxEllipsis, perRsp: roll };
  fs.writeFileSync(path.join(DIR, `cert-${LABEL}.json`), JSON.stringify({ summary, cells }, null, 2));
  process.stdout.write(`\n[${LABEL}] docOverflow cells=${docHits} maxDoc=${maxDoc}  clippedMax 001=${roll['RSP-001'].maxClipped} 002=${roll['RSP-002'].maxClipped} 004=${roll['RSP-004'].maxClipped} other=${roll.other.maxClipped}  ellipsis cells=${ellipsisCells} max=${maxEllipsis}\n`);
}
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
