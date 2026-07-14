// Fetch the best-available favicon per Nifty-50 ticker → public/logos/<slug>.png, for the
// heatmap hover logo. Source: Google s2 favicons (sz=128, PNG). A 404 there is Google's
// generic-globe placeholder → skipped, leaving that ticker to the monogram-badge fallback
// in MarketHeatmap. Committed → fast, offline, no runtime dependency. Public brand favicons,
// non-personal; re-run on index reconstitution or if a company changes its site.
//
//   node scripts/fetch-nifty-logos.mjs         # fetch + write public/logos/*.png
//   node scripts/fetch-nifty-logos.mjs --dry   # report coverage only, write nothing

import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public', 'logos');
const DRY = process.argv.includes('--dry');
// Filename/URL slug — MarketHeatmap's <Logo> resolves /logos/<slug>.png with the SAME rule,
// so tickers with punctuation (M&M, BAJAJ-AUTO) map to safe, matching paths.
const slug = (s) => s.replace(/[^A-Za-z0-9]/g, '');

// Ticker → primary company domain (the favicon host). Hand-mapped for the 50 constituents.
const DOMAINS = {
  RELIANCE: 'ril.com', HDFCBANK: 'hdfcbank.com', ICICIBANK: 'icicibank.com', INFY: 'infosys.com',
  TCS: 'tcs.com', ITC: 'itcportal.com', LT: 'larsentoubro.com', BHARTIARTL: 'airtel.in',
  SBIN: 'onlinesbi.sbi', AXISBANK: 'axisbank.com', KOTAKBANK: 'kotak.com', HINDUNILVR: 'hul.co.in',
  BAJFINANCE: 'bajajfinserv.in', HCLTECH: 'hcl.com', MARUTI: 'marutisuzuki.com',
  SUNPHARMA: 'sunpharma.com', 'M&M': 'mahindra.com', NTPC: 'ntpc.co.in', TATAMOTORS: 'tatamotors.com',
  TITAN: 'titanworld.com', ULTRACEMCO: 'ultratechcement.com', ASIANPAINT: 'asianpaints.com',
  POWERGRID: 'powergrid.in', ADANIENT: 'adanienterprises.com', ADANIPORTS: 'adaniports.com',
  WIPRO: 'wipro.com', ONGC: 'ongcindia.com', COALINDIA: 'coalindia.in', NESTLEIND: 'nestle.com',
  JSWSTEEL: 'jsw.in', TATASTEEL: 'tatasteel.com', BAJAJFINSV: 'bajajfinserv.in', GRASIM: 'grasim.com',
  TECHM: 'techmahindra.com', HINDALCO: 'hindalco.com', CIPLA: 'cipla.com', DRREDDY: 'drreddys.com',
  BRITANNIA: 'britannia.co.in', EICHERMOT: 'eichermotors.com', APOLLOHOSP: 'apollohospitals.com',
  BPCL: 'bharatpetroleum.in', HEROMOTOCO: 'heromotocorp.com', INDUSINDBK: 'indusind.com',
  'BAJAJ-AUTO': 'bajajauto.com', TATACONSUM: 'tataconsumer.com', SBILIFE: 'sbilife.co.in',
  HDFCLIFE: 'hdfclife.com', SHRIRAMFIN: 'shriramfinance.in', TRENT: 'westside.com', JIOFIN: 'jfs.in',
};

async function grab(url) {
  try {
    const r = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(9000) });
    if (!r.ok) return null; // 404 = Google's generic-globe placeholder → treat as no logo
    const buf = Buffer.from(await r.arrayBuffer());
    // Reject tiny/blank responses (a real favicon is comfortably >200 bytes) and non-PNG.
    if (buf.length < 200 || !(buf[0] === 0x89 && buf[1] === 0x50)) return null;
    return buf;
  } catch { return null; }
}

if (!DRY) mkdirSync(OUT, { recursive: true });
let ok = 0; const miss = [];
for (const [sym, dom] of Object.entries(DOMAINS)) {
  const buf = await grab(`https://www.google.com/s2/favicons?sz=128&domain=${dom}`);
  if (buf) {
    ok++;
    if (!DRY) writeFileSync(join(OUT, slug(sym) + '.png'), buf);
    console.log(`${sym.padEnd(12)} ${dom.padEnd(22)} ${String(buf.length).padStart(5)}b -> ${slug(sym)}.png`);
  } else {
    miss.push(sym);
    console.log(`${sym.padEnd(12)} ${dom.padEnd(22)}   MISS -> badge`);
  }
  await new Promise((r) => setTimeout(r, 120));
}
console.log(`\n${ok}/${Object.keys(DOMAINS).length} logos${DRY ? ' (dry-run)' : ' written to public/logos'}; badge fallback: ${miss.join(', ') || 'none'}`);
