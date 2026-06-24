// Tests for the intraday tape upsert — the pure core of capture-intraday.
import { describe, it, expect } from 'vitest';
import { upsertPoint } from './intraday.mjs';

const pt = (t, net, byBroker = {}, pending = false) => ({ t, net, byBroker, pending });

describe('upsertPoint', () => {
  it('appends to an empty tape and rounds money to 2dp', () => {
    const j = upsertPoint({}, '2026-06-24', pt('09:20', 1234.567, { dhan: 1234.567 }));
    expect(j.days['2026-06-24']).toEqual([{ t: '09:20', net: 1234.57, dhan: 1234.57, upstox: null, fyers: null, pending: undefined }]);
  });

  it('keeps the array time-sorted regardless of insert order', () => {
    let j = upsertPoint({}, '2026-06-24', pt('10:00', 500));
    j = upsertPoint(j, '2026-06-24', pt('09:30', 200));
    j = upsertPoint(j, '2026-06-24', pt('11:15', 900));
    expect(j.days['2026-06-24'].map((p) => p.t)).toEqual(['09:30', '10:00', '11:15']);
  });

  it('REPLACES a point captured in the same minute (latest read wins)', () => {
    let j = upsertPoint({}, '2026-06-24', pt('10:11', 250));
    j = upsertPoint(j, '2026-06-24', pt('10:11', 470));
    expect(j.days['2026-06-24'].length).toBe(1);
    expect(j.days['2026-06-24'][0].net).toBe(470);
  });

  it('does not mutate the input json', () => {
    const j0 = { days: { '2026-06-24': [pt('09:20', 100)] } };
    const j1 = upsertPoint(j0, '2026-06-24', pt('09:25', 200));
    expect(j0.days['2026-06-24'].length).toBe(1); // original untouched
    expect(j1.days['2026-06-24'].length).toBe(2);
  });

  it('isolates days from each other', () => {
    let j = upsertPoint({}, '2026-06-23', pt('14:00', 1));
    j = upsertPoint(j, '2026-06-24', pt('09:20', 2));
    expect(Object.keys(j.days)).toEqual(['2026-06-23', '2026-06-24']);
  });

  it('carries the pending flag through', () => {
    const j = upsertPoint({}, '2026-06-24', pt('10:00', 5, {}, true));
    expect(j.days['2026-06-24'][0].pending).toBe(1);
  });
});
