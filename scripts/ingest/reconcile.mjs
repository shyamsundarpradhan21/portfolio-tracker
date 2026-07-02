// Old-figures reconciliation (plan v2 step j) — PURE functions, REPORT-ONLY.
// Nothing here writes anywhere; corrections go through the normal
// edit-private-JSON → guarded-seed path after user sign-off.
//
// Authority order (top wins): parsed ITR JSON (the filed return itself) →
// checksum-PASS parsed docs → broker API state → hand-curated entries.
// A contradiction with the ITR anchor = suspect parser/coverage FIRST.
//
// Basis differences are surfaced, never papered over:
//   ITR F&O business income = NET of expenses (the filed figure);
//   broker-tax fno_realized = GROSS FIFO by sell-date FY;
//   fno-ledger net          = gross − modeled/real charges (overlay).
//   ITR Schedule S NetSalary = gross − s16 deductions (NOT take-home);
//   PAYSLIPS.net             = take-home after TDS/PF.

export const fyOfAy = (ayLabel) => {
  const m = /^AY(\d{4})-(\d{2})$/.exec(ayLabel || '');
  if (!m) return null;
  const y = +m[1] - 1;
  return `FY${String(y).slice(2)}-${String(y + 1).slice(2)}`;
};

export const fyOfMonth = (month) => {
  const [y, mo] = String(month).split('-').map(Number);
  if (!y || !mo) return null;
  const s = mo >= 4 ? y : y - 1;
  return `FY${String(s).slice(2)}-${String(s + 1).slice(2)}`;
};

export function sumLedgerByFy(rows) {
  const out = {};
  for (const r of rows || []) {
    const fy = fyOfMonth(String(r.date).slice(0, 7));
    if (!fy) continue;
    const d = (out[fy] ||= { net: 0, gross: 0, days: 0, realCharged: 0 });
    d.net += r.net ?? ((r.grossRealised || 0) - (r.estCharges || 0));
    d.gross += r.grossRealised || 0;
    d.days++;
    if (r.chargeSource === 'real') d.realCharged++;
  }
  for (const d of Object.values(out)) { d.net = Math.round(d.net); d.gross = Math.round(d.gross); }
  return out;
}

export function sumPayslipsByFy(payslips) {
  const out = {};
  for (const p of payslips || []) {
    const fy = fyOfMonth(p.month);
    if (!fy) continue;
    (out[fy] ||= { net: 0, months: 0 });
    out[fy].net += p.net || 0;
    out[fy].months++;
  }
  for (const d of Object.values(out)) d.net = Math.round(d.net);
  return out;
}

// verdict bands: charges/basis noise vs real drift
export function verdict(a, b, { matchTol = 100, nearTol = 5000 } = {}) {
  if (a == null || b == null) return 'N/A';
  const d = Math.abs(a - b);
  return d <= matchTol ? 'MATCH' : d <= nearTol ? 'NEAR' : 'DRIFT';
}

// ── the report model ──────────────────────────────────────────────────────────
export function buildReconcile({ candidates = [], seed, ledgerRows = [], brokerTaxFno, payslips = [], overlayCount = null, mfLedgerKeys = [], privateAsOf = {} }) {
  const ledgerByFy = sumLedgerByFy(ledgerRows);
  const payslipByFy = sumPayslipsByFy(payslips);
  const btByFy = Object.fromEntries((brokerTaxFno?.fy || []).map((f) => [f.label, f.amt]));

  // 1) F&O per FY — ITR anchor (authority) vs ledger net vs broker-tax gross
  const fno = [];
  for (const c of candidates) {
    const fy = fyOfAy(c.ayLabel);
    const itr = c.anchors?.fnoBusinessIncome?.value ?? null;
    const spec = c.anchors?.speculativeIncome?.value ?? null;
    const itrTotal = itr == null && spec == null ? null : (itr || 0) + (spec || 0);
    const led = ledgerByFy[fy]?.net ?? null;
    const bt = btByFy[fy] ?? null;
    fno.push({
      fy, ay: c.ayLabel,
      itrNet: itrTotal, itrNonSpec: itr, itrSpec: spec,
      ledgerNet: led, brokerTaxGross: bt,
      vsLedger: verdict(itrTotal, led),
      note: 'ITR=net of expenses · ledger=net of est/real charges · broker-tax=GROSS FIFO — bases differ by construction; DRIFT beyond charges scale = suspect coverage first',
    });
  }

  // 2) Salary per FY — Schedule S vs payslip take-home (bases differ: INFO row,
  // hard-flag only the impossible case take-home > ITR gross)
  const salary = [];
  for (const c of candidates) {
    const fy = fyOfAy(c.ayLabel);
    const gross = c.anchors?.salaryGross?.value ?? null;
    const net = c.anchors?.salaryNet?.value ?? null;
    const slips = payslipByFy[fy] || null;
    salary.push({
      fy, ay: c.ayLabel, itrGross: gross, itrNet: net,
      payslipTakeHome: slips?.net ?? null, payslipMonths: slips?.months ?? 0,
      flag: gross != null && slips?.net != null && slips.net > gross ? 'IMPOSSIBLE (take-home > ITR gross) — parser or slip coverage wrong' : null,
    });
  }

  // 3) CFL vs the hand-verified seed
  const cfl = [];
  for (const c of candidates) {
    const a = c.anchors || {};
    cfl.push({
      ay: c.ayLabel,
      nonSpec: { itr: a.cflNonSpecCF?.value ?? null, seed: seed?.cf?.nonSpec ?? null, verdict: verdict(a.cflNonSpecCF?.value, seed?.cf?.nonSpec, { matchTol: 1 }) },
      speculative: { itr: a.cflSpeculativeCF?.value ?? null, seed: seed?.cf?.speculative ?? null, verdict: verdict(a.cflSpeculativeCF?.value, seed?.cf?.speculative, { matchTol: 1 }) },
      stcg: { itr: a.cflStcgCF?.value ?? null, seed: seed?.cf?.stcgCarried ?? null, verdict: verdict(a.cflStcgCF?.value, seed?.cf?.stcgCarried, { matchTol: 1 }) },
    });
  }
  // NB: the LATEST AY's CFL is the one comparable to the seed (cf = entering
  // the current FY); earlier AYs are historical context.
  const latestAy = candidates.map((c) => c.ayLabel).sort().at(-1) || null;

  // 4) F&O charges coverage (real contract-note overlay vs modeled)
  const totalDays = Object.values(ledgerByFy).reduce((s, d) => s + d.days, 0);
  const charges = {
    ledgerDays: totalDays,
    overlayEntries: overlayCount,          // null = KV unreadable offline
    note: 'backfilled notes extend ledger:fno:overlay via build-fno-overlay.mjs — re-run after the Gmail backfill and compare',
  };

  // 5) MF vs CAS — pending the first real CAS ingestion
  const mf = {
    casIngested: mfLedgerKeys.length,
    status: mfLedgerKeys.length ? 'diff pending implementation of folio-level compare' : 'PENDING — no CAS ingested yet (drop a since-inception detailed CAS)',
    guard: 'apply corp-action/dividend-reinvest adjustments BEFORE flagging any unit/cost drift (CUB lesson: a raw mismatch is not drift)',
  };

  // 6) out-of-scope stores — staleness only, figures untouched
  const staleness = Object.entries(privateAsOf).map(([k, asOf]) => ({ store: k, asOf: asOf || null }));

  return { authority: 'parsed ITR JSON → checksum-PASS docs → broker API → hand-curated', latestAy, fno, salary, cfl, charges, mf, staleness };
}
