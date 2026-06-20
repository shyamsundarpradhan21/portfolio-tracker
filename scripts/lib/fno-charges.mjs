// Deterministic Indian equity-derivatives (F&O) charges model. The broker API
// gives only GROSS realised P&L (trade-price matched) — never the statutory /
// exchange charges, which live only on the contract note. So to show NET (the
// number that matters) we model charges from turnover + order count. Accurate to
// a few rupees; tagged "est." in the UI; snapped to exact at the annual ITR
// ritual. Every rate is a DATED constant below — when a rate revises, edit one
// line here and the whole ledger follows.
//
// THE #1 TRAP: for options every percentage charge (STT, exchange, stamp, IPFT,
// GST base) is on the PREMIUM value (price × qty), NOT the strike/notional.
// Futures charges are on contract turnover (price × qty). Modeled accordingly.

// ── Rate table — NSE equity derivatives, effective FY2026-27. STT reflects the
//    Apr-2026 budget hike (options sell 0.10→0.15%, futures sell 0.02→0.05%) now
//    in force; NSE txn charges per the Oct-2024 revision. STT is the rate most
//    likely to move in a future budget — keep it here as a single editable line.
//    Verified 2026-06-20 against Zerodha/Dhan live charges pages + NSE/SEBI. ──
export const RATES = {
  asOf: '2026-04-01',
  options: {
    stt:   0.0015,     // 0.15% on SELL premium (Apr-2026 budget; was 0.10%)
    exch:  0.0003553,  // NSE txn charge 0.03553% on premium, both sides
    sebi:  0.000001,   // SEBI turnover fee ₹10/cr = 0.0001%, both sides
    stamp: 0.00003,    // 0.003% on BUY premium
    ipft:  0.0000001,  // NSE IPFT ₹0.01/cr = 0.0000001 on premium, both (micro)
  },
  futures: {
    stt:   0.0005,     // 0.05% on SELL turnover (Apr-2026 budget; was 0.02%)
    exch:  0.0000183,  // NSE txn charge 0.00183% on turnover, both sides
    sebi:  0.000001,   // SEBI turnover fee, both sides
    stamp: 0.00002,    // 0.002% on BUY turnover
    ipft:  0.0000001,  // NSE IPFT ₹0.01/cr, both sides (micro)
  },
  gst: 0.18,           // 18% on (brokerage + exch + sebi) only — not STT/stamp
};

// Per-order F&O brokerage. All three are the flat-₹20-per-executed-order plan
// (or 0.03% capped at ₹20 — the cap binds for any meaningful turnover, so flat
// ₹20 is exact here). Per ORDER, not per fill.
export const BROKERAGE = { Dhan: 20, Upstox: 20, Fyers: 20, Zerodha: 20 };

// Single source of truth for F&O classification (the sync engine imports this too,
// so fills-gating and charge-basis can never drift). Options require a STRIKE DIGIT
// before CE/PE — equity tickers like RELIANCE / JIOFIN end in "CE"/"PE"/"FUT" but
// have no preceding digit, so they're correctly excluded. Also handle the CALL/PUT
// word form some brokers (e.g. Dhan custom symbols) use.
export const segmentOf = (sym) => {
  const s = String(sym || '').toUpperCase();
  if (/\d\s*(CE|PE)$/.test(s) || /(CALL|PUT)$/.test(s)) return 'options';
  if (/\d\s*FUT$/.test(s) || /[A-Z]{3}FUT$/.test(s)) return 'futures';
  return null; // equity / unknown — not an F&O leg, excluded from this model
};
const seg = segmentOf;

// Charges for one broker's F&O fills on one day. fills: [{ sym, side, qty, price,
// value }]. Aggregates buy/sell premium (or turnover) per segment, applies the
// rate table, models brokerage per distinct order (proxy: distinct sym+side, since
// the tradebook gives trade-ids not order-ids — a small, bounded approximation).
// Returns { brokerage, stt, exch, sebi, stamp, ipft, gst, total, turnover, orders }.
export function chargesForFills(broker, fills) {
  const acc = {
    options: { buy: 0, sell: 0 },
    futures: { buy: 0, sell: 0 },
  };
  const orderKeys = new Set();
  for (const f of fills || []) {
    const g = seg(f.sym);
    if (!g) continue;
    const val = f.value != null ? Math.abs(f.value) : Math.abs((f.qty || 0) * (f.price || 0));
    const side = String(f.side || '').toUpperCase().startsWith('S') ? 'sell' : 'buy';
    acc[g][side] += val;
    orderKeys.add(`${f.sym}:${side}`);
  }

  let stt = 0, exch = 0, sebi = 0, stamp = 0, ipft = 0;
  let turnover = 0;
  for (const g of ['options', 'futures']) {
    const r = RATES[g];
    const { buy, sell } = acc[g];
    const t = buy + sell;
    if (!t) continue;
    turnover += t;
    stt   += sell * r.stt;          // sell-side only
    exch  += t * r.exch;            // both sides
    sebi  += t * r.sebi;            // both sides
    stamp += buy * r.stamp;         // buy-side only
    ipft  += t * r.ipft;            // both sides
  }
  const orders = orderKeys.size;
  const brokerage = orders * (BROKERAGE[broker] ?? 20);
  const gst = (brokerage + exch + sebi) * RATES.gst;
  const total = brokerage + stt + exch + sebi + stamp + ipft + gst;
  return {
    brokerage: r2(brokerage), stt: r2(stt), exch: r2(exch), sebi: r2(sebi),
    stamp: r2(stamp), ipft: r2(ipft), gst: r2(gst), total: r2(total),
    turnover: r2(turnover), orders,
  };
}

const r2 = (n) => Math.round(n * 100) / 100;
