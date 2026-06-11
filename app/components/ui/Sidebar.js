'use client';

import { useState, useEffect } from 'react';
import {
  LayoutDashboard, TrendingUp, Landmark, Layers,
  Globe, Bot, BarChart3, Menu, X, Sparkles,
  RefreshCw, Sun, Moon, CloudSun, Wallet
} from 'lucide-react';

const NAV = [
  { id: 0, icon: LayoutDashboard, label: 'Overview',       key: 'overview' },
  { id: 1, icon: TrendingUp,      label: 'Indian Stocks',  key: 'indian'   },
  { id: 2, icon: Landmark,        label: 'Deposits',       key: 'fd'       },
  { id: 3, icon: Layers,          label: 'Mutual Funds',   key: 'mf'       },
  { id: 4, icon: Globe,           label: 'US Stocks',      key: 'us'       },
  { id: 5, icon: Bot,             label: 'Algo',           key: 'algo'     },
];

export default function Sidebar({
  tab, selectTab,
  markets, status, pulseCls, lastUpdate,
  insightsOn, toggleInsights,
  themeMode, cycleTheme,
  loading, onRefresh,
  ov, fxRate, indian, usData, mf, fds, pfValue,
}) {
  const [open, setOpen] = useState(false);

  // Close drawer on tab select (mobile)
  const pick = (id) => { selectTab(id); setOpen(false); };

  // Overlay click closes on mobile
  useEffect(() => {
    if (!open) return;
    const fn = (e) => { if (e.key === 'Escape') setOpen(false); };
    window.addEventListener('keydown', fn);
    return () => window.removeEventListener('keydown', fn);
  }, [open]);

  const ThemeIcon = themeMode === 'day' ? Sun : themeMode === 'night' ? Moon : CloudSun;

  // Value badges shown next to each nav item
  const badges = {
    0: null,
    1: indian.valued ? inrK(indian.val) : null,
    2: fds ? inrK(fds.principal + fds.accrued + fds.maturedCash) : null,
    3: mf?.totVal ? inrK(mf.totVal) : null,
    4: usData?.val && fxRate ? inrK(usData.val * fxRate) : null,
    5: null,
  };

  return (
    <>
      {/* ── Mobile top bar ─────────────────────────────────────────────── */}
      <div className="sb-mobile-bar">
        <span className="sb-wordmark">wealth-os</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button className="sb-icon-btn" onClick={() => onRefresh()} aria-label="Refresh">
            <RefreshCw size={15} className={loading ? 'spin' : ''} />
          </button>
          <button className="sb-icon-btn" onClick={() => setOpen(true)} aria-label="Open menu">
            <Menu size={18} />
          </button>
        </div>
      </div>

      {/* ── Mobile overlay ─────────────────────────────────────────────── */}
      {open && (
        <div className="sb-overlay" onClick={() => setOpen(false)} aria-hidden />
      )}

      {/* ── Sidebar ────────────────────────────────────────────────────── */}
      <aside className={`sidebar${open ? ' open' : ''}`} aria-label="Main navigation">
        {/* Header */}
        <div className="sb-head">
          <div className="sb-wordmark">wealth-os</div>
          <button className="sb-icon-btn sb-close-btn" onClick={() => setOpen(false)} aria-label="Close menu">
            <X size={16} />
          </button>
        </div>

        {/* Status dot */}
        <div className="sb-status">
          <div className={pulseCls} />
          <span className="sb-status-txt">{status.msg}</span>
        </div>

        {/* Nav items */}
        <nav className="sb-nav" role="navigation">
          {NAV.map(({ id, icon: Icon, label, key }) => (
            <button
              key={id}
              className={`sb-item${tab === id ? ' active' : ''}`}
              data-tab={key}
              onClick={() => pick(id)}
              aria-current={tab === id ? 'page' : undefined}
            >
              <Icon size={16} className="sb-item-icon" strokeWidth={tab === id ? 2.2 : 1.8} />
              <span className="sb-item-label">{label}</span>
              {badges[id] && <span className="sb-badge">{badges[id]}</span>}
            </button>
          ))}
        </nav>

        {/* Spacer */}
        <div style={{ flex: 1 }} />

        {/* Market status */}
        <div className="sb-footer">
          <div className="sb-mkt-row">
            <span className={`live-dot${markets?.nse ? ' on' : ''}`} />
            <span className="sb-mkt-lbl">NSE</span>
            <span className={`sb-mkt-val${markets?.nse ? ' open' : ''}`}>
              {markets?.nse ? 'Open' : 'Closed'}
            </span>
          </div>
          <div className="sb-mkt-row">
            <span className={`live-dot${markets?.nyse ? ' on' : ''}`} />
            <span className="sb-mkt-lbl">NYSE</span>
            <span className={`sb-mkt-val${markets?.nyse ? ' open' : ''}`}>
              {markets?.nyse ? 'Open' : 'Closed'}
            </span>
          </div>
          {fxRate > 0 && (
            <div className="sb-mkt-row">
              <span className="sb-mkt-lbl" style={{ color: 'var(--txt3)' }}>USD/INR</span>
              <span className="sb-mkt-val">{fxRate.toFixed(1)}</span>
            </div>
          )}
          <div className="sb-actions">
            <button
              className={`sb-icon-btn${insightsOn ? ' active' : ''}`}
              onClick={toggleInsights}
              title={`AI insights ${insightsOn ? 'on' : 'off'}`}
              aria-pressed={insightsOn}
            >
              <Sparkles size={14} />
            </button>
            <button
              className="sb-icon-btn"
              onClick={cycleTheme}
              title={`Theme: ${themeMode}`}
            >
              <ThemeIcon size={14} />
            </button>
            <button
              className={`sb-icon-btn${loading ? ' loading' : ''}`}
              onClick={() => onRefresh()}
              title="Refresh prices"
              aria-label="Refresh"
            >
              <RefreshCw size={14} className={loading ? 'spin' : ''} />
            </button>
          </div>
          <div className="sb-update">{lastUpdate}</div>
        </div>
      </aside>
    </>
  );
}

// Compact INR formatter: 9,58,000 → ₹9.6L
function inrK(n) {
  if (!n || !isFinite(n)) return null;
  if (n >= 1e7) return `₹${(n / 1e7).toFixed(1)}Cr`;
  if (n >= 1e5) return `₹${(n / 1e5).toFixed(1)}L`;
  return `₹${Math.round(n / 1000)}K`;
}
