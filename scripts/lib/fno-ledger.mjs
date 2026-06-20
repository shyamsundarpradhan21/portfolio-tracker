// Durable, append-only realised-F&O ledger. Broker positions/trades reset at the
// next trading day's pre-open, so the ONLY way to build a durable realised-P&L
// history is to capture each day's realised F&O P&L (net of modeled charges) and
// pile it up. data/fno-ledger.json then drives app/page.js's current-FY F&O
// blocks — no more hand-editing fy2526_verified.json mid-year. The annual ITR
// ritual is the only manual touch: it replaces the just-closed FY's estimated
// rows with the verified gross/charges/net and rolls the carryforward.
//
// One row per (date, broker). Upsert semantics — re-running a sync the same day
// REPLACES that day's row with the latest, fuller number (intraday realised can
// grow as more round-trips close), so the final evening capture wins.

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const LEDGER = join(ROOT, 'data', 'fno-ledger.json');
const nowIst = () => new Date(Date.now() + 5.5 * 3600 * 1000).toISOString().replace(/\.\d+Z$/, '+05:30');

// rows: [{ date 'YYYY-MM-DD', broker, sleeve 'S01'|'S02', grossRealised, estCharges,
//          net, turnover, orders, source 'positions'|'fills' }]
// Skips rows with no F&O activity (grossRealised 0 AND turnover 0) so flat days
// don't pollute the ledger. Returns { added, updated }.
export function appendLedger(rows) {
  let led;
  try { led = JSON.parse(readFileSync(LEDGER, 'utf8')); } catch { led = { rows: [] }; }
  if (!Array.isArray(led.rows)) led.rows = [];

  const idx = new Map(led.rows.map((r, i) => [`${r.date}:${r.broker}`, i]));
  let added = 0, updated = 0;
  for (const r of rows || []) {
    if (!r || !r.date || !r.broker) continue;
    if (!r.grossRealised && !r.turnover) continue; // no F&O activity that day
    const key = `${r.date}:${r.broker}`;
    const row = {
      date: r.date, broker: r.broker, sleeve: r.sleeve,
      grossRealised: round2(r.grossRealised), estCharges: round2(r.estCharges),
      net: round2((r.grossRealised || 0) - (r.estCharges || 0)),
      turnover: round2(r.turnover), orders: r.orders ?? null, source: r.source || 'positions',
    };
    if (idx.has(key)) {
      const i = idx.get(key);
      // Upsert only if something actually changed — keeps writes/commits quiet.
      if (JSON.stringify(led.rows[i]) !== JSON.stringify(row)) { led.rows[i] = row; updated++; }
    } else {
      led.rows.push(row); idx.set(key, led.rows.length - 1); added++;
    }
  }
  if (added || updated) {
    led.rows.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.broker < b.broker ? -1 : 1));
    led.updatedAt = nowIst();
    writeFileSync(LEDGER, JSON.stringify(led, null, 2) + '\n');
  }
  return { added, updated };
}

const round2 = (n) => (n == null ? null : Math.round(n * 100) / 100);
