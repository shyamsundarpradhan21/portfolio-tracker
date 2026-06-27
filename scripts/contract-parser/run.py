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

# ---------- contract-note number (KV key) - from note CONTENT, not the account-coded filename ----------
CN_RE = re.compile(r"contract\s*note\s*(?:no|number)\.?\s*[:#-]?\s*([A-Za-z0-9/_-]{3,})", re.I)

def contract_note_no(path):
    pdf, _ = engine.open_decrypted(path)
    if pdf is None:
        return None
    with pdf:
        m = CN_RE.search(engine.full_text(pdf))
    return re.sub(r"[^A-Za-z0-9]", "-", m.group(1)).strip("-") if m else None

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

# ---------- PII-redacted payload ----------
def payload_of(ledger, cn_no):
    # build_ledger output carries NO PAN / name / address. note_file embeds the ACCOUNT CODE
    # (e.g. YS59535/7BB93B) -> drop it; the contract-note number identifies the note.
    p = {k: v for k, v in ledger.items() if k != "note_file"}
    p["contract_note_no"] = cn_no
    return p

# ---------- KV (Upstash REST via stdlib; mirrors scripts/seed-portfolio-kv.mjs) ----------
def kv_cmd(url, tok, cmd):
    req = urllib.request.Request(url, data=json.dumps(cmd).encode(),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())

def process(path, kv_url, kv_tok):
    ledger, _entity = engine.build_ledger(path)
    if ledger is None:
        print("  no CN_PW_* env var decrypts this note - skipped (check the PAN/scheme)."); return
    print(engine.masked_summary(ledger))                   # already masked (no PAN/name/amounts)
    cn_no = contract_note_no(path) or derive_id(ledger)
    if not reconciles(ledger):
        print(f"  REFUSED to push (checksum FAIL / unreconciled) - nothing sent to KV."); return
    if not (kv_url and kv_tok):
        print(f"  parsed + reconciled OK, but NO KV creds -> NOT pushed (set KV creds to push)."); return
    key = f"ledger:cn:{cn_no}"
    try:
        r1 = kv_cmd(kv_url, kv_tok, ["SET", key, json.dumps(payload_of(ledger, cn_no))])
        kv_cmd(kv_url, kv_tok, ["SADD", "ledger:cn:index", cn_no])
        print(f"  pushed -> KV {key}" if r1.get("result") == "OK" else f"  KV push FAILED: {str(r1)[:120]}")
    except (urllib.error.URLError, urllib.error.HTTPError, TimeoutError) as e:
        print(f"  KV push error ({type(e).__name__}) - not pushed.")

def main():
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    target = args[0] if args else None
    if not target or not os.path.exists(target):
        print("usage: python run.py <pdf-or-folder>"); sys.exit(1)
    env = load_env(os.path.join(HERE, ".env"))
    pans = {k: v for k, v in env.items() if k.upper().startswith("CN_PW") and v}
    if not pans:
        print("no CN_PW_* in scripts/contract-parser/.env (copy .env.example and fill the PANs)."); sys.exit(2)
    for k, v in pans.items():
        os.environ[k] = v                                  # into memory for engine.detect_entity_pw; NEVER printed
    kv_url, kv_tok = kv_creds(env)
    if os.path.isdir(target):
        pdfs = sorted(set(glob.glob(os.path.join(target, "*.pdf")) + glob.glob(os.path.join(target, "*.PDF"))))
    else:
        pdfs = [target]
    for p in pdfs:
        print(f"\n##### {os.path.basename(p)} #####")
        process(p, kv_url, kv_tok)

if __name__ == "__main__":
    main()
