// Private portfolio data — served at runtime so it never ships in the client
// bundle. Deployed app reads Vercel KV (key `portfolio:v1`, seeded by
// scripts/seed-portfolio-kv.mjs); local dev falls back to the gitignored
// data/portfolio.private.json. Mirrors the KV creds + raw-REST pattern used by
// app/api/premarket/route.js. Never cached (private).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

export const dynamic = 'force-dynamic';

const KEY = 'portfolio:v1';

function kvCreds() {
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

async function fromKV() {
  const creds = kvCreds();
  if (!creds) return null;
  try {
    const r = await fetch(creds.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', KEY]),
      cache: 'no-store',
    });
    const j = await r.json();
    return j?.result ? JSON.parse(j.result) : null;
  } catch {
    return null;
  }
}

async function fromFile() {
  try {
    const txt = await readFile(join(process.cwd(), 'data', 'portfolio.private.json'), 'utf8');
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export async function GET() {
  const data = (await fromKV()) || (await fromFile());
  if (!data) {
    return Response.json({ error: 'portfolio data unavailable (KV unseeded + no local file)' }, { status: 503 });
  }
  return new Response(JSON.stringify(data), {
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
