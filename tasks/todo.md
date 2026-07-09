# Plan — 2025 Dhan contract-note adapter (text-line parser) — PROPOSED 2026-07-10

## Why
The 2025 Dhan "Contract Note (Cash F&O and Currency)" notes are **REFUSED** by the parser
(`checksum N/A → not pushed`), so ~35 notes from Jan–Sep 2025 never reached `ledger:cn:*`.
They are the **only independent source** for the 2025 F&O realised: the Dhan `/v2/trades`
API is missing Mar–Sep 2025 (1300 residual open lots), and the fno-ledger's 2025 figure
(+₹40,159) is a `source:'report'` backfill that has never been checked against anything.

## Root cause (verified 2026-07-10, masked diagnostics in scratchpad)
The 2025 Dhan layout is **text-positioned, not ruled**. pdfplumber table extraction (both the
default line-based AND the old-Dhan text-position strategy) fragments each fill across several
physical rows → `net_total 0/N`, `net_amount` not always found → the checksum can't run → REFUSED.
BUT the fill data is clean on **single text lines**:
```
<15-16 digit trade-no> <ord-time> <trd-time><security-desc> <B|S> <signed-qty> <gross-rate> <net-rate> <net-total> <remark D/M/*>
```
and charges are a text block `Description | seg | seg | Total` with DR/CR values, incl.
`PAY IN/PAY OUT OBLIGATION … CR` and `NET AMOUNT RECEIVABLE/PAYABLE BY CLIENT … CR`.
→ A **text-line parser** (same idea as the existing Astha `parse_charges_from_text` path)
reconstructs both cleanly; no new table strategy needed.

## Scope confirmed
- cn2025_0 (2025-02-11): cash ETFs only (BANKBEES/FINIETF/FMCGIETF/ITBEES), `has_fno=False`.
- cn2025_1: has F&O (`fno 4` fills), `net_amount` present.
- So the adapter must handle **cash + F&O (+ currency)** segments in one note.

## Design (all in `scripts/contract-parser/engine.py`; runner/KV/masking unchanged)
1. **Detector** `is_dhan_2025_textnote(text)` — broker==dhan AND the note carries the wrapped
   column header "Brokerage per Unit … Net Total (Before Levies)" AND the text charges block
   ("PAY IN/PAY OUT OBLIGATION" + "NET AMOUNT RECEIVABLE/PAYABLE BY CLIENT"). Precise enough to
   NOT catch 2023-24 old-Dhan (which the ruled / text-position table path already handles).
2. **Fills** `parse_dhan2025_fills_from_text(text)` — regex the data lines above →
   {instrument, side (B/S), qty (abs; sign→side), price (net-rate), net_total (signed by side:
   BUY −, SELL +), trade_no, trade_time}. Symbol/ISIN from the `Symbol :XXX ISIN : YYY Net`
   summary lines → feeds `infer_segment` (cash vs fno) + `backfill_isin`.
   Skip the `Total Total Sell : …` and `Symbol : … Net` summary/subtotal lines (not fills).
3. **Charges** `parse_dhan2025_charges_from_text(text)` — reassemble WRAPPED label lines, then
   for each: `label_key` on the reassembled label, take the **Total** (last) DR/CR value
   (DR = negative charge, CR = positive). `PAY IN/PAY OUT`→pay_in, `NET AMOUNT …`→net_amount.
   Reuse the existing `TABLE_LABELS`/`label_key` map (add any 2025-only label wording as needed).
4. **Wire into `build_ledger`**: when the detector fires, take fills+charges from the text
   parsers (skip the table path); everything downstream (segment tag, checksum, per-segment
   checksum, KV push, masking, REFUSE-on-fail) is unchanged. The checksum is the safety net —
   a mis-parse that doesn't reconcile still REFUSES, never writes bad data.

## Steps
- [x] Add the parser fns + detector to `engine.py`; wire into `build_ledger` (table-first,
      text-fallback-only-when-the-table-can't-reconcile → ruled notes never regressed).
- [x] Dry-run cn2025_0 + cn2025_1 → both **checksum PASS** (were N/A/REFUSED).
- [x] **Regression**: `test_engine.py` 282/282 pass (was 262; +20 for the 2025 adapter incl. the
      ruled 'Eqfo_signed' bare-cell variant). Table path unchanged for all proven adapters.
- [x] Downloaded all 36 2025 Dhan notes (read-only) → batch dry-run: **36/36 OK** (was 0/36
      before; the 3 that first REFUSED were a no-pay_in obligation, a page-split wrapped charge
      label, and a ruled bare-cell-zero pollution — all fixed).
- [ ] **Report the tally to the user and get a go-ahead BEFORE any real `--write`/KV push**
      (KV is the live serving copy; and the ingest-daemon must be stopped first to avoid a
      concurrent gmail-state write — see tasks/ingest-handoff.md).  ← WAITING HERE

## After the adapter lands (separate confirmations)
- [x] Ingested the 36 2025 notes → `ledger:cn:*` (KV, all PUSHED; via run.py direct — no daemon
      stop needed, it writes idempotent cn keys only, not gmail-state/manifest).
- [x] Rebuilt the overlay → `ledger:fno:overlay` (KV prod) + `data/fno-overlay.json` (local
      mirror): 55 Dhan-2025 days now carry REAL F&O charges (earliest was 2025-10-06 → now
      2025-01-07). FY24-25 Dhan 382 · FY25-26 Dhan 26,404.
- [ ] Re-derive 2025 F&O realised from the parsed notes; compare to the `source:'report'`
      +₹40,159. NOTE: a note states charges + trades, NOT realised — needs cross-note FIFO, and
      the F&O fill descs are truncated (strike+CE, no underlying/expiry) → needs contract
      reassembly first. Deferred (not in the selected scope).
- [ ] **Re-scope the guard** in `build-trading-ledger.mjs`: it subtracts F&O-only `fnoGross`
      from whole-account `realisedDerived` (incl. cash −₹15k + currency), so its "₹51k undercount
      ⚠" is a multi-segment residual, NOT an F&O gap. Deferred (not in the selected scope).
- [ ] Revisit item-4's removal of the 2026-07-07 fno row (a contract note exists for it).

## Open questions / risks
- How many distinct 2025 sub-layouts (cash / F&O / currency / cross-currency)? Batch dry-run reveals.
- Do all 2025 notes decrypt with CN_PW_SELF? (some may be CN_PW_MOM — the runner tries all.)
- Multi-page notes repeat the header block — the text parser must handle repeats idempotently.

## Review
Built a text-line parser for the 2025 Dhan text-positioned GST-invoice notes (`engine.py`:
`is_dhan_2025_textnote`, `_dhan2025_key`, `parse_dhan2025_charges_from_text`,
`parse_dhan2025_fills_from_text`), wired as a **fallback** in `build_ledger` — it only runs when
`broker=='dhan'` AND the table parse doesn't reconcile AND the text parse DOES, so every ruled
layout (Zerodha/Fyers/Upstox/old-Dhan/2025 'Eqfo_signed') keeps its proven table path.
Result: **36/36** 2025 Dhan notes now reconcile (dry-run), **282/282** unit tests pass.
Three format quirks handled: (a) notes with no PAY IN/PAY OUT row (obligation = signed fills),
(b) charge labels that wrap around the value line / across a page break (paren-balance tail
absorption), (c) ruled notes that render 0-charges as BARE cells with no DR/CR (self-contained
commit + buf flush so a bare zero can't glue onto the next charge's label).
NOT YET DONE (gated on user go-ahead): the real KV push / daemon-stop / 2025 re-derivation /
guard re-scope. The guard-rescope finding stands regardless: `build-trading-ledger.mjs` subtracts
F&O-only `fnoGross` from whole-account `realisedDerived` (cash −₹15k + currency included), so its
"₹51k undercount ⚠" is a multi-segment residual, not an F&O gap.
