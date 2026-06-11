'use client';

import { Drawer } from 'vaul';
import { X, TrendingUp, TrendingDown, Minus } from 'lucide-react';

// Bottom-sheet drawer for a single Indian equity holding.
// Trigger: pass `open`/`onClose` externally; `stock` is one row from IndianTab.
export function StockDrawer({ open, onClose, stock, flash }) {
  if (!stock) return null;

  const gain    = stock.ltp && stock.ltp !== '—' ? stock.ltp - stock.cost : null;
  const gainPct = gain != null && stock.cost ? (gain / stock.cost) * 100 : null;
  const color   = gain == null ? 'var(--txt2)' : gain >= 0 ? 'var(--grn)' : 'var(--red)';
  const TrendIcon = gain == null ? Minus : gain >= 0 ? TrendingUp : TrendingDown;
  const inr = (n) => n != null && isFinite(n) ? '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 }) : '—';

  return (
    <Drawer.Root open={open} onOpenChange={(v) => !v && onClose()} snapPoints={[0.45, 0.75]}>
      <Drawer.Portal>
        <Drawer.Overlay className="drawer-overlay" />
        <Drawer.Content className="drawer-content" aria-label={`${stock.name} details`}>
          <Drawer.Handle className="drawer-handle" />

          {/* Header */}
          <div className="drawer-header">
            <div>
              <div className="drawer-sym">{stock.sym}</div>
              <div className="drawer-name">{stock.name}</div>
            </div>
            <button className="drawer-close" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>

          {/* Price hero */}
          <div className="drawer-price-row">
            <div className="drawer-price">{stock.ltp && stock.ltp !== '—' ? inr(stock.ltp) : '—'}</div>
            <div className="drawer-gain" style={{ color }}>
              <TrendIcon size={14} strokeWidth={2} />
              {gain != null ? `${gain >= 0 ? '+' : ''}${inr(gain)} (${gainPct >= 0 ? '+' : ''}${gainPct?.toFixed(2)}%)` : '—'}
            </div>
          </div>

          {/* Stats grid */}
          <div className="drawer-stats">
            <DrawerStat label="Qty"         value={stock.qty} />
            <DrawerStat label="Avg cost"    value={inr(stock.cost)} />
            <DrawerStat label="Invested"    value={inr(stock.inv)} />
            <DrawerStat label="Value"       value={stock.value != null ? inr(stock.value) : '—'} />
            <DrawerStat label="Sector"      value={stock.sector} />
            <DrawerStat label="Market cap"  value={stock.cap} />
          </div>

          {/* XIRR / CAGR row if available */}
          {(stock.xirr != null || stock.cagr != null) && (
            <div className="drawer-stats" style={{ marginTop: 8 }}>
              {stock.xirr != null && (
                <DrawerStat label="XIRR" value={`${stock.xirr >= 0 ? '+' : ''}${stock.xirr?.toFixed(1)}%`}
                  valueColor={stock.xirr >= 0 ? 'var(--grn)' : 'var(--red)'} />
              )}
              {stock.cagr != null && (
                <DrawerStat label="CAGR" value={`${stock.cagr >= 0 ? '+' : ''}${stock.cagr?.toFixed(1)}%`}
                  valueColor={stock.cagr >= 0 ? 'var(--grn)' : 'var(--red)'} />
              )}
            </div>
          )}
        </Drawer.Content>
      </Drawer.Portal>
    </Drawer.Root>
  );
}

function DrawerStat({ label, value, valueColor }) {
  return (
    <div className="drawer-stat">
      <div className="drawer-stat-lbl">{label}</div>
      <div className="drawer-stat-val" style={valueColor ? { color: valueColor } : undefined}>
        {value ?? '—'}
      </div>
    </div>
  );
}
