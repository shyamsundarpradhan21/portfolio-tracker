// Private portfolio data — served at runtime so it never ships in the client
// bundle. Deployed app reads Vercel KV (key `portfolio:v1`, seeded by
// scripts/seed-portfolio-kv.mjs); local dev falls back to the gitignored
// data/portfolio.private.json. Never cached (private).

import { loadPortfolio } from '../../lib/serverPortfolio';

export const dynamic = 'force-dynamic';

export async function GET() {
  const data = await loadPortfolio();
  if (!data) {
    return Response.json({ error: 'portfolio data unavailable (KV unseeded + no local file)' }, { status: 503 });
  }
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
