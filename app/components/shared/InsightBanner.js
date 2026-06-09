'use client';
export default function InsightBanner({ text, loading }) {
  if (loading) {
    return (
      <div className="alert sec insight">
        <div className="insight-body" style={{ flex: 1 }}>
          <span>⚠</span>
          <span className="insight-shimmer" />
        </div>
        <span className="insight-tag">AI insight</span>
      </div>
    );
  }
  if (!text) return null;
  return (
    <div className="alert sec insight">
      <div className="insight-body">
        <span>⚠</span>
        <span>{text}</span>
      </div>
      <span className="insight-tag">AI insight</span>
    </div>
  );
}
