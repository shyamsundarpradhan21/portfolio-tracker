'use client';

// Reusable macro-aware SWOT card — a MACRO READ line + Strengths / Weaknesses /
// Opportunities / Threats for one sleeve. Driven by /api/insights `*_swot`. Drop it
// on any tab and pass the sleeve's `swot` object + a `title`; `loading` shows
// skeletons during the first AI run. Scales to any sleeve — add one <SwotCard/>.

function Q({ k, label, text }) {
  return (
    <div className={'ins-q ' + k}>
      <div className="qh">◆ {label}</div>
      <div className="qt">{text || '—'}</div>
    </div>
  );
}

export default function SwotCard({ swot, title = 'SWOT', loading, accent }) {
  return (
    <div className={'card' + (accent ? ' card-accent' : '')} style={accent ? { borderLeftColor: accent } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="ctitle" style={{ margin: 0 }}>{title}</div>
        <span className="ins-ai">AI · macro-aware</span>
      </div>

      {swot ? (
        <>
          {swot.macro ? <div className="ins-macro"><span className="mh">MACRO READ</span>{swot.macro}</div> : null}
          <div className="ins-swot">
            <Q k="s" label="Strengths" text={swot.s} />
            <Q k="w" label="Weaknesses" text={swot.w} />
            <Q k="o" label="Opportunities" text={swot.o} />
            <Q k="t" label="Threats" text={swot.t} />
          </div>
        </>
      ) : loading ? (
        <div className="ins-swot" style={{ marginTop: 12 }}>
          <div className="ins-skel" /><div className="ins-skel" /><div className="ins-skel" /><div className="ins-skel" />
        </div>
      ) : (
        <div className="sub" style={{ marginTop: 12, color: 'var(--txt3)' }}>SWOT appears once AI insights run — hit refresh with the insights toggle on.</div>
      )}
    </div>
  );
}
