# cas-parser — standalone local CAS (CAMS/KFintech) → KV runner

Decrypts consolidated MF account statements **locally** with
[casparser](https://github.com/codereverser/casparser) (pinned), validates that
every scheme's printed closing units reconcile with the recomputed close
(refuse-on-fail — the CAS analog of the contract-note checksum), REDACTS all
PII, and pushes the derived MF ledger to Vercel KV. Passwords and the raw
statement never leave this machine.

This does NOT wire into the dashboard — it ends at "ledger lands in KV, verified."

## Setup (one time)
```
python -m venv scripts/cas-parser/.venv                                   # gitignored
scripts/cas-parser/.venv/Scripts/pip install -r scripts/cas-parser/requirements.txt
cp scripts/cas-parser/.env.example scripts/cas-parser/.env                # fill CAS_PW_*
```

## Run
```
scripts/cas-parser/.venv/Scripts/python scripts/cas-parser/run.py <pdf-or-folder> [--dry-run]
```
Tries each `CAS_PW_*` → casparser parse → validate → redact → on PASS pushes to KV.
Handles TWO document families under one decrypt, routed by casparser `file_type`:
- **CAMS/KFintech MF CAS** (folios) → `ledger:mf:<period+folio-set hash>`. Refuse-on-fail:
  every scheme's printed close reconciles with casparser's recomputed close.
- **CDSL/NSDL eCAS** — the monthly auto-mailed *depository* consolidated statement (demat
  equities / MF units / bonds per account) → `ledger:demat:<period+account-set hash>`.
  casparser returns `NSDLCASData` (accounts, not folios); read via the TYPED parse
  (`output='dict'` leaves accounts empty). Refuse-on-fail: each account's printed balance
  reconciles with Σ of its holding values. Holdings snapshot (units + NAV + value, no cost
  basis). Redacts investor_info, owners (name/PAN), dp_id/client_id, folio numbers (→ hash).
naturalKey = statement period + a set hash, so the same statement re-downloaded (different
bytes) lands on the same key — idempotent. Mirrors `ledger:cn:*`.

`--porcelain` emits one JSON status line per file — the ingest registry wrapper
(`scripts/ingest/parsers/cas-mf.mjs`) consumes this; humans use the default output.

## Discipline (non-negotiable)
- **Passwords**: `.env` only (gitignored), memory-only, never logged/echoed/committed.
- **PII**: investor name/email/address/mobile + PAN/KYC flags DROPPED; folio
  numbers replaced by a stable hash (joinable, not quotable to an RTA);
  nominees dropped. The raw statement is never persisted or pushed.
- **Refuse-on-fail**: any scheme whose units don't reconcile blocks the push.

## Test
```
scripts/cas-parser/.venv/Scripts/python scripts/cas-parser/test_engine.py   # 37 synthetic regression tests
```
Synthetic dicts only — no PII, no PDF, no password. The real-PDF path is
verified on the user's actual CAS sample (plan step d: casparser-first; only if
casparser fails on a real sample does any hand-rolling get considered).
