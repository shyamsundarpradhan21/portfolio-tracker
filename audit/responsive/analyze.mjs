// Read-only analysis of report.json → aggregates offenders for the findings report.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
const DIR = path.dirname(fileURLToPath(import.meta.url));
const rep = JSON.parse(fs.readFileSync(path.join(DIR, 'report.json'), 'utf8'));

const norm = (sel) => (sel || '').replace(/\.(active|on|greed|fear|pos|neg|neu|up|dn|grn|red)\b/g, '');
const cells = rep.matrix.filter((r) => !r.error);

// 1) offender frequency by normalized selector (matrix-wide), with worst overflow seen
const freq = {};
for (const c of cells) {
  for (const o of (c.offenders || [])) {
    const k = norm(o.sel);
    const mag = (o.overRight || 0) + (o.overLeft || 0) + (o.contentOverflowX || 0);
    if (!freq[k]) freq[k] = { sel: k, hits: 0, maxMag: 0, surfaces: new Set(), groups: new Set(), kinds: new Set() };
    freq[k].hits++;
    freq[k].maxMag = Math.max(freq[k].maxMag, mag);
    freq[k].surfaces.add(c.surface);
    freq[k].groups.add(c.group);
    if (o.overRight) freq[k].kinds.add('escapeR');
    if (o.overLeft) freq[k].kinds.add('escapeL');
    if (o.contentOverflowX) freq[k].kinds.add('contentX');
    if (o.clipY) freq[k].kinds.add('clipY');
  }
}
const top = Object.values(freq).sort((a, b) => b.hits - a.hits).slice(0, 30)
  .map((f) => ({ sel: f.sel, hits: f.hits, maxOverflowPx: f.maxMag, surfaces: [...f.surfaces].join(','), groups: [...f.groups].join(','), kinds: [...f.kinds].join(',') }));

// 2) per-surface offender load (avg + max), to see which surfaces are worst
const bySurf = {};
for (const c of cells) {
  bySurf[c.surface] = bySurf[c.surface] || { cells: 0, totalOff: 0, maxOff: 0, maxAt: '' };
  const s = bySurf[c.surface];
  s.cells++; s.totalOff += c.offenderCount;
  if (c.offenderCount > s.maxOff) { s.maxOff = c.offenderCount; s.maxAt = c.breakpoint + '/' + c.theme; }
}
const surfSummary = Object.entries(bySurf).map(([k, v]) => ({ surface: k, avgOffenders: Math.round(v.totalOff / v.cells), maxOffenders: v.maxOff, maxAt: v.maxAt }));

// 3) the single worst offenders by magnitude across the whole matrix (real overflow px)
const worst = [];
for (const c of cells) for (const o of (c.offenders || [])) {
  const mag = (o.overRight || 0) + (o.overLeft || 0) + (o.contentOverflowX || 0);
  if (mag > 8) worst.push({ mag, sel: o.sel, kind: o.overRight ? 'escapeR' : o.overLeft ? 'escapeL' : 'contentX', surface: c.surface, bp: c.breakpoint, theme: c.theme });
}
worst.sort((a, b) => b.mag - a.mag);
const worstTop = worst.slice(0, 25);

// 4) narrow-vs-wide: does a surface offend MORE at tablet than wide? (responsive regressions)
const narrowVsWide = {};
for (const c of cells) {
  if (c.theme !== 'night') continue;
  narrowVsWide[c.surface] = narrowVsWide[c.surface] || {};
  narrowVsWide[c.surface][c.group] = (narrowVsWide[c.surface][c.group] || 0);
  // average within group later; just collect max per group
  narrowVsWide[c.surface][c.group] = Math.max(narrowVsWide[c.surface][c.group], c.offenderCount);
}

// 5) day vs night parity — any theme-specific overflow differences
const themeDiff = [];
for (const c of cells.filter((x) => x.theme === 'night')) {
  const d = cells.find((x) => x.theme === 'day' && x.surface === c.surface && x.breakpoint === c.breakpoint);
  if (d && Math.abs(d.offenderCount - c.offenderCount) > 5) themeDiff.push({ surface: c.surface, bp: c.breakpoint, night: c.offenderCount, day: d.offenderCount });
}

console.log('=== SURFACE OFFENDER LOAD (matrix) ===');
console.table(surfSummary);
console.log('\n=== TOP OFFENDING SELECTORS (by frequency across 176 cells) ===');
console.table(top);
console.log('\n=== WORST SINGLE OFFENDERS (by overflow px, >8px) ===');
console.table(worstTop);
console.log('\n=== NARROW vs WIDE (max offenders per bp-group, night) ===');
console.log(JSON.stringify(narrowVsWide, null, 0));
console.log('\n=== THEME DIFFS (|day-night| offenders > 5) ===');
console.log(JSON.stringify(themeDiff.slice(0, 20), null, 0));
console.log('\n=== ZOOM ===');
console.table(rep.zoom.map((z) => ({ surface: z.surface, zoom: z.zoom, hScroll: z.hasHScroll, docOverflow: z.docOverflow, offenders: z.offenderCount, top: z.offenders && z.offenders[0] && z.offenders[0].sel })));
console.log('\n=== STRESS (long label + big value) ===');
console.table(rep.stress.map((s) => ({ surface: s.surface, injectedLabels: s.injected.labels, injectedValues: s.injected.values, afterHScroll: s.after.hasHScroll, afterDocOverflow: s.after.docOverflow, topOffender: s.after.offenders && s.after.offenders[0] && s.after.offenders[0].sel })));
