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
    if (cap) out = fillHoles(out, loop => loop.every(i => Math.abs(out.pos[i * 3 + ax] - offset) < 1e-4));
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
