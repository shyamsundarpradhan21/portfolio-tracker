// Tests for the intraday tape upsert — the pure core of capture-intraday.
import { describe, it, expect } from 'vitest';
import { upsertPoint, upsertGrowth } from './intraday.mjs';

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

  it('orders a US overnight tail AFTER the evening it belongs to (no lexical scramble)', () => {
    // US session crosses IST midnight: 19:39 evening … 01:14 next morning. A plain
    // string sort would put '01:14' first; the tape must stay chronological so the
    // curve draws right and tape[last] is the true latest point.
    let j = upsertPoint({}, '2026-06-24', pt('19:39', -2960));
    j = upsertPoint(j, '2026-06-24', pt('01:14', -8704));   // post-midnight, captured later
    j = upsertPoint(j, '2026-06-24', pt('20:16', -3423));
    const arr = j.days['2026-06-24'];
    expect(arr.map((p) => p.t)).toEqual(['19:39', '20:16', '01:14']);
    expect(arr[arr.length - 1].net).toBe(-8704);            // newest is last
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

  it('pending is STICKY within a minute — a later no-orders tick cannot clear it', () => {
    // mirrors the daemon: the ~1/min orders-check tick sets pending, then several
    // same-minute net-only ticks (pending:false) must not erase it.
    let j = upsertPoint({}, '2026-06-24', pt('10:00', 100, {}, true));   // orders-check tick
    j = upsertPoint(j, '2026-06-24', pt('10:00', 140, {}, false));        // net-only tick, same minute
    j = upsertPoint(j, '2026-06-24', pt('10:00', 160, {}, false));
    expect(j.days['2026-06-24'][0].pending).toBe(1);                      // still flagged
    expect(j.days['2026-06-24'][0].net).toBe(160);                        // newest net still wins
  });
});

describe('upsertGrowth', () => {
  it('writes the sleeves a run captured and stamps asOf', () => {
    const j = upsertGrowth({}, '2026-06-25', { eq: { net: 100 }, istNow: '2026-06-25T16:00:00+05:30' });
    expect(j.days['2026-06-25'].d).toBe('2026-06-25');
    expect(j.days['2026-06-25'].eq).toEqual({ net: 100 });
    expect(j.days['2026-06-25'].asOf.eq).toBe('2026-06-25T16:00:00+05:30');
  });

  it('carries forward sleeves a later run did not capture (builds one record)', () => {
    let j = upsertGrowth({}, '2026-06-25', { eq: { net: 100 }, fd: { net: 50 } }); // Indian-close run
    j = upsertGrowth(j, '2026-06-25', { us: { net: 200 } });                        // US-close run
    expect(j.days['2026-06-25'].eq).toEqual({ net: 100 });   // carried
    expect(j.days['2026-06-25'].fd).toEqual({ net: 50 });    // carried
    expect(j.days['2026-06-25'].us).toEqual({ net: 200 });   // added
  });

  it('a null/absent sleeve never wipes a good prior value (skip-not-zero)', () => {
    let j = upsertGrowth({}, '2026-06-25', { eq: { net: 100 } });
    j = upsertGrowth(j, '2026-06-25', { eq: null, us: { net: 9 } }); // eq fetch failed this run
    expect(j.days['2026-06-25'].eq).toEqual({ net: 100 });          // not wiped
    expect(j.days['2026-06-25'].us).toEqual({ net: 9 });
  });

  it('does not mutate the input json', () => {
    const j0 = { days: { '2026-06-25': { d: '2026-06-25', eq: { net: 1 } } } };
    const j1 = upsertGrowth(j0, '2026-06-25', { us: { net: 2 } });
    expect(j0.days['2026-06-25'].us).toBeUndefined();
    expect(j1.days['2026-06-25'].us).toEqual({ net: 2 });
  });
});
