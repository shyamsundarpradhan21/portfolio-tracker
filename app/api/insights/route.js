// Server-side AI insight generator. Accepts live portfolio data as JSON and
// asks Claude for short, tab-specific insights — flagging only genuine concerns.
//
//   POST /api/insights   body: { timestamp, overview, indian, us, usdInr,
//                                 mutualFunds, algo }
//   → { insights: { overview, indian_stocks, us_stocks, mutual_funds, algo } }
//
// Each field is a 1–2 sentence string, or null when nothing is worth flagging.
// Requires the ANTHROPIC_API_KEY environment variable (set it in Vercel).

import Anthropic from '@anthropic-ai/sdk';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 30;

// Claude Opus 4.8 — most capable model, for the sharpest portfolio analysis.
// Isolated here so the model is a one-line change.
const MODEL = 'claude-opus-4-8';

const SYSTEM_PROMPT =
  'You are a sharp, macro-aware portfolio analyst reading the markets like a hawk. ' +
  'You receive a snapshot of live portfolio data; reason over it against the broader ' +
  'market backdrop you know — global and Indian macro (rates, inflation, INR/USD, ' +
  'crude, gold), sector and factor rotation, large-cap vs mid/small-cap regimes, ' +
  'index concentration, US mega-cap tech dynamics, and how these forces bear on the ' +
  'specific holdings shown. Connect position-level moves to the dynamics driving them; ' +
  'surface non-obvious risks (concentration, correlation, currency, duration, ' +
  'reinvestment, tax) and genuine opportunities. ' +
  'Return ONLY valid JSON. Each value is 1-2 tight, high-signal sentences — specific ' +
  'and actionable, never generic filler. Flag only what genuinely matters; null any ' +
  'tab that looks fine. Respect the provided caveats — never overstate short-window or ' +
  'benchmark-flattered results, and do not invent prices or figures not given. ' +
  'Your knowledge has a training cutoff, so frame macro views as analytical context, ' +
  'not real-time certainty.';

const EMPTY = {
  overview: null,
  indian_stocks: null,
  us_stocks: null,
  mutual_funds: null,
  fixed_deposits: null,
  algo: null,
};

// The MF signal arrives as a structured object; flatten it into prose the model
// can reason over, keeping the guardrail caveats explicit so it can't over-claim.
function fmtMf(mf) {
  if (!mf) return 'JioBLK + ELSS (no live detail)';
  if (typeof mf === 'string') return mf;
  const funds = (mf.perFund || [])
    .map((f) => `${f.name} ${f.ret ?? '?'}% (${f.sharePct ?? '?'}% of MF)`)
    .join('; ');
  return (
    `Invested ₹${mf.invested}, value ₹${mf.value}, return ${mf.returnPct}%. ` +
    `XIRR ${mf.xirrPct}% vs Nifty 50 ${mf.benchmarkXirrPct}% (delta ${mf.xirrDeltaPct} pts). ` +
    `Asset mix: ${mf.mix}. Market-cap tilt: ${mf.capTilt}. ` +
    `Largest: ${mf.largest}. Biggest drag: ${mf.drag}. ` +
    `Per fund: ${funds}. SIP: ${mf.sip}.\n` +
    `CAVEATS (must respect, do not over-claim): ${mf.caveats}`
  );
}

function buildUserMessage(d) {
  const ov = d.overview || {};
  const fmtRows = (rows) =>
    (rows || [])
      .map(
        (r) =>
          `${r.sym}: qty ${r.qty}, avg ${r.avgCost}, live ${r.livePrice ?? 'n/a'}, ` +
          `P&L ${r.plPct ?? 'n/a'}%, day ${r.dayPct ?? 'n/a'}%`,
      )
      .join('\n');

  return (
    `Current portfolio data as of ${d.timestamp || new Date().toISOString()}:\n\n` +
    `OVERVIEW: Net worth ₹${ov.netWorthL ?? '?'}L, Total assets ₹${ov.totalAssetsL ?? '?'}L, Loan ₹7.5L\n` +
    `Indian equity P&L: ${ov.indianPlPct ?? '?'}%, US portfolio P&L: ${ov.usPlPct ?? '?'}%\n\n` +
    `INDIAN STOCKS (live prices, ${d.indianSummary || 'all positions'}):\n${fmtRows(d.indian)}\n` +
    (d.indianStocks ? `INDIAN EQUITY SIGNALS: ${d.indianStocks}\n` : '') + '\n' +
    `US STOCKS (live prices, ${d.usSummary || 'all positions'}):\n${fmtRows(d.us)}\n` +
    `USD/INR: ${d.usdInr ?? '?'}\n\n` +
    `MUTUAL FUNDS: ${fmtMf(d.mutualFunds)}\n\n` +
    `FIXED DEPOSITS: ${d.fixedDeposits || 'none'}\n\n` +
    `ALGO: ${d.algo || 'S01 pool -₹26,293 (in recovery), S02 +₹30,998 realized'}\n\n` +
    `Return JSON:\n` +
    `{\n` +
    `  overview: string | null,\n` +
    `  indian_stocks: string | null,\n` +
    `  us_stocks: string | null,\n` +
    `  mutual_funds: string | null,\n` +
    `  fixed_deposits: string | null,\n` +
    `  algo: string | null\n` +
    `}`
  );
}

// Sonnet 4 returns plain text; tolerate ```json fences / stray prose.
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
    return {
      overview: obj.overview ?? null,
      indian_stocks: obj.indian_stocks ?? null,
      us_stocks: obj.us_stocks ?? null,
      mutual_funds: obj.mutual_funds ?? null,
      fixed_deposits: obj.fixed_deposits ?? null,
      algo: obj.algo ?? null,
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
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
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
