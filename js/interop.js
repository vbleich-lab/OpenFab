// Data exchange: STEP/IGES geometry, tool libraries (Fusion 360 / HSM, CSV) and
// Fusion .cps post-processors (converted into an editable WerkFab template).
import { R } from './kernel.js';
import { BUILTIN_POSTS, copyPost } from './post.js';
import { collapseNeedles, findCylinders, findRound, standIn, arcOnTorus } from './mesh.js';

// ---------- imported files (kept in IndexedDB, too big for localStorage) ----------
const mem = new Map();
const DB = 'openfab.blobs', STORE = 'blobs';
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

async function hashText(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'b' + [...new Uint8Array(d)].slice(0, 12).map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function putBlob(text) {
  const key = await hashText(text);
  mem.set(key, text);
  try {
    const db = await idb();
    await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(text, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (err) { console.warn('IndexedDB nicht verfügbar – Import nur bis zum Neuladen gespeichert', err); }
  return key;
}

export const getBlob = key => mem.get(key);

// Loads the stored files a project refers to (call before the first rebuild).
export async function loadBlobs(project) {
  const keys = blobKeys(project).filter(k => !mem.has(k));
  if (!keys.length) return;
  try {
    const db = await idb();
    await Promise.all(keys.map(k => new Promise(res => {
      const r = db.transaction(STORE).objectStore(STORE).get(k);
      r.onsuccess = () => { if (r.result) mem.set(k, r.result); res(); };
      r.onerror = () => res();
    })));
  } catch { /* no IndexedDB */ }
}

const blobKeys = project => (project.features || []).filter(f => ['import', 'meshimport', 'canvas', 'decal'].includes(f.type) && f.blob).map(f => f.blob);

// .ofab files carry the imported files inline so they open anywhere.
export function withBlobs(project) {
  const blobs = {};
  for (const k of blobKeys(project)) if (mem.has(k)) blobs[k] = mem.get(k);
  return { ...project, blobs };
}
export async function takeBlobs(p) {
  for (const text of Object.values(p.blobs || {})) await putBlob(text);
  delete p.blobs;
  return p;
}

// A closed triangle mesh as a solid (STEP text): every triangle a face, sewn; faces in one plane are merged where
// the kernel can. The result goes into the model like an imported STEP file.
// cyls (from findCylinders of mesh.js): round holes and pins of the mesh become true cylinders – a hole is cut
// again with a cylinder through its corner points, a pin gets the slivers between its facets and the circle.
// Parts of a ring (fillets, half cylinders, coves) get a band along their arc: fused where the material is
// inside, cut where it is outside.
// Returns { text, cylinders: how many were made round, arcs: how many of them are parts of a ring }.
// One face per flat region of the mesh – its outline and its holes – instead of one per triangle: the kernel gets
// a few large faces (a cap of hundreds of triangles is one face), every later step is faster and nothing has to
// be merged afterwards. A region that cannot be made into one face stays as triangles.
const meshVolume = m => { let v = 0; const P = m.pos, I = m.idx; for (let t = 0; t < I.length; t += 3) { const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3; v += P[a] * (P[b + 1] * P[c + 2] - P[b + 2] * P[c + 1]) - P[a + 1] * (P[b] * P[c + 2] - P[b + 2] * P[c]) + P[a + 2] * (P[b] * P[c + 1] - P[b + 1] * P[c]); } return v / 6; };
function regionFaces(m) {
  const info = {};
  findCylinders(m, 8, info);
  const reg = info.reg, I = m.idx, P = m.pos, nT = I.length / 3, nV = P.length / 3;
  const V = v => [P[v * 3], P[v * 3 + 1], P[v * 3 + 2]];
  const byReg = new Map();
  for (let t = 0; t < nT; t++) { const l = byReg.get(reg[t]); if (l) l.push(t); else byReg.set(reg[t], [t]); }
  const faces = [];
  let merged = 0;
  const tri = t => { try { faces.push(R.makePolygon([V(I[t * 3]), V(I[t * 3 + 1]), V(I[t * 3 + 2])])); } catch { /* degenerate triangle */ } };
  for (const ts of byReg.values()) {
    if (ts.length === 1) { tri(ts[0]); continue; }
    try {
      // the outline: the sides of the triangles whose other side is not in the region
      const dir = new Set(), n = [0, 0, 0];
      for (const t of ts) {
        for (let k = 0; k < 3; k++) dir.add(I[t * 3 + k] * nV + I[t * 3 + (k + 1) % 3]);
        const a = V(I[t * 3]), b = V(I[t * 3 + 1]), c = V(I[t * 3 + 2]), u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], w = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
        n[0] += u[1] * w[2] - u[2] * w[1]; n[1] += u[2] * w[0] - u[0] * w[2]; n[2] += u[0] * w[1] - u[1] * w[0];
      }
      const nl = Math.hypot(...n);
      if (!(nl > 1e-12)) throw 0;
      n[0] /= nl; n[1] /= nl; n[2] /= nl;
      const next = new Map();
      for (const e of dir) {
        const a = Math.floor(e / nV), b = e % nV;
        if (dir.has(b * nV + a)) continue;
        if (next.has(a)) throw 0; // the region touches itself in a corner
        next.set(a, b);
      }
      const loops = [];
      while (next.size) {
        const start = next.keys().next().value, loop = [];
        let v = start;
        do { loop.push(v); const w = next.get(v); next.delete(v); v = w; } while (v !== start && v !== undefined);
        if (v === undefined || loop.length < 3) throw 0;
        loops.push(loop);
      }
      const p0 = V(loops[0][0]);
      for (const l of loops) for (const v of l) { const p = V(v); if (Math.abs((p[0] - p0[0]) * n[0] + (p[1] - p0[1]) * n[1] + (p[2] - p0[2]) * n[2]) > 1e-3) throw 0; }
      // the largest loop is the outline, the others are holes
      const area = l => { const s = [0, 0, 0]; for (let i = 0; i < l.length; i++) { const a = V(l[i]), b = V(l[(i + 1) % l.length]); s[0] += a[1] * b[2] - a[2] * b[1]; s[1] += a[2] * b[0] - a[0] * b[2]; s[2] += a[0] * b[1] - a[1] * b[0]; } return (s[0] * n[0] + s[1] * n[1] + s[2] * n[2]) / 2; };
      const ar = loops.map(area), io = ar.indexOf(Math.max(...ar));
      if (!(ar[io] > 0) || ar.some((x, i) => i !== io && x > 0)) throw 0;
      const wire = l => R.assembleWire(l.map((v, i) => R.makeLine(V(v), V(l[(i + 1) % l.length]))));
      faces.push(R.makeFace(wire(loops[io]), loops.filter((_, i) => i !== io).map(wire)));
      merged++;
    } catch { ts.forEach(tri); }
  }
  return { faces, merged };
}

// round = { cones, spheres } (from findRound): countersinks, tapers and cone tips become true cones (a ring turned
// around the axis), balls, domes and rounded corners true spheres – where the whole sphere fits the part; round.tori:
// fillets round a round edge become true tori (a thin shell of the tube, turned around the axis).
export async function meshToStep(m0, cyls = [], round = {}, noStand = null, noTori = false) {
  const cyls0 = cyls, round0 = round;
  // (needles would leave gaps in the solid: every later cut would silently do nothing)
  const mc = collapseNeedles(m0);
  // tori and the caps of spheres: their many facets give way to a few large ones first (their triangles are
  // counted in the mesh they were found in)
  const rnd = mc === m0 ? round : (() => { try { const r = findRound(mc); return { ...round, tori: r.tori, spheres: r.spheres }; } catch { return { ...round, tori: [], spheres: (round.spheres || []).map(s => ({ ...s, ti: null })) }; } })();
  round = noTori ? { ...rnd, tori: [] } : rnd;
  // a ring on its own (an O-ring) and nothing else: the torus itself
  {
    const t = (round.tori || []).find(x => x.whole && x.ti && x.ti.length === mc.idx.length / 3);
    if (t) {
      const o = t.c.map(x => Math.round(x * 1e5) / 1e5), ux = Math.abs(t.d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], dd = ux[0] * t.d[0] + ux[1] * t.d[1] + ux[2] * t.d[2];
      let u = [ux[0] - t.d[0] * dd, ux[1] - t.d[1] * dd, ux[2] - t.d[2] * dd];
      const ul = Math.hypot(...u); u = u.map(x => x / ul);
      const nrm = [u[1] * t.d[2] - u[2] * t.d[1], u[2] * t.d[0] - u[0] * t.d[2], u[0] * t.d[1] - u[1] * t.d[0]];
      const ring = R.drawCircle(Math.round(t.r * 1e4) / 1e4).translate(Math.round(t.R * 1e4) / 1e4, 0).sketchOnPlane(new R.Plane(o, u, nrm)).revolve(t.d, { origin: o, angle: 360 });
      return { text: await ring.blobSTEP().text(), cylinders: 0, arcs: 0, cones: 0, spheres: 0, tori: 1 };
    }
  }
  const skipKeys = noStand || new Set(), keyOf = new Map();
  (round.tori || []).forEach((t, i) => keyOf.set(t, 't' + i)); (round.spheres || []).forEach((s, i) => keyOf.set(s, 's' + i));
  let stand = { m: mc, tori: [], spheres: [] };
  try { stand = standIn(mc, (round.tori || []).filter(t => !skipKeys.has(keyOf.get(t))), (round.spheres || []).filter(s => !skipKeys.has(keyOf.get(s)))); } catch { /* facet by facet */ }
  const m = stand.m, stood = new Map([...stand.tori, ...stand.spheres].map(x => [x.src, x])), standOk = new Set();
  // (without the facets of a fillet next to it a cylinder shows whole)
  // (and the rows of facets of a torus that stays faceted are no pieces of cylinders)
  if (stood.size) { try { cyls = findCylinders(m).filter(c => !arcOnTorus(c, round.tori || [])); } catch { /* as they were found */ } }
  const triFaces = () => { const faces = [], P = m.pos; for (let t = 0; t < m.idx.length; t += 3) {
    const [a, b, c] = [m.idx[t], m.idx[t + 1], m.idx[t + 2]].map(i => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
    try { faces.push(R.makePolygon([a, b, c])); } catch { /* degenerate triangle */ }
  } return faces; };
  if (m.idx.length < 12) throw new Error('Zu wenige Dreiecke für einen Körper');
  // flat regions as whole faces; if that does not close (or changes the volume), triangle by triangle as before
  let solid = null;
  try {
    const rf = regionFaces(m);
    if (rf.merged && rf.faces.length >= 4) { const s1 = R.makeSolid(rf.faces), v1 = R.measureVolume(s1), vm = meshVolume(m); if (Number.isFinite(v1) && Math.abs(Math.abs(v1) - Math.abs(vm)) <= 1e-4 * Math.abs(vm) + 1e-6) solid = s1; }
  } catch { /* triangle by triangle */ }
  if (!solid) { const faces = triFaces(); if (faces.length < 4) throw new Error('Zu wenige Dreiecke für einen Körper'); solid = R.makeSolid(faces); }
  try { const s = solid.simplify?.(), v = R.measureVolume(solid); if (s && Math.abs(R.measureVolume(s) - v) <= 1e-6 * Math.abs(v) + 1e-9) solid = s; } catch { /* stays faceted */ }
  const base = solid;
  let made = 0, arcs = 0, cones = 0, spheres = 0, tori = 0;
  const vol = s => { try { return R.measureVolume(s); } catch { return NaN; } };
  // tidying up must not change the body (a ring all on its own comes out of it empty)
  const simp = s => { try { const q = s.simplify?.(), v = vol(s); if (q && Math.abs(vol(q) - v) <= 1e-6 * Math.abs(v) + 1e-9) return q; } catch { /* as it is */ } return s; };
  // First every round face once, quickly: its tool 0.1 µm larger than fitted, one boolean, one look at the volume.
  // What does not pass that way is then tried at leisure as below (other sizes, tidied up in between).
  let collect = null;
  const done = new Set();
  const one = x => (x && x.solids && x.solids.length === 1 ? x.solids[0] : x);
  const collector = () => ({ items: [], add(tool, sliver, hole, slack, kind, src) { this.items.push({ tool, sliver, hole, slack, kind, src }); } });
  // where a straight fillet ends at a corner that stands in for a torus, the flat end of its tool would lie in
  // the face between the two, slivers apart: there the tool reaches a little into the corner
  // (does this piece of a cylinder end where the tube of this part of a torus ends, with the same radius?)
  const meets = (c, t, z) => !!t.sweep && Math.abs(c.r - t.r) <= 2e-3 && [t.a0, t.a0 + t.sweep].some(ang => Math.hypot(...[0, 1, 2].map(i => c.c[i] + c.d[i] * z - t.c[i] - t.R * (t.u[i] * Math.cos(ang) + t.w[i] * Math.sin(ang)))) < 0.02);
  // (where the torus is there already, only a hair: it bends away from the straight fillet)
  const endExt = (c, z) => {
    for (const [t, st] of stood) if (st.corner && meets(c, t, z)) return standOk.has(t) ? Math.max(5e-4, Math.sqrt(2e-7 * t.R)) : Math.min(0.02, 0.5 * Math.sqrt(2e-4 * t.R));
    return 0;
  };
  // (an arc is tried with its exact radius too – where it ends in a face across, that is the cleaner cut – and
  // the result with fewer faces is taken)
  const doCyl = c0 => { let best = null; for (const grow of c0.full === false ? [0, 1e-4, 1e-3] : [1e-4, 1e-3]) {
    if (best && (c0.full !== false || grow > 1e-4)) break;
    // the fitted values carry the noise of single-precision points, so they are rounded. A cylinder exactly
    // through the corner points leaves shreds of the facets behind (edges lying in its surface): it is made
    // 0.1 µm larger (1 µm at the second try), which the kernel cuts cleanly
    const c = { ...c0, r: Math.round(c0.r * 1e4) / 1e4 + grow, c: c0.c.map(x => Math.round(x * 1e5) / 1e5) };
    try {
      const v0 = vol(solid), sliver = c.full === false ? c.sl * c.h : Math.PI * c.r * c.r * c.h * (1 - Math.sin((2 * Math.PI) / c.n) / ((2 * Math.PI) / c.n));
      let tool;
      if (c.full === false) {
        // a band between the circle and a smaller one inside the chords, from the first to the last corner
        const e0 = endExt(c, 0), ri = c.r * Math.cos(Math.PI / c.n) * 0.9, at = (rr, a) => [rr * Math.cos(a), rr * Math.sin(a)], a1 = c.a0 + c.sweep, am = c.a0 + c.sweep / 2;
        const band = R.draw(at(c.r, c.a0)).threePointsArcTo(at(c.r, a1), at(c.r, am)).lineTo(at(ri, a1)).threePointsArcTo(at(ri, c.a0), at(ri, am)).close()
          .sketchOnPlane(new R.Plane(c.c.map((x, i) => x - c.d[i] * e0), c.u, c.d)).extrude(c.h + e0 + endExt(c, c.h));
        tool = band;
      } else if (c.hole) tool = R.makeCylinder(c.r, c.h, c.c, c.d);
      else {
        const inner = c.r * Math.cos(Math.PI / c.n) * 0.9;
        tool = R.makeCylinder(c.r, c.h, c.c, c.d).cut(R.makeCylinder(inner, c.h + 2, c.c.map((x, i) => x - c.d[i]), c.d));
      }
      if (collect) { if (grow !== 1e-4) continue; collect.add(tool, sliver, !!c.hole, 0.01 * c.r * c.h, c0.full === false ? 'arc' : 'cyl', c0); break; }
      let next = c.hole ? solid.cut(tool) : solid.fuse(tool);
      // only the slivers between the facets and the circle may change: anything else and the step is dropped
      const dv = vol(next) - v0;
      if (!Number.isFinite(dv) || Math.abs(Math.abs(dv) - sliver) > 0.05 * sliver + 0.01 * c.r * c.h + 1e-3 || (dv < 0) !== c.hole) continue;
      // (the next boolean works on clean faces only)
      next = simp(next);
      if (!best || next.faces.length < best.faces.length) best = next;
    } catch { /* stays faceted there */ }
  }
    if (best) { solid = best; made++; if (c0.full === false) arcs++; done.add(c0); }
  };
  // A part of a ring on the outside (the rounded edge of a plate with round corners), a sharp corner standing in:
  // first of all, while the straight fillets next to it are still facets – the tool reaches a little past both
  // ends, over those facets (it bends away from them by less than it is larger than the tube), so its flat ends
  // lie in no face of the body.
  for (const [t, st] of stood) {
    if (!st.corner || !t.sweep || t.inner) continue;
    const o = t.c.map(x => Math.round(x * 1e5) / 1e5), Rm = Math.round(t.R * 1e4) / 1e4, r = Math.round(t.r * 1e4) / 1e4;
    const da = Math.min(0.02, 0.5 * Math.sqrt(2e-4 * Rm)) / Rm, u = t.u.map((x, i) => x * Math.cos(t.a0 - da) + t.w[i] * Math.sin(t.a0 - da));
    const nrm = [u[1] * t.d[2] - u[2] * t.d[1], u[2] * t.d[0] - u[0] * t.d[2], u[0] * t.d[1] - u[1] * t.d[0]];
    const P = (rad, a) => [Rm + rad * Math.cos(a), rad * Math.sin(a)], sm = (t.s0 + t.s1) / 2, rb = r + 1.05 * st.dout + 2e-3;
    // (the cylinder the corner stands on comes first: its tool is as high as the corner)
    for (const c0 of cyls) {
      if (done.has(c0) || Math.abs(c0.r - (t.R + t.r)) > 2e-3 || Math.abs(c0.d[0] * t.d[0] + c0.d[1] * t.d[1] + c0.d[2] * t.d[2]) < 0.9999) continue;
      const v = [t.c[0] - c0.c[0], t.c[1] - c0.c[1], t.c[2] - c0.c[2]], k = v[0] * c0.d[0] + v[1] * c0.d[1] + v[2] * c0.d[2];
      if (Math.hypot(v[0] - c0.d[0] * k, v[1] - c0.d[1] * k, v[2] - c0.d[2] * k) < 0.02) doCyl(c0);
    }
    for (const grow of [1e-4, 0, 1e-3]) {
      try {
        const ra = r + (t.hole ? -grow : grow);
        const tool = R.draw(P(ra, t.s0)).lineTo(P(rb, t.s0)).threePointsArcTo(P(rb, t.s1), P(rb, sm)).lineTo(P(ra, t.s1)).threePointsArcTo(P(ra, t.s0), P(ra, sm)).close()
          .sketchOnPlane(new R.Plane(o, u, nrm)).revolve(t.d, { origin: o, angle: ((t.sweep + 2 * da) * 180) / Math.PI });
        const v0 = vol(solid), next = one(t.hole ? solid.fuse(tool) : solid.cut(tool)), dv = vol(next) - v0;
        if (!Number.isFinite(dv) || typeof next.fuse !== 'function' || Math.abs(Math.abs(dv) - st.vol) > 0.05 * st.vol + 0.002 * r * r + 1e-3 || (dv < 0) === !!t.hole) continue;
        solid = next; tori++; standOk.add(t); done.add(t);
        break;
      } catch { /* later, with the others */ }
    }
  }
  for (const pass of [0, 1]) {
  collect = pass ? null : collector();
  for (const c0 of cyls.slice(0, 80)) if (!done.has(c0)) doCyl(c0);
  // cones and spheres: the same way – only the volume between the facets and the true face may change
  const tryTools = (mk, sliver, hole, slack, kind, src) => {
    if (collect) { try { collect.add(mk(1e-4), sliver, !!hole, slack, kind, src); } catch { /* not this one */ } return false; }
    let best = null;
    for (const grow of [0, 1e-4, 1e-3]) {
      if (best && grow > 1e-4) break;
      try {
        const v0 = vol(solid), tool = mk(grow);
        let next = hole ? solid.cut(tool) : solid.fuse(tool);
        const dv = vol(next) - v0;
        if (!Number.isFinite(dv) || Math.abs(Math.abs(dv) - sliver) > 0.05 * sliver + slack + 1e-3 || (dv < 0) !== hole) continue;
        next = simp(next);
        if (!best || next.faces.length < best.faces.length) best = next;
        if (best.faces.length < solid.faces.length - 2) break;
      } catch { /* stays faceted there */ }
    }
    if (best) solid = best;
    if (best && stood.has(src)) standOk.add(src);
    return !!best;
  };
  for (const c of (round.cones || []).slice(0, 60)) {
    if (done.has(c)) continue;
    const h = c.t1 - c.t0, f = 1 - Math.sin((2 * Math.PI) / c.n) / ((2 * Math.PI) / c.n);
    const part = c.sweep ? c.sweep / (2 * Math.PI) : 1;
    // (a cone found between two rings of corners brings the volume its facets leave out)
    const sliver = c.vol != null ? c.vol : ((Math.PI * h) / 3) * (c.r0 * c.r0 + c.r0 * c.r1 + c.r1 * c.r1) * f * part;
    const o = c.apex.map((x, i) => Math.round((x + c.d[i] * c.t0) * 1e5) / 1e5);
    const ux = Math.abs(c.d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], dd = ux[0] * c.d[0] + ux[1] * c.d[1] + ux[2] * c.d[2];
    let u = [ux[0] - c.d[0] * dd, ux[1] - c.d[1] * dd, ux[2] - c.d[2] * dd];
    const ul = Math.hypot(...u); u = u.map(x => x / ul);
    // a part of a ring starts at its first corner
    if (c.sweep) u = c.u.map((x, i) => x * Math.cos(c.a0) + c.w[i] * Math.sin(c.a0));
    // plane through the axis: x = u, y = the axis (normal = u × d)
    const nrm = [u[1] * c.d[2] - u[2] * c.d[1], u[2] * c.d[0] - u[0] * c.d[2], u[0] * c.d[1] - u[1] * c.d[0]];
    const mk = grow => {
      const r0 = Math.round(c.r0 * 1e4) / 1e4 + (c.r0 > 1e-6 ? grow : 0), r1 = Math.round(c.r1 * 1e4) / 1e4 + grow, k = Math.cos(Math.PI / c.n) * 0.9;
      // a hole is cut with the whole cone, a pin gets a shell (what lies inside stays untouched)
      // (a part of a ring: only the sliver between the facets and the cone, for a hole too)
      const kh = Math.cos(Math.PI / c.n) * 0.98;
      const pts = c.sweep ? (c.hole ? [[r0 * kh, 0], [r0, 0], [r1, h], [r1 * kh, h]] : [[r0 * k, 0], [r0, 0], [r1, h], [r1 * k, h]]) : c.hole ? [[0, 0], [r0, 0], [r1, h], [0, h]] : [[r0 * k, 0], [r0, 0], [r1, h], [r1 * k, h]];
      const pp = pts.filter((p, i) => i === 0 || Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) > 1e-9);
      let d = R.draw(pp[0]);
      for (let i = 1; i < pp.length; i++) d = d.lineTo(pp[i]);
      return d.close().sketchOnPlane(new R.Plane(o, u, nrm)).revolve(c.d, { origin: o, angle: c.sweep ? (c.sweep * 180) / Math.PI : 360 });
    };
    if (tryTools(mk, sliver, c.hole, 0.01 * c.r1 * h, 'cone', c)) cones++;
  }
  for (const s of (round.spheres || []).slice(0, 60)) {
    if (done.has(s) || standOk.has(s)) continue;
    const c = s.c.map(x => Math.round(x * 1e5) / 1e5);
    if (stood.has(s)) {
      // a flat lid stands in for the cap: the true cap goes on it (or, for a hollow, is cut out of it)
      const st = stood.get(s), sax = st.ax, ux = Math.abs(sax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], dd = ux[0] * sax[0] + ux[1] * sax[1] + ux[2] * sax[2];
      let u = [ux[0] - sax[0] * dd, ux[1] - sax[1] * dd, ux[2] - sax[2] * dd];
      const ul = Math.hypot(...u); u = u.map(x => x / ul);
      const nrm = [u[1] * sax[2] - u[2] * sax[1], u[2] * sax[0] - u[0] * sax[2], u[0] * sax[1] - u[1] * sax[0]];
      const cap = grow => {
        const ro = Math.round(s.r * 1e4) / 1e4 + grow, h0 = Math.round(st.h0 * 1e5) / 1e5, rb = Math.sqrt(ro * ro - h0 * h0), am = Math.acos(h0 / ro) / 2;
        return R.draw([0, h0]).lineTo([rb, h0]).threePointsArcTo([0, ro], [ro * Math.sin(am), ro * Math.cos(am)]).close().sketchOnPlane(new R.Plane(c, u, nrm)).revolve(sax, { origin: c, angle: 360 });
      };
      tryTools(cap, st.vol, s.hole, 0.02 * st.vol + 0.002 * s.r * s.r, 'sphere', s) && spheres++;
      continue;
    }
    const full = grow => R.makeSphere(Math.round(s.r * 1e4) / 1e4 + grow).translate(c[0], c[1], c[2]);
    // where the whole sphere does not fit the part (a dome on a plate, the rounded corner of a pocket): only the
    // shell between the facets and the sphere, as far as the patch reaches
    const patch = !!s.ax && s.alpha > 0.02 && s.alpha <= 3.1 && s.rin > 0.5 * s.r;
    const shell = grow => {
      const ux = Math.abs(s.ax[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], dd = ux[0] * s.ax[0] + ux[1] * s.ax[1] + ux[2] * s.ax[2];
      let u = [ux[0] - s.ax[0] * dd, ux[1] - s.ax[1] * dd, ux[2] - s.ax[2] * dd];
      const ul = Math.hypot(...u); u = u.map(x => x / ul);
      const nrm = [u[1] * s.ax[2] - u[2] * s.ax[1], u[2] * s.ax[0] - u[0] * s.ax[2], u[0] * s.ax[1] - u[1] * s.ax[0]];
      const ro = Math.round(s.r * 1e4) / 1e4 + grow, ri = s.rin - Math.max(1e-3, 1e-4 * s.r), sa = Math.sin(s.alpha), ca = Math.cos(s.alpha), sh = Math.sin(s.alpha / 2), ch = Math.cos(s.alpha / 2);
      // in the plane through the axis of the patch (x away from it, y along it)
      return R.draw([0, ri]).lineTo([0, ro]).threePointsArcTo([ro * sa, ro * ca], [ro * sh, ro * ch]).lineTo([ri * sa, ri * ca]).threePointsArcTo([0, ri], [ri * sh, ri * ch]).close()
        .sketchOnPlane(new R.Plane(c, u, nrm)).revolve(s.ax, { origin: c, angle: 360 });
    };
    const slack = 0.002 * s.r * s.r;
    // (in one step with the others: the shell where the patch is less than half a sphere, else the whole sphere)
    if (collect) { tryTools(patch && s.alpha < 1.7 ? shell : full, s.vol, s.hole, slack, 'sphere', s); continue; }
    if (tryTools(full, s.vol, s.hole, slack, 'sphere') || (patch && tryTools(shell, s.vol, s.hole, slack, 'sphere'))) spheres++;
  }
  for (const t of (round.tori || []).slice(0, 60)) {
    // (the half of a tube that looks to the axis – the rounded rim of a hole, the fillet at the foot of a boss –
    // has its facets on both sides of the true face: it is done only where a sharp corner stands in for it)
    if (done.has(t) || (t.inner && !stood.has(t))) continue;
    const o = t.c.map(x => Math.round(x * 1e5) / 1e5), Rm = Math.round(t.R * 1e4) / 1e4, r = Math.round(t.r * 1e4) / 1e4, sg = t.inner ? -1 : 1;
    const ux = Math.abs(t.d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0], dd = ux[0] * t.d[0] + ux[1] * t.d[1] + ux[2] * t.d[2];
    let u = [ux[0] - t.d[0] * dd, ux[1] - t.d[1] * dd, ux[2] - t.d[2] * dd];
    const ul = Math.hypot(...u); u = u.map(x => x / ul);
    if (t.sweep) u = t.u.map((x, i) => x * Math.cos(t.a0) + t.w[i] * Math.sin(t.a0));
    const nrm = [u[1] * t.d[2] - u[2] * t.d[1], u[2] * t.d[0] - u[0] * t.d[2], u[0] * t.d[1] - u[1] * t.d[0]];
    // a shell of the tube between two radii, in the plane through the axis (x away from it, y along it)
    // (where the tube ends square to the axis – on a flat face – the ring of corners there is a polygon inside its
    // circle: the shell reaches a little further along that face, over the slivers between the two)
    const flatEnd = s => !t.inner && Math.abs(Math.cos(s)) < 1e-6, ext = Math.min(0.5 * Rm, 1.5 * Rm * (1 - Math.cos(Math.PI / Math.max(8, t.n))) + 2e-3);
    const shell = (ra, rb, wide = false) => {
      const P = (rad, s) => [Rm + sg * rad * Math.cos(s), rad * Math.sin(s)], sm = (t.s0 + t.s1) / 2;
      let dr = R.draw(P(ra, t.s0));
      if (wide && flatEnd(t.s0)) dr = dr.lineTo([Rm - ext, ra * Math.sin(t.s0)]).lineTo([Rm - ext, rb * Math.sin(t.s0)]);
      dr = dr.lineTo(P(rb, t.s0)).threePointsArcTo(P(rb, t.s1), P(rb, sm));
      if (wide && flatEnd(t.s1)) dr = dr.lineTo([Rm - ext, rb * Math.sin(t.s1)]).lineTo([Rm - ext, ra * Math.sin(t.s1)]);
      return dr.lineTo(P(ra, t.s1)).threePointsArcTo(P(ra, t.s0), P(ra, sm)).close()
        .sketchOnPlane(new R.Plane(o, u, nrm)).revolve(t.d, { origin: o, angle: t.sweep ? (t.sweep * 180) / Math.PI : 360 });
    };
    // (a torus with thousands of facets that has not been given large ones: too slow, it stays faceted)
    const st = stood.get(t);
    if (standOk.has(t) || (!st && t.tris > 400)) continue;
    if (t.whole) continue;
    const din = Math.min(0.9 * r, (st ? 1.15 * st.din : 1.5 * t.din) + 2e-3), dout = (st ? 1.3 * st.dout : 1.5 * t.dout) + 2e-3, tv = st ? st.vol : t.vol;
    const inside = grow => shell(r - din, r + grow, true), outside = grow => shell(r + grow, r + dout);
    if (!st || !st.corner) { if (tryTools(inside, tv, t.hole, 0.02 * tv + 0.002 * r * r, 'torus', t)) tori++; continue; }
    // a sharp corner stands in: what lies beyond the tube is cut away (a rounded edge, the rim of a hole), or the
    // corner is filled up to the tube (the fillet of a pocket floor, the foot of a boss)
    const beyond = grow => shell(r + (t.hole ? -grow : grow), r + 1.05 * st.dout + 2e-3);
    if (tryTools(beyond, tv, !t.hole, 0.03 * tv + 0.002 * r * r, 'torus', t)) tori++;
  }
  if (!collect) break;
  {
    const C = collect;
    collect = null;
    let next = solid;
    for (const it of C.items) {
      try {
        const v0 = vol(next), n2 = one(it.hole ? next.cut(it.tool) : next.fuse(it.tool)), dv = vol(n2) - v0;
        if (!Number.isFinite(dv) || typeof n2.fuse !== 'function' || Math.abs(Math.abs(dv) - it.sliver) > 0.05 * it.sliver + it.slack + 1e-3 || (dv < 0) !== it.hole) continue;
        next = n2;
        done.add(it.src);
        if (stood.has(it.src)) standOk.add(it.src);
        if (it.kind === 'cone') cones++; else if (it.kind === 'sphere') spheres++; else if (it.kind === 'torus') tori++; else { made++; if (it.kind === 'arc') arcs++; }
      } catch { /* later, on its own */ }
    }
    if (done.size) { next = simp(next); solid = next; }
  }
  }
  // a stand-in whose true face did not come about has changed the shape: once more without it
  const failed = [...stood.keys()].filter(x => !standOk.has(x));
  if (failed.length) { const no = new Set(skipKeys); for (const x of failed) no.add(keyOf.get(x)); return meshToStep(m0, cyls0, round0, no, noTori); }
  if (made || cones || spheres || tori) { solid = simp(solid); }
  const text = await solid.blobSTEP().text();
  // what is written must read back as the same body (a face that lost its outline comes back endless): if it
  // does not, once more without the tori, and in the end the facets as they are
  if (made || cones || spheres || tori) {
    let same = false;
    try { const b = await R.importSTEP(new Blob([text])), v = vol(solid); same = Math.abs(vol(b) - v) <= 1e-3 * Math.abs(v) + 1e-6; } catch { /* not the same */ }
    if (!same && !noTori && (round.tori || []).length) return meshToStep(m0, cyls0, round0, noStand, true);
    if (!same) return { text: await base.blobSTEP().text(), cylinders: 0, arcs: 0, cones: 0, spheres: 0, tori: 0 };
  }
  return { text, cylinders: made, arcs, cones, spheres, tori };
}

// ---------- STEP / IGES ----------
// IGES needs the full OpenCascade build (66 MB); it is loaded only when used and
// talks to the main kernel through STEP text.
const FULL_OC = new URL('../vendor/opencascade-full/opencascade.wasm.js', import.meta.url).href;
const FULL_WASM = new URL('../vendor/opencascade-full/opencascade.wasm.wasm', import.meta.url).href;
let fullOC = null, fullInst = null;
const fullWaiters = [];
async function loadFullOC() {
  if (!fullOC) fullOC = import(FULL_OC).then(m => new m.default({ locateFile: () => FULL_WASM })).then(oc => {
    fullInst = oc;
    for (const fn of fullWaiters.splice(0)) { try { fn(); } catch { /* listener's business */ } }
    return oc;
  });
  return fullOC;
}
// Steps of the model history that need the full kernel run synchronously once it is loaded.
export const fullKernelReady = () => !!fullInst;
export function requestFullKernel() { loadFullOC().catch(() => { fullOC = null; }); }
export function onFullKernel(fn) { if (fullInst) fn(); else fullWaiters.push(fn); }

// The writers of the full kernel do not always keep the file name they are given: the text of the file that
// appeared in the folder is returned, whatever it is called.
function writtenText(oc, want, write) {
  const had = new Set(oc.FS.readdir('/'));
  try { oc.FS.unlink('/' + want); had.delete(want); } catch { /* not there */ }
  write('/' + want);
  const made = oc.FS.readdir('/').filter(n => !had.has(n));
  if (!made.length) throw new Error('Das Ergebnis konnte nicht geschrieben werden');
  const text = oc.FS.readFile('/' + (made.includes(want) ? want : made[0]), { encoding: 'utf8' });
  for (const n of made) { try { oc.FS.unlink('/' + n); } catch { /* stays */ } }
  return text;
}

export async function igesToStep(igesText) {
  const oc = await loadFullOC();
  oc.FS.writeFile('/in.igs', igesText);
  const rd = new oc.IGESControl_Reader_1();
  if (rd.ReadFile('/in.igs').value !== 1) throw new Error('IGES-Datei konnte nicht gelesen werden');
  rd.TransferRoots();
  const sh = rd.OneShape();
  if (sh.IsNull()) throw new Error('Keine Geometrie in der IGES-Datei');
  // loose IGES faces: try to sew them into closed solids
  let out = sh;
  try {
    const sew = new oc.BRepBuilderAPI_Sewing(0.01, true, true, true, false);
    sew.Add(sh);
    sew.Perform(new oc.Handle_Message_ProgressIndicator_1());
    out = sew.SewedShape();
    const mk = new oc.TopExp_Explorer_2(out, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SOLID);
    const solids = new oc.BRep_Builder(), comp = new oc.TopoDS_Compound();
    solids.MakeCompound(comp);
    let any = false;
    for (; mk.More(); mk.Next()) {
      const ms = new oc.BRepBuilderAPI_MakeSolid_3(oc.TopoDS.Shell_1(mk.Current()));
      if (ms.IsDone()) { solids.Add(comp, ms.Solid()); any = true; }
    }
    const ex = new oc.TopExp_Explorer_2(out, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) { solids.Add(comp, ex.Current()); any = true; }
    if (any) out = comp;
  } catch { out = sh; }
  const w = new oc.STEPControl_Writer_1();
  w.Transfer(out, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  return writtenText(oc, 'out.step', name => w.Write(name));
}

export async function stepToIges(stepText) {
  const oc = await loadFullOC();
  oc.FS.writeFile('/x.step', stepText);
  const rd = new oc.STEPControl_Reader_1();
  rd.ReadFile('/x.step');
  rd.TransferRoots();
  const w = new oc.IGESControl_Writer_2('MM', 1); // 1 = B-rep solids (MSBO)
  w.AddShape(rd.OneShape());
  w.ComputeModel();
  return writtenText(oc, 'x.igs', name => w.Write_2(name, false));
}

// Remove faces from a solid so that the neighbouring faces grow together over the gap (holes, pockets, fillets,
// chamfers, bosses disappear). Needs the full kernel; the solid travels there and back as STEP text.
// points: one point on each face to remove. Returns { step, before, after } (volumes in mm³).
export async function removeFaces(stepText, points) { return removeFacesCore(await loadFullOC(), stepText, points); }
export function fullRemoveFaces(stepText, points) {
  if (!fullInst) throw new Error('Der große Geometriekern ist noch nicht geladen');
  return removeFacesCore(fullInst, stepText, points);
}
// Fillet whose radius follows points along the edge: law = [[u, r] …] with u from 0 (start) to 1 (end).
// edges: one point on each edge (its middle). Returns { step, before, after, edges }.
export function fullFilletLaw(stepText, edges, law) {
  const oc = fullInst;
  if (!oc) throw new Error('Der große Geometriekern ist noch nicht geladen');
  oc.FS.writeFile('/fl.step', stepText);
  const rd = new oc.STEPControl_Reader_1();
  if (rd.ReadFile('/fl.step').value !== 1) throw new Error('Körper konnte nicht übergeben werden');
  rd.TransferRoots();
  const shape = rd.OneShape();
  const vol = sh => { const p = new oc.GProp_GProps_1(); oc.BRepGProp.VolumeProperties_1(sh, p, false, false, false); return p.Mass(); };
  const all = [];
  const ex = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_EDGE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
  for (; ex.More(); ex.Next()) {
    const e = oc.TopoDS.Edge_1(ex.Current()), c = new oc.BRepAdaptor_Curve_2(e), p = c.Value((c.FirstParameter() + c.LastParameter()) / 2);
    all.push({ e, m: [p.X(), p.Y(), p.Z()] });
  }
  const mk = new oc.BRepFilletAPI_MakeFillet(shape, oc.ChFi3d_FilletShape.ChFi3d_Rational);
  const used = [];
  const nearestEdge = mp => { let best = null, bd = 0.05; for (const a of all) { const d = Math.hypot(a.m[0] - mp[0], a.m[1] - mp[1], a.m[2] - mp[2]); if (d < bd) { bd = d; best = a; } } return best; };
  const setLaw = (pairs, put) => { const arr = new oc.TColgp_Array1OfPnt2d_2(1, pairs.length); pairs.forEach(([u, r], i) => arr.SetValue(i + 1, new oc.gp_Pnt2d_3(u, r))); put(arr); };
  const ends = e => { const c = new oc.BRepAdaptor_Curve_2(e), p0 = c.Value(c.FirstParameter()), p1 = c.Value(c.LastParameter()), pm = c.Value((c.FirstParameter() + c.LastParameter()) / 2); return { f: [p0.X(), p0.Y(), p0.Z()], l: [p1.X(), p1.Y(), p1.Z()], m: [pm.X(), pm.Y(), pm.Z()] }; };
  const d3 = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
  if (edges.some(q => q.a)) {
    // Edges with their own radii at both ends ({ p, a, ra, b, rb, inner }): the kernel rounds the whole chain of
    // tangent edges an edge belongs to as one contour; every edge of that contour gets its piece of the course.
    // Position 0 of an edge's law is the start of its curve. Contour edges that were not chosen keep the radius
    // of the nearest chosen end.
    const todo = edges.slice();
    let ic = 0;
    while (todo.length) {
      const q = todo.shift(), first = nearestEdge(q.p);
      if (!first || used.some(u => u.IsSame(first.e))) continue;
      mk.Add_1(first.e);
      ic++;
      const nb = mk.NbEdges(ic), known = [], open = [];
      for (let j = 1; j <= nb; j++) {
        const ce = mk.Edge(ic, j), en = ends(ce);
        used.push(ce);
        const own = [q, ...todo].find(o => d3(o.p, en.m) < 0.05);
        if (!own) { open.push({ j, en }); continue; }
        const k = todo.indexOf(own);
        if (k >= 0) todo.splice(k, 1);
        let pairs = [[0, own.ra], ...(own.inner || []), [1, own.rb]];
        if (d3(en.f, own.b) < d3(en.f, own.a)) pairs = pairs.map(([u, r]) => [1 - u, r]).reverse();
        setLaw(pairs, arr => mk.SetRadius_4(arr, ic, j));
        known.push([own.a, own.ra], [own.b, own.rb]);
      }
      // the rest of the contour: outwards from the chosen edges, each with the radius where it joins
      while (open.length) {
        let best = 0, bd = Infinity, r = known[0]?.[1] ?? 1;
        open.forEach((o, i) => { for (const [p, rad] of known) { const d = Math.min(d3(o.en.f, p), d3(o.en.l, p)); if (d < bd) { bd = d; best = i; r = rad; } } });
        const o = open.splice(best, 1)[0];
        mk.SetRadius_1(r, ic, o.j);
        known.push([o.en.f, r], [o.en.l, r]);
      }
    }
  } else for (const q of edges) {
    const best = nearestEdge(q);
    if (!best || used.some(u => u.IsSame(best.e))) continue;
    used.push(best.e);
    setLaw(law, arr => mk.Add_5(arr, best.e));
  }
  if (!used.length) throw new Error('Keine Kanten gewählt (oder nicht mehr gefunden)');
  mk.Build();
  if (!mk.IsDone()) throw new Error('Verrundung mit diesen Radien nicht möglich – Radien verkleinern');
  const res = mk.Shape(), before = vol(shape), after = vol(res);
  if (res.IsNull() || !(after > 0)) throw new Error('Verrundung mit diesen Radien nicht möglich – Radien verkleinern');
  const w = new oc.STEPControl_Writer_1();
  w.Transfer(res, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  return { step: writtenText(oc, 'flout.step', name => w.Write(name)), before, after, edges: used.length };
}
function removeFacesCore(oc, stepText, points) {
  oc.FS.writeFile('/df.step', stepText);
  const rd = new oc.STEPControl_Reader_1();
  if (rd.ReadFile('/df.step').value !== 1) throw new Error('Körper konnte nicht übergeben werden');
  rd.TransferRoots();
  const shape = rd.OneShape();
  if (shape.IsNull()) throw new Error('Körper konnte nicht übergeben werden');
  const vol = s => { const p = new oc.GProp_GProps_1(); oc.BRepGProp.VolumeProperties_1(s, p, false, false, false); return p.Mass(); };
  const df = new oc.BRepAlgoAPI_Defeaturing();
  df.SetShape(shape);
  const chosen = [];
  for (const p of points) {
    const v = new oc.BRepBuilderAPI_MakeVertex(new oc.gp_Pnt_3(p[0], p[1], p[2])).Vertex();
    let best = null, bd = Infinity;
    const ex = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const f = ex.Current();
      const d = new oc.BRepExtrema_DistShapeShape_2(v, f, oc.Extrema_ExtFlag.Extrema_ExtFlag_MIN, oc.Extrema_ExtAlgo.Extrema_ExtAlgo_Grad).Value();
      if (d < bd) { bd = d; best = f; }
    }
    if (!best || bd > 0.05) continue;
    if (chosen.some(f => f.IsSame(best))) continue;
    chosen.push(best);
    df.AddFaceToRemove(best);
  }
  // a round hole is often two half faces of one cylinder: the other half goes with the chosen one
  const cylOf = face => {
    try {
      const ad = new oc.BRepAdaptor_Surface_2(oc.TopoDS.Face_1(face), true);
      if (ad.GetType() !== oc.GeomAbs_SurfaceType.GeomAbs_Cylinder) return null;
      const c = ad.Cylinder(), ax = c.Axis(), L = ax.Location(), D = ax.Direction();
      return { r: c.Radius(), p: [L.X(), L.Y(), L.Z()], d: [D.X(), D.Y(), D.Z()] };
    } catch { return null; }
  };
  const sameCyl = (u, v) => {
    if (Math.abs(u.r - v.r) > 1e-6) return false;
    const dot = u.d[0] * v.d[0] + u.d[1] * v.d[1] + u.d[2] * v.d[2];
    if (Math.abs(Math.abs(dot) - 1) > 1e-6) return false;
    const w = [v.p[0] - u.p[0], v.p[1] - u.p[1], v.p[2] - u.p[2]], t = w[0] * u.d[0] + w[1] * u.d[1] + w[2] * u.d[2];
    return Math.hypot(w[0] - t * u.d[0], w[1] - t * u.d[1], w[2] - t * u.d[2]) < 1e-6;
  };
  const cyls = chosen.map(cylOf).filter(Boolean);
  if (cyls.length) {
    const ex = new oc.TopExp_Explorer_2(shape, oc.TopAbs_ShapeEnum.TopAbs_FACE, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) {
      const face = ex.Current();
      if (chosen.some(q => q.IsSame(face))) continue;
      const c = cylOf(face);
      if (c && cyls.some(q => sameCyl(q, c))) { chosen.push(face); df.AddFaceToRemove(face); }
    }
  }
  if (!chosen.length) throw new Error('Die gewählten Flächen wurden am Körper nicht gefunden – neu auswählen');
  df.Build();
  if (!df.IsDone()) throw new Error('Die Nachbarflächen lassen sich nicht über die Lücke verlängern');
  const res = df.Shape(), before = vol(shape), after = vol(res);
  if (res.IsNull() || !(after > 0)) throw new Error('Die Nachbarflächen lassen sich nicht über die Lücke verlängern');
  if (Math.abs(after - before) < 1e-6 * Math.max(1, before)) throw new Error('Nichts geändert: Die Nachbarflächen schließen diese Lücke nicht – zusammengehörige Flächen gemeinsam wählen (z. B. Wand und Boden einer Tasche)');
  const w = new oc.STEPControl_Writer_1();
  w.Transfer(res, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  const step = writtenText(oc, 'dfout.step', name => w.Write(name));
  return { step, before, after, faces: chosen.length };
}

// Synchronous read with the main kernel (used while rebuilding the history).
const solidCache = new Map();
export function stepSolids(key) {
  if (solidCache.has(key)) return solidCache.get(key).map(s => s.clone());
  const text = getBlob(key);
  if (!text) throw new Error('Importdatei fehlt – Projekt mit eingebetteter Datei (.ofab) öffnen');
  return solidsFromStepText(text, key);
}
// the same from STEP text; key names the entry in the cache (and the temporary file)
export function solidsFromStepText(text, key) {
  if (solidCache.has(key)) return solidCache.get(key).map(s => s.clone());
  const oc = R.getOC();
  const fn = `imp_${key}.step`;
  oc.FS.writeFile('/' + fn, text);
  const rd = new oc.STEPControl_Reader();
  try {
    if (rd.ReadFile(fn) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP-Datei unlesbar');
    rd.TransferRoots();
    const sh = rd.OneShape();
    const list = [];
    const ex = new oc.TopExp_Explorer(sh, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) list.push(R.cast(ex.Current()));
    if (!list.length) {
      // surfaces only: keep them as one (non-solid) body
      const s = R.cast(sh);
      if (!s || s.isNull) throw new Error('Keine Geometrie in der Datei');
      list.push(s);
    }
    solidCache.set(key, list);
    return list.map(s => s.clone());
  } finally {
    try { oc.FS.unlink('/' + fn); } catch { /* ignore */ }
  }
}

// ---------- zip (Fusion .tools files are zipped JSON) ----------
async function unzipFirst(buf, pred) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Keine gültige ZIP-Datei');
  let p = v.getUint32(eocd + 16, true);
  const n = v.getUint16(eocd + 10, true);
  for (let k = 0; k < n; k++) {
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (!pred(name)) continue;
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const data = new Uint8Array(buf, start, csize);
    if (method === 0) return new TextDecoder().decode(data);
    if (method !== 8) throw new Error('ZIP-Kompression nicht unterstützt');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }
  throw new Error('Keine Werkzeugdaten in der ZIP-Datei');
}

// ---------- tool libraries ----------
const num = v => {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(',', '.'));
};
const r3 = v => Math.round(v * 1000) / 1000;

// Fusion 360 / HSM tool type -> WerkFab tool type (null = not usable here)
function mapType(raw) {
  const s = String(raw || '').toLowerCase();
  if (/probe|taster/.test(s)) return 'probe';
  if (/holder|halter/.test(s)) return null;
  if (/turning.*groov|grooving|stech/.test(s)) return 'groove';
  if (/turning.*thread|gewindedreh/.test(s)) return 'tthread';
  if (/turning|dreh/.test(s)) return /boring/.test(s) ? null : 'turn';
  if (/^tap|tap |tapping|gewindebohr/.test(s)) return 'tap';
  if (/thread|gewindefr/.test(s)) return 'thread';
  if (/ream|reib/.test(s)) return 'ream';
  if (/spot|center drill|zentrier|drill|bohrer/.test(s)) return 'drill';
  if (/ball|lollipop|kugel|radius mill/.test(s)) return 'ball';
  if (/chamfer|counter ?sink|engrav|dovetail|tapered|fase|senk|gravier|v-bit|v-fr/.test(s)) return 'chamfer';
  if (/boring bar|counter ?bore|ausdreh/.test(s)) return null;
  if (/bull ?nose|torus/.test(s)) return 'torus';
  if (/face ?mill|planfr/.test(s)) return 'facemill';
  return 'flat';
}

const TYPE_LABEL = { probe: '3D-Taster', torus: 'Torusfräser', facemill: 'Planfräser', flat: 'Schaftfräser', ball: 'Kugelfräser', chamfer: 'Fasenfräser', drill: 'Bohrer', tap: 'Gewindebohrer', ream: 'Reibahle', thread: 'Gewindefräser', turn: 'Drehmeißel', groove: 'Stechmeißel', tthread: 'Gewindedrehmeißel' };

function finishTool(t, raw) {
  const type = t.type;
  const dia = r3(t.dia);
  // missing cutting data: carbide guide values from the diameter (vc in m/min, feed per tooth/rev)
  if (!(t.rpm > 0) && !['turn', 'groove', 'tthread'].includes(type)) {
    const vc = { drill: 70, tap: 10, ream: 15, thread: 120 }[type] || 150;
    t.rpm = Math.min(24000, (vc * 1000) / (Math.PI * dia));
  } else if (!(t.rpm > 0)) t.rpm = 1500;
  if (!(t.feed > 0) && type !== 'tap') {
    const per = ['drill', 'ream'].includes(type) ? Math.min(0.3, 0.02 * dia) : Math.min(0.1, Math.max(0.01, 0.008 * dia)) * (t.flutes > 0 ? t.flutes : 2);
    t.feed = ['turn', 'groove', 'tthread'].includes(type) ? 0.15 * t.rpm : per * t.rpm;
  }
  const tool = {
    number: Math.max(1, Math.round(t.number || 1)),
    name: (t.name || `${TYPE_LABEL[type]} Ø${dia}`).trim().slice(0, 60),
    type, dia,
    flutes: t.flutes > 0 ? Math.round(t.flutes) : 2,
    rpm: t.rpm > 0 ? Math.round(t.rpm) : type === 'tap' ? 400 : 10000,
    feed: t.feed > 0 ? Math.round(t.feed) : 500,
    plunge: Math.round(t.plunge > 0 ? t.plunge : ['drill', 'ream'].includes(type) ? t.feed : t.feed / 3),
    stepdown: t.stepdown > 0 ? r3(t.stepdown) : r3(Math.max(0.2, dia * 0.25)),
    stepover: t.stepover > 0 && t.stepover < 1 ? t.stepover : type === 'ball' ? 0.1 : 0.4,
  };
  if (t.fluteLen > 0) tool.fluteLen = r3(t.fluteLen);
  if (t.holderDia > 0) tool.holderDia = r3(t.holderDia);
  if (t.stickout > 0) tool.stickout = r3(t.stickout);
  if (t.cornerR > 0) tool.cornerR = r3(t.cornerR);
  if (type === 'chamfer') { tool.angle = t.angle > 0 ? r3(t.angle) : 90; tool.tip = t.tip > 0 ? r3(t.tip) : 0; }
  if (type === 'drill') tool.angle = t.angle > 0 ? r3(t.angle) : 118;
  if (type === 'tap' || type === 'thread' || type === 'tthread') tool.pitch = t.pitch > 0 ? r3(t.pitch) : type === 'tap' ? 1 : 1.5;
  if (type === 'tap' && t.left) tool.hand = 'left';
  if (type === 'turn') tool.noseRadius = t.cornerR > 0 ? r3(t.cornerR) : 0.4;
  if (type === 'groove') tool.width = t.width > 0 ? r3(t.width) : dia;
  if (type === 'tap') tool.feed = tool.plunge = r3(tool.rpm * tool.pitch);
  // descriptive data like in the usual tool library
  for (const k of ['vendor', 'productId', 'productLink', 'material', 'coolant']) if (t[k]) tool[k] = String(t[k]).slice(0, 120);
  for (const k of ['length', 'shaftDia', 'shoulderLen']) if (t[k] > 0) tool[k] = r3(t[k]);
  if (t.cw === false) tool.cw = false;
  if (Array.isArray(t.presets) && t.presets.length) tool.presets = t.presets;
  if (type === 'flat' && t.cornerR > 0 && t.cornerR < dia / 2 - 1e-6) tool.type = 'torus';
  if (type === 'probe') { tool.rpm = 0; tool.feed = tool.plunge = Math.round(t.feed > 0 ? t.feed : 300); }
  if (raw) tool.source = raw;
  return tool;
}

const coolMap = c => ({ flood: 'flood', mist: 'mist', air: 'air', 'air through tool': 'airThrough', 'through tool': 'through', 'flood and through tool': 'through', 'flood and mist': 'flood', disabled: 'off', off: 'off' })[String(c || '').toLowerCase()] || undefined;

// Fusion 360 / HSM JSON: { data: [ { type, description, geometry: { DC, NOF, ... }, ... } ] }
function fromFusionJson(j) {
  const list = Array.isArray(j) ? j : j.data || j.tools || [];
  const out = [], skipped = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    // already WerkFab format
    if (typeof x.dia === 'number' && x.type && !x.geometry) { out.push(finishTool({ ...x, number: x.number })); continue; }
    const type = mapType(x.type);
    const label = x.description || x.type || '?';
    if (!type) { skipped.push(label); continue; }
    const g = x.geometry || {}, pp = x['post-process'] || {}, preset = x['start-values']?.presets?.[0] || {};
    const k = /inch/i.test(x.unit || '') ? 25.4 : 1;
    const seg = x.holder?.segments?.[0];
    const half = num(g.TA);
    const t = {
      type, number: num(pp.number), name: x.description || [x.vendor, x['product-id']].filter(Boolean).join(' '),
      dia: num(g.DC) * k, flutes: num(g.NOF), fluteLen: num(g.LCF) * k, stickout: num(g.LB) * k, cornerR: num(g.RE) * k,
      holderDia: num(seg?.['lower-diameter']) * k,
      // chamfer mills store the half angle (TA = 45 for a 90° tool); drills the point angle SIG
      angle: type === 'chamfer' ? (half > 0 ? 2 * half : num(g.SIG)) : num(g.SIG),
      tip: num(g['tip-diameter']) * k, pitch: num(g.TP) * k, left: /left/i.test(x.type) || g.HAND === false,
      width: num(g.CW ?? g.width) * k,
      rpm: num(preset.n), feed: num(preset.v_f) * k, plunge: num(preset.v_f_plunge) * k,
      stepdown: num(preset.stepdown) * k, stepover: num(preset.stepover) * k / (num(g.DC) * k),
      vendor: x.vendor, productId: x['product-id'], productLink: x['product-link'], material: x.BMC,
      length: num(g.OAL) * k, shaftDia: num(g.SFDM) * k, shoulderLen: num(g['shoulder-length']) * k, cw: g.CSP !== false && g.HAND !== false,
      coolant: coolMap(preset['tool-coolant']),
      // further cutting data presets
      presets: (x['start-values']?.presets || []).slice(1).map((q, i) => ({ id: 'p' + i, name: q.name || `Vorgabe ${i + 2}`, rpm: num(q.n), feed: num(q.v_f) * k, plunge: num(q.v_f_plunge) * k, leadIn: num(q.v_f_leadIn) * k, leadOut: num(q.v_f_leadOut) * k, coolant: coolMap(q['tool-coolant']) })).filter(q => q.rpm > 0 || q.feed > 0),
    };
    if (!(t.dia > 0)) { skipped.push(label); continue; }
    out.push(finishTool(t, 'Fusion 360'));
  }
  return { tools: out, skipped };
}

// HSMWorks / Inventor CAM .hsmlib (XML)
function fromHsmlib(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Ungültige XML-Datei');
  const out = [], skipped = [];
  for (const el of doc.querySelectorAll('tool')) {
    const type = mapType(el.getAttribute('type'));
    const desc = el.querySelector('description')?.textContent || el.getAttribute('type');
    if (!type) { skipped.push(desc); continue; }
    const a = (sel, name) => num(el.querySelector(sel)?.getAttribute(name));
    const k = /inch/i.test(el.getAttribute('unit') || '') ? 25.4 : 1;
    const ta = a('body', 'taper-angle');
    const t = {
      type, number: a('nc', 'number'), name: desc,
      dia: a('body', 'diameter') * k, flutes: a('body', 'number-of-flutes'), fluteLen: a('body', 'flute-length') * k,
      stickout: a('body', 'body-length') * k, cornerR: a('body', 'corner-radius') * k,
      angle: type === 'chamfer' ? (ta > 0 ? 2 * ta : NaN) : a('body', 'point-angle') || a('body', 'tip-angle'),
      tip: a('body', 'tip-diameter') * k, pitch: a('body', 'thread-pitch') * k, left: /left/i.test(el.getAttribute('type')),
      rpm: a('motion', 'spindle-rpm'), feed: a('motion', 'cutting-feedrate') * k, plunge: a('motion', 'plunge-feedrate') * k,
    };
    if (!(t.dia > 0)) { skipped.push(desc); continue; }
    out.push(finishTool(t, 'HSM'));
  }
  return { tools: out, skipped };
}

// CSV / tab separated tables (e.g. exported from SolidWorks CAM, Excel or a tool shop)
const CSV_COLS = [
  ['number', /^(t|nr\.?|no\.?|#|nummer|number|tool ?(no|nr|number|#)|werkzeug ?(nr|nummer)|wz ?nr|platz|pocket|station)$/],
  ['plunge', /eintauch|plunge|z-?vorschub|vf.?plunge/],
  ['fluteLen', /schneidenl|flute ?len|lcf|cut(ting)? ?len|nutzl/],
  ['flutes', /schneiden(zahl|anzahl)?$|flutes|^z$|^nof$|z(ä|ae)hne|teeth/],
  ['holderDia', /halter/],
  ['stickout', /auskrag|stick ?out|ausspann|^lb$/],
  ['cornerR', /ecken ?radius|corner|^re$|^r$/],
  ['pitch', /steigung|pitch/],
  ['angle', /winkel|angle|spitze/],
  ['dia', /durchmesser|diameter|^dia\.?$|^d$|^dc$|^ø|ø$|^d ?\(mm\)$/],
  ['rpm', /drehzahl|rpm|spindle|^s$|^n$|u\/min|1\/min/],
  ['feed', /vorschub|feed|^f$|^vf$|mm\/min/],
  ['type', /^(typ|type|art|werkzeugtyp|tool ?type|kategorie|category)$/],
  ['name', /name|bezeichnung|beschreibung|description|comment|kommentar|werkzeug$|tool$/],
];

function splitCsvLine(line, d) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function fromCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('Tabelle ohne Daten');
  const d = ['\t', ';', ','].map(c => [c, lines[0].split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitCsvLine(lines[0], d).map(s => s.toLowerCase().replace(/\s*\[.*?\]|\s*\(.*?\)/g, '').trim());
  const col = {};
  head.forEach((hname, i) => {
    for (const [key, re] of CSV_COLS) if (col[key] == null && re.test(hname)) { col[key] = i; break; }
  });
  if (col.dia == null) throw new Error('Keine Spalte „Durchmesser“ gefunden. Erkannte Spalten: ' + head.join(', '));
  const out = [], skipped = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, d);
    const g = key => (col[key] == null ? undefined : c[col[key]]);
    const typeText = `${g('type') || ''} ${g('name') || ''}`;
    const type = mapType(typeText);
    if (!type) { skipped.push(g('name') || typeText.trim()); continue; }
    const t = {
      type, number: num(g('number')), name: g('name'), dia: num(g('dia')), flutes: num(g('flutes')), fluteLen: num(g('fluteLen')),
      holderDia: num(g('holderDia')), stickout: num(g('stickout')), cornerR: num(g('cornerR')), pitch: num(g('pitch')), angle: num(g('angle')),
      rpm: num(g('rpm')), feed: num(g('feed')), plunge: num(g('plunge')), left: /links|left|lh/i.test(typeText),
    };
    if (!(t.dia > 0)) { skipped.push(g('name') || line.slice(0, 30)); continue; }
    out.push(finishTool(t, 'CSV'));
  }
  return { tools: out, skipped };
}

// Returns { tools: [...without id], skipped: [names], format }
export async function parseToolLibrary(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  const isZip = new Uint8Array(buf, 0, 2).every((b, i) => b === [0x50, 0x4b][i]);
  if (isZip) {
    const text = await unzipFirst(buf, n => /\.json$/i.test(n) || !n.includes('.'));
    return { ...fromFusionJson(JSON.parse(text)), format: 'Fusion 360 (.tools)' };
  }
  const text = new TextDecoder().decode(buf);
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return { ...fromFusionJson(JSON.parse(text)), format: name.endsWith('.json') ? 'JSON (Fusion 360 / WerkFab)' : 'JSON' };
  if (t.startsWith('<')) return { ...fromHsmlib(text), format: 'HSMWorks / Inventor CAM (.hsmlib)' };
  return { ...fromCsv(text), format: 'Tabelle (CSV)' };
}

// ---------- Fusion 360 / HSM .cps post-processors ----------
// A .cps file is a JavaScript program for Autodesk's post engine. It is not
// executed here; its settings are read and mapped onto the closest built-in
// template, which can then be refined in the post editor.
function block(text, start) {
  const i = text.search(start);
  if (i < 0) return '';
  const b = text.indexOf('{', i);
  if (b < 0) return '';
  let depth = 0;
  for (let k = b; k < text.length; k++) {
    if (text[k] === '{') depth++;
    else if (text[k] === '}' && --depth === 0) return text.slice(b + 1, k);
  }
  return '';
}

function cpsProperties(text) {
  const body = block(text, /\bproperties\s*=\s*\{/);
  const props = {};
  const val = s => {
    s = s.trim().replace(/,$/, '');
    if (/^(true|false)$/.test(s)) return s === 'true';
    if (/^-?\d+(\.\d+)?$/.test(s)) return +s;
    const m = s.match(/^["'](.*)["']$/);
    return m ? m[1] : s;
  };
  // new style:  name: { title: ..., value: X, ... }
  for (const m of body.matchAll(/(\w+)\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    const v = m[2].match(/\bvalue\s*:\s*("[^"]*"|'[^']*'|[^,\n}]+)/);
    if (v) props[m[1]] = val(v[1]);
  }
  // old style:  name: X,
  for (const m of body.matchAll(/^\s*(\w+)\s*:\s*("[^"]*"|'[^']*'|true|false|-?\d+(?:\.\d+)?)\s*,?\s*(\/\/.*)?$/gm)) if (!(m[1] in props)) props[m[1]] = val(m[2]);
  return props;
}

export function convertCps(text, fileName = 'post.cps') {
  const str = re => text.match(re)?.[1];
  const description = str(/\bdescription\s*=\s*"([^"]*)"/) || str(/\bdescription\s*=\s*'([^']*)'/) || fileName.replace(/\.cps$/i, '');
  const vendor = str(/\bvendor\s*=\s*"([^"]*)"/) || '';
  const ext = str(/\bextension\s*=\s*"([^"]*)"/) || 'nc';
  const lathe = /CAPABILITY_TURNING/.test(text.match(/\bcapabilities\s*=([^;]*);/)?.[1] || '') || /turning|lathe|drehen/i.test(description);
  const hay = `${vendor} ${description} ${fileName}`.toLowerCase();
  const baseId = /heidenhain|tnc/.test(hay) ? 'heidenhain'
    : /siemens|sinumerik|840d|828d/.test(hay) ? 'sinumerik'
    : /grbl/.test(hay) ? 'grbl'
    : /linuxcnc|emc2?\b|mach ?3|mach ?4/.test(hay) ? (lathe ? 'linuxcnc-lathe' : 'linuxcnc')
    : lathe ? 'fanuc-lathe' : 'fanuc';
  const base = BUILTIN_POSTS.find(p => p.id === baseId);
  const def = copyPost(base, null, description);
  const report = [`Grundlage: ${base.name} (aus Hersteller/Beschreibung „${[vendor, description].filter(Boolean).join(' – ')}“)`];
  def.ext = ext.replace(/^\./, '');
  report.push(`Dateiendung: .${def.ext}`);
  if (baseId === 'heidenhain') return { def, report: [...report, 'Klartext-Steuerung: Satzaufbau aus der WerkFab-Vorlage übernommen.'] };

  // comments
  const fc = block(text, /function\s+formatComment\s*\(/);
  if (/["']\s*;\s*["']|["'];\s?["']/.test(fc) || /";\s*"\s*\+/.test(fc)) { def.comment = '; {text}'; report.push('Kommentare: ; Text'); }
  else if (/["']\(["']/.test(fc)) { def.comment = '({text})'; report.push('Kommentare: (Text)'); }

  // number format
  const xyz = text.match(/\bxyzFormat\s*=\s*createFormat\(\s*\{([^}]*)\}/)?.[1] || '';
  const dec = xyz.match(/decimals\s*:\s*\(?\s*unit\s*==\s*MM\s*\?\s*(\d)/) || xyz.match(/decimals\s*:\s*(\d)/);
  if (dec) { def.decimals = +dec[1]; report.push(`Nachkommastellen: ${def.decimals}`); }
  if (/forceDecimal\s*:\s*true/.test(xyz)) { def.decimalPoint = true; report.push('Dezimalpunkt immer schreiben (X10.)'); }
  if (/forceSign\s*:\s*true/.test(xyz)) def.signed = true;

  // G00 vs G0
  const gf = text.match(/\bgFormat\s*=\s*createFormat\(\s*\{([^}]*)\}/)?.[1] || '';
  if (/zeropad\s*:\s*true/.test(gf) && /width\s*:\s*2/.test(gf)) {
    const pad = s => (typeof s === 'string' ? s.replace(/\bG([0-4])(?![0-9.])/g, 'G0$1') : s);
    for (const k of Object.keys(def)) if (typeof def[k] === 'string' && k !== 'name' && k !== 'ext' && k !== 'comment') def[k] = pad(def[k]);
    report.push('G-Codes zweistellig (G00, G01, …)');
  }

  // properties
  const P = cpsProperties(text);
  if ('showSequenceNumbers' in P) {
    const on = P.showSequenceNumbers === true || P.showSequenceNumbers === 'true';
    def.lineNumbers = { ...def.lineNumbers, enabled: on };
    report.push(`Satznummern: ${on ? 'ein' : P.showSequenceNumbers === 'toolChange' ? 'nur bei Werkzeugwechsel (→ aus)' : 'aus'}`);
  }
  if (P.sequenceNumberStart > 0) def.lineNumbers = { ...def.lineNumbers, start: P.sequenceNumberStart };
  if (P.sequenceNumberIncrement > 0) def.lineNumbers = { ...def.lineNumbers, step: P.sequenceNumberIncrement };
  if (P.separateWordsWithSpace === false) { def.separator = ''; report.push('Adressen ohne Leerzeichen'); }
  if (P.useRadius === true) report.push('⚠ Kreisbögen mit R statt I/J werden nicht unterstützt – I/J wird ausgegeben');
  if (P.useCycles === false || P.expandCycles === true) { def.useDrillCycle = false; report.push('Bohrzyklen ausgeschrieben'); }
  if ('useG28' in P ? P.useG28 === true : /gFormat\.format\(28\)/.test(text)) {
    if (!lathe) def.footer = String(def.footer).replace(/G00? Z\{safe\}/, m => `${m}\n${m.startsWith('G00') ? 'G91 G28 Z0.' : 'G91 G28 Z0'}\nG90`);
    report.push('Rückfahrt zum Referenzpunkt mit G28 am Programmende');
  }
  if (P.useM6 === false) { def.toolChangeFirst = String(def.toolChangeFirst).replace(/ M6/g, ''); def.toolChange = String(def.toolChange).replace(/ M6/g, ''); report.push('Werkzeugwechsel ohne M6'); }
  if (typeof P.programName === 'string' && /^\d+$/.test(P.programName)) def.header = String(def.header).replace(/O\d+/, 'O' + P.programName);

  // coolant codes
  const flood = text.match(/COOLANT_FLOOD[^}]*?\bon\s*:\s*(\d+)/) || text.match(/case\s+COOLANT_FLOOD\s*:[^;]*?(\d+)/);
  if (flood) { def.coolantOn = `M${flood[1]}`; report.push(`Kühlmittel ein: ${def.coolantOn}`); }
  const off = text.match(/COOLANT_FLOOD[^}]*?\boff\s*:\s*(\d+)/) || text.match(/COOLANT_OFF[^}]*?(\d+)/);
  if (off) def.coolantOff = `M${off[1]}`;

  // work offset / units / plane block
  if (/\bG54\b|gFormat\.format\(54\)|workOffset/.test(text) && !/G54/.test(def.header) && !lathe) def.header = String(def.header).replace(/\nG0 Z\{safe\}/, '\nG54\nG0 Z{safe}');
  report.push('⚠ Programmlogik (JavaScript) wird nicht ausgeführt: Sonderfunktionen, 4./5. Achse, Messzyklen und Maschinenoptionen bitte im Postprozessor-Editor prüfen.');
  return { def, report };
}
