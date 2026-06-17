// Server-side AI insight generator. Accepts a COMPACT aggregates snapshot
// (one summary string per sleeve, built client-side — never full holdings
// books) and asks Claude for one analysis card per tab.
//
//   POST /api/insights   body: { asOf, usdInr, overview, indian, indianRisk,
//                                us, mutualFunds, fixedDeposits, algo }
//   → { insights: { overview, indian, us, mf, fd, trading,   // each {performance, outlook}
//                   indian_swot: {macro, s, w, o, t} } }
//
// Each tab card is performance (honest read) + outlook (forward view), 1–2
// sentences each, or null when its data is missing. Token economics: Haiku-tier
// model, ~500-token input, structured outputs, max_tokens 1200. AI fires only
// on the header toggle (one whole-app call) and the client hash-gates so
// unchanged data never re-bills. Requires the ANTHROPIC_API_KEY env var.

import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Claude Haiku 4.5 — cheapest tier; right-sized for 1-2 sentence insights.
// Isolated here so the model is a one-line change (Sonnet 4.6 if quality lags).
const MODEL = 'claude-haiku-4-5';

const SYSTEM_PROMPT =
  'You are a sharp, macro-aware portfolio analyst reading the markets like a hawk. ' +
  'You receive a compact aggregates snapshot of a live portfolio; reason over it against ' +
  'the broader market backdrop you know — global and Indian macro (rates, inflation, ' +
  'INR/USD, crude, gold), sector and factor rotation, large-cap vs mid/small-cap regimes, ' +
  'index concentration, US mega-cap tech dynamics. ' +
  'For each sleeve return TWO fields. "performance": an HONEST assessment of how it is ' +
  'actually doing — returns vs benchmark, risk taken, what is working and what is dragging — ' +
  'not a cheerleader summary; name the weak spots plainly. "outlook": a forward view given ' +
  'the macro backdrop and the positions shown — risks to watch (concentration, correlation, ' +
  'currency, duration, reinvestment, tax) and genuine opportunities. ' +
  'Each field is 1-2 tight, high-signal sentences — specific and actionable, never generic ' +
  'filler. Respect the provided caveats — never overstate short-window or benchmark-flattered ' +
  'results, and do not invent prices or figures not given. Null a sleeve only if its data is ' +
  'missing. Your knowledge has a training cutoff, so frame macro views as analytical context, ' +
  'not real-time certainty.';

// Structured-outputs schema — guarantees parseable JSON and replaces the old
// "Return JSON: {...}" prompt scaffold.
const nullable = (t) => ({ anyOf: [{ type: t }, { type: 'null' }] });
// One analysis card per tab: performance + outlook (each nullable), or null.
const analysis = () => ({
  anyOf: [
    {
      type: 'object',
      properties: { performance: nullable('string'), outlook: nullable('string') },
      required: ['performance', 'outlook'],
      additionalProperties: false,
    },
    { type: 'null' },
  ],
});
const INSIGHTS_SCHEMA = {
  type: 'object',
  properties: {
    overview: analysis(),
    indian: analysis(),
    us: analysis(),
    mf: analysis(),
    fd: analysis(),
    trading: analysis(),
    indian_swot: {
      anyOf: [
        {
          type: 'object',
          properties: {
            macro: nullable('string'),
            s: nullable('string'),
            w: nullable('string'),
            o: nullable('string'),
            t: nullable('string'),
          },
          required: ['macro', 's', 'w', 'o', 't'],
          additionalProperties: false,
        },
        { type: 'null' },
      ],
    },
  },
  required: ['overview', 'indian', 'us', 'mf', 'fd', 'trading', 'indian_swot'],
  additionalProperties: false,
};

const EMPTY = {
  overview: null, indian: null, us: null, mf: null, fd: null, trading: null,
  indian_swot: null,
};

function buildUserMessage(d) {
  // No stale hardcoded fallbacks — a missing section is 'n/a', never an old figure.
  const s = (x) => (typeof x === 'string' && x.trim() ? x : 'n/a');
  return (
    `Portfolio snapshot as of ${s(d.asOf)} · USD/INR ${d.usdInr ?? 'n/a'}\n\n` +
    `OVERVIEW: ${s(d.overview)}\n` +
    `INDIAN EQUITY: ${s(d.indian)}\n` +
    `INDIAN RISK STATS: ${s(d.indianRisk)}\n` +
    `US EQUITY: ${s(d.us)}\n` +
    `MUTUAL FUNDS: ${s(d.mutualFunds)}\n` +
    `FIXED DEPOSITS: ${s(d.fixedDeposits)}\n` +
    `ALGO (tracked separately, excluded from net worth): ${s(d.algo)}\n\n` +
    `For each sleeve return {performance, outlook} (1-2 sentences each), keyed: ` +
    `overview (the whole book), indian (Indian equity — use the risk stats too), us, ` +
    `mf (mutual funds), fd (fixed deposits), trading (the algo line above). ` +
    `Also return indian_swot: macro = one-line read of the backdrop (rates, INR, crude, ` +
    `FII flows, large vs mid/small regime); s/w/o/t = ONE tight, macro-aware sentence each, ` +
    `grounded in the risk stats and aggregates above. Always populate indian_swot.`
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
    const client = new Anthropic();
    const message = await client.messages.create({
      model: MODEL,
      max_tokens: 1200,
      system: SYSTEM_PROMPT,
      output_config: { format: { type: 'json_schema', schema: INSIGHTS_SCHEMA } },
      messages: [{ role: 'user', content: buildUserMessage(data) }],
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
