/* Dhan Algos catalog harvester — paste into the browser DevTools console while
 * logged in at https://algos.dhan.co/all-algos  (Track B, monthly, ~30 sec).
 *
 * The page caches the FULL catalog (all algos, rich fields incl. per-algo
 * correlation matrices) in sessionStorage under `dhan_all_algos_cache_v2`. We read
 * that directly — no network, no request interception. Filter to the trading styles
 * we care about, then download algo-catalog.raw.json. Drop it into data/ and run:
 *   node scripts/import-dhan-catalog.mjs
 *
 * Trading style lives in each algo's `tags` (NOT `category`):
 *   tag "Hedged" = Hedged Options · tag "Buying" = Naked Option Buying.
 * Edit STYLE below to harvest different styles (Selling, Directional, Non-directional,
 * Long-Term, Swing, …), or set it to null to harvest the whole catalog.
 *
 * STEPS: just visit /all-algos (populates the cache), paste this, press Enter.
 */
(() => {
  const STYLE = { Hedged: 'Hedged Options', Buying: 'Naked Option Buying' }; // tag → style; null = all
  const raw = sessionStorage.getItem('dhan_all_algos_cache_v2');
  if (!raw) { console.error('[harvest] cache miss — open https://algos.dhan.co/all-algos first, then re-run.'); return; }
  const all = JSON.parse(raw);
  const scoped = STYLE ? all.filter((a) => (a.tags || []).some((t) => t in STYLE)) : all;
  const by = {};
  for (const a of scoped) { const t = (a.tags || []).find((t) => !STYLE || t in STYLE); const k = STYLE ? STYLE[t] : 'all'; by[k] = (by[k] || 0) + 1; }
  const blob = new Blob([JSON.stringify(scoped, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'algo-catalog.raw.json';
  document.body.appendChild(a); a.click(); a.remove();
  console.log(`[harvest] downloaded ${scoped.length}/${all.length} algos → algo-catalog.raw.json`, by);
})();
