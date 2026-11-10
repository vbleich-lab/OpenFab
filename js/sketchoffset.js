// Sketch offset ("Versatz"): parallel copies of sketch entities. Circles and plain rectangles stay what they
// are, everything else becomes a polyline next to its outline – closed outlines grow or shrink, open ones move
// to the left or right of their direction.
import { entityOutlines } from './profiles.js';

const area2 = pts => pts.reduce((a, p, i) => { const q = pts[(i + 1) % pts.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0);
const inPoly = (p, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < a[0] + ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1])) c = !c;
  }
  return c;
};

// Parallel polyline at distance d to the left of the direction of travel (d < 0: to the right). Corners are
// mitred; very sharp ones are cut off so the offset does not shoot far out.
export function offsetPolyline(pts, closed, d) {
  const P = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9);
  if (closed && P.length > 1 && Math.hypot(P[0][0] - P[P.length - 1][0], P[0][1] - P[P.length - 1][1]) < 1e-9) P.pop();
  const n = P.length;
  if (n < 2) return [];
  const segN = i => { const a = P[i], b = P[(i + 1) % n], L = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; return [-(b[1] - a[1]) / L, (b[0] - a[0]) / L]; };
  const out = [];
  for (let i = 0; i < n; i++) {
    const hasPrev = closed || i > 0, hasNext = closed || i < n - 1;
    const na = hasPrev ? segN((i - 1 + n) % n) : null, nb = hasNext ? segN(i) : null;
    if (!na || !nb) { const m = na || nb; out.push([P[i][0] + m[0] * d, P[i][1] + m[1] * d]); continue; }
    const k = 1 + na[0] * nb[0] + na[1] * nb[1];
    if (k < 0.2) { out.push([P[i][0] + na[0] * d, P[i][1] + na[1] * d], [P[i][0] + nb[0] * d, P[i][1] + nb[1] * d]); continue; }
    out.push([P[i][0] + ((na[0] + nb[0]) * d) / k, P[i][1] + ((na[1] + nb[1]) * d) / k]);
  }
  return out;
}

// The offset curves of one entity. dist > 0: outwards for closed outlines, to the left for open ones.
export function offsetCurves(e, dist) {
  const out = [];
  for (const o of entityOutlines(e)) {
    if (o.pts.length < 2) continue;
    if (o.closed) {
      // outward = to the right of a counter-clockwise outline
      const ccw = area2(o.pts) > 0;
      let pts = null;
      const CL = globalThis.ClipperLib;
      if (CL) {
        // Clipper cleans up what collapses when an outline shrinks
        const S = 1000, co = new CL.ClipperOffset(2, 0.25 * S), res = new CL.Paths();
        co.AddPath(o.pts.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })), CL.JoinType.jtMiter, CL.EndType.etClosedPolygon);
        co.Execute(res, dist * S);
        for (const path of res) { const q = CL.Clipper.CleanPolygon(path, 0.002 * S).map(p => [p.X / S, p.Y / S]); if (q.length > 2) out.push({ pts: q, closed: true }); }
        continue;
      }
      pts = offsetPolyline(o.pts, true, ccw ? -dist : dist);
      // shrunk away: the offset has turned inside out
      if (pts.length > 2 && Math.sign(area2(pts)) === Math.sign(area2(o.pts))) out.push({ pts, closed: true });
    } else {
      const pts = offsetPolyline(o.pts, false, dist);
      if (pts.length > 1) out.push({ pts, closed: false });
    }
  }
  return out;
}

// Which way the offset goes for a point next to the entity: +1 / -1 as offsetCurves wants it.
export function offsetSide(e, p) {
  let best = null, bd = Infinity, closed = false;
  for (const o of entityOutlines(e)) {
    const n = o.pts.length;
    for (let i = 0; i + 1 < n + (o.closed ? 1 : 0); i++) {
      const a = o.pts[i], b = o.pts[(i + 1) % n], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      const u = L2 > 1e-18 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0;
      const d = Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
      if (d < bd) { bd = d; best = { cross: dx * (p[1] - a[1]) - dy * (p[0] - a[0]), o }; closed = o.closed; }
    }
  }
  if (!best) return { sign: 1, d: Infinity };
  if (closed) return { sign: inPoly(p, best.o.pts) ? -1 : 1, d: bd };
  return { sign: best.cross >= 0 ? 1 : -1, d: bd };
}

// The entity whose outline is closest to p (within tol), with the side p lies on.
export function offsetHit(entities, p, tol) {
  let hit = null;
  for (const e of entities) {
    if (e.type === 'text') continue;
    const s = offsetSide(e, p);
    if (s.d <= tol && (!hit || s.d < hit.d)) hit = { e, sign: s.sign, d: s.d };
  }
  return hit;
}

// New entities for the offset of e (ids from newId()): a circle stays a circle, a plain rectangle a rectangle.
export function offsetEntities(e, dist, newId) {
  const r4 = v => +(+v).toFixed(4);
  if (e.type === 'circle') return +e.r + dist > 1e-6 ? [{ id: newId(), type: 'circle', cx: e.cx, cy: e.cy, r: r4(+e.r + dist) }] : [];
  if (e.type === 'rect' && !+e.rot && !e.radii && !e.chamfers) {
    const w = +e.w + 2 * dist, h = +e.h + 2 * dist;
    if (!(w > 1e-6 && h > 1e-6)) return [];
    const r = Math.max(0, (+e.r || 0) + (+e.r > 0 || dist > 0 ? dist : 0));
    return [{ id: newId(), type: 'rect', x: r4(+e.x - dist), y: r4(+e.y - dist), w: r4(w), h: r4(h), ...(+e.r > 0 && r > 0 ? { r: r4(Math.min(r, w / 2, h / 2)) } : {}) }];
  }
  return offsetCurves(e, dist).map(c => ({ id: newId(), type: 'poly', closed: c.closed, pts: c.pts.map(q => [r4(q[0]), r4(q[1])]) }));
}
