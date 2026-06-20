# Live "macros in wrap" — replace the manual Kite snapshot with live keyless feeds

## Origin / intent
- Entry point: "Koyfin-like data" → agreed approach is **keyless free feeds, no scraping**.
- Near-term goal (user's words): *"replace our macros in wrap for now."*
- Future (user's words): *"keep the company analysis on click for future"* — all four data
  categories (valuation, fundamentals, analyst, dividend). Captured as Phase 2 below;
  **not built now.**

## What "macros in wrap" is today (grounded in the code)
The **Wrap tab** = `app/components/tabs/MacroTab.js`. Two macro surfaces there are weak:

1. **Manual EOD Kite snapshot** — `data/market-wrap.json` (NSE sectors, breadth indices
   `Nifty 50/Next 50/500/Midcap 100/Smallcap 100`, India VIX, Nifty close). Built by
   `scripts/merge-market.mjs` from `data/.kite-market.json`, which is written by **you
   running the `/sync` Kite step locally**, then committed + pushed.
   - Stale unless manually synced; EOD-only; depends on Kite MCP being connected.
   - The **NSE sector heatmap** has a live-ish fallback (Nifty-50 constituent averages via
     `/api/nifty50`); the **Breadth & volatility** strip (breadth + India VIX) has **no live
     fallback at all** — it is purely the manual snapshot.
2. **FRED macro already fetched but thrown away** — `page.js` passes `macro={macro}` to
   `MacroTab`, but `MacroTab` never destructures/renders it. So `/api/macro` (US 10Y, 2s10s
   curve, HY OAS, NFCI, VIX term, DXY) is fetched + sessionStorage-cached client-side and
   **not shown in the Wrap** — exactly the Koyfin-style macro backdrop, sitting unused.

## Conventions to match (from existing routes)
Keyless; `runtime='nodejs'`, `dynamic='force-dynamic'`, `maxDuration=30`; browser UA;
host fallback; `AbortSignal.timeout`; every datum `{ value/…, asOf, source }` or
`{ stale:true, error, source }` — **never a fabricated number**; `Cache-Control:
s-maxage=90, stale-while-revalidate=300`. NSE needs the homepage cookie bootstrap
(already implemented in `fetchFiiDii`).

## Decisions (confirmed by user)
- **Verify first:** add NSE + Yahoo hosts to the env egress allowlist, probe the real
  responses, confirm exact field names — *then* write the mapper (no guessing).
- **Scope this pass:** build **Phase 1a + 1b** together.
- Egress hosts to add: `www.nseindia.com`, `query1.finance.yahoo.com`,
  `query2.finance.yahoo.com` (optional: `finance.yahoo.com`, `fred.stlouisfed.org`).

## Plan

### Phase 1a — Live NSE sectors / breadth / India VIX (core deliverable)
- [ ] Refactor the NSE cookie-bootstrap out of `fetchFiiDii` into a shared helper in
      `app/api/premarket/route.js` (one homepage hit → cookie reused by **both** FII/DII
      and the new indices fetch).
- [ ] Add `fetchIndices()`: `GET https://www.nseindia.com/api/allIndices` (one call →
      all NSE indices). Map (pure fn) to the **existing `market-wrap.json` shape**:
      `{ nifty:{last,prevClose,pct}, vix:{last,prevClose,change,pct,high,low},
      sectors:[{name,pct}], breadth:[{name,pct}], asOf, source }`.
      - Same sector set + breadth set + **worst-first sort** as `merge-market.mjs`.
      - India VIX from the `INDIA VIX` row (else Yahoo `^INDIAVIX` fallback).
- [ ] Yahoo fallback when NSE is blocked from the datacenter: `^INDIAVIX` (VIX), `^NSEI`
      (nifty), `^CNX*`/`^NSEBANK` (sectors Yahoo covers); breadth best-effort. Tag
      `source` accordingly; honest blanks where Yahoo lacks the index.
- [ ] Add `indices` to the `/api/premarket` response `Promise.all` (no new route, no new
      client wiring — `premarket` is already fetched eagerly and passed to `MacroTab`).
- [ ] `MacroTab`: prefer `premarket.indices` (live) → fall back to static `MARKET_WRAP`
      (committed snapshot) → so behavior **never regresses below today**.
- [ ] Make the source/as-of sub-labels **data-driven** — derive from `wrap.source` /
      `wrap.asOf` (e.g. "NSE · live" vs "Kite snapshot · close 19 Jun"); no hardcoded
      "Kite" string or date. [feedback: data-driven UI text]

### Phase 1b — Surface the already-fetched FRED macro as a Koyfin-style backdrop
- [ ] Destructure `macro` in `MacroTab` (already fetched + cached; currently ignored).
- [ ] Add a compact **"Macro backdrop"** card to the Wrap: US 10Y, 2s10s curve (+
      contango/backwardation state from `vixTerm`), HY OAS, NFCI, DXY — each with
      value / change / asOf / source, stale-aware, **sign via colour not +/- glyphs**,
      `--fs-*` font tokens. [feedback rules]

### Tests / verification
- [ ] Vitest: pure mapper `allIndices payload → wrap shape` (sector/breadth selection,
      sort order, VIX parse, tolerant of missing rows). Network-free, sample payload.
- [ ] Vitest: Yahoo-fallback mapper.
- [ ] `npm run test` + `npm run build` green.
- [ ] Live validation on Vercel preview. **Sandbox egress blocks NSE + Yahoo** (probe
      returned "Host not in allowlist"), so field shapes can't be confirmed here.
      Offer: if NSE + `query1/2.finance.yahoo.com` are added to the env egress allowlist,
      probe live and confirm exact fields **before** building.

### Keep / don't break
- [ ] Keep `market-wrap.json` + `merge-market.mjs` as the committed last-resort fallback
      (manual `/sync` still works; just no longer primary). **Do not delete.**

## Phase 2 — FUTURE (documented, NOT built now)
Per-company "analysis on click" (Koyfin security panel): new keyless `/api/fundamentals`
via Yahoo `quoteSummary` (cookie+crumb handshake), surfaced as an **expandable holding
row** in the Indian + US tabs — **Valuation multiples, Fundamentals & quality, Analyst
consensus, Dividend intel** (user picked all four). One source covers NSE + US. Risks:
crumb-handshake fragility; honest blanks for thin NSE mid/small-cap coverage. User also
floated a dedicated **Research tab** (look up/compare any security) as a richer variant.

## Risks / honesty
- NSE `allIndices` may be blocked from Vercel datacenter IPs (same as FII/DII today) →
  Yahoo fallback + committed snapshot mean **worst case = today's behavior**, never worse.
- Couldn't verify NSE/Yahoo field shapes from the sandbox (egress allowlist) → defensive
  mapping + sample-payload unit tests + deploy validation.

## Review
(to fill after implementation)
