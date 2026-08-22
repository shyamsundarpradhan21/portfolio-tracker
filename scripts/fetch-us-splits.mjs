// US split/ratio events for the realised-P&L reconstruction.
//
// Vested's Trades sheet books a split as NOTHING — the extra shares just appear, with no
// buy row (same blind spot that makes composition unreconstructable; see parse-vested.py).
// A FIFO over those trades therefore prices post-split sells against pre-split lots and
// silently mangles realised P&L: before this file, the reconstruction read FY24-25 -31.26
// against Vested's own +11.13. Applying the ratio to the OPEN lots (qty x factor, cost/share
// / factor) at the split date brings it to +10.53 — a 0.3% residual instead of a 380% one.
//
// Yahoo v8 chart is the source (keyless, the app's only Yahoo path). Reverse splits and
// spin-off ratio adjustments come through the same `events.splits` block (factor < 1).
//
// The symbol universe is OWNED BY parse-vested.py — it writes `symbols` into this file from
// the corpus union (exited tickers included, which us_trades.json's flows no longer carry).
// Every fetched symbol gets a `splits` key, [] when it never split, so a missing key means
// NOT FETCHED rather than "no splits" and --realized can warn honestly.
//
//   node scripts/fetch-us-splits.mjs            # refresh every symbol in the universe
//   node scripts/fetch-us-splits.mjs AAPL,SCHD  # or just these
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOT = process.cwd();
const STORE = process.env.US_SPLITS || join(ROOT, 'data', 'us-splits.json');
const P1 = 1683000000;                                  // 2023-05, before the account opened
const CONC = 6;

const cur = existsSync(STORE) ? JSON.parse(readFileSync(STORE, 'utf8')) : {};
const universe = (process.argv[2] ? process.argv[2].split(',') : cur.symbols || []).map((s) => s.trim()).filter(Boolean);
if (!universe.length) {
  console.error('no symbols — run `python scripts/parse-vested.py --realized` first (it writes the universe), or pass a comma list');
  process.exit(1);
}

async function splitsFor(sym) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}`
    + `?period1=${P1}&period2=${Math.floor(Date.now() / 1000)}&interval=1d&events=split`;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: AbortSignal.timeout(15000) });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const j = await r.json();
      const ev = j?.chart?.result?.[0]?.events?.splits || {};
      return Object.values(ev)
        .map((x) => ({ date: new Date(x.date * 1000).toISOString().slice(0, 10), factor: x.numerator / x.denominator }))
        .filter((x) => Number.isFinite(x.factor) && x.factor > 0 && x.factor !== 1)
        .sort((a, b) => a.date.localeCompare(b.date));
    } catch (e) {
      if (attempt === 2) return { error: e.message };
      await new Promise((res) => setTimeout(res, 400 * (attempt + 1)));
    }
  }
}

const splits = { ...(cur.splits || {}) };
const failed = [];
const queue = [...universe];
await Promise.all(Array.from({ length: CONC }, async () => {
  while (queue.length) {
    const s = queue.shift();
    const got = await splitsFor(s);
    if (Array.isArray(got)) splits[s] = got;                   // [] = fetched, never split
    else failed.push(`${s} (${got.error})`);                   // leave any prior value intact
  }
}));

const out = {
  note: 'Split / ratio events per US ticker (Yahoo v8 chart). [] = fetched, no split. A symbol '
      + 'ABSENT from splits was never fetched. `symbols` is written by parse-vested.py --realized.',
  fetchedAt: new Date().toISOString(),
  symbols: cur.symbols || universe,
  splits: Object.fromEntries(Object.entries(splits).sort(([a], [b]) => a.localeCompare(b))),
};
writeFileSync(STORE, JSON.stringify(out, null, 1) + '\n');
const withSplits = Object.entries(out.splits).filter(([, v]) => v.length);
console.log(`us-splits: ${Object.keys(out.splits).length} symbols fetched, ${withSplits.length} with events -> ${STORE}`);
for (const [s, evs] of withSplits) console.log(`   ${s}  ${evs.map((e) => `${e.date} x${e.factor}`).join(', ')}`);
if (failed.length) { console.error(`FAILED (kept previous): ${failed.join(', ')}`); process.exit(1); }
