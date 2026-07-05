// Catmull-Rom → cubic Bézier: ONE smooth SVG path THROUGH every point, used by every line
// curve in the app so they all read the same as the net-worth curve (rounds the corners a
// polyline would leave jagged, without deviating from the data at the knots). Input is an
// array of pixel points [{x, y}] already scaled by the caller; output is a `d` string.
// The control points are the neighbour-slope tangents (/6 = the standard uniform Catmull-Rom
// tension); endpoints duplicate the terminal point so the curve starts/ends cleanly.
export function smoothPath(pts) {
  if (!pts || pts.length < 2) return pts && pts.length ? `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}` : '';
  let d = `M${pts[0].x.toFixed(1)},${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C${c1x.toFixed(1)},${c1y.toFixed(1)} ${c2x.toFixed(1)},${c2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`;
  }
  return d;
}
