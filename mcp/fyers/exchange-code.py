#!/usr/bin/env python3
"""Manual Fyers token exchange — the documented fallback for when the automated
login (login.py) can't clear Fyers' Cloudflare/Turnstile on the redesigned login
page (a real human browser session passes the bot-check the automation can't).

USE WHEN login.py fails:
  1. Open this auth URL in your NORMAL browser (where you're a logged-in human),
     and sign in with Client ID + TOTP + PIN:

       https://api-t1.fyers.in/api/v3/generate-authcode?client_id=OCDP3HI2P7-100&redirect_uri=https%3A%2F%2F127.0.0.1%2Ffyers&response_type=code&state=mcp

  2. After login it redirects to
        https://127.0.0.1/fyers?auth_code=...&state=mcp
     The page WON'T load (nothing serves 127.0.0.1) — that's expected. The
     address bar holds the auth_code.
  3. Copy that whole URL (or just the auth_code) and run, from mcp/fyers/:
        .venv\\Scripts\\python.exe exchange-code.py "<redirect-url-or-auth_code>"

  → writes .token.json (access_token + refresh_token), exactly like login.py,
    so the capture daemon picks up Fyers on its next tick.
"""
import os
import sys
import json
from urllib.parse import urlparse, parse_qs

from fyers_apiv3 import fyersModel

HERE = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE = os.path.join(HERE, ".token.json")


def _load_env():
    try:
        with open(os.path.join(HERE, ".env")) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#") and "=" in line:
                    k, v = line.split("=", 1)
                    os.environ.setdefault(k.strip(), v.strip())
    except FileNotFoundError:
        pass


_load_env()
APP_ID       = os.environ.get("FYERS_APP_ID", "")
SECRET_ID    = os.environ.get("FYERS_SECRET_ID", "")
REDIRECT_URI = os.environ.get("FYERS_REDIRECT_URI", "https://127.0.0.1/fyers")


def _extract_code(arg):
    """Accept either the full redirect URL or a bare auth_code."""
    if "auth_code=" in arg or "code=" in arg or arg.startswith("http"):
        q = parse_qs(urlparse(arg).query)
        return (q.get("auth_code") or q.get("code") or [None])[0]
    return arg.strip()


def main():
    if len(sys.argv) < 2:
        print('usage: python exchange-code.py "<redirect-url-or-auth_code>"')
        return 2
    for k, v in {"FYERS_APP_ID": APP_ID, "FYERS_SECRET_ID": SECRET_ID}.items():
        if not v:
            print("missing env:", k)
            return 2
    code = _extract_code(sys.argv[1])
    if not code:
        print("no auth_code found in the argument")
        return 1
    session = fyersModel.SessionModel(
        client_id=APP_ID, redirect_uri=REDIRECT_URI, response_type="code",
        state="mcp", secret_key=SECRET_ID, grant_type="authorization_code")
    session.set_token(code)
    resp = session.generate_token()
    at = (resp or {}).get("access_token")
    rt = (resp or {}).get("refresh_token")
    if not at:
        print("token exchange failed:", resp)
        return 1
    with open(TOKEN_FILE, "w") as f:
        json.dump({"access_token": at, "refresh_token": rt}, f)
    print("ok — token minted and written to .token.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
