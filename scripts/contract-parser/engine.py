#!/usr/bin/env python3
"""Indian contract-note parsing engine - proven across Zerodha, Fyers, Upstox, Dhan.

SEBI-standardised contract notes (cash + F&O, single & combined-segment). Decrypts via a
CN_PW_* env var (process-lifetime; never a file/echo/log), extracts a PER-FILL derived ledger
+ the itemized charge breakdown, and reconciles per clearing segment.

Charges come from the STRUCTURAL charges table, reading the VALUE CELLS - NOT text-scanning
label lines (which would read the "@9%" in a "CGST (@9% ...)" label as an amount = fabrication).
Blank cell -> 0 (a blank CGST/SGST is a real same-state-vs-inter-state GST split, never copied
from IGST). Signed values (parens / DR-CR / leading-minus) so the checksum holds with signs:
    net_amount == obligation + sum(all charge components)   (within a paisa)
where obligation is the pay-in line (Zerodha) or the sum of signed fills (Fyers/Dhan/Upstox).

Output discipline (PII-safe):
  - REAL ledger (values) -> gitignored out/ledger_*.json (local only) / pushed to KV by run.py.
  - STDOUT -> MASKED structural summary ONLY: counts, field coverage, charge KEYS present,
    GST split, checksum + per-segment 1b PASS/FAIL + residual. Never client name/address/PAN,
    and never raw symbols/ISINs/amounts in the masked path.
  - `--debug` / `--layout` -> PII-redacted structure dumps for tuning; `--wapkeys` -> join diag.
This module is the proven LOGIC; the standalone runner (decrypt -> parse -> KV) is run.py.
"""
import os, sys, re, json, glob

HERE = os.path.dirname(__file__)
OUT = os.path.join(HERE, "out")
NUM = r"-?\(?\d[\d,]*\.?\d*\)?"
ISIN_RE = re.compile(r"\bIN[A-Z0-9]{10}\b")

# charge labels (in the charges-summary table's first column) -> normalized key.
# pay_in / net_amount are the obligation + total rows (not charge components).
TABLE_LABELS = [
    (r"pay\s*-?\s*in", "pay_in"),
    (r"net\s*amount", "net_amount"),   # \s* : old-Zerodha runs it together ("Netamountreceivable...")
    (r"total taxable value", "gst_base"),                       # the GST BASE SUBTOTAL - informational, NOT summed
    (r"integrated gst|\bigst\b", "igst"),                       # GST before brokerage: "[IGST 18% On Brokerage]"
    (r"central gst|\bcgst\b", "cgst"),                          # -> igst, NOT brokerage (the 'On Brokerage' is a
    (r"state gst|\bsgst\b", "sgst"),                            # description, like Zerodha's parenthetical)
    (r"taxable value of supply|brokerage", "brokerage"),        # NEW-Dhan/Fyers bare TV = brokerage (summed); OLD-Dhan reclassifies in build_ledger
    (r"exchange transaction|toc.*exchange|nse exchange|bse exchange|transaction charge|turnover chg|turnover charge", "exchange_txn"),
    (r"clearing charge|cmcharges|cm charges", "clearing"),      # Fyers "Cmcharges" = clearing-member charge (REAL)
    (r"securities transactions? tax|\bstt\b", "stt"),
    (r"commodit.*transactions? tax|\bctt\b", "ctt"),
    (r"sebi turnover|sebi fee|sebi.?toc|sebitoc", "sebi_turnover"),
    (r"\bipft\b", "ipft"),
    (r"stamp", "stamp_duty"),
    (r"other tax|\butt\b|union territory tax", "other_tax"),   # old-Dhan tiny sub-line; Groww's UTT (Union Territory Tax, 0 outside UTs) — recognised, not a CHARGE_KEY
    (r"span\s*mg|exp\.?\s*mg|del\.?\s*mg|exposure margin|span margin", "margin"),   # F&O COLLATERAL (SPAN/EXP/DEL)
]                                  # other_tax/margin -> recognised, NOT in CHARGE_KEYS. margin balances the NET (checksum), is not a cost.
CHARGE_KEYS = ["brokerage", "exchange_txn", "clearing", "cgst", "sgst", "igst",
               "stt", "ctt", "sebi_turnover", "ipft", "stamp_duty",
               "other_levy"]   # old-Dhan itemises a real "Other Tax" levy (part of Net Amount);
# it gets its OWN summed key so stamp_duty stays pure. Emitted ONLY by the old-Dhan text path
# (parse_charges_from_text old_dhan=True), so adding it here is inert for every other broker/path —
# Groww's 'UTT'/other_tax (0 outside UTs) stays a recognised NON-charge, unchanged.
# keys that ACCUMULATE across rows/tables (vs overwrite). 'margin' (SPAN/EXP/DEL collateral) sums like
# a charge but is NOT a CHARGE_KEY - it balances the NET checksum, never counts as a cost or GST base.
_ACCUM_KEYS = set(CHARGE_KEYS) | {"margin"}
# Container leads that are NOT the charge name - the real charge is in the parenthetical
# (Fyers: "Taxable Value Of Supply (Brokerage)"). Distinct from Zerodha's "IGST (@18% of
# Brokerage...)" where the lead IS the charge and the () is a description.
GENERIC_LEADS = ("taxable value of supply", "total taxable value", "value of supply")
# Note metadata that sits in a charges table's label column but is NOT a charge - so it isn't
# flagged as an "unmapped charge" (settlement id, contract no, dates, amount-in-words, etc.).
_CHARGE_META = re.compile(r"settlement|contract note|trade date|\bucc\b|\bpan\b|invoice|in words|"
                          r"order no|trade no|nomination|exchange/segment|ledger balance|opening balance|"
                          r"clearing cor", re.I)                       # old-Dhan "Clearing Corporation/Coporation" header row

def pnum(s):
    """Parse a money cell. Zerodha parenthesises debits: '(29,458.26)' -> -29458.26. Fyers/Dhan
    suffix DR/CR: '43.61 DR' -> -43.61 (debit), '5.00 CR' -> 5.00 (credit). blank/'-' -> None;
    '0.90' -> 0.90. Plain numbers are unaffected (no DR/CR, no parens)."""
    if s is None: return None
    t = str(s).strip()
    if t in ("", "-", "--", "nil", "Nil", "NIL"): return None
    sign = 1
    m = re.search(r"\b([DC])R\b", t, re.I)              # DR=debit=negative, CR=credit=positive
    if m:
        sign = -1 if m.group(1).upper() == "D" else 1
        t = re.sub(r"\b[DC]R\b", "", t, flags=re.I).strip()
    t = t.replace(",", "").replace("₹", "").strip()
    neg = (t.startswith("(") and t.endswith(")")) or t.startswith("-")   # parens OR a leading minus
    t = t.strip("()").lstrip("-").strip()
    if not re.search(r"\d", t): return None
    try:
        v = float(re.sub(r"[^\d.]", "", t))
        v = -v if neg else v
        return v * sign
    except Exception:
        return None

def label_key(label):
    l = (label or "").strip().lower()
    l = re.sub(r"^\d{1,2}(?=[a-z])", "", l)                  # old-Zerodha footnote digit glued to the label: "4IGST" -> "IGST"
    lead = re.sub(r"\([^)]*\)", " ", l).strip()              # text OUTSIDE the parens
    paren = " ".join(re.findall(r"\(([^)]*)\)", l)).strip()  # text INSIDE the parens
    if paren.isdigit():                                      # footnote like "(3)" - not a charge name
        paren = ""
    # Charge identity is normally the LEADING text; the parenthetical is a description to ignore -
    # Zerodha "IGST (@18% of Brokerage, SEBI, Transaction & Clearing charges)" -> igst, NOT
    # brokerage (the () words would mis-match otherwise). BUT when the lead is a generic container
    # ("Taxable Value Of Supply"), the real charge name is INSIDE the parens - Fyers wraps every
    # line that way: "Taxable Value Of Supply (Brokerage)" / "(Sebitoc)" / "(Toc Nse Exchange)".
    key_text = paren if (paren and any(g in lead for g in GENERIC_LEADS)) else lead
    for pat, key in TABLE_LABELS:
        if re.search(pat, key_text):
            return key
    return None

# Per-account routing: a contract note is encrypted with the account holder's PAN, so the
# password that DECRYPTS it identifies the account. Try EVERY CN_PW_* env var (CN_PW_SELF,
# CN_PW_MOM, CN_PW_UPSTOX, CN_PW_DHAN, ...) + legacy bare CN_PW; whichever opens the note wins -
# exactly like the probe. Owner/tax-entity is 'mom' ONLY for CN_PW_MOM; every other account
# (self's Zerodha / Upstox / Dhan / Fyers) is 'self'. Adding a broker = adding a CN_PW_* var, no
# code change. You can't mis-tag (the wrong PAN won't open the note). The password is never echoed.
def detect_entity_pw(path):
    import pypdf
    candidates = [("mom" if k.upper() == "CN_PW_MOM" else "self", v)
                  for k, v in os.environ.items() if k.upper().startswith("CN_PW_") and v]
    if os.environ.get("CN_PW"):
        candidates.append(("unknown", os.environ["CN_PW"]))     # legacy single-account testing
    for entity, pw in candidates:
        try:
            r = pypdf.PdfReader(path)
            if (not r.is_encrypted) or (r.decrypt(pw) != pypdf.PasswordType.NOT_DECRYPTED):
                return entity, pw
        except Exception:
            continue
    return None, None

def open_decrypted(path):
    import pdfplumber
    entity, pw = detect_entity_pw(path)
    if pw is None:
        return None, None
    return pdfplumber.open(path, password=pw), entity

def full_text(pdf):
    return "\n".join((pg.extract_text() or "") for pg in pdf.pages)

# Broker identity from the member name in the note body (read locally; only the resolved label,
# never the raw text, is surfaced). Drives the per-broker charge/segment quirks.
def detect_broker(text):
    t = (text or "").lower()
    if "zerodha" in t: return "zerodha"
    if "fyers" in t: return "fyers"
    if "upstox" in t or "rksv" in t: return "upstox"
    # Astha Trade (rebranded Rupeezy) and Groww — checked BEFORE dhan. The loose
    # "dhan" substring was actually matching the CLIENT NAME "Pra-dhan" on notes
    # that no earlier broker claimed (Astha, Groww), mis-tagging them as dhan and
    # silently dropping their trades. Fixed two ways: name these brokers explicitly,
    # AND word-bound the dhan test (\bdhan\b) so a "-dhan" surname can't match —
    # real Dhan notes carry "Dhan"/"Moneylicious"/"Raise Securities" as standalone
    # tokens. (Groww = Nextbillion Technology.)
    if "asthatrade" in t or "astha" in t or "rupeezy" in t: return "astha"
    if "groww" in t or "nextbillion" in t: return "groww"
    if re.search(r"\bdhan\b", t) or "moneylicious" in t or "raise securities" in t: return "dhan"
    return "unknown"

# Note-level metadata from the note CONTENT (NOT the account-coded filename): the contract-note
# number (KV key) and the trade/contract date (the (broker, date) join key the dashboard needs).
_CN_RE = re.compile(r"contract\s*note\s*(?:no|number)\.?\s*[:#-]?\s*([A-Za-z0-9/_-]{3,})", re.I)
_DATE_DMY = re.compile(r"(?:trade|contract)\s*date\s*[:.\-]?\s*(\d{1,2})\s*[/-]\s*(\d{1,2})\s*[/-]\s*(\d{2,4})", re.I)
_DATE_MDY = re.compile(r"(?:trade|contract)\s*date\s*[:.\-]?\s*([A-Za-z]{3,9})\s+(\d{1,2})[,\s]+(\d{4})", re.I)  # old Dhan "Sep 6 2023"
_MONTHS = {m: i for i, m in enumerate("jan feb mar apr may jun jul aug sep oct nov dec".split(), 1)}

def contract_note_no(text):
    m = _CN_RE.search(text or "")
    return re.sub(r"[^A-Za-z0-9]", "-", m.group(1)).strip("-") if m else None

def trade_date(text):
    """Trade/Contract date -> ISO YYYY-MM-DD. DD/MM/YYYY & DD-MM-YYYY (day-first), or "Mon D YYYY" (old Dhan)."""
    t = text or ""
    m = _DATE_DMY.search(t)
    if m:
        d, mo, y = (int(x) for x in m.groups())
        y = 2000 + y if y < 100 else y
        return f"{y:04d}-{mo:02d}-{d:02d}" if (1 <= mo <= 12 and 1 <= d <= 31) else None
    m = _DATE_MDY.search(t)
    if m:
        mo = _MONTHS.get(m.group(1)[:3].lower())
        d, y = int(m.group(2)), int(m.group(3))
        return f"{y:04d}-{mo:02d}-{d:02d}" if (mo and 1 <= d <= 31) else None
    return None

# Upstox PDFs rule COLUMNS but not ROWS (no horizontal lines), so pdfplumber's default line-based
# row detection merges every row into one cell -> 0 fills / charges collapsed. Use text-position
# rows for Upstox (columns still by ruled lines); Zerodha/Fyers are fully ruled - keep the default
# (changing theirs would regress the proven adapters). Detect broker FIRST (from text), then extract.
_OLD_DHAN_RE = re.compile(r"net total\s*\(before levies\)|pay in\s*/\s*pay out", re.I)

def extract_tables_for(pdf, broker, text=""):
    # Upstox (always) and old-Dhan 2023-24 rule COLUMNS but not ROWS, so pdfplumber's default
    # line-based extraction merges every fill into one cell. Use text-position rows for those;
    # keep the proven line-based default for everything else (changing it would regress them).
    if (broker in ("upstox", "astha")                        # these rule columns but not rows (like Upstox)
            or (broker == "dhan" and _OLD_DHAN_RE.search(text or ""))):
        settings = {"vertical_strategy": "lines", "horizontal_strategy": "text",
                    "snap_tolerance": 4, "join_tolerance": 4, "text_tolerance": 3}
        return [t for pg in pdf.pages for t in (pg.extract_tables(settings) or [])]
    return [t for pg in pdf.pages for t in (pg.extract_tables() or [])]

# ---------- charges: STRUCTURAL parse of the charges-summary table ----------
# pure predicate (testable without a PDF)
def is_charges_table(tbl):
    if not tbl:
        return False
    labels = " ".join((r[0] or "").lower() for r in tbl if r)
    # 'transactions tax' (plural) breaks a 'transaction tax' substring match - allow both, and
    # treat IGST/STT/stamp as tax signals. The combined note's LOWER block is net+IGST+STT only.
    if "net amount" in labels and re.search(r"transactions? tax|\bstt\b|\bigst\b|stamp", labels):
        return True
    # else: >=3 rows resolve to a real CHARGE key with a value (the upper block / a full table).
    charge_rows = sum(1 for r in tbl if r and label_key(r[0]) in CHARGE_KEYS
                      and any(pnum(c) is not None for c in r[1:]))
    return charge_rows >= 3

def find_charges_table(tables):
    fallback = None
    for tbl in tables:
        if not tbl: continue
        labels = " ".join((r[0] or "").lower() for r in tbl if r)
        if "net amount" in labels and ("transaction tax" in labels or "stamp" in labels):
            return tbl                              # prefer the explicit-header table
        if is_charges_table(tbl) and fallback is None:
            fallback = tbl
    return fallback

# pure (tbl -> charges) so it's unit-testable without a PDF
def parse_charges_rows(tbl):
    if not tbl or len(tbl) < 2:
        return None
    by_seg, net_total, unmapped = {}, {}, []
    def note_unmapped(row):                        # a charge row (has $ values) we couldn't key
        lbl = (row[0] or "").strip()
        if lbl and not _CHARGE_META.search(lbl) and any(pnum(c) is not None for c in row[1:]):
            unmapped.append(lbl[:40])               # skip note metadata (settlement no, dates, ...)
    def setnt(key, v):                             # ACCUMULATE charge keys (Upstox: two IGST lines, two
        if key in _ACCUM_KEYS:                     # STT lines, multiple SPAN/EXP/DEL margin lines must SUM);
            net_total[key] = round(net_total.get(key, 0.0) + v, 4)   # singletons (net_amount/pay_in/gst_base) overwrite.
        else:
            net_total[key] = v
    # Row 0 is a column HEADER (Zerodha: 'label | NCL-Cash | NCL-F&O | NET TOTAL') only if it has
    # NO numeric cells. Fyers merges the first CHARGE row into the header (it has $ values) and
    # has no clean net-total column -> the per-charge total is the last non-blank value cell.
    header_is_data = any(pnum(c) is not None for c in tbl[0][1:])
    if header_is_data:
        for row in tbl:
            if not row or not row[0]:
                continue
            key = label_key(row[0])
            if not key:
                note_unmapped(row); continue
            nz = [v for v in (pnum(c) for c in row[1:]) if v is not None]
            setnt(key, nz[-1] if nz else 0.0)          # the 'Total' (across-segment) column
        return {"by_clearing_segment": by_seg, "net_total": net_total, "unmapped_labels": unmapped}
    header = [(c or "").strip() for c in tbl[0]]
    colnames = ["label"]                       # name each value column; unlabelled -> None (skip)
    for i, h in enumerate(header[1:], start=1):
        hl = h.lower()
        colnames.append("net_total" if ("net" in hl and "total" in hl) else (h.strip() or None))
    if "net_total" not in colnames and len(colnames) > 1:
        last = max((i for i, c in enumerate(colnames) if c), default=len(colnames) - 1)
        colnames[last] = "net_total"           # last LABELLED column is the total (skip empty trailers)
    for row in tbl[1:]:
        if not row or not row[0]:
            continue
        key = label_key(row[0])                # keyed off the LABEL cell only
        if not key:
            note_unmapped(row); continue
        for i in range(1, min(len(colnames), len(row))):
            if colnames[i] is None:            # empty/unlabelled column - NOT a segment (no phantom col3-7)
                continue
            v = pnum(row[i])                   # VALUE cell - "@9%" in the label never reaches here
            v = 0.0 if v is None else v         # blank cell -> 0 (real GST split, never copied)
            if colnames[i] == "net_total":
                setnt(key, v)                   # SUM repeated charge keys (two IGST/STT lines)
            else:
                seg = by_seg.setdefault(colnames[i], {})
                seg[key] = round(seg.get(key, 0.0) + v, 4) if key in _ACCUM_KEYS else v
    return {"by_clearing_segment": by_seg, "net_total": net_total, "unmapped_labels": unmapped}

# Astha/Rupeezy adapter: this broker lists the charges block as FREE-TEXT lines
# ("Securities Transaction Tax  12.34"), not a ruled table — pdfplumber extracts
# no charges table, so parse_charges_from_tables returns None. Read the same
# obligation/charge/net labels off the text via the SHARED label_key() (so the
# GST split, 'Taxable Value of Supply (Brokerage)' → brokerage, 'PAY IN/PAY OUT'
# → pay_in, 'Net Amount Payable' → net_amount mappings are identical to the
# table path — no new label logic). A line qualifies only when its label maps to
# a known key AND it ends in a signed 2-decimal money token; every trade-detail
# and boilerplate line fails one of those, so nothing spurious is summed.
_TEXT_MONEY_TAIL = re.compile(r"(-?\(?\d[\d,]*\.\d{2}\)?)\s*(?:DR|CR)?\s*$", re.I)

def parse_charges_from_text(text, old_dhan=False):
    net_total, unmapped = {}, []
    for raw in (text or "").splitlines():
        line = raw.strip()
        if not line:
            continue
        m = _TEXT_MONEY_TAIL.search(line)
        if not m:
            continue
        label = line[:m.start()].strip()
        key = label_key(label)
        if not key:
            continue
        # Old-Dhan's "Taxable Value of Supply" is the GST BASE subtotal (= Brokerage
        # + Exchange + SEBI, per the note's own footnote), NOT a brokerage charge.
        # label_key maps bare TVS -> brokerage (right for new-Dhan/Fyers), so pin it
        # to the informational gst_base here, else it double-counts into the checksum
        # (brokerage is already folded into PAY IN/PAY OUT OBLIGATION on old-Dhan).
        if old_dhan and "taxable value of supply" in label.lower():
            key = "gst_base"
        # Old-Dhan's "Other Tax" is a real levy that IS part of Net Amount Payable
        # (label_key maps it to 'other_tax', a NON-summed key kept for Groww's UTT=0).
        # Re-key it to the dedicated summed 'other_levy' so it reconciles into the
        # charge TOTAL on its OWN line — stamp_duty is left carrying only stamp duty.
        if old_dhan and "other tax" in label.lower():
            key = "other_levy"
        v = pnum(m.group(0))
        if v is None:
            continue
        # Astha prints CHARGE magnitudes UNSIGNED (all payable = debit), while the
        # obligation/total rows (pay_in, net_amount) carry explicit signs. Match the
        # table path's signed convention: charges are debits → negative; the checksum
        # net_amount == pay_in + Σcharges then closes with signs.
        if key in CHARGE_KEYS:
            v = -abs(v)
        if key in _ACCUM_KEYS:
            net_total[key] = round(net_total.get(key, 0.0) + v, 4)
        else:
            net_total[key] = v                      # net_amount / pay_in / gst_base overwrite
    if not net_total or "net_amount" not in net_total:
        return None                                 # no reconcilable charges block found in text
    return {"by_clearing_segment": {}, "net_total": net_total, "unmapped_labels": unmapped}

def parse_charges_from_tables(tables):
    # A combined (equity+F&O) note splits charges across tables - notably a separate IGST-rate
    # table. Take the RICHEST charge table as primary and SUPPLEMENT only missing/zero keys from
    # the others (so a split-out IGST is picked up without double-counting a charge listed twice).
    parsed = []
    for tbl in tables:
        if is_charges_table(tbl):
            ch = parse_charges_rows(tbl)
            if ch:
                rich = sum(1 for k in ch["net_total"] if k in CHARGE_KEYS)
                parsed.append((rich, ch))
    if not parsed:
        return None
    parsed.sort(key=lambda x: x[0], reverse=True)
    merged = {"by_clearing_segment": {}, "net_total": {}, "unmapped_labels": []}
    for _, ch in parsed:
        for k, v in ch["net_total"].items():
            cur = merged["net_total"].get(k)
            if cur is None or (cur in (0, 0.0) and v not in (0, 0.0)):   # add missing / upgrade a zero
                merged["net_total"][k] = v
        for seg, d in ch["by_clearing_segment"].items():
            merged["by_clearing_segment"].setdefault(seg, {}).update(d)
        for u in ch["unmapped_labels"]:
            if u not in merged["unmapped_labels"]:
                merged["unmapped_labels"].append(u)
    return merged

# #2: some Fyers notes print the "Net Amount Receivable/Payable" obligation in a
# SEPARATE small table from the charges summary, so the charges table parses every
# levy but carries NO net_amount row -> checksum can't run -> the note refuses.
# Recover net_amount from that orphaned table: the first NON-charges table with a
# "Net Amount" row -> its Total column = the last populated, CR/DR-signed money cell.
def orphan_net_amount(tables):
    for tbl in tables or []:
        if not tbl or is_charges_table(tbl):
            continue
        for row in tbl:
            if row and re.search(r"net\s*amount", (row[0] or ""), re.I):
                nz = [v for v in (pnum(c) for c in row[1:]) if v is not None]
                if nz:
                    return nz[-1]           # Total (across-segment) column = last value cell
    return None

def checksum(net_total, fills=None):
    """net_amount == obligation + sum(charge components), within a paisa. Obligation is the
    explicit 'pay-in' line (Zerodha) or, when there is none, the sum of fill net-totals (Fyers/
    Dhan, whose charges table has no pay-in row). Returns (pass|None, residual)."""
    if not net_total:
        return (None, None)
    net_amt = net_total.get("net_amount")
    if net_amt is None:
        return (None, None)
    pay_in = net_total.get("pay_in")
    if pay_in is not None:
        obligation = pay_in
    elif fills:
        obligation = sum((f.get("net_total") or 0.0) for f in fills)   # no pay-in row -> sum fills
    else:
        return (None, None)
    csum = sum(net_total.get(k, 0.0) for k in CHARGE_KEYS)
    margin = net_total.get("margin", 0.0)   # collateral movement (SPAN/EXP/DEL) is in the NET cash but is
    residual = round(net_amt - (obligation + csum + margin), 4)   # NOT a charge - balances the checksum, excluded from cost
    return (abs(residual) <= 0.01, residual)

# Map a clearing-segment LABEL to a fill segment. Handles every broker's naming: NCLCM/NCLCD->cash,
# NCLFO->fno, Upstox EQ-CASH->cash, FO-EQ->fno. Order matters - check fno (fo/deriv) before cash so
# "fo-eq" -> fno (it contains neither 'cash' nor 'cm'); "eq-cash" -> cash (no 'fo'/'deriv').
def _seg_to_fill(seg):
    sl = (seg or "").lower()
    if "fo" in sl or "deriv" in sl or "f&o" in sl or "futur" in sl: return "fno"   # old-Dhan: "NCL FUTURES"
    if "cm" in sl or "cash" in sl or "equity" in sl or "capital" in sl: return "cash"  # old-Dhan: "NCL CAPITAL"
    return None

def per_segment_checksum(charges, fills):
    """Combined (equity+F&O) notes reconcile INDEPENDENTLY per clearing segment - NCLCM (cash) and
    NCLFO (fno) each close: seg_net == seg_obligation + seg_charges. Catches cross-segment
    misattribution a total-only checksum can't. Returns {seg: {pass, residual}} for segments that
    carry a per-segment net_amount (empty for single-segment notes)."""
    out = {}
    if not charges:
        return out
    for seg, d in charges.get("by_clearing_segment", {}).items():
        net = d.get("net_amount")
        fill_seg = _seg_to_fill(seg)
        if net is None or fill_seg is None:
            continue
        # Obligation: mirror checksum() - prefer the segment's pay-in row when present (it's
        # brokerage-agnostic: brokerage is either folded into pay-in (Upstox 2025 / old-Dhan, where
        # the detail carries it and the charges table doesn't) or listed as a charge). Falling back
        # to sum-of-fills only when there's no per-segment pay-in keeps combined-note behaviour.
        seg_payin = d.get("pay_in")
        obl = seg_payin if seg_payin is not None else sum(
            (f.get("net_total") or 0.0) for f in fills if f.get("segment") == fill_seg)
        chg = sum(d.get(k, 0.0) for k in CHARGE_KEYS)
        resid = round(net - (obl + chg + d.get("margin", 0.0)), 4)   # margin balances the net, not a charge
        out[seg] = {"pass": abs(resid) <= 0.02, "residual": resid}
    return out

def gst_check(net_total):
    """Attribution assertion (the total checksum can't catch a mis-keyed GST). When there's a
    GST-able base (brokerage/txn/SEBI/clearing > 0), GST must be non-zero AND exactly ONE
    side populated - IGST (inter-state) XOR CGST+SGST (same-state). Returns (pass|None, detail)."""
    if not net_total:
        return (None, "no charges table")
    g = lambda k: abs(net_total.get(k, 0.0) or 0.0)
    igst, cgst, sgst = g("igst"), g("cgst"), g("sgst")
    base = g("brokerage") + g("exchange_txn") + g("sebi_turnover") + g("clearing")
    one_side = (igst > 0) ^ (cgst > 0 or sgst > 0)
    total_gst = igst + cgst + sgst
    side = "igst" if igst > 0 else ("cgst+sgst" if (cgst > 0 or sgst > 0) else "none")
    if base > 0:
        ok = (total_gst > 0) and one_side
    else:
        ok = (total_gst == 0) or one_side   # no taxable base -> GST may legitimately be 0
    return (ok, f"side={side} base>0={base>0}")

# F&O presence is gated by NOTE CONTENT, not by account - so mom's first F&O note parses
# with zero code changes (and its turnover lands under HER tax_entity automatically).
def note_has_fno(fills, charges):
    # True only on REAL F&O activity - never just because the NCL-F&O column exists (every
    # Zerodha note has that column structurally; an all-cash note must report has_fno=False,
    # else it would wrongly trip F&O business-income / audit treatment).
    if any(f.get("segment") == "fno" for f in fills):
        return True
    if charges:
        if abs(charges["net_total"].get("ctt", 0) or 0) > 0:        # CTT with a real value
            return True
        for seg, vals in charges["by_clearing_segment"].items():     # NCL-F&O column NON-ZERO
            if ("f&o" in seg.lower() or "fno" in seg.lower()) and any(abs(v or 0) > 0 for v in vals.values()):
                return True
    return False

# ---------- two rollup lenses over the SAME account-tagged ledger ----------
def _turnover(fills):
    return round(sum(abs(f.get("net_total") or 0.0) for f in fills), 2)

def wealth_lens(fills):
    """Combined - both accounts are 'my money'. Sums across self + mom."""
    by_acct = {}
    for f in fills:
        by_acct[f.get("account", "?")] = by_acct.get(f.get("account", "?"), 0) + 1
    return {"total_fills": len(fills), "by_account": by_acct, "turnover": _turnover(fills)}

def tax_lens(fills, entity="self"):
    """HARD filter on tax_entity - other entities' fills are INVISIBLE here (never on my ITR).
    F&O turnover is scoped to `entity` too, so mom's future F&O never enters MY audit threshold."""
    mine = [f for f in fills if f.get("tax_entity") == entity]
    fno = [f for f in mine if f.get("segment") == "fno"]
    return {"entity": entity, "fills": len(mine),
            "excluded_other_entity_fills": len(fills) - len(mine),
            "turnover": _turnover(mine), "fno_turnover_for_audit": _turnover(fno)}

# ---------- trades: ruled tables (preferred), text fallback ----------
def split_isin(instrument, isin):
    if isin:
        return instrument.strip(), isin.strip()
    m = ISIN_RE.search(instrument or "")
    if m:
        sym = (instrument[:m.start()] + instrument[m.end():]).strip(" \n|-")
        return sym, m.group(0)
    return (instrument or "").strip(), ""

# Per-fill segment, inferred from the instrument. Derivatives carry no ISIN (so an empty
# isin on an F&O/commodity fill is CORRECT, not a parse gap) - coverage exempts them.
DERIV_RE = re.compile(r"\b(FUT|FUTIDX|FUTSTK|FUTCOM|CE|PE|OPT|OPTIDX|OPTSTK)\b|\d{1,2}[A-Z]{3}\d{2}", re.I)
def infer_segment(f):
    ins = (f.get("instrument") or "")
    if f.get("isin"):
        return "cash"
    if DERIV_RE.search(ins):
        return "fno"
    return "unknown"

def note_segment_hint(tables):
    """Note-level segment from the clearing-obligation table (Equity NCL/ICCL -> cash,
    Derivative NCL -> fno, Currency NCL -> currency) - the fallback for fills infer_segment
    leaves 'unknown' (e.g. an equity fill whose ISIN wasn't on the detail row)."""
    for tbl in tables or []:
        if not tbl or len(tbl) < 2: continue
        hdr = [_nh(c) for c in tbl[0]]
        if not any(("ncl" in h or "iccl" in h) for h in hdr): continue
        for row in tbl[1:]:
            for i, c in enumerate(row):
                v = pnum(c)
                if i < len(hdr) and v is not None and abs(v) > 0:
                    h = hdr[i]
                    if "equity" in h: return "cash"
                    if "derivative" in h: return "fno"
                    if "currency" in h: return "currency"
    return None

def charge_segment_hint(charges):
    """Fallback when the clearing-obligation table isn't recognised: if EXACTLY ONE clearing
    segment carries charges (NCLCM->cash only, or NCLFO->fno only), the note is single-segment and
    'unknown' fills belong to it. Empty (None) when 0 or >1 segments are active (combined note -
    can't single-tag; per-fill ISIN/DERIV must decide)."""
    if not charges:
        return None
    active = {_seg_to_fill(seg) for seg, d in charges.get("by_clearing_segment", {}).items()
              if _seg_to_fill(seg) and any(abs(v or 0) > 0 for v in d.values())}
    return next(iter(active)) if len(active) == 1 else None

# A table is a FILL source only if it's the per-fill DETAIL table - it must carry per-fill
# identifiers (Order No / Trade No / Trade Time). The per-contract/per-ISIN SUMMARY table
# (WAP source) has Quantity but NO trade ids, so it is NOT emitted as fills - otherwise its
# aggregate rows double-count the same trades (F&O: 4 summary + 5 detail = 9 phantom fills,
# inflating audit-threshold turnover).
def _nh(s):
    return re.sub(r"\s+", " ", (s or "").strip().lower())   # collapse newlines: "Trade\nNo." -> "trade no."

def is_detail_header(header):
    h = [_nh(c) for c in header]
    has_qty = any(("quantity" in x or x == "qty") for x in h)
    has_id = any(any(t in x for t in ("order no", "trade no", "trade time", "order time")) for x in h)
    if has_qty and has_id:
        return True
    # Upstox's text-strategy splits the multi-line header into rows, truncating 'Order No.'->'order',
    # 'Trade No.'->'trade'. Recognise the detail by structure: quantity + an order col + a trade col
    # + a security/contract col (summary tables have qty+contract but NO order/trade).
    has_order = any(x.startswith("order") for x in h)
    has_trade = any(x.startswith("trade") for x in h)
    has_sec = any(("security" in x or "contract" in x) for x in h)
    return has_qty and has_order and has_trade and has_sec

def find_detail_header_row(tbl):
    # The column header may not be row 0 - some brokers put a TITLE row above it (Fyers's
    # "Trade Annexure"). Scan the first few rows for the real Order/Trade-No header so the
    # title row doesn't make is_detail_header() miss the table (-> 0 fills).
    for i in range(min(4, len(tbl))):
        if is_detail_header(tbl[i]):
            return i
    return None

# Upstox detail header truncates under the text strategy ('Order No.'->'Order', two 'Order'/'Trade'
# cols collide), so text-matching is unreliable. The schema is FIXED, so map by POSITION instead.
UPSTOX_DETAIL_COLS = {"order_no": 0, "order_time": 1, "trade_no": 2, "trade_time": 3,
                      "instrument": 4, "side": 5, "qty": 6, "price": 8, "net_total": 9,
                      "isin": None, "wap": None, "brokerage": None}

def map_table(tbl, broker=""):
    if not tbl or len(tbl) < 2: return []
    hi = find_detail_header_row(tbl)
    if hi is None: return []                      # DETAIL tables only - summary rows are NOT fills
    if broker == "upstox":
        # Upstox splits the detail header across several rows (text strategy). MERGE them per column
        # so the NAMES are recoverable: the 2025 layout inserts WAP/Brokerage/Closing cols, shifting
        # 'Net Total' from col 9 (2026) to col 12 - a fixed positional schema mis-maps it. Merge the
        # header block (rows until the first fill row, detected by an 8+ digit order id), then match.
        end = hi + 1
        while end < len(tbl) and end < hi + 7 and not any(re.search(r"\d{6,}", (c or "")) for c in tbl[end]):
            end += 1
        ncol = max((len(r) for r in tbl[hi:end]), default=0)
        header = [_nh(" ".join((tbl[r][c] or "").replace("\n", " ") for r in range(hi, end) if c < len(tbl[r])))
                  for c in range(ncol)]
    else:
        header = [_nh(_c) for _c in tbl[hi]]      # normalise newlines so "Trade\nTime" matches
    def col(*names):
        # candidate ORDER is priority: try each name across all columns before the next name, so
        # "net rate" wins over "gross rate" when a layout (2025 Upstox) carries BOTH price columns.
        for n in names:
            for i, h in enumerate(header):
                if n in h: return i
        return None
    ci = {k: col(*v) for k, v in {
        "instrument": ["security", "contract", "description", "symbol"], "isin": ["isin"],
        "side": ["buy", "sell", "b/s"], "qty": ["quantity", "qty"],
        "price": ["net rate", "trade price", "gross rate", "price"],     # Dhan detail col = "Price"
        "net_total": ["net total", "net amount"],                        # Dhan detail col = "Net Amount"
        "wap": ["wap", "weighted"], "brokerage": ["brokerage"],
        "order_no": ["order no"], "trade_no": ["trade no"], "trade_time": ["trade time"],
    }.items()}
    if broker == "upstox" and any(ci.get(k) is None for k in ("instrument", "side", "qty", "net_total")):
        ci = dict(UPSTOX_DETAIL_COLS)             # merge didn't resolve -> fall back to the fixed 10-col schema
    fills = []
    for row in tbl[hi + 1:]:
        if not any((c or "").strip() for c in row): continue   # text strategy inserts blank rows - skip
        cells = [(_c or "").strip() for _c in row]
        def g(k):
            i = ci.get(k); return cells[i] if (i is not None and i < len(cells)) else ""
        qty = g("qty")
        if not re.search(r"\d", qty): continue
        instr_n = _nh(g("instrument"))
        instr_alnum = re.sub(r"[^a-z0-9]", "", instr_n)        # strip *,space so "* NET *"/"*NET*" both -> "net"
        side_alnum = re.sub(r"[^a-z0-9]", "", _nh(g("side")))
        order_alnum = re.sub(r"[^a-z0-9]", "", _nh(g("order_no")))   # Groww per-contract subtotal rows carry "Total" in the ORDER-NO cell (ISIN in the security cell)
        if ("brokerage" in instr_n or instr_alnum in ("net", "summary", "total", "netsummary", "subtotal")
                or side_alnum in ("net", "summary", "total")
                or order_alnum in ("net", "summary", "total", "netsummary", "subtotal")):
            continue            # Trap 2: 'Brokerage Charges' rows; Trap 3: *NET*/*SUMMARY*/*TOTAL* subtotals (Astha 'Sub Total', Groww per-contract 'Total') - NOT fills
        side_raw = (g("side") or "").upper()
        side = "BUY" if side_raw.startswith("B") else ("SELL" if side_raw.startswith("S") else side_raw)
        sym, isin = split_isin(g("instrument"), g("isin"))     # ISIN split out of the description
        nt = pnum(g("net_total"))
        if nt is not None and side in ("BUY", "SELL"):         # cashflow sign by side: BUY=debit(-),
            nt = abs(nt) * (-1 if side == "BUY" else 1)        # SELL=credit(+). Fyers detail is UNSIGNED;
        fills.append({                                         # idempotent on Zerodha (already signed right).
            "instrument": sym, "isin": isin, "side": side,
            "qty": pnum(qty), "price": pnum(g("price")),
            "net_total": nt,
            "wap": pnum(g("wap")), "brokerage": pnum(g("brokerage")),
            "order_no": g("order_no"), "trade_no": g("trade_no"), "trade_time": g("trade_time"),
        })
    return fills

def parse_trades_from_tables(tables, broker=""):
    fills, n_detail, n_summary = [], 0, 0
    for tbl in tables:
        if not tbl: continue
        if find_detail_header_row(tbl) is not None:            # scans rows (header may not be row 0)
            n_detail += 1
            fills.extend(map_table(tbl, broker))
        elif any(("wap" in (c or "").lower() or "weighted" in (c or "").lower())
                 for r in tbl[:3] for c in r):
            n_summary += 1                           # aggregate/WAP table - counted, NOT a fill source
    return fills, {"detail_tables": n_detail, "summary_tables": n_summary}

# WAP often lives in a per-symbol/ISIN SUMMARY (net qty + weighted-avg rate), not the trade
# rows. Header may not be row 0 (a title row can precede it); the WAP header reads
# "WAP (Weighted Average Price)"; the join key may be ISIN or symbol. Key the result under
# BOTH so the per-fill backfill matches on whichever the trade rows carry.
# The summary has SEPARATE WAP columns under the Buy block and the Sell block, so a BUY fill's
# WAP and a SELL fill's WAP come from different columns. Returns {"buy":{}, "sell":{}, "any":{}}
# keyed by ISIN (and symbol), so the per-fill backfill can pick the side-correct WAP.
def _normkey(s):
    s = (s or "").upper()
    s = re.sub(r"[\s\-/]+(NSE|BSE|MCX|NFO|CDS|BFO)\s*$", "", s)   # drop a trailing exchange suffix ("- NSE")
    return re.sub(r"[^A-Z0-9]", "", s)                            # then drop spaces/dashes/punctuation

def _is_name_frag(s):
    """Of a wrapped F&O contract, is THIS physical fragment the NAME (part 1) or a TAIL? A
    derivative prefix (OPTIDX/OPTSTK/FUT...) => NAME -> its tail wraps BELOW. An option-type
    ('PE - NSE') or expiry/strike-digit fragment => TAIL -> its name wraps ABOVE. A plain
    non-wrapping contract is treated as a name (its 'below' grab finds no continuation -> no-op)."""
    s = (s or "").strip()
    if re.match(r"(OPT|FUT)", s, re.I): return True
    if re.match(r"(CE|PE|XX)\b", s, re.I): return False
    if s[:1].isdigit(): return False
    return True

def _lead_sym(s):
    """Leading trading symbol = the first alphanumeric run before a '-' or space ('COALINDIA-COAL
    INDIA LTD.' -> 'COALINDIA'). An extra ISIN-backfill key for when the detail's full security
    description differs from the summary block's short symbol."""
    m = re.match(r"[A-Za-z0-9&]+", (s or "").strip())
    return _normkey(m.group(0)) if m else ""

# Equity summary has spanning Buy/Sell BLOCKS (a 'Buy' header over its Qty|WAP|Value... and a
# 'Sell' header over its own Qty|WAP|Value...). pdfplumber flattens the 2-row header and loses
# which WAP column is buy vs sell, so resolve each block's column range from the
# 'Buy'/'Sell'/'Net Obligation' anchor positions, then pick the WAP column inside each block
# (sub-header row if present, else the first col after the anchor). Returns (buy, sell) keyed
# by isin/sym, or None when this isn't a block-style table (e.g. F&O = Buy/Sell rows).
def _wap_block(tbl, want="wap"):
    span_i = bcol = sc = endc = None
    for ri in range(min(3, len(tbl))):
        row = [(c or "").strip().lower() for c in tbl[ri]]
        b = next((i for i, h in enumerate(row) if h == "buy"), None)
        s = next((i for i, h in enumerate(row) if h == "sell"), None)
        if b is not None and s is not None and s > b:
            span_i, bcol, sc = ri, b, s
            endc = next((i for i, h in enumerate(row) if i > s and ("oblig" in h or ("net" in h and "total" in h))), len(row))
            break
    if span_i is None:
        return None
    sub = [(c or "").strip().lower() for c in tbl[span_i + 1]] if span_i + 1 < len(tbl) else []
    has_sub = any(any(t in c for t in ("wap", "weighted", "brokerage", "qty", "value")) for c in sub)
    def find_col(lo, hi):                                 # the WAP / brokerage column within a block
        for i in range(lo, min(hi, len(sub))):
            h = sub[i]
            if want == "wap" and ("wap" in h or "weighted" in h) and "after" not in h and "brokerage" not in h:
                return i
            if want == "brokerage" and "brokerage" in h and "after" not in h:
                return i
        return (lo + 1) if want == "wap" else None        # WAP has a positional fallback; brokerage needs the label
    bcl, scl = find_col(bcol, sc), find_col(sc, endc)
    buy, sell = {}, {}
    for row in tbl[span_i + (2 if has_sub else 1):]:
        if not row: continue
        isin = next((ISIN_RE.search(c).group(0) for c in row if c and ISIN_RE.search(c)), None)
        sym, _ = split_isin((row[0] or ""), "")
        for col, d in ((bcl, buy), (scl, sell)):
            if col is not None and col < len(row):
                v = pnum(row[col])
                if v not in (None, 0, 0.0):
                    for k in (isin, sym, _normkey(sym)):
                        if k: d[k] = v
    return buy, sell

def block_brokerage_from_tables(tables):
    """Equity Buy/Sell-block per-share brokerage, by isin/sym+side (the F&O brokerage_pu equivalent
    for the block layout). Feeds the same x-qty backfill so combined-note equity fills get brokerage."""
    buy, sell, anyb = {}, {}, {}
    for tbl in tables or []:
        if not tbl: continue
        blk = _wap_block(tbl, want="brokerage")
        if blk:
            b, s = blk
            buy.update(b); sell.update(s)
            for k, v in {**b, **s}.items(): anyb.setdefault(k, v)
    return {"buy": buy, "sell": sell, "any": anyb}

def wap_from_tables(tables):
    buy, sell, anyw = {}, {}, {}
    for tbl in tables:
        if not tbl: continue
        blk = _wap_block(tbl)                              # equity Buy/Sell BLOCK layout?
        if blk:
            b, s = blk
            buy.update(b); sell.update(s)
            for k, v in {**b, **s}.items(): anyw.setdefault(k, v)
            continue
        hdr_i = scol = bscol = None; wcols = []
        for ri in range(min(4, len(tbl))):                 # scan first rows for the header
            hdr = [(c or "").strip().lower() for c in tbl[ri]]
            ws = [i for i, h in enumerate(hdr) if ("wap" in h or "weighted" in h)            # prefer Rs over FC
                  and "after" not in h and "brokerage" not in h and "foreign" not in h and not re.search(r"\bfc\b", h)]
            s = next((i for i, h in enumerate(hdr) if any(x in h for x in
                      ("security", "symbol", "isin", "description", "scrip", "contract"))), None)
            bs = next((i for i, h in enumerate(hdr) if ("buy" in h and "sell" in h)
                       or "b/s" in h or ("b)" in h and "s)" in h)), None)   # 'B/S/BF/CF' (Dhan), 'Buy(B)/Sell(S)'
            # Upstox text strategy blanks the contract-column header, so s is None even though WAP +
            # B/S match. When there's a B/S col but no contract header, the contract is conventionally
            # col 0 (the summary's first column) - default to it rather than skipping the table.
            if ws and (s is not None or bs is not None):
                hdr_i, scol, wcols, bscol = ri, (s if s is not None else 0), ws, bs; break
        if hdr_i is None: continue
        hdr = [(c or "").strip().lower() for c in tbl[hdr_i]]
        def side_of(ci):                                   # buy/sell from the WAP col or nearest label to its left
            if "buy" in hdr[ci] or hdr[ci].strip() in ("b",): return "buy"
            if "sell" in hdr[ci] or hdr[ci].strip() in ("s",): return "sell"
            for j in range(ci, -1, -1):
                if "buy" in hdr[j]: return "buy"
                if "sell" in hdr[j]: return "sell"
            return None
        sides = {ci: side_of(ci) for ci in wcols}
        if len(wcols) == 2 and all(v is None for v in sides.values()):
            sides[wcols[0]], sides[wcols[1]] = "buy", "sell"   # Zerodha lays Buy block then Sell block
        srows = tbl[hdr_i + 1:]
        def _cont_frag(r):                                 # a continuation row: contract text, no B/S side
            if not r or scol >= len(r) or not (r[scol] or "").strip(): return ""
            if any("*net*" in _nh(c) for c in r): return ""   # a *NET* subtotal is NOT a name-wrap continuation
            if bscol is not None and bscol < len(r) and (r[bscol] or "").strip().upper()[:1] in ("B", "S"):
                return ""
            return (r[scol] or "").strip()
        for ri2, row in enumerate(srows):
            if scol >= len(row): continue
            if not any((c or "").strip() for c in row): continue   # phantom blank row (text strategy)
            if any("*net*" in _nh(c) for c in row):        # Trap 3: '*NET*' per-contract subtotal row - skip
                continue
            row_side = None                                # F&O: single WAP col + a B/S ROW indicator
            if bscol is not None and bscol < len(row):
                bsv = (row[bscol] or "").strip().upper()
                if bsv.startswith("B") and not bsv.startswith("BF"): row_side = "buy"
                elif bsv.startswith("S"): row_side = "sell"   # BF/CF (carry-forward) -> not a traded side
            if bscol is not None and row_side is None:     # blank-side / continuation / *NET* row - skip
                continue
            # Long contract names WRAP across physical rows (Upstox text strategy): the DATA row holds
            # only a fragment. If it's the NAME (starts with a letter), the tail is the row BELOW; if
            # it's the TAIL (starts with a digit), the name is the row ABOVE. Reassemble the full key.
            contract = (row[scol] or "").strip()
            if _is_name_frag(contract):                    # data row holds the NAME -> tail wraps BELOW
                if ri2 + 1 < len(srows):
                    contract = (contract + " " + _cont_frag(srows[ri2 + 1])).strip()
            elif ri2 - 1 >= 0:                             # data row holds a TAIL -> name wraps ABOVE
                contract = (_cont_frag(srows[ri2 - 1]) + " " + contract).strip()
            sym, isin = split_isin(contract, "")
            if not isin:                                   # pick up a dedicated ISIN column too
                for c in row:
                    m = ISIN_RE.search(c or "")
                    if m: isin = m.group(0); break
            for ci in wcols:
                if ci >= len(row): continue
                v = pnum(row[ci])
                if v is None: continue
                # F&O has a B/S ROW indicator -> the side is the ROW's, NOT the column's. (side_of
                # would wrongly read "buy" from the "Buy(B)/Sell(S)" column header and dump both
                # sides of a bought+sold contract into 'buy'.) Column-side only when there's no bscol.
                side = row_side if bscol is not None else sides.get(ci)
                tgt = {"buy": buy, "sell": sell}.get(side, anyw)
                for k in (isin, sym, _normkey(sym)):
                    if k:
                        tgt[k] = v
                        anyw.setdefault(k, v)             # fallback pool for single-WAP-col notes
    return {"buy": buy, "sell": sell, "any": anyw}

# The detail/Trade-Annexure rows carry only the symbol/contract, not the ISIN (which lives in the
# Security-Description block). Build symbol -> ISIN from any table that pairs them, so equity fills
# get an ISIN -> infer_segment() tags them 'cash' instead of 'unknown'.
def isin_map_from_tables(tables):
    m = {}
    for tbl in tables or []:
        for row in tbl or []:
            if not row: continue
            row_isin, syms = None, []
            for c in row:
                sym, isin = split_isin(c or "", "")
                if isin and not row_isin: row_isin = isin
                if sym: syms.append(sym)
            if row_isin:
                for sym in syms:
                    if _normkey(sym): m.setdefault(_normkey(sym), row_isin)
                    ls = _lead_sym(sym)
                    if ls: m.setdefault(ls, row_isin)         # also key by the leading trading symbol
    return m

def backfill_isin(fills, imap, all_isins=None):
    for f in fills:
        if not f.get("isin"):
            ins = f.get("instrument") or ""
            f["isin"] = imap.get(_normkey(ins)) or imap.get(_lead_sym(ins)) or None   # full key, else lead symbol
    # Combined note with a SINGLE cash ISIN (the equity leg): assign it to the non-derivative
    # fills still missing one. Symbol matching above wins when it resolves; this is the fallback
    # for when the detail symbol and the block's security text don't normalise to the same key.
    if all_isins and len(all_isins) == 1:
        only = next(iter(all_isins))
        for f in fills:
            if not f.get("isin") and not DERIV_RE.search(f.get("instrument") or ""):
                f["isin"] = only
    return fills

# Per-unit brokerage lives in the SUMMARY ('Brokerage per unit'), not the detail annexure, so
# per-fill brokerage = summary-per-unit x qty, mapped by contract+side (same shape as WAP).
def brokerage_pu_from_tables(tables):
    buy, sell, anyb = {}, {}, {}
    for tbl in tables or []:
        if not tbl: continue
        hdr_i = scol = bscol = bcol = None
        for ri in range(min(4, len(tbl))):
            hdr = [_nh(c) for c in tbl[ri]]
            # "unit" dropped: Upstox truncates "Brokerage per unit (Rs.)" -> "brokerage per"
            bc = next((i for i, h in enumerate(hdr) if "brokerage" in h and "per" in h and "after" not in h), None)
            s = next((i for i, h in enumerate(hdr) if any(x in h for x in
                      ("security", "symbol", "isin", "description", "scrip", "contract"))), None)
            bs = next((i for i, h in enumerate(hdr) if ("buy" in h and "sell" in h) or "b/s" in h), None)
            if bc is not None and (s is not None or bs is not None):   # blank contract header -> contract is col 0
                hdr_i, scol, bscol, bcol = ri, (s if s is not None else 0), bs, bc; break
        if hdr_i is None: continue
        for row in tbl[hdr_i + 1:]:
            if scol >= len(row) or bcol >= len(row): continue
            if not any((c or "").strip() for c in row): continue   # phantom blank row
            if any("*net*" in _nh(c) for c in row): continue       # *NET* subtotal - not a contract-side
            sym, isin = split_isin((row[scol] or ""), "")
            side = None
            if bscol is not None and bscol < len(row):
                bsv = (row[bscol] or "").strip().upper()
                if bsv.startswith("B") and not bsv.startswith("BF"): side = "buy"
                elif bsv.startswith("S"): side = "sell"
            if bscol is not None and side is None: continue        # blank-side row (*NET*) - skip
            v = pnum(row[bcol])
            if v is None: continue
            tgt = {"buy": buy, "sell": sell}.get(side, anyb)
            for k in (isin, sym, _normkey(sym)):
                if k: tgt[k] = v; anyb.setdefault(k, v)
    return {"buy": buy, "sell": sell, "any": anyb}

def backfill_brokerage(fills, bpu):
    for f in fills:
        if f.get("brokerage") not in (None, 0, 0.0):
            continue
        side = (f.get("side") or "").upper()
        pool = bpu["buy"] if side == "BUY" else bpu["sell"] if side == "SELL" else {}
        qty = f.get("qty")
        for d in (pool, bpu["any"]):
            hit = next((d.get(k) for k in (f.get("isin"), f.get("instrument"), _normkey(f.get("instrument") or ""))
                        if k and d.get(k) is not None), None)
            if hit is not None and qty:
                f["brokerage"] = round(-abs(hit) * abs(qty), 2)   # debit (negative), per-unit x qty
                break
    return fills

def apportion_segment_brokerage(fills, charges):
    """Case B: when a segment's per-fill brokerage isn't in the summary, split that segment's
    brokerage TOTAL (from the charges table's NCLCM/NCLFO column) across its still-empty fills by
    traded value. Runs AFTER the exact per-fill backfill, so it only fills gaps - and flags each
    derived value (brokerage_apportioned) so it's never silently presented as exact."""
    if not charges:
        return fills
    bcs = charges.get("by_clearing_segment", {})
    nt = charges.get("net_total", {})
    segs_present = {f.get("segment") for f in fills}
    for fill_seg in ("cash", "fno"):
        need = [f for f in fills if f.get("segment") == fill_seg and f.get("brokerage") in (None, 0, 0.0)]
        if not need:
            continue
        # this segment's brokerage charge (via the same label map as the per-segment checksum, so
        # Upstox 'FO-EQ'/'EQ-CASH' resolve, not just NCLFO/NCLCM).
        total = next((d.get("brokerage") for seg, d in bcs.items()
                      if _seg_to_fill(seg) == fill_seg and "brokerage" in d), None)
        if total is None and segs_present == {fill_seg}:
            # SINGLE-segment note whose charges are headerless (by_clearing_segment empty): the
            # note total IS this segment's brokerage. Absent brokerage row -> genuine 0 (delivery).
            total = nt.get("brokerage", 0.0)
        if total is None:
            continue
        if total == 0:
            for f in need: f["brokerage"] = 0.0        # genuine zero (e.g. delivery sells) - EXACT, not apportioned
            continue
        weights = [abs((f.get("qty") or 0) * (f.get("price") or 0)) or abs(f.get("qty") or 0) or 1 for f in need]
        wsum = sum(weights) or 1
        for f, w in zip(need, weights):
            f["brokerage"] = round(total * w / wsum, 2)
            f["brokerage_apportioned"] = True          # derived (split from the segment total), not read
    return fills

# per-fill WAP backfill - side-correct column, ISIN-keyed (multi-security safe), symbol + any fallback.
def backfill_wap(fills, waps):
    for f in fills:
        if f.get("wap") is not None:
            continue
        side = (f.get("side") or "").upper()
        pool = waps["buy"] if side == "BUY" else waps["sell"] if side == "SELL" else {}
        keys = (f.get("isin"), f.get("instrument"), _normkey(f.get("instrument") or ""))
        for d in (pool, waps["any"]):
            for k in keys:
                if k and d.get(k) is not None:
                    f["wap"] = d[k]; break
            if f.get("wap") is not None:
                break
    return fills

def build_ledger(path):
    pdf, entity = open_decrypted(path)
    if pdf is None:
        return None, None                          # no provided password decrypts this note
    with pdf:
        note_text = full_text(pdf)                  # captured once: broker + note-level metadata below
        broker = detect_broker(note_text)           # text-based; chosen BEFORE extraction (Upstox/old-Dhan need
        # Groww notes carry NO broker string in the extractable text (the brand is a
        # logo image only) — fall back to Groww's distinctive attachment name
        # "CONTRACT NOTE <clientcode>.pdf" (space-separated, digit-suffixed; a gmail
        # msg-id prefix is tolerated). Only when content detection came up 'unknown'.
        if broker == "unknown" and re.search(r"contract note \d", os.path.basename(path).lower()):
            broker = "groww"
        all_tables = extract_tables_for(pdf, broker, note_text)  # text-row strategy; line-based default otherwise)
    fills, tbl_counts = parse_trades_from_tables(all_tables, broker)
    source = "tables" if len(fills) >= 1 else "none"
    waps = wap_from_tables(all_tables)
    charges = parse_charges_from_tables(all_tables)
    if charges is None and broker == "astha":       # Astha lists charges as free text, not a ruled table
        charges = parse_charges_from_text(note_text)
    # Old-Dhan (2023-24 Moneylicious): the charges/obligation block is a NCL
    # CAPITAL/FUTURES/TOTAL(NET) grid pdfplumber mangles into an unusable table
    # (0 charge rows recognised -> parse_charges_from_tables None). Read it from
    # TEXT instead, same label_key vocabulary as every other adapter. GATED on
    # broker==dhan AND the old-Dhan signature AND charges-still-None, so it can
    # NEVER run on a note that already parsed a charges table (the 383 passing
    # new-Dhan notes are untouched by construction).
    if charges is None and broker == "dhan" and _OLD_DHAN_RE.search(note_text or ""):
        charges = parse_charges_from_text(note_text, old_dhan=True)   # TVS->gst_base, Other Tax->other_levy (both handled in the text parser)
    # #2: Fyers split-net-amount — the charges table parsed but net_amount lives in a
    # separate orphaned table; recover it so the checksum can run. GATED: only when a
    # charges table exists AND net_amount is missing, so the 207 passing fyers notes
    # (net_amount already present) are inert by construction. This only POPULATES the
    # field — the checksum still gates, so a note that doesn't reconcile still refuses.
    if broker == "fyers" and charges and charges["net_total"].get("net_amount") is None:
        na = orphan_net_amount(all_tables)
        if na is not None:
            charges["net_total"]["net_amount"] = na
    if broker == "upstox" and charges:              # Trap 4: Upstox charges table is CLIENT-perspective
        # ((+) payable / (-) receivable) - INVERTED vs our cashflow convention. Flip into ours so a
        # charge/payable is negative and a receivable is positive. Obligation still comes from SIGNED fills.
        charges["net_total"] = {k: -v for k, v in charges["net_total"].items()}
        charges["by_clearing_segment"] = {s: {k: -v for k, v in d.items()}
                                          for s, d in charges["by_clearing_segment"].items()}
    all_isins = {ISIN_RE.search(c).group(0) for t in all_tables for r in (t or []) for c in r
                 if c and ISIN_RE.search(c)}
    backfill_isin(fills, isin_map_from_tables(all_tables), all_isins)   # equity fills get ISIN -> 'cash'
    backfill_wap(fills, waps)                       # per-fill WAP from the summary (ISIN-keyed)
    bpu = brokerage_pu_from_tables(all_tables)            # F&O row-per-side per-unit brokerage
    blk_b = block_brokerage_from_tables(all_tables)       # equity Buy/Sell-block per-share brokerage
    for sk in ("buy", "sell", "any"):
        bpu[sk] = {**blk_b[sk], **bpu[sk]}                # row-per-side wins; block supplies equity keys
    backfill_brokerage(fills, bpu)                        # per-unit/share brokerage x qty
    seg_hint = note_segment_hint(all_tables) or charge_segment_hint(charges)   # tag 'unknown' fills
    for f in fills:
        f["segment"] = infer_segment(f)             # cash (has ISIN) / fno (derivative) / unknown
        if f["segment"] == "unknown" and seg_hint:
            f["segment"] = seg_hint                 # e.g. equity fill missing ISIN -> 'cash' via clearing
        f["account"] = entity                       # TAG at ingestion - never an untagged pool
        f["tax_entity"] = entity                    # tax entity follows the fill (hard filter)
    apportion_segment_brokerage(fills, charges)     # Case B: split a segment's brokerage TOTAL across
                                                    # its fills when per-fill brokerage isn't in the summary
    nt = charges["net_total"] if charges else None
    ok, resid = checksum(nt, fills)                 # obligation = pay-in (Zerodha) or sum-of-fills (Fyers)
    gst_ok, gst_detail = gst_check(nt)
    ledger = {
        "broker": broker, "account": entity, "tax_entity": entity,
        "contract_note_no": contract_note_no(note_text),   # KV key (from content, not the account-coded filename)
        "trade_date": trade_date(note_text),               # ISO YYYY-MM-DD - the (broker, date) join key
        "note_file": os.path.basename(path), "trade_source": source,
        "table_counts": tbl_counts,                 # fills come ONLY from detail_tables (de-dup proof)
        "has_fno": note_has_fno(fills, charges),    # gated by NOTE CONTENT, not account
        "charges": charges,                         # by_clearing_segment + net_total
        "unmapped_charge_labels": (charges or {}).get("unmapped_labels", []),
        "checksum": {"pass": ok, "residual": resid},
        "per_segment_checksum": per_segment_checksum(charges, fills),   # combined notes: each segment closes
        "gst_attribution": {"pass": gst_ok, "detail": gst_detail},
        "fills": fills,
    }
    return ledger, entity

# ---------- masking for stdout ----------
def masked_summary(ledger):
    L = []
    fills = ledger["fills"]
    buys = sum(1 for f in fills if f.get("side") == "BUY")
    sells = sum(1 for f in fills if f.get("side") == "SELL")
    L.append(f"broker: {ledger.get('broker')} | account (entity tag): {ledger.get('account')} | tax_entity: {ledger.get('tax_entity')} | has_fno: {ledger.get('has_fno')}")
    um = ledger.get("unmapped_charge_labels") or []
    if um:
        L.append(f"!! UNMAPPED charge labels (have values, no key - adapter gap): {um}")
    tc = ledger.get("table_counts", {})
    L.append(f"tables: {tc.get('detail_tables','?')} detail (fill source) + {tc.get('summary_tables','?')} summary (WAP-only, NOT counted as fills)")
    L.append(f"trade_source: {ledger['trade_source']}")
    L.append(f"fills extracted: {len(fills)}  (BUY {buys} / SELL {sells})")

    fields = ("instrument","isin","side","qty","price","net_total","wap","brokerage","trade_time")
    cash = [f for f in fills if f.get("segment") == "cash"]
    def cov(k):
        pool = cash if k == "isin" else fills        # ISIN expected only for cash (F&O has none)
        pop = sum(1 for f in pool if f.get(k) not in (None, ""))
        return pop, len(pool)
    seg = {}
    for f in fills: seg[f.get("segment", "?")] = seg.get(f.get("segment", "?"), 0) + 1
    L.append(f"segments: {seg}")
    L.append("fill field coverage (populated / applicable):")
    L.append("  " + " | ".join(f"{k} {cov(k)[0]}/{cov(k)[1]}" for k in fields))
    missing = [k for k in fields if cov(k)[0] < cov(k)[1]]
    L.append(f"fields not fully populated: {missing or '(none)'}  (isin scoped to cash fills)")
    appn = sum(1 for f in fills if f.get("brokerage_apportioned"))
    if appn:
        L.append(f"  note: {appn} fill(s) have APPORTIONED brokerage (split from segment total, derived not read)")

    ch = ledger.get("charges")
    L.append("\ncharges (structural table; KEYS + zero-flags only, amounts redacted):")
    if not ch:
        L.append("  (charges-summary table NOT found - run --layout to locate it)")
    else:
        nt = ch["net_total"]
        present = sorted(k for k in nt.keys())
        zeros = sorted(k for k, v in nt.items() if v in (0, 0.0))
        L.append(f"  NET TOTAL keys present: {present}")
        L.append(f"  keys == 0 (blank cells, not fabricated): {zeros}")
        gst = {k: ("0" if nt.get(k, 0) in (0, 0.0) else "non-zero") for k in ("igst","cgst","sgst")}
        L.append(f"  GST split -> {gst}   (expect exactly one of igst / (cgst&sgst) non-zero)")
        seg = sorted(ch["by_clearing_segment"].keys())
        L.append(f"  clearing segments keyed: {seg or '(none)'}")

    cs = ledger["checksum"]
    verdict = "PASS" if cs["pass"] else ("FAIL" if cs["pass"] is False else "N/A (pay_in/net_amount not found)")
    L.append("\nCHECKSUM 1 (total)  net_amount == obligation + sum(charges):")
    L.append(f"  {verdict}" + (f"   residual delta = {cs['residual']}" if cs["residual"] is not None else ""))
    if cs["pass"] is False:                        # localize a FAIL: which reconciliation component is off
        nt = (ledger.get("charges") or {}).get("net_total", {})
        obl = sum((f.get("net_total") or 0.0) for f in fills)
        csum = sum(nt.get(k, 0.0) for k in CHARGE_KEYS)
        L.append(f"  components (reconciliation aggregates, not holdings): "
                 f"obligation(sum fills)={round(obl,2)} | charge_sum={round(csum,2)} | net_amount={nt.get('net_amount')}")

    ps = ledger.get("per_segment_checksum", {})
    if ps:
        L.append("CHECKSUM 1b (per-segment)  each clearing segment closes (combined notes):")
        for seg, r in ps.items():
            L.append(f"  {seg}: {'PASS' if r['pass'] else 'FAIL'}   residual = {r['residual']}")

    gs = ledger.get("gst_attribution", {})
    gv = "PASS" if gs.get("pass") else ("FAIL" if gs.get("pass") is False else "N/A")
    L.append("CHECKSUM 2 (attribution)  exactly one of igst / (cgst+sgst) non-zero when GST-base>0:")
    L.append(f"  {gv}   ({gs.get('detail')})")
    return "\n".join(L)

def mask_layout(text):
    out = []
    for line in text.splitlines():
        x = re.sub(r"\d", "#", line)
        x = ISIN_RE.sub("<ISIN>", x.replace("#", "0"))  # ISIN over masked digits; revert below
        x = re.sub(r"0", "#", x)
        x = re.sub(r"\b[A-Z][A-Z&\-]{3,}\b", "<SYM>", x)
        out.append(x)
    return "\n".join(out)

# PII-safe table-structure dump: shows column HEADERS (standard names) + the charges table's
# row LABELS (standard charge names) so the label/column mapping is debuggable; MASKS all data
# values, and masks row[0] (could be a symbol/order#) for non-charges tables.
PAN_RE = re.compile(r"\b[A-Z]{5}\d{4}[A-Z]\b")
_META_RE = re.compile(r"pan of client|ucc of client|\bclient\b|trading code|contract note no|"
                      r"gst tax invoice|state code|\b\d{6}\b", re.I)

def redact(s):
    """PII guard for any stdout: PAN-pattern -> <PAN>; a multi-line client/metadata blob (name,
    address, client-PAN, UCC) -> collapsed. Notes hide PII in unpredictable cells - redact at
    the output boundary, always. Keeps real column labels (incl. the long WAP explanation)."""
    s = "" if s is None else str(s)
    had_pan = bool(PAN_RE.search(s))
    s = PAN_RE.sub("<PAN>", s)
    if "\n" in s and len(s) > 60 and (had_pan or _META_RE.search(s)):
        return "<META/CLIENT-BLOCK redacted>"
    return s

def debug_dump(tables):
    def cls(c):
        s = "" if c is None else str(c).strip()
        if s == "": return "<blank>"
        if PAN_RE.search(s): return "<PAN>"
        return "<amt>" if re.search(r"\d", s) else "<txt>"
    for ti, tbl in enumerate(tables):
        if not tbl: continue
        hdr = [(c or "").strip() for c in tbl[0]]
        labels = " ".join((r[0] or "").lower() for r in tbl if r)
        is_charges = "net amount" in labels and ("transaction tax" in labels or "stamp" in labels)
        is_trades = find_detail_header_row(tbl) is not None    # scans rows (header may not be row 0)
        is_summary = (not is_trades) and any(("wap" in (h or "").lower() or "weighted" in (h or "").lower()) for h in hdr)
        kind = "CHARGES" if is_charges else "TRADES" if is_trades else "SUMMARY" if is_summary else "?"
        print(f"\n[table {ti}] kind={kind} cols={len(hdr)} rows={len(tbl)}")
        print(f"  header: {[redact(c) for c in hdr]}")   # column labels - PII redacted
        for row in tbl[1:]:
            if is_charges:
                lbl = redact((row[0] or "")[:70])       # charge label - PII redacted
                print(f"    label={lbl!r} | " + " | ".join(cls(c) for c in row[1:]))
            else:
                print(f"    " + " | ".join(cls(c) for c in row))   # all cells masked (may hold symbols)

# Join diagnostic: prints the normalized (contract | side) keys from the SUMMARY WAP
# table and from the DETAIL fills, + whether each fill finds a WAP. Contract symbols + side are
# public instrument identifiers (not PII, per the spec); WAP and rupee amounts are NOT printed.
def wapkeys_report(path):
    # Reflect the REAL pipeline: build_ledger runs ISIN/WAP backfill + segment tagging, so use its
    # FINAL fills (not a stripped re-parse) - else this diagnostic shows pre-backfill state and lies.
    ledger, _ = build_ledger(path)
    if ledger is None:
        print("no set CN_PW_* env var decrypts this note."); return
    fills = ledger["fills"]
    pdf, _ = open_decrypted(path)
    with pdf:
        waps = wap_from_tables((lambda _t: extract_tables_for(pdf, detect_broker(_t), _t))(full_text(pdf)))
    print("=== SUMMARY WAP keys (contract/ISIN | side) [values omitted] ===")
    shown = False
    for side in ("buy", "sell"):
        for k in sorted(waps[side]):
            if k == _normkey(k) or ISIN_RE.fullmatch(k):   # normalized contract OR ISIN key (skip raw dups)
                print(f"  {k} | {side}"); shown = True
    if not shown:
        print("  (none - the WAP summary was not read)")
    print("=== DETAIL fills (join key | side | segment) -> WAP matched? ===")
    miss = 0
    for f in fills:
        key = f.get("isin") or _normkey(f.get("instrument") or "")   # backfill_wap tries ISIN FIRST
        matched = f.get("wap") is not None
        miss += 0 if matched else 1
        print(f"  {key} | {(f.get('side') or '').lower()} | {f.get('segment')} -> {'MATCH' if matched else 'NO MATCH'}")
    print(f"\nfills missing WAP: {miss}/{len(fills)}  (join key shows ISIN when the fill carries one)")

def lenses_report():
    """Read all tagged per-note ledgers in out/ and show BOTH lenses (masked: counts only)."""
    fills = []
    for fp in sorted(glob.glob(os.path.join(OUT, "ledger_*.json"))):
        try:
            fills.extend(json.load(open(fp, encoding="utf-8")).get("fills", []))
        except Exception:
            pass
    if not fills:
        print("no tagged ledgers in out/ (run the parser on notes first)."); return
    w, t = wealth_lens(fills), tax_lens(fills, "self")
    self_fno = sum(1 for f in fills if f.get("tax_entity") == "self" and f.get("segment") == "fno")
    other = [f for f in fills if f.get("tax_entity") != "self"]
    sep_ok = (t["fills"] == len(fills) - len(other)) and (t["excluded_other_entity_fills"] == len(other))
    print("=== WEALTH lens (combined - both accounts are my money) ===")
    print(f"  total fills: {w['total_fills']}  |  by account: {w['by_account']}")
    print("=== TAX lens (tax_entity == self; other entities INVISIBLE) ===")
    print(f"  self fills: {t['fills']}  |  other-entity fills excluded: {t['excluded_other_entity_fills']}")
    print(f"  self F&O fills (toward MY audit threshold only): {self_fno}")
    print(f"  SEPARATION assertion (other entities excluded from my tax lens): {'PASS' if sep_ok else 'FAIL'}")
    print("  (turnover/realized amounts live in out/*.json - masked here)")

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("--")]
    flags = {a for a in sys.argv[1:] if a.startswith("--")}
    os.makedirs(OUT, exist_ok=True)

    if "--lenses" in flags:                          # no note/password - reads tagged ledgers in out/
        lenses_report(); return

    path = args[0] if args else (sorted(glob.glob(os.path.join(HERE, "samples", "*.pdf"))) or [None])[0]
    if not path or not os.path.exists(path):
        print("usage: export CN_PW_SELF='<pw>'  then  python engine.py <pdf> [--debug|--layout|--lenses]"); sys.exit(1)
    if not any(k.upper().startswith("CN_PW") and v for k, v in os.environ.items()):
        print("set a decrypt password as an env var (set ONCE, never inline - inline leaks to shell")
        print("history / the process list; never a file - a gitignored file is still plaintext at rest).")
        print("Recognised (any CN_PW_* is tried; whichever opens the note wins):")
        print("  CN_PW_SELF / CN_PW_MOM / CN_PW_UPSTOX / CN_PW_DHAN / CN_PW_FYERS")
        print("e.g.:  export CN_PW_UPSTOX='<pw>'   then   python engine.py <pdf>"); sys.exit(2)

    if "--wapkeys" in flags:                         # join diagnostic (contract|side keys, no amounts)
        wapkeys_report(path); return

    if "--debug" in flags or "--layout" in flags:
        pdf, entity = open_decrypted(path)
        if pdf is None:
            print("no set CN_PW_* env var decrypts this note (check the PAN/scheme for this broker)."); sys.exit(2)
        with pdf:
            if "--debug" in flags:
                debug_dump((lambda _t: extract_tables_for(pdf, detect_broker(_t), _t))(full_text(pdf)))   # broker-aware rows
            else:
                ml = mask_layout(full_text(pdf))
                open(os.path.join(OUT, "layout.masked.txt"), "w", encoding="utf-8").write(ml)
                print(ml[:6000]); print(f"\n[masked layout -> {os.path.join(OUT,'layout.masked.txt')}]")
        return

    ledger, entity = build_ledger(path)
    if ledger is None:
        print("no set CN_PW_* env var decrypts this note (check the PAN/scheme for this broker)."); sys.exit(2)
    m = re.search(r"\d{2}-\d{2}-\d{4}|\d{4}-\d{2}-\d{2}", os.path.basename(path))
    tag = f"{entity}_{m.group(0) if m else 'note'}"        # entity + date - NO account code in the name
    out_path = os.path.join(OUT, f"ledger_{tag}.json")
    json.dump(ledger, open(out_path, "w", encoding="utf-8"), indent=2, ensure_ascii=False)
    print(masked_summary(ledger))
    print(f"\n[REAL tagged ledger -> {out_path} (gitignored). STDOUT masked. Run --lenses for the combined/tax view.]")

if __name__ == "__main__":
    main()
