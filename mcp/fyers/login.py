#!/usr/bin/env python3
"""
Fyers unattended login (Playwright + TOTP seed).

Drives the Fyers v3 web login to mint the day's access token with NO human
interaction, then writes it to .token.json (the file the MCP server reads). Run
daily — a Fyers access token is valid only ~1 trading day.

WHY THIS EXISTS
  SEBI has the broker refresh-token APIs disabled, so an access token cannot be
  renewed silently — the only way to get a fresh one is to replay the full login.
  The only login factor that can be automated is an authenticator-app TOTP (the
  "Client ID" path); SMS-OTP cannot be automated — there is no seed.

ANTI-BOT NOTE
  Fyers shows a "Verify you are human" CAPTCHA to throwaway/headless browsers.
  We sidestep it the way a real browser does: a *persistent* profile (.pw-profile),
  real Chrome when available, and the AutomationControlled flag stripped. This is
  inherently best-effort — if Fyers tightens detection, fall back to a manual
  login (fyers_auth_url -> fyers_set_token) every ~15 days.

SECRETS (from .env beside this file, gitignored — never hard-code)
  FYERS_FY_ID      Fyers login Client ID (e.g. YS00000)
  FYERS_TOTP_SEED  base32 secret from External TOTP setup (the seed, not a code)
  FYERS_PIN        4-digit trading PIN
  FYERS_APP_ID / FYERS_SECRET_ID / FYERS_REDIRECT_URI  app credentials (env/.env)

Run:  python login.py --show     (headed; REQUIRED — the login's bot check refuses
                                   headless connections, so the scheduler runs this
                                   headed when you're logged in: a ~10s browser flash)
      python login.py            (headless — currently blocked, kept for testing)
On failure it saves a screenshot (login-error.png) beside this file.
"""
import os
import re
import sys
import json
from urllib.parse import urlparse, parse_qs

import pyotp
from playwright.sync_api import sync_playwright
from fyers_apiv3 import fyersModel

HERE        = os.path.dirname(os.path.abspath(__file__))
TOKEN_FILE  = os.path.join(HERE, ".token.json")
PROFILE_DIR = os.path.join(HERE, ".pw-profile")


def _load_env():
    """Load the adjacent .env (gitignored) without overriding real env vars, so a
    scheduled run is self-contained and doesn't depend on the launching shell."""
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

APP_ID       = os.environ.get("FYERS_APP_ID", "")
SECRET_ID    = os.environ.get("FYERS_SECRET_ID", "")
REDIRECT_URI = os.environ.get("FYERS_REDIRECT_URI", "https://127.0.0.1/fyers")
FY_ID        = os.environ.get("FYERS_FY_ID", "")
TOTP_SEED    = os.environ.get("FYERS_TOTP_SEED", "")
PIN          = os.environ.get("FYERS_PIN", "")

HEADFUL = "--show" in sys.argv
STEALTH = "Object.defineProperty(navigator,'webdriver',{get:()=>undefined});"
ARGS    = ["--disable-blink-features=AutomationControlled"]


def _log(*a):
    print("[fyers-login]", *a, flush=True)


def _launch(p):
    """Persistent, de-automated context — real Chrome if present, else the
    bundled Chromium. The persistent profile is what dodges the CAPTCHA."""
    common = dict(user_data_dir=PROFILE_DIR, headless=not HEADFUL, args=ARGS,
                  viewport={"width": 1280, "height": 800})
    try:
        ctx = p.chromium.launch_persistent_context(channel="chrome", **common)
    except Exception:
        ctx = p.chromium.launch_persistent_context(**common)
    ctx.add_init_script(STEALTH)
    return ctx


def _type_digits(page, digits):
    """Type into the Fyers OTP/PIN widget (a row of single-char boxes). Target
    only *visible* boxes — the previous step's hidden boxes linger in the DOM.
    Real keystrokes so the boxes auto-advance and React fires."""
    page.wait_for_timeout(900)
    box = page.locator(
        "input[type='number']:visible, input[type='tel']:visible, "
        "input[type='password']:visible, input[inputmode='numeric']:visible")
    box.first.click()
    page.keyboard.type(digits, delay=45)


def _confirm(page):
    for name in ("confirm", "verify", "submit", "login"):
        btn = page.get_by_role("button", name=re.compile(name, re.I))
        if btn.count() and btn.first.is_enabled():
            btn.first.click()
            return


def _try_human_check(page):
    """Cloudflare Turnstile checkbox lives in a cross-origin iframe; click it if
    the managed challenge escalated to interactive mode."""
    try:
        fl = page.frame_locator(
            "iframe[src*='challenges.cloudflare.com'], "
            "iframe[title*='Cloudflare'], iframe[title*='human']")
        cb = fl.locator("input[type='checkbox'], label, body")
        if cb.count():
            cb.first.click(timeout=1500)
    except Exception:
        pass


def _click_continue(page):
    """Wait for Turnstile to pass (Continue enables), nudging the interactive
    checkbox if it appears. Returns False if the challenge never cleared."""
    btn = page.get_by_role("button", name=re.compile("continue", re.I)).first
    for i in range(30):  # ~15s
        try:
            if btn.is_enabled():
                btn.click()
                return True
        except Exception:
            pass
        if i in (4, 10, 18):
            _try_human_check(page)
        page.wait_for_timeout(500)
    return False


def run():
    missing = [k for k, v in {
        "FYERS_APP_ID": APP_ID, "FYERS_SECRET_ID": SECRET_ID,
        "FYERS_FY_ID": FY_ID, "FYERS_TOTP_SEED": TOTP_SEED, "FYERS_PIN": PIN,
    }.items() if not v]
    if missing:
        _log("missing env:", ", ".join(missing))
        return 2

    session = fyersModel.SessionModel(
        client_id=APP_ID, redirect_uri=REDIRECT_URI, response_type="code",
        state="mcp", secret_key=SECRET_ID, grant_type="authorization_code")
    auth_url = session.generate_authcode()

    captured = {"code": None}

    def _scan(url):
        if captured["code"] or not url or "127.0.0.1/fyers" not in url:
            return
        q = parse_qs(urlparse(url).query)
        c = (q.get("auth_code") or q.get("code") or [None])[0]
        if c:
            captured["code"] = c

    def _on_route(route):
        # 127.0.0.1 serves nothing — capture the code, then fulfill so the
        # browser doesn't render a connection-refused page.
        _scan(route.request.url)
        try:
            route.fulfill(status=200, content_type="text/plain", body="ok")
        except Exception:
            pass

    def _wait_code(page, secs):
        # Three capture paths: the request hook, the route handler, and — most
        # robust — the address bar, which keeps the redirect URL (with the
        # auth_code) even when 127.0.0.1 fails to load.
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
        ctx = _launch(p)
        for attempt in range(1, 6):  # Turnstile is intermittent — retry the run
            page = ctx.new_page()
            page.on("request", lambda req: _scan(req.url))
            page.route(re.compile(r"127\.0\.0\.1/fyers"), _on_route)
            try:
                page.goto(auth_url, wait_until="domcontentloaded")
                page.get_by_role("radio", name="Client ID").click()
                page.get_by_role("textbox", name="Client ID").fill(FY_ID)
                if not _click_continue(page):
                    _log(f"attempt {attempt}: human-check did not clear, retrying")
                    page.close()
                    continue

                # TOTP — fresh code typed in-process (sub-second, beats the 30s window).
                page.wait_for_selector("input[type='number']", state="visible", timeout=15000)
                _type_digits(page, pyotp.TOTP(TOTP_SEED).now())
                try:
                    _confirm(page)
                except Exception:
                    pass

                # Either it redirects now or the 4-digit PIN screen appears.
                if not _wait_code(page, 6):
                    _type_digits(page, PIN)
                    try:
                        _confirm(page)   # the Login click fires the final redirect
                    except Exception:
                        pass
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

    code = captured["code"]
    if not code:
        _log("no auth_code captured — run with --show to watch (CAPTCHA or selector)")
        return 1

    session.set_token(code)
    resp = session.generate_token()
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
