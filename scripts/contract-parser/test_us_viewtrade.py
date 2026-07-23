#!/usr/bin/env python3
"""Synthetic proof of the ViewTrade US adapter — fake tickers/amounts, no PII."""
import sys
import us_viewtrade as U
ok = 0; bad = 0
def check(n, c, got=None):
    global ok, bad
    if c: ok += 1; print(f"  ok  {n}")
    else: bad += 1; print(f"  XX  {n}  got={got!r}")

note = "\n".join([
    "TRADE CONFIRMATION", "CUM Tax Invoice", "US Stocks Segment",
    "22/07/2026 23/07/2026 FAKE FAKE CO ONE INC B 0.1 100.00 10.00 0.02 0.01 0.01 0.01 0.00 10.05",
    "WRAPPED NAME ABOVE",                                     # name wraps above the data line
    "22/07/2026 23/07/2026 WRAP B 0.2 50.00 10.00 0.02 0.01 0.01 0.01 0.00 10.05",
    "INC COM",                                                # ... and below
    "23/07/2026 24/07/2026 SELLR SELL CO INC S 0.5 40.00 20.00 0.02 0.01 0.01 0.01 0.00 19.95",
    "Account Type: Cash",
])
us = U.parse_us_note(note)
check("detects US note", U.is_us_note(note) is True)
check("plain text is NOT a US note", U.parse_us_note("random contract note text") is None)
check("3 trades parsed (incl the name-wrapped row)", us and len(us["trades"]) == 3, us and len(us["trades"]))
syms = [t["sym"] for t in us["trades"]]
check("symbols FAKE/WRAP/SELLR", syms == ["FAKE", "WRAP", "SELLR"], syms)
check("wrapped-name row: symbol still captured, name empty", us["trades"][1]["name"] is None, us["trades"][1]["name"])
check("BUY cost is a negative cash flow (-10.05)", us["trades"][0]["costUsd"] == -10.05, us["trades"][0]["costUsd"])
check("SELL cost is a positive cash flow (+19.95)", us["trades"][2]["costUsd"] == 19.95, us["trades"][2]["costUsd"])
check("SELL side + fees deducted (net-after 19.95)", us["trades"][2]["side"] == "SELL" and us["trades"][2]["netAfter"] == 19.95, us["trades"][2])
check("all rows reconcile (gross + levy)", us["reconciled"] is True, us["unreconciled"])
check("asOf = latest trade date", us["asOf"] == "2026-07-23", us["asOf"])
print(f"\n{ok} passed, {bad} failed")
sys.exit(1 if bad else 0)
