// Durable, append-only tradebook. Broker APIs only return TODAY's trades (Kite's
// get_trades, etc. reset daily), so the only way to build real cashflow history is
// to capture today's fills every sync and pile them up. data/trades-log.json then
// becomes the source the XIRR ledger can be derived from — no more hand-entering
// buy dates. Append-only + deduped, so re-running a sync the same day is a no-op.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LOG = join(ROOT, 'data', 'trades-log.json');
const nowIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, '+05:30');

// records: [{ id, sym, date, side, qty, price, value }] for one broker.
// Returns how many NEW trades were added (deduped by broker + id).
export function appendTrades(broker, records) {
  let log;
  try { log = JSON.parse(readFileSync(LOG, 'utf8')); } catch { log = { trades: [] }; }
  if (!Array.isArray(log.trades)) log.trades = [];

  const seen = new Set(log.trades.map((t) => `${t.broker}:${t.id}`));
  let added = 0;
  for (const r of records || []) {
    if (!r) continue;
    // Fall back to a composite id if the broker's trade-id field wasn't mapped,
    // so a field-name miss still captures the trade rather than dropping it.
    const id = r.id ?? `${r.sym}-${r.date}-${r.side}-${r.qty}-${r.price}`;
    const key = `${broker}:${id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    log.trades.push({ broker, id, sym: r.sym, date: r.date, side: r.side, qty: r.qty, price: r.price, value: r.value });
    added++;
  }
  if (added) {
    log.trades.sort((a, b) => (String(a.date) < String(b.date) ? -1 : String(a.date) > String(b.date) ? 1 : 0));
    log.updatedAt = nowIst();
    writeFileSync(LOG, JSON.stringify(log, null, 2) + '\n');
  }
  return added;
}
