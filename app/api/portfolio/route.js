// Private portfolio data — served at runtime so it never ships in the client
// bundle. Deployed app reads Vercel KV (key `portfolio:v1`, seeded by
// scripts/seed-portfolio-kv.mjs); local dev falls back to the gitignored
// data/portfolio.private.json. Never cached (private).

import { loadPortfolio, loadFnoOverlay, loadFnoRealised, loadEodBook } from '../../lib/serverPortfolio';
import { applyFnoOverlay } from '../../lib/fnoOverlay';
import { applyFnoRealised } from '../../lib/fnoRealised';
// Committed app JSONs are server-imported here (server bundle only) and served to
// the client, so they no longer ship in the client JS bundle. They stay committed
// (the sync pipeline writes broker-state/fno-ledger); freshness tracks redeploys
// exactly as before. Non-personal market-wrap.json stays a normal client import.
import fySeed from '../../../data/fno-verified.json';
import brokerTax from '../../../data/broker-tax.json';
import fnoLedger from '../../../data/fno-ledger.json';
import fnoIntraday from '../../../data/fno-intraday.json';
import eqIntraday from '../../../data/eq-intraday.json';
import usIntraday from '../../../data/us-intraday.json';
import niftyOhlc from '../../../data/nifty-ohlc.json';
import volPnl from '../../../data/vol_pnl.json';
import brokerState from '../../../data/broker-state.json';
import usTrades from '../../../data/us_trades.json';
import indianExits from '../../../data/indian_exits.json';
import snapSleeves from '../../../data/snapshot-sleeves.json';
import snapMd from '../../../data/SNAPSHOT.md';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await loadPortfolio();
  if (!data) {
    return Response.json({ error: 'portfolio data unavailable (KV unseeded + no local file)' }, { status: 503 });
  }
  // Phase 2c: overlay real NCLFO charges (KV ledger:fno:overlay) onto the committed fno-ledger base,
  // THEN gap-fill note-derived realised (KV ledger:fno:realised) for laptop-off days the broker missed.
  // Both graceful: a missing/unreachable key leaves the committed broker rows unchanged. Order matters —
  // charges first so applyFnoRealised can upgrade the opening-only (charge-only) days it creates.
  const [overlay, noteRealised] = await Promise.all([loadFnoOverlay(), loadFnoRealised()]);
  const fnoLedgerReal = applyFnoRealised(applyFnoOverlay(fnoLedger, overlay), noteRealised);
  // eodBook: the durable per-holding close (serving copy). DORMANT — served but not yet
  // consumed by the client (Sub-step B hero close-fallback is held). Graceful null.
  const eodBook = await loadEodBook();
  const payload = {
    ...data,
    _app: { fySeed, fnoLedger: fnoLedgerReal, fnoIntraday, eqIntraday, usIntraday, niftyOhlc, volPnl, brokerState, usTrades, indianExits, snapSleeves, snapMd, fnoRealized: brokerTax.fno_realized, eodBook },
  };
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
