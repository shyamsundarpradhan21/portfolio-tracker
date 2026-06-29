// Direction → colour class — the single source of truth for sign→colour, kept in its
// own JSX-free module so it can be unit-tested directly (fmt.js carries JSX that the
// test runner's esbuild won't transform). Re-exported by fmt.js, so every call site
// still imports `cl` from '../lib/fmt'.
//
// Sign is encoded by COLOUR only (the app is glyph-free): positive → gain (grn),
// negative → loss (red), EXACTLY zero → neutral (no colour class). Every result also
// carries the `dirv` marker so the responsive certify gate can locate a directional
// figure in a glyph-free DOM and assert it renders coloured (CHECK 1). The sign→colour
// mapping itself is locked by fmt.test.js.
export const cl = (n) => (n > 0 ? 'grn dirv' : n < 0 ? 'red dirv' : 'dirv');
