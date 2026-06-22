#!/usr/bin/env python3
"""
parse-broker-tax.py — reusable realized-P&L extractor.

Reads every broker tax/P&L report dropped in data/reports/ (gitignored, transient)
and emits data/broker-tax.json — a committed, PII-stripped canonical store so the
app's realized figures are *derived from the reports*, never hand-curated/stale,
and survive without re-uploading the raw files.

WHAT IT NEVER WRITES OUT: PAN, client IDs, account numbers, names, e-mail, or the
raw trade-by-trade list. Only per-FY / per-segment realized totals, trade counts,
and the top movers (symbol + amount) that the UI already displays.

Workflow:  drop reports in data/reports/  ->  python scripts/parse-broker-tax.py
           ->  git add data/broker-tax.json  ->  node scripts/seed-portfolio-kv.mjs

Supports: Zerodha Console tax-P&L (.xlsx, one file per FY), Fyers tax-P&L (.csv,
one per FY), Dhan tax report (.xls, all-time multi-segment), Vested/DriveWealth
P&L statement (.xlsx). Upstox (.xlsx) slots in once uploaded (TODO marker below).

Indian FY = 1 Apr – 31 Mar.  Label form: FY25-26.
"""
import os, re, csv, glob, json, datetime as dt
import openpyxl

REPORTS = os.path.join("data", "reports")
OUT = os.path.join("data", "broker-tax.json")

# ── account → role map (output uses these labels, never the client IDs) ──────
ACCOUNTS = {
    "GWS919":  {"broker": "zerodha", "owner": "mom",  "sleeve": "indian_equity", "label": "zerodha_mom"},
    "YXA918":  {"broker": "zerodha", "owner": "self", "sleeve": "trading",       "label": "zerodha_self"},
    "YS59535": {"broker": "fyers",   "owner": "self", "sleeve": "trading",       "label": "fyers"},
    # Dhan keyed by UCC, Vested by DriveWealth acc — matched on file content/type below.
}

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]

def fy_of(d):
    """datetime/date -> 'FY25-26'."""
    if d is None:
        return None
    y, m = d.year, d.month
    s = y if m >= 4 else y - 1
    return f"FY{str(s)[-2:]}-{str(s + 1)[-2:]}"

def fy_from_pair(a, b):
    """2025,2026 -> 'FY25-26'."""
    return f"FY{str(a)[-2:]}-{str(b)[-2:]}"

def num(x):
    """Best-effort float; '' / None / non-numeric -> None."""
    if x is None:
        return None
    if isinstance(x, (int, float)):
        return float(x)
    s = str(x).strip().replace(",", "")
    if s in ("", "-", "NA", "N/A"):
        return None
    try:
        return float(s)
    except ValueError:
        return None

def parse_date(x):
    if x is None or x == "":
        return None
    if isinstance(x, (dt.datetime, dt.date)):
        return x
    s = str(x).strip()
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d/%m/%Y", "%d-%b-%Y", "%d %b %Y", "%d %b  %Y"):
        try:
            return dt.datetime.strptime(s, fmt)
        except ValueError:
            continue
    # Zerodha tradewise uses ISO; Fyers '01 Apr  2025' (double space)
    s2 = re.sub(r"\s+", " ", s)
    try:
        return dt.datetime.strptime(s2, "%d %b %Y")
    except ValueError:
        return None

def top_movers(by_sym, k=3, usd=False):
    rnd = (lambda a: round(a, 2)) if usd else (lambda a: round(a))
    items = sorted(by_sym.items(), key=lambda kv: kv[1], reverse=True)
    win = [{"sym": s, "amt": rnd(a)} for s, a in items if a > 0][:k]
    los = [{"sym": s, "amt": rnd(a)} for s, a in items[::-1] if a < 0][:k]
    return win, los

def fmt_asof(d):
    return f"{d.day:02d} {MONTHS[d.month - 1]} {d.year}" if d else None

# ── label-based cell lookup for the Zerodha / Fyers summary blocks ───────────
def find_value_after(rows, label_substr):
    """Find first cell containing label_substr; return the next non-empty cell to its right."""
    low = label_substr.lower()
    for r in rows:
        for i, c in enumerate(r):
            if c is not None and low in str(c).strip().lower():
                for j in range(i + 1, len(r)):
                    v = num(r[j])
                    if v is not None:
                        return v
    return None

# ── Zerodha Console tax-P&L (.xlsx, one file per FY) ─────────────────────────
def parse_zerodha(path):
    m = re.search(r"taxpnl-([A-Z0-9]+)-(\d{4})_(\d{4})", os.path.basename(path))
    if not m:
        return None
    acct_id, y1, y2 = m.group(1), int(m.group(2)), int(m.group(3))
    meta = ACCOUNTS.get(acct_id, {"label": f"zerodha_{acct_id}", "sleeve": "trading", "owner": "self"})
    fy = fy_from_pair(y1, y2)
    wb = openpyxl.load_workbook(path, data_only=True)

    def sheet_rows(prefix):
        names = [s for s in wb.sheetnames if s.startswith(prefix)]
        if not names:
            return []
        return [[c.value for c in row] for row in wb[names[0]].iter_rows()]

    eq = sheet_rows("Equity and Non Equity")
    stcg = find_value_after(eq, "Short Term profit") or 0.0
    ltcg = find_value_after(eq, "Long Term profit") or 0.0
    intra = find_value_after(eq, "Intraday/Speculative profit") or 0.0
    fno_rows = sheet_rows("F&O")
    opt = find_value_after(fno_rows, "Options Realized Profit") or 0.0
    fut = find_value_after(fno_rows, "Futures Realized Profit") or 0.0

    # Tradewise Exits: per-symbol realized (aggregate over intraday+STCG+LTCG sections).
    # n = distinct (symbol, exit-date) = positions closed (not lot rows).
    tw = sheet_rows("Tradewise Exits")
    by_sym, exits, last_exit = {}, set(), None
    header_seen = False
    for r in tw:
        c1 = str(r[1]).strip() if len(r) > 1 and r[1] is not None else ""
        if c1 == "Symbol":
            header_seen = True
            continue
        if not header_seen or not c1:
            continue
        profit = num(r[8]) if len(r) > 8 else None
        if profit is None:        # section title row (e.g. 'Equity - Short Term')
            continue
        by_sym[c1] = by_sym.get(c1, 0.0) + profit
        ed = parse_date(r[4]) if len(r) > 4 else None
        exits.add((c1, ed.date() if ed else None))
        if ed and (last_exit is None or ed > last_exit):
            last_exit = ed

    return {
        "label": meta["label"], "owner": meta["owner"], "sleeve": meta["sleeve"], "fy": fy,
        "equity": {"stcg": round(stcg), "ltcg": round(ltcg), "intraday": round(intra),
                   "realized": round(stcg + ltcg + intra)},
        "fno": {"options": round(opt), "futures": round(fut), "realized": round(opt + fut)},
        "n": len(exits), "by_sym": by_sym, "lastExit": last_exit,
    }

# ── Fyers tax-P&L (.csv, one file per FY) ────────────────────────────────────
def parse_fyers(path):
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        rows = list(csv.reader(f))
    acct = None
    fy = None
    for r in rows:
        if len(r) >= 2 and str(r[0]).strip() == "Client ID":
            acct = str(r[1]).strip()
        if len(r) >= 2 and str(r[0]).strip() == "Financial Year" and "-" in str(r[1]):
            a, b = str(r[1]).split("-")
            fy = fy_from_pair(int(a), int(b))
        if acct and fy:
            break
    meta = ACCOUNTS.get(acct, {"label": "fyers", "sleeve": "trading", "owner": "self"})
    realized = find_value_after(rows, "Realised P&L Summary") or 0.0
    opt = find_value_after(rows, "Taxable Options P&L") or 0.0
    fut = find_value_after(rows, "Taxable Future P&L") or 0.0
    stcg = find_value_after(rows, "Net STCG P&L") or 0.0
    ltcg = find_value_after(rows, "Net LTCG P&L") or 0.0
    # last sell date across trade rows (col8 = Sell date)
    last = None
    for r in rows:
        if len(r) > 8:
            d = parse_date(r[8])
            if d and (last is None or d > last):
                last = d
    return {
        "label": meta["label"], "owner": meta["owner"], "sleeve": meta["sleeve"], "fy": fy,
        "equity": {"stcg": round(stcg), "ltcg": round(ltcg), "intraday": 0,
                   "realized": round(stcg + ltcg)},
        "fno": {"options": round(opt), "futures": round(fut), "realized": round(opt + fut)},
        "realizedNet": round(realized), "lastExit": last,
    }

# ── Dhan tax report (.xls, all-time) — segment-summary Gross P&L (FIFO) ───────
# Per-FY bucketing is unreliable from this export; the segment summary rows
# (Intraday/Short Term/Long Term ; F&O Summary) are authoritative all-time totals.
# Per-FY trading P&L lives in fno-ledger.json from the live sync — this is a check.
def parse_dhan(path):
    import xlrd
    wb = xlrd.open_workbook(path)
    out = {}
    for seg, sheet in (("equity", "Equity"), ("fno", "F&O")):
        if sheet not in wb.sheet_names():
            continue
        ws = wb.sheet_by_name(sheet)
        rows = [[ws.cell_value(ri, ci) for ci in range(ws.ncols)] for ri in range(ws.nrows)]
        gp_col = None
        total = 0.0
        for r in rows:
            if gp_col is None:
                for i, c in enumerate(r):
                    if c is not None and str(c).strip() == "Gross P&L":
                        gp_col = i
                continue
            c0 = str(r[0]).strip() if r[0] is not None else ""
            if num(c0) is not None:           # reached per-trade Sr rows
                break
            gp = num(r[gp_col]) if gp_col < len(r) else None
            if c0 and gp is not None:          # a segment summary row
                total += gp
            elif c0 and gp is None:            # section title (e.g. 'Tradewise Details')
                break
        out[seg] = round(total)
    return {"label": "dhan", "owner": "self", "sleeve": "trading", "allTime": out}

# ── Vested/DriveWealth P&L statement (.xlsx) — Realized breakdown by Date Sold ─
def parse_vested(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    sn = [s for s in wb.sheetnames if s.strip().startswith("Realized P&L - Breakdown")]
    if not sn:
        return None
    rows = [[c.value for c in r] for r in wb[sn[0]].iter_rows()]
    # header: Security, Quantity, Date Sold, ..., Profit/Loss (USD)[8], ..., P/L(INR)[11]
    by_fy = {}        # fy -> {'usd':x,'inr':y,'exits':set,'sym':{...}}
    last = None
    for r in rows[1:]:
        sec = str(r[0]).strip() if r[0] else ""
        sold = parse_date(r[2]) if len(r) > 2 else None
        usd = num(r[8]) if len(r) > 8 else None
        inr = num(r[11]) if len(r) > 11 else None
        if not sec or sold is None or usd is None:
            continue
        fy = fy_of(sold)
        b = by_fy.setdefault(fy, {"usd": 0.0, "inr": 0.0, "exits": set(), "sym": {}})
        b["usd"] += usd
        b["inr"] += inr or 0.0
        b["exits"].add((sec, sold.date()))     # distinct sell events, not lots
        b["sym"][sec] = b["sym"].get(sec, 0.0) + usd
        if last is None or sold > last:
            last = sold
    return {"by_fy": by_fy, "lastExit": last}

# ── Upstox realized P&L (zipped .xlsx, one per FY) — F&O trading (UCC 7BB93B) ──
def parse_upstox_zip(path):
    import zipfile, io
    fy = None
    m = re.search(r"realizedPnL_(\d{4})_", os.path.basename(path))
    if m:
        s = m.group(1)
        fy = f"FY{s[:2]}-{s[2:]}"
    with zipfile.ZipFile(path) as zf:
        xlsx = [n for n in zf.namelist() if n.lower().endswith(".xlsx")]
        if not xlsx:
            return None        # some FYs are pdf-only — the xlsx twin carries the data
        wb = openpyxl.load_workbook(io.BytesIO(zf.read(xlsx[0])), data_only=True)
    rows = [[c.value for c in r] for r in wb[wb.sheetnames[0]].iter_rows()]
    net = find_value_after(rows, "Net P&L")
    if net is None or round(net) == 0:
        return None        # empty FY (no F&O activity that year) — skip the noise
    gross = find_value_after(rows, "Gross P&L")
    return {"label": "upstox", "owner": "self", "sleeve": "trading", "fy": fy,
            "fno": {"realized": round(net), "gross": round(gross) if gross is not None else None}}

# ── Astha Credit & Securities F&O P&L (.csv, one per FY) — old F&O trading ─────
def parse_astha(path):
    with open(path, newline="", encoding="utf-8", errors="replace") as f:
        rows = list(csv.reader(f))
    fy = None
    for r in rows[:8]:
        if len(r) >= 2 and str(r[0]).strip() == "Report Date":
            m = re.search(r"(\d{4})-\d\d-\d\d to (\d{4})", str(r[1]))
            if m:
                fy = fy_from_pair(int(m.group(1)), int(m.group(2)))
    tot, pcol = 0.0, None
    for r in rows:
        if pcol is None:
            for i, c in enumerate(r):
                if c is not None and str(c).strip() == "P&L":
                    pcol = i
            continue
        v = num(r[pcol]) if pcol < len(r) else None
        if v is not None:
            tot += v
    return {"label": "astha", "owner": "self", "sleeve": "trading", "fy": fy,
            "fno": {"realized": round(tot)}}

# ── Groww equity P&L (.xlsx) — self equity, all-time (UCC 0258131546) ─────────
def parse_groww(path):
    wb = openpyxl.load_workbook(path, data_only=True)
    tl = [[c.value for c in r] for r in wb["Trade Level"].iter_rows()] if "Trade Level" in wb.sheetnames else []
    realized = find_value_after(tl, "Realised P&L")    # 'Realised P&L' row precedes 'Unrealised'
    by_sym = {}
    if "Scrip Level" in wb.sheetnames:
        hdr = False
        for r in [[c.value for c in row] for row in wb["Scrip Level"].iter_rows()]:
            if r and str(r[0]).strip() == "Stock name":
                hdr = True
                continue
            if not hdr:
                continue
            name = str(r[0]).strip() if r[0] else ""
            pnl = num(r[7]) if len(r) > 7 else None
            if name and name.lower() != "total" and pnl is not None:
                by_sym[name] = by_sym.get(name, 0.0) + pnl
    win, los = top_movers(by_sym, 3)
    return {"label": "groww", "owner": "self", "sleeve": "equity_self",
            "allTime": round(realized) if realized is not None else None,
            "winners": win, "losers": los, "n": len(by_sym)}

# ── build the RealizedPanel-shaped block from per-FY accumulators ─────────────
def realized_block(per_fy, asof, source, usd=False):
    """per_fy: {fy: {'amt':x,'n':k,'by_sym':{...}, ['usd','inr']}}"""
    def fy_sort(label):
        return int(label[2:4])
    fy_list = []
    all_sym = {}
    for fy in sorted(per_fy, key=fy_sort):
        d = per_fy[fy]
        win, los = top_movers(d["by_sym"], 3, usd)
        entry = {"label": fy, "amt": round(d["amt"], 2) if usd else round(d["amt"]),
                 "n": d["n"], "winners": win, "losers": los}
        fy_list.append(entry)
        for s, a in d["by_sym"].items():
            all_sym[s] = all_sym.get(s, 0.0) + a
    gwin, glos = top_movers(all_sym, 3, usd)
    latest = fy_list[-1] if fy_list else None
    block = {
        "asOf": fmt_asof(asof),
        "source": source,
        "total": round(sum(e["amt"] for e in fy_list), 2) if usd else round(sum(e["amt"] for e in fy_list)),
        "ytdLabel": latest["label"] if latest else None,
        "fy": fy_list, "winners": gwin, "losers": glos,
    }
    if usd:
        block["ytdUsd"] = latest["amt"] if latest else 0
    else:
        block["ytd"] = latest["amt"] if latest else 0
    return block

def main():
    accounts, fno_corro = [], {}
    dhan = vested = groww = None
    upstox_by_fy = {}                 # dedupe the many duplicate per-FY zips
    files = sorted(glob.glob(os.path.join(REPORTS, "*")))
    for p in files:
        base = os.path.basename(p)
        ext = base.lower().rsplit(".", 1)[-1]
        try:
            if base.startswith("taxpnl-") and ext == "xlsx":
                r = parse_zerodha(p)
                if r:
                    accounts.append(r)
            elif base.startswith("FYERS_tax_pnl") and ext == "csv":
                accounts.append(parse_fyers(p))
            elif base == "TAX_PNL_REPORT.xls":
                dhan = parse_dhan(p)
            elif base.startswith("Profit-Loss Statement") and ext == "xlsx":
                vested = parse_vested(p)
            elif base.startswith("realizedPnL_") and ext == "zip":   # Upstox (7BB93B), F&O
                r = parse_upstox_zip(p)
                if r and r["fy"] and r["fy"] not in upstox_by_fy:
                    upstox_by_fy[r["fy"]] = r
            elif base.startswith("AG4907") and ext == "csv":          # Astha, old F&O
                accounts.append(parse_astha(p))
            elif base.startswith("Stocks_PnL_Report") and ext == "xlsx":  # Groww, self equity
                groww = parse_groww(p)
        except Exception as e:
            print(f"  ! {base}: {type(e).__name__}: {e}")
    accounts.extend(upstox_by_fy.values())

    # global as-of = latest exit seen anywhere
    asof = None
    for a in accounts:
        le = a.get("lastExit")
        if le and (asof is None or le > asof):
            asof = le
    if vested and vested["lastExit"] and (asof is None or vested["lastExit"] > asof):
        asof = vested["lastExit"]

    # ── INDIAN_REALIZED: mom's Zerodha equity (GWS919) [+ Upstox swing when present] ──
    indian_per_fy = {}
    for a in accounts:
        if a["sleeve"] == "indian_equity":
            fy = a["fy"]
            d = indian_per_fy.setdefault(fy, {"amt": 0.0, "n": 0, "by_sym": {}})
            d["amt"] += a["equity"]["realized"]
            d["n"] += a.get("n", 0)
            for sym, amt in a.get("by_sym", {}).items():   # full per-symbol aggregation
                d["by_sym"][sym] = d["by_sym"].get(sym, 0.0) + amt
    indian_realized = realized_block(
        indian_per_fy, asof, "Zerodha tax P&L · realized (FIFO)") if indian_per_fy else None

    # ── US_REALIZED: Vested ──────────────────────────────────────────────────
    us_realized = None
    if vested:
        us_per_fy = {}
        for fy, b in vested["by_fy"].items():
            us_per_fy[fy] = {"amt": b["usd"], "n": len(b["exits"]), "by_sym": b["sym"]}
        us_realized = realized_block(us_per_fy, vested["lastExit"],
                                     "Vested realized P&L · lot-level", usd=True)
        # attach INR totals per FY for the ≈₹ subline
        inr_by_fy = {fy: round(b["inr"]) for fy, b in vested["by_fy"].items()}
        for e in us_realized["fy"]:
            e["amtInr"] = inr_by_fy.get(e["label"])

    # ── F&O corroboration (trading) ──────────────────────────────────────────
    for a in accounts:
        if a["sleeve"] == "trading" and "fno" in a and a["fy"]:
            fno_corro.setdefault(a["label"], {})[a["fy"]] = a["fno"]["realized"]

    out = {
        "generatedFrom": "data/reports/* (broker tax/P&L exports)",
        "asOf": fmt_asof(asof),
        "note": "PII-stripped, derived — regen with scripts/parse-broker-tax.py; never hand-edit.",
        "accounts": [
            {"label": a["label"], "broker": a["label"].split("_")[0], "owner": a["owner"],
             "sleeve": a["sleeve"], "fy": a["fy"],
             "equity": a.get("equity"), "fno": a.get("fno"), "n": a.get("n")}
            for a in accounts
        ],
        "indian_realized": indian_realized,
        "us_realized": us_realized,
        "fno": fno_corro,
        "dhan_allTime": dhan["allTime"] if dhan else None,
        "groww_equity_self": groww,   # self equity, separate from the Indian (mom) sleeve
    }
    with open(OUT, "w", encoding="utf-8") as f:
        json.dump(out, f, indent=2, ensure_ascii=False)
    print(f"wrote {OUT}  (asOf {out['asOf']})")
    return out

if __name__ == "__main__":
    main()
