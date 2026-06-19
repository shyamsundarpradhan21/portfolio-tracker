#!/usr/bin/env python3
"""
Upstox MCP server (standalone) — exposes an Upstox account over the Model Context
Protocol so an MCP client (Claude Desktop / Claude Code) can read the book and,
ONLY when explicitly armed, place/modify/cancel orders.

You run and own this process. It is not auto-wired into any agent's config.

SECURITY MODEL
  - Order tools are GATED: active only when UPSTOX_READONLY=0. The default is
    read-only, so the server cannot place/modify/cancel orders until you
    deliberately arm it. Keep client-capital accounts read-only.
  - Credentials come from the environment (.env / shell), never hard-coded.
  - The Upstox access token expires daily at ~3:30am IST. login.py (Playwright +
    TOTP) re-mints it each morning and writes it to .token.json; this server just
    reads it. (SEBI gates long-lived tokens behind a registered static IP, which
    a dynamic-IP laptop can't use — so daily re-login is the hands-off path.)

Built on the Upstox v2 REST API (https://upstox.com/developer/api-documentation).
"""
import os
import json
from typing import Optional

import requests
from mcp.server.fastmcp import FastMCP

API        = "https://api.upstox.com"
HERE       = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(HERE, ".token.json")
# Default read-only. Set UPSTOX_READONLY=0 to arm order placement.
READONLY   = os.environ.get("UPSTOX_READONLY", "1") != "0"

mcp = FastMCP("upstox")

_state = {"token": os.environ.get("UPSTOX_ACCESS_TOKEN") or None}


def _load_token():
    try:
        with open(TOKEN_FILE) as f:
            return json.load(f).get("access_token")
    except Exception:
        return None


def _token():
    # The daily token in .token.json is the source of truth (re-minted by
    # login.py); fall back to an env / manually-set token.
    return _load_token() or _state["token"]


def _need_auth() -> dict:
    return {"error": "not authenticated",
            "how": "Run login.py to mint today's access token (it expires ~3:30am "
                   "IST), or set UPSTOX_ACCESS_TOKEN."}


def _get(path: str, params: Optional[dict] = None) -> dict:
    tok = _token()
    if not tok:
        return _need_auth()
    try:
        r = requests.get(API + path,
                         headers={"Authorization": f"Bearer {tok}",
                                  "Accept": "application/json"},
                         params=params, timeout=20)
        return r.json()
    except Exception as e:
        return {"error": str(e)}


def _trade_guard() -> Optional[dict]:
    if READONLY:
        return {"error": "trading disabled",
                "how": "This server is read-only. Set UPSTOX_READONLY=0 in the "
                       "environment to arm order tools. Keep client-capital "
                       "accounts read-only."}
    if not _token():
        return _need_auth()
    return None


# ── auth ─────────────────────────────────────────────────────────────────────
@mcp.tool()
def upstox_status() -> dict:
    """Whether the server has a usable access token (re-minted daily by login.py) and whether trading is armed."""
    tok = _token()
    return {"authenticated": bool(tok), "readonly": READONLY,
            "token_stored": bool(_load_token())}


# ── read ─────────────────────────────────────────────────────────────────────
@mcp.tool()
def get_profile() -> dict:
    """Upstox account profile."""
    return _get("/v2/user/profile")


@mcp.tool()
def get_funds() -> dict:
    """Funds & margin (equity + commodity segments)."""
    return _get("/v2/user/get-funds-and-margin")


@mcp.tool()
def get_holdings() -> dict:
    """Long-term (delivery) holdings."""
    return _get("/v2/portfolio/long-term-holdings")


@mcp.tool()
def get_positions() -> dict:
    """Short-term / intraday positions."""
    return _get("/v2/portfolio/short-term-positions")


@mcp.tool()
def get_orderbook() -> dict:
    """Today's order book."""
    return _get("/v2/order/retrieve-all")


@mcp.tool()
def get_trades() -> dict:
    """Today's executed trades."""
    return _get("/v2/order/trades/get-trades-for-day")


@mcp.tool()
def get_quotes(symbols: str) -> dict:
    """Full market quotes. symbols: comma-separated instrument keys, e.g.
    'NSE_EQ|INE848E01016,NSE_INDEX|Nifty 50'."""
    return _get("/v2/market-quote/quotes", {"symbol": symbols})


# ── trade (gated by UPSTOX_READONLY=0) ───────────────────────────────────────
@mcp.tool()
def place_order(instrument_token: str, quantity: int, transaction_type: str,
                order_type: str = "MARKET", product: str = "D",
                price: float = 0, trigger_price: float = 0,
                validity: str = "DAY", disclosed_quantity: int = 0,
                is_amo: bool = False, tag: str = "") -> dict:
    """Place an order. transaction_type: BUY|SELL. order_type: MARKET|LIMIT|SL|SL-M.
    product: D (delivery/CNC) | I (intraday) | MTF. instrument_token e.g.
    'NSE_EQ|INE848E01016'. GATED — only runs when UPSTOX_READONLY=0."""
    g = _trade_guard()
    if g:
        return g
    body = {"quantity": quantity, "product": product, "validity": validity,
            "price": price, "tag": tag or None, "instrument_token": instrument_token,
            "order_type": order_type, "transaction_type": transaction_type,
            "disclosed_quantity": disclosed_quantity, "trigger_price": trigger_price,
            "is_amo": is_amo}
    try:
        r = requests.post(API + "/v2/order/place",
                          headers={"Authorization": f"Bearer {_token()}",
                                   "Accept": "application/json",
                                   "Content-Type": "application/json"},
                          json=body, timeout=20)
        return r.json()
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def modify_order(order_id: str, order_type: Optional[str] = None,
                 quantity: Optional[int] = None, price: Optional[float] = None,
                 trigger_price: Optional[float] = None,
                 validity: str = "DAY") -> dict:
    """Modify a pending order by id. GATED — only runs when UPSTOX_READONLY=0."""
    g = _trade_guard()
    if g:
        return g
    body = {"order_id": order_id, "validity": validity}
    if order_type is not None:
        body["order_type"] = order_type
    if quantity is not None:
        body["quantity"] = quantity
    if price is not None:
        body["price"] = price
    if trigger_price is not None:
        body["trigger_price"] = trigger_price
    try:
        r = requests.put(API + "/v2/order/modify",
                         headers={"Authorization": f"Bearer {_token()}",
                                  "Accept": "application/json",
                                  "Content-Type": "application/json"},
                         json=body, timeout=20)
        return r.json()
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def cancel_order(order_id: str) -> dict:
    """Cancel a pending order by id. GATED — only runs when UPSTOX_READONLY=0."""
    g = _trade_guard()
    if g:
        return g
    try:
        r = requests.delete(API + "/v2/order/cancel",
                            headers={"Authorization": f"Bearer {_token()}",
                                     "Accept": "application/json"},
                            params={"order_id": order_id}, timeout=20)
        return r.json()
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    mcp.run()
