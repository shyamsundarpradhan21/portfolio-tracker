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


# ══ CDSL/NSDL eCAS (depository consolidated statement) ═══════════════════════════
# The monthly auto-mailed eCAS is a DEPOSITORY holdings statement (equities, MF
# units, bonds per demat account), NOT a CAMS/KFintech MF transaction CAS.
# casparser returns an NSDLCASData object (model_dump → {accounts, ...}) rather
# than folios. It is a VALUATION snapshot (units + NAV + value); no cost basis /
# transactions. Target: KV ledger:demat:<key> — a THIRD reconciliation source
# for INDIAN/SWING/MF holdings, distinct from ledger:mf:*.
BALANCE_TOL = 1.0   # ₹ — account balance vs Σ holding values (rounding slack)


def is_depository(cas):
    """NSDL/CDSL eCAS? (file_type CDSL/NSDL — the MF CAS is CAMS/KFintech.)"""
    return str(cas.get("file_type") or "").upper() in ("CDSL", "NSDL")


def _holdings(acct):
    return (acct.get("equities") or []) + (acct.get("mutual_funds") or []) + (acct.get("bonds") or [])


def ecas_validate(cas):
    """Refuse-on-fail for the eCAS: period parseable, ≥1 account carrying holdings,
    and each account's printed balance reconciles with Σ of its holding values
    (the depository analog of the MF CAS's close-vs-close_calculated check)."""
    errors, warnings = [], []
    sp = cas.get("statement_period") or {}
    d_from, d_to = as_date(sp.get("from") or sp.get("from_")), as_date(sp.get("to"))
    if not (d_from and d_to):
        errors.append("statement_period missing/unparseable")
    elif d_from > d_to:
        errors.append(f"statement_period reversed ({d_from} > {d_to})")

    accounts = cas.get("accounts") or []
    if not accounts:
        errors.append("no demat/folio accounts parsed")
    total_holdings = sum(len(_holdings(a)) for a in accounts)
    if accounts and total_holdings == 0:
        errors.append("accounts carry no holdings (equities/MF/bonds)")

    for i, a in enumerate(accounts):
        bal = as_float(a.get("balance"))
        hv = sum(as_float(h.get("value")) or 0 for h in _holdings(a))
        if bal is None:
            warnings.append(f"account {i}: no printed balance")
            continue
        if abs(bal - hv) > BALANCE_TOL:
            errors.append(f"account {i}: balance {bal} != sum(values) {round(hv, 2)} (holdings don't reconcile)")
    return {"pass": not errors, "errors": errors, "warnings": warnings}


def ecas_natural_key(cas):
    """Statement period + demat-account-set hash (dp_id/client_id, hashed)."""
    sp = cas.get("statement_period") or {}
    d_from, d_to = as_date(sp.get("from") or sp.get("from_")), as_date(sp.get("to"))
    if not (d_from and d_to):
        return None
    acct_ids = sorted(folio_hash(f"{a.get('dp_id') or ''}:{a.get('client_id') or ''}")
                      for a in cas.get("accounts") or [])
    set_hash = hashlib.sha1("|".join(acct_ids).encode()).hexdigest()[:8]
    return f"{d_from.isoformat()}_{d_to.isoformat()}-demat-{set_hash}"


# DROPPED: investor_info (name/email/address/mobile), owners (name/PAN), raw
# dp_id/client_id (→ stable hash), folio numbers (→ hash). KEPT: per-holding
# isin/amfi/name/type/balance(units)/nav/value, account type + hashed id.
def ecas_redact(cas):
    sp = cas.get("statement_period") or {}
    out = {
        "file_type": cas.get("file_type"),
        "cas_type": "DEPOSITORY",
        "statement_period": {"from": (as_date(sp.get("from") or sp.get("from_")) or ""),
                             "to": (as_date(sp.get("to")) or "")},
        "accounts": [],
        "warnings": [str(w) for w in cas.get("parse_warnings") or []],
    }
    out["statement_period"] = {k: (v.isoformat() if isinstance(v, dt.date) else "")
                               for k, v in out["statement_period"].items()}

    def keep_eq(e):
        return {k: e.get(k) for k in ("name", "isin", "symbol", "exchange", "num_shares", "price", "value")}

    def keep_mf(m):
        return {k: m.get(k) for k in ("name", "isin", "amfi", "type", "balance", "nav", "value")}

    def keep_bond(b):
        return {k: b.get(k) for k in ("name", "isin", "num_bonds", "value", "face_value", "maturity_date")}

    for a in cas.get("accounts") or []:
        ra = {
            "id": folio_hash(f"{a.get('dp_id') or ''}:{a.get('client_id') or ''}"),
            "type": a.get("type"),
            "balance": a.get("balance"),
            "equities": [keep_eq(e) for e in a.get("equities") or []],
            "mutual_funds": [keep_mf(m) for m in a.get("mutual_funds") or []],
            "bonds": [keep_bond(b) for b in a.get("bonds") or []],
        }
        out["accounts"].append(ra)
    return jsonable(out)


def ecas_summary_line(redacted):
    period = redacted.get("statement_period") or {}
    accts = redacted.get("accounts") or []
    eq = sum(len(a.get("equities") or []) for a in accts)
    mf = sum(len(a.get("mutual_funds") or []) for a in accts)
    bo = sum(len(a.get("bonds") or []) for a in accts)
    total = sum(as_float(a.get("balance")) or 0 for a in accts)
    return (f"{redacted.get('file_type') or '?'} DEPOSITORY eCAS "
            f"{period.get('from')}..{period.get('to')} · {len(accts)} accounts · "
            f"{eq} equities / {mf} MF / {bo} bonds · value {round(total)}")
