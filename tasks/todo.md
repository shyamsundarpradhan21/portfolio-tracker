# Auto-drive the Trading tab

**Goal:** the Trading (Algo) tab's *current-FY* F&O P&L drives itself from the
daily broker capture — no hand-editing — so the ONLY manual touch left is the
annual ITR ritual (replace the just-closed FY's block with the ITR-verified
gross/charges/net + roll the carryforward). Swing already lives; this does the
realised F&O side.

**Two accepted realities (shape the design):**
1. Charges never come down the API (only the contract note has STT/exchange/
   SEBI/stamp/GST/brokerage). So *net* is **modeled** — deterministic India-F&O
   charge formula, tagged "est." live, reconciled to exact at ITR.
2. Trades / positions / `realizedProfit` reset at next-day pre-open. The 6 AM
   sync is too late to capture yesterday's intraday F&O. Need an **evening
   weekday capture** (~18:30 IST). Current F&O book is all zero-touch (Dhan S01,
   Fyers/Upstox S02 — Zerodha was FY25-26 only), so it's fully automatic.

**Sleeve map (from ALGO config):** Dhan + Zerodha → S01 · Upstox + Fyers → S02.

## Plan / Build
- [x] 1. `scripts/lib/fno-charges.mjs` — deterministic NSE F&O charge model
      (STT/exch/SEBI/stamp/IPFT/GST + ₹20/order brokerage), FY26-27 rates incl. the
      Apr-2026 STT hike. Exports `segmentOf` (shared classifier) + `chargesForFills`.
- [x] 2. `scripts/lib/fno-ledger.mjs` + `data/fno-ledger.json` — append/upsert by
      `date:broker`, skips zero-activity. Tested append/dedupe/upsert.
- [x] 3. Capture in `scripts/sync-brokers.mjs` — Dhan native `realizedProfit`
      (incl. expiry); Upstox/Fyers same-day closed-round-trip `Σsell−Σbuy`; charges
      modeled; one ledger row per broker/day. `fyersAppId()` .env fallback for the
      headless task.
- [x] 4. Evening capture — `scripts/sync-evening.cmd` +
      `scripts/register-evening-sync.ps1` (BrokerSyncEvening, weekday 18:30 IST,
      `-StartWhenAvailable`, headless). SCHEDULE.md §4c. 6 AM stays for holdings+Kite.
- [x] 5. Derive in `app/page.js` — `deriveFY(FY_SEED)` rolls the ledger on top of
      the frozen seed (`seedThrough` cutover guard); drives `s0X.fy2627` +
      `cf.fy2627Realised`. `app/lib/fnoLedger.js`. Pure, no mutation.
- [x] 6. Honesty UI — AlgoTab tag "FY26-27 F&O auto · est. charges · prior
      ITR-verified · swing live"; YtdFno "est." chip + "auto · N days · last <date>".
- [~] 7. DEFERRED per user — gross open-positions table isn't useful; if added later
      it shows net-if-closed (unrealised − modeled exit charges).

## Verify
- [x] Charges model = contract note exactly (₹67.86 total, net ₹1432.14).
- [x] Classifier excludes equity (RELIANCE/JIOFIN end in CE/PE but no strike digit).
- [x] Ledger append/dedupe/upsert; deriveFY rollup + pre-cutover guard correct.
- [x] `npm run build` clean (twice); all scripts `node --check` pass.
- [x] Diff vs main TODAY = zero numeric change (empty ledger → seed); numbers start
      moving Monday on first capture. Only the freshness-tag text differs today.

## Review
Realised-F&O now auto-drives the Trading tab. Seed (`fy2627`) = YTD through
`seedThrough` (2026-06-21); the evening task piles each trading day on top from Mon
2026-06-22. Only manual touch left = the annual ITR roll. **Pending:** (a) user
uploads YTD → replace the two `fy2627` seed blocks; (b) user runs
`register-evening-sync.ps1` once; (c) confirm `FYERS_APP_ID` is a user env var or add
it to `mcp/fyers/.env`; (d) commit+push (needed before Mon so Vercel renders derived).

---

# Phase 2 — Always-on capture (laptop-off)

**Why:** user trades on all 4 brokers without the laptop on. Only Dhan can mint its
token in the cloud (pure-API TOTP); Upstox/Fyers are browser-gated; Kite is delivery
(no reset, irrelevant to F&O). Decisions: **S01 (Dhan) → cloud Remote routine**;
**S02 (Fyers/Upstox) → broker webhooks** (pending feasibility research).

**Webhooks RULED OUT (research):** every broker's order webhook fires only for
orders placed through the registering API key — never app/algo orders. The viable
model is **scheduled server-side polling of the trades REST endpoint** (which IS
all-source). Cloud-vs-laptop is decided purely by token longevity.

## Build
- [x] 1. `SYNC_ONLY=dhan` scope flag in sync-brokers.mjs (cloud run = Dhan only,
      leaves laptop brokers untouched). Tested.
- [x] 2. Git step made two-committer safe: commit → `pull --rebase --autostash` →
      push-if-ahead; abort+skip on conflict (idempotent upsert heals next run).
- [x] 3. Cloud-Dhan documented (SCHEDULE.md §4d) — daily ~18:45 IST `SYNC_ONLY=dhan
      node scripts/sync-brokers.mjs`. Setup = user places Dhan secrets in Remote env
      + adds routine. (Dhan = only broker that self-mints unattended → cloud-capable.)
- [x] 4. **Upstox → stays on laptop.** Research: the 1-year read-only "Analytics Token"
      exists + is great, but account/trade endpoints HARD-REQUIRE a registered static IP
      (changeable 1×/week, invalidates token on change). Dynamic cloud hosts blocked;
      only a paid fixed-IP proxy would work. Not worth it for a non-F&O book. Decided: keep laptop.
- [x] 5. **Fyers → cloud, BUILT.** Refresh endpoint `validate-refresh-token` is NOT behind
      Cloudflare (verified live: HTTP 400 JSON `-501`, appIdHash accepted). login.py now
      saves refresh_token; sync-brokers.mjs hands it to Vercel KV (`fyers:refreshToken`);
      cloud refresh-mints daily from KV. `appIdHash` = sha256(appId:secret), proven
      byte-identical to the Fyers SDK + accepted by Fyers.
- [x] 6. Cloud routine = `SYNC_ONLY=dhan,fyers SYNC_NO_BROWSER=1` (one routine, both
      sleeves). dhanToken + fyersCfg take env-var fallbacks so the Remote needs only env,
      not the gitignored .env. SCHEDULE.md §4d rewritten; §4c updated. Laptop evening task
      kept (Upstox capture + redundant Dhan/Fyers fallback).

## Verify (Phase 2)
- [x] `node --check` sync-brokers + `py_compile` login.py.
- [x] appIdHash Node≡Python≡accepted-by-Fyers (got -501 bad-token, not -371 bad-hash).
- [x] Fyers refresh host reachable headless with JSON (no Cloudflare wall) — live test.
- [ ] End-to-end: user runs login.py once → refresh_token in KV → cloud routine mints +
      polls Fyers (needs a real refresh_token; can't test until login.py runs).

## Setup handoff (user)
- Remote env: DHAN_CLIENT_ID/PIN/TOTP_SEED, FYERS_APP_ID/SECRET_ID/PIN, KV_REST_API_URL/TOKEN.
- Laptop env: KV_REST_API_URL/TOKEN (to push the handoff).
- Run `mcp/fyers/login.py --show` once; add the daily Remote routine.
- Plus the Phase-1 pending: upload YTD seed, run register-evening-sync.ps1, commit+push.
