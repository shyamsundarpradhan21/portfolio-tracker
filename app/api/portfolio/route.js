// Private portfolio data — served at runtime so it never ships in the client
// bundle. Deployed app reads Vercel KV (key `portfolio:v1`, seeded by
// scripts/seed-portfolio-kv.mjs); local dev falls back to the gitignored
// data/portfolio.private.json. Never cached (private).

import { loadPortfolio } from '../../lib/serverPortfolio';
// Committed app JSONs are server-imported here (server bundle only) and served to
// the client, so they no longer ship in the client JS bundle. They stay committed
// (the sync pipeline writes broker-state/fno-ledger); freshness tracks redeploys
// exactly as before. Non-personal market-wrap.json stays a normal client import.
import fySeed from '../../../data/fno-verified.json';
import brokerTax from '../../../data/broker-tax.json';
import fnoLedger from '../../../data/fno-ledger.json';
import fnoIntraday from '../../../data/fno-intraday.json';
import eqIntraday from '../../../data/eq-intraday.json';
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
  const payload = {
    ...data,
    _app: { fySeed, fnoLedger, fnoIntraday, eqIntraday, volPnl, brokerState, usTrades, indianExits, snapSleeves, snapMd, fnoRealized: brokerTax.fno_realized },
  };
  return new Response(JSON.stringify(payload), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
