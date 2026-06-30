// Lazy-loaded computed algo-screen for the Trading → Review sub-tab. Reads the
// precomputed payload (KV `algo-screen:v1`, built by scripts/build-algo-screen.mjs)
// with a local-dev fallback to the gitignored data/algo-screen.json. The frontend
// NEVER runs the screen at render — it renders this artifact.
//
// Private (reveals the held basket) so it is served at request time and never ships
// in the client bundle; protected at the edge exactly like /api/portfolio (no per-route
// auth exists in this app — Vercel Deployment Protection gates the whole deployment).
// Fetched only when the Review sub-tab opens, so the hot private payload stays lean.

import { loadAlgoScreen } from '../../lib/serverPortfolio';

export const dynamic = 'force-dynamic';

export async function GET() {
  const screen = await loadAlgoScreen();
  if (!screen) {
    return Response.json({ error: 'algo-screen unavailable (KV unseeded + no local file)' }, { status: 503 });
  }
  return new Response(JSON.stringify(screen), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
