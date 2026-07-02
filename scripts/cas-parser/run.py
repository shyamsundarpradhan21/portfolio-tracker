#!/usr/bin/env python3
"""Standalone local runner: decrypt+parse a CAS (CAMS/KFintech) PDF via casparser,
validate (refuse-on-fail), REDACT, and push the derived MF ledger to Vercel KV.

Mirrors scripts/contract-parser/run.py: passwords live ONLY in the gitignored
.env (CAS_PW_* — CAS PDFs are usually PAN- or PAN+DOB-keyed), loaded into memory
and never logged/echoed. The raw statement is never persisted or pushed.

    python run.py <pdf-or-folder> [--dry-run] [--summary] [--porcelain]

Pushes  KV ledger:mf:<naturalKey>  (+ SADD ledger:mf:index) where naturalKey =
statement period + folio-set hash (engine.natural_key). Idempotent: the same
document re-run overwrites its own key. REFUSES to push when validation fails
(a scheme's printed close doesn't reconcile with casparser's recomputed close,
no folios, unparseable period, wrong/no password).

--porcelain prints ONE machine-readable JSON line per file for the ingest
registry wrapper: {"status": "PASS|FAIL", "key": ..., "target": ..., "reason": ...}
"""
import os, sys, re, glob, json

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import engine


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
    if not (url and tok):
        kv = load_env(os.path.join(HERE, "..", "..", "mcp", ".kv.env"))
        url = url or kv.get("KV_REST_API_URL") or kv.get("UPSTASH_REDIS_REST_URL")
        tok = tok or kv.get("KV_REST_API_TOKEN") or kv.get("UPSTASH_REDIS_REST_TOKEN")
    return url, tok


def kv_cmd(url, tok, cmd):
    import urllib.request
    req = urllib.request.Request(url, data=json.dumps(cmd).encode(),
        headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json"}, method="POST")
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode())


def normalize_cas(cas):
    """casparser returns a pydantic CASData even with output='dict' (seen live on
    1.2.1 and 0.8.1). Normalize to JSON-safe primitives — mode='json' matters:
    engine's validators/redactors compare plain dict/str/float shapes."""
    if hasattr(cas, "model_dump"):
        return cas.model_dump(mode="json")
    if hasattr(cas, "dict"):
        return cas.dict()
    return cas


def parse_with_passwords(path, passwords):
    """Try each CAS_PW_* until one decrypts. -> (cas_dict, None) | (None, reason)."""
    from casparser import read_cas_pdf
    from casparser.exceptions import IncorrectPasswordError
    last = "no CAS_PW_* decrypts"
    for pw in passwords:
        try:
            return normalize_cas(read_cas_pdf(path, pw, output="dict")), None
        except IncorrectPasswordError:
            continue
        except Exception as e:                       # noqa: BLE001 — casparser raises various parse errors
            last = f"{type(e).__name__}: {e}"
            break
    return None, last


def evaluate(path, passwords, dry, kv_url, kv_tok):
    """ONE porcelain row per file, ALWAYS — an unhandled exception anywhere in
    the parse/validate/redact/push chain degrades to a FAIL row, never a
    traceback (a traceback exits 1 and the daemon can only report the useless
    'no porcelain status' — the exact P1 shape hit live on the real CAS)."""
    base = os.path.basename(path)
    # `parsed` = did casparser STRUCTURALLY parse this file (a CAS_PW opened it AND
    # it was a real CAS)? It is the CLAIM signal the ingest decrypt-probe reads:
    # a wrong password OR a decrypted-but-not-a-CAS file leaves parsed=False, so
    # the probe declines and tries the next password-holding parser.
    st = {"note": base, "status": "FAIL", "key": None, "target": None, "reason": "", "parsed": False}
    try:
        cas, err = parse_with_passwords(path, passwords)
        st["parsed"] = cas is not None
        if cas is None:
            st["reason"] = err
            return st
        v = engine.validate(cas)
        key = engine.natural_key(cas)
        st["key"] = key
        if not v["pass"]:
            st["reason"] = "; ".join(v["errors"])[:300]
            return st
        payload = engine.redact(cas)
        payload["validation"] = {"pass": True, "warnings": v["warnings"]}
        st["target"] = f"ledger:mf:{key}"
        if dry:
            st["status"] = "PASS"
            st["reason"] = "dry-run (not pushed)"
            return st
        if not (kv_url and kv_tok):
            st["status"] = "PASS"
            st["reason"] = "no KV creds (parsed, not pushed)"
            return st
        r1 = kv_cmd(kv_url, kv_tok, ["SET", f"ledger:mf:{key}", json.dumps(payload)])
        kv_cmd(kv_url, kv_tok, ["SADD", "ledger:mf:index", key])
        st["status"] = "PASS" if r1.get("result") == "OK" else "FAIL"
        if st["status"] == "FAIL":
            st["reason"] = f"KV: {str(r1)[:120]}"
    except Exception as e:                           # noqa: BLE001 — crash-to-FAIL, never a traceback
        st["status"] = "FAIL"
        st["reason"] = f"unhandled {type(e).__name__}: {e}"[:300]
    return st


def main():
    flags = {a.lstrip("-").lower() for a in sys.argv[1:] if a.startswith("-")}
    args = [a for a in sys.argv[1:] if not a.startswith("-")]
    target = args[0] if args else None
    if not target or not os.path.exists(target):
        print("usage: python run.py <pdf-or-folder> [--dry-run] [--summary] [--porcelain]")
        sys.exit(1)
    dry = "dry-run" in flags or "n" in flags
    porcelain = "porcelain" in flags
    env = load_env(os.path.join(HERE, ".env"))
    passwords = [v for k, v in env.items() if k.upper().startswith("CAS_PW") and v]
    if not passwords:
        if porcelain:
            print(json.dumps({"status": "FAIL", "reason": "no CAS_PW_* in scripts/cas-parser/.env"}))
        else:
            print("no CAS_PW_* in scripts/cas-parser/.env (copy .env.example and fill it).")
        sys.exit(2)
    kv_url, kv_tok = kv_creds(env)

    if os.path.isdir(target):
        pdfs = sorted(set(glob.glob(os.path.join(target, "**", "*.pdf"), recursive=True) +
                          glob.glob(os.path.join(target, "**", "*.PDF"), recursive=True)))
    else:
        pdfs = [target]

    fails = 0
    for p in pdfs:
        st = evaluate(p, passwords, dry, kv_url, kv_tok)
        if porcelain:
            print(json.dumps(st))
        else:
            mark = "PASS " if st["status"] == "PASS" else "FAIL "
            line = f"  [{mark}] {st['note']}  key={st['key'] or '-'}"
            if st["reason"]:
                line += f"  <- {st['reason']}"
            print(line)
        fails += st["status"] != "PASS"
    sys.exit(1 if fails else 0)


if __name__ == "__main__":
    main()
