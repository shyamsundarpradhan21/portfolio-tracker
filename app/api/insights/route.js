// Server-side AI insight generator. Accepts a COMPACT aggregates snapshot
// (one summary string per sleeve, built client-side — never full holdings
// books) and asks Claude for one analysis card per tab.
//
//   POST /api/insights   body: { asOf, usdInr, overview, indian, indianRisk,
//                                us, usRisk, mutualFunds, fixedDeposits, algo }
//   → { insights: { pulse, overview, indian, us, mf, fd, trading, // each {performance, outlook}
//                   indian_swot, us_swot } }   // *_swot = {macro, s, w, o, t}
//
// Each tab card is a CRISP, NUMBER-FREE performance read + forward outlook (ONE
// sentence each, macro-framed — figures stay in pulse/swot.macro), or empty when
// its data is missing. Flow: pull a live macro snapshot of
// real index/FX/commodity/yield quotes from Yahoo Finance (free, no key — the
// same source /api/quotes uses) → feed it plus the aggregates to Claude (Haiku)
// with a structured-output schema, so the macro views cite today's numbers
// instead of training memory. Fires only on the header ✨ refresh (one
// whole-app, user-paced call). Requires only the ANTHROPIC_API_KEY env var.

import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Claude Haiku 4.5 — cheapest tier; right-sized for one-sentence insights.
// Isolated here so the model is a one-line change (Sonnet 4.6 if quality lags).
const MODEL = 'claude-haiku-4-5';

// Live macro = real quotes from Yahoo Finance v8 (free, no API key). We only
// need a handful of specific backdrop numbers, so direct quotes beat an LLM
// web-search: cheaper (free), faster, and exact rather than summarised.
const YH_HOSTS = ['https://query1.finance.yahoo.com', 'https://query2.finance.yahoo.com'];
const YH_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MACRO_SYMBOLS = [
  { sym: '^NSEI',  label: 'Nifty 50' },
  { sym: '^BSESN', label: 'Sensex' },
  { sym: 'INR=X',  label: 'USD/INR', kind: 'fx' },
  { sym: '^GSPC',  label: 'S&P 500' },
  { sym: '^IXIC',  label: 'Nasdaq' },
  { sym: 'BZ=F',   label: 'Brent crude ($/bbl)' },
  { sym: 'GC=F',   label: 'Gold ($/oz)' },
  { sym: '^TNX',   label: 'US 10Y yield', kind: 'yield' },
];

async function yhQuote(symbol) {
  const path = `/v8/finance/chart/${encodeURIComponent(symbol)}?interval=1d&range=1d`;
  for (const host of YH_HOSTS) {
    try {
      const res = await fetch(host + path, {
        headers: { 'User-Agent': YH_UA, Accept: 'application/json' },
        cache: 'no-store',
        signal: AbortSignal.timeout(6000),
      });
      if (!res.ok) continue;
      const meta = (await res.json())?.chart?.result?.[0]?.meta;
      if (!meta || typeof meta.regularMarketPrice !== 'number') continue;
      const price = meta.regularMarketPrice;
      const prev = meta.chartPreviousClose ?? meta.previousClose ?? meta.regularMarketPreviousClose ?? price;
      return { price, pct: prev ? ((price - prev) / prev) * 100 : null };
    } catch { /* try next host */ }
  }
  return null;
}

// Returns a terse, newline-delimited block of real current macro numbers, or
// '' if every quote failed (then the analysis runs without a live macro block).
async function fetchLiveMacro() {
  try {
    const rows = await Promise.all(MACRO_SYMBOLS.map(async (m) => {
      const q = await yhQuote(m.sym);
      if (!q) return null;
      const px = m.kind === 'fx' ? q.price.toFixed(2)
        : m.kind === 'yield' ? q.price.toFixed(2) + '%'
        : q.price.toLocaleString('en-US', { maximumFractionDigits: 2 });
      const mv = q.pct == null ? '' : ` (${q.pct >= 0 ? '+' : ''}${q.pct.toFixed(2)}% 1d)`;
      return `${m.label}: ${px}${mv}`;
    }));
    const lines = rows.filter(Boolean);
    return lines.length ? lines.join('\n') : '';
  } catch {
    return '';
  }
}

const SYSTEM_PROMPT =
  'You are a sharp, macro-aware portfolio analyst. You receive a compact aggregates snapshot ' +
  'of a live portfolio plus a LIVE macro block fetched from the web moments ago. Ground every ' +
  'macro view in those CURRENT numbers, not memory. ' +
  'The "pulse" is the macro read of the WHOLE book — where the market sits versus THESE holdings, ' +
  'the live trend that matters most, and the concrete near-term factors that could lift or drag ' +
  'this specific portfolio (rates/duration on the US-tech sleeve, FII/INR/crude on India, vol ' +
  'regime on the credit-spread book). Be forward-looking but conditional, never a price call. ' +
  'For each sleeve return TWO fields, BOTH NUMBER-FREE — never quote a figure, percentage, ' +
  'price, level, multiple, or ₹ amount in them; convey direction and regime in words. ' +
  '"performance": the most honest read of the sleeve FRAMED AGAINST THE MACRO — what the current ' +
  'backdrop is doing to it and what is working or dragging, the risk taken; name the weak spot ' +
  'plainly, never cheerlead. "outlook": the single highest-value forward point — where today\'s ' +
  'macro leaves this sleeve and how the portfolio is set up against it. Use the live macro to ' +
  'FORM these reads but express it qualitatively ("crude firming", "yields still elevated", ' +
  '"INR soft", "risk-on tape"), never the figure itself. Numbers belong elsewhere — only ' +
  '"pulse", indian_swot.macro and us_swot.macro may cite the live macro figures. ' +
  'Be CRISP — ONE sentence per field, ~15-20 words, high signal; give the macro READ and the ' +
  'positioning, not a recap. No filler, no hedging boilerplate. ' +
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
// Per-sleeve SWOT (macro line + strengths/weaknesses/opportunities/threats).
// One factory so every sleeve's SWOT stays the same shape — add a sleeve by
// adding `<sleeve>_swot: swot()` below, nothing else changes.
const swot = () => ({
  type: 'object',
  properties: {
    macro: { type: 'string' }, s: { type: 'string' }, w: { type: 'string' }, o: { type: 'string' }, t: { type: 'string' },
  },
  required: ['macro', 's', 'w', 'o', 't'],
  additionalProperties: false,
});
const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    // Pulse — the macro read of the whole book: where the market sits versus
    // THIS portfolio, the live trends, and the near-term tailwinds/risks.
    pulse: {
      type: 'object',
      properties: { read: { type: 'string' }, drivers: { type: 'string' }, drags: { type: 'string' } },
      required: ['read', 'drivers', 'drags'],
      additionalProperties: false,
    },
    overview: card(),
    indian: card(),
    us: card(),
    mf: card(),
    fd: card(),
    trading: card(),
    indian_swot: swot(),
    us_swot: swot(),
  },
  required: ['pulse', 'overview', 'indian', 'us', 'mf', 'fd', 'trading', 'indian_swot', 'us_swot'],
  additionalProperties: false,
};

const EMPTY = {
  pulse: null,
  overview: null, indian: null, us: null, mf: null, fd: null, trading: null,
  indian_swot: null, us_swot: null,
};

function buildUserMessage(d, macroLive, macroClock) {
  // No stale hardcoded fallbacks — a missing section is 'n/a', never an old figure.
  const s = (x) => (typeof x === 'string' && x.trim() ? x : 'n/a');
  const macro = (typeof macroLive === 'string' && macroLive.trim()) ? macroLive.trim() : '';
  const clock = (typeof macroClock === 'string' && macroClock.trim()) ? macroClock.trim() : '';
  const macroBlock = [macro, clock].filter(Boolean).join('\n');
  return (
    `Portfolio snapshot as of ${s(d.asOf)} · USD/INR ${d.usdInr ?? 'n/a'}\n\n` +
    (macroBlock
      ? `MACRO (LIVE — fetched just now; ground all macro views in THESE numbers, not memory):\n${macroBlock}\n\n`
      : `MACRO (LIVE): unavailable this run — keep macro views light and clearly general.\n\n`) +
    `OVERVIEW: ${s(d.overview)}\n` +
    `INDIAN EQUITY: ${s(d.indian)}\n` +
    `INDIAN RISK STATS: ${s(d.indianRisk)}\n` +
    `US EQUITY: ${s(d.us)}\n` +
    `US RISK STATS: ${s(d.usRisk)}\n` +
    `MUTUAL FUNDS: ${s(d.mutualFunds)}\n` +
    `FIXED DEPOSITS: ${s(d.fixedDeposits)}\n` +
    `ALGO (tracked separately, excluded from net worth): ${s(d.algo)}\n\n` +
    `Return pulse — the macro read of the WHOLE book: read = where the market sits vs THIS ` +
    `portfolio and the live trend that matters most to it; drivers = the 1-2 near-term factors most ` +
    `likely to LIFT this specific book; drags = the 1-2 most likely to PULL IT DOWN. ~2 crisp ` +
    `sentences max per field, specific to these holdings and grounded in the live macro above. ` +
    `Also {performance, outlook} per sleeve — ONE crisp sentence each (~15-20 words) and BOTH ` +
    `NUMBER-FREE: a pure macro read of the sleeve and how it is set up against today's backdrop, ` +
    `with NO figures, %, prices, levels or ₹. Keyed: ` +
    `overview (whole book), indian (use the Indian risk stats), us (use the US risk stats), mf (mutual funds), fd (fixed deposits), ` +
    `trading (the algo line). Also indian_swot AND us_swot (same shape): macro = one line on TODAY's ` +
    `backdrop using the live numbers above (Nifty / India channels for indian_swot; S&P / Nasdaq / US-rates ` +
    `for us_swot), s/w/o/t = ONE tight sentence each, specific to that sleeve. Always populate pulse, ` +
    `indian_swot and us_swot. ` +
    `Do NOT restate our figures — give the read, not a recap; keep ALL figures to pulse and the swot macro line.`
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
    const swotOf = (x) => (x && typeof x === 'object')
      ? { macro: x.macro ?? null, s: x.s ?? null, w: x.w ?? null, o: x.o ?? null, t: x.t ?? null }
      : null;
    const pl = obj.pulse;
    const pulse = (pl && typeof pl === 'object')
      ? { read: pl.read ?? null, drivers: pl.drivers ?? null, drags: pl.drags ?? null }
      : null;
    return {
      pulse,
      overview: an(obj.overview),
      indian: an(obj.indian),
      us: an(obj.us),
      mf: an(obj.mf),
      fd: an(obj.fd),
      trading: an(obj.trading),
      indian_swot: swotOf(obj.indian_swot),
      us_swot: swotOf(obj.us_swot),
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
      messages: [{ role: 'user', content: buildUserMessage(data, macroLive, data.macroClock) }],
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
