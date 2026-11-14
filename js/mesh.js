// Mesh (STL/OBJ) editing directly on triangles – no conversion to B-rep.
// A mesh is { pos: Float32Array (x,y,z per vertex), idx: Uint32Array (3 per triangle) }.
import * as THREE from 'three';

// Volume, centre of mass and moments of inertia of a closed triangle mesh (density 1): exact integrals over the
// triangles (divergence theorem). I = [Ixx, Iyy, Izz, Ixy, Iyz, Izx] about axes through the centre of mass
// parallel to X, Y, Z; units mm³, mm, mm⁵.
export function meshInertia(geometry) {
  const pos = geometry.attributes.position, idx = geometry.index;
  const nTri = (idx ? idx.count : pos.count) / 3, g = new Float64Array(10);
  const sub = (w0, w1, w2) => {
    const t0 = w0 + w1, f1 = t0 + w2, t1 = w0 * w0, t2 = t1 + w1 * t0, f2 = t2 + w2 * f1, f3 = w0 * t1 + w1 * t2 + w2 * f2;
    return [f1, f2, f3, f2 + w0 * (f1 + w0), f2 + w1 * (f1 + w1), f2 + w2 * (f1 + w2)];
  };
  for (let t = 0; t < nTri; t++) {
    const a = idx ? idx.getX(3 * t) : 3 * t, b = idx ? idx.getX(3 * t + 1) : 3 * t + 1, c = idx ? idx.getX(3 * t + 2) : 3 * t + 2;
    const x0 = pos.getX(a), y0 = pos.getY(a), z0 = pos.getZ(a), x1 = pos.getX(b), y1 = pos.getY(b), z1 = pos.getZ(b), x2 = pos.getX(c), y2 = pos.getY(c), z2 = pos.getZ(c);
    const a1 = x1 - x0, b1 = y1 - y0, c1 = z1 - z0, a2 = x2 - x0, b2 = y2 - y0, c2 = z2 - z0;
    const d0 = b1 * c2 - b2 * c1, d1 = a2 * c1 - a1 * c2, d2 = a1 * b2 - a2 * b1;
    const X = sub(x0, x1, x2), Y = sub(y0, y1, y2), Z = sub(z0, z1, z2);
    g[0] += d0 * X[0];
    g[1] += d0 * X[1]; g[2] += d1 * Y[1]; g[3] += d2 * Z[1];
    g[4] += d0 * X[2]; g[5] += d1 * Y[2]; g[6] += d2 * Z[2];
    g[7] += d0 * (y0 * X[3] + y1 * X[4] + y2 * X[5]);
    g[8] += d1 * (z0 * Y[3] + z1 * Y[4] + z2 * Y[5]);
    g[9] += d2 * (x0 * Z[3] + x1 * Z[4] + x2 * Z[5]);
  }
  const mult = [1 / 6, 1 / 24, 1 / 24, 1 / 24, 1 / 60, 1 / 60, 1 / 60, 1 / 120, 1 / 120, 1 / 120];
  for (let i = 0; i < 10; i++) g[i] *= mult[i];
  const vol = g[0];
  if (!(Math.abs(vol) > 1e-12)) return null;
  const cx = g[1] / vol, cy = g[2] / vol, cz = g[3] / vol;
  const s = Math.sign(vol);
  return {
    volume: Math.abs(vol), com: [cx, cy, cz],
    I: [s * (g[5] + g[6] - vol * (cy * cy + cz * cz)), s * (g[4] + g[6] - vol * (cz * cz + cx * cx)), s * (g[4] + g[5] - vol * (cx * cx + cy * cy)),
      -s * (g[7] - vol * cx * cy), -s * (g[8] - vol * cy * cz), -s * (g[9] - vol * cz * cx)],
  };
}

// ---------- reading ----------
export function parseSTL(buf) {
  const dv = new DataView(buf);
  const n = buf.byteLength >= 84 ? dv.getUint32(80, true) : 0;
  const binary = buf.byteLength === 84 + n * 50;
  if (binary) {
    const pos = new Float32Array(n * 9);
    for (let i = 0; i < n; i++) {
      const o = 84 + i * 50 + 12;
      for (let k = 0; k < 9; k++) pos[i * 9 + k] = dv.getFloat32(o + k * 4, true);
    }
    return pos;
  }
  const text = new TextDecoder().decode(buf);
  const out = [];
  const re = /vertex\s+([-+\d.eE]+)\s+([-+\d.eE]+)\s+([-+\d.eE]+)/g;
  let m;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  if (!out.length) throw new Error('Keine Dreiecke in der STL-Datei gefunden');
  return new Float32Array(out.slice(0, out.length - (out.length % 9)));
}

export function parseOBJ(text) {
  const v = [], out = [];
  for (const line of text.split('\n')) {
    const t = line.trim().split(/\s+/);
    if (t[0] === 'v') v.push([+t[1], +t[2], +t[3]]);
    else if (t[0] === 'f') {
      const ids = t.slice(1).map(s => { const i = parseInt(s, 10); return i < 0 ? v.length + i : i - 1; });
      for (let k = 1; k < ids.length - 1; k++) for (const i of [ids[0], ids[k], ids[k + 1]]) out.push(...v[i]);
    }
  }
  if (!out.length) throw new Error('Keine Flächen in der OBJ-Datei gefunden');
  return new Float32Array(out);
}

// triangle soup -> shared vertices (tolerance in mm)
export function weld(tri, tol = 1e-4) {
  const map = new Map(), pos = [], idx = new Uint32Array(tri.length / 3);
  const q = 1 / tol;
  for (let i = 0; i < tri.length / 3; i++) {
    const x = tri[i * 3], y = tri[i * 3 + 1], z = tri[i * 3 + 2];
    const key = `${Math.round(x * q)},${Math.round(y * q)},${Math.round(z * q)}`;
    let j = map.get(key);
    if (j === undefined) { j = pos.length / 3; map.set(key, j); pos.push(x, y, z); }
    idx[i] = j;
  }
  return cleanTris({ pos: new Float32Array(pos), idx });
}

// drop degenerate and duplicate triangles, unused vertices
export function cleanTris(m) {
  const seen = new Set(), out = [];
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = m.idx[t], b = m.idx[t + 1], c = m.idx[t + 2];
    if (a === b || b === c || a === c) continue;
    const k = [a, b, c].sort((x, y) => x - y).join(',');
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(a, b, c);
  }
  return compact({ pos: m.pos, idx: Uint32Array.from(out) });
}

function compact(m) {
  const remap = new Int32Array(m.pos.length / 3).fill(-1), pos = [];
  const idx = new Uint32Array(m.idx.length);
  for (let i = 0; i < m.idx.length; i++) {
    const v = m.idx[i];
    if (remap[v] < 0) { remap[v] = pos.length / 3; pos.push(m.pos[v * 3], m.pos[v * 3 + 1], m.pos[v * 3 + 2]); }
    idx[i] = remap[v];
  }
  return { pos: new Float32Array(pos), idx };
}

// ---------- storage (compact base64 instead of the original file) ----------
const toB64 = u8 => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
const fromB64 = s => { const b = atob(s), u8 = new Uint8Array(b.length); for (let i = 0; i < b.length; i++) u8[i] = b.charCodeAt(i); return u8; };
export function encodeMesh(m) {
  return `OFMESH1:${m.pos.length / 3}:${m.idx.length / 3}:${toB64(new Uint8Array(m.pos.buffer, m.pos.byteOffset, m.pos.byteLength))}:${toB64(new Uint8Array(m.idx.buffer, m.idx.byteOffset, m.idx.byteLength))}`;
}
export function decodeMesh(text) {
  const [tag, , , a, b] = String(text).split(':');
  if (tag !== 'OFMESH1') throw new Error('Netzdaten fehlen oder sind beschädigt');
  return { pos: new Float32Array(fromB64(a).buffer), idx: new Uint32Array(fromB64(b).buffer) };
}

export const cloneMesh = m => ({ pos: m.pos.slice(), idx: m.idx.slice() });

// ---------- geometry helpers ----------
export function bounds(m) {
  const b = new THREE.Box3();
  for (let i = 0; i < m.pos.length; i += 3) b.expandByPoint(new THREE.Vector3(m.pos[i], m.pos[i + 1], m.pos[i + 2]));
  return b;
}

export function toGeometry(m) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(m.pos, 3));
  g.setIndex(new THREE.BufferAttribute(m.idx, 1));
  g.computeVertexNormals();
  g.computeBoundingBox();
  return g;
}

const edgeKey = (a, b) => (a < b ? a * 4294967296 + b : b * 4294967296 + a);

// edges with their use count, open (boundary) edges, shells
export function stats(m) {
  const P = m.pos, I = m.idx;
  let area = 0, vol = 0;
  const v = (i, o) => P[I[i] * 3 + o];
  for (let t = 0; t < I.length; t += 3) {
    const ax = v(t, 0), ay = v(t, 1), az = v(t, 2), bx = v(t + 1, 0), by = v(t + 1, 1), bz = v(t + 1, 2), cx = v(t + 2, 0), cy = v(t + 2, 1), cz = v(t + 2, 2);
    const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
    const nx = uy * wz - uz * wy, ny = uz * wx - ux * wz, nz = ux * wy - uy * wx;
    area += Math.hypot(nx, ny, nz) / 2;
    vol += (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
  }
  const count = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const e = edgeKey(I[t + k], I[t + (k + 1) % 3]); count.set(e, (count.get(e) || 0) + 1); }
  let open = 0, nonManifold = 0;
  for (const c of count.values()) { if (c === 1) open++; else if (c > 2) nonManifold++; }
  const box = bounds(m);
  return { tris: I.length / 3, verts: P.length / 3, area, volume: vol, open, nonManifold, shells: shells(m).length, closed: open === 0 && nonManifold === 0, box };
}

// open edges as line segments (for display)
export function openEdgeLines(m) {
  const I = m.idx, count = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; const e = edgeKey(a, b); const c = count.get(e); count.set(e, c ? [c[0] + 1, a, b] : [1, a, b]); }
  const out = [];
  for (const [n, a, b] of count.values()) if (n === 1) out.push(m.pos[a * 3], m.pos[a * 3 + 1], m.pos[a * 3 + 2], m.pos[b * 3], m.pos[b * 3 + 1], m.pos[b * 3 + 2]);
  return new Float32Array(out);
}

function shells(m) {
  const parent = new Int32Array(m.pos.length / 3).map((_, i) => i);
  const find = x => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (let t = 0; t < m.idx.length; t += 3) {
    const a = find(m.idx[t]); parent[find(m.idx[t + 1])] = a; parent[find(m.idx[t + 2])] = a;
  }
  const groups = new Map();
  for (let t = 0; t < m.idx.length; t += 3) { const r = find(m.idx[t]); (groups.get(r) || groups.set(r, []).get(r)).push(t); }
  return [...groups.values()];
}

// ---------- operations ----------
export function transform(m, { dx = 0, dy = 0, dz = 0, rx = 0, ry = 0, rz = 0, scale = 1 } = {}) {
  const c = bounds(m).getCenter(new THREE.Vector3());
  const M = new THREE.Matrix4().makeTranslation(c.x + +dx, c.y + +dy, c.z + +dz)
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(+rx * Math.PI / 180, +ry * Math.PI / 180, +rz * Math.PI / 180)))
    .multiply(new THREE.Matrix4().makeScale(+scale || 1, +scale || 1, +scale || 1))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -c.y, -c.z));
  return applyMatrix(m, M);
}

export function applyMatrix(m, M) {
  const pos = m.pos.slice(), v = new THREE.Vector3();
  for (let i = 0; i < pos.length; i += 3) { v.set(pos[i], pos[i + 1], pos[i + 2]).applyMatrix4(M); pos[i] = v.x; pos[i + 1] = v.y; pos[i + 2] = v.z; }
  const out = { pos, idx: m.idx.slice() };
  return M.determinant() < 0 ? flip(out) : out;
}

export function flip(m) {
  const idx = m.idx.slice();
  for (let t = 0; t < idx.length; t += 3) { const x = idx[t + 1]; idx[t + 1] = idx[t + 2]; idx[t + 2] = x; }
  return { pos: m.pos, idx };
}

// consistent triangle orientation over each shell, outward for closed shells
export function orient(m) {
  const I = m.idx.slice(), nT = I.length / 3;
  const edgeTris = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const e = edgeKey(I[t * 3 + k], I[t * 3 + (k + 1) % 3]); (edgeTris.get(e) || edgeTris.set(e, []).get(e)).push(t); }
  const done = new Uint8Array(nT);
  const has = (t, a, b) => { for (let k = 0; k < 3; k++) if (I[t * 3 + k] === a && I[t * 3 + (k + 1) % 3] === b) return true; return false; };
  for (let s = 0; s < nT; s++) {
    if (done[s]) continue;
    done[s] = 1;
    const stack = [s], shell = [s];
    while (stack.length) {
      const t = stack.pop();
      for (let k = 0; k < 3; k++) {
        const a = I[t * 3 + k], b = I[t * 3 + (k + 1) % 3];
        for (const u of edgeTris.get(edgeKey(a, b)) || []) {
          if (done[u]) continue;
          // the neighbour must use the shared edge in the opposite direction
          if (has(u, a, b)) { const x = I[u * 3 + 1]; I[u * 3 + 1] = I[u * 3 + 2]; I[u * 3 + 2] = x; }
          done[u] = 1;
          stack.push(u);
          shell.push(u);
        }
      }
    }
    let vol = 0;
    for (const t of shell) {
      const [a, b, c] = [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]].map(i => [m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]]);
      vol += a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0]);
    }
    if (vol < 0) for (const t of shell) { const x = I[t * 3 + 1]; I[t * 3 + 1] = I[t * 3 + 2]; I[t * 3 + 2] = x; }
  }
  return { pos: m.pos, idx: I };
}

// boundary loops (vertex lists following the open edges as the triangles use them)
function boundaryLoops(m) {
  const I = m.idx, count = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const e = edgeKey(I[t + k], I[t + (k + 1) % 3]); count.set(e, (count.get(e) || 0) + 1); }
  const next = new Map();
  for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = I[t + k], b = I[t + (k + 1) % 3];
    if (count.get(edgeKey(a, b)) === 1) next.set(a, b);
  }
  const loops = [], used = new Set();
  for (const s of next.keys()) {
    if (used.has(s)) continue;
    const loop = [];
    let v = s;
    for (let g = 0; g < 1e6 && v !== undefined && !used.has(v); g++) { used.add(v); loop.push(v); v = next.get(v); }
    if (loop.length >= 3 && v === s) loops.push(loop);
  }
  return loops;
}

// close holes: triangulate each boundary loop in its best-fit plane
export function fillHoles(m, onlyIf = null) {
  const loops = boundaryLoops(m).filter(l => !onlyIf || onlyIf(l));
  if (!loops.length) return m;
  const add = [];
  for (const loop of loops) {
    const pts = loop.map(i => new THREE.Vector3(m.pos[i * 3], m.pos[i * 3 + 1], m.pos[i * 3 + 2]));
    const n = new THREE.Vector3();
    for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; n.x += (a.y - b.y) * (a.z + b.z); n.y += (a.z - b.z) * (a.x + b.x); n.z += (a.x - b.x) * (a.y + b.y); }
    if (n.lengthSq() < 1e-20) continue;
    n.normalize();
    const u = new THREE.Vector3(Math.abs(n.x) < 0.9 ? 1 : 0, Math.abs(n.x) < 0.9 ? 0 : 1, 0).addScaledVector(n, -(Math.abs(n.x) < 0.9 ? n.x : n.y)).normalize();
    const w = new THREE.Vector3().crossVectors(n, u);
    const p2 = pts.map(p => new THREE.Vector2(p.dot(u), p.dot(w)));
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(p2, []); } catch { tris = []; }
    if (!tris.length) for (let k = 1; k < loop.length - 1; k++) tris.push([0, k, k + 1]);
    // the cap must run against the loop direction
    for (const [a, b, c] of tris) add.push(loop[a], loop[c], loop[b]);
  }
  const idx = new Uint32Array(m.idx.length + add.length);
  idx.set(m.idx);
  idx.set(add, m.idx.length);
  return { pos: m.pos, idx };
}

export function repair(m, { tol = 0.001, holes = true, orientation = true } = {}) {
  const tri = new Float32Array(m.idx.length * 3);
  for (let i = 0; i < m.idx.length; i++) for (let k = 0; k < 3; k++) tri[i * 3 + k] = m.pos[m.idx[i] * 3 + k];
  let out = weld(tri, Math.max(1e-6, +tol || 0.001));
  if (orientation) out = orient(out);
  if (holes) out = orient(fillHoles(out));
  return out;
}

// caps of a plane cut: the open loops lying in the plane are closed, a loop inside another one stays a hole
// (a cut tube gets a ring, not a disc). nsign: the side of the axis the caps look to.
function capPlane(m, ax, offset, nsign) {
  const a1 = (ax + 1) % 3, a2 = (ax + 2) % 3, P = m.pos;
  const loops = boundaryLoops(m).filter(l => l.every(i => Math.abs(P[i * 3 + ax] - offset) < 1e-4)).map(l => ({ l, p: l.map(i => new THREE.Vector2(P[i * 3 + a1], P[i * 3 + a2])) }));
  if (!loops.length) return m;
  const inside = (q, poly) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const a = poly[i], b = poly[j]; if ((a.y > q.y) !== (b.y > q.y) && q.x < ((b.x - a.x) * (q.y - a.y)) / (b.y - a.y) + a.x) c = !c; } return c; };
  if (loops.length > 1) for (const L of loops) L.depth = loops.reduce((n, O) => n + (O !== L && inside(L.p[0], O.p) ? 1 : 0), 0);
  const add = [];
  for (const L of loops) {
    if ((L.depth || 0) % 2) continue;
    const holes = loops.length > 1 ? loops.filter(H => H.depth === L.depth + 1 && inside(H.p[0], L.p)) : [];
    const all = [L, ...holes].flatMap(x => x.l), pts = [L, ...holes].flatMap(x => x.p);
    let tris;
    try { tris = THREE.ShapeUtils.triangulateShape(L.p.slice(), holes.map(H => H.p.slice())); } catch { tris = []; }
    if (!tris.length) { tris = []; for (let k = 1; k < L.l.length - 1; k++) tris.push([0, k, k + 1]); }
    for (const [a, b, c] of tris) {
      const cr = (pts[b].x - pts[a].x) * (pts[c].y - pts[a].y) - (pts[b].y - pts[a].y) * (pts[c].x - pts[a].x);
      if (cr * nsign >= 0) add.push(all[a], all[b], all[c]); else add.push(all[a], all[c], all[b]);
    }
  }
  const idx = new Uint32Array(m.idx.length + add.length);
  idx.set(m.idx);
  idx.set(add, m.idx.length);
  return { pos: m.pos, idx };
}

// plane cut: keep one side ('pos' / 'neg'), or both as separate meshes; caps close the cut
export function cutPlane(m, axis = 'z', offset = 0, keep = 'pos', cap = true) {
  const ax = { x: 0, y: 1, z: 2 }[axis] ?? 2;
  const side = sgn => {
    const P = m.pos, pos = Array.from(P), idx = [], mid = new Map();
    const d = i => (P[i * 3 + ax] - offset) * sgn;
    const cut = (a, b) => {
      const k = edgeKey(a, b);
      if (mid.has(k)) return mid.get(k);
      const da = d(a), db = d(b), t = da / (da - db);
      const j = pos.length / 3;
      for (let o = 0; o < 3; o++) pos.push(P[a * 3 + o] + (P[b * 3 + o] - P[a * 3 + o]) * t);
      pos[j * 3 + ax] = offset;
      mid.set(k, j);
      return j;
    };
    for (let t = 0; t < m.idx.length; t += 3) {
      const v = [m.idx[t], m.idx[t + 1], m.idx[t + 2]];
      const ds = v.map(d);
      const inside = ds.map(x => x >= -1e-9);
      const n = inside.filter(Boolean).length;
      if (n === 3) { idx.push(...v); continue; }
      if (n === 0) continue;
      // clip the triangle against the plane (keeps the winding)
      const poly = [];
      for (let k = 0; k < 3; k++) {
        const a = v[k], b = v[(k + 1) % 3], ia = inside[k], ib = inside[(k + 1) % 3];
        if (ia) poly.push(a);
        if (ia !== ib && Math.abs(ds[k]) > 1e-9 && Math.abs(ds[(k + 1) % 3]) > 1e-9) poly.push(cut(a, b));
      }
      for (let k = 1; k < poly.length - 1; k++) idx.push(poly[0], poly[k], poly[k + 1]);
    }
    let out = compact({ pos: new Float32Array(pos), idx: Uint32Array.from(idx) });
    out = cleanTris(out);
    if (cap) out = capPlane(out, ax, offset, -sgn);
    return out;
  };
  if (keep === 'both') return [side(1), side(-1)];
  return side(keep === 'neg' ? -1 : 1);
}

// reduce the triangle count by edge collapses with quadric error metrics
// (keeps closed meshes closed: link condition, no flipped triangles, open borders fixed)
export function decimate(m, ratio = 0.5) {
  const nV = m.pos.length / 3, nT = m.idx.length / 3;
  const target = Math.max(4, Math.round(nT * Math.min(1, Math.max(0.01, +ratio))));
  if (target >= nT) return cloneMesh(m);
  const P = Float64Array.from(m.pos), T = Int32Array.from(m.idx), alive = new Uint8Array(nT).fill(1);
  const vt = Array.from({ length: nV }, () => []);
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) vt[T[t * 3 + k]].push(t);
  // quadric per vertex (symmetric 4x4 as 10 numbers)
  const Q = new Float64Array(nV * 10);
  const addPlane = (v, a, b, c, d) => { const q = v * 10; Q[q] += a * a; Q[q + 1] += a * b; Q[q + 2] += a * c; Q[q + 3] += a * d; Q[q + 4] += b * b; Q[q + 5] += b * c; Q[q + 6] += b * d; Q[q + 7] += c * c; Q[q + 8] += c * d; Q[q + 9] += d * d; };
  const normal = (a, b, c, out) => {
    const ux = P[b * 3] - P[a * 3], uy = P[b * 3 + 1] - P[a * 3 + 1], uz = P[b * 3 + 2] - P[a * 3 + 2];
    const wx = P[c * 3] - P[a * 3], wy = P[c * 3 + 1] - P[a * 3 + 1], wz = P[c * 3 + 2] - P[a * 3 + 2];
    out[0] = uy * wz - uz * wy; out[1] = uz * wx - ux * wz; out[2] = ux * wy - uy * wx;
    return Math.hypot(out[0], out[1], out[2]);
  };
  const n0 = [0, 0, 0];
  for (let t = 0; t < nT; t++) {
    const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
    const L = normal(a, b, c, n0);
    if (L < 1e-15) continue;
    const nx = n0[0] / L, ny = n0[1] / L, nz = n0[2] / L, d = -(nx * P[a * 3] + ny * P[a * 3 + 1] + nz * P[a * 3 + 2]);
    for (const v of [a, b, c]) addPlane(v, nx, ny, nz, d);
  }
  // vertices on open borders stay where they are
  const ecount = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const e = edgeKey(T[t * 3 + k], T[t * 3 + (k + 1) % 3]); ecount.set(e, (ecount.get(e) || 0) + 1); }
  const border = new Uint8Array(nV);
  for (const [e, c] of ecount) if (c !== 2) { border[Math.floor(e / 4294967296)] = 1; border[e % 4294967296] = 1; }
  const err = (q1, q2, x, y, z) => {
    const a = q1 * 10, b = q2 * 10, g = i => Q[a + i] + Q[b + i];
    return g(0) * x * x + 2 * g(1) * x * y + 2 * g(2) * x * z + 2 * g(3) * x + g(4) * y * y + 2 * g(5) * y * z + 2 * g(6) * y + g(7) * z * z + 2 * g(8) * z + g(9);
  };
  const stamp = new Uint32Array(nV);
  // binary heap of [cost, u, v, stampU, stampV, x, y, z]
  const heap = [];
  const push = it => { heap.push(it); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= it[0]) break; heap[i] = heap[p]; i = p; } heap[i] = it; };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let s = i; if (l < heap.length && heap[l][0] < (s === i ? last[0] : heap[s][0])) s = l; if (r < heap.length && heap[r][0] < (s === i ? last[0] : heap[s][0])) s = r; if (s === i) break; heap[i] = heap[s]; i = s; } heap[i] = last; } return top; };
  const consider = (u, v) => {
    if (border[u] || border[v]) return;
    const cands = [[(P[u * 3] + P[v * 3]) / 2, (P[u * 3 + 1] + P[v * 3 + 1]) / 2, (P[u * 3 + 2] + P[v * 3 + 2]) / 2], [P[u * 3], P[u * 3 + 1], P[u * 3 + 2]], [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]];
    let best = null, bc = Infinity;
    for (const c of cands) { const e = err(u, v, c[0], c[1], c[2]); if (e < bc) { bc = e; best = c; } }
    push([Math.max(0, bc), u, v, stamp[u], stamp[v], best[0], best[1], best[2]]);
  };
  for (const e of ecount.keys()) consider(Math.floor(e / 4294967296), e % 4294967296);
  const nbrs = v => { const s = new Set(); for (const t of vt[v]) if (alive[t]) for (let k = 0; k < 3; k++) { const w = T[t * 3 + k]; if (w !== v) s.add(w); } return s; };
  let count = nT;
  const na = [0, 0, 0], nb = [0, 0, 0];
  while (count > target && heap.length) {
    const [, u, v, su, sv, x, y, z] = pop();
    if (su !== stamp[u] || sv !== stamp[v]) continue;
    // link condition: shared neighbours = triangles on the edge
    const shared = vt[u].filter(t => alive[t] && (T[t * 3] === v || T[t * 3 + 1] === v || T[t * 3 + 2] === v));
    if (!shared.length) continue;
    const Nu = nbrs(u), Nv = nbrs(v);
    let common = 0;
    for (const w of Nu) if (Nv.has(w)) common++;
    if (common !== shared.length) continue;
    // no triangle may flip or collapse when u and v move to (x, y, z)
    let ok = true;
    for (const w of [u, v]) {
      for (const t of vt[w]) {
        if (!alive[t] || shared.includes(t)) continue;
        const a = T[t * 3], b = T[t * 3 + 1], c = T[t * 3 + 2];
        const before = normal(a, b, c, na);
        const ox = P[w * 3], oy = P[w * 3 + 1], oz = P[w * 3 + 2];
        P[w * 3] = x; P[w * 3 + 1] = y; P[w * 3 + 2] = z;
        const after = normal(a, b, c, nb);
        P[w * 3] = ox; P[w * 3 + 1] = oy; P[w * 3 + 2] = oz;
        if (after < 1e-12 || (na[0] * nb[0] + na[1] * nb[1] + na[2] * nb[2]) < 0.2 * before * after) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (!ok) continue;
    // collapse u into v
    P[v * 3] = x; P[v * 3 + 1] = y; P[v * 3 + 2] = z;
    for (let i = 0; i < 10; i++) Q[v * 10 + i] += Q[u * 10 + i];
    for (const t of shared) { alive[t] = 0; count--; }
    for (const t of vt[u]) {
      if (!alive[t]) continue;
      for (let k = 0; k < 3; k++) if (T[t * 3 + k] === u) T[t * 3 + k] = v;
      vt[v].push(t);
    }
    vt[u] = [];
    stamp[u]++; stamp[v]++;
    // only the edges at v changed (their quadric or position)
    for (const w of nbrs(v)) consider(v, w);
  }
  const idx = [];
  for (let t = 0; t < nT; t++) if (alive[t]) idx.push(T[t * 3], T[t * 3 + 1], T[t * 3 + 2]);
  return compact({ pos: Float32Array.from(P), idx: Uint32Array.from(idx) });
}

// Taubin smoothing (no shrinking); open boundaries stay in place
export function smooth(m, iterations = 5, strength = 0.5) {
  const n = m.pos.length / 3, nb = Array.from({ length: n }, () => new Set());
  const count = new Map();
  for (let t = 0; t < m.idx.length; t += 3) for (let k = 0; k < 3; k++) {
    const a = m.idx[t + k], b = m.idx[t + (k + 1) % 3];
    nb[a].add(b); nb[b].add(a);
    const e = edgeKey(a, b); count.set(e, (count.get(e) || 0) + 1);
  }
  const fixed = new Uint8Array(n);
  for (const [e, c] of count) if (c === 1) { fixed[Math.floor(e / 4294967296)] = 1; fixed[e % 4294967296] = 1; }
  let pos = m.pos.slice();
  const step = f => {
    const next = pos.slice();
    for (let i = 0; i < n; i++) {
      if (fixed[i] || !nb[i].size) continue;
      let x = 0, y = 0, z = 0;
      for (const j of nb[i]) { x += pos[j * 3]; y += pos[j * 3 + 1]; z += pos[j * 3 + 2]; }
      const k = nb[i].size;
      next[i * 3] += f * (x / k - pos[i * 3]); next[i * 3 + 1] += f * (y / k - pos[i * 3 + 1]); next[i * 3 + 2] += f * (z / k - pos[i * 3 + 2]);
    }
    pos = next;
  };
  const lam = Math.min(0.95, Math.max(0.05, +strength || 0.5)), mu = -(lam + 0.03);
  for (let i = 0; i < Math.max(1, Math.round(iterations)); i++) { step(lam); step(mu); }
  return { pos, idx: m.idx.slice() };
}

// connected pieces as separate meshes
export function split(m) {
  return shells(m).map(ts => {
    const idx = new Uint32Array(ts.length * 3);
    ts.forEach((t, i) => { idx[i * 3] = m.idx[t]; idx[i * 3 + 1] = m.idx[t + 1]; idx[i * 3 + 2] = m.idx[t + 2]; });
    return compact({ pos: m.pos, idx });
  }).sort((a, b) => b.idx.length - a.idx.length);
}

// ---------- more operations: mirror, combine, refine, section ----------
const AX = { x: 0, y: 1, z: 2 };

// several meshes as one (vertices are not merged: "Reparieren" welds touching parts)
export function combine(list) {
  const nv = list.reduce((a, m) => a + m.pos.length, 0), ni = list.reduce((a, m) => a + m.idx.length, 0);
  const pos = new Float32Array(nv), idx = new Uint32Array(ni);
  let pv = 0, pi = 0;
  for (const m of list) {
    pos.set(m.pos, pv);
    for (let i = 0; i < m.idx.length; i++) idx[pi + i] = m.idx[i] + pv / 3;
    pv += m.pos.length; pi += m.idx.length;
  }
  return { pos, idx };
}

// mirror at a plane perpendicular to an axis; keep = the original stays, joined with its mirror image (points on
// the plane are welded, so a half becomes one closed part)
export function mirror(m, axis = 'x', offset = 0, keep = false) {
  const ax = AX[axis] ?? 0, pos = m.pos.slice();
  for (let i = ax; i < pos.length; i += 3) pos[i] = 2 * offset - pos[i];
  const mir = flip({ pos, idx: m.idx.slice() });
  if (!keep) return mir;
  // triangles lying in the mirror plane (the cap of a cut half) would become a wall inside the part: left out
  const all = combine([m, mir]), tri = [];
  for (let t = 0; t < all.idx.length; t += 3) {
    const v = [all.idx[t], all.idx[t + 1], all.idx[t + 2]];
    if (v.every(i => Math.abs(all.pos[i * 3 + ax] - offset) < 1e-5)) continue;
    for (const i of v) tri.push(all.pos[i * 3], all.pos[i * 3 + 1], all.pos[i * 3 + 2]);
  }
  return weld(new Float32Array(tri), 1e-4);
}

/**
 * Refine: split edges at their middle. maxEdge > 0: only edges longer than that (the mesh stays closed: a
 * triangle is split to fit the edges that were split); maxEdge = 0: every edge (each triangle becomes four).
 * levels = number of passes. The shape does not change.
 */
export function subdivide(m, maxEdge = 0, levels = 1, limit = 3e6) {
  let pos = Array.from(m.pos), idx = Array.from(m.idx);
  const L2 = maxEdge > 0 ? maxEdge * maxEdge : 0;
  for (let pass = 0; pass < Math.max(1, Math.min(8, Math.round(levels))); pass++) {
    const mid = new Map(), out = [];
    const long = (a, b) => { if (!L2) return true; const dx = pos[a * 3] - pos[b * 3], dy = pos[a * 3 + 1] - pos[b * 3 + 1], dz = pos[a * 3 + 2] - pos[b * 3 + 2]; return dx * dx + dy * dy + dz * dz > L2; };
    const mp = (a, b) => {
      const k = edgeKey(a, b);
      let j = mid.get(k);
      if (j === undefined) { j = pos.length / 3; pos.push((pos[a * 3] + pos[b * 3]) / 2, (pos[a * 3 + 1] + pos[b * 3 + 1]) / 2, (pos[a * 3 + 2] + pos[b * 3 + 2]) / 2); mid.set(k, j); }
      return j;
    };
    for (let t = 0; t < idx.length; t += 3) {
      const v = [idx[t], idx[t + 1], idx[t + 2]], s = [long(v[0], v[1]), long(v[1], v[2]), long(v[2], v[0])], n = s[0] + s[1] + s[2];
      if (!n) { out.push(...v); continue; }
      if (n === 3) {
        const a = mp(v[0], v[1]), b = mp(v[1], v[2]), c = mp(v[2], v[0]);
        out.push(v[0], a, c, a, v[1], b, c, b, v[2], a, b, c);
        continue;
      }
      // turn the triangle so the (first) split edge is 0–1
      const r = n === 1 ? s.indexOf(true) : s.indexOf(false) === 2 ? 0 : s.indexOf(false) === 0 ? 1 : 2;
      const p = v[r], q = v[(r + 1) % 3], w = v[(r + 2) % 3], a = mp(p, q);
      if (n === 1) out.push(p, a, w, a, q, w);
      else { const b = mp(q, w); out.push(p, a, w, a, b, w, a, q, b); }
    }
    if (out.length === idx.length) break;
    if (out.length / 3 > limit) throw new Error('Zu viele Dreiecke – größere Kantenlänge oder weniger Durchgänge wählen');
    idx = out;
  }
  return { pos: new Float32Array(pos), idx: Uint32Array.from(idx) };
}

/**
 * Cross-section with a plane perpendicular to an axis: loops of 2D points in the plane ([x, y] for a Z plane,
 * [y, z] for an X plane, [z, x] for a Y plane) with closed = the loop comes back to its start.
 */
export function sectionLoops(m, axis = 'z', offset = 0, tol = 1e-4) {
  const ax = AX[axis] ?? 2, u = (ax + 1) % 3, w = (ax + 2) % 3, P = m.pos;
  // a point exactly on the plane counts as above it, so every triangle is cut 0 or 2 times
  const d = i => { const x = P[i * 3 + ax] - offset; return x === 0 ? 1e-9 : x; };
  const pts = [], ids = new Map(), next = new Map(), prev = new Map();
  const cut = (a, b) => {
    const k = edgeKey(a, b);
    let j = ids.get(k);
    if (j === undefined) { const da = d(a), db = d(b), s = da / (da - db); j = pts.length; pts.push([P[a * 3 + u] + (P[b * 3 + u] - P[a * 3 + u]) * s, P[a * 3 + w] + (P[b * 3 + w] - P[a * 3 + w]) * s]); ids.set(k, j); }
    return j;
  };
  for (let t = 0; t < m.idx.length; t += 3) {
    const v = [m.idx[t], m.idx[t + 1], m.idx[t + 2]], up = v.map(i => d(i) > 0), n = up[0] + up[1] + up[2];
    if (n === 0 || n === 3) continue;
    // the edge leaving the upper side and the edge coming back: with the material on the left of a → b
    let a = -1, b = -1;
    for (let k = 0; k < 3; k++) { const p = v[k], q = v[(k + 1) % 3]; if (up[k] && !up[(k + 1) % 3]) a = cut(p, q); else if (!up[k] && up[(k + 1) % 3]) b = cut(p, q); }
    if (a < 0 || b < 0 || a === b) continue;
    next.set(a, b); prev.set(b, a);
  }
  const used = new Set(), loops = [];
  const simplify = (L, closed) => {
    const out = [];
    for (let i = 0; i < L.length; i++) {
      const p = L[i], a = out[out.length - 1], q = L[(i + 1) % L.length];
      if (a && Math.hypot(p[0] - a[0], p[1] - a[1]) < tol) continue;
      if (a && (closed || i < L.length - 1)) { const cr = (p[0] - a[0]) * (q[1] - a[1]) - (p[1] - a[1]) * (q[0] - a[0]), l = Math.hypot(q[0] - a[0], q[1] - a[1]); if (l > tol && Math.abs(cr) / l < tol && (p[0] - a[0]) * (q[0] - p[0]) + (p[1] - a[1]) * (q[1] - p[1]) >= 0) continue; }
      out.push(p);
    }
    while (closed && out.length > 3 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < tol) out.pop();
    // the start of a closed loop may lie in the middle of a straight side
    for (let g = 0; closed && out.length > 3 && g < 2; g++) {
      const a = out[out.length - 1], p = out[0], q = out[1], cr = (p[0] - a[0]) * (q[1] - a[1]) - (p[1] - a[1]) * (q[0] - a[0]), l = Math.hypot(q[0] - a[0], q[1] - a[1]);
      if (l > tol && Math.abs(cr) / l < tol && (p[0] - a[0]) * (q[0] - p[0]) + (p[1] - a[1]) * (q[1] - p[1]) >= 0) out.shift(); else break;
    }
    return out;
  };
  for (const s of next.keys()) {
    if (used.has(s)) continue;
    // an open chain starts where nothing leads to it
    let st = s;
    for (let g = 0; g < 1e7 && prev.has(st) && prev.get(st) !== s; g++) st = prev.get(st);
    if (prev.has(st) && prev.get(st) === s) st = s;
    const L = [];
    let v = st, closed = false;
    for (let g = 0; g < 1e7 && v !== undefined; g++) { if (used.has(v)) { closed = v === st; break; } used.add(v); L.push(pts[v]); v = next.get(v); }
    const out = simplify(L, closed);
    if (out.length >= (closed ? 3 : 2)) loops.push({ pts: out, closed });
  }
  return loops;
}

// a three.js geometry (a tessellated body) as a mesh with shared points
export function fromGeometry(g, tol = 1e-4) {
  const p = g.attributes.position, ix = g.index, n = ix ? ix.count : p.count, tri = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) { const v = ix ? ix.getX(i) : i; tri[i * 3] = p.getX(v); tri[i * 3 + 1] = p.getY(v); tri[i * 3 + 2] = p.getZ(v); }
  return orient(weld(tri, tol));
}

// ---------- more file formats: OBJ and 3MF out, 3MF and PLY in ----------
const num6 = v => String(+(+v).toFixed(6));

// list = [{ name, mesh }]
export function toOBJ(list) {
  const out = ['# WerkFab', '# Einheit: mm'];
  let base = 1;
  for (const { name, mesh } of list) {
    out.push('o ' + String(name || 'Netz').replace(/\s+/g, '_'));
    for (let i = 0; i < mesh.pos.length; i += 3) out.push(`v ${num6(mesh.pos[i])} ${num6(mesh.pos[i + 1])} ${num6(mesh.pos[i + 2])}`);
    for (let t = 0; t < mesh.idx.length; t += 3) out.push(`f ${mesh.idx[t] + base} ${mesh.idx[t + 1] + base} ${mesh.idx[t + 2] + base}`);
    base += mesh.pos.length / 3;
  }
  return out.join('\n') + '\n';
}

let crcTable = null;
function crc32(u8) {
  if (!crcTable) { crcTable = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; crcTable[n] = c >>> 0; } }
  let c = 0xffffffff;
  for (let i = 0; i < u8.length; i++) c = crcTable[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
// zip archive without compression: files = [[name, Uint8Array]]
export function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = [];
  let off = 0;
  for (const [name, data] of files) {
    const nm = enc.encode(name), crc = crc32(data);
    const head = new DataView(new ArrayBuffer(30));
    head.setUint32(0, 0x04034b50, true); head.setUint16(4, 20, true); head.setUint16(8, 0, true); head.setUint32(10, 0x00210000, true);
    head.setUint32(14, crc, true); head.setUint32(18, data.length, true); head.setUint32(22, data.length, true); head.setUint16(26, nm.length, true);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint32(12, 0x00210000, true);
    cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, nm.length, true); cen.setUint32(42, off, true);
    parts.push(new Uint8Array(head.buffer), nm, data);
    central.push(new Uint8Array(cen.buffer), nm);
    off += 30 + nm.length + data.length;
  }
  const csize = central.reduce((a, p) => a + p.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, csize, true); end.setUint32(16, off, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((a, p) => a + p.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}
// the files of a zip archive: Map name → Uint8Array (stored, or deflated where the runtime can inflate)
export async function unzip(buf) {
  const u8 = new Uint8Array(buf), dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength), dec = new TextDecoder();
  let e = u8.length - 22;
  while (e >= 0 && dv.getUint32(e, true) !== 0x06054b50) e--;
  if (e < 0) throw new Error('Kein ZIP-Archiv');
  const n = dv.getUint16(e + 10, true), out = new Map();
  let p = dv.getUint32(e + 16, true);
  for (let i = 0; i < n && dv.getUint32(p, true) === 0x02014b50; i++) {
    const method = dv.getUint16(p + 10, true), csz = dv.getUint32(p + 20, true), nl = dv.getUint16(p + 28, true), xl = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true), lo = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nl));
    const ds = lo + 30 + dv.getUint16(lo + 26, true) + dv.getUint16(lo + 28, true), raw = u8.subarray(ds, ds + csz);
    if (method === 0) out.set(name, raw);
    else if (method === 8) {
      if (typeof DecompressionStream === 'undefined') throw new Error('Komprimierte Archive kann diese Umgebung nicht lesen');
      out.set(name, new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer()));
    }
    p += 46 + nl + xl + cl;
  }
  return out;
}

// 3MF (the package 3D printers and slicers read): one object per mesh, unit millimetre
export function to3MF(list) {
  const x = ['<?xml version="1.0" encoding="UTF-8"?>', '<model unit="millimeter" xml:lang="de-DE" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">', ' <metadata name="Application">WerkFab</metadata>', ' <resources>'];
  list.forEach(({ name, mesh }, i) => {
    x.push(`  <object id="${i + 1}" type="model" name="${String(name || 'Netz').replace(/[<>&"]/g, '_')}">`, '   <mesh>', '    <vertices>');
    for (let k = 0; k < mesh.pos.length; k += 3) x.push(`     <vertex x="${num6(mesh.pos[k])}" y="${num6(mesh.pos[k + 1])}" z="${num6(mesh.pos[k + 2])}"/>`);
    x.push('    </vertices>', '    <triangles>');
    for (let t = 0; t < mesh.idx.length; t += 3) x.push(`     <triangle v1="${mesh.idx[t]}" v2="${mesh.idx[t + 1]}" v3="${mesh.idx[t + 2]}"/>`);
    x.push('    </triangles>', '   </mesh>', '  </object>');
  });
  x.push(' </resources>', ' <build>', ...list.map((_, i) => `  <item objectid="${i + 1}"/>`), ' </build>', '</model>');
  const enc = new TextEncoder();
  return zipStore([
    ['[Content_Types].xml', enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/></Types>')],
    ['_rels/.rels', enc.encode('<?xml version="1.0" encoding="UTF-8"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>')],
    ['3D/3dmodel.model', enc.encode(x.join('\n'))],
  ]);
}

// all triangles of a 3MF file as a triangle soup in mm. Objects are read where they are defined; placements of
// the build plate (item transform) and of components are applied when they are plain 3×4 matrices.
export async function parse3MF(buf) {
  const files = await unzip(buf);
  const key = [...files.keys()].find(k => /\.model$/i.test(k));
  if (!key) throw new Error('Kein 3D-Modell in der 3MF-Datei');
  const xml = new TextDecoder().decode(files.get(key));
  const unit = { micron: 0.001, millimeter: 1, centimeter: 10, inch: 25.4, foot: 304.8, meter: 1000 }[(/<model[^>]*\bunit="(\w+)"/.exec(xml) || [])[1]] || 1;
  const attr = (s, n) => { const m = new RegExp('\\b' + n + '="([^"]*)"').exec(s); return m ? m[1] : null; };
  const objs = new Map();
  for (const m of xml.matchAll(/<object\b([^>]*)>([\s\S]*?)<\/object>/g)) {
    const body = m[2], v = [], tri = [], comps = [];
    for (const q of body.matchAll(/<vertex\b([^>]*)\/?>/g)) v.push(+attr(q[1], 'x'), +attr(q[1], 'y'), +attr(q[1], 'z'));
    for (const q of body.matchAll(/<triangle\b([^>]*)\/?>/g)) tri.push(+attr(q[1], 'v1'), +attr(q[1], 'v2'), +attr(q[1], 'v3'));
    for (const q of body.matchAll(/<component\b([^>]*)\/?>/g)) comps.push({ id: attr(q[1], 'objectid'), tf: attr(q[1], 'transform') });
    objs.set(attr(m[1], 'id'), { v, tri, comps });
  }
  const out = [];
  const mat = tf => { const a = (tf || '').trim().split(/\s+/).map(Number); return a.length === 12 && a.every(Number.isFinite) ? a : null; };
  const mul = (A, B) => { // B first, then A (row vectors, 3MF order: m00 m01 m02 m10 … m30 m31 m32)
    if (!A) return B; if (!B) return A;
    const r = [];
    for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) r.push(B[i * 3] * A[j] + B[i * 3 + 1] * A[3 + j] + B[i * 3 + 2] * A[6 + j] + (i === 3 ? A[9 + j] : 0));
    return r;
  };
  const emit = (id, M, depth) => {
    const o = objs.get(id);
    if (!o || depth > 8) return;
    for (const i of o.tri) {
      const x = o.v[i * 3], y = o.v[i * 3 + 1], z = o.v[i * 3 + 2];
      if (M) out.push((x * M[0] + y * M[3] + z * M[6] + M[9]) * unit, (x * M[1] + y * M[4] + z * M[7] + M[10]) * unit, (x * M[2] + y * M[5] + z * M[8] + M[11]) * unit);
      else out.push(x * unit, y * unit, z * unit);
    }
    for (const c of o.comps) emit(c.id, mul(M, mat(c.tf)), depth + 1);
  };
  const items = [...xml.matchAll(/<item\b([^>]*)\/?>/g)].map(q => ({ id: attr(q[1], 'objectid'), tf: mat(attr(q[1], 'transform')) }));
  if (items.length) for (const it of items) emit(it.id, it.tf, 0);
  else for (const id of objs.keys()) emit(id, null, 0);
  if (!out.length) throw new Error('Keine Dreiecke in der 3MF-Datei gefunden');
  return new Float32Array(out);
}

// PLY (scanners): ASCII or binary, points with x y z, faces as lists of point numbers
export function parsePLY(buf) {
  const u8 = new Uint8Array(buf);
  let he = -1;
  for (let i = 0; i + 10 < u8.length && i < 65536; i++) if (u8[i] === 101 && u8[i + 1] === 110 && u8[i + 2] === 100 && u8[i + 3] === 95 && u8[i + 9] === 114) { let j = i + 10; while (j < u8.length && u8[j] !== 10) j++; he = j + 1; break; }
  const head = new TextDecoder().decode(u8.subarray(0, Math.max(0, he)));
  if (he < 0 || !/^ply/.test(head)) throw new Error('Keine PLY-Datei');
  const fmt = (/format\s+(\S+)/.exec(head) || [])[1];
  const els = [];
  for (const ln of head.split(/\r?\n/)) {
    const t = ln.trim().split(/\s+/);
    if (t[0] === 'element') els.push({ name: t[1], n: +t[2], props: [] });
    else if (t[0] === 'property' && els.length) els[els.length - 1].props.push(t[1] === 'list' ? { list: true, ct: t[2], it: t[3], name: t[4] } : { type: t[1], name: t[2] });
  }
  const V = [], out = [];
  const face = ids => { for (let k = 1; k < ids.length - 1; k++) for (const i of [ids[0], ids[k], ids[k + 1]]) out.push(V[i * 3], V[i * 3 + 1], V[i * 3 + 2]); };
  if (fmt === 'ascii') {
    const lines = new TextDecoder().decode(u8.subarray(he)).split(/\r?\n/);
    let li = 0;
    for (const el of els) for (let i = 0; i < el.n; i++) {
      const t = (lines[li++] || '').trim().split(/\s+/).map(Number);
      if (el.name === 'vertex') { const ix = el.props.findIndex(p => p.name === 'x'); V.push(t[ix], t[ix + 1], t[ix + 2]); }
      else if (el.name === 'face') face(t.slice(1, 1 + t[0]));
    }
  } else {
    const le = fmt !== 'binary_big_endian', dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const SZ = { char: 1, uchar: 1, int8: 1, uint8: 1, short: 2, ushort: 2, int16: 2, uint16: 2, int: 4, uint: 4, int32: 4, uint32: 4, float: 4, float32: 4, double: 8, float64: 8 };
    const rd = (ty, o) => ({ char: () => dv.getInt8(o), int8: () => dv.getInt8(o), uchar: () => dv.getUint8(o), uint8: () => dv.getUint8(o), short: () => dv.getInt16(o, le), int16: () => dv.getInt16(o, le), ushort: () => dv.getUint16(o, le), uint16: () => dv.getUint16(o, le),
      int: () => dv.getInt32(o, le), int32: () => dv.getInt32(o, le), uint: () => dv.getUint32(o, le), uint32: () => dv.getUint32(o, le), float: () => dv.getFloat32(o, le), float32: () => dv.getFloat32(o, le), double: () => dv.getFloat64(o, le), float64: () => dv.getFloat64(o, le) }[ty] || (() => 0))();
    let o = he;
    for (const el of els) for (let i = 0; i < el.n; i++) {
      const rec = {};
      for (const p of el.props) {
        if (p.list) { const n = rd(p.ct, o); o += SZ[p.ct] || 1; const ids = []; for (let k = 0; k < n; k++) { ids.push(rd(p.it, o)); o += SZ[p.it] || 4; } rec[p.name] = ids; }
        else { rec[p.name] = rd(p.type, o); o += SZ[p.type] || 4; }
      }
      if (el.name === 'vertex') V.push(rec.x, rec.y, rec.z);
      else if (el.name === 'face') face(rec.vertex_indices || rec.vertex_index || []);
    }
  }
  if (!out.length) throw new Error('Keine Flächen in der PLY-Datei gefunden (reine Punktwolken werden nicht vernetzt)');
  return new Float32Array(out);
}

// ---------- boolean of two closed meshes (BSP trees) ----------
const BEPS = 1e-5;
const planeOf = (a, b, c) => {
  const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = c[0] - a[0], vy = c[1] - a[1], vz = c[2] - a[2];
  let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const l = Math.hypot(nx, ny, nz);
  if (l < 1e-12) return null;
  nx /= l; ny /= l; nz /= l;
  return { n: [nx, ny, nz], w: nx * a[0] + ny * a[1] + nz * a[2] };
};
const flipPoly = p => ({ v: p.v.slice().reverse(), pl: { n: [-p.pl.n[0], -p.pl.n[1], -p.pl.n[2]], w: -p.pl.w } });
// split a polygon by a plane into the four lists (coplanar front / back, front, back)
function splitPoly(pl, poly, cf, cb, front, back) {
  const n = pl.n, types = [];
  let type = 0;
  for (const v of poly.v) { const t = n[0] * v[0] + n[1] * v[1] + n[2] * v[2] - pl.w, ty = t < -BEPS ? 2 : t > BEPS ? 1 : 0; type |= ty; types.push(ty); }
  if (type === 0) (n[0] * poly.pl.n[0] + n[1] * poly.pl.n[1] + n[2] * poly.pl.n[2] > 0 ? cf : cb).push(poly);
  else if (type === 1) front.push(poly);
  else if (type === 2) back.push(poly);
  else {
    const f = [], b = [];
    for (let i = 0; i < poly.v.length; i++) {
      const j = (i + 1) % poly.v.length, ti = types[i], tj = types[j], vi = poly.v[i], vj = poly.v[j];
      if (ti !== 2) f.push(vi);
      if (ti !== 1) b.push(vi);
      if ((ti | tj) === 3) {
        const dx = vj[0] - vi[0], dy = vj[1] - vi[1], dz = vj[2] - vi[2];
        const s = (pl.w - (n[0] * vi[0] + n[1] * vi[1] + n[2] * vi[2])) / (n[0] * dx + n[1] * dy + n[2] * dz);
        const v = [vi[0] + dx * s, vi[1] + dy * s, vi[2] + dz * s];
        f.push(v); b.push(v);
      }
    }
    if (f.length >= 3) front.push({ v: f, pl: poly.pl });
    if (b.length >= 3) back.push({ v: b, pl: poly.pl });
  }
}
// all loops instead of recursion: the tree of a convex part is one long chain
const bspNew = () => ({ pl: null, front: null, back: null, polys: [] });
function bspBuild(root, polys) {
  const st = [[root, polys]];
  while (st.length) {
    const [nd, ps] = st.pop();
    if (!ps.length) continue;
    if (!nd.pl) nd.pl = ps[(ps.length / 2) | 0].pl;
    const f = [], b = [];
    for (const p of ps) splitPoly(nd.pl, p, nd.polys, nd.polys, f, b);
    if (f.length) st.push([(nd.front ||= bspNew()), f]);
    if (b.length) st.push([(nd.back ||= bspNew()), b]);
  }
  return root;
}
const bspNodes = root => { const out = [], st = [root]; while (st.length) { const n = st.pop(); out.push(n); if (n.front) st.push(n.front); if (n.back) st.push(n.back); } return out; };
const bspAll = root => { const out = []; for (const n of bspNodes(root)) for (const p of n.polys) out.push(p); return out; };
function bspInvert(root) {
  for (const n of bspNodes(root)) {
    n.polys = n.polys.map(flipPoly);
    if (n.pl) n.pl = { n: [-n.pl.n[0], -n.pl.n[1], -n.pl.n[2]], w: -n.pl.w };
    const t = n.front; n.front = n.back; n.back = t;
  }
}
// the parts of polys that are not inside the solid of the tree
function bspClip(root, polys) {
  if (!root.pl) return polys.slice();
  const out = [], st = [[root, polys]];
  while (st.length) {
    const [nd, ps] = st.pop(), f = [], b = [];
    for (const p of ps) splitPoly(nd.pl, p, f, b, f, b);
    if (nd.front) { if (f.length) st.push([nd.front, f]); } else for (const p of f) out.push(p);
    if (nd.back && b.length) st.push([nd.back, b]);
  }
  return out;
}
const bspClipTo = (a, b) => { for (const n of bspNodes(a)) n.polys = bspClip(b, n.polys); };

/**
 * Boolean of two closed meshes: op = 'union' (a ∪ b), 'cut' (a − b) or 'intersect' (a ∩ b). Both must be closed
 * with the outside outwards. The result is welded and its T-joints (points on a neighbour's edge, which splitting
 * leaves behind) are closed.
 */
export function boolean(a, b, op = 'union', limit = 60000) {
  const none = () => ({ pos: new Float32Array(0), idx: new Uint32Array(0) });
  if (!a.idx.length || !b.idx.length) return op === 'union' ? (a.idx.length ? a : b) : op === 'cut' ? a : none();
  // Only where the two meshes can meet – in the box both reach into – is there anything to compute: what lies
  // outside of it is cut off first (with caps, so the piece stays a closed solid), and put back afterwards.
  const A0 = bounds(a), B0 = bounds(b), ax3 = ['x', 'y', 'z'];
  const lo = ax3.map(k => Math.max(A0.min[k], B0.min[k])), hi = ax3.map(k => Math.min(A0.max[k], B0.max[k]));
  if (lo.some((v, k) => v > hi[k] + 1e-6)) return op === 'union' ? combine([a, b]) : op === 'cut' ? a : none();
  const mg = Math.max(0.05, 0.002 * Math.hypot(hi[0] - lo[0], hi[1] - lo[1], hi[2] - lo[2])) * 1.137;
  const bl = lo.map(v => Math.fround(v - mg)), bh = hi.map(v => Math.fround(v + mg));
  const near = m => {
    const I = m.idx, P = m.pos, nT = I.length / 3;
    let far = 0;
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) {
      const x = P[I[t] * 3 + k], y = P[I[t + 1] * 3 + k], z = P[I[t + 2] * 3 + k];
      if ((x < bl[k] && y < bl[k] && z < bl[k]) || (x > bh[k] && y > bh[k] && z > bh[k])) { far++; break; }
    }
    if (nT < 400 || far < nT * 0.3) return { in: m, outs: [], planes: [] };
    let cap = m, open = m;
    const outs = [], planes = [];
    for (let k = 0; k < 3; k++) for (const [off, keep] of [[bl[k], 'pos'], [bh[k], 'neg']]) {
      let beyond = false;
      for (let i = k; i < open.pos.length && !beyond; i += 3) beyond = keep === 'pos' ? open.pos[i] < off : open.pos[i] > off;
      if (!beyond) continue;
      const o = cutPlane(open, ax3[k], off, keep === 'pos' ? 'neg' : 'pos', false);
      if (o.idx.length) outs.push(o);
      open = cutPlane(open, ax3[k], off, keep, false);
      cap = cutPlane(cap, ax3[k], off, keep, true);
      planes.push([k, off]);
    }
    return { in: cap, outs, planes };
  };
  const ra = near(a), rb = near(b);
  if ((ra.in.idx.length + rb.in.idx.length) / 3 > limit) throw new Error('Zu viele Dreiecke für eine Boolesche Operation – vorher „Reduzieren“');
  let tri = boolCore(ra.in, rb.in, op);
  const planes = [...ra.planes, ...rb.planes];
  if (planes.length) {
    // the caps go again, the parts cut off come back
    const kept = [];
    for (let t = 0; t < tri.length; t += 9) {
      if (planes.some(([k, off]) => Math.abs(tri[t + k] - off) < 1e-5 && Math.abs(tri[t + 3 + k] - off) < 1e-5 && Math.abs(tri[t + 6 + k] - off) < 1e-5)) continue;
      for (let q = 0; q < 9; q++) kept.push(tri[t + q]);
    }
    tri = kept;
    for (const m of op === 'union' ? [...ra.outs, ...rb.outs] : op === 'cut' ? ra.outs : []) for (let i = 0; i < m.idx.length; i++) { const v = m.idx[i] * 3; tri.push(m.pos[v], m.pos[v + 1], m.pos[v + 2]); }
  }
  if (!tri.length) return none();
  const res = boolHeal(tri);
  // (should the seam not close, the whole meshes are computed – as long as they are small enough for that)
  if (planes.length && (a.idx.length + b.idx.length) / 3 <= limit && !stats(res).closed && stats(a).closed && stats(b).closed) {
    const full = boolCore(a, b, op);
    return full.length ? boolHeal(full) : none();
  }
  return res;
}
// triangles (nine numbers each) to a mesh; where two cuts met almost in one point and left the seam open,
// the points are joined a little more generously
// flaps: triangles hanging on a closed seam (one edge open, another one shared by more than two triangles)
function dropFlaps(m) {
  let cur = m;
  for (let pass = 0; pass < 40; pass++) {
    const I = cur.idx, count = new Map();
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const e = edgeKey(I[t + k], I[t + (k + 1) % 3]); count.set(e, (count.get(e) || 0) + 1); }
    const keep = [];
    for (let t = 0; t < I.length; t += 3) {
      const c = [0, 1, 2].map(k => count.get(edgeKey(I[t + k], I[t + (k + 1) % 3])));
      if (!(c.includes(1) && c.some(x => x > 2))) keep.push(I[t], I[t + 1], I[t + 2]);
    }
    if (keep.length === I.length) break;
    cur = { pos: cur.pos, idx: Uint32Array.from(keep) };
  }
  return cur === m ? m : compact(cur);
}
function boolHeal(tri) {
  let res = dropFlaps(fixTJunctions(weld(new Float32Array(tri), 1e-4)));
  for (const tol of [3e-4, 1e-3]) {
    // the points on edges that do not have exactly two triangles
    const I = res.idx, P = res.pos, count = new Map();
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const e = edgeKey(I[t + k], I[t + (k + 1) % 3]); count.set(e, (count.get(e) || 0) + 1); }
    const bad = new Set();
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const p = I[t + k], q = I[t + (k + 1) % 3]; if (count.get(edgeKey(p, q)) !== 2) { bad.add(p); bad.add(q); } }
    if (!bad.size) break;
    if (bad.size > 4000) break;
    const vs = [...bad], to = new Map();
    const root = v => { while (to.has(v)) v = to.get(v); return v; };
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const p = vs[i] * 3, q = vs[j] * 3;
      if (Math.abs(P[p] - P[q]) > tol || Math.hypot(P[p] - P[q], P[p + 1] - P[q + 1], P[p + 2] - P[q + 2]) > tol) continue;
      const rp = root(vs[i]), rq = root(vs[j]);
      if (rp !== rq) to.set(rq, rp);
    }
    if (!to.size) continue;
    const idx = new Uint32Array(I.length);
    for (let i = 0; i < I.length; i++) idx[i] = root(I[i]);
    res = dropFlaps(fixTJunctions(cleanTris({ pos: P, idx }), tol));
  }
  return res;
}
// the triangles of a op b (unwelded: nine numbers each)
function boolCore(a, b, op) {
  const polys = m => {
    const out = [], P = m.pos;
    for (let t = 0; t < m.idx.length; t += 3) {
      const v = [m.idx[t], m.idx[t + 1], m.idx[t + 2]].map(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]), pl = planeOf(v[0], v[1], v[2]);
      if (pl) out.push({ v, pl });
    }
    return out;
  };
  const A = bspBuild(bspNew(), polys(a)), B = bspBuild(bspNew(), polys(b));
  if (op === 'union') { bspClipTo(A, B); bspClipTo(B, A); bspInvert(B); bspClipTo(B, A); bspInvert(B); bspBuild(A, bspAll(B)); }
  else if (op === 'cut') { bspInvert(A); bspClipTo(A, B); bspClipTo(B, A); bspInvert(B); bspClipTo(B, A); bspInvert(B); bspBuild(A, bspAll(B)); bspInvert(A); }
  else { bspInvert(A); bspClipTo(B, A); bspInvert(B); bspClipTo(A, B); bspClipTo(B, A); bspBuild(A, bspAll(B)); bspInvert(A); }
  const tri = [];
  for (const p of bspAll(A)) for (let k = 1; k < p.v.length - 1; k++) tri.push(...p.v[0], ...p.v[k], ...p.v[k + 1]);
  return tri;
}

// Close T-joints: a point of the open border that lies on another open edge splits that edge's triangle.
export function fixTJunctions(m, tol = 2e-4, passes = 8) {
  let cur = m;
  for (let pass = 0; pass < passes; pass++) {
    // needles first: a triangle whose third corner lies on its longest side covers nothing, but as a fan it
    // would hang on the seam as a flap. Without it the corner is a plain point on an edge, mended below.
    {
      const I0 = cur.idx, P0 = cur.pos, keep = [];
      for (let t = 0; t < I0.length; t += 3) {
        const a = I0[t] * 3, b = I0[t + 1] * 3, c = I0[t + 2] * 3;
        const ux = P0[b] - P0[a], uy = P0[b + 1] - P0[a + 1], uz = P0[b + 2] - P0[a + 2], vx = P0[c] - P0[a], vy = P0[c + 1] - P0[a + 1], vz = P0[c + 2] - P0[a + 2];
        const ar = Math.hypot(uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx), l1 = Math.hypot(ux, uy, uz), l2 = Math.hypot(vx, vy, vz), l3 = Math.hypot(vx - ux, vy - uy, vz - uz), lmax = Math.max(l1, l2, l3);
        // (a needle with two corners almost in one place is left alone: it closes the mesh there)
        if (ar > lmax * tol * 0.5 || Math.min(l1, l2, l3) < tol * 2) keep.push(I0[t], I0[t + 1], I0[t + 2]);
      }
      if (keep.length !== I0.length) cur = { pos: P0, idx: Uint32Array.from(keep) };
    }
    const I = cur.idx, P = cur.pos, count = new Map();
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const e = edgeKey(I[t + k], I[t + (k + 1) % 3]); count.set(e, (count.get(e) || 0) + 1); }
    const open = [], bv = new Set();
    for (let t = 0; t < I.length; t += 3) for (let k = 0; k < 3; k++) { const a = I[t + k], b = I[t + (k + 1) % 3]; if (count.get(edgeKey(a, b)) === 1) { open.push([t, k, a, b]); bv.add(a); bv.add(b); } }
    if (!open.length || open.length * bv.size > 8e7) break;
    // border points in a grid, to find those near an edge
    const cell = Math.max(tol * 50, 1e-3), grid = new Map(), key = (x, y, z) => `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
    let bx = 0;
    for (const [, , a, b] of open) bx += Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    const useGrid = bx / open.length < cell * 40;
    if (useGrid) for (const v of bv) { const k = key(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]); (grid.get(k) || grid.set(k, []).get(k)).push(v); }
    const splits = new Map(); // triangle → [per edge: [[s, vertex], …]]
    for (const [t, k, a, b] of open) {
      const ax = P[a * 3], ay = P[a * 3 + 1], az = P[a * 3 + 2], dx = P[b * 3] - ax, dy = P[b * 3 + 1] - ay, dz = P[b * 3 + 2] - az, l2 = dx * dx + dy * dy + dz * dz;
      if (l2 < 1e-16) continue;
      const test = v => {
        if (v === a || v === b) return;
        const px = P[v * 3] - ax, py = P[v * 3 + 1] - ay, pz = P[v * 3 + 2] - az, s = (px * dx + py * dy + pz * dz) / l2;
        if (s <= 1e-6 || s >= 1 - 1e-6) return;
        if (Math.hypot(px - dx * s, py - dy * s, pz - dz * s) > tol) return;
        let rec = splits.get(t);
        if (!rec) splits.set(t, (rec = [[], [], []]));
        if (!rec[k].some(q => q[1] === v)) rec[k].push([s, v]);
      };
      if (useGrid) {
        const x0 = Math.floor(Math.min(ax, ax + dx) / cell) - 1, x1 = Math.floor(Math.max(ax, ax + dx) / cell) + 1, y0 = Math.floor(Math.min(ay, ay + dy) / cell) - 1, y1 = Math.floor(Math.max(ay, ay + dy) / cell) + 1, z0 = Math.floor(Math.min(az, az + dz) / cell) - 1, z1 = Math.floor(Math.max(az, az + dz) / cell) + 1;
        for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (const v of grid.get(`${x},${y},${z}`) || []) test(v);
      } else for (const v of bv) test(v);
    }
    if (!splits.size) break;
    const pos = Array.from(P), idx = [];
    for (let t = 0; t < I.length; t += 3) {
      const rec = splits.get(t);
      if (!rec) { idx.push(I[t], I[t + 1], I[t + 2]); continue; }
      const loop = [];
      for (let k = 0; k < 3; k++) { loop.push(I[t + k]); for (const [, v] of rec[k].sort((p, q) => p[0] - q[0])) loop.push(v); }
      const cut = rec.filter(r => r.length).length;
      if (cut === 1) {
        // fan from the corner opposite the split edge
        const k = rec.findIndex(r => r.length), apex = I[t + (k + 2) % 3], s = loop.indexOf(I[t + k]);
        const chain = [];
        for (let q = 0; q < loop.length; q++) { const v = loop[(s + q) % loop.length]; if (v !== apex) chain.push(v); }
        for (let q = 0; q + 1 < chain.length; q++) idx.push(apex, chain[q], chain[q + 1]);
      } else {
        // several edges split: fan from the middle
        const c = pos.length / 3;
        pos.push((P[I[t] * 3] + P[I[t + 1] * 3] + P[I[t + 2] * 3]) / 3, (P[I[t] * 3 + 1] + P[I[t + 1] * 3 + 1] + P[I[t + 2] * 3 + 1]) / 3, (P[I[t] * 3 + 2] + P[I[t + 1] * 3 + 2] + P[I[t + 2] * 3 + 2]) / 3);
        for (let q = 0; q < loop.length; q++) idx.push(c, loop[q], loop[(q + 1) % loop.length]);
      }
    }
    cur = cleanTris({ pos: new Float32Array(pos), idx: Uint32Array.from(idx) });
  }
  return cur;
}

/**
 * Round faces in a faceted mesh: flat strips around a common axis, between two planes across it. Whole rings
 * (holes and pins, at least minFacets strips) and parts of a ring (fillets, half cylinders, rounded corners:
 * at least three strips on one circle, evenly divided). Returns [{ c (point of the axis at the lower end),
 * d (axis), r, h, hole (true: the material is outside the circle), n (strips of a whole turn), full,
 * u, w (the axes across d: w = d × u), a0, sweep (the arc runs counter-clockwise from the angle a0),
 * sl (area between the chords and the circle) }].
 */
export function findCylinders(m, minFacets = 8, info = null) {
  const I = m.idx, P = m.pos, nT = I.length / 3;
  const N = new Float64Array(nT * 3), needle = new Uint8Array(nT);
  for (let t = 0; t < nT; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx, l = Math.hypot(nx, ny, nz) || 1;
    N[t * 3] = nx / l; N[t * 3 + 1] = ny / l; N[t * 3 + 2] = nz / l;
    // a needle (as cuts leave them): its normal is not to be trusted
    if (l < 4e-3 * Math.max(ux * ux + uy * uy + uz * uz, vx * vx + vy * vy + vz * vz, (vx - ux) ** 2 + (vy - uy) ** 2 + (vz - uz) ** 2)) needle[t] = 1;
  }
  // does triangle s lie in the plane of triangle t?
  const inPlane = (t, s) => { const o = I[t * 3] * 3; for (let k = 0; k < 3; k++) { const v = I[s * 3 + k] * 3; if (Math.abs((P[v] - P[o]) * N[t * 3] + (P[v + 1] - P[o + 1]) * N[t * 3 + 1] + (P[v + 2] - P[o + 2]) * N[t * 3 + 2]) > 2e-4) return false; } return true; };
  const edges = new Map();
  for (let t = 0; t < nT; t++) for (let k = 0; k < 3; k++) { const a = I[t * 3 + k], b = I[t * 3 + (k + 1) % 3], e = edgeKey(a, b); const r = edges.get(e); if (r) r.push(t); else edges.set(e, [t, a, b]); }
  // flat regions: neighbours in one plane
  const par = new Int32Array(nT).map((_, i) => i), find = x => { while (par[x] !== x) { par[x] = par[par[x]]; x = par[x]; } return x; };
  const dotN = (s, t) => N[s * 3] * N[t * 3] + N[s * 3 + 1] * N[t * 3 + 1] + N[s * 3 + 2] * N[t * 3 + 2];
  const pairs = [];
  for (const r of edges.values()) { if (r.length !== 4) continue; const [t, a, b, s] = r; if (dotN(t, s) > 1 - 1e-7) par[find(t)] = find(s); else pairs.push([t, s, a, b]); }
  // a needle joins one of the facets it lies in (and only one: it may lie in two that meet at a flat angle)
  for (const [t, s] of pairs) {
    if (needle[t] === needle[s]) continue;
    const nd = needle[t] ? t : s, big = needle[t] ? s : t;
    if (needle[nd] === 2 || !inPlane(big, nd)) continue;
    par[find(nd)] = find(big);
    needle[nd] = 2;
  }
  const reg = new Int32Array(nT).map((_, i) => find(i));
  // "soft" edges (a bend of 0.6° … 31° between two flat regions), sorted by their direction: the strips of a
  // cylinder meet in edges along its axis
  const cmin = Math.cos((31 * Math.PI) / 180), cmax = Math.cos((0.6 * Math.PI) / 180);
  if (info) Object.assign(info, { reg, N, softList: [], flatish: [], used: new Set() });
  // the normal of a region: from all its triangles, by area (single needles do not disturb it)
  const RN = new Float64Array(nT * 3);
  for (let t = 0; t < nT; t++) {
    const a = I[t * 3] * 3, b = I[t * 3 + 1] * 3, c = I[t * 3 + 2] * 3, g = reg[t] * 3;
    const ux = P[b] - P[a], uy = P[b + 1] - P[a + 1], uz = P[b + 2] - P[a + 2], vx = P[c] - P[a], vy = P[c + 1] - P[a + 1], vz = P[c + 2] - P[a + 2];
    RN[g] += uy * vz - uz * vy; RN[g + 1] += uz * vx - ux * vz; RN[g + 2] += ux * vy - uy * vx;
  }
  for (let t = 0; t < nT; t++) if (reg[t] === t) { const l = Math.hypot(RN[t * 3], RN[t * 3 + 1], RN[t * 3 + 2]) || 1; RN[t * 3] /= l; RN[t * 3 + 1] /= l; RN[t * 3 + 2] /= l; }
  const classes = new Map();
  for (const [t, s, a, b] of pairs) {
    const g = reg[t] * 3, q = reg[s] * 3;
    if (g === q) continue;
    const c = RN[g] * RN[q] + RN[g + 1] * RN[q + 1] + RN[g + 2] * RN[q + 2];
    // (flatter than a soft edge, yet not one plane: fine facets of a round face – they hold it together when
    // cones and spheres are looked for)
    if (c > cmax) { if (info) info.flatish.push([reg[t], reg[s]]); continue; }
    if (c < cmin) continue;
    let dx = P[b * 3] - P[a * 3], dy = P[b * 3 + 1] - P[a * 3 + 1], dz = P[b * 3 + 2] - P[a * 3 + 2];
    const l = Math.hypot(dx, dy, dz);
    if (l < 1e-9) continue;
    dx /= l; dy /= l; dz /= l;
    if (dx < -1e-6 || (Math.abs(dx) <= 1e-6 && (dy < -1e-6 || (Math.abs(dy) <= 1e-6 && dz < 0)))) { dx = -dx; dy = -dy; dz = -dz; }
    const key = `${Math.round(dx * 500)},${Math.round(dy * 500)},${Math.round(dz * 500)}`;
    let cl = classes.get(key);
    if (!cl) classes.set(key, (cl = { d: [dx, dy, dz], soft: [] }));
    cl.soft.push([reg[t], reg[s], a, b]);
    if (info) info.softList.push([reg[t], reg[s]]);
  }
  // (directions that fell into two neighbouring cells of the rounding belong together)
  let list = [...classes.values()].filter(c => c.soft.length >= 1);
  if (list.length <= 3000) {
    const merged = [];
    for (const c of list.sort((p, q) => q.soft.length - p.soft.length)) {
      const o = merged.find(q => Math.abs(q.d[0] * c.d[0] + q.d[1] * c.d[1] + q.d[2] * c.d[2]) > 0.999995);
      if (o) o.soft.push(...c.soft); else merged.push(c);
    }
    list = merged;
  }
  let regTris = null;
  if (info) { info.soft = info.softList; info.trisOf = () => trisOf(); }
  const trisOf = () => { if (!regTris) { regTris = new Map(); for (let t = 0; t < nT; t++) { const r = regTris.get(reg[t]); if (r) r.push(t); else regTris.set(reg[t], [t]); } } return regTris; };
  const out = [];
  for (const cl of list) {
    if (cl.soft.length < 3) continue;
    const d = cl.d;
    const ux0 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], dd = ux0[0] * d[0] + ux0[1] * d[1] + ux0[2] * d[2];
    let u = [ux0[0] - d[0] * dd, ux0[1] - d[1] * dd, ux0[2] - d[2] * dd];
    const ul = Math.hypot(...u); u = u.map(x => x / ul);
    const w = [d[1] * u[2] - d[2] * u[1], d[2] * u[0] - d[0] * u[2], d[0] * u[1] - d[1] * u[0]];
    const X = v => P[v * 3] * u[0] + P[v * 3 + 1] * u[1] + P[v * 3 + 2] * u[2], Y = v => P[v * 3] * w[0] + P[v * 3 + 1] * w[1] + P[v * 3 + 2] * w[2], H = v => P[v * 3] * d[0] + P[v * 3 + 1] * d[1] + P[v * 3 + 2] * d[2];
    // seen along the axis every soft edge is a point ("line"), every strip a chord between two of them
    const lines = new Map(), regLines = new Map();
    for (const [ra, rb, a] of cl.soft) {
      const x = X(a), y = Y(a), key = `${Math.round(x * 500)},${Math.round(y * 500)}`;
      let ln = lines.get(key);
      if (!ln) lines.set(key, (ln = { x, y, strips: [] }));
      for (const r of [ra, rb]) { let s = regLines.get(r); if (!s) regLines.set(r, (s = new Set())); s.add(ln); }
    }
    if (lines.size < 3) continue;
    for (const [r, s] of regLines) {
      if (s.size === 2) { const [p, q] = [...s]; const st = { r, p, q }; p.strips.push(st); q.strips.push(st); }
      else if (s.size === 1) {
        // the last strip of an arc ends in a sharp edge: its far side is the end of the chain
        const [p] = [...s];
        let far = null, fd = 1e-3;
        for (const t of trisOf().get(r)) for (let k = 0; k < 3; k++) { const v = I[t * 3 + k], x = X(v), y = Y(v), l = Math.hypot(x - p.x, y - p.y); if (l > fd) { fd = l; far = { x, y, strips: [] }; } }
        if (far) { const st = { r, p, q: far }; p.strips.push(st); far.strips.push(st); lines.set('end' + r, far); }
      }
    }
    // chains of strips: through lines where exactly two strips meet
    const usedS = new Set(), chains = [];
    const walk = (ln, st) => {
      const pts = [ln], strips = [];
      for (;;) {
        usedS.add(st); strips.push(st);
        ln = st.p === ln ? st.q : st.p;
        pts.push(ln);
        if (ln.strips.length !== 2) break;
        st = ln.strips[0] === st ? ln.strips[1] : ln.strips[0];
        if (usedS.has(st)) break;
      }
      return { pts, strips };
    };
    for (const ln of lines.values()) if (ln.strips.length !== 2) for (const st of ln.strips) if (!usedS.has(st)) chains.push(walk(ln, st));
    for (const ln of lines.values()) if (ln.strips.length === 2 && !usedS.has(ln.strips[0])) {
      const c = walk(ln, ln.strips[0]);
      if (c.pts[c.pts.length - 1] !== c.pts[0]) { chains.push(c); continue; }
      // a closed chain: one circle all the way round, or opened after its longest chord
      c.closed = true;
      chains.push(c);
    }
    const circle = pts => {
      const mx = pts.reduce((a, p) => a + p.x, 0) / pts.length, my = pts.reduce((a, p) => a + p.y, 0) / pts.length;
      let sxx = 0, syy = 0, sxy = 0, sxz = 0, syz = 0, sz = 0;
      for (const p of pts) { const x = p.x - mx, y = p.y - my, z = x * x + y * y; sxx += x * x; syy += y * y; sxy += x * y; sxz += x * z; syz += y * z; sz += z; }
      const det = sxx * syy - sxy * sxy;
      if (Math.abs(det) < 1e-12) return null;
      const cx = (sxz * syy - syz * sxy) / (2 * det), cy = (syz * sxx - sxz * sxy) / (2 * det), r = Math.sqrt(cx * cx + cy * cy + sz / pts.length);
      if (!(r > 1e-3)) return null;
      const tol = Math.max(2e-3, 1e-3 * r);
      return pts.every(p => Math.abs(Math.hypot(p.x - mx - cx, p.y - my - cy) - r) <= tol) ? { x: mx + cx, y: my + cy, r } : null;
    };
    const emit = (pts, strips, full) => {
      const C = circle(full ? pts.slice(0, -1) : pts);
      if (!C) return false;
      // the strips: all between the same two planes across the axis, all turned the same way
      const T = trisOf();
      let h0 = Infinity, h1 = -Infinity, side = 0;
      const spans = [];
      for (const st of strips) {
        let a = Infinity, b = -Infinity;
        for (const t of T.get(st.r)) for (let k = 0; k < 3; k++) { const hh = H(I[t * 3 + k]); if (hh < a) a = hh; if (hh > b) b = hh; }
        spans.push([a, b]); h0 = Math.min(h0, a); h1 = Math.max(h1, b);
        const t = T.get(st.r)[0], mxp = (st.p.x + st.q.x) / 2 - C.x, myp = (st.p.y + st.q.y) / 2 - C.y;
        const s = (N[t * 3] * u[0] + N[t * 3 + 1] * u[1] + N[t * 3 + 2] * u[2]) * mxp + (N[t * 3] * w[0] + N[t * 3 + 1] * w[1] + N[t * 3 + 2] * w[2]) * myp;
        if (side && Math.sign(s) !== side) return false;
        side = Math.sign(s) || side;
      }
      if (h1 - h0 < 1e-3 || !side || spans.some(s => s[0] - h0 > 2e-3 || h1 - s[1] > 2e-3)) return false;
      // angles: counter-clockwise from the first point, every chord a small step
      const ang = pts.map(p => Math.atan2(p.y - C.y, p.x - C.x));
      const steps = [];
      for (let i = 1; i < ang.length; i++) { let s = ang[i] - ang[i - 1]; while (s > Math.PI) s -= 2 * Math.PI; while (s < -Math.PI) s += 2 * Math.PI; steps.push(s); }
      const sg = Math.sign(steps[0]);
      if (!sg || steps.some(s => Math.sign(s) !== sg || Math.abs(s) > 0.56)) return false;
      const sweep = steps.reduce((a, s) => a + Math.abs(s), 0);
      if (full ? Math.abs(sweep - 2 * Math.PI) > 1e-3 : sweep > 2 * Math.PI - 0.05 || sweep < 0.26) return false;
      // regular: the chords between the first and the last are equal (the outer two may be cut shorter)
      const inner = steps.slice(full ? 0 : 1, full ? undefined : -1).map(Math.abs), big = Math.max(...inner, 0);
      if (inner.some(s => s < big * 0.97) || (!full && (Math.abs(steps[0]) > big * 1.03 || Math.abs(steps[steps.length - 1]) > big * 1.03))) return false;
      const sl = steps.reduce((a, s) => a + (C.r * C.r / 2) * (Math.abs(s) - Math.sin(Math.abs(s))), 0);
      const a0 = sg > 0 ? ang[0] : ang[ang.length - 1];
      out.push({ c: [u[0] * C.x + w[0] * C.y + d[0] * h0, u[1] * C.x + w[1] * C.y + d[1] * h0, u[2] * C.x + w[2] * C.y + d[2] * h0], d: d.slice(), r: C.r, h: h1 - h0, hole: side < 0,
        n: full ? strips.length : Math.max(3, Math.round((2 * Math.PI) / (big || Math.abs(steps[0])))), full, u, w, a0, sweep, sl, ...(info ? { regs: strips.map(st => st.r) } : {}) });
      if (info) for (const st of strips) info.used.add(st.r);
      return true;
    };
    for (const ch of chains) {
      let { pts, strips } = ch;
      if (ch.closed) {
        if (strips.length >= minFacets && emit(pts, strips, true)) continue;
        // open it after the longest chord
        let best = 0, bl = -1;
        strips.forEach((st, i) => { const l = Math.hypot(st.p.x - st.q.x, st.p.y - st.q.y); if (l > bl) { bl = l; best = i; } });
        const n = strips.length, k = (best + 1) % n;
        const ring = pts.slice(0, -1);
        pts = [...ring.slice(k), ...ring.slice(0, k), ring[k]];
        strips = [...strips.slice(k), ...strips.slice(0, k)];
      }
      // pieces of the chain on one circle: at least three chords
      let i = 0;
      while (i + 3 < pts.length) {
        let j = i + 3, okC = circle(pts.slice(i, j + 1));
        if (!okC) { i++; continue; }
        while (j + 1 < pts.length && circle(pts.slice(i, j + 2))) j++;
        // (a chord cut short at the far end is kept, a long one – the flat face next to a fillet – never fits)
        if (emit(pts.slice(i, j + 1), strips.slice(i, j), false)) i = j; else i++;
      }
    }
  }
  return out.sort((a, b) => b.r - a.r);
}

// smallest eigenvector of a symmetric 3 × 3 matrix [xx, xy, xz, yy, yz, zz] (Jacobi), with the eigenvalues sorted
function eig3(m) {
  const A = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]], V = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 30; sweep++) {
    let off = 0;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]]) {
      off += A[p][q] * A[p][q];
      if (Math.abs(A[p][q]) < 1e-300) continue;
      const th = (A[q][q] - A[p][p]) / (2 * A[p][q]), t = Math.sign(th || 1) / (Math.abs(th) + Math.sqrt(th * th + 1)), c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) { const x = A[k][p], y = A[k][q]; A[k][p] = c * x - s * y; A[k][q] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = A[p][k], y = A[q][k]; A[p][k] = c * x - s * y; A[q][k] = s * x + c * y; }
      for (let k = 0; k < 3; k++) { const x = V[k][p], y = V[k][q]; V[k][p] = c * x - s * y; V[k][q] = s * x + c * y; }
    }
    if (off < 1e-22) break;
  }
  const o = [0, 1, 2].sort((a, b) => A[a][a] - A[b][b]);
  return { val: o.map(i => A[i][i]), vec: o.map(i => [V[0][i], V[1][i], V[2][i]]) };
}
// solve a small linear system (Gauss with pivoting); null if singular
function solveN(M, b) {
  const n = b.length, A = M.map((r, i) => [...r, b[i]]);
  for (let c = 0; c < n; c++) {
    let p = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(A[r][c]) > Math.abs(A[p][c])) p = r;
    if (Math.abs(A[p][c]) < 1e-12) return null;
    [A[c], A[p]] = [A[p], A[c]];
    for (let r = 0; r < n; r++) if (r !== c) { const k = A[r][c] / A[c][c]; for (let q = c; q <= n; q++) A[r][q] -= k * A[c][q]; }
  }
  return A.map((r, i) => r[n] / r[i]);
}

/**
 * All round faces of a faceted mesh: { cylinders (as findCylinders), cones, spheres }.
 * cones: whole rings of flat strips around an axis that meet in one point – countersinks, tapers, cone tips:
 *   { apex, d (axis, from the apex to the wide end), t0, t1 (distances from the apex), r0, r1, hole, n }.
 * spheres: patches whose corners all lie on one sphere – balls, domes, rounded corners:
 *   { c, r, hole, vol (volume between the facets and the sphere), n (triangles) }.
 * tori: rings of corners around an axis whose radii and heights lie on a circle – the fillet round a round edge,
 *   a rounded rim: { c (centre, on the axis), d (axis), R (to the middle of the tube), r (tube), s0, s1 (the part
 *   of the tube: angle above the plane of the torus, at the lowest and the highest ring), inner (the half of the
 *   tube that looks to the axis – there the facets lie on both sides of the true face), hole (material outside
 *   the tube), n, vol (between the facets and the torus; outer half only), din, dout (how far the facets lie
 *   inside and outside the tube), a0, sweep, u, w (a part of the way round) }.
 */
export function findRound(m, minFacets = 8, veto = null) {
  const info = {};
  let cylinders = findCylinders(m, minFacets, info).filter(c => { if (!veto || !veto(c)) return true; for (const r of c.regs || []) info.used.delete(r); return false; });
  // (the strips across a tube, where a mesher steps finely round the axis, read as many short pieces of cylinders
  // of one radius lying far apart: they are given back – the search for tori takes them)
  {
    const parts = cylinders.filter(c => c.full === false), drop = new Set();
    for (const c of parts) {
      if (drop.has(c)) continue;
      const g = parts.filter(q => Math.abs(q.r - c.r) < 2e-3);
      if (g.length < 6) continue;
      let far = 0;
      for (const p of g) for (const q of g) far = Math.max(far, Math.hypot(p.c[0] - q.c[0], p.c[1] - q.c[1], p.c[2] - q.c[2]));
      const hs = g.map(q => q.h).sort((p, q) => p - q);
      if (hs[hs.length >> 1] < 0.15 * far) for (const q of g) drop.add(q);
    }
    if (drop.size) { for (const c of drop) for (const r of c.regs || []) info.used.delete(r); cylinders = cylinders.filter(c => !drop.has(c)); }
  }
  const cones = [], spheres = [], tori = [], minSeg = Math.max(4, minFacets >> 1);
  // axes a torus may turn about: those of the cylinders and cones, and the main axes
  const axes0 = [];
  const addAxis = d => { if (d && !axes0.some(q => Math.abs(q[0] * d[0] + q[1] * d[1] + q[2] * d[2]) > 0.999999)) axes0.push(d); };
  for (const c of cylinders) addAxis(c.d);
  addAxis([0, 0, 1]); addAxis([1, 0, 0]); addAxis([0, 1, 0]);
  const { reg, N, used, trisOf } = info, I = m.idx, P = m.pos, soft = info.flatish.length ? info.soft.concat(info.flatish) : info.soft;
  // a ring on its own (an O-ring): a closed piece of the mesh with every corner on one torus
  {
    const nV = P.length / 3, up = new Int32Array(nV), dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
    for (let i = 0; i < nV; i++) up[i] = i;
    const fd = x => { while (up[x] !== x) { up[x] = up[up[x]]; x = up[x]; } return x; };
    for (let t = 0; t < I.length; t += 3) for (const k of [1, 2]) { const a = fd(I[t]), b = fd(I[t + k]); if (a !== b) up[b] = a; }
    const parts = new Map();
    for (let t = 0; t < I.length / 3; t++) { const g = fd(I[t * 3]); let l = parts.get(g); if (!l) parts.set(g, (l = [])); l.push(t); }
    for (const tris of parts.values()) {
      if (tris.length < 96) continue;
      const vs = [...new Set(tris.flatMap(t => [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]))].map(v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]]);
      let c = [0, 0, 0];
      for (const p of vs) for (let k = 0; k < 3; k++) c[k] += p[k] / vs.length;
      const C = [0, 0, 0, 0, 0, 0];
      for (const p of vs) { const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; C[0] += q[0] * q[0]; C[1] += q[0] * q[1]; C[2] += q[0] * q[2]; C[3] += q[1] * q[1]; C[4] += q[1] * q[2]; C[5] += q[2] * q[2]; }
      const E = eig3(C);
      if (!(E.val[0] < 0.6 * E.val[1])) continue;
      const a = E.vec[0], e1 = E.vec[1], e2 = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]];
      let Rc = 0, r = 0, fit = false;
      for (let it = 0; it < 8 && !fit; it++) {
        const rt = vs.map(p => { const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], x = dot(q, e1), y = dot(q, e2), rho = Math.hypot(x, y) || 1e-12; return [rho, dot(q, a), x / rho, y / rho]; });
        // the circle of the tube through (distance from the axis, height) …
        const M3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b3 = [0, 0, 0];
        for (const [x, y] of rt) { const row = [x, y, 1], z = x * x + y * y; for (let i = 0; i < 3; i++) { b3[i] += row[i] * z; for (let j = 0; j < 3; j++) M3[i][j] += row[i] * row[j]; } }
        const sol = solveN(M3, b3);
        if (!sol) break;
        const tc = sol[1] / 2;
        Rc = sol[0] / 2; r = Math.sqrt(Math.max(0, sol[2] + Rc * Rc + tc * tc));
        if (!(r > 1e-3) || !(Rc > 1.25 * r)) break;
        // … and the place of the axis that fits it best
        let a11 = 0, a12 = 0, a22 = 0, b1 = 0, b2 = 0, worst = 0;
        for (const [rho, t, ux, uy] of rt) { const s = Math.hypot(rho - Rc, t - tc) || 1e-12, e = s - r, g = -(rho - Rc) / s, jx = g * ux, jy = g * uy; a11 += jx * jx; a12 += jx * jy; a22 += jy * jy; b1 += jx * e; b2 += jy * e; worst = Math.max(worst, Math.abs(e)); }
        const det = a11 * a22 - a12 * a12, dx = Math.abs(det) > 1e-12 ? -(a22 * b1 - a12 * b2) / det : 0, dy = Math.abs(det) > 1e-12 ? -(a11 * b2 - a12 * b1) / det : 0;
        c = c.map((x, k) => x + e1[k] * dx + e2[k] * dy + a[k] * tc);
        fit = worst < Math.max(5e-3, 2.5e-3 * r) && Math.abs(dx) + Math.abs(dy) + Math.abs(tc) < 1e-6;
      }
      if (!fit) continue;
      // closed, the outside outwards, and as much inside as a torus holds
      let v6 = 0, okT = true;
      for (const t of tris) {
        const p = [0, 1, 2].map(k => { const v = I[t * 3 + k]; return [P[v * 3] - c[0], P[v * 3 + 1] - c[1], P[v * 3 + 2] - c[2]]; });
        v6 += p[0][0] * (p[1][1] * p[2][2] - p[1][2] * p[2][1]) - p[0][1] * (p[1][0] * p[2][2] - p[1][2] * p[2][0]) + p[0][2] * (p[1][0] * p[2][1] - p[1][1] * p[2][0]);
        const g = [(p[0][0] + p[1][0] + p[2][0]) / 3, (p[0][1] + p[1][1] + p[2][1]) / 3, (p[0][2] + p[1][2] + p[2][2]) / 3], tt = dot(g, a), rho = Math.hypot(dot(g, e1), dot(g, e2));
        if (Math.abs(Math.hypot(rho - Rc, tt) - r) > 0.2 * r) { okT = false; break; }
      }
      const full = 2 * Math.PI * Math.PI * Rc * r * r, vol = full - v6 / 6;
      if (!okT || !(vol > 0) || vol > 0.15 * full) continue;
      const own = new Set(tris.map(t => reg[t]));
      for (let i = cylinders.length - 1; i >= 0; i--) if ((cylinders[i].regs || []).some(x => own.has(x))) cylinders.splice(i, 1);
      for (const x of own) used.add(x);
      tori.push({ c, d: a, R: Rc, r, s0: -Math.PI / 2, s1: Math.PI / 2, whole: true, inner: false, hole: false, n: 16, vol, din: 0, dout: 0, tris: tris.length, ti: tris });
    }
  }
  // what is left: flat regions joined by soft edges
  const par = new Map(), find = x => { let p = par.get(x); if (p === undefined) { par.set(x, x); return x; } while (p !== par.get(p)) p = par.get(p); par.set(x, p); return p; };
  for (const [a, b] of soft) { if (used.has(a) || used.has(b)) continue; const ra = find(a), rb = find(b); if (ra !== rb) par.set(rb, ra); }
  const comps = new Map();
  for (const r of par.keys()) { const g = find(r); let c = comps.get(g); if (!c) comps.set(g, (c = [])); c.push(r); }
  const T = trisOf();
  for (let regs of comps.values()) {
    if (regs.length < minSeg) continue;
    const tris = regs.flatMap(r => T.get(r)), vs = [...new Set(tris.flatMap(t => [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]))];
    const V = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
    // normal and area of every region from all its triangles; shreds (left by a cut) do not count as strips
    const area = [];
    const nrmAll = regs.map(r => {
      const g = [0, 0, 0];
      for (const t of T.get(r)) { const a = V(I[t * 3]), b = V(I[t * 3 + 1]), c = V(I[t * 3 + 2]), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]; g[0] += u[1] * w[2] - u[2] * w[1]; g[1] += u[2] * w[0] - u[0] * w[2]; g[2] += u[0] * w[1] - u[1] * w[0]; }
      const l = Math.hypot(...g) || 1;
      area.push(l / 2);
      return g.map(x => x / l);
    });
    const amed = area.slice().sort((p, q) => p - q)[area.length >> 1], bigIdx = regs.map((_, i) => i).filter(i => area[i] > 0.05 * amed);
    const allRegs = regs;
    regs = bigIdx.map(i => allRegs[i]);
    const nrm = bigIdx.map(i => nrmAll[i]);
    if (regs.length < minSeg) continue;
    // ---- a cone: every normal has the same angle to the axis ----
    // (a whole ring of strips, or a part of one: { …, a0, sweep, u, w } – the strips from the angle a0 on, measured
    // from u towards w)
    const cone = (regs, nrm) => {
      const vs = [...new Set(regs.flatMap(r => T.get(r)).flatMap(t => [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]))];
      const mean = [0, 1, 2].map(k => nrm.reduce((a, n) => a + n[k], 0) / nrm.length), C = [0, 0, 0, 0, 0, 0];
      for (const n of nrm) { const x = n[0] - mean[0], y = n[1] - mean[1], z = n[2] - mean[2]; C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z; }
      const E = eig3(C);
      let a = E.vec[0];
      if (E.val[1] < 0.002 * nrm.length || nrm.some(n => Math.abs((n[0] - mean[0]) * a[0] + (n[1] - mean[1]) * a[1] + (n[2] - mean[2]) * a[2]) > 4e-3)) return null;
      const cs = mean[0] * a[0] + mean[1] * a[1] + mean[2] * a[2];
      if (Math.abs(cs) < 0.02 || Math.abs(cs) > 0.9995) return null;
      // the apex: where all the planes meet
      const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
      regs.forEach((r, i) => { const n = nrm[i], p = V(I[T.get(r)[0] * 3]), dd = n[0] * p[0] + n[1] * p[1] + n[2] * p[2]; for (let x = 0; x < 3; x++) { b[x] += n[x] * dd; for (let y = 0; y < 3; y++) M[x][y] += n[x] * n[y]; } });
      const apex = solveN(M, b);
      if (!apex) return null;
      const tOf = p => (p[0] - apex[0]) * a[0] + (p[1] - apex[1]) * a[1] + (p[2] - apex[2]) * a[2];
      const pts = vs.map(V);
      if (pts.reduce((s, p) => s + tOf(p), 0) < 0) a = a.map(x => -x);
      let st = 0, stt = 0, t0 = Infinity, t1 = -Infinity;
      const tr = pts.map(p => { const t = tOf(p), q = [p[0] - apex[0] - a[0] * t, p[1] - apex[1] - a[1] * t, p[2] - apex[2] - a[2] * t]; return [t, Math.hypot(...q), q]; });
      for (const [t, rho] of tr) { st += rho * t; stt += t * t; t0 = Math.min(t0, t); t1 = Math.max(t1, t); }
      // (the corners lie on the cone; points a cut has made lie on the facets, a little inside: they do not
      // take part in the slope)
      let kk = st / stt;
      for (let pass = 0; pass < 4; pass++) {
        const top = Math.max(...tr.map(([t, rho]) => rho - kk * t)), keep = tr.filter(([t, rho]) => rho - kk * t > top - Math.max(2e-3, 2e-4 * kk * t1));
        if (keep.length < 2 * minSeg) return null;
        const k2 = keep.reduce((a, [t, rho]) => a + rho * t, 0) / keep.reduce((a, [t]) => a + t * t, 0);
        if (Math.abs(k2 - kk) < 1e-9) break;
        kk = k2;
      }
      const tol = Math.max(3e-3, 1.5e-3 * kk * t1);
      if (!(kk > 1e-3) || t0 < -tol || t1 - t0 < 1e-3 || tr.some(([t, rho]) => rho - kk * t > tol || rho - kk * t < -0.04 * kk * t - tol)) return null;
      if (t0 < tol) t0 = 0;
      // every strip from one end to the other, the wide end a regular ring all the way round
      for (const r of regs) { let lo = Infinity, hi = -Infinity; for (const t of T.get(r)) for (let q = 0; q < 3; q++) { const x = tOf(V(I[t * 3 + q])); lo = Math.min(lo, x); hi = Math.max(hi, x); } if (lo - t0 > 3e-3 || t1 - hi > 3e-3) return null; }
      const u = tr.find(x => x[1] > 0.5 * kk * t1)[2], ul = Math.hypot(...u), ux = u.map(x => x / ul), w = [a[1] * ux[2] - a[2] * ux[1], a[2] * ux[0] - a[0] * ux[2], a[0] * ux[1] - a[1] * ux[0]];
      const ang = [...new Set(tr.filter(x => Math.abs(x[0] - t1) < 3e-3 && Math.abs(x[1] - kk * x[0]) < Math.max(2e-3, 2e-4 * kk * t1)).map(x => Math.round(Math.atan2(x[2][0] * w[0] + x[2][1] * w[1] + x[2][2] * w[2], x[2][0] * ux[0] + x[2][1] * ux[1] + x[2][2] * ux[2]) * 2000)))].sort((p, q) => p - q).map(x => x / 2000);
      if (ang.length <= minSeg) return null;
      // (a cut may leave points right next to a corner: the division is taken from the usual gap, every point
      // has to sit at a corner of it and every corner has to be there – or, for a part of a ring, one unbroken
      // row of corners)
      const gaps = ang.map((x, i) => (i ? x - ang[i - 1] : x + 2 * Math.PI - ang[ang.length - 1]));
      const gsort = gaps.slice().sort((p, q) => q - p), gmax = gsort[0] > 3 * gsort[1] ? gsort[1] : gsort[0];
      const gs = gaps.filter(x => x > 0.25 * gmax).sort((p, q) => p - q), nSeg = Math.round((2 * Math.PI) / gs[gs.length >> 1]), step = (2 * Math.PI) / nSeg;
      if (nSeg < minFacets || Math.abs(gs[gs.length >> 1] - step) > 0.03 * step) return null;
      const slots = new Set();
      for (const x of ang) { const q = (x - ang[0]) / step, k = Math.round(q); if (Math.abs(q - k) > 0.12) return null; slots.add(((k % nSeg) + nSeg) % nSeg); }
      let seg = null;
      if (slots.size !== nSeg) {
        const s0 = [...slots].find(k => !slots.has((k - 1 + nSeg) % nSeg));
        let len = 0;
        while (len < nSeg && slots.has((s0 + len) % nSeg)) len++;
        if (len !== slots.size || len <= minSeg) return null;
        seg = { a0: ang[0] + s0 * step, sweep: (len - 1) * step, u: ux, w };
      } else if (regs.length < minFacets) return null;
      // material inside (pin) or outside (hole)
      let side = 0;
      regs.forEach((r, i) => { const p = V(I[T.get(r)[0] * 3]), t = tOf(p), q = [p[0] - apex[0] - a[0] * t, p[1] - apex[1] - a[1] * t, p[2] - apex[2] - a[2] * t]; const tt = T.get(r), c = tt.length; let g = [0, 0, 0]; for (const x of tt) for (let k = 0; k < 3; k++) { const y = V(I[x * 3 + k]); g = g.map((z, j) => z + y[j] / (3 * c)); } const tg = tOf(g), rq = [g[0] - apex[0] - a[0] * tg, g[1] - apex[1] - a[1] * tg, g[2] - apex[2] - a[2] * tg]; side += Math.sign(nrm[i][0] * rq[0] + nrm[i][1] * rq[1] + nrm[i][2] * rq[2]); void q; });
      if (Math.abs(side) !== regs.length) return null;
      return { apex, d: a, t0, t1, r0: kk * t0, r1: kk * t1, hole: side < 0, n: nSeg, ...(seg || {}) };
    };
    // ---- a cone between two rings of corners ----
    // (how a CAD export triangulates a cone: the corners lie on its two circles, the triangles run from one to
    // the other in any division – no strips of one width, so the planes above say nothing)
    const ringCone = (rs, ns) => {
      const tris = rs.flatMap(r => T.get(r));
      if (tris.length < 2 * minSeg) return null;
      const pts = [...new Set(tris.flatMap(t => [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]))].map(V);
      const mean = [0, 1, 2].map(k => ns.reduce((a, n) => a + n[k], 0) / ns.length), C = [0, 0, 0, 0, 0, 0];
      for (const n of ns) { const x = n[0] - mean[0], y = n[1] - mean[1], z = n[2] - mean[2]; C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z; }
      const a0 = eig3(C).vec[0], dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      // the rings: along the rough axis the corners fall into heaps (two, or more where the export has laid
      // further rings in between)
      const heaps = (ax, k, least) => {
        const ord = pts.map(p => [dot(p, ax), p]).sort((p, q) => p[0] - q[0]);
        let gap = 0;
        for (let i = 1; i < ord.length; i++) gap = Math.max(gap, ord[i][0] - ord[i - 1][0]);
        const out = [[ord[0][1]]];
        for (let i = 1; i < ord.length; i++) { if (ord[i][0] - ord[i - 1][0] > Math.max(least, k * gap)) out.push([]); out[out.length - 1].push(ord[i][1]); }
        return out;
      };
      // (a single corner at one end: the tip of the cone)
      const fit = rs => rs.length >= 2 && rs.length <= 40 && !rs.some((r, i) => r.length < 3 && !(r.length === 1 && (i === 0 || i === rs.length - 1))) && !(rs[0].length === 1 && rs[rs.length - 1].length === 1);
      // the axis exactly: every ring is flat, across the same direction
      const cen = ps => [0, 1, 2].map(k => ps.reduce((s, p) => s + p[k], 0) / ps.length);
      const axisOf = rs => {
        const gs = rs.map(cen), C2 = [0, 0, 0, 0, 0, 0];
        rs.forEach((ps, k) => { const g = gs[k]; for (const p of ps) { const x = p[0] - g[0], y = p[1] - g[1], z = p[2] - g[2]; C2[0] += x * x; C2[1] += x * y; C2[2] += x * z; C2[3] += y * y; C2[4] += y * z; C2[5] += z * z; } });
        return [eig3(C2).vec[0], gs];
      };
      let rings = heaps(a0, 0.3, 0);
      if (!fit(rings)) return null;
      let [a, gs0] = axisOf(rings);
      // along the exact axis rings that lie close together come apart (the rough axis had smeared them into one)
      const fine = heaps(a, 0.05, 0.01);
      if (fine.length !== rings.length) { if (!fit(fine)) return null; rings = fine; [a, gs0] = axisOf(rings); }
      const gL = gs0[rings.length - 1];
      if (dot(a, [gL[0] - gs0[0][0], gL[1] - gs0[0][1], gL[2] - gs0[0][2]]) < 0) a = a.map(x => -x);
      if (rings.some((ps, k) => ps.some(p => Math.abs(dot([p[0] - gs0[k][0], p[1] - gs0[k][1], p[2] - gs0[k][2]], a)) > 3e-3))) return null;
      const ux0 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], dd = dot(ux0, a), e1 = (v => { const l = Math.hypot(...v); return v.map(x => x / l); })([ux0[0] - a[0] * dd, ux0[1] - a[1] * dd, ux0[2] - a[2] * dd]);
      const e2 = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]];
      const circle = (ps, g) => {
        if (ps.length === 1) return { c: ps[0], r: 0, ps };
        const M3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b3 = [0, 0, 0], xy = ps.map(p => { const q = [p[0] - g[0], p[1] - g[1], p[2] - g[2]]; return [dot(q, e1), dot(q, e2)]; });
        for (const [x, y] of xy) { const row = [x, y, 1], z = x * x + y * y; for (let i = 0; i < 3; i++) { b3[i] += row[i] * z; for (let j = 0; j < 3; j++) M3[i][j] += row[i] * row[j]; } }
        const sol = solveN(M3, b3);
        if (!sol) return null;
        const cx = sol[0] / 2, cy = sol[1] / 2, rr = Math.sqrt(Math.max(0, sol[2] + cx * cx + cy * cy));
        if (!(rr > 1e-3) || xy.some(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - rr) > Math.max(2e-3, 2e-4 * rr))) return null;
        return { c: [g[0] + e1[0] * cx + e2[0] * cy, g[1] + e1[1] * cx + e2[1] * cy, g[2] + e1[2] * cx + e2[2] * cy], r: rr, ps };
      };
      const cs = rings.map((ps, k) => circle(ps, gs0[k]));
      if (cs.some(c => !c)) return null;
      const cA = cs[0], cB = cs[cs.length - 1];
      const dv = [cB.c[0] - cA.c[0], cB.c[1] - cA.c[1], cB.c[2] - cA.c[2]], h = dot(dv, a);
      if (!(h > 1e-3) || Math.abs(cA.r - cB.r) < Math.max(1e-3, 1e-3 * h)) return null;
      // all centres on the axis, the radius growing evenly along it
      for (const c of cs) {
        const q = [c.c[0] - cA.c[0], c.c[1] - cA.c[1], c.c[2] - cA.c[2]], tq = dot(q, a);
        if (Math.hypot(q[0] - a[0] * tq, q[1] - a[1] * tq, q[2] - a[2] * tq) > Math.max(3e-3, 1e-3 * h) || Math.abs(c.r - (cA.r + ((cB.r - cA.r) * tq) / h)) > Math.max(3e-3, 3e-4 * Math.max(cA.r, cB.r))) return null;
      }
      const wideB = cB.r > cA.r, d = wideB ? a : a.map(x => -x), small = wideB ? cA : cB, big = wideB ? cB : cA, kk = (big.r - small.r) / h;
      const apex = small.c.map((x, i) => x - d[i] * (small.r / kk)), t0 = small.r / kk, t1 = big.r / kk, A = cA.ps, B = cB.ps;
      const tOf = p => dot([p[0] - apex[0], p[1] - apex[1], p[2] - apex[2]], d);
      // how far round, and the widest step between two corners
      const ux = (v => { const l = Math.hypot(...v); return v.map(x => x / l); })((wideB ? B : A)[0].map((x, i) => x - big.c[i])), w = [d[1] * ux[2] - d[2] * ux[1], d[2] * ux[0] - d[0] * ux[2], d[0] * ux[1] - d[1] * ux[0]];
      const angs = (ps, c) => ps.map(p => { const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]]; return Math.atan2(dot(q, w), dot(q, ux)); }).sort((p, q) => p - q);
      const gapsOf = an => an.map((x, i) => (i ? x - an[i - 1] : x + 2 * Math.PI - an[an.length - 1]));
      const aw = angs(wideB ? B : A, big.c), gw = gapsOf(aw);
      // (the other rings: their steps without the open stretch of a part of a ring)
      const others = cs.filter(c => c !== big && c.r > 0.05).map(c => gapsOf(angs(c.ps, c.c)).sort((p, q) => q - p));
      const med = gw.slice().sort((p, q) => p - q)[gw.length >> 1], wi = gw.indexOf(Math.max(...gw));
      let seg = null, step = Math.max(...gw);
      if (gw[wi] > 2.5 * med && gw[wi] > 0.5) {
        const sweep = 2 * Math.PI - gw[wi];
        if (sweep < 0.5) return null;
        seg = { a0: aw[wi], sweep, u: ux, w };
        step = Math.max(...gw.filter((_, i) => i !== wi), ...others.flatMap(g => g.slice(1)));
      } else step = Math.max(step, ...others.flat());
      if (!(step > 1e-4) || step > 1.3) return null;
      // material inside (pin) or outside (hole)
      let side = 0, star = 0;
      const O = small.c;
      for (const t of tris) {
        const p = V(I[t * 3]), q = V(I[t * 3 + 1]), r3 = V(I[t * 3 + 2]), u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r3[0] - p[0], r3[1] - p[1], r3[2] - p[2]];
        const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], g = [(p[0] + q[0] + r3[0]) / 3, (p[1] + q[1] + r3[1]) / 3, (p[2] + q[2] + r3[2]) / 3];
        const tt = tOf(g), rad = [g[0] - apex[0] - d[0] * tt, g[1] - apex[1] - d[1] * tt, g[2] - apex[2] - d[2] * tt];
        side += Math.sign(dot(n, rad));
        star += dot(n, [p[0] - O[0], p[1] - O[1], p[2] - O[2]]) / 6;
      }
      if (Math.abs(side) !== tris.length) return null;
      // what the facets leave out of the cone: both seen from the centre of the small ring
      // (… and the cone from that centre to the wide ring reaches further where the ring is a circle, not a polygon)
      const lune = gw.reduce((q, g, i) => q + (seg && i === wi ? 0 : g - Math.sin(g)), 0);
      const vol = ((seg ? seg.sweep : 2 * Math.PI) / 2) * (h / 3) * (small.r * small.r + small.r * big.r) - Math.sign(side) * star + (h / 3) * 0.5 * big.r * big.r * lune;
      if (!(vol > 0)) return null;
      return { apex, d, t0, t1, r0: small.r, r1: big.r, hole: side < 0, n: Math.max(minFacets, Math.floor((2 * Math.PI) / step + 1e-3)), vol, ...(seg || {}) };
    };
    {
      // without the large flat faces that run on from it (the chamfer between two rounded corners), piece by piece
      const keep = regs.map((_, i) => i).filter(i => area[bigIdx[i]] <= 20 * amed), at = new Map(keep.map(i => [regs[i], i])), pr = new Map(keep.map(i => [i, i]));
      const fd = x => { while (pr.get(x) !== x) { pr.set(x, pr.get(pr.get(x))); x = pr.get(x); } return x; };
      for (const [p, q] of soft) { const i = at.get(p), j = at.get(q); if (i === undefined || j === undefined) continue; const ri = fd(i), rj = fd(j); if (ri !== rj) pr.set(rj, ri); }
      const groups = new Map();
      for (const i of keep) { const g = fd(i); let l = groups.get(g); if (!l) groups.set(g, (l = [])); l.push(i); }
      const found = [];
      for (const l of groups.values()) { if (l.length < minSeg) continue; const rc = ringCone(l.map(i => regs[i]), l.map(i => nrm[i])); if (rc) found.push(rc); }
      if (found.length) { cones.push(...found); continue; }
    }
    // (after the rings: where both fit, the rings take in the irregular band at the rim as well)
    const co = cone(regs, nrm);
    if (co) { cones.push(co); continue; }
    sph: {
    if (regs.length < minFacets) break sph;
    // ---- a sphere: every corner at the same distance from one point ----
    // (a large flat face that runs on from the patch – the plate under a low dome – is not part of it)
    const keepI = regs.map((_, i) => i).filter(i => area[bigIdx[i]] <= 20 * amed), regsS = keepI.map(i => regs[i]), nrmS = keepI.map(i => nrm[i]);
    if (regsS.length < minFacets) break sph;
    const trisS = regsS.flatMap(r => T.get(r)), pts = [...new Set(trisS.flatMap(t => [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]))].map(V);
    const fit = ps => {
      const g = [0, 1, 2].map(k => ps.reduce((a, p) => a + p[k], 0) / ps.length);
      const M4 = Array.from({ length: 4 }, () => [0, 0, 0, 0]), b4 = [0, 0, 0, 0];
      for (const p of ps) { const x = [p[0] - g[0], p[1] - g[1], p[2] - g[2], 1], z = x[0] * x[0] + x[1] * x[1] + x[2] * x[2]; for (let i = 0; i < 4; i++) { b4[i] += x[i] * z; for (let j = 0; j < 4; j++) M4[i][j] += x[i] * x[j]; } }
      const sol = solveN(M4, b4);
      if (!sol) return null;
      const r2 = sol[3] + (sol[0] * sol[0] + sol[1] * sol[1] + sol[2] * sol[2]) / 4;
      return r2 > 1e-6 ? { c: [sol[0] / 2 + g[0], sol[1] / 2 + g[1], sol[2] / 2 + g[2]], r: Math.sqrt(r2) } : null;
    };
    // the corners of the facets lie on the sphere; points a cut has made lie on the facets, a little inside:
    // they are left out of the fit, and may be up to the height of a facet's bulge inside
    let S = fit(pts), onS = pts;
    // best: the true corners of the facets – where three or more of them meet. (A point a cut has made lies on
    // an edge between two facets or inside one.)
    {
      const pk = v => Math.round(P[v * 3] * 1e4) + "," + Math.round(P[v * 3 + 1] * 1e4) + "," + Math.round(P[v * 3 + 2] * 1e4);
      const cnt = new Map();
      for (const t of trisS) for (let q = 0; q < 3; q++) { const k = pk(I[t * 3 + q]), e = cnt.get(k); if (e) e[0].add(reg[t]); else cnt.set(k, [new Set([reg[t]]), I[t * 3 + q]]); }
      const inner = [...cnt.values()].filter(e => e[0].size >= 3).map(e => V(e[1])), Si = inner.length >= 12 ? fit(inner) : null;
      if (Si && inner.every(p => Math.abs(Math.hypot(p[0] - Si.c[0], p[1] - Si.c[1], p[2] - Si.c[2]) - Si.r) < Math.max(2e-3, 2e-4 * Si.r))) { S = Si; onS = null; }
    }
    // (the band is drawn tighter step by step: a first fit through all points is still off)
    for (const bnd of onS ? [5e-3, 2e-3, 1e-3, 5e-4, 2e-4] : []) {
      if (!S) break;
      const dist = p => Math.hypot(p[0] - S.c[0], p[1] - S.c[1], p[2] - S.c[2]) - S.r, top = Math.max(...pts.map(dist));
      const keep = pts.filter(p => dist(p) > top - Math.max(2e-3, bnd * S.r));
      if (keep.length < 8) break;
      const S2 = fit(keep);
      if (!S2) break;
      S = S2; onS = keep;
    }
    if (!S || (onS && onS.length < Math.max(8, 0.15 * pts.length))) break sph;
    const c = S.c, r = S.r, tol = Math.max(3e-3, 1.5e-3 * r);
    if (pts.some(p => { const e = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) - r; return e > tol || e < -0.04 * r - tol; })) break sph;
    // the normals look away from the centre (ball) or to it (hollow); the volume under the sphere and over the facets
    let side = 0, vol = 0, okS = true;
    for (const t of trisS) {
      const A = V(I[t * 3]).map((x, k) => x - c[k]), B = V(I[t * 3 + 1]).map((x, k) => x - c[k]), Cc = V(I[t * 3 + 2]).map((x, k) => x - c[k]);
      const det = A[0] * (B[1] * Cc[2] - B[2] * Cc[1]) - A[1] * (B[0] * Cc[2] - B[2] * Cc[0]) + A[2] * (B[0] * Cc[1] - B[1] * Cc[0]);
      const la = Math.hypot(...A), lb = Math.hypot(...B), lc = Math.hypot(...Cc), dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
      const om = 2 * Math.atan2(Math.abs(det), la * lb * lc + dot(A, B) * lc + dot(A, Cc) * lb + dot(B, Cc) * la);
      vol += (r * r * r * om) / 3 - Math.abs(det) / 6;
      const sgn = Math.sign(det);
      if (side && sgn && sgn !== side) { okS = false; break; }
      side = sgn || side;
    }
    if (!okS || !side) break sph;
    // every facet lies across its radius (two rings of points alone – a cone, a cylinder – lie on a sphere too)
    if (regsS.some((rg, i) => { const g = [0, 0, 0], tt = T.get(rg); for (const t of tt) for (let q = 0; q < 3; q++) { const p = V(I[t * 3 + q]); g[0] += p[0] - c[0]; g[1] += p[1] - c[1]; g[2] += p[2] - c[2]; } const l = Math.hypot(...g) || 1; return Math.abs(nrmS[i][0] * g[0] + nrmS[i][1] * g[1] + nrmS[i][2] * g[2]) / l < 0.97 || l / (3 * tt.length) < 0.955 * r; })) break sph;
    // where the patch lies: the direction of its middle, how far it reaches from there, how deep its facets go
    const ax = [0, 0, 0];
    for (const p of pts) { const l = Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) || 1; ax[0] += (p[0] - c[0]) / l; ax[1] += (p[1] - c[1]) / l; ax[2] += (p[2] - c[2]) / l; }
    const al = Math.hypot(...ax);
    let alpha = Math.PI, rin = r;
    if (al > 1e-6 * pts.length) { ax[0] /= al; ax[1] /= al; ax[2] /= al; alpha = Math.max(...pts.map(p => Math.acos(Math.max(-1, Math.min(1, ((p[0] - c[0]) * ax[0] + (p[1] - c[1]) * ax[1] + (p[2] - c[2]) * ax[2]) / (Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) || 1)))))); }
    regsS.forEach((rg, i) => { const p = V(I[T.get(rg)[0] * 3]); rin = Math.min(rin, Math.abs(nrmS[i][0] * (p[0] - c[0]) + nrmS[i][1] * (p[1] - c[1]) + nrmS[i][2] * (p[2] - c[2]))); });
    {
      // (the shreds between the facets belong to the patch)
      const own = new Set(trisS);
      const angOf = p => { const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], l = Math.hypot(...q) || 1; return Math.abs(l - r) < tol ? Math.acos(Math.max(-1, Math.min(1, (q[0] * ax[0] + q[1] * ax[1] + q[2] * ax[2]) / l))) : Infinity; };
      if (alpha < 3.1) for (const rg of allRegs) for (const x of T.get(rg)) { if (own.has(x)) continue; const an = [angOf(V(I[x * 3])), angOf(V(I[x * 3 + 1])), angOf(V(I[x * 3 + 2]))]; if (an.every(q => q < alpha + 1e-3) && an.some(q => q < alpha - 3e-3)) { own.add(x); trisS.push(x); } }
    }
    spheres.push({ c, r, hole: side < 0, vol, n: trisS.length, ax, alpha, rin, ti: trisS });
    continue;
    }
    {
      // ---- a torus: the corners lie in rings around an axis, the rings on a circle in the plane through it ----
      const torus = (rs, ns) => {
        const tris = rs.flatMap(r => T.get(r));
        if (tris.length < 4 * minSeg) return null;
        const pts = [...new Set(tris.flatMap(t => [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]))].map(V);
        if (pts.length < 12) return null;
        const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
        const g0 = [0, 1, 2].map(k => pts.reduce((s, p) => s + p[k], 0) / pts.length);
        const tryAxis = (a, tris, pts) => {
          const ord = pts.map(p => [dot(p, a), p]).sort((p, q) => p[0] - q[0]);
          if (ord[ord.length - 1][0] - ord[0][0] < 1e-2) return null;
          const rings = [[ord[0]]];
          for (let i = 1; i < ord.length; i++) { if (ord[i][0] - ord[i - 1][0] > 2e-3) rings.push([]); rings[rings.length - 1].push(ord[i]); }
          if (rings.length < 4 || rings.length > 80 || rings.some(r => r.length < 3)) return null;
          const ux0 = Math.abs(a[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], dd = dot(ux0, a), e1 = (v => { const l = Math.hypot(...v); return v.map(x => x / l); })([ux0[0] - a[0] * dd, ux0[1] - a[1] * dd, ux0[2] - a[2] * dd]);
          const e2 = [a[1] * e1[2] - a[2] * e1[1], a[2] * e1[0] - a[0] * e1[2], a[0] * e1[1] - a[1] * e1[0]];
          const xyOf = p => { const q = [p[0] - g0[0], p[1] - g0[1], p[2] - g0[2]]; return [dot(q, e1), dot(q, e2)]; };
          // every ring a circle, all about one centre
          const cs = [];
          for (const ring of rings) {
            const M3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b3 = [0, 0, 0], xy = ring.map(q => xyOf(q[1]));
            for (const [x, y] of xy) { const row = [x, y, 1], z = x * x + y * y; for (let i = 0; i < 3; i++) { b3[i] += row[i] * z; for (let j = 0; j < 3; j++) M3[i][j] += row[i] * row[j]; } }
            const sol = solveN(M3, b3);
            if (!sol) return null;
            const cx = sol[0] / 2, cy = sol[1] / 2, rr = Math.sqrt(Math.max(0, sol[2] + cx * cx + cy * cy));
            if (!(rr > 1e-3) || xy.some(([x, y]) => Math.abs(Math.hypot(x - cx, y - cy) - rr) > Math.max(2e-3, 2e-4 * rr))) return null;
            cs.push([cx, cy, rr, ring.length]);
          }
          // (the rings with the most corners say best where the axis is)
          const wsum = cs.reduce((s, c) => s + c[3], 0), cx = cs.reduce((s, c) => s + c[0] * c[3], 0) / wsum, cy = cs.reduce((s, c) => s + c[1] * c[3], 0) / wsum, rmax = Math.max(...cs.map(c => c[2]));
          if (cs.some(c => Math.hypot(c[0] - cx, c[1] - cy) > Math.max(5e-3, 2e-3 * rmax))) return null;
          const rt = rings.map(ring => [ring.reduce((s, q) => { const [x, y] = xyOf(q[1]); return s + Math.hypot(x - cx, y - cy); }, 0) / ring.length, ring.reduce((s, q) => s + q[0], 0) / ring.length]);
          // the rings on a circle in the plane through the axis
          const M3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b3 = [0, 0, 0], tm = rt.reduce((s, q) => s + q[1], 0) / rt.length;
          for (const [x, t] of rt) { const y = t - tm, row = [x, y, 1], z = x * x + y * y; for (let i = 0; i < 3; i++) { b3[i] += row[i] * z; for (let j = 0; j < 3; j++) M3[i][j] += row[i] * row[j]; } }
          const sol = solveN(M3, b3);
          if (!sol) return null;
          const Rc = sol[0] / 2, tc = sol[1] / 2 + tm, r = Math.sqrt(Math.max(0, sol[2] + Rc * Rc + (sol[1] / 2) ** 2)), h = rt[rt.length - 1][1] - rt[0][1];
          const tol = Math.max(3e-3, 1e-3 * r);
          if (!(r > 1e-2) || r > 50 * h || !(Rc > 0.02 * r) || rt.some(([x, t]) => Math.abs(Math.hypot(x - Rc, t - tc) - r) > tol)) return null;
          // one half of the tube: away from the axis or towards it
          const cosv = rt.map(([x]) => (x - Rc) / r);
          const inner = cosv.every(c => c < 1e-3) ? true : cosv.every(c => c > -1e-3) ? false : null;
          if (inner === null) return null;
          // (angle above the plane of the torus; a quarter ends square)
          const sOf = ([x, t]) => { const s = Math.atan2(t - tc, Math.abs(x - Rc)), q = Math.round(s / (Math.PI / 2)) * (Math.PI / 2); return Math.abs(s - q) < 2e-3 ? q : s; }, s0 = sOf(rt[0]), s1 = sOf(rt[rt.length - 1]);
          if (s1 - s0 < 0.05) return null;
          // every corner on the torus; how far the facets leave it; which side the material is on
          const O = [g0[0] + e1[0] * cx + e2[0] * cy, g0[1] + e1[1] * cx + e2[1] * cy, g0[2] + e1[2] * cx + e2[2] * cy], tO = dot(O, a);
          const rhoT = p => { const t = dot(p, a) - tO, q = [p[0] - O[0] - a[0] * t, p[1] - O[1] - a[1] * t, p[2] - O[2] - a[2] * t], rho = Math.hypot(...q); return [rho, t + tO, q]; };
          const sOfP = p => { const [rho, t] = rhoT(p); return Math.hypot(rho - Rc, t - tc); };
          if (pts.some(p => Math.abs(sOfP(p) - r) > tol)) return null;
          let side = 0, star = 0, sMin = r, sMax = r;
          const OA = O.map((x, k) => x + a[k] * (rt[0][1] - tO));
          for (const t of tris) {
            const p = V(I[t * 3]), q = V(I[t * 3 + 1]), r3 = V(I[t * 3 + 2]), u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], v = [r3[0] - p[0], r3[1] - p[1], r3[2] - p[2]];
            const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], g = [(p[0] + q[0] + r3[0]) / 3, (p[1] + q[1] + r3[1]) / 3, (p[2] + q[2] + r3[2]) / 3];
            const [rho, tg, rad] = rhoT(g), k = rho > 1e-9 ? (rho - Rc) / rho : 0, out = [rad[0] * k + a[0] * (tg - tc), rad[1] * k + a[1] * (tg - tc), rad[2] * k + a[2] * (tg - tc)];
            side += Math.sign(dot(n, out));
            star += dot(n, [p[0] - OA[0], p[1] - OA[1], p[2] - OA[2]]) / 6;
            for (const x of [g, [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], [(q[0] + r3[0]) / 2, (q[1] + r3[1]) / 2, (q[2] + r3[2]) / 2], [(p[0] + r3[0]) / 2, (p[1] + r3[1]) / 2, (p[2] + r3[2]) / 2]]) { const s = sOfP(x); sMin = Math.min(sMin, s); sMax = Math.max(sMax, s); }
          }
          if (Math.abs(side) !== tris.length) return null;
          // how far round: the ring with the most corners
          const big = rings.reduce((b, x) => (x.length > b.length ? x : b), rings[0]);
          const angsOf = ring => ring.map(q => { const [x, y] = xyOf(q[1]); return Math.atan2(y - cy, x - cx); }).sort((p, q) => p - q);
          const gapsOf = an => an.map((x, i) => (i ? x - an[i - 1] : x + 2 * Math.PI - an[an.length - 1]));
          const aw = angsOf(big), gw = gapsOf(aw), med = gw.slice().sort((p, q) => p - q)[gw.length >> 1], wi = gw.indexOf(Math.max(...gw));
          let seg = null, step = Math.max(...gw);
          if (gw[wi] > 2.5 * med && gw[wi] > 0.5) {
            const sweep = 2 * Math.PI - gw[wi];
            if (sweep < 0.2) return null;
            seg = { a0: aw[wi], sweep, u: e1, w: e2 };
            step = Math.max(...gw.filter((_, i) => i !== wi));
          }
          if (!(step > 1e-4) || step > 1.3) return null;
          // between the facets and the torus (outer half: the facets lie inside the tube all over). Seen from the
          // axis at the height of the first ring: the torus, the facets, and the flat rim at the last ring where a
          // circle reaches further than its polygon
          let vol = null;
          if (!inner) {
            const phi = seg ? seg.sweep : 2 * Math.PI, tA = rt[0][1], K = 64;
            let integ = 0;
            for (let i = 0; i <= K; i++) {
              const s = s0 + ((s1 - s0) * i) / K, rho = Rc + r * Math.cos(s), t = tc + r * Math.sin(s) - tA, f = rho * (rho * r * Math.cos(s) + t * r * Math.sin(s));
              integ += f * (i === 0 || i === K ? 1 : i % 2 ? 4 : 2);
            }
            const VT = (phi / 3) * ((integ * (s1 - s0)) / (3 * K));
            const gB = gapsOf(angsOf(rings[rings.length - 1])), bi = gB.indexOf(Math.max(...gB)), rB = rt[rt.length - 1][0];
            const lune = gB.reduce((q, g, i) => q + (seg && i === bi ? 0 : g - Math.sin(g)), 0);
            vol = VT - Math.sign(side) * star + (h / 3) * 0.5 * rB * rB * lune;
            if (!(vol > 0)) return null;
          }
          return { c: O.map((x, k) => x + a[k] * (tc - tO)), d: a, R: Rc, r, s0, s1, inner, hole: side < 0, n: Math.max(minFacets, Math.floor((2 * Math.PI) / step + 1e-3)), vol, oa: OA, din: r - sMin, dout: sMax - r, tris: tris.length, ti: tris, ...(seg || {}) };
        };
        // (the normals of a fillet all the way round vary least along its axis)
        const mean = [0, 0, 0], C = [0, 0, 0, 0, 0, 0];
        for (const n of ns) for (let k = 0; k < 3; k++) mean[k] += n[k] / ns.length;
        for (const n of ns) { const x = n[0] - mean[0], y = n[1] - mean[1], z = n[2] - mean[2]; C[0] += x * x; C[1] += x * y; C[2] += x * z; C[3] += y * y; C[4] += y * z; C[5] += z * z; }
        let own = [];
        try { own = eig3(C).vec; } catch { /* the known axes only */ }
        // (a row of strips that runs on from the fillet – the wall of a cylinder the search has not taken – would
        // spoil the fit: the rings at the two ends are left away, one by one)
        const tryTrim = a => {
          let res = tryAxis(a, tris, pts);
          if (res) return res;
          const hs = pts.map(p => dot(p, a)).sort((p, q) => p - q), H = [hs[0]];
          for (let i = 1; i < hs.length; i++) if (hs[i] - hs[i - 1] > 2e-3) H.push(hs[i]);
          if (H.length < 5 || H.length > 80) return null;
          const top = k => { const nx = H[k + 1]; let e = H[k]; for (const h of hs) { if (nx !== undefined && h >= nx) break; if (h > e) e = h; } return e; };
          // (a cone that runs on from the fillet has a few rings of its own)
          for (const [lo, hi] of [[1, 0], [0, 1], [1, 1], [2, 0], [0, 2], [2, 1], [1, 2], [2, 2], [3, 0], [0, 3], [3, 1], [1, 3], [4, 0], [0, 4], [4, 1], [1, 4], [3, 3], [4, 4]]) {
            if (H.length - lo - hi < 4) continue;
            const tLo = H[lo] - 1e-3, tHi = top(H.length - 1 - hi) + 1e-3;
            const sub = tris.filter(t => { for (let k = 0; k < 3; k++) { const h = dot(V(I[t * 3 + k]), a); if (h < tLo || h > tHi) return false; } return true; });
            if (sub.length < 4 * minSeg) continue;
            const ps = [...new Set(sub.flatMap(t => [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]))].map(V);
            if (ps.length < 12) continue;
            res = tryAxis(a, sub, ps);
            if (res) return res;
          }
          return null;
        };
        for (const a of [...axes0, ...cones.map(c => c.d), ...own]) { if (!a || !a.every(Number.isFinite)) continue; const t = tryTrim(a); if (t) return t; }
        return null;
      };
      const keep = regs.map((_, i) => i).filter(i => area[bigIdx[i]] <= 20 * amed), at = new Map(keep.map(i => [regs[i], i])), pr = new Map(keep.map(i => [i, i]));
      const fd = x => { while (pr.get(x) !== x) { pr.set(x, pr.get(pr.get(x))); x = pr.get(x); } return x; };
      for (const [p, q] of soft) { const i = at.get(p), j = at.get(q); if (i === undefined || j === undefined) continue; const ri = fd(i), rj = fd(j); if (ri !== rj) pr.set(rj, ri); }
      const groups = new Map();
      for (const i of keep) { const g = fd(i); let l = groups.get(g); if (!l) groups.set(g, (l = [])); l.push(i); }
      const found = [];
      for (const l of groups.values()) { if (l.length < minSeg) continue; const to = torus(l.map(i => regs[i]), l.map(i => nrm[i])); if (to) found.push(to); }
      if (found.length) {
        // the shreds between the facets (too small to count as facets) belong to the face they lie on
        const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
        for (const to of found) {
          const own = new Set(to.ti), tol = Math.max(3e-3, 1e-3 * to.r), lo = to.r * Math.sin(to.s0) - tol, hi = to.r * Math.sin(to.s1) + tol;
          const on = p => { const q = [p[0] - to.c[0], p[1] - to.c[1], p[2] - to.c[2]], tt = dot(q, to.d), rho = Math.hypot(q[0] - to.d[0] * tt, q[1] - to.d[1] * tt, q[2] - to.d[2] * tt); return tt > lo && tt < hi && Math.abs(Math.hypot(rho - to.R, tt) - to.r) < tol && (to.inner ? rho < to.R + tol : rho > to.R - tol); };
          // (and single triangles that lie in the plane of a neighbour, as a mesher leaves them at its seam; not those of the flat faces at the two ends)
          const end = (p, h) => Math.abs((p[0] - to.c[0]) * to.d[0] + (p[1] - to.c[1]) * to.d[1] + (p[2] - to.c[2]) * to.d[2] - h) < tol, hA = to.r * Math.sin(to.s0), hB = to.r * Math.sin(to.s1);
          for (const r of allRegs) for (const x of T.get(r)) { if (own.has(x)) continue; const ps = [V(I[x * 3]), V(I[x * 3 + 1]), V(I[x * 3 + 2])]; if (ps.every(on) && !ps.every(p => end(p, hA)) && !ps.every(p => end(p, hB))) {
            own.add(x); to.ti.push(x);
            // (the volume between the facets and the torus counts them too)
            if (to.vol != null) { const p = V(I[x * 3]), q = V(I[x * 3 + 1]), r3 = V(I[x * 3 + 2]), u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r3[0] - p[0], r3[1] - p[1], r3[2] - p[2]]; to.vol -= ((to.hole ? -1 : 1) * dot([u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]], [p[0] - to.oa[0], p[1] - to.oa[1], p[2] - to.oa[2]])) / 6; }
          } }
        }
        tori.push(...found);
        continue;
      }
    }
    {
      // several parts of cones in one piece – the chamfer round a plate with rounded corners: the flat chamfers
      // between them touch the cones (and pass through their apexes), so the strips are told apart by their
      // size: the strips of one part of a cone are all alike
      const areaB = bigIdx.map(i => area[i]), at = new Map(regs.map((r, i) => [r, i])), adj = regs.map(() => []);
      for (const [a, b] of soft) { const i = at.get(a), j = at.get(b); if (i !== undefined && j !== undefined) { adj[i].push(j); adj[j].push(i); } }
      const dOf = i => { const n = nrm[i], p = V(I[T.get(regs[i])[0] * 3]); return n[0] * p[0] + n[1] * p[1] + n[2] * p[2]; };
      const free = new Set(regs.map((_, i) => i));
      let found = 0;
      for (let seed = 0; seed < regs.length; seed++) {
        if (!free.has(seed)) continue;
        const like = j => free.has(j) && Math.abs(areaB[j] - areaB[seed]) < 0.05 * areaB[seed];
        const grp = [seed], seen = new Set([seed]);
        for (let q = 0; q < grp.length; q++) for (const j of adj[grp[q]]) if (!seen.has(j) && like(j)) { seen.add(j); grp.push(j); }
        if (grp.length <= minSeg) continue;
        // (they have to meet in one point)
        const M = [[0, 0, 0], [0, 0, 0], [0, 0, 0]], b = [0, 0, 0];
        for (const i of grp) { const n = nrm[i], dd = dOf(i); for (let x = 0; x < 3; x++) { b[x] += n[x] * dd; for (let y = 0; y < 3; y++) M[x][y] += n[x] * n[y]; } }
        const ap = solveN(M, b);
        if (!ap || grp.some(i => Math.abs(nrm[i][0] * ap[0] + nrm[i][1] * ap[1] + nrm[i][2] * ap[2] - dOf(i)) > 0.02)) continue;
        const c2 = cone(grp.map(i => regs[i]), grp.map(i => nrm[i]));
        if (c2) { cones.push(c2); for (const i of grp) free.delete(i); found++; }
      }
    }
  }
  // a row of facets along the tube of a torus looks like a short piece of a cylinder: such pieces go back to
  // the torus they lie on, and the search runs once more without them
  if (!veto && tori.length) {
    const onTorus = c => arcOnTorus(c, tori);
    if (cylinders.some(onTorus)) return findRound(m, minFacets, onTorus);
  }
  for (const c of cylinders) delete c.regs;
  return { cylinders, cones: cones.sort((a, b) => b.r1 - a.r1), spheres: spheres.sort((a, b) => b.r - a.r), tori: tori.sort((a, b) => b.R - a.R) };
}

/**
 * Before a faceted mesh becomes a solid: the many small facets of a recognised torus or of the cap of a sphere
 * are replaced by a few large ones inside the true face (a kernel needs minutes to cut a round face against
 * thousands of facets that touch it; against a handful it is done at once). The rims stay as they are, so the
 * mesh stays closed. tori, spheres: from findRound (with their triangles, ti).
 * Returns { m, tori: [{ src, din, dout, vol }], spheres: [{ src, h0, vol }] } – what was replaced, how far the
 * new facets lie inside (din) and outside (dout) the tube, the volume between them and the true face; for a
 * sphere the height of the flat lid above the centre, along src.ax.
 */
export function standIn(m, tori = [], spheres = []) {
  const P = m.pos, I = m.idx, nT = I.length / 3;
  const pos = Array.from(P), gone = new Uint8Array(nT), extra = [], outT = [], outS = [];
  const V = v => [pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]];
  const addV = p => { pos.push(p[0], p[1], p[2]); return pos.length / 3 - 1; };
  const dot = (p, q) => p[0] * q[0] + p[1] * q[1] + p[2] * q[2];
  // the rim of a set of triangles: closed rows of corners, in the direction the triangles run along them
  const rimOf = ti => {
    const cnt = new Map(), key = (a, b) => (a < b ? a + '_' + b : b + '_' + a);
    for (const t of ti) for (let k = 0; k < 3; k++) { const e = key(I[t * 3 + k], I[t * 3 + (k + 1) % 3]); cnt.set(e, (cnt.get(e) || 0) + 1); }
    const next = new Map();
    for (const t of ti) for (let k = 0; k < 3; k++) { const a = I[t * 3 + k], b = I[t * 3 + (k + 1) % 3]; if (cnt.get(key(a, b)) !== 1) continue; if (next.has(a)) return null; next.set(a, b); }
    const dir = new Map(next), loops = [];
    while (next.size) {
      const start = next.keys().next().value, loop = [];
      let v = start;
      do { loop.push(v); const n = next.get(v); if (n === undefined) return null; next.delete(v); v = n; } while (v !== start);
      loops.push(loop);
    }
    return { loops, dir };
  };
  const star = tris => { let s = 0; for (const [a, b, c] of tris) { const p = V(a), q = V(b), r = V(c); s += (p[0] * (q[1] * r[2] - q[2] * r[1]) - p[1] * (q[0] * r[2] - q[2] * r[0]) + p[2] * (q[0] * r[1] - q[1] * r[0])) / 6; } return s; };
  const trisOf = ti => ti.map(t => [I[t * 3], I[t * 3 + 1], I[t * 3 + 2]]);
  for (const t of tori) {
    // (a ring on its own needs no stand-in: it becomes a torus as it is)
    if (!t.ti || t.whole || t.ti.length < 40 || t.ti.some(x => gone[x])) continue;
    // a quarter of a tube between a cylinder and a flat face: a sharp corner stands in – two faces a kernel cuts
    // at once, and all of it on one side of the true face (the half of a tube that looks to the axis has its
    // facets on both sides: it is done this way or not at all)
    const q0 = Math.abs(t.s0) < 1e-6, q1 = Math.abs(t.s1) < 1e-6;
    const span = t.s1 - t.s0, cornerQ = Math.abs(span - Math.PI / 2) < 1e-6 && q0 !== q1 && (!t.inner || t.R >= 1.6 * t.r);
    // any other piece of the outer half of a tube (a half-round rim, the fillet between a cone and a flat face):
    // the tangents at its two ends stand in, meeting in one corner – or in two, with the tangent in the middle,
    // where the piece is long
    const nC = !cornerQ && !t.inner && t.vol != null && span > 0.3 && span < Math.PI + 1e-6 ? (span > 0.6 * Math.PI ? 2 : 1) : 0;
    const corner = cornerQ || nC > 0;
    if (t.inner && !corner) continue;
    const rim = rimOf(t.ti);
    if (!rim) continue;
    const c = t.c, d = t.d, sg = t.inner ? -1 : 1, part = !!t.sweep;
    let e1 = t.u, e2 = t.w;
    if (!part) { const ux = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], dd = dot(ux, d), v = [ux[0] - d[0] * dd, ux[1] - d[1] * dd, ux[2] - d[2] * dd], l = Math.hypot(...v); e1 = v.map(x => x / l); e2 = [d[1] * e1[2] - d[2] * e1[1], d[2] * e1[0] - d[0] * e1[2], d[0] * e1[1] - d[1] * e1[0]]; }
    const a0 = part ? t.a0 : 0, sweep = part ? t.sweep : 2 * Math.PI;
    const co = v => {
      const p = V(v), q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], tt = dot(q, d), rad = [q[0] - d[0] * tt, q[1] - d[1] * tt, q[2] - d[2] * tt], rho = Math.hypot(...rad);
      let ang = (((Math.atan2(dot(rad, e2), dot(rad, e1)) - a0) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      if (part && ang > sweep + (2 * Math.PI - sweep) / 2) ang -= 2 * Math.PI;
      return { v, tt, rho, ang, s: Math.atan2(tt, Math.abs(rho - t.R)) };
    };
    const onTorus = (ang, s) => { const rho = t.R + sg * t.r * Math.cos(s), ca = Math.cos(ang + a0), sa = Math.sin(ang + a0); return [c[0] + rho * (e1[0] * ca + e2[0] * sa) + d[0] * t.r * Math.sin(s), c[1] + rho * (e1[1] * ca + e2[1] * sa) + d[1] * t.r * Math.sin(s), c[2] + rho * (e1[2] * ca + e2[2] * sa) + d[2] * t.r * Math.sin(s)]; };
    const tA = t.r * Math.sin(t.s0), tB = t.r * Math.sin(t.s1), tolT = Math.max(3e-3, 1e-3 * t.r);
    let A, B, ch0 = null, chE = null;
    if (!part) {
      if (rim.loops.length !== 2) continue;
      const L = rim.loops.map(l => l.map(co)), low = L.findIndex(l => l.every(q => Math.abs(q.tt - tA) < tolT)), high = L.findIndex(l => l.every(q => Math.abs(q.tt - tB) < tolT));
      if (low < 0 || high < 0 || low === high) continue;
      A = L[low]; B = L[high];
    } else {
      if (rim.loops.length !== 1) continue;
      const L = rim.loops[0].map(co), near = (q, a) => Math.abs(q.ang - a) < 5e-3 / Math.max(q.rho, 1e-6) + 1e-4;
      A = L.filter(q => Math.abs(q.tt - tA) < tolT); B = L.filter(q => Math.abs(q.tt - tB) < tolT);
      ch0 = L.filter(q => near(q, 0)).sort((p, q) => p.s - q.s); chE = L.filter(q => near(q, sweep)).sort((p, q) => p.s - q.s);
      if (L.some(q => !(Math.abs(q.tt - tA) < tolT || Math.abs(q.tt - tB) < tolT || near(q, 0) || near(q, sweep))) || ch0.length < 2 || chE.length < 2) continue;
      if (Math.abs(ch0[0].tt - tA) > tolT || Math.abs(chE[0].tt - tA) > tolT || Math.abs(ch0[ch0.length - 1].tt - tB) > tolT || Math.abs(chE[chE.length - 1].tt - tB) > tolT) continue;
    }
    A.sort((p, q) => p.ang - q.ang); B.sort((p, q) => p.ang - q.ang);
    if (A.length < 2 || B.length < 2) continue;
    // rings in between: the tube in steps of 45° at most, round the axis as coarse as 12 % of the tube allows
    const nb = Math.max(1, Math.ceil((t.s1 - t.s0) / (Math.PI / 4) - 1e-6)), rings = [A], sel0 = [0], selE = [0], v0 = pos.length;
    let bad = false;
    const cvs0 = [], cvsE = [];
    if (nC) {
      if (part && (Math.abs(A[0].ang) > 1e-3 || Math.abs(A[A.length - 1].ang - sweep) > 1e-3)) continue;
      const hh = span / (2 * nC), rhoA = t.R + t.r * Math.cos(t.s0), rx = t.r / Math.cos(hh);
      for (let k = 0; k < nC; k++) {
        const sk = t.s0 + hh * (2 * k + 1), fx = (t.R + rx * Math.cos(sk)) / rhoA, tx = rx * Math.sin(sk);
        const ring = A.map(q => { const p = V(q.v); return { v: addV([0, 1, 2].map(i => c[i] + d[i] * tx + (p[i] - c[i] - d[i] * q.tt) * fx)), ang: q.ang }; });
        rings.push(ring); cvs0.push(ring[0].v); cvsE.push(ring[ring.length - 1].v);
      }
    } else if (corner) {
      // the ring of the corner: straight above (or below) the ring on the cylinder, at the height of the flat face
      const X = q0 ? A : B, tc = q0 ? tB : tA;
      if (part && (Math.abs(X[0].ang) > 1e-3 || Math.abs(X[X.length - 1].ang - sweep) > 1e-3)) continue;
      const ring = X.map(q => { const p = V(q.v); return { v: addV([p[0] + d[0] * (tc - q.tt), p[1] + d[1] * (tc - q.tt), p[2] + d[2] * (tc - q.tt)]), ang: q.ang }; });
      rings.push(ring); cvs0.push(ring[0].v); cvsE.push(ring[ring.length - 1].v);
    }
    for (let j = 1; j < nb && !bad && !corner; j++) {
      let sj = t.s0 + (j * (t.s1 - t.s0)) / nb, sE = sj, first = null, last = null;
      if (part) {
        const pick = (ch, sel) => { let bi = -1, bd = Infinity; for (let i = sel[sel.length - 1] + 1; i < ch.length - 1; i++) { const e = Math.abs(ch[i].s - sj); if (e < bd) { bd = e; bi = i; } } if (bi < 0) return null; sel.push(bi); return ch[bi]; };
        first = pick(ch0, sel0); last = pick(chE, selE);
        if (!first || !last) { bad = true; break; }
        sj = first.s; sE = last.s;
      }
      const rho = t.R + sg * t.r * Math.cos(sj), n1 = Math.max(8, Math.min(Math.max(8, t.n), Math.ceil(Math.PI / Math.acos(Math.max(-1, 1 - (0.12 * t.r) / Math.max(rho, 1e-6)))))), k = part ? Math.max(2, Math.ceil((n1 * sweep) / (2 * Math.PI))) : n1;
      const ring = [];
      if (part) ring.push({ v: first.v, ang: 0 });
      for (let i = part ? 1 : 0; i < k; i++) { const ang = (sweep * i) / k; ring.push({ v: addV(onTorus(ang, sj + ((sE - sj) * i) / k)), ang }); }
      if (part) ring.push({ v: last.v, ang: sweep });
      rings.push(ring);
    }
    if (bad) { pos.length = v0; continue; }
    rings.push(B);
    sel0.push(ch0 ? ch0.length - 1 : 0); selE.push(chE ? chE.length - 1 : 0);
    // bands between the rings, corner by corner in the order of their angles
    const band = [];
    for (let j = 0; j + 1 < rings.length; j++) {
      let X = rings[j], Y = rings[j + 1];
      if (!part) { X = [...X, { v: X[0].v, ang: X[0].ang + 2 * Math.PI }]; Y = [...Y, { v: Y[0].v, ang: Y[0].ang + 2 * Math.PI }]; }
      let i = 0, k = 0;
      while (i < X.length - 1 || k < Y.length - 1) {
        if (k === Y.length - 1 || (i < X.length - 1 && X[i + 1].ang <= Y[k + 1].ang)) { band.push([X[i].v, X[i + 1].v, Y[k].v]); i++; } else { band.push([X[i].v, Y[k + 1].v, Y[k].v]); k++; }
      }
    }
    // (a closed ring starts where it likes: the first corners of two rings may lie apart – the band takes that
    // in its stride, but not half a turn)
    if (!part && rings.some((r, j) => j && Math.abs(r[0].ang - rings[j - 1][0].ang) > 1)) { pos.length = v0; continue; }
    // facing as the facets did: away from the middle of the tube, or to it
    const out = tri => { const p = V(tri[0]), q = V(tri[1]), r3 = V(tri[2]), u = [q[0] - p[0], q[1] - p[1], q[2] - p[2]], w = [r3[0] - p[0], r3[1] - p[1], r3[2] - p[2]], n = [u[1] * w[2] - u[2] * w[1], u[2] * w[0] - u[0] * w[2], u[0] * w[1] - u[1] * w[0]];
      const g = [(p[0] + q[0] + r3[0]) / 3 - c[0], (p[1] + q[1] + r3[1]) / 3 - c[1], (p[2] + q[2] + r3[2]) / 3 - c[2]], tt = dot(g, d), rad = [g[0] - d[0] * tt, g[1] - d[1] * tt, g[2] - d[2] * tt], rho = Math.hypot(...rad) || 1, k = (rho - t.R) / rho;
      return dot(n, [rad[0] * k + d[0] * tt, rad[1] * k + d[1] * tt, rad[2] * k + d[2] * tt]); };
    const big = band.reduce((b, x) => (Math.abs(out(x)) > Math.abs(out(b)) ? x : b), band[0]);
    if ((out(big) > 0) === !!t.hole) for (const x of band) { const y = x[1]; x[1] = x[2]; x[2] = y; }
    // the ends of a part of a ring: the flat piece between the corners in the plane through the axis
    const fans = [];
    if (part && corner) for (const [ch, cvs] of [[ch0, cvs0], [chE, cvsE]]) {
      // (two corners share the end: each takes its half of the arc, a triangle joins them)
      let split = ch.length, fwd = true;
      if (cvs.length === 2) { if (ch.length < 3) { bad = true; continue; } const sm = (t.s0 + t.s1) / 2; let bd = Infinity; for (let i = 1; i < ch.length - 1; i++) { const e = Math.abs(ch[i].s - sm); if (e < bd) { bd = e; split = i; } } }
      for (let k = 0; k + 1 < ch.length; k++) {
        const cv = k < split ? cvs[0] : cvs[1], b = ch[k].v, e = ch[k + 1].v;
        if (rim.dir.get(b) === e) fans.push([cv, b, e]); else if (rim.dir.get(e) === b) { fans.push([cv, e, b]); fwd = false; } else bad = true;
      }
      if (cvs.length === 2) fans.push(fwd ? [cvs[0], ch[split].v, cvs[1]] : [cvs[0], cvs[1], ch[split].v]);
    }
    else if (part) for (const [ch, sel] of [[ch0, sel0], [chE, selE]]) for (let q = 0; q + 1 < sel.length; q++) for (let k = sel[q] + 1; k < sel[q + 1]; k++) {
      const a = ch[sel[q]].v, b = ch[k].v, e = ch[k + 1].v;
      if (rim.dir.get(b) === e) fans.push([a, b, e]); else if (rim.dir.get(e) === b) fans.push([a, e, b]); else bad = true;
    }
    if (bad) { pos.length = v0; continue; }
    const fresh = [...band, ...fans];
    // how far the new facets leave the torus
    let sMin = t.r, sMax = t.r;
    const sOf = p => { const q = [p[0] - c[0], p[1] - c[1], p[2] - c[2]], tt = dot(q, d), rho = Math.hypot(q[0] - d[0] * tt, q[1] - d[1] * tt, q[2] - d[2] * tt); return Math.hypot(rho - t.R, tt); };
    for (const x of band) { const p = V(x[0]), q = V(x[1]), r3 = V(x[2]); for (const y of [[(p[0] + q[0] + r3[0]) / 3, (p[1] + q[1] + r3[1]) / 3, (p[2] + q[2] + r3[2]) / 3], [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2], [(q[0] + r3[0]) / 2, (q[1] + r3[1]) / 2, (q[2] + r3[2]) / 2], [(p[0] + r3[0]) / 2, (p[1] + r3[1]) / 2, (p[2] + r3[2]) / 2]]) { const s = sOf(y); sMin = Math.min(sMin, s); sMax = Math.max(sMax, s); } }
    if (!(sMin > 0.15 * t.r)) { pos.length = v0; continue; }
    const dV = star(trisOf(t.ti)) - star(fresh);
    // (what lies between the corners and the torus: what the facets lacked, and what the corners have more)
    const vG = nC ? -(t.vol + (t.hole ? -1 : 1) * dV) : 0;
    if (nC && !(vG > 0)) { pos.length = v0; continue; }
    for (const x of t.ti) gone[x] = 1;
    extra.push(...fresh);
    if (nC) { outT.push({ src: t, corner: true, din: 0, dout: sMax - t.r, vol: vG }); continue; }
    if (corner) {
      // between the corner and the torus: what a quarter circle leaves of its square, turned around – and the
      // slivers between the cylinder and the ring of corners on it
      const X = q0 ? A : B, rc = t.R + sg * t.r;
      let poly = 0;
      for (let i = 0; i + 1 < X.length + (part ? 0 : 1); i++) { const a = X[i], b = X[(i + 1) % X.length]; poly += 0.5 * a.rho * b.rho * Math.sin((((b.ang - a.ang) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)); }
      outT.push({ src: t, corner: true, din: 0, dout: sMax - t.r, vol: sweep * t.r * t.r * (t.R * (1 - Math.PI / 4) + (sg * t.r) / 6) - sg * t.r * ((sweep / 2) * rc * rc - poly) });
      continue;
    }
    outT.push({ src: t, din: t.r - sMin, dout: sMax - t.r, vol: t.vol == null ? null : t.vol + (t.hole ? -1 : 1) * dV });
  }
  const lids = [];
  for (const s of spheres) {
    if (!s.ti || !s.ax || s.ti.length < 40 || s.ti.some(x => gone[x])) continue;
    const rim = rimOf(s.ti);
    if (!rim || rim.loops.length !== 1 || rim.loops[0].length < 8) continue;
    // the rim a circle in one plane across the direction of the patch, the patch all on one side of it
    // (the direction of the patch is only the mean of its corners: the rim itself says how its plane lies)
    const L0 = rim.loops[0].map(V), nw = [0, 0, 0];
    for (let i = 0; i < L0.length; i++) { const p = L0[i], q = L0[(i + 1) % L0.length]; nw[0] += (p[1] - q[1]) * (p[2] + q[2]); nw[1] += (p[2] - q[2]) * (p[0] + q[0]); nw[2] += (p[0] - q[0]) * (p[1] + q[1]); }
    const nl = Math.hypot(...nw) || 1, sgn = dot(nw, s.ax) < 0 ? -1 : 1, ax = nw.map(x => (sgn * x) / nl);
    if (dot(ax, s.ax) < 0.99) continue;
    const hs = L0.map(p => dot([p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]], ax)), h0 = hs.reduce((a, x) => a + x, 0) / hs.length, tol = Math.max(3e-3, 1e-3 * s.r);
    if (hs.some(x => Math.abs(x - h0) > tol) || Math.abs(h0) > 0.999 * s.r) continue;
    const rb = Math.sqrt(s.r * s.r - h0 * h0), mid = s.c.map((x, k) => x + ax[k] * h0);
    if (s.ti.some(t => { for (let k = 0; k < 3; k++) { const p = V(I[t * 3 + k]); if (dot([p[0] - s.c[0], p[1] - s.c[1], p[2] - s.c[2]], ax) < h0 - tol) return true; } return false; })) continue;
    // (two lids in one place – the outside and the inside of a thin dome – would leave a body without thickness)
    if (lids.some(l => Math.abs(dot(l.ax, ax)) > 0.999 && Math.abs(dot([l.mid[0] - mid[0], l.mid[1] - mid[1], l.mid[2] - mid[2]], ax)) < 0.05 && Math.hypot(l.mid[0] - mid[0], l.mid[1] - mid[1], l.mid[2] - mid[2]) < l.rb + rb)) continue;
    const cv = addV(mid), fresh = [];
    for (const [a, b] of rim.dir) fresh.push([cv, a, b]);
    const dV = star(trisOf(s.ti)) - star(fresh);
    for (const x of s.ti) gone[x] = 1;
    extra.push(...fresh);
    lids.push({ ax, mid, rb });
    outS.push({ src: s, ax, h0, vol: s.vol + (s.hole ? -1 : 1) * dV });
  }
  if (!outT.length && !outS.length) return { m, tori: [], spheres: [] };
  const idx = [];
  for (let t = 0; t < nT; t++) if (!gone[t]) idx.push(I[t * 3], I[t * 3 + 1], I[t * 3 + 2]);
  for (const x of extra) idx.push(x[0], x[1], x[2]);
  return { m: compact({ pos: new Float32Array(pos), idx: new Uint32Array(idx) }), tori: outT, spheres: outS };
}

/** Does this piece of a cylinder lie on one of the tori (a row of facets along the tube looks like one)? */
export function arcOnTorus(c, tori) {
  return c.full === false && tori.some(to => {
    const tol = Math.max(5e-3, 2.5e-3 * to.r), lo = to.r * Math.sin(to.s0) - tol, hi = to.r * Math.sin(to.s1) + tol;
    for (const z of [0, c.h / 2, c.h]) for (const k of [0, 0.5, 1]) {
      const a = c.a0 + c.sweep * k, p = [0, 1, 2].map(i => c.c[i] + c.d[i] * z + c.r * (c.u[i] * Math.cos(a) + c.w[i] * Math.sin(a)));
      const q = [p[0] - to.c[0], p[1] - to.c[1], p[2] - to.c[2]], tt = q[0] * to.d[0] + q[1] * to.d[1] + q[2] * to.d[2], rho = Math.hypot(q[0] - to.d[0] * tt, q[1] - to.d[1] * tt, q[2] - to.d[2] * tt);
      if (tt < lo || tt > hi || Math.abs(Math.hypot(rho - to.R, tt) - to.r) > tol) return false;
    }
    return true;
  });
}

/**
 * Needles with two corners almost in one place (as cuts leave them) are closed: the two corners become one, the
 * triangle disappears. A kernel cannot make a face of such a triangle – the solid would have a gap there. Only
 * taken when a closed mesh stays closed.
 */
export function collapseNeedles(m, rel = 2e-3, abs = 2e-3) {
  let cur = m;
  const closed0 = stats(m).closed;
  for (let pass = 0; pass < 4; pass++) {
    const I = cur.idx, P = cur.pos, to = new Map(), root = v => { while (to.has(v)) v = to.get(v); return v; };
    const d = (a, b) => Math.hypot(P[a * 3] - P[b * 3], P[a * 3 + 1] - P[b * 3 + 1], P[a * 3 + 2] - P[b * 3 + 2]);
    for (let t = 0; t < I.length; t += 3) {
      const v = [I[t], I[t + 1], I[t + 2]], l = [d(v[0], v[1]), d(v[1], v[2]), d(v[2], v[0])], k = l.indexOf(Math.min(...l)), lmax = Math.max(...l);
      if (l[k] > abs || l[k] > rel * lmax) continue;
      const a = root(v[k]), b = root(v[(k + 1) % 3]);
      if (a !== b) to.set(b, a);
    }
    if (!to.size) break;
    const idx = new Uint32Array(I.length);
    for (let i = 0; i < I.length; i++) idx[i] = root(I[i]);
    const next = cleanTris({ pos: P, idx });
    if (closed0 && !stats(next).closed) break;
    cur = next;
  }
  return cur;
}
