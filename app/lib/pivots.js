// Classic (floor) pivot support/resistance for the Nifty 50 Overview S&R rail.
// Deterministic levels laddered around a completed session's High/Low/Close —
// NOT a forecast. Kept pure (no fetch) so the route feeds it a bar and the math
// is unit-tested; the same formula NiftyOverview used to render inline.
//
//   PP = (H + L + C) / 3
//   R1 = 2·PP − L      S1 = 2·PP − H
//   R2 = PP + (H − L)  S2 = PP − (H − L)
//   R3 = H + 2·(PP − L) S3 = L − 2·(H − PP)

const r2 = (n) => (n == null || !isFinite(+n) ? null : Math.round(+n * 100) / 100);
// null/undefined/'' -> NaN (so a missing OHLC field fails the finite check below,
// instead of `+null === 0` sneaking a bogus level through).
const num = (x) => (x == null || x === '' ? NaN : +x);

/**
 * Classic pivot ladder from one session's OHLC. Returns null when H/L/C are not
 * all finite (so the caller renders "unavailable" rather than NaN rungs).
 * @param {{high:number, low:number, close:number, asOf?:string}} bar
 */
export function computePivots(bar) {
  const h = num(bar?.high), l = num(bar?.low), c = num(bar?.close);
  if (![h, l, c].every((x) => isFinite(x))) return null;
  const pp = (h + l + c) / 3;
  const range = h - l;
  return {
    pp: r2(pp),
    r1: r2(2 * pp - l),
    r2: r2(pp + range),
    r3: r2(h + 2 * (pp - l)),
    s1: r2(2 * pp - h),
    s2: r2(pp - range),
    s3: r2(l - 2 * (h - pp)),
    asOf: bar?.asOf || null,
  };
}

/**
 * Pick the session whose OHLC drives the pivots from a list of daily bars
 * (ascending by date). When the market is LIVE the latest bar is the current,
 * partial session — pivots must come from the last COMPLETED session, so we drop
 * it. Pre-open / post-close, the latest bar is already the last completed session.
 * @param {Array<{date?:string,high:number,low:number,close:number}>} bars
 * @param {boolean} live  market currently open (regular session)
 */
export function pivotSourceBar(bars, live) {
  const rows = (Array.isArray(bars) ? bars : []).filter(
    (b) => b && [b.high, b.low, b.close].every((x) => isFinite(num(x))),
  );
  if (!rows.length) return null;
  const idx = live && rows.length >= 2 ? rows.length - 2 : rows.length - 1;
  return rows[idx];
}
