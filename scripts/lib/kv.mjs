// Tiny Vercel KV / Upstash REST client for the capture scripts (Node, not the
// Next bundle). Mirrors the helper in scripts/sync-brokers.mjs and the read path
// in app/lib/serverPortfolio.js: POST a Redis RESP array, read `result`. Creds
// come from process.env (cloud / Vercel) then the gitignored mcp/.kv.env (laptop).
// No-ops gracefully (returns null / false) when KV is unconfigured, so capture
// degrades to the local file rather than breaking.

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function loadEnv(p) {
  const env = {};
  try {
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m && !line.trim().startsWith('#')) env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  } catch {}
  return env;
}

let _env;
const fileEnv = () => (_env ||= loadEnv(join(ROOT, 'mcp', '.kv.env')));

export function kvCreds() {
  const e = fileEnv();
  const url = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || e.KV_REST_API_URL || e.UPSTASH_REDIS_REST_URL;
  const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || e.KV_REST_API_TOKEN || e.UPSTASH_REDIS_REST_TOKEN;
  return url && token ? { url, token } : null;
}

export const kvConfigured = () => kvCreds() != null;

async function cmd(arr) {
  const creds = kvCreds();
  if (!creds) return undefined;
  const r = await fetch(creds.url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(arr),
    signal: AbortSignal.timeout(6000),
  });
  return (await r.json())?.result;
}

// Returns the parsed JSON value at `key`, or null. Swallows errors → null.
export async function kvGetJSON(key) {
  try { const v = await cmd(['GET', key]); return v ? JSON.parse(v) : null; }
  catch { return null; }
}

// SET key=JSON(value) with an optional TTL in seconds. Returns true on success.
export async function kvSetJSON(key, value, ttlSec) {
  try {
    const arr = ['SET', key, JSON.stringify(value)];
    if (ttlSec) arr.push('EX', String(ttlSec));
    return (await cmd(arr)) === 'OK';
  } catch { return false; }
}
