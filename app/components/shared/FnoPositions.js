'use client';
// Live F&O positions across every broker (Variant A — grouped per broker). Open
// legs show live unrealised MTM; closed-today legs show realised — both coloured
// for direction (no +/- glyphs, per house rules). Net open MTM headline. Data is
// the fnoLive() derivation (brokerState.js) — the SAME source that feeds the
// Trading-tab YTD open-MTM line, so the two never disagree.
import { cl, SInrF, InrC } from '../../lib/fmt';

// Clean instrument label: "NIFTY 24150 CE" when the strike is a field (Dhan),
// else the broker symbol with any exchange prefix stripped. Underlying + kind are
// derived from the symbol, never hardcoded.
function legLabel(r) {
  const base = String(r.sym || '').replace(/^[A-Z]+:/, '');
  const kind = r.type === 'PUT' ? 'PE' : r.type === 'CALL' ? 'CE' : r.type === 'FUT' ? 'FUT' : '';
  if (r.strike) {
    const under = (base.match(/^[A-Za-z&]+/) || ['F&O'])[0];
    return `${under} ${r.strike} ${kind}`.trim();
  }
  return base;
}

// Side chip — short=red tint, long=blue tint. NOT green: green is reserved for a
// gain, and the leg's P&L figure already carries direction by colour.
function sideChip(status) {
  if (status === 'SHORT') return { label: 'Short', bg: 'var(--red-bg)', fg: 'var(--red)' };
  if (status === 'LONG') return { label: 'Long', bg: 'var(--blu-bg)', fg: 'var(--blu)' };
  return { label: 'Closed', bg: 'var(--sur2)', fg: 'var(--txt3)' };
}

function Leg({ r, mode, asOf, first }) {
  const c = sideChip(r.status);
  const pnl = (mode === 'closed' ? r.realized : r.unrealized) || 0;
  const expiresToday = asOf && r.expiry && r.expiry === asOf;
  const meta = mode === 'closed'
    ? 'squared off today'
    : `${Math.abs(r.netQty)} qty${r.avg != null && r.avg !== 0 ? ` · avg ${r.avg}` : ''}${expiresToday ? ' · expires today' : ''}`;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 2px', borderTop: first ? 'none' : '.5px solid var(--brd2)' }}>
      <span className="badge" style={{ minWidth: 44, textAlign: 'center', background: c.bg, color: c.fg }}>{c.label}</span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ color: 'var(--txt)', fontWeight: 600, fontSize: 'var(--fs-sm)' }}>{legLabel(r)}</div>
        <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', marginTop: 2 }}>{meta}</div>
      </div>
      <div className={'mono ' + cl(pnl)} style={{ fontSize: 'var(--fs-md)', fontWeight: 600, whiteSpace: 'nowrap' }}><SInrF n={pnl} /></div>
    </div>
  );
}

function BrokerGroup({ b }) {
  const asOf = b.syncedAt ? b.syncedAt.slice(0, 10) : null;
  const expiresToday = b.open.some((r) => asOf && r.expiry && r.expiry === asOf);
  return (
    <div className="mini" style={{ marginTop: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
        <span style={{ fontSize: 'var(--fs-sm)', fontWeight: 600, color: 'var(--txt)' }}>{b.name}</span>
        {b.open.length ? <span className="badge ba">{b.open.length} open</span> : null}
        {b.closed.length ? <span className="badge bg">closed today</span> : null}
        {expiresToday ? <span className="badge br">expires today</span> : null}
        {b.syncedAt ? <span className="sub" style={{ margin: '0 0 0 auto' }}>{b.syncedAt.slice(11, 16)} IST</span> : null}
      </div>
      {b.open.map((r, i) => <Leg key={'o' + i} r={r} mode="open" asOf={asOf} first={i === 0} />)}
      {b.closed.map((r, i) => <Leg key={'c' + i} r={r} mode="closed" asOf={asOf} first={i === 0 && !b.open.length} />)}
      {b.funds ? (
        <div className="fxc" style={{ marginTop: 9, paddingTop: 8, borderTop: '.5px solid var(--brd2)' }}>
          <span className="sub" style={{ margin: 0 }}>funds</span>
          <span className="sub mono" style={{ margin: 0 }}>
            {b.funds.available != null ? <><InrC n={b.funds.available} /> avail</> : 'funds window'}
            {b.funds.utilized != null ? <> · <InrC n={b.funds.utilized} /> used</> : null}
          </span>
        </div>
      ) : null}
    </div>
  );
}

export default function FnoPositions({ data }) {
  if (!data || !data.hasAny) return null;
  const active = data.brokers.filter((b) => b.active);
  const flat = data.brokers.filter((b) => !b.active).map((b) => b.name);
  return (
    <div className="card card-accent" style={{ borderLeftColor: 'var(--acc)' }}>
      <div className="fxc" style={{ marginBottom: 12 }}>
        <div>
          <div className="ctitle">F&amp;O Positions</div>
          <div className="sub" style={{ margin: '2px 0 0' }}>Live open marks · realised on close — from the broker book</div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="lbl" style={{ margin: '0 0 2px' }}>net open MTM</div>
          <div className={'vt2 ' + cl(data.netOpenMtm)}><SInrF n={data.netOpenMtm} /></div>
        </div>
      </div>
      {active.map((b) => <BrokerGroup key={b.key} b={b} />)}
      <div style={{ fontSize: 'var(--fs-2xs)', color: 'var(--txt3)', marginTop: 10 }}>
        {flat.map((n) => `${n} · flat`).join('  ·  ')}{flat.length ? '  ·  ' : ''}Zerodha · equity only
      </div>
    </div>
  );
}
