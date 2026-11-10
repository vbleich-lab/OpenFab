// Sketch "Stutzen" (trim) and "Verlängern" (extend), like Fusion.
// Lines, polylines, rectangles, polygons, arcs and circles are cut at their intersections with all other
// sketch geometry; other curves (splines, ellipses, text) act as cutting edges only.
import { circle3, entityOutlines, entityPoly } from './profiles.js';

const TAU = Math.PI * 2;
const EPS = 1e-7;
const norm = a => ((a % TAU) + TAU) % TAU;

// ---------- primitives: { k: 'seg', a, b } or { k: 'arc', cx, cy, r, a0, sw } (sw signed sweep) ----------
function arcOf(p0, pm, p1) {
  const c = circle3(p0, pm, p1);
  if (!c) return null;
  const ang = p => Math.atan2(p[1] - c.cy, p[0] - c.cx);
  const a0 = ang(p0);
  let sw = norm(ang(p1) - a0);
  if (norm(ang(pm) - a0) > sw) sw -= TAU;
  return { k: 'arc', cx: c.cx, cy: c.cy, r: c.r, a0, sw };
}
const isPlainPoly = e => e.type === 'poly' && !e.curve && !e.radii && !e.chamfers;
const isArc = e => e.type === 'poly' && e.curve === 'arc' && e.pts.length === 3;

// trimmable entities as primitives; `poly` = the polyline they become (rect/ngon → closed polyline)
function trimShape(e) {
  if (isPlainPoly(e)) return { pts: e.pts.map(p => [+p[0], +p[1]]), closed: !!e.closed };
  if (e.type === 'rect' && !(+e.r > 0)) return { pts: entityPoly(e), closed: true };
  if (e.type === 'ngon') return { pts: entityPoly(e), closed: true };
  return null;
}
function primitives(e) {
  const s = trimShape(e);
  if (s) {
    const out = [];
    const n = s.pts.length;
    for (let i = 0; i < (s.closed ? n : n - 1); i++) out.push({ k: 'seg', a: s.pts[i], b: s.pts[(i + 1) % n], seg: i });
    return out;
  }
  if (isArc(e)) { const a = arcOf(...e.pts); return a ? [a] : []; }
  if (e.type === 'circle') return [{ k: 'arc', cx: +e.cx, cy: +e.cy, r: +e.r, a0: 0, sw: TAU, full: true }];
  // everything else: its outline as segments (cutting edges only)
  const out = [];
  for (const o of entityOutlines(e)) {
    const p = o.pts;
    for (let i = 0; i < (o.closed ? p.length : p.length - 1); i++) out.push({ k: 'seg', a: p[i], b: p[(i + 1) % p.length] });
  }
  return out;
}

// parameter of an angle on an arc (0…1 inside, NaN outside)
function arcParam(A, ang) {
  if (A.full) return norm(ang - A.a0) / TAU;
  const d = A.sw >= 0 ? norm(ang - A.a0) : norm(A.a0 - ang);
  const s = d / Math.abs(A.sw);
  return s <= 1 + 1e-9 ? Math.min(1, s) : NaN;
}
const arcPoint = (A, s) => { const t = A.a0 + A.sw * s; return [A.cx + A.r * Math.cos(t), A.cy + A.r * Math.sin(t)]; };
const segPoint = (S, t) => [S.a[0] + (S.b[0] - S.a[0]) * t, S.a[1] + (S.b[1] - S.a[1]) * t];

// intersections of primitive P with primitive Q → parameters on P; `lineP`: P's segment counts as an endless line
function intersect(P, Q, lineP = false) {
  const out = [];
  if (P.k === 'seg' && Q.k === 'seg') {
    const r = [P.b[0] - P.a[0], P.b[1] - P.a[1]], s = [Q.b[0] - Q.a[0], Q.b[1] - Q.a[1]];
    const den = r[0] * s[1] - r[1] * s[0];
    if (Math.abs(den) < 1e-12) return out;
    const qp = [Q.a[0] - P.a[0], Q.a[1] - P.a[1]];
    const t = (qp[0] * s[1] - qp[1] * s[0]) / den, u = (qp[0] * r[1] - qp[1] * r[0]) / den;
    if (u >= -EPS && u <= 1 + EPS && (lineP || (t >= -EPS && t <= 1 + EPS))) out.push(t);
    return out;
  }
  if (P.k === 'seg' && Q.k === 'arc') {
    const d = [P.b[0] - P.a[0], P.b[1] - P.a[1]], f = [P.a[0] - Q.cx, P.a[1] - Q.cy];
    const a = d[0] * d[0] + d[1] * d[1], b = 2 * (f[0] * d[0] + f[1] * d[1]), c = f[0] * f[0] + f[1] * f[1] - Q.r * Q.r;
    const disc = b * b - 4 * a * c;
    if (a < 1e-18 || disc < 0) return out;
    for (const t of [(-b - Math.sqrt(disc)) / (2 * a), (-b + Math.sqrt(disc)) / (2 * a)]) {
      if (!lineP && (t < -EPS || t > 1 + EPS)) continue;
      const p = segPoint(P, t);
      if (Number.isFinite(arcParam(Q, Math.atan2(p[1] - Q.cy, p[0] - Q.cx)))) out.push(t);
    }
    return out;
  }
  if (P.k === 'arc' && Q.k === 'seg') {
    for (const t of intersect(Q, P)) {
      const p = segPoint(Q, t);
      const s = arcParam(P, Math.atan2(p[1] - P.cy, p[0] - P.cx));
      if (Number.isFinite(s)) out.push(s);
    }
    return out;
  }
  // arc – arc
  const dx = Q.cx - P.cx, dy = Q.cy - P.cy, d = Math.hypot(dx, dy);
  if (d < 1e-12 || d > P.r + Q.r + EPS || d < Math.abs(P.r - Q.r) - EPS) return out;
  const a = (P.r * P.r - Q.r * Q.r + d * d) / (2 * d), hh = Math.sqrt(Math.max(0, P.r * P.r - a * a));
  const mx = P.cx + (a * dx) / d, my = P.cy + (a * dy) / d;
  for (const sg of hh < 1e-12 ? [0] : [-1, 1]) {
    const p = [mx - (sg * hh * dy) / d, my + (sg * hh * dx) / d];
    const sQ = arcParam(Q, Math.atan2(p[1] - Q.cy, p[0] - Q.cx));
    const sP = arcParam(P, Math.atan2(p[1] - P.cy, p[0] - P.cx));
    if (Number.isFinite(sQ) && Number.isFinite(sP)) out.push(sP);
  }
  return out;
}

function distTo(P, p) {
  if (P.k === 'seg') {
    const dx = P.b[0] - P.a[0], dy = P.b[1] - P.a[1], l2 = dx * dx + dy * dy;
    const t = l2 ? Math.max(0, Math.min(1, ((p[0] - P.a[0]) * dx + (p[1] - P.a[1]) * dy) / l2)) : 0;
    return { d: Math.hypot(p[0] - P.a[0] - t * dx, p[1] - P.a[1] - t * dy), t };
  }
  const ang = Math.atan2(p[1] - P.cy, p[0] - P.cx), s = arcParam(P, ang);
  const radial = Math.abs(Math.hypot(p[0] - P.cx, p[1] - P.cy) - P.r);
  if (Number.isFinite(s)) return { d: radial, t: s };
  const e0 = arcPoint(P, 0), e1 = arcPoint(P, 1);
  const d0 = Math.hypot(p[0] - e0[0], p[1] - e0[1]), d1 = Math.hypot(p[0] - e1[0], p[1] - e1[1]);
  return d0 < d1 ? { d: d0, t: 0 } : { d: d1, t: 1 };
}

// nearest trimmable primitive to point p
function nearest(entities, p, tol) {
  let best = null;
  for (const e of entities) {
    if (e.type === 'text') continue;
    for (const P of primitives(e)) {
      const { d, t } = distTo(P, p);
      if (d <= tol && (!best || d < best.d)) best = { e, P, d, t };
    }
  }
  return best;
}

// cut parameters on primitive P of entity e from every other piece of geometry
function cutParams(entities, e, P) {
  const ts = [];
  for (const o of entities) {
    for (const Q of primitives(o)) {
      if (o === e && Q === P) continue;
      if (o === e && P.k === 'seg' && Q.k === 'seg') {
        // own neighbouring segments meet at shared corners: those are no cuts
        for (const t of intersect(P, Q)) if (t > EPS && t < 1 - EPS) ts.push(t);
        continue;
      }
      ts.push(...intersect(P, Q));
    }
  }
  return ts;
}

const arcEntity = (A, s0, s1, base) => ({ ...base, type: 'poly', curve: 'arc', closed: false, pts: [arcPoint(A, s0), arcPoint(A, (s0 + s1) / 2), arcPoint(A, s1)] });
const lineEntity = (pts, base) => ({ ...base, type: 'poly', closed: false, pts });

/**
 * Trim at point p. → { remove: [entity id], add: [new entities without id], piece: [[x,y]…] } or null.
 * `piece` is the removed part (for the red preview).
 */
export function trimAt(entities, p, tol) {
  const hit = nearest(entities, p, tol);
  if (!hit) return null;
  const { e, P, t } = hit;
  const base = { ...(e.cons ? { cons: true } : {}) };
  if (!trimShape(e) && !isArc(e) && e.type !== 'circle') return { unsupported: true, e };
  const all = cutParams(entities, e, P);
  const raw = all.filter(x => x > EPS && x < 1 - EPS);
  if (P.full) {
    // circle: remove the arc between the two cut angles around the click (every angle counts, 0 too)
    const cuts = [...new Set(all.map(x => +(((x % 1) + 1) % 1).toFixed(9)))].sort((a, b) => a - b);
    if (cuts.length < 2) return { remove: [e.id], add: [], piece: sample(P, 0, 1) };
    let s1 = cuts.find(x => x > t), s0 = [...cuts].reverse().find(x => x < t);
    if (s1 == null) s1 = cuts[0] + 1;
    if (s0 == null) s0 = cuts[cuts.length - 1] - 1;
    // keep from s1 around to s0 + 1
    const keep = { ...P, a0: P.a0 + TAU * s1, sw: TAU * (1 - (s1 - s0)), full: false };
    return { remove: [e.id], add: [arcEntity(keep, 0, 1, base)], piece: sample(P, s0, s1) };
  }
  const below = raw.filter(x => x < t), above = raw.filter(x => x > t);
  const t0 = below.length ? Math.max(...below) : 0, t1 = above.length ? Math.min(...above) : 1;
  if (P.k === 'arc') {
    // the kept pieces keep their outer end points (constraints on them survive)
    const add = [];
    if (t0 > EPS) add.push({ ...arcEntity(P, 0, t0, base), map: { p: { 0: 0 } } });
    if (t1 < 1 - EPS) add.push({ ...arcEntity(P, t1, 1, base), map: { p: { 2: 2 } } });
    return { remove: [e.id], add, piece: sample(P, t0, t1) };
  }
  // segment of a polyline: cut out [t0, t1] of segment k
  const s = trimShape(e), k = P.seg, n = s.pts.length;
  const A = segPoint(P, t0), B = segPoint(P, t1);
  // map: old point index → new point index, old segment → new segment (constraints and dimensions move over;
  // rectangles use the same corner/edge numbering p0…p3 / l0…l3 as polylines). Polygons keep no constraints.
  const mapOk = e.type === 'poly' || e.type === 'rect';
  const off = t1 < 1 - EPS ? 1 : 0;
  let chains;
  if (s.closed) {
    // unroll so that the trimmed segment is the gap between the end and the start
    const seq = [];
    for (let i = 1; i <= n; i++) seq.push(s.pts[(k + i) % n]);
    const c = [...(off ? [B] : []), ...seq, ...(t0 > EPS ? [A] : [])];
    const pm = {}, lm = {};
    for (let i = 0; i < n; i++) { const pos = (((i - k - 1) % n) + n) % n + off; pm[i] = pos; if (i !== k) lm[i] = pos; }
    chains = [{ c, map: mapOk ? { p: pm, l: lm } : null }];
  } else {
    const p1 = {}, l1 = {}, p2 = {}, l2 = {};
    for (let i = 0; i <= k; i++) { p1[i] = i; if (i < k) l1[i] = i; }
    for (let i = k + 1; i < n; i++) { p2[i] = i - k - 1 + off; if (i < n - 1) l2[i] = i - k - 1 + off; }
    chains = [
      { c: [...s.pts.slice(0, k + 1), ...(t0 > EPS ? [A] : [])], map: mapOk ? { p: p1, l: l1 } : null },
      { c: [...(off ? [B] : []), ...s.pts.slice(k + 1)], map: mapOk ? { p: p2, l: l2 } : null },
    ];
  }
  const add = chains.filter(ch => ch.c.length >= 2).map(ch => ({ ...lineEntity(ch.c, base), ...(ch.map ? { map: ch.map } : {}) }));
  return { remove: [e.id], add, piece: [A, B] };
}

function sample(A, s0, s1) {
  const n = Math.max(8, Math.ceil(Math.abs(A.sw * (s1 - s0)) * 16));
  const out = [];
  for (let i = 0; i <= n; i++) out.push(arcPoint(A, s0 + ((s1 - s0) * i) / n));
  return out;
}

/**
 * Extend the open end of a line or arc nearest to p up to the next geometry.
 * → { id, pts: new points of that entity, from, to } or null.
 */
export function extendAt(entities, p, tol) {
  const hit = nearest(entities, p, tol);
  if (!hit) return null;
  const { e, P } = hit;
  if (isArc(e)) {
    // grow the arc around its circle to the next cut
    const full = { ...P, sw: Math.sign(P.sw || 1) * TAU, full: false };
    const atEnd = hit.t > 0.5;
    const cuts = [];
    for (const o of entities) for (const Q of primitives(o)) if (o !== e) cuts.push(...intersect(full, Q));
    const L = Math.abs(P.sw) / TAU;
    if (atEnd) {
      const next = cuts.filter(s => s > L + 1e-6).sort((a, b) => a - b)[0];
      if (next == null || next >= 1) return null;
      const B = { ...P, sw: P.sw / L * next };
      return { id: e.id, pts: [arcPoint(B, 0), arcPoint(B, 0.5), arcPoint(B, 1)], from: arcPoint(P, 1), to: arcPoint(B, 1) };
    }
    const rev = { ...P, a0: P.a0 + P.sw, sw: -Math.sign(P.sw) * TAU, full: false };
    const cr = [];
    for (const o of entities) for (const Q of primitives(o)) if (o !== e) cr.push(...intersect(rev, Q));
    const next = cr.filter(s => s > L + 1e-6).sort((a, b) => a - b)[0];
    if (next == null || next >= 1) return null;
    const B = { ...rev, sw: rev.sw * next };
    return { id: e.id, pts: [arcPoint(B, 1), arcPoint(B, 0.5), arcPoint(B, 0)], from: arcPoint(P, 0), to: arcPoint(B, 1) };
  }
  if (!isPlainPoly(e) || e.closed) return null;
  const pts = e.pts.map(q => [+q[0], +q[1]]);
  const n = pts.length;
  // which end: the one nearer to the click
  const atEnd = Math.hypot(p[0] - pts[n - 1][0], p[1] - pts[n - 1][1]) < Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]);
  const S = atEnd ? { k: 'seg', a: pts[n - 2], b: pts[n - 1] } : { k: 'seg', a: pts[1], b: pts[0] };
  let best = Infinity;
  for (const o of entities) for (const Q of primitives(o)) {
    if (o === e) continue;
    for (const t of intersect(S, Q, true)) if (t > 1 + 1e-6 && t < best) best = t;
  }
  if (!Number.isFinite(best)) return null;
  const to = segPoint(S, best);
  const out = pts.slice();
  if (atEnd) out[n - 1] = to; else out[0] = to;
  return { id: e.id, pts: out, from: atEnd ? pts[n - 1] : pts[0], to };
}

/**
 * Constraints of trimmed entities on their remaining pieces: refs "id:pK" / "id:lK" of a removed entity are moved
 * to the piece that kept that point or edge (newIds[i] = id given to r.add[i]); constraints that lose a ref are dropped.
 */
export function remapConstraints(constraints, r, newIds) {
  const gone = new Set(r.remove);
  const remap = ref => {
    const [eid, k] = String(ref).split(':');
    if (!gone.has(eid)) return ref;
    if (!k) return null;
    const kind = k[0], idx = +k.slice(1);
    for (let i = 0; i < r.add.length; i++) {
      const m = r.add[i].map?.[kind];
      if (m && m[idx] != null) return `${newIds[i]}:${kind}${m[idx]}`;
    }
    return null;
  };
  return (constraints || []).flatMap(c => {
    if (!c.refs.some(x => gone.has(String(x).split(':')[0]))) return [c];
    const refs = c.refs.map(remap);
    return refs.every(Boolean) ? [{ ...c, refs }] : [];
  });
}
