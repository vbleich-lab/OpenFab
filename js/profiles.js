// 2D sketch geometry: entities -> polygons, profile nesting, hit testing.
import { textPolys } from './fonts.js';
import { cornerPts, hasCorners } from './sketchcorner.js';

const TAU = Math.PI * 2;

export function signedArea(p) {
  let a = 0;
  for (let i = 0, n = p.length; i < n; i++) {
    const [x1, y1] = p[i];
    const [x2, y2] = p[(i + 1) % n];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export const ensureCCW = p => (signedArea(p) < 0 ? p.slice().reverse() : p);

function circlePts(cx, cy, r) {
  const n = Math.min(256, Math.max(48, Math.ceil(TAU * r / 0.4)));
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU;
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}

export function entityPoly(e) {
  switch (e.type) {
    case 'rect': {
      const x0 = e.x, y0 = e.y, x1 = e.x + e.w, y1 = e.y + e.h;
      if (e.w <= 0 || e.h <= 0) return null;
      const r = Math.min(e.r || 0, e.w / 2 - 1e-4, e.h / 2 - 1e-4);
      if (r <= 0) return [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
      const pts = [];
      const n = Math.max(4, Math.min(64, Math.ceil((Math.PI / 2) * r / 0.4)));
      const arc = (cx, cy, a0) => {
        for (let i = 0; i <= n; i++) {
          const a = a0 + (i / n) * (Math.PI / 2);
          pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
        }
      };
      arc(x1 - r, y0 + r, -Math.PI / 2);
      arc(x1 - r, y1 - r, 0);
      arc(x0 + r, y1 - r, Math.PI / 2);
      arc(x0 + r, y0 + r, Math.PI);
      return pts;
    }
    case 'circle':
      return e.r > 0 ? circlePts(e.cx, e.cy, e.r) : null;
    case 'ngon': {
      if (!(e.r > 0) || e.n < 3) return null;
      const pts = [];
      const rot = ((e.rot || 0) * Math.PI) / 180 + Math.PI / 2;
      for (let i = 0; i < e.n; i++) {
        const a = rot + (i * TAU) / e.n;
        pts.push([e.cx + e.r * Math.cos(a), e.cy + e.r * Math.sin(a)]);
      }
      return pts;
    }
    case 'poly':
      return e.closed && e.pts.length >= 3 ? ensureCCW(curvePts(e)) : null;
    case 'ellipse': {
      if (!(e.rx > 0) || !(e.ry > 0)) return null;
      const n = Math.min(256, Math.max(48, Math.ceil(TAU * Math.max(e.rx, e.ry) / 0.4)));
      const a = ((e.rot || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const pts = [];
      for (let i = 0; i < n; i++) {
        const t = (i / n) * TAU, x = e.rx * Math.cos(t), y = e.ry * Math.sin(t);
        pts.push([e.cx + x * ca - y * sa, e.cy + x * sa + y * ca]);
      }
      return pts;
    }
    case 'slot': {
      if (!(e.w > 0) || !(e.len >= 0)) return null;
      const r = e.w / 2, a = ((e.rot || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
      const n = Math.max(12, Math.min(96, Math.ceil(Math.PI * r / 0.4)));
      const pts = [];
      const half = (cx, a0) => { for (let i = 0; i <= n; i++) { const t = a0 + (i / n) * Math.PI; pts.push([cx + r * Math.cos(t), r * Math.sin(t)]); } };
      half(e.len / 2, -Math.PI / 2);
      half(-e.len / 2, Math.PI / 2);
      return pts.map(([x, y]) => [e.cx + x * ca - y * sa, e.cy + x * sa + y * ca]);
    }
  }
  return null;
}

// All closed polygons of an entity (text yields one per glyph contour).
export function entityPolys(e) {
  if (e.type === 'text') return textPolys(e);
  const p = entityPoly(e);
  return p ? [p] : [];
}

export function entityOutlines(e) {
  if (e.type === 'text') return textPolys(e).map(pts => ({ pts, closed: true }));
  const o = entityOutline(e);
  return o ? [o] : [];
}

// Polyline with sketch fillets (e.radii) and chamfers (e.chamfers): see sketchcorner.js.
// The stored vertex stays the (virtual) sharp corner, like Fusion.
export const filletedPts = e => cornerPts(e);

// Circle through three points (null when they are collinear).
export function circle3(a, b, c) {
  const d = 2 * (a[0] * (b[1] - c[1]) + b[0] * (c[1] - a[1]) + c[0] * (a[1] - b[1]));
  if (Math.abs(d) < 1e-9) return null;
  const A = a[0] ** 2 + a[1] ** 2, B = b[0] ** 2 + b[1] ** 2, C = c[0] ** 2 + c[1] ** 2;
  const cx = (A * (b[1] - c[1]) + B * (c[1] - a[1]) + C * (a[1] - b[1])) / d;
  const cy = (A * (c[0] - b[0]) + B * (a[0] - c[0]) + C * (b[0] - a[0])) / d;
  return { cx, cy, r: Math.hypot(a[0] - cx, a[1] - cy) };
}

// 3-point arc: start, point on the arc, end (like Fusion's "3-Punkt-Bogen").
export function arcPts(a, m, b) {
  const c = circle3(a, m, b);
  if (!c) return [a, b];
  const ang = p => Math.atan2(p[1] - c.cy, p[0] - c.cx);
  const a0 = ang(a), am = ang(m), a1 = ang(b);
  const norm = x => ((x % TAU) + TAU) % TAU;
  // sweep direction that passes the middle point
  let sweep = norm(a1 - a0);
  if (norm(am - a0) > sweep) sweep -= TAU;
  const n = Math.max(8, Math.min(256, Math.ceil((Math.abs(sweep) * c.r) / 0.4)));
  const out = [];
  for (let i = 0; i <= n; i++) { const t = a0 + (sweep * i) / n; out.push([c.cx + c.r * Math.cos(t), c.cy + c.r * Math.sin(t)]); }
  out[0] = [+a[0], +a[1]];
  out[n] = [+b[0], +b[1]];
  return out;
}

// Smooth curve through the points (centripetal Catmull-Rom), like a fit-point spline.
export function splinePts(pts, closed) {
  const P = pts.map(p => [+p[0], +p[1]]);
  const n = P.length;
  if (n < 3) return P;
  const get = i => (closed ? P[((i % n) + n) % n] : P[Math.max(0, Math.min(n - 1, i))]);
  const out = [];
  const segs = closed ? n : n - 1;
  for (let i = 0; i < segs; i++) {
    const p0 = get(i - 1), p1 = get(i), p2 = get(i + 1), p3 = get(i + 2);
    const d = (u, v) => Math.max(1e-6, Math.sqrt(Math.hypot(v[0] - u[0], v[1] - u[1])));
    const t0 = 0, t1 = t0 + d(p0, p1), t2 = t1 + d(p1, p2), t3 = t2 + d(p2, p3);
    const m = Math.max(6, Math.min(64, Math.ceil(Math.hypot(p2[0] - p1[0], p2[1] - p1[1]) / 0.5)));
    for (let k = 0; k < m; k++) {
      const t = t1 + ((t2 - t1) * k) / m;
      const L = (a, b, ta, tb) => [0, 1].map(j => ((tb - t) / (tb - ta)) * a[j] + ((t - ta) / (tb - ta)) * b[j]);
      const A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3);
      const B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
      out.push(L(B1, B2, t1, t2));
    }
  }
  if (!closed) out.push(P[n - 1]);
  return out;
}

// Polyline geometry including arcs, splines and sketch fillets.
export function curvePts(e) {
  if (e.curve === 'arc' && e.pts.length === 3) return arcPts(e.pts[0], e.pts[1], e.pts[2]);
  if (e.curve === 'spline') return splinePts(e.pts, !!e.closed);
  return hasCorners(e) ? cornerPts(e) : e.pts.map(p => [+p[0], +p[1]]);
}

// Open lines, arcs and splines whose ends meet form closed profiles (like Fusion).
// Returns [{ id: 'chain:a+b+c', ids, poly }].
export function chainLoops(entities, tol = 0.01) {
  const curves = entities
    .filter(e => e.type === 'poly' && !e.closed && e.pts.length >= 2)
    .map(e => ({ id: e.id, pts: curvePts(e) }));
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < tol;
  const used = new Set();
  const loops = [];
  for (const start of curves) {
    if (used.has(start.id)) continue;
    const chain = [start];
    let pts = start.pts.slice();
    const taken = new Set([start.id]);
    let closed = near(pts[0], pts[pts.length - 1]) && pts.length > 2;
    while (!closed) {
      const end = pts[pts.length - 1];
      const nxt = curves.find(c => !taken.has(c.id) && !used.has(c.id) && (near(c.pts[0], end) || near(c.pts[c.pts.length - 1], end)));
      if (!nxt) break;
      const seg = near(nxt.pts[0], end) ? nxt.pts : nxt.pts.slice().reverse();
      pts = pts.concat(seg.slice(1));
      chain.push(nxt);
      taken.add(nxt.id);
      closed = near(pts[0], pts[pts.length - 1]);
    }
    if (closed && pts.length >= 4) {
      pts.pop();
      if (Math.abs(signedArea(pts)) > 1e-6) {
        chain.forEach(c => used.add(c.id));
        const ids = chain.map(c => c.id);
        loops.push({ id: 'chain:' + ids.join('+'), ids, poly: ensureCCW(pts) });
      }
    }
  }
  return loops;
}

// Copies of sketch entities moved or rotated (sketch patterns, mirror helpers).
export function translateEntity(e, dx, dy) {
  const c = JSON.parse(JSON.stringify(e));
  if (c.type === 'poly') c.pts = e.pts.map(([x, y]) => [+x + dx, +y + dy]);
  else if (c.type === 'rect' || c.type === 'text') { c.x = +e.x + dx; c.y = +e.y + dy; }
  else { c.cx = +e.cx + dx; c.cy = +e.cy + dy; }
  return c;
}

// Mirror image of an entity about the line through a and b (without id; null for kinds that cannot be mirrored).
// A mirrored polyline runs the other way round, so its corner numbers (fillets, chamfers) are turned too;
// a rectangle becomes a closed polyline.
export function mirrorEntity(e, a, b) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, ux = (b[0] - a[0]) / len, uy = (b[1] - a[1]) / len;
  const M = ([x, y]) => { const t = (x - a[0]) * ux + (y - a[1]) * uy, px = a[0] + t * ux, py = a[1] + t * uy; return [+(2 * px - x).toFixed(4), +(2 * py - y).toFixed(4)]; };
  const axDeg = (Math.atan2(uy, ux) * 180) / Math.PI;
  const { id: _id, ...c } = JSON.parse(JSON.stringify(e));
  if (e.type === 'poly') {
    const rev = (o, f = v => v) => (o ? Object.fromEntries(Object.entries(o).map(([k, v]) => [e.pts.length - 1 - +k, f(v)])) : undefined);
    return { ...c, pts: e.pts.map(p => M(p.map(Number))).reverse(), radii: rev(e.radii), chamfers: rev(e.chamfers, v => (Array.isArray(v) ? [v[1], v[0]] : v)) };
  }
  if (e.type === 'circle') { const [cx, cy] = M([+e.cx, +e.cy]); return { type: 'circle', cx, cy, r: e.r, ...(e.cons ? { cons: true } : {}) }; }
  if (e.type === 'rect') return { type: 'poly', closed: true, pts: [[+e.x, +e.y], [+e.x + +e.w, +e.y], [+e.x + +e.w, +e.y + +e.h], [+e.x, +e.y + +e.h]].map(M).reverse(), ...(e.cons ? { cons: true } : {}) };
  if (e.type === 'ngon' || e.type === 'slot' || e.type === 'ellipse') { const [cx, cy] = M([+e.cx, +e.cy]); return { ...c, cx, cy, rot: +(2 * axDeg - (+e.rot || 0)).toFixed(4) }; }
  return null;
}

export function rotateEntity(e, deg, [ox, oy] = [0, 0]) {
  const a = (deg * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const R = ([x, y]) => [ox + (x - ox) * ca - (y - oy) * sa, oy + (x - ox) * sa + (y - oy) * ca];
  const c = JSON.parse(JSON.stringify(e));
  if (e.type === 'rect') {
    // a rotated rectangle is no longer axis-aligned: becomes a closed polyline
    const r = +e.r || 0;
    const corners = [[+e.x, +e.y], [+e.x + +e.w, +e.y], [+e.x + +e.w, +e.y + +e.h], [+e.x, +e.y + +e.h]].map(R);
    return { id: e.id, type: 'poly', closed: true, pts: corners, ...(r > 0 ? { radii: { 0: r, 1: r, 2: r, 3: r } } : {}) };
  }
  if (e.type === 'poly') c.pts = e.pts.map(p => R([+p[0], +p[1]]));
  else if (e.type === 'text') { [c.x, c.y] = R([+e.x, +e.y]); c.rot = (+e.rot || 0) + deg; }
  else {
    [c.cx, c.cy] = R([+e.cx, +e.cy]);
    if (e.type === 'ngon' || e.type === 'slot' || e.type === 'ellipse') c.rot = (+e.rot || 0) + deg;
  }
  return c;
}

export function entityOutline(e) {
  if (e.type === 'poly') return { pts: curvePts(e), closed: !!e.closed };
  const p = entityPoly(e);
  return p && { pts: p, closed: true };
}

export function keyPoints(e) {
  switch (e.type) {
    case 'rect':
      return [[e.x, e.y], [e.x + e.w, e.y], [e.x + e.w, e.y + e.h], [e.x, e.y + e.h], [e.x + e.w / 2, e.y + e.h / 2]];
    case 'circle':
      return [[e.cx, e.cy], [e.cx + e.r, e.cy], [e.cx - e.r, e.cy], [e.cx, e.cy + e.r], [e.cx, e.cy - e.r]];
    case 'ngon':
      return [[e.cx, e.cy], ...(entityPoly(e) || [])];
    case 'poly':
      return e.pts;
    case 'text':
      return [[+e.x, +e.y]];
    case 'ellipse':
      return [[e.cx, e.cy]];
    case 'slot': {
      const a = ((e.rot || 0) * Math.PI) / 180, dx = (Math.cos(a) * e.len) / 2, dy = (Math.sin(a) * e.len) / 2;
      return [[e.cx, e.cy], [e.cx + dx, e.cy + dy], [e.cx - dx, e.cy - dy]];
    }
  }
  return [];
}

export function pointInPoly([x, y], poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function distToEntity(e, p) {
  let d = Infinity;
  for (const o of entityOutlines(e)) {
    const n = o.pts.length;
    if (n < 2) continue;
    const m = o.closed ? n : n - 1;
    for (let i = 0; i < m; i++) d = Math.min(d, segDist(p, o.pts[i], o.pts[(i + 1) % n]));
  }
  return d;
}

// Nest closed profiles: even depth = outer boundary, odd depth = hole of its parent.
export function buildRegions(items) {
  const s = items
    .map(it => ({ ...it, area: Math.abs(signedArea(it.poly)), parent: null, depth: 0 }))
    .sort((a, b) => b.area - a.area);
  for (let i = 0; i < s.length; i++) {
    for (let j = i - 1; j >= 0; j--) {
      if (s[j].area > s[i].area && pointInPoly(s[i].poly[0], s[j].poly)) {
        s[i].parent = s[j];
        s[i].depth = s[j].depth + 1;
        break;
      }
    }
  }
  const regions = [];
  for (const it of s) {
    if (it.depth % 2 === 0) {
      it.region = { outer: it.poly, holes: [], id: it.id, holeIds: [] };
      regions.push(it.region);
    }
  }
  for (const it of s) {
    if (it.depth % 2 === 1) {
      it.parent.region.holes.push(it.poly);
      it.parent.region.holeIds.push(it.id);
    }
  }
  return { regions, items: s };
}

const f1 = v => +(+v).toFixed(2);

export function describeEntity(e) {
  switch (e.type) {
    case 'rect': return `Rechteck ${f1(e.w)}×${f1(e.h)}`;
    case 'circle': return `Kreis Ø${f1(e.r * 2)}`;
    case 'ngon': return `${e.n}-Eck R${f1(e.r)}`;
    case 'poly': return e.curve === 'arc' ? 'Bogen' : e.curve === 'spline' ? `Spline${e.closed ? ' (geschlossen)' : ''} (${e.pts.length} Pkt.)` : `${e.closed ? 'Kontur' : e.pts.length === 2 ? 'Linie' : 'Linienzug'} (${e.pts.length} Pkt.)`;
    case 'text': return `Text „${e.text}“`;
    case 'slot': return `Langloch ${f1(e.len + e.w)}×${f1(e.w)}`;
    case 'ellipse': return `Ellipse ${f1(e.rx * 2)}×${f1(e.ry * 2)}`;
  }
  return e.type;
}
