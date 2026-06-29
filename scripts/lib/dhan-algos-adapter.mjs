// Dhan Algos catalog adapter — ONE interface, two sources, one normalized shape.
//
// This is the Track-B (monthly RESEARCH) feed: the full universe of algos with
// their backtest/return/risk metrics, used to drive capital-allocation maths.
// It is NOT per-algo live P&L (that is Track A = Stratzy; see scripts/import-stratzy
// + tasks/todo.md). The user has 0 deployed on Dhan Algos, so this is the catalog.
//
// Why no direct Node fetch: the Dhan Algos search endpoint
//   POST https://algo-api.dhan.co/algo/sub/UniversalAlgoSearch
// takes an AES-ENCRYPTED request body ({entity_id,source,iv,data,aes_key,ip}) — the
// RESPONSE is plaintext JSON but the REQUEST must be produced by their client crypto.
// So the "endpoint" source is BROWSER-HARVESTED: drive the logged-in algos.dhan.co
// page, let its own JS build the encrypted request, and capture the plaintext JSON.
// Paste/CSV is the durable fallback behind the same interface.
//
// Both sources normalise to the same catalog row, so only the source swaps if the
// (unofficial) endpoint changes.

// ── helpers ──────────────────────────────────────────────────────────────────

// Coerce a Dhan field to a number: handles "30.31%", "1,20,000", "₹45000", null.
export function num(v) {
  if (v == null) return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const s = String(v).replace(/[%₹,\s]/g, '').replace(/[^0-9.+-eE]/g, '');
  if (s === '' || s === '-' || s === '.') return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

const str = (v) => (v == null ? null : String(v).trim() || null);
const bool = (v) => (v == null ? null : v === true || v === 'true' || v === 1 || v === '1' || v === 'Y');

// Some Dhan fields arrive as JSON-encoded strings (ALGO_RETURNS, ALGO_ELIGIBILITY_CHECKS,
// Tags). Parse to the live object/array, pass through if already parsed, else null.
function jsonOf(v) {
  if (v == null) return null;
  if (typeof v === 'object') return v;
  try { const p = JSON.parse(v); return typeof p === 'object' ? p : null; } catch { return null; }
}
// ALGO_RETURNS = {"1M","3M","6M","1Y","Annualized"} (string-encoded) → numeric map.
function returnsMap(v) {
  const o = jsonOf(v);
  if (!o) { const n = num(v); return n == null ? null : { Annualized: n }; }
  const out = {};
  for (const k of Object.keys(o)) { const n = num(o[k]); if (n != null) out[k] = n; }
  return Object.keys(out).length ? out : null;
}

// Find the items array inside a raw UniversalAlgoSearch response (shape-tolerant):
// accepts the bare array, {data:[…]}, or {data:{algos|results|list|items:[…]}}.
export function extractItems(raw) {
  if (Array.isArray(raw)) return raw;
  const d = raw?.data ?? raw;
  if (Array.isArray(d)) return d;
  if (d && typeof d === 'object') {
    for (const k of ['algos', 'results', 'list', 'items', 'data']) {
      if (Array.isArray(d[k])) return d[k];
    }
    // last resort: first array-of-objects value
    const arr = Object.values(d).find((v) => Array.isArray(v) && v[0] && typeof v[0] === 'object');
    if (arr) return arr;
  }
  return [];
}

// ── normalize ────────────────────────────────────────────────────────────────

// Trading-style filter (Dhan "Trading Style") lives in `tags`, NOT `category`:
//   tag "Hedged" = Hedged Options · tag "Buying" = Naked Option Buying.
const TAG_STYLE = { Hedged: 'Hedged Options', Buying: 'Naked Option Buying' };

// Map one raw algo item → canonical row. Handles BOTH source schemas + paste:
//   - sessionStorage `dhan_all_algos_cache_v2` (camelCase: id/name/algoReturns/tags/…) ← primary
//   - UniversalAlgoSearch (ALGO_*/PascalCase) and CSV rows mapped to either.
export function normalizeItem(r) {
  if (!r || typeof r !== 'object') return null;
  const id = str(r.ALGO_ID ?? r.ID ?? r.algoId ?? r.id);
  const name = str(r.STRATEGY_NAME ?? r.name ?? r.ALGO_SEO_NAME);
  if (!id && !name) return null; // not a real row
  // Correlation matrices: { "<other algo name>": coef } — kept whole for the
  // allocation maths (diversification). Large; this is a research feed, not the bundle.
  const corrOverall = jsonOf(r.OverallCorrelation ?? r.overallCorrelation);
  const corrCategory = jsonOf(r.CategoryCorrelation ?? r.categoryCorrelation);
  const tagsRaw = jsonOf(r.Tags ?? r.tags);
  const tags = Array.isArray(tagsRaw) ? tagsRaw
    : (str(r.Tags ?? r.tags) ? String(r.Tags ?? r.tags).split(/[,|]/).map((t) => t.trim()).filter(Boolean) : null);
  const ret = returnsMap(r.algoReturns ?? r.ALGO_RETURNS ?? r.returns);
  return {
    id,
    strategyId: str(r.STRATEGY_ID ?? r.strategyId),
    name,
    seoName: str(r.ALGO_SEO_NAME ?? r.AlgoSeoName ?? r.seoName),
    partner: str(r.ALGO_PARTNER_NAME ?? r.ALGO_ADDED_BY ?? r.createdBy ?? r.partner),
    category: str(r.DisplayCategory ?? r.displayCategory ?? r.ALGO_CATEGORY ?? r.category),
    // style = the Trading-Style filter the user scopes by (from tags)
    style: tags ? (tags.map((t) => TAG_STYLE[t]).find(Boolean) ?? null) : null,
    tags,
    status: str(r.ALGO_STATUS ?? r.status),
    isExpiry: bool(r.IsExpiry ?? r.isExpiry),
    isFeatured: bool(r.IsFeaturedAlgo),
    // returns — horizon map {1M,3M,6M,1Y,Annualized}
    returns: ret,
    cagr: num(r.ALGO_CAGR ?? r.cagr) ?? (ret?.Annualized ?? null),
    nav: num(r.NetAssetValue ?? r.netAssetValue),
    liveSince: str(r.LiveSince ?? r.liveSince),
    // risk
    maxDrawdown: num(r.MaxDrawdown ?? r.maxDrawdown),
    avgDrawdown: num(r.ALGO_AVG_DRAWNDOWN ?? r.avgDrawdown),
    sharpe: num(r.SharpeRatio ?? r.sharpeRatio ?? r.sharpe),
    risk: str(r.Risk ?? r.risk),
    riskReward: num(r.RiskRewardRatio ?? r.riskRewardRatio ?? r.riskReward),
    maxTimeToRecovery: num(r.MaxTimeToRecovery ?? r.maxTimeToRecovery),
    avgTimeToRecovery: num(r.AvgTimeToRecovery ?? r.avgTimeToRecovery),
    correlations: (corrOverall || corrCategory) ? { overall: corrOverall, category: corrCategory } : null,
    // trade stats
    hitRatio: num(r.ALGO_HIT_RATIO ?? r.hitRatio),
    avgProfit: num(r.ALGO_AVG_PROFIT ?? r.avgProfit),
    avgLoss: num(r.ALGO_AVG_LOSS ?? r.avgLoss),
    avgFrequency: num(r.AvgFrequency ?? r.avgFrequency),
    deployedCount: num(r.deployedCount),
    // ranking
    rank: num(r.AlgoRank ?? r.rank),
    score: num(r.AlgoScore ?? r.score),
    // capital / availability
    minCapital: num(r.ALGO_MIN_CAPITAL ?? r.minAmount ?? r.minCapital),
    maxCapital: num(r.ALGO_MAX_CAPITAL ?? r.maxCapital),
    slotsLeft: num(r.ALGO_SLOTS_LEFT ?? r.slotsLeft),
  };
}

// Normalize a set of raw items → deduped rows (by id, else name). Stable order.
export function normalizeCatalog(rawItems) {
  const seen = new Map();
  for (const raw of rawItems || []) {
    const row = normalizeItem(raw);
    if (!row) continue;
    seen.set(row.id || row.name, row);
  }
  return [...seen.values()];
}

// ── source: browser-harvest ────────────────────────────────────────────────
// `harvested` = whatever the browser saved: a raw response object, {data:…}, an
// array of items, OR an array of such responses (multiple searches accumulated).
export function fromHarvest(harvested) {
  const blobs = Array.isArray(harvested) && harvested.some((b) => b?.data || b?.status)
    ? harvested              // array of response blobs
    : [harvested];           // single blob / bare array
  const items = blobs.flatMap(extractItems);
  return normalizeCatalog(items);
}

// ── source: paste/CSV fallback ───────────────────────────────────────────────
// Minimal CSV parser (handles quoted fields + commas). Header row maps columns to
// either canonical row keys OR raw ALGO_* keys — both pass through normalizeItem.
export function parseCsv(text) {
  const rows = [];
  let field = '', row = [], inQ = false;
  const pushF = () => { row.push(field); field = ''; };
  const pushR = () => { pushF(); rows.push(row); row = []; };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else inQ = false; }
      else field += c;
    } else if (c === '"') inQ = true;
    else if (c === ',') pushF();
    else if (c === '\n') pushR();
    else if (c === '\r') { /* skip */ }
    else field += c;
  }
  if (field !== '' || row.length) pushR();
  return rows.filter((r) => r.length && r.some((c) => c.trim() !== ''));
}

export function fromPaste(csvText) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  const items = rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i]])));
  return normalizeCatalog(items);
}
