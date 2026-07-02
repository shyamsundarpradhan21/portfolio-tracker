// Unified ingestion DAEMON (plan v2 §2) — ONE queue, two intakes:
//   (a) Gmail push: Pub/Sub streaming pull → history.list since lastHistoryId
//       (startup catch-up covers laptop sleep; expired history → full label
//       re-query) → PDF attachments downloaded into inbox/ → queue.
//   (b) fs-watch on inbox/: manual drops (payslips, CAS, ITR JSONs, Vested
//       statements, broker tax reports) land in the SAME queue.
// Single processing path = no task duplicacy by construction (router.mjs).
//
//   node scripts/ingest-daemon.mjs             # daemon (fs-watch always; gmail if creds exist)
//   node scripts/ingest-daemon.mjs --once      # sweep inbox/ now, process, exit
//   node scripts/ingest-daemon.mjs --dry       # sweep inbox/ PARSE-ONLY: no KV/store writes,
//                                              #   no deletes/moves, no manifest — zero GCP needed
//   node scripts/ingest-daemon.mjs --auth      # one-time OAuth consent (gmail.readonly)
//
// capture-daemon patterns carried over: strictly-serial in-flight guard (the
// queue), quiet per-file log lines, scripts/ingest.log via the .cmd wrapper's
// redirect. keepAwake is scoped to ACTIVE WORK ONLY (acquired while the queue
// is busy, released when idle) — unlike the session-scoped capture daemon this
// process lives 24/7, and holding ES_SYSTEM_REQUIRED permanently would stop the
// laptop ever idle-sleeping.
//
// Gmail is READONLY: scope gmail.readonly, no label writes, no deletes — the
// original mail is untouched forever; only the downloaded clone is destroyed
// after a checksum-verified parse (router PASS) or quarantined (FAIL).

import { readdirSync, statSync, existsSync, mkdirSync, writeFileSync, readFileSync, watch } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { processFile, makeQueue } from './ingest/router.mjs';
import { loadParsers } from './ingest/registry.mjs';
import { readManifest, seenSource } from './ingest/manifest.mjs';
import {
  GMAIL_PATHS, GMAIL_LABEL, pdfAttachments, newMessageIdsFromHistory, isHistoryGone,
  safeName, readGmailState, writeGmailState, oauthClient, interactiveAuth, gmailClient,
  pubsubSubscription,
} from './ingest/gmail.mjs';
import { keepSystemAwake } from './lib/keepAwake.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
export const INBOX = join(ROOT, 'inbox');
const DIRS = { failed: join(INBOX, 'failed'), unrecognized: join(INBOX, 'unrecognized') };
const MANIFEST = join(ROOT, 'data', 'ingest-manifest.json');
const REARM_MS = 6 * 24 * 3600 * 1000;   // users.watch expires at 7d — re-arm at 6d
const POLL_MS = 6 * 3600 * 1000;         // belt-and-suspenders catch-up even if pushes vanish
const SETTLE_MS = 700;                    // a drop must hold size for this long before parsing

const ts = () => new Date().toLocaleTimeString('en-IN', { hour12: false });  // local (IST) like the other script logs
const log = (line) => console.log(`${ts()} ${line}`);

// ── inbox enumeration (loose files only — never the quarantine subdirs) ──────
export function listInboxFiles(dir = INBOX) {
  let names;
  try { names = readdirSync(dir, { withFileTypes: true }); }
  catch { return []; }
  return names
    .filter((d) => d.isFile())
    .map((d) => d.name)
    .filter((n) => !n.startsWith('.') && !n.endsWith('.tmp') && !n.endsWith('.crdownload') && !n.endsWith('.partial'))
    .map((n) => join(dir, n));
}

// A file just dropped may still be mid-copy — wait until its size holds still.
async function settled(path, tries = 20) {
  let last = -1;
  for (let i = 0; i < tries; i++) {
    let size;
    try { size = statSync(path).size; }
    catch { return false; }                     // vanished while settling
    if (size === last) return true;             // two stable reads = settled (0-byte too)
    last = size;
    await new Promise((r) => setTimeout(r, SETTLE_MS));
  }
  return true;                                   // give up waiting — let the parser decide
}

// ── work-scoped keep-awake ────────────────────────────────────────────────────
function makeAwakeScope() {
  let release = null, idleTimer = null;
  return {
    busy() {
      if (idleTimer) { clearTimeout(idleTimer); idleTimer = null; }
      if (!release) release = keepSystemAwake();
    },
    idle() {
      if (idleTimer || !release) return;
      idleTimer = setTimeout(() => { try { release(); } catch {} release = null; idleTimer = null; }, 30_000);
      idleTimer.unref?.();
    },
    stop() { if (idleTimer) clearTimeout(idleTimer); try { release?.(); } catch {} release = null; },
  };
}

// ── the one queue ─────────────────────────────────────────────────────────────
// paths override is for tests (temp dirs); the daemon runs on the real layout.
export function makeIngest({ parsers, dry = false, logFn = log, paths } = {}) {
  const P = paths || { inbox: INBOX, manifest: MANIFEST, dirs: DIRS };
  const queue = makeQueue({ onError: (e) => logFn(`queue error: ${e?.message || e}`) });
  const awake = makeAwakeScope();
  const claimed = new Set();                    // paths the gmail intake queues itself
  const enqueue = (path, source) => {
    awake.busy();
    return queue.push(async () => {
      if (!(await settled(path))) { logFn(`ingest: ${path} vanished before settle — skipped`); return null; }
      const row = await processFile(path, { parsers, manifestPath: P.manifest, dirs: P.dirs, source, dry, log: logFn });
      claimed.delete(path);
      if (queue.pending <= 1) awake.idle();
      return row;
    });
  };
  return { queue, enqueue, claimed, awake, paths: P };
}

// One pass over whatever is loose in inbox/ right now.
export async function sweepInbox(ingest, { source = 'manual' } = {}) {
  const files = listInboxFiles(ingest.paths.inbox);
  const rows = [];
  for (const f of files) {
    if (ingest.claimed.has(f)) continue;
    rows.push(await ingest.enqueue(f, source));
  }
  await ingest.queue.idle();
  return rows.filter(Boolean);
}

// ── gmail intake ──────────────────────────────────────────────────────────────
const gmailCredsPresent = () =>
  existsSync(GMAIL_PATHS.clientSecret) && existsSync(GMAIL_PATHS.token) && existsSync(GMAIL_PATHS.saKey);

async function labelId(gmail) {
  const { data } = await gmail.users.labels.list({ userId: 'me' });
  const hit = (data.labels || []).find((l) => l.name === GMAIL_LABEL);
  if (!hit) throw new Error(`Gmail label "${GMAIL_LABEL}" not found — create the filter+label (mcp/gmail/README.md step 18)`);
  return hit.id;
}

async function downloadMessagePdfs(gmail, ingest, msgId) {
  const { data: msg } = await gmail.users.messages.get({ userId: 'me', id: msgId, format: 'full' });
  const atts = pdfAttachments(msg);
  for (const a of atts) {
    const { data } = await gmail.users.messages.attachments.get({ userId: 'me', messageId: msgId, id: a.attachmentId });
    const bytes = Buffer.from(data.data, 'base64url');
    mkdirSync(INBOX, { recursive: true });
    const dest = join(INBOX, safeName(a.filename, msgId));
    writeFileSync(dest, bytes);
    ingest.claimed.add(dest);                    // fs-watcher must not double-queue it
    ingest.enqueue(dest, `gmail:${msgId}`);
  }
  return atts.length;
}

// history.list catch-up since lastHistoryId; expired/absent history → full
// label re-query. Idempotent via gmail-state done-map + manifest source rows.
async function gmailCatchUp(gmail, ingest, lid) {
  const state = readGmailState();
  const manifest = readManifest(MANIFEST);
  let msgIds = [];
  let newHistoryId = null;

  if (state.lastHistoryId) {
    try {
      let pageToken;
      do {
        const { data } = await gmail.users.history.list({
          userId: 'me', startHistoryId: state.lastHistoryId, labelId: lid,
          historyTypes: ['messageAdded'], pageToken,
        });
        msgIds.push(...newMessageIdsFromHistory(data));
        newHistoryId = data.historyId || newHistoryId;
        pageToken = data.nextPageToken;
      } while (pageToken);
    } catch (e) {
      if (!isHistoryGone(e)) throw e;
      log('gmail: history expired — full label re-query');
      state.lastHistoryId = null;
    }
  }
  if (!state.lastHistoryId) {
    // GAP path: everything currently under the label; done-map + manifest dedup them
    let pageToken;
    do {
      const { data } = await gmail.users.messages.list({ userId: 'me', labelIds: [lid], maxResults: 100, pageToken });
      msgIds.push(...(data.messages || []).map((m) => m.id));
      pageToken = data.nextPageToken;
    } while (pageToken);
    const { data: prof } = await gmail.users.getProfile({ userId: 'me' });
    newHistoryId = prof.historyId;
  }

  let fetched = 0;
  for (const id of msgIds) {
    if (state.done[id] || seenSource(manifest, `gmail:${id}`)) continue;
    const n = await downloadMessagePdfs(gmail, ingest, id).catch((e) => {
      log(`gmail: message ${id} download failed: ${e.message}`);
      return null;                               // NOT marked done — retried next catch-up
    });
    if (n == null) continue;
    state.done[id] = new Date().toISOString();
    fetched += n;
  }
  if (newHistoryId) state.lastHistoryId = String(newHistoryId);
  writeGmailState(state);
  if (msgIds.length || fetched) log(`gmail: catch-up — ${msgIds.length} candidate mails, ${fetched} pdfs queued`);
  return fetched;
}

async function armWatch(gmail, lid, projectId) {
  await gmail.users.watch({
    userId: 'me',
    requestBody: { topicName: `projects/${projectId}/topics/gmail-tx`, labelIds: [lid], labelFilterBehavior: 'INCLUDE' },
  });
  log('gmail: users.watch armed (re-arms every 6d)');
}

async function startGmailIntake(ingest, timers) {
  const auth = await oauthClient();
  const gmail = await gmailClient(auth);
  const lid = await labelId(gmail);
  const projectId = JSON.parse(readFileSync(GMAIL_PATHS.saKey, 'utf8')).project_id;

  await gmailCatchUp(gmail, ingest, lid);        // startup catch-up covers downtime/sleep
  await armWatch(gmail, lid, projectId).catch((e) => log(`gmail: watch arm failed (push disabled, poll still on): ${e.message}`));
  timers.push(setInterval(() => armWatch(gmail, lid, projectId).catch((e) => log(`gmail: re-arm failed: ${e.message}`)), REARM_MS));
  timers.push(setInterval(() => gmailCatchUp(gmail, ingest, lid).catch((e) => log(`gmail: poll failed: ${e.message}`)), POLL_MS));

  // Streaming pull: any notification just triggers a catch-up from stored state.
  // Ack immediately — idempotency lives in gmail-state + the manifest, not redelivery.
  let catchUpBusy = false;
  const sub = await pubsubSubscription();
  sub.on('message', (m) => {
    m.ack();
    if (catchUpBusy) return;
    catchUpBusy = true;
    gmailCatchUp(gmail, ingest, lid)
      .catch((e) => log(`gmail: push catch-up failed: ${e.message}`))
      .finally(() => { catchUpBusy = false; });
  });
  sub.on('error', (e) => log(`pubsub: stream error (poll continues): ${e.message}`));
  log('gmail intake up: pub/sub streaming pull + 6h poll');
  return sub;
}

// ── fs-watch intake ───────────────────────────────────────────────────────────
function startWatchIntake(ingest) {
  mkdirSync(DIRS.failed, { recursive: true });
  mkdirSync(DIRS.unrecognized, { recursive: true });
  const pending = new Map();                     // debounce multiple events per drop
  const watcher = watch(INBOX, (event, name) => {
    if (!name || name.startsWith('.') || /\.(tmp|crdownload|partial)$/i.test(name)) return;
    const full = join(INBOX, name);
    if (ingest.claimed.has(full)) return;        // gmail intake queues its own downloads
    clearTimeout(pending.get(full));
    pending.set(full, setTimeout(() => {
      pending.delete(full);
      let isFile = false;
      try { isFile = statSync(full).isFile(); } catch { return; }   // moved/deleted already
      if (isFile) ingest.enqueue(full, 'manual');
    }, 400));
  });
  log(`fs-watch up on inbox/ (manual drops)`);
  return watcher;
}

// ── main ─────────────────────────────────────────────────────────────────────
async function main() {
  const args = new Set(process.argv.slice(2));
  if (args.has('--auth')) {
    await interactiveAuth();
    return;
  }
  const dry = args.has('--dry');
  const once = args.has('--once') || dry;
  const parsers = await loadParsers();
  log(`ingest-daemon: ${parsers.length} parsers registered${dry ? ' · DRY (no writes, no moves)' : ''}`);
  const ingest = makeIngest({ parsers, dry });

  if (once) {
    const rows = await sweepInbox(ingest);
    const tally = {};
    for (const r of rows) tally[r.status] = (tally[r.status] || 0) + 1;
    log(`sweep done: ${rows.length} files — ${Object.entries(tally).map(([k, v]) => `${k}:${v}`).join(' ') || 'inbox empty'}`);
    ingest.awake.stop();
    return;
  }

  const timers = [];
  const watcher = startWatchIntake(ingest);
  let sub = null;
  if (gmailCredsPresent()) {
    sub = await startGmailIntake(ingest, timers).catch((e) => {
      log(`gmail intake DISABLED: ${e.message}`);
      return null;
    });
  } else {
    log('gmail intake disabled (no creds — see mcp/gmail/README.md); fs-watch only');
  }
  await sweepInbox(ingest);                      // drops that landed while we were down

  const stop = async (sig) => {
    log(`${sig} — draining queue…`);
    timers.forEach(clearInterval);
    try { watcher.close(); } catch {}
    try { await sub?.close(); } catch {}
    await ingest.queue.idle();
    ingest.awake.stop();
    log('stopped.');
    process.exit(0);
  };
  process.on('SIGINT', () => stop('SIGINT'));
  process.on('SIGTERM', () => stop('SIGTERM'));
}

// vitest imports the exported helpers without running the daemon
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => { console.error('ingest-daemon fatal:', e); process.exit(1); });
}
