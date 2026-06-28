// SANITY GUARD for the certify.mjs ellipsis-bucket refinement.
//
// Proves the refinement does NOT blind real layout overflow: it extracts the LIVE
// detect() from certify.mjs (no copy — so it can't drift) and runs it against a
// controlled fixture with four probes. Asserts:
//   1. ellipsis-truncate  (nowrap + ellipsis + overflow:hidden, content too long)
//        → 'ellipsis' bucket, NOT 'clipped'           (intentional truncation)
//   2. non-ellipsis clip  (white-space:normal, unbreakable token, overflow:hidden)
//        → 'clipped'                                   (genuine internal overflow)
//   3. escape             (box wider than viewport)
//        → 'clipped'                                   (real escape)
//   4. ellipsis + escape  (nowrap+ellipsis BUT box wider than viewport)
//        → 'clipped'                                   (escape wins over ellipsis)
// Run: node audit/responsive/sanity-ellipsis.mjs   (no dev server needed)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import puppeteer from 'puppeteer';

const DIR = path.dirname(fileURLToPath(import.meta.url));

// Pull the REAL detect() source out of certify.mjs (everything from its declaration
// up to the next function) — tests the shipping logic, not a copy.
const certSrc = fs.readFileSync(path.join(DIR, 'certify.mjs'), 'utf8');
const start = certSrc.indexOf('function detect(opts)');
const end = certSrc.indexOf('function injectStress');
if (start < 0 || end < 0) { console.error('SANITY FATAL: could not locate detect() in certify.mjs'); process.exit(1); }
const detectSrc = certSrc.slice(start, end).trim();

const FIXTURE = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0}
  .box{width:60px;border:1px solid #000;font:14px monospace}
  .t-ellipsis{white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
  .t-clip{white-space:normal;overflow:hidden;overflow-wrap:normal;word-break:keep-all}
  .t-escape{width:130vw;white-space:nowrap}
  .t-esc-ellipsis{width:130vw;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
</style></head><body>
  <div class="box t-ellipsis">SUPERLONGTICKERNAMEXX</div>
  <div class="box t-clip">SUPERLONGUNBREAKABLETOKENXX</div>
  <div class="box t-escape">x</div>
  <div class="box t-esc-ellipsis">SUPERLONGTICKERNAMEXX</div>
</body></html>`;

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setViewport({ width: 400, height: 600, deviceScaleFactor: 1 });
await page.setContent(FIXTURE, { waitUntil: 'domcontentloaded' });

const res = await page.evaluate((src) => {
  const detect = eval('(' + src + ')');
  const m = detect({});
  const inClip = (cls) => m.topClipped.some((r) => r.sel.includes(cls));
  const inEll = (cls) => (m.topEllipsis || []).some((r) => r.sel.includes(cls));
  return {
    clippedCount: m.clippedCount, ellipsisCount: m.ellipsisCount,
    ellipsis_inEll: inEll('t-ellipsis'), ellipsis_inClip: inClip('t-ellipsis'),
    clip_inClip: inClip('t-clip'), clip_inEll: inEll('t-clip'),
    escape_inClip: inClip('t-escape'),
    escEllipsis_inClip: inClip('t-esc-ellipsis'), escEllipsis_inEll: inEll('t-esc-ellipsis'),
  };
}, detectSrc);
await browser.close();

const checks = [
  ['ellipsis-truncate → ellipsis bucket', res.ellipsis_inEll === true],
  ['ellipsis-truncate NOT in clipped',    res.ellipsis_inClip === false],
  ['non-ellipsis overflow → clipped',     res.clip_inClip === true],
  ['non-ellipsis overflow NOT in ellipsis', res.clip_inEll === false],
  ['escape → clipped',                    res.escape_inClip === true],
  ['ellipsis+escape → clipped (escape wins)', res.escEllipsis_inClip === true],
  ['ellipsis+escape NOT excused as ellipsis', res.escEllipsis_inEll === false],
];
let pass = true;
console.log(`detected: clipped=${res.clippedCount} ellipsis=${res.ellipsisCount}\n`);
for (const [name, ok] of checks) { console.log(`  ${ok ? 'PASS' : '*** FAIL ***'}  ${name}`); if (!ok) pass = false; }
console.log(`\nSANITY: ${pass ? 'ALL PASS — refinement preserves real-clip detection' : '*** FAIL ***'}`);
process.exit(pass ? 0 : 1);
