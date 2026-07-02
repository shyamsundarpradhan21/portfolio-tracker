// Lazy-loaded monthly algo DECISION + review for the Trading → Review sub-tab. Reads the
// precomputed artifact (KV `algo-monthly:latest`, built by scripts/build-monthly-reco.mjs)
// + the latest local review (scripts/review-monthly.mjs). The frontend re-runs only the
// LIGHT client allocator (app/lib/algoAllocate.mjs) on the artifact's precomputed candidates
// when the capital input changes — the heavy screen never runs at render.
//
// Private (reveals the held basket) → served at request time, never in the client bundle;
// protected at the edge exactly like /api/algo-screen. No sibling self-fetch — the loaders
// read KV + the local file directly (see tasks/feedback.md on server-side self-fetch).

import { loadAlgoMonthly, loadAlgoReview } from '../../lib/serverPortfolio';

export const dynamic = 'force-dynamic';

export async function GET() {
  const [reco, review] = await Promise.all([loadAlgoMonthly(), loadAlgoReview()]);
  return new Response(JSON.stringify({ reco, review }), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
