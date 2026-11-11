// Projection of a triangle mesh onto a sketch plane: silhouette of the whole body and the curves where the
// plane cuts it. `loc(i)` gives vertex i in plane coordinates [x, y, height above the plane].
import { simplify } from './trace.js';

const tidy = (pts, closed) => simplify(pts, 0.002, closed);

// Shadow of the body on the plane: union of all its triangles. Returns closed loops (outline and openings).
export function silhouette(nTri, tri, loc) {
  const L = globalThis.ClipperLib || globalThis.window?.ClipperLib;
  if (!L) throw new Error('Clipper fehlt');
  const S = 10000, c = new L.Clipper(), sol = new L.Paths();
  for (let t = 0; t < nTri; t++) {
    const a = loc(tri(t, 0)), b = loc(tri(t, 1)), d = loc(tri(t, 2));
    const ar = (b[0] - a[0]) * (d[1] - a[1]) - (b[1] - a[1]) * (d[0] - a[0]);
    if (Math.abs(ar) < 1e-7) continue;
    c.AddPath((ar > 0 ? [a, b, d] : [a, d, b]).map(p => ({ X: Math.round(p[0] * S), Y: Math.round(p[1] * S) })), L.PolyType.ptSubject, true);
  }
  c.Execute(L.ClipType.ctUnion, sol, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  return L.Clipper.CleanPolygons(sol, 0.002 * S).map(p => ({ closed: true, pts: tidy(p.map(q => [q.X / S, q.Y / S]), true) })).filter(p => p.pts.length >= 3);
}

// Where the plane cuts the body: every crossed triangle gives a segment, chained they are the section curves.
export function planeCut(nTri, tri, loc) {
  const segs = [];
  for (let t = 0; t < nTri; t++) {
    const P = [loc(tri(t, 0)), loc(tri(t, 1)), loc(tri(t, 2))], sd = P.map(p => (Math.abs(p[2]) < 1e-9 ? 1e-9 : p[2]));
    const cut = [];
    for (let k = 0; k < 3; k++) {
      const a = P[k], b = P[(k + 1) % 3], da = sd[k], db = sd[(k + 1) % 3];
      if (da > 0 !== db > 0) { const u = da / (da - db); cut.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
    }
    if (cut.length === 2 && Math.hypot(cut[0][0] - cut[1][0], cut[0][1] - cut[1][1]) > 1e-6) segs.push(cut);
  }
  const key = p => `${Math.round(p[0] * 2000)},${Math.round(p[1] * 2000)}`, adj = new Map();
  segs.forEach((sg, i) => sg.forEach((p, e) => { const k = key(p); (adj.get(k) || adj.set(k, []).get(k)).push([i, e]); }));
  const used = new Uint8Array(segs.length), polys = [];
  const follow = (i, e) => { // from end e of segment i onwards
    const out = [];
    for (;;) {
      used[i] = 1;
      const p = segs[i][1 - e];
      out.push(p);
      const nx = (adj.get(key(p)) || []).find(([j]) => !used[j]);
      if (!nx) return out;
      [i, e] = nx;
    }
  };
  for (let i = 0; i < segs.length; i++) {
    if (used[i]) continue;
    const pts = [segs[i][0], ...follow(i, 0)];
    const closed = pts.length > 3 && key(pts[0]) === key(pts[pts.length - 1]);
    if (closed) pts.pop();
    else { // open: there may be more behind the start
      const nx = (adj.get(key(segs[i][0])) || []).find(([j]) => !used[j]);
      if (nx) pts.unshift(...follow(nx[0], nx[1]).reverse());
    }
    const s = tidy(pts, closed);
    if (s.length >= (closed ? 3 : 2)) polys.push({ closed, pts: s });
  }
  return polys;
}

// One curve given as 3D sample points (an edge) in plane coordinates: a circle when it is one, else a polyline;
// null when it is seen end-on (a point).
export function curveEntity(samples, allowCircle = true) {
  const N = samples.length - 1, loc = samples.map(p => [p[0], p[1]]);
  const closed = Math.hypot(loc[0][0] - loc[N][0], loc[0][1] - loc[N][1]) < 1e-4;
  const r4 = v => +v.toFixed(4);
  if (closed) {
    const ring = loc.slice(0, N), cx = ring.reduce((a, p) => a + p[0], 0) / N, cy = ring.reduce((a, p) => a + p[1], 0) / N;
    const rr = ring.map(p => Math.hypot(p[0] - cx, p[1] - cy));
    // (a rectangle has its four corners on a circle too: only many samples make a circle)
    if (allowCircle && N >= 12 && Math.max(...rr) - Math.min(...rr) < 1e-3 && rr[0] > 1e-4) return { type: 'circle', cx: r4(cx), cy: r4(cy), r: r4(rr[0]) };
    const pts = tidy(ring, true);
    return pts.length >= 3 ? { type: 'poly', closed: true, pts: pts.map(p => p.map(r4)) } : null;
  }
  // an open edge on a circle is a three-point arc
  if (allowCircle && N >= 12) {
    const A = loc[0], M = loc[N >> 1], Z = loc[N], d = 2 * (A[0] * (M[1] - Z[1]) + M[0] * (Z[1] - A[1]) + Z[0] * (A[1] - M[1]));
    if (Math.abs(d) > 1e-9) {
      const a2 = A[0] ** 2 + A[1] ** 2, m2 = M[0] ** 2 + M[1] ** 2, z2 = Z[0] ** 2 + Z[1] ** 2;
      const cx = (a2 * (M[1] - Z[1]) + m2 * (Z[1] - A[1]) + z2 * (A[1] - M[1])) / d, cy = (a2 * (Z[0] - M[0]) + m2 * (A[0] - Z[0]) + z2 * (M[0] - A[0])) / d, r = Math.hypot(A[0] - cx, A[1] - cy);
      if (r < 1e6 && loc.every(p => Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - r) < 1e-3)) return { type: 'poly', curve: 'arc', closed: false, pts: [A, M, Z].map(p => p.map(r4)) };
    }
  }
  const pts = tidy(loc, false);
  return pts.length >= 2 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) > 1e-4 ? { type: 'poly', closed: false, pts: pts.map(p => p.map(r4)) } : null;
}

// Sample curves (3D polylines of the edges of one wire, in any order and direction) chained into one closed loop.
export function chainLoop(curves, tol = 1e-4) {
  if (!curves.length) return null;
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  const left = curves.slice(1), loop = curves[0].slice();
  while (left.length) {
    const end = loop[loop.length - 1];
    let k = left.findIndex(c => d(c[0], end) < tol), rev = false;
    if (k < 0) { k = left.findIndex(c => d(c[c.length - 1], end) < tol); rev = true; }
    if (k < 0) return null;
    const c = left.splice(k, 1)[0];
    loop.push(...(rev ? c.slice().reverse() : c).slice(1));
  }
  return loop;
}
