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
   - `NSEFUTURES_CONTRACT_20230601_AG4907_0125557.pdf` — UNencrypted, "Astha" markers →
     [Likely] Rupeezy (ex-Astha Trade); page-1 text extraction didn't match "Contract Note"
     (cover page or extraction quirk — inspect at build).
   - `CONTRACT NOTE 0258131546.pdf` — ENCRYPTED; [Likely] Groww by elimination — confirm on
     first decrypt (user adds `CN_PW_*` to the existing `.env`).
   - `SEP2025_AA47186032_TXN.pdf` — ENCRYPTED, identity unconfirmed (payslip vs transaction
     statement) — user confirming; route to the right parser once known.
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
    Apply corp-action adjustment