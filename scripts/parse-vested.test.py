#!/usr/bin/env python3
"""Synthetic proof of the CUMULATIVE Vested corpus logic (collect/_reduce) — fake data
only, no PII. Validates: single-file parse == baseline; overlapping exports dedupe (no
double-count); non-overlapping months union; a genuinely repeated row within one file is
kept (multiplicity); cash EOD = newest-file-wins per shared date. Builds tiny xlsx via
openpyxl in a temp dir. No real export, no network."""
import os, sys, tempfile, shutil, importlib.util
import datetime as dt
import openpyxl

HERE = os.path.dirname(os.path.abspath(__file__))
spec = importlib.util.spec_from_file_location("parsevested", os.path.join(HERE, "parse-vested.py"))
pv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(pv)

ok = 0; bad = 0
def check(name, cond, got=None):
    global ok, bad
    if cond: ok += 1; print(f"  ok  {name}")
    else: bad += 1; print(f"  XX  {name}  got={got!r}")

# ── build a synthetic Vested export ───────────────────────────────────────────
# sheet row shapes parse() reads:
#   Trades          [date, time, name, ticker, action, orderType, qty, pps, cash, comm]
#   All Transactions[date, time, type, amount, balance, comment]
#   Income          [date, time, action, ticker, amount]
#   Transfers       [date, time, action, amount]
HDR = {
    "Trades": ["Date", "Time", "Name", "Ticker", "Action", "OrderType", "Qty", "PPS", "Cash", "Comm"],
    "All Transactions": ["Date", "Time", "Type", "Amount", "Balance", "Comment"],
    "Income": ["Date", "Time", "Action", "Ticker", "Amount"],
    "Transfers": ["Date", "Time", "Action", "Amount"],
}
def D(s): return dt.datetime.strptime(s, "%Y-%m-%d")

def make_xlsx(path, trades=None, alltx=None, income=None, transfers=None):
    wb = openpyxl.Workbook()
    wb.remove(wb.active)
    for sh, rows in (("Trades", trades), ("All Transactions", alltx),
                     ("Income", income), ("Transfers", transfers)):
        ws = wb.create_sheet(sh)
        ws.append(HDR[sh])
        for r in (rows or []):
            ws.append(list(r))
    wb.save(path)

TMP = tempfile.mkdtemp(prefix="pvtest_")
try:
    HELD = {"AAPL", "GOOG"}

    # month 1 (June): AAPL buy, a GOOG buy, a dividend, a deposit, EOD cash rows
    jun_trades = [
        (D("2026-06-10"), "10:00:00 AM", "Apple", "AAPL", "Buy",  "MKT", 0.5, 200.0, 100.0, 0.0),
        (D("2026-06-20"), "11:00:00 AM", "Alpha", "GOOG", "Buy",  "MKT", 0.2, 150.0,  30.0, 0.0),
    ]
    jun_alltx = [
        (D("2026-06-10"), "10:00:00 AM", "Trade", -100.0, 900.0, ""),
        (D("2026-06-20"), "11:00:00 AM", "Trade",  -30.0, 870.0, ""),
    ]
    jun_income = [(D("2026-06-15"), "09:00:00 AM", "Dividend", "AAPL", 1.20)]
    jun_transfers = [(D("2026-06-01"), "09:00:00 AM", "Deposit", 1000.0)]

    # month 2 (July): GOOG buy, MSFT (not held -> other), tax row
    jul_trades = [
        (D("2026-07-05"), "10:00:00 AM", "Alpha", "GOOG", "Buy", "MKT", 0.1, 160.0, 16.0, 0.0),
        (D("2026-07-06"), "10:00:00 AM", "Micro", "MSFT", "Buy", "MKT", 0.1, 400.0, 40.0, 0.0),
    ]
    jul_alltx = [(D("2026-07-05"), "10:00:00 AM", "Trade", -16.0, 854.0, "")]
    jul_income = [(D("2026-07-10"), "09:00:00 AM", "Tax", None, -0.18)]
    jul_transfers = []

    # ── (a) single-file baseline ──────────────────────────────────────────────
    fa = os.path.join(TMP, "a_2026-06.xlsx")
    make_xlsx(fa, trades=jun_trades, alltx=jun_alltx, income=jun_income, transfers=jun_transfers)
    base = pv._reduce(pv.collect([fa]), HELD)
    check("single: AAPL flow = -100 debit? no — Buy is +cash", base["flows"].get("AAPL") == [["2026-06-10", 100.0]], base["flows"].get("AAPL"))
    check("single: GOOG flow captured", base["flows"].get("GOOG") == [["2026-06-20", 30.0]], base["flows"].get("GOOG"))
    check("single: cash EOD days", base["cash"] == {"2026-06-10": 900.0, "2026-06-20": 870.0}, base["cash"])
    check("single: dividend gross 1.20", base["dividends"]["grossAllTime"] == 1.20, base["dividends"]["grossAllTime"])
    check("single: cashflow deposit +1000", base["cashflows"] == [{"date": "2026-06-01", "invested": 1000.0}], base["cashflows"])
    check("single: asOf = latest activity", base["asOf"] == "2026-06-20", base["asOf"])

    # ── (b) overlapping re-export must NOT double-count ────────────────────────
    # file B = a re-download that ALSO contains June (identical rows) + July.
    fb = os.path.join(TMP, "b_2026-07.xlsx")
    make_xlsx(fb, trades=jun_trades + jul_trades, alltx=jun_alltx + jul_alltx,
              income=jun_income + jul_income, transfers=jun_transfers)
    both = pv._reduce(pv.collect([fa, fb]), HELD)
    check("overlap: AAPL still 100 (June counted ONCE, not 200)", both["flows"].get("AAPL") == [["2026-06-10", 100.0]], both["flows"].get("AAPL"))
    check("overlap: GOOG = June 30 + July 16 (two dates, no dup)", both["flows"].get("GOOG") == [["2026-06-20", 30.0], ["2026-07-05", 16.0]], both["flows"].get("GOOG"))
    check("overlap: MSFT (not held) -> other, once", both["other"] == [["2026-07-06", 40.0]], both["other"])
    check("overlap: deposit counted once (1000, not 2000)", both["cashflows"] == [{"date": "2026-06-01", "invested": 1000.0}], both["cashflows"])
    check("overlap: dividend gross still 1.20 (June div not doubled)", both["dividends"]["grossAllTime"] == 1.20, both["dividends"]["grossAllTime"])
    check("overlap: tax picked up from July (net = 1.20 - 0.18)", both["dividends"]["netAllTime"] == 1.02, both["dividends"]["netAllTime"])
    check("overlap: asOf advances to July", both["asOf"] == "2026-07-10", both["asOf"])

    # ── (c) two NON-overlapping months union ──────────────────────────────────
    fc = os.path.join(TMP, "c_2026-07only.xlsx")
    make_xlsx(fc, trades=jul_trades, alltx=jul_alltx, income=jul_income, transfers=[])
    union = pv._reduce(pv.collect([fa, fc]), HELD)
    check("union: GOOG has both months", union["flows"].get("GOOG") == [["2026-06-20", 30.0], ["2026-07-05", 16.0]], union["flows"].get("GOOG"))
    check("union: AAPL from June only", union["flows"].get("AAPL") == [["2026-06-10", 100.0]], union["flows"].get("AAPL"))

    # ── (d) a genuinely repeated identical row within ONE file is preserved ────
    fd = os.path.join(TMP, "d_dup.xlsx")
    dup = (D("2026-08-01"), "10:00:00 AM", "Apple", "AAPL", "Buy", "MKT", 0.1, 200.0, 20.0, 0.0)
    make_xlsx(fd, trades=[dup, dup])   # two identical real fills
    dd = pv._reduce(pv.collect([fd]), HELD)
    check("multiplicity: identical row twice in ONE file counts twice (20+20=40)", dd["flows"].get("AAPL") == [["2026-08-01", 40.0]], dd["flows"].get("AAPL"))
    # but the same dup file re-uploaded (overlap) still counts twice, not four times
    dd2 = pv._reduce(pv.collect([fd, fd]), HELD)
    check("multiplicity: re-uploading the dup file does NOT inflate to 80", dd2["flows"].get("AAPL") == [["2026-08-01", 40.0]], dd2["flows"].get("AAPL"))

    # ── (e) cash EOD = newest file wins a shared date ─────────────────────────
    fe1 = os.path.join(TMP, "e1_2026-06.xlsx")
    fe2 = os.path.join(TMP, "e2_2026-07.xlsx")   # sorts AFTER e1 => newer
    make_xlsx(fe1, alltx=[(D("2026-06-10"), "10:00:00 AM", "Trade", -100.0, 900.0, "")])
    make_xlsx(fe2, alltx=[(D("2026-06-10"), "10:00:00 AM", "Trade", -100.0, 950.0, "")])  # corrected balance
    ce = pv.collect([fe1, fe2])
    check("cash newest-wins: shared date takes the later upload's balance (950)", ce["cash"] == {"2026-06-10": 950.0}, ce["cash"])

    print(f"\n{ok} passed, {bad} failed")
    sys.exit(1 if bad else 0)
finally:
    shutil.rmtree(TMP, ignore_errors=True)
