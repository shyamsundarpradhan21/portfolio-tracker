---
last_mapped_commit: f327769e7739847e5a4fcf5cf032f6f21df3dc7a
---

# Coding Conventions

**Analysis Date:** 2026-06-11

## Naming Patterns

**Files:**
- React components use PascalCase: `InsightBanner.js`, `FreshnessTag.js`, `HistoryCurve.js`
- Shared/utility files use camelCase: `fmt.js`, `calc.js`, `market.js`, `snapshots.js`, `backfill.js`
- Tab components are PascalCase with `Tab` suffix: `OverviewTab.js`, `IndianTab.js`, `MFTab.js`
- API routes follow Next.js convention: `app/api/<name>/route.js`
- All source files use `.js` (no TypeScript, no `.tsx`)

**Functions:**
- Exported utility functions: camelCase — `inrC`, `fmtNavDate`, `weightedCagr`, `computeBetaVol`
- React components: PascalCase — `OverviewTab`, `InsightBanner`, `Skel`
- Internal/private helpers: camelCase — `fetchOne`, `deriveMf`, `deriveFds`, `mfXirr`
- Sort setters follow `sort<Scope>` pattern: `sortIn`, `sortUs`, `sortMf`, `sortSw`

**Variables:**
- camelCase throughout: `totVal`, `totCost`, `mfNav`, `usdInr`, `fxRate`
- Abbreviations are common and intentional: `inv` (invested), `val` (value), `pl` (profit/loss), `pct` (percentage), `ltp` (last traded price), `q` (quote), `r` (row), `s` (symbol/series)
- Constants and module-level config are SCREAMING_SNAKE_CASE: `FETCH_TS_KEY`, `REFRESH_MS`, `HOSTS`, `UA`, `DAY_MS`, `YEAR_MS`
- Sort state objects use `{ key, dir }` for Indian/MF, `{ col, dir }` for US (slight inconsistency)

**Types/Interfaces:**
- No TypeScript; no explicit type annotations
- Object shapes are implicit, inferred from use

## Code Style

**Formatting:**
- No Prettier or Biome config present — formatting is manual/editor-driven
- Indentation: 2 spaces
- Single quotes for strings
- Semicolons omitted (no-semicolon style)

**Linting:**
- Only `next lint` in `package.json` scripts — uses Next.js built-in ESLint config (no `.eslintrc` customisation found)
- `react-hooks/exhaustive-deps` warnings are intentionally suppressed with inline comments where `useEffect`/`useMemo` intentionally omit deps for mount-only or primitive-coerced dependencies
- Pattern: `// eslint-disable-next-line react-hooks/exhaustive-deps` on the line before the closing bracket

**Line length:**
- No enforced limit; long lines are common in dense `useMemo` blocks and JSX
- Computation blocks are written in compact single-expression style: `const x = ...; const y = ...;` on one line when logically related

## Import Organization

**Order (observed across files):**
1. React / Next.js framework imports
2. Portfolio data / constants from `./portfolio` or `../../portfolio`
3. JSON data files (`data/*.json`)
4. Lib utilities (`./lib/market`, `./lib/calc`, `./lib/fmt`, etc.)
5. Component imports (tabs first, then shared)

**Path Aliases:**
- None configured — all imports use relative paths (`../../lib/fmt`, `../shared/InsightBanner`)

**`'use client'` directive:**
- Required at the top of every file that uses React hooks or browser APIs
- `app/lib/calc.js` deliberately has NO `'use client'` — comment states "no React, no imports, safe to use anywhere"
- `app/lib/fmt.js` has `'use client'` because it exports JSX components (`Rs`, `Usd`, `UsdF`, etc.)

## Error Handling

**Client-side fetch:**
- All `fetch` calls inside `doRefresh` are wrapped in `try/catch`; errors set `status.type = 'err'`
- API routes return `{ error: string }` objects on the symbol level, not HTTP errors, so the client can show partial data
- Defensive pattern: `q && !q.error ? q.price : null` used everywhere a live price is consumed

**Server-side (API routes):**
- Input validation returns `Response.json({ error: '...' }, { status: 400 })` for bad inputs
- Per-symbol fetch failures in `app/api/quotes/route.js` return `{ symbol, error: message }` rather than failing the whole batch
- Host fallback loop: `for (const host of HOSTS)` tries both Yahoo Finance query hosts before giving up

**Stale data guard:**
- `stale` flag pattern used in async effects to prevent state updates after unmount:
  ```js
  let stale = false;
  (async () => { ... if (!stale) setState(...); })();
  return () => { stale = true; };
  ```

**Null/undefined propagation:**
- `?? null` and optional chaining (`?.`) used throughout derived computations
- Return value convention for unavailable data: `null` (never `undefined` or `0`) from calculation helpers like `xirr`, `weightedCagr`

## Logging

**Framework:** `console` only — no structured logging library

**Patterns:**
- No `console.log` in production paths observed
- Errors are surfaced via React state (`status.msg`) not logged to console
- API routes do not log — failures propagate as JSON error objects

## Comments

**When to Comment:**
- Explain non-obvious business logic: financial formulas, tax rules, market state derivation
- Document intentional workarounds (eslint-disable lines always accompanied by explanation)
- Section dividers use long dash decorators:
  ```js
  // ─── cache keys ───────────────────────────────────────────────────────────────
  // ─── derived: Indian ────────────────────────────────────────────────────────
  ```
- File-level block comments at the top of API routes describe the endpoint contract (method, path, params, response shape)

**JSDoc:**
- Used selectively for pure calculation functions in `app/lib/calc.js`:
  ```js
  /** Newton-Raphson XIRR with bisection fallback. cfs: [{ date: Date, amount }] */
  /** Weighted-average CAGR: Y = Σ(inv·date)/Σinv to today. */
  ```
- Not used for React components or hooks

**Design rationale comments:**
- Inline prose explains architectural decisions, e.g. why algo capital is excluded from net worth, why `'use client'` is or isn't present, why a particular fallback value is used

## Function Design

**Size:**
- Pure utility functions in `app/lib/` are kept small and focused
- Derived-state functions (`deriveMf`, `deriveFds`) are medium-length (50–110 lines), self-contained
- `app/page.js` is a large monolithic component (~737 lines) containing all state, all derived `useMemo` blocks, and all data fetching — this is the intentional architecture for a single-page dashboard

**Parameters:**
- Tab components receive all derived data as flat props (no context, no stores)
- Shared UI components are minimal: `Skel({ w, h })`, `FreshnessTag`, etc. with simple typed props

**Return Values:**
- Derived objects use consistent shape: `{ rows, inv, val, pl, pct, valued }` for equity sleeves
- Null returned (not thrown) when calculation is impossible

## Module Design

**Exports:**
- `app/lib/fmt.js`: named exports for every utility and JSX helper
- `app/lib/calc.js`: named exports for pure math functions and constants
- `app/lib/constants.js`: named exports for lookup tables
- React components: single default export per file

**Barrel Files:**
- None used — all imports are direct to the file

## Portfolio Data

- All holdings data lives in `app/portfolio.js` — a single large named-export file
- JSON data files live in `data/` (e.g., `data/fy2526_verified.json`)
- No data-fetching layer for holdings — data is statically imported at build time

---

*Convention analysis: 2026-06-11*
