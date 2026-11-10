// Sheet metal: a base plate from a closed polygon plus flanges bent up on chosen
// edges (inner bend radius r, thickness t, K-factor), and the flat pattern.
import { ensureCCW } from './profiles.js';

const DEG = Math.PI / 180;

export function bendAllowance(angleDeg, r, t, k) {
  return angleDeg * DEG * (r + k * t);
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

// Corners between flanges ("Ecke"): with f.corner === 'closed' a flange whose neighbour on a convex corner
// is bent as well runs on to the angle bisector of the corner, leaving the gap f.cornerGap between the two.
// Per flange end: null (open: shortened by the relief) or { V, m, g, out } - V the corner, m the unit normal of
// the bisector pointing away from this flange, out the edge direction beyond V.
export function flangeEnds(edges, f) {
  const on = new Set((f.flanges || []).filter(q => q.on).map(q => q.edge));
  const closed = f.corner === 'closed', g = Math.max(0, +(f.cornerGap ?? 0.2));
  const n = edges.length;
  const corner = (i, j) => {
    // edge i ends where edge j starts; convex for a CCW polygon when e_i x e_j > 0
    const ei = edges[i].e, ej = edges[j].e;
    if (!closed || !on.has(i) || !on.has(j) || ei[0] * ej[1] - ei[1] * ej[0] < 1e-6) return null;
    const w0 = [edges[i].n[0] + edges[j].n[0], edges[i].n[1] + edges[j].n[1]], wl = Math.hypot(...w0), w = [w0[0] / wl, w0[1] / wl];
    return { V: edges[i].b, w };
  };
  return edges.map((ed, i) => {
    const prev = (i - 1 + n) % n, next = (i + 1) % n;
    const mk = (c, nOther, out) => {
      if (!c) return null;
      const dn = nOther[0] * c.w[0] + nOther[1] * c.w[1];
      let m = [nOther[0] - dn * c.w[0], nOther[1] - dn * c.w[1]];
      const ml = Math.hypot(...m); m = [m[0] / ml, m[1] / ml];
      return { V: c.V, m, g, out };
    };
    return {
      a: mk(corner(prev, i), edges[prev].n, [-ed.e[0], -ed.e[1]]),
      b: mk(corner(i, next), edges[next].n, ed.e),
    };
  });
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

export function sheetSolid(R, poly, z0, f) {
  const t = +f.thickness, r = +f.radius, k = +f.kfactor;
  if (!(t > 0)) throw new Error('Blechdicke fehlt');
  const edges = polyEdges(poly);
  const ends = flangeEnds(edges, f);
  const firstBA = {}, firstAng = {};
  for (const fl of f.flanges || []) if (fl.on && edges[fl.edge]) { firstAng[fl.edge] = flangeChain(fl)[0].angle; firstBA[fl.edge] = bendAllowance(Math.abs(firstAng[fl.edge]), r, t, k); }
  const reliefs = cornerReliefs(edges, ends, f, firstBA);
  let shape = polyDrawing(R, ensureCCW(poly)).sketchOnPlane('XY', z0).extrude(t);
  for (const fl of f.flanges || []) {
    if (!fl.on) continue;
    const ed = edges[fl.edge];
    if (!ed) continue;
    const gap = fl.relief ?? (r + t);
    const sec = chainSection(t, r, flangeChain(fl));
    const en = ends[fl.edge];
    // a closed corner: run past the corner by the full width of the section, the miter cut trims it back
    const over = Math.max(...sec.map(p => Math.abs(p[0]))) + t + 1;
    const gA = en.a ? -over : gap, gB = en.b ? -over : gap;
    const len = ed.L - gA - gB;
    if (len <= 0.1) throw new Error(`Kante ${fl.edge + 1} ist zu kurz für eine Lasche`);
    // plane: x = outward normal, y = +Z, normal = n × Z = -e (extrusion runs back along the edge)
    const origin = [ed.b[0] - ed.e[0] * gB, ed.b[1] - ed.e[1] * gB, z0];
    const pl = new R.Plane(origin, [ed.n[0], ed.n[1], 0], [-ed.e[0], -ed.e[1], 0]);
    let solid = polyDrawing(R, sec).sketchOnPlane(pl).extrude(len);
    for (const end of [en.a, en.b]) {
      if (!end) continue;
      // half space beyond the bisector (shifted by half the gap towards this flange), as a tall prism
      const BIG = 10 * (over + ed.L), w = [-end.m[1], end.m[0]];
      const o = [end.V[0] - end.m[0] * end.g / 2, end.V[1] - end.m[1] * end.g / 2];
      const quad = [[o[0] - w[0] * BIG, o[1] - w[1] * BIG], [o[0] + w[0] * BIG, o[1] + w[1] * BIG],
        [o[0] + w[0] * BIG + end.m[0] * BIG, o[1] + w[1] * BIG + end.m[1] * BIG], [o[0] - w[0] * BIG + end.m[0] * BIG, o[1] - w[1] * BIG + end.m[1] * BIG]];
      solid = solid.cut(polyDrawing(R, ensureCCW(quad)).sketchOnPlane('XY', z0 - BIG).extrude(2 * BIG));
    }
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
    shape = shape.fuse(solid);
  }
  return shape;
}

// Flat pattern: outline polygons (base ∪ developed flanges) and bend lines.
export function flatPattern(poly, f) {
  const t = +f.thickness, r = +f.radius, k = +f.kfactor;
  const edges = polyEdges(poly);
  const ends = flangeEnds(edges, f);
  const rects = [], bends = [], table = [], reliefs = [];
  const firstBA = {};
  for (const fl of f.flanges || []) {
    if (!fl.on) continue;
    const ed = edges[fl.edge];
    if (!ed) continue;
    const gap = fl.relief ?? (r + t), en = ends[fl.edge], chain = flangeChain(fl);
    const gA = en.a ? 0 : gap, gB = en.b ? 0 : gap;
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
  if (reliefs.length) {
    const c2 = new L.Clipper(), cut = new L.Paths();
    c2.AddPaths(out, L.PolyType.ptSubject, true);
    c2.AddPaths(reliefs.map(p => toC(ensureCCW(p))), L.PolyType.ptClip, true);
    c2.Execute(L.ClipType.ctDifference, cut, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
    out.length = 0; out.push(...cut);
  }
  const outline = out.map(p => p.map(q => [q.X / S, q.Y / S]));
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of outline) for (const [x, y] of p) { minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y); }
  return { outline, bends, table, size: [maxX - minX, maxY - minY] };
}
