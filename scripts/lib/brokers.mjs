// Positions-only broker reader for the intraday capture tape. Deliberately
// NARROWER than scripts/sync-brokers.mjs: it fetches only F&O positions and the
// pending-order flag, and reads the daily access tokens straight off disk — it
// NEVER mints (no browser, no rate-limit risk), because it runs every few minutes
// during market hours and relies on the daily login tasks having placed the
// tokens. A broker with no token on disk is simply skipped for that tick.
//
// READ-ONLY — only GETs positions/orders; never places/modifies/cancels an order.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { segmentOf } from './fno-charges.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const readJSON = (p, fb = null) => { try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return fb; } };
const isFno = (sym) => segmentOf(sym) != null;
const num = (n) => (Number.isFinite(+n) ? +n : 0);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function getJSON(url, headers) {
  // One retry with backoff + jitter on a 429 (rate limit) or a transient network
  // failure; the daemon polls at 10s so a single short wait never stacks ticks.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(8000) });
      const t = await r.text();
      let j; try { j = JSON.parse(t); } catch { j = null; }
      if (r.status === 429 && attempt === 0) { await sleep(1000 + Math.random() * 800); continue; }
      return { ok: r.ok, status: r.status, json: j };
    } catch {
      if (attempt === 0) { await sleep(600 + Math.random() * 400); continue; }
      return { ok: false, status: 0, json: null };
    }
  }
  return { ok: false, status: 0, json: null };
}

// Each puller returns { net, pending } where net = Σ(realised + open MTM) over the
// broker's F&O legs, or null if the token is missing / the call failed (→ skipped,
// not zeroed, so a transient blip never draws a fake dip to ₹0).
function loadEnvFile(p) {
  const env = {};
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}

async function dhan(withOrders) {
  const tok = readJSON(join(ROOT, 'mcp', 'dhan', '.token.json'))?.accessToken;
  if (!tok) return null;
  const H = { 'access-token': tok, Accept: 'application/json' };
  const pos = await getJSON('https://api.dhan.co/v2/positions', H);
  if (!pos.ok || !pos.json) return null;
  const list = Array.isArray(pos.json) ? pos.json : (pos.json.data || []);
  let net = 0;
  for (const p of list) {
    if (!isFno(p.tradingSymbol)) continue;
    net += num(p.realizedProfit) + num(p.unrealizedProfit);
  }
  let pending = false;
  if (withOrders) {
    const ord = await getJSON('https://api.dhan.co/v2/orders', H);
    const olist = Array.isArray(ord.json) ? ord.json : (ord.json?.data || []);
    pending = olist.some((o) => /PENDING|TRANSIT|OPEN/i.test(String(o.orderStatus || '')));
  }
  return { net, pending };
}

async function upstox(withOrders) {
  const tok = readJSON(join(ROOT, 'mcp', 'upstox', '.token.json'))?.access_token;
  if (!tok) return null;
  const H = { Authorization: `Bearer ${tok}`, Accept: 'application/json' };
  const pos = await getJSON('https://api.upstox.com/v2/portfolio/short-term-positions', H);
  if (!pos.ok || !Array.isArray(pos.json?.data)) return null;
  let net = 0;
  for (const p of pos.json.data) {
    const sym = p.trading_symbol || p.tradingsymbol || '';
    if (!isFno(sym)) continue;
    net += num(p.realised) + num(p.unrealised);
  }
  let pending = false;
  if (withOrders) {
    const ord = await getJSON('https://api.upstox.com/v2/order/retrieve-all', H);
    pending = (ord.json?.data || []).some((o) => /open|pending|trigger/i.test(String(o.status || '')));
  }
  return { net, pending };
}

async function fyers(withOrders) {
  const tok = readJSON(join(ROOT, 'mcp', 'fyers', '.token.json'))?.access_token;
  const appId = process.env.FYERS_APP_ID || loadEnvFile(join(ROOT, 'mcp', 'fyers', '.env')).FYERS_APP_ID;
  if (!tok || !appId) return null;
  const H = { Authorization: `${appId}:${tok}` };
  const pos = await getJSON('https://api-t1.fyers.in/api/v3/positions', H);
  if (pos.json?.s !== 'ok' || !Array.isArray(pos.json?.netPositions)) return null;
  let net = 0;
  for (const p of pos.json.netPositions) {
    if (!isFno(p.symbol)) continue;
    net += num(p.realized_profit) + num(p.unrealized_profit);
  }
  let pending = false;
  if (withOrders) {
    const ord = await getJSON('https://api-t1.fyers.in/api/v3/orders', H);
    pending = (ord.json?.orderBook || []).some((o) => /pending|open|transit/i.test(String(o.status || o.orderStatus || '')));
  }
  return { net, pending };
}

// Pull all three concurrently. Returns { byBroker:{dhan,upstox,fyers}, bySleeve:
// {S01,S02}, net, pending } — brokers that returned null are omitted from byBroker
// and excluded from the totals (skipped, never zeroed).
const SLEEVE = { dhan: 'S01', upstox: 'S02', fyers: 'S02' };
export async function pullPositions({ withOrders = true } = {}) {
  const results = await Promise.all([dhan(withOrders), upstox(withOrders), fyers(withOrders)]);
  const names = ['dhan', 'upstox', 'fyers'];
  const byBroker = {}, bySleeve = { S01: 0, S02: 0 };
  let net = 0, pending = false, any = false;
  results.forEach((r, i) => {
    if (!r) return;
    any = true;
    byBroker[names[i]] = Math.round(r.net * 100) / 100;
    bySleeve[SLEEVE[names[i]]] += r.net;
    net += r.net;
    pending = pending || !!r.pending;
  });
  return { any, byBroker, bySleeve, net: Math.round(net * 100) / 100, pending };
}
