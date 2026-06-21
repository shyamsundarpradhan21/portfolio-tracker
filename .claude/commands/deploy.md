---
description: Pre-flight checks then deploy to Vercel (push to main).
---

Deploy the portfolio-tracker. Target: $ARGUMENTS (default: current branch → production).

Pre-flight — all must pass, stop on any failure:
1. `npm test` green.
2. `npm run build` clean (watch for prerender crashes on the `force-dynamic` API routes).
3. `git status` clean except intended changes; confirm no secret / gitignored file is staged.
4. Confirm private data won't ship in the client bundle (it loads via `/api/portfolio`).

Then, only with explicit user go-ahead:
- Push to `origin HEAD:main` (Vercel auto-deploys; repo has deployment protection).
- If portfolio data changed: remind to edit `data/portfolio.private.json` → run `node scripts/seed-portfolio-kv.mjs` (KV is the live source).
- Report the deploy + what to verify live.
