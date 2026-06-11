// Capture every tab as a full-page screenshot + self-contained styled HTML.
// Usage: npx next start -p 3219 &  then  node scripts/snapshot-tabs.js
// Output: /tmp/snapshots/<tab>-<theme>.{png,html}
const puppeteer = require('puppeteer');
const fs = require('fs');
const BASE = 'http://localhost:3219';
const TABS = ['overview', 'indian', 'fd', 'mf', 'us', 'algo'];

(async () => {
  const browser = await puppeteer.launch({ args: ['--no-sandbox'] });
  // cache CSS once for inlining into standalone HTML snapshots
  const cssCache = {};
  for (const theme of ['night', 'day']) {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1600, height: 1000, deviceScaleFactor: 1.5 });
    await page.evaluateOnNewDocument((t) => { try { localStorage.setItem('nwTracker.theme', t); } catch {} }, theme);
    await page.goto(`${BASE}/#overview`, { waitUntil: 'domcontentloaded' });
    await new Promise(r => setTimeout(r, 6000)); // hydration + quote fetches (or their failures)
    for (const key of TABS) {
      await page.evaluate((k) => { window.location.hash = k; }, key);
      await new Promise(r => setTimeout(r, 1800));
      await page.screenshot({ path: `/tmp/snapshots/${key}-${theme}.png`, fullPage: true });
      // self-contained HTML: inline stylesheets, drop scripts (static snapshot)
      let html = await page.content();
      for (const m of html.matchAll(/<link[^>]+href="(\/_next[^"]+\.css)"[^>]*>/g)) {
        const url = m[1];
        if (!cssCache[url]) cssCache[url] = await (await fetch(BASE + url)).text();
        html = html.replace(m[0], `<style>${cssCache[url]}</style>`);
      }
      html = html.replace(/<script[\s\S]*?<\/script>/g, '');
      fs.writeFileSync(`/tmp/snapshots/${key}-${theme}.html`, html);
      console.log(`${key}-${theme} done`);
    }
    await ctx.close();
  }
  await browser.close();
})();
