// Registry parser: itr-json — the user's filed ITR JSON, one per AY.
// Emits data/itr-candidate-<AY>.json (gitignored) + prints the diff vs the
// hand-verified data/fno-verified.json. It NEVER writes fno-verified.json —
// the anchor changes only on explicit user sign-off (plan v2 §3 / step e2).
// naturalKey = AY + form (re-downloaded same return = DUP).

import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildCandidate, diffAgainstSeed } from '../itr.mjs';
import { ROOT } from './py.mjs';

const SEED = join(ROOT, 'data', 'fno-verified.json');

export const itrJsonParser = {
  id: 'itr-json',
  expects: { cadence: 'annual', label: 'filed ITR JSON' },
  // content sniff is primary: an e-filing export's root key is "ITR"
  canHandle: ({ name, headText }) => /\.json$/i.test(name) && /"ITR"\s*:/.test(headText || ''),
  async run(file, { dry }) {
    let json;
    try {
      json = JSON.parse(readFileSync(file.path, 'utf8'));
    } catch (e) {
      return { status: 'FAIL', reason: `unreadable JSON: ${e.message.slice(0, 120)}` };
    }
    let candidate;
    try {
      candidate = buildCandidate(json);           // fail-loud on unknown form/AY/shape
    } catch (e) {
      return { status: 'FAIL', reason: e.message };
    }
    candidate.extractedAt = new Date().toISOString();

    const target = `data/itr-candidate-${candidate.ayLabel}.json`;
    if (!dry) writeFileSync(join(ROOT, target), JSON.stringify(candidate, null, 1));

    // Printed diff — only against figures that are ALREADY committed in the
    // seed (salary anchors stay inside the private candidate file).
    let seed = null;
    try { seed = JSON.parse(readFileSync(SEED, 'utf8')); } catch { /* no seed yet */ }
    const lines = [`itr-json ${candidate.naturalKey}: ${Object.keys(candidate.anchors).length} anchors, ${candidate.missing.length} missing${candidate.missing.length ? ` (${candidate.missing.join(', ')})` : ''}`];
    if (seed) {
      for (const d of diffAgainstSeed(candidate, seed)) {
        lines.push(`  ${d.verdict.padEnd(13)} ${d.field}: itr=${d.candidate ?? '—'} seed=${d.seed ?? '—'}`);
      }
      lines.push(`  → review ${target}; apply to fno-verified.json ONLY on your sign-off (this parser never writes the anchor).`);
    }
    console.log(lines.join('\n'));

    return {
      status: 'PASS',
      naturalKey: candidate.naturalKey,
      target: dry ? `${target} (dry)` : target,
      reason: candidate.missing.length ? `anchors missing: ${candidate.missing.join(', ')}` : null,
      parserVersion: 'itr-1',
    };
  },
};
