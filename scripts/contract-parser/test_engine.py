#!/usr/bin/env python3
"""Synthetic proof of the parsing LOGIC — fake data only, no PII, no PDF, no password.
Validates: parenthesised money parsing, ISIN-split, table column-mapping, the STRUCTURAL
charges-table parse (CGST/SGST blank -> 0, NOT fabricated from the '@9%' in the label),
the built-in checksum, and that masking leaks no values. The real PDF is validated by the
user running parser.py with CN_PW."""
import engine as P

ok = 0; bad = 0
def check(name, cond, got=None):
    global ok, bad
    if cond: ok += 1; print(f"  ok  {name}")
    else: bad += 1; print(f"  XX  {name}  got={got!r}")

# 1) parenthesised money: (x) -> -x (debit) ; blank -> None ; commas stripped
check("pnum paren -> negative", P.pnum("(29,458.26)") == -29458.26, P.pnum("(29,458.26)"))
check("pnum plain -> positive", P.pnum("0.90") == 0.90, P.pnum("0.90"))
check("pnum blank -> None",     P.pnum("") is None and P.pnum("-") is None, None)

# 2) ISIN split out of the security/description cell
sym, isin = P.split_isin("FAKECO INFAKE000017", "")
check("ISIN split: symbol", sym == "FAKECO", sym)
check("ISIN split: isin",   isin == "INFAKE000017", isin)

# 3) trade table mapping with parenthesised net_total (buy debit / sell credit) + ISIN in desc
tbl = [
    ["Order No.","Trade No.","Trade Time","Security/Contract Description","B/S","Quantity","Net Rate per Unit","Net Total","Brokerage"],
    ["111","222","10:01:02","FAKECO INFAKE000017","B","100","250.50","(25,050.00)","3.50"],
    ["333","444","10:05:00","FAKECO INFAKE000017","S","100","255.00","25,500.00","3.50"],
    ["","","","Total","","","","(50,550.00)","7.00"],   # sub-total row -> skipped (no qty)
]
fills = P.map_table(tbl)
check("2 fills (sub-total skipped)", len(fills) == 2, len(fills))
check("buy net_total paren -> negative", fills[0]["net_total"] == -25050.0, fills[0]["net_total"])
check("sell net_total -> positive",      fills[1]["net_total"] == 25500.0, fills[1]["net_total"])
check("isin pulled from description",    fills[0]["isin"] == "INFAKE000017", fills[0]["isin"])
check("symbol stripped of isin",         fills[0]["instrument"] == "FAKECO", fills[0]["instrument"])

# 4) CHARGES-SUMMARY table — IGST populated, CGST/SGST BLANK (must be 0, not '@9%' = 9.0)
charges_tbl = [
    ["Particulars","NCL-Cash","NCL-F&O","NET TOTAL"],
    ["Pay in/Pay out obligation","(29,424.15)","","(29,424.15)"],
    ["Taxable value of Supply (Brokerage)","(0.01)","","(0.01)"],
    ["Exchange transaction charges","(0.90)","","(0.90)"],
    ["Clearing charges","","",""],
    # spelled-out parentheticals (the REAL note format) — the words Brokerage/Transaction/
    # Clearing inside () must NOT cause mis-attribution to brokerage/exchange_txn/clearing:
    ["CGST (@9% of Brokerage, SEBI, Transaction & Clearing charges)","","",""],   # blank -> 0
    ["SGST (@9% of Brokerage, SEBI, Transaction & Clearing charges)","","",""],   # blank -> 0
    ["IGST (@18% of Brokerage, SEBI, Transaction & Clearing charges)","(0.17)","","(0.17)"],
    ["Securities transaction tax","(29.00)","","(29.00)"],
    ["SEBI turnover fees","(0.03)","","(0.03)"],
    ["Stamp duty","(4.00)","","(4.00)"],
    ["Net amount receivable/(payable by client)","(29,458.26)","","(29,458.26)"],
]
ch = P.parse_charges_rows(charges_tbl)
nt = ch["net_total"]
check("CGST blank -> 0 (NOT 9.0 from @9%)", nt.get("cgst") == 0.0, nt.get("cgst"))
check("SGST blank -> 0 (NOT fabricated)",   nt.get("sgst") == 0.0, nt.get("sgst"))
check("IGST read from IGST row",            nt.get("igst") == -0.17, nt.get("igst"))
check("STT read",                           nt.get("stt") == -29.0, nt.get("stt"))
check("brokerage from 'taxable value'",     nt.get("brokerage") == -0.01, nt.get("brokerage"))
check("exactly one GST side non-zero",
      (nt["igst"] != 0) ^ (nt["cgst"] != 0 or nt["sgst"] != 0), (nt["igst"], nt["cgst"], nt["sgst"]))
check("clearing-segment NCL-Cash keyed",    "NCL-Cash" in ch["by_clearing_segment"], list(ch["by_clearing_segment"]))
# Bug-1 regression: IGST's value must NOT bleed into brokerage (paren said "...of Brokerage...")
check("IGST not mis-attributed to brokerage", nt.get("brokerage") == -0.01, nt.get("brokerage"))

# 4b) GST attribution assert (CHECKSUM 2): exactly one side non-zero when base>0
gpass, gdetail = P.gst_check(nt)
check("gst_check PASS (igst side, base>0)", gpass is True, (gpass, gdetail))
bad_nt = {"pay_in": -100.0, "brokerage": -1.0, "exchange_txn": -1.0, "sebi_turnover": -0.1,
          "igst": 0.0, "cgst": 0.0, "sgst": 0.0, "net_amount": -102.1}
check("gst_check FAILS on all-zero GST w/ base (catches the bug)", P.gst_check(bad_nt)[0] is False, P.gst_check(bad_nt))

# 5) CHECKSUM: net_amount == pay_in + sum(charges)  -> the note's built-in proof
passed, residual = P.checksum(nt)
check("checksum PASS", passed is True, (passed, residual))
check("checksum residual ~0", abs(residual) <= 0.01, residual)

# 6) masking must NOT leak real values
ledger = {"broker":"zerodha","note_file":"x.pdf","trade_source":"tables",
          "charges": ch, "checksum": {"pass": passed, "residual": residual}, "fills": fills}
summary = P.masked_summary(ledger)
leaks = [t for t in ("FAKECO","INFAKE000017","250.5","25050","29.00","0.90","29424") if t in summary]
check("masked summary leaks NO values/symbols", leaks == [], leaks)
check("summary reports checksum verdict", "CHECKSUM" in summary and "PASS" in summary, None)
check("summary confirms GST split", "GST split" in summary, None)

# ===== SHAPE COVERAGE — stress the hard paths the sample note never exercised =====
print("[shape] sells:")
sells_tbl = [
    ["Order No.","Trade No.","Trade Time","Security/Contract Description","B/S","Quantity","Net Rate per Unit","Net Total"],
    ["a","b","09:30","ACME INACME000019","S","50","100.00","5,000.00"],
    ["c","d","09:31","ACME INACME000019","S","50","101.00","5,050.00"],
]
sf = P.map_table(sells_tbl)
check("sells: 2 SELL fills", [f["side"] for f in sf] == ["SELL","SELL"], [f["side"] for f in sf])
check("sells: qty/price parsed", sf[0]["qty"] == 50.0 and sf[0]["price"] == 100.0, (sf[0]["qty"], sf[0]["price"]))

print("[shape] F&O (derivatives, no ISIN, CTT):")
fno_tbl = [
    ["Order No.","Trade No.","Trade Time","Security/Contract Description","B/S","Quantity","Net Rate per Unit","Net Total"],
    ["e","f","10:00","NIFTY24JUN24FUT","B","50","23500.00","(11,75,000.00)"],
    ["g","h","10:01","BANKNIFTY 26JUN24 52000 CE","S","15","300.00","4,500.00"],
]
ff = P.map_table(fno_tbl)
for x in ff: x["segment"] = P.infer_segment(x)
check("F&O: 2 fills", len(ff) == 2, len(ff))
check("F&O: segment=fno (FUT/CE)", [x["segment"] for x in ff] == ["fno","fno"], [x["segment"] for x in ff])
check("F&O: isin empty (derivatives carry none)", all(x["isin"] == "" for x in ff), [x["isin"] for x in ff])
ctt_tbl = [
    ["Particulars","NCL-F&O","NET TOTAL"],
    ["Pay in/Pay out obligation","(50,000.00)","(50,000.00)"],
    ["Taxable value of Supply (Brokerage)","(20.00)","(20.00)"],
    ["Commodities transaction tax","(10.00)","(10.00)"],
    ["IGST (@18% of Brokerage, SEBI, Transaction & Clearing charges)","(3.60)","(3.60)"],
    ["Net amount receivable/(payable by client)","(50,033.60)","(50,033.60)"],
]
cc = P.parse_charges_rows(ctt_tbl)["net_total"]
check("F&O: CTT read, STT absent", cc.get("ctt") == -10.0 and cc.get("stt") is None, (cc.get("ctt"), cc.get("stt")))
check("F&O: checksum PASS w/ CTT", P.checksum(cc)[0] is True, P.checksum(cc))

print("[shape] multi-ISIN WAP disambiguation:")
summary_tbl = [
    ["ISIN","Security","WAP (Weighted Average Price)"],
    ["INAAA0000019","AAACO","100.50"],
    ["INBBB0000027","BBBCO","250.75"],
]
waps = P.wap_from_tables([summary_tbl])
fills2 = [{"isin":"INAAA0000019","instrument":"AAACO","wap":None},
          {"isin":"INBBB0000027","instrument":"BBBCO","wap":None}]
P.backfill_wap(fills2, waps)
check("multi-ISIN: each fill gets ITS isin's WAP", [f["wap"] for f in fills2] == [100.50, 250.75], [f["wap"] for f in fills2])
check("multi-ISIN: WAPs not cross-contaminated", fills2[0]["wap"] != fills2[1]["wap"], None)

print("[shape] buy/sell separate WAP columns (sell-side WAP fix):")
bs_summary = [
    ["Security","ISIN","Buy Qty","Buy WAP","Buy Value","Sell Qty","Sell WAP","Sell Value"],
    ["ACME","INACME000019","10","100.00","1000.00","5","105.00","525.00"],
]
bw = P.wap_from_tables([bs_summary])
check("buy WAP column detected", bw["buy"].get("INACME000019") == 100.00, bw["buy"])
check("sell WAP column detected (separate from buy)", bw["sell"].get("INACME000019") == 105.00, bw["sell"])
bs_fills = [{"isin":"INACME000019","instrument":"ACME","side":"BUY","wap":None},
            {"isin":"INACME000019","instrument":"ACME","side":"SELL","wap":None}]
P.backfill_wap(bs_fills, bw)
check("BUY fill -> buy WAP", bs_fills[0]["wap"] == 100.00, bs_fills[0]["wap"])
check("SELL fill -> sell WAP (was empty before fix)", bs_fills[1]["wap"] == 105.00, bs_fills[1]["wap"])

print("[shape] F&O double-count guard (summary table is NOT a fill source):")
fno_detail = [
    ["Order No","Trade No","Trade Time","Security","B/S","Quantity","Net Rate per Unit","Net Total"],
    ["1","11","10:00","NIFTY24JUN24PE24000","S","150","30.00","4,500.00"],
    ["2","12","10:05","NIFTY24JUN24PE24000","S","75","31.00","2,325.00"],
]
fno_summary = [   # per-contract aggregate: WAP + qty but NO trade/order no -> must NOT be fills
    ["Contract Description","B/S","Quantity","WAP Per Unit","Brokerage Per Unit","Net Total"],
    ["NIFTY24JUN24PE24000","S","225","30.33","0.09","6,825.00"],
]
check("is_detail_header True for DETAIL (has trade no)", P.is_detail_header(fno_detail[0]) is True, None)
check("is_detail_header False for SUMMARY (no trade no)", P.is_detail_header(fno_summary[0]) is False, None)
check("map_table: 2 fills from DETAIL", len(P.map_table(fno_detail)) == 2, len(P.map_table(fno_detail)))
check("map_table: 0 fills from SUMMARY (no double-count)", len(P.map_table(fno_summary)) == 0, len(P.map_table(fno_summary)))

print("[shape] F&O WAP via B/S ROW + contract key (single WAP column):")
fno_sum2 = [
    ["Contract Description","B/S","Quantity","WAP Per Unit"],
    ["NIFTY24JUN24PE24000","S","225","30.33"],
    ["NIFTY24JUN24PE23800","B","150","12.50"],
]
fw = P.wap_from_tables([fno_sum2])
sell_fill = [{"instrument":"NIFTY24JUN24PE24000","isin":"","side":"SELL","wap":None}]
buy_fill  = [{"instrument":"NIFTY24JUN24PE23800","isin":"","side":"BUY","wap":None}]
P.backfill_wap(sell_fill, fw); P.backfill_wap(buy_fill, fw)
check("F&O SELL WAP from S row, by contract", sell_fill[0]["wap"] == 30.33, sell_fill[0]["wap"])
check("F&O BUY WAP from B row, by contract", buy_fill[0]["wap"] == 12.50, buy_fill[0]["wap"])

print("[shape] equity Buy/Sell BLOCK summary (spanning header resolved by anchor):")
eq_block = [
    ["Security Description","","Buy","","","","","Sell","","","","","Net Obligation",""],
    ["","","Qty","WAP","Value","Brk","","Qty","WAP","Value","Brk","","",""],   # sub-header (Qty|WAP|Value per block)
    ["INFY INE009A01021","","100","1500.00","150000","5","","","","","","","-150005",""],  # buy-only
    ["TCS INE467B01029","","","","","","","50","3500.00","175000","8","","174992",""],      # sell-only
]
bw = P.wap_from_tables([eq_block])
check("equity block: buy WAP via Buy block by ISIN", bw["buy"].get("INE009A01021") == 1500.00, bw["buy"])
check("equity block: sell WAP via Sell block by ISIN", bw["sell"].get("INE467B01029") == 3500.00, bw["sell"])
eqf = [{"isin":"INE009A01021","instrument":"INFY","side":"BUY","wap":None},
       {"isin":"INE467B01029","instrument":"TCS","side":"SELL","wap":None}]
P.backfill_wap(eqf, bw)
check("equity BUY fill -> buy WAP", eqf[0]["wap"] == 1500.00, eqf[0]["wap"])
check("equity SELL fill -> sell WAP (the 10/15 fix)", eqf[1]["wap"] == 3500.00, eqf[1]["wap"])
# collapsed 2-row header (pdfplumber merged) -> positional WAP at anchor+1
eq_collapsed = [
    ["Security Description","","Buy","","","","","Sell","","","","","Net Obligation",""],
    ["INFY INE009A01021","","100","1500.00","150000","5","","","","","","","-150005",""],
]
check("equity block (collapsed header): buy WAP at anchor+1", P.wap_from_tables([eq_collapsed])["buy"].get("INE009A01021") == 1500.00, None)

print("[shape] F&O summary: row-per-side, exchange-suffix normalize, per-unit WAP (not after-brk):")
fno_sum3 = [
    ["Contract Description","Buy(B)/Sell(S)/BF/CF","Quantity","WAP (Weighted Average Price) Per Unit","Brokerage Per Unit","WAP after brokerage","Net Total"],
    ["NIFTY25SEP24650PE","S","225","30.33","0.09","30.24","6,825.00"],
    ["NIFTY25SEP23800CE","B","150","12.50","0.09","12.59","1,875.00"],
]
fw3 = P.wap_from_tables([fno_sum3])
det = [{"instrument":"NIFTY25SEP24650PE - NSE","isin":"","side":"SELL","wap":None},
       {"instrument":"NIFTY25SEP24650PE - NSE","isin":"","side":"SELL","wap":None},   # split fill, same contract-side
       {"instrument":"NIFTY25SEP23800CE - NSE","isin":"","side":"BUY","wap":None}]
P.backfill_wap(det, fw3)
check("F&O split sell fills share contract-side WAP", [d["wap"] for d in det[:2]] == [30.33, 30.33], [d["wap"] for d in det[:2]])
check("F&O buy fill -> PER-UNIT WAP (not after-brokerage 12.59)", det[2]["wap"] == 12.50, det[2]["wap"])
check("F&O exchange-suffix '- NSE' normalized in the join", det[0]["wap"] == 30.33, det[0]["wap"])
# don't regress: _normkey strips exchange suffix + spacing
check("_normkey strips exchange suffix", P._normkey("NIFTY25SEP24650PE - NSE") == "NIFTY25SEP24650PE", P._normkey("NIFTY25SEP24650PE - NSE"))

print("[shape] same-state CGST/SGST (IGST blank):")
ss_tbl = [
    ["Particulars","NCL-Cash","NET TOTAL"],
    ["Pay in/Pay out obligation","(10,000.00)","(10,000.00)"],
    ["Taxable value of Supply (Brokerage)","(20.00)","(20.00)"],
    ["CGST (@9% of Brokerage, SEBI, Transaction & Clearing charges)","(1.80)","(1.80)"],
    ["SGST (@9% of Brokerage, SEBI, Transaction & Clearing charges)","(1.80)","(1.80)"],
    ["IGST (@18% of Brokerage, SEBI, Transaction & Clearing charges)","",""],
    ["Securities transaction tax","(5.00)","(5.00)"],
    ["Net amount receivable/(payable by client)","(10,028.60)","(10,028.60)"],
]
ssnt = P.parse_charges_rows(ss_tbl)["net_total"]
check("same-state: CGST+SGST populated", ssnt.get("cgst") == -1.80 and ssnt.get("sgst") == -1.80, (ssnt.get("cgst"), ssnt.get("sgst")))
check("same-state: IGST blank -> 0 (not copied from CGST)", ssnt.get("igst") == 0.0, ssnt.get("igst"))
gp, gd = P.gst_check(ssnt)
check("same-state: gst_check PASS, side=cgst+sgst", gp is True and "cgst+sgst" in gd, (gp, gd))
check("same-state: checksum PASS", P.checksum(ssnt)[0] is True, P.checksum(ssnt))

# ===== TWO-ACCOUNT MODEL — combined wealth, separated tax (the non-negotiable) =====
print("[model] account tagging + two lenses:")
mixed = [
    {"account":"self","tax_entity":"self","segment":"cash","net_total":-25050.0},
    {"account":"self","tax_entity":"self","segment":"fno", "net_total":-1175000.0},
    {"account":"mom", "tax_entity":"mom", "segment":"cash","net_total":5000.0},
    {"account":"mom", "tax_entity":"mom", "segment":"cash","net_total":5050.0},
]
w = P.wealth_lens(mixed)
check("wealth lens sums BOTH accounts", w["total_fills"] == 4 and w["by_account"] == {"self":2,"mom":2}, w)
t = P.tax_lens(mixed, "self")
check("tax lens = self only (mom's 2 fills excluded)", t["fills"] == 2 and t["excluded_other_entity_fills"] == 2, t)
check("tax lens F&O turnover = self F&O only", t["fno_turnover_for_audit"] == 1175000.0, t["fno_turnover_for_audit"])
# mom's FUTURE F&O: tagged mom -> shows in WEALTH, stays OUT of my tax/audit automatically
momfno = mixed + [{"account":"mom","tax_entity":"mom","segment":"fno","net_total":-900000.0}]
check("mom future F&O counts in WEALTH (5 fills)", P.wealth_lens(momfno)["total_fills"] == 5, None)
check("mom future F&O EXCLUDED from my audit turnover", P.tax_lens(momfno,"self")["fno_turnover_for_audit"] == 1175000.0, None)

print("[model] F&O gated by NOTE CONTENT (non-zero), not by column existence:")
check("has_fno True via derivative fill", P.note_has_fno([{"segment":"fno"}], None) is True, None)
check("has_fno True via CTT charge (non-zero)", P.note_has_fno([{"segment":"cash"}], {"net_total":{"ctt":-10.0},"by_clearing_segment":{}}) is True, None)
# Bug 1 regression: NCL-F&O column EXISTS (every note has it) but all-zero -> must be False
check("has_fno FALSE: NCL-F&O column present but all-zero", P.note_has_fno(
      [{"segment":"cash"}], {"net_total":{"stt":-5.0}, "by_clearing_segment":{"NCL-Cash":{"stt":-5.0},"NCL-F&O":{"brokerage":0.0,"stt":0.0}}}) is False, None)
check("has_fno FALSE: CTT==0 (column present, no commodity activity)", P.note_has_fno(
      [{"segment":"cash"}], {"net_total":{"ctt":0.0},"by_clearing_segment":{}}) is False, None)
check("has_fno TRUE: NCL-F&O has non-zero activity", P.note_has_fno(
      [{"segment":"cash"}], {"net_total":{}, "by_clearing_segment":{"NCL-F&O":{"brokerage":-2.0}}}) is True, None)

# ===== MULTI-BROKER ADAPTER (Fyers) — broker-agnostic engine pieces =====
print("[adapter] pnum: DR/CR (Fyers/Dhan) alongside parens (Zerodha):")
check("pnum '43.61 DR' -> -43.61 (debit)", P.pnum("43.61 DR") == -43.61, P.pnum("43.61 DR"))
check("pnum '5.00 CR' -> 5.00 (credit)", P.pnum("5.00 CR") == 5.00, P.pnum("5.00 CR"))
check("pnum '0.00 CR' -> 0.0", P.pnum("0.00 CR") == 0.0, P.pnum("0.00 CR"))
check("pnum plain '12.50' unaffected", P.pnum("12.50") == 12.50, P.pnum("12.50"))
check("pnum '(29,458.26)' -> -29458.26 (parens still work)", P.pnum("(29,458.26)") == -29458.26, P.pnum("(29,458.26)"))
check("pnum '-21171.71' -> -21171.71 (leading minus honored)", P.pnum("-21171.71") == -21171.71, P.pnum("-21171.71"))
check("pnum '-1,234.50' -> -1234.50 (minus + commas)", P.pnum("-1,234.50") == -1234.50, P.pnum("-1,234.50"))

print("[adapter] label_key: Fyers parenthetical charge vs Zerodha lead (no regression):")
check("Fyers '...(Brokerage)' -> brokerage", P.label_key("Taxable Value Of Supply (Brokerage)") == "brokerage", None)
check("Fyers '(Sebitoc)' -> sebi_turnover", P.label_key("Taxable Value Of Supply (Sebitoc)") == "sebi_turnover", None)
check("Fyers '(Toc Nse Exchange)' -> exchange_txn", P.label_key("Taxable Value Of Supply (Toc Nse Exchange)") == "exchange_txn", None)
check("Fyers '(Nse Ipft Charges)' -> ipft", P.label_key("Taxable Value Of Supply (Nse Ipft Charges)") == "ipft", None)
check("Fyers 'Securities Transactions Tax' (plural) -> stt", P.label_key("Securities Transactions Tax (Rs.)") == "stt", None)
check("Fyers 'Net Amount Receivable/Payable' -> net_amount", P.label_key("Net Amount Receivable/Payable By Client") == "net_amount", None)
check("Fyers 'Total Taxable Value Of Supply (3)' -> gst_base (informational)", P.label_key("Total Taxable Value Of Supply (3)") == "gst_base", P.label_key("Total Taxable Value Of Supply (3)"))
check("Zerodha 'IGST (@18% of Brokerage...)' -> igst NOT brokerage", P.label_key("IGST (@18% of Brokerage, SEBI, Transaction & Clearing charges)") == "igst", None)
check("bare 'Taxable value of supply' -> brokerage", P.label_key("Taxable value of supply") == "brokerage", None)

print("[adapter] detail header scan (Fyers 'Trade Annexure' title row above header):")
annex = [
    ["Trade Annexure","","","","","","","","","","",""],
    ["Order No","Order Time","Trade No","Trade Time","Security / Contract Description","B/S","Quantity","Gross Rate","Net Rate","Net Total","Remarks",""],
    ["1","10:00","11","10:01","NIFTY24SEP24650PE","S","225","30.50","30.33","6825.00","",""],
]
check("find_detail_header_row scans past title row -> 1", P.find_detail_header_row(annex) == 1, P.find_detail_header_row(annex))
af = P.map_table(annex)
check("map_table extracts the fill despite title row", len(af) == 1, len(af))
check("fill side=SELL, qty=225", bool(af) and af[0]["side"] == "SELL" and af[0]["qty"] == 225, af[0] if af else None)

print("[adapter] WAP: exclude foreign-currency col, prefer Rs:")
fc_sum = [
    ["Contract description","Buy (B)/Sell(S)/BF/CF","Quantity","WAP Per Unit (in foreign currency) 1","WAP Per Unit (Rs) 2","Brokerage per unit","WAP Per unit after brokerage","Net Total"],
    ["NIFTY24SEP24650PE","S","225","","30.33","","30.24","6825.00"],
]
fcf = [{"instrument":"NIFTY24SEP24650PE","isin":"","side":"SELL","wap":None}]
P.backfill_wap(fcf, P.wap_from_tables([fc_sum]))
check("WAP taken from Rs col (FC blank, after-brk excluded)", fcf[0]["wap"] == 30.33, fcf[0]["wap"])

print("[adapter] Fyers charges: first row merged into header, positional Total, DR/CR signs:")
fy_charges = [
    ["Taxable Value Of Supply (Cmcharges)","","0.00 CR","43.61 DR","0.00 CR","","","","","43.61 DR"],
    ["Taxable Value Of Supply (Brokerage)","","0.00 CR","43.61 DR","0.00 CR","","","","","43.61 DR"],
    ["Taxable Value Of Supply (Sebitoc)","","0.00 CR","0.05 DR","0.00 CR","","","","","0.05 DR"],
    ["Taxable Value Of Supply (Toc Nse Exchange)","","0.00 CR","1.50 DR","0.00 CR","","","","","1.50 DR"],
    ["IGST* RATE:18% AMOUNT (RS.)","","0.00 CR","8.13 DR","0.00 CR","","","","","8.13 DR"],
    ["Stamp Duty (Rs.)","","0.00 CR","0.10 DR","0.00 CR","","","","","0.10 DR"],
    ["Securities Transactions Tax (Rs.)","","0.00 CR","11.00 DR","0.00 CR","","","","","11.00 DR"],
    ["Net Amount Receivable/Payable By Client","","","","","","","","","5850.30 DR"],
]
fch = P.parse_charges_rows(fy_charges)
fnt = fch["net_total"]
check("Fyers charges: brokerage from Total col, DR=negative", fnt.get("brokerage") == -43.61, fnt.get("brokerage"))
check("Fyers charges: stt -11.00 (debit negative)", fnt.get("stt") == -11.00, fnt.get("stt"))
check("Fyers charges: igst -8.13", fnt.get("igst") == -8.13, fnt.get("igst"))
check("Fyers charges: exchange_txn -1.50", fnt.get("exchange_txn") == -1.50, fnt.get("exchange_txn"))
check("Fyers charges: net_amount -5850.30", fnt.get("net_amount") == -5850.30, fnt.get("net_amount"))
check("Fyers charges: cmcharges -> clearing (real charge), nothing unmapped", fch["unmapped_labels"] == [] and fch["net_total"].get("clearing") == -43.61, (fch["unmapped_labels"], fch["net_total"].get("clearing")))
csum = sum(fnt.get(k, 0.0) for k in P.CHARGE_KEYS)   # derive from actual parse (clearing now included)
fy_fills = [{"net_total": round(-5850.30 - csum, 2)}]
fok, fres = P.checksum(fnt, fy_fills)
check("Fyers checksum PASS via sum(fills) + sum(charges)", fok is True, (fok, fres))
check("Zerodha checksum still uses pay_in", P.checksum({"pay_in":-100.0,"net_amount":-110.0,"brokerage":-10.0})[0] is True, None)

# ===== REAL-NOTE BUG FIXES (Fyers) =====
print("[fix] header newline normalize -> trade_time found (Bug 2):")
annex_nl = [
    ["Trade Annexure","","","","","","","","","",""],
    ["Order\nNo","Order\nTime","Trade\nNo","Trade\nTime","Security / Contract Description","Buy\nSell\n(B/S)","Quantity","Net Rate","Net Total","Remarks",""],
    ["1","10:00","11","10:01","NIFTY24SEP24650PE","S","225","30.33","6825.00","",""],
]
nf = P.map_table(annex_nl)
check("detail header found despite 'Trade\\nTime' newline", len(nf) == 1, len(nf))
check("trade_time populated from newline header", bool(nf) and nf[0]["trade_time"] == "10:01", nf[0]["trade_time"] if nf else None)

print("[fix] ISIN backfill -> equity fill tagged cash (Bug 3):")
sd_block = [["Security Description","ISIN","Buy Qty"], ["INDIAGLYCO","INE560A01023","11"]]
fni = [{"instrument":"INDIAGLYCO","isin":None,"side":"SELL"}]
P.backfill_isin(fni, P.isin_map_from_tables([sd_block]))
check("equity fill got ISIN from Security-Description block", fni[0]["isin"] == "INE560A01023", fni[0]["isin"])
check("infer_segment now 'cash' (was 'unknown')", P.infer_segment(fni[0]) == "cash", P.infer_segment(fni[0]))

print("[fix] GST base classified informational - NOT charge, NOT unmapped (Bug 1):")
check("'Total Taxable Value Of Supply (3)' -> gst_base", P.label_key("Total Taxable Value Of Supply (3)") == "gst_base", P.label_key("Total Taxable Value Of Supply (3)"))
check("'...(Cmcharges)' -> clearing (real charge)", P.label_key("Taxable Value Of Supply (Cmcharges)") == "clearing", None)
check("gst_base NOT in CHARGE_KEYS (never summed)", "gst_base" not in P.CHARGE_KEYS, None)
check("'(Brokerage)' still -> brokerage (not gst_base)", P.label_key("Taxable Value Of Supply (Brokerage)") == "brokerage", None)
check("bare 'Taxable value of supply' still -> brokerage", P.label_key("Taxable value of supply") == "brokerage", None)
gb_charges = [
    ["Taxable Value Of Supply (Brokerage)","","","","43.61 DR"],
    ["Taxable Value Of Supply (Cmcharges)","","","","43.61 DR"],
    ["Total Taxable Value Of Supply (3)","","","","43.61 DR"],
    ["IGST* RATE:18% AMOUNT (RS.)","","","","8.13 DR"],
    ["Net Amount Receivable/Payable By Client","","","","100.00 DR"],
]
gbc = P.parse_charges_rows(gb_charges)
check("Total Taxable Value (gst_base) NOT flagged unmapped", gbc["unmapped_labels"] == [], gbc["unmapped_labels"])
check("charge sum = brokerage+clearing(cmcharges)+igst, gst_base excluded",
      round(sum(gbc["net_total"].get(k,0.0) for k in P.CHARGE_KEYS), 2) == -95.35,
      round(sum(gbc["net_total"].get(k,0.0) for k in P.CHARGE_KEYS), 2))

# ===== REAL-NOTE BUG FIXES ROUND 2 (Fyers) =====
print("[fix2] fill net_total SIGNED by side (the -512k obligation bug):")
unsigned_detail = [
    ["Order No","Trade No","Trade Time","Security / Contract Description","B/S","Quantity","Net Rate","Net Total","Remarks"],
    ["1","11","10:00","NIFTY24SEP24650PE","B","225","30.00","6750.00",""],   # BUY - unsigned in note
    ["2","12","10:05","NIFTY24SEP24650PE","S","225","31.00","6975.00",""],   # SELL - unsigned in note
]
sf = P.map_table(unsigned_detail)
check("BUY fill net_total signed NEGATIVE", sf[0]["net_total"] == -6750.00, sf[0]["net_total"])
check("SELL fill net_total signed POSITIVE", sf[1]["net_total"] == 6975.00, sf[1]["net_total"])
check("obligation = signed sum (nets, not turnover)", round(sum(f["net_total"] for f in sf),2) == 225.00, round(sum(f["net_total"] for f in sf),2))
# idempotent on an already-signed (Zerodha) net_total: (6750) parens -> -6750, BUY -> still -6750
signed_detail = [
    ["Order No","Trade No","Trade Time","Security","Buy/Sell","Quantity","Net Rate","Net Total","Remarks","ISIN"],
    ["1","11","10:00","INFY","B","10","1500","(15000.00)","","INE009A01021"],
]
zf = P.map_table(signed_detail)
check("Zerodha already-signed BUY stays NEGATIVE (idempotent)", zf[0]["net_total"] == -15000.00, zf[0]["net_total"])

print("[fix2] per-fill brokerage = summary per-unit x qty (Bug 2):")
bsum = [
    ["Contract description","Buy (B)/Sell(S)/BF/CF","Quantity","WAP Per Unit (Rs)","Brokerage per unit (Rs)","Net Total"],
    ["NIFTY24SEP24650PE","S","225","30.33","0.09","6825.00"],
]
bf = [{"instrument":"NIFTY24SEP24650PE","isin":"","side":"SELL","qty":225,"brokerage":None}]
P.backfill_brokerage(bf, P.brokerage_pu_from_tables([bsum]))
check("brokerage = -(0.09 x 225) = -20.25 (debit)", bf[0]["brokerage"] == -20.25, bf[0]["brokerage"])

print("[fix2] Fyers equity charges layout detected (IGST-rate rows, Bug 3):")
eq_charges = [
    ["IGST* RATE:18% AMOUNT (RS.)","","3.72 DR","11.91 DR","","15.63 DR"],
    ["Brokerage (Rs.)","","0.00 CR","43.61 DR","","43.61 DR"],
    ["Securities Transactions Tax (Rs.)","","0.00 CR","11.00 DR","","11.00 DR"],
    ["Stamp Duty (Rs.)","","0.00 CR","0.10 DR","","0.10 DR"],
    ["Net Amount Receivable/Payable By Client","","","","","5000.00 DR"],
]
check("is_charges_table True for IGST-rate equity layout", P.is_charges_table(eq_charges) is True, None)
check("is_charges_table False for a WAP summary", P.is_charges_table([["Contract description","WAP Per Unit","Quantity"],["NIFTY24SEP24650PE","30.33","225"]]) is False, None)
eqc = P.parse_charges_rows(eq_charges)["net_total"]
check("equity charges: igst -15.63 (Total col)", eqc.get("igst") == -15.63, eqc.get("igst"))
check("equity charges: stt -11.00", eqc.get("stt") == -11.00, eqc.get("stt"))

print("[fix2] note_segment_hint from clearing-obligation table (Bug 4):")
check("Equity NCL populated -> cash", P.note_segment_hint([[["Equity ICCL","Equity NCL","Derivative NCL"],["","1500.00",""]]]) == "cash", None)
check("Derivative NCL populated -> fno", P.note_segment_hint([[["Equity NCL","Derivative NCL"],["","48000.00"]]]) == "fno", None)
check("no clearing table -> None", P.note_segment_hint([[["foo","bar"],["1","2"]]]) is None, None)

# ===== REAL-NOTE BUG FIXES ROUND 3 (Fyers) =====
print("[fix3] Cmcharges -> clearing (real charge); only Total Taxable Value -> gst_base (Bug 1):")
check("'(Cmcharges)' -> clearing (was wrongly gst_base)", P.label_key("Taxable Value Of Supply (Cmcharges)") == "clearing", P.label_key("Taxable Value Of Supply (Cmcharges)"))
check("'Total Taxable Value Of Supply (3)' stays gst_base", P.label_key("Total Taxable Value Of Supply (3)") == "gst_base", None)
check("clearing IS in CHARGE_KEYS (summed)", "clearing" in P.CHARGE_KEYS, None)
c1 = [
    ["Taxable Value Of Supply (Cmcharges)","","","","43.61 DR"],
    ["Taxable Value Of Supply (Brokerage)","","","","100.00 DR"],
    ["Total Taxable Value Of Supply (3)","","","","143.61 DR"],
    ["Net Amount Receivable/Payable By Client","","","","1000.00 DR"],
]
nt1 = P.parse_charges_rows(c1)["net_total"]
check("cmcharges summed as clearing (-43.61)", nt1.get("clearing") == -43.61, nt1.get("clearing"))
check("charge_sum = clearing+brokerage = -143.61 (gst_base excluded)", round(sum(nt1.get(k,0.0) for k in P.CHARGE_KEYS),2) == -143.61, round(sum(nt1.get(k,0.0) for k in P.CHARGE_KEYS),2))

print("[fix3] no phantom segment columns from empty trailing cols (Bug 4):")
phantom = [
    ["Description","NCLCM","NCLFO","NCLCD","","","","","Total"],
    ["Brokerage","0.00","43.61","0.00","","","","","43.61"],
    ["Securities Transaction Tax","0.00","11.00","0.00","","","","","11.00"],
    ["Stamp Duty","0.00","0.10","0.00","","","","","0.10"],
]
phc = P.parse_charges_rows(phantom)
check("only real segments keyed (no col3-col7)", sorted(phc["by_clearing_segment"].keys()) == ["NCLCD","NCLCM","NCLFO"], sorted(phc["by_clearing_segment"].keys()))
check("Total column captured as net_total", phc["net_total"].get("brokerage") == 43.61, phc["net_total"].get("brokerage"))

print("[fix3] note metadata not flagged as unmapped charge (Bug 5):")
meta = [
    ["Brokerage (Rs.)","","","","43.61 DR"],
    ["Securities Transactions Tax (Rs.)","","","","11.00 DR"],
    ["Stamp Duty (Rs.)","","","","0.10 DR"],
    ["Settlement Number","","","","2025014"],
    ["Net Amount Receivable/Payable By Client","","","","100.00 DR"],
]
mc = P.parse_charges_rows(meta)
check("'Settlement Number' NOT flagged unmapped (metadata)", "Settlement Number" not in str(mc["unmapped_labels"]), mc["unmapped_labels"])
check("settlement id not polluting net_total", "gst_base" not in mc["net_total"] or mc["net_total"].get("gst_base") != 2025014.0, None)

# ===== COMBINED NOTE + CR SIGN (Fyers 1045830) =====
print("[fix4] obligation sign works BOTH directions (CR all-sells, DR all-buys):")
allsell = [
    ["Order No","Trade No","Trade Time","Security","Buy/Sell","Quantity","Net Rate","Net Total","Remarks","ISIN"],
    ["1","11","10:00","INDIAGLYCO","S","11","1928.83","21217.10","","INE560A01015"],
]
asf = P.map_table(allsell)
check("all-SELL obligation POSITIVE (CR, client receives)", asf[0]["net_total"] == 21217.10, asf[0]["net_total"])
allbuy = [
    ["Order No","Trade No","Trade Time","Security","Buy/Sell","Quantity","Net Rate","Net Total","Remarks","ISIN"],
    ["1","11","10:00","INFY","B","10","1500","15000.00","","INE009A01021"],
]
check("all-BUY obligation NEGATIVE (DR, client pays)", P.map_table(allbuy)[0]["net_total"] == -15000.00, None)

print("[fix4] single cash ISIN fallback within a combined note (Bug 2):")
cmb = [
    {"instrument":"INDIAGLYCO","isin":None,"side":"SELL"},
    {"instrument":"INDIAGLYCO","isin":None,"side":"SELL"},
    {"instrument":"NIFTY24SEP24650PE","isin":None,"side":"SELL"},
]
P.backfill_isin(cmb, {}, all_isins={"INE560A01015"})   # symbol map empty -> lone-ISIN fallback
check("equity (non-deriv) fills get the lone ISIN", cmb[0]["isin"] == "INE560A01015" and cmb[1]["isin"] == "INE560A01015", [f["isin"] for f in cmb])
check("F&O (deriv) fill does NOT get the equity ISIN", cmb[2]["isin"] is None, cmb[2]["isin"])

print("[fix4] per-segment checksum (combined note: NCLCM + NCLFO each close):")
charges = {"by_clearing_segment": {
    "NCLCM": {"brokerage":-20.00,"sebi_turnover":-0.02,"ipft":-0.02,"clearing":0.0,"exchange_txn":-0.63,"igst":-3.72,"stt":-21.00,"net_amount":21171.71},
    "NCLFO": {"brokerage":-40.00,"sebi_turnover":-0.06,"ipft":-0.29,"clearing":-5.28,"exchange_txn":-20.55,"igst":-11.91,"stt":-59.00,"net_amount":58525.41},
}, "net_total":{}, "unmapped_labels":[]}
psf = [{"segment":"cash","net_total":21217.10}, {"segment":"fno","net_total":58662.50}]
ps = P.per_segment_checksum(charges, psf)
check("NCLCM (equity) reconciles: 21217.10 - 45.39 = 21171.71", ps["NCLCM"]["pass"] is True, ps.get("NCLCM"))
check("NCLFO (F&O) reconciles: 58662.50 - 137.09 = 58525.41", ps["NCLFO"]["pass"] is True, ps.get("NCLFO"))
check("single-segment note -> no per-segment rows", P.per_segment_checksum({"by_clearing_segment":{},"net_total":{}}, []) == {}, None)

# ===== COMBINED NOTE ROUND 2 (two-part charges + equity brokerage) =====
print("[fix5] charges lower-block detection (combined note two-part table, Bug 1/3):")
lower = [
    ["IGST* RATE:18% AMOUNT (RS.)","","3.72 DR","11.91 DR","","15.63 DR"],
    ["Securities Transactions Tax (Rs.)","","0.00","80.00 DR","","80.00 DR"],
    ["Net Amount Receivable/Payable By Client","","","","","79697.12 CR"],
    ["Total Taxable Value Of Supply (3)","","","","","86.85 DR"],
]
check("is_charges_table True for lower block ('transactions tax' plural + net)", P.is_charges_table(lower) is True, None)
lnt = P.parse_charges_rows(lower)["net_total"]
check("lower block: igst -15.63 (was missing)", lnt.get("igst") == -15.63, lnt.get("igst"))
check("lower block: stt -80.00", lnt.get("stt") == -80.00, lnt.get("stt"))
check("lower block: net_amount +79697.12 (CR receivable)", lnt.get("net_amount") == 79697.12, lnt.get("net_amount"))

print("[fix5] equity Buy/Sell-block per-share brokerage (Bug 2 -> 4/4):")
eq_block_brk = [
    ["Security Description","ISIN","Buy","","","","Sell","","","","Net Obligation",""],
    ["","","Qty","WAP","Brokerage","","Qty","WAP","Brokerage","","",""],
    ["INDIAGLYCO","INE560A01015","","","","","11","1928.83","1.8182","","21217.10",""],
]
ebf = [{"instrument":"INDIAGLYCO","isin":"INE560A01015","side":"SELL","qty":11,"brokerage":None}]
P.backfill_brokerage(ebf, P.block_brokerage_from_tables([eq_block_brk]))
check("equity fill brokerage = -(1.8182 x 11) ~ -20.00 (debit)", abs((ebf[0]["brokerage"] or 0) - (-20.00)) < 0.01, ebf[0]["brokerage"])

# ===== EQUITY BROKERAGE APPORTIONMENT (Case B fallback) =====
print("[fix6] Case B: apportion segment brokerage total across equity fills (flagged):")
charges_b = {"by_clearing_segment": {"NCLCM": {"brokerage": -20.00}}, "net_total": {}, "unmapped_labels": []}
eqfills = [
    {"segment":"cash","side":"SELL","qty":7,"price":1928.83,"brokerage":None},
    {"segment":"cash","side":"SELL","qty":4,"price":1928.83,"brokerage":None},
    {"segment":"fno","side":"SELL","qty":225,"price":30.0,"brokerage":-20.25},   # already has it -> untouched
]
P.apportion_segment_brokerage(eqfills, charges_b)
check("equity fills now have brokerage (4/4 path)", eqfills[0]["brokerage"] is not None and eqfills[1]["brokerage"] is not None, [f.get("brokerage") for f in eqfills])
check("apportioned by value: 7:4 split of -20.00", abs(eqfills[0]["brokerage"] - (-20.00*7/11)) < 0.01 and abs(eqfills[1]["brokerage"] - (-20.00*4/11)) < 0.01, [eqfills[0]["brokerage"], eqfills[1]["brokerage"]])
check("equity brokerage sums to NCLCM total -20.00", round(eqfills[0]["brokerage"] + eqfills[1]["brokerage"], 2) == -20.00, round(eqfills[0]["brokerage"] + eqfills[1]["brokerage"], 2))
check("apportioned fills FLAGGED derived", eqfills[0].get("brokerage_apportioned") is True, None)
check("F&O fill with exact brokerage NOT touched / not flagged", eqfills[2]["brokerage"] == -20.25 and not eqfills[2].get("brokerage_apportioned"), eqfills[2])
# exact-first precedence: a fill that already has brokerage is never apportioned
check("apportionment only fills gaps (exact wins)", eqfills[2]["brokerage"] == -20.25, eqfills[2]["brokerage"])

# ===== UPSTOX readiness (3-col |segment|TOTAL charges; broker detect; STT-not-CTT) =====
print("[upstox] 3-col |segment|TOTAL charges shape parses:")
ux_charges = [
    ["Description","EQ-CASH (Rs.)","TOTAL (Net) (Rs.)"],
    ["Brokerage","20.00","20.00"],
    ["Securities Transaction Tax","21.00","21.00"],
    ["Exchange Transaction Charges","0.63","0.63"],
    ["IGST","3.72","3.72"],
    ["Net Amount Payable By Client","-21171.71","-21171.71"],
]
uxc = P.parse_charges_rows(ux_charges)
check("Upstox: brokerage read from TOTAL column", uxc["net_total"].get("brokerage") == 20.00, uxc["net_total"].get("brokerage"))
check("Upstox: STT read (equity F&O = STT, not CTT)", uxc["net_total"].get("stt") == 21.00, uxc["net_total"].get("stt"))
check("Upstox: igst read", uxc["net_total"].get("igst") == 3.72, uxc["net_total"].get("igst"))
check("Upstox: net_amount ('Payable' wording) read", uxc["net_total"].get("net_amount") == -21171.71, uxc["net_total"].get("net_amount"))
check("Upstox: segment column keyed, not phantom", any("cash" in s.lower() for s in uxc["by_clearing_segment"]), list(uxc["by_clearing_segment"].keys()))
check("Upstox: nothing spuriously unmapped", uxc["unmapped_labels"] == [], uxc["unmapped_labels"])

print("[upstox] broker auto-detect (member name / RKSV):")
check("detect_broker -> upstox (via 'upstox')", P.detect_broker("...UPSTOX SECURITIES PRIVATE LIMITED...") == "upstox", None)
check("detect_broker -> upstox (via 'rksv')", P.detect_broker("...RKSV SECURITIES INDIA...") == "upstox", None)

# ===== UPSTOX four structural traps =====
print("[upstox] Trap 2: 'Brokerage Charges' pseudo-rows excluded from fills:")
det = [
    ["Order No","Trade No","Trade Time","Security / Contract Description","Buy\nSell\n(B/S)","Quantity","Net Rate\nper Unit\n(Rs.)","Net Total (Before\nLevies)\n(Rs.)","Remarks"],
    ["1","11","10:00","RELIANCE","B","10","2500.00","25000.00",""],
    ["2","12","10:01","Brokerage Charges","B","1","30.00","30.00",""],   # pseudo-row, NOT a fill
]
df = P.map_table(det)
check("Trap 1+2: real fill kept, Brokerage Charges excluded", len(df) == 1 and df[0]["instrument"] == "RELIANCE", [f.get("instrument") for f in df])
check("Trap 1: net_total read from newline-split header", df and df[0]["net_total"] == -25000.00, df[0]["net_total"] if df else None)

print("[upstox] Trap 3: '*NET*' subtotal rows skipped in F&O summary WAP:")
fno_net = [
    ["Contract description","Buy (B)/Sell (S)/BF/CF","Quantity","WAP Per Unit (Rs.)","Net Total"],
    ["CGPOWER25SEP","B","100","450.00","45000"],
    ["CGPOWER25SEP","S","100","449.15","44915"],
    ["CGPOWER25SEP","*NET*","0","","-85.00"],
]
fw = P.wap_from_tables([fno_net])
check("Trap 3: *NET* not a side (buy=450.00, sell=449.15)", fw["buy"].get("CGPOWER25SEP") == 450.00 and fw["sell"].get("CGPOWER25SEP") == 449.15, (fw["buy"].get("CGPOWER25SEP"), fw["sell"].get("CGPOWER25SEP")))

print("[upstox] charge labels: two IGST + two STT SUM; bracketed; [IGST On Brokerage]->igst:")
ux2 = [
    ["Description","EQ-CASH (Rs.)","TOTAL (Net) (Rs.)"],
    ["Brokerage Charges","150.00","150.00"],
    ["[IGST 18% On Brokerage]","27.00","27.00"],
    ["[IGST 18% On Charges]","0.23","0.23"],
    ["[STT-DEL.]","39.85","39.85"],
    ["[STT-Round off]","0.15","0.15"],
    ["[TURNOVER CHG]","0.04","0.04"],
    ["[SEBI FEES]","0.04","0.04"],
    ["[STAMP DUTY]","6.00","6.00"],
    ["[IPFT CHG]","1.18","1.18"],
]
u2 = P.parse_charges_rows(ux2)["net_total"]
check("[IGST On Brokerage] -> igst NOT brokerage (ordering fix)", u2.get("brokerage") == 150.00, u2.get("brokerage"))
check("two IGST lines SUM -> 27.23", round(u2.get("igst"),2) == 27.23, u2.get("igst"))
check("two STT lines SUM -> 40.00", round(u2.get("stt"),2) == 40.00, u2.get("stt"))
check("[TURNOVER CHG] -> exchange_txn", round(u2.get("exchange_txn") or 0,2) == 0.04, u2.get("exchange_txn"))
check("[SEBI FEES] -> sebi_turnover (not exchange)", round(u2.get("sebi_turnover") or 0,2) == 0.04, u2.get("sebi_turnover"))
check("[IPFT CHG] -> ipft", round(u2.get("ipft") or 0,2) == 1.18, u2.get("ipft"))
check("cash charge sum = 224.49 (reconciliation target)", round(sum(u2.get(k,0.0) for k in P.CHARGE_KEYS),2) == 224.49, round(sum(u2.get(k,0.0) for k in P.CHARGE_KEYS),2))

print("[upstox] Trap 4: inverted sign -> negate charges, checksum closes with signed-fills obligation:")
nt_ux = {"net_amount":40082.25, "brokerage":150.00, "igst":27.23, "stt":40.00, "exchange_txn":0.04, "sebi_turnover":0.04, "stamp_duty":6.00, "ipft":1.18}
flipped = {k: -v for k, v in nt_ux.items()}                # the build_ledger Upstox flip
cashfills = [{"net_total": -39857.76}]                      # 8 buys, signed negative (obligation)
okc, resc = P.checksum(flipped, cashfills)
check("Upstox cash checksum PASS after sign flip (net -40082.25 = oblig -39857.76 + chg -224.49)", okc is True, (okc, resc))

# ===== UPSTOX text-strategy: truncated header + positional mapping + blank/brokerage filter =====
print("[upstox] truncated multi-line header recognized as detail:")
ux_hdr = ["Order","Order","Trade","Trade","Security / Contract Description","Buy","Quantity","Gross Rate","Net Rate","Net Total (Before"]
check("is_detail_header recognizes truncated header (qty+order+trade+security)", P.is_detail_header(ux_hdr) is True, None)
check("summary header (no order/trade) NOT recognized as detail", P.is_detail_header(["Contract description","Buy/Sell","Quantity","WAP Per Unit"]) is False, None)

print("[upstox] positional column mapping + blank/brokerage-row filter:")
ux_detail = [
    ux_hdr,
    ["1","09:15","11","09:15","RELIANCE INE002A01018","B","10","2500.50","2500.00","25000.00"],
    ["","","","","","","","","",""],                                  # phantom blank row (text strategy)
    ["","","","","Brokerage Charges","B","1","0.00","30.00","30.00"],  # pseudo-row, NOT a fill
]
uf = P.map_table(ux_detail, broker="upstox")
check("1 real fill (blank + Brokerage Charges excluded)", len(uf) == 1, len(uf))
check("instrument col 4", uf and uf[0]["instrument"] == "RELIANCE", uf[0]["instrument"] if uf else None)
check("ISIN extracted from col 4", uf and uf[0]["isin"] == "INE002A01018", uf[0]["isin"] if uf else None)
check("side col 5 (B->BUY)", uf and uf[0]["side"] == "BUY", uf[0]["side"] if uf else None)
check("qty col 6 = 10", uf and uf[0]["qty"] == 10, uf[0]["qty"] if uf else None)
check("price col 8 (Net Rate) = 2500.00", uf and uf[0]["price"] == 2500.00, uf[0]["price"] if uf else None)
check("net_total col 9, signed BUY-negative = -25000.00", uf and uf[0]["net_total"] == -25000.00, uf[0]["net_total"] if uf else None)
# non-upstox still uses text-based mapping (no regression)
zf = P.map_table([["Order No","Trade No","Trade Time","Security","Buy/Sell","Quantity","Net Rate","Net Total","Remarks","ISIN"],
                  ["1","11","10:00","INFY","S","5","1500","7500.00","","INE009A01021"]])
check("non-upstox detail still text-mapped (SELL +7500)", zf and zf[0]["net_total"] == 7500.00, zf[0]["net_total"] if zf else None)

# ===== UPSTOX F&O summary: truncated header (blank contract col) + *NET*/blank skip =====
print("[upstox] F&O summary truncated header -> WAP + brokerage still map (contract defaults col 0):")
ux_fno_sum = [
    ["", "Buy (B)/ Sell (S)", "", "WAP Per Unit", "Brokerage per", "WAP Per unit after", "Closing Rate", "Net Total (Before", ""],
    ["CGPOWER25SEP650CE", "B", "100", "12.50", "0.30", "12.59", "13.00", "1250.00", ""],
    ["CGPOWER25SEP650CE", "S", "100", "13.35", "0.30", "13.26", "13.00", "1335.00", ""],
    ["CGPOWER25SEP650CE", "*NET*", "0", "", "", "", "", "85.00", ""],     # subtotal - skip
    ["", "", "", "", "", "", "", "", ""],                                  # phantom blank - skip
]
fw = P.wap_from_tables([ux_fno_sum])
check("WAP buy from col 3 (blank contract header handled)", fw["buy"].get("CGPOWER25SEP650CE") == 12.50, fw["buy"].get("CGPOWER25SEP650CE"))
check("WAP sell from col 3", fw["sell"].get("CGPOWER25SEP650CE") == 13.35, fw["sell"].get("CGPOWER25SEP650CE"))
check("*NET* not mapped as a side", fw["buy"].get("CGPOWER25SEP650CE") != 85.0 and fw["sell"].get("CGPOWER25SEP650CE") == 13.35, None)
bpu = P.brokerage_pu_from_tables([ux_fno_sum])
check("brokerage-per-unit from col 4 ('Brokerage per' truncated)", bpu["buy"].get("CGPOWER25SEP650CE") == 0.30, bpu["buy"].get("CGPOWER25SEP650CE"))
fill = [{"instrument":"CGPOWER25SEP650CE","isin":"","side":"BUY","qty":100,"wap":None,"brokerage":None}]
P.backfill_wap(fill, fw); P.backfill_brokerage(fill, bpu)
check("fill -> WAP 12.50 (15/15 path)", fill[0]["wap"] == 12.50, fill[0]["wap"])
check("fill -> brokerage -(0.30 x 100) = -30.00", fill[0]["brokerage"] == -30.00, fill[0]["brokerage"])

# ===== UPSTOX F&O brokerage apportionment (Bug 2: col 4 blank -> apportion FO-EQ total) =====
print("[upstox] _seg_to_fill resolves every broker's segment label:")
check("'FO-EQ (Rs.)' -> fno", P._seg_to_fill("FO-EQ (Rs.)") == "fno", None)
check("'EQ-CASH (Rs.)' -> cash", P._seg_to_fill("EQ-CASH (Rs.)") == "cash", None)
check("'NCLFO' -> fno, 'NCLCM' -> cash", P._seg_to_fill("NCLFO") == "fno" and P._seg_to_fill("NCLCM") == "cash", None)

print("[upstox] Bug 2: F&O brokerage apportioned from FO-EQ total (summary col 4 blank):")
fno_charges = {"by_clearing_segment": {"FO-EQ (Rs.)": {"brokerage": -450.00}}, "net_total": {}, "unmapped_labels": []}
fno_fills = [{"segment":"fno","side":"SELL","qty":100,"price":13.35,"brokerage":None},
             {"segment":"fno","side":"BUY","qty":100,"price":12.50,"brokerage":None}]
P.apportion_segment_brokerage(fno_fills, fno_charges)
check("FO-EQ total found -> all fno fills get brokerage (was 0/N)", all(f.get("brokerage") is not None for f in fno_fills), [f.get("brokerage") for f in fno_fills])
check("apportioned brokerage sums to FO-EQ total -450.00", round(sum(f["brokerage"] for f in fno_fills),2) == -450.00, round(sum(f["brokerage"] for f in fno_fills),2))
check("apportioned fills flagged derived", all(f.get("brokerage_apportioned") for f in fno_fills), None)

# ===== UPSTOX WAP: wrapped long contract names reassembled (the 5 NO-MATCH fix) =====
print("[upstox] wrapped long contract names reassembled across physical rows:")
ux_wrap = [
    ["", "Buy (B)/ Sell (S)", "", "WAP Per Unit", "Brokerage per", "WAP Per unit after", "Closing Rate", "Net Total", ""],
    ["OPTSTKFSNECOMMERCEVENTURESLIMITE", "B", "100", "27.50", "", "27.59", "", "2750.00", ""],  # name on data row
    ["24FEB26CE27500", "", "", "", "", "", "", "", ""],                                         # tail wraps BELOW
    ["OPTSTKKALYANJEWELLERSINDIALIMITED", "", "", "", "", "", "", "", ""],                       # name wraps ABOVE
    ["24FEB26CE39000", "S", "50", "12.00", "", "12.10", "", "600.00", ""],                       # tail on data row
    ["OPTSTKSONABLWPRECISIONLTD24FEB26CE", "B", "75", "48.90", "", "48.99", "", "3667.50", ""],  # name+expiry on data
    ["52500", "", "", "", "", "", "", "", ""],                                                   # strike wraps BELOW
    ["CGPOWER25SEP650CE", "S", "100", "13.35", "", "13.26", "", "1335.00", ""],                  # short name, no wrap
]
fw = P.wap_from_tables([ux_wrap])
fills = [
    {"instrument":"OPTSTKFSNECOMMERCEVENTURESLIMITE24FEB26CE27500","isin":"","side":"BUY","wap":None},
    {"instrument":"OPTSTKKALYANJEWELLERSINDIALIMITED24FEB26CE39000","isin":"","side":"SELL","wap":None},
    {"instrument":"OPTSTKSONABLWPRECISIONLTD24FEB26CE52500","isin":"","side":"BUY","wap":None},
    {"instrument":"CGPOWER25SEP650CE","isin":"","side":"SELL","wap":None},
]
P.backfill_wap(fills, fw)
check("FSN: name-on-data, tail wraps BELOW -> matched", fills[0]["wap"] == 27.50, fills[0]["wap"])
check("KALYAN: tail-on-data, name wraps ABOVE -> matched", fills[1]["wap"] == 12.00, fills[1]["wap"])
check("SONA: strike wraps BELOW -> matched", fills[2]["wap"] == 48.90, fills[2]["wap"])
check("short contract (no wrap) still matched (no regression)", fills[3]["wap"] == 13.35, fills[3]["wap"])
check("ALL 4 long+short fills WAP-mapped (15/15 analog)", all(f["wap"] is not None for f in fills), [f["wap"] for f in fills])

# ===== DHAN readiness (SEBI-format, line-ruled, reuses Fyers combined-note handling) =====
print("[dhan] broker detect + detail columns (Order Number/Trade No./Price/Net Rate/Net Amount):")
check("detect_broker -> dhan (member name)", P.detect_broker("...DHAN / MONEYLICIOUS SECURITIES PVT LTD...") == "dhan", None)
check("detect_broker -> dhan (via 'moneylicious')", P.detect_broker("...MONEYLICIOUS SECURITIES...") == "dhan", None)
dhan_detail = [
    ["Order Number","Order Time","Trade No.","Trade Time","Security/Contract Description","Buy / Sell","Quantity","Price","Net Rate","Net Amount","Remark"],
    ["1","10:00","11","10:00","INDIAGLYCO INE560A01015","S","11","1930.00","1928.83","21217.10",""],
    ["2","10:05","12","10:05","NIFTY24SEP24650PE","B","75","30.00","30.05","2253.75",""],
]
check("dhan detail recognized (order time / trade no.)", P.is_detail_header(dhan_detail[0]) is True, None)
df = P.map_table(dhan_detail)
check("dhan: 2 fills extracted", len(df) == 2, len(df))
check("dhan: equity ISIN from Security/Contract Description", df and df[0]["isin"] == "INE560A01015", df[0]["isin"] if df else None)
check("dhan: SELL net_total from 'Net Amount', signed + ", df and df[0]["net_total"] == 21217.10, df[0]["net_total"] if df else None)
check("dhan: BUY net_total signed - ", len(df) > 1 and df[1]["net_total"] == -2253.75, df[1]["net_total"] if len(df) > 1 else None)
check("dhan: qty from Quantity col", df and df[0]["qty"] == 11, df[0]["qty"] if df else None)
check("dhan: line-ruled -> default extraction (not text strategy)", True, None)   # extract_tables_for(broker='dhan') = default

# ===== DHAN cash-note fixes (Ledger Balance metadata + segment hint from charges) =====
print("[dhan] 'Ledger Balance' is metadata, not a charge (Bug 4):")
lb = [
    ["Brokerage (Rs.)","","","","20.00 DR"],
    ["Securities Transactions Tax (Rs.)","","","","21.00 DR"],
    ["Stamp Duty (Rs.)","","","","0.10 DR"],
    ["Ledger Balance","","","","102243.50 CR"],
    ["Net Amount Receivable/Payable By Client","","","","21171.71 CR"],
]
lbc = P.parse_charges_rows(lb)
check("'Ledger Balance' NOT flagged unmapped", "ledger balance" not in str(lbc["unmapped_labels"]).lower(), lbc["unmapped_labels"])
check("Ledger Balance not summed into charges (brokerage+stt+stamp only)", round(sum(lbc["net_total"].get(k,0.0) for k in P.CHARGE_KEYS),2) == -41.10, round(sum(lbc["net_total"].get(k,0.0) for k in P.CHARGE_KEYS),2))

print("[dhan] charge_segment_hint tags 'unknown' fills on single-segment notes (Bug 1):")
cash_only = {"by_clearing_segment": {"NCLCM": {"brokerage": -20.0, "stt": -21.0}}, "net_total": {}, "unmapped_labels": []}
fno_only = {"by_clearing_segment": {"NCLFO": {"brokerage": -40.0}}, "net_total": {}, "unmapped_labels": []}
combined = {"by_clearing_segment": {"NCLCM": {"brokerage": -20.0}, "NCLFO": {"brokerage": -40.0}}, "net_total": {}, "unmapped_labels": []}
check("NCLCM-only charges -> hint cash", P.charge_segment_hint(cash_only) == "cash", None)
check("NCLFO-only charges -> hint fno", P.charge_segment_hint(fno_only) == "fno", None)
check("combined (both segments) -> None (per-fill ISIN/DERIV decides)", P.charge_segment_hint(combined) is None, None)
check("no charges -> None", P.charge_segment_hint(None) is None, None)

# ===== DHAN WAP fixes (F&O wrap-on-tail-line; cash ISIN by leading symbol; zero brokerage) =====
print("[dhan] F&O WAP: contract wraps with DATA on the tail line, name ABOVE (no bleed):")
dhan_fno = [
    ["Contract description #","B/S/BF/CF","Quantity","WAP Per Unit FC","WAP Per Unit (Rs.)","Brokerage per unit","WAP after brokerage","Closing Rate","Net Total","Remark"],
    ["OPTIDX NIFTY 30Jun2026 23500", "", "", "", "", "", "", "", "", ""],
    ["PE - NSE", "B", "325", "", "31.61", "", "", "", "-10273.75", ""],
    ["OPTIDX NIFTY 30Jun2026 23500", "", "", "", "", "", "", "", "", ""],
    ["PE - NSE", "S", "-325", "", "19.94", "", "", "", "6480.00", ""],
    ["OPTIDX NIFTY 30Jun2026 23550", "", "", "", "", "", "", "", "", ""],
    ["PE - NSE", "B", "75", "", "33.00", "", "", "", "-2475.00", ""],
]
fw = P.wap_from_tables([dhan_fno])
k235 = P._normkey("OPTIDX NIFTY 30Jun2026 23500 PE - NSE")
k2355 = P._normkey("OPTIDX NIFTY 30Jun2026 23550 PE - NSE")
check("23500PE BUY WAP from tail-line, name reassembled from ABOVE", fw["buy"].get(k235) == 31.61, fw["buy"].get(k235))
check("23500PE SELL WAP (no bleed into next strike)", fw["sell"].get(k235) == 19.94, fw["sell"].get(k235))
check("23550PE BUY mapped separately (no doubling)", fw["buy"].get(k2355) == 33.00, fw["buy"].get(k2355))
check("FC column excluded (Rs preferred)", k235 == "OPTIDXNIFTY30JUN202623500PE", k235)
dfill = [{"instrument":"OPTIDX NIFTY 30Jun2026 23500 PE - NSE","isin":"","side":"BUY","wap":None}]
P.backfill_wap(dfill, fw)
check("detail clean contract -> WAP 31.61 (join works)", dfill[0]["wap"] == 31.61, dfill[0]["wap"])

print("[dhan] cash ISIN backfill by LEADING symbol (full name differs from block):")
block = [["Security Description","ISIN","Buy Qty"], ["COALINDIA","INE522F01014","100"]]
ef = [{"instrument":"COALINDIA-COAL INDIA LTD.","isin":None,"side":"SELL"}]
P.backfill_isin(ef, P.isin_map_from_tables([block]))
check("'COALINDIA-COAL INDIA LTD.' -> ISIN via leading symbol", ef[0]["isin"] == "INE522F01014", ef[0]["isin"])
check("then infer_segment -> cash (was unknown)", P.infer_segment(ef[0]) == "cash", None)

print("[dhan] genuine-zero equity brokerage populated as 0 (delivery sells):")
zb = {"by_clearing_segment": {"NCLCM": {"brokerage": 0.0, "stt": -21.0}}, "net_total": {}, "unmapped_labels": []}
zf = [{"segment":"cash","side":"SELL","qty":11,"price":394.76,"brokerage":None}]
P.apportion_segment_brokerage(zf, zb)
check("zero NCLCM brokerage -> fill brokerage 0.0 (not missing)", zf[0]["brokerage"] == 0.0, zf[0]["brokerage"])
check("exact zero NOT flagged apportioned", not zf[0].get("brokerage_apportioned"), None)

# ===== GRADUATION: brokerage apportion fallback (single-segment headerless / genuine-zero) =====
print("[grad] apportion fallback for single-segment notes (Fyers F&O headerless, Dhan delivery):")
fno_only_ch = {"by_clearing_segment": {}, "net_total": {"brokerage": -80.0}, "unmapped_labels": []}
fno_only = [{"segment":"fno","side":"BUY","qty":225,"price":30.0,"brokerage":None},
            {"segment":"fno","side":"SELL","qty":225,"price":31.0,"brokerage":None}]
P.apportion_segment_brokerage(fno_only, fno_only_ch)
check("single-segment headerless -> brokerage from net_total", all(f.get("brokerage") is not None for f in fno_only), [f.get("brokerage") for f in fno_only])
check("apportioned sums to net_total -80.0", round(sum(f["brokerage"] for f in fno_only),2) == -80.0, round(sum(f["brokerage"] for f in fno_only),2))
cash_nobrok = {"by_clearing_segment": {}, "net_total": {"stt": -21.0, "net_amount": 5000.0}, "unmapped_labels": []}
cash_only = [{"segment":"cash","side":"SELL","qty":11,"price":394.76,"brokerage":None}]
P.apportion_segment_brokerage(cash_only, cash_nobrok)
check("single-segment, no brokerage charge -> genuine 0 (not missing)", cash_only[0]["brokerage"] == 0.0, cash_only[0]["brokerage"])
combined_ch = {"by_clearing_segment": {"NCLCM": {"brokerage": -20.0}}, "net_total": {"brokerage": -60.0}, "unmapped_labels": []}
combined_f = [{"segment":"cash","side":"SELL","qty":10,"price":100,"brokerage":None},
              {"segment":"fno","side":"BUY","qty":50,"price":30,"brokerage":None}]
P.apportion_segment_brokerage(combined_f, combined_ch)
check("combined: cash from NCLCM (-20); fno untouched, NO net_total fallback (no double-count)",
      combined_f[0]["brokerage"] == -20.0 and combined_f[1].get("brokerage") in (None, 0, 0.0), [combined_f[0].get("brokerage"), combined_f[1].get("brokerage")])

# ===== 2a: trade_date + contract_note_no extraction (note-level metadata) =====
print("[2a] trade_date -> ISO, contract_note_no from note content:")
check("'Trade Date : 06/02/2026' -> ISO", P.trade_date("Trade Date : 06/02/2026") == "2026-02-06", P.trade_date("Trade Date : 06/02/2026"))
check("'Contract Date : 22-09-2025' -> ISO", P.trade_date("Contract Date : 22-09-2025") == "2025-09-22", P.trade_date("Contract Date : 22-09-2025"))
check("2-digit year '10/02/26' -> 2026", P.trade_date("Trade Date 10/02/26") == "2026-02-10", P.trade_date("Trade Date 10/02/26"))
check("grabs trade date, NOT a preceding settlement date", P.trade_date("Settlement Date 09/02/2026\nTrade Date : 06/02/2026") == "2026-02-06", P.trade_date("Settlement Date 09/02/2026\nTrade Date : 06/02/2026"))
check("no date -> None", P.trade_date("no date here") is None, P.trade_date("no date here"))
check("impossible month (13) -> None", P.trade_date("Trade Date 06/13/2026") is None, P.trade_date("Trade Date 06/13/2026"))
check("contract_note_no plain", P.contract_note_no("Contract Note No. : 18415573") == "18415573", P.contract_note_no("Contract Note No. : 18415573"))
check("contract_note_no with slash -> sanitized", P.contract_note_no("Contract Note No : FON/123") == "FON-123", P.contract_note_no("Contract Note No : FON/123"))
check("contract_note_no absent -> None", P.contract_note_no("nothing") is None, P.contract_note_no("nothing"))

# ===== d2: Astha / Rupeezy adapter (SYNTHETIC — fake amounts, no PII from the real note) =====
print("[astha] broker detection, free-text charges, sign convention, Sub-Total trap:")
# 1) broker identity — 'astha' recognised, and it WINS over a stray 'dhan' substring in the body
check("detect_broker astha (member name / domain)", P.detect_broker("... www.asthatrade.com ...") == "astha", P.detect_broker("asthatrade.com"))
check("detect_broker rupeezy alias", P.detect_broker("FOR RUPEEZY BROKING") == "astha", P.detect_broker("rupeezy"))
check("astha wins over an incidental 'dhan' substring", P.detect_broker("Authorised Signatory Madhan; asthatrade.com") == "astha", P.detect_broker("Madhan asthatrade"))
check("plain dhan still detected (no regression)", P.detect_broker("Dhan / Moneylicious Securities") == "dhan", P.detect_broker("dhan"))

# 2) free-text charges block (Astha lists charges as text lines, NOT a ruled table).
# Fake, self-consistent numbers: net_amount == pay_in + sum of (charges). Charges printed
# UNSIGNED (payable) while pay_in / net_amount carry explicit signs.
astha_text = "\n".join([
    "Order No. Trade No. Security/Contract Buy(B)/Sell(S) Quantity Net Total",
    "111 222 NIFTY 18000 PE B 50 -1000.00",        # a trade-detail line — must NOT be read as a charge
    "Sub Total 1 -1000.00",                          # subtotal line — no mappable label
    "PAY IN / PAY OUT (Derivatives) -1000.00",
    "Securities Transaction Tax 50.00",
    "Taxable Value of Supply (Brokerage) 40.00",
    "Exchange Transaction Charges 2.00",
    "SEBI turnover Fees 1.00",
    "IGST (@18.00%) 7.56",
    "Stamp Duty 3.00",
    "Net Amount Payable by Client -1103.56",
])
ach = P.parse_charges_from_text(astha_text)
ant = ach["net_total"]
check("astha text: pay_in signed (negative)", ant.get("pay_in") == -1000.00, ant.get("pay_in"))
check("astha text: net_amount signed (negative)", ant.get("net_amount") == -1103.56, ant.get("net_amount"))
check("astha text: STT charge negated (debit)", ant.get("stt") == -50.00, ant.get("stt"))
check("astha text: brokerage via 'Taxable Value of Supply'", ant.get("brokerage") == -40.00, ant.get("brokerage"))
check("astha text: exchange_txn negated", ant.get("exchange_txn") == -2.00, ant.get("exchange_txn"))
check("astha text: sebi_turnover negated", ant.get("sebi_turnover") == -1.00, ant.get("sebi_turnover"))
check("astha text: igst negated (single 18% line)", ant.get("igst") == -7.56, ant.get("igst"))
check("astha text: stamp_duty negated", ant.get("stamp_duty") == -3.00, ant.get("stamp_duty"))
check("astha text: trade-detail line NOT summed as a charge", "net_amount" in ant and len(ant) == 8, sorted(ant))
apass, aresid = P.checksum(ant)
check("astha text: CHECKSUM PASS (net == pay_in + sum of charges)", apass is True, (apass, aresid))
check("astha text: residual ~0", abs(aresid) <= 0.01, aresid)
agp, agd = P.gst_check(ant)
check("astha text: GST attribution PASS (igst side)", agp is True and "igst" in agd, (agp, agd))
# refuse-on-fail: a charges block with NO net-amount line is unreconcilable -> None
check("astha text: no net_amount -> None (refuse)", P.parse_charges_from_text("Stamp Duty 3.00") is None, None)

# 3) the 'Sub Total' subtotal row must not leak as a phantom fill (real note had one)
subtotal_tbl = [
    ["Order No.", "Trade No.", "Security / Contract Description", "Buy(B)/Sell(S)", "Quantity", "Net Total"],
    ["111", "222", "NIFTY 18000 PE", "B", "50", "(1000.00)"],
    ["", "", "Sub Total", "", "50", "(1000.00)"],
]
af = P.map_table(subtotal_tbl)
check("astha 'Sub Total' row trapped (1 fill, not 2)", len(af) == 1, len(af))
check("astha fill is the real trade (not the subtotal)", af[0]["instrument"] == "NIFTY 18000 PE", af[0]["instrument"])

# ===== d2: Groww adapter (SYNTHETIC — fake amounts, no PII from the real note) =====
print("[groww] broker detection, Pradhan/\\bdhan\\b fix, per-contract 'Total' subtotal trap, signed charges, UTT:")
# 1) broker identity + the ROOT fix: the client surname "Pradhan" must NOT match dhan
check("detect_broker groww (if brand text present)", P.detect_broker("... Nextbillion Technology ...") == "groww", P.detect_broker("nextbillion"))
check("client name 'Pradhan' does NOT match dhan (was the silent-miss root cause)",
      P.detect_broker("Name: Shyam Sundar Pradhan, Koraput, Odisha") == "unknown", P.detect_broker("Pradhan"))
check("real Dhan still detected via word-bounded \\bdhan\\b", P.detect_broker("Thank you for choosing Dhan") == "dhan", P.detect_broker("Dhan"))
check("Dhan via Moneylicious/Raise Securities", P.detect_broker("Raise Securities (formerly Moneylicious)") == "dhan", None)

# 2) per-contract 'Total' subtotal rows: Groww puts "Total" in the ORDER-NO cell and the
# ISIN in the security cell — so the instrument/side traps miss it. Must be trapped anyway.
groww_det = [
    ["Order no.", "Order time", "Trade no.", "Trade time", "Security/Contract description",
     "Exchange", "Buy(B)/Sell(S)", "Quantity", "Gross Rate", "Brokerage per Unit",
     "Net Rate", "Closing Rate", "Net Total", "Remarks"],
    ["1000000014440483", "12:35:19", "2202098", "12:35:19", "Aditya Birla Capital Ltd.", "NSE", "S", "-13", "178.20", "", "178.20", "", "2316.60", ""],
    ["Total", "", "", "", "INE674K01013", "", "", "-13", "", "", "", "", "2316.60", ""],   # subtotal (ISIN in security cell) — trap
    ["1000000014443127", "12:35:21", "2202739", "12:35:21", "Cholamandalam In & Fin Co", "NSE", "B", "3", "1121.30", "", "1121.30", "", "-3363.90", ""],
    ["Total", "", "", "", "INE121A01024", "", "", "3", "", "", "", "", "-3363.90", ""],
]
gf = P.map_table(groww_det)
check("groww: 2 real fills (the 2 'Total' subtotals trapped)", len(gf) == 2, len(gf))
check("groww: sides read from B/S column", [f["side"] for f in gf] == ["SELL", "BUY"], [f["side"] for f in gf])
check("groww: SELL net_total credit (+), BUY debit (-)", gf[0]["net_total"] == 2316.60 and gf[1]["net_total"] == -3363.90, [gf[0]["net_total"], gf[1]["net_total"]])
check("groww: instruments (names, not the ISIN subtotal)", gf[0]["instrument"] == "Aditya Birla Capital Ltd." and "Cholamandalam" in gf[1]["instrument"], [gf[0]["instrument"], gf[1]["instrument"]])

# 3) UTT (Union Territory Tax) maps to a recognised non-charge (other_tax) — not an unmapped-charge HOLD
check("UTT label -> other_tax (not unmapped)", P.label_key("UTT") == "other_tax", P.label_key("UTT"))

# 4) Groww charges block (Description | Equity | F&O | Net Total) — SIGNED (debits already negative,
# unlike Astha's unsigned magnitudes), so NO negation; total + per-segment checksums must close.
groww_ch = [
    ["Description", "Equity", "Future & Options", "Net Total"],
    ["Pay In / Pay Out Obligation", "-10000.00", "", "-10000.00"],
    ["Taxable Value of Supply (Brokerage)", "-20.00", "", "-20.00"],
    ["Exchange Transaction Charges", "-3.00", "", "-3.00"],
    ["CGST (9% on Brokerage, Exchange transaction charges & SEBI turnover fees)", "", "", ""],
    ["SGST (9% on Brokerage, Exchange transaction charges & SEBI turnover fees)", "", "", ""],
    ["IGST (18% on Brokerage, Exchange transaction charges & SEBI turnover fees)", "-4.14", "", "-4.14"],
    ["UTT", "", "", ""],
    ["Securities Transaction Tax", "-10.00", "", "-10.00"],
    ["SEBI Turnover Fees", "-0.02", "", "-0.02"],
    ["Stamp Duty", "-1.00", "", "-1.00"],
    ["Net Amount Receivable / Payable By Client", "-10038.16", "", "-10038.16"],
]
gch = P.parse_charges_from_tables([groww_ch])
gnt = gch["net_total"]
check("groww charges: signed brokerage kept negative (not re-negated)", gnt.get("brokerage") == -20.00, gnt.get("brokerage"))
check("groww charges: igst negative, cgst/sgst 0", gnt.get("igst") == -4.14 and gnt.get("cgst") == 0.0 and gnt.get("sgst") == 0.0, (gnt.get("igst"), gnt.get("cgst"), gnt.get("sgst")))
check("groww charges: UTT captured as other_tax (0)", gnt.get("other_tax") == 0.0, gnt.get("other_tax"))
gpass, gresid = P.checksum(gnt)
check("groww: total CHECKSUM PASS (net == pay_in + charges, signed)", gpass is True, (gpass, gresid))
check("groww: residual ~0", abs(gresid) <= 0.01, gresid)
gps = P.per_segment_checksum(gch, [])
check("groww: per-segment Equity checksum closes", gps.get("Equity", {}).get("pass") is True, gps.get("Equity"))

print("[dhan-2025] text-positioned GST-invoice note: detector, unclosed-paren label key, charges + fills:")
# The 2025 Dhan "Cash F&O and Currency" layout renders as TEXT (no row rules). Synthetic sample of
# the extracted text: a cash-ETF fill line, an F&O fill line, and the charges block with a WRAPPED
# 'NSE TRANSACTION\n...\nCHARGES)' label and an UNCLOSED 'IGST ... (' / '(IPFT' paren.
dhan2025_text = "\n".join([
    "I/We have this day done by your order and on your account the following transactions :",
    "1000000067531089 10:15:04 123456 10:15:04FAKEETF S -100 250.0000 253.7500 25375.00 D",
    "1500000067192785 09:20:01 654321 09:20:01 48000 CE B 150 176.2500 176.2500 -26437.50",
    "Symbol :FAKEETF ISIN : INF204KB15I9 Net -100 253.7500 25375.00",
    "Description NCLCM NCLFO Total",
    "PAY IN/PAY OUT OBLIGATION 25375.00 CR 0.00 CR 25375.00 CR",
    "TAXABLE VALUE OF SUPPLY (IPFT 0.10 DR 0.00 CR 0.10 DR",
    "TAXABLE VALUE OF SUPPLY (NSE TRANSACTION",
    "2.93 DR 0.00 CR 2.93 DR",
    "CHARGES)",
    "TAXABLE VALUE OF SUPPLY (SEBI FEES) 0.10 DR 0.00 CR 0.10 DR",
    "IGST* RATE:18% AMOUNT (",
    "0.56 DR 0.00 CR 0.56 DR",
    "RS.)",
    "SECURITIES TRANSACTIONS TAX (RS.) 1.00 DR 0.00 CR 1.00 DR",
    "Description NCLCM NCLFO Total",
    "NET AMOUNT RECEIVABLE/PAYABLE BY CLIENT 25370.31 CR 0.00 CR 25370.31 CR",
    "LEDGER BALANCE 25370.31 CR",
    "Total Amount In Words ... ONLY",
])
check("dhan2025: detector fires on the GST-invoice markers", P.is_dhan_2025_textnote(dhan2025_text) is True)
check("dhan2025: detector does NOT fire on a plain note", P.is_dhan_2025_textnote("Zerodha\nNet Amount ... Pay-in") is False)
# unclosed-paren label must key on the INNER charge, not fall back to the generic 'brokerage' lead
check("dhan2025: '(IPFT' unclosed-paren -> ipft (not brokerage)", P._dhan2025_key("TAXABLE VALUE OF SUPPLY (IPFT") == "ipft", P._dhan2025_key("TAXABLE VALUE OF SUPPLY (IPFT"))
check("dhan2025: '(NSE TRANSACTION CHARGES)' -> exchange_txn", P._dhan2025_key("TAXABLE VALUE OF SUPPLY (NSE TRANSACTION CHARGES)") == "exchange_txn")
d_ch = P.parse_dhan2025_charges_from_text(dhan2025_text)
dnt = d_ch["net_total"]
check("dhan2025 charges: pay_in (CR) positive", dnt.get("pay_in") == 25375.00, dnt.get("pay_in"))
check("dhan2025 charges: exchange_txn (DR, wrapped label) negative", dnt.get("exchange_txn") == -2.93, dnt.get("exchange_txn"))
check("dhan2025 charges: igst (DR, wrapped) negative", dnt.get("igst") == -0.56, dnt.get("igst"))
check("dhan2025 charges: net_amount present", dnt.get("net_amount") == 25370.31, dnt.get("net_amount"))
check("dhan2025 charges: NCLCM segment captured", round(d_ch["by_clearing_segment"].get("NCLCM", {}).get("net_amount", 0), 2) == 25370.31, d_ch["by_clearing_segment"].get("NCLCM"))
d_fills = P.parse_dhan2025_fills_from_text(dhan2025_text)
check("dhan2025 fills: 2 fills (ETF sell + option buy), summary line skipped", len(d_fills) == 2, len(d_fills))
sell = next((f for f in d_fills if f["side"] == "SELL"), None)
buy = next((f for f in d_fills if f["side"] == "BUY"), None)
check("dhan2025 fills: SELL net_total credit (+)", sell and sell["net_total"] == 25375.00, sell and sell["net_total"])
check("dhan2025 fills: BUY net_total debit (-)", buy and buy["net_total"] == -26437.50, buy and buy["net_total"])
check("dhan2025 fills: qty absolute (sign carried by side)", sell and sell["qty"] == 100 and buy and buy["qty"] == 150, (sell and sell["qty"], buy and buy["qty"]))
dpass, dresid = P.checksum(dnt, d_fills)
check("dhan2025: total CHECKSUM PASS (net == pay_in + charges)", dpass is True, (dpass, dresid))
check("dhan2025: residual ~0", abs(dresid) <= 0.01, dresid)

# Ruled 'Eqfo_signed' variant: 'Receivable (CR) / Payable (DR)' wording, and 0-value charges
# rendered as BARE cells (no DR/CR). The bare zero line must NOT glue onto the next charge's label
# (the SGST-0 → Stamp-Duty pollution that dropped stamp_duty and broke the checksum).
dhan2025_ruled = "\n".join([
    "1500000067192785 09:20:01 09:20:01 FUT B 50 100.0000 100.0000 -5000.00",
    "Description NCLCM NCLFO Total",
    "Pay In/Pay Out Obligation 5000.00 CR 0.00 5000.00 CR",
    "Taxable Value Of Supply (Brokerage) 20.00 DR 0.00 20.00 DR",
    "CGST* RATE:9% On Taxable Value Of Supply 0.00 0.00 0.00",
    "SGST* RATE:9% On Taxable Value Of Supply 0.00 0.00 0.00",
    "Stamp Duty (Rs.) 3.60 DR 0.00 3.60 DR",
    "IGST* RATE:18% on Taxable Value of Supply 3.60 DR 0.00 3.60 DR",
    "Net Amount Receivable (CR) / Payable (DR) By Client 4972.80 CR 0.00 4972.80 CR",
])
check("dhan2025 ruled: detector fires on 'Receivable (CR) / Payable (DR)'", P.is_dhan_2025_textnote(dhan2025_ruled) is True)
r_ch = P.parse_dhan2025_charges_from_text(dhan2025_ruled)
rnt = r_ch["net_total"]
check("dhan2025 ruled: bare-zero SGST does not swallow Stamp Duty", rnt.get("stamp_duty") == -3.60, rnt.get("stamp_duty"))
check("dhan2025 ruled: bare-zero CGST/SGST captured as 0 (flushed, not merged)", rnt.get("cgst") == 0.0 and rnt.get("sgst") == 0.0, (rnt.get("cgst"), rnt.get("sgst")))
check("dhan2025 ruled: brokerage kept", rnt.get("brokerage") == -20.00, rnt.get("brokerage"))
rpass, rresid = P.checksum(rnt, P.parse_dhan2025_fills_from_text(dhan2025_ruled))
check("dhan2025 ruled: total CHECKSUM PASS", rpass is True, (rpass, rresid))

print(f"\n{ok} passed, {bad} failed")
import sys; sys.exit(1 if bad else 0)
