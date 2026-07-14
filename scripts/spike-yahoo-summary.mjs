// P0 spike (run on the laptop): proves Yahoo's crumb-gated quoteSummary actually returns the
// modules the stock-detail panel needs, from THIS machine's network, for both an Indian and a
// US symbol. It runs the exact shared lib the /api/stock route will use.
//
//   node scripts/spike-yahoo-summary.mjs            # NVDA + RELIANCE.NS
//   node scripts/spike-yahoo-summary.mjs AAPL TCS.NS
//
// PASS = every symbol prints a price + a filled key-stats block + a non-empty income series.
// If the crumb handshake fails here, the LIVE route will fail the same way → fall back to the
// committed *-fundamentals.json (that's the next build step).

import { fetchStockSummary, normalizeStock } from '../app/lib/yahooSummary.mjs';

const symbols = process.argv.slice(2);
const TARGETS = symbols.length ? symbols : ['NVDA', 'RELIANCE.NS'];

const show = (label, v) => console.log(`   ${label.padEnd(22)} ${v == null ? '— (missing)' : v}`);

for (const sym of TARGETS) {
  console.log(`\n══ ${sym} ══`);
  try {
    const raw = await fetchStockSummary(sym);
    const s = normalizeStock(raw, sym);
    console.log(` modules returned: ${Object.keys(raw).join(', ')}`);
    show('name / exch', `${s.name} · ${s.exchange || '—'} · ${s.sector || '—'}`);
    show('price / chg%', `${s.currency || ''}${s.price} (${s.changePct == null ? '—' : s.changePct.toFixed(2) + '%'}) · ${s.marketState || '—'}`);
    show("day / 52wk range", `${s.dayLow}–${s.dayHigh}  |  ${s.week52Low}–${s.week52High}`);
    show('next earnings', s.nextEarnings);
    show('volume / avg30', `${s.volume} / ${s.avgVolume30}`);
    show('market cap', s.marketCapFmt || s.marketCap);
    show('P/E (TTM)', s.peTTM);
    show('basic EPS (TTM)', s.basicEpsTTM);
    show('shares float', s.sharesFloatFmt || s.sharesFloat);
    show('beta', s.beta);
    show('div yield ind/TTM', `${s.dividendYieldIndicated} / ${s.dividendYieldTTM}`);
    show('payout ratio', s.payoutRatio);
    show('ex-div / pay date', `${s.exDividendDate} / ${s.dividendPayDate}`);
    show('income (annual)', s.incomeAnnual.length
      ? s.incomeAnnual.map((r) => `${r.date}:rev=${r.revenue},ni=${r.netIncome},m=${r.netMargin}%`).join(' | ')
      : null);
    show('income (quarterly)', s.incomeQuarterly.length ? `${s.incomeQuarterly.length} periods` : null);
    // one-line verdict
    const ok = s.price != null && s.peTTM != null && s.incomeAnnual.length > 0;
    console.log(` VERDICT: ${ok ? 'PASS ✓' : 'PARTIAL — some fields missing (see above)'}`);
  } catch (e) {
    console.log(` FAIL: ${e.message}`);
    console.log(' → the live route would need the committed-fundamentals fallback for this symbol.');
  }
}
console.log('');
