# Gmail ingestion — one-time GCP setup (user-assisted)

Feeds the unified ingestion pipeline (`scripts/ingest-daemon.mjs`): Gmail pushes a
Pub/Sub notification when a broker contract note / CAS mail lands, the LOCAL daemon
pulls it (streaming pull — **no public webhook**, documents and PANs never leave this
machine), downloads the PDF attachment into `inbox/`, and the parser registry takes
it from there.

Scope is **`gmail.readonly` ONLY** — the pipeline physically cannot modify, label,
or delete anything in the mailbox. Originals stay untouched forever; only the
downloaded clone is destroyed after a checksum-verified parse.

Everything below is clicked once. Allow ~20 minutes.

---

## 1. Create the project

1. Open https://console.cloud.google.com/ and sign in as **shyamsundar.pradhan21@gmail.com**.
2. Top bar → project selector → **New project**.
   - Name: `portfolio-ingest` (any name works; keep it obvious).
   - No organization → **Create**, then switch the selector to it.

## 2. Enable the two APIs

3. Left menu → **APIs & Services → Library**.
4. Search **Gmail API** → open → **Enable**.
5. Search **Cloud Pub/Sub API** → open → **Enable**.

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

## 5. Pub/Sub topic — where Gmail pushes "new mail" events

13. Left menu → **Pub/Sub → Topics → + Create topic**.
    - Topic ID: `gmail-tx` → **Create** (leave "Add a default subscription" OFF —
      we create our own pull subscription next).
14. On the topic page → **Permissions** tab (or ⋮ → View permissions) →
    **+ Grant access**:
    - New principal: `gmail-api-push@system.gserviceaccount.com`
    - Role: **Pub/Sub → Pub/Sub Publisher**
    - **Save.**  (This is what lets *Gmail itself* publish into your topic.)

## 6. Pull subscription — what the local daemon drains

15. **Pub/Sub → Subscriptions → + Create subscription**.
    - Subscription ID: `gmail-tx-pull`
    - Topic: `gmail-tx`
    - Delivery type: **Pull** (the default — do NOT pick Push; nothing on this
      machine is exposed to the internet).
    - Everything else default → **Create**.

## 7. Service account key — the daemon's Pub/Sub credentials

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

20. Confirm these two files exist (both are gitignored):
    - `mcp/gmail/.client_secret.json`
    - `mcp/gmail/.sa.json`
21. Tell Claude Code the setup is done. The one-time interactive auth
    (`node scripts/ingest-daemon.mjs --auth`) opens a browser, you approve the
    **read-only** Gmail scope (click through the unverified-app warning), and the
    refresh token lands in `mcp/gmail/.token.json` (gitignored). After that the
    daemon runs hands-free: it re-arms the Gmail `users.watch` on startup and
    every 6 days, and catches up any gap via `history.list` after every wake.

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
