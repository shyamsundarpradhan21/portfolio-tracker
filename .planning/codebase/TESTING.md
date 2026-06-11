---
last_mapped_commit: f327769e7739847e5a4fcf5cf032f6f21df3dc7a
---

# Testing Patterns

**Analysis Date:** 2026-06-11

## Test Framework

**Runner:** None — no test framework is installed or configured.

- No `jest.config.*`, `vitest.config.*`, or any test runner config found
- No `@testing-library/*`, `jest`, `vitest`, `mocha`, or similar packages in `package.json`
- `devDependencies` contains only `puppeteer` (used for snapshot screenshots, not automated testing)

**Assertion Library:** None

**Run Commands:**
```bash
# No test command exists. The only scripts are:
npm run dev        # Next.js dev server
npm run build      # Production build
npm run start      # Production server
npm run lint       # next lint (ESLint only)
```

## Test File Organization

**Location:** No test files exist anywhere in the repository.

**Naming:** Not applicable — no `*.test.*` or `*.spec.*` files found.

## Test Types

**Unit Tests:** None

**Integration Tests:** None

**E2E Tests:**
- `puppeteer` is installed as a devDependency
- `scripts/snapshot-tabs.js` uses Puppeteer to take visual screenshots of each dashboard tab
- This is a **visual capture script**, not an automated test — it does not assert correctness
- Run manually; not wired into CI or any test lifecycle hook

## Verification Practices (Actual)

In the absence of automated tests, the project relies on the following verification patterns:

**Build-time check:**
- `npm run build` compiles the Next.js app and will fail on import errors or JSX syntax errors
- This is the only automated correctness gate

**Lint:**
- `npm run lint` runs `next lint` which enforces React Hooks rules and basic ESLint rules
- Known `react-hooks/exhaustive-deps` violations are suppressed with inline `// eslint-disable-next-line` comments in `app/page.js` and `app/components/ProjectionTab.js`

**Manual visual verification:**
- `scripts/snapshot-tabs.js` captures PNG screenshots of all 6 tabs by navigating to each hash fragment (`#overview`, `#indian`, `#fd`, `#mf`, `#us`, `#algo`) via Puppeteer
- Output location controlled by the script (design/previews)
- Not integrated into any CI pipeline

**Runtime data validation:**
- Pure calculation helpers in `app/lib/calc.js` (`xirr`, `weightedCagr`, `benchCounterfactual`, `computeBetaVol`) return `null` on invalid/insufficient input rather than throwing — this acts as a soft guard at the presentation layer
- API routes validate inputs and return structured `{ error }` objects on failure

## Coverage

**Requirements:** None enforced

**Current coverage:** 0% automated test coverage

## What to Test If Tests Were Added

The highest-value areas for unit tests, given the codebase shape:

**`app/lib/calc.js`** — pure functions with no side effects, ideal for unit tests:
- `xirr` — convergence for known cash-flow sequences, null on degenerate inputs
- `weightedCagr` — edge cases: zero invested, single transaction, future date
- `benchCounterfactual` — missing series, insufficient history
- `computeBetaVol` — fewer than 24 weekly data points, missing Nifty series
- `applyCorpActions` — bonus ratio arithmetic, ex-date boundary

**`app/lib/fmt.js`** — pure formatters:
- `inrC` / `inrCd` — Cr/L/K thresholds and rounding
- `fmtNavDate` / `fmtDateObj` — date formatting correctness
- `pctS` / `pct1` — null handling, absolute-value display

**`app/api/quotes/route.js`** — API route input handling:
- Empty `symbols` param → 400
- More than 60 symbols → 400
- Yahoo fetch failure → per-symbol error object in response

**`app/lib/snapshots.js`** and **`app/lib/backfill.js`** — localStorage/sessionStorage logic and ledger reconstruction

## Suggested Test Setup (If Introducing Tests)

Given the JavaScript-only (no TypeScript) stack and Next.js 14 app router:

```bash
# Recommended minimal setup
npm install --save-dev vitest @vitest/ui jsdom

# vitest.config.js
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: { environment: 'node' },  // calc.js / fmt.js need no DOM
});
```

Test files would live co-located with source:
```
app/lib/calc.test.js
app/lib/fmt.test.js
app/api/quotes/route.test.js
```

---

*Testing analysis: 2026-06-11*
