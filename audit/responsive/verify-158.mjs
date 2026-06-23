// Verification 1: isolate the Phase-1 +158px @1280. Reproduces the EXACT Phase-1
// injection targeting (audit.mjs), then measures document overflow + the single
// widest element escaping the viewport that is NOT inside an overflow-x scroll
// ancestor, with the .ovx overflow-ownership fix ON vs NEUTRALIZED. Output only.
import puppeteer from 'puppeteer';
const BASE = 'http://localhost:3000';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// EXACT Phase-1 audit.mjs stress injection (token into labels/headings/th, big value into td/values)
function inject1() {
  const LONG = 'THIS_IS_AN_EXTREMELY_LONG_LABEL_USED_FOR_RESPONSIVE_STRESS_TESTING';
  const BIG = '₹999,99,99,99,999.99';
  let labels = 0, values = 0;
  document.querySelectorAll('.lbl, .seg-lbl, .ncard .nh, .ecal-t, .csm .lbl, th, .qh').forEach((el, i) => {
    if (i % 3 === 0 && el.childElementCount === 0) { el.textContent = LONG; labels++; }
  });
  document.querySelectorAll('.vmd, .vlg, .vsm, .lv, td').forEach((el, i) => {
    if (i % 4 === 0 && el.childElementCount === 0) { el.textContent = BIG; values++; }
  });
  return { labels, values };
}
function measure() {
  const vw = innerWidth, de = document.documentElement;
  const docOverflow = Math.max(de.scrollWidth, document.body.scrollWidth) - vw;
  const inScrollX = (el) => { let p = el.parentElement; while (p && p !== document.body) { const cs = getComputedStyle(p); if ((cs.overflowX === 'auto' || cs.overflowX === 'scroll') && p.scrollWidth > p.clientWidth + 1) return true; p = p.parentElement; } return false; };
  let worst = null;
  for (const el of document.querySelectorAll('body *')) {
    if (el.closest('.tkw')) continue;
    const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    const r = el.getBoundingClientRect(); if (r.width < 1) continue;
    const over = Math.round(r.right - vw);
    if (over > 2 && !inScrollX(el)) {
      if (!worst || over > worst.over) {
        const cls = (typeof el.className === 'string' ? el.className : '');
        worst = { over, sel: el.tagName.toLowerCase() + (cls.trim() ? '.' + cls.trim().split(/\s+/).slice(0, 3).join('.') : ''), insideOvx: !!el.closest('.ovx') };
      }
    }
  }
  return { docOverflow, worst };
}

async function run() {
  const b = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
  const p = await b.newPage();
  for (const theme of ['night', 'day']) {
    for (const w of [1280, 1440]) {
      for (const mode of ['ovx-fix-ON', 'ovx-fix-NEUTRALIZED']) {
        await p.goto(BASE + '/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await p.evaluate((t) => { localStorage.setItem('nwTracker.theme', t); document.documentElement.dataset.time = t; }, theme);
        await p.goto(BASE + '/#indian', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
        await p.$eval('.hdr-card.hc-indian', (e) => e.click()).catch(() => {});
        await sleep(1700);
        await p.setViewport({ width: w, height: 900 });
        // NEUTRALIZED restores the original .ovx (drops max-width:100%/min-width:0 that Phase-2 added)
        if (mode === 'ovx-fix-NEUTRALIZED') await p.addStyleTag({ content: '.ovx{max-width:none !important; min-width:auto !important}' }).catch(() => {});
        await sleep(300);
        const inj = await p.evaluate(inject1);
        await sleep(350);
        const m = await p.evaluate(measure);
        console.log(`${theme} @${w} ${mode.padEnd(22)} DOC+${String(m.docOverflow).padStart(4)}  worstEscaper=${m.worst ? `${m.worst.sel}(+${m.worst.over}, insideOvx=${m.worst.insideOvx})` : 'NONE'}  injected{labels:${inj.labels},vals:${inj.values}}`);
      }
    }
  }
  await b.close();
}
run().catch((e) => { console.error('FATAL', e); process.exit(1); });
