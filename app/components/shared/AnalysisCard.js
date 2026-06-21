'use client';
import { useContext } from 'react';
import { agoShort } from '../../lib/fmt';
import { AiContext } from './AiContext';

// Per-tab AI analysis card — a macro-framed, number-free Performance read + a
// forward Outlook for the current tab (the figures live in the Macro/Pulse card,
// not here). Renders nothing when AI is off, or when the model returned nothing
// for this sleeve (so tabs stay clean with insights disabled). Carries its own
// AI tag + last-update countdown + refresh control in the top corner (from AiContext).
export default function AnalysisCard({ data, on, loading, title = 'AI analysis' }) {
  const { ts, refresh } = useContext(AiContext);
  if (!on) return null;
  const hasContent = data && (data.performance || data.outlook);
  if (!loading && !hasContent) return null;
  return (
    <div className="card sec ai-card">
      <div className="ai-head">
        <span className="ai-spark">✦</span> {title}
        <span className="ai-meta">
          <span className="ins-ai">AI</span>
          {ts && !loading && <span className="ai-ago" title="Last AI refresh">{agoShort(ts)}</span>}
          {refresh && <button className="ai-refresh" onClick={refresh} disabled={loading} title="Regenerate this analysis" aria-label="Regenerate AI analysis">↻</button>}
        </span>
      </div>
      {loading ? (
        <div className="ai-body"><div className="ins-skel" /><div className="ins-skel" /></div>
      ) : (
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
      )}
    </div>
  );
}
