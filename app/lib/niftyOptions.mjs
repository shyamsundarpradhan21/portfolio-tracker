// Options-positioning read for the Nifty 50 Overview, mapped from an NSE
// option-chain payload (/api/option-chain-indices?symbol=NIFTY). Pure so it can be
// unit-tested and reused by BOTH the laptop capture (residential IP reaches NSE)
// and the serving route's best-effort live try — the two produce the identical
// shape, so a committed/KV snapshot and a live pull are drop-in interchangeable
// (same discipline as wrapIndices).
//
//   { pcr, atmIV, maxPain, atmStrike, expiryDate, expiryInDays,
//     underlying, asOf, source }
//
// Everything is derived from the NEAREST expiry. Returns null when nothing usable
// resolves, so the caller renders an honest "unavailable" rather than a fabricated
// reading. Direction/colour is a render concern; these are raw magnitudes.

const r2 = (n) => (n == null || !isFinite(+n) ? null : Math.round(+n * 100) / 100);
const MON = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

// NSE date "31-Jul-2026" -> UTC-midnight ms (so day-diffs are calendar days, not
// affected by the local clock). Returns null on an unparseable string.
export function parseNseDate(s) {
  const m = /^(\d{1,2})-([A-Za-z]{3})-(\d{4})$/.exec(String(s || '').trim());
  if (!m) return null;
  const mon = MON[m[2].toLowerCase()];
  if (mon == null) return null;
  return Date.UTC(+m[3], mon, +m[1]);
}

// Whole-day count from `todayISO` (YYYY-MM-DD) to an NSE expiry date. 0 = expires
// today, 1 = tomorrow. Null when either date won't parse.
export function expiryInDays(expiryStr, todayISO) {
  const exp = parseNseDate(expiryStr);
  const t = Date.parse(`${String(todayISO || '').slice(0, 10)}T00:00:00Z`);
  if (exp == null || !isFinite(t)) return null;
  return Math.round((exp - t) / 86400000);
}

// Max pain: the expiry price that minimises total intrinsic value writers must
// pay. For a candidate strike K, pain = Σ_{k<K} CE_OI(k)·(K−k) + Σ_{k>K} PE_OI(k)·(k−K).
// Argmin over the chain's own strikes. Null when OI is entirely absent.
function maxPainStrike(rows) {
  const strikes = rows.map((r) => r.strike);
  let best = null, bestPain = Infinity, any = false;
  for (const K of strikes) {
    let pain = 0;
    for (const r of rows) {
      if (r.strike < K && r.ceOI) { pain += r.ceOI * (K - r.strike); any = true; }
      else if (r.strike > K && r.peOI) { pain += r.peOI * (r.strike - K); any = true; }
    }
    if (pain < bestPain) { bestPain = pain; best = K; }
  }
  return any ? best : null;
}

/**
 * NSE option-chain JSON -> Nifty options read for the NEAREST expiry.
 * @param {object} json    /api/option-chain-indices response
 * @param {string} todayISO 'YYYY-MM-DD' — injected so expiry-in is deterministic/testable
 */
export function mapOptionChain(json, todayISO) {
  const rec = json?.records;
  const data = rec?.data;
  if (!Array.isArray(data) || !data.length) return null;

  // Nearest expiry: the first listed, else the earliest that appears in the data.
  const nearest = rec.expiryDates?.[0]
    || [...new Set(data.map((d) => d?.expiryDate).filter(Boolean))]
      .sort((a, b) => (parseNseDate(a) ?? Infinity) - (parseNseDate(b) ?? Infinity))[0];
  if (!nearest) return null;

  const rows = data
    .filter((d) => d && d.expiryDate === nearest && isFinite(+d.strikePrice))
    .map((d) => ({
      strike: +d.strikePrice,
      ceOI: +(d.CE?.openInterest ?? 0) || 0,
      peOI: +(d.PE?.openInterest ?? 0) || 0,
      ceIV: +(d.CE?.impliedVolatility ?? 0) || 0,
      peIV: +(d.PE?.impliedVolatility ?? 0) || 0,
    }))
    .sort((a, b) => a.strike - b.strike);
  if (!rows.length) return null;

  const sumCE = rows.reduce((a, r) => a + r.ceOI, 0);
  const sumPE = rows.reduce((a, r) => a + r.peOI, 0);
  const pcr = sumCE ? r2(sumPE / sumCE) : null;

  const underlying = r2(rec.underlyingValue);
  // ATM = strike nearest the underlying; its IV = mean of the CE/PE IVs present.
  let atmStrike = null, atmIV = null;
  if (isFinite(+rec.underlyingValue)) {
    const u = +rec.underlyingValue;
    const atm = rows.reduce((best, r) => (Math.abs(r.strike - u) < Math.abs(best.strike - u) ? r : best), rows[0]);
    atmStrike = atm.strike;
    const ivs = [atm.ceIV, atm.peIV].filter((v) => v > 0);
    atmIV = ivs.length ? r2(ivs.reduce((a, b) => a + b, 0) / ivs.length) : null;
  }

  const maxPain = maxPainStrike(rows);

  // Nothing meaningful resolved -> let the caller fall back / hide the block.
  if (pcr == null && atmIV == null && maxPain == null) return null;

  return {
    pcr,
    atmIV,
    maxPain,
    atmStrike,
    expiryDate: nearest,
    expiryInDays: expiryInDays(nearest, todayISO),
    underlying,
    asOf: rec.timestamp || null,
    source: 'NSE option chain',
  };
}
