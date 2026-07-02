// Fixture tests for the PURE gmail helpers (no network, no googleapis import —
// the lazy imports in gmail.mjs only fire inside the daemon-only functions).

import { describe, it, expect, afterEach } from 'vitest';
import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  pdfAttachments, newMessageIdsFromHistory, isHistoryGone, safeName,
  readGmailState, writeGmailState, backfillQuery,
} from './gmail.mjs';

describe('pdfAttachments', () => {
  it('selects real PDFs out of a nested multipart, skips inline noise', () => {
    const message = {
      payload: {
        mimeType: 'multipart/mixed',
        parts: [
          { mimeType: 'multipart/alternative', parts: [
            { mimeType: 'text/plain', body: { size: 120 } },
            { mimeType: 'text/html', body: { size: 890 },
              parts: [{ filename: 'logo.png', mimeType: 'image/png', body: { attachmentId: 'IMG', size: 4000 } }] },
          ] },
          { filename: 'ContractNote_2026-07-01.pdf', mimeType: 'application/pdf',
            body: { attachmentId: 'ATT1', size: 182000 } },
          // servers sometimes mislabel the mime — filename wins
          { filename: 'CAS_JUN2026.PDF', mimeType: 'application/octet-stream',
            body: { attachmentId: 'ATT2', size: 96000 } },
          // a pdf part WITHOUT an attachmentId (inlined) can't be downloaded — skip
          { filename: 'preview.pdf', mimeType: 'application/pdf', body: { size: 10 } },
        ],
      },
    };
    const got = pdfAttachments(message);
    expect(got.map((a) => a.attachmentId)).toEqual(['ATT1', 'ATT2']);
    expect(got[0].filename).toBe('ContractNote_2026-07-01.pdf');
  });

  it('empty / malformed message → []', () => {
    expect(pdfAttachments(null)).toEqual([]);
    expect(pdfAttachments({})).toEqual([]);
  });
});

describe('newMessageIdsFromHistory', () => {
  it('extracts messagesAdded ids, deduped, in order', () => {
    const resp = { history: [
      { messagesAdded: [{ message: { id: 'm1' } }, { message: { id: 'm2' } }] },
      { labelsAdded: [{ message: { id: 'mX' } }] },              // not an add — ignored
      { messagesAdded: [{ message: { id: 'm2' } }, { message: { id: 'm3' } }] },
    ] };
    expect(newMessageIdsFromHistory(resp)).toEqual(['m1', 'm2', 'm3']);
  });
  it('no history → []', () => {
    expect(newMessageIdsFromHistory({})).toEqual([]);
  });
});

describe('isHistoryGone', () => {
  it('404 in any of the usual shapes → gap', () => {
    expect(isHistoryGone({ code: 404 })).toBe(true);
    expect(isHistoryGone({ status: 404 })).toBe(true);
    expect(isHistoryGone({ response: { status: 404 } })).toBe(true);
    expect(isHistoryGone({ code: '404' })).toBe(true);
  });
  it('other errors are NOT gaps', () => {
    expect(isHistoryGone({ code: 500 })).toBe(false);
    expect(isHistoryGone(new Error('network'))).toBe(false);
  });
});

describe('safeName', () => {
  it('windows-safe + msgId-prefixed so same-named attachments never collide', () => {
    const n = safeName('Contract:Note*2026?.pdf', '18c2fabc99887766');
    expect(n).toBe('99887766-Contract_Note_2026_.pdf');
  });
  it('handles missing filename', () => {
    expect(safeName('', 'abcd1234')).toMatch(/attachment\.pdf$/);
  });
});

describe('backfillQuery', () => {
  it('builds an inclusive after/before window (before is exclusive → +1 day)', () => {
    expect(backfillQuery('2024-01-01', '2026-06-30')).toBe('after:2024/01/01 before:2026/07/01');
  });
  it('open --to defaults to now', () => {
    expect(backfillQuery('2024-01-01')).toMatch(/^after:2024\/01\/01 before:\d{4}\/\d{2}\/\d{2}$/);
  });
  it('fails loudly on malformed or reversed dates', () => {
    expect(() => backfillQuery('2024-13-01', '2026-01-01')).toThrow(/not a real date|--from/);
    expect(() => backfillQuery(undefined)).toThrow(/--from must be YYYY-MM-DD/);
    expect(() => backfillQuery('2026-06-01', '2024-01-01')).toThrow(/after --to/);
  });
});

describe('gmail state', () => {
  let dir;
  afterEach(() => dir && rmSync(dir, { recursive: true, force: true }));

  it('roundtrip + missing → defaults', () => {
    dir = mkdtempSync(join(tmpdir(), 'gmail-state-'));
    const p = join(dir, 'gmail-state.json');
    expect(readGmailState(p)).toEqual({ lastHistoryId: null, done: {}, backfill: {} });
    writeGmailState({ lastHistoryId: '123', done: { m1: '2026-07-02' }, backfill: {} }, p);
    expect(existsSync(p)).toBe(true);
    expect(readGmailState(p).lastHistoryId).toBe('123');
    expect(readGmailState(p).done.m1).toBe('2026-07-02');
  });

  it('prunes the seen-map so state cannot grow unbounded', () => {
    dir = mkdtempSync(join(tmpdir(), 'gmail-state-'));
    const p = join(dir, 'gmail-state.json');
    const done = Object.fromEntries(Array.from({ length: 4500 }, (_, i) => [`m${i}`, `2026-01-01T00:00:${String(i % 60).padStart(2, '0')}`]));
    writeGmailState({ lastHistoryId: '9', done, backfill: {} }, p);
    const back = readGmailState(p);
    expect(Object.keys(back.done).length).toBeLessThanOrEqual(2000);
  });
});
