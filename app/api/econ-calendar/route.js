// Economic-calendar feed for the Wrap "Upcoming" block. Keyless:
//   - US (+ majors): ForexFactory weekly JSON (this week + next week) — the only
//     free calendar that survived (FMP went paid-tier, TradingEconomics killed
//     its guest account).
//   - India: COMPUTED in lib/econCalendar from the publication cadence + RBI MPC
//     dates — no free India feed exists.
// Graceful: if ForexFactory is unreachable the US side reports `unavailable`
// (never faked); India is always available. Shape-validated.
import { UA } from '../../lib/ua';
import { indiaReleases, mapForexFactory } from '../../lib/econCalendar';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 20;

const FF = [
  'https://nfs.faireconomy.media/ff_calendar_thisweek.json',
  'https://nfs.faireconomy.media/ff_calendar_nextweek.json',
];

async function ffWeek(url) {
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: 'application/json' },
    cache: 'no-store',
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = await res.json();
  if (!Array.isArray(j)) throw new Error('bad shape');
  return j;
}

export async function GET() {
  const now = new Date();
  // India events are sparse → a 2-month horizon so the bi-monthly RBI MPC and the
  // monthly CPI/IIP/WPI reliably show. US comes from FF's 2-week feed (below).
  const india = indiaReleases(now, 60);

  const weeks = await Promise.allSettled(FF.map(ffWeek));
  const events = weeks.flatMap((w) => (w.status === 'fulfilled' ? w.value : []));
  const ok = weeks.some((w) => w.status === 'fulfilled');
  const us = ok ? mapForexFactory(events, now, { horizonDays: 14 }) : [];

  // Cache a good response for 3h; on a transient FF failure (timeout / 429) cache
  // only briefly so the US side self-heals on the next call rather than staying
  // unavailable for hours. India is always computed, so it's never the reason.
  const cache = ok ? 's-maxage=10800, stale-while-revalidate=86400' : 's-maxage=600';
  return Response.json(
    {
      fetchedAt: now.toISOString(),
      india,
      us,
      usSource: ok ? 'ForexFactory' : 'unavailable',
      indiaSource: 'MoSPI cadence + RBI MPC',
    },
    { headers: { 'Cache-Control': cache } },
  );
}
