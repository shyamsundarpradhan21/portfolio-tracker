// Pure mappers for the live Market Wrap index feed. Kept OUT of the route so they
// can be unit-tested without a network round-trip. The output matches the shape
// data/market-wrap.json already uses, so MacroTab renders the live feed and the
// committed Kite EOD snapshot identically:
//
//   { nifty:{last,prevClose,pct},
//     vix:{last,prevClose,change,pct,high,low},
//     sectors:[{name,pct}], breadth:[{name,pct}],
//     asOf, source }
//
// Field access is deliberately tolerant (alternate keys / casing) so a minor NSE
// API shape drift degrades to honest blanks rather than a silently wrong number.

const r2 = (n) => (n == null || !isFinite(+n) ? null : Math.round(+n * 100) / 100);

// NSE allIndices `index` name -> the display name the wrap already uses. Mirrors
// scripts/merge-market.mjs exactly, so the live feed and the Kite snapshot are
// drop-in interchangeable.
export const NSE_SECTORS = {
  'NIFTY IT': 'IT',
  'NIFTY BANK': 'Bank',
  'NIFTY AUTO': 'Auto',
  'NIFTY PHARMA': 'Pharma',
  'NIFTY FMCG': 'FMCG',
  'NIFTY METAL': 'Metal',
  'NIFTY ENERGY': 'Energy',
  'NIFTY FINANCIAL SERVICES': 'Fin Services',
  'NIFTY REALTY': 'Realty',
  'NIFTY PSU BANK': 'PSU Bank',
};
export const NSE_BREADTH = {
  'NIFTY 50': 'Nifty 50',
  'NIFTY NEXT 50': 'Next 50',
  'NIFTY 500': 'Nifty 500',
  'NIFTY MIDCAP 100': 'Midcap 100',
  'NIFTY SMALLCAP 100': 'Smallcap 100',
};

const rowPct = (row) => r2(row?.percentChange ?? row?.pChange ?? row?.percentchange ?? row?.perChange);
const rowLast = (row) => r2(row?.last ?? row?.lastPrice ?? row?.ltp);
const rowPrev = (row) => r2(row?.previousClose ?? row?.prevClose ?? row?.previousclose);
const rowHigh = (row) => r2(row?.high ?? row?.dayHigh ?? row?.intraDayHighLow?.max);
const rowLow = (row) => r2(row?.low ?? row?.dayLow ?? row?.intraDayHighLow?.min);
// NSE rows carry constituent advances/declines/unchanged (real breadth, vs the
// index's own % move). Values can be numeric or comma-strings.
const toInt = (v) => { if (v == null) return null; const n = parseInt(String(v).replace(/,/g, ''), 10); return isFinite(n) ? n : null; };
const rowAdv = (row) => toInt(row?.advances ?? row?.advance);
const rowDec = (row) => toInt(row?.declines ?? row?.decline);
const rowUnch = (row) => toInt(row?.unchanged ?? row?.unchange);

// NSE timestamp ("19-Jun-2026 17:35:04") -> ISO when parseable, else the raw string.
function nseAsOf(ts) {
  if (!ts) return null;
  const d = new Date(ts);
  return isFinite(+d) ? d.toISOString() : String(ts);
}

// Index lookup from the allIndices `data` array, keyed by the trimmed/upper-cased
// `index` name so the maps resolve regardless of incidental spacing or casing.
function indexByName(data) {
  const by = {};
  for (const row of Array.isArray(data) ? data : []) {
    const name = String(row?.index ?? row?.indexSymbol ?? '').trim().toUpperCase();
    if (name) by[name] = row;
  }
  return by;
}

// Real market breadth from constituent advances/declines (NOT index % move, which
// the ticker already shows). A/D ratio + % advancing for Nifty 500, plus % advancing
// per cap tier (large/mid/small) to show where participation sits. Null when NSE
// doesn't carry the A/D fields (then the UI shows breadth as unavailable).
export function buildBreadthAD(by) {
  const ad = (name) => {
    const r = by[name];
    if (!r) return null;
    const a = rowAdv(r), d = rowDec(r);
    return a == null || d == null ? null : { a, d, u: rowUnch(r) };
  };
  const pctUp = (x) => (x && x.a + x.d > 0 ? Math.round((x.a / (x.a + x.d)) * 100) : null);
  const tiers = [['Nifty 50', 'NIFTY 50'], ['Midcap 100', 'NIFTY MIDCAP 100'], ['Smallcap 100', 'NIFTY SMALLCAP 100']];
  const caps = tiers
    .map(([name, key]) => { const x = ad(key); const p = pctUp(x); return p == null ? null : { name, pctUp: p }; })
    .filter(Boolean);
  const n500 = ad('NIFTY 500');
  if (!n500 && !caps.length) return null;
  const out = { caps };
  if (n500) {
    out.adv = n500.a; out.dec = n500.d; out.unch = n500.u;
    out.ratio = n500.d ? Math.round((n500.a / n500.d) * 100) / 100 : null;
    out.pctUp = pctUp(n500);
  }
  return out;
}

/**
 * NSE /api/allIndices JSON -> wrap shape. Returns null when nothing usable
 * resolved, so the caller can fall through (Yahoo, then the committed snapshot).
 */
export function mapAllIndices(json) {
  const data = json?.data ?? json;
  const by = indexByName(data);
  if (!Object.keys(by).length) return null;

  const pick = (dict) =>
    Object.entries(dict)
      .map(([nseName, label]) => {
        const row = by[nseName.toUpperCase()];
        return row ? { name: label, pct: rowPct(row) } : null;
      })
      .filter((s) => s && s.pct != null);

  const sectors = pick(NSE_SECTORS).sort((a, b) => a.pct - b.pct); // worst first (red on top)
  const breadth = pick(NSE_BREADTH);

  const nRow = by['NIFTY 50'];
  const nifty = nRow ? { last: rowLast(nRow), prevClose: rowPrev(nRow), pct: rowPct(nRow) } : null;

  const vRow = by['INDIA VIX'];
  const vix = vRow
    ? {
        last: rowLast(vRow),
        prevClose: rowPrev(vRow),
        change: r2(
          vRow.variation ??
            (rowLast(vRow) != null && rowPrev(vRow) != null ? rowLast(vRow) - rowPrev(vRow) : null),
        ),
        pct: rowPct(vRow),
        high: rowHigh(vRow),
        low: rowLow(vRow),
      }
    : null;

  // Nothing meaningful resolved -> let the caller fall back.
  if (!sectors.length && !breadth.length && !vix && !nifty) return null;

  return { nifty, vix, sectors, breadth, breadthAD: buildBreadthAD(by), asOf: nseAsOf(json?.timestamp), source: 'NSE allIndices (live)' };
}

// Yahoo symbols for the NSE indices Yahoo actually carries — the fallback when NSE
// blocks the datacenter IP. Breadth beyond the broad indices is patchy on Yahoo, so
// we list only what's reasonably reliable and leave the rest honestly blank.
export const YH_SECTORS = [
  { sym: '^CNXIT', name: 'IT' },
  { sym: '^NSEBANK', name: 'Bank' },
  { sym: '^CNXAUTO', name: 'Auto' },
  { sym: '^CNXPHARMA', name: 'Pharma' },
  { sym: '^CNXFMCG', name: 'FMCG' },
  { sym: '^CNXMETAL', name: 'Metal' },
  { sym: '^CNXENERGY', name: 'Energy' },
  { sym: '^CNXFIN', name: 'Fin Services' },
  { sym: '^CNXREALTY', name: 'Realty' },
  { sym: '^CNXPSUBANK', name: 'PSU Bank' },
];
export const YH_BREADTH = [
  { sym: '^NSEI', name: 'Nifty 50' },
  { sym: '^CRSLDX', name: 'Nifty 500' },
];

// Every Yahoo symbol mapYahooIndices() looks up — the route fetches exactly these,
// then hands the lookup function in.
export const YH_INDEX_SYMS = [...new Set([
  '^INDIAVIX', '^NSEI',
  ...YH_SECTORS.map((e) => e.sym),
  ...YH_BREADTH.map((e) => e.sym),
])];

/**
 * Assemble the wrap shape from already-fetched Yahoo quotes. `quoteFor(sym)` returns
 * a live quote `{ price, prev, change, pct, asOf }` or a falsy/`{stale}` value. Pure
 * (no fetching) so it's unit-testable; the route supplies the fetcher.
 */
export function mapYahooIndices(quoteFor) {
  const live = (sym) => {
    const q = quoteFor(sym);
    return q && !q.stale && q.pct != null && isFinite(q.pct) ? q : null;
  };
  const rows = (list) =>
    list.map((e) => { const q = live(e.sym); return q ? { name: e.name, pct: r2(q.pct) } : null; }).filter(Boolean);

  const sectors = rows(YH_SECTORS).sort((a, b) => a.pct - b.pct);
  const breadth = rows(YH_BREADTH);

  const vq = live('^INDIAVIX');
  const vix = vq ? { last: r2(vq.price), prevClose: r2(vq.prev), change: r2(vq.change), pct: r2(vq.pct), high: null, low: null } : null;
  const nq = live('^NSEI');
  const nifty = nq ? { last: r2(nq.price), prevClose: r2(nq.prev), pct: r2(nq.pct) } : null;

  if (!sectors.length && !breadth.length && !vix && !nifty) return null;

  return {
    nifty,
    vix,
    sectors,
    breadth,
    asOf: (vq && vq.asOf) || (nq && nq.asOf) || new Date().toISOString(),
    source: 'Yahoo NSE indices (fallback)',
  };
}
