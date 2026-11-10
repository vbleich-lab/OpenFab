// Geometry of the extra sketch drawing methods (variants of rectangle, circle and arc).
import { circle3 } from './profiles.js';

const TAU = Math.PI * 2;
const r4 = v => Math.round(v * 1e4) / 1e4;

// rectangle from its centre and one corner → rect entity fields
export function centerRect(c, corner) {
  const hw = Math.abs(corner[0] - c[0]), hh = Math.abs(corner[1] - c[1]);
  return { x: r4(c[0] - hw), y: r4(c[1] - hh), w: r4(2 * hw), h: r4(2 * hh) };
}

// rotated rectangle: first edge a→b, the third point sets the width (perpendicular to a→b) → 4 corners
export function rect3(a, b, p) {
  const ux = b[0] - a[0], uy = b[1] - a[1], L = Math.hypot(ux, uy);
  if (L < 1e-9) return null;
  const nx = -uy / L, ny = ux / L;
  const h = (p[0] - b[0]) * nx + (p[1] - b[1]) * ny;
  if (Math.abs(h) < 1e-9) return null;
  return [a, b, [b[0] + nx * h, b[1] + ny * h], [a[0] + nx * h, a[1] + ny * h]].map(q => [r4(q[0]), r4(q[1])]);
}

// circle through two opposite points (the diameter)
export function circle2(a, b) {
  const r = Math.hypot(b[0] - a[0], b[1] - a[1]) / 2;
  return r > 1e-9 ? { cx: r4((a[0] + b[0]) / 2), cy: r4((a[1] + b[1]) / 2), r: r4(r) } : null;
}

// circle through three points
export function circleThrough(a, b, c) {
  const k = circle3(a, b, c);
  return k && k.r > 1e-9 ? { cx: r4(k.cx), cy: r4(k.cy), r: r4(k.r) } : null;
}

// arc around a centre from the start point to the direction of the end point (the shorter way round)
// → [start, point on the arc, end] as stored for 3-point arcs
export function centerArc(c, s, e) {
  const r = Math.hypot(s[0] - c[0], s[1] - c[1]);
  if (r < 1e-9) return null;
  const a0 = Math.atan2(s[1] - c[1], s[0] - c[0]), a1 = Math.atan2(e[1] - c[1], e[0] - c[0]);
  let sw = a1 - a0;
  while (sw > Math.PI) sw -= TAU;
  while (sw <= -Math.PI) sw += TAU;
  if (Math.abs(sw) < 1e-6) return null;
  const P = t => [r4(c[0] + r * Math.cos(t)), r4(c[1] + r * Math.sin(t))];
  return [[r4(s[0]), r4(s[1])], P(a0 + sw / 2), P(a0 + sw)];
}

// tangent direction leaving an open line / arc at one of its end points (ref "id:pK") → { p, T } or null
export function endTangent(entities, ref) {
  const [id, k] = String(ref || '').split(':');
  const e = entities.find(x => x.id === id);
  if (!e || e.type !== 'poly' || e.closed || !k || k[0] !== 'p') return null;
  const i = +k.slice(1), P = e.pts.map(q => [+q[0], +q[1]]), n = P.length;
  if (i !== 0 && i !== n - 1) return null;
  const unit = v => { const l = Math.hypot(v[0], v[1]); return l > 1e-12 ? [v[0] / l, v[1] / l] : null; };
  if (e.curve === 'arc' && n === 3) {
    const c = circle3(P[0], P[1], P[2]);
    if (!c) return null;
    const p = P[i], rad = [p[0] - c.cx, p[1] - c.cy], perp = unit([-rad[1], rad[0]]);
    const away = i === 2 ? [P[2][0] - P[1][0], P[2][1] - P[1][1]] : [P[0][0] - P[1][0], P[0][1] - P[1][1]];
    const s = perp[0] * away[0] + perp[1] * away[1] >= 0 ? 1 : -1;
    return { p, T: [perp[0] * s, perp[1] * s], curve: `${id}:o` };
  }
  if (e.curve) return null; // splines: no tangent arc
  const T = i === n - 1 ? unit([P[n - 1][0] - P[n - 2][0], P[n - 1][1] - P[n - 2][1]]) : unit([P[0][0] - P[1][0], P[0][1] - P[1][1]]);
  // the curve the new arc is tangent to: the end segment of the line
  return T ? { p: P[i], T, curve: `${id}:l${i === n - 1 ? n - 2 : 0}` } : null;
}

// arc starting at S in direction T and ending at E ("Tangentialbogen") → [S, point on arc, E] or null
export function tangentArc(S, T, E) {
  const N = [-T[1], T[0]], d = [E[0] - S[0], E[1] - S[1]];
  const dn = d[0] * N[0] + d[1] * N[1];
  if (Math.abs(dn) < 1e-9) return null; // straight ahead: no arc
  const r = (d[0] * d[0] + d[1] * d[1]) / (2 * dn); // signed: > 0 centre on the left (counter-clockwise)
  const C = [S[0] + N[0] * r, S[1] + N[1] * r];
  const a0 = Math.atan2(S[1] - C[1], S[0] - C[0]), a1 = Math.atan2(E[1] - C[1], E[0] - C[0]);
  let sw = a1 - a0;
  if (r > 0) { while (sw <= 0) sw += TAU; while (sw > TAU) sw -= TAU; } else { while (sw >= 0) sw -= TAU; while (sw < -TAU) sw += TAU; }
  const R = Math.abs(r), m = a0 + sw / 2;
  return [[r4(S[0]), r4(S[1])], [r4(C[0] + R * Math.cos(m)), r4(C[1] + R * Math.sin(m))], [r4(E[0]), r4(E[1])]];
}
