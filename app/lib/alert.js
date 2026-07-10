// Push a one-line ops alert to the configured channel. Telegram today; the function name
// is channel-agnostic so a future swap (email / ntfy / Pushover) is a one-file change.
//
// GRACEFUL NO-OP when creds are absent — same pattern as the KV client. Without
// TELEGRAM_BOT_TOKEN + TELEGRAM_CHAT_ID in the env it returns false and sends nothing, so
// the cron degrades silently in any environment that hasn't been wired up (local dev,
// previews, and prod before the one-time setup). Setup: create a bot via @BotFather, set
// those two env vars in Vercel; nothing else changes.

export async function sendAlert(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return false;              // not configured → no-op
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
      signal: AbortSignal.timeout(8000),
    });
    return res.ok;
  } catch {
    return false;                                    // a down channel must never break the caller
  }
}

// Is an alert channel configured? Lets a caller skip the staleness computation entirely
// when there's nowhere to send (and lets a health route report its own readiness).
export const alertConfigured = () => !!(process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_CHAT_ID);

// Dead-man's-switch. The Telegram alert can't fire if the cron itself never runs (Vercel
// Hobby drops ~35% of nights) — nothing would be there to send it. So on each successful
// run we ping a HEALTHCHECK_URL (e.g. healthchecks.io): that service pages YOU when a ping
// DOESN'T arrive within its window. This is the only thing that watches the watcher.
// No-op (returns false) without HEALTHCHECK_URL — same graceful pattern as the alert.
export async function pingHealthcheck() {
  const url = process.env.HEALTHCHECK_URL;
  if (!url) return false;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
    return res.ok;
  } catch {
    return false;                                    // a down pinger must never break the caller
  }
}
