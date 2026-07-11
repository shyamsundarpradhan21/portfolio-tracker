// Tests for the note-derived realised gap-fill (applyFnoRealised).
import { describe, it, expect } from 'vitest';
import { applyFnoRealised, NOTE_REALISED_FROM } from './fnoRealised.js';

const ledger = (rows) => ({ rows });
const note = (rows) => ({ rows });

describe('applyFnoRealised', () => {
  it('fills a genuine gap: a (broker,date) the ledger has no row for', () => {
    const out = applyFnoRealised(
      ledger([{ date: '2026-04-05', broker: 'Dhan', grossRealised: 100, net: 100, chargeSource: 'real', realCharge: 0 }]),
      note([{ date: '2026-04-10', broker: 'Dhan', grossRealised: 500 }]),
    );
    const gap = out.rows.find((r) => r.date === '2026-04-10');
    expect(gap).toMatchObject({ broker: 'Dhan', sleeve: 'S01', grossRealised: 500, net: 500, source: 'note-fifo' });
    expect(out._noteRealisedApplied).toEqual({ added: 1, upgraded: 0 });
  });

  it('NEVER overrides a broker-captured row (broker wins)', () => {
    const out = applyFnoRealised(
      ledger([{ date: '2026-04-10', broker: 'Dhan', grossRealised: 9999, net: 9000, source: 'trades' }]),
      note([{ date: '2026-04-10', broker: 'Dhan', grossRealised: 500 }]),
    );
    expect(out.rows).toHaveLength(1);
    expect(out.rows[0]).toMatchObject({ grossRealised: 9999, source: 'trades' }); // untouched
    expect(out._noteRealisedApplied).toBeUndefined(); // no change → returns input
  });

  it('upgrades a charge-only opening-only day into a full realised day, keeping the real charge', () => {
    const out = applyFnoRealised(
      ledger([{ date: '2026-05-01', broker: 'Upstox', grossRealised: 0, net: -30, openingOnly: true,
        chargeSource: 'real', realCharge: 30 }]),
      note([{ date: '2026-05-01', broker: 'Upstox', grossRealised: 800 }]),
    );
    expect(out.rows[0]).toMatchObject({ grossRealised: 800, net: 770, source: 'note-fifo' }); // 800 - 30
    expect(out.rows[0].openingOnly).toBeUndefined();
    expect(out._noteRealisedApplied).toEqual({ added: 0, upgraded: 1 });
  });

  it('ignores note rows before the cutover (fragmented historical zone → broker rows)', () => {
    const out = applyFnoRealised(
      ledger([{ date: '2026-04-10', broker: 'Dhan', grossRealised: 100, net: 100 }]),
      note([{ date: '2025-01-21', broker: 'Dhan', grossRealised: 500 }]),
      NOTE_REALISED_FROM,
    );
    expect(out.rows).toHaveLength(1); // the 2025 note row is NOT added
  });

  it('is graceful: null/empty note-realised returns the ledger unchanged', () => {
    const base = ledger([{ date: '2026-04-10', broker: 'Dhan', grossRealised: 100 }]);
    expect(applyFnoRealised(base, null)).toBe(base);
    expect(applyFnoRealised(base, { rows: [] })).toBe(base);
  });
});
