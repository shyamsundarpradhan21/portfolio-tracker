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
