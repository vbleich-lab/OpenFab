// Parametric history replay on the OpenCascade B-rep kernel (replicad).
import * as THREE from 'three';
import { R } from './kernel.js';
import { registerKernel, activeKernel, getKernel } from './kern/index.js';
import { entityPolys, entityOutlines, entityOutline, buildRegions, chainLoops, circle3 } from './profiles.js';
import { cornerPlan, hasCorners } from './sketchcorner.js';
import { basis, planeMatrix, sketchPlane, toWorld, axisRef, planeRef } from './plane.js';
import { sheetSolid } from './sheetmetal.js';
import { stepSolids } from './interop.js';

export const FEATURE_TYPES = {
  sketch: 'Skizze', extrude: 'Extrusion', revolve: 'Rotation', hole: 'Bohrung',
  loft: 'Erhebung', sweep: 'Sweep', freeform: 'Freiformfläche', sheet: 'Blech', box: 'Quader', cylinder: 'Zylinder', sphere: 'Kugel',
  fillet: 'Verrundung', chamfer: 'Fase', shell: 'Schale', thicken: 'Aufdicken',
  surfloft: 'Flächen-Erhebung', surftrim: 'Trimmen', surfextend: 'Verlängern', fill: 'Rand füllen', surfextrude: 'Flächen-Extrusion', surfrevolve: 'Flächen-Rotation', patch: 'Flicken', offsetsurf: 'Versatzfläche', stitch: 'Zusammenfügen', draft: 'Formschräge', split: 'Körper teilen',
  pattern: 'Muster', mirror: 'Spiegeln', move: 'Verschieben', combine: 'Kombinieren', import: 'Import',
  pipe: 'Rohr', coil: 'Feder', scale: 'Skalieren', thread: 'Gewinde',
  plane: 'Konstruktionsebene', axis: 'Konstruktionsachse', point: 'Konstruktionspunkt', rib: 'Rippe', torus: 'Torus',
  meshimport: 'Netz einfügen', meshop: 'Netz bearbeiten', emboss: 'Prägen',
  canvas: 'Ansichtsbereich', decal: 'Aufkleber',
};
export const OPS = { new: 'Neuer Körper', join: 'Verbinden', cut: 'Ausschneiden', intersect: 'Schnittmenge' };
export const SOLID_SOURCES = ['thicken', 'emboss', 'extrude', 'revolve', 'hole', 'loft', 'sweep', 'freeform', 'sheet', 'box', 'cylinder', 'sphere', 'pipe', 'coil', 'rib', 'torus'];

const DEG = Math.PI / 180;
const fail = msg => { throw new Error(msg); };

// One item per closed polygon; text entities yield several (id "entity#k").
export function profileItems(sketch, ids) {
  // construction geometry (dashed) never forms a profile
  const ents = sketch.entities.filter(e => !e.cons);
  const items = ents
    .filter(e => !Array.isArray(ids) || ids.includes(e.id))
    .flatMap(e => {
      const polys = entityPolys(e);
      return polys.map((poly, k) => ({ id: polys.length > 1 || e.type === 'text' ? `${e.id}#${k}` : e.id, e, poly }));
    });
  // closed loops made of separate lines / arcs / splines
  for (const L of chainLoops(ents)) {
    if (Array.isArray(ids) && !ids.includes(L.id)) continue;
    items.push({ id: L.id, e: { id: L.id, type: 'chain' }, poly: L.poly });
  }
  return items;
}
const pathPts = e => entityOutline(e).pts;

function polyDrawing(pts) {
  // drop zero-length segments, which the wire builder rejects
  const p = pts.filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 1e-6);
  while (p.length > 2 && Math.hypot(p[0][0] - p[p.length - 1][0], p[0][1] - p[p.length - 1][1]) < 1e-6) p.pop();
  let d = R.draw(p[0]);
  for (let i = 1; i < p.length; i++) d = d.lineTo(p[i]);
  return d.close();
}

// polyline with sketch fillets / chamfers: straight lines and true arcs (the solid gets cylindrical faces)
function cornerDrawing(e) {
  const { segs, closed } = cornerPlan(e);
  if (!segs.length) return null;
  let d = R.draw(segs[0].a);
  const last = segs.length - 1;
  segs.forEach((s, i) => {
    if (closed && i === last && s.k === 'L') return; // close() draws it
    d = s.k === 'L' ? d.lineTo(s.b) : d.threePointsArcTo(s.b, s.m);
  });
  return closed ? d.close() : d.done();
}

function entityDrawing(e) {
  switch (e.type) {
    case 'rect': {
      const r = Math.min(e.r || 0, e.w / 2 - 1e-3, e.h / 2 - 1e-3);
      return R.drawRoundedRectangle(e.w, e.h, r > 0 ? r : 0).translate(e.x + e.w / 2, e.y + e.h / 2);
    }
    case 'circle':
      return R.drawCircle(e.r).translate(e.cx, e.cy);
    case 'slot': {
      if (e.len <= 1e-6) return R.drawCircle(e.w / 2).translate(e.cx, e.cy);
      return R.drawRoundedRectangle(e.len + e.w, e.w, (e.w / 2) * 0.9999).rotate(e.rot || 0, [0, 0]).translate(e.cx, e.cy);
    }
    default: {
      const p = entityPolys(e)[0];
      return p ? polyDrawing(p) : null;
    }
  }
}

const rPlane = p => new R.Plane(p.o, p.x, p.n);

const EXACT = new Set(['rect', 'circle', 'slot']);

function regionDrawings(sk, ids) {
  const items = profileItems(sk, ids);
  const { regions } = buildRegions(items);
  const byId = Object.fromEntries(items.map(i => [i.id, i]));
  // exact arcs for native shapes, polygons for everything else (text, polylines)
  const drawingOf = id => {
    const it = byId[id];
    if (it.id === it.e.id && hasCorners(it.e) && it.e.closed) { try { const d = cornerDrawing(it.e); if (d) return d; } catch { /* fall back to the polygon */ } }
    return EXACT.has(it.e.type) && it.id === it.e.id ? entityDrawing(it.e) : polyDrawing(it.poly);
  };
  return regions.map(r => {
    let d = drawingOf(r.id);
    for (const h of r.holeIds) d = d.cut(drawingOf(h));
    return d;
  });
}

const fuseAll = shapes => shapes.reduce((a, b) => (a ? a.fuse(b) : b), null);

function extrudeTool(sk, f) {
  const ds = regionDrawings(sk, f.profiles);
  if (!ds.length) fail('Kein geschlossenes Profil');
  const d = +f.distance;
  if (!d) fail('Abstand ist 0');
  const p = sketchPlane(sk);
  const shifted = off => rPlane({ ...p, o: p.o.map((c, i) => c + p.n[i] * off) });
  const solids = [];
  for (const dr of ds) {
    if (f.extent === 'sym') solids.push(dr.clone().sketchOnPlane(shifted(-d / 2)).extrude(d));
    else {
      solids.push(dr.clone().sketchOnPlane(rPlane(p)).extrude(d));
      if (f.extent === 'two' && +f.distance2) solids.push(dr.clone().sketchOnPlane(rPlane(p)).extrude(-f.distance2));
    }
  }
  return fuseAll(solids);
}

// Extrude planar faces of the bodies (a face as the profile), along their outward normal
function faceExtrudeTool(f, bodies) {
  const d = +f.distance;
  if (!d) fail('Abstand ist 0');
  const solids = [], info = [];
  let body = null;
  for (const p of f.faces || []) {
    let found = false;
    for (const b of bodies) {
      const bb = b.shape.boundingBox.bounds;
      if (![0, 1, 2].every(k => p[k] >= bb[0][k] - 1e-3 && p[k] <= bb[1][k] + 1e-3)) continue;
      const fs = new R.FaceFinder().containsPoint(p).find(b.shape);
      if (!fs.length) continue;
      const fc = fs[0];
      if (fc.geomType !== 'PLANE') fail('Nur ebene Flächen können extrudiert werden');
      const nv = fc.normalAt(p);
      const L = Math.hypot(nv.x, nv.y, nv.z) || 1, n = [nv.x / L, nv.y / L, nv.z / L];
      const ext = (from, len) => R.basicFaceExtrusion(from ? fc.clone().translate(n.map(c => c * from)) : fc.clone(), new R.Vector(n.map(c => c * len)));
      if (f.extent === 'sym') solids.push(ext(-d / 2, d));
      else {
        solids.push(ext(0, d));
        if (f.extent === 'two' && +f.distance2) solids.push(ext(0, -f.distance2));
      }
      body ||= b.id;
      info.push({ p: [...p], n });
      found = true;
      break;
    }
    if (!found) fail('Gewählte Fläche nicht mehr gefunden – neu auswählen');
  }
  if (!solids.length) fail('Keine Fläche gewählt');
  return { tool: solids.length > 1 ? solids.slice(1).reduce((a, x) => a.fuse(x), solids[0]) : solids[0], body, info };
}

function revolveAxis(sk, f, features = []) {
  const b = basis(sk);
  let dir, origin;
  const ca = axisRef(f.axis, features);
  if (ca) { dir = new THREE.Vector3(...ca.d); origin = new THREE.Vector3(...ca.o); }   // origin axis or construction axis
  else if (f.axis === 'x') { dir = b.x; origin = b.o; }
  else if (f.axis === 'y') { dir = b.y; origin = b.o; }
  else {
    const e = sk.entities.find(x => x.id === f.axis);
    if (!e || e.type !== 'poly') fail('Rotationsachse fehlt');
    const p0 = toWorld(b, ...e.pts[0]), p1 = toWorld(b, ...e.pts[e.pts.length - 1]);
    dir = p1.clone().sub(p0).normalize();
    origin = p0;
  }
  return { dir, origin };
}
function revolveTool(sk, f, features = []) {
  const ds = regionDrawings(sk, f.profiles);
  if (!ds.length) fail('Kein geschlossenes Profil');
  const { dir, origin } = revolveAxis(sk, f, features);
  const angle = +f.angle || 360;
  return fuseAll(ds.map(d => d.sketchOnPlane(rPlane(sketchPlane(sk))).revolve(dir.toArray(), { origin: origin.toArray(), angle })));
}

export function holeProfile(f) {
  const r = f.dia / 2;
  const D = f.through ? 2000 : +f.depth;
  const e = 0.02;
  const prof = [[0, -e]];
  if (f.kind === 'cbore') prof.push([f.cbDia / 2, -e], [f.cbDia / 2, +f.cbDepth], [r, +f.cbDepth]);
  else if (f.kind === 'csink') {
    const half = (f.csAngle / 2) * DEG;
    const rs = f.csDia / 2;
    prof.push([rs + e * Math.tan(half), -e], [r, (rs - r) / Math.tan(half)]);
  } else prof.push([r, -e]);
  prof.push([r, D]);
  prof.push([0, f.tip && !f.through ? D + r / Math.tan(59 * DEG) : D]);
  return prof;
}

// A tapped hole ("Gewindebohrung"): the size decides the diameter – the hole is the tap drill (core) hole.
export function tappedHole(f) {
  if (!f.tapped) return null;
  const t = THREAD_SIZES.find(x => x[0] === f.threadSize) || THREAD_SIZES.find(x => x[0] === 'M8');
  return { name: t[0], D: t[1], P: t[2], core: t[3] };
}

function holeTool(sk, f) {
  const tap = tappedHole(f);
  if (tap) f = { ...f, dia: tap.core };
  const b = basis(sk);
  const circles = sk.entities.filter(e => e.type === 'circle' && (!Array.isArray(f.points) || f.points.includes(e.id)));
  if (!circles.length) fail('Keine Kreise als Bohrungsmittelpunkte in der Skizze');
  if (!(f.dia > 0)) fail('Durchmesser fehlt');
  const prof = holeProfile(f);
  return fuseAll(circles.map(c => {
    const o = toWorld(b, c.cx, c.cy);
    // Plane through the hole axis: local x = radial, local y = -normal (into material).
    const pl = new R.Plane(o.toArray(), b.x.toArray(), b.y.toArray());
    return polyDrawing(prof).sketchOnPlane(pl).revolve(b.n.toArray(), { origin: o.toArray() });
  }));
}

function loftTool(f, sketches) {
  const secs = (f.sections || []).map(id => sketches[id]).filter(Boolean);
  if (secs.length < 2) fail('Mindestens zwei Skizzen als Querschnitte wählen');
  const key = s => JSON.stringify(sketchPlane(s));
  if (new Set(secs.map(key)).size < secs.length) fail('Die Querschnitte müssen auf verschiedenen Ebenen liegen');
  const sk = secs.map(s => {
    const ds = regionDrawings(s);
    if (!ds.length) fail(`${s.name}: kein geschlossenes Profil`);
    return ds[0].sketchOnPlane(rPlane(sketchPlane(s)));
  });
  try {
    return sk[0].loftWith(sk.slice(1), { ruled: !!f.ruled });
  } catch {
    fail('Erhebung nicht möglich – Querschnitte prüfen (je ein geschlossenes Profil, nicht verdreht)');
  }
}

function sweepTool(f, sketches) {
  const sk = sketches[f.sketch], ps = sketches[f.pathSketch];
  if (!sk) fail('Profil-Skizze fehlt');
  const e = ps && ps.entities.find(x => x.id === f.pathEntity);
  if (!e || e.type !== 'poly') fail('Pfad wählen (Linie/Linienzug in einer Skizze)');
  const ds = regionDrawings(sk, f.profiles);
  if (!ds.length) fail('Kein geschlossenes Profil');
  const spine = () => {
    const pp = pathPts(e);
    let d = R.draw(pp[0]);
    for (let i = 1; i < pp.length; i++) d = d.lineTo(pp[i]);
    return (e.closed ? d.close() : d.done()).sketchOnPlane(rPlane(sketchPlane(ps))).wires();
  };
  return fuseAll(ds.map(dr => R.genericSweep(dr.sketchOnPlane(rPlane(sketchPlane(sk))).wires(), spine(), { frenet: true, transitionMode: 'round' }, false)));
}

// ---------- pipe, coil, thread ----------
const V = {
  sub: (a, b) => a.map((v, i) => v - b[i]), add: (a, b) => a.map((v, i) => v + b[i]), mul: (a, k) => a.map(v => v * k),
  dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]],
  norm: a => { const l = Math.hypot(...a) || 1; return a.map(v => v / l); },
};
const perp = d => V.norm(V.cross(d, Math.abs(d[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0]));

// Pipe: circle (optionally hollow) swept along a line/polyline of a sketch
function pipeTool(f, sketches) {
  const ps = sketches[f.pathSketch];
  const e = ps && ps.entities.find(x => x.id === f.pathEntity);
  if (!e || e.type !== 'poly') fail('Pfad wählen (Linie/Linienzug in einer Skizze)');
  const D = +f.dia, wall = +f.wall || 0;
  if (!(D > 0)) fail('Durchmesser fehlt');
  if (wall && wall * 2 >= D) fail('Wandstärke zu groß');
  const pl = sketchPlane(ps);
  const b = { o: pl.o, x: V.norm(pl.x), n: V.norm(pl.n) };
  b.y = V.cross(b.n, b.x);
  const W = ([u, v]) => V.add(b.o, V.add(V.mul(b.x, +u), V.mul(b.y, +v)));
  const p0 = W(pathPts(e)[0]), p1 = W(pathPts(e)[1]);
  const dir = V.norm(V.sub(p1, p0));
  const spine = () => {
    const pp = pathPts(e);
    let d = R.draw(pp[0]);
    for (let i = 1; i < pp.length; i++) d = d.lineTo(pp[i]);
    return (e.closed ? d.close() : d.done()).sketchOnPlane(rPlane(pl)).wires();
  };
  const plane = new R.Plane(p0, perp(dir), dir);
  const sweep = r => R.genericSweep(R.drawCircle(r).sketchOnPlane(plane).wires(), spine(), { frenet: false, transitionMode: 'round' }, false);
  let solid = sweep(D / 2);
  if (wall > 0) solid = solid.cut(sweep(D / 2 - wall));
  return solid;
}

// Coil (helical spring): circle/square/triangle section swept along a helix
function coilTool(f) {
  const D = +f.dia, n = +f.turns, H = +f.height, sz = +f.section;
  if (!(D > 0 && n > 0 && H > 0 && sz > 0)) fail('Durchmesser, Windungen, Höhe und Querschnitt angeben');
  const pitch = H / n;
  if (f.shape !== 'triangle' && sz >= pitch - 1e-6) fail(`Querschnitt (${sz}) muss kleiner als die Steigung (${pitch.toFixed(2)}) sein`);
  const ax = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[f.axis || 'z'];
  const c = [+f.x || 0, +f.y || 0, +f.z || 0];
  const helix = R.makeHelix(pitch, H, D / 2, c, ax, f.hand === 'left');
  const sp = helix.startPoint;
  const start = [sp.x, sp.y, sp.z];
  const u = V.norm(V.sub(start, V.add(c, V.mul(ax, V.dot(V.sub(start, c), ax)))));
  // section in the plane through the axis (local x = radial, local y = axial)
  const plane = new R.Plane(start, u, V.cross(u, ax));
  const h2 = sz / 2;
  const sec = f.shape === 'square' ? R.drawRectangle(sz, sz)
    : f.shape === 'triangle' ? R.draw([-h2, -h2]).lineTo([h2, 0]).lineTo([-h2, h2]).close()
    : R.drawCircle(h2);
  return R.genericSweep(sec.sketchOnPlane(plane).wires(), helix, { frenet: true }, false);
}

export const THREAD_SIZES = [
  ['M3', 3, 0.5, 2.5], ['M4', 4, 0.7, 3.3], ['M5', 5, 0.8, 4.2], ['M6', 6, 1, 5], ['M8', 8, 1.25, 6.8], ['M10', 10, 1.5, 8.5],
  ['M12', 12, 1.75, 10.2], ['M14', 14, 2, 12], ['M16', 16, 2, 14], ['M20', 20, 2.5, 17.5], ['M24', 24, 3, 21], ['M30', 30, 3.5, 26.5],
];

// Finds the cylindrical face through point p: axis, radius, inside (hole) or outside (shaft), axial extent.
function cylinderAt(bodies, p) {
  const oc = R.getOC();
  const v = R.makeVertex(p);
  for (const b of bodies) {
    if (!b.shape.wrapped) continue; // not an OpenCascade shape
    for (const fc of b.shape.faces) {
      if (fc.geomType !== 'CYLINDRE') continue;
      let d;
      try { d = R.measureDistanceBetween(fc, v); } catch { continue; }
      if (d > 0.05) continue;
      const cy = new oc.BRepAdaptor_Surface(fc.wrapped, true).Cylinder();
      const ax = cy.Axis(), L = ax.Location(), Dd = ax.Direction();
      const loc = [L.X(), L.Y(), L.Z()];
      let dir = V.norm([Dd.X(), Dd.Y(), Dd.Z()]);
      // consistent orientation: the largest component points positive (holes from above start at the top)
      const big = dir.reduce((m, v, i) => (Math.abs(v) > Math.abs(dir[m]) ? i : m), 0);
      if (dir[big] < 0) dir = V.mul(dir, -1);
      const nn = fc.normalAt(p);
      const radial = V.sub(V.sub(p, loc), V.mul(dir, V.dot(V.sub(p, loc), dir)));
      const outside = V.dot([nn.x, nn.y, nn.z], radial) > 0;
      const [lo, hi] = fc.boundingBox.bounds;
      const ts = [];
      for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) ts.push(V.dot(V.sub([x, y, z], loc), dir));
      return { body: b, loc, dir, r: cy.Radius(), outside, t0: Math.min(...ts), t1: Math.max(...ts) };
    }
  }
  return null;
}

// Cylinder through a point on a body (for CAM hole selection): axis, radius, extent.
export function cylinderInfo(bodies, p) {
  try { return cylinderAt(bodies, p); } catch { return null; }
}

// All cylindrical faces of the bodies (for picking holes from above).
export function cylinderFaces(bodies) {
  const oc = R.getOC();
  const out = [];
  bodies.forEach((b, bi) => {
    if (!b.shape.wrapped) return; // not an OpenCascade shape
    for (const fc of b.shape.faces) {
      if (fc.geomType !== 'CYLINDRE') continue;
      try {
        const cy = new oc.BRepAdaptor_Surface(fc.wrapped, true).Cylinder();
        const ax = cy.Axis(), L = ax.Location(), Dd = ax.Direction();
        const loc = [L.X(), L.Y(), L.Z()];
        const dir = V.norm([Dd.X(), Dd.Y(), Dd.Z()]);
        const q = fc.pointOnSurface(0.5, 0.5);
        const pt = [q.x, q.y, q.z];
        const nn = fc.normalAt(q);
        const radial = V.sub(V.sub(pt, loc), V.mul(dir, V.dot(V.sub(pt, loc), dir)));
        const [lo, hi] = fc.boundingBox.bounds;
        const ts = [];
        for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) ts.push(V.dot(V.sub([x, y, z], loc), dir));
        out.push({ bi, loc, dir, r: cy.Radius(), pt, outside: V.dot([nn.x, nn.y, nn.z], radial) > 0, t0: Math.min(...ts), t1: Math.max(...ts) });
      } catch { /* skip faces OpenCascade cannot evaluate */ }
    }
  });
  return out;
}

// Douglas–Peucker for a closed loop: keeps the points that matter within tol
function simplifyLoop(pts, tol) {
  if (pts.length < 8) return pts;
  const dist = (p, a, c) => { const dx = c[0] - a[0], dy = c[1] - a[1], L = Math.hypot(dx, dy); return L < 1e-12 ? Math.hypot(p[0] - a[0], p[1] - a[1]) : Math.abs(dx * (a[1] - p[1]) - dy * (a[0] - p[0])) / L; };
  const keep = new Uint8Array(pts.length);
  const rec = (i, j) => {
    let best = -1, bd = tol;
    for (let k = i + 1; k < j; k++) { const d = dist(pts[k], pts[i], pts[j % pts.length]); if (d > bd) { bd = d; best = k; } }
    if (best >= 0) { keep[best] = 1; rec(i, best); rec(best, j); }
  };
  // split the loop at its two farthest-apart points
  let far = 0, fd = 0;
  for (let k = 1; k < pts.length; k++) { const d = Math.hypot(pts[k][0] - pts[0][0], pts[k][1] - pts[0][1]); if (d > fd) { fd = d; far = k; } }
  keep[0] = keep[far] = 1;
  rec(0, far);
  rec(far, pts.length);
  const out = pts.filter((_, k) => keep[k]);
  return out.length >= 3 ? out : pts;
}

// ---------- Flächen (surface bodies: open shells like the usual surface workspace) ----------
export const SURFACE_TYPES = ['surfextrude', 'surfrevolve', 'patch', 'offsetsurf', 'surfloft', 'fill'];
// true when a shape holds at least one closed solid (bodies without one are surface bodies)
export function hasSolid(shape) {
  if (!shape?.wrapped) return true; // other kernels only make solids
  const oc = R.getOC();
  const ex = new oc.TopExp_Explorer(shape.wrapped, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  const r = ex.More();
  ex.delete();
  return r;
}
// every chosen sketch curve as a 3D wire: lines straight, arcs / circles / rectangles exact, splines as fine polylines
function curveWires(sk, ids) {
  const plane = () => rPlane(sketchPlane(sk));
  const wires = [];
  for (const e of sk.entities) {
    if (e.cons || e.type === 'text' || e.type === 'point') continue;
    if (Array.isArray(ids) && !ids.includes(e.id)) continue;
    let d = null;
    if (EXACT.has(e.type)) d = entityDrawing(e);
    else if (e.type === 'poly' && e.curve === 'arc' && e.pts.length === 3) d = R.draw(e.pts[0]).threePointsArcTo(e.pts[2], e.pts[1]).done();
    else if (hasCorners(e)) d = cornerDrawing(e);
    else if (e.type === 'poly') {
      const pts = (e.curve ? entityPolys(e)[0] : e.pts).filter((q, i, a) => i === 0 || Math.hypot(q[0] - a[i - 1][0], q[1] - a[i - 1][1]) > 1e-6);
      if (pts.length < 2) continue;
      if (e.closed) { d = polyDrawing(pts); } else {
        let dr = R.draw(pts[0]);
        for (let i = 1; i < pts.length; i++) dr = dr.lineTo(pts[i]);
        d = dr.done();
      }
    }
    if (!d) continue;
    const s = d.sketchOnPlane(plane());
    for (const one of s.sketches || [s]) wires.push(one.wire);
  }
  if (!wires.length) fail('Keine Kurven gewählt');
  return wires;
}
const compound = shapes => (shapes.length === 1 ? shapes[0] : R.makeCompound(shapes));
// open sheets from several pieces: sew them where they touch (one surface body), otherwise keep them together
function sewSheets(shapes) {
  if (shapes.length === 1) return shapes[0];
  try { return R.weldShellsAndFaces(shapes, true); } catch { return compound(shapes); }
}
function prism(shape, v) {
  const oc = R.getOC();
  const mk = new oc.BRepPrimAPI_MakePrism(shape.wrapped, new R.Vector(v).wrapped, false, true);
  const out = R.cast(mk.Shape());
  mk.delete();
  return out;
}
function surfExtrudeTool(sk, f) {
  const d = +f.distance;
  if (!d) fail('Abstand ist 0');
  const n = sketchPlane(sk).n;
  const sheets = [];
  for (const w of curveWires(sk, f.curves)) {
    if (f.extent === 'sym') sheets.push(prism(w.clone().translate(n.map(c => (-c * d) / 2)), n.map(c => c * d)));
    else {
      sheets.push(prism(w.clone(), n.map(c => c * d)));
      if (f.extent === 'two' && +f.distance2) sheets.push(prism(w.clone(), n.map(c => -c * f.distance2)));
    }
  }
  return sewSheets(sheets);
}
function surfRevolveTool(sk, f, features) {
  const { dir, origin } = revolveAxis(sk, f, features);
  const angle = +f.angle || 360;
  return sewSheets(curveWires(sk, f.curves).map(w => R.revolution(w, origin.toArray(), dir.toArray(), angle)));
}
// Flicken: closed profiles become flat faces
function patchTool(sk, f) {
  const ds = regionDrawings(sk, f.profiles);
  if (!ds.length) fail('Kein geschlossenes Profil');
  const faces = [];
  for (const d of ds) {
    const s = d.sketchOnPlane(rPlane(sketchPlane(sk)));
    for (const one of s.sketches || [s]) faces.push(one.face());
  }
  return sewSheets(faces);
}
// Versatzfläche: copies of the picked faces at a distance along their normals
function offsetSurfTool(f, bodies) {
  const faces = pickedFaces(f, bodies);
  const oc = R.getOC();
  const sheet = sewSheets(faces.map(fc => fc.clone()));
  const mk = new oc.BRepOffsetAPI_MakeOffsetShape();
  mk.PerformByJoin(sheet.wrapped, +f.distance || 0, 1e-4, oc.BRepOffset_Mode.BRepOffset_Skin, false, false, oc.GeomAbs_JoinType.GeomAbs_Arc, false, new oc.Message_ProgressRange());
  if (!mk.IsDone()) fail('Versatz nicht möglich (Abstand größer als der Krümmungsradius?)');
  const out = R.cast(mk.Shape());
  mk.delete();
  return out;
}
function pickedFaces(f, bodies) {
  const faces = [];
  for (const { b, own } of bodiesWithPoints(bodies, f.faces || [])) {
    for (const p of own) for (const fc of new R.FaceFinder().containsPoint(p).find(b.shape)) if (!faces.some(x => x.isSame?.(fc))) faces.push(fc);
  }
  if (!faces.length) fail('Flächen wählen');
  return faces;
}
// Erhebung als Fläche: one curve (open or closed) per section sketch, joined by a skin
function surfLoftTool(f, sketches) {
  const secs = (f.sections || []).map(id => sketches[id]).filter(Boolean);
  if (secs.length < 2) fail('Mindestens zwei Skizzen als Querschnitte wählen');
  const wires = secs.map(s => curveWires(s, 'all')[0]);
  try { return R.loft(wires, { ruled: !!f.ruled }, true); } catch { fail('Erhebung nicht möglich – je Skizze eine Kurve, gleiche Richtung, nicht verdreht'); }
}
// Trimmen: the surface is split where the trim tool crosses it; the clicked regions are removed
function trimToolShape(f, bodies, ctx) {
  if (f.toolKind === 'plane') {
    const p = planeRef(f.plane || 'XY', ctx.features);
    if (!p) fail('Ebene fehlt');
    return R.drawRectangle(20000, 20000).sketchOnPlane(rPlane(p)).face();
  }
  if (f.toolKind === 'sketch') {
    const sk = ctx.sketches[f.sketch];
    if (!sk) fail('Skizze fehlt');
    const n = sketchPlane(sk).n, L = 10000;
    return sewSheets(curveWires(sk, f.curves).map(w => prism(w.clone().translate(n.map(c => -c * L)), n.map(c => 2 * c * L))));
  }
  const tb = bodies.find(b => b.id === f.tool);
  if (!tb) fail('Trimmwerkzeug (Körper oder Fläche) wählen');
  return tb.shape;
}
function trimSurface(f, bodies, ctx) {
  const b = bodies.find(x => x.id === f.body);
  if (!b) fail('Fläche wählen, die getrimmt wird');
  if (f.tool === f.body && f.toolKind === 'body') fail('Werkzeug und Fläche müssen verschieden sein');
  const oc = R.getOC();
  const args = new oc.NCollection_List_TopoDS_Shape(), tls = new oc.NCollection_List_TopoDS_Shape();
  args.Append(b.shape.wrapped);
  tls.Append(trimToolShape(f, bodies, ctx).wrapped);
  const sp = new oc.BRepAlgoAPI_Splitter();
  sp.SetArguments(args);
  sp.SetTools(tls);
  sp.Build(new oc.Message_ProgressRange());
  if (!sp.IsDone()) fail('Trimmen nicht möglich');
  const split = R.cast(sp.Shape());
  sp.delete();
  const faces = split.faces;
  if (faces.length <= b.shape.faces.length) fail('Das Werkzeug schneidet die Fläche nicht');
  const pts = f.faces || [];
  const keep = faces.filter(fc => !pts.some(p => { try { return new R.FaceFinder().containsPoint(p).find(fc).length > 0; } catch { return false; } }));
  if (!keep.length) fail('Es würde nichts übrig bleiben');
  b.shape = sewSheets(keep);
  return faces.length;
}
// round along a curved edge: a quarter disc (between the two offset normals) swept along the edge
function curvedRound(e, fa, fb, r, s) {
  const A = P3(e.pointAt(0)), m = P3(e.pointAt(0.5));
  // normalAt is not always a unit vector (on cylinders its length is the radius)
  const nAt = (fc, p) => { const n = fc.normalAt(p); return V.norm([n.x, n.y, n.z]); };
  const t = V.norm(V.sub(P3(e.pointAt(0.502)), P3(e.pointAt(0.498))));
  const into = fc => { const c = fc.center, v = V.sub([c.x, c.y, c.z], m); return V.norm(V.sub(v, V.mul(t, V.dot(v, t)))); };
  if (V.dot(V.mul(nAt(fb, m), s), into(fa)) >= -1e-6 || V.dot(V.mul(nAt(fa, m), s), into(fb)) >= -1e-6) return null; // inner corner
  const u = V.mul(nAt(fa, A), s * r), w = V.mul(nAt(fb, A), s * r);
  const mid = V.add(A, V.mul(V.norm(V.add(u, w)), r));
  try {
    const prof = R.assembleWire([R.makeLine(A, V.add(A, u)), R.makeThreePointArc(V.add(A, u), mid, V.add(A, w)), R.makeLine(V.add(A, w), A)]);
    const sw = R.genericSweep(prof, R.assembleWire([e.clone()]), { frenet: true }, false);
    return R.measureVolume(sw) < 0 ? R.cast(sw.wrapped.Reversed()) : sw;
  } catch { return null; }
}
// Aufdicken: fill the gap at outer corners between two picked faces with a round (arc join)
function thickenCorners(faces, off) {
  const fills = [];
  const r = Math.abs(off), s = Math.sign(off);
  for (let i = 0; i < faces.length; i++) for (let j = i + 1; j < faces.length; j++) {
    for (const e of faces[i].edges) {
      if (!faces[j].edges.some(x => x.isSame(e))) continue;
      if (e.geomType !== 'LINE') { const r0 = curvedRound(e, faces[i], faces[j], r, s); if (r0) fills.push(r0); continue; }
      const a = e.startPoint, z = e.endPoint;
      const A = [a.x, a.y, a.z], Z = [z.x, z.y, z.z], m = A.map((v, k) => (v + Z[k]) / 2);
      const d = V.norm(V.sub(Z, A));
      const nOf = fc => { const n = fc.normalAt(m); return V.norm([n.x, n.y, n.z]); };
      const intoFace = fc => { const c = fc.center, v = V.sub([c.x, c.y, c.z], m); return V.norm(V.sub(v, V.mul(d, V.dot(v, d)))); };
      const n1 = nOf(faces[i]), n2 = nOf(faces[j]);
      // outer corner (seen in the thickening direction): the faces turn away from each other
      if (V.dot(V.mul(n2, s), intoFace(faces[i])) >= -1e-6 || V.dot(V.mul(n1, s), intoFace(faces[j])) >= -1e-6) continue;
      const len = V.dot(V.sub(Z, A), d);
      // only the quarter outside both faces: the cylinder around the edge cut to the wedge between the offset normals
      const u = V.mul(n1, s * r * 1.01), w = V.mul(n2, s * r * 1.01);
      const wedge = prism(R.makePolygon([A, V.add(A, u), V.add(V.add(A, u), w), V.add(A, w)]), V.mul(d, len));
      fills.push(R.makeCylinder(r, len, A, d).intersect(wedge));
    }
  }
  return fills;
}
// picked edges (midpoint refs) → the edges of the bodies, with the body they belong to
function pickedEdges(refs, bodies) {
  const out = [];
  for (const b of bodies) {
    const m = edgeMatcher(b.shape, refs || []);
    if (!m.count) continue;
    for (const e of b.shape.edges) if (m.fn(e)) out.push({ e, b });
  }
  return out;
}
const P3 = p => [p.x, p.y, p.z];
// Verlängern: the surface grows past the picked edges, tangent to the surface ("Tangential")
function extendSurface(f, bodies) {
  const d = +f.distance;
  if (!(d > 0)) fail('Abstand fehlt');
  const hits = pickedEdges(f.edges, bodies);
  if (!hits.length) fail('Randkanten der Fläche wählen');
  const byBody = new Map();
  for (const { e, b } of hits) {
    const fc = b.shape.faces.find(x => x.edges.some(y => y.isSame(e)));
    if (!fc) continue;
    const N = e.geomType === 'LINE' ? 1 : 24;
    const tan = u => V.norm(V.sub(P3(e.pointAt(Math.min(1, u + 0.002))), P3(e.pointAt(Math.max(0, u - 0.002)))));
    const dirAt = u => { const p = P3(e.pointAt(u)), n = fc.normalAt(p); return V.norm(V.cross(tan(u), V.norm([n.x, n.y, n.z]))); };
    // outwards = away from the face
    const m = P3(e.pointAt(0.5)), c = fc.center;
    const sgn = V.dot(dirAt(0.5), V.sub([c.x, c.y, c.z], m)) > 0 ? -1 : 1;
    const pts = [];
    for (let k = 0; k <= N; k++) { const u = k / N; pts.push(V.add(P3(e.pointAt(u)), V.mul(dirAt(u), sgn * d))); }
    const far = N === 1 ? R.makeLine(pts[0], pts[1]) : R.makeBSplineApproximation(pts);
    const strip = R.loft([R.assembleWire([e.clone()]), R.assembleWire([far])], { ruled: true }, true);
    if (!byBody.has(b)) byBody.set(b, []);
    byBody.get(b).push(strip);
  }
  if (!byBody.size) fail('Die gewählten Kanten gehören zu keiner Fläche');
  for (const [b, strips] of byBody) {
    const oc = R.getOC();
    const sew = new oc.BRepBuilderAPI_Sewing(1e-3, true, true, true, false);
    sew.Add(b.shape.wrapped);
    for (const s of strips) sew.Add(s.wrapped);
    sew.Perform(new oc.Message_ProgressRange());
    b.shape = R.cast(sew.SewedShape());
    sew.delete();
  }
}
// Rand füllen: a surface spanned into a closed chain of edges (any shape, not only flat)
function fillTool(f, bodies) {
  const hits = pickedEdges(f.edges, bodies);
  if (hits.length < 1) fail('Kanten wählen, die einen geschlossenen Rand bilden');
  const oc = R.getOC();
  const mk = new oc.BRepOffsetAPI_MakeFilling(3, 15, 2, false, 1e-5, 1e-4, 0.01, 0.1, 8, 9);
  for (const { e, b } of hits) {
    const fc = f.tangent ? b.shape.faces.find(x => x.edges.some(y => y.isSame(e))) : null;
    if (fc) mk.Add(e.wrapped, fc.wrapped, oc.GeomAbs_Shape.GeomAbs_G1, true);
    else mk.Add(e.wrapped, oc.GeomAbs_Shape.GeomAbs_C0, true);
  }
  try { mk.Build(new oc.Message_ProgressRange()); } catch { fail('Rand ist nicht geschlossen oder lässt sich nicht füllen'); }
  if (!mk.IsDone()) fail('Rand ist nicht geschlossen oder lässt sich nicht füllen');
  return R.cast(mk.Shape());
}
// Zusammenfügen (stitch): surface bodies sewn along shared edges; a closed result becomes a solid
function stitchBodies(f, bodies) {
  const ids = Array.isArray(f.bodies) && f.bodies.length ? f.bodies : bodies.filter(b => !hasSolid(b.shape)).map(b => b.id);
  const picked = bodies.filter(b => ids.includes(b.id));
  if (picked.length < 1) fail('Flächenkörper wählen');
  const oc = R.getOC();
  const sew = new oc.BRepBuilderAPI_Sewing(+f.tolerance || 0.01, true, true, true, false);
  for (const b of picked) sew.Add(b.shape.wrapped);
  sew.Perform(new oc.Message_ProgressRange());
  let out = R.cast(sew.SewedShape());
  // only a hull without free (unshared) edges is closed and may become a solid
  const open = sew.NbFreeEdges() > 0;
  sew.delete();
  let closed = false;
  if (!open) try {
    const sol = R.cast(new oc.ShapeFix_Solid().SolidFromShell(out.wrapped));
    if (sol instanceof R.Solid && R.measureVolume(sol) > 1e-6) { out = sol; closed = true; }
  } catch { /* stays a surface */ }
  const first = bodies.indexOf(picked[0]);
  for (const b of picked.slice(1)) bodies.splice(bodies.indexOf(b), 1);
  bodies[first] = { ...picked[0], shape: out };
  return closed;
}

// ---------- Aufdicken (thicken) ----------
// The picked faces (any shape: planar, cylindrical, freeform) are sewn into one sheet and given a thickness
// along their normals: outward, inward or to both sides. The result is a new solid (new body, join or cut).
function thickenTool(f, bodies) {
  const t = +f.thickness;
  if (!(t > 0)) fail('Dicke fehlt');
  const hits = bodiesWithPoints(bodies, f.faces || []);
  const faces = [];
  for (const { b, own } of hits) {
    for (const p of own) for (const fc of new R.FaceFinder().containsPoint(p).find(b.shape)) if (!faces.some(x => x.isSame?.(fc))) faces.push(fc);
  }
  if (!faces.length) fail('Flächen wählen, die aufgedickt werden sollen');
  const oc = R.getOC();
  // every face on its own (a simple offset is exact for planes, cylinders and freeform faces), then fused.
  // Work on copies: a solid sharing the very faces of the body confuses the following join / cut.
  const thickFace = (fc, off) => {
    const mk = new oc.BRepOffsetAPI_MakeThickSolid();
    mk.MakeThickSolidBySimple(fc.clone().wrapped, off);
    mk.Build(new oc.Message_ProgressRange());
    if (!mk.IsDone()) fail('Diese Fläche lässt sich nicht aufdicken (z. B. Kugelfläche, oder Dicke größer als der Krümmungsradius)');
    // depending on the face orientation the solid comes out inside-out (negative volume): turn it around
    const out = R.cast(mk.Shape());
    return R.measureVolume(out) < 0 ? R.cast(mk.Shape().Reversed()) : out;
  };
  // corner rounds go in between the plates: plates that only touch along an edge stay separate pieces,
  // and fusing such a group with a further solid loses the plates
  const thick = off => {
    const plates = faces.map(fc => thickFace(fc, off)), rounds = thickenCorners(faces, off);
    let out = plates[0];
    for (const r of rounds) out = out.fuse(r);
    for (const pl of plates.slice(1)) out = out.fuse(pl);
    return out;
  };
  const dir = f.direction || 'out';
  if (dir === 'both') return thick(t / 2).fuse(thick(-t / 2));
  return thick(dir === 'in' ? -t : t);
}

// ---------- Prägen (emboss / deboss) ----------
// Flat: the profiles are raised from / sunk into the sketch plane. On a cylinder: the profiles are wrapped
// around it true to length (distance across the axis becomes arc length) and built from planar triangles,
// subdivided finely enough that the top follows the curvature.
function embossTool(sk, f, bodies) {
  const d = +f.depth;
  if (!(d > 0)) fail('Tiefe fehlt');
  const raise = f.mode !== 'deboss';
  if (f.wrap !== 'cyl') return extrudeTool(sk, { profiles: f.profiles, extent: 'one', distance: raise ? d : -d });
  followCylinder(f, bodies);
  if (!Array.isArray(f.pts) || f.pts.length !== 2 || !(+f.r > 0)) fail('Zylinderfläche wählen');
  const R0 = +f.r;
  const A = new THREE.Vector3(...f.pts[0]), D = new THREE.Vector3(...f.pts[1]).sub(A).normalize();
  const b = basis(sk);
  if (Math.abs(b.n.dot(D)) > 1e-3) fail('Die Skizzenebene muss parallel zur Zylinderachse liegen (z. B. eine Tangentialebene).');
  const e1 = b.n.clone().addScaledVector(D, -b.n.dot(D)).normalize();
  if (b.o.clone().sub(A).dot(e1) < 0) e1.negate();
  const w = new THREE.Vector3().crossVectors(D, e1);
  // work in (s, t): s = arc length across the axis, t = position along it (both linear in the sketch)
  const st = q => { const P = toWorld(b, q[0], q[1]).sub(A); return [P.dot(w), P.dot(D)]; };
  const wrap = ([sv, tv], rho) => { const a = sv / R0; return A.clone().addScaledVector(D, tv).addScaledVector(e1, rho * Math.cos(a)).addScaledVector(w, rho * Math.sin(a)).toArray(); };
  const [rIn, rOut] = raise ? [R0 - 0.02, R0 + d] : [R0 - d, R0 + 0.02];
  if (rIn <= 0) fail('Tiefe größer als der Zylinderradius');
  const CL = globalThis.ClipperLib;
  if (!CL) fail('Polygon-Bibliothek fehlt');
  // the region is cut into narrow strips across s: each strip is nearly flat on the cylinder, so a few planar
  // triangles per strip follow the curvature (far fewer faces than subdividing everything)
  // strip width: the flat chord stays within ~0.02 mm of the true cylinder
  const step = Math.max(0.05, Math.min(R0 * 0.12, 2 * Math.sqrt(2 * R0 * 0.02))), SC = 1e5;
  const grid = v => Math.round(v * SC) / SC;
  const { regions } = buildRegions(profileItems(sk, f.profiles));
  if (!regions.length) fail('Kein geschlossenes Profil');
  const solids = [];
  for (const rg of regions) {
    // drop points that change the outline by less than 0.01 mm (font curves come very finely divided)
    let loops = [rg.outer, ...rg.holes].map(l => simplifyLoop(l.map(st), 0.01));
    const all = loops.flat(), smin = Math.min(...all.map(q => q[0])), smax = Math.max(...all.map(q => q[0]));
    const tmin = Math.min(...all.map(q => q[1])), tmax = Math.max(...all.map(q => q[1]));
    const off = step * 0.318309; // strip lines never coincide with straight profile edges
    const cuts = [];
    for (let x = Math.floor((smin - off) / step) * step + off; x < smax; x += step) if (x > smin) cuts.push(x);
    // insert the strip crossings into every loop, then snap all points to the clipping grid
    loops = loops.map(loop => {
      const out = [];
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i], q = loop[(i + 1) % loop.length];
        out.push(p);
        const xs = cuts.filter(x => (x - p[0]) * (x - q[0]) < 0).sort((a, c) => (q[0] > p[0] ? a - c : c - a));
        for (const x of xs) { const k = (x - p[0]) / (q[0] - p[0]); out.push([x, p[1] + (q[1] - p[1]) * k]); }
      }
      return out.map(q => [grid(q[0]), grid(q[1])]);
    });
    const faces = [];
    const tri = (p, q, r) => { try { faces.push(R.makePolygon([p, q, r])); } catch { /* degenerate */ } };
    // top and bottom: one clipping per strip
    const paths = loops.map(l => l.map(([x, y]) => ({ X: Math.round(x * SC), Y: Math.round(y * SC) })));
    const edges = [smin - 1, ...cuts, smax + 1];
    for (let k = 0; k + 1 < edges.length; k++) {
      const c = new CL.Clipper();
      c.PreserveCollinear = true;
      c.AddPaths(paths, CL.PolyType.ptSubject, true);
      const x0 = Math.round(edges[k] * SC), x1 = Math.round(edges[k + 1] * SC), y0 = Math.round((tmin - 1) * SC), y1 = Math.round((tmax + 1) * SC);
      c.AddPath([{ X: x0, Y: y0 }, { X: x1, Y: y0 }, { X: x1, Y: y1 }, { X: x0, Y: y1 }], CL.PolyType.ptClip, true);
      const tree = new CL.PolyTree();
      c.Execute(CL.ClipType.ctIntersection, tree, CL.PolyFillType.pftEvenOdd, CL.PolyFillType.pftNonZero);
      const walk = node => {
        for (const ch of node.Childs()) {
          if (!ch.IsHole()) {
            const toV = pts => pts.map(p => new THREE.Vector2(p.X / SC, p.Y / SC));
            const outerV = toV(ch.Contour()), holesV = ch.Childs().map(hh => toV(hh.Contour()));
            const flat = [outerV, ...holesV].flat();
            for (const t of THREE.ShapeUtils.triangulateShape(outerV, holesV)) {
              const [p, q, r] = t.map(i => [flat[i].x, flat[i].y]);
              tri(wrap(p, rOut), wrap(q, rOut), wrap(r, rOut));
              tri(wrap(p, rIn), wrap(r, rIn), wrap(q, rIn));
            }
          }
          walk(ch);
        }
      };
      walk(tree);
    }
    // side walls along the (crossing-refined) profile loops
    for (const loop of loops) {
      for (let i = 0; i < loop.length; i++) {
        const p = loop[i], q = loop[(i + 1) % loop.length];
        tri(wrap(p, rIn), wrap(q, rIn), wrap(q, rOut));
        tri(wrap(p, rIn), wrap(q, rOut), wrap(p, rOut));
      }
    }
    solids.push(R.makeSolid(faces));
  }
  // separate letters/profiles do not touch: a compound is enough (fusing them first costs seconds)
  return solids.length > 1 ? R.makeCompound(solids) : solids[0];
}

// Axis through a cylinder / tangent plane: find the picked cylinder again in the current bodies
// (parallel axis close to the stored one) and take over its position, ends and radius – so it moves
// with the hole when that changes. Without a match the stored geometry is kept.
function followCylinder(f, bodies) {
  if (!Array.isArray(f.pts) || f.pts.length !== 2) return;
  const [p0, p1] = f.pts;
  const d0 = V.norm(V.sub(p1, p0)), mid = V.mul(V.add(p0, p1), 0.5), r0 = +f.r || 0;
  let best = null;
  for (const c of cylinderFaces(bodies)) {
    const dot = V.dot(c.dir, d0);
    if (Math.abs(dot) < 0.999) continue;
    const w = V.sub(mid, c.loc), off = V.sub(w, V.mul(c.dir, V.dot(w, c.dir)));
    const dist = Math.hypot(...off), score = dist + 0.2 * Math.abs(c.r - r0);
    if (dist <= Math.max(2, 2 * r0) && (!best || score < best.score)) best = { c, score, sign: Math.sign(dot) };
  }
  if (!best) return;
  const { c, sign } = best;
  const at = t => c.loc.map((v, i) => +(v + c.dir[i] * t).toFixed(4));
  f.pts = sign > 0 ? [at(c.t0), at(c.t1)] : [at(c.t1), at(c.t0)];
  f.r = +c.r.toFixed(4);
}

export function threadSpec(f, cyl) {
  if (f.size && f.size !== 'auto') {
    const t = THREAD_SIZES.find(x => x[0] === f.size);
    if (t) return { name: t[0], D: t[1], P: +f.pitch || t[2] };
  }
  const D2 = 2 * cyl.r;
  const t = THREAD_SIZES.reduce((best, x) => (Math.abs((cyl.outside ? x[1] : x[3]) - D2) < Math.abs((cyl.outside ? best[1] : best[3]) - D2) ? x : best));
  return { name: t[0], D: t[1], P: +f.pitch || t[2] };
}

function applyThread(f, ctx) {
  const p = (f.faces || [])[f.faces?.length - 1];
  if (!p) fail('Zylinderfläche wählen (Bohrung oder Bolzen)');
  const cyl = cylinderAt(ctx.bodies, p);
  if (!cyl) fail('Gewählte Fläche ist keine Zylinderfläche');
  const { name, D, P } = threadSpec(f, cyl);
  const span = cyl.t1 - cyl.t0;
  const L = f.full !== false ? span : Math.min(span, +f.length || span);
  // start at the chosen end and run into the part
  const fromTop = !f.flip;
  const d = fromTop ? V.mul(cyl.dir, -1) : cyl.dir;
  const startT = fromTop ? cyl.t1 : cyl.t0;
  const c0 = V.add(cyl.loc, V.mul(cyl.dir, startT));
  ctx.threads.push({ id: f.id, name: `${name}×${P}`, c: c0, d, r: cyl.outside ? D / 2 : D / 2 - 0.5413 * P, L, P, outside: cyl.outside });
  if (!f.modeled) return;
  const H5 = 0.5413 * P, t30 = Math.tan(Math.PI / 6);
  // groove profile (radial a, axial b); external: root P/4 wide, internal: tip P/8 wide
  let prof;
  if (cyl.outside) {
    const r0 = D / 2 - H5, r1 = D / 2 + 0.1 * P;
    const w0 = P / 8, w1 = w0 + (r1 - r0) * t30;
    prof = [[r0, -w0], [r1, -w1], [r1, w1], [r0, w0]];
  } else {
    const r1 = D / 2, r0 = D / 2 - H5 - 0.1 * P;
    const w1 = P / 16, w0 = w1 + (r1 - r0) * t30;
    prof = [[r0, -w0], [r1, -w1], [r1, w1], [r0, w0]];
  }
  const c = V.sub(c0, V.mul(d, P)); // one pitch of run-out outside the face
  const helix = R.makeHelix(P, L + P, prof[0][0], c, d, f.hand === 'left');
  const sp = helix.startPoint;
  const start = [sp.x, sp.y, sp.z];
  const u = V.norm(V.sub(V.sub(start, c), V.mul(d, V.dot(V.sub(start, c), d))));
  const plane = new R.Plane(c, u, V.cross(u, d));
  let dr = R.draw(prof[0]);
  for (const q of prof.slice(1)) dr = dr.lineTo(q);
  const groove = R.genericSweep(dr.close().sketchOnPlane(plane).wires(), helix, { frenet: true }, false);
  cyl.body.shape = cyl.body.shape.cut(groove);
}

// Bodies whose bounding box contains at least one picked point.
function bodiesWithPoints(bodies, refs) {
  return bodies.map(b => {
    const bb = b.shape.boundingBox.bounds;
    const own = refs.filter(r => [0, 1, 2].every(k => r[k] >= bb[0][k] - 1e-3 && r[k] <= bb[1][k] + 1e-3));
    return { b, own };
  }).filter(x => x.own.length);
}
const faceFilter = pts => ff => ff.either(pts.map(p => g => g.containsPoint(p)));

// Freeform: smooth spline rows through a grid of control heights, lofted into a solid.
function freeformTool(f) {
  const rows = (f.heights || []).map(r => r.map(Number));
  const ny = rows.length, nx = rows[0]?.length || 0;
  if (ny < 2 || nx < 2) fail('Mindestens 2 × 2 Kontrollpunkte');
  const x0 = +f.x, y0 = +f.y, w = +f.w, d = +f.d, base = +f.base;
  if (!(w > 0 && d > 0)) fail('Größe fehlt');
  if (rows.some(r => r.some(hz => !(hz > base + 1e-3)))) fail('Alle Höhen müssen über der Grundfläche liegen');
  const sections = rows.map((row, j) => {
    const pts = row.map((hz, i) => [x0 + (w * i) / (nx - 1), hz]);
    let dr = R.draw([x0, base]).lineTo(pts[0]);
    // Catmull-Rom through the control points, written as cubic Béziers (C1-smooth)
    for (let i = 0; i < nx - 1; i++) {
      const P0 = pts[i - 1] || pts[i], P1 = pts[i], P2 = pts[i + 1], P3 = pts[i + 2] || pts[i + 1];
      const c1 = [P1[0] + (P2[0] - P0[0]) / 6, P1[1] + (P2[1] - P0[1]) / 6];
      const c2 = [P2[0] - (P3[0] - P1[0]) / 6, P2[1] - (P3[1] - P1[1]) / 6];
      dr = f.smooth === false ? dr.lineTo(P2) : dr.cubicBezierCurveTo(P2, c1, c2);
    }
    dr = dr.lineTo([x0 + w, base]).close();
    return dr.sketchOnPlane(new R.Plane([0, y0 + (d * j) / (ny - 1), 0], [1, 0, 0], [0, -1, 0]));
  });
  try {
    return sections[0].loftWith(sections.slice(1), { ruled: f.smooth === false });
  } catch {
    fail('Freiformfläche konnte nicht erzeugt werden – Höhen prüfen');
  }
}

// Base polygon of a sheet-metal part: first closed profile of an XY sketch, in world XY.
export function sheetBase(sk) {
  const b = basis(sk);
  if (Math.abs(Math.abs(b.n.z) - 1) > 1e-6) fail('Blech braucht eine Skizze parallel zur XY-Ebene');
  const it = profileItems(sk).find(i => i.e.type !== 'text');
  if (!it) fail('Kein geschlossenes Profil in der Skizze');
  return { poly: it.poly.map(([u, v]) => { const p = toWorld(b, u, v); return [p.x, p.y]; }), z0: b.o.z };
}

// Rib / web: an open sketch line thickened in the sketch plane and extruded
// along the sketch normal (one side or symmetric); joints are rounded.
function ribTool(f, sketches) {
  const sk = sketches[f.sketch];
  const e = sk && sk.entities.find(x => x.id === f.entity);
  if (!e || e.type !== 'poly') fail('Offene Linie in einer Skizze wählen');
  const t = +f.thickness, hgt = +f.height;
  if (!(t > 0)) fail('Dicke fehlt');
  if (!hgt) fail('Höhe ist 0');
  const pts = pathPts(e);
  const pl = sketchPlane(sk);
  const plane = f.symmetric ? rPlane({ ...pl, o: pl.o.map((c, i) => c - pl.n[i] * hgt / 2) }) : rPlane(pl);
  const parts = [];
  const n = e.closed ? pts.length : pts.length - 1;
  for (let i = 0; i < n; i++) {
    const a = pts[i], b = pts[(i + 1) % pts.length];
    const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    const ox = (-dy / L) * t / 2, oy = (dx / L) * t / 2;
    parts.push(polyDrawing([[a[0] + ox, a[1] + oy], [b[0] + ox, b[1] + oy], [b[0] - ox, b[1] - oy], [a[0] - ox, a[1] - oy]]).sketchOnPlane(plane).extrude(hgt));
  }
  // round joints between segments (dense polylines of arcs and splines do not need them)
  if (!e.curve) for (let i = e.closed ? 0 : 1; i < (e.closed ? pts.length : pts.length - 1); i++) parts.push(R.drawCircle(t / 2).translate(pts[i][0], pts[i][1]).sketchOnPlane(plane).extrude(hgt));
  if (!parts.length) fail('Linie ist leer');
  return fuseAll(parts);
}

function primitiveTool(f) {
  if (f.type === 'torus') {
    if (!(f.R > 0 && f.r > 0)) fail('Radien fehlen');
    if (+f.r >= +f.R) fail('Rohrradius muss kleiner als der Ringradius sein');
    let s = R.drawCircle(+f.r).translate(+f.R, 0).sketchOnPlane('XZ').revolve([0, 0, 1], { origin: [0, 0, 0], angle: 360 });
    if (f.axis === 'x') s = s.rotate(90, [0, 0, 0], [0, 1, 0]);
    else if (f.axis === 'y') s = s.rotate(90, [0, 0, 0], [1, 0, 0]);
    return s.translate([+f.x || 0, +f.y || 0, +f.z || 0]);
  }
  if (f.type === 'box') {
    if (!(f.w > 0 && f.d > 0 && f.h)) fail('Maße fehlen');
    return R.drawRectangle(f.w, f.d).translate(+f.x + f.w / 2, +f.y + f.d / 2).sketchOnPlane('XY', +f.z).extrude(+f.h);
  }
  if (f.type === 'cylinder') {
    if (!(f.r > 0 && f.h)) fail('Maße fehlen');
    return R.drawCircle(+f.r).translate(+f.x, +f.y).sketchOnPlane('XY', +f.z).extrude(+f.h);
  }
  if (!(f.r > 0)) fail('Radius fehlt');
  return R.makeSphere(+f.r).translate(+f.x, +f.y, +f.z);
}

const near = (p, r, tol) => Math.hypot(p.x - r[0], p.y - r[1], p.z - r[2]) < tol;

// Picked edges are stored by their midpoint; match exactly first, then the nearest one.
function edgeMatcher(shape, refs) {
  const mids = shape.edges.map(e => e.pointAt(0.5));
  const chosen = new Set();
  for (const r of refs) {
    let bi = -1, bd = 1.0;
    mids.forEach((m, i) => { const d = Math.hypot(m.x - r[0], m.y - r[1], m.z - r[2]); if (d < bd) { bd = d; bi = i; } });
    if (bi >= 0) chosen.add(`${mids[bi].x.toFixed(4)},${mids[bi].y.toFixed(4)},${mids[bi].z.toFixed(4)}`);
  }
  const fn = e => { const m = e.pointAt(0.5); return chosen.has(`${m.x.toFixed(4)},${m.y.toFixed(4)},${m.z.toFixed(4)}`); };
  return { count: chosen.size, fn };
}

function applyOp(bodies, tool, op, id, target) {
  if (op === 'new' || (!bodies.length && op === 'join')) {
    bodies.push({ id, name: `Körper${bodies.length + 1}`, shape: tool });
    return;
  }
  if (!bodies.length) fail('Kein Körper vorhanden');
  if (op === 'cut') {
    for (const b of bodies) b.shape = b.shape.cut(tool.clone());
    return;
  }
  const t = bodies.find(b => b.id === target) || [...bodies].reverse().find(b => hasSolid(b.shape)) || bodies[bodies.length - 1];
  t.shape = op === 'intersect' ? t.shape.intersect(tool) : t.shape.fuse(tool);
}

// axis of a circular pattern: X/Y/Z through the centre, or a construction axis
export function patternAxis(f, features = []) {
  const ca = !['x', 'y', 'z'].includes(f.axis || 'z') && axisRef(f.axis, features);
  if (f.axis && !['x', 'y', 'z'].includes(f.axis) && !ca) fail('Konstruktionsachse fehlt');
  return ca ? { c: ca.o, d: ca.d } : { c: [+f.cx || 0, +f.cy || 0, +f.cz || 0], d: { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[f.axis || 'z'] };
}
// Pattern along a sketch path ("Muster entlang Pfad"): one placement per copy, relative to the path start.
// → [{ tr: [x,y,z], rot: { deg, c, axis } | null }] for copies 1…n-1
export function pathPlacements(f, features = []) {
  const ps = features.find(x => x.id === f.pathSketch);
  const e = ps && ps.entities.find(x => x.id === f.pathEntity);
  if (!e || e.type !== 'poly') fail('Pfad wählen (Linie, Bogen oder Linienzug in einer Skizze)');
  const b = basis(ps);
  const P = entityOutline(e).pts.map(q => toWorld(b, q[0], q[1]));
  if (e.closed) P.push(P[0].clone());
  if (f.flip) P.reverse();
  const L = [0];
  for (let i = 1; i < P.length; i++) L.push(L[i - 1] + P[i].distanceTo(P[i - 1]));
  const total = L[L.length - 1];
  if (!(total > 1e-9)) fail('Pfad hat keine Länge');
  const n = Math.max(1, Math.round(+f.n || 1));
  const D = +f.dist > 0 ? +f.dist : total;
  // extent: the copies share the distance (closed path: evenly around); spacing: fixed gap
  const step = f.distType === 'spacing' ? D : e.closed && !(+f.dist > 0) ? D / n : D / Math.max(1, n - 1);
  // arcs: exact tangent from the circle (the polygon chords would be off by half a segment angle)
  const circ = e.curve === 'arc' && e.pts.length === 3 ? circle3(...e.pts) : null;
  const C = circ && toWorld(b, circ.cx, circ.cy);
  const at = s => {
    let i = 1;
    while (i < L.length - 1 && L[i] < s) i++;
    const seg = P[i].clone().sub(P[i - 1]), len = L[i] - L[i - 1];
    const t = len > 0 ? Math.min(1, Math.max(0, (s - L[i - 1]) / len)) : 0;
    const p = P[i - 1].clone().addScaledVector(seg, t);
    let d = seg.clone().normalize();
    if (C) {
      const tan = new THREE.Vector3().crossVectors(b.n, p.clone().sub(C)).normalize();
      d = tan.dot(seg) < 0 ? tan.negate() : tan;
    }
    return { p, d };
  };
  const a0 = at(0), out = [];
  for (let k = 1; k < n; k++) {
    const s = k * step;
    if (s > total + 1e-6) break;
    const a = at(s);
    let rot = null;
    if (f.orient === 'path') {
      const dot = Math.max(-1, Math.min(1, a0.d.dot(a.d)));
      const deg = (Math.acos(dot) * 180) / Math.PI;
      if (deg > 1e-6) {
        let axis = new THREE.Vector3().crossVectors(a0.d, a.d);
        if (axis.lengthSq() < 1e-12) axis = new THREE.Vector3().crossVectors(a0.d, Math.abs(a0.d.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0));
        rot = { deg, c: a0.p.toArray(), axis: axis.normalize().toArray() };
      }
    }
    out.push({ tr: a.p.clone().sub(a0.p).toArray(), rot });
  }
  return out;
}
function patternTools(src, f, features = []) {
  const out = [];
  if (f.kind === 'path') {
    for (const pl of pathPlacements(f, features)) {
      let s = src.clone();
      if (pl.rot) s = s.rotate(pl.rot.deg, pl.rot.c, pl.rot.axis);
      out.push(s.translate(pl.tr));
    }
    return out;
  }
  if (f.kind === 'circ') {
    const n = Math.max(1, Math.round(+f.n));
    const ang = +f.angle || 360;
    const step = Math.abs(ang) >= 360 ? ang / n : ang / Math.max(1, n - 1);
    const { c, d } = patternAxis(f, features);
    for (let k = 1; k < n; k++) out.push(src.clone().rotate(step * k, c, d));
  } else {
    const dirs = { x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] };
    const d1 = dirs[f.dir1 || 'x'], d2 = dirs[f.dir2 || 'y'];
    const n1 = Math.max(1, Math.round(+f.n1)), n2 = Math.max(1, Math.round(+f.n2 || 1));
    for (let i = 0; i < n1; i++) for (let j = 0; j < n2; j++) {
      if (!i && !j) continue;
      const v = [0, 1, 2].map(k => d1[k] * f.s1 * i + d2[k] * (f.s2 || 0) * j);
      out.push(src.clone().translate(v));
    }
  }
  return out;
}

function runFeature(f, ctx) {
  const { bodies, sketches, tools } = ctx;
  if (f.type === 'import') {
    // STEP data (IGES is converted to STEP on import); every solid becomes a body
    const solids = stepSolids(f.blob);
    solids.forEach((s0, k) => {
      let s = s0;
      const sc = +f.scale || 1;
      if (sc !== 1) s = s.scale(sc, [0, 0, 0]);
      if (f.yUp) s = s.rotate(90, [0, 0, 0], [1, 0, 0]);
      if (+f.rz) s = s.rotate(+f.rz, [0, 0, 0], [0, 0, 1]);
      s = s.translate([+f.dx || 0, +f.dy || 0, +f.dz || 0]);
      applyOp(bodies, s, f.op || 'new', k ? `${f.id}#${k}` : f.id, f.target);
    });
    return;
  }
  if (SURFACE_TYPES.includes(f.type)) {
    const sk = sketches[f.sketch];
    if (!['offsetsurf', 'surfloft', 'fill'].includes(f.type) && !sk) fail('Skizze fehlt');
    const tool = f.type === 'surfextrude' ? surfExtrudeTool(sk, f) : f.type === 'surfrevolve' ? surfRevolveTool(sk, f, ctx.features) : f.type === 'patch' ? patchTool(sk, f)
      : f.type === 'surfloft' ? surfLoftTool(f, sketches) : f.type === 'fill' ? fillTool(f, bodies) : offsetSurfTool(f, bodies);
    tools[f.id] = { tool: tool.clone(), op: 'new' };
    bodies.push({ id: f.id, name: '', shape: tool });
    return;
  }
  if (f.type === 'stitch') {
    stitchBodies(f, bodies);
    return;
  }
  if (f.type === 'surftrim') {
    trimSurface(f, bodies, ctx);
    return;
  }
  if (f.type === 'surfextend') {
    extendSurface(f, bodies);
    return;
  }
  if (SOLID_SOURCES.includes(f.type)) {
    let tool;
    let faceInfo = null;
    if (f.type === 'extrude' && f.source === 'faces') {
      faceInfo = faceExtrudeTool(f, bodies);
      tool = faceInfo.tool;
      ctx.faceExtrude[f.id] = faceInfo.info; // where the faces were (for the manipulator)
    } else if (f.type === 'thicken') {
      tool = thickenTool(f, bodies);
    } else if (f.type === 'emboss') {
      const sk = sketches[f.sketch];
      if (!sk) fail('Skizze fehlt');
      tool = embossTool(sk, f, bodies);
    } else if (f.type === 'extrude' || f.type === 'revolve' || f.type === 'hole') {
      const sk = sketches[f.sketch];
      if (!sk) fail('Skizze fehlt');
      tool = f.type === 'extrude' ? extrudeTool(sk, f) : f.type === 'revolve' ? revolveTool(sk, f, ctx.features) : holeTool(sk, f);
      // tapped holes carry their thread (drawn as a cosmetic thread, named in drawings): it starts below a
      // counterbore / countersink and runs as deep as given, or down the whole hole
      const tap = f.type === 'hole' && tappedHole(f);
      if (tap) {
        const bs = basis(sk), n = bs.n.toArray(), d = n.map(v => -v);
        const skip = f.kind === 'cbore' ? +f.cbDepth || 0 : f.kind === 'csink' ? Math.max(0, ((+f.csDia || 0) - tap.core) / 2 / Math.tan((((+f.csAngle || 90) / 2) * Math.PI) / 180)) : 0;
        for (const c of sk.entities.filter(e => e.type === 'circle' && (!Array.isArray(f.points) || f.points.includes(e.id)))) {
          const o = toWorld(bs, c.cx, c.cy).toArray(), start = o.map((v, i) => v + d[i] * skip);
          // how far the material goes below the start (through holes): the far side of the bodies' boxes
          let far = 0;
          for (const bd of bodies) { try { const [lo, hi] = bd.shape.boundingBox.bounds; for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) far = Math.max(far, (x - start[0]) * d[0] + (y - start[1]) * d[1] + (z - start[2]) * d[2]); } catch { /* no box */ } }
          const full = f.through ? far : Math.max(0, (+f.depth || 0) - skip);
          const L = +f.threadDepth > 0 ? Math.min(+f.threadDepth, full || +f.threadDepth) : full;
          if (L > 1e-6) ctx.threads.push({ id: f.id, name: `${tap.name}×${tap.P}`, c: start, d, r: tap.core / 2, L, P: tap.P, outside: false });
        }
      }
    } else if (f.type === 'loft') tool = loftTool(f, sketches);
    else if (f.type === 'freeform') tool = freeformTool(f);
    else if (f.type === 'sheet') {
      const sk = sketches[f.sketch];
      if (!sk) fail('Skizze fehlt');
      const { poly, z0 } = sheetBase(sk);
      tool = sheetSolid(R, poly, z0, f);
    }
    else if (f.type === 'sweep') tool = sweepTool(f, sketches);
    else if (f.type === 'pipe') tool = pipeTool(f, sketches);
    else if (f.type === 'coil') tool = coilTool(f);
    else if (f.type === 'rib') tool = ribTool(f, sketches);
    else tool = primitiveTool(f);
    let op = f.type === 'hole' ? 'cut' : f.type === 'emboss' ? (f.mode === 'deboss' ? 'cut' : 'join') : f.op, target = f.target;
    // faces pulled outwards add material to their body, pushed inwards they cut ("Automatisch")
    if (faceInfo) {
      if (!op || op === 'auto') op = +f.distance < 0 && f.extent !== 'sym' ? 'cut' : 'join';
      if (!target) target = faceInfo.body;
    }
    // thicken joins / cuts the body whose faces were picked (does the same)
    if (f.type === 'thicken' && !target) target = bodiesWithPoints(bodies, f.faces || [])[0]?.b.id;
    tools[f.id] = { tool: tool.clone(), op, target };
    applyOp(bodies, tool, op, f.id, target);
    return;
  }
  if (f.type === 'fillet' || f.type === 'chamfer') {
    const v = f.type === 'fillet' ? +f.radius : +f.distance;
    if (!(v > 0)) fail('Größe fehlt');
    let n = 0;
    for (const b of bodies) {
      if (f.all) { b.shape = f.type === 'fillet' ? b.shape.fillet(v) : b.shape.chamfer(v); n++; continue; }
      const m = edgeMatcher(b.shape, f.edges || []);
      if (!m.count) continue;
      n += m.count;
      b.shape = f.type === 'fillet' ? b.shape.fillet(e => (m.fn(e) ? v : null)) : b.shape.chamfer(e => (m.fn(e) ? v : null));
    }
    if (!n) fail('Keine Kanten gewählt (oder nicht mehr gefunden)');
    return;
  }
  if (f.type === 'shell') {
    if (!(f.thickness > 0)) fail('Wandstärke fehlt');
    const hits = bodiesWithPoints(bodies, f.faces || []);
    if (!hits.length) fail('Mindestens eine offene Fläche wählen');
    for (const { b, own } of hits) b.shape = b.shape.shell(+f.thickness, faceFilter(own));
    return;
  }
  if (f.type === 'draft') {
    if (!+f.angle) fail('Winkel fehlt');
    const hits = bodiesWithPoints(bodies, f.faces || []);
    if (!hits.length) fail('Flächen wählen, die geneigt werden sollen');
    const neutral = new R.Plane([0, 0, +f.z || 0], [1, 0, 0], [0, 0, 1]);
    for (const { b, own } of hits) b.shape = b.shape.draft(+f.angle, faceFilter(own), neutral);
    return;
  }
  if (f.type === 'split') {
    const b = bodies.find(x => x.id === f.body) || bodies[bodies.length - 1];
    if (!b) fail('Kein Körper');
    const pos = b.shape.clone().cutPlane(f.plane || 'XY', +f.offset || 0, 'positive');
    const neg = b.shape.clone().cutPlane(f.plane || 'XY', +f.offset || 0, 'negative');
    if (!pos || !neg) fail('Die Ebene schneidet den Körper nicht');
    b.shape = pos;
    bodies.splice(bodies.indexOf(b) + 1, 0, { id: f.id, name: '', shape: neg });
    return;
  }
  if ((f.type === 'pattern' || f.type === 'mirror') && f.source === 'body') {
    const b = bodies.find(x => x.id === f.body);
    if (!b) fail('Körper wählen');
    const off = +f.offset || 0;
    const copies = f.type === 'pattern'
      ? patternTools(b.shape, f, ctx.features)
      : [b.shape.clone().mirror(f.plane || 'YZ', { XY: [0, 0, off], XZ: [0, off, 0], YZ: [off, 0, 0] }[f.plane || 'YZ'])];
    copies.forEach((c, i) => { if (f.joinBodies) b.shape = b.shape.fuse(c); else bodies.push({ id: `${f.id}_${i}`, name: '', shape: c }); });
    return;
  }
  if (f.type === 'pattern' || f.type === 'mirror') {
    const src = tools[f.target];
    if (!src) fail('Ziel-Feature fehlt oder erzeugt keinen Körper');
    const copies = f.type === 'pattern'
      ? patternTools(src.tool, f, ctx.features)
      : [src.tool.clone().mirror(f.plane || 'YZ', { XY: [0, 0, +f.offset || 0], XZ: [0, +f.offset || 0, 0], YZ: [+f.offset || 0, 0, 0] }[f.plane || 'YZ'])];
    copies.forEach((t, i) => applyOp(bodies, t, src.op, `${f.id}_${i}`, src.target));
    return;
  }
  if (f.type === 'thread') { applyThread(f, ctx); return; }
  if (f.type === 'scale') {
    const b = bodies.find(x => x.id === f.body) || bodies[bodies.length - 1];
    if (!b) fail('Kein Körper');
    const k = +f.factor;
    if (!(k > 0)) fail('Faktor muss größer 0 sein');
    let c = [+f.cx || 0, +f.cy || 0, +f.cz || 0];
    if (f.center === 'body') { const [lo, hi] = b.shape.boundingBox.bounds; c = lo.map((v, i) => (v + hi[i]) / 2); }
    const s = (f.copy ? b.shape.clone() : b.shape).scale(k, c);
    if (f.copy) bodies.push({ id: f.id, name: `Körper${bodies.length + 1}`, shape: s });
    else b.shape = s;
    return;
  }
  if (f.type === 'move') {
    const b = bodies.find(x => x.id === f.body) || bodies[bodies.length - 1];
    if (!b) fail('Kein Körper');
    let s = (f.copy ? b.shape.clone() : b.shape).translate(+f.dx || 0, +f.dy || 0, +f.dz || 0);
    if (+f.rz) s = s.rotate(+f.rz, [+f.cx || 0, +f.cy || 0, 0], [0, 0, 1]);
    if (f.copy) bodies.push({ id: f.id, name: `Körper${bodies.length + 1}`, shape: s });
    else b.shape = s;
    return;
  }
  if (f.type === 'combine') {
    const t = bodies.find(x => x.id === f.body), tl = bodies.find(x => x.id === f.tool);
    if (!t || !tl || t === tl) fail('Zielkörper und Werkzeugkörper wählen');
    t.shape = f.op === 'cut' ? t.shape.cut(tl.shape.clone()) : f.op === 'intersect' ? t.shape.intersect(tl.shape.clone()) : t.shape.fuse(tl.shape.clone());
    if (!f.keep) bodies.splice(bodies.indexOf(tl), 1);
  }
}

export function meshBody(shape, K = activeKernel()) {
  const m = K.mesh(shape);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(m.vertices, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(m.normals, 3));
  g.setIndex(Array.isArray(m.triangles) ? m.triangles : new THREE.BufferAttribute(m.triangles, 1));
  const faceOf = new Int32Array(m.triangles.length / 3);
  m.faceGroups.forEach((fg, i) => faceOf.fill(i, fg.start / 3, (fg.start + fg.count) / 3));
  const segPts = [], segEdge = [];
  m.edgeGroups.forEach((eg, gi) => {
    for (let k = eg.start; k + 1 < eg.start + eg.count; k++) {
      for (const q of [k, k + 1]) segPts.push(m.lines[q * 3], m.lines[q * 3 + 1], m.lines[q * 3 + 2]);
      segEdge.push(gi);
    }
  });
  const eg = new THREE.BufferGeometry();
  eg.setAttribute('position', new THREE.Float32BufferAttribute(segPts, 3));
  return { geometry: g, edges: eg, faceOf, segEdge };
}

// upTo: number of features to replay (rollback); null = all.
// ---------- timeline cache (only the edited feature and what follows is recomputed) ----------
// After every feature a snapshot of the bodies, feature tools, threads and results is kept, keyed by the
// timeline up to that feature (and the kernel). Snapshots hold copies; restoring copies them again, because
// many kernel operations consume their input shapes.
const SNAP_MAX = 400;
const snapCache = new Map(); // key → snapshot (Map keeps insertion order: oldest first)
let cacheStats = { hits: 0, skipped: 0, ran: 0 };
export const timelineCacheStats = () => ({ ...cacheStats, entries: snapCache.size });
export function clearTimelineCache() {
  for (const s of snapCache.values()) dropSnap(s);
  snapCache.clear();
}
const copyShape = sh => { try { return sh.clone(); } catch { return null; } };
const dropShape = sh => { try { sh?.delete?.(); } catch { /* already gone */ } };
function dropSnap(s) {
  for (const b of s.bodies) dropShape(b.shape);
  for (const t of Object.values(s.tools)) dropShape(t.tool);
}
// derived values a feature writes back (followed cylinder axes, sketch planes on construction planes)
const PATCH_KEYS = ['pts', 'r', 'plane'];
function takeSnap(ctx, errors, patches) {
  return {
    bodies: ctx.bodies.map(b => ({ id: b.id, name: b.name, shape: copyShape(b.shape) })),
    tools: Object.fromEntries(Object.entries(ctx.tools).map(([k, t]) => [k, { ...t, tool: copyShape(t.tool) }])),
    threads: JSON.parse(JSON.stringify(ctx.threads)),
    faceExtrude: JSON.parse(JSON.stringify(ctx.faceExtrude || {})),
    errors: { ...errors },
    patches: JSON.parse(JSON.stringify(patches)),
  };
}
// A feature's key is taken before regeneration changes it (derived values are written into the features).
// Name and visibility do not change the geometry: renaming or hiding recomputes nothing.
export function featureKey(f) {
  if (!Object.prototype.hasOwnProperty.call(f, '__key0')) {
    const k = JSON.stringify(f, function (key, v) { return this === f && (key === 'name' || key === 'hidden') ? undefined : v; });
    Object.defineProperty(f, '__key0', { value: k, enumerable: false });
  }
  return f.__key0;
}

// measured time per timeline prefix (ms), to estimate whether a recomputation will take long
const featTime = new Map(Object.entries({ emboss: 2500, thread: 800, shell: 400, loft: 400, sweep: 400, pipe: 300, coil: 600, fillet: 200, chamfer: 150, draft: 300, import: 400 }).map(([k, v]) => ['type:' + k, v]));
const DEFAULT_MS = 60;

// Same as regenerate, but only estimates the time it would take (cached prefixes cost nothing).
export function estimateRegen(project, upTo = null) {
  const K = activeKernel();
  const list = upTo == null ? project.features : project.features.slice(0, upTo);
  const keys = [];
  let key = K.id;
  for (const f of list) { key += '' + featureKey(f); keys.push(key); }
  let start = 0;
  for (let i = list.length - 1; i >= 0; i--) if (snapCache.has(keys[i])) { start = i + 1; break; }
  let ms = 0;
  for (let i = start; i < list.length; i++) {
    const f = list[i];
    if (f.suppressed || ['sketch', 'plane', 'axis', 'point', 'meshimport', 'meshop', 'canvas', 'decal'].includes(f.type)) continue;
    ms += featTime.get(keys[i]) ?? featTime.get('type:' + f.type) ?? DEFAULT_MS;
  }
  return { ms, start, total: list.length };
}

// Synchronous recomputation (as before).
export function regenerate(project, upTo = null) {
  const g = regenSteps(project, upTo);
  let r = g.next();
  while (!r.done) r = g.next();
  return r.value;
}

// Recomputation feature by feature: pauses between features so the window can draw and react.
// onStep({ i, n, name }) reports progress; cancelled() → true stops (finished features stay cached).
export async function regenerateAsync(project, upTo = null, { onStep, cancelled } = {}) {
  const g = regenSteps(project, upTo);
  let r = g.next();
  while (!r.done) {
    if (cancelled?.()) { g.return(); return null; }
    onStep?.(r.value);
    await paintPause();
    if (cancelled?.()) { g.return(); return null; }
    r = g.next();
  }
  return r.value;
}
// let the browser paint once (requestAnimationFrame does not run in hidden windows: timeout as fallback)
const paintPause = () => new Promise(res => {
  let done = false;
  const go = () => { if (!done) { done = true; setTimeout(res, 0); } };
  try { requestAnimationFrame(go); } catch { /* no window */ }
  setTimeout(go, 40);
});

function* regenSteps(project, upTo = null) {
  const K = activeKernel();
  const ctx = { bodies: [], sketches: {}, tools: {}, threads: [], faceExtrude: {}, features: project.features };
  let errors = {};
  let patches = {};
  const list = upTo == null ? project.features : project.features.slice(0, upTo);
  // keys of every timeline prefix
  const keys = [];
  let key = K.id;
  for (const f of list) { key += '' + featureKey(f); keys.push(key); }
  // resume after the last cached prefix
  let start = 0;
  for (let i = list.length - 1; i >= 0; i--) {
    const snap = snapCache.get(keys[i]);
    if (!snap || snap.bodies.some(b => !b.shape) || Object.values(snap.tools).some(t => !t.tool)) continue;
    snapCache.delete(keys[i]); snapCache.set(keys[i], snap); // most recently used
    try {
      ctx.bodies = snap.bodies.map(b => ({ ...b, shape: b.shape.clone() }));
      ctx.tools = Object.fromEntries(Object.entries(snap.tools).map(([k, t]) => [k, { ...t, tool: t.tool.clone() }]));
    } catch {
      // snapshot no longer usable (e.g. the Rust kernel restarted): recompute everything
      clearTimelineCache();
      ctx.bodies = [];
      ctx.tools = {};
      break;
    }
    ctx.threads = JSON.parse(JSON.stringify(snap.threads));
    ctx.faceExtrude = JSON.parse(JSON.stringify(snap.faceExtrude));
    errors = { ...snap.errors };
    patches = JSON.parse(JSON.stringify(snap.patches));
    start = i + 1;
    cacheStats.hits++;
    break;
  }
  cacheStats.skipped += start;
  // features before the resume point: sketches are needed by later features, derived values are re-applied
  for (let i = 0; i < start; i++) {
    const f = list[i];
    if (patches[f.id]) Object.assign(f, patches[f.id]);
    if (f.type === 'sketch' && !f.suppressed) ctx.sketches[f.id] = f;
  }
  for (let i = start; i < list.length; i++) {
    const f = list[i];
    run: {
      if (f.suppressed) break run;
      if (f.type === 'sketch') {
        // a sketch on a construction plane follows it (the plane may depend on a cylinder updated just before)
        if (f.planeRef) { const pl = planeRef(f.planeRef, project.features); if (pl) f.plane = pl; }
        ctx.sketches[f.id] = f;
        break run;
      }
      if ((f.type === 'axis' && f.kind === 'cyl') || (f.type === 'plane' && f.kind === 'tangent')) { followCylinder(f, ctx.bodies); break run; }
      if (f.type === 'plane' || f.type === 'axis' || f.type === 'point' || f.type === 'meshimport' || f.type === 'meshop' || f.type === 'canvas' || f.type === 'decal') break run; // construction geometry / meshes (handled in main.js)
      const ok = K.supports(f);
      if (ok !== true) { errors[f.id] = ok; break run; }
      yield { i, n: list.length, name: f.name || FEATURE_TYPES[f.type] || f.type, type: f.type };
      cacheStats.ran++;
      const t0 = performance.now();
      try {
        K.runFeature(f, ctx);
      } catch (err) {
        errors[f.id] = typeof err === 'string' ? err : err.message || String(err);
      }
      const dt = performance.now() - t0;
      featTime.set(keys[i], dt);
      featTime.set('type:' + f.type, Math.max(dt, (featTime.get('type:' + f.type) || 0) * 0.5));
    }
    // remember derived values of this feature, then snapshot
    const pv = {};
    for (const k of PATCH_KEYS) if (f[k] !== undefined && (k !== 'plane' || f.planeRef)) pv[k] = f[k];
    if (Object.keys(pv).length && (f.planeRef || f.kind === 'cyl' || f.kind === 'tangent' || f.type === 'emboss')) patches[f.id] = JSON.parse(JSON.stringify(pv));
    if (!snapCache.has(keys[i])) {
      snapCache.set(keys[i], takeSnap(ctx, errors, patches));
      while (snapCache.size > SNAP_MAX) { const [k0, s0] = snapCache.entries().next().value; snapCache.delete(k0); dropSnap(s0); }
    }
  }
  const bodies = [];
  if (ctx.bodies.length) yield { i: list.length, n: list.length, name: 'Darstellung', type: 'mesh' };
  for (const [i, b] of ctx.bodies.entries()) {
    try {
      bodies.push({ id: b.id, name: `Körper${i + 1}`, shape: b.shape, surface: !hasSolid(b.shape), ...meshBody(b.shape, K) });
    } catch (err) {
      errors[b.id] = 'Vernetzung fehlgeschlagen: ' + (err.message || err);
    }
  }
  return { bodies, errors, threads: ctx.threads, faceExtrude: ctx.faceExtrude || {}, kernel: K.id, resumedAt: start, featureCount: list.length };
}

export function edgeMidpoint(body, edgeIndex) {
  const p = body.shape.edges[edgeIndex].pointAt(0.5);
  return [+p.x.toFixed(5), +p.y.toFixed(5), +p.z.toFixed(5)];
}

export function edgeRefMatches(body, edgeIndex, refs) {
  const p = body.shape.edges[edgeIndex].pointAt(0.5);
  return refs.findIndex(r => near(p, r, 1e-3));
}

// the kernel that built a shape (OpenCascade shapes carry `wrapped`)
const kernelOf = shape => (shape && !shape.wrapped && shape.kernel ? getKernel(shape.kernel) : occKernel);

// Overlapping volume of every pair of bodies.
export function interference(bodies) {
  const out = [];
  for (let i = 0; i < bodies.length; i++) {
    for (let j = i + 1; j < bodies.length; j++) {
      try {
        const v = kernelOf(bodies[i].shape).intersectVolume(bodies[i].shape, bodies[j].shape);
        if (v > 1e-4) out.push({ a: bodies[i], b: bodies[j], volume: v });
      } catch { /* no overlap or kernel failure */ }
    }
  }
  return out;
}

export function bodyProps(body) {
  return kernelOf(body.shape).props(body.shape);
}

export function exportSTEP(bodies) {
  if (!bodies.length) return new Blob([''], { type: 'application/step' });
  return kernelOf(bodies[0].shape).exportSTEP(bodies.map(b => ({ shape: b.shape, name: b.name })));
}

// ---------- OpenCascade (über replicad) als Kern der Schnittstelle (kern/index.js) ----------
const occKernel = {
  id: 'occ',
  name: 'OpenCascade',
  info: 'Bewährter B-rep-Kern (C++, über replicad): alle Konstruktionsfunktionen.',
  native: true,
  get ready() { return !!R; },
  async load() { const { loadKernel } = await import('./kernel.js'); await loadKernel(); },
  supports: () => true,
  runFeature,
  mesh(shape) {
    const m = shape.mesh({ tolerance: 0.02, angularTolerance: 0.2 });
    const em = shape.meshEdges({ tolerance: 0.02, angularTolerance: 0.2 });
    return { vertices: m.vertices, normals: m.normals, triangles: m.triangles, faceGroups: m.faceGroups, lines: em.lines, edgeGroups: em.edgeGroups };
  },
  props(shape) {
    const v = R.measureShapeVolumeProperties(shape);
    return { volume: v.volume, com: v.centerOfMass, area: R.measureArea(shape) };
  },
  intersectVolume(a, b) {
    const x = a.clone().intersect(b.clone());
    return x && !x.isNull ? R.measureVolume(x) : 0;
  },
  exportSTEP: list => R.exportSTEP(list),
};
registerKernel(occKernel);

// ---------- sketch visuals ----------
const lineMats = {};
const lineMat = (color, onTop) => {
  const k = color + (onTop ? 't' : '');
  return (lineMats[k] ||= new THREE.LineBasicMaterial({ color, depthTest: !onTop, transparent: onTop }));
};
const consMats = {};
const consMat = (color, onTop) => (consMats[color + (onTop ? 't' : '')] ||= new THREE.LineDashedMaterial({ color, dashSize: 2, gapSize: 1.4, depthTest: !onTop, transparent: onTop }));
const fillMat = new THREE.MeshBasicMaterial({ color: 0xffc766, transparent: true, opacity: 0.28, side: THREE.DoubleSide, depthWrite: false });

export function sketchVisual(sketch, { active = false, selectedId = null, dark = false, constrained = false, fill = true } = {}) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.matrix.copy(planeMatrix(sketch));
  const z = 0.02;
  for (const e of sketch.entities) {
    for (const o of entityOutlines(e)) {
      if (o.pts.length < 2) continue;
      const pts = o.pts.map(p => new THREE.Vector3(p[0], p[1], z));
      if (o.closed) pts.push(pts[0].clone());
      //: under-defined geometry is blue, fully defined is black/white
      const base = active ? (constrained ? (dark ? 0xe6edf3 : 0x1d2733) : dark ? 0x5aaaf0 : 0x1f6fd1) : o.closed ? (dark ? 0xe0b25a : 0x7a5a1e) : dark ? 0x9aa7b4 : 0x8a96a3;
      const col = e.id === selectedId ? 0x0696d7 : e.cons ? (dark ? 0xff9a3c : 0xe07000) : base;
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), e.cons ? consMat(col, active) : lineMat(col, active));
      if (e.cons) line.computeLineDistances();
      line.renderOrder = 5;
      g.add(line);
    }
  }
  if (active && fill) {
    const { regions } = buildRegions(profileItems(sketch));
    if (regions.length) {
      const v2 = p => new THREE.Vector2(p[0], p[1]);
      const shapes = regions.map(r => {
        const s = new THREE.Shape(r.outer.map(v2));
        for (const h of r.holes) s.holes.push(new THREE.Path(h.map(v2)));
        return s;
      });
      const mesh = new THREE.Mesh(new THREE.ShapeGeometry(shapes), fillMat);
      mesh.renderOrder = 4;
      g.add(mesh);
    }
  }
  return g;
}
