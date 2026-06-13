// Measure the rendered widths of the growth card's four stacked elements.
import puppeteer from 'puppeteer';

const browser = await puppeteer.launch({ headless: 'new' });
const page = await browser.newPage();
page.on('console', (m) => { if (['error', 'warning'].includes(m.type())) console.log('[page]', m.type(), m.text().slice(0, 300)); });
page.on('pageerror', (e) => console.log('[pageerror]', String(e).slice(0, 500)));
await page.setViewport({ width: 1280, height: 900 });
// Seed two snapshots so ProjectionTab renders even before live quotes land
await page.evaluateOnNewDocument(() => {
  localStorage.setItem('nwTracker.snapshots', JSON.stringify([
    { d: '2026-03-01', nw: 1700000, assets: 2400000, invested: 1550000 },
    { d: '2026-06-12', nw: 1867826, assets: 2595101, invested: 1688027 },
  ]));
});
await page.goto('http://localhost:3000', { waitUntil: 'networkidle0', timeout: 90000 }).catch(() => {});
try {
  await page.waitForSelector('.pjx-gcards', { timeout: 90000 });
} catch (e) {
  await page.screenshot({ path: 'scripts/measure-fail.png', fullPage: true });
  console.log('gcards never appeared — screenshot at scripts/measure-fail.png');
  await browser.close();
  process.exit(1);
}

// return plain numbers — DOMRect props live on the prototype and don't
// survive Puppeteer's JSON serialization of the evaluate result
const atRest = await page.evaluate(() => {
  const w = (sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r ? { left: r.left, right: r.right, width: r.width } : null;
  };
  return { gcards: w('.pjx-gcards'), foot: w('.pjx-foot'), card: w('.pjx') };
});

// scrub to year 5 so sctabs + sentence render
await page.evaluate(() => {
  const r = document.querySelector('.pjx input[type="range"]');
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  setter.call(r, 5);
  r.dispatchEvent(new Event('input', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 600));

const scrub = await page.evaluate(() => {
  const w = (sel) => {
    const r = document.querySelector(sel)?.getBoundingClientRect();
    return r ? { left: r.left, right: r.right, width: r.width } : null;
  };
  return { sctabs: w('.pjx-sctabs'), sentence: w('.pjx-sentence'), foot: w('.pjx-foot') };
});

const fmt = (r) => r ? `left=${r.left.toFixed(1)} right=${r.right.toFixed(1)} width=${r.width.toFixed(1)}` : 'NOT FOUND';
console.log('card      ', fmt(atRest.card));
console.log('gcards    ', fmt(atRest.gcards));
console.log('foot@rest ', fmt(atRest.foot));
console.log('sctabs    ', fmt(scrub.sctabs));
console.log('sentence  ', fmt(scrub.sentence));
console.log('foot@scrub', fmt(scrub.foot));
await browser.close();
