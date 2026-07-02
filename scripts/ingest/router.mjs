// Router — the single processing path every intake goes through (plan v2 §2:
// two intakes, ONE queue, one path = no task duplicacy by construction).
//
// Per file:  sniff → classify → sha-dedup → parse → naturalKey-dedup → dispose
//   PASS         → clone DELETED (raw docs are never persisted; manifest keeps
//                  hash + provenance — contract-parser's discipline, global)
//   FAIL         → moved to inbox/failed/      (quarantine, fix + re-drop)
//   UNRECOGNIZED → moved to inbox/unrecognized/ (parked, never silently dropped)
//   DUP          → clone DELETED (the original already PASSed; row carries of=)
//
// INVARIANT (plan §5): every file processed here ends as EXACTLY ONE manifest
// row. Manifest is re-read + atomically rewritten per file — crash between two
// files never loses or double-writes a row.
//
// dry mode = classify + parse but NO store writes anywhere: parsers are called
// with {dry:true} (no KV / private-JSON / seed), the manifest is NOT written,
// and the file is NOT moved or deleted. The would-be row is still returned so
// callers can report.

import { readSync, openSync, closeSync, fstatSync, mkdirSync, renameSync, unlinkSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { sha256File } from './dedup.mjs';
import { dupBySha, dupByNaturalKey } from './dedup.mjs';
import { classify } from './registry.mjs';
import { readManifest, writeManifest, appendRow } from './manifest.mjs';

const HEAD_BYTES = 8192;

// First bytes + best-effort text, for canHandle sniffing. One open, one read.
export function sniffFile(path) {
  const fd = openSync(path, 'r');
  try {
    const size = fstatSync(fd).size;
    const buf = Buffer.alloc(Math.min(HEAD_BYTES, size));
    if (buf.length) readSync(fd, buf, 0, buf.length, 0);
    return { head: buf, headText: buf.toString('utf8'), size };
  } finally {
    closeSync(fd);
  }
}

// Move into a quarantine/park dir; a name collision gets a sha prefix so a
// second failing copy never overwrites the first piece of evidence.
function moveInto(dir, path, sha256) {
  mkdirSync(dir, { recursive: true });
  let dest = join(dir, basename(path));
  if (existsSync(dest)) dest = join(dir, `${sha256.slice(0, 8)}-${basename(path)}`);
  renameSync(path, dest);
  return dest;
}

// Process ONE file through the whole pipeline. Returns the manifest row (or the
// would-be row in dry mode). opts:
//   parsers      — registry list (injectable for tests)
//   manifestPath — data/ingest-manifest.json
//   dirs         — { failed, unrecognized }
//   source       — 'gmail:<msgId>' | 'manual' | 'backfill:<msgId>'
//   dry          — parse-only, no writes/moves/deletes
//   log          — (line) => void   (defaults to console.log)
export async function processFile(path, { parsers, manifestPath, dirs, source, dry = false, log = console.log }) {
  const file = basename(path);
  let sniff;
  try {
    sniff = sniffFile(path);
  } catch (e) {
    // vanished between queue and processing (user pulled it back) — nothing was
    // intaken, so no row; log and move on.
    log(`ingest: ${file} unreadable/vanished before processing (${e.message}) — skipped`);
    return null;
  }
  const sha256 = await sha256File(path);
  const manifest = readManifest(manifestPath, { strict: !dry });
  const commit = (row) => {
    if (dry) return { ...row, ts: null, dry: true };
    const r = appendRow(manifest, row);
    writeManifest(manifestPath, manifest);
    return r;
  };
  const base = { file, sha256, size: sniff.size, source };

  // 1. classify — no parser claims it → park, never drop
  const parser = classify({ name: file, head: sniff.head, headText: sniff.headText }, parsers);
  if (!parser) {
    if (!dry) moveInto(dirs.unrecognized, path, sha256);
    log(`ingest: [UNRECOGNIZED] ${file} — parked${dry ? ' (dry)' : ''}`);
    return commit({ ...base, status: 'UNRECOGNIZED', reason: 'no parser claimed the file' });
  }

  // 2. layer-(i) dedup — same bytes already PASSed
  const shaDup = dupBySha(manifest, sha256);
  if (shaDup) {
    if (!dry) unlinkSync(path);
    log(`ingest: [DUP] ${file} — same bytes as ${shaDup.file} (${shaDup.ts})${dry ? ' (dry)' : ''}`);
    return commit({ ...base, parser: parser.id, status: 'DUP', of: shaDup.sha256, reason: 'sha256 match' });
  }

  // 3. parse (throw ⇒ FAIL)
  let result;
  try {
    result = await parser.run({ path, name: file, sha256, size: sniff.size }, { dry });
    if (!result || (result.status !== 'PASS' && result.status !== 'FAIL')) {
      result = { status: 'FAIL', reason: `parser ${parser.id} returned no PASS/FAIL status` };
    }
  } catch (e) {
    result = { status: 'FAIL', reason: e?.message || String(e) };
  }

  // 4. layer-(ii) dedup — same document, different bytes (needs the parsed key)
  if (result.status === 'PASS' && result.naturalKey) {
    const keyDup = dupByNaturalKey(manifest, parser.id, result.naturalKey);
    if (keyDup) {
      if (!dry) unlinkSync(path);
      log(`ingest: [DUP] ${file} — naturalKey ${result.naturalKey} already ingested as ${keyDup.file}${dry ? ' (dry)' : ''}`);
      return commit({
        ...base, parser: parser.id, parserVersion: result.parserVersion,
        naturalKey: result.naturalKey, status: 'DUP', of: keyDup.sha256, reason: 'naturalKey match',
      });
    }
  }

  // 5. dispose + ledger
  if (result.status === 'PASS') {
    if (!dry) unlinkSync(path);                 // raw doc destroyed; derived data lives at `target`
    log(`ingest: [PASS] ${file} → ${parser.id} key=${result.naturalKey} target=${result.target || '-'}${dry ? ' (dry)' : ''}`);
  } else {
    if (!dry) moveInto(dirs.failed, path, sha256);
    log(`ingest: [FAIL] ${file} → ${parser.id} — ${result.reason || 'parse failed'}${dry ? ' (dry)' : ''}`);
  }
  return commit({
    ...base, parser: parser.id, parserVersion: result.parserVersion,
    naturalKey: result.naturalKey ?? null, status: result.status,
    target: result.target ?? null, reason: result.reason ?? null,
    meta: result.meta ?? null,
  });
}

// Strictly-serial async queue with an in-flight guard (capture-daemon pattern):
// intakes from Pub/Sub and the fs-watcher both push here, so exactly one file
// is ever mid-pipeline — ordering + the per-file manifest rewrite stay simple.
export function makeQueue({ onError = (e) => console.error('ingest queue:', e?.message || e) } = {}) {
  let tail = Promise.resolve();
  let pending = 0;
  return {
    push(job) {
      pending++;
      tail = tail
        .then(job)
        .catch(onError)
        .finally(() => { pending--; });
      return tail;
    },
    get pending() { return pending; },
    idle: () => tail.then(() => undefined),
  };
}
