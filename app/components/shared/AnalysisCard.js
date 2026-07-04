'use client';
import { useContext } from 'react';
import { agoShort } from '../../lib/fmt';
import { AiContext } from './AiContext';

// Per-tab AI analysis card — a macro-framed, number-free Performance read + a
// forward Outlook for the current tab (the figures live in the Macro/Pulse card,
// not here). Renders nothing when AI is off, or when the model returned nothing
// for this sleeve (so tabs stay clean with insights disabled). Carries its own
// AI tag + last-update countdown + refresh control in the top corner (from AiContext).
export default function AnalysisCard({ data, on, loading, title = 'AI analysis', accent, emptyHint, controls = null }) {
  const { ts, refresh } = useContext(AiContext);
  if (!on) return null;
  const hasContent = data && (data.performance || data.outlook);
  // With an emptyHint, render the card (so it keeps the AI tag like every other AI card) and
  // show the hint when there's no content yet; without one, stay null to keep tabs clean.
  if (!loading && !hasContent && !emptyHint) return null;
  return (
    <div className="card sec ai-card">
      <div className="ai-head">
        <span className="ai-spark">✦</span> {title}
        <span className="ai-meta">
          {ts && !loading && <span className="ai-ago" title="Last AI refresh">{agoShort(ts)}</span>}
          <button className="ins-ai" style={accent ? { '--ai-tag': accent } : undefined} onClick={refresh || undefined} disabled={loading || !refresh} title="Click to regenerate this analysis" aria-label="Regenerate AI analysis">AI</button>
        </span>
      </div>
      {/* optional control row (e.g. the Trading Review's cadence toggle, moved inside this card) */}
      {controls ? <div style={{ margin: '2px 0 10px' }}>{controls}</div> : null}
      {loading ? (
        <div className="ai-body"><div className="ins-skel" /><div className="ins-skel" /></div>
      ) : hasContent ? (
        <div className="ai-body">
          {data.performance && (
            <div className="ai-sec">
              <div className="ai-lbl">Performance</div>
              <div className="ai-txt">{data.performance}</div>
            </div>
          )}
          {data.outlook && (
            <div className="ai-sec">
              <div className="ai-lbl">Outlook</div>
              <div className="ai-txt">{data.outlook}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="ai-body"><div className="sub" style={{ lineHeight: 1.6 }}>{emptyHint}</div></div>
      )}
    </div>
  );
}
