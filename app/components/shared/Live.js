'use client';
import AnimatedNumber from './AnimatedNumber';
import { InrC, InrF, SInrC, SInrF, UsdF, Pct } from '../../lib/fmt';

// Count-up wrappers — identical output to the static formatter, but the figure
// ticks from its previous value to the new one whenever it changes (the hero's
// "liveness", extended to tab + sleeve headline figures). A value that never
// changes (e.g. invested cost) simply renders instantly and never animates, so
// these are safe to use uniformly across a summary row. Tables deliberately keep
// their flash-on-tick feedback instead — animating dozens of cells is noise.
//
// Use ONLY where the value is non-null (the same guarded branches the static
// formatters already sit in); a null would format as "₹0" mid-load.
export const LiveInrC  = ({ n, ...p }) => <AnimatedNumber value={n} render={(v) => <InrC n={v} />} {...p} />;
export const LiveInrF  = ({ n, ...p }) => <AnimatedNumber value={n} render={(v) => <InrF n={v} />} {...p} />;
export const LiveSInrC = ({ n, ...p }) => <AnimatedNumber value={n} render={(v) => <SInrC n={v} />} {...p} />;
export const LiveSInrF = ({ n, ...p }) => <AnimatedNumber value={n} render={(v) => <SInrF n={v} />} {...p} />;
export const LiveUsdF  = ({ n, d, ...p }) => <AnimatedNumber value={n} render={(v) => <UsdF n={v} d={d} />} {...p} />;
export const LivePct   = ({ n, d, ...p }) => <AnimatedNumber value={n} render={(v) => <Pct n={v} d={d} />} {...p} />;
