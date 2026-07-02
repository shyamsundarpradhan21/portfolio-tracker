#!/usr/bin/env python3
"""Synthetic regression tests for the cas-parser ENGINE — fake data only, no PII,
no PDF, no password (mirrors contract-parser/test_engine.py discipline).
Validates: refuse-on-fail gates (close vs close_calculated reconciliation, missing
folios/period), the naturalKey (period + folio-set hash, order-independent),
PII redaction (name/PAN/folio numbers never survive), and Decimal/date JSON
coercion. The real PDF path is validated by the user running run.py."""
import datetime as dt
import json
from decimal import Decimal

import engine as E

ok = 0
bad = 0


def check(name, cond, got=None):
    global ok, bad
    if cond:
        ok += 1
        print(f"  ok  {name}")
    else:
        bad += 1
        print(f"  XX  {name}  got={got!r}")


def synthetic_cas(close=Decimal("100.000"), calc=Decimal("100.000"), folios=None):
    """A minimal casparser-dict-shaped CAS with obviously-fake PII."""
    if folios is None:
        folios = [{
            "folio": "12345678 / 99",
            "amc": "Fake AMC",
            "PAN": "ABCDE1234F",
            "KYC": "OK",
            "PANKYC": "OK",
            "schemes": [{
                "scheme": "Fake Flexi Cap Fund - Direct Growth",
                "advisor": "DIRECT",
                "rta_code": "FK01",
                "rta": "CAMS",
                "type": "EQUITY",
                "isin": "INF000000000",
                "amfi": "100001",
                "nominees": ["FAKE NOMINEE"],
                "open": Decimal("50.000"),
                "close": close,
                "close_calculated": calc,
                "valuation": {"date": dt.date(2026, 6, 30), "nav": Decimal("101.5"),
                              "cost": Decimal("9000"), "value": Decimal("10150")},
                "transactions": [{
                    "date": dt.date(2026, 6, 10), "description": "SIP Purchase",
                    "amount": Decimal("5000"), "units": Decimal("50.000"),
                    "nav": Decimal("100.0"), "balance": Decimal("100.000"),
                    "type": "PURCHASE_SIP", "dividend_rate": None, "gift_folio": None,
                }],
            }],
        }]
    return {
        "statement_period": {"from": "2026-06-01", "to": "2026-06-30"},
        "folios": folios,
        "investor_info": {"name": "FAKE NAME", "email": "fake@example.com",
                          "address": "12 Fake Street", "mobile": "9999999999"},
        "cas_type": "DETAILED",
        "file_type": "CAMS",
        "parse_warnings": [],
    }


# 1) coercions ---------------------------------------------------------------
check("as_date ISO", E.as_date("2026-06-30") == dt.date(2026, 6, 30), E.as_date("2026-06-30"))
check("as_date DD-Mon-YYYY", E.as_date("30-Jun-2026") == dt.date(2026, 6, 30), E.as_date("30-Jun-2026"))
check("as_date junk -> None", E.as_date("not a date") is None)
check("jsonable Decimal -> float", E.jsonable(Decimal("1.5")) == 1.5)
check("jsonable date -> iso", E.jsonable(dt.date(2026, 6, 30)) == "2026-06-30")
check("jsonable nested", E.jsonable({"a": [Decimal("2")]}) == {"a": [2.0]})

# 2) validate: the refuse-on-fail gates --------------------------------------
v = E.validate(synthetic_cas())
check("valid CAS passes", v["pass"] is True, v)

v = E.validate(synthetic_cas(close=Decimal("100.000"), calc=Decimal("99.900")))
check("close vs close_calculated mismatch FAILS", v["pass"] is False, v)
check("mismatch names the scheme", any("Fake Flexi" in e for e in v["errors"]), v["errors"])

v = E.validate(synthetic_cas(close=Decimal("100.000"), calc=Decimal("100.002")))
check("sub-tolerance rounding diff passes", v["pass"] is True, v)

v = E.validate({**synthetic_cas(), "folios": []})
check("no folios FAILS", v["pass"] is False, v)

# CDSL/NSDL DEPOSITORY CAS (demat holdings) — recognised but out of scope for the MF ledger.
# The decrypt-probe still claims it (casparser parsed a structure); validate refuses it with a
# CLEAR out-of-scope reason, not the bug-sounding "no folios parsed" (real file: SEP2025 CDSL CAS).
depo = {"statement_period": {"from": "2025-09-01", "to": "2025-09-30"}, "folios": [],
        "cas_type": None, "file_type": "CDSL", "parse_warnings": []}
v = E.validate(depo)
check("CDSL depository CAS FAILS", v["pass"] is False, v)
check("CDSL reason is explicit out-of-scope, not 'no folios parsed'",
      any("depository CAS" in e and "out of scope" in e for e in v["errors"]), v["errors"])
check("CDSL reason names the MF-CAS distinction", any("CAMS/KFintech MF CAS" in e for e in v["errors"]), v["errors"])

cas_np = synthetic_cas()
cas_np["statement_period"] = {"from": "garbage", "to": None}
v = E.validate(cas_np)
check("unparseable period FAILS", v["pass"] is False, v)

cas_rev = synthetic_cas()
cas_rev["statement_period"] = {"from": "2026-07-01", "to": "2026-06-01"}
v = E.validate(cas_rev)
check("reversed period FAILS", v["pass"] is False, v)

cas_noclose = synthetic_cas()
cas_noclose["folios"][0]["schemes"][0]["close"] = None
v = E.validate(cas_noclose)
check("missing printed close is a WARNING not a failure", v["pass"] is True and v["warnings"], v)

# 3) natural key --------------------------------------------------------------
k1 = E.natural_key(synthetic_cas())
check("key carries the period", k1 and k1.startswith("2026-06-01_2026-06-30-"), k1)

two = synthetic_cas()
two["folios"] = [dict(two["folios"][0], folio="AAA"), dict(two["folios"][0], folio="BBB")]
two_rev = synthetic_cas()
two_rev["folios"] = [dict(two_rev["folios"][0], folio="BBB"), dict(two_rev["folios"][0], folio="AAA")]
check("folio-set hash is order-independent", E.natural_key(two) == E.natural_key(two_rev),
      (E.natural_key(two), E.natural_key(two_rev)))

one = synthetic_cas()
check("different folio set -> different key", E.natural_key(one) != E.natural_key(two))
check("unparseable period -> no key", E.natural_key(cas_np) is None, E.natural_key(cas_np))

# 4) redaction — PII must NOT survive -----------------------------------------
red = E.redact(synthetic_cas())
blob = json.dumps(red)
check("investor name gone", "FAKE NAME" not in blob)
check("email gone", "fake@example.com" not in blob)
check("address gone", "Fake Street" not in blob)
check("mobile gone", "9999999999" not in blob)
check("PAN gone", "ABCDE1234F" not in blob)
check("nominee gone", "FAKE NOMINEE" not in blob)
check("raw folio number gone", "12345678" not in blob, blob[:200])
check("folio replaced by stable hash", red["folios"][0]["folio"] == E.folio_hash("12345678 / 99"))
check("scheme name kept", "Fake Flexi Cap Fund" in blob)
check("isin kept", red["folios"][0]["schemes"][0]["isin"] == "INF000000000")
check("valuation kept + jsonable", red["folios"][0]["schemes"][0]["valuation"]["value"] == 10150.0)
check("transaction rows kept", len(red["folios"][0]["schemes"][0]["transactions"]) == 1)
check("txn units jsonable", red["folios"][0]["schemes"][0]["transactions"][0]["units"] == 50.0)
check("gift_folio dropped from txn", "gift_folio" not in red["folios"][0]["schemes"][0]["transactions"][0])
check("period redacted to ISO strings", red["statement_period"] == {"from": "2026-06-01", "to": "2026-06-30"})

# 5) summary line is PII-free --------------------------------------------------
line = E.summary_line(red)
check("summary has period + counts", "2026-06-01..2026-06-30" in line and "1 folios" in line, line)
check("summary has no name", "FAKE" not in line.upper() or "FAKE AMC" not in line, line)

# 6) folio_hash stability -------------------------------------------------------
check("folio_hash deterministic", E.folio_hash("X1") == E.folio_hash("X1"))
check("folio_hash trims", E.folio_hash(" X1 ") == E.folio_hash("X1"))

print(f"\n{ok} ok, {bad} failed")
raise SystemExit(1 if bad else 0)
