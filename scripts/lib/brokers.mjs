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
// A broker position is an F&O leg if the broker tags it so (Dhan's exchangeSegment
// NSE_FNO/BSE_FNO) OR its tradingSymbol parses as F&O. Dhan's hyphenated symbols
// (e.g. NIFTY-Jun2026-23550-PE) don't parse via segmentOf, so a symbol-only filter
// silently dropped EVERY Dhan F&O leg — trust the explicit segment, fall back to parse.
export const isFnoPosition = (p) => /FNO/.test(p?.exchangeSegment || '') || isFno(p?.tradingSymbol);
const num = (n) => (Number.isFinite(+n) ? +n : 0);
const round = (n) => Math.round(n * 100) / 100;
// Split a broker's position rows into realised (booked — closed legs) and open MTM
// (unrealised), over F&O legs only. Pure + broker-agnostic: each puller passes its own
// leg-test and realised/mtm field accessors. net = realised + mtm (the prior single sum).
export function splitLegs(list, { isLeg, realised, mtm }) {
  let r = 0, m = 0;
  for (const p of (list || [])) {
    if (!isLeg(p)) continue;
    r += num(realised(p));
    m += num(mtm(p));
  }
  return { realised: round(r), mtm: round(m), net: round(r + m) };
}

// First HH:MM in a broker timestamp ("2026-06-25 14:23:45" → "14:23"), else null.
export const hhmmOf = (ts) => { const m = String(ts ?? '').match(/(\d{2}):(\d{2})/); return m ? `${m[1]}:${m[2]}` : null; };
// Parse a broker order book into today's executed FILLS (for buy/sell markers on the
// curve). Pure + broker-agnostic — each puller passes accessors. Returns
// [{ id, t, side:'BUY'|'SELL', sym, qty, price }] for filled orders with a parseable time.
export function parseFills(orders, A) {
  const out = [];
  for (const o of (orders || [])) {
    if (!A.isFilled(o)) continue;
    const t = hhmmOf(A.time(o));
    if (!t) continue;
    const side = /sell|^-1$|^-/i.test(String(A.side(o))) ? 'SELL' : 'BUY';
    out.push({ id: String(A.id(o) ?? `${t}-${A.sym(o)}`), t, side, sym: String(A.sym(o) ?? '').replace(/^[A-Z]+:/, ''), qty: num(A.qty(o)), price: num(A.price(o)) });
  }
  return out;
}

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
  const { net, realised, mtm } = splitLegs(list, { isLeg: isFnoPosition, realised: (p) => p.realizedProfit, mtm: (p) => p.unrealizedProfit });
  let pending = false, fills = [];
  if (withOrders) {
    const ord = await getJSON('https://api.dhan.co/v2/orders', H);
    const olist = Array.isArray(ord.json) ? ord.json : (ord.json?.data || []);
    pending = olist.some((o) => /PENDING|TRANSIT|OPEN/i.test(String(o.orderStatus || '')));
    fills = parseFills(olist, {
      isFilled: (o) => /TRADED/i.test(String(o.orderStatus || '')),
      side: (o) => o.transactionType, sym: (o) => o.tradingSymbol,
      qty: (o) => o.quantity, price: (o) => o.averageTradedPrice ?? o.price,
      time: (o) => o.updateTime || o.exchangeTime || o.createTime, id: (o) => o.orderId,
    });
  }
  return { net, realised, mtm, pending, fills };
}

async function upstox(withOrders) {
  const tok = readJSON(join(ROOT, 'mcp', 'upstox', '.token.json'))?.access_token;
  if (!tok) return null;
  const H = { Authorization: `Bearer ${tok}`, Accept: 'application/json' };
  const pos = await getJSON('https://api.upstox.com/v2/portfolio/short-term-positions', H);
  if (!pos.ok || !Array.isArray(pos.json?.data)) return null;
  const { net, realised, mtm } = splitLegs(pos.json.data, {
    isLeg: (p) => isFno(p.trading_symbol || p.tradingsymbol || ''),
    realised: (p) => p.realised, mtm: (p) => p.unrealised,
  });
  let pending = false, fills = [];
  if (withOrders) {
    const ord = await getJSON('https://api.upstox.com/v2/order/retrieve-all', H);
    const olist = ord.json?.data || [];
    pending = olist.some((o) => /open|pending|trigger/i.test(String(o.status || '')));
    fills = parseFills(olist, {
      isFilled: (o) => /complete/i.test(String(o.status || '')),
      side: (o) => o.transaction_type, sym: (o) => o.trading_symbol,
      qty: (o) => o.filled_quantity ?? o.quantity, price: (o) => o.average_price,
      time: (o) => o.exchange_timestamp || o.order_timestamp, id: (o) => o.order_id,
    });
  }
  return { net, realised, mtm, pending, fills };
}

async function fyers(withOrders) {
  const tok = readJSON(join(ROOT, 'mcp', 'fyers', '.token.json'))?.access_token;
  const appId = process.env.FYERS_APP_ID || loadEnvFile(join(ROOT, 'mcp', 'fyers', '.env')).FYERS_APP_ID;
  if (!tok || !appId) return null;
  const H = { Authorization: `${appId}:${tok}` };
  const pos = await getJSON('https://api-t1.fyers.in/api/v3/positions', H);
  if (pos.json?.s !== 'ok' || !Array.isArray(pos.json?.netPositions)) return null;
  const { net, realised, mtm } = splitLegs(pos.json.netPositions, {
    isLeg: (p) => isFno(p.symbol),
    realised: (p) => p.realized_profit, mtm: (p) => p.unrealized_profit,
  });
  let pending = false, fills = [];
  if (withOrders) {
    const ord = await getJSON('https://api-t1.fyers.in/api/v3/orders', H);
    const olist = ord.json?.orderBook || [];
    pending = olist.some((o) => /pending|open|transit/i.test(String(o.status || o.orderStatus || '')));
    fills = parseFills(olist, {
      isFilled: (o) => String(o.status) === '2' || /traded|filled|complete/i.test(String(o.status || '')),
      side: (o) => (o.side === 1 ? 'BUY' : o.side === -1 ? 'SELL' : o.side), sym: (o) => o.symbol,
      qty: (o) => o.qty ?? o.filledQty, price: (o) => o.tradedPrice ?? o.limitPrice,
      time: (o) => o.orderDateTime, id: (o) => o.id,
    });
  }
  return { net, realised, mtm, pending, fills };
}

// Pull the ACTIVE brokers concurrently. Returns { byBroker, bySleeve:{S01,S02},
// net, pending } — brokers that returned null are omitted from byBroker and
// excluded from the totals (skipped, never zeroed).
const SLEEVE = { dhan: 'S01', upstox: 'S02', fyers: 'S02' };
// Fyers is PARKED (2026-06-25): its unattended login is dead — Cloudflare silently
// blocks the send-OTP API (api-t2 vagator/send_login_otp_v3 → net::ERR_FAILED) for
// automated browsers, and SEBI disabled the refresh-token API, so there's no headless
// way to mint a token. Flip enabled:true (and re-enable the FyersDailyLogin task) when
// it's solvable, or after a manual mint (mcp/fyers/exchange-code.py).
const BROKERS = [
  { name: 'dhan', pull: dhan, enabled: true },
  { name: 'upstox', pull: upstox, enabled: true },
  { name: 'fyers', pull: fyers, enabled: false },
];
export async function pullPositions({ withOrders = true } = {}) {
  const active = BROKERS.filter((b) => b.enabled);
  const results = await Promise.all(active.map((b) => b.pull(withOrders)));
  const byBroker = {}, bySleeve = { S01: 0, S02: 0 }, fills = [];
  let net = 0, realised = 0, mtm = 0, pending = false, any = false;
  results.forEach((r, i) => {
    if (!r) return;
    any = true;
    const name = active[i].name;
    byBroker[name] = round(r.net);
    bySleeve[SLEEVE[name]] += r.net;
    net += r.net; realised += num(r.realised); mtm += num(r.mtm);
    pending = pending || !!r.pending;
    if (Array.isArray(r.fills)) for (const f of r.fills) fills.push({ ...f, broker: name });
  });
  return { any, byBroker, bySleeve, net: round(net), realised: round(realised), mtm: round(mtm), pending, fills };
}
