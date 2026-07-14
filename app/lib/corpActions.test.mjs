// Corp-actions mapper. Type classification (dividend/bonus/split/rights), amount parsing
// (Rs-per-share and %-of-face-value), bonus/split ratio parsing, and the ex-date horizon
// are hand-derived so a bad parse or a leaked past/AGM row fails here, not on the wrap card.
import { describe, it, expect } from 'vitest';
import { isDividend, classify, actionRatio, dividendAmount, daysUntil, mapCorpActions } from './corpActions.mjs';

describe('isDividend', () => {
  it('matches dividends, not other actions', () => {
    expect(isDividend('Interim Dividend - Rs 12 Per Share')).toBe(true);
    expect(isDividend('Final Dividend')).toBe(true);
    expect(isDividend('Bonus 1:1')).toBe(false);
    expect(isDividend('Face Value Split')).toBe(false);
    expect(isDividend('Annual General Meeting')).toBe(false);
  });
});

describe('classify', () => {
  it('maps value-bearing subjects to a type, rest to null', () => {
    expect(classify('Interim Dividend - Rs 12 Per Share')).toBe('dividend');
    expect(classify('Bonus 1:1')).toBe('bonus');
    expect(classify('Face Value Split (Sub-Division) - From Rs 10/- To Rs 2/-')).toBe('split');
    expect(classify('Rights 1:5 @ Premium Rs 40')).toBe('rights');
    expect(classify('Annual General Meeting')).toBeNull();
    expect(classify('Board Meeting')).toBeNull();
  });
});

describe('actionRatio', () => {
  it('reads an explicit bonus/rights ratio', () => {
    expect(actionRatio('Bonus 2:1', 'bonus')).toBe('2:1');
    expect(actionRatio('Rights 1:5 @ Premium', 'rights')).toBe('1:5');
  });
  it('derives a split ratio from the face-value change', () => {
    expect(actionRatio('Face Value Split - From Rs 10/- To Rs 2/-', 'split')).toBe('5:1');
    expect(actionRatio('Sub-Division From Rs 5 To Rs 1', 'split')).toBe('5:1');
  });
  it('null when unparseable', () => {
    expect(actionRatio('Bonus Issue', 'bonus')).toBeNull();
  });
});

describe('dividendAmount', () => {
  it('parses Rs-per-share, with or without /-', () => {
    expect(dividendAmount('Interim Dividend - Rs 12 Per Share')).toBe(12);
    expect(dividendAmount('Dividend - Rs 0.65 Per Share')).toBe(0.65);
    expect(dividendAmount('Final Dividend Rs 20/- Per Share')).toBe(20);
    expect(dividendAmount('₹5 per share')).toBe(5);
  });
  it('parses a percentage of face value', () => {
    expect(dividendAmount('Interim Dividend - 250%', 10)).toBe(25);
    expect(dividendAmount('Dividend 250%')).toBeNull(); // no face value -> can't resolve
  });
  it('null when nothing parseable', () => {
    expect(dividendAmount('Dividend Per Share')).toBeNull();
  });
});

describe('daysUntil', () => {
  it('0 today, 1 tomorrow', () => {
    expect(daysUntil('13-Jul-2026', '2026-07-13')).toBe(0);
    expect(daysUntil('14-Jul-2026', '2026-07-13')).toBe(1);
    expect(daysUntil('nope', '2026-07-13')).toBeNull();
  });
});

describe('mapCorpActions', () => {
  const JSON_ = {
    data: [
      { symbol: 'TCS', comp: 'Tata Consultancy Services', subject: 'Interim Dividend - Rs 12 Per Share', exDate: '15-Jul-2026', faceVal: 1 },
      { symbol: 'KOTAKBANK', comp: 'Kotak Mahindra Bank', subject: 'Dividend - Rs 0.65 Per Share', exDate: '17-Jul-2026' },
      { symbol: 'OLDCO', comp: 'Old Co', subject: 'Dividend - Rs 5 Per Share', exDate: '01-Jul-2026' }, // past -> excluded
      { symbol: 'FARCO', comp: 'Far Co', subject: 'Dividend - Rs 3 Per Share', exDate: '30-Dec-2026' }, // beyond horizon -> excluded
      { symbol: 'BONUSCO', comp: 'Bonus Co', subject: 'Bonus 2:1', exDate: '16-Jul-2026' }, // bonus -> kept (ratio 2:1)
      { symbol: 'SPLITCO', comp: 'Split Co', subject: 'Face Value Split - From Rs 10/- To Rs 2/-', exDate: '18-Jul-2026' }, // split -> kept (5:1)
      { symbol: 'AGMCO', comp: 'AGM Co', subject: 'Annual General Meeting', exDate: '16-Jul-2026' }, // not value-bearing -> excluded
    ],
  };
  it('keeps upcoming value corp actions within the horizon, soonest first, typed', () => {
    expect(mapCorpActions(JSON_, { todayISO: '2026-07-13', horizonDays: 60 })).toEqual([
      { sym: 'TCS', name: 'Tata Consultancy Services', exDate: '15-Jul-2026', type: 'dividend', amount: 12, ratio: null },
      { sym: 'BONUSCO', name: 'Bonus Co', exDate: '16-Jul-2026', type: 'bonus', amount: null, ratio: '2:1' },
      { sym: 'KOTAKBANK', name: 'Kotak Mahindra Bank', exDate: '17-Jul-2026', type: 'dividend', amount: 0.65, ratio: null },
      { sym: 'SPLITCO', name: 'Split Co', exDate: '18-Jul-2026', type: 'split', amount: null, ratio: '5:1' },
    ]);
  });
  it('empty on no data', () => {
    expect(mapCorpActions({}, { todayISO: '2026-07-13' })).toEqual([]);
  });
});
