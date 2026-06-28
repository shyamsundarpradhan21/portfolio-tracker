// Phase 2c Part 2: apply the dormant KV charge overlay (ledger:fno:overlay) onto the committed
// fno-ledger base at request time. The committed data/fno-ledger.json stays the base; the overlay
// (real NCLFO charges parsed from contract notes, by Broker|date, self-only) overrides estCharges
// where present, appends opening-only-day charges, and recomputes net. GRACEFUL: a missing/empty
// overlay returns the ledger unchanged (current behaviour) so the route never breaks.
const r2 = (n) => Math.round(n * 100) / 100;

export function applyFnoOverlay(ledger, overlay) {
  if (!ledger || !ledger.rows || !overlay || !overlay.byKey) return ledger;
  const rows = ledger.rows.map((row) => {
    const o = overlay.byKey[`${row.broker}|${row.date}`];
    if (o) {                                   // real override: net = gross - realCharge
      return { ...row, realCharge: o.realCharge, chargeSource: 'real', net: r2((row.grossRealised || 0) - o.realCharge) };
    }
    return { ...row, chargeSource: 'est' };    // est fallback (gap / refused / old-format) - estimate kept
  });
  for (const e of overlay.openingOnly || []) { // charges incurred on a day with no realised-P&L row
    rows.push({ date: e.date, broker: e.broker, sleeve: e.sleeve, grossRealised: 0, estCharges: 0,
                realCharge: e.realCharge, chargeSource: 'real', net: r2(-e.realCharge), openingOnly: true, source: 'contract-note' });
  }
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...ledger, rows, _overlayApplied: true };
}
