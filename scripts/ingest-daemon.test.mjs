// Daemon glue tests — the exported helpers only (importing this file must NOT
// start the daemon; the main() guard keys on argv[1]). Gmail/PubSub paths are
// deliberately untested here: they need creds and are covered by the phase-(i)
// live verification. What we prove: inbox enumeration, and that a sweep through
// makeIngest honors dry vs live semantics against injected temp paths.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { listInboxFiles, makeIngest, sweepInbox } from './ingest-daemon.mjs';
import { readManifest } from './ingest/manifest.mjs';

let root, paths;

const dumParser = {
  id: 'dummy',
  canHandle: ({ name }) => name.endsWith('.dum'),
  run: async () => ({ status: 'PASS', naturalKey: 'K', target: 'kv:test' }),
  expects: { cadence: 'monthly' },
};

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ingest-daemon-'));
  const inbox = join(root, 'inbox');
  mkdirSync(inbox, { recursive: true });
  paths = {
    inbox,
    manifest: join(root, 'data', 'ingest-manifest.json'),
    dirs: { failed: join(inbox, 'failed'), unrecognized: join(inbox, 'unrecognized') },
  };
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('listInboxFiles', () => {
  it('loose real files only — no subdirs, dotfiles, or partial downloads', () => {
    writeFileSync(join(paths.inbox, 'a.pdf'), 'x');
    writeFileSync(join(paths.inbox, 'b.dum'), 'x');
    writeFileSync(join(paths.inbox, '.hidden'), 'x');
    writeFileSync(join(paths.inbox, 'mid-copy.tmp'), 'x');
    writeFileSync(join(paths.inbox, 'browser.crdownload'), 'x');
    mkdirSync(join(paths.inbox, 'failed'), { recursive: true });
    writeFileSync(join(paths.inbox, 'failed', 'old.pdf'), 'x');
    const names = listInboxFiles(paths.inbox).map((p) => p.split(/[\\/]/).pop()).sort();
    expect(names).toEqual(['a.pdf', 'b.dum']);
  });
  it('missing dir → []', () => {
    expect(listInboxFiles(join(root, 'nope'))).toEqual([]);
  });
});

describe('sweep — live vs dry', () => {
  it('live sweep processes and records; PASS clone deleted', async () => {
    const f = join(paths.inbox, 'doc.dum');
    writeFileSync(f, 'content');
    const ingest = makeIngest({ parsers: [dumParser], paths, logFn: () => {} });
    const rows = await sweepInbox(ingest);
    ingest.awake.stop();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PASS');
    expect(existsSync(f)).toBe(false);
    expect(readManifest(paths.manifest).rows).toHaveLength(1);
  }, 15_000);

  it('dry sweep (zero GCP, fixtures only): reports, touches nothing', async () => {
    const f = join(paths.inbox, 'doc.dum');
    writeFileSync(f, 'content');
    const ingest = makeIngest({ parsers: [dumParser], dry: true, paths, logFn: () => {} });
    const rows = await sweepInbox(ingest);
    ingest.awake.stop();
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('PASS');
    expect(rows[0].dry).toBe(true);
    expect(existsSync(f)).toBe(true);                        // nothing moved/deleted
    expect(existsSync(paths.manifest)).toBe(false);          // ledger untouched
  }, 15_000);

  it('claimed paths are skipped by the sweep (gmail intake owns them)', async () => {
    const f = join(paths.inbox, 'doc.dum');
    writeFileSync(f, 'content');
    const ingest = makeIngest({ parsers: [dumParser], paths, logFn: () => {} });
    ingest.claimed.add(f);
    const rows = await sweepInbox(ingest);
    ingest.awake.stop();
    expect(rows).toHaveLength(0);
    expect(existsSync(f)).toBe(true);
  });
});
