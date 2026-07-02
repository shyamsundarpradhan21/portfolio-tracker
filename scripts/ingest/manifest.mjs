// Ingestion manifest — the lineage ledger of the unified pipeline (plan v2 §5).
//
// One row per INTAKE EVENT: every file that ever touches inbox/ ends as exactly
// one row (PASS | FAIL | DUP | UNRECOGNIZED) — nothing vanishes unaccounted.
// The manifest is an event log, not a unique-document set: re-dropping a file
// that previously FAILed appends a NEW row for the new attempt (retry after a
// parser fix is a first-class flow); only prior PASSes establish "already
// ingested" for dedup purposes (see dedup.mjs).
//
// File: data/ingest-manifest.json (gitignored — provenance may embed filenames).
// Writes are atomic (tmp + rename) so a crash mid-write can't corrupt the ledger.

import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export const STATUSES = ['PASS', 'FAIL', 'DUP', 'UNRECOGNIZED'];

export function emptyManifest() {
  return { version: 1, rows: [] };
}

// Missing / unreadable / corrupt file → empty manifest (the ledger only ever
// grows via appendRow; a corrupt read must never silently truncate history, so
// the caller CAN pass strict:true to throw instead — the daemon does).
export function readManifest(path, { strict = false } = {}) {
  let raw;
  try { raw = readFileSync(path, 'utf8'); }
  catch { return emptyManifest(); }              // not created yet — normal first run
  try {
    const m = JSON.parse(raw);
    if (!Array.isArray(m?.rows)) throw new Error('manifest shape: rows missing');
    return m;
  } catch (e) {
    if (strict) throw new Error(`ingest-manifest unreadable (${e.message}) — refusing to overwrite history`);
    return emptyManifest();
  }
}

export function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 1));
  renameSync(tmp, path);
}

// Validates + appends one intake row. Returns the row (frozen shape, not object).
// Required: sha256, status, source, file. naturalKey/parser may be null for
// UNRECOGNIZED (no parser claimed it) and for sha-level DUPs (never parsed).
export function appendRow(manifest, row) {
  if (!STATUSES.includes(row.status)) throw new Error(`manifest: bad status ${row.status}`);
  if (!row.sha256) throw new Error('manifest: row needs sha256');
  if (!row.source) throw new Error('manifest: row needs source');
  if (!row.file) throw new Error('manifest: row needs file');
  if (row.status === 'DUP' && !row.of) throw new Error('manifest: DUP row needs of=<sha256 of the PASS row>');
  const r = {
    ts: row.ts || new Date().toISOString(),
    file: row.file,                       // basename only — full paths stay out of the ledger
    sha256: row.sha256,
    size: row.size ?? null,
    parser: row.parser ?? null,
    parserVersion: row.parserVersion ?? null,
    naturalKey: row.naturalKey ?? null,
    source: row.source,                   // 'gmail:<msgId>' | 'manual' | 'backfill:<msgId>'
    status: row.status,
    target: row.target ?? null,           // where the DERIVED data went (KV key / file) — never the raw doc
    reason: row.reason ?? null,
    of: row.of ?? null,                   // DUP → sha256 of the original PASS row
  };
  manifest.rows.push(r);
  return r;
}

// ── lookups used by dedup + the completeness report ──────────────────────────
export const passRows = (m) => m.rows.filter((r) => r.status === 'PASS');

export function findPassBySha(m, sha256) {
  return m.rows.find((r) => r.status === 'PASS' && r.sha256 === sha256) || null;
}

export function findPassByNaturalKey(m, parserId, naturalKey) {
  if (!naturalKey) return null;
  return m.rows.find((r) => r.status === 'PASS' && r.parser === parserId && r.naturalKey === naturalKey) || null;
}

// Has this exact source event already produced a row? (Gmail idempotency: a
// re-delivered Pub/Sub message or a backfill re-run must not re-intake.)
export function seenSource(m, source) {
  return m.rows.some((r) => r.source === source);
}
