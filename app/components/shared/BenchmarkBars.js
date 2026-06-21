'use client';

// Diverging horizontal-bar comparison of YOUR annualised return vs each benchmark —
// "you" in the accent (taller, bold), benchmarks a neutral grey, the % coloured by
// sign (direction by colour, not glyph), a centre axis so negatives read left and
// positives right. Shared by the MF / Indian / US tabs so all three depict benchmarks
// the same way. `you` + `rows[].val` are XIRR percentages (e.g. 26.8).
export default function BenchmarkBars({ you, rows = [], youLabel = 'You', accent = 'var(--acc)' }) {
  const all = [{ label: youLabel, val: you, you: true }, ...rows];
  const max = Math.max(...all.map((r) => Math.abs(r.val ?? 0)), 8) * 1.15;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {all.map(({ label, val, you: isYou }) => {
        const pos = (val ?? 0) >= 0;
        const w = val == null ? '0%' : Math.min((Math.abs(val) / max) * 100, 100) + '%';
        const fill = isYou ? accent : 'color-mix(in srgb, var(--txt3) 55%, transparent)';
        const pctTxt = val == null ? '—' : Math.abs(val).toFixed(1) + '%';
        const pctEl = (
          <span className="mono" style={{ fontSize: 'var(--fs-md)', fontWeight: isYou ? 700 : 600, padding: '0 10px', whiteSpace: 'nowrap', color: val == null ? 'var(--txt3)' : val >= 0 ? 'var(--grn)' : 'var(--red)' }}>
            {pctTxt}
          </span>
        );
        return (
          <div key={label} style={{ display: 'grid', gridTemplateColumns: 'minmax(118px, 9.5em) 1fr', gap: 12, alignItems: 'center' }}>
            <span style={{ fontSize: 'var(--fs-md)', fontWeight: isYou ? 700 : 500, color: isYou ? accent : 'var(--txt2)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{label}</span>
            <div style={{ display: 'flex', height: isYou ? '3.2em' : '2.6em', alignItems: 'center' }}>
              {/* left half: negative bar grows from the axis; % sits here for positive rows */}
              <div style={{ flex: 1, display: 'flex', justifyContent: 'flex-end', alignItems: 'center', alignSelf: 'stretch' }}>
                {val != null && !pos
                  ? <div style={{ width: w, background: fill, borderRadius: '4px 0 0 4px', alignSelf: 'stretch' }} />
                  : pctEl}
              </div>
              <div style={{ width: 1, background: 'var(--brd2)', flexShrink: 0, alignSelf: 'stretch' }} />
              {/* right half: positive bar grows from the axis; % sits here for negative rows */}
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', alignSelf: 'stretch' }}>
                {val != null && pos
                  ? <div style={{ width: w, background: fill, borderRadius: '0 4px 4px 0', alignSelf: 'stretch' }} />
                  : val != null ? pctEl : null}
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}
