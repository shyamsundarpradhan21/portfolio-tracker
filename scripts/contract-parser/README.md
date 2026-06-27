# contract-parser — standalone local contract-note → KV runner

Decrypts Indian broker contract-note PDFs **locally**, parses them with the proven engine
(Zerodha / Fyers / Upstox / Dhan — SEBI-standardised cash + F&O, per-segment reconciling,
tax-entity separated), and pushes the **PII-redacted derived ledger** to Vercel KV. PANs never
leave this machine; the server / KV holds neither the password nor the raw note.

This does NOT wire into the dashboard — it ends at "ledger lands in KV, verified."

## Setup (one time)
```
python -m venv scripts/contract-parser/.venv                                   # gitignored
scripts/contract-parser/.venv/Scripts/pip install -r scripts/contract-parser/requirements.txt
cp scripts/contract-parser/.env.example scripts/contract-parser/.env           # fill in real PANs
```
`.env` is gitignored (proven) — your PANs stay local.

## Run
```
scripts/contract-parser/.venv/Scripts/python scripts/contract-parser/run.py <pdf-or-folder>
```
Loads `CN_PW_*` from `.env` (memory only) → decrypts → parses → prints a **masked** summary +
per-segment checksum + sign check → on **all checksums PASS**, pushes `ledger:cn:<note-no>` to KV
(and adds it to `ledger:cn:index`). **Refuses to push** if any checksum FAILS.

## Discipline (non-negotiable)
- **PANs**: `.env` only (gitignored), memory-only, **never** logged / echoed / committed.
- **PII**: client name / address / PAN redacted at extraction; the raw note is never persisted or pushed.
- **KV payload**: the derived ledger (fills + charges + `self`/`mom` tags + segment) — no PAN,
  no name/address, no account code (the note number identifies the note).
- **Refuse-on-fail**: unreconciled data is never pushed.

## Test
```
scripts/contract-parser/.venv/Scripts/python scripts/contract-parser/test_engine.py   # 215 synthetic regression tests
```
The engine logic is the proven sandbox engine, moved verbatim — `test_engine.py` is the
regression guard against a future edit silently breaking a proven adapter.
