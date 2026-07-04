#!/usr/bin/env python3
"""
parse-payslip.py — extract monthly salary figures from the text-based MCL/COALNET
payslips dropped in data/reports/ as `Form (NN).pdf`.

PII-SAFE: emits ONLY month + financial figures (net, CMPF, CMPS, basic) — never
name / PAN / employee-no / bank account. Writes nothing by itself; prints a
per-month table for review, then (with --write) patches the gitignored private
seed in place. Regular + supplementary (arrear) slips for the same month are
combined: net/CMPF/CMPS summed; Basic Pay taken from the regular slip (arrears
carry no basic). Feeds PAYSLIPS, CMPF_CONTRIBUTIONS, CMPS_CONTRIBUTIONS and the
new BASIC_PAY (which makes the CMPS pension projection use actual, not estimated,
basic pay).
"""
import os, re, sys, json, glob
from collections import defaultdict
import fitz  # pymupdf

REPORTS = os.path.join("data", "reports")
PRIVATE = os.environ.get("PAYSLIP_PRIVATE") or os.path.join("data", "portfolio.private.json")
MONTHS = {m: i + 1 for i, m in enumerate(
    ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august',
     'september', 'october', 'november', 'december'])}

def num(s):
    try:
        return float(str(s).replace(',', ''))
    except ValueError:
        return None

def label_y(words, label):
    """y of the row containing `label` (labels may span words)."""
    rows = defaultdict(list)
    for w in words:
        rows[round(w[1])].append((w[0], w[4]))
    key = label.replace(' ', '')
    for y in sorted(rows):
        line = ''.join(t for _, t in sorted(rows[y]))
        if key in line:
            return y
    return None

def val_near(words, y, xlo, xhi, dy):
    """numeric whose x∈[xlo,xhi] and closest |Δy|≤dy to row y."""
    if y is None:
        return None
    best, bd = None, dy + 1
    for w in words:
        if xlo <= w[0] <= xhi and abs(w[1] - y) <= dy:
            v = num(w[4])
            if v is not None and abs(w[1] - y) < bd:
                best, bd = v, abs(w[1] - y)
    return best

def parse_form(path):
    pg = fitz.open(path)[0]
    words = pg.get_text('words')
    text = pg.get_text()
    m = re.search(r'\b(' + '|'.join(MONTHS) + r')\b,?\s*(\d{4})', text, re.I)
    month = f"{m.group(2)}-{MONTHS[m.group(1).lower()]:02d}" if m else None
    cmps = (val_near(words, label_y(words, 'CMPS EE Dedn'), 440, 505, 3) or 0) + \
           (val_near(words, label_y(words, 'CMPS EE Adjustment'), 440, 505, 3) or 0)
    return {
        "month": month,
        "net":   val_near(words, label_y(words, 'Net Pay'), 700, 835, 4),
        "cmpf":  val_near(words, label_y(words, 'CMPF contribution'), 440, 505, 3),
        "cmps":  cmps,
        "basic": val_near(words, label_y(words, 'Basic Pay'), 120, 262, 6),
        "file":  os.path.basename(path),
    }

def collect():
    by_month = defaultdict(lambda: {"net": 0.0, "cmpf": 0.0, "cmps": 0.0, "basic": 0.0, "slips": 0})
    skipped = []
    for p in sorted(glob.glob(os.path.join(REPORTS, "Form (*).pdf"))):
        s = parse_form(p)
        if not s["month"]:
            skipped.append(s["file"]); continue
        d = by_month[s["month"]]
        d["net"]  += s["net"]  or 0
        d["cmpf"] += s["cmpf"] or 0
        d["cmps"] += s["cmps"] or 0
        d["basic"] = max(d["basic"], s["basic"] or 0)
        d["slips"] += 1
    return by_month, skipped

def main():
    # --one <file> --porcelain: single-slip probe for the ingest registry wrapper
    # (scripts/ingest/parsers/payslip.mjs). Additive — the corpus flow below is
    # untouched. Emits month + presence booleans ONLY (no figures → ingest.log
    # stays free of salary amounts).
    if "--one" in sys.argv:
        path = sys.argv[sys.argv.index("--one") + 1]
        try:
            s = parse_form(path)
        except Exception as e:  # noqa: BLE001 — a broken PDF is a FAIL, not a crash
            print(json.dumps({"month": None, "error": f"{type(e).__name__}: {e}"[:200]}))
            sys.exit(1)
        print(json.dumps({"month": s["month"], "hasNet": s["net"] is not None,
                          "hasBasic": bool(s["basic"])}))
        sys.exit(0 if s["month"] else 1)

    by_month, skipped = collect()
    print(f"{len(by_month)} months parsed" + (f"; {len(skipped)} skipped (no month): {skipped}" if skipped else ""))
    print(f"{'month':9}{'net':>10}{'cmpf':>9}{'cmps':>8}{'basic':>9}  slips")
    for mo in sorted(by_month):
        d = by_month[mo]
        print(f"{mo:9}{round(d['net']):>10}{round(d['cmpf']):>9}{round(d['cmps']):>8}{round(d['basic']):>9}  {d['slips']}")

    # net / CMPF / CMPS are the official HR-slip figures — NO guard, NO reconciliation:
    # bonus / arrear months swing 3-4x and are REAL, so they pass through as-is. BASIC_PAY
    # is a full rebuild (auto-derivable). net/CMPF/CMPS are APPEND-ONLY — a MISSING month's
    # raw slip figure is added as-is; an already-stored month is left alone (the corpus
    # lacks slips for some stored months, so a full replace would drop them).
    if "--write" in sys.argv:
        data = json.load(open(PRIVATE, encoding="utf-8"))
        data["BASIC_PAY"] = [{"month": mo, "basic": round(by_month[mo]["basic"])}
                             for mo in sorted(by_month) if by_month[mo]["basic"]]
        for key, field, pick in (("PAYSLIPS", "net", "net"),
                                  ("CMPF_CONTRIBUTIONS", "emp", "cmpf"),
                                  ("CMPS_CONTRIBUTIONS", "emp", "cmps")):
            arr = data.get(key, [])
            have = {e["month"] for e in arr}
            added = 0
            for mo in sorted(by_month):
                v = round(by_month[mo][pick])
                if mo in have or not v:
                    continue                                  # never overwrite/drop a stored month
                arr.append({"month": mo, field: v}); added += 1
            arr.sort(key=lambda e: e["month"])
            data[key] = arr
            if added:
                print(f"appended {key} +{added}")
        json.dump(data, open(PRIVATE, "w", encoding="utf-8"), indent=1, ensure_ascii=False)
        print(f"\nwrote BASIC_PAY ({len(data['BASIC_PAY'])} months) + missing net/CMPF/CMPS months "
              f"-> {PRIVATE} (re-seed KV to publish)")

if __name__ == "__main__":
    main()
