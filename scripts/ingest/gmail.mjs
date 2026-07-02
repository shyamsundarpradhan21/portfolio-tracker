// Gmail intake helpers (plan v2 §7). Two kinds of exports:
//   • PURE functions over Gmail API JSON (attachment selection, history-delta
//     extraction, gap detection) — unit-tested on fixtures, no network.
//   • Thin auth/state/client utilities used by the daemon (lazy-import
//     googleapis so `--dry` fixture runs never need GCP or the dependency).
//
// Scope is gmail.readonly ONLY — nothing here can mutate a mailbox, ever.
// Idempotency lives in data/gmail-state.json (lastHistoryId + seen message ids),
// NOT in Gmail labels (readonly scope can't write labels anyway).

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const GMAIL_PATHS = {
  clientSecret: join(ROOT, 'mcp', 'gmail', '.client_secret.json'),
  token: join(ROOT, 'mcp', 'gmail', '.token.json'),
  saKey: join(ROOT, 'mcp', 'gmail', '.sa.json'),
  state: join(ROOT, 'data', 'gmail-state.json'),
};
export const GMAIL_SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
export const GMAIL_LABEL = 'portfolio/tx';

// ── pure: attachment selection ────────────────────────────────────────────────
// Walk a users.messages.get (format:'full') payload and pick the real PDF
// attachments: filename .pdf OR mimeType application/pdf, with an attachmentId.
// Inline images / signatures / calendar parts are skipped by construction.
export function pdfAttachments(message) {
  const out = [];
  const walk = (part) => {
    if (!part) return;
    const name = part.filename || '';
    const isPdf = /\.pdf$/i.test(name) || part.mimeType === 'application/pdf';
    if (isPdf && part.body?.attachmentId) {
      out.push({ filename: name || 'attachment.pdf', attachmentId: part.body.attachmentId, size: part.body.size ?? null });
    }
    (part.parts || []).forEach(walk);
  };
  walk(message?.payload);
  return out;
}

// ── pure: history deltas ──────────────────────────────────────────────────────
// users.history.list response → ordered, deduped list of NEW message ids.
// Only messagesAdded matters (readonly pipeline; label/read changes are noise).
export function newMessageIdsFromHistory(historyResponse) {
  const seen = new Set();
  const ids = [];
  for (const h of historyResponse?.history || []) {
    for (const ma of h.messagesAdded || []) {
      const id = ma.message?.id;
      if (id && !seen.has(id)) { seen.add(id); ids.push(id); }
    }
  }
  return ids;
}

// Gmail expires history: startHistoryId older than the retention window → HTTP
// 404. That is the GAP signal — recover with a full label re-query, not a crash.
export function isHistoryGone(err) {
  const code = err?.code ?? err?.status ?? err?.response?.status;
  return code === 404 || Number(code) === 404;
}

// ── pure: inbox-safe filenames ────────────────────────────────────────────────
// Windows-safe basename, prefixed with a message-id fragment so two mails that
// both attach "ContractNote.pdf" can never collide in inbox/.
export function safeName(filename, msgId) {
  const base = (filename || 'attachment.pdf').replace(/[\\/:*?"<>|\x00-\x1f]+/g, '_').slice(-120);
  const tag = (msgId || '').slice(-8);
  return tag ? `${tag}-${base}` : base;
}

// ── gmail-state.json (idempotency) ────────────────────────────────────────────
export function readGmailState(path = GMAIL_PATHS.state) {
  try {
    const s = JSON.parse(readFileSync(path, 'utf8'));
    return { lastHistoryId: s.lastHistoryId ?? null, done: s.done ?? {}, backfill: s.backfill ?? {} };
  } catch {
    return { lastHistoryId: null, done: {}, backfill: {} };
  }
}

export function writeGmailState(state, path = GMAIL_PATHS.state) {
  // prune the seen-message map so the state file can't grow unbounded
  const ids = Object.keys(state.done || {});
  if (ids.length > 4000) {
    const keep = ids.sort((a, b) => (state.done[a] < state.done[b] ? 1 : -1)).slice(0, 2000);
    state.done = Object.fromEntries(keep.map((id) => [id, state.done[id]]));
  }
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 1));
  renameSync(tmp, path);
}

// ── auth + clients (lazy googleapis; daemon-only paths) ───────────────────────
export async function oauthClient({ clientSecretPath = GMAIL_PATHS.clientSecret, tokenPath = GMAIL_PATHS.token } = {}) {
  const { google } = await import('googleapis');
  const raw = JSON.parse(readFileSync(clientSecretPath, 'utf8'));
  const c = raw.installed || raw.web;
  if (!c?.client_id) throw new Error('mcp/gmail/.client_secret.json: not an OAuth client file');
  const client = new google.auth.OAuth2(c.client_id, c.client_secret, 'http://127.0.0.1');
  try {
    client.setCredentials(JSON.parse(readFileSync(tokenPath, 'utf8')));
  } catch {
    throw new Error('mcp/gmail/.token.json missing — run: node scripts/ingest-daemon.mjs --auth');
  }
  // Persist refreshed access tokens so restarts don't re-burn the refresh flow.
  client.on('tokens', (t) => {
    try {
      const cur = JSON.parse(readFileSync(tokenPath, 'utf8'));
      writeFileSync(tokenPath, JSON.stringify({ ...cur, ...t }, null, 1));
    } catch { /* token file gone mid-run — next --auth recreates it */ }
  });
  return client;
}

// One-time interactive consent (--auth): loopback flow on a random local port;
// the refresh token lands in mcp/gmail/.token.json. Never logs the token itself.
export async function interactiveAuth({ clientSecretPath = GMAIL_PATHS.clientSecret, tokenPath = GMAIL_PATHS.token, log = console.log } = {}) {
  const { google } = await import('googleapis');
  const http = await import('node:http');
  const raw = JSON.parse(readFileSync(clientSecretPath, 'utf8'));
  const c = raw.installed || raw.web;
  if (!c?.client_id) throw new Error('mcp/gmail/.client_secret.json: not an OAuth client file (download the Desktop-app client JSON — see mcp/gmail/README.md step 12)');

  // Listener first, so the redirect URI carries the real port.
  const server = http.createServer();
  await new Promise((res, rej) => { server.once('error', rej); server.listen(0, '127.0.0.1', res); });
  const port = server.address().port;
  const client = new google.auth.OAuth2(c.client_id, c.client_secret, `http://127.0.0.1:${port}`);
  const url = client.generateAuthUrl({ access_type: 'offline', prompt: 'consent', scope: [GMAIL_SCOPE] });
  log('\nOpen this URL, sign in, and approve the READ-ONLY Gmail scope:\n');
  log(url + '\n');

  const code = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { server.close(); reject(new Error('auth timed out (10 min)')); }, 600_000);
    server.on('request', (req, res) => {
      const u = new URL(req.url, `http://127.0.0.1:${port}`);
      const got = u.searchParams.get('code');
      const err = u.searchParams.get('error');
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      res.end(got ? 'Authorized — you can close this tab.' : err ? `Error: ${err}` : 'Waiting for the Google redirect…');
      if (got || err) {
        clearTimeout(timer);
        server.close();
        got ? resolve(got) : reject(new Error(`consent denied: ${err}`));
      }
    });
  });

  const { tokens } = await client.getToken(code);
  mkdirSync(dirname(tokenPath), { recursive: true });
  writeFileSync(tokenPath, JSON.stringify(tokens, null, 1));
  log('Token stored in mcp/gmail/.token.json (gitignored). Gmail access is read-only.');
  return true;
}

export async function gmailClient(auth) {
  const { google } = await import('googleapis');
  return google.gmail({ version: 'v1', auth });
}

export async function pubsubSubscription({ saKeyPath = GMAIL_PATHS.saKey, subscription = 'gmail-tx-pull' } = {}) {
  const { PubSub } = await import('@google-cloud/pubsub');
  const projectId = JSON.parse(readFileSync(saKeyPath, 'utf8')).project_id;
  const client = new PubSub({ projectId, keyFilename: saKeyPath });
  return client.subscription(subscription);
}
