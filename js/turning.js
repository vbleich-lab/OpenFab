// Turning (lathe) CAM. The spindle axis is the model's Z axis; toolpaths live in
// the XZ half-plane with x = radius (the post-processor writes diameters).
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export const TURN_OPS = {
  tface: 'Plandrehen', trough: 'Längsschruppen', tfinish: 'Konturschlichten',
  tgroove: 'Einstechen', tthread: 'Gewindedrehen', tpart: 'Abstechen', tdrill: 'Bohren (Drehachse)', tbore: 'Innendrehen',
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
  const xmin = z => {
    let m = -Infinity;
    for (let d = sh.lo; d <= sh.hi + 1e-9; d += stepD) m = Math.max(m, prof.at(z + d) + stl - (sh.at(0, d)));
    return m;
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
      // (+ allowance, nose compensated) from the face to the chuck side; only for contours that rise steadily
      if (sh.side !== 'out') ctx.cycleWhy = 'Nur für Außen-Drehmeißel';
      else {
        const cp = [];
        // from the (faced) front face on: in front of it there is nothing for the cycle to cut
        for (let z = zTop; z >= zEnd - 1e-9; z -= dz) if (z <= st.modelTop + stl + 1e-9) cp.push([Math.max(0, need(z)), z]);
        if (cp.length && cp[cp.length - 1][1] > zEnd + 1e-6) cp.push([Math.max(0, need(zEnd)), zEnd]);
        // undercuts (grooves): the cycle (type I) only follows the hull that rises steadily towards the chuck;
        // what lies below it stays for grooving / finishing
        if (!cp.length) cp.push([st.r, zEnd]);
        let run = 0, under = 0;
        const env = cp.map(([x, z]) => { run = Math.max(run, x); under = Math.max(under, run - x); return [run, z]; });
        const sp = simplify(env);
        if (!(sp[0][0] < st.r - 1e-3)) ctx.cycleWhy = 'Nichts zu schruppen';
        else {
          if (sp[sp.length - 1][0] < st.r) sp.push([st.r, sp[sp.length - 1][1]]);
          ctx.cycle = { kind: 'rough', pts: sp, ap, sx: st.r + 1, sz: zTop + 1, feed: t.feed, under: under > 0.01 ? under : 0 };
        }
      }
      break;
    }
    case 'tfinish': {
      const zTop = st.modelTop + 0.5;
      const pts = [];
      const X = z => Math.max(0, xmin(z));
      // a corner between two samples: the straight move would cut it (the nose rounds a shoulder edge). Bisect
      // while the contour lies outside the line, and always across steep steps (shoulders) to pin them down.
      const refine = (a, b, depth) => {
        const dx = Math.abs(b[0] - a[0]), dz = Math.abs(b[1] - a[1]);
        if (depth > 8 || dx <= 0.005 || dz < 1e-4) return;
        const zm = (a[1] + b[1]) / 2, m = [X(zm), zm];
        if (m[0] <= (a[0] + b[0]) / 2 + 0.002 && !(dx > 0.05 && dx > 3 * dz)) return;
        refine(a, m, depth + 1); pts.push(m); refine(m, b, depth + 1);
      };
      for (let z = zTop; z >= zEnd - 1e-9; z -= prof.dz) {
        const q = [X(z), z];
        if (pts.length) refine(pts[pts.length - 1], q, 0);
        pts.push(q);
      }
      const sp = simplify(pts);
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
  }
  P.rapid(clearX, clearZ);
  return P.m;
}

const TOOL_OK = { tface: ['turn'], trough: ['turn'], tfinish: ['turn'], tgroove: ['groove'], tthread: ['tthread'], tpart: ['groove'], tdrill: ['drill', 'center', 'spot'], tbore: ['turnbore'] };

export function generateTurnSetup(project, bodies, setup, machine, rapid) {
  const results = new Map();
  const box = new THREE.Box3();
  for (const b of bodies) { b.geometry.computeBoundingBox(); box.union(b.geometry.boundingBox); }
  const ops = project.cam.ops.filter(o => o.setup === setup.id);
  if (box.isEmpty()) return { stock: null, results, ops, kind: 'turn', T: new THREE.Matrix4(), machine, error: 'Kein Körper vorhanden.' };
  const prof = turnProfile(bodies, box);
  const stock = turnStock(box, setup, prof);
  // radius of the hole drilled on the axis so far (start of internal turning)
  let pre = 0;
  for (const op of ops) {
    if (op.enabled === false) { results.set(op.id, { moves: [], disabled: true }); continue; }
    try {
      const t0 = project.cam.tools.find(x => x.id === op.tool);
      if (!t0) throw new Error('Kein Werkzeug gewählt');
      // cutting data of the operation dialog (empty = from the tool)
      const cut = op.cut || {}, cv = k => (cut[k] != null && Number.isFinite(+cut[k]) ? +cut[k] : null);
      const t = { ...t0, ...(cv('rpm') != null ? { rpm: cv('rpm') } : {}), ...(cv('feed') != null ? { feed: cv('feed') } : {}), ...(cv('plunge') != null ? { plunge: cv('plunge') } : {}) };
      if (TOOL_OK[op.type] && !TOOL_OK[op.type].includes(t.kind || t.type)) throw new Error(`Passendes Werkzeug wählen: ${TOOL_OK[op.type].map(k => TURN_TOOL_TYPES[k]).filter(Boolean).join(' / ')}`);
      const tctx = { pre };
      const moves = genTurnOp(op, t, stock, prof, tctx);
      if (op.type === 'tdrill') pre = Math.max(pre, (+t.dia || 0) / 2);
      let len = 0, time = 0;
      for (let i = 1; i < moves.length; i++) {
        const a = moves[i - 1], b = moves[i];
        const d = Math.hypot(b.x - a.x, b.z - a.z);
        len += d;
        time += (d / (b.t === 'r' ? rapid : b.f)) * 60;
      }
      results.set(op.id, { moves, tool: t, length: len, time, heights: { top: stock.top, bottom: stock.bottom }, ...(tctx.cycle || tctx.cycleWhy ? { turnCycle: tctx.cycle || null, turnCycleWhy: tctx.cycleWhy || null } : {}) });
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
  }
  build(stock) {
    this.dispose();
    this.stock = stock;
    this.S = new LatheStock(stock);
    this.dirty = true;
    this.update();
  }
  reset() { if (this.S) { this.S = new LatheStock(this.stock); this.dirty = true; this.update(); } }
  cut(a, b, tool, t0, t1) {
    const res = { removed: 0 };
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
    for (const c of [...this.group.children]) { this.group.remove(c); c.geometry.dispose(); }
    // profile: up the outside, back down the bore
    const { ro, ri, n, dz } = this.S, b = this.stock.bottom;
    const pts = [new THREE.Vector2(Math.max(0.001, ri[0]), b)];
    for (let i = 0; i < n; i++) pts.push(new THREE.Vector2(Math.max(0.001, ro[i], ri[i]), b + i * dz));
    for (let i = n - 1; i >= 0; i--) pts.push(new THREE.Vector2(Math.max(0.001, ri[i]), b + i * dz));
    const g = new THREE.LatheGeometry(pts, 72);
    g.rotateX(Math.PI / 2); // lathe axis Y -> model Z
    this.group.add(new THREE.Mesh(g, this.mat));
  }
  dispose() { for (const c of [...this.group.children]) { this.group.remove(c); c.geometry.dispose(); } this.stock = null; }
}
