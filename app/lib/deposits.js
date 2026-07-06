// Shared, pure dated deposit ledger — net capital deployed across ALL sleeves. Both the
// client projection (deriveProjInputs) and the server Growth route consume this, so the
// "what counts as a deposit and its sign" logic lives in ONE place and can't drift (the
// two used to fork — the route omitted the Indian swing-exits term).
//
// Returns [{ date, amt }] in ₹, sorted ascending; `amt` is signed (negative on a
// net-withdrawal date). Pass the hydrated arrays — client: the portfolio.js module
// exports; server: the loadPortfolio() object. `fx` converts US flows to ₹; `indianExits`
// is the committed swing-trade ledger ({ trades: [[entry, exit, buy, sell], …] }).
//
// FD flows mirror portfolio.js fdFlows()/fdRedemptions() EXACTLY (open at newMoney/
// principal; redemption at payout/principal when closed, at the quarterly-compounded
// maturity value when an active FD has matured) so deriveProjInputs is unchanged.

const fdMaturityValue = (f) => {
  const yrs = (new Date(f.matures) - new Date(f.open)) / (365.25 * 24 * 3600 * 1000);
  return f.principal * Math.pow(1 + f.rate / 400, 4 * yrs);
};

// US net BUYS per date from the Vested tradebook (us_trades.json: {flows, other}).
// Buy = +USD, Sell = −USD; same-day/all-symbol summed. This is the US analogue of
// the Indian TRANSACTIONS buy line: the US sleeve is measured on ACTUAL SECURITIES
// BOUGHT (cost basis), NOT account deposits — so idle cash + funding transfers
// (the old US_CASHFLOWS/Transfers basis) don't dilute the deployed/return figures.
// A net-sell date is a withdrawal (invested < 0), mirroring Indian sells. Returns
// [{date, invested}] (USD, signed), sorted ascending; [] if no tradebook.
export function usBuyLedger(usTrades) {
  const t = usTrades || {};
  const byDate = {};
  const add = ([date, usd]) => { if (date && usd) byDate[date] = (byDate[date] || 0) + usd; };
  for (const arr of Object.values(t.flows || {})) for (const pt of arr) add(pt);
  for (const pt of (t.other || [])) add(pt);
  return Object.keys(byDate)
    .map((date) => ({ date, invested: Math.round(byDate[date] * 100) / 100 }))
    .filter((c) => c.invested !== 0)
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

export function buildDepositLedger(
  { TRANSACTIONS = [], MF_CASHFLOWS = [], usTrades = null, FDS = [], indianExits = null } = {},
  fx,
  now = new Date(),
) {
  const rate = fx || 88;
  const out = [];
  const push = (date, amt) => { if (date && Number.isFinite(amt) && amt !== 0) out.push({ date, amt }); };

  for (const t of TRANSACTIONS) push(t.date, t.invested);
  for (const c of MF_CASHFLOWS) push(c.date, -(c.amount || 0));        // amount < 0 = money in
  for (const c of usBuyLedger(usTrades)) push(c.date, (c.invested || 0) * rate);  // US = net buys (cost basis), not deposits
  for (const f of FDS) {
    if (f.status !== 'pipeline') push(f.open, f.newMoney ?? f.principal);
    if (f.status === 'closed' && f.closedOn) push(f.closedOn, -(f.payout ?? f.principal));
    else if (f.status === 'active' && f.matures && new Date(f.matures) <= now) push(f.matures, -Math.round(fdMaturityValue(f)));
  }
  // Indian swing trades: [entryDate, exitDate, buy, sell] — buy deployed on entry (+),
  // proceeds returned on exit (−). Separate book from TRANSACTIONS, so no double-count.
  if (indianExits && Array.isArray(indianExits.trades)) {
    for (const [entry, exit, buy, sell] of indianExits.trades) {
      push(entry, buy);
      push(exit, -(sell || 0));
    }
  }

  out.sort((a, b) => (a.date < b.date ? -1 : 1));
  return out;
}
