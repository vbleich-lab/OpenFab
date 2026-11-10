// 2D drawing derivation: orthographic views (ISO first-angle projection, as used
// in Germany) with visible/hidden edges, silhouettes, centre lines, automatic
// overall dimensions and hole callouts on a standard sheet with a title block.
import * as THREE from 'three';
import { MeshBVH } from 'three-mesh-bvh';

export const SHEETS = { A4: [297, 210], A3: [420, 297], A2: [594, 420] };
const SCALES = [10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02];
const scaleLabel = s => (s >= 1 ? `${s}:1` : `1:${Math.round(1 / s)}`);

// view direction = from the part towards the viewer; (u, v) = sheet axes
export const VIEWS = {
  front: { label: 'Vorderansicht', dir: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1] },
  top: { label: 'Draufsicht', dir: [0, 0, 1], u: [1, 0, 0], v: [0, -1, 0] },
  left: { label: 'Seitenansicht von links', dir: [-1, 0, 0], u: [0, -1, 0], v: [0, 0, 1] },
  iso: { label: 'Isometrie', dir: [1, -1, 1], u: [0.7071, 0.7071, 0], v: [-0.4082, 0.4082, 0.8165] },
};

function prepare(bodies) {
  return bodies.map(b => ({ b, bvh: new MeshBVH(b.geometry.clone()) }));
}

// Segments of B-rep edges + mesh silhouettes for one view, split into visible/hidden.
function viewSegments(prep, view) {
  const d = new THREE.Vector3(...view.dir).normalize();
  const U = new THREE.Vector3(...view.u), V = new THREE.Vector3(...view.v);
  const ray = new THREE.Ray();
  const occluded = p => {
    ray.origin.copy(p).addScaledVector(d, 0.02);
    ray.direction.copy(d);
    for (const q of prep) { const hit = q.bvh.raycastFirst(ray, THREE.DoubleSide); if (hit && hit.distance > 0.01) return true; }
    return false;
  };
  const vis = [], hid = [];
  const pushSeg = (a, b) => {
    // split long segments so partly hidden edges are drawn correctly
    const n = Math.max(1, Math.ceil(a.distanceTo(b) / 1.5));
    let prev = a, prevHidden = null, start = a;
    for (let k = 1; k <= n; k++) {
      const q = a.clone().lerp(b, k / n);
      const mid = prev.clone().lerp(q, 0.5);
      const h = occluded(mid);
      if (prevHidden !== null && h !== prevHidden) { (prevHidden ? hid : vis).push([start, prev]); start = prev; }
      prevHidden = h;
      prev = q;
    }
    (prevHidden ? hid : vis).push([start, b]);
  };
  const A = new THREE.Vector3(), B = new THREE.Vector3();
  for (const { b } of prep) {
    const pos = b.edges.attributes.position.array;
    for (let i = 0; i < pos.length; i += 6) {
      A.set(pos[i], pos[i + 1], pos[i + 2]); B.set(pos[i + 3], pos[i + 4], pos[i + 5]);
      if (A.distanceToSquared(B) < 1e-10) continue;
      pushSeg(A.clone(), B.clone());
    }
    // silhouettes of curved faces: triangle edges between front- and back-facing triangles
    const g = b.geometry, idx = g.index.array, P = g.attributes.position.array;
    const tri = (t, k) => new THREE.Vector3(P[idx[t * 3 + k] * 3], P[idx[t * 3 + k] * 3 + 1], P[idx[t * 3 + k] * 3 + 2]);
    const faceSign = new Int8Array(idx.length / 3);
    const e1 = new THREE.Vector3(), e2 = new THREE.Vector3(), nn = new THREE.Vector3();
    for (let t = 0; t < faceSign.length; t++) {
      const p0 = tri(t, 0);
      e1.copy(tri(t, 1)).sub(p0); e2.copy(tri(t, 2)).sub(p0);
      nn.crossVectors(e1, e2);
      const s = nn.dot(d);
      faceSign[t] = Math.abs(s) < 1e-9 * nn.length() ? 0 : Math.sign(s);
    }
    const edgeMap = new Map();
    for (let t = 0; t < faceSign.length; t++) {
      if (b.faceOf && !curvedFace(b, t)) continue;
      for (let k = 0; k < 3; k++) {
        const ia = idx[t * 3 + k], ib = idx[t * 3 + ((k + 1) % 3)];
        const key = ia < ib ? ia + ',' + ib : ib + ',' + ia;
        const other = edgeMap.get(key);
        if (other === undefined) edgeMap.set(key, t);
        else if (faceSign[other] * faceSign[t] < 0) pushSeg(new THREE.Vector3(P[ia * 3], P[ia * 3 + 1], P[ia * 3 + 2]), new THREE.Vector3(P[ib * 3], P[ib * 3 + 1], P[ib * 3 + 2]));
      }
    }
  }
  const proj = p => [p.dot(U), p.dot(V)];
  return { vis: vis.map(([a, b]) => [proj(a), proj(b)]), hid: hid.map(([a, b]) => [proj(a), proj(b)]) };
}

// Planar faces have no silhouettes; only test faces whose triangles are not coplanar.
const curvedCache = new WeakMap();
function curvedFace(b, t) {
  let m = curvedCache.get(b);
  if (!m) {
    m = new Map();
    const g = b.geometry, idx = g.index.array, P = g.attributes.position.array;
    const nrm = t2 => {
      const v = k => new THREE.Vector3(P[idx[t2 * 3 + k] * 3], P[idx[t2 * 3 + k] * 3 + 1], P[idx[t2 * 3 + k] * 3 + 2]);
      const a = v(0);
      return new THREE.Vector3().crossVectors(v(1).sub(a), v(2).sub(a)).normalize();
    };
    const ref = new Map();
    for (let t2 = 0; t2 < b.faceOf.length; t2++) {
      const f = b.faceOf[t2];
      const n = nrm(t2);
      if (!ref.has(f)) { ref.set(f, n); m.set(f, false); }
      else if (!m.get(f) && Math.abs(ref.get(f).dot(n)) < 0.9999) m.set(f, true);
    }
    curvedCache.set(b, m);
  }
  return m.get(b.faceOf[t]);
}

// Circular edges parallel to XY (holes, bosses): centre, radius, z.
function circles(bodies) {
  const out = [];
  for (const b of bodies) {
    for (const e of b.shape.edges) {
      // full circles only: corner arcs of rounded outlines are not holes
      if (e.geomType !== 'CIRCLE' || !e.isClosed) continue;
      const p = [0, 0.33, 0.66].map(t => e.pointAt(t));
      if (Math.abs(p[0].z - p[1].z) > 1e-4 || Math.abs(p[0].z - p[2].z) > 1e-4) continue;
      const [a, bb, c] = p;
      const dd = 2 * (a.x * (bb.y - c.y) + bb.x * (c.y - a.y) + c.x * (a.y - bb.y));
      if (Math.abs(dd) < 1e-9) continue;
      const a2 = a.x * a.x + a.y * a.y, b2 = bb.x * bb.x + bb.y * bb.y, c2 = c.x * c.x + c.y * c.y;
      const cx = (a2 * (bb.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - bb.y)) / dd;
      const cy = (a2 * (c.x - bb.x) + b2 * (a.x - c.x) + c2 * (bb.x - a.x)) / dd;
      const r = Math.hypot(a.x - cx, a.y - cy);
      if (!out.some(q => Math.hypot(q.cx - cx, q.cy - cy) < 1e-3 && Math.abs(q.r - r) < 1e-3 && Math.abs(q.z - a.z) < 1e-3)) out.push({ cx, cy, r, z: a.z });
    }
  }
  return out;
}

const esc = s => String(s ?? '').replace(/[&<>"]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]);
const f2 = v => String(+(+v).toFixed(2)).replace('.', ',');

/**
 * Builds the drawing. opts: { sheet: 'A3', scale: 'auto'|number, views: {front, top, left, iso},
 *   hidden: bool, dims: bool, title: {name, number, material, author, mass} }
 * Returns { svg, scale, warnings }.
 */
export function makeDrawing(bodies, opts) {
  const [SW, SH] = SHEETS[opts.sheet] || SHEETS.A3;
  const prep = prepare(bodies);
  const box = new THREE.Box3();
  for (const b of bodies) { b.geometry.computeBoundingBox(); box.union(b.geometry.boundingBox); }
  const size = box.getSize(new THREE.Vector3());
  const want = Object.entries(VIEWS).filter(([k]) => opts.views?.[k] !== false);
  // sections: the front view cut parallel to XZ (opts.section), the left view cut parallel to YZ (opts.sectionX);
  // sections and details share one row of letters (A–A, B–B, detail C …)
  const LETTERS = 'ABCDEFGHJKLMNPRSTUVWXYZ';
  let nextLetter = 0;
  const secs = {};
  if (opts.section?.bodies?.length && opts.views?.front !== false) secs.front = { ...opts.section, letter: LETTERS[nextLetter++] };
  if (opts.sectionX?.bodies?.length && opts.views?.left !== false) secs.left = { ...opts.sectionX, letter: LETTERS[nextLetter++] };
  const sec = secs.front || null;
  const segs = Object.fromEntries(want.map(([k, v]) => [k, viewSegments(secs[k] ? prepare(secs[k].bodies) : prep, v)]));
  const ext = k => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const list of [segs[k].vis, segs[k].hid]) for (const s of list) for (const [x, y] of s) { x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y); }
    return { x0, y0, x1, y1, w: x1 - x0, h: y1 - y0 };
  };
  // a view without any line (no body visible yet) is left out: its extent would be infinite
  const E = Object.fromEntries(want.filter(([k]) => segs[k].vis.length + segs[k].hid.length > 0).map(([k]) => [k, ext(k)]));
  // drawing area left of the title block; first-angle: top view below, left view to the right
  const margin = 20, tbH = 32, gap = 22;
  const areaW = SW - margin - 10, areaH = SH - 20 - tbH;
  const need = s => {
    const fw = (E.front?.w || size.x) * s, fh = (E.front?.h || size.z) * s;
    const lw = E.left ? E.left.w * s : 0, th = E.top ? E.top.h * s : 0;
    const iw = E.iso ? E.iso.w * s * 0.6 : 0;
    return { w: fw + (lw ? gap + lw : 0) + (iw ? gap + iw : 0) + 2 * gap, h: fh + (th ? gap + th : 0) + 2 * gap };
  };
  let scale = opts.scale === 'auto' || !opts.scale ? SCALES.find(s => { const n = need(s); return n.w <= areaW && n.h <= areaH; }) || SCALES[SCALES.length - 1] : +opts.scale;
  const warnings = [];
  const n = need(scale);
  if (n.w > areaW || n.h > areaH) warnings.push('Die Ansichten passen bei diesem Maßstab nicht auf das Blatt.');

  // view origins on the sheet (mm, y down)
  const fw = E.front ? E.front.w * scale : 0, fh = E.front ? E.front.h * scale : 0;
  const ox = margin + gap + 8, oy = 10 + gap + 6;
  const place = {};
  if (E.front) place.front = { x: ox, y: oy };
  if (E.top) place.top = { x: ox, y: oy + fh + gap };
  if (E.left) place.left = { x: ox + fw + gap, y: oy };
  if (E.iso) place.iso = { x: SW - 10 - E.iso.w * scale * 0.6 - gap, y: oy, s: scale * 0.6 };
  // detail views: a circle of a view, enlarged. Each is a view of its own (key) in the coordinates of its parent,
  // so dimensions picked in a detail show true sizes.
  const DET = {};
  const toSheet = (k, [x, y]) => {
    const dd = DET[k];
    if (dd) { const p = toSheet(dd.k, [x, y]); return [dd.D[0] + dd.f * (p[0] - dd.C[0]), dd.D[1] + dd.f * (p[1] - dd.C[1])]; }
    const e = E[k], pl = place[k], s = pl.s || scale;
    return [pl.x + (x - e.x0) * s, pl.y + (e.y1 - y) * s];
  };
  const viewScale = k => (DET[k] ? DET[k].s0 * DET[k].f : place[k].s || scale);
  {
    let left = 0;
    nextLetter = Math.max(nextLetter, 1); // A stays the section's letter, as in drawings made before
    for (const dt of opts.details || (opts.detail ? [{ ...opts.detail, key: 'detail' }] : [])) {
      const k = dt.view;
      if (!place[k] || k === 'iso' || !dt.key || DET[dt.key]) continue;
      const f = Math.max(1.5, +dt.factor || 2), s0 = place[k].s || scale;
      const C = toSheet(k, dt.c), r = Math.max(2, (+dt.r || 10) * s0), R2 = r * f;
      // from the lower right corner (above the title block and the parts list) to the left
      const D = [SW - 10 - 6 - R2 - left, SH - 10 - tbH - 18 - R2 - (opts.parts?.length ? (opts.parts.length + 1) * 6 : 0)];
      left += 2 * R2 + 14;
      DET[dt.key] = { k, f, s0, C, D, r, R2, c: dt.c, rv: r / s0, letter: LETTERS[nextLetter++] || '?' };
    }
  }
  // every view goes into its own group: the drawing window moves views by shifting their group
  const G = {};
  let cur = 'sheet';
  const L = { push: s => (G[cur] ||= []).push(s) };
  let hitLines = false;
  const circle = (cx, cy, r) => L.push(`<circle cx="${cx.toFixed(3)}" cy="${cy.toFixed(3)}" r="${r.toFixed(3)}" class="dim" fill="none"/>`);
  const line = (a, b, cls) => {
    const xy = `x1="${a[0].toFixed(3)}" y1="${a[1].toFixed(3)}" x2="${b[0].toFixed(3)}" y2="${b[1].toFixed(3)}"`;
    L.push(`<line ${xy} class="${cls}"/>`);
    if (hitLines) L.push(`<line ${xy} class="hit"/>`);
  };
  const text = (x, y, s, cls = 'txt', anchor = 'middle', rot = 0) => L.push(`<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" class="${cls}" text-anchor="${anchor}"${rot ? ` transform="rotate(${rot} ${x.toFixed(2)} ${y.toFixed(2)})"` : ''}>${esc(s)}</text>`);

  const asSection = k => secs[k];
  for (const k of Object.keys(place)) {
    cur = k;
    // a section view shows no hidden edges (DIN ISO 128-40)
    const showHidden = opts.hidden !== false && k !== 'iso' && !asSection(k);
    if (showHidden) for (const [a, b] of segs[k].hid) line(toSheet(k, a), toSheet(k, b), 'hid');
    // cut faces: hatched at 45°
    if (asSection(k)) for (const poly of secs[k].polys) {
      const d = poly.map(loop => loop.map((p, i) => `${i ? 'L' : 'M'}${toSheet(k, p).map(v => v.toFixed(3)).join(' ')}`).join('') + 'Z').join('');
      L.push(`<path d="${d}" class="hatch" fill-rule="evenodd"/>`);
    }
    for (const [a, b] of segs[k].vis) line(toSheet(k, a), toSheet(k, b), 'vis');
    const e = E[k], pl = place[k], s = pl.s || scale;
    text(pl.x + (e.w * s) / 2, pl.y + e.h * s + (k === 'iso' ? 8 : 5), asSection(k) ? `Schnitt ${secs[k].letter}–${secs[k].letter}` : VIEWS[k].label, asSection(k) ? 'lbl sec' : 'lbl');
  }
  // cutting line A–A in the top view: thick ends, arrows in the viewing direction (towards +Y)
  if (sec && place.top) {
    cur = 'top';
    const e = E.top;
    const a = toSheet('top', [e.x0, -sec.y]), b = toSheet('top', [e.x1, -sec.y]);
    const l = [a[0] - 6, a[1]], r = [b[0] + 6, b[1]];
    line(l, r, 'cut');
    line(l, [l[0] + 5, l[1]], 'cutend'); line([r[0] - 5, r[1]], r, 'cutend');
    const down = toSheet('top', [e.x0, -sec.y - 1])[1] > a[1] ? 1 : -1;
    for (const p of [l, r]) {
      line([p[0] + (p === l ? 2.5 : -2.5), p[1]], [p[0] + (p === l ? 2.5 : -2.5), p[1] + down * 7], 'dim arrow1');
      text(p[0] + (p === l ? 2.5 : -2.5), p[1] + down * 7 + (down > 0 ? 5 : -2), sec.letter, 'secl');
    }
  }
  // cutting line of the side section (plane parallel to YZ): upright in the front view (in the top view when
  // there is no front view), arrows in the viewing direction (towards +X)
  if (secs.left && (place.front || place.top)) {
    const k = place.front ? 'front' : 'top';
    cur = k;
    const e = E[k], sx = secs.left;
    const a = toSheet(k, [sx.x, e.y1]), b = toSheet(k, [sx.x, e.y0]);
    const t = [a[0], a[1] - 6], u = [b[0], b[1] + 6];
    line(t, u, 'cut');
    line(t, [t[0], t[1] + 5], 'cutend'); line([u[0], u[1] - 5], u, 'cutend');
    for (const p of [t, u]) {
      const y = p[1] + (p === t ? 2.5 : -2.5);
      line([p[0], y], [p[0] + 7, y], 'dim arrow1');
      text(p[0] + 9.5, y + 1.4, sx.letter, 'secl');
    }
  }

  // hole centre lines and callouts in the top view; concentric circles form one hole
  const circ = circles(bodies);
  const holes = [];
  for (const c of circ) {
    let hole = holes.find(q => Math.hypot(q.cx - c.cx, q.cy - c.cy) < 1e-3);
    if (!hole) holes.push((hole = { cx: c.cx, cy: c.cy, rs: new Map() }));
    const k = c.r.toFixed(3);
    const zs = hole.rs.get(k) || [];
    zs.push(c.z);
    hole.rs.set(k, zs);
  }
  cur = 'top';
  if (place.top && holes.length) {
    const groups = new Map();
    for (const hole of holes) {
      const radii = [...hole.rs.keys()].map(Number).sort((a, b) => a - b);
      const a = toSheet('top', [hole.cx, -hole.cy]);
      const r = radii[radii.length - 1] * scale;
      line([a[0] - r - 2, a[1]], [a[0] + r + 2, a[1]], 'ctr');
      line([a[0], a[1] - r - 2], [a[0], a[1] + r + 2], 'ctr');
      // label: smallest = bore, larger concentric ones = counterbore with depth
      // a thread along Z on this axis: the hole is called by the thread (M8×1,25 ↧12), not by its core diameter
      const th = (opts.threads || []).find(t => !t.outside && Math.abs(Math.abs(t.d[2]) - 1) < 1e-6 && Math.hypot(t.c[0] - hole.cx, t.c[1] - hole.cy) < 1e-3);
      const parts = radii.map((rr, i) => {
        const zs = hole.rs.get(rr.toFixed(3));
        const depth = Math.max(...zs) - Math.min(...zs);
        if (th && Math.abs(rr - th.r) < 0.05) return `${String(th.name).replace('.', ',')}${th.L > 1e-3 ? ` ↧${f2(th.L)}` : ''}`;
        return i === 0 ? `Ø${f2(2 * rr)}` : `⌴ Ø${f2(2 * rr)}${depth > 1e-3 ? ` ↧${f2(depth)}` : ''}`;
      });
      if (th) hole.thread = th;
      const key = parts.join('|');
      (groups.get(key) || groups.set(key, []).get(key)).push({ a, r, parts });
    }
    if (opts.dims !== false) {
      for (const [, list] of groups) {
        const { a, r, parts } = list[0];
        const tip = [a[0] + r * 0.707, a[1] - r * 0.707], knee = [tip[0] + 6, tip[1] - 6 - 4 * (parts.length - 1)];
        line(tip, knee, 'dim'); line(knee, [knee[0] + 22, knee[1]], 'dim');
        parts.forEach((txt, i) => text(knee[0] + 1, knee[1] - 1 + 4.2 * i + (i ? 1.5 : 0), `${i === 0 && list.length > 1 ? list.length + '× ' : ''}${txt}`, 'dtx', 'start'));
      }
    }
  }

  // centre lines of cylinders (shafts, bosses, bores): a dash-dot line where the axis lies in the sheet, a
  // cross where it points at the viewer (the top view has its hole crosses already)
  for (const ax of opts.axes || []) {
    for (const k of Object.keys(place)) {
      if (k === 'iso' || !VIEWS[k]) continue;
      const vw = VIEWS[k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
      const along = Math.abs(dot(ax.d, vw.dir)), s = place[k].s || scale, over = 3 / s;
      const P = t => [ax.p[0] + ax.d[0] * t, ax.p[1] + ax.d[1] * t, ax.p[2] + ax.d[2] * t];
      const uv = q => [dot(q, vw.u), dot(q, vw.v)];
      cur = k;
      if (along < 1e-3) line(toSheet(k, uv(P(ax.t0 - over))), toSheet(k, uv(P(ax.t1 + over))), 'ctr');
      else if (along > 0.999 && k !== 'top') {
        const c = toSheet(k, uv(P((ax.t0 + ax.t1) / 2))), r = ax.r * s + 2;
        line([c[0] - r, c[1]], [c[0] + r, c[1]], 'ctr'); line([c[0], c[1] - r], [c[0], c[1] + r], 'ctr');
      }
    }
  }

  // threads the way drawings show them: seen along the axis a thin three-quarter circle (inside the outline of
  // a bolt, outside the core hole of a tapped hole); seen from the side of a bolt two thin lines at the root
  // diameter over the thread length, with the thread's name on a leader
  for (const t of opts.threads || []) {
    const Rn = t.outside ? t.r : t.r + 0.5413 * t.P, thin = t.outside ? Rn - 0.6134 * t.P : Rn; // nominal / thin line radius
    for (const k of Object.keys(place)) {
      if (k === 'iso' || !VIEWS[k]) continue;
      const vw = VIEWS[k], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], s = place[k].s || scale;
      const uv = q => [dot(q, vw.u), dot(q, vw.v)], along = Math.abs(dot(t.d, vw.dir));
      cur = k;
      if (along > 0.999) {
        const c = toSheet(k, uv(t.c)), r = thin * s, a0 = (20 * Math.PI) / 180, a1 = a0 + 1.5 * Math.PI;
        const P0 = [c[0] + r * Math.cos(a0), c[1] - r * Math.sin(a0)], P1 = [c[0] + r * Math.cos(a1), c[1] - r * Math.sin(a1)];
        L.push(`<path d="M${P0[0].toFixed(3)} ${P0[1].toFixed(3)}A${r.toFixed(3)} ${r.toFixed(3)} 0 1 0 ${P1[0].toFixed(3)} ${P1[1].toFixed(3)}" class="dim" fill="none"/>`);
      } else if (along < 1e-3 && !t.outside) {
        // tapped hole seen from the side: it lies inside the part, so thin dashed lines at the nominal diameter
        // over the thread length and one across its end
        const e = [t.c[0] + t.d[0] * t.L, t.c[1] + t.d[1] * t.L, t.c[2] + t.d[2] * t.L];
        const A = toSheet(k, uv(t.c)), B = toSheet(k, uv(e)), dx = B[0] - A[0], dy = B[1] - A[1], L0 = Math.hypot(dx, dy) || 1, nx = (-dy / L0) * Rn * s, ny = (dx / L0) * Rn * s;
        line([A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], 'thr'); line([A[0] - nx, A[1] - ny], [B[0] - nx, B[1] - ny], 'thr');
        line([B[0] + nx, B[1] + ny], [B[0] - nx, B[1] - ny], 'thr');
      } else if (along < 1e-3 && t.outside) {
        const e = [t.c[0] + t.d[0] * t.L, t.c[1] + t.d[1] * t.L, t.c[2] + t.d[2] * t.L];
        const A = toSheet(k, uv(t.c)), B = toSheet(k, uv(e)), dx = B[0] - A[0], dy = B[1] - A[1], L0 = Math.hypot(dx, dy) || 1, nx = (-dy / L0) * thin * s, ny = (dx / L0) * thin * s;
        line([A[0] + nx, A[1] + ny], [B[0] + nx, B[1] + ny], 'dim'); line([A[0] - nx, A[1] - ny], [B[0] - nx, B[1] - ny], 'dim');
        if (opts.dims !== false) {
          // name on a leader from the outline, halfway along the thread
          const on = (-dy / L0) * Rn * s, oy = (dx / L0) * Rn * s, sg = Math.abs(oy) > 1e-6 ? (oy > 0 ? -1 : 1) : on >= 0 ? 1 : -1; // on the upper side of the bolt (right of an upright one)
          const tip = [(A[0] + B[0]) / 2 + on * sg, (A[1] + B[1]) / 2 + oy * sg], knee = [tip[0] + 6, tip[1] - 6], name = String(t.name).replace('.', ',');
          line(knee, tip, 'dim arrow1'); line(knee, [knee[0] + Math.max(10, name.length * 1.9), knee[1]], 'dim');
          text(knee[0] + 1, knee[1] - 1.2, name, 'dtx', 'start');
        }
      }
    }
  }

  // overall dimensions
  if (opts.dims !== false) {
    const hdim = (k, y0off) => {
      cur = k;
      const e = E[k], pl = place[k];
      const x0 = pl.x, x1 = pl.x + e.w * scale, y = pl.y - y0off;
      line([x0, pl.y - 1], [x0, y - 2], 'ext'); line([x1, pl.y - 1], [x1, y - 2], 'ext');
      line([x0, y], [x1, y], 'dim arrow2');
      text((x0 + x1) / 2, y - 1.5, f2(e.w), 'dtx');
    };
    const vdim = (k, xoff) => {
      cur = k;
      const e = E[k], pl = place[k];
      const y0 = pl.y, y1 = pl.y + e.h * scale, x = pl.x - xoff;
      line([pl.x - 1, y0], [x - 2, y0], 'ext'); line([pl.x - 1, y1], [x - 2, y1], 'ext');
      line([x, y0], [x, y1], 'dim arrow2');
      text(x - 1.5, (y0 + y1) / 2, f2(e.h), 'dtx', 'middle', -90);
    };
    if (place.front) { hdim('front', 8); vdim('front', 8); }
    if (place.top) vdim('top', 8);
  }

  // ----- user dimensions (picked on the sheet): stored in view coordinates, so they follow scale and view -----
  // each one in its own group (the drawing window moves them with the mouse), every line with a wide
  // invisible twin so the thin lines can be grabbed
  const drawUserDim = dm => {
    // text behind the number: tolerance, fit, count ("±0,1", "H7", "2×")
    const sfx = dm.txt ? ' ' + String(dm.txt) : '';
    // surface texture symbol (ISO 1302, material removal required): the tip on the surface, the value above
    // the bar; ang turns it (0 = standing on a top edge, 90 = on a left face, …)
    if (dm.kind === 'surf') {
      const p = toSheet(dm.view, dm.a), th = ((+dm.ang || 0) * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
      const R = (x, y) => [p[0] + x * co + y * si, p[1] - x * si + y * co]; // turned counter-clockwise on the sheet
      const tx = String(dm.text || ''), w = Math.max(5, tx.length * 1.9 + 1.5);
      line(R(0, 0), R(-1.75, -3), 'dim'); line(R(0, 0), R(3.5, -6), 'dim');
      // forms: material removal required (bar), any process (open), no removal (circle in the V)
      if (dm.sym === 'none') { const c = R(0, -2.1); circle(c[0], c[1], 1.05); }
      else if (dm.sym !== 'any') line(R(-1.75, -3), R(1.75, -3), 'dim');
      line(R(3.5, -6), R(3.5 + w, -6), 'dim');
      const t = R(4.2, -7);
      text(t[0], t[1], tx, 'dtx', 'start', -(+dm.ang || 0));
      return;
    }
    // datum feature: filled triangle on the surface, stem, letter in a square (ang turns it like a surface symbol)
    if (dm.kind === 'datum') {
      const p = toSheet(dm.view, dm.a), th = ((+dm.ang || 0) * Math.PI) / 180, co = Math.cos(th), si = Math.sin(th);
      const R = (x, y) => [p[0] + x * co + y * si, p[1] - x * si + y * co];
      const f = q => q.map(v => v.toFixed(3)).join(' ');
      L.push(`<path d="M${f(R(-1.6, 0))}L${f(R(1.6, 0))}L${f(R(0, -2.8))}Z" class="dim" fill="#000"/>`);
      line(R(0, -2.8), R(0, -7), 'dim');
      const c = R(0, -10), hs = 3;
      line([c[0] - hs, c[1] - hs], [c[0] + hs, c[1] - hs], 'dim'); line([c[0] + hs, c[1] - hs], [c[0] + hs, c[1] + hs], 'dim');
      line([c[0] + hs, c[1] + hs], [c[0] - hs, c[1] + hs], 'dim'); line([c[0] - hs, c[1] + hs], [c[0] - hs, c[1] - hs], 'dim');
      text(c[0], c[1] + 1.3, String(dm.text || 'A'), 'dtx');
      return;
    }
    // geometric tolerance: leader with arrow, then the frame [symbol | tolerance | datums …]
    if (dm.kind === 'gdt') {
      const p = toSheet(dm.view, dm.a), ang = ((+dm.ang || 45) * Math.PI) / 180, ux = Math.cos(ang), uy = -Math.sin(ang), len = +dm.off || 14;
      const knee = [p[0] + ux * len, p[1] + uy * len], right = ux >= 0;
      line(knee, p, 'dim arrow1');
      const cells = String(dm.text || '').trim().split(/[\s|]+/).filter(Boolean), H = 6, ws = [7, ...cells.map(c => Math.max(7, c.length * 1.9 + 2.6))];
      const total = ws.reduce((a, b) => a + b, 0), x0 = right ? knee[0] + 3 : knee[0] - 3 - total, y0 = knee[1] - H / 2;
      line(knee, [right ? x0 : x0 + total, knee[1]], 'dim');
      line([x0, y0], [x0 + total, y0], 'dim'); line([x0, y0 + H], [x0 + total, y0 + H], 'dim');
      let x = x0;
      line([x, y0], [x, y0 + H], 'dim');
      ws.forEach((w, i) => {
        if (i) text(x + w / 2, knee[1] + 1.3, cells[i - 1], 'dtx');
        x += w;
        line([x, y0], [x, y0 + H], 'dim');
      });
      // the characteristic, drawn (fonts differ too much in these signs)
      const cx = x0 + 3.5, cy = knee[1], g = (x1, y1, x2, y2) => line([cx + x1, cy + y1], [cx + x2, cy + y2], 'dim');
      switch (dm.sym || 'pos') {
        case 'straight': g(-2.2, 0, 2.2, 0); break;
        case 'flat': g(-2.2, 1.2, -1, -1.2); g(-1, -1.2, 2.2, -1.2); g(2.2, -1.2, 1, 1.2); g(1, 1.2, -2.2, 1.2); break;
        case 'round': circle(cx, cy, 1.6); break;
        case 'cyl': circle(cx, cy, 1.15); g(-2.5, 1.6, -1.3, -1.6); g(1.3, 1.6, 2.5, -1.6); break;
        case 'par': g(-1.7, 1.6, -0.5, -1.6); g(0.5, 1.6, 1.7, -1.6); break;
        case 'perp': g(-2, 1.5, 2, 1.5); g(0, 1.5, 0, -1.8); break;
        case 'angle': g(-2, 1.5, 2, 1.5); g(-2, 1.5, 1.5, -1.5); break;
        case 'conc': circle(cx, cy, 1.7); circle(cx, cy, 0.9); break;
        case 'sym': g(-2.2, 0, 2.2, 0); g(-1.3, -1.1, 1.3, -1.1); g(-1.3, 1.1, 1.3, 1.1); break;
        case 'run': g(-1.6, 1.6, 1.6, -1.6); g(1.6, -1.6, 0.3, -1.3); g(1.6, -1.6, 1.3, -0.3); break;
        default: circle(cx, cy, 1.3); g(-2.2, 0, 2.2, 0); g(0, -2.2, 0, 2.2); // position
      }
      return;
    }
    // note with a leader: arrow at the picked point, text at the end of the leader
    if (dm.kind === 'note') {
      const p = toSheet(dm.view, dm.a), ang = ((+dm.ang || 45) * Math.PI) / 180, ux = Math.cos(ang), uy = -Math.sin(ang), len = +dm.off || 14;
      const knee = [p[0] + ux * len, p[1] + uy * len], right = ux >= 0;
      line(knee, p, 'dim arrow1');
      const rows = String(dm.text || '').split('\n'), w = Math.max(6, ...rows.map(r => r.length * 1.9));
      line(knee, [knee[0] + (right ? w : -w), knee[1]], 'dim');
      rows.forEach((r, i) => text(knee[0] + (right ? 1 : -1), knee[1] - 1.2 - 4.2 * (rows.length - 1 - i), r, 'dtx', right ? 'start' : 'end'));
      return;
    }
    // angle between two legs from a common corner: arc with arrows, the number outside the arc
    if (dm.kind === 'ang') {
      const V = toSheet(dm.view, dm.v), A = toSheet(dm.view, dm.a), B = toSheet(dm.view, dm.b);
      let a0 = Math.atan2(A[1] - V[1], A[0] - V[0]), a1 = Math.atan2(B[1] - V[1], B[0] - V[0]);
      let sw = a1 - a0;
      while (sw > Math.PI) sw -= 2 * Math.PI;
      while (sw < -Math.PI) sw += 2 * Math.PI;
      const rad = Math.max(4, +dm.off || 16), at = t => [V[0] + rad * Math.cos(a0 + sw * t), V[1] + rad * Math.sin(a0 + sw * t)];
      // legs out to just beyond the arc where the edge is shorter
      for (const P of [A, B]) { const L0 = Math.hypot(P[0] - V[0], P[1] - V[1]) || 1; if (L0 < rad + 2) line(P, [V[0] + ((P[0] - V[0]) / L0) * (rad + 2), V[1] + ((P[1] - V[1]) / L0) * (rad + 2)], 'ext'); }
      const n = Math.max(8, Math.ceil((Math.abs(sw) * rad) / 1.5));
      for (let i = 1; i < n - 1; i++) line(at(i / n), at((i + 1) / n), 'dim');
      line(at(1 / n), at(0), 'dim arrow1');
      line(at((n - 1) / n), at(1), 'dim arrow1');
      const m = at(0.5), mx = (m[0] - V[0]) / rad, my = (m[1] - V[1]) / rad;
      text(m[0] + mx * 3.2, m[1] + my * 3.2 + 1.2, `${f2((Math.abs(sw) * 180) / Math.PI)}°${sfx}`, 'dtx');
      return;
    }
    // diameter / radius of a circle: leader through the centre at an angle, text outside
    if (dm.kind === 'dia' || dm.kind === 'rad') {
      const c = toSheet(dm.view, dm.c), rr = (+dm.r) * viewScale(dm.view);
      const ang = ((+dm.ang || 45) * Math.PI) / 180, ux = Math.cos(ang), uy = -Math.sin(ang);
      const outer = [c[0] + ux * (rr + 9), c[1] + uy * (rr + 9)];
      if (dm.kind === 'dia') line([c[0] - ux * rr, c[1] - uy * rr], [c[0] + ux * rr, c[1] + uy * rr], 'dim arrow2');
      else line(c, [c[0] + ux * rr, c[1] + uy * rr], 'dim arrow1');
      line([c[0] + ux * rr, c[1] + uy * rr], outer, 'dim');
      const right = ux >= 0, tl = [outer[0] + (right ? 10 : -10), outer[1]];
      line(outer, tl, 'dim');
      const lab = `${dm.kind === 'dia' ? 'Ø' : 'R'}${f2(dm.kind === 'dia' ? 2 * dm.r : dm.r)}${sfx}`;
      line(tl, [outer[0] + (right ? 1 : -1) * Math.max(10, lab.length * 1.9), outer[1]], 'dim');
      text(outer[0] + (right ? 1 : -1), outer[1] - 1.2, lab, 'dtx', right ? 'start' : 'end');
      return;
    }
    const a = toSheet(dm.view, dm.a), b = toSheet(dm.view, dm.b);
    const off = +dm.off || 16;
    const len = dm.kind === 'h' ? Math.abs(dm.a[0] - dm.b[0]) : dm.kind === 'v' ? Math.abs(dm.a[1] - dm.b[1]) : Math.hypot(dm.a[0] - dm.b[0], dm.a[1] - dm.b[1]);
    if (dm.kind === 'h') {
      const y = Math.min(a[1], b[1]) - off;
      line([a[0], a[1] - 1], [a[0], y - 2], 'ext'); line([b[0], b[1] - 1], [b[0], y - 2], 'ext');
      line([a[0], y], [b[0], y], 'dim arrow2');
      text((a[0] + b[0]) / 2, y - 1.5, f2(len) + sfx, 'dtx');
    } else if (dm.kind === 'v') {
      const x = Math.max(a[0], b[0]) + off;
      line([a[0] + 1, a[1]], [x + 2, a[1]], 'ext'); line([b[0] + 1, b[1]], [x + 2, b[1]], 'ext');
      line([x, a[1]], [x, b[1]], 'dim arrow2');
      text(x - 1.5, (a[1] + b[1]) / 2, f2(len) + sfx, 'dtx', 'middle', -90);
    } else {
      const dx = b[0] - a[0], dy = b[1] - a[1], L0 = Math.hypot(dx, dy) || 1;
      let nx = -dy / L0, ny = dx / L0;
      if (ny > 0) { nx = -nx; ny = -ny; } // dimension line above / left of the edge
      const A2 = [a[0] + nx * off, a[1] + ny * off], B2 = [b[0] + nx * off, b[1] + ny * off];
      line(a, [A2[0] + nx * 2, A2[1] + ny * 2], 'ext'); line(b, [B2[0] + nx * 2, B2[1] + ny * 2], 'ext');
      line(A2, B2, 'dim arrow2');
      let ang = (Math.atan2(dy, dx) * 180) / Math.PI;
      if (ang > 90) ang -= 180; if (ang < -90) ang += 180;
      text((A2[0] + B2[0]) / 2 + nx * 1.5, (A2[1] + B2[1]) / 2 + ny * 1.5, f2(len) + sfx, 'dtx', 'middle', ang);
    }
    };
  (opts.userDims || []).forEach((dm, di) => {
    if (!place[dm.view] && !DET[dm.view]) return;
    cur = dm.view;
    L.push(`<g class="udim" data-dim="${di}">`);
    hitLines = true;
    drawUserDim(dm);
    hitLines = false;
    L.push('</g>');
  });

  // ----- detail view: a circle of a view, enlarged (Fusion: "Detailansicht") -----
  const detailInfo = {};
  let clipNo = 0;
  for (const [key, dd] of Object.entries(DET)) {
    const { k, f, s0, C, D, r, R2, letter } = dd;
    if (!G[k]) continue;
    const clipId = 'detclip' + (clipNo++ || '');
    // only the part's own lines (no dimension lines without their numbers)
    const src = G[k].filter(x => /class="(vis|hid|hatch|ctr)"/.test(x));
    // circle and letter on the parent view
    cur = k;
    L.push(`<circle cx="${C[0].toFixed(2)}" cy="${C[1].toFixed(2)}" r="${r.toFixed(2)}" class="detc"/>`);
    text(C[0] + r * 0.75 + 1.5, C[1] - r * 0.75 - 1, letter, 'secl', 'start');
    // the enlarged copy, clipped to its circle; strokes keep their width
    cur = key;
    L.push(`<clipPath id="${clipId}"><circle cx="${D[0].toFixed(2)}" cy="${D[1].toFixed(2)}" r="${R2.toFixed(2)}"/></clipPath>`);
    L.push(`<g clip-path="url(#${clipId})"><g class="det" transform="translate(${D[0].toFixed(3)} ${D[1].toFixed(3)}) scale(${f}) translate(${(-C[0]).toFixed(3)} ${(-C[1]).toFixed(3)})">${src.join('')}</g></g>`);
    L.push(`<circle cx="${D[0].toFixed(2)}" cy="${D[1].toFixed(2)}" r="${R2.toFixed(2)}" class="detc"/>`);
    text(D[0], D[1] + R2 + 5, `Detail ${letter} (${scaleLabel(s0 * f)})`, 'lbl sec');
    detailInfo[key] = { x: D[0] - R2 - 4, y: D[1] - R2 - 4, w: 2 * R2 + 8, h: 2 * R2 + 12 };
  }

  // ----- balloons (Positionsnummern) in the isometric view, pointing at each part -----
  if (opts.parts?.length && opts.balloons && place.iso) {
    cur = 'iso';
    const e = E.iso, pl = place.iso, s = pl.s;
    const vc = [pl.x + (e.w * s) / 2, pl.y + (e.h * s) / 2];
    const U = new THREE.Vector3(...VIEWS.iso.u), Vv = new THREE.Vector3(...VIEWS.iso.v);
    opts.parts.forEach((part, i) => {
      const b = bodies.find(x => (part.ids || []).includes(x.id));
      if (!b) return;
      const cen = b.geometry.boundingBox.getCenter(new THREE.Vector3());
      const tip = toSheet('iso', [cen.dot(U), cen.dot(Vv)]);
      // balloon outward from the view centre, spread by part
      let dx = tip[0] - vc[0], dy = tip[1] - vc[1];
      const L0 = Math.hypot(dx, dy);
      if (L0 < 1e-6) { const a0 = -Math.PI / 4 + i * 0.9; dx = Math.cos(a0); dy = Math.sin(a0); } else { dx /= L0; dy /= L0; }
      const R0 = Math.max(e.w, e.h) * s * 0.5 + 10 + (i % 2) * 4;
      const bc = [vc[0] + dx * R0, vc[1] + dy * R0];
      L.push(`<circle cx="${tip[0].toFixed(2)}" cy="${tip[1].toFixed(2)}" r=".6" fill="#000"/>`);
      line(tip, [bc[0] - dx * 4, bc[1] - dy * 4], 'dim');
      L.push(`<circle cx="${bc[0].toFixed(2)}" cy="${bc[1].toFixed(2)}" r="4" class="balloon"/>`);
      text(bc[0], bc[1] + 1.4, String(i + 1), 'btx');
    });
  }

  // ----- parts list (Stückliste) above the title block -----
  cur = 'sheet';
  const t = opts.title || {};
  const tbW = 180, tx = SW - 10 - tbW, ty = SH - 10 - tbH;
  if (opts.parts?.length) {
    const cols = [[10, 'Pos.'], [14, 'Menge'], [80, 'Benennung'], [40, 'Werkstoff'], [36, 'Masse']];
    const rows = [...opts.parts.map((p, i) => [String(i + 1), String(p.qty || 1), p.name, p.material || '', p.mass || '']).reverse(), cols.map(c => c[1])];
    rows.forEach((r, ri) => {
      let x = tx;
      const y = ty - 6 * (ri + 1);
      r.forEach((v, ci) => {
        L.push(`<rect x="${x}" y="${y}" width="${cols[ci][0]}" height="6" class="tb"/>`);
        text(x + 1.5, y + 4.3, v, ri === rows.length - 1 ? 'tbl hd' : 'tbv sm', 'start');
        x += cols[ci][0];
      });
    });
  }
  const cell = (x, y, w, h, label, value, big) => {
    L.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" class="tb"/>`);
    text(x + 1.5, y + 3, label, 'tbl', 'start');
    text(x + 1.5, y + h - 2.2, value, big ? 'tbv big' : 'tbv', 'start');
  };
  cell(tx, ty, 110, 16, 'Benennung', t.name, true);
  cell(tx + 110, ty, 70, 16, 'Zeichnungsnummer', t.number);
  cell(tx, ty + 16, 40, 16, 'Werkstoff', t.material);
  cell(tx + 40, ty + 16, 25, 16, 'Maßstab', scaleLabel(scale));
  cell(tx + 65, ty + 16, 30, 16, 'Masse', t.mass);
  cell(tx + 95, ty + 16, 30, 16, 'Datum', new Date().toLocaleDateString('de-DE'));
  cell(tx + 125, ty + 16, 35, 16, 'Gezeichnet', t.author);
  cell(tx + 160, ty + 16, 20, 16, 'Blatt', '1/1');
  text(tx + tbW - 2, ty - 2 - (opts.parts?.length ? (opts.parts.length + 1) * 6 : 0), 'Projektionsmethode 1 (ISO-E) · Maße in mm · Allgemeintoleranz ISO 2768-m', 'tbl', 'end');

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${SW}mm" height="${SH}mm" viewBox="0 0 ${SW} ${SH}">
<defs><marker id="ar" viewBox="0 0 10 4" refX="10" refY="2" markerUnits="userSpaceOnUse" markerWidth="2.5" markerHeight="1" orient="auto-start-reverse"><path d="M0,0 L10,2 L0,4 z" fill="#000"/></marker>
<pattern id="hatch" width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="2" stroke="#000" stroke-width=".18"/></pattern></defs>
<style>
.vis{stroke:#000;stroke-width:.5;stroke-linecap:round}
.hid{stroke:#000;stroke-width:.25;stroke-dasharray:2 1}
.ctr{stroke:#000;stroke-width:.18;stroke-dasharray:6 1 1 1}
.dim,.ext{stroke:#000;stroke-width:.18}
.thr{stroke:#000;stroke-width:.18;stroke-dasharray:2 1}
.hit{stroke:#000;stroke-opacity:0;stroke-width:3;fill:none}
.arrow2{marker-start:url(#ar);marker-end:url(#ar)}.arrow1{marker-end:url(#ar)}
.hatch{fill:url(#hatch);stroke:none}.det line,.det path{vector-effect:non-scaling-stroke}.detc{fill:none;stroke:#000;stroke-width:.35}
.tbl.hd{font-size:2.6px;font-weight:600;fill:#000}.tbv.sm{font-size:3px}
.balloon{fill:#fff;stroke:#000;stroke-width:.3}.btx{font-family:'Segoe UI',Arial,sans-serif;font-size:4px;font-weight:600;text-anchor:middle}
.cut{stroke:#000;stroke-width:.18;stroke-dasharray:8 1.5 1 1.5}.cutend{stroke:#000;stroke-width:.7}
.secl{font-family:'Segoe UI',Arial,sans-serif;font-size:5px;font-weight:600;text-anchor:middle}.lbl.sec{font-size:3.5px;font-weight:600;font-style:normal}
.txt,.lbl,.dtx,.tbl,.tbv{font-family:'Segoe UI',Arial,sans-serif;fill:#000}
.lbl{font-size:3px;font-style:italic}.dtx{font-size:3.5px}.tbl{font-size:2.2px;fill:#444}.tbv{font-size:3.5px}.tbv.big{font-size:5px;font-weight:600}
.tb,.frame{fill:none;stroke:#000;stroke-width:.35}
</style>
<rect x="0" y="0" width="${SW}" height="${SH}" fill="#fff"/>
<rect x="${margin}" y="10" width="${SW - margin - 10}" height="${SH - 20}" class="frame"/>
${Object.entries(G).map(([k, arr]) => (k === 'sheet' ? arr.join('\n') : `<g data-view="${k}">\n${arr.join('\n')}\n</g>`)).join('\n')}
</svg>`;
  // area of every view on the sheet (with its dimensions), for picking it up with the mouse
  const views = Object.fromEntries(Object.keys(place).map(k => { const e = E[k], pl = place[k], s = pl.s || scale; return [k, { x: pl.x - 14, y: pl.y - 14, w: e.w * s + 28, h: e.h * s + 24 }]; }));
  Object.assign(views, detailInfo);
  // for picking points on the sheet: the mapping sheet ↔ view coordinates and the corner points of every view
  const xf = Object.fromEntries(Object.keys(place).map(k => [k, { px: place[k].x, py: place[k].y, x0: E[k].x0, y1: E[k].y1, s: place[k].s || scale }]));
  const snaps = {};
  for (const k of Object.keys(place)) {
    if (k === 'iso') continue;
    const seen = new Set(), out = [];
    for (const [a, b] of segs[k].vis) for (const p of [a, b]) { const key = p[0].toFixed(2) + ',' + p[1].toFixed(2); if (!seen.has(key)) { seen.add(key); out.push(p); } }
    snaps[k] = out;
  }
  // circles seen face-on in the top view (holes, bosses), for diameter dimensions by clicking
  const circlesOf = { top: holes.map(hh => { const rs = [...hh.rs.keys()].map(Number); return { c: [hh.cx, -hh.cy], rs }; }) };
  // details: picked like their parent view, with the corners and circles inside their circle
  const details = [];
  for (const [key, dd] of Object.entries(DET)) {
    if (!detailInfo[key]) continue;
    const pl = place[dd.k], e = E[dd.k], inside = p => Math.hypot(p[0] - dd.c[0], p[1] - dd.c[1]) <= dd.rv + 1e-6;
    xf[key] = { px: dd.D[0] + dd.f * (pl.x - dd.C[0]), py: dd.D[1] + dd.f * (pl.y - dd.C[1]), x0: e.x0, y1: e.y1, s: dd.s0 * dd.f };
    snaps[key] = (snaps[dd.k] || []).filter(inside);
    circlesOf[key] = (circlesOf[dd.k] || []).filter(ci => ci.rs.some(r => Math.abs(Math.hypot(ci.c[0] - dd.c[0], ci.c[1] - dd.c[1]) - r) <= dd.rv));
    details.push({ key, letter: dd.letter, view: dd.k });
  }
  return { svg, scale, scaleLabel: scaleLabel(scale), warnings, holes: holes.length, views, xf, snaps, circles: circlesOf, details, sections: Object.fromEntries(Object.entries(secs).map(([k, s]) => [k, s.letter])) };
}
