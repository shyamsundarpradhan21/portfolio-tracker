# Gmail ingestion — one-time setup (user-assisted)

Feeds the unified ingestion pipeline (`scripts/ingest-daemon.mjs`): when a broker
contract note / CAS mail lands under the `portfolio/tx` label, the LOCAL daemon
downloads the PDF attachment into `inbox/` and the parser registry takes it from
there. Documents and PANs never leave this machine.

Scope is **`gmail.readonly` ONLY** — the pipeline physically cannot modify, label,
or delete anything in the mailbox. Originals stay untouched forever; only the
downloaded clone is destroyed after a checksum-verified parse.

## Two modes — pick one

- **POLL-ONLY (default; no GCP billing, no card).** The daemon polls Gmail
  (`history.list`) on startup and every 15 minutes. Needs ONLY the OAuth desktop
  client (§3–4) + the Gmail label/filter (§8) + `--auth` (§9). **Skip §1, §2, §5,
  §6, §7** — no project, no Pub/Sub, no service account. Documents land within ~15
  min of arriving, which is ample for notes/CAS/payslips. This is the recommended
  path when the Google account has no billing account.
- **PUSH (optional; near-real-time).** Adds Gmail→Pub/Sub push on top. Requires a
  GCP project with a **billing account linked** (Pub/Sub sits in the free tier at
  ~$0 for this volume, but Google requires a card on file). Do the full §1–§9. The
  daemon auto-detects push: if `mcp/gmail/.sa.json` is present it arms `users.watch`
  + streams the pull subscription; if absent it runs poll-only. Switching later is
  just adding/removing that one file.

Everything below is clicked once. Poll-only ≈ 10 min; push ≈ 20 min.

---

## 1. Create the project  *(both modes — a project holds the OAuth client; automatable via `gcloud projects create`)*

1. Open https://console.cloud.google.com/ and sign in as **shyamsundar.pradhan21@gmail.com**.
2. Top bar → project selector → **New project**.
   - Name: `portfolio-ingest` (any name works; keep it obvious).
   - No organization → **Create**, then switch the selector to it.

## 2. Enable the APIs  *(Gmail API = both modes; Pub/Sub API = PUSH only)*

3. Left menu → **APIs & Services → Library**.
4. Search **Gmail API** → open → **Enable**. *(Both modes — the token can't call
   Gmail unless its project has this on. Automatable: `gcloud services enable
   gmail.googleapis.com`. No billing required.)*
5. *(PUSH only)* Search **Cloud Pub/Sub API** → open → **Enable**.

## 3. OAuth consent screen (needed before a client can be created)

6. **APIs & Services → OAuth consent screen**.
7. If prompted for user type: **External** → **Create** (with a personal Gmail there
   is no "Internal" option).
8. App name: `portfolio-ingest` · support email: your address · developer contact:
   your address → **Save and continue** through the remaining steps (no extra
   scopes needed here — the script requests its scope at auth time; no test-user
   additions needed beyond yourself: add **shyamsundar.pradhan21@gmail.com** as a
   test user if the form asks).
9. **IMPORTANT — publish the app:** on the consent-screen summary page click
   **Publish app** (status: *In production*). While an app stays in **Testing**
   mode, Google **expires its refresh tokens after ~7 days**, which would silently
   kill the daemon's Gmail access weekly. Publishing an app that only you use and
   that requests a sensitive-but-unverified scope just means you'll click through
   an "unverified app" warning ONCE during the one-time auth — that's expected and
   fine. (If Google's UI refuses to publish, leave it in Testing and expect to
   re-auth weekly — the daemon will tell you when the token dies.)

## 4. OAuth client (desktop) — the daemon's identity

10. **APIs & Services → Credentials → + Create credentials → OAuth client ID**.
11. Application type: **Desktop app**. Name: `ingest-daemon` → **Create**.
12. **Download JSON** on the created client → save it as exactly:
    `mcp/gmail/.client_secret.json`   (gitignored — never commit)

## 5. Pub/Sub topic — where Gmail pushes "new mail" events  *(PUSH mode only — skip for poll-only)*

13. Left menu → **Pub/Sub → Topics → + Create topic**.
    - Topic ID: `gmail-tx` → **Create** (leave "Add a default subscription" OFF —
      we create our own pull subscription next).
14. On the topic page → **Permissions** tab (or ⋮ → View permissions) →
    **+ Grant access**:
    - New principal: `gmail-api-push@system.gserviceaccount.com`
    - Role: **Pub/Sub → Pub/Sub Publisher**
    - **Save.**  (This is what lets *Gmail itself* publish into your topic.)

## 6. Pull subscription — what the local daemon drains  *(PUSH mode only — skip for poll-only)*

15. **Pub/Sub → Subscriptions → + Create subscription**.
    - Subscription ID: `gmail-tx-pull`
    - Topic: `gmail-tx`
    - Delivery type: **Pull** (the default — do NOT pick Push; nothing on this
      machine is exposed to the internet).
    - Everything else default → **Create**.

## 7. Service account key — the daemon's Pub/Sub credentials  *(PUSH mode only — skip for poll-only)*

16. **IAM & Admin → Service accounts → + Create service account**.
    - Name: `ingest-subscriber` → **Create and continue**.
    - Role: **Pub/Sub → Pub/Sub Subscriber** → **Continue** → **Done**.
    (Subscriber role only — this key can drain the queue and nothing else.)
17. Open the service account → **Keys** tab → **Add key → Create new key → JSON**
    → **Create**. Save the downloaded file as exactly:
    `mcp/gmail/.sa.json`   (gitignored — never commit)

## 8. Gmail filter + label — what gets pushed

18. In Gmail (web) → Settings gear → **See all settings → Labels → Create new
    label**: name it `portfolio/tx` (type it with the slash — Gmail nests it under
    a `portfolio` parent).
19. **Filters and Blocked Addresses → Create a new filter**:
    - From: `donotreply@camsonline.com OR distributor.services@kfintech.com OR
      noreply@dhan.co OR contractnote@fyers.in OR no-reply@upstox.com OR
      noreply@reports.zerodha.com`
      *(edit to the actual senders of YOUR contract notes + CAS mails — open a few
      recent ones and copy the exact From addresses; this list is a starting point)*
    - → **Create filter** → tick **Apply the label:** `portfolio/tx` (and nothing
      else — do NOT skip the inbox, do NOT archive) → **Create filter**.
    - Optionally tick "Also apply filter to matching conversations" to pre-label
      history for the backfill sweep.

## 9. Hand back to the pipeline

20. Confirm the required file(s) exist (all gitignored):
    - `mcp/gmail/.client_secret.json` — **required in both modes** (§4).
    - `mcp/gmail/.sa.json` — **PUSH mode only** (§7). Absent ⇒ the daemon runs
      poll-only automatically.
21. Tell Claude Code the setup is done. The one-time interactive auth
    (`node scripts/ingest-daemon.mjs --auth`) opens a browser, you approve the
    **read-only** Gmail scope (click through the unverified-app warning), and the
    refresh token lands in `mcp/gmail/.token.json` (gitignored). After that the
    daemon runs hands-free: poll-only catches up via `history.list` on startup +
    every 15 min; push mode additionally re-arms `users.watch` every 6 days.

## 10. Additional mailboxes (e.g. mom's Kite/Zerodha equity)

Some documents live in a DIFFERENT Google account — the INDIAN equity sleeve is
held in mom's Zerodha, whose contract notes go to *her* mailbox, not yours. The
daemon supports N accounts off the SAME OAuth client (§4) — each just gets its
own token + idempotency state, and all stream into the one `inbox/`.

Per extra account (label it e.g. `mom`):
1. `node scripts/ingest-daemon.mjs --auth mom` → the browser opens; sign in as
   **that account** (mom's Google login) and approve read-only. The token lands
   in `mcp/gmail/.token.mom.json` (gitignored).
2. In **that account's** Gmail, create the `portfolio/tx` label + a filter
   (§8) — e.g. `from:noreply@reports.zerodha.com` or
   `subject:"contract note" has:attachment filename:pdf`.
3. Restart the daemon. It auto-discovers every `.token*.json` and polls each
   mailbox; downloaded files carry the label in their manifest source
   (`gmail:mom:<msgId>`) so two mailboxes' message-ids never collide.
Backfill a specific account: `--backfill --account mom --from <date>`.

## File map (all gitignored, never committed)

| File | What | Written by |
|---|---|---|
| `mcp/gmail/.client_secret.json` | OAuth desktop client (step 12) | you (download) |
| `mcp/gmail/.sa.json` | Pub/Sub Subscriber service-account key (step 17) | you (download) |
| `mcp/gmail/.token.json` | OAuth refresh/access token | `--auth` flow |
| `data/gmail-state.json` | lastHistoryId + processed-message idempotency state | daemon |

## Troubleshooting

- **"Access blocked: app not verified"** during auth → click *Advanced → Go to
  portfolio-ingest (unsafe)*. It's your own app reading your own mail, read-only.
- **Daemon logs `invalid_grant` after ~a week** → the consent screen is still in
  Testing mode (step 9): publish it, then re-run `--auth` once.
- **No Pub/Sub messages arriving** → check the topic-permission grant (step 14)
  — a missing `gmail-api-push@…` Publisher grant is the classic cause; the
  daemon's startup `history.list` catch-up still finds the mail, so nothing is
  lost, it's just not instant.
