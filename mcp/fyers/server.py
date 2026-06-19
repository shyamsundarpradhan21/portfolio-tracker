#!/usr/bin/env python3
"""
Fyers MCP server (standalone) — exposes a Fyers account over the Model Context
Protocol so an MCP client (Claude Desktop / Claude Code) can read the book and,
ONLY when explicitly armed, place/modify/cancel orders.

You run and own this process. It is not auto-wired into any agent's config.

SECURITY MODEL
  - Order tools are GATED: active only when FYERS_READONLY=0. The default is
    read-only, so the server cannot place/modify/cancel orders until you
    deliberately arm it. Keep client-capital accounts read-only.
  - Credentials come from the environment (.env / shell), never hard-coded.
  - The Fyers access token is valid ~one trading day. SEBI has the refresh-token
    API disabled, so it cannot be renewed silently — login.py (Playwright + TOTP)
    re-mints it daily and writes it to .token.json; this server just reads it.

Verified against fyers-apiv3 (v3) docs: SessionModel auth flow + place_order
data schema (type 1=Limit/2=Market/3=SL/4=SL-M, side 1=Buy/-1=Sell,
productType INTRADAY|CNC|MARGIN|CO|BO, validity DAY|IOC).
"""
import os
import json
from typing import Optional
from urllib.parse import urlparse, parse_qs

from mcp.server.fastmcp import FastMCP
from fyers_apiv3 import fyersModel

APP_ID       = os.environ.get("FYERS_APP_ID", "")
SECRET_ID    = os.environ.get("FYERS_SECRET_ID", "")
REDIRECT_URI = os.environ.get("FYERS_REDIRECT_URI", "https://127.0.0.1/fyers")
# Default read-only. Set FYERS_READONLY=0 to arm order placement.
READONLY     = os.environ.get("FYERS_READONLY", "1") != "0"
# login.py re-mints the daily access token and writes it here; the server reads
# it. (SEBI has the refresh-token API disabled, so there is no silent renewal.)
TOKEN_FILE   = os.path.join(os.path.dirname(os.path.abspath(__file__)), ".token.json")

mcp = FastMCP("fyers")

_state = {"token": os.environ.get("FYERS_ACCESS_TOKEN") or None, "session": None}


def _load_token():
    try:
        with open(TOKEN_FILE) as f:
            return json.load(f).get("access_token")
    except Exception:
        return None


def _save_token(tok):
    if not tok:
        return
    try:
        with open(TOKEN_FILE, "w") as f:
            json.dump({"access_token": tok}, f)
    except Exception:
        pass


def _client():
    # The daily token in .token.json is the source of truth (re-minted by
    # login.py); fall back to an env / manually-set token.
    tok = _load_token() or _state["token"]
    if not tok:
        return None
    return fyersModel.FyersModel(token=tok, is_async=False,
                                 client_id=APP_ID, log_path="")


def _need_auth() -> dict:
    return {"error": "not authenticated",
            "how": "Call fyers_auth_url, log in, then fyers_set_token with the "
                   "auth_code (or the full redirect URL). Or set FYERS_ACCESS_TOKEN."}


def _trade_guard() -> Optional[dict]:
    if READONLY:
        return {"error": "trading disabled",
                "how": "This server is read-only. Set FYERS_READONLY=0 in the "
                       "environment to arm order tools. Keep client-capital "
                       "accounts read-only."}
    if not (_load_token() or _state["token"]):
        return _need_auth()
    return None


# ── auth ─────────────────────────────────────────────────────────────────────
@mcp.tool()
def fyers_status() -> dict:
    """Whether the server has a usable access token (re-minted daily by login.py) and whether trading is armed."""
    tok = _load_token() or _state["token"]
    return {"authenticated": bool(tok), "readonly": READONLY,
            "app_id_set": bool(APP_ID), "redirect_uri": REDIRECT_URI,
            "token_stored": bool(_load_token())}


@mcp.tool()
def fyers_auth_url() -> dict:
    """Return the Fyers login URL. Open it, authenticate (with TOTP), then copy
    the auth_code from the redirect URL."""
    if not (APP_ID and SECRET_ID):
        return {"error": "FYERS_APP_ID / FYERS_SECRET_ID not set in the environment"}
    session = fyersModel.SessionModel(
        client_id=APP_ID, redirect_uri=REDIRECT_URI, response_type="code",
        state="mcp", secret_key=SECRET_ID, grant_type="authorization_code")
    _state["session"] = session
    return {"login_url": session.generate_authcode(),
            "next": "Open the URL, authenticate, then call fyers_set_token with "
                    "the auth_code (or the full redirect URL you land on)."}


@mcp.tool()
def fyers_set_token(auth_code_or_url: str) -> dict:
    """Exchange the auth_code (or the full redirect URL) for today's access token."""
    code = auth_code_or_url.strip()
    if code.startswith("http"):
        q = parse_qs(urlparse(code).query)
        code = (q.get("auth_code") or q.get("code") or [""])[0]
    if not code:
        return {"error": "no auth_code found in input"}
    session = _state["session"]
    if session is None:
        if not (APP_ID and SECRET_ID):
            return {"error": "FYERS_APP_ID / FYERS_SECRET_ID not set"}
        session = fyersModel.SessionModel(
            client_id=APP_ID, redirect_uri=REDIRECT_URI, response_type="code",
            state="mcp", secret_key=SECRET_ID, grant_type="authorization_code")
    session.set_token(code)
    resp = session.generate_token()
    tok = (resp or {}).get("access_token")
    if not tok:
        return {"error": "token exchange failed", "response": resp}
    _state["token"] = tok
    _save_token(tok)  # persist today's access token for the server to read
    return {"ok": True, "authenticated": True, "token_saved": True}


# ── read ─────────────────────────────────────────────────────────────────────
@mcp.tool()
def get_profile() -> dict:
    """Fyers account profile."""
    c = _client(); return c.get_profile() if c else _need_auth()


@mcp.tool()
def get_funds() -> dict:
    """Available funds / margins."""
    c = _client(); return c.funds() if c else _need_auth()


@mcp.tool()
def get_holdings() -> dict:
    """Delivery holdings."""
    c = _client(); return c.holdings() if c else _need_auth()


@mcp.tool()
def get_positions() -> dict:
    """Open positions (intraday + carryforward)."""
    c = _client(); return c.positions() if c else _need_auth()


@mcp.tool()
def get_orderbook() -> dict:
    """Today's order book."""
    c = _client(); return c.orderbook() if c else _need_auth()


@mcp.tool()
def get_tradebook() -> dict:
    """Today's executed trades."""
    c = _client(); return c.tradebook() if c else _need_auth()


@mcp.tool()
def get_quotes(symbols: str) -> dict:
    """Live quotes. symbols: comma-separated, e.g. 'NSE:SBIN-EQ,NSE:NIFTY50-INDEX'."""
    c = _client(); return c.quotes({"symbols": symbols}) if c else _need_auth()


# ── trade (gated by FYERS_READONLY=0) ────────────────────────────────────────
@mcp.tool()
def place_order(symbol: str, qty: int, side: int, order_type: int = 2,
                product_type: str = "INTRADAY", limit_price: float = 0,
                stop_price: float = 0, validity: str = "DAY",
                disclosed_qty: int = 0, offline_order: bool = False) -> dict:
    """Place an order. side: 1=Buy, -1=Sell. order_type: 1=Limit, 2=Market,
    3=SL, 4=SL-M. product_type: INTRADAY|CNC|MARGIN|CO|BO. symbol e.g.
    'NSE:SBIN-EQ'. GATED — only runs when FYERS_READONLY=0."""
    g = _trade_guard()
    if g:
        return g
    data = {"symbol": symbol, "qty": qty, "type": order_type, "side": side,
            "productType": product_type, "limitPrice": limit_price,
            "stopPrice": stop_price, "validity": validity,
            "disclosedQty": disclosed_qty, "offlineOrder": offline_order,
            "stopLoss": 0, "takeProfit": 0}
    return _client().place_order(data)


@mcp.tool()
def modify_order(order_id: str, order_type: Optional[int] = None,
                 qty: Optional[int] = None, limit_price: Optional[float] = None,
                 stop_price: Optional[float] = None) -> dict:
    """Modify a pending order by id. GATED — only runs when FYERS_READONLY=0."""
    g = _trade_guard()
    if g:
        return g
    data = {"id": order_id}
    if order_type is not None:
        data["type"] = order_type
    if qty is not None:
        data["qty"] = qty
    if limit_price is not None:
        data["limitPrice"] = limit_price
    if stop_price is not None:
        data["stopPrice"] = stop_price
    return _client().modify_order(data)


@mcp.tool()
def cancel_order(order_id: str) -> dict:
    """Cancel a pending order by id. GATED — only runs when FYERS_READONLY=0."""
    g = _trade_guard()
    if g:
        return g
    return _client().cancel_order({"id": order_id})


if __name__ == "__main__":
    mcp.run()
