'use client';
// Global shell footer (shell-6region Phase 3): the per-tab freshness/sync provenance,
// the ITR-verified tax memo, and the app-wide disclaimer — pulled OUT of the individual
// tab bodies into ONE persistent region. The whole footer is a fixed, frosted panel
// pinned to the viewport bottom (mirrors the sticky header), so provenance + the tax
// memo stay visible on every tab regardless of scroll. Its measured height feeds
// --foot-h, which reserves matching bottom padding on the shell so content clears it.
import { useEffect, useRef } from 'react';
import FreshnessTag from './FreshnessTag';
import SyncBadge from './SyncBadge';
import CFMemo from './CFMemo';
import { fmtDateObj, sFull, inrFull, inrC } from '../../lib/fmt';

export default function ShellFooter({ tab, markets, lastUpdate, indianRec, now, FY, elssLockYears }) {
  // Feed the fixed footer's live height into --foot-h so the shell reserves matching
  // bottom padding (the panel grows/shrinks as the tax memo appears per tab).
  const ref = useRef(null);
  useEffect(() => {
    const el = ref.current; if (!el) return;
    const root = document.documentElement;
    const set = () => root.style.setProperty('--foot-h', el.offsetHeight + 'px');
    set();
    const ro = new ResizeObserver(set);
    ro.observe(el);
    window.addEventListener('resize', set);
    return () => { ro.disconnect(); window.removeEventListener('resize', set); root.style.removeProperty('--foot-h'); };
  }, []);

  // Provenance line for the active tab (MF's NAV tag stays contextual, in its value card).
  const fresh = (() => {
    switch (tab) {
      case 1: return <><SyncBadge rec={indianRec} /><FreshnessTag mode="live" marketState={{ open: markets.nse, label: `NSE ${markets.nse ? 'OPEN' : 'CLOSED'} · ${lastUpdate}` }} /></>;
      case 2: return <FreshnessTag mode="manual" date={`${fmtDateObj(now)} · accrued recalculated daily`} />;
      case 4: return <FreshnessTag mode="live" marketState={{ open: markets.nyse, label: `NYSE ${markets.nyse ? 'OPEN' : 'CLOSED'} · ${lastUpdate}` }} />;
      case 5: return <FreshnessTag mode="manual" date={`${FY.labels.current} F&O auto${FY._lastCapture ? ` · last ${FY._lastCapture}` : ' · from Mon'}${FY._chargesReal ? '' : ' · est. charges'} · ${FY.labels.verified} ITR-verified`} />;
      default: return null; // Overview / MF / Wrap carry no footer freshness tag
    }
  })();

  // ITR-verified tax memo for the active tab (relocated from the tab bodies).
  const memo = (() => {
    switch (tab) {
      case 0: return (
        <CFMemo title="Loss Carryforward — Tax Asset"
          rows={[
            { label: 'Non-spec F&O', val: sFull(-FY.cf.nonSpec), sub: FY.cf.nonSpecSub },
            { label: 'Speculative (intraday)', val: sFull(-FY.cf.speculative), sub: FY.cf.speculativeSub },
            { label: `Pool entering ${FY.labels.current}`, val: sFull(-FY.cf.poolEntering), accent: true,
              sub: `${inrFull(FY.cf.currentRealised)} realised absorbed → ${inrC(FY.cf.poolEntering - FY.cf.currentRealised)} remaining` },
          ]}
          foot="Past F&O losses filed in the ITR offset future F&O profits rupee-for-rupee — every profit the pool absorbs is tax-free until it runs out." />
      );
      case 1: return (
        <CFMemo title="Equity Tax — FY24-25 Capital Gains"
          lead="Last filed year's equity capital gains in this account (ITR):"
          rows={[
            { label: 'FY24-25 LTCG (Sec 112A)', val: '₹2,789', color: 'var(--grn)', sub: 'equity shares held >12m · within ₹1.25L exemption → nil tax' },
            { label: 'FY24-25 STCG (equity MF)', val: '₹1,083', color: 'var(--red)', sub: 'short-term loss, set off against LTCG' },
          ]}
          foot="Equity LTCG up to ₹1.25L/yr is exempt (Sec 112A) — booking gains within the limit each FY resets cost basis tax-free." />
      );
      case 3: return (
        <CFMemo title={`MF Redemption Tax — ${FY.labels.verified} Capital Gains`}
          rows={[
            { label: `${FY.labels.verified} MF redemptions`, val: FY.cf.cgVerified.mfStcg === 0 ? 'Nil' : '+₹' + FY.cf.cgVerified.mfStcg.toLocaleString('en-IN'), color: 'var(--txt2)', sub: FY.cf.cgVerified.mfStcgNote },
            { label: `STCG loss carried into ${FY.labels.current}`, val: '₹' + FY.cf.stcgCarried.toLocaleString('en-IN'), color: 'var(--grn)', sub: FY.cf.stcgNote },
          ]}
          foot={`${FY.cf.cgVerified.mfStcg === 0 ? `No redemptions in ${FY.labels.verified} — no MF capital-gains event.` : `${FY.labels.verified} redemptions taxed as capital gains.`} ELSS units stay locked ${elssLockYears} years from each SIP date; gains crystallise only on redemption.`} />
      );
      case 4: return (
        <CFMemo title={`Foreign Equity Tax — ${FY.labels.verified} Capital Gains`}
          rows={[
            { label: `${FY.labels.verified} foreign STCG`, val: '+₹' + FY.cf.cgVerified.foreignStcg.toLocaleString('en-IN'), color: 'var(--grn)', sub: FY.cf.cgVerified.foreignStcgNote },
            { label: `STCG loss carried into ${FY.labels.current}`, val: '₹' + FY.cf.stcgCarried.toLocaleString('en-IN'), color: 'var(--grn)', sub: FY.cf.stcgNote },
          ]}
          foot="Foreign equity gains are taxed at slab (STCG <24m) or 12.5% (LTCG ≥24m) — no Sec 112A exemption; US withholding on dividends is creditable via DTAA." />
      );
      default: return null; // FD / Algo / Wrap have no tax memo
    }
  })();

  return (
    // Persistent, fixed, frosted panel at the viewport bottom — provenance + ITR-verified
    // tax memo + disclaimer, all always visible (mirrors the sticky header).
    <footer className="foot-statusbar" ref={ref}>
      <div className="foot-inner">
        {memo}
        <div className="foot-bar">
          {fresh && <div className="foot-fresh">{fresh}</div>}
          <div className="foot-note">Personal tracker — figures for tracking only, not investment advice; verify against your broker &amp; official statements.</div>
        </div>
      </div>
    </footer>
  );
}
