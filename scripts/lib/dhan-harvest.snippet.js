/* Dhan Algos catalog harvester — paste into the browser DevTools console while
 * logged in at https://algos.dhan.co/all-algos  (Track B, monthly, ~2 min).
 *
 * We can't call UniversalAlgoSearch from Node (its request body is AES-encrypted
 * client-side). So we let the PAGE issue its own (encrypted) requests and harvest
 * the PLAINTEXT JSON responses: this wraps fetch, accumulates every algo it sees,
 * then __dumpCatalog() downloads algo-catalog.raw.json. Drop that file into data/
 * and run:  node scripts/import-dhan-catalog.mjs
 *
 * STEPS:
 *   1. Paste this whole snippet, press Enter.
 *   2. Sweep the catalog so the page fetches everything: scroll the All-Algos list
 *      to the bottom, click through the category tabs/filters, and type a few broad
 *      terms in search (e.g. "credit", "spread", "swing", "options", "index").
 *      __count() shows how many unique algos captured so far.
 *   3. Run __dumpCatalog() to download algo-catalog.raw.json.
 */
(() => {
  const store = (window.__catalog ||= new Map());
  if (!window.__origFetch) window.__origFetch = window.fetch;
  window.fetch = async function (input, init) {
    const url = typeof input === 'string' ? input : input && input.url;
    const res = await window.__origFetch.apply(this, arguments);
    try {
      if (url && url.includes('UniversalAlgoSearch')) {
        const j = await res.clone().json();
        const d = j?.data ?? j;
        const arr = Array.isArray(d) ? d
          : ['algos', 'results', 'list', 'items', 'data'].map((k) => d?.[k]).find(Array.isArray)
          || Object.values(d || {}).find((v) => Array.isArray(v) && v[0] && typeof v[0] === 'object') || [];
        for (const it of arr) { const id = it.ALGO_ID ?? it.ID ?? it.STRATEGY_ID; if (id != null) store.set(String(id), it); }
        console.log(`[harvest] +${arr.length} → ${store.size} unique`);
      }
    } catch (e) { /* ignore non-json */ }
    return res;
  };
  window.__count = () => window.__catalog.size;
  window.__dumpCatalog = () => {
    const items = [...window.__catalog.values()];
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'algo-catalog.raw.json';
    a.click();
    console.log(`[harvest] downloaded ${items.length} algos → algo-catalog.raw.json`);
  };
  console.log('[harvest] fetch hooked. Sweep the catalog, check __count(), then run __dumpCatalog().');
})();
