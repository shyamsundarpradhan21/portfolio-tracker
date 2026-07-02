// Parser registry (plan v2 §3) — the ONE list of document parsers the pipeline
// knows. Each parser is a plain object:
//
//   {
//     id:         'contract-note' | 'cas-mf' | 'payslip' | 'broker-tax' | 'itr-json' | …
//     canHandle({ name, head, headText }) → bool
//                 // name = basename; head = Buffer of the file's first bytes;
//                 // headText = best-effort text of head (for content sniffing).
//                 // MUST be cheap + side-effect free — it runs on every intake.
//     run(file, { dry }) → Promise<{ status:'PASS'|'FAIL', naturalKey, target, reason?, parserVersion? }>
//                 // file = { path, name, sha256, size }. dry ⇒ parse + report
//                 // but NO store writes (no KV, no private-JSON patch, no seed).
//                 // Throwing is equivalent to returning FAIL (router catches).
//     expects:    cadence spec for the completeness report (ingest-report.mjs):
//                 { cadence:'per-trading-day'|'monthly'|'annual', ...detail }
//   }
//
// Existing proven engines are WRAPPED as parsers (never rewritten); wrappers
// live in scripts/ingest/parsers/ and register themselves via parsers/index.mjs.

export function validateParser(p) {
  const miss = ['id', 'canHandle', 'run', 'expects'].filter((k) => p?.[k] == null);
  if (miss.length) throw new Error(`parser ${p?.id || '?'} missing: ${miss.join(', ')}`);
  if (typeof p.canHandle !== 'function' || typeof p.run !== 'function') {
    throw new Error(`parser ${p.id}: canHandle/run must be functions`);
  }
  return p;
}

// First parser that claims the file wins; registry order is therefore part of
// the contract (specific sniffs before generic ones). null = UNRECOGNIZED.
export function classify(fileInfo, parsers) {
  for (const p of parsers) {
    try {
      if (p.canHandle(fileInfo)) return p;
    } catch {
      // a broken canHandle must never take the whole intake down — skip it
    }
  }
  return null;
}

// The live registry. Kept behind a function (not a top-level array import) so
// tests can inject their own parser lists and so parser modules can lazy-load
// heavier deps inside run() only.
export async function loadParsers() {
  const { PARSERS } = await import('./parsers/index.mjs');
  return PARSERS.map(validateParser);
}
