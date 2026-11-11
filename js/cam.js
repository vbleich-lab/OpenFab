// Toolpath generation: 2D (face, contour, pocket, chamfer, drill, helical bore)
// and 3D (Z-level roughing, parallel finishing) strategies.
import * as THREE from 'three';
import { entityPolys, entityOutlines, buildRegions, signedArea, ensureCCW, pointInPoly, chainLoops } from './profiles.js';
import { basis, toWorld } from './plane.js';
import { buildHeightmap, dropCutter as dropCutterRaw, cornerOf } from './heightmap.js';

// Surface of the current 3D operation ("Flächen-Manager"): ignored faces are left out of the
// base heightmap, avoided / fixture / machined groups add their own clearance (radial = bigger tool, axial = higher).
let SURF = null, CUR = null;
const grownTools = new WeakMap();
// Stock to leave on 3D surfaces is measured normal to the surface: the height queries use the tool grown by it
// (radius + stl) and add it on top, so steep walls keep it sideways too. Exact for ball cutters; flat and bull
// cutters get it sideways and on top. Form, chamfer and drill tools keep the plain vertical allowance.
const grownStl = new WeakMap();
function growStl(tool, stl) {
  if (!stl || tool.profile || !['ball', 'flat'].includes(toolBase(tool))) return tool;
  let m = grownStl.get(tool);
  if (!m) grownStl.set(tool, (m = new Map()));
  let g = m.get(stl);
  // (a torus cutter grows in its corner radius too: the same middle circle, a thicker tube)
  if (!g) m.set(stl, (g = { ...tool, dia: Math.max(0.01, tool.dia + 2 * stl), ...(cornerOf(tool) > 0 ? { cornerR: cornerOf(tool) + stl } : {}) }));
  return g;
}
function dropCutter(hm, x, y, tool, floor) {
  if (!SURF) return dropCutterRaw(hm, x, y, tool, floor);
  let z = dropCutterRaw(SURF.base || hm, x, y, tool, floor);
  for (const g of SURF.groups) {
    let m = grownTools.get(tool);
    if (!m) grownTools.set(tool, (m = new Map()));
    let tg = m.get(g.radial);
    if (!tg) m.set(g.radial, (tg = { ...tool, dia: tool.dia + 2 * g.radial }));
    const zz = dropCutterRaw(g.hm, x, y, tg, -Infinity) + g.axial;
    if (zz > z) z = zz;
  }
  return z;
}
import { adaptiveLevel } from './adaptive.js';
import { findMachine } from './machines.js';
import { generateTurnSetup, TURN_OPS } from './turning.js';
import { MeshBVH } from 'three-mesh-bvh';

export const RAPID_FEED = 3000; // mm/min, assumed for time estimates
export const OP_TYPES = {
  face: 'Planfräsen',
  contour: '2D-Kontur',
  pocket: '2D-Tasche',
  adaptive: '2D-Adaptiv',
  chamfer: '2D-Fase',
  drill: 'Bohren',
  bore: 'Helix-Bohren',
  thread: 'Gewindefräsen',
  trace: 'Gravieren / Kurve',
  rough3d: '3D-Räumen',
  parallel3d: '3D-Parallel',
  contour3d: '3D-Kontur (Wasserlinie)',
  horizontal3d: '3D-Horizontal (Planflächen)',
  steep3d: '3D-Steil & Flach',
  scallop3d: 'HSC-Kontur',
  adaptive3d: 'Adaptives 3D-Schruppen',
  pocket3d: '3D-Versatz-Schruppen',
  flat3d: 'Flach',
  ramp3d: 'Materialeinfahrt',
  pencil3d: 'Hohlkehle',
  morphspiral3d: 'Morph-Spirale',
  blend3d: 'Leitkurven-Blend',
  guidemorph3d: 'Leitkurven-Morph',
  corner3d: 'Ecke',
  flow3d: 'Fluss',
  morph3d: 'Flächen-Morph',
  deburr3d: 'Entgraten',
  geodesic3d: 'Geodätische Linie',
  spiral3d: '3D-Spirale',
  radial3d: '3D-Radial',
  project3d: '3D-Projizieren',
  slot: '2D-Nut',
  circular: 'Kreistasche',
  vcarve: 'V-Gravur',
  probe: 'Antasten (WKS)',
  plunge3d: 'Tauchschruppen',
  manual: 'Manuelle NC',
  rotary: '4-Achs-Rotation',
  rotaryRough: '4-Achs-Schruppen',
  rotaryWrap: '4-Achs-Abwickeln',
  ...TURN_OPS,
};
export const OPS_3D = ['rough3d', 'parallel3d', 'contour3d', 'horizontal3d', 'steep3d', 'scallop3d', 'spiral3d', 'radial3d', 'adaptive3d', 'pocket3d', 'flat3d', 'ramp3d', 'pencil3d', 'morphspiral3d', 'blend3d', 'guidemorph3d', 'corner3d', 'flow3d', 'morph3d', 'deburr3d', 'geodesic3d', 'plunge3d'];
// Manual NC: lines in the program without a toolpath ("Manuelle NC")
export const MANUAL_KINDS = { comment: 'Kommentar', stop: 'Programmhalt (M0)', optstop: 'Wahlweiser Halt (M1)', dwell: 'Verweilzeit', code: 'NC-Code durchreichen', message: 'Meldung für den Bediener' };
export const PATTERN_KINDS = { none: 'Kein Muster', linear: 'Linear (Reihen und Spalten)', circular: 'Kreisförmig', mirror: 'Gespiegelt' };
export const TOOL_TYPES = {
  ball: 'Kugelkopffräser', torus: 'Torusfräser', flat: 'Schaftfräser', facemill: 'Planfräser', tapered: 'Konusfräser', radius: 'Radienfräser', chamfer: 'Gravur-/Fasenfräser',
  dovetail: 'Schwalbenschwanzfräser', lollipop: 'Lollipop-Fräser', slot: 'Nutenfräser', thread: 'Gewindefräser', barrel: 'Kreissegment Tonne', lens: 'Kreissegment Linse', oval: 'Kreissegment Oval', segtaper: 'Kreissegment Verjüngung',
  boringbar: 'Bohrstange', counterbore: 'Zylindrische Senkung', drill: 'Bohrer', center: 'Zentrierbohrer', spot: 'NC-Anbohrer', ream: 'Reibahle', countersink: 'Konische Senkung', tap: 'Gewindebohrer',
  turn: 'Drehen - allgemein', turnbore: 'Drehen - Bohren', groove: 'Drehen - Einstechen', tthread: 'Drehen - Gewinde',
  form: 'Formfräser', waterjet: 'Wasserstrahl', laser: 'Laserschneidwerkzeug', plasma: 'Plasmaschneider', probe: 'Antasten (3D-Taster)', holder: 'Halter',
  arcwire: 'Lichtbogendraht', laserpowder: 'Laser-Pulver', laserwire: 'Laserdraht',
};
// How the toolpath strategies treat each tool type (null = cannot cut: holders, additive heads)
export const TOOL_BASE = {
  tapered: 'flat', radius: 'flat', dovetail: 'flat', slot: 'flat', boringbar: 'flat', counterbore: 'flat', facemill: 'flat', torus: 'flat',
  lollipop: 'ball', barrel: 'ball', lens: 'ball', oval: 'ball', segtaper: 'ball',
  center: 'drill', spot: 'drill', countersink: 'chamfer', turnbore: 'turn',
  waterjet: 'flat', laser: 'flat', plasma: 'flat', holder: null, arcwire: null, laserpowder: null, laserwire: null,
};
export const toolBase = t => (t.type === 'tapered' && t.taperTip === 'ball' ? 'ball' : t.type in TOOL_BASE ? TOOL_BASE[t.type] : t.type);
export const ORIENTATIONS = {
  top: 'Oben (Z+ nach oben)',
  bottom: 'Unten (gewendet)',
  front: 'Vorderseite (−Y nach oben)',
  back: 'Rückseite (+Y nach oben)',
  left: 'Links (−X nach oben)',
  right: 'Rechts (+X nach oben)',
};

// Rotation from model space into the setup's machine frame (tool along −Z).
// Accepts an orientation name or a whole setup (picked Z/X axes, flips).
export function setupMatrix(setup) {
  if (!setup || typeof setup === 'string') return presetMatrix(setup);
  if (setup.wcsMode === 'axes') {
    // picked axes ("Z-Achse/-Ebene und X-Achse", "… und Y-Achse", "X- und Y-Achse")
    const V = (a, flip) => (Array.isArray(a) ? new THREE.Vector3(...a).normalize().multiplyScalar(flip ? -1 : 1) : null);
    const pair = setup.axesPair || 'zx';
    let x, y, z;
    const perp = v => new THREE.Vector3(Math.abs(v.x) < 0.9 ? 1 : 0, Math.abs(v.x) < 0.9 ? 0 : 1, 0).addScaledVector(v, -(Math.abs(v.x) < 0.9 ? v.x : v.y)).normalize();
    const ortho = (v, n) => { const w = v.clone().addScaledVector(n, -v.dot(n)); return w.lengthSq() < 1e-8 ? perp(n) : w.normalize(); };
    if (pair === 'xy') {
      x = V(setup.xAxis, setup.flipX) || new THREE.Vector3(1, 0, 0);
      y = ortho(V(setup.yAxis, setup.flipY) || new THREE.Vector3(0, 1, 0), x);
      z = new THREE.Vector3().crossVectors(x, y);
    } else if (pair === 'zy') {
      z = V(setup.zAxis, setup.flipZ) || new THREE.Vector3(0, 0, 1);
      y = ortho(V(setup.yAxis, setup.flipY) || perp(z), z);
      x = new THREE.Vector3().crossVectors(y, z);
    } else {
      z = V(setup.zAxis, setup.flipZ) || new THREE.Vector3(0, 0, 1);
      x = ortho(V(setup.xAxis, setup.flipX) || perp(z), z);
      y = new THREE.Vector3().crossVectors(z, x);
    }
    // columns = setup axes in model space; the inverse of a rotation is its transpose
    return new THREE.Matrix4().makeBasis(x, y, z).transpose();
  }
  let m = presetMatrix(setup.orientation);
  if (setup.flipZ) m = new THREE.Matrix4().makeRotationX(Math.PI).multiply(m);
  if (setup.flipX) m = new THREE.Matrix4().makeRotationZ(Math.PI).multiply(m);
  return m;
}

export function originLabel(s) {
  if (s?.originMode === 'modelOrigin') return 'Modellursprung';
  if (s?.originMode === 'pick') {
    const r = s.originRef || {};
    return 'Bezüge ' + ['x', 'y', 'z'].map(k => `${k.toUpperCase()}: ${r[k]?.label || 'Rohteil'}`).join(', ');
  }
  if (s?.originMode === 'stock' || s?.originMode === 'model') {
    const [px, py, pz] = Array.isArray(s.originPt) ? s.originPt : [0, 0, 1];
    const X = ['links', 'Mitte', 'rechts'][Math.round(px * 2)], Y = ['vorne', 'Mitte', 'hinten'][Math.round(py * 2)], Z = ['unten', 'Mitte', 'oben'][Math.round(pz * 2)];
    return `${s.originMode === 'stock' ? 'Rohteil' : 'Modellrahmen'} ${Z}, ${Y} ${X}`;
  }
  return ORIGINS[s?.origin] || ORIGINS['top-corner'];
}

export function orientationLabel(setup) {
  if (setup?.wcsMode === 'axes') return 'Z-/X-Achse gewählt' + (setup.flipZ ? ', Z umgekehrt' : '') + (setup.flipX ? ', X umgekehrt' : '');
  return (ORIENTATIONS[setup?.orientation] || ORIENTATIONS.top) + (setup?.flipZ ? ', Z umgekehrt' : '') + (setup?.flipX ? ', X umgekehrt' : '');
}

function presetMatrix(orientation) {
  const m = new THREE.Matrix4();
  switch (orientation) {
    case 'bottom': return m.makeRotationX(Math.PI);
    case 'front': return m.makeRotationX(-Math.PI / 2);
    case 'back': return m.makeRotationX(Math.PI / 2);
    case 'left': return m.makeRotationY(Math.PI / 2);
    case 'right': return m.makeRotationY(-Math.PI / 2);
    default: return m;
  }
}
export const ORIGINS = {
  'top-corner': 'Rohteil oben, vorne links',
  'top-center': 'Rohteil oben, Mitte',
  'bottom-corner': 'Rohteil unten, vorne links',
  model: 'Modell-Ursprung',
};

const S = 1000; // Clipper integer scale
const CL = () => window.ClipperLib;
const toC = poly => poly.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }));
const fromC = path => path.map(p => [p.X / S, p.Y / S]);

function offsetPaths(paths, delta, sharp = false) {
  const L = CL();
  const co = new L.ClipperOffset(sharp ? 4 : 2, 0.01 * S);
  co.AddPaths(paths, sharp ? L.JoinType.jtMiter : L.JoinType.jtRound, L.EndType.etClosedPolygon);
  const out = new L.Paths();
  co.Execute(out, delta * S);
  return out;
}

function clip(subj, clipPaths, type, fill = 'pftNonZero') {
  const L = CL();
  const c = new L.Clipper();
  // strictly simple output: regions that only touch (one raster cell apart, holes meeting in a corner) come out
  // as separate polygons instead of one loop with a zero-width bridge, which a pass along the outline would cut
  c.StrictlySimple = true;
  c.AddPaths(subj, L.PolyType.ptSubject, true);
  if (clipPaths) c.AddPaths(clipPaths, L.PolyType.ptClip, true);
  const out = new L.Paths();
  c.Execute(L.ClipType[type], out, L.PolyFillType[fill], L.PolyFillType[fill]);
  return out;
}
const unionEvenOdd = paths => clip(paths, null, 'ctUnion', 'pftEvenOdd');

// common CAD/CAM "Rohteil → Modus"
export const STOCK_MODES = {
  fixed: 'Quader mit fester Größe', margin: 'Relative Quadergröße', cylFixed: 'Zylinder mit fester Größe', cyl: 'Relative Zylindergröße',
  tubeFixed: 'Rohr mit fester Größe', tube: 'Rohr mit relativer Größe', solid: 'Von Volumenkörper', boundingSolid: 'Von begrenzendem Volumenkörper', prevSetup: 'Von vorherigem Setup',
};
export const STOCK_MATERIALS = {
  alu: ['Aluminium (EN AW-6082)', 0xc9ced4], alu7075: ['Aluminium hochfest (EN AW-7075)', 0xbec4cb], steel: ['Baustahl (S235 / C45)', 0x8f969c],
  steelTool: ['Werkzeugstahl (1.2379)', 0x7d848a], stainless: ['Edelstahl (1.4301)', 0xa9afb4], cast: ['Grauguss (EN-GJL-250)', 0x6f7479],
  brass: ['Messing (CuZn39Pb3)', 0xc9a24a], copper: ['Kupfer (Cu-ETP)', 0xc07a4f], titanium: ['Titan (Grade 5)', 0x9a9a92],
  pom: ['Kunststoff POM', 0xeeeeea], pa: ['Kunststoff PA6', 0xe9e2cf], pe: ['Kunststoff PE-HD', 0xf2f2f2], wood: ['Holz (Buche)', 0xc9a86a], mdf: ['MDF', 0xa88a62], foam: ['Modellbauschaum', 0xe8d46a],
};

// geo: { bodies (setup frame), all (all bodies, world), T, project } for cylinders, solids and the previous setup
export function computeStock(box, s, geo = null) {
  const st = computeStockBox(box, s, geo);
  // model box (for origins "point on model box")
  return { ...st, material: s.stockMaterial || null, materialColor: s.stockMaterialColor || null, mMinX: box.min.x, mMaxX: box.max.x, mMinY: box.min.y, mMaxY: box.max.y };
}

// top of the stock material above (x, y); -Infinity where there is none (cylinder, tube, solid stock)
export function stockTopAt(st, x, y) {
  const sh = st.shape;
  if (!sh) return st.top;
  if (sh.type === 'map') {
    const hm = sh.hm, i = Math.round((x - hm.minX) / hm.res), j = Math.round((y - hm.minY) / hm.res);
    return i >= 0 && j >= 0 && i < hm.nx && j < hm.ny ? hm.h[j * hm.nx + i] : -Infinity;
  }
  if (sh.axis === 'z') { const d = Math.hypot(x - sh.cu, y - sh.cv); return d <= sh.r + 1e-9 && d >= sh.ri - 1e-9 ? sh.hi : -Infinity; }
  const along = sh.axis === 'x' ? x : y, u = sh.axis === 'x' ? y : x;
  if (along < sh.lo - 1e-9 || along > sh.hi + 1e-9) return -Infinity;
  const du = u - sh.cu;
  return Math.abs(du) <= sh.r ? sh.cv + Math.sqrt(sh.r * sh.r - du * du) : -Infinity;
}
// lower end of the stock material at (x, y): the stock bottom, or – for stock from a previous setup – where
// its top piece of material ends (air under a skin)
export function stockBotAt(st, x, y) {
  const hm = st.shape?.type === 'map' ? st.shape.hm : null;
  if (!hm?.hb) return st.bottom;
  const i = Math.round((x - hm.minX) / hm.res), j = Math.round((y - hm.minY) / hm.res);
  return i >= 0 && j >= 0 && i < hm.nx && j < hm.ny ? Math.max(st.bottom, hm.hb[j * hm.nx + i]) : st.bottom;
}
// outline of the stock seen from above (Clipper paths) – a circle for an upright cylinder/tube
function stockOutline(stock) {
  const sh = stock.shape;
  if (sh?.type === 'cyl' && sh.axis === 'z') {
    const circ = (r, rev) => { const pts = []; for (let k = 0; k < 96; k++) { const a = (2 * Math.PI * k) / 96 * (rev ? -1 : 1); pts.push([sh.cu + r * Math.cos(a), sh.cv + r * Math.sin(a)]); } return toC(pts); };
    return sh.ri > 0 ? [circ(sh.r), circ(sh.ri, true)] : [circ(sh.r)];
  }
  return [toC([[stock.minX, stock.minY], [stock.maxX, stock.minY], [stock.maxX, stock.maxY], [stock.minX, stock.maxY]])];
}

const AX = ['x', 'y', 'z'];
// stock box from the axis ranges; for a cylinder the radial axes are centred on its axis
function boxFromRanges(R, box) {
  return { minX: R.x[0], maxX: R.x[1], minY: R.y[0], maxY: R.y[1], top: R.z[1], bottom: R.z[0], modelTop: box.max.z, modelBottom: box.min.z };
}
// radial extent of the part around an axis through (cu, cv)
function radialExtent(geo, ax, cu, cv) {
  const [ua, va] = AX.filter(a => a !== ax);
  let rMax = 0, rMin = Infinity;
  // distance from the axis to a triangle seen along the axis (0 when the axis passes through it)
  const triDist = (a, b, c) => {
    const cr = (p, q) => (q[0] - p[0]) * (-p[1]) - (q[1] - p[1]) * (-p[0]);
    const s1 = cr(a, b), s2 = cr(b, c), s3 = cr(c, a);
    if ((s1 >= 0 && s2 >= 0 && s3 >= 0) || (s1 <= 0 && s2 <= 0 && s3 <= 0)) return 0;
    const seg = (p, q) => { const dx = q[0] - p[0], dy = q[1] - p[1], L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(p[0] * dx + p[1] * dy) / L)) : 0; return Math.hypot(p[0] + t * dx, p[1] + t * dy); };
    return Math.min(seg(a, b), seg(b, c), seg(c, a));
  };
  for (const b of geo?.bodies || []) {
    const pos = b.geometry.attributes.position, idx = b.geometry.index;
    const P = i => { const v = { x: pos.getX(i), y: pos.getY(i), z: pos.getZ(i) }; return [v[ua] - cu, v[va] - cv]; };
    for (let i = 0; i < pos.count; i++) { const q = P(i), r = Math.hypot(q[0], q[1]); if (r > rMax) rMax = r; }
    const nt = idx ? idx.count / 3 : pos.count / 3;
    for (let f = 0; f < nt && rMin > 0; f++) {
      const [i0, i1, i2] = [0, 1, 2].map(k => (idx ? idx.getX(f * 3 + k) : f * 3 + k));
      rMin = Math.min(rMin, triDist(P(i0), P(i1), P(i2)));
    }
  }
  return { rMax, rMin: Number.isFinite(rMin) ? rMin : 0 };
}
function cylinderStock(box, s, geo, fixed, tube) {
  const ax = s.stockAxisPick ? s.stockAxis || 'z' : 'z';
  const [ua, va] = AX.filter(a => a !== ax);
  const cu = (box.min[ua] + box.max[ua]) / 2, cv = (box.min[va] + box.max[va]) / 2;
  const ext = radialExtent(geo, ax, cu, cv);
  const rModel = ext.rMax || Math.hypot(box.max[ua] - box.min[ua], box.max[va] - box.min[va]) / 2;
  const mLen = box.max[ax] - box.min[ax];
  const round = +s.stockRound || 0, up = v => (round > 0 ? Math.ceil(v / round - 1e-9) * round : v);
  let r, ri = 0, front, back;
  if (fixed) {
    r = Math.max(+s.stockDia / 2 || 0, rModel);
    const len = Math.max(+s.stockLen || 0, mLen);
    front = Math.min(Math.max(0, +(s.stockFront ?? (len - mLen) / 2) || 0), len - mLen);
    back = len - mLen - front;
    if (tube) ri = Math.max(0, Math.min(+s.stockInner / 2 || 0, ext.rMin));
  } else {
    r = up(2 * (rModel + (+(s.stockRadial ?? 1) || 0))) / 2;
    front = +(s.stockFront ?? 1) || 0;
    back = +(s.stockBack ?? 1) || 0;
    if (tube) ri = Math.max(0, ext.rMin - (+s.stockInnerOff || 0));
  }
  const lo = box.min[ax] - back, hi = box.max[ax] + front;
  const R = { [ax]: [lo, hi], [ua]: [cu - r, cu + r], [va]: [cv - r, cv + r] };
  return { ...boxFromRanges(R, box), shape: { type: 'cyl', axis: ax, cu, cv, r, ri, lo, hi } };
}
// box of one body (world) in the setup frame
function bodyBoxIn(geo, id) {
  const b = (geo?.all || []).find(x => x.id === id);
  if (!b) return null;
  const g = b.geometry.clone().applyMatrix4(geo.T);
  g.computeBoundingBox();
  return { box: g.boundingBox.clone(), g };
}

function computeStockBox(box, s, geo) {
  const mode = s.stockMode || 'margin';
  if (mode === 'cyl' || mode === 'cylFixed' || mode === 'tube' || mode === 'tubeFixed') return cylinderStock(box, s, geo, mode.endsWith('Fixed'), mode.startsWith('tube'));
  if (mode === 'solid' || mode === 'boundingSolid') {
    const bb = s.stockBody && bodyBoxIn(geo, s.stockBody);
    if (bb) {
      const B = bb.box;
      if (mode === 'boundingSolid') {
        const m = +s.marginSide || 0;
        return { minX: B.min.x - m, maxX: B.max.x + m, minY: B.min.y - m, maxY: B.max.y + m, top: B.max.z + (+s.marginTop || 0), bottom: B.min.z - (+s.marginBottom || 0), modelTop: box.max.z, modelBottom: box.min.z };
      }
      const st = { minX: B.min.x, maxX: B.max.x, minY: B.min.y, maxY: B.max.y, top: B.max.z, bottom: B.min.z, modelTop: box.max.z, modelBottom: box.min.z };
      // the shape of the stock body seen from above
      if (geo.heightmap) st.shape = { type: 'map', hm: geo.heightmap([{ geometry: bb.g }], st) };
      return st;
    }
  }
  if (mode === 'prevSetup' && geo?.project) {
    const setups = geo.project.cam.setups, i = setups.findIndex(x => x.id === s.id);
    const prev = i > 0 ? setups[i - 1] : null;
    if (prev && prev.kind !== 'turn' && (geo.depth || 0) < 8) {
      const Tp = setupMatrix(prev);
      const pb = setupBodies(geo.all, prev).map(b => ({ geometry: b.geometry.clone().applyMatrix4(Tp) }));
      const pbox = new THREE.Box3();
      for (const b of pb) { b.geometry.computeBoundingBox(); if (b.geometry.attributes.position.count) pbox.union(b.geometry.boundingBox); }
      if (!pbox.isEmpty()) {
        const ps = computeStockBox(pbox, prev, { ...geo, bodies: pb, T: Tp, depth: (geo.depth || 0) + 1 });
        // previous stock (corners or cylinder rims) → world → this setup
        const M = new THREE.Matrix4().copy(geo.T).multiply(new THREE.Matrix4().copy(Tp).invert());
        const pts = [];
        const sh = ps.shape;
        if (sh?.type === 'cyl') {
          const [ua, va] = AX.filter(a => a !== sh.axis);
          for (const t of [sh.lo, sh.hi]) for (let k = 0; k < 32; k++) { const a = (2 * Math.PI * k) / 32, v = { [sh.axis]: t, [ua]: sh.cu + sh.r * Math.cos(a), [va]: sh.cv + sh.r * Math.sin(a) }; pts.push(new THREE.Vector3(v.x, v.y, v.z)); }
        } else for (const x of [ps.minX, ps.maxX]) for (const y of [ps.minY, ps.maxY]) for (const z of [ps.bottom, ps.top]) pts.push(new THREE.Vector3(x, y, z));
        const B = new THREE.Box3().setFromPoints(pts.map(q => q.applyMatrix4(M)));
        const st = { minX: B.min.x, maxX: B.max.x, minY: B.min.y, maxY: B.max.y, top: B.max.z, bottom: B.min.z, modelTop: box.max.z, modelBottom: box.min.z };
        if (sh?.type === 'cyl') {
          // the cylinder axis in this setup (kept as a cylinder when it lines up with X, Y or Z)
          const dir = new THREE.Vector3(...AX.map(a => (a === sh.axis ? 1 : 0))).transformDirection(M);
          const ax = AX.find(a => Math.abs(dir[a]) > 0.999);
          if (ax) {
            const [ua, va] = AX.filter(a => a !== ax);
            st.shape = { type: 'cyl', axis: ax, cu: (B.min[ua] + B.max[ua]) / 2, cv: (B.min[va] + B.max[va]) / 2, r: sh.r, ri: sh.ri, lo: B.min[ax], hi: B.max[ax] };
          }
        }
        // what the previous setup has cut away: its remaining material, seen from above in this setup
        const pg = geo.prevGen;
        if (!geo.depth && pg?.stock && pg.setup?.id === prev.id) {
          const rem = remainingStock(pg);
          if (rem) { st.shape = { type: 'map', hm: projectRemaining(rem, new THREE.Matrix4().copy(M).invert(), st) }; st.fromPrev = true; }
        }
        return st;
      }
    }
  }
  const round = +s.stockRound || 0, up = v => (round > 0 ? Math.ceil(v / round - 1e-9) * round : v);
  if (s.stockMode === 'fixed') {
    // fixed block centred on the part in XY; the part sits marginTop below the stock top
    const W = Math.max(+s.stockW || 0, box.max.x - box.min.x), D = Math.max(+s.stockD || 0, box.max.y - box.min.y);
    const top = box.max.z + (+s.marginTop || 0);
    const H = Math.max(+s.stockH || 0, top - box.min.z);
    const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2;
    return { minX: cx - W / 2, maxX: cx + W / 2, minY: cy - D / 2, maxY: cy + D / 2, top, bottom: top - H, modelTop: box.max.z, modelBottom: box.min.z };
  }
  const st = {
    minX: box.min.x - s.marginSide, maxX: box.max.x + s.marginSide,
    minY: box.min.y - s.marginSide, maxY: box.max.y + s.marginSide,
    top: box.max.z + s.marginTop, bottom: box.min.z - s.marginBottom,
    modelTop: box.max.z, modelBottom: box.min.z,
  };
  // "Aufrunden auf nächste(n/s)": sizes rounded up, the part stays centred, the top stays put
  if (round > 0) {
    const grow = (lo, hi) => { const d = up(hi - lo) - (hi - lo); return [lo - d / 2, hi + d / 2]; };
    [st.minX, st.maxX] = grow(st.minX, st.maxX);
    [st.minY, st.maxY] = grow(st.minY, st.maxY);
    st.bottom = st.top - up(st.top - st.bottom);
  }
  return st;
}

// Origin of the work coordinate system. `s` is a setup (point on the stock or model
// box, or the model origin) or one of the older preset names.
export function originOf(s, stock) {
  if (s && typeof s === 'object') {
    const mode = s.originMode || null;
    if (mode === 'modelOrigin') return { x: 0, y: 0, z: 0 };
    if (mode === 'pick') {
      // each axis from its own reference (edge, corner, face, hole); the rest from the stock box point
      const out = originOf({ ...s, originMode: 'stock' }, stock);
      const T = setupMatrix(s);
      for (const k of ['x', 'y', 'z']) {
        const r = s.originRef?.[k];
        if (Array.isArray(r?.p)) out[k] = new THREE.Vector3(...r.p).applyMatrix4(T)[k];
      }
      return out;
    }
    if (mode === 'stock' || mode === 'model') {
      const [px, py, pz] = Array.isArray(s.originPt) ? s.originPt : [0, 0, 1];
      const b = mode === 'model' && stock.mMinX != null
        ? { minX: stock.mMinX, maxX: stock.mMaxX, minY: stock.mMinY, maxY: stock.mMaxY, bottom: stock.modelBottom, top: stock.modelTop } : stock;
      return { x: b.minX + px * (b.maxX - b.minX), y: b.minY + py * (b.maxY - b.minY), z: b.bottom + pz * (b.top - b.bottom) };
    }
    return originOf(s.origin, stock);
  }
  const kind = s;
  switch (kind) {
    case 'top-center': return { x: (stock.minX + stock.maxX) / 2, y: (stock.minY + stock.maxY) / 2, z: stock.top };
    case 'bottom-corner': return { x: stock.minX, y: stock.minY, z: stock.bottom };
    case 'model': return { x: 0, y: 0, z: 0 };
    default: return { x: stock.minX, y: stock.minY, z: stock.top };
  }
}

// ---------- sketch geometry in the setup frame ----------
let T = new THREE.Matrix4(); // model -> setup frame, set per generateSetup()

export function sketchHorizontalIn(sk, M) {
  const n = basis(sk).n.clone().transformDirection(M);
  return Math.abs(Math.abs(n.z) - 1) < 1e-6;
}

function sketchXY(sk) {
  if (!sketchHorizontalIn(sk, T)) throw new Error('Die Skizze liegt in diesem Setup nicht waagerecht');
  const b = basis(sk);
  const o = b.o.clone().applyMatrix4(T), n = b.n.clone().transformDirection(T);
  return { b, z: o.z, nz: n.z, tr: ([u, v]) => { const p = toWorld(b, u, v).applyMatrix4(T); return [p.x, p.y]; } };
}

function opGeometry(op, project, allowEmpty = false) {
  const sk = project.features.find(f => f.id === op.sketch && f.type === 'sketch');
  if (!sk) throw new Error('Keine Skizze als Geometrie gewählt');
  const X = sketchXY(sk);
  const items = sk.entities
    .filter(e => !e.cons && (!Array.isArray(op.entities) || op.entities.includes(e.id)))
    .flatMap(e => entityPolys(e).map((poly, k) => ({ id: `${e.id}#${k}`, e, poly: ensureCCW(poly.map(X.tr)) })));
  // closed loops of separate lines / arcs count as profiles too
  for (const L of chainLoops(sk.entities.filter(e => !e.cons))) {
    if (Array.isArray(op.entities) && !L.ids.some(id => op.entities.includes(id))) continue;
    items.push({ id: L.id, e: { id: L.id, type: 'chain' }, poly: ensureCCW(L.poly.map(X.tr)) });
  }
  if (!items.length && !allowEmpty) throw new Error('Keine geschlossenen Profile ausgewählt');
  return { sk, X, items, ...buildRegions(items) };
}

// Sketch curves for milling with a driven tool on the lathe (turning axis = model Z), as tool centre paths:
//  - sketch plane across the axis (on the face): kind 'face', points [x, y] on the part, z of the plane
//  - sketch plane along the axis: kind 'wrap', points [s, z] with s = way around the cylinder from the angle phi
//    the plane faces (it is wrapped onto the diameter)
// op.side: 'on' (cutter centre on the curve), 'inside' / 'outside' (closed curves, cutter beside it).
function liveCurves(op, project, toolR) {
  const sk = project.features.find(f => f.id === op.sketch && f.type === 'sketch');
  if (!sk) throw new Error('Keine Skizze als Geometrie gewählt');
  const b = basis(sk), n = b.n.clone().normalize();
  const face = Math.abs(Math.abs(n.z) - 1) < 1e-6, along = Math.abs(n.z) < 1e-6;
  if (!face && !along) throw new Error('Die Skizze muss quer zur Drehachse (Planfläche) oder längs zu ihr (zum Abwickeln) liegen');
  // horizontal direction in a plane along the axis: the way the angle grows at phi
  const hx = -n.y, hy = n.x, foot = b.o.clone();
  if (along) { const d = b.o.x * n.x + b.o.y * n.y; foot.set(d * n.x, d * n.y, 0); }
  const map = ([u, v]) => { const p = toWorld(b, u, v); return face ? [p.x, p.y] : [(p.x - foot.x) * hx + (p.y - foot.y) * hy, p.z]; };
  let curves = sk.entities
    .filter(e => !e.cons && (!Array.isArray(op.entities) || op.entities.includes(e.id)))
    .flatMap(e => entityOutlines(e))
    .filter(o => o.pts.length >= 2)
    .map(o => ({ pts: o.pts.map(map), closed: !!o.closed }));
  if (!curves.length) throw new Error('Keine Kurven in der Skizze');
  const side = op.side || 'on', off = toolR + (+op.stockToLeave || 0);
  if (op.type === 'tpocket') {
    // pocket: offset rings of the closed curves (islands by even-odd), from the inside out
    const closed = curves.filter(c => c.closed && c.pts.length >= 3);
    if (!closed.length) throw new Error('Die Tasche braucht geschlossene Konturen');
    const so = Math.max(0.05, 2 * toolR * (+op.stepover > 0 ? +op.stepover : 0.45));
    const rings = pocketRings(unionEvenOdd(closed.map(c => toC(c.pts))), off, so);
    if (!rings.length) throw new Error('Werkzeug zu groß für die Tasche');
    curves = rings.slice().reverse().flat().filter(l => l.length >= 3).map(pts => ({ pts, closed: true }));
    return { kind: face ? 'face' : 'wrap', curves, so, z: face ? b.o.z : null, phi: null, dist: null };
  }
  if (side !== 'on') {
    const closed = curves.filter(c => c.closed && c.pts.length >= 3);
    if (!closed.length) throw new Error('„Innen/Außen“ braucht geschlossene Konturen – offene Kurven mit „Auf der Kurve“ fräsen');
    const loops = offsetPaths(unionEvenOdd(closed.map(c => toC(c.pts))), side === 'inside' ? -off : off).map(fromC).filter(l => l.length >= 3);
    if (!loops.length) throw new Error('Werkzeug zu groß für die Kontur');
    curves = loops.map(pts => ({ pts, closed: true }));
  }
  return { kind: face ? 'face' : 'wrap', curves, z: face ? b.o.z : null, phi: along ? (Math.atan2(n.y, n.x) * 180) / Math.PI : null, dist: along ? Math.hypot(foot.x, foot.y) : null };
}

// Z levels of everything the sketch's features touch (extrude ends, hole bottoms).
function featureZs(op, project, stock) {
  const sk = project.features.find(f => f.id === op.sketch);
  if (!sk || !sketchHorizontalIn(sk, T)) return null;
  const { z, nz } = sketchXY(sk);
  const zs = [z];
  // geometry from picked model faces (see main.js camFaceSketch)
  if (sk.camOffsets) for (const o of sk.camOffsets) zs.push(z + o * nz);
  if (sk.camToModelBottom) zs.push(stock.modelBottom);
  for (const f of project.features) {
    if (f.suppressed || f.sketch !== op.sketch) continue;
    if (f.type === 'extrude') {
      const d = +f.distance * nz;
      if (f.extent === 'sym') zs.push(z - Math.abs(d) / 2, z + Math.abs(d) / 2);
      else { zs.push(z + d); if (f.extent === 'two' && +f.distance2) zs.push(z - f.distance2 * nz); }
    } else if (f.type === 'hole') {
      zs.push(f.through ? stock.bottom : z - +f.depth * nz);
    }
  }
  return zs;
}

// Tool positions closer to a fixture than the safety distances get a warning.
function checkFixtures(allBodies, setup, results) {
  const ids = new Set(setup.fixtures || []);
  if (!ids.size) return;
  const rad = setup.fixRadial == null ? 5 : +setup.fixRadial, ax = setup.fixAxial == null ? 5 : +setup.fixAxial;
  const boxes = allBodies.filter(b => ids.has(b.id)).map(b => {
    const g = b.geometry.clone().applyMatrix4(T);
    g.computeBoundingBox();
    const bb = g.boundingBox.clone();
    g.dispose();
    return bb;
  });
  for (const r of results.values()) {
    if (!r?.moves?.length || r.error) continue;
    const tr = (+r.tool?.dia || 0) / 2;
    const bad = r.moves.find(m => boxes.some(bb => m.x > bb.min.x - rad - tr && m.x < bb.max.x + rad + tr && m.y > bb.min.y - rad - tr && m.y < bb.max.y + rad + tr && m.z < bb.max.z + ax));
    if (bad) r.warning = `Sicherheitsabstand zum Spannmittel unterschritten (bei X${bad.x.toFixed(1)} Y${bad.y.toFixed(1)} Z${bad.z.toFixed(1)})`;
  }
}

export const HEIGHT_KEYS = ['safe', 'retract', 'feed', 'top', 'bottom'];
export const HEIGHT_FROM = {
  safe: ['retract', 'stockTop', 'modelTop', 'origin'],
  retract: ['stockTop', 'top', 'modelTop', 'origin', 'pick'],
  feed: ['top', 'retract', 'stockTop', 'bottom', 'origin', 'pick'],
  top: ['stockTop', 'modelTop', 'stockBottom', 'modelBottom', 'origin', 'pick'],
  bottom: ['auto', 'stockBottom', 'modelBottom', 'modelTop', 'stockTop', 'top', 'origin', 'pick'],
};
// The five heights of an operation; old projects (bottom / bottomOffset, setup safeZ / retract) map onto them.
export function heightSpec(op, setup) {
  const H = op.heights || {};
  const legacy = op.bottom != null && op.bottom !== '';
  const def = {
    safe: { from: 'stockTop', offset: +(setup?.safeZ ?? 15) },
    retract: { from: 'stockTop', offset: +(setup?.retract ?? 5) },
    feed: { from: 'top', offset: 5 },
    top: { from: 'stockTop', offset: 0 },
    bottom: legacy ? { from: 'origin', offset: +op.bottom + (+op.bottomOffset || 0) } : { from: 'auto', offset: +op.bottomOffset || 0 },
  };
  return Object.fromEntries(HEIGHT_KEYS.map(k => [k, { ...def[k], ...(H[k] || {}) }]));
}

export function opHeights(op, project, stock, setup) {
  const spec = heightSpec(op, setup);
  let autoBottom, edge = stock.modelTop;
  if (op.type === 'face') autoBottom = stock.modelTop;
  else if (OPS_3D.includes(op.type)) autoBottom = stock.modelBottom;
  else {
    const zs = featureZs(op, project, stock);
    autoBottom = zs ? Math.min(...zs) : stock.bottom;
    if (zs) edge = Math.max(...zs);
  }
  const out = {};
  const get = (k, depth = 0) => {
    if (out[k] != null) return out[k];
    const sp = spec[k];
    if (depth > 6) return stock.top;
    const base = {
      stockTop: stock.top, stockBottom: stock.bottom, modelTop: stock.modelTop, modelBottom: stock.modelBottom, origin: 0,
      auto: autoBottom, pick: Number.isFinite(+sp.z) ? +sp.z : stock.top,
    }[sp.from] ?? (HEIGHT_KEYS.includes(sp.from) && sp.from !== k ? get(sp.from, depth + 1) : stock.top);
    return (out[k] = base + (+sp.offset || 0));
  };
  for (const k of HEIGHT_KEYS) get(k);
  // axial stock to leave lifts the bottom ("Axiales Aufmaß")
  const axial = op.stockOn === false ? 0 : +op.axialStock || 0;
  return { top: out.top, bottom: out.bottom + axial, edge, auto: spec.bottom.from === 'auto', retract: Math.max(out.retract, out.top), safe: Math.max(out.safe, out.retract, out.top), feed: out.feed };
}

// Surface a control cycle starts from: the top of the feature (hole, pocket edge) when it lies above the bottom,
// otherwise the top height of the operation (a sketch without depth: the cut runs from the top height down to it).
const cycleTop = h => (h.edge != null && h.edge - h.bottom > 1e-6 && h.edge <= h.top + 1e-6 ? h.edge : h.top);

function levels(top, bottom, step) {
  if (top - bottom < 1e-6) return [];
  step = step > 0 ? step : top - bottom;
  const out = [];
  let z = top;
  while (z - step > bottom + 1e-6) { z -= step; out.push(+z.toFixed(4)); }
  out.push(bottom);
  return out;
}

// The loop started at its point closest to p – anywhere on its outline, not only at a vertex (the point is
// inserted). Offset rings of a pocket are then exactly one stepover apart at the link.
function rotateNearestOn(loop, p) {
  let bi = 0, bt = 0, bd = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const a = loop[i], b = loop[(i + 1) % loop.length], dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
    const u = L2 > 1e-18 ? Math.max(0, Math.min(1, ((p.x - a[0]) * dx + (p.y - a[1]) * dy) / L2)) : 0;
    const d = (a[0] + u * dx - p.x) ** 2 + (a[1] + u * dy - p.y) ** 2;
    if (d < bd - 1e-12) { bd = d; bi = i; bt = u; }
  }
  const a = loop[bi], b = loop[(bi + 1) % loop.length];
  if (bt < 1e-6) return [...loop.slice(bi), ...loop.slice(0, bi)];
  if (bt > 1 - 1e-6) { const j = (bi + 1) % loop.length; return [...loop.slice(j), ...loop.slice(0, j)]; }
  const q = [a[0] + bt * (b[0] - a[0]), a[1] + bt * (b[1] - a[1])];
  return [q, ...loop.slice(bi + 1), ...loop.slice(0, bi + 1)];
}

function rotateNearest(loop, p) {
  let bi = 0, bd = Infinity;
  for (let i = 0; i < loop.length; i++) {
    const d = (loop[i][0] - p.x) ** 2 + (loop[i][1] - p.y) ** 2;
    if (d < bd) { bd = d; bi = i; }
  }
  return bi ? loop.slice(bi).concat(loop.slice(0, bi)) : loop;
}

function nearestOrder(items, getPt, start = { x: 0, y: 0 }) {
  const rest = items.slice(), out = [];
  let p = start;
  while (rest.length) {
    let bi = 0, bd = Infinity;
    rest.forEach((it, i) => {
      const [x, y] = getPt(it);
      const d = (x - p.x) ** 2 + (y - p.y) ** 2;
      if (d < bd) { bd = d; bi = i; }
    });
    const it = rest.splice(bi, 1)[0];
    const [x, y] = getPt(it);
    p = { x, y };
    out.push(it);
  }
  return out;
}

// Order of the holes of a drilling-type operation ("Reihenfolge"):
//  'shortest' – nearest neighbour, then 2-opt (reverse a stretch where that shortens the rapids), fixed start
//  'keep'     – as selected;  'x' / 'y' – row by row along X (rows in Y) or column by column, zig-zag
// Returns the ordered holes and the rapid lengths (xy) for the panel hint.
const HOLE_D = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
function pathLen(pts, start) { let L = 0, q = start; for (const p of pts) { L += HOLE_D(q, p); q = p; } return L; }
export function orderHoles(items, getPt, mode = 'shortest', start = [0, 0]) {
  const pts0 = items.map(getPt);
  const before = pathLen(pts0, start);
  if (items.length < 3 || mode === 'keep') {
    const out = mode === 'keep' ? items.slice() : nearestOrder(items, it => getPt(it), { x: start[0], y: start[1] });
    return { items: out, len: pathLen(out.map(getPt), start), before };
  }
  if (mode === 'x' || mode === 'y') {
    const a = mode === 'x' ? 0 : 1, b = 1 - a;
    // rows: holes whose cross coordinate differs by less than a third of the smallest row spacing (min 0.5 mm)
    const byB = items.map(it => ({ it, p: getPt(it) })).sort((u, v) => u.p[b] - v.p[b]);
    const gaps = byB.slice(1).map((u, i) => u.p[b] - byB[i].p[b]).filter(g => g > 1e-6);
    const tol = Math.max(0.5, gaps.length ? Math.min(...gaps.filter(g => g > 0.5).concat([Infinity])) / 3 : 0.5);
    const rows = [];
    for (const u of byB) { const r = rows[rows.length - 1]; if (r && u.p[b] - r[0].p[b] <= (Number.isFinite(tol) ? tol : 0.5)) r.push(u); else rows.push([u]); }
    const out = [];
    rows.forEach((r, k) => { r.sort((u, v) => (k % 2 ? v.p[a] - u.p[a] : u.p[a] - v.p[a])); out.push(...r.map(u => u.it)); });
    return { items: out, len: pathLen(out.map(getPt), start), before };
  }
  const nn = nearestOrder(items, it => getPt(it), { x: start[0], y: start[1] });
  const q = [start, ...nn.map(getPt)], idx = [null, ...nn];
  const n = q.length - 1, t0 = Date.now();
  // 2-opt on the open path q0 (fixed) … qn: reversing q[i..j] changes the two edges at its ends
  for (let improved = true, sweep = 0; improved && sweep < 50 && Date.now() - t0 < 250; sweep++) {
    improved = false;
    for (let i = 1; i < n; i++) {
      for (let j = i + 1; j <= n; j++) {
        const dOld = HOLE_D(q[i - 1], q[i]) + (j < n ? HOLE_D(q[j], q[j + 1]) : 0);
        const dNew = HOLE_D(q[i - 1], q[j]) + (j < n ? HOLE_D(q[i], q[j + 1]) : 0);
        if (dNew < dOld - 1e-9) {
          for (let l = i, r = j; l < r; l++, r--) { [q[l], q[r]] = [q[r], q[l]]; [idx[l], idx[r]] = [idx[r], idx[l]]; }
          improved = true;
        }
      }
      if (Date.now() - t0 > 250) break;
    }
  }
  let best = { items: idx.slice(1), len: pathLen(q.slice(1), start) };
  // regular grids: the zig-zag rows are often shorter than what 2-opt finds
  for (const m of ['x', 'y']) { const z = orderHoles(items, getPt, m, start); if (z.len < best.len - 1e-6) best = z; }
  return { items: best.items, len: best.len, before, nearest: pathLen(nn.map(getPt), start) };
}

const loopLength = loop => loop.reduce((a, p, i) => a + Math.hypot(loop[(i + 1) % loop.length][0] - p[0], loop[(i + 1) % loop.length][1] - p[1]), 0);

class Path {
  constructor(safe, clear) { this.m = []; this.safe = safe; this.clear = clear; this.link = clear; this.p = null; this.comp = null; }
  rapid(x, y, z) { this.m.push({ t: 'r', x, y, z }); this.p = { x, y, z }; }
  dwell(sec) { if (this.p) this.m.push({ t: 'f', ...this.p, f: 1, dwell: sec }); }
  feed(x, y, z, f) { const m = { t: 'f', x, y, z, f }; if (this.comp) m.comp = this.comp; if (this.lead) m.lead = this.lead; this.m.push(m); this.p = { x, y, z }; }
  // upward move: rapid, or feed when "Eilgangrückzug zulassen" is off
  up(x, y, z) { if (this.noRapidUp && this.p && z > this.p.z + 1e-9) this.feed(x, y, z, this.upFeed); else this.rapid(x, y, z); }
  moveAbove(x, y) {
    if (!this.p) { this.rapid(x, y, this.safe); this.rapid(x, y, this.clear); return; }
    // "Werkzeug unten halten": short links lift only by the lift height and stay in feed
    if (this.keepDown && this.p.z < this.link - 1e-6 && Math.hypot(x - this.p.x, y - this.p.y) <= this.keepDist) {
      const zl = Math.min(this.link, this.p.z + this.lift);
      if (zl > this.p.z + 1e-9) this.feed(this.p.x, this.p.y, zl, this.linkFeed);
      this.feed(x, y, zl, this.linkFeed);
      return;
    }
    const zl = Math.max(this.p.z, this.link);
    this.up(this.p.x, this.p.y, zl);
    this.rapid(x, y, zl);
  }
  // rapid down to the feed height, then feed ("Vorschubhöhe")
  downTo(x, y, z, f) {
    if (this.feedZ != null && this.p.z > this.feedZ + 1e-6 && this.feedZ > z + 1e-6) this.rapid(x, y, this.feedZ);
    this.feed(x, y, z, f);
  }
  plungeAt(x, y, z, f) { this.moveAbove(x, y); this.downTo(x, y, z, f); }
  retract() { if (this.p) this.up(this.p.x, this.p.y, this.link); }
  end() { if (this.p) this.up(this.p.x, this.p.y, this.safe); }

  // Enter a closed loop: straight plunge, or ramp down along the loop itself.
  enterLoop(loop, zFrom, z, t, rampDeg) {
    const [sx, sy] = loop[0];
    const atStart = this.p && Math.hypot(this.p.x - sx, this.p.y - sy) < 1e-6 && this.p.z <= this.clear;
    if (atStart) zFrom = this.p.z;
    else {
      this.moveAbove(sx, sy);
      // first level: rapid to the feed height, feed on to the ramp start;
      // deeper levels start just above the area already cleared (rapid as before)
      const zr = this.top != null && zFrom >= this.top - 1e-6 ? Math.max(zFrom, this.feedZ ?? zFrom) : zFrom;
      if (this.p.z > zr + 1e-6) this.rapid(sx, sy, zr);
      if (this.p.z > zFrom + 1e-6) this.feed(sx, sy, zFrom, t.plunge);
      zFrom = Math.min(zFrom, this.p.z);
    }
    if (!(rampDeg > 0) || zFrom - z < 1e-6) {
      this.feed(sx, sy, z, t.plunge);
      return;
    }
    const L = loopLength(loop);
    const need = (zFrom - z) / Math.tan((rampDeg * Math.PI) / 180);
    const turns = Math.min(30, Math.max(1, Math.ceil(need / Math.max(L, 1e-6))));
    const total = turns * L;
    let walked = 0;
    for (let k = 0; k < turns; k++) {
      for (let i = 1; i <= loop.length; i++) {
        const a = loop[i - 1], b = loop[i % loop.length];
        walked += Math.hypot(b[0] - a[0], b[1] - a[1]);
        this.feed(b[0], b[1], zFrom - (zFrom - z) * (walked / total), t.helixFeed ?? t.feed);
      }
    }
  }

  // One closed pass at z; inside tab intervals (arc length) the tool lifts to tabTop.
  loopPass(loop, z, f, tabs = null) {
    const n = loop.length;
    if (!tabs || z >= tabs.top) {
      for (let k = 1; k <= n; k++) this.feed(loop[k % n][0], loop[k % n][1], z, f);
      return;
    }
    const inTab = s => tabs.intervals.some(([a, b]) => s > a && s < b);
    let s = 0;
    for (let k = 1; k <= n; k++) {
      const a = loop[k - 1], b = loop[k % n];
      const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
      const cuts = tabs.intervals.flatMap(iv => iv).filter(c => c > s && c < s + len).sort((p, q) => p - q);
      for (const c of [...cuts, s + len]) {
        const t = (c - s) / len;
        const x = a[0] + (b[0] - a[0]) * t, y = a[1] + (b[1] - a[1]) * t;
        const zEnd = inTab(c - 1e-6) ? tabs.top : z;
        this.feed(x, y, zEnd, f);
        const zNext = inTab(c + 1e-6) ? tabs.top : z;
        if (zNext !== zEnd) this.feed(x, y, zNext, f);
      }
      s += len;
    }
  }
}

function tabIntervals(loop, op, t) {
  const L = loopLength(loop);
  const n = Math.max(1, Math.round(+op.tabCount || 4));
  const w = (+op.tabWidth || 5) + t.dia;
  return Array.from({ length: n }, (_, k) => { const c = (L * (k + 0.5)) / n; return [c - w / 2, c + w / 2]; });
}

// ---------- 2D strategies ----------
// where the stock still has material above z (only for stock with a height field: previous setup, solid
// blank); null = a full block. Slightly grown so no material is missed.
function stockMatAt(stock, z, zAbove = Infinity) {
  const hm = stock?.shape?.type === 'map' ? stock.shape.hm : null;
  if (!hm) return null;
  const polys = rasterPolys(hm, k => hm.h[k] > z + 0.05 && !(hm.hb && hm.hb[k] >= zAbove - 0.05));
  return polys.length ? offsetPaths(polys, hm.res) : [];
}

function genFace(op, t, P, h, stock) {
  const so = t.dia * (+op.stepover || t.stepover);
  const r = t.dia / 2;
  const lv = levels(h.top, h.bottom, +op.stepdown || t.stepdown);
  if (!lv.length) throw new Error('Kein Material zum Planfräsen (Aufmaß oben ist 0)');
  const x0 = stock.minX - r - 2, x1 = stock.maxX + r + 2;
  const ys = [];
  for (let y = stock.minY; y < stock.maxY - 1e-6; y += so) ys.push(y);
  ys.push(stock.maxY);
  const hm = stock.shape?.type === 'map' ? stock.shape.hm : null;
  // x range of the material in a row band (stock with a height field); null = nothing to cut there
  const rowSpan = (y, z, zA) => {
    if (!hm) return [x0, x1];
    const j0 = Math.max(0, Math.floor((y - r - hm.minY) / hm.res)), j1 = Math.min(hm.ny - 1, Math.ceil((y + r - hm.minY) / hm.res));
    let a = Infinity, b = -Infinity;
    for (let j = j0; j <= j1; j++) for (let i = 0; i < hm.nx; i++) if (hm.h[j * hm.nx + i] > z + 0.05 && !(hm.hb && hm.hb[j * hm.nx + i] >= zA - 0.05)) { const x = hm.minX + i * hm.res; if (x < a) a = x; if (x > b) b = x; }
    return a <= b ? [Math.max(x0, a - r - 2), Math.min(x1, b + r + 2)] : null;
  };
  let n = 0;
  let zA = h.top;
  for (const z of lv) {
    const rows = ys.map(y => [y, rowSpan(y, z, zA)]).filter(([, sp]) => sp);
    zA = z;
    if (!rows.length) continue;
    let k = 0, last = null;
    for (const [y, [xa0, xb0]] of rows) {
      const fwd = k % 2 === 0, xa = fwd ? xa0 : xb0, xb = fwd ? xb0 : xa0;
      // rows next to each other are linked at the side; after a gap the tool lifts
      if (!last || y - last > so + 1e-6) { if (last) P.retract(); P.plungeAt(xa, y, z, t.plunge); }
      else P.feed(xa, y, z, t.feed);
      P.feed(xb, y, z, t.feed);
      last = y; k++; n++;
    }
    P.retract();
  }
  if (!n) throw new Error('Kein Material zum Planfräsen – das Rohteil ist hier schon abgetragen');
}

function contourLoops(op, g, offset, inside) {
  let polys;
  if (!Array.isArray(op.entities)) polys = inside ? g.regions.flatMap(r => (r.holes.length ? r.holes : [r.outer])) : g.regions.map(r => r.outer);
  else polys = g.items.map(i => i.poly);
  const wantCW = !inside === (op.direction !== 'conventional');
  const loops = [];
  const minR = +op.minCutRadius || 0;
  for (const poly of polys) {
    let paths = offset ? offsetPaths([toC(ensureCCW(poly))], inside ? -offset : offset, !!op.sharpCorners) : [toC(ensureCCW(poly))];
    // minimum cutting radius: round the corners the tool would otherwise go into
    if (minR > 0) paths = inside ? offsetPaths(offsetPaths(paths, -minR), minR) : offsetPaths(offsetPaths(paths, minR), -minR);
    if (op.smoothing && +op.smoothTol > 0) paths = CL().Clipper.CleanPolygons(paths, +op.smoothTol * S);
    for (let loop of paths.map(fromC)) {
      if ((signedArea(loop) < 0) !== wantCW) loop = loop.slice().reverse();
      loops.push(loop);
    }
  }
  return loops;
}

// Lead-in / lead-out on the side away from the material: arc (radius, sweep angle) plus an
// optional straight extension, or a straight perpendicular move.
function leadArcs(loop, R, materialInside, o = {}) {
  const [s, q] = [loop[0], loop[1]];
  const L = Math.hypot(q[0] - s[0], q[1] - s[1]) || 1;
  const t = [(q[0] - s[0]) / L, (q[1] - s[1]) / L];
  let n = [-t[1], t[0]];
  const probe = [s[0] + n[0] * 1e-3, s[1] + n[1] * 1e-3];
  const probeInside = pointInPoly(probe, loop);
  if (probeInside === materialInside) n = [-n[0], -n[1]]; // n must point into free space
  const side = (sp, sign) => {
    const pts = [];
    if (sp.perp) {
      const d = sp.R + (sp.linear || 0);
      pts.push([s[0] + n[0] * d, s[1] + n[1] * d]);
    } else if (sp.R > 0) {
      const sw = (Math.min(180, Math.max(1, sp.sweep ?? 90)) * Math.PI) / 180, C = [s[0] + n[0] * sp.R, s[1] + n[1] * sp.R];
      const at = ph => [C[0] - n[0] * sp.R * Math.cos(ph) + sign * t[0] * sp.R * Math.sin(ph), C[1] - n[1] * sp.R * Math.cos(ph) + sign * t[1] * sp.R * Math.sin(ph)];
      const N = Math.max(4, Math.ceil(sw / (Math.PI / 24)));
      for (let i = N; i >= 0; i--) pts.push(at((sw * i) / N));
      if (sp.linear > 0) {
        const e = pts[0], dir = [sign * (t[0] * Math.cos(sw)) + n[0] * Math.sin(sw), sign * (t[1] * Math.cos(sw)) + n[1] * Math.sin(sw)];
        pts.unshift([e[0] + dir[0] * sp.linear, e[1] + dir[1] * sp.linear]);
      }
    } else if (sp.linear > 0) pts.push([s[0] - sign * t[0] * sp.linear, s[1] - sign * t[1] * sp.linear]);
    pts.push(s);
    return pts;
  };
  const inn = { R, sweep: o.sweep, linear: o.linear, perp: o.perp };
  const outSp = o.out || inn;
  const lin = side(inn, -1);
  const lout = side(outSp, 1).reverse();
  return { lin, lout };
}
// lead settings of an operation (old projects: leadIn = arc radius)
function leadOpts(op) {
  const on = op.leadInOn ?? (+op.leadIn > 0);
  if (!on) return null;
  const inn = { R: +op.leadIn || 0, sweep: +op.leadSweep || 90, linear: +op.leadLinear || 0, perp: !!op.leadPerp };
  const outOn = op.leadOutOn ?? true;
  const out = !outOn ? { R: 0, linear: 0 } : op.leadOutSame === false ? { R: +op.leadOutR || 0, sweep: +op.leadOutSweep || 90, linear: +op.leadOutLinear || 0, perp: !!op.leadOutPerp } : inn;
  if (!(inn.R > 0 || inn.linear > 0) && !(out.R > 0 || out.linear > 0)) return null;
  return { ...inn, out, vert: +op.leadVert || 0 };
}
// tool position on the loop closest to the preferred entry points ("Bevorzugte Einfahrpositionen")
function entryRotate(loop, op, P) {
  const pts = (op.entryPts || []).filter(q => Array.isArray(q));
  if (pts.length) {
    let best = null, bd = Infinity;
    for (const q of pts) for (const v of loop) { const d = (v[0] - q[0]) ** 2 + (v[1] - q[1]) ** 2; if (d < bd) { bd = d; best = q; } }
    return rotateNearest(loop, { x: best[0], y: best[1] });
  }
  return P.p ? rotateNearest(loop, P.p) : loop;
}
// one closed pass that runs past its start by "overlap" mm ("Überlappung")
function overlapRun(P, loop, z, f, d) {
  let left = d;
  for (let k = 1; k <= loop.length && left > 1e-6; k++) {
    const a = loop[k - 1], b = loop[k % loop.length], L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (L >= left) { P.feed(a[0] + ((b[0] - a[0]) * left) / L, a[1] + ((b[1] - a[1]) * left) / L, z, f); return a; }
    P.feed(b[0], b[1], z, f);
    left -= L;
  }
  return null;
}

// depth levels with optional finishing depth cuts ("Tiefenschnitte")
function depthLevels(op, t, h) {
  if (op.multiDepth === false) return h.bottom < h.top - 1e-6 ? [h.bottom] : [];
  const nfd = op.finishDepth ? Math.max(0, Math.round(+op.finishDepthCount || 1)) : 0, fds = +op.finishDepthStep || 0.2;
  const roughBottom = h.bottom + nfd * fds;
  const lv = roughBottom < h.top - 1e-6 ? levels(h.top, roughBottom, +op.stepdown || t.stepdown) : [];
  for (let k = nfd - 1; k >= 0; k--) lv.push(+(h.bottom + k * fds).toFixed(4));
  return lv.filter((z, i, a) => z < h.top - 1e-6 && (i === 0 || Math.abs(z - a[i - 1]) > 1e-6));
}

function genContour(op, t, P, h, project) {
  const g = opGeometry(op, project);
  const inside = op.side === 'inside';
  // compensation: in computer (default), at the control (path on the contour + G41/G42), wear (both), off (tool centre on contour)
  const ct = op.compType || 'computer';
  const stl = op.stockOn === false ? 0 : +op.stockToLeave || 0;
  const base = (ct === 'control' || ct === 'off' ? 0 : t.dia / 2) + stl;
  const climb = op.direction !== 'conventional';
  const compSide = ct === 'control' || ct === 'wear' || ct === 'inverseWear' ? ((climb !== (ct === 'inverseWear')) ? 'L' : 'R') : null;
  // finishing passes: the outermost offset first, the final pass on size
  const multiF = op.multiFinish ?? (+op.finishPasses > 0);
  const nf = multiF ? Math.max(0, Math.round(+op.finishPasses || 0)) : 0, fs = +op.finishStepover || 0.3;
  const nr = op.roughPasses ? Math.max(0, Math.round(+op.roughCount || 1)) : 0, rs = +op.roughStepover || t.dia * 0.4;
  const offsets = [
    ...Array.from({ length: nr }, (_, k) => base + nf * fs + (nr - k) * rs),
    ...Array.from({ length: nf + 1 }, (_, k) => base + (nf - k) * fs),
  ];
  if (op.repeatFinish) offsets.push(base);
  const lv = depthLevels(op, t, h);
  if (!lv.length) throw new Error('Unterkante liegt über der Oberkante');
  if (+op.restDia > t.dia) {
    // rest machining: only the stretches of the contour a cutter of the previous diameter could not follow
    // (inside corners, narrow places). Where that cutter has been, this tool's path coincides with the path
    // along the wall it left – those parts are skipped.
    if (ct !== 'computer') throw new Error('Restmaterial an der Kontur braucht die Korrektur „Im Rechner“');
    const R1 = +op.restDia / 2, r = t.dia / 2, plain = { ...op, minCutRadius: 0, smoothing: false };
    const fin = contourLoops(op, g, base, inside);
    if (!fin.length) throw new Error('Werkzeug zu groß für die Kontur');
    const big = contourLoops(plain, g, R1 + stl, inside);
    const done = big.length ? offsetPaths(big.map(l => toC(ensureCCW(l))), inside ? R1 - r : -(R1 - r)).map(fromC) : [];
    const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy, u = L2 > 1e-18 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)) : 0; return Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy); };
    const isDone = p => done.some(l => l.some((a, i) => segD(p, a, l[(i + 1) % l.length]) <= 0.02));
    const ext = Math.max(0.5, r / 2), step = 0.25, runs = [];
    for (const loop of fin) {
      const pts = densify(loop, step, true).slice(0, -1), n = pts.length, todo = pts.map(p => !isDone(p));
      if (todo.every(Boolean)) { runs.push({ pts: [...pts, pts[0]], closed: true }); continue; }
      if (!todo.some(Boolean)) continue;
      // a little further along the finished wall at both ends, so the cut blends in
      const k = Math.ceil(ext / step), grow = todo.slice();
      for (let i = 0; i < n; i++) if (todo[i]) for (let j = -k; j <= k; j++) grow[(((i + j) % n) + n) % n] = true;
      if (grow.every(Boolean)) { runs.push({ pts: [...pts, pts[0]], closed: true }); continue; }
      const s0 = grow.findIndex((v, i) => v && !grow[(i - 1 + n) % n]);
      for (let c = 0, i = s0; c < n; ) {
        if (!grow[i % n]) { i++; c++; continue; }
        const run = [];
        while (c < n && grow[i % n]) { run.push(pts[i % n]); i++; c++; }
        if (run.length > 1) runs.push({ pts: run, closed: false });
      }
    }
    if (!runs.length) throw new Error('Kein Restmaterial – der vorige Fräser erreicht schon alles');
    const fF = +op.finishFeed || t.feed;
    for (const run of nearestOrder(runs, q => q.pts[0])) {
      for (const z of lv) {
        P.plungeAt(run.pts[0][0], run.pts[0][1], z, t.plunge);
        for (const [x, y] of run.pts.slice(1)) P.feed(x, y, z, fF);
        P.retract();
      }
    }
    return { rest: true, restRuns: runs.length };
  }
  let lead = leadOpts(op);
  // the control can switch compensation on/off only on a straight move: make sure the leads have one
  if (compSide) {
    const need = +(t.dia / 2 + 0.5).toFixed(3);
    // (perpendicular: the whole lead is the straight move, it must be longer than the tool radius)
    const fix = sp => (!sp ? sp : sp.perp ? { ...sp, linear: Math.max(sp.linear || 0, need - (+sp.R || 0)) } : sp.R > 0 || sp.linear > 0 ? { ...sp, linear: Math.max(sp.linear || 0, need) } : sp);
    if (!lead) lead = { R: need, perp: true, linear: 0, out: { R: need, perp: true, linear: 0 }, vert: 0 };
    else {
      const same = lead.out && lead.out.R === lead.R && lead.out.linear === lead.linear && lead.out.perp === lead.perp && lead.out.sweep === lead.sweep;
      const inn = fix(lead);
      lead = { ...inn, out: same ? { R: inn.R, sweep: inn.sweep, linear: inn.linear, perp: inn.perp } : fix(lead.out), vert: lead.vert };
    }
  }
  const fFinal = +op.finishFeed || t.feed, ov = +op.overlap || 0;
  // all loops of all offsets; each pass knows whether it is the final one
  const passes = [];
  let bonesC = 0;
  offsets.forEach((off, oi) => {
    let loops = contourLoops(op, g, off, inside);
    if (!op.keepOrder) loops = nearestOrder(loops, l => l[0]);
    const final = oi >= offsets.length - (op.repeatFinish ? 2 : 1);
    for (const loop of loops) {
      // relief in the inside corners on the finishing pass (not with compensation at the control: its path is the contour itself)
      const q = final && !compSide && op.dogbone && op.dogbone !== 'none' ? withDogbones(loop, off, t.dia / 2, op.dogbone) : loop;
      bonesC += q.dogbones || 0;
      passes.push({ loop: q, final });
    }
  });
  if (!passes.length) throw new Error('Werkzeug zu groß für die Kontur');
  const cut = (pass, z, first) => {
    let loop = entryRotate(pass.loop, op, P);
    const f = pass.final ? fFinal : t.feed;
    const tabs = op.tabs ? { top: h.bottom + (+op.tabHeight || 1.5), intervals: tabIntervals(loop, op, t) } : null;
    if (lead && loop.length > 2) {
      const { lin, lout } = leadArcs(loop, lead.R, !inside, lead);
      const zs = z + lead.vert;
      // next depth of the same contour: stay down and move over to the lead-in start
      if (first || !P.p || P.p.z >= P.clear - 1e-6) P.plungeAt(lin[0][0], lin[0][1], zs, t.plunge);
      else { P.feed(lin[0][0], lin[0][1], P.p.z, t.transitionFeed ?? t.feed); P.feed(lin[0][0], lin[0][1], zs, t.plunge); }
      P.comp = compSide;
      // with compensation at the control the leads are marked: a post can write them as the control's own
      // approach/departure (Heidenhain APPR/DEP); shape: perpendicular line, tangential line or arc (+ line)
      const tag = (k, sp) => (compSide ? { k, perp: !!sp.perp, R: +sp.R || 0, sweep: sp.sweep ?? 90, linear: +sp.linear || 0 } : null);
      P.lead = tag('in', lead);
      lin.slice(1).forEach(([x, y], i, a) => P.feed(x, y, zs - (lead.vert * (i + 1)) / a.length, t.leadInFeed ?? t.feed));
      P.lead = null;
      P.loopPass(loop, z, f, tabs);
      if (ov > 0) overlapRun(P, loop, z, f, ov);
      P.lead = tag('out', lead.out || lead);
      for (const [x, y] of lout.slice(1)) P.feed(x, y, z, t.leadOutFeed ?? t.feed);
      P.lead = null;
      P.comp = null;
      return;
    }
    P.enterLoop(loop, h.top + 0.5, z, t, op.rampType === 'plunge' ? 0 : +op.ramp);
    P.comp = compSide;
    P.loopPass(loop, z, f, tabs);
    if (ov > 0) overlapRun(P, loop, z, f, ov);
    P.comp = null;
  };
  if (op.orderByDepth) {
    lv.forEach(z => { passes.forEach((ps, i) => cut(ps, z, i === 0)); P.retract(); });
  } else {
    for (const ps of passes) { lv.forEach((z, i) => cut(ps, z, i === 0)); P.retract(); }
  }
  if (bonesC) return { dogbones: bonesC, ...(op.ctrlCycle ? { studCycle: null, studCycleWhy: 'Eckenfreistiche gibt es nur als Bahn' } : {}) };
  if (!op.ctrlCycle) return {};
  // "Steuerungszyklus": an outside contour around a rectangle or circle is the control's stud cycle
  // (blank size = finished size + what this operation removes)
  const why = inside ? 'Nur Außenkonturen (Zapfen) gehen als Steuerungszyklus' : op.tabs ? 'Haltestege gehen nicht mit dem Steuerungszyklus' : null;
  if (why) return { studCycle: null, studCycleWhy: why };
  const outers = Array.isArray(op.entities) ? g.items.map(i => i.poly) : g.regions.map(r => r.outer);
  const fit = pocketShapes(outers, { dia: 0 });
  if (fit.why) return { studCycle: null, studCycleWhy: fit.why.replace('Tasche', 'Kontur') };
  const removal = Math.max(0.5, offsets[0] - base);
  const resC = {
    studCycle: {
      pockets: fit.shapes.map(s => ({ ...s, kind: s.kind === 'circ' ? 'circ' : 'rect', blank: removal })), top: cycleTop(h), bottom: h.bottom,
      stepdown: lv.length > 1 ? Math.abs(lv[0] - lv[1]) || (h.top - h.bottom) : h.top - h.bottom, stl, overlap: Math.min(1.9999, Math.max(0.1, (nr ? rs : t.dia * 0.4) / (t.dia / 2))),
      climb, feed: fFinal, plunge: t.plunge, clear: P.clear, toolR: t.dia / 2,
    },
  };
  return resC;
}

function genChamfer(op, t, P, h, project) {
  if (t.type !== 'chamfer') throw new Error('Für 2D-Fase einen Fasenfräser (V) wählen');
  const g = opGeometry(op, project);
  const inside = op.side === 'inside';
  const half = ((t.angle || 90) / 2) * (Math.PI / 180);
  const tipR = (t.tip || 0) / 2;
  const extra = +op.extraDepth || 0.2;
  const w = +op.width || 0.5;
  const depth = w / Math.tan(half) + extra;
  const off = tipR + extra * Math.tan(half);
  if (tipR + depth * Math.tan(half) > t.dia / 2 + 1e-6) throw new Error('Fase zu breit für dieses Werkzeug');
  const z = h.edge - depth;
  const loops = contourLoops(op, g, off, inside);
  if (!loops.length) throw new Error('Keine Kontur für die Fase');
  const lead = leadOpts(op);
  for (let loop of op.keepOrder ? loops : nearestOrder(loops, l => l[0])) {
    loop = entryRotate(loop, op, P);
    if (lead && loop.length > 2) {
      const { lin, lout } = leadArcs(loop, lead.R, !inside, lead);
      P.plungeAt(lin[0][0], lin[0][1], z, t.plunge);
      for (const [x, y] of lin.slice(1)) P.feed(x, y, z, t.leadInFeed ?? t.feed);
      P.loopPass(loop, z, t.feed);
      for (const [x, y] of lout.slice(1)) P.feed(x, y, z, t.leadOutFeed ?? t.feed);
    } else {
      P.plungeAt(loop[0][0], loop[0][1], z, t.plunge);
      P.loopPass(loop, z, t.feed);
    }
    P.retract();
  }
}

function pocketRings(region, firstOffset, so) {
  const rings = [];
  let cur = offsetPaths(region, -firstOffset);
  for (let guard = 0; cur.length && guard < 3000; guard++) {
    rings.push(cur.map(fromC));
    cur = offsetPaths(cur, -so);
  }
  return rings;
}

// Eckenfreistich ("Dogbone"): a round cutter leaves its radius in every inside corner, so a square part does not
// fit into a milled pocket. At each sharp corner of the wall pass the cutter makes a short move into the corner
// and back. loop = tool centre path, off = its distance from the wall, R = cutter radius.
// kind 'dogbone': along the bisector, just far enough to reach the corner; 'tbone': straight on along the wall.
export function withDogbones(loop, off, R, kind = 'dogbone') {
  const n = loop.length;
  if (n < 3 || !(off > 0) || !(R > 0)) return loop;
  const out = [];
  let count = 0;
  for (let i = 0; i < n; i++) {
    const a = loop[(i - 1 + n) % n], b = loop[i], c = loop[(i + 1) % n];
    out.push(b);
    const l1 = Math.hypot(b[0] - a[0], b[1] - a[1]), l2 = Math.hypot(c[0] - b[0], c[1] - b[1]);
    if (l1 < 1e-6 || l2 < 1e-6) continue;
    const u = [(b[0] - a[0]) / l1, (b[1] - a[1]) / l1], v = [(c[0] - b[0]) / l2, (c[1] - b[1]) / l2];
    const turn = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    // rounded corners of an offset are many small turns; a real inside corner is one sharp turn
    if (turn < 0.7 || turn > Math.PI - 0.35) continue;
    let d, dir;
    if (kind === 'tbone') {
      if (off > R + 1e-6) continue; // with stock to leave the cutter cannot reach the corner this way
      d = off * Math.tan(turn / 2); dir = u;
    } else {
      const w = [u[0] - v[0], u[1] - v[1]], wl = Math.hypot(w[0], w[1]);
      d = off / Math.cos(turn / 2) - R; dir = [w[0] / wl, w[1] / wl];
    }
    if (!(d > 0.01)) continue;
    out.push([b[0] + dir[0] * d, b[1] + dir[1] * d], [b[0], b[1]]);
    count++;
  }
  out.dogbones = count;
  return out;
}

// Clear rings level by level, inside-out, staying down between neighbouring rings.
function clearRings(P, rings, lv, t, op, so, zTop) {
  const ordered = rings.slice().reverse();
  let zPrev = zTop;
  for (const z of lv) {
    for (const ring of ordered) {
      for (let loop of ring) {
        if (op.direction === 'conventional') loop = loop.slice().reverse();
        // the next ring starts where it is closest: one stepover away, so the cutter stays down and crosses
        // only material this ring removes anyway (a longer link could clip a wall, so it retracts instead)
        if (P.p) loop = rotateNearestOn(loop, P.p);
        const [sx, sy] = loop[0];
        const near = P.p && Math.abs(P.p.z - z) < 1e-6 && Math.hypot(P.p.x - sx, P.p.y - sy) <= so + 0.01;
        if (near) P.feed(sx, sy, z, t.feed);
        else P.enterLoop(loop, zPrev + 0.5, z, t, op.rampType === 'plunge' ? 0 : +op.ramp);
        P.loopPass(loop, z, t.feed);
      }
    }
    P.retract();
    zPrev = z;
  }
}

function genPocket(op, t, P, h, project) {
  const g = opGeometry(op, project);
  const paths = Array.isArray(op.entities) ? g.items.map(i => i.poly) : g.regions.flatMap(r => [r.outer, ...r.holes]);
  const so = t.dia * (+op.stepover || t.stepover);
  const region = unionEvenOdd(paths.map(toC)), stl = +op.stockToLeave || 0;
  const rest = +op.restDia > t.dia;
  let rings;
  if (rest) {
    // rest machining: only where a cutter of the previous diameter left material (corners, narrow places).
    // The cutter centre stays inside the pocket's own offset and within reach of that material; the rings
    // run from the wall towards the side the previous cutter has already cleared.
    const allowed = offsetPaths(region, -(t.dia / 2 + stl));
    if (!allowed.length) throw new Error('Werkzeug zu groß für die Tasche');
    const R1 = +op.restDia / 2 + stl;
    const reached = offsetPaths(offsetPaths(region, -R1), R1 + 0.02);
    const material = reached.length ? clip(region, reached, 'ctDifference') : region;
    if (!material.length) throw new Error('Kein Restmaterial – der vorige Fräser erreicht schon alles');
    const band = clip(allowed, offsetPaths(material, t.dia / 2), 'ctIntersection');
    rings = [];
    for (let cur = band, guard = 0; cur.length && guard < 3000; guard++) { rings.push(cur.map(fromC)); cur = offsetPaths(cur, -so); }
    if (!rings.length) throw new Error('Kein Restmaterial – der vorige Fräser erreicht schon alles');
  } else rings = pocketRings(region, t.dia / 2 + stl, so);
  if (!rings.length) throw new Error('Werkzeug zu groß für die Tasche');
  // relief in the inside corners: on the pass along the wall
  let bones = 0;
  if (!rest && op.dogbone && op.dogbone !== 'none') rings[0] = rings[0].map(l => { const q = withDogbones(l, t.dia / 2 + stl, t.dia / 2, op.dogbone); bones += q.dogbones || 0; return q; });
  const lv = levels(h.top, h.bottom, +op.stepdown || t.stepdown);
  if (!lv.length) throw new Error('Unterkante liegt über der Oberkante');
  clearRings(P, rings, lv, t, op, so, h.top);
  if (rest) return { rest: true };
  if (bones) return { dogbones: bones, ...(op.ctrlCycle ? { pocketCycle: null, pocketCycleWhy: 'Eckenfreistiche gibt es nur als Bahn' } : {}) };
  if (!op.ctrlCycle) return {};
  // "Steuerungszyklus": rectangular / circular pockets go to the control's own pocket cycle (the moves here
  // stay for the simulation and for controls without one)
  const fit = pocketShapes(paths, t);
  if (fit.why) return { pocketCycle: null, pocketCycleWhy: fit.why };
  return {
    pocketCycle: {
      pockets: fit.shapes, top: cycleTop(h), bottom: h.bottom, stepdown: +op.stepdown || t.stepdown, stl: +op.stockToLeave || 0,
      overlap: Math.min(1.9999, Math.max(0.1, so / (t.dia / 2))), climb: op.direction !== 'conventional', feed: t.feed, plunge: t.plunge, clear: P.clear,
      helix: !(op.rampType === 'plunge'), ramp: +op.ramp || 3, toolR: t.dia / 2,
    },
  };
}

// Pockets a control cycle can mill: a rectangle (any rotation, rounded corners) or a circle, without islands.
// Returns { shapes: [{ kind: 'rect', cx, cy, w, l, rc, ang } | { kind: 'circ', cx, cy, d }] } or { why }.
function pocketShapes(paths, t) {
  const loops = paths.filter(p => p.length >= 3);
  for (let i = 0; i < loops.length; i++) for (let j = 0; j < loops.length; j++)
    if (i !== j && pointInPoly(loops[j][0], loops[i])) return { why: 'Tasche mit Insel – der Steuerungszyklus kann keine Inseln' };
  const shapes = [];
  for (const pl of loops) {
    const A = Math.abs(signedArea(pl));
    // area centroid
    let cx = 0, cy = 0, s = 0;
    for (let k = 0; k < pl.length; k++) {
      const [x0, y0] = pl[k], [x1, y1] = pl[(k + 1) % pl.length], c = x0 * y1 - x1 * y0;
      cx += (x0 + x1) * c; cy += (y0 + y1) * c; s += c;
    }
    cx /= 3 * s; cy /= 3 * s;
    const rs = pl.map(([x, y]) => Math.hypot(x - cx, y - cy)), rm = rs.reduce((a, b) => a + b, 0) / rs.length;
    if (pl.length >= 8 && rs.every(r => Math.abs(r - rm) < 0.01 + 0.002 * rm)) {
      if (2 * rm <= t.dia + 0.01) return { why: 'Kreistasche nicht größer als das Werkzeug' };
      shapes.push({ kind: 'circ', cx, cy, d: 2 * rm });
      continue;
    }
    // smallest bounding rectangle over the edge directions, corner radius from the missing area
    let best = null;
    for (let k = 0; k < pl.length; k++) {
      const [x0, y0] = pl[k], [x1, y1] = pl[(k + 1) % pl.length];
      if (Math.hypot(x1 - x0, y1 - y0) < 0.05) continue;
      const a = Math.atan2(y1 - y0, x1 - x0), c = Math.cos(a), sn = Math.sin(a);
      let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
      for (const [x, y] of pl) { const u = x * c + y * sn, v = -x * sn + y * c; u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); }
      const ar = (u1 - u0) * (v1 - v0);
      if (!best || ar < best.ar - 1e-6) best = { ar, a, c, sn, u0, u1, v0, v1 };
    }
    if (!best) return { why: 'Taschenform nicht erkannt' };
    const w = best.u1 - best.u0, l = best.v1 - best.v0;
    const uc = (best.u0 + best.u1) / 2, vc = (best.v0 + best.v1) / 2;
    // deviation of the outline from a rounded rectangle with corner radius r (the vertices lie on the true shape)
    const dev = r => Math.max(...pl.map(([x, y]) => {
      const u = Math.abs(x * best.c + y * best.sn - uc) - (w / 2 - r), v = Math.abs(-x * best.sn + y * best.c - vc) - (l / 2 - r);
      return Math.abs(Math.hypot(Math.max(u, 0), Math.max(v, 0)) + Math.min(Math.max(u, v), 0) - r);
    }));
    // corner radius: first guess from the missing area, then refined on the vertices
    let lo = 0, hi = Math.min(w, l) / 2;
    const r0 = Math.min(hi, Math.sqrt(Math.max(0, (w * l - A) / (4 - Math.PI))));
    lo = Math.max(0, r0 * 0.8 - 0.05); hi = Math.min(hi, r0 * 1.2 + 0.05);
    for (let it = 0; it < 60; it++) { const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3; if (dev(m1) < dev(m2)) hi = m2; else lo = m1; }
    let rc = (lo + hi) / 2;
    if (Math.abs(rc - Math.round(rc * 100) / 100) < 0.003) rc = Math.round(rc * 100) / 100;
    const ok = dev(rc) < 0.02;
    if (!ok) return { why: 'Nur Rechteck- und Kreistaschen gehen als Steuerungszyklus' };
    if (Math.min(w, l) <= t.dia + 0.01) return { why: 'Tasche schmaler als das Werkzeug' };
    // rotation in (−45°, 45°]: a quarter turn swaps the side lengths
    let ang = (best.a * 180) / Math.PI, flip = false;
    while (ang > 45 + 1e-6) { ang -= 90; flip = !flip; }
    while (ang <= -45 + 1e-6) { ang += 90; flip = !flip; }
    if (Math.abs(ang) < 1e-6) ang = 0;
    const cxr = uc * best.c - vc * best.sn, cyr = uc * best.sn + vc * best.c;
    let W1 = flip ? l : w, W2 = flip ? w : l;
    if (Math.abs(rc - Math.min(w, l) / 2) < 0.02 && Math.abs(w - l) > 0.05) {
      // slot: length along the angle, width across, fully rounded ends
      if (W1 < W2) { [W1, W2] = [W2, W1]; ang += ang > 0 ? -90 : 90; }
      shapes.push({ kind: 'slot', cx: cxr, cy: cyr, w: W1, l: W2, rc: W2 / 2, ang: Math.abs(ang) < 1e-6 ? 0 : Math.round(ang * 1e4) / 1e4 });
      continue;
    }
    shapes.push({ kind: 'rect', cx: cxr, cy: cyr, w: W1, l: W2, rc: rc < 0.01 ? 0 : rc, ang: Math.round(ang * 1e4) / 1e4 });
  }
  return shapes.length ? { shapes } : { why: 'Keine Tasche' };
}

// Adaptive clearing of a sketch region, level by level.
function genAdaptive(op, t, P, h, project, stock) {
  const g = opGeometry(op, project);
  const paths = Array.isArray(op.entities) ? g.items.map(i => i.poly) : g.regions.flatMap(r => [r.outer, ...r.holes]);
  const region = unionEvenOdd(paths.map(toC));
  const allowed = offsetPaths(region, -(t.dia / 2 + (+op.stockToLeave || 0)));
  if (!allowed.length) throw new Error('Werkzeug zu groß für den Bereich');
  const lv = levels(h.top, h.bottom, +op.stepdown || t.stepdown);
  if (!lv.length) throw new Error('Unterkante liegt über der Oberkante');
  const ae = t.dia * (+op.stepover || 0.1);
  let material = region;
  if (+op.restDia > t.dia) {
    // rest machining: only what a tool of the previous diameter could not reach
    const R1 = +op.restDia / 2 + (+op.stockToLeave || 0);
    const opened = offsetPaths(offsetPaths(region, -R1), R1);
    material = opened.length ? clip(region, opened, 'ctDifference') : region;
    if (!material.length) throw new Error('Kein Restmaterial – der vorige Fräser erreicht schon alles');
  }
  let zPrev = h.top, n = 0;
  for (const z of lv) {
    // stock with a height field (previous setup, solid blank): only the material that is still there
    const sm = stockMatAt(stock, z, zPrev);
    const mat = sm ? (sm.length ? clip(material, sm, 'ctIntersection') : []) : material;
    if (!mat.length) continue;
    adaptiveLevel(P, { allowed, material: mat, z, zFrom: zPrev + 0.5, tool: t, ae, rampDeg: +op.ramp || 2, climb: op.direction !== 'conventional', finishPass: !(+op.restDia > t.dia) });
    zPrev = z; n++;
  }
  if (!n) throw new Error('Kein Material im Bereich – das Rohteil ist hier schon abgetragen');
}

function circlesOf(op, project) {
  const g = opGeometry(op, project);
  const c = g.items.filter(i => i.e.type === 'circle').map(i => ({ p: g.X.tr([i.e.cx, i.e.cy]), r: i.e.r }));
  if (!c.length) throw new Error('Keine Kreise in der Auswahl');
  return c;
}

export const DRILL_CYCLES = {
  drill: 'Bohren', dwell: 'Bohren mit Verweilzeit', peck: 'Tieflochbohren (Rückzug)', chip: 'Spanbruch',
  tap: 'Gewindebohren', ream: 'Reiben', bore: 'Ausdrehen',
};

// Drilling cycles. The moves written here are the expanded form (simulation and
// controls without canned cycles); r.cycle carries the data for cycle output.
function genDrill(op, t, P, h, project) {
  const ord = orderHoles(circlesOf(op, project), c => c.p, op.holeOrder || 'shortest');
  const holes = ord.items;
  // without an explicit cycle the tool decides: a tap taps, a reamer reams (never a drilling cycle with them)
  const type = op.cycle || (t.type === 'tap' ? 'tap' : t.type === 'ream' ? 'ream' : +op.peck > 0 ? 'peck' : 'drill');
  if (t.type === 'tap' && type !== 'tap') throw new Error('Mit einem Gewindebohrer nur Zyklus „Gewindebohren“ – ein Bohrzyklus würde ihn abbrechen');
  const peck = +op.peck || 0;
  const dwell = +op.dwell || 0;
  const pitch = type === 'tap' ? +op.pitch || +t.pitch || 1 : 0;
  // tapping feed is tied to the spindle: F = n * pitch
  const feed = type === 'tap' ? t.rpm * pitch : t.plunge;
  if (type === 'tap' && t.type !== 'tap') throw new Error('Für Gewindebohren einen Gewindebohrer wählen');
  for (const { p: [x, y] } of holes) {
    P.moveAbove(x, y);
    if ((type === 'peck' || type === 'chip') && peck > 0) {
      let z = h.top;
      while (z > h.bottom + 1e-6) {
        const nz = Math.max(h.bottom, z - peck);
        if (z < h.top) P.rapid(x, y, type === 'peck' ? z + 0.5 : z + 0.2);
        P.feed(x, y, nz, feed);
        // deep-hole: full retract to clear chips; chip break: short pull-back only
        if (type === 'peck' || nz <= h.bottom + 1e-6) P.rapid(x, y, type === 'peck' ? P.clear : nz);
        else P.rapid(x, y, nz + 0.2);
        z = nz;
      }
      P.rapid(x, y, P.clear);
    } else {
      P.feed(x, y, h.bottom, feed);
      if (dwell > 0 && (type === 'dwell' || type === 'ream' || type === 'bore')) P.dwell(dwell);
      if (type === 'tap' || type === 'ream') P.feed(x, y, P.clear, feed); // out under feed (reverse spindle for tapping)
      else P.rapid(x, y, P.clear);
    }
  }
  return {
    cycle: {
      type, pts: holes.map(c => c.p), top: cycleTop(h), bottom: h.bottom, clear: P.clear,
      peck: peck > 0 ? peck : h.top - h.bottom, dwell, pitch, feed, rpm: t.rpm, left: op.hand === 'left',
    },
    holeOrder: { n: holes.length, len: ord.len, before: ord.before, nearest: ord.nearest },
  };
}

// Follow sketch curves (open or closed) at a fixed depth below the sketch plane.
function genTrace(op, t, P, h, project) {
  const sk = project.features.find(f => f.id === op.sketch && f.type === 'sketch');
  if (!sk) throw new Error('Keine Skizze als Geometrie gewählt');
  const X = sketchXY(sk);
  const curves = sk.entities
    .filter(e => !Array.isArray(op.entities) || op.entities.includes(e.id))
    .flatMap(e => entityOutlines(e))
    .filter(o => o.pts.length >= 2)
    .map(o => ({ pts: o.pts.map(X.tr), closed: o.closed }));
  if (!curves.length) throw new Error('Keine Kurven ausgewählt');
  const depth = +op.depth || 0.5;
  const zTop = X.z;
  const lv = levels(zTop, zTop - depth, +op.stepdown || depth);
  for (const c of nearestOrder(curves, x => x.pts[0])) {
    const pts = c.closed ? [...c.pts, c.pts[0]] : c.pts;
    lv.forEach((z, i) => {
      // open curves are cut back and forth so the tool never leaves the groove
      const seq = !c.closed && i % 2 ? pts.slice().reverse() : pts;
      if (i === 0) P.plungeAt(seq[0][0], seq[0][1], z, t.plunge);
      else P.feed(seq[0][0], seq[0][1], z, t.plunge);
      for (const q of seq.slice(1)) P.feed(q[0], q[1], z, t.feed);
    });
    P.retract();
  }
}

// Helical thread milling (single-profile cutter), climbing from the bottom.
function genThread(op, t, P, h, project) {
  const holes = orderHoles(circlesOf(op, project), c => c.p, op.holeOrder || 'shortest').items;
  const pitch = +op.pitch || 1.5;
  const external = op.side === 'outside';
  const rightHand = op.hand !== 'left';
  for (const { p: [cx, cy], r } of holes) {
    const D = +op.majorDia || 2 * r;
    const R = external ? D / 2 + t.dia / 2 : D / 2 - t.dia / 2;
    if (R <= 0.05) throw new Error(`Gewinde Ø${D} ist zu klein für Werkzeug Ø${t.dia}`);
    const N = 72;
    // right-hand internal thread, climb milling: counter-clockwise while rising
    const dir = (rightHand ? 1 : -1) * (external ? -1 : 1);
    const zTop = cycleTop(h);
    if (external) P.moveAbove(cx + R + t.dia, cy); else P.moveAbove(cx, cy);
    P.feed(P.p.x, P.p.y, h.bottom, t.plunge);
    P.feed(cx + R, cy, h.bottom, t.feed / 2);
    let a = 0, z = h.bottom;
    while (z < zTop - 1e-6) {
      for (let k = 1; k <= N && z < zTop + pitch; k++) {
        a += (dir * 2 * Math.PI) / N;
        z = Math.min(zTop + pitch * 0.25, z + pitch / N);
        P.feed(cx + R * Math.cos(a), cy + R * Math.sin(a), z, t.feed);
      }
    }
    if (external) P.feed(cx + R + t.dia, cy, z, t.feed); else P.feed(cx, cy, z, t.feed);
    P.retract();
  }
}

function genBore(op, t, P, h, project) {
  const holes = orderHoles(circlesOf(op, project), c => c.p, op.holeOrder || 'shortest').items;
  const pitch = +op.stepdown || t.stepdown;
  const conv = op.direction === 'conventional';
  for (const { p: [cx, cy], r } of holes) {
    const R = r - t.dia / 2 - (+op.stockToLeave || 0);
    if (R <= 0.05) throw new Error(`Bohrung Ø${+(2 * r).toFixed(2)} ist zu klein für Werkzeug Ø${t.dia}`);
    const N = 72;
    const pt = (a, z) => [cx + R * Math.cos(a), cy + R * Math.sin(a), z];
    const dir = conv ? -1 : 1; // CCW inside a hole = climb
    P.moveAbove(cx + R, cy);
    let z = h.top + 0.5;
    P.rapid(cx + R, cy, z);
    let a = 0;
    while (z > h.bottom + 1e-6) {
      for (let k = 1; k <= N; k++) {
        a += (dir * 2 * Math.PI) / N;
        z = Math.max(h.bottom, z - pitch / N);
        const [x, y] = pt(a, z);
        P.feed(x, y, z, t.feed);
      }
    }
    for (let k = 1; k <= N; k++) { a += (dir * 2 * Math.PI) / N; const [x, y] = pt(a, h.bottom); P.feed(x, y, h.bottom, t.feed); }
    P.feed(cx, cy, h.bottom, t.feed);
    P.rapid(cx, cy, P.clear);
  }
}

// ---------- 3D strategies ----------
function heightGrid(ctx, stock, tool, stl, floor) {
  const hm = ctx.heightmap();
  const T = new Float32Array(hm.nx * hm.ny);
  const tl = { ...tool };
  for (let j = 0; j < hm.ny; j++) for (let i = 0; i < hm.nx; i++) T[j * hm.nx + i] = dropCutter(hm, hm.minX + i * hm.res, hm.minY + j * hm.res, growStl(tl, stl), -Infinity) + stl;
  const out = T.map(v => Math.max(v, floor));
  // exact value anywhere (blockedAt uses it to place level contours between the grid points)
  out.exact = (x, y) => Math.max(dropCutter(hm, x, y, growStl(tl, stl), -Infinity) + stl, floor);
  out.reach = tl.dia / 2 + Math.max(0, stl); // beyond this distance from the grid the tool is always free
  return { hm, T: out };
}

// Where the tool centre cannot go down to z (part + stock to leave), as Clipper paths.
// Union of the grid cells matching pred(k), as Clipper paths.
function rasterPolys(hm, pred) {
  const half = hm.res / 2;
  const rects = [];
  for (let j = 0; j < hm.ny; j++) {
    let i = 0;
    while (i < hm.nx) {
      if (pred(j * hm.nx + i)) {
        const i0 = i;
        while (i < hm.nx && pred(j * hm.nx + i)) i++;
        const x0 = hm.minX + i0 * hm.res - half, x1 = hm.minX + (i - 1) * hm.res + half;
        const y = hm.minY + j * hm.res;
        rects.push(toC([[x0, y - half], [x1, y - half], [x1, y + half], [x0, y + half]]));
      } else i++;
    }
  }
  return rects.length ? clip(rects, null, 'ctUnion') : [];
}

// Where the tool centre cannot go down to z, as Clipper paths. With T.exact (from heightGrid) the outline is
// traced between the grid points (marching squares) and every crossing is bisected on the exact tool height,
// keeping the found point on the free side: the outline is then exact to res/64 and never too small. Without it,
// the union of the blocked grid cells (staircase, up to half a cell off). The result carries .exact.
function blockedAt(hm, T, z) {
  if (!T.exact) return rasterPolys(hm, k => T[k] > z + 1e-6);
  const { nx, ny, res, minX, minY } = hm;
  // the tool reaches the part from up to `reach` outside the grid: pad by that (evaluated exactly) plus a ring of
  // free points that closes every loop. Padded index (i + K, j + K).
  const K = Math.ceil((T.reach || 0) / res) + 1, W = nx + 2 * K;
  const B = new Uint8Array(W * (ny + 2 * K));
  let any = false;
  for (let j = 1 - K; j < ny + K - 1; j++) for (let i = 1 - K; i < nx + K - 1; i++) {
    const inGrid = i >= 0 && j >= 0 && i < nx && j < ny;
    const v = inGrid ? T[j * nx + i] : T.exact(minX + i * res, minY + j * res);
    if (v > z + 1e-6) { B[(j + K) * W + i + K] = 1; any = true; }
  }
  if (!any) return [];
  const bl = (i, j) => B[(j + K) * W + i + K] === 1; // i in −K..nx+K−1
  const X = i => minX + i * res, Y = j => minY + j * res;
  const cache = new Map();
  // crossing on the grid edge from blocked point (ib, jb) to free point (if_, jf)
  const cross = (ib, jb, if_, jf) => {
    const key = (Math.min(jb, jf) + K) * W * 2 + (Math.min(ib, if_) + K) * 2 + (jb === jf ? 0 : 1);
    let p = cache.get(key);
    if (!p) {
      const xb = X(ib), yb = Y(jb), xf = X(if_), yf = Y(jf);
      let a = 0, b = 1; // a: blocked side, b: free side
      for (let it = 0; it < 6; it++) { const m = (a + b) / 2; if (T.exact(xb + (xf - xb) * m, yb + (yf - yb) * m) > z + 1e-6) a = m; else b = m; }
      p = { key, x: xb + (xf - xb) * b, y: yb + (yf - yb) * b };
      cache.set(key, p);
    }
    return p;
  };
  // directed segments with the blocked side on the left: in each cell, walk its edges counter-clockwise and join
  // every blocked→free crossing to the next free→blocked crossing
  const next = new Map();
  const C = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let j = -K; j < ny + K - 1; j++) for (let i = -K; i < nx + K - 1; i++) {
    const v = C.map(([di, dj]) => bl(i + di, j + dj));
    if (v[0] === v[1] && v[1] === v[2] && v[2] === v[3]) continue;
    const outs = [], ins = [];
    for (let e = 0; e < 4; e++) {
      const a = C[e], b = C[(e + 1) % 4];
      if (v[e] && !v[(e + 1) % 4]) outs.push([e, cross(i + a[0], j + a[1], i + b[0], j + b[1])]);
      else if (!v[e] && v[(e + 1) % 4]) ins.push([e, cross(i + b[0], j + b[1], i + a[0], j + a[1])]);
    }
    for (const [e, p] of outs) {
      // the next free→blocked crossing after edge e, counter-clockwise
      let best = null, bd = 9;
      for (const [f, q] of ins) { const d = (f - e + 4) % 4; if (d > 0 && d < bd) { bd = d; best = q; } }
      if (best) next.set(p.key, best);
    }
  }
  const loops = [], seen = new Set();
  for (const [k0] of next) {
    if (seen.has(k0)) continue;
    const loop = [];
    let k = k0, guard = 0;
    while (!seen.has(k) && guard++ < 1e7) {
      seen.add(k);
      const q = next.get(k);
      if (!q) break;
      loop.push([q.x, q.y]);
      k = q.key;
    }
    if (loop.length > 2) loops.push(toC(loop));
  }
  // loops around blocked areas run counter-clockwise, holes clockwise: NonZero union keeps exactly the blocked area
  const out = loops.length ? CL().Clipper.SimplifyPolygons(loops, CL().PolyFillType.pftNonZero) : [];
  out.exact = true;
  return out;
}

// Raster outlines: smooth the staircase. Exact outlines: only drop points closer than 0.005 mm.
function smoothBlocked(blocked, hm) {
  if (blocked.exact) return CL().Clipper.CleanPolygons(blocked, 0.005 * S);
  blocked = offsetPaths(offsetPaths(blocked, hm.res * 0.6), -hm.res * 0.6);
  return CL().Clipper.CleanPolygons(blocked, hm.res * 0.3 * S);
}

// ---------- 3D finishing helpers ----------
// common CAD/CAM "Bearbeitungsbegrenzung": none, virtual box around the part, silhouette or a selection,
// with the tool inside / centred on / outside the boundary plus an extra offset. Clipper paths or null.
export const BOUNDARY_MODES = { none: 'Kein(e/s)', box: 'Virtueller Rahmen', silhouette: 'Silhouette', selection: 'Auswahl' };
function boundaryPaths(op, t, stock, hm) {
  const mode = op.boundary === 'stock' || !op.boundary ? 'none' : op.boundary;
  let paths = null;
  if (mode === 'box' && stock.mMinX != null) paths = [toC([[stock.mMinX, stock.mMinY], [stock.mMaxX, stock.mMinY], [stock.mMaxX, stock.mMaxY], [stock.mMinX, stock.mMaxY]])];
  else if (mode === 'silhouette') {
    const sil = rasterPolys(hm, k => hm.h[k] > -Infinity);
    paths = sil.length ? CL().Clipper.CleanPolygons(offsetPaths(offsetPaths(sil, hm.res * 0.6), -hm.res * 0.6), hm.res * 0.3 * S) : null;
  } else if (mode === 'selection' && op.boundarySketch && CUR?.project) {
    try {
      const g = opGeometry({ ...op, sketch: op.boundarySketch, entities: op.boundaryEntities || 'all' }, CUR.project);
      paths = unionEvenOdd(g.regions.flatMap(r => [r.outer, ...r.holes]).map(toC));
    } catch { paths = null; }
  }
  if (!paths || !paths.length) return null;
  const inc = op.toolContain || (mode === 'silhouette' ? 'outside' : 'center');
  const off = (inc === 'inside' ? -t.dia / 2 : inc === 'outside' ? t.dia / 2 : 0) + (+op.boundaryOffset || 0);
  return off ? offsetPaths(paths, off) : paths;
}
const insidePaths = paths => (x, y) => {
  const L = CL(), pt = { X: Math.round(x * S), Y: Math.round(y * S) };
  let c = 0;
  for (const q of paths) if (L.Clipper.PointInPolygon(pt, q) !== 0) c++;
  return c % 2 === 1;
};
// Where the tool centre may go: the stock box, or the machining boundary.
function boundaryFn(op, t, stock, hm) {
  const bp = boundaryPaths(op, t, stock, hm);
  if (bp) return insidePaths(bp);
  if (op.boundary !== 'silhouette') return (x, y) => x >= stock.minX && x <= stock.maxX && y >= stock.minY && y <= stock.maxY;
  const mask = new Uint8Array(hm.nx * hm.ny);
  const rc = Math.ceil((t.dia / 2) / hm.res);
  for (let j = 0; j < hm.ny; j++) for (let i = 0; i < hm.nx; i++) {
    if (hm.h[j * hm.nx + i] === -Infinity) continue;
    for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
      if (di * di + dj * dj > rc * rc) continue;
      const ii = i + di, jj = j + dj;
      if (ii >= 0 && jj >= 0 && ii < hm.nx && jj < hm.ny) mask[jj * hm.nx + ii] = 1;
    }
  }
  return (x, y) => {
    const i = Math.round((x - hm.minX) / hm.res), j = Math.round((y - hm.minY) / hm.res);
    return i >= 0 && j >= 0 && i < hm.nx && j < hm.ny && mask[j * hm.nx + i] === 1;
  };
}

// Drops 2D sample points onto the surface and splits them into runs inside the boundary.
// Where the surface rises steeply between two samples (wall edge) the straight move would cut the edge:
// push the midpoints that lie above the line onto out (bisection, a few levels). drop(x, y) = tip height.
// A jump (the tool leaving a wall's reach drops by the wall height at once) can sit anywhere in the interval, so a
// midpoint below the line proves nothing there: steep intervals are always split until the jump is pinned down.
function refineStep(a, b, drop, out, depth = 0) {
  const len = Math.hypot(b[0] - a[0], b[1] - a[1]), dz = Math.abs(b[2] - a[2]);
  if (depth > 6 || dz <= 0.01 || len < 0.005) return;
  const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2, mz = drop(mx, my);
  if (mz <= (a[2] + b[2]) / 2 + 0.002 && !(dz > 0.05 && dz > 3 * len)) return;
  const m = [mx, my, mz];
  refineStep(a, m, drop, out, depth + 1); out.push(m); refineStep(m, b, drop, out, depth + 1);
}

function dropRuns(pts2, hm, t, stl, floor, inside) {
  const runs = [];
  let cur = null;
  const drop = (x, y) => dropCutter(hm, x, y, growStl(t, stl), floor - stl) + stl;
  for (const [x, y] of pts2) {
    if (!inside(x, y)) { if (cur && cur.length > 1) runs.push(cur); cur = null; continue; }
    const p = [x, y, drop(x, y)];
    if (cur) refineStep(cur[cur.length - 1], p, drop, cur);
    (cur ||= []).push(p);
  }
  if (cur && cur.length > 1) runs.push(cur);
  return runs.map(r => simplify3d(r));
}

// Drops points that lie within tol of the straight move replacing them (Douglas-Peucker: every dropped
// point is checked against the final segment, so slow curves cannot drift into one long chord).
function simplify3d(pts, tol = 0.002) {
  const n = pts.length;
  if (n < 3) return pts;
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  while (stack.length) {
    const [a, c] = stack.pop();
    if (c - a < 2) continue;
    const A = pts[a], C = pts[c];
    const ac0 = C[0] - A[0], ac1 = C[1] - A[1], ac2 = C[2] - A[2];
    const L2 = ac0 * ac0 + ac1 * ac1 + ac2 * ac2;
    let worst = -1, wi = -1;
    for (let k = a + 1; k < c; k++) {
      const p = pts[k], ap0 = p[0] - A[0], ap1 = p[1] - A[1], ap2 = p[2] - A[2];
      const u = L2 > 1e-18 ? Math.max(0, Math.min(1, (ap0 * ac0 + ap1 * ac1 + ap2 * ac2) / L2)) : 0;
      const d = Math.hypot(ap0 - u * ac0, ap1 - u * ac1, ap2 - u * ac2);
      if (d > worst) { worst = d; wi = k; }
    }
    if (worst > tol) { keep[wi] = 1; stack.push([a, wi], [wi, c]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// Emits 3D runs; short hops between runs stay down at a height that clears the surface.
function emitRuns(P, runs, t, hm, stl, floor, hop) {
  for (const run of runs) {
    const [x0, y0, z0] = run[0];
    if (P.p && P.p.z < P.clear - 1e-6 && Math.hypot(P.p.x - x0, P.p.y - y0) <= hop) {
      let zl = Math.max(P.p.z, z0);
      for (let k = 1; k < 8; k++) zl = Math.max(zl, dropCutter(hm, P.p.x + ((x0 - P.p.x) * k) / 8, P.p.y + ((y0 - P.p.y) * k) / 8, growStl(t, stl), floor) + stl);
      if (zl > P.p.z + 1e-6) P.feed(P.p.x, P.p.y, zl, t.feed);
      P.feed(x0, y0, zl, t.feed);
      if (z0 < zl - 1e-6) P.feed(x0, y0, z0, t.plunge);
    } else P.plungeAt(x0, y0, z0, t.plunge);
    for (const [x, y, z] of run.slice(1)) P.feed(x, y, z, t.feed);
  }
  P.retract();
}

const sampleStep = hm => Math.min(hm.res, 0.4);

function genSpiral3d(op, t, P, h, stock, ctx) {
  const hm = ctx.heightmap();
  const so = +op.stepoverMm || t.dia * 0.1, stl = +op.stockToLeave || 0, step = sampleStep(hm);
  const cx = op.cx != null && op.cx !== '' ? +op.cx : (stock.minX + stock.maxX) / 2;
  const cy = op.cy != null && op.cy !== '' ? +op.cy : (stock.minY + stock.maxY) / 2;
  const maxR = Math.max(...[[stock.minX, stock.minY], [stock.maxX, stock.minY], [stock.minX, stock.maxY], [stock.maxX, stock.maxY]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const pts = [];
  for (let th = 0, r = 0; r <= maxR; ) {
    pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
    th += step / Math.max(r, step);
    r = (so * th) / (2 * Math.PI);
  }
  emitRuns(P, dropRuns(pts, hm, t, stl, h.bottom, boundaryFn(op, t, stock, hm)), t, hm, stl, h.bottom, so * 2);
}

function genRadial3d(op, t, P, h, stock, ctx) {
  const hm = ctx.heightmap();
  const so = +op.stepoverMm || t.dia * 0.1, stl = +op.stockToLeave || 0, step = sampleStep(hm);
  const cx = op.cx != null && op.cx !== '' ? +op.cx : (stock.minX + stock.maxX) / 2;
  const cy = op.cy != null && op.cy !== '' ? +op.cy : (stock.minY + stock.maxY) / 2;
  const maxR = Math.max(...[[stock.minX, stock.minY], [stock.maxX, stock.minY], [stock.minX, stock.maxY], [stock.maxX, stock.maxY]].map(([x, y]) => Math.hypot(x - cx, y - cy)));
  const r0 = +op.innerR || so;
  const n = Math.max(8, Math.ceil((2 * Math.PI * maxR) / so));
  const inside = boundaryFn(op, t, stock, hm);
  // towards the centre the rays crowd together: ray k only starts where it is needed to keep the gap between
  // neighbouring rays at most the stepover (ray k belongs to every 2^v-th ray, v = trailing zero bits of k;
  // those alone are dense enough inside so / (2^(v+1) · Δ)). Neighbours meeting at the inner end start at the
  // same radius, so the link between them stays short.
  const dA = (2 * Math.PI) / n;
  const val = k => { if (k === 0) return 60; let v = 0; while (!(k & 1)) { k >>= 1; v++; } return v; };
  const rs = Array.from({ length: n }, (_, k) => Math.max(r0, Math.min(maxR, so / (dA * 2 ** (val(k) + 1)))));
  const start = rs.slice();
  for (let k = 1; k < n; k += 2) { const m = Math.min(rs[k], k + 1 < n ? rs[k + 1] : rs[k]); start[k] = m; if (k + 1 < n) start[k + 1] = m; }
  const runs = [];
  for (let k = 0; k < n; k++) {
    const a = (2 * Math.PI * k) / n;
    const pts = [];
    for (let r = start[k]; r <= maxR; r += step) pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
    if (k % 2) pts.reverse(); // zig-zag: out, in, out ...
    runs.push(...dropRuns(pts, hm, t, stl, h.bottom, inside));
  }
  emitRuns(P, runs, t, hm, stl, h.bottom, (2 * Math.PI * r0) / n * 4 + so);
}

function genScallop3d(op, t, P, h, stock, ctx) {
  const hm = ctx.heightmap();
  const so = +op.stepoverMm || t.dia * 0.1, stl = +op.stockToLeave || 0, step = sampleStep(hm);
  const bnd = boundaryPaths(op, t, stock, hm);
  let region = bnd || op.boundary === 'silhouette'
    ? offsetPaths(rasterPolys(hm, k => hm.h[k] > -Infinity), t.dia / 2)
    : [toC([[stock.minX, stock.minY], [stock.maxX, stock.minY], [stock.maxX, stock.maxY], [stock.minX, stock.maxY]])];
  if (bnd) region = bnd;
  if (!region.length) throw new Error('Keine Fläche zum Schlichten');
  const runs = [];
  for (let guard = 0; region.length && guard < 2000; guard++) {
    for (const path of region.map(fromC)) {
      const pts = [];
      for (let i = 0; i <= path.length; i++) {
        const a = path[i % path.length], b = path[(i + 1) % path.length];
        const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
        const n = Math.max(1, Math.ceil(L / step));
        for (let k = 0; k < n && i < path.length; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
      }
      pts.push(pts[0]);
      runs.push(...dropRuns(pts, hm, t, stl, h.bottom, () => true));
    }
    region = offsetPaths(region, -so);
  }
  emitRuns(P, runs, t, hm, stl, h.bottom, so * 1.5);
}

// Flat areas only: every distinct flat Z level is cleared at exactly that height.
function genHorizontal3d(op, t, P, h, stock, ctx) {
  const stl = +op.stockToLeave || 0;
  const { hm, T } = heightGrid(ctx, stock, t, stl, -Infinity);
  const so = t.dia * (+op.stepover || t.stepover);
  const counts = new Map();
  for (let j = 1; j < hm.ny - 1; j++) for (let i = 1; i < hm.nx - 1; i++) {
    const k = j * hm.nx + i, z = T[k];
    if (!(z > -Infinity) || z < h.bottom - 1e-6 || z > stock.top - 1e-6) continue;
    if ([k - 1, k + 1, k - hm.nx, k + hm.nx].every(q => Math.abs(T[q] - z) < 0.005)) {
      const key = Math.round(z * 100);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  const lv = [...counts].filter(([, c]) => c >= 12).map(([k]) => k / 100).sort((a, b) => b - a);
  if (!lv.length) throw new Error('Keine waagerechten Flächen gefunden');
  const bndH = boundaryPaths(op, t, stock, hm);
  for (const z of lv) {
    let region = rasterPolys(hm, k => Math.abs(T[k] - z) < 0.011);
    region = CL().Clipper.CleanPolygons(offsetPaths(offsetPaths(region, hm.res * 0.6), -hm.res * 0.6), hm.res * 0.3 * S);
    // the raster outline (and its smoothing) can reach a little into rising surfaces: cut away exactly where
    // the tool cannot go down to this height
    const blk = blockedAt(hm, T, z + 0.005);
    if (blk.length) region = clip(region, blk, 'ctDifference');
    if (bndH) region = clip(region, bndH, 'ctIntersection');
    let cur = region;
    for (let guard = 0; cur.length && guard < 2000; guard++) {
      for (let loop of nearestOrder(cur.map(fromC).filter(l => l.length > 2), l => l[0])) {
        if (op.direction === 'conventional') loop = loop.slice().reverse();
        if (P.p) loop = rotateNearest(loop, P.p);
        const [sx, sy] = loop[0];
        const near = P.p && Math.abs(P.p.z - z) < 1e-6 && Math.hypot(P.p.x - sx, P.p.y - sy) <= so * 1.05;
        if (near) P.feed(sx, sy, z, t.feed); else P.plungeAt(sx, sy, z, t.plunge);
        P.loopPass(loop, z, t.feed);
      }
      cur = offsetPaths(cur, -so);
    }
    P.retract();
  }
}

// Steep walls with waterlines, shallow areas with parallel passes (split by slope angle).
function genSteep3d(op, t, P, h, stock, ctx) {
  genContour3d({ ...op, stepdown: +op.stepdown || 0.5 }, t, P, h, stock, ctx);
  const hm = ctx.heightmap();
  const so = +op.stepoverMm || t.dia * 0.1, stl = +op.stockToLeave || 0, step = sampleStep(hm);
  const lim = Math.tan(((+op.slope || 45) * Math.PI) / 180);
  const slopeAt = (x, y) => {
    const i = Math.round((x - hm.minX) / hm.res), j = Math.round((y - hm.minY) / hm.res);
    if (i < 1 || j < 1 || i >= hm.nx - 1 || j >= hm.ny - 1) return 0;
    const H = (a, b) => hm.h[b * hm.nx + a];
    const gx = (H(i + 1, j) - H(i - 1, j)) / (2 * hm.res), gy = (H(i, j + 1) - H(i, j - 1)) / (2 * hm.res);
    return Number.isFinite(gx) && Number.isFinite(gy) ? Math.hypot(gx, gy) : Infinity;
  };
  const base = boundaryFn(op, t, stock, hm);
  const shallow = (x, y) => base(x, y) && slopeAt(x, y) <= lim;
  const runs = [];
  let rev = false;
  for (let y = stock.minY; y <= stock.maxY + 1e-6; y += so) {
    const pts = [];
    for (let x = stock.minX; x <= stock.maxX; x += step) pts.push([x, y]);
    if (rev) pts.reverse();
    rev = !rev;
    runs.push(...dropRuns(pts, hm, t, stl, h.bottom, shallow));
  }
  emitRuns(P, runs, t, hm, stl, h.bottom, so * 1.5);
}

// Sketch curves projected onto the 3D surface (engraving on curved parts).
function genProject3d(op, t, P, h, stock, ctx, project) {
  const hm = ctx.heightmap();
  const sk = project.features.find(f => f.id === op.sketch && f.type === 'sketch');
  if (!sk) throw new Error('Keine Skizze als Geometrie gewählt');
  const X = sketchXY(sk);
  const depth = +op.depth || 0.3, step = sampleStep(hm);
  const curves = sk.entities.filter(e => !Array.isArray(op.entities) || op.entities.includes(e.id)).flatMap(e => entityOutlines(e)).filter(o => o.pts.length >= 2);
  if (!curves.length) throw new Error('Keine Kurven ausgewählt');
  const runs = [];
  for (const c of curves) {
    const pts = c.pts.map(X.tr);
    if (c.closed) pts.push(pts[0]);
    const dense = [];
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
      for (let k = 0; k < n; k++) dense.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
    }
    dense.push(pts[pts.length - 1]);
    runs.push(...dropRuns(dense, hm, t, -depth, -Infinity, () => true));
  }
  emitRuns(P, runs, t, hm, -depth, -Infinity, 0);
}

// ---------- additional 2D strategies ----------
function genSlot(op, t, P, h, project) {
  const sk = project.features.find(f => f.id === op.sketch && f.type === 'sketch');
  if (!sk) throw new Error('Keine Skizze als Geometrie gewählt');
  const X = sketchXY(sk);
  const ents = sk.entities.filter(e => (!Array.isArray(op.entities) || op.entities.includes(e.id)) && (e.type === 'slot' || (e.type === 'poly' && !e.closed)));
  if (!ents.length) throw new Error('Keine Langlöcher oder offenen Linien in der Auswahl');
  const lv = levels(h.top, h.bottom, +op.stepdown || t.stepdown);
  if (!lv.length) throw new Error('Unterkante liegt über der Oberkante');
  const troch = op.slotStyle === 'trochoid';
  const stl = +op.stockToLeave || 0;
  let nTroch = 0;
  for (const e of ents) {
    let line;
    if (e.type === 'slot') {
      if (+e.w < t.dia - 1e-6) throw new Error(`Langloch ${+e.w} mm ist schmaler als der Fräser Ø${t.dia}`);
      const a = ((+e.rot || 0) * Math.PI) / 180, dx = (Math.cos(a) * e.len) / 2, dy = (Math.sin(a) * e.len) / 2;
      line = [X.tr([+e.cx - dx, +e.cy - dy]), X.tr([+e.cx + dx, +e.cy + dy])];
    } else line = e.pts.map(X.tr);
    // trochoidal: circles whose centre walks along the centre line – the cutter is never engaged over its full width
    const width = e.type === 'slot' ? +e.w : +op.slotWidth || 0;
    const rr = width / 2 - t.dia / 2 - stl;
    if (troch) {
      if (!(width > 0)) throw new Error('Für wirbelndes Fräsen entlang einer Linie die Nutbreite angeben');
      if (rr < 0.05) throw new Error(`Wirbelfräsen: Nut ${f2s(width)} mm ist zu schmal für Fräser Ø${t.dia}${stl ? ' mit Aufmaß' : ''} – kleineren Fräser wählen (etwa 60 % der Nutbreite)`);
      trochoidPass(P, line, rr, Math.max(0.02, +op.trochoidStep || t.dia * 0.1), lv, t, op.direction !== 'conventional', +op.ramp > 0 ? +op.ramp : 2, h.top);
      nTroch++;
      if (e.type === 'slot' && stl <= 0 && op.slotFinish !== false) {
        const poly = ensureCCW(entityPolys(e)[0].map(X.tr));
        for (const loop of offsetPaths([toC(poly)], -(t.dia / 2)).map(fromC)) {
          const l = rotateNearest(op.direction !== 'conventional' ? loop : loop.slice().reverse(), P.p);
          P.feed(l[0][0], l[0][1], h.bottom, t.feed);
          P.loopPass(l, h.bottom, t.finishFeed ?? t.feed);
        }
      }
      P.retract();
      continue;
    }
    // back and forth along the centre line, one level per pass
    lv.forEach((z, i) => {
      const seq = i % 2 ? line.slice().reverse() : line;
      if (i === 0) P.plungeAt(seq[0][0], seq[0][1], z, t.plunge); else P.feed(seq[0][0], seq[0][1], z, t.plunge);
      for (const q of seq.slice(1)) P.feed(q[0], q[1], z, t.feed);
    });
    // wider slot: finish the walls with one loop on size at the bottom
    if (e.type === 'slot' && +e.w > t.dia + 0.01) {
      const poly = ensureCCW(entityPolys(e)[0].map(X.tr));
      for (const loop of offsetPaths([toC(poly)], -(t.dia / 2 + (+op.stockToLeave || 0))).map(fromC)) {
        const l = rotateNearest(loop, P.p);
        P.feed(l[0][0], l[0][1], h.bottom, t.feed);
        P.loopPass(l, h.bottom, t.feed);
      }
    }
    P.retract();
  }
}

const f2s = v => String(+(+v).toFixed(3));
// Circles of radius rr along a centre line, one level after the other. The loop starts at the back (towards the
// part already cut), so the way from one circle to the next runs through air and only the front half cuts.
function trochoidPass(P, line, rr, step, lv, t, climb, rampDeg, top) {
  const segs = [];
  let L = 0;
  for (let i = 1; i < line.length; i++) {
    const a = line[i - 1], b = line[i], l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > 1e-9) { segs.push({ a, d: [(b[0] - a[0]) / l, (b[1] - a[1]) / l], s0: L, l }); L += l; }
  }
  if (!segs.length) throw new Error('Mittellinie der Nut hat keine Länge');
  // circle points close enough together that the post processor recognises the arcs (chord error 0.002 mm)
  const n = Math.max(1, Math.ceil(L / step)), N = Math.max(36, Math.min(360, Math.ceil(Math.PI / Math.acos(Math.max(0, 1 - 0.002 / rr)))));
  const at = s => { const g = segs.find(q => s <= q.s0 + q.l + 1e-9) || segs[segs.length - 1]; const u = Math.min(g.l, Math.max(0, s - g.s0)); return { c: [g.a[0] + g.d[0] * u, g.a[1] + g.d[1] * u], d: g.d }; };
  const circle = k => {
    const { c, d } = at((L * k) / n), a0 = Math.atan2(-d[1], -d[0]), sg = climb ? 1 : -1;
    return Array.from({ length: N }, (_, i) => { const a = a0 + (sg * 2 * Math.PI * i) / N; return [c[0] + rr * Math.cos(a), c[1] + rr * Math.sin(a)]; });
  };
  let zPrev = top;
  for (const z of lv) {
    for (let k = 0; k <= n; k++) {
      const loop = circle(k);
      if (k === 0) { if (P.p && P.p.z < P.link - 1e-6) P.retract(); P.enterLoop(loop, zPrev, z, t, rampDeg); }
      else P.feed(loop[0][0], loop[0][1], z, t.transitionFeed ?? t.feed);
      P.loopPass(loop, z, t.feed);
    }
    zPrev = z;
  }
}

// Tauchschruppen: the cutter goes straight down like a drill, row by row. The force runs along the spindle,
// which suits long tools, deep cavities and weak machines. Each plunge ends on the model plus the allowance.
function genPlunge3d(op, t, P, h, stock, ctx) {
  if (toolBase(t) !== 'flat') throw new Error('Tauchschruppen braucht ein Werkzeug mit flacher Stirn (Schaft-, Plan- oder Tauchfräser)');
  const hm = ctx.heightmap(), stl = opStl(op);
  const along = Math.max(0.05, +op.stepoverMm || t.dia * 0.5), across = Math.max(0.05, +op.rowStep || t.dia * 0.7);
  const inside = boundaryFn(op, t, stock, hm);
  const pull = Math.max(0, +(op.pullBack ?? 0.3)), minCut = Math.max(0.05, +(op.minPlunge ?? 0.3)), safe = Math.max(0.2, +(op.safeDist ?? 1));
  const zTravel = Math.min(P.link, stock.top + safe);
  // what earlier operations of the setup have cut away is gone: no plunges into air
  let field = null;
  const prior = op.usePrior === false ? [] : (ctx.prior || []).filter(r => r && !r.error && !r.disabled && r.moves?.length && r.tool && !r.rotary);
  if (prior.length) {
    field = new StockField(stock, null);
    for (const r of prior) for (let w = 1; w < r.moves.length; w++) if (r.moves[w].t !== 'r' && Number.isFinite(r.moves[w - 1].x)) field.cutMove(r.moves[w - 1], r.moves[w], r.tool);
  }
  let n = 0, skipped = 0;
  for (const row of zigzag(stock, +op.angle || 0, across, along)) {
    let prev = null;
    for (const [x, y] of row) {
      if (!inside(x, y)) { prev = null; continue; }
      const zs0 = Math.min(h.top, stockTopAt(stock, x, y));
      const zs = field ? Math.min(zs0, field.maxAlong(x, y, x, y, t.dia / 2)) : zs0;
      const zt = Math.max(h.bottom, dropCutter(hm, x, y, growStl(t, stl), h.bottom - stl) + stl);
      if (!(zs - zt >= minCut)) { if (zs0 - zt >= minCut) skipped++; prev = null; continue; }
      if (!P.p) P.moveAbove(x, y);
      else { if (P.p.z < zTravel - 1e-6) P.up(P.p.x, P.p.y, zTravel); P.rapid(x, y, Math.max(zTravel, P.p.z)); }
      if (P.p.z > zs + safe + 1e-6) P.rapid(x, y, zs + safe);
      P.feed(x, y, zt, t.plunge);
      // leave the wall before going up: a short move back towards the row already cut, slightly upwards
      if (pull > 0 && prev) {
        const dx = prev[0] - x, dy = prev[1] - y, l = Math.hypot(dx, dy) || 1, q = Math.min(pull, l * 0.5);
        const qx = x + (dx / l) * q, qy = y + (dy / l) * q;
        // only where the model lets the cutter go there (a wall rising towards the last plunge: straight up instead)
        if (dropCutter(hm, qx, qy, growStl(t, stl), h.bottom - stl) + stl <= zt + q - 1e-6) P.feed(qx, qy, zt + q, t.feed);
      }
      prev = [x, y];
      n++;
    }
  }
  if (!n) throw new Error(skipped ? 'Kein Material zum Tauchen übrig – die vorigen Operationen haben hier schon alles abgetragen' : 'Kein Material zum Tauchen gefunden – Begrenzung, Höhen oder Rohteil prüfen');
  return { plunges: n, plungesSaved: skipped };
}

// Bahnmuster: the finished path of an operation again at other places (linear grid, around a centre, mirrored).
// Returns the 2D transforms [a, b, c, d, tx, ty] (x' = a·x + b·y + tx, y' = c·x + d·y + ty) of the copies.
export function patternTransforms(op, org = { x: 0, y: 0 }) {
  const kind = op.patKind;
  if (!kind || kind === 'none') return [];
  const out = [];
  if (kind === 'linear') {
    const n1 = Math.max(1, Math.round(+op.patN1 || 1)), n2 = Math.max(1, Math.round(+op.patN2 || 1));
    const dx1 = +op.patDx1 || 0, dy1 = +op.patDy1 || 0, dx2 = +op.patDx2 || 0, dy2 = +op.patDy2 || 0;
    for (let j = 0; j < n2; j++) for (let i = 0; i < n1; i++) if (i || j) out.push([1, 0, 0, 1, i * dx1 + j * dx2, i * dy1 + j * dy2]);
  } else if (kind === 'circular') {
    const n = Math.max(1, Math.round(+op.patN1 || 1)), total = +op.patAngle || 360;
    const cx = org.x + (+op.patCx || 0), cy = org.y + (+op.patCy || 0);
    const stepA = Math.abs(Math.abs(total) - 360) < 1e-9 ? total / n : total / Math.max(1, n - 1);
    for (let i = 1; i < n; i++) {
      const a = (stepA * i * Math.PI) / 180, c = Math.cos(a), s2 = Math.sin(a);
      out.push([c, -s2, s2, c, cx - c * cx + s2 * cy, cy - s2 * cx - c * cy]);
    }
  } else if (kind === 'mirror') {
    const cx = org.x + (+op.patCx || 0), cy = org.y + (+op.patCy || 0);
    if (op.patAxis === 'y') out.push([1, 0, 0, -1, 0, 2 * cy]); // across a line parallel to X
    else out.push([-1, 0, 0, 1, 2 * cx, 0]);
  }
  return out;
}
function applyPattern(res, op, org) {
  const xfs = patternTransforms(op, org);
  if (!xfs.length || !res.moves?.length) return;
  if (xfs.length > 2000) throw new Error('Bahnmuster: mehr als 2000 Kopien');
  const base = res.moves, all = op.patKeepFirst === false ? [] : base.slice();
  for (const [a, b, c, d, tx, ty] of xfs) {
    const flip = a * d - b * c < 0;
    for (const m of base) {
      const q = { ...m, x: a * m.x + b * m.y + tx, y: c * m.x + d * m.y + ty };
      if (flip && q.comp) q.comp = q.comp === 'L' ? 'R' : 'L';
      all.push(q);
    }
  }
  res.moves = all;
  // control cycles: drilling points are repeated, shape cycles (pocket, stud) fall back to the path
  if (res.cycle?.pts) res.cycle = { ...res.cycle, pts: [...(op.patKeepFirst === false ? [] : res.cycle.pts), ...xfs.flatMap(([a, b, c, d, tx, ty]) => res.cycle.pts.map(([x, y]) => [a * x + b * y + tx, c * x + d * y + ty]))] };
  if (res.pocketCycle) { delete res.pocketCycle; res.pocketCycleWhy = 'Bahnmuster: Ausgabe als Bahn'; }
  if (res.studCycle) delete res.studCycle;
  res.pattern = { n: xfs.length + (op.patKeepFirst === false ? 0 : 1), mirror: xfs.some(([a, b, c, d]) => a * d - b * c < 0) };
}

// Fewer tool changes: an operation moves up to the last earlier operation with the same tool, but never past an
// operation that works in the same place (their areas overlap) or past a fixed one (manual NC, probing).
// items: [{ id, tool, fixed, box: [x0, y0, x1, y1] | null, cells: Set | undefined }] in machining order; cells are
// the squares of a coarse grid the cutter passes over (see opCells) – finer than the box: a contour around the
// part does not "work at" the holes inside it.
// Returns { order: [id …], before, after } (numbers of tool changes).
export function orderByTool(items) {
  const list = items.slice();
  const overlap = (a, b) => {
    if (!a.box || !b.box) return true;
    if (a.box[2] < b.box[0] || b.box[2] < a.box[0] || a.box[3] < b.box[1] || b.box[3] < a.box[1]) return false;
    if (!a.cells || !b.cells) return true;
    const [small, big] = a.cells.size < b.cells.size ? [a.cells, b.cells] : [b.cells, a.cells];
    for (const k of small) if (big.has(k)) return true;
    return false;
  };
  const changes = l => { let n = 0, cur = null; for (const o of l) { if (!o.tool) continue; if (cur !== null && o.tool !== cur) n++; cur = o.tool; } return n; };
  const before = changes(list);
  for (let i = 1; i < list.length; i++) {
    const op = list[i];
    if (op.fixed || !op.tool || list[i - 1].tool === op.tool) continue;
    let j = -1;
    for (let k = i - 1; k >= 0; k--) {
      if (list[k].fixed) break;
      if (list[k].tool === op.tool) { j = k; break; }
      if (overlap(list[k], op)) break;
    }
    if (j < 0) continue;
    list.splice(i, 1);
    list.splice(j + 1, 0, op);
  }
  return { order: list.map(o => o.id), before, after: changes(list) };
}

// The squares (size mm) of a grid that the cutter of radius R touches on its feed moves.
export function opCells(moves, R, size = 2) {
  const cells = new Set(), n = Math.ceil(R / size);
  const mark = (x, y) => {
    const ci = Math.floor(x / size), cj = Math.floor(y / size);
    for (let j = -n; j <= n; j++) for (let i = -n; i <= n; i++) {
      // nearest point of the square to the cutter axis
      const qx = Math.max((ci + i) * size, Math.min(x, (ci + i + 1) * size)), qy = Math.max((cj + j) * size, Math.min(y, (cj + j + 1) * size));
      if (Math.hypot(qx - x, qy - y) <= R) cells.add((ci + i) * 100003 + (cj + j));
    }
  };
  for (let k = 1; k < moves.length; k++) {
    const a = moves[k - 1], b = moves[k];
    if (b.t === 'r' || !Number.isFinite(a.x) || !Number.isFinite(b.x)) continue;
    const L = Math.hypot(b.x - a.x, b.y - a.y), steps = Math.max(1, Math.ceil(L / size));
    for (let q = 0; q <= steps; q++) mark(a.x + ((b.x - a.x) * q) / steps, a.y + ((b.y - a.y) * q) / steps);
  }
  return cells;
}

// Vorschubanpassung: slower before and after sharp changes of direction, where the cutter wraps into the material.
export function cornerFeed(moves, angleDeg = 25, factor = 0.5, dist = 2) {
  const n = moves.length;
  if (n < 3 || !(factor > 0 && factor < 1) || !(dist > 0)) return { moves, corners: 0 };
  const plain = m => m.t === 'f' && !m.dwell && m.a == null && !m.lead && !m.polar && !m.live;
  const len = new Float64Array(n), dir = new Array(n).fill(null);
  for (let i = 1; i < n; i++) {
    const a = moves[i - 1], b = moves[i];
    if (!plain(b) || !Number.isFinite(a.x)) continue;
    const dx = b.x - a.x, dy = b.y - a.y, dz = b.z - a.z, l = Math.hypot(dx, dy, dz);
    len[i] = l;
    if (l > 1e-9 && Math.hypot(dx, dy) > 1e-6) dir[i] = [dx / l, dy / l, dz / l];
  }
  const sEnd = new Float64Array(n), sStart = new Float64Array(n), cosLim = Math.cos((angleDeg * Math.PI) / 180);
  let corners = 0;
  for (let i = 1; i < n - 1; i++) {
    const u = dir[i], v = dir[i + 1];
    if (!u || !v || u[0] * v[0] + u[1] * v[1] + u[2] * v[2] >= cosLim) continue;
    corners++;
    let rem = dist;
    for (let k = i; k >= 1 && rem > 1e-9 && dir[k]; k--) { sEnd[k] = Math.max(sEnd[k], Math.min(len[k], rem)); rem -= len[k]; }
    rem = dist;
    for (let k = i + 1; k < n && rem > 1e-9 && dir[k]; k++) { sStart[k] = Math.max(sStart[k], Math.min(len[k], rem)); rem -= len[k]; }
  }
  if (!corners) return { moves, corners: 0 };
  const out = [moves[0]];
  for (let i = 1; i < n; i++) {
    const m = moves[i], L = len[i], a = sStart[i], b = sEnd[i];
    if (!(a > 0 || b > 0)) { out.push(m); continue; }
    const slow = Math.max(1, Math.round(m.f * factor)), p = moves[i - 1];
    const at = u => ({ ...m, x: p.x + (m.x - p.x) * u, y: p.y + (m.y - p.y) * u, z: p.z + (m.z - p.z) * u });
    if (a + b >= L - 1e-6) { out.push({ ...m, f: slow, slow: true }); continue; }
    if (a > 0) out.push({ ...at(a / L), f: slow, slow: true });
    if (b > 0) { out.push(at(1 - b / L)); out.push({ ...m, f: slow, slow: true }); } else out.push(m);
  }
  return { moves: out, corners };
}

function genCircular(op, t, P, h, project) {
  const holes = orderHoles(circlesOf(op, project), c => c.p, op.holeOrder || 'shortest').items;
  const so = t.dia * (+op.stepover || t.stepover);
  const lv = levels(h.top, h.bottom, +op.stepdown || t.stepdown);
  if (!lv.length) throw new Error('Unterkante liegt über der Oberkante');
  const dir = op.direction === 'conventional' ? -1 : 1; // CCW inside a pocket = climb
  for (const { p: [cx, cy], r } of holes) {
    const R = r - t.dia / 2 - (+op.stockToLeave || 0);
    if (R <= 0) throw new Error(`Kreistasche Ø${+(2 * r).toFixed(2)} ist zu klein für Fräser Ø${t.dia}`);
    // entry: down a helix smaller than the cutter (no core is left, the centre of the cutter does not have to
    // cut); "Eintauchen" as plunge keeps the straight plunge at the centre
    const rampDeg = op.rampType === 'plunge' ? 0 : +op.ramp > 0 ? +op.ramp : 3;
    const rh = Math.min(R, 0.45 * t.dia), helix = rampDeg > 0 && rh >= 0.05;
    let a = 0;
    for (const [i, z] of lv.entries()) {
      const at = (rr, z2, f) => P.feed(cx + rr * Math.cos(a), cy + rr * Math.sin(a), z2, f);
      let r0 = 0;
      if (!helix) {
        if (i === 0) P.plungeAt(cx, cy, z, t.plunge); else { P.feed(cx, cy, P.p.z, t.feed); P.feed(cx, cy, z, t.plunge); }
        a = 0;
      } else {
        const sx = cx + rh * Math.cos(a), sy = cy + rh * Math.sin(a);
        if (i === 0) P.plungeAt(sx, sy, Math.min(h.top + 0.5, P.clear), t.plunge); else P.feed(sx, sy, P.p.z, t.feed);
        const zFrom = P.p.z, drop = zFrom - z;
        const turns = Math.min(200, Math.max(1, Math.ceil(drop / (2 * Math.PI * rh * Math.tan((rampDeg * Math.PI) / 180))))), steps = turns * 72;
        for (let k = 1; k <= steps; k++) { a += dir * (Math.PI / 36); at(rh, zFrom - (drop * k) / steps, t.helixFeed ?? t.feed); }
        // one turn on the level flattens what the helix left
        if (rh < R - 1e-6) for (let k = 1; k <= 72; k++) { a += dir * (Math.PI / 36); at(rh, z, t.feed); }
        r0 = rh;
      }
      // Archimedean spiral out to the wall, then one full circle on size
      const a0 = a;
      for (let rr = r0; rr < R; ) {
        a += dir * (Math.PI / 36);
        rr = Math.min(R, r0 + (so * Math.abs(a - a0)) / (2 * Math.PI));
        at(rr, z, t.feed);
      }
      for (let k = 1; k <= 72; k++) { a += dir * (Math.PI / 36); at(R, z, t.feed); }
    }
    P.feed(cx, cy, P.p.z, t.feed);
    P.retract();
  }
}

// V-carving: the deeper the V-cutter goes, the wider it cuts; rings further inside go deeper.
function genVcarve(op, t, P, h, project) {
  if (t.type !== 'chamfer') throw new Error('Für V-Gravur einen Fasenfräser (V) wählen');
  const g = opGeometry(op, project);
  const region = unionEvenOdd(g.regions.flatMap(r => [r.outer, ...r.holes]).map(toC));
  const half = ((t.angle || 90) / 2) * (Math.PI / 180), tipR = (t.tip || 0) / 2;
  const maxDepth = +op.maxDepth || 3;
  const step = +op.stepoverMm || 0.1;
  const zEdge = h.edge;
  let n = 0;
  // beyond max depth the cutter width is fixed: clear the rest like a pocket
  const capD = tipR + maxDepth * Math.tan(half), capStep = Math.max(step, capD * 0.8);
  for (let d = step / 2; ; d += d >= capD ? capStep : step) {
    const rings = offsetPaths(region, -d).map(fromC).filter(l => l.length > 2);
    if (!rings.length) break;
    const depth = Math.min(maxDepth, Math.max(0.02, (d - tipR) / Math.tan(half)));
    const z = zEdge - depth;
    for (let loop of nearestOrder(rings, l => l[0])) {
      if (P.p) loop = rotateNearest(loop, P.p);
      P.plungeAt(loop[0][0], loop[0][1], z, t.plunge);
      P.loopPass(loop, z, t.feed);
    }
    n++;
    if (n > 2000) break;
  }
  if (!n) throw new Error('Keine Fläche zum Gravieren');
  P.retract();
}

// Waterline finishing: one pass around the part at every Z level.
function genContour3d(op, t, P, h, stock, ctx) {
  const stl = +op.stockToLeave || 0;
  const { hm, T } = heightGrid(ctx, stock, t, stl, -Infinity);
  const lv = levels(h.top, h.bottom, +op.stepdown || 0.5);
  if (!lv.length) throw new Error('Keine Höhenstufen');
  const climb = op.direction !== 'conventional';
  const bndW = boundaryPaths(op, t, stock, hm);
  if (bndW) {
    const inside = insidePaths(bndW), runs = [], step = sampleStep(hm);
    for (const z of lv) for (const loop of waterLoops(hm, T, z, climb)) {
      let cur = null;
      for (const [x, y] of densify(loop, step, true)) { if (inside(x, y)) (cur ||= []).push([x, y, z]); else { if (cur?.length > 1) runs.push(cur); cur = null; } }
      if (cur?.length > 1) runs.push(cur);
    }
    if (!runs.length) throw new Error('Keine Wände innerhalb der Begrenzung');
    emitRuns(P, runs, t, hm, stl, h.bottom, t.dia);
    return;
  }
  let n = 0;
  for (const z of lv) {
    let blocked = blockedAt(hm, T, z);
    if (!blocked.length) continue;
    blocked = smoothBlocked(blocked, hm);
    for (let loop of nearestOrder(blocked.map(fromC).filter(l => l.length > 2), l => l[0])) {
      // around material (island) climb = clockwise; inner holes run the other way
      const isle = signedArea(loop) > 0;
      if ((signedArea(loop) < 0) !== (climb === isle)) loop = loop.slice().reverse();
      if (P.p) loop = rotateNearest(loop, P.p);
      P.plungeAt(loop[0][0], loop[0][1], z, t.plunge);
      P.loopPass(loop, z, t.feed);
      P.retract();
      n++;
    }
  }
  if (!n) throw new Error('Keine Wände gefunden – Unterkante prüfen');
}

// top of the material left by the operations before this one in the setup (tools stamped along their feed moves)
function restGrid(ctx, stock, hm, withPrior = true) {
  const { nx, ny, res } = hm, G = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) G[j * nx + i] = stockTopAt(stock, hm.minX + i * res, hm.minY + j * res);
  for (const r of withPrior ? ctx.prior || [] : []) {
    const tool = r.tool;
    if (!tool || !r.moves?.length || r.error) continue;
    const R = tool.dia / 2, half = ((tool.angle || 90) / 2) * (Math.PI / 180), tip = (tool.tip || 0) / 2;
    const prof = d => tool.profile ? (() => { const pr = tool.profile, f = (d / R) * (pr.length - 1), k = Math.min(pr.length - 2, Math.floor(f)), w = f - k; return pr[k][1] * (1 - w) + pr[k + 1][1] * w; })()
      : tool.type === 'ball' ? R - Math.sqrt(Math.max(0, R * R - d * d)) : tool.type === 'chamfer' || tool.type === 'drill' ? Math.max(0, d - tip) / Math.tan(half) : 0;
    const rc = Math.ceil(R / res), offs = [];
    for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) { const d = Math.hypot(di * res, dj * res); if (d <= R) offs.push([di, dj, prof(d)]); }
    const stamp = (x, y, z) => {
      const ci = Math.round((x - hm.minX) / res), cj = Math.round((y - hm.minY) / res);
      for (const [di, dj, pz] of offs) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i, v = z + pz;
        if (v < G[k]) G[k] = v;
      }
    };
    let prev = null;
    for (const m of r.moves) {
      if (m.t !== 'r' && prev && !m.dwell) {
        const L = Math.hypot(m.x - prev.x, m.y - prev.y, m.z - prev.z), n = Math.max(1, Math.ceil(L / (res * 0.7)));
        for (let k = 1; k <= n; k++) stamp(prev.x + ((m.x - prev.x) * k) / n, prev.y + ((m.y - prev.y) * k) / n, prev.z + ((m.z - prev.z) * k) / n);
      }
      prev = m;
    }
  }
  return G;
}

function genRough3d(op, t, P, h, stock, ctx) {
  const stl = +op.stockToLeave >= 0 ? +op.stockToLeave : 0.3;
  const { hm, T } = heightGrid(ctx, stock, t, stl, h.bottom);
  const bnd = boundaryPaths(op, t, stock, hm);
  // rest of earlier operations, or at least the shape of the stock (previous setup, solid blank)
  const rest = op.stockFrom === 'prevOps' ? restGrid(ctx, stock, hm) : stock.shape?.type === 'map' ? restGrid(ctx, stock, hm, false) : null;
  const ignore = Math.max(0, +(op.restIgnore ?? 0.1));
  // material at a level: stock outline, or what the previous operations left (thicker than "ignore")
  // lower end of the stock's top piece of material (stock from the previous setup: air under a skin)
  const sb = stock.shape?.type === 'map' && stock.shape.hm.hb ? (() => {
    const sh = stock.shape.hm, B = new Float32Array(hm.nx * hm.ny);
    for (let j = 0; j < hm.ny; j++) for (let i = 0; i < hm.nx; i++) {
      const ii = Math.round((hm.minX + i * hm.res - sh.minX) / sh.res), jj = Math.round((hm.minY + j * hm.res - sh.minY) / sh.res);
      B[j * hm.nx + i] = ii >= 0 && jj >= 0 && ii < sh.nx && jj < sh.ny ? sh.hb[jj * sh.nx + ii] : -Infinity;
    }
    return B;
  })() : null;
  const restAt = (z, zA) => (rest ? rasterPolys(hm, k => rest[k] > z + ignore && !(sb && sb[k] >= zA - 0.05)) : null);
  // rest machining: grid of the larger previous tool
  const Tprev = op.strategy === 'adaptive' && +op.restDia > t.dia ? heightGrid(ctx, stock, { type: 'flat', dia: +op.restDia }, stl, h.bottom).T : null;
  const so = t.dia * (+op.stepover || t.stepover);
  const lv = levels(h.top, h.bottom, +op.stepdown || t.stepdown);
  if (!lv.length) throw new Error('Kein Material zum Räumen');
  const pad = t.dia / 2 + 1;
  const outer = [toC([[stock.minX - pad, stock.minY - pad], [stock.maxX + pad, stock.minY - pad], [stock.maxX + pad, stock.maxY + pad], [stock.minX - pad, stock.maxY + pad]])];
  // passes: every level, and where the stock is only a thin piece above it (a skin left by the previous
  // setup) an extra pass at the lower end of that piece – the skin is cut there, not at the full step depth
  const passes = [];
  {
    let zA = h.top;
    for (const z of lv) {
      if (rest && sb) {
        const zTop = zA;
        const depth = k => (sb[k] > z + 0.5 ? Math.floor(sb[k] * 2) / 2 : z);
        const bins = new Set();
        for (let k = 0; k < rest.length; k++) if (rest[k] > z + ignore && !(sb[k] >= zTop - 0.05)) bins.add(depth(k));
        const ds = [...bins].sort((a, b) => b - a), groups = [];
        for (const d of ds) { const gr = groups[groups.length - 1]; if (gr && (gr.hi - d <= 1.5 || groups.length >= 4)) gr.lo = d; else groups.push({ hi: d, lo: d }); }
        for (const gr of groups) passes.push({ z: gr.lo, zA: zTop, skin: gr.lo > z + 1e-9, pred: k => rest[k] > z + ignore && !(sb[k] >= zTop - 0.05) && depth(k) <= gr.hi + 1e-9 && depth(k) >= gr.lo - 1e-9 });
      } else passes.push({ z, zA });
      zA = z;
    }
  }
  let zPrev = h.top;
  for (const ps of passes) {
    const z = ps.z;
    const blocked = blockedAt(hm, T, z);
    let free = blocked.length ? clip(outer, blocked, 'ctDifference') : outer;
    if (bnd) free = clip(free, bnd, 'ctIntersection');
    const restMat = ps.pred ? rasterPolys(hm, ps.pred) : restAt(z, ps.zA);
    if (rest && !restMat.length) { zPrev = z; continue; }
    // "Luftschnitte reduzieren": only around material that is still there
    if (op.reduceAir || rest) {
      const near = offsetPaths(restMat || stockOutline(stock), t.dia / 2 + 0.5);
      free = near.length ? clip(free, near, 'ctIntersection') : free;
    }
    const cleaned = CL().Clipper.CleanPolygons(free, 0.02 * S);
    // a thin skin (left by the previous setup) is faced off with wide passes instead of adaptive clearing
    let skinFace = false, zStart = zPrev;
    if (ps.pred) {
      // top of the material this pass cuts: the tool comes down in rapid only to just above it
      let top = -Infinity;
      for (let k = 0; k < rest.length; k++) if (rest[k] > top && ps.pred(k)) top = rest[k];
      zStart = Math.min(h.top, Math.max(zPrev, top));
      if (ps.skin && op.strategy === 'adaptive') skinFace = top - z <= Math.max(2, t.dia * 0.3);
    }
    if (op.strategy === 'adaptive' && !skinFace) {
      // material = the stock block (or what a bigger previous tool left); the part is excluded by the allowed region
      let material = restMat ? clip(stockOutline(stock), restMat, 'ctIntersection') : stockOutline(stock);
      if (Tprev) {
        // what the previous tool swept at this level = its free centre area grown by its radius
        const bp = blockedAt(hm, Tprev, z);
        const freePrev = bp.length ? clip(outer, bp, 'ctDifference') : outer;
        const swept = offsetPaths(freePrev, +op.restDia / 2 + 0.05);
        material = swept.length ? clip(material, swept, 'ctDifference') : material;
        // ignore slivers thinner than the stock allowance grid
        material = offsetPaths(offsetPaths(material, -hm.res), hm.res);
        if (!material.length) { zPrev = z; continue; }
      }
      const opts = { finishPass: !Tprev, z, zFrom: zStart + 0.5, tool: t, ae: t.dia * (+op.stepover || 0.1), rampDeg: +op.ramp || 2, climb: op.direction !== 'conventional' };
      if (!Tprev) adaptiveLevel(P, { allowed: cleaned, material, ...opts });
      else {
        // rest material is usually scattered (corners, holes): clear each zone on its own small grid
        for (const zone of offsetPaths(material, t.dia).filter(q => CL().Clipper.Orientation(q))) {
          const alw = clip(cleaned, [zone], 'ctIntersection'), mat = clip(material, [zone], 'ctIntersection');
          if (alw.length && mat.length) adaptiveLevel(P, { allowed: alw, material: mat, ...opts });
        }
      }
    } else {
      const sw = skinFace ? t.dia * 0.6 : so;
      const rings = [];
      let cur = cleaned;
      for (let guard = 0; cur.length && guard < 3000; guard++) {
        rings.push(cur.map(fromC));
        cur = offsetPaths(cur, -sw);
      }
      if (rings.length) clearRings(P, rings, [z], t, op, sw, zStart);
    }
    zPrev = z;
  }
}

function genParallel3d(op, t, P, h, stock, ctx) {
  const hm = ctx.heightmap();
  const stl = +op.stockToLeave || 0;
  const so = +op.stepoverMm || t.dia * (+op.stepover || 0.1);
  const step = Math.min(hm.res, 0.5);
  const alongY = +op.angle === 90;
  const [a0, a1] = alongY ? [stock.minY, stock.maxY] : [stock.minX, stock.maxX];
  const [b0, b1] = alongY ? [stock.minX, stock.maxX] : [stock.minY, stock.maxY];
  const zAt = (a, b) => dropCutter(hm, alongY ? b : a, alongY ? a : b, growStl(t, stl), h.bottom - stl) + stl;
  const bndP = boundaryPaths(op, t, stock, hm);
  if (bndP) {
    // with a boundary: parallel passes as runs inside it
    const inside = insidePaths(bndP), runs = [];
    let rev = false;
    for (let b = b0; b <= b1 + 1e-6; b += so) {
      const pts = [];
      for (let a = a0; a <= a1 + 1e-6; a += step) pts.push(alongY ? [b, a] : [a, b]);
      if (rev) pts.reverse();
      rev = !rev;
      runs.push(...dropRuns(pts, hm, t, stl, h.bottom, inside));
    }
    if (!runs.length) throw new Error('Keine Bahnen innerhalb der Begrenzung');
    emitRuns(P, runs, t, hm, stl, h.bottom, so * 1.5);
    return;
  }
  const xy = (a, b) => (alongY ? [b, a] : [a, b]);
  const lines = [];
  for (let b = b0; b <= b1 + 1e-6; b += so) lines.push(Math.min(b, b1));
  let rev = false;
  for (const b of lines) {
    const pts = [];
    const n = Math.ceil((a1 - a0) / step);
    for (let k = 0; k <= n; k++) {
      const a = a0 + ((a1 - a0) * k) / n, z = zAt(a, b);
      // wall edges between two samples: extra points (in pass coordinates a, b)
      if (k) { const q = pts[pts.length - 1], ins = []; refineStep([q[0], 0, q[1]], [a, 0, z], u => zAt(u, b), ins); for (const m of ins) pts.push([m[0], m[2]]); }
      pts.push([a, z]);
    }
    if (rev) pts.reverse();
    rev = !rev;
    // drop collinear points
    const simp = [pts[0]];
    for (let k = 1; k < pts.length - 1; k++) {
      const p0 = simp[simp.length - 1], p1 = pts[k], p2 = pts[k + 1];
      const cross = (p1[0] - p0[0]) * (p2[1] - p0[1]) - (p1[1] - p0[1]) * (p2[0] - p0[0]);
      if (Math.abs(cross) > 0.002 * Math.abs(p2[0] - p0[0] + 1e-9)) simp.push(p1);
    }
    simp.push(pts[pts.length - 1]);
    const [sx, sy] = xy(simp[0][0], b);
    if (!P.p) P.plungeAt(sx, sy, simp[0][1], t.plunge);
    else {
      // link along the boundary at a height that clears the model in between
      let zl = Math.max(P.p.z, simp[0][1]);
      for (let k = 0; k <= 8; k++) { const q = P.p.x + ((sx - P.p.x) * k) / 8, r = P.p.y + ((sy - P.p.y) * k) / 8; zl = Math.max(zl, dropCutter(hm, q, r, growStl(t, stl), h.bottom) + stl); }
      if (zl > P.p.z + 1e-6) P.feed(P.p.x, P.p.y, zl, t.feed);
      P.feed(sx, sy, zl, t.feed);
      if (simp[0][1] < zl - 1e-6) P.feed(sx, sy, simp[0][1], t.plunge);
    }
    for (const [a, z] of simp.slice(1)) { const [x, y] = xy(a, b); P.feed(x, y, z, t.feed); }
  }
  P.retract();
}

// ---------- more 3D strategies (Flach, Materialeinfahrt, Hohlkehle, Morph-Spirale, Leitkurven, Ecke, Fluss, Morph, Entgraten, Geodätisch) ----------
const opStl = op => +op.stockToLeave || 0;
const cellOf = (hm, x, y) => {
  const i = Math.round((x - hm.minX) / hm.res), j = Math.round((y - hm.minY) / hm.res);
  return i >= 0 && j >= 0 && i < hm.nx && j < hm.ny ? j * hm.nx + i : -1;
};
// slope (tan) of a height grid at a cell, Infinity at its edge to empty space
function gridSlope(hm, H, k) {
  const i = k % hm.nx, j = (k - i) / hm.nx;
  if (i < 1 || j < 1 || i >= hm.nx - 1 || j >= hm.ny - 1) return 0;
  const gx = (H[k + 1] - H[k - 1]) / (2 * hm.res), gy = (H[k + hm.nx] - H[k - hm.nx]) / (2 * hm.res);
  return Number.isFinite(gx) && Number.isFinite(gy) ? Math.hypot(gx, gy) : Infinity;
}
// 2D polyline with points every `step` mm
function densify(pts, step, closed = false) {
  const src = closed ? [...pts, pts[0]] : pts, out = [];
  for (let i = 0; i < src.length - 1; i++) {
    const a = src[i], b = src[i + 1], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(src[src.length - 1]);
  return out;
}
const polyLen = pts => pts.reduce((s, p, i) => (i ? s + Math.hypot(p[0] - pts[i - 1][0], p[1] - pts[i - 1][1]) : 0), 0);
// n points evenly spaced along a polyline
function resample(pts, n) {
  const L = polyLen(pts), out = [];
  let i = 1, acc = 0;
  for (let k = 0; k < n; k++) {
    const d = (L * k) / Math.max(1, n - 1);
    while (i < pts.length - 1 && acc + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]) < d) { acc += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]); i++; }
    const a = pts[i - 1], b = pts[i], seg = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1, u = Math.min(1, Math.max(0, (d - acc) / seg));
    out.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  }
  return out;
}
// zig-zag lines across a box at an angle, as 2D point lists
function zigzag(stock, angleDeg, so, step) {
  const a = (angleDeg * Math.PI) / 180, d = [Math.cos(a), Math.sin(a)], n = [-d[1], d[0]];
  const cx = (stock.minX + stock.maxX) / 2, cy = (stock.minY + stock.maxY) / 2;
  const R = Math.hypot(stock.maxX - stock.minX, stock.maxY - stock.minY) / 2 + so;
  const lines = [];
  let rev = false;
  for (let s = -R; s <= R + 1e-6; s += so) {
    const pts = [];
    for (let u = -R; u <= R + 1e-6; u += step) {
      const x = cx + d[0] * u + n[0] * s, y = cy + d[1] * u + n[1] * s;
      if (x >= stock.minX - 1e-6 && x <= stock.maxX + 1e-6 && y >= stock.minY - 1e-6 && y <= stock.maxY + 1e-6) pts.push([x, y]);
    }
    if (pts.length < 2) continue;
    if (rev) pts.reverse();
    rev = !rev;
    lines.push(pts);
  }
  return lines;
}
// sketch curves of an operation (in setup coordinates), in the order they were chosen
function opCurves(op, project) {
  const sk = project.features.find(f => f.id === op.sketch && f.type === 'sketch');
  if (!sk) throw new Error('Keine Skizze mit Leitkurven gewählt');
  const X = sketchXY(sk);
  const ents = Array.isArray(op.entities) ? op.entities.map(id => sk.entities.find(e => e.id === id)).filter(Boolean) : sk.entities;
  return ents.flatMap(e => entityOutlines(e)).filter(o => o.pts.length >= 2).map(o => ({ pts: o.pts.map(X.tr), closed: o.closed }));
}

// Flach: only the flat areas (slope up to the limit), parallel passes at their exact height
function genFlat3d(op, t, P, h, stock, ctx) {
  const stl = opStl(op);
  const { hm, T } = heightGrid(ctx, stock, t, stl, -Infinity);
  const so = +op.stepoverMm || t.dia * 0.4, step = sampleStep(hm);
  const lim = Math.tan(((op.slope ?? 3) * Math.PI) / 180);
  const base = boundaryFn(op, t, stock, hm);
  const flat = (x, y) => { const k = cellOf(hm, x, y); return k >= 0 && base(x, y) && T[k] > -Infinity && gridSlope(hm, T, k) <= lim; };
  const runs = zigzag(stock, +op.angle || 0, so, step).flatMap(l => dropRuns(l, hm, t, stl, h.bottom, flat)).filter(r => polyLen(r) > t.dia * 0.25);
  if (!runs.length) throw new Error('Keine flachen Bereiche gefunden – Grenzwinkel erhöhen');
  emitRuns(P, runs, t, hm, stl, h.bottom, so * 1.5);
}

// waterline loops at one height (smoothed raster outline)
function waterLoops(hm, T, z, climb) {
  let blocked = blockedAt(hm, T, z);
  if (!blocked.length) return [];
  blocked = smoothBlocked(blocked, hm);
  return blocked.map(fromC).filter(l => l.length > 2).map(loop => {
    const isle = signedArea(loop) > 0;
    return (signedArea(loop) < 0) !== (climb === isle) ? loop.slice().reverse() : loop;
  });
}
// short link at a height that clears the model, else up and over (like emitRuns)
function linkTo(P, x, y, z, t, hm, stl, floor, hop) {
  if (P.p && P.p.z < P.clear - 1e-6 && Math.hypot(P.p.x - x, P.p.y - y) <= hop) {
    let zl = Math.max(P.p.z, z);
    for (let k = 1; k < 8; k++) zl = Math.max(zl, dropCutter(hm, P.p.x + ((x - P.p.x) * k) / 8, P.p.y + ((y - P.p.y) * k) / 8, growStl(t, stl), floor) + stl);
    if (zl > P.p.z + 1e-6) P.feed(P.p.x, P.p.y, zl, t.feed);
    P.feed(x, y, zl, t.transitionFeed ?? t.feed);
    if (z < zl - 1e-6) P.feed(x, y, z, t.plunge);
  } else P.plungeAt(x, y, z, t.plunge);
}

// Materialeinfahrt (Ramp): waterlines that descend continuously instead of stepping down
function genRamp3d(op, t, P, h, stock, ctx) {
  const stl = opStl(op);
  const { hm, T } = heightGrid(ctx, stock, t, stl, -Infinity);
  const lv = levels(h.top, h.bottom, +op.stepdown || 0.5);
  if (!lv.length) throw new Error('Keine Höhenstufen');
  const climb = op.direction !== 'conventional';
  let zPrev = h.top, n = 0;
  lv.forEach((z, li) => {
    for (let loop of nearestOrder(waterLoops(hm, T, z, climb), l => l[0])) {
      if (P.p) loop = rotateNearest(loop, P.p);
      const L = loopLength(loop);
      if (L < 1e-6) continue;
      linkTo(P, loop[0][0], loop[0][1], zPrev, t, hm, stl, h.bottom, t.dia * 2);
      let walked = 0;
      for (let i = 1; i <= loop.length; i++) {
        const a = loop[i - 1], b = loop[i % loop.length];
        walked += Math.hypot(b[0] - a[0], b[1] - a[1]);
        P.feed(b[0], b[1], zPrev - (zPrev - z) * (walked / L), t.feed);
      }
      if (li === lv.length - 1) P.loopPass(loop, z, t.feed); // last level: one lap on height
      n++;
    }
    zPrev = z;
  });
  P.retract();
  if (!n) throw new Error('Keine Wände gefunden – Unterkante prüfen');
}

// one-pixel-wide centre lines of a grid mask (Zhang-Suen thinning) traced into polylines
function maskLines(hm, mask) {
  const { nx, ny } = hm, m = mask.slice();
  const at = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny ? m[j * nx + i] : 0);
  for (let changed = true, guard = 0; changed && guard < 200; guard++) {
    changed = false;
    for (const pass of [0, 1]) {
      const del = [];
      for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
        if (!m[j * nx + i]) continue;
        const p = [at(i, j - 1), at(i + 1, j - 1), at(i + 1, j), at(i + 1, j + 1), at(i, j + 1), at(i - 1, j + 1), at(i - 1, j), at(i - 1, j - 1)];
        const B = p.reduce((s, v) => s + v, 0);
        if (B < 2 || B > 6) continue;
        let A = 0;
        for (let k = 0; k < 8; k++) if (!p[k] && p[(k + 1) % 8]) A++;
        if (A !== 1) continue;
        if (pass === 0 ? p[0] * p[2] * p[4] || p[2] * p[4] * p[6] : p[0] * p[2] * p[6] || p[0] * p[4] * p[6]) continue;
        del.push(j * nx + i);
      }
      for (const k of del) m[k] = 0;
      if (del.length) changed = true;
    }
  }
  const nb = k => { const i = k % nx, j = (k - i) / nx, out = []; for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) if ((di || dj) && at(i + di, j + dj)) out.push((j + dj) * nx + i + di); return out; };
  const seen = new Uint8Array(nx * ny), lines = [];
  const trace = s => {
    const line = [s];
    seen[s] = 1;
    for (let cur = s; ;) {
      const next = nb(cur).find(q => !seen[q]);
      if (next == null) break;
      seen[next] = 1;
      line.push(next);
      cur = next;
    }
    return line;
  };
  const cells = [];
  for (let k = 0; k < nx * ny; k++) if (m[k]) cells.push(k);
  for (const k of cells) if (!seen[k] && nb(k).length === 1) lines.push(trace(k)); // open ends first
  for (const k of cells) if (!seen[k]) lines.push(trace(k));
  return lines.filter(l => l.length >= 3).map(l => l.map(k => [hm.minX + (k % nx) * hm.res, hm.minY + Math.floor(k / nx) * hm.res]));
}
// cells where the tool sits in a concave kink (it touches two surfaces at once)
function concaveMask(hm, T, minAngleDeg) {
  const lim = Math.tan((minAngleDeg * Math.PI) / 180), K = 2, mask = new Uint8Array(hm.nx * hm.ny);
  for (let j = K; j < hm.ny - K; j++) for (let i = K; i < hm.nx - K; i++) {
    const k = j * hm.nx + i, z = T[k];
    if (!(z > -Infinity)) continue;
    for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
      const a = T[k - K * (dj * hm.nx + di)], b = T[k + K * (dj * hm.nx + di)];
      if (!(a > -Infinity) || !(b > -Infinity)) continue;
      const d = K * hm.res * Math.hypot(di, dj);
      if ((a - z) / d + (b - z) / d > lim) { mask[k] = 1; break; }
    }
  }
  return mask;
}

// Hohlkehle (Pencil): one pass along every concave corner the tool can just fit into
function genPencil3d(op, t, P, h, stock, ctx) {
  const stl = opStl(op);
  const { hm, T } = heightGrid(ctx, stock, t, stl, -Infinity);
  const mask = concaveMask(hm, T, op.pencilAngle ?? 20);
  const step = sampleStep(hm);
  let runs = maskLines(hm, mask).map(l => dropRuns(densify(l, step), hm, t, stl, h.bottom, () => true)).flat();
  runs = runs.filter(r => polyLen(r) >= Math.max(1, t.dia * 0.5));
  if (!runs.length) throw new Error('Keine Hohlkehlen gefunden (Ecken größer als der Werkzeugradius?)');
  const ordered = nearestOrder(runs, r => r[0]);
  emitRuns(P, ordered, t, hm, stl, h.bottom, t.dia * 1.5);
}

// boundary polygon for spiral-like patterns: the stock or the part silhouette
function patternBoundary(op, t, stock, hm) {
  const bp = boundaryPaths(op, t, stock, hm);
  if (bp && op.boundary !== 'silhouette') return bp.map(fromC).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
  if (op.boundary === 'silhouette') {
    const sil = offsetPaths(rasterPolys(hm, k => hm.h[k] > -Infinity), t.dia / 2);
    if (sil.length) return sil.map(fromC).sort((a, b) => Math.abs(signedArea(b)) - Math.abs(signedArea(a)))[0];
  }
  return [[stock.minX, stock.minY], [stock.maxX, stock.minY], [stock.maxX, stock.maxY], [stock.minX, stock.maxY]];
}

// Morph-Spirale: a spiral that takes on the shape of the boundary towards the outside
function genMorphSpiral3d(op, t, P, h, stock, ctx) {
  const hm = ctx.heightmap();
  const so = +op.stepoverMm || t.dia * 0.1, stl = opStl(op), step = sampleStep(hm);
  const B = patternBoundary(op, t, stock, hm);
  const cen = B.reduce((s, p) => [s[0] + p[0] / B.length, s[1] + p[1] / B.length], [0, 0]);
  const cx = op.cx != null && op.cx !== '' ? +op.cx : cen[0], cy = op.cy != null && op.cy !== '' ? +op.cy : cen[1];
  // distance from the centre to the boundary for 720 directions
  const NA = 720, Rt = new Float64Array(NA);
  for (let a = 0; a < NA; a++) {
    const th = (2 * Math.PI * a) / NA, dx = Math.cos(th), dy = Math.sin(th);
    let best = 0;
    for (let i = 0; i < B.length; i++) {
      const p = B[i], q = B[(i + 1) % B.length], ex = q[0] - p[0], ey = q[1] - p[1];
      const den = dx * ey - dy * ex;
      if (Math.abs(den) < 1e-12) continue;
      const s = ((p[0] - cx) * ey - (p[1] - cy) * ex) / den, u = ((p[0] - cx) * dy - (p[1] - cy) * dx) / den;
      if (s > 0 && u >= 0 && u <= 1) best = Math.max(best, s);
    }
    Rt[a] = best;
  }
  const Rmax = Math.max(...Rt);
  if (!(Rmax > 0)) throw new Error('Mittelpunkt liegt außerhalb der Begrenzung');
  const laps = Math.max(1, Math.ceil(Rmax / so)), total = 2 * Math.PI * laps;
  const Rof = th => { const f = (((th / (2 * Math.PI)) % 1) + 1) % 1 * NA, a0 = Math.floor(f) % NA, a1 = (a0 + 1) % NA, w = f - Math.floor(f); return Rt[a0] * (1 - w) + Rt[a1] * w; };
  const pts = [];
  for (let th = 0; th <= total; ) {
    const s = th / total, r = s * Rof(th);
    pts.push([cx + r * Math.cos(th), cy + r * Math.sin(th)]);
    th += step / Math.max(r, step);
  }
  emitRuns(P, dropRuns(pts, hm, t, stl, h.bottom, () => true), t, hm, stl, h.bottom, so * 2);
}

// two guide curves, resampled to the same count and running the same way
function guidePair(op, project, step) {
  const cs = opCurves(op, project);
  if (cs.length < 2) throw new Error('Zwei Leitkurven in der Skizze auswählen');
  let A = cs[0].closed ? [...cs[0].pts, cs[0].pts[0]] : cs[0].pts, B = cs[1].closed ? [...cs[1].pts, cs[1].pts[0]] : cs[1].pts;
  const N = Math.max(40, Math.ceil(Math.max(polyLen(A), polyLen(B)) / step));
  A = resample(A, N); B = resample(B, N);
  const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  if (d(A[0], B[0]) + d(A[N - 1], B[N - 1]) > d(A[0], B[N - 1]) + d(A[N - 1], B[0])) B.reverse();
  return { A, B, N };
}
// Leitkurven-Blend: passes blend from the first guide curve into the second
function genBlend3d(op, t, P, h, stock, ctx, project) {
  const hm = ctx.heightmap();
  const so = +op.stepoverMm || t.dia * 0.1, stl = opStl(op), step = sampleStep(hm);
  const { A, B, N } = guidePair(op, project, step);
  const n = Math.max(1, Math.ceil(Math.max(...A.map((p, i) => Math.hypot(p[0] - B[i][0], p[1] - B[i][1]))) / so));
  const runs = [];
  for (let k = 0; k <= n; k++) {
    const s = k / n, line = A.map((p, i) => [p[0] * (1 - s) + B[i][0] * s, p[1] * (1 - s) + B[i][1] * s]);
    if (k % 2) line.reverse();
    runs.push(...dropRuns(densify(line, step), hm, t, stl, h.bottom, () => true));
  }
  emitRuns(P, runs, t, hm, stl, h.bottom, so * 2);
}
// Leitkurven-Morph: passes run across, from one guide curve to the other
function genGuideMorph3d(op, t, P, h, stock, ctx, project) {
  const hm = ctx.heightmap();
  const so = +op.stepoverMm || t.dia * 0.1, stl = opStl(op), step = sampleStep(hm);
  const { A, B, N } = guidePair(op, project, step);
  const M = Math.max(1, Math.ceil(Math.max(polyLen(A), polyLen(B)) / so));
  const Ar = resample(A, M + 1), Br = resample(B, M + 1);
  const runs = [];
  for (let j = 0; j <= M; j++) {
    const line = densify([Ar[j], Br[j]], step);
    if (j % 2) line.reverse();
    runs.push(...dropRuns(line, hm, t, stl, h.bottom, () => true));
  }
  emitRuns(P, runs, t, hm, stl, h.bottom, so * 2);
}

// Ecke: only what a bigger previous tool left in corners; shallow parts parallel, steep parts waterline
// Height of a tool's cutting edge above its tip at distance d from the axis.
function toolLift(tool, d) {
  const r = tool.dia / 2;
  if (tool.profile) {
    const pr = tool.profile, f = (Math.min(d, r) / r) * (pr.length - 1), k = Math.min(pr.length - 2, Math.floor(f)), w = f - k;
    return pr[k][1] * (1 - w) + pr[k + 1][1] * w;
  }
  if (tool.type === 'ball') return r - Math.sqrt(Math.max(0, r * r - d * d));
  if (tool.type === 'chamfer' || tool.type === 'drill') return Math.max(0, d - (tool.tip || 0) / 2) / Math.tan(((tool.angle || 90) / 2) * (Math.PI / 180));
  const cr = cornerOf(tool);
  return cr > 0 && d > r - cr ? cr - Math.sqrt(Math.max(0, cr * cr - (d - (r - cr)) * (d - (r - cr)))) : 0;
}
// Surface a tool leaves when its tip follows the grid T: lowest edge over all positions that reach the cell.
function machinedSurface(hm, T, tool, stl = 0) {
  // reach: half a cell beyond the radius, so both tools are measured alike on the grid
  const { nx, ny, res } = hm, R = tool.dia / 2 + res / 2, rc = Math.ceil(R / res);
  const offs = [];
  for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
    const d = Math.hypot(di, dj) * res;
    if (d <= R + 1e-9) offs.push([di, dj, toolLift(tool, Math.min(d, tool.dia / 2))]);
  }
  const M = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    let m = Infinity;
    for (const [di, dj, l] of offs) {
      const ii = i + di, jj = j + dj;
      // beyond the grid (outside the stock): the tool position is dropped on the model directly
      const v = (ii < 0 || jj < 0 || ii >= nx || jj >= ny ? dropCutter(hm, hm.minX + ii * res, hm.minY + jj * res, growStl(tool, stl), -Infinity) + stl : T[jj * nx + ii]) + l;
      if (v < m) m = v;
    }
    M[j * nx + i] = m;
  }
  return M;
}

function genCorner3d(op, t, P, h, stock, ctx) {
  const stl = opStl(op);
  const { hm, T } = heightGrid(ctx, stock, t, stl, -Infinity);
  // reference: a tool of the library with its own shape (ball, flat, torus), or only a diameter with this tool's shape
  const lib = op.restTool ? (CUR?.project?.cam?.tools || []).find(x => x.id === op.restTool) : null;
  if (op.restTool && !lib) throw new Error('Referenzwerkzeug nicht mehr in der Werkzeugliste');
  const prev = lib ? +lib.dia : +op.restDia || t.dia * 2;
  if (!lib && prev <= t.dia) throw new Error('Referenzwerkzeug muss größer als das Werkzeug sein');
  const ref = lib ? { ...lib, type: toolBase(lib), kind: lib.kind || lib.type } : { ...t, dia: prev };
  if (lib && !['ball', 'flat'].includes(ref.type)) throw new Error('Als Referenz einen Kugel-, Schaft- oder Torusfräser wählen');
  const Tp = heightGrid(ctx, stock, ref, stl, -Infinity).T;
  const tol = +op.restTol || 0.02;
  // rest material = what the reference tool leaves standing minus what this tool leaves, both as machined
  // surfaces (not tool-centre heights: next to a vertical wall both cut the same, only their centres differ)
  const Mp = machinedSurface(hm, Tp, ref, stl), Ms = machinedSurface(hm, T, t, stl);
  let mask = new Uint8Array(hm.nx * hm.ny);
  // neither tool cuts below the part (+ stock to leave): compare what stands above it
  for (let k = 0; k < mask.length; k++) if (hm.h[k] > -Infinity && Math.max(Mp[k], hm.h[k] + stl) - Math.max(Ms[k], hm.h[k] + stl) > tol) mask[k] = 1;
  // tool centres within reach of the rest material, plus a little overlap into the area already finished
  const grow = Math.max(1, Math.round((t.dia * 0.75) / hm.res)), g2 = new Uint8Array(mask.length);
  for (let j = 0; j < hm.ny; j++) for (let i = 0; i < hm.nx; i++) {
    if (!mask[j * hm.nx + i]) continue;
    for (let dj = -grow; dj <= grow; dj++) for (let di = -grow; di <= grow; di++) { const ii = i + di, jj = j + dj; if (ii >= 0 && jj >= 0 && ii < hm.nx && jj < hm.ny) g2[jj * hm.nx + ii] = 1; }
  }
  mask = g2;
  if (!mask.some(v => v)) throw new Error('Kein Restmaterial für dieses Referenzwerkzeug');
  const lim = Math.tan(((op.slope ?? 45) * Math.PI) / 180);
  const inB = boundaryFn(op, t, stock, hm);
  const inMask = (x, y, steep) => { const k = cellOf(hm, x, y); return k >= 0 && mask[k] && T[k] > -Infinity && inB(x, y) && (gridSlope(hm, T, k) > lim) === steep; };
  const so = +op.stepoverMm || t.dia * 0.1, step = sampleStep(hm);
  const runs = zigzag(stock, +op.angle || 0, so, step).flatMap(l => dropRuns(l, hm, t, stl, h.bottom, (x, y) => inMask(x, y, false)));
  const climb = op.direction !== 'conventional';
  for (const z of levels(h.top, h.bottom, +op.stepdown || so)) {
    for (const loop of waterLoops(hm, T, z, climb)) {
      let cur = null;
      for (const [x, y] of densify(loop, step, true)) {
        if (inMask(x, y, true)) (cur ||= []).push([x, y, z]); else { if (cur?.length > 1) runs.push(cur); cur = null; }
      }
      if (cur?.length > 1) runs.push(cur);
    }
  }
  const keep = runs.filter(r => polyLen(r) > hm.res * 2);
  if (!keep.length) throw new Error('Kein Restmaterial für dieses Referenzwerkzeug');
  emitRuns(P, nearestOrder(keep, r => r[0]), t, hm, stl, h.bottom, so * 2);
}

// region of the picked faces (or closed sketch profiles) as Clipper paths
function regionPaths(op, project) {
  const g = opGeometry(op, project);
  return unionEvenOdd(g.regions.flatMap(r => [r.outer, ...r.holes]).map(toC));
}
// Fluss: passes along the main direction of the selected faces
function genFlow3d(op, t, P, h, stock, ctx, project) {
  const hm = ctx.heightmap();
  const so = +op.stepoverMm || t.dia * 0.1, stl = opStl(op), step = sampleStep(hm);
  const reg = regionPaths(op, project);
  if (!reg.length) throw new Error('Keine Fläche gewählt');
  const polys = reg.map(fromC), pts = polys.flat();
  // principal axis of the face outline
  const mx = pts.reduce((s, p) => s + p[0], 0) / pts.length, my = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) { sxx += (x - mx) ** 2; syy += (y - my) ** 2; sxy += (x - mx) * (y - my); }
  const ang = op.flowAcross ? 0.5 * Math.atan2(2 * sxy, sxx - syy) + Math.PI / 2 : 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const inside = (x, y) => { let c = 0; for (const pl of polys) if (pointInPoly([x, y], pl)) c++; return c % 2 === 1; };
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  const box = { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
  const runs = zigzag(box, (ang * 180) / Math.PI, so, step).flatMap(l => dropRuns(l, hm, t, stl, h.bottom, inside));
  if (!runs.length) throw new Error('Die Fläche ist kleiner als der Bahnabstand');
  emitRuns(P, runs, t, hm, stl, h.bottom, so * 2);
}
// Flächen-Morph: passes morph from the face boundary towards its middle
function genMorph3d(op, t, P, h, stock, ctx, project) {
  const hm = ctx.heightmap();
  const so = +op.stepoverMm || t.dia * 0.1, stl = opStl(op), step = sampleStep(hm);
  let region = regionPaths(op, project);
  if (!region.length) throw new Error('Keine Fläche gewählt');
  const rings = [];
  for (let guard = 0; region.length && guard < 2000; guard++) {
    rings.push(region.map(fromC));
    region = offsetPaths(region, -so);
  }
  if (op.morphOutward) rings.reverse();
  const runs = [];
  for (const ring of rings) for (const loop of ring) runs.push(...dropRuns(densify(loop, step, true), hm, t, stl, h.bottom, () => true));
  emitRuns(P, runs, t, hm, stl, h.bottom, so * 1.5);
}

// Entgraten: along every sharp convex edge of the part that the tool can reach from above
function genDeburr3d(op, t, P, h, stock, ctx) {
  if (t.type !== 'ball' && t.type !== 'chamfer') throw new Error('Entgraten: Fasen-, Kugel- oder Lollipop-Fräser wählen');
  const vtool = t.type === 'chamfer';
  const hm = ctx.heightmap(), r = t.dia / 2, d = +op.depth || 0.2, stl = opStl(op);
  const half = ((t.angle || 90) / 2) * (Math.PI / 180), cot = 1 / Math.tan(half), rt = (t.tip || 0) / 2;
  const minA = ((op.edgeAngle ?? 30) * Math.PI) / 180;
  const key = (x, y, z) => `${Math.round(x * 1000)},${Math.round(y * 1000)},${Math.round(z * 1000)}`;
  const V = new Map(), verts = [], edges = new Map();
  const vid = (x, y, z) => { const k = key(x, y, z); let i = V.get(k); if (i == null) { i = verts.length; V.set(k, i); verts.push([x, y, z]); } return i; };
  for (const b of ctx.bodies || []) {
    const pos = b.geometry.attributes.position, idx = b.geometry.index;
    const nt = idx ? idx.count / 3 : pos.count / 3;
    for (let f = 0; f < nt; f++) {
      const ids = [0, 1, 2].map(c => { const q = idx ? idx.getX(f * 3 + c) : f * 3 + c; return vid(pos.getX(q), pos.getY(q), pos.getZ(q)); });
      const [A, B, C] = ids.map(i => verts[i]);
      const u = [B[0] - A[0], B[1] - A[1], B[2] - A[2]], v = [C[0] - A[0], C[1] - A[1], C[2] - A[2]];
      const n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2], u[0] * v[1] - u[1] * v[0]], L = Math.hypot(...n);
      if (L < 1e-12) continue;
      const nn = n.map(c => c / L), cen = [(A[0] + B[0] + C[0]) / 3, (A[1] + B[1] + C[1]) / 3, (A[2] + B[2] + C[2]) / 3];
      for (let e = 0; e < 3; e++) {
        const a = ids[e], c = ids[(e + 1) % 3], k = a < c ? `${a}_${c}` : `${c}_${a}`;
        (edges.get(k) || edges.set(k, []).get(k)).push({ n: nn, cen });
      }
    }
  }
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const adj = new Map(), bis = new Map();
  for (const [k, fs] of edges) {
    if (fs.length !== 2) continue;
    const [f1, f2] = fs, ang = Math.acos(Math.max(-1, Math.min(1, dot(f1.n, f2.n))));
    if (ang < minA) continue;
    const [a, c] = k.split('_').map(Number), p = verts[a];
    if (dot([f2.cen[0] - p[0], f2.cen[1] - p[1], f2.cen[2] - p[2]], f1.n) > -1e-9) continue; // concave
    const nb = [f1.n[0] + f2.n[0], f1.n[1] + f2.n[1], f1.n[2] + f2.n[2]], L = Math.hypot(...nb);
    if (L < 1e-9 || nb[2] / L < 0.1) continue; // not reachable from above
    const b = nb.map(x => x / L);
    for (const [i, j] of [[a, c], [c, a]]) { (adj.get(i) || adj.set(i, []).get(i)).push(j); const s = bis.get(i) || [0, 0, 0]; bis.set(i, [s[0] + b[0], s[1] + b[1], s[2] + b[2]]); }
  }
  if (!adj.size) throw new Error('Keine scharfen Außenkanten gefunden, die von oben erreichbar sind');
  const used = new Set(), ek = (i, j) => (i < j ? `${i}_${j}` : `${j}_${i}`), chains = [];
  for (const start of [...adj.keys()].sort((a, b) => adj.get(a).length - adj.get(b).length)) {
    for (const first of adj.get(start)) {
      if (used.has(ek(start, first))) continue;
      const ch = [start, first];
      used.add(ek(start, first));
      for (let cur = first, guard = 0; guard < 100000; guard++) {
        const nx = (adj.get(cur) || []).find(q => !used.has(ek(cur, q)));
        if (nx == null || adj.get(cur).length > 2) break;
        used.add(ek(cur, nx));
        ch.push(nx);
        cur = nx;
      }
      chains.push(ch);
    }
  }
  const step = sampleStep(hm), runs = [];
  for (const ch of chains) {
    const pts = [];
    for (const i of ch) {
      const p = verts[i], s = bis.get(i), L = Math.hypot(...s), b = s.map(x => x / L);
      let c, zt, expect;
      if (vtool) {
        // V tool, axis vertical: the cone flank passes through the point d inside the edge (along the bisector);
        // the axis stands outside the edge by the tip radius, so the tip never touches the lower face
        const bh = Math.hypot(b[0], b[1]), hx = bh > 0.05 ? b[0] / bh : 0, hy = bh > 0.05 ? b[1] / bh : 0;
        const sOut = bh > 0.05 ? rt + 0.02 : 0;
        const ax = [p[0] + hx * sOut, p[1] + hy * sOut];
        const q = [p[0] - b[0] * d, p[1] - b[1] * d, p[2] - b[2] * d];
        const rq = Math.hypot(q[0] - ax[0], q[1] - ax[1]);
        if (rq > r - 0.05) { if (pts.length > 1) runs.push(pts.splice(0)); else pts.length = 0; continue; }
        zt = q[2] - Math.max(0, rq - rt) * cot;
        c = [ax[0], ax[1], zt];
        expect = d * bh * cot + d * Math.abs(b[2]) + 0.05;
      } else {
        c = [p[0] + b[0] * (r - d), p[1] + b[1] * (r - d), p[2] + b[2] * (r - d)];
        zt = c[2] - r;
        expect = 2 * d + 0.2;
      }
      // never deeper than the depth below the safe drop position (protects other faces)
      const zs = dropCutter(hm, c[0], c[1], growStl(t, stl), -Infinity) + stl;
      if (zs - zt > expect) { if (pts.length > 1) runs.push(pts.splice(0)); else pts.length = 0; continue; }
      pts.push([c[0], c[1], zt]);
    }
    if (pts.length > 1) runs.push(pts);
  }
  const keep = runs.map(r2 => simplify3d(r2)).filter(r2 => r2.length > 1);
  if (!keep.length) throw new Error('Keine Kante ohne Kollision erreichbar');
  emitRuns(P, nearestOrder(keep, r2 => r2[0]), t, hm, stl, h.bottom, step * 4);
}

// Geodätische Linie: passes at constant distance measured on the surface from the guide curves
function genGeodesic3d(op, t, P, h, stock, ctx, project) {
  const stl = opStl(op);
  const { hm, T } = heightGrid(ctx, stock, t, stl, h.bottom);
  const { nx, ny, res } = hm;
  const so = +op.stepoverMm || t.dia * 0.1, step = sampleStep(hm);
  const inside = boundaryFn(op, t, stock, hm);
  const D = new Float64Array(nx * ny).fill(Infinity);
  const heap = [];
  const push = (k, d) => { heap.push([d, k]); let i = heap.length - 1; while (i) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => { const top = heap[0], last = heap.pop(); if (heap.length) { heap[0] = last; let i = 0; for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; } } return top; };
  // seeds: the guide curves of the sketch, else the outline of the machining area
  const seeds = [];
  if (op.sketch) for (const c of opCurves(op, project)) for (const [x, y] of densify(c.pts, res / 2, c.closed)) { const k = cellOf(hm, x, y); if (k >= 0) seeds.push(k); }
  else for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const k = j * nx + i, x = hm.minX + i * res, y = hm.minY + j * res; if (inside(x, y) && [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([di, dj]) => !inside(x + di * res, y + dj * res))) seeds.push(k); }
  if (!seeds.length) throw new Error('Keine Leitkurve im Bearbeitungsbereich');
  for (const k of seeds) if (D[k] > 0) { D[k] = 0; push(k, 0); }
  const NB = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  while (heap.length) {
    const [d, k] = pop();
    if (d > D[k]) continue;
    const i = k % nx, j = (k - i) / nx;
    for (const [di, dj] of NB) {
      const ii = i + di, jj = j + dj;
      if (ii < 0 || jj < 0 || ii >= nx || jj >= ny) continue;
      const q = jj * nx + ii;
      if (!inside(hm.minX + ii * res, hm.minY + jj * res)) continue;
      const nd = d + Math.hypot(di * res, dj * res, T[q] - T[k]);
      if (nd < D[q]) { D[q] = nd; push(q, nd); }
    }
  }
  let maxD = 0;
  for (const v of D) if (v < Infinity && v > maxD) maxD = v;
  const nL = Math.max(0, Math.ceil((maxD - so / 2) / so));
  const lev = m => so / 2 + m * so;
  // marching squares for all levels in one pass: every cell adds its crossing segments to the levels that
  // pass between its lowest and highest corner (was: one full scan of the grid per level)
  const segsByL = Array.from({ length: nL }, () => []);
  const v = [0, 0, 0, 0], C = [[0, 0], [1, 0], [1, 1], [0, 1]];
  for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    const k = j * nx + i;
    v[0] = D[k]; v[1] = D[k + 1]; v[2] = D[k + 1 + nx]; v[3] = D[k + nx];
    if (!(v[0] < Infinity && v[1] < Infinity && v[2] < Infinity && v[3] < Infinity)) continue;
    const lo = Math.min(v[0], v[1], v[2], v[3]), hi = Math.max(v[0], v[1], v[2], v[3]);
    for (let m = Math.max(0, Math.ceil((lo - so / 2) / so)); m < nL; m++) {
      const L = lev(m);
      if (L > hi) break;
      const cut = [];
      for (let e = 0; e < 4; e++) {
        const a = v[e], b = v[(e + 1) % 4];
        if ((a < L) !== (b < L)) { const u = (L - a) / (b - a), p = C[e], q = C[(e + 1) % 4]; cut.push([hm.minX + (i + p[0] + (q[0] - p[0]) * u) * res, hm.minY + (j + p[1] + (q[1] - p[1]) * u) * res]); }
      }
      if (cut.length === 2) segsByL[m].push(cut); else if (cut.length === 4) segsByL[m].push([cut[0], cut[1]], [cut[2], cut[3]]);
    }
  }
  const runs = [];
  for (const segs of segsByL) {
    const kk = p => `${Math.round(p[0] * 1e4)},${Math.round(p[1] * 1e4)}`, ends = new Map();
    segs.forEach((sg, i) => { for (const p of sg) { const key = kk(p); let l = ends.get(key); if (!l) ends.set(key, (l = [])); l.push(i); } });
    const used = new Uint8Array(segs.length);
    for (let s0 = 0; s0 < segs.length; s0++) {
      if (used[s0]) continue;
      used[s0] = 1;
      // grow both ways; the backward half is collected reversed and joined at the end (no unshift)
      const fwd = [segs[s0][0], segs[s0][1]], bwd = [];
      for (const back of [false, true]) {
        for (;;) {
          const tip = back ? (bwd.length ? bwd[bwd.length - 1] : fwd[0]) : fwd[fwd.length - 1];
          const tk = kk(tip);
          const nxt = (ends.get(tk) || []).find(q => !used[q]);
          if (nxt == null) break;
          used[nxt] = 1;
          const sg = segs[nxt], other = kk(sg[0]) === tk ? sg[1] : sg[0];
          (back ? bwd : fwd).push(other);
        }
      }
      const line = bwd.reverse().concat(fwd);
      if (polyLen(line) > res * 2) runs.push(...dropRuns(densify(line, step), hm, t, stl, h.bottom, inside));
    }
  }
  if (!runs.length) throw new Error('Keine Bahnen – Bahnabstand oder Bereich prüfen');
  emitRuns(P, nearestOrder(runs, r => r[0]), t, hm, stl, h.bottom, so * 2);
}

// ---------- driver ----------
// 4-axis simultaneous milling: the rotary axis A lies along the setup X axis through the centre of the stock
// (cylinder stock: its axis). A ball end mill stays radial to the axis (tool along machine Z, A turns the part)
// and follows the part as a helix ('helix') or as lines along X ('line'). The surface is sampled as a radius
// map r(x, θ); the ball centre is lifted until no sampled surface point lies inside the ball (+ allowance).
// Moves carry the part-frame tip position (x, y, z) and the machine values: a (degrees, continuous), my, mz.
function genRotary(op, t, stock, ctx, h, project) {
  const ball = t.type === 'ball';
  if (!ball && t.type !== 'flat') throw new Error('4-Achs-Bearbeitung braucht einen Kugel- oder Schaftfräser');
  const sh = stock.shape?.type === 'cyl' && stock.shape.axis === 'x' ? stock.shape : null;
  const cy = sh ? sh.cu : (stock.minY + stock.maxY) / 2, cz = sh ? sh.cv : (stock.bottom + stock.top) / 2;
  const Rs = sh ? sh.r : Math.hypot((stock.maxY - stock.minY) / 2, (stock.top - stock.bottom) / 2);
  const R = (+t.dia || 6) / 2, stl = +op.stockToLeave || 0, Re = R + stl;
  const num = (v, d) => (v != null && v !== '' && Number.isFinite(+v) ? +v : d);
  const x0 = num(op.xStart, stock.minX), x1 = num(op.xEnd, stock.maxX);
  if (!(x1 > x0)) throw new Error('Bereich X: Ende muss größer als Start sein');
  // radius map of the part
  const bvhs = ctx.bodies.map(b => new MeshBVH(b.geometry));
  const dx = Math.max(0.1, Math.min(R / 3, 0.5)), xa = x0 - Re, nx = Math.ceil((x1 - x0 + 2 * Re) / dx) + 1;
  const nt = Math.min(720, Math.max(90, Math.ceil((2 * Math.PI * Rs) / 0.5))), dt = (2 * Math.PI) / nt;
  const rm = new Float32Array(nx * nt), rBig = Rs + 20;
  const ray = new THREE.Ray(new THREE.Vector3(), new THREE.Vector3());
  for (let i = 0; i < nx; i++) for (let j = 0; j < nt; j++) {
    const th = j * dt, uy = Math.sin(th), uz = Math.cos(th);
    ray.origin.set(xa + i * dx, cy + uy * rBig, cz + uz * rBig);
    ray.direction.set(0, -uy, -uz);
    let best = 0;
    for (const b of bvhs) { const hit = b.raycastFirst(ray, THREE.DoubleSide); if (hit) best = Math.max(best, rBig - hit.distance); }
    rm[i * nt + j] = best;
  }
  // widened by one cell in X and θ: edges that fall between two samples (end faces, shoulders) are never cut into
  const rw = new Float32Array(rm.length);
  for (let i = 0; i < nx; i++) for (let j = 0; j < nt; j++) {
    let m = 0;
    for (let di = -1; di <= 1; di++) { const ii = i + di; if (ii < 0 || ii >= nx) continue; for (let dj = -1; dj <= 1; dj++) m = Math.max(m, rm[ii * nt + ((j + dj + nt) % nt)]); }
    rw[i * nt + j] = m;
  }
  const rm0 = rm.slice();
  rm.set(rw);
  const jr = Math.ceil(Math.asin(Math.min(1, Re / Math.max(Re, 0.5 * Rs))) / dt) + 1;
  // tool tip radius at (x, θ): ball centre as low as possible without a surface point inside the ball;
  // flat end: every surface point under the tool's circle lies below the end face
  const tip = (x, th) => {
    let rc = ball ? Re : 0;
    const i0 = Math.max(0, Math.floor((x - Re - xa) / dx)), i1 = Math.min(nx - 1, Math.ceil((x + Re - xa) / dx));
    const jc = Math.round(th / dt);
    for (let i = i0; i <= i1; i++) {
      const ddx = xa + i * dx - x, rest = Re * Re - ddx * ddx;
      if (rest <= 0) continue;
      for (let jj = jc - jr; jj <= jc + jr; jj++) {
        const r = rm[i * nt + (((jj % nt) + nt) % nt)];
        if (!(r > 0)) continue;
        const D = jj * dt - th, c = Math.cos(D), s = Math.sin(D);
        const q = rest - r * r * s * s;
        if (q < 0 || c <= 0) continue;
        const v = ball ? r * c + Math.sqrt(q) : r * c + stl;
        if (v > rc) rc = v;
      }
    }
    return ball ? rc - R : rc;
  };
  const moves = [];
  const at = (t0, x, deg, rho, f) => {
    const th = (deg * Math.PI) / 180;
    const m = { t: t0, x, y: cy + rho * Math.sin(th), z: cz + rho * Math.cos(th), a: deg, my: cy, mz: cz + rho };
    if (t0 !== 'r') m.f = f;
    moves.push(m);
  };
  at.last = () => moves[moves.length - 1];
  const rSafe = Math.max(Rs + 2, h.safe - cz), rClear = Rs + 2;
  const aStep = Math.max(0.2, num(op.angleStep, 3));
  const step = Math.max(0.05, num(op.stepoverMm, R * 0.4));
  at('r', x0, 0, rSafe); at('r', x0, 0, rClear);
  let last = 0;
  if (op.type === 'rotaryWrap') {
    last = wrapCurves(op, t, project, { cy, cz, Rs, R, xa, dx, nx, nt, dt, rm0, at, rClear, x0 });
  } else if (op.type === 'rotaryRough') {
    // roughing: layers from the stock surface inwards, each one helix at max(layer radius, finished tip +
    // allowance), alternating along X; the next layer is entered radially where the last one ended
    const ap = Math.max(0.1, num(op.stepdown, t.stepdown || 1));
    let minTip = Infinity;
    for (let x = x0; x <= x1 + 1e-9; x += Math.max(dx, 1)) for (let d = 0; d < 360; d += 5) minTip = Math.min(minTip, tip(x, (d * Math.PI) / 180));
    const n = Math.ceil((((x1 - x0) / step) * 360) / aStep), adv = (step * aStep) / 360;
    let deg = 0;
    for (let rl = Rs - ap, layer = 0; layer < 500; rl -= ap, layer++) {
      const r = Math.max(rl, minTip), fwd = layer % 2 === 0;
      for (let k = 0; k <= n; k++) {
        const x = fwd ? Math.min(x1, x0 + adv * k) : Math.max(x0, x1 - adv * k);
        at('f', x, deg, Math.max(r, tip(x, ((deg % 360) * Math.PI) / 180)), k === 0 ? t.plunge : t.feed);
        if (k < n) deg += aStep;
      }
      if (r <= minTip + 1e-6) break;
    }
    last = deg;
  } else if ((op.pattern || 'helix') === 'helix') {
    // one revolution per stepover along X
    const n = Math.ceil((((x1 - x0) / step) * 360) / aStep);
    for (let k = 0; k <= n; k++) {
      const deg = k * aStep, x = Math.min(x1, x0 + (step * deg) / 360);
      at('f', x, deg, tip(x, ((deg % 360) * Math.PI) / 180), k === 0 ? t.plunge : t.feed);
      last = deg;
    }
  } else {
    // lines along X, the part turned by the stepover (arc length on the stock) between them
    const dA = Math.max(aStep / 4, ((step / Math.max(1, Rs)) * 180) / Math.PI), nl = Math.ceil(360 / dA);
    const sx = Math.max(dx, 0.5);
    for (let l = 0; l < nl; l++) {
      const deg = (l * 360) / nl, th = (deg * Math.PI) / 180, fwd = l % 2 === 0;
      if (l > 0) {
        // over to the next line around the axis, following the surface
        const prev = (((l - 1) * 360) / nl), xe = fwd ? x0 : x1;
        for (let d = prev + aStep; d < deg - 1e-9; d += aStep) at('f', xe, d, tip(xe, (d * Math.PI) / 180), t.feed);
      }
      const nn = Math.ceil((x1 - x0) / sx);
      for (let k = 0; k <= nn; k++) { const x = fwd ? x0 + ((x1 - x0) * k) / nn : x1 - ((x1 - x0) * k) / nn; at('f', x, deg, tip(x, th), l === 0 && k === 0 ? t.plunge : t.feed); }
      last = deg;
    }
  }
  const p = moves[moves.length - 1];
  at('f', p.x, last, rClear, t.feed);
  at('r', p.x, last, rSafe);
  // back to an A position equal to 0° (multiple of 360°) at the safe radius
  at('r', p.x, Math.round(last / 360) * 360, rSafe);
  return { moves, heights: h, tool: t, rotary: { y: cy, z: cz, r: Rs }, ...stats(moves, ctx.rapid) };
}

// Wrap sketch curves onto the cylinder: the sketch plane lies parallel to the A axis (normal (0, sin φ, cos φ) in
// the setup frame); X stays X, the distance s across the axis becomes the angle φ + s / Rw (arc length on the wrap
// diameter). Cut at a fixed depth below the part surface (radius map), in depth steps; open curves back and forth.
function wrapCurves(op, t, project, W) {
  const { cy, cz, Rs, R, xa, dx, nx, nt, dt, rm0, at, rClear } = W;
  const sk = project?.features.find(f => f.id === op.sketch && f.type === 'sketch');
  if (!sk) throw new Error('Keine Skizze als Geometrie gewählt');
  const b = basis(sk);
  const n = b.n.clone().transformDirection(T), o = b.o.clone().applyMatrix4(T);
  if (Math.abs(n.x) > 0.02) throw new Error('Die Skizze muss parallel zur A-Achse (X des Setups) liegen');
  // the side of the axis the sketch looks at
  if ((o.y - cy) * n.y + (o.z - cz) * n.z < -1e-6) n.negate();
  const phi = Math.atan2(n.y, n.z), cp = Math.cos(phi), sp = Math.sin(phi);
  const curves = sk.entities
    .filter(e => !e.cons && (!Array.isArray(op.entities) || op.entities.includes(e.id)))
    .flatMap(e => entityOutlines(e))
    .filter(c => c.pts.length >= 2)
    .map(c => {
      const pts = c.pts.map(([u, v]) => { const p = toWorld(b, u, v).applyMatrix4(T); return [p.x, (p.y - cy) * cp - (p.z - cz) * sp]; });
      return { pts: c.closed ? [...pts, pts[0]] : pts, closed: c.closed };
    });
  if (!curves.length) throw new Error('Keine Kurven ausgewählt');
  // reference surface at (x, θ): the highest part radius within the tool radius + 1 mm around the point, so an
  // engraving that is already modelled (Prägen) is measured from the surface next to it, not from its floor
  const wr = R + 1, wi = Math.max(0, Math.ceil(wr / dx));
  const surf = (x, th) => {
    const ic = Math.round((x - xa) / dx), jc = Math.round(th / dt), wj = Math.min(nt >> 2, Math.ceil(wr / Math.max(0.05, 0.6 * Rs * dt)));
    let m = 0;
    for (let i = Math.max(0, ic - wi); i <= Math.min(nx - 1, ic + wi); i++) for (let j = jc - wj; j <= jc + wj; j++) m = Math.max(m, rm0[i * nt + (((j % nt) + nt) % nt)]);
    return m;
  };
  // wrap radius: given, or the mean part radius under the curves
  let Rw = +op.wrapDia > 0 ? +op.wrapDia / 2 : Rs;
  if (!(+op.wrapDia > 0)) for (let it = 0; it < 2; it++) {
    let sum = 0, cnt = 0;
    for (const c of curves) for (const [x, s] of c.pts) { const r = surf(x, phi + s / Rw); if (r > 0) { sum += r; cnt++; } }
    if (cnt) Rw = sum / cnt;
  }
  const depth = Math.max(0.01, +op.depth || 0.5), sd = +op.stepdown > 0 ? +op.stepdown : depth;
  const lv = [];
  for (let d = Math.min(sd, depth); ; d = Math.min(depth, d + sd)) { lv.push(d); if (d >= depth - 1e-9) break; }
  const seg = Math.max(0.05, Math.min(0.5, (+t.dia || 2) / 4));
  // nearest curve next (start point, compared by x and arc length); open curves may run backwards
  const order = [], left = curves.slice();
  let px = W.x0, ps = 0;
  while (left.length) {
    let bi = 0, bd = Infinity, rev = false;
    left.forEach((c, i) => {
      const a = c.pts[0], e = c.pts[c.pts.length - 1];
      const da = Math.hypot(a[0] - px, a[1] - ps), de = Math.hypot(e[0] - px, e[1] - ps);
      if (da < bd) { bd = da; bi = i; rev = false; }
      if (!c.closed && de < bd) { bd = de; bi = i; rev = true; }
    });
    const c = left.splice(bi, 1)[0];
    const pts = rev ? c.pts.slice().reverse() : c.pts;
    order.push({ pts, closed: c.closed });
    [px, ps] = pts[pts.length - 1];
  }
  let deg = 0;
  for (const c of order) {
    // densify: at most `seg` along X and around the surface
    const q = [c.pts[0]];
    for (let i = 1; i < c.pts.length; i++) {
      const [ax, as] = c.pts[i - 1], [bx, bs] = c.pts[i], k = Math.max(1, Math.ceil(Math.hypot(bx - ax, bs - as) / seg));
      for (let m = 1; m <= k; m++) q.push([ax + ((bx - ax) * m) / k, as + ((bs - as) * m) / k]);
    }
    // A of the first point: the turn nearest to where A is now (no needless full turns)
    const d0 = ((phi + q[0][1] / Rw) * 180) / Math.PI, off = Math.round((deg - d0) / 360) * 360;
    const pos = q.map(([x, s]) => { const th = phi + s / Rw, r = surf(x, th); return { x, deg: (th * 180) / Math.PI + off, r: r > 0 ? r : Rw }; });
    at('r', pos[0].x, pos[0].deg, rClear);
    lv.forEach((d, li) => {
      const seq = !c.closed && li % 2 ? pos.slice().reverse() : pos;
      seq.forEach((p, k) => at('f', p.x, p.deg, Math.max(0, p.r - d), k === 0 ? t.plunge : t.feed));
    });
    const e = at.last();
    at('f', e.x, e.a, rClear, t.feed);
    deg = e.a;
  }
  return deg;
}

function stats(moves, rapid = RAPID_FEED) {
  let len = 0, time = 0;
  for (let i = 1; i < moves.length; i++) {
    const a = moves[i - 1], b = moves[i];
    const d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    len += d;
    time += b.dwell ? b.dwell : (d / (b.t === 'r' ? rapid : b.f)) * 60;
  }
  return { length: len, time };
}

// ---------- probing: work offset from the part (touch probe cycles in the post) ----------
export const PROBE_MODES = { z: 'Z-Fläche (Höhe)', bore: 'Bohrung (Mitte X/Y)', boss: 'Zapfen (Mitte X/Y)', rectOut: 'Rechteck außen (Mitte X/Y)', rectIn: 'Rechtecktasche innen (Mitte X/Y)' };
function genProbe(op, t, P, project) {
  const g = opGeometry(op, project);
  const mode = op.probeMode || 'z';
  let res;
  if (mode === 'bore' || mode === 'boss') {
    const it = g.items.find(i => i.e.type === 'circle');
    if (!it) throw new Error(mode === 'bore' ? 'Bohrung wählen (Zylinderfläche oder Kreis)' : 'Zapfen wählen (Zylinderfläche oder Kreis)');
    const [cx, cy] = g.X.tr([+it.e.cx, +it.e.cy]);
    res = { mode, x: cx, y: cy, z: g.X.z, dia: 2 * +it.e.r };
  } else {
    const pts = g.items.flatMap(i => i.poly);
    if (!pts.length) throw new Error('Fläche wählen');
    const xs = pts.map(q => q[0]), ys = pts.map(q => q[1]);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    res = { mode, x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: g.X.z, w: maxX - minX, l: maxY - minY };
    // Z probing: the point must lie on the face (not in a hole of it)
    if (mode === 'z' && !g.regions.some(r => pointInPoly([res.x, res.y], r.outer) && !r.holes.some(hh => pointInPoly([res.x, res.y], hh)))) {
      const o = g.regions[0].outer;
      res.x = (o[0][0] * 2 + o[1][0] + o[o.length - 1][0]) / 4;
      res.y = (o[0][1] * 2 + o[1][1] + o[o.length - 1][1]) / 4;
    }
  }
  const depth = Math.max(0, +op.probeDepth || 0);
  res.zMeas = mode === 'z' ? res.z : res.z - (depth || 3);
  res.clearance = Math.max(0.5, +op.probeClear || 5);
  // shown path only: above the point, down to the safety distance, back (the cycle does the probing)
  P.rapid(res.x, res.y, P.safe);
  P.rapid(res.x, res.y, res.z + res.clearance);
  P.rapid(res.x, res.y, P.safe);
  return { probe: res };
}

// Drops the points of plain feed moves that lie on the straight line between their neighbours (offset rings and
// heightmap passes come with many of them): the path stays the same within tol, the program gets shorter and
// the machine does not have to chew through blocks of a few hundredths. Points on arcs stay (their sag is far
// above tol), so arc fitting in the post still finds them. Moves with compensation, leads, dwell or rotary
// values are left alone.
const LEAN_KEYS = new Set(['t', 'x', 'y', 'z', 'f']);
const isPlainFeed = m => { if (m.t !== 'f') return false; for (const k in m) if (!LEAN_KEYS.has(k)) return false; return true; };
export function leanMoves(moves, tol = 0.0005) {
  const n = moves.length;
  if (n < 3) return moves;
  const keep = new Uint8Array(n).fill(1);
  const tol2 = tol * tol;
  let i = 1;
  while (i < n) {
    if (!isPlainFeed(moves[i])) { i++; continue; }
    let j = i;
    while (j + 1 < n && isPlainFeed(moves[j + 1]) && moves[j + 1].f === moves[i].f) j++;
    // chain: the point before the run, then the run; Douglas-Peucker between its ends
    if (j > i && Number.isFinite(moves[i - 1].x)) {
      for (let k = i; k < j; k++) keep[k] = 0;
      const stack = [[i - 1, j]];
      while (stack.length) {
        const [a, b] = stack.pop();
        if (b - a < 2) continue;
        const A = moves[a], B = moves[b], ux = B.x - A.x, uy = B.y - A.y, uz = B.z - A.z, L2 = ux * ux + uy * uy + uz * uz;
        let worst = -1, wd = tol2;
        for (let k = a + 1; k < b; k++) {
          const q = moves[k], vx = q.x - A.x, vy = q.y - A.y, vz = q.z - A.z;
          const u = L2 > 1e-18 ? Math.max(0, Math.min(1, (vx * ux + vy * uy + vz * uz) / L2)) : 0;
          const dx = vx - u * ux, dy = vy - u * uy, dz = vz - u * uz, d = dx * dx + dy * dy + dz * dz;
          if (d > wd) { wd = d; worst = k; }
        }
        if (worst >= 0) { keep[worst] = 1; stack.push([a, worst], [worst, b]); }
      }
    }
    i = j + 1;
  }
  return moves.filter((_, k) => keep[k]);
}

export function manualResult(op) {
  const kind = op.manualKind in MANUAL_KINDS ? op.manualKind : 'comment';
  const sec = kind === 'dwell' ? Math.max(0, +op.manualSec || 0) : 0;
  const text = String(op.manualText ?? '').trim();
  if ((kind === 'comment' || kind === 'code' || kind === 'message') && !text) throw new Error(kind === 'code' ? 'NC-Code eintragen' : 'Text eintragen');
  if (kind === 'dwell' && !(sec > 0)) throw new Error('Verweilzeit in Sekunden eintragen');
  return { moves: [], manual: { kind, text, sec }, length: 0, time: sec };
}

export function generateOp(op, project, stock, ctx) {
  if (op.type === 'manual') return manualResult(op);
  let t = project.cam.tools.find(x => x.id === op.tool);
  if (!t) throw new Error('Kein Werkzeug gewählt');
  // cutting data preset of the tool ("Schnittdaten")
  const pre = op.preset && (t.presets || []).find(x => x.id === op.preset);
  if (pre) t = { ...t, ...Object.fromEntries(Object.entries({ rpm: pre.rpm, feed: pre.feed, plunge: pre.plunge, stepdown: pre.stepdown, stepover: pre.stepover, coolant: pre.coolant }).filter(([, v]) => v != null && v !== '' && !(typeof v === 'number' && !Number.isFinite(v)))) };
  t = applyCutData(t, op);
  // switched-off sections of the dialog ("Rohteil-Aufmaß", "Tiefenschnitte")
  if (op.stockOn === false) op = { ...op, stockToLeave: 0, axialStock: 0 };
  if (op.multiDepth === false && ['pocket', 'adaptive', 'rough3d', 'adaptive3d', 'pocket3d', 'contour3d', 'ramp3d', 'slot', 'circular', 'trace', 'steep3d'].includes(op.type)) op = { ...op, stepdown: 1e6 };
  if (!t.type || t.type === 'none') throw new Error('Dieses Werkzeug (Halter oder Auftragskopf) kann nicht zerspanen');
  if (op.type === 'probe' && t.type !== 'probe') throw new Error('Für Antasten einen 3D-Taster als Werkzeug wählen');
  if (op.type !== 'probe' && t.type === 'probe') throw new Error('Mit dem 3D-Taster kann nicht zerspant werden');
  const milling = !['drill', 'probe'].includes(op.type);
  if (milling && ['drill', 'tap', 'ream'].includes(t.type)) throw new Error('Mit diesem Werkzeug kann nicht gefräst werden');
  if (op.type === 'thread' && t.type !== 'thread') throw new Error('Für Gewindefräsen einen Gewindefräser wählen');
  const s = ctx.setup;
  // "Setup-Modell" row of the face manager adds to the stock to leave
  if (+op.modelRadial || +op.modelAxial) op = { ...op, stockToLeave: (+op.stockToLeave || 0) + (+op.modelRadial || 0), axialStock: (+op.axialStock || 0) + (+op.modelAxial || 0) };
  CUR = { project, op };
  SURF = OPS_3D.includes(op.type) ? surfaceFor(op, stock, ctx) : null;
  try { return generateOpInner(op, project, stock, ctx, t, s); } finally { SURF = null; CUR = null; }
}

// heightmaps of the face groups (geometry comes from main.js, in model coordinates)
function surfaceFor(op, stock, ctx) {
  const groups = (op.faceGroupGeo || []).filter(g => g.geometry && g.action !== 'ignore');
  if (!groups.length && !op.ignoreGeo) return null;
  const hm = ctx.heightmap(), res = hm.res;
  const xf = g => ({ geometry: g.clone().applyMatrix4(T) });
  const out = { base: op.ignoreGeo ? buildHeightmap([xf(op.ignoreGeo)], stock, res) : null, groups: [] };
  for (const g of groups) {
    const radial = Math.max(0, +g.radial || 0), axial = +g.axial || 0;
    if (g.action === 'machine' && !radial && !axial) continue; // same as the model
    out.groups.push({ hm: buildHeightmap([xf(g.geometry)], stock, res), radial, axial });
  }
  return out.base || out.groups.length ? out : null;
}

function generateOpInner(op, project, stock, ctx, t, s) {
  const h = opHeights(op, project, stock, s);
  const P = new Path(h.safe, h.retract);
  P.feedZ = h.feed;
  P.top = h.top;
  // linking ("Verknüpfung")
  if (op.retractPolicy === 'minimal') P.link = Math.min(h.retract, h.top + Math.max(0.1, +(op.safeDist ?? 1)));
  if (op.rapidRetract === false) { P.noRapidUp = true; P.upFeed = +op.highFeed || t.feed; }
  if (op.keepDown) { P.keepDown = true; P.keepDist = +op.keepDownDist || t.dia; P.lift = +op.liftHeight || 0; P.linkFeed = t.transitionFeed ?? t.feed; }
  let extra = {};
  if (op.type === 'rotary' || op.type === 'rotaryRough' || op.type === 'rotaryWrap') return genRotary(op, t, stock, ctx, h, project);
  switch (op.type) {
    case 'face': genFace(op, t, P, h, stock); break;
    case 'contour': extra = genContour(op, t, P, h, project) || {}; break;
    case 'pocket': extra = genPocket(op, t, P, h, project) || {}; break;
    case 'adaptive': genAdaptive(op, t, P, h, project, stock); break;
    case 'chamfer': genChamfer(op, t, P, h, project); break;
    case 'drill': extra = genDrill(op, t, P, h, project) || {}; break;
    case 'bore': genBore(op, t, P, h, project); break;
    case 'thread': genThread(op, t, P, h, project); break;
    case 'trace': genTrace(op, t, P, h, project); break;
    case 'rough3d': genRough3d(op, t, P, h, stock, ctx); break;
    case 'contour3d': genContour3d(op, t, P, h, stock, ctx); break;
    case 'horizontal3d': genHorizontal3d(op, t, P, h, stock, ctx); break;
    case 'steep3d': genSteep3d(op, t, P, h, stock, ctx); break;
    case 'scallop3d': genScallop3d(op, t, P, h, stock, ctx); break;
    case 'adaptive3d': genRough3d({ ...op, strategy: 'adaptive' }, t, P, h, stock, ctx); break;
    case 'pocket3d': genRough3d({ ...op, strategy: 'offset' }, t, P, h, stock, ctx); break;
    case 'flat3d': genFlat3d(op, t, P, h, stock, ctx); break;
    case 'ramp3d': genRamp3d(op, t, P, h, stock, ctx); break;
    case 'pencil3d': genPencil3d(op, t, P, h, stock, ctx); break;
    case 'morphspiral3d': genMorphSpiral3d(op, t, P, h, stock, ctx); break;
    case 'blend3d': genBlend3d(op, t, P, h, stock, ctx, project); break;
    case 'guidemorph3d': genGuideMorph3d(op, t, P, h, stock, ctx, project); break;
    case 'corner3d': genCorner3d(op, t, P, h, stock, ctx); break;
    case 'flow3d': genFlow3d(op, t, P, h, stock, ctx, project); break;
    case 'morph3d': genMorph3d(op, t, P, h, stock, ctx, project); break;
    case 'deburr3d': genDeburr3d(op, t, P, h, stock, ctx); break;
    case 'geodesic3d': genGeodesic3d(op, t, P, h, stock, ctx, project); break;
    case 'spiral3d': genSpiral3d(op, t, P, h, stock, ctx); break;
    case 'radial3d': genRadial3d(op, t, P, h, stock, ctx); break;
    case 'project3d': genProject3d(op, t, P, h, stock, ctx, project); break;
    case 'slot': genSlot(op, t, P, h, project); break;
    case 'plunge3d': extra = genPlunge3d(op, t, P, h, stock, ctx) || {}; break;
    case 'circular': genCircular(op, t, P, h, project); break;
    case 'vcarve': genVcarve(op, t, P, h, project); break;
    case 'parallel3d': genParallel3d(op, t, P, h, stock, ctx); break;
    case 'probe': extra = genProbe(op, t, P, project); break;
  }
  P.end();
  // a quarter of the operation's tolerance: arc fitting in the post (half of it) still accepts the thinned arcs
  let moves = leanMoves(rapidMode(P.m, op, h), Math.min(0.002, Math.max(0.0002, (+op.tolerance || 0.01) / 4)));
  // slower around sharp corners ("Vorschubanpassung"); never on drilling cycles and probing
  if (op.feedOpt && !['drill', 'probe', 'plunge3d'].includes(op.type)) {
    const cf = cornerFeed(moves, +op.feedOptAngle || 25, Math.min(0.95, Math.max(0.05, (+op.feedOptPct || 50) / 100)), +op.feedOptDist > 0 ? +op.feedOptDist : t.dia / 2);
    moves = cf.moves;
    extra = { ...extra, feedOpt: { corners: cf.corners } };
  }
  return { moves, heights: h, tool: t, ...extra, ...stats(moves, ctx.rapid) };
}

// Cutting data of the operation ("Werkzeug" tab); empty = from tool / preset
export const CUT_KEYS = ['rpm', 'rampRpm', 'feed', 'leadInFeed', 'leadOutFeed', 'transitionFeed', 'helixFeed', 'plunge'];
export function applyCutData(t, op) {
  const c = op.cut || {};
  const v = k => (c[k] != null && c[k] !== '' && Number.isFinite(+c[k]) ? +c[k] : null);
  const out = { ...t };
  for (const k of CUT_KEYS) if (v(k) != null) out[k] = v(k);
  out.rampRpm ??= out.rpm;
  out.leadInFeed ??= out.feed;
  out.leadOutFeed ??= out.feed;
  out.transitionFeed ??= out.feed;
  out.helixFeed ??= out.feed;
  return out;
}

// common CAD/CAM "Schnellvorschub-Modus": keep rapids, rapids only on retract/clearance height, or all as high feed
function rapidMode(moves, op, h) {
  const mode = op.rapidMode || 'preserve';
  if (mode === 'preserve') return moves;
  const hf = +op.highFeed || 5000;
  return moves.map(m => {
    if (m.t !== 'r') return m;
    if (mode === 'clearance' && m.z >= Math.min(h.retract, h.safe) - 1e-6) return m;
    return { ...m, t: 'f', f: hf, highFeed: true };
  });
}

// ---------- links over the remaining material ("Kürzester sicherer Weg") ----------
// The material as it stands while the setup is machined: a height field (top of stock or model per cell, never
// below the model), cut by every feed move. Cells count as cut only where the tool surely was, so the field
// errs on the side of more material.
class StockField {
  constructor(stock, model) {
    const res = this.res = Math.max(0.3, Math.min(1, Math.max(stock.maxX - stock.minX, stock.maxY - stock.minY) / 250));
    this.minX = stock.minX; this.minY = stock.minY;
    const nx = this.nx = Math.max(2, Math.round((stock.maxX - stock.minX) / res) + 1), ny = this.ny = Math.max(2, Math.round((stock.maxY - stock.minY) / res) + 1);
    const G = this.G = new Float32Array(nx * ny), M = this.M = new Float32Array(nx * ny).fill(-Infinity);
    const h2 = res / 2;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const x = stock.minX + i * res, y = stock.minY + j * res, k = j * nx + i;
      // the highest of the cell: its centre and corners (stock shapes and the model are sampled coarser or finer)
      let top = -Infinity, mt = -Infinity;
      for (const [dx, dy] of [[0, 0], [-h2, -h2], [h2, -h2], [-h2, h2], [h2, h2]]) {
        top = Math.max(top, stockTopAt(stock, Math.min(stock.maxX, Math.max(stock.minX, x + dx)), Math.min(stock.maxY, Math.max(stock.minY, y + dy))));
        if (model) {
          const mi = Math.round((x + dx - model.minX) / model.res), mj = Math.round((y + dy - model.minY) / model.res);
          for (let b = Math.max(0, mj - 1); b <= Math.min(model.ny - 1, mj + 1); b++) for (let a = Math.max(0, mi - 1); a <= Math.min(model.nx - 1, mi + 1); a++) mt = Math.max(mt, model.h[b * model.nx + a]);
        }
      }
      M[k] = mt;
      G[k] = Math.max(top, mt);
    }
  }
  // cutting profile of a tool: height above its tip at distance d from the axis
  static profile(tool) {
    const R = Math.max(0.05, (+tool.dia || 1) / 2), half = ((+tool.angle || 90) / 2) * (Math.PI / 180), tip = (+tool.tip || 0) / 2, cr = cornerOf(tool);
    if (tool.type === 'ball') return d => R - Math.sqrt(Math.max(0, R * R - d * d));
    if (tool.type === 'chamfer' || tool.type === 'drill' || tool.type === 'center' || tool.type === 'spot') return d => Math.max(0, d - tip) / Math.tan(half);
    if (cr > 0) return d => (d <= R - cr ? 0 : cr - Math.sqrt(Math.max(0, cr * cr - (d - (R - cr)) ** 2)));
    return () => 0;
  }
  cutMove(a, b, tool) {
    const { res, nx, ny, G, M, minX, minY } = this, R = Math.max(0.05, (+tool.dia || 1) / 2);
    let st = this.stamps?.get(tool);
    if (!st) {
      // only cells that lie inside the tool with half a cell to spare: the edge of the cut stays standing
      const prof = StockField.profile(tool), rc = Math.ceil(R / res), offs = [];
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) { const d = Math.hypot(di * res, dj * res) + res * 0.75; if (d <= R) offs.push(di, dj, prof(d)); }
      (this.stamps ||= new Map()).set(tool, (st = offs));
    }
    const L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(L / (res * 0.5)));
    for (let q = 0; q <= n; q++) {
      const x = a.x + ((b.x - a.x) * q) / n, y = a.y + ((b.y - a.y) * q) / n, z = a.z + ((b.z - a.z) * q) / n;
      const ci = Math.round((x - minX) / res), cj = Math.round((y - minY) / res);
      for (let o = 0; o < st.length; o += 3) {
        const i = ci + st[o], j = cj + st[o + 1];
        if (i < 0 || j < 0 || i >= nx || j >= ny) continue;
        const k = j * nx + i, v = Math.max(z + st[o + 2], M[k]);
        if (v < G[k]) G[k] = v;
      }
    }
  }
  // highest material under a tool of radius rad travelling straight from a to b
  maxAlong(ax, ay, bx, by, rad) {
    const { res, nx, ny, G, minX, minY } = this, rr = rad + res, rc = Math.ceil(rr / res);
    const L = Math.hypot(bx - ax, by - ay), n = Math.max(1, Math.ceil(L / (res * 0.5)));
    let top = -Infinity;
    for (let q = 0; q <= n; q++) {
      const x = ax + ((bx - ax) * q) / n, y = ay + ((by - ay) * q) / n;
      const ci = Math.round((x - minX) / res), cj = Math.round((y - minY) / res);
      for (let dj = -rc; dj <= rc; dj++) for (let di = -rc; di <= rc; di++) {
        const i = ci + di, j = cj + dj;
        if (i < 0 || j < 0 || i >= nx || j >= ny || Math.hypot(di * res, dj * res) > rr + res) continue;
        if (G[j * nx + i] > top) top = G[j * nx + i];
      }
    }
    return top;
  }
}

// Retracts between two cuts go only as high as the material left on the way needs (plus the safe distance)
// instead of up to the retract height: [up, across, down] runs of rapids are rewritten, everything else stays.
// The field is cut along the way, so material this operation has already removed counts as gone.
function shortLinks(moves, tool, field, safeDist, linkZ) {
  const out = [], n = moves.length;
  const R = Math.max(0.05, (+tool.dia || 1) / 2);
  let saved = 0, links = 0;
  let i = 0;
  while (i < n) {
    const m = moves[i], prev = out[out.length - 1];
    if (m.t !== 'r' || !prev || !Number.isFinite(prev.x)) {
      if (prev && m.t !== 'r' && Number.isFinite(m.x) && Number.isFinite(prev.x) && m.a == null) field.cutMove(prev, m, tool);
      out.push(m); i++;
      continue;
    }
    // run of rapids from A (= prev) to B
    let j = i;
    while (j + 1 < n && moves[j + 1].t === 'r') j++;
    const A = prev, B = moves[j], run = moves.slice(i, j + 1);
    const zTop = Math.max(...run.map(q => q.z));
    // shape: straight up at A, across at the top, straight down at B (nothing else is touched)
    const plain = Object.keys(B).every(k => 'txyz'.includes(k)) && run.every((q, k) => {
      const p0 = k ? run[k - 1] : A, dxy = Math.hypot(q.x - p0.x, q.y - p0.y);
      return dxy < 1e-6 || (Math.abs(q.z - zTop) < 1e-6 && Math.abs(p0.z - zTop) < 1e-6);
    });
    const dist = Math.hypot(B.x - A.x, B.y - A.y);
    if (plain && j + 1 < n && zTop >= linkZ - 1e-6 && dist > 1e-6 && A.z < zTop - 1e-6) {
      const need = field.maxAlong(A.x, A.y, B.x, B.y, R + 0.5) + safeDist;
      // a straight feed down follows at B: it may start right above the material instead of at B's height
      const nx = moves[j + 1], plunge = nx.t === 'f' && Math.hypot(nx.x - B.x, nx.y - B.y) < 1e-6 && nx.z < B.z - 1e-6;
      const zh = Math.max(A.z, plunge ? nx.z : B.z, need);
      if (Number.isFinite(zh) && zh < zTop - 0.5) {
        if (zh > A.z + 1e-6) out.push({ t: 'r', x: A.x, y: A.y, z: zh });
        out.push({ t: 'r', x: B.x, y: B.y, z: zh });
        if (B.z < zh - 1e-6) out.push({ t: 'r', x: B.x, y: B.y, z: B.z });
        saved += 2 * (zTop - zh) - 0; links++;
        i = j + 1;
        continue;
      }
    }
    for (const q of run) out.push(q);
    i = j + 1;
  }
  return { moves: out, links, saved };
}

// Material left after a milling setup, as a height field in that setup's frame: the stock shape cut by
// every toolpath (flat or ball end). Used as the stock of the next setup ("Von vorherigem Setup").
export function remainingStock(gen) {
  const s = gen?.stock;
  if (!s || gen.kind === 'turn') return null;
  const res = Math.max(0.3, Math.min(1, Math.max(s.maxX - s.minX, s.maxY - s.minY) / 250));
  const nx = Math.max(2, Math.round((s.maxX - s.minX) / res) + 1), ny = Math.max(2, Math.round((s.maxY - s.minY) / res) + 1);
  const h = new Float32Array(nx * ny);
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) h[j * nx + i] = stockTopAt(s, s.minX + i * res, s.minY + j * res);
  const cut = (x, y, z, R, ball) => {
    const i0 = Math.max(0, Math.floor((x - R - s.minX) / res)), i1 = Math.min(nx - 1, Math.ceil((x + R - s.minX) / res));
    const j0 = Math.max(0, Math.floor((y - R - s.minY) / res)), j1 = Math.min(ny - 1, Math.ceil((y + R - s.minY) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = s.minX + i * res - x, dy = s.minY + j * res - y, d2 = dx * dx + dy * dy;
      if (d2 > R * R) continue;
      const t = ball ? z + R - Math.sqrt(R * R - d2) : z, k = j * nx + i;
      if (h[k] > t) h[k] = t;
    }
  };
  for (const op of gen.ops || []) {
    const r = gen.results.get(op.id);
    if (op.enabled === false || !r || r.error || r.disabled || !r.moves?.length || !r.tool) continue;
    const R = Math.max(0.05, (+r.tool.dia || 1) / 2), ball = r.tool.type === 'ball';
    let a = null;
    for (const m of r.moves) {
      if (a) {
        const n = Math.min(5000, Math.max(1, Math.ceil(Math.hypot(m.x - a.x, m.y - a.y, m.z - a.z) / Math.max(res, R / 3))));
        for (let q = 1; q <= n; q++) cut(a.x + (m.x - a.x) * (q / n), a.y + (m.y - a.y) * (q / n), a.z + (m.z - a.z) * (q / n), R, ball);
      } else cut(m.x, m.y, m.z, R, ball);
      a = m;
    }
  }
  return { minX: s.minX, minY: s.minY, nx, ny, res, h, bottom: s.bottom };
}
// that material seen from above in another setup: Mi maps this setup's frame into the previous one
function projectRemaining(rem, Mi, st) {
  const res = Math.max(0.3, Math.min(1, Math.max(st.maxX - st.minX, st.maxY - st.minY) / 250));
  const nx = Math.max(2, Math.round((st.maxX - st.minX) / res) + 1), ny = Math.max(2, Math.round((st.maxY - st.minY) / res) + 1);
  const e = Mi.elements, h = new Float32Array(nx * ny).fill(-Infinity), hb = new Float32Array(nx * ny).fill(-Infinity);
  const inside = (x, y, z) => {
    const px = e[0] * x + e[4] * y + e[8] * z + e[12], py = e[1] * x + e[5] * y + e[9] * z + e[13], pz = e[2] * x + e[6] * y + e[10] * z + e[14];
    const i = Math.round((px - rem.minX) / rem.res), j = Math.round((py - rem.minY) / rem.res);
    if (i < 0 || j < 0 || i >= rem.nx || j >= rem.ny) return false;
    return pz > rem.bottom + 0.02 && pz < rem.h[j * rem.nx + i] - 0.02;
  };
  const dz = Math.min(res, 0.2), H = st.top - st.bottom;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = st.minX + i * res, y = st.minY + j * res;
    for (let k = 0; k * dz <= H + 1e-9; k++) {
      const z = st.top - k * dz;
      if (!inside(x, y, z)) continue;
      // refine the surface between the last empty and the first filled sample
      let lo = z, hi = Math.min(st.top, z + dz);
      if (k > 0) for (let it = 0; it < 6; it++) { const mid = (lo + hi) / 2; if (inside(x, y, mid)) lo = mid; else hi = mid; }
      h[j * nx + i] = lo;
      // where this piece of material ends downwards (air below it, e.g. under a thin skin)
      let kk = k + 1;
      while (kk * dz <= H + 1e-9 && inside(x, y, st.top - kk * dz)) kk++;
      hb[j * nx + i] = kk * dz <= H + 1e-9 ? st.top - kk * dz + dz / 2 : -Infinity;
      break;
    }
  }
  return { minX: st.minX, minY: st.minY, nx, ny, res, h, hb };
}

// Generates every operation of one setup in that setup's machine frame.
// bodies machined in a setup: the chosen ones (or all), never the fixtures
export function setupBodies(bodies, setup) {
  const fx = new Set(setup.fixtures || []);
  if (setup.stockMode === 'solid' && setup.stockBody) fx.add(setup.stockBody);
  let use = bodies.filter(b => !fx.has(b.id));
  if (Array.isArray(setup.bodies) && setup.bodies.length) use = use.filter(b => setup.bodies.includes(b.id));
  return use;
}

// Results of single operations, reused while nothing they depend on has changed (recomputes only the
// edited operation and the ones after it): key = model + setup/tools/sketches + all earlier ops of the setup + op.
const OP_CACHE = new Map(), OP_CACHE_MAX = 80;
const hashStr = str => {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) { const c = str.charCodeAt(i); h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36) + ':' + str.length;
};
// op fields that do not change the toolpath (and geometry objects that are described by other fields)
const opJson = op => JSON.stringify(op, (k, v) => (k === 'name' || k === 'faceGroupGeo' || k === 'ignoreGeo' || k === 'notes' ? undefined : v));
export function clearOpCache() { OP_CACHE.clear(); }

export function generateSetup(project, allBodies, setup, prevGen = null, modelKey = null) {
  const bodies = setupBodies(allBodies, setup);
  if (setup.kind === 'turn') {
    const m = findMachine(project, setup.machine);
    return generateTurnSetup(project, bodies, setup, m, m?.rapid || RAPID_FEED, { curves: (op, toolR) => liveCurves(op, project, toolR), manual: manualResult });
  }
  T = setupMatrix(setup);
  const results = new Map();
  const tBodies = bodies.map(b => ({ geometry: b.geometry.clone().applyMatrix4(T) }));
  const box = new THREE.Box3();
  for (const b of tBodies) { b.geometry.computeBoundingBox(); if (b.geometry.attributes.position.count) box.union(b.geometry.boundingBox); }
  const ops = project.cam.ops.filter(o => (o.setup || project.cam.setups[0].id) === setup.id);
  if (box.isEmpty()) return { stock: null, results, T, ops, error: 'Noch kein Körper vorhanden – erst in KONSTRUKTION modellieren.' };
  const hmRes = st => Math.max(0.25, Math.min(0.6, Math.max(st.maxX - st.minX, st.maxY - st.minY) / 300));
  const stock = computeStock(box, setup, { bodies: tBodies, all: allBodies, T, project, prevGen, heightmap: (bs, st) => buildHeightmap(bs, st, hmRes(st)) });
  const machine = findMachine(project, setup.machine);
  let hm = null;
  const ctx = {
    setup,
    bodies: tBodies,
    rapid: machine?.rapid || RAPID_FEED,
    heightmap: () => (hm ||= buildHeightmap(tBodies, stock, hmRes(stock))),
  };
  // everything an op can read besides itself and the earlier ops (null model key = no caching)
  const { ops: _o, ncPrograms: _n, ...camRest } = project.cam;
  let chain = modelKey == null ? null : hashStr(modelKey + '|' + (prevGen?.cacheKey || '') + '|' + JSON.stringify(camRest) + '|' + JSON.stringify(project.features) + '|' + JSON.stringify(machine || null));
  let hits = 0;
  // the material while the setup is machined (built when an operation asks for it): cut by the operations so far
  let field = null;
  const fieldUpTo = k => {
    field ||= Object.assign(new StockField(stock, ctx.heightmap()), { done: 0 });
    for (let q = field.done; q < k; q++) {
      const r = results.get(ops[q].id);
      if (!r || r.error || r.disabled || !r.moves?.length || !r.tool || r.rotary) continue;
      for (let w = 1; w < r.moves.length; w++) if (r.moves[w].t !== 'r' && Number.isFinite(r.moves[w - 1].x)) field.cutMove(r.moves[w - 1], r.moves[w], r.tool);
    }
    field.done = Math.max(field.done, k);
  };
  for (const op of ops) {
    if (chain) chain = hashStr(chain + opJson(op));
    if (op.enabled === false) { results.set(op.id, { moves: [], disabled: true }); continue; }
    const hit = chain && OP_CACHE.get(chain);
    if (hit) { OP_CACHE.delete(chain); OP_CACHE.set(chain, hit); results.set(op.id, hit); hits++; continue; }
    let res;
    try {
      const t0 = performance.now();
      ctx.prior = ops.slice(0, ops.indexOf(op)).map(o => results.get(o.id)).filter(Boolean);
      res = generateOp(op, project, stock, ctx);
      if (op.patKind && op.patKind !== 'none' && !res.rotary && !res.manual && op.type !== 'probe') {
        applyPattern(res, op, originOf(setup, stock));
        Object.assign(res, stats(res.moves, ctx.rapid));
      }
      // "Kürzester sicherer Weg": needs the material as it stands before this operation
      if (op.retractPolicy === 'stock' && res.moves?.length && res.tool && !res.rotary && op.type !== 'probe' && !(setup.fixtures || []).length) {
        fieldUpTo(ops.indexOf(op));
        const sl = shortLinks(res.moves, res.tool, field, Math.max(0.2, +(op.safeDist ?? 1)), res.heights?.retract ?? stock.top);
        field.done = ops.indexOf(op) + 1; // shortLinks has cut this operation into the field
        if (sl.links) { res.moves = sl.moves; Object.assign(res, stats(res.moves, ctx.rapid), { shortLinks: { n: sl.links, saved: sl.saved } }); }
      }
      res.calcMs = performance.now() - t0;
    } catch (err) {
      res = { error: err.message, moves: [] };
    }
    results.set(op.id, res);
    if (chain) {
      OP_CACHE.set(chain, res);
      while (OP_CACHE.size > OP_CACHE_MAX) OP_CACHE.delete(OP_CACHE.keys().next().value);
    }
  }
  tBodies.forEach(b => b.geometry.dispose());
  checkFixtures(allBodies, setup, results);
  return { stock, results, T, ops, machine, cacheKey: chain, cacheHits: hits };
}
