// Transform the raw Kite market snapshot (data/.kite-market.json, written by the
// /sync skill's Kite step) into data/market-wrap.json for the Macro tab. Computes
// day% as (last_price - PRIOR close)/PRIOR close — Kite's ohlc.close is the previous
// session's close, used as the change reference. Non-personal market-index data, so
// it's committed (the personal-data pullback doesn't touch this). Deterministic +
// idempotent: re-running the same day overwrites the snapshot.

import { readFileSync, writeFileSync, unlinkSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const RAW = join(ROOT, 'data', '.kite-market.json');
const OUT = join(ROOT, 'data', 'market-wrap.json');
const nowIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, '+05:30');

// Kite instrument key -> display name. Sectors render as the heatmap; breadth as the strip.
const SECTORS = {
  'NSE:NIFTY IT': 'IT', 'NSE:NIFTY BANK': 'Bank', 'NSE:NIFTY AUTO': 'Auto',
  'NSE:NIFTY PHARMA': 'Pharma', 'NSE:NIFTY FMCG': 'FMCG', 'NSE:NIFTY METAL': 'Metal',
  'NSE:NIFTY ENERGY': 'Energy', 'NSE:NIFTY FIN SERVICE': 'Fin Services',
  'NSE:NIFTY REALTY': 'Realty', 'NSE:NIFTY PSU BANK': 'PSU Bank',
};
const BREADTH = {
  'NSE:NIFTY 50': 'Nifty 50', 'NSE:NIFTY NEXT 50': 'Next 50', 'NSE:NIFTY 500': 'Nifty 500',
  'NSE:NIFTY MIDCAP 100': 'Midcap 100', 'NSE:NIFTY SMLCAP 100': 'Smallcap 100',
};

const r2 = (n) => (n == null || !isFinite(n) ? null : Math.round(n * 100) / 100);
const pct = (o) => (o && o.ohlc && o.ohlc.close ? r2(((o.last_price - o.ohlc.close) / o.ohlc.close) * 100) : null);

const raw = JSON.parse(readFileSync(RAW, 'utf8'));
const ohlc = raw.ohlc || {};
const quotes = raw.quotes || {};
const get = (k) => ohlc[k] || quotes[k];

const mapRows = (dict) => Object.entries(dict)
  .map(([k, name]) => ({ name, pct: pct(get(k)) }))
  .filter((s) => s.pct != null);

const sectors = mapRows(SECTORS).sort((a, b) => a.pct - b.pct); // worst first (red on top)
const breadth = mapRows(BREADTH);

const n = get('NSE:NIFTY 50');
const nifty = n ? { last: r2(n.last_price), prevClose: r2(n.ohlc?.close), pct: pct(n) } : null;
const v = quotes['NSE:INDIA VIX'] || ohlc['NSE:INDIA VIX'];
const vix = v ? {
  last: r2(v.last_price), prevClose: r2(v.ohlc?.close),
  change: r2(v.net_change != null ? v.net_change : v.last_price - (v.ohlc?.close || 0)),
  pct: pct(v), high: r2(v.ohlc?.high), low: r2(v.ohlc?.low),
} : null;

const asOf = n?.timestamp || v?.timestamp || nowIst();
const out = {
  note: 'End-of-session NSE market wrap from the Kite MCP (sectoral + breadth indices + India VIX), captured during /sync. day pct = (last - prior close)/prior close. Non-personal; safe to commit. Built by scripts/merge-market.mjs.',
  asOf, capturedAt: nowIst(), source: 'Kite · NSE indices', nifty, vix, sectors, breadth,
};
writeFileSync(OUT, JSON.stringify(out, null, 2) + '\n');
if (existsSync(RAW)) unlinkSync(RAW);
console.log(`market-wrap: ${sectors.length} sectors · ${breadth.length} breadth · NIFTY ${nifty?.pct ?? '—'}% · VIX ${vix?.last ?? '—'}`);

if (!process.env.SYNC_SKIP_GIT) {
  try {
    execSync('git add data/market-wrap.json', { cwd: ROOT });
    if (execSync('git status --porcelain data/market-wrap.json', { cwd: ROOT }).toString().trim()) {
      execSync(`git commit -m "wrap: NSE sector + breadth + VIX snapshot ${String(asOf).slice(0, 10)}"`, { cwd: ROOT, stdio: 'inherit' });
      try { execSync('git pull --rebase --autostash', { cwd: ROOT, stdio: 'inherit' }); } catch { try { execSync('git rebase --abort', { cwd: ROOT }); } catch {} }
      execSync('git push', { cwd: ROOT, stdio: 'inherit' });
      console.log('committed + pushed');
    } else { console.log('no change — skip commit'); }
  } catch (e) { console.error('git step:', e.message); }
}
