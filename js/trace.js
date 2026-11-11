// Bild nachzeichnen: a raster picture becomes vector outlines or centre lines.
// Input is a grey picture { w, h, ink } with ink 0…255 per pixel (255 = full line colour, 0 = paper).
// All results are polylines in pixel units, x to the right, y DOWN (as in the picture): { pts: [[x, y] …], closed }.

// Grey values of RGBA pixels as ink: dark = ink; transparent counts as paper.
export function inkFromRGBA(rgba, w, h, invert = false) {
  const ink = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    const a = rgba[i * 4 + 3] / 255;
    const lum = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
    const grey = lum * a + 255 * (1 - a); // over white paper
    ink[i] = Math.round(invert ? grey : 255 - grey);
  }
  return ink;
}

const area = pts => { let s = 0; for (let i = 0, n = pts.length; i < n; i++) { const a = pts[i], b = pts[(i + 1) % n]; s += a[0] * b[1] - b[0] * a[1]; } return s / 2; };
const inside = (p, poly) => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if ((a[1] > p[1]) !== (b[1] > p[1]) && p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]) c = !c;
  }
  return c;
};

// Douglas-Peucker; closed loops are split at their two farthest points first
export function simplify(pts, tol, closed = false) {
  if (!(tol > 0) || pts.length < 3) return pts;
  const dist = (p, a, b) => {
    const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    if (L2 < 1e-18) return Math.hypot(p[0] - a[0], p[1] - a[1]);
    const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2));
    return Math.hypot(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
  };
  const run = list => {
    const keep = new Uint8Array(list.length);
    keep[0] = keep[list.length - 1] = 1;
    const stack = [[0, list.length - 1]];
    while (stack.length) {
      const [i, j] = stack.pop();
      let best = -1, bd = tol;
      for (let k = i + 1; k < j; k++) { const d = dist(list[k], list[i], list[j]); if (d > bd) { bd = d; best = k; } }
      if (best >= 0) { keep[best] = 1; stack.push([i, best], [best, j]); }
    }
    return list.filter((_, k) => keep[k]);
  };
  if (!closed) return run(pts);
  let far = 0, fd = -1;
  for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]); if (d > fd) { fd = d; far = k; } }
  const a = run(pts.slice(0, far + 1)), b = run([...pts.slice(far), pts[0]]);
  const out = [...a, ...b.slice(1, -1)];
  return out.length >= 3 ? out : pts;
}

// Corner cutting (Chaikin): rounds the stair steps left by the pixels without moving the line much
export function smooth(pts, closed, rounds = 1) {
  let p = pts;
  for (let r = 0; r < rounds; r++) {
    const n = p.length, q = [];
    if (n < 3) return p;
    if (!closed) q.push(p[0]);
    for (let i = 0; i < (closed ? n : n - 1); i++) {
      const a = p[i], b = p[(i + 1) % n];
      q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
    }
    if (!closed) q.push(p[n - 1]);
    p = q;
  }
  return p;
}

// Outlines where the ink crosses the threshold (marching squares, the crossing is placed between the two pixels
// by their grey values, so soft edges give smooth lines). Each loop has its nesting depth: 0 = outermost.
export function contours(img, threshold = 128) {
  const { w, h, ink } = img, W = w + 2, H = h + 2;
  // one pixel of paper around the picture, so shapes touching the border are closed
  const f = new Float32Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) f[(y + 1) * W + x + 1] = ink[y * w + x];
  const t = Math.min(254.5, Math.max(0.5, threshold));
  const key = (x, y, horiz) => (y * W + x) * 2 + (horiz ? 0 : 1); // edge from (x, y) to the right / downwards
  const pos = new Map();
  const cross = (x, y, horiz) => {
    const k = key(x, y, horiz);
    if (!pos.has(k)) {
      const a = f[y * W + x], b = horiz ? f[y * W + x + 1] : f[(y + 1) * W + x], u = Math.min(1, Math.max(0, (t - a) / (b - a || 1)));
      pos.set(k, horiz ? [x + u - 0.5, y - 0.5] : [x - 0.5, y + u - 0.5]); // pixel centres at +0.5, minus the border
    }
    return k;
  };
  const next = new Map(); // edge key -> edge key, ink on the left of the walking direction
  for (let y = 0; y < H - 1; y++) for (let x = 0; x < W - 1; x++) {
    const a = f[y * W + x] > t, b = f[y * W + x + 1] > t, c = f[(y + 1) * W + x + 1] > t, d = f[(y + 1) * W + x] > t;
    const code = (a ? 8 : 0) | (b ? 4 : 0) | (c ? 2 : 0) | (d ? 1 : 0);
    if (code === 0 || code === 15) continue;
    const T = () => cross(x, y, true), R = () => cross(x + 1, y, false), B = () => cross(x, y + 1, true), L = () => cross(x, y, false);
    const seg = (p, q) => next.set(p, q);
    switch (code) {
      case 1: seg(B(), L()); break; case 2: seg(R(), B()); break; case 3: seg(R(), L()); break; case 4: seg(T(), R()); break;
      case 5: seg(T(), L()); seg(B(), R()); break; // saddle: the two ink corners count as connected
      case 6: seg(T(), B()); break; case 7: seg(T(), L()); break; case 8: seg(L(), T()); break; case 9: seg(B(), T()); break;
      case 10: seg(L(), B()); seg(R(), T()); break;
      case 11: seg(R(), T()); break; case 12: seg(L(), R()); break; case 13: seg(B(), R()); break; case 14: seg(L(), B()); break;
    }
  }
  const loops = [], seen = new Set();
  for (const start of next.keys()) {
    if (seen.has(start)) continue;
    const pts = [];
    let k = start;
    while (k != null && !seen.has(k)) { seen.add(k); pts.push(pos.get(k)); k = next.get(k); }
    if (k === start && pts.length >= 3) loops.push({ pts, closed: true, area: Math.abs(area(pts)) });
  }
  // nesting: how many other loops lie around each loop
  loops.sort((p, q) => q.area - p.area);
  loops.forEach((l, i) => { l.depth = 0; for (let j = 0; j < i; j++) if (inside(l.pts[0], loops[j].pts)) l.depth++; });
  return loops;
}

// Zhang-Suen thinning of the ink above the threshold: what stays is a one pixel wide skeleton.
export function thin(img, threshold = 128) {
  const { w, h, ink } = img, W = w + 2, H = h + 2, g = new Uint8Array(W * H);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (ink[y * w + x] > threshold) g[(y + 1) * W + x + 1] = 1;
  const nb = [-W, -W + 1, 1, W + 1, W, W - 1, -1, -W - 1]; // P2 … P9, clockwise from the top
  let changed = true;
  const del = [];
  while (changed) {
    changed = false;
    for (let pass = 0; pass < 2; pass++) {
      del.length = 0;
      for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (!g[i]) continue;
        let B = 0, A = 0;
        for (let k = 0; k < 8; k++) { const v = g[i + nb[k]]; B += v; if (!v && g[i + nb[(k + 1) % 8]]) A++; }
        if (B < 2 || B > 6 || A !== 1) continue;
        const p2 = g[i + nb[0]], p4 = g[i + nb[2]], p6 = g[i + nb[4]], p8 = g[i + nb[6]];
        if (pass === 0 ? p2 * p4 * p6 === 0 && p4 * p6 * p8 === 0 : p2 * p4 * p8 === 0 && p2 * p6 * p8 === 0) del.push(i);
      }
      for (const i of del) g[i] = 0;
      if (del.length) changed = true;
    }
  }
  return { W, H, g };
}

// The skeleton as polylines: from end points and crossings along the pixels to the next end point or crossing.
export function centerlines(img, threshold = 128) {
  const { W, H, g } = thin(img, threshold);
  const nb8 = [-W - 1, -W, -W + 1, -1, 1, W - 1, W, W + 1];
  // neighbours of a skeleton pixel; a diagonal step is dropped when a straight step leads to the same pixel's side
  const nbs = i => {
    const out = [];
    for (const d of nb8) {
      if (!g[i + d]) continue;
      const dx = ((i + d) % W) - (i % W), dy = Math.floor((i + d) / W) - Math.floor(i / W);
      if (dx && dy && (g[i + dx] || g[i + dy * W])) continue;
      out.push(i + d);
    }
    return out;
  };
  const xy = i => [(i % W) - 0.5, Math.floor(i / W) - 0.5];
  const deg = new Map();
  for (let i = 0; i < W * H; i++) if (g[i]) deg.set(i, nbs(i).length);
  const used = new Set(), lines = [];
  const ek = (a, b) => (a < b ? a * (W * H) + b : b * (W * H) + a);
  const walk = (from, to) => {
    const path = [from, to];
    used.add(ek(from, to));
    let prev = from, cur = to;
    while (deg.get(cur) === 2) {
      const nx = nbs(cur).find(q => q !== prev && !used.has(ek(cur, q)));
      if (nx == null) break;
      used.add(ek(cur, nx));
      path.push(nx);
      prev = cur; cur = nx;
      if (cur === from) break;
    }
    return path;
  };
  for (const [i, d] of deg) {
    if (d === 2) continue;
    if (d === 0) continue; // a single dot
    for (const q of nbs(i)) if (!used.has(ek(i, q))) lines.push({ idx: walk(i, q), closed: false });
  }
  // what is left are rings without end points or crossings
  for (const [i, d] of deg) {
    if (d !== 2) continue;
    const q = nbs(i).find(x => !used.has(ek(i, x)));
    if (q == null) continue;
    const idx = walk(i, q);
    if (idx.length > 3 && idx[idx.length - 1] === i) lines.push({ idx: idx.slice(0, -1), closed: true });
    else lines.push({ idx, closed: false });
  }
  return lines.map(l => ({ pts: l.idx.map(xy), closed: l.closed }));
}

const lengthOf = (pts, closed) => { let s = 0; for (let i = 1; i < pts.length; i++) s += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); return closed && pts.length > 1 ? s + Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) : s; };

// ---------- corners, straight lines and arcs ----------
// Points at an even spacing along the line (the outline points of the tracer are unevenly spaced).
export function resample(pts, closed, step = 1) {
  const src = closed ? [...pts, pts[0]] : pts, out = [src[0]];
  let need = step;
  for (let i = 1; i < src.length; i++) {
    let a = src[i - 1];
    const b = src[i];
    let d = Math.hypot(b[0] - a[0], b[1] - a[1]);
    while (d >= need && d > 1e-12) { const u = need / d; a = [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]; out.push(a); d -= need; need = step; }
    need -= d;
  }
  const last = src[src.length - 1], q = out[out.length - 1];
  if (closed) { if (out.length > 3 && Math.hypot(q[0] - out[0][0], q[1] - out[0][1]) < step * 0.5) out.pop(); }
  else if (Math.hypot(last[0] - q[0], last[1] - q[1]) > step * 0.25) out.push(last); else out[out.length - 1] = last;
  return out;
}

// Indices of sharp corners in evenly spaced points: the direction changes by at least minDeg within k points on
// either side, and it does not keep turning further out (that would be a small circle, not a corner).
export function findCorners(P, closed, k = 4, minDeg = 38) {
  const n = P.length;
  if (n < (closed ? 6 * k : 2 * k + 1)) return [];
  const turn = (i, w) => {
    if (!closed && (i - w < 0 || i + w >= n)) return -1;
    const a = P[(i - w + n) % n], b = P[i], c = P[(i + w) % n];
    const ux = b[0] - a[0], uy = b[1] - a[1], vx = c[0] - b[0], vy = c[1] - b[1];
    return (Math.abs(Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)) * 180) / Math.PI;
  };
  const cand = [];
  for (let i = 0; i < n; i++) {
    const a1 = turn(i, k);
    if (a1 < minDeg) continue;
    const a2 = turn(i, 2 * k);
    if (a2 >= 0 && a2 > 1.6 * a1 + 8) continue;
    cand.push([i, a1]);
  }
  cand.sort((p, q) => q[1] - p[1]);
  const kept = [];
  for (const [i] of cand) if (!kept.some(j => { const d = Math.abs(i - j); return Math.min(d, closed ? n - d : d) <= k; })) kept.push(i);
  return kept.sort((p, q) => p - q);
}

const circle3 = (a, m, b) => {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-9) return null;
  const a2 = a[0] * a[0] + a[1] * a[1], m2 = m[0] * m[0] + m[1] * m[1], b2 = b[0] * b[0] + b[1] * b[1];
  const cx = (a2 * (m[1] - b[1]) + m2 * (b[1] - a[1]) + b2 * (a[1] - m[1])) / d, cy = (a2 * (b[0] - m[0]) + m2 * (a[0] - b[0]) + b2 * (m[0] - a[0])) / d;
  return { c: [cx, cy], r: Math.hypot(a[0] - cx, a[1] - cy) };
};
// least-squares circle (Kasa)
export function fitCircle(P) {
  const n = P.length;
  let sx = 0, sy = 0;
  for (const p of P) { sx += p[0]; sy += p[1]; }
  const mx = sx / n, my = sy / n;
  let suu = 0, suv = 0, svv = 0, suuu = 0, svvv = 0, suvv = 0, svuu = 0;
  for (const p of P) { const u = p[0] - mx, v = p[1] - my; suu += u * u; suv += u * v; svv += v * v; suuu += u * u * u; svvv += v * v * v; suvv += u * v * v; svuu += v * u * u; }
  const det = suu * svv - suv * suv;
  if (Math.abs(det) < 1e-9) return null;
  const e = (suuu + suvv) / 2, f = (svvv + svuu) / 2, uc = (e * svv - f * suv) / det, vc = (f * suu - e * suv) / det;
  const c = [mx + uc, my + vc], r = Math.sqrt(uc * uc + vc * vc + (suu + svv) / n);
  let dev = 0;
  for (const p of P) dev = Math.max(dev, Math.abs(Math.hypot(p[0] - c[0], p[1] - c[1]) - r));
  return { c, r, dev };
}
// straight line through points i0 … i1 (total least squares) and how far they lie from it
function lineFit(run, i0, i1) {
  let a = i0, b = i1;
  if (b - a >= 8) { a += 2; b -= 2; } // the ends sit in the rounded corners of the pixel outline
  let mx = 0, my = 0;
  const n = b - a + 1;
  for (let i = a; i <= b; i++) { mx += run[i][0]; my += run[i][1]; }
  mx /= n; my /= n;
  let sxx = 0, sxy = 0, syy = 0;
  for (let i = a; i <= b; i++) { const u = run[i][0] - mx, v = run[i][1] - my; sxx += u * u; sxy += u * v; syy += v * v; }
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy), dx = Math.cos(th), dy = Math.sin(th);
  const off = i => Math.abs(dx * (run[i][1] - my) - dy * (run[i][0] - mx));
  let dev = 0;
  for (let i = a; i <= b; i++) dev = Math.max(dev, off(i));
  return { p: [mx, my], d: [dx, dy], dev, ends: Math.max(off(i0), off(i1)) };
}
function arcFit(run, i0, i1, tol) {
  if (i1 - i0 < 5) return null;
  const mid = (i0 + i1) >> 1, tries = [circle3(run[i0], run[mid], run[i1])];
  const ls = fitCircle(run.slice(i0, i1 + 1));
  if (ls) { // the fitted circle moved onto the two end points
    const dx = run[mid][0] - ls.c[0], dy = run[mid][1] - ls.c[1], l = Math.hypot(dx, dy) || 1;
    tries.push(circle3(run[i0], [ls.c[0] + (dx / l) * ls.r, ls.c[1] + (dy / l) * ls.r], run[i1]));
  }
  for (const c of tries) {
    if (!c || !(c.r < 1e5)) continue;
    let dev = 0;
    for (let i = i0; i <= i1 && dev <= tol; i++) dev = Math.max(dev, Math.abs(Math.hypot(run[i][0] - c.c[0], run[i][1] - c.c[1]) - c.r));
    if (dev > tol) continue;
    const dx = run[mid][0] - c.c[0], dy = run[mid][1] - c.c[1], l = Math.hypot(dx, dy) || 1;
    return { t: 'a', a: run[i0], m: [c.c[0] + (dx / l) * c.r, c.c[1] + (dy / l) * c.r], b: run[i1], c: c.c, r: c.r, i0, i1, run };
  }
  return null;
}
// A piece of an evenly spaced line as straight lines and arcs within tol: from each start the longest straight
// line and the longest arc that still fit are found, the one that reaches further is taken.
function fitRun(run, i0, i1, tol, out) {
  const reach = ok => { // largest end index for which ok(end) holds (ok is true for short pieces)
    let lo = Math.min(i1, start + 2), step = 4;
    while (lo < i1) { const tryAt = Math.min(i1, lo + step); if (!ok(tryAt)) break; lo = tryAt; step *= 2; }
    let hi = Math.min(i1, lo + step);
    while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (ok(mid)) lo = mid; else hi = mid; }
    return hi > lo && ok(hi) ? hi : lo;
  };
  let start = i0;
  while (start < i1) {
    const lineOk = e => { const q = lineFit(run, start, e); return q.dev <= tol * 0.8 && q.ends <= tol * 2; };
    const le = reach(lineOk), ae = reach(e => e - start < 5 || !!arcFit(run, start, e, tol));
    const arc = ae - start >= 5 && ae - start > 1.15 * (le - start) + 2 ? arcFit(run, start, ae, tol) : null;
    if (arc) { out.push(arc); start = ae; } else { out.push({ t: 'l', a: run[start], b: run[le], i0: start, i1: le, run }); start = le; }
  }
}
const lineOf = seg => { const q = lineFit(seg.run, seg.i0, seg.i1); return [q.p, q.d]; };
const arcPoints = (s, step = 0.75) => {
  const a0 = Math.atan2(s.a[1] - s.c[1], s.a[0] - s.c[0]), am = Math.atan2(s.m[1] - s.c[1], s.m[0] - s.c[0]), a1 = Math.atan2(s.b[1] - s.c[1], s.b[0] - s.c[0]);
  const norm = x => ((x % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
  const ccw = norm(am - a0) < norm(a1 - a0), sweep = ccw ? norm(a1 - a0) : -norm(a0 - a1);
  const n = Math.max(2, Math.ceil((Math.abs(sweep) * s.r) / step)), out = [];
  for (let i = 1; i <= n; i++) { const t = a0 + (sweep * i) / n; out.push(i === n ? s.b : [s.c[0] + s.r * Math.cos(t), s.c[1] + s.r * Math.sin(t)]); }
  return out;
};

// A traced line as corners, straight lines and arcs. Returns { closed, segs, pts } or { closed, circle: { c, r }, pts };
// pts is the same shape as a fine polyline (preview, SVG).
export function fitCurve(pts, closed, tol = 0.5) {
  const P = resample(pts, closed, 1), n = P.length;
  if (n < 3) return { closed: false, segs: [{ t: 'l', a: P[0], b: P[n - 1] }], pts: P };
  let corners = findCorners(P, closed);
  if (closed && !corners.length) {
    const c = fitCircle(P);
    if (c && c.dev <= tol) return { closed: true, circle: { c: c.c, r: c.r }, pts: Array.from({ length: 72 }, (_, i) => [c.c[0] + c.r * Math.cos((i * Math.PI) / 36), c.c[1] + c.r * Math.sin((i * Math.PI) / 36)]) };
    corners = [0, n >> 1];
  }
  const segs = [], joint = []; // joint[k]: segment k starts at a corner
  const piece = (i, j) => { // points i … j (cyclic for closed lines)
    const run = [];
    for (let q = i; ; q = (q + 1) % n) { run.push(P[q]); if (q === j) break; }
    const k0 = segs.length;
    fitRun(run, 0, run.length - 1, tol, segs);
    joint[k0] = true;
  };
  if (closed) {
    if (corners.length === 1) corners.push((corners[0] + (n >> 1)) % n);
    corners.forEach((c, k) => piece(c, corners[(k + 1) % corners.length]));
  } else {
    const stops = [...new Set([0, ...corners, n - 1])].sort((a, b) => a - b);
    for (let k = 0; k + 1 < stops.length; k++) piece(stops[k], stops[k + 1]);
  }
  const m = segs.length;
  // an arc between two straight lines is a rounded corner: the arc that touches both lines, with the radius
  // measured in the middle of the bend (the greedy pieces above run a little into the straight parts)
  for (let k = 0; k < m; k++) {
    const pv = (k - 1 + m) % m, nx = (k + 1) % m, arc = segs[k];
    if (arc.t !== 'a' || m < 3 || (!closed && (k === 0 || k === m - 1))) continue;
    const s = segs[pv], t = segs[nx];
    if (s.t !== 'l' || t.t !== 'l') continue;
    const [p1, d1] = lineOf(s), [p2, d2] = lineOf(t), den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 0.15) continue;
    const u = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den, X = [p1[0] + d1[0] * u, p1[1] + d1[1] * u];
    const dir = q => { const l = Math.hypot(q[0] - X[0], q[1] - X[1]) || 1; return [(q[0] - X[0]) / l, (q[1] - X[1]) / l, l]; };
    const u1 = dir(s.a), u2 = dir(t.b), cosPhi = Math.max(-1, Math.min(1, u1[0] * u2[0] + u1[1] * u2[1])), half = Math.acos(cosPhi) / 2;
    if (half < 0.1 || half > 1.45) continue;
    const q0 = arc.i0 + Math.floor((arc.i1 - arc.i0) * 0.25), q1 = arc.i1 - Math.floor((arc.i1 - arc.i0) * 0.25);
    const core = q1 - q0 >= 3 ? fitCircle(arc.run.slice(q0, q1 + 1)) : null, r = core ? core.r : arc.r;
    const td = r / Math.tan(half);
    if (!(td < u1[2] - 0.5 && td < u2[2] - 0.5)) continue;
    const bl = Math.hypot(u1[0] + u2[0], u1[1] + u2[1]) || 1, bis = [(u1[0] + u2[0]) / bl, (u1[1] + u2[1]) / bl], cd = r / Math.sin(half);
    const c = [X[0] + bis[0] * cd, X[1] + bis[1] * cd];
    let dev = 0;
    for (let i = q0; i <= q1; i++) dev = Math.max(dev, Math.abs(Math.hypot(arc.run[i][0] - c[0], arc.run[i][1] - c[1]) - r));
    if (dev > tol * 1.5) continue;
    const T1 = [X[0] + u1[0] * td, X[1] + u1[1] * td], T2 = [X[0] + u2[0] * td, X[1] + u2[1] * td];
    s.b = T1; t.a = T2;
    Object.assign(arc, { a: T1, b: T2, m: [c[0] - bis[0] * r, c[1] - bis[1] * r], c, r });
  }
  // corners between two straight lines: where the two lines really meet
  for (let k = 0; k < m; k++) {
    const nx = (k + 1) % m;
    if (!closed && nx === 0) break;
    const s = segs[k], t = segs[nx];
    if (s.t !== 'l' || t.t !== 'l') continue;
    const [p1, d1] = lineOf(s), [p2, d2] = lineOf(t), den = d1[0] * d2[1] - d1[1] * d2[0];
    if (Math.abs(den) < 0.2) continue;
    const u = ((p2[0] - p1[0]) * d2[1] - (p2[1] - p1[1]) * d2[0]) / den, X = [p1[0] + d1[0] * u, p1[1] + d1[1] * u];
    if (Math.hypot(X[0] - s.b[0], X[1] - s.b[1]) <= 2.5) { s.b = X; t.a = X; }
  }
  const flat = closed ? [] : [segs[0].a];
  for (const s of segs) { if (s.t === 'l') flat.push(s.b); else flat.push(...arcPoints(s)); }
  return { closed, segs: segs.map(s => (s.t === 'l' ? { t: 'l', a: s.a, b: s.b } : { t: 'a', a: s.a, m: s.m, b: s.b, c: s.c, r: s.r })), pts: flat };
}

// ---------- colours ----------
// The picture reduced to n colours (k-means on a sample of the pixels). Returns the palette [[r, g, b] …],
// for every pixel the number of its colour, and how many pixels each colour has. Transparent counts as white.
export function quantize(rgba, w, h, n = 4) {
  const N = w * h, stride = Math.max(1, Math.floor(N / 20000)), S = [];
  const px = i => { const a = rgba[i * 4 + 3] / 255; return [rgba[i * 4] * a + 255 * (1 - a), rgba[i * 4 + 1] * a + 255 * (1 - a), rgba[i * 4 + 2] * a + 255 * (1 - a)]; };
  for (let i = 0; i < N; i += stride) S.push(px(i));
  const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2 + (p[2] - q[2]) ** 2;
  // start: the most frequent colour, then always the sample farthest from the colours chosen so far
  const bins = new Map();
  for (const p of S) { const k = (p[0] >> 4) * 256 + (p[1] >> 4) * 16 + (p[2] >> 4); const b = bins.get(k) || [0, 0, 0, 0]; b[0] += p[0]; b[1] += p[1]; b[2] += p[2]; b[3]++; bins.set(k, b); }
  const top = [...bins.values()].sort((a, b) => b[3] - a[3])[0];
  const C = [[top[0] / top[3], top[1] / top[3], top[2] / top[3]]];
  const near = S.map(p => d2(p, C[0]));
  while (C.length < n) {
    let best = 0;
    for (let i = 1; i < S.length; i++) if (near[i] > near[best]) best = i;
    if (near[best] < 100) break; // nothing clearly different is left
    C.push(S[best].slice());
    S.forEach((p, i) => { near[i] = Math.min(near[i], d2(p, C[C.length - 1])); });
  }
  const nearest = p => { let k = 0, bd = Infinity; for (let c = 0; c < C.length; c++) { const d = d2(p, C[c]); if (d < bd) { bd = d; k = c; } } return k; };
  for (let it = 0; it < 8; it++) {
    const sum = C.map(() => [0, 0, 0, 0]);
    for (const p of S) { const k = nearest(p), s = sum[k]; s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; s[3]++; }
    sum.forEach((s, k) => { if (s[3]) C[k] = [s[0] / s[3], s[1] / s[3], s[2] / s[3]]; });
  }
  const index = new Uint8Array(N), counts = new Array(C.length).fill(0);
  for (let i = 0; i < N; i++) { const k = nearest(px(i)); index[i] = k; counts[k]++; }
  // soft edges between two colours give a seam of pixels in a third, in-between colour: a pixel that stands
  // almost alone among its neighbours takes the colour most of them have (two rounds)
  const tally = new Int32Array(C.length);
  for (let round = 0; round < 2; round++) {
    const src = index.slice();
    for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
      const i = y * w + x, me = src[i];
      tally.fill(0);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) tally[src[i + dy * w + dx]]++;
      if (tally[me] >= 3) continue;
      let best = me, bn = tally[me];
      for (let k = 0; k < C.length; k++) if (tally[k] > bn) { bn = tally[k]; best = k; }
      if (best !== me) { index[i] = best; counts[me]--; counts[best]++; }
    }
  }
  return { palette: C.map(c => c.map(v => Math.round(v))), index, counts };
}
// Ink picture of the chosen colours (soft edge of one pixel, so the outline is not a staircase).
export function inkOfColors(index, w, h, chosen) {
  const on = new Uint8Array(w * h), set = new Set(chosen);
  for (let i = 0; i < w * h; i++) if (set.has(index[i])) on[i] = 1;
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0, c = 0;
    for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = x + i, Y = y + j; if (X < 0 || Y < 0 || X >= w || Y >= h) continue; s += on[Y * w + X]; c++; }
    ink[y * w + x] = Math.round((s / c) * 255);
  }
  return ink;
}

// One call for the dialog. mode: 'all' (outside and inside outlines), 'outer' (outermost outline of every shape),
// 'inner' (only the openings), 'center' (centre line of the strokes).
// minSize: outlines with less area (px²) / centre lines shorter than this (px) are dropped as specks.
// curves: 'poly' (polylines; with smoothing the corners stay sharp) or 'fit' (straight lines, arcs and circles).
export function traceImage(img, { threshold = 128, mode = 'all', minSize = 8, tolerance = 0.6, smoothing = 1, curves = 'poly' } = {}) {
  const center = mode === 'center';
  let raw = center
    ? centerlines(img, threshold).filter(l => lengthOf(l.pts, l.closed) >= Math.max(2, minSize))
    : contours(img, threshold).filter(l => l.area >= minSize && (mode === 'all' || (mode === 'outer' ? l.depth % 2 === 0 : l.depth % 2 === 1)));
  if (curves === 'fit') {
    return raw.map(l => {
      // a skeleton runs from pixel to pixel: calm it before fitting
      const pts = center ? simplify(smooth(simplify(l.pts, 0.75, l.closed), l.closed, 2), 0.05, l.closed) : l.pts;
      return fitCurve(pts, l.closed, Math.max(0.3, tolerance));
    }).filter(l => l.circle || l.segs.length);
  }
  let out;
  if (center) out = raw.map(l => ({ closed: l.closed, pts: simplify(l.pts, Math.max(tolerance, 0.75), l.closed) }));
  else out = raw.map(l => ({ closed: true, depth: l.depth, pts: l.pts }));
  const rounds = Math.min(3, Math.round(smoothing));
  const soften = (pts, closed) => simplify(smooth(pts, closed, rounds), tolerance * 0.25, closed);
  out = out.map(l => {
    if (center) return rounds > 0 ? { ...l, pts: soften(l.pts, l.closed) } : l;
    if (!(rounds > 0)) return { ...l, pts: simplify(l.pts, tolerance, true) };
    // smooth between the corners only, so a rectangle keeps its corners
    const P = resample(l.pts, true, 1), cs = findCorners(P, true);
    if (!cs.length) return { ...l, pts: soften(simplify(l.pts, tolerance, true), true) };
    const pts = [];
    cs.forEach((c, k) => {
      const run = [], end = cs[(k + 1) % cs.length];
      for (let q = c; ; q = (q + 1) % P.length) { run.push(P[q]); if (q === end && run.length > 1) break; }
      const s = soften(simplify(run, tolerance, false), false);
      pts.push(...s.slice(0, -1));
    });
    return { ...l, pts };
  });
  return out.filter(l => l.pts.length >= (l.closed ? 3 : 2));
}

// Picture coordinates to millimetres: width in mm, y up, the middle of the picture at (cx, cy).
export function toSketch(lines, img, widthMm, cx = 0, cy = 0) {
  const k = widthMm / img.w, r = v => +v.toFixed(4), P = ([x, y]) => [r(cx + (x - img.w / 2) * k), r(cy - (y - img.h / 2) * k)];
  return lines.map(l => ({
    closed: l.closed, pts: l.pts.map(P),
    ...(l.circle ? { circle: { c: P(l.circle.c), r: r(l.circle.r * k) } } : {}),
    ...(l.segs ? { segs: l.segs.map(s => (s.t === 'l' ? { t: 'l', a: P(s.a), b: P(s.b) } : { t: 'a', a: P(s.a), m: P(s.m), b: P(s.b), r: r(s.r * k) })) } : {}),
    ...(l.color ? { color: l.color } : {}),
  }));
}

// Sketch entities (without ids) of traced lines in millimetres: circles, closed outlines of straight lines as one
// polyline, otherwise runs of straight lines and three-point arcs that meet end to end.
export function toEntities(mm) {
  const out = [];
  for (const l of mm) {
    if (l.circle) { out.push({ type: 'circle', cx: l.circle.c[0], cy: l.circle.c[1], r: l.circle.r }); continue; }
    if (!l.segs) { out.push({ type: 'poly', closed: l.closed, pts: l.pts }); continue; }
    if (l.segs.every(s => s.t === 'l')) { out.push({ type: 'poly', closed: l.closed, pts: l.closed ? l.segs.map(s => s.a) : [l.segs[0].a, ...l.segs.map(s => s.b)] }); continue; }
    let run = null;
    for (const s of l.segs) {
      if (s.t === 'l') { if (run) run.push(s.b); else run = [s.a, s.b]; continue; }
      if (run) { out.push({ type: 'poly', closed: false, pts: run }); run = null; }
      out.push({ type: 'poly', curve: 'arc', closed: false, pts: [s.a, s.m, s.b] });
    }
    if (run) out.push({ type: 'poly', closed: false, pts: run });
  }
  return out;
}

export function toSVG(lines, widthMm, heightMm, cx = 0, cy = 0) {
  const x0 = cx - widthMm / 2, y1 = cy + heightMm / 2, f = v => +v.toFixed(3);
  const d = ls => ls.map(l => 'M' + l.pts.map(([x, y]) => `${f(x - x0)} ${f(y1 - y)}`).join(' L') + (l.closed ? ' Z' : '')).join(' ');
  const groups = new Map();
  for (const l of lines) { const c = l.color || '#000'; (groups.get(c) || groups.set(c, []).get(c)).push(l); }
  const paths = [...groups].map(([c, ls]) => `  <path d="${d(ls)}" fill="none" stroke="${c}" stroke-width="0.1"/>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<svg xmlns="http://www.w3.org/2000/svg" width="${f(widthMm)}mm" height="${f(heightMm)}mm" viewBox="0 0 ${f(widthMm)} ${f(heightMm)}">\n${paths}\n</svg>\n`;
}
