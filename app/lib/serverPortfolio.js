// Server-side loader for the private portfolio data — used by API routes that
// need it at request time (they can't rely on the client-side hydration of
// app/portfolio.js, whose exports are empty on the server). Reads Vercel KV
// (`portfolio:v1`) with a local-dev fallback to the gitignored JSON. Same source
// the /api/portfolio route serves to the client.

import { readFile, readdir } from 'node:fs/promises';
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

// EOD book — the durable per-holding close snapshot (built by scripts/build-eod-book.mjs).
// Returns the LATEST day record { date, asOf, sleeveValues, sleeves, reconcile, dataQuality }
// or null. Prod source = KV `eod-book:latest` (serving copy); local dev falls back to the
// gitignored data/eod-book.json (all days → latest). Graceful: null → the client keeps its
// live-quote behaviour unchanged (the close-fallback consumer treats null as "no book").
export async function loadEodBook() {
  const creds = kvCreds();
  if (creds) {
    try {
      const r = await fetch(creds.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', 'eod-book:latest']),
        cache: 'no-store',
      });
      const j = await r.json();
      if (j?.result) return JSON.parse(j.result);
    } catch { /* fall through to the local file */ }
  }
  try {
    const b = JSON.parse(await readFile(join(process.cwd(), 'data', 'eod-book.json'), 'utf8'));
    const d = Object.keys(b.days || {}).sort().pop();
    return d ? { date: d, ...b.days[d] } : null;
  } catch {
    return null;
  }
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

// Latest local data/algo-monthly[/<sub>]/<YYYY-MM>.json (gitignored, derived). Shared by
// the monthly reco + review loaders below.
async function latestMonthly(...sub) {
  try {
    const dir = join(process.cwd(), 'data', 'algo-monthly', ...sub);
    const files = (await readdir(dir)).filter((f) => /^\d{4}-\d{2}\.json$/.test(f)).sort();
    if (!files.length) return null;
    return JSON.parse(await readFile(join(dir, files[files.length - 1]), 'utf8'));
  } catch { return null; }
}

// Monthly decision artifact (Phase 3). Prod source = KV `algo-monthly:latest` (built by
// scripts/build-monthly-reco.mjs); local dev falls back to the latest gitignored file.
// Private (held basket) → served at request time like loadPortfolio, never in the bundle.
export async function loadAlgoMonthly() {
  const creds = kvCreds();
  if (creds) {
    try {
      const r = await fetch(creds.url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${creds.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(['GET', 'algo-monthly:latest']),
        cache: 'no-store',
      });
      const j = await r.json();
      if (j?.result) return JSON.parse(j.result);
    } catch { /* fall through to the local file */ }
  }
  return latestMonthly();
}

// Latest monthly REVIEW (Phase 4). Reviews are user-first and NOT seeded to KV yet, so this
// reads the latest local file only — null (→ "nothing to review yet") until the first review.
export async function loadAlgoReview() {
  return latestMonthly('reviews');
}
