// Adaptive clearing: the tool advances in small steps and at every step picks
// the heading whose newly removed area matches a target radial engagement.
// Remaining material is tracked on a grid, so the load stays constant instead
// of jumping to full width in corners like an offset pocket does.

const S = 1000; // Clipper scale (matches cam.js)

function bounds(paths) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of paths) for (const q of p) { x0 = Math.min(x0, q.X); y0 = Math.min(y0, q.Y); x1 = Math.max(x1, q.X); y1 = Math.max(y1, q.Y); }
  return { x0: x0 / S, y0: y0 / S, x1: x1 / S, y1: y1 / S };
}

// Clipper paths offset inwards by d (round joins).
function shrink(paths, d) {
  const L = globalThis.ClipperLib;
  if (!L || !d) return paths;
  const co = new L.ClipperOffset(2, 0.01 * S), out = new L.Paths();
  co.AddPaths(paths, L.JoinType.jtRound, L.EndType.etClosedPolygon);
  co.Execute(out, -d * S);
  return out;
}

// even-odd scanline fill of Clipper paths into a grid
function rasterize(paths, g) {
  const out = new Uint8Array(g.nx * g.ny);
  const edges = [];
  for (const p of paths) for (let i = 0; i < p.length; i++) {
    const a = p[i], b = p[(i + 1) % p.length];
    if (a.Y !== b.Y) edges.push([a.X / S, a.Y / S, b.X / S, b.Y / S]);
  }
  const xs = [];
  for (let j = 0; j < g.ny; j++) {
    const y = g.y0 + j * g.res;
    xs.length = 0;
    for (const [ax, ay, bx, by] of edges) if ((ay > y) !== (by > y)) xs.push(ax + ((y - ay) * (bx - ax)) / (by - ay));
    xs.sort((a, b) => a - b);
    for (let k = 0; k + 1 < xs.length; k += 2) {
      const i0 = Math.max(0, Math.ceil((xs[k] - g.x0) / g.res)), i1 = Math.min(g.nx - 1, Math.floor((xs[k + 1] - g.x0) / g.res));
      for (let i = i0; i <= i1; i++) out[j * g.nx + i] = 1;
    }
  }
  return out;
}

// squared distance (in cells) of every cell to the nearest set cell (Felzenszwalb & Huttenlocher, two 1D passes)
function edt2(src, nx, ny) {
  const INF = 1e20, out = new Float64Array(nx * ny);
  for (let k = 0; k < nx * ny; k++) out[k] = src[k] ? 0 : INF;
  const n = Math.max(nx, ny), f = new Float64Array(n), d = new Float64Array(n), v = new Int32Array(n), z = new Float64Array(n + 1);
  const pass = (len, get, set) => {
    for (let q = 0; q < len; q++) f[q] = get(q);
    let k = 0; v[0] = 0; z[0] = -INF; z[1] = INF;
    for (let q = 1; q < len; q++) {
      let sct;
      for (;;) {
        sct = (f[q] + q * q - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
        if (sct <= z[k] && k > 0) k--; else break;
      }
      if (sct <= z[k]) { v[0] = q; z[0] = -INF; z[1] = INF; k = 0; continue; }
      k++; v[k] = q; z[k] = sct; z[k + 1] = INF;
    }
    k = 0;
    for (let q = 0; q < len; q++) { while (z[k + 1] < q) k++; d[q] = (q - v[k]) ** 2 + f[v[k]]; }
    for (let q = 0; q < len; q++) set(q, d[q]);
  };
  for (let j = 0; j < ny; j++) pass(nx, i => out[j * nx + i], (i, val) => { out[j * nx + i] = val; });
  for (let i = 0; i < nx; i++) pass(ny, j => out[j * nx + i], (j, val) => { out[j * nx + i] = val; });
  return out;
}

/**
 * Clears one Z level adaptively and appends the moves to path P.
 * allowed:  Clipper paths of where the tool CENTRE may go (region shrunk by radius + stock to leave)
 * material: Clipper paths of where material exists at this level
 */
export function adaptiveLevel(P, { allowed, material, z, zFrom, tool, ae, rampDeg = 2, climb = true, finishPass = true }) {
  if (!allowed.length) return;
  const r = tool.dia / 2;
  const res = Math.min(0.4, Math.max(0.08, tool.dia / 20));
  const b = bounds(allowed);
  const g = { x0: b.x0 - r - res, y0: b.y0 - r - res, res };
  g.nx = Math.ceil((b.x1 - b.x0 + 2 * r + 2 * res) / res) + 1;
  g.ny = Math.ceil((b.y1 - b.y0 + 2 * r + 2 * res) / res) + 1;
  const N = g.nx * g.ny;
  // a tool position is checked against the nearest cell, so it can lie up to half a cell diagonal beyond that
  // cell's centre: rasterize the allowed region shrunk by that much (the finishing pass runs on the exact outline)
  const allow = rasterize(shrink(allowed, res * Math.SQRT1_2), g);
  const mat = rasterize(material, g);

  const disc = [];
  const rc = r / res;
  for (let dj = -Math.ceil(rc); dj <= Math.ceil(rc); dj++) for (let di = -Math.ceil(rc); di <= Math.ceil(rc); di++) if (di * di + dj * dj <= rc * rc) disc.push([di, dj]);

  // only material the tool can reach at all: within the radius of an allowed centre (distance transform)
  const d2 = edt2(allow, g.nx, g.ny), rc2 = rc * rc + 1e-9;
  for (let k = 0; k < N; k++) if (mat[k] && d2[k] > rc2) mat[k] = 0;

  const cell = (x, y) => [Math.round((x - g.x0) / res), Math.round((y - g.y0) / res)];
  const allowedAt = (x, y) => { const [i, j] = cell(x, y); return i >= 0 && j >= 0 && i < g.nx && j < g.ny && allow[j * g.nx + i] === 1; };
  // Exact cell-centre distances (no rounding of the tool position): rounding
  // would leave one-cell crumbs along the path that the tool then chases.
  const visitDisc = (x, y, R, fn) => {
    const i0 = Math.max(0, Math.ceil((x - R - g.x0) / res)), i1 = Math.min(g.nx - 1, Math.floor((x + R - g.x0) / res));
    const j0 = Math.max(0, Math.ceil((y - R - g.y0) / res)), j1 = Math.min(g.ny - 1, Math.floor((y + R - g.y0) / res));
    const RR = R * R;
    for (let j = j0; j <= j1; j++) {
      const dy = g.y0 + j * res - y, dy2 = dy * dy;
      if (dy2 > RR) continue;
      const row = j * g.nx;
      for (let i = i0; i <= i1; i++) { const dx = g.x0 + i * res - x; if (dx * dx + dy2 <= RR) fn(row + i); }
    }
  };
  // material cells under the tool: per row the span of cells inside the circle, summed in a tight loop
  // (same cells as visitDisc, the hot spot of the whole strategy)
  const engagement = (x, y) => {
    const RR = r * r, fx = (x - g.x0) / res;
    const j0 = Math.max(0, Math.ceil((y - r - g.y0) / res)), j1 = Math.min(g.ny - 1, Math.floor((y + r - g.y0) / res));
    let n = 0;
    for (let j = j0; j <= j1; j++) {
      const dy = g.y0 + j * res - y, w2 = RR - dy * dy;
      if (w2 < 0) continue;
      const w = Math.sqrt(w2) / res;
      let i0 = Math.ceil(fx - w), i1 = Math.floor(fx + w);
      // the float span may differ from dx² + dy² <= RR by one cell at the ends: check those exactly
      if (i0 < 0) i0 = 0;
      if (i1 > g.nx - 1) i1 = g.nx - 1;
      const row = j * g.nx;
      for (let i = i0; i <= i1; i++) n += mat[row + i];
      if (i0 <= i1) {
        let dx = g.x0 + i0 * res - x; if (dx * dx + dy * dy > RR) n -= mat[row + i0];
        if (i1 > i0) { dx = g.x0 + i1 * res - x; if (dx * dx + dy * dy > RR) n -= mat[row + i1]; }
      }
    }
    return n;
  };
  // clear slightly more than the radius so sub-cell slivers do not survive
  const clearDisc = (x, y, R = r) => visitDisc(x, y, R + 0.5 * res, k => { mat[k] = 0; });

  const step = Math.max(res * 2, 0.1 * tool.dia);
  const target = (ae * step) / (res * res);
  const NA = 25;

  // merge collinear feed moves to keep the program short
  const feedTo = (x, y, zz, f) => {
    const m = P.m, n = m.length;
    if (n >= 2 && m[n - 1].t === 'f' && m[n - 2].z === zz && m[n - 1].z === zz && m[n - 1].f === f) {
      const a = m[n - 2], c = m[n - 1];
      const d1 = [c.x - a.x, c.y - a.y], d2 = [x - c.x, y - c.y];
      const cr = d1[0] * d2[1] - d1[1] * d2[0], dt = d1[0] * d2[0] + d1[1] * d2[1];
      if (dt > 0 && Math.abs(cr) < 0.003 * Math.hypot(...d1) * Math.hypot(...d2)) { c.x = x; c.y = y; P.p = { x, y, z: zz }; return; }
    }
    P.feed(x, y, zz, f);
  };

  const pathClear = (a, c) => {
    const L = Math.hypot(c[0] - a[0], c[1] - a[1]);
    const n = Math.ceil(L / res);
    // the target itself touches material by design; everything before it must be cut already
    for (let k = 1; k <= n; k++) {
      const x = a[0] + ((c[0] - a[0]) * k) / n, y = a[1] + ((c[1] - a[1]) * k) / n;
      if (!allowedAt(x, y)) return false;
      if (k < n && engagement(x, y) > 0) return false;
    }
    return true;
  };

  const helix = (cx, cy, rh) => {
    const circ = 2 * Math.PI * rh;
    const drop = circ * Math.tan(Math.max(0.5, rampDeg) * (Math.PI / 180));
    let zz = zFrom, a = 0;
    P.moveAbove(cx + rh, cy);
    P.rapid(cx + rh, cy, zFrom);
    const dir = climb ? 1 : -1;
    while (zz > z + 1e-6) {
      for (let k = 1; k <= 36; k++) {
        a += (dir * 2 * Math.PI) / 36;
        zz = Math.max(z, zz - drop / 36);
        P.feed(cx + rh * Math.cos(a), cy + rh * Math.sin(a), zz, tool.plunge);
      }
    }
    for (let k = 1; k <= 36; k++) { a += (dir * 2 * Math.PI) / 36; P.feed(cx + rh * Math.cos(a), cy + rh * Math.sin(a), z, tool.feed); }
    P.feed(cx, cy, z, tool.feed);
    clearDisc(cx, cy, r + rh);
  };

  // entry next to the nearest remaining material, as far in the cleared area as possible
  const findEntry = pos => {
    for (let guard = 0; guard < 2000; guard++) {
      let best = -1, bd = Infinity;
      for (let k = 0; k < N; k++) {
        if (!mat[k]) continue;
        const x = g.x0 + (k % g.nx) * res, y = g.y0 + Math.floor(k / g.nx) * res;
        const d = (x - pos[0]) ** 2 + (y - pos[1]) ** 2;
        if (d < bd) { bd = d; best = k; }
      }
      if (best < 0) return null;
      const mi = best % g.nx, mj = Math.floor(best / g.nx);
      let cand = null, cc = Infinity;
      const q = Math.ceil(rc);
      for (let dj = -q; dj <= q; dj += 1) for (let di = -q; di <= q; di += 1) {
        if (di * di + dj * dj > rc * rc) continue;
        const ii = mi + di, jj = mj + dj;
        if (ii < 0 || jj < 0 || ii >= g.nx || jj >= g.ny || !allow[jj * g.nx + ii]) continue;
        const x = g.x0 + ii * res, y = g.y0 + jj * res;
        const e = engagement(x, y);
        if (e > 0 && e < cc) { cc = e; cand = [x, y]; }
      }
      if (cand) return { p: cand, frac: cc / disc.length };
      mat[best] = 0; // unreachable leftover
    }
    return null;
  };

  let pos = P.p ? [P.p.x, P.p.y] : [b.x0, b.y0];
  let atDepth = false;
  for (let entries = 0; entries < 400; entries++) {
    const en = findEntry(pos);
    if (!en) break;
    const [ex, ey] = en.p;
    if (atDepth && pathClear(pos, en.p)) feedTo(ex, ey, z, tool.feed);
    else if (en.frac < 0.04) {
      // mostly air or already cleared: straight down
      P.moveAbove(ex, ey);
      if (zFrom < P.clear) P.rapid(ex, ey, zFrom);
      P.feed(ex, ey, z, tool.plunge);
    } else {
      let rh = Math.min(0.45 * tool.dia, 0.3 * tool.dia + 0.5);
      const fits = R => Array.from({ length: 12 }, (_, k) => [ex + R * Math.cos((k * Math.PI) / 6), ey + R * Math.sin((k * Math.PI) / 6)]).every(([x, y]) => allowedAt(x, y));
      while (rh > 0.1 * tool.dia && !fits(rh)) rh *= 0.7;
      if (fits(rh)) helix(ex, ey, rh);
      else { P.moveAbove(ex, ey); P.feed(ex, ey, z, tool.plunge); }
    }
    atDepth = true;
    pos = [ex, ey];
    clearDisc(ex, ey);

    // initial heading: towards the material around the entry
    let hx = 0, hy = 0;
    const [ci, cj] = cell(ex, ey);
    const q = Math.ceil(rc * 2);
    for (let dj = -q; dj <= q; dj++) for (let di = -q; di <= q; di++) {
      const ii = ci + di, jj = cj + dj;
      if (ii >= 0 && jj >= 0 && ii < g.nx && jj < g.ny && mat[jj * g.nx + ii]) { hx += di; hy += dj; }
    }
    let heading = Math.atan2(hy, hx);
    let idle = 0;
    for (let s = 0; s < 200000; s++) {
      let best = null, fallback = null;
      for (let k = 0; k < NA; k++) {
        const rel = ((-100 + (200 * k) / (NA - 1)) * Math.PI) / 180;
        const ang = heading + (climb ? rel : -rel);
        const nx = pos[0] + step * Math.cos(ang), ny = pos[1] + step * Math.sin(ang);
        if (!allowedAt(nx, ny)) continue;
        const e = engagement(nx, ny);
        if (e <= target) { if (!best || e > best.e) best = { nx, ny, ang, e }; }
        else if (!fallback || e < fallback.e) fallback = { nx, ny, ang, e };
      }
      const pick = best || fallback;
      if (!pick) break;
      idle = pick.e < target * 0.05 ? idle + 1 : 0;
      if (idle > 8) break;
      feedTo(pick.nx, pick.ny, z, tool.feed);
      clearDisc(pick.nx, pick.ny);
      pos = [pick.nx, pick.ny];
      heading = pick.ang;
    }
  }

  if (finishPass) {
    // one pass along the boundary removes the scallops left between adaptive loops
    for (const path of allowed) {
      const loop = path.map(q => [q.X / S, q.Y / S]);
      if (loop.length < 3) continue;
      let bi = 0, bd = Infinity;
      loop.forEach(([x, y], i) => { const d = (x - pos[0]) ** 2 + (y - pos[1]) ** 2; if (d < bd) { bd = d; bi = i; } });
      const L = loop.slice(bi).concat(loop.slice(0, bi));
      const seq = climb ? L : [L[0], ...L.slice(1).reverse()];
      if (pathClear(pos, seq[0])) feedTo(seq[0][0], seq[0][1], z, tool.feed);
      else { P.moveAbove(seq[0][0], seq[0][1]); P.feed(seq[0][0], seq[0][1], z, tool.plunge); }
      for (const [x, y] of seq.slice(1)) feedTo(x, y, z, tool.feed);
      feedTo(seq[0][0], seq[0][1], z, tool.feed);
      pos = seq[0];
    }
  }
  P.retract();
}
