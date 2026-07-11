// Shared per-contract FIFO realised engine for F&O fills.
//
// Books realised on each CLOSING trade at the ORIGINAL entry price (FIFO lot), so carried
// positions are valued correctly — the broker positions-API `realizedProfit` UNDERCOUNTS carries
// (it marks carried legs to the previous settlement; see lib/brokers.mjs `dhanRealised`). This is
// the same algorithm `scripts/backfill-fno-realised.mjs` runs over the Dhan trade-history; here it
// is factored out so it can also be fed from parsed contract notes (`scripts/derive-fno-realised.mjs`),
// which are the durable, laptop-independent source (broker realised is wiped at next pre-open).
//
// Source-agnostic: the caller supplies normalized fills; this module knows nothing about brokers or KV.

const r2 = (n) => Math.round(n * 100) / 100;

// Canonical contract key: uppercased instrument with the exchange suffix and all whitespace
// stripped, so the SAME contract renders the SAME key across notes/brokers.
//   "NIFTY25SEP24650PE - NSE" -> "NIFTY25SEP24650PE"
//   "OPTSTK ANGEL ONE LIMITED 28JUL26 PE 290.00" -> "OPTSTKANGELONELIMITED28JUL26PE290.00"
export const normContractKey = (s) =>
  String(s || '').toUpperCase()
    .replace(/\s*-\s*(NSE|BSE|NFO|BFO|MCX|CDS)\s*$/, '')
    .replace(/\s+/g, '');

// Is `key` a COMPLETE, matchable contract? A real contract carries an expiry token AND a
// FUT/CE/PE tag. The fragmented note rows the parser sometimes emits for split layouts
// ("105 CE", "OPTSTK SHRIRAMFIN", "OPTIDX NIFTY 19Sep2024") fail this and must NOT be FIFO-matched
// (they'd corrupt the book). Callers flag notes containing any incomplete F&O fill.
const EXPIRY = /\d{1,2}[A-Z]{3}\d{2,4}/; // 28MAR24 / 30DEC2025 / 26JUN25 / 19SEP2024
export const isCompleteContract = (key) => EXPIRY.test(key) && /(FUT|CE|PE)/.test(key);

// fifoRealisedByDay(fills) — fills MUST be pre-sorted chronologically (a close can only match an
// earlier open). Each fill: { key, date:'YYYY-MM-DD', side:'BUY'|'SELL'|'B'|'S', qty (any sign;
// magnitude used), price }. Returns:
//   { dayRealised: { 'YYYY-MM-DD': ₹ }, residualLots, openByKey: { key: signedQty } }
// residualLots = total open magnitude left unmatched at the end; a large value means the fill
// history is INCOMPLETE (missing opens/closes) so that stretch's realised is under-booked — the
// honest incompleteness signal (same one backfill-fno-realised's --audit uses).
export function fifoRealisedByDay(fills) {
  const books = {};      // key -> [{ qty (signed: + long / - short), price }]
  const dayRealised = {};
  for (const f of fills) {
    const sign = /^b/i.test(String(f.side)) ? 1 : -1; // BUY / B -> +1, else -1
    const qty = Math.abs(Number(f.qty) || 0);
    const price = Number(f.price) || 0;
    if (!qty) continue;
    const book = (books[f.key] ||= []);
    let rem = qty, realised = 0;
    // close opposite-side FIFO lots at THEIR entry price
    while (rem > 0 && book.length && Math.sign(book[0].qty) !== sign) {
      const lot = book[0], matched = Math.min(rem, Math.abs(lot.qty));
      realised += lot.qty > 0 ? (price - lot.price) * matched   // close a long: exit - entry
                              : (lot.price - price) * matched;   // cover a short: entry - exit
      lot.qty += sign * matched;
      rem -= matched;
      if (lot.qty === 0) book.shift();
    }
    if (rem > 0) book.push({ qty: sign * rem, price }); // remainder opens/extends the position
    if (realised) dayRealised[f.date] = r2((dayRealised[f.date] || 0) + realised);
  }
  const openByKey = {};
  let residualLots = 0;
  for (const k in books) {
    const net = books[k].reduce((a, l) => a + l.qty, 0);
    if (net) openByKey[k] = net;
    residualLots += books[k].reduce((a, l) => a + Math.abs(l.qty), 0);
  }
  return { dayRealised, residualLots, openByKey };
}
