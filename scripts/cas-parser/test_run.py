#!/usr/bin/env python3
"""Regression tests for run.py's PIPELINE CONTRACT (fake data, no PDF, no PII):
1. crash-to-FAIL — an unhandled exception anywhere inside evaluate() must
   degrade to a porcelain FAIL row, never a traceback (P1: the daemon can only
   report 'no porcelain status' when run.py dies raw — hit live on the real CAS).
2. pydantic normalization — casparser returns CASData even with output='dict'
   (verified live on 1.2.1 and 0.8.1); normalize_cas must model_dump(mode='json')."""
import run as R

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


# 1) normalize_cas: pydantic-style objects → JSON-safe dict -------------------
class FakePydanticV2:
    def model_dump(self, mode=None):
        assert mode == "json", "mode='json' is required — engine compares JSON-safe primitives"
        return {"statement_period": {"from": "2026-06-01", "to": "2026-06-30"}, "folios": []}


class FakePydanticV1:
    def dict(self):
        return {"folios": [], "v1": True}


check("model_dump(mode='json') used on pydantic v2", R.normalize_cas(FakePydanticV2()) == {"statement_period": {"from": "2026-06-01", "to": "2026-06-30"}, "folios": []})
check(".dict() fallback on pydantic v1", R.normalize_cas(FakePydanticV1()) == {"folios": [], "v1": True})
check("plain dict passes through", R.normalize_cas({"a": 1}) == {"a": 1})

# 2) crash-to-FAIL: engine.validate raising must yield a FAIL row -------------
_orig_parse, _orig_validate = R.parse_with_passwords, R.engine.validate
try:
    R.parse_with_passwords = lambda path, pws: ({"folios": [{}]}, None)

    def _boom(cas):
        raise RuntimeError("synthetic engine crash")
    R.engine.validate = _boom

    st = R.evaluate("fake.pdf", ["pw"], dry=True, kv_url=None, kv_tok=None)
    check("evaluate survives an engine crash", isinstance(st, dict))
    check("crash degrades to FAIL", st["status"] == "FAIL", st)
    check("reason carries the exception", "RuntimeError" in st["reason"] and "synthetic engine crash" in st["reason"], st["reason"])

    # and a crash in natural_key (after validate passes) too
    R.engine.validate = lambda cas: {"pass": True, "errors": [], "warnings": []}
    _orig_key = R.engine.natural_key
    R.engine.natural_key = _boom
    st = R.evaluate("fake.pdf", ["pw"], dry=True, kv_url=None, kv_tok=None)
    check("natural_key crash also degrades to FAIL", st["status"] == "FAIL" and "RuntimeError" in st["reason"], st)
    R.engine.natural_key = _orig_key
finally:
    R.parse_with_passwords, R.engine.validate = _orig_parse, _orig_validate

print(f"\n{ok} ok, {bad} failed")
raise SystemExit(1 if bad else 0)
