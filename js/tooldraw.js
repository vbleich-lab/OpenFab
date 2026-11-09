// Tool catalog (like Fusion's "Neues Werkzeug") and tool geometry: one side profile
// per tool type, used for the 3D view, the 2D drawing and the small icons.
import * as THREE from 'three';
import { defaultFluteLen, defaultHolderDia, defaultStickout } from './sim.js';

// [type, label, defaults]
export const TOOL_CATALOG = [
  ['Fräsen', [
    ['ball', 'Kugelkopffräser', { dia: 6, flutes: 2 }],
    ['torus', 'Torusfräser', { dia: 10, cornerR: 1, flutes: 4 }],
    ['flat', 'Schaftfräser', { dia: 6, flutes: 3 }],
    ['facemill', 'Planfräser', { dia: 50, flutes: 5, fluteLen: 6, shaftDia: 22 }],
    ['tapered', 'Konusfräser', { dia: 6, angle: 5, cornerR: 0.5, taperTip: 'torus', flutes: 3 }],
    ['radius', 'Radienfräser', { dia: 12, cornerR: 3, tip: 6, flutes: 3 }],
    ['chamfer', 'Gravur-/Fasenfräser', { dia: 10, angle: 90, tip: 0, flutes: 2 }],
    ['dovetail', 'Schwalbenschwanzfräser', { dia: 16, angle: 60, fluteLen: 5, neckDia: 7, flutes: 6 }],
    ['lollipop', 'Lollipop-Fräser', { dia: 8, neckDia: 4, flutes: 6 }],
    ['slot', 'Nutenfräser', { dia: 20, fluteLen: 4, neckDia: 8, flutes: 8 }],
    ['thread', 'Gewindefräser', { dia: 6, pitch: 1, flutes: 3 }],
    ['barrel', 'Kreissegment Tonne', { dia: 10, cornerR: 1, profileR: 85, flutes: 4 }],
    ['lens', 'Kreissegment Linse', { dia: 12, profileR: 40, flutes: 4 }],
    ['oval', 'Kreissegment Oval', { dia: 10, profileR: 25, cornerR: 2, flutes: 4 }],
    ['segtaper', 'Kreissegment Verjüngung', { dia: 10, profileR: 75, angle: 20, cornerR: 1, flutes: 4 }],
  ]],
  ['Bohren', [
    ['boringbar', 'Bohrstange', { dia: 16, fluteLen: 40, shaftDia: 12, flutes: 1 }],
    ['counterbore', 'Zylindrische Senkung', { dia: 11, tip: 6.6, flutes: 3 }],
    ['drill', 'Bohrer', { dia: 6, angle: 118, flutes: 2 }],
    ['center', 'Zentrierbohrer', { dia: 6.3, tip: 2.5, angle: 60, flutes: 2 }],
    ['spot', 'NC-Anbohrer', { dia: 10, angle: 90, flutes: 2 }],
    ['ream', 'Reibahle', { dia: 6, flutes: 6 }],
    ['countersink', 'Konische Senkung', { dia: 16, angle: 90, tip: 3, flutes: 3 }],
    ['tapLeft', 'Linksgewinde', { dia: 6, pitch: 1, flutes: 3, hand: 'left' }],
    ['tap', 'Rechtsgewinde', { dia: 6, pitch: 1, flutes: 3 }],
  ]],
  ['Drehen', [
    ['turn', 'Drehen - allgemein', { dia: 12, noseRadius: 0.4 }],
    ['turnbore', 'Drehen - Bohren', { dia: 12, noseRadius: 0.4 }],
    ['groove', 'Drehen - Einstechen', { dia: 12, width: 3 }],
    ['tthread', 'Drehen - Gewinde', { dia: 12, pitch: 1.5 }],
  ]],
  ['Schneiden', [
    ['waterjet', 'Wasserstrahl', { dia: 1, kerf: 1 }],
    ['laser', 'Laserschneidwerkzeug', { dia: 0.2, kerf: 0.2 }],
    ['plasma', 'Plasmaschneider', { dia: 1.5, kerf: 1.5 }],
  ]],
  ['Antasten', [['probe', 'Antasten', { dia: 6, fluteLen: 6 }]]],
  ['Halter', [['holder', 'Halter', { dia: 40 }]]],
  ['Ablage', [
    ['arcwire', 'Lichtbogendraht', { dia: 1.2 }],
    ['laserpowder', 'Laser-Pulver', { dia: 1 }],
    ['laserwire', 'Laserdraht', { dia: 1 }],
  ]],
];
export const CATALOG_LABEL = Object.fromEntries(TOOL_CATALOG.flatMap(([, list]) => list.map(([k, l]) => [k, l])));
export const CATALOG_DEFAULTS = Object.fromEntries(TOOL_CATALOG.flatMap(([, list]) => list.map(([k, , d]) => [k, d])));
const TURNING = ['turn', 'turnbore', 'groove', 'tthread'];
const CUTTING = ['waterjet', 'laser', 'plasma'];
const ADDITIVE = ['arcwire', 'laserpowder', 'laserwire'];
export const toolCategory = type => (TOOL_CATALOG.find(([, list]) => list.some(([k]) => k === type)) || ['Fräsen'])[0];

// geometry helpers with defaults
export const shaftDia = t => +(t.shaftDia ?? (t.type === 'tapered' ? +t.dia + 2 * (+t.fluteLen || defaultFluteLen(t)) * Math.tan(((+t.angle || 5) * Math.PI) / 180) : t.dia < 3 ? 3 : t.dia < 6 ? 6 : Math.ceil(t.dia)));
export const fluteLen = t => +(t.fluteLen ?? (['slot', 'dovetail'].includes(t.type) ? Math.max(2, t.dia / 4) : t.type === 'facemill' ? 6 : defaultFluteLen(t)));
export const stickout = t => +(t.stickout ?? defaultStickout({ ...t, fluteLen: fluteLen(t) }));
export const totalLen = t => +(t.length ?? Math.round(stickout(t) + Math.max(15, 2 * shaftDia(t))));
export const shoulderLen = t => +(t.shoulderLen ?? Math.min(stickout(t), fluteLen(t) * (shaftDia(t) > t.dia && !['tapered'].includes(t.type) ? 1.5 : 1)));
export const gaugeLen = t => +(t.gauge ?? stickout(t));
export const holderSegments = t => (Array.isArray(t.holder?.segments) && t.holder.segments.length ? t.holder.segments
  : [{ h: 8, d1: +(t.holderDia ?? defaultHolderDia(t)), d2: +(t.holderDia ?? defaultHolderDia(t)) }, { h: 25, d1: +(t.holderDia ?? defaultHolderDia(t)) * 1.1, d2: +(t.holderDia ?? defaultHolderDia(t)) * 1.5 }, { h: 15, d1: 63, d2: 63 }]);

const arc = (cx, cz, r, a0, a1, n = 12) => Array.from({ length: n + 1 }, (_, i) => { const a = a0 + ((a1 - a0) * i) / n; return [cx + r * Math.cos(a), cz + r * Math.sin(a)]; });

// Right half side profile [r, z] from the tip (z = 0) up to the top of the visible tool.
// Returns { pts, flute } – everything up to z = flute is the cutting part.
export function toolProfile(t) {
  const D = Math.max(0.05, +t.dia || 6), R = D / 2, F = fluteLen(t), S = shaftDia(t) / 2, L = Math.max(stickout(t), F + 1);
  const SH = Math.max(F, shoulderLen(t));
  const deg = Math.PI / 180;
  const cr = Math.max(0, Math.min(+t.cornerR || 0, R));
  let pts = [];
  const type = t.type === 'tapLeft' ? 'tap' : t.type;
  switch (type) {
    case 'ball': pts = [[0, 0], ...arc(0, R, R, -Math.PI / 2, 0).slice(1), [R, F]]; break;
    case 'form': pts = Array.isArray(t.profileDraw) && t.profileDraw.length > 1 ? t.profileDraw.map(p => [+p[0], +p[1]]) : [[0, 0], [R, 0], [R, F]]; break;
    case 'torus': pts = [[0, 0], [R - cr, 0], ...arc(R - cr, cr, cr, -Math.PI / 2, 0).slice(1), [R, F]]; break;
    case 'tapered': {
      const a = (+t.angle || 5) * deg, tip = t.taperTip || 'torus';
      const c = tip === 'ball' ? R : tip === 'flat' ? 0 : Math.min(cr, R);
      const top = R + Math.max(0, F - c) * Math.tan(a);
      pts = c > 0 ? [[0, 0], [R - c, 0], ...arc(R - c, c, c, -Math.PI / 2, -a).slice(1), [top, F]] : [[0, 0], [R, 0], [top, F]];
      break;
    }
    case 'radius': {
      const rt = Math.max(0.1, (+t.tip || D / 2) / 2), rr = Math.max(0.2, cr || (R - rt));
      pts = [[0, 0], [rt, 0], ...arc(rt + rr, 0, rr, Math.PI, Math.PI / 2).slice(1), [Math.max(R, rt + rr), rr], [Math.max(R, rt + rr), F]];
      break;
    }
    case 'chamfer': case 'spot': case 'countersink': {
      const half = ((+t.angle || 90) / 2) * deg, rt = (+t.tip || 0) / 2;
      const hz = (R - rt) / Math.tan(half);
      pts = [[0, 0], [rt, 0], [R, hz], [R, Math.max(F, hz + 0.5)]];
      break;
    }
    case 'center': {
      const rp = (+t.tip || D * 0.4) / 2, pl = +t.pilotLen || rp * 2.5, half = ((+t.angle || 60) / 2) * deg;
      const hp = rp / Math.tan(59 * deg);
      pts = [[0, 0], [rp, hp], [rp, hp + pl], [R, hp + pl + (R - rp) / Math.tan(half)], [R, F]];
      break;
    }
    case 'drill': { const hz = R / Math.tan(((+t.angle || 118) / 2) * deg); pts = [[0, 0], [R, hz], [R, F]]; break; }
    case 'ream': pts = [[0, 0], [R * 0.85, 0], [R, R * 0.15], [R, F]]; break;
    case 'tap': { const ch = Math.max(+t.pitch || 1, 0.5) * 2.5; pts = [[0, 0], [R * 0.7, 0], [R, ch], [R, F]]; break; }
    case 'thread': {
      const p = Math.max(0.2, +t.pitch || 1), depth = p * 0.6;
      pts = [[0, 0], [R - depth, 0]];
      for (let z = 0; z < F - p; z += p) pts.push([R, z + p / 2], [R - depth, z + p]);
      pts.push([R - depth, F]);
      break;
    }
    case 'dovetail': { const rn = Math.max(0.5, (+t.neckDia || D * 0.4) / 2); pts = [[0, 0], [R, 0], [rn, F]]; break; }
    case 'lollipop': {
      const rn = Math.max(0.3, Math.min(R * 0.95, (+t.neckDia || D * 0.5) / 2));
      const a1 = Math.asin(rn / R);
      pts = [[0, 0], ...arc(0, R, R, -Math.PI / 2, Math.PI / 2 - a1, 20).slice(1), [rn, Math.max(F, 2 * R + 0.5)]];
      break;
    }
    case 'slot': { const rn = Math.max(0.5, (+t.neckDia || D * 0.4) / 2); pts = [[0, 0], [R, 0], [R, F], [rn, F]]; break; }
    case 'barrel': case 'lens': case 'oval': case 'segtaper': {
      // circle segment cutters: shapes from a large profile radius (barrel, lens, oval, taper)
      const n = 24;
      const shape = u => (type === 'barrel' ? 0.55 + 0.45 * Math.sin(Math.PI * u) : type === 'lens' ? 0.25 + 0.75 * Math.sqrt(Math.min(1, u * 1.6)) : type === 'oval' ? 0.4 + 0.6 * Math.sin(Math.PI * (0.1 + 0.9 * u)) : 0.3 + 0.7 * Math.pow(u, 0.6));
      pts = [[0, 0], [R * shape(0) * 0.8, 0]];
      for (let i = 1; i <= n; i++) { const u = i / n; pts.push([R * shape(u), F * u]); }
      break;
    }
    case 'facemill': pts = [[0, 0], [R, 0], [R, F], [S * 1.4, F + 1]]; break;
    case 'counterbore': { const rp = Math.max(0.3, (+t.tip || D * 0.6) / 2); pts = [[0, 0], [rp, 0], [rp, rp * 1.5], [R, rp * 1.5], [R, F]]; break; }
    case 'boringbar': pts = [[0, 0], [R, 0], [R, Math.min(4, F * 0.15)], [S, Math.min(4, F * 0.15) + 1], [S, F]]; break;
    default: pts = [[0, 0], [R, 0], [R, F]];
  }
  // above the cutting part: neck, shoulder and shank
  const top = pts[pts.length - 1];
  const neck = Math.max(0.2, Math.min(top[0], S) * (['ball', 'flat', 'torus'].includes(type) && S > R ? 0.96 : 1));
  if (!['lollipop', 'slot', 'dovetail', 'facemill', 'boringbar'].includes(type)) {
    if (Math.abs(neck - top[0]) > 1e-6) pts.push([neck, F]);
    if (SH > F + 1e-6) pts.push([neck, SH]);
  } else if (SH > top[1]) pts.push([top[0], SH]);
  const last = pts[pts.length - 1];
  if (Math.abs(last[0] - S) > 1e-6) pts.push([S, last[1] + Math.max(0.3, Math.abs(S - last[0]) * 0.8)]);
  const segs = Array.isArray(t.shaft?.segments) ? t.shaft.segments : [];
  if (segs.length) {
    let z = pts[pts.length - 1][1];
    for (const sg of segs) { pts.push([sg.d1 / 2, z], [sg.d2 / 2, z + sg.h]); z += sg.h; }
    if (z < L) pts.push([segs[segs.length - 1].d2 / 2, L]);
  } else pts.push([S, Math.max(L, pts[pts.length - 1][1] + 1)]);
  return { pts: pts.map(([r, z]) => [Math.max(0, r), Math.max(0, z)]), flute: F, top: Math.max(L, pts[pts.length - 1][1]) };
}

// cut a profile at height z: [below, above]
function splitProfile(pts, z) {
  const lo = [], hi = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (p[1] <= z) lo.push(p); else {
      const q = pts[i - 1];
      if (q && q[1] <= z && !hi.length) { const u = (z - q[1]) / (p[1] - q[1]); const m = [q[0] + (p[0] - q[0]) * u, z]; lo.push(m); hi.push(m); }
      hi.push(p);
    }
  }
  return [lo, hi];
}

const kindOf = t => (TURNING.includes(t.type) ? 'turn' : CUTTING.includes(t.type) ? 'cut' : ADDITIVE.includes(t.type) ? 'add' : t.type === 'probe' ? 'probe' : t.type === 'holder' ? 'holder' : 'mill');

// ---------- 2D drawing (Fusion's profile view: grid, axes, scale bar) ----------
export function toolSvg2D(t, { width = 260, height = 360, grid = true, holder = true, icon = false } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('class', icon ? 'tool-icon' : 'tool-svg2');
  if (icon) { svg.setAttribute('width', width); svg.setAttribute('height', height); }
  const add = (tag, attrs) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); svg.append(e); return e; };
  const kind = kindOf(t);
  const mirror = pts => [...pts.map(([r, z]) => [r, z]), ...pts.slice().reverse().map(([r, z]) => [-r, z])];
  let tool = [], cut = [], extra = [], holderPts = [];
  let top = 10, maxR = 1;
  if (kind === 'mill' || kind === 'probe') {
    const pr = toolProfile(t);
    const [lo, hi] = splitProfile(pr.pts, pr.flute);
    cut = mirror(lo); tool = mirror(hi);
    top = pr.top; maxR = Math.max(...pr.pts.map(p => p[0]));
    if (kind === 'probe') { cut = []; extra.push(['circle', +t.dia / 2]); }
  } else if (kind === 'holder') {
    let z = 0; const pts = [];
    for (const s of holderSegments(t)) { pts.push([s.d1 / 2, z], [s.d2 / 2, z + s.h]); z += s.h; }
    tool = mirror([[0, 0], ...pts, [0, z]].filter((p, i) => i === 0 || p[0] > 0 || true)); top = z; maxR = Math.max(...pts.map(p => p[0]));
  } else if (kind === 'cut' || kind === 'add') {
    const r = Math.max(2, +t.dia * 3);
    tool = mirror([[r * 0.25, 4], [r, 4 + r * 1.8], [r * 1.6, 4 + r * 1.8], [r * 1.6, 4 + r * 4]]);
    top = 4 + r * 4; maxR = r * 1.6;
    extra.push(['beam', 4]);
  } else { // turning: shank seen from the side + insert
    const w = 8, len = 30;
    tool = [[-w, 2], [w, 2], [w, len], [-w, len]];
    cut = t.type === 'groove' ? [[-(+t.width || 3) / 2, 0], [(+t.width || 3) / 2, 0], [(+t.width || 3) / 2, 4], [-(+t.width || 3) / 2, 4]] : [[0, 0], [-w * 0.9, 4], [w * 0.4, 4]];
    top = len; maxR = w;
  }
  let hs = 0;
  if (holder && kind === 'mill' && !icon) {
    let z = stickout(t); const pts = [];
    for (const s of holderSegments(t)) { pts.push([s.d1 / 2, z], [s.d2 / 2, z + s.h]); z += s.h; }
    holderPts = mirror(pts); hs = Math.min(z, top + Math.max(10, (z - top) * 0.25)) - top;
  }
  const viewTop = top + Math.max(0, hs);
  const pad = icon ? 2 : 30;
  const s = Math.min((height - 2 * pad) / (viewTop * 1.02), (width - 2 * pad) / (2 * maxR * (icon ? 1.05 : 1.6)));
  const cx = width / 2, base = height - pad;
  const P = pts => pts.map(([x, z]) => `${(cx + x * s).toFixed(2)},${(base - z * s).toFixed(2)}`).join(' ');
  if (grid && !icon) {
    const step = [0.5, 1, 2, 5, 10, 20, 50].find(v => v * s > 18) || 50;
    for (let x = cx % (step * s); x < width; x += step * s) add('line', { x1: x, y1: 0, x2: x, y2: height, class: 'tg' });
    for (let y = base % (step * s); y < height; y += step * s) add('line', { x1: 0, y1: y, x2: width, y2: y, class: 'tg' });
    add('line', { x1: 0, y1: base, x2: width, y2: base, class: 'tax' });
    add('line', { x1: cx, y1: 0, x2: cx, y2: height, class: 'tax' });
    const lz = add('text', { x: cx + 4, y: 12, class: 'taxz' }); lz.textContent = '+Z';
    const lx = add('text', { x: width - 20, y: base - 5, class: 'taxx' }); lx.textContent = '+X';
  }
  if (holderPts.length) { const clip = viewTop; add('polygon', { points: P(holderPts.map(([x, z]) => [x, Math.min(z, clip)])), class: 'th' }); }
  if (tool.length) add('polygon', { points: P(tool), class: kind === 'holder' ? 'th' : 'tsh' });
  if (cut.length) add('polygon', { points: P(cut), class: 'tfl' });
  for (const [k, v] of extra) {
    if (k === 'circle') { add('line', { x1: cx, y1: base - v * s, x2: cx, y2: base - fluteLen(t) * s - v * s, class: 'tstylus' }); add('circle', { cx, cy: base - v * s, r: v * s, class: 'tball' }); }
    if (k === 'beam') add('line', { x1: cx, y1: base - v * s, x2: cx, y2: base, class: kind === 'cut' ? 'tbeam' : 'twire' });
  }
  if (!icon && grid) {
    add('circle', { cx, cy: base, r: 3, class: 'ttip' });
    const step = [1, 2, 5, 10, 20, 50, 100].find(v => v * s > 40) || 100;
    add('path', { d: `M${width - 14 - step * s} ${height - 10} v-4 m0 4 H${width - 14} v-4`, class: 'tscale' });
    const ts = add('text', { x: width - 10 - (step * s) / 2, y: height - 16, class: 'tscalet', 'text-anchor': 'middle' }); ts.textContent = `${step} mm`;
  }
  return svg;
}

// ---------- 3D view (revolved profile with lighting; drag to rotate) ----------
let flutesTex = null;
function fluteTexture() {
  if (flutesTex) return flutesTex;
  const c = document.createElement('canvas');
  c.width = 256; c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = '#9aa3ad'; g.fillRect(0, 0, 256, 256);
  for (let i = -256; i < 512; i += 64) {
    const gr = g.createLinearGradient(i, 0, i + 64, 0);
    gr.addColorStop(0, '#5f6770'); gr.addColorStop(0.45, '#c9d0d8'); gr.addColorStop(0.55, '#e8ecf0'); gr.addColorStop(1, '#4c535b');
    g.save(); g.translate(i, 0); g.transform(1, 0, -0.7, 1, 0, 0); g.fillStyle = gr; g.fillRect(0, 0, 64, 256); g.restore();
  }
  flutesTex = new THREE.CanvasTexture(c);
  flutesTex.wrapS = flutesTex.wrapT = THREE.RepeatWrapping;
  flutesTex.colorSpace = THREE.SRGBColorSpace;
  return flutesTex;
}

export function toolView3D(container, t, { width = 300, height = 420 } = {}) {
  let renderer;
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }); } catch { container.append(toolSvg2D(t, { width, height, grid: false })); return { dispose() {} }; }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setSize(width, height);
  container.append(renderer.domElement);
  const scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0x505860, 2.2));
  const fill = new THREE.DirectionalLight(0xffffff, 0.9); fill.position.set(-4, 1, -2); scene.add(fill);
  const dl = new THREE.DirectionalLight(0xffffff, 2.2); dl.position.set(3, 4, 5); scene.add(dl);
  const group = new THREE.Group();
  scene.add(group);
  const metal = new THREE.MeshStandardMaterial({ color: 0xd2d8de, metalness: 0.25, roughness: 0.38 });
  const holderMat = new THREE.MeshStandardMaterial({ color: 0x8e98a3, metalness: 0.2, roughness: 0.5, transparent: true, opacity: 0.9 });
  const fluteMat = new THREE.MeshStandardMaterial({ map: fluteTexture(), metalness: 0.2, roughness: 0.32 });
  const lathe = (pts, mat) => {
    const v = [new THREE.Vector2(0, pts[0][1]), ...pts.map(([r, z]) => new THREE.Vector2(Math.max(r, 1e-4), z)), new THREE.Vector2(0, pts[pts.length - 1][1])];
    const g = new THREE.LatheGeometry(v, 64);
    const m = new THREE.Mesh(g, mat);
    group.add(m);
    return m;
  };
  const kind = kindOf(t);
  let top = 20;
  if (kind === 'mill' || kind === 'probe') {
    const pr = toolProfile(t);
    const [lo, hi] = splitProfile(pr.pts, pr.flute);
    if (kind === 'probe') {
      lathe([[+t.dia / 6, +t.dia / 2], [+t.dia / 6, pr.flute], ...hi.slice(1)], metal);
      const ball = new THREE.Mesh(new THREE.SphereGeometry(+t.dia / 2, 32, 16), new THREE.MeshStandardMaterial({ color: 0xd22e4a, roughness: 0.35 }));
      ball.position.y = +t.dia / 2; group.add(ball);
    } else {
      const fm = lathe(lo, fluteMat);
      fm.material.map.repeat.set(Math.max(2, +t.flutes || 3), Math.max(1, pr.flute / Math.max(1, +t.dia) / 1.5));
      if (hi.length > 1) lathe(hi, metal);
    }
    top = pr.top;
    // holder
    let z = stickout(t);
    for (const s of holderSegments(t)) { lathe([[s.d1 / 2, z], [s.d2 / 2, z + s.h]], holderMat); z += s.h; }
    top = z;
  } else if (kind === 'holder') {
    let z = 0;
    for (const s of holderSegments(t)) { lathe([[s.d1 / 2, z], [s.d2 / 2, z + s.h]], holderMat); z += s.h; }
    top = z;
  } else if (kind === 'cut' || kind === 'add') {
    const r = Math.max(2, +t.dia * 3);
    lathe([[r * 0.25, 4], [r, 4 + r * 1.8], [r * 1.6, 4 + r * 1.8], [r * 1.6, 4 + r * 4]], metal);
    const beam = new THREE.Mesh(new THREE.CylinderGeometry(Math.max(0.15, +t.dia / 2), Math.max(0.15, +t.dia / 2), 4, 12), new THREE.MeshBasicMaterial({ color: { waterjet: 0x5aa9ff, laser: 0xff3030, plasma: 0xffd040, arcwire: 0xb0b8c0, laserpowder: 0xffd040, laserwire: 0xffb000 }[t.type] || 0xffffff }));
    beam.position.y = 2; group.add(beam);
    top = 4 + r * 4;
  } else {
    const shank = new THREE.Mesh(new THREE.BoxGeometry(16, 16, 60), metal); shank.position.set(0, 10, -24); group.add(shank);
    const ins = new THREE.Mesh(new THREE.CylinderGeometry(0, 7, 3, 3), new THREE.MeshStandardMaterial({ color: 0xd9a514, metalness: 0.5, roughness: 0.4 }));
    ins.rotation.x = Math.PI / 2; ins.position.set(0, 10, 8); group.add(ins);
    top = 30;
  }
  const box = new THREE.Box3().setFromObject(group);
  const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
  const cam = new THREE.PerspectiveCamera(30, width / height, 0.1, 5000);
  const dist = Math.max(size.y / (2 * Math.tan((15 * Math.PI) / 180)), size.x * 1.8) * 1.05;
  let yaw = 0.6, pitch = 0.18;
  const place = () => { cam.position.set(center.x + dist * Math.sin(yaw) * Math.cos(pitch), center.y + dist * Math.sin(pitch), center.z + dist * Math.cos(yaw) * Math.cos(pitch)); cam.lookAt(center); renderer.render(scene, cam); };
  place();
  let drag = null;
  const el = renderer.domElement;
  el.style.cursor = 'grab';
  el.addEventListener('pointerdown', e => { drag = [e.clientX, e.clientY, yaw, pitch]; el.setPointerCapture(e.pointerId); el.style.cursor = 'grabbing'; });
  el.addEventListener('pointermove', e => { if (!drag) return; yaw = drag[2] - (e.clientX - drag[0]) * 0.01; pitch = Math.max(-1.2, Math.min(1.2, drag[3] + (e.clientY - drag[1]) * 0.01)); place(); });
  el.addEventListener('pointerup', () => { drag = null; el.style.cursor = 'grab'; });
  void top;
  return { dispose() { group.traverse(o => o.geometry?.dispose()); renderer.dispose(); el.remove(); } };
}
