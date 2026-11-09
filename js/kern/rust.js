// OpenFab Rust-Kern (B-rep auf Basis von truck, als WebAssembly) – Anbindung an die Kern-Schnittstelle.
// Unterstützt: Quader, Zylinder, Kugel, Torus, Extrusion und Rotation von Skizzenprofilen, Bohrung,
// Muster, Spiegeln, Verschieben, Skalieren, Kombinieren sowie Vernetzung und STEP-Export.
// Alles andere meldet der Kern als „noch nicht unterstützt“.
import * as THREE from 'three';
import { registerKernel, unsupported } from './index.js';
import { load, call, boolean, mesh as rmesh, kernelEpoch, isLoaded } from './rustwasm.js';
import { buildRegions } from '../profiles.js';
import { basis, sketchPlane, toWorld, axisRef } from '../plane.js';
import { profileItems, FEATURE_TYPES, patternAxis, pathPlacements } from '../model.js';

const WASM_URL = new URL('../../vendor/openfab-kernel/openfab_kernel.wasm', import.meta.url).href;
const NAME = 'Rust-Kern';
const DEG = Math.PI / 180;
const EPS = 1e-3; // extrusions reach this far into / out of the material at the sketch plane (coplanar faces)
const fail = msg => { throw new Error(msg); };

// shapes are freed in the kernel once JavaScript no longer references them
const finalizer = new FinalizationRegistry(({ h, ep }) => {
  if (ep === kernelEpoch() && isLoaded()) { try { call({ op: 'free', h }); } catch { /* kernel restarted */ } }
});

// ---------- shape (same query surface as replicad shapes, see kern/index.js) ----------
export class RShape {
  constructor(h) {
    this.h = h;
    this.ep = kernelEpoch();
    this.kernel = 'rust';
    this.isNull = false;
    finalizer.register(this, { h, ep: this.ep });
  }
  get valid() { return this.ep === kernelEpoch() && isLoaded(); }
  _call(cmd) {
    if (!this.valid) fail('Rust-Kern wurde neu gestartet – bitte neu berechnen');
    return call(cmd);
  }
  get info() { return (this._info ||= this._call({ op: 'info', h: this.h })); }
  get boundingBox() { return { bounds: this.info.bbox }; }
  get faces() {
    return (this._faces ||= this.info.faces.map(f => ({
      geomType: f.t,
      normalAt: () => (f.n ? { x: f.n[0], y: f.n[1], z: f.n[2] } : { x: 0, y: 0, z: 1 }),
    })));
  }
  get edges() {
    return (this._edges ||= this.info.edges.map(e => ({
      geomType: e.t,
      isClosed: e.closed,
      // exact at the midpoint (used to store picked edges); elsewhere not needed
      pointAt: () => ({ x: e.mid[0], y: e.mid[1], z: e.mid[2] }),
    })));
  }
  clone() { return new RShape(this._call({ op: 'clone', h: this.h })); }
  transform(m) { return new RShape(this._call({ op: 'transform', h: this.h, m: Array.from(m.elements) })); }
  translate(x, y, z) {
    const v = Array.isArray(x) ? x : [x, y, z];
    return this.transform(new THREE.Matrix4().makeTranslation(+v[0] || 0, +v[1] || 0, +v[2] || 0));
  }
  rotate(deg, c = [0, 0, 0], axis = [0, 0, 1]) {
    const C = new THREE.Vector3(...c);
    const m = new THREE.Matrix4().makeTranslation(C.x, C.y, C.z)
      .multiply(new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(...axis).normalize(), deg * DEG))
      .multiply(new THREE.Matrix4().makeTranslation(-C.x, -C.y, -C.z));
    return this.transform(m);
  }
  scale(k, c = [0, 0, 0]) {
    const m = new THREE.Matrix4().makeTranslation(c[0], c[1], c[2])
      .multiply(new THREE.Matrix4().makeScale(k, k, k))
      .multiply(new THREE.Matrix4().makeTranslation(-c[0], -c[1], -c[2]));
    return this.transform(m);
  }
  // plane 'XY' | 'XZ' | 'YZ' through `origin`
  mirror(plane = 'YZ', origin = [0, 0, 0]) {
    const s = { XY: [1, 1, -1], XZ: [1, -1, 1], YZ: [-1, 1, 1] }[plane] || [-1, 1, 1];
    const m = new THREE.Matrix4().makeTranslation(...origin)
      .multiply(new THREE.Matrix4().makeScale(...s))
      .multiply(new THREE.Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]));
    return this.transform(m);
  }
}

const shapeOf = h => new RShape(h);
function boolOp(kind, a, b) {
  if (!a.valid || !b.valid) fail('Rust-Kern wurde neu gestartet – bitte neu berechnen');
  const r = boolean(kind, a.h, b.h);
  return r == null ? null : shapeOf(r);
}

// ---------- sketch profiles → closed contours (lines and exact arcs, in sketch u/v) ----------
const EXACT = new Set(['rect', 'circle', 'slot']);
const M = p => ({ t: 'M', p }), L = p => ({ t: 'L', p }), A = (m, p) => ({ t: 'A', m, p });

function circleLoop(cx, cy, r) {
  return [M([cx + r, cy]), A([cx, cy + r], [cx - r, cy]), A([cx, cy - r], [cx + r, cy])];
}
function entityLoop(e) {
  if (e.type === 'circle') return circleLoop(+e.cx, +e.cy, +e.r);
  if (e.type === 'rect') {
    const x = +e.x, y = +e.y, w = +e.w, hh = +e.h;
    const r = Math.min(+e.r || 0, w / 2 - 1e-3, hh / 2 - 1e-3);
    if (!(r > 0)) return [M([x, y]), L([x + w, y]), L([x + w, y + hh]), L([x, y + hh]), L([x, y])];
    const k = r * (1 - Math.SQRT1_2);
    return [M([x + r, y]), L([x + w - r, y]), A([x + w - k, y + k], [x + w, y + r]), L([x + w, y + hh - r]), A([x + w - k, y + hh - k], [x + w - r, y + hh]),
      L([x + r, y + hh]), A([x + k, y + hh - k], [x, y + hh - r]), L([x, y + r]), A([x + k, y + k], [x + r, y])];
  }
  if (e.type === 'slot') {
    const r = +e.w / 2, len = +e.len || 0, a = (+e.rot || 0) * DEG;
    if (len <= 1e-6) return circleLoop(+e.cx, +e.cy, r);
    const d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
    const P = (c, s, t) => [c[0] + d[0] * s + n[0] * t, c[1] + d[1] * s + n[1] * t];
    const c1 = P([+e.cx, +e.cy], -len / 2, 0), c2 = P([+e.cx, +e.cy], len / 2, 0);
    return [M(P(c1, 0, -r)), L(P(c2, 0, -r)), A(P(c2, r, 0), P(c2, 0, r)), L(P(c1, 0, r)), A(P(c1, -r, 0), P(c1, 0, -r))];
  }
  return null;
}
function polyLoop(poly) {
  const p = poly.filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 1e-6);
  while (p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-6) p.pop();
  return [M(p[0]), ...p.slice(1).map(L), L(p[0])];
}
export function regionLoops(sk, ids) {
  const items = profileItems(sk, ids);
  const { regions } = buildRegions(items);
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  const loopOf = id => { const it = byId[id]; return (EXACT.has(it.e.type) && it.id === it.e.id && entityLoop(it.e)) || polyLoop(it.poly); };
  return regions.map(r => ({ outer: loopOf(r.id), holes: r.holeIds.map(loopOf) }));
}

// ---------- features ----------
const SUPPORTED = new Set(['box', 'cylinder', 'sphere', 'torus', 'extrude', 'revolve', 'hole', 'pattern', 'mirror', 'move', 'scale', 'combine']);

function supports(f) {
  if (f.type === 'extrude' && f.source === 'faces') return unsupported(NAME, 'Extrusion von Körperflächen');
  if (f.type === 'hole' && f.kind === 'csink') return unsupported(NAME, 'Kegelsenkung');
  if (f.type === 'hole' && f.tip && !f.through) return unsupported(NAME, 'Bohrspitze (Kegel)');
  if (SUPPORTED.has(f.type)) return true;
  return unsupported(NAME, FEATURE_TYPES[f.type] || f.type);
}

function extrudeTool(sk, f, plain) {
  const regions = regionLoops(sk, f.profiles);
  if (!regions.length) fail('Kein geschlossenes Profil');
  const d = +f.distance;
  if (!d) fail('Abstand ist 0');
  const plane = sketchPlane(sk);
  const ex = (from, len) => shapeOf(call({ op: 'extrude', plane, regions, from, len }));
  if (f.extent === 'sym') return ex(-d / 2, d);
  // reach a hair into the material at the sketch plane: truck cannot combine coplanar faces
  const e = plain ? 0 : EPS * Math.sign(d);
  const one = ex(-e, d + e);
  if (f.extent === 'two' && +f.distance2) return boolOp('or', one, ex(0, -f.distance2));
  return one;
}

function revolveTool(sk, f, features = []) {
  const regions = regionLoops(sk, f.profiles);
  if (!regions.length) fail('Kein geschlossenes Profil');
  const b = basis(sk);
  let dir, origin;
  const ca = axisRef(f.axis, features);
  if (ca) { dir = new THREE.Vector3(...ca.d); origin = new THREE.Vector3(...ca.o); }
  else if (f.axis === 'x') { dir = b.x; origin = b.o; }
  else if (f.axis === 'y') { dir = b.y; origin = b.o; }
  else {
    const e = sk.entities.find(x => x.id === f.axis);
    if (!e || e.type !== 'poly') fail('Rotationsachse fehlt');
    const p0 = toWorld(b, ...e.pts[0]), p1 = toWorld(b, ...e.pts[e.pts.length - 1]);
    dir = p1.clone().sub(p0).normalize();
    origin = p0;
  }
  return shapeOf(call({ op: 'revolve', plane: sketchPlane(sk), regions, axisO: origin.toArray(), axisD: dir.toArray(), angle: +f.angle || 360 }));
}

// Holes from overlapping cylinders (extruded circles) – truck handles these reliably, revolved profiles not.
function holeTool(sk, f, bodies) {
  const b = basis(sk);
  const circles = sk.entities.filter(e => e.type === 'circle' && (!Array.isArray(f.points) || f.points.includes(e.id)));
  if (!circles.length) fail('Keine Kreise als Bohrungsmittelpunkte in der Skizze');
  if (!(f.dia > 0)) fail('Durchmesser fehlt');
  const into = b.n.clone().negate();
  let out = null;
  for (const c of circles) {
    const o = toWorld(b, c.cx, c.cy);
    // through holes end just behind the bodies (very long tools make truck fail)
    let D = +f.depth;
    if (f.through) {
      D = 1;
      for (const bd of bodies) {
        const [lo, hi] = bd.shape.boundingBox.bounds;
        for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) D = Math.max(D, new THREE.Vector3(x, y, z).sub(o).dot(into) + 1);
      }
    }
    if (!(D > 0)) fail('Tiefe fehlt');
    const plane = { o: o.toArray(), x: b.x.toArray(), n: into.toArray() };
    const cyl = (r, z0, z1) => shapeOf(call({ op: 'extrude', plane, regions: [{ outer: circleLoop(0, 0, r), holes: [] }], from: z0, len: z1 - z0 }));
    let t = cyl(f.dia / 2, -0.02, D);
    if (f.kind === 'cbore') {
      if (!(f.cbDia > f.dia && f.cbDepth > 0)) fail('Senkung: Durchmesser und Tiefe prüfen');
      // the narrow part starts inside the counterbore, so no faces coincide
      t = boolOp('or', cyl(f.cbDia / 2, -0.02, +f.cbDepth), cyl(f.dia / 2, f.cbDepth / 2, D));
    }
    out = out ? boolOp('or', out, t) : t;
  }
  return out;
}

function primitiveTool(f) {
  if (f.type === 'box') return shapeOf(call({ op: 'box', x: +f.x || 0, y: +f.y || 0, z: +f.z || 0, w: +f.w, d: +f.d, h: +f.h }));
  if (f.type === 'cylinder') return shapeOf(call({ op: 'cylinder', x: +f.x || 0, y: +f.y || 0, z: +f.z || 0, r: +f.r, h: +f.h }));
  if (f.type === 'torus') return shapeOf(call({ op: 'torus', R: +f.R, r: +f.r, axis: f.axis, x: +f.x || 0, y: +f.y || 0, z: +f.z || 0 }));
  return shapeOf(call({ op: 'sphere', x: +f.x || 0, y: +f.y || 0, z: +f.z || 0, r: +f.r }));
}

function applyOp(bodies, tool, op, id, target) {
  if (op === 'new' || (!bodies.length && op === 'join')) {
    bodies.push({ id, name: `Körper${bodies.length + 1}`, shape: tool });
    return;
  }
  if (!bodies.length) fail('Kein Körper vorhanden');
  if (op === 'cut') {
    for (const b of bodies) b.shape = boolOp('cut', b.shape, tool);
    return;
  }
  const t = bodies.find(b => b.id === target) || bodies[bodies.length - 1];
  if (op === 'intersect') {
    const r = boolOp('and', t.shape, tool);
    if (!r) fail('Schnittmenge ist leer');
    t.shape = r;
  } else t.shape = boolOp('or', t.shape, tool);
}

function patternCopies(src, f, features = []) {
  const out = [];
  if (f.kind === 'path') {
    for (const pl of pathPlacements(f, features)) out.push((pl.rot ? src.rotate(pl.rot.deg, pl.rot.c, pl.rot.axis) : src).translate(pl.tr));
    return out;
  }
  if (f.kind === 'circ') {
    const n = Math.max(1, Math.round(+f.n));
    const ang = +f.angle || 360;
    const step = Math.abs(ang) >= 360 ? ang / n : ang / Math.max(1, n - 1);
    const { c, d } = patternAxis(f, features);
    for (let k = 1; k < n; k++) out.push(src.rotate(step * k, c, d));
  } else {
    const dirs = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    const d1 = dirs[f.dir1 || 'x'], d2 = dirs[f.dir2 || 'y'];
    const n1 = Math.max(1, Math.round(+f.n1)), n2 = Math.max(1, Math.round(+f.n2 || 1));
    for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
      if (!i && !j) continue;
      out.push(src.translate([0, 1, 2].map(k => d1[k] * f.s1 * i + d2[k] * (f.s2 || 0) * j)));
    }
  }
  return out;
}
const mirrorOrigin = (f, off) => ({ XY: [0, 0, off], XZ: [0, off, 0], YZ: [off, 0, 0] }[f.plane || 'YZ']);

function runFeature(f, ctx) {
  const { bodies, sketches, tools } = ctx;
  if (['box', 'cylinder', 'sphere', 'torus', 'extrude', 'revolve', 'hole'].includes(f.type)) {
    let tool;
    const op = f.type === 'hole' ? 'cut' : f.op;
    if (f.type === 'extrude' || f.type === 'revolve' || f.type === 'hole') {
      const sk = sketches[f.sketch];
      if (!sk) fail('Skizze fehlt');
      tool = f.type === 'extrude' ? extrudeTool(sk, f, op === 'new' || op === 'intersect' || !bodies.length) : f.type === 'revolve' ? revolveTool(sk, f, ctx.features) : holeTool(sk, f, bodies);
    } else tool = primitiveTool(f);
    tools[f.id] = { tool, op, target: f.target };
    applyOp(bodies, tool, op, f.id, f.target);
    return;
  }
  if ((f.type === 'pattern' || f.type === 'mirror') && f.source === 'body') {
    const b = bodies.find(x => x.id === f.body);
    if (!b) fail('Körper wählen');
    const copies = f.type === 'pattern' ? patternCopies(b.shape, f, ctx.features) : [b.shape.mirror(f.plane || 'YZ', mirrorOrigin(f, +f.offset || 0))];
    copies.forEach((c, i) => { if (f.joinBodies) b.shape = boolOp('or', b.shape, c); else bodies.push({ id: `${f.id}_${i}`, name: '', shape: c }); });
    return;
  }
  if (f.type === 'pattern' || f.type === 'mirror') {
    const src = tools[f.target];
    if (!src) fail('Ziel-Feature fehlt oder erzeugt keinen Körper');
    const copies = f.type === 'pattern' ? patternCopies(src.tool, f, ctx.features) : [src.tool.mirror(f.plane || 'YZ', mirrorOrigin(f, +f.offset || 0))];
    copies.forEach((t, i) => applyOp(bodies, t, src.op, `${f.id}_${i}`, src.target));
    return;
  }
  if (f.type === 'scale') {
    const b = bodies.find(x => x.id === f.body) || bodies[bodies.length - 1];
    if (!b) fail('Kein Körper');
    const k = +f.factor;
    if (!(k > 0)) fail('Faktor muss größer 0 sein');
    let c = [+f.cx || 0, +f.cy || 0, +f.cz || 0];
    if (f.center === 'body') { const [lo, hi] = b.shape.boundingBox.bounds; c = lo.map((v, i) => (v + hi[i]) / 2); }
    const s = b.shape.scale(k, c);
    if (f.copy) bodies.push({ id: f.id, name: `Körper${bodies.length + 1}`, shape: s });
    else b.shape = s;
    return;
  }
  if (f.type === 'move') {
    const b = bodies.find(x => x.id === f.body) || bodies[bodies.length - 1];
    if (!b) fail('Kein Körper');
    let s = b.shape.translate(+f.dx || 0, +f.dy || 0, +f.dz || 0);
    if (+f.rz) s = s.rotate(+f.rz, [+f.cx || 0, +f.cy || 0, 0], [0, 0, 1]);
    if (f.copy) bodies.push({ id: f.id, name: `Körper${bodies.length + 1}`, shape: s });
    else b.shape = s;
    return;
  }
  if (f.type === 'combine') {
    const t = bodies.find(x => x.id === f.body), tl = bodies.find(x => x.id === f.tool);
    if (!t || !tl || t === tl) fail('Zielkörper und Werkzeugkörper wählen');
    const r = boolOp(f.op === 'cut' ? 'cut' : f.op === 'intersect' ? 'and' : 'or', t.shape, tl.shape);
    if (!r) fail('Schnittmenge ist leer');
    t.shape = r;
    if (!f.keep) bodies.splice(bodies.indexOf(tl), 1);
  }
}

// volume, centre of mass and area from the triangulation
function meshProps(m) {
  const P = m.vertices, T = m.triangles;
  let vol = 0, area = 0;
  const com = [0, 0, 0];
  for (let i = 0; i < T.length; i += 3) {
    const a = T[i] * 3, b = T[i + 1] * 3, c = T[i + 2] * 3;
    const ax = P[a], ay = P[a + 1], az = P[a + 2], bx = P[b], by = P[b + 1], bz = P[b + 2], cx = P[c], cy = P[c + 1], cz = P[c + 2];
    const v = (ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)) / 6;
    vol += v;
    com[0] += v * (ax + bx + cx) / 4; com[1] += v * (ay + by + cy) / 4; com[2] += v * (az + bz + cz) / 4;
    const ux = bx - ax, uy = by - ay, uz = bz - az, wx = cx - ax, wy = cy - ay, wz = cz - az;
    area += Math.hypot(uy * wz - uz * wy, uz * wx - ux * wz, ux * wy - uy * wx) / 2;
  }
  return { volume: Math.abs(vol), com: vol ? com.map(v => v / vol) : [0, 0, 0], area };
}

export const rustKernel = {
  id: 'rust',
  name: 'Rust-Kern (truck)',
  info: 'Experimentell: B-rep-Kern in Rust (WebAssembly). Grundkörper, Extrusion, Rotation, Bohrung, Muster, Spiegeln, Verschieben, Skalieren, Kombinieren, STEP-Export.',
  native: false,
  ready: false,
  async load() {
    if (this.ready) return;
    await load(WASM_URL);
    call({ op: 'version' });
    this.ready = true;
  },
  supports,
  runFeature,
  mesh: (shape, tol = 0.04) => rmesh(shape.h, tol),
  props: shape => meshProps(rmesh(shape.h, 0.02)),
  intersectVolume(a, b) {
    const x = boolOp('and', a, b);
    return x ? call({ op: 'volume', h: x.h }) : 0;
  },
  exportSTEP(list) {
    const text = call({ op: 'step', hs: list.map(b => b.shape.h) });
    return new Blob([text], { type: 'application/step' });
  },
};
registerKernel(rustKernel);
