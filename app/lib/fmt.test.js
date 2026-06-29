// Locks the sign→colour mapping of cl() so a gain/loss figure can never silently lose
// its direction colour. CHECK 1's two halves: this proves the colour is the RIGHT one
// (positive→gain, negative→loss, zero→neutral); certify.mjs proves the colour is PRESENT
// in the rendered DOM (which is glyph-free, so it has no sign to check against).
import { describe, it, expect } from 'vitest';
import { cl } from './direction.js';

describe('cl() — direction colour mapping (sign → grn/red/neutral)', () => {
  const classes = (n) => cl(n).split(/\s+/);

  it('positive → gain (grn), never red', () => {
    expect(classes(1)).toContain('grn');
    expect(classes(0.01)).toContain('grn');
    expect(classes(1234567)).toContain('grn');
    expect(cl(5)).not.toMatch(/\bred\b/);
  });

  it('negative → loss (red), never grn', () => {
    expect(classes(-1)).toContain('red');
    expect(classes(-0.01)).toContain('red');
    expect(classes(-1234567)).toContain('red');
    expect(cl(-5)).not.toMatch(/\bgrn\b/);
  });

  it('exactly zero → neutral (neither grn nor red)', () => {
    expect(cl(0)).not.toMatch(/\bgrn\b/);
    expect(cl(0)).not.toMatch(/\bred\b/);
  });

  it('always carries the dirv marker (so the DOM gate can find directional figures)', () => {
    for (const n of [5, -5, 0]) expect(classes(n)).toContain('dirv');
  });
});
