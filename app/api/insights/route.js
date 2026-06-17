// Server-side AI insight generator. Accepts a COMPACT aggregates snapshot
// (one summary string per sleeve, built client-side — never full holdings
// books) and asks Claude for one analysis card per tab.
//
//   POST /api/insights   body: { asOf, usdInr, overview, indian, indianRisk,
//                                us, mutualFunds, fixedDeposits, algo }
//   → { insights: { overview, indian, us, mf, fd, trading,   // each {performance, outlook}
//                   indian_swot: {macro, s, w, o, t} } }
//
// Each tab card is a CRISP performance read + forward outlook (ONE sentence
// each), or empty when its data is missing. Flow: fetch a live macro snapshot
// from Perplexity (Sonar, web-grounded) → feed it plus the aggregates to Claude
// (Haiku) with a structured-output schema, so the macro views cite today's
// numbers instead of training memory. Fires only on the header ✨ refresh (one
// whole-app, user-paced call). Requires ANTHROPIC_API_KEY; PERPLEXITY_API_KEY
// is optional — without it the live-macro block is simply omitted.

import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Claude Haiku 4.5 — cheapest tier; right-sized for one-sentence insights.
// Isolated here so the model is a one-line change (Sonnet 4.6 if quality lags).
const MODEL = 'claude-haiku-4-5';

// Live macro is fetched from Perplexity Sonar (OpenAI-compatible endpoint,
// web-grounded). 'sonar' is the cheapest web-search tier — right for a terse
// numbers-only snapshot. Optional: no PERPLEXITY_API_KEY → macro block omitted.
const PPLX_URL = 'https://api.perplexity.ai/chat/completions';
const PPLX_MODEL = 'sonar';

async function fetchLiveMacro() {
  const key = process.env.PERPLEXITY_API_KEY;
  if (!key) return '';
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 12000); // never let search stall the whole call
  try {
    const res = await fetch(PPLX_URL, {
      method: 'POST',
      signal: ctrl.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: PPLX_MODEL,
        temperature: 0.1,
        max_tokens: 450,
        messages: [
          { role: 'system', content: 'You are a markets data terminal. Reply with ONLY current numbers, one terse line per item, no prose, no commentary.' },
          { role: 'user', content:
            'Latest India + global macro, one line each with the value and as-of date: ' +
            'Nifty 50 level & 1-day %; Sensex level & 1-day %; India 10Y G-sec yield; RBI repo rate; ' +
            'USD/INR; Brent crude $/bbl; gold $/oz; S&P 500 & Nasdaq levels & 1-day %; US fed funds target; ' +
            'FII/DII net equity flow (India, latest session); large-cap vs mid/small-cap tone.' },
        ],
      }),
    });
    if (!res.ok) return '';
    const j = await res.json();
    return (j?.choices?.[0]?.message?.content || '').trim();
  } catch {
    return ''; // timeout / network / bad key — degrade to no live macro
  } finally {
    clearTimeout(timer);
  }
}

const SYSTEM_PROMPT =
  'You are a sharp, macro-aware portfolio analyst. You receive a compact aggregates snapshot ' +
  'of a live portfolio plus a LIVE macro block fetched from the web moments ago. Ground every ' +
  'macro view in those CURRENT numbers, not memory. ' +
  'For each sleeve return TWO fields. "performance": the single most honest read of how it is ' +
  'actually doing — what is working or dragging, risk taken, benchmark-relative; name the weak ' +
  'spot plainly, never cheerlead. "outlook": the single highest-value forward point given ' +
  "today's macro and the positions. " +
  'Be CRISP — ONE sentence per field, ~15-20 words, high signal. Do NOT restate the figures we ' +
  'already display; give the READ, not a recap. No filler, no hedging boilerplate. ' +
  'Return an EMPTY STRING for any field whose data is missing — never fabricate prices or ' +
  'figures beyond the snapshot and the live macro block.';

// Structured-outputs schema — guarantees parseable JSON and replaces the old
// "Return JSON: {...}" prompt scaffold. Anthropic caps a schema at 16
// union-typed parameters (anyOf/nullable), so we avoid nullable fields
// entirely: every field is a required plain string, and an EMPTY string means
// "no data for this sleeve". The client (AnalysisCard) already treats an empty
// performance+outlook as absent, so empty strings render as no card.
const card = () => ({
  type: 'object',
  properties: { performance: { type: 'string' }, outlook: { type: 'string' } },
  required: ['performance', 'outlook'],
  additionalProperties: false,
});
const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    overview: card(),
    indian: card(),
    us: card(),
    mf: card(),
    fd: card(),
    trading: card(),
    indian_swot: {
      type: 'object',
      properties: {
        macro: { type: 'string' },
        s: { type: 'string' },
        w: { type: 'string' },
        o: { type: 'string' },
        t: { type: 'string' },
      },
      required: ['macro', 's', 'w', 'o', 't'],
      additionalProperties: false,
    },
  },
  required: ['overview', 'indian', 'us', 'mf', 'fd', 'trading', 'indian_swot'],
  additionalProperties: false,
};

const EMPTY = {
  overview: null, indian: null, us: null, mf: null, fd: null, trading: null,
  indian_swot: null,
};

function buildUserMessage(d, macroLive) {
  // No stale hardcoded fallbacks — a missing section is 'n/a', never an old figure.
  const s = (x) => (typeof x === 'string' && x.trim() ? x : 'n/a');
  const macro = (typeof macroLive === 'string' && macroLive.trim()) ? macroLive.trim() : '';
  return (
    `Portfolio snapshot as of ${s(d.asOf)} · USD/INR ${d.usdInr ?? 'n/a'}\n\n` +
    (macro
      ? `MACRO (LIVE — fetched from the web just now; ground all macro views in THESE numbers, not memory):\n${macro}\n\n`
      : `MACRO (LIVE): unavailable this run — keep macro views light and clearly general.\n\n`) +
    `OVERVIEW: ${s(d.overview)}\n` +
    `INDIAN EQUITY: ${s(d.indian)}\n` +
    `INDIAN RISK STATS: ${s(d.indianRisk)}\n` +
    `US EQUITY: ${s(d.us)}\n` +
    `MUTUAL FUNDS: ${s(d.mutualFunds)}\n` +
    `FIXED DEPOSITS: ${s(d.fixedDeposits)}\n` +
    `ALGO (tracked separately, excluded from net worth): ${s(d.algo)}\n\n` +
    `Return {performance, outlook} per sleeve — ONE crisp sentence each (~15-20 words), keyed: ` +
    `overview (whole book), indian (use the risk stats), us, mf (mutual funds), fd (fixed deposits), ` +
    `trading (the algo line). Also indian_swot: macro = one line on TODAY's backdrop using the ` +
    `live numbers above (Nifty level/move, repo rate, INR, crude, FII flows); s/w/o/t = ONE tight ` +
    `sentence each. Always populate indian_swot. Do NOT restate our figures — give the read, not a recap.`
  );
}

// Structured outputs should yield pure JSON; keep a tolerant parser as a
// safety net for refusals or truncation.
function parseInsights(text) {
  if (!text) return null;
  let t = text.trim();
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) t = fence[1].trim();
  const start = t.indexOf('{');
  const end = t.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  try {
    const obj = JSON.parse(t.slice(start, end + 1));
    const an = (x) => (x && typeof x === 'object')
      ? { performance: x.performance ?? null, outlook: x.outlook ?? null }
      : null;
    const sw = obj.indian_swot;
    const swot = (sw && typeof sw === 'object')
      ? { macro: sw.macro ?? null, s: sw.s ?? null, w: sw.w ?? null, o: sw.o ?? null, t: sw.t ?? null }
      : null;
    return {
      overview: an(obj.overview),
      indian: an(obj.indian),
      us: an(obj.us),
      mf: an(obj.mf),
      fd: an(obj.fd),
      trading: an(obj.trading),
      indian_swot: swot,
    };
  } catch {
    return null;
  }
}

export async function POST(request) {
  if (!process.env.ANTHROPIC_API_KEY) {
    // Degrade gracefully so the dashboard still renders without banners.
    return Response.json({ insights: EMPTY, note: 'ANTHROPIC_API_KEY not set' });
  }

  let data;
  try {
    data = await request.json();
  } catch {
    return Response.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  try {
    const macroLive = await fetchLiveMacro(); // live web macro via Perplexity (or '' if unavailable)
    const client = new Anthropic();
    const message = await client.messages.create({
      model: MODEL,
      // 6 cards x {performance, outlook} + a 5-field SWOT; crisp one-liners run
      // well under this, but 1200 once truncated verbose JSON (stop_reason
      // max_tokens) and the parse silently failed to all-null — 2048 is a safe
      // ceiling. Haiku output is cheap and refresh is manual (user-paced).
      max_tokens: 2048,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: INSIGHTS_SCHEMA } },
      messages: [{ role: 'user', content: buildUserMessage(data, macroLive) }],
    });

    const text = message.content
      .filter((b) => b.type === 'text')
      .map((b) => b.text)
      .join('');

    const insights = parseInsights(text) || EMPTY;
    return Response.json({ insights });
  } catch (e) {
    return Response.json(
      { insights: EMPTY, error: e?.message || 'insight generation failed' },
      { status: 200 },
    );
  }
}
