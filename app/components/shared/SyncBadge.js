'use client';
// Visible proof of where a sleeve's numbers came from — that the broker, not a
// hand-edit, is driving qty/avg. Mirrors the FreshnessTag idiom (dot + label).
// rec = { source, syncedAt, stale, drift } from reconcileSleeve().
//   • synced, no drift → green dot, "synced · <broker> · <date>"
//   • drift            → red dot,   "<n> drifted vs <broker>"  (you traded, app stale)
//   • stale            → grey dot,  "<broker> · not synced today" (e.g. Kite login)

const MON = ['', 'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtWhen = (iso) => {
  const m = String(iso || '').match(/(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${+m[3]} ${MON[+m[2]]}` : '';
};

export default function SyncBadge({ rec, label }) {
  if (!rec || !rec.source) return null;
  const src = label || rec.source;
  const drift = (rec.drift && rec.drift.length) || 0;

  let dot, color, text;
  if (rec.stale) {
    dot = 'var(--txt3)'; color = 'var(--txt3)';
    text = `${src} · not synced today`;
  } else if (drift) {
    dot = 'var(--red)'; color = 'var(--red)';
    text = `${drift} drifted vs ${src}`;
  } else {
    dot = 'var(--grn)'; color = 'var(--txt3)';
    const when = fmtWhen(rec.syncedAt);
    text = `synced · ${src}${when ? ' · ' + when : ''}`;
  }

  return (
    <span title={drift ? rec.drift.map((d) => `${d.sym}: ${d.kind}`).join(', ') : undefined}
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 'var(--fs-xs)', color: 'var(--txt2)', fontWeight: 500, whiteSpace: 'nowrap' }}>
      <span style={{ width: 7, height: 7, borderRadius: '50%', background: dot, flexShrink: 0 }} />
      <span style={{ color }}>{text}</span>
    </span>
  );
}
