// Two-layer dedup (plan v2 §4):
//   (i)  sha256 content hash — the same bytes dropped/mailed twice;
//   (ii) parser naturalKey  — the same DOCUMENT as different bytes (a
//        re-downloaded CAS, a re-sent contract note, a re-exported payslip).
//
// Both layers compare against prior PASS rows only: a FAIL never established
// the document as ingested (re-drop after a parser fix must retry), and a DUP
// row always points at the PASS row it duplicates (no DUP-of-DUP chains).

import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { findPassBySha, findPassByNaturalKey } from './manifest.mjs';

export function sha256Buffer(buf) {
  return createHash('sha256').update(buf).digest('hex');
}

export function sha256File(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
}

// Layer (i): known bytes? → the PASS row they landed as, else null.
export function dupBySha(manifest, sha256) {
  return findPassBySha(manifest, sha256);
}

// Layer (ii): same document under a different byte stream? → the PASS row, else
// null. Only meaningful AFTER a parse produced the naturalKey; keys are scoped
// per parser id (a payslip month can never collide with a CAS period).
export function dupByNaturalKey(manifest, parserId, naturalKey) {
  return findPassByNaturalKey(manifest, parserId, naturalKey);
}
