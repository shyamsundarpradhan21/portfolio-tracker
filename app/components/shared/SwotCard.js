'use client';
import { useContext } from 'react';
import { agoShort } from '../../lib/fmt';
import { AiContext } from './AiContext';

// Reusable macro-aware SWOT card — a MACRO READ line + Strengths / Weaknesses /
// Opportunities / Threats for one sleeve. Driven by /api/insights `*_swot`. Drop it
// on any tab and pass the sleeve's `swot` object + a `title`; `loading` shows
// skeletons during the first AI run. The AI tag doubles as the refresh button, with
// the last-update countdown beside it (from AiContext).

function Q({ k, label, text }) {
  return (
    <div className={'ins-q ' + k}>
      <div className="qh">◆ {label}</div>
      <div className="qt">{text || '—'}</div>
    </div>
  );
}

export default function SwotCard({ swot, title = 'SWOT', loading, accent }) {
  const { ts, refresh } = useContext(AiContext);
  return (
    <div className={'card' + (accent ? ' card-accent' : '')} style={accent ? { borderLeftColor: accent } : undefined}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
        <div className="ctitle" style={{ margin: 0 }}>{title}</div>
        <span className="ai-meta">
          {ts && <span className="ai-ago" title="Last AI refresh">{agoShort(ts)}</span>}
          <button className="ins-ai" style={accent ? { '--ai-tag': accent } : undefined} onClick={refresh || undefined} disabled={!refresh} title="Click to regenerate this analysis" aria-label="Regenerate AI analysis">AI · macro-aware</button>
        </span>
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
