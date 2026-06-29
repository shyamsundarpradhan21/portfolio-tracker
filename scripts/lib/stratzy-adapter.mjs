// Stratzy daily-performance adapter — pure normalizer for the unbiased screen.
//
// Source = Stratzy's own `GET /api/web/algo/list` (one call, all ~148 algos), captured
// in the browser (see scripts/lib/stratzy-harvest.snippet.js) because of cookie/WAF.
// Each algo carries a full daily `performance` curve {DD/MM/YYYY: n}. The CRUX is
// splitting that curve into BACKTEST vs LIVE so an overfit screen is possible.
//
// THE SPLIT (resolved on real data): the boundary is `liveSince`.
//   point.date <  liveSince  → BACKTEST
//   point.date >= liveSince  → LIVE
// The curve starts at `liveSinceBacktested`; when that == liveSince the curve is 100%
// live (no backtest head). hasBacktestSegment requires >= 5 backtest days so a 1-day
// off-by-one head (curve starting the day before go-live) doesn't count.
//
// Pure + tested. Join with the Dhan catalog (correlations/meta) happens in the importer.

import { parseCsv } from './dhan-algos-adapter.mjs';

const DAY = 86400000;

const num = (v) => { if (v == null) return null; const n = Number(v); return Number.isFinite(n) ? n : null; };
const str = (v) => (v == null ? null : String(v).trim() || null);
const bool = (v) => (v == null ? null : v === true || v === 'true' || v === 1 || v === '1');

// "DD/MM/YYYY" → UTC-midnight ms (date-only, TZ-safe). null if unparseable.
export function dateKeyMs(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(String(s));
  return m ? Date.UTC(+m[3], +m[2] - 1, +m[1]) : null;
}
// ISO/Date → UTC-midnight ms of that calendar day. null if invalid.
function dayFloorMs(v) {
  const d = v instanceof Date ? v : new Date(v);
  return Number.isNaN(d.getTime()) ? null : Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

// Partition a {DD/MM/YYYY: value} performance map into backtest/live at liveSince.
// Returns date-sorted arrays of { date, v }. Points with unparseable dates are dropped.
export function splitPerformance(performance, liveSince) {
  const bound = dayFloorMs(liveSince);
  const pts = Object.entries(performance || {})
    .map(([date, v]) => ({ date, ms: dateKeyMs(date), v: num(v) }))
    .filter((p) => p.ms != null)
    .sort((a, b) => a.ms - b.ms);
  const backtest = [], live = [];
  for (const p of pts) {
    const row = { date: p.date, v: p.v };
    (bound != null && p.ms < bound ? backtest : live).push(row);
  }
  return { backtest, live };
}

// Build the canonical per-algo record from one raw `algo/list` item.
// opts.asOf (Date|ms, default now) anchors liveDays — pass a fixed value in tests.
export function normalizeAlgo(raw, opts = {}) {
  if (!raw || typeof raw !== 'object') return null;
  const id = str(raw._id ?? raw.id);
  const name = str(raw.name);
  if (!id && !name) return null;
  const asOf = opts.asOf != null ? (opts.asOf instanceof Date ? opts.asOf.getTime() : opts.asOf) : Date.now();
  const liveSinceMs = dayFloorMs(raw.liveSince);

  const { backtest, live } = splitPerformance(raw.performance, raw.liveSince);
  const hasBacktestSegment = backtest.length >= 5; // off-by-one head (<5) excluded
  const liveDays = liveSinceMs != null ? Math.max(0, Math.round((dayFloorMs(asOf) - liveSinceMs) / DAY)) : null;

  return {
    id,
    name,
    category: str(raw.category),
    displayCategory: str(raw.displayCategory),
    underlying: str(raw.underlying),
    isActive: bool(raw.isActive),
    isExpiry: bool(raw.isExpiry),
    stratzy: {
      liveSince: str(raw.liveSince),
      liveSinceBacktested: str(raw.liveSinceBacktested),
      performance: raw.performance && typeof raw.performance === 'object' ? raw.performance : {},
      split: { backtest, live },
      hasBacktestSegment,
      backtestDays: backtest.length,
      liveDays,
      rollingReturns30Day: raw.rollingReturns30Day && typeof raw.rollingReturns30Day === 'object' ? raw.rollingReturns30Day : {},
      pastReturn: num(raw.pastReturn),
      annualizedReturns: num(raw.annualizedReturns),
      backtestMetrics: {
        backtestSharpeRatio: num(raw.backtestSharpeRatio),
        backtestMaxDrawdown: num(raw.backtestMaxDrawdown),
        backtestAvgTimeToRecovery: num(raw.backtestAvgTimeToRecovery),
        backTestingPeriod: str(raw.backTestingPeriod),
        cagr: num(raw.cagr),
      },
      headline: {
        sharpeRatio: num(raw.sharpeRatio),
        maxDrawdown: num(raw.maxDrawdown),
        cagr: num(raw.cagr),
        winRatio: num(raw.winRatio),
        drawDown: num(raw.drawDown),
      },
    },
  };
}

// ── sources (same interface as the Dhan adapter) ─────────────────────────────
function listItems(raw) {
  if (Array.isArray(raw)) return raw;
  if (Array.isArray(raw?.data)) return raw.data;
  return [];
}

// Browser-harvested JSON (the raw `algo/list` response, or its `data` array).
export function fromHarvest(harvested, opts = {}) {
  const seen = new Map();
  for (const it of listItems(harvested)) {
    const row = normalizeAlgo(it, opts);
    if (row) seen.set(row.id || row.name, row);
  }
  return [...seen.values()];
}

// Paste/CSV fallback: scalar columns only (no daily curve available this way).
// Header maps to raw `algo/list` keys (_id,name,liveSince,sharpeRatio,…); normalizeAlgo
// then yields the same record with an empty performance/split.
export function fromPaste(csvText, opts = {}) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return [];
  const header = rows[0].map((h) => h.trim());
  return rows.slice(1)
    .map((r) => normalizeAlgo(Object.fromEntries(header.map((h, i) => [h, r[i]])), opts))
    .filter(Boolean);
}
