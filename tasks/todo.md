# Broker-state reconcile + app merge

**Goal:** broker APIs drive live qty/avg/MTM; curated `app/portfolio.js` keeps
metadata + history. Delivers the "no uploads" world — SWING (Upstox) and F&O
(Dhan) fully automatic, INDIAN (Zerodha) automatic-on-login; MF/Vested/salary
stay the genuine manual three.

**Custody map (verified live 2026-06-20):**
- SWING (5 names) → Upstox — zero-touch file token. Live qty/avg matched app exactly.
- F&O / algo (NIFTY options) → Dhan (+ Fyers funds ₹2.38L, Dhan funds ₹6.5L) — zero-touch self-mint.
- INDIAN (14 names) → Zerodha — hosted Kite MCP, needs daily OAuth click.
- US / MF(JioBlackRock) / CMPF → no API → manual (by design).

## Plan / Build
- [ ] 1. `data/broker-state.json` — live snapshot: holdings.SWING (Upstox),
      holdings.INDIAN (Kite; empty+stale today), positions.DHAN_FNO, funds{}.
- [ ] 2. `app/lib/brokerState.js` — import JSON; `reconcileSleeve(curated, key)`
      → `{ rows (broker qty/avg over curated meta + live{ltp,pnl,dayPct}),
      drift[], source, syncedAt, stale }`. Never mutate curated; broker drives
      numbers, curated supplies sector/cap/ns/name/history. Same row shape out.
- [ ] 3. `app/components/shared/SyncBadge.js` — source · synced time · drift/stale chip.
- [ ] 4. Wire SWING in page.js to reconciled rows (broker-driven) + pass rec to AlgoTab; badge by the swing table.
- [ ] 5. IndianTab: SyncBadge (read-only; shows "Zerodha · login needed" stale today). No change to value math.
- [ ] 6. Daily refresh: Local Claude routine documented in SCHEDULE.md.

## Verify
- [x] `next build` — compiled clean, type-checked, all 5 static pages prerendered
      (so the module-scope reconcileSleeve + broker-state.json import run server-side OK).
- [x] Ran the app (dev :3001), drove a browser to both tabs:
      - Trading → swing badge `synced · Upstox · 19 Jun`, 5 swing rows render.
      - Indian → badge `Zerodha · not synced today`, all 14 holdings + Total intact.
      No crashes; only pre-existing favicon/hydration console noise.

## Review

**What shipped**
- `data/broker-state.json` — live read-snapshot (Upstox SWING holdings, Dhan F&O
  legs + funds, Fyers funds; Kite INDIAN left stale — not logged in). Committed,
  no secrets/account-ids. Refreshed by an on-demand "sync the brokers" ask, or a
  future Local Claude routine (documented in SCHEDULE.md §4b).
- `app/lib/brokerState.js` — `reconcileSleeve(curated, key)`: broker drives
  qty/avg + attaches live{ltp,pnl,dayPct}, curated keeps metadata; returns drift +
  freshness. Never mutates the curated array; stale → hands curated back untouched.
- `app/components/shared/SyncBadge.js` — green `synced·<broker>·<date>` / red
  `N drifted vs <broker>` / grey `<broker> · not synced today`.
- Wiring: page.js builds `SWING_R`/`INDIAN_R` at module scope; swing derivation now
  reads `SWING_R.rows` (broker-driven). Badges on Trading + Indian tabs.

**Design call (why INDIAN is a drift-check, not value-driven):** the `indian`
derivation runs through `applyCorpActions(INDIAN,…)`; broker holdings already reflect
post-corp-action qty, so driving values there would double-count. SWING has no such
ledger, so it's cleanly broker-driven. INDIAN therefore flags drift (on Kite login)
while its curated values + XIRR/corp-action history stay authoritative.

**Not done (by design / follow-ups):** Kite value-driving (needs a login to test +
corp-action reconcile); surfacing Dhan F&O MTM + broker funds as their own UI (data
is captured in broker-state.json, ready).

---

## Daily sync automation (built)

- **`scripts/sync-brokers.mjs`** — Node engine for the 3 zero-touch brokers
  (Upstox/Dhan/Fyers): direct REST + Dhan TOTP self-mint + **mint-on-demand**
  (runs a broker's `login.py` inline when its token's expired, retries once).
  Merges into `broker-state.json`, preserves INDIAN, commits unless `SYNC_SKIP_GIT=1`.
  Verified live: Upstox token had just expired → `token stale - minting...` →
  minted → `ok · 5 holdings`; Dhan + Fyers fine.
- **`/sync` skill (rewritten)** — runs `sync-brokers.mjs` for the 3, then does Kite
  via MCP (login + holdings → INDIAN), one commit. (Local-only — `.claude` gitignored.)
- **`scripts/sync.cmd` + `scripts/sync-launch.ps1`** — launcher: resolves the newest
  `claude.exe` (version-pinned in the VS Code ext / Desktop app) and opens
  `wt -d <repo> -- claude "/sync"`. ASCII-only (PS 5.1 mis-decodes non-ASCII).
- **`DailyBrokerSync`** Windows logon task — 06:00, `-StartWhenAvailable`,
  interactive → runs `sync.cmd`. Boot → terminal opens → 3 brokers self-heal+sync →
  Kite login click → all 4 committed. No password/token stored; Kite stays a click.
- **Verified:** mint-on-demand live; `claude.exe --version` standalone; `wt` resolves;
  task `Ready`, next run 06:00; launcher parses clean. **Not headless-testable:** the
  interactive pop+Kite flow — confirm with one double-click of `scripts/sync.cmd`.
