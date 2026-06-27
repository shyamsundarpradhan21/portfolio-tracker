#!/usr/bin/env python3
"""Standalone local runner: decrypt -> parse -> push the PII-redacted ledger to Vercel KV.

The proven engine (engine.py) does ALL the parsing - this runner only adds: loading family
PANs from the gitignored .env into memory (never logged/echoed), a contract-note-number key,
the KV push, and REFUSE-ON-CHECKSUM-FAIL (unreconciled data is never sent).

    python run.py <pdf-or-folder>

PANs: scripts/contract-parser/.env only (gitignored, proven). KV creds: that .env or the
existing mcp/.kv.env. Pushes ledger:cn:<note-no> + adds the note to ledger:cn:index. Idempotent
(keyed on the contract-note number -> re-run overwrites, no duplicates). Does NOT touch the app.
"""
import os, sys, re, json, glob, hashlib, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine

# ---------- .env (PANs + optional KV creds) - loaded into memory, NEVER printed ----------
def load_env(path):
    out = {}
    try:
        with open(path, encoding="utf-8") as f:
            for line in f:
                if line.lstrip().startswith("#"):
                    continue
                m = re.match(r"\s*([A-Za-z0-9_]+)\s*=\s*(.*?)\s*$", line)
                if m:
                    out[m.group(1)] = m.group(2).strip().strip('"').strip("'")
    except FileNotFoundError:
        pass
    return out

def kv_creds(env):
    url = env.get("KV_REST_API_URL") or env.get("UPSTASH_REDIS_REST_URL")
    tok = env.get("KV_REST_API_TOKEN") or env.get("UPSTASH_REDIS_REST_TOKEN")
    if not (url and tok):                                   # fall back to the existing KV creds
        kv = load_env(os.path.join(HERE, "..", "..", "mcp", ".kv.env"))
        url = url or kv.get("KV_REST_API_URL") or kv.get("UPSTASH_REDIS_REST_URL")
        tok = tok or kv.get("KV_REST_API_TOKEN") or kv.get("UPSTASH_REDIS_REST_TOKEN")
    return url, tok

# ---------- KV key: the contract-note number (engine reads it from note CONTENT, not the filename) ----------
def derive_id(ledger):                                      # stable fallback when no CN-no in the note
    sig = ledger.get("broker", "") + "|" + "|".join(sorted(
        f"{f.get('trade_no') or ''}:{f.get('order_no') or ''}:{f.get('net_total')}" for f in ledger["fills"]))
    return f"{ledger.get('broker','x')}-{hashlib.sha1(sig.encode()).hexdigest()[:10]}"

# ---------- checksum gate ----------
def reconciles(ledger):
    """All present checksums PASS, and at least one actually ran (don't push unreconciled data)."""
    cs = ledger.get("checksum", {})
    ps = ledger.get("per_segment_checksum", {})
    if cs.get("pass") is False or any(v.get("pass") is False for v in ps.values()):
        return False
    return cs.get("pass") is True or any(v.get("pass") is True for v in ps.values())

# A note is HELD only when it RECONCILES (checksum passed => the charge TOTAL is complete and correct)
# but still carries unmapped labels. Those are SAFE to ignore iff none looks like a real charge line -
# in the messy old-Dhan layout they're fill-row noise (numeric order/ref IDs, NET/SUMMARY/TOTAL markers,
# Symbol/ISIN fragments). If ANY unmapped label could be a charge, stay HELD (never relax a maybe-charge).
_CHARGE_WORD = re.compile(r"brokerage|\bstt\b|\bctt\b|gst|stamp|sebi|turnover|transaction|clearing|ipft|duty|\btax\b|charge|levy|\bfee", re.I)
def unmapped_benign(labels):
    return all(not _CHARGE_WORD.search(str(lab or "")) for lab in labels)

# ---------- PII-redacted payload ----------
def payload_of(ledger, cn_no, low_conf_fills=False):
    # build_ledger output carries NO PAN / name / address. note_file embeds the ACCOUNT CODE
    # (e.g. YS59535/7BB93B) -> drop it; the contract-note number identifies the note.
    p = {k: v for k, v in ledger.items() if k != "note_file"}
    p["contract_note_no"] = cn_no
    if low_conf_fills:
        # reconciles on the TOTAL charges (what the dashboard merge uses) but the old layout makes the
        # per-fill detail unreliable - flag it so downstream never treats these fills as clean.
        p["fills_confidence"] = "low"
    return p

# ---------- KV (Upstash REST via stdlib; mirrors scripts/seed-portfolio-kv.mjs) ----------
def kv_cmd(url, tok, cmd):
    req = urllib.request.Request(url, data=json.dumps(cmd).encode(),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

# A daily CARRY / MTM note (open overnight F&O position): carries a CF row + margin, but NO executed
# trade (no BUY/SELL fill) and NO trade levy. It's inert for the charges merge - a recognised doc-type
# to EXCLUDE, not a parse failure or a refusal. A note with 0 trades but a real charge is NOT carry
# (it falls through to be flagged in scope).
_TRADE_LEVY = ("brokerage", "stt", "ctt", "exchange_txn", "igst", "cgst", "sgst", "sebi_turnover", "ipft", "clearing", "stamp_duty")
def is_carry_note(ledger):
    real = [f for f in (ledger.get("fills") or []) if f.get("side") in ("BUY", "SELL") and f.get("qty")]
    nt = (ledger.get("charges") or {}).get("net_total") or {}
    has_levy = any(abs(nt.get(k) or 0) > 0 for k in _TRADE_LEVY)
    return (not real) and (not has_levy)

def evaluate(path, dry, kv_url, kv_tok, verbose):
    """Parse one note -> a status dict for the batch tally. Push only if it reconciles AND has no
    unmapped charge labels (an unmapped label means the charge breakdown is incomplete -> HOLD for
    an adapter fix, never push). dry=True parses + reports but never pushes."""
    ledger, _entity = engine.build_ledger(path)
    base = os.path.basename(path)
    if ledger is None:
        return {"note": base, "status": "SKIP", "reason": "no CN_PW_* decrypts"}
    if verbose:
        print(engine.masked_summary(ledger))
        print(f"  trade_date: {ledger.get('trade_date') or 'NONE (date not found)'}")
    cn_no = ledger.get("contract_note_no") or derive_id(ledger)
    unmapped = ledger.get("unmapped_charge_labels") or []
    st = {"note": base, "broker": ledger.get("broker"), "date": ledger.get("trade_date"),
          "tax": ledger.get("tax_entity"), "cn": cn_no, "unmapped": unmapped, "reason": ""}
    if is_carry_note(ledger):
        st["status"], st["reason"] = "CARRY", "carried position / MTM - no trades, no charges (inert)"; return st
    if not reconciles(ledger):
        st["status"], st["reason"] = "REFUSED", "checksum FAIL"; return st
    if unmapped and not unmapped_benign(unmapped):
        st["status"], st["reason"] = "HELD", f"unmapped (possible charge) {unmapped[:3]}"; return st
    low_conf = bool(unmapped)   # benign unmapped -> charge TOTAL trusted (checksum passed); fills are not
    if dry:
        st["status"] = "OK"; st["reason"] = "dry-run" + (" (fills low-conf)" if low_conf else ""); return st
    if not (kv_url and kv_tok):
        st["status"], st["reason"] = "OK", "no KV creds (not pushed)"; return st
    try:
        r1 = kv_cmd(kv_url, kv_tok, ["SET", f"ledger:cn:{cn_no}", json.dumps(payload_of(ledger, cn_no, low_conf))])
        kv_cmd(kv_url, kv_tok, ["SADD", "ledger:cn:index", cn_no])
        st["status"] = "PUSHED" if r1.get("result") == "OK" else "KVFAIL"
        if st["status"] == "KVFAIL": st["reason"] = str(r1)[:80]
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        st["status"], st["reason"] = "KVERR", type(e).__name__
    return st

def main():
    flags = {a.lstrip("-").lower() for a in sys.argv[1:] if a.startswith("-")}
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    target = args[0] if args else None
    if not target or not os.path.exists(target):
        print("usage: python run.py <pdf-or-folder> [--dry-run] [--summary]"); sys.exit(1)
    dry = "dry-run" in flags or "n" in flags
    env = load_env(os.path.join(HERE, ".env"))
    pans = {k: v for k, v in env.items() if k.upper().startswith("CN_PW") and v}
    if not pans:
        print("no CN_PW_* in scripts/contract-parser/.env (copy .env.example and fill the PANs)."); sys.exit(2)
    for k, v in pans.items():
        os.environ[k] = v                                  # into memory for engine.detect_entity_pw; NEVER printed
    kv_url, kv_tok = kv_creds(env)
    if os.path.isdir(target):
        pdfs = sorted(set(glob.glob(os.path.join(target, "**", "*.pdf"), recursive=True) +   # recurse subfolders
                          glob.glob(os.path.join(target, "**", "*.PDF"), recursive=True)))
        pdfs = [p for p in pdfs if "annexure" not in os.path.basename(p).lower()]   # annexures aren't contract notes
    else:
        pdfs = [target]
    # one note -> verbose masked block; a batch (folder / --summary) -> one status line per note + tally
    summary = "summary" in flags or len(pdfs) > 1
    stats = []
    for p in pdfs:
        rel = os.path.relpath(p, target) if os.path.isdir(target) else os.path.basename(p)
        if not summary:
            print(f"\n##### {rel} #####")
        st = evaluate(p, dry, kv_url, kv_tok, verbose=not summary)
        st["rel"] = rel
        stats.append(st)
        if summary:
            print(f"  [{st['status']:7}] {(st.get('broker') or '?'):8} {(st.get('date') or '----------'):10} "
                  f"{(st.get('tax') or '-'):4} cn={st.get('cn') or '-'}" + (f"  <- {st['reason']}" if st['reason'] else ""))
    # ---- batch tally ----
    from collections import Counter
    tally = Counter(s["status"] for s in stats)
    print(f"\n===== BATCH TALLY ({'DRY-RUN' if dry else 'LIVE'}) =====")
    print(f"  attempted: {len(stats)}  |  " + "  ".join(f"{k}: {v}" for k, v in sorted(tally.items())))
    fails = [s for s in stats if s["status"] in ("REFUSED", "HELD", "KVFAIL", "KVERR", "SKIP")]
    if fails:
        print(f"  --- {len(fails)} not pushed (fix + re-run) ---")
        for s in fails:
            print(f"    {s['status']:7} {s.get('broker') or '?':8} {s['rel']}  <- {s['reason']}")

if __name__ == "__main__":
    main()
