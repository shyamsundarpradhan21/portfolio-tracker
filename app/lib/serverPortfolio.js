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

// Phase 2c: the dormant F&O charge overlay (real NCLFO charges, by Broker|date), applied onto the
// committed fno-ledger at request time. Returns null if KV/the key is unreachable -> caller falls
// back to the committed file unchanged (graceful; never breaks /api/portfolio).
export async function loadFnoOverlay() {
  const creds = kvCreds();
  if (!creds) return null;
  try {
    const r = await fetch(creds.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(['GET', 'ledger:fno:overlay']),
      cache: 'no-store',
    });
    const j = await r.json();
    return j?.result ? JSON.parse(j.result) : null;
  } catch {
    return null;
  }
}

// Precomputed algo-screen payload (held names + per-regime metrics + capital tier),
// served lazily by /api/algo-screen only when the Trading→Review sub-tab opens — kept
// OFF the hot /api/portfolio payload. Prod source = KV `algo-screen:v1` (built by
// scripts/build-algo-screen.mjs); local dev falls back to the gitignored JSON. Private
// (reveals the held basket) → same edge protection as the rest of the private data.
export async function loadAlgoScreen() {
  const creds = kvCreds();
  if (creds) {
    try {
      const r = await fetch(creds.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', 'algo-screen:v1']),
        cache: 'no-store',
      });
      const j = await r.json();
      if (j?.result) return JSON.parse(j.result);
    } catch { /* fall through to the local file */ }
  }
  try {
    return JSON.parse(await readFile(join(process.cwd(), 'data', 'algo-screen.json'), 'utf8'));
  } catch {
    return null;
  }
}
