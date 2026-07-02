// Phase-(b) contract tests for the ingest pure libs (plan v2 §§3-5):
//   • manifest invariant — every intake ends as exactly ONE row (PASS|FAIL|DUP|UNRECOGNIZED)
//   • dedup — same bytes → DUP; same naturalKey different bytes → DUP(of=…)
//   • unknown file → UNRECOGNIZED park, never dropped
// All on real temp dirs — the router moves/deletes real files.

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readManifest, writeManifest, appendRow, emptyManifest, seenSource } from './manifest.mjs';
import { sha256Buffer } from './dedup.mjs';
import { processFile, makeQueue, sniffFile } from './router.mjs';

let root, dirs, manifestPath;

// dummy parsers ---------------------------------------------------------------
// .dum → PASS, naturalKey = first line of the file (simulates a content-derived
// key: same key can arrive as different bytes). .bad → FAIL. .boom → throws.
const dumParser = {
  id: 'dummy',
  canHandle: ({ name }) => name.endsWith('.dum'),
  run: async ({ path }) => ({
    status: 'PASS',
    naturalKey: readFileSync(path, 'utf8').split('\n')[0],
    target: 'kv:test',
    parserVersion: '1',
  }),
  expects: { cadence: 'monthly' },
};
const badParser = {
  id: 'bad',
  canHandle: ({ name }) => name.endsWith('.bad'),
  run: async () => ({ status: 'FAIL', reason: 'checksum FAIL' }),
  expects: { cadence: 'monthly' },
};
const boomParser = {
  id: 'boom',
  canHandle: ({ name }) => name.endsWith('.boom'),
  run: async () => { throw new Error('exploded mid-parse'); },
  expects: { cadence: 'annual' },
};
const PARSERS = [dumParser, badParser, boomParser];

const drop = (name, content) => {
  const p = join(root, 'inbox', name);
  writeFileSync(p, content);
  return p;
};
const ctx = (over = {}) => ({
  parsers: PARSERS, manifestPath, dirs, source: 'manual', log: () => {}, ...over,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'ingest-'));
  mkdirSync(join(root, 'inbox'), { recursive: true });
  dirs = { failed: join(root, 'inbox', 'failed'), unrecognized: join(root, 'inbox', 'unrecognized') };
  manifestPath = join(root, 'data', 'ingest-manifest.json');
});
afterEach(() => rmSync(root, { recursive: true, force: true }));

describe('manifest', () => {
  it('missing file reads as empty; roundtrip preserves rows', () => {
    expect(readManifest(manifestPath).rows).toEqual([]);
    const m = emptyManifest();
    appendRow(m, { file: 'a.dum', sha256: 'x'.repeat(64), source: 'manual', status: 'PASS' });
    writeManifest(manifestPath, m);
    expect(readManifest(manifestPath).rows).toHaveLength(1);
  });

  it('corrupt manifest: lenient read → empty, strict read → throws (never overwrite history silently)', () => {
    mkdirSync(join(root, 'data'), { recursive: true });
    writeFileSync(manifestPath, '{not json', { encoding: 'utf8' });
    expect(readManifest(manifestPath).rows).toEqual([]);
    expect(() => readManifest(manifestPath, { strict: true })).toThrow(/refusing/);
  });

  it('rejects bad rows: unknown status, DUP without of=', () => {
    const m = emptyManifest();
    expect(() => appendRow(m, { file: 'x', sha256: 's', source: 'manual', status: 'MAYBE' })).toThrow(/bad status/);
    expect(() => appendRow(m, { file: 'x', sha256: 's', source: 'manual', status: 'DUP' })).toThrow(/of=/);
  });

  it('seenSource: gmail idempotency check', () => {
    const m = emptyManifest();
    appendRow(m, { file: 'a', sha256: 's', source: 'gmail:abc', status: 'PASS' });
    expect(seenSource(m, 'gmail:abc')).toBe(true);
    expect(seenSource(m, 'gmail:zzz')).toBe(false);
  });
});

describe('router — the four dispositions', () => {
  it('PASS: clone deleted, exactly one row with key/target', async () => {
    const p = drop('note.dum', 'KEY-1\npayload');
    const row = await processFile(p, ctx());
    expect(row.status).toBe('PASS');
    expect(row.naturalKey).toBe('KEY-1');
    expect(row.target).toBe('kv:test');
    expect(existsSync(p)).toBe(false);                     // raw doc destroyed
    expect(readManifest(manifestPath).rows).toHaveLength(1);
  });

  it('FAIL: quarantined to inbox/failed/, one row with reason', async () => {
    const p = drop('note.bad', 'whatever');
    const row = await processFile(p, ctx());
    expect(row.status).toBe('FAIL');
    expect(row.reason).toMatch(/checksum/);
    expect(existsSync(p)).toBe(false);
    expect(readdirSync(dirs.failed)).toHaveLength(1);      // parked, not dropped
  });

  it('parser throw ⇒ FAIL row (invariant holds through crashes)', async () => {
    const p = drop('note.boom', 'x');
    const row = await processFile(p, ctx());
    expect(row.status).toBe('FAIL');
    expect(row.reason).toMatch(/exploded/);
    expect(readdirSync(dirs.failed)).toHaveLength(1);
  });

  it('UNRECOGNIZED: parked to inbox/unrecognized/, never dropped', async () => {
    const p = drop('mystery.xyz', 'unknown content');
    const row = await processFile(p, ctx());
    expect(row.status).toBe('UNRECOGNIZED');
    expect(row.parser).toBe(null);
    expect(existsSync(p)).toBe(false);
    expect(readdirSync(dirs.unrecognized)).toHaveLength(1);
    expect(readManifest(manifestPath).rows).toHaveLength(1);
  });
});

describe('dedup — two layers', () => {
  it('layer i: same bytes twice → 1 PASS + 1 DUP(of=sha), dup clone deleted', async () => {
    const p1 = drop('a.dum', 'KEY-1\nsame');
    const r1 = await processFile(p1, ctx());
    const p2 = drop('a-again.dum', 'KEY-1\nsame');         // identical bytes
    const r2 = await processFile(p2, ctx());
    expect(r1.status).toBe('PASS');
    expect(r2.status).toBe('DUP');
    expect(r2.of).toBe(r1.sha256);
    expect(r2.reason).toMatch(/sha256/);
    expect(existsSync(p2)).toBe(false);
    expect(readManifest(manifestPath).rows).toHaveLength(2);  // every intake = one row
  });

  it('layer ii: same naturalKey, different bytes → DUP(of=…)', async () => {
    const r1 = await processFile(drop('v1.dum', 'KEY-9\noriginal download'), ctx());
    const r2 = await processFile(drop('v2.dum', 'KEY-9\nre-downloaded, new metadata'), ctx());
    expect(r1.status).toBe('PASS');
    expect(r2.status).toBe('DUP');
    expect(r2.of).toBe(r1.sha256);
    expect(r2.naturalKey).toBe('KEY-9');
    expect(r2.reason).toMatch(/naturalKey/);
  });

  it('keys are parser-scoped and FAILs never establish dedup (retry after fix works)', async () => {
    // same bytes FAIL twice → two FAIL rows (retry allowed), no DUP
    const bytes = 'will fail';
    await processFile(drop('x.bad', bytes), ctx());
    const r2 = await processFile(drop('x2.bad', bytes), ctx());
    expect(r2.status).toBe('FAIL');
    const m = readManifest(manifestPath);
    expect(m.rows.filter((r) => r.status === 'FAIL')).toHaveLength(2);
  });

  it('collision in failed/: second same-named different-bytes file keeps both copies', async () => {
    await processFile(drop('same.bad', 'one'), ctx());
    // a fresh drop with the SAME name but different bytes
    await processFile(drop('same.bad', 'two'), ctx());
    const files = readdirSync(dirs.failed);
    expect(files).toHaveLength(2);                          // evidence never overwritten
  });
});

describe('dry mode', () => {
  it('parses + reports but writes/moves/deletes NOTHING', async () => {
    const p = drop('note.dum', 'KEY-D\ndry');
    const row = await processFile(p, ctx({ dry: true }));
    expect(row.status).toBe('PASS');
    expect(row.dry).toBe(true);
    expect(existsSync(p)).toBe(true);                       // file untouched
    expect(existsSync(manifestPath)).toBe(false);           // ledger untouched
  });
});

describe('manifest invariant across a mixed batch', () => {
  it('N intakes → exactly N rows, every status in the enum', async () => {
    const files = [
      drop('a.dum', 'K1\n1'), drop('b.dum', 'K1\n2'),       // PASS + key-DUP
      drop('c.bad', 'x'), drop('d.boom', 'y'),              // FAIL ×2
      drop('e.weird', 'z'),                                 // UNRECOGNIZED
      drop('f.dum', 'K2\n3'),                               // PASS
    ];
    const q = makeQueue();
    for (const f of files) q.push(() => processFile(f, ctx()));
    await q.idle();
    const m = readManifest(manifestPath);
    expect(m.rows).toHaveLength(files.length);
    for (const r of m.rows) expect(['PASS', 'FAIL', 'DUP', 'UNRECOGNIZED']).toContain(r.status);
    // nothing left loose in inbox/ root
    const loose = readdirSync(join(root, 'inbox')).filter((f) => !['failed', 'unrecognized'].includes(f));
    expect(loose).toEqual([]);
  });
});

describe('queue', () => {
  it('serializes jobs and isolates errors', async () => {
    const order = [];
    const q = makeQueue({ onError: () => order.push('err') });
    q.push(async () => { await new Promise((r) => setTimeout(r, 20)); order.push(1); });
    q.push(async () => { throw new Error('x'); });
    q.push(async () => order.push(3));
    await q.idle();
    expect(order).toEqual([1, 'err', 3]);
  });
});

describe('sniffFile', () => {
  it('returns head bytes + text + size', () => {
    const p = drop('s.dum', '%PDF-1.7 something');
    const s = sniffFile(p);
    expect(s.headText.startsWith('%PDF')).toBe(true);
    expect(s.size).toBeGreaterThan(0);
  });
});

describe('sha256', () => {
  it('buffer hash is stable', () => {
    expect(sha256Buffer(Buffer.from('abc'))).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  });
});
