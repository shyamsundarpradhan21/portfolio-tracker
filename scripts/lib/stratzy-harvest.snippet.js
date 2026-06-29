/* Stratzy daily-performance harvester — paste into DevTools console while logged in
 * at stratzy.in (your annual sub).  (monthly, ~5 sec, gentle: ONE call.)
 *
 * Stratzy's own `GET /api/web/algo/list` returns ALL ~148 algos in one response, each
 * with its full daily `performance` curve + rollingReturns30Day + backtest metrics +
 * liveSince/liveSinceBacktested (the split boundary). Auth = httpOnly session cookie +
 * AWS WAF, so this runs in the browser (credentials:'include'), NOT headless Node.
 *
 * Downloads stratzy-raw.json — drop it into data/ and run:
 *   node scripts/import-stratzy-daily.mjs
 *
 * Capture ALL 148 (no style filter); scope to your styles in the analysis, not here.
 */
(async () => {
  const r = await fetch('/api/web/algo/list', { credentials: 'include', headers: { accept: 'application/json' } });
  if (!r.ok) { console.error('[stratzy] HTTP ' + r.status + ' — are you logged in at stratzy.in?'); return; }
  const j = await r.json();
  const n = (j.data || []).length;
  if (!n) { console.error('[stratzy] empty list — check the session.'); return; }
  const blob = new Blob([JSON.stringify(j)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'stratzy-raw.json';
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`[stratzy] downloaded ${n} algos → stratzy-raw.json`);
})();
