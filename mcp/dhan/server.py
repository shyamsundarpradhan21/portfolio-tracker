#!/usr/bin/env python3
"""
Dhan MCP server (standalone) — exposes a Dhan account over the Model Context
Protocol on the OFFICIAL dhanhq SDK. Read tools always; order tools gated.

You run and own this process. It is not auto-wired into any agent's config.

SECURITY MODEL
  - Order tools are GATED: active only when DHAN_READONLY=0. Default is
    read-only, so the server cannot place/cancel orders until you arm it.
    Keep client-capital accounts read-only.
  - Credentials from the environment (.env / shell), never hard-coded.
  - Dhan's access token is generated in the Dhan Developer Portal
    (https://developer.dhanhq.co) and is longer-lived than the OAuth brokers —
    no interactive login flow needed; just set the env vars.

Verified against dhanhq v2: DhanContext/dhanhq client, get_holdings /
get_positions / get_fund_limits / get_order_list, and place_order
(security_id, exchange_segment, transaction_type, quantity, order_type,
product_type, price) with enums NSE|NSE_FNO / BUY|SELL / MARKET|LIMIT / INTRA|CNC.
"""
import os
from mcp.server.fastmcp import FastMCP
from dhanhq import DhanContext, dhanhq

CLIENT_ID    = os.environ.get("DHAN_CLIENT_ID", "")
ACCESS_TOKEN = os.environ.get("DHAN_ACCESS_TOKEN", "")
# Default read-only. Set DHAN_READONLY=0 to arm order placement.
READONLY     = os.environ.get("DHAN_READONLY", "1") != "0"

mcp = FastMCP("dhan")

_dhan = None
if CLIENT_ID and ACCESS_TOKEN:
    try:
        _dhan = dhanhq(DhanContext(CLIENT_ID, ACCESS_TOKEN))
    except Exception:
        _dhan = None


def _need_auth() -> dict:
    return {"error": "not configured",
            "how": "Set DHAN_CLIENT_ID + DHAN_ACCESS_TOKEN in the environment. "
                   "Generate the access token at https://developer.dhanhq.co."}


def _trade_guard():
    if READONLY:
        return {"error": "trading disabled",
                "how": "Read-only. Set DHAN_READONLY=0 to arm order tools. Keep "
                       "client-capital accounts read-only."}
    if _dhan is None:
        return _need_auth()
    return None


# ── status ───────────────────────────────────────────────────────────────────
@mcp.tool()
def dhan_status() -> dict:
    """Whether the server is configured (token present) and whether trading is armed."""
    return {"configured": _dhan is not None, "readonly": READONLY,
            "client_id_set": bool(CLIENT_ID)}


# ── read ─────────────────────────────────────────────────────────────────────
@mcp.tool()
def get_holdings() -> dict:
    """Delivery holdings."""
    return _dhan.get_holdings() if _dhan else _need_auth()


@mcp.tool()
def get_positions() -> dict:
    """Open positions (intraday + F&O)."""
    return _dhan.get_positions() if _dhan else _need_auth()


@mcp.tool()
def get_funds() -> dict:
    """Fund limits / available balance."""
    return _dhan.get_fund_limits() if _dhan else _need_auth()


@mcp.tool()
def get_orders() -> dict:
    """Today's order list."""
    return _dhan.get_order_list() if _dhan else _need_auth()


# ── trade (gated by DHAN_READONLY=0) ─────────────────────────────────────────
@mcp.tool()
def place_order(security_id: str, exchange_segment: str, transaction_type: str,
                quantity: int, order_type: str = "MARKET",
                product_type: str = "INTRA", price: float = 0,
                trigger_price: float = 0) -> dict:
    """Place an order. GATED — only runs when DHAN_READONLY=0.
    exchange_segment: NSE|NSE_FNO|BSE|BSE_FNO · transaction_type: BUY|SELL ·
    order_type: MARKET|LIMIT|SL|SL_M · product_type: INTRA|CNC|MARGIN ·
    security_id is Dhan's numeric instrument id (not a trading symbol)."""
    g = _trade_guard()
    if g:
        return g
    d = _dhan
    return d.place_order(
        security_id=security_id,
        exchange_segment=getattr(d, exchange_segment, exchange_segment),
        transaction_type=getattr(d, transaction_type, transaction_type),
        quantity=quantity,
        order_type=getattr(d, order_type, order_type),
        product_type=getattr(d, product_type, product_type),
        price=price, trigger_price=trigger_price)


@mcp.tool()
def cancel_order(order_id: str) -> dict:
    """Cancel a pending order by id. GATED — only runs when DHAN_READONLY=0."""
    g = _trade_guard()
    if g:
        return g
    return _dhan.cancel_order(order_id)


if __name__ == "__main__":
    mcp.run()
