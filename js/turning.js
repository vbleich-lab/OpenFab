// Turning (lathe) CAM. The spindle axis is the model's Z axis; toolpaths live in
// the XZ half-plane with x = radius (the post-processor writes diameters).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export const TURN_OPS = {
  tface: 'Plandrehen', trough: 'Längsschruppen', tfinish: 'Konturschlichten',
  tgroove: 'Einstechen', tthread: 'Gewindedrehen', tpart: 'Abstechen', tdrill: 'Bohren (Drehachse)', tbore: 'Innendrehen',
  tlive: 'Bohren angetrieben (C-Achse)', tslot: 'Nut angetrieben (C-Achse)', tflat: 'Schlüsselflächen (C-Achse)',
  tcontour: 'Kontur Planfläche (C-Achse)', twrap: 'Kontur Mantelfläche (C-Achse)', tpocket: 'Tasche Planfläche (C-Achse)', twpocket: 'Tasche Mantelfläche (C-Achse)',
};
export const TURN_TOOL_TYPES = { turn: 'Drehmeißel (außen)', groove: 'Stechmeißel', tthread: 'Gewindedrehmeißel', drill: 'Bohrer', turnbore: 'Bohrstange (Drehen - Bohren)' };

// Outer radius of the part as a function of z, sampled by rays towards the axis; inner radius (bore) by rays
// from the axis outwards: an odd number of crossings means the axis lies in material (no bore there).
export function turnProfile(bodies, box) {
  const bvhs = bodies.map(b => new MeshBVH(b.geometry.clone()));
  const Rout = Math.max(...[box.min.x, box.max.x, box.min.y, box.max.y].map(Math.abs)) * 1.5 + 5;
  const z0 = box.min.z, z1 = box.max.z;
  const dz = Math.max(0.01, (z1 - z0) / 4000);
  const n = Math.ceil((z1 - z0) / dz) + 1;
  const r = new Float32Array(n), ri = new Float32Array(n);
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3());
  for (let i = 0; i < n; i++) {
    const z = Math.min(z1 - 1e-4, Math.max(z0 + 1e-4, z0 + i * dz));
    let best = 0;
    for (let k = 0; k < 16; k++) {
      const a = (k / 16) * Math.PI * 2;
      ray.origin.set(Rout * Math.cos(a), Rout * Math.sin(a), z);
      ray.direction.set(-Math.cos(a), -Math.sin(a), 0);
      for (const bvh of bvhs) { const hit = bvh.raycastFirst(ray, THREE.DoubleSide); if (hit) best = Math.max(best, Rout - hit.distance); }
    }
    r[i] = best;
    let inner = Infinity;
    for (let k = 0; k < 16 && best > 0; k++) {
      const a = ((k + 0.5) / 16) * Math.PI * 2;
      ray.origin.set(0, 0, z);
      ray.direction.set(Math.cos(a), Math.sin(a), 0);
      for (const bvh of bvhs) {
        const hits = bvh.raycast(ray, THREE.DoubleSide).map(h => h.distance).sort((p, q) => p - q).filter((d, j, arr) => j === 0 || d - arr[j - 1] > 1e-5);
        if (!hits.length) continue;
        inner = hits.length % 2 ? 0 : Math.min(inner, hits[0]);
      }
      if (inner === 0) break;
    }
    ri[i] = best > 0 && Number.isFinite(inner) ? inner : 0;
  }
  // between two samples the safe value: the larger outer radius, the smaller bore (a shoulder is never moved
  // towards the material by the sampling)
  const i0 = z => Math.max(0, Math.min(n - 1, Math.floor((z - z0) / dz))), i1 = z => Math.min(n - 1, i0(z) + 1);
  return {
    z0, z1, dz, r, ri,
    at: z => (z < z0 || z > z1 ? 0 : Math.max(r[i0(z)], r[i1(z)])),
    atIn: z => (z < z0 || z > z1 ? Infinity : Math.min(ri[i0(z)], ri[i1(z)])),
  };
}

export function turnStock(box, setup, prof) {
  const maxR = Math.max(...prof.r);
  const R = (+setup.stockDia > 0 ? +setup.stockDia / 2 : maxR + (+setup.marginSide || 2));
  const top = box.max.z + (+setup.marginTop || 1), bottom = box.min.z - (+setup.marginBottom || 10);
  return { kind: 'turn', r: R, top, bottom, modelTop: box.max.z, modelBottom: box.min.z, minX: -R, maxX: R, minY: -R, maxY: R };
}

// Cutting edge of a lathe tool around its programmed point (x = radius, z), as the radius it cuts down to at
// height z + d. Turning tools are programmed with the theoretical tip (corner of the tangents at the nose):
// the nose circle lies above and outside the tip, so straight turning and facing are exact. Grooving and
// parting tools have a flat edge of their width around the point, thread tools a 60° flank.
// Behind the nose the minor (trailing) edge of a turning insert rises at 180° − lead angle − insert angle
// (DCMT 55° in a 93° holder: 32°): the tool cannot go down towards the axis more steeply than that.
// Boring bars are the mirror image (side 'in': they cut outwards, the bar body lies on the axis side), drills
// cut from the axis out to their radius (side 'axis', cone at the tip). tool.kind is the library type when the
// CAM tool table has reduced the type to its base.
export function turnCutShape(tool) {
  const ty = tool.kind || tool.type;
  if (ty === 'turn' || ty === 'turnbore') {
    const rn = Math.max(0.05, +tool.noseRadius || 0.4);
    const beta = Math.max(1, Math.min(89, 180 - (+tool.leadAngle || 93) - (+tool.insertAngle || 55))), tb = Math.tan((beta * Math.PI) / 180);
    const L = Math.max(3 * rn, +tool.edgeLen || (ty === 'turnbore' ? 4 : 8));
    const nose = d => rn - Math.sqrt(Math.max(0, rn * rn - (d - rn) * (d - rn)));
    // the nose rounding runs on to where the trailing edge touches it (normal at 180° − β), then the straight
    // trailing edge continues tangentially
    const dT = rn * (1 + Math.sin((beta * Math.PI) / 180)), oT = nose(dT);
    const off = d => (d < dT ? nose(d) : oT + tb * (d - dT));
    if (ty === 'turnbore') {
      const D = Math.max(1, +tool.dia || 12);
      return { side: 'in', lo: 0, hi: L, rn, beta, bar: { D, clr: Math.max(0.5, 0.2 * D) }, at: (x, d) => x - off(d) };
    }
    return { side: 'out', lo: 0, hi: L, rn, beta, at: (x, d) => x + off(d) };
  }
  if (ty === 'drill' || ty === 'center' || ty === 'spot') {
    const R = Math.max(0.1, (+tool.dia || 6) / 2), tn = Math.tan((((+tool.angle || 118) / 2) * Math.PI) / 180);
    return { side: 'axis', lo: 0, hi: Math.max(20, +tool.fluteLen || +tool.length || 60), R, at: (x, d) => Math.min(R, d * tn) + Math.abs(x) };
  }
  // internal grooving and threading tools sit on a bar like a boring bar and cut outwards
  const bar = tool.internal ? { D: Math.max(1, +tool.dia || 6), clr: Math.max(0.5, 0.2 * Math.max(1, +tool.dia || 6)) } : null;
  if (ty === 'tthread') return bar ? { side: 'in', lo: -0.6, hi: 0.6, bar, at: (x, d) => x - Math.abs(d) * 1.732 } : { side: 'out', lo: -0.6, hi: 0.6, at: (x, d) => x + Math.abs(d) * 1.732 };
  const half = ty === 'groove' ? (+tool.width || 3) / 2 : 0.3;
  return { side: bar ? 'in' : 'out', lo: -half, hi: half, ...(bar ? { bar } : {}), at: x => x };
}

// Remaining material of a turned part: per z cell a ring from ri (bore) to ro (outside); empty when ro <= ri.
export class LatheStock {
  constructor(stock) {
    this.bottom = stock.bottom;
    this.dz = Math.max(0.05, (stock.top - stock.bottom) / 700);
    this.n = Math.ceil((stock.top - stock.bottom) / this.dz) + 1;
    this.ro = new Float32Array(this.n).fill(stock.r);
    this.ri = new Float32Array(this.n);
  }
  // tool edge at (x, z): removes what it covers; cb(i, zi, d, removed, newRadius) for every changed cell
  cutAt(x, z, sh, cb) {
    const { ro, ri, bottom, dz, n } = this;
    const i0 = Math.max(0, Math.ceil((z + sh.lo - bottom) / dz - 1e-6)), i1 = Math.min(n - 1, Math.floor((z + sh.hi - bottom) / dz + 1e-6));
    let rem = 0;
    for (let i = i0; i <= i1; i++) {
      if (ro[i] <= ri[i] + 1e-6) continue;
      const zi = bottom + i * dz, d = zi - z, rr = sh.at(x, d);
      let nr, r;
      if (sh.side === 'out') {
        if (ro[i] <= rr + 0.01) continue;
        nr = Math.max(0, rr, ri[i]); r = ro[i] - nr; ro[i] = nr;
      } else {
        if (ri[i] >= rr - 0.01) continue;
        nr = Math.min(rr, ro[i]); r = nr - ri[i]; ri[i] = nr;
      }
      rem += r;
      if (cb) cb(i, zi, d, r, nr);
    }
    return rem;
  }
  // boring bar body (from 2 mm above the tip upwards) touching material: the z of the first contact, else null
  barHit(x, z, sh) {
    if (!sh.bar) return null;
    const e = Math.max(x - sh.bar.clr, Math.abs(x - sh.bar.clr - sh.bar.D));
    for (let i = Math.max(0, Math.ceil((z + 2 - this.bottom) / this.dz)); i < this.n; i++) if (this.ro[i] > this.ri[i] + 0.01 && this.ri[i] < e - 0.05) return this.bottom + i * this.dz;
    return null;
  }
}

class LPath {
  constructor() { this.m = []; this.p = null; }
  rapid(x, z) { this.m.push({ t: 'r', x, y: 0, z }); this.p = { x, z }; }
  feed(x, z, f) { this.m.push({ t: 'f', x, y: 0, z, f }); this.p = { x, z }; }
  thread(x, z, f, pitch) { this.m.push({ t: 't', x, y: 0, z, f, pitch }); this.p = { x, z }; }
  // driven tool with the spindle as C axis: the tool stays in the XZ plane of the machine at radius xr, the part
  // is turned to c (degrees). x/y are the position on the part (for display and simulation).
  live(t, xr, c, z, dir, f) {
    const a = (c * Math.PI) / 180;
    this.m.push({ t, x: xr * Math.cos(a), y: xr * Math.sin(a), z, xr, c, live: dir, ...(f ? { f } : {}) });
    this.p = { x: xr, z };
  }
  // driven axial tool moving in the plane across the axis (polar interpolation X/C): x, y on the part
  polar(t, x, y, z, f, tag) {
    // yc: the angle the part stands at when a machine with a Y axis does this pass with C fixed (flats: their own
    // angle, contours and pockets on the face: 0)
    this.m.push({ t, x, y, z, xr: Math.hypot(x, y), c: +((Math.atan2(y, x) * 180) / Math.PI).toFixed(4), yc: this.yc || 0, live: 'ax', polar: true, ...(f ? { f } : {}), ...(tag ? { [tag]: true } : {}) });
    this.p = { x: Math.hypot(x, y), z };
  }
}

// Drops points within tol of the straight move that replaces them (Douglas-Peucker: every dropped point is checked
// against the final segment, so a rounded corner cannot drift away point by point).
function simplify(pts, tol = 0.005) {
  const n = pts.length;
  if (n < 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, c] = stack.pop();
    if (c - a < 2) continue;
    const A = pts[a], C = pts[c], dx = C[0] - A[0], dz = C[1] - A[1], L2 = dx * dx + dz * dz;
    let worst = -1, wi = -1;
    for (let k = a + 1; k < c; k++) {
      const p = pts[k], u = L2 > 1e-18 ? Math.max(0, Math.min(1, ((p[0] - A[0]) * dx + (p[1] - A[1]) * dz) / L2)) : 0;
      const d = Math.hypot(p[0] - A[0] - u * dx, p[1] - A[1] - u * dz);
      if (d > worst) { worst = d; wi = k; }
    }
    if (worst > tol) { keep[wi] = 1; stack.push([a, wi], [wi, c]); }
  }
  return pts.filter((_, i) => keep[i]);
}

function genTurnOp(op, t, st, prof, ctx = {}) {
  const P = new LPath();
  const clearX = st.r + 2, clearZ = st.top + 2;
  const zEnd = op.zEnd != null && op.zEnd !== '' ? +op.zEnd : st.modelBottom;
  const stl = +op.stockToLeave || 0;
  // smallest radius the programmed point may take at z without the cutting edge going below the contour
  // (+ stock to leave) anywhere along its width: nose radius compensation of the path
  const sh = turnCutShape(t), stepD = Math.max(0.002, Math.min(0.005, (sh.hi - sh.lo) / 8)); // fine: at the tip the nose rounding is almost vertical
  const xmin = (z, s = stl) => {
    let m = -Infinity;
    for (let d = sh.lo; d <= sh.hi + 1e-9; d += stepD) m = Math.max(m, prof.at(z + d) + s - (sh.at(0, d)));
    return m;
  };
  // the finished path (nose compensated) from z0 to z1: samples every dz, refined where a straight move would
  // cut a corner (the nose rounds a shoulder edge) and across steep steps (shoulders) to pin them down
  const contour = (X, z0, z1) => {
    const pts = [];
    const refine = (a, b, depth) => {
      const dx = Math.abs(b[0] - a[0]), dz = Math.abs(b[1] - a[1]);
      if (depth > 8 || dx <= 0.005 || dz < 1e-4) return;
      const zm = (a[1] + b[1]) / 2, m = [X(zm), zm];
      if (m[0] <= (a[0] + b[0]) / 2 + 0.002 && !(dx > 0.05 && dx > 3 * dz)) return;
      refine(a, m, depth + 1); pts.push(m); refine(m, b, depth + 1);
    };
    const add = q => { if (pts.length) refine(pts[pts.length - 1], q, 0); pts.push(q); };
    for (let z = z0; z >= z1 - 1e-9; z -= prof.dz) add([X(z), z]);
    if (pts.length && pts[pts.length - 1][1] > z1 + 1e-6) add([X(z1), z1]);
    return pts;
  };
  // internal tools: the radius they travel at inside the bore down to z (0.5 mm from the narrowest bore wall)
  const inside = sh.side === 'in' && op.type !== 'tbore';
  const boreClear = zLo => {
    let m = Infinity;
    for (let z = st.modelTop; z >= zLo - 1e-9; z -= prof.dz) m = Math.min(m, prof.atIn(z));
    const xs = Number.isFinite(m) ? m - 0.5 : 0;
    if (sh.bar && sh.bar.D + sh.bar.clr > 2 * xs + 0.5 + 1e-6) throw new Error(`Innenwerkzeug Ø${sh.bar.D} passt nicht in die Bohrung Ø${+(2 * (xs + 0.5)).toFixed(2)}`);
    if (!(xs > 0)) throw new Error('Keine Bohrung für das Innenwerkzeug');
    return xs;
  };
  P.rapid(clearX, clearZ);
  switch (op.type) {
    case 'tface': {
      const ap = +op.stepdown || 0.5;
      for (let z = st.top - ap; ; z -= ap) {
        const zz = Math.max(z, st.modelTop + stl);
        P.rapid(clearX, zz + 1); P.rapid(clearX, zz);
        P.feed(-0.5, zz, t.feed);
        P.rapid(-0.5, zz + 1); P.rapid(clearX, zz + 1);
        if (zz <= st.modelTop + stl + 1e-6) break;
      }
      break;
    }
    case 'trough': {
      const ap = +op.stepdown || 1.5;
      const need = xmin;
      const zTop = Math.min(st.top, st.modelTop + 0.5);
      const minR = Math.min(...Array.from({ length: 200 }, (_, i) => need(zEnd + ((zTop - zEnd) * i) / 199)));
      const dz = prof.dz;
      // remaining stock radius per z sample (tip only), and how steeply the insert may go down (2° below its
      // trailing edge angle): an undercut is entered on a ramp from the stock surface, not straight in
      const nz = Math.floor((zTop - zEnd) / dz + 1e-9) + 1, left = new Float64Array(nz).fill(st.r);
      const ramp = Math.tan((Math.max(1, (sh.beta ?? 90) - 2) * Math.PI) / 180);
      for (let r = st.r - ap; r > minR - 1e-6; r -= ap) {
        const rl = Math.max(r, minR);
        // cut every z interval (top -> chuck) where the finished contour lies below this radius
        let inCut = false, rp = null;
        const xAt = z => (rp ? Math.max(rl, rp.x - (rp.z - z) * ramp) : rl);
        const leave = z => {
          P.feed(xAt(z), z, rp ? t.plunge : t.feed); P.feed(P.p.x + 0.5, z + 0.5, t.feed); P.rapid(clearX, P.p.z);
          inCut = false; rp = null;
        };
        for (let j = 0; j < nz; j++) {
          const zz = zTop - j * dz;
          const free = need(zz) < rl - 1e-6;
          if (free && !inCut) {
            // along Z outside the stock first, then in: a diagonal rapid could cross a collar in between
            if (j === 0) {
              // in the air above the part: straight in
              P.rapid(clearX, zz + 1); P.rapid(rl + ap + 0.5, zz + 1); P.feed(rl, zz + 1, t.plunge);
            } else {
              const x0 = Math.max(rl, left[j]) + 0.5;
              P.rapid(clearX, zz); P.rapid(x0, zz);
              rp = { x: x0, z: zz };
            }
            inCut = true;
          }
          if (inCut && rp && xAt(zz) <= rl + 1e-9) { P.feed(rl, rp.z - (rp.x - rl) / ramp, t.plunge); rp = null; }
          if (!free && inCut) leave(zz);
          if (inCut) left[j] = Math.min(left[j], xAt(zz));
        }
        if (inCut) leave(zEnd);
        if (rl <= minR + 1e-6) break;
      }
      // the same roughing as the control's cycle (Okuma LAP G85, Fanuc G71 type I): the finished contour
      // (nose compensated) from the face to the chuck side; only for contours that rise steadily
      if (sh.side !== 'out') ctx.cycleWhy = 'Nur für Außen-Drehmeißel';
      else {
        // the finished contour (the allowance goes to the control as U), from the (faced) front face on: in
        // front of it there is nothing for the cycle to cut. A finishing cycle (G70 / G87) follows it as it is.
        let z0 = zTop;
        while (z0 > st.modelTop + 1e-9) z0 -= dz;
        const cp = z0 >= zEnd - 1e-9 ? contour(z => Math.max(0, xmin(z, 0)), z0, zEnd) : [];
        // undercuts (grooves): the cycle (type I) only follows the hull that rises steadily towards the chuck;
        // what lies below it stays for grooving / finishing
        if (!cp.length) cp.push([st.r, zEnd]);
        let run = 0, under = 0;
        const env = cp.map(([x, z]) => { run = Math.max(run, x); under = Math.max(under, run - x); return [run, z]; });
        const sp = simplify(env);
        if (!(sp[0][0] < st.r - 1e-3)) ctx.cycleWhy = 'Nichts zu schruppen';
        else {
          if (sp[sp.length - 1][0] < st.r) sp.push([st.r, sp[sp.length - 1][1]]);
          ctx.cycle = { kind: 'rough', pts: sp, ap, u: stl, sx: st.r + 1, sz: zTop + 1, feed: t.feed, under: under > 0.01 ? under : 0 };
        }
      }
      break;
    }
    case 'tfinish': {
      const zTop = st.modelTop + 0.5;
      const sp = simplify(contour(z => Math.max(0, xmin(z)), zTop, zEnd));
      P.rapid(clearX, zTop + 1); P.rapid(sp[0][0] + 0.5, zTop + 1);
      P.feed(sp[0][0], sp[0][1], t.plunge);
      for (const [x, z] of sp.slice(1)) P.feed(x, z, t.feed);
      P.feed(P.p.x + 1, P.p.z, t.feed); P.rapid(clearX, P.p.z); P.rapid(clearX, clearZ);
      break;
    }
    case 'tgroove': {
      const tw = +t.width || 3;
      const w = Math.max(tw, +op.width || tw);
      const zc = +op.z;
      const n = Math.max(1, Math.ceil((w - tw) / (tw * 0.8)) + 1);
      if (inside) {
        // internal groove: down the bore at a safe radius, out to the groove bottom, back in
        const target = op.dia ? +op.dia / 2 : Math.max(...Array.from({ length: 20 }, (_, i) => prof.atIn(zc - w / 2 + (w * i) / 19)));
        const xs = boreClear(zc - w / 2);
        P.rapid(xs, clearZ);
        for (let k = 0; k < n; k++) {
          const z = n === 1 ? zc : zc - (w - tw) / 2 + ((w - tw) * k) / (n - 1);
          P.rapid(xs, z); P.feed(target, z, t.plunge); P.rapid(xs, z);
        }
        P.rapid(xs, clearZ);
        break;
      }
      const target = op.dia ? +op.dia / 2 : Math.min(...Array.from({ length: 20 }, (_, i) => prof.at(zc - w / 2 + (w * i) / 19)));
      for (let k = 0; k < n; k++) {
        const z = n === 1 ? zc : zc - (w - tw) / 2 + ((w - tw) * k) / (n - 1);
        P.rapid(st.r + 1, z); P.feed(target, z, t.plunge); P.rapid(st.r + 1, z);
      }
      P.rapid(clearX, P.p.z);
      break;
    }
    case 'tthread': {
      const p = +op.pitch || 1.5;
      if (inside) {
        // ISO metric internal thread: from the minor diameter D − 1.0825 P outwards to the nominal diameter
        const D = +op.majorDia || 2 * prof.atIn(+op.zStart - 0.5) + 1.0825 * p;
        const h = 0.5413 * p, n = Math.max(1, Math.round(+op.passes || 6));
        const zs = +op.zStart + 2 * p, ze = +op.zEnd;
        const xs = Math.min(boreClear(ze), D / 2 - h - 0.3);
        P.rapid(xs, clearZ);
        for (let k = 1; k <= n; k++) {
          const x = D / 2 - h + h * Math.sqrt(k / n);
          P.rapid(xs, zs); P.rapid(x, zs);
          P.thread(x, ze, t.rpm * p, p);
          P.rapid(xs, ze); P.rapid(xs, zs);
        }
        P.rapid(xs, clearZ);
        ctx.cycle = { kind: 'thread', inside: true, sx: xs, sz: zs, xEnd: D / 2, ze, h, d1: h * Math.sqrt(1 / n), n, pitch: p };
        break;
      }
      const D = +op.majorDia || 2 * prof.at(+op.zStart - 0.5);
      const h = 0.6134 * p; // ISO metric external thread depth
      const n = Math.max(1, Math.round(+op.passes || 6));
      const zs = +op.zStart + 2 * p, ze = +op.zEnd;
      for (let k = 1; k <= n; k++) {
        const x = D / 2 - h * Math.sqrt(k / n); // equal chip area per pass
        P.rapid(D / 2 + 1, zs); P.rapid(x, zs);
        P.thread(x, ze, t.rpm * p, p);
        P.rapid(D / 2 + 1, ze); P.rapid(D / 2 + 1, zs);
      }
      P.rapid(clearX, P.p.z);
      ctx.cycle = { kind: 'thread', inside: false, sx: D / 2 + 1, sz: zs, xEnd: D / 2 - h, ze, h, d1: h * Math.sqrt(1 / n), n, pitch: p };
      break;
    }
    case 'tdrill': {
      // deepest tip position at which the drill (cone and body) stays inside the bore on the axis
      const R = sh.R, zFloor = op.zEnd != null && op.zEnd !== '' ? +op.zEnd : st.modelBottom - R / Math.tan((((+t.angle || 118) / 2) * Math.PI) / 180) - 1;
      const okAt = z => {
        for (let d = 0; d <= Math.min(sh.hi, st.top - z) + 1e-9; d += prof.dz) if (sh.at(0, d) > prof.atIn(z + d) - stl + 1e-9) return false;
        return true;
      };
      let zb = null;
      if (op.zEnd != null && op.zEnd !== '') zb = zFloor;
      else for (let z = st.modelTop; z >= zFloor - 1e-9; z -= prof.dz) { if (!okAt(z)) break; zb = z; }
      if (zb == null || zb > st.modelTop - 0.5) throw new Error('Keine Bohrung auf der Drehachse (Teil ist in der Mitte voll) – Ende Z angeben');
      const pk = +op.peck || 0, zIn = st.top + 1;
      P.rapid(0, clearZ); P.rapid(0, zIn);
      for (let cur = zIn; cur > zb + 1e-9;) {
        const nz = pk > 0 ? Math.max(zb, cur - pk) : zb;
        P.feed(0, nz, t.plunge || t.feed);
        cur = nz;
        // chip breaking: out of the hole, back down to just above the last depth
        if (cur > zb + 1e-9) { P.rapid(0, zIn); P.rapid(0, cur + 0.5); }
      }
      P.rapid(0, clearZ);
      break;
    }
    case 'tbore': {
      const h = op.startDia ? +op.startDia / 2 : ctx.pre || 0;
      if (!(h > 0)) throw new Error('Keine Vorbohrung – zuerst „Bohren (Drehachse)“ oder einen Vorbohr-Ø angeben');
      if (sh.bar && sh.bar.D > 2 * h - sh.bar.clr + 1e-6) throw new Error(`Bohrstange Ø${sh.bar.D} passt nicht in die Vorbohrung Ø${+(2 * h).toFixed(2)}`);
      // largest radius the tip may take at z: the edge stays inside the finished bore (− allowance) everywhere
      const ximax = (z, extra) => {
        let m = Infinity;
        for (let d = 0; d <= sh.hi + 1e-9; d += stepD) m = Math.min(m, prof.atIn(z + d) - extra - sh.at(0, d));
        return m;
      };
      const ap = +op.stepdown || 1, zIn = st.top + 1, back = Math.min(0.3, ap / 2);
      const zLow = op.zEnd != null && op.zEnd !== '' ? +op.zEnd : st.modelBottom - 1;
      const stlR = stl + 0.2;
      // roughing: rings from the hole outwards, each as deep as the bore allows from the face down
      let prev = h;
      // (sampled below the face: right at the face only the nose reaches into the part)
      const zS = st.modelTop - Math.min(sh.hi, (st.modelTop - zLow) / 2);
      // roughing reaches only what is open from the face: as far out as the bore just below the face
      const vS = ximax(zS, stlR), maxX = Math.max(h, Number.isFinite(vS) ? vS : h);
      for (let rl = Math.min(h + ap, maxX); rl > h + 1e-6; rl = Math.min(rl + ap, maxX)) {
        let zf = null;
        for (let z = st.modelTop; z >= zLow - 1e-9; z -= prof.dz) { if (!(ximax(z, stlR) >= rl - 1e-6)) break; zf = z; }
        if (zf == null) break;
        const xe = Math.max(0, prev - back);
        P.rapid(xe, clearZ); P.rapid(xe, zIn); P.feed(rl, zIn, t.plunge);
        P.feed(rl, zf, t.feed); P.feed(rl - back, zf + back, t.feed); P.rapid(rl - back, zIn);
        prev = rl;
        if (rl >= maxX - 1e-6) break;
      }
      // finishing along the bore, down to the bottom and in to the drilled hole
      const pts = [];
      for (let z = st.modelTop + 0.5; z >= zLow - 1e-9; z -= prof.dz) {
        const x = ximax(z, stl);
        if (!Number.isFinite(x)) continue;
        if (x <= h + 1e-6) {
          // end where the contour meets the drilled hole
          const q = pts[pts.length - 1];
          pts.push(q && q[0] > h ? [h, q[1] + ((z - q[1]) * (q[0] - h)) / (q[0] - x)] : [h, z]);
          break;
        }
        pts.push([x, z]);
      }
      if (pts.length > 1) {
        const sp = simplify(pts), xe = Math.max(0, h - back);
        P.rapid(xe, clearZ); P.rapid(xe, sp[0][1] + 0.5);
        P.feed(sp[0][0], sp[0][1], t.plunge);
        for (const [x, z] of sp.slice(1)) P.feed(x, z, t.feed);
        P.feed(Math.max(0, P.p.x - back), P.p.z + back, t.feed);
      }
      P.rapid(P.p.x, clearZ);
      break;
    }
    case 'tpart': {
      if (inside) throw new Error('Abstechen braucht einen Außen-Stechmeißel');
      const tw = +t.width || 3;
      const z = op.z != null && op.z !== '' ? +op.z : st.modelBottom - tw / 2;
      P.rapid(st.r + 1, z); P.feed(-0.5, z, t.plunge); P.rapid(st.r + 1, z);
      break;
    }
    case 'tlive': {
      // drilling with a driven tool: axial (along Z into the face, off centre) or radial (along X into the
      // diameter); the spindle positions the part as C axis
      const radial = op.dir === 'radial', R = sh.R, angs = liveAngles(op);
      const depth = +op.depth, pk = +op.peck || 0, f = t.plunge || t.feed;
      if (!angs.length) throw new Error('Keine Bohrposition – Anzahl oder Winkel angeben');
      if (!(depth > 0)) throw new Error('Bohrtiefe angeben');
      const dir = radial ? 'rad' : 'ax';
      // a hole from `from` to `to` along the feed axis (pos = the value of the other axis)
      const hole = (c, pos, from, to, surface) => {
        const at = v => (radial ? [v, c, pos] : [pos, c, v]);
        P.live('r', ...at(from), dir);
        for (let cur = from; cur > to + 1e-9;) {
          const nx = pk > 0 ? Math.max(to, Math.min(cur, surface) - pk) : to; // the first peck counts from the surface
          P.live('f', ...at(nx), dir, f);
          cur = nx;
          if (cur > to + 1e-9) { P.live('r', ...at(from), dir); P.live('r', ...at(cur + 0.5), dir); }
        }
        P.live('r', ...at(from), dir);
      };
      if (radial) {
        if (op.z == null || op.z === '') throw new Error('Position Z der Querbohrung angeben');
        const z = +op.z;
        if (z > st.modelTop - R + 1e-6 || z < st.modelBottom + R - 1e-6) throw new Error('Position Z liegt nicht am Teil');
        // surface: the largest radius under the drill; before any turning the stock is still there
        let surf = 0;
        for (let d = -R; d <= R + 1e-9; d += prof.dz) surf = Math.max(surf, prof.at(z + d));
        if (!ctx.turned) surf = Math.max(surf, st.r);
        if (depth > 2 * surf + 1) throw new Error(`Bohrtiefe ${depth} mm ist größer als der Durchmesser ${+(2 * surf).toFixed(2)} mm`);
        const rIn = surf + 1;
        P.live('r', clearX, angs[0], clearZ, dir);
        P.live('r', clearX, angs[0], z, dir);
        for (const c of angs) hole(c, z, rIn, surf - depth, surf);
        P.live('r', clearX, angs[angs.length - 1], z, dir);
        P.live('r', clearX, angs[angs.length - 1], clearZ, dir);
      } else {
        const rad = (+op.pitchDia || 0) / 2;
        if (!(rad > 0)) throw new Error('Lochkreis-Ø angeben (Bohrungen auf der Drehachse: „Bohren“)');
        if (rad + R > st.r + 1e-6) throw new Error('Lochkreis liegt außerhalb des Rohteils');
        const zIn = st.top + 1;
        P.live('r', rad, angs[0], clearZ, dir);
        for (const c of angs) hole(c, rad, zIn, st.modelTop - depth, st.modelTop);
        P.live('r', rad, angs[angs.length - 1], clearZ, dir);
      }
      break;
    }
    case 'tpocket': {
      // pocket on the face with a driven end mill along Z: offset rings from the inside out, ramping down the
      // innermost ring, the rings of a level linked without lifting (X and C together: polar interpolation)
      const R = Math.max(0.05, (+t.dia || 0) / 2), depth = +op.depth;
      if (!(depth > 0)) throw new Error('Tiefe angeben');
      const G = ctx.curves?.(op, R);
      if (!G) throw new Error('Keine Skizze als Geometrie gewählt');
      if (G.kind !== 'face') throw new Error('Die Skizze der Tasche muss quer zur Drehachse liegen (auf der Planfläche)');
      const zLo = st.modelTop - depth;
      if (zLo < st.modelBottom - 1e-6) throw new Error('Tiefe ist größer als das Teil lang ist');
      const ap = +op.stepdown > 0 ? +op.stepdown : Math.max(0.1, R), nz = Math.max(1, Math.ceil(depth / ap - 1e-9));
      const rampDeg = op.rampType === 'plunge' ? 0 : +op.ramp > 0 ? +op.ramp : 3, tanR = Math.tan((rampDeg * Math.PI) / 180);
      const zIn = st.top + 2, len = l => l.reduce((a, q, i) => a + Math.hypot(l[(i + 1) % l.length][0] - q[0], l[(i + 1) % l.length][1] - q[1]), 0);
      // a loop started at its point closest to (x, y)
      const startAt = (l, x, y) => {
        let bi = 0, bu = 0, bd = Infinity;
        for (let i = 0; i < l.length; i++) {
          const a = l[i], b = l[(i + 1) % l.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
          const u = L2 > 1e-18 ? Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / L2)) : 0, d = (a[0] + u * dx - x) ** 2 + (a[1] + u * dy - y) ** 2;
          if (d < bd - 1e-12) { bd = d; bi = i; bu = u; }
        }
        const a = l[bi], b = l[(bi + 1) % l.length];
        if (bu < 1e-6) return [...l.slice(bi), ...l.slice(0, bi)];
        if (bu > 1 - 1e-6) { const j = (bi + 1) % l.length; return [...l.slice(j), ...l.slice(0, j)]; }
        return [[a[0] + bu * (b[0] - a[0]), a[1] + bu * (b[1] - a[1])], ...l.slice(bi + 1), ...l.slice(0, bi + 1)];
      };
      P.rapid(clearX, zIn);
      let cur = null; // [x, y, z] while the cutter is down
      const lift = () => { if (cur) { P.polar('r', cur[0], cur[1], zIn); cur = null; } };
      for (let k = 1; k <= nz; k++) {
        const z = st.modelTop - (depth * k) / nz, zPrev = st.modelTop - (depth * (k - 1)) / nz;
        for (const c of G.curves) {
          const loop = cur ? startAt(c.pts, cur[0], cur[1]) : c.pts, [sx, sy] = loop[0];
          const near = cur && Math.abs(cur[2] - z) < 1e-9 && Math.hypot(cur[0] - sx, cur[1] - sy) <= G.so + 0.01;
          if (near) P.polar('f', sx, sy, z, t.feed, 'groove');
          else {
            lift();
            // down to just above what is cut already, then along the loop on a ramp (or straight down)
            const zFrom = (k === 1 ? st.top : zPrev) + 0.5;
            P.polar('r', sx, sy, zIn); P.polar('r', sx, sy, zFrom);
            const L = len(loop);
            if (rampDeg > 0 && L > 1e-6) {
              const turns = Math.min(50, Math.max(1, Math.ceil((zFrom - z) / tanR / L))), total = turns * L;
              let w = 0;
              for (let q = 0; q < turns; q++) for (let i = 1; i <= loop.length; i++) {
                const a = loop[i - 1], b = loop[i % loop.length];
                w += Math.hypot(b[0] - a[0], b[1] - a[1]);
                P.polar('f', b[0], b[1], zFrom - (zFrom - z) * (w / total), t.feed, 'groove');
              }
            } else P.polar('f', sx, sy, z, t.plunge || t.feed, 'groove');
          }
          for (let i = 1; i <= loop.length; i++) P.polar('f', loop[i % loop.length][0], loop[i % loop.length][1], z, t.feed, 'groove');
          cur = [sx, sy, z];
        }
        lift();
      }
      P.rapid(clearX, zIn);
      break;
    }
    case 'tcontour': {
      // sketch curves on the face with a driven end mill along Z (X and C together: polar interpolation)
      const R = Math.max(0.05, (+t.dia || 0) / 2), depth = +op.depth;
      if (!(depth > 0)) throw new Error('Tiefe angeben');
      const G = ctx.curves?.(op, R);
      if (!G) throw new Error('Keine Skizze als Geometrie gewählt');
      if (G.kind !== 'face') throw new Error('Die Skizze muss quer zur Drehachse liegen (auf der Planfläche) – für den Umfang „Kontur Mantelfläche“');
      const zTop = Math.min(st.top, Math.max(G.z, st.modelTop)), zLo = st.modelTop - depth;
      if (zLo < st.modelBottom - 1e-6) throw new Error('Tiefe ist größer als das Teil lang ist');
      const ap = +op.stepdown > 0 ? +op.stepdown : depth, nz = Math.max(1, Math.ceil((st.modelTop - zLo) / ap - 1e-9));
      const zIn = st.top + 2;
      void zTop;
      P.rapid(clearX, zIn);
      for (const c of G.curves) {
        const pts = c.closed ? [...c.pts, c.pts[0]] : c.pts;
        if (pts.some(q => Math.hypot(q[0], q[1]) > st.r + R + 20)) throw new Error('Die Kontur liegt weit außerhalb des Rohteils');
        for (let k = 1; k <= nz; k++) {
          const z = st.modelTop - ((st.modelTop - zLo) * k) / nz;
          // open curves go back and forth, closed ones always the same way round
          const seq = !c.closed && k % 2 === 0 ? pts.slice().reverse() : pts;
          if (k === 1 || c.closed) { if (k === 1) { P.polar('r', seq[0][0], seq[0][1], zIn); P.polar('r', seq[0][0], seq[0][1], st.top + 1); } }
          P.polar('f', seq[0][0], seq[0][1], z, t.plunge || t.feed, 'groove');
          for (const q of seq.slice(1)) P.polar('f', q[0], q[1], z, t.feed, 'groove');
        }
        P.polar('r', P.m[P.m.length - 1].x, P.m[P.m.length - 1].y, zIn);
      }
      P.rapid(clearX, zIn);
      break;
    }
    case 'twrap': {
      // sketch curves wrapped onto the diameter with a driven end mill pointing at the axis: Z and C together
      const R = Math.max(0.05, (+t.dia || 0) / 2), depth = +op.depth;
      if (!(depth > 0)) throw new Error('Tiefe angeben');
      const G = ctx.curves?.(op, R);
      if (!G) throw new Error('Keine Skizze als Geometrie gewählt');
      if (G.kind !== 'wrap') throw new Error('Die Skizze muss längs zur Drehachse liegen (sie wird auf den Umfang gewickelt) – für die Stirnseite „Kontur Planfläche“');
      const zs = G.curves.flatMap(c => c.pts.map(q => q[1])), zA = Math.max(...zs), zB = Math.min(...zs);
      if (zB < st.modelBottom - 1e-6 || zA > st.top + R + 1e-6) throw new Error('Die Kontur liegt in Z nicht am Teil');
      let surf = 0;
      for (let z = zB - R; z <= zA + R + 1e-9; z += prof.dz) surf = Math.max(surf, prof.at(Math.max(st.modelBottom + prof.dz, Math.min(z, st.modelTop - prof.dz))));
      if (!ctx.turned) surf = Math.max(surf, st.r);
      const Rw = +op.wrapDia > 0 ? +op.wrapDia / 2 : surf;
      if (depth > surf) throw new Error(`Tiefe ${depth} mm ist größer als der Radius ${+surf.toFixed(2)} mm`);
      const ap = +op.stepdown > 0 ? +op.stepdown : Math.max(0.1, R), n = Math.max(1, Math.ceil(depth / ap - 1e-9)), rIn = surf + 1;
      const ang = s => +(G.phi + ((s / Rw) * 180) / Math.PI).toFixed(4);
      ctx.cyl = Rw;
      let first = true;
      for (const c of G.curves) {
        const pts = c.closed ? [...c.pts, c.pts[0]] : c.pts;
        for (let k = 1; k <= n; k++) {
          const x = surf - (depth * k) / n, seq = !c.closed && k % 2 === 0 ? pts.slice().reverse() : pts;
          if (k === 1) {
            if (first) P.live('r', clearX, ang(seq[0][0]), clearZ, 'rad');
            P.live('r', clearX, ang(seq[0][0]), seq[0][1], 'rad');
            P.live('r', rIn, ang(seq[0][0]), seq[0][1], 'rad');
            first = false;
          }
          P.live('f', x, ang(seq[0][0]), seq[0][1], 'rad', t.plunge || t.feed);
          for (const q of seq.slice(1)) { P.live('f', x, ang(q[0]), q[1], 'rad', t.feed); P.m[P.m.length - 1].cyl = true; }
        }
        const e = P.m[P.m.length - 1];
        P.live('r', clearX, e.c, e.z, 'rad');
      }
      { const e = P.m[P.m.length - 1]; P.live('r', clearX, e.c, clearZ, 'rad'); }
      break;
    }
    case 'twpocket': {
      // pocket on the diameter: the closed curves of a sketch along the axis, wrapped onto the circumference and
      // cleared ring by ring from the inside out with a driven end mill pointing at the axis (Z and C together)
      const R = Math.max(0.05, (+t.dia || 0) / 2), depth = +op.depth;
      if (!(depth > 0)) throw new Error('Tiefe angeben');
      const G = ctx.curves?.(op, R);
      if (!G) throw new Error('Keine Skizze als Geometrie gewählt');
      if (G.kind !== 'wrap') throw new Error('Die Skizze der Tasche muss längs zur Drehachse liegen (sie wird auf den Umfang gewickelt) – für die Stirnseite „Tasche Planfläche“');
      const zs = G.curves.flatMap(c => c.pts.map(q => q[1])), zA = Math.max(...zs), zB = Math.min(...zs);
      if (zB < st.modelBottom - 1e-6 || zA > st.top + R + 1e-6) throw new Error('Die Tasche liegt in Z nicht am Teil');
      let surf = 0;
      for (let z = zB - R; z <= zA + R + 1e-9; z += prof.dz) surf = Math.max(surf, prof.at(Math.max(st.modelBottom + prof.dz, Math.min(z, st.modelTop - prof.dz))));
      if (!ctx.turned) surf = Math.max(surf, st.r);
      const Rw = +op.wrapDia > 0 ? +op.wrapDia / 2 : surf;
      if (depth > surf) throw new Error(`Tiefe ${depth} mm ist größer als der Radius ${+surf.toFixed(2)} mm`);
      const ap = +op.stepdown > 0 ? +op.stepdown : Math.max(0.1, R), n = Math.max(1, Math.ceil(depth / ap - 1e-9)), rIn = surf + 1;
      const ang = s => +(G.phi + ((s / Rw) * 180) / Math.PI).toFixed(4);
      ctx.cyl = Rw;
      let first = true, at = null; // at: [s, z] while the cutter is down
      const up = () => { if (at) { const e = P.m[P.m.length - 1]; P.live('r', rIn, e.c, e.z, 'rad'); at = null; } };
      // entering the material: down a ramp along the ring ("Rampenwinkel"), or straight with "Eintauchen: gerade"
      const rampDeg = op.rampType === 'plunge' ? 0 : +op.ramp > 0 ? +op.ramp : 3, tanR = Math.tan((rampDeg * Math.PI) / 180);
      const cut = (x, q, f) => { P.live('f', x, ang(q[0]), q[1], 'rad', f); P.m[P.m.length - 1].cyl = true; };
      for (let k = 1; k <= n; k++) {
        const x = surf - (depth * k) / n;
        for (const c of G.curves) {
          const pts = [...c.pts, c.pts[0]], [s0, z0] = pts[0];
          if (at && Math.hypot(at[0] - s0, at[1] - z0) <= G.so + 0.01) { P.live('f', x, ang(s0), z0, 'rad', t.feed); P.m[P.m.length - 1].cyl = true; }
          else {
            up();
            if (first) P.live('r', clearX, ang(s0), clearZ, 'rad');
            P.live('r', first ? clearX : rIn, ang(s0), z0, 'rad');
            if (first) P.live('r', rIn, ang(s0), z0, 'rad');
            first = false;
            if (tanR > 1e-6) {
              // down to the level above (the surface for the first level), then along the ring while going deeper
              const m = pts.length - 1, fr = t.plunge || t.feed;
              let xc = surf - (depth * (k - 1)) / n, i = 0, guard = 0;
              P.live('f', xc, ang(s0), z0, 'rad', fr);
              while (xc > x + 1e-9 && guard++ < 20000) {
                const a = pts[i % m], b = pts[(i % m) + 1], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
                i++;
                if (L < 1e-9) continue;
                const drop = L * tanR;
                if (xc - drop >= x - 1e-9) { xc = Math.max(x, xc - drop); cut(xc, b, fr); }
                else { const u = (xc - x) / drop; xc = x; cut(x, [a[0] + u * (b[0] - a[0]), a[1] + u * (b[1] - a[1])], fr); cut(x, b, t.feed); }
              }
              // once around at full depth: this also clears the wedge the ramp has left
              for (let j = 1; j <= m; j++) cut(x, pts[(i + j) % m], t.feed);
              at = pts[i % m];
              continue;
            }
            P.live('f', x, ang(s0), z0, 'rad', t.plunge || t.feed);
          }
          for (const q of pts.slice(1)) { P.live('f', x, ang(q[0]), q[1], 'rad', t.feed); P.m[P.m.length - 1].cyl = true; }
          at = pts[pts.length - 1];
        }
        up();
      }
      { const e = P.m[P.m.length - 1]; P.live('r', clearX, e.c, e.z, 'rad'); P.live('r', clearX, e.c, clearZ, 'rad'); }
      break;
    }
    case 'tslot': {
      // keyway along Z with a driven end mill pointing at the axis (C fixed per slot)
      const R = Math.max(0.05, (+t.dia || 0) / 2), angs = liveAngles(op), depth = +op.depth;
      if (!angs.length) throw new Error('Keine Nut – Anzahl oder Winkel angeben');
      if (!(depth > 0)) throw new Error('Nuttiefe angeben');
      if (op.zStart == null || op.zStart === '' || op.zEnd == null || op.zEnd === '') throw new Error('Start Z und Ende Z der Nut angeben');
      const zA = Math.max(+op.zStart, +op.zEnd), zB = Math.min(+op.zStart, +op.zEnd);
      if (zB < st.modelBottom - 1e-6 || zA > st.top + 1e-6) throw new Error('Nut liegt nicht am Teil');
      let surf = 0;
      for (let z = zB - R; z <= zA + R + 1e-9; z += prof.dz) surf = Math.max(surf, prof.at(Math.min(z, st.modelTop - prof.dz)));
      if (!ctx.turned) surf = Math.max(surf, st.r);
      if (depth > surf) throw new Error(`Nuttiefe ${depth} mm ist größer als der Radius ${+surf.toFixed(2)} mm`);
      // open towards the face: the cutter comes in from in front of the face, otherwise it plunges at the start
      const open = zA >= st.modelTop - 1e-6, zIn = open ? st.top + R + 1 : zA, rIn = surf + 1;
      const ap = +op.stepdown > 0 ? +op.stepdown : Math.max(0.1, R), n = Math.max(1, Math.ceil(depth / ap - 1e-9));
      P.live('r', clearX, angs[0], clearZ, 'rad');
      for (const c of angs) {
        P.live('r', clearX, c, zIn, 'rad');
        P.live('r', rIn, c, zIn, 'rad');
        let at = zIn;
        for (let k = 1; k <= n; k++) {
          const x = surf - (depth * k) / n, to = at === zIn ? zB : zIn;
          if (open && at === zIn) P.live('r', x, c, at, 'rad'); else P.live('f', x, c, at, 'rad', t.plunge || t.feed);
          P.live('f', x, c, to, 'rad', t.feed);
          at = to;
        }
        P.live('r', clearX, c, at, 'rad');
      }
      P.live('r', clearX, angs[angs.length - 1], clearZ, 'rad');
      break;
    }
    case 'tflat': {
      // flats at the end of the part (wrench flats, square, hexagon) with a driven end mill along Z: the cutter
      // passes the flat on a straight line across the axis (X and C together: polar interpolation)
      const R = Math.max(0.05, (+t.dia || 0) / 2), angs = liveAngles(op), d = (+op.width || 0) / 2, len = +op.length;
      if (!angs.length) throw new Error('Keine Fläche – Anzahl oder Winkel angeben');
      if (!(d > 0)) throw new Error('Schlüsselweite angeben');
      if (!(len > 0)) throw new Error('Länge der Flächen angeben');
      const zLo = st.modelTop - len;
      if (zLo < st.modelBottom - 1e-6) throw new Error('Flächen sind länger als das Teil');
      let surf = 0;
      for (let z = zLo; z <= st.modelTop + 1e-9; z += prof.dz) surf = Math.max(surf, prof.at(Math.min(z, st.modelTop - prof.dz)));
      if (!ctx.turned) surf = Math.max(surf, st.r);
      if (d >= surf - 1e-6) throw new Error(`Schlüsselweite ${2 * d} mm ist nicht kleiner als der Durchmesser ${+(2 * surf).toFixed(2)} mm`);
      const ae = +op.stepover > 0 ? +op.stepover : Math.max(0.1, 0.8 * R), nr = Math.max(1, Math.ceil((surf - d) / ae - 1e-9));
      const ap = +op.stepdown > 0 ? +op.stepdown : len, nz = Math.max(1, Math.ceil(len / ap - 1e-9));
      const zIn = st.top + 2, far = surf + R + 1;
      P.rapid(clearX, zIn);
      for (const c of angs) {
        const a = (c * Math.PI) / 180, ux = Math.cos(a), uy = Math.sin(a);
        P.yc = c;
        for (let kz = 1; kz <= nz; kz++) {
          const z = st.modelTop - (len * kz) / nz;
          for (let kr = 1; kr <= nr; kr++) {
            // tool centre line at distance q from the axis, from outside the round to outside the round
            const q = surf - ((surf - d) * kr) / nr + R, e = Math.sqrt(Math.max(1, far * far - q * q));
            const pt = sgn => [q * ux - sgn * e * uy, q * uy + sgn * e * ux];
            P.polar('r', ...pt(-1), zIn);
            P.polar('r', ...pt(-1), z);
            P.polar('f', ...pt(1), z, t.feed, 'flat');
            P.polar('r', ...pt(1), zIn);
          }
        }
      }
      P.rapid(clearX, zIn);
      break;
    }
  }
  P.rapid(clearX, clearZ);
  return P.m;
}

// Angles (degrees) of the holes of a driven-tool operation: an explicit list ("0; 90; 200") or count + start angle.
export function liveAngles(op) {
  const list = String(op.angles ?? '').split(/[;\s]+/).map(v => v.replace(',', '.')).filter(v => v !== '').map(Number).filter(Number.isFinite);
  if (list.length) return list.map(a => +(((a % 360) + 360) % 360).toFixed(4));
  const n = Math.max(0, Math.min(360, Math.round(+op.count || 0))), a0 = +op.startAngle || 0;
  return Array.from({ length: n }, (_, i) => +((((a0 + (360 * i) / n) % 360) + 360) % 360).toFixed(4));
}

const TOOL_OK = { tface: ['turn'], trough: ['turn'], tfinish: ['turn'], tgroove: ['groove'], tthread: ['tthread'], tpart: ['groove'], tdrill: ['drill', 'center', 'spot'], tbore: ['turnbore'], tlive: ['drill', 'center', 'spot'], tslot: ['flat', 'ball'], tflat: ['flat'], tcontour: ['flat', 'ball', 'chamfer'], twrap: ['flat', 'ball', 'chamfer'], tpocket: ['flat'], twpocket: ['flat'] };

export function generateTurnSetup(project, bodies, setup, machine, rapid, hooks = {}) {
  const results = new Map();
  const box = new THREE.Box3();
  for (const b of bodies) { b.geometry.computeBoundingBox(); box.union(b.geometry.boundingBox); }
  const ops = project.cam.ops.filter(o => o.setup === setup.id);
  if (box.isEmpty()) return { stock: null, results, ops, kind: 'turn', T: new THREE.Matrix4(), machine, error: 'Kein Körper vorhanden.' };
  const prof = turnProfile(bodies, box);
  const stock = turnStock(box, setup, prof);
  // radius of the hole drilled on the axis so far (start of internal turning)
  let pre = 0, turned = false;
  for (const op of ops) {
    if (op.enabled === false) { results.set(op.id, { moves: [], disabled: true }); continue; }
    try {
      if (op.type === 'manual' && hooks.manual) { results.set(op.id, hooks.manual(op)); continue; }
      const t0 = project.cam.tools.find(x => x.id === op.tool);
      if (!t0) throw new Error('Kein Werkzeug gewählt');
      // cutting data of the operation dialog (empty = from the tool)
      const cut = op.cut || {}, cv = k => (cut[k] != null && Number.isFinite(+cut[k]) ? +cut[k] : null);
      const t = { ...t0, ...(cv('rpm') != null ? { rpm: cv('rpm') } : {}), ...(cv('feed') != null ? { feed: cv('feed') } : {}), ...(cv('plunge') != null ? { plunge: cv('plunge') } : {}) };
      if (TOOL_OK[op.type] && !TOOL_OK[op.type].includes(t.kind || t.type)) throw new Error(`Passendes Werkzeug wählen: ${TOOL_OK[op.type].map(k => TURN_TOOL_TYPES[k] || { flat: 'Schaftfräser', ball: 'Kugelfräser', center: 'Zentrierbohrer', spot: 'NC-Anbohrer' }[k]).filter(Boolean).join(' / ')}`);
      const tctx = { pre, turned, curves: hooks.curves };
      const moves = genTurnOp(op, t, stock, prof, tctx);
      if (op.type === 'tdrill') pre = Math.max(pre, (+t.dia || 0) / 2);
      if (op.type === 'trough' || op.type === 'tfinish') turned = true;
      let len = 0, time = 0;
      for (let i = 1; i < moves.length; i++) {
        const a = moves[i - 1], b = moves[i];
        const d = Math.hypot(b.x - a.x, (b.y || 0) - (a.y || 0), b.z - a.z);
        len += d;
        time += (d / (b.t === 'r' ? rapid : b.f)) * 60;
      }
      results.set(op.id, { moves, tool: t, length: len, time, heights: { top: stock.top, bottom: stock.bottom }, ...(op.type === 'tlive' ? { live: op.dir === 'radial' ? 'rad' : 'ax' } : op.type === 'tslot' ? { live: 'rad' } : op.type === 'tflat' || op.type === 'tcontour' || op.type === 'tpocket' ? { live: 'ax', polar: true } : (op.type === 'twrap' || op.type === 'twpocket') ? { live: 'rad', cyl: tctx.cyl } : {}), ...(tctx.cycle || tctx.cycleWhy ? { turnCycle: tctx.cycle || null, turnCycleWhy: tctx.cycleWhy || null } : {}) });
    } catch (err) {
      results.set(op.id, { error: err.message, moves: [] });
    }
  }
  return { stock, results, ops, kind: 'turn', T: new THREE.Matrix4(), machine, profile: prof };
}

// Turning simulation: the stock is a radius profile r(z), shown as a solid of revolution.
export class TurnSim {
  constructor(parent) {
    this.group = new THREE.Group();
    parent.add(this.group);
    this.mat = new THREE.MeshStandardMaterial({ color: 0xc9a86a, roughness: 0.6, metalness: 0.2, side: THREE.DoubleSide });
    this.cmp = null;
    this.cmpTol = 0.1;
    this.holeMat = new THREE.MeshStandardMaterial({ color: 0x3a2f1e, roughness: 0.9, metalness: 0.1 });
  }
  build(stock) {
    this.dispose();
    this.stock = stock;
    this.S = new LatheStock(stock);
    this.holes = new Map();
    this.flats = new Map();
    this.marks = new Map();
    // what driven radial cutters take away: the radius left per place around the part, rc[row * NT + column]
    // (made with the first such cut); rows: the range of rows it has touched
    this.NT = Math.max(180, Math.min(720, Math.ceil((2 * Math.PI * stock.r) / 0.25)));
    this.rc = null;
    this.rows = [Infinity, -1];
    // what driven cutters along the axis take away, seen from the face: the height left per place,
    // zc[ring * NT + column] with rings of the width dr from the axis outwards; zmin: the deepest of them
    this.NR = Math.max(40, Math.min(300, Math.ceil(stock.r / 0.12)));
    this.dr = stock.r / this.NR;
    this.zc = null;
    this.zmin = Infinity;
    this.cmp = null;
    this.dirty = true;
    this.update();
  }
  reset() { if (this.S) { this.S = new LatheStock(this.stock); this.holes = new Map(); this.flats = new Map(); this.marks = new Map(); this.rc = null; this.rows = [Infinity, -1]; this.zc = null; this.zmin = Infinity; this.dirty = true; this.update(); } }
  /**
   * Comparison with the finished part ("Vergleich"): rad[row * NT + column] = radius of the part around the axis,
   * top[ring * NT + column] = its height seen from the face (-Infinity: no part there), threads = [{ z0, z1,
   * depth }] for threads that are only drawn on the model (cutting them is not "too deep"). null switches it off.
   */
  setCompare(part) {
    this.cmp = null;
    if (part && this.S && part.rad?.length === this.S.n * this.NT && part.top?.length === (this.NR + 1) * this.NT) {
      // target band per place: next to a shoulder the place may lie on either side of it on this grid, so
      // anything between the lower and the upper neighbour counts as "at size"
      const band = (T, rows, NT) => {
        const lo = new Float32Array(T.length), hi = new Float32Array(T.length);
        for (let i = 0; i < rows; i++) for (let j = 0; j < NT; j++) {
          let a = Infinity, b = -Infinity;
          for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= rows) continue; for (let dj = -1; dj <= 1; dj++) { const t = T[ii * NT + ((j + dj + NT) % NT)]; if (t < a) a = t; if (t > b) b = t; } }
          lo[i * NT + j] = a; hi[i * NT + j] = b;
        }
        return { lo, hi };
      };
      const R = band(part.rad, this.S.n, this.NT), Tp = band(part.top, this.NR + 1, this.NT), bot = this.stock.bottom, dz = this.S.dz;
      for (const th of part.threads || []) {
        const i0 = Math.max(0, Math.floor((th.z0 - bot) / dz) - 1), i1 = Math.min(this.S.n - 1, Math.ceil((th.z1 - bot) / dz) + 1);
        for (let i = i0; i <= i1; i++) for (let j = 0; j < this.NT; j++) R.lo[i * this.NT + j] = Math.max(0, R.lo[i * this.NT + j] - th.depth);
      }
      this.cmp = { rLo: R.lo, rHi: R.hi, tLo: Tp.lo, tHi: Tp.hi };
    }
    this.dirty = true;
    this.update();
  }
  /** Share of the compared places: at size / material left / too deep, and the deepest gouge (null: off). */
  compareStats() {
    if (!this.cmp || !this.stat) return null;
    const { ok, left, gouge, worst } = this.stat, n = ok + left + gouge;
    return n ? { ok: ok / n, left: left / n, gouge: gouge / n, worst } : null;
  }
  // driven cutter along the axis (flat end, radius R) moving from a to b across the face
  faceCut(a, b, R, t0, t1) {
    const NT = this.NT, NR = this.NR, dr = this.dr, dth = (2 * Math.PI) / NT, top = this.stock.top;
    if (!this.zc) this.zc = new Float32Array((NR + 1) * NT).fill(Infinity);
    const zc = this.zc, L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), steps = Math.max(1, Math.ceil((L * (t1 - t0)) / Math.max(0.15, R * 0.2)));
    let changed = false;
    for (let k = 0; k <= steps; k++) {
      const t = t0 + ((t1 - t0) * k) / steps, x = a.x + (b.x - a.x) * t, y = a.y + (b.y - a.y) * t, z = a.z + (b.z - a.z) * t;
      if (!(z < top - 1e-6)) continue;
      const d = Math.hypot(x, y), phi = Math.atan2(y, x);
      const i0 = Math.max(0, Math.floor((d - R) / dr)), i1 = Math.min(NR, Math.ceil((d + R) / dr));
      for (let ir = i0; ir <= i1; ir++) {
        const r = ir * dr;
        let j0, j1;
        if (r + d <= R || r < 1e-9) { if (d > R) continue; j0 = 0; j1 = NT - 1; }
        else if (d < 1e-9) continue;
        else {
          const cs = (r * r + d * d - R * R) / (2 * r * d);
          if (cs > 1) continue;
          const h = Math.acos(Math.max(-1, cs));
          j0 = Math.ceil((phi - h) / dth); j1 = Math.floor((phi + h) / dth);
        }
        for (let j = j0; j <= j1; j++) {
          const q = ir * NT + (((j % NT) + NT) % NT);
          if (z < zc[q] - 1e-4) { zc[q] = z; changed = true; if (z < this.zmin) this.zmin = z; }
        }
      }
    }
    if (changed) this.dirty = true;
  }
  /** Height left at the place (x, y) seen from the face: the turned profile, less what driven cutters took. */
  topAt(x, y) {
    const { n, dz, ro, ri } = this.S, r = Math.hypot(x, y);
    let t = -Infinity;
    for (let i = n - 1; i >= 0; i--) if (r < ro[i] - 1e-6 && (r > ri[i] + 1e-6 || ri[i] < 1e-6) && ro[i] > ri[i] + 1e-6) { t = this.stock.bottom + i * dz; break; }
    if (!this.zc) return t;
    const ir = Math.max(0, Math.min(this.NR, Math.round(r / this.dr))), j = Math.round((Math.atan2(y, x) / (2 * Math.PI)) * this.NT);
    return Math.min(t, this.zc[ir * this.NT + (((j % this.NT) + this.NT) % this.NT)]);
  }
  // driven cutter pointing at the axis (flat end, radius R) moving from a to b: at the angle phi beside its axis
  // the end face lies at the radius xr / cos(phi)
  carve(a, b, R, t0, t1) {
    const { n, dz, ro } = this.S, bot = this.stock.bottom, NT = this.NT, dth = (2 * Math.PI) / NT, rad = Math.PI / 180;
    if (!this.rc) this.rc = new Float32Array(NT * n).fill(Infinity);
    const rc = this.rc, L = Math.hypot((b.c - a.c) * rad * Math.max(a.xr, b.xr), b.z - a.z, b.xr - a.xr);
    const steps = Math.max(1, Math.ceil((L * (t1 - t0)) / Math.max(0.15, R * 0.2)));
    let removed = 0;
    for (let k = 0; k <= steps; k++) {
      const t = t0 + ((t1 - t0) * k) / steps, c = (a.c + (b.c - a.c) * t) * rad, z = a.z + (b.z - a.z) * t, xr = Math.max(0.05, a.xr + (b.xr - a.xr) * t);
      const i0 = Math.max(0, Math.ceil((z - R - bot) / dz)), i1 = Math.min(n - 1, Math.floor((z + R - bot) / dz));
      const pm = Math.min(1.4, Math.atan(R / xr)), j0 = Math.floor((c - pm) / dth), j1 = Math.ceil((c + pm) / dth);
      for (let i = i0; i <= i1; i++) {
        if (!(ro[i] > xr)) continue;
        const dzz = bot + i * dz - z, w2 = R * R - dzz * dzz;
        if (w2 < 0) continue;
        for (let j = j0; j <= j1; j++) {
          const phi = j * dth - c, w = xr * Math.tan(phi);
          if (Math.abs(phi) > 1.45 || w * w > w2) continue;
          const r = xr / Math.cos(phi), q = i * NT + (((j % NT) + NT) % NT);
          if (r < ro[i] && r < rc[q] - 1e-4) {
            removed += Math.min(ro[i], rc[q]) - r;
            rc[q] = r;
            if (i < this.rows[0]) this.rows[0] = i;
            if (i > this.rows[1]) this.rows[1] = i;
          }
        }
      }
    }
    if (removed > 0) this.dirty = true;
    return removed;
  }
  /** Radius left at the angle c (degrees) and the height z: the turned profile, less what driven cutters took. */
  radiusAt(c, z) {
    const { n, dz, ro } = this.S, i = Math.max(0, Math.min(n - 1, Math.round((z - this.stock.bottom) / dz)));
    if (!this.rc) return ro[i];
    const j = Math.round(((c * Math.PI) / 180 / (2 * Math.PI)) * this.NT);
    return Math.min(ro[i], this.rc[i * this.NT + (((j % this.NT) + this.NT) % this.NT)]);
  }
  cut(a, b, tool, t0, t1) {
    const res = { removed: 0 };
    if (b.live || a.live) {
      // driven tool: the hole is kept as its deepest tip position per place (the turned profile stays as it is)
      if (b.live && a.live && b.t !== 'r') {
        const rad = b.live === 'rad', v = k => a[k] + (b[k] - a[k]) * t1, R = Math.max(0.1, (+tool.dia || 1) / 2);
        if (rad && !b.polar) {
          // pocket, contour, keyway or hole on the diameter: the material is taken away
          this.carve(a, b, R, t0, t1);
        } else if (!b.polar || b.groove) {
          // contour or pocket on the face, hole along the axis: the material is taken away
          this.faceCut(a, b, R, t0, t1);
        } else if (b.polar) {
          // flat: the plane the cutter's side leaves, by its distance from the axis and its direction
          const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
          if (b.flat && L > 1e-6 && t1 > 0.5) {
            let nx = dy / L, ny = -dx / L, q = a.x * nx + a.y * ny;
            if (q < 0) { nx = -nx; ny = -ny; q = -q; }
            const key = `flat|${Math.round((Math.atan2(ny, nx) * 1800) / Math.PI)}`, f = this.flats.get(key);
            if (!f || q - R < f.d - 1e-6 || b.z < f.z - 1e-6) { this.flats.set(key, { nx, ny, d: Math.min(f?.d ?? Infinity, q - R), z: Math.min(f?.z ?? Infinity, b.z) }); this.dirty = true; }
          }
        }
      }
      return res;
    }
    const p = t => ({ x: a.x + (b.x - a.x) * t, z: a.z + (b.z - a.z) * t });
    const p0 = p(t0), p1 = p(t1);
    const steps = Math.max(1, Math.ceil(Math.hypot(p1.x - p0.x, p1.z - p0.z) / (this.S.dz * 0.7)));
    const sh = turnCutShape(tool);
    for (let s = 0; s <= steps; s++) {
      const x = p0.x + ((p1.x - p0.x) * s) / steps, z = p0.z + ((p1.z - p0.z) * s) / steps;
      res.removed += this.S.cutAt(x, z, sh);
      if (sh.bar && !res.holderAt) { const hz = this.S.barHit(x, z, sh); if (hz != null) res.holderAt = { x, y: 0, z: hz }; }
    }
    if (res.removed > 0) this.dirty = true;
    return res;
  }
  update() {
    if (!this.dirty || !this.stock) return;
    this.dirty = false;
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry.dispose(); if (c.material !== this.mat && c.material !== this.holeMat && c.material !== this.markMat) c.material.dispose(); }
    this.group.updateWorldMatrix(true, false);
    // profile: up the outside, back down the bore
    const { ro, ri, n, dz } = this.S, b = this.stock.bottom;
    const pts = [new THREE.Vector2(Math.max(0.001, ri[0]), b)];
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(Math.max(0.001, ro[i], ri[i]), b + i * dz));
    for (let i = n - 1; i >= 0; i--) pts.push(new THREE.Vector2(Math.max(0.001, ri[i]), b + i * dz));
    const lathe = (list, mat) => { if (list.length < 2) return; const g = new THREE.LatheGeometry(list, 72); g.rotateX(Math.PI / 2); this.group.add(new THREE.Mesh(g, mat)); }; // lathe axis Y -> model Z
    const flats = [...(this.flats?.values() || [])];
    const V = (r, z) => new THREE.Vector2(Math.max(0.001, r), z);
    // comparison: green = at size, blue = material left (darker = more), red = too deep; counted in this.stat
    const cmp = this.cmp, tol = this.cmpTol, stat = (this.stat = { ok: 0, left: 0, gouge: 0, worst: 0 });
    const shade = (col, o, v, lo, hi, count) => {
      if (v < lo - tol) { col[o] = 0.88; col[o + 1] = 0.2; col[o + 2] = 0.2; if (count) { stat.gouge++; stat.worst = Math.min(stat.worst, v - lo); } }
      else if (v <= hi + tol) { col[o] = 0.25; col[o + 1] = 0.72; col[o + 2] = 0.32; if (count) stat.ok++; }
      else { const t = Math.min(1, (v - hi) / 3); col[o] = 0.55 - 0.45 * t; col[o + 1] = 0.72 - 0.42 * t; col[o + 2] = 0.95; if (count) stat.left++; }
    };
    // a grid of rows × (NT + 1) points around the part: normals (the first and the last column are the same
    // place: one normal for both, so no seam shows), colours, material
    const finish = (g, rows, NT, mat, tag) => {
      g.computeVertexNormals();
      const nrm = g.getAttribute('normal');
      for (let r = 0; r < rows; r++) {
        const p0 = r * (NT + 1), p1 = p0 + NT, x = nrm.getX(p0) + nrm.getX(p1), y = nrm.getY(p0) + nrm.getY(p1), zz = nrm.getZ(p0) + nrm.getZ(p1), l = Math.hypot(x, y, zz) || 1;
        nrm.setXYZ(p0, x / l, y / l, zz / l); nrm.setXYZ(p1, x / l, y / l, zz / l);
      }
      const gm = mat.clone();
      if (cmp) { gm.color.set(0xffffff); gm.metalness = 0; }
      gm.vertexColors = true;
      gm.clippingPlanes = mat.clippingPlanes;
      const mesh = new THREE.Mesh(g, gm);
      mesh.userData[tag] = true;
      this.group.add(mesh);
    };
    // cuts along the axis: everything above the row kf is drawn as seen from the face (a height field in rings
    // around the axis), the turned shape below it as before
    const kf = this.zc && this.zmin < b + (n - 1) * dz ? Math.max(0, Math.min(n - 2, Math.floor((this.zmin - b) / dz) - 1)) : null;
    const face = mat => {
      const NT = this.NT, dr = this.dr, zc = this.zc, rc = this.rc && this.rows[1] > kf ? this.rc : null, zf = b + kf * dz;
      let rmax = 0;
      for (let i = kf + 1; i < n; i++) rmax = Math.max(rmax, ro[i]);
      const nr = Math.min(this.NR, Math.ceil(rmax / dr) + 1), rows = nr + 1;
      const pos = new Float32Array(rows * (NT + 1) * 3), col = new Float32Array(rows * (NT + 1) * 3), low = new Uint8Array(rows * (NT + 1)), ind = [];
      const solid = (i, r) => ro[i] > ri[i] + 1e-6 && r < ro[i] - 1e-6 && (r > ri[i] + 1e-6 || ri[i] < 1e-6);
      for (let ir = 0; ir <= nr; ir++) {
        const r = ir * dr;
        let i1 = n - 1;
        while (i1 > kf && !solid(i1, r)) i1--;
        for (let j = 0; j <= NT; j++) {
          const jj = j % NT;
          let i = i1;
          if (rc) while (i > kf && !(solid(i, r) && r < rc[i * NT + jj] - 1e-6)) i--;
          const t = i > kf ? b + i * dz : -Infinity, cz = zc[ir * NT + jj], hit = cz < t - 1e-4, z = Math.max(zf, Math.min(t, cz)), th = (j * 2 * Math.PI) / NT, v = ir * (NT + 1) + j, o = v * 3;
          pos[o] = r * Math.cos(th); pos[o + 1] = r * Math.sin(th); pos[o + 2] = z;
          if (cmp && i > kf) shade(col, o, Math.min(t, cz), cmp.tLo[ir * NT + jj], cmp.tHi[ir * NT + jj], j < NT);
          else col[o] = col[o + 1] = col[o + 2] = hit ? 0.72 : 1;
          low[v] = i > kf ? 0 : 1;
        }
      }
      for (let ir = 0; ir < nr; ir++) for (let j = 0; j < NT; j++) {
        const o = ir * (NT + 1) + j, u = o + NT + 1;
        if (low[o] && low[o + 1] && low[u] && low[u + 1]) continue; // nothing above the row kf here: the turned shape shows
        ind.push(o, u, o + 1, o + 1, u, u + 1);
      }
      if (!ind.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(ind);
      finish(g, rows, NT, mat, 'face');
    };
    // (comparison: the whole outside is such a grid, coloured place by place)
    const band = cmp ? [0, n - 1] : this.rc && this.rows[1] >= this.rows[0] ? [Math.max(0, this.rows[0] - 1), Math.min(n - 1, this.rows[1] + 1)] : null;
    // rows lo … hi of the outside as a grid around the part, with what the driven cutters took away
    const grid = (lo, hi, mat) => {
      const NT = this.NT, rc = this.rc, rows = hi - lo + 1, pos = new Float32Array(rows * (NT + 1) * 3), col = new Float32Array(rows * (NT + 1) * 3), ind = [];
      for (let r = 0; r < rows; r++) {
        const i = lo + r, z = b + i * dz, base = Math.max(0.001, ro[i], ri[i]);
        for (let j = 0; j <= NT; j++) {
          const q = i * NT + (j % NT), cutR = rc ? rc[q] : Infinity, hit = cutR < base, rr = hit ? Math.max(0.001, ri[i], cutR) : base, th = (j * 2 * Math.PI) / NT, o = (r * (NT + 1) + j) * 3;
          pos[o] = rr * Math.cos(th); pos[o + 1] = rr * Math.sin(th); pos[o + 2] = z;
          // (counted where the part is, or was meant to be: not the stock left in the chuck below it)
          if (cmp) shade(col, o, Math.min(ro[i], cutR), cmp.rLo[q], cmp.rHi[q], j < NT && cmp.rHi[q] > 0 && (kf == null || i <= kf));
          else col[o] = col[o + 1] = col[o + 2] = hit ? 0.72 : 1;
        }
      }
      for (let r = 0; r + 1 < rows; r++) for (let j = 0; j < NT; j++) { const o = r * (NT + 1) + j, u = o + NT + 1; ind.push(o, o + 1, u, o + 1, u + 1, u); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      g.setAttribute('color', new THREE.BufferAttribute(col, 3));
      g.setIndex(ind);
      finish(g, rows, NT, mat, 'carved');
    };
    // the outside of the rows i0 … i1 and the bore back down; the carved rows are left to the grid
    const part = (i0, i1, mat, cap, open) => {
      const head = cap ? [V(ri[0], b)] : [], inner = [];
      for (let i = i1; i >= i0; i--) inner.push(V(ri[i], b + i * dz));
      const O = i => V(Math.max(ro[i], ri[i]), b + i * dz);
      const lo = band ? Math.max(i0, band[0]) : 1, hi = band ? Math.min(i1, band[1]) : 0;
      const list = [...head];
      // open: no lid across the material at the upper end (the height field of the face stands on it)
      const close = (out, inn) => { if (open) { lathe(out, mat); lathe(inn, mat); } else lathe([...out, ...inn], mat); };
      if (lo >= hi) { for (let i = i0; i <= i1; i++) list.push(O(i)); close(list, inner); return; }
      for (let i = i0; i <= lo; i++) list.push(O(i));
      lathe(list, mat);
      const up = [];
      for (let i = hi; i <= i1; i++) up.push(O(i));
      close(up, inner);
      grid(lo, hi, mat);
    };
    if (!flats.length) { if (kf == null) part(0, n - 1, this.mat, true); else { part(0, kf, this.mat, true, true); face(this.mat); } }
    else {
      // milled flats: the part above their lower end is cut off at the flat planes (clipping) and closed by caps
      const zf = Math.min(...flats.map(f => f.z)), k0 = Math.max(0, Math.min(n - 1, Math.round((zf - b) / dz)));
      const ring = (i0, i1) => {
        const q = [];
        for (let i = i0; i <= i1; i++) q.push(new THREE.Vector2(Math.max(0.001, ro[i], ri[i]), b + i * dz));
        for (let i = i1; i >= i0; i--) q.push(new THREE.Vector2(Math.max(0.001, ri[i]), b + i * dz));
        return q;
      };
      if (kf == null) part(0, k0, this.mat, true); else part(0, Math.min(k0, kf), this.mat, true, kf <= k0);
      const cm = this.mat.clone();
      cm.clippingPlanes = flats.map(f => new THREE.Plane(new THREE.Vector3(-f.nx, -f.ny, 0), f.d).applyMatrix4(this.group.matrixWorld));
      if (kf == null) part(k0, n - 1, cm, false);
      else { if (kf > k0) part(k0, kf, cm, false, true); face(cm); }
      for (const f of flats) {
        // cap: strip on the plane between the chord ends of the outside and the bore, per z cell
        const pos = [], idx = [];
        const strip = sign => {
          const base = pos.length / 3;
          let rows = 0;
          for (let i = k0; i < n; i++) {
            if (!(ro[i] > f.d + 1e-6)) break;
            const wo = Math.sqrt(ro[i] * ro[i] - f.d * f.d), wi = ri[i] > f.d ? Math.sqrt(ri[i] * ri[i] - f.d * f.d) : 0;
            for (const w of [sign * wi, sign * wo]) pos.push(f.d * f.nx - w * f.ny, f.d * f.ny + w * f.nx, b + i * dz);
            rows++;
          }
          for (let r = 0; r + 1 < rows; r++) { const o = base + 2 * r; idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2); }
        };
        strip(1); strip(-1);
        if (!idx.length) continue;
        const cg = new THREE.BufferGeometry();
        cg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        cg.setIndex(idx);
        cg.computeVertexNormals();
        // the other flats cut this cap too
        const capMat = this.mat.clone();
        capMat.clippingPlanes = cm.clippingPlanes.filter((_, j) => flats[j] !== f);
        this.group.add(new THREE.Mesh(cg, capMat));
      }
    }
  }
  dispose() { for (const c of [...this.group.children]) { this.group.remove(c); c.geometry.dispose(); } this.stock = null; }
}
