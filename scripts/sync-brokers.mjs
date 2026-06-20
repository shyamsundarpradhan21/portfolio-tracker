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

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const STATE_PATH = join(ROOT, 'data', 'broker-state.json');

const nowIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, '+05:30');
const readJSON = (p, fb = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };

function loadEnv(p) {
  const env = {};
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2];
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
  const e = loadEnv(join(ROOT, 'mcp', 'dhan', '.env'));
  const url = `https://auth.dhan.co/app/generateAccessToken?dhanClientId=${e.DHAN_CLIENT_ID}&pin=${e.DHAN_PIN}&totp=${totp(e.DHAN_TOTP_SEED)}`;
  const r = await fetch(url, { method: 'POST' });
  const j = await r.json();
  if (!j.accessToken) throw new Error('mint failed: ' + JSON.stringify(j).slice(0, 200));
  writeFileSync(join(ROOT, 'mcp', 'dhan', '.token.json'),
    JSON.stringify({ accessToken: j.accessToken, expiryTs: Math.floor(Date.now() / 1000) + 23 * 3600 }));
  return j.accessToken;
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
  const tok = readJSON(join(ROOT, 'mcp', 'fyers', '.token.json'))?.access_token;
  const appId = process.env.FYERS_APP_ID;
  if (!tok || !appId) throw new Error('no token/app_id (run FyersDailyLogin)');
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
  const tok = readJSON(join(ROOT, 'mcp', 'fyers', '.token.json'))?.access_token;
  const appId = process.env.FYERS_APP_ID;
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

for (const [name, fn] of [['upstox', pullUpstox], ['dhan', pullDhan], ['fyers', pullFyers]]) {
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

// Capture today's fills into the durable tradebook — only for brokers that authed.
for (const [name, label, fn] of [['upstox', 'Upstox', tradesUpstox], ['dhan', 'Dhan', tradesDhan], ['fyers', 'Fyers', tradesFyers]]) {
  try {
    if (!state.brokers[name]?.ok) continue;
    const added = appendTrades(label, await fn());
    if (added) log.push(`${name} trades: +${added}`);
  } catch (e) { log.push(`${name} trades: skipped (${e.message || e})`); }
}

// Kite / INDIAN is never touched here — only /sync refreshes it.
state.brokers.kite = state.brokers.kite || { ok: false, note: 'hosted MCP — refreshed only by /sync' };

writeFileSync(STATE_PATH, JSON.stringify(state, null, 2) + '\n');
console.log('broker sync @', ts);
log.forEach((l) => console.log('  ' + l));

if (!process.env.SYNC_SKIP_GIT) {
  try {
    execSync('git add data/broker-state.json data/trades-log.json', { cwd: ROOT });
    if (execSync('git status --porcelain data/broker-state.json data/trades-log.json', { cwd: ROOT }).toString().trim()) {
      execSync(`git commit -m "chore: broker sync ${ts.slice(0, 10)}"`, { cwd: ROOT, stdio: 'inherit' });
      execSync('git push', { cwd: ROOT, stdio: 'inherit' });
      console.log('committed + pushed');
    } else { console.log('no change — skip commit'); }
  } catch (e) { console.error('git step failed:', e.message); }
}
