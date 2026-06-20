// Headless daily reconcile for the THREE zero-touch brokers (Upstox, Dhan,
// Fyers). Reads their daily tokens, pulls holdings/positions/funds via REST, and
// MERGES into data/broker-state.json — preserving the Kite/INDIAN sleeve, which
// only the Claude `/sync` can refresh (Kite is a hosted-OAuth MCP with no token
// file a script could read). Commits + pushes so the deployed app reads it.
//
// Run by the Windows task BrokerDailySync (08:30 IST, -StartWhenAvailable → it
// catches up on your first logon of the day when a slot was missed).
// Manual / dry-run:  SYNC_SKIP_GIT=1 node scripts/sync-brokers.mjs
//
// READ-ONLY — only GETs holdings/positions/funds; never places/cancels an order.

import { readFileSync, writeFileSync } from 'node:fs';
import { execSync } from 'node:child_process';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { appendTrades } from './lib/trades-log.mjs';
import { appendLedger } from './lib/fno-ledger.mjs';
import { chargesForFills, segmentOf } from './lib/fno-charges.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = join(ROOT, 'data', 'broker-state.json');

const nowIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, '+05:30');
const readJSON = (p, fb = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };

// Fyers creds — process.env (interactive shell or cloud Remote env) else the .env
// fallback, so both the headless laptop task and the cloud routine are
// self-sufficient (Task Scheduler / the cloud don't inherit a shell's env).
const fyersCfg = () => {
  const e = loadEnv(join(ROOT, 'mcp', 'fyers', '.env'));
  return {
    appId: process.env.FYERS_APP_ID || e.FYERS_APP_ID,
    secret: process.env.FYERS_SECRET_ID || e.FYERS_SECRET_ID,
    pin: process.env.FYERS_PIN || e.FYERS_PIN,
  };
};
const fyersAppId = () => fyersCfg().appId;

function loadEnv(p) {
  const env = {};
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}

// ── TOTP (RFC 6238), no deps — for the Dhan self-mint ──
function base32Decode(b32) {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0, val = 0; const out = [];
  for (const c of String(b32).replace(/=+$/, '').toUpperCase()) {
    const i = A.indexOf(c); if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 0xff); bits -= 8; }
  }
  return Buffer.from(out);
}
function totp(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30);
  const buf = Buffer.alloc(8); buf.writeBigInt64BE(BigInt(counter));
  const h = crypto.createHmac('sha1', base32Decode(secret)).update(buf).digest();
  const o = h[h.length - 1] & 0xf;
  return String((h.readUInt32BE(o) & 0x7fffffff) % 1e6).padStart(6, '0');
}

async function getJSON(url, headers) {
  const r = await fetch(url, { headers });
  const t = await r.text();
  let j; try { j = JSON.parse(t); } catch { j = { _raw: t.slice(0, 200) }; }
  return { ok: r.ok, status: r.status, json: j };
}

// Dhan: reuse the cached 24h token if still valid, else self-mint via TOTP.
async function dhanToken() {
  const cache = readJSON(join(ROOT, 'mcp', 'dhan', '.token.json'));
  if (cache?.accessToken && cache.expiryTs && cache.expiryTs * 1000 > Date.now() + 60000) return cache.accessToken;
  // process.env first (cloud Remote env) then the .env file (laptop) — so the
  // cloud routine needs only env vars, not the gitignored .env placed in it.
  const e = loadEnv(join(ROOT, 'mcp', 'dhan', '.env'));
  const cid = process.env.DHAN_CLIENT_ID || e.DHAN_CLIENT_ID;
  const pin = process.env.DHAN_PIN || e.DHAN_PIN;
  const seed = process.env.DHAN_TOTP_SEED || e.DHAN_TOTP_SEED;
  const url = `https://auth.dhan.co/app/generateAccessToken?dhanClientId=${cid}&pin=${pin}&totp=${totp(seed)}`;
  const r = await fetch(url, { method: 'POST' });
  const j = await r.json();
  if (!j.accessToken) throw new Error('mint failed: ' + JSON.stringify(j).slice(0, 200));
  writeFileSync(join(ROOT, 'mcp', 'dhan', '.token.json'),
    JSON.stringify({ accessToken: j.accessToken, expiryTs: Math.floor(Date.now() / 1000) + 23 * 3600 }));
  return j.accessToken;
}

// Vercel KV / Upstash REST (optional) — the channel the laptop hands the Fyers
// refresh_token to the cloud routine. Creds come from process.env (cloud Remote)
// or the gitignored mcp/.kv.env file (laptop — paste the two keys there). No-op
// when neither is configured.
const KV_ENV = loadEnv(join(ROOT, 'mcp', '.kv.env'));
function kvCreds() {
  return {
    url: process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || KV_ENV.KV_REST_API_URL || KV_ENV.UPSTASH_REDIS_REST_URL,
    token: process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || KV_ENV.KV_REST_API_TOKEN || KV_ENV.UPSTASH_REDIS_REST_TOKEN,
  };
}
async function kv(cmd) {
  const { url, token } = kvCreds();
  if (!url || !token) return undefined;
  try {
    const r = await fetch(url, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(cmd) });
    return (await r.json())?.result;
  } catch { return undefined; }
}
const FYERS_RT_KEY = 'fyers:refreshToken';

// Fyers daily access token. Laptop = the browser-minted .token.json. Cloud (no
// local token) = refresh-mint via /validate-refresh-token using the refresh_token
// the laptop pushed to KV. That endpoint is NOT behind the login page's Cloudflare,
// so it works headless for the refresh token's ~15-day life. Memoised per run.
let _fyersAt;
async function fyersAccessToken() {
  if (_fyersAt) return _fyersAt;
  const local = readJSON(join(ROOT, 'mcp', 'fyers', '.token.json'))?.access_token;
  if (local) return (_fyersAt = local);
  return (_fyersAt = await fyersRefreshMint());
}
async function fyersRefreshMint() {
  const { appId, secret, pin } = fyersCfg();
  const refresh = process.env.FYERS_REFRESH_TOKEN || await kv(['GET', FYERS_RT_KEY]);
  if (!appId || !secret || !pin || !refresh) {
    throw new Error('fyers refresh creds missing (need FYERS_APP_ID/SECRET_ID/PIN + refresh_token in KV)');
  }
  const appIdHash = crypto.createHash('sha256').update(`${appId}:${secret}`).digest('hex');
  const r = await fetch('https://api-t1.fyers.in/api/v3/validate-refresh-token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ grant_type: 'refresh_token', appIdHash, refresh_token: refresh, pin }),
  });
  const j = await r.json();
  if (!j.access_token) throw new Error('fyers refresh-mint: ' + JSON.stringify(j).slice(0, 150));
  return j.access_token;
}

async function pullUpstox() {
  const tok = readJSON(join(ROOT, 'mcp', 'upstox', '.token.json'))?.access_token;
  if (!tok) throw new Error('no token (run UpstoxDailyLogin)');
  const H = { Authorization: `Bearer ${tok}`, Accept: 'application/json' };
  const hold = await getJSON('https://api.upstox.com/v2/portfolio/long-term-holdings', H);
  if (hold.json?.status === 'error') throw new Error(hold.json.errors?.[0]?.message || 'holdings error');
  const rows = (hold.json?.data || []).map((d) => ({
    sym: d.tradingsymbol, qty: d.quantity, avg: d.average_price,
    ltp: d.last_price, pnl: d.pnl, dayPct: d.day_change_percentage,
  }));
  const fund = await getJSON('https://api.upstox.com/v2/user/get-funds-and-margin', H);
  const avail = fund.json?.data?.equity?.available_margin;
  return {
    swing: { source: 'Upstox', syncedAt: nowIst(), rows },
    funds: avail != null ? { available: +avail }
      : { available: null, note: fund.json?.errors?.[0]?.message || 'funds window 00:00-05:30 IST' },
  };
}

async function pullDhan() {
  const H = { 'access-token': await dhanToken(), Accept: 'application/json' };
  const pos = await getJSON('https://api.dhan.co/v2/positions', H);
  const list = Array.isArray(pos.json) ? pos.json : (pos.json?.data || []);
  const rows = list.map((p) => ({
    sym: p.tradingSymbol, type: p.drvOptionType, strike: p.drvStrikePrice,
    expiry: String(p.drvExpiryDate || '').slice(0, 10), status: p.positionType,
    netQty: p.netQty, buyAvg: p.buyAvg, realized: p.realizedProfit, unrealized: p.unrealizedProfit,
  }));
  const fund = await getJSON('https://api.dhan.co/v2/fundlimit', H);
  return {
    fno: { source: 'Dhan', syncedAt: nowIst(), rows },
    funds: { available: fund.json?.availabelBalance ?? null, utilized: fund.json?.utilizedAmount ?? null },
  };
}

async function pullFyers() {
  const appId = fyersAppId();
  const tok = await fyersAccessToken();
  if (!tok || !appId) throw new Error('no token/app_id (run FyersDailyLogin or set refresh_token)');
  const H = { Authorization: `${appId}:${tok}` };
  let fund = await getJSON('https://api-t1.fyers.in/api/v3/funds', H);
  if (fund.json?.s !== 'ok') fund = await getJSON('https://api.fyers.in/api/v3/funds', H);
  const avail = (fund.json?.fund_limit || []).find((f) => f.title === 'Available Balance')?.equityAmount;
  if (avail == null) throw new Error('funds: ' + JSON.stringify(fund.json).slice(0, 150));
  return { funds: { available: +avail } };
}

// Mint-on-demand — when a daily token has expired, run that broker's login.py
// inline (same invocation as its Windows task) then retry the pull once. Makes
// the sync self-healing regardless of when it fires or whether the login tasks
// ran. Dhan isn't here — it self-mints inside dhanToken().
const MINT = {
  upstox: { dir: 'mcp/upstox', args: ['login.py'] },          // headless
  fyers:  { dir: 'mcp/fyers',  args: ['login.py', '--show'] }, // headed (Cloudflare)
};
function mint(name) {
  // The cloud routine sets SYNC_NO_BROWSER=1 — it can't drive Playwright/Cloudflare,
  // so a stale Upstox/Fyers token there degrades gracefully instead of hanging on a
  // browser launch. (Dhan self-mints pure-API; Fyers refresh-mints from KV.)
  if (process.env.SYNC_NO_BROWSER) return false;
  const m = MINT[name]; if (!m) return false;
  const py = join(ROOT, m.dir, '.venv', 'Scripts', 'python.exe');
  const cmd = [`"${py}"`, ...m.args.map((a) => (a.endsWith('.py') ? `"${a}"` : a))].join(' ');
  try { execSync(cmd, { cwd: join(ROOT, m.dir), timeout: 180000, stdio: 'inherit' }); return true; }
  catch { return false; }
}

// ── today's fills → durable tradebook (broker APIs are intraday-only, so we pile
// them up daily). Field maps are best-effort — they self-validate on the first
// real fill; until then the responses are empty and nothing is captured. ──
async function tradesUpstox() {
  const tok = readJSON(join(ROOT, 'mcp', 'upstox', '.token.json'))?.access_token;
  if (!tok) return [];
  const r = await getJSON('https://api.upstox.com/v2/order/trades/get-trades', { Authorization: `Bearer ${tok}`, Accept: 'application/json' });
  return (r.json?.data || []).map((t) => ({
    id: String(t.trade_id ?? t.order_id ?? ''), sym: t.tradingsymbol || t.trading_symbol,
    date: String(t.trade_timestamp || t.order_timestamp || '').slice(0, 10), side: t.transaction_type,
    qty: t.quantity, price: t.average_price ?? t.trade_price ?? t.price,
    value: +((t.quantity || 0) * (t.average_price ?? t.price ?? 0)).toFixed(2),
  }));
}
async function tradesDhan() {
  const r = await getJSON('https://api.dhan.co/v2/trades', { 'access-token': await dhanToken(), Accept: 'application/json' });
  const list = Array.isArray(r.json) ? r.json : (r.json?.data || []);
  return list.map((t) => ({
    id: String(t.exchangeTradeId ?? t.orderId ?? ''), sym: t.tradingSymbol || t.customSymbol,
    date: String(t.exchangeTime || t.createTime || '').slice(0, 10), side: t.transactionType,
    qty: t.tradedQuantity, price: t.tradedPrice,
    value: +((t.tradedQuantity || 0) * (t.tradedPrice || 0)).toFixed(2),
  }));
}
async function tradesFyers() {
  const appId = fyersAppId();
  const tok = await fyersAccessToken().catch(() => null);
  if (!tok || !appId) return [];
  let r = await getJSON('https://api-t1.fyers.in/api/v3/tradebook', { Authorization: `${appId}:${tok}` });
  if (!r.json?.tradeBook) r = await getJSON('https://api.fyers.in/api/v3/tradebook', { Authorization: `${appId}:${tok}` });
  return (r.json?.tradeBook || []).map((t) => ({
    id: String(t.tradeNumber ?? t.orderNumber ?? t.id ?? ''), sym: t.symbol,
    date: String(t.orderDateTime || '').slice(0, 10), side: t.side === 1 ? 'BUY' : t.side === -1 ? 'SELL' : t.side,
    qty: t.tradedQty, price: t.tradePrice,
    value: +((t.tradedQty || 0) * (t.tradePrice || 0)).toFixed(2),
  }));
}

// ── orchestrate ──
const state = readJSON(STATE_PATH) || { brokers: {}, holdings: {}, positions: {}, funds: {} };
const ts = nowIst();
state.syncedAt = ts;
const log = [];

// SYNC_ONLY=dhan restricts the run to one broker (comma-separated for several).
// The always-on cloud-Dhan routine sets it so the cloud run touches only the
// Dhan sleeve + Dhan ledger row and leaves the laptop-side brokers untouched.
// Unset (the laptop runs) = all three.
const ONLY = (process.env.SYNC_ONLY || '').toLowerCase().split(',').map((s) => s.trim()).filter(Boolean);
const want = (name) => !ONLY.length || ONLY.includes(name);

for (const [name, fn] of [['upstox', pullUpstox], ['dhan', pullDhan], ['fyers', pullFyers]].filter(([n]) => want(n))) {
  try {
    let r;
    try {
      r = await fn();
    } catch (e) {
      // Token likely expired — mint a fresh one inline and retry the pull once.
      if (MINT[name] && /token|auth|login|invalid|unauthor/i.test(String(e.message || e))) {
        log.push(`  ${name}: token stale — minting…`);
        if (!mint(name)) throw new Error(`mint failed (${e.message || e})`);
        r = await fn();
      } else throw e;
    }
    if (r.swing) state.holdings.SWING = r.swing;
    if (r.fno) state.positions.DHAN_FNO = r.fno;
    if (r.funds) state.funds[name] = r.funds;
    state.brokers[name] = { ok: true, note: '' };
    log.push(`${name}: ok${r.swing ? ` · ${r.swing.rows.length} holdings` : ''}${r.fno ? ` · ${r.fno.rows.length} positions` : ''}`);
  } catch (e) {
    state.brokers[name] = { ok: false, note: String(e.message || e) };
    log.push(`${name}: FAILED — ${e.message || e} (kept previous values)`);
  }
}

// Capture today's fills into the durable tradebook AND the realised-F&O ledger —
// only for brokers that authed. The same fills feed both: trades-log (durable
// cashflow) and fno-ledger (daily realised P&L net of modeled charges, which
// drives the Trading tab's current-FY blocks — no more hand-editing).
const SLEEVE = { upstox: 'S02', dhan: 'S01', fyers: 'S02' };
const isFno = (sym) => segmentOf(sym) != null;
// Gross realised from same-day round-trips: only contracts that netted flat
// (buyQty === sellQty) realise today; carried/positional legs crystallise later
// (caught via Dhan's native realised, or trued up at the annual ITR pass).
function closedNet(fills) {
  const byc = {};
  for (const f of fills) {
    const c = (byc[f.sym] ||= { bq: 0, sq: 0, bv: 0, sv: 0 });
    const v = f.value != null ? Math.abs(f.value) : Math.abs((f.qty || 0) * (f.price || 0));
    if (String(f.side || '').toUpperCase().startsWith('S')) { c.sq += f.qty; c.sv += v; }
    else { c.bq += f.qty; c.bv += v; }
  }
  let net = 0;
  for (const k in byc) { const c = byc[k]; if (c.bq && c.bq === c.sq) net += c.sv - c.bv; }
  return +net.toFixed(2);
}
const ledgerRows = [];
for (const [name, label, fn] of [['upstox', 'Upstox', tradesUpstox], ['dhan', 'Dhan', tradesDhan], ['fyers', 'Fyers', tradesFyers]].filter(([n]) => want(n))) {
  try {
    if (!state.brokers[name]?.ok) continue;
    const fills = await fn();
    const added = appendTrades(label, fills);
    if (added) log.push(`${name} trades: +${added}`);

    // Realised F&O for the ledger (gross − modeled charges = net).
    const fno = (fills || []).filter((f) => isFno(f.sym));
    let gross = null, source = 'fills';
    if (name === 'dhan') { // native realised — includes expiry/settlement P&L
      const native = (state.positions.DHAN_FNO?.rows || []).reduce((a, p) => a + (Number(p.realized) || 0), 0);
      if (native) { gross = native; source = 'positions'; }
    }
    if (gross == null) gross = closedNet(fno);
    if (gross || fno.length) {
      const ch = chargesForFills(label, fno);
      ledgerRows.push({
        date: fno[0]?.date || ts.slice(0, 10), broker: label, sleeve: SLEEVE[name],
        grossRealised: gross, estCharges: ch.total, turnover: ch.turnover, orders: ch.orders, source,
      });
      log.push(`${name} F&O: gross ₹${gross} − est ₹${ch.total} = net ₹${+(gross - ch.total).toFixed(2)}`);
    }
  } catch (e) { log.push(`${name} trades: skipped (${e.message || e})`); }
}
if (ledgerRows.length) {
  const { added, updated } = appendLedger(ledgerRows);
  if (added || updated) log.push(`fno-ledger: ${added} new · ${updated} updated`);
}

// Hand the Fyers refresh_token off to KV so the always-on cloud routine can mint
// daily access tokens without a browser. Only the laptop has the browser-minted
// .token.json with a refresh_token; the cloud reads this and tops nothing up.
try {
  const rt = readJSON(join(ROOT, 'mcp', 'fyers', '.token.json'))?.refresh_token;
  if (rt && kvCreds().url) {
    const prev = await kv(['GET', FYERS_RT_KEY]);
    if (prev !== rt) { await kv(['SET', FYERS_RT_KEY, rt]); log.push('fyers refresh_token → KV (cloud handoff)'); }
  }
} catch (e) { log.push(`fyers KV handoff: skipped (${e.message || e})`); }

// Kite / INDIAN is never touched here — only /sync refreshes it.
state.brokers.kite = state.brokers.kite || { ok: false, note: 'hosted MCP — refreshed only by /sync' };

writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
console.log('broker sync @', ts);
log.forEach((l) => console.log('  ' + l));

if (!process.env.SYNC_SKIP_GIT) {
  try {
    const files = 'data/broker-state.json data/trades-log.json data/fno-ledger.json';
    execSync(`git add ${files}`, { cwd: ROOT });
    if (execSync(`git status --porcelain ${files}`, { cwd: ROOT }).toString().trim()) {
      const scope = ONLY.length ? ` (${ONLY.join(',')})` : '';
      execSync(`git commit -m "chore: broker sync ${ts.slice(0, 10)}${scope}"`, { cwd: ROOT, stdio: 'inherit' });
    }
    // Always land on origin/main. The laptop is on main, but a cloud routine session
    // runs on a throwaway branch (claude/*), so a bare `git push` lands the data on
    // that branch where the deployed app never sees it. Rebase onto + push to main
    // explicitly. Two committers (laptop + cloud) → rebase first; on the rare
    // append-conflict, abort cleanly (the ledger upsert is idempotent → next run heals).
    execSync('git fetch origin main', { cwd: ROOT });
    try {
      execSync('git rebase origin/main', { cwd: ROOT, stdio: 'inherit' });
    } catch {
      try { execSync('git rebase --abort', { cwd: ROOT }); } catch {}
      throw new Error('rebase onto main conflicted — skipping push, next run retries');
    }
    const ahead = +execSync('git rev-list --count origin/main..HEAD', { cwd: ROOT }).toString().trim();
    if (ahead > 0) { execSync('git push origin HEAD:main', { cwd: ROOT, stdio: 'inherit' }); console.log(`pushed ${ahead} to main`); }
    else { console.log('nothing to push'); }
  } catch (e) { console.error('git step:', e.message); }
}
