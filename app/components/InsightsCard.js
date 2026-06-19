'use client';

// Reusable per-sleeve risk-stats card — Beta · Alpha · Sharpe · Volatility · R² ·
// Correlation, all from a weekly-history regression vs the sleeve's benchmark.
// Drop it on any tab: pass the sleeve's risk `stats` and the benchmark / title /
// risk-free via props (defaults are the Indian book vs Nifty 50). The macro-aware
// SWOT lives separately (see SwotCard) — these are the hard numbers only.

const f2 = (n) => (n == null || !isFinite(n) ? '—' : n.toFixed(2));

export default function InsightsCard({
  stats,
  title = 'Portfolio Insights',
  subtitle = 'computed from your live holdings',
  benchmark = 'Nifty 50',
  benchmarkShort = 'Nifty',
  rfPct = 6.5,
}) {
  const s = stats || {};
  const hasReg = s.hasReg;

  // Beta badge — ~1 is MARKET-level risk (not "low"); sub-1 defensive, >1 aggressive.
  const betaBadge = s.beta == null ? ['flat', '—']
    : s.beta < 0.9  ? ['low', 'DEFENSIVE']
    : s.beta <= 1.1 ? ['flat', 'MARKET']
    : s.beta < 1.4  ? ['med', 'ELEVATED'] : ['high', 'AGGRESSIVE'];
  // Volatility badge — relative to the benchmark.
  const volRatio = (hasReg && s.mktVol) ? s.vol / s.mktVol : null;
  const volBadge = volRatio == null ? ['flat', '—']
    : volRatio < 1.2 ? ['low', 'IN LINE']
    : volRatio < 1.6 ? ['med', 'ELEVATED'] : ['high', 'HIGH'];
  // Sharpe badge — risk-adjusted return quality.
  const sharpeBadge = s.sharpe == null ? ['flat', '—']
    : s.sharpe >= 1.5 ? ['low', 'STRONG']
    : s.sharpe >= 0.75 ? ['low', 'DECENT']
    : s.sharpe >= 0 ? ['med', 'THIN'] : ['high', 'NEGATIVE'];
  // Alpha — annualised return in excess of what beta predicts (a fraction).
  const alphaPct = (hasReg && s.alpha != null && isFinite(s.alpha)) ? s.alpha * 100 : null;
  const alphaBadge = alphaPct == null ? ['flat', '—'] : alphaPct >= 0 ? ['low', 'POSITIVE'] : ['high', 'NEGATIVE'];
  // R² — how much of the sleeve's moves the benchmark explains; ρ = √R² the co-movement.
  const rsq = (hasReg && s.rsq != null && isFinite(s.rsq)) ? s.rsq : null;
  const rsqBadge = rsq == null ? ['flat', '—'] : rsq >= 0.6 ? ['low', 'TIGHT'] : rsq >= 0.3 ? ['med', 'MODERATE'] : ['flat', 'LOOSE'];
  const corr = rsq == null ? null : Math.sqrt(rsq);

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
        <div>
          <div className="ctitle">{title}</div>
          <div className="sub" style={{ margin: 0 }}>{subtitle}</div>
        </div>
        <span className="ins-ai">AI</span>
      </div>

      {/* Beta · Alpha · Sharpe · Volatility · R² · Correlation */}
      <div className="ins-stats">
        <div className="ins-stat">
          <div className="lbl">Beta (β)</div>
          <div className="v">{hasReg && s.beta != null ? s.beta.toFixed(2) : '—'}</div>
          <div className="sub" style={{ marginTop: 2 }}>× {benchmark} swings</div>
          <span className={'ins-badge ' + betaBadge[0]}>{betaBadge[1]}</span>
        </div>
        <div className="ins-stat">
          <div className="lbl">Alpha (α)</div>
          <div className={'v ' + (alphaPct == null ? '' : alphaPct >= 0 ? 'grn' : 'red')}>
            {alphaPct == null ? '—' : <>{alphaPct >= 0 ? '+' : ''}{alphaPct.toFixed(1)}<small>%</small></>}
          </div>
          <div className="sub" style={{ marginTop: 2 }}>annualised excess</div>
          <span className={'ins-badge ' + alphaBadge[0]}>{alphaBadge[1]}</span>
        </div>
        <div className="ins-stat">
          <div className="lbl">Sharpe</div>
          <div className={'v ' + (s.sharpe == null ? '' : s.sharpe >= 1 ? 'grn' : s.sharpe < 0 ? 'red' : '')}>
            {s.sharpe == null ? '—' : f2(s.sharpe)}
          </div>
          <div className="sub" style={{ marginTop: 2 }}>return per unit risk</div>
          <span className={'ins-badge ' + sharpeBadge[0]}>{sharpeBadge[1]}</span>
        </div>
        <div className="ins-stat">
          <div className="lbl">Volatility</div>
          <div className="v">{hasReg ? <>{s.vol.toFixed(0)}<small>%</small></> : '—'}</div>
          <div className="sub" style={{ marginTop: 2 }}>annualised σ</div>
          <span className={'ins-badge ' + volBadge[0]}>{hasReg && s.mktVol ? `vs ${benchmarkShort} ${s.mktVol.toFixed(0)}%` : volBadge[1]}</span>
        </div>
        <div className="ins-stat">
          <div className="lbl">R²</div>
          <div className="v">{rsq == null ? '—' : rsq.toFixed(2)}</div>
          <div className="sub" style={{ marginTop: 2 }}>{benchmarkShort} explains moves</div>
          <span className={'ins-badge ' + rsqBadge[0]}>{rsqBadge[1]}</span>
        </div>
        <div className="ins-stat">
          <div className="lbl">Correlation (ρ)</div>
          <div className="v">{corr == null ? '—' : corr.toFixed(2)}</div>
          <div className="sub" style={{ marginTop: 2 }}>co-moves w/ {benchmarkShort}</div>
          <span className="ins-badge flat">{s.weeks ? s.weeks + 'w data' : '—'}</span>
        </div>
      </div>

      <div className="sub" style={{ marginTop: 14, color: 'var(--txt3)', lineHeight: 1.6 }}>
        From {s.weeks ? s.weeks + '-week' : 'recent weekly'} returns regressed on {benchmark}: β is the slope (1.00 = moves with the
        index), α the annualised return in excess of what β predicts, σ the annualised volatility, R² how much of the moves the index
        explains (ρ = √R² is the co-movement). Sharpe is the annualised return above the ~{rfPct}% risk-free rate per unit of σ
        (&gt;1 good, &gt;2 excellent). Indicative over a short window — not proven edge.
      </div>
    </div>
  );
}
