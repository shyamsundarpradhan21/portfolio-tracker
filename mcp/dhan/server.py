#!/usr/bin/env python3
"""
Dhan MCP server (standalone) — exposes a Dhan account over the Model Context
Protocol so an MCP client (Claude Desktop / Claude Code) can read the book and,
ONLY when explicitly armed, place/cancel orders.

You run and own this process. It is not auto-wired into any agent's config.

SECURITY MODEL
  - Order tools are GATED: active only when DHAN_READONLY=0. The default is
    read-only, so the server cannot place/cancel orders until you deliberately
    arm it. (Order placement also needs a registered static IP — reads don't.)
  - Credentials come from .env / the environment, never hard-coded.
  - The DhanHQ access token is valid ~24h (SEBI). This server SELF-MINTS it on
    demand via the pure-API TOTP endpoint (no browser) — so there's no daily
    login and no scheduled task needed; it just refreshes itself when the cached
    token lapses. Needs DHAN_CLIENT_ID + DHAN_PIN + DHAN_TOTP_SEED (TOTP enabled
    once at Dhan Web > DhanHQ Trading APIs).

Built on the DhanHQ v2 REST API (https://dhanhq.co/docs/v2/).
"""
import os
import sys
import json
import time
from typing import Optional

import requests
import pyotp
from mcp.server.fastmcp import FastMCP

API        = "https://api.dhan.co/v2"
AUTH_URL   = "https://auth.dhan.co/app/generateAccessToken"
HERE       = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(HERE, ".token.json")


def _load_env():
    """Load the adjacent .env (gitignored) without overriding real env vars."""
    path = os.path.join(HERE, ".env")
    try:
        with open(path) as f:
            for line in f:
                line = line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                k, v = line.split("=", 1)
                os.environ.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass


_load_env()

CLIENT_ID = os.environ.get("DHAN_CLIENT_ID", "")
PIN       = os.environ.get("DHAN_PIN", "")
TOTP_SEED = os.environ.get("DHAN_TOTP_SEED", "")
# Default read-only. Set DHAN_READONLY=0 to arm order placement.
READONLY  = os.environ.get("DHAN_READONLY", "1") != "0"

mcp = FastMCP("dhan")

_state = {"token": None, "expiry": 0.0}


def _load_cached():
    try:
        with open(TOKEN_FILE) as f:
            d = json.load(f)
            return d.get("accessToken"), float(d.get("expiryTs") or 0)
    except Exception:
        return None, 0.0


def _save_cached(tok, expiry_ts):
    try:
        with open(TOKEN_FILE, "w") as f:
            json.dump({"accessToken": tok, "expiryTs": expiry_ts}, f)
    except Exception:
        pass


def _mint():
    """Mint a fresh 24h access token via the pure-API TOTP endpoint — no browser.
    Returns (token, expiry_ts) or None."""
    if not (CLIENT_ID and PIN and TOTP_SEED):
        print("[dhan-mint] no creds — set DHAN_CLIENT_ID/PIN/TOTP_SEED in .env", file=sys.stderr)
        return None
    try:
        totp = pyotp.TOTP(TOTP_SEED).now()
        r = requests.post(AUTH_URL, params={
            "dhanClientId": CLIENT_ID, "pin": PIN, "totp": totp}, timeout=20)
        j = r.json() if r.content else {}
        tok = (j or {}).get("accessToken")
        if tok:
            # Tokens are ~24h; re-mint conservatively after 23h rather than parse
            # the (timezone-ambiguous) expiryTime string. Minting is one cheap call.
            exp = time.time() + 23 * 3600
            _save_cached(tok, exp)
            return tok, exp
        # No token in the body → LOG WHY (rate limit / bad TOTP / …) instead of a bare
        # `except: pass`. A silently-swallowed miss stranded the F&O tape for a whole
        # trading day (06-Jul-2026). Log only the error field, NEVER the response
        # wholesale — it carries the access token on success.
        reason = str((j.get("errorType") or j.get("errorMessage") or j.get("message") or "")) if isinstance(j, dict) else ""
        print(f"[dhan-mint] no token — HTTP {r.status_code} {reason}".rstrip(), file=sys.stderr)
    except Exception as e:
        print(f"[dhan-mint] {type(e).__name__}: {e}", file=sys.stderr)
    return None


def _token():
    tok, exp = _state["token"], _state["expiry"]
    if not tok:
        tok, exp = _load_cached()
    if tok and exp and time.time() < exp - 60:
        _state["token"], _state["expiry"] = tok, exp
        return tok
    minted = _mint()
    if minted:
        _state["token"], _state["expiry"] = minted
        return minted[0]
    return tok  # stale fallback — better than nothing if the mint failed


def _need_auth() -> dict:
    return {"error": "not authenticated",
            "how": "Set DHAN_CLIENT_ID / DHAN_PIN / DHAN_TOTP_SEED in mcp/dhan/.env "
                   "(enable TOTP once at Dhan Web > DhanHQ Trading APIs)."}


def _get(path: str) -> dict:
    tok = _token()
    if not tok:
        return _need_auth()
    try:
        r = requests.get(API + path,
                         headers={"access-token": tok, "Content-Type": "application/json"},
                         timeout=20)
        return r.json()
    except Exception as e:
        return {"error": str(e)}


def _trade_guard() -> Optional[dict]:
    if READONLY:
        return {"error": "trading disabled",
                "how": "This server is read-only. Set DHAN_READONLY=0 to arm order "
                       "tools (also needs a registered static IP at DhanHQ)."}
    if not _token():
        return _need_auth()
    return None


# ── auth ─────────────────────────────────────────────────────────────────────
@mcp.tool()
def dhan_status() -> dict:
    """Whether the server can mint/has a usable access token and whether trading is armed."""
    tok = _token()
    return {"authenticated": bool(tok), "readonly": READONLY,
            "client_id_set": bool(CLIENT_ID), "totp_set": bool(TOTP_SEED)}


# ── read ─────────────────────────────────────────────────────────────────────
@mcp.tool()
def get_profile() -> dict:
    """Dhan account profile (segments, token validity, data plan)."""
    return _get("/profile")


@mcp.tool()
def get_funds() -> dict:
    """Fund limit / available margin."""
    return _get("/fundlimit")


@mcp.tool()
def get_holdings() -> dict:
    """Delivery holdings."""
    return _get("/holdings")


@mcp.tool()
def get_positions() -> dict:
    """Open positions (intraday + carryforward)."""
    return _get("/positions")


@mcp.tool()
def get_orderbook() -> dict:
    """Today's order book."""
    return _get("/orders")


@mcp.tool()
def get_trades() -> dict:
    """Today's executed trades."""
    return _get("/trades")


# ── trade (gated by DHAN_READONLY=0; also needs a static IP at DhanHQ) ────────
@mcp.tool()
def place_order(security_id: str, exchange_segment: str, transaction_type: str,
                quantity: int, order_type: str = "MARKET",
                product_type: str = "CNC", price: float = 0,
                trigger_price: float = 0, validity: str = "DAY") -> dict:
    """Place an order. transaction_type: BUY|SELL. order_type: MARKET|LIMIT|SL|SL-M.
    product_type: CNC|INTRADAY|MARGIN|MTF|CO|BO. exchange_segment e.g. NSE_EQ.
    security_id is Dhan's instrument id. GATED — only runs when DHAN_READONLY=0."""
    g = _trade_guard()
    if g:
        return g
    body = {"dhanClientId": CLIENT_ID, "transactionType": transaction_type,
            "exchangeSegment": exchange_segment, "productType": product_type,
            "orderType": order_type, "securityId": security_id,
            "quantity": quantity, "price": price, "triggerPrice": trigger_price,
            "validity": validity}
    try:
        r = requests.post(API + "/orders",
                          headers={"access-token": _token(),
                                   "Content-Type": "application/json"},
                          json=body, timeout=20)
        return r.json()
    except Exception as e:
        return {"error": str(e)}


@mcp.tool()
def cancel_order(order_id: str) -> dict:
    """Cancel a pending order by id. GATED — only runs when DHAN_READONLY=0."""
    g = _trade_guard()
    if g:
        return g
    try:
        r = requests.delete(API + f"/orders/{order_id}",
                            headers={"access-token": _token(),
                                     "Content-Type": "application/json"},
                            timeout=20)
        return r.json()
    except Exception as e:
        return {"error": str(e)}


if __name__ == "__main__":
    mcp.run()
