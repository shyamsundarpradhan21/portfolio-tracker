# Implementation handoff — Unified ingestion pipeline

From: Cowork session 2026-07-02 (design/spec). To: Claude Code on this repo, branch `main`.
Spec of record: `tasks/todo.md` → "Plan — Unified ingestion (v2)", status APPROVED.
All decisions are LOCKED — build to spec, don't re-derive. Read the plan + `tasks/feedback.md`
ALWAYS-READ layer before starting.

## Before writing any code
1. **Truncation check (standing rule):** this handoff and the todo.md v2 plan were written from
   Cowork via the shared mount. Re-read `tasks/todo.md` on disk and confirm the v2 section is
   intact: architecture points 1–8, registry parsers incl. `itr-json`, steps (a)–(j) with (e2).
   If anything is cut off mid-sentence, STOP and ask the user to re-sync.
2. Work on `main`; auto-commit verified phases locally; NO push unless told.
3. Deps: `npm i googleapis @google-cloud/pubsub` (scripts-side only — must never enter the app
   bundle; no imports from `app/`). Python: new venv `scripts/cas-parser/.venv` with `casparser`
   pinned, mirroring `scripts/contract-parser/` layout (run.py / engine / test_*.py /
   .env.example / README.md).

## Build order (each phase = tests green before the next; commit per phase)
1. **(b) `scripts/ingest/` pure libs + vitest** — `registry.mjs` (parser interface:
   `{id, canHandle(file), run(file) → {naturalKey, target, status}, expects}`), `manifest.mjs`
   (read/write `data/ingest-manifest.json`), dedup (sha256 + naturalKey), queue/router,
   `gmail.mjs` (history-gap detection, PDF attachment selection). Required tests:
   - manifest invariant: every intake ends as exactly ONE row (PASS|FAIL|DUP|UNRECOGNIZED);
   - dedup: same bytes → DUP; same naturalKey different bytes → DUP(of=…);
   - unknown file → UNRECOGNIZED park, never dropped.
2. **(c) `scripts/ingest-daemon.mjs`** — capture-daemon patterns (per-loop in-flight guard,
   `keepAwake`, log `scripts/ingest.log`, quiet scheduled operation). Two intakes behind source
   adapters (Pub/Sub streaming pull → download to `inbox/`; fs-watch on `inbox/`) → ONE queue.
   `--dry` = parse but no store writes, no deletes (must run on fixtures with zero GCP setup).
   Watch re-arm on startup + every 6d. PASS → delete clone; FAIL → `inbox/failed/`.
3. **(d) `scripts/cas-parser/`** — casparser-first ([Likely] covers CAMS/KFintech; VERIFY on the
   user's real sample before hand-rolling anything). `CAS_PW_*` in gitignored `.env`;
   PII-redacted output; refuse-on-fail; KV `ledger:mf:<periodKey>` + index (mirror the
   `ledger:cn:*` pattern). Regression tests mirroring `test_engine.py` discipline.
3b. **(d2) contract-parser: NEW Groww + Rupeezy adapters** — the engine covers only
   Zerodha/Fyers/Upstox/Dhan today. Real samples are pre-dropped by the user in `inbox/`
   (gitignored). **Sample inventory (probed 2026-07-02, metadata only):**
   - `206403980300724.json` / `926639580260825.json` — ITR-3, AY 2024-25 / AY 2025-26 ✓
   - `NSEFUTURES_CONTRACT_20230601_AG4907_0125557.pdf` — USER-CONFIRMED: Astha/Rupeezy
     contract note. UNencrypted, iTextSharp. **RESOLVED 2026-07-02:** the Astha adapter +
     the broadened contract-note canHandle (claims bare-"CONTRACT" names) now PASS it →
     KV `ledger:cn:0125557` (4 F&O fills, total checksum PASS, GST PASS).
   - `CONTRACT NOTE 0258131546.pdf` — USER-CONFIRMED: Groww. Already CONSUMED: an existing
     `CN_PW_*` decrypted it and the engine PASSed it as an inert carry/MTM note (manifest
     row exists). Implication: Groww is PROVISIONALLY covered by the existing engine — no
     new adapter until a TRADE-BEARING Groww note (backfill will supply) either parses
     clean (close as covered) or fails (then build the adapter). **Kept provisional — no
     speculative adapter built.**
   - `SEP2025_AA47186032_TXN.pdf` — USER-CONFIRMED: a CAS statement sample (encrypted).
     It parked UNRECOGNIZED because cas-mf's canHandle never claimed it → CLASSIFIER GAP:
     an ENCRYPTED PDF no parser claims should be ATTEMPTED by the password-holding parsers
     (cas-mf, then contract-note) before parking — decrypt-probe as a last-resort claim
     pass. **RESOLVED 2026-07-02:** the decrypt-probe (encryption-gated; cas-mf then
     contract-note) now CLAIMS it — closing the gap. The file itself turned out to be a
     **CDSL depository CAS (demat holdings), NOT a CAMS/KFintech MF CAS** — casparser reads
     `file_type=CDSL, cas_type=None, 0 folios`. So the honest verdict is a clean FAIL:
     "CDSL depository CAS … out of scope for ledger:mf" (quarantined in inbox/failed/), not a
     silent UNRECOGNIZED park. If a depository-holdings ledger is ever wanted, that's a new
     parser; today it's correctly refused.
   Single note per broker + a 2023-dated Rupeezy sample = enough to BUILD adapters; the
   Gmail backfill (h) supplies volume for confidence. Per adapter: parse → per-segment checksum PASS against the note's own
   totals → derive PII-redacted SYNTHETIC fixtures for `test_engine.py` (the raw note is
   never persisted as a fixture) → only then register the broker. Passwords = new `CN_PW_*`
   entries the user adds to the existing gitignored `scripts/contract-parser/.env`.
4. **(e) Wrap existing** `parse-payslip.py` (naturalKey = salary month; PASS auto-chains the
   guarded `seed-portfolio-kv.mjs`) and `parse-broker-tax.py` (FY+broker) as registry parsers.
   Do NOT rewrite the proven engines.
5. **(e2) `itr-json` parser** — per-AY/form schema validation (fail loudly on unknown shapes);
   extracts FY anchors (CG schedules, F&O business income, Schedule CFL, Schedule S). Emits
   `data/itr-candidate-<AY>.json` + a printed diff vs current `fno-verified.json`. It NEVER
   writes `fno-verified.json` — user sign-off applies the change manually.
6. **(f) `scripts/ingest-report.mjs`** — expects-cadence gap report (contract note per F&O
   trading day per active broker — reuse `scripts/lib/marketHours.mjs` for the calendar;
   payslip monthly; CAS monthly; ITR annual) + weekly scheduled run.
7. **(g) Windows layer** — `scripts/ingest.cmd` + `scripts/register-ingest-daemon.ps1`
   (at-logon, repo-relative paths only — no `C:\Users\Business` rot). `.gitignore` adds:
   `inbox/`, `data/ingest-manifest.json`, `data/gmail-state.json`, `mcp/gmail/.token.json`,
   `mcp/gmail/.sa.json`, `scripts/cas-parser/.env`, `data/itr-candidate-*.json`.
8. **(h) Backfill** — `--backfill --from <date> [--to <date>]`: date-ranged `messages.list`
   sweep → same `inbox/` → same pipeline; resumable (state per message); polite rate-limit.
9. **(i) End-to-end verification** — do NOT mark complete without ALL proofs in the plan's
   step (i): dedup double-drop, forced-FAIL quarantine, unknown-file park, clone deleted on
   PASS, original mail untouched, manifest completeness, gap report catches a missing month.
10. **(j) `scripts/ingest-reconcile.mjs`** — REPORT-ONLY, per the plan's authority order
    (parsed ITR anchor → checksum-PASS docs → broker API → hand-curated) and the
    cross-granularity invariant (notes SUM to ITR FY schedules; Schedule S vs PAYSLIPS).
    Apply corp-action adjustments BEFORE flagging any MF drift (CUB lesson).

## User-side prerequisites (generate docs first, then STOP and wait)
- **GCP setup (plan step a):** write `mcp/gmail/README.md` as a click-by-click walkthrough
  (project → Gmail API + Pub/Sub → OAuth desktop client `gmail.readonly` → topic `gmail-tx` +
  grant `gmail-api-push@system.gserviceaccount.com` publisher → pull subscription → SA key →
  Gmail filter → label `portfolio/tx`), then wait for the user to complete it and provide the
  client-secret file. Everything through phase (b)–(e2) builds and tests WITHOUT GCP (fixtures
  + `--dry`).
- **Real samples needed from the user:** one contract-note mail, one CAS PDF (+ password
  convention), one payslip PDF, the annual ITR JSONs.
- **[Unconfirmed → verify live at build]:** GCP "Testing"-mode OAuth refresh tokens expire ~7
  days (publish the consent screen if so); casparser coverage of current CAS formats.

## Non-negotiables (repo-wide, enforced in review)
- Gmail scope `gmail.readonly` ONLY; zero mailbox mutation ever. Brokers untouched/read-only.
- PANs / statement passwords / OAuth tokens: local gitignored files only — never logged,
  echoed, committed, or pushed to KV. KV receives redacted DERIVED data only.
- Raw documents never persisted: PASS → delete, FAIL → quarantine. Seed sanity guard never
  bypassed. Manifest invariant holds at all times.
