#!/usr/bin/env python3
"""
Upstox unattended login (Playwright + TOTP seed).

Drives the Upstox v2 OAuth dialog to mint the day's access token with NO human
interaction, then writes it to .token.json (the file the MCP server reads). Run
daily — an Upstox access token expires ~3:30am IST.

Flow (confirmed against the live login.upstox.com dialog):
  mobile (#mobileNum) -> Get OTP -> OTP/TOTP (#otpNum, accepts the authenticator
  TOTP, no SMS) -> Continue -> 6-digit PIN -> Continue -> redirect ?code=...

Unlike Fyers there's no Cloudflare human-check, so a plain headless browser works
— no persistent profile / real-Chrome needed.

SECRETS (from .env beside this file, gitignored — never hard-code)
  UPSTOX_CLIENT_ID / UPSTOX_CLIENT_SECRET / UPSTOX_REDIRECT_URI   app credentials
  UPSTOX_MOBILE         10-digit login mobile number
  UPSTOX_TOTP_SEED      base32 secret from Time-based OTP setup (the seed)
  UPSTOX_PIN            6-digit PIN

Run:  python login.py            (headless — for the scheduler)
      python login.py --show     (headed — for debugging)
On failure it saves a screenshot (login-error.png) beside this file.
"""
import os
import re
import sys
import json
from urllib.parse import urlparse, parse_qs, urlencode

import pyotp
import requests
from playwright.sync_api import sync_playwright

API         = "https://api.upstox.com"
HERE        = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE  = os.path.join(HERE, ".token.json")


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

CLIENT_ID    = os.environ.get("UPSTOX_CLIENT_ID", "")
CLIENT_SECRET= os.environ.get("UPSTOX_CLIENT_SECRET", "")
REDIRECT_URI = os.environ.get("UPSTOX_REDIRECT_URI", "https://127.0.0.1/upstox")
MOBILE       = os.environ.get("UPSTOX_MOBILE", "")
TOTP_SEED    = os.environ.get("UPSTOX_TOTP_SEED", "")
PIN          = os.environ.get("UPSTOX_PIN", "")

HEADFUL = "--show" in sys.argv
ARGS    = ["--disable-blink-features=AutomationControlled", "--no-sandbox"]


def _log(*a):
    print("[upstox-login]", *a, flush=True)


def _exchange(code):
    r = requests.post(API + "/v2/login/authorization/token",
                      headers={"Accept": "application/json",
                               "Content-Type": "application/x-www-form-urlencoded"},
                      data={"code": code, "client_id": CLIENT_ID,
                            "client_secret": CLIENT_SECRET,
                            "redirect_uri": REDIRECT_URI,
                            "grant_type": "authorization_code"}, timeout=20)
    try:
        return r.json()
    except Exception:
        return {"error": "non-json token response", "status": r.status_code}


def run():
    missing = [k for k, v in {
        "UPSTOX_CLIENT_ID": CLIENT_ID, "UPSTOX_CLIENT_SECRET": CLIENT_SECRET,
        "UPSTOX_MOBILE": MOBILE, "UPSTOX_TOTP_SEED": TOTP_SEED, "UPSTOX_PIN": PIN,
    }.items() if not v]
    if missing:
        _log("missing env:", ", ".join(missing))
        return 2

    auth_url = API + "/v2/login/authorization/dialog?" + urlencode({
        "response_type": "code", "client_id": CLIENT_ID,
        "redirect_uri": REDIRECT_URI, "state": "mcp"})

    captured = {"code": None}

    def _scan(url):
        if captured["code"] or not url or "127.0.0.1/upstox" not in url:
            return
        c = (parse_qs(urlparse(url).query).get("code") or [None])[0]
        if c:
            captured["code"] = c

    def _on_route(route):
        _scan(route.request.url)
        try:
            route.fulfill(status=200, content_type="text/plain", body="ok")
        except Exception:
            pass

    def _wait_code(page, secs):
        for _ in range(secs * 2):
            if captured["code"]:
                return True
            try:
                _scan(page.url)
            except Exception:
                pass
            page.wait_for_timeout(500)
        return bool(captured["code"])

    with sync_playwright() as p:
        browser = p.chromium.launch(headless=not HEADFUL, args=ARGS)
        ctx = browser.new_context(viewport={"width": 1280, "height": 800})
        for attempt in range(1, 4):
            page = ctx.new_page()
            page.on("request", lambda req: _scan(req.url))
            page.route(re.compile(r"127\.0\.0\.1/upstox"), _on_route)
            try:
                page.goto(auth_url, wait_until="domcontentloaded")

                # Step 1 — mobile, then request the OTP step.
                page.fill("#mobileNum", MOBILE)
                page.get_by_role("button", name=re.compile("get otp", re.I)).click()

                # Step 2 — the field takes the authenticator TOTP (or an SMS OTP).
                page.fill("#otpNum", pyotp.TOTP(TOTP_SEED).now())
                page.get_by_role("button", name=re.compile(r"^continue$", re.I)).click()

                # Step 3 — 6-digit PIN, then it redirects with ?code=.
                pin = page.get_by_role("textbox", name=re.compile("PIN", re.I))
                pin.fill(PIN)
                page.get_by_role("button", name=re.compile(r"^continue$", re.I)).click()

                _wait_code(page, 20)
            except Exception as e:
                try:
                    page.screenshot(path=os.path.join(HERE, "login-error.png"))
                except Exception:
                    pass
                _log(f"attempt {attempt} error:", repr(e))

            if captured["code"]:
                _log(f"auth_code captured on attempt {attempt}")
                page.close()
                break
            page.close()
        ctx.close()
        browser.close()

    code = captured["code"]
    if not code:
        _log("no code captured — run with --show to watch (selectors/2FA)")
        return 1

    resp = _exchange(code)
    at = (resp or {}).get("access_token")
    if not at:
        _log("token exchange failed:", resp)
        return 1
    with open(TOKEN_FILE, "w") as f:
        json.dump({"access_token": at}, f)
    _log("ok — daily access token minted")
    return 0


if __name__ == "__main__":
    sys.exit(run())
