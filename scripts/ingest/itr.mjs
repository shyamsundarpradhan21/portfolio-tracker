// ITR-JSON anchor extraction (plan v2 §3 `itr-json`, step e2).
//
// The filed ITR JSON is the AUTHORITY ANCHOR of the whole reconcile chain
// (plan step j) and the most PII-dense document in the pipeline (PAN, address,
// bank accounts, Aadhaar linkage). Discipline:
//   • anchors are extracted by EXPLICIT per-form path tables — nothing under
//     PartA_GEN1/PersonalInfo is ever read, so the candidate is PII-free by
//     construction;
//   • unknown form / unknown AY / rootless JSON FAILS LOUDLY (schema shifts
//     between AYs are expected — extend the tables, never guess silently);
//   • within a known form, each anchor lists ALTERNATIVE paths (AY-to-AY key
//     drift); what didn't resolve is reported in `missing`, and every resolved
//     anchor carries the exact path it came from (auditability).
//   • the output is a CANDIDATE (data/itr-candidate-<AY>.json, gitignored) +
//     a diff vs the hand-verified seed. This module NEVER writes
//     data/fno-verified.json — applying the candidate is a user sign-off step.

export const KNOWN_FORMS = ['ITR3', 'ITR2'];
// AssessmentYear as the e-filing JSON spells it (start year). Extend each year
// AFTER validating the new shape — an unlisted AY refuses to parse (fail-loud).
export const KNOWN_AYS = ['2024', '2025', '2026'];

const num = (v) => {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

export function getPath(obj, path) {
  let cur = obj;
  for (const k of path) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = cur[k];
  }
  return cur;
}

function firstHit(root, paths) {
  for (const p of paths) {
    const v = num(getPath(root, p));
    if (v != null) return { value: v, path: p.join('.') };
  }
  return null;
}

// ── per-form anchor path tables ──────────────────────────────────────────────
// Path spellings follow the official e-filing JSON schema families; per-AY key
// drift is handled by listing alternatives. A wrong/renamed path shows up as
// `missing` (loud in the run output), never as a silently-wrong number.
const CG_COMMON = {
  stcgTotal: [
    ['ScheduleCGFor23', 'ShortTermCapGainFor23', 'TotalSTCG'],
    ['ScheduleCG', 'ShortTermCapGain', 'TotalSTCG'],
  ],
  ltcgTotal: [
    ['ScheduleCGFor23', 'LongTermCapGain23', 'TotalLTCG'],
    ['ScheduleCG', 'LongTermCapGain', 'TotalLTCG'],
  ],
  stcg111A: [
    ['ScheduleCGFor23', 'ShortTermCapGainFor23', 'EquityMFonSTT', 0, 'EquityMFonSTTDtls', 'CapgainonAssets'],
    ['ScheduleCGFor23', 'ShortTermCapGainFor23', 'SaleOnOtherAssets', 'CapgainonAssets'],
  ],
};
const CFL_COMMON = {
  cflNonSpecCF: [
    ['ScheduleCFL', 'TotalLossCFSummary', 'LossSummaryDetail', 'BusLossOthThanSpecLossCF'],
    ['ScheduleCFL', 'TotalLossCFSummary', 'LossSummaryDetail', 'TotalBusLossCF'],
  ],
  cflSpeculativeCF: [
    ['ScheduleCFL', 'TotalLossCFSummary', 'LossSummaryDetail', 'LossFrmSpecBusCF'],
    ['ScheduleCFL', 'TotalLossCFSummary', 'LossSummaryDetail', 'TotalSpecLossCF'],
  ],
  cflStcgCF: [
    ['ScheduleCFL', 'TotalLossCFSummary', 'LossSummaryDetail', 'TotalSTCGPTILossCF'],
    ['ScheduleCFL', 'TotalLossCFSummary', 'LossSummaryDetail', 'STCGLossCF'],
  ],
};
const SALARY_COMMON = {
  salaryGross: [['ScheduleS', 'TotalGrossSalary'], ['ScheduleS', 'GrossSalary']],
  salaryNet: [['ScheduleS', 'NetSalary']],
};

export const ITR_SCHEMAS = {
  ITR3: {
    ...SALARY_COMMON,
    ...CG_COMMON,
    ...CFL_COMMON,
    // Verified against the user's REAL filed ITR-3s (AY2024-25 + AY2025-26).
    // ScheduleBP FIRST: it carries the SIGNED net P&L (a loss year reads
    // −391068 there while the PartB-TI head floors at 0) — the reconcile
    // invariant (notes must SUM to the FY schedule) needs the signed figure.
    fnoBusinessIncome: [
      ['ITR3ScheduleBP', 'BusinessIncOthThanSpec', 'NetPLBusOthThanSpec7A7B7C'],
      ['PartB-TI', 'ProfBusGain', 'ProfGainNoSpecBus'],
    ],
    speculativeIncome: [
      ['ITR3ScheduleBP', 'SpecBusinessInc', 'AdjustedPLFrmSpecuBus'],
      ['PartB-TI', 'ProfBusGain', 'ProfGainSpecBus'],
    ],
  },
  ITR2: {           // no business income heads on ITR-2
    ...SALARY_COMMON,
    ...CG_COMMON,
    ...CFL_COMMON,
  },
};

// ── detection (fail-loud) ─────────────────────────────────────────────────────
export function detectItr(json) {
  const itr = json?.ITR;
  if (!itr || typeof itr !== 'object') {
    throw new Error('not an e-filing ITR JSON (no root "ITR" key)');
  }
  const form = Object.keys(itr).find((k) => KNOWN_FORMS.includes(k));
  if (!form) {
    throw new Error(`unknown ITR form(s) [${Object.keys(itr).join(', ')}] — known: ${KNOWN_FORMS.join('/')}. Validate the new shape, then extend KNOWN_FORMS/ITR_SCHEMAS.`);
  }
  const root = itr[form];
  const ay = String(getPath(root, [`Form_${form}`, 'AssessmentYear']) ?? getPath(root, ['Form_ITR', 'AssessmentYear']) ?? '');
  if (!/^\d{4}$/.test(ay)) {
    throw new Error(`ITR ${form}: AssessmentYear missing/unreadable — schema shift, validate before extending`);
  }
  if (!KNOWN_AYS.includes(ay)) {
    throw new Error(`ITR ${form} AY ${ay} has no schema entry — validate this AY's shape, then add it to KNOWN_AYS`);
  }
  const ayLabel = `AY${ay}-${String((+ay + 1) % 100).padStart(2, '0')}`;
  return { form, ay, ayLabel, root };
}

// ── extraction ────────────────────────────────────────────────────────────────
export function buildCandidate(json) {
  const { form, ay, ayLabel, root } = detectItr(json);
  const table = ITR_SCHEMAS[form];
  const anchors = {};
  const missing = [];
  for (const [key, paths] of Object.entries(table)) {
    const hit = firstHit(root, paths);
    if (hit) anchors[key] = hit;
    else missing.push(key);
  }
  if (Object.keys(anchors).length === 0) {
    throw new Error(`ITR ${form} ${ayLabel}: NONE of the known anchor paths resolved — the AY schema shifted; update ITR_SCHEMAS before trusting this file`);
  }
  return { ay, ayLabel, form, naturalKey: `${ayLabel}-${form}`, anchors, missing };
}

// ── diff vs the hand-verified seed (indicative mapping; user signs off) ──────
// Only fields whose seed counterparts are ALREADY committed figures are diffed
// in printable output; salary anchors stay in the candidate file (private).
export function diffAgainstSeed(candidate, seed) {
  const a = candidate.anchors;
  const cmp = [
    ['CFL non-spec business loss CF', a.cflNonSpecCF?.value, seed?.cf?.nonSpec],
    ['CFL speculative loss CF', a.cflSpeculativeCF?.value, seed?.cf?.speculative],
    ['CFL STCG loss CF', a.cflStcgCF?.value, seed?.cf?.stcgCarried],
    ['STCG total (Sch CG)', a.stcgTotal?.value, seed?.cf?.cgVerified?.indianStcg],
    ['F&O business income (PartB-TI)', a.fnoBusinessIncome?.value, null],
  ];
  return cmp.map(([field, cand, sv]) => {
    let verdict;
    if (cand == null && sv == null) verdict = 'N/A';
    else if (cand == null) verdict = 'NOT-EXTRACTED';
    else if (sv == null) verdict = 'SEED-MISSING';
    else verdict = Math.abs(Math.abs(cand) - Math.abs(sv)) < 1 ? 'MATCH' : 'DIFFERS';
    return { field, candidate: cand, seed: sv, verdict };
  });
}
