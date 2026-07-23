#!/usr/bin/env python3
"""ViewTrade / Raise (IFSC) US-stocks TRADE CONFIRMATION adapter.

Dhan's GIFT-City US sleeve settles at ViewTrade International IFSC; its trade
confirmations arrive by email as an encrypted PDF ("TRADE CONFIRMATION / CUM Tax
Invoice", "US Stocks Segment"). This is NOT a SEBI Indian contract note (USD, US
tickers, no Indian ISIN/STT/CTT, no contract-note number) so the Indian engine
(engine.py) can't read it — this module does.

Row layout (one executed fill per line; the security NAME may wrap across lines,
but the DATA line always carries the symbol + all numbers):
  TradeDate SettleDate SYMBOL [Security Name...] B|S Qty Price NetBefore \
      Commission TxnFee TurnoverFee OtherFee IGST NetAfter          (all USD)
The last 9 whitespace tokens are always numbers (qty, price, net-before, 5 fee
columns, net-after); the token before them is the side. That positional rule is
robust to the wrapped name. Reconciles per row: net-before ~= qty*price, and
net-after == net-before + Σfees.

PII-SAFE: emits ONLY tickers, USD amounts and dates. The client name / PAN / UCC /
address / VT account number are never read into the output.
"""
import re

_DATE = re.compile(r"^\d{2}/\d{2}/\d{4}$")
_NUM = re.compile(r"^-?\d[\d,]*\.?\d*$")


def is_us_note(text):
    """A ViewTrade US trade confirmation? Gated on distinctive header markers."""
    t = text or ""
    return ("US Stocks Segment" in t) or ("ViewTrade" in t and "TRADE CONFIRMATION" in t)


def _num(s):
    try:
        return float(str(s).replace(",", ""))
    except (ValueError, TypeError):
        return None


def _iso(dmy):
    """'22/07/2026' -> '2026-07-22'."""
    d, m, y = dmy.split("/")
    return f"{y}-{m}-{d}"


def parse_us_note(text):
    """Decrypted note text -> {asOf, trades:[...], reconciled, residuals}. None if not
    a US note. Each trade: {date, sym, name, side, qty, priceUsd, netBefore, netAfter,
    fees, costUsd} where costUsd = signed cash flow (Buy -, Sell +) after levies."""
    if not is_us_note(text):
        return None
    trades = []
    bad = []
    for raw in (text or "").splitlines():
        toks = raw.split()
        if len(toks) < 12:
            continue
        if not (_DATE.match(toks[0]) and _DATE.match(toks[1])):
            continue
        nums = toks[-9:]                                   # qty, price, net-before, 5 fees, net-after
        if not all(_NUM.match(t) for t in nums):
            continue
        side = toks[-10]
        if side not in ("B", "S"):
            continue
        sym = toks[2]
        if not re.match(r"^[A-Z][A-Z0-9.]{0,6}$", sym):
            continue
        name = " ".join(toks[3:-10]).strip()
        vals = [_num(t) for t in nums]
        qty, price, net_before = vals[0], vals[1], vals[2]
        fees = vals[3:8]
        net_after = vals[8]
        # per-row reconciliation (fractional-share rounding -> small tolerance). Levies ADD to a
        # buy's cost and DEDUCT from a sell's proceeds, so net-after moves by side.
        gross_ok = abs((qty * price) - net_before) <= max(0.02, 0.005 * net_before)
        expect_after = net_before + (sum(fees) if side == "B" else -sum(fees))
        levy_ok = abs(expect_after - net_after) <= 0.02
        if not (gross_ok and levy_ok):
            bad.append({"sym": sym, "date": _iso(toks[0]), "gross_ok": gross_ok, "levy_ok": levy_ok})
        trades.append({
            "date": _iso(toks[0]), "settle": _iso(toks[1]), "sym": sym, "name": name or None,
            "side": "BUY" if side == "B" else "SELL", "qty": round(qty, 6),
            "priceUsd": round(price, 4), "netBefore": round(net_before, 2),
            "netAfter": round(net_after, 2), "fees": round(sum(fees), 2),
            # signed cash flow after levies (Buy debits cash -> negative; Sell credits -> positive)
            "costUsd": round(net_after * (-1 if side == "B" else 1), 2),
        })
    if not trades:
        return None
    return {"asOf": max(t["date"] for t in trades), "trades": trades,
            "reconciled": not bad, "unreconciled": bad}


def masked_summary(us):
    """PII-safe stdout block: tickers + USD, no client identifiers."""
    L = ["broker: dhan-us (ViewTrade/Raise IFSC) | US Stocks Segment",
         f"trades: {len(us['trades'])}  asOf {us['asOf']}  reconciled: {us['reconciled']}"]
    for t in us["trades"]:
        L.append(f"  {t['date']}  {t['side']:4} {t['sym']:6} qty {t['qty']:<10} @ ${t['priceUsd']:<9} "
                 f"= ${t['netAfter']} (fees ${t['fees']})")
    if us["unreconciled"]:
        L.append(f"  !! {len(us['unreconciled'])} row(s) failed per-row reconciliation: "
                 f"{[b['sym'] for b in us['unreconciled']]}")
    return "\n".join(L)
