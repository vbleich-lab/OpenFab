// Test part for CAM tests: a union of boxes and a dome, given twice:
//  - as a three.js mesh (what the CAM generators see), and
//  - as exact shapes, so a toolpath can be checked against the true part independently of the heightmap.
//
// Plate 120 x 80, top at Z10, with a 25 x 30 pocket 6 deep (floor Z4), a boss 28 x 40 up to Z22 with vertical
// walls, and a dome (ball R18 around (62, 40, 0)) rising to Z18.
import * as THREE from 'three';
import { newProject } from '../../js/state.js';

const box = (x0, y0, z0, x1, y1, z1) => ({ kind: 'box', min: [x0, y0, z0], max: [x1, y1, z1] });
export const SHAPES = [
  box(0, 0, 0, 120, 80, 4), // floor under the pocket
  box(0, 0, 4, 85, 80, 10), // plate around the pocket [85,110] x [15,45]
  box(110, 0, 4, 120, 80, 10),
  box(85, 0, 4, 110, 15, 10),
  box(85, 45, 4, 110, 80, 10),
  box(10, 15, 10, 38, 55, 22), // boss
  { kind: 'ball', c: [62, 40, 0], r: 18 }, // dome (only its upper half is meshed; the rest lies inside the plate)
];
export const POCKET = { x: 85, y: 15, w: 25, h: 30, top: 10, floor: 4 };
export const BOSS = { x: 10, y: 15, w: 28, h: 40, top: 22, base: 10 };

export function partBodies() {
  const geos = [];
  for (const s of SHAPES) {
    if (s.kind === 'box') {
      const g = new THREE.BoxGeometry(s.max[0] - s.min[0], s.max[1] - s.min[1], s.max[2] - s.min[2]);
      g.translate((s.min[0] + s.max[0]) / 2, (s.min[1] + s.max[1]) / 2, (s.min[2] + s.max[2]) / 2);
      geos.push(g);
    } else {
      // upper hemisphere, pole on +Z; fine tessellation keeps the chord error below 0.01 mm
      const g = new THREE.SphereGeometry(s.r, 192, 64, 0, Math.PI * 2, 0, Math.PI / 2);
      g.rotateX(Math.PI / 2);
      g.translate(...s.c);
      geos.push(g);
    }
  }
  return geos.map((g, i) => ({ id: 'b' + i, geometry: g.index ? g.toNonIndexed() : g }));
}

// ---- exact distances ---------------------------------------------------------------------------------------

// Penetration depth of a tool standing with its tip at p (model frame) into one shape; <= 0 means free.
// tool: { r, ball }. A ball-end cutter is a capsule (all points within r of the vertical ray up from the ball
// centre), so its depth is exact; a flat cutter is a cylinder from the tip upwards, measured as the shorter way
// out (lift or sideways).
function penetration(s, p, tool) {
  const { r, ball } = tool;
  if (s.kind === 'box') {
    const dx = Math.max(s.min[0] - p[0], 0, p[0] - s.max[0]);
    const dy = Math.max(s.min[1] - p[1], 0, p[1] - s.max[1]);
    const d = Math.hypot(dx, dy);
    if (ball) {
      const zc = p[2] + r, dz = Math.max(0, zc - s.max[2]);
      if (d === 0 && dz === 0) return r + (s.max[2] - zc); // axis inside the box
      return r - Math.hypot(d, dz);
    }
    if (d >= r || p[2] >= s.max[2]) return -Math.hypot(Math.max(0, d - r), Math.max(0, p[2] - s.max[2]));
    return Math.min(s.max[2] - p[2], r - d);
  }
  const c = s.c, R = s.r, d = Math.hypot(p[0] - c[0], p[1] - c[1]);
  if (ball) { const zc = p[2] + r; return R + r - Math.hypot(d, Math.max(0, zc - c[2])); }
  return R - Math.hypot(Math.max(0, d - r), Math.max(0, p[2] - c[2]));
}

export function partPenetration(p, tool) {
  let worst = -Infinity;
  for (const s of SHAPES) worst = Math.max(worst, penetration(s, p, tool));
  return worst;
}

// Walks a toolpath (moves in setup frame, T = setup matrix) and reports the deepest violation of the part.
// Feed moves may not cut deeper than tol; rapid moves may not touch the part at all (same tol).
export function checkMoves(moves, T, tool, { tol = 0.02, step = 0.25, skipBelow = -Infinity } = {}) {
  const inv = new THREE.Matrix4().copy(T).invert();
  const v = new THREE.Vector3();
  const out = { feed: { pen: -Infinity, at: null }, rapid: { pen: -Infinity, at: null }, n: 0 };
  let prev = null, idx = -1;
  for (const m of moves) {
    idx++;
    if (!Number.isFinite(m.x) || !Number.isFinite(m.y) || !Number.isFinite(m.z)) { prev = null; continue; }
    if (prev) {
      const L = Math.hypot(m.x - prev.x, m.y - prev.y, m.z - prev.z), n = Math.max(1, Math.ceil(L / step));
      const slot = m.t === 'r' ? out.rapid : out.feed;
      for (let k = 1; k <= n; k++) {
        const s = k / n;
        v.set(prev.x + (m.x - prev.x) * s, prev.y + (m.y - prev.y) * s, prev.z + (m.z - prev.z) * s).applyMatrix4(inv);
        if (v.z < skipBelow) continue;
        const pen = partPenetration([v.x, v.y, v.z], tool);
        out.n++;
        if (pen > slot.pen) { slot.pen = pen; slot.at = [v.x, v.y, v.z].map(q => +q.toFixed(3)); slot.move = idx; }
      }
    }
    prev = m;
  }
  out.ok = out.feed.pen <= tol && out.rapid.pen <= tol;
  return out;
}

// ---- project ------------------------------------------------------------------------------------------------

const XY = z => ({ o: [0, 0, z], x: [1, 0, 0], n: [0, 0, 1] });
export function testProject() {
  const p = newProject();
  p.name = 'CAM-Prüfteil';
  p.machines = [];
  p.posts = [];
  p.features = [
    { id: 'skOut', type: 'sketch', name: 'Umriss', plane: XY(10), entities: [{ id: 'eo', type: 'rect', x: 0, y: 0, w: 120, h: 80 }] },
    { id: 'skPocket', type: 'sketch', name: 'Tasche', plane: XY(10), entities: [{ id: 'ep', type: 'rect', x: POCKET.x, y: POCKET.y, w: POCKET.w, h: POCKET.h }] },
    { id: 'skBoss', type: 'sketch', name: 'Zapfen', plane: XY(22), entities: [{ id: 'eb', type: 'rect', x: BOSS.x, y: BOSS.y, w: BOSS.w, h: BOSS.h }] },
    {
      id: 'skHoles', type: 'sketch', name: 'Bohrbild', plane: XY(10), entities: [
        [6, 6], [114, 6], [114, 74], [6, 74], [50, 72], [70, 72], [90, 72],
      ].map(([cx, cy], i) => ({ id: 'h' + i, type: 'circle', cx, cy, r: 2 })),
    },
  ];
  const st = p.cam.setups[0];
  st.id = 'S1';
  Object.assign(st, { orientation: 'top', marginSide: 3, marginTop: 1, marginBottom: 0, origin: 'top-corner', safeZ: 10, retract: 3 });
  return p;
}
