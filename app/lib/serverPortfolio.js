// Server-side loader for the private portfolio data — used by API routes that
// need it at request time (they can't rely on the client-side hydration of
// app/portfolio.js, whose exports are empty on the server). Reads Vercel KV
// (`portfolio:v1`) with a local-dev fallback to the gitignored JSON. Same source
// the /api/portfolio route serves to the client.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

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

// Returns the private-data object, or null if neither source is available.
export async function loadPortfolio() {
  return (await fromKV()) || (await fromFile());
}
