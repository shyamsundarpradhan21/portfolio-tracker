// Shared dashboard markup injected into each theme file. Keeping the structure
// identical across themes means the ONLY variable being compared is the theme's
// CSS token block — a fair side-by-side.
document.getElementById('app').innerHTML = `
  <div class="layout">
    <aside class="sidebar">
      <div class="sidebar-brand">
        <div class="sidebar-logo">◈</div>
        <div>
          <div class="sidebar-title">NetWorth</div>
          <div class="sidebar-sub">Live Dashboard</div>
        </div>
      </div>
      <nav class="sidebar-nav">
        <button class="nav-item active"><span class="nav-icon">◉</span><span>Overview</span></button>
        <button class="nav-item"><span class="nav-icon">₹</span><span>Indian Stocks</span></button>
        <button class="nav-item"><span class="nav-icon">▦</span><span>Fixed Deposits</span></button>
        <button class="nav-item"><span class="nav-icon">◴</span><span>Mutual Funds</span></button>
        <button class="nav-item"><span class="nav-icon">$</span><span>US Stocks</span></button>
        <button class="nav-item"><span class="nav-icon">⚙</span><span>Algo</span></button>
        <button class="nav-item"><span class="nav-icon">↗</span><span>Projection</span></button>
      </nav>
      <div class="sidebar-footer">
        <div class="sidebar-market">
          <span class="mkt-pill mkt-closed">NSE CLOSED</span>
          <span class="mkt-pill mkt-open">NYSE OPEN</span>
        </div>
        <button class="sidebar-btn">✦ AI Insights</button>
        <button class="sidebar-btn">↻ Refresh</button>
      </div>
    </aside>

    <main class="main">
      <div class="main-header">
        <div class="topbar">
          <div class="topbar-left"><span class="pulse"></span><span class="status-txt">Updated at 08:26:27 pm</span></div>
          <div style="display:flex;gap:16px;align-items:center">
            <span class="usd">USD/INR: <strong>₹95.34</strong></span>
            <span class="upd">Last updated 08:26:27 pm</span>
          </div>
        </div>
        <div class="page-header">
          <div>
            <div class="page-header-lbl">Net worth — live ✦</div>
            <div class="hdr-val">₹16.05L</div>
            <div class="page-header-sub">Tracked assets ₹23.55L · Loan ~₹7.50L · excl. savings</div>
          </div>
          <div class="page-header-kpis">
            <div class="hkpi"><div class="hkpi-lbl">Indian Equity</div><div class="hkpi-val grn">₹4.71L</div></div>
            <div class="hkpi"><div class="hkpi-lbl">US Equity</div><div class="hkpi-val grn">$4,648</div></div>
            <div class="hkpi"><div class="hkpi-lbl">Fixed Deposits</div><div class="hkpi-val">₹5.20L</div></div>
            <div class="hkpi"><div class="hkpi-lbl">Mutual Funds</div><div class="hkpi-val grn">₹2.84L</div></div>
          </div>
        </div>
      </div>

      <div class="tab-content">
        <div class="g3">
          <div class="csm"><div class="lbl">total invested</div><div class="vmd">₹19.20L</div><div class="sub">23 holdings · 4 classes</div></div>
          <div class="csm"><div class="lbl">current value</div><div class="vmd grn">₹23.55L</div><div class="sub">live · +₹4.35L</div></div>
          <div class="csm"><div class="lbl">total return</div><div class="vmd grn">+22.6%</div><div class="sub">XIRR 18.4% annualised</div></div>
        </div>

        <div class="card">
          <div class="ctitle">Holdings</div>
          <table class="tbl">
            <thead><tr><th>Symbol</th><th class="ra">Qty</th><th class="ra">Avg</th><th class="ra">LTP</th><th class="ra">P&L</th><th class="ra">%</th></tr></thead>
            <tbody>
              <tr><td class="sym">RELIANCE</td><td class="ra mut">42</td><td class="ra mono">2,410.50</td><td class="ra mono">2,738.20</td><td class="ra grn mono">+₹13,763</td><td class="ra grn mono">+13.6%</td></tr>
              <tr><td class="sym">HDFCBANK</td><td class="ra mut">60</td><td class="ra mono">1,520.00</td><td class="ra mono">1,684.45</td><td class="ra grn mono">+₹9,867</td><td class="ra grn mono">+10.8%</td></tr>
              <tr><td class="sym">INFY</td><td class="ra mut">35</td><td class="ra mono">1,610.30</td><td class="ra mono">1,498.10</td><td class="ra red mono">−₹3,927</td><td class="ra red mono">−7.0%</td></tr>
              <tr><td class="sym">TCS</td><td class="ra mut">18</td><td class="ra mono">3,540.00</td><td class="ra mono">4,012.75</td><td class="ra grn mono">+₹8,510</td><td class="ra grn mono">+13.4%</td></tr>
              <tr><td class="sym">TATAMOTORS</td><td class="ra mut">90</td><td class="ra mono">640.20</td><td class="ra mono">982.55</td><td class="ra grn mono">+₹30,812</td><td class="ra grn mono">+53.5%</td></tr>
              <tr class="tot"><td>Total — 5</td><td></td><td></td><td></td><td class="ra grn">+₹59,025</td><td class="ra grn">+16.8%</td></tr>
            </tbody>
          </table>
        </div>

        <div class="g2">
          <div class="card">
            <div class="ctitle">Asset Allocation</div>
            <div class="bar"><div class="bar-row"><span class="bl">Indian Equity</span><span class="bv">₹4.71L · 20%</span></div><span class="trk"><span class="fil" style="width:20%;background:var(--blu)"></span></span></div>
            <div class="bar"><div class="bar-row"><span class="bl">US Equity</span><span class="bv">₹4.43L · 19%</span></div><span class="trk"><span class="fil" style="width:19%;background:var(--pur)"></span></span></div>
            <div class="bar"><div class="bar-row"><span class="bl">Fixed Deposits</span><span class="bv">₹5.20L · 22%</span></div><span class="trk"><span class="fil" style="width:22%;background:var(--grn)"></span></span></div>
            <div class="bar"><div class="bar-row"><span class="bl">Mutual Funds</span><span class="bv">₹2.84L · 12%</span></div><span class="trk"><span class="fil" style="width:12%;background:var(--acc)"></span></span></div>
          </div>
          <div class="card">
            <div class="ctitle">XIRR vs Nifty 50</div>
            <div class="xirr-grid">
              <div class="mini"><div class="lbl">Your portfolio</div><div class="big grn">18.4%</div><div class="sub">annualised</div></div>
              <div class="mini"><div class="lbl">Nifty 50</div><div class="big">12.1%</div><div class="sub">same dated rupees</div></div>
            </div>
            <div class="verdict">▲ Ahead by 6.3 pts</div>
          </div>
        </div>

        <div class="card" style="margin-bottom:60px"><div class="ctitle">Scroll to see the header fade</div><p class="sub" style="line-height:1.8">This filler block exists so you can scroll and watch the sticky header behave under each theme. Notice the contrast of cards against the background, the accent color on positive numbers, and how the monospace figures read. Pick whichever theme feels right and I'll wire it into the live app.</p></div>
      </div>
    </main>
  </div>`;
