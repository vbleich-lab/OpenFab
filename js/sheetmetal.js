// Sheet metal: a base plate from a closed polygon plus flanges bent up on chosen
// edges (inner bend radius r, thickness t, K-factor), and the flat pattern.
import { ensureCCW } from './profiles.js';

const DEG = Math.PI / 180;

// Sheet metal rules ("Blechregel"): thickness, inner bend radius and K-factor that belong together. The K-factors
// are the usual shop values for air bending (r ≈ t: about 0.33 … 0.44), not a promise for a given press brake.
export const SHEET_RULES = [
  { id: 'st1', name: 'Stahl 1 mm', thickness: 1, radius: 1, kfactor: 0.4 },
  { id: 'st15', name: 'Stahl 1,5 mm', thickness: 1.5, radius: 1.5, kfactor: 0.4 },
  { id: 'st2', name: 'Stahl 2 mm', thickness: 2, radius: 2, kfactor: 0.42 },
  { id: 'st3', name: 'Stahl 3 mm', thickness: 3, radius: 3, kfactor: 0.44 },
  { id: 'va1', name: 'Edelstahl 1 mm', thickness: 1, radius: 1.5, kfactor: 0.42 },
  { id: 'va2', name: 'Edelstahl 2 mm', thickness: 2, radius: 3, kfactor: 0.44 },
  { id: 'al1', name: 'Aluminium 1 mm', thickness: 1, radius: 1, kfactor: 0.38 },
  { id: 'al2', name: 'Aluminium 2 mm', thickness: 2, radius: 2, kfactor: 0.4 },
  { id: 'al3', name: 'Aluminium 3 mm', thickness: 3, radius: 3, kfactor: 0.42 },
];

export function bendAllowance(angleDeg, r, t, k) {
  return angleDeg * DEG * (r + k * t);
}
/**
 * What the length of a flange is measured to ("Laschenmaß", f.flangeDim): 'straight' – the straight part after
 * the bend (as the flanges are stored and computed), 'outer' – from the outer face of the plate (the outside
 * dimension of the folded part), 'inner' – from the inner face. Returns f with the first flange of every edge
 * turned into its straight length; throws where nothing straight is left.
 */
export function sheetDims(f) {
  const mode = f.flangeDim || 'straight';
  if (mode === 'straight' || !(f.flanges || []).length) return f;
  const t = +f.thickness, r = +f.radius;
  return { ...f, flanges: f.flanges.map(fl => {
    if (!fl.on) return fl;
    const set = (mode === 'outer' ? r + t : r) * Math.tan((Math.min(150, Math.abs(+fl.angle || 90)) * DEG) / 2), h = (+fl.h || 0) - set;
    if (h < -1e-9) throw new Error(`Kante ${fl.edge + 1}: das Laschenmaß ${+fl.h} mm ist kleiner als die Biegung (${Math.round(set * 100) / 100} mm)`);
    return { ...fl, h: Math.max(0, h) };
  }) };
}
// tensile strength Rm (N/mm²) by material, for the press force
export const SHEET_RM = { alu: 200, steel: 400, stainless: 650, brass: 350, copper: 250 };
/**
 * Air bending on a press brake: the usual die opening V for the thickness t (8 × t, 10 × t above 6 mm, 12 × t
 * above 10 mm) and the force for a bend of the length L: F = 1.42 · Rm · t² · L / V (kN). A rule of thumb for the
 * choice of the machine, not a promise.
 */
export function pressForce(t, L, rm = 400) {
  const V = t * (t > 10 ? 12 : t > 6 ? 10 : 8);
  return { V, kN: (1.42 * rm * t * t * L) / V / 1000, minFlange: 0.7 * V };
}

// Edges of the base polygon with length and outward normal (polygon made CCW).
export function polyEdges(poly) {
  const P = ensureCCW(poly);
  return P.map((a, i) => {
    const b = P[(i + 1) % P.length];
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const e = [(b[0] - a[0]) / L, (b[1] - a[1]) / L];
    return { a, b, L, e, n: [e[1], -e[0]] };
  });
}

/**
 * Curved edges: runs of at least three equal chords with the same turn, their corners on one circle – how an arc
 * or a circle of the sketch arrives in the base polygon. Map: index of the first segment (as in polyEdges) →
 * { i0, m (segments), c, R, a0 (angle of the first corner), sweep (signed: > 0 the edge bulges out), convex,
 * full (the whole outline is one circle), L (arc length) }. A flange on the first segment of such a run is a
 * flange on the whole curved edge.
 */
export function polyArcs(poly) {
  const P = ensureCCW(poly), n = P.length, out = new Map();
  if (n < 4) return out;
  const seg = i => { const a = P[((i % n) + n) % n], b = P[(((i + 1) % n) + n) % n]; return [b[0] - a[0], b[1] - a[1]]; };
  const len = i => Math.hypot(...seg(i));
  const turn = i => { const a = seg(i - 1), b = seg(i); return Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]); };
  const smooth = i => { const tt = Math.abs(turn(i)), l0 = len(i - 1), l1 = len(i); return tt > 0.5 * DEG && tt < 31 * DEG && Math.abs(l0 - l1) < 0.02 * Math.max(l0, l1) + 1e-6; };
  const same = (a, b) => Math.abs(a - b) < 0.03 * Math.abs(a) + 1e-4;
  const mk = (i0, m, full) => {
    const a = P[i0 % n], b = P[(i0 + 1) % n], c = P[(i0 + 2) % n];
    const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
    if (Math.abs(d) < 1e-12) return;
    const sa = a[0] * a[0] + a[1] * a[1], sb = b[0] * b[0] + b[1] * b[1], sc = c[0] * c[0] + c[1] * c[1];
    const cx = (sa * (b[1] - c[1]) + sb * (c[1] - a[1]) + sc * (a[1] - b[1])) / d, cy = (sa * (c[0] - b[0]) + sb * (a[0] - c[0]) + sc * (b[0] - a[0])) / d;
    const R = Math.hypot(a[0] - cx, a[1] - cy);
    for (let q = 0; q <= m; q++) { const p = P[(i0 + q) % n]; if (Math.abs(Math.hypot(p[0] - cx, p[1] - cy) - R) > 1e-3 * R + 1e-3) return; }
    const step = turn(i0 + 1), sweep = full ? Math.sign(step) * 2 * Math.PI : step * m;
    out.set(i0 % n, { i0: i0 % n, m, c: [cx, cy], R, a0: Math.atan2(a[1] - cy, a[0] - cx), sweep, convex: step > 0, full: !!full, L: R * Math.abs(sweep) });
  };
  // a corner that is not inside an arc is where the walk starts
  let s0 = -1;
  for (let i = 0; i < n && s0 < 0; i++) if (!smooth(i) || !same(turn(i), turn(i + 1))) s0 = i;
  if (s0 < 0) { mk(0, n, true); return out; }
  for (let k = 0; k < n;) {
    const s = s0 + k;
    let m = 1;
    if (smooth(s + 1)) { const t0 = turn(s + 1); while (k + m < n && smooth(s + m) && same(t0, turn(s + m))) m++; }
    if (m >= 3) mk(s % n, m, false);
    k += m >= 3 ? m : 1;
  }
  return out;
}
const arcPts = (a, th0, th1, rho) => {
  const n = Math.max(2, Math.ceil(Math.abs(th1 - th0) / (3 * DEG)));
  return Array.from({ length: n + 1 }, (_, i) => { const th = th0 + ((th1 - th0) * i) / n; return [a.c[0] + rho * Math.cos(th), a.c[1] + rho * Math.sin(th)]; });
};
// the part of a curved edge its flange stands on: angles th0 → th1 in the direction of the outline
function arcSpan(a, fl, gap, jn = null) {
  const gA = a.full || jn?.a ? 0 : +fl.offA > 0 ? +fl.offA : gap, gB = a.full || jn?.b ? 0 : +fl.offB > 0 ? +fl.offB : gap, sg = Math.sign(a.sweep);
  return { th0: a.a0 + (sg * gA) / a.R, th1: a.a0 + a.sweep - (sg * gB) / a.R, len: a.L - gA - gB, gA, gB };
}
/**
 * Flanges that run on into each other: where a curved edge passes into its neighbour without a kink (tangent) and
 * both carry a flange with the same first bend, there is no relief gap between them – the wall goes round the
 * corner in one piece (a tray with rounded corners). Map: edge of the flange → { a, b } (its start / its end joined).
 */
export function flangeJoins(poly, f, arcs = polyArcs(poly)) {
  const P = ensureCCW(poly), n = P.length, owner = P.map((_, i) => i), out = new Map();
  for (const a of arcs.values()) { if (a.full) return out; for (let q = 0; q < a.m; q++) owner[(a.i0 + q) % n] = a.i0; }
  const fls = new Map((f.flanges || []).filter(q => q.on).map(q => [q.edge, q]));
  const dirAt = (o, end) => {
    const a = arcs.get(o);
    if (!a) { const p = P[o], q = P[(o + 1) % n], l = Math.hypot(q[0] - p[0], q[1] - p[1]); return [(q[0] - p[0]) / l, (q[1] - p[1]) / l]; }
    const th = a.a0 + (end ? a.sweep : 0), sg = Math.sign(a.sweep);
    return [-sg * Math.sin(th), sg * Math.cos(th)];
  };
  for (const [e, fl] of fls) {
    if (owner[e] !== e) continue;
    const a = arcs.get(e), o2 = owner[(e + (a ? a.m : 1)) % n], f2 = fls.get(o2);
    if (!f2 || o2 === e || (!a && !arcs.has(o2)) || +fl.offB > 0 || +f2.offA > 0 || (+fl.angle || 90) !== (+f2.angle || 90)) continue;
    const d0 = dirAt(e, 1), d1 = dirAt(o2, 0);
    if (Math.abs(d0[0] * d1[1] - d0[1] * d1[0]) > 0.03 || d0[0] * d1[0] + d0[1] * d1[1] < 0) continue;
    out.set(e, { ...(out.get(e) || {}), b: true });
    out.set(o2, { ...(out.get(o2) || {}), a: true });
  }
  return out;
}
// a point of a curved edge as a little straight edge: s = arc length from the start of the edge
const arcEdge = (a, s) => {
  const sg = Math.sign(a.sweep), th = a.a0 + (sg * s) / a.R, c = Math.cos(th), sn = Math.sin(th);
  return { a: [a.c[0] + a.R * c, a.c[1] + a.R * sn], e: [-sg * sn, sg * c], n: a.convex ? [c, sn] : [-c, -sn] };
};

// The bends of a flange: the flange itself and the flanges on its free edge (flange on flange), each
// { angle, h }. Angles are signed in the cross-section: + turns up / on round like the first bend
// (U-channel lip, hem), − turns the other way (Z step, hat).
export function flangeChain(fl) {
  return [{ angle: +fl.angle || 90, h: +fl.h || 0 }, ...(fl.next || []).map(q => ({ angle: +q.angle || 90, h: +q.h || 0 }))];
}

// Cross-section of a chain of bends in (u = outward, v = up) coordinates: the mid-surface runs from the plate's
// edge (u = 0, v = t/2) outwards, every bend is an arc with the inner radius r on the side it turns to, every
// flange a straight piece of length h; the section is the strip ±t/2 around it (top side out, bottom side back).
function chainSection(t, r, chain) {
  let pos = [0, t / 2], dir = [1, 0];
  const L = [[0, t]], Rt = [[0, 0]];
  const nl = d => [-d[1], d[0]];
  const add = (p, d) => { const n = nl(d); L.push([p[0] + n[0] * t / 2, p[1] + n[1] * t / 2]); Rt.push([p[0] - n[0] * t / 2, p[1] - n[1] * t / 2]); };
  for (const b of chain) {
    const th = b.angle * DEG, sgn = Math.sign(th) || 1, rm = r + t / 2, n0 = nl(dir);
    const C = [pos[0] + n0[0] * sgn * rm, pos[1] + n0[1] * sgn * rm];
    const k = Math.max(4, Math.ceil(Math.abs(b.angle) / 6));
    const p0 = [pos[0] - C[0], pos[1] - C[1]];
    for (let i = 1; i <= k; i++) {
      const a = (th * i) / k, c = Math.cos(a), s = Math.sin(a);
      const p = [C[0] + p0[0] * c - p0[1] * s, C[1] + p0[0] * s + p0[1] * c];
      add(p, [dir[0] * c - dir[1] * s, dir[0] * s + dir[1] * c]);
    }
    const c = Math.cos(th), s = Math.sin(th);
    pos = [C[0] + p0[0] * c - p0[1] * s, C[1] + p0[0] * s + p0[1] * c];
    dir = [dir[0] * c - dir[1] * s, dir[0] * s + dir[1] * c];
    if (b.h > 1e-6) { pos = [pos[0] + dir[0] * b.h, pos[1] + dir[1] * b.h]; add(pos, dir); }
  }
  const pts = [...L, ...Rt.reverse()];
  // nudge the start back by a hair so the flange fuses with the plate
  return pts.map(([u, w], i) => [u - 1e-3 * (i === 0 || i === pts.length - 1 ? 1 : 0), w]);
}

// Mid-surface of a bend chain as (d, u) pairs: d = developed length from the plate edge (bend zones count with
// their allowance), u = how far the sheet is out from the plate edge in plan at that point.
function chainMid(t, r, k, chain) {
  let pos = [0, 0], dir = [1, 0], d = 0;
  const out = [[0, 0]];
  const nl = v => [-v[1], v[0]];
  for (const b of chain) {
    const th = b.angle * DEG, sgn = Math.sign(th) || 1, rm = r + t / 2, n0 = nl(dir);
    const C = [pos[0] + n0[0] * sgn * rm, pos[1] + n0[1] * sgn * rm], p0 = [pos[0] - C[0], pos[1] - C[1]];
    const n = Math.max(4, Math.ceil(Math.abs(b.angle) / 6)), ba = bendAllowance(Math.abs(b.angle), r, t, k);
    for (let i = 1; i <= n; i++) {
      const a = (th * i) / n, c = Math.cos(a), s = Math.sin(a);
      out.push([d + (ba * i) / n, C[0] + p0[0] * c - p0[1] * s]);
    }
    const c = Math.cos(th), s = Math.sin(th);
    pos = [C[0] + p0[0] * c - p0[1] * s, C[1] + p0[0] * s + p0[1] * c];
    dir = [dir[0] * c - dir[1] * s, dir[0] * s + dir[1] * c];
    d += ba;
    if (b.h > 1e-6) { pos = [pos[0] + dir[0] * b.h, pos[1] + dir[1] * b.h]; d += b.h; out.push([d, pos[0]]); }
  }
  return out;
}

// Where a point of a flange lies: level = which flange of the chain (0 = the first), d = distance from the end of
// its bend along the flange. pos / dir / nrm in the cross-section (u out, v up; mid-surface), dev = developed
// length from the plate edge.
export function chainAt(t, r, k, chain, level, d) {
  let pos = [0, t / 2], dir = [1, 0], dev = 0;
  const nl = v => [-v[1], v[0]];
  for (let i = 0; i < chain.length; i++) {
    const b = chain[i], th = b.angle * DEG, sgn = Math.sign(th) || 1, rm = r + t / 2, n0 = nl(dir);
    const C = [pos[0] + n0[0] * sgn * rm, pos[1] + n0[1] * sgn * rm], p0 = [pos[0] - C[0], pos[1] - C[1]], c = Math.cos(th), s = Math.sin(th);
    pos = [C[0] + p0[0] * c - p0[1] * s, C[1] + p0[0] * s + p0[1] * c];
    dir = [dir[0] * c - dir[1] * s, dir[0] * s + dir[1] * c];
    dev += bendAllowance(Math.abs(b.angle), r, t, k);
    if (i === level) return { pos: [pos[0] + dir[0] * d, pos[1] + dir[1] * d], dir, nrm: nl(dir), dev: dev + d, h: b.h };
    pos = [pos[0] + dir[0] * b.h, pos[1] + dir[1] * b.h];
    dev += b.h;
  }
  return null;
}
// Cut-outs in a flange: fl.holes = [{ lv (flange of the chain), s (centre along the edge, from its start), d (centre
// from the end of the bend), kind: 'circle' | 'rect', dia, w (along the edge), h (along the flange) }]
// kind 'poly': a free outline, pts = [[x along the edge, y along the flange], …] around the centre (s, d) – what a
// 'sketch' cut-out (the closed profiles of a sketch) is resolved to before it gets here
const flangeHoles = fl => (fl.holes || []).filter(q => (q.kind === 'poly' ? q.pts?.length >= 3 : q.kind === 'rect' ? +q.w > 0 && +q.h > 0 : q.kind === 'sketch' ? false : +q.dia > 0));
// extent of a cut-out around its centre: [x0, x1, y0, y1]
const holeBox = q => {
  if (q.kind === 'poly') return [Math.min(...q.pts.map(p => p[0])), Math.max(...q.pts.map(p => p[0])), Math.min(...q.pts.map(p => p[1])), Math.max(...q.pts.map(p => p[1]))];
  const w = (q.kind === 'rect' ? +q.w : +q.dia) / 2, hh = (q.kind === 'rect' ? +q.h : +q.dia) / 2;
  return [-w, w, -hh, hh];
};
// outline of such a cut-out in the flat pattern
function flatHole(ed, at, q, s = +q.s) {
  const C = [ed.a[0] + ed.e[0] * s + ed.n[0] * at.dev, ed.a[1] + ed.e[1] * s + ed.n[1] * at.dev];
  if (q.kind === 'poly') return q.pts.map(([x, y]) => [C[0] + ed.e[0] * x + ed.n[0] * y, C[1] + ed.e[1] * x + ed.n[1] * y]);
  if (q.kind === 'rect') { const w = +q.w / 2, hh = +q.h / 2; return [[-w, -hh], [w, -hh], [w, hh], [-w, hh]].map(([x, y]) => [C[0] + ed.e[0] * x + ed.n[0] * y, C[1] + ed.e[1] * x + ed.n[1] * y]); }
  const rr = +q.dia / 2;
  return Array.from({ length: 48 }, (_, i) => [C[0] + rr * Math.cos((i * Math.PI) / 24), C[1] + rr * Math.sin((i * Math.PI) / 24)]);
}

// Corners between flanges ("Ecke"): with f.corner === 'closed' a flange whose neighbour on a convex corner
// is bent as well runs on to the angle bisector of the corner, leaving the gap f.cornerGap between the two.
// Per flange end: null (open: shortened by the relief) or { V, m, g, out } - V the corner, m the unit normal of
// the bisector pointing away from this flange, out the edge direction beyond V.
export function flangeEnds(edges, f) {
  // (curved edges count as one edge, listed at their first chord: at a real corner – not where they run on
  // without a kink, see flangeJoins – a flange on a curved edge is mitred like any other, along the plane between
  // the two directions at the corner)
  const n = edges.length, arcs = polyArcs(edges.map(e => e.a)), owner = edges.map((_, i) => i), none = edges.map(() => ({ a: null, b: null }));
  for (const a of arcs.values()) { if (a.full) return none; for (let q = 0; q < a.m; q++) owner[(a.i0 + q) % n] = a.i0; }
  const fls = new Map();
  for (const q of f.flanges || []) {
    if (!q.on || owner[q.edge] !== q.edge) continue;
    const e = fls.get(q.edge) || { first: q, last: q };
    if ((+q.offA || 0) < (+e.first.offA || 0)) e.first = q;
    if ((+q.offB || 0) < (+e.last.offB || 0)) e.last = q;
    fls.set(q.edge, e);
  }
  const closed = f.corner === 'closed', g = Math.max(0, +(f.cornerGap ?? 0.2));
  // direction and outward normal of an edge at its start (end = 0) or its end (1)
  const at = (o, end) => {
    const a = arcs.get(o);
    if (!a) return { e: edges[o].e, n: edges[o].n };
    const th = a.a0 + (end ? a.sweep : 0), sg = Math.sign(a.sweep), e = [-sg * Math.sin(th), sg * Math.cos(th)];
    return { e, n: [e[1], -e[0]] };
  };
  const corner = (i, j) => {
    // edge i ends where edge j starts; convex for a CCW polygon when e_i x e_j > 0
    const A = at(i, 1), B = at(j, 0), fi = fls.get(i)?.last, fj = fls.get(j)?.first, round = arcs.has(i) || arcs.has(j);
    if (!closed || !fi || !fj || i === j || +fi.offB > 0 || +fj.offA > 0 || A.e[0] * B.e[1] - A.e[1] * B.e[0] < (round ? 0.05 : 1e-6)) return null;
    const w0 = [A.n[0] + B.n[0], A.n[1] + B.n[1]], wl = Math.hypot(...w0);
    return { V: edges[j].a, w: [w0[0] / wl, w0[1] / wl], nA: A.n, nB: B.n, eA: A.e, eB: B.e };
  };
  const mk = (c, nOther, out) => {
    if (!c) return null;
    const dn = nOther[0] * c.w[0] + nOther[1] * c.w[1];
    let m = [nOther[0] - dn * c.w[0], nOther[1] - dn * c.w[1]];
    const ml = Math.hypot(...m); m = [m[0] / ml, m[1] / ml];
    return { V: c.V, m, g, out };
  };
  return edges.map((ed, i) => {
    if (owner[i] !== i) return { a: null, b: null };
    const len = arcs.get(i)?.m || 1, prev = owner[(i - 1 + n) % n], next = owner[(i + len) % n];
    const ca = corner(prev, i), cb = corner(i, next);
    return { a: ca && mk(ca, ca.nA, [-ca.eB[0], -ca.eB[1]]), b: cb && mk(cb, cb.nB, cb.eA) };
  });
}
// where a flange on a curved edge, out by u, meets the plane of a mitred corner: the angle next to th
function mitreAngle(a, end, u, th) {
  const rho = a.convex ? a.R + u : a.R - u, o = [end.V[0] - (end.m[0] * end.g) / 2, end.V[1] - (end.m[1] * end.g) / 2];
  const kq = ((o[0] - a.c[0]) * end.m[0] + (o[1] - a.c[1]) * end.m[1]) / rho;
  if (!(Math.abs(kq) < 1)) return th;
  const phi = Math.atan2(end.m[1], end.m[0]), ac = Math.acos(kq), wrap = x => Math.atan2(Math.sin(x), Math.cos(x));
  const d1 = wrap(phi + ac - th), d2 = wrap(phi - ac - th);
  return th + (Math.abs(d1) < Math.abs(d2) ? d1 : d2);
}
// how far past the corner (along `out`) the sheet may run at outward offset u before it reaches the cut
const endReach = (end, nrm, u) => {
  const om = end.out[0] * end.m[0] + end.out[1] * end.m[1], nm = nrm[0] * end.m[0] + nrm[1] * end.m[1];
  return om > 1e-9 ? (-end.g / 2 - u * nm) / om : 0;
};

// Corner reliefs of closed corners in plan (flat pattern coordinates): where the first bend zones of the two
// flanges cross beyond the corner. firstBA[edge] = allowance of that flange's first bend.
function cornerReliefs(edges, ends, f, firstBA) {
  const rel = f.cornerRelief || 'round', out = [];
  if (f.corner !== 'closed' || rel === 'none') return out;
  edges.forEach((ed, i) => {
    const end = ends[i].b, j = (i + 1) % edges.length;
    if (!end || firstBA[i] == null || firstBA[j] == null) return;
    const V = end.V, ni = ed.n, nj = edges[j].n, bi = firstBA[i], bj = firstBA[j];
    // parallelogram of the crossing bend zones beyond the corner: the plate corner V, then out along both normals
    const P = [V, [V[0] + nj[0] * bj, V[1] + nj[1] * bj], [V[0] + nj[0] * bj + ni[0] * bi, V[1] + nj[1] * bj + ni[1] * bi], [V[0] + ni[0] * bi, V[1] + ni[1] * bi]];
    if (rel === 'square') { out.push({ i, j, poly: P }); return; }
    const c = [(P[0][0] + P[2][0]) / 2, (P[0][1] + P[2][1]) / 2], R0 = Math.hypot(P[2][0] - P[0][0], P[2][1] - P[0][1]) / 2;
    out.push({ i, j, poly: Array.from({ length: 32 }, (_, q) => [c[0] + R0 * Math.cos((q * Math.PI) / 16), c[1] + R0 * Math.sin((q * Math.PI) / 16)]) });
  });
  return out;
}

// Parameter range [s0, s1] of the line o + dir·s inside a convex polygon (null if it misses).
function lineInConvex(poly, o, dir) {
  const P = ensureCCW(poly);
  let s0 = -Infinity, s1 = Infinity;
  for (let k = 0; k < P.length; k++) {
    const a = P[k], b = P[(k + 1) % P.length];
    // inside of a CCW edge: cross(b - a, x - a) >= 0
    const ex = b[0] - a[0], ey = b[1] - a[1];
    const f0 = ex * (o[1] - a[1]) - ey * (o[0] - a[0]), fd = ex * dir[1] - ey * dir[0];
    if (Math.abs(fd) < 1e-12) { if (f0 < 0) return null; continue; }
    const sc = -f0 / fd;
    if (fd > 0) s0 = Math.max(s0, sc); else s1 = Math.min(s1, sc);
  }
  return s0 < s1 ? [s0, s1] : null;
}

// Cross-section (u out, v up) of the part of the FIRST bend between developed lengths d0 and d1 (as in
// chainSection), grown a little so a cut with it leaves no skin.
function bendSlice(t, r, angleDeg, ba, d0, d1) {
  const th = angleDeg * DEG, sgn = Math.sign(th) || 1, rm = r + t / 2;
  const C = [0, t / 2 + sgn * rm], p0 = [0, t / 2 - C[1]];
  const n = 4, inner = [], outer = [];
  for (let q = 0; q <= n; q++) {
    const a = th * ((d0 + ((d1 - d0) * q) / n) / ba), c = Math.cos(a), sn = Math.sin(a);
    const m = [C[0] + p0[0] * c - p0[1] * sn, C[1] + p0[0] * sn + p0[1] * c];
    const rad = [(m[0] - C[0]) / rm, (m[1] - C[1]) / rm];
    inner.push([C[0] + rad[0] * (rm - t / 2 - 0.05), C[1] + rad[1] * (rm - t / 2 - 0.05)]);
    outer.push([C[0] + rad[0] * (rm + t / 2 + 0.05), C[1] + rad[1] * (rm + t / 2 + 0.05)]);
  }
  return [...inner, ...outer.reverse()];
}

const polyDrawing = (R, p) => { let d = R.draw(p[0]); for (let i = 1; i < p.length; i++) d = d.lineTo(p[i]); return d.close(); };
// outline of the plate with true arcs where a flange stands on a curved edge (runs: those arcs)
function plateDrawing(R, P, runs) {
  if (!runs.length) return polyDrawing(R, P);
  if (runs[0].full) return R.drawCircle(runs[0].R).translate(runs[0].c[0], runs[0].c[1]);
  const n = P.length, at = new Map(runs.map(a => [a.i0, a])), s = runs[0].i0;
  let d = R.draw(P[s]);
  for (let k = 0; k < n;) {
    const i = (s + k) % n, a = at.get(i);
    if (a) {
      const am = a.a0 + a.sweep / 2;
      d = d.threePointsArcTo(P[(i + a.m) % n], [a.c[0] + a.R * Math.cos(am), a.c[1] + a.R * Math.sin(am)]);
      k += a.m;
    } else { k++; if (k < n) d = d.lineTo(P[(s + k) % n]); }
  }
  return d.close();
}

// distance of a flange from the two ends of its edge: a closed corner (miter), the distance the user gave
// (partial flange: fl.offA from the start, fl.offB from the end of the edge) or the relief gap
const flangeGaps = (fl, en, gap, closedGap, jn = null) => [jn?.a ? 0 : +fl.offA > 0 ? +fl.offA : en.a ? closedGap : gap, jn?.b ? 0 : +fl.offB > 0 ? +fl.offB : en.b ? closedGap : gap];

export function sheetSolid(R, poly, z0, f, holes = []) {
  const t = +f.thickness, r = +f.radius, k = +f.kfactor;
  if (!(t > 0)) throw new Error('Blechdicke fehlt');
  f = splitAtFolds(poly, f);
  const edges = polyEdges(poly);
  const ends = flangeEnds(edges, f);
  const arcs = polyArcs(poly), firstBA = {}, firstAng = {};
  for (const fl of f.flanges || []) if (fl.on && edges[fl.edge] && !arcs.has(fl.edge)) { firstAng[fl.edge] = flangeChain(fl)[0].angle; firstBA[fl.edge] = bendAllowance(Math.abs(firstAng[fl.edge]), r, t, k); }
  const reliefs = cornerReliefs(edges, ends, f, firstBA), joins = flangeJoins(poly, f, arcs);
  // cut-outs in a flange: a prism through the sheet where the flange lies after bending. pe = the edge there
  // (for a curved edge: its tangent at the cut-out), s = the cut-out's place along it, extra = how much deeper
  // the prism must reach where the flange is curved
  const cutHole = (solid, fl, q, pe, s, extra = 0) => {
    const at = chainAt(t, r, k, flangeChain(fl), +q.lv || 0, +q.d || 0);
    if (!at) return solid;
    const dp = t + extra;
    const N = [pe.n[0] * at.nrm[0], pe.n[1] * at.nrm[0], at.nrm[1]];
    const O = [pe.a[0] + pe.e[0] * s + pe.n[0] * at.pos[0] - N[0] * dp, pe.a[1] + pe.e[1] * s + pe.n[1] * at.pos[0] - N[1] * dp, z0 + at.pos[1] - N[2] * dp];
    const pl = new R.Plane(O, [pe.e[0], pe.e[1], 0], N);
    // the plane's second axis is normal × edge: where that runs against the flange, a free outline is mirrored
    const yz = N[0] * pe.e[1] - N[1] * pe.e[0], yx = N[1] * 0 - N[2] * pe.e[1], yy = N[2] * pe.e[0] - N[0] * 0;
    const along = yx * pe.n[0] * at.dir[0] + yy * pe.n[1] * at.dir[0] + yz * at.dir[1] >= 0 ? 1 : -1;
    const dr = q.kind === 'poly' ? polyDrawing(R, ensureCCW(q.pts.map(([x, y]) => [x, y * along]))) : q.kind === 'rect' ? polyDrawing(R, [[-q.w / 2, -q.h / 2], [+q.w / 2, -q.h / 2], [+q.w / 2, +q.h / 2], [-q.w / 2, +q.h / 2]]) : R.drawCircle(+q.dia / 2);
    try { return solid.cut(dr.sketchOnPlane(pl).extrude(2 * dp)); } catch { return solid; /* outside the flange */ }
  };
  // the half space beyond the plane of a mitred corner (shifted by half the gap towards this flange), as a tall prism
  const mitreCut = (solid, end, BIG) => {
    const w = [-end.m[1], end.m[0]], o = [end.V[0] - end.m[0] * end.g / 2, end.V[1] - end.m[1] * end.g / 2];
    const quad = [[o[0] - w[0] * BIG, o[1] - w[1] * BIG], [o[0] + w[0] * BIG, o[1] + w[1] * BIG],
      [o[0] + w[0] * BIG + end.m[0] * BIG, o[1] + w[1] * BIG + end.m[1] * BIG], [o[0] - w[0] * BIG + end.m[0] * BIG, o[1] - w[1] * BIG + end.m[1] * BIG]];
    const ZB = Math.max(BIG, 1000);
    return solid.cut(polyDrawing(R, ensureCCW(quad)).sketchOnPlane('XY', z0 - ZB).extrude(2 * ZB));
  };
  let shape = plateDrawing(R, ensureCCW(poly), (f.flanges || []).filter(fl => fl.on && arcs.has(fl.edge)).map(fl => arcs.get(fl.edge)).filter((a, i, l) => l.indexOf(a) === i)).sketchOnPlane('XY', z0).extrude(t);
  // cut-outs: the other closed profiles of the sketch, through the plate
  const collars = collarPlan(holes, f), pressed = pressPlan(holes, f);
  holes.forEach((hp, i) => { if (hp.length >= 3 && !collars.has(i) && !pressed.has(i)) shape = shape.cut(polyDrawing(R, ensureCCW(hp)).sketchOnPlane('XY', z0 - 1).extrude(t + 2)); });
  for (const c of collars.values()) shape = collarSolid(R, shape, z0, t, r, c);
  for (const [i, p] of pressed) shape = p.kind === 'dimple' ? dimpleSolid(R, shape, z0, t, p) : embossSolid(R, shape, z0, t, holes[i], p, i);
  (f.louvers || []).forEach((lv, i) => { shape = louverSolid(R, shape, z0, t, lv, i); });
  (f.beads || []).forEach((bd, i) => { shape = beadSolid(R, shape, z0, t, bd, i); });
  for (const fl of f.flanges || []) {
    if (!fl.on) continue;
    const ed = edges[fl.edge];
    if (!ed) continue;
    const gap = fl.relief ?? (r + t);
    const sec = chainSection(t, r, flangeChain(fl));
    if (arcs.has(fl.edge)) {
      // a curved edge: the section turned around the centre of the arc (out = away from the plate)
      const a = arcs.get(fl.edge), en = ends[fl.edge], jn = joins.get(fl.edge) || {}, sp = arcSpan(a, fl, gap, { a: jn.a || !!en.a, b: jn.b || !!en.b });
      if (sp.len <= 0.1) throw new Error(`Kante ${fl.edge + 1} ist zu kurz für eine Lasche`);
      const prof = sec.map(([u, v]) => [a.convex ? a.R + u : a.R - u, v]);
      if (prof.some(p => p[0] < 0.05)) throw new Error(`Kante ${fl.edge + 1}: der Bogen ist zu eng für diese Lasche`);
      // a mitred corner: on past the corner, the cut along the plane of the corner trims it back
      const over = Math.max(...sec.map(p => Math.abs(p[0]))) + t + 1, sg = Math.sign(a.sweep);
      const room = Math.max(0, (2 * Math.PI - Math.abs(sp.th1 - sp.th0) - 0.05) / 2), ext = Math.min(over / Math.max(1e-6, Math.min(...prof.map(p => p[0]))), 1, room);
      const tA = sp.th0 - (en.a ? sg * ext : 0), tB = sp.th1 + (en.b ? sg * ext : 0);
      const lo = Math.min(tA, tB), x = [Math.cos(lo), Math.sin(lo), 0], o = [a.c[0], a.c[1], z0];
      let ring = polyDrawing(R, prof).sketchOnPlane(new R.Plane(o, x, [x[1], -x[0], 0])).revolve([0, 0, 1], { origin: o, angle: a.full ? 360 : (Math.abs(tB - tA) * 180) / Math.PI });
      // (only next to the corner: further on, the plane of the corner may pass through the ring again)
      for (const end of [en.a, en.b]) if (end) ring = mitreCut(ring, end, 1.5 * over * (1 + ext) + 2);
      for (const q of flangeHoles(fl)) {
        const at = chainAt(t, r, k, flangeChain(fl), +q.lv || 0, +q.d || 0);
        if (!at) continue;
        // the wall is round: the prism has to reach through it at the sides of the cut-out too
        const bx = holeBox(q), hw = Math.max(Math.abs(bx[0]), Math.abs(bx[1])), rho = a.convex ? a.R + at.pos[0] : a.R - at.pos[0];
        const sag = hw < rho ? rho - Math.sqrt(rho * rho - hw * hw) : rho;
        ring = cutHole(ring, fl, q, arcEdge(a, +q.s || 0), 0, Math.min(sag, Math.max(0, rho - t)) + 0.1);
      }
      shape = shape.fuse(ring);
      continue;
    }
    const en = endsOf(ends, fl);
    // a closed corner: run past the corner by the full width of the section, the miter cut trims it back
    const over = Math.max(...sec.map(p => Math.abs(p[0]))) + t + 1;
    const [gA, gB] = flangeGaps(fl, en, gap, -over, joins.get(fl.edge));
    const len = ed.L - gA - gB;
    if (len <= 0.1) throw new Error(`Kante ${fl.edge + 1} ist zu kurz für eine Lasche`);
    // plane: x = outward normal, y = +Z, normal = n × Z = -e (extrusion runs back along the edge)
    const origin = [ed.b[0] - ed.e[0] * gB, ed.b[1] - ed.e[1] * gB, z0];
    const pl = new R.Plane(origin, [ed.n[0], ed.n[1], 0], [-ed.e[0], -ed.e[1], 0]);
    let solid = polyDrawing(R, sec).sketchOnPlane(pl).extrude(len);
    for (const end of [en.a, en.b]) if (end) solid = mitreCut(solid, end, 10 * (over + ed.L));
    // corner relief in the folded part: the flat relief mapped back onto the first bend. The bend zone is cut in
    // slices of developed length; each slice loses the stretch along the edge that lies inside the relief there.
    for (const rl of reliefs) {
      const end = rl.i === fl.edge ? en.b : rl.j === fl.edge ? en.a : null;
      if (!end) continue;
      const ba = firstBA[fl.edge], ang = firstAng[fl.edge], NS = 6;
      for (let q = 0; q < NS; q++) {
        const d0 = (ba * q) / NS, d1 = (ba * (q + 1)) / NS;
        let lo = Infinity, hi = -Infinity;
        for (const dd of [d0, (d0 + d1) / 2, d1]) {
          const o = [end.V[0] + ed.n[0] * dd, end.V[1] + ed.n[1] * dd], rg = lineInConvex(rl.poly, o, end.out);
          if (rg) { lo = Math.min(lo, rg[0]); hi = Math.max(hi, rg[1]); }
        }
        if (!(hi > lo + 1e-3)) continue;
        // prism along the edge: section in a plane at s = hi, extruded back to s = lo (normal = -out)
        const nrm = [-end.out[0], -end.out[1], 0], o3 = [end.V[0] + end.out[0] * hi, end.V[1] + end.out[1] * hi, z0];
        const up = nrm[0] * ed.n[1] - nrm[1] * ed.n[0]; // z of normal × n: +1 keeps the section upright
        let sl = bendSlice(t, r, ang, ba, d0, d1);
        if (up < 0) sl = sl.map(([u, v]) => [u, -v]);
        const pl = new R.Plane(o3, [ed.n[0], ed.n[1], 0], nrm);
        solid = solid.cut(polyDrawing(R, up < 0 ? sl.slice().reverse() : sl).sketchOnPlane(pl).extrude(hi - lo));
      }
    }
    for (const q of flangeHoles(fl)) solid = cutHole(solid, fl, q, ed, +q.s || 0);
    shape = shape.fuse(solid);
  }
  return foldSolid(R, shape, poly, holes, z0, f);
}

const one = x => (x && x.solids && x.solids.length === 1 ? x.solids[0] : x);
// the corners a flange meets: none at an end where it stops short of the corner
const endsOf = (ends, fl) => { const en = ends[fl.edge] || { a: null, b: null }; return { a: +fl.offA > 0 ? null : en.a, b: +fl.offB > 0 ? null : en.b }; };

/**
 * A flange on a straight edge that runs across a bend line is cut there: one flange on each side, each ending the
 * relief (fl.relief, else r + t) before the bend zone. Cut-outs go to the piece they lie in. Returns f with these
 * pieces (marked split) – or f itself where nothing is cut.
 */
export function splitAtFolds(poly, f) {
  if (!(f.folds || []).length || !(f.flanges || []).some(q => q.on)) return f;
  let plan;
  try { plan = foldPlan(poly, f); } catch { return f; /* reported where the bends are built */ }
  if (!plan) return f;
  const t = +f.thickness, r = +f.radius, edges = polyEdges(poly), arcs = polyArcs(poly), out = [];
  let any = false;
  for (const fl of f.flanges) {
    const ed = edges[fl.edge];
    if (!fl.on || !ed || arcs.has(fl.edge) || fl.split) { out.push(fl); continue; }
    const gap = fl.relief ?? (r + t), cuts = [];
    for (const q of plan.folds) {
      const da = (ed.a[0] - q.o[0]) * q.n[0] + (ed.a[1] - q.o[1]) * q.n[1], den = ed.e[0] * q.n[0] + ed.e[1] * q.n[1];
      if (Math.abs(den) < 1e-9) { if (Math.abs(da) < q.ba / 2 - 1e-6) throw new Error(`Kante ${fl.edge + 1}: die Lasche liegt in einer Biegezone`); continue; }
      const sc = -da / den, hw = q.ba / 2 / Math.abs(den);
      if (sc + hw > 1e-6 && sc - hw < ed.L - 1e-6) cuts.push([sc - hw - gap, sc + hw + gap]);
    }
    const A0 = +fl.offA > 0 ? +fl.offA : 0, B0 = ed.L - (+fl.offB > 0 ? +fl.offB : 0);
    cuts.sort((p, q) => p[0] - q[0]);
    if (!cuts.some(c => c[1] > A0 && c[0] < B0)) { out.push(fl); continue; }
    any = true;
    let lo = A0;
    const segs = [];
    for (const c of cuts) { if (c[0] > lo) segs.push([lo, Math.min(c[0], B0)]); lo = Math.max(lo, c[1]); }
    if (lo < B0) segs.push([lo, B0]);
    for (const [a, b] of segs) {
      if (b - a < 0.5) continue;
      out.push({ ...fl, split: true, offA: a > A0 + 1e-9 ? a : fl.offA, offB: b < B0 - 1e-9 ? ed.L - b : fl.offB, holes: (fl.holes || []).filter(h => h.kind === 'sketch' || (+h.s >= a && +h.s <= b)) });
    }
  }
  return any ? { ...f, flanges: out } : f;
}

/**
 * Bends on lines across the plate ("Biegung an einer Skizzenlinie"): f.folds = [{ a, b, angle }]. The sketch is the
 * blank there: the line is the middle of the bend zone, the zone (as wide as the bend allowance) lies in the plate.
 * The lines (endless) cut the plate into pieces; the largest stays where it is, every other piece turns with all
 * bends between it and the largest. Returns null without bends, else { folds: [{ o, e, n, angle, ba }], cells:
 * [{ sig (side of every line: ±1), path: [{ i (bend), s (side of the piece seen from the fixed one) }] }], edges:
 * [{ i, s, path (of the fixed side) }] }.
 */
export function foldPlan(poly, f) {
  const t = +f.thickness, r = +f.radius, k = +f.kfactor;
  const folds = (f.folds || []).filter(q => q && q.on !== false && Number.isFinite(+q.angle) && +q.angle).map(q => {
    const L = Math.hypot(q.b[0] - q.a[0], q.b[1] - q.a[1]);
    if (!(L > 1e-6)) throw new Error('Biegelinie ohne Länge');
    if (Math.abs(+q.angle) > 180) throw new Error('Biegewinkel über 180° ist nicht herstellbar');
    const e = [(q.b[0] - q.a[0]) / L, (q.b[1] - q.a[1]) / L];
    return { o: [(q.a[0] + q.b[0]) / 2, (q.a[1] + q.b[1]) / 2], e, n: [-e[1], e[0]], angle: +q.angle, ba: bendAllowance(Math.abs(+q.angle), r, t, k) };
  });
  if (!folds.length) return null;
  const P = ensureCCW(poly);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of P) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
  const BIG = 4 * Math.hypot(x1 - x0, y1 - y0) + 100;
  const L = window.ClipperLib, S = 1000, toC = p => p.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
  const c = new L.Clipper(), out = new L.Paths();
  c.AddPaths([toC(P)], L.PolyType.ptSubject, true);
  c.AddPaths(folds.map(q => toC(ensureCCW([[-BIG, -q.ba / 2], [BIG, -q.ba / 2], [BIG, q.ba / 2], [-BIG, q.ba / 2]].map(([u, v]) => [q.o[0] + q.e[0] * u + q.n[0] * v, q.o[1] + q.e[1] * u + q.n[1] * v])))), L.PolyType.ptClip, true);
  c.Execute(L.ClipType.ctDifference, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  const cells = new Map();
  for (const p of out) {
    const A = L.Clipper.Area(p) / (S * S);
    if (!(A > 1e-3)) continue;
    const sig = folds.map(q => { let m = 0; for (const v of p) { const d = (v.X / S - q.o[0]) * q.n[0] + (v.Y / S - q.o[1]) * q.n[1]; if (Math.abs(d) > Math.abs(m)) m = d; } return m >= 0 ? 1 : -1; });
    const key = sig.join(',');
    if (!cells.has(key)) cells.set(key, { sig, area: 0, path: null });
    cells.get(key).area += A;
  }
  const list = [...cells.values()].sort((a, b) => b.area - a.area);
  if (list.length < 2) throw new Error('Die Biegelinie liegt nicht in der Platte');
  const cross = 'Biegelinien dürfen sich in der Platte nicht kreuzen';
  list[0].path = [];
  const edges = [], queue = [list[0]], usedFold = new Set();
  let links = 0;
  for (let a = 0; a < list.length; a++) for (let b = a + 1; b < list.length; b++) if (list[a].sig.filter((v, i) => v !== list[b].sig[i]).length === 1) links++;
  if (links > list.length - 1) throw new Error(cross);
  while (queue.length) {
    const cur = queue.shift();
    for (const nx of list) {
      if (nx.path) continue;
      const diff = cur.sig.map((v, i) => (v !== nx.sig[i] ? i : -1)).filter(i => i >= 0);
      if (diff.length !== 1) continue;
      const i = diff[0];
      if (usedFold.has(i)) throw new Error(cross);
      usedFold.add(i);
      nx.path = [...cur.path, { i, s: nx.sig[i] }];
      edges.push({ i, s: nx.sig[i], path: cur.path });
      queue.push(nx);
    }
  }
  if (list.some(q => !q.path)) throw new Error(cross);
  folds.forEach((q, i) => { if (!usedFold.has(i)) throw new Error(`Biegelinie ${i + 1} liegt nicht in der Platte`); });
  return { folds, cells: list, edges, BIG };
}

// where the line o + s·w runs inside the loops (even-odd): [[s0, s1], …]
function lineSpans(loops, o, w) {
  const xs = [];
  for (const P of loops) for (let i = 0; i < P.length; i++) {
    const a = P[i], b = P[(i + 1) % P.length];
    const da = w[0] * (a[1] - o[1]) - w[1] * (a[0] - o[0]), db = w[0] * (b[1] - o[1]) - w[1] * (b[0] - o[0]);
    if ((da > 0) === (db > 0)) continue;
    const q = da / (da - db);
    xs.push((a[0] + (b[0] - a[0]) * q - o[0]) * w[0] + (a[1] + (b[1] - a[1]) * q - o[1]) * w[1]);
  }
  xs.sort((p, q) => p - q);
  const out = [];
  for (let i = 0; i + 1 < xs.length; i += 2) if (xs[i + 1] - xs[i] > 1e-6) out.push([xs[i], xs[i + 1]]);
  return out;
}

// the stretch of its edge a flange stands on must lie on one side of every bend line
function foldFlangeCheck(poly, f, plan) {
  const t = +f.thickness, r = +f.radius, edges = polyEdges(poly), arcs = polyArcs(poly), P = ensureCCW(poly);
  for (const fl of f.flanges || []) {
    const ed = edges[fl.edge];
    if (!fl.on || !ed) continue;
    const a = arcs.get(fl.edge), gap = fl.relief ?? (r + t);
    const pts = a ? Array.from({ length: a.m + 1 }, (_, q) => P[(a.i0 + q) % P.length]) : [[ed.a[0] + ed.e[0] * (+fl.offA > 0 ? +fl.offA : Math.min(gap, ed.L / 2)), ed.a[1] + ed.e[1] * (+fl.offA > 0 ? +fl.offA : Math.min(gap, ed.L / 2))], [ed.b[0] - ed.e[0] * (+fl.offB > 0 ? +fl.offB : Math.min(gap, ed.L / 2)), ed.b[1] - ed.e[1] * (+fl.offB > 0 ? +fl.offB : Math.min(gap, ed.L / 2))]];
    for (const q of plan.folds) {
      const d = pts.map(p => (p[0] - q.o[0]) * q.n[0] + (p[1] - q.o[1]) * q.n[1]);
      if (!(d.every(v => v >= q.ba / 2 - 1e-6) || d.every(v => v <= -q.ba / 2 + 1e-6))) throw new Error(`Kante ${fl.edge + 1}: die Lasche kreuzt eine Biegelinie – mit „Abstand Anfang / Ende“ vor der Biegung enden lassen`);
    }
  }
}

// the flat part (plate, flanges, beads, collars) cut along the bend lines, every piece turned to where it stands
function foldSolid(R, shape, poly, holes, z0, f) {
  const plan = foldPlan(poly, f);
  if (!plan) return shape;
  foldFlangeCheck(poly, f, plan);
  const t = +f.thickness, r = +f.radius;
  let reach = 0;
  for (const fl of f.flanges || []) if (fl.on) reach = Math.max(reach, flangeChain(fl).reduce((a, b) => a + Math.abs(b.h) + 2 * (r + t), 0));
  const P = ensureCCW(poly), cx = P.reduce((a, p) => a + p[0], 0) / P.length, cy = P.reduce((a, p) => a + p[1], 0) / P.length, BIG = plan.BIG + 4 * reach;
  // one bend: the piece beyond it moves up to the start of the zone and turns about the axis of the bend
  const turn = (sh, { i, s }) => {
    const q = plan.folds[i], m = [q.n[0] * s, q.n[1] * s], sg = Math.sign(q.angle);
    const os = [q.o[0] - m[0] * q.ba / 2, q.o[1] - m[1] * q.ba / 2];
    return sh.translate(-m[0] * q.ba, -m[1] * q.ba, 0).rotate(q.angle, [os[0], os[1], z0 + (sg > 0 ? t + r : -r)], [m[1], -m[0], 0]);
  };
  const place = (sh, path) => { for (let j = path.length - 1; j >= 0; j--) sh = turn(sh, path[j]); return sh; };
  const parts = [];
  for (const cell of plan.cells) {
    // its side of every line, as a large convex outline
    let reg = [[cx - BIG, cy - BIG], [cx + BIG, cy - BIG], [cx + BIG, cy + BIG], [cx - BIG, cy + BIG]];
    plan.folds.forEach((q, i) => {
      const s = cell.sig[i], d = p => ((p[0] - q.o[0]) * q.n[0] + (p[1] - q.o[1]) * q.n[1]) * s - q.ba / 2, nx = [];
      for (let j = 0; j < reg.length; j++) {
        const a = reg[j], b = reg[(j + 1) % reg.length], da = d(a), db = d(b);
        if (da >= 0) nx.push(a);
        if ((da >= 0) !== (db >= 0)) { const u = da / (da - db); nx.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]); }
      }
      reg = nx;
    });
    if (reg.length < 3) continue;
    const piece = one(shape.intersect(polyDrawing(R, ensureCCW(reg)).sketchOnPlane('XY', z0 - BIG).extrude(2 * BIG)));
    parts.push(place(piece, cell.path));
  }
  const loops = [P, ...holes.filter(h => h.length >= 3)];
  for (const ed of plan.edges) {
    const q = plan.folds[ed.i], m = [q.n[0] * ed.s, q.n[1] * ed.s], w = [m[1], -m[0]], th = Math.abs(q.angle) * DEG, sg = Math.sign(q.angle);
    const os = [q.o[0] - m[0] * q.ba / 2, q.o[1] - m[1] * q.ba / 2], cv = sg > 0 ? t + r : -r;
    const pt = (rho, a) => [rho * Math.sin(a), cv - sg * rho * Math.cos(a)];
    const spansAt = d => lineSpans(loops, [os[0] + m[0] * d, os[1] + m[1] * d], w);
    const s0 = spansAt(0.02 * q.ba), s1 = spansAt(0.5 * q.ba), s2 = spansAt(0.98 * q.ba);
    const same = s0.length === s1.length && s1.length === s2.length && s1.every((v, j) => Math.abs(v[0] - s0[j][0]) + Math.abs(v[1] - s0[j][1]) + Math.abs(v[0] - s2[j][0]) + Math.abs(v[1] - s2[j][1]) < 4e-3);
    const NS = same ? 1 : 8;
    for (let j = 0; j < NS; j++) {
      const a0 = (th * j) / NS, a1 = (th * (j + 1)) / NS, am = (a0 + a1) / 2;
      const dr = R.draw(pt(r, a0)).threePointsArcTo(pt(r, a1), pt(r, am)).lineTo(pt(r + t, a1)).threePointsArcTo(pt(r + t, a0), pt(r + t, am)).close();
      for (const [lo, hi] of same ? s1 : spansAt((q.ba * (j + 0.5)) / NS)) {
        const pl = new R.Plane([os[0] + w[0] * lo, os[1] + w[1] * lo, z0], [m[0], m[1], 0], [w[0], w[1], 0]);
        parts.push(place(dr.sketchOnPlane(pl).extrude(hi - lo), ed.path));
      }
    }
  }
  let all = parts[0];
  for (let i = 1; i < parts.length; i++) all = one(all.fuse(parts[i]));
  return all;
}

// a cut-out of the plate that is a circle: its centre and radius
export function holeCircle(hp) {
  if (!hp || hp.length < 12) return null;
  let cx = 0, cy = 0;
  for (const p of hp) { cx += p[0]; cy += p[1]; }
  cx /= hp.length; cy /= hp.length;
  const rs = hp.map(p => Math.hypot(p[0] - cx, p[1] - cy)), R0 = rs.reduce((a, b) => a + b, 0) / rs.length;
  return rs.every(x => Math.abs(x - R0) < 1e-3 * R0 + 1e-4) ? { c: [cx, cy], R: R0 } : null;
}

/**
 * Collars ("Durchzüge"): f.collars = [{ hole (index into holes), h }] – the round cut-out hole becomes the bore of
 * a collar that stands h above the plate (h < 0: below it). Map hole → { c, R (bore), h, hs (straight part), Rb
 * (where the bend starts), flat (radius of the hole to cut in the blank), ba }.
 */
export function collarPlan(holes, f) {
  const t = +f.thickness, r = +f.radius, k = +f.kfactor, out = new Map();
  for (const q of f.collars || []) {
    if (!q || q.on === false || !+q.h) continue;
    const ci = holeCircle(holes[q.hole]);
    if (!ci) continue;
    const H = Math.abs(+q.h), hs = Math.max(0, H - r), ba = bendAllowance(90, r, t, k), Rb = ci.R + r + t, flat = Rb - ba - hs;
    if (!(flat > 0.2)) throw new Error(`Durchzug ${q.hole + 1}: zu hoch für diese Bohrung (die Vorbohrung bliebe ohne Durchmesser)`);
    out.set(q.hole, { c: ci.c, R: ci.R, h: +q.h, hs, Rb, flat, ba });
  }
  return out;
}

/**
 * Pressed shapes in cut-outs of the sketch: f.embosses = [{ hole, h }] – the outline is not cut but pressed out of
 * the plate by h (h < 0: downwards), the sheet keeps its thickness; f.dimples = [{ hole, h }] – a round hole with
 * its rim pressed into a 90° cone, h deep (for countersunk screws in thin sheet). Map hole → { kind, h, … }.
 */
export function pressPlan(holes, f) {
  const t = +f.thickness, out = new Map();
  for (const q of f.embosses || []) {
    if (!q || !+q.h || !(holes[q.hole]?.length >= 3)) continue;
    out.set(q.hole, { kind: 'emboss', h: +q.h });
  }
  for (const q of f.dimples || []) {
    const ci = q && +q.h ? holeCircle(holes[q.hole]) : null;
    if (!ci) continue;
    out.set(q.hole, { kind: 'dimple', h: +q.h, c: ci.c, R: ci.R, Ro: ci.R + Math.abs(+q.h), t });
  }
  return out;
}

// the outline moved inwards by d (Clipper): loops
function insetLoops(hp, d) {
  const L = window.ClipperLib, S = 1000, co = new L.ClipperOffset(2, 0.02 * S), out = new L.Paths();
  co.AddPath(ensureCCW(hp).map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })), L.JoinType.jtRound, L.EndType.etClosedPolygon);
  co.Execute(out, -d * S);
  return out.filter(p => p.length >= 3 && Math.abs(L.Clipper.Area(p)) > 0.01 * S * S).map(p => p.map(q => [q.X / S, q.Y / S]));
}

function embossSolid(R, shape, z0, t, hp, p, idx) {
  const H = Math.abs(p.h), up = p.h > 0;
  const boss = polyDrawing(R, ensureCCW(hp)).sketchOnPlane('XY', up ? z0 + t - 1e-3 : z0 - H).extrude(H + 1e-3);
  let next = one(shape.fuse(boss));
  for (const lp of insetLoops(hp, t)) next = one(next.cut(polyDrawing(R, ensureCCW(lp)).sketchOnPlane('XY', up ? z0 - 0.01 : z0 - H + t).extrude(H + 0.01)));
  if (typeof next.fuse !== 'function') throw new Error(`Prägung ${idx + 1}: lässt sich so nicht formen`);
  return next;
}

function dimpleSolid(R, shape, z0, t, p) {
  const H = Math.abs(p.h), sg = p.h > 0 ? 1 : -1, o = [p.c[0], p.c[1], z0];
  // the rim as a cone: the sheet runs at 45° from the plate (radius Ro) to the hole (radius R), H away
  const pts = [[p.Ro + 1e-3, t], [p.R, t + sg * H], [p.R, sg * H], [p.Ro + 1e-3, 0]];
  const cone = polyDrawing(R, pts).sketchOnPlane(new R.Plane(o, [1, 0, 0], [0, -1, 0])).revolve([0, 0, 1], { origin: o, angle: 360 });
  return one(one(shape.cut(R.makeCylinder(p.Ro, t + 2, [p.c[0], p.c[1], z0 - 1], [0, 0, 1]))).fuse(cone));
}

/**
 * Louvres ("Kiemen"): f.louvers = [{ a, b, w, h }] – the line a–b is a slit; the sheet on its left (w < 0: on its
 * right) is pressed up into a hood, w deep and h high at the slit (h < 0: downwards), running out to the plate at
 * both ends of the slit.
 */
export function louverShape(t, lv, idx = 0) {
  const W = Math.abs(+lv.w), H = Math.abs(+lv.h), L = Math.hypot(lv.b[0] - lv.a[0], lv.b[1] - lv.a[1]);
  if (!(W > 0) || !(H > 0) || !(L > 1e-6)) return null;
  if (H > W + 1e-9) throw new Error(`Kieme ${idx + 1}: die Höhe darf höchstens die Tiefe sein`);
  if (L < 2 * W - 1e-9) throw new Error(`Kieme ${idx + 1}: der Schlitz muss mindestens doppelt so lang sein wie die Kieme tief`);
  const e = [(lv.b[0] - lv.a[0]) / L, (lv.b[1] - lv.a[1]) / L], sd = +lv.w > 0 ? [-e[1], e[0]] : [e[1], -e[0]];
  const a1 = [lv.a[0] + e[0] * W, lv.a[1] + e[1] * W], b1 = [lv.b[0] - e[0] * W, lv.b[1] - e[1] * W];
  return { W, H, L, e, sd, a1, b1, rho: (W * W + H * H) / (2 * H), sg: +lv.h > 0 ? 1 : -1 };
}
// footprint of a louvre: the slit, a quarter circle at each end, the line where the hood leaves the plate
const louverLoop = (q, lv, n = 12) => {
  const arc = (c, d0, d1) => Array.from({ length: n + 1 }, (_, i) => { const u = (i * Math.PI) / 2 / n; return [c[0] + q.W * (d0[0] * Math.cos(u) + d1[0] * Math.sin(u)), c[1] + q.W * (d0[1] * Math.cos(u) + d1[1] * Math.sin(u))]; });
  return [lv.a, ...arc(q.b1, q.e, q.sd), ...arc(q.a1, q.sd, [-q.e[0], -q.e[1]])];
};

function louverSolid(R, shape, z0, t, lv, idx) {
  const q = louverShape(t, lv, idx);
  if (!q) return shape;
  const { W, H, rho, sd, e, a1, b1, sg } = q;
  // section across the slit: x from the slit towards the hood's foot, y out of the plate (0 = the far face)
  const zf = sg > 0 ? z0 : z0 + t, Y = y => sg * y;
  const pt = (rad, phi) => [W - rad * Math.sin(phi), Y(t + rho - rad * Math.cos(phi))];
  const pT = Math.asin(Math.min(1, W / rho)), pB = Math.asin(Math.min(1, W / (rho + t)));
  const sec = () => R.draw([W, Y(0)]).threePointsArcTo(pt(rho + t, pB), pt(rho + t, pB / 2)).lineTo(pt(rho, pT)).threePointsArcTo([W, Y(t)], pt(rho, pT / 2)).close();
  const plane = (o, x) => new R.Plane([o[0], o[1], zf], [x[0], x[1], 0], [x[1], -x[0], 0]);
  const nrm = [sd[1], -sd[0]], along = nrm[0] * e[0] + nrm[1] * e[1] > 0, start = along ? a1 : b1, far = along ? b1 : a1;
  let hood = sec().sketchOnPlane(plane(start, sd)).revolve([0, 0, 1], { origin: [start[0], start[1], zf], angle: 90 });
  hood = one(hood.fuse(sec().sketchOnPlane(plane(far, nrm)).revolve([0, 0, 1], { origin: [far[0], far[1], zf], angle: 90 })));
  const Ls = Math.hypot(b1[0] - a1[0], b1[1] - a1[1]);
  if (Ls > 1e-6) hood = one(hood.fuse(sec().sketchOnPlane(plane(start, sd)).extrude(Ls)));
  // the plate under the hood goes: slit, quarter circles (true arcs, so the hood meets the wall), foot line
  const m = (c, d0, d1) => [c[0] + W * (d0[0] + d1[0]) * Math.SQRT1_2, c[1] + W * (d0[1] + d1[1]) * Math.SQRT1_2], ne = [-e[0], -e[1]];
  let fd = R.draw(lv.a).lineTo(lv.b).threePointsArcTo([b1[0] + sd[0] * W, b1[1] + sd[1] * W], m(b1, e, sd));
  if (Ls > 1e-6) fd = fd.lineTo([a1[0] + sd[0] * W, a1[1] + sd[1] * W]);
  const foot = fd.threePointsArcTo(lv.a, m(a1, sd, ne)).close();
  const next = one(one(shape.cut(foot.sketchOnPlane('XY', z0 - 0.01).extrude(t + 0.02))).fuse(hood));
  if (typeof next.fuse !== 'function') throw new Error(`Kieme ${idx + 1}: lässt sich so nicht formen`);
  return next;
}

function collarSolid(R, shape, z0, t, r, c) {
  const sec = chainSection(t, r, [{ angle: c.h > 0 ? 90 : -90, h: c.hs }]).map(([u, v]) => [c.Rb - u, v]);
  const o = [c.c[0], c.c[1], z0];
  const ring = polyDrawing(R, sec).sketchOnPlane(new R.Plane(o, [1, 0, 0], [0, -1, 0])).revolve([0, 0, 1], { origin: o, angle: 360 });
  return one(one(shape.cut(R.makeCylinder(c.Rb, t + 2, [c.c[0], c.c[1], z0 - 1], [0, 0, 1]))).fuse(ring));
}

/**
 * Beads ("Sicken"): f.beads = [{ a, b, w, h }] – a rib pressed into the plate along the line a–b, w wide, h high
 * (h < 0: downwards), round in section and at its ends; the sheet keeps its thickness.
 */
export function beadShape(t, bd, idx = 0) {
  const w = +bd.w, H = Math.abs(+bd.h), L = Math.hypot(bd.b[0] - bd.a[0], bd.b[1] - bd.a[1]);
  if (!(w > 0) || !(H > 0)) return null;
  if (H > w / 2 + 1e-9) throw new Error(`Sicke ${idx + 1}: die Höhe darf höchstens die halbe Breite sein`);
  const rho = (w * w / 4 + H * H) / (2 * H), ri = rho - t;
  if (!(ri > 0.05)) throw new Error(`Sicke ${idx + 1}: zu schmal für diese Blechdicke`);
  // inside: the same centre, the sheet thinner by t; where that meets the under side of the plate
  const yc = H - rho, wi = Math.sqrt(Math.max(0, ri * ri - (t + yc) * (t + yc)));
  if (!(wi > 0.05)) throw new Error(`Sicke ${idx + 1}: zu flach für diese Blechdicke`);
  return { w, H, L, rho, ri, yc, wi, sg: +bd.h > 0 ? 1 : -1 };
}

function beadSolid(R, shape, z0, t, bd, idx) {
  const q = beadShape(t, bd, idx);
  if (!q) return shape;
  const e = q.L > 1e-6 ? [(bd.b[0] - bd.a[0]) / q.L, (bd.b[1] - bd.a[1]) / q.L] : [1, 0], nl = [-e[1], e[0]], nr = [e[1], -e[0]];
  // section: x across the bead, y out of the plate (0 = the face the bead rises from)
  const zf = q.sg > 0 ? z0 + t : z0, Y = y => q.sg * y;
  const plane = (o, x) => new R.Plane([o[0], o[1], zf], [x[0], x[1], 0], [x[1], -x[0], 0]);
  const build = (hw, y0, top, rad) => {
    const be = Math.asin(Math.min(1, hw / rad)), mid = [rad * Math.sin(be / 2), q.yc + rad * Math.cos(be / 2)], lowY = y0 - 0.01;
    const half = () => R.draw([0, Y(lowY)]).lineTo([hw, Y(lowY)]).lineTo([hw, Y(y0)]).threePointsArcTo([0, Y(top)], [mid[0], Y(mid[1])]).close();
    let body = half().sketchOnPlane(plane(bd.b, nr)).revolve([0, 0, 1], { origin: [bd.b[0], bd.b[1], zf], angle: 180 });
    body = one(body.fuse(half().sketchOnPlane(plane(bd.a, nl)).revolve([0, 0, 1], { origin: [bd.a[0], bd.a[1], zf], angle: 180 })));
    if (q.L > 1e-6) {
      // (the plane's normal is nl × z = e: along the bead)
      const full = R.draw([-hw, Y(lowY)]).lineTo([hw, Y(lowY)]).lineTo([hw, Y(y0)]).threePointsArcTo([-hw, Y(y0)], [0, Y(top)]).close();
      body = one(body.fuse(full.sketchOnPlane(plane(bd.a, nl)).extrude(q.L)));
    }
    return body;
  };
  const outer = build(q.w / 2, 0, q.H, q.rho), inner = build(q.wi, -t, q.H - t, q.ri);
  return one(one(shape.fuse(outer)).cut(inner));
}

// Flat pattern: outline polygons (base ∪ developed flanges) and bend lines.
const polyArea = p => { let a = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; a += p[i][0] * q[1] - q[0] * p[i][1]; } return a / 2; };
const polyLen = p => { let l = 0; for (let i = 0; i < p.length; i++) { const q = p[(i + 1) % p.length]; l += Math.hypot(q[0] - p[i][0], q[1] - p[i][1]); } return l; };

/**
 * Flat pattern. holes = cut-outs in the plate. Returns { outline (outer loops counter-clockwise, holes clockwise),
 * bends, table, size, area (mm²), cutLength (mm, all loops: what a laser or a water jet travels), overlap (the
 * developed flanges lie on each other or on the plate: cannot be cut from one sheet) }.
 */
export function flatPattern(poly, f, holes = []) {
  const t = +f.thickness, r = +f.radius, k = +f.kfactor;
  f = splitAtFolds(poly, f);
  const edges = polyEdges(poly);
  const ends = flangeEnds(edges, f);
  const rects = [], bends = [], table = [], reliefs = [], flHoles = [];
  const firstBA = {}, arcs = polyArcs(poly), joins = flangeJoins(poly, f, arcs);
  let lapOk = 0;
  for (const fl of f.flanges || []) {
    if (!fl.on) continue;
    const ed = edges[fl.edge];
    if (!ed) continue;
    const gap = fl.relief ?? (r + t), en = endsOf(ends, fl), chain = flangeChain(fl);
    if (arcs.has(fl.edge)) {
      // a curved edge: rings around the centre of the arc, as wide as the developed bends and flanges. (An
      // approximation: in the press the rim is stretched or upset – see sheetChecks.)
      const jn = joins.get(fl.edge) || {}, a = arcs.get(fl.edge), sp = arcSpan(a, fl, gap, { a: jn.a || !!en.a, b: jn.b || !!en.b }), rho = d => (a.convex ? a.R + d : a.R - d);
      if (sp.len <= 0.1) continue;
      let d = 0;
      chain.forEach((b, level) => {
        const ba = bendAllowance(Math.abs(b.angle), r, t, k);
        table.push({ edge: fl.edge, level, angle: b.angle, radius: r, allowance: ba, length: sp.len, flange: b.h, centre: arcPts(a, sp.th0, sp.th1, rho(d + ba / 2)), curved: true });
        bends.push(arcPts(a, sp.th0, sp.th1, rho(d)), arcPts(a, sp.th0, sp.th1, rho(d + ba)));
        d += ba + b.h;
      });
      if (rho(d) < 0.5) throw new Error(`Kante ${fl.edge + 1}: der Bogen ist zu eng für diese Lasche`);
      // the rings start inside the plate, deeper than its chords lie inside the arc
      const dip = 2 * a.R * (1 - Math.cos(Math.abs(a.sweep) / a.m / 2)) + 0.03;
      lapOk += (sp.len + 1) * dip * 1.2;
      // (in pieces of at most half a turn, so every piece is a plain outline)
      const np = Math.max(1, Math.ceil(Math.abs(sp.th1 - sp.th0) / Math.PI - 1e-9));
      for (let q = 0; q < np; q++) {
        // (a hair over the end where the next piece or a joined flange follows, so the union merges them)
        const u0 = sp.th0 + ((sp.th1 - sp.th0) * q) / np - (!q && jn.a ? Math.sign(a.sweep) * 1e-4 : 0), u1 = sp.th0 + ((sp.th1 - sp.th0) * (q + 1)) / np + (q < np - 1 || a.full || jn.b ? Math.sign(a.sweep) * 1e-4 : 0);
        // a mitred end follows the plane of the corner: where the sheet, out by u in the folded part, meets it
        const mid = (en.a && !q) || (en.b && q === np - 1) ? chainMid(t, r, k, chain) : null;
        const sideOf = (end, th) => mid.map(([dd, u]) => { const an = mitreAngle(a, end, u, th), rr = rho(dd || -dip); return [a.c[0] + rr * Math.cos(an), a.c[1] + rr * Math.sin(an)]; });
        const sA = en.a && !q ? sideOf(en.a, u0) : null, sB = en.b && q === np - 1 ? sideOf(en.b, u1) : null;
        const angOf = p => Math.atan2(p[1] - a.c[1], p[0] - a.c[0]), nearTo = (x, ref) => ref + Math.atan2(Math.sin(x - ref), Math.cos(x - ref));
        const i0 = sA ? nearTo(angOf(sA[0]), u0) : u0, i1 = sB ? nearTo(angOf(sB[0]), u1) : u1, o0 = sA ? nearTo(angOf(sA[sA.length - 1]), u0) : u0, o1 = sB ? nearTo(angOf(sB[sB.length - 1]), u1) : u1;
        rects.push(ensureCCW([...arcPts(a, i0, i1, rho(-dip)), ...(sB ? sB.slice(1, -1) : []), ...arcPts(a, o1, o0, rho(d)), ...(sA ? sA.slice(1, -1).reverse() : [])]));
      }
      for (const q of flangeHoles(fl)) { const at = chainAt(t, r, k, chain, +q.lv || 0, +q.d || 0); if (at) flHoles.push(flatHole(arcEdge(a, +q.s || 0), at, q, 0)); }
      continue;
    }
    const [gA, gB] = flangeGaps(fl, en, gap, 0, joins.get(fl.edge));
    if (ed.L - gA - gB <= 0.1) continue;
    const A = [ed.a[0] + ed.e[0] * gA, ed.a[1] + ed.e[1] * gA], B = [ed.b[0] - ed.e[0] * gB, ed.b[1] - ed.e[1] * gB];
    const off = d => [[A[0] + ed.n[0] * d, A[1] + ed.n[1] * d], [B[0] + ed.n[0] * d, B[1] + ed.n[1] * d]];
    // developed along the edge normal: bend zone (allowance) + straight flange, bend after bend
    let d = 0;
    chain.forEach((b, level) => {
      const ba = bendAllowance(Math.abs(b.angle), r, t, k);
      if (!level) firstBA[fl.edge] = ba;
      table.push({ edge: fl.edge, level, angle: b.angle, radius: r, allowance: ba, length: ed.L - gA - gB, flange: b.h, centre: off(d + ba / 2) });
      bends.push(off(d), off(d + ba));
      d += ba + b.h;
    });
    // strip outline: a closed corner end follows the miter (how far past the corner the sheet runs at each
    // developed length), an open end is the straight relief cut
    const mid = chainMid(t, r, k, chain);
    // the strip starts a hair inside the plate, so the union merges them (edges that only touch may stay apart)
    const side = (end, P0) => end
      ? mid.map(([dd, u]) => { const s = endReach(end, ed.n, u), e = dd || -0.01; return [end.V[0] + end.out[0] * s + ed.n[0] * e, end.V[1] + end.out[1] * s + ed.n[1] * e]; })
      : [[P0[0] - ed.n[0] * 0.01, P0[1] - ed.n[1] * 0.01], [P0[0] + ed.n[0] * d, P0[1] + ed.n[1] * d]];
    const sa = side(en.a, A), sb = side(en.b, B);
    rects.push(ensureCCW([...sa.slice().reverse(), ...sb]));
    for (const q of flangeHoles(fl)) { const at = chainAt(t, r, k, chain, +q.lv || 0, +q.d || 0); if (at) flHoles.push(flatHole(ed, at, q)); }
  }
  // corner relief where the two bend zones of a closed corner cross (round / square, or none)
  for (const q of cornerReliefs(edges, ends, f, firstBA)) reliefs.push(q.poly);
  // union through Clipper (integer scale like cam.js)
  const L = window.ClipperLib, S = 1000;
  const toC = p => p.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
  const c = new L.Clipper();
  c.AddPaths([toC(ensureCCW(poly)), ...rects.map(toC)], L.PolyType.ptSubject, true);
  const out = new L.Paths();
  c.Execute(L.ClipType.ctUnion, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
  // the strips lie on each other or on the plate: the union is smaller than the pieces together (each strip
  // starts a hair inside the plate, which is allowed for)
  const pieces = Math.abs(polyArea(poly)) + rects.reduce((a, p) => a + Math.abs(polyArea(p)), 0);
  const joined = out.reduce((a, p) => a + L.Clipper.Area(p), 0) / (S * S);
  const overlap = pieces - joined > 0.5 + 0.02 * polyLen(poly) + lapOk;
  const collars = collarPlan(holes, f), pressed = pressPlan(holes, f), forms = [], slits = [];
  const circle = (c, rad) => Array.from({ length: 72 }, (_, i) => [c[0] + rad * Math.cos((i * Math.PI) / 36), c[1] + rad * Math.sin((i * Math.PI) / 36)]);
  for (const c of collars.values()) forms.push([...circle(c.c, c.Rb), circle(c.c, c.Rb)[0]]);
  for (const [i, p] of pressed) forms.push(p.kind === 'dimple' ? [...circle(p.c, p.Ro), circle(p.c, p.Ro)[0]] : [...holes[i], holes[i][0]]);
  (f.louvers || []).forEach((lv, i) => { const q = louverShape(t, lv, i); if (!q) return; const lp = louverLoop(q, lv); forms.push([...lp, lp[0]]); slits.push([lv.a, lv.b]); });
  (f.beads || []).forEach((bd, bi) => {
    const q = beadShape(t, bd, bi);
    if (!q) return;
    const e = q.L > 1e-6 ? [(bd.b[0] - bd.a[0]) / q.L, (bd.b[1] - bd.a[1]) / q.L] : [1, 0], a0 = Math.atan2(e[1], e[0]), lp = [];
    for (let i = 0; i <= 18; i++) { const an = a0 - Math.PI / 2 + (i * Math.PI) / 18; lp.push([bd.b[0] + (q.w / 2) * Math.cos(an), bd.b[1] + (q.w / 2) * Math.sin(an)]); }
    for (let i = 0; i <= 18; i++) { const an = a0 + Math.PI / 2 + (i * Math.PI) / 18; lp.push([bd.a[0] + (q.w / 2) * Math.cos(an), bd.a[1] + (q.w / 2) * Math.sin(an)]); }
    forms.push([...lp, lp[0]]);
  });
  const plan = foldPlan(poly, f);
  if (plan) {
    foldFlangeCheck(poly, f, plan);
    const loops = [ensureCCW(poly), ...holes.filter(p => p.length >= 3)];
    plan.folds.forEach((q, i) => {
      const at = d => lineSpans(loops, [q.o[0] + q.n[0] * d, q.o[1] + q.n[1] * d], q.e).map(([lo, hi]) => [[q.o[0] + q.n[0] * d + q.e[0] * lo, q.o[1] + q.n[1] * d + q.e[1] * lo], [q.o[0] + q.n[0] * d + q.e[0] * hi, q.o[1] + q.n[1] * d + q.e[1] * hi]]);
      const mid = at(0);
      if (!mid.length) return;
      bends.push(...at(-q.ba / 2), ...at(q.ba / 2));
      table.push({ edge: -1, line: i, level: 0, angle: q.angle, radius: r, allowance: q.ba, length: mid.reduce((a, sg) => a + Math.hypot(sg[1][0] - sg[0][0], sg[1][1] - sg[0][1]), 0), flange: 0, centre: [mid[0][0], mid[mid.length - 1][1]] });
    });
  }
  const cuts = [...reliefs, ...holes.map((p, i) => (collars.has(i) ? circle(collars.get(i).c, collars.get(i).flat) : pressed.get(i)?.kind === 'emboss' ? [] : p)).filter(p => p.length >= 3), ...flHoles];
  if (cuts.length) {
    const c2 = new L.Clipper(), cut = new L.Paths();
    c2.AddPaths(out, L.PolyType.ptSubject, true);
    c2.AddPaths(cuts.map(p => toC(ensureCCW(p))), L.PolyType.ptClip, true);
    c2.Execute(L.ClipType.ctDifference, cut, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
    out.length = 0; out.push(...cut);
  }
  const outline = out.map(p => p.map(q => [q.X / S, q.Y / S]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outline) for (const [x, y] of p) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { outline, bends, table, forms, slits, size: [maxX - minX, maxY - minY], area: outline.reduce((a, p) => a + polyArea(p), 0), cutLength: outline.reduce((a, p) => a + polyLen(p), 0) + slits.reduce((a, p) => a + Math.hypot(p[1][0] - p[0][0], p[1][1] - p[0][1]), 0), overlap };
}

// distance of a point from the segment a–b
const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy;
  const s = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return Math.hypot(p[0] - a[0] - dx * s, p[1] - a[1] - dy * s);
};

/**
 * Things a sheet metal shop would send back ("Hinweise"): { text, level: 'warn' | 'info' }[] for the part f on the
 * polygon poly with the cut-outs holes and its flat pattern fp.
 */
export function sheetChecks(poly, holes, f, fp) {
  const t = +f.thickness, r = +f.radius, k = +f.kfactor, out = [];
  try { const f2 = splitAtFolds(poly, f), cut = (f2.flanges || []).filter(q => q.split).length; if (cut) out.push({ level: 'info', text: 'Laschen, die über eine Biegelinie laufen, sind dort geteilt und freigestellt.' }); f = f2; } catch (err) { out.push({ level: 'warn', text: err.message }); }
  const n2 = v => String(Math.round(v * 100) / 100).replace('.', ',');
  if (!(t > 0)) return out;
  if (r < 0.5 * t - 1e-9) out.push({ level: 'warn', text: `Biegeradius ${n2(r)} mm ist kleiner als die halbe Blechdicke – das Blech kann an der Biegung reißen.` });
  if (k < 0.25 || k > 0.5) out.push({ level: 'info', text: `K-Faktor ${n2(k)} liegt außerhalb des üblichen Bereichs 0,25 … 0,5 – der Zuschnitt weicht dann meist vom gebogenen Teil ab.` });
  const edges = polyEdges(poly), ends = flangeEnds(edges, f);
  const arcs = polyArcs(poly), joins = flangeJoins(poly, f, arcs);
  // cut-outs of a flange that stands on the stretch gA … L − gB of its edge (round: all the way round)
  const holeChecks = (fl, gA, gB, L, round) => {
    for (const q of flangeHoles(fl)) {
      const lv = +q.lv || 0, b = flangeChain(fl)[lv], [bx0, bx1, by0, by1] = holeBox(q);
      if (!b) { out.push({ level: 'warn', text: `Kante ${fl.edge + 1}: ein Ausschnitt gehört zu einer Lasche, die es nicht gibt.` }); continue; }
      if (+q.d + by1 > b.h + 1e-9 || +q.d + by0 < -1e-9 || (!round && (+q.s + bx0 < gA - 1e-9 || +q.s + bx1 > L - gB + 1e-9))) out.push({ level: 'warn', text: `Kante ${fl.edge + 1}: ein Ausschnitt ragt über die Lasche hinaus.` });
      else if (+q.d + by0 < 2 * t - 1e-9) out.push({ level: 'warn', text: `Kante ${fl.edge + 1}: ein Ausschnitt in der Lasche liegt ${n2(+q.d + by0)} mm neben der Biegung (weniger als 2 × Blechdicke) – er verzieht sich beim Biegen.` });
    }
  };
  for (const fl of f.flanges || []) {
    const ed = edges[fl.edge];
    if (!fl.on || !ed) continue;
    if (arcs.has(fl.edge)) {
      const a = arcs.get(fl.edge), chain = flangeChain(fl), mid = chainMid(t, r, k, chain), [dev, uEnd] = mid[mid.length - 1];
      const sp = arcSpan(a, fl, fl.relief ?? (r + t), joins.get(fl.edge));
      if (sp.len <= 0.1) { out.push({ level: 'warn', text: `Kante ${fl.edge + 1}: die Abstände lassen keine Lasche übrig.` }); continue; }
      chain.forEach((b, level) => { if (b.h > 1e-6 && b.h < 2 * t - 1e-9) out.push({ level: 'warn', text: `Kante ${fl.edge + 1}${level ? '.' + (level + 1) : ''}: Lasche ${n2(b.h)} mm ist kürzer als 2 × Blechdicke – auf der Abkantpresse kaum zu biegen.` }); });
      // the rim: as long as in the blank it cannot stay
      const r0 = a.convex ? a.R + dev : a.R - dev, r1 = a.convex ? a.R + uEnd : a.R - uEnd, eps = r0 > 1e-6 ? (r1 / r0 - 1) * 100 : 0;
      if (eps < -0.05) out.push({ level: eps < -15 ? 'warn' : 'info', text: `Kante ${fl.edge + 1}: Lasche an einer gebogenen Kante – ihr Rand wird beim Umformen um ${n2(-eps)} % gestaucht (Faltengefahr); der Zuschnitt ist dort eine Näherung.` });
      else if (eps > 0.05) out.push({ level: eps > 15 ? 'warn' : 'info', text: `Kante ${fl.edge + 1}: Lasche an einer gebogenen Kante – ihr Rand wird beim Umformen um ${n2(eps)} % gestreckt (Rissgefahr); der Zuschnitt ist dort eine Näherung.` });
      holeChecks(fl, sp.gA, sp.gB, a.L, a.full);
      continue;
    }
    const gap = fl.relief ?? (r + t), [gA, gB] = flangeGaps(fl, endsOf(ends, fl), gap, 0, joins.get(fl.edge));
    if (ed.L - gA - gB <= 0.1) { out.push({ level: 'warn', text: `Kante ${fl.edge + 1}: die Abstände lassen keine Lasche übrig.` }); continue; }
    flangeChain(fl).forEach((b, level) => {
      if (b.h > 1e-6 && b.h < 2 * t - 1e-9) out.push({ level: 'warn', text: `Kante ${fl.edge + 1}${level ? '.' + (level + 1) : ''}: Lasche ${n2(b.h)} mm ist kürzer als 2 × Blechdicke – auf der Abkantpresse kaum zu biegen.` });
      if (Math.abs(b.angle) > 180) out.push({ level: 'warn', text: `Kante ${fl.edge + 1}: Biegewinkel über 180° ist nicht herstellbar.` });
    });
    // a cut-out next to the bend is pulled out of shape
    const A = [ed.a[0] + ed.e[0] * gA, ed.a[1] + ed.e[1] * gA], B = [ed.b[0] - ed.e[0] * gB, ed.b[1] - ed.e[1] * gB];
    let near = Infinity;
    for (const hp of holes) for (let i = 0; i < hp.length; i++) near = Math.min(near, segDist(hp[i], A, B), segDist(A, hp[i], hp[(i + 1) % hp.length]), segDist(B, hp[i], hp[(i + 1) % hp.length]));
    holeChecks(fl, gA, gB, ed.L, false);
    if (near < 2 * t + 1e-9) out.push({ level: 'warn', text: `Kante ${fl.edge + 1}: ein Ausschnitt liegt ${n2(near)} mm neben der Biegung (weniger als 2 × Blechdicke) – er verzieht sich beim Biegen.` });
  }
  // collars: how far the pilot hole is widened
  let collars = new Map();
  try { collars = collarPlan(holes, f); } catch (err) { out.push({ level: 'warn', text: err.message }); }
  for (const [i, c] of collars) {
    const ratio = c.R / c.flat;
    out.push(ratio > 2 ? { level: 'warn', text: `Durchzug ${i + 1}: Vorbohrung Ø ${n2(2 * c.flat)} mm wird auf Ø ${n2(2 * c.R)} mm aufgeweitet (Faktor ${n2(ratio)}) – der Rand reißt dabei meist ein.` }
      : { level: 'info', text: `Durchzug ${i + 1}: Vorbohrung Ø ${n2(2 * c.flat)} mm wird auf Ø ${n2(2 * c.R)} mm aufgeweitet (Faktor ${n2(ratio)}).` });
    let near = Infinity;
    for (let j = 0; j < poly.length; j++) near = Math.min(near, segDist(c.c, poly[j], poly[(j + 1) % poly.length]));
    if (near - c.Rb < 2 * t - 1e-9) out.push({ level: 'warn', text: `Durchzug ${i + 1}: liegt ${n2(Math.max(0, near - c.Rb))} mm neben dem Rand (weniger als 2 × Blechdicke) – der Rand beult aus.` });
  }
  for (const [i, p] of pressPlan(holes, f)) {
    if (p.kind === 'emboss' && Math.abs(p.h) > 3 * t + 1e-9) out.push({ level: 'warn', text: `Prägung ${i + 1}: ${n2(Math.abs(p.h))} mm ist höher als 3 × Blechdicke – mit senkrechter Wand reißt das Blech.` });
    if (p.kind === 'emboss' && !insetLoops(holes[i], t).length) out.push({ level: 'warn', text: `Prägung ${i + 1}: die Kontur ist schmaler als 2 × Blechdicke – es bleibt kein Hohlraum.` });
    if (p.kind === 'dimple' && Math.abs(p.h) > 2 * t + 1e-9) out.push({ level: 'warn', text: `Senkprägung ${i + 1}: ${n2(Math.abs(p.h))} mm ist tiefer als 2 × Blechdicke.` });
  }
  (f.louvers || []).forEach((lv, i) => {
    let q = null;
    try { q = louverShape(t, lv, i); } catch (err) { out.push({ level: 'warn', text: err.message }); }
    if (!q) return;
    let near = Infinity;
    for (const p of louverLoop(q, lv)) for (let j = 0; j < poly.length; j++) near = Math.min(near, segDist(p, poly[j], poly[(j + 1) % poly.length]));
    if (near < 2 * t - 1e-9) out.push({ level: 'warn', text: `Kieme ${i + 1}: liegt ${n2(near)} mm neben dem Rand (weniger als 2 × Blechdicke).` });
  });
  (f.beads || []).forEach((bd, i) => {
    let q = null;
    try { q = beadShape(t, bd, i); } catch (err) { out.push({ level: 'warn', text: err.message }); }
    if (!q) return;
    // stretched: the arc of the section against its chord
    const be = Math.asin(Math.min(1, q.w / 2 / q.rho)), eps = ((q.rho * 2 * be) / q.w - 1) * 100;
    if (eps > 20) out.push({ level: 'warn', text: `Sicke ${i + 1}: das Blech wird quer zur Sicke um ${n2(eps)} % gestreckt – flacher oder breiter prägen.` });
    let near = Infinity;
    for (let j = 0; j < poly.length; j++) near = Math.min(near, segDist(bd.a, poly[j], poly[(j + 1) % poly.length]), segDist(bd.b, poly[j], poly[(j + 1) % poly.length]));
    if (near - q.w / 2 < 2 * t - 1e-9) out.push({ level: 'warn', text: `Sicke ${i + 1}: liegt ${n2(Math.max(0, near - q.w / 2))} mm neben dem Rand (weniger als 2 × Blechdicke).` });
  });
  try {
    const plan = foldPlan(poly, f);
    if (plan) {
      foldFlangeCheck(poly, f, plan);
      plan.folds.forEach((q, i) => {
        let near = Infinity;
        for (const hp of holes) for (const p of hp) near = Math.min(near, Math.abs((p[0] - q.o[0]) * q.n[0] + (p[1] - q.o[1]) * q.n[1]) - q.ba / 2);
        if (near < 2 * t - 1e-9) out.push({ level: 'warn', text: `Biegelinie ${i + 1}: ein Ausschnitt liegt ${n2(Math.max(0, near))} mm neben der Biegung (weniger als 2 × Blechdicke) – er verzieht sich beim Biegen.` });
      });
    }
  } catch (err) { out.push({ level: 'warn', text: err.message }); }
  if (fp?.overlap) out.push({ level: 'warn', text: 'Die Abwicklung überlappt sich – so lässt sich das Teil nicht aus einem Blech schneiden. Laschen kürzen oder teilen.' });
  return out;
}

/**
 * Nesting ("Schachteln"): blanks on sheets of W × H with the distance gap between them and to the border. Each
 * part = { id, outline (loops), qty }. Two plans are made and the better one is taken: the blanks by their
 * bounding boxes in rows (the tallest first, turned by 90° where that fits better), and – with tight – the blanks
 * laid into each other (nestTight). Returns { sheets, placed: [{ id, sheet, loops }] (loops in the
 * coordinates of their sheet, origin at its lower left corner), left: [ids that fit on no sheet], used (share
 * of the sheet area covered by parts, over all sheets) }.
 */
export function nestParts(parts, W, H, gap = 5, rotate = true, tight = true) {
  const rows = nestRows(parts, W, H, gap, rotate);
  if (!tight) return rows;
  let tg = null;
  try { tg = nestTight(parts, W, H, gap, rotate); } catch { /* the rows stay */ }
  if (!tg || !tg.placed.length) return rows;
  if (tg.left.length !== rows.left.length) return tg.left.length < rows.left.length ? tg : rows;
  if (tg.sheets !== rows.sheets) return tg.sheets < rows.sheets ? tg : rows;
  // the same number of sheets: the plan that leaves the larger whole strip of the last sheet
  const rest = n => {
    let mx = 0, my = 0;
    for (const p of n.placed) if (p.sheet === n.sheets - 1) for (const l of p.loops) for (const [x, y] of l) { mx = Math.max(mx, x); my = Math.max(my, y); }
    return Math.max(W * (H - my), H * (W - mx));
  };
  return rest(tg) > rest(rows) * 1.02 ? tg : rows;
}

/**
 * True nesting: the blanks are laid into each other – into the gaps and bays of their neighbours and into their
 * cut-outs. Every blank, grown by half the distance, becomes a bitmap (in up to four positions, turned by 90°);
 * the bitmaps are pushed onto the sheet from the left, the largest first, each where it comes to lie furthest
 * left. The grid only finds the place: the outlines stay exact, and the distance is never less than gap.
 */
function nestTight(parts, W, H, gap, rotate) {
  const L = window.ClipperLib, S = 1000;
  const kinds = parts.filter(p => p.outline?.length);
  const cells = Math.max(60000, 400000 / Math.max(1, kinds.length / 6));
  const cell = Math.max(0.2, Math.sqrt(((W - gap) * (H - gap)) / cells)), e = 0.71 * cell, D = gap / 2 + e;
  const spanX = W - gap + 2 * e, spanY = H - gap + 2 * e;
  if (!(spanX > cell) || !(spanY > cell)) return null;
  const nx = Math.ceil(spanX / cell) + 2, ny = Math.ceil(spanY / cell) + 2, sw = Math.ceil(nx / 32) + 2;
  const turn = (k, [x, y]) => (k === 0 ? [x, y] : k === 1 ? [-y, x] : k === 2 ? [-x, -y] : [y, -x]);
  // the bitmap of a blank in position k: rows of 32-bit words, a cell is set where its centre lies in the grown blank
  const mask = (outline, k) => {
    const c = new L.Clipper(), un = new L.Paths();
    c.AddPaths(outline.map(l => l.map(p => { const q = turn(k, p); return { X: Math.round(q[0] * S), Y: Math.round(q[1] * S) }; })), L.PolyType.ptSubject, true);
    c.Execute(L.ClipType.ctUnion, un, L.PolyFillType.pftEvenOdd, L.PolyFillType.pftEvenOdd);
    const co = new L.ClipperOffset(2, 0.02 * S), grown = new L.Paths();
    co.AddPaths(un, L.JoinType.jtRound, L.EndType.etClosedPolygon);
    co.Execute(grown, (D + 0.03) * S); // (a little more than needed: the round corners are polygons)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const loops = grown.map(p => p.map(q => { const x = q.X / S, y = q.Y / S; x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); return [x, y]; }));
    if (!(x1 > x0)) return null;
    const w = Math.max(1, Math.round((x1 - x0) / cell)), h = Math.max(1, Math.round((y1 - y0) / cell)), mw = Math.ceil(w / 32);
    const rows = [];
    for (let j = 0; j < h; j++) {
      const y = y0 + (j + 0.5) * cell, xs = [], row = new Uint32Array(mw);
      for (const l of loops) for (let i = 0; i < l.length; i++) {
        const p = l[i], q = l[(i + 1) % l.length];
        if ((p[1] > y) !== (q[1] > y)) xs.push(p[0] + ((y - p[1]) * (q[0] - p[0])) / (q[1] - p[1]));
      }
      xs.sort((p, q) => p - q);
      for (let i = 0; i + 1 < xs.length; i += 2) {
        const i0 = Math.max(0, Math.ceil((xs[i] - x0) / cell - 0.5)), i1 = Math.min(w - 1, Math.floor((xs[i + 1] - x0) / cell - 0.5));
        for (let q = i0; q <= i1; q++) row[q >> 5] |= 1 << (q & 31);
      }
      rows.push(row);
    }
    // how far the blank may be pushed (in cells) so that it stays the distance away from the border
    return { rows, w, h, mw, x0, y0, maxX: Math.floor((spanX - (x1 - x0)) / cell + 1e-9), maxY: Math.floor((spanY - (y1 - y0)) / cell + 1e-9) };
  };
  const items = [], left = [];
  for (const p of kinds) {
    let bx0 = Infinity, by0 = Infinity, bx1 = -Infinity, by1 = -Infinity;
    for (const l of p.outline) for (const [x, y] of l) { bx0 = Math.min(bx0, x); by0 = Math.min(by0, y); bx1 = Math.max(bx1, x); by1 = Math.max(by1, y); }
    if (!(bx1 > bx0)) continue;
    const ms = (rotate ? [0, 1, 2, 3] : [0, 2]).map(k => ({ k, m: mask(p.outline, k) })).filter(q => q.m && q.m.maxX >= 0 && q.m.maxY >= 0);
    const area = Math.abs(p.outline.reduce((a, l) => a + polyArea(l), 0)), qty = Math.max(1, Math.round(+p.qty || 1));
    for (let i = 0; i < qty; i++) { if (ms.length) items.push({ p, ms, area, box: (bx1 - bx0) * (by1 - by0) }); else left.push(p.id); }
  }
  items.sort((a, b) => b.box - a.box || b.area - a.area);
  const sheets = [], placed = [];
  const hit = (g, m, ix, iy) => {
    const wi = ix >> 5, sh = ix & 31;
    for (let j = 0; j < m.h; j++) {
      const srow = g[iy + j], row = m.rows[j];
      for (let q = 0; q < m.mw; q++) {
        const v = row[q];
        if (!v) continue;
        if (sh ? (srow[wi + q] & (v << sh)) || (srow[wi + q + 1] & (v >>> (32 - sh))) : srow[wi + q] & v) return true;
      }
    }
    return false;
  };
  let area = 0;
  for (const it of items) {
    let done = false;
    for (let si = 0; si <= sheets.length && !done; si++) {
      const sh = sheets[si] || { g: Array.from({ length: ny }, () => new Uint32Array(sw)), from: new Map(), fresh: true };
      let best = null;
      for (const { k, m } of it.ms) {
        // (what did not fit for an equal blank before does not fit now: go on from there)
        const key = it.p.id + '/' + k, span = m.maxY + 1;
        let at = sh.from.get(key) || 0, found = -1;
        for (const end = (m.maxX + 1) * span; at < end; at++) if (!hit(sh.g, m, (at / span) | 0, at % span)) { found = at; break; }
        sh.from.set(key, at);
        if (found < 0) continue;
        const ix = (found / span) | 0, iy = found % span;
        if (!best || ix + m.w < best.ix + best.m.w || (ix + m.w === best.ix + best.m.w && (iy < best.iy || (iy === best.iy && ix < best.ix)))) best = { k, m, ix, iy };
      }
      if (!best) continue;
      if (sh.fresh) { sh.fresh = false; sheets.push(sh); }
      const { m, ix, iy, k } = best, wi = ix >> 5, s5 = ix & 31;
      for (let j = 0; j < m.h; j++) for (let q = 0; q < m.mw; q++) {
        const v = m.rows[j][q];
        if (!v) continue;
        sh.g[iy + j][wi + q] |= v << s5;
        if (s5) sh.g[iy + j][wi + q + 1] |= v >>> (32 - s5);
      }
      const tx = gap / 2 - e + ix * cell - m.x0, ty = gap / 2 - e + iy * cell - m.y0;
      placed.push({ id: it.p.id, sheet: si, loops: it.p.outline.map(l => l.map(p => { const q = turn(k, p); return [q[0] + tx, q[1] + ty]; })), rot: k % 2 === 1, turn: k * 90 });
      area += it.area;
      done = true;
    }
    if (!done) left.push(it.p.id);
  }
  return { sheets: sheets.length, placed, left, used: sheets.length ? area / (sheets.length * W * H) : 0, tight: true };
}

function nestRows(parts, W, H, gap = 5, rotate = true) {
  const items = [];
  for (const p of parts) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const l of p.outline) for (const [x, y] of l) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    if (!(x1 > x0)) continue;
    const area = p.outline.reduce((a, l) => a + polyArea(l), 0);
    for (let i = 0; i < Math.max(1, Math.round(+p.qty || 1)); i++) items.push({ id: p.id, outline: p.outline, x0, y0, w: x1 - x0, h: y1 - y0, area: Math.abs(area) });
  }
  const left = [], placed = [];
  // lying flat (the short side up) fills rows best; a part that only fits upright stays upright
  for (const it of items) {
    const fits = (w, h) => w <= W - 2 * gap + 1e-9 && h <= H - 2 * gap + 1e-9;
    const a = fits(it.w, it.h), b = rotate && fits(it.h, it.w);
    if (!a && !b) { left.push(it.id); it.skip = true; continue; }
    it.rot = b && (!a || it.w < it.h);
    it.bw = it.rot ? it.h : it.w; it.bh = it.rot ? it.w : it.h;
  }
  const todo = items.filter(it => !it.skip).sort((p, q) => q.bh - p.bh || q.bw - p.bw);
  const sheets = []; // each: rows [{ y, h, x }]
  for (const it of todo) {
    let done = false;
    for (let si = 0; si <= sheets.length && !done; si++) {
      const sh = sheets[si] || (sheets[si] = { rows: [], top: gap });
      for (const r of sh.rows) if (it.bh <= r.h + 1e-9 && r.x + it.bw <= W - gap + 1e-9) { it.sheet = si; it.px = r.x; it.py = r.y; r.x += it.bw + gap; done = true; break; }
      if (!done && sh.top + it.bh <= H - gap + 1e-9) { sh.rows.push({ y: sh.top, h: it.bh, x: gap + it.bw + gap }); it.sheet = si; it.px = gap; it.py = sh.top; sh.top += it.bh + gap; done = true; }
    }
  }
  let area = 0;
  for (const it of todo) {
    // turned by 90° counter-clockwise: (x, y) → (-y, x); then the box's corner onto its place
    const loops = it.outline.map(l => l.map(([x, y]) => (it.rot ? [it.px + (it.y0 + it.h - y), it.py + (x - it.x0)] : [it.px + (x - it.x0), it.py + (y - it.y0)])));
    placed.push({ id: it.id, sheet: it.sheet, loops, rot: !!it.rot });
    area += it.area;
  }
  return { sheets: sheets.length, placed, left, used: sheets.length ? area / (sheets.length * W * H) : 0 };
}

/**
 * Cutting program for one sheet of a nesting plan: loops = the outlines of the blanks on that sheet (outer loops and
 * holes, any direction), in sheet coordinates. The path runs beside the outline by half the kerf (or half the cutter)
 * on the waste side, holes before the outline of their part, the nearest part next; every contour starts with a
 * lead-in from the waste, in the middle of its longest straight stretch. opts: { mode: 'laser' | 'plasma' |
 * 'waterjet' | 'mill', kerf, feed, lead, pierce (s), power, thickness, name; mill: rpm, plunge, step (depth per
 * pass), safeZ, through (how far below the sheet) }. Returns { text, length (mm cut), pierces, minutes, paths
 * [{ pts (closed), lead: [x, y], hole }] }.
 */
export function cutProgram(loops, opts = {}) {
  const L = window.ClipperLib, S = 1000;
  const mode = opts.mode || 'laser', mill = mode === 'mill', kerf = Math.max(0, +opts.kerf || 0), feed = Math.max(1, +opts.feed || 1000), lead0 = Math.max(0, +(opts.lead ?? 2) || 0);
  const t = Math.max(0, +opts.thickness || 0), pierce = Math.max(0, +opts.pierce || 0);
  // the parts: every outer loop with the holes inside it
  const toC = p => p.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
  const un = new L.Clipper(), tree = new L.PolyTree();
  un.AddPaths(loops.filter(p => p.length >= 3).map(toC), L.PolyType.ptSubject, true);
  un.Execute(L.ClipType.ctUnion, tree, L.PolyFillType.pftEvenOdd, L.PolyFillType.pftEvenOdd);
  const parts = [];
  const walk = node => { for (const ch of node.Childs()) { if (!ch.IsHole()) parts.push([ch.Contour(), ...ch.Childs().map(h => h.Contour())]); walk(ch); } };
  walk(tree);
  const fromC = p => p.map(q => [q.X / S, q.Y / S]);
  const jobs = parts.map(pp => {
    const co = new L.ClipperOffset(2, 0.01 * S), out = new L.Paths();
    co.AddPaths(pp, L.JoinType.jtRound, L.EndType.etClosedPolygon);
    co.Execute(out, (kerf / 2) * S);
    const paths = out.filter(p => p.length >= 3).map(p => ({ pts: fromC(p), hole: !L.Clipper.Orientation(p), area: Math.abs(L.Clipper.Area(p)) / (S * S) }));
    // waste on the right of the way round: outlines counter-clockwise, holes clockwise
    for (const q of paths) { let a = 0; for (let i = 0; i < q.pts.length; i++) { const n = q.pts[(i + 1) % q.pts.length]; a += q.pts[i][0] * n[1] - n[0] * q.pts[i][1]; } if ((a > 0) === q.hole) q.pts.reverse(); }
    const c = pp[0].reduce((m, q) => [m[0] + q.X / S / pp[0].length, m[1] + q.Y / S / pp[0].length], [0, 0]);
    return { c, paths: [...paths.filter(q => q.hole), ...paths.filter(q => !q.hole)] };
  });
  // start in the middle of the longest stretch, lead-in from the waste side
  for (const j of jobs) for (const q of j.paths) {
    let bi = 0, bl = -1;
    for (let i = 0; i < q.pts.length; i++) { const n = q.pts[(i + 1) % q.pts.length], l = Math.hypot(n[0] - q.pts[i][0], n[1] - q.pts[i][1]); if (l > bl) { bl = l; bi = i; } }
    const a = q.pts[bi], b = q.pts[(bi + 1) % q.pts.length], mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], e = [(b[0] - a[0]) / (bl || 1), (b[1] - a[1]) / (bl || 1)];
    const ld = q.hole ? Math.min(lead0, 0.35 * Math.sqrt(q.area)) : lead0;
    q.pts = [mid, ...q.pts.slice(bi + 1), ...q.pts.slice(0, bi + 1)];
    q.lead = [mid[0] + e[1] * ld, mid[1] - e[0] * ld];
  }
  // the nearest part next
  const order = [];
  let pos = [0, 0];
  const rest = jobs.slice();
  while (rest.length) {
    let k = 0, bd = Infinity;
    rest.forEach((j, i) => { const d = Math.hypot(j.c[0] - pos[0], j.c[1] - pos[1]); if (d < bd) { bd = d; k = i; } });
    const j = rest.splice(k, 1)[0];
    order.push(...j.paths);
    if (j.paths.length) pos = j.paths[j.paths.length - 1].pts[0];
  }
  const n3 = v => (Math.round(v * 1000) / 1000).toFixed(3).replace(/\.?0+$/, '') || '0';
  const names = { laser: 'Laser', plasma: 'Plasma', waterjet: 'Wasserstrahl', mill: 'Fraesen' };
  const out = [`(${String(opts.name || 'Schachtelplan').replace(/[()]/g, ' ')})`, `(Verfahren: ${names[mode] || mode}, ${mill ? 'Werkzeug' : 'Schnittfuge'} ${n3(kerf)} mm, Vorschub ${n3(feed)} mm/min, Blech ${n3(t)} mm)`,
    '(ACHTUNG: Programm vor dem Einsatz an der Maschine oder in einem NC-Simulator pruefen)', 'G21 G90 G17'];
  let length = 0, pierces = 0, rapid = 0, last = [0, 0];
  const safeZ = Math.max(1, +opts.safeZ || 5), zEnd = -(t + Math.max(0, +(opts.through ?? 0.3) || 0)), step = Math.max(0.05, +opts.step || t || 1), plunge = Math.max(1, +opts.plunge || feed / 3);
  if (mill) out.push(`G0 Z${n3(safeZ)}`, `M3 S${Math.round(+opts.rpm || 12000)}`);
  for (const q of order) {
    const loopLen = q.pts.reduce((a, p, i) => { const n = q.pts[(i + 1) % q.pts.length]; return a + Math.hypot(n[0] - p[0], n[1] - p[1]); }, 0), ll = Math.hypot(q.pts[0][0] - q.lead[0], q.pts[0][1] - q.lead[1]);
    rapid += Math.hypot(q.lead[0] - last[0], q.lead[1] - last[1]);
    out.push(`G0 X${n3(q.lead[0])} Y${n3(q.lead[1])}`);
    const round = f => { out.push(`G1 X${n3(q.pts[0][0])} Y${n3(q.pts[0][1])} F${n3(f)}`); for (let i = 1; i < q.pts.length; i++) out.push(`G1 X${n3(q.pts[i][0])} Y${n3(q.pts[i][1])}`); out.push(`G1 X${n3(q.pts[0][0])} Y${n3(q.pts[0][1])}`); };
    if (mill) {
      const levels = [];
      for (let z = -step; z > zEnd + 1e-6; z -= step) levels.push(z);
      levels.push(zEnd);
      levels.forEach((z, i) => { if (i) out.push(`G1 X${n3(q.lead[0])} Y${n3(q.lead[1])}`); out.push(`G1 Z${n3(z)} F${n3(plunge)}`); round(feed); length += loopLen + ll * 2; });
      out.push(`G0 Z${n3(safeZ)}`);
    } else {
      out.push(mode === 'laser' ? `M3 S${Math.round(+opts.power || 1000)}` : 'M3');
      if (pierce > 0) out.push(`G4 P${n3(pierce)}`);
      round(feed);
      out.push('M5');
      length += loopLen + ll;
    }
    pierces++;
    last = q.pts[0];
  }
  if (mill) out.push('M5');
  out.push('G0 X0 Y0', 'M30');
  return { text: out.join('\n') + '\n', length, pierces, minutes: length / feed + (pierces * pierce) / 60 + rapid / 10000, paths: order };
}
