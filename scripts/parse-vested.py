#!/usr/bin/env python3
"""
parse-vested.py — convert the Vested / DriveWealth transactions export
(Vested_Transactions*.xlsx) into data/us_trades.json, the per-symbol unit-replay
source the US historical growth curve is reconstructed from (app/lib/backfill.js).

Mirrors scripts/parse-payslip.py's CLI:
  (default)              review mode — parse + print a PII-free summary, NO writes
  --one <file> [--porc.] single-file probe for the ingest registry wrapper
                         (scripts/ingest/parsers/vested.mjs); prints JSON status
                         + naturalKey (the export's latest activity date)
  --write                regenerate data/us_trades.json (US_TRADES_OUT overrides
                         the path, like payslip's PAYSLIP_PRIVATE) from the
                         canonical export at data/reports/Vested_Transactions.xlsx
                         (VESTED_XLSX overrides the input path)

OUTPUT SHAPE (byte-compatible with the existing data/us_trades.json):
  {"asOf": "YYYY-MM-DD",
   "cash":  {date: usd_balance, ...},              # broker cash balance, end of day
   "flows": {SYMBOL: [[date, usd], ...], ...},     # net USD into/out of each HELD
                                                   #   symbol per day (buy +, sell -)
   "other": [[date, usd], ...]}                    # same, aggregated across every
                                                   #   NON-held (exited/untracked) symbol

  flows vs other split: a symbol lands in `flows` iff it is a CURRENT US holding
  (data/portfolio.private.json -> US[].sym); everything else is folded into
  `other` (backfill carries those at net cost, since the app fetches price
  history only for held names). Buy = +Cash Amount, Sell = -Cash Amount; same-day
  same-symbol trades are summed; entries netting to 0.00 are dropped.

  cash = the "Account Balance" column of the "All Transactions" sheet at the
  latest transaction of each date (i.e. the true end-of-day broker balance, which
  already reflects deposits, trades, dividends, taxes and fees).

PII-SAFE: reads only Trades / All Transactions / Transfers / Income and emits ONLY
tickers, USD amounts and USD balances. The "My Account" sheet (name / email /
account number) and the security-name comments are never read into the output.
"""
import os, re, sys, json
from collections import defaultdict

REPORTS = os.path.join("data", "reports")
PRIVATE = os.path.join("data", "portfolio.private.json")
DEFAULT_IN = os.environ.get("VESTED_XLSX", os.path.join(REPORTS, "Vested_Transactions.xlsx"))
DEFAULT_OUT = os.environ.get("US_TRADES_OUT", os.path.join("data", "us_trades.json"))

_TIME_RE = re.compile(r"^\s*(\d{1,2}):(\d{2}):(\d{2})\s*([AP]M)\s*$", re.I)


def num(x):
    try:
        return float(str(x).replace(",", ""))
    except (ValueError, TypeError):
        return 0.0


def day(x):
    """First 10 chars of a cell -> 'YYYY-MM-DD' (dates come through as datetime)."""
    return str(x)[:10] if x is not None else None


def _secs(tm):
    """'07:06:19 PM' -> seconds since midnight; None if unparseable."""
    m = _TIME_RE.match(str(tm or ""))
    if not m:
        return None
    h, mi, s, ap = int(m.group(1)), int(m.group(2)), int(m.group(3)), m.group(4).upper()
    if ap == "PM" and h != 12:
        h += 12
    if ap == "AM" and h == 12:
        h = 0
    return h * 3600 + mi * 60 + s


def load_held():
    """Current US holdings tickers — the flows/other split key. None if unavailable."""
    if not os.path.exists(PRIVATE):
        return None
    try:
        priv = json.load(open(PRIVATE, encoding="utf-8"))
    except (ValueError, OSError):
        return None
    us = priv.get("US")
    if not isinstance(us, list):
        return None
    return {h["sym"] for h in us if isinstance(h, dict) and h.get("sym")}


def parse(path, held):
    """Reduce a Vested export to {asOf, cash, flows, other}. `held` may be None
    (then every symbol lands in `other`; --write refuses that upstream)."""
    import openpyxl  # lazy — only --one/--write need it, keeps import errors local
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    held = held or set()

    flows = defaultdict(lambda: defaultdict(float))   # sym -> date -> usd
    other = defaultdict(float)                         # date -> usd
    maxd = ""

    # Trades -> per-symbol / other net USD (Buy +, Sell -)
    if "Trades" in wb.sheetnames:
        for i, r in enumerate(wb["Trades"].iter_rows(values_only=True)):
            if i == 0:
                continue
            date, _tm, _name, tk, act, _ot, _qty, _pps, cash, _comm = r[:10]
            if tk is None or cash is None:
                continue
            d = day(date)
            maxd = max(maxd, d)
            v = num(cash) * (1 if str(act).lower().startswith("buy") else -1)
            (flows[tk] if tk in held else other)[d] += v

    # All Transactions -> end-of-day cash balance. The sheet is newest-first, so
    # per date the row with the latest time is the day's close; ties (same-second
    # batches) break by sheet order (the top-most, i.e. smallest index, is the
    # last executed). Track the max (time, -index) per date.
    best = {}  # date -> (sortkey, balance)
    if "All Transactions" in wb.sheetnames:
        for i, r in enumerate(wb["All Transactions"].iter_rows(values_only=True)):
            if i == 0:
                continue
            date, tm, _typ, _amt, bal, _comment = r[:6]
            if bal is None:
                continue
            d = day(date)
            maxd = max(maxd, d)
            key = (_secs(tm) if _secs(tm) is not None else -1, -i)
            if d not in best or key > best[d][0]:
                best[d] = (key, num(bal))
    cash = {d: round(best[d][1], 2) for d in sorted(best)}

    # emit — symbols alphabetical, dates ascending, drop entries netting to 0.00
    out_flows = {}
    for s in sorted(flows):
        pts = [[d, round(flows[s][d], 2)] for d in sorted(flows[s]) if round(flows[s][d], 2) != 0.0]
        if pts:
            out_flows[s] = pts
    out_other = [[d, round(other[d], 2)] for d in sorted(other) if round(other[d], 2) != 0.0]

    return {"asOf": maxd, "cash": cash, "flows": out_flows, "other": out_other}


def write_out(data, out):
    os.makedirs(os.path.dirname(os.path.abspath(out)), exist_ok=True)
    with open(out, "w", encoding="utf-8") as f:
        json.dump(data, f, separators=(",", ":"), ensure_ascii=False)


def probe(path):
    """Registry probe: latest activity date + coarse counts. No PII, no split."""
    data = parse(path, held=None)  # held not needed for identity/dedup
    tickers = set()
    trades = 0
    import openpyxl
    wb = openpyxl.load_workbook(path, read_only=True, data_only=True)
    if "Trades" in wb.sheetnames:
        for i, r in enumerate(wb["Trades"].iter_rows(values_only=True)):
            if i == 0:
                continue
            if r[3] is not None:
                tickers.add(r[3]); trades += 1
    return {
        "asOf": data["asOf"] or None,
        "key": data["asOf"] or None,   # naturalKey = latest activity date in the export
        "tickers": len(tickers),
        "trades": trades,
        "cashDays": len(data["cash"]),
    }


def main():
    # --one <file> [--porcelain]: single-file probe for scripts/ingest/parsers/vested.mjs
    if "--one" in sys.argv:
        path = sys.argv[sys.argv.index("--one") + 1]
        try:
            st = probe(path)
        except Exception as e:  # noqa: BLE001 — a broken/foreign xlsx is a FAIL, not a crash
            print(json.dumps({"asOf": None, "error": f"{type(e).__name__}: {e}"[:200]}))
            sys.exit(1)
        print(json.dumps(st))
        sys.exit(0 if st.get("asOf") else 1)

    inp = DEFAULT_IN
    held = load_held()

    if "--write" in sys.argv:
        if not held:
            # the flows/other split is essential — refuse rather than dump every
            # symbol into `other` (mirrors payslip's guarded-seed refusal semantics)
            print("FAIL: could not load US holdings from data/portfolio.private.json "
                  "(needed for the flows/other split) — refusing to write")
            sys.exit(1)
        data = parse(inp, held)
        out = DEFAULT_OUT
        write_out(data, out)
        print(f"wrote {len(data['flows'])} held symbols, {len(data['other'])} other pts, "
              f"{len(data['cash'])} cash days, asOf {data['asOf']} -> {out}")
        return

    # review mode — parse + PII-free summary, no writes
    data = parse(inp, held or set())
    print(f"input: {inp}")
    print(f"asOf (latest activity): {data['asOf']}")
    print(f"held symbols in flows:  {len(data['flows'])}"
          + ("" if held else "  [WARN: no holdings list -> everything in 'other']"))
    print(f"other (exited/untracked) points: {len(data['other'])}")
    if data["cash"]:
        days = sorted(data["cash"])
        print(f"cash days: {len(days)}  ({days[0]} .. {days[-1]}, last balance ${data['cash'][days[-1]]})")
    if held:
        covered = set(data["flows"])
        missing = sorted(held - covered)
        print(f"holdings covered by flows: {len(covered)}/{len(held)}"
              + (f"  missing (no trades in export): {missing}" if missing else ""))


if __name__ == "__main__":
    main()
