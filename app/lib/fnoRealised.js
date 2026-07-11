// Gap-fill the displayed F&O realised ledger with the NOTE-DERIVED realised (KV `ledger:fno:realised`,
// per-contract FIFO over the durable contract notes — scripts/derive-fno-realised.mjs). This is the
// laptop-off resilience path: realised the broker never captured (it wipes `realizedProfit` at next
// pre-open) is recovered from the notes it can't lose.
//
// ADDITIVE and SAFE — it NEVER overrides a broker-captured row (the broker is authoritative when it
// ran). It only:
//   (a) fills a genuine GAP — a (broker,date) the ledger has no row for → a new note-sourced row, or
//   (b) UPGRADES a charge-only "opening-only" day (added by applyFnoOverlay) into a full realised day.
// Apply AFTER applyFnoOverlay so real charges are already on the rows (opening-only days exist to upgrade).
//
// Scoped to dates >= NOTE_REALISED_FROM, where the note reconstruction is VERIFIED complete (FY26-27
// reconciles to within ₹114 of the broker). The fragmented pre-2026 history (Dhan-2024 split-row
// notes) is left to the broker rows until the 2024-25 Dhan CSV backfill lands (tasks/todo.md), after
// which this cutover can drop.
const r2 = (n) => Math.round(n * 100) / 100;
const SLEEVE = { Dhan: 'S01', Zerodha: 'S01', Upstox: 'S02', Fyers: 'S02' };

// FY26-27 start — note-FIFO verified complete from here; pre-cutover is the fragmented zone (CSV pending).
export const NOTE_REALISED_FROM = '2026-04-01';

export function applyFnoRealised(ledger, noteRealised, from = NOTE_REALISED_FROM) {
  if (!ledger || !ledger.rows || !noteRealised || !Array.isArray(noteRealised.rows)) return ledger;
  const rows = ledger.rows.map((r) => ({ ...r }));
  const byKey = new Map(rows.map((r) => [`${r.broker}|${r.date}`, r]));
  let added = 0, upgraded = 0;
  for (const nr of noteRealised.rows) {
    if (!nr || !nr.date || nr.date < from) continue;      // pre-cutover: leave to the broker rows
    const gross = Number(nr.grossRealised) || 0;
    const key = `${nr.broker}|${nr.date}`;
    const ex = byKey.get(key);
    if (!ex) {                                             // genuine gap → add a note-sourced row (charges unknown)
      const row = { date: nr.date, broker: nr.broker, sleeve: SLEEVE[nr.broker] || null,
        grossRealised: r2(gross), estCharges: 0, realCharge: 0, chargeSource: 'est',
        net: r2(gross), source: 'note-fifo' };
      rows.push(row); byKey.set(key, row); added++;
    } else if (ex.openingOnly) {                           // charge-only day → upgrade to a full realised day (keep the real charge)
      const charge = ex.chargeSource === 'real' ? (ex.realCharge || 0) : (ex.estCharges || 0);
      ex.grossRealised = r2(gross);
      ex.net = r2(gross - charge);
      ex.source = 'note-fifo';
      delete ex.openingOnly;
      upgraded++;
    }                                                      // else: a broker-captured row → broker wins, leave it
  }
  if (!added && !upgraded) return ledger;                  // no gaps → identical to the input (graceful)
  rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { ...ledger, rows, _noteRealisedApplied: { added, upgraded } };
}
