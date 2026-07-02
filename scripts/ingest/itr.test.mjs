// itr-json extraction tests — synthetic e-filing JSONs with obviously-fake
// figures + PII. Locks: fail-loud detection (unknown form / AY / rootless /
// zero-anchor shapes), per-form anchor extraction with path provenance,
// PII-free candidate by construction, and the seed-diff verdicts.

import { describe, it, expect } from 'vitest';
import { detectItr, buildCandidate, diffAgainstSeed, getPath } from './itr.mjs';

const FAKE_ITR3 = {
  ITR: {
    ITR3: {
      Form_ITR3: { FormName: 'ITR-3', AssessmentYear: '2026' },
      PartA_GEN1: {
        PersonalInfo: { PAN: 'ABCDE1234F', AssesseeName: { FirstName: 'FAKE', SurNameOrOrgName: 'PERSON' },
                        Address: { ResidenceNo: '12', CityOrTownOrDistrict: 'FAKETOWN', PinCode: 999999 } },
      },
      ScheduleS: { TotalGrossSalary: 1500000, NetSalary: 1400000 },
      // real ITR-3 shape (verified on the filed AY2025-26 JSON): ProfBusGain heads
      'PartB-TI': { ProfBusGain: { ProfGainNoSpecBus: -513011, ProfGainSpecBus: -84307, TotProfBusGain: -597318 } },
      ScheduleCFL: { TotalLossCFSummary: { LossSummaryDetail: {
        BusLossOthThanSpecLossCF: 513011, LossFrmSpecBusCF: 84307, TotalSTCGPTILossCF: 0,
      } } },
      ScheduleCGFor23: {
        ShortTermCapGainFor23: { TotalSTCG: 29170 },
        LongTermCapGain23: { TotalLTCG: 2789 },
      },
    },
  },
};

const FAKE_ITR2 = {
  ITR: {
    ITR2: {
      Form_ITR2: { FormName: 'ITR-2', AssessmentYear: '2025' },
      ScheduleS: { TotalGrossSalary: 1200000, NetSalary: 1100000 },
      ScheduleCGFor23: { ShortTermCapGainFor23: { TotalSTCG: 1476 }, LongTermCapGain23: { TotalLTCG: 2789 } },
      ScheduleCFL: { TotalLossCFSummary: { LossSummaryDetail: { BusLossOthThanSpecLossCF: 0, LossFrmSpecBusCF: 0 } } },
    },
  },
};

describe('detectItr — fail-loud gates', () => {
  it('detects form + AY', () => {
    const d = detectItr(FAKE_ITR3);
    expect(d.form).toBe('ITR3');
    expect(d.ayLabel).toBe('AY2026-27');
  });
  it('no ITR root → loud failure', () => {
    expect(() => detectItr({ foo: 1 })).toThrow(/no root "ITR" key/);
  });
  it('unknown form → loud failure naming the shape', () => {
    expect(() => detectItr({ ITR: { ITR7: {} } })).toThrow(/unknown ITR form.*ITR7/);
  });
  it('unknown AY → loud failure demanding schema validation', () => {
    const j = structuredClone(FAKE_ITR3);
    j.ITR.ITR3.Form_ITR3.AssessmentYear = '2031';
    expect(() => detectItr(j)).toThrow(/AY 2031 has no schema entry/);
  });
  it('missing AY → loud failure', () => {
    const j = structuredClone(FAKE_ITR3);
    delete j.ITR.ITR3.Form_ITR3;
    expect(() => detectItr(j)).toThrow(/AssessmentYear missing/);
  });
});

describe('buildCandidate — extraction', () => {
  it('extracts ITR-3 anchors with path provenance', () => {
    const c = buildCandidate(FAKE_ITR3);
    expect(c.naturalKey).toBe('AY2026-27-ITR3');
    expect(c.anchors.salaryNet.value).toBe(1400000);
    expect(c.anchors.cflNonSpecCF.value).toBe(513011);
    expect(c.anchors.cflSpeculativeCF.value).toBe(84307);
    expect(c.anchors.fnoBusinessIncome.value).toBe(-513011);
    expect(c.anchors.fnoBusinessIncome.path).toBe('PartB-TI.ProfBusGain.ProfGainNoSpecBus');
    expect(c.anchors.speculativeIncome.value).toBe(-84307);
    expect(c.anchors.stcgTotal.value).toBe(29170);
  });
  it('ITR-2 extracts (no business heads) and reports the rest as missing', () => {
    const c = buildCandidate(FAKE_ITR2);
    expect(c.naturalKey).toBe('AY2025-26-ITR2');
    expect(c.anchors.stcgTotal.value).toBe(1476);
    expect(Object.keys(c.anchors)).not.toContain('fnoBusinessIncome');
    expect(c.missing).toContain('cflStcgCF');            // path absent in this fixture
  });
  it('zero anchors resolving → loud schema-shift failure', () => {
    const j = { ITR: { ITR3: { Form_ITR3: { AssessmentYear: '2026' }, SomethingElse: {} } } };
    expect(() => buildCandidate(j)).toThrow(/NONE of the known anchor paths resolved/);
  });
  it('candidate is PII-free by construction', () => {
    const blob = JSON.stringify(buildCandidate(FAKE_ITR3));
    expect(blob).not.toMatch(/ABCDE1234F|FAKE|FAKETOWN|999999/);
  });
});

describe('diffAgainstSeed', () => {
  const seed = { cf: { nonSpec: 513011, speculative: 84307, stcgCarried: 0, cgVerified: { indianStcg: 1476 } } };
  it('MATCH on equal magnitudes, DIFFERS otherwise', () => {
    const c = buildCandidate(FAKE_ITR3);
    const d = Object.fromEntries(diffAgainstSeed(c, seed).map((r) => [r.field, r.verdict]));
    expect(d['CFL non-spec business loss CF']).toBe('MATCH');
    expect(d['CFL speculative loss CF']).toBe('MATCH');
    expect(d['CFL STCG loss CF']).toBe('MATCH');
    expect(d['STCG total (Sch CG)']).toBe('DIFFERS');     // 29170 vs 1476
    expect(d['F&O business income (PartB-TI)']).toBe('SEED-MISSING');
  });
  it('NOT-EXTRACTED when the candidate lacks the anchor', () => {
    const c = buildCandidate(FAKE_ITR2);
    const d = diffAgainstSeed(c, seed).find((r) => r.field.startsWith('F&O'));
    expect(d.verdict).toBe('N/A');                        // neither side has it
  });
});

describe('getPath', () => {
  it('walks nested keys incl. dashed keys and arrays', () => {
    expect(getPath({ 'a-b': { c: [{ d: 5 }] } }, ['a-b', 'c', 0, 'd'])).toBe(5);
    expect(getPath({}, ['x', 'y'])).toBe(undefined);
  });
});
