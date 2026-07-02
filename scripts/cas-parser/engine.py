#!/usr/bin/env python3
"""cas-parser engine — pure post-processing over casparser's parsed dict.

casparser (pinned in requirements.txt) does ALL the PDF work: decrypt, layout
parse, CAMS/KFintech format detection, transaction reconstruction. This module
adds the pipeline discipline on top, with NO I/O and NO casparser import so the
logic is fully regression-testable on synthetic dicts (test_engine.py):

  - validate()        refuse-on-fail gate: statement period parseable, folios and
                      schemes present, and every scheme's casparser-computed
                      close (close_calculated) reconciles with the statement's
                      printed close — the CAS analog of the contract-note checksum.
  - redact()          PII discipline: investor name/email/address/mobile DROPPED,
                      folio PAN/KYC flags DROPPED, raw folio numbers replaced by
                      a stable short hash (joinable, not quotable to an RTA).
  - natural_key()     statement period + folio-set hash (plan v2 §3: same period
                      re-downloaded for the same folio set = the same document).
  - jsonable()        Decimal/date → JSON-safe (casparser emits Decimals).
"""
import datetime as dt
import hashlib
from decimal import Decimal

# a scheme's printed close vs casparser's recomputed close may differ by unit
# rounding at 3-4dp; anything beyond this is a real reconciliation failure
UNITS_TOL = 0.005


# ── small coercions ───────────────────────────────────────────────────────────
def as_date(v):
    """date/datetime/ISO-ish string -> datetime.date, else None."""
    if isinstance(v, dt.datetime):
        return v.date()
    if isinstance(v, dt.date):
        return v
    if v is None:
        return None
    s = str(v).strip()
    for fmt in ("%Y-%m-%d", "%d-%b-%Y", "%d-%m-%Y", "%d/%m/%Y", "%d-%B-%Y"):
        try:
            return dt.datetime.strptime(s, fmt).date()
        except ValueError:
            pass
    return None


def as_float(v):
    if v is None or v == "":
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def jsonable(v):
    """Recursively convert casparser output (Decimals, dates) to JSON-safe."""
    if isinstance(v, Decimal):
        return float(v)
    if isinstance(v, (dt.datetime, dt.date)):
        return v.isoformat()
    if isinstance(v, dict):
        return {k: jsonable(x) for k, x in v.items()}
    if isinstance(v, (list, tuple)):
        return [jsonable(x) for x in v]
    return v


def folio_hash(folio_no):
    """Stable short hash of a folio number — joinable across statements without
    carrying the quotable-to-the-RTA identifier."""
    return hashlib.sha1(str(folio_no or "").strip().encode()).hexdigest()[:10]


# ── refuse-on-fail validation ────────────────────────────────────────────────
def validate(cas):
    """-> {"pass": bool, "errors": [...], "warnings": [...]}.
    Errors block the KV push (run.py REFUSES); warnings ride along in the payload."""
    errors, warnings = [], []
    sp = cas.get("statement_period") or {}
    d_from, d_to = as_date(sp.get("from") or sp.get("from_")), as_date(sp.get("to"))
    if not (d_from and d_to):
        errors.append("statement_period missing/unparseable")
    elif d_from > d_to:
        errors.append(f"statement_period reversed ({d_from} > {d_to})")

    folios = cas.get("folios") or []
    if not folios:
        # A CDSL/NSDL DEPOSITORY CAS (demat holdings/transaction statement) is a
        # different document from a CAMS/KFintech MUTUAL-FUND CAS — casparser
        # recognises it (file_type CDSL/NSDL, cas_type None) but it carries no MF
        # scheme folios. Out of scope for ledger:mf — say so explicitly instead of
        # the bug-sounding "no folios parsed" (the decrypt-probe still CLAIMED it,
        # so the classifier gap is closed; this is a clean, honest refusal).
        ft = str(cas.get("file_type") or "").upper()
        if ft in ("CDSL", "NSDL") and not cas.get("cas_type"):
            errors.append(f"{ft} depository CAS (demat holdings) — not a CAMS/KFintech MF CAS; out of scope for ledger:mf")
        else:
            errors.append("no folios parsed")
    schemes = [s for f in folios for s in (f.get("schemes") or [])]
    if folios and not schemes:
        errors.append("folios carry no schemes")

    for s in schemes:
        name = s.get("scheme") or "?"
        close, calc = as_float(s.get("close")), as_float(s.get("close_calculated"))
        if close is None:
            warnings.append(f"{name}: no printed close")
            continue
        if calc is None:
            warnings.append(f"{name}: casparser produced no close_calculated")
            continue
        if abs(close - calc) > UNITS_TOL:
            errors.append(f"{name}: close {close} != calculated {calc} (units don't reconcile)")

    for w in cas.get("parse_warnings") or []:
        warnings.append(str(w))
    return {"pass": not errors, "errors": errors, "warnings": warnings}


# ── natural key (plan §3: statement period + folio-set hash) ─────────────────
def natural_key(cas):
    sp = cas.get("statement_period") or {}
    d_from, d_to = as_date(sp.get("from") or sp.get("from_")), as_date(sp.get("to"))
    if not (d_from and d_to):
        return None
    folio_set = sorted(folio_hash(f.get("folio")) for f in cas.get("folios") or [])
    set_hash = hashlib.sha1("|".join(folio_set).encode()).hexdigest()[:8]
    return f"{d_from.isoformat()}_{d_to.isoformat()}-{set_hash}"


# ── PII redaction ─────────────────────────────────────────────────────────────
# DROPPED outright: investor_info (name/email/address/mobile), folio PAN/KYC
# flags, nominees, gift_folio. Folio numbers -> stable hash. Everything the
# dashboard/reconcile needs (schemes, ISIN/AMFI ids, units, NAVs, values,
# transaction rows) is kept.
def redact(cas):
    out = {
        "cas_type": cas.get("cas_type"),
        "file_type": cas.get("file_type"),
        "statement_period": {
            "from": (as_date((cas.get("statement_period") or {}).get("from")
                             or (cas.get("statement_period") or {}).get("from_")) or ""),
            "to": (as_date((cas.get("statement_period") or {}).get("to")) or ""),
        },
        "folios": [],
        "warnings": [str(w) for w in cas.get("parse_warnings") or []],
    }
    out["statement_period"] = {k: (v.isoformat() if isinstance(v, dt.date) else "")
                               for k, v in out["statement_period"].items()}
    for f in cas.get("folios") or []:
        rf = {"folio": folio_hash(f.get("folio")), "amc": f.get("amc"), "schemes": []}
        for s in f.get("schemes") or []:
            rs = {k: s.get(k) for k in
                  ("scheme", "isin", "amfi", "type", "open", "close", "close_calculated")}
            val = s.get("valuation") or {}
            rs["valuation"] = {k: val.get(k) for k in ("date", "nav", "cost", "value")}
            rs["transactions"] = [
                {k: t.get(k) for k in
                 ("date", "description", "amount", "units", "nav", "balance", "type", "dividend_rate")}
                for t in s.get("transactions") or []
            ]
            rf["schemes"].append(rs)
        out["folios"].append(rf)
    return jsonable(out)


# ── PII-free one-liner for run.py output ─────────────────────────────────────
def summary_line(redacted):
    period = redacted.get("statement_period") or {}
    schemes = [s for f in redacted.get("folios") or [] for s in f.get("schemes") or []]
    total = sum(as_float((s.get("valuation") or {}).get("value")) or 0 for s in schemes)
    return (f"{redacted.get('file_type') or '?'} {redacted.get('cas_type') or '?'} "
            f"{period.get('from')}..{period.get('to')} · "
            f"{len(redacted.get('folios') or [])} folios · {len(schemes)} schemes · "
            f"value {round(total)}")
