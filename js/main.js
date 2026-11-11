import * as THREE from 'three';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { state, onChange, commit, undo, redo, undoDepth, revertTo, setUndoLimit, persist, setProject, loadSaved, newProject, uid, nextName, feature, camOp, migrate, defaultSetup } from './state.js';
import { Viewport } from './viewport.js';
import { loadKernel, R as OC } from './kernel.js';
import { LANGS, lang as uiLang, setLanguage, t as tr, tHtml, deText, deAttr } from './i18n.js';
import { initUpdates, checkForUpdates } from './update.js';
import { setActiveKernel, activeKernelId, getKernel } from './kern/index.js';
import './kern/rust.js';
import { THREAD_SIZES, meshBody } from './model.js';
import { sheetBase, regenerate, regenerateAsync, estimateRegen, featureKey, sketchVisual, edgeMidpoint, edgeRefMatches, exportSTEP, bodyProps, interference, FEATURE_TYPES, OPS, SOLID_SOURCES, cylinderInfo, cylinderFaces, projectGeometry, clearTimelineCache } from './model.js';
import { Sketcher } from './sketcher.js';
import { buildHeightmap, cornerOf } from './heightmap.js';
import { generateSetup, stockTopAt, stockBotAt, opHeights, originOf, originLabel, orientationLabel, OP_TYPES, DRILL_CYCLES, ORIGINS, TOOL_TYPES, ORIENTATIONS, RAPID_FEED, setupMatrix, sketchHorizontalIn, OPS_3D, PROBE_MODES, MANUAL_KINDS, PATTERN_KINDS, orderByTool, opCells, toolBase, STOCK_MODES, STOCK_MATERIALS, BOUNDARY_MODES, setupBodies, heightSpec, HEIGHT_KEYS, HEIGHT_FROM, applyCutData } from './cam.js';
import { postProcess, runPost, allPosts, findPost, copyPost, setPostLibrary, SECTIONS, VARIABLES, POST_PROPS, POST_PROP_GROUPS, postProps, propApplies, propType, COOLANT_MODES } from './post.js';
import { allMachines, findMachine, copyMachine, newMachine, machineChecks, KIN_TYPES, kinAngles } from './machines.js';
import { StockSim, defaultFluteLen, defaultHolderDia, defaultStickout } from './sim.js';
import { exampleProject, exampleTurning } from './example.js';
import { describeEntity, entityPolys, translateEntity, rotateEntity, scaleEntity, mirrorEntity as mirrorAbout } from './profiles.js';
import { meshInertia } from './mesh.js';
import { applyCorners, cornerPlan } from './sketchcorner.js';
import { offsetEntities } from './sketchoffset.js';
import { parseDXF, writeDXF } from './dxf.js';
import { inkFromRGBA, traceImage, toSketch, toSVG, toEntities, quantize, inkOfColors, simplify as simplifyLine } from './trace.js';
import { loadFonts, FONTS } from './fonts.js';
import { solveSketch, lockedFields, sketchHandles, constraintFor, dimensionFor, dimBase, measure as measureDim, refKind, refEntity, CONSTRAINTS, GLYPH, DIM_KINDS } from './solver.js';
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';
import { BASE_PLANES, sketchPlane, planeLabel, planeOffset, planeFromFace, basis, toWorld, planeMatrix as planeMatrixOf, constructionPlane, planeRef, constructionAxis, BASE_AXES } from './plane.js';
import { resolveProject, paramScope, evalExpr } from './params.js';
import { ICONS } from './icons.js';
import { getSettings, saveSettings, resetSettings, DEFAULTS, MOUSE_PRESETS } from './settings.js';
import { getBlob, putBlob, loadBlobs, withBlobs, takeBlobs, igesToStep, stepToIges, onFullKernel, requestFullKernel, parseToolLibrary, convertCps } from './interop.js';
import { makeDrawing, SHEETS, VIEWS as DRAW_VIEWS } from './drawing.js';
import { bodyMatrix, hasAssembly, transformShape, JOINT_TYPES, JOINT_DOF, jointValues } from './assembly.js';
import { flatPattern, polyEdges, bendAllowance } from './sheetmetal.js';
import { TurnSim, TURN_OPS, turnCutShape, LatheStock } from './turning.js';
import { CylSim, CylStock, cylPartMap } from './cylstock.js';
import { WindowManager } from './windows.js';
import { ViewCube } from './viewcube.js';
import { ctxMenu } from './ctxmenu.js';
import { TOOL_CATALOG, CATALOG_LABEL, CATALOG_DEFAULTS, toolSvg2D, toolView3D, shaftDia, fluteLen, stickout, totalLen, shoulderLen, gaugeLen, holderSegments } from './tooldraw.js';
import { acceleratedRaycast, computeBoundsTree, disposeBoundsTree, MeshBVH } from 'three-mesh-bvh';
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;
import { SpaceMouse } from './spacemouse.js';
import { RenderStudio, ENVIRONMENTS, RENDER_DEFAULTS } from './render.js';
import { parseSTL, parseOBJ, weld as meshWeld, decodeMesh, encodeMesh, applyMatrix as meshApply, bounds as meshBounds, transform as meshTransform, flip as meshFlip, repair as meshRepair,
  smooth as meshSmooth, decimate as meshDecimate, cutPlane as meshCut, split as meshSplit, toGeometry as meshToGeometry, stats as meshStatsRaw, openEdgeLines as meshOpenEdgesRaw } from './mesh.js';
// analysis results are cached per mesh object
const meshMemo = (fn, wm = new WeakMap()) => m => { if (!wm.has(m)) wm.set(m, fn(m)); return wm.get(m); };
const meshStats = meshMemo(meshStatsRaw), meshOpenEdges = meshMemo(meshOpenEdgesRaw);
import { listDocs, storeCurrent, saveVersion, loadCurrent, loadVersion, renameDoc, deleteDoc, thumbnail } from './docs.js';

const $ = s => document.querySelector(s);

// ---------- DOM helpers ----------
function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2).toLowerCase(), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(String(c)));
  return el;
}

// Numeric input: plain arithmetic is stored as a number, anything with parameter
// names as an "=expr" string that stays parametric.
function num(value, set, opt = {}) {
  const isExpr = typeof value === 'string' && value.startsWith('=');
  const shown = value == null ? '' : isExpr ? value.slice(1) : value;
  const i = h('input', { type: 'text', inputmode: 'decimal', value: shown, placeholder: opt.ph ?? '', class: isExpr ? 'expr' : null, title: isExpr ? 'Ausdruck mit Parametern' : null, disabled: !!opt.disabled });
  i.addEventListener('change', () => {
    const s = i.value.trim().replace(/,/g, '.');
    if (s === '' && opt.allowEmpty) return set(null);
    const scope = paramScope(state.project);
    let v = evalExpr(s, scope);
    if (!Number.isFinite(v)) { status('Ungültiger Wert oder unbekannter Parameter'); i.value = shown; return; }
    if (/[A-Za-z_]/.test(s) && !opt.int) return set('=' + s);
    if (opt.min != null) v = Math.max(opt.min, v);
    if (opt.int) v = Math.round(v);
    set(+v.toFixed(4));
  });
  i.addEventListener('keydown', e => { if (e.key === 'Enter') i.blur(); });
  return opt.unit ? h('div', { class: 'unit' }, i, h('span', null, opt.unit)) : i;
}
const txt = (value, set) => {
  const i = h('input', { type: 'text', value });
  i.addEventListener('change', () => i.value.trim() && set(i.value.trim()));
  return i;
};
function sel(options, value, set) {
  const s = h('select', null, ...options.map(([v, l]) => h('option', { value: v, selected: String(v) === String(value) }, l)));
  s.addEventListener('change', () => set(s.value));
  return s;
}
const chk = (checked, set) => h('input', { type: 'checkbox', checked: !!checked, onchange: e => set(e.target.checked) });
const row = (label, ctl) => h('div', { class: 'row' }, h('label', null, label), ctl);
const sec = t => h('div', { class: 'sec' }, t);
const btn = (label, onClick, cls = '') => h('button', { class: 'btn ' + cls, onclick: onClick }, label);
const fmtTime = s => { if (!Number.isFinite(+s)) return "–"; s = Math.round(s); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let PREC = 2; // Anzeigegenauigkeit (Voreinstellungen)
const f2 = v => +(+v).toFixed(PREC);

function download(name, data, type) {
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const a = h('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
const safeName = () => state.project.name.replace(/[^\w\-äöüÄÖÜß ]/g, '_');

let toastTimer;
function status(msg) {
  $('#status').textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => ($('#status').textContent = ''), 5000);
}

function showBanner(content) {
  const el = $('#banner');
  el.replaceChildren();
  el.hidden = !content;
  if (content) el.append(...[].concat(content));
}

// ---------- theme ----------
const isDark = () => {
  const t = document.documentElement.dataset.theme;
  return t ? t === 'dark' : matchMedia('(prefers-color-scheme: dark)').matches;
};
function applyTheme() {
  const dark = isDark();
  vp.setTheme(dark);
  vp.grid.visible = gridOn;
  cube.setTheme(dark);
  matEdge.color.set(dark ? 0x0b0e11 : 0x1c2530);
  matBody.color.set(dark ? 0x9aa6b2 : 0xc3ccd5);
  rebuildScene();
}
$('#themeBtn').onclick = () => {
  const next = isDark() ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('openfab.theme', next); } catch { /* ignore */ }
  saveSettings({ theme: next });
  applyTheme();
  applySettings();
};

// ---------- core objects ----------
const vp = new Viewport($('#viewport'));
// RENDERN workspace: scene settings and the in-canvas render
const studio = new RenderStudio(vp);
const renderSettings = () => ({ ...RENDER_DEFAULTS, ...(state.project.render || {}) });
studio.onProgress = (n, running, done) => {
  let el = document.getElementById('renderInfo');
  if (!running) { el?.remove(); return; }
  if (!el) { el = document.createElement('div'); el.id = 'renderInfo'; $('#viewport').append(el); }
  const max = renderSettings().samples;
  el.innerHTML = '';
  el.append(h('span', { class: 'ri-dot' + (done ? ' done' : '') }), done ? `Fertig · ${n} Durchgänge` : `Rendern … ${n} / ${max}`,
    h('i', { class: 'ri-bar' }, h('b', { style: `width:${Math.min(100, (n / max) * 100)}%` })),
    h('button', { title: 'Bild speichern', onclick: saveRenderImage }, '⤓'), h('button', { title: 'In-Canvas-Rendern beenden', onclick: () => { studio.stop(); renderToolbar(); } }, '■'));
};
const tipEl = $('#cursorTip');
const sketcher = new Sketcher(vp, {
  changed: () => { renderProps(); renderToolbar(); rebuildScene(); },
  resolve: id => resolved().features.find(f => f.id === id),
  commitSketch: (id, fn) => commitSketch(id, fn),
  status: msg => status(msg),
  dragSolve: targets => {
    const rsk = resolved().features.find(f => f.id === state.sketchId);
    const res = solveSketch(rsk.entities, rsk.constraints || [], {}, { locked: lockedFields(feature(state.sketchId).entities), drag: targets });
    return rsk.entities.map(e => res.entities[e.id]);
  },
  commitDrag: ents => commitSketch(state.sketchId, sk => writeEntityValues(sk, Object.fromEntries(ents.map(e => [e.id, e])))),
  project: e => projectFaceAt(e),
  preview: () => rebuildScene(),
  overlay: () => refreshSketchOverlay(),
  corner: (kind, ref) => sketchCorner(kind, [ref]), offset: (id, sign) => sketchOffsetAt(id, sign), xform: (kind, data) => sketchXform(kind, data),
  addDim: d => createDim(d),
  evalNum: str => { const v = /^[-+]?[0-9.]+$/.test(str) ? +str : evalExpr(str, paramScope(state.project)); return Number.isFinite(v) ? v : NaN; },
  tip: (text, e) => {
    if (!text || !e) { tipEl.hidden = true; return; }
    const r = $('#viewportWrap').getBoundingClientRect();
    tipEl.hidden = false;
    tipEl.textContent = text;
    tipEl.style.left = e.clientX - r.left + 16 + 'px';
    tipEl.style.top = e.clientY - r.top + 14 + 'px';
  },
});
const stockSim = new StockSim(vp.sim);
const cylSim = new CylSim(vp.sim);
// stock model of the simulation: lathe profile, 4-axis cylinder map or 3-axis height field
const simStock = () => (sim.rot ? cylSim : sim.turn ? turnSim : stockSim);
const turnSim = new TurnSim(vp.sim);

// ---------- floating windows ----------
const wm = new WindowManager($('#main'));
wm.add($('#winBrowser'), B => ({ x: 8, y: 8, w: 250, h: Math.min(440, Math.round(B.h * 0.6)) }));
// below the view cube like the usual dialogs on the right
wm.add($('#winProps'), B => ({ x: Math.max(8, B.w - 348), y: 136, w: 340, h: Math.max(200, B.h - 210) }));
// docked along the bottom edge like the usual timeline
wm.add($('#winTimeline'), B => ({ x: 0, y: Math.max(8, B.h - 62), w: B.w, h: 62, dock: 'bottom' }));
wm.add($('#winTools'), B => ({ x: Math.max(8, Math.round((B.w - 960) / 2)), y: 36, w: Math.min(960, B.w - 16), h: Math.min(580, B.h - 60) }));
wm.add($('#winMachines'), B => ({ x: Math.max(8, Math.round((B.w - 820) / 2)), y: 50, w: Math.min(820, B.w - 16), h: Math.min(560, B.h - 70) }));
wm.add($('#winPost'), B => ({ x: 20, y: 20, w: Math.min(1180, B.w - 40), h: Math.max(300, B.h - 40) }));
wm.add($('#winDrawing'), B => ({ x: 16, y: 16, w: Math.min(1250, B.w - 32), h: Math.max(320, B.h - 32) }));
wm.add($('#winComments'), B => ({ x: 8, y: Math.max(8, B.h - 62 - 38), w: 260, h: 180, collapsed: true }));
wm.onChange = renderWindowMenu;

function renderWindowMenu() {
  const m = $('#windowMenu');
  m.replaceChildren();
  wm.wins.forEach(w => {
    const vis = !w.el.hidden;
    m.append(h('button', { onclick: () => { document.activeElement.blur(); if (w.forcedHidden) return status('Die Zeitachse gibt es nur in KONSTRUKTION.'); w.show(!vis); if (w.el.id === 'winTools' && !vis) renderToolLib(); } }, `${vis ? '✓' : '\u2003'} ${w.el.dataset.title}`));
  });
  m.append(h('hr'), h('button', { onclick: () => { document.activeElement.blur(); wm.reset(); renderToolLib(); } }, 'Layout zurücksetzen'));
}

const cube = new ViewCube($('#viewCube'), vp, n => { const box = getModel().box; vp.setViewDir(n, box.isEmpty() ? null : box); });
const cubeWrapEl = $('#cubeWrap');
// ViewCube arrows: turn the view by 90° around the screen axes, roll in top/bottom views
function turnView(kind) {
  const cam = vp.camera, t = vp.controls.target;
  cam.updateMatrixWorld();
  let d = cam.position.clone().sub(t).normalize();
  let up = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 1).normalize();
  const right = new THREE.Vector3().setFromMatrixColumn(cam.matrixWorld, 0).normalize();
  const rot = (axis, a) => { const q = new THREE.Quaternion().setFromAxisAngle(axis.clone(), a); d.applyQuaternion(q); up.applyQuaternion(q); };
  if (kind === 'left') rot(up, -Math.PI / 2);
  else if (kind === 'right') rot(up, Math.PI / 2);
  else if (kind === 'up') rot(right, -Math.PI / 2);
  else if (kind === 'down') rot(right, Math.PI / 2);
  else if (kind === 'rollCW' || kind === 'rollCCW') {
    if (vp.orbitMode !== 'free' && Math.abs(d.z) < 0.99) return status('Rollen in jeder Ansicht: unter Einstellungen → Navigation „Orbit: Frei“ wählen.');
    up.applyAxisAngle(d, kind === 'rollCW' ? Math.PI / 2 : -Math.PI / 2);
  }
  const snap = v => { const a = v.toArray(), m = Math.max(...a.map(Math.abs)); return new THREE.Vector3(...a.map(x => (Math.abs(x) > m - 1e-3 || Math.abs(x) > 0.3 ? Math.round(x * 1e6) / 1e6 : 0))).normalize(); };
  if (vp.orbitMode === 'free') {
    // free orbit: any orientation, the screen-up turns along (no Z-up correction)
    d = snap(d);
    up.addScaledVector(d, -up.dot(d));
    up = snap(up.normalize());
    const dist = cam.position.distanceTo(t);
    vp.animateTo(t.clone(), t.clone().addScaledVector(d, dist), 300, up);
    return;
  }
  // snap to the 26 cube directions
  d = new THREE.Vector3(...d.toArray().map(v => (Math.abs(v) < 1e-6 ? 0 : v))).normalize();
  if (Math.abs(d.z) > 0.999) {
    // looking straight up/down: the tiny offset decides which way is up on the screen
    const u = new THREE.Vector3(up.x, up.y, 0);
    if (u.lengthSq() < 1e-9) u.set(0, 1, 0);
    u.normalize();
    d = new THREE.Vector3(0, 0, Math.sign(d.z)).addScaledVector(u, -0.001 * Math.sign(d.z)).normalize();
  }
  vp.setViewDir(d, null, true);
}
document.querySelectorAll('#cubeWrap [data-turn]').forEach(b => b.addEventListener('click', e => { e.stopPropagation(); turnView(b.dataset.turn); }));
$('#cubeHome').onclick = () => fitView();

// ---------- SpaceMouse ----------
const spaceMouse = new SpaceMouse(vp, getSettings, {
  status: msg => status(msg),
  canRotate: () => !state.sketchId,
  action: a => {
    const box = getModel().box;
    const b = box.isEmpty() ? null : box;
    if (a === 'fit') fitView();
    else if (a === 'home') vp.setView('iso', b);
    else if (['top', 'front', 'right'].includes(a)) vp.setView(a, b);
    else if (a === 'search') openCommandSearch();
    else if (a === 'menu') { const r = vp.canvas.getBoundingClientRect(); openMarkingMenu(r.left + r.width / 2, r.top + r.height / 2); }
    else if (a === 'escape') window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  },
});
spaceMouse.autoConnect();

// ---------- view display mode ----------
let display = 'edges';
let appliedDisplayPref = null;
const matThread = new THREE.LineBasicMaterial({ color: 0xd08a1e });
let gridOn = true;
const matWire = new THREE.MeshBasicMaterial({ color: 0x8fa3b8, transparent: true, opacity: 0.06, depthWrite: false, side: THREE.DoubleSide });

// ---------- caches ----------
let resolvedCache = { key: null, p: null, info: {} };
function resolved() {
  const key = JSON.stringify([state.project.params, state.project.features, state.project.cam]);
  if (key !== resolvedCache.key) {
    const rp = resolveProject(state.project);
    // sketches on a construction plane follow it when the plane changes
    for (const f of rp.features) if (f.type === 'sketch' && f.planeRef) { const pl = planeRef(f.planeRef, rp.features); if (pl) f.plane = pl; }
    const info = {};
    // constrained sketches are re-solved so parameter-driven dimensions take effect
    for (const f of rp.features) {
      if (f.type !== 'sketch' || !f.entities.length) continue;
      const raw = feature(f.id);
      const res = solveSketch(f.entities, f.constraints || [], {}, { locked: lockedFields(raw.entities) });
      if (f.constraints?.length) f.entities = f.entities.map(e => res.entities[e.id]);
      info[f.id] = { dof: res.dof, unsatisfied: res.unsatisfied };
    }
    resolvedCache = { key, p: rp, info };
  }
  return resolvedCache.p;
}
const sketchInfo = id => (resolved(), resolvedCache.info[id] || { dof: 0, unsatisfied: [] });

const round6 = v => +(+v).toFixed(6);
// Copy solved numbers into the raw sketch, leaving parameter expressions alone.
function writeEntityValues(sk, solved) {
  for (const e of sk.entities) {
    const v = solved[e.id];
    if (!v) continue;
    for (const k of Object.keys(v)) {
      if (k === 'id' || k === 'type') continue;
      if (k === 'pts') e.pts = e.pts.map((pt, i) => pt.map((c, j) => (typeof c === 'string' ? c : round6(v.pts[i][j]))));
      else if (typeof e[k] === 'number') e[k] = round6(v[k]);
    }
  }
}

// Commit a sketch change and re-solve its constraints; pinned fields keep the typed value.
function commitSketch(id, fn, pin = []) {
  commit(p => {
    const sk = p.features.find(f => f.id === id);
    fn(sk);
    if (!sk.constraints?.length) return;
    const rsk = resolveProject(p).features.find(f => f.id === id);
    const locked = lockedFields(sk.entities);
    pin.forEach(k => locked.add(k));
    const res = solveSketch(rsk.entities, rsk.constraints, {}, { locked });
    writeEntityValues(sk, res.entities);
    if (res.unsatisfied.length) status(`⚠ ${res.unsatisfied.length} Abhängigkeit(en) nicht erfüllbar – Skizze überbestimmt oder widersprüchlich`);
  }, 'sketch');
}

// Features replayed: everything, the rollback position, or up to (excluding)
// the feature whose edges/faces are being picked.
function replayCount() {
  if (state.pick && (state.pick.mode === 'edges' || state.pick.mode === 'faces')) {
    const i = state.project.features.findIndex(f => f.id === state.pick.id);
    if (i >= 0) return i;
  }
  return state.rollback;
}

let model = { key: null, bodies: [], errors: {}, box: new THREE.Box3() };
// Long recomputations run feature by feature with pauses (the window stays usable, the previous model stays
// visible, a progress bar shows the current feature). A newer change cancels the running one; features
// finished so far stay in the timeline cache.
const ASYNC_MS = 600;
let regenJob = null;
function modelKey(rp, upTo) {
  return JSON.stringify([rp.features.map(featureKey), upTo, activeKernelId()]);
}
function installModel(key, r, t0) {
  model.bodies.forEach(b => { b.geometry.dispose(); b.edges.dispose(); });
  const box = new THREE.Box3();
  for (const b of r.bodies) {
    b.geometry.computeBoundingBox();
    if (b.geometry.attributes.position.count) box.union(b.geometry.boundingBox);
  }
  // BVH: hover highlighting and picking stay fast on large models.
  // "indirect" keeps the triangle order – faceOf (triangle → B-rep face) depends on it
  for (const b of r.bodies) { try { if (b.geometry.index && b.geometry.attributes.position.count) b.geometry.computeBoundsTree({ indirect: true }); } catch { /* raycast falls back */ } }
  model = { key, ...r, box, ms: performance.now() - t0 };
  syncProjections();
}
// Projected sketch geometry was brought up to date while the model was computed. The stored sketch gets the new
// picture too (not an undo step), so that dimensions and constraints attached to it are solved with it: that
// changes the project once more, and the next pass finds nothing left to do.
let projSync = 0;
function syncProjections() {
  if (state.sketchId || replayCount() != null) return;
  const rf = resolvedCache.p?.features || [];
  let changed = false;
  for (const f of rf) {
    if (f.type !== 'sketch' || f.suppressed || !f.entities?.some(e => e.proj)) continue;
    const raw = state.project.features.find(x => x.id === f.id);
    if (!raw) continue;
    const now = f.entities.filter(e => e.proj), was = raw.entities.filter(e => e.proj);
    if (JSON.stringify(now) === JSON.stringify(was)) continue;
    raw.entities = [...raw.entities.filter(e => !e.proj), ...JSON.parse(JSON.stringify(now))];
    changed = true;
  }
  if (!changed) { projSync = 0; return; }
  if (++projSync > 3) return; // never more than a few passes in a row
  persist();
  setTimeout(() => renderAll(), 0);
}
function getModel() {
  const rp = resolved();
  const upTo = replayCount();
  const key = modelKey(rp, upTo);
  if (key === model.key) return model;
  if (regenJob?.key === key) return model; // still computing: the previous state stays on screen
  if (regenJob) { regenJob.cancelled = true; regenJob = null; }
  const est = estimateRegen(rp, upTo);
  const t0 = performance.now();
  if (est.ms < ASYNC_MS) {
    installModel(key, regenerate(rp, upTo), t0);
    return model;
  }
  const job = { key, cancelled: false };
  regenJob = job;
  regenProgress({ i: est.start, n: est.total, name: '' }, est);
  regenerateAsync(rp, upTo, { onStep: st => regenProgress(st, est), cancelled: () => job.cancelled })
    .then(r => {
      if (job.cancelled || !r) return;
      regenJob = null;
      regenProgress(null);
      installModel(key, r, t0);
      renderAll();
    })
    .catch(err => {
      if (regenJob === job) regenJob = null;
      regenProgress(null);
      status('Berechnung fehlgeschlagen: ' + (err.message || err));
    });
  return model;
}
// progress bar at the bottom of the viewport
function regenProgress(st, est) {
  let el = document.getElementById('regenProgress');
  if (!st) { el?.remove(); return; }
  if (!el) {
    el = h('div', { id: 'regenProgress' }, h('span', { class: 'rp-spin' }), h('span', { class: 'rp-text' }), h('div', { class: 'rp-bar' }, h('div', { class: 'rp-fill' })));
    $('#viewportWrap').append(el);
  }
  const done = Math.max(0, st.i - (est?.start || 0)), all = Math.max(1, (st.n || 1) - (est?.start || 0));
  el.querySelector('.rp-text').textContent = st.type === 'mesh' ? 'Darstellung wird aufbereitet …' : st.name ? `Berechne „${st.name}“ · Feature ${st.i + 1} von ${st.n}` : 'Modell wird berechnet …';
  el.querySelector('.rp-fill').style.width = `${Math.min(100, Math.round((done / all) * 100))}%`;
}
const modelBusy = () => !!regenJob;

let camGen = { key: null };
function getCam() {
  const m = getModel();
  const rp = resolved();
  const meshes = getMeshes();
  const key = m.key + JSON.stringify(rp.cam) + meshes.key + JSON.stringify([...state.hiddenBodies]);
  if (key === camGen.key) return camGen;
  const camBodies = [...m.bodies, ...meshes.bodies.map(mb => ({ id: mb.id, geometry: mb.geometry }))];
  const camTools = rp.cam.tools.map(t => ({ ...t, kind: t.type, type: toolBase(t) || 'none' }));
  const setups = new Map(), results = new Map();
  // operations with picked model faces get a hidden sketch built from those faces
  let rpc = rp;
  const faceErr = new Map();
  if (rp.cam.ops.some(o => o.geomSource === 'model')) {
    const extra = [];
    const ops = rp.cam.ops.map(o => {
      if (o.geomSource !== 'model' || !FACE_OPS.includes(o.type)) return o;
      if (!o.faces?.length && !o.edges?.length) { faceErr.set(o.id, 'Keine Geometrie gewählt – Flächen oder Kanten im Modell anklicken'); return { ...o, sketch: '' }; }
      try {
        const sk = camFaceSketch(o, rp.cam.setups.find(x => x.id === o.setup) || rp.cam.setups[0], m.bodies);
        extra.push(sk);
        return { ...o, sketch: sk.id, entities: 'all' };
      } catch (err) { faceErr.set(o.id, err.message); return { ...o, sketch: '' }; }
    });
    rpc = { ...rp, features: [...rp.features, ...extra], cam: { ...rp.cam, ops } };
  }
  // machining boundary from picked faces / edges and the face groups of the face manager
  if (rpc.cam.ops.some(o => o.faceGroups?.length || o.boundary === 'selection')) {
    const extra2 = [];
    const ops2 = rpc.cam.ops.map(o => {
      let out = o;
      const st0 = rp.cam.setups.find(x => x.id === o.setup) || rp.cam.setups[0];
      if (o.boundary === 'selection') {
        if (o.boundaryFaces?.length || o.boundaryEdges?.length) {
          try {
            const sk = camFaceSketch({ ...o, type: 'flow3d', faces: o.boundaryFaces || [], edges: o.boundaryEdges || [] }, st0, m.bodies);
            sk.id = '__bnd_' + o.id;
            extra2.push(sk);
            out = { ...out, boundarySketch: sk.id, boundaryEntities: 'all' };
          } catch { /* nothing usable picked */ }
        } else if (o.boundarySketchSel) out = { ...out, boundarySketch: o.boundarySketchSel, boundaryEntities: 'all' };
      }
      if (o.faceGroups?.length) {
        out = { ...out, faceGroupGeo: o.faceGroups.map(g => ({ action: g.action, radial: g.radial, axial: g.axial, geometry: facesGeometry(g.faces || []) })) };
        const ign = o.faceGroups.filter(g => g.action === 'ignore').flatMap(g => g.faces || []);
        if (ign.length) out.ignoreGeo = bodiesWithoutFaces(setupBodies(m.bodies, st0), ign);
      }
      return out;
    });
    rpc = { ...rpc, features: [...rpc.features, ...extra2], cam: { ...rpc.cam, ops: ops2 } };
  }
  rpc = { ...rpc, cam: { ...rpc.cam, tools: camTools } };
  let prevG = null;
  for (const st of rp.cam.setups) {
    // the previous setup's result: its remaining material can be this setup's stock
    const g = generateSetup(rpc, camBodies, st, prevG, m.key + '|' + meshes.key + '|' + JSON.stringify([...state.hiddenBodies]));
    prevG = g;
    for (const [id, msg] of faceErr) { const r = g.results.get(id); if (r) { r.error = msg; r.moves = []; } }
    g.setup = st;
    setups.set(st.id, g);
    g.results.forEach((r, id) => results.set(id, r));
  }
  camGen = { key, setups, results };
  sim.segs = null;
  return camGen;
}

function activeSetupId() {
  const p = state.project;
  if (state.sel?.kind === 'setup' && p.cam.setups.some(x => x.id === state.sel.id)) return state.sel.id;
  if (state.sel?.kind === 'op') { const o = camOp(state.sel.id); if (o?.setup) return o.setup; }
  if (state.camSetup && p.cam.setups.some(x => x.id === state.camSetup)) return state.camSetup;
  return p.cam.setups[0].id;
}
const activeGen = () => getCam().setups.get(activeSetupId());
const activeSetupKind = () => state.project.cam.setups.find(x => x.id === activeSetupId())?.kind || 'mill';

// ---------- body appearance & section ----------
const MATERIALS = {
  alu: { label: 'Aluminium', density: 2.7, color: '#c3ccd5' },
  steel: { label: 'Stahl', density: 7.85, color: '#9aa3ad' },
  stainless: { label: 'Edelstahl', density: 8.0, color: '#b8bec4' },
  brass: { label: 'Messing', density: 8.5, color: '#d4b25c' },
  copper: { label: 'Kupfer', density: 8.96, color: '#c98258' },
  pom: { label: 'POM', density: 1.41, color: '#ececec' },
  pa: { label: 'PA6 (Nylon)', density: 1.14, color: '#e8e2d0' },
  pla: { label: 'PLA', density: 1.24, color: '#6fa8dc' },
  abs: { label: 'ABS', density: 1.05, color: '#5a5f66' },
  wood: { label: 'Holz (Buche)', density: 0.72, color: '#c89b6d' },
  mdf: { label: 'MDF', density: 0.75, color: '#b08b5b' },
};
// common CAD/CAM-like appearance library: colour + surface (metal, gloss, clear coat, transparency)
const APPEARANCES = {
  alu_polished: { group: 'Metall', label: 'Aluminium poliert', color: '#d9dee3', metalness: 1, roughness: 0.12 },
  alu_satin: { group: 'Metall', label: 'Aluminium satiniert', color: '#c3ccd5', metalness: 0.85, roughness: 0.32 },
  alu_anod_black: { group: 'Metall', label: 'Aluminium eloxiert schwarz', color: '#2b2f34', metalness: 0.7, roughness: 0.35 },
  alu_anod_blue: { group: 'Metall', label: 'Aluminium eloxiert blau', color: '#2f6fb3', metalness: 0.7, roughness: 0.32 },
  alu_anod_red: { group: 'Metall', label: 'Aluminium eloxiert rot', color: '#b8333a', metalness: 0.7, roughness: 0.32 },
  steel: { group: 'Metall', label: 'Stahl', color: '#9aa3ad', metalness: 0.9, roughness: 0.38 },
  stainless: { group: 'Metall', label: 'Edelstahl gebürstet', color: '#b8bec4', metalness: 0.95, roughness: 0.26 },
  chrome: { group: 'Metall', label: 'Chrom', color: '#eef1f4', metalness: 1, roughness: 0.04 },
  gold: { group: 'Metall', label: 'Gold', color: '#e3b84f', metalness: 1, roughness: 0.15 },
  brass: { group: 'Metall', label: 'Messing', color: '#d4b25c', metalness: 0.95, roughness: 0.22 },
  copper: { group: 'Metall', label: 'Kupfer', color: '#c98258', metalness: 0.95, roughness: 0.22 },
  cast_iron: { group: 'Metall', label: 'Gusseisen', color: '#5e6266', metalness: 0.6, roughness: 0.75 },
  plastic_white: { group: 'Kunststoff', label: 'Kunststoff weiß glänzend', color: '#f2f2f0', metalness: 0, roughness: 0.25, clearcoat: 0.6 },
  plastic_black: { group: 'Kunststoff', label: 'Kunststoff schwarz matt', color: '#222428', metalness: 0, roughness: 0.7 },
  plastic_red: { group: 'Kunststoff', label: 'Kunststoff rot', color: '#d1342f', metalness: 0, roughness: 0.3, clearcoat: 0.5 },
  plastic_blue: { group: 'Kunststoff', label: 'Kunststoff blau', color: '#2f7bd1', metalness: 0, roughness: 0.3, clearcoat: 0.5 },
  plastic_green: { group: 'Kunststoff', label: 'Kunststoff grün', color: '#3aa856', metalness: 0, roughness: 0.3, clearcoat: 0.5 },
  plastic_yellow: { group: 'Kunststoff', label: 'Kunststoff gelb', color: '#f2c230', metalness: 0, roughness: 0.3, clearcoat: 0.5 },
  plastic_orange: { group: 'Kunststoff', label: 'Kunststoff orange', color: '#f07a1e', metalness: 0, roughness: 0.3, clearcoat: 0.5 },
  rubber: { group: 'Kunststoff', label: 'Gummi', color: '#2c2d30', metalness: 0, roughness: 0.95 },
  paint_red: { group: 'Lack', label: 'Lack rot glänzend', color: '#c4161c', metalness: 0.1, roughness: 0.2, clearcoat: 1 },
  paint_blue: { group: 'Lack', label: 'Lack blau metallic', color: '#1e4f9c', metalness: 0.6, roughness: 0.3, clearcoat: 1 },
  paint_black: { group: 'Lack', label: 'Lack schwarz glänzend', color: '#111215', metalness: 0.1, roughness: 0.15, clearcoat: 1 },
  paint_white: { group: 'Lack', label: 'Lack weiß', color: '#f4f4f2', metalness: 0.05, roughness: 0.2, clearcoat: 1 },
  paint_orange: { group: 'Lack', label: 'Lack orange (Maschine)', color: '#e8731c', metalness: 0.1, roughness: 0.3, clearcoat: 0.8 },
  glass: { group: 'Sonstige', label: 'Glas klar', color: '#dbeef5', metalness: 0, roughness: 0.03, opacity: 0.28, clearcoat: 1 },
  glass_smoke: { group: 'Sonstige', label: 'Glas getönt', color: '#5b6670', metalness: 0, roughness: 0.05, opacity: 0.45, clearcoat: 1 },
  acrylic_blue: { group: 'Sonstige', label: 'Acryl blau transparent', color: '#4c9be8', metalness: 0, roughness: 0.08, opacity: 0.5, clearcoat: 1 },
  wood: { group: 'Sonstige', label: 'Holz (Buche)', color: '#c89b6d', metalness: 0, roughness: 0.65 },
  wood_dark: { group: 'Sonstige', label: 'Holz (Nuss)', color: '#6e4a2e', metalness: 0, roughness: 0.6, clearcoat: 0.3 },
  mdf: { group: 'Sonstige', label: 'MDF', color: '#b08b5b', metalness: 0, roughness: 0.85 },
  concrete: { group: 'Sonstige', label: 'Beton', color: '#9d9a94', metalness: 0, roughness: 0.95 },
};
// physical material → default appearance
const MATERIAL_LOOK = { alu: 'alu_satin', steel: 'steel', stainless: 'stainless', brass: 'brass', copper: 'copper', pom: 'plastic_white', pa: 'plastic_white', pla: 'plastic_blue', abs: 'plastic_black', wood: 'wood', mdf: 'mdf' };
const bodyMeta = id => state.project.bodyMeta?.[id] || {};
const bodyLabel = id => { const b = getModel().bodies.find(x => x.id === id); return b ? bodyName(b) : id; };
const bodyName = b => bodyMeta(b.id).name || b.name;
const bodyMats = new Map();
// ---------- analysis (Zebra, Formschräge) ----------
const analysis = { mode: null, dir: [0, 0, 1], min: 1 };
const zebraMat = new THREE.ShaderMaterial({
  uniforms: { stripes: { value: 7 } },
  vertexShader: 'varying vec3 vN; varying vec3 vP; void main(){ vN = normalize(normalMatrix * normal); vec4 mv = modelViewMatrix * vec4(position, 1.0); vP = mv.xyz; gl_Position = projectionMatrix * mv; }',
  fragmentShader: 'uniform float stripes; varying vec3 vN; varying vec3 vP; void main(){ vec3 r = reflect(normalize(vP), normalize(vN)); float s = smoothstep(0.45, 0.55, abs(fract(r.y * stripes) - 0.5) * 2.0); gl_FragColor = vec4(mix(vec3(0.07), vec3(0.96), s), 1.0); }',
  side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});
const draftMat = new THREE.ShaderMaterial({
  uniforms: { dir: { value: new THREE.Vector3(0, 0, 1) }, minA: { value: Math.sin(Math.PI / 180) } },
  vertexShader: 'varying vec3 vW; void main(){ vW = normalize(mat3(modelMatrix) * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
  fragmentShader: 'uniform vec3 dir; uniform float minA; varying vec3 vW; void main(){ float d = dot(normalize(vW), normalize(dir)); vec3 c = d >= minA ? vec3(0.18, 0.66, 0.30) : d <= -minA ? vec3(0.84, 0.25, 0.25) : vec3(0.95, 0.78, 0.15); gl_FragColor = vec4(c * (0.75 + 0.25 * abs(d)), 1.0); }',
  side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
});

function analysisBanner() {
  if (analysis.mode === 'zebra') {
    const r = h('input', { type: 'range', min: 2, max: 20, step: 1, value: zebraMat.uniforms.stripes.value, style: 'width:140px' });
    r.oninput = () => { zebraMat.uniforms.stripes.value = +r.value; };
    showBanner(['Zebra-Analyse: Knick in den Streifen = Kante, versetzte Streifen = nur tangential.', 'Dichte', r, h('button', { onclick: () => setAnalysis(null) }, 'Schließen')]);
  } else if (analysis.mode === 'draft') {
    const dirSel = sel([['0,0,1', '+Z'], ['0,0,-1', '−Z'], ['1,0,0', '+X'], ['-1,0,0', '−X'], ['0,1,0', '+Y'], ['0,-1,0', '−Y']], analysis.dir.join(','), v => { analysis.dir = v.split(',').map(Number); draftMat.uniforms.dir.value.set(...analysis.dir); rebuildScene(); });
    const minIn = h('input', { type: 'number', value: analysis.min, min: 0, max: 45, step: 0.5, style: 'width:56px' });
    minIn.onchange = () => { analysis.min = Math.max(0, +minIn.value || 0); draftMat.uniforms.minA.value = Math.sin(analysis.min * Math.PI / 180); rebuildScene(); };
    showBanner(['Formschräge-Analyse · Entformung', dirSel, 'min.', minIn, '°  ',
      h('span', { style: 'color:#2fa84e' }, '■ entformbar'), h('span', { style: 'color:#f2c726' }, '■ zu steil'), h('span', { style: 'color:#d64040' }, '■ Hinterschnitt'),
      h('button', { onclick: () => setAnalysis(null) }, 'Schließen')]);
  }
}
function setAnalysis(mode) {
  analysis.mode = analysis.mode === mode ? null : mode;
  if (analysis.mode) analysisBanner(); else showBanner(null);
  renderToolbar();
  rebuildScene();
}

let camMats = null;
function bodyMaterial(id) {
  if (analysis.mode === 'zebra' && state.workspace === 'design') return zebraMat;
  if (analysis.mode === 'draft' && state.workspace === 'design') {
    draftMat.uniforms.dir.value.set(...analysis.dir);
    draftMat.uniforms.minA.value = Math.sin(analysis.min * Math.PI / 180);
    return draftMat;
  }
  if (state.workspace === 'cam') {
    camMats ||= (() => {
      const fx = matBody.clone(); fx.color.set(0x9b7a45);
      const un = matBody.clone(); un.transparent = true; un.opacity = 0.25; un.depthWrite = false;
      const pk = matBody.clone(); pk.color.set(0x4aa3ff);
      return { fx, un, pk };
    })();
    const st = state.project.cam.setups.find(x => x.id === activeSetupId());
    if (st?.fixtures?.includes(id)) return camMats.fx;
    if (st?.bodies?.length && !st.bodies.includes(id)) return camMats.un;
    if (st?.access && dialogTarget()?.kind === 'setup' && st.kind !== 'turn') {
      draftMat.uniforms.dir.value.copy(setupUp(st));
      draftMat.uniforms.minA.value = 0.0087;
      return draftMat;
    }
    if (state.pick?.mode === 'setupBodies' && st?.bodies?.includes(id)) return camMats.pk;
  }
  const meta = bodyMeta(id);
  const look = APPEARANCES[meta.appearance] || (meta.material ? APPEARANCES[MATERIAL_LOOK[meta.material]] : null);
  if (!look && !meta.color) return matBody;
  return appearanceMat(look || APPEARANCES.alu_satin, meta.color);
}
function appearanceMat(look, color = null) {
  const key = JSON.stringify([look, color]);
  if (!bodyMats.has(key)) {
    const opacity = look.opacity ?? 1;
    bodyMats.set(key, new THREE.MeshPhysicalMaterial({
      color: color || look.color, metalness: look.metalness ?? 0.5, roughness: look.roughness ?? 0.3,
      clearcoat: look.clearcoat ?? 0.25, clearcoatRoughness: 0.1, envMapIntensity: 1.25,
      transparent: opacity < 1, opacity, depthWrite: opacity >= 1,
      side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1,
    }));
  }
  return bodyMats.get(key);
}

// ---------- appearance panel (A) ----------
// Swatches are dragged onto a body, or clicked to apply to the selected body (no selection = all bodies).
let appPanel = null;
function swatchCss(look) {
  const c = new THREE.Color(look.color), hl = c.clone().lerp(new THREE.Color('#ffffff'), look.metalness > 0.5 ? 0.85 : 0.6 - (look.roughness || 0) * 0.4), dk = c.clone().multiplyScalar(look.metalness > 0.5 ? 0.35 : 0.55);
  const a = look.opacity ?? 1;
  const rgba = (x, k = a) => `rgba(${Math.round(x.r * 255)},${Math.round(x.g * 255)},${Math.round(x.b * 255)},${k})`;
  return `background: radial-gradient(circle at 34% 30%, ${rgba(hl, Math.min(1, a + 0.4))} 0, ${rgba(c)} ${look.roughness > 0.6 ? 55 : 38}%, ${rgba(dk)} 100%)`;
}
function applyAppearance(key, bodyIds) {
  const ids = bodyIds?.length ? bodyIds : getModel().bodies.map(b => b.id);
  if (!ids.length) return status('Kein Körper vorhanden.');
  commit(p => { p.bodyMeta ||= {}; for (const id of ids) { const m = (p.bodyMeta[id] ||= {}); if (key) m.appearance = key; else delete m.appearance; delete m.color; } }, 'meta');
  status(key ? `Darstellung „${APPEARANCES[key].label}“ auf ${ids.length} Körper angewendet.` : 'Darstellung zurückgesetzt (vom Material).');
}
function openAppearance() {
  if (appPanel) { appPanel.remove(); appPanel = null; return; }
  const selBody = () => (state.sel?.kind === 'body' ? [state.sel.id] : []);
  const used = () => [...new Set(getModel().bodies.map(b => bodyMeta(b.id).appearance || MATERIAL_LOOK[bodyMeta(b.id).material || 'alu']).filter(Boolean))];
  const sw = key => {
    const look = APPEARANCES[key];
    const el = h('button', { class: 'app-sw', title: `${look.label} – auf Körper ziehen oder klicken`, draggable: 'true', onclick: () => applyAppearance(key, selBody()) },
      h('span', { class: 'app-ball', style: swatchCss(look) }), h('span', { class: 'app-lbl' }, look.label));
    el.addEventListener('dragstart', ev => { ev.dataTransfer.setData('text/x-openfab-appearance', key); ev.dataTransfer.effectAllowed = 'copy'; });
    return el;
  };
  const body = h('div', { class: 'app-body' });
  const draw = () => {
    body.replaceChildren(
      h('div', { class: 'app-sec' }, 'IN DIESEM DESIGN'), h('div', { class: 'app-grid' }, ...used().map(sw)),
      h('div', { class: 'app-hint' }, state.sel?.kind === 'body' ? 'Klick: auf den gewählten Körper anwenden · Ziehen: auf einen Körper' : 'Auf einen Körper ziehen – oder klicken für alle Körper'),
      ...[...new Set(Object.values(APPEARANCES).map(a => a.group))].flatMap(g => [h('div', { class: 'app-sec' }, g.toUpperCase()), h('div', { class: 'app-grid' }, ...Object.keys(APPEARANCES).filter(k => APPEARANCES[k].group === g).map(sw))]),
      h('div', { class: 'app-foot' }, h('button', { onclick: () => applyAppearance(null, selBody()) }, 'Zurücksetzen (vom Material)'), h('button', { class: 'primary', onclick: () => { appPanel.remove(); appPanel = null; } }, 'Schließen')),
    );
  };
  appPanel = h('div', { class: 'app-panel' }, h('div', { class: 'app-head' }, h('b', null, 'DARSTELLUNG'), h('button', { class: 'pd-x', title: 'Schließen', onclick: () => { appPanel.remove(); appPanel = null; } }, '✕')), body);
  appPanel.redraw = draw;
  draw();
  document.body.append(appPanel);
}
// dropping a swatch on a body
vp.canvas.addEventListener('dragover', e => { if ([...e.dataTransfer.types].includes('text/x-openfab-appearance')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
vp.canvas.addEventListener('drop', e => {
  const key = e.dataTransfer.getData('text/x-openfab-appearance');
  if (!key) return;
  e.preventDefault();
  const hit = vp.raycast(e, vp.model.children.filter(o => o.isMesh))[0];
  const b = hit && getModel().bodies[hit.object.userData.body];
  if (!b) return status('Darstellung auf einen Körper ziehen.');
  applyAppearance(key, [b.id]);
});

// ---------- press / pull (Q) ----------
// common CAD/CAM "Drücken/Ziehen": a planar face is pushed or pulled (face extrusion), an edge is rounded.
function startPressPull() {
  if (!getModel().bodies.length) return status('Kein Körper vorhanden.');
  state.pick = { mode: 'presspull' };
  showBanner(['Drücken/Ziehen: ebene Fläche anklicken (verschieben) oder Kante anklicken (verrunden).', h('button', { onclick: () => { state.pick = null; showBanner(null); renderAll(); } }, 'Abbrechen')]);
  renderAll();
}
function pressPullPick(e, meshes, m) {
  const hit = vp.raycast(e, meshes)[0];
  const eh = vp.raycast(e, edgePickObjects(), 6)[0];
  const p = state.project;
  if (eh && (!hit || eh.distance <= hit.distance + vp.worldPerPixel() * 6)) {
    const eb = m.bodies[eh.object.userData.body], ei = eb.segEdge[Math.floor(eh.index / 2)];
    state.pick = null; showBanner(null);
    const id = uid('fi');
    pendingNew = { id, depth: undoDepth() };
    insertFeature({ id, type: 'fillet', name: nextName(p.features, FEATURE_TYPES.fillet), radius: 2, edges: [edgeMidpoint(eb, ei)], all: false });
    state.sel = { kind: 'feature', id };
    togglePick('edges', id);
    return;
  }
  if (!hit) return status('Ebene Fläche oder Kante anklicken.');
  const body = m.bodies[hit.object.userData.body], fid = body.faceOf[hit.faceIndex];
  const gt = body.shape?.faces?.[fid]?.geomType;
  if (gt && gt !== 'PLANE') return status('Drücken/Ziehen geht bei ebenen Flächen – für Kanten die Kante anklicken.');
  state.pick = null; showBanner(null);
  const id = uid('ex');
  pendingNew = { id, depth: undoDepth() };
  insertFeature({ id, type: 'extrude', name: nextName(p.features, FEATURE_TYPES.extrude), source: 'faces', faces: [faceRefPoint(body, hit.faceIndex)], extent: 'one', distance: 5, distance2: 5, op: 'auto' });
  state.sel = { kind: 'feature', id };
  renderAll();
  status('Am blauen Pfeil ziehen oder Abstand eingeben – negativ drückt die Fläche ins Material.');
}

let lastClipCount = 0;
let sketchSlice = false; // "Schnitt" of the sketch palette: hide what lies in front of the sketch plane
function applySection() {
  const sct = state.section;
  let planes = null;
  if (sct) {
    const n = new THREE.Vector3(...{ x: [1, 0, 0], y: [0, 1, 0], z: [0, 0, 1] }[sct.axis]).multiplyScalar(sct.flip ? 1 : -1);
    planes = [new THREE.Plane(n, sct.flip ? -sct.offset : sct.offset)];
  }
  if (sketchSlice && state.sketchId) {
    const sk = resolved().features.find(f => f.id === state.sketchId);
    if (sk) { const B = basis(sk); (planes ||= []).push(new THREE.Plane(B.n.clone().negate(), B.n.dot(B.o) + 0.001)); }
  }
  const count = planes ? planes.length : 0;
  for (const m of [matBody, matGhost, matEdge, matEdgeGhost, matMesh, matMeshSel, ...bodyMats.values()]) {
    m.clippingPlanes = planes;
    if (count !== lastClipCount) m.needsUpdate = true;
  }
  lastClipCount = count;
}

// ---------- scene ----------
// glossy, slightly metallic workpiece (reflects the studio environment, see viewport.js)
const matBody = new THREE.MeshPhysicalMaterial({ color: 0xc3ccd5, metalness: 0.5, roughness: 0.24, clearcoat: 0.5, clearcoatRoughness: 0.12, envMapIntensity: 1.25, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const matGhost = new THREE.MeshStandardMaterial({ color: 0x8fa3b8, transparent: true, opacity: 0.18, depthWrite: false, side: THREE.DoubleSide });
const matEdge = new THREE.LineBasicMaterial({ color: 0x1c2530 });
const matEdgeGhost = new THREE.LineBasicMaterial({ color: 0x1c2530, transparent: true, opacity: 0.25 });
// selection = light blue, pre-highlight under the mouse = black edges
const matEdgeSel = new THREE.LineBasicMaterial({ color: 0x9fdcff, depthTest: false, transparent: true });
const matMeasure = new THREE.LineBasicMaterial({ color: 0xff7a00, depthTest: false, transparent: true });

// ---------- face selection (highlighted like in CAD programs) ----------
const matFaceSel = new THREE.MeshBasicMaterial({ color: 0x9fdcff, transparent: true, opacity: 0.88, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
const matFaceHover = new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const _tri = new THREE.Triangle(), _fq = new THREE.Vector3(), _fp = new THREE.Vector3();
let faceCache = { key: null, map: new Map() };
// B-rep face of the model that contains a stored pick point
function faceAt(pt, tol = 0.5) {
  const m = getModel();
  if (faceCache.key !== m.key) faceCache = { key: m.key, map: new Map() };
  const k = pt.join(',');
  if (faceCache.map.has(k)) return faceCache.map.get(k);
  _fp.set(...pt);
  let best = null, bd = tol;
  for (const [bi, b] of m.bodies.entries()) {
    const bb = b.geometry.boundingBox;
    if (bb && bb.distanceToPoint(_fp) > tol) continue;
    const idx = b.geometry.index.array, pos = b.geometry.attributes.position;
    for (let t = 0; t < b.faceOf.length; t++) {
      _tri.a.fromBufferAttribute(pos, idx[t * 3]); _tri.b.fromBufferAttribute(pos, idx[t * 3 + 1]); _tri.c.fromBufferAttribute(pos, idx[t * 3 + 2]);
      _tri.closestPointToPoint(_fp, _fq);
      const d = _fq.distanceTo(_fp);
      if (d < bd) { bd = d; best = { bi, body: b, fid: b.faceOf[t] }; }
    }
  }
  faceCache.map.set(k, best);
  return best;
}
// mesh of one B-rep face (shares the body's vertex buffer)
function faceMesh(body, fid, mat) {
  const idx = body.geometry.index.array, sub = [];
  for (let t = 0; t < body.faceOf.length; t++) if (body.faceOf[t] === fid) sub.push(idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]);
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', body.geometry.attributes.position);
  g.setIndex(sub);
  const mesh = new THREE.Mesh(g, mat);
  mesh.renderOrder = 6;
  mesh.userData.cached = true;
  return mesh;
}
// Boundary loops of a face as 3D points (outer contour and holes), from the exact B-rep wires;
// the triangle mesh is only the fallback (it can lose pieces of the boundary).
let loopCache = { key: null, map: new Map() };
// Points of a wire, in order: the edges come in no particular order from the kernel,
// so they are chained by their end points (an edge is reversed when it runs the other way).
function wirePoints(wire) {
  const segs = [];
  for (const ed of wire.edges) {
    const line = ed.geomType === 'LINE';
    const n = line ? 1 : Math.max(8, Math.min(96, Math.ceil((ed.length || 10) / 0.5)));
    const seg = [];
    for (let k = 0; k <= n; k++) { const q = ed.pointAt(k / n); seg.push(new THREE.Vector3(q.x, q.y, q.z)); }
    segs.push(seg);
  }
  if (!segs.length) return [];
  const span = segs.reduce((m, sg) => Math.max(m, sg[0].distanceTo(sg[sg.length - 1])), 0);
  const tol = Math.max(1e-4, span * 1e-4, 0.002);
  const pts = segs.shift().slice();
  while (segs.length) {
    const end = pts[pts.length - 1];
    let bi = -1, rev = false, bd = Infinity;
    segs.forEach((sg, i) => {
      const d0 = sg[0].distanceTo(end), d1 = sg[sg.length - 1].distanceTo(end);
      if (d0 < bd) { bd = d0; bi = i; rev = false; }
      if (d1 < bd) { bd = d1; bi = i; rev = true; }
    });
    if (bi < 0 || bd > Math.max(tol, 0.05)) break; // not connected (should not happen in a closed wire)
    const sg = segs.splice(bi, 1)[0];
    if (rev) sg.reverse();
    pts.push(...sg.slice(1));
  }
  if (pts.length > 2 && pts[0].distanceTo(pts[pts.length - 1]) < tol) pts.pop();
  return pts;
}
function faceWires(body, fid) {
  const fc = body.shape?.faces?.[fid];
  if (!fc) return null;
  try { return fc.wires; } catch { return null; }
}
function faceLoops3D(body, fid) {
  const m = getModel();
  if (loopCache.key !== m.key) loopCache = { key: m.key, map: new Map() };
  const ck = body.id + ':' + fid;
  if (loopCache.map.has(ck)) return loopCache.map.get(ck);
  let loops = null;
  const wires = faceWires(body, fid);
  if (wires) try { loops = wires.map(wirePoints).filter(l => l.length >= 3); } catch { loops = null; }
  if (!loops || !loops.length) loops = faceLoopsMesh(body, fid);
  loopCache.map.set(ck, loops);
  return loops;
}
function faceLoopsMesh(body, fid) {
  const idx = body.geometry.index.array, pos = body.geometry.attributes.position.array;
  const key = i => `${pos[i * 3].toFixed(4)},${pos[i * 3 + 1].toFixed(4)},${pos[i * 3 + 2].toFixed(4)}`;
  const count = new Map(), pts = new Map();
  for (let t = 0; t < body.faceOf.length; t++) {
    if (body.faceOf[t] !== fid) continue;
    for (let k = 0; k < 3; k++) {
      const a = idx[t * 3 + k], b = idx[t * 3 + ((k + 1) % 3)];
      const ka = key(a), kb = key(b);
      pts.set(ka, new THREE.Vector3(pos[a * 3], pos[a * 3 + 1], pos[a * 3 + 2]));
      pts.set(kb, new THREE.Vector3(pos[b * 3], pos[b * 3 + 1], pos[b * 3 + 2]));
      const ek = ka < kb ? ka + '|' + kb : kb + '|' + ka;
      count.set(ek, (count.get(ek) || 0) + 1);
    }
  }
  const adj = new Map();
  for (const [ek, c] of count) {
    if (c !== 1) continue;
    const [a, b] = ek.split('|');
    (adj.get(a) || adj.set(a, []).get(a)).push(b);
    (adj.get(b) || adj.set(b, []).get(b)).push(a);
  }
  const used = new Set(), loops = [];
  for (const start of adj.keys()) {
    if (used.has(start)) continue;
    const loop = [start];
    used.add(start);
    let cur = start;
    for (let guard = 0; guard < 200000; guard++) {
      const next = (adj.get(cur) || []).find(n => !used.has(n));
      if (!next) break;
      used.add(next);
      loop.push(next);
      cur = next;
    }
    if (loop.length >= 3) loops.push(loop.map(k => pts.get(k)));
  }
  return loops;
}
// is the face flat and facing along `up`?
function facePlanarUp(body, fid, up) {
  const idx = body.geometry.index.array, pos = body.geometry.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  let any = false;
  for (let t = 0; t < body.faceOf.length; t++) {
    if (body.faceOf[t] !== fid) continue;
    a.fromBufferAttribute(pos, idx[t * 3]); b.fromBufferAttribute(pos, idx[t * 3 + 1]); c.fromBufferAttribute(pos, idx[t * 3 + 2]);
    n.crossVectors(b.sub(a), c.sub(a));
    if (n.lengthSq() < 1e-14) continue;
    if (n.normalize().dot(up) < 0.9999) return false;
    any = true;
  }
  return any;
}

// Reference point of a clicked face: the centroid of the clicked triangle lies strictly inside
// that face, so it always resolves to the same face (a hit point near an edge could match the neighbour).
function faceRefPoint(body, triIndex) {
  const idx = body.geometry.index.array, pos = body.geometry.attributes.position;
  const c = [0, 0, 0];
  for (let k = 0; k < 3; k++) { const v = idx[triIndex * 3 + k]; c[0] += pos.getX(v) / 3; c[1] += pos.getY(v) / 3; c[2] += pos.getZ(v) / 3; }
  return c.map(v => +v.toFixed(5));
}
function faceNormal(body, fid) {
  const idx = body.geometry.index.array, pos = body.geometry.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3(), sum = new THREE.Vector3();
  for (let t = 0; t < body.faceOf.length; t++) {
    if (body.faceOf[t] !== fid) continue;
    a.fromBufferAttribute(pos, idx[t * 3]); b.fromBufferAttribute(pos, idx[t * 3 + 1]); c.fromBufferAttribute(pos, idx[t * 3 + 2]);
    sum.add(n.crossVectors(b.sub(a), c.sub(a)));
  }
  return sum.normalize();
}
// common CAD/CAM "Kette": a clicked edge selects the closed boundary loop of the face it bounds that looks most towards the tool
const EDGE_OPS = ['contour', 'chamfer', 'trace', 'pocket', 'adaptive'];
let chainCache = { key: null, map: new Map() };
function edgeChain(ref, up) {
  const m = getModel();
  if (chainCache.key !== m.key) chainCache = { key: m.key, map: new Map() };
  const ck = ref.join(',') + '|' + up.toArray().map(v => v.toFixed(3)).join(',');
  if (chainCache.map.has(ck)) return chainCache.map.get(ck);
  const P = new THREE.Vector3(...ref);
  let best = null;
  m.bodies.forEach((body, bi) => {
    const bb = body.geometry.boundingBox;
    if (bb && bb.distanceToPoint(P) > 0.2) return;
    const nf = body.shape?.faces?.length || 0;
    for (let fid = 0; fid < nf; fid++) {
      const wires = faceWires(body, fid);
      if (!wires) continue;
      wires.forEach((w, wi) => {
        // the wire holds the clicked edge (same midpoint)
        const has = w.edges.some(ed => { const q = ed.pointAt(0.5); return Math.hypot(q.x - P.x, q.y - P.y, q.z - P.z) < 1e-3; });
        if (!has) return;
        const score = faceNormal(body, fid).dot(up);
        if (!best || score > best.score + 1e-6) best = { bi, fid, loop: wirePoints(w), score };
      });
    }
  });
  chainCache.map.set(ck, best);
  return best;
}
// triangles of picked faces as one geometry (model coordinates)
function facesGeometry(refs) {
  const pts = [];
  const seen = new Set();
  for (const r of refs) {
    const fa = faceAt(r);
    if (!fa || seen.has(fa.bi + ':' + fa.fid)) continue;
    seen.add(fa.bi + ':' + fa.fid);
    const idx = fa.body.geometry.index.array, pos = fa.body.geometry.attributes.position;
    for (let t = 0; t < fa.body.faceOf.length; t++) if (fa.body.faceOf[t] === fa.fid) for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; pts.push(pos.getX(v), pos.getY(v), pos.getZ(v)); }
  }
  if (!pts.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
// the bodies without the ignored faces ("Ignorieren")
function bodiesWithoutFaces(bodies, refs) {
  const drop = new Set(refs.map(r => faceAt(r)).filter(Boolean).map(fa => fa.body.id + ':' + fa.fid));
  const pts = [];
  for (const b of bodies) {
    if (!b.faceOf) continue;
    const idx = b.geometry.index.array, pos = b.geometry.attributes.position;
    for (let t = 0; t < b.faceOf.length; t++) if (!drop.has(b.id + ':' + b.faceOf[t])) for (let k = 0; k < 3; k++) { const v = idx[t * 3 + k]; pts.push(pos.getX(v), pos.getY(v), pos.getZ(v)); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
  return g;
}
// thick lines along a 3D polyline (selected chains)
function polyTubes(pts, mat, closed = true) {
  const g = new THREE.Group(), r = vp.worldPerPixel() * 1.8, up0 = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < pts.length - (closed ? 0 : 1); i++) {
    const a = pts[i], c = pts[(i + 1) % pts.length], len = a.distanceTo(c);
    if (len < 1e-9) continue;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6, 1, true), mat);
    cyl.position.copy(a).add(c).multiplyScalar(0.5);
    cyl.quaternion.setFromUnitVectors(up0, c.clone().sub(a).normalize());
    cyl.renderOrder = 12;
    g.add(cyl);
  }
  return g;
}

// ---------- CAM geometry from picked model faces (select faces / holes) ----------
const HOLE_OPS = ['drill', 'bore', 'thread', 'circular'];
const isHoleOp = op => !!op && (HOLE_OPS.includes(op.type) || (op.type === 'probe' && ['bore', 'boss'].includes(op.probeMode)));
const SURF_FACE_OPS = ['flow3d', 'morph3d']; // any face (curved too), machined over its outline
const FACE_OPS = ['pocket', 'adaptive', 'contour', 'chamfer', 'trace', 'vcarve', 'probe', ...SURF_FACE_OPS, ...HOLE_OPS];
const setupUp = setup => new THREE.Vector3(0, 0, 1).transformDirection(setupMatrix(setup).clone().invert()).normalize();

// Builds a hidden sketch (in the setup's XY plane) from the picked faces so the
// 2D strategies can use it like a drawn sketch.
function camFaceSketch(op, setup, bodies) {
  const up = setupUp(setup);
  const x = Math.abs(up.z) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 0, 1).cross(up).normalize();
  const y = new THREE.Vector3().crossVectors(up, x);
  const loc = v => [+v.dot(x).toFixed(4), +v.dot(y).toFixed(4)];
  const ents = [];
  let top = -Infinity, bottom = Infinity;
  const hole = isHoleOp(op);
  for (const p of op.faces || []) {
    if (hole) {
      const c = cylinderInfo(bodies, p);
      if (!c) continue;
      const d = new THREE.Vector3(...c.dir);
      if (Math.abs(d.dot(up)) < 0.999) continue;
      const L = new THREE.Vector3(...c.loc);
      const h0 = L.clone().addScaledVector(d, c.t0).dot(up), h1 = L.clone().addScaledVector(d, c.t1).dot(up);
      top = Math.max(top, h0, h1);
      bottom = Math.min(bottom, h0, h1);
      const [cx, cy] = loc(L);
      if (!ents.some(e => Math.hypot(e.cx - cx, e.cy - cy) < 1e-3 && Math.abs(e.r - c.r) < 1e-3)) ents.push({ id: 'f' + ents.length, type: 'circle', cx, cy, r: +c.r.toFixed(4) });
    } else {
      const fa = faceAt(p);
      if (!fa || (!SURF_FACE_OPS.includes(op.type) && !facePlanarUp(fa.body, fa.fid, up))) continue;
      const loops = faceLoops3D(fa.body, fa.fid);
      if (!loops.length) continue;
      const hgt = loops[0][0].dot(up);
      top = Math.max(top, hgt);
      bottom = Math.min(bottom, hgt);
      for (const l of loops) {
        const pts = l.map(loc).filter((q, i, arr) => {
          const a = arr[(i - 1 + arr.length) % arr.length], c = arr[(i + 1) % arr.length];
          return Math.abs((q[0] - a[0]) * (c[1] - a[1]) - (q[1] - a[1]) * (c[0] - a[0])) > 1e-6;
        });
        if (pts.length >= 3) ents.push({ id: 'f' + ents.length, type: 'poly', closed: true, pts });
      }
    }
  }
  // picked edges: their closed chains become profiles
  if (!hole) for (const ref of op.edges || []) {
    const ch = edgeChain(ref, up);
    if (!ch) continue;
    const pts = ch.loop.map(loc);
    for (const v of ch.loop) { const hz = v.dot(up); top = Math.max(top, hz); bottom = Math.min(bottom, hz); }
    if (pts.length >= 3) ents.push({ id: 'f' + ents.length, type: 'poly', closed: true, pts });
  }
  if (!ents.length) throw new Error(hole ? 'Keine passende Bohrung gewählt (Zylinderfläche, senkrecht im Setup)' : 'Keine passende Fläche oder Kante gewählt (Flächen eben und zum Werkzeug zeigend)');
  const z = hole ? top : bottom;
  const sk = { id: '__faces_' + op.id, type: 'sketch', name: 'Flächenauswahl', plane: { o: up.clone().multiplyScalar(z).toArray(), x: x.toArray(), n: up.toArray() }, entities: ents };
  if (hole) sk.camOffsets = [bottom - top];
  if (op.type === 'contour' && (op.side || 'outside') === 'outside') sk.camToModelBottom = true;
  return sk;
}

// Hole under the mouse: the ray enters the top of a vertical cylinder (works for
// through holes and when only the opening is visible from above).
let cylCache = { key: null, list: [] };
function holeAtRay(e, up, smallest = false) {
  const m = getModel();
  if (cylCache.key !== m.key) { try { cylCache = { key: m.key, list: cylinderFaces(m.bodies) } } catch { cylCache = { key: m.key, list: [] }; } }
  vp.raycast(e, []);
  const ray = vp.raycaster.ray;
  let best = null, bd = Infinity;
  for (const c of cylCache.list) {
    if (c.outside || state.hiddenBodies.has(m.bodies[c.bi]?.id)) continue;
    const d = new THREE.Vector3(...c.dir);
    if (Math.abs(d.dot(up)) < 0.999) continue;
    const L = new THREE.Vector3(...c.loc);
    const a = L.clone().addScaledVector(d, c.t0), b = L.clone().addScaledVector(d, c.t1);
    const topP = a.dot(up) > b.dot(up) ? a : b;
    const hit = ray.intersectPlane(new THREE.Plane().setFromNormalAndCoplanarPoint(up, topP), new THREE.Vector3());
    if (!hit) continue;
    const rad = hit.clone().sub(L).sub(d.clone().multiplyScalar(hit.clone().sub(L).dot(d))).length();
    if (rad > c.r) continue;
    // drilling: the narrowest hole under the mouse (not its counterbore), else the nearest
    const dist = smallest ? c.r : hit.distanceTo(ray.origin);
    if (dist < bd) { bd = dist; best = c; }
  }
  return best;
}

function toggleCamPick(id) {
  const on = !(state.pick?.mode === 'camfaces' && state.pick.id === id);
  state.pick = on ? { mode: 'camfaces', id } : null;
  if (on) tabState.op = 'geo';
  const op = on && camOp(id);
  const what = op && isHoleOp(op) ? (op.type === 'probe' ? 'Bohrung oder Zapfen (Zylinderfläche)' : 'Bohrungen (Zylinderflächen)') : op?.type === 'probe' ? (op.probeMode === 'z' ? 'Fläche zum Antasten in Z' : 'Oberseite des Rechtecks bzw. Taschenboden') : op?.type === 'contour' ? 'Flächen, deren Umriss gefahren wird' : 'Taschenböden / ebene Flächen';
  const edgeTxt = op && EDGE_OPS.includes(op.type) && !isHoleOp(op) ? ' oder Kanten (wählt die geschlossene Kette)' : '';
  showBanner(on ? [`${what}${edgeTxt} im Modell anklicken – erneut klicken entfernt.`, h('button', { onclick: () => toggleCamPick(id) }, 'Fertig')] : null);
  renderAll();
}

// faces to show highlighted: the feature or operation whose dialog is open
function highlightedFaces() {
  if (state.workspace === 'cam' && state.pick?.mode === 'opbound') return camOp(state.pick.id)?.boundaryFaces || [];
  if (state.workspace === 'cam' && state.pick?.mode === 'facegroup') return (camOp(state.pick.id)?.faceGroups || []).find(g => g.id === state.pick.key)?.faces || [];
  if (state.workspace === 'cam') {
    const id = state.pick?.mode === 'camfaces' ? state.pick.id : state.sel?.kind === 'op' ? state.sel.id : null;
    const op = id && camOp(id);
    return op && op.geomSource === 'model' ? op.faces || [] : [];
  }
  const id = state.pick?.mode === 'faces' ? state.pick.id : state.sel?.kind === 'feature' ? state.sel.id : null;
  const f = id && feature(id);
  return f && Array.isArray(f.faces) && (['shell', 'draft', 'thread'].includes(f.type) || (f.type === 'extrude' && f.source === 'faces')) ? f.faces : [];
}

// pre-highlight of the face under the mouse while picking
const hoverGroup = new THREE.Group();
vp.overlay.add(hoverGroup);
let hoverKey = null, hoverRaf = 0;
const matEdgeHover = new THREE.MeshBasicMaterial({ color: 0x0b0d10, depthTest: false, transparent: true });
const matEdgeSelMesh = new THREE.MeshBasicMaterial({ color: 0x9fdcff, depthTest: false, transparent: true });
// one B-rep edge as thin tubes (3 px), so it is clearly visible
function edgeMesh(body, ei, mat = matEdgeHover) {
  const pos = body.edges.attributes.position.array, r = vp.worldPerPixel() * 1.6;
  const g = new THREE.Group();
  const a = new THREE.Vector3(), c = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  body.segEdge.forEach((e, s) => {
    if (e !== ei) return;
    a.set(pos[s * 6], pos[s * 6 + 1], pos[s * 6 + 2]);
    c.set(pos[s * 6 + 3], pos[s * 6 + 4], pos[s * 6 + 5]);
    const len = a.distanceTo(c);
    if (len < 1e-9) return;
    const cyl = new THREE.Mesh(new THREE.CylinderGeometry(r, r, len, 6, 1, true), mat);
    cyl.position.copy(a).add(c).multiplyScalar(0.5);
    cyl.quaternion.setFromUnitVectors(up, c.clone().sub(a).normalize());
    cyl.renderOrder = 12;
    g.add(cyl);
  });
  return g;
}
// hover objects follow assembly placements of their body
function placeLike(obj, bi) {
  const mesh = vp.model.children.find(o => o.isMesh && o.userData.body === bi);
  if (mesh && !mesh.matrixAutoUpdate) { obj.matrixAutoUpdate = false; obj.matrix.copy(mesh.matrix); }
  return obj;
}

function updateFaceHover(e) {
  const mode = state.pick?.mode;
  const off = state.sketchId || e.buttons || (sim.open && sim.playing) || document.querySelector('.modal-back, .prefs-back') || getSettings().hoverHighlight === false;
  if (off) { if (hoverKey) { vp.clear(hoverGroup); hoverKey = null; } setHoverPlane(null); return; }
  if (mode === 'plane') {
    const pl = planeUnderMouse(e);
    setHoverPlane(pl);
    if (pl) { if (hoverKey) { vp.clear(hoverGroup); hoverKey = null; } return; }
  } else if (hoverPlane) setHoverPlane(null);
  let bi = null, fid = null, ebi = null, ei = null;
  const hop = mode === 'camfaces' && camOp(state.pick.id);
  if (hop && isHoleOp(hop) && hop.probeMode !== 'boss') {
    const c = holeAtRay(e, setupUp(state.project.cam.setups.find(x => x.id === hop.setup) || state.project.cam.setups[0]), hop.type === 'drill');
    const fa = c && faceAt(c.pt);
    if (fa) { bi = fa.bi; fid = fa.fid; }
  }
  if (mode === 'origXY') {
    const st = state.project.cam.setups.find(x => x.id === state.pick.id);
    const c = st && holeAtRay(e, setupUp(st), true);
    const fa = c && faceAt(c.pt);
    if (fa) { bi = fa.bi; fid = fa.fid; }
  }
  if (bi == null) {
    const meshHit = vp.raycast(e, vp.model.children.filter(o => o.isMesh))[0];
    // edges win when the mouse is on them (and they are not hidden behind a face)
    const edgeOk = mode === 'opbound' || (mode === 'camfaces' && EDGE_OPS.includes(camOp(state.pick.id)?.type) && !isHoleOp(camOp(state.pick.id)));
    const faceOnly = ['faces', 'camfaces', 'plane', 'setupBodies', 'fixtures'].includes(mode) && !edgeOk;
    if (!faceOnly) {
      const setupPicking = SETUP_PICKS.includes(mode) || mode === 'edges' || edgeOk;
      const lines = setupPicking ? edgePickObjects() : vp.model.children.filter(o => o.userData.edges);
      const eh = lines.length ? vp.raycast(e, lines, 5)[0] : null;
      if (eh && (!meshHit || eh.distance <= meshHit.distance + vp.worldPerPixel() * 6)) {
        ebi = eh.object.userData.body;
        ei = getModel().bodies[ebi].segEdge[Math.floor(eh.index / 2)];
      }
    }
    if (ei == null && meshHit && mode !== 'edges') { bi = meshHit.object.userData.body; fid = getModel().bodies[bi].faceOf[meshHit.faceIndex]; }
  }
  const key = ei != null ? `e${ebi}:${ei}` : bi != null ? `f${bi}:${fid}` : null;
  if (key === hoverKey) return;
  vp.clear(hoverGroup);
  hoverKey = key;
  const m = getModel();
  if (ei != null) hoverGroup.add(placeLike(edgeMesh(m.bodies[ebi], ei), ebi));
  else if (bi != null) {
    const fg = new THREE.Group();
    fg.add(faceMesh(m.bodies[bi], fid, matFaceHover));
    for (const loop of faceLoops3D(m.bodies[bi], fid)) fg.add(polyTubes(loop, matEdgeHover));
    hoverGroup.add(placeLike(fg, bi));
  }
}
vp.canvas.addEventListener('pointermove', e => {
  if (hoverRaf) return;
  hoverRaf = requestAnimationFrame(() => { hoverRaf = 0; updateFaceHover(e); });
});
vp.canvas.addEventListener('pointerleave', () => { vp.clear(hoverGroup); hoverKey = null; setHoverPlane(null); });
vp.canvas.addEventListener('pointerdown', () => { if (hoverKey) { vp.clear(hoverGroup); hoverKey = null; } });

function rebuildScene() {
  vp.clear(vp.model);
  vp.clear(vp.sketches);
  vp.clear(vp.paths);
  const m = getModel();
  const cam = state.workspace === 'cam';
  const ghost = cam && sim.open && !$('#simModel').checked;
  const selRefs = selectedEdgeRefs();
  applySection();
  drawMeshes();
  // common CAD/CAM "Flacher Zustand": the sheet metal part is shown developed, with its bend lines
  const flatShown = drawFlatPattern();
  for (const [bi, b] of flatShown ? [] : m.bodies.entries()) {
    if (state.hiddenBodies.has(b.id)) continue;
    const mesh = new THREE.Mesh(b.geometry, ghost ? matGhost : display === 'wire' ? matWire : bodyMaterial(b.id));
    // assembly placement/joints; switched off while picking edges/faces in model coordinates
    const am = assemblyActive() ? bodyMatrix(state.project.assembly, b.id, motionValues) : null;
    if (am) { mesh.matrixAutoUpdate = false; mesh.matrix.copy(am); }
    mesh.userData = { cached: true, body: bi };
    const edges = new THREE.LineSegments(b.edges, ghost ? matEdgeGhost : matEdge);
    edges.userData = { cached: true, body: bi, edges: true };
    vp.model.add(mesh);
    // edges stay pickable while selecting them for fillets, even in shaded mode
    if (am) { edges.matrixAutoUpdate = false; edges.matrix.copy(am); }
    if (state.workspace !== 'render' && (display !== 'shaded' || state.pick?.mode === 'edges')) vp.model.add(edges);
    if (selRefs.length) {
      const pts = [];
      const pos = b.edges.attributes.position.array;
      const hit = new Set();
      b.shape.edges.forEach((_, ei) => { if (edgeRefMatches(b, ei, selRefs) >= 0) hit.add(ei); });
      for (const ei of hit) { const em = edgeMesh(b, ei, matEdgeSelMesh); if (am) { em.matrixAutoUpdate = false; em.matrix.copy(am); } vp.paths.add(em); }
      void pts; void pos;
    }
  }
  // selected faces in blue (whole face)
  vp.clear(hoverGroup);
  hoverKey = null;
  const shown = new Set();
  for (const p of highlightedFaces()) {
    const fa = faceAt(p);
    if (!fa || state.hiddenBodies.has(fa.body.id)) continue;
    const k = fa.bi + ':' + fa.fid;
    if (shown.has(k)) continue;
    shown.add(k);
    vp.paths.add(faceMesh(fa.body, fa.fid, matFaceSel));
  }
  // selected edge chains of the operation (blue, thick)
  if (state.workspace === 'cam') {
    const cid = state.pick?.mode === 'camfaces' ? state.pick.id : state.sel?.kind === 'op' ? state.sel.id : null;
    const cop = cid && camOp(cid);
    const st0 = cop && (state.project.cam.setups.find(x => x.id === cop.setup) || state.project.cam.setups[0]);
    const chainRefs = state.pick?.mode === 'opbound' ? cop?.boundaryEdges || [] : cop?.geomSource === 'model' ? cop.edges || [] : [];
    for (const ref of chainRefs) { const ch = edgeChain(ref, setupUp(st0)); if (ch) vp.paths.add(polyTubes(ch.loop, matEdgeSelMesh)); }
  }
  // origin references of the open setup dialog: X red, Y green, Z blue
  const dstp = state.workspace === 'cam' && dialogTarget()?.kind === 'setup' && state.project.cam.setups.find(x => x.id === activeSetupId());
  if (dstp?.originMode === 'pick') {
    for (const [k, col] of [['x', 0xe5484d], ['y', 0x40c057], ['z', 0x2a8fff]]) {
      const r = dstp.originRef?.[k];
      if (!Array.isArray(r?.p)) continue;
      const dot = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(...r.p)]), new THREE.PointsMaterial({ color: col, size: 11, sizeAttenuation: false, depthTest: false, transparent: true }));
      dot.renderOrder = 13;
      vp.paths.add(dot);
    }
  }
  // holes: a blue disc on the opening, visible from above
  const hop = state.workspace === 'cam' && camOp(state.pick?.mode === 'camfaces' ? state.pick.id : state.sel?.kind === 'op' ? state.sel.id : null);
  if (hop && isHoleOp(hop) && hop.geomSource === 'model') {
    const st = state.project.cam.setups.find(x => x.id === hop.setup) || state.project.cam.setups[0];
    const up = setupUp(st);
    for (const p of hop.faces || []) {
      const c = cylinderInfo(m.bodies, p);
      if (!c) continue;
      const d = new THREE.Vector3(...c.dir), L = new THREE.Vector3(...c.loc);
      const a = L.clone().addScaledVector(d, c.t0), b2 = L.clone().addScaledVector(d, c.t1);
      const topP = a.dot(up) > b2.dot(up) ? a : b2;
      const disc = new THREE.Mesh(new THREE.CircleGeometry(c.r, 48), matFaceSel);
      disc.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), up);
      disc.position.copy(topP).addScaledVector(up, 0.02);
      disc.renderOrder = 7;
      vp.paths.add(disc);
    }
  }
  // cosmetic threads: helix lines on the cylinder
  if (!cam) for (const th of m.threads || []) {
    const d = new THREE.Vector3(...th.d).normalize();
    const u = new THREE.Vector3().crossVectors(d, Math.abs(d.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize();
    const w = new THREE.Vector3().crossVectors(d, u);
    const c = new THREE.Vector3(...th.c), pts = [];
    const r = th.r + (th.outside ? 0.03 : -0.03);
    const n = Math.max(24, Math.ceil(th.L / th.P) * 24);
    for (let i = 0; i <= n; i++) {
      const t = (i / n) * th.L, a = (t / th.P) * Math.PI * 2;
      pts.push(c.clone().addScaledVector(d, t).addScaledVector(u, r * Math.cos(a)).addScaledVector(w, r * Math.sin(a)));
    }
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), matThread);
    l.renderOrder = 4;
    vp.paths.add(l);
  }
  if (measure.pts.length) {
    const g = new THREE.BufferGeometry().setFromPoints(measure.pts);
    const l = new THREE.Line(g, matMeasure);
    l.renderOrder = 9;
    const dots = new THREE.Points(g.clone(), new THREE.PointsMaterial({ color: 0xff7a00, size: 8, sizeAttenuation: false, depthTest: false, transparent: true }));
    vp.paths.add(l, dots);
  }
  hoverPlane = null;
  vp.canvas.style.cursor = '';
  if (!cam) drawPlanes();
  drawImages();
  if (!cam) drawExtrudeGizmo();
  if (!cam && state.pick?.mode === 'plane') drawOriginPlanes();
  if (!cam) {
    for (const f of resolved().features) {
      if (f.type !== 'sketch') continue;
      const active = f.id === state.sketchId;
      if (f.hidden && !active) continue;
      const sk = active && sketcher.override ? { ...f, entities: sketcher.override } : f;
      const dof = active ? sketchInfo(f.id).dof : null;
      vp.sketches.add(sketchVisual(sk, { active, selectedId: active ? sketcher.selected : null, dark: isDark(), constrained: dof === 0, fill: getSettings().sketchFill !== false }));
      if (active) vp.sketches.add(sketchOverlay(sk));
    }
  } else if (cam) {
    drawCam();
  }
  vp.sim.visible = cam && sim.open;
  drawJointGlyphs();
  if (state.workspace === 'render') studio.apply(renderSettings(), m.box);
}

// ----- RENDERN: scene settings ("Szeneneinstellungen") -----
function propsRender(b) {
  setTitle('SZENENEINSTELLUNGEN');
  const s = renderSettings();
  const ed = (k, v) => commit(p => { p.render = { ...(p.render || {}), [k]: v }; });
  const swatches = h('div', { class: 'env-list' }, ...Object.entries(ENVIRONMENTS).map(([k, label]) =>
    h('button', { class: 'env-sw env-' + k + (s.env === k ? ' on' : ''), title: label, onclick: () => ed('env', k) }, h('i'), h('span', null, label))));
  const bg = h('input', { type: 'color', value: s.bgColor, style: 'width:100%;height:26px' });
  bg.onchange = () => ed('bgColor', bg.value);
  b.append(
    sec('UMGEBUNG'), swatches,
    row('Helligkeit', num(s.exposure, v => ed('exposure', v ?? 1), { min: 0.1, max: 4, step: 0.1 })),
    row('Hintergrund', sel([['studio', 'Studio-Verlauf'], ['env', 'Umgebung (unscharf)'], ['color', 'Einfarbig']], s.background, v => ed('background', v))),
    s.background === 'color' ? row('Farbe', bg) : null,
    sec('LICHT UND BODEN'),
    row('Lichtrichtung', num(s.lightAz, v => ed('lightAz', v ?? 35), { unit: '°' })),
    row('Lichthöhe', num(s.lightEl, v => ed('lightEl', v ?? 55), { unit: '°', min: 5, max: 89 })),
    row('Bodenebene', chk(s.ground, v => ed('ground', v))),
    row('Schatten', chk(s.shadows, v => ed('shadows', v))),
    row('Spiegelung', num(s.reflection, v => ed('reflection', Math.max(0, Math.min(0.9, v ?? 0))), { min: 0, max: 0.9, step: 0.05 })),
    sec('KAMERA'),
    row('Tiefenschärfe', num(s.dof, v => ed('dof', Math.max(0, Math.min(10, v ?? 0))), { min: 0, max: 10, step: 1 })),
    h('p', { class: 'hint' }, '0 = aus, 1–10 = immer weniger Schärfentiefe. Scharf bleibt der Drehpunkt der Ansicht (Teilmitte); sichtbar beim In-Canvas-Rendern.'),
    sec('IN-CANVAS-RENDERN'),
    row('Durchgänge', num(s.samples, v => ed('samples', Math.max(1, Math.round(v ?? 128))), { min: 1, max: 2000 })),
    h('div', { class: 'btns' },
      btn(studio.running ? 'Rendern beenden' : 'In-Canvas-Rendern', () => { studio.running ? studio.stop() : studio.start(); renderAll(); }, 'primary'),
      btn('Bild speichern', saveRenderImage)),
    h('p', { class: 'hint' }, 'Materialien über „Darstellung“ (A) auf die Körper ziehen. Beim In-Canvas-Rendern wird das Bild mit jedem Durchgang glatter (weiche Schatten, saubere Kanten); jede Kamerabewegung beginnt neu.'));
}
function saveRenderImage() {
  if (!studio.active) return status('Bild speichern gibt es im Arbeitsbereich RENDERN.');
  studio.snapshot(blob => {
    if (!blob) return status('Bild konnte nicht erzeugt werden.');
    const url = URL.createObjectURL(blob);
    const a = h('a', { href: url, download: `${state.project.name || 'WerkFab'} – Rendering.png` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
    status('Bild gespeichert.');
  });
}

// Construction planes: translucent squares like the usual orange planes.
const matPlane = new THREE.MeshBasicMaterial({ color: 0xe8a33a, transparent: true, opacity: 0.16, side: THREE.DoubleSide, depthWrite: false });
const matPlaneSel = new THREE.MeshBasicMaterial({ color: 0x0696d7, transparent: true, opacity: 0.22, side: THREE.DoubleSide, depthWrite: false });
const matPlaneEdge = new THREE.LineBasicMaterial({ color: 0xc27c12 });
function drawPlanes() {
  const rf = resolved().features;
  const n = replayCount();
  const box = getModel().box;
  const size = box.isEmpty() ? 60 : Math.max(30, box.getSize(new THREE.Vector3()).length() * 0.45);
  rf.slice(0, n ?? undefined).forEach(f => {
    if (f.type !== 'plane' || f.hidden || f.suppressed) return;
    const pl = constructionPlane(f, rf);
    if (!pl) return;
    const g = new THREE.Group();
    g.matrixAutoUpdate = false;
    g.matrix.copy(planeMatrixOf({ plane: pl }));
    // centred over the model
    const b = basis({ plane: pl });
    let cu = 0, cv = 0;
    if (!box.isEmpty()) { const c = box.getCenter(new THREE.Vector3()).sub(b.o); cu = c.dot(b.x); cv = c.dot(b.y); }
    const selected = state.sel?.kind === 'feature' && state.sel.id === f.id;
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(size, size).translate(cu, cv, 0), selected ? matPlaneSel : matPlane);
    quad.renderOrder = 3;
    quad.userData = { plane: f.id };
    const s2 = size / 2;
    const edge = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([[-s2, -s2], [s2, -s2], [s2, s2], [-s2, s2]].map(([u, v]) => new THREE.Vector3(u + cu, v + cv, 0))), selected ? matEdgeSel : matPlaneEdge);
    g.add(quad, edge);
    vp.sketches.add(g);
  });
  // construction axes (dashed) and points
  for (const f of rf.slice(0, n ?? undefined)) {
    if ((f.type !== 'axis' && f.type !== 'point') || f.hidden || f.suppressed) continue;
    const selected = state.sel?.kind === 'feature' && state.sel.id === f.id;
    if (f.type === 'axis') {
      const ax = constructionAxis(f, rf);
      if (!ax) continue;
      const o = new THREE.Vector3(...ax.o), d = new THREE.Vector3(...ax.d);
      let mid = o.clone();
      if (ax.len) mid.addScaledVector(d, ax.len / 2);
      else if (!box.isEmpty()) mid.addScaledVector(d, box.getCenter(new THREE.Vector3()).sub(o).dot(d));
      const L = Math.max(size * 1.4, (ax.len || 0) * 1.4);
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([mid.clone().addScaledVector(d, -L / 2), mid.clone().addScaledVector(d, L / 2)]), selected ? matAxisSel : matAxis);
      line.computeLineDistances();
      line.renderOrder = 6;
      line.userData = { axis: f.id };
      vp.sketches.add(line);
    } else {
      const s = new THREE.Mesh(ptGeo, selected ? matPtSel : matPt);
      s.position.set(+f.x || 0, +f.y || 0, +f.z || 0);
      s.scale.setScalar(Math.max(0.4, size * 0.01));
      s.renderOrder = 7;
      s.userData = { cpoint: f.id };
      vp.sketches.add(s);
    }
  }
}
const matAxis = new THREE.LineDashedMaterial({ color: 0xe07b00, dashSize: 4, gapSize: 2.5, depthTest: false, transparent: true });
const matAxisSel = new THREE.LineBasicMaterial({ color: 0x9fdcff, depthTest: false, transparent: true });
const ptGeo = new THREE.SphereGeometry(1, 14, 10);
const matPt = new THREE.MeshBasicMaterial({ color: 0xe07b00, depthTest: false, transparent: true });
const matPtSel = new THREE.MeshBasicMaterial({ color: 0x9fdcff, depthTest: false, transparent: true });

// ---------- picking 3D points (Ebene durch 3 Punkte, Achse durch 2 Punkte, Konstruktionspunkt) ----------
// Snaps to edge ends of the bodies, construction points and the origin; otherwise the point on the clicked face.
function pickPoint3D(e) {
  const m = getModel();
  const R = vp.canvas.getBoundingClientRect();
  let best = null, bd = 10;
  const cand = v => {
    const p = v.clone().project(vp.camera);
    if (p.z > 1) return;
    const d = Math.hypot(R.left + ((p.x + 1) / 2) * R.width - e.clientX, R.top + ((1 - p.y) / 2) * R.height - e.clientY);
    if (d < bd) { bd = d; best = v; }
  };
  for (const b of m.bodies) {
    const pos = b.edges.attributes.position, ends = new Map();
    for (let s = 0; s < b.segEdge.length; s++) {
      const ei = b.segEdge[s];
      const a = new THREE.Vector3().fromBufferAttribute(pos, 2 * s), c = new THREE.Vector3().fromBufferAttribute(pos, 2 * s + 1);
      if (!ends.has(ei)) ends.set(ei, [a, c]); else ends.get(ei)[1] = c;
    }
    for (const [a, c] of ends.values()) { cand(a); cand(c); }
  }
  for (const f of resolved().features) if (f.type === 'point' && !f.suppressed) cand(new THREE.Vector3(+f.x || 0, +f.y || 0, +f.z || 0));
  cand(new THREE.Vector3());
  if (best) return best.toArray().map(v => +v.toFixed(4));
  const hit = vp.raycast(e, vp.model.children.filter(o => o.isMesh))[0];
  return hit ? hit.point.toArray().map(v => +v.toFixed(4)) : null;
}
function startPointPick(id, key, n) {
  state.pick = { mode: 'cpoints', id, key, n };
  pointPickBanner();
  renderAll();
}
function pointPickBanner() {
  const pk = state.pick, f = feature(pk.id);
  const have = pk.key === 'xyz' ? 0 : (f?.[pk.key] || []).length;
  showBanner([`Punkt ${Math.min(have + 1, pk.n)} von ${pk.n} anklicken – Ecken und Kantenenden rasten ein, sonst zählt der Punkt auf der Fläche.`,
    h('button', { onclick: () => { state.pick = null; showBanner(null); renderAll(); } }, 'Fertig')]);
}
function pointPickClick(e) {
  const q = pickPoint3D(e);
  if (!q) return status('Ecke, Kantenende, Konstruktionspunkt oder Fläche anklicken.');
  const { id, key, n } = state.pick;
  let done = false;
  editFeature(id, f => {
    if (key === 'xyz') { [f.x, f.y, f.z] = q; done = true; return; }
    f[key] = [...(f[key] || []), q].slice(-n);
    done = f[key].length >= n;
  });
  if (done) { state.pick = null; showBanner(null); renderAll(); } else pointPickBanner();
}
function axisCylClick(e, meshes, m) {
  const hit = vp.raycast(e, meshes)[0];
  const ci = hit && cylinderInfo(m.bodies, hit.point.toArray());
  if (!ci) return status('Zylinderfläche oder Bohrung anklicken.');
  const id = state.pick.id;
  state.pick = null;
  showBanner(null);
  const at = t => ci.loc.map((v, i) => +(v + ci.dir[i] * t).toFixed(4));
  editFeature(id, f => { f.pts = [at(ci.t0), at(ci.t1)]; f.r = +ci.r.toFixed(4); });
}
// ---------- extrude manipulator (arrow on the profile + value box) ----------
// The arrow sits on the end face of the extrusion; dragging it along the sketch normal changes the
// distance, the box at its tip takes a typed value (also parameters / formulas).
let exGiz = null, exDrag = null;
const exMat = new THREE.MeshBasicMaterial({ color: 0x1e88ff, depthTest: false, transparent: true });
const exMatHover = new THREE.MeshBasicMaterial({ color: 0x74c0fc, depthTest: false, transparent: true });
const exPrevMat = new THREE.LineBasicMaterial({ color: 0x1e88ff, depthTest: false, transparent: true, opacity: 0.9 });
function exArrowMesh() {
  // unit arrow along +Z: shaft and cone (scaled to a constant screen size every frame)
  const g = new THREE.Group();
  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.72, 10).rotateX(Math.PI / 2).translate(0, 0, 0.36), exMat);
  const head = new THREE.Mesh(new THREE.ConeGeometry(0.11, 0.28, 18).rotateX(Math.PI / 2).translate(0, 0, 0.86), exMat);
  const grip = new THREE.Mesh(new THREE.SphereGeometry(0.07, 14, 10), exMat);
  for (const m of [shaft, head, grip]) { m.renderOrder = 20; g.add(m); }
  g.userData.parts = [shaft, head, grip];
  return g;
}
function drawExtrudeGizmo() {
  exGiz = null;
  const t = dialogTarget();
  if (t?.kind !== 'feature') return;
  const f = feature(t.id);
  if (!f || f.type !== 'extrude' || f.suppressed) return;
  const rf = resolved().features.find(x => x.id === f.id), rsk = rf && resolved().features.find(x => x.id === rf.sketch);
  if (rf?.source === 'faces') return drawFaceExtrudeGizmo(f, rf);
  if (!rsk) return;
  const b = basis(rsk);
  // centre of the chosen profiles
  const ids = Array.isArray(rf.profiles) ? new Set(rf.profiles.map(String)) : null;
  const pts = [], loops = [];
  for (const e of rsk.entities) {
    if (ids && !ids.has(String(e.id)) && ![...ids].some(k => k.startsWith(e.id))) continue;
    for (const poly of entityPolys(e) || []) {
      if (poly.length < 3 || (e.type === 'poly' && !e.closed)) continue;
      loops.push(poly);
      for (const q of poly) pts.push(q);
    }
  }
  if (!pts.length) return;
  const cu = pts.reduce((a, q) => a + q[0], 0) / pts.length, cv = pts.reduce((a, q) => a + q[1], 0) / pts.length;
  const o = toWorld(b, cu, cv), n = b.n.clone().normalize();
  const sym = rf.extent === 'sym';
  const handles = [{ key: 'distance', side: 1 }];
  if (rf.extent === 'two') handles.push({ key: 'distance2', side: -1 });
  const group = new THREE.Group();
  vp.paths.add(group);
  exGiz = { fid: f.id, o, n, b, loops, sym, group, handles: [] };
  for (const hd of handles) {
    const raw = +rf[hd.key] || 0;
    const d = hd.side * raw; // signed position along n (distance2 points the other way)
    const pos = sym ? raw / 2 : d;
    const dir = (pos >= 0 ? 1 : -1) * (raw === 0 ? hd.side : 1);
    const arrow = exArrowMesh();
    arrow.matrixAutoUpdate = false;
    group.add(arrow);
    // value box at the tip
    const inp = h('input', { type: 'text', value: String(f2(raw)), spellcheck: 'false' });
    const box = h('div', { class: 'exg-box', onpointerdown: e => e.stopPropagation() }, inp, h('span', null, 'mm'));
    inp.addEventListener('keydown', e => {
      e.stopPropagation();
      if (e.key === 'Enter') { e.preventDefault(); setExtrudeValue(f.id, hd.key, inp.value); }
      if (e.key === 'Escape') { inp.value = String(f2(raw)); inp.blur(); }
    });
    inp.addEventListener('change', () => setExtrudeValue(f.id, hd.key, inp.value));
    const lab = new CSS2DObject(box);
    group.add(lab);
    exGiz.handles.push({ ...hd, raw, pos, dir, arrow, lab, inp });
  }
  updateExtrudeGizmo();
}
// the same manipulator for an extrusion of body faces
function drawFaceExtrudeGizmo(f, rf) {
  const ref = (rf.faces || [])[0];
  if (!ref) return;
  // position and normal of the original face (it no longer exists after the extrusion)
  const info = getModel().faceExtrude?.[f.id]?.[0];
  const fa = faceAt(ref);
  const n = info ? new THREE.Vector3(...info.n) : fa ? faceNormal(fa.body, fa.fid) : null;
  if (!n || !(n.lengthSq() > 0.5)) return;
  const o = new THREE.Vector3(...(info ? info.p : ref));
  // outline for the drag preview: the face loops projected back onto the original plane
  const loops3 = fa ? faceLoops3D(fa.body, fa.fid).map(l => l.map(q => q.clone().addScaledVector(n, -q.clone().sub(o).dot(n)))) : [];
  const group = new THREE.Group();
  vp.paths.add(group);
  exGiz = { fid: f.id, o, n: n.clone().normalize(), b: null, loops3, loops: [], sym: rf.extent === 'sym', group, handles: [] };
  const hds = [{ key: 'distance', side: 1 }];
  if (rf.extent === 'two') hds.push({ key: 'distance2', side: -1 });
  for (const hd of hds) {
    const raw = +rf[hd.key] || 0, pos = exGiz.sym ? raw / 2 : hd.side * raw;
    const arrow = exArrowMesh();
    arrow.matrixAutoUpdate = false;
    group.add(arrow);
    const inp = h('input', { type: 'text', value: String(f2(raw)), spellcheck: 'false' });
    const box = h('div', { class: 'exg-box', onpointerdown: e => e.stopPropagation() }, inp, h('span', null, 'mm'));
    inp.addEventListener('keydown', e => { e.stopPropagation(); if (e.key === 'Enter') { e.preventDefault(); setExtrudeValue(f.id, hd.key, inp.value); } if (e.key === 'Escape') { inp.value = String(f2(raw)); inp.blur(); } });
    inp.addEventListener('change', () => setExtrudeValue(f.id, hd.key, inp.value));
    const lab = new CSS2DObject(box);
    group.add(lab);
    exGiz.handles.push({ ...hd, raw, pos, dir: pos >= 0 ? 1 : -1, arrow, lab, inp });
  }
  updateExtrudeGizmo();
}
function setExtrudeValue(fid, key, text) {
  const t = String(text).trim().replace(',', '.');
  if (!t) return;
  const v = /^[-+]?[0-9.]+$/.test(t) ? +t : evalExpr(t, paramScope(state.project));
  if (!Number.isFinite(v)) return status(`„${text}“ ist kein gültiger Wert.`);
  editFeature(fid, x => { x[key] = /[A-Za-z_]/.test(t) ? '=' + t : +(+v).toFixed(4); });
}
// keep the arrows the same size on screen and place them on the end faces
function updateExtrudeGizmo() {
  if (!exGiz) return;
  const L = vp.worldPerPixel() * 70;
  const zAxis = new THREE.Vector3(0, 0, 1);
  for (const hd of exGiz.handles) {
    const pos = exDrag && exDrag.key === hd.key ? exDrag.pos : hd.pos;
    const dir = pos === 0 ? hd.dir : Math.sign(pos) * (exGiz.sym ? 1 : 1);
    const base = exGiz.o.clone().addScaledVector(exGiz.n, pos);
    const q = new THREE.Quaternion().setFromUnitVectors(zAxis, exGiz.n.clone().multiplyScalar(dir || 1));
    hd.arrow.matrix.compose(base, q, new THREE.Vector3(L, L, L));
    hd.lab.position.copy(base).addScaledVector(exGiz.n, (dir || 1) * L * 1.25);
  }
}
// closest point of the mouse ray to the extrusion axis (signed distance from the sketch plane)
function exAxisParam(e) {
  vp.raycaster.setFromCamera(vp.ndc(e), vp.camera);
  const r = vp.raycaster.ray, n = exGiz.n, w0 = exGiz.o.clone().sub(r.origin);
  const bb = n.dot(r.direction), d1 = n.dot(w0), e1 = r.direction.dot(w0), den = 1 - bb * bb;
  if (Math.abs(den) < 1e-6) return null;
  return (bb * e1 - d1) / den;
}
function exHit(e) {
  if (!exGiz) return null;
  vp.raycaster.setFromCamera(vp.ndc(e), vp.camera);
  for (const hd of exGiz.handles) {
    hd.arrow.updateMatrixWorld(true);
    if (vp.raycaster.intersectObjects(hd.arrow.userData.parts, false).length) return hd;
  }
  return null;
}
function exPreview(hd, pos) {
  // outline of the profiles at the dragged distance (the body updates on release)
  exGiz.group.children.filter(c => c.userData.preview).forEach(c => { exGiz.group.remove(c); c.geometry.dispose(); });
  const from = exGiz.sym ? -pos : 0;
  for (const loop3 of exGiz.loops3 || []) {
    for (const off of [from, pos]) {
      const l = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(loop3.map(q => q.clone().addScaledVector(exGiz.n, off))), exPrevMat);
      l.userData.preview = true;
      l.renderOrder = 19;
      exGiz.group.add(l);
    }
  }
  for (const loop of exGiz.loops) {
    for (const off of [from, pos]) {
      const g = new THREE.BufferGeometry().setFromPoints([...loop, loop[0]].map(([u, v]) => toWorld(exGiz.b, u, v).addScaledVector(exGiz.n, off)));
      const l = new THREE.Line(g, exPrevMat);
      l.userData.preview = true;
      l.renderOrder = 19;
      exGiz.group.add(l);
    }
    const step = Math.max(1, Math.floor(loop.length / 8));
    const seg = [];
    for (let i = 0; i < loop.length; i += step) { const w = toWorld(exGiz.b, loop[i][0], loop[i][1]); seg.push(w.clone().addScaledVector(exGiz.n, from), w.clone().addScaledVector(exGiz.n, pos)); }
    const ls = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), exPrevMat);
    ls.userData.preview = true;
    ls.renderOrder = 19;
    exGiz.group.add(ls);
  }
}
vp.canvas.addEventListener('pointermove', e => {
  if (!exGiz || exDrag) return;
  const hd = exHit(e);
  for (const x of exGiz.handles) for (const m of x.arrow.userData.parts) m.material = x === hd ? exMatHover : exMat;
  if (hd) vp.canvas.style.cursor = 'grab';
  else if (vp.canvas.style.cursor === 'grab') vp.canvas.style.cursor = '';
});
vp.canvas.addEventListener('pointerdown', e => {
  if (!exGiz || e.button !== 0) return;
  const hd = exHit(e);
  if (!hd) return;
  e.stopImmediatePropagation();
  e.preventDefault();
  const s0 = exAxisParam(e);
  if (s0 == null) return;
  exDrag = { key: hd.key, hd, start: s0, pos0: hd.pos, pos: hd.pos };
  vp.canvas.style.cursor = 'grabbing';
  const move = ev => {
    const s1 = exAxisParam(ev);
    if (s1 == null) return;
    let pos = exDrag.pos0 + (s1 - exDrag.start);
    pos = ev.shiftKey ? Math.round(pos) : Math.round(pos * 10) / 10; // 0.1 mm, Umschalt = 1 mm
    exDrag.pos = pos;
    const val = exGiz.sym ? 2 * Math.abs(pos) : hd.side * pos;
    hd.inp.value = String(f2(val));
    exPreview(hd, pos);
  };
  const up = () => {
    removeEventListener('pointermove', move, true);
    removeEventListener('pointerup', up, true);
    vp.canvas.style.cursor = '';
    const d = exDrag;
    exDrag = null;
    if (!d || Math.abs(d.pos - d.pos0) < 1e-9) return;
    const val = exGiz.sym ? 2 * Math.abs(d.pos) : hd.side * d.pos;
    if (Math.abs(val) < 1e-6) return status('Abstand 0 ist nicht möglich.');
    editFeature(exGiz.fid, x => { x[d.key] = +val.toFixed(4); });
  };
  addEventListener('pointermove', move, true);
  addEventListener('pointerup', up, true);
}, true);

// Origin planes while choosing a sketch plane (three labelled squares at the origin;
// the one under the mouse turns blue, a click starts the sketch on it).
const planeTexCache = {};
function planeTexture(label, hover) {
  const key = label + (hover ? ':h' : '');
  if (planeTexCache[key]) return planeTexCache[key];
  const c = document.createElement('canvas');
  c.width = c.height = 256;
  const g = c.getContext('2d');
  g.fillStyle = hover ? 'rgba(80,130,255,0.5)' : 'rgba(225,140,70,0.3)';
  g.fillRect(0, 0, 256, 256);
  g.strokeStyle = hover ? 'rgba(130,170,255,0.95)' : 'rgba(235,160,95,0.85)';
  g.lineWidth = 5;
  g.strokeRect(2.5, 2.5, 251, 251);
  // label in the far corner, so the three labels never overlap
  g.fillStyle = hover ? 'rgba(235,242,255,0.95)' : 'rgba(255,225,195,0.9)';
  g.font = '600 40px Segoe UI, Arial, sans-serif';
  g.textBaseline = 'top';
  g.textAlign = 'right';
  g.fillText(tr(label), 238, 16);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (planeTexCache[key] = new THREE.MeshBasicMaterial({ map: t, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
}
const ORIGIN_BASIS = {
  XY: [[1, 0, 0], [0, 1, 0], [0, 0, 1]],
  XZ: [[1, 0, 0], [0, 0, 1], [0, -1, 0]],
  YZ: [[0, 1, 0], [0, 0, 1], [1, 0, 0]],
};
function originPlaneSize() {
  const box = getModel().box;
  return box.isEmpty() ? 40 : Math.max(20, Math.min(400, box.getSize(new THREE.Vector3()).length() * 0.35));
}
function drawOriginPlanes() {
  const s = originPlaneSize();
  for (const [name, [u, v, n]] of Object.entries(ORIGIN_BASIS)) {
    const geo = new THREE.PlaneGeometry(s, s).translate(s / 2, s / 2, 0);
    geo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(...u), new THREE.Vector3(...v), new THREE.Vector3(...n)));
    const quad = new THREE.Mesh(geo, planeTexture(name, false));
    quad.renderOrder = 6;
    quad.userData = { originPlane: name };
    vp.paths.add(quad);
  }
  // axes and origin point like the usual origin while picking
  for (const [d, col] of [[[1, 0, 0], 0xe5484d], [[0, 1, 0], 0x40c057], [[0, 0, 1], 0x2a8fff]]) {
    const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3(...d).multiplyScalar(s * 1.15)]), new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true }));
    l.renderOrder = 7;
    vp.paths.add(l);
  }
  const dot = new THREE.Points(new THREE.BufferGeometry().setFromPoints([new THREE.Vector3()]), new THREE.PointsMaterial({ color: 0xf2f2f2, size: 9, sizeAttenuation: false, depthTest: false, transparent: true }));
  dot.renderOrder = 8;
  vp.paths.add(dot);
}
// pickable planes in the scene: origin planes and visible construction planes
function pickablePlanes() {
  const out = vp.paths.children.filter(o => o.userData.originPlane);
  vp.sketches.traverse(o => { if (o.isMesh && o.userData.plane) out.push(o); });
  return out;
}
// the plane under the mouse, if it is in front of every body face
function planeUnderMouse(e) {
  const ph = vp.raycast(e, pickablePlanes())[0];
  if (!ph) return null;
  const mh = vp.raycast(e, vp.model.children.filter(o => o.isMesh))[0];
  return !mh || ph.distance <= mh.distance + 1e-6 ? ph.object : null;
}
let hoverPlane = null;
function setHoverPlane(obj) {
  if (hoverPlane === obj) return;
  if (hoverPlane) hoverPlane.material = hoverPlane.userData.baseMat || hoverPlane.material;
  hoverPlane = obj;
  if (obj) {
    obj.userData.baseMat = obj.material;
    obj.material = obj.userData.originPlane ? planeTexture(obj.userData.originPlane, true) : matPlaneSel;
  }
  vp.canvas.style.cursor = obj ? 'pointer' : '';
}
function planeRefOptions(exceptId) {
  const fs = state.project.features;
  let upto = exceptId ? fs.findIndex(f => f.id === exceptId) : fs.length;
  if (upto < 0) upto = fs.length;
  const before = fs.slice(0, upto);
  return [['XY', 'XY-Ebene'], ['XZ', 'XZ-Ebene'], ['YZ', 'YZ-Ebene'],
    ...before.filter(f => f.type === 'plane').map(f => [f.id, f.name]),
    ...before.filter(f => f.type === 'sketch').map(f => [f.id, `Ebene von ${f.name}`])];
}
function sketchOnPlaneFeature(id) {
  const f = resolved().features.find(x => x.id === id);
  const pl = f && constructionPlane(f, resolved().features);
  if (!pl) return status('Ebene kann nicht berechnet werden.');
  state.pick = null;
  showBanner(null);
  const sid = uid('sk');
  insertFeature({ id: sid, type: 'sketch', name: nextName(state.project.features, 'Skizze'), plane: pl, planeRef: id, entities: [] });
  editSketch(sid);
}

// Points, selection highlights, dimension and constraint labels of the active sketch.
function sketchOverlay(sk) {
  const g = new THREE.Group();
  g.matrixAutoUpdate = false;
  g.matrix.copy(planeMatrixOf(sk));
  const H = sketchHandles(sk.entities);
  const V = (p, z = 0.08) => new THREE.Vector3(p[0], p[1], z);
  const dark = isDark();
  const pts = H.points.filter(x => x.ref !== 'origin').map(x => V(x.p));
  if (pts.length) {
    const d = new THREE.Points(new THREE.BufferGeometry().setFromPoints(pts), new THREE.PointsMaterial({ color: dark ? 0xdfe6ee : 0x2a3440, size: 5, sizeAttenuation: false, depthTest: false, transparent: true }));
    d.renderOrder = 7;
    g.add(d);
  }
  g.userData.skOverlay = true;
  const wpp = vp.worldPerPixel();
  // selection, picked edges of the dimension tool and the edge under the mouse: thick bands
  const band = (refs, color, px) => {
    const selPts = [], tris = [];
    const seg = (a, b) => {
      const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1, w = (px * wpp) / 2;
      const nx = (-dy / L) * w, ny = (dx / L) * w;
      tris.push(V([a[0] + nx, a[1] + ny], 0.1), V([b[0] + nx, b[1] + ny], 0.1), V([b[0] - nx, b[1] - ny], 0.1), V([a[0] + nx, a[1] + ny], 0.1), V([b[0] - nx, b[1] - ny], 0.1), V([a[0] - nx, a[1] - ny], 0.1));
    };
    for (const ref of refs) {
      try {
        const k = refKind(ref);
        if (k === 'P') selPts.push(V(H.point(ref), 0.1));
        else if (k === 'L') { const [a, b] = ref === 'xaxis' ? [[-500, 0], [500, 0]] : ref === 'yaxis' ? [[0, -500], [0, 500]] : H.line(ref); seg(a, b); }
        else if (k === 'O') { const c = H.circle(ref), s0 = c.span ? c.span.a0 : 0, sw = c.span ? c.span.sw : Math.PI * 2; for (let i = 0; i < 64; i++) { const a0 = s0 + (i / 64) * sw, a1 = s0 + ((i + 1) / 64) * sw; seg([c.c[0] + c.r * Math.cos(a0), c.c[1] + c.r * Math.sin(a0)], [c.c[0] + c.r * Math.cos(a1), c.c[1] + c.r * Math.sin(a1)]); } }
      } catch { /* handle gone */ }
    }
    if (selPts.length) { const d = new THREE.Points(new THREE.BufferGeometry().setFromPoints(selPts), new THREE.PointsMaterial({ color, size: px + 7, sizeAttenuation: false, depthTest: false, transparent: true })); d.renderOrder = 9; g.add(d); }
    if (tris.length) { const m = new THREE.Mesh(new THREE.BufferGeometry().setFromPoints(tris), new THREE.MeshBasicMaterial({ color, depthTest: false, transparent: true, side: THREE.DoubleSide })); m.renderOrder = 9; g.add(m); }
  };
  if (sketcher.hoverRef) band([sketcher.hoverRef], 0x6cc4ff, 3);
  band([...sketcher.selection, ...(sketcher.dim?.refs || [])], 0x0696d7, 3.5);
  // constraint glyphs and dimension labels
  const unsat = new Set(sketchInfo(sk.id).unsatisfied);
  const dimLines = [];
  const anchorOf = ref => {
    const k = refKind(ref);
    if (k === 'P') return H.point(ref);
    if (k === 'L') { const [a, b] = ref === 'xaxis' ? [[10, 0], [10, 0]] : ref === 'yaxis' ? [[0, 10], [0, 10]] : H.line(ref); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    const c = H.circle(ref); return [c.c[0] + c.r * 0.707, c.c[1] + c.r * 0.707];
  };
  const raw = feature(sk.id);
  const prefs = getSettings();
  // dimension following the mouse while placing it
  const ghost = sketcher.dimPreview ? (() => {
    const d = sketcher.dimPreview;
    try { const v = measureDim(sk.entities, d); return Number.isFinite(v) ? { id: '__ghost', type: 'dim', ...d, value: Math.abs(v) } : null; } catch { return null; }
  })() : null;
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1]], add2 = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k];
  const unit = v => { const L = Math.hypot(v[0], v[1]); return L > 1e-9 ? [v[0] / L, v[1] / L] : [1, 0]; };
  const arrow = (tip, dir) => {
    const n = [-dir[1], dir[0]], s = 8 * wpp, w = 2.6 * wpp;
    dimLines.push(V(tip, 0.06), V([tip[0] - dir[0] * s + n[0] * w, tip[1] - dir[1] * s + n[1] * w], 0.06), V(tip, 0.06), V([tip[0] - dir[0] * s - n[0] * w, tip[1] - dir[1] * s - n[1] * w], 0.06));
  };
  // common CAD/CAM-style dimension with extension lines, placed where the user dragged it (base + lp)
  const placedDim = (c, lp) => {
    const base = dimBase(H, c);
    const label = add2(base, lp);
    const ext = (from, to, nrm, d) => { dimLines.push(V(from, 0.06), V(add2(to, nrm, Math.sign(d) * 4 * wpp), 0.06)); };
    if (c.kind === 'length' || c.kind === 'dist') {
      const [p, q] = c.kind === 'length' ? H.line(c.refs[0]) : [H.point(c.refs[0]), H.point(c.refs[1])];
      const u = unit(sub(q, p)), n = [-u[1], u[0]], d = lp[0] * n[0] + lp[1] * n[1];
      const P2 = add2(p, n, d), Q2 = add2(q, n, d);
      ext(p, P2, n, d); ext(q, Q2, n, d);
      dimLines.push(V(P2, 0.06), V(Q2, 0.06));
      arrow(P2, [-u[0], -u[1]]); arrow(Q2, u);
    } else if (c.kind === 'hdist' || c.kind === 'vdist') {
      const a = H.point(c.refs[0]), b = H.point(c.refs[1]), hz = c.kind === 'hdist';
      const A2 = hz ? [a[0], label[1]] : [label[0], a[1]], B2 = hz ? [b[0], label[1]] : [label[0], b[1]];
      ext(a, A2, hz ? [0, 1] : [1, 0], hz ? label[1] - a[1] : label[0] - a[0]);
      ext(b, B2, hz ? [0, 1] : [1, 0], hz ? label[1] - b[1] : label[0] - b[0]);
      dimLines.push(V(A2, 0.06), V(B2, 0.06));
      const u = unit(sub(B2, A2));
      arrow(A2, [-u[0], -u[1]]); arrow(B2, u);
    } else if (c.kind === 'diameter' || c.kind === 'radius') {
      const o = H.circle(c.refs[0]), w = unit(lp), L = Math.hypot(lp[0], lp[1]);
      const far = add2(o.c, w, Math.max(o.r, L));
      dimLines.push(V(c.kind === 'diameter' ? add2(o.c, w, -o.r) : o.c, 0.06), V(far, 0.06));
      arrow(add2(o.c, w, o.r), w);
      if (c.kind === 'diameter') arrow(add2(o.c, w, -o.r), [-w[0], -w[1]]);
    } else if (c.kind === 'pldist') {
      const [pr, lr] = refKind(c.refs[0]) === 'P' ? c.refs : [c.refs[1], c.refs[0]];
      const pt = H.point(pr), [la, lb] = H.line(lr), u = unit(sub(lb, la));
      const t = (pt[0] - la[0]) * u[0] + (pt[1] - la[1]) * u[1], foot = add2(la, u, t);
      dimLines.push(V(pt, 0.06), V(foot, 0.06));
    }
    return label;
  };
  for (const c of [...(sk.constraints || []), ghost].filter(Boolean)) {
    try {
      if (c.type === 'dim' ? prefs.sketchDims === false : prefs.sketchGlyphs === false) continue;
      let pos, text;
      const isGhost = c.id === '__ghost';
      const lp = dimDrag?.cid === c.id ? dimDrag.lp : c.lp;
      if (c.type === 'dim' && lp) {
        const rc = raw.constraints.find(x => x.id === c.id);
        text = (typeof rc?.value === 'string' ? 'ƒ ' : '') + (c.kind === 'diameter' ? 'Ø' : c.kind === 'radius' ? 'R' : '') + f2(c.value) + (c.kind === 'angle' ? '°' : '');
        pos = placedDim(c, lp);
      } else if (c.type === 'dim') {
        const rc = raw.constraints.find(x => x.id === c.id);
        const isExpr = typeof rc?.value === 'string';
        text = (isExpr ? 'ƒ ' : '') + (c.kind === 'diameter' ? 'Ø' : c.kind === 'radius' ? 'R' : '') + f2(c.value) + (c.kind === 'angle' ? '°' : '');
        const a = anchorOf(c.refs[0]), b = c.refs[1] ? anchorOf(c.refs[1]) : null;
        if (c.kind === 'length') { const [p, q] = H.line(c.refs[0]); dimLines.push(V(p, 0.06), V(q, 0.06)); }
        else if ((c.kind === 'dist' || c.kind === 'hdist' || c.kind === 'vdist') && b) {
          const q = c.kind === 'hdist' ? [b[0], a[1]] : c.kind === 'vdist' ? [a[0], b[1]] : b;
          dimLines.push(V(a, 0.06), V(q, 0.06));
          if (c.kind !== 'dist') dimLines.push(V(q, 0.06), V(b, 0.06));
        } else if (c.kind === 'diameter' || c.kind === 'radius') { const o = H.circle(c.refs[0]); dimLines.push(V([o.c[0] - (c.kind === 'diameter' ? o.r : 0), o.c[1]], 0.06), V([o.c[0] + o.r, o.c[1]], 0.06)); }
        pos = c.kind === 'length' ? a : b ? [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] : a;
        if (c.kind === 'hdist' && b) pos = [(a[0] + b[0]) / 2, a[1]];
        if (c.kind === 'vdist' && b) pos = [a[0], (a[1] + b[1]) / 2];
      } else {
        text = GLYPH[c.type] || '?';
        const anchors = c.refs.map(anchorOf);
        pos = anchors[anchors.length > 1 && c.type !== 'symmetric' ? 0 : anchors.length - 1];
      }
      let el;
      if (c.type === 'dim' && c.id === dimEdit) {
        // value box right at the dimension (Enter = apply, Esc = keep)
        const rc = raw.constraints.find(x => x.id === c.id);
        const inp = h('input', { type: 'text', value: String(rc?.value ?? c.value), spellcheck: 'false' });
        let done = false;
        const finish = ok => { if (done) return; done = true; if (ok) applyDimEdit(c.id, inp.value); else { dimEdit = null; refreshSketchOverlay(); } };
        inp.addEventListener('keydown', ev => { ev.stopPropagation(); if (ev.key === 'Enter') { ev.preventDefault(); finish(true); } if (ev.key === 'Escape') { ev.preventDefault(); finish(false); } });
        inp.addEventListener('blur', () => setTimeout(() => finish(true), 0));
        el = h('div', { class: 'sk-label dim edit at', onpointerdown: ev => ev.stopPropagation() }, c.kind === 'diameter' ? 'Ø' : c.kind === 'radius' ? 'R' : '', inp, c.kind === 'angle' ? '°' : 'mm');
        if (dimEditFocus) { dimEditFocus = false; setTimeout(() => { inp.focus(); inp.select(); }, 0); }
      } else {
        el = h('div', {
          class: `sk-label ${c.type === 'dim' ? 'dim' : 'glyph'} ${lp && c.type === 'dim' ? 'at' : ''} ${isGhost ? 'ghost' : ''} ${unsat.has(c.id) ? 'bad' : ''} ${sketcher.selConstraint === c.id ? 'sel' : ''}`,
          title: isGhost ? '' : `${CONSTRAINTS[c.type]}${c.type === 'dim' ? ' – ' + DIM_KINDS[c.kind] + ' (ziehen = verschieben, Doppelklick = Wert ändern)' : ' (klicken zum Bearbeiten)'}`,
          onpointerdown: ev => { ev.stopPropagation(); if (c.type === 'dim' && !isGhost && ev.button === 0) startDimDrag(ev, c, sk); },
          onclick: ev => {
            ev.stopPropagation();
            if (el._dragged) return;
            sketcher.selConstraint = c.id; renderProps(); rebuildScene();
            if (c.type !== 'dim') setTimeout(() => document.querySelector(`[data-cid="${c.id}"] input`)?.focus(), 0);
          },
          ondblclick: ev => { ev.stopPropagation(); if (c.type === 'dim' && !isGhost) { dimEdit = c.id; dimEditFocus = true; refreshSketchOverlay(); } },
        }, text);
      }
      const o = new CSS2DObject(el);
      o.position.copy(V(pos, 0.1));
      g.add(o);
    } catch { /* constraint references a deleted handle */ }
  }
  if (dimLines.length) g.add(new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(dimLines), new THREE.LineBasicMaterial({ color: 0x0696d7, depthTest: false, transparent: true, opacity: 0.7 })));
  return g;
}

function selectedEdgeRefs() {
  if (state.workspace !== 'design') return [];
  const id = state.pick?.mode === 'edges' ? state.pick.id : state.sel?.kind === 'feature' ? state.sel.id : null;
  const f = id && feature(id);
  if (!f || (f.type !== 'fillet' && f.type !== 'chamfer') || f.all) return [];
  return state.pick?.mode === 'edges' ? f.edges || [] : [];
}

function lineSeg(arr, mat) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
  const l = new THREE.LineSegments(g, mat);
  if (mat.isLineDashedMaterial) l.computeLineDistances();
  return l;
}

function drawCam() {
  const g = activeGen();
  if (!g || !g.stock) return;
  const s = g.stock;
  // toolpaths live in the setup frame; show them in model orientation
  const grp = new THREE.Group();
  grp.matrixAutoUpdate = false;
  grp.matrix.copy(g.T).invert();
  vp.paths.add(grp);
  if (!sim.open) {
    // turning stock is a cylinder around Z, milling stock a block
    const sh = s.shape;
    const cylAlong = (r, sh2) => {
      const g2 = new THREE.CylinderGeometry(r, r, sh2.hi - sh2.lo, 64, 1, true); // along Y
      if (sh2.axis === 'z') g2.rotateX(Math.PI / 2).translate(sh2.cu, sh2.cv, (sh2.lo + sh2.hi) / 2);
      else if (sh2.axis === 'x') g2.rotateZ(Math.PI / 2).translate((sh2.lo + sh2.hi) / 2, sh2.cu, sh2.cv);
      else g2.translate(sh2.cu, (sh2.lo + sh2.hi) / 2, sh2.cv);
      return g2;
    };
    const geos = s.kind === 'turn'
      ? [new THREE.CylinderGeometry(s.r, s.r, s.top - s.bottom, 48, 1, true).rotateX(Math.PI / 2).translate(0, 0, (s.top + s.bottom) / 2)]
      : sh?.type === 'cyl' ? [cylAlong(sh.r, sh), ...(sh.ri > 0 ? [cylAlong(sh.ri, sh)] : [])]
        : [new THREE.BoxGeometry(s.maxX - s.minX, s.maxY - s.minY, s.top - s.bottom).translate((s.minX + s.maxX) / 2, (s.minY + s.maxY) / 2, (s.top + s.bottom) / 2)];
    for (const box of geos) {
      grp.add(new THREE.LineSegments(new THREE.EdgesGeometry(box, 30), new THREE.LineBasicMaterial({ color: 0xc0852f })));
      // the stock as a light, see-through body
      const fill = new THREE.Mesh(box, new THREE.MeshBasicMaterial({ color: 0xd9a35a, transparent: true, opacity: 0.1, depthWrite: false, side: THREE.DoubleSide }));
      fill.renderOrder = 2;
      grp.add(fill);
    }
  }
  const o = originOf(g.setup, s);
  const axes = new THREE.AxesHelper(15);
  axes.position.set(o.x, o.y, o.z);
  grp.add(axes);
  if (sim.open && !$('#simPaths').checked) return;
  //: a selected operation shows only its own toolpath, the setup (or nothing) shows all
  const selOp = state.sel?.kind === 'op' ? state.sel.id : null;
  const mk = r => Math.max(0.35, vp.worldPerPixel() * 4 || 0.6);
  for (const op of g.ops) {
    if (op.enabled === false) continue;
    if (selOp && selOp !== op.id) continue;
    const r = g.results.get(op.id);
    if (!r || !r.moves.length) continue;
    // colours: blue = cutting, yellow (dashed) = rapid, red = straight plunge, green = ramp / lead (feed with Z change)
    const feed = [], plunge = [], ramp = [], rapid = [];
    for (let i = 1; i < r.moves.length; i++) {
      const a = r.moves[i - 1], b = r.moves[i];
      const dz = Math.abs(b.z - a.z), dxy = Math.hypot(b.x - a.x, b.y - a.y);
      const arr = b.t === 'r' ? rapid : dxy < 1e-6 ? plunge : dz > 1e-4 && dz > dxy * 0.02 ? ramp : feed;
      arr.push(a.x, a.y, a.z, b.x, b.y, b.z);
    }
    grp.add(
      lineSeg(feed, new THREE.LineBasicMaterial({ color: isDark() ? 0x4ea8ff : 0x1565c0 })),
      lineSeg(ramp, new THREE.LineBasicMaterial({ color: 0x2fb344 })),
      lineSeg(plunge, new THREE.LineBasicMaterial({ color: 0xe03131 })),
      lineSeg(rapid, new THREE.LineDashedMaterial({ color: 0xf2c200, dashSize: 2, gapSize: 1.5 })),
    );
    // start (green) and end (red) of the operation's cutting moves
    const cut = r.moves.filter(m => m.t !== 'r');
    if (selOp && cut.length) {
      for (const [m, col] of [[cut[0], 0x2fb344], [cut[cut.length - 1], 0xe03131]]) {
        const s = new THREE.Mesh(new THREE.SphereGeometry(mk(), 12, 8), new THREE.MeshBasicMaterial({ color: col, depthTest: false, transparent: true }));
        s.position.set(m.x, m.y, m.z);
        s.renderOrder = 30;
        grp.add(s);
      }
    }
  }
}

// ---------- toolbar ----------
let lastCmd = null;
function tbtn(icon, label, onClick, cls = '', title = '') {
  const run = e => { if (!/active/.test(cls)) lastCmd = { icon, label, fn: onClick }; onClick(e); };
  const b = h('button', { class: 'tbtn ' + cls, onclick: run, title: title || label, html: ICONS[icon] + `<span>${label}</span>` });
  b.dataset.icon = icon;
  return b;
}
const gbtn = (glyph, label, onClick, title) => h('button', { class: 'tbtn gl', onclick: onClick, title: title || label }, h('b', { class: 'glyph-ic' }, glyph), h('span', null, label));
// Like a group shows its main tools; the label opens a dropdown with all of them.
const GROUP_VISIBLE = { VERWALTEN: 4, 'EINFÜGEN': 4, ERSTELLEN: 7, 'ÄNDERN': 6, 'ABHÄNGIGKEITEN': 8, SKIZZE: 8, KONSTRUKTION: 3, '2D-FRÄSEN': 6, '3D-FRÄSEN': 5, 'FLÄCHE ERSTELLEN': 7 };
// Which commands sit in the toolbar is up to the user (⋮ in the group dropdown).
// The buttons of a group are placed by fillGroup() once the tab is known.
function tgroup(label, ...items) {
  items = items.filter(Boolean);
  const buttons = items.every(it => it.tagName === 'BUTTON');
  const lbl = buttons
    ? h('button', { class: 'tgroup-label dd', onclick: e => openToolDrop(e.currentTarget.closest('.tgroup')) }, label, h('span', { class: 'caret' }, '▾'))
    : h('div', { class: 'tgroup-label' }, label);
  const g = h('div', { class: 'tgroup' }, h('div', { class: 'tgroup-items' }, ...(buttons ? [] : items)), lbl);
  if (buttons) { g._items = items; g._label = label; }
  return g;
}

const loadJ = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const saveJ = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* storage unavailable */ } };
// ---- post processor library: own posts available in every project (the project keeps a copy of the ones it uses) ----
const POST_LIB = 'openfab.posts.v1';
let postLibCache = null;
const libPosts = () => (postLibCache ||= loadJ(POST_LIB, []));
const cleanPost = def => { const { libOnly, ...d } = def; return JSON.parse(JSON.stringify(d)); };
const saveLibPost = def => { if (!def || def.builtin) return; const d = cleanPost(def); postLibCache = [...libPosts().filter(x => x.id !== d.id), d]; saveJ(POST_LIB, postLibCache); };
const dropLibPost = id => { postLibCache = libPosts().filter(x => x.id !== id); saveJ(POST_LIB, postLibCache); };
const libPost = id => libPosts().find(x => x.id === id);
// a post from the library that the project uses gets copied into the project (the file stays complete)
const ensurePost = (pp, id) => { const lp = libPost(id); if (lp && !(pp.posts || []).some(x => x.id === id)) (pp.posts ||= []).push(cleanPost(lp)); };
setPostLibrary(libPosts);
const tbPins = loadJ('openfab.toolbar.v1', {});      // "workspace|tab|group" → command ids shown in the toolbar
let tbShortcuts = loadJ('openfab.shortcuts.v1', []); // command ids pinned to "Verknüpfungen" (S box)
const tbKeys = loadJ('openfab.keys.v1', {});         // command id → key combo
const cmdLabel = b => (b.querySelector('span') ? deText(b.querySelector('span')) : '') || deAttr(b, 'title');
const cmdId = b => (b.dataset.icon || 'g') + '|' + cmdLabel(b);
const groupKey = (tab, label) => `${state.workspace}|${tab}|${label}`;
function pinnedIds(g) {
  return tbPins[groupKey(g._tab, g._label)] ?? g._items.slice(0, GROUP_VISIBLE[g._label] ?? g._items.length).map(cmdId);
}
function fillGroup(g, tab) {
  if (!g._items) return;
  g._tab = tab;
  const ids = new Set(pinnedIds(g));
  g.querySelector('.tgroup-items').replaceChildren(...g._items.filter(b => ids.has(cmdId(b))));
}
function setPinned(g, b, on) {
  const id = cmdId(b);
  const ids = pinnedIds(g).filter(x => x !== id);
  if (on) ids.push(id);
  tbPins[groupKey(g._tab, g._label)] = ids;
  saveJ('openfab.toolbar.v1', tbPins);
  renderToolbar();
}
function setShortcutPinned(b, on) {
  const id = cmdId(b);
  tbShortcuts = tbShortcuts.filter(x => x !== id);
  if (on) tbShortcuts.push(id);
  saveJ('openfab.shortcuts.v1', tbShortcuts);
}
// key shown next to a command: user binding first, else the built-in one from the tooltip "(E)"
const builtinKey = b => (b.title.match(/\(([A-Z])\)/) || [])[1] || '';
const cmdKey = b => tbKeys[cmdId(b)] ?? builtinKey(b);

let toolDrop = null;
function closeToolDrop() {
  if (!toolDrop) return;
  toolDrop.remove();
  toolDrop = null;
  document.querySelector('.tdrop-sub')?.remove();
  document.removeEventListener('pointerdown', onDropOutside, true);
}
function onDropOutside(e) { if (toolDrop && !toolDrop.contains(e.target) && !e.target.closest('.tdrop-sub')) closeToolDrop(); }
function openToolDrop(g) {
  if (toolDrop) return closeToolDrop();
  const items = g._items;
  toolDrop = h('div', { class: 'tdrop' }, ...items.map(it => {
    const row = h('div', { class: 'tdrop-row' },
      h('button', {
        class: 'tdrop-item' + (it.classList.contains('active') ? ' active' : ''), title: it.title,
        html: it.innerHTML, onclick: () => { closeToolDrop(); it.click(); },
      }),
      cmdKey(it) ? h('span', { class: 'tdrop-key' }, cmdKey(it)) : null,
      h('button', { class: 'tdrop-more', title: 'Optionen', onclick: e => { e.stopPropagation(); openPinMenu(row, g, it); } }, '⋮'));
    return row;
  }),
  h('div', { class: 'tdrop-sep' }),
  h('button', { class: 'tdrop-reset', onclick: () => { delete tbPins[groupKey(g._tab, g._label)]; saveJ('openfab.toolbar.v1', tbPins); closeToolDrop(); renderToolbar(); } }, 'Werkzeugkasten zurücksetzen'));
  const r = g.getBoundingClientRect();
  toolDrop.style.left = Math.min(r.left, innerWidth - 270) + 'px';
  toolDrop.style.top = r.bottom + 2 + 'px';
  document.body.append(toolDrop);
  document.addEventListener('pointerdown', onDropOutside, true);
}
// the small menu behind ⋮ (pin to toolbox / shortcuts, change keyboard shortcut)
function openPinMenu(row, g, b) {
  document.querySelector('.tdrop-sub')?.remove();
  for (const x of toolDrop.querySelectorAll('.tdrop-row.on')) x.classList.remove('on');
  row.classList.add('on');
  const id = cmdId(b);
  const chk = (label, on, fn) => h('label', { class: 'tdrop-chk' }, h('input', { type: 'checkbox', checked: on, onchange: e => fn(e.target.checked) }), h('span', null, label));
  const sub = h('div', { class: 'tdrop-sub' },
    chk('An Werkzeugkasten fixieren', pinnedIds(g).includes(id), on => setPinned(g, b, on)),
    chk('An Verknüpfungen fixieren', tbShortcuts.includes(id), on => setShortcutPinned(b, on)),
    h('button', { onclick: () => { closeToolDrop(); editShortcut(b); } }, 'Tastaturkurzbefehl ändern …'));
  document.body.append(sub);
  const dr = toolDrop.getBoundingClientRect(), rr = row.getBoundingClientRect(), sr = sub.getBoundingClientRect();
  sub.style.left = (dr.right + sr.width + 4 > innerWidth ? dr.left - sr.width + 2 : dr.right - 2) + 'px';
  sub.style.top = Math.min(innerHeight - sr.height - 8, rr.top - 4) + 'px';
}

// keyboard shortcuts the user assigns to toolbar commands
const RESERVED_KEYS = ['Strg+Z', 'Strg+Y', 'Strg+S', 'Strg+N', 'Strg+Umschalt+Z', 'S', 'Escape', 'Enter', 'Delete', 'Tab'];
function keyCombo(e) {
  if (['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock'].includes(e.key)) return '';
  const k = e.key === ' ' ? 'Leertaste' : e.key.length === 1 ? e.key.toUpperCase() : e.key;
  return [(e.ctrlKey || e.metaKey) && 'Strg', e.altKey && 'Alt', e.shiftKey && 'Umschalt', k].filter(Boolean).join('+');
}
function editShortcut(b) {
  const id = cmdId(b);
  let combo = tbKeys[id] ?? '';
  const field = h('input', { type: 'text', class: 'ksc-field', readonly: true, value: combo, placeholder: 'Taste oder Tastenkombination drücken …' });
  const note = h('div', { class: 'ksc-note' });
  const okBtn = h('button', { class: 'primary' }, 'OK');
  const check = () => {
    note.className = 'ksc-note';
    okBtn.disabled = false;
    if (!combo) { note.textContent = builtinKey(b) ? `Ohne eigene Taste gilt der Standard „${builtinKey(b)}“.` : 'Keine Taste zugewiesen.'; return; }
    if (RESERVED_KEYS.includes(combo)) { note.textContent = `„${combo}“ ist fest belegt und kann nicht verwendet werden.`; note.classList.add('err'); okBtn.disabled = true; return; }
    const other = Object.entries(tbKeys).find(([k, v]) => v === combo && k !== id);
    const std = { E: 'Extrusion', H: 'Bohrung', K: 'Skizze', F: 'Einpassen', V: 'Ein-/Ausblenden', D: 'Bemaßung (Skizze)' }[combo];
    if (other) { note.textContent = `Bereits belegt durch „${other[0].split('|')[1]}“ – wird dort entfernt.`; note.classList.add('warn'); }
    else if (std && builtinKey(b) !== combo) { note.textContent = `Ersetzt den Standard-Kurzbefehl „${std}“.`; note.classList.add('warn'); }
    else note.textContent = '';
  };
  field.addEventListener('keydown', e => {
    if (e.key === 'Tab') return;
    e.preventDefault();
    e.stopPropagation();
    if ((e.key === 'Backspace' || e.key === 'Delete') && !e.ctrlKey && !e.altKey && !e.shiftKey) combo = '';
    else if (e.key === 'Escape') return close();
    else { const c = keyCombo(e); if (!c) return; combo = c; }
    field.value = combo;
    check();
  });
  const back = h('div', { class: 'modal-back' });
  const close = () => back.remove();
  okBtn.onclick = () => {
    for (const [k, v] of Object.entries(tbKeys)) if (v === combo && k !== id) delete tbKeys[k];
    if (combo) tbKeys[id] = combo; else delete tbKeys[id];
    saveJ('openfab.keys.v1', tbKeys);
    close();
    renderToolbar();
    status(combo ? `„${cmdLabel(b)}“ liegt jetzt auf ${combo}.` : `Eigener Kurzbefehl für „${cmdLabel(b)}“ entfernt.`);
  };
  back.append(h('div', { class: 'modal ksc' },
    h('div', { class: 'modal-head' }, 'TASTATURKURZBEFEHL ÄNDERN', h('button', { onclick: close }, '✕')),
    h('div', { class: 'ksc-body' },
      h('div', { class: 'ksc-cmd', html: (ICONS[b.dataset.icon] || '') + `<span>${cmdLabel(b)}</span>` }),
      h('label', null, 'Kurzbefehl'), field, note,
      h('div', { class: 'ksc-hint' }, 'Rücktaste löscht die Zuweisung.')),
    h('div', { class: 'modal-foot' },
      h('button', { onclick: () => { combo = ''; field.value = ''; check(); } }, 'Entfernen'),
      h('span', { style: 'flex:1' }),
      h('button', { onclick: close }, 'Abbrechen'), okBtn)));
  document.body.append(back);
  check();
  field.focus();
}

// Toolbar tabs per workspace (SOLID, SURFACE, SHEET METAL, UTILITIES / MILLING, TURNING ...)
const uiTab = { design: 'VOLUMENKÖRPER', cam: 'FRÄSEN', render: 'RENDERN' };
function toolbarTabs() {
  const tabs = {};
  if (state.workspace === 'design' && state.sketchId) {
    const T = (icon, label, tool, key) => tbtn(icon, label, () => sketcher.setTool(tool), sketcher.tool === tool ? 'active' : '', `${label} (${key})`);
    tabs.SKIZZE = [
      tgroup('SKIZZE', T('select', 'Auswahl', 'select', 'S'), T('line', 'Linie', 'line', 'L'), T('arc', '3-Punkt-Bogen', 'arc', 'A'), T('rect', 'Rechteck', 'rect', 'R'), T('circle', 'Kreis', 'circle', 'C'),
        T('ellipse', 'Ellipse', 'ellipse', 'E'), T('spline', 'Spline', 'spline', 'B'), T('ngon', 'Polygon', 'ngon', 'P'), T('slot', 'Langloch', 'slot', 'O'), tbtn('text', 'Text', () => sketcher.setTool('text'), sketcher.tool === 'text' ? 'active' : '', 'Text'),
        ...[['rectc', 'Mittelpunkt-Rechteck', 'rectc'], ['rect3', '3-Punkt-Rechteck', 'rect3'], ['circle2', '2-Punkt-Kreis', 'circle2'], ['circle3', '3-Punkt-Kreis', 'circle3'], ['arcc', 'Mittelpunkt-Bogen', 'arcc'], ['arct', 'Tangentialbogen', 'arct']]
          .map(([icon, label, tool]) => tbtn(icon, label, () => sketcher.setTool(tool), sketcher.tool === tool ? 'active' : '', label)),
        tbtn('project', 'Projizieren', () => startProject('face'), sketcher.tool === 'project' && projectMode === 'face' ? 'active' : '', 'Projizieren (J): Fläche oder Kante eines Körpers anklicken – ihr Abbild kommt in die Skizze'),
        tbtn('combine', 'Körperumriss projizieren', () => startProject('body'), sketcher.tool === 'project' && projectMode === 'body' ? 'active' : '', 'Körperumriss projizieren: Körper anklicken – sein Schattenriss auf der Skizzenebene'),
        tbtn('section', 'Schnittkurven', () => startProject('cut'), sketcher.tool === 'project' && projectMode === 'cut' ? 'active' : '', 'Schnittkurven: Körper anklicken – wo die Skizzenebene ihn schneidet')),
      tgroup('EINFÜGEN', tbtn('decal', 'Bild nachzeichnen', traceImageDialog, '', 'Bild nachzeichnen: aus einem Bild Konturen oder Mittellinien als Skizzenkurven, SVG oder DXF erzeugen'),
        tbtn('canvas', 'Bild als Vorlage', insertCanvas, '', 'Bild als Vorlage auf die Skizzenebene legen (zum Nachzeichnen von Hand)'),
        tbtn('measure', 'Vorlage kalibrieren', () => calibrateCanvas(), '', 'Vorlage kalibrieren: zwei Punkte im Bild anklicken und ihren wirklichen Abstand eingeben'),
        tbtn('svgfile', 'SVG einfügen', insertSVG, '', 'SVG-Datei in diese Skizze einfügen'),
        tbtn('dxffile', 'DXF einfügen', () => $('#dxfInput').click(), '', 'DXF-Datei in diese Skizze einfügen')),
      tgroup('ÄNDERN', T('trim', 'Stutzen', 'trim', 'T'), tbtn('extend', 'Verlängern', () => sketcher.setTool('extend'), sketcher.tool === 'extend' ? 'active' : '', 'Verlängern: offenes Linienende bis zur nächsten Kante'),
        tbtn('fillet', 'Abrunden', sketchFillet, sketcher.tool === 'fillet' ? 'active' : '', 'Abrunden: Ecken anklicken (Linienzug, Rechteck, zwei Linien)'),
        tbtn('edgechamfer', 'Fase', sketchChamfer, sketcher.tool === 'chamfer' ? 'active' : '', 'Fase: Ecken anklicken (Linienzug, Rechteck, zwei Linien)'),
        tbtn('offset', 'Versatz', sketchOffset, sketcher.tool === 'offset' ? 'active' : '', 'Versatz: neben eine Kontur fahren (Vorschau), klicken, Abstand bestätigen – auch offene Linienzüge'),
        tbtn('sketchMirror', 'Spiegeln', sketchMirror, sketcher.tool === 'mirror' ? 'active' : '', 'Spiegeln: Elemente wählen, dann die Spiegelachse anklicken (Vorschau)'),
        tbtn('patternRect', 'Rechteck-Muster', () => sketchPattern('rect'), sketcher.tool === 'prect' ? 'active' : '', 'Rechteckige Anordnung: Elemente wählen, dann den Abstand zeigen (Vorschau)'),
        tbtn('patternCirc', 'Kreis-Muster', () => sketchPattern('circ'), sketcher.tool === 'pcirc' ? 'active' : '', 'Runde Anordnung: Elemente wählen, dann den Mittelpunkt zeigen (Vorschau)'),
        tbtn('move', 'Verschieben/Kopieren', () => sketchMoveTool('xmove'), sketcher.tool === 'xmove' ? 'active' : '', 'Verschieben oder kopieren: Elemente wählen, dann Ausgangspunkt und Zielpunkt anklicken (Vorschau); der Weg lässt sich danach als Zahl ändern'),
        tbtn('revolve', 'Drehen', () => sketchMoveTool('xrot'), sketcher.tool === 'xrot' ? 'active' : '', 'Drehen: Elemente wählen, dann Drehpunkt anklicken und den Winkel mit der Maus zeigen (Vorschau); auch als Kopie'),
        tbtn('scale', 'Skalieren', () => sketchTransform('scale'), '', 'Skalieren: Elemente wählen, dann Faktor und Fixpunkt angeben')),
      tgroup('ABHÄNGIGKEITEN',
        Object.assign(gbtn('↔', 'Bemaßung', addDimension, 'Bemaßung (D): Kante, Kreis oder Punkte anklicken, Maß wegziehen und ablegen'), { className: 'tbtn gl' + (sketcher.tool === 'dim' ? ' active' : '') }),
        ...['coincident', 'horizontal', 'vertical', 'parallel', 'perpendicular', 'equal', 'tangent', 'concentric', 'midpoint', 'symmetric', 'collinear', 'fix']
          .map(t => gbtn(GLYPH[t], CONSTRAINTS[t], () => applyConstraint(t)))),
      tgroup('FANG', h('div', { class: 'tinput' }, 'Raster', num(state.snap, v => { state.snap = v; }, { min: 0 }))),
      tgroup('BEENDEN', tbtn('finish', 'Skizze fertig', finishSketch, 'primary big')),
    ];
    return tabs;
  }
  const VERWALTEN = () => tgroup('VERWALTEN', tbtn('formtool', 'Formfräser', createFormTool, '', 'Formfräser aus einer Profilskizze erstellen'),
    tbtn('holder3d', 'Volumenhalter', e => ctxMenu(e.clientX, e.clientY, [{ label: 'Halter aus Volumenkörper erstellen …', onclick: createHolderFromBody }, { label: 'Halter in der Werkzeugbibliothek', onclick: openToolLibrary }], 'Volumenhalter'), '', 'Werkzeughalter aus einem Volumenkörper'),
    tbtn('tools', 'Werkzeugbibliothek', openToolLibrary, '', 'Werkzeugbibliothek in eigenem Fenster'), tbtn('material', 'Rohteilmaterialbibliothek', openMaterialLib, '', 'Rohteilmaterialien mit Dichte, Schnittgeschwindigkeit und Farbe'),
    tbtn('setup', 'Maschinenbibliothek', () => openMachineLib(), '', 'Maschinenbibliothek'), tbtn('post', 'Postprozessor-Bibliothek', () => openPostEditor(), '', 'Postprozessor-Editor'),
    tbtn('template', 'Vorlagenbibliothek', openTemplateLib, '', 'Operationen als Vorlage speichern und anwenden'), tbtn('tasks', 'Task-Manager', openTaskManager, '', 'Status und Rechenzeit aller Operationen'), tbtn('clock', 'Bearbeitungszeit', () => openMachiningTime(), '', 'Bearbeitungszeit, Werkzeugwechsel und Wege je Setup'),
    tbtn('exportdef', 'Vorgaben exportieren', exportDefaults, '', 'Einstellungen, Symbolleiste, Tastenkürzel, Materialien, Vorlagen und Bibliotheken als Datei sichern'),
    tbtn('importdef', 'Vorgaben importieren', importDefaults, '', 'Gesicherte Vorgaben laden'), tbtn('resetdef', 'Auf Vorgaben zurücksetzen', resetDefaults, '', 'Einstellungen auf den Auslieferungszustand'),
    tbtn('gear', 'Einstellungen', openSettings));
  const AKTIONEN = () => tgroup('AKTIONEN', tbtn('sim', 'Simulieren', openSim, sim.open ? 'active' : ''), tbtn('post', 'NC-Programm', () => select('post')), tbtn('sheet', 'Einrichteblatt', openSetupSheet));
  const SETUP = () => tgroup('SETUP', tbtn('setup', 'Setup', () => select('setup', activeSetupId())), tbtn('setup', 'Neues Setup', addSetup),
    tbtn('post', 'Manuelle NC', () => addOp('manual'), '', 'Manuelle NC: Kommentar, Programmhalt, Verweilzeit oder eigener NC-Code zwischen den Operationen'),
    tbtn('tasks', 'Werkzeugwechsel sparen', optimizeOpOrder, '', 'Reihenfolge der Operationen so ändern, dass seltener das Werkzeug gewechselt wird – ohne Operationen zu überholen, die an derselben Stelle arbeiten'));
  if (state.workspace === 'render') {
    tabs.RENDERN = [
      tgroup('EINRICHTEN', tbtn('appearance', 'Darstellung', openAppearance, '', 'Darstellung (A): Material auf Körper ziehen'), tbtn('scene', 'Szeneneinstellungen', () => { state.sel = null; renderAll(); }, '', 'Umgebung, Helligkeit, Hintergrund, Boden')),
      tgroup('IN-CANVAS-RENDERN', tbtn('render', studio.running ? 'Rendern beenden' : 'In-Canvas-Rendern', () => { studio.running ? studio.stop() : studio.start(); renderToolbar(); }, studio.running ? 'active' : '', 'Bild wird Durchgang für Durchgang glatter: weiche Schatten, saubere Kanten')),
      tgroup('RENDERN', tbtn('capture', 'Bild speichern', saveRenderImage, '', 'Aktuelles Bild als PNG speichern')),
      tgroup('ANSICHT', tbtn('fit', 'Einpassen', fitView, '', 'Einpassen (F)')),
    ];
    return tabs;
  }
  if (state.workspace === 'design') {
    const C = (icon, label, type, extra, key) => tbtn(icon, label, () => createFeature(type, extra), '', key ? `${label} (${key})` : label);
    const SKETCH = () => tbtn('sketch', 'Skizze', startPickPlane, state.pick?.mode === 'plane' ? 'active' : '', 'Skizze erstellen (K)');
    const PRUEFEN = () => tgroup('PRÜFEN', tbtn('measure', 'Messen', toggleMeasure, state.pick?.mode === 'measure' ? 'active' : ''), tbtn('section', 'Schnitt', toggleSection, state.section ? 'active' : ''),
      tbtn('zebra', 'Zebra', () => setAnalysis('zebra'), analysis.mode === 'zebra' ? 'active' : '', 'Zebra-Analyse: Stetigkeit der Flächenübergänge'),
      tbtn('draftAn', 'Entformung', () => setAnalysis('draft'), analysis.mode === 'draft' ? 'active' : '', 'Formschräge-Analyse: Entformbarkeit'),
      tbtn('combine', 'Interferenz', runInterference, '', 'Überschneidungen zwischen Körpern finden'), tbtn('fit', 'Einpassen', fitView, '', 'Einpassen (F6)'));
    const KONSTRUKTION = () => tgroup('KONSTRUIEREN', C('plane', 'Versatzebene', 'plane', { kind: 'offset' }), C('planeAngle', 'Ebene unter Winkel', 'plane', { kind: 'angle' }), C('planeMid', 'Mittelebene', 'plane', { kind: 'mid' }),
      C('plane3pt', 'Ebene durch drei Punkte', 'plane', { kind: '3pt' }), C('planeTangent', 'Tangentialebene', 'plane', { kind: 'tangent' }), C('axisCyl', 'Achse durch Zylinder', 'axis', { kind: 'cyl' }), C('axis2pt', 'Achse durch zwei Punkte', 'axis', { kind: '2pt' }),
      C('axisPlanes', 'Achse durch zwei Ebenen', 'axis', { kind: 'planes' }), C('cpoint', 'Punkt', 'point'));
    tabs['VOLUMENKÖRPER'] = [
      tgroup('ERSTELLEN', SKETCH(),
        C('extrude', 'Extrusion', 'extrude', null, 'E'), C('revolve', 'Rotation', 'revolve'), C('sweep', 'Sweep', 'sweep'), C('loft', 'Erhebung', 'loft'), C('hole', 'Bohrung', 'hole', null, 'H'),
        C('thread', 'Gewinde', 'thread'), C('pipe', 'Rohr', 'pipe'), C('coil', 'Feder', 'coil'),
        C('box', 'Quader', 'box'), C('cylinder', 'Zylinder', 'cylinder'), C('sphere', 'Kugel', 'sphere'),
        C('rib', 'Rippe', 'rib'), C('torus', 'Torus', 'torus'), C('emboss', 'Prägen', 'emboss'),
        C('patternRect', 'Rechteck-Muster', 'pattern', { kind: 'rect' }), C('patternCirc', 'Kreis-Muster', 'pattern', { kind: 'circ' }), C('patternPath', 'Muster entlang Pfad', 'pattern', { kind: 'path' }), C('mirror', 'Spiegeln', 'mirror')),
      tgroup('ÄNDERN',
        tbtn('presspull', 'Drücken/Ziehen', startPressPull, state.pick?.mode === 'presspull' ? 'active' : '', 'Drücken/Ziehen (Q)'),
        C('fillet', 'Verrundung', 'fillet', null, 'F'), C('edgechamfer', 'Fase', 'chamfer'), C('shell', 'Schale', 'shell'), C('draft', 'Formschräge', 'draft'), C('scale', 'Skalieren', 'scale'),
        tbtn('split', 'Fläche löschen', () => createFeature('delface'), '', 'Fläche löschen: Bohrungen, Taschen, Verrundungen oder Fasen entfernen – die Nachbarflächen schließen die Lücke'),
        tbtn('presspull', 'Fläche ersetzen', () => createFeature('replaceface'), '', 'Fläche ersetzen: eine ebene Fläche auf eine andere Ebene legen – der Körper wächst oder wird gekürzt'),
        tbtn('presspull', 'Fläche versetzen', () => createFeature('offsetface'), '', 'Fläche versetzen: ebene Flächen verschieben, Bohrungen und Zapfen im Durchmesser ändern'),
        tbtn('move', 'Ausrichten', () => createFeature('align'), '', 'Ausrichten: einen Körper mit einer seiner Flächen auf die Fläche eines anderen Körpers legen'),
        C('split', 'Teilen', 'split'), C('move', 'Verschieben', 'move', null, 'M'), C('combine', 'Kombinieren', 'combine'),
        tbtn('appearance', 'Darstellung', openAppearance, appPanel ? 'active' : '', 'Darstellung (A)'),
        tbtn('params', 'Parameter', () => select('params'))),
      KONSTRUKTION(),
      tgroup('BAUGRUPPE', tbtn('move', 'Positionieren', placeSelectedBody, '', 'Körper als Komponente positionieren'), tbtn('revolve', 'Gelenk', addJoint), tbtn('cpoint', 'Gelenkursprung', addJointOrigin, state.pick?.mode === 'jorigin' ? 'active' : '', 'Gelenkursprung auf einem Körper setzen (später beim Gelenk anklickbar)'), tbtn('sim', 'Bewegung', motionStudy, motion.on ? 'active' : '', 'Bewegungsstudie mit Kollisionsprüfung')),
      PRUEFEN(),
      tgroup('EINFÜGEN', tbtn('decal', 'Aufkleber', insertDecal, '', 'Aufkleber: Bild auf eine Körperfläche legen'), tbtn('canvas', 'Ansichtsbereich', insertCanvas, '', 'Ansichtsbereich: Vorlagebild auf einer Ebene'),
        tbtn('decal', 'Bild nachzeichnen', traceImageDialog, '', 'Bild nachzeichnen: aus einem Bild Konturen oder Mittellinien als neue Skizze, SVG oder DXF erzeugen'),
        tbtn('measure', 'Vorlage kalibrieren', () => calibrateCanvas(), '', 'Vorlage kalibrieren: zwei Punkte im Bild anklicken und ihren wirklichen Abstand eingeben'),
        tbtn('svgfile', 'SVG-Datei einfügen', insertSVG, '', 'SVG-Datei als Skizze einfügen'), tbtn('dxffile', 'DXF-Datei einfügen', insertDXF, '', 'DXF-Datei als Skizze einfügen'),
        tbtn('mesh', 'Netz einfügen', () => $('#cadInput').click(), '', 'STL- oder OBJ-Datei als Netz einfügen'), tbtn('component', 'Komponente einfügen', insertComponent, '', 'Ein anderes gespeichertes Design als Komponente einfügen'),
        tbtn('bolt', 'Schraube einfügen', insertBolt, '', 'Schraube oder Mutter nach ISO einfügen'), tbtn('dupjoint', 'Mit Gelenken duplizieren', duplicateWithJoints, '', 'Gewählten Körper samt Gelenken kopieren'),
        tbtn('derive', 'Ableitung einfügen', insertDerive, '', 'Körper, Skizzen oder Parameter aus einem anderen Design übernehmen'),
        tbtn('import', 'STEP/IGES importieren', () => $('#cadInput').click(), '', 'STEP oder IGES einfügen'), tbtn('example', 'Beispiel', () => loadExample()), tbtn('revolve', 'Drehteil', () => loadExample(true), '', 'Beispiel: Welle für die Drehbearbeitung')),
    ];
    const MO = (icon, label, kind) => tbtn(icon, label, () => createMeshOp(kind), '', MESH_OPS[kind]);
    tabs['NETZ'] = [
      tgroup('EINFÜGEN', tbtn('mesh', 'Netz einfügen', () => $('#cadInput').click(), '', 'STL- oder OBJ-Datei als Netz einfügen (ohne B-Rep)')),
      tgroup('ÄNDERN', MO('mesh_repair', 'Reparieren', 'repair'), MO('mesh_reduce', 'Reduzieren', 'reduce'), MO('mesh_smooth', 'Glätten', 'smooth'), MO('mesh_cut', 'Ebenenschnitt', 'cut'),
        MO('mesh_transform', 'Verschieben', 'transform'), MO('mesh_flip', 'Normalen umk.', 'flip'), MO('mesh_split', 'Trennen', 'split')),
      tgroup('PRÜFEN', tbtn('measure', 'Messen', toggleMeasure, state.pick?.mode === 'measure' ? 'active' : ''), tbtn('section', 'Schnitt', toggleSection, state.section ? 'active' : ''), tbtn('fit', 'Einpassen', fitView, '', 'Einpassen (F)')),
      tgroup('EXPORT', tbtn('import', 'STL', () => { const ms = getMeshes().bodies.filter(x => !state.hiddenBodies.has(x.id)); if (!ms.length) return status('Kein Netz vorhanden.'); exportMeshSTL(ms); }, '', 'Sichtbare Netze als STL speichern')),
    ];
    tabs['FLÄCHE'] = [
      KONSTRUKTION(),
      tgroup('FLÄCHE ERSTELLEN', SKETCH(), C('surfextrude', 'Extrusion', 'surfextrude'), C('surfrevolve', 'Rotation', 'surfrevolve'), C('surfloft', 'Erhebung', 'surfloft'), C('patch', 'Flicken', 'patch'), C('fill', 'Rand füllen', 'fill'), C('offsetsurf', 'Versatz', 'offsetsurf'),
        C('freeform', 'Freiformfläche', 'freeform'), C('sweep', 'Sweep', 'sweep'), C('pipe', 'Rohr', 'pipe')),
      tgroup('ÄNDERN', C('surftrim', 'Trimmen', 'surftrim'), C('surfextend', 'Verlängern', 'surfextend'), C('thicken', 'Aufdicken', 'thicken'), C('stitch', 'Zusammenfügen', 'stitch'), C('split', 'Teilen', 'split'), C('draft', 'Formschräge', 'draft'), C('shell', 'Schale', 'shell'), C('scale', 'Skalieren', 'scale')),
      PRUEFEN(),
    ];
    tabs['BLECH'] = [
      tgroup('ERSTELLEN', SKETCH(), C('sheet', 'Blech', 'sheet')),
      tgroup('PRÜFEN', tbtn('measure', 'Messen', toggleMeasure, state.pick?.mode === 'measure' ? 'active' : ''), tbtn('fit', 'Einpassen', fitView, '', 'Einpassen (F)')),
    ];
    tabs['DIENSTPROGRAMME'] = [
      tgroup('ZEICHNUNG', tbtn('sheet', 'Zeichnung', openDrawing, '', 'Zeichnungsableitung (Ansichten, Bemaßung, Schriftfeld)')),
      tgroup('EXPORT', tbtn('import', 'STEP', () => menuAction('step')), tbtn('import', 'IGES', () => menuAction('iges')), tbtn('import', 'STL', () => menuAction('stl'))),
      tgroup('VERWALTEN', tbtn('params', 'Parameter', () => select('params')), tbtn('spacemouse', 'SpaceMouse kalibrieren', () => openSmCalibration(), '', 'Nullpunkt, Totzone, Empfindlichkeit und Richtung der 3D-Maus'), tbtn('gear', 'Einstellungen', openSettings)),
    ];
    return tabs;
  }
  const A = (icon, label, type) => tbtn(icon, label, () => addOp(type));
  tabs['FRÄSEN'] = [
    SETUP(),
    tgroup('2D-FRÄSEN', A('face', 'Planfräsen', 'face'), A('contour', '2D-Kontur', 'contour'), A('pocket', '2D-Tasche', 'pocket'), A('adaptive', '2D-Adaptiv', 'adaptive'), A('chamfer2d', '2D-Fase', 'chamfer'), A('slot', 'Nut', 'slot'), A('circle', 'Kreistasche', 'circular'), A('trace', 'Gravieren', 'trace'), A('text', 'V-Gravur', 'vcarve')),
    tgroup('3D-FRÄSEN', A('adaptive3d', 'Adaptives 3D-Schruppen', 'adaptive3d'), A('pocket3d', '3D-Versatz-Schruppen (Tasche)', 'pocket3d'),
      tbtn('drill', 'Tauchschruppen', () => addOp('plunge3d'), '', 'Tauchschruppen: senkrechte Tauchgänge Reihe für Reihe – für lange Werkzeuge und tiefe Kavitäten'),
      tbtn('rough32', '3+2-Schruppen', add32Rough, '', '3+2-Schruppen: neues Setup mit geschwenkter Werkzeugachse und adaptivem Schruppen'),
      A('draft', 'Steil und flach', 'steep3d'), A('flat3d', 'Flach', 'flat3d'), A('parallel3d', 'Parallel', 'parallel3d'), A('pocket', 'HSC-Kontur', 'scallop3d'),
      A('contour', '3D-Kontur', 'contour3d'), A('ramp3d', 'Materialeinfahrt', 'ramp3d'), A('pencil3d', 'Hohlkehle', 'pencil3d'), A('face', 'Horizontal', 'horizontal3d'),
      A('revolve', 'Spirale', 'spiral3d'), A('patternCirc', 'Radial', 'radial3d'), A('morphspiral3d', 'Morph-Spirale', 'morphspiral3d'), A('project', 'Projizieren', 'project3d'),
      A('blend3d', 'Leitkurven-Blend', 'blend3d'), A('guidemorph3d', 'Leitkurven-Morph', 'guidemorph3d'), A('corner3d', 'Ecke', 'corner3d'), A('flow3d', 'Fluss', 'flow3d'),
      A('morph3d', 'Flächen-Morph', 'morph3d'), A('deburr3d', 'Entgraten', 'deburr3d'), A('geodesic3d', 'Geodätische Linie', 'geodesic3d')),
    tgroup('MEHRACHSEN', A('rough3d', '4-Achs-Schruppen', 'rotaryRough'), A('revolve', '4-Achs-Rotation', 'rotary'), A('trace', '4-Achs-Abwickeln', 'rotaryWrap')),
    tgroup('BOHREN', A('drill', 'Bohren', 'drill'), A('bore', 'Helix-Bohren', 'bore'), A('thread', 'Gewindefräsen', 'thread'),
      tbtn('measure', 'Bohrungen erkennen', recognizeHoles, '', 'Bohrungen erkennen: alle Bohrungen des Modells nach Durchmesser gruppieren und Anbohren, Bohren, Gewinde und Senkungen in einem Zug anlegen')),
    tgroup('ANTASTEN', A('measure', 'WKS antasten', 'probe')),
    AKTIONEN(), VERWALTEN(),
  ];
  tabs['DREHEN'] = [
    SETUP(),
    tgroup('DREHEN', A('face', 'Plandrehen', 'tface'), A('rough3d', 'Schruppen', 'trough'), A('contour', 'Schlichten', 'tfinish'), A('pocket', 'Einstechen', 'tgroove'), A('thread', 'Gewinde', 'tthread'), A('split', 'Abstechen', 'tpart'), A('drill', 'Bohren', 'tdrill'), A('bore', 'Innendrehen', 'tbore'), A('drill', 'Bohren angetrieben', 'tlive'), A('slot', 'Nut angetrieben', 'tslot'), A('face', 'Schlüsselflächen', 'tflat'), A('contour', 'Kontur Planfläche', 'tcontour'), A('contour', 'Kontur Mantel', 'twrap'), A('pocket', 'Tasche Planfläche', 'tpocket')),
    AKTIONEN(), VERWALTEN(),
  ];
  tabs['DIENSTPROGRAMME'] = [AKTIONEN(), VERWALTEN(), tgroup('3D-MAUS', tbtn('spacemouse', 'SpaceMouse kalibrieren', () => openSmCalibration(), '', 'Nullpunkt, Totzone, Empfindlichkeit und Richtung der 3D-Maus'))];
  return tabs;
}

// switching between milling and turning tabs activates a matching setup
function chooseTab(name) {
  if (state.workspace === 'cam' && (name === 'DREHEN' || name === 'FRÄSEN')) {
    const want = name === 'DREHEN' ? 'turn' : 'mill';
    if ((activeSetupKind() === 'turn') !== (want === 'turn')) {
      const s = state.project.cam.setups.find(x => (x.kind === 'turn') === (want === 'turn'));
      if (s) { state.camSetup = s.id; state.sel = { kind: 'setup', id: s.id }; }
      else status(want === 'turn' ? 'Noch kein Dreh-Setup: „Neues Setup“ → Bearbeitung „Drehen“ wählen.' : 'Noch kein Fräs-Setup vorhanden.');
    }
  }
  uiTab[state.workspace] = name;
  renderAll();
}

let allToolButtons = [];
function renderToolbar() {
  const t = $('#tools');
  t.replaceChildren();
  $('#workspace').value = state.workspace;
  $('#workspace').disabled = !!state.sketchId;
  const tabs = toolbarTabs();
  const names = Object.keys(tabs);
  let cur = state.sketchId ? 'SKIZZE' : uiTab[state.workspace];
  if (state.workspace === 'cam' && !state.sketchId && (cur === 'FRÄSEN' || cur === 'DREHEN')) cur = activeSetupKind() === 'turn' ? 'DREHEN' : 'FRÄSEN';
  if (!names.includes(cur)) cur = names[0];
  $('#tabs').replaceChildren(...names.map(n => h('button', { class: n === cur ? 'on' : '', onclick: () => chooseTab(n) }, n)));
  for (const [tab, groups] of Object.entries(tabs)) for (const g of groups) fillGroup(g, tab);
  t.append(...tabs[cur]);
  // every command of every tab (shown or not), for the command search and keyboard shortcuts
  allToolButtons = [];
  const seen = new Set();
  for (const [tab, groups] of Object.entries(tabs)) {
    for (const g of groups) {
      const glabel = deText(g.querySelector('.tgroup-label')?.firstChild) || '';
      for (const b of g._items || g.querySelectorAll('.tbtn')) {
        const label = cmdLabel(b);
        const key = label + '|' + b.title;
        if (seen.has(key)) continue;
        seen.add(key);
        if (tbKeys[cmdId(b)]) b.title = `${b.title.replace(/ \([A-Z]\)$/, '')} (${tbKeys[cmdId(b)]})`;
        allToolButtons.push({ id: cmdId(b), label, title: b.title, icon: b.dataset.icon, where: `${tab} › ${glabel}`, el: b });
      }
    }
  }
  // hidden groups still contain buttons that work when clicked
  for (const g of t.querySelectorAll('.tgroup')) g.dataset.ready = '1';
}

// ---------- browser tree (common CAD/CAM-style) ----------
const SVG = {
  folder: '<svg viewBox="0 0 16 16"><path d="M1.5 4h5l1.5 1.5h6.5v8h-13z" fill="#e8b84a" stroke="#b8862a" stroke-width=".8"/></svg>',
  doc: '<svg viewBox="0 0 16 16"><path d="M3 1.5h7l3 3v10H3z" fill="#fff" stroke="#6b7785" stroke-width=".9"/><path d="M5 7h6M5 9.5h6M5 12h4" stroke="#0696d7" stroke-width=".9"/></svg>',
  surfbody: '<svg viewBox="0 0 16 16"><path d="M2 10.5q3-6 6-4t6-3v5q-3 1-6-1t-6 3z" fill="#e8b25a" stroke="#9a6a1c" stroke-width=".8"/></svg>',
  body: '<svg viewBox="0 0 16 16"><path d="M8 1.5 14 4.5v7L8 14.5 2 11.5v-7z" fill="#9db7cf" stroke="#4d6f8f" stroke-width=".8"/><path d="M2 4.5 8 7.5l6-3M8 7.5v7" fill="none" stroke="#4d6f8f" stroke-width=".8"/></svg>',
  sketch: '<svg viewBox="0 0 16 16"><rect x="2" y="2" width="12" height="12" fill="none" stroke="#d08a1a" stroke-width="1"/><path d="M4 11 7 5l2 4 2-2 1 4" fill="none" stroke="#d08a1a" stroke-width="1.1"/></svg>',
  origin: '<svg viewBox="0 0 16 16"><path d="M8 8V2M8 8l5.5 3M8 8l-5.5 3" stroke-width="1.4" fill="none" stroke="#6b7785"/><circle cx="8" cy="8" r="1.6" fill="#e8b84a"/></svg>',
  plane: '<svg viewBox="0 0 16 16"><path d="M2 11 6 4h8l-4 7z" fill="#f2d48a" fill-opacity=".6" stroke="#b8862a" stroke-width=".8"/></svg>',
  axis: '<svg viewBox="0 0 16 16"><path d="M2 14 14 2" stroke="#b8862a" stroke-width="1.3"/></svg>',
  point: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.4" fill="#e8b84a" stroke="#b8862a" stroke-width=".8"/></svg>',
  view: '<svg viewBox="0 0 16 16"><path d="M2 5h8v7H2zM10 7l4-2v7l-4-2" fill="none" stroke="#6b7785" stroke-width="1"/></svg>',
  gear: '<svg viewBox="0 0 16 16"><circle cx="8" cy="8" r="2.2" fill="none" stroke="#6b7785" stroke-width="1.1"/><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="#6b7785" stroke-width="1.1"/></svg>',
  param: '<svg viewBox="0 0 16 16"><text x="3" y="13" font-size="12" font-style="italic" font-family="serif" fill="#0696d7">ƒx</text></svg>',
  joint: '<svg viewBox="0 0 16 16"><circle cx="5" cy="8" r="3" fill="none" stroke="#2f9e44" stroke-width="1.1"/><circle cx="11" cy="8" r="3" fill="none" stroke="#2f9e44" stroke-width="1.1"/></svg>',
  mesh: '<svg viewBox="0 0 16 16"><path d="M2 12 8 2l6 10z" fill="#b8d0a8" stroke="#5f7f4f" stroke-width=".8"/><path d="M5 7h6M8 2v10M5 7l3 5 3-5" fill="none" stroke="#5f7f4f" stroke-width=".7"/></svg>',
  setup: '<svg viewBox="0 0 16 16"><path d="M2 10h12v4H2z" fill="#9db7cf" stroke="#4d6f8f" stroke-width=".8"/><path d="M5 10V6h6v4" fill="none" stroke="#4d6f8f" stroke-width=".9"/><path d="M8 1.5v4" stroke="#d64545" stroke-width="1.2"/></svg>',
};
const EYE = '<svg viewBox="0 0 16 16"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.1"/><circle cx="8" cy="8" r="2" fill="currentColor"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 16 16"><path d="M1.5 8S4 3.5 8 3.5 14.5 8 14.5 8 12 12.5 8 12.5 1.5 8 1.5 8z" fill="none" stroke="currentColor" stroke-width="1.1"/><path d="M2.5 13.5 13.5 2.5" stroke="currentColor" stroke-width="1.2"/></svg>';

// Click that also detects a double click, even when the first click re-renders the row.
let lastClick = { key: null, t: 0 };
function dblAware(key, single, dbl) {
  return e => {
    const now = performance.now();
    if (dbl && lastClick.key === key && now - lastClick.t < 450) { lastClick = { key: null, t: 0 }; dbl(e); return; }
    lastClick = { key, t: now };
    single?.(e);
  };
}

// expanded tree folders, remembered per browser
const treeOpen = (() => {
  try { return new Set(JSON.parse(localStorage.getItem('openfab.tree.v1')) || ['root', 'bodies', 'sketches', 'cam']); } catch { return new Set(['root', 'bodies', 'sketches', 'cam']); }
})();
function toggleOpen(key) {
  treeOpen.has(key) ? treeOpen.delete(key) : treeOpen.add(key);
  try { localStorage.setItem('openfab.tree.v1', JSON.stringify([...treeOpen])); } catch { /* storage unavailable */ }
  renderTree();
}

// One browser row. `open` (true/false) shows an expand arrow; `eye` a visibility toggle.
// operation icon with a status badge (generated / warning / error / switched off)
const OP_ICON = { face: 'face', contour: 'contour', pocket: 'pocket', adaptive: 'adaptive', chamfer: 'deburr3d', drill: 'drill', bore: 'bore', thread: 'thread', trace: 'trace', rough3d: 'rough3d',
  parallel3d: 'parallel3d', contour3d: 'flow3d', horizontal3d: 'flat3d', steep3d: 'ramp3d', scallop3d: 'morph3d', spiral3d: 'morphspiral3d', radial3d: 'geodesic3d', project3d: 'project', adaptive3d: 'adaptive3d',
  pocket3d: 'pocket3d', flat3d: 'flat3d', ramp3d: 'ramp3d', pencil3d: 'pencil3d', morphspiral3d: 'morphspiral3d', blend3d: 'blend3d', guidemorph3d: 'guidemorph3d', corner3d: 'corner3d', flow3d: 'flow3d',
  morph3d: 'morph3d', deburr3d: 'deburr3d', geodesic3d: 'geodesic3d', slot: 'slot', circular: 'circle', vcarve: 'chamfer2d', probe: 'measure', plunge3d: 'drill', manual: 'post' };
const BADGE = {
  ok: '<circle cx="19" cy="19" r="5" fill="#2f9e44"/><path d="M16.6 19.1l1.7 1.7 3.2-3.4" stroke="#fff" stroke-width="1.6" fill="none"/>',
  warn: '<path d="M19 13.6l5.2 9.2H13.8z" fill="#f2b705"/><path d="M19 17.2v2.6M19 21.4v.2" stroke="#111" stroke-width="1.4"/>',
  err: '<circle cx="19" cy="19" r="5" fill="#e03131"/><path d="M17 17l4 4M21 17l-4 4" stroke="#fff" stroke-width="1.6"/>',
  off: '<circle cx="19" cy="19" r="5" fill="#8a949e"/><path d="M16.5 19h5" stroke="#fff" stroke-width="1.8"/>',
  todo: '<circle cx="19" cy="19" r="4.6" fill="none" stroke="#8a949e" stroke-width="1.4" stroke-dasharray="2 1.6"/>',
};
function opTreeIcon(op, r) {
  const base = ICONS[OP_ICON[op.type] || op.type] || ICONS.setup;
  const st = op.enabled === false ? 'off' : r?.error ? 'err' : r?.warning ? 'warn' : r?.moves?.length || r?.manual ? 'ok' : 'todo';
  return base.replace('</svg>', BADGE[st] + '</svg>');
}
const pathLength = moves => { let L = 0; for (let i = 1; i < moves.length; i++) if (moves[i].t !== 'r') L += Math.hypot(moves[i].x - moves[i - 1].x, moves[i].y - moves[i - 1].y, moves[i].z - moves[i - 1].z); return L; };

function node({ icon, svg, name, cls = '', depth = 0, open, okey, selected, onclick, ondblclick, oncontext, eye, dot, fid, extra }) {
  const row = h('div', {
    class: `node ${cls} ${selected ? 'sel' : ''}`, style: `padding-left:${4 + depth * 16}px`, 'data-fid': fid || null,
    onclick: ondblclick ? dblAware('n:' + (fid || okey || name) + depth, onclick, ondblclick) : onclick,
    oncontextmenu: oncontext ? e => { e.preventDefault(); e.stopPropagation(); oncontext(e); } : null,
    onmouseenter: fid ? () => hoverFeature(fid, true) : null,
    onmouseleave: fid ? () => hoverFeature(fid, false) : null,
  },
  h('span', { class: 'tw' + (open == null ? ' none' : open ? ' open' : ''), onclick: open == null ? null : e => { e.stopPropagation(); toggleOpen(okey); } }, open == null ? '' : '▶'),
  eye ? h('button', { class: 'eye ' + (eye.on ? '' : 'off'), title: eye.on ? 'Ausblenden' : 'Einblenden', html: eye.on ? EYE : EYE_OFF, onclick: e => { e.stopPropagation(); eye.toggle(); } }) : h('span', { class: 'eye-sp' }),
  svg ? h('span', { class: 'ico', html: svg }) : h('span', { class: 'ico' }, icon || ''),
  h('span', { class: 'name', title: name }, name),
  extra || null,
  dot ? h('span', { class: 'dot ' + dot }) : null,
  );
  if (open != null && !onclick && !ondblclick) row.addEventListener('click', () => toggleOpen(okey));
  return row;
}

// Highlight the matching browser row and timeline entry while hovering either one.
function hoverFeature(fid, on) {
  for (const el of document.querySelectorAll(`[data-fid="${CSS.escape(fid)}"]`)) el.classList.toggle('hl', on);
}

async function renameFeature(id) {
  const f = feature(id);
  if (!f) return;
  const v = await askValue('Neuer Name', f.name);
  if (v && v.trim()) editFeature(id, x => (x.name = v.trim()));
}
async function renameBody(b) {
  const v = await askValue('Neuer Name für den Körper', bodyName(b));
  if (v && v.trim()) commit(p => { p.bodyMeta ||= {}; p.bodyMeta[b.id] ||= {}; p.bodyMeta[b.id].name = v.trim(); }, 'meta');
}
const setBodyHidden = (ids, hide) => { for (const id of ids) hide ? state.hiddenBodies.add(id) : state.hiddenBodies.delete(id); renderTree(); rebuildScene(); };
const setSketchesHidden = (ids, hide) => commit(p => { for (const f of p.features) if (ids.includes(f.id)) f.hidden = hide; }, 'view');
function findInTimeline(id) {
  select('feature', id);
  const el = document.querySelector(`#tlItems [data-fid="${CSS.escape(id)}"]`);
  if (el) { el.scrollIntoView({ inline: 'center', block: 'nearest' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900); }
}
function findInBrowser(id) {
  const el = document.querySelector(`#tree [data-fid="${CSS.escape(id)}"]`);
  if (!el) return status('Dieses Feature steht nicht im Browser (nur Skizzen und Körper werden dort gezeigt).');
  el.scrollIntoView({ block: 'nearest' });
  el.classList.add('flash');
  setTimeout(() => el.classList.remove('flash'), 900);
}
const goView = name => { const box = getModel().box; vp.setView(name, box.isEmpty() ? null : box); };

function sketchMenu(e, f) {
  ctxMenu(e.clientX, e.clientY, [
    { label: 'Skizze bearbeiten', icon: '✎', onclick: () => editSketch(f.id) },
    { label: 'Umbenennen', onclick: () => renameFeature(f.id) },
    { label: f.hidden ? 'Einblenden' : 'Ausblenden', icon: '👁', key: 'V', onclick: () => setSketchesHidden([f.id], !f.hidden) },
    { sep: true },
    { label: 'In Zeitachse suchen', onclick: () => findInTimeline(f.id) },
    { label: 'Eigenschaften', onclick: () => select('feature', f.id) },
    { sep: true },
    { label: 'Löschen', icon: '✕', key: 'Entf', danger: true, onclick: () => deleteFeature(f.id) },
  ], f.name);
}

function bodyMenu(e, b, all) {
  const hidden = state.hiddenBodies.has(b.id);
  const src = feature(b.id) || feature(String(b.id).replace(/_\d+$/, ''));
  ctxMenu(e.clientX, e.clientY, [
    { label: 'Umbenennen', onclick: () => renameBody(b) },
    { label: hidden ? 'Einblenden' : 'Ausblenden', icon: '👁', key: 'V', onclick: () => setBodyHidden([b.id], !hidden) },
    { label: 'Isolieren', onclick: () => { state.hiddenBodies.clear(); setBodyHidden(all.filter(x => x.id !== b.id).map(x => x.id), true); } },
    { label: 'Alle einblenden', onclick: () => { state.hiddenBodies.clear(); renderTree(); rebuildScene(); } },
    { sep: true },
    { label: 'Physikalisches Material / Eigenschaften', onclick: () => select('body', b.id) },
    { label: 'Verschieben/Kopieren', onclick: () => { createFeature('move'); const mv = state.sel && feature(state.sel.id); if (mv?.type === 'move') editFeature(mv.id, x => (x.body = b.id)); } },
    src ? { label: 'Erzeugendes Feature in Zeitachse suchen', onclick: () => findInTimeline(src.id) } : null,
  ], bodyName(b));
}

function opMenu(e, op) {
  const on = op.enabled !== false;
  ctxMenu(e.clientX, e.clientY, [
    { label: 'Bearbeiten', icon: '✎', onclick: () => select('op', op.id) },
    { label: 'Umbenennen', onclick: async () => { const v = await askValue('Neuer Name', op.name); if (v && v.trim()) editOp(op.id, x => (x.name = v.trim())); } },
    { label: on ? 'Deaktivieren' : 'Aktivieren', onclick: () => editOp(op.id, x => (x.enabled = !on)) },
    { label: 'Duplizieren', onclick: () => commit(pp => { const c = { ...JSON.parse(JSON.stringify(op)), id: uid('op'), name: nextName(pp.cam.ops, OP_TYPES[op.type]) }; pp.cam.ops.splice(pp.cam.ops.findIndex(o => o.id === op.id) + 1, 0, c); state.sel = { kind: 'op', id: c.id }; }) },
    { sep: true },
    { label: 'Simulieren', icon: '▶', onclick: () => { select('op', op.id); openSim(); } },
    { label: 'NC-Programm erzeugen', onclick: () => select('post') },
    { sep: true },
    { label: 'Löschen', icon: '✕', danger: true, onclick: () => { commit(pp => (pp.cam.ops = pp.cam.ops.filter(o => o.id !== op.id))); state.sel = null; renderAll(); } },
  ], op.name);
}

function setupMenu(e, st) {
  ctxMenu(e.clientX, e.clientY, [
    { label: 'Setup bearbeiten', icon: '✎', onclick: () => select('setup', st.id) },
    { label: 'Umbenennen', onclick: async () => { const v = await askValue('Neuer Name', st.name); if (v && v.trim()) commit(p => (p.cam.setups.find(x => x.id === st.id).name = v.trim())); } },
    { label: 'Simulieren', icon: '▶', onclick: () => { select('setup', st.id); openSim(); } },
    { label: 'Bearbeitungszeit …', icon: '⏱', onclick: () => openMachiningTime(st.id) },
    { label: 'NC-Programm erzeugen', onclick: () => select('post') },
    { sep: true },
    { label: 'Löschen', icon: '✕', danger: true, disabled: state.project.cam.setups.length < 2, onclick: () => deleteSetup(st.id) },
  ], st.name);
}

function renderTree() {
  const t = $('#tree');
  const scroll = t.parentElement.scrollTop;
  t.replaceChildren();
  const p = state.project;
  const isSel = (kind, id) => state.sel?.kind === kind && state.sel.id === id;
  const O = k => treeOpen.has(k);
  if (state.workspace === 'design' || state.workspace === 'render') {
    const m = getModel();
    const allHidden = m.bodies.length && m.bodies.every(b => state.hiddenBodies.has(b.id));
    t.append(node({ svg: SVG.doc, name: p.name, cls: 'root', open: O('root'), okey: 'root',
      eye: { on: !allHidden, toggle: () => setBodyHidden(m.bodies.map(b => b.id), !allHidden) },
      oncontext: e => ctxMenu(e.clientX, e.clientY, [
        { label: 'Projekt umbenennen', onclick: async () => { const v = await askValue('Projektname', p.name); if (v && v.trim()) commit(pp => (pp.name = v.trim()), 'meta'); } },
        { label: 'Alle einblenden', onclick: () => { state.hiddenBodies.clear(); setSketchesHidden(p.features.filter(f => f.type === 'sketch').map(f => f.id), false); } },
        { label: 'Alles einpassen', onclick: fitView },
      ], p.name) }));
    if (!O('root')) return;
    // document settings
    t.append(node({ svg: SVG.folder, name: 'Dokumenteinstellungen', depth: 1, open: O('docset'), okey: 'docset' }));
    if (O('docset')) {
      t.append(node({ svg: SVG.gear, name: 'Einheiten: mm', depth: 2 }));
      t.append(node({ svg: SVG.param, name: `Parameter (${p.params.length})`, depth: 2, selected: isSel('params'), onclick: () => select('params') }));
    }
    // named views
    t.append(node({ svg: SVG.folder, name: 'Benannte Ansichten', depth: 1, open: O('views'), okey: 'views' }));
    if (O('views')) {
      for (const [k, n] of [['top', 'OBEN'], ['front', 'VORNE'], ['right', 'RECHTS'], ['iso', 'START']]) {
        t.append(node({ svg: SVG.view, name: n, depth: 2, onclick: () => goView(k), ondblclick: () => goView(k) }));
      }
    }
    // origin
    t.append(node({ svg: SVG.folder, name: 'Ursprung', depth: 1, open: O('origin'), okey: 'origin',
      eye: { on: vp.axesGroup.visible, toggle: () => { saveSettings({ showAxes: !vp.axesGroup.visible }); applySettings(); renderTree(); } } }));
    if (O('origin')) {
      t.append(node({ svg: SVG.point, name: 'O', depth: 2 }));
      for (const a of ['X', 'Y', 'Z']) t.append(node({ svg: SVG.axis, name: a, depth: 2 }));
      for (const pl of ['XY', 'XZ', 'YZ']) {
        t.append(node({ svg: SVG.plane, name: pl, depth: 2, ondblclick: () => createSketch(BASE_PLANES[pl]),
          oncontext: e => ctxMenu(e.clientX, e.clientY, [{ label: 'Skizze auf dieser Ebene erstellen', icon: '✎', onclick: () => createSketch(BASE_PLANES[pl]) }], pl) }));
      }
    }
    const CONSTRUCT = ['plane', 'axis', 'point'];
    const planes = p.features.filter(f => CONSTRUCT.includes(f.type));
    if (planes.length) {
      const allOff = planes.every(f => f.hidden);
      t.append(node({ svg: SVG.folder, name: `Konstruktion (${planes.length})`, depth: 1, open: O('construct'), okey: 'construct',
        eye: { on: !allOff, toggle: () => commit(pp => { for (const f of pp.features) if (CONSTRUCT.includes(f.type)) f.hidden = !allOff; }, 'view') } }));
      if (O('construct')) for (const f of planes) {
        t.append(node({
          svg: SVG[f.type], name: f.name, depth: 2, fid: f.id, selected: isSel('feature', f.id),
          onclick: () => select('feature', f.id), ondblclick: () => (f.type === 'plane' ? sketchOnPlaneFeature(f.id) : select('feature', f.id)),
          eye: { on: !f.hidden, toggle: () => editFeature(f.id, x => (x.hidden = !x.hidden)) },
          oncontext: e => ctxMenu(e.clientX, e.clientY, [
            f.type === 'plane' ? { label: 'Skizze auf dieser Ebene erstellen', icon: '✎', onclick: () => sketchOnPlaneFeature(f.id) } : null,
            { label: { plane: 'Ebene bearbeiten', axis: 'Achse bearbeiten', point: 'Punkt bearbeiten' }[f.type], onclick: () => select('feature', f.id) },
            { label: 'Umbenennen', onclick: () => renameFeature(f.id) },
            { label: f.hidden ? 'Einblenden' : 'Ausblenden', icon: '👁', onclick: () => editFeature(f.id, x => (x.hidden = !x.hidden)) },
            { label: 'In Zeitachse suchen', onclick: () => findInTimeline(f.id) },
            { sep: true },
            { label: 'Löschen', icon: '✕', danger: true, onclick: () => deleteFeature(f.id) },
          ], f.name),
        }));
      }
    }
    const origins = p.assembly?.origins || [];
    if (origins.length) {
      t.append(node({ svg: SVG.folder, name: `Gelenkursprünge (${origins.length})`, depth: 1, open: O('jorigins'), okey: 'jorigins' }));
      if (O('jorigins')) for (const o of origins) t.append(node({ svg: SVG.point, name: `${o.name} · ${bodyLabel(o.body)}`, depth: 2, selected: isSel('jorigin', o.id), onclick: () => select('jorigin', o.id),
        oncontext: e => ctxMenu(e.clientX, e.clientY, [{ label: 'Löschen', icon: '✕', danger: true, onclick: () => commit(pp => (pp.assembly.origins = pp.assembly.origins.filter(x => x.id !== o.id))) }], o.name) }));
    }
    const joints = p.assembly?.joints || [];
    if (joints.length) {
      t.append(node({ svg: SVG.folder, name: `Gelenke (${joints.length})`, depth: 1, open: O('joints'), okey: 'joints' }));
      if (O('joints')) for (const j of joints) t.append(node({ svg: SVG.joint, name: `${j.name} · ${JOINT_TYPES[j.type]}`, depth: 2, selected: isSel('joint', j.id), onclick: () => select('joint', j.id) }));
    }
    // bodies
    t.append(node({ svg: SVG.folder, name: `Körper (${m.bodies.length})`, depth: 1, open: O('bodies'), okey: 'bodies',
      eye: m.bodies.length ? { on: !allHidden, toggle: () => setBodyHidden(m.bodies.map(b => b.id), !allHidden) } : null }));
    if (O('bodies')) {
      for (const b of m.bodies) {
        const src = feature(b.id) || feature(String(b.id).replace(/_\d+$/, ''));
        t.append(node({
          svg: b.surface ? SVG.surfbody : SVG.body, name: bodyName(b) + (b.surface ? ' (Fläche)' : ''), depth: 2, selected: isSel('body', b.id), onclick: () => select('body', b.id), fid: src?.id,
          eye: { on: !state.hiddenBodies.has(b.id), toggle: () => setBodyHidden([b.id], !state.hiddenBodies.has(b.id)) },
          oncontext: e => bodyMenu(e, b, m.bodies),
        }));
      }
    }
    // sketches
    const mbs = getMeshes().bodies;
    if (mbs.length) {
      const allOffM = mbs.every(x => state.hiddenBodies.has(x.id));
      t.append(node({ svg: SVG.folder, name: `Netzkörper (${mbs.length})`, depth: 1, open: !O('meshes-closed'), okey: 'meshes-closed',
        eye: { on: !allOffM, toggle: () => setBodyHidden(mbs.map(x => x.id), !allOffM) } }));
      if (!O('meshes-closed')) for (const mb of mbs) {
        t.append(node({
          svg: SVG.mesh, name: mb.name, depth: 2, selected: isSel('mesh', mb.id), onclick: () => select('mesh', mb.id), fid: mb.id.split('~')[0],
          eye: { on: !state.hiddenBodies.has(mb.id), toggle: () => setBodyHidden([mb.id], !state.hiddenBodies.has(mb.id)) },
          dot: meshStats(mb.mesh).closed ? null : 'err',
          oncontext: e => ctxMenu(e.clientX, e.clientY, [
            { label: 'Eigenschaften', onclick: () => select('mesh', mb.id) },
            { label: state.hiddenBodies.has(mb.id) ? 'Einblenden' : 'Ausblenden', icon: '👁', onclick: () => setBodyHidden([mb.id], !state.hiddenBodies.has(mb.id)) },
            { sep: true },
            ...['repair', 'reduce', 'smooth', 'cut', 'transform', 'flip', 'split'].map(k => ({ label: MESH_OPS[k], onclick: () => createMeshOp(k, mb.id) })),
            { sep: true },
            { label: 'Als STL exportieren', onclick: () => exportMeshSTL([mb]) },
            { label: 'In Zeitachse suchen', onclick: () => findInTimeline(mb.id.split('~')[0]) },
          ], mb.name),
        }));
      }
    }
    const sks = p.features.filter(f => f.type === 'sketch');
    const allSkOff = sks.length && sks.every(f => f.hidden);
    t.append(node({ svg: SVG.folder, name: `Skizzen (${sks.length})`, depth: 1, open: O('sketches'), okey: 'sketches',
      eye: sks.length ? { on: !allSkOff, toggle: () => setSketchesHidden(sks.map(f => f.id), !allSkOff) } : null }));
    if (O('sketches')) {
      for (const f of sks) {
        const info = sketchInfo(f.id);
        t.append(node({
          svg: SVG.sketch, name: f.name, depth: 2, fid: f.id, selected: isSel('feature', f.id) || state.sketchId === f.id,
          onclick: () => select('feature', f.id), ondblclick: () => editSketch(f.id),
          eye: { on: !f.hidden, toggle: () => setSketchesHidden([f.id], !f.hidden) },
          oncontext: e => sketchMenu(e, f),
          dot: info.unsatisfied?.length ? 'err' : (resolved().features.find(x => x.id === f.id)?.entities || []).some(e => e.proj?.warn) ? 'warn' : null,
          extra: f.constraints?.length && info.dof === 0 ? h('span', { class: 'lock', title: 'Vollständig bestimmt' }, '🔒') : null,
        }));
      }
    }
  } else {
    const g = getCam();
    t.append(node({ svg: SVG.doc, name: `${p.name} – Fertigung`, cls: 'root', open: O('cam'), okey: 'cam' }));
    if (O('cam')) {
      for (const st of p.cam.setups) {
        const open = !treeOpen.has('closed:' + st.id);
        t.append(node({
          svg: SVG.setup, name: `${st.name} · ${st.kind === 'turn' ? 'Drehen' : st.wcsMode === 'axes' ? 'WKS gewählt' : ORIENTATIONS[st.orientation].split(' ')[0]}`, depth: 1, open, okey: 'closed:' + st.id,
          selected: isSel('setup', st.id) || (state.sel?.kind !== 'setup' && activeSetupId() === st.id && state.sel?.kind !== 'op'),
          onclick: () => select('setup', st.id), oncontext: e => setupMenu(e, st),
          extra: (() => { const S = setupSummary(st); return S.time > 0 ? h('span', { class: 'op-meta', title: 'Geschätzte Bearbeitungszeit (Klick: Details)', onclick: ev => { ev.stopPropagation(); openMachiningTime(st.id); } }, '⏱ ' + fmtDur(S.time)) : null; })(),
        }));
        if (!open) continue;
        const ops = p.cam.ops.filter(o => o.setup === st.id);
        for (const op of ops) {
          const r = g.results.get(op.id);
          t.append(node({
            svg: opTreeIcon(op, r),
            name: op.name, depth: 2, cls: op.enabled === false ? 'disabled' : '',
            selected: isSel('op', op.id), onclick: () => select('op', op.id), oncontext: e => opMenu(e, op),
            extra: r?.moves?.length && !r.error ? h('span', { class: 'op-meta', title: 'Bahnlänge' }, `${Math.round(pathLength(r.moves))} mm`) : null,
          }));
        }
        if (!ops.length) t.append(h('div', { class: 'hint', style: 'padding:4px 0 4px 56px' }, 'Noch keine Operation'));
      }
    }
    t.append(node({ svg: SVG.folder, name: 'Bibliotheken', open: O('libs'), okey: 'libs' }));
    if (O('libs')) {
      t.append(node({ icon: '🔧', name: 'Werkzeugbibliothek', depth: 1, onclick: openToolLibrary }));
      t.append(node({ icon: '🏭', name: 'Maschinenbibliothek', depth: 1, onclick: () => openMachineLib() }));
      t.append(node({ icon: '⚙', name: 'Postprozessoren', depth: 1, onclick: () => openPostEditor() }));
    }
    const ncs = p.cam.ncPrograms || [];
    t.append(node({ svg: SVG.folder, name: `NC-Programme (${ncs.length})`, open: !O('nc-closed'), okey: 'nc-closed' }));
    if (!O('nc-closed')) {
      for (const nc of ncs) t.append(node({ icon: '⎙', name: nc.name, depth: 1, onclick: () => openPostDialog(nc),
        oncontext: e => ctxMenu(e.clientX, e.clientY, [
          { label: 'Postprozess …', onclick: () => openPostDialog(nc) },
          { label: 'Löschen', icon: '✕', danger: true, onclick: () => commit(pp => { pp.cam.ncPrograms = pp.cam.ncPrograms.filter(x => x.id !== nc.id); }) },
        ], nc.name) }));
      t.append(node({ icon: '＋', name: 'Neues NC-Programm …', depth: 1, onclick: () => openPostDialog() }));
    }
  }
  t.parentElement.scrollTop = scroll;
}

// ---------- timeline (common CAD/CAM-style) ----------
const category = f => (f.type === 'sketch' ? 'sketch' : ['plane', 'axis', 'point'].includes(f.type) ? 'construct' : f.type === 'meshimport' || f.type === 'meshop' ? 'meshf' : SOLID_SOURCES.includes(f.type) || f.type === 'pattern' || f.type === 'mirror' ? 'solid' : 'modify');
const featureIcon = f => ICONS[{ emboss: 'emboss', pattern: f.kind === 'circ' ? 'patternCirc' : f.kind === 'path' ? 'patternPath' : 'patternRect', chamfer: 'edgechamfer', plane: { angle: 'planeAngle', mid: 'planeMid', '3pt': 'plane3pt', tangent: 'planeTangent' }[f.kind] || 'plane', axis: { cyl: 'axisCyl', planes: 'axisPlanes' }[f.kind] || 'axis2pt', point: 'cpoint', meshimport: 'mesh', meshop: 'mesh_' + f.kind }[f.type] || f.type] || ICONS.extrude;

// ids of other features a feature refers to (sketch, target, bodies …)
function featureRefs(f, all) {
  const s = JSON.stringify({ ...f, id: undefined });
  return all.filter(x => x.id !== f.id && s.includes(`"${x.id}`)).map(x => x.id);
}

// Move a feature in the history; refused when it would come before something it uses
// or after something that uses it.
function moveFeature(id, to) {
  const all = state.project.features;
  const from = all.findIndex(f => f.id === id);
  if (from < 0) return;
  if (to > from) to--;
  if (to === from) return;
  const order = all.slice();
  const [f] = order.splice(from, 1);
  order.splice(to, 0, f);
  const makesBody = x => SOLID_SOURCES.includes(x.type) || x.type === 'import';
  // only the moved feature is checked, so an already broken history can still be fixed
  const firstSolid = order.findIndex(makesBody);
  if (!['sketch', 'plane', 'meshimport', 'meshop'].includes(f.type) && !makesBody(f) && (firstSolid < 0 || firstSolid > to)) return status(`Verschieben nicht möglich: „${f.name}“ braucht einen Körper davor.`);
  for (const r of featureRefs(f, order)) {
    if (order.findIndex(x => x.id === r) > to) return status(`Verschieben nicht möglich: „${f.name}“ braucht „${feature(r).name}“ davor.`);
  }
  const user = order.find((x, i) => i < to && featureRefs(x, order).includes(f.id));
  if (user) return status(`Verschieben nicht möglich: „${user.name}“ verwendet „${f.name}“.`);
  commit(p => { p.features = order.map(x => p.features.find(y => y.id === x.id)); });
}

function timelineMenu(e, f, i) {
  const n = state.project.features.length;
  ctxMenu(e.clientX, e.clientY, [
    { label: f.type === 'sketch' ? 'Skizze bearbeiten' : 'Feature bearbeiten', icon: '✎', onclick: () => (f.type === 'sketch' ? editSketch(f.id) : select('feature', f.id)) },
    { label: 'Umbenennen', onclick: () => renameFeature(f.id) },
    { sep: true },
    { label: 'Hierher zurückrollen', onclick: () => setRollback(i + 1 >= n ? null : i + 1) },
    { label: 'Vor dieses Feature zurückrollen', onclick: () => setRollback(i) },
    { label: 'Ans Ende verschieben (Marker)', disabled: state.rollback == null, onclick: () => setRollback(null) },
    { sep: true },
    f.type !== 'sketch' ? { label: f.suppressed ? 'Unterdrückung aufheben' : 'Feature unterdrücken', onclick: () => editFeature(f.id, x => (x.suppressed = !x.suppressed)) } : null,
    f.type === 'sketch' ? { label: f.hidden ? 'Skizze einblenden' : 'Skizze ausblenden', onclick: () => setSketchesHidden([f.id], !f.hidden) } : null,
    { label: 'Nach links verschieben', disabled: i === 0, onclick: () => moveFeature(f.id, i - 1) },
    { label: 'Nach rechts verschieben', disabled: i >= n - 1, onclick: () => moveFeature(f.id, i + 2) },
    { label: 'Im Browser suchen', onclick: () => findInBrowser(f.id) },
    { sep: true },
    { label: 'Löschen', icon: '✕', key: 'Entf', danger: true, onclick: () => deleteFeature(f.id) },
  ], f.name);
}

// gap index (0..n) nearest to a screen x position
function timelineGapAt(x) {
  const items = [...document.querySelectorAll('#tlItems .tl')];
  for (let i = 0; i < items.length; i++) {
    const r = items[i].getBoundingClientRect();
    if (x < r.left + r.width / 2) return i;
  }
  return items.length;
}

function showDropLine(gap) {
  const wrap = $('#tlItems');
  let line = wrap.querySelector('.tl-drop');
  if (gap == null) { line?.remove(); return; }
  if (!line) { line = h('div', { class: 'tl-drop' }); wrap.append(line); }
  const items = [...wrap.querySelectorAll('.tl')];
  const wr = wrap.getBoundingClientRect();
  const ref = items[gap] ? items[gap].getBoundingClientRect().left - 3 : items.length ? items[items.length - 1].getBoundingClientRect().right + 1 : wr.left;
  line.style.left = ref - wr.left + wrap.scrollLeft + 'px';
}

// Drag the rollback marker, or drag a feature to a new place in the history.
function timelineDrag(e, onDrop, onClick) {
  if (e.button !== 0) return;
  const x0 = e.clientX;
  let dragging = false;
  const move = ev => {
    if (!dragging && Math.abs(ev.clientX - x0) > 5) { dragging = true; document.body.classList.add('tl-dragging'); }
    if (dragging) showDropLine(timelineGapAt(ev.clientX));
  };
  const up = ev => {
    removeEventListener('pointermove', move);
    removeEventListener('pointerup', up);
    document.body.classList.remove('tl-dragging');
    showDropLine(null);
    if (dragging) onDrop(timelineGapAt(ev.clientX));
    else onClick?.(ev);
  };
  addEventListener('pointermove', move);
  addEventListener('pointerup', up);
}

function renderTimeline() {
  const wrap = $('#tlItems');
  const scroll = wrap.scrollLeft;
  wrap.replaceChildren();
  wm.get('winTimeline').setForcedHidden(state.workspace !== 'design');
  const errs = allErrors();
  const feats = state.project.features;
  const rb = state.rollback;
  const marker = () => h('div', {
    class: 'tl-marker', title: 'Zeitachsen-Marker – ziehen zum Zurückrollen (Doppelklick: ans Ende)',
    ondblclick: () => setRollback(null),
    onpointerdown: e => { e.preventDefault(); timelineDrag(e, gap => setRollback(gap >= feats.length ? null : gap)); },
  });
  feats.forEach((f, i) => {
    if (rb === i) wrap.append(marker());
    const selected = (state.sel?.kind === 'feature' && state.sel.id === f.id) || state.sketchId === f.id;
    wrap.append(h('div', {
      class: `tl ${category(f)} ${selected ? 'sel' : ''} ${errs[f.id] ? 'err' : ''} ${f.suppressed ? 'off' : ''} ${rb != null && i >= rb ? 'rolled' : ''}`,
      'data-fid': f.id,
      title: f.name + (errs[f.id] ? ' – ' + errs[f.id] : '') + '\nDoppelklick: bearbeiten · Ziehen: verschieben · Rechtsklick: Menü',
      html: featureIcon(f) + (errs[f.id] ? '<i class="tl-badge">!</i>' : ''),
      onpointerdown: e => timelineDrag(e, gap => moveFeature(f.id, gap), dblAware('t:' + f.id, () => select('feature', f.id), () => (f.type === 'sketch' ? editSketch(f.id) : select('feature', f.id)))),
      oncontextmenu: e => { e.preventDefault(); timelineMenu(e, f, i); },
      onmouseenter: () => hoverFeature(f.id, true),
      onmouseleave: () => hoverFeature(f.id, false),
    }));
  });
  if (rb == null && feats.length) wrap.append(marker());
  if (!feats.length) wrap.append(h('span', { class: 'hint' }, 'Leer – starte mit „Skizze“ oder lade das Beispiel.'));
  wrap.scrollLeft = scroll;
}

function setRollback(i) {
  state.rollback = i;
  renderAll();
}

// ---------- properties ----------
function setTitle(t) { $('#propsTitle').textContent = t; }
const editFeature = (id, fn) => commit(p => fn(p.features.find(f => f.id === id)));
const editOp = (id, fn) => commit(p => fn(p.cam.ops.find(o => o.id === id)));

// common CAD/CAM-style command dialog: a feature or operation opened in the panel gets
// OK / Abbrechen. Abbrechen rolls back every change made while it was open
// (and removes a feature that was just created).
let dlg = { key: null, depth: 0 };
let pendingNew = null;
const closedSecs = (() => { try { return new Set(JSON.parse(localStorage.getItem('openfab.secs.v1')) || []); } catch { return new Set(); } })();

function dialogTarget() {
  if (state.sketchId) return null;
  if (state.workspace === 'design' && state.sel?.kind === 'feature' && feature(state.sel.id)) return { kind: 'feature', id: state.sel.id };
  if (state.workspace === 'cam' && state.sel?.kind === 'op' && camOp(state.sel.id)) return { kind: 'op', id: state.sel.id };
  if (state.workspace === 'cam' && state.sel?.kind === 'setup') return { kind: 'setup', id: activeSetupId() };
  return null;
}
function dialogOk() {
  const t = dialogTarget();
  dlg = { key: null, depth: 0 };
  if (state.pick && state.pick.mode !== 'measure') { state.pick = null; showBanner(null); }
  if (t?.kind === 'op') state.camSetup = camOp(t.id)?.setup || state.camSetup;
  if (t?.kind === 'setup') state.camSetup = t.id;
  state.sel = null;
  renderAll();
}
function dialogCancel() {
  const t = dialogTarget();
  const depth = dlg.depth;
  dlg = { key: null, depth: 0 };
  if (state.pick && state.pick.mode !== 'measure') { state.pick = null; showBanner(null); }
  const setup = t?.kind === 'op' ? camOp(t.id)?.setup : t?.kind === 'setup' ? t.id : null;
  if (setup) state.camSetup = setup;
  state.sel = null;
  if (!revertTo(depth)) renderAll();
}
$('#propsOk').onclick = dialogOk;
$('#propsCancel').onclick = dialogCancel;

function renderProps() {
  const t = dialogTarget();
  // the properties window only appears while something is selected (strategy, setup, feature, sketch …)
  const pw = wm.get('winProps');
  const wantProps = !!(t || state.sketchId || state.sel || state.workspace === 'render');
  if (pw && !!pw.s.hidden === wantProps) { pw.s.hidden = !wantProps; pw.clamp(true); }
  const key = t ? t.kind + ':' + t.id : null;
  if (key !== dlg.key) {
    const fresh = pendingNew && pendingNew.id === t?.id;
    dlg = { key, depth: fresh ? pendingNew.depth : undoDepth() };
    if (fresh) pendingNew = null;
  }
  buildProps();
  const foot = $('#propsFoot');
  foot.hidden = !t;
  $('#winProps').classList.toggle('dialog', !!t);
  let icon = '';
  if (t?.kind === 'feature') icon = featureIcon(feature(t.id));
  else if (t?.kind === 'op') icon = ICONS[camOp(t.id).type] || ICONS.setup;
  else if (t?.kind === 'setup') icon = ICONS.setup;
  else if (state.sketchId) icon = ICONS.sketch;
  $('#propsIcon').innerHTML = icon;
  const err = t?.kind === 'feature' ? allErrors()[t.id] : null;
  $('#propsMsg').textContent = err ? '⚠ Fehler' : '';
  const body = $('#propsBody');
  if (state.workspace === 'cam' && !state.sketchId) {
    if (t?.kind === 'setup') propsTabs(body, SETUP_TABS, SETUP_SEC_TAB, 'setup', true);
  }
  // collapsible sections (click on a section heading)
  for (const s of body.querySelectorAll(':scope > .sec')) {
    const name = deText(s);
    const apply = () => {
      const closed = closedSecs.has(name);
      s.classList.toggle('closed', closed);
      for (let n = s.nextElementSibling; n && !n.classList.contains('sec') && !n.classList.contains('btns'); n = n.nextElementSibling) n.classList.toggle('sec-hidden', closed);
    };
    s.onclick = () => {
      closedSecs.has(name) ? closedSecs.delete(name) : closedSecs.add(name);
      try { localStorage.setItem('openfab.secs.v1', JSON.stringify([...closedSecs])); } catch { /* storage unavailable */ }
      apply();
    };
    apply();
  }
}

// common CAD/CAM-style tabs at the top of the operation / setup dialog
const tabSvg = body => `<svg viewBox="0 0 24 24">${body}</svg>`;
const SETUP_TABS = [
  ['setup', 'Setup', '<svg viewBox="0 0 24 24" class="colored"><path d="M3 15l6-3 6 3-6 3z" fill="#d7e3ee"/><path d="M3 15v4l6 3v-4z" fill="#9db7cf"/><path d="M15 15v4l-6 3v-4z" fill="#6f93b6"/><path d="M10 8l6-3 6 3-6 3z" fill="#7cc4ff"/><path d="M10 8v5l6 3v-5z" fill="#2a8fd6"/><path d="M22 8v5l-6 3v-5z" fill="#1c6fb0"/></svg>'],
  ['stock', 'Rohteil', '<svg viewBox="0 0 24 24" class="colored"><path d="M3 8l9-4 9 4-9 4z" fill="#ffe08a"/><path d="M3 8v9l9 4v-9z" fill="#f2c335"/><path d="M21 8v9l-9 4v-9z" fill="#d9a514"/></svg>'],
  ['post', 'Postprozess', '<svg viewBox="0 0 24 24" class="colored"><rect x="3" y="2" width="18" height="20" rx="1.5" fill="#e8edf2"/><text x="6" y="11" font-size="7" font-weight="700" fill="#1c6fb0" font-family="sans-serif">G1</text><text x="6" y="19" font-size="7" font-weight="700" fill="#1c6fb0" font-family="sans-serif">G2</text></svg>'],
];
const SETUP_SEC_TAB = { Maschine: 'setup', Setup: 'setup', 'Werkstück Koordinatensystem (WKS)': 'setup', Modell: 'setup', Spannmittel: 'setup', 'Höhen': 'setup',
  Rohteil: 'stock', Abmessungen: 'stock', 'Aufmaß': 'stock', Rohteilmaterial: 'stock', 'Rohteilbemaßungen': 'stock', Programm: 'post', 'Maschinen-WKS': 'post' };
const tabState = {};

function propsTabs(body, tabs, secTab, key, horizontal = false) {
  const kids = [...body.children];
  if (!kids.length) return;
  const owner = new Map();
  let cur = tabs[0][0];
  kids.forEach((el, i) => {
    if (el.classList.contains('sec')) { const m = secTab[deText(el).trim()]; if (m) cur = m; }
    // the last button row (move / duplicate / delete) stays visible on every tab
    owner.set(el, i === kids.length - 1 && el.classList.contains('btns') ? '*' : cur);
  });
  const present = tabs.filter(([k]) => [...owner.values()].includes(k));
  if (present.length < 2) return;
  const active = present.some(([k]) => k === tabState[key]) ? tabState[key] : present[0][0];
  for (const [el, k] of owner) if (k !== '*' && k !== active) el.classList.add('tab-hidden');
  // a section heading equal to the tab name is redundant
  if (!horizontal) for (const [el, k] of owner) if (k === active && el.classList.contains('sec') && present.find(([pk]) => pk === k)[1].toUpperCase() === deText(el).trim()) el.classList.add('tab-hidden');
  body.prepend(h('div', { class: 'ptabs' + (horizontal ? ' ptabs-h' : '') }, ...present.map(([k, label, icon]) =>
    h('button', { class: 'ptab' + (k === active ? ' on' : ''), title: label, html: icon + `<span>${label}</span>`, onclick: () => { tabState[key] = k; renderProps(); } }))));
}

function buildProps() {
  const b = $('#propsBody');
  b.replaceChildren();
  // Let the panel builders pass optional (null) children like h() does.
  b.append = (...kids) => Element.prototype.append.apply(b, kids.filter(k => k != null && k !== false));
  if (state.workspace === 'render') {
    if (state.sel?.kind === 'body') { const bd = getModel().bodies.find(x => x.id === state.sel.id); if (bd) return propsBody(b, bd); }
    return propsRender(b);
  }
  if (state.workspace === 'design') {
    if (state.sketchId) return propsSketchEdit(b);
    if (state.sel?.kind === 'params') return propsParams(b);
    if (state.sel?.kind === 'joint') { const j = (state.project.assembly?.joints || []).find(x => x.id === state.sel.id); if (j) return propsJoint(b, j); }
    if (state.sel?.kind === 'jorigin') { const o = (state.project.assembly?.origins || []).find(x => x.id === state.sel.id); if (o) return propsJointOrigin(b, o); }
    if (state.sel?.kind === 'body') { const bd = getModel().bodies.find(x => x.id === state.sel.id); if (bd) return propsBody(b, bd); }
    if (state.sel?.kind === 'mesh') { const mb = getMeshes().bodies.find(x => x.id === state.sel.id); if (mb) return propsMeshBody(b, mb); }
    if (state.sel?.kind === 'feature') {
      const f = feature(state.sel.id);
      if (f) return propsFeature(b, f);
    }
    setTitle('EIGENSCHAFTEN');
    const m = getModel();
    b.append(
      h('p', { class: 'hint' }, 'So geht’s:'),
      h('ol', { class: 'hint' },
        h('li', null, '„Skizze“ → Ebene XY/XZ/YZ wählen oder eine ebene Fläche anklicken.'),
        h('li', null, 'Zeichnen, Maße hier exakt eingeben (auch Parameter wie „breite/2“).'),
        h('li', null, '„Skizze fertig“ → Extrusion, Rotation oder Bohrung.'),
        h('li', null, 'Verrundung/Fase: Kanten im Modell anklicken.'),
        h('li', null, 'Oben auf FERTIGUNG wechseln für CAM.'),
      ),
    );
    if (!m.box.isEmpty()) {
      const s = m.box.getSize(new THREE.Vector3());
      b.append(sec('MODELL'), h('div', { class: 'stats' },
        h('span', null, 'Abmessungen'), h('b', null, `${f2(s.x)} × ${f2(s.y)} × ${f2(s.z)} mm`),
        h('span', null, 'Körper'), h('b', null, m.bodies.length),
        h('span', null, 'Berechnung'), h('b', null, `${Math.round(m.ms || 0)} ms` + (m.featureCount ? ` · ${m.featureCount - (m.resumedAt || 0)} von ${m.featureCount} Features neu` : '')),
        h('span', null, 'Geometriekern'), h('b', null, getKernel(activeKernelId())?.name || '')));
    }
    return;
  }
  if (state.sel?.kind === 'op' && camOp(state.sel.id)) return propsOp(b, camOp(state.sel.id));
  if (state.sel?.kind === 'tools') { state.sel = null; openToolLibrary(); return propsCamOverview(b); }
  if (state.sel?.kind === 'post') return propsPost(b);
  return state.sel?.kind === 'setup' ? propsSetup(b) : propsCamOverview(b);
}

let propsCache = { key: null, map: new Map() };
function propsBody(b, body) {
  setTitle('KÖRPER');
  const meta = bodyMeta(body.id);
  const ed = fn => commit(p => { p.bodyMeta ||= {}; p.bodyMeta[body.id] ||= {}; fn(p.bodyMeta[body.id]); }, 'meta');
  if (propsCache.key !== model.key) propsCache = { key: model.key, map: new Map() };
  if (!propsCache.map.has(body.id)) { try { propsCache.map.set(body.id, bodyProps(body)); } catch { propsCache.map.set(body.id, null); } }
  const pr = propsCache.map.get(body.id);
  const mat = MATERIALS[meta.material || 'alu'];
  const color = h('input', { type: 'color', value: meta.color || mat.color, style: 'width:100%;height:28px;border:1px solid var(--line);border-radius:4px;background:var(--input)' });
  color.onchange = () => ed(x => (x.color = color.value));
  b.append(
    row('Name', txt(bodyName(body), v => ed(x => (x.name = v)))),
    row('Material', sel(Object.entries(MATERIALS).map(([k, m]) => [k, `${m.label} (${m.density} g/cm³)`]), meta.material || 'alu', v => ed(x => { x.material = v; delete x.color; }))),
    row('Farbe', color),
    sec('KOMPONENTE (POSITION IN DER BAUGRUPPE)'),
    ...['dx', 'dy', 'dz', 'rx', 'ry', 'rz'].map(k => row({ dx: 'Verschiebung X', dy: 'Verschiebung Y', dz: 'Verschiebung Z', rx: 'Drehung X', ry: 'Drehung Y', rz: 'Drehung Z' }[k],
      num(state.project.assembly?.placements?.[body.id]?.[k] || 0, v => commit(pp => { pp.assembly ||= { placements: {}, joints: [] }; pp.assembly.placements ||= {}; (pp.assembly.placements[body.id] ||= {})[k] = v; }), { unit: k[0] === 'd' ? 'mm' : '°' }))),
    sec('PHYSIKALISCHE EIGENSCHAFTEN'),
    pr ? h('div', { class: 'stats' },
      // a surface body has no volume or mass (shows only its area)
      ...(body.surface ? [h('span', null, 'Art'), h('b', null, 'Flächenkörper (ohne Dicke)')] : [
        h('span', null, 'Volumen'), h('b', null, `${f2(pr.volume / 1000)} cm³`),
        h('span', null, 'Masse'), h('b', null, `${f2((pr.volume / 1000) * mat.density)} g`)]),
      h('span', null, 'Oberfläche'), h('b', null, `${f2(pr.area / 100)} cm²`),
      h('span', null, 'Schwerpunkt'), h('b', null, pr.com.map(v => f2(v)).join(' / ') + ' mm'),
      ...(() => {
        // moments of inertia about the axes through the centre of mass (from the mesh, with the material's density)
        if (body.surface) return [];
        let mi = null;
        try { mi = meshInertia(body.geometry); } catch { /* open mesh */ }
        if (!mi) return [];
        const k = (mat.density / 1000) / 100, fmt = x => (Math.abs(x) >= 1000 ? Math.round(x).toLocaleString('de-DE') : String(+x.toPrecision(4)).replace('.', ','));
        return [h('span', { title: 'Massenträgheitsmomente um die Achsen durch den Schwerpunkt, parallel zu X, Y und Z' }, 'Trägheitsmomente Ixx / Iyy / Izz'), h('b', null, mi.I.slice(0, 3).map(x => fmt(x * k)).join(' / ') + ' g·cm²')];
      })(),
      h('span', null, 'Abmessungen'), h('b', null, (() => { const bb = body.geometry.boundingBox; const sz = bb.getSize(new THREE.Vector3()); return `${f2(sz.x)} × ${f2(sz.y)} × ${f2(sz.z)} mm`; })()),
    ) : h('p', { class: 'err' }, 'Eigenschaften konnten nicht berechnet werden.'),
  );
}

function propsParams(b) {
  setTitle('PARAMETER');
  const p = state.project;
  const scope = paramScope(p);
  b.append(h('p', { class: 'hint' }, 'Parameter in jedem Zahlenfeld verwenden, z. B. „laenge/2“ oder „dicke-3“. Funktionen: sqrt, sin, cos, tan (Grad), min, max, round, PI.'));
  const grid = h('div', { class: 'ptable' }, h('b', null, 'Name'), h('b', null, 'Ausdruck'), h('b', null, 'Wert'), h('span'));
  p.params.forEach((q, i) => {
    const name = h('input', { type: 'text', value: q.name });
    name.onchange = () => {
      const v = name.value.trim();
      if (!/^[A-Za-z_]\w*$/.test(v)) { status('Name: nur Buchstaben, Ziffern, _ (nicht mit Ziffer beginnen)'); name.value = q.name; return; }
      commit(pp => (pp.params[i].name = v));
    };
    const expr = h('input', { type: 'text', value: q.expr });
    expr.onchange = () => commit(pp => (pp.params[i].expr = expr.value.trim()));
    const v = scope[q.name];
    grid.append(name, expr, h('span', { class: 'val' }, Number.isFinite(v) ? f2(v) : '⚠'), h('button', { title: 'Löschen', onclick: () => commit(pp => pp.params.splice(i, 1)) }, '✕'));
  });
  b.append(grid, h('div', { class: 'btns' }, btn('+ Parameter', () => commit(pp => pp.params.push({ name: nextName(pp.params, 'p'), expr: '10' })), 'primary')));
  b.append(h('p', { class: 'hint' }, 'Hinweis: Beim Umbenennen werden bestehende Verweise nicht automatisch angepasst.'));
}

function propsFeature(b, f) {
  setTitle(FEATURE_TYPES[f.type].toUpperCase());
  const err = allErrors()[f.id];
  const ed = fn => editFeature(f.id, fn);
  b.append(row('Name', txt(f.name, v => ed(x => (x.name = v)))));
  const builder = {
    sketch: propsSketch, extrude: propsExtrude, revolve: propsRevolve, hole: propsHole,
    box: propsPrimitive, cylinder: propsPrimitive, sphere: propsPrimitive,
    fillet: propsEdgeMod, chamfer: propsEdgeMod, shell: propsShell, delface: propsDelFace, replaceface: propsReplaceFace, offsetface: propsOffsetFace, align: propsAlign, thicken: propsThicken,
    surfloft: propsSurfLoft, surftrim: propsTrim, surfextend: propsEdgeSurf, fill: propsEdgeSurf, surfextrude: propsSurfCurves, surfrevolve: propsSurfCurves, patch: propsPatch, offsetsurf: propsOffsetSurf, stitch: propsStitch, draft: propsDraft, split: propsSplit, loft: propsLoft, sweep: propsSweep, freeform: propsFreeform, sheet: propsSheet,
    pattern: propsPattern, mirror: propsMirror, move: propsMove, combine: propsCombine, import: propsImport, canvas: propsImage, decal: propsImage,
    pipe: propsPipe, coil: propsCoil, scale: propsScale, thread: propsThread,
    plane: propsPlane, axis: propsAxis, emboss: propsEmboss, point: propsPoint, rib: propsRib, torus: propsTorus, meshimport: propsMeshImport, meshop: propsMeshOp,
  }[f.type];
  builder(b, f, ed);
  if (f.type !== 'sketch') b.append(row('Unterdrückt', chk(f.suppressed, v => ed(x => (x.suppressed = v)))));
  if (f.type === 'plane') b.append(h('div', { class: 'btns' }, btn('Skizze auf dieser Ebene', () => sketchOnPlaneFeature(f.id), 'primary')));
  if (err) b.append(h('p', { class: 'err' }, '⚠ ' + err));
  const idx = state.project.features.indexOf(f);
  b.append(h('div', { class: 'btns' },
    f.type === 'sketch' ? btn('Skizze bearbeiten', () => editSketch(f.id), 'primary') : null,
    btn('Hierher zurückrollen', () => setRollback(idx + 1 >= state.project.features.length ? null : idx + 1)),
    btn('Löschen', () => deleteFeature(f.id), 'danger'),
  ));
}

// M: setup matrix -> only sketches lying flat in that setup
function sketchOptions(M = null) {
  return state.project.features.filter(x => x.type === 'sketch' && (!M || sketchHorizontalIn(resolved().features.find(r => r.id === x.id), M))).map(s => [s.id, s.name]);
}

function propsSketch(b, f, ed) {
  const rf = resolved().features.find(x => x.id === f.id);
  b.append(
    row('Ebene', h('span', null, planeLabel(rf))),
    row('Versatz', num(f.plane && typeof f.plane.o.find(v => typeof v === 'string') === 'string' ? f.plane.o.find(v => typeof v === 'string') : f2(planeOffset(rf)), v => ed(x => {
      const n = sketchPlane(rf).n;
      x.plane = { ...sketchPlane(rf), o: n.map(c => (typeof v === 'string' ? (Math.abs(c) < 1e-9 ? 0 : c > 0 ? v : `=-(${v.slice(1)})`) : +(c * v).toFixed(6) + 0)) };
    }), { unit: 'mm' })),
    h('p', { class: 'hint' }, `${f.entities.length} Elemente. Versatz verschiebt die Skizzenebene entlang ihrer Normalen.`),
    h('div', { class: 'btns' }, btn('Als DXF exportieren', () => exportSketchDXF(f.id))),
  );
}

function propsSketchEdit(b) {
  const sk = feature(state.sketchId);
  const rsk = resolved().features.find(x => x.id === sk.id);
  setTitle('SKIZZE BEARBEITEN – ' + sk.name);
  const hints = {
    select: 'Punkte, Linien oder Kreise anklicken (Umschalt = mehrere), dann Abhängigkeit oder Bemaßung wählen. Punkte/Linien ziehen zum Verformen. Entf löscht.',
    line: 'Punkte klicken. Auf Startpunkt klicken schließt die Kontur, Enter beendet offen (z. B. als Rotationsachse).',
    rect: 'Erste Ecke klicken, dann gegenüberliegende Ecke.',
    arc: 'Startpunkt klicken, Endpunkt klicken, dann einen Punkt auf dem Bogen. Bögen und Linien, die sich an den Enden treffen, bilden ein Profil.',
    ellipse: 'Mittelpunkt klicken, dann Ende der ersten Halbachse (Richtung), dann die Breite.',
    spline: 'Durchgangspunkte klicken. Auf den Startpunkt klicken schließt die Spline, Enter beendet sie offen.',
    circle: 'Mittelpunkt klicken, dann Radius.',
    ngon: 'Mittelpunkt klicken, dann Eckpunkt (6-Eck, danach änderbar).',
    slot: 'Ersten Bogenmittelpunkt, zweiten Bogenmittelpunkt, dann Breite klicken.',
    text: 'Klicken, um Text zu platzieren. Inhalt, Größe und Schrift danach rechts ändern.',
    project: { face: 'Fläche eines Körpers anklicken: ihr Rand kommt als Kontur in die Skizze. Eine Kante anklicken projiziert nur diese Kante (Kreise bleiben Kreise). Projizierte Geometrie ist violett.', body: 'Körper anklicken: sein Umriss (Schattenriss) auf der Skizzenebene kommt in die Skizze.', cut: 'Körper anklicken: die Kurven, in denen die Skizzenebene ihn schneidet, kommen in die Skizze.' }[projectMode],
  };
  b.append(h('p', { class: 'hint' }, hints[sketcher.tool]), h('p', { class: 'hint' }, `Ebene: ${planeLabel(rsk)} · Rechte/mittlere Maustaste: verschieben · Mausrad: zoomen · Esc: abbrechen`));
  // palette: view, slice, display – and the way out
  b.append(sec('SKIZZENPALETTE'),
    h('div', { class: 'btns' },
      btn('Ansehen', () => { const B = basis(rsk), box = getModel().box.clone(); if (box.isEmpty()) box.setFromCenterAndSize(B.o, new THREE.Vector3(120, 120, 120)); vp.setViewDir(B.n, box); })),
    row('Schnitt (Körper an der Skizzenebene aufschneiden)', chk(sketchSlice, v => { sketchSlice = v; rebuildScene(); })),
    row('Profile hervorheben', chk(getSettings().sketchFill !== false, v => { saveSettings({ sketchFill: v }); rebuildScene(); })),
    h('div', { class: 'btns' }, btn('Normal ↔ Konstruktion (X)', () => { if (!sketcher.toggleConstruction()) status('Zuerst Skizzengeometrie auswählen.'); })));
  const e = sk.entities.find(x => x.id === sketcher.selected);
  const info = sketchInfo(sk.id);
  const cons = sk.constraints || [];
  b.append(h('div', { class: 'stats' },
    h('span', null, 'Freiheitsgrade'), h('b', { style: info.dof === 0 ? 'color:var(--ok)' : '' }, info.dof === 0 ? '0 – vollständig bestimmt ✓' : `${info.dof} – noch beweglich`),
    info.unsatisfied.length ? h('span', null, 'Konflikte') : null, info.unsatisfied.length ? h('b', { style: 'color:var(--danger)' }, `${info.unsatisfied.length} nicht erfüllt`) : null));
  if (sketcher.selection.length) b.append(h('p', { class: 'hint' }, 'Auswahl: ' + sketcher.selection.map(r => refLabel(rsk, r)).join(', ')));
  // pinned edits: the typed field wins, the solver adapts the rest
  const ed = (fn, pin) => commitSketch(sk.id, s => fn(s.entities.find(x => x.id === e.id)), pin ? [`${e.id}.${pin}`] : []);
  if (e) {
    b.append(sec(describeEntity(rsk.entities.find(x => x.id === e.id)).toUpperCase()));
    if (e.proj?.warn) b.append(h('p', { class: 'warn' }, '⚠ Nach der letzten Änderung des Körpers war nicht eindeutig, welche Kante oder Fläche gemeint ist. Bitte prüfen – bei Bedarf löschen und neu projizieren.'));
    if (e.proj) b.append(h('p', { class: 'hint' }, { edge: 'Projizierte Kante: folgt dem Körper, wenn er sich ändert.', face: 'Projizierte Fläche: folgt dem Körper, wenn er sich ändert.', body: 'Projizierter Körperumriss: folgt dem Körper, wenn er sich ändert.', cut: 'Schnittkurve mit dem Körper: folgt dem Körper, wenn er sich ändert.' }[e.proj.kind]),
      h('div', { class: 'btns' },
        e.proj.warn ? btn('Geprüft – stimmt', () => commitSketch(sk.id, x => x.entities.forEach(q => { if (q.proj?.g === e.proj.g) delete q.proj.warn; })), 'primary') : null,
        btn('Verknüpfung lösen', () => commitSketch(sk.id, x => x.entities.forEach(q => { if (q.proj?.g === e.proj.g) delete q.proj; })))));
    const F = (label, key, opt = {}) => row(label, num(e[key], v => ed(x => (x[key] = v), key), { unit: 'mm', ...opt }));
    if (e.type === 'rect') b.append(F('X', 'x'), F('Y', 'y'), F('Breite', 'w', { min: 0.01 }), F('Höhe', 'h', { min: 0.01 }), F('Eckenradius', 'r', { min: 0 }));
    else if (e.type === 'circle') b.append(F('Mitte X', 'cx'), F('Mitte Y', 'cy'), row('Durchmesser', num(typeof e.r === 'string' ? `=2*(${e.r.slice(1)})` : f2(e.r * 2), v => ed(x => (x.r = typeof v === 'string' ? `=(${v.slice(1)})/2` : v / 2), 'r'), { unit: 'mm', min: 0.01 })));
    else if (e.type === 'ngon') b.append(F('Mitte X', 'cx'), F('Mitte Y', 'cy'), F('Umkreisradius', 'r', { min: 0.01 }), F('Ecken', 'n', { unit: null, min: 3, int: true }), F('Drehung', 'rot', { unit: '°' }));
    else if (e.type === 'slot') b.append(F('Mitte X', 'cx'), F('Mitte Y', 'cy'), F('Achsabstand', 'len', { min: 0 }), F('Breite', 'w', { min: 0.01 }), F('Drehung', 'rot', { unit: '°' }));
    else if (e.type === 'text') b.append(row('Text', txt(e.text, v => ed(x => (x.text = v)))), F('X', 'x'), F('Y', 'y'), F('Schriftgröße', 'size', { min: 0.5 }),
      row('Schrift', sel(Object.entries(FONTS).map(([k, f]) => [k, f.label]), e.font || 'sans', v => ed(x => (x.font = v)))), F('Drehung', 'rot', { unit: '°' }));
    else if (e.type === 'ellipse') b.append(F('Mitte X', 'cx'), F('Mitte Y', 'cy'), F('Halbachse 1', 'rx', { min: 0.01 }), F('Halbachse 2', 'ry', { min: 0.01 }), F('Drehung', 'rot', { unit: '°' }));
    else if (e.type === 'poly' && e.curve) {
      const names = e.curve === 'arc' ? ['Start', 'Punkt auf Bogen', 'Ende'] : null;
      e.pts.forEach((p, i) => b.append(row(names ? names[i] : `Punkt ${i + 1}`, h('div', { style: 'display:flex;gap:4px' },
        num(p[0], v => ed(x => (x.pts[i][0] = v), `pts.${i}.0`)), num(p[1], v => ed(x => (x.pts[i][1] = v), `pts.${i}.1`))))));
      if (e.curve === 'spline') b.append(row('Geschlossen', chk(e.closed, v => ed(x => (x.closed = v)))));
    }
    else if (e.type === 'poly') {
      e.pts.forEach((p, i) => b.append(row(`Punkt ${i + 1}`, h('div', { style: 'display:flex;gap:4px' },
        h('input', { type: 'text', value: e.radii?.[i] ?? '', placeholder: 'R', title: 'Eckenradius (Abrundung)', style: 'width:42px', onchange: ev => { const v = parseFloat(ev.target.value.replace(',', '.')); commitSketch(sk.id, s2 => { const x = s2.entities.find(q => q.id === e.id); x.radii ||= {}; if (v > 0) { x.radii[i] = v; if (x.chamfers) delete x.chamfers[i]; } else delete x.radii[i]; if (!Object.keys(x.radii).length) delete x.radii; }); } }),
        h('input', { type: 'text', value: Array.isArray(e.chamfers?.[i]) ? e.chamfers[i].join('; ') : e.chamfers?.[i] ?? '', placeholder: 'F', title: 'Fase (Abstand, ungleich: „2; 3“)', style: 'width:42px', onchange: ev => { const v = ev.target.value.split(';').map(q => parseFloat(q.replace(',', '.'))).filter(q => q > 0); commitSketch(sk.id, s2 => { const x = s2.entities.find(q => q.id === e.id); x.chamfers ||= {}; if (v.length) { x.chamfers[i] = v.length > 1 ? v.slice(0, 2) : v[0]; if (x.radii) delete x.radii[i]; } else delete x.chamfers[i]; if (!Object.keys(x.chamfers).length) delete x.chamfers; }); } }),
        num(p[0], v => ed(x => (x.pts[i][0] = v), `pts.${i}.0`)), num(p[1], v => ed(x => (x.pts[i][1] = v), `pts.${i}.1`))))));
      b.append(row('Geschlossen', chk(e.closed, v => ed(x => (x.closed = v)))));
    }
    const re = rsk.entities.find(x => x.id === e.id);
    b.append(sec('MUSTER'), sketchPatternForm(sk.id, re));
    b.append(h('div', { class: 'btns' },
      btn('Versatz …', () => offsetEntity(sk.id, re)),
      btn('Spiegeln ↔', () => mirrorEntity(sk.id, re, 'y')),
      btn('Spiegeln ↕', () => mirrorEntity(sk.id, re, 'x')),
      btn('Element löschen', () => sketcher.deleteSelected(), 'danger')));
  }
  b.append(sec(`ABHÄNGIGKEITEN & BEMASSUNGEN (${cons.length})`));
  if (!cons.length) b.append(h('p', { class: 'hint' }, 'Noch keine. Geometrie wählen und oben unter ABHÄNGIGKEITEN ein Werkzeug anklicken.'));
  const unsat = new Set(info.unsatisfied);
  for (const c of cons) {
    const label = `${GLYPH[c.type] || '↔'} ${c.type === 'dim' ? DIM_KINDS[c.kind] : CONSTRAINTS[c.type]}`;
    const del = h('button', { class: 'btn', title: 'Löschen', onclick: ev => { ev.stopPropagation(); commitSketch(sk.id, s => { s.constraints = s.constraints.filter(x => x.id !== c.id); }); } }, '✕');
    const line = h('div', {
      class: `list-item cons ${sketcher.selConstraint === c.id ? 'sel' : ''}`, 'data-cid': c.id,
      onclick: () => { sketcher.selConstraint = c.id; renderProps(); rebuildScene(); },
      style: unsat.has(c.id) ? 'color:var(--danger)' : '',
    }, h('span', { class: 'cl' }, label, h('small', null, ' ' + c.refs.map(r => refLabel(rsk, r)).join(' · '))));
    if (c.type === 'dim') {
      line.append(num(c.value, v => commitSketch(sk.id, s => { s.constraints.find(x => x.id === c.id).value = v; }), { unit: c.kind === 'angle' ? '°' : 'mm' }));
      if (['dist', 'hdist', 'vdist'].includes(c.kind)) line.append(sel([['dist', 'ausger.'], ['hdist', 'horiz.'], ['vdist', 'vert.']], c.kind, v => setDimKind(sk.id, c.id, v)));
    }
    line.append(del);
    b.append(line);
  }
  b.append(sec(`ELEMENTE (${sk.entities.length})`));
  for (const x of rsk.entities) {
    const ref = x.type === 'poly' ? `${x.id}:l0` : x.type === 'text' ? `${x.id}:p0` : `${x.id}:c`;
    const on = x.id === sketcher.selected || sketcher.selection.some(r => refEntity(r) === x.id);
    // Umschalt/Strg = mehrere Elemente wählen (für Versatz, Spiegeln, Abhängigkeiten)
    b.append(h('div', { class: 'list-item ' + (on ? 'sel' : ''), title: 'Umschalt/Strg = mehrere wählen', onclick: ev => {
      sketcher.tool = 'select';
      if (ev.shiftKey || ev.ctrlKey) {
        const i = sketcher.selection.findIndex(r => refEntity(r) === x.id);
        if (i >= 0) sketcher.selection.splice(i, 1); else sketcher.selection.push(ref);
      } else sketcher.selection = [ref];
      const last = sketcher.selection[sketcher.selection.length - 1];
      sketcher.selected = last ? refEntity(last) : null;
      sketcher.hooks.changed();
    } }, describeEntity(x)));
  }
  b.append(h('div', { class: 'btns' }, btn('Skizze fertigstellen', finishSketch, 'ok')));
}

function profileChecks(sketchId, current, set, filter = e => e.type !== 'poly' || e.closed) {
  const sketch = resolved().features.find(f => f.id === sketchId);
  const list = sketch ? sketch.entities.filter(filter) : [];
  const all = !Array.isArray(current);
  const wrap = h('div', { class: 'checks' });
  wrap.append(h('label', null, chk(all, v => set(v ? 'all' : list.map(e => e.id))), h('b', null, 'Alle')));
  if (!all) {
    for (const e of list) {
      wrap.append(h('label', null, chk(current.includes(e.id), v => set(v ? [...current, e.id] : current.filter(i => i !== e.id))), describeEntity(e)));
    }
  }
  return wrap;
}

const opSelect = (f, ed, allowed = Object.keys(OPS)) => row('Operation', sel(allowed.map(k => [k, OPS[k]]), f.op, v => ed(x => (x.op = v))));

function propsExtrude(b, f, ed) {
  const fromFaces = f.source === 'faces';
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id;
  const nf = (f.faces || []).length;
  b.append(
    row('Auswahl', sel([['sketch', 'Skizzenprofil'], ['faces', 'Flächen am Körper']], fromFaces ? 'faces' : 'sketch', v => {
      ed(x => { x.source = v === 'faces' ? 'faces' : undefined; if (v === 'faces') { x.faces ||= []; if (!x.op || x.op === 'new') x.op = 'auto'; } else if (x.op === 'auto') x.op = 'join'; });
      if (v === 'faces' && !(f.faces || []).length) togglePick('faces', f.id);
    })),
    fromFaces ? h('div', { class: 'gsel' }, h('span', null, 'Flächen'),
      h('button', { class: 'pickbtn' + (picking ? ' on' : ''), html: PICK_IC + (nf ? ` ${nf} Fläche${nf > 1 ? 'n' : ''}` : ' Auswählen'), onclick: () => togglePick('faces', f.id) }),
      nf ? h('button', { class: 'gx', title: 'Auswahl leeren', onclick: () => ed(x => (x.faces = [])) }, '✕') : null) : null,
    fromFaces ? null : row('Skizze', sel(sketchOptions(), f.sketch, v => ed(x => { x.sketch = v; x.profiles = 'all'; }))),
    fromFaces ? null : row('Profile', profileChecks(f.sketch, f.profiles, v => ed(x => (x.profiles = v)))),
    row('Ausdehnung', sel([['one', 'Eine Seite'], ['sym', 'Symmetrisch'], ['two', 'Zwei Seiten']], f.extent || 'one', v => ed(x => (x.extent = v)))),
    row(f.extent === 'sym' ? 'Gesamtabstand' : 'Abstand', num(f.distance, v => ed(x => (x.distance = v)), { unit: 'mm' })),
    f.extent === 'two' ? row('Abstand 2', num(f.distance2 || 0, v => ed(x => (x.distance2 = v)), { unit: 'mm' })) : null,
    fromFaces ? null : row('Schrägungswinkel', Object.assign(num(f.taper || 0, v => ed(x => (x.taper = v)), { unit: '°' }), { title: 'Die Seitenwände neigen sich um diesen Winkel. Positiv: der Körper wird von der Skizze weg breiter, negativ: schmaler (Entformungsschräge).' })),
    row('Richtung', btn('⇅ Umkehren', () => ed(x => (x.distance = typeof x.distance === 'string' ? `=-(${x.distance.slice(1)})` : -x.distance)))),
    fromFaces ? row('Operation', sel([['auto', 'Automatisch'], ...Object.entries(OPS)], f.op || 'auto', v => ed(x => (x.op = v)))) : opSelect(f, ed),
    h('p', { class: 'hint' }, fromFaces ? 'Ebene Flächen des Körpers werden entlang ihrer Normalen extrudiert. Automatisch: nach außen = Material hinzufügen, nach innen (negativ) = ausschneiden.' : 'Positiver Abstand = in Richtung der Skizzennormalen. Taschen: Ausschneiden mit negativem Abstand.'),
  );
}

function propsRevolve(b, f, ed) {
  const sk = resolved().features.find(x => x.id === f.sketch);
  const lines = sk ? sk.entities.filter(e => e.type === 'poly' && !e.closed) : [];
  b.append(
    row('Skizze', sel(sketchOptions(), f.sketch, v => ed(x => { x.sketch = v; x.profiles = 'all'; }))),
    row('Profile', profileChecks(f.sketch, f.profiles, v => ed(x => (x.profiles = v)))),
    row('Achse', sel([['x', 'Skizzen-X-Achse'], ['y', 'Skizzen-Y-Achse'], ...lines.map(e => [e.id, describeEntity(e)]), ...axisRefOptions(f.id)], f.axis, v => ed(x => (x.axis = v)))),
    row('Winkel', num(f.angle, v => ed(x => (x.angle = v)), { unit: '°' })),
    opSelect(f, ed),
    h('p', { class: 'hint' }, 'Das Profil darf die Achse nicht schneiden. Eine offene Linie in der Skizze kann als Achse dienen.'),
  );
}

function propsHole(b, f, ed) {
  const N = (label, key, opt = {}) => row(label, num(f[key], v => ed(x => (x[key] = v)), { unit: 'mm', min: 0, ...opt }));
  b.append(
    row('Skizze', sel(sketchOptions(), f.sketch, v => ed(x => { x.sketch = v; x.points = 'all'; }))),
    row('Mittelpunkte', profileChecks(f.sketch, f.points, v => ed(x => (x.points = v)), e => e.type === 'circle')),
    row('Typ', sel([['simple', 'Einfach'], ['cbore', 'Senkbohrung (Zylinder)'], ['csink', 'Senkung (Kegel)']], f.kind, v => ed(x => (x.kind = v)))),
    row('Gewindebohrung', chk(!!f.tapped, v => ed(x => { x.tapped = v; if (v && !x.threadSize) x.threadSize = (THREAD_SIZES.find(t => t[3] >= (+x.dia || 0) - 0.21) || THREAD_SIZES[4])[0]; }))),
    f.tapped ? row('Gewinde', sel(THREAD_SIZES.map(t => [t[0], `${t[0]} × ${String(t[2]).replace('.', ',')} (Kernloch Ø${String(t[3]).replace('.', ',')})`]), f.threadSize || 'M8', v => ed(x => (x.threadSize = v)))) : N('Durchmesser', 'dia'),
    f.tapped ? N('Gewindetiefe', 'threadDepth', { allowEmpty: true, ph: 'ganze Bohrung' }) : null,
    row('Durchgehend', chk(f.through, v => ed(x => (x.through = v)))),
    f.through ? null : N('Tiefe', 'depth'),
    f.kind === 'cbore' ? N('Senk-Ø', 'cbDia') : null,
    f.kind === 'cbore' ? N('Senktiefe', 'cbDepth') : null,
    f.kind === 'csink' ? N('Senk-Ø', 'csDia') : null,
    f.kind === 'csink' ? row('Senkwinkel', num(f.csAngle, v => ed(x => (x.csAngle = v)), { unit: '°', min: 1 })) : null,
    f.through ? null : row('Bohrerspitze 118°', chk(f.tip, v => ed(x => (x.tip = v)))),
    h('p', { class: 'hint' }, 'Jeder Kreis der Skizze ist ein Bohrungsmittelpunkt. Gebohrt wird entgegen der Skizzennormalen (ins Material).' + (f.tapped ? ' Gewindebohrung: gebohrt wird das Kernloch; das Gewinde erscheint als Gewindedarstellung am Modell und mit seinem Namen in der Zeichnung.' : '')),
  );
}

// x/y/z rows for picked points: each coordinate editable, plus "pick again"
function pointRows(f, ed, key, n, labels) {
  const pts = f[key] || [];
  const rows = [];
  for (let i = 0; i < n; i++) {
    const q = pts[i];
    rows.push(row(labels[i], q ? h('div', { class: 'xyz' }, ...[0, 1, 2].map(k => num(q[k], v => ed(x => { (x[key] ||= [])[i] ||= [0, 0, 0]; x[key][i][k] = v; }), { unit: null }))) : h('span', { class: 'hint' }, 'noch nicht gewählt')));
  }
  const picking = state.pick?.mode === 'cpoints' && state.pick.id === f.id;
  rows.push(h('div', { class: 'btns' }, btn(picking ? 'Auswahl läuft …' : 'Punkte am Modell wählen', () => { ed(x => (x[key] = [])); startPointPick(f.id, key, n); })));
  return rows;
}
function axisRefOptions(exceptId) {
  const fs = state.project.features;
  let upto = exceptId ? fs.findIndex(f => f.id === exceptId) : fs.length;
  if (upto < 0) upto = fs.length;
  return [['X', 'X-Achse'], ['Y', 'Y-Achse'], ['Z', 'Z-Achse'], ...fs.slice(0, upto).filter(f => f.type === 'axis').map(f => [f.id, f.name])];
}
function propsAxis(b, f, ed) {
  b.append(row('Typ', sel([['2pt', 'Durch zwei Punkte'], ['cyl', 'Durch Zylinder / Bohrung'], ['planes', 'Schnitt zweier Ebenen']], f.kind, v => ed(x => {
    x.kind = v;
    if (v === 'planes') { x.base ||= 'XY'; x.base2 ||= 'XZ'; delete x.pts; } else { x.pts ||= []; }
  }))));
  if (f.kind === 'planes') {
    b.append(row('Ebene 1', sel(planeRefOptions(f.id), f.base, v => ed(x => (x.base = v)))), row('Ebene 2', sel(planeRefOptions(f.id), f.base2, v => ed(x => (x.base2 = v)))));
  } else if (f.kind === 'cyl') {
    const picking = state.pick?.mode === 'axiscyl' && state.pick.id === f.id;
    b.append(row('Zylinder', h('span', null, f.pts?.length === 2 ? `Ø ${f2((f.r || 0) * 2)} mm` : 'noch nicht gewählt')),
      h('div', { class: 'btns' }, btn(picking ? 'Auswahl läuft …' : 'Zylinderfläche wählen', () => { state.pick = { mode: 'axiscyl', id: f.id }; showBanner(['Zylinderfläche oder Bohrung anklicken.', h('button', { onclick: () => { state.pick = null; showBanner(null); renderAll(); } }, 'Abbrechen')]); renderAll(); })));
  } else b.append(...pointRows(f, ed, 'pts', 2, ['Punkt 1', 'Punkt 2']));
  const ax = constructionAxis(f, resolved().features);
  b.append(row('Sichtbar', chk(!f.hidden, v => ed(x => (x.hidden = !v)))),
    ax ? h('p', { class: 'hint' }, `Richtung ${ax.d.map(v => f2(v)).join(' / ')} – nutzbar als Achse für Rotation, Kreis-Muster und Ebene unter Winkel.`) : h('p', { class: 'err' }, 'Achse kann nicht berechnet werden (Punkte fehlen, fallen zusammen oder Ebenen sind parallel).'));
}
function propsPoint(b, f, ed) {
  const N = (label, key) => row(label, num(f[key], v => ed(x => (x[key] = v)), { unit: 'mm' }));
  const picking = state.pick?.mode === 'cpoints' && state.pick.id === f.id;
  b.append(N('X', 'x'), N('Y', 'y'), N('Z', 'z'),
    h('div', { class: 'btns' }, btn(picking ? 'Auswahl läuft …' : 'Am Modell wählen', () => startPointPick(f.id, 'xyz', 1))),
    row('Sichtbar', chk(!f.hidden, v => ed(x => (x.hidden = !v)))),
    h('p', { class: 'hint' }, 'Ecken und Kantenenden rasten beim Anklicken ein. Punkte dienen als Bezug für Ebene durch drei Punkte und Achse durch zwei Punkte.'));
}
function propsPlane(b, f, ed) {
  const N = (label, key, opt = {}) => row(label, num(f[key], v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  b.append(row('Typ', sel([['offset', 'Versatzebene'], ['angle', 'Ebene unter Winkel'], ['mid', 'Mittelebene'], ['3pt', 'Ebene durch drei Punkte'], ['tangent', 'Tangentialebene']], f.kind, v => ed(x => {
    const keep = { id: x.id, type: x.type, name: x.name, hidden: x.hidden, suppressed: x.suppressed };
    for (const k of Object.keys(x)) delete x[k];
    Object.assign(x, keep, planeDefaults(f.base || 'XY', v));
  }))));
  if (f.kind === '3pt') {
    b.append(...pointRows(f, ed, 'pts', 3, ['Punkt 1 (Ursprung)', 'Punkt 2 (X-Richtung)', 'Punkt 3']),
      row('Sichtbar', chk(!f.hidden, v => ed(x => (x.hidden = !v)))),
      constructionPlane(f, resolved().features) ? h('p', { class: 'hint' }, 'Die Ebene geht durch alle drei Punkte; Skizzen darauf wandern mit, wenn du die Punkte änderst.') : h('p', { class: 'err' }, 'Drei Punkte wählen, die nicht auf einer Linie liegen.'));
    return;
  }
  if (f.kind === 'tangent') {
    const picking = state.pick?.mode === 'axiscyl' && state.pick.id === f.id;
    b.append(row('Zylinder', h('span', null, f.pts?.length === 2 ? `Ø ${f2((f.r || 0) * 2)} mm` : 'noch nicht gewählt')),
      h('div', { class: 'btns' }, btn(picking ? 'Auswahl läuft …' : 'Zylinderfläche wählen', () => { state.pick = { mode: 'axiscyl', id: f.id }; showBanner(['Zylinderfläche anklicken.', h('button', { onclick: () => { state.pick = null; showBanner(null); renderAll(); } }, 'Abbrechen')]); renderAll(); })),
      row('Bezugsebene', sel(planeRefOptions(f.id), f.base, v => ed(x => (x.base = v)))), N('Winkel', 'angle', { unit: '°' }),
      row('Sichtbar', chk(!f.hidden, v => ed(x => (x.hidden = !v)))),
      h('p', { class: 'hint' }, 'Die Ebene berührt den Zylinder; der Winkel dreht die Berührlinie um die Zylinderachse, gemessen von der Bezugsebene.'));
    return;
  }
  b.append(row(f.kind === 'mid' ? 'Ebene 1' : 'Bezugsebene', sel(planeRefOptions(f.id), f.base, v => ed(x => (x.base = v)))));
  if (f.kind === 'offset') b.append(N('Abstand', 'offset'));
  if (f.kind === 'angle') b.append(row('Drehachse', sel([['x', 'Lokale X-Achse der Ebene'], ['y', 'Lokale Y-Achse der Ebene'], ...axisRefOptions(f.id).map(([k, l]) => ['@' + k, l])], f.axisRef ? '@' + f.axisRef : f.axis, v => ed(x => { if (v[0] === '@') x.axisRef = v.slice(1); else { delete x.axisRef; x.axis = v; } }))), N('Winkel', 'angle', { unit: '°' }));
  if (f.kind === 'mid') b.append(row('Ebene 2', sel(planeRefOptions(f.id), f.base2, v => ed(x => (x.base2 = v)))));
  b.append(row('Sichtbar', chk(!f.hidden, v => ed(x => (x.hidden = !v)))),
    h('p', { class: 'hint' }, 'Skizzen auf dieser Ebene wandern mit, wenn du die Ebene änderst. Als Bezug geht auch die Ebene einer Skizze, die auf einer Fläche liegt.'));
}

function propsEmboss(b, f, ed) {
  const cyl = f.wrap === 'cyl';
  const picking = state.pick?.mode === 'axiscyl' && state.pick.id === f.id;
  const pickCyl = () => { state.pick = { mode: 'axiscyl', id: f.id }; showBanner(['Zylinderfläche anklicken, auf die geprägt wird.', h('button', { onclick: () => { state.pick = null; showBanner(null); renderAll(); } }, 'Abbrechen')]); renderAll(); };
  b.append(
    row('Skizze', sel(sketchOptions(), f.sketch, v => ed(x => { x.sketch = v; x.profiles = 'all'; }))),
    row('Profile', profileChecks(f.sketch, f.profiles, v => ed(x => (x.profiles = v)))),
    row('Art', sel([['emboss', 'Erhaben (Material hinzufügen)'], ['deboss', 'Vertieft (gravieren)']], f.mode || 'emboss', v => ed(x => (x.mode = v)))),
    row('Tiefe', num(f.depth, v => ed(x => (x.depth = v)), { unit: 'mm', min: 0.01 })),
    row('Fläche', sel([['plane', 'Eben (Skizzenebene)'], ['cyl', 'Zylinder (umwickeln)']], f.wrap || 'plane', v => { ed(x => (x.wrap = v)); if (v === 'cyl' && !(f.pts || []).length) pickCyl(); })),
  );
  if (cyl) b.append(row('Zylinder', h('span', null, f.pts?.length === 2 ? `Ø ${f2((f.r || 0) * 2)} mm` : 'noch nicht gewählt')),
    h('div', { class: 'btns' }, btn(picking ? 'Auswahl läuft …' : 'Zylinderfläche wählen', pickCyl)));
  b.append(h('p', { class: 'hint' }, cyl
    ? 'Die Skizze liegt am besten auf einer Tangentialebene des Zylinders: das Profil wird längentreu um den Zylinder gewickelt. Schrift braucht einige Sekunden.'
    : 'Das Profil wird von der Skizzenebene aus erhaben oder vertieft geprägt.'));
}

function propsRib(b, f, ed) {
  const lines = state.project.features.filter(x => x.type === 'sketch').flatMap(sk => sk.entities.filter(e => e.type === 'poly' && !e.closed).map(e => [`${sk.id}|${e.id}`, `${sk.name}: ${describeEntity(e)}`]));
  b.append(
    row('Linie', sel(lines, `${f.sketch}|${f.entity}`, v => ed(x => { [x.sketch, x.entity] = v.split('|'); }))),
    row('Dicke', num(f.thickness, v => ed(x => (x.thickness = v)), { unit: 'mm', min: 0.01 })),
    row('Höhe', num(f.height, v => ed(x => (x.height = v)), { unit: 'mm' })),
    row('Symmetrisch', chk(f.symmetric, v => ed(x => (x.symmetric = v)))),
    h('p', { class: 'hint' }, 'Die Linie wird in der Skizzenebene auf die Dicke verbreitert und senkrecht zur Skizze um die Höhe extrudiert (negativ = andere Seite).'),
    opSelect(f, ed),
  );
}

function propsTorus(b, f, ed) {
  const N = (label, key, opt = {}) => row(label, num(f[key], v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  b.append(sec('MITTELPUNKT'), N('X', 'x'), N('Y', 'y'), N('Z', 'z'), sec('MASSE'),
    N('Ringradius', 'R', { min: 0.01 }), N('Rohrradius', 'r', { min: 0.01 }),
    row('Achse', sel([['z', 'Z'], ['x', 'X'], ['y', 'Y']], f.axis || 'z', v => ed(x => (x.axis = v)))), opSelect(f, ed));
}

function propsPipe(b, f, ed) {
  const paths = state.project.features.filter(x => x.type === 'sketch').flatMap(sk => sk.entities.filter(e => e.type === 'poly' && !e.closed).map(e => [`${sk.id}|${e.id}`, `${sk.name}: ${describeEntity(e)}`]));
  b.append(
    row('Pfad', sel(paths, `${f.pathSketch}|${f.pathEntity}`, v => ed(x => { [x.pathSketch, x.pathEntity] = v.split('|'); }))),
    row('Außen-Ø', num(f.dia, v => ed(x => (x.dia = v)), { unit: 'mm', min: 0.01 })),
    row('Wandstärke', num(f.wall || 0, v => ed(x => (x.wall = v)), { unit: 'mm', min: 0 })),
    h('p', { class: 'hint' }, 'Wandstärke 0 = Vollmaterial (z. B. Draht oder Stab). Ecken des Pfads werden gerundet.'),
    opSelect(f, ed),
  );
}

function propsCoil(b, f, ed) {
  const N = (label, key, opt = {}) => row(label, num(f[key], v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  const pitch = +f.height / +f.turns;
  b.append(
    sec('POSITION'), N('Mitte X', 'x'), N('Mitte Y', 'y'), N('Mitte Z', 'z'),
    row('Achse', sel([['z', 'Z'], ['y', 'Y'], ['x', 'X']], f.axis || 'z', v => ed(x => (x.axis = v)))),
    sec('FEDER'), N('Durchmesser', 'dia', { min: 0.01 }), N('Windungen', 'turns', { unit: null, min: 0.1 }), N('Höhe', 'height', { min: 0.01 }),
    h('div', { class: 'stats' }, h('span', null, 'Steigung'), h('b', null, `${f2(pitch)} mm`)),
    row('Drehrichtung', sel([['right', 'Rechts'], ['left', 'Links']], f.hand || 'right', v => ed(x => (x.hand = v)))),
    sec('QUERSCHNITT'),
    row('Form', sel([['circle', 'Kreis'], ['square', 'Quadrat'], ['triangle', 'Dreieck (außen)']], f.shape || 'circle', v => ed(x => (x.shape = v)))),
    N('Größe', 'section', { min: 0.01 }),
    opSelect(f, ed),
  );
}

function propsScale(b, f, ed) {
  b.append(
    row('Körper', sel(bodyOptions(), f.body, v => ed(x => (x.body = v)))),
    row('Faktor', num(f.factor, v => ed(x => (x.factor = v)), { min: 0.0001 })),
    row('Bezugspunkt', sel([['origin', 'Punkt (unten)'], ['body', 'Körpermitte']], f.center || 'origin', v => ed(x => (x.center = v)))),
    f.center === 'body' ? null : row('Punkt X', num(f.cx || 0, v => ed(x => (x.cx = v)), { unit: 'mm' })),
    f.center === 'body' ? null : row('Punkt Y', num(f.cy || 0, v => ed(x => (x.cy = v)), { unit: 'mm' })),
    f.center === 'body' ? null : row('Punkt Z', num(f.cz || 0, v => ed(x => (x.cz = v)), { unit: 'mm' })),
    row('Als Kopie', chk(f.copy, v => ed(x => (x.copy = v)))),
    h('div', { class: 'btns' }, btn('Zoll → mm (25,4)', () => ed(x => (x.factor = 25.4))), btn('mm → Zoll', () => ed(x => (x.factor = +(1 / 25.4).toFixed(6))))),
  );
}

function propsThread(b, f, ed) {
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id;
  const th = (getModel().threads || []).find(t => t.id === f.id);
  b.append(
    row('Fläche', h('span', null, (f.faces || []).length ? 'gewählt' : '– keine –')),
    h('div', { class: 'btns' }, btn(picking ? '✓ Auswahl beenden' : 'Zylinderfläche wählen', () => togglePick('faces', f.id), picking ? 'on' : 'primary')),
    th ? h('div', { class: 'stats' }, h('span', null, 'Gewinde'), h('b', null, `${th.name} ${th.outside ? 'Außengewinde' : 'Innengewinde'}`), h('span', null, 'Länge'), h('b', null, `${f2(th.L)} mm`)) : null,
    sec('GEWINDE'),
    row('Größe', sel([['auto', 'Automatisch (aus Ø)'], ...THREAD_SIZES.map(t => [t[0], `${t[0]} × ${t[2]}`])], f.size || 'auto', v => ed(x => { x.size = v; x.pitch = null; }))),
    row('Steigung', num(f.pitch ?? null, v => ed(x => (x.pitch = v)), { unit: 'mm', allowEmpty: true, ph: 'Regelgewinde' })),
    row('Drehrichtung', sel([['right', 'Rechts'], ['left', 'Links']], f.hand || 'right', v => ed(x => (x.hand = v)))),
    row('Volle Länge', chk(f.full !== false, v => ed(x => (x.full = v)))),
    f.full === false ? row('Länge', num(f.length, v => ed(x => (x.length = v)), { unit: 'mm', min: 0.1 })) : null,
    row('Vom anderen Ende', chk(f.flip, v => ed(x => (x.flip = v)))),
    row('Modelliert', chk(f.modeled, v => ed(x => (x.modeled = v)))),
    h('p', { class: 'hint' }, 'Ohne „Modelliert“ wird das Gewinde nur dargestellt (schnell). Modelliert wird die Gewindeform wirklich ausgeschnitten, z. B. für 3D-Druck. Bohrung für M8 = Ø6,8.'),
  );
}

function propsImport(b, f, ed) {
  const N = (label, key, opt = {}) => row(label, num(f[key] ?? 0, v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  const n = getModel().bodies.filter(x => x.id === f.id || x.id.startsWith(f.id + '#')).length;
  b.append(
    h('div', { class: 'stats' }, h('span', null, 'Datei'), h('b', null, f.file || '–'), h('span', null, 'Format'), h('b', null, (f.format || 'step').toUpperCase()), h('span', null, 'Körper'), h('b', null, n)),
    sec('AUSRICHTUNG'),
    row('Y-Achse oben', chk(f.yUp, v => ed(x => (x.yUp = v)))),
    row('Drehung um Z', num(f.rz ?? 0, v => ed(x => (x.rz = v)), { unit: '°' })),
    row('Maßstab', num(f.scale ?? 1, v => ed(x => (x.scale = v)), { min: 0.0001 })),
    h('div', { class: 'btns' }, btn('Zoll → mm (×25,4)', () => ed(x => (x.scale = 25.4))), btn('Auf Ursprung legen', () => importToOrigin(f))),
    sec('VERSCHIEBEN'), N('X', 'dx'), N('Y', 'dy'), N('Z', 'dz'),
    opSelect({ ...f, op: f.op || 'new' }, ed),
    h('p', { class: 'hint' }, 'Importierte Körper sind ohne Konstruktionshistorie, lassen sich aber weiterbearbeiten (Verrundung, Fase, Ausschneiden …) und für CAM verwenden. Mit „Y-Achse oben“ werden Modelle aus Programmen mit Y nach oben richtig hingestellt.'),
  );
}

// moves the imported part so its lowest corner sits on the origin
function importToOrigin(f) {
  const bs = getModel().bodies.filter(x => x.id === f.id || x.id.startsWith(f.id + '#'));
  if (!bs.length) return;
  const box = new THREE.Box3();
  bs.forEach(x => { x.geometry.computeBoundingBox(); box.union(x.geometry.boundingBox); });
  editFeature(f.id, x => { x.dx = f2((+x.dx || 0) - box.min.x); x.dy = f2((+x.dy || 0) - box.min.y); x.dz = f2((+x.dz || 0) - box.min.z); });
}

async function importCAD(file) {
  const ext = file.name.toLowerCase().split('.').pop();
  if (ext === 'stl' || ext === 'obj') return importMesh(file);
  if (ext === 'f3d') {
    alert('Fusion-360-Dateien (.f3d) sind ein geschlossenes Autodesk-Format und können nicht gelesen werden.\n\nIn Fusion 360: Datei → Exportieren → STEP (.stp) wählen und diese Datei hier importieren.');
    return;
  }
  const busy = $('#loading');
  try {
    busy && (busy.hidden = false, $('#loadingText').textContent = ext.startsWith('ig') ? 'IGES wird gelesen …' : 'STEP wird gelesen …');
    let text = await file.text();
    if (ext === 'igs' || ext === 'iges') text = await igesToStep(text);
    else if (!/ISO-10303-21/.test(text.slice(0, 200))) throw new Error('Keine STEP-Datei (ISO-10303-21)');
    const blob = await putBlob(text);
    const id = uid('im');
    commit(p => p.features.push({ id, type: 'import', name: file.name.replace(/\.[^.]+$/, ''), file: file.name, format: ext.startsWith('ig') ? 'iges' : 'step', blob, op: 'new', scale: 1, yUp: false, rz: 0, dx: 0, dy: 0, dz: 0 }));
    const err = getModel().errors[id];
    if (err) throw new Error(err);
    select('feature', id);
    fitView();
    status(`„${file.name}“ importiert – ${getModel().bodies.filter(x => x.id === id || x.id.startsWith(id + '#')).length} Körper`);
  } catch (err) {
    alert('Import fehlgeschlagen: ' + (err.message || err));
  } finally {
    if (busy) busy.hidden = true;
  }
}

// ---------- EINFÜGEN (Aufkleber, Ansichtsbereich, SVG, DXF, Netz, Komponente, Schraube, Mit Gelenken duplizieren, Ableitung) ----------
// a file chooser without a fixed <input> in the page
function chooseFile(accept) {
  return new Promise(res => {
    const i = h('input', { type: 'file', accept, style: 'display:none' });
    i.addEventListener('change', () => { res(i.files[0] || null); i.remove(); });
    document.body.append(i);
    i.click();
  });
}
const readDataURL = file => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(file); });
const imageSize = url => new Promise(res => { const im = new Image(); im.onload = () => res([im.naturalWidth || 1, im.naturalHeight || 1]); im.onerror = () => res([1, 1]); im.src = url; });

// small dialog with rows; resolves with the values or null
function formDialog(title, fields, okLabel = 'OK') {
  return new Promise(resolve => {
    const vals = Object.fromEntries(fields.map(f => [f.key, f.value]));
    const back = h('div', { class: 'modal-back' });
    const done = v => { back.remove(); resolve(v); };
    const rows = fields.map(f => {
      if (f.options) return row(f.label, sel(f.options, f.value, v => (vals[f.key] = v)));
      if (f.check) return row(f.label, chk(f.value, v => (vals[f.key] = v)));
      const i = h('input', { type: 'text', value: f.value ?? '' });
      i.addEventListener('change', () => { const n = +String(i.value).replace(',', '.'); vals[f.key] = f.text ? i.value : Number.isFinite(n) ? n : f.value; });
      return row(f.label, f.unit ? h('div', { class: 'unit' }, i, h('span', null, f.unit)) : i);
    });
    back.append(h('div', { class: 'modal', style: 'height:auto;width:min(440px,calc(100vw - 32px))' },
      h('div', { class: 'modal-head' }, title.toUpperCase(), h('button', { onclick: () => done(null) }, '✕')),
      h('div', { style: 'padding:12px 16px;display:grid;gap:6px' }, ...rows, ...fields.filter(f => f.hint).map(f => h('p', { class: 'hint' }, f.hint))),
      h('div', { class: 'modal-foot' }, h('button', { onclick: () => done(null) }, 'Abbrechen'), h('button', { class: 'primary', onclick: () => { document.activeElement?.blur(); setTimeout(() => done(vals), 0); } }, okLabel))));
    back.addEventListener('keydown', e => { if (e.key === 'Escape') done(null); });
    document.body.append(back);
  });
}

// ----- Ansichtsbereich (canvas) and Aufkleber (decal): images as features -----
const imgTex = new Map();
function imageTexture(blob) {
  if (imgTex.has(blob)) return imgTex.get(blob);
  const url = getBlob(blob);
  if (!url) return null;
  const t = new THREE.TextureLoader().load(url, () => vp.render?.());
  t.colorSpace = THREE.SRGBColorSpace;
  imgTex.set(blob, t);
  return t;
}
function drawImages() {
  const rf = resolved().features, n = replayCount();
  rf.slice(0, n ?? undefined).forEach(f => {
    if ((f.type !== 'canvas' && f.type !== 'decal') || f.hidden || f.suppressed || !f.plane) return;
    const tex = imageTexture(f.blob);
    if (!tex) return;
    const w = +f.w || 100, hgt = w / (+f.aspect || 1);
    const geo = new THREE.PlaneGeometry(w, hgt);
    if (f.flip) geo.scale(-1, 1, 1);
    geo.rotateZ(((+f.rot || 0) * Math.PI) / 180).translate(+f.dx || 0, +f.dy || 0, f.type === 'decal' ? 0.03 : 0);
    const selected = state.sel?.kind === 'feature' && state.sel.id === f.id;
    const mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: Math.min(1, Math.max(0.05, f.opacity ?? 1)), side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2 }));
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(planeMatrixOf({ plane: f.plane }));
    mesh.renderOrder = 4;
    vp.sketches.add(mesh);
    if (selected) {
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(geo), new THREE.LineBasicMaterial({ color: 0x0696d7, depthTest: false, transparent: true }));
      e.matrixAutoUpdate = false;
      e.matrix.copy(mesh.matrix);
      e.renderOrder = 9;
      vp.sketches.add(e);
    }
  });
}
async function newImageFeature(type, plane, name, dataURL) {
  const [iw, ih] = await imageSize(dataURL);
  const blob = await putBlob(dataURL);
  const box = getModel().box;
  const w = type === 'decal' ? Math.max(10, Math.min(60, box.isEmpty() ? 40 : box.getSize(new THREE.Vector3()).length() * 0.25)) : 100;
  const id = uid(type === 'decal' ? 'dc' : 'cv');
  commit(p => p.features.push({ id, type, name, blob, plane, w: f2(w), aspect: +(iw / ih).toFixed(5), dx: 0, dy: 0, rot: 0, opacity: type === 'decal' ? 1 : 0.6, flip: false }));
  select('feature', id);
  return id;
}
async function insertCanvas() {
  const file = await chooseFile('image/png,image/jpeg,image/webp,image/gif,image/svg+xml');
  if (!file) return;
  if (state.sketchId) {
    // in a sketch: on its plane, without leaving the sketch
    const rsk = resolved().features.find(f => f.id === state.sketchId), data = await readDataURL(file);
    const [iw, ih] = await imageSize(data), blob = await putBlob(data);
    commit(p => p.features.push({ id: uid('cv'), type: 'canvas', name: file.name.replace(/\.[^.]+$/, ''), blob, plane: JSON.parse(JSON.stringify(sketchPlane(rsk))), w: 100, aspect: +(iw / ih).toFixed(5), dx: 0, dy: 0, rot: 0, opacity: 0.5, flip: false }));
    return status('Bild liegt als Vorlage auf der Skizzenebene (Breite 100 mm). „Vorlage kalibrieren“ stellt den Maßstab über zwei Punkte ein.');
  }
  const v = await formDialog('Ansichtsbereich', [{ key: 'plane', label: 'Ebene', value: 'XY', options: [['XY', 'XY-Ebene'], ['XZ', 'XZ-Ebene'], ['YZ', 'YZ-Ebene']] },
    { key: 'hint', hint: 'Das Bild liegt als Vorlage auf der Ebene. Größe, Lage, Drehung und Deckkraft danach im Eigenschaftenfenster einstellen (z. B. Breite nach einer bekannten Abmessung).' }]);
  if (!v) return;
  await newImageFeature('canvas', { ...BASE_PLANES[v.plane] }, file.name.replace(/\.[^.]+$/, ''), await readDataURL(file));
  fitView();
}
let pendingDecal = null;
async function insertDecal() {
  if (getModel().box.isEmpty()) return status('Aufkleber brauchen einen Körper.');
  const file = await chooseFile('image/png,image/jpeg,image/webp,image/gif,image/svg+xml');
  if (!file) return;
  pendingDecal = { name: file.name.replace(/\.[^.]+$/, ''), data: await readDataURL(file) };
  state.pick = { mode: 'decal' };
  showBanner(['Aufkleber: Fläche anklicken, auf die das Bild kommt.', h('button', { onclick: () => { state.pick = null; pendingDecal = null; showBanner(null); renderAll(); } }, 'Abbrechen')]);
  renderAll();
}
async function placeDecal(e, meshes) {
  const hit = vp.raycast(e, meshes)[0];
  if (!hit || !pendingDecal) return status('Auf eine Fläche des Körpers klicken.');
  const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  const pl = planeFromFace(hit.point, n);
  const d = pendingDecal;
  pendingDecal = null;
  state.pick = null;
  showBanner(null);
  await newImageFeature('decal', { ...pl, o: hit.point.toArray().map(v => +v.toFixed(4)) }, d.name, d.data);
}
function propsImage(b, f, ed) {
  const N = (label, key, opt = {}) => row(label, num(f[key] ?? opt.def ?? 0, v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  b.append(sec(f.type === 'decal' ? 'AUFKLEBER' : 'ANSICHTSBEREICH'),
    f.type === 'canvas' ? row('Ebene', sel([['XY', 'XY-Ebene'], ['XZ', 'XZ-Ebene'], ['YZ', 'YZ-Ebene']], Object.keys(BASE_PLANES).find(k => JSON.stringify(BASE_PLANES[k].n) === JSON.stringify(f.plane.n)) || 'XY', v => ed(x => (x.plane = { ...BASE_PLANES[v] })))) : null,
    N('Breite', 'w', { min: 0.1 }),
    h('div', { class: 'stats' }, h('span', null, 'Höhe'), h('b', null, `${f2((+f.w || 0) / (+f.aspect || 1))} mm (Seitenverhältnis bleibt)`)),
    N('Versatz X', 'dx'), N('Versatz Y', 'dy'), row('Drehung', num(f.rot || 0, v => ed(x => (x.rot = v)), { unit: '°' })),
    row('Deckkraft', num(Math.round((f.opacity ?? 1) * 100), v => ed(x => (x.opacity = Math.min(1, Math.max(0.05, v / 100)))), { unit: '%', min: 5 })),
    row('Spiegeln', chk(f.flip, v => ed(x => (x.flip = v)))),
    f.type === 'canvas' ? h('div', { class: 'btns' }, btn('Kalibrieren …', () => calibrateCanvas(f.id))) : null,
    f.type === 'canvas' ? h('p', { class: 'hint' }, 'Kalibrieren: zwei Punkte im Bild anklicken, deren Abstand bekannt ist, und den wirklichen Abstand eingeben – das Bild bekommt den richtigen Maßstab.') : null,
    h('p', { class: 'hint' }, f.type === 'decal' ? 'Bild auf einer Körperfläche (Logo, Beschriftung, Typenschild) – nur zur Darstellung, es verändert die Geometrie nicht.' : 'Vorlagebild zum Nachzeichnen: Skizze auf derselben Ebene erstellen und die Konturen nachfahren.'));
}

// ----- Bild nachzeichnen: outlines or centre lines of a picture as sketch curves, SVG or DXF -----
async function traceImageDialog(given) {
  const file = given instanceof File ? given : await chooseFile('image/png,image/jpeg,image/webp,image/gif,image/bmp,image/svg+xml');
  if (!file) return;
  const url = await readDataURL(file);
  const im = await new Promise(res => { const i = new Image(); i.onload = () => res(i); i.onerror = () => res(null); i.src = url; });
  if (!im) return alert('Das Bild konnte nicht gelesen werden.');
  // large pictures are traced at up to 1400 pixels: enough for clean lines, and quick
  const nw = im.naturalWidth || 800, nh = im.naturalHeight || 600, sc = Math.min(1, 1400 / Math.max(nw, nh));
  const w = Math.max(2, Math.round(nw * sc)), hh = Math.max(2, Math.round(nh * sc));
  const src = Object.assign(document.createElement('canvas'), { width: w, height: hh });
  const sx = src.getContext('2d', { willReadFrequently: true });
  sx.drawImage(im, 0, 0, w, hh);
  const rgba = sx.getImageData(0, 0, w, hh).data;
  const name = file.name.replace(/\.[^.]+$/, ''), inSketch = !!state.sketchId;
  const o = { threshold: 128, invert: false, mode: 'all', minSize: 12, tolerance: 0.6, smoothing: 1, width: 100, canvas: true, curves: 'fit', source: 'grey', nColors: 4 };
  let quant = null, chosen = new Set();
  const hex = c => '#' + c.map(v => v.toString(16).padStart(2, '0')).join('');
  const swatches = h('div', { class: 'trace-colors' });
  const win = modalWin('Bild nachzeichnen', 1000);
  const view = Object.assign(h('canvas', { class: 'trace-view' }), { width: w, height: hh });
  const info = h('p', { class: 'hint' });
  let img = null, lines = [], timer = null, nPts = 0;
  const paint = () => {
    const g = view.getContext('2d');
    g.globalAlpha = 1; g.fillStyle = '#fff'; g.fillRect(0, 0, w, hh);
    g.globalAlpha = 0.28; g.drawImage(src, 0, 0);
    g.globalAlpha = 1; g.strokeStyle = '#e03131'; g.lineWidth = Math.max(1, w / 600); g.lineJoin = 'round';
    g.beginPath();
    for (const l of lines) { l.pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y))); if (l.closed) g.closePath(); }
    g.stroke();
    info.textContent = `${lines.length} Kurven mit ${nPts} ${o.curves === 'fit' ? 'Stücken' : 'Punkten'} · Größe ${f2(o.width)} × ${f2((o.width * hh) / w)} mm${nPts > 6000 ? ' – sehr viele Punkte: Genauigkeit vergröbern oder kleine Flächen ignorieren, sonst wird die Skizze träge' : ''}`;
  };
  const drawSwatches = () => swatches.replaceChildren(...quant.palette.map((c, k) => h('label', { title: hex(c) },
    chk(chosen.has(k), v => { if (v) chosen.add(k); else chosen.delete(k); later(); }), h('i', { style: `background:${hex(c)}` }), `${Math.round((100 * quant.counts[k]) / (w * hh))} %`)));
  const run = () => {
    if (o.source === 'color') {
      // every chosen colour is traced on its own
      if (!quant || quant.n !== o.nColors) {
        quant = { ...quantize(rgba, w, hh, o.nColors), n: o.nColors };
        const back = quant.counts.indexOf(Math.max(...quant.counts)); // the most frequent colour is the background
        chosen = new Set(quant.palette.map((_, k) => k).filter(k => k !== back));
        drawSwatches();
      }
      img = { w, h: hh };
      lines = [...chosen].sort((a, b) => a - b).flatMap(k => traceImage({ w, h: hh, ink: inkOfColors(quant.index, w, hh, [k]) }, { ...o, threshold: 128 }).map(l => ({ ...l, color: hex(quant.palette[k]) })));
    } else {
      img = { w, h: hh, ink: inkFromRGBA(rgba, w, hh, o.invert) };
      lines = traceImage(img, o);
    }
    nPts = lines.reduce((a, l) => a + (l.circle ? 1 : l.segs ? l.segs.length : l.pts.length), 0);
    paint();
  };
  const later = () => { clearTimeout(timer); timer = setTimeout(run, 120); };
  const slider = Object.assign(h('input', { type: 'range', min: 1, max: 254, step: 1 }), { value: o.threshold });
  slider.addEventListener('input', () => { o.threshold = +slider.value; later(); });
  const greyBox = h('div', null, h('div', { class: 'hint' }, 'Schwellwert (hell ↔ dunkel)'), slider,
    row('Invertieren (helle Linien auf dunklem Grund)', chk(o.invert, v => { o.invert = v; later(); })));
  const colorBox = Object.assign(h('div', null,
    row('Anzahl Farben', num(o.nColors, v => { o.nColors = Math.max(2, Math.min(8, Math.round(v ?? 4))); later(); }, { min: 2 })),
    h('div', { class: 'hint' }, 'Farben, die nachgezeichnet werden (jede für sich)'), swatches), { hidden: true });
  win.body.append(h('div', { class: 'trace-wrap' }, view,
    h('div', { class: 'trace-side' },
      row('Nachzeichnen', sel([['all', 'Konturen außen und innen'], ['outer', 'Nur Außenkonturen'], ['inner', 'Nur Innenkonturen (Öffnungen)'], ['center', 'Mittellinie der Striche']], o.mode, v => { o.mode = v; later(); })),
      row('Kurven', sel([['fit', 'Geraden, Bögen und Kreise'], ['poly', 'Linienzüge']], o.curves, v => { o.curves = v; later(); })),
      row('Trennen nach', sel([['grey', 'Helligkeit (Schwellwert)'], ['color', 'Farben']], o.source, v => { o.source = v; greyBox.hidden = v !== 'grey'; colorBox.hidden = v !== 'color'; later(); })),
      greyBox, colorBox,
      row('Kleine Flächen ignorieren', num(o.minSize, v => { o.minSize = Math.max(0, v ?? 0); later(); }, { unit: 'px', min: 0 })),
      row('Genauigkeit', num(o.tolerance, v => { o.tolerance = Math.max(0.05, v ?? 0.6); later(); }, { unit: 'px', min: 0.05 })),
      row('Glätten', sel([['0', 'Aus (eckig)'], ['1', 'Leicht'], ['2', 'Stark']], String(o.smoothing), v => { o.smoothing = +v; later(); })),
      row('Breite des Bildes', num(o.width, v => { o.width = Math.max(0.1, v ?? 100); paint(); }, { unit: 'mm', min: 0.1 })),
      row('Bild als Vorlage dahinterlegen', chk(o.canvas, v => { o.canvas = v; })),
      info,
      h('p', { class: 'hint' }, 'Konturen folgen dem Rand der dunklen Flächen. Die Mittellinie läuft in der Mitte der Striche – passend für Gravuren und Strichzeichnungen. „Geraden, Bögen und Kreise“ erkennt gerade Kanten, scharfe Ecken, Rundungen und Kreise; „Linienzüge“ folgt dem Bild Punkt für Punkt. Den Maßstab danach bei Bedarf mit „Vorlage kalibrieren“ oder „Skalieren“ anpassen.'))));
  const curves = () => toSketch(lines, img, o.width);
  const none = () => { if (lines.length) return false; status('Keine Kurven gefunden – Schwellwert anpassen.'); return true; };
  const insert = async () => {
    if (none()) return;
    const ents = toEntities(curves()).map(e => ({ id: uid('e'), ...e }));
    const rsk = inSketch ? resolved().features.find(f => f.id === state.sketchId) : null;
    const plane = rsk ? JSON.parse(JSON.stringify(sketchPlane(rsk))) : { ...BASE_PLANES.XY };
    if (o.canvas) {
      const blob = await putBlob(url);
      commit(p => p.features.push({ id: uid('cv'), type: 'canvas', name, blob, plane, w: f2(o.width), aspect: +(w / hh).toFixed(5), dx: 0, dy: 0, rot: 0, opacity: 0.35, flip: false }));
    }
    if (inSketch) commitSketch(state.sketchId, sk => sk.entities.push(...ents));
    else { const id = uid('sk'); insertFeature({ id, type: 'sketch', name, plane, entities: ents }); select('feature', id); }
    win.close();
    fitView();
    status(`Bild nachgezeichnet: ${ents.length} Kurven ${inSketch ? 'in die Skizze eingefügt' : `als Skizze „${name}“ eingefügt`}`);
  };
  win.foot.append(
    btn('Als SVG speichern', () => { if (!none()) download(name + '.svg', toSVG(curves(), o.width, (o.width * hh) / w), 'image/svg+xml'); }),
    btn('Als DXF speichern', () => { if (!none()) download(name + '.dxf', writeDXF(toEntities(curves())), 'application/dxf'); }),
    h('span', { style: 'flex:1' }), btn('Abbrechen', win.close), btn(inSketch ? 'In die Skizze einfügen' : 'Als neue Skizze einfügen', insert, 'primary'));
  run();
}

// ----- Vorlage kalibrieren: two points on the picture and their real distance set its scale -----
async function calibrateCanvas(fid) {
  const cvs = resolved().features.filter(f => f.type === 'canvas' && !f.hidden && !f.suppressed);
  if (!cvs.length) return status('Kein Vorlagebild vorhanden – erst ein Bild als Vorlage einfügen.');
  let f = cvs.find(x => x.id === fid) || (state.sel?.kind === 'feature' ? cvs.find(x => x.id === state.sel.id) : null) || (cvs.length === 1 ? cvs[0] : null);
  if (!f) {
    const v = await formDialog('Vorlage kalibrieren', [{ key: 'id', label: 'Bild', value: cvs[cvs.length - 1].id, options: cvs.map(x => [x.id, x.name]) }]);
    if (!v) return;
    f = cvs.find(x => x.id === v.id);
  }
  const B = basis({ plane: f.plane }), plane = new THREE.Plane().setFromNormalAndCoplanarPoint(B.n, B.o);
  const pts = [], dots = [];
  const block = e => { e.stopPropagation(); e.preventDefault(); };
  const stop = () => {
    vp.el.removeEventListener('pointerdown', onDown, true);
    vp.el.removeEventListener('click', block, true);
    window.removeEventListener('keydown', onKey, true);
    dots.forEach(d => d.remove());
    showBanner(null);
  };
  const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); stop(); status('Kalibrieren abgebrochen.'); } };
  const onDown = async e => {
    if (e.button !== 0) return;
    block(e);
    vp.raycast(e, []);
    const hit = vp.raycaster.ray.intersectPlane(plane, new THREE.Vector3());
    if (!hit) return status('Die Bildebene wurde nicht getroffen – Ansicht drehen.');
    pts.push(hit);
    dots.push(document.body.appendChild(h('div', { class: 'calib-dot', style: `left:${e.clientX}px;top:${e.clientY}px` })));
    if (pts.length < 2) return showBanner(['Kalibrieren: zweiten Punkt im Bild anklicken (Esc bricht ab).']);
    vp.el.removeEventListener('pointerdown', onDown, true);
    const d0 = pts[0].distanceTo(pts[1]), c = v => String(+(+v).toFixed(3)).replace('.', ',');
    if (d0 < 1e-6) { stop(); return status('Die beiden Punkte liegen aufeinander.'); }
    const t = await askValue('Kalibrieren: wirklicher Abstand der beiden Punkte (mm)', c(d0));
    stop();
    if (t == null) return;
    const d = evalExpr(String(t).replace(/,/g, '.'), paramScope(state.project));
    if (!(d > 0)) return status('Kalibrieren: einen Abstand größer als 0 angeben.');
    const k = d / d0, r = v => +(+v).toFixed(4);
    editFeature(f.id, x => { x.w = r((+f.w || 100) * k); x.dx = r((+f.dx || 0) * k); x.dy = r((+f.dy || 0) * k); });
    status(`Bild kalibriert: Maßstab × ${c(k)}, Breite jetzt ${c((+f.w || 100) * k)} mm`);
  };
  vp.el.addEventListener('pointerdown', onDown, true);
  vp.el.addEventListener('click', block, true);
  window.addEventListener('keydown', onKey, true);
  showBanner(['Kalibrieren: ersten Punkt im Bild anklicken (Esc bricht ab).']);
}

// ----- SVG-Datei einfügen: paths become a new sketch -----
async function insertSVG() {
  const file = await chooseFile('.svg,image/svg+xml');
  if (!file) return;
  const text = await file.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const root0 = doc.documentElement;
  if (root0.nodeName.toLowerCase() !== 'svg') return alert('Keine gültige SVG-Datei.');
  // millimetres per SVG user unit
  const vb = (root0.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  const wAttr = root0.getAttribute('width') || '';
  const unitMM = { mm: 1, cm: 10, in: 25.4, pt: 25.4 / 72, pc: 25.4 / 6, px: 25.4 / 96, '': 25.4 / 96 };
  const wm = wAttr.match(/^([\d.]+)\s*(mm|cm|in|pt|pc|px)?$/);
  let scale = 25.4 / 96;
  if (wm) scale = (+wm[1] * unitMM[wm[2] || '']) / (vb.length === 4 && vb[2] > 0 ? vb[2] : +wm[1]);
  const v = await formDialog('SVG-Datei einfügen', [
    { key: 'plane', label: 'Ebene', value: 'XY', options: [['XY', 'XY-Ebene'], ['XZ', 'XZ-Ebene'], ['YZ', 'YZ-Ebene']] },
    { key: 'scale', label: 'Maßstab (mm je SVG-Einheit)', value: +scale.toFixed(6) },
    { key: 'hint', hint: `Aus der Datei erkannt: ${wm ? `Breite ${wAttr}` : 'keine Einheit (96 dpi angenommen)'}. Pfade, Rechtecke, Kreise, Ellipsen, Linien und Polygone werden zu Skizzenkurven.` }], 'Einfügen');
  if (!v) return;
  const k = +v.scale > 0 ? +v.scale : scale;
  // measure in the live DOM (getPointAtLength / getCTM need a rendered SVG)
  const host = h('div', { style: 'position:fixed;left:-10000px;top:0;width:10px;height:10px;overflow:hidden;visibility:hidden' });
  host.innerHTML = text;
  document.body.append(host);
  const root = host.querySelector('svg');
  const ents = [];
  try {
    const rootInv = root.getScreenCTM().inverse();
    const toUser = (el, x, y) => { const m = rootInv.multiply(el.getScreenCTM()); return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f]; };
    const toSk = ([x, y]) => [+(x * k).toFixed(4), +(-y * k).toFixed(4)];
    const simplify = pts => { const out = [pts[0]]; for (let i = 1; i < pts.length - 1; i++) { const a = out[out.length - 1], b2 = pts[i], c = pts[i + 1]; const cr = Math.abs((b2[0] - a[0]) * (c[1] - a[1]) - (b2[1] - a[1]) * (c[0] - a[0])) / (Math.hypot(c[0] - a[0], c[1] - a[1]) || 1); if (cr > 0.004) out.push(b2); } out.push(pts[pts.length - 1]); return out; };
    const addSampled = (el, d, closed) => {
      const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
      tmp.setAttribute('d', d);
      el.parentNode.insertBefore(tmp, el);
      const len = tmp.getTotalLength();
      if (len > 0) {
        const n = Math.max(2, Math.min(4000, Math.ceil((len * k) / 0.2)));
        const pts = [];
        for (let i = 0; i <= n; i++) { const q = tmp.getPointAtLength((len * i) / n); pts.push(toSk(toUser(tmp, q.x, q.y))); }
        let s2 = simplify(pts);
        if (closed && s2.length > 2 && Math.hypot(s2[0][0] - s2.at(-1)[0], s2[0][1] - s2.at(-1)[1]) < 1e-3) s2 = s2.slice(0, -1);
        if (s2.length >= 2) ents.push({ id: uid('e'), type: 'poly', closed: closed && s2.length > 2, pts: s2 });
      }
      tmp.remove();
    };
    // a path split into its sub-paths (every M/m starts a new one; relative m made absolute)
    const subPaths = el => {
      const toks = (el.getAttribute('d') || '').match(/[a-zA-Z]|[-+]?(?:\d*\.\d+|\d+\.?)(?:[eE][-+]?\d+)?/g) || [];
      const parts = [];
      let cur = null;
      for (const t of toks) { if (/^[mM]$/.test(t)) { cur = [t]; parts.push(cur); } else if (cur) cur.push(t); else { cur = [t]; parts.push(cur); } }
      const out = [];
      let start = [0, 0], end = [0, 0];
      for (const p of parts) {
        if (p[0] === 'm' && p.length >= 3) {
          const x = end[0] + +p[1], y = end[1] + +p[2];
          p.splice(0, 3, 'M', String(x), String(y), ...(p.length > 3 && !/[a-zA-Z]/.test(p[3]) ? ['l'] : []));
        }
        const d = p.join(' ');
        const closed = /[zZ]\s*$/.test(d.trim());
        out.push({ d, closed });
        // where the next relative m starts
        const tmp = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        tmp.setAttribute('d', d);
        root.append(tmp);
        const L = tmp.getTotalLength(), q0 = tmp.getPointAtLength(0), q1 = tmp.getPointAtLength(L);
        start = [q0.x, q0.y];
        end = closed ? start : [q1.x, q1.y];
        tmp.remove();
      }
      return out;
    };
    for (const el of root.querySelectorAll('path, rect, circle, ellipse, line, polyline, polygon')) {
      if (el.closest('defs, clipPath, mask, symbol, marker, pattern')) continue;
      const tag = el.nodeName.toLowerCase();
      if (tag === 'circle') {
        const m = rootInv.multiply(el.getScreenCTM()), sx = Math.hypot(m.a, m.b), sy = Math.hypot(m.c, m.d);
        if (Math.abs(sx - sy) < 1e-6 && Math.abs(m.a * m.c + m.b * m.d) < 1e-9) {
          const [cx, cy] = toSk(toUser(el, +el.getAttribute('cx') || 0, +el.getAttribute('cy') || 0));
          ents.push({ id: uid('e'), type: 'circle', cx, cy, r: +((+el.getAttribute('r') || 0) * sx * k).toFixed(4) });
          continue;
        }
      }
      if (tag === 'path') { for (const sp of subPaths(el)) addSampled(el, sp.d, sp.closed); continue; }
      // the other shapes: sample their outline with a path of the same geometry
      const len = el.getTotalLength?.();
      if (!(len > 0)) continue;
      const n = Math.max(2, Math.min(4000, Math.ceil((len * k) / 0.2)));
      const pts = [];
      for (let i = 0; i <= n; i++) { const q = el.getPointAtLength((len * i) / n); pts.push(toSk(toUser(el, q.x, q.y))); }
      const closed = tag !== 'line' && tag !== 'polyline';
      let s2 = simplify(pts);
      if (closed && s2.length > 2) s2 = s2.slice(0, -1);
      ents.push({ id: uid('e'), type: 'poly', closed: closed && s2.length > 2, pts: s2 });
    }
  } catch (err) {
    host.remove();
    return alert('SVG konnte nicht gelesen werden: ' + err.message);
  }
  host.remove();
  if (!ents.length) return status('Keine Kurven in der SVG-Datei gefunden.');
  if (state.sketchId) {
    commitSketch(state.sketchId, sk => sk.entities.push(...ents));
    fitView();
    return status(`SVG: ${ents.length} Kurven in die Skizze eingefügt`);
  }
  const id = uid('sk');
  insertFeature({ id, type: 'sketch', name: file.name.replace(/\.[^.]+$/, ''), plane: { ...BASE_PLANES[v.plane] }, entities: ents });
  select('feature', id);
  fitView();
  status(`SVG: ${ents.length} Kurven als Skizze „${file.name}“ eingefügt`);
}

// ----- DXF-Datei einfügen: a new sketch with the DXF contents -----
async function insertDXF() {
  const file = await chooseFile('.dxf');
  if (!file) return;
  const v = await formDialog('DXF-Datei einfügen', [{ key: 'plane', label: 'Ebene', value: 'XY', options: [['XY', 'XY-Ebene'], ['XZ', 'XZ-Ebene'], ['YZ', 'YZ-Ebene']] }], 'Einfügen');
  if (!v) return;
  try {
    const { circles, polys, skipped } = parseDXF(await file.text());
    const ents = [
      ...circles.map(c => ({ id: uid('e'), type: 'circle', cx: +c.cx.toFixed(4), cy: +c.cy.toFixed(4), r: +c.r.toFixed(4) })),
      ...polys.filter(q => q.pts.length >= 2).map(q => ({ id: uid('e'), type: 'poly', closed: q.closed, pts: q.pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) })),
    ];
    if (!ents.length) return status('Keine Kurven in der DXF-Datei gefunden.');
    const id = uid('sk');
    insertFeature({ id, type: 'sketch', name: file.name.replace(/\.[^.]+$/, ''), plane: { ...BASE_PLANES[v.plane] }, entities: ents });
    select('feature', id);
    fitView();
    const sk = Object.entries(skipped).map(([kk, n]) => `${n}× ${kk}`).join(', ');
    status(`DXF: ${circles.length} Kreise, ${polys.length} Konturen eingefügt${sk ? ` – übersprungen: ${sk}` : ''}`);
  } catch (err) { alert('DXF konnte nicht gelesen werden: ' + (err.message || err)); }
}

// ----- Komponente einfügen / Ableitung einfügen: another design of this app -----
async function chooseDocument(title) {
  const docs = (await listDocs()).filter(d => d.id !== state.project.docId);
  if (!docs.length) { status('Keine anderen gespeicherten Designs vorhanden.'); return null; }
  return new Promise(resolve => {
    const back = h('div', { class: 'modal-back' });
    const done = v => { back.remove(); resolve(v); };
    back.append(h('div', { class: 'modal', style: 'width:min(640px,calc(100vw - 32px));height:min(520px,calc(100vh - 40px))' },
      h('div', { class: 'modal-head' }, title.toUpperCase(), h('button', { onclick: () => done(null) }, '✕')),
      h('div', { class: 'docpick' }, ...docs.map(d => h('button', { class: 'docpick-item', onclick: () => done(d) },
        d.thumb ? h('img', { src: d.thumb, alt: '' }) : h('div', { class: 'docpick-ph', html: SVG.body }),
        h('span', null, d.name), h('small', null, new Date(d.updated).toLocaleString('de-DE'))))),
      h('div', { class: 'modal-foot' }, h('button', { onclick: () => done(null) }, 'Abbrechen'))));
    document.body.append(back);
  });
}
// all bodies of another design as one STEP import feature (keeps exact B-rep geometry)
async function docBodiesFeature(rec, name) {
  const doc = JSON.parse(rec.current);
  await loadBlobs(doc);
  const r = regenerate(resolveProject(doc));
  if (!r.bodies.length) throw new Error(`„${rec.name}“ enthält keine Körper`);
  const step = await exportSTEP(r.bodies).text();
  const blob = await putBlob(step);
  return { id: uid('im'), type: 'import', name, file: `${rec.name}.step`, format: 'step', blob, op: 'new', scale: 1, yUp: false, rz: 0, dx: 0, dy: 0, dz: 0, sourceDoc: rec.id };
}
async function insertComponent() {
  const rec = await chooseDocument('Komponente einfügen');
  if (!rec) return;
  const busy = $('#loading');
  try {
    busy && (busy.hidden = false, $('#loadingText').textContent = `„${rec.name}“ wird eingefügt …`);
    const f = await docBodiesFeature(rec, rec.name);
    commit(p => p.features.push(f));
    select('feature', f.id);
    fitView();
    status(`Komponente „${rec.name}“ eingefügt – Lage im Eigenschaftenfenster (Verschieben X/Y/Z, Drehung) anpassen.`);
  } catch (err) { alert('Einfügen fehlgeschlagen: ' + (err.message || err)); } finally { if (busy) busy.hidden = true; }
}
async function insertDerive() {
  const rec = await chooseDocument('Ableitung einfügen – Quelle wählen');
  if (!rec) return;
  const doc = JSON.parse(rec.current);
  const nSk = (doc.features || []).filter(f => f.type === 'sketch').length, nPar = (doc.params || []).length;
  const v = await formDialog(`Ableitung aus „${rec.name}“`, [
    { key: 'bodies', label: 'Körper', check: true, value: true },
    { key: 'sketches', label: `Skizzen (${nSk})`, check: true, value: false },
    { key: 'params', label: `Parameter (${nPar})`, check: true, value: false },
    { key: 'hint', hint: 'Körper werden als exakte Geometrie (B-Rep) übernommen, Skizzen mit ihrer Ebene, Parameter nur wenn der Name hier noch frei ist.' }], 'Einfügen');
  if (!v) return;
  const busy = $('#loading');
  try {
    busy && (busy.hidden = false, $('#loadingText').textContent = 'Ableitung wird eingefügt …');
    const add = [];
    if (v.bodies) add.push(await docBodiesFeature(rec, `${rec.name} (abgeleitet)`));
    if (v.sketches) {
      const rp2 = resolveProject(doc);
      for (const sk of rp2.features.filter(f => f.type === 'sketch')) {
        const raw = doc.features.find(f => f.id === sk.id);
        add.push({ ...JSON.parse(JSON.stringify(raw)), id: uid('sk'), name: `${sk.name} (${rec.name})`, plane: sketchPlane(sk), planeRef: undefined, hidden: false });
      }
    }
    const have = new Set((state.project.params || []).map(q => q.name));
    const params = v.params ? (doc.params || []).filter(q => !have.has(q.name)) : [];
    const skippedP = v.params ? (doc.params || []).length - params.length : 0;
    commit(p => { p.features.push(...add); if (params.length) (p.params ||= []).push(...params.map(q => ({ ...q, id: uid('p') }))); });
    fitView();
    status(`Abgeleitet: ${add.length} Element(e)${params.length ? `, ${params.length} Parameter` : ''}${skippedP ? ` – ${skippedP} Parameter übersprungen (Name schon vorhanden)` : ''}`);
  } catch (err) { alert('Ableitung fehlgeschlagen: ' + (err.message || err)); } finally { if (busy) busy.hidden = true; }
}

// ----- Schraube einfügen: ISO screws and nuts built from sketches and extrusions -----
const BOLT_SIZES = {
  // d, ISO 4762 (dk, k, s socket, t), ISO 4017/4032 (s, k, m)
  M3: [3, 5.5, 3, 2.5, 1.3, 5.5, 2, 2.4], M4: [4, 7, 4, 3, 2, 7, 2.8, 3.2], M5: [5, 8.5, 5, 4, 2.5, 8, 3.5, 4.7], M6: [6, 10, 6, 5, 3, 10, 4, 5.2],
  M8: [8, 13, 8, 6, 4, 13, 5.3, 6.8], M10: [10, 16, 10, 8, 5, 16, 6.4, 8.4], M12: [12, 18, 12, 10, 6, 18, 7.5, 10.8], M16: [16, 24, 16, 14, 8, 24, 10, 14.8], M20: [20, 30, 20, 17, 10, 30, 12.5, 18],
};
const BOLT_TYPES = { iso4762: 'Zylinderschraube mit Innensechskant (ISO 4762)', iso4017: 'Sechskantschraube (ISO 4017)', iso4032: 'Sechskantmutter (ISO 4032)' };
let pendingBolt = null;
async function insertBolt() {
  const hasBody = !getModel().box.isEmpty();
  const v = await formDialog('Schraube einfügen', [
    { key: 'type', label: 'Typ', value: 'iso4762', options: Object.entries(BOLT_TYPES) },
    { key: 'size', label: 'Größe', value: 'M6', options: Object.keys(BOLT_SIZES).map(k => [k, k]) },
    { key: 'len', label: 'Länge (Schaft)', value: 20, unit: 'mm' },
    { key: 'where', label: 'Position', value: hasBody ? 'hole' : 'origin', options: [...(hasBody ? [['hole', 'Bohrung im Modell anklicken']] : []), ['origin', 'Ursprung (Achse Z)']] },
    { key: 'hint', hint: 'Bei „Bohrung“ sitzt der Kopf auf der Seite der Bohrung, die näher am Klickpunkt liegt; der Schaft zeigt in die Bohrung.' }], 'Einfügen');
  if (!v) return;
  if (v.where === 'origin') return buildBolt(v, new THREE.Vector3(0, 0, 0), new THREE.Vector3(0, 0, 1));
  pendingBolt = v;
  state.pick = { mode: 'boltHole' };
  showBanner(['Schraube: Bohrung (Zylinderfläche) im Modell anklicken.', h('button', { onclick: () => { state.pick = null; pendingBolt = null; showBanner(null); renderAll(); } }, 'Abbrechen')]);
  renderAll();
}
function placeBolt(e, meshes) {
  const hit = vp.raycast(e, meshes)[0];
  if (!hit) return status('Auf eine Bohrung klicken.');
  const c = cylinderInfo(getModel().bodies, hit.point.toArray());
  if (!c) return status('Das ist keine Bohrung (Zylinderfläche) – bitte die Bohrungswand anklicken.');
  const d = new THREE.Vector3(...c.dir).normalize(), L = new THREE.Vector3(...c.loc);
  // a hole is concave: the face normal points towards the axis (a fillet or boss points away)
  const rel = hit.point.clone().sub(L), radial = rel.sub(d.clone().multiplyScalar(rel.dot(d)));
  const nrm = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
  if (radial.dot(nrm) > 0) return status('Das ist keine Bohrung (Verrundung oder Zapfen) – bitte die Innenwand einer Bohrung anklicken.');
  const a = L.clone().addScaledVector(d, c.t0), b2 = L.clone().addScaledVector(d, c.t1);
  // head on the end nearer to the click, shank pointing into the hole
  const top = a.distanceTo(hit.point) < b2.distanceTo(hit.point) ? a : b2, other = top === a ? b2 : a;
  const n = top.clone().sub(other).normalize();
  const v = pendingBolt;
  pendingBolt = null;
  state.pick = null;
  showBanner(null);
  buildBolt(v, top, n);
}
function buildBolt(v, top, n) {
  const [d, dk, k, ss, t, s, kh, m] = BOLT_SIZES[v.size];
  const L = Math.max(1, +v.len || 20);
  const pl = planeFromFace(top, n), x = pl.x, plane = o => ({ o: o.toArray().map(q => +q.toFixed(4)), x, n: n.toArray().map(q => +q.toFixed(6)) });
  const hex = (sAcross, extra = []) => [{ id: uid('e'), type: 'ngon', cx: 0, cy: 0, r: +(sAcross / Math.sqrt(3)).toFixed(4), n: 6, rot: 0 }, ...extra];
  const circ = r => ({ id: uid('e'), type: 'circle', cx: 0, cy: 0, r: +r.toFixed(4) });
  const label = v.type === 'iso4032' ? `Mutter ${v.size}` : `Schraube ${v.size}×${L}`;
  const feats = [];
  const sketch = (name, o, ents) => { const id = uid('sk'); feats.push({ id, type: 'sketch', name, plane: plane(o), entities: ents, hidden: true }); return id; };
  const extrude = (name, sk, dist, op, target) => { const id = uid('ex'); feats.push({ id, type: 'extrude', name, sketch: sk, profiles: 'all', extent: 'one', distance: dist, distance2: 5, op, ...(target ? { target } : {}) }); return id; };
  if (v.type === 'iso4032') {
    extrude(label, sketch(`${label} – Skizze`, top, hex(s, [circ(d / 2)])), m, 'new');
  } else {
    const shank = extrude(`${label} – Schaft`, sketch(`${label} – Schaft`, top, [circ(d / 2)]), -L, 'new');
    const headH = v.type === 'iso4762' ? k : kh;
    extrude(`${label} – Kopf`, sketch(`${label} – Kopf`, top, v.type === 'iso4762' ? [circ(dk / 2)] : hex(s)), headH, 'join', shank);
    if (v.type === 'iso4762') extrude(`${label} – Innensechskant`, sketch(`${label} – Innensechskant`, top.clone().addScaledVector(n, headH), hex(ss)), -t, 'cut');
  }
  commit(p => p.features.push(...feats));
  const err = Object.keys(getModel().errors).find(id => feats.some(f => f.id === id));
  if (err) status(`${label}: ${getModel().errors[err]}`);
  else status(`${label} eingefügt (${BOLT_TYPES[v.type]})`);
  select('feature', feats[feats.length - 1].id);
}

// ----- Mit Gelenken duplizieren: copies of a body that keep its joints -----
async function duplicateWithJoints() {
  const m = getModel();
  const src = state.sel?.kind === 'body' ? m.bodies.find(b => b.id === state.sel.id) : null;
  if (!src) return status('Zuerst einen Körper im Browser oder Ansichtsfenster auswählen.');
  const bb = src.geometry.boundingBox || (src.geometry.computeBoundingBox(), src.geometry.boundingBox);
  const v = await formDialog('Mit Gelenken duplizieren', [
    { key: 'count', label: 'Anzahl Kopien', value: 1 },
    { key: 'dx', label: 'Versatz X', value: f2(bb.max.x - bb.min.x + 10), unit: 'mm' },
    { key: 'dy', label: 'Versatz Y', value: 0, unit: 'mm' },
    { key: 'dz', label: 'Versatz Z', value: 0, unit: 'mm' },
    { key: 'hint', hint: `Kopien von „${src.name}“; Gelenke und Positionierung des Körpers werden für jede Kopie übernommen.` }], 'Duplizieren');
  if (!v) return;
  const n = Math.max(1, Math.min(50, Math.round(+v.count || 1)));
  commit(p => {
    const joints = (p.assembly?.joints || []).filter(j => j.child === src.id || j.parent === src.id);
    for (let i = 1; i <= n; i++) {
      const id = uid('mv');
      p.features.push({ id, type: 'move', name: nextName(p.features, `Kopie ${src.name}`), body: src.id, copy: true, dx: f2(v.dx * i), dy: f2(v.dy * i), dz: f2(v.dz * i), rz: 0, cx: 0, cy: 0 });
      if (p.assembly?.placements?.[src.id]) p.assembly.placements[id] = { ...p.assembly.placements[src.id] };
      for (const j of joints) {
        p.assembly.joints.push({ ...JSON.parse(JSON.stringify(j)), id: uid('j'), name: nextName(p.assembly.joints, 'Gelenk'),
          child: j.child === src.id ? id : j.child, parent: j.parent === src.id ? id : j.parent,
          origin: (j.origin || [0, 0, 0]).map((q, a) => f2(+q + [v.dx, v.dy, v.dz][a] * i)) });
      }
    }
  });
  status(`${n} Kopie(n) von „${src.name}“ mit Gelenken erstellt`);
}

function propsPrimitive(b, f, ed) {
  const N = (label, key, opt = {}) => row(label, num(f[key], v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  b.append(sec(f.type === 'box' ? 'ECKE' : 'MITTELPUNKT'), N('X', 'x'), N('Y', 'y'), N('Z', 'z'), sec('MASSE'));
  if (f.type === 'box') b.append(N('Länge (X)', 'w', { min: 0.01 }), N('Breite (Y)', 'd', { min: 0.01 }), N('Höhe (Z)', 'h'));
  else if (f.type === 'cylinder') b.append(N('Radius', 'r', { min: 0.01 }), N('Höhe (Z)', 'h'));
  else b.append(N('Radius', 'r', { min: 0.01 }));
  b.append(opSelect(f, ed));
}

function propsEdgeMod(b, f, ed) {
  const fillet = f.type === 'fillet';
  const picking = state.pick?.mode === 'edges' && state.pick.id === f.id;
  b.append(
    row(fillet ? (f.variable ? 'Radius am Anfang' : 'Radius') : 'Abstand', num(fillet ? f.radius : f.distance, v => ed(x => (fillet ? (x.radius = v) : (x.distance = v))), { unit: 'mm', min: 0.01 })),
    fillet ? row('Veränderlicher Radius', chk(f.variable, v => ed(x => { x.variable = v; if (v) { x.all = false; x.radius2 ??= +(2 * (+x.radius || 1)).toFixed(3); } }))) : '',
    fillet && f.variable ? row('Radius am Ende', num(f.radius2, v => ed(x => (x.radius2 = v)), { unit: 'mm', min: 0.01 })) : '',
    fillet && f.variable ? row('Anfang und Ende tauschen', chk(f.flip, v => ed(x => (x.flip = v)))) : '',
    ...(fillet && f.variable ? [
      ...(f.law || []).map((q, i) => h('div', { class: 'flange-sub' }, h('span', null, `Stützpunkt ${i + 1}`),
        num(Math.round(q[0] * 1000) / 10, v => ed(x => (x.law[i][0] = Math.min(0.99, Math.max(0.01, (v ?? 50) / 100)))), { unit: '%', min: 1 }),
        num(q[1], v => ed(x => (x.law[i][1] = v)), { unit: 'mm', min: 0.01 }),
        h('button', { class: 'gx', title: 'Stützpunkt entfernen', onclick: () => ed(x => x.law.splice(i, 1)) }, '✕'))),
      h('div', { class: 'btns' }, btn('+ Stützpunkt (Lage in %, Radius)', () => { requestFullKernel(); ed(x => (x.law = [...(x.law || []), [0.5, +(((+x.radius || 1) + (+x.radius2 || 1)) / 2).toFixed(3)]])); })),
      row('Über die Kantenkette durchlaufend', chk(f.chain, v => { if (v) requestFullKernel(); ed(x => (x.chain = v)); })),
      f.chain ? h('p', { class: 'hint' }, 'Mehrere aneinanderhängende Kanten zählen als eine Strecke: Der Radius läuft vom Anfang der Kette bis zu ihrem Ende, Stützpunkte gelten in % der ganzen Kettenlänge. Das rechnet der große Geometriekern.') : '',
      (f.law || []).length ? h('p', { class: 'hint' }, 'Mit Stützpunkten läuft der Radius durch die angegebenen Werte (Lage in % der Kantenlänge). Das rechnet der große Geometriekern; beim ersten Mal lädt er einige Sekunden.') : '',
    ] : []),
    fillet && f.variable ? h('p', { class: 'hint' }, 'Der Radius wächst gleichmäßig vom Anfang zum Ende jeder gewählten Kante. Welches Ende der Anfang ist, legt die Kante fest – bei Bedarf tauschen.') : '',
    f.variable ? '' : row('Alle Kanten', chk(f.all, v => ed(x => (x.all = v)))),
  );
  if (!f.all) {
    b.append(
      row('Kanten', h('span', null, `${(f.edges || []).length} gewählt`)),
      h('div', { class: 'btns' },
        btn(picking ? '✓ Auswahl beenden' : 'Kanten wählen', () => togglePick('edges', f.id), picking ? 'on' : 'primary'),
        btn('Auswahl leeren', () => ed(x => (x.edges = [])))),
      h('p', { class: 'hint' }, 'Während der Auswahl wird das Modell vor diesem Schritt gezeigt. Kanten anklicken zum Hinzufügen/Entfernen.'),
    );
  }
}

function propsShell(b, f, ed) {
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id;
  b.append(
    row('Wandstärke', num(f.thickness, v => ed(x => (x.thickness = v)), { unit: 'mm', min: 0.01 })),
    row('Offene Flächen', h('span', null, `${(f.faces || []).length} gewählt`)),
    h('div', { class: 'btns' },
      btn(picking ? '✓ Auswahl beenden' : 'Flächen wählen', () => togglePick('faces', f.id), picking ? 'on' : 'primary'),
      btn('Auswahl leeren', () => ed(x => (x.faces = [])))),
    h('p', { class: 'hint' }, 'Die gewählten Flächen werden entfernt, der Körper wird nach innen ausgehöhlt.'),
  );
}

// "Fläche löschen": the chosen faces go, the neighbours close the gap. Runs in the full kernel with every
// recomputation of the model (loaded when first needed).
function propsDelFace(b, f, ed) {
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id;
  requestFullKernel();
  b.append(
    row('Flächen', h('span', null, `${(f.faces || []).length} gewählt`)),
    h('div', { class: 'btns' },
      btn(picking ? '✓ Auswahl beenden' : 'Flächen wählen', () => togglePick('faces', f.id), picking ? 'on' : 'primary'),
      btn('Auswahl leeren', () => ed(x => (x.faces = [])))),
    h('p', { class: 'hint' }, 'Alle Flächen wählen, die verschwinden sollen (bei einer Tasche Wände und Boden, bei einer Bohrung die Wand, bei einer Verrundung die Rundung). Die Nachbarflächen werden über die Lücke verlängert. Der Schritt rechnet bei Änderungen am Körper mit; beim ersten Mal lädt dafür der große Geometriekern (einige Sekunden).'));
}
// "Fläche versetzen": faces move along their normal (holes and pins change their diameter)
function propsOffsetFace(b, f, ed) {
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id;
  b.append(
    row('Flächen', h('span', null, `${(f.faces || []).length} gewählt`)),
    h('div', { class: 'btns' },
      btn(picking ? '✓ Auswahl beenden' : 'Flächen wählen', () => togglePick('faces', f.id), picking ? 'on' : 'primary'),
      btn('Auswahl leeren', () => ed(x => (x.faces = [])))),
    row('Abstand', num(f.distance, v => ed(x => (x.distance = v)), { unit: 'mm' })),
    h('p', { class: 'hint' }, 'Positiv = nach außen (mehr Material), negativ = nach innen. Ebene Flächen verschieben sich; bei einer Bohrung oder einem Zapfen ändert sich der Radius um den Abstand – eine Bohrung wird mit positivem Abstand enger.'));
}
// "Ausrichten": a body is laid with one of its faces onto a face of another body
function propsAlign(b, f, ed) {
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id, n = (f.faces || []).length;
  b.append(
    row('Flächen', h('span', null, n === 0 ? 'keine gewählt' : n === 1 ? 'Fläche am bewegten Körper gewählt' : 'beide gewählt')),
    h('div', { class: 'btns' },
      btn(picking ? '✓ Auswahl beenden' : 'Flächen wählen', () => togglePick('faces', f.id), picking ? 'on' : 'primary'),
      btn('Auswahl leeren', () => ed(x => (x.faces = [])))),
    row('Gleich gerichtet (statt gegenüber)', chk(f.flip, v => ed(x => (x.flip = v)))),
    row('Abstand', num(f.offset || 0, v => ed(x => (x.offset = v)), { unit: 'mm' })),
    h('p', { class: 'hint' }, 'Erst die Fläche an dem Körper anklicken, der bewegt wird, dann die Zielfläche am anderen Körper. Der Körper wird gedreht und verschoben, bis der erste Klickpunkt auf dem zweiten liegt und die Flächen aufeinander liegen.'));
}
// "Fläche ersetzen": a flat face moves onto another plane
function propsReplaceFace(b, f, ed) {
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id;
  b.append(
    row('Fläche', h('span', null, `${(f.faces || []).length} gewählt`)),
    h('div', { class: 'btns' },
      btn(picking ? '✓ Auswahl beenden' : 'Fläche wählen', () => togglePick('faces', f.id), picking ? 'on' : 'primary'),
      btn('Auswahl leeren', () => ed(x => (x.faces = [])))),
    row('Zielebene', sel(planeRefOptions(f.id), f.planeRef || 'XY', v => ed(x => (x.planeRef = v)))),
    row('Versatz zur Ebene', num(f.offset || 0, v => ed(x => (x.offset = v)), { unit: 'mm' })),
    h('p', { class: 'hint' }, 'Die gewählte ebene Fläche wird durch die Zielebene ersetzt: Der Körper wächst bis zu ihr oder wird bis zu ihr gekürzt, die Seitenwände laufen gerade weiter. Mit einer geneigten Konstruktionsebene wird die Fläche schräg.'));
}

// ----- Flächen (surface workspace) -----
const curveFilter = e => !e.cons && e.type !== 'text' && e.type !== 'point';
function propsSurfCurves(b, f, ed) {
  const rev = f.type === 'surfrevolve';
  const sk = resolved().features.find(x => x.id === f.sketch);
  const lines = sk ? sk.entities.filter(e => e.type === 'poly' && !e.closed && !e.curve) : [];
  b.append(
    row('Skizze', sel(sketchOptions(), f.sketch, v => ed(x => { x.sketch = v; x.curves = 'all'; }))),
    row('Kurven', profileChecks(f.sketch, f.curves, v => ed(x => (x.curves = v)), curveFilter)));
  if (rev) b.append(
    row('Achse', sel([['x', 'Skizzen-X-Achse'], ['y', 'Skizzen-Y-Achse'], ...lines.map(e => [e.id, describeEntity(e)]), ...axisRefOptions(f.id)], f.axis, v => ed(x => (x.axis = v)))),
    row('Winkel', num(f.angle, v => ed(x => (x.angle = v)), { unit: '°' })));
  else b.append(
    row('Ausdehnung', sel([['one', 'Eine Seite'], ['sym', 'Symmetrisch'], ['two', 'Zwei Seiten']], f.extent || 'one', v => ed(x => (x.extent = v)))),
    row('Abstand', num(f.distance, v => ed(x => (x.distance = v)), { unit: 'mm' })),
    f.extent === 'two' ? row('Abstand 2', num(f.distance2, v => ed(x => (x.distance2 = v)), { unit: 'mm' })) : null);
  b.append(h('p', { class: 'hint' }, rev
    ? 'Offene oder geschlossene Kurven werden um die Achse gedreht – es entsteht eine Fläche, kein Volumen.'
    : 'Offene oder geschlossene Kurven werden senkrecht zur Skizze gezogen – es entsteht eine Fläche (Wand ohne Dicke). Mit „Aufdicken“ oder „Zusammenfügen“ wird daraus ein Volumen.'));
}
function propsPatch(b, f, ed) {
  b.append(
    row('Skizze', sel(sketchOptions(), f.sketch, v => ed(x => { x.sketch = v; x.profiles = 'all'; }))),
    row('Profile', profileChecks(f.sketch, f.profiles, v => ed(x => (x.profiles = v)))),
    h('p', { class: 'hint' }, 'Geschlossene Profile werden zu ebenen Flächen – z. B. Deckel und Boden, um Flächen anschließend zu einem Körper zusammenzufügen.'));
}
function propsOffsetSurf(b, f, ed) {
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id;
  b.append(
    row('Flächen', h('span', null, `${(f.faces || []).length} gewählt`)),
    h('div', { class: 'btns' },
      btn(picking ? '✓ Auswahl beenden' : 'Flächen wählen', () => togglePick('faces', f.id), picking ? 'on' : 'primary'),
      btn('Auswahl leeren', () => ed(x => (x.faces = [])))),
    row('Abstand', num(f.distance, v => ed(x => (x.distance = v)), { unit: 'mm' })),
    h('p', { class: 'hint' }, 'Erzeugt eine neue Fläche im Abstand zu den gewählten Flächen (negativ = nach innen). Der Körper bleibt unverändert.'));
}
function propsEdgeSurf(b, f, ed) {
  const fill = f.type === 'fill';
  const picking = state.pick?.mode === 'edges' && state.pick.id === f.id;
  b.append(
    row('Kanten', h('span', null, `${(f.edges || []).length} gewählt`)),
    h('div', { class: 'btns' },
      btn(picking ? '✓ Auswahl beenden' : 'Kanten wählen', () => togglePick('edges', f.id), picking ? 'on' : 'primary'),
      btn('Auswahl leeren', () => ed(x => (x.edges = [])))),
    fill ? row('Tangential anschließen', chk(f.tangent, v => ed(x => (x.tangent = v))))
      : row('Abstand', num(f.distance, v => ed(x => (x.distance = v)), { unit: 'mm', min: 0.01 })),
    h('p', { class: 'hint' }, fill
      ? 'Die Kanten müssen einen geschlossenen Rand bilden (z. B. die offene Öffnung eines Rohrs). Die neue Fläche spannt sich hinein – auch gewölbt. „Tangential“ lässt sie glatt an die Nachbarflächen anschließen.'
      : 'Die Fläche wird über die gewählten Randkanten hinaus tangential verlängert – auch an gebogenen Kanten.'));
}
function propsSurfLoft(b, f, ed) {
  const all = sketchOptions();
  const secs = f.sections || [];
  b.append(sec('QUERSCHNITTE (Reihenfolge)'));
  secs.forEach((id, i) => b.append(row(`Kurve ${i + 1}`, h('div', { style: 'display:flex;gap:4px' },
    sel(all, id, v => ed(x => (x.sections[i] = v))),
    h('button', { class: 'btn', title: 'Entfernen', onclick: () => ed(x => x.sections.splice(i, 1)) }, '✕')))));
  b.append(
    h('div', { class: 'btns' }, btn('+ Querschnitt', () => ed(x => x.sections.push(all.find(([id]) => !x.sections.includes(id))?.[0] || all[0][0])))),
    row('Geradlinig', chk(f.ruled, v => ed(x => (x.ruled = v)))),
    h('p', { class: 'hint' }, 'Je Skizze die erste Kurve – offen oder geschlossen. Die Kurven werden mit einer Haut verbunden (Fläche ohne Dicke).'));
}
function propsTrim(b, f, ed) {
  const m = getModel();
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id;
  const surfs = m.bodies.filter(x => x.surface || x.id === f.body);
  const kind = f.toolKind || 'body';
  b.append(
    row('Fläche', sel([['', '– wählen –'], ...surfs.map(x => [x.id, bodyName(x)])], f.body || '', v => ed(x => (x.body = v)))),
    row('Trimmwerkzeug', sel([['body', 'Körper oder Fläche'], ['plane', 'Ebene'], ['sketch', 'Skizzenkurven']], kind, v => ed(x => (x.toolKind = v)))));
  if (kind === 'body') b.append(row('Werkzeug', sel([['', '– wählen –'], ...m.bodies.filter(x => x.id !== f.body).map(x => [x.id, bodyName(x) + (x.surface ? ' (Fläche)' : '')])], f.tool || '', v => ed(x => (x.tool = v)))));
  else if (kind === 'plane') b.append(row('Ebene', sel(planeRefOptions(f.id), f.plane || 'XY', v => ed(x => (x.plane = v)))));
  else b.append(
    row('Skizze', sel(sketchOptions(), f.sketch, v => ed(x => { x.sketch = v; x.curves = 'all'; }))),
    row('Kurven', profileChecks(f.sketch, f.curves, v => ed(x => (x.curves = v)), curveFilter)));
  b.append(
    row('Entfernen', h('span', null, `${(f.faces || []).length} Bereich(e)`)),
    h('div', { class: 'btns' },
      btn(picking ? '✓ Auswahl beenden' : 'Bereiche anklicken', () => togglePick('faces', f.id), picking ? 'on' : 'primary'),
      btn('Auswahl leeren', () => ed(x => (x.faces = [])))),
    h('p', { class: 'hint' }, 'Die Fläche wird dort geteilt, wo das Werkzeug sie schneidet. Danach die Bereiche anklicken, die wegfallen sollen.'));
}
function propsStitch(b, f, ed) {
  const m = getModel();
  const surfs = m.bodies.filter(x => x.surface || (f.bodies || []).includes(x.id));
  const cur = Array.isArray(f.bodies) && f.bodies.length ? f.bodies : null;
  const wrap = h('div', { class: 'checks' });
  wrap.append(h('label', null, chk(!cur, v => ed(x => (x.bodies = v ? [] : surfs.map(s => s.id)))), h('b', null, 'Alle Flächenkörper')));
  if (cur) for (const s of surfs) wrap.append(h('label', null, chk(cur.includes(s.id), v => ed(x => (x.bodies = v ? [...cur, s.id] : cur.filter(i => i !== s.id)))), bodyName(s)));
  b.append(row('Flächen', wrap),
    row('Toleranz', num(f.tolerance ?? 0.01, v => ed(x => (x.tolerance = v)), { unit: 'mm', min: 0.0001 })),
    h('p', { class: 'hint' }, 'Flächen mit gemeinsamen Kanten werden zu einer verbunden. Ist die Hülle rundum geschlossen, entsteht ein Volumenkörper (danach normal weiterbearbeitbar). Lücken größer als die Toleranz bleiben offen.'));
}

function propsThicken(b, f, ed) {
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id;
  b.append(
    row('Flächen', h('span', null, `${(f.faces || []).length} gewählt`)),
    h('div', { class: 'btns' },
      btn(picking ? '✓ Auswahl beenden' : 'Flächen wählen', () => togglePick('faces', f.id), picking ? 'on' : 'primary'),
      btn('Auswahl leeren', () => ed(x => (x.faces = [])))),
    row('Dicke', num(f.thickness, v => ed(x => (x.thickness = v)), { unit: 'mm', min: 0.01 })),
    row('Richtung', sel([['out', 'Nach außen'], ['in', 'Nach innen'], ['both', 'Beidseitig (symmetrisch)']], f.direction || 'out', v => ed(x => (x.direction = v)))),
    opSelect(f, ed),
    h('p', { class: 'hint' }, 'Die gewählten Flächen bekommen eine Dicke entlang ihrer Normalen – auch gewölbte Flächen. Angrenzende Flächen werden zu einem Stück verbunden.'));
}

function propsLoft(b, f, ed) {
  const all = sketchOptions();
  const secs = f.sections || [];
  b.append(sec('QUERSCHNITTE (Reihenfolge)'));
  secs.forEach((id, i) => b.append(row(`Profil ${i + 1}`, h('div', { style: 'display:flex;gap:4px' },
    sel(all, id, v => ed(x => (x.sections[i] = v))),
    h('button', { class: 'btn', title: 'Entfernen', onclick: () => ed(x => x.sections.splice(i, 1)) }, '✕')))));
  b.append(
    h('div', { class: 'btns' }, btn('+ Querschnitt', () => ed(x => x.sections.push(all.find(([id]) => !x.sections.includes(id))?.[0] || all[0][0])))),
    row('Geradlinig', chk(f.ruled, v => ed(x => (x.ruled = v)))),
    opSelect(f, ed),
    h('p', { class: 'hint' }, 'Verbindet die größten geschlossenen Profile der gewählten Skizzen (z. B. Rechteck unten, Kreis oben).'),
  );
}

function propsSweep(b, f, ed) {
  const ps = resolved().features.find(x => x.id === f.pathSketch);
  const paths = ps ? ps.entities.filter(e => e.type === 'poly') : [];
  b.append(
    row('Profil-Skizze', sel(sketchOptions(), f.sketch, v => ed(x => { x.sketch = v; x.profiles = 'all'; }))),
    row('Profile', profileChecks(f.sketch, f.profiles, v => ed(x => (x.profiles = v)))),
    row('Pfad-Skizze', sel(sketchOptions(), f.pathSketch, v => ed(x => { x.pathSketch = v; x.pathEntity = ''; }))),
    row('Pfad', sel([['', '– wählen –'], ...paths.map(e => [e.id, describeEntity(e)])], f.pathEntity || '', v => ed(x => (x.pathEntity = v)))),
    opSelect(f, ed),
    h('p', { class: 'hint' }, 'Das Profil wird entlang einer Linie/eines Linienzugs geführt. Profil am besten senkrecht zum Pfadanfang zeichnen (z. B. Profil auf XZ, Pfad auf XY).'),
  );
}

function propsDraft(b, f, ed) {
  const picking = state.pick?.mode === 'faces' && state.pick.id === f.id;
  b.append(
    row('Winkel', num(f.angle, v => ed(x => (x.angle = v)), { unit: '°' })),
    row('Neutrale Ebene Z', num(f.z || 0, v => ed(x => (x.z = v)), { unit: 'mm' })),
    row('Flächen', h('span', null, `${(f.faces || []).length} gewählt`)),
    h('div', { class: 'btns' },
      btn(picking ? '✓ Auswahl beenden' : 'Flächen wählen', () => togglePick('faces', f.id), picking ? 'on' : 'primary'),
      btn('Auswahl leeren', () => ed(x => (x.faces = [])))),
    h('p', { class: 'hint' }, 'Neigt senkrechte Seitenflächen um den Winkel (Zugrichtung +Z), z. B. für Gussformen. Negativer Winkel neigt in die andere Richtung.'),
  );
}

function propsSplit(b, f, ed) {
  b.append(
    row('Körper', sel(bodyOptions(), f.body, v => ed(x => (x.body = v)))),
    row('Trennebene', sel([['XY', 'XY (waagerecht)'], ['XZ', 'XZ'], ['YZ', 'YZ']], f.plane || 'XY', v => ed(x => (x.plane = v)))),
    row('Versatz', num(f.offset || 0, v => ed(x => (x.offset = v)), { unit: 'mm' })),
    h('p', { class: 'hint' }, 'Teilt den Körper an der Ebene in zwei Körper.'),
  );
}

function propsFreeform(b, f, ed) {
  const N = (label, key, opt = {}) => row(label, num(f[key], v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  b.append(sec('LAGE & GRÖSSE'), N('Ecke X', 'x'), N('Ecke Y', 'y'), N('Länge X', 'w', { min: 1 }), N('Breite Y', 'd', { min: 1 }), N('Grundfläche Z', 'base'),
    row('Glatt (Spline)', chk(f.smooth !== false, v => ed(x => (x.smooth = v)))));
  const rows = f.heights || [];
  b.append(sec(`KONTROLLHÖHEN (${rows[0]?.length || 0} × ${rows.length})`),
    h('p', { class: 'hint' }, 'Zeilen laufen in Y-Richtung, Spalten in X-Richtung. Höhe = Z der Oberfläche am Kontrollpunkt.'));
  const grid = h('div', { class: 'ff-grid', style: `grid-template-columns: repeat(${rows[0]?.length || 1}, 1fr)` });
  rows.slice().reverse().forEach((r, jr) => {
    const j = rows.length - 1 - jr;
    r.forEach((v, i) => {
      const inp = h('input', { type: 'text', value: v, title: `Punkt X${i + 1} / Y${j + 1}` });
      inp.onchange = () => { const nv = parseFloat(inp.value.replace(',', '.')); if (Number.isFinite(nv)) ed(x => (x.heights[j][i] = nv)); else inp.value = v; };
      grid.append(inp);
    });
  });
  const resize = (nx, ny) => ed(x => {
    const old = x.heights, avg = old.flat().reduce((a, c) => a + +c, 0) / old.flat().length;
    x.heights = Array.from({ length: ny }, (_, j) => Array.from({ length: nx }, (_, i) => old[j]?.[i] ?? +avg.toFixed(2)));
  });
  b.append(grid, h('div', { class: 'btns' },
    btn('+ Spalte', () => resize((rows[0]?.length || 2) + 1, rows.length)), btn('− Spalte', () => rows[0]?.length > 2 && resize(rows[0].length - 1, rows.length)),
    btn('+ Zeile', () => resize(rows[0]?.length || 2, rows.length + 1)), btn('− Zeile', () => rows.length > 2 && resize(rows[0].length, rows.length - 1))),
    opSelect(f, ed));
}

function propsSheet(b, f, ed) {
  const N = (label, key, opt = {}) => row(label, num(f[key], v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  b.append(
    row('Skizze', sel(sketchOptions(), f.sketch, v => ed(x => { x.sketch = v; x.flanges = []; }))),
    N('Blechdicke', 'thickness', { min: 0.1 }), N('Biegeradius innen', 'radius', { min: 0 }), N('K-Faktor', 'kfactor', { unit: null, min: 0, max: 1 }),
    sec('ECKEN'),
    row('Ecke', sel([['open', 'Offen (Laschen gekürzt)'], ['closed', 'Geschlossen (Gehrung)']], f.corner || 'open', v => ed(x => (x.corner = v)))),
    ...(f.corner === 'closed' ? [
      row('Spalt', num(f.cornerGap ?? 0.2, v => ed(x => (x.cornerGap = Math.max(0, v))), { unit: 'mm', min: 0 })),
      row('Eckfreistellung', sel([['round', 'Rund'], ['square', 'Quadratisch'], ['none', 'Keine']], f.cornerRelief || 'round', v => ed(x => (x.cornerRelief = v)))),
      h('p', { class: 'hint' }, 'Geschlossen: Laschen an zwei Nachbarkanten laufen bis zur Winkelhalbierenden der Ecke und lassen dort den Spalt frei. Die Eckfreistellung sitzt, wo sich die Biegezonen kreuzen – in der Abwicklung und im gebogenen Teil.'),
    ] : []),
    sec('LASCHEN'),
  );
  let base = null;
  try { base = sheetBase(resolved().features.find(x => x.id === f.sketch)); } catch (err) { b.append(h('p', { class: 'err' }, err.message)); }
  if (base) {
    const edges = polyEdges(base.poly);
    edges.forEach((e, k) => {
      const fl = (f.flanges || []).find(q => q.edge === k) || { edge: k, on: false, h: 15, angle: 90 };
      const setFl = fn => ed(x => { x.flanges ||= []; let q = x.flanges.find(z => z.edge === k); if (!q) x.flanges.push(q = { edge: k, on: false, h: 15, angle: 90 }); fn(q); });
      const h1 = h('input', { type: 'text', value: fl.h, title: 'Laschenlänge (gerader Teil) mm', onchange: ev => setFl(q => (q.h = parseFloat(ev.target.value.replace(',', '.')) || q.h)) });
      const a1 = h('input', { type: 'text', value: fl.angle, title: 'Biegewinkel °', onchange: ev => setFl(q => (q.angle = parseFloat(ev.target.value.replace(',', '.')) || q.angle)) });
      b.append(h('div', { class: 'flange-row' }, chk(fl.on, v => setFl(q => (q.on = v))), h('span', null, `Kante ${k + 1} (${f2(e.L)} mm)`), h1, h('small', null, 'mm'), a1, h('small', null, '°')));
      if (!fl.on) return;
      // flange on flange: further bends on the free edge of this flange (+ = same way round, − = the other way)
      const numIn = (val, title, fn) => h('input', { type: 'text', value: val, title, onchange: ev => { const v = parseFloat(ev.target.value.replace(',', '.')); if (Number.isFinite(v) && v !== 0) setFl(q => fn(q, v)); } });
      (fl.next || []).forEach((nx, j) => b.append(h('div', { class: 'flange-row flange-sub' },
        h('span', null, `↳ Lasche ${j + 2}`),
        numIn(nx.h, 'Laschenlänge (gerader Teil) mm', (q, v) => (q.next[j].h = Math.max(0, v))), h('small', null, 'mm'),
        numIn(nx.angle, 'Biegewinkel ° (+ gleiche Richtung wie die erste Biegung, − Gegenrichtung)', (q, v) => (q.next[j].angle = Math.max(-180, Math.min(180, v)))), h('small', null, '°'),
        btn('✕', () => setFl(q => q.next.splice(j, 1))))));
      b.append(h('div', { class: 'flange-row flange-sub' }, btn('+ Lasche an Lasche', () => setFl(q => { q.next ||= []; q.next.push({ h: 10, angle: 90 }); }))));
    });
    b.append(h('p', { class: 'hint' }, 'Lasche an Lasche: Winkel + biegt in dieselbe Richtung weiter (U-Profil, Falz mit 180°), − in die Gegenrichtung (Z-Stufe, Hutprofil).'));
    const fp = flatPattern(base.poly, f);
    b.append(sec('ABWICKLUNG'),
      h('div', { class: 'stats' }, h('span', null, 'Zuschnitt'), h('b', null, `${f2(fp.size[0])} × ${f2(fp.size[1])} mm`),
        h('span', null, 'Biegezugabe 90°'), h('b', null, `${f2(bendAllowance(90, +f.radius, +f.thickness, +f.kfactor))} mm`)),
      h('div', { class: 'btns' },
        btn(state.flatView === f.id ? 'Gefalteten Zustand zeigen' : 'Abwicklung anzeigen', () => toggleFlatView(f), state.flatView === f.id ? 'on' : 'primary')),
      fp.table.length ? h('table', { class: 'mtable bend-table' },
        h('tr', null, ...['Biegung', 'Kante', 'Winkel', 'Radius', 'Zugabe', 'Länge'].map(x => h('th', null, x))),
        ...fp.table.map((b, i) => h('tr', null, h('td', null, `B${i + 1}`), h('td', null, b.level ? `${b.edge + 1}.${b.level + 1}` : String(b.edge + 1)),
          h('td', null, b.level ? `${f2(Math.abs(b.angle))}° ${b.angle > 0 ? 'gleichsinnig' : 'gegensinnig'}` : `${f2(Math.abs(b.angle))}° ${b.angle > 0 ? 'hoch' : 'runter'}`),
          h('td', null, `R${f2(b.radius)}`), h('td', null, f2(b.allowance)), h('td', null, f2(b.length))))) : null,
      h('div', { class: 'btns' },
        btn('Als Skizze', () => flatToSketch(f, fp, base.z0)),
        btn('Als DXF', () => download(`${safeName()}_Abwicklung.dxf`, writeDXF([...fp.outline.map((pts, i) => ({ id: 'o' + i, type: 'poly', closed: true, pts })), ...fp.bends.map((pts, i) => ({ id: 'b' + i, type: 'poly', closed: false, pts }))]), 'application/dxf'))),
      h('p', { class: 'hint' }, 'Gestrichelt im DXF/der Skizze: Biegelinien (Anfang und Ende jeder Biegezone).'));
  }
  b.append(opSelect(f, ed));
}

function toggleFlatView(f) {
  state.flatView = state.flatView === f.id ? null : f.id;
  showBanner(state.flatView ? [`Abwicklung von „${f.name}“ – Biegelinien orange (B1, B2 …)`, h('button', { onclick: () => toggleFlatView(f) }, 'Gefaltet zeigen')] : null);
  renderAll();
  fitView();
}
// flat pattern in the viewport: the developed plate (thickness t) and the bend lines on top
function drawFlatPattern() {
  const f = state.flatView && feature(state.flatView);
  if (!f || f.type !== 'sheet' || state.workspace !== 'design') { if (state.flatView && !f) state.flatView = null; return false; }
  let base, fp;
  try { base = sheetBase(resolved().features.find(x => x.id === f.sketch)); fp = flatPattern(base.poly, f); } catch { return false; }
  const t = +f.thickness || 1, z0 = base.z0;
  // Clipper gives outer loops counter-clockwise and holes clockwise
  const outers = fp.outline.filter(p => !THREE.ShapeUtils.isClockWise(p.map(([x, y]) => new THREE.Vector2(x, y))));
  const holes = fp.outline.filter(p => THREE.ShapeUtils.isClockWise(p.map(([x, y]) => new THREE.Vector2(x, y))));
  for (const o of outers) {
    const sh = new THREE.Shape(o.map(([x, y]) => new THREE.Vector2(x, y)));
    for (const hp of holes) sh.holes.push(new THREE.Path(hp.map(([x, y]) => new THREE.Vector2(x, y))));
    const g = new THREE.ExtrudeGeometry(sh, { depth: t, bevelEnabled: false });
    g.translate(0, 0, z0);
    const mesh = new THREE.Mesh(g, bodyMaterial(f.id));
    vp.model.add(mesh, new THREE.LineSegments(new THREE.EdgesGeometry(g, 20), matEdge));
  }
  // bend lines: centre dashed (DIN: bend line), zone limits thin
  const zTop = z0 + t + 0.02;
  const dash = new THREE.LineDashedMaterial({ color: 0xe8590c, dashSize: 3, gapSize: 1.5, depthTest: false, transparent: true });
  const thin = new THREE.LineBasicMaterial({ color: 0xe8590c, transparent: true, opacity: 0.55, depthTest: false });
  fp.table.forEach((b, i) => {
    const c = new THREE.Line(new THREE.BufferGeometry().setFromPoints(b.centre.map(([x, y]) => new THREE.Vector3(x, y, zTop))), dash);
    c.computeLineDistances();
    c.renderOrder = 22;
    vp.paths.add(c);
    const el = h('div', { class: 'bend-tag' }, `B${i + 1}`);
    const lab = new CSS2DObject(el);
    lab.position.set((b.centre[0][0] + b.centre[1][0]) / 2, (b.centre[0][1] + b.centre[1][1]) / 2, zTop);
    vp.paths.add(lab);
  });
  for (const ln of fp.bends) { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(ln.map(([x, y]) => new THREE.Vector3(x, y, zTop))), thin); l.renderOrder = 21; vp.paths.add(l); }
  return true;
}

function flatToSketch(f, fp, z0) {
  const id = uid('sk');
  insertFeature({
    id, type: 'sketch', name: nextName(state.project.features, 'Abwicklung'), plane: { o: [0, 0, z0 - 5], x: [1, 0, 0], n: [0, 0, 1] },
    entities: [
      ...fp.outline.map(pts => ({ id: uid('e'), type: 'poly', closed: true, pts: pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) })),
      ...fp.bends.map(pts => ({ id: uid('e'), type: 'poly', closed: false, pts: pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]), bend: true })),
    ],
  });
  status('Abwicklung als Skizze angelegt (5 mm unter dem Blech).');
}

function targetOptions(f) {
  const idx = state.project.features.indexOf(f);
  return state.project.features.slice(0, idx).filter(x => SOLID_SOURCES.includes(x.type)).map(x => [x.id, x.name]);
}

function propsPattern(b, f, ed) {
  const N = (label, key, opt = {}) => row(label, num(f[key], v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  const axes = [['x', 'X'], ['y', 'Y'], ['z', 'Z']];
  b.append(
    row('Art', sel([['rect', 'Rechteckig'], ['circ', 'Kreisförmig'], ['path', 'Entlang Pfad']], f.kind, v => ed(x => {
      x.kind = v;
      if (v === 'path' && !x.pathSketch) { const ps = [...state.project.features].reverse().find(s => s.type === 'sketch' && s.entities.some(e => e.type === 'poly')); if (ps) { x.pathSketch = ps.id; x.pathEntity = ps.entities.find(e => e.type === 'poly').id; } x.n ||= 4; x.distType ||= 'extent'; x.orient ||= 'identical'; }
    }))),
    ...sourceRows(f, ed),
  );
  if (f.kind === 'path') {
    const ps = resolved().features.find(x => x.id === f.pathSketch);
    const paths = ps ? ps.entities.filter(e => e.type === 'poly') : [];
    b.append(row('Pfad-Skizze', sel([['', '– wählen –'], ...sketchOptions()], f.pathSketch || '', v => ed(x => { x.pathSketch = v; const s = state.project.features.find(q => q.id === v); x.pathEntity = s?.entities.find(e => e.type === 'poly')?.id || ''; }))),
      row('Pfad', sel([['', '– wählen –'], ...paths.map(e => [e.id, describeEntity(e)])], f.pathEntity || '', v => ed(x => (x.pathEntity = v)))),
      N('Anzahl', 'n', { unit: null, min: 1, int: true }),
      row('Abstandsart', sel([['extent', 'Ausdehnung (auf Strecke verteilt)'], ['spacing', 'Abstand (zwischen den Kopien)']], f.distType || 'extent', v => ed(x => (x.distType = v)))),
      N(f.distType === 'spacing' ? 'Abstand' : 'Strecke', 'dist', { min: 0 }),
      row('Ausrichtung', sel([['identical', 'Identisch (nur verschieben)'], ['path', 'Am Pfad ausrichten (mitdrehen)']], f.orient || 'identical', v => ed(x => (x.orient = v)))),
      row('Richtung umkehren', chk(!!f.flip, v => ed(x => (x.flip = v)))));
    b.append(h('p', { class: 'hint' }, 'Strecke 0 = ganzer Pfad. Die Kopien wandern um die Pfadlänge vom Pfadanfang aus – lege den Pfad am besten am Original beginnen.'));
    return;
  }
  if (f.kind === 'circ') {
    const own = !['x', 'y', 'z'].includes(f.axis || 'z');
    b.append(row('Achse', sel([...axes, ...axisRefOptions(f.id).filter(([k]) => !BASE_AXES[k])], f.axis || 'z', v => ed(x => (x.axis = v)))),
      ...(own ? [] : [N('Zentrum X', 'cx'), N('Zentrum Y', 'cy'), N('Zentrum Z', 'cz')]),
      N('Anzahl', 'n', { unit: null, min: 1, int: true }), N('Winkel', 'angle', { unit: '°' }));
  } else {
    b.append(row('Richtung 1', sel(axes, f.dir1 || 'x', v => ed(x => (x.dir1 = v)))), N('Anzahl 1', 'n1', { unit: null, min: 1, int: true }), N('Abstand 1', 's1'),
      row('Richtung 2', sel(axes, f.dir2 || 'y', v => ed(x => (x.dir2 = v)))), N('Anzahl 2', 'n2', { unit: null, min: 1, int: true }), N('Abstand 2', 's2'));
  }
  b.append(h('p', { class: 'hint' }, 'Vervielfältigt ein Extrusions-, Rotations-, Bohrungs- oder Grundkörper-Feature mit dessen Operation.'));
}

// pattern/mirror either a feature (re-applied with its operation) or a whole body
function sourceRows(f, ed) {
  const body = f.source === 'body';
  return [
    row('Quelle', sel([['feature', 'Feature'], ['body', 'Körper']], f.source || 'feature', v => ed(x => { x.source = v; if (v === 'body' && !x.body) x.body = getFullBodies()[0]?.id; }))),
    body ? row('Körper', sel(bodyOptions(), f.body, v => ed(x => (x.body = v)))) : row('Feature', sel([['', '– wählen –'], ...targetOptions(f)], f.target || '', v => ed(x => (x.target = v)))),
    body ? row('Mit Körper verbinden', chk(f.joinBodies, v => ed(x => (x.joinBodies = v)))) : null,
  ];
}

function propsMirror(b, f, ed) {
  b.append(
    ...sourceRows(f, ed),
    row('Spiegelebene', sel([['YZ', 'YZ (X spiegeln)'], ['XZ', 'XZ (Y spiegeln)'], ['XY', 'XY (Z spiegeln)']], f.plane || 'YZ', v => ed(x => (x.plane = v)))),
    row('Ebenenversatz', num(f.offset || 0, v => ed(x => (x.offset = v)), { unit: 'mm' })),
  );
}

function bodyOptions() { return getFullBodies().map(b => [b.id, bodyName(b)]); }
function getFullBodies() {
  // body list of the full model (ignores pick/rollback) for selection fields
  return model.bodies.length ? model.bodies : [];
}

function propsMove(b, f, ed) {
  const N = (label, key, unit = 'mm') => row(label, num(f[key] || 0, v => ed(x => (x[key] = v)), { unit }));
  b.append(row('Körper', sel(bodyOptions(), f.body, v => ed(x => (x.body = v)))), N('ΔX', 'dx'), N('ΔY', 'dy'), N('ΔZ', 'dz'), N('Drehung um Z', 'rz', '°'), N('Drehpunkt X', 'cx'), N('Drehpunkt Y', 'cy'),
    row('Als Kopie', chk(f.copy, v => ed(x => (x.copy = v)))));
}

function propsCombine(b, f, ed) {
  b.append(
    row('Zielkörper', sel(bodyOptions(), f.body, v => ed(x => (x.body = v)))),
    row('Werkzeugkörper', sel(bodyOptions(), f.tool, v => ed(x => (x.tool = v)))),
    row('Operation', sel([['join', 'Verbinden'], ['cut', 'Ausschneiden'], ['intersect', 'Schnittmenge']], f.op, v => ed(x => (x.op = v)))),
    row('Werkzeug behalten', chk(f.keep, v => ed(x => (x.keep = v)))),
  );
}

// ---------- setup dialog ("Setup" command dialog) ----------
const SETUP_PICKS = ['wcsZ', 'wcsX', 'wcsY', 'origX', 'origY', 'origZ', 'origXY', 'setupBodies', 'fixtures'];
const PICK_ICON = '<svg viewBox="0 0 16 16" width="14" height="14"><path d="M3 1.5v11l3-3 2 4.5 2-1-2-4.3h4.2z" fill="currentColor"/></svg>';
const fsec = t => h('div', { class: 'sec fsec' }, t);

function toggleSetupPick(mode, id) {
  const on = !(state.pick?.mode === mode && state.pick.id === id);
  state.pick = on ? { mode, id } : null;
  const msg = { wcsZ: 'Z-Achse: ebene Fläche (Normale), Bohrung/Zylinder (Achse) oder gerade Kante anklicken.', wcsX: 'X-Achse: gerade Kante, ebene Fläche oder Zylinder anklicken.', wcsY: 'Y-Achse: gerade Kante, ebene Fläche oder Zylinder anklicken.',
    origX: 'X-Bezug: Kante, Ecke, Fläche oder Bohrung anklicken – deren X-Lage wird Nullpunkt X.', origY: 'Y-Bezug: Kante, Ecke, Fläche oder Bohrung anklicken – deren Y-Lage wird Nullpunkt Y.',
    origZ: 'Z-Bezug: Fläche, Kante oder Ecke anklicken – deren Höhe wird Nullpunkt Z.', origXY: 'Bohrung (oder Ecke) anklicken – deren Mitte wird Nullpunkt X und Y.',
    setupBodies: 'Körper anklicken, die bearbeitet werden (erneut klicken entfernt).', fixtures: 'Spannmittel anklicken (Schraubstock, Spannpratzen …) – sie werden nicht bearbeitet.' }[mode];
  showBanner(on ? [msg, h('button', { onclick: () => toggleSetupPick(mode, id) }, 'Fertig')] : null);
  renderAll();
}

// edge objects for picking: the drawn ones, or hidden helpers in the shaded style
let edgePickCache = { key: null, objs: [] };
function edgePickObjects() {
  const drawn = vp.model.children.filter(o => o.userData.edges);
  if (drawn.length) return drawn;
  const m = getModel();
  if (edgePickCache.key !== m.key) edgePickCache = { key: m.key, objs: m.bodies.map((b, bi) => Object.assign(new THREE.LineSegments(b.edges), { userData: { body: bi, edges: true } })) };
  return edgePickCache.objs.filter(o => !state.hiddenBodies.has(m.bodies[o.userData.body].id));
}

// reference point for the origin: hole centre, corner, point on an edge or face
function originRefAt(e, meshes, m, st, mode) {
  const wpp = vp.worldPerPixel();
  const hit = vp.raycast(e, meshes)[0];
  const eh = vp.raycast(e, edgePickObjects(), 6)[0];
  const hole = holeAtRay(e, setupUp(st), true);
  const holeRefFn = c => { const d = new THREE.Vector3(...c.dir), L = new THREE.Vector3(...c.loc); const a = L.clone().addScaledVector(d, c.t0), b = L.clone().addScaledVector(d, c.t1); const top = a.dot(setupUp(st)) > b.dot(setupUp(st)) ? a : b; return { p: top.toArray(), label: `Bohrung Ø${f2(2 * c.r)}` }; };
  const holeRef = holeRefFn;
  // "Bohrungsmitte": the hole always wins
  if (mode === 'origXY' && hole) return holeRef(hole);
  if (eh && (!hit || eh.distance <= hit.distance + wpp * 6)) {
    const pos = eh.object.geometry.attributes.position, i = eh.index - (eh.index % 2);
    const a = new THREE.Vector3().fromBufferAttribute(pos, i), b = new THREE.Vector3().fromBufferAttribute(pos, i + 1);
    const q = eh.pointOnLine || eh.point;
    // close to the end of the edge = corner
    const body = m.bodies[eh.object.userData.body], ei = body.segEdge[Math.floor(eh.index / 2)];
    // real end points of the edge: points used by one segment only (a circle has none)
    const P = body.edges.attributes.position.array, cnt = new Map();
    let nseg = 0;
    const kf = (x, y, z) => `${x.toFixed(4)},${y.toFixed(4)},${z.toFixed(4)}`;
    body.segEdge.forEach((x, k) => {
      if (x !== ei) return;
      nseg++;
      for (const o of [0, 3]) { const key = kf(P[k * 6 + o], P[k * 6 + o + 1], P[k * 6 + o + 2]); cnt.set(key, (cnt.get(key) || 0) + 1); }
    });
    const ends = [...cnt].filter(([, c]) => c === 1).map(([key]) => new THREE.Vector3(...key.split(',').map(Number)));
    const corner = ends.find(v => v.distanceTo(q) < wpp * 10);
    if (corner) return { p: corner.toArray(), label: 'Ecke' };
    // a closed round edge (hole rim): its centre
    const L = new THREE.Line3(a, b), cp = new THREE.Vector3();
    L.closestPointToPoint(q, true, cp);
    if (hole && nseg > 4) return holeRef(hole); // round edge of a hole: its centre
    return { p: cp.toArray(), label: 'Kante' };
  }
  // the mouse is inside a hole opening (also through holes): its centre
  if (hole) return holeRef(hole);
  if (hit) {
    const p = hit.point.toArray();
    const fa = faceAt(p);
    if (fa && !facePlanar(fa.body, fa.fid)) { const c = cylinderInfo(m.bodies, p); if (c) return holeRef(c); }
    return { p, label: 'Fläche' };
  }
  return null;
}

// picking for the setup: axes from faces/edges, bodies and fixtures
function setupPick(e, meshes, m) {
  const id = state.pick.id, mode = state.pick.mode;
  const st = state.project.cam.setups.find(x => x.id === id);
  if (!st) return;
  const ed = fn => commit(p => fn(p.cam.setups.find(x => x.id === id)));
  if (mode.startsWith('orig')) {
    const r = originRefAt(e, meshes, m, st, mode);
    if (!r) return status('Nichts getroffen – Kante, Ecke, Fläche oder Bohrung anklicken.');
    const p = r.p.map(v => +(+v).toFixed(5) + 0);
    state.pick = null;
    showBanner(null);
    ed(x => {
      x.originMode = 'pick';
      x.originRef ||= {};
      const keys = mode === 'origXY' ? ['x', 'y'] : [mode.slice(4).toLowerCase()];
      for (const k of keys) x.originRef[k] = { p, label: r.label };
    });
    return;
  }
  if (mode === 'wcsZ' || mode === 'wcsX' || mode === 'wcsY') {
    let dir = null;
    const hit = vp.raycast(e, meshes)[0];
    const lines = edgePickObjects();
    const eh = lines.length ? vp.raycast(e, lines, 5)[0] : null;
    if (eh && (!hit || eh.distance <= hit.distance + 0.5)) {
      // straight edge: its direction
      const pos = eh.object.geometry.attributes.position, i = eh.index - (eh.index % 2);
      dir = new THREE.Vector3().fromBufferAttribute(pos, i + 1).sub(new THREE.Vector3().fromBufferAttribute(pos, i));
      const big = ['x', 'y', 'z'].reduce((a, k) => (Math.abs(dir[k]) > Math.abs(dir[a]) ? k : a), 'x');
      if (dir[big] < 0) dir.negate();
    } else if (hit) {
      const p = hit.point.toArray();
      const fa = faceAt(p);
      const c = fa && !facePlanar(fa.body, fa.fid) ? cylinderInfo(m.bodies, p) : null;
      dir = c ? new THREE.Vector3(...c.dir) : hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    }
    if (!dir || dir.lengthSq() < 1e-10) return status('Keine Fläche oder Kante getroffen.');
    const v = dir.normalize().toArray().map(c => +c.toFixed(6) + 0);
    state.pick = null;
    showBanner(null);
    ed(x => { x.wcsMode = 'axes'; x[{ wcsZ: 'zAxis', wcsX: 'xAxis', wcsY: 'yAxis' }[mode]] = v; });
    return;
  }
  const hit = vp.raycast(e, meshes)[0];
  if (!hit) return;
  const bid = m.bodies[hit.object.userData.body].id;
  ed(x => {
    const key = mode === 'fixtures' ? 'fixtures' : 'bodies', other = mode === 'fixtures' ? 'bodies' : 'fixtures';
    const list = (x[key] ||= []);
    const k = list.indexOf(bid);
    if (k >= 0) list.splice(k, 1); else list.push(bid);
    if (x[other]) x[other] = x[other].filter(b => b !== bid);
  });
}
function facePlanar(body, fid) {
  const idx = body.geometry.index.array, pos = body.geometry.attributes.position;
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), n = new THREE.Vector3();
  let n0 = null;
  for (let t = 0; t < body.faceOf.length; t++) {
    if (body.faceOf[t] !== fid) continue;
    a.fromBufferAttribute(pos, idx[t * 3]); b.fromBufferAttribute(pos, idx[t * 3 + 1]); c.fromBufferAttribute(pos, idx[t * 3 + 2]);
    n.crossVectors(b.sub(a), c.sub(a));
    if (n.lengthSq() < 1e-14) continue;
    n.normalize();
    if (!n0) n0 = n.clone(); else if (Math.abs(n.dot(n0)) < 0.9999) return false;
  }
  return true;
}

// "Punkt auf Box": choose one of 27 points (corners, edge and face centres, centre)
function boxPointPicker(anchor, cur, onPick) {
  document.querySelector('.boxpick')?.remove();
  const pop = h('div', { class: 'boxpick' });
  const names = { z: ['Unten', 'Mitte', 'Oben'], y: ['vorne', 'Mitte', 'hinten'], x: ['links', 'Mitte', 'rechts'] };
  for (const pz of [1, 0.5, 0]) {
    const grid = h('div', { class: 'bp-grid' });
    for (const py of [1, 0.5, 0]) for (const px of [0, 0.5, 1]) {
      const on = cur && cur[0] === px && cur[1] === py && cur[2] === pz;
      grid.append(h('button', { class: 'bp-pt' + (on ? ' on' : '') + (px !== 0.5 && py !== 0.5 ? ' corner' : ''), title: `${names.z[pz * 2]}, ${names.y[py * 2]} ${names.x[px * 2]}`, onclick: () => { pop.remove(); onPick([px, py, pz]); } }));
    }
    pop.append(h('div', { class: 'bp-layer' }, h('span', null, names.z[pz * 2]), grid));
  }
  pop.append(h('div', { class: 'hint', style: 'margin-top:4px' }, 'Draufsicht je Ebene: oben = hinten (+Y), rechts = +X'));
  document.body.append(pop);
  const r = anchor.getBoundingClientRect();
  pop.style.left = Math.min(innerWidth - pop.offsetWidth - 8, r.left) + 'px';
  pop.style.top = Math.min(innerHeight - pop.offsetHeight - 8, r.bottom + 4) + 'px';
  setTimeout(() => addEventListener('pointerdown', function off(ev) { if (!pop.contains(ev.target)) { pop.remove(); removeEventListener('pointerdown', off, true); } }, true));
}

// selection button: arrow icon, "Auswählen" or the count, ✕ clears
function pickButton(mode, setup, count, label, clear) {
  const active = state.pick?.mode === mode && state.pick.id === setup.id;
  return h('div', { class: 'pickctl' },
    h('button', { class: 'pickbtn' + (active ? ' active' : '') + (count ? ' done' : ''), onclick: () => toggleSetupPick(mode, setup.id), html: PICK_ICON + `<span>${count ? label : 'Auswählen'}</span>` }),
    count && clear ? h('button', { class: 'pickclr', title: 'Auswahl entfernen', onclick: clear }, '✕') : null);
}

// icon + select like the usual drop-downs with symbols
const iconSelect = (icon, options, value, onChange) => h('div', { class: 'isel' }, h('span', { class: 'isel-ic', html: icon }), sel(options, value, onChange));

const SETUP_ICONS = {
  mill: '<svg viewBox="0 0 20 20"><rect x="8" y="1" width="4" height="9" rx="1" fill="#c9d1d9"/><path d="M8.5 10h3l-.5 4h-2z" fill="#9aa4ae"/><path d="M3 17h14" stroke="#2aa8e6" stroke-width="2"/><path d="M3 14v3M17 14v3" stroke="#2aa8e6" stroke-width="1.5"/></svg>',
  turn: '<svg viewBox="0 0 20 20"><ellipse cx="6" cy="10" rx="3" ry="6" fill="none" stroke="#2aa8e6" stroke-width="1.5"/><path d="M6 4h10M6 16h10M16 4v12" stroke="#c9d1d9" stroke-width="1.5"/></svg>',
  wcs: '<svg viewBox="0 0 20 20"><path d="M4 16V3" stroke="#2aa8e6" stroke-width="1.8"/><path d="M4 16h12" stroke="#e5484d" stroke-width="1.8"/><path d="M4 16l7-5" stroke="#40c057" stroke-width="1.8"/><path d="M2.5 5 4 2.5 5.5 5" fill="none" stroke="#2aa8e6" stroke-width="1.5"/></svg>',
  origin: '<svg viewBox="0 0 20 20"><path d="M3 7l6-3 6 3v7l-6 3-6-3z" fill="#c9d1d9" opacity=".85"/><path d="M3 7l6 3 6-3M9 10v7" stroke="#8a96a3" fill="none"/><circle cx="15" cy="14" r="2.6" fill="#2aa8e6"/></svg>',
};

function propsSetup(b) {
  const id = activeSetupId();
  const s = state.project.cam.setups.find(x => x.id === id);
  setTitle('SETUP : ' + s.name.toUpperCase());
  const g = getCam().setups.get(id);
  const ed = fn => commit(p => fn(p.cam.setups.find(x => x.id === id)));
  const m = getModel();
  const turn = s.kind === 'turn';
  const mach = findMachine(state.project, s.machine);

  // ----- tab "Setup"
  const machBtn = h('button', { class: 'pickbtn wide', onclick: ev => ctxMenu(ev.clientX, ev.clientY, [
    { label: 'Keine Maschine', checked: !s.machine, onclick: () => ed(x => (x.machine = null)) },
    { sep: true },
    ...allMachines(state.project).map(mc => ({ label: mc.name, checked: s.machine === mc.id, onclick: () => commit(pp => { pp.cam.setups.find(x => x.id === id).machine = mc.id; if (mc.post) pp.post.flavor = mc.post; }) })),
    { sep: true },
    { label: 'Maschinenbibliothek …', onclick: () => openMachineLib(s.machine) },
  ], 'Maschine') }, mach ? mach.name : 'Auswählen…');
  b.append(fsec('Maschine'), row('Maschine', machBtn));
  if (mach) {
    const used = [...new Set(state.project.cam.ops.filter(o => o.setup === id).map(o => o.tool))].map(tid => state.project.cam.tools.find(t => t.id === tid)).filter(Boolean);
    const probs = machineChecks(mach, g?.stock, s, used);
    b.append(h('div', { class: 'stats' },
      h('span', null, 'Verfahrwege'), h('b', null, `${mach.travel.x} × ${mach.travel.y} × ${mach.travel.z} mm`),
      h('span', null, 'Spindel'), h('b', null, `${mach.minRpm || 0}–${mach.maxRpm} U/min`),
      h('span', null, 'Postprozessor'), h('b', null, findPost(state.project, mach.post).name)));
    for (const pr of probs) b.append(h('p', { class: 'err' }, '⚠ ' + pr));
  }

  b.append(fsec('Setup'),
    row('Operationstyp', iconSelect(SETUP_ICONS[turn ? 'turn' : 'mill'], [['mill', 'Fräsen'], ['turn', 'Drehen']], s.kind || 'mill', v => ed(x => { x.kind = v; if (v === 'turn' && !x.stockDia) x.stockDia = 0; }))));

  if (!turn) {
    const pair = s.axesPair || 'zx';
    const mode = s.wcsMode === 'axes' ? 'axes-' + pair : s.orientation || 'top';
    b.append(fsec('Werkstück Koordinatensystem (WKS)'),
      row('Ausrichtung', iconSelect(SETUP_ICONS.wcs, [
        ['top', 'Modellausrichtung'], ['axes-zx', 'Z-Achse/-Ebene und X-Achse auswählen'], ['axes-zy', 'Z-Achse/-Ebene und Y-Achse auswählen'], ['axes-xy', 'X- und Y-Achse auswählen'],
        ['bottom', 'Unten (gewendet)'], ['front', 'Vorderseite nach oben'], ['back', 'Rückseite nach oben'], ['left', 'Linke Seite nach oben'], ['right', 'Rechte Seite nach oben'],
      ], mode, v => ed(x => { if (v.startsWith('axes-')) { x.wcsMode = 'axes'; x.axesPair = v.slice(5); } else { x.wcsMode = 'preset'; x.orientation = v; } }))));
    if (s.wcsMode === 'axes') {
      const axisRows = k => {
        const key = k.toLowerCase() + 'Axis', flip = 'flip' + k;
        return [row(`${k}-Achse`, pickButton('wcs' + k, s, Array.isArray(s[key]) ? 1 : 0, '1 ausgewählt', () => ed(x => { delete x[key]; }))),
          row(`${k}-Achse umkehren`, chk(s[flip], v => ed(x => (x[flip] = v))))];
      };
      b.append(...axisRows(pair === 'xy' ? 'X' : 'Z'), ...axisRows(pair === 'zx' ? 'X' : 'Y'),
        h('p', { class: 'hint' }, 'Achse: ebene Fläche (Normale), Bohrung (Achse) oder gerade Kante anklicken. Nicht gewählt = Modellrichtung.'));
    } else {
      b.append(row('Z-Achse umkehren', chk(s.flipZ, v => ed(x => (x.flipZ = v)))), row('X-Achse umkehren', chk(s.flipX, v => ed(x => (x.flipX = v)))));
    }
    // origin: older presets map onto "point on stock box"
    const om = s.originMode || (s.origin === 'model' ? 'modelOrigin' : 'stock');
    const opt = s.originPt || ({ 'top-center': [0.5, 0.5, 1], 'bottom-corner': [0, 0, 0] }[s.origin] || [0, 0, 1]);
    b.append(row('Ursprung', iconSelect(SETUP_ICONS.origin, [['stock', 'Punkt auf Rohteilbox'], ['model', 'Punkt auf Modellrahmen'], ['pick', 'Ausgewählte Bezüge (je Achse)'], ['modelOrigin', 'Modellursprung']], om,
      v => ed(x => { x.originMode = v; x.originPt ||= opt; }))));
    if (om === 'pick') {
      const ref = s.originRef || {};
      const refRow = k => row(`${k.toUpperCase()}-Bezug`, pickButton('orig' + k.toUpperCase(), s, ref[k] ? 1 : 0, ref[k]?.label || '', () => ed(x => { if (x.originRef) delete x.originRef[k]; })));
      b.append(refRow('x'), refRow('y'), refRow('z'),
        row('Bohrungsmitte (X+Y)', pickButton('origXY', s, 0, '', null)),
        h('p', { class: 'hint' }, 'Jede Achse einzeln: Kante, Ecke, Fläche oder Bohrung anklicken. Nicht gesetzte Achsen kommen vom Rohteilpunkt.'));
    }
    if (om !== 'modelOrigin') {
      const ptBtn = h('button', { class: 'pickbtn', html: PICK_ICON + `<span>${originLabel({ originMode: om === 'pick' ? 'stock' : om, originPt: opt }).replace(/^(Rohteil|Modellrahmen) /, '')}</span>` });
      ptBtn.onclick = () => boxPointPicker(ptBtn, opt, v => ed(x => { x.originMode = om; x.originPt = v; }));
      b.append(row(om === 'model' ? 'Modellpunkt' : om === 'pick' ? 'Übrige Achsen (Rohteil)' : 'Rohteilpunkt', ptBtn));
    }
    b.append(row('Zugänglichkeitsanalyse', chk(s.access, v => ed(x => (x.access = v)))));
    if (s.access) b.append(h('p', { class: 'hint' }, 'Grün = vom Werkzeug erreichbar, gelb = senkrechte Wand, rot = Hinterschnitt (nicht erreichbar).'));
  }

  const nb = (s.bodies || []).filter(bid => m.bodies.some(x => x.id === bid)).length;
  const nf = (s.fixtures || []).filter(bid => m.bodies.some(x => x.id === bid)).length;
  b.append(fsec('Modell'),
    row('Modell', pickButton('setupBodies', s, nb, `${nb} Körper`, () => ed(x => (x.bodies = [])))),
    nb ? null : h('p', { class: 'hint' }, 'Keine Auswahl = alle Körper (außer Spannmitteln) werden bearbeitet.'));
  b.append(fsec('Spannmittel'),
    row('Spannmittel', pickButton('fixtures', s, nf, `${nf} Körper`, () => ed(x => (x.fixtures = [])))),
    row('Radialer Sicherheitsabstand', num(s.fixRadial ?? 5, v => ed(x => (x.fixRadial = v)), { unit: 'mm', min: 0 })),
    row('Axialer Sicherheitsabstand', num(s.fixAxial ?? 5, v => ed(x => (x.fixAxial = v)), { unit: 'mm', min: 0 })));
  {
    const S = setupSummary(s);
    b.append(fsec('Übersicht'), h('div', { class: 'stats' },
      h('span', null, 'Bearbeitungszeit'), h('b', null, fmtDur(S.time)),
      h('span', null, 'Operationen'), h('b', null, String(S.rows.length)),
      h('span', null, 'Werkzeuge / Wechsel'), h('b', null, `${S.tools} / ${S.changes}`),
      h('span', null, 'Schnittweg'), h('b', null, fmtLen(S.cutL)),
      h('span', null, 'Eilgangweg'), h('b', null, fmtLen(S.rapL))),
      h('div', { class: 'btns' }, btn('Bearbeitungszeit …', () => openMachiningTime(id))));
  }
  b.append(fsec('Höhen'),
    row('Sicherheitshöhe', num(s.safeZ, v => ed(x => (x.safeZ = v)), { unit: 'mm', min: 0 })),
    row('Rückzugshöhe', num(s.retract, v => ed(x => (x.retract = v)), { unit: 'mm', min: 0 })),
    h('p', { class: 'hint' }, 'Beide Höhen gelten über der Rohteil-Oberkante.'));

  // ----- tab "Rohteil"
  const st = g?.stock;
  b.append(fsec('Rohteil'));
  if (turn) {
    b.append(row('Modus', sel([['cyl', 'Zylinder mit fester Größe']], 'cyl', () => {})),
      row('Durchmesser', num(s.stockDia || null, v => ed(x => (x.stockDia = v)), { unit: 'mm', allowEmpty: true, ph: 'automatisch' })),
      h('p', { class: 'hint' }, 'Drehen: Das Teil muss rotationssymmetrisch um die Z-Achse liegen. Z0 = Planfläche oben, X = Durchmesser.'));
  } else {
    const mode = s.stockMode || 'margin';
    const M2 = (label, key, def, opt = {}) => row(label, num(s[key] ?? def, v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
    const cylMode = ['cyl', 'cylFixed', 'tube', 'tubeFixed'].includes(mode);
    b.append(row('Modus', sel(Object.entries(STOCK_MODES), mode, v => ed(x => {
      x.stockMode = v;
      // fixed sizes start from the current stock
      if (v === 'fixed' && !x.stockW && st) { x.stockW = f2(st.maxX - st.minX); x.stockD = f2(st.maxY - st.minY); x.stockH = f2(st.top - st.bottom); }
      if ((v === 'cylFixed' || v === 'tubeFixed') && !x.stockDia && st) { x.stockDia = f2(st.shape?.r ? 2 * st.shape.r : Math.max(st.maxX - st.minX, st.maxY - st.minY)); x.stockLen = f2(st.shape ? st.shape.hi - st.shape.lo : st.top - st.bottom); }
      if (v === 'tubeFixed' && x.stockInner == null) x.stockInner = 0;
    }))));
    if (cylMode) {
      b.append(row('Achse auswählen', chk(s.stockAxisPick, v => ed(x => (x.stockAxisPick = v)))));
      if (s.stockAxisPick) b.append(row('Achse', sel([['z', 'Z-Achse (Setup)'], ['x', 'X-Achse (Setup)'], ['y', 'Y-Achse (Setup)']], s.stockAxis || 'z', v => ed(x => (x.stockAxis = v)))));
    }
    switch (mode) {
      case 'fixed':
        b.append(M2('Breite (X)', 'stockW', null, { min: 1 }), M2('Tiefe (Y)', 'stockD', null, { min: 1 }), M2('Höhe (Z)', 'stockH', null, { min: 1 }), M2('Rohteilversatz oben', 'marginTop', 1, { min: 0 }),
          h('p', { class: 'hint' }, 'Mittig um das Teil; die Oberkante liegt den Versatz über dem Teil.'));
        break;
      case 'margin':
        b.append(M2('Seitlicher Rohteilversatz', 'marginSide', 2, { min: 0 }), M2('Rohteilversatz oben', 'marginTop', 1, { min: 0 }), M2('Rohteilversatz unten', 'marginBottom', 0, { min: 0 }), M2('Aufrunden auf nächste(n/s)', 'stockRound', 0, { min: 0 }));
        break;
      case 'cylFixed':
        b.append(M2('Durchmesser', 'stockDia', null, { min: 0.1 }), M2('Länge', 'stockLen', null, { min: 0.1 }), M2('Rohteilversatz Vorderseite', 'stockFront', null, { min: 0, allowEmpty: true, ph: 'mittig' }));
        break;
      case 'cyl':
        b.append(M2('Radialer Rohteilversatz', 'stockRadial', 1, { min: 0 }), M2('Rohteilversatz Vorderseite', 'stockFront', 1, { min: 0 }), M2('Rohteilversatz Rückseite', 'stockBack', 1, { min: 0 }), M2('Aufrunden auf nächste(n/s)', 'stockRound', 0, { min: 0 }));
        break;
      case 'tubeFixed':
        b.append(M2('Außendurchmesser', 'stockDia', null, { min: 0.1 }), M2('Innendurchmesser', 'stockInner', 0, { min: 0 }), M2('Länge', 'stockLen', null, { min: 0.1 }), M2('Rohteilversatz Vorderseite', 'stockFront', null, { min: 0, allowEmpty: true, ph: 'mittig' }));
        break;
      case 'tube':
        b.append(M2('Radialer Rohteilversatz', 'stockRadial', 1, { min: 0 }), M2('Innerer Rohteilversatz', 'stockInnerOff', 1, { min: 0 }), M2('Rohteilversatz Vorderseite', 'stockFront', 1, { min: 0 }), M2('Rohteilversatz Rückseite', 'stockBack', 1, { min: 0 }), M2('Aufrunden auf nächste(n/s)', 'stockRound', 0, { min: 0 }));
        break;
      case 'solid':
      case 'boundingSolid': {
        const bodies = getModel().bodies;
        b.append(row('Volumenkörper', sel([['', '– wählen –'], ...bodies.map(x => [x.id, x.name])], s.stockBody || '', v => ed(x => (x.stockBody = v || undefined)))));
        if (mode === 'boundingSolid') b.append(M2('Seitlicher Rohteilversatz', 'marginSide', 0, { min: 0 }), M2('Rohteilversatz oben', 'marginTop', 0, { min: 0 }), M2('Rohteilversatz unten', 'marginBottom', 0, { min: 0 }));
        b.append(h('p', { class: 'hint' }, mode === 'solid' ? 'Der gewählte Körper ist das Rohteil (z. B. ein Guss- oder Schmiederohling). Er wird selbst nicht bearbeitet.' : 'Das Rohteil ist der Quader um den gewählten Körper (plus Versatz).'));
        if (!s.stockBody) b.append(h('p', { class: 'warn' }, 'Noch kein Körper gewählt – bis dahin gilt die relative Quadergröße.'));
        break;
      }
      case 'prevSetup': {
        const i = state.project.cam.setups.findIndex(x => x.id === id), prev = i > 0 ? state.project.cam.setups[i - 1] : null;
        b.append(h('p', { class: prev ? 'hint' : 'warn' }, prev ? `Rohteil von „${prev.name}“ (Größe und Form in dieser Ausrichtung). Was dort schon abgetragen wurde, ist berücksichtigt – in Simulation, Kollisionsprüfung und bei den Werkzeugwegen (von oben gesehen, ohne Hinterschnitte).` : 'Dies ist das erste Setup – es gibt kein vorheriges Rohteil. Bis dahin gilt die relative Quadergröße.'));
        break;
      }
    }
    // material and the resulting size ("Rohteilmaterial", "Rohteilbemaßungen")
    const MATS = allMaterials(), matName = MATS[s.stockMaterial]?.name;
    b.append(fsec('Rohteilmaterial'),
      row('Rohteilmaterial', h('button', { class: 'btn', title: 'Material wählen', onclick: e => ctxMenu(e.clientX, e.clientY, [
        ...Object.entries(MATS).map(([k, mm]) => ({ label: (k === s.stockMaterial ? '✓ ' : '') + mm.name, onclick: () => ed(x => { x.stockMaterial = k; x.stockMaterialColor = '#' + mm.color.toString(16).padStart(6, '0'); }) })),
        { label: 'Kein Material', onclick: () => ed(x => { delete x.stockMaterial; delete x.stockMaterialColor; }) },
        { label: 'Rohteilmaterialbibliothek …', onclick: openMaterialLib }], 'Rohteilmaterial') }, matName || 'Auswählen …')));
    if (st) {
      const sh = st.shape;
      b.append(fsec('Rohteilbemaßungen'));
      const dens = MATS[s.stockMaterial]?.density;
      const vol = sh?.type === 'cyl' ? Math.PI * (sh.r ** 2 - sh.ri ** 2) * (sh.hi - sh.lo) : sh ? null : (st.maxX - st.minX) * (st.maxY - st.minY) * (st.top - st.bottom);
      const mass = dens && vol ? (vol / 1000) * dens : null;
      const massEl = mass ? [h('span', null, 'Rohteilgewicht'), h('b', null, mass >= 1000 ? `${(mass / 1000).toFixed(2)} kg` : `${mass.toFixed(0)} g`)] : [];
      if (sh?.type === 'cyl') b.append(h('div', { class: 'stats' }, ...massEl,
        h('span', null, 'Rohteildurchmesser'), h('b', null, `${f2(2 * sh.r)} mm`),
        sh.ri > 0 ? h('span', null, 'Innendurchmesser') : null, sh.ri > 0 ? h('b', null, `${f2(2 * sh.ri)} mm`) : null,
        h('span', null, 'Rohteillänge'), h('b', null, `${f2(sh.hi - sh.lo)} mm`)));
      else b.append(h('div', { class: 'stats' }, ...massEl,
        h('span', null, 'Rohteilbreite (X)'), h('b', null, `${f2(st.maxX - st.minX)} mm`),
        h('span', null, 'Rohteiltiefe (Y)'), h('b', null, `${f2(st.maxY - st.minY)} mm`),
        h('span', null, 'Rohteilhöhe (Z)'), h('b', null, `${f2(st.top - st.bottom)} mm`)));
    }
  }
  if (!st) b.append(h('p', { class: 'err' }, g?.error || 'Kein Modell'));

  // ----- tab "Postprozess"
  b.append(fsec('Programm'),
    row('Programmname/-nummer', h('div', { style: 'display:flex;gap:4px' },
      txt(s.programName || '', v => ed(x => (x.programName = v.trim()))),
      num(s.programNumber ?? 1000, v => ed(x => (x.programNumber = v)), { min: 1, int: true }))),
    row('Programmkommentar', txt(s.comment || '', v => ed(x => (x.comment = v)))),
    fsec('Maschinen-WKS'),
    row('WKS-Versatz', sel([1, 2, 3, 4, 5, 6].map(n => [String(n), `${n} (G${53 + n})`]), String(s.wcsOffset || 1), v => ed(x => (x.wcsOffset = +v)))),
    h('p', { class: 'hint' }, 'Name leer = aus Projekt- und Setup-Name. Nummer und WKS-Versatz werden als O-Nummer und G54 … G59 ausgegeben.'),
    h('div', { class: 'btns' },
      btn('+ Neues Setup', addSetup, 'primary'),
      state.project.cam.setups.length > 1 ? btn('Setup löschen', () => deleteSetup(id), 'danger') : null));
}

// Overview when nothing is selected in MANUFACTURE (the setup opens as a dialog)
function propsCamOverview(b) {
  setTitle('FERTIGUNG');
  const g = getCam();
  b.append(h('p', { class: 'hint' }, 'Setup oder Operation im Browser anklicken, um sie zu bearbeiten.'));
  for (const st of state.project.cam.setups) {
    const ops = state.project.cam.ops.filter(o => o.setup === st.id);
    const time = setupSummary(st).time;
    b.append(h('div', { class: 'ov-setup', onclick: () => select('setup', st.id) },
      h('span', { class: 'ov-ic', html: SETUP_ICONS[st.kind === 'turn' ? 'turn' : 'mill'] }),
      h('div', null, h('b', null, st.name), h('div', { class: 'hint' }, `${ops.length} Operation(en) · ${fmtDur(time)} · ${orientationLabel(st)}`)),
      h('button', { class: 'btn', onclick: ev => { ev.stopPropagation(); select('setup', st.id); } }, 'Bearbeiten')));
  }
  b.append(h('div', { class: 'btns' }, btn('+ Neues Setup', addSetup, 'primary'), btn('Simulieren', openSim), btn('NC-Programm', () => select('post'))));
}

function addSetup() {
  const id = uid('S');
  commit(p => {
    const n = p.cam.setups.length + 1;
    const prev = p.cam.setups[p.cam.setups.length - 1];
    p.cam.setups.push({ ...defaultSetup(n), ...prev, id, name: nextName(p.cam.setups, 'Setup'), orientation: prev.orientation === 'top' ? 'bottom' : 'top' });
  });
  select('setup', id);
}

// 3+2-Schruppen: common CAD/CAM tilts the tool for one operation; here it gets its own setup with that orientation
function add32Rough() {
  const cur = state.project.cam.setups.find(x => x.id === activeSetupId());
  if (!cur || cur.kind === 'turn') return status('3+2-Schruppen braucht ein Fräs-Setup.');
  const back = h('div', { class: 'modal-back' });
  const close = () => back.remove();
  let pick = Object.keys(ORIENTATIONS).find(k => k !== (cur.orientation || 'top')) || 'front';
  const s = sel(Object.entries(ORIENTATIONS).filter(([k]) => k !== (cur.orientation || 'top')), pick, v => (pick = v));
  const go = () => {
    close();
    const id = uid('S');
    commit(p => {
      const base = p.cam.setups.find(x => x.id === cur.id);
      p.cam.setups.push({ ...JSON.parse(JSON.stringify(base)), id, name: `${nextName(p.cam.setups, 'Setup')} (3+2)`, orientation: pick, wcsMode: 'preset', flipZ: false, flipX: false });
    });
    state.camSetup = id;
    state.sel = { kind: 'setup', id };
    addOp('adaptive3d');
    status(`3+2-Schruppen in neuem Setup – Werkzeugachse: ${ORIENTATIONS[pick]}. Der Postprozessor schwenkt mit PLANE SPATIAL / CYCLE800 / G68.2.`);
  };
  back.append(h('div', { class: 'modal', style: 'height:auto;width:min(420px,calc(100vw - 32px))' },
    h('div', { class: 'modal-head' }, '3+2-SCHRUPPEN', h('button', { onclick: close }, '✕')),
    h('div', { style: 'padding:14px 16px;display:grid;gap:10px' },
      row('Werkzeugachse', s),
      h('p', { class: 'hint' }, `Legt ein Setup mit gleicher Maschine, Rohteil und Nullpunkt wie „${cur.name}“ an, aber geschwenkter Werkzeugachse, und darin ein adaptives 3D-Schruppen.`)),
    h('div', { class: 'modal-foot' }, h('button', { onclick: close }, 'Abbrechen'), h('button', { class: 'primary', onclick: go }, 'OK'))));
  document.body.append(back);
}

function deleteSetup(id) {
  const ops = state.project.cam.ops.filter(o => o.setup === id);
  if (ops.length && !confirm(`Setup und ${ops.length} Operation(en) löschen?`)) return;
  commit(p => { p.cam.setups = p.cam.setups.filter(x => x.id !== id); p.cam.ops = p.cam.ops.filter(o => o.setup !== id); });
  state.camSetup = null;
  select('setup', state.project.cam.setups[0].id);
}

const TOOLS_FOR = {
  drill: t => ['drill', 'flat', 'tap', 'ream'].includes(t.type),
  chamfer: t => t.type === 'chamfer', vcarve: t => t.type === 'chamfer',
  project3d: t => t.type !== 'drill' && t.type !== 'thread' && t.type !== 'tap',
  thread: t => t.type === 'thread',
  trace: t => t.type !== 'drill' && t.type !== 'thread',
  tface: t => t.type === 'turn' && t.kind !== 'turnbore', trough: t => t.type === 'turn' && t.kind !== 'turnbore', tfinish: t => t.type === 'turn' && t.kind !== 'turnbore',
  tdrill: t => t.type === 'drill', tbore: t => t.kind === 'turnbore', tlive: t => t.type === 'drill', tslot: t => t.type === 'flat' || t.type === 'ball', tflat: t => t.type === 'flat', tpocket: t => t.type === 'flat', tcontour: t => ['flat', 'ball', 'chamfer'].includes(t.type), twrap: t => ['flat', 'ball', 'chamfer'].includes(t.type),
  tgroove: t => t.type === 'groove', tpart: t => t.type === 'groove', tthread: t => t.type === 'tthread',
  probe: t => t.type === 'probe',
  rotary: t => t.type === 'ball' || t.type === 'flat', rotaryRough: t => t.type === 'ball' || t.type === 'flat', rotaryWrap: t => t.type === 'ball' || t.type === 'flat',
  deburr3d: t => t.type === 'ball' || t.type === 'chamfer',
  default: t => ['flat', 'ball', 'torus', 'facemill'].includes(t.type),
};

// ---------- operation dialog (layout: Werkzeug · Werkzeugausrichtung · Geometrie · Höhen · Durchgänge · Verknüpfung) ----------
const OP_TABS = [
  ['tool', 'Werkzeug', tabSvg('<path d="M9 3h6v5l-1 2v11h-4V10L9 8z"/><path d="M10 13l4-2M10 16l4-2M10 19l4-2"/>')],
  ['orient', 'Werkzeugausrichtung', '<svg viewBox="0 0 24 24" class="colored"><path d="M5 19V6" stroke="#4dabf7" stroke-width="2"/><path d="M5 19h13" stroke="#ff6b6b" stroke-width="2"/><path d="M5 19l9-6" stroke="#51cf66" stroke-width="2"/><path d="M15 3h5v4" fill="none" stroke="#e9ecef" stroke-width="1.6"/><path d="M14 9l5-5" stroke="#e9ecef" stroke-width="1.6"/></svg>'],
  ['geo', 'Geometrie', '<svg viewBox="0 0 24 24" class="colored"><path d="M3 9l7-3 7 3-7 3z" fill="#9ad7ff"/><path d="M3 9v7l7 3v-7z" fill="#5fb7f0"/><path d="M17 9v7l-7 3v-7z" fill="#3a8fd0"/><path d="M10 6l7-3 7 3-7 3z" fill="#e9f4ff" opacity=".9"/></svg>'],
  ['heights', 'Höhen', '<svg viewBox="0 0 24 24" class="colored"><path d="M3 9l9-4 9 4-9 4z" fill="#ffd8a8"/><path d="M3 9v8l9 4v-8z" fill="#f2f2f2"/><path d="M21 9v8l-9 4v-8z" fill="#cfd4da"/></svg>'],
  ['passes', 'Durchgänge', '<svg viewBox="0 0 24 24" class="colored"><rect x="4" y="3" width="16" height="18" rx="1" fill="#e9ecef"/><path d="M8 3v11h8V3" fill="#495057"/><path d="M10 8h4M10 11h4" stroke="#4dabf7" stroke-width="1.6"/></svg>'],
  ['link', 'Verknüpfung', '<svg viewBox="0 0 24 24" class="colored"><rect x="3" y="14" width="18" height="6" fill="#e9ecef"/><path d="M5 14V8h14v6" fill="none" stroke="#51cf66" stroke-width="2"/><path d="M5 8h14" stroke="#ffd43b" stroke-width="2"/></svg>'],
];
const H_LABEL = { safe: 'Sicherheitshöhe', retract: 'Rückzugshöhe', feed: 'Vorschubhöhe', top: 'Obere Höhe', bottom: 'Endhöhe' };
const H_FROM_LABEL = { retract: 'Rückzugshöhe', stockTop: 'Rohteiloberkante', stockBottom: 'Rohteilunterkante', modelTop: 'Modelloberkante', modelBottom: 'Modellunterkante', top: 'Obere Höhe', bottom: 'Endhöhe', feed: 'Vorschubhöhe', origin: 'Ursprung (absolut)', pick: 'Auswahl' };
const COMP_TYPES = [['computer', 'Im Computer'], ['control', 'An Steuerung'], ['wear', 'Verschleiß'], ['inverseWear', 'Invers Verschleiß'], ['off', 'Aus']];
const RAPID_MODES = [['preserve', 'Eilgangbewegungen beibehalten'], ['clearance', 'Eilgang nur auf Rückzugs-/Sicherheitshöhe'], ['highFeed', 'Hohen Vorschub statt Eilgang']];
const PICK_IC = '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M4 1.5v11l3-2.6 2 4.4 1.8-.8-2-4.3 4-.3z" fill="currentColor"/></svg>';

// section headed by a checkbox ("☐ Haltestege"); content only when it is on
const csec = (label, on, set, disabled = false) => h('label', { class: 'csec' + (on ? ' on' : '') + (disabled ? ' dis' : '') }, h('input', { type: 'checkbox', checked: !!on, disabled, onchange: e => set(e.target.checked) }), h('span', null, label));
const toolLabel = x => `#${x.number} - Ø${f2(x.dia)}mm ${TOOL_TYPES[x.type] || x.type} (${x.name})`;

// tool with its cutting data preset, as the toolpath uses it
function opToolData(op) {
  const t = state.project.cam.tools.find(x => x.id === op.tool);
  if (!t) return null;
  const pre = op.preset && (t.presets || []).find(x => x.id === op.preset);
  const base = pre ? { ...t, ...Object.fromEntries(Object.entries({ rpm: pre.rpm, feed: pre.feed, plunge: pre.plunge, stepdown: pre.stepdown, stepover: pre.stepover }).filter(([, v]) => v != null && v !== '' && Number.isFinite(+v))) } : t;
  return applyCutData(base, op);
}

// tool picker of the operation ("Auswählen …")
function pickToolForOp(op) {
  const ok = x => (TOOLS_FOR[op.type] || TOOLS_FOR.default)({ ...x, type: toolBase(x), kind: x.type });
  const tools = state.project.cam.tools.filter(x => toolBase(x));
  const back = h('div', { class: 'modal-back' });
  const close = () => back.remove();
  const list = h('div', { class: 'otp-list' }, ...tools.map(x => h('button', {
    class: 'otp-item' + (x.id === op.tool ? ' on' : '') + (ok(x) ? '' : ' no'), disabled: !ok(x), title: ok(x) ? '' : 'Für diese Strategie nicht geeignet',
    onclick: () => { close(); editOp(op.id, o => { o.tool = x.id; delete o.cut; delete o.preset; }); },
  }, h('span', { class: 'otp-ic' }, toolIcon(x, 22, 30)), h('span', { class: 'otp-n' }, `#${x.number}`), h('span', { class: 'otp-name' }, x.name), h('span', { class: 'otp-d' }, `Ø${f2(x.dia)} mm`), h('span', { class: 'otp-t' }, TOOL_TYPES[x.type] || x.type))));
  back.append(h('div', { class: 'modal otp' },
    h('div', { class: 'modal-head' }, 'WERKZEUG AUSWÄHLEN', h('button', { onclick: close }, '✕')),
    h('div', { class: 'otp-body' }, tools.length ? list : h('p', { class: 'hint' }, 'Noch keine Werkzeuge im Dokument.')),
    h('div', { class: 'modal-foot' }, h('button', { onclick: () => { close(); openToolLibrary(); } }, 'Werkzeugbibliothek …'), h('span', { style: 'flex:1' }), h('button', { onclick: close }, 'Abbrechen'))));
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.body.append(back);
}

// faces / edges for the machining boundary and for face groups ("Auswahl" in the face manager)
function opFacePick(e, meshes, m) {
  const op = camOp(state.pick.id);
  if (!op) return;
  const bound = state.pick.mode === 'opbound';
  const hit = vp.raycast(e, meshes)[0];
  if (bound) {
    const eh = vp.raycast(e, edgePickObjects(), 6)[0];
    if (eh && (!hit || eh.distance <= hit.distance + vp.worldPerPixel() * 6)) {
      const eb = m.bodies[eh.object.userData.body], ref = edgeMidpoint(eb, eb.segEdge[Math.floor(eh.index / 2)]);
      return editOp(op.id, o => { o.boundaryEdges ||= []; const k = o.boundaryEdges.findIndex(r => Math.hypot(r[0] - ref[0], r[1] - ref[1], r[2] - ref[2]) < 1e-3); if (k >= 0) o.boundaryEdges.splice(k, 1); else o.boundaryEdges.push(ref); });
    }
  }
  if (!hit) return;
  const bi = hit.object.userData.body, body = m.bodies[bi], fid = body.faceOf[hit.faceIndex];
  const ref = faceRefPoint(body, hit.faceIndex);
  const toggle = list => {
    const k = list.findIndex(r => { const fa = faceAt(r); return fa && fa.bi === bi && fa.fid === fid; });
    if (k >= 0) list.splice(k, 1); else list.push(ref);
  };
  if (bound) return editOp(op.id, o => toggle(o.boundaryFaces ||= []));
  const gid = state.pick.key;
  editOp(op.id, o => {
    const g = (o.faceGroups || []).find(x => x.id === gid);
    if (!g) return;
    g.faces ||= [];
    // "Bohrungen": a hole selects every hole of the same diameter
    const c = g.holes && cylinderInfo(m.bodies, hit.point.toArray());
    if (c && !c.outside) {
      const same = cylinderFaces(m.bodies).filter(q => !q.outside && Math.abs(q.r - c.r) < 1e-3);
      const have = q => g.faces.some(r => { const fa = faceAt(r), fq = faceAt(q.pt); return fa && fq && fa.bi === fq.bi && fa.fid === fq.fid; });
      const allIn = same.every(have);
      if (allIn) g.faces = g.faces.filter(r => !same.some(q => { const fa = faceAt(r), fq = faceAt(q.pt); return fa && fq && fa.bi === fq.bi && fa.fid === fq.fid; }));
      else for (const q of same) if (!have(q)) g.faces.push(q.pt.map(v => +v.toFixed(5)));
      return;
    }
    toggle(g.faces);
  });
}

// picking heights and entry points in the viewport
function toggleOpPick(mode, id, key) {
  const on = !(state.pick?.mode === mode && state.pick.id === id && state.pick.key === key);
  state.pick = on ? { mode, id, key } : null;
  const msg = { opheight: `${H_LABEL[key]}: Fläche oder Kante im Modell anklicken.`, oppoints: 'Bevorzugte Einfahrpositionen: Punkte am Modell anklicken.', opbound: 'Bearbeitungsbegrenzung: Flächen oder Kanten (Kette) anklicken – erneut klicken entfernt.', facegroup: 'Flächengruppe: Flächen anklicken – erneut klicken entfernt.' }[mode];
  showBanner(on ? [msg, h('button', { onclick: () => toggleOpPick(mode, id, key) }, 'Fertig')] : null);
  renderAll();
}
function opPointPick(e, meshes) {
  const op = camOp(state.pick.id);
  if (!op) return;
  const hit = vp.raycast(e, meshes)[0];
  if (!hit) return status('Nichts getroffen – auf das Modell klicken.');
  const setup = state.project.cam.setups.find(x => x.id === op.setup) || state.project.cam.setups[0];
  const q = hit.point.clone().applyMatrix4(setupMatrix(setup));
  if (state.pick.mode === 'opheight') {
    const key = state.pick.key;
    state.pick = null;
    showBanner(null);
    editOp(op.id, o => { o.heights = { ...(o.heights || {}) }; o.heights[key] = { ...heightSpec(o, setup)[key], from: 'pick', z: +q.z.toFixed(4) }; if (key === 'bottom') { delete o.bottom; delete o.bottomOffset; } });
    return;
  }
  editOp(op.id, o => { o.entryPts = [...(o.entryPts || []), [+q.x.toFixed(3), +q.y.toFixed(3)]]; });
}

// ----- common CAD/CAM "Flächen-Manager": face groups that are machined, avoided, ignored or treated as fixtures -----
const FG_ACTIONS = {
  avoid: ['Vermeiden', 'Das Werkzeug vermeidet diese Flächen, während es in der Nähe liegende Flächen bearbeitet, und hält die Sicherheitsabstände ein.', '<svg viewBox="0 0 20 20"><rect x="2" y="13" width="16" height="4" fill="#e03131"/><path d="M12 2h3v7h-3z" fill="#ced4da"/><path d="M12 9h3l-1.5 2z" fill="#adb5bd"/></svg>'],
  machine: ['Bearbeiten', 'Das Werkzeug schneidet in Richtung der ausgewählten Flächen, bis es die angegebenen Aufmaße erreicht.', '<svg viewBox="0 0 20 20"><rect x="2" y="13" width="16" height="4" fill="#40c057"/><path d="M8.5 2h3v8h-3z" fill="#ced4da"/><path d="M8.5 10h3L10 12z" fill="#adb5bd"/></svg>'],
  ignore: ['Ignorieren', 'Diese Flächen werden weder vermieden noch bearbeitet; liegen sie im Weg, werden sie geschnitten (Kollision möglich).', '<svg viewBox="0 0 20 20"><path d="M3 17V9h4v8zM7 17v-4h10v4z" fill="#dee2e6"/><path d="M12 2h3v8h-3z" fill="#ced4da"/></svg>'],
  fixture: ['Spannmittel', 'Das Werkzeug vermeidet diese Flächen unter Berücksichtigung der angegebenen Sicherheitsabstände (Spanner, Schraubstock).', '<svg viewBox="0 0 20 20"><rect x="3" y="12" width="14" height="5" fill="#fab005"/><rect x="6" y="9" width="8" height="3" fill="#868e96"/><path d="M8.5 2h3v6h-3z" fill="#ced4da"/></svg>'],
};
const fmUi = {};
function faceManager(put, op, ed, N) {
  const ui = (fmUi[op.id] ||= { sel: 'model', edit: null });
  const groups = op.faceGroups || [];
  const abs = !!op.fmAbsolute, baseR = +op.stockToLeave || 0, baseA = +op.axialStock || 0;
  const valInput = (v, set, absAdd) => num(abs ? f2((+v || 0) + absAdd) : +v || 0, w => set(abs ? +(w - absAdd).toFixed(4) : w), { unit: 'mm' });
  put('geo', sec('Flächen-Manager'), row('Absolute Werte anzeigen', chk(abs, v => ed(x => (x.fmAbsolute = v)))));
  const rowEl = (key, name, icon, r, a) => h('div', { class: 'fm-row' + (ui.sel === key ? ' on' : ''), onclick: e => { if (e.target.closest('input,select,button')) return; ui.sel = key; renderProps(); } },
    h('span', { class: 'fm-name' }, h('span', { class: 'fm-gic', html: SVG.body }), name), icon, r, a);
  const actSel = g => h('div', { class: 'fm-act', title: FG_ACTIONS[g.action][0] + ': ' + FG_ACTIONS[g.action][1] },
    h('span', { class: 'fm-aic', html: FG_ACTIONS[g.action][2] }),
    sel(Object.entries(FG_ACTIONS).map(([k, v]) => [k, v[0]]), g.action, v => ed(x => (x.faceGroups.find(q => q.id === g.id).action = v))));
  const setG = (g, k) => v => ed(x => (x.faceGroups.find(q => q.id === g.id)[k] = v));
  put('geo', h('div', { class: 'fm-table' },
    h('div', { class: 'fm-head' }, h('span', null, `Gruppen (${groups.length + 1})`), h('span', null, ''), h('span', null, 'Radial'), h('span', null, 'Axial')),
    rowEl('model', 'Setup-Modell', h('div', { class: 'fm-act', title: 'Bearbeiten – alle Körper des Setups' }, h('span', { class: 'fm-aic', html: FG_ACTIONS.machine[2] })),
      valInput(op.modelRadial, v => ed(x => (x.modelRadial = v)), baseR), valInput(op.modelAxial, v => ed(x => (x.modelAxial = v)), baseA)),
    ...groups.map(g => rowEl(g.id, `${g.name} (${(g.faces || []).length})`, actSel(g),
      valInput(g.radial, setG(g, 'radial'), g.action === 'machine' ? baseR + (+op.modelRadial || 0) : 0), valInput(g.axial, setG(g, 'axial'), g.action === 'machine' ? baseA + (+op.modelAxial || 0) : 0))),
    h('div', { class: 'fm-tools' },
      h('button', { title: 'Flächengruppe hinzufügen', onclick: () => { const id = uid('fg'); ui.sel = id; ui.edit = id; ed(x => (x.faceGroups ||= []).push({ id, name: `Flächen ${(x.faceGroups || []).length + 1}`, action: 'avoid', radial: 1, axial: 1, holes: false, faces: [] })); } }, '+'),
      h('button', { title: 'Gruppe bearbeiten', disabled: ui.sel === 'model', onclick: () => { ui.edit = ui.sel; renderProps(); } }, '✎'),
      h('button', { title: 'Nach oben', disabled: ui.sel === 'model', onclick: () => ed(x => { const i = x.faceGroups.findIndex(q => q.id === ui.sel); if (i > 0) [x.faceGroups[i - 1], x.faceGroups[i]] = [x.faceGroups[i], x.faceGroups[i - 1]]; }) }, '↑'),
      h('button', { title: 'Nach unten', disabled: ui.sel === 'model', onclick: () => ed(x => { const i = x.faceGroups.findIndex(q => q.id === ui.sel); if (i >= 0 && i < x.faceGroups.length - 1) [x.faceGroups[i + 1], x.faceGroups[i]] = [x.faceGroups[i], x.faceGroups[i + 1]]; }) }, '↓'),
      h('button', { title: 'Gruppe löschen', disabled: ui.sel === 'model', onclick: () => { const gid = ui.sel; ui.sel = 'model'; ui.edit = null; ed(x => (x.faceGroups = x.faceGroups.filter(q => q.id !== gid))); } }, '✕'))));
  // totals for the selected row (stock of the operation + setup model + group)
  const sg = groups.find(g => g.id === ui.sel);
  const totR = baseR + (+op.modelRadial || 0) + (sg?.action === 'machine' ? +sg.radial || 0 : 0), totA = baseA + (+op.modelAxial || 0) + (sg?.action === 'machine' ? +sg.axial || 0 : 0);
  put('geo', h('div', { class: 'stats' },
    h('span', null, sg && sg.action !== 'machine' ? 'Radialer Sicherheitsabstand' : 'Gesamtes radiales Rohteilaufmaß'), h('b', null, `${f2(sg && sg.action !== 'machine' ? +sg.radial || 0 : totR)} mm`),
    h('span', null, sg && sg.action !== 'machine' ? 'Axialer Sicherheitsabstand' : 'Gesamtes axiales Rohteilaufmaß'), h('b', null, `${f2(sg && sg.action !== 'machine' ? +sg.axial || 0 : totA)} mm`)));
  // editor of one group (the "FLÄCHEN" box)
  const eg = groups.find(g => g.id === ui.edit);
  if (eg) {
    const picking = state.pick?.mode === 'facegroup' && state.pick.id === op.id && state.pick.key === eg.id;
    const n = (eg.faces || []).length, clear = eg.action !== 'machine';
    put('geo', h('div', { class: 'fm-edit' },
      h('div', { class: 'fm-edit-h' }, 'FLÄCHEN', h('button', { class: 'gx', title: 'Schließen', onclick: () => { ui.edit = null; if (picking) toggleOpPick('facegroup', op.id, eg.id); else renderProps(); } }, '✕')),
      row('Name', txt(eg.name, setG(eg, 'name'))),
      h('div', { class: 'gsel' }, h('span', null, 'Auswahl'),
        h('button', { class: 'pickbtn' + (picking ? ' on' : ''), html: PICK_IC + (n ? ` ${n} Fläche${n > 1 ? 'n' : ''}` : ' Auswählen'), onclick: () => toggleOpPick('facegroup', op.id, eg.id) }),
        n ? h('button', { class: 'gx', title: 'Auswahl leeren', onclick: () => setG(eg, 'faces')([]) }, '✕') : null),
      row('Bohrungen', chk(eg.holes, setG(eg, 'holes'))),
      row('Aktion', h('div', { class: 'fm-acts' }, ...Object.entries(FG_ACTIONS).map(([k, [lbl, tip, ic]]) => h('button', { class: 'fm-abtn' + (eg.action === k ? ' on' : ''), title: `${lbl} – ${tip}`, html: ic, onclick: () => setG(eg, 'action')(k) })))),
      h('p', { class: 'hint' }, `${FG_ACTIONS[eg.action][0]}: ${FG_ACTIONS[eg.action][1]}`),
      eg.action === 'ignore' ? null : row(clear ? 'Radialer Sicherheitsabstand' : 'Radiales Aufmaß', num(eg.radial ?? 0, setG(eg, 'radial'), { unit: 'mm', min: 0 })),
      eg.action === 'ignore' ? null : row(clear ? 'Axialer Sicherheitsabstand' : 'Axiales Aufmaß', num(eg.axial ?? 0, setG(eg, 'axial'), { unit: 'mm' })),
      h('div', { class: 'btns' }, btn('Fertig', () => { ui.edit = null; if (picking) toggleOpPick('facegroup', op.id, eg.id); else renderProps(); }, 'primary'))));
  }
}

function propsOp(b, op) {
  setTitle(`${OP_TYPES[op.type].toUpperCase()} : ${String(op.name).toUpperCase()}`);
  const p = state.project;
  const g = getCam().setups.get(op.setup) || activeGen();
  const r = g.results.get(op.id);
  const ed = fn => editOp(op.id, fn);
  if (op.type === 'manual') return propsManual(b, op, r, ed);
  const setup = p.cam.setups.find(x => x.id === op.setup) || p.cam.setups[0];
  const tools = p.cam.tools.filter(x => (TOOLS_FOR[op.type] || TOOLS_FOR.default)({ ...x, type: toolBase(x), kind: x.type }));
  const M = setupMatrix(g.setup);
  const t = p.cam.tools.find(x => x.id === op.tool);
  const eff = opToolData(op);
  const N = (label, key, opt = {}) => row(label, num(op[key], v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  const C = (label, key, def = false, after = null) => row(label, chk(op[key] ?? def, v => ed(x => { x[key] = v; after?.(x, v); })));
  const isTurn = op.type in TURN_OPS;
  const is3d = OPS_3D.includes(op.type) || isTurn;
  const probe = op.type === 'probe';
  const milling = !isTurn && !probe;
  const contourish = op.type === 'contour' || op.type === 'chamfer';
  const hh = g.stock && r && !r.error && r.heights ? r.heights : null;
  const T = { tool: [], orient: [], geo: [], heights: [], passes: [], link: [] };
  const put = (tab, ...kids) => T[tab].push(...kids.filter(k => k != null && k !== false));

  // ===== Werkzeug =====
  put('tool', sec('Werkzeug'),
    h('div', { class: 'op-tool' },
      h('div', { class: 'op-toolrow' }, h('span', null, 'Werkzeug'), btn('Auswählen …', () => pickToolForOp(op)), t ? btn('Bearbeiten …', () => editToolDialog('doc', t.id)) : null),
      sel([...(t ? [] : [['', '– kein Werkzeug –']]), ...tools.map(x => [x.id, toolLabel(x)])], op.tool || '', v => ed(x => { x.tool = v; delete x.cut; delete x.preset; }))));
  if (t && eff && !probe) {
    const setCut = (k, v) => ed(x => { x.cut = { ...(x.cut || {}) }; if (v == null) delete x.cut[k]; else x.cut[k] = v; if (!Object.keys(x.cut).length) delete x.cut; });
    const ov = k => op.cut?.[k] != null;
    const F = (label, k, unit = 'mm/min') => { const el = row(label, num(f2(eff[k]), v => setCut(k, v), { unit, allowEmpty: true, min: 0 })); if (ov(k)) el.classList.add('ovr'); return el; };
    const z = +t.flutes || 2, d = +t.dia || 1, n = eff.rpm || 1;
    const vc = row('Schnittgeschwindigkeit', num(f2((Math.PI * d * n) / 1000), v => setCut('rpm', v == null ? null : Math.round((v * 1000) / (Math.PI * d))), { unit: 'm/min', allowEmpty: true, min: 0 }));
    const fz = row('Vorschub pro Zahn', num(+(eff.feed / (n * z)).toFixed(4), v => setCut('feed', v == null ? null : +(v * n * z).toFixed(1)), { unit: 'mm', allowEmpty: true, min: 0 }));
    const fu = row('Eintauchvorschub pro Umdrehung', num(+(eff.plunge / n).toFixed(4), v => setCut('plunge', v == null ? null : +(v * n).toFixed(1)), { unit: 'mm', allowEmpty: true, min: 0 }));
    put('tool', sec('Schnittdaten'),
      row('Voreinstellung', sel([['', 'Standard (Werkzeug)'], ...(t.presets || []).map(x => [x.id, x.name])], op.preset || '', v => ed(x => { x.preset = v || undefined; delete x.cut; }))),
      F('Spindeldrehzahl', 'rpm', 'U/min'), vc, F('Rampen-Drehzahl', 'rampRpm', 'U/min'),
      F('Schnittvorschub', 'feed'), fz, F('Einfahrvorschub', 'leadInFeed'), F('Ausfahrvorschub', 'leadOutFeed'), F('Übergangsvorschub', 'transitionFeed'),
      F('Helixvorschub', 'helixFeed'), F('Eintauchvorschub', 'plunge'), fu,
      op.cut ? h('div', { class: 'btns' }, btn('Werte vom Werkzeug übernehmen', () => ed(x => delete x.cut))) : null,
      ...cutCalcRows(op, t, ed, setup, g.machine));
  } else if (!t) put('tool', h('p', { class: 'hint' }, 'Werkzeug wählen – „Auswählen …“ zeigt alle Werkzeuge des Dokuments.'));
  if (!probe) put('tool', row('Kühlmittel', sel([['', `Vom Werkzeug (${COOLANT_MODES[(t?.presets || []).find(x => x.id === op.preset)?.coolant || t?.coolant || (p.post.coolant ? 'flood' : 'off')]})`], ...Object.entries(COOLANT_MODES)], op.coolant || '', v => ed(x => (x.coolant = v || undefined)))));
  put('tool', sec('Allgemein'),
    row('Name', txt(op.name, v => ed(x => (x.name = v)))),
    row('Aktiv', chk(op.enabled !== false, v => ed(x => (x.enabled = v)))),
    row('Setup', sel(p.cam.setups.map(x => [x.id, x.name]), op.setup, v => ed(x => (x.setup = v)))),
    row('Notiz', txt(op.note || '', v => ed(x => (x.note = v)))));

  // ===== Werkzeugausrichtung =====
  if (!isTurn) {
    const mode = (k, label, svg, on, dis) => h('button', { class: 'bmode' + (on ? ' on' : ''), disabled: dis, title: label, html: svg });
    put('orient', sec('Bearbeitungsart'),
      row('Bearbeitungsart', h('div', { class: 'bmodes' },
        mode('3', '3-Achsen', '<svg viewBox="0 0 24 24"><path d="M5 19V6" stroke="#4dabf7" stroke-width="2"/><path d="M5 19h12" stroke="#ff6b6b" stroke-width="2"/><path d="M5 19l8-5" stroke="#51cf66" stroke-width="2"/><text x="14" y="10" font-size="9" font-weight="700" fill="currentColor" stroke="none">3</text></svg>', true, false),
        mode('rot', 'Rundachse (nicht verfügbar)', '<svg viewBox="0 0 24 24"><path d="M12 3v7" stroke="currentColor" stroke-width="2"/><rect x="6" y="12" width="12" height="7" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>', false, true),
        mode('multi', 'Mehrachsen (nicht verfügbar)', '<svg viewBox="0 0 24 24"><circle cx="12" cy="14" r="5" fill="currentColor"/><path d="M5 9a9 9 0 0 1 14 0" fill="none" stroke="#4dabf7" stroke-width="2"/></svg>', false, true))),
      csec('Werkzeugausrichtung', false, () => {}, true),
      h('p', { class: 'hint' }, `Die Werkzeugachse kommt aus dem Setup („${setup.name}“: ${orientationLabel(setup)}). Für 3+2-Bearbeitung ein weiteres Setup mit gedrehter Ausrichtung anlegen – der Postprozessor schwenkt dann mit PLANE SPATIAL / CYCLE800 / G68.2.`),
      h('div', { class: 'btns' }, btn('Setup bearbeiten', () => select('setup', setup.id))));
  }

  // ===== Geometrie =====
  const faceMode = FACE_OPS.includes(op.type) && op.geomSource === 'model';
  if (FACE_OPS.includes(op.type)) {
    const hole = isHoleOp(op);
    const picking = state.pick?.mode === 'camfaces' && state.pick.id === op.id;
    const faces = op.faces || [], chains = op.edges || [];
    put('geo', sec('Geometrie'),
      probe ? row('Antasten', sel(Object.entries(PROBE_MODES), op.probeMode || 'z', v => ed(x => { x.probeMode = v; x.faces = []; }))) : null,
      row('Auswahl aus', sel([['model', hole ? 'Bohrungen im Modell' : 'Flächen im Modell'], ['sketch', 'Skizze']], op.geomSource || 'sketch', v => ed(x => { x.geomSource = v; x.faces ||= []; }))));
    if (faceMode) {
      const what = hole ? 'Bohrungsauswahl' : op.type === 'contour' ? 'Konturauswahl' : 'Flächenauswahl';
      const item = (i) => hole ? `Bohrung ${i + 1}` : op.type === 'contour' ? `Geschlossene Kette ${i + 1}` : `Fläche ${i + 1}`;
      put('geo',
        h('div', { class: 'gsel' }, h('span', null, what),
          h('button', { class: 'pickbtn' + (picking ? ' on' : ''), html: PICK_IC + ' Auswählen', onclick: () => toggleCamPick(op.id) }),
          faces.length || chains.length ? h('button', { class: 'gx', title: 'Auswahl leeren', onclick: () => ed(x => { x.faces = []; x.edges = []; }) }, '✕') : null),
        h('div', { class: 'glist' }, ...(faces.length || chains.length ? [
          ...chains.map((_, i) => h('div', { class: 'gitem' }, h('span', { class: 'gic', html: '<svg viewBox="0 0 16 16"><path d="M3 12V5l4-2 6 3v6l-5 2z" fill="none" stroke="#2f9e44" stroke-width="1.6"/></svg>' }), h('span', null, `Geschlossene Kette ${i + 1}`),
            h('button', { class: 'gx', title: 'Entfernen', onclick: () => ed(x => x.edges.splice(i, 1)) }, '✕'))),
          ...faces.map((_, i) => h('div', { class: 'gitem' }, h('span', { class: 'gic', html: SVG.body }), h('span', null, item(i)),
            h('button', { class: 'gx', title: 'Entfernen', onclick: () => ed(x => x.faces.splice(i, 1)) }, '✕')))]
          : [h('div', { class: 'gempty' }, EDGE_OPS.includes(op.type) && !hole ? 'Nichts gewählt – „Auswählen“, dann Flächen oder Kanten im Modell anklicken.' : 'Nichts gewählt – „Auswählen“ und im Modell anklicken.')])));
    }
  }
  if (op.type !== 'face' && !is3d && !faceMode) {
    put('geo', FACE_OPS.includes(op.type) ? null : sec('Geometrie'),
      row('Skizze', sel([['', '– wählen –'], ...sketchOptions(M)], op.sketch || '', v => ed(x => { x.sketch = v; x.entities = 'all'; }))),
      row(['drill', 'bore', 'thread', 'circular'].includes(op.type) ? 'Kreise' : op.type === 'slot' ? 'Nuten' : ['trace', 'project3d', 'rotaryWrap'].includes(op.type) ? 'Kurven' : 'Profile',
        profileChecks(op.sketch, op.entities, v => ed(x => (x.entities = v)),
          ['drill', 'bore', 'thread', 'circular'].includes(op.type) ? e => e.type === 'circle'
            : op.type === 'slot' ? e => e.type === 'slot' || (e.type === 'poly' && !e.closed)
              : ['trace', 'project3d', 'rotaryWrap'].includes(op.type) ? () => true : undefined)));
  }
  if (['blend3d', 'guidemorph3d', 'geodesic3d'].includes(op.type) || (SURF_FACE_OPS.includes(op.type) && !faceMode)) {
    const curves = !SURF_FACE_OPS.includes(op.type);
    put('geo', SURF_FACE_OPS.includes(op.type) ? null : sec('Geometrie'),
      row(curves ? (op.type === 'geodesic3d' ? 'Leitkurve (Skizze)' : 'Leitkurven (Skizze)') : 'Skizze', sel([['', op.type === 'geodesic3d' ? '– Rand des Bereichs –' : '– wählen –'], ...sketchOptions(M)], op.sketch || '', v => ed(x => { x.sketch = v; x.entities = 'all'; }))),
      op.sketch ? row(curves ? 'Kurven' : 'Profile', profileChecks(op.sketch, op.entities, v => ed(x => (x.entities = v)), curves ? () => true : undefined)) : null,
      h('p', { class: 'hint' }, op.type === 'geodesic3d' ? 'Die Bahnen haben überall denselben Abstand auf der Oberfläche – gemessen von der Leitkurve (ohne Skizze: vom Rand des Bearbeitungsbereichs).'
        : op.type === 'blend3d' ? 'Die ersten zwei gewählten Kurven sind die Leitkurven; die Bahnen gehen gleitend von der einen in die andere über.'
          : op.type === 'guidemorph3d' ? 'Die ersten zwei gewählten Kurven sind die Leitkurven; die Bahnen laufen quer von der einen zur anderen.' : 'Geschlossene Profile begrenzen den Bereich.'));
  }
  if (op.type === 'project3d') put('geo', sec('Geometrie'), row('Skizze', sel([['', '– wählen –'], ...sketchOptions(M)], op.sketch || '', v => ed(x => { x.sketch = v; x.entities = 'all'; }))));
  if (['contour', 'chamfer', 'thread'].includes(op.type) && op.type !== 'face') put('geo', row(op.type === 'thread' ? 'Gewinde' : 'Seite', sel(op.type === 'thread' ? [['inside', 'Innengewinde'], ['outside', 'Außengewinde']] : [['outside', 'Außen'], ['inside', 'Innen']], op.side, v => ed(x => (x.side = v)))));
  if (op.type === 'face') put('geo', sec('Geometrie'), h('p', { class: 'hint' }, 'Planfräsen bearbeitet die gesamte Rohteiloberfläche bis zur Modelloberkante (Endhöhe).'));
  if (is3d && !isTurn) put('geo', sec('Modell'), h('p', { class: 'hint' }, `Alle Körper des Setups („${setup.name}“). Körper auswählen: im Setup unter „Modell“.`));
  const BOUND_OPS = ['rough3d', 'adaptive3d', 'pocket3d', 'parallel3d', 'contour3d', 'horizontal3d', 'steep3d', 'scallop3d', 'spiral3d', 'radial3d', 'flat3d', 'morphspiral3d', 'geodesic3d', 'corner3d'];
  if (BOUND_OPS.includes(op.type)) {
    const bm = op.boundary === 'stock' || !op.boundary ? 'none' : op.boundary;
    const bIcons = { none: '', box: '<svg viewBox="0 0 16 16"><rect x="2" y="3" width="12" height="10" fill="none" stroke="#51cf66" stroke-width="1.4" stroke-dasharray="2 1.5"/><path d="M5 10l3-5 3 5z" fill="#cfd4da"/></svg>', silhouette: '<svg viewBox="0 0 16 16"><path d="M2 12l3-7h6l3 7z" fill="none" stroke="#51cf66" stroke-width="1.4"/><path d="M5 10l3-4 3 4z" fill="#cfd4da"/></svg>', selection: '<svg viewBox="0 0 16 16"><path d="M3 5l5-2 5 2v6l-5 2-5-2z" fill="#e9ecef"/><path d="M8 7v6" stroke="#868e96"/><path d="M9 8v6l1.6-1.4 1 2.2 1-.4-1-2.2h2.1z" fill="#fff" stroke="#333" stroke-width=".5"/></svg>' };
    put('geo', sec('Geometrie'),
      row('Bearbeitungsbegrenzung', h('div', { class: 'isel' }, bIcons[bm] ? h('span', { class: 'isel-ic', html: bIcons[bm] }) : null, sel(Object.entries(BOUNDARY_MODES), bm, v => ed(x => (x.boundary = v))))));
    if (bm === 'selection') {
      const picking = state.pick?.mode === 'opbound' && state.pick.id === op.id;
      const nb = (op.boundaryFaces || []).length + (op.boundaryEdges || []).length;
      put('geo', h('div', { class: 'gsel' }, h('span', null, 'Begrenzungsauswahl'),
        h('button', { class: 'pickbtn' + (picking ? ' on' : ''), html: PICK_IC + (nb ? ` ${nb} gewählt` : ' Auswählen'), onclick: () => toggleOpPick('opbound', op.id) }),
        nb ? h('button', { class: 'gx', title: 'Auswahl leeren', onclick: () => ed(x => { x.boundaryFaces = []; x.boundaryEdges = []; }) }, '✕') : null),
        nb ? null : row('Oder Skizze', sel([['', '– keine –'], ...sketchOptions(M)], op.boundarySketchSel || '', v => ed(x => (x.boundarySketchSel = v || undefined)))));
    }
    if (bm !== 'none') put('geo',
      row('Werkzeugeinschluss', sel([['inside', 'Werkzeug innerhalb der Begrenzung'], ['center', 'Werkzeugmitte auf der Begrenzung'], ['outside', 'Werkzeug außerhalb der Begrenzung']], op.toolContain || (bm === 'silhouette' ? 'outside' : 'center'), v => ed(x => (x.toolContain = v)))),
      N('Zusätzlicher Versatz', 'boundaryOffset'));
  }
  // common CAD/CAM "Rohteildefinition" for 3D roughing
  if (['rough3d', 'adaptive3d', 'pocket3d'].includes(op.type)) {
    const sf = op.stockFrom || (op.restDia ? 'prevTool' : 'setup');
    put('geo', sec('Rohteildefinition'),
      row('Rohteil definieren nach', sel([['setup', 'Setup-Rohteil'], ['prevOps', 'Vorherige Operationen'], ['prevTool', 'Vorheriges Werkzeug (Restmaterial)']], sf, v => ed(x => { x.stockFrom = v; if (v === 'prevTool' && !x.restDia) x.restDia = Math.max(2 * (t?.dia || 6), 10); if (v !== 'prevTool') x.restDia = null; }))));
    if (sf === 'prevOps') {
      const prevN = p.cam.ops.slice(0, p.cam.ops.findIndex(o => o.id === op.id)).filter(o => o.setup === op.setup && o.enabled !== false).length;
      put('geo', row('Quelle', h('span', { class: 'hint' }, `${prevN} vorherige Operation(en) in „${setup.name}“`)));
    }
    if (sf === 'prevTool') put('geo', N('Vorheriger Werkzeug-Ø', 'restDia', { min: 0.1 }), op.type === 'pocket3d' || (op.type === 'rough3d' && op.strategy !== 'adaptive') ? h('p', { class: 'warn' }, 'Restmaterial vom Werkzeug wirkt beim adaptiven Schruppen.') : null);
    if (sf !== 'setup') put('geo', row('Rohteilmaterial ignorieren, das kleiner ist als', num(op.restIgnore ?? 0.1, v => ed(x => (x.restIgnore = v)), { unit: 'mm', min: 0 })));
    put('geo', C('Luftschnitte reduzieren', 'reduceAir'));
  }
  if (op.type === 'spiral3d' || op.type === 'radial3d' || op.type === 'morphspiral3d') put('geo', sec('Mittelpunkt'), N('Mittelpunkt X', 'cx', { allowEmpty: true, ph: 'Rohteilmitte' }), N('Mittelpunkt Y', 'cy', { allowEmpty: true, ph: 'Rohteilmitte' }), op.type === 'radial3d' ? N('Innenradius', 'innerR', { allowEmpty: true, ph: 'Bahnabstand' }) : null);
  if (op.type === 'contour') {
    put('geo', csec('Haltestege', op.tabs, v => ed(x => (x.tabs = v))));
    if (op.tabs) put('geo', N('Anzahl', 'tabCount', { unit: null, min: 1, int: true }), N('Haltestegbreite', 'tabWidth', { min: 0.1 }), N('Haltesteghöhe', 'tabHeight', { min: 0.1 }));
  }
  if (op.type === 'adaptive' || op.type === 'pocket' || op.type === 'contour') {
    const on = op.restDia != null && op.restDia !== '';
    put('geo', csec('Restmaterialbearbeitung', on, v => ed(x => (x.restDia = v ? (x.restDia || Math.max(2 * (t?.dia || 6), 10)) : null))));
    if (on) put('geo', N('Vorheriger Werkzeug-Ø', 'restDia', { min: 0.1 }), h('p', { class: 'hint' }, op.type === 'contour' ? 'Nur die Stellen der Kontur nachfahren, die ein größerer Fräser nicht erreicht hat (Innenecken, enge Stellen). Ohne An-/Abfahrbögen, Haltestege und Schlichtdurchgänge; Korrektur im Rechner.' : 'Nur das bearbeiten, was ein größerer Fräser in Ecken stehen gelassen hat.'));
  }
  if (isTurn) put('geo', sec('Geometrie'), h('p', { class: 'hint' }, 'Drehbearbeitung: Kontur aus dem Modell (Drehachse = Setup-Z).'));
  if (OPS_3D.includes(op.type)) faceManager(put, op, ed, N);

  // ===== Höhen =====
  if (milling && !['chamfer', 'trace', 'project3d', 'vcarve'].includes(op.type)) {
    const spec = heightSpec(op, setup);
    const autoLabel = op.type === 'face' ? 'Modelloberkante (automatisch)' : OPS_3D.includes(op.type) ? 'Modellunterkante (automatisch)' : faceMode ? 'Ausgewählte Kontur(en)' : 'Skizze / Bohrungsgrund (automatisch)';
    const setH = (k, patch) => ed(x => { x.heights = { ...(x.heights || {}) }; x.heights[k] = { ...heightSpec(x, setup)[k], ...patch }; if (k === 'bottom') { delete x.bottom; delete x.bottomOffset; } });
    for (const k of HEIGHT_KEYS) {
      const sp = spec[k];
      const picking = state.pick?.mode === 'opheight' && state.pick.id === op.id && state.pick.key === k;
      put('heights', sec(H_LABEL[k]),
        row('Von', sel(HEIGHT_FROM[k].map(f => [f, f === 'auto' ? autoLabel : H_FROM_LABEL[f]]), sp.from, v => setH(k, { from: v, ...(v === 'origin' && sp.from !== 'origin' && hh ? { offset: f2(hh[k === 'bottom' ? 'bottom' : k]) } : {}) }))),
        sp.from === 'pick' ? h('div', { class: 'gsel' }, h('span', null, 'Referenz'),
          h('button', { class: 'pickbtn' + (picking ? ' on' : ''), html: PICK_IC + (Number.isFinite(+sp.z) ? ` Z ${f2(sp.z)}` : ' Auswählen'), onclick: () => toggleOpPick('opheight', op.id, k) }),
          Number.isFinite(+sp.z) ? h('button', { class: 'gx', title: 'Auswahl entfernen', onclick: () => setH(k, { z: null }) }, '✕') : null) : null,
        row('Versatz', num(sp.offset, v => setH(k, { offset: v ?? 0 }), { unit: 'mm' })),
        hh && Number.isFinite(hh[k]) ? h('div', { class: 'hval' }, `= Z ${f2(hh[k])}`) : null);
    }
  }

  // ===== Durchgänge =====
  const tdPh = t ? `${t.stepdown} (Werkzeug)` : '';
  const toPh = t ? `${Math.round(t.stepover * 100)} (Werkzeug)` : '';
  const stepoverPct = (label = 'Max. seitliche Zustellung') => row(label, num(op.stepover ? f2(op.stepover * 100) : null, v => ed(x => (x.stepover = v == null ? null : v / 100)), { unit: '% Ø', allowEmpty: true, ph: toPh }));
  const tol = () => milling && op.type !== 'drill' ? row('Toleranz', num(op.tolerance ?? 0.01, v => ed(x => (x.tolerance = v)), { unit: 'mm', min: 0.001 })) : null;
  // order of the holes (drilling, boring, thread / circular milling): shortest rapid path by default
  const holeOrderRow = () => {
    const ho = r?.holeOrder, mm = v => (v >= 1000 ? `${f2(v / 1000)} m` : `${Math.round(v)} mm`);
    put('passes', row('Reihenfolge', sel([['shortest', 'Kürzester Weg (optimiert)'], ['keep', 'Wie ausgewählt'], ['x', 'Zeilenweise in X (Zickzack)'], ['y', 'Spaltenweise in Y (Zickzack)']], op.holeOrder || 'shortest', v => ed(x => (x.holeOrder = v)))),
      ho && ho.n > 2 ? h('p', { class: 'hint' }, `${ho.n} Positionen, Leerweg in XY ${mm(ho.len)}${ho.before > ho.len + 1 ? ` (in Auswahlreihenfolge ${mm(ho.before)}, −${Math.round((100 * (ho.before - ho.len)) / ho.before)} %)` : ''}.`) : null);
  };
  const dirRow = () => row('Fräsrichtung', sel([['climb', 'Gleichlauf'], ['conventional', 'Gegenlauf']], op.direction || 'climb', v => ed(x => (x.direction = v))));
  const depthSec = (label = 'Max. Tiefenzustellung', ph = tdPh) => {
    const on = op.multiDepth !== false;
    put('passes', csec('Tiefenschnitte', on, v => ed(x => (x.multiDepth = v))));
    if (on) put('passes', N(label, 'stepdown', { allowEmpty: true, ph, min: 0.01 }));
    return on;
  };
  const stockSec = (axial = true) => {
    const on = op.stockOn !== false;
    put('passes', csec('Rohteil-Aufmaß', on, v => ed(x => (x.stockOn = v))));
    if (on) put('passes', N('Radiales Aufmaß', 'stockToLeave'), axial ? N('Axiales Aufmaß', 'axialStock') : null);
  };
  put('passes', sec(op.type === 'drill' ? 'Zyklus' : 'Durchgänge'), tol());
  switch (op.type) {
    case 'face':
      put('passes', stepoverPct('Bahnabstand'));
      depthSec('Max. Zustellung');
      stockSec();
      break;
    case 'probe':
      put('passes', N('Messtiefe', 'probeDepth', { min: 0 }), N('Sicherheitsabstand', 'probeClear', { min: 0.5 }),
        row('Bezugspunkt-Nr. (Q305)', num(op.probePreset ?? (g.setup.wcsOffset || 1), v => ed(x => (x.probePreset = v)), { unit: null, min: 0, int: true })),
        row('Übernahme (Q303)', sel([['1', 'Preset-Tabelle'], ['0', 'Nullpunkt-Tabelle']], String(op.probeTransfer ?? 1), v => ed(x => (x.probeTransfer = +v)))),
        r?.probe ? h('div', { class: 'stats' }, h('span', null, 'Messpunkt'), h('b', null, `X ${f2(r.probe.x)}  Y ${f2(r.probe.y)}  Z ${f2(r.probe.z)}`),
          r.probe.dia ? h('span', null, 'Durchmesser') : null, r.probe.dia ? h('b', null, `Ø ${f2(r.probe.dia)} mm`) : null,
          r.probe.w ? h('span', null, 'Größe') : null, r.probe.w ? h('b', null, `${f2(r.probe.w)} × ${f2(r.probe.l)} mm`) : null) : null,
        h('p', { class: 'hint' }, 'Erzeugt einen Tastzyklus (Heidenhain TCH PROBE 417/412/413/411/410, Fanuc Renishaw G65 P98xx).'));
      break;
    case 'contour': {
      const ct = op.compType || 'computer';
      const mf = op.multiFinish ?? (+op.finishPasses > 0);
      put('passes',
        row('Seitliche Kompensation', sel([['climb', 'Links'], ['conventional', 'Rechts']], op.direction || 'climb', v => ed(x => (x.direction = v)))),
        row('Kompensationstyp', sel(COMP_TYPES, ct, v => ed(x => (x.compType = v)))),
        C('Als Steuerungszyklus ausgeben (Zapfen)', 'ctrlCycle'),
        op.ctrlCycle ? h('p', { class: 'hint' }, r?.studCycle ? `Rechteck-/Kreiszapfen erkannt (${r.studCycle.pockets.length}) – Heidenhain: CYCL DEF 256/257. Rohteilmaß = Fertigmaß + Abtrag dieser Operation.` : r?.studCycleWhy ? `⚠ ${r.studCycleWhy} – wird als Bahn ausgegeben.` : 'Außenkonturen um Rechtecke und Kreise gehen als Zapfenzyklus der Steuerung (Heidenhain 256/257).') : null,
        ct !== 'computer' && ct !== 'off' ? h('p', { class: 'hint' }, ct === 'control' ? 'Bahn liegt auf der Kontur, die Steuerung korrigiert mit dem Werkzeugradius (G41/G42 bzw. RL/RR). Einfahrt einschalten, damit die Korrektur auf der Anfahrt aufgebaut wird.' : 'Bahn mit Werkzeugradius plus Korrektur an der Steuerung (nur Verschleißwerte in der Werkzeugtabelle).') : null,
        C('Scharfe Ecken erzeugen', 'sharpCorners'),
        N('Minimaler Schneidradius', 'minCutRadius', { min: 0 }),
        C('Mehrere Schlichtdurchgänge', 'multiFinish', mf, (x, v) => { if (v && !(+x.finishPasses > 0)) x.finishPasses = 1; }));
      if (mf) put('passes', row('Anzahl der Schlichtdurchgänge', num((+op.finishPasses || 0) + 1, v => ed(x => (x.finishPasses = Math.max(0, v - 1))), { unit: null, min: 1, int: true })), N('Schlichtzustellung', 'finishStepover', { min: 0.01 }));
      put('passes',
        row('Schlichtvorschub', num(op.finishFeed ?? (eff ? f2(eff.feed) : null), v => ed(x => (x.finishFeed = v)), { unit: 'mm/min', allowEmpty: true, min: 1 })),
        C('Schlichtdurchgang wiederholen', 'repeatFinish'),
        N('Überlappung bei Schlichtbearbeitung', 'overlap', { min: 0 }),
        C('Reihenfolge beibehalten', 'keepOrder'));
      put('passes', csec('Schruppdurchgänge', op.roughPasses, v => ed(x => (x.roughPasses = v))));
      if (op.roughPasses) put('passes', N('Anzahl der Schruppdurchgänge', 'roughCount', { unit: null, min: 1, int: true, ph: '1' }), N('Max. Schrupp-Zustellung', 'roughStepover', { min: 0.05, allowEmpty: true, ph: t ? f2(t.dia * 0.4) : '' }));
      if (depthSec()) {
        put('passes', C('Schlichttiefenschnitte', 'finishDepth'));
        if (op.finishDepth) put('passes', N('Anzahl der Schlichttiefenschnitte', 'finishDepthCount', { unit: null, min: 1, int: true }), N('Schlichttiefen-Zustellung', 'finishDepthStep', { min: 0.01 }));
        put('passes', row('Ordnen nach', sel([['area', 'Bereich'], ['depth', 'Tiefe']], op.orderByDepth ? 'depth' : 'area', v => ed(x => (x.orderByDepth = v === 'depth')))));
      }
      stockSec();
      put('passes', csec('Glättungsfilter', op.smoothing, v => ed(x => { x.smoothing = v; if (v && !(+x.smoothTol > 0)) x.smoothTol = 0.05; })));
      if (op.smoothing) put('passes', N('Glättungstoleranz', 'smoothTol', { min: 0.001 }));
      break;
    }
    case 'pocket':
      put('passes', dirRow(), stepoverPct(), C('Als Steuerungszyklus ausgeben', 'ctrlCycle'),
        op.ctrlCycle ? h('p', { class: 'hint' }, r?.pocketCycle ? `Rechteck-/Kreistasche erkannt (${r.pocketCycle.pockets.length}) – Heidenhain: CYCL DEF 251/252 an der Taschenmitte. Die Steuerung fräst mit ihrer eigenen Strategie; Simulation und Bahn hier sind die WerkFab-Bahn.` : r?.pocketCycleWhy ? `⚠ ${r.pocketCycleWhy} – wird als Bahn ausgegeben.` : 'Rechteck- und Kreistaschen ohne Inseln gehen als Zyklus der Steuerung (Heidenhain 251/252).') : null);
      depthSec();
      stockSec();
      break;
    case 'chamfer':
      put('passes', row('Seitliche Kompensation', sel([['climb', 'Links'], ['conventional', 'Rechts']], op.direction || 'climb', v => ed(x => (x.direction = v)))),
        N('Fasenbreite', 'width', { min: 0.01 }), N('Zusatztiefe Spitze', 'extraDepth', { min: 0 }), C('Reihenfolge beibehalten', 'keepOrder'),
        hh ? h('div', { class: 'stats' }, h('span', null, 'Kantenhöhe'), h('b', null, `Z ${f2(hh.edge)}`)) : null);
      break;
    case 'drill': {
      const cyc = op.cycle || (+op.peck > 0 ? 'peck' : 'drill');
      put('passes', row('Zyklustyp', sel(Object.entries(DRILL_CYCLES), cyc, v => ed(x => { x.cycle = v; if (v === 'tap') { const tap = p.cam.tools.find(q => q.type === 'tap'); if (tap) x.tool = tap.id; } }))));
      if (cyc === 'peck' || cyc === 'chip') put('passes', N('Zustelltiefe', 'peck', { min: 0.1 }));
      if (cyc === 'dwell' || cyc === 'ream' || cyc === 'bore') put('passes', N('Verweilzeit', 'dwell', { unit: 's', min: 0 }));
      if (cyc === 'tap') {
        put('passes', N('Steigung', 'pitch', { allowEmpty: true, ph: t?.pitch ? `${t.pitch} (Werkzeug)` : '1' }),
          row('Gewinde', sel([['right', 'Rechtsgewinde'], ['left', 'Linksgewinde']], op.hand || 'right', v => ed(x => (x.hand = v)))),
          h('p', { class: 'hint' }, `Vorschub = Drehzahl × Steigung${t ? ` = ${f2(t.rpm * (+op.pitch || +t.pitch || 1))} mm/min` : ''}. Ausgabe als G84/G74, CYCL 207 bzw. CYCLE84.`));
      }
      put('passes', h('p', { class: 'hint' }, 'Mit „Bohrzyklen“ im NC-Programm werden Steuerungszyklen ausgegeben (G81–G86, Heidenhain CYCL 200–207, Sinumerik CYCLE81–85), sonst ausgeschriebene Bewegungen.'));
      holeOrderRow();
      break;
    }
    case 'bore':
      put('passes', dirRow(), N('Steigung je Umdrehung', 'stepdown', { allowEmpty: true, ph: tdPh }));
      holeOrderRow();
      stockSec(false);
      break;
    case 'thread':
      put('passes', N('Nenn-Ø (Außen-Ø)', 'majorDia', { allowEmpty: true, ph: 'aus Kreis' }), N('Steigung', 'pitch', { min: 0.1 }),
        row('Drehrichtung', sel([['right', 'Rechtsgewinde'], ['left', 'Linksgewinde']], op.hand || 'right', v => ed(x => (x.hand = v)))),
        h('p', { class: 'hint' }, 'Gefräst wird von unten nach oben im Gleichlauf. M6 = Nenn-Ø 6, Steigung 1; M8 = 8 / 1,25; M10 = 10 / 1,5.'));
      holeOrderRow();
      break;
    case 'trace':
      put('passes', N('Tiefe', 'depth', { min: 0.01 }));
      depthSec('Max. Tiefenzustellung', 'Tiefe in einem Zug');
      break;
    case 'rough3d':
      put('passes', row('Strategie', sel([['adaptive', 'Adaptiv (konstante Umschlingung)'], ['offset', 'Versatz (Taschenbahnen)']], op.strategy || 'offset', v => ed(x => (x.strategy = v)))), stepoverPct(op.strategy === 'adaptive' ? 'Optimale Belastung' : 'Max. seitliche Zustellung'));
      depthSec();
      stockSec();
      break;
    case 'adaptive':
      put('passes', row('Optimale Belastung', num(op.stepover ? f2(op.stepover * 100) : null, v => ed(x => (x.stepover = v == null ? null : v / 100)), { unit: '% Ø', allowEmpty: true, ph: '10' })),
        h('p', { class: 'hint' }, 'Konstante seitliche Umschlingung statt Vollschnitt in Ecken. Typisch 8–15 % Ø seitlich bei 1–2 × Ø Zustellung in Z.'));
      depthSec();
      stockSec();
      break;
    case 'adaptive3d':
      put('passes', row('Optimale Belastung', num(op.stepover ? f2(op.stepover * 100) : null, v => ed(x => (x.stepover = v == null ? null : v / 100)), { unit: '% Ø', allowEmpty: true, ph: '12' })));
      depthSec();
      stockSec();
      break;
    case 'pocket3d':
      put('passes', dirRow(), stepoverPct());
      depthSec();
      stockSec();
      break;
    case 'flat3d':
      put('passes', N('Bahnabstand', 'stepoverMm', { min: 0.01 }), row('Grenzwinkel (max. Neigung)', num(op.slope ?? 3, v => ed(x => (x.slope = v)), { unit: '°', min: 0 })),
        row('Bahnwinkel', num(op.angle || 0, v => ed(x => (x.angle = v)), { unit: '°' })),
        h('p', { class: 'hint' }, 'Bearbeitet nur flache Bereiche (Neigung bis zum Grenzwinkel) – exakt auf ihrer Höhe.'));
      stockSec(false);
      break;
    case 'ramp3d':
      put('passes', dirRow(), h('p', { class: 'hint' }, 'Wie 3D-Kontur, aber das Werkzeug fährt ohne Absätze kontinuierlich nach unten – keine Eintauchmarken an steilen Wänden.'));
      depthSec('Max. Tiefenzustellung', '0.5');
      stockSec(false);
      break;
    case 'pencil3d':
      put('passes', row('Min. Knickwinkel', num(op.pencilAngle ?? 20, v => ed(x => (x.pencilAngle = v)), { unit: '°', min: 2 })),
        h('p', { class: 'hint' }, 'Eine Bahn entlang jeder Innenecke/Hohlkehle, in der das Werkzeug zwei Flächen zugleich berührt – zum Ausräumen nach dem Schlichten.'));
      stockSec(false);
      break;
    case 'morphspiral3d':
      put('passes', N('Bahnabstand', 'stepoverMm', { min: 0.01 }), h('p', { class: 'hint' }, 'Spirale, die nach außen die Form der Begrenzung annimmt (Rohteil oder Silhouette) – für nicht runde Teile ohne Richtungswechsel.'));
      stockSec(false);
      break;
    case 'blend3d':
    case 'guidemorph3d':
    case 'geodesic3d':
      put('passes', N('Bahnabstand', 'stepoverMm', { min: 0.01 }));
      stockSec(false);
      break;
    case 'corner3d':
      put('passes', row('Referenzwerkzeug', sel([['', 'Nur Durchmesser (Form wie dieses Werkzeug)'], ...p.cam.tools.filter(x => ['ball', 'flat'].includes(toolBase(x)) && x.id !== op.tool).map(x => [x.id, toolLabel(x)])], op.restTool || '', v => ed(x => (x.restTool = v || undefined)))),
        op.restTool ? null : N('Referenzwerkzeug-Ø', 'restDia', { min: 0.1 }), N('Bahnabstand (flach)', 'stepoverMm', { min: 0.01 }), N('Zustellung Z (steil)', 'stepdown', { min: 0.01, allowEmpty: true, ph: 'Bahnabstand' }),
        row('Grenzwinkel', num(op.slope ?? 45, v => ed(x => (x.slope = v)), { unit: '°', min: 1 })), row('Bahnwinkel', num(op.angle || 0, v => ed(x => (x.angle = v)), { unit: '°' })),
        h('p', { class: 'hint' }, 'Nur dort, wo das Referenzwerkzeug nicht hinkam: flache Bereiche parallel, steile Bereiche als Wasserlinie. Mit einem Werkzeug aus der Liste zählt dessen Form mit – zum Beispiel was ein Torusfräser in den Hohlkehlen stehen lässt.'));
      stockSec(false);
      break;
    case 'flow3d':
      put('passes', N('Bahnabstand', 'stepoverMm', { min: 0.01 }), C('Quer zur Hauptrichtung', 'flowAcross'),
        h('p', { class: 'hint' }, 'Bahnen laufen entlang der Hauptrichtung der gewählten Flächen und bleiben in ihrem Umriss.'));
      stockSec(false);
      break;
    case 'morph3d':
      put('passes', N('Bahnabstand', 'stepoverMm', { min: 0.01 }), C('Von innen nach außen', 'morphOutward'),
        h('p', { class: 'hint' }, 'Bahnen folgen dem Rand der gewählten Flächen und laufen zur Mitte hin zusammen.'));
      stockSec(false);
      break;
    case 'deburr3d':
      put('passes', N('Entgrattiefe', 'depth', { min: 0.01 }), row('Min. Kantenwinkel', num(op.edgeAngle ?? 30, v => ed(x => (x.edgeAngle = v)), { unit: '°', min: 5 })),
        h('p', { class: 'hint' }, 'Fährt alle scharfen Außenkanten ab, die von oben erreichbar sind, und bricht sie um die Entgrattiefe – mit dem Fasenfräser als Fase (Werkzeugachse senkrecht, Spitze außerhalb der Kante), mit dem Kugel-/Lollipop-Fräser gerundet.'));
      break;
    case 'tface':
      put('passes', N('Zustellung Z', 'stepdown', { ph: '0.5' }), N('Aufmaß', 'stockToLeave'));
      break;
    case 'trough':
      put('passes', N('Schnitttiefe (radial)', 'stepdown', { ph: '1.5' }), N('Aufmaß', 'stockToLeave'), N('Ende Z (Futterseite)', 'zEnd', { allowEmpty: true, ph: 'Teilunterkante' }),
        C('Als Steuerungszyklus ausgeben', 'ctrlCycle'),
        op.ctrlCycle ? h('p', { class: 'hint' }, r?.turnCycle ? `Kontur mit ${r.turnCycle.pts.length} Punkten – Okuma: G85 (LAP) mit Kontur G81…G80, Fanuc: G71 P…Q…. Die Steuerung schruppt mit ihrer eigenen Aufteilung; die Simulation hier ist die WerkFab-Bahn.` : r?.turnCycleWhy ? `⚠ ${r.turnCycleWhy} – wird als Bahn ausgegeben.` : 'Außenkonturen, die zur Futterseite stetig ansteigen, gehen als Schruppzyklus der Steuerung (Okuma G85, Fanuc G71).') : null);
      break;
    case 'tfinish':
      put('passes', N('Ende Z', 'zEnd', { allowEmpty: true, ph: 'Teilunterkante' }), N('Aufmaß', 'stockToLeave'),
        C('Als Steuerungszyklus ausgeben', 'ctrlCycle'),
        op.ctrlCycle ? h('p', { class: 'hint' }, 'Schlichtet entlang der Kontur des Schruppzyklus davor – Okuma: G87 (LAP), Fanuc: G70 P…Q…. Voraussetzung: Längsschruppen davor als Steuerungszyklus, gleiche Schneide (Schneidenradius) und gleiches Ende Z; sonst wird die Bahn ausgegeben. Vorschub: F im ersten Konturblock.') : null);
      break;
    case 'tgroove':
      put('passes', N('Position Z (Mitte)', 'z'), N('Breite', 'width', { min: 0.1 }), N('Grund-Ø', 'dia', { allowEmpty: true, ph: 'aus Kontur' }));
      break;
    case 'tthread':
      put('passes', N('Start Z', 'zStart'), N('Ende Z', 'zEnd'), N('Nenn-Ø', 'majorDia', { allowEmpty: true, ph: 'aus Kontur' }), N('Steigung', 'pitch', { min: 0.1 }), N('Durchgänge', 'passes', { unit: null, min: 1, int: true }),
        h('p', { class: 'hint' }, 'ISO metrisch. Außengewinde (Tiefe 0,6134 × P) oder mit einem Innenwerkzeug Innengewinde (vom Kern-Ø D − 1,0825 × P bis zum Nenn-Ø). Ausgabe G32/G33.'),
        C('Als Steuerungszyklus ausgeben', 'ctrlCycle'),
        op.ctrlCycle ? h('p', { class: 'hint' }, 'Gewinde als ein Zyklus-Satz: Okuma G71 (gerade Zustellung B0, Gewindetiefe H, erste Zustellung D), Fanuc G76 (Flankenzustellung 60°).') : null);
      break;
    case 'tpart':
      put('passes', N('Position Z', 'z', { allowEmpty: true, ph: 'Teilunterkante' }));
      break;
    case 'tdrill':
      put('passes', N('Ende Z (Spitze)', 'zEnd', { allowEmpty: true, ph: 'aus Bohrung' }), N('Entspantiefe', 'peck', { allowEmpty: true, ph: '0 = ohne' }), N('Aufmaß', 'stockToLeave'),
        h('p', { class: 'hint' }, 'Bohrt auf der Drehachse von der Planfläche aus. Ohne Ende Z so tief, wie Bohrerspitze und Schaft in der Bohrung des Modells bleiben.'));
      break;
    case 'tlive': {
      const rad = op.dir === 'radial';
      put('passes',
        row('Richtung', sel([['axial', 'Axial – in die Planfläche (Z)'], ['radial', 'Radial – in den Durchmesser (X)']], op.dir || 'axial', v => ed(x => (x.dir = v)))),
        rad ? N('Position Z', 'z', { allowEmpty: true }) : N('Lochkreis-Ø', 'pitchDia', { min: 0.1, allowEmpty: true }),
        N('Anzahl', 'count', { unit: null, min: 1, int: true }), N('Startwinkel C', 'startAngle', { unit: '°' }),
        row('Winkel einzeln', txt(op.angles || '', v => ed(x => (x.angles = v)))),
        N('Bohrtiefe (Spitze)', 'depth', { min: 0.1 }), N('Entspantiefe', 'peck', { allowEmpty: true, ph: '0 = ohne' }),
        h('div', { class: 'btns' }, btn('Bohrungen aus dem Modell übernehmen', () => {
          const f = liveHolesFromModel(t?.dia, op.dir || 'axial');
          if (!f) return status(`Keine ${rad ? 'Querbohrungen (radial zur Drehachse)' : 'Bohrungen parallel zur Drehachse'} im Modell gefunden.`);
          ed(x => Object.assign(x, f.set));
          status(`${f.n} Bohrung${f.n > 1 ? 'en' : ''} Ø${f2(f.dia)} übernommen${Math.abs(f.dia - (+t?.dia || 0)) > 0.01 ? ` – Werkzeug hat Ø${f2(+t?.dia || 0)}` : ''}`);
        })),
        h('p', { class: 'hint' }, `Bohren mit angetriebenem Werkzeug; die Hauptspindel positioniert das Teil als C-Achse. ${rad ? 'Radial: Bohrer entlang X in den Durchmesser bei „Position Z“ (Modell-Z).' : 'Axial: Bohrer entlang Z in die Planfläche, außermittig auf dem Lochkreis.'} „Winkel einzeln“ (z. B. 0; 90; 200) ersetzt Anzahl und Startwinkel. Tiefe ab ${rad ? 'Außendurchmesser' : 'Planfläche'}.`));
      break;
    }
    case 'tpocket':
      put('passes',
        row('Skizze', sel([['', '– wählen –'], ...sketchOptions()], op.sketch || '', v => ed(x => { x.sketch = v; x.entities = 'all'; }))),
        N('Tiefe', 'depth', { min: 0.01 }), N('Zustellung in Z', 'stepdown', { allowEmpty: true, ph: 'Fräserradius' }),
        row('Bahnabstand', num(op.stepover != null ? Math.round(op.stepover * 100) : null, v => ed(x => (x.stepover = v == null ? null : Math.max(0.05, Math.min(0.95, v / 100)))), { unit: '% vom Ø', allowEmpty: true, ph: '45', min: 5 })),
        N('Aufmaß', 'stockToLeave'), N('Rampenwinkel', 'ramp', { unit: '°', allowEmpty: true, ph: '3' }),
        h('p', { class: 'hint' }, 'Tasche in der Planfläche aus den geschlossenen Konturen einer Skizze (innere Konturen bleiben als Inseln stehen), mit einem angetriebenen Schaftfräser entlang Z. Geräumt wird von innen nach außen; der Fräser taucht auf einer Rampe entlang der innersten Bahn ein und bleibt innerhalb einer Ebene unten. X und C fahren gemeinsam (Fanuc: Polar-Interpolation G12.1). Tiefe ab Planfläche.'));
      break;
    case 'tcontour':
    case 'twrap': {
      const wrap = op.type === 'twrap';
      put('passes',
        row('Skizze', sel([['', '– wählen –'], ...sketchOptions()], op.sketch || '', v => ed(x => { x.sketch = v; x.entities = 'all'; }))),
        row('Fräser läuft', sel([['on', 'Auf der Kurve (Nutbreite = Fräser-Ø)'], ['inside', 'Innen an der Kontur'], ['outside', 'Außen an der Kontur']], op.side || 'on', v => ed(x => (x.side = v)))),
        N('Tiefe', 'depth', { min: 0.01 }), N(wrap ? 'Zustellung (radial)' : 'Zustellung in Z', 'stepdown', { allowEmpty: true, ph: wrap ? 'Fräserradius' : 'ganze Tiefe' }),
        op.side && op.side !== 'on' ? N('Aufmaß', 'stockToLeave') : null,
        wrap ? N('Abwickel-Ø', 'wrapDia', { allowEmpty: true, ph: 'Außendurchmesser' }) : null,
        h('p', { class: 'hint' }, wrap
          ? 'Kurven einer Skizze, die längs zur Drehachse liegt, werden auf den Umfang gewickelt und mit einem angetriebenen Fräser gefräst, der zur Achse zeigt (Z und C fahren gemeinsam; Fanuc: Zylinder-Interpolation G7.1). Die Skizzenebene bestimmt den Winkel, an dem die Kontur sitzt; waagerechte Strecken in der Skizze werden Bögen um das Teil. Tiefe ab Außendurchmesser.'
          : 'Kurven einer Skizze auf der Planfläche (quer zur Drehachse) mit einem angetriebenen Fräser entlang Z (X und C fahren gemeinsam; Fanuc: Polar-Interpolation G12.1). Offene Kurven werden hin und zurück gefräst. Tiefe ab Planfläche.'));
      break;
    }
    case 'tslot':
      put('passes', N('Start Z', 'zStart', { allowEmpty: true }), N('Ende Z', 'zEnd', { allowEmpty: true }), N('Nuttiefe', 'depth', { min: 0.05 }),
        N('Anzahl', 'count', { unit: null, min: 1, int: true }), N('Startwinkel C', 'startAngle', { unit: '°' }),
        row('Winkel einzeln', txt(op.angles || '', v => ed(x => (x.angles = v)))),
        N('Zustellung (radial)', 'stepdown', { allowEmpty: true, ph: 'Fräserradius' }),
        h('p', { class: 'hint' }, 'Nut längs der Drehachse (z. B. Passfedernut) mit einem angetriebenen Fräser, der zur Achse zeigt; die Hauptspindel hält das Teil als C-Achse. Nutbreite = Fräser-Ø. Start/Ende Z in Modell-Z; reicht die Nut bis zur Planfläche, fährt der Fräser von vorn ein, sonst taucht er am Start ein. Tiefe ab Außendurchmesser.'));
      break;
    case 'tflat':
      put('passes', N('Schlüsselweite', 'width', { min: 0.1, allowEmpty: true }), N('Länge ab Planfläche', 'length', { min: 0.1 }),
        N('Anzahl Flächen', 'count', { unit: null, min: 1, int: true }), N('Startwinkel C', 'startAngle', { unit: '°' }),
        row('Winkel einzeln', txt(op.angles || '', v => ed(x => (x.angles = v)))),
        N('Zustellung radial', 'stepover', { allowEmpty: true, ph: '0,4 × Ø' }), N('Zustellung in Z', 'stepdown', { allowEmpty: true, ph: 'ganze Länge' }),
        h('p', { class: 'hint' }, 'Flächen am Teilende (Zweiflach, Vierkant, Sechskant) mit einem angetriebenen Schaftfräser entlang Z. Schlüsselweite = doppelter Abstand der Fläche von der Drehachse. X und C fahren gemeinsam (Polar-Interpolation, Fanuc G12.1); ohne diese Vorlage im Postprozessor werden kurze X/C-Schritte ausgegeben.'));
      break;
    case 'tbore':
      put('passes', N('Schnitttiefe (radial)', 'stepdown', { ph: '1' }), N('Aufmaß', 'stockToLeave'), N('Ende Z', 'zEnd', { allowEmpty: true, ph: 'Bohrungsgrund' }), N('Vorbohr-Ø', 'startDia', { allowEmpty: true, ph: 'aus Bohren' }),
        h('p', { class: 'hint' }, 'Schruppt die Bohrung von der Vorbohrung nach außen (0,2 mm Schlichtaufmaß) und schlichtet sie dann bis zum Grund. Die Bohrstange muss in die Vorbohrung passen.'));
      break;
    case 'contour3d':
      put('passes', dirRow());
      depthSec('Max. Tiefenzustellung', '0.5');
      stockSec(false);
      break;
    case 'horizontal3d':
      put('passes', dirRow(), stepoverPct('Bahnabstand'));
      stockSec(false);
      break;
    case 'rotaryRough':
      put('passes', N('Zustellung (radial)', 'stepdown', { min: 0.1 }), N('Bahnabstand (je Umdrehung)', 'stepoverMm', { min: 0.01 }), N('Winkelschritt', 'angleStep', { unit: '°', min: 0.2, ph: '4' }),
        N('Start X', 'xStart', { allowEmpty: true, ph: 'Rohteil' }), N('Ende X', 'xEnd', { allowEmpty: true, ph: 'Rohteil' }), N('Aufmaß', 'stockToLeave'),
        h('p', { class: 'hint' }, 'Schruppt simultan 4-achsig von außen nach innen: je Zustellung eine Spirale um die A-Achse (abwechselnd in +X und −X), nie tiefer als das Teil plus Aufmaß. Mit Schaft- oder Kugelfräser.'));
      break;
    case 'rotaryWrap':
      put('passes', N('Tiefe unter der Oberfläche', 'depth', { min: 0.01 }), N('Max. Tiefenzustellung', 'stepdown', { allowEmpty: true, ph: 'Tiefe in einem Zug' }),
        N('Abwicklungs-Ø', 'wrapDia', { allowEmpty: true, ph: 'Teil unter den Kurven' }),
        h('p', { class: 'hint' }, 'Wickelt die Skizzenkurven auf den Zylinder: X bleibt X, der Abstand quer zur Achse wird zum Bogen auf dem Abwicklungs-Ø (Drehung A). Die Skizze muss parallel zur A-Achse liegen, z. B. auf einer Tangentialebene. Gefräst wird in fester Tiefe unter der Teiloberfläche – für Gravuren, Schriften und Nuten rund um das Teil.'));
      break;
    case 'rotary':
      put('passes', row('Muster', sel([['helix', 'Spirale (eine Umdrehung je Bahnabstand)'], ['line', 'Linien längs der Achse']], op.pattern || 'helix', v => ed(x => (x.pattern = v)))),
        N('Bahnabstand', 'stepoverMm', { min: 0.01 }), N('Winkelschritt', 'angleStep', { unit: '°', min: 0.2, ph: '3' }),
        N('Start X', 'xStart', { allowEmpty: true, ph: 'Rohteil' }), N('Ende X', 'xEnd', { allowEmpty: true, ph: 'Rohteil' }), N('Aufmaß', 'stockToLeave'),
        h('p', { class: 'hint' }, 'Simultan 4-achsig: Drehachse A entlang X durch die Rohteilmitte (Zylinder-Rohteil: dessen Achse). Der Kugelfräser steht radial zur Achse, A dreht das Teil. Nullpunkt Y/Z auf die Achse legen; nach der Bearbeitung fährt A auf ein Vielfaches von 360°.'));
      break;
    case 'steep3d':
      put('passes', row('Grenzwinkel', num(op.slope ?? 45, v => ed(x => (x.slope = v)), { unit: '°', min: 1 })), N('Bahnabstand (flach)', 'stepoverMm', { min: 0.01 }));
      depthSec('Zustellung Z (steil)', '0.5');
      stockSec(false);
      break;
    case 'scallop3d':
    case 'spiral3d':
    case 'radial3d':
      put('passes', N('Bahnabstand', 'stepoverMm', { min: 0.01 }));
      stockSec(false);
      break;
    case 'project3d':
      put('passes', N('Tiefe unter Fläche', 'depth', { min: 0.01 }));
      break;
    case 'slot': {
      const troch = op.slotStyle === 'trochoid';
      put('passes', row('Strategie', sel([['line', 'Mittellinie (Vollschnitt)'], ['trochoid', 'Wirbelfräsen (trochoidal)']], op.slotStyle || 'line', v => ed(x => (x.slotStyle = v)))));
      if (troch) put('passes',
        N('Vorschub je Kreis', 'trochoidStep', { allowEmpty: true, ph: t ? `${f2(t.dia * 0.1)} (10 % Ø)` : '', min: 0.01 }),
        N('Nutbreite bei Linien', 'slotWidth', { allowEmpty: true, ph: 'Langloch: aus der Skizze', min: 0 }),
        dirRow(), C('Wand am Grund schlichten', 'slotFinish', true),
        h('p', { class: 'hint' }, 'Das Werkzeug fräst in Kreisen, deren Mitte entlang der Nut wandert. Es ist nie über die volle Breite im Eingriff – das erlaubt große Zustelltiefen und schont Fräser und Spindel. Der Fräser sollte etwa 60 % der Nutbreite haben.'));
      depthSec();
      stockSec(false);
      break;
    }
    case 'plunge3d':
      put('passes', N('Abstand in der Reihe', 'stepoverMm', { min: 0.05 }),
        N('Reihenabstand', 'rowStep', { allowEmpty: true, ph: t ? `${f2(t.dia * 0.7)} (70 % Ø)` : '', min: 0.05 }),
        row('Richtung der Reihen', num(op.angle || 0, v => ed(x => (x.angle = v)), { unit: '°' })),
        N('Abheben vor dem Rückzug', 'pullBack', { min: 0 }),
        N('Kleinste Tauchtiefe', 'minPlunge', { allowEmpty: true, ph: '0,3', min: 0.05 }),
        C('Vorige Operationen berücksichtigen', 'usePrior', true),
        r?.plungesSaved ? h('p', { class: 'hint' }, `${r.plungesSaved} Tauchgänge entfallen, weil dort schon gefräst ist.`) : null,
        h('p', { class: 'hint' }, `Das Werkzeug taucht wie ein Bohrer senkrecht ein, Reihe für Reihe, bis auf das Modell plus Aufmaß. Die Schnittkraft wirkt entlang der Spindel: geeignet für lange Werkzeuge, tiefe Kavitäten und wenig steife Maschinen. Das Werkzeug muss über die Mitte schneiden.${r?.plunges ? ` Hier: ${r.plunges} Tauchgänge.` : ''}`));
      stockSec(false);
      break;
    case 'circular':
      put('passes', stepoverPct());
      holeOrderRow();
      depthSec();
      stockSec(false);
      break;
    case 'vcarve':
      put('passes', N('Max. Tiefe', 'maxDepth', { min: 0.01 }), N('Auflösung', 'stepoverMm', { min: 0.02 }),
        hh ? h('div', { class: 'stats' }, h('span', null, 'Oberfläche'), h('b', null, `Z ${f2(hh.edge)}`)) : null);
      break;
    case 'parallel3d':
      put('passes', N('Bahnabstand', 'stepoverMm', { min: 0.01 }), row('Richtung', sel([['0', 'Entlang X'], ['90', 'Entlang Y']], String(op.angle || 0), v => ed(x => (x.angle = +v)))));
      stockSec(false);
      break;
  }

  // ===== Eckenfreistich =====
  if (op.type === 'pocket' || op.type === 'contour') {
    const db = op.dogbone && op.dogbone !== 'none' ? op.dogbone : 'none';
    put('passes', csec('Eckenfreistich (Dogbone)', db !== 'none', v => ed(x => (x.dogbone = v ? 'dogbone' : 'none'))));
    if (db !== 'none') put('passes',
      row('Form', sel([['dogbone', 'Dogbone (diagonal in die Ecke)'], ['tbone', 'T-Bone (entlang der Wand)']], db, v => ed(x => (x.dogbone = v)))),
      h('p', { class: 'hint' }, `Ein runder Fräser lässt in jeder Innenecke seinen Radius stehen – ein eckiges Gegenstück passt dann nicht hinein. Der Freistich fährt an jeder scharfen Innenecke kurz in die Ecke und zurück.${r?.dogbones ? ` Hier: ${r.dogbones} Ecken.` : ''}${op.compType && op.compType !== 'computer' && op.type === 'contour' ? ' Nur mit Korrektur „Im Rechner“.' : ''}`));
  }

  // ===== Vorschubanpassung und Bahnmuster =====
  if (milling && !op.type.startsWith('rotary')) {
    if (!['drill', 'plunge3d'].includes(op.type)) {
      put('passes', csec('Vorschubanpassung in Ecken', !!op.feedOpt, v => ed(x => (x.feedOpt = v))));
      if (op.feedOpt) put('passes',
        row('Ab Richtungsänderung', num(op.feedOptAngle ?? 25, v => ed(x => (x.feedOptAngle = v)), { unit: '°', min: 1 })),
        row('Reduzierter Vorschub', num(op.feedOptPct ?? 50, v => ed(x => (x.feedOptPct = v)), { unit: '%', min: 5 })),
        N('Strecke vor und nach der Ecke', 'feedOptDist', { allowEmpty: true, ph: t ? `${f2(t.dia / 2)} (Werkzeugradius)` : '', min: 0.01 }),
        h('p', { class: 'hint' }, `An scharfen Richtungswechseln umschlingt das Material den Fräser stärker. Dort fährt das Werkzeug langsamer.${r?.feedOpt ? ` Hier: ${r.feedOpt.corners} Ecken.` : ''}`));
    }
    const pk = op.patKind && op.patKind !== 'none' ? op.patKind : 'none';
    const PN = (label, key, def, opt = {}) => row(label, num(op[key] ?? def, v => ed(x => (x[key] = v)), opt));
    put('passes', csec('Bahnmuster', pk !== 'none', v => ed(x => { x.patKind = v ? 'linear' : 'none'; if (v) { x.patN1 ||= 2; x.patDx1 ??= 50; } })));
    if (pk !== 'none') {
      put('passes', row('Art', sel(Object.entries(PATTERN_KINDS).filter(([k]) => k !== 'none'), pk, v => ed(x => (x.patKind = v)))));
      if (pk === 'linear') put('passes',
        PN('Anzahl Richtung 1', 'patN1', 2, { min: 1 }), PN('Abstand X', 'patDx1', 0, { unit: 'mm' }), PN('Abstand Y', 'patDy1', 0, { unit: 'mm' }),
        PN('Anzahl Richtung 2', 'patN2', 1, { min: 1 }), PN('Abstand X (Richtung 2)', 'patDx2', 0, { unit: 'mm' }), PN('Abstand Y (Richtung 2)', 'patDy2', 0, { unit: 'mm' }));
      if (pk === 'circular') put('passes',
        PN('Anzahl', 'patN1', 2, { min: 1 }), PN('Gesamtwinkel', 'patAngle', 360, { unit: '°' }),
        PN('Mitte X', 'patCx', 0, { unit: 'mm' }), PN('Mitte Y', 'patCy', 0, { unit: 'mm' }));
      if (pk === 'mirror') put('passes',
        row('Spiegelachse', sel([['x', 'Linie parallel zu Y (bei X)'], ['y', 'Linie parallel zu X (bei Y)']], op.patAxis || 'x', v => ed(x => (x.patAxis = v)))),
        (op.patAxis || 'x') === 'x' ? PN('Lage der Achse X', 'patCx', 0, { unit: 'mm' }) : PN('Lage der Achse Y', 'patCy', 0, { unit: 'mm' }),
        C('Original mitfräsen', 'patKeepFirst', true),
        h('p', { class: 'hint' }, 'Im Spiegelbild läuft das Werkzeug andersherum: aus Gleichlauf wird dort Gegenlauf. Die Radiuskorrektur der Steuerung wechselt die Seite mit.'));
      put('passes', h('p', { class: 'hint' }, `Die fertige Bahn wird an den weiteren Stellen wiederholt (Maße ab Werkstück-Nullpunkt). Das Modell und das Rohteil müssen dort Material haben – die Simulation zeigt es.${r?.pattern ? ` Hier: ${r.pattern.n}-mal.` : ''}`));
    }
  }

  // ===== Verknüpfung =====
  if (milling && op.type !== 'drill') {
    const rm = op.rapidMode || 'preserve';
    put('link', sec('Anfahr-Wegfahrbewegungen'),
      row('Schnellvorschub-Modus', sel(RAPID_MODES, rm, v => ed(x => (x.rapidMode = v)))),
      rm !== 'preserve' || op.rapidRetract === false ? row('Hoher Vorschub', num(op.highFeed ?? 5000, v => ed(x => (x.highFeed = v)), { unit: 'mm/min', min: 1 })) : null,
      row('Rückzugsrichtlinie', sel([['full', 'Vollständiger Rückzug'], ['minimal', 'Minimaler Rückzug'], ['stock', 'Kürzester sicherer Weg (über dem Restmaterial)']], op.retractPolicy || 'full', v => ed(x => (x.retractPolicy = v)))),
      op.retractPolicy === 'stock' ? h('p', { class: 'hint' }, `Zwischen zwei Schnitten hebt das Werkzeug nur so weit ab, wie das Material auf dem Weg es verlangt (Rohteil abzüglich allem, was dieses Setup bis dahin gefräst hat) plus Sicherheitsabstand – und beginnt den Vorschub erst dort.${r?.shortLinks ? ` Hier: ${r.shortLinks.n} Wege verkürzt.` : ''}${setup.fixtures?.length ? ' In diesem Setup sind Spannmittel gewählt: dann bleibt es beim vollständigen Rückzug.' : ''}`) : null,
      C('Eilgangrückzug zulassen', 'rapidRetract', true),
      row('Sicherheitsabstand', num(op.safeDist ?? 1, v => ed(x => (x.safeDist = v)), { unit: 'mm', min: 0 })),
      C('Werkzeug unten halten', 'keepDown'),
      op.keepDown ? N('Maximaler Halteabstand', 'keepDownDist', { allowEmpty: true, ph: t ? `${f2(t.dia)} (Werkzeug-Ø)` : '', min: 0 }) : null,
      row('Abhebhöhe', num(op.liftHeight ?? 0, v => ed(x => (x.liftHeight = v)), { unit: 'mm', min: 0 })),
      op.keepDown ? h('p', { class: 'hint' }, 'Kurze Wege (bis zum Halteabstand) fährt das Werkzeug unten im Übergangsvorschub statt über die Rückzugshöhe – ohne Kollisionsprüfung, daher klein halten.') : null);
    if (contourish) {
      const li = op.leadInOn ?? (+op.leadIn > 0);
      const lo = op.leadOutOn ?? true;
      const same = op.leadOutSame !== false;
      put('link', sec('Ein-/Ausfahrten und Übergänge'),
        C('Einfahrt', 'leadInOn', li, (x, v) => { if (v && !(+x.leadIn > 0)) x.leadIn = +(Math.max(1, (t?.dia || 4) * 0.25)).toFixed(2); }));
      if (li) put('link', N('Horizontaler Einfahrradius', 'leadIn', { min: 0 }), row('Sweeping-Einfahrwinkel', num(op.leadSweep ?? 90, v => ed(x => (x.leadSweep = v)), { unit: '°', min: 1 })),
        N('Linearer Einfahrabstand', 'leadLinear', { min: 0 }), C('Lotrecht', 'leadPerp'), op.type === 'contour' ? N('Vertikaler Einfahrradius', 'leadVert', { min: 0 }) : null);
      put('link', C('Ausfahrt', 'leadOutOn', lo));
      if (lo) put('link', C('Wie Einfahrt', 'leadOutSame', true));
      if (lo && !same) put('link', N('Horizontaler Ausfahrradius', 'leadOutR', { min: 0 }), row('Sweeping-Ausfahrwinkel', num(op.leadOutSweep ?? 90, v => ed(x => (x.leadOutSweep = v)), { unit: '°', min: 1 })),
        N('Linearer Ausfahrabstand', 'leadOutLinear', { min: 0 }), C('Lotrecht', 'leadOutPerp'));
    }
    if (['contour', 'pocket', 'rough3d', 'adaptive', 'adaptive3d', 'pocket3d'].includes(op.type)) {
      const helix = op.type === 'adaptive' || op.type === 'adaptive3d' || (op.type === 'rough3d' && op.strategy === 'adaptive');
      const on = helix || (op.rampType !== 'plunge' && +op.ramp > 0);
      put('link', csec('Materialeinfahrt', on, v => ed(x => { x.rampType = v ? 'profile' : 'plunge'; if (v && !(+x.ramp > 0)) x.ramp = 2; }), helix));
      if (on) put('link', row('Rampentyp', helix ? h('span', { class: 'hint' }, 'Helix') : sel([['profile', 'Profil (entlang der Bahn)'], ['plunge', 'Eintauchen']], op.rampType || 'profile', v => ed(x => (x.rampType = v)))),
        row(helix ? 'Helix-Rampenwinkel' : 'Rampenwinkel', num(op.ramp || (helix ? 2 : 0), v => ed(x => (x.ramp = v)), { unit: '°', min: helix ? 0.5 : 0 })));
    }
    if (contourish) {
      const picking = state.pick?.mode === 'oppoints' && state.pick.id === op.id;
      const n = (op.entryPts || []).length;
      put('link', sec('Positionen'),
        h('div', { class: 'gsel' }, h('span', null, 'Bevorzugte Einfahrpositionen'),
          h('button', { class: 'pickbtn' + (picking ? ' on' : ''), html: PICK_IC + (n ? ` ${n} Punkt${n > 1 ? 'e' : ''}` : ' Auswählen'), onclick: () => toggleOpPick('oppoints', op.id) }),
          n ? h('button', { class: 'gx', title: 'Punkte entfernen', onclick: () => ed(x => delete x.entryPts) }, '✕') : null));
    }
  }

  // tabs with content, then the active one
  const present = OP_TABS.filter(([k]) => T[k].length);
  const active = present.some(([k]) => k === tabState.op) ? tabState.op : present[0][0];
  b.append(h('div', { class: 'ptabs' }, ...present.map(([k, label, icon]) =>
    h('button', { class: 'ptab' + (k === active ? ' on' : ''), title: label, html: icon + `<span>${label}</span>`, onclick: () => { tabState.op = k; renderProps(); } }))));
  b.append(...T[active]);
  // result and the operation buttons stay visible on every tab
  b.append(sec('Ergebnis'));
  if (r?.error) b.append(h('p', { class: 'err' }, '⚠ ' + r.error));
  if (r?.warning) b.append(h('p', { class: 'warn' }, '⚠ ' + r.warning));
  else if (r && !r.disabled && !r.error) b.append(h('div', { class: 'stats' }, h('span', null, 'Bearbeitungszeit'), h('b', null, fmtTime(r.time)), h('span', null, 'Weg'), h('b', null, `${f2(r.length / 1000)} m`), h('span', null, 'Bewegungen'), h('b', null, r.moves.length)));
  b.append(h('div', { class: 'btns' },
    btn('↑', () => moveOp(op.id, -1)), btn('↓', () => moveOp(op.id, 1)),
    btn('Duplizieren', () => commit(pp => { const c = { ...JSON.parse(JSON.stringify(op)), id: uid('op'), name: nextName(pp.cam.ops, OP_TYPES[op.type]) }; pp.cam.ops.splice(pp.cam.ops.findIndex(o => o.id === op.id) + 1, 0, c); state.sel = { kind: 'op', id: c.id }; })),
    btn('Löschen', () => { commit(pp => (pp.cam.ops = pp.cam.ops.filter(o => o.id !== op.id))); state.sel = null; renderAll(); }, 'danger'),
  ));
}

// "Werkzeugwechsel sparen": operations with the same tool move together where that is safe
async function optimizeOpOrder() {
  const p = state.project, sid = activeSetupId(), g = getCam().setups.get(sid);
  if (!g) return status('Erst ein Setup mit Operationen anlegen.');
  const mine = p.cam.ops.filter(o => (o.setup || p.cam.setups[0].id) === sid);
  const items = mine.map(o => {
    const r = g.results.get(o.id), t = r?.tool;
    let box = null, cells;
    if (r?.moves?.length && t) {
      cells = opCells(r.moves, (+t.dia || 0) / 2);
      const R = (+t.dia || 0) / 2;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const m of r.moves) if (m.t !== 'r' && Number.isFinite(m.x)) { x0 = Math.min(x0, m.x); y0 = Math.min(y0, m.y); x1 = Math.max(x1, m.x); y1 = Math.max(y1, m.y); }
      if (Number.isFinite(x0)) box = [x0 - R, y0 - R, x1 + R, y1 + R];
    }
    // without a path (error, switched off) nobody knows where it works: it stays where it is
    return { id: o.id, tool: o.type === 'manual' ? null : o.tool, fixed: o.type === 'manual' || o.type === 'probe' || g.kind === 'turn' || !box, box, cells };
  });
  const res = orderByTool(items);
  if (res.after >= res.before) return status(`Die Reihenfolge ist schon günstig: ${res.before} Werkzeugwechsel, mehr lässt sich nicht sparen, ohne Operationen an derselben Stelle zu vertauschen.`);
  const names = res.order.map((id, i) => `${i + 1}. ${mine.find(o => o.id === id).name}`).join(' · ');
  const v = await formDialog('Werkzeugwechsel sparen', [{ key: 'hint', hint: `${res.before} → ${res.after} Werkzeugwechsel. Operationen, die an derselben Stelle arbeiten, bleiben in ihrer Reihenfolge; manuelle NC und Antasten bleiben, wo sie sind. Neue Reihenfolge: ${names}` }], 'Übernehmen');
  if (!v) return;
  commit(pp => {
    const byId = new Map(pp.cam.ops.map(o => [o.id, o])), slots = [];
    pp.cam.ops.forEach((o, i) => { if ((o.setup || pp.cam.setups[0].id) === sid) slots.push(i); });
    res.order.forEach((id, k) => { pp.cam.ops[slots[k]] = byId.get(id); });
  });
  status(`Reihenfolge geändert: ${res.before} → ${res.after} Werkzeugwechsel (mit Strg+Z rückgängig).`);
}

// Manual NC: a line in the program without a tool or a path
function propsManual(b, op, r, ed) {
  const p = state.project, k = op.manualKind in MANUAL_KINDS ? op.manualKind : 'comment';
  const HINT = {
    comment: 'Der Text steht als Kommentar an dieser Stelle im Programm.',
    stop: 'Die Maschine hält an (M0), zum Beispiel zum Umspannen oder Späne entfernen. Die nächste Operation schaltet Spindel und Kühlmittel wieder ein. Der Text steht als Kommentar davor.',
    optstop: 'Hält nur an, wenn an der Maschine „Wahlweiser Halt“ eingeschaltet ist (M1).',
    dwell: 'Die Maschine wartet die angegebene Zeit.',
    code: 'Die Zeilen werden unverändert ins Programm geschrieben und nicht geprüft. Sie müssen zur Steuerung passen; Simulation und Kollisionsprüfung kennen sie nicht.',
    message: 'Meldung auf dem Bildschirm der Steuerung: Fanuc und LinuxCNC als (MSG, …), Sinumerik als MSG("…"), sonst als Kommentar.',
  };
  const area = h('textarea', { class: 'manual-text no-i18n', rows: k === 'code' ? 6 : 3, spellcheck: false, placeholder: k === 'code' ? 'M…' : '' });
  area.value = op.manualText || '';
  area.addEventListener('change', () => ed(x => (x.manualText = area.value)));
  const kids = [
    sec('Manuelle NC'),
    row('Art', sel(Object.entries(MANUAL_KINDS), k, v => ed(x => (x.manualKind = v)))),
    k === 'dwell' ? row('Verweilzeit', num(op.manualSec ?? 1, v => ed(x => (x.manualSec = v)), { unit: 's', min: 0 })) : null,
    k === 'dwell' || k === 'optstop' ? null : h('div', { class: 'hint' }, k === 'code' ? 'NC-Code' : k === 'stop' ? 'Hinweis für den Bediener (optional)' : 'Text'),
    k === 'dwell' || k === 'optstop' ? null : area,
    h('p', { class: 'hint' }, HINT[k]),
    sec('Allgemein'),
    row('Name', txt(op.name, v => ed(x => (x.name = v)))),
    row('Aktiv', chk(op.enabled !== false, v => ed(x => (x.enabled = v)))),
    row('Setup', sel(p.cam.setups.map(x => [x.id, x.name]), op.setup, v => ed(x => (x.setup = v)))),
    r?.error ? h('p', { class: 'err' }, '⚠ ' + r.error) : null,
    h('div', { class: 'btns' },
      btn('↑', () => moveOp(op.id, -1)), btn('↓', () => moveOp(op.id, 1)),
      btn('Duplizieren', () => commit(pp => { const c = { ...JSON.parse(JSON.stringify(op)), id: uid('op'), name: nextName(pp.cam.ops, OP_TYPES[op.type]) }; pp.cam.ops.splice(pp.cam.ops.findIndex(o => o.id === op.id) + 1, 0, c); state.sel = { kind: 'op', id: c.id }; })),
      btn('Löschen', () => { commit(pp => (pp.cam.ops = pp.cam.ops.filter(o => o.id !== op.id))); state.sel = null; renderAll(); }, 'danger')),
  ];
  b.append(...kids.filter(Boolean));
}

// ----- Bohrungen erkennen: every hole of the model along the tool axis, grouped by diameter and kind -----
function findHoleGroups(st) {
  const m = getModel(), up = setupUp(st), TAU = 2 * Math.PI;
  let list = [];
  try { list = cylinderFaces(m.bodies); } catch { list = []; }
  // lowest point of the model along the tool axis (a hole that reaches it goes through)
  let low = Infinity;
  for (const b of m.bodies) {
    try { const [lo, hi] = b.shape.boundingBox.bounds; for (const x of [lo[0], hi[0]]) for (const y of [lo[1], hi[1]]) for (const z of [lo[2], hi[2]]) low = Math.min(low, new THREE.Vector3(x, y, z).dot(up)); } catch { /* no box */ }
  }
  const holes = [], studs = [];
  for (const c of list) {
    const into = c.outside ? studs : holes;
    const d = new THREE.Vector3(...c.dir);
    if (Math.abs(d.dot(up)) < 0.999) continue;
    const L = new THREE.Vector3(...c.loc);
    const h0 = L.clone().addScaledVector(d, c.t0).dot(up), h1 = L.clone().addScaledVector(d, c.t1).dot(up);
    const q = L.clone().addScaledVector(up, -L.dot(up));
    let o = into.find(x => x.q.distanceTo(q) < 1e-3 && Math.abs(x.r - c.r) < 1e-3 && Math.min(h0, h1) < x.top + 1e-3 && Math.max(h0, h1) > x.bottom - 1e-3);
    if (!o) into.push(o = { q, r: c.r, top: -Infinity, bottom: Infinity, span: 0, pt: c.pt });
    o.top = Math.max(o.top, h0, h1);
    o.bottom = Math.min(o.bottom, h0, h1);
    o.span += c.span ?? TAU;
  }
  const full = holes.filter(o => o.span >= TAU - 0.02 && o.top - o.bottom > 0.05);
  // stacks on one axis: the narrowest part is drilled, wider parts above it are counterbores
  const groups = new Map();
  for (const o of full) {
    const stack = full.filter(x => x.q.distanceTo(o.q) < 1e-3);
    o.entry = Math.max(...stack.map(x => x.top)); // where the tool meets the part: above a counterbore, not at its floor
    const cbore = stack.some(x => x.r < o.r - 1e-3 && x.top <= o.bottom + 1e-3);
    const through = !cbore && o.bottom <= low + 0.01;
    const th = cbore ? null : (m.threads || []).find(t => !t.outside && Math.abs(t.r - o.r) < 0.01 && new THREE.Vector3(...t.c).addScaledVector(up, -new THREE.Vector3(...t.c).dot(up)).distanceTo(o.q) < 0.01);
    const dia = +(2 * o.r).toFixed(3);
    const key = [cbore ? 'c' : 'd', dia, through ? 't' : 'b', th?.name || ''].join('|');
    const g = groups.get(key) || { key, kind: cbore ? 'cbore' : 'drill', dia, through, thread: th ? { name: th.name, P: th.P, dia: +(String(th.name).match(/M\s*(\d+(?:[.,]\d+)?)/)?.[1] || '').replace(',', '.') || +(dia + 1.0825 * th.P).toFixed(2) } : null, depth: 0, holes: [] };
    g.depth = Math.max(g.depth, o.top - o.bottom);
    g.holes.push(o);
    groups.set(key, g);
  }
  // studs with a thread: milled from the outside
  for (const o of studs.filter(x => x.span >= TAU - 0.02 && x.top - x.bottom > 0.05)) {
    const th = (m.threads || []).find(t => t.outside && Math.abs(t.r - o.r) < 0.01 && new THREE.Vector3(...t.c).addScaledVector(up, -new THREE.Vector3(...t.c).dot(up)).distanceTo(o.q) < 0.01);
    if (!th) continue;
    const dia = +(2 * o.r).toFixed(3), key = ['s', dia, th.name].join('|');
    const g = groups.get(key) || { key, kind: 'stud', dia, through: false, thread: { name: th.name, P: th.P, dia }, depth: 0, holes: [] };
    g.depth = Math.max(g.depth, o.top - o.bottom);
    g.holes.push(o);
    groups.set(key, g);
  }
  const rank = { drill: 0, cbore: 1, stud: 2 };
  return [...groups.values()].sort((a, b) => (a.kind === b.kind ? a.dia - b.dia : rank[a.kind] - rank[b.kind]));
}
function recognizeHoles() {
  const p = state.project, sid = activeSetupId(), st = p.cam.setups.find(x => x.id === sid);
  if (!st) return status('Erst ein Setup anlegen.');
  if (st.kind === 'turn') return status('Die Bohrungserkennung gibt es für Fräs-Setups.');
  if (getModel().box.isEmpty()) return status('Erst einen Körper in KONSTRUKTION erstellen.');
  const groups = findHoleGroups(st);
  if (!groups.length) return status(`Keine Bohrungen oder Gewindezapfen entlang der Werkzeugachse gefunden (Setup „${st.name}“).`);
  const machine = findMachine(p, st.machine), mk = st.stockMaterial || 'alu';
  const opt = { spot: true, tap: 'tap', cbore: true, chamfer: false, chamferW: 0.5 }, on = new Set(groups.map(g => g.key));
  // the edge around the mouth of a hole (where the tool enters), as an edge reference for the chamfer operation
  const mouthEdge = o => {
    const stack = groups.flatMap(g => g.holes).filter(x => x.q.distanceTo(o.q) < 1e-3), top = stack.reduce((a, x) => (x.top > a.top ? x : a), o);
    for (const b of getModel().bodies) {
      if (!b.shape?.wrapped) continue;
      for (const ed of b.shape.edges) {
        if (ed.geomType !== 'CIRCLE') continue;
        const m = ed.pointAt(0.5), v = new THREE.Vector3(m.x, m.y, m.z), hgt = v.dot(up);
        if (Math.abs(hgt - top.top) > 1e-3) continue;
        if (Math.abs(v.addScaledVector(up, -hgt).distanceTo(top.q) - top.r) < 1e-3) return { ref: [m.x, m.y, m.z].map(c => +c.toFixed(5)), top: top.top };
      }
    }
    return null;
  };
  const up = setupUp(st);
  // the steps of one group as { type, tool type, dia, ... } – the same form the material sets use
  const stepsOf = g => {
    if (g.kind === 'stud') return opt.tap !== 'none' ? [{ g, role: 'tout', type: 'thread', tool: 'thread', dia: 6, tol: 5 }] : [];
    if (g.kind === 'cbore') return opt.cbore ? [{ g, role: 'cbore', type: 'circular', tool: 'flat', dia: +(g.dia * 0.6).toFixed(1), tol: 0.34 }] : [];
    const out = [{ g, role: 'drill', type: 'drill', tool: 'drill', dia: g.dia, tol: 0.0015 }];
    if (g.thread && opt.tap === 'tap') out.push({ g, role: 'tap', type: 'drill', tool: 'tap', dia: g.thread.dia, tol: 0.0015 });
    // thread mill: clearly smaller than the core hole, so it can move in and circle
    if (g.thread && opt.tap === 'mill') out.push({ g, role: 'tmill', type: 'thread', tool: 'thread', dia: Math.max(1, Math.floor(g.dia * 0.7)), tol: 0.3 });
    return out;
  };
  const planNow = () => {
    const sel = groups.filter(g => on.has(g.key));
    const steps = [...(opt.spot && sel.some(g => g.kind === 'drill') ? [{ role: 'spot', type: 'drill', tool: 'spot', dia: 10, tol: 0.61 }] : []), ...sel.flatMap(stepsOf),
      ...(opt.chamfer && sel.some(g => g.kind === 'drill') ? [{ role: 'chamfer', type: 'chamfer', tool: 'chamfer', dia: 10, tol: 5 }] : [])];
    return { sel, plan: matSetPlan({ steps }, mk, machine) };
  };
  const w = modalWin('Bohrungen erkennen', 760);
  const draw = () => {
    const { plan } = planNow();
    const toolOf = (g, role) => plan.steps.find(s => s.stp.g === g && s.stp.role === role);
    const tl = s => (s ? h('td', { class: s.isNew ? 'new' : '' }, `${s.isNew ? 'neu: ' : ''}T${s.tool.number} ${s.tool.name}`) : h('td', null, '–'));
    w.body.replaceChildren(
      h('p', { class: 'hint' }, `Setup „${st.name}“: ${groups.reduce((a, g) => a + (g.kind === 'drill' ? g.holes.length : 0), 0)} Bohrungen entlang der Werkzeugachse gefunden. Für jede angehakte Zeile entsteht eine Operation; fehlende Werkzeuge werden angelegt.`),
      h('table', { class: 'hole-tbl' },
        h('tr', null, h('th', null, ''), h('th', null, 'Anzahl'), h('th', null, 'Ø'), h('th', null, 'Tiefe'), h('th', null, 'Art'), h('th', null, 'Werkzeug')),
        ...groups.map(g => h('tr', null,
          h('td', null, chk(on.has(g.key), v => { if (v) on.add(g.key); else on.delete(g.key); draw(); })),
          h('td', null, `${g.holes.length}×`), h('td', null, `Ø${String(f2(g.dia)).replace('.', ',')}`), h('td', null, `${String(f2(g.depth)).replace('.', ',')} mm`),
          h('td', null, g.kind === 'stud' ? `Zapfen · Außengewinde ${g.thread.name}` : g.kind === 'cbore' ? 'Senkung (Kreistasche)' : `${g.through ? 'Durchgangsbohrung' : 'Sackloch'}${g.thread ? ` · Gewinde ${g.thread.name}` : ''}`),
          !on.has(g.key) ? h('td', null, '–') : g.kind === 'cbore' ? tl(toolOf(g, 'cbore')) : h('td', { class: [toolOf(g, 'drill'), toolOf(g, 'tap'), toolOf(g, 'tmill'), toolOf(g, 'tout')].some(s => s?.isNew) ? 'new' : '' }, [toolOf(g, 'drill'), toolOf(g, 'tap'), toolOf(g, 'tmill'), toolOf(g, 'tout')].filter(Boolean).map(s => `${s.isNew ? 'neu: ' : ''}T${s.tool.number} ${s.tool.name}`).join(' + '))))),
      row('Vorher anbohren (NC-Anbohrer)', chk(opt.spot, v => { opt.spot = v; draw(); })),
      groups.some(g => g.thread) ? row('Gewinde', sel([['tap', 'Gewindebohren'], ['mill', 'Gewindefräsen'], ['none', 'Nicht schneiden']], opt.tap, v => { opt.tap = v; draw(); })) : '',
      groups.some(g => g.kind === 'cbore') ? row('Senkungen fräsen', chk(opt.cbore, v => { opt.cbore = v; draw(); })) : '',
      row('Bohrungen anfasen (Fasenfräser)', chk(opt.chamfer, v => { opt.chamfer = v; draw(); })),
      opt.chamfer ? row('Fasenbreite', num(opt.chamferW, v => { opt.chamferW = Math.max(0.05, v ?? 0.5); }, { unit: 'mm', min: 0.05 })) : '',
      h('p', { class: 'hint' }, 'Schnittdaten kommen aus dem Rechner für den Werkstoff des Setups. Tiefe Bohrungen (über 3 × Ø) bekommen Tieflochbohren mit Entspänen, Durchgangsbohrungen einen Überlauf für die Bohrerspitze.'));
  };
  const create = () => {
    const { sel, plan } = planNow();
    if (!plan.steps.length) return status('Keine Zeile angehakt.');
    const ops = [], names = [...p.cam.ops];
    const de = v => String(f2(v)).replace('.', ',');
    const unique = label => { let n = label, k = 2; while (names.some(o => o.name === n)) n = `${label} (${k++})`; return n; };
    const mkOp = (s, label, faces, extra = {}) => {
      const op = addOp(s.stp.type, { tool: s.tool, batch: true });
      if (!op) return null;
      Object.assign(op, { geomSource: 'model', faces: faces.map(o => o.pt.map(v => +(+v).toFixed(4))), sketch: '', name: unique(label) }, extra);
      op.cut = { rpm: s.c.rpm, feed: s.c.feed, plunge: s.c.plunge };
      if (mk !== st.stockMaterial) op.cutMat = mk;
      names.push(op); ops.push(op);
      return op;
    };
    for (const s of plan.steps) {
      const g = s.stp.g;
      if (s.stp.role === 'spot') {
        // one operation per height the holes start at; depth for a small chamfer on the hole
        const drilled = sel.filter(x => x.kind === 'drill').flatMap(x => x.holes);
        const tops = [...new Set(drilled.map(o => +o.entry.toFixed(3)))].sort((a, b) => b - a);
        for (const z of tops) {
          const hs = drilled.filter(o => +o.entry.toFixed(3) === z);
          const depth = Math.max(0.5, Math.min(s.tool.dia / 2 - 0.2, Math.max(...hs.map(o => o.r)) + 0.2));
          mkOp(s, 'Anbohren', hs, { heights: { top: { from: 'pick', z, offset: 0 }, bottom: { from: 'top', offset: -f2(depth) } } });
        }
      } else if (s.stp.role === 'drill') {
        const tip = 0.3 * g.dia;
        mkOp(s, `Bohren Ø${de(g.dia)}`, g.holes, { bottomOffset: g.through ? -f2(tip + 1) : 0, ...(g.depth > 3 * g.dia ? { cycle: 'peck', peck: f2(g.dia) } : {}) });
      } else if (s.stp.role === 'tap') {
        if (s.isNew) s.tool.pitch = g.thread.P;
        mkOp(s, `Gewinde ${g.thread.name}`, g.holes, { pitch: g.thread.P, cycle: 'tap', bottomOffset: g.through ? -f2(2 * g.thread.P) : f2(Math.max(1, 2 * g.thread.P)) });
      } else if (s.stp.role === 'chamfer') {
        // one operation per height the holes open at; the chamfer runs around the mouth of each hole
        const mouths = sel.filter(x => x.kind === 'drill').flatMap(x => x.holes).map(mouthEdge).filter(Boolean);
        for (const z of [...new Set(mouths.map(q => +q.top.toFixed(3)))].sort((a, b) => b - a)) {
          const op = mkOp(s, 'Bohrungen anfasen', [], { side: 'inside', width: f2(opt.chamferW), extraDepth: 0.2 });
          if (op) { op.faces = []; op.edges = mouths.filter(q => +q.top.toFixed(3) === z).map(q => q.ref); }
        }
      } else if (s.stp.role === 'tout') {
        mkOp(s, `Gewindefräsen außen ${g.thread.name}`, g.holes, { pitch: g.thread.P, majorDia: g.thread.dia, side: 'outside', hand: 'right' });
      } else if (s.stp.role === 'tmill') {
        if (s.isNew) { s.tool.pitch = g.thread.P; s.tool.name = `Gewindefräser Ø${de(s.tool.dia)} P${de(g.thread.P)}`; }
        mkOp(s, `Gewindefräsen ${g.thread.name}`, g.holes, { pitch: g.thread.P, majorDia: g.thread.dia, side: 'inside', hand: 'right', bottomOffset: g.through ? 0 : f2(Math.max(0.5, g.thread.P)) });
      } else if (s.stp.role === 'cbore') mkOp(s, `Senkung Ø${de(g.dia)}`, g.holes, {});
    }
    if (!ops.length) return;
    commit(pp => { pp.cam.tools.push(...plan.fresh); pp.cam.ops.push(...ops); });
    w.close();
    select('op', ops[0].id);
    status(`${ops.length} Operationen für ${sel.reduce((a, g) => a + g.holes.length, 0)} Bohrungen angelegt${plan.fresh.length ? `, ${plan.fresh.length} Werkzeug(e) neu (${plan.fresh.map(t => 'T' + t.number).join(', ')})` : ''}.`);
  };
  w.foot.append(h('span', { style: 'flex:1' }), btn('Abbrechen', w.close), btn('Operationen anlegen', create, 'primary'));
  draw();
}

// ---------- VERWALTEN (Formfräser, Volumenhalter, Bibliotheken, Task-Manager, Vorgaben) ----------
// a plain modal window with a body and buttons in the footer
function modalWin(title, width = 720) {
  const back = h('div', { class: 'modal-back' });
  const body = h('div', { class: 'mwin-body' });
  const foot = h('div', { class: 'modal-foot' });
  const close = () => back.remove();
  back.append(h('div', { class: 'modal mwin', style: `width:min(${width}px,calc(100vw - 32px))` }, h('div', { class: 'modal-head' }, title.toUpperCase(), h('button', { onclick: close }, '✕')), body, foot));
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.body.append(back);
  return { back, body, foot, close };
}

// ----- Formfräser: a tool whose cutting profile is a sketch (right half: X = radius, Y = height) -----
async function createFormTool() {
  const sks = state.project.features.filter(f => f.type === 'sketch' && f.entities.length);
  if (!sks.length) return status('Formfräser: zuerst in KONSTRUKTION eine Skizze mit dem Schneidenprofil zeichnen (rechte Hälfte, Werkzeugachse = Skizzen-Y-Achse, Spitze unten).');
  const v = await formDialog('Formfräser', [
    { key: 'sk', label: 'Profilskizze', value: sks.at(-1).id, options: sks.map(s => [s.id, s.name]) },
    { key: 'name', label: 'Name', value: 'Formfräser', text: true },
    { key: 'hint', hint: 'Die Skizze beschreibt die Schneidkante: X = Radius, Y = Höhe über der Spitze (die Y-Achse ist die Werkzeugachse). Gespiegelte Hälften werden zusammengefasst.' }], 'Erstellen');
  if (!v) return;
  const rsk = resolved().features.find(f => f.id === v.sk);
  const pts = [];
  for (const e of rsk.entities) for (const poly of entityPolys(e) || []) {
    for (let i = 0; i < poly.length; i++) {
      const a = poly[i], b = poly[(i + 1) % poly.length], n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.05));
      for (let k = 0; k < n; k++) pts.push([Math.abs(a[0] + ((b[0] - a[0]) * k) / n), a[1] + ((b[1] - a[1]) * k) / n]);
    }
  }
  if (pts.length < 3) return status('Formfräser: die Skizze enthält keine verwendbare Kontur.');
  const z0 = Math.min(...pts.map(p => p[1])), R = Math.max(...pts.map(p => p[0])), H = Math.max(...pts.map(p => p[1])) - z0;
  if (!(R > 0.05) || !(H > 0.05)) return status('Formfräser: Profil zu klein.');
  // lowest point of the cutting edge for each radius (what the drop-cutter needs)
  const NB = 120, bins = new Array(NB + 1).fill(Infinity);
  for (const [r, z] of pts) { const k = Math.round((r / R) * NB); bins[k] = Math.min(bins[k], z - z0); }
  let last = 0;
  for (let k = 0; k <= NB; k++) { if (Number.isFinite(bins[k])) last = bins[k]; else bins[k] = last; }
  const profile = bins.map((z, k) => [+((R * k) / NB).toFixed(4), +z.toFixed(4)]);
  // outline for drawings: the profile, then up the outside to the full height
  const profileDraw = [...profile.filter((_, k) => k % 4 === 0 || k === NB), [R, H]];
  const id = uid('T');
  commit(p => {
    const n = Math.max(0, ...p.cam.tools.map(x => +x.number || 0)) + 1;
    p.cam.tools.push({ id, number: n, name: v.name || 'Formfräser', type: 'form', dia: +(2 * R).toFixed(3), fluteLen: +H.toFixed(3), profile, profileDraw,
      flutes: 2, material: 'carbide', rpm: Math.min(24000, Math.round(150000 / (Math.PI * 2 * R))), feed: 600, plunge: 200, stepdown: +(Math.max(0.2, H / 4)).toFixed(2), stepover: 0.3 });
  });
  status(`Formfräser Ø${f2(2 * R)} × ${f2(H)} mm im Dokument angelegt`);
  openToolLibrary();
}

// ----- Volumenhalter: holder segments from a rotationally symmetric body (axis = Z, tool end at the bottom) -----
async function createHolderFromBody() {
  const bodies = getModel().bodies;
  if (!bodies.length) return status('Volumenhalter: zuerst den Halter als Körper modellieren oder importieren (Achse = Z, Werkzeugseite unten).');
  const v = await formDialog('Halter aus Volumenkörper', [
    { key: 'body', label: 'Körper', value: state.sel?.kind === 'body' ? state.sel.id : bodies[0].id, options: bodies.map(b => [b.id, b.name]) },
    { key: 'name', label: 'Name', value: 'Halter', text: true },
    { key: 'hint', hint: 'Der Körper wird um seine senkrechte Mittelachse abgetastet und als Halterkontur (Abschnitte) in der Dokument-Werkzeugbibliothek gespeichert.' }], 'Erstellen');
  if (!v) return;
  const b = bodies.find(x => x.id === v.body);
  const pos = b.geometry.attributes.position;
  b.geometry.computeBoundingBox();
  const bb = b.geometry.boundingBox, cx = (bb.min.x + bb.max.x) / 2, cy = (bb.min.y + bb.max.y) / 2, H = bb.max.z - bb.min.z;
  if (!(H > 0.5)) return status('Volumenhalter: Körper zu flach.');
  const NB = Math.min(60, Math.max(8, Math.round(H / 2))), rmax = new Array(NB).fill(0);
  for (let i = 0; i < pos.count; i++) {
    const k = Math.min(NB - 1, Math.floor(((pos.getZ(i) - bb.min.z) / H) * NB));
    rmax[k] = Math.max(rmax[k], Math.hypot(pos.getX(i) - cx, pos.getY(i) - cy));
  }
  for (let k = 1; k < NB; k++) if (!rmax[k]) rmax[k] = rmax[k - 1];
  const seg = [];
  for (let k = 0; k < NB; k++) {
    const d = +(2 * rmax[k]).toFixed(2), hh = +(H / NB).toFixed(3);
    const prev = seg[seg.length - 1];
    if (prev && Math.abs(prev.d2 - d) < 0.05 && Math.abs(prev.d1 - prev.d2) < 0.05) prev.h = +(prev.h + hh).toFixed(3);
    else seg.push({ h: hh, d1: prev ? prev.d2 : d, d2: d });
  }
  commit(p => p.cam.tools.push({ id: uid('T'), number: 0, name: v.name || 'Halter', type: 'holder', dia: Math.max(...seg.map(s => s.d2)), holder: { segments: seg } }));
  status(`Halter „${v.name}“ mit ${seg.length} Abschnitten angelegt (Höhe ${f2(H)} mm)`);
  openToolLibrary();
}

// ----- Rohteilmaterialbibliothek -----
const MAT_DATA = { alu: [2.7, 400], alu7075: [2.81, 350], steel: [7.85, 180], steelTool: [7.7, 100], stainless: [7.9, 120], cast: [7.2, 150], brass: [8.5, 250], copper: [8.9, 200], titanium: [4.43, 60], pom: [1.41, 400], pa: [1.14, 400], pe: [0.95, 450], wood: [0.72, 800], mdf: [0.75, 800], foam: [0.2, 1000] };
const customMats = () => loadJ('openfab.materials.v1', []);
// all materials: key → { name, color, density g/cm³, vc m/min (carbide), custom }
function allMaterials() {
  const out = {};
  for (const [k, [name, color]] of Object.entries(STOCK_MATERIALS)) out[k] = { name, color, density: MAT_DATA[k]?.[0], vc: MAT_DATA[k]?.[1], custom: false };
  for (const m of customMats()) out[m.id] = { name: m.name, color: parseInt(String(m.color || '#c9a86a').slice(1), 16), density: +m.density || null, vc: +m.vc || null, custom: true };
  return out;
}
function openMaterialLib() {
  const w = modalWin('Rohteilmaterialbibliothek', 760);
  const draw = () => {
    const mats = allMaterials();
    w.body.replaceChildren(h('table', { class: 'mtable' },
      h('tr', null, h('th', null, ''), h('th', null, 'Material'), h('th', null, 'Dichte'), h('th', null, 'Vc (HM)'), h('th', null, '')),
      ...Object.entries(mats).map(([k, m]) => {
        const cm = m.custom && customMats().find(x => x.id === k);
        const edit = (key, val) => { const all = customMats(); const x = all.find(q => q.id === k); x[key] = val; saveJ('openfab.materials.v1', all); draw(); };
        const inp = (key, val, w2 = 70) => { const i = h('input', { type: 'text', value: val ?? '', style: `width:${w2}px` }); i.onchange = () => edit(key, key === 'name' ? i.value : +i.value.replace(',', '.') || null); return i; };
        return h('tr', null,
          h('td', null, m.custom ? h('input', { type: 'color', value: cm.color || '#c9a86a', onchange: e => edit('color', e.target.value) }) : h('span', { class: 'mswatch', style: `background:#${m.color.toString(16).padStart(6, '0')}` })),
          h('td', null, m.custom ? inp('name', m.name, 220) : m.name),
          h('td', null, m.custom ? inp('density', m.density) : `${m.density ?? '–'}`, ' g/cm³'),
          h('td', null, m.custom ? inp('vc', m.vc) : `${m.vc ?? '–'}`, ' m/min'),
          h('td', null, m.custom ? h('button', { class: 'gx', title: 'Löschen', onclick: () => { saveJ('openfab.materials.v1', customMats().filter(x => x.id !== k)); draw(); } }, '✕') : h('span', { class: 'hint' }, 'Standard')));
      })),
    h('p', { class: 'hint' }, 'Material im Setup unter „Rohteil → Rohteilmaterial“ wählen. Die Dichte ergibt das Rohteilgewicht, Vc ist ein Richtwert für Hartmetall; die Farbe zeigt die Simulation.'));
  };
  w.foot.append(btn('+ Eigenes Material', () => { saveJ('openfab.materials.v1', [...customMats(), { id: 'm_' + uid('x'), name: 'Neues Material', color: '#9fb7c9', density: 1, vc: 200 }]); draw(); }, 'primary'), h('span', { style: 'flex:1' }), btn('Schließen', w.close));
  draw();
}

// ----- Vorlagenbibliothek: operations saved for reuse -----
const templates = () => loadJ('openfab.templates.v1', []);
// an operation without what belongs to one design (ids, geometry picks)
const opTemplate = (op, tools) => { const t = tools.find(x => x.id === op.tool); const o = JSON.parse(JSON.stringify(op)); delete o.id; delete o.setup; delete o.faces; delete o.sketch; delete o.entities; delete o.entryPts; return { ...o, toolInfo: t ? { number: t.number, type: t.type, dia: t.dia, name: t.name } : null }; };
function applyTemplate(tp) {
  const p = state.project, setupId = activeSetupId(), missing = [];
  const pickTool = ti => ti && (p.cam.tools.find(x => +x.number === +ti.number && x.type === ti.type) || p.cam.tools.find(x => x.type === ti.type && Math.abs(+x.dia - +ti.dia) < 1e-6) || p.cam.tools.find(x => toolBase(x) === toolBase(ti)));
  const ops = tp.ops.map(o => { const t = pickTool(o.toolInfo); if (!t) missing.push(o.name); const { toolInfo, ...rest } = o; return t ? { ...rest, id: uid('op'), setup: setupId, tool: t.id, sketch: '', entities: 'all', ...(FACE_OPS.includes(o.type) ? { faces: [] } : {}) } : null; }).filter(Boolean);
  commit(pp => { for (const o of ops) pp.cam.ops.push({ ...o, name: nextName(pp.cam.ops, o.name.replace(/\d+$/, '')) }); });
  status(`Vorlage „${tp.name}“: ${ops.length} Operation(en) eingefügt${missing.length ? ` – ohne passendes Werkzeug: ${missing.join(', ')}` : ''}. Geometrie (Skizze/Flächen) neu wählen.`);
}
// ----- Werkstoff-Sätze: ready sequences of operations; tools and cutting data follow the chosen material -----
const MAT_SETS = [
  { id: 'prism', name: '2,5D-Teil (Platte, Gehäuse)', desc: 'Planen, adaptiv schruppen, Kontur schlichten, Kanten fasen',
    steps: [{ type: 'face', tool: 'flat', dia: 12, prefer: 'facemill' }, { type: 'adaptive', tool: 'flat', dia: 10, rough: true }, { type: 'contour', tool: 'flat', dia: 6 }, { type: 'chamfer', tool: 'chamfer', dia: 6, tol: 3 }] },
  { id: 'pocket', name: 'Taschen und Bohrungen', desc: 'Planen, Taschen ausräumen, Kontur schlichten, bohren',
    steps: [{ type: 'face', tool: 'flat', dia: 12, prefer: 'facemill' }, { type: 'pocket', tool: 'flat', dia: 8, rough: true }, { type: 'contour', tool: 'flat', dia: 6 }, { type: 'drill', tool: 'drill', dia: 5 }] },
  { id: 'freeform', name: '3D-Freiform (Form, Modell)', desc: '3D adaptiv schruppen, parallel schlichten (Kugel), Restmaterial in Ecken',
    steps: [{ type: 'adaptive3d', tool: 'flat', dia: 10, rough: true }, { type: 'parallel3d', tool: 'ball', dia: 6 }, { type: 'pencil3d', tool: 'ball', dia: 3 }] },
];
const SET_COOLANT = { nf: 'flood', steel: 'flood', hard: 'through', plastic: 'air', soft: 'air' };
// own sets: saved from the operations of a setup (strategy settings kept; tools and cutting data follow the material)
const userSets = () => loadJ('openfab.matsets.v1', []);
const allSets = () => [...MAT_SETS, ...userSets()];
const SET_DROP = ['id', 'setup', 'tool', 'faces', 'edges', 'sketch', 'entities', 'entryPts', 'cut', 'cutMat', 'coolant', 'preset', 'name', 'geomSource', 'boundaryFaces', 'boundaryEdges', 'boundarySketchSel', 'faceGroups', 'toolInfo'];
function setFromOps(name, ops) {
  const tools = state.project.cam.tools;
  const steps = ops.filter(o => o.type !== 'probe').map(o => {
    const t = tools.find(x => x.id === o.tool);
    if (!t) return null;
    const opts = JSON.parse(JSON.stringify(o));
    for (const k of SET_DROP) delete opts[k];
    return { type: o.type, tool: t.type, dia: +t.dia, rough: ADAPTIVE_OPS.includes(o.type) || ROUGH_OPS.includes(o.type), opts, label: o.name };
  }).filter(Boolean);
  return { id: uid('ms'), name, user: true, desc: steps.map(x => x.label).join(', '), steps };
}
// what a set would do: the tool of every step (from the document, or a new one) and its cutting data
function matSetPlan(set, mk, machine) {
  const tools = [...state.project.cam.tools], fresh = [];
  const grp = MAT_GROUP[mk] || 'nf';
  const steps = set.steps.map(stp => {
    let tool = null, bd = Infinity;
    for (const t of tools) {
      const ok = (stp.prefer && t.type === stp.prefer) || t.type === stp.tool || (stp.tool === 'flat' && toolBase(t) === 'flat' && t.type !== 'chamfer');
      if (!ok) continue;
      const d = Math.abs(+t.dia - stp.dia) / stp.dia + (stp.prefer && t.type === stp.prefer ? -1 : 0);
      if (d < bd) { bd = d; tool = t; }
    }
    if (!tool || bd > (stp.tol ?? 0.5)) {
      const def = CATALOG_DEFAULTS[stp.tool] || {};
      tool = { id: uid('T'), number: Math.max(0, ...tools.map(t => +t.number || 0)) + 1, name: `${CATALOG_LABEL[stp.tool] || TOOL_TYPES[stp.tool]} Ø${stp.dia}`, type: stp.tool, ...def, dia: stp.dia, flutes: def.flutes ?? (stp.tool === 'drill' ? 2 : 3), material: 'carbide', stepover: stp.tool === 'ball' ? 0.1 : 0.4, stepdown: +(stp.dia * (stp.tool === 'ball' ? 0.1 : 0.5)).toFixed(2) };
      const c0 = cutCalc(tool, { type: stp.type }, mk, machine);
      Object.assign(tool, { rpm: c0.rpm, feed: c0.feed, plunge: c0.plunge });
      tools.push(tool); fresh.push(tool);
    }
    return { stp, tool, isNew: fresh.includes(tool), c: cutCalc(tool, { type: stp.type }, mk, machine) };
  });
  return { steps, fresh, grp };
}
function applyMatSet(set, mk) {
  const p = state.project, sid = activeSetupId(), st = p.cam.setups.find(x => x.id === sid);
  if (!st) return status('Erst ein Setup anlegen.');
  if (st.kind === 'turn') return status('Werkstoff-Sätze gibt es nur für Fräs-Setups.');
  const machine = findMachine(p, st.machine);
  const plan = matSetPlan(set, mk, machine);
  const ops = [], names = [...p.cam.ops];
  for (const { stp, tool, c } of plan.steps) {
    const op = addOp(stp.type, { tool, batch: true });
    if (!op) return;
    if (stp.opts) Object.assign(op, JSON.parse(JSON.stringify(stp.opts)));
    op.name = nextName(names, stp.label ? stp.label.replace(/\d+$/, '') : OP_TYPES[stp.type]);
    names.push(op);
    const usesSteps = ADAPTIVE_OPS.includes(stp.type) || ROUGH_OPS.includes(stp.type);
    op.cut = { rpm: c.rpm, feed: c.feed, plunge: c.plunge, rampRpm: c.rpm, leadInFeed: c.feed, leadOutFeed: c.feed, transitionFeed: c.feed, helixFeed: Math.round(c.feed * 0.5) };
    if (usesSteps && c.ap != null) { op.stepdown = c.ap; op.stepover = c.ae; }
    if (stp.rough && !stp.opts) op.stockToLeave = plan.grp === 'hard' || plan.grp === 'plastic' ? 0.3 : 0.2;
    op.coolant = SET_COOLANT[plan.grp] || 'flood';
    if (mk !== st.stockMaterial) op.cutMat = mk;
    // with a matching sketch the set computes at once (it can be switched to faces of the model in the operation)
    if (op.geomSource === 'model' && op.sketch) op.geomSource = 'sketch';
    ops.push(op);
  }
  commit(pp => { pp.cam.tools.push(...plan.fresh); pp.cam.ops.push(...ops); });
  if (ops[0]) select('op', ops[0].id);
  const MATS = allMaterials();
  status(`Satz „${set.name}“ für ${MATS[mk]?.name || mk}: ${ops.length} Operationen eingefügt${plan.fresh.length ? `, ${plan.fresh.length} Werkzeug(e) neu angelegt (${plan.fresh.map(t => 'T' + t.number).join(', ')})` : ''}. ${ops.some(o => o.geomSource === 'model') ? 'Bei den markierten Operationen noch Flächen im Modell wählen.' : 'Geometrie aus der letzten Skizze – bei Bedarf in der Operation ändern.'}`);
}
function openTemplateLib() {
  const w = modalWin('Vorlagenbibliothek', 680);
  const st0 = state.project.cam.setups.find(x => x.id === activeSetupId());
  let mk = st0?.stockMaterial || 'alu';
  const draw = () => {
    const list = templates();
    const MATS = allMaterials(), machine = st0 && findMachine(state.project, st0.machine);
    const setBox = h('div', null,
      h('div', { class: 'sec' }, 'WERKSTOFF-SÄTZE'),
      row('Werkstoff', sel(Object.entries(MATS).map(([k, m]) => [k, m.name + (k === st0?.stockMaterial ? ' (Rohteil)' : '')]), mk, v => { mk = v; draw(); })),
      h('div', { class: 'tpl-list' }, ...allSets().map(set => {
        const plan = matSetPlan(set, mk, machine);
        return h('div', { class: 'tpl-item tpl-set' },
          h('span', { class: 'tpl-ic', html: ICONS.setup }),
          h('div', { class: 'tpl-txt' }, h('b', null, set.name, set.user ? h('span', { class: 'tpl-own' }, 'eigener Satz') : null), h('small', null, set.desc),
            h('div', { class: 'tpl-steps' }, ...plan.steps.map(({ stp, tool, isNew, c }) => h('div', null,
              h('span', null, OP_TYPES[stp.type]),
              h('span', null, `${isNew ? '+ ' : ''}T${tool.number} ${tool.name || TOOL_TYPES[tool.type]}`),
              h('span', null, `${c.rpm} U/min · ${c.feed} mm/min${c.ap != null && (ADAPTIVE_OPS.includes(stp.type) || ROUGH_OPS.includes(stp.type)) ? ` · ap ${f2(c.ap)} · ae ${Math.round(c.ae * 100)} %` : ''}`))))),
          btn('Anwenden', () => { w.close(); applyMatSet(set, mk); }, 'primary'),
          set.user ? h('button', { class: 'gx', title: 'Satz löschen', onclick: () => { saveJ('openfab.matsets.v1', userSets().filter(x => x.id !== set.id)); draw(); } }, '✕') : null);
      })),
      h('div', { class: 'btns' }, btn('Satz aus Setup speichern', async () => {
        const ops = state.project.cam.ops.filter(o => o.setup === activeSetupId() && o.type !== 'probe');
        if (!ops.length) return status('Das Setup hat keine Operationen.');
        const n = await askValue('Name des Werkstoff-Satzes:', `${state.project.name} – ${ops.length} Operationen`);
        if (!n) return;
        const set = setFromOps(n, ops);
        if (!set.steps.length) return status('Keine Operation mit Werkzeug gefunden.');
        saveJ('openfab.matsets.v1', [...userSets(), set]);
        status(`Werkstoff-Satz „${n}“ mit ${set.steps.length} Schritten gespeichert.`);
        draw();
      })),
      h('p', { class: 'hint' }, `„+“ = Werkzeug wird neu angelegt. Schnittdaten sind Richtwerte für Hartmetall (${GROUP_LABEL[MAT_GROUP[mk]] || 'Werkstoff'})${machine ? `, begrenzt auf ${machine.name}` : ''}; Kühlung: ${COOLANT_MODES[SET_COOLANT[MAT_GROUP[mk]] || 'flood']}.`),
      h('div', { class: 'sec' }, 'EIGENE VORLAGEN'));
    w.body.replaceChildren(setBox, list.length ? h('div', { class: 'tpl-list' }, ...list.map(tp => h('div', { class: 'tpl-item' },
      h('span', { class: 'tpl-ic', html: ICONS.setup }),
      h('div', { class: 'tpl-txt' }, h('b', null, tp.name), h('small', null, `${tp.ops.length} Operation(en): ${tp.ops.map(o => o.name).join(', ')}`)),
      btn('Anwenden', () => { w.close(); applyTemplate(tp); }, 'primary'),
      btn('Umbenennen', async () => { const n = await askValue('Name der Vorlage:', tp.name); if (n) { saveJ('openfab.templates.v1', templates().map(x => (x.id === tp.id ? { ...x, name: n } : x))); draw(); } }),
      h('button', { class: 'gx', title: 'Löschen', onclick: () => { saveJ('openfab.templates.v1', templates().filter(x => x.id !== tp.id)); draw(); } }, '✕'))))
      : h('p', { class: 'hint' }, 'Noch keine Vorlagen. Eine Vorlage speichert Strategien mit allen Einstellungen (Werkzeug, Schnittdaten, Höhen, Durchgänge, Verknüpfung) zum Wiederverwenden in anderen Setups und Designs.'));
  };
  const save = async ops => {
    if (!ops.length) return status('Keine Operationen zum Speichern.');
    const n = await askValue('Name der Vorlage:', ops.length === 1 ? ops[0].name : `${state.project.name} – ${ops.length} Operationen`);
    if (!n) return;
    saveJ('openfab.templates.v1', [...templates(), { id: uid('tp'), name: n, ops: ops.map(o => opTemplate(o, state.project.cam.tools)) }]);
    draw();
  };
  const sid = activeSetupId(), selOp = state.sel?.kind === 'op' ? camOp(state.sel.id) : null;
  w.foot.append(...[
    btn('Aus Setup erstellen', () => save(state.project.cam.ops.filter(o => o.setup === sid))),
    selOp ? btn('Aus gewählter Operation', () => save([selOp])) : null,
    btn('Exportieren', () => download('WerkFab-Vorlagen.json', JSON.stringify(templates(), null, 1), 'application/json')),
    btn('Importieren', async () => { const f = await chooseFile('.json'); if (!f) return; try { const add = JSON.parse(await f.text()); if (!Array.isArray(add)) throw new Error('keine Vorlagenliste'); saveJ('openfab.templates.v1', [...templates(), ...add.filter(x => Array.isArray(x?.ops)).map(x => ({ ...x, id: uid('tp') }))]); draw(); } catch (err) { alert('Import fehlgeschlagen: ' + err.message); } }),
    h('span', { style: 'flex:1' }), btn('Schließen', w.close)].filter(Boolean));
  draw();
}

// ----- Bearbeitungszeit (machining time) per setup: cutting / rapid / tool changes -----
// Settings live in the project: feed scale (%), rapid feed (mm/min, empty = machine), tool change time (s).
function timeParams(st) {
  const tp = state.project.cam.timeParams || {};
  const mach = st && findMachine(state.project, st.machine);
  return { feedScale: +tp.feedScale || 100, rapid: +tp.rapid || mach?.rapid || RAPID_FEED, toolChange: tp.toolChange ?? (mach?.toolChanger === 'auto' ? 8 : 30) };
}
function setupSummary(st) {
  const g = getCam().setups.get(st.id);
  const P = timeParams(st);
  const rows = [];
  let lastTool = null, changes = 0;
  for (const op of state.project.cam.ops.filter(o => (o.setup || state.project.cam.setups[0].id) === st.id)) {
    const r = g?.results.get(op.id);
    const ok = r && !r.error && !r.disabled && r.moves?.length;
    let cutL = 0, cutT = 0, rapL = 0, dwell = 0;
    if (ok) {
      const m = r.moves;
      for (let i = 1; i < m.length; i++) {
        const a = m[i - 1], b = m[i], d = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
        if (b.dwell) dwell += b.dwell;
        else if (b.t === 'r') rapL += d;
        else { cutL += d; cutT += (d / (b.f || 1)) * 60; }
      }
    }
    const change = ok && op.tool && op.tool !== lastTool;
    if (change) { changes++; lastTool = op.tool; }
    const t = state.project.cam.tools.find(x => x.id === op.tool);
    const time = ok ? cutT * (100 / P.feedScale) + (rapL / P.rapid) * 60 + dwell + (change ? P.toolChange : 0) : 0;
    rows.push({ op, r, ok, tool: t, cutL, rapL, cutT: cutT * (100 / P.feedScale), rapT: (rapL / P.rapid) * 60, dwell, change, time });
  }
  const sum = k => rows.reduce((a, x) => a + x[k], 0);
  return { st, P, rows, changes, tools: new Set(rows.filter(x => x.ok && x.op.tool).map(x => x.op.tool)).size,
    time: sum('time'), cutL: sum('cutL'), rapL: sum('rapL'), cutT: sum('cutT'), rapT: sum('rapT'), tcT: changes * P.toolChange };
}
const fmtLen = mmv => (mmv >= 1000 ? `${f2(mmv / 1000)} m` : `${Math.round(mmv)} mm`);
const fmtDur = s => { if (!Number.isFinite(s)) return '–'; s = Math.round(s); const hh = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60; return hh ? `${hh}:${String(m).padStart(2, '0')}:${String(x).padStart(2, '0')}` : `${m}:${String(x).padStart(2, '0')}`; };

function openMachiningTime(setupId) {
  const w = modalWin('Bearbeitungszeit', 900);
  let which = setupId || 'all';
  const draw = () => {
    const p = state.project, tp = p.cam.timeParams || {};
    const setups = p.cam.setups.filter(st => which === 'all' || st.id === which);
    const sums = setups.map(setupSummary);
    const setTp = (k, v) => { commit(pp => { pp.cam.timeParams = { ...(pp.cam.timeParams || {}) }; if (v == null) delete pp.cam.timeParams[k]; else pp.cam.timeParams[k] = v; }); draw(); };
    const P0 = timeParams(setups[0]);
    const params = h('div', { class: 'mt-params' },
      h('label', null, 'Setup ', sel([['all', 'Alle Setups'], ...p.cam.setups.map(s => [s.id, s.name])], which, v => { which = v; draw(); })),
      h('label', null, 'Vorschubfaktor ', num(tp.feedScale ?? 100, v => setTp('feedScale', v), { unit: '%', min: 1 })),
      h('label', null, 'Eilgang ', num(tp.rapid ?? null, v => setTp('rapid', v), { unit: 'mm/min', allowEmpty: true, min: 1, ph: String(P0.rapid) })),
      h('label', null, 'Werkzeugwechsel ', num(tp.toolChange ?? null, v => setTp('toolChange', v), { unit: 's', allowEmpty: true, min: 0, ph: String(P0.toolChange) })));
    const total = sums.reduce((a, s) => a + s.time, 0);
    const maxT = Math.max(1, ...sums.flatMap(s => s.rows.map(r => r.time)));
    const body = [];
    for (const S of sums) {
      body.push(h('tr', { class: 'tm-setup' }, h('td', { colspan: 7 }, `${S.st.name} – ${fmtDur(S.time)} · ${S.rows.length} Operation(en) · ${S.tools} Werkzeug(e) · ${S.changes} Wechsel`)));
      for (const R of S.rows) {
        body.push(h('tr', { class: R.r?.error ? 'tm-err' : '', onclick: () => { w.close(); select('op', R.op.id); } },
          h('td', { class: 'mt-op' }, h('span', { class: 'mt-ic', html: opTreeIcon(R.op, R.r) }), R.op.name),
          h('td', null, R.tool ? `T${R.tool.number} Ø${f2(R.tool.dia)}` : '–'),
          h('td', null, R.ok ? fmtLen(R.cutL) : '–'), h('td', null, R.ok ? fmtLen(R.rapL) : '–'),
          h('td', null, R.change ? '●' : ''),
          h('td', { class: 'mt-time' }, R.op.enabled === false ? 'inaktiv' : R.r?.error ? '⚠ Fehler' : R.ok ? fmtDur(R.time) : '–'),
          h('td', { class: 'mt-barc' }, R.ok ? h('div', { class: 'mt-bar' }, h('span', { class: 'mt-cut', style: `width:${(R.cutT / maxT) * 100}%` }), h('span', { class: 'mt-rap', style: `width:${(R.rapT / maxT) * 100}%` }), h('span', { class: 'mt-tc', style: `width:${((R.change ? S.P.toolChange : 0) / maxT) * 100}%` })) : null)));
      }
    }
    const all = k => sums.reduce((a, s) => a + s[k], 0);
    w.body.replaceChildren(params,
      h('table', { class: 'mtable tm mt' }, h('tr', null, ...['Operation', 'Werkzeug', 'Schnittweg', 'Eilgangweg', 'Wechsel', 'Zeit', 'Anteil'].map(x => h('th', null, x))), ...body),
      h('div', { class: 'mt-legend' }, h('span', { class: 'mt-cut' }), 'Schnitt', h('span', { class: 'mt-rap' }), 'Eilgang', h('span', { class: 'mt-tc' }), 'Werkzeugwechsel'),
      // tools in use: how long each one cuts (for tool life and the tool list at the machine)
      (() => {
        const by = new Map();
        for (const S of sums) for (const R of S.rows) {
          if (!R.ok || !R.tool) continue;
          const e = by.get(R.tool.id) || { t: R.tool, ops: 0, cutT: 0, cutL: 0, setups: new Set() };
          e.ops++; e.cutT += R.cutT; e.cutL += R.cutL; e.setups.add(S.st.name);
          by.set(R.tool.id, e);
        }
        const list = [...by.values()].sort((x, y) => +x.t.number - +y.t.number);
        if (!list.length) return null;
        const maxT = Math.max(1, ...list.map(e => e.cutT));
        return h('div', null, h('div', { class: 'sec' }, 'WERKZEUGE IM EINSATZ'),
          h('table', { class: 'mtable tm mt' }, h('tr', null, ...['Nr.', 'Werkzeug', 'Ø', 'Operationen', 'Schnittzeit', 'Schnittweg', 'Standzeit', 'Teile bis Wechsel', 'Anteil'].map(x => h('th', null, x))),
            ...list.map(e => {
              // tool life: what is left of it, and how many parts that still allows
              const life = +e.t.life > 0 ? +e.t.life * 60 : 0, left = life ? Math.max(0, life - (+e.t.lifeUsed || 0) * 60) : 0;
              const parts = life && e.cutT > 0 ? Math.floor(left / e.cutT) : null, short = life && e.cutT > left;
              return h('tr', { class: short ? 'tm-err' : '', title: short ? 'Die restliche Standzeit reicht nicht für ein Teil – Werkzeug vorher tauschen.' : '' },
                h('td', null, `T${e.t.number}`), h('td', null, e.t.name || TOOL_TYPES[e.t.type] || ''), h('td', null, f2(e.t.dia)), h('td', null, String(e.ops)),
                h('td', { class: 'mt-time' }, fmtDur(e.cutT)), h('td', null, fmtLen(e.cutL)),
                h('td', null, life ? `${fmtDur(left)} von ${fmtDur(life)}` : '–'),
                h('td', null, parts == null ? '–' : short ? '⚠ 0' : String(parts)),
                h('td', { class: 'mt-barc' }, h('div', { class: 'mt-bar' }, h('span', { class: 'mt-cut', style: `width:${(e.cutT / maxT) * 100}%` }))));
            })));
      })(),
      h('div', { class: 'stats' },
        h('span', null, 'Gesamtzeit'), h('b', null, fmtDur(total)),
        h('span', null, 'davon Schnitt'), h('b', null, fmtDur(all('cutT'))),
        h('span', null, 'davon Eilgang'), h('b', null, fmtDur(all('rapT'))),
        h('span', null, 'davon Werkzeugwechsel'), h('b', null, `${fmtDur(all('tcT'))} (${all('changes')} ×)`),
        h('span', null, 'Schnittweg / Eilgangweg'), h('b', null, `${fmtLen(all('cutL'))} / ${fmtLen(all('rapL'))}`)),
      h('p', { class: 'hint' }, 'Schätzung aus den Werkzeugwegen: Schnitt mit programmiertem Vorschub × Vorschubfaktor, Eilgang mit fester Geschwindigkeit, ohne Beschleunigung der Maschine. Zeile anklicken öffnet die Operation.'));
  };
  w.foot.append(btn('Einrichteblatt', openSetupSheet), h('span', { style: 'flex:1' }), btn('Schließen', w.close, 'primary'));
  draw();
}

// ----- Schnittdaten-Rechner (feeds and speeds from the tool, the material and the strategy) -----
// Richtwerte für Hartmetall: Vc aus der Materialbibliothek, Zahnvorschub nach Werkstoffgruppe und Ø,
// Zustellungen nach Strategie. Begrenzt auf Drehzahl und Vorschub der Maschine.
const MAT_GROUP = { alu: 'nf', alu7075: 'nf', brass: 'nf', copper: 'nf', steel: 'steel', cast: 'steel', steelTool: 'hard', stainless: 'hard', titanium: 'hard', pom: 'plastic', pa: 'plastic', pe: 'plastic', wood: 'soft', mdf: 'soft', foam: 'soft' };
const GROUP_LABEL = { nf: 'NE-Metall', steel: 'Stahl/Guss', hard: 'schwer zerspanbar', plastic: 'Kunststoff', soft: 'Holz/Schaum' };
const ADAPTIVE_OPS = ['adaptive', 'adaptive3d'], ROUGH_OPS = ['pocket', 'face', 'rough3d', 'pocket3d', 'slot', 'plunge3d'], FINISH_OPS = ['contour', 'chamfer', 'parallel3d', 'contour3d', 'scallop3d', 'spiral3d', 'radial3d', 'pencil3d', 'steep3d', 'flat3d', 'horizontal3d', 'morph3d', 'flow3d', 'blend3d'];
function cutCalc(t, op, matKey, machine) {
  const mats = allMaterials(), m = mats[matKey] || mats.alu;
  const grp = MAT_GROUP[matKey] || ((m.vc || 200) >= 250 ? 'nf' : (m.vc || 200) >= 150 ? 'steel' : 'hard');
  const type = toolBase(t), d = Math.max(0.1, +t.dia || 1), z = Math.max(1, +t.flutes || 2);
  const vc = (m.vc || 200) * ({ drill: 0.5, ream: 0.3, tap: 0.06, chamfer: 0.8, facemill: 1.15, thread: 0.7 }[type] ?? 1);
  let rpm = (vc * 1000) / (Math.PI * d);
  rpm = Math.max(machine?.minRpm || 0, Math.min(machine?.maxRpm || 24000, rpm));
  const capF = f => Math.min(machine?.maxFeed || 20000, f);
  const out = { group: GROUP_LABEL[grp], vc: (Math.PI * d * rpm) / 1000, rpm: Math.round(rpm) };
  if (type === 'drill' || type === 'ream' || type === 'tap') {
    const frev = type === 'tap' ? +t.pitch || 1 : ({ nf: 0.02, steel: 0.014, hard: 0.01, plastic: 0.03, soft: 0.04 }[grp] * d) * (type === 'ream' ? 1.5 : 1);
    out.frev = frev;
    out.feed = out.plunge = Math.round(capF(rpm * frev));
    return out;
  }
  const strat = ADAPTIVE_OPS.includes(op.type) ? 'adaptive' : FINISH_OPS.includes(op.type) ? 'finish' : 'rough';
  // chip thinning allows more feed with a small radial engagement (adaptive)
  const fz = { nf: 0.06, steel: 0.04, hard: 0.028, plastic: 0.09, soft: 0.12 }[grp] * Math.pow(Math.min(2, Math.max(0.3, d / 10)), 0.7)
    * (type === 'ball' ? 0.8 : 1) * ({ adaptive: 1.25, finish: 0.75, rough: 1 }[strat]);
  out.fz = fz;
  out.feed = Math.round(capF(rpm * fz * z));
  out.plunge = Math.round(out.feed * 0.3);
  out.strat = { adaptive: 'Adaptiv (geringe Breite, volle Tiefe)', finish: 'Schlichten', rough: 'Schruppen' }[strat];
  const flute = toolFlute(t);
  const apF = { adaptive: { nf: 1.5, steel: 1.0, hard: 0.8, plastic: 2, soft: 2 }, rough: { nf: 0.5, steel: 0.3, hard: 0.2, plastic: 0.8, soft: 1 }, finish: { nf: 1, steel: 1, hard: 1, plastic: 1, soft: 1 } }[strat][grp];
  out.ap = +Math.min(flute * 0.9, d * apF).toFixed(2);
  out.ae = { adaptive: { nf: 0.15, steel: 0.1, hard: 0.08, plastic: 0.2, soft: 0.25 }[grp], rough: { nf: 0.45, steel: 0.4, hard: 0.3, plastic: 0.5, soft: 0.6 }[grp], finish: 0.1 }[strat];
  return out;
}
function cutCalcRows(op, t, ed, setup, machine) {
  const mats = allMaterials();
  const mk = op.cutMat || setup?.stockMaterial || 'alu';
  const c = cutCalc(t, op, mk, machine);
  const usesSteps = ADAPTIVE_OPS.includes(op.type) || ROUGH_OPS.includes(op.type);
  const S = (a, b) => [h('span', null, a), h('b', null, b)];
  return [
    sec('Schnittdaten-Rechner'),
    row('Werkstoff', sel(Object.entries(mats).map(([k, m]) => [k, m.name]), mk, v => ed(x => (x.cutMat = v === setup?.stockMaterial ? undefined : v)))),
    h('div', { class: 'stats' },
      ...S('Gruppe', c.group), ...(c.strat ? S('Strategie', c.strat) : []),
      ...S('Vc', `${f2(c.vc)} m/min`), ...S('Drehzahl', `${c.rpm} U/min`),
      ...(c.fz != null ? S('Zahnvorschub fz', `${c.fz.toFixed(3)} mm`) : S('Vorschub je Umdr.', `${c.frev.toFixed(3)} mm`)),
      ...S('Vorschub', `${c.feed} mm/min`), ...S('Eintauchen', `${c.plunge} mm/min`),
      ...(c.ap != null && usesSteps ? [...S('Zustellung ap', `${f2(c.ap)} mm`), ...S('Breite ae', `${Math.round(c.ae * 100)} % Ø`)] : [])),
    h('div', { class: 'btns' }, btn('Übernehmen', () => ed(x => {
      x.cut = { ...(x.cut || {}), rpm: c.rpm, feed: c.feed, plunge: c.plunge, rampRpm: c.rpm, leadInFeed: c.feed, leadOutFeed: c.feed, transitionFeed: c.feed, helixFeed: Math.round(c.feed * 0.5) };
      if (usesSteps && c.ap != null) { x.stepdown = c.ap; x.stepover = c.ae; }
      x.preset = undefined;
    }), 'primary')),
    h('p', { class: 'hint' }, `Richtwerte für Hartmetall${machine ? `, begrenzt auf ${machine.name}` : ''}. Werkstoff kommt aus dem Rohteil des Setups. Beim ersten Schnitt vorsichtig anfahren (Override).`),
  ];
}

// ----- Task-Manager: state and calculation time of every operation -----
function openTaskManager() {
  const w = modalWin('Task-Manager', 760);
  const draw = () => {
    const cam = getCam(), p = state.project;
    let total = 0, calc = 0;
    const rows = [];
    for (const st of p.cam.setups) {
      rows.push(h('tr', { class: 'tm-setup' }, h('td', { colspan: 5 }, st.name)));
      for (const op of p.cam.ops.filter(o => (o.setup || p.cam.setups[0].id) === st.id)) {
        const r = cam.results.get(op.id);
        const state2 = op.enabled === false ? ['–', 'deaktiviert'] : r?.error ? ['⚠', r.error] : r ? ['✓', 'berechnet'] : ['…', 'ausstehend'];
        if (r && !r.error && !r.disabled) { total += r.time || 0; calc += r.calcMs || 0; }
        rows.push(h('tr', { class: r?.error ? 'tm-err' : '' }, h('td', { class: 'tm-st' }, state2[0]), h('td', null, op.name), h('td', null, state2[1]),
          h('td', null, r?.calcMs != null ? `${Math.round(r.calcMs)} ms` : '–'), h('td', null, r && !r.error && !r.disabled ? fmtTime(r.time) : '–')));
      }
    }
    w.body.replaceChildren(h('table', { class: 'mtable tm' }, h('tr', null, h('th', null, ''), h('th', null, 'Operation'), h('th', null, 'Status'), h('th', null, 'Rechenzeit'), h('th', null, 'Bearbeitungszeit')), ...rows),
      h('div', { class: 'stats' }, h('span', null, 'Gesamte Bearbeitungszeit'), h('b', null, fmtTime(total)), h('span', null, 'Gesamte Rechenzeit'), h('b', null, `${(calc / 1000).toFixed(1)} s`)));
  };
  w.foot.append(btn('Alle neu berechnen', () => { camGen.key = null; renderAll(); draw(); }, 'primary'), h('span', { style: 'flex:1' }), btn('Schließen', w.close));
  draw();
}

// ----- Vorgaben exportieren / importieren / zurücksetzen -----
function defaultsBundle() {
  return { app: 'WerkFab', kind: 'vorgaben', version: 1, date: new Date().toISOString(), settings: getSettings(), toolbar: tbPins, shortcuts: tbShortcuts, keys: tbKeys,
    materials: customMats(), templates: templates(), matSets: userSets(), toolLibraries: localLibs(), posts: libPosts() };
}
function exportDefaults() {
  download('WerkFab-Vorgaben.json', JSON.stringify(defaultsBundle(), null, 1), 'application/json');
  status('Vorgaben exportiert: Einstellungen, Symbolleiste, Tastenkürzel, Materialien, Vorlagen, eigene Werkzeugbibliotheken und Postprozessoren.');
}
async function importDefaults() {
  const f = await chooseFile('.json');
  if (!f) return;
  try {
    const d = JSON.parse(await f.text());
    if (d?.kind !== 'vorgaben') throw new Error('Keine WerkFab-Vorgabendatei');
    if (d.settings) saveSettings(d.settings);
    if (d.toolbar) { for (const k of Object.keys(tbPins)) delete tbPins[k]; Object.assign(tbPins, d.toolbar); saveJ('openfab.toolbar.v1', tbPins); }
    if (d.shortcuts) { tbShortcuts = d.shortcuts; saveJ('openfab.shortcuts.v1', tbShortcuts); }
    if (d.keys) { for (const k of Object.keys(tbKeys)) delete tbKeys[k]; Object.assign(tbKeys, d.keys); saveJ('openfab.keys.v1', tbKeys); }
    if (Array.isArray(d.materials)) saveJ('openfab.materials.v1', d.materials);
    if (Array.isArray(d.templates)) saveJ('openfab.templates.v1', d.templates);
    if (Array.isArray(d.matSets)) saveJ('openfab.matsets.v1', d.matSets);
    if (Array.isArray(d.posts)) { postLibCache = d.posts.filter(x => x && typeof x.linear === 'string'); saveJ(POST_LIB, postLibCache); }
    if (Array.isArray(d.toolLibraries)) saveLocalLibs(d.toolLibraries);
    applySettings();
    renderAll();
    status(`Vorgaben aus „${f.name}“ übernommen`);
  } catch (err) { alert('Import fehlgeschlagen: ' + err.message); }
}
function resetDefaults() {
  if (!confirm('Alle Einstellungen, Symbolleisten-Anpassungen und eigenen Tastenkürzel auf die Vorgaben zurücksetzen?\n\nEigene Werkzeugbibliotheken, Materialien und Vorlagen bleiben erhalten.')) return;
  resetSettings();
  for (const k of Object.keys(tbPins)) delete tbPins[k];
  for (const k of Object.keys(tbKeys)) delete tbKeys[k];
  tbShortcuts = [];
  ['openfab.toolbar.v1', 'openfab.keys.v1', 'openfab.shortcuts.v1'].forEach(k => { try { localStorage.removeItem(k); } catch { /* storage unavailable */ } });
  applySettings();
  renderAll();
  status('Auf Vorgaben zurückgesetzt.');
}

function moveOp(id, d) {
  commit(p => {
    const i = p.cam.ops.findIndex(o => o.id === id), j = i + d;
    if (j < 0 || j >= p.cam.ops.length) return;
    [p.cam.ops[i], p.cam.ops[j]] = [p.cam.ops[j], p.cam.ops[i]];
  });
}

// ---------- machine library window ----------
let machineSel = null;
function openMachineLib(id) {
  if (id) machineSel = id;
  wm.get('winMachines').show(true);
  renderMachineLib();
}

function envelopeSvg(m) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', '0 0 260 190');
  svg.setAttribute('class', 'env-svg');
  const { x, y, z } = m.travel;
  const k = 150 / Math.max(x, y * 0.7, z, 1);
  const X = x * k, Y = y * k * 0.5, Z = z * k;
  const ox = 40, oy = 170;
  const P = (a, b, c) => `${ox + a + b * 0.8},${oy - c - b * 0.6}`;
  const add = (tag, attrs, text) => { const e = document.createElementNS(ns, tag); for (const q in attrs) e.setAttribute(q, attrs[q]); if (text) e.textContent = text; svg.append(e); };
  add('polygon', { points: [P(0, 0, 0), P(X, 0, 0), P(X, Y, 0), P(0, Y, 0)].join(' '), class: 'env-floor' });
  for (const [a, b] of [[[0, 0, 0], [0, 0, Z]], [[X, 0, 0], [X, 0, Z]], [[X, Y, 0], [X, Y, Z]], [[0, Y, 0], [0, Y, Z]]]) add('line', { x1: P(...a).split(',')[0], y1: P(...a).split(',')[1], x2: P(...b).split(',')[0], y2: P(...b).split(',')[1], class: 'env-edge' });
  add('polygon', { points: [P(0, 0, Z), P(X, 0, Z), P(X, Y, Z), P(0, Y, Z)].join(' '), class: 'env-top' });
  add('text', { x: ox + X / 2, y: oy + 14, class: 'env-txt', 'text-anchor': 'middle' }, `X ${x}`);
  add('text', { x: ox + X + Y * 0.8 / 2 + 6, y: oy - Y * 0.3, class: 'env-txt' }, `Y ${y}`);
  add('text', { x: ox - 6, y: oy - Z / 2, class: 'env-txt', 'text-anchor': 'end' }, `Z ${z}`);
  return svg;
}

function renderMachineLib() {
  const root = $('#machineLib');
  if (!root || wm.get('winMachines').el.hidden) return;
  root.replaceChildren();
  const p = state.project;
  const list = allMachines(p);
  if (!list.some(m => m.id === machineSel)) machineSel = list[0].id;
  const cur = list.find(m => m.id === machineSel);
  const ro = !!cur.builtin;
  const ed = fn => commit(pp => { const m = (pp.machines || []).find(x => x.id === cur.id); if (m) fn(m); });
  const left = h('div', { class: 'lib-left' },
    h('div', { class: 'lib-title' }, 'MASCHINEN'),
    ...list.map(m => h('div', { class: 'lib-item ' + (m.id === machineSel ? 'on' : ''), onclick: () => { machineSel = m.id; renderMachineLib(); } },
      h('span', { class: 'ti' }, m.builtin ? '🔒' : '🏭'), h('span', null, m.name))),
    h('div', { class: 'btns', style: 'padding:8px' },
      btn('+ Neu', () => { const id = uid('m'); machineSel = id; commit(pp => (pp.machines ||= []).push(newMachine(id))); }, 'primary'),
      btn('Duplizieren', () => { const id = uid('m'); machineSel = id; commit(pp => (pp.machines ||= []).push(copyMachine(cur, id, cur.name + ' (Kopie)'))); }),
      ro ? null : btn('Löschen', () => { if (!confirm(`„${cur.name}“ löschen?`)) return; commit(pp => { pp.machines = pp.machines.filter(m => m.id !== cur.id); pp.cam.setups.forEach(st => { if (st.machine === cur.id) st.machine = null; }); }); }, 'danger'),
      btn('Import', () => $('#machineFileInput').click()),
      btn('Export', () => download(`Maschinen_${safeName()}.json`, JSON.stringify(p.machines || [], null, 1), 'application/json'))),
  );
  const N = (label, get, set, opt) => row(label, num(get(cur), v => ed(m => set(m, v)), opt));
  const right = h('div', { class: 'lib-right wide' });
  right.append = (...kids) => Element.prototype.append.apply(right, kids.filter(k => k != null && k !== false));
  right.append(
    ro ? h('div', { class: 'ro-banner' }, '🔒 Eingebaute Maschine – zum Ändern duplizieren.', btn('Duplizieren', () => { const id = uid('m'); machineSel = id; commit(pp => (pp.machines ||= []).push(copyMachine(cur, id, cur.name + ' (Kopie)'))); }, 'primary')) : null,
    h('div', { class: 'lib-preview' }, envelopeSvg(cur)),
    sec('ALLGEMEIN'),
    row('Name', txt(cur.name, v => ed(m => (m.name = v)))),
    row('Hersteller / Typ', txt(cur.vendor || '–', v => ed(m => (m.vendor = v)))),
    row('Postprozessor', sel(allPosts(p).map(x => [x.id, x.name]), cur.post, v => ed(m => (m.post = v)))),
    sec('VERFAHRWEGE'),
    N('X', m => m.travel.x, (m, v) => (m.travel.x = v), { unit: 'mm', min: 1 }),
    N('Y', m => m.travel.y, (m, v) => (m.travel.y = v), { unit: 'mm', min: 1 }),
    N('Z', m => m.travel.z, (m, v) => (m.travel.z = v), { unit: 'mm', min: 1 }),
    sec('SPINDEL & ACHSEN'),
    N('Min. Drehzahl', m => m.minRpm, (m, v) => (m.minRpm = v), { unit: 'U/min', min: 0 }),
    N('Max. Drehzahl', m => m.maxRpm, (m, v) => (m.maxRpm = v), { unit: 'U/min', min: 1 }),
    N('Spindelleistung', m => m.power, (m, v) => (m.power = v), { unit: 'kW', min: 0 }),
    N('Max. Vorschub', m => m.maxFeed, (m, v) => (m.maxFeed = v), { unit: 'mm/min', min: 1 }),
    N('Eilgang', m => m.rapid, (m, v) => (m.rapid = v), { unit: 'mm/min', min: 1 }),
    sec('DREH- UND SCHWENKACHSEN'),
    row('Kinematik', sel(KIN_TYPES, cur.kin?.type || 'none', v => ed(m => { m.kin = v === 'none' ? null : { tableR: v === 'A' ? 0 : 150, spindleD: 110, ...(m.kin || {}), type: v }; }))),
    ...(cur.kin?.type && cur.kin.type !== 'none' ? (() => {
      const ax = cur.kin.type === 'BC' ? 'b' : 'a', AX = ax.toUpperCase();
      const lim = (i, label) => row(label, num(Array.isArray(cur.kin[ax]) ? cur.kin[ax][i] : '', v => ed(m => { if (v == null) { m.kin[ax] = null; return; } const l = Array.isArray(m.kin[ax]) ? m.kin[ax] : [-360, 360]; l[i] = v; m.kin[ax] = l; }), { unit: '°', allowEmpty: true, ph: 'endlos' }));
      return [lim(0, `${AX}-Achse min.`), lim(1, `${AX}-Achse max.`),
        cur.kin.type === 'A' ? null : N('Tisch-Radius', m => m.kin.tableR, (m, v) => (m.kin.tableR = v), { unit: 'mm', min: 0 }),
        N('Spindelnasen-Ø', m => m.kin.spindleD, (m, v) => (m.kin.spindleD = v), { unit: 'mm', min: 0 }),
        h('p', { class: 'hint' }, 'Die NC-Prüfung rechnet für geschwenkte Setups (3+2) die Achswinkel nach, prüft die Achsgrenzen und ob Werkzeug, Halter oder Spindelnase in den Maschinentisch fahren.')];
    })() : []),
    sec('AUSSTATTUNG'),
    row('Werkzeugwechsel', sel([['manual', 'Manuell (Pause M0)'], ['auto', 'Automatisch (Magazin)']], cur.toolChanger, v => ed(m => (m.toolChanger = v)))),
    cur.toolChanger === 'auto' ? N('Magazinplätze', m => m.tools, (m, v) => (m.tools = v), { int: true, min: 1 }) : null,
    row('Kühlmittel', chk(cur.coolant, v => ed(m => (m.coolant = v)))),
    h('p', { class: 'hint' }, 'Im Setup gewählt, bestimmt die Maschine Postprozessor, Eilgang (Laufzeit) und die Grenzwert-Prüfungen.'),
  );
  if (ro) right.querySelectorAll('input, select, textarea').forEach(el => (el.disabled = true));
  root.append(h('div', { class: 'lib lib2' }, left, right));
}

$('#machineFileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const list = JSON.parse(await file.text());
    if (!Array.isArray(list)) throw new Error('Keine Maschinenliste');
    commit(pp => { for (const m of list) if (m?.travel) (pp.machines ||= []).push({ ...m, id: uid('m'), builtin: undefined }); });
    status(`${list.length} Maschine(n) importiert`);
  } catch (err) { alert('Import fehlgeschlagen: ' + err.message); }
});

// ---------- post-processor editor window ----------
let postSel = null;
function openPostEditor(id) {
  if (id) postSel = id;
  wm.get('winPost').show(true);
  renderPostEditor();
}

// Post processor editor: settings and templates in the middle, the program of the active setup on the right.
// Every NC line knows the template that wrote it: click a line → its template; focus a template → its lines.
// Built-in posts can be edited too: the first change makes an own copy (and uses it if the built-in was in use).
let postFocus = null; // section key whose lines are highlighted / whose template is focused
let postWantFocus = null; // template to focus again after a re-render (saving one field re-renders the window)
function renderPostEditor() {
  const root = $('#postEd');
  if (!root || wm.get('winPost').el.hidden) return;
  const scrollMid = root.querySelector('.pe-mid')?.scrollTop || 0;
  const scrollPrev = root.querySelector('.pe-preview')?.scrollTop || 0;
  // a template that has the cursor keeps it across the re-render
  const ae = document.activeElement, keepKey = root.contains(ae) ? ae.closest?.('.pe-field')?.dataset.key : null, keepSel = keepKey ? [ae.selectionStart, ae.selectionEnd] : null;
  root.replaceChildren();
  const p = state.project;
  const posts = allPosts(p);
  if (!posts.some(x => x.id === postSel)) postSel = p.post.flavor || posts[0].id;
  const cur = posts.find(x => x.id === postSel);
  const ro = !!cur.builtin;
  const inProj = (p.posts || []).some(q => q.id === cur.id), lp = libPost(cur.id);
  // project copy and library copy differ (changed in another project, or here before the library existed)
  const differs = inProj && lp && JSON.stringify(cleanPost(lp)) !== JSON.stringify(cleanPost(cur));
  const toLib = id => { saveLibPost((state.project.posts || []).find(q => q.id === id)); renderPostEditor(); };
  // a change to a built-in post: own copy with the change, used instead of the built-in where that was in use;
  // own posts: changed in the project and in the library (a library post is copied into the project first)
  const ed = fn => {
    if (!ro) {
      commit(pp => { ensurePost(pp, cur.id); const x = (pp.posts || []).find(q => q.id === cur.id); if (x) fn(x); });
      if (!inProj || lp) toLib(cur.id);
      return;
    }
    const id = uid('post'), c = copyPost(cur, id, cur.name + ' (eigen)');
    fn(c);
    postSel = id;
    const active = p.post.flavor === cur.id;
    commit(pp => { (pp.posts ||= []).push(c); if (active) pp.post.flavor = id; });
    toLib(id);
    status(`Eigene Kopie „${c.name}“ angelegt${active ? ' und aktiviert' : ''} (auch in der Bibliothek) – der eingebaute Postprozessor bleibt unverändert`);
  };
  const dup = () => { const id = uid('post'); postSel = id; commit(pp => (pp.posts ||= []).push(copyPost(cur, id, cur.name + ' (eigen)'))); toLib(id); };
  const del = () => {
    const where = [inProj ? 'diesem Projekt' : null, lp ? 'der Bibliothek (alle Projekte)' : null].filter(Boolean).join(' und ');
    if (!confirm(`„${cur.name}“ aus ${where} löschen?`)) return;
    if (lp) dropLibPost(cur.id);
    if (inProj) commit(pp => { pp.posts = pp.posts.filter(x => x.id !== cur.id); if (pp.post.flavor === cur.id) pp.post.flavor = 'grbl'; });
    else renderPostEditor();
  };

  const left = h('div', { class: 'lib-left' },
    h('div', { class: 'lib-title' }, 'POSTPROZESSOREN'),
    ...posts.map(x => h('div', { class: 'lib-item ' + (x.id === postSel ? 'on' : ''), onclick: () => { postSel = x.id; renderPostEditor(); } },
      h('span', { class: 'ti', title: x.builtin ? 'Eingebaut' : libPost(x.id) ? 'In der Bibliothek (alle Projekte)' : 'Nur in diesem Projekt' }, x.builtin ? '🔒' : libPost(x.id) ? '📚' : '⚙'),
      h('span', null, x.name), x.id === p.post.flavor ? h('span', { class: 'cnt' }, 'aktiv') : x.libOnly ? h('span', { class: 'cnt', title: 'Aus der Bibliothek – noch nicht in diesem Projekt' }, 'Bibl.') : null)),
    h('div', { class: 'btns', style: 'padding:8px' },
      btn('Kopie anlegen', dup),
      ro ? null : btn('Löschen', del, 'danger'),
      cur.id === p.post.flavor ? null : btn('Verwenden', () => commit(pp => { ensurePost(pp, cur.id); pp.post.flavor = cur.id; }), 'primary'),
      !ro && inProj && !lp ? btn('In Bibliothek', () => { saveLibPost(cur); status(`„${cur.name}“ steht jetzt in allen Projekten zur Verfügung`); renderPostEditor(); }) : null),
    h('p', { class: 'hint', style: 'padding:0 8px' }, '📚 = Bibliothek: eigene Postprozessoren stehen in allen Projekten zur Verfügung. Ein verwendeter wird ins Projekt kopiert, damit die Datei vollständig bleibt.'),
    h('div', { class: 'btns', style: 'padding:0 8px 8px' },
      btn('Import', () => $('#postFileInput').click()),
      btn('Export', () => download(`${cur.name.replace(/[^\w-]+/g, '_')}.ofpost.json`, JSON.stringify(copyPost(cur, cur.id, cur.name), null, 1), 'application/json'))),
  );

  const mid = h('div', { class: 'pe-mid' });
  mid.append = (...kids) => Element.prototype.append.apply(mid, kids.filter(k => k != null && k !== false));
  const C = (label, key, sub) => row(label, chk(sub ? cur[key]?.[sub] : cur[key], v => ed(x => { if (sub) (x[key] ||= {})[sub] = v; else x[key] = v; })));
  const T = (label, key, sub) => row(label, txt(String((sub ? cur[key]?.[sub] : cur[key]) ?? ''), v => ed(x => { if (sub) (x[key] ||= {})[sub] = v; else x[key] = v; })));
  const Nn = (label, key, sub, opt) => row(label, num(sub ? cur[key]?.[sub] : cur[key], v => ed(x => { if (sub) (x[key] ||= {})[sub] = v; else x[key] = v; }), opt));
  mid.append(
    ro ? h('div', { class: 'ro-banner' }, '🔒 Eingebauter Postprozessor – einfach losschreiben: die erste Änderung legt automatisch eine eigene Kopie an.') : null,
    differs ? h('div', { class: 'ro-banner' }, '📚 Die Bibliothek hat eine andere Fassung dieses Postprozessors.',
      h('span', { class: 'btns' },
        btn('Bibliothek übernehmen', () => commit(pp => { const k = pp.posts.findIndex(x => x.id === cur.id); pp.posts[k] = cleanPost(lp); }), 'primary'),
        btn('Diese speichern', () => { saveLibPost(cur); renderPostEditor(); }))) : null,
    sec('ALLGEMEIN'),
    T('Name', 'name'), T('Dateiendung', 'ext'),
    sec('ZAHLENFORMAT'),
    Nn('Nachkommastellen', 'decimals', null, { int: true, min: 0 }), C('Nullen am Ende kürzen', 'trimZeros'), C('Dezimalpunkt immer (X10.)', 'decimalPoint'), C('Vorzeichen immer (+)', 'signed'),
    sec('VERHALTEN'),
    C('Modale G-Codes (G1 nicht wiederholen)', 'modalCodes'), C('F nach Eilgang erneut ausgeben', 'feedAfterRapid'),
    C('Achsen je Operation neu ausgeben', 'resetModalPerOp'), C('Kühlmittel je Operation', 'coolantPerOp'),
    C('Kreisbögen ausgeben', 'arcs'), C('Bohrzyklen verwenden', 'useDrillCycle'),
    sec('KOMMENTARE'),
    T('Format ({text})', 'comment'), C('Nur ASCII-Zeichen', 'asciiComments'),
    sec('SATZNUMMERN'),
    C('Satznummern', 'lineNumbers', 'enabled'), Nn('Start', 'lineNumbers', 'start', { int: true, min: 0 }), Nn('Schritt', 'lineNumbers', 'step', { int: true, min: 1 }),
    T('Präfix', 'lineNumbers', 'prefix'), C('Kommentare nummerieren', 'lineNumbers', 'comments'),
    sec('VORLAGEN'),
    h('p', { class: 'hint' }, 'Tippen zeigt die Wirkung sofort rechts in der Vorschau. Klick auf eine NC-Zeile springt zur Vorlage, die sie geschrieben hat; Platzhalter unten per Klick einfügen.'),
  );

  // ---- live preview: re-run the post with the text being typed, without leaving the field ----
  const g = activeGen();
  const right = h('div', { class: 'pe-right' });
  const head = h('div', { class: 'lib-title' });
  const warnBox = h('div');
  const pre = h('div', { class: 'pe-preview no-i18n' });
  right.append(head, warnBox, pre);
  const labelOf = Object.fromEntries(SECTIONS);
  const tas = new Map(); // section key -> textarea
  let lastTa = null, lastRes = null;
  const MAXL = 1500;
  const showPreview = def => {
    let res = null, err = null;
    try { if (g?.stock) res = runPost(def, resolved(), g, { coolant: !!p.post.coolant, cycles: p.post.cycles !== false, machine: g.machine, props: { ...(p.post.props?.[cur.id] || {}) } }); } catch (e) { err = e.message; }
    lastRes = res;
    const lines = res ? res.code.split('\n') : [];
    head.textContent = `VORSCHAU – ${g?.setup?.name || ''} (${lines.length} Zeilen)`;
    warnBox.replaceChildren(...(res?.warnings || []).map(w => h('p', { class: 'err' }, '⚠ ' + w)));
    if (err || !g?.stock) { pre.replaceChildren(h('div', { class: 'pe-msg' }, err ? 'Fehler: ' + err : 'Kein Rohteil im aktiven Setup – erst ein Modell und Operationen anlegen.')); return; }
    const frag = document.createDocumentFragment();
    lines.slice(0, MAXL).forEach((l, i) => {
      const src = res.src?.[i] || null;
      const d = h('div', { class: 'pe-ln' + (src && src === postFocus ? ' on' : '') + (src ? '' : ' auto'), 'data-src': src || '', title: src ? `Vorlage: ${labelOf[src] || src} – klicken zum Bearbeiten` : 'Automatisch (Postprozessor-Eigenschaften)' },
        h('span', { class: 'pe-no' }, String(i + 1)), ncSpans(l));
      // mousedown: before the template being edited loses its focus (that saves it and re-renders)
      if (src) d.onmousedown = e => { e.preventDefault(); focusSection(src, true); };
      frag.append(d);
    });
    if (lines.length > MAXL) frag.append(h('div', { class: 'pe-msg' }, `… ${lines.length - MAXL} weitere Zeilen`));
    pre.replaceChildren(frag);
  };
  // highlight the lines of one template and jump to the first; optionally put the cursor into its field
  const focusSection = (key, toField) => {
    postFocus = key;
    let first = null;
    for (const d of pre.children) { const on = !!key && d.dataset.src === key; d.classList.toggle('on', on); if (on && !first) first = d; }
    if (first && !toField) first.scrollIntoView({ block: 'nearest' });
    const ta = tas.get(key);
    if (toField && ta) { postWantFocus = key; ta.scrollIntoView({ block: 'center' }); ta.focus(); postWantFocus = null; ta.classList.add('flash'); setTimeout(() => ta.classList.remove('flash'), 700); }
  };
  let timer = null;
  const live = (key, value) => { clearTimeout(timer); timer = setTimeout(() => { const sc = pre.scrollTop; showPreview({ ...cur, [key]: value }); pre.scrollTop = sc; focusSection(key, false); }, 250); };

  for (const [key, label] of SECTIONS) {
    const val = cur[key] ?? '';
    const ta = h('textarea', { class: 'pe-tpl', spellcheck: 'false', rows: Math.min(10, Math.max(1, String(val).split('\n').length)) });
    ta.value = val;
    tas.set(key, ta);
    ta.addEventListener('focus', () => { lastTa = ta; focusSection(key, false); });
    ta.addEventListener('input', () => { ta.rows = Math.min(14, Math.max(1, ta.value.split('\n').length)); live(key, ta.value); });
    ta.addEventListener('blur', () => { if (ta.value !== String(val)) { clearTimeout(timer); ed(x => (x[key] = ta.value)); } });
    mid.append(h('div', { class: 'pe-field' + (key === postFocus ? ' on' : ''), 'data-key': key }, h('label', null, label, h('code', null, key)), ta));
  }
  // placeholders: click inserts into the template that had the cursor (mousedown keeps its focus)
  const ins = k => h('code', { class: 'pe-ins', title: 'In die Vorlage einfügen', onmousedown: e => {
    e.preventDefault();
    const ta = lastTa;
    if (!ta || document.activeElement !== ta) return status('Erst in eine Vorlage klicken, dann den Platzhalter wählen');
    ta.setRangeText(`{${k}}`, ta.selectionStart, ta.selectionEnd, 'end');
    ta.dispatchEvent(new Event('input'));
  } }, `{${k}}`);
  const help = h('details', { class: 'pe-help', open: true }, h('summary', null, 'Platzhalter & Syntax'),
    h('p', { class: 'hint' }, '{X} {Y} {Z} {F} {I} {J}: Adresswörter (X/Y/Z/F nur bei Änderung). {X!}: immer ausgeben. Kleinbuchstaben ({x}, {cx}, {safe}) = reiner Zahlenwert. Zeilen mit # werden Kommentare. Zeilen, die mit Leerzeichen beginnen, sind Folgezeilen (ohne Satznummer). Leere Zeilen nach dem Ersetzen entfallen.'),
    h('div', { class: 'pe-vars' }, h('b', null, 'Bewegung (Adresswörter)'), ...['X', 'Y', 'Z', 'A', 'F', 'I', 'J', 'X!', 'Y!', 'Z!'].map(k => h('span', null, ins(k)))),
    ...Object.entries(VARIABLES).map(([grp, vars]) => h('div', { class: 'pe-vars' }, h('b', null, grp), ...Object.entries(vars).map(([k, d]) => h('span', null, ins(k), ' ', d)))));
  mid.append(help);

  showPreview(cur);
  root.append(h('div', { class: 'pe' }, left, mid, right));
  mid.scrollTop = scrollMid;
  pre.scrollTop = scrollPrev;
  if (postWantFocus && tas.get(postWantFocus)) { const ta = tas.get(postWantFocus); lastTa = ta; ta.focus(); ta.scrollIntoView({ block: 'center' }); focusSection(postWantFocus, false); }
  else if (keepKey && tas.get(keepKey)) { const ta = tas.get(keepKey); lastTa = ta; ta.focus({ preventScroll: true }); try { ta.setSelectionRange(...keepSel); } catch { /* not a text field */ } }
}

// NC line as coloured spans: comments, G/M codes, axis words
function ncSpans(line) {
  const out = h('span', { class: 'pe-tx' });
  if (/^\s*(\(|;)/.test(line) || /^\s*N?\d*\s*\(.*\)\s*$/.test(line)) { out.append(h('span', { class: 'nc-c' }, line)); return out; }
  for (const m of line.matchAll(/(\([^)]*\)|;.*$)|\b([GM]\d+(?:\.\d+)?)\b|\b(TOOL CALL|L|CC|CP|C|CYCL DEF|CYCL CALL|LBL|CALL|BEGIN PGM|END PGM|TCH PROBE)\b|([XYZABCIJKRFST]=?[+-]?\d*\.?\d+)|([^(;GMXYZABCIJKRFSTLC]+|.)/g)) {
    const [t, c, gm, kw, ax] = m;
    out.append(c ? h('span', { class: 'nc-c' }, t) : gm ? h('span', { class: 'nc-g' }, t) : kw ? h('span', { class: 'nc-k' }, t) : ax ? h('span', { class: 'nc-a' }, t) : document.createTextNode(t));
  }
  return out;
}

$('#postFileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const text = await file.text();
    const id = uid('post');
    if (/\.cps$/i.test(file.name) || /\bfunction\s+onOpen\s*\(/.test(text)) {
      const { def, report } = convertCps(text, file.name);
      postSel = id;
      commit(pp => (pp.posts ||= []).push(copyPost(def, id, def.name + ' (importiert)')));
      saveLibPost(state.project.posts.find(x => x.id === id));
      alert(`Fusion-360-Postprozessor „${def.name}“ übernommen:\n\n• ${report.join('\n• ')}`);
      return;
    }
    const def = JSON.parse(text);
    if (!def || typeof def.linear !== 'string') throw new Error('Keine Postprozessor-Datei (erwartet: WerkFab .json oder Fusion 360 .cps)');
    postSel = id;
    commit(pp => (pp.posts ||= []).push(copyPost(def, id, def.name || 'Importiert')));
    saveLibPost(state.project.posts.find(x => x.id === id));
    status(`Postprozessor „${def.name}“ importiert`);
  } catch (err) { alert('Import fehlgeschlagen: ' + err.message); }
});

// ---------- tool library window (layout: libraries | tools + cutting data | filter/info) ----------
const TOOL_ICON = { probe: '⌖', flat: '▮', torus: '▯', facemill: '▬', ball: '◖', chamfer: '▼', drill: '⏷', tap: '⫶', ream: '┃', thread: '≣', turn: '◣', groove: '▭', tthread: '⋚' };
const TOOL_MATERIALS = [['carbide', 'Hartmetall (HM)'], ['hss', 'HSS'], ['hsse', 'HSS-E (Cobalt)'], ['ceramics', 'Keramik'], ['pcd', 'PKD (Diamant)'], ['cermet', 'Cermet']];
const tl = { lib: 'doc', sel: new Set(), anchor: null, sort: { key: 'dia', dir: 1 }, search: '', libSearch: '', filter: { types: new Set(), dmin: null, dmax: null, used: false, vendor: '' }, tab: 'info', clip: [], preset: 'default', openNodes: new Set(['user', 'local', 'samples']) };
let toolSel = null;
const TL_COLS_KEY = 'openfab.toolcols.v1';
const TL_COLUMNS = {
  name: { label: 'Name', w: '36%' }, cornerR: { label: 'Eckenradius' }, dia: { label: 'Durchmesser' }, fluteLen: { label: 'Schneidenlänge' }, length: { label: 'Gesamtlänge' },
  type: { label: 'Typ' }, flutes: { label: 'Schneiden' }, rpm: { label: 'Drehzahl' }, feed: { label: 'Vorschub' }, shaftDia: { label: 'Schaft-Ø' }, stickout: { label: 'Länge unter Halter' }, vendor: { label: 'Zulieferer' }, used: { label: 'Verwendet' },
};
let tlCols = (() => { try { return JSON.parse(localStorage.getItem(TL_COLS_KEY)) || ['name', 'cornerR', 'dia', 'fluteLen', 'length', 'type']; } catch { return ['name', 'cornerR', 'dia', 'fluteLen', 'length', 'type']; } })();

// geometry defaults where a library does not say anything
const toolShaft = shaftDia, toolFlute = fluteLen, toolStick = stickout, toolLen = totalLen, toolShoulder = shoulderLen;
const mm = v => (v == null || v === '' || !Number.isFinite(+v) ? '' : `${f2(v)} mm`);
const toolTitle = t => `${t.number} - Ø${f2(t.dia)}mm${t.cornerR > 0 && t.type !== 'ball' ? ` R${f2(t.cornerR)}mm` : ''}${['drill', 'chamfer'].includes(t.type) && t.angle ? ` ${f2(t.angle)}°` : ''} (${t.name})`;

// ---- libraries ----
const LOCAL_KEY = 'openfab.toollibs.v1';
function localLibs() { try { return JSON.parse(localStorage.getItem(LOCAL_KEY)) || []; } catch { return []; } }
function saveLocalLibs(libs) { try { localStorage.setItem(LOCAL_KEY, JSON.stringify(libs)); } catch { alert('Speicher voll – Bibliothek konnte nicht gespeichert werden.'); } }
// sample libraries (WerkFab's own guide values, read only)
const SAMPLE_LIBS = (() => {
  let n = 0;
  const mk = (type, dia, name, x = {}) => {
    const vc = { drill: 80, tap: 12, ream: 18, thread: 120, chamfer: 150, probe: 0 }[type] ?? 180;
    const rpm = type === 'probe' ? 0 : Math.min(24000, Math.round((vc * 1000) / (Math.PI * dia)));
    const fz = ['drill', 'ream'].includes(type) ? Math.min(0.3, 0.02 * dia) : Math.min(0.08, Math.max(0.01, 0.006 * dia));
    const flutes = x.flutes ?? (['drill'].includes(type) ? 1 : ['flat', 'torus', 'ball'].includes(type) ? (dia < 4 ? 2 : dia < 12 ? 3 : 4) : 2);
    const feed = type === 'tap' ? Math.round(rpm * (x.pitch || 1)) : type === 'probe' ? 300 : Math.round(fz * flutes * rpm);
    return { id: 's' + (++n), number: n, name, type, dia, flutes, rpm, feed, plunge: type === 'tap' ? feed : Math.round(feed / (['drill', 'ream'].includes(type) ? 1 : 3)), stepdown: +(Math.max(0.2, dia * (type === 'ball' ? 0.1 : 0.5))).toFixed(2), stepover: type === 'ball' ? 0.1 : 0.4, material: type === 'tap' || type === 'probe' ? 'hss' : 'carbide', vendor: 'WerkFab Muster', ...x };
  };
  const end = [1, 2, 3, 4, 5, 6, 8, 10, 12, 16, 20].map(d => mk('flat', d, `Schaftfräser HM Ø${d}`, { fluteLen: Math.max(3, d * 2.5) }));
  const ball = [1, 2, 3, 4, 6, 8, 10, 12].map(d => mk('ball', d, `Kugelfräser HM R${d / 2}`, { fluteLen: Math.max(3, d * 2) }));
  const torus = [[6, 0.5], [8, 1], [10, 1], [12, 2], [16, 2]].map(([d, r]) => mk('torus', d, `Torusfräser HM Ø${d} R${r}`, { cornerR: r, fluteLen: d * 2 }));
  const drills = [2, 2.5, 3, 3.3, 4, 4.2, 5, 5.5, 6, 6.6, 6.8, 8, 8.5, 9, 10, 10.2, 11, 12, 13.5, 14, 16, 18, 20].map(d => mk('drill', d, `Bohrer HM Ø${d}`, { angle: 140, fluteLen: d * 5 }));
  const taps = [['M3', 3, 0.5], ['M4', 4, 0.7], ['M5', 5, 0.8], ['M6', 6, 1], ['M8', 8, 1.25], ['M10', 10, 1.5], ['M12', 12, 1.75], ['M16', 16, 2]].map(([nm, d, p]) => mk('tap', d, `Gewindebohrer ${nm}`, { pitch: p, fluteLen: d * 2 }));
  const misc = [mk('chamfer', 6, 'Fasenfräser 90° Ø6', { angle: 90, tip: 0 }), mk('chamfer', 10, 'Fasenfräser 90° Ø10', { angle: 90, tip: 0.5 }), mk('chamfer', 12, 'NC-Anbohrer 90° Ø12', { angle: 90, tip: 0 }),
    mk('facemill', 50, 'Planfräser Ø50', { flutes: 5, fluteLen: 6, shaftDia: 22 }), mk('thread', 6, 'Gewindefräser Ø6 P1', { pitch: 1 }), mk('ream', 6, 'Reibahle Ø6 H7'), mk('probe', 6, '3D-Taster Ø6', { fluteLen: 6 })];
  return [
    { id: 'endmills', name: 'Fräser (HM, metrisch)', tools: [...end, ...torus, ...ball] },
    { id: 'drills', name: 'Bohren und Gewinde', tools: [...drills, ...taps] },
    { id: 'misc', name: 'Sonderwerkzeuge', tools: misc },
  ];
})();

const libKind = lib => lib.split(':')[0];
function libTools(lib = tl.lib) {
  if (lib === 'doc') return state.project.cam.tools;
  if (libKind(lib) === 'local') return localLibs().find(l => 'local:' + l.id === lib)?.tools || [];
  return SAMPLE_LIBS.find(l => 'sample:' + l.id === lib)?.tools || [];
}
const libEditable = (lib = tl.lib) => lib === 'doc' || libKind(lib) === 'local';
const libName = (lib = tl.lib) => lib === 'doc' ? `Dokument: ${state.project.name}` : libKind(lib) === 'local' ? (localLibs().find(l => 'local:' + l.id === lib)?.name || 'Lokal') : (SAMPLE_LIBS.find(l => 'sample:' + l.id === lib)?.name || 'Muster');
function editLib(lib, fn) {
  if (lib === 'doc') { commit(p => fn(p.cam.tools)); return; }
  if (libKind(lib) !== 'local') return status('Diese Bibliothek ist schreibgeschützt – Werkzeuge mit Kopieren/Einfügen in eine eigene Bibliothek übernehmen.');
  const libs = localLibs(), L = libs.find(l => 'local:' + l.id === lib);
  if (!L) return;
  fn(L.tools);
  saveLocalLibs(libs);
  renderToolLib();
}
const usedCount = id => state.project.cam.ops.filter(o => o.tool === id).length;

function openToolLibrary() {
  const w = wm.get('winTools');
  w.show(true);
  const B = wm.bounds();
  // the usual tool library is a big window
  if (w.s.w < Math.min(1200, B.w - 40) && !w.s.max) { Object.assign(w.s, { x: 10, y: 10, w: Math.min(1500, B.w - 20), h: B.h - 20 }); w.apply(); wm.save(); }
  renderToolLib();
}

// ---- drawing like the usual tool preview (side view with holder, scale bar) ----
function toolSvg(t, big = false) {
  const ns = 'http://www.w3.org/2000/svg';
  const W = 260, H = big ? 380 : 330;
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'tool-svg2');
  const add = (tag, attrs, parent = svg) => { const e = document.createElementNS(ns, tag); for (const k in attrs) e.setAttribute(k, attrs[k]); parent.append(e); return e; };
  const dia = +t.dia || 1, shaft = toolShaft(t), flute = toolFlute(t), stick = toolStick(t), len = toolLen(t), shoulder = toolShoulder(t);
  const holderD = +(t.holderDia ?? defaultHolderDia(t)), holderL = Math.max(20, holderD * 1.4);
  //: the tool fills the view, the holder is only shown at its lower end
  const totalH = stick + Math.min(holderL, stick * 0.35 + 4);
  const s = Math.min((H - 60) / totalH, (W - 60) / Math.max(shaft, dia) / 1.6);
  const cx = W / 2, tipY = H - 40, X = v => cx + v * s, Y = v => tipY - v * s;
  // grid and axes
  for (let x = 20; x < W; x += 20) add('line', { x1: x, y1: 0, x2: x, y2: H, class: 'tg' });
  for (let y = 10; y < H; y += 20) add('line', { x1: 0, y1: y, x2: W, y2: y, class: 'tg' });
  add('line', { x1: 0, y1: tipY, x2: W, y2: tipY, class: 'tax' });
  add('line', { x1: cx, y1: 0, x2: cx, y2: H, class: 'tax' });
  const lz = add('text', { x: cx + 4, y: 12, class: 'taxz' }); lz.textContent = '+Z';
  const lx = add('text', { x: W - 18, y: tipY - 4, class: 'taxx' }); lx.textContent = '+X';
  // holder
  add('path', { d: `M${X(-holderD / 2)} ${Y(stick)} V${Y(stick + holderL)} H${X(holderD / 2)} V${Y(stick)} Z`, class: 'th' });
  // shank and neck
  const neckD = Math.min(shaft, dia * 0.92);
  const tr = Math.min(shoulder + (shaft - dia) * 1.2, stick);
  add('path', { d: `M${X(-shaft / 2)} ${Y(stick)} V${Y(tr)} L${X(-neckD / 2)} ${Y(shoulder)} V${Y(flute)} H${X(neckD / 2)} V${Y(shoulder)} L${X(shaft / 2)} ${Y(tr)} V${Y(stick)} Z`, class: 'tsh' });
  // cutting part
  const r = dia / 2;
  let d;
  if (t.type === 'ball') d = `M${X(-r)} ${Y(flute)} V${Y(r)} A${r * s} ${r * s} 0 0 0 ${X(r)} ${Y(r)} V${Y(flute)} Z`;
  else if (t.type === 'drill' || t.type === 'chamfer') {
    const ang = ((t.angle || (t.type === 'drill' ? 118 : 90)) / 2) * (Math.PI / 180), tip = (+t.tip || 0) / 2;
    const hgt = Math.min(flute, (r - tip) / Math.tan(ang));
    d = `M${X(-r)} ${Y(flute)} V${Y(hgt)} L${X(-tip)} ${Y(0)} H${X(tip)} L${X(r)} ${Y(hgt)} V${Y(flute)} Z`;
  } else if (t.type === 'torus' || (t.cornerR > 0 && t.type === 'flat')) {
    const cr = Math.min(+t.cornerR || 0.5, r);
    d = `M${X(-r)} ${Y(flute)} V${Y(cr)} A${cr * s} ${cr * s} 0 0 0 ${X(-r + cr)} ${Y(0)} H${X(r - cr)} A${cr * s} ${cr * s} 0 0 0 ${X(r)} ${Y(cr)} V${Y(flute)} Z`;
  } else if (t.type === 'probe') {
    add('line', { x1: X(0), y1: Y(flute), x2: X(0), y2: Y(r), class: 'tstylus' });
    add('circle', { cx: X(0), cy: Y(r), r: r * s, class: 'tball' });
    d = null;
  } else d = `M${X(-r)} ${Y(flute)} V${Y(0)} H${X(r)} V${Y(flute)} Z`;
  if (d) add('path', { d, class: 'tfl' });
  if (t.type === 'tap' || t.type === 'thread') for (let z = 1; z < flute - 0.5; z += Math.max(0.6, +t.pitch || 1)) add('line', { x1: X(-r), y1: Y(z), x2: X(r), y2: Y(z + 0.5), class: 'tthr' });
  // scale bar
  const step = [1, 2, 5, 10, 20, 50, 100].find(v => v * s > 40) || 100;
  add('path', { d: `M${W - 16 - step * s} ${H - 14} v-4 m0 4 H${W - 16} v-4`, class: 'tscale' });
  const ts = add('text', { x: W - 12 - step * s / 2, y: H - 20, class: 'tscalet', 'text-anchor': 'middle' }); ts.textContent = `${step} mm`;
  void len;
  return svg;
}

// ---- tool edit dialog (layout: form | 3D view | profile view) ----
const SAMPLE_HOLDERS = [
  { id: 'h1', number: 0, type: 'holder', name: 'SK40 Spannzangenfutter ER32', dia: 50, holder: { segments: [{ h: 6, d1: 32, d2: 32 }, { h: 30, d1: 42, d2: 50 }, { h: 20, d1: 63, d2: 63 }] } },
  { id: 'h2', number: 0, type: 'holder', name: 'SK40 Spannzangenfutter ER16', dia: 32, holder: { segments: [{ h: 6, d1: 22, d2: 22 }, { h: 40, d1: 28, d2: 40 }, { h: 20, d1: 63, d2: 63 }] } },
  { id: 'h3', number: 0, type: 'holder', name: 'SK40 Weldon Ø12', dia: 42, holder: { segments: [{ h: 50, d1: 42, d2: 42 }, { h: 20, d1: 63, d2: 63 }] } },
  { id: 'h4', number: 0, type: 'holder', name: 'HSK63 Schrumpffutter Ø6', dia: 21, holder: { segments: [{ h: 30, d1: 14, d2: 21 }, { h: 40, d1: 27, d2: 32 }, { h: 26, d1: 63, d2: 63 }] } },
  { id: 'h5', number: 0, type: 'holder', name: 'ER11 Gerade (Hobby-Spindel)', dia: 19, holder: { segments: [{ h: 18, d1: 16, d2: 19 }, { h: 30, d1: 26, d2: 26 }] } },
];
SAMPLE_LIBS.push({ id: 'holders', name: 'Halter', tools: SAMPLE_HOLDERS });
function allHolders() {
  const out = [];
  const pushFrom = (list, src) => { for (const t of list || []) if (t.type === 'holder') out.push({ ...t, src }); };
  pushFrom(state.project.cam.tools, 'Dokument');
  for (const l of localLibs()) pushFrom(l.tools, l.name);
  pushFrom(SAMPLE_HOLDERS, 'Muster');
  return out;
}
function toolIcon(t, w = 22, h = 30) {
  const svg = toolSvg2D(t, { width: w, height: h, grid: false, holder: false, icon: true });
  return svg;
}

// "Neues Werkzeug": catalog with icons
function openNewToolPicker(onPick) {
  const back = h('div', { class: 'modal-back' });
  const close = () => back.remove();
  const body = h('div', { class: 'ntp-body' });
  for (const [cat, list] of TOOL_CATALOG) {
    body.append(h('div', { class: 'ntp-cat' }, cat), h('div', { class: 'ntp-grid' }, ...list.map(([type, label, def]) => {
      const sample = { type: type === 'tapLeft' ? 'tap' : type, ...def };
      return h('button', { class: 'ntp-item', title: label, onclick: () => { close(); onPick(type); } }, h('span', { class: 'ntp-ico' }, toolIcon(sample, 34, 40)), h('span', null, label));
    })));
  }
  back.append(h('div', { class: 'modal ntp' }, h('div', { class: 'modal-head' }, 'Neues Werkzeug', h('button', { onclick: close }, '✕')), body));
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
  document.body.append(back);
}

function editToolDialog(lib, toolId, startTab = 'tool') {
  const src = libTools(lib).find(t => t.id === toolId);
  if (!src) return;
  const ro = !libEditable(lib);
  const t = JSON.parse(JSON.stringify(src));
  t.presets ||= [];
  let tab = startTab === 'cutting' ? 'cutting' : startTab === 'general' ? 'general' : src.type === 'holder' ? 'holder' : 'tool', psel = tl.preset;
  let view3d = null;
  const back = h('div', { class: 'modal-back tled-back' });
  const close = () => { view3d?.dispose(); back.remove(); };
  const form = h('div', { class: 'tled-form' }), mid = h('div', { class: 'tled-3d' }), right = h('div', { class: 'tled-2d' });
  const tabs = h('div', { class: 'tled-tabs' }), crumb = h('div', { class: 'tled-crumb' });
  const card = (title, ...rows) => h('div', { class: 'tled-card' }, title ? h('div', { class: 'tled-ctitle' }, title) : null, ...rows.filter(Boolean));
  const R = (label, ctl) => h('div', { class: 'tled-row' }, h('label', null, label), h('div', { class: 'tled-ctl' }, ctl));
  const NUM = (key, opt = {}) => num(t[key] ?? '', v => { t[key] = v; draw(); }, { unit: 'mm', allowEmpty: true, ph: opt.ph != null ? f2(opt.ph) : '', ...opt });
  const TXT = key => txt(t[key] || '', v => { t[key] = v; draw(false); });
  const presetObj = () => (psel === 'default' ? t : t.presets.find(p => p.id === psel) || t);
  const isTool = t.type !== 'holder';
  const has = (...types) => types.includes(t.type);
  const segTable = (segs, set) => h('div', { class: 'tled-segs' },
    h('div', { class: 'tled-seg tled-seghead' }, h('span', null, 'Höhe'), h('span', null, 'Unterer Ø'), h('span', null, 'Oberer Ø'), h('span')),
    ...segs.map((sg, i) => h('div', { class: 'tled-seg' },
      ...['h', 'd1', 'd2'].map(k => num(sg[k], v => { sg[k] = v; set(segs); }, { unit: null, min: 0.1 })),
      h('button', { class: 'tled-x', title: 'Segment entfernen', onclick: () => { segs.splice(i, 1); set(segs); } }, '✕'))),
    h('div', { class: 'btns' }, btn('+ Segment', () => { const last = segs[segs.length - 1] || { h: 10, d1: 20, d2: 20 }; segs.push({ h: 10, d1: last.d2, d2: last.d2 }); set(segs); })));

  const draw = (redraw3d = true) => {
    crumb.replaceChildren(h('span', null, libName(lib)), h('span', { class: 'twl-chev' }, '/'), h('span', { class: 'tled-cico' }, toolIcon(t, 14, 18)), h('span', null, isTool ? toolTitle(t) : t.name));
    const tabList = isTool ? [['general', 'Allgemein'], ['tool', 'Werkzeug'], ['shaft', 'Schaft'], ['holder', 'Halter'], ['cutting', 'Schnittdaten'], ['post', 'Postprozessor']] : [['general', 'Allgemein'], ['holder', 'Halter']];
    tabs.replaceChildren(...tabList.map(([k, l]) => h('button', { class: k === tab ? 'on' : '', onclick: () => { tab = k; draw(false); } }, l)));
    form.replaceChildren();
    const add = (...k) => form.append(...k.filter(Boolean));
    if (tab === 'general') add(card(null,
      R('Beschreibung', TXT('name')), R('Zulieferer', TXT('vendor')), R('Produkt-ID', TXT('productId')), R('Produkt-Link', TXT('productLink')), R('Kommentar', TXT('comment'))),
      isTool ? card('Standzeit',
        R('Standzeit (Schnittzeit)', num(t.life ?? '', v => { t.life = v || undefined; draw(false); }, { unit: 'min', allowEmpty: true, min: 0, ph: 'keine' })),
        R('Bereits verbraucht', num(t.lifeUsed ?? '', v => { t.lifeUsed = v || undefined; draw(false); }, { unit: 'min', allowEmpty: true, min: 0, ph: 0 })),
        t.life > 0 ? h('div', { class: 'tled-life' }, h('span', { style: `width:${Math.min(100, ((t.lifeUsed || 0) / t.life) * 100)}%` })) : null,
        h('p', { class: 'hint' }, 'Wie lange die Schneide schneiden darf, bevor sie getauscht wird. Das Fenster „Bearbeitungszeit“ rechnet daraus, wie viele Teile noch möglich sind.')) : null);
    if (tab === 'tool') {
      add(card(null,
        R('Typ', sel(Object.entries(TOOL_TYPES).filter(([k]) => k !== 'holder'), t.type, v => { t.type = v; for (const [k, d] of Object.entries(CATALOG_DEFAULTS[v] || {})) if (t[k] == null && k !== 'dia') t[k] = d; draw(); })),
        R('Einheit', sel([['mm', 'Millimeter']], 'mm', () => {})),
        R('Spindelrotation im Uhrzeigersinn', chk(t.cw !== false, v => (t.cw = v))),
        has('probe', 'waterjet', 'laser', 'plasma', 'arcwire', 'laserpowder', 'laserwire') ? null : R('Anzahl der Schneiden', num(t.flutes ?? 2, v => { t.flutes = v; draw(); }, { unit: null, int: true, min: 1 })),
        R('Material', sel(TOOL_MATERIALS, t.material || 'carbide', v => (t.material = v))),
        has('tapered') ? R('Verjüngter Typ', sel([['torus', 'Torusfräser'], ['ball', 'Kugelkopffräser'], ['flat', 'Schaftfräser']], t.taperTip || 'torus', v => { t.taperTip = v; draw(); })) : null,
        has('tap') ? R('Gewinderichtung', sel([['right', 'Rechtsgewinde'], ['left', 'Linksgewinde']], t.hand || 'right', v => (t.hand = v))) : null));
      add(card('Geometrie',
        R(has('waterjet', 'laser', 'plasma') ? 'Schnittfugenbreite' : 'Durchmesser', NUM('dia', { min: 0.01 })),
        has('turn', 'turnbore', 'groove', 'tthread', 'waterjet', 'laser', 'plasma', 'arcwire', 'laserpowder', 'laserwire') ? null : R('Schaftdurchmesser', NUM('shaftDia', { ph: shaftDia({ ...t, shaftDia: undefined }) })),
        R('Gesamtlänge', NUM('length', { ph: totalLen({ ...t, length: undefined }) })),
        R('Länge unter Halter', NUM('stickout', { ph: stickout({ ...t, stickout: undefined }) })),
        has('probe', 'turn', 'turnbore', 'groove', 'tthread', 'waterjet', 'laser', 'plasma', 'arcwire', 'laserpowder', 'laserwire') ? null : R('Schulterlänge', NUM('shoulderLen', { ph: shoulderLen({ ...t, shoulderLen: undefined }) })),
        has('turn', 'turnbore', 'groove', 'tthread', 'waterjet', 'laser', 'plasma', 'arcwire', 'laserpowder', 'laserwire') ? null : R(has('slot', 'dovetail') ? 'Schneidenbreite' : 'Schneidenlänge', NUM('fluteLen', { ph: fluteLen({ ...t, fluteLen: undefined }) })),
        has('torus', 'tapered', 'radius', 'barrel', 'oval', 'segtaper', 'flat', 'facemill') ? R('Eckenradius', NUM('cornerR', { min: 0, ph: 0 })) : null,
        has('tapered', 'chamfer', 'spot', 'countersink', 'drill', 'center', 'dovetail', 'segtaper') ? R(has('tapered', 'segtaper') ? 'Konuswinkel' : has('dovetail') ? 'Winkel' : 'Spitzenwinkel', NUM('angle', { unit: '°', min: 0.1 })) : null,
        has('chamfer', 'countersink', 'radius', 'counterbore', 'center') ? R(has('counterbore') ? 'Führungszapfen-Ø' : has('center') ? 'Pilot-Ø' : 'Spitzendurchmesser', NUM('tip', { min: 0, ph: 0 })) : null,
        has('lollipop', 'slot', 'dovetail') ? R('Halsdurchmesser', NUM('neckDia', { min: 0.1 })) : null,
        has('barrel', 'lens', 'oval', 'segtaper') ? R('Profilradius', NUM('profileR', { min: 1 })) : null,
        has('tap', 'thread', 'tthread') ? R('Steigung', NUM('pitch', { min: 0.05 })) : null,
        has('turn', 'turnbore') ? R('Schneidenradius', NUM('noseRadius', { min: 0 })) : null,
        has('turn', 'turnbore') ? R('Eckenwinkel der Platte', NUM('insertAngle', { unit: '°', min: 10, ph: 55 })) : null,
        has('turn', 'turnbore') ? R('Einstellwinkel', NUM('leadAngle', { unit: '°', min: 30, ph: 93 })) : null,
        has('groove') ? R('Schneidenbreite', NUM('width', { min: 0.1 })) : null,
        has('groove', 'tthread') ? R('Innenwerkzeug (Bohrstange, Durchmesser = Stangen-Ø)', chk(!!t.internal, v => { t.internal = v; draw(); })) : null));
      add(card('Werkzeugbaugruppe', R('Messlänge', NUM('gauge', { ph: gaugeLen({ ...t, gauge: undefined }) }))));
    }
    if (tab === 'shaft') {
      const segs = t.shaft?.segments || [];
      add(card('Schaft',
        R('Schaftdurchmesser', NUM('shaftDia', { ph: shaftDia({ ...t, shaftDia: undefined }) })),
        h('p', { class: 'hint' }, segs.length ? 'Abgesetzter Schaft aus Segmenten (von unten nach oben):' : 'Einfacher zylindrischer Schaft. Für abgesetzte Schäfte Segmente hinzufügen.'),
        segTable(segs, s => { t.shaft = { segments: s }; draw(); })));
    }
    if (tab === 'holder') {
      const holders = allHolders();
      const segs = t.holder?.segments ? t.holder.segments : isTool ? holderSegments(t).map(x => ({ ...x })) : [];
      add(card(isTool ? 'Halter' : 'Halterkontur',
        isTool ? R('Halter aus Bibliothek', sel([['', t.holder?.name ? `Eigener: ${t.holder.name}` : '– Standardhalter –'], ...holders.map((x, i) => [String(i), `${x.name} (${x.src})`])], '', v => { if (v === '') return; const hd = holders[+v]; t.holder = { name: hd.name, segments: JSON.parse(JSON.stringify(hd.holder.segments)) }; t.holderDia = hd.holder.segments[0].d1; draw(); })) : null,
        R('Bezeichnung', txt(isTool ? (t.holder?.name || '') : t.name, v => { if (isTool) { t.holder = { ...(t.holder || { segments: segs }), name: v }; } else t.name = v; draw(false); })),
        h('p', { class: 'hint' }, 'Halterkontur von der Werkzeugseite nach oben (Spindel). Wird in der Simulation zur Kollisionsprüfung verwendet.'),
        segTable(segs, s => { if (isTool) { t.holder = { ...(t.holder || {}), segments: s }; t.holderDia = s[0]?.d1; } else { t.holder = { segments: s }; t.dia = Math.max(...s.map(x => Math.max(x.d1, x.d2))); } draw(); })));
    }
    if (tab === 'cutting') {
      const pr = presetObj();
      const set = (k, v) => { pr[k] = v; draw(false); };
      const vc = pr.rpm > 0 ? (Math.PI * t.dia * pr.rpm) / 1000 : 0;
      const fz = pr.rpm > 0 ? pr.feed / (pr.rpm * (t.flutes || 2)) : 0;
      add(h('div', { class: 'tled-cut' },
        card('Vorgaben',
          h('div', { class: 'tled-p' + (psel === 'default' ? ' on' : ''), onclick: () => { psel = 'default'; draw(false); } }, 'Vorgabe-Voreinstellung'),
          ...t.presets.map(p => h('div', { class: 'tled-p' + (psel === p.id ? ' on' : ''), onclick: () => { psel = p.id; draw(false); } }, p.name || 'Vorgabe')),
          ro ? null : h('div', { class: 'btns' },
            btn('+ Neu', () => { const id = uid('p'); t.presets.push({ id, name: `Vorgabe ${t.presets.length + 2}`, rpm: t.rpm, feed: t.feed, plunge: t.plunge, stepdown: t.stepdown, stepover: t.stepover, coolant: t.coolant }); psel = id; draw(false); }),
            psel !== 'default' ? btn('Löschen', () => { t.presets = t.presets.filter(p => p.id !== psel); psel = 'default'; draw(false); }, 'danger') : null)),
        card('Schnittdaten',
          psel === 'default' ? null : R('Name', txt(pr.name || '', v => set('name', v))),
          R('Spindeldrehzahl', num(pr.rpm, v => set('rpm', v), { unit: 'U/min', min: 0 })),
          R('Schnittgeschwindigkeit', num(f2(vc), v => set('rpm', Math.round((v * 1000) / (Math.PI * t.dia))), { unit: 'm/min', min: 0 })),
          R('Schnittvorschub', num(pr.feed, v => set('feed', v), { unit: 'mm/min', min: 0 })),
          R('Vorschub pro Zahn', num(+fz.toFixed(4), v => set('feed', Math.round(v * pr.rpm * (t.flutes || 2))), { unit: 'mm', min: 0 })),
          R('Eintauchvorschub', num(pr.plunge, v => set('plunge', v), { unit: 'mm/min', min: 0 })),
          R('Einfahrvorschub', num(pr.leadIn ?? pr.feed, v => set('leadIn', v), { unit: 'mm/min', min: 0 })),
          R('Ausfahrvorschub', num(pr.leadOut ?? pr.feed, v => set('leadOut', v), { unit: 'mm/min', min: 0 })),
          R('Zustellung Z', num(pr.stepdown, v => set('stepdown', v), { unit: 'mm', min: 0.01 })),
          R('Seitliche Zustellung', num(pr.stepover != null ? f2(pr.stepover * 100) : '', v => set('stepover', v / 100), { unit: '%', min: 1 })),
          R('Kühlmittel', sel(Object.entries(COOLANT_MODES), pr.coolant || 'off', v => set('coolant', v))))));
    }
    if (tab === 'post') add(card(null,
      R('Werkzeugnummer', num(t.number, v => { t.number = v; draw(false); }, { unit: null, int: true, min: 0 })),
      R('Längenkorrektur', num(t.lengthOffset ?? t.number, v => (t.lengthOffset = v), { unit: null, int: true, min: 0 })),
      R('Radiuskorrektur', num(t.radiusOffset ?? t.number, v => (t.radiusOffset = v), { unit: null, int: true, min: 0 })),
      R('Manueller Werkzeugwechsel', chk(t.manual, v => (t.manual = v))),
      R('Kommentar', TXT('postComment'))));
    if (ro) form.querySelectorAll('input,select,textarea,button').forEach(e => { if (!e.closest('.tled-p')) e.disabled = true; });
    if (redraw3d) {
      view3d?.dispose();
      mid.replaceChildren();
      view3d = toolView3D(mid, t, { width: 330, height: 460 });
      right.replaceChildren(toolSvg2D(t, { width: 360, height: 500 }));
    }
  };
  back.append(h('div', { class: 'modal tled' },
    h('div', { class: 'tled-top' }, crumb, h('button', { class: 'tled-close', onclick: close }, '✕')),
    tabs,
    h('div', { class: 'tled-main' }, form, mid, right),
    h('div', { class: 'modal-foot' },
      ro ? h('span', { class: 'hint', style: 'margin-right:auto' }, 'Musterbibliothek – mit Kopieren und Einfügen ins Dokument übernehmen.') : h('span', { class: 'hint', style: 'margin-right:auto' }, '3D-Ansicht mit der Maus drehen.'),
      ro ? null : h('button', { class: 'primary', onclick: () => {
        editLib(lib, tools => { const k = tools.findIndex(x => x.id === toolId); if (k >= 0) tools[k] = t; });
        close();
      } }, 'OK'),
      h('button', { onclick: close }, 'Abbrechen'))));
  back.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.append(back);
  draw();
}

// ---- the window ----
function newToolOfType(type) {
  if (!libEditable()) return status('Neue Werkzeuge nur im Dokument oder in eigenen Bibliotheken.');
  const def = CATALOG_DEFAULTS[type] || {};
  const realType = type === 'tapLeft' ? 'tap' : type;
  const id = uid('T');
  const lib = tl.lib;
  editLib(lib, tools => {
    const n = realType === 'holder' ? 0 : Math.max(0, ...tools.map(t => +t.number || 0)) + 1;
    const slow = ['tap', 'ream', 'countersink', 'counterbore'].includes(realType);
    const dia = def.dia ?? 6;
    const vc = { drill: 80, tap: 12, ream: 18, center: 60, spot: 60, countersink: 40, counterbore: 60, thread: 120 }[realType] ?? 180;
    const rpm = ['probe', 'holder', 'waterjet', 'laser', 'plasma', 'arcwire', 'laserpowder', 'laserwire', 'turn', 'turnbore', 'groove', 'tthread'].includes(realType) ? (realType.startsWith('t') || realType === 'groove' ? 1500 : 0) : Math.min(24000, Math.round((vc * 1000) / (Math.PI * dia)));
    const flutes = def.flutes ?? 2;
    const feed = realType === 'tap' ? Math.round(rpm * (def.pitch || 1)) : rpm ? Math.round(Math.min(0.08, Math.max(0.01, 0.006 * dia)) * flutes * rpm) : 300;
    tools.push({ id, number: n, name: `${CATALOG_LABEL[type]}${realType === 'holder' ? '' : ` Ø${dia}`}`, type: realType, ...def, dia, flutes,
      rpm, feed, plunge: slow ? feed : Math.round(feed / 3), stepdown: +(Math.max(0.2, dia * (realType === 'ball' ? 0.1 : 0.5))).toFixed(2), stepover: realType === 'ball' ? 0.1 : 0.4, material: def.material || 'carbide',
      ...(realType === 'holder' ? { holder: { segments: [{ h: 6, d1: 32, d2: 32 }, { h: 30, d1: 42, d2: 50 }, { h: 20, d1: 63, d2: 63 }] }, dia: 63 } : {}) });
  });
  tl.sel = new Set([id]);
  toolSel = id;
  setTimeout(() => editToolDialog(lib, id), 0);
}

function copyTools() {
  const tools = libTools().filter(t => tl.sel.has(t.id));
  if (!tools.length) return status('Kein Werkzeug ausgewählt.');
  tl.clip = JSON.parse(JSON.stringify(tools));
  status(`${tools.length} Werkzeug(e) kopiert`);
  renderToolLib();
}
function pasteTools(lib = tl.lib) {
  if (!tl.clip.length) return status('Zwischenablage ist leer.');
  if (!libEditable(lib)) return status('In diese Bibliothek kann nicht eingefügt werden – Dokument oder eigene Bibliothek wählen.');
  const ids = [];
  editLib(lib, tools => {
    for (const c of tl.clip) {
      const t = { ...JSON.parse(JSON.stringify(c)), id: uid('T') };
      if (tools.some(x => +x.number === +t.number)) t.number = Math.max(0, ...tools.map(x => +x.number || 0)) + 1;
      tools.push(t);
      ids.push(t.id);
    }
  });
  if (lib === tl.lib) tl.sel = new Set(ids);
  status(`${ids.length} Werkzeug(e) eingefügt in „${libName(lib)}“`);
}
function deleteTools() {
  if (!libEditable()) return;
  const ids = [...tl.sel];
  if (!ids.length) return;
  if (tl.lib === 'doc') {
    const busy = ids.filter(id => usedCount(id));
    if (busy.length) return status(`${busy.length} Werkzeug(e) werden noch von Operationen verwendet und können nicht gelöscht werden.`);
  }
  if (getSettings().confirmDelete && !confirm(`${ids.length} Werkzeug(e) löschen?`)) return;
  editLib(tl.lib, tools => { for (const id of ids) { const k = tools.findIndex(t => t.id === id); if (k >= 0) tools.splice(k, 1); } });
  tl.sel.clear();
}
function printTools(tools) {
  const w = window.open('', '_blank');
  if (!w) return status('Popup blockiert – Druckfenster konnte nicht geöffnet werden.');
  const esc = s => String(s ?? '').replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
  w.document.write(tHtml(`<!doctype html><meta charset="utf-8"><title>Werkzeugliste</title><style>body{font:12px sans-serif;margin:20px}table{border-collapse:collapse;width:100%}th,td{border:1px solid #999;padding:4px 6px;text-align:left}th{background:#eee}</style>
    <h2>Werkzeugliste – ${esc(libName())}</h2><p>${new Date().toLocaleString('de-DE')}</p><table><tr><th>T</th><th>Beschreibung</th><th>Typ</th><th>Ø</th><th>R</th><th>Schneiden</th><th>Schneidenl.</th><th>Gesamtl.</th><th>Unter Halter</th><th>n</th><th>vf</th><th>Zulieferer</th></tr>
    ${tools.map(t => `<tr><td>${t.number}</td><td>${esc(t.name)}</td><td>${esc(TOOL_TYPES[t.type])}</td><td>${f2(t.dia)}</td><td>${t.cornerR ? f2(t.cornerR) : ''}</td><td>${t.flutes || ''}</td><td>${f2(toolFlute(t))}</td><td>${f2(toolLen(t))}</td><td>${f2(toolStick(t))}</td><td>${t.rpm}</td><td>${t.feed}</td><td>${esc(t.vendor || '')}</td></tr>`).join('')}</table>`));
  w.document.close();
  w.focus();
  setTimeout(() => w.print(), 300);
}

function filteredTools() {
  const f = tl.filter, q = tl.search.trim().toLowerCase();
  let list = libTools().filter(t =>
    (!f.types.size || f.types.has(t.type)) && (f.dmin == null || t.dia >= f.dmin) && (f.dmax == null || t.dia <= f.dmax)
    && (!f.used || tl.lib !== 'doc' || usedCount(t.id)) && (!f.vendor || String(t.vendor || '').toLowerCase().includes(f.vendor.toLowerCase()))
    && (!q || `${t.number} ${t.name} ${t.dia} ${TOOL_TYPES[t.type]} ${t.vendor || ''} ${t.productId || ''}`.toLowerCase().includes(q)));
  const key = tl.sort.key, dir = tl.sort.dir;
  const val = t => ({ name: +t.number, cornerR: +t.cornerR || 0, dia: +t.dia, fluteLen: toolFlute(t), length: toolLen(t), type: TOOL_TYPES[t.type] || '', flutes: +t.flutes || 0, rpm: +t.rpm, feed: +t.feed, shaftDia: toolShaft(t), stickout: toolStick(t), vendor: t.vendor || '', used: usedCount(t.id) })[key];
  return list.slice().sort((a, b) => { const x = val(a), y = val(b); return (typeof x === 'string' ? x.localeCompare(y) : x - y) * dir || (+a.number - +b.number); });
}
const filterActive = () => tl.filter.types.size || tl.filter.dmin != null || tl.filter.dmax != null || tl.filter.used || tl.filter.vendor || tl.search;

function renderToolLib() {
  const root = $('#toolLib');
  if (!root || wm.get('winTools').el.hidden) return;
  if (libKind(tl.lib) === 'local' && !localLibs().some(l => 'local:' + l.id === tl.lib)) tl.lib = 'doc';
  const tools = filteredTools();
  const all = libTools();
  for (const id of [...tl.sel]) if (!all.some(t => t.id === id)) tl.sel.delete(id);
  if (!tl.sel.size && tools[0]) tl.sel.add(tools[0].id);
  const cur = all.find(t => tl.sel.has(t.id) && t.id === (toolSel && tl.sel.has(toolSel) ? toolSel : [...tl.sel][0]));
  toolSel = cur?.id || null;
  const editable = libEditable();
  const scrollTop = root.querySelector('.twl-tbody')?.scrollTop || 0;

  // ---- left: libraries ----
  const nodeOpen = k => tl.openNodes.has(k);
  const toggle = k => { nodeOpen(k) ? tl.openNodes.delete(k) : tl.openNodes.add(k); renderToolLib(); };
  const libRow = (lib, label, depth, count) => h('div', { class: 'twl-node' + (tl.lib === lib ? ' on' : ''), style: `padding-left:${8 + depth * 14}px`, onclick: () => { tl.lib = lib; tl.sel.clear(); renderToolLib(); },
    oncontextmenu: e => { e.preventDefault(); libMenu(e, lib); } }, h('span', { class: 'twl-tw' }), h('span', { class: 'twl-ico' }, libKind(lib) === 'sample' ? '🔒' : lib === 'doc' ? '📄' : '📁'), h('span', { class: 'twl-lbl' }, label), h('span', { class: 'twl-cnt' }, count));
  const folder = (k, label, depth, extraMenu) => h('div', { class: 'twl-node twl-folder', style: `padding-left:${8 + depth * 14}px`, onclick: () => toggle(k), oncontextmenu: extraMenu ? e => { e.preventDefault(); extraMenu(e); } : null },
    h('span', { class: 'twl-tw' }, nodeOpen(k) ? '▾' : '▸'), h('span', { class: 'twl-lbl' }, label));
  const lq = tl.libSearch.toLowerCase();
  const show = name => !lq || name.toLowerCase().includes(lq);
  const libSearch = h('input', { type: 'search', class: 'twl-search', placeholder: 'Suchen', value: tl.libSearch });
  libSearch.oninput = () => { tl.libSearch = libSearch.value; renderToolLib(); const s = $('#toolLib .twl-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); };
  const locals = localLibs();
  const localMenu = e => ctxMenu(e.clientX, e.clientY, [
    { label: 'Neue Bibliothek', onclick: async () => { const n = await askValue('Name der neuen Bibliothek', 'Meine Werkzeuge'); if (!n?.trim()) return; const libs = localLibs(); const id = uid('L'); libs.push({ id, name: n.trim(), tools: [] }); saveLocalLibs(libs); tl.lib = 'local:' + id; renderToolLib(); } },
    { label: 'Bibliothek importieren … (Fusion, HSM, CSV, WerkFab)', onclick: () => { toolImportTarget = 'newlocal'; $('#toolFileInput').click(); } },
  ], 'Lokal');
  const left = h('div', { class: 'twl-left' }, libSearch, h('div', { class: 'twl-tree' },
    folder('user', 'Benutzerbibliotheken', 0),
    ...(nodeOpen('user') ? [
      folder('docs', 'Dokumente', 1),
      ...(nodeOpen('docs') || true ? [show(state.project.name) ? libRow('doc', state.project.name, 2, state.project.cam.tools.length) : null] : []),
      folder('local', 'Lokal', 1, localMenu),
      ...(nodeOpen('local') ? locals.filter(l => show(l.name)).map(l => libRow('local:' + l.id, l.name, 2, l.tools.length)) : []),
      nodeOpen('local') ? h('div', { class: 'twl-node twl-add', style: 'padding-left:50px', onclick: e => localMenu(e) }, '＋ Neue Bibliothek …') : null,
    ] : []),
    folder('samples', 'Musterbibliotheken', 0),
    ...(nodeOpen('samples') ? SAMPLE_LIBS.filter(l => show(l.name)).map(l => libRow('sample:' + l.id, l.name, 1, l.tools.length)) : []),
  ), h('div', { class: 'twl-leftfoot' }, h('span', { class: 'hint' }, 'Rechtsklick: Bibliotheksfunktionen')));

  // ---- middle: toolbar + table ----
  const ib = (icon, title, fn, dis) => h('button', { class: 'twl-ib', title, disabled: !!dis, onclick: fn, html: icon });
  const I = {
    add: '<svg viewBox="0 0 20 20"><path d="M10 3v14M3 10h14" stroke-width="2"/></svg>',
    edit: '<svg viewBox="0 0 20 20"><path d="M4 16l1-4 8-8 3 3-8 8z"/></svg>',
    copy: '<svg viewBox="0 0 20 20"><rect x="7" y="7" width="9" height="10" rx="1"/><path d="M5 13H4V3h9v1"/></svg>',
    paste: '<svg viewBox="0 0 20 20"><rect x="5" y="4" width="10" height="13" rx="1"/><path d="M8 4V3h4v1"/></svg>',
    dup: '<svg viewBox="0 0 20 20"><rect x="3" y="3" width="9" height="9"/><rect x="8" y="8" width="9" height="9"/></svg>',
    print: '<svg viewBox="0 0 20 20"><rect x="5" y="3" width="10" height="5"/><rect x="3" y="8" width="14" height="6" rx="1"/><rect x="6" y="12" width="8" height="5"/></svg>',
    renum: '<svg viewBox="0 0 20 20"><text x="2" y="9" font-size="7" fill="currentColor" stroke="none">1→6</text><text x="2" y="17" font-size="7" fill="currentColor" stroke="none">2→7</text></svg>',
    clean: '<svg viewBox="0 0 20 20"><path d="M12 3l4 4-7 7-4-4z"/><path d="M5 10l-2 7 7-2"/></svg>',
    del: '<svg viewBox="0 0 20 20"><path d="M4 6h12M8 6V4h4v2M6 6l1 11h6l1-11"/></svg>',
    gear: '<svg viewBox="0 0 20 20"><circle cx="10" cy="10" r="3"/><path d="M10 2v3M10 15v3M2 10h3M15 10h3M4.3 4.3l2.1 2.1M13.6 13.6l2.1 2.1M4.3 15.7l2.1-2.1M13.6 6.4l2.1-2.1"/></svg>',
  };
  const bar = h('div', { class: 'twl-bar' },
    ib(I.add, 'Neues Werkzeug', () => openNewToolPicker(newToolOfType), !editable),
    ib(I.edit, 'Werkzeug bearbeiten (Doppelklick)', () => cur && editToolDialog(tl.lib, cur.id), !cur),
    ib(I.copy, 'Kopieren (Strg+C)', copyTools, !tl.sel.size),
    ib(I.paste, `Einfügen (Strg+V)${tl.clip.length ? ` – ${tl.clip.length} Werkzeug(e)` : ''}`, () => pasteTools(), !tl.clip.length || !editable),
    ib(I.dup, 'Duplizieren', () => { tl.clip = JSON.parse(JSON.stringify(libTools().filter(t => tl.sel.has(t.id)))); pasteTools(); }, !tl.sel.size || !editable),
    ib(I.print, 'Werkzeugliste drucken', () => printTools(tools), !tools.length),
    ib(I.renum, 'Werkzeuge in Tabellenreihenfolge neu nummerieren', () => {
      if (!confirm(`Alle ${tools.length} angezeigten Werkzeuge in der aktuellen Reihenfolge ab T1 neu nummerieren?`)) return;
      const order = tools.map(t => t.id);
      editLib(tl.lib, ts => order.forEach((id, i) => { const t = ts.find(x => x.id === id); if (t) t.number = i + 1; }));
    }, !editable || !tools.length),
    tl.lib === 'doc' ? ib(I.clean, 'Nicht verwendete Werkzeuge entfernen', () => {
      const unused = state.project.cam.tools.filter(t => !usedCount(t.id));
      if (!unused.length) return status('Alle Werkzeuge werden verwendet.');
      if (!confirm(`${unused.length} nicht verwendete Werkzeug(e) aus dem Dokument entfernen?`)) return;
      commit(p => (p.cam.tools = p.cam.tools.filter(t => usedCount(t.id))));
    }) : null,
    h('span', { class: 'twl-sep' }),
    ib(I.del, 'Löschen (Entf)', deleteTools, !tl.sel.size || !editable),
    h('span', { style: 'flex:1' }),
    h('input', { type: 'search', class: 'twl-search twl-tsearch', placeholder: 'Werkzeuge suchen', value: tl.search, oninput: e => { tl.search = e.target.value; renderToolLib(); const s = $('#toolLib .twl-tsearch'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); } }),
    h('button', { class: 'twl-clear', disabled: !filterActive(), onclick: () => { tl.filter = { types: new Set(), dmin: null, dmax: null, used: false, vendor: '' }; tl.search = ''; renderToolLib(); } }, 'Filter löschen'),
    h('button', { class: 'twl-clear', title: 'Werkzeuge importieren (Fusion .json/.tools, HSM .hsmlib, CSV, WerkFab)', onclick: () => { toolImportTarget = tl.lib; $('#toolFileInput').click(); } }, 'Importieren'),
    h('button', { class: 'twl-clear', title: 'Bibliothek als WerkFab-Datei speichern', onclick: () => download(`${libName().replace(/[^\wäöüÄÖÜß -]+/g, '_')}.json`, JSON.stringify(libTools(), null, 1), 'application/json') }, 'Exportieren'));

  const cell = (t, k) => ({ name: toolTitle(t), cornerR: t.cornerR > 0 ? mm(t.cornerR) : toolBase(t) === 'ball' ? mm(t.dia / 2) : '', dia: mm(t.dia), fluteLen: mm(toolFlute(t)), length: mm(toolLen(t)), type: TOOL_TYPES[t.type] || t.type,
    flutes: t.flutes || '', rpm: t.rpm ? `${t.rpm} U/min` : '', feed: t.feed ? `${t.feed} mm/min` : '', shaftDia: mm(toolShaft(t)), stickout: mm(toolStick(t)), vendor: t.vendor || '', used: usedCount(t.id) || '' })[k];
  const head = h('div', { class: 'twl-thead' },
    h('button', { class: 'twl-gear', title: 'Spalten wählen', html: I.gear, onclick: e => ctxMenu(e.clientX, e.clientY, Object.entries(TL_COLUMNS).filter(([k]) => k !== 'name').map(([k, c]) => ({ label: c.label, checked: tlCols.includes(k), onclick: () => { tlCols = tlCols.includes(k) ? tlCols.filter(x => x !== k) : [...tlCols, k]; try { localStorage.setItem(TL_COLS_KEY, JSON.stringify(tlCols)); } catch { /* ignore */ } renderToolLib(); } })), 'Spalten') }),
    ...tlCols.map(k => h('div', { class: 'twl-th' + (k === 'name' ? ' twl-name' : ''), onclick: () => { tl.sort = tl.sort.key === k ? { key: k, dir: -tl.sort.dir } : { key: k, dir: 1 }; renderToolLib(); } },
      TL_COLUMNS[k].label, tl.sort.key === k ? h('span', { class: 'twl-sort' }, tl.sort.dir > 0 ? '▲' : '▼') : null)));
  const bodyRows = h('div', { class: 'twl-tbody', tabindex: '0', onkeydown: e => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'c') { e.preventDefault(); copyTools(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'v') { e.preventDefault(); pasteTools(); }
    else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); tl.sel = new Set(tools.map(t => t.id)); renderToolLib(); }
    else if (e.key === 'Delete') deleteTools();
    else if (e.key === 'Enter' && cur) editToolDialog(tl.lib, cur.id);
    else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const i = tools.findIndex(t => t.id === toolSel); const n = tools[Math.max(0, Math.min(tools.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]; if (n) { tl.sel = new Set([n.id]); toolSel = n.id; renderToolLib(); $('#toolLib .twl-tbody').focus(); } }
  } },
  h('div', { class: 'twl-group' }, libName()),
  ...tools.map((t, i) => h('div', {
    class: 'twl-tr' + (tl.sel.has(t.id) ? ' sel' : '') + (t.id === toolSel ? ' cur' : ''),
    onclick: e => {
      if (e.shiftKey && tl.anchor) { const a = tools.findIndex(x => x.id === tl.anchor); const [lo, hi] = [Math.min(a, i), Math.max(a, i)]; tl.sel = new Set(tools.slice(lo, hi + 1).map(x => x.id)); }
      else if (e.ctrlKey || e.metaKey) { tl.sel.has(t.id) ? tl.sel.delete(t.id) : tl.sel.add(t.id); tl.anchor = t.id; }
      else { tl.sel = new Set([t.id]); tl.anchor = t.id; }
      toolSel = t.id;
      tl.preset = 'default';
      renderToolLib();
      $('#toolLib .twl-tbody')?.focus();
    },
    ondblclick: () => editToolDialog(tl.lib, t.id),
    oncontextmenu: e => {
      e.preventDefault();
      if (!tl.sel.has(t.id)) { tl.sel = new Set([t.id]); toolSel = t.id; renderToolLib(); }
      ctxMenu(e.clientX, e.clientY, [
        { label: editable ? 'Bearbeiten' : 'Anzeigen', icon: '✎', onclick: () => editToolDialog(tl.lib, t.id) },
        { label: 'Kopieren', key: 'Strg+C', onclick: copyTools },
        { label: 'Einfügen', key: 'Strg+V', disabled: !tl.clip.length || !editable, onclick: () => pasteTools() },
        { label: 'Duplizieren', disabled: !editable, onclick: () => { tl.clip = JSON.parse(JSON.stringify(libTools().filter(x => tl.sel.has(x.id)))); pasteTools(); } },
        { sep: true },
        tl.lib !== 'doc' ? { label: 'In Dokument kopieren', onclick: () => { tl.clip = JSON.parse(JSON.stringify(libTools().filter(x => tl.sel.has(x.id)))); pasteTools('doc'); } } : null,
        ...localLibs().filter(l => 'local:' + l.id !== tl.lib).map(l => ({ label: `In „${l.name}“ kopieren`, onclick: () => { tl.clip = JSON.parse(JSON.stringify(libTools().filter(x => tl.sel.has(x.id)))); pasteTools('local:' + l.id); } })),
        { sep: true },
        { label: 'Löschen', icon: '✕', key: 'Entf', danger: true, disabled: !editable, onclick: deleteTools },
      ], `${tl.sel.size} Werkzeug(e)`);
    },
  }, h('div', { class: 'twl-ticon' }, toolIcon(t)), ...tlCols.map(k => h('div', { class: 'twl-td' + (k === 'name' ? ' twl-name' : ''), title: k === 'name' ? toolTitle(t) : '' }, cell(t, k))))),
  tools.length ? null : h('div', { class: 'hint', style: 'padding:14px' }, all.length ? 'Kein Werkzeug passt zum Filter.' : 'Bibliothek ist leer – „+“ für ein neues Werkzeug oder aus einer Musterbibliothek einfügen.'));

  // ---- cutting data (presets) of the current tool ----
  const presets = cur ? [{ ...cur, id: 'default', name: 'Vorgabe-Voreinstellung' }, ...(cur.presets || [])] : [];
  const pv = p => { const vc = p.rpm > 0 ? (Math.PI * cur.dia * p.rpm) / 1000 : 0; const fz = p.rpm > 0 ? p.feed / (p.rpm * (cur.flutes || 2)) : 0; return [p.name, p.rpm ? `${p.rpm} U/min` : '–', vc ? `${f2(vc)} m/min` : '–', p.feed ? `${p.feed} mm/min` : '–', fz ? `${(+fz).toFixed(3)} mm` : '–', `${p.leadIn ?? p.feed ?? '–'} mm/min`, `${p.leadOut ?? p.feed ?? '–'} mm/min`, COOLANT_MODES[p.coolant || 'off']]; };
  const presetBar = h('div', { class: 'twl-bar twl-pbar' },
    ib(I.edit, 'Schnittdaten bearbeiten', () => cur && editToolDialog(tl.lib, cur.id, 'cutting'), !cur),
    ib(I.add, 'Neue Schnittdaten-Vorgabe', () => cur && editLib(tl.lib, ts => { const t = ts.find(x => x.id === cur.id); (t.presets ||= []).push({ id: uid('p'), name: `Vorgabe ${t.presets.length + 2}`, rpm: t.rpm, feed: t.feed, plunge: t.plunge, stepdown: t.stepdown, stepover: t.stepover, coolant: t.coolant }); }), !cur || !editable),
    ib(I.del, 'Vorgabe löschen', () => cur && tl.preset !== 'default' && editLib(tl.lib, ts => { const t = ts.find(x => x.id === cur.id); t.presets = (t.presets || []).filter(p => p.id !== tl.preset); tl.preset = 'default'; }), !cur || !editable || tl.preset === 'default'));
  const presetTable = h('div', { class: 'twl-ptable' },
    h('div', { class: 'twl-prow twl-phead' }, ...['Schnittdaten', 'Spindeldrehzahl', 'Schnittgeschw.', 'Schnittvorschub', 'Vorschub pro Zahn', 'Einfahrvorschub', 'Ausfahrvorschub', 'Kühlmittel'].map(x => h('div', null, x))),
    ...presets.map(p => h('div', { class: 'twl-prow' + (tl.preset === p.id ? ' sel' : ''), onclick: () => { tl.preset = p.id; renderToolLib(); }, ondblclick: () => { tl.preset = p.id; editToolDialog(tl.lib, cur.id, 'cutting'); } }, ...pv(p).map(x => h('div', null, x)))));

  const middle = h('div', { class: 'twl-mid' }, bar, h('div', { class: 'twl-table' }, head, bodyRows), presetBar, presetTable);

  // ---- right: filter / info ----
  const tabsR = h('div', { class: 'twl-rtabs' },
    h('button', { class: tl.tab === 'filter' ? 'on' : '', onclick: () => { tl.tab = 'filter'; renderToolLib(); } }, 'Filter', filterActive() ? h('span', { class: 'twl-dot' }) : null),
    h('button', { class: tl.tab === 'info' ? 'on' : '', onclick: () => { tl.tab = 'info'; renderToolLib(); } }, 'Info'));
  let rbody;
  if (tl.tab === 'filter') {
    const f = tl.filter;
    const typeCounts = Object.fromEntries(Object.keys(TOOL_TYPES).map(k => [k, all.filter(t => t.type === k).length]));
    const dIn = (key, ph) => { const i = h('input', { type: 'number', step: 'any', placeholder: ph, value: f[key] ?? '' }); i.onchange = () => { f[key] = i.value === '' ? null : +i.value; renderToolLib(); }; return i; };
    rbody = h('div', { class: 'twl-filter' },
      h('div', { class: 'twl-ftitle' }, 'Werkzeugtyp'),
      ...Object.entries(TOOL_TYPES).filter(([k]) => typeCounts[k]).map(([k, l]) => h('label', { class: 'twl-fcheck' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = f.types.has(k); c.onchange = () => { c.checked ? f.types.add(k) : f.types.delete(k); renderToolLib(); }; return c; })(),
        h('span', { class: 'twl-ticon' }, toolIcon({ type: k, ...(CATALOG_DEFAULTS[k] || {}) }, 16, 20)), h('span', null, l), h('span', { class: 'twl-cnt' }, typeCounts[k]))),
      h('div', { class: 'twl-ftitle' }, 'Durchmesser'),
      h('div', { class: 'twl-frange' }, dIn('dmin', 'von'), h('span', null, '–'), dIn('dmax', 'bis'), h('span', { class: 'hint' }, 'mm')),
      h('div', { class: 'twl-ftitle' }, 'Zulieferer'),
      h('input', { type: 'text', class: 'twl-ftext', value: f.vendor, placeholder: 'z. B. Garant', onchange: e => { f.vendor = e.target.value; renderToolLib(); } }),
      tl.lib === 'doc' ? h('label', { class: 'twl-fcheck', style: 'margin-top:10px' }, (() => { const c = h('input', { type: 'checkbox' }); c.checked = f.used; c.onchange = () => { f.used = c.checked; renderToolLib(); }; return c; })(), h('span', null, 'Nur in Operationen verwendete')) : null);
  } else if (cur) {
    const P = (k, v) => (v === '' || v == null ? null : h('div', { class: 'twl-prop' }, h('span', null, k), h('b', null, v)));
    rbody = h('div', { class: 'twl-info' },
      h('div', { class: 'twl-crumb' }, ...(tl.lib === 'doc' ? ['Benutzerbibliotheken', 'Dokumente', state.project.name] : libKind(tl.lib) === 'local' ? ['Benutzerbibliotheken', 'Lokal', libName()] : ['Musterbibliotheken', libName()]).flatMap((x, i, a) => [h('span', null, x), i < a.length - 1 ? h('span', { class: 'twl-chev' }, '›') : null])),
      h('div', { class: 'twl-ititle' }, `${cur.number} - Ø${f2(cur.dia)}mm (${cur.name})`),
      h('div', { class: 'twl-prev' }, toolSvg2D(cur, { width: 300, height: 340 })),
      h('div', { class: 'twl-props' },
        P('Beschreibung', cur.name), P('Zulieferer', cur.vendor || '–'), P('Produkt-ID', cur.productId || '–'),
        cur.productLink ? h('div', { class: 'twl-prop' }, h('span', null, 'Produkt-Link'), h('a', { href: cur.productLink, target: '_blank', rel: 'noopener' }, 'öffnen')) : P('Produkt-Link', '–'),
        P('Durchmesser', mm(cur.dia)), P('Schaftdurchmesser', mm(toolShaft(cur))), P('Gesamtlänge', mm(toolLen(cur))), P('Länge unter Halter', mm(toolStick(cur))),
        P('Schulterlänge', mm(toolShoulder(cur))), P('Schneidenlänge', mm(toolFlute(cur))), cur.cornerR > 0 ? P('Eckenradius', mm(cur.cornerR)) : null,
        ['drill', 'chamfer'].includes(cur.type) ? P('Spitzenwinkel', `${f2(cur.angle || 118)}°`) : null, cur.pitch ? P('Steigung', mm(cur.pitch)) : null,
        P('Typ', TOOL_TYPES[cur.type]), P('Einheit', 'Millimeter'), P('Spindelrotation im Uhrzeigersinn', cur.cw === false ? 'nein' : 'ja'),
        P('Anzahl der Schneiden', cur.flutes || 2), P('Material', (TOOL_MATERIALS.find(m => m[0] === (cur.material || 'carbide')) || [0, cur.material])[1]),
        P('Halter-Ø', mm(cur.holderDia ?? defaultHolderDia(cur))), tl.lib === 'doc' ? P('Verwendet in', `${usedCount(cur.id)} Operation(en)`) : null));
  } else rbody = h('p', { class: 'hint', style: 'padding:12px' }, 'Kein Werkzeug ausgewählt.');

  const right = h('div', { class: 'twl-right' }, tabsR, rbody);
  root.replaceChildren(h('div', { class: 'twl' }, left, middle, right),
    h('div', { class: 'twl-foot' }, h('span', { class: 'hint' }, `${tools.length} von ${all.length} Werkzeugen · ${libName()}${editable ? '' : ' (schreibgeschützt)'}`), h('span', { style: 'flex:1' }), h('button', { onclick: () => wm.get('winTools').show(false) }, 'Schließen')));
  const tb = root.querySelector('.twl-tbody');
  if (tb) tb.scrollTop = scrollTop;
}

function libMenu(e, lib) {
  const kind = libKind(lib);
  const items = [
    { label: 'Öffnen', onclick: () => { tl.lib = lib; renderToolLib(); } },
    { label: 'Werkzeuge importieren …', disabled: !libEditable(lib), onclick: () => { toolImportTarget = lib; $('#toolFileInput').click(); } },
    { label: 'Exportieren (.json)', onclick: () => download(`${libName(lib).replace(/[^\wäöüÄÖÜß -]+/g, '_')}.json`, JSON.stringify(libTools(lib), null, 1), 'application/json') },
    { label: `Einfügen${tl.clip.length ? ` (${tl.clip.length})` : ''}`, disabled: !tl.clip.length || !libEditable(lib), onclick: () => pasteTools(lib) },
    kind !== 'doc' ? { label: 'Alle ins Dokument kopieren', onclick: () => { tl.clip = JSON.parse(JSON.stringify(libTools(lib))); pasteTools('doc'); } } : null,
  ];
  if (kind === 'local') items.push({ sep: true },
    { label: 'Umbenennen', onclick: async () => { const libs = localLibs(), L = libs.find(l => 'local:' + l.id === lib); const n = await askValue('Neuer Name', L.name); if (!n?.trim()) return; L.name = n.trim(); saveLocalLibs(libs); renderToolLib(); } },
    { label: 'Bibliothek löschen', icon: '✕', danger: true, onclick: () => { const libs = localLibs(), L = libs.find(l => 'local:' + l.id === lib); if (!confirm(`Bibliothek „${L.name}“ mit ${L.tools.length} Werkzeug(en) löschen?`)) return; saveLocalLibs(libs.filter(l => l !== L)); tl.lib = 'doc'; renderToolLib(); } });
  ctxMenu(e.clientX, e.clientY, items, libName(lib));
}

let toolImportTarget = 'doc';

$('#toolFileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const { tools, skipped, format } = await parseToolLibrary(file);
    if (!tools.length) throw new Error('Keine verwendbaren Werkzeuge gefunden' + (skipped.length ? ` (übersprungen: ${skipped.slice(0, 8).join(', ')})` : ''));
    const renumbered = [];
    // target: document, a local library, or a new local library named after the file
    let target = toolImportTarget || 'doc';
    if (target === 'newlocal') {
      const libs = localLibs(), id = uid('L');
      libs.push({ id, name: file.name.replace(/\.[^.]+$/, ''), tools: [] });
      saveLocalLibs(libs);
      target = 'local:' + id;
    }
    if (!libEditable(target)) target = 'doc';
    const addTo = list => {
      for (const t of tools) {
        const c = { ...t, id: uid('T') };
        if (list.some(x => +x.number === +c.number)) { const n = Math.max(0, ...list.map(x => +x.number || 0)) + 1; renumbered.push(`T${c.number}→T${n}`); c.number = n; }
        list.push(c);
      }
    };
    editLib(target, addTo);
    toolImportTarget = 'doc';
    tl.lib = target;
    renderToolLib();
    alert(`${tools.length} Werkzeug(e) importiert – Format: ${format}`
      + (renumbered.length ? `\n\nNummer schon belegt, umnummeriert: ${renumbered.slice(0, 12).join(', ')}${renumbered.length > 12 ? ' …' : ''}` : '')
      + (skipped.length ? `\n\nNicht übernommen (Halter, Taster oder unbekannter Typ): ${skipped.slice(0, 12).join(', ')}${skipped.length > 12 ? ' …' : ''}` : '')
      + '\n\nBitte Schnittwerte prüfen.');
  } catch (err) {
    alert('Import fehlgeschlagen: ' + err.message);
  }
});

let lastPost = null;
function propsPost(b) {
  setTitle('NC-PROGRAMM');
  const p = state.project;
  const sid = activeSetupId();
  const g = getCam().setups.get(sid);
  b.append(row('Setup', sel(p.cam.setups.map(x => [x.id, x.name]), sid, v => { state.camSetup = v; renderAll(); })));
  if (!g.stock) { b.append(h('p', { class: 'err' }, g.error)); return; }
  const errs = g.ops.filter(o => o.enabled !== false && g.results.get(o.id)?.error);
  b.append(
    row('Postprozessor', h('div', { style: 'display:flex;gap:4px' },
      sel(allPosts(p).map(x => [x.id, x.name + (x.builtin ? '' : ' (eigen)')]), p.post.flavor, v => commit(pp => { ensurePost(pp, v); pp.post.flavor = v; })),
      btn('✎', () => openPostEditor(p.post.flavor)))),
    g.machine ? row('Maschine', h('span', null, g.machine.name)) : null,
    findPost(p, p.post.flavor).builtin && p.post.flavor !== 'heidenhain' ? row('Satznummern', chk(p.post.lineNumbers, v => commit(pp => (pp.post.lineNumbers = v)))) : null,
    row('Kühlmittel (M8)', chk(p.post.coolant, v => commit(pp => (pp.post.coolant = v)))),
    row('Kreisbögen (G2/G3, CC/C)', chk(p.post.arcs !== false, v => commit(pp => (pp.post.arcs = v)))),
    (() => { const d = findPost(p, p.post.flavor); return d.cycleDrill || d.drillCycle; })() ? row('Bohrzyklen', chk(p.post.cycles !== false, v => commit(pp => (pp.post.cycles = v)))) : null,
    errs.length ? h('p', { class: 'err' }, `⚠ ${errs.length} Operation(en) mit Fehler werden übersprungen.`) : null,
  );
  lastPost = postProcess(resolved(), g, g.machine);
  const ta = h('textarea', { class: 'gcode', readonly: true, spellcheck: 'false' });
  ta.value = lastPost.code;
  const ext = findPost(p, p.post.flavor).ext || 'nc';
  for (const w of lastPost.warnings) b.append(h('p', { class: 'err' }, '⚠ ' + w));
  b.append(
    h('div', { class: 'stats' }, h('span', null, 'Zeilen'), h('b', null, lastPost.lines), h('span', null, 'Laufzeit (ca.)'), h('b', null, fmtTime(lastPost.time))),
    h('div', { class: 'btns' },
      btn(`Herunterladen (.${ext})`, () => download(`${safeName()}_${g.setup.name}.${ext}`, lastPost.code, 'text/plain'), 'primary'),
      btn('Kopieren', () => navigator.clipboard.writeText(lastPost.code).then(() => status('NC-Code kopiert'))),
      btn('Einrichteblatt', openSetupSheet),
    ),
    sec('VORSCHAU'),
    ta,
    h('p', { class: 'hint' }, 'Vor dem ersten Lauf immer an der Maschine prüfen (Luftlauf über dem Werkstück).'),
  );
}

// ---------- actions ----------
function select(kind, id = null) {
  if (kind === 'post') return openPostDialog();
  if (state.pick && state.pick.mode !== 'measure') state.pick = null;
  if (kind === 'setup' && id) state.camSetup = id;
  if (kind === 'op') state.camSetup = camOp(id)?.setup || state.camSetup;
  state.sel = { kind, id };
  renderAll();
}

function fitView() {
  const box = getModel().box.clone().union(meshBox());
  const ag = state.workspace === 'cam' ? activeGen() : null;
  if (ag?.stock) {
    const s = ag.stock;
    box.union(new THREE.Box3(new THREE.Vector3(s.minX, s.minY, s.bottom), new THREE.Vector3(s.maxX, s.maxY, s.top)).applyMatrix4(ag.T.clone().invert()));
  }
  const b = box.isEmpty() ? new THREE.Box3(new THREE.Vector3(-50, -50, 0), new THREE.Vector3(50, 50, 20)) : box;
  if (state.sketchId) vp.setViewDir(basis(resolved().features.find(f => f.id === state.sketchId)).n, b);
  else vp.setView('iso', b);
}

function insertFeature(f) {
  commit(p => {
    //: a sketch consumed by a feature is hidden
    const sk = f.sketch && p.features.find(s => s.id === f.sketch);
    if (sk) sk.hidden = true;
    if (state.rollback != null) { p.features.splice(state.rollback, 0, f); state.rollback++; if (state.rollback >= p.features.length) state.rollback = null; }
    else p.features.push(f);
  });
}

function startPickPlane() {
  if (state.pick?.mode === 'plane') { state.pick = null; showBanner(null); renderToolbar(); rebuildScene(); return; }
  state.pick = { mode: 'plane' };
  const mk = name => h('button', { onclick: () => createSketch(BASE_PLANES[name]) }, name);
  const cps = state.project.features.filter(f => f.type === 'plane' && !f.suppressed).map(f => h('button', { onclick: () => sketchOnPlaneFeature(f.id) }, f.name));
  showBanner(['Ebene oder ebene Fläche im Ansichtsfenster anklicken – oder: ', mk('XY'), mk('XZ'), mk('YZ'), ...cps, ' · Esc']);
  renderToolbar();
  rebuildScene();
}

function createSketch(plane) {
  state.pick = null;
  showBanner(null);
  const id = uid('sk');
  insertFeature({ id, type: 'sketch', name: nextName(state.project.features, 'Skizze'), plane, entities: [] });
  editSketch(id);
}

function togglePick(mode, id) {
  const on = !(state.pick?.mode === mode && state.pick.id === id);
  state.pick = on ? { mode, id } : null;
  const ft = feature(id)?.type;
  showBanner(on ? [mode === 'edges' ? 'Kanten anklicken (erneut klicken entfernt).' : ft === 'extrude' ? 'Ebene Flächen anklicken, die extrudiert werden (erneut klicken entfernt).' : ({ surftrim: 'Bereiche der Fläche anklicken, die weggetrimmt werden (erneut klicken nimmt zurück).', offsetsurf: 'Flächen anklicken, die versetzt werden (erneut klicken entfernt).', thicken: 'Flächen anklicken, die aufgedickt werden (erneut klicken entfernt).', draft: 'Flächen anklicken, die geneigt werden (erneut klicken entfernt).', thread: 'Zylinderfläche für das Gewinde anklicken.' }[ft] || 'Flächen anklicken, die offen sein sollen.'), h('button', { onclick: () => togglePick(mode, id) }, 'Fertig')] : null);
  renderAll();
}

const measure = { pts: [] };
function toggleMeasure() {
  const on = state.pick?.mode !== 'measure';
  state.pick = on ? { mode: 'measure' } : null;
  measure.pts = [];
  showBanner(on ? 'Messen: zwei Punkte auf dem Modell anklicken.' : null);
  renderToolbar();
  rebuildScene();
}

function viewportClick(e) {
  // while a long recomputation runs the shown model is the previous one: no picking on it
  if (modelBusy()) return status('Einen Moment – das Modell wird noch berechnet.');
  const meshes = vp.model.children.filter(o => o.isMesh);
  const m = getModel();
  if (state.pick?.mode === 'opheight' || state.pick?.mode === 'oppoints') return opPointPick(e, meshes);
  if (state.pick?.mode === 'decal') return placeDecal(e, meshes);
  if (state.pick?.mode === 'opbound' || state.pick?.mode === 'facegroup') return opFacePick(e, meshes, m);
  if (state.pick?.mode === 'boltHole') return placeBolt(e, meshes);
  if (state.pick?.mode === 'presspull') return pressPullPick(e, meshes, m);
  if (state.pick?.mode === 'cpoints') return pointPickClick(e);
  if (state.pick?.mode === 'axiscyl') return axisCylClick(e, meshes, m);
  if (state.pick?.mode === 'joint') return jointPickClick(e, meshes, m);
  if (state.pick?.mode === 'jorigin') return jointOriginClick(e, meshes, m);
  if (SETUP_PICKS.includes(state.pick?.mode)) return setupPick(e, meshes, m);
  if (state.pick?.mode === 'plane') {
    const pl = planeUnderMouse(e);
    if (pl?.userData.originPlane) return createSketch(BASE_PLANES[pl.userData.originPlane]);
    if (pl?.userData.plane) return sketchOnPlaneFeature(pl.userData.plane);
    const hit = vp.raycast(e, meshes)[0];
    if (!hit) return status('Ebene (XY, XZ, YZ), Konstruktionsebene oder ebene Fläche anklicken.');
    const body = m.bodies[hit.object.userData.body];
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    // planar check: every triangle of the picked B-rep face must share this normal
    const fid = body.faceOf[hit.faceIndex];
    const idx = body.geometry.index.array, pos = body.geometry.attributes.position;
    const a = new THREE.Vector3(), bb = new THREE.Vector3(), c = new THREE.Vector3(), tn = new THREE.Vector3();
    for (let t = 0; t < body.faceOf.length; t++) {
      if (body.faceOf[t] !== fid) continue;
      a.fromBufferAttribute(pos, idx[t * 3]); bb.fromBufferAttribute(pos, idx[t * 3 + 1]); c.fromBufferAttribute(pos, idx[t * 3 + 2]);
      tn.crossVectors(bb.sub(a), c.sub(a));
      if (tn.lengthSq() > 1e-12 && Math.abs(tn.normalize().dot(n)) < 0.9999) return status('Nur ebene Flächen können als Skizzenebene dienen.');
    }
    return createSketch(planeFromFace(hit.point, n));
  }
  if (state.pick?.mode === 'edges') {
    const lines = vp.model.children.filter(o => o.userData.edges);
    const hit = vp.raycast(e, lines, 7)[0];
    if (!hit) return;
    const body = m.bodies[hit.object.userData.body];
    const ei = body.segEdge[Math.floor(hit.index / 2)];
    const ref = edgeMidpoint(body, ei);
    const id = state.pick.id;
    editFeature(id, f => {
      f.edges ||= [];
      const k = f.edges.findIndex(r => Math.hypot(r[0] - ref[0], r[1] - ref[1], r[2] - ref[2]) < 1e-3);
      if (k >= 0) f.edges.splice(k, 1); else f.edges.push(ref);
    });
    return;
  }
  if (state.pick?.mode === 'faces' || state.pick?.mode === 'camfaces') {
    const hop = state.pick.mode === 'camfaces' && camOp(state.pick.id);
    let hit = vp.raycast(e, meshes)[0];
    if (hop && isHoleOp(hop) && hop.probeMode !== 'boss') {
      const setup0 = state.project.cam.setups.find(x => x.id === hop.setup) || state.project.cam.setups[0];
      const c = holeAtRay(e, setupUp(setup0), hop.type === 'drill');
      const fa = c && faceAt(c.pt);
      if (fa) hit = { object: { userData: { body: fa.bi } }, faceIndex: fa.body.faceOf.indexOf(fa.fid), point: new THREE.Vector3(...c.pt) };
    }
    // an edge under the mouse (in front of the faces) selects its chain
    if (hop && EDGE_OPS.includes(hop.type) && !isHoleOp(hop)) {
      const eh = vp.raycast(e, edgePickObjects(), 6)[0];
      if (eh && (!hit || eh.distance <= hit.distance + vp.worldPerPixel() * 6)) {
        const eb = m.bodies[eh.object.userData.body], ei = eb.segEdge[Math.floor(eh.index / 2)];
        const ref = edgeMidpoint(eb, ei);
        return editOp(hop.id, o => {
          o.geomSource = 'model';
          o.edges ||= [];
          const k = o.edges.findIndex(r => Math.hypot(r[0] - ref[0], r[1] - ref[1], r[2] - ref[2]) < 1e-3);
          if (k >= 0) o.edges.splice(k, 1); else o.edges.push(ref);
        });
      }
    }
    if (!hit) return;
    const bi = hit.object.userData.body, body = m.bodies[bi], fid = body.faceOf[hit.faceIndex];
    const p = hop && isHoleOp(hop) ? hit.point.toArray().map(v => +v.toFixed(4)) : faceRefPoint(body, hit.faceIndex);
    // clicking a face that is already selected removes it
    const toggle = list => {
      const k = list.findIndex(r => { const fa = faceAt(r); return fa && fa.bi === bi && fa.fid === fid; });
      if (k >= 0) list.splice(k, 1); else list.push(p);
    };
    if (state.pick.mode === 'faces') return editFeature(state.pick.id, f => toggle(f.faces ||= []));  // p = centroid of the clicked triangle
    const op = camOp(state.pick.id);
    if (!op) return;
    const setup = state.project.cam.setups.find(x => x.id === op.setup) || state.project.cam.setups[0];
    const already = (op.faces || []).some(r => { const fa = faceAt(r); return fa && fa.bi === bi && fa.fid === fid; });
    if (!already) {
      if (isHoleOp(op)) {
        const c = cylinderInfo(m.bodies, p);
        if (!c) return status('Bitte eine Bohrung anklicken (Zylinderfläche).');
        if (Math.abs(new THREE.Vector3(...c.dir).dot(setupUp(setup))) < 0.999) return status('Diese Bohrung steht in diesem Setup nicht senkrecht.');
      } else if (!SURF_FACE_OPS.includes(op.type) && !facePlanarUp(body, fid, setupUp(setup))) return status('Nur ebene Flächen, die nach oben zum Werkzeug zeigen (waagerecht in diesem Setup).');
    }
    return editOp(op.id, o => { o.geomSource = 'model'; toggle(o.faces ||= []); });
  }
  if (state.pick?.mode === 'measure') {
    const hit = vp.raycast(e, meshes)[0];
    if (!hit) return;
    if (measure.pts.length >= 2) measure.pts = [];
    measure.pts.push(hit.point.clone());
    if (measure.pts.length === 2) {
      const [p, q] = measure.pts;
      const d = q.clone().sub(p);
      showBanner(`Abstand ${f2(d.length())} mm · ΔX ${f2(d.x)} · ΔY ${f2(d.y)} · ΔZ ${f2(d.z)}`);
    } else showBanner(`Punkt 1: ${f2(hit.point.x)}, ${f2(hit.point.y)}, ${f2(hit.point.z)} – zweiten Punkt anklicken`);
    rebuildScene();
  }
}

function editSketch(id) {
  if (state.workspace !== 'design') return;
  state.pick = null;
  showBanner(null);
  // linked projections: what the model computed last goes into the stored sketch, so editing starts from it
  {
    const rs = resolved().features.find(f => f.id === id), raw = state.project.features.find(f => f.id === id);
    if (raw?.entities?.some(e => e.proj)) {
      getModel();
      const now = JSON.stringify((rs?.entities || []).filter(e => e.proj));
      if (now !== '[]' && now !== JSON.stringify(raw.entities.filter(e => e.proj))) commit(pp => { const sk = pp.features.find(f => f.id === id); sk.entities = [...sk.entities.filter(e => !e.proj), ...JSON.parse(now)]; });
    }
  }
  state.sketchId = id;
  state.sel = { kind: 'feature', id };
  sketcher.start();
  const sk = resolved().features.find(f => f.id === id);
  const b = basis(sk);
  const box = getModel().box.clone();
  if (box.isEmpty()) box.setFromCenterAndSize(b.o, new THREE.Vector3(120, 120, 120));
  if (getSettings().autoLookAt !== false) vp.setViewDir(b.n, box);
  renderAll();
}

function finishSketch() {
  if (!state.sketchId) return;
  const id = state.sketchId;
  sketcher.finishPolyline();
  sketcher.stop();
  projectMode = 'face';
  state.sketchId = null;
  state.sel = { kind: 'feature', id };
  fitView();
  renderAll();
}

function pickSketch() {
  const sks = state.project.features.filter(f => f.type === 'sketch');
  if (state.sel?.kind === 'feature' && feature(state.sel.id)?.type === 'sketch') return feature(state.sel.id);
  return sks[sks.length - 1];
}

function lastSolidSource() {
  const list = state.project.features.slice(0, state.rollback ?? undefined).filter(f => SOLID_SOURCES.includes(f.type));
  return list[list.length - 1];
}

const planeDefaults = (ref, kind) => (kind === '3pt' ? { kind, pts: [] } : kind === 'tangent' ? { kind, pts: [], r: 0, base: ref, angle: 0 } : { kind, base: ref, ...(kind === 'offset' ? { offset: 20 } : kind === 'angle' ? { axis: 'x', angle: 45 } : { base2: 'XY', offset: undefined }) });

function createFeature(type, extra = {}) {
  if (state.sketchId) return;
  const p = state.project;
  const m = getModel();
  const hasBodies = m.bodies.length > 0;
  const id = uid(type.slice(0, 2));
  const base = { id, type, name: nextName(p.features, FEATURE_TYPES[type]) };
  let f;
  if (type === 'extrude' || type === 'revolve' || type === 'hole') {
    const sk = pickSketch();
    if (!sk && type === 'extrude' && hasBodies) {
      // no sketch: extrude faces of the body (lets you pick a face as the profile)
      f = { ...base, source: 'faces', faces: [], extent: 'one', distance: 5, distance2: 5, op: 'auto' };
      insertFeature(f);
      select('feature', id);
      togglePick('faces', id);
      return;
    }
    if (!sk) return status('Zuerst eine Skizze erstellen.');
    const rsk = resolved().features.find(x => x.id === sk.id);
    if (type === 'extrude') {
      const b = basis(rsk);
      const onTop = hasBodies && Math.abs(b.n.z) > 0.99 && Math.abs(b.o.z - (b.n.z > 0 ? m.box.max.z : m.box.min.z)) < 1e-3;
      f = { ...base, sketch: sk.id, profiles: 'all', extent: 'one', distance: onTop ? -5 : +getSettings().defaultExtrude || 10, distance2: 5, op: onTop ? 'cut' : hasBodies ? 'join' : 'new' };
    } else if (type === 'revolve') {
      const axisLine = rsk.entities.find(e => e.type === 'poly' && !e.closed);
      f = { ...base, sketch: sk.id, profiles: 'all', axis: axisLine ? axisLine.id : 'y', angle: 360, op: hasBodies ? 'join' : 'new' };
    } else {
      if (!hasBodies) return status('Bohrungen brauchen einen Körper.');
      f = { ...base, sketch: sk.id, points: 'all', kind: 'simple', dia: 6, depth: 10, through: false, cbDia: 11, cbDepth: 6, csDia: 12, csAngle: 90, tip: true };
    }
  } else if (type === 'loft') {
    // pick the two most recent sketches with closed profiles on different planes
    const sks = p.features.filter(x => x.type === 'sketch' && x.entities.some(e => e.type !== 'poly' || e.closed)).reverse();
    const planeKey = x => JSON.stringify(sketchPlane(resolved().features.find(r => r.id === x.id)));
    const second = sks.find(x => sks[0] && planeKey(x) !== planeKey(sks[0]));
    if (!second) return status('Erhebung braucht zwei Skizzen mit geschlossenen Profilen auf verschiedenen Ebenen.');
    f = { ...base, sections: [second.id, sks[0].id], ruled: false, op: hasBodies ? 'join' : 'new' };
  } else if (type === 'sweep') {
    const sk = pickSketch();
    if (!sk) return status('Zuerst Profil- und Pfadskizze erstellen.');
    const ps = [...p.features].reverse().find(x => x.type === 'sketch' && x.entities.some(e => e.type === 'poly' && !e.closed));
    if (!ps) return status('Für Sweep wird ein Pfad gebraucht: offene Linie in einer Skizze (mit Enter beenden).');
    const profile = sk.id === ps.id ? [...p.features].reverse().find(x => x.type === 'sketch' && x.id !== ps.id) || sk : sk;
    f = { ...base, sketch: profile.id, profiles: 'all', pathSketch: ps.id, pathEntity: ps.entities.find(e => e.type === 'poly' && !e.closed).id, op: hasBodies ? 'join' : 'new' };
  } else if (type === 'pipe') {
    const ps = [...p.features].reverse().find(x => x.type === 'sketch' && x.entities.some(e => e.type === 'poly' && !e.closed));
    if (!ps) return status('Rohr braucht einen Pfad: offene Linie in einer Skizze (mit Enter beenden).');
    f = { ...base, pathSketch: ps.id, pathEntity: ps.entities.find(e => e.type === 'poly' && !e.closed).id, dia: 10, wall: 1, op: hasBodies ? 'join' : 'new' };
  } else if (type === 'coil') {
    f = { ...base, x: 0, y: 0, z: hasBodies ? f2(m.box.max.z) : 0, axis: 'z', dia: 20, turns: 5, height: 30, section: 2, shape: 'circle', hand: 'right', op: 'new' };
  } else if (type === 'scale') {
    if (!hasBodies) return status('Zuerst einen Körper erstellen.');
    f = { ...base, body: m.bodies[m.bodies.length - 1].id, factor: 2, center: 'origin', cx: 0, cy: 0, cz: 0, copy: false };
  } else if (type === 'thread') {
    if (!hasBodies) return status('Gewinde braucht einen Körper mit Bohrung oder Bolzen.');
    f = { ...base, faces: [], size: 'auto', pitch: null, full: true, length: 10, modeled: false, hand: 'right', flip: false };
  } else if (type === 'draft') {
    if (!hasBodies) return status('Zuerst einen Körper erstellen.');
    f = { ...base, angle: 3, z: f2(m.box.min.z), faces: [] };
  } else if (type === 'split') {
    if (!hasBodies) return status('Zuerst einen Körper erstellen.');
    f = { ...base, body: m.bodies[m.bodies.length - 1].id, plane: 'XY', offset: f2((m.box.min.z + m.box.max.z) / 2) };
  } else if (type === 'freeform') {
    f = { ...base, x: 0, y: 0, w: 100, d: 80, base: 0, smooth: true, op: hasBodies ? 'join' : 'new',
      heights: [[15, 18, 22, 18, 15], [18, 26, 32, 26, 18], [15, 18, 22, 18, 15]] };
  } else if (type === 'sheet') {
    const sk = pickSketch();
    if (!sk) return status('Blech braucht eine Skizze mit geschlossenem Profil auf XY (z. B. ein Rechteck).');
    f = { ...base, sketch: sk.id, thickness: 2, radius: 2, kfactor: 0.44, flanges: [{ edge: 0, on: true, h: 20, angle: 90 }, { edge: 2, on: true, h: 20, angle: 90 }], op: 'new' };
  } else if (type === 'box') f = { ...base, x: 0, y: 0, z: hasBodies ? f2(m.box.max.z) : 0, w: 40, d: 30, h: 20, op: hasBodies ? 'join' : 'new' };
  else if (type === 'cylinder') f = { ...base, x: 0, y: 0, z: hasBodies ? f2(m.box.max.z) : 0, r: 10, h: 20, op: hasBodies ? 'join' : 'new' };
  else if (type === 'sphere') f = { ...base, x: 0, y: 0, z: 0, r: 15, op: hasBodies ? 'join' : 'new' };
  else if (type === 'surfextrude' || type === 'surfrevolve' || type === 'patch') {
    const sk = pickSketch();
    if (!sk) return status('Zuerst eine Skizze mit Kurven erstellen.');
    f = type === 'surfextrude' ? { ...base, sketch: sk.id, curves: 'all', extent: 'one', distance: 10 }
      : type === 'surfrevolve' ? { ...base, sketch: sk.id, curves: 'all', axis: 'y', angle: 360 }
        : { ...base, sketch: sk.id, profiles: 'all' };
  } else if (type === 'surfloft') {
    const sks = p.features.filter(x => x.type === 'sketch');
    if (sks.length < 2) return status('Erhebung braucht zwei Skizzen mit je einer Kurve (auf verschiedenen Ebenen).');
    f = { ...base, sections: sks.slice(-2).map(x => x.id), ruled: false };
  } else if (type === 'surfextend' || type === 'fill') {
    if (!hasBodies) return status(type === 'fill' ? 'Rand füllen braucht Kanten eines Körpers oder einer Fläche.' : 'Verlängern braucht einen Flächenkörper.');
    f = type === 'fill' ? { ...base, edges: [], tangent: false } : { ...base, edges: [], distance: 5 };
  } else if (type === 'surftrim') {
    const surf = [...m.bodies].reverse().find(x => x.surface);
    if (!surf) return status('Trimmen braucht einen Flächenkörper.');
    const other = [...m.bodies].reverse().find(x => x.id !== surf.id);
    f = { ...base, body: surf.id, toolKind: other ? 'body' : 'plane', tool: other?.id || '', plane: 'XY', faces: [] };
  } else if (type === 'offsetsurf') {
    if (!hasBodies) return status('Versatzfläche braucht einen Körper.');
    f = { ...base, faces: [], distance: 2 };
  } else if (type === 'stitch') {
    if (!m.bodies.some(x => x.surface)) return status('Zusammenfügen braucht Flächenkörper (z. B. aus Flächen-Extrusion und Flicken).');
    f = { ...base, bodies: [], tolerance: 0.01 };
  } else if (type === 'thicken') {
    if (!hasBodies) return status('Aufdicken braucht einen Körper, dessen Flächen aufgedickt werden.');
    f = { ...base, thickness: 2, direction: 'out', faces: [], op: 'new' };
  } else if (type === 'fillet' || type === 'chamfer' || type === 'shell') {
    if (!hasBodies) return status('Zuerst einen Körper erstellen.');
    f = type === 'fillet' ? { ...base, radius: 2, edges: [], all: false } : type === 'chamfer' ? { ...base, distance: 1, edges: [], all: false } : { ...base, thickness: 2, faces: [] };
  } else if (type === 'delface') {
    if (!hasBodies) return status('Zuerst einen Körper erstellen.');
    requestFullKernel();
    f = { ...base, faces: [] };
  } else if (type === 'replaceface') {
    if (!hasBodies) return status('Zuerst einen Körper erstellen.');
    f = { ...base, faces: [], planeRef: 'XY', offset: 0 };
  } else if (type === 'offsetface') {
    if (!hasBodies) return status('Zuerst einen Körper erstellen.');
    f = { ...base, faces: [], distance: 1 };
  } else if (type === 'align') {
    if (getModel().bodies.length < 2) return status('Ausrichten braucht zwei Körper.');
    f = { ...base, faces: [], flip: false, offset: 0 };
  } else if (type === 'pattern' || type === 'mirror') {
    const src = lastSolidSource();
    if (!src) return status('Kein Feature zum Vervielfältigen vorhanden.');
    f = type === 'mirror' ? { ...base, target: src.id, plane: 'YZ', offset: 0 }
      : extra.kind === 'circ' ? { ...base, kind: 'circ', target: src.id, axis: 'z', cx: 0, cy: 0, cz: 0, n: 6, angle: 360 }
        : extra.kind === 'path' ? (() => {
          const ps = [...p.features].reverse().find(x => x.type === 'sketch' && x.entities.some(e => e.type === 'poly'));
          return { ...base, kind: 'path', target: src.id, pathSketch: ps?.id || '', pathEntity: ps ? ([...ps.entities].reverse().find(e => e.type === 'poly' && !e.closed) || ps.entities.find(e => e.type === 'poly')).id : '', n: 4, distType: 'extent', dist: 0, orient: 'identical', flip: false };
        })()
        : { ...base, kind: 'rect', target: src.id, dir1: 'x', n1: 3, s1: 20, dir2: 'y', n2: 1, s2: 20 };
  } else if (type === 'move') {
    if (!hasBodies) return status('Kein Körper vorhanden.');
    f = { ...base, body: m.bodies[m.bodies.length - 1].id, dx: 10, dy: 0, dz: 0, rz: 0, cx: 0, cy: 0, copy: false };
  } else if (type === 'plane') {
    const kind = extra.kind || 'offset';
    const ref = state.sel?.kind === 'feature' && ['plane', 'sketch'].includes(feature(state.sel.id)?.type) ? state.sel.id : 'XY';
    f = { ...planeDefaults(ref, kind), id, type, name: nextName(p.features, { offset: 'Versatzebene', angle: 'Winkelebene', mid: 'Mittelebene', '3pt': 'Ebene durch 3 Punkte', tangent: 'Tangentialebene' }[kind]) };
    if (kind === 'tangent' && !hasBodies) return status('Tangentialebene braucht einen Körper mit Zylinderfläche.');
  } else if (type === 'axis') {
    const kind = extra.kind || '2pt';
    if (kind === 'cyl' && !hasBodies) return status('Achse durch Zylinder braucht einen Körper mit Zylinderfläche oder Bohrung.');
    f = { ...base, kind, name: nextName(p.features, { cyl: 'Achse', '2pt': 'Achse', planes: 'Schnittachse' }[kind]), ...(kind === 'planes' ? { base: 'XY', base2: 'XZ' } : { pts: [] }) };
  } else if (type === 'point') {
    f = { ...base, x: 0, y: 0, z: 0 };
  } else if (type === 'emboss') {
    if (!hasBodies) return status('Prägen braucht einen Körper.');
    const sk = pickSketch();
    if (!sk) return status('Zuerst eine Skizze mit Text oder Kontur erstellen (z. B. auf einer Tangentialebene).');
    // sketch on a tangent plane → wrap onto that cylinder right away
    const tp = sk.planeRef && feature(sk.planeRef);
    const onCyl = tp?.type === 'plane' && tp.kind === 'tangent' && tp.pts?.length === 2;
    f = { ...base, sketch: sk.id, profiles: 'all', mode: 'emboss', depth: 0.5, wrap: onCyl ? 'cyl' : 'plane', pts: onCyl ? tp.pts : [], r: onCyl ? tp.r : 0 };
  } else if (type === 'rib') {
    const sk = [...p.features].reverse().find(x => x.type === 'sketch' && x.entities.some(e => e.type === 'poly' && !e.closed));
    if (!sk) return status('Rippe: zuerst eine Skizze mit einer offenen Linie zeichnen.');
    f = { ...base, sketch: sk.id, entity: [...sk.entities].reverse().find(e => e.type === 'poly' && !e.closed).id, thickness: 3, height: 10, symmetric: false, op: hasBodies ? 'join' : 'new' };
  } else if (type === 'torus') {
    f = { ...base, x: 0, y: 0, z: 0, R: 30, r: 6, axis: 'z', op: hasBodies ? 'join' : 'new' };
  } else if (type === 'combine') {
    if (m.bodies.length < 2) return status('Kombinieren braucht mindestens zwei Körper.');
    f = { ...base, body: m.bodies[0].id, tool: m.bodies[1].id, op: 'join', keep: false };
  }
  pendingNew = { id, depth: undoDepth() };
  insertFeature(f);
  state.sel = { kind: 'feature', id };
  if (type === 'fillet' || type === 'chamfer' || type === 'surfextend' || type === 'fill') togglePick('edges', id);
  else if (type === 'delface' || type === 'replaceface' || type === 'offsetface' || type === 'align' || type === 'shell' || type === 'draft' || type === 'thread' || type === 'thicken' || type === 'offsetsurf' || type === 'surftrim') togglePick('faces', id);
  else if (type === 'axis' && f.kind === 'cyl') { state.pick = { mode: 'axiscyl', id }; showBanner(['Zylinderfläche oder Bohrung anklicken.', h('button', { onclick: () => { state.pick = null; showBanner(null); renderAll(); } }, 'Abbrechen')]); renderAll(); }
  else if (type === 'axis' && f.kind === '2pt') startPointPick(id, 'pts', 2);
  else if (type === 'plane' && f.kind === '3pt') startPointPick(id, 'pts', 3);
  else if (type === 'plane' && f.kind === 'tangent') { state.pick = { mode: 'axiscyl', id }; showBanner(['Zylinderfläche anklicken, an die die Ebene tangential anliegen soll.', h('button', { onclick: () => { state.pick = null; showBanner(null); renderAll(); } }, 'Abbrechen')]); renderAll(); }
  else if (type === 'point') startPointPick(id, 'xyz', 1);
  else renderAll();
}

function deleteFeature(id) {
  const p = state.project;
  const f = feature(id);
  const deps = p.features.filter(x => x.sketch === id || x.pathSketch === id || x.target === id || (['plane', 'axis'].includes(x.type) && (x.base === id || x.base2 === id)) || x.axisRef === id || ((x.type === 'revolve' || x.type === 'pattern') && x.axis === id));
  const opsDeps = f.type === 'sketch' ? p.cam.ops.filter(o => o.sketch === id) : [];
  if (deps.length || opsDeps.length) {
    if (!confirm(`„${f.name}“ wird verwendet von: ${[...deps, ...opsDeps].map(x => x.name).join(', ')}.\nAbhängige Features ebenfalls löschen?`)) return;
  }
  else if (getSettings().confirmDelete && !confirm(`„${f.name}“ löschen?`)) return;
  const drop = new Set([id, ...deps.map(d => d.id)]);
  commit(pp => {
    pp.features = pp.features.filter(x => !drop.has(x.id));
    for (const o of pp.cam.ops) if (o.sketch === id) o.sketch = '';
  });
  if (state.rollback != null && state.rollback > state.project.features.length) state.rollback = null;
  state.sel = null;
  state.pick = null;
  showBanner(null);
  renderAll();
}

function addOp(type, opt = {}) {
  const p = state.project;
  if (getModel().box.isEmpty() && meshBox().isEmpty()) return status('Erst einen Körper in KONSTRUKTION erstellen oder ein Netz (STL) einfügen.');
  const rp = resolved();
  const setupId = activeSetupId();
  if (type === 'manual') {
    // lines in the program without a tool or a path
    const id = uid('op');
    const op = { id, type, name: nextName(p.cam.ops, OP_TYPES.manual), enabled: true, setup: setupId, manualKind: opt.kind || 'comment', manualText: '', manualSec: 1 };
    if (opt.batch) return op;
    pendingNew = { id, depth: undoDepth() };
    commit(pp => pp.cam.ops.push(op));
    select('op', id);
    return;
  }
  const M = setupMatrix(p.cam.setups.find(x => x.id === setupId));
  const sketches = p.features.filter(f => f.type === 'sketch' && sketchHorizontalIn(rp.features.find(r => r.id === f.id), M));
  const byType = k => p.cam.tools.find(t => toolBase(t) === k);
  if (type === 'probe' && !byType('probe')) {
    const n = Math.max(0, ...p.cam.tools.map(x => +x.number || 0)) + 1;
    commit(pp => pp.cam.tools.push({ id: uid('T'), number: n, name: '3D-Taster Ø6', type: 'probe', dia: 6, rpm: 0, feed: 300, plunge: 300, stepdown: 1, stepover: 0.5 }));
    status(`3D-Taster als T${n} in der Werkzeugbibliothek angelegt`);
  }
  const turnTool = { tface: 'turn', trough: 'turn', tfinish: 'turn', tgroove: 'groove', tpart: 'groove', tthread: 'tthread', tdrill: 'drill', tbore: 'turnbore', tlive: 'drill', tslot: 'flat', tflat: 'flat', tcontour: 'flat', twrap: 'flat', tpocket: 'flat' }[type];
  const byKind = k => p.cam.tools.find(t => t.type === k) || (k === 'turnbore' ? null : byType(k));
  if (turnTool && !byKind(turnTool)) return status(`Kein ${TOOL_TYPES[turnTool]} in der Werkzeugbibliothek – bitte dort anlegen.`);
  const tool = opt.tool || (turnTool ? byKind(turnTool) : { probe: byType('probe'), rotary: byType('ball'), rotaryRough: byType('flat') || byType('ball'), rotaryWrap: byType('flat') || byType('ball'), drill: byType('drill') || byType('flat'), chamfer: byType('chamfer'), parallel3d: byType('ball') || byType('flat'), contour3d: byType('flat'), thread: byType('thread'), trace: byType('chamfer') || byType('flat'), vcarve: byType('chamfer'), project3d: byType('chamfer') || byType('ball') || byType('flat'),
    steep3d: byType('ball') || byType('flat'), scallop3d: byType('ball') || byType('flat'), spiral3d: byType('ball') || byType('flat'), radial3d: byType('ball') || byType('flat'),
    ramp3d: byType('ball') || byType('flat'), pencil3d: byType('ball'), morphspiral3d: byType('ball') || byType('flat'), blend3d: byType('ball') || byType('flat'), guidemorph3d: byType('ball') || byType('flat'),
    corner3d: byType('ball') || byType('flat'), flow3d: byType('ball') || byType('flat'), morph3d: byType('ball') || byType('flat'), deburr3d: byType('chamfer') || byType('ball'), geodesic3d: byType('ball') || byType('flat') }[type] || byType('flat'));
  if (!tool) return status('Kein passendes Werkzeug in der Bibliothek.');
  let sketch = '';
  if (type === 'drill' || type === 'bore' || type === 'thread' || type === 'circular') sketch = [...sketches].reverse().find(s => s.entities.some(e => e.type === 'circle'))?.id || '';
  else if (type === 'slot') sketch = [...sketches].reverse().find(s => s.entities.some(e => e.type === 'slot' || (e.type === 'poly' && !e.closed)))?.id || '';
  else if (type === 'blend3d' || type === 'guidemorph3d') sketch = [...rp.features].reverse().find(f => f.type === 'sketch' && f.entities.length >= 2)?.id || '';
  else if (!['face', ...OPS_3D].includes(type)) sketch = sketches[sketches.length - 1]?.id || '';
  const id = uid('op');
  const op = {
    id, type, name: nextName(p.cam.ops, OP_TYPES[type]), enabled: true, tool: tool.id, setup: setupId, depth: 0.5, pitch: 1, majorDia: null, hand: 'right',
    sketch, entities: 'all', bottom: null, bottomOffset: 0, stockToLeave: type === 'rough3d' ? 0.3 : 0,
    side: type === 'thread' ? 'inside' : 'outside', direction: 'climb', peck: 0, stepdown: null, stepover: null, ramp: type === 'pocket' || type === 'rough3d' ? 3 : type === 'adaptive' ? 2 : 0, strategy: type === 'rough3d' ? 'adaptive' : undefined,
    tabs: false, tabCount: 4, tabWidth: 5, tabHeight: 1.5, width: 0.5, extraDepth: 0.2, stepoverMm: 0.5, angle: 0,
    // adaptive: light radial, deep axial engagement
    ...(type === 'adaptive' || type === 'rough3d' ? { stepover: 0.12, stepdown: f2(tool.dia * 1.5) } : {}),
    ...(['steep3d', 'scallop3d', 'spiral3d', 'radial3d', 'morphspiral3d', 'blend3d', 'guidemorph3d', 'corner3d', 'flow3d', 'morph3d', 'geodesic3d'].includes(type) ? { stepoverMm: f2(Math.max(0.1, tool.dia * 0.08)) } : {}),
    ...(type === 'adaptive3d' ? { stepover: 0.12, stepdown: f2(tool.dia * 1.5), stockToLeave: 0.3, ramp: 2 } : {}),
    ...(type === 'pocket3d' ? { stockToLeave: 0.3, ramp: 3 } : {}),
    ...(type === 'flat3d' ? { stepoverMm: f2(tool.dia * 0.4), slope: 3 } : {}),
    ...(type === 'rotary' ? { stepoverMm: f2(Math.max(0.1, tool.dia * 0.15)), angleStep: 3, pattern: 'helix' } : {}),
    ...(type === 'rotaryWrap' ? { depth: 0.5, stepdown: null, wrapDia: null } : {}),
    ...(type === 'rotaryRough' ? { stepoverMm: f2(tool.dia * 0.5), angleStep: 4, stepdown: f2(Math.max(0.5, tool.dia * 0.2)), stockToLeave: 0.3 } : {}),
    ...(type === 'ramp3d' ? { stepdown: 0.5 } : {}),
    // 3D strategies have many links: go over the remaining material instead of up to the retract height
    ...(OPS_3D.includes(type) ? { retractPolicy: 'stock' } : {}),
    ...(type === 'plunge3d' ? { stepoverMm: f2(tool.dia * 0.5), rowStep: f2(tool.dia * 0.7), stockToLeave: 0.5, pullBack: 0.3, retractPolicy: 'full' } : {}),
    ...(type === 'tcontour' || type === 'twrap' || type === 'tpocket' ? { depth: 1, side: 'on', stepdown: null, wrapDia: null, ...(type === 'tpocket' ? { stepover: null, ramp: 3 } : {}), sketch: [...rp.features].reverse().find(sk => { if (sk.type !== 'sketch') return false; try { const nz = Math.abs(basis(sk).n.clone().normalize().z); return type !== 'twrap' ? nz > 0.999 : nz < 0.001; } catch { return false; } })?.id || '' } : {}),
    ...(type === 'tslot' ? { depth: 2, count: 1, startAngle: 0, angles: '', zStart: null, zEnd: null, stepdown: null } : {}),
    ...(type === 'tflat' ? { count: 2, startAngle: 0, angles: '', width: null, length: 10, stepdown: null, stepover: null } : {}),
    ...(type === 'tlive' ? { dir: 'axial', depth: 5, count: 4, startAngle: 0, angles: '', pitchDia: null, z: null, ...(liveHolesFromModel(tool.dia)?.set || {}) } : {}),
    ...(type === 'corner3d' ? { restDia: f2(tool.dia * 2), slope: 45, stepdown: f2(Math.max(0.1, tool.dia * 0.08)) } : {}),
    ...(type === 'deburr3d' ? { depth: 0.2, edgeAngle: 30 } : {}),
    ...(type === 'pencil3d' ? { pencilAngle: 20 } : {}),
    ...(type === 'vcarve' ? { maxDepth: 3, stepoverMm: 0.1 } : {}), ...(type === 'project3d' ? { depth: 0.3 } : {}), ...(type === 'steep3d' ? { slope: 45, stepdown: 0.5 } : {}),
  };
  if (FACE_OPS.includes(type)) { op.geomSource = 'model'; op.faces = []; }
  if (type === 'probe') Object.assign(op, { probeMode: 'z', probeDepth: 3, probeClear: 5 });
  if (opt.batch) return op;
  pendingNew = { id, depth: undoDepth() };
  commit(pp => { if (type === 'probe') { const k = pp.cam.ops.findIndex(o => o.setup === setupId); pp.cam.ops.splice(k < 0 ? pp.cam.ops.length : k, 0, op); } else pp.cam.ops.push(op); });
  select('op', id);
  if (op.geomSource === 'model') toggleCamPick(id);
}

// ---------- sketch constraints ----------
function refLabel(rsk, ref) {
  if (ref === 'origin') return 'Ursprung';
  if (ref === 'xaxis') return 'X-Achse';
  if (ref === 'yaxis') return 'Y-Achse';
  const [id, k] = ref.split(':');
  const i = rsk.entities.findIndex(e => e.id === id);
  const e = rsk.entities[i];
  if (!e) return '?';
  const name = describeEntity(e).split(' ')[0] + (i + 1);
  const part = k === 'c' ? 'Mitte' : k === 'o' ? 'Kreis' : k[0] === 'l' ? `Linie ${+k.slice(1) + 1}` : `Punkt ${+k.slice(1) + 1}`;
  return `${name}.${part}`;
}

function applyConstraint(type) {
  const refs = sketcher.selection.slice();
  if (!constraintFor(type, refs)) {
    const need = {
      coincident: '2 Punkte oder Punkt + Linie/Kreis', horizontal: '1 Linie oder 2 Punkte', vertical: '1 Linie oder 2 Punkte', parallel: '2 Linien', perpendicular: '2 Linien',
      collinear: '2 Linien', equal: '2 Linien oder 2 Kreise', tangent: 'Linie + Kreis oder 2 Kreise', concentric: '2 Kreise oder Mittelpunkte', midpoint: 'Punkt + Linie',
      symmetric: '2 Punkte + Symmetrielinie', fix: '1 Punkt',
    }[type];
    return status(`${CONSTRAINTS[type]}: bitte ${need} wählen (Umschalt-Klick für mehrere).`);
  }
  const c = { id: uid('c'), type, refs };
  if (type === 'fix') c.at = sketchHandles(resolved().features.find(f => f.id === state.sketchId).entities).point(refs[0]).map(round6);
  commitSketch(state.sketchId, sk => (sk.constraints ||= []).push(c));
  sketcher.selection = [];
  sketcher.hooks.changed();
}

// D starts the dimension tool (a fitting selection is used right away)
function addDimension() {
  if (!state.sketchId) return;
  sketcher.setTool('dim');
  status('Bemaßung: Kante, Kreis oder Punkt anklicken, Maß mit der Maus wegziehen und mit Klick ablegen.');
}

// a placed dimension: measured value, then the value box opens right at the label
let dimEdit = null, dimEditFocus = false, dimDrag = null;
function createDim(d) {
  const rsk = resolved().features.find(f => f.id === state.sketchId);
  const v = measureDim(rsk.entities, d);
  if (!Number.isFinite(v)) return;
  const c = { id: uid('c'), type: 'dim', kind: d.kind, refs: d.refs, value: +Math.abs(v).toFixed(3), sign: Math.sign(v) || 1, lp: d.lp.map(x => +x.toFixed(3)) };
  dimEdit = c.id;
  dimEditFocus = true;
  sketcher.selConstraint = c.id;
  commitSketch(state.sketchId, sk => (sk.constraints ||= []).push(c));
}
function applyDimEdit(cid, text) {
  dimEdit = null;
  const t = String(text).trim().replace(',', '.');
  const rc = feature(state.sketchId)?.constraints?.find(x => x.id === cid);
  if (!rc || !t) return refreshSketchOverlay();
  let v = /^[-+]?[0-9.]+$/.test(t) ? +t : t;
  if (typeof v === 'string' && !Number.isFinite(evalExpr(v, paramScope(state.project)))) { status(`„${t}“ ist kein gültiger Wert.`); return refreshSketchOverlay(); }
  if (typeof v === 'number' && (!Number.isFinite(v) || (v <= 0 && rc.kind !== 'angle'))) { status('Das Maß muss größer als 0 sein.'); return refreshSketchOverlay(); }
  if (rc.value === v) return refreshSketchOverlay();
  commitSketch(state.sketchId, sk => { sk.constraints.find(x => x.id === cid).value = v; });
}
// drag a dimension label to a new place (dimensions can be pulled away from the geometry)
function startDimDrag(ev, c, sk) {
  const el = ev.currentTarget, sx = ev.clientX, sy = ev.clientY;
  let moved = false;
  const H = sketchHandles(sk.entities);
  const base = dimBase(H, c);
  const mv = e => {
    if (!moved && Math.hypot(e.clientX - sx, e.clientY - sy) < 3) return;
    moved = true;
    const p = sketcher.localPoint(e);
    if (!p) return;
    dimDrag = { cid: c.id, lp: [p[0] - base[0], p[1] - base[1]] };
    refreshSketchOverlay();
  };
  const up = () => {
    removeEventListener('pointermove', mv);
    removeEventListener('pointerup', up);
    if (!moved) return;
    el._dragged = true;
    const lp = dimDrag.lp.map(v => +v.toFixed(3));
    dimDrag = null;
    commitSketch(state.sketchId, s2 => { const x = s2.constraints.find(q => q.id === c.id); if (x) x.lp = lp; });
  };
  addEventListener('pointermove', mv);
  addEventListener('pointerup', up);
}
// redraw only the labels/highlights of the active sketch (mouse moves, dragging labels)
function refreshSketchOverlay() {
  for (const o of vp.sketches.children.filter(x => x.userData.skOverlay)) {
    vp.sketches.remove(o);
    o.traverse(x => { if (x.isCSS2DObject) x.element.remove(); if (x.geometry) x.geometry.dispose(); });
  }
  const f = state.sketchId && resolved().features.find(x => x.id === state.sketchId);
  if (!f) return;
  vp.sketches.add(sketchOverlay(sketcher.override ? { ...f, entities: sketcher.override } : f));
}

function setDimKind(sketchId, cid, kind) {
  const rsk = resolved().features.find(f => f.id === sketchId);
  const c = rsk.constraints.find(x => x.id === cid);
  const v = measureDim(rsk.entities, { ...c, kind });
  commitSketch(sketchId, sk => { const x = sk.constraints.find(q => q.id === cid); x.kind = kind; x.sign = Math.sign(v) || 1; x.value = +Math.abs(v).toFixed(3); });
}

// ---------- section analysis ----------
function toggleSection() {
  if (state.section) { state.section = null; showBanner(null); renderToolbar(); rebuildScene(); return; }
  const box = getModel().box;
  state.section = { axis: 'z', offset: box.isEmpty() ? 0 : f2((box.min.z + box.max.z) / 2), flip: false };
  sectionBanner();
  renderToolbar();
  rebuildScene();
}

function sectionBanner() {
  const sct = state.section;
  const box = getModel().box;
  const lo = box.isEmpty() ? -100 : box.min[sct.axis], hi = box.isEmpty() ? 100 : box.max[sct.axis];
  const range = h('input', { type: 'range', min: lo, max: hi, step: (hi - lo) / 400 || 0.1, value: sct.offset, style: 'width:180px' });
  const val = h('span', { style: 'min-width:60px' }, `${f2(sct.offset)} mm`);
  range.oninput = () => { sct.offset = +range.value; val.textContent = `${f2(sct.offset)} mm`; rebuildScene(); };
  const axis = sel([['x', 'X'], ['y', 'Y'], ['z', 'Z']], sct.axis, v => { sct.axis = v; const b2 = getModel().box; sct.offset = f2((b2.min[v] + b2.max[v]) / 2); sectionBanner(); rebuildScene(); });
  showBanner(['Schnitt:', axis, range, val, h('button', { onclick: () => { sct.flip = !sct.flip; rebuildScene(); } }, '⇅'), h('button', { onclick: toggleSection }, 'Schließen')]);
}

// ---------- sketch entity operations ----------
// ---------- projection, sketch fillet, sketch pattern, DXF, interference ----------
// Projection into the open sketch. Modes: 'face' (a face's boundary or a single edge under the mouse),
// 'body' (silhouette of the whole body on the sketch plane), 'cut' (where the sketch plane cuts the body).
let projectMode = 'face';
function startProject(mode) {
  projectMode = mode;
  sketcher.setTool('project');
  renderToolbar();
  renderProps();
  status({ face: 'Projizieren: Fläche oder Kante eines Körpers anklicken.', body: 'Körperumriss: Körper anklicken.', cut: 'Schnittkurven: Körper anklicken, den die Skizzenebene schneidet.' }[mode]);
}
// The picture of an edge, a face, a body's silhouette or its section goes into the sketch together with a link:
// when the body changes, the model recomputation brings the picture up to date (model.js updateProjections).
function addProjection(link, okMsg, emptyMsg) {
  const rsk = resolved().features.find(f => f.id === state.sketchId);
  let res = null;
  try { res = projectGeometry(link, getModel().bodies, basis(rsk)); } catch (err) { return status(`Projektion fehlgeschlagen: ${err.message || err}`); }
  if (!res) return status('Projizieren von Kanten und Flächen braucht einen Volumenkörper des Standardkerns – Körperumriss und Schnittkurven gehen auch bei Netzen.');
  if (!res.ents.length) return status(emptyMsg);
  const g = uid('pj');
  commitSketch(state.sketchId, sk => res.ents.forEach((e, k) => sk.entities.push({ ...e, id: k ? `${g}_${k}` : uid('e'), projected: true, proj: { ...res.link, g } })));
  status(okMsg(res.ents));
}
function projectFaceAt(evt) {
  const hit = vp.raycast(evt, vp.model.children.filter(o => o.isMesh))[0];
  const bodies = getModel().bodies;
  if (projectMode !== 'face') {
    if (!hit) return status('Keinen Körper getroffen.');
    const body = bodies[hit.object.userData.body];
    return projectMode === 'body'
      ? addProjection({ kind: 'body', body: body.id }, ents => `Körperumriss projiziert: ${ents.length} Kontur(en)`, 'Der Körper hat auf dieser Ebene keinen Umriss.')
      : addProjection({ kind: 'cut', body: body.id }, ents => `${ents.length} Schnittkurve(n) eingefügt`, 'Die Skizzenebene schneidet diesen Körper nicht.');
  }
  // an edge under the mouse (in front of the faces) is projected on its own
  const eh = vp.raycast(evt, edgePickObjects(), 6)[0];
  if (eh && (!hit || eh.distance <= hit.distance + vp.worldPerPixel() * 6)) {
    const eb = bodies[eh.object.userData.body], ed = eb.shape.edges?.[eb.segEdge[Math.floor(eh.index / 2)]];
    if (ed?.pointAt) {
      const m = ed.pointAt(0.5);
      return addProjection({ kind: 'edge', ref: [m.x, m.y, m.z], gt: ed.geomType, body: eb.id }, ents => (ents[0].type === 'circle' ? 'Kante als Kreis projiziert' : 'Kante projiziert'), 'Die Kante steht senkrecht zur Skizzenebene – ihr Abbild ist nur ein Punkt.');
    }
  }
  if (!hit) return status('Keine Fläche oder Kante getroffen.');
  addProjection({ kind: 'face', at: hit.point.toArray(), body: bodies[hit.object.userData.body].id }, ents => `${ents.length} Kontur(en) projiziert`, 'Die Fläche hat auf dieser Ebene keinen Rand (sie steht senkrecht dazu).');
}

// Sketch fillet / chamfer (like common CAD/CAM): corners of polylines and rectangles, and corners where two separate lines
// meet (they are joined into one polyline). 0 removes the rounding / chamfer.
// Toolbar: with corner points selected, those are changed at once; otherwise the tool starts and the corners are
// clicked one by one (hover shows the result)
const sketchFillet = () => sketchCornerTool('fillet');
const sketchChamfer = () => sketchCornerTool('chamfer');
function sketchCornerTool(kind) {
  const rsk = resolved().features.find(f => f.id === state.sketchId);
  const picks = sketcher.selection.filter(r => { const [id, k] = r.split(':'), e = rsk.entities.find(x => x.id === id); return k && k[0] === 'p' && (e?.type === 'rect' || (e?.type === 'poly' && !e.curve)); });
  if (picks.length) return sketchCorner(kind, picks);
  sketcher.setTool(kind);
  status(`${kind === 'fillet' ? 'Abrunden' : 'Fase'}: Ecke anklicken – Linienzug, Rechteck oder Treffpunkt zweier Linien. Das Werkzeug bleibt aktiv, Esc beendet.`);
}
async function sketchCorner(kind, picks) {
  const rsk = resolved().features.find(f => f.id === state.sketchId);
  const what = kind === 'fillet' ? 'Abrunden' : 'Fase';
  if (!picks?.length) return;
  const scope = paramScope(state.project);
  const last = sketcher.cornerVal[kind];
  const txt = await askValue(kind === 'fillet' ? 'Radius der Abrundung (mm, 0 = entfernen):' : 'Fasenabstand (mm, ungleich: „2; 3“, 0 = entfernen):', Array.isArray(last) ? last.join('; ') : String(last));
  if (txt == null || txt === '') return;
  const vals = String(txt).split(/[;×x]/).map(v => evalExpr(v.trim(), scope)).filter(v => Number.isFinite(v));
  if (!vals.length || vals.some(v => v < 0)) return status(`${what}: ungültiger Wert`);
  const value = kind === 'chamfer' && vals.length > 1 ? vals.slice(0, 2) : vals[0];
  if (vals[0] > 0) sketcher.cornerVal[kind] = value;
  const res = applyCorners(rsk.entities, rsk.constraints || [], picks, kind, value, () => uid('c'));
  if (!res.done) return status(`${what}: an diesen Punkten nicht möglich (Bogen, Spline, Linienende ohne zweite Linie oder bemaßte Rechteckmitte).`);
  const changed = new Set(res.changed);
  commitSketch(state.sketchId, sk => {
    // keep the stored values (formulas) of everything that was not rebuilt; take over radii / chamfers
    const raw = Object.fromEntries(sk.entities.map(e => [e.id, e]));
    sk.entities = res.entities.map(e => {
      const r = raw[e.id];
      if (r?.type === 'rect' && e.type === 'poly') {
        // rectangle → polyline: the corners keep the rectangle's formulas (e.g. w = "=laenge")
        const ex = v => (typeof v === 'string' && v.startsWith('=') ? `(${v.slice(1)})` : String(+v));
        const plus = (a, b) => (typeof a === 'number' || !String(a).startsWith('=')) && (typeof b === 'number' || !String(b).startsWith('=')) ? +a + +b : `=${ex(a)}+${ex(b)}`;
        const x1 = plus(r.x, r.w), y1 = plus(r.y, r.h);
        return { ...e, pts: [[r.x, r.y], [x1, r.y], [x1, y1], [r.x, y1]] };
      }
      if (!r || changed.has(e.id)) return e;
      const x = { ...r };
      if (e.radii) x.radii = e.radii; else delete x.radii;
      if (e.chamfers) x.chamfers = e.chamfers; else delete x.chamfers;
      return x;
    });
    const rawC = Object.fromEntries((sk.constraints || []).map(c => [c.id, c]));
    sk.constraints = res.constraints.map(c => (rawC[c.id] ? { ...rawC[c.id], refs: c.refs } : c));
  });
  sketcher.selection = [];
  // corners that do not fit on their edges were made smaller
  const after = resolved().features.find(f => f.id === state.sketchId);
  const small = after.entities.filter(e => e.type === 'poly' && !e.curve).reduce((n, e) => n + cornerPlan(e).clamped.length, 0);
  status(`${what}: ${res.done} Ecke(n)${res.skipped ? `, ${res.skipped} übersprungen` : ''}${changed.size ? ' – Linien/Rechteck zu einem Linienzug verbunden' : ''}${small ? ` · ⚠ ${small} Ecke(n) verkleinert: passen nicht auf die Kanten` : ''}`);
}

function sketchPatternForm(sketchId, e) {
  const st = { nx: 3, dx: 20, ny: 1, dy: 20, n: 6, ang: 360, cx: 0, cy: 0 };
  const f = (label, key, unit) => row(label, h('input', { type: 'text', value: st[key], placeholder: unit, onchange: ev => { st[key] = parseFloat(ev.target.value.replace(',', '.')) || 0; } }));
  const apply = kind => commitSketch(sketchId, sk => {
    if (kind === 'rect') {
      for (let i = 0; i < Math.max(1, st.nx); i++) for (let j = 0; j < Math.max(1, st.ny); j++) {
        if (!i && !j) continue;
        sk.entities.push({ ...translateEntity(e, i * st.dx, j * st.dy), id: uid('e') });
      }
    } else {
      const full = Math.abs(st.ang) >= 360;
      const step = full ? st.ang / st.n : st.ang / Math.max(1, st.n - 1);
      for (let k = 1; k < st.n; k++) sk.entities.push({ ...rotateEntity(e, step * k, [st.cx, st.cy]), id: uid('e') });
    }
  });
  return h('div', null,
    f('Anzahl X', 'nx'), f('Abstand X', 'dx', 'mm'), f('Anzahl Y', 'ny'), f('Abstand Y', 'dy', 'mm'),
    h('div', { class: 'btns' }, btn('Rechteckmuster', () => apply('rect'))),
    f('Anzahl', 'n'), f('Winkel', 'ang', '°'), f('Zentrum X', 'cx', 'mm'), f('Zentrum Y', 'cy', 'mm'),
    h('div', { class: 'btns' }, btn('Kreismuster', () => apply('circ'))),
  );
}

function exportSketchDXF(id) {
  const rsk = resolved().features.find(f => f.id === id);
  if (!rsk?.entities.length) return status('Skizze ist leer.');
  download(`${safeName()}_${rsk.name}.dxf`, writeDXF(rsk.entities), 'application/dxf');
}

$('#dxfInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file || !state.sketchId) return;
  try {
    const { circles, polys, skipped } = parseDXF(await file.text());
    commitSketch(state.sketchId, sk => {
      for (const c of circles) sk.entities.push({ id: uid('e'), type: 'circle', cx: +c.cx.toFixed(4), cy: +c.cy.toFixed(4), r: +c.r.toFixed(4) });
      for (const p of polys) if (p.pts.length >= 2) sk.entities.push({ id: uid('e'), type: 'poly', closed: p.closed, pts: p.pts.map(([x, y]) => [+x.toFixed(4), +y.toFixed(4)]) });
    });
    const sk = Object.entries(skipped).map(([k, v]) => `${v}× ${k}`).join(', ');
    status(`DXF: ${circles.length} Kreise, ${polys.length} Konturen importiert${sk ? ` – übersprungen: ${sk}` : ''}`);
    fitView();
  } catch (err) {
    alert('DXF-Import fehlgeschlagen: ' + err.message);
  }
});

function placedBodies(values = motionValues) {
  const bodies = getModel().bodies;
  if (!assemblyActive()) return bodies;
  return bodies.map(b => ({ ...b, shape: transformShape(b.shape, bodyMatrix(state.project.assembly, b.id, values)) }));
}

function runInterference() {
  const bodies = placedBodies();
  if (bodies.length < 2) return status('Interferenz braucht mindestens zwei Körper.');
  const res = interference(bodies);
  showBanner(res.length
    ? ['⚠ Überschneidungen: ' + res.map(r => `${bodyName(r.a)} ↔ ${bodyName(r.b)}: ${f2(r.volume / 1000)} cm³`).join(' · '), h('button', { onclick: () => showBanner(null) }, 'OK')]
    : ['✓ Keine Überschneidungen zwischen den Körpern.', h('button', { onclick: () => showBanner(null) }, 'OK')]);
}

// ---------- assembly ----------
let motionValues = {};
const motion = { on: false, raf: 0 };
const assemblyActive = () => hasAssembly(state.project.assembly) && !(state.pick && ['edges', 'faces', 'camfaces', 'plane', ...SETUP_PICKS].includes(state.pick.mode)) && !state.sketchId;

function placeSelectedBody() {
  const bodies = getModel().bodies;
  if (!bodies.length) return status('Kein Körper vorhanden.');
  const id = state.sel?.kind === 'body' ? state.sel.id : bodies[bodies.length - 1].id;
  select('body', id);
  status('Position im Eigenschaften-Fenster unter „Komponente“ eintragen.');
}

// Gelenk: click a joint origin on the moving component, then one on the component it is joined to.
// Snap points: hole / shaft (axis end), circle on a flat face (its centre), else the face centre.
function addJoint() {
  const bodies = getModel().bodies;
  if (bodies.length < 2) return addJointManual();
  state.pick = { mode: 'joint', step: 1 };
  jointBanner();
  renderAll();
}
function jointBanner() {
  const s = state.pick;
  showBanner([s.step === 1 ? 'Gelenk: 1. Komponente (wird bewegt) – Bohrung, Zapfen oder Fläche anklicken.' : 'Gelenk: 2. Komponente (Bezug) – Bohrung, Zapfen oder Fläche anklicken.',
    h('button', { onclick: () => { state.pick = null; showBanner(null); renderAll(); } }, 'Abbrechen')]);
}
const v3 = a => a.map(v => +(+v).toFixed(5));
function jointOrigin(body, local, nLocal) {
  const p = local.toArray();
  const ci = cylinderInfo([body], p);
  if (ci) {
    // axis end nearest to the click; the normal points out of that end
    const t = V3dot(V3sub(p, ci.loc), ci.dir);
    const end = Math.abs(t - ci.t0) < Math.abs(t - ci.t1) ? ci.t0 : ci.t1;
    const sign = end === ci.t1 ? 1 : -1;
    return { p: v3(ci.loc.map((v, i) => v + ci.dir[i] * end)), n: v3(ci.dir.map(v => v * sign)), kind: 'axis', r: ci.r };
  }
  const fa = faceAt(p, 1);
  const face = fa && body.shape.faces[fa.fid];
  const n = nLocal.clone().normalize().toArray();
  if (face) {
    // a circle on this face near the click (hole edge, boss) → its centre
    let best = null, bd = Infinity;
    for (const e of face.edges) {
      if (e.geomType !== 'CIRCLE' || !e.isClosed) continue;
      const q = [e.pointAt(0)];
      const bb = e.boundingBox.bounds, ctr = [0, 1, 2].map(k => (bb[0][k] + bb[1][k]) / 2), r = Math.hypot(q[0].x - ctr[0], q[0].y - ctr[1], q[0].z - ctr[2]);
      const d = Math.hypot(p[0] - ctr[0], p[1] - ctr[1], p[2] - ctr[2]);
      if (d < r * 1.6 && d < bd) { bd = d; best = ctr; }
    }
    if (best) return { p: v3(best), n: v3(n), kind: 'circle' };
    const c = face.center;
    return { p: v3([c.x, c.y, c.z]), n: v3(n), kind: 'face' };
  }
  return { p: v3(p), n: v3(n), kind: 'point' };
}
const V3sub = (a, b) => a.map((v, i) => v - b[i]), V3dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
function jointPickClick(e, meshes, m) {
  const hit = vp.raycast(e, meshes)[0];
  if (!hit) return status('Eine Fläche, Bohrung oder einen Zapfen eines Körpers anklicken.');
  const body = m.bodies[hit.object.userData.body];
  // back into the body's own coordinates (the shown mesh may be moved by the assembly)
  const inv = hit.object.matrixWorld.clone().invert();
  const local = hit.point.clone().applyMatrix4(inv);
  const nLocal = hit.face.normal.clone();
  const o = savedOriginNear(body, local) || jointOrigin(body, local, nLocal);
  const s = state.pick;
  if (s.step === 1) { state.pick = { mode: 'joint', step: 2, child: body.id, cO: o }; jointBanner(); renderAll(); return; }
  if (body.id === s.child) return status('Die zweite Komponente muss ein anderer Körper sein.');
  state.pick = null;
  showBanner(null);
  const id = uid('j');
  const turning = s.cO.kind !== 'face' && o.kind !== 'face'; // hole on pin / shaft in hole: a revolute joint
  commit(pp => {
    pp.assembly ||= { placements: {}, joints: [] };
    pp.assembly.joints ||= [];
    pp.assembly.joints = pp.assembly.joints.filter(j => j.child !== s.child);
    pp.assembly.joints.push({ id, name: nextName(pp.assembly.joints, 'Gelenk'), type: turning ? 'revolute' : 'rigid', child: s.child, parent: body.id,
      cO: { p: s.cO.p, n: s.cO.n }, pO: { p: o.p, n: o.n }, flip: false, offset: 0, angle: 0, value: 0, min: -180, max: 180, value2: 0 });
  });
  select('joint', id);
  status(turning ? 'Drehgelenk angelegt – mit dem Regler bewegen.' : 'Starres Gelenk angelegt – Art im Dialog ändern (Dreh-, Schiebe-, Zylindergelenk).');
}

// Gelenkursprung (joint origin): a snap point with direction saved on a body, ahead of the joint
function addJointOrigin() {
  if (state.pick?.mode === 'jorigin') { state.pick = null; showBanner(null); return renderAll(); }
  if (!getModel().bodies.length) return status('Zuerst einen Körper erstellen.');
  state.pick = { mode: 'jorigin' };
  showBanner(['Gelenkursprung: Bohrung, Zapfen oder Fläche anklicken (mehrere nacheinander möglich).', h('button', { onclick: () => { state.pick = null; showBanner(null); renderAll(); } }, 'Fertig')]);
  renderAll();
}
function jointOriginClick(e, meshes, m) {
  const hit = vp.raycast(e, meshes)[0];
  if (!hit) return status('Eine Fläche, Bohrung oder einen Zapfen anklicken.');
  const body = m.bodies[hit.object.userData.body];
  const local = hit.point.clone().applyMatrix4(hit.object.matrixWorld.clone().invert());
  const o = jointOrigin(body, local, hit.face.normal.clone());
  commit(pp => {
    pp.assembly ||= { placements: {}, joints: [] };
    pp.assembly.origins ||= [];
    pp.assembly.origins.push({ id: uid('jo'), name: nextName(pp.assembly.origins, 'Gelenkursprung'), body: body.id, p: o.p, n: o.n });
  });
  status(`Gelenkursprung auf ${bodyName(body)} gesetzt.`);
}
// a saved joint origin near the click (on the same body) wins over the automatic snap
function savedOriginNear(body, local) {
  let best = null, bd = Math.max(2, (vp.worldPerPixel() || 0.2) * 18);
  for (const o of state.project.assembly?.origins || []) {
    if (o.body !== body.id) continue;
    const d = local.distanceTo(new THREE.Vector3(...o.p));
    if (d < bd) { bd = d; best = o; }
  }
  return best && { p: best.p, n: best.n, kind: 'saved' };
}
function propsJointOrigin(b, o) {
  setTitle('GELENKURSPRUNG');
  const ed = fn => commit(pp => fn(pp.assembly.origins.find(x => x.id === o.id)));
  b.append(
    row('Name', txt(o.name, v => ed(x => (x.name = v)))),
    row('Körper', h('span', null, bodyLabel(o.body))),
    sec('LAGE'), ...[0, 1, 2].map(k => row('XYZ'[k], num(o.p[k], v => ed(x => (x.p[k] = v ?? 0)), { unit: 'mm' }))),
    sec('RICHTUNG (Z-ACHSE)'), ...[0, 1, 2].map(k => row('XYZ'[k], num(o.n[k], v => ed(x => (x.n[k] = v ?? 0)), {}))),
    h('div', { class: 'btns' }, btn('Richtung umkehren', () => ed(x => (x.n = x.n.map(v => -v)))), btn('Löschen', () => { commit(pp => (pp.assembly.origins = pp.assembly.origins.filter(x => x.id !== o.id))); state.sel = null; renderAll(); }, 'danger')),
    h('p', { class: 'hint' }, 'Beim Gelenk diesen Punkt anklicken – er hat Vorrang vor dem automatischen Fangen.'));
}

function addJointManual() {
  const bodies = getModel().bodies;
  if (!bodies.length) return status('Gelenke brauchen mindestens einen Körper.');
  const child = state.sel?.kind === 'body' ? state.sel.id : bodies[bodies.length - 1].id;
  const parent = bodies.find(b => b.id !== child)?.id || '';
  const c = getModel().bodies.find(b => b.id === child).geometry.boundingBox.getCenter(new THREE.Vector3());
  const id = uid('j');
  commit(pp => {
    pp.assembly ||= { placements: {}, joints: [] };
    pp.assembly.joints ||= [];
    pp.assembly.joints = pp.assembly.joints.filter(j => j.child !== child); // one joint per component
    pp.assembly.joints.push({ id, name: nextName(pp.assembly.joints, 'Gelenk'), type: 'revolute', child, parent, origin: [f2(c.x), f2(c.y), f2(c.z)], axis: 'z', value: 0, min: -90, max: 90 });
  });
  select('joint', id);
}

function propsJoint(b, j) {
  setTitle('GELENK');
  const ed = fn => commit(pp => fn(pp.assembly.joints.find(x => x.id === j.id)));
  const bodies = bodyOptions();
  const N = (label, key, unit, extra = {}) => row(label, num(j[key], v => ed(x => (x[key] = v)), { unit, ...extra }));
  b.append(
    row('Name', txt(j.name, v => ed(x => (x.name = v)))),
    row('Art', sel(Object.entries(JOINT_TYPES), j.type, v => ed(x => { x.type = v; x.value = x.value2 = x.value3 = 0; if (v === 'slider') { x.min = 0; x.max = 50; } else { x.min = -180; x.max = 180; } }))),
    row('Komponente', sel(bodies, j.child, v => ed(x => (x.child = v)))),
    row('Bezug (Eltern)', sel([['', '– Ursprung –'], ...bodies.filter(([id]) => id !== j.child)], j.parent || '', v => ed(x => (x.parent = v)))),
    ...(j.pO ? [
      sec('AUSRICHTUNG'),
      row('Umkehren', chk(j.flip, v => ed(x => (x.flip = v)))),
      row('Abstand', num(j.offset || 0, v => ed(x => (x.offset = v ?? 0)), { unit: 'mm' })),
      row('Winkel', num(j.angle || 0, v => ed(x => (x.angle = v ?? 0)), { unit: '°' })),
      h('div', { class: 'btns' }, btn('Gelenkursprünge neu wählen', () => { commit(pp => (pp.assembly.joints = pp.assembly.joints.filter(x => x.id !== j.id))); addJoint(); })),
    ] : [
      j.type !== 'rigid' ? row('Achse', sel([['x', 'X'], ['y', 'Y'], ['z', 'Z']], j.axis, v => ed(x => (x.axis = v)))) : null,
      j.type === 'revolute' ? sec('DREHPUNKT') : null,
      ...(j.type === 'revolute' ? [0, 1, 2].map(k => row('XYZ'[k], num(j.origin[k], v => ed(x => (x.origin[k] = v)), { unit: 'mm' }))) : []),
    ]),
    ...jointMotionRows(j, ed),
    h('div', { class: 'btns' },
      j.type !== 'rigid' ? btn('Bewegungsstudie', () => motionStudy(j.id), 'primary') : null,
      btn('Löschen', () => { commit(pp => (pp.assembly.joints = pp.assembly.joints.filter(x => x.id !== j.id))); state.sel = null; renderAll(); }, 'danger')),
    h('p', { class: 'hint' }, 'Die Komponente bewegt sich relativ zu ihrem Bezug. Die Bewegungsstudie fährt den Bereich ab und prüft dabei auf Kollisionen.'),
  );
}

// motion of a joint: a value box and a slider per degree of freedom, limits, contact stop and motion link
function jointMotionRows(j, ed) {
  const dof = JOINT_DOF[j.type] || [];
  if (!dof.length) return [];
  const keys = ['value', 'value2', 'value3'], vkey = k => j.id + (k ? ':' + (k + 1) : '');
  const limited = j.limits !== false;
  const joints = (state.project.assembly?.joints || []).filter(q => q.id !== j.id && (JOINT_DOF[q.type] || []).length);
  const linked = !!(j.link?.from && joints.some(q => q.id === j.link.from));
  const rows = [sec('BEWEGUNG')];
  dof.forEach(([label, unit], k) => {
    const lin = unit === 'mm';
    // the limits apply to the first motion; the others get a fixed range
    const lo = k === 0 && limited ? +j.min : lin ? -100 : -180, hi = k === 0 && limited ? +j.max : lin ? 100 : 180;
    const cur = jointValues(state.project.assembly, j, motionValues)[k];
    const sl = h('input', { type: 'range', min: lo, max: hi, step: (hi - lo) / 400 || 0.5, value: cur, style: 'width:100%', disabled: k === 0 && linked });
    let lastGood = cur; // the slider jumps back here when the component would run into another one
    sl.oninput = () => {
      const next = { ...motionValues, [vkey(k)]: +sl.value };
      // contact stop: the component halts where it would run into another one
      if (j.contact && jointCollides(j, next)) { sl.value = lastGood; status('Anschlag: Die Komponente berührt ein anderes Teil.'); return; }
      lastGood = +sl.value;
      motionValues = next;
      rebuildScene();
    };
    sl.onchange = () => { const v = +sl.value; delete motionValues[vkey(k)]; ed(x => (x[keys[k]] = +v.toFixed(3))); };
    rows.push(row(label, num(+cur.toFixed(3), v => ed(x => (x[keys[k]] = v ?? 0)), { unit, disabled: k === 0 && linked })), row('', sl));
  });
  const u0 = dof[0][1];
  rows.push(
    row('Grenzen', chk(limited, v => ed(x => (x.limits = v)))),
    limited ? row('Minimum', num(j.min, v => ed(x => (x.min = v ?? 0)), { unit: u0 })) : null,
    limited ? row('Maximum', num(j.max, v => ed(x => (x.max = v ?? 0)), { unit: u0 })) : null,
    row('Kontakt (Anschlag)', chk(!!j.contact, v => ed(x => (x.contact = v)))),
    sec('VERKNÜPFUNG'),
    row('Folgt Gelenk', sel([['', '– keins –'], ...joints.map(q => [q.id, `${q.name} (${JOINT_TYPES[q.type]})`])], linked ? j.link.from : '', v => ed(x => { if (v) x.link = { from: v, ratio: x.link?.ratio || 1, offset: 0 }; else delete x.link; }))),
    linked ? row('Übersetzung', num(j.link.ratio ?? 1, v => ed(x => (x.link.ratio = v ?? 1)), { unit: `${u0} je ${JOINT_DOF[joints.find(q => q.id === j.link.from).type][0][1]}` })) : null,
    linked ? h('p', { class: 'hint' }, 'Dieses Gelenk bewegt sich mit dem gewählten (z. B. Zahnräder: Übersetzung = −Zähne₁/Zähne₂). Negative Werte drehen gegenläufig.') : null);
  return rows;
}
// would the component (and what hangs on it) overlap another body at these joint values?
function jointCollides(j, values) {
  const asm = state.project.assembly;
  const moving = new Set([j.child]);
  for (let grew = true; grew;) { grew = false; for (const q of asm.joints || []) if (moving.has(q.parent) && !moving.has(q.child)) { moving.add(q.child); grew = true; } }
  try {
    return interference(placedBodies(values)).some(r => (moving.has(r.a.id) !== moving.has(r.b.id)) && r.volume > 1e-3);
  } catch { return false; }
}
// joint symbol (a ring around the joint axis with a short axis line), drawn where the joint sits
function drawJointGlyphs() {
  const asm = state.project.assembly;
  if (state.workspace !== 'design' || !asm) return;
  for (const o of asm.origins || []) {
    const bm = bodyMatrix(asm, o.body, motionValues);
    const p = new THREE.Vector3(...o.p).applyMatrix4(bm), n = new THREE.Vector3(...o.n).transformDirection(bm).normalize();
    const r = Math.max(1, vp.worldPerPixel() * 16 || 4);
    const u = new THREE.Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize(), w = new THREE.Vector3().crossVectors(n, u);
    const on = state.sel?.kind === 'jorigin' && state.sel.id === o.id;
    for (const [d, col] of [[u, 0xe5484d], [w, 0x40c057], [n, 0x2a8fff]]) {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p, p.clone().addScaledVector(d, r)]), new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true, opacity: on ? 1 : 0.8 }));
      l.renderOrder = 26;
      vp.paths.add(l);
    }
  }
  if (!asm.joints?.length) return;
  const selJ = state.sel?.kind === 'joint' ? state.sel.id : null;
  for (const j of asm.joints) {
    if (!j.pO || j.suppressed) continue;
    const pm = j.parent ? bodyMatrix(asm, j.parent, motionValues) : new THREE.Matrix4();
    const p = new THREE.Vector3(...j.pO.p).applyMatrix4(pm);
    const n = new THREE.Vector3(...j.pO.n).transformDirection(pm).normalize();
    const r = Math.max(1, vp.worldPerPixel() * 14 || 4);
    const u = new THREE.Vector3().crossVectors(n, Math.abs(n.z) < 0.9 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0)).normalize(), w = new THREE.Vector3().crossVectors(n, u);
    const pts = [];
    for (let k = 0; k <= 48; k++) { const a = (k / 48) * Math.PI * 2; pts.push(p.clone().addScaledVector(u, Math.cos(a) * r).addScaledVector(w, Math.sin(a) * r)); }
    const col = j.id === selJ ? 0x1e88ff : 0x868e96;
    const mat = new THREE.LineBasicMaterial({ color: col, depthTest: false, transparent: true });
    const ring = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), mat);
    const axis = new THREE.Line(new THREE.BufferGeometry().setFromPoints([p.clone().addScaledVector(n, -r * 1.6), p.clone().addScaledVector(n, r * 1.6)]), mat);
    ring.renderOrder = axis.renderOrder = 25;
    vp.paths.add(ring, axis);
  }
}

// Sweep a joint (or all) through min..max and report collisions between bodies.
function motionStudy(jointId) {
  const joints = (state.project.assembly?.joints || []).filter(j => j.type !== 'rigid' && !j.link?.from && (!jointId || j.id === jointId));
  if (motion.on) { motion.on = false; cancelAnimationFrame(motion.raf); motionValues = {}; showBanner(null); renderAll(); return; }
  if (!joints.length) return status('Kein bewegliches Gelenk vorhanden (Drehgelenk oder Schiebegelenk anlegen).');
  motion.on = true;
  const steps = 24, hits = [];
  // collision scan first (B-rep intersections), then animate
  for (let k = 0; k <= steps; k++) {
    const vals = Object.fromEntries(joints.map(j => [j.id, +j.min + ((+j.max - +j.min) * k) / steps]));
    const res = interference(placedBodies(vals));
    if (res.length) hits.push(joints.map(j => `${j.name} = ${f2(vals[j.id])}${j.type === 'revolute' ? '°' : ' mm'}`).join(', '));
  }
  showBanner([hits.length ? `⚠ Kollision bei ${hits.length} von ${steps + 1} Stellungen, z. B. ${hits[0]}` : '✓ Keine Kollision im gesamten Bewegungsbereich', h('button', { onclick: () => motionStudy() }, 'Stopp')]);
  const t0 = performance.now();
  const tick = now => {
    if (!motion.on) return;
    const ph = ((now - t0) / 3000) % 2, u = ph < 1 ? ph : 2 - ph;
    motionValues = Object.fromEntries(joints.map(j => [j.id, +j.min + (+j.max - +j.min) * u]));
    rebuildScene();
    motion.raf = requestAnimationFrame(tick);
  };
  motion.raf = requestAnimationFrame(tick);
  renderToolbar();
}

// ---------- drawing window ----------
let drawingCache = null;
// picking on the drawing sheet: 'dim' (two corner points → a dimension) or 'detail' (centre of a detail view)
let dwPick = { mode: null, pts: [] };
// the detail views of a drawing with their view keys: the first one of older drawings is 'detail', the others 'det<id>'
const drawingDetails = d => [...(d.detail ? [{ ...d.detail, key: 'detail' }] : []), ...(d.details || []).map(t => ({ ...t, key: 'det' + t.id }))];
const drawingDetailRef = (d, key) => (key === 'detail' ? d.detail : (d.details || []).find(t => 'det' + t.id === key));
// Axes of the cylindrical faces for the centre lines of a drawing: one entry per axis line (faces around the
// same line are merged), with its extent along the axis and the largest radius.
function drawingAxes(bodies) {
  let faces;
  try { faces = cylinderFaces(bodies); } catch { return []; }
  const axes = new Map();
  for (const f of faces) {
    if (!(f.r >= 0.5)) continue;
    let d = f.dir.slice();
    const big = d.reduce((m, v, i) => (Math.abs(v) > Math.abs(d[m]) ? i : m), 0), sg = d[big] < 0 ? -1 : 1;
    d = d.map(v => v * sg);
    // point of the axis closest to the origin identifies the line
    const tp = -(f.loc[0] * d[0] + f.loc[1] * d[1] + f.loc[2] * d[2]), p = f.loc.map((v, i) => v + d[i] * tp);
    const key = [...d, ...p].map(v => (Math.abs(v) < 5e-4 ? 0 : v).toFixed(3)).join(',');
    // extent measured from p (the face's own range runs from its location, in its own direction)
    const e = [(f.t0 - tp * sg) * sg, (f.t1 - tp * sg) * sg], lo = Math.min(...e), hi = Math.max(...e);
    const a = axes.get(key);
    if (a) { a.t0 = Math.min(a.t0, lo); a.t1 = Math.max(a.t1, hi); a.r = Math.max(a.r, f.r); }
    else axes.set(key, { p, d, t0: lo, t1: hi, r: f.r });
  }
  return [...axes.values()];
}

function openDrawing() {
  if (!getModel().bodies.length) return status('Kein Körper für die Zeichnung vorhanden.');
  wm.get('winDrawing').show(true);
  renderDrawing(true);
}

// The drawing window can also be opened through the window menu: fill the sheet then too.
{
  const w = $('#winDrawing');
  if (w) new MutationObserver(() => { if (!w.hidden && !$('#drawingView')?.firstChild && getModel().bodies.length) renderDrawing(true); }).observe(w, { attributes: true, attributeFilter: ['hidden'] });
}

function renderDrawing(rebuild = false) {
  const root = $('#drawingView');
  if (!root || wm.get('winDrawing').el.hidden) return;
  const p = state.project;
  const d = { sheet: 'A3', scale: 'auto', hidden: true, dims: true, views: { front: true, top: true, left: true, iso: true }, title: {}, ...(p.drawing || {}) };
  const ed = fn => commit(pp => { pp.drawing ||= { ...d }; fn(pp.drawing); });
  // components where the assembly puts them (joints, placements) like the usual drawings of assemblies
  const asm = state.project.assembly;
  const bodies = getModel().bodies.filter(b => !state.hiddenBodies.has(b.id)).map(b => {
    if (!hasAssembly(asm)) return b;
    const M = bodyMatrix(asm, b.id, {});
    if (M.equals(new THREE.Matrix4())) return b;
    return { ...b, shape: transformShape(b.shape, M), geometry: b.geometry.clone().applyMatrix4(M), edges: b.edges.clone().applyMatrix4(M) };
  });
  // view positions are not part of the drawing itself (moving a view needs no new computation)
  const key = model.key + JSON.stringify({ ...d, offsets: undefined }) + JSON.stringify(asm || null);
  if (rebuild || !drawingCache || drawingCache.key !== key) {
    const mat = MATERIALS[bodyMeta(bodies[0]?.id).material || 'alu'];
    let mass = '';
    try { mass = bodies.length ? `${String(f2(bodies.reduce((a, b) => a + bodyProps(b).volume, 0) / 1000 * mat.density)).replace('.', ',')} g` : ''; } catch { /* skip */ }
    const section = d.section ? drawingSection(bodies, d) : null;
    const sectionX = d.sectionX ? drawingSection(bodies, d, 'x') : null;
    // parts list: one line per body name (same name = same part, counted)
    let parts = null;
    if (d.partsList) {
      const by = new Map();
      for (const b of bodies) {
        const meta = bodyMeta(b.id), m2 = MATERIALS[meta.material || 'alu'];
        let g = '';
        try { g = b.surface ? '–' : `${String(f2((bodyProps(b).volume / 1000) * m2.density)).replace('.', ',')} g`; } catch { /* skip */ }
        const nm = bodyName(b), cur = by.get(nm);
        if (cur) { cur.qty++; cur.ids.push(b.id); } else by.set(nm, { name: nm, material: m2.label, mass: g, qty: 1, ids: [b.id] });
      }
      parts = [...by.values()];
    }
    drawingCache = { key, sectionY: section?.y, sectionXv: sectionX?.x, sectionStepX: section?.stepX, sectionY2: section?.y2, ...makeDrawing(bodies, { ...d, section, sectionX, details: drawingDetails(d), parts, axes: d.centerLines === false ? [] : drawingAxes(bodies), threads: getModel().threads || [], userDims: d.userDims || [], detail: null, title: { name: p.name, material: mat.label, mass, ...d.title } }) };
  }
  const placed = placedDrawingSvg(drawingCache.svg, d.offsets);
  root.replaceChildren();
  const T = (label, k) => row(label, txt(d.title?.[k] ?? '', v => ed(x => { x.title ||= {}; x.title[k] = v; })));
  const side = h('div', { class: 'dw-side' },
    sec('BLATT'),
    row('Format', sel(Object.keys(SHEETS).map(k => [k, `${k} quer`]), d.sheet, v => ed(x => (x.sheet = v)))),
    row('Maßstab', sel([['auto', 'automatisch'], ...[5, 2, 1, 0.5, 0.2, 0.1].map(s2 => [s2, s2 >= 1 ? `${s2}:1` : `1:${1 / s2}`])], d.scale, v => ed(x => (x.scale = v === 'auto' ? 'auto' : +v)))),
    sec('ANSICHTEN'),
    ...Object.entries(DRAW_VIEWS).map(([k, v]) => row(v.label, chk(d.views?.[k] !== false, on => ed(x => { x.views ||= {}; x.views[k] = on; })))),
    row('Verdeckte Kanten', chk(d.hidden !== false, v => ed(x => (x.hidden = v)))),
    row(`Vorderansicht als Schnitt${drawingCache.sections?.front ? ` ${drawingCache.sections.front}–${drawingCache.sections.front}` : ''}`, chk(!!d.section, v => ed(x => (x.section = v)))),
    d.section ? row('Schnittverlauf', sel([['full', 'Vollschnitt (gerade)'], ['half', 'Halbschnitt (rechte Hälfte)'], ['step', 'Abgesetzt (zwei Ebenen)']], d.sectionMode || 'full', v => ed(x => (x.sectionMode = v)))) : null,
    d.section ? row(d.sectionMode === 'step' ? 'Schnittlage Y links' : 'Schnittlage Y', num(d.sectionY ?? drawingCache.sectionY ?? null, v => ed(x => (x.sectionY = v)), { unit: 'mm', allowEmpty: true, ph: 'automatisch' })) : null,
    d.section && d.sectionMode === 'step' ? row('Schnittlage Y rechts', num(d.sectionY2 ?? drawingCache.sectionY2 ?? null, v => ed(x => (x.sectionY2 = v)), { unit: 'mm', allowEmpty: true, ph: 'automatisch' })) : null,
    d.section && ['half', 'step'].includes(d.sectionMode) ? row(d.sectionMode === 'half' ? 'Geschnitten ab X' : 'Sprung bei X', num(d.sectionStepX ?? drawingCache.sectionStepX ?? null, v => ed(x => (x.sectionStepX = v)), { unit: 'mm', allowEmpty: true, ph: 'Mitte' })) : null,
    row(`Seitenansicht als Schnitt${drawingCache.sections?.left ? ` ${drawingCache.sections.left}–${drawingCache.sections.left}` : ''}`, chk(!!d.sectionX, v => ed(x => (x.sectionX = v)))),
    d.sectionX ? row('Schnittlage X', num(d.sectionXv ?? drawingCache.sectionXv ?? null, v => ed(x => (x.sectionXv = v)), { unit: 'mm', allowEmpty: true, ph: 'automatisch' })) : null,
    (d.section && !drawingCache.sections?.front && d.views?.front !== false) || (d.sectionX && !drawingCache.sections?.left && d.views?.left !== false) ? h('p', { class: 'warn' }, 'Die Schnittlage liegt außerhalb des Teils – der Schnitt wird nicht gezeichnet.') : null,
    d.offsets && Object.keys(d.offsets).length ? h('div', { class: 'btns' }, btn('Ansichten zurücksetzen', () => ed(x => delete x.offsets))) : null,
    row('Bemaßung', chk(d.dims !== false, v => ed(x => (x.dims = v)))),
    row('Mittellinien', chk(d.centerLines !== false, v => ed(x => (x.centerLines = v)))),
    sec('EIGENE MASSE'),
    h('div', { class: 'btns' },
      btn(dwPick.mode === 'dim' ? (dwPick.pts.length ? '2. Punkt anklicken …' : '1. Punkt anklicken …') : 'Maß hinzufügen', () => { dwPick = dwPick.mode === 'dim' ? { mode: null, pts: [] } : { mode: 'dim', pts: [] }; renderDrawing(); }, dwPick.mode === 'dim' ? 'on' : 'primary')),
    row('Richtung', sel([['auto', 'automatisch'], ['h', 'waagerecht'], ['v', 'senkrecht'], ['a', 'ausgerichtet'], ['rad', 'Kreise als Radius'], ['ang', 'Winkel (Scheitel, dann je ein Punkt auf den Schenkeln)'], ['cha', 'Fase (beide Enden der Fasenkante)']], d.dimKind || 'auto', v => { dwPick = { mode: dwPick.mode, pts: [] }; ed(x => (x.dimKind = v)); })),
    h('div', { class: 'btns' }, btn(dwPick.mode === 'note' ? 'Stelle im Blatt anklicken …' : 'Hinweis mit Pfeil hinzufügen', () => { dwPick = dwPick.mode === 'note' ? { mode: null, pts: [] } : { mode: 'note', pts: [] }; renderDrawing(); }, dwPick.mode === 'note' ? 'on' : ''),
      btn(dwPick.mode === 'surf' ? 'Kante im Blatt anklicken …' : 'Oberflächenzeichen hinzufügen', () => { dwPick = dwPick.mode === 'surf' ? { mode: null, pts: [] } : { mode: 'surf', pts: [] }; renderDrawing(); }, dwPick.mode === 'surf' ? 'on' : ''),
      btn(dwPick.mode === 'gdt' ? 'Stelle im Blatt anklicken …' : 'Form-/Lagetoleranz hinzufügen', () => { dwPick = dwPick.mode === 'gdt' ? { mode: null, pts: [] } : { mode: 'gdt', pts: [] }; renderDrawing(); }, dwPick.mode === 'gdt' ? 'on' : ''),
      btn(dwPick.mode === 'datum' ? 'Kante im Blatt anklicken …' : 'Bezug hinzufügen', () => { dwPick = dwPick.mode === 'datum' ? { mode: null, pts: [] } : { mode: 'datum', pts: [] }; renderDrawing(); }, dwPick.mode === 'datum' ? 'on' : '')),
    h('p', { class: 'hint' }, 'Eigene Maße und Hinweise lassen sich im Blatt mit der Maus ziehen (Abstand der Maßlinie, Winkel der Hinweislinie, Radius des Winkelbogens). Zwei Ecken anklicken = Längenmaß. Einen Kreisrand in der Draufsicht anklicken = Durchmesser (bzw. Radius). Winkel: erst die Ecke, dann je einen Eckpunkt auf beiden Schenkeln. Fase: beide Enden der schrägen Kante – ergibt z. B. 2×45°. Im Textfeld hinter jedem Maß steht ein Zusatz wie ±0,1, H7 oder 4×.'),
    ...(d.userDims || []).map((dm, i) => h('div', { class: 'dw-dim' },
      h('span', null, `${{ front: 'Vorne', top: 'Oben', left: 'Links' }[dm.view] || (drawingCache.details?.find(t => t.key === dm.view) ? 'Detail ' + drawingCache.details.find(t => t.key === dm.view).letter : dm.view)}: ${dm.kind === 'note' ? 'Hinweis' : dm.kind === 'surf' ? 'Oberfläche' : dm.kind === 'gdt' ? 'Toleranz' : dm.kind === 'datum' ? 'Bezug' : dm.kind === 'ang' ? 'Winkel ' + f2((() => { let w = Math.atan2(dm.b[1] - dm.v[1], dm.b[0] - dm.v[0]) - Math.atan2(dm.a[1] - dm.v[1], dm.a[0] - dm.v[0]); while (w > Math.PI) w -= 2 * Math.PI; while (w < -Math.PI) w += 2 * Math.PI; return (Math.abs(w) * 180) / Math.PI; })()) + '°' : dm.kind === 'dia' ? 'Ø' + f2(2 * dm.r) : dm.kind === 'rad' ? 'R' + f2(dm.r) : f2(dm.kind === 'h' ? Math.abs(dm.a[0] - dm.b[0]) : dm.kind === 'v' ? Math.abs(dm.a[1] - dm.b[1]) : Math.hypot(dm.a[0] - dm.b[0], dm.a[1] - dm.b[1])) + ' mm'}`),
      dm.kind === 'gdt' ? Object.assign(sel([['pos', 'Position'], ['flat', 'Ebenheit'], ['straight', 'Geradheit'], ['round', 'Rundheit'], ['cyl', 'Zylinderform'], ['par', 'Parallelität'], ['perp', 'Rechtwinkligkeit'], ['angle', 'Neigung'], ['conc', 'Koaxialität'], ['sym', 'Symmetrie'], ['run', 'Rundlauf']], dm.sym || 'pos', v => ed(x => (x.userDims[i].sym = v))), { title: 'Toleranzart', style: 'width:92px' }) : null,
      dm.kind === 'surf' ? Object.assign(sel([['m', 'spanend'], ['any', 'beliebig'], ['none', 'ohne Abtrag']], dm.sym || 'm', v => ed(x => (x.userDims[i].sym = v))), { title: 'Fertigungsverfahren', style: 'width:92px' }) : null,
      Object.assign(txt(['note', 'surf', 'gdt', 'datum'].includes(dm.kind) ? dm.text || '' : dm.txt || '', v => ed(x => { if (['note', 'surf', 'gdt', 'datum'].includes(dm.kind)) x.userDims[i].text = v; else x.userDims[i].txt = v; })), { placeholder: { surf: 'Ra 3,2', note: 'Text', gdt: '0,05 A', datum: 'A' }[dm.kind] || '±0,1 / H7', title: { surf: 'Rauheitsangabe', note: 'Text des Hinweises', gdt: 'Toleranzwert, dahinter die Bezüge (durch Leerzeichen getrennt), z. B. Ø0,05 A B', datum: 'Bezugsbuchstabe' }[dm.kind] || 'Zusatz hinter der Maßzahl (Toleranz, Passung, Anzahl)', style: 'width:64px' }),
      dm.kind === 'surf' || dm.kind === 'datum' ? num(dm.ang ?? 0, v => ed(x => (x.userDims[i].ang = v ?? 0)), { unit: '°' }) :
      dm.kind === 'note' || dm.kind === 'gdt' ? num(dm.ang ?? 45, v => ed(x => (x.userDims[i].ang = v ?? 45)), { unit: '°' }) :
      dm.kind === 'dia' || dm.kind === 'rad'
        ? num(dm.ang ?? 45, v => ed(x => (x.userDims[i].ang = v ?? 45)), { unit: '°' })
        : num(dm.off ?? 16, v => ed(x => (x.userDims[i].off = v ?? 16)), { unit: 'Abst.', min: 2 }),
      h('button', { class: 'gx', title: 'Maß löschen', onclick: () => ed(x => x.userDims.splice(i, 1)) }, '✕'))),
    sec('DETAILANSICHTEN'),
    ...drawingDetails(d).map(dt => h('div', null,
      h('p', { class: 'hint', style: 'margin:6px 0 2px;font-weight:600' }, `Detail ${drawingCache.details?.find(t => t.key === dt.key)?.letter || ''} (${{ front: 'Vorderansicht', top: 'Draufsicht', left: 'Seitenansicht' }[dt.view] || dt.view})`),
      row('Vergrößerung', sel([[2, '2×'], [3, '3×'], [4, '4×'], [5, '5×'], [10, '10×']], dt.factor || 2, v => ed(x => (drawingDetailRef(x, dt.key).factor = +v)))),
      row('Radius', num(dt.r, v => ed(x => (drawingDetailRef(x, dt.key).r = v || 10)), { unit: 'mm', min: 1 })),
      h('div', { class: 'btns' },
        btn(dwPick.mode === 'detail' && dwPick.key === dt.key ? 'Mitte im Blatt anklicken …' : 'Neu platzieren', () => { dwPick = dwPick.mode === 'detail' && dwPick.key === dt.key ? { mode: null, pts: [] } : { mode: 'detail', key: dt.key, pts: [] }; renderDrawing(); }, dwPick.mode === 'detail' && dwPick.key === dt.key ? 'on' : ''),
        btn('Entfernen', () => ed(x => {
          if (dt.key === 'detail') delete x.detail; else x.details = (x.details || []).filter(t => 'det' + t.id !== dt.key);
          // its own dimensions and its place on the sheet go with it
          if (x.userDims) x.userDims = x.userDims.filter(u => u.view !== dt.key);
          if (x.offsets) delete x.offsets[dt.key];
        }), 'danger')))),
    h('div', { class: 'btns' }, btn(dwPick.mode === 'detail' && !dwPick.key ? 'Mitte im Blatt anklicken …' : 'Detail hinzufügen', () => { dwPick = dwPick.mode === 'detail' && !dwPick.key ? { mode: null, pts: [] } : { mode: 'detail', pts: [] }; renderDrawing(); }, dwPick.mode === 'detail' && !dwPick.key ? 'on' : '')),
    drawingDetails(d).length ? h('p', { class: 'hint' }, 'Maße, Hinweise und Toleranzen lassen sich auch in einer Detailansicht setzen – sie zeigen die wahren Größen.') : null,
    sec('STÜCKLISTE'),
    row('Stückliste auf dem Blatt', chk(!!d.partsList, v => ed(x => (x.partsList = v)))),
    d.partsList ? row('Positionsnummern', chk(!!d.balloons, v => ed(x => (x.balloons = v)))) : null,
    sec('SCHRIFTFELD'),
    T('Benennung', 'name'), T('Zeichnungsnr.', 'number'), T('Werkstoff', 'material'), T('Gezeichnet', 'author'),
    h('div', { class: 'btns' },
      btn('Drucken / PDF', () => { const w = window.open('', '_blank'); if (!w) return status('Popup blockiert.'); w.document.write(`<!doctype html><title>${p.name}</title><style>@page{size:${d.sheet} landscape;margin:0}body{margin:0}svg{width:100vw;height:auto}</style>${tHtml(placed)}<script>onload=()=>print()<\/script>`); w.document.close(); }, 'primary'),
      btn('SVG', () => download(`${safeName()}_Zeichnung.svg`, tHtml(placed), 'image/svg+xml'))),
    ...drawingCache.warnings.map(w => h('p', { class: 'err' }, '⚠ ' + w)),
    h('p', { class: 'hint' }, `Maßstab ${drawingCache.scaleLabel} · ${drawingCache.holes} Bohrung(en) erkannt · Projektionsmethode 1 (DIN ISO 128). Ansichten lassen sich mit der Maus auf dem Blatt verschieben.`),
  );
  const sheet = h('div', { class: 'dw-sheet', html: placed });
  root.append(h('div', { class: 'dw' }, side, sheet));
  enableViewDrag(sheet, d, ed);
}

// Schnitt A–A: the bodies cut by a plane parallel to XZ; keeps the half behind it (seen from the front)
// and the cut faces as outlines (x, z) for the hatching.
// With axis 'x' the same for the side view: a plane parallel to YZ, seen from the left (outlines as (-y, z)).
function drawingSection(bodies, d, axis = 'y') {
  const box = new THREE.Box3(), ai = axis === 'x' ? 0 : 1;
  for (const b of bodies) { b.geometry.computeBoundingBox(); box.union(b.geometry.boundingBox); }
  let y = axis === 'x' ? d.sectionXv : d.sectionY;
  if (!Number.isFinite(+y) || y === null || y === '') {
    // automatically through the holes closest to the middle (the most telling cut), else through the middle
    const mid = (box.min[axis] + box.max[axis]) / 2;
    const ys = [];
    for (const b of bodies) for (const e of b.shape.edges) if (e.geomType === 'CIRCLE' && e.isClosed) { const c = e.boundingBox.center; ys.push(c[ai]); }
    y = ys.length ? ys.reduce((a, v) => (Math.abs(v - mid) < Math.abs(a - mid) ? v : a), ys[0]) : mid;
  }
  y = +y;
  if (!(y > box.min[axis] + 1e-4 && y < box.max[axis] - 1e-4)) return null;
  const plane = axis === 'x' ? new OC.Plane([y, 0, 0], [0, 1, 0], [1, 0, 0]) : new OC.Plane([0, y, 0], [1, 0, 0], [0, 1, 0]);
  // front section in steps: 'half' cuts only the right half (Halbschnitt), 'step' jumps to a second Y at an X
  // (abgesetzter Schnitt). Each step takes away the block in front of its plane.
  const mode = axis === 'y' && ['half', 'step'].includes(d.sectionMode) ? d.sectionMode : 'full';
  const given = v => v !== null && v !== '' && v !== undefined && Number.isFinite(+v);
  let steps = null;
  if (mode !== 'full') {
    const xs = given(d.sectionStepX) ? +d.sectionStepX : (box.min.x + box.max.x) / 2;
    if (!(xs > box.min.x + 1e-4 && xs < box.max.x - 1e-4)) return null;
    if (mode === 'half') steps = [{ x0: xs, x1: Infinity, y }];
    else {
      // automatically: each side through its own holes closest to the middle
      const mid = (box.min.y + box.max.y) / 2, L = [], R = [];
      for (const b of bodies) for (const e of b.shape.edges) if (e.geomType === 'CIRCLE' && e.isClosed) { const c = e.boundingBox.center; (c[0] < xs ? L : R).push(c[1]); }
      const pick = (ys, fb) => (ys.length ? ys.reduce((a, v) => (Math.abs(v - mid) < Math.abs(a - mid) ? v : a), ys[0]) : fb);
      const y1 = given(d.sectionY) ? y : pick(L, y);
      let y2 = given(d.sectionY2) ? +d.sectionY2 : pick(R.filter(v => Math.abs(v - y1) > 1e-3), pick(R, y1));
      if (!(y2 > box.min.y + 1e-4 && y2 < box.max.y - 1e-4)) y2 = y1;
      y = y1;
      steps = [{ x0: -Infinity, x1: xs, y: y1 }, { x0: xs, x1: Infinity, y: y2 }];
    }
  }
  const halves = [], polys = [];
  const L = window.ClipperLib, S = 1000;
  for (const b of bodies) {
    let half;
    try {
      if (!steps) half = b.shape.clone().cutPlane(plane, undefined, 'positive');
      else {
        half = b.shape.clone();
        for (const st of steps) {
          const lo = [Math.max(st.x0, box.min.x - 1), box.min.y - 1, box.min.z - 1], hi = [Math.min(st.x1, box.max.x + 1), st.y, box.max.z + 1];
          half = half.cut(OC.makeBox(lo, hi));
        }
      }
    } catch { continue; }
    if (!half) continue;
    const mb = meshBody(half);
    halves.push({ shape: half, ...mb });
    // triangles of the faces lying in the cut plane, merged into clean outlines
    const cutFaces = new Set();
    half.faces.forEach((fc, i) => {
      const bb = fc.boundingBox.bounds;
      if (!steps) { if (Math.abs(bb[0][ai] - y) < 1e-4 && Math.abs(bb[1][ai] - y) < 1e-4) cutFaces.add(i); return; }
      // the faces in the plane of a step, within its stretch of X (the faces across, at the jump, stay plain)
      if (steps.some(st => Math.abs(bb[0][1] - st.y) < 1e-4 && Math.abs(bb[1][1] - st.y) < 1e-4 && bb[0][0] >= st.x0 - 1e-4 && bb[1][0] <= st.x1 + 1e-4)) cutFaces.add(i);
    });
    const idx = mb.geometry.index.array, P = mb.geometry.attributes.position.array;
    const tris = [];
    for (let t = 0; t < mb.faceOf.length; t++) {
      if (!cutFaces.has(mb.faceOf[t])) continue;
      const tri = [0, 1, 2].map(k => { const v = idx[t * 3 + k]; return { X: Math.round((axis === 'x' ? -P[v * 3 + 1] : P[v * 3]) * S), Y: Math.round(P[v * 3 + 2] * S) }; });
      if (L.Clipper.Orientation(tri) === false) tri.reverse();
      tris.push(tri);
    }
    if (!tris.length) continue;
    const c = new L.Clipper();
    c.AddPaths(tris, L.PolyType.ptSubject, true);
    const out = new L.Paths();
    c.Execute(L.ClipType.ctUnion, out, L.PolyFillType.pftNonZero, L.PolyFillType.pftNonZero);
    polys.push(out.map(path => path.map(q => [q.X / S, q.Y / S])));
  }
  return halves.length ? { y, x: y, bodies: halves, polys, mode, steps, stepX: steps ? steps[steps.length - 1].x0 : null, y2: steps && steps.length > 1 ? steps[1].y : null } : null;
}

// views moved by the user: their groups get a shift
function placedDrawingSvg(svg, offsets = {}) {
  return svg.replace(/<g data-view="(\w+)">/g, (m, k) => { const o = offsets?.[k]; return o ? `<g data-view="${k}" transform="translate(${(+o.dx).toFixed(2)} ${(+o.dy).toFixed(2)})">` : m; });
}

// drag a view on the sheet (views are moved with the mouse); saved when released
function enableViewDrag(sheet, d, ed) {
  const svg = sheet.querySelector('svg');
  if (!svg) return;
  const toMM = e => { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; return pt.matrixTransform(svg.getScreenCTM().inverse()); };
  const viewAt = p => {
    for (const [k, r] of Object.entries(drawingCache.views || {})) {
      const o = d.offsets?.[k] || { dx: 0, dy: 0 };
      if (p.x >= r.x + o.dx && p.x <= r.x + o.dx + r.w && p.y >= r.y + o.dy && p.y <= r.y + o.dy + r.h) return k;
    }
    return null;
  };
  svg.addEventListener('pointermove', e => { if (!svg.hasPointerCapture?.(e.pointerId)) svg.style.cursor = dwPick.mode ? 'crosshair' : viewAt(toMM(e)) ? 'move' : ''; });
  // the first picked dimension point is marked
  for (const pt of dwPick.pts) {
    const x = drawingCache.xf?.[pt.k];
    if (!x) continue;
    const o = d.offsets?.[pt.k] || { dx: 0, dy: 0 };
    const c = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    c.setAttribute('cx', x.px + (pt.p[0] - x.x0) * x.s + o.dx); c.setAttribute('cy', x.py + (x.y1 - pt.p[1]) * x.s + o.dy);
    c.setAttribute('r', '1.2'); c.setAttribute('fill', '#0696d7');
    svg.append(c);
  }
  // sheet point → view and view coordinates (with the view's shift)
  const toView = p => {
    const k = viewAt(p);
    const x = k && drawingCache.xf?.[k];
    if (!x) return null;
    const o = d.offsets?.[k] || { dx: 0, dy: 0 };
    return { k, u: x.x0 + (p.x - o.dx - x.px) / x.s, v: x.y1 - (p.y - o.dy - x.py) / x.s, x };
  };
  svg.addEventListener('click', e => {
    if (!dwPick.mode) return;
    const q = toView(toMM(e));
    const inDetail = !!q && /^det/.test(q.k);
    if (!q || q.k === 'iso') return status('Bitte in die Vorder-, Drauf- oder Seitenansicht (oder in eine Detailansicht) klicken.');
    if (dwPick.mode === 'detail') {
      if (inDetail) return status('Die Mitte eines Details liegt in der Vorder-, Drauf- oder Seitenansicht.');
      const key = dwPick.key, c = [+q.u.toFixed(3), +q.v.toFixed(3)];
      dwPick = { mode: null, pts: [] };
      return ed(x => {
        const old = key && drawingDetailRef(x, key);
        // moved to another place: the dimensions set in it no longer fit
        if (old) { Object.assign(old, { view: q.k, c }); if (x.userDims) x.userDims = x.userDims.filter(u => u.view !== key); }
        else x.details = [...(x.details || []), { id: Date.now().toString(36), view: q.k, c, r: +(12 / q.x.s).toFixed(2), factor: 2 }];
      });
    }
    if (inDetail && (dwPick.mode === 'surf' || dwPick.mode === 'datum')) return status('Oberflächenzeichen und Bezüge bitte in der Vorder-, Drauf- oder Seitenansicht setzen.');
    // surface symbol: on the nearest edge of the view (its tip sits on the line, turned to stand on it)
    if (dwPick.mode === 'surf' || dwPick.mode === 'datum') {
      const datum = dwPick.mode === 'datum';
      const g = svg.querySelector(`g[data-view="${q.k}"]`), o = d.offsets?.[q.k] || { dx: 0, dy: 0 }, pm = toMM(e);
      let best = null, bd = 4;
      for (const l of g?.querySelectorAll('line.vis') || []) {
        const a = [+l.getAttribute('x1') + o.dx, +l.getAttribute('y1') + o.dy], b = [+l.getAttribute('x2') + o.dx, +l.getAttribute('y2') + o.dy];
        const ux = b[0] - a[0], uy = b[1] - a[1], L2 = ux * ux + uy * uy;
        if (L2 < 1e-9) continue;
        const t = Math.max(0, Math.min(1, ((pm.x - a[0]) * ux + (pm.y - a[1]) * uy) / L2)), fx = a[0] + t * ux, fy = a[1] + t * uy, dd = Math.hypot(pm.x - fx, pm.y - fy);
        if (dd < bd) { bd = dd; best = { fx, fy, ux, uy, side: (pm.x - fx) * -uy + (pm.y - fy) * ux }; }
      }
      if (!best) return status('Keine Kante in der Nähe – näher an eine Körperkante klicken.');
      // stands on the side of the edge the click came from; angle of the symbol's "up" against the sheet's up
      let nx = -best.uy, ny = best.ux;
      if (best.side < 0) { nx = -nx; ny = -ny; }
      const ang = Math.round((Math.atan2(-nx, -ny) * 180) / Math.PI);
      const at = [+(q.x.x0 + (best.fx - o.dx - q.x.px) / q.x.s).toFixed(3), +(q.x.y1 - (best.fy - o.dy - q.x.py) / q.x.s).toFixed(3)], view = q.k;
      dwPick = { mode: null, pts: [] };
      if (datum) {
        // next free letter
        const used = new Set((d.userDims || []).filter(u => u.kind === 'datum').map(u => String(u.text || '').toUpperCase()));
        const letter = 'ABCDEFGHJKLMNPRSTUVWXYZ'.split('').find(c => !used.has(c)) || 'A';
        return ed(x => { x.userDims = [...(x.userDims || []), { view, kind: 'datum', a: at, text: letter, ang }]; });
      }
      return askValue('Rauheitsangabe (z. B. Ra 3,2 oder Rz 16):', 'Ra 3,2').then(tx => { if (tx == null) return renderDrawing(); ed(x => { x.userDims = [...(x.userDims || []), { view, kind: 'surf', a: at, text: String(tx).trim(), ang }]; }); });
    }
    // note or tolerance frame with a leader: at the nearest corner, or freely where clicked
    if (dwPick.mode === 'gdt') {
      let at = [+q.u.toFixed(3), +q.v.toFixed(3)], nd = 3 / q.x.s;
      for (const p of drawingCache.snaps?.[q.k] || []) { const dd = Math.hypot(p[0] - q.u, p[1] - q.v); if (dd < nd) { nd = dd; at = p; } }
      dwPick = { mode: null, pts: [] };
      return ed(x => { x.userDims = [...(x.userDims || []), { view: q.k, kind: 'gdt', a: at, sym: 'pos', text: '0,05 A', ang: 45, off: 14 }]; });
    }
    if (dwPick.mode === 'note') {
      let at = [+q.u.toFixed(3), +q.v.toFixed(3)], nd = 3 / q.x.s;
      for (const p of drawingCache.snaps?.[q.k] || []) { const dd = Math.hypot(p[0] - q.u, p[1] - q.v); if (dd < nd) { nd = dd; at = p; } }
      dwPick = { mode: null, pts: [] };
      const view = q.k;
      return askValue('Text des Hinweises:', '').then(tx => { if (tx == null || !String(tx).trim()) return renderDrawing(); ed(x => { x.userDims = [...(x.userDims || []), { view, kind: 'note', a: at, text: String(tx).trim(), ang: 45, off: 14 }]; }); });
    }
    // a click on a circle (hole, boss) in the top view: diameter dimension right away
    if (!dwPick.pts.length && d.dimKind !== 'ang') {
      let hit = null, hd = 2.5 / q.x.s;
      for (const ci of drawingCache.circles?.[q.k] || []) for (const r of ci.rs) {
        const dd = Math.abs(Math.hypot(q.u - ci.c[0], q.v - ci.c[1]) - r);
        if (dd < hd) { hd = dd; hit = { c: ci.c, r }; }
      }
      if (hit) {
        const ang = (Math.atan2(q.v - hit.c[1], q.u - hit.c[0]) * 180) / Math.PI;
        return ed(x => { x.userDims = [...(x.userDims || []), { view: q.k, kind: d.dimKind === 'rad' ? 'rad' : 'dia', c: hit.c, r: +hit.r.toFixed(4), ang: Math.round(ang) }]; });
      }
    }
    // dimension: snap to the nearest corner of the view (within 4 mm on the sheet)
    let best = null, bd = 4 / q.x.s;
    for (const p of drawingCache.snaps?.[q.k] || []) { const dd = Math.hypot(p[0] - q.u, p[1] - q.v); if (dd < bd) { bd = dd; best = p; } }
    if (!best) return status('Kein Eckpunkt in der Nähe – näher an eine Ecke oder ein Linienende klicken.');
    if (dwPick.pts.length && dwPick.pts[0].k !== q.k) return status('Beide Punkte müssen in derselben Ansicht liegen.');
    dwPick.pts.push({ k: q.k, p: best });
    // angle: corner first, then one point on each leg
    if (d.dimKind === 'ang') {
      if (dwPick.pts.length < 3) { renderDrawing(); return status(dwPick.pts.length === 1 ? 'Scheitel gewählt – jetzt einen Punkt auf dem ersten Schenkel.' : 'Jetzt einen Punkt auf dem zweiten Schenkel.'); }
      const [V, A, B] = dwPick.pts.map(x => x.p);
      dwPick = { mode: 'dim', pts: [] };
      if (Math.hypot(A[0] - V[0], A[1] - V[1]) < 1e-6 || Math.hypot(B[0] - V[0], B[1] - V[1]) < 1e-6) return status('Schenkelpunkt liegt auf dem Scheitel.');
      return ed(x => { x.userDims = [...(x.userDims || []), { view: q.k, kind: 'ang', v: V, a: A, b: B, off: 16 }]; });
    }
    if (dwPick.pts.length < 2) { renderDrawing(); return status('Ersten Punkt gewählt – jetzt den zweiten anklicken.'); }
    const [A, B] = dwPick.pts.map(x => x.p);
    const dx = Math.abs(A[0] - B[0]), dy = Math.abs(A[1] - B[1]);
    if (dx < 1e-6 && dy < 1e-6) { dwPick.pts.pop(); return status('Zweimal derselbe Punkt.'); }
    // chamfer: the two ends of its edge give the callout (2×45° or 2×3), on a leader from the middle of the edge
    if (d.dimKind === 'cha') {
      dwPick = { mode: 'dim', pts: [] };
      if (dx < 1e-6 || dy < 1e-6) return status('Das ist keine schräge Kante – beide Enden der Fasenkante anklicken.');
      const c = v => String(f2(v)).replace('.', ','), text = Math.abs(dx - dy) < 0.01 ? `${c(dx)}×45°` : `${c(dx)}×${c(dy)}`;
      // the leader points away from the middle of the view (in steps of 45°), so the text lands outside the part
      const sn = drawingCache.snaps?.[q.k] || [], mid = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const cx = sn.length ? (Math.min(...sn.map(p => p[0])) + Math.max(...sn.map(p => p[0]))) / 2 : mid[0] - 1, cy = sn.length ? (Math.min(...sn.map(p => p[1])) + Math.max(...sn.map(p => p[1]))) / 2 : mid[1] - 1;
      let la = Math.round((Math.atan2(mid[1] - cy, mid[0] - cx) * 180) / Math.PI / 45) * 45;
      if (la % 90 === 0) la += 45;
      return ed(x => { x.userDims = [...(x.userDims || []), { view: q.k, kind: 'note', a: [+mid[0].toFixed(3), +mid[1].toFixed(3)], text, ang: la, off: 12 }]; });
    }
    const kind = d.dimKind && !['auto', 'rad'].includes(d.dimKind) ? d.dimKind : dy < 1e-6 ? 'h' : dx < 1e-6 ? 'v' : dx >= dy ? 'h' : 'v';
    dwPick = { mode: 'dim', pts: [] };
    ed(x => { x.userDims = [...(x.userDims || []), { view: q.k, a: A, b: B, kind, off: 16 }]; });
  });
  // own dimensions are moved with the mouse: lengths by the distance of the dimension line, diameters / notes
  // by the angle of their leader (notes also by its length), angles by the radius of the arc
  for (const g of svg.querySelectorAll('g.udim')) g.style.cursor = dwPick.mode ? '' : 'grab';
  const dimDrag = e => {
    const g = e.target.closest?.('g.udim'), i = g ? +g.dataset.dim : -1, dm = d.userDims?.[i];
    const x = dm && drawingCache.xf?.[dm.view];
    if (!x) return false;
    e.preventDefault(); e.stopPropagation();
    const o = d.offsets?.[dm.view] || { dx: 0, dy: 0 };
    const S = q => [x.px + (q[0] - x.x0) * x.s + o.dx, x.py + (x.y1 - q[1]) * x.s + o.dy]; // view -> sheet
    const p0 = toMM(e);
    let patch = null;
    try { svg.setPointerCapture(e.pointerId); } catch { /* not a real pointer */ }
    g.classList.add('dw-drag');
    const move = ev => {
      const p = toMM(ev), dx = p.x - p0.x, dy = p.y - p0.y;
      if (dm.kind === 'surf' || dm.kind === 'datum') {
        // turned in steps of 15°, pointing where the mouse is
        const c = S(dm.a), ang = Math.round(((Math.atan2(-(p.y - c[1]), p.x - c[0]) * 180) / Math.PI - 90) / 15) * 15;
        patch = { ang };
        g.setAttribute('transform', `rotate(${(+dm.ang || 0) - ang} ${c[0].toFixed(2)} ${c[1].toFixed(2)})`);
      } else if (dm.kind === 'dia' || dm.kind === 'rad' || dm.kind === 'note' || dm.kind === 'gdt') {
        const lead = dm.kind === 'note' || dm.kind === 'gdt';
        const c = S(lead ? dm.a : dm.c), ang = Math.round((Math.atan2(-(p.y - c[1]), p.x - c[0]) * 180) / Math.PI);
        patch = { ang, ...(lead ? { off: +Math.max(4, Math.hypot(p.x - c[0], p.y - c[1])).toFixed(1) } : {}) };
        g.setAttribute('transform', `rotate(${(+dm.ang || 45) - ang} ${c[0].toFixed(2)} ${c[1].toFixed(2)})`);
      } else if (dm.kind === 'ang') {
        const v = S(dm.v);
        patch = { off: +Math.max(4, Math.hypot(p.x - v[0], p.y - v[1])).toFixed(1) };
      } else {
        // along the direction the dimension line moves in: up (h), right (v) or across the edge (aligned)
        let n = dm.kind === 'h' ? [0, -1] : dm.kind === 'v' ? [1, 0] : null;
        if (!n) { const a = S(dm.a), b = S(dm.b), L0 = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1; n = [-(b[1] - a[1]) / L0, (b[0] - a[0]) / L0]; if (n[1] > 0) n = [-n[0], -n[1]]; }
        const t = dx * n[0] + dy * n[1];
        patch = { off: +Math.max(2, (+dm.off || 16) + t).toFixed(1) };
        const tt = patch.off - (+dm.off || 16);
        g.setAttribute('transform', `translate(${(n[0] * tt).toFixed(2)} ${(n[1] * tt).toFixed(2)})`);
      }
    };
    const up = () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      g.classList.remove('dw-drag');
      if (patch && Object.entries(patch).some(([k2, v]) => Math.abs(v - (+dm[k2] || 0)) > 0.05)) ed(xd => Object.assign(xd.userDims[i], patch));
      else g.removeAttribute('transform');
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
    return true;
  };
  svg.addEventListener('pointerdown', e => {
    if (e.button !== 0 || dwPick.mode) return;
    if (dimDrag(e)) return;
    const p0 = toMM(e), k = viewAt(p0);
    if (!k) return;
    e.preventDefault();
    const g = svg.querySelector(`g[data-view="${k}"]`);
    const o0 = { dx: 0, dy: 0, ...(d.offsets?.[k] || {}) };
    let o = o0;
    try { svg.setPointerCapture(e.pointerId); } catch { /* not a real pointer */ }
    g?.classList.add('dw-drag');
    const move = ev => {
      const p = toMM(ev);
      o = { dx: o0.dx + p.x - p0.x, dy: o0.dy + p.y - p0.y };
      g?.setAttribute('transform', `translate(${o.dx.toFixed(2)} ${o.dy.toFixed(2)})`);
    };
    const up = () => {
      svg.removeEventListener('pointermove', move);
      svg.removeEventListener('pointerup', up);
      g?.classList.remove('dw-drag');
      if (Math.hypot(o.dx - o0.dx, o.dy - o0.dy) > 0.2) ed(x => { x.offsets = { ...(x.offsets || {}), [k]: { dx: +o.dx.toFixed(2), dy: +o.dy.toFixed(2) } }; });
    };
    svg.addEventListener('pointermove', move);
    svg.addEventListener('pointerup', up);
  });
}

async function offsetEntity(sketchId, e) {
  const d = evalExpr(await askValue('Versatz in mm (positiv = nach außen, negativ = nach innen):', '2') || '', paramScope(state.project));
  if (!Number.isFinite(d) || !d) return;
  const L = window.ClipperLib, S = 1000;
  const co = new L.ClipperOffset(2, 0.01 * S);
  co.AddPaths(entityPolys(e).map(p => p.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) }))), L.JoinType.jtRound, L.EndType.etClosedPolygon);
  const out = new L.Paths();
  co.Execute(out, d * S);
  if (!out.length) return status('Versatz ergibt keine Kontur.');
  commitSketch(sketchId, sk => {
    for (const path of out) sk.entities.push({ id: uid('e'), type: 'poly', closed: true, pts: path.map(q => [+(q.X / S).toFixed(4), +(q.Y / S).toFixed(4)]) });
  });
}

// Mirrored copy about the sketch's Y axis ('y': x -> -x) or X axis ('x': y -> -y).
function mirrorEntity(sketchId, e, axis) {
  const mx = axis === 'y';
  const c = JSON.parse(JSON.stringify(e));
  c.id = uid('e');
  if (c.type === 'rect') { if (mx) c.x = -(e.x + e.w); else c.y = -(e.y + e.h); }
  else if (c.type === 'poly') c.pts = e.pts.map(([x, y]) => (mx ? [-x, y] : [x, -y]));
  else {
    const kx = c.type === 'text' ? 'x' : 'cx', ky = c.type === 'text' ? 'y' : 'cy';
    if (mx) c[kx] = -e[kx]; else c[ky] = -e[ky];
    if (c.type === 'ngon') c.rot = mx ? -(e.rot || 0) : -(e.rot || 0) - 180;
    if (c.type === 'slot') c.rot = mx ? 180 - (e.rot || 0) : -(e.rot || 0);
  }
  commitSketch(sketchId, sk => sk.entities.push(c));
}

// ---------- setup sheet ----------
function openSetupSheet() {
  const p = state.project;
  const cam = getCam();
  const esc = v => String(v).replace(/[&<>]/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[ch]);
  let total = 0;
  const used = new Map();
  const setupsHtml = p.cam.setups.map(st => {
    const g = cam.setups.get(st.id);
    if (!g?.stock) return `<h2>${esc(st.name)}</h2><p>Kein Rohteil.</p>`;
    const s = g.stock;
    const rows = g.ops.map(op => {
      const r = g.results.get(op.id);
      const t = p.cam.tools.find(x => x.id === op.tool);
      if (t) used.set(t.id, t);
      if (r && !r.error && !r.disabled) total += r.time;
      const minZ = r?.moves?.length ? Math.min(...r.moves.map(m => m.z)) - originOf(st, s).z : null;
      return `<tr><td>${esc(op.name)}</td><td>${esc(OP_TYPES[op.type])}</td><td>T${t?.number ?? '?'} ${esc(t?.name ?? '')}</td><td>${op.enabled === false ? 'inaktiv' : r?.error ? '⚠ ' + esc(r.error) : fmtTime(r?.time || 0)}</td><td>${minZ == null ? '' : f2(minZ)}</td></tr>`;
    }).join('');
    return `<h2>${esc(st.name)} – ${esc(ORIENTATIONS[st.orientation])}</h2>
      <table class="kv"><tr><th>Rohteil</th><td>${f2(s.maxX - s.minX)} × ${f2(s.maxY - s.minY)} × ${f2(s.top - s.bottom)} mm</td></tr>
      <tr><th>Nullpunkt</th><td>${esc(ORIGINS[st.origin])}</td></tr>
      <tr><th>Sicherheits-/Rückzugshöhe</th><td>${st.safeZ} / ${st.retract} mm über Rohteil</td></tr></table>
      <table><tr><th>Operation</th><th>Strategie</th><th>Werkzeug</th><th>Zeit</th><th>tiefstes Z</th></tr>${rows}</table>`;
  }).join('');
  const tools = [...used.values()].sort((a, b) => a.number - b.number).map(t => `<tr><td>T${t.number}</td><td>${esc(t.name)}</td><td>${esc(TOOL_TYPES[t.type])}</td><td>${t.dia}</td><td>${t.rpm}</td><td>${t.feed}</td><td>${t.plunge}</td></tr>`).join('');
  const html = `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Einrichteblatt – ${esc(p.name)}</title>
    <style>body{font:13px/1.4 "Segoe UI",system-ui,sans-serif;color:#111;margin:24px;max-width:900px}h1{margin:0 0 4px}h2{margin:24px 0 8px;border-bottom:2px solid #0696d7;padding-bottom:4px}
    table{border-collapse:collapse;width:100%;margin:6px 0}th,td{border:1px solid #ccc;padding:4px 8px;text-align:left}th{background:#f0f3f6}table.kv{width:auto}.meta{color:#555}
    button{margin:12px 0;padding:6px 14px}@media print{button{display:none}}</style></head><body>
    <button onclick="print()">Drucken</button>
    <h1>Einrichteblatt: ${esc(p.name)}</h1><div class="meta">Erstellt ${new Date().toLocaleString('de-DE')} · Steuerung: ${esc(findPost(p, p.post.flavor).name)} · Gesamtzeit ca. ${fmtTime(total)}</div>
    <h2>Werkzeuge</h2><table><tr><th>Nr.</th><th>Name</th><th>Typ</th><th>Ø mm</th><th>U/min</th><th>Vorschub</th><th>Eintauchen</th></tr>${tools}</table>
    ${setupsHtml}</body></html>`;
  const w = window.open('', '_blank');
  if (!w) return status('Popup blockiert – bitte Popups für diese Seite erlauben.');
  w.document.write(tHtml(html));
  w.document.close();
}

// ---------- simulation ----------
const sim = { open: false, playing: false, segs: null, idx: 0, prog: 0, t: 0, total: 0, toolMesh: null, toolKey: '' };

function clearCollisions() {
  sim.collisions = [];
  if (sim.markers) { vp.sim.remove(sim.markers); sim.markers.geometry.dispose(); sim.markers = null; }
}

function addCollision(type, p, op) {
  const last = sim.collisions[sim.collisions.length - 1];
  if (last && last.type === type && Math.hypot(last.p.x - p.x, last.p.y - p.y, last.p.z - p.z) < 2) return;
  sim.collisions.push({ type, p, op });
  if (sim.markers) { vp.sim.remove(sim.markers); sim.markers.geometry.dispose(); }
  sim.markers = new THREE.Points(new THREE.BufferGeometry().setFromPoints(sim.collisions.map(c => new THREE.Vector3(c.p.x, c.p.y, c.p.z))),
    new THREE.PointsMaterial({ color: 0xff2d2d, size: 11, sizeAttenuation: false, depthTest: false, transparent: true }));
  sim.markers.renderOrder = 20;
  vp.sim.add(sim.markers);
}

function cutSeg(s, t0, t1) {
  // 4-axis setup: the cylinder map is cut by the 4-axis moves and by the 3-axis moves (tool along Z, A = 0°)
  if (sim.rot) {
    if (s.a.a == null && s.b.a == null) {
      const r3 = cylSim.cut3(s.a, s.b, s.tool, t0, t1);
      if (s.b.t === 'r' && r3.removed > 0.05 && r3.at) addCollision('rapid', r3.at, s.op);
      return;
    }
    if (s.a.a == null || s.b.a == null) return;
    const res = cylSim.cut(s.a, s.b, s.tool, t0, t1);
    if (!res.at) return;
    const th = (res.at.a * Math.PI) / 180, p = { x: res.at.x, y: sim.rot.y + res.at.rho * Math.sin(th), z: sim.rot.z + res.at.rho * Math.cos(th) };
    if (s.b.t === 'r' && res.removed > 0.05) addCollision('rapid', p, s.op);
    if (res.removed > 0.05 && res.top > toolFlute(s.tool) + 0.05) addCollision('shank', p, s.op);
    return;
  }
  if (s.b.a != null) return;
  const res = simStock().cut(s.a, s.b, s.tool, t0, t1);
  if (s.b.t === 'r' && res.removed > 0.05) addCollision('rapid', { x: s.a.x + (s.b.x - s.a.x) * t1, y: s.a.y + (s.b.y - s.a.y) * t1, z: s.a.z + (s.b.z - s.a.z) * t1 }, s.op);
  if (res.shankAt) addCollision('shank', res.shankAt, s.op);
  if (res.holderAt) addCollision('holder', res.holderAt, s.op);
}

function buildSim() {
  const g = activeGen();
  clearCollisions();
  sim.segs = [];
  sim.total = 0;
  sim.gen = g;
  // simulate in the setup frame, display in model orientation
  vp.sim.matrixAutoUpdate = false;
  vp.sim.matrix.copy(g.T).invert();
  let prev = null;
  for (const op of g.ops) {
    const r = g.results.get(op.id);
    if (op.enabled === false || !r || r.error || !r.moves.length) continue;
    for (const m of r.moves) {
      if (prev) {
        const len = Math.hypot(m.x - prev.x, m.y - prev.y, m.z - prev.z);
        const dur = (len / (m.t === 'r' ? g.machine?.rapid || RAPID_FEED : m.f)) * 60;
        sim.segs.push({ a: prev, b: m, dur, tool: r.tool, op: op.name });
        sim.total += dur;
      }
      prev = m;
    }
  }
  sim.turn = g.kind === 'turn';
  stockSim.dispose(); turnSim.dispose(); cylSim.dispose();
  // a setup with 4-axis operations is simulated on a cylinder map around the A axis
  const rot = !sim.turn && [...g.results.values()].find(r => r?.rotary && !r.error)?.rotary;
  sim.rot = rot ? { ...rot } : null;
  if (g.stock && sim.rot) cylSim.build({ x0: g.stock.minX, x1: g.stock.maxX, cy: rot.y, cz: rot.z, r: rot.r });
  else if (g.stock) simStock().build(g.stock);
  sim.idx = 0; sim.prog = 0; sim.t = 0;
  placeTool();
  if ($('#simCompare').checked) applySimCompare();
}

function toolMesh(t) {
  const grp = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xd0d6dc, metalness: 0.8, roughness: 0.3 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x55606b, metalness: 0.5, roughness: 0.5 });
  if (t.kind === 'turnbore' || t.type === 'turnbore' || t.internal) {
    // boring bar: insert at the tip pointing outwards, the bar along +Z on the axis side
    const D = Math.max(1, +t.dia || 12), clr = Math.max(0.5, 0.2 * D);
    const insert = new THREE.Mesh(new THREE.ConeGeometry(1.5, 3, 4).rotateZ(Math.PI / 2), steel);
    insert.position.set(-1.5, 0, 0.8);
    const bar = new THREE.Mesh(new THREE.CylinderGeometry(D / 2, D / 2, 60, 24).rotateX(Math.PI / 2), dark);
    bar.position.set(-clr - D / 2, 0, 31);
    grp.add(insert, bar);
    return grp;
  }
  if (['turn', 'groove', 'tthread'].includes(t.type)) {
    // lathe tool: insert at the tip, holder pointing away from the axis (+X)
    const w = t.type === 'groove' ? +t.width || 3 : 6;
    const insert = new THREE.Mesh(t.type === 'groove' ? new THREE.BoxGeometry(8, 4, w) : new THREE.ConeGeometry(w / 2, 8, 4).rotateZ(Math.PI / 2), steel);
    insert.position.set(4, 0, 0);
    const holder = new THREE.Mesh(new THREE.BoxGeometry(40, 12, 12), dark);
    holder.position.set(28, 0, t.type === 'groove' ? 0 : 3);
    grp.add(insert, holder);
    return grp;
  }
  const r = t.dia / 2;
  const L = Math.max(20, r * 6);
  const cyl = (rad, len, z, mat) => { const m = new THREE.Mesh(new THREE.CylinderGeometry(rad, rad, len, 32), mat); m.rotation.x = Math.PI / 2; m.position.z = z + len / 2; return m; };
  if (t.type === 'ball') {
    const s = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), steel);
    s.position.z = r;
    grp.add(s, cyl(r, L - r, r, steel));
  } else if (t.type === 'chamfer' || t.type === 'drill') {
    const half = ((t.angle || 90) / 2) * (Math.PI / 180);
    const coneH = Math.max(0.1, (r - (t.tip || 0) / 2) / Math.tan(half));
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(r, (t.tip || 0) / 2, coneH, 32), steel);
    cone.rotation.x = Math.PI / 2;
    cone.position.z = coneH / 2;
    grp.add(cone, cyl(r, L - coneH, coneH, steel));
  } else grp.add(cyl(r, L, 0, steel));
  grp.add(cyl(Math.max(r * 1.8, 8), 25, L, dark));
  return grp;
}

// Holes of the model a driven tool on the lathe can drill (spindle = model Z): parallel to the axis but off
// centre (axial) or crossing the axis at a right angle (radial). The group that fits the tool diameter best wins.
// Returns the operation fields to set, the number of holes and their diameter.
function liveHolesFromModel(toolDia, want) {
  let list;
  try { list = cylinderFaces(getModel().bodies).filter(q => !q.outside); } catch { return null; }
  if (!list.length) return null;
  let top = -Infinity;
  for (const b of getModel().bodies) { try { top = Math.max(top, b.shape.boundingBox.bounds[1][2]); } catch { /* no box */ } }
  const groups = new Map();
  const add = (key, base, ang, depth) => {
    const g = groups.get(key) || { ...base, angs: [], depth: 0 };
    const a = +((((ang * 180) / Math.PI) % 360 + 360) % 360).toFixed(2);
    if (!g.angs.some(v => Math.abs(v - a) < 0.05 || Math.abs(Math.abs(v - a) - 360) < 0.05)) g.angs.push(a);
    g.depth = Math.max(g.depth, depth);
    groups.set(key, g);
  };
  for (const q of list) {
    const [dx, dy, dz] = q.dir, [lx, ly, lz] = q.loc;
    if (Math.abs(Math.abs(dz) - 1) < 1e-4) {
      const rad = Math.hypot(lx, ly);
      if (rad < 0.05) continue; // on the axis: plain drilling
      const zBot = Math.min(lz + q.t0 * dz, lz + q.t1 * dz);
      add(`ax|${rad.toFixed(2)}|${q.r.toFixed(3)}`, { dir: 'axial', r: q.r, pitchDia: +(2 * rad).toFixed(3) }, Math.atan2(ly, lx), top - zBot);
    } else if (Math.abs(dz) < 1e-4 && Math.abs(lx * dy - ly * dx) < 0.05) {
      // signed distances of the two ends from the turning axis, along the hole
      const ta = -(lx * dx + ly * dy), s0 = q.t0 - ta, s1 = q.t1 - ta;
      const through = s0 < -0.05 && s1 > 0.05, sg = through ? 1 : Math.sign(s0 + s1) || 1;
      const depth = through ? s1 - s0 : Math.max(Math.abs(s0), Math.abs(s1)) - Math.min(Math.abs(s0), Math.abs(s1));
      add(`rad|${lz.toFixed(2)}|${q.r.toFixed(3)}`, { dir: 'radial', r: q.r, z: +lz.toFixed(3) }, Math.atan2(sg * dy, sg * dx), depth);
    }
  }
  const all = [...groups.values()].filter(g => !want || g.dir === want);
  if (!all.length) return null;
  const R = (+toolDia || 0) / 2;
  all.sort((a, b) => Math.abs(a.r - R) - Math.abs(b.r - R) || b.angs.length - a.angs.length);
  const g = all[0], angs = [...g.angs].sort((a, b) => a - b);
  // evenly spaced holes: count + start angle, otherwise the list of angles
  const step = 360 / angs.length, even = angs.every((a, i) => Math.abs(a - angs[0] - i * step) < 0.05);
  const set = { dir: g.dir, depth: +g.depth.toFixed(3), count: angs.length, startAngle: even ? angs[0] : 0, angles: even ? '' : angs.join('; '), ...(g.dir === 'radial' ? { z: g.z } : { pitchDia: g.pitchDia }) };
  return { ...set, set, n: angs.length, dia: 2 * g.r };
}

function placeTool() {
  if (!sim.segs) return;
  const s = sim.segs[Math.min(sim.idx, sim.segs.length - 1)];
  if (!s) { if (sim.toolMesh) sim.toolMesh.visible = false; return; }
  const key = JSON.stringify([s.tool.type, s.tool.dia, s.tool.angle, s.tool.tip]);
  if (key !== sim.toolKey) {
    if (sim.toolMesh) { vp.sim.remove(sim.toolMesh); sim.toolMesh.traverse(o => o.geometry?.dispose()); }
    sim.toolMesh = toolMesh(s.tool);
    vp.sim.add(sim.toolMesh);
    sim.toolKey = key;
  }
  sim.toolMesh.visible = true;
  const t = sim.idx >= sim.segs.length ? 1 : sim.prog;
  const x = s.a.x + (s.b.x - s.a.x) * t, y = s.a.y + (s.b.y - s.a.y) * t, z = s.a.z + (s.b.z - s.a.z) * t;
  sim.toolMesh.position.set(x, y, z);
  // 4-axis: tool radial to the A axis (along the setup X)
  const aDeg = s.b.a != null ? (s.a.a ?? s.b.a) + ((s.b.a - (s.a.a ?? s.b.a)) * t) : 0;
  sim.toolMesh.rotation.set((-aDeg * Math.PI) / 180, 0, 0);
  // lathe with driven tool: radial holes have the tool along the radius at the hole's angle
  const liveC = s.b.live ? (s.b.polar && s.a.polar ? (Math.atan2(y, x) * 180) / Math.PI : s.b.c) : null;
  if (s.b.live === 'rad') sim.toolMesh.rotation.set(0, Math.PI / 2, (liveC * Math.PI) / 180, 'ZYX');
  const o = originOf(sim.gen.setup, sim.gen.stock);
  const nc = sim.collisions?.length || 0;
  const info = $('#simInfo');
  info.classList.toggle('bad', nc > 0);
  info.title = nc ? sim.collisions.map(c => `${({ rapid: 'Eilgang im Material', shank: 'Schaft über der Schneidenlänge berührt Material', holder: 'Werkzeughalter berührt Material' })[c.type]} – ${c.op}`).join('\n') : '';
  // lathe: X as diameter, Z from the finished face (as in the NC program)
  const pos = sim.turn ? `X${(2 * (liveC == null ? x : s.b.polar && s.a.polar ? Math.hypot(x, y) : (s.a.xr ?? s.b.xr) + (s.b.xr - (s.a.xr ?? s.b.xr)) * t)).toFixed(2)} Z${(z - sim.gen.stock.modelTop).toFixed(2)}${liveC != null ? ` C${liveC.toFixed(1)}` : ''}`
    : s.b.a != null ? `X${(x - o.x).toFixed(2)} Z${((s.a.mz ?? s.b.mz) + (s.b.mz - (s.a.mz ?? s.b.mz)) * t - o.z).toFixed(2)} A${aDeg.toFixed(1)}` : `X${(x - o.x).toFixed(2)} Y${(y - o.y).toFixed(2)} Z${(z - o.z).toFixed(2)}`;
  info.textContent = `${nc ? `⚠ ${nc} Kollision${nc > 1 ? 'en' : ''}  ` : ''}${fmtTime(sim.t)} / ${fmtTime(sim.total)}  ${pos}  ${s.op}`;
  $('#simProgress').value = sim.total ? Math.round((sim.t / sim.total) * 1000) : 0;
}

function advance(dt) {
  let rem = dt;
  while (rem > 0 && sim.idx < sim.segs.length) {
    const s = sim.segs[sim.idx];
    const left = s.dur * (1 - sim.prog);
    if (rem >= left) {
      cutSeg(s, sim.prog, 1);
      rem -= left;
      sim.t += left;
      sim.idx++;
      sim.prog = 0;
    } else {
      const np = sim.prog + rem / s.dur;
      cutSeg(s, sim.prog, np);
      sim.prog = np;
      sim.t += rem;
      rem = 0;
    }
  }
  if (sim.idx >= sim.segs.length) {
    sim.playing = false;
    sim.idx = sim.segs.length;
    $('#simPlay').textContent = '▶';
  }
}

function seek(target) {
  simStock().reset();
  clearCollisions();
  sim.idx = 0; sim.prog = 0; sim.t = 0;
  advance(Math.max(0, target));
  if (sim.idx >= sim.segs.length) { sim.idx = sim.segs.length - 1; sim.prog = 1; }
  simStock().update();
  if (stockSim.part && !sim.turn && !sim.rot) updateCompareInfo();
  placeTool();
}

vp.onFrame = dt => {
  cube.update();
  updateExtrudeGizmo();
  { const cd = vp.camera.position.clone().sub(vp.controls.target).normalize(); cubeWrapEl.classList.toggle("polar", vp.orbitMode === 'free' || Math.abs(cd.z) > 0.99); }
  if (!sim.open) return;
  if (!sim.segs) buildSim();
  if (sim.playing) {
    advance(dt * +$('#simSpeed').value);
    simStock().update();
    if (stockSim.part && !sim.turn && !sim.rot && performance.now() - (sim.cmpAt || 0) > 250) { sim.cmpAt = performance.now(); updateCompareInfo(); }
    placeTool();
  }
};

function openSim() {
  if (!activeGen()?.stock) return status('Kein Rohteil – erst ein Modell erstellen.');
  sim.open = !sim.open;
  sim.playing = false;
  $('#simBar').hidden = !sim.open;
  $('#simPlay').textContent = '▶';
  if (sim.open) buildSim();
  renderToolbar();
  rebuildScene();
  simInset();
}
// the simulation bar covers the lower part of the view: shift the picture up and fit the stock above the bar
// window or bar height changed (resizing, the bar wrapping onto more lines): the inset follows and the stock is
// fitted again; the bar's width changes all the time with the info text and does not count
let simInsetKey = '';
const simInsetObs = new ResizeObserver(() => {
  if (!sim.open) return;
  const bar = $('#simBar').getBoundingClientRect(), r = vp.el.getBoundingClientRect();
  const key = `${Math.round(r.width)}x${Math.round(r.height)}|${Math.round(bar.height)}|${Math.round(r.bottom - bar.top)}`;
  if (key === simInsetKey) return;
  clearTimeout(simInset.timer);
  simInset.timer = setTimeout(simInset, 120);
});
for (const el of [$('#simBar'), vp.el]) simInsetObs.observe(el);
function simInset() {
  if (!sim.open) { simInsetKey = ''; vp.setInset(0); return; }
  const bar = $('#simBar').getBoundingClientRect(), r = vp.el.getBoundingClientRect();
  simInsetKey = `${Math.round(r.width)}x${Math.round(r.height)}|${Math.round(bar.height)}|${Math.round(r.bottom - bar.top)}`;
  const inset = Math.max(0, Math.min(r.height * 0.6, r.bottom - bar.top + 8));
  vp.setInset(inset);
  fitView();
  const free = r.height - inset;
  if (inset && free > 50) {
    // fitted for the whole height: back off so the stock fits into the free part above the bar
    const t = vp.controls.target, off = vp.camera.position.clone().sub(t);
    vp.camera.position.copy(t).add(off.multiplyScalar(r.height / free));
    vp.controls.update?.();
  }
}

$('#simPlay').onclick = () => {
  if (!sim.segs) buildSim();
  if (!sim.segs.length) return;
  if (sim.idx >= sim.segs.length || (sim.idx === sim.segs.length - 1 && sim.prog >= 1)) seek(0);
  sim.playing = !sim.playing;
  $('#simPlay').textContent = sim.playing ? '⏸' : '▶';
};
$('#simReset').onclick = () => { sim.playing = false; $('#simPlay').textContent = '▶'; seek(0); };
$('#simProgress').oninput = e => { if (!sim.segs) buildSim(); sim.playing = false; $('#simPlay').textContent = '▶'; seek((sim.total * e.target.value) / 1000); };
$('#simModel').onchange = rebuildScene;
$('#simPaths').onchange = rebuildScene;
// comparison with the finished part: height of the part on the simulation grid (setup frame)
function simComparePart() {
  const g = sim.gen, s = g?.stock;
  if (!s || sim.turn || !stockSim.h) return null;
  const setup = state.project.cam.setups.find(x => x.id === activeSetupId());
  const bodies = setupBodies(getModel().bodies, setup || {}).map(b => ({ geometry: b.geometry.clone().applyMatrix4(g.T) }));
  if (!bodies.length) return null;
  const hm = buildHeightmap(bodies, { ...s, maxX: s.minX + stockSim.dx * (stockSim.nx - 1), maxY: s.minY + stockSim.dy * (stockSim.ny - 1) }, stockSim.dx);
  bodies.forEach(b => b.geometry.dispose());
  if (hm.nx !== stockSim.nx || hm.ny !== stockSim.ny) return null; // grids must match cell by cell
  return hm.h;
}
function applySimCompare() {
  const on = $('#simCompare').checked;
  stockSim.setCompare(on ? simComparePart() : null);
  if (on && !stockSim.part) status('Vergleich nur beim Fräsen und mit einem Modell möglich.');
  updateCompareInfo();
}
function updateCompareInfo() {
  const el = $('#simCompareInfo');
  const st = $('#simCompare').checked ? stockSim.compareStats() : null;
  if (!st) { el?.remove(); return; }
  const box = el || $('#simBar').appendChild(h('span', { id: 'simCompareInfo' }));
  const pct = v => `${Math.round(v * 100)} %`;
  box.replaceChildren(h('b', { class: 'c-ok' }, `■ ${pct(st.ok)} auf Maß`), ' ', h('b', { class: 'c-left' }, `■ ${pct(st.left)} Rest`), ' ',
    h('b', { class: 'c-gouge' }, `■ ${pct(st.gouge)} zu tief${st.gouge ? ` (max. ${f2(-st.worst)} mm)` : ''}`));
}
$('#simCompare').onchange = applySimCompare;
$('#simClose').onclick = openSim;

// ---------- file actions ----------
function loadExample(turning = false) {
  openAsNewDoc(migrate(turning ? exampleTurning() : exampleProject()));
  fitView();
}

function closeModes() {
  if (state.sketchId) { sketcher.stop(); state.sketchId = null; }
  state.pick = null;
  state.rollback = null;
  measure.pts = [];
  showBanner(null);
  if (sim.open) openSim();
}

document.querySelectorAll('.menu-list button').forEach(b => b.addEventListener('click', () => {
  document.activeElement.blur();
  menuAction(b.dataset.act);
}));
function menuAction(act) {
  if (act === 'settings') return openSettings();
  if (act === 'new') newDoc();
  else if (act === 'data') toggleData(true);
  else if (act === 'saveas') saveAsCmd();
  else if (act === 'open') $('#fileInput').click();
  else if (act === 'import') $('#cadInput').click();
  else if (act === 'save') saveVersionCmd();
  else if (act === 'export') {
    download(`${safeName()}.ofab`, JSON.stringify(withBlobs(state.project), null, 1), 'application/json');
    status('Design exportiert');
  } else if (act === 'example') loadExample();
  else if (act === 'example-turn') loadExample(true);
  else if (act === 'step' || act === 'stl' || act === 'iges') {
    const bodies = getModel().bodies.filter(x => !state.hiddenBodies.has(x.id));
    const meshes = getMeshes().bodies.filter(x => !state.hiddenBodies.has(x.id));
    if (act === 'stl' && meshes.length) return exportMeshSTL([...bodies, ...meshes]);
    if (!bodies.length) return status(meshes.length ? 'Netze können nur als STL exportiert werden.' : 'Kein Körper zum Exportieren.');
    const placed = assemblyActive() ? bodies.map(b => ({ ...b, shape: transformShape(b.shape, bodyMatrix(state.project.assembly, b.id, motionValues)) })) : bodies;
    if (act === 'step') download(`${safeName()}.step`, exportSTEP(placed), 'application/step');
    else if (act === 'iges') {
      status('IGES wird erzeugt …');
      exportSTEP(placed).text().then(stepToIges)
        .then(txt => { download(`${safeName()}.igs`, txt, 'model/iges'); status('IGES exportiert'); })
        .catch(err => alert('IGES-Export fehlgeschlagen: ' + (err.message || err)));
    }
    else {
      const grp = new THREE.Group();
      bodies.forEach(x => grp.add(new THREE.Mesh(x.geometry)));
      download(`${safeName()}.stl`, new STLExporter().parse(grp, { binary: true }), 'model/stl');
    }
  }
}

$('#fileInput').addEventListener('change', async e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (!file) return;
  try {
    const p = JSON.parse(await file.text());
    if (!Array.isArray(p.features) || !p.cam) throw new Error('Keine WerkFab-Datei');
    await takeBlobs(p);
    await openAsNewDoc(migrate(p));
    status(`„${file.name}“ geöffnet`);
  } catch (err) {
    alert('Datei konnte nicht geöffnet werden: ' + err.message);
  }
});

$('#cadInput').addEventListener('change', e => {
  const file = e.target.files[0];
  e.target.value = '';
  if (file) importCAD(file);
});

function commitProjectName(el) {
  const v = deText(el).trim();
  if (v && v !== state.project.name) commit(p => (p.name = v), 'meta');
  else el.textContent = state.project.name;
}
$('#projectName').addEventListener('blur', e => commitProjectName(e.target));
$('#projectName').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); commitProjectName(e.target); e.target.blur(); }
  if (e.key === 'Escape') { e.target.textContent = state.project.name; e.target.blur(); }
});

$('#workspace').addEventListener('change', e => {
  closeModes();
  state.workspace = e.target.value;
  state.sel = null;
  studio.setActive(state.workspace === 'render');
  renderAll();
  fitView();
});

$('#undoBtn').onclick = undo;
$('#redoBtn').onclick = redo;
document.querySelectorAll('#navBar button').forEach(b => b.addEventListener('click', () => {
  const { nav, view, display: disp } = b.dataset;
  if (view) { const box = getModel().box; vp.setView(view, box.isEmpty() ? null : box); return; }
  if (disp) {
    display = disp;
    document.querySelectorAll('#navBar [data-display]').forEach(x => x.classList.toggle('on', x === b));
    rebuildScene();
    return;
  }
  if (nav === 'fit') return fitView();
  if (nav === 'grid') { gridOn = !gridOn; vp.grid.visible = gridOn; b.classList.toggle('on', gridOn); return; }
  if (nav === 'orbit' || nav === 'pan') {
    vp.controls.mouseButtons.LEFT = nav === 'orbit' ? THREE.MOUSE.ROTATE : THREE.MOUSE.PAN;
    document.querySelectorAll('#navBar [data-nav=orbit], #navBar [data-nav=pan]').forEach(x => x.classList.toggle('on', x === b));
  }
}));

document.querySelectorAll('[data-tl]').forEach(b => b.addEventListener('click', () => {
  const n = state.project.features.length;
  const cur = state.rollback ?? n;
  const next = { start: 0, end: n, back: Math.max(0, cur - 1), fwd: Math.min(n, cur + 1) }[b.dataset.tl];
  setRollback(next >= n ? null : next);
}));

let downAt = null;
vp.canvas.addEventListener('pointerdown', e => (downAt = [e.clientX, e.clientY]));
vp.canvas.addEventListener('pointerup', e => {
  if (!downAt || !state.pick || state.sketchId || e.button !== 0) return;
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) < 5) viewportClick(e);
});

window.addEventListener('keydown', e => {
  const tag = e.target.tagName;
  if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) return;
  const k = e.key.toLowerCase();
  // user-assigned shortcuts win over the built-in ones
  const combo = keyCombo(e);
  const bound = combo && !RESERVED_KEYS.includes(combo) && Object.entries(tbKeys).find(([, v]) => v === combo);
  const hit = bound && allToolButtons.find(it => it.id === bound[0]);
  if (hit) { e.preventDefault(); hit.el.click(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'y') { e.preventDefault(); redo(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 's') { e.preventDefault(); saveVersionCmd(); return; }
  if ((e.ctrlKey || e.metaKey) && k === 'n') { e.preventDefault(); newDoc(); return; }
  if (state.sketchId) { const r = sketcher.key(e); if (r) { if (r !== 'focus') e.preventDefault(); return; } }
  if (e.key === 'Escape') {
    if (state.pick) { state.pick = null; measure.pts = []; showBanner(null); renderAll(); }
    else if (state.sketchId) finishSketch();
    else if (state.sel) { state.sel = null; renderAll(); }
    return;
  }
  if (e.key === 'Enter' && dialogTarget()) { e.preventDefault(); dialogOk(); return; }
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.key === 'F6') { e.preventDefault(); return fitView(); }
  // F = Verrundung in KONSTRUKTION; elsewhere F still fits the view
  if (k === 'f' && !(state.workspace === 'design' && !state.sketchId)) return fitView();
  if (k === 'v' && !state.sketchId) {
    // V toggles visibility of the selected body or sketch
    if (state.sel?.kind === 'body') return setBodyHidden([state.sel.id], !state.hiddenBodies.has(state.sel.id));
    const f = state.sel?.kind === 'feature' && feature(state.sel.id);
    if (f?.type === 'sketch') return setSketchesHidden([f.id], !f.hidden);
  }
  if (k === 's' && !state.sketchId) { e.preventDefault(); return openCommandSearch(); }
  if (state.workspace === 'design' && !state.sketchId) {
    if (k === 'e') return createFeature('extrude');
    if (k === 'h') return createFeature('hole');
    if (k === 'f') return createFeature('fillet');
    if (k === 'q') return startPressPull();
    if (k === 'm') return createFeature('move');
    if (k === 'a') return openAppearance();
    if (k === 'i') return toggleMeasure();
    if (k === 'k') return startPickPlane();
    if (e.key === 'Delete' && state.sel?.kind === 'feature') return deleteFeature(state.sel.id);
  }
});

// ---------- render all ----------
function renderAll() {
  if (state.sketchId && !feature(state.sketchId)) { sketcher.stop(); state.sketchId = null; }
  if (state.sel?.kind === 'feature' && !feature(state.sel.id)) state.sel = null;
  if (state.pick?.id && !['camfaces', 'opheight', 'oppoints', 'opbound', 'facegroup'].includes(state.pick.mode) && !SETUP_PICKS.includes(state.pick.mode) && !feature(state.pick.id)) { state.pick = null; showBanner(null); }
  if (['opheight', 'oppoints', 'opbound', 'facegroup'].includes(state.pick?.mode) && (!camOp(state.pick.id) || state.workspace !== 'cam')) { state.pick = null; showBanner(null); }
  if (SETUP_PICKS.includes(state.pick?.mode) && (state.workspace !== 'cam' || !state.project.cam.setups.some(x => x.id === state.pick.id))) { state.pick = null; showBanner(null); }
  if (state.pick?.mode === 'camfaces' && (!camOp(state.pick.id) || state.workspace !== 'cam')) { state.pick = null; showBanner(null); }
  if (state.sel?.kind === 'op' && !camOp(state.sel.id)) state.sel = { kind: 'setup', id: state.project.cam.setups[0].id };
  if (state.sel?.kind === 'setup' && !state.project.cam.setups.some(x => x.id === state.sel.id)) state.sel = { kind: 'setup', id: state.project.cam.setups[0].id };
  if (state.sel?.kind === 'body' && !model.bodies.some(x => x.id === state.sel.id)) state.sel = null;
  if (state.sel?.kind === 'mesh' && !getMeshes().bodies.some(x => x.id === state.sel.id)) state.sel = null;
  if (state.rollback != null && state.rollback >= state.project.features.length) state.rollback = null;
  renderDocTabs();
  renderComments();
  renderToolbar();
  appPanel?.redraw();
  renderTree();
  renderTimeline();
  renderProps();
  rebuildScene();
  if (state.sketchId) sketcher.syncPlane();
  if (sim.open && !sim.segs) buildSim();
  renderToolLib();
  renderMachineLib();
  renderPostEditor();
  renderDrawing();
  renderWindowMenu();
}

onChange(renderAll);

// Small input dialog; replaces window.prompt (not available in the desktop app).
function askValue(label, def = '') {
  return new Promise(resolve => {
    const input = h('input', { type: 'text', value: def, style: 'width:100%;padding:6px 8px;border:1px solid var(--line);border-radius:4px;background:var(--input)' });
    const back = h('div', { class: 'modal-back' });
    const done = v => { back.remove(); resolve(v); };
    input.onkeydown = e => { if (e.key === 'Enter') done(input.value); if (e.key === 'Escape') done(null); };
    back.append(h('div', { class: 'modal', style: 'height:auto;width:min(380px,calc(100vw - 32px))' },
      h('div', { class: 'modal-head' }, 'EINGABE', h('button', { onclick: () => done(null) }, '✕')),
      h('div', { style: 'padding:14px 16px;display:grid;gap:8px' }, h('label', null, label), input),
      h('div', { class: 'modal-foot' }, h('button', { onclick: () => done(null) }, 'Abbrechen'), h('button', { class: 'primary', onclick: () => done(input.value) }, 'OK'))));
    document.body.append(back);
    input.focus();
    input.select();
  });
}

// ---------- settings (Einstellungen) ----------
function freshProject() {
  const s = getSettings();
  const p = newProject();
  p.docId = uid('doc');
  p.post = { ...p.post, flavor: s.defaultPost || p.post.flavor, coolant: !!s.coolant, arcs: s.arcs !== false, lineNumbers: !!s.lineNumbers };
  for (const st of p.cam.setups) { st.safeZ = +s.safeZ || st.safeZ; st.retract = +s.retract || st.retract; if (s.defaultMachine) st.machine = s.defaultMachine; }
  return p;
}

// geometry kernel from the settings: load it, then rebuild the model with it
let kernelBusy = false;
const kernelFailed = new Set();
function switchKernel(id) {
  if (kernelBusy || id === activeKernelId() || kernelFailed.has(id)) return;
  kernelBusy = true;
  setActiveKernel(id)
    .then(k => { status(`Geometriekern: ${k.name}`); renderAll(); })
    .catch(err => { kernelFailed.add(id); status(`Geometriekern konnte nicht geladen werden (${err.message || err}) – OpenCascade bleibt aktiv.`); })
    .finally(() => { kernelBusy = false; });
}
function applySettings() {
  const s = getSettings();
  const root = document.documentElement;
  if (s.theme === 'system') delete root.dataset.theme; else root.dataset.theme = s.theme;
  const wrap = $('#viewportWrap');
  wrap.style.background = { gradient: '', light: 'linear-gradient(#ffffff, #dde3ea)', dark: 'linear-gradient(#3b424a, #1b1f24)', solid: s.bgColor }[s.background] ?? '';
  gridOn = s.showGrid !== false;
  vp.grid.visible = gridOn;
  document.querySelector('#navBar [data-nav="grid"]')?.classList.toggle('on', gridOn);
  vp.axesGroup.visible = s.showAxes !== false;
  $('#cubeWrap').hidden = s.showViewCube === false;
  $('#navBar').hidden = s.showNavBar === false;
  vp.setMouse(s.mouse);
  vp.setNavigation({ ...s, fov: s.camera === 'ortho' ? 1.5 : s.fov });
  vp.setOrbitMode(s.orbitMode);
  switchKernel(s.kernel || 'occ');
  PREC = Math.max(1, Math.min(5, Math.round(+s.decimals) || 2));
  setUndoLimit(s.undoLimit);
  document.body.classList.toggle('no-tb-labels', s.toolbarLabels === false);
  const pr = { high: Math.min(window.devicePixelRatio || 1, 2), normal: 1, performance: 0.75 }[s.quality] || 1;
  if (vp.renderer.getPixelRatio() !== pr) { vp.renderer.setPixelRatio(pr); vp.resize(); }
  // visual style: applied at start and whenever the preference changes
  if (s.defaultDisplay !== appliedDisplayPref) {
    appliedDisplayPref = s.defaultDisplay;
    display = s.defaultDisplay || 'edges';
    document.querySelectorAll('#navBar [data-display]').forEach(x => x.classList.toggle('on', x.dataset.display === display));
  }
  state.noAutosave = s.autosave === false;
  if (!state.sketchId) state.snap = +s.snap || state.snap;
  const sp = $('#simSpeed');
  if (sp && [...sp.options].some(o => o.value === String(s.simSpeed))) sp.value = String(s.simSpeed);
  if (state.project) applyTheme();
}

const SM_ACTIONS = [['search', 'Befehl suchen'], ['fit', 'Einpassen'], ['home', 'Startansicht'], ['top', 'Ansicht oben'], ['front', 'Ansicht vorne'], ['right', 'Ansicht rechts'], ['menu', 'Markierungsmenü'], ['none', 'Keine Funktion']];

// Preferences like the usual "Voreinstellungen": category tree on the left, grouped
// options on the right, changes take effect with "Übernehmen" or "OK".
// Row: [key, label, help, kind, options]; kind: bool | num | color | text | list | posts | machines
const PREF_TREE = [
  { id: 'general', label: 'Allgemein', groups: [
    ['Allgemein', [
      ['startWorkspace', 'Standard-Arbeitsbereich', 'Arbeitsbereich beim Start von WerkFab', [['design', 'Konstruktion'], ['cam', 'Fertigung']]],
      ['startExample', 'Mit Beispielprojekt starten', 'Wenn noch kein Projekt gespeichert ist, das Beispiel laden', 'bool'],
      ['autosave', 'Automatisch speichern', 'Projekt bei jeder Änderung auf diesem Rechner sichern', 'bool'],
      ['confirmDelete', 'Löschen bestätigen', 'Vor dem Löschen eines Features nachfragen', 'bool'],
      ['undoLimit', 'Rückgängig-Schritte', 'Wie viele Schritte Strg+Z zurückgehen kann', 'num', { min: 10, max: 2000, step: 10 }],
    ]],
    ['Updates', [
      ['updateCheck', 'Nach Updates suchen', 'Fragt beim Start bei GitHub nach einer neuen Version. Sonst baut WerkFab von sich aus keine Verbindung ins Netz auf.', 'bool'],
      ['__update'],
    ]],
    ['Benutzeroberfläche', [
      ['theme', 'Farbschema', 'Hell, dunkel oder wie in Windows eingestellt', [['system', 'Wie Windows'], ['light', 'Hell'], ['dark', 'Dunkel']]],
      ['hoverHighlight', 'Vorauswahl hervorheben', 'Fläche oder Kante unter dem Mauszeiger farbig anzeigen', 'bool'],
      ['toolbarLabels', 'Beschriftungen in der Werkzeugleiste', 'Text unter den Symbolen anzeigen (aus = kompakte Leiste)', 'bool'],
      ['showViewCube', 'ViewCube anzeigen', 'Würfel oben rechts zum Ausrichten der Ansicht', 'bool'],
      ['showNavBar', 'Navigationsleiste anzeigen', 'Leiste unten mit Drehen, Verschieben, Ansichten', 'bool'],
    ]],
  ], children: [
    { id: 'design', label: 'Konstruktion', groups: [
      ['Skizze', [
        ['autoLookAt', 'Skizze automatisch ausrichten', 'Beim Bearbeiten einer Skizze senkrecht auf die Skizzenebene schauen', 'bool'],
        ['sketchDims', 'Bemaßungen anzeigen', 'Bemaßungen in der aktiven Skizze einblenden', 'bool'],
        ['sketchGlyphs', 'Abhängigkeiten anzeigen', 'Symbole für Abhängigkeiten (parallel, senkrecht …) einblenden', 'bool'],
        ['sketchFill', 'Profile hervorheben', 'Geschlossene Profile der aktiven Skizze farbig füllen', 'bool'],
        ['snap', 'Raster/Fang', 'Schrittweite beim Zeichnen; 0 = frei', 'num', { unit: 'mm', min: 0 }],
      ]],
      ['Features', [
        ['defaultExtrude', 'Standard-Extrusionslänge', 'Vorgabe für neue Extrusionen', 'num', { unit: 'mm' }],
      ]],
      ['Geometriekern', [
        ['kernel', 'Geometriekern', 'OpenCascade: alle Funktionen. Rust-Kern (truck, experimentell): Grundkörper, Extrusion, Rotation, Bohrung, Muster, Spiegeln, Verschieben, Skalieren, Kombinieren und STEP-Export – andere Features werden als „noch nicht unterstützt“ markiert.', [['occ', 'OpenCascade (alle Funktionen)'], ['rust', 'Rust-Kern (experimentell)']]],
      ]],
    ] },
    { id: 'manufacture', label: 'Fertigung', groups: [
      ['Neue Projekte', [
        ['defaultPost', 'Standard-Postprozessor', 'Steuerung für neue Projekte', 'posts'],
        ['defaultMachine', 'Standard-Maschine', 'Maschine für neue Setups', 'machines'],
        ['safeZ', 'Sicherheitshöhe', 'Abstand über dem Rohteil für Eilgänge', 'num', { unit: 'mm' }],
        ['retract', 'Rückzugshöhe', 'Höhe zwischen zwei Bearbeitungen', 'num', { unit: 'mm' }],
      ]],
      ['NC-Ausgabe', [
        ['coolant', 'Kühlmittel ausgeben', 'M8/M9 im NC-Programm', 'bool'],
        ['arcs', 'Kreisbögen (G2/G3) ausgeben', 'Sonst werden Bögen als kurze Geraden ausgegeben', 'bool'],
        ['lineNumbers', 'Satznummern', 'N10, N20 … vor jedem Satz', 'bool'],
      ]],
      ['Simulation', [
        ['simSpeed', 'Simulationsgeschwindigkeit', 'Startwert beim Öffnen der Simulation', [['1', '1×'], ['5', '5×'], ['20', '20×'], ['60', '60×'], ['200', '200×'], ['1000', '1000×']]],
      ]],
    ] },
  ] },
  { id: 'nav', label: 'Navigation', groups: [
    ['Maus', [
      ['mouse', 'Verschieben/Zoomen/Drehen wie in', 'Maustastenbelegung anderer CAD-Programme', Object.entries(MOUSE_PRESETS).map(([k, v]) => [k, v.label])],
      ['invertZoom', 'Zoomrichtung umkehren', 'Mausrad nach vorne = verkleinern', 'bool'],
      ['zoomToCursor', 'Zum Mauszeiger zoomen', 'Sonst wird zur Bildmitte gezoomt', 'bool'],
      ['orbitMode', 'Orbit', 'Frei: das Werkstück dreht sich in alle Richtungen (auch über Kopf). Eingeschränkt: die Z-Achse bleibt senkrecht.', [['free', 'Frei (in alle Richtungen)'], ['constrained', 'Eingeschränkt (Z bleibt senkrecht)']]],
      ['orbitSpeed', 'Drehgeschwindigkeit', '1 = normal', 'num', { min: 0.1, max: 5, step: 0.1 }],
    ]],
  ], children: [
    { id: 'spacemouse', label: 'SpaceMouse', groups: [
      ['Gerät', [
        ['spaceMouse', 'SpaceMouse verwenden', '3Dconnexion SpaceMouse, SpaceNavigator, SpaceMouse Pro/Wireless/Enterprise', 'bool'],
        ['__smStatus'],
        ['__smCalib'],
      ]],
      ['Bewegung', [
        ['smSpeed', 'Empfindlichkeit', '0,2 = sehr fein, 1 = normal, 3 = schnell', 'num', { min: 0.1, max: 5, step: 0.1 }],
        ['smInvertPan', 'Verschieben umkehren', 'Ansicht statt Modell bewegen', 'bool'],
        ['smInvertZoom', 'Zoomrichtung umkehren', '', 'bool'],
        ['smInvertRot', 'Drehen umkehren', '', 'bool'],
        ['smDominant', 'Nur stärkste Achse', 'Bewegt jeweils nur in eine Richtung – leichter für Einsteiger', 'bool'],
      ]],
      ['Tasten', [
        ['smButton1', 'Linke Taste', '', SM_ACTIONS],
        ['smButton2', 'Rechte Taste', '', SM_ACTIONS],
      ]],
    ], note: 'Kappe schieben = verschieben, drücken/ziehen = zoomen, kippen und drehen = Modell drehen. In Skizzen nur Verschieben und Zoomen. SpaceMouse Pro/Enterprise: T, F, R = Ansicht oben, vorne, rechts. Falls nichts passiert: 3Dconnexion-Treiber kurz beenden und neu verbinden.' },
  ] },
  { id: 'graphics', label: 'Grafik', groups: [
    ['Ansicht', [
      ['camera', 'Kamera', 'Orthogonal = ohne Perspektive, Maße wirken überall gleich groß', [['perspective', 'Perspektive'], ['ortho', 'Orthogonal']]],
      ['fov', 'Blickwinkel (Perspektive)', '20° = schwache, 60° = starke Perspektive', 'num', { unit: '°', min: 10, max: 90 }],
      ['defaultDisplay', 'Visueller Stil beim Start', 'Darstellung der Körper', [['edges', 'Schattiert mit Kanten'], ['shaded', 'Schattiert'], ['wire', 'Drahtkörper']]],
      ['quality', 'Darstellungsqualität', 'Hoch = scharf auf hochauflösenden Bildschirmen, Leistung = schneller', [['high', 'Hoch'], ['normal', 'Normal'], ['performance', 'Leistung']]],
    ]],
    ['Umgebung', [
      ['background', 'Hintergrund', 'Umgebung der Arbeitsfläche', [['gradient', 'Verlauf (Farbschema)'], ['light', 'Hell'], ['dark', 'Dunkelgrau'], ['solid', 'Einfarbig']]],
      ['bgColor', 'Hintergrundfarbe', 'Für „Einfarbig“', 'color'],
      ['showGrid', 'Raster anzeigen', 'Bodenraster in der XY-Ebene', 'bool'],
      ['showAxes', 'Achsen am Ursprung', 'Rote, grüne und blaue Achse', 'bool'],
    ]],
  ] },
  { id: 'units', label: 'Einheiten- und Wertanzeige', groups: [
    ['Sprache / Language', [
      ['__lang'],
    ]],
    ['Einheiten', [
      ['__unit'],
    ]],
    ['Anzeige', [
      ['decimals', 'Anzeigegenauigkeit', 'Nachkommastellen bei Maßen und Ergebnissen', [['1', '0,0'], ['2', '0,00'], ['3', '0,000'], ['4', '0,0000']]],
    ]],
  ] },
  { id: 'data', label: 'Daten und Speicher', groups: [
    ['Speicher', [['__storage']]],
    ['Einstellungen', [['__prefsIO']]],
    ['Fenster', [['__layout']]],
  ] },
  { id: 'keys', label: 'Tastenkürzel', groups: [] },
  { id: 'about', label: 'Über WerkFab', groups: [] },
];

const prefIndex = (() => {
  const all = [];
  const walk = (list, depth, parent) => list.forEach(n => { all.push({ ...n, depth, parent }); if (n.children) walk(n.children, depth + 1, n.id); });
  walk(PREF_TREE, 0, null);
  return all;
})();

let settingsPage = 'general';
function openSettings(page) {
  if (typeof page === 'string' && prefIndex.some(n => n.id === page)) settingsPage = page;
  document.querySelector('.prefs-back')?.remove();
  const draft = { ...getSettings() };
  let dirty = false;
  const back = h('div', { class: 'modal-back prefs-back' });
  const tree = h('div', { class: 'prefs-tree' });
  const body = h('div', { class: 'prefs-body' });
  const applyBtn = h('button', { disabled: true, onclick: () => apply() }, 'Übernehmen');
  const setDirty = v => { dirty = v; applyBtn.disabled = !v; };
  const apply = () => {
    if (!dirty) return;
    saveSettings(draft);
    applySettings();
    renderAll();
    setDirty(false);
  };
  const close = () => back.remove();
  const info = text => (text ? h('span', { class: 'prefs-q', title: text }, '?') : null);

  const control = (key, kind, opt = {}) => {
    const set = v => { draft[key] = v; setDirty(true); };
    if (kind === 'bool') { const i = h('input', { type: 'checkbox' }); i.checked = !!draft[key]; i.onchange = () => set(i.checked); return i; }
    if (kind === 'color') { const i = h('input', { type: 'color', value: draft[key] }); i.oninput = () => set(i.value); return i; }
    if (kind === 'num') {
      const i = h('input', { type: 'number', value: draft[key], step: opt.step || 'any' });
      if (opt.min != null) i.min = opt.min;
      if (opt.max != null) i.max = opt.max;
      i.onchange = () => { let v = parseFloat(String(i.value).replace(',', '.')); if (!Number.isFinite(v)) return; if (opt.min != null) v = Math.max(opt.min, v); if (opt.max != null) v = Math.min(opt.max, v); i.value = v; set(v); };
      return i;
    }
    const list = kind === 'posts' ? allPosts(state.project).map(x => [x.id, x.name])
      : kind === 'machines' ? [['', '– keine –'], ...allMachines(state.project).map(x => [x.id, x.name])] : kind;
    const sl = h('select', null, ...list.map(([v, l]) => h('option', { value: v }, l)));
    sl.value = String(draft[key]);
    sl.onchange = () => set(typeof DEFAULTS[key] === 'number' ? +sl.value : sl.value);
    return sl;
  };

  // special rows with actions instead of a stored value
  const special = key => {
    if (key === '__lang') return h('div', { class: 'prefs-row no-i18n' }, h('label', null, 'Sprache / Language', info('Die Oberfläche wird neu geladen · The page reloads')),
      h('div', { class: 'prefs-ctl' }, sel(Object.entries(LANGS), uiLang, v => setLanguage(v))));
    if (key === '__update') return h('div', { class: 'prefs-row' }, h('label', null, 'Neue Version', info('Installierte Windows-App und Linux-AppImage laden das Update selbst; sonst öffnet sich die Download-Seite')),
      h('div', { class: 'prefs-ctl' }, h('button', { class: 'btn', onclick: () => checkForUpdates(true) }, 'Jetzt nach Updates suchen')));
    if (key === '__unit') return h('div', { class: 'prefs-row' }, h('label', null, 'Standardeinheit', info('Alle Längen in Millimeter, Winkel in Grad')), h('div', { class: 'prefs-ctl' }, h('b', null, 'Millimeter (mm)')));
    if (key === '__smStatus') {
      const st = h('b', { style: spaceMouse.connected ? 'color:var(--ok)' : '' }, !spaceMouse.supported ? 'Nicht unterstützt (Chrome, Edge oder Desktop-App nötig)' : spaceMouse.connected ? `Verbunden: ${spaceMouse.name}` : 'Nicht verbunden');
      return h('div', { class: 'prefs-row' }, h('label', null, 'Status', info('Gerät per USB oder Funkempfänger anschließen')),
        h('div', { class: 'prefs-ctl' }, st, spaceMouse.supported ? h('button', { class: 'prefs-btn', onclick: async () => { try { if (spaceMouse.connected) await spaceMouse.disconnect(); else await spaceMouse.request(); } catch (err) { status(err.message); } draw(); } }, spaceMouse.connected ? 'Trennen' : 'Verbinden …') : null));
    }
    if (key === '__smCalib') return h('div', { class: 'prefs-row' }, h('label', null, 'Kalibrierung', info('Nullpunkt, Totzone, Empfindlichkeit und Richtung jeder Achse einstellen')),
      h('div', { class: 'prefs-ctl' }, h('button', { class: 'prefs-btn', onclick: () => openSmCalibration(draw) }, 'Kalibrieren …')));
    if (key === '__storage') {
      const out = h('b', null, '…');
      const sizeOf = k => { try { return (localStorage.getItem(k) || '').length * 2; } catch { return 0; } };
      const mb = n => `${(n / 1e6).toFixed(n < 1e5 ? 3 : 1)} MB`;
      (navigator.storage?.estimate ? navigator.storage.estimate() : Promise.resolve({})).then(e => {
        out.textContent = `Projekt ${mb(sizeOf('openfab.project.v1'))}` + (e.usage != null ? ` · Importe/Offline-Daten ${mb(e.usage)}${e.quota ? ` (frei: ${(e.quota / 1e9).toFixed(1)} GB)` : ''}` : '');
      });
      return h('div', { class: 'prefs-row' }, h('label', null, 'Belegter Speicher', info('Automatisch gespeichertes Projekt, importierte STEP/IGES-Dateien und Offline-Daten')), h('div', { class: 'prefs-ctl' }, out));
    }
    if (key === '__prefsIO') {
      return h('div', { class: 'prefs-row' }, h('label', null, 'Einstellungen sichern', info('Als Datei speichern, um sie auf einen anderen Rechner zu übertragen')),
        h('div', { class: 'prefs-ctl' },
          h('button', { class: 'prefs-btn', onclick: () => download('werkfab-einstellungen.json', JSON.stringify(getSettings(), null, 1), 'application/json') }, 'Exportieren …'),
          h('button', { class: 'prefs-btn', onclick: () => {
            const inp = h('input', { type: 'file', accept: '.json,application/json' });
            inp.onchange = async () => {
              try {
                const data = JSON.parse(await inp.files[0].text());
                for (const k of Object.keys(DEFAULTS)) if (k in data && typeof data[k] === typeof DEFAULTS[k]) draft[k] = data[k];
                setDirty(true);
                draw();
                status('Einstellungen geladen – mit „Übernehmen“ oder „OK“ aktivieren.');
              } catch { status('Datei ist keine WerkFab-Einstellungsdatei.'); }
            };
            inp.click();
          } }, 'Importieren …')));
    }
    if (key === '__layout') {
      return h('div', { class: 'prefs-row' }, h('label', null, 'Fensteranordnung', info('Browser, Eigenschaften, Zeitachse und Bibliotheken an ihre Standardposition setzen')),
        h('div', { class: 'prefs-ctl' }, h('button', { class: 'prefs-btn', onclick: () => { wm.reset(); renderToolLib(); status('Fensteranordnung zurückgesetzt'); } }, 'Zurücksetzen')));
    }
    return null;
  };

  const draw = () => {
    tree.replaceChildren(...prefIndex.map(n => {
      const kids = prefIndex.some(c => c.parent === n.id);
      const hiddenByParent = n.parent && closedPrefs.has(n.parent);
      if (hiddenByParent || (n.parent && prefIndex.some(p => p.id === n.parent && p.parent && closedPrefs.has(p.parent)))) return null;
      return h('div', {
        class: 'prefs-node' + (n.id === settingsPage ? ' on' : ''), style: `padding-left:${8 + n.depth * 16}px`,
        onclick: () => { settingsPage = n.id; draw(); },
      },
      h('span', { class: 'prefs-tw', onclick: kids ? e => { e.stopPropagation(); closedPrefs.has(n.id) ? closedPrefs.delete(n.id) : closedPrefs.add(n.id); draw(); } : null }, kids ? (closedPrefs.has(n.id) ? '▸' : '▾') : ''),
      n.label);
    }).filter(Boolean));
    const page = prefIndex.find(n => n.id === settingsPage) || prefIndex[0];
    body.replaceChildren(h('div', { class: 'prefs-title' }, page.label));
    if (page.id === 'keys') { body.append(shortcutsHelp()); return; }
    if (page.id === 'about') {
      body.append(h('div', { class: 'prefs-about' },
        h('div', { class: 'prefs-logo' }, 'W'),
        h('div', null, h('b', null, 'WerkFab CAD/CAM'), h('div', { class: 'hint' }, 'Konstruktion und Fertigung – läuft komplett offline.'),
          h('p', { class: 'hint' }, 'Geometriekern: OpenCascade (über replicad) · Darstellung: three.js · Einstellungen werden auf diesem Rechner gespeichert.'))));
      return;
    }
    for (const [title, rows] of page.groups) {
      const grp = h('fieldset', { class: 'prefs-group' }, h('legend', null, title));
      for (const [key, label, help, kind, opt] of rows) {
        if (key.startsWith('__')) { const r = special(key); if (r) grp.append(r); continue; }
        if (kind === 'bool') {
          // common CAD/CAM style: check box in front of the text
          grp.append(h('label', { class: 'prefs-row prefs-check' }, control(key, kind, opt), h('span', null, label), info(help)));
        } else {
          grp.append(h('div', { class: 'prefs-row' }, h('label', null, label, info(help)),
            h('div', { class: 'prefs-ctl' }, control(key, kind, opt || {}), opt?.unit ? h('span', { class: 'hint' }, opt.unit) : null)));
        }
      }
      body.append(grp);
    }
    if (page.note) body.append(h('p', { class: 'hint prefs-note' }, page.note));
  };

  // "Standardeinstellungen wiederherstellen" resets the options of the open page
  const restore = () => {
    const page = prefIndex.find(n => n.id === settingsPage);
    const keys = (page?.groups || []).flatMap(([, rows]) => rows.map(r => r[0])).filter(k => !k.startsWith('__'));
    if (!keys.length) return;
    for (const k of keys) draft[k] = DEFAULTS[k];
    setDirty(true);
    draw();
  };

  const dlg = h('div', { class: 'prefs' },
    h('div', { class: 'prefs-head' }, h('span', null, 'Voreinstellungen'), h('button', { class: 'prefs-x', title: 'Schließen', onclick: close }, '✕')),
    h('div', { class: 'prefs-main' }, tree, body),
    h('div', { class: 'prefs-foot' },
      h('button', { onclick: restore, title: 'Alle Optionen dieser Seite auf die Standardwerte setzen' }, 'Standardeinstellungen wiederherstellen'),
      h('span', { style: 'flex:1' }),
      h('button', { class: 'primary', onclick: () => { apply(); close(); } }, 'OK'),
      h('button', { onclick: close }, 'Abbrechen'),
      applyBtn));
  // drag the dialog by its title bar
  const head = dlg.querySelector('.prefs-head');
  head.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = dlg.getBoundingClientRect(), x0 = e.clientX - r.left, y0 = e.clientY - r.top;
    head.setPointerCapture(e.pointerId);
    const mv = ev => { dlg.style.position = 'fixed'; dlg.style.margin = '0'; dlg.style.left = Math.max(0, Math.min(innerWidth - 80, ev.clientX - x0)) + 'px'; dlg.style.top = Math.max(0, Math.min(innerHeight - 40, ev.clientY - y0)) + 'px'; };
    const up = () => { head.removeEventListener('pointermove', mv); head.removeEventListener('pointerup', up); };
    head.addEventListener('pointermove', mv);
    head.addEventListener('pointerup', up);
  });
  back.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } if (e.key === 'Enter' && e.target.tagName !== 'BUTTON') { apply(); close(); } });
  back.append(dlg);
  document.body.append(back);
  dlg.tabIndex = -1;
  dlg.focus();
  draw();
}
const closedPrefs = new Set();

function shortcutsHelp() {
  const mouse = {
    openfab: [['Linke Taste ziehen', 'Drehen'], ['Mittlere/rechte Taste ziehen', 'Verschieben'], ['Mausrad', 'Zoomen']],
    fusion: [['Mittlere Taste ziehen', 'Verschieben'], ['Umschalt + mittlere Taste', 'Drehen'], ['Mausrad', 'Zoomen']],
    inventor: [['Mittlere Taste ziehen', 'Verschieben'], ['Umschalt + mittlere Taste', 'Drehen'], ['Mausrad', 'Zoomen']],
    solidworks: [['Mittlere Taste ziehen', 'Drehen'], ['Strg + mittlere Taste', 'Verschieben'], ['Mausrad', 'Zoomen']],
    tinkercad: [['Rechte Taste ziehen', 'Drehen'], ['Mittlere Taste ziehen', 'Verschieben'], ['Mausrad', 'Zoomen']],
  }[getSettings().mouse] || [];
  const keys = [['S', 'Befehl suchen'], ['Rechtsklick', 'Markierungsmenü'], ['K', 'Skizze erstellen'], ['E', 'Extrusion'], ['H', 'Bohrung'], ['F', 'Einpassen'],
    ['Entf', 'Feature löschen'], ['Esc', 'Abbrechen / Skizze beenden'], ['Strg+Z / Strg+Y', 'Rückgängig / Wiederholen'], ['Strg+S', 'Projekt speichern'],
    ['L R C P O T', 'Skizze: Linie, Rechteck, Kreis, Polygon, Langloch, Text'], ['D', 'Skizze: Bemaßung']];
  const own = Object.entries(tbKeys).map(([id, k]) => [k, `${id.split('|').slice(1).join('|')} (eigener Kurzbefehl)`]);
  return h('div', null, h('div', { class: 'keys' }, ...[...mouse, ...keys, ...own].flatMap(([k, v]) => [h('div', null, h('kbd', null, k)), h('div', null, v)])),
    h('p', { class: 'muted', style: 'margin-top:12px' }, 'Eigene Kurzbefehle: in der Symbolleiste das Gruppenmenü (▾) öffnen, beim Befehl auf ⋮ klicken → „Tastaturkurzbefehl ändern …“.'));
}

$('#settingsBtn').onclick = openSettings;
$('#helpBtn').onclick = () => openSettings('keys');
$('#searchBtn').onclick = () => openCommandSearch();

// ---------- SpaceMouse calibration ----------
const SM_AXES = [['X', 'Verschieben links/rechts'], ['Y', 'Ziehen/Drücken (Zoom)'], ['Z', 'Verschieben auf/ab'], ['RX', 'Kippen vor/zurück'], ['RY', 'Kippen seitlich (Rollen)'], ['RZ', 'Drehen um die Kappe']];
function openSmCalibration(onClose) {
  const back = h('div', { class: 'modal-back smcal-back' });
  const body = h('div', { class: 'smcal-body' });
  let open = true, phase = null;
  const st = () => getSettings();
  const save = patch => { saveSettings(patch); };
  const arr = (k, d) => (Array.isArray(st()[k]) && st()[k].length === 6 ? st()[k].slice() : d.slice());
  const close = () => { open = false; spaceMouse.paused = false; back.remove(); onClose?.(); };
  spaceMouse.paused = true;
  const head = h('div', { class: 'smcal-status' });
  const rows = SM_AXES.map(([ax, label], i) => {
    const fill = h('div', { class: 'smcal-fill' }), dz = h('div', { class: 'smcal-dz' }), val = h('span', { class: 'smcal-val' }, '0.00');
    const gain = h('input', { type: 'text', value: String(arr('smGain', [1, 1, 1, 1, 1, 1])[i]) });
    gain.onchange = () => { const g = arr('smGain', [1, 1, 1, 1, 1, 1]); const v = +gain.value.replace(',', '.'); g[i] = Number.isFinite(v) && v > 0 ? +v.toFixed(3) : 1; gain.value = g[i]; save({ smGain: g }); };
    const inv = h('input', { type: 'checkbox', checked: !!arr('smInv', Array(6).fill(false))[i], onchange: e => { const a = arr('smInv', Array(6).fill(false)); a[i] = e.target.checked; save({ smInv: a }); } });
    return { el: h('div', { class: 'smcal-row' }, h('b', null, ax), h('span', { class: 'smcal-lbl' }, label), h('div', { class: 'smcal-bar' }, dz, fill, h('div', { class: 'smcal-mid' })), val,
      h('label', { class: 'smcal-g', title: 'Empfindlichkeit dieser Achse' }, gain), h('label', { class: 'smcal-i', title: 'Richtung umkehren' }, inv, 'umk.')), fill, dz, val, gain, inv };
  });
  const dzIn = h('input', { type: 'range', min: 0, max: 0.3, step: 0.005, value: st().smDeadzone ?? 0.04 });
  const dzVal = h('b', null, '');
  dzIn.oninput = () => { save({ smDeadzone: +dzIn.value }); };
  const moveView = h('input', { type: 'checkbox', onchange: e => (spaceMouse.paused = !e.target.checked) });
  const info2 = h('p', { class: 'hint smcal-msg' }, 'Kappe loslassen und „Nullpunkt kalibrieren“ wählen. Danach jede Richtung ausprobieren: der Balken soll sich bewegen, in Ruhe in der grauen Totzone bleiben.');
  // rest position: average over 2.5 s without touching the cap; the noise suggests the dead zone
  const calibrateZero = () => {
    if (!spaceMouse.connected) return status('Keine SpaceMouse verbunden.');
    const samples = [];
    phase = { kind: 'zero', until: performance.now() + 2500, samples };
    info2.textContent = 'Nicht berühren … Nullpunkt wird gemessen (2,5 s).';
  };
  // full deflection: push / tilt every direction as far as it goes within 10 s
  const calibrateRange = () => {
    if (!spaceMouse.connected) return status('Keine SpaceMouse verbunden.');
    phase = { kind: 'range', until: performance.now() + 10000, max: Array(6).fill(0) };
    info2.textContent = 'Jetzt jede Richtung einmal bis zum Anschlag: schieben, ziehen, drücken, kippen, drehen (10 s) …';
  };
  const loop = () => {
    if (!open) return;
    const raw = [...spaceMouse.t, ...spaceMouse.r];
    const cal = spaceMouse.calibrated(), dzv = +(st().smDeadzone ?? 0.04);
    dzVal.textContent = dzv.toFixed(3);
    head.replaceChildren(spaceMouse.connected ? h('span', { class: 'smcal-ok' }, `Verbunden: ${spaceMouse.name}`) : h('span', null, spaceMouse.supported ? 'Nicht verbunden' : 'WebHID nicht verfügbar (Chrome, Edge oder Desktop-App)'),
      spaceMouse.supported ? h('button', { class: 'btn', onclick: async () => { try { if (spaceMouse.connected) await spaceMouse.disconnect(); else await spaceMouse.request(); } catch (err) { status(err.message); } } }, spaceMouse.connected ? 'Trennen' : 'Verbinden …') : null);
    rows.forEach((r, i) => {
      const v = Math.max(-1, Math.min(1, cal[i]));
      r.fill.style.left = `${50 + Math.min(0, v) * 50}%`;
      r.fill.style.width = `${Math.abs(v) * 50}%`;
      r.fill.classList.toggle('in-dz', Math.abs(cal[i]) < dzv);
      r.dz.style.left = `${50 - dzv * 50}%`;
      r.dz.style.width = `${dzv * 100}%`;
      r.val.textContent = cal[i].toFixed(2);
    });
    if (phase && spaceMouse.connected) {
      const now = performance.now();
      if (phase.kind === 'zero') phase.samples.push(raw);
      if (phase.kind === 'range') raw.forEach((x, i) => { const off = +(st().smOffsets || [])[i] || 0; phase.max[i] = Math.max(phase.max[i], Math.abs(x - off)); });
      if (now >= phase.until) {
        if (phase.kind === 'zero' && phase.samples.length) {
          const n = phase.samples.length, mean = Array(6).fill(0).map((_, i) => phase.samples.reduce((a, q) => a + q[i], 0) / n);
          const noise = Math.max(...Array(6).fill(0).map((_, i) => Math.max(...phase.samples.map(q => Math.abs(q[i] - mean[i])))));
          const dzNew = +Math.min(0.3, Math.max(0.02, noise * 1.6 + 0.01)).toFixed(3);
          save({ smOffsets: mean.map(v => +v.toFixed(4)), smDeadzone: dzNew });
          dzIn.value = dzNew;
          info2.textContent = `Nullpunkt gespeichert (Rauschen ±${noise.toFixed(3)} → Totzone ${dzNew}). Jetzt optional „Maximalausschlag messen“.`;
        } else if (phase.kind === 'range') {
          const g = phase.max.map((m, i) => (m > 0.15 ? +Math.min(3, Math.max(0.5, 1 / m)).toFixed(3) : arr('smGain', [1, 1, 1, 1, 1, 1])[i]));
          save({ smGain: g });
          rows.forEach((r, i) => (r.gain.value = g[i]));
          const weak = phase.max.map((m, i) => (m <= 0.15 ? SM_AXES[i][0] : null)).filter(Boolean);
          info2.textContent = `Empfindlichkeit je Achse angepasst, voller Ausschlag = 1.${weak.length ? ` Nicht bewegt: ${weak.join(', ')} (unverändert).` : ''}`;
        }
        phase = null;
      } else info2.textContent = info2.textContent.replace(/\(\d+(,\d)? s\)/, `(${((phase.until - now) / 1000).toFixed(1).replace('.', ',')} s)`);
    }
    requestAnimationFrame(loop);
  };
  body.append(head,
    h('div', { class: 'smcal-rows' }, h('div', { class: 'smcal-row smcal-hdr' }, h('b', null, ''), h('span', null, 'Achse'), h('span', null, 'Ausschlag'), h('span', null, 'Wert'), h('span', null, 'Faktor'), h('span', null, '')), ...rows.map(r => r.el)),
    h('div', { class: 'smcal-dzrow' }, h('label', null, 'Totzone (Ruhebereich)'), dzIn, dzVal),
    h('label', { class: 'smcal-move' }, moveView, ' Ansicht während der Kalibrierung mitbewegen (Test)'),
    info2);
  back.append(h('div', { class: 'modal smcal' },
    h('div', { class: 'modal-head' }, 'SPACEMOUSE KALIBRIEREN', h('button', { onclick: close }, '✕')),
    body,
    h('div', { class: 'modal-foot' },
      btn('Nullpunkt kalibrieren', calibrateZero, 'primary'), btn('Maximalausschlag messen', calibrateRange),
      btn('Zurücksetzen', () => { save({ smOffsets: [0, 0, 0, 0, 0, 0], smGain: [1, 1, 1, 1, 1, 1], smInv: Array(6).fill(false), smDeadzone: 0.04 }); rows.forEach(r => { r.gain.value = 1; r.inv.checked = false; }); dzIn.value = 0.04; info2.textContent = 'Kalibrierung zurückgesetzt.'; }),
      h('span', { style: 'flex:1' }), btn('Fertig', close))));
  back.addEventListener('keydown', e => { if (e.key === 'Escape') close(); });
  document.body.append(back);
  requestAnimationFrame(loop);
}

// ---------- marking menu (right click without dragging) ----------
let rDown = null;
$('#viewport').addEventListener('pointerdown', e => { if (e.button === 2) rDown = { x: e.clientX, y: e.clientY, t: performance.now() }; });
$('#viewport').addEventListener('contextmenu', e => e.preventDefault());
$('#viewport').addEventListener('pointerup', e => {
  if (e.button !== 2 || !rDown) return;
  const moved = Math.hypot(e.clientX - rDown.x, e.clientY - rDown.y);
  rDown = null;
  if (moved < 5) openMarkingMenu(e.clientX, e.clientY);
});

function closeMarkingMenu() { document.querySelector('.mm')?.remove(); document.removeEventListener('pointerdown', mmOutside, true); }
function mmOutside(e) { if (!e.target.closest('.mm')) closeMarkingMenu(); }
function markingItems() {
  const I = (icon, label, fn) => ({ icon, label, fn });
  if (state.sketchId) {
    const T = (icon, label, tool) => I(icon, label, () => { sketcher.setTool(tool); renderAll(); });
    return {
      ring: [T('line', 'Linie', 'line'), T('rect', 'Rechteck', 'rect'), T('circle', 'Kreis', 'circle'), I('finish', 'Skizze fertig', finishSketch),
        T('select', 'Auswahl', 'select'), I('offset', 'Versatz', sketchOffset), T('trim', 'Stutzen', 'trim'), I('fillet', 'Abrunden', sketchFillet), I('edgechamfer', 'Fase', sketchChamfer)],
      list: [I('params', 'Bemaßung', addDimension), I('line', 'Normal/Konstruktion (X)', () => { if (!sketcher.toggleConstruction()) status('Zuerst Skizzengeometrie auswählen.'); }), I('sketchMirror', 'Spiegeln', sketchMirror), I('fit', 'Einpassen', fitView)],
    };
  }
  if (state.workspace === 'cam') {
    const A = (icon, label, type) => I(icon, label, () => addOp(type));
    const turn = activeSetupKind() === 'turn';
    return {
      ring: turn
        ? [A('face', 'Plandrehen', 'tface'), A('rough3d', 'Schruppen', 'trough'), A('contour', 'Schlichten', 'tfinish'), I('sim', 'Simulieren', openSim), A('thread', 'Gewinde', 'tthread'), I('post', 'NC-Programm', () => select('post')), A('pocket', 'Einstechen', 'tgroove'), I('fit', 'Einpassen', fitView)]
        : [A('contour', '2D-Kontur', 'contour'), A('pocket', '2D-Tasche', 'pocket'), A('drill', 'Bohren', 'drill'), I('sim', 'Simulieren', openSim), A('rough3d', '3D-Räumen', 'rough3d'), I('post', 'NC-Programm', () => select('post')), A('face', 'Planfräsen', 'face'), I('fit', 'Einpassen', fitView)],
      list: [I('tools', 'Werkzeugbibliothek', openToolLibrary), I('sheet', 'Einrichteblatt', openSetupSheet), I('setup', 'Neues Setup', addSetup)],
    };
  }
  const C = (icon, label, type, extra) => I(icon, label, () => createFeature(type, extra));
  const selFeat = state.sel?.kind === 'feature' ? feature(state.sel.id) : null;
  return {
    ring: [I('sketch', 'Skizze', startPickPlane), C('extrude', 'Extrusion', 'extrude'), C('fillet', 'Verrundung', 'fillet'), C('hole', 'Bohrung', 'hole'),
      selFeat ? I('rollback', 'Löschen', () => deleteFeature(selFeat.id)) : I('measure', 'Messen', toggleMeasure), C('move', 'Verschieben', 'move'), I('fit', 'Einpassen', fitView), C('edgechamfer', 'Fase', 'chamfer')],
    list: [I('presspull', 'Drücken/Ziehen (Q)', startPressPull), I('appearance', 'Darstellung (A)', openAppearance), C('revolve', 'Rotation', 'revolve'), C('shell', 'Schale', 'shell'), C('thread', 'Gewinde', 'thread'), I('section', 'Schnittansicht', toggleSection), I('gear', 'Einstellungen', openSettings)],
  };
}
function openMarkingMenu(x, y) {
  closeMarkingMenu();
  const { ring, list } = markingItems();
  if (lastCmd) list.unshift({ icon: lastCmd.icon, label: `Wiederholen: ${lastCmd.label}`, fn: lastCmd.fn });
  const R = 105;
  const run = fn => () => { closeMarkingMenu(); fn(); };
  const mm = h('div', { class: 'mm' }, h('div', { class: 'mm-center', onclick: closeMarkingMenu }));
  //: N, NE, E, SE, S, SW, W, NW
  ring.slice(0, 8).forEach((it, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 4;
    const b = h('button', { class: 'mm-item', html: (ICONS[it.icon] || '') + `<span>${it.label}</span>`, onclick: run(it.fn) });
    b.style.left = `${Math.cos(a) * R * 1.25}px`;
    b.style.top = `${Math.sin(a) * R}px`;
    mm.append(b);
  });
  if (list.length) mm.append(h('div', { class: 'mm-list' }, ...list.map(it => h('button', { onclick: run(it.fn) }, it.label))));
  mm.style.left = Math.max(170, Math.min(innerWidth - 170, x)) + 'px';
  mm.style.top = Math.max(120, Math.min(innerHeight - 260, y)) + 'px';
  document.body.append(mm);
  setTimeout(() => document.addEventListener('pointerdown', mmOutside, true));
}

// ---------- command search (S) ----------
function openCommandSearch() {
  document.querySelector('.cmds')?.remove();
  const input = h('input', { type: 'text', placeholder: 'Befehl suchen … (z. B. Bohrung, Kontur, Gewinde)' });
  const list = h('div', { class: 'cmds-list' });
  // commands pinned "An Verknüpfungen" (⋮ in the toolbar dropdowns)
  const pinned = tbShortcuts.map(id => allToolButtons.find(it => it.id === id)).filter(Boolean);
  const pins = pinned.length ? h('div', { class: 'cmds-pins' }, h('div', { class: 'cmds-pins-h' }, 'VERKNÜPFUNGEN'),
    h('div', { class: 'cmds-pins-row' }, ...pinned.map(it => h('button', { title: it.label + (tbKeys[it.id] ? ` (${tbKeys[it.id]})` : ''), html: ICONS[it.icon] || `<b>${it.label[0]}</b>`, onclick: () => run(it) })))) : null;
  const box = h('div', { class: 'cmds' }, input, pins, list);
  let hits = [], idx = 0;
  const close = () => { box.remove(); document.removeEventListener('pointerdown', outside, true); };
  const outside = e => { if (!box.contains(e.target)) close(); };
  const run = it => { close(); it.el.click(); };
  const draw = () => {
    const q = input.value.trim().toLowerCase();
    hits = allToolButtons.filter(it => !q || it.label.toLowerCase().includes(q) || it.title.toLowerCase().includes(q) || it.where.toLowerCase().includes(q)).slice(0, 40);
    idx = Math.min(idx, Math.max(0, hits.length - 1));
    if (pins) pins.style.display = q ? 'none' : '';
    list.replaceChildren(...hits.map((it, i) => h('button', { class: i === idx ? 'on' : '', html: `${ICONS[it.icon] || ''}<span>${it.label}</span>${tbKeys[it.id] ? `<kbd>${tbKeys[it.id]}</kbd>` : ''}<small>${it.where}</small>`, onclick: () => run(it) })));
  };
  input.oninput = () => { idx = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { idx = Math.min(hits.length - 1, idx + 1); draw(); e.preventDefault(); }
    else if (e.key === 'ArrowUp') { idx = Math.max(0, idx - 1); draw(); e.preventDefault(); }
    else if (e.key === 'Enter' && hits[idx]) run(hits[idx]);
    else if (e.key === 'Escape') close();
  };
  box.style.left = (innerWidth - 340) / 2 + 'px';
  box.style.top = '140px';
  document.body.append(box);
  draw();
  input.focus();
  setTimeout(() => document.addEventListener('pointerdown', outside, true));
}

// ---------- sketch: offset and mirror ----------
function selectedSketchEntities() {
  const rsk = resolved().features.find(f => f.id === state.sketchId);
  const ids = [...new Set([...sketcher.selection.map(refEntity), sketcher.selected].filter(Boolean))];
  return { rsk, ids, ents: ids.map(id => rsk.entities.find(e => e.id === id)).filter(Boolean) };
}

// "Versatz" as a click tool: with nothing selected the tool starts (hover shows the offset on the mouse's side,
// a click asks for the distance); with closed contours selected they are offset at once as before
async function sketchOffsetAt(id, sign) {
  const e = sketcher.entities.find(x => x.id === id);
  if (!e) return;
  const v = evalExpr(await askValue('Versatzabstand (mm):', String(sketcher.offsetVal)) || '', paramScope(state.project));
  if (!Number.isFinite(v) || !(Math.abs(v) > 0)) return;
  sketcher.offsetVal = Math.abs(v);
  const add = offsetEntities(e, sign * v, () => uid('e'));
  if (!add.length) return status('Versatz ergibt keine Kontur (zu weit nach innen).');
  commitSketch(state.sketchId, sk => { sk.entities.push(...add); });
  status(`Versatz ${String(Math.abs(v)).replace('.', ',')} mm erstellt – weitere Kontur anklicken oder Esc`);
}
async function sketchOffset() {
  const { ents } = selectedSketchEntities();
  const closed = ents.filter(e => e.type !== 'text' && (e.type !== 'poly' || e.closed));
  if (!closed.length) { sketcher.setTool('offset'); renderToolbar(); return status('Versatz: mit der Maus neben eine Kontur fahren – die Seite bestimmt die Richtung – und klicken. Esc beendet.'); }
  const d = evalExpr(await askValue('Versatzabstand (mm, positiv = nach außen, negativ = nach innen):', '2') || '', paramScope(state.project));
  if (!Number.isFinite(d) || !d) return;
  const CL = window.ClipperLib, S = 1000;
  commitSketch(state.sketchId, sk => {
    for (const e of closed) {
      if (e.type === 'circle') { if (+e.r + d > 0) sk.entities.push({ id: uid('e'), type: 'circle', cx: e.cx, cy: e.cy, r: +(+e.r + d).toFixed(4) }); continue; }
      for (const poly of entityPolys(e)) {
        const co = new CL.ClipperOffset(2, 0.25 * S);
        co.AddPath(poly.map(([x, y]) => ({ X: Math.round(x * S), Y: Math.round(y * S) })), CL.JoinType.jtMiter, CL.EndType.etClosedPolygon);
        const out = new CL.Paths();
        co.Execute(out, d * S);
        for (const path of out) {
          const pts = CL.Clipper.CleanPolygon(path, 0.002 * S).map(p => [+(p.X / S).toFixed(4), +(p.Y / S).toFixed(4)]);
          if (pts.length > 2) sk.entities.push({ id: uid('e'), type: 'poly', closed: true, pts });
        }
      }
    }
  });
  sketcher.selection = [];
  status(`Versatz ${d} mm erstellt`);
}

// Mirror and patterns as tools with a preview: the elements are chosen first, then the tool shows what it will
// make – the mirror image at the line under the mouse, the pattern with the mouse as spacing / centre.
function mirrorSketchEntities(items, axis) {
  const [A, B] = axis.pts.map(q => q.map(Number));
  const add = items.map(e => mirrorAbout(e, A, B)).filter(Boolean);
  commitSketch(state.sketchId, sk => { for (const e of add) sk.entities.push({ ...e, id: uid('e') }); });
  sketcher.selection = [];
  status(`${add.length} Element(e) gespiegelt`);
}
function sketchMirror() {
  const { ents } = selectedSketchEntities();
  if (!ents.length) return status('Spiegeln: zuerst die Elemente wählen (Umschalt für mehrere), dann „Spiegeln“ und die Spiegelachse anklicken.');
  // as before: a single line chosen last is the axis
  const axis = ents.length > 1 ? [...ents].reverse().find(e => e.type === 'poly' && e.pts.length === 2 && !e.curve) : null;
  if (axis && axis === ents[ents.length - 1]) return mirrorSketchEntities(ents.filter(e => e !== axis), axis);
  sketcher.xformIds = ents.map(e => e.id);
  sketcher.setTool('mirror');
  renderToolbar();
  status('Spiegeln: über die Spiegelachse fahren (Vorschau) und klicken. Esc beendet.');
}

// Move / copy, rotate and scale the chosen sketch elements by numbers ("Verschieben/Kopieren", "Drehen", "Skalieren")
const sketchXfVal = { dx: 10, dy: 0, copies: 0, ang: 90, factor: 2 };
// move / rotate with the mouse: the elements are chosen first, then two clicks show the way or the angle
function sketchMoveTool(tool) {
  const { ents } = selectedSketchEntities();
  if (!ents.length) return status((tool === 'xmove' ? 'Verschieben' : 'Drehen') + ': zuerst Skizzenelemente wählen (Auswahl, Umschalt für mehrere).');
  sketcher.xformIds = ents.map(e => e.id);
  sketcher.xbase = null;
  sketcher.setTool(tool);
  renderToolbar();
  status(tool === 'xmove' ? 'Verschieben: Ausgangspunkt anklicken, dann den Zielpunkt (Vorschau). Esc beendet.' : 'Drehen: Drehpunkt anklicken, dann den Winkel mit der Maus zeigen (Vorschau). Esc beendet.');
}
async function sketchTransform(kind, preset = null, given = null) {
  const ents = given || selectedSketchEntities().ents;
  if (!ents.length) return status({ move: 'Verschieben', rotate: 'Drehen', scale: 'Skalieren' }[kind] + ': zuerst Skizzenelemente wählen (Auswahl, Umschalt für mehrere).');
  const scope = paramScope(state.project), c = v => String(+(+v).toFixed(3)).replace('.', ',');
  const nums = t => String(t).split(/[;\s]+/).filter(x => x !== '').map(x => evalExpr(x.replace(/,/g, '.'), scope));
  // middle of the selection: the default pivot
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const e of ents) for (const [x, y] of e.type === 'poly' ? e.pts : e.type === 'text' ? [[e.x, e.y]] : entityPolys(e).flat()) { x0 = Math.min(x0, +x); y0 = Math.min(y0, +y); x1 = Math.max(x1, +x); y1 = Math.max(y1, +y); }
  const mid = preset?.c || [(x0 + x1) / 2, (y0 + y1) / 2], v = { ...sketchXfVal, ...(preset ? { dx: preset.dx ?? sketchXfVal.dx, dy: preset.dy ?? sketchXfVal.dy, ang: preset.ang ?? sketchXfVal.ang } : {}) };
  let make, copies = 0, what;
  if (kind === 'move') {
    const t = await askValue('Verschieben: Weg X; Weg Y (mm); Kopien (0 = verschieben, 1 oder mehr = kopieren)', `${c(v.dx)}; ${c(v.dy)}; ${v.copies}`);
    if (t == null) return;
    const [dx, dy = 0, n = 0] = nums(t);
    if (![dx, dy, n].every(Number.isFinite) || n < 0 || (!dx && !dy)) return status('Verschieben: einen Weg in X oder Y angeben.');
    Object.assign(sketchXfVal, { dx, dy, copies: Math.round(n) });
    copies = Math.round(n);
    make = (e, i) => translateEntity(e, dx * i, dy * i);
    what = copies ? `${copies}-mal kopiert` : 'verschoben';
  } else if (kind === 'rotate') {
    const t = await askValue('Drehen: Winkel (°, gegen den Uhrzeigersinn); Drehpunkt X; Drehpunkt Y; Kopien (0 = drehen)', `${c(v.ang)}; ${c(mid[0])}; ${c(mid[1])}; 0`);
    if (t == null) return;
    const [ang, px = mid[0], py = mid[1], n = 0] = nums(t);
    if (![ang, px, py, n].every(Number.isFinite) || !ang || n < 0) return status('Drehen: einen Winkel angeben.');
    sketchXfVal.ang = ang;
    copies = Math.round(n);
    make = (e, i) => rotateEntity(e, ang * i, [px, py]);
    what = copies ? `${copies}-mal gedreht kopiert` : `um ${c(ang)}° gedreht`;
  } else {
    const t = await askValue('Skalieren: Faktor; Fixpunkt X; Fixpunkt Y', `${c(v.factor)}; ${c(mid[0])}; ${c(mid[1])}`);
    if (t == null) return;
    const [k, px = mid[0], py = mid[1]] = nums(t);
    if (![k, px, py].every(Number.isFinite) || !(k > 0) || k === 1) return status('Skalieren: einen Faktor größer als 0 angeben (1 ändert nichts).');
    sketchXfVal.factor = k;
    make = e => scaleEntity(e, k, [px, py]);
    what = `mit Faktor ${c(k)} skaliert`;
  }
  const round = e => JSON.parse(JSON.stringify(e, (key, val) => (typeof val === 'number' ? +val.toFixed(6) : val)));
  commitSketch(state.sketchId, sk => {
    if (copies) { for (let i = 1; i <= copies; i++) for (const e of ents) sk.entities.push({ ...round(make(e, i)), id: uid('e') }); return; }
    // in place: the element keeps its id, so dimensions and constraints stay attached
    for (const e of ents) { const k = sk.entities.findIndex(x => x.id === e.id); if (k >= 0) sk.entities[k] = { ...round(make(e, 1)), id: e.id }; }
  });
  if (copies) sketcher.selection = [];
  status(`${ents.length} Element(e) ${what}${copies ? '' : ' – Maße und Abhängigkeiten an diesen Elementen können sie zurückziehen'}`);
}

// Sketch pattern ("Rechteckige Anordnung" / "Runde Anordnung" in a sketch).
function sketchPattern(kind) {
  const { ents } = selectedSketchEntities();
  if (!ents.length) return status('Muster: zuerst Skizzenelemente wählen (Auswahl, Umschalt für mehrere).');
  sketcher.xformIds = ents.map(e => e.id);
  sketcher.setTool(kind === 'rect' ? 'prect' : 'pcirc');
  renderToolbar();
  status(kind === 'rect' ? 'Rechteck-Muster: mit der Maus den Abstand der ersten Kopie zeigen (Vorschau) und klicken. Esc beendet.' : 'Kreis-Muster: den Mittelpunkt zeigen (Vorschau) und klicken. Esc beendet.');
}
// the click of the mirror / pattern tools
async function sketchXform(kind, data) {
  const ents = sketcher.xformIds.map(id => sketcher.entities.find(e => e.id === id)).filter(Boolean);
  if (!ents.length) return;
  const done = () => { sketcher.xformIds = []; sketcher.setTool('select'); renderToolbar(); };
  if (kind === 'xmove' || kind === 'xrot') {
    if (kind === 'xmove' ? data.dx || data.dy : data.ang) await sketchTransform(kind === 'xmove' ? 'move' : 'rotate', data, ents);
    return done();
  }
  if (kind === 'mirror') {
    const axis = sketcher.entities.find(e => e.id === data.axis);
    if (axis) mirrorSketchEntities(ents, axis);
    return done();
  }
  const scope = paramScope(state.project), pv = sketcher.patternVal, c = v => String(+(+v).toFixed(3)).replace('.', ',');
  const nums = txt => String(txt).split(/[;\s]+/).filter(x => x !== '').map(x => evalExpr(x.replace(/,/g, '.'), scope));
  const copies = [];
  if (kind === 'prect') {
    const txt = await askValue('Rechteck-Muster: Anzahl X; Abstand X; Anzahl Y; Abstand Y (mm) – bei Anzahl Y = 1 liegen die Kopien in Richtung des gezeigten Abstands', `${pv.nx}; ${c(data.dx)}; ${pv.ny}; ${c(data.dy)}`);
    if (txt == null) return;
    const [nx, dx, ny = 1, dy = 0] = nums(txt);
    if (![nx, dx, ny, dy].every(Number.isFinite) || !(nx >= 1) || !(ny >= 1) || nx * ny < 2) return status('Muster: mindestens zwei Stück und gültige Abstände angeben.');
    Object.assign(pv, { nx: Math.round(nx), ny: Math.round(ny) });
    for (let i = 0; i < pv.nx; i++) for (let j = 0; j < pv.ny; j++) if (i || j) copies.push(e => translateEntity(e, i * dx, pv.ny > 1 ? j * dy : i * dy));
  } else {
    const txt = await askValue('Kreis-Muster: Anzahl (mit Original); Gesamtwinkel (°)', `${pv.n}; ${c(pv.ang)}`);
    if (txt == null) return;
    const [n, ang = 360] = nums(txt);
    if (!(n >= 2) || !Number.isFinite(ang) || !ang) return status('Muster: mindestens zwei Stück und einen Winkel angeben.');
    Object.assign(pv, { n: Math.round(n), ang });
    const step = Math.abs(Math.abs(ang) - 360) < 1e-6 ? ang / pv.n : ang / (pv.n - 1);
    for (let i = 1; i < pv.n; i++) copies.push(e => rotateEntity(e, step * i, data.c));
  }
  commitSketch(state.sketchId, sk => { for (const mk of copies) for (const e of ents) sk.entities.push({ ...mk(e), id: uid('e') }); });
  sketcher.selection = [];
  status(`${copies.length * ents.length} Element(e) als Muster erzeugt`);
  done();
}

// ---------- designs: data panel, document tabs, versions (like common CAD/CAM) ----------
const TABS_KEY = 'openfab.tabs.v1';
let openTabs = (() => { try { return (JSON.parse(localStorage.getItem(TABS_KEY)) || []).filter(t => t && t.id); } catch { return []; } })();
const saveTabs = () => { try { localStorage.setItem(TABS_KEY, JSON.stringify(openTabs)); } catch { /* storage unavailable */ } };
const cleanSnap = new Map(); // docId -> project JSON at the last save/open (for the "unsaved" dot)
let dataOpen = false, dataFilter = '', versionsOf = null;

const docThumb = () => thumbnail(vp.renderer, vp.scene, vp.camera, isDark() ? '#2a323b' : '#e4e9ee');
function ensureDocId(p) { if (!p.docId) p.docId = uid('doc'); return p.docId; }
function addTab(p) {
  if (!p?.docId) return;
  const t = openTabs.find(x => x.id === p.docId);
  if (t) t.name = p.name; else openTabs.push({ id: p.docId, name: p.name });
  saveTabs();
}

// keep the open design in the data panel (debounced, no new version)
let storeTimer = 0;
onChange(reason => {
  if (!state.project?.docId) return;
  clearTimeout(storeTimer);
  storeTimer = setTimeout(() => storeCurrent(state.project).then(() => { if (dataOpen) renderDataPanel(); }).catch(() => {}), reason === 'load' ? 50 : 1200);
});
addEventListener('visibilitychange', () => { if (document.hidden && state.project?.docId) storeCurrent(state.project, docThumb()).catch(() => {}); });

async function openAsNewDoc(project) {
  if (state.project?.docId) await storeCurrent(state.project, docThumb()).catch(() => {});
  project.docId = uid('doc');
  closeModes();
  setProject(project);
  addTab(state.project);
  cleanSnap.set(state.project.docId, JSON.stringify(state.project));
  fitView();
  renderDocTabs();
}

function newDoc() { openAsNewDoc(freshProject()); }

async function switchDoc(id) {
  if (!id || id === state.project.docId) return;
  await storeCurrent(state.project, docThumb()).catch(() => {});
  const p = await loadCurrent(id);
  if (!p) { openTabs = openTabs.filter(t => t.id !== id); saveTabs(); renderDocTabs(); return status('Design nicht gefunden.'); }
  closeModes();
  p.docId = id;
  setProject(migrate(p));
  addTab(state.project);
  cleanSnap.set(id, JSON.stringify(state.project));
  fitView();
  renderDocTabs();
}

async function closeDoc(id) {
  const t = openTabs.find(x => x.id === id);
  if (id === state.project.docId) await storeCurrent(state.project, docThumb()).catch(() => {});
  openTabs = openTabs.filter(x => x.id !== id);
  saveTabs();
  if (id === state.project.docId) {
    if (openTabs.length) await switchDoc(openTabs[openTabs.length - 1].id); else newDoc();
  }
  renderDocTabs();
  if (t) status(`„${t.name}“ geschlossen – im Datenpanel weiterhin vorhanden`);
}

async function saveVersionCmd() {
  const note = await askValue('Versionsbeschreibung (optional)', '');
  if (note == null) return;
  ensureDocId(state.project);
  const v = await saveVersion(state.project, note.trim(), docThumb());
  cleanSnap.set(state.project.docId, JSON.stringify(state.project));
  addTab(state.project);
  renderDocTabs();
  if (dataOpen) renderDataPanel();
  status(`„${state.project.name}“ gespeichert – Version V${v}`);
}

async function saveAsCmd() {
  const name = await askValue('Name des neuen Designs', state.project.name + ' (Kopie)');
  if (!name?.trim()) return;
  const copy = JSON.parse(JSON.stringify(state.project));
  copy.name = name.trim();
  await openAsNewDoc(copy);
  await saveVersion(state.project, 'Gespeichert unter neuem Namen', docThumb());
  cleanSnap.set(state.project.docId, JSON.stringify(state.project));
  renderDocTabs();
  status(`Als „${copy.name}“ gespeichert`);
}

function renderDocTabs() {
  const wrap = $('#docTabs');
  if (!wrap || !state.project) return;
  addTab(state.project);
  const nameEl = $('#projectName');
  wrap.replaceChildren(...openTabs.map(t => {
    const active = t.id === state.project.docId;
    const dirty = active && cleanSnap.has(t.id) && cleanSnap.get(t.id) !== JSON.stringify(state.project);
    const tab = h('div', { class: 'doc-tab' + (active ? ' on' : ''), title: active ? 'Aktives Design (Name anklicken zum Umbenennen)' : t.name, onclick: () => switchDoc(t.id),
      onauxclick: e => { if (e.button === 1) closeDoc(t.id); } },
    h('span', { class: 'doc-dot' + (dirty ? ' dirty' : '') }),
    active ? nameEl : h('span', { class: 'doc-name' }, t.name),
    h('button', { class: 'doc-x', title: 'Schließen', onclick: e => { e.stopPropagation(); closeDoc(t.id); } }, '✕'));
    return tab;
  }), h('button', { class: 'doc-new', title: 'Neues Design (Strg+N)', onclick: newDoc }, '+'));
  nameEl.textContent = state.project.name;
}

function ago(ts) {
  const s = (Date.now() - ts) / 1000;
  if (s < 60) return 'gerade eben';
  if (s < 3600) return `vor ${Math.round(s / 60)} Min.`;
  if (s < 86400) return `vor ${Math.round(s / 3600)} Std.`;
  return new Date(ts).toLocaleDateString('de-DE');
}

async function toggleData(on = !dataOpen) {
  dataOpen = on;
  $('#dataBtn').classList.toggle('on', on);
  if (on && state.project?.docId) await storeCurrent(state.project, docThumb()).catch(() => {});
  renderDataPanel();
}

async function renderDataPanel() {
  const el = $('#dataPanel');
  el.hidden = !dataOpen;
  if (!dataOpen) return;
  let docs = [];
  try { docs = await listDocs(); } catch { /* IndexedDB unavailable */ }
  const q = dataFilter.toLowerCase();
  const search = h('input', { type: 'search', placeholder: 'Designs suchen', value: dataFilter, class: 'dp-search' });
  search.oninput = () => { dataFilter = search.value; renderDataPanel().then(() => { const s = $('#dataPanel .dp-search'); s?.focus(); s?.setSelectionRange(s.value.length, s.value.length); }); };
  const card = d => {
    const last = d.versions?.at(-1);
    const active = d.id === state.project.docId;
    const menu = e => { e.preventDefault(); e.stopPropagation(); ctxMenu(e.clientX, e.clientY, [
      { label: 'Öffnen', onclick: () => openTabFor(d.id) },
      { label: 'Umbenennen', onclick: async () => { const v = await askValue('Neuer Name', d.name); if (!v?.trim()) return; if (active) commit(p => (p.name = v.trim()), 'meta'); else await renameDoc(d.id, v.trim()); const t = openTabs.find(x => x.id === d.id); if (t) { t.name = v.trim(); saveTabs(); } renderDocTabs(); renderDataPanel(); } },
      { label: 'Duplizieren', onclick: async () => { const p = await loadCurrent(d.id); if (!p) return; p.docId = uid('doc'); p.name += ' (Kopie)'; await storeCurrent(p, d.thumb); renderDataPanel(); } },
      { label: `Versionen (${d.versions?.length || 0})`, disabled: !d.versions?.length, onclick: () => { versionsOf = versionsOf === d.id ? null : d.id; renderDataPanel(); } },
      { label: 'Exportieren (.ofab)', onclick: async () => { const p = await loadCurrent(d.id); if (p) download(`${(p.name || 'design').replace(/[^\w\-äöüÄÖÜß ]+/g, '_')}.ofab`, JSON.stringify(withBlobs(p), null, 1), 'application/json'); } },
      { sep: true },
      { label: 'Löschen', icon: '✕', danger: true, onclick: async () => {
        if (!confirm(`„${d.name}“ mit allen Versionen endgültig löschen?`)) return;
        await deleteDoc(d.id);
        if (openTabs.some(t => t.id === d.id)) { openTabs = openTabs.filter(t => t.id !== d.id); saveTabs(); if (active) { if (openTabs.length) await switchDoc(openTabs.at(-1).id); else newDoc(); } }
        renderDocTabs(); renderDataPanel();
      } },
    ], d.name); };
    const node = h('div', { class: 'dp-card' + (active ? ' on' : ''), onclick: () => openTabFor(d.id), oncontextmenu: menu, title: 'Klicken zum Öffnen · Rechtsklick für mehr' },
      d.thumb ? h('img', { class: 'dp-thumb', src: d.thumb, alt: '' }) : h('div', { class: 'dp-thumb dp-nothumb' }, '◆'),
      h('div', { class: 'dp-info' },
        h('div', { class: 'dp-name' }, d.name || 'Unbenannt'),
        h('div', { class: 'dp-meta' }, last ? h('span', { class: 'dp-v', title: 'Versionen anzeigen', onclick: e => { e.stopPropagation(); versionsOf = versionsOf === d.id ? null : d.id; renderDataPanel(); } }, `V${last.v}`) : h('span', { class: 'dp-v none', title: 'Noch nicht gespeichert (Strg+S)' }, 'V–'), ' ', ago(d.updated))),
      h('button', { class: 'dp-more', title: 'Mehr', onclick: menu }, '⋯'));
    if (versionsOf !== d.id || !d.versions?.length) return node;
    const list = h('div', { class: 'dp-versions' }, ...[...d.versions].reverse().map(v => h('div', { class: 'dp-ver' },
      h('b', null, `V${v.v}`), h('span', { class: 'dp-ver-txt' }, v.note || '–', h('small', null, new Date(v.date).toLocaleString('de-DE'))),
      h('button', { class: 'dp-btn', title: 'Diesen Stand als neue Version übernehmen', onclick: async e => {
        e.stopPropagation();
        if (!confirm(`Version V${v.v} wiederherstellen? Der aktuelle Stand bleibt als Version erhalten.`)) return;
        await openTabFor(d.id);
        await saveVersion(state.project, 'Stand vor Wiederherstellung', docThumb());
        const p = await loadVersion(d.id, v.v);
        if (!p) return status('Version nicht gefunden.');
        p.docId = d.id;
        setProject(migrate(p));
        await saveVersion(state.project, `Wiederhergestellt aus V${v.v}`, docThumb());
        cleanSnap.set(d.id, JSON.stringify(state.project));
        fitView(); renderDocTabs(); renderDataPanel();
        status(`Version V${v.v} wiederhergestellt`);
      } }, 'Wiederherstellen'))));
    return h('div', null, node, list);
  };
  el.replaceChildren(
    h('div', { class: 'dp-head' }, h('span', null, 'Datenpanel'), h('button', { class: 'dp-x', title: 'Schließen', onclick: () => toggleData(false) }, '✕')),
    h('div', { class: 'dp-bar' },
      h('button', { class: 'dp-btn primary', onclick: newDoc }, '+ Neues Design'),
      h('button', { class: 'dp-btn', onclick: () => $('#fileInput').click(), title: '.ofab-Datei von diesem Computer öffnen' }, 'Hochladen')),
    search,
    h('div', { class: 'dp-title' }, `Meine Designs · ${docs.length}`, h('small', null, 'auf diesem Computer')),
    h('div', { class: 'dp-list' }, ...docs.filter(d => !q || (d.name || '').toLowerCase().includes(q)).map(card),
      docs.length ? null : h('p', { class: 'hint', style: 'padding:10px' }, 'Noch keine Designs gespeichert.')),
  );
}
async function openTabFor(id) {
  if (id === state.project.docId) return;
  await switchDoc(id);
}

// ---------- comments ----------
function renderComments() {
  const list = $('#commentList');
  if (!list || !state.project) return;
  const cs = state.project.comments || [];
  list.replaceChildren(...(cs.length ? [...cs].reverse().map(c => h('div', { class: 'cm' },
    h('div', { class: 'cm-head' }, h('b', null, c.author || 'Ich'), h('small', null, new Date(c.date).toLocaleString('de-DE')),
      h('button', { class: 'cm-x', title: 'Löschen', onclick: () => commit(p => { p.comments = (p.comments || []).filter(x => x.id !== c.id); }, 'meta') }, '✕')),
    h('div', { class: 'cm-text' }, c.text))) : [h('p', { class: 'hint', style: 'padding:6px 10px' }, 'Noch keine Kommentare. Mit + Notizen zum Design festhalten.')]));
  const head = document.querySelector('#winComments .fw-title');
  if (head) head.textContent = `KOMMENTARE${cs.length ? ` (${cs.length})` : ''}`;
}
$('#commentAdd').onclick = async () => {
  const text = await askValue('Kommentar', '');
  if (!text?.trim()) return;
  commit(p => { (p.comments ||= []).push({ id: uid('cm'), text: text.trim(), date: Date.now() }); }, 'meta');
  const w = wm.get('winComments');
  if (w?.s.collapsed) w.toggleCollapse();
};

$('#dataBtn').onclick = () => toggleData();
$('#saveBtn').onclick = () => saveVersionCmd();

// ---------- meshes (NETZ workspace) – edited as triangles, never converted to B-rep ----------
const MESH_OPS = { transform: 'Netz verschieben/drehen', cut: 'Ebenenschnitt', reduce: 'Reduzieren', smooth: 'Glätten', repair: 'Reparieren', flip: 'Normalen umkehren', split: 'Körper trennen' };
const MESH_UNITS = { mm: 1, cm: 10, m: 1000, in: 25.4 };
vp.meshes = new THREE.Group();
vp.scene.add(vp.meshes);
const matMesh = new THREE.MeshStandardMaterial({ color: 0xa9b8a0, metalness: 0.05, roughness: 0.7, flatShading: true, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 });
const matMeshSel = matMesh.clone(); matMeshSel.color.set(0x7fb4e8);
const matMeshWire = new THREE.LineBasicMaterial({ color: 0x2a3440, transparent: true, opacity: 0.25 });
const matOpenEdge = new THREE.LineBasicMaterial({ color: 0xe5484d, depthTest: false, transparent: true });

const meshStep = new Map(); // step cache: chain of mesh features -> resulting mesh bodies
let meshState = { key: null, bodies: [], errors: {} };

// all mesh bodies after replaying the mesh features of the timeline
function getMeshes() {
  const n = replayCount();
  const fs = resolved().features.slice(0, n ?? undefined).filter(f => f.type === 'meshimport' || f.type === 'meshop');
  const key = JSON.stringify(fs);
  if (key === meshState.key) return meshState;
  for (const b of meshState.bodies) b.geometry?.dispose();
  let bodies = new Map(); // id -> { id, name, mesh }
  const errors = {};
  let chain = '';
  for (const f of fs) {
    if (f.suppressed) continue;
    chain += JSON.stringify(f);
    if (meshStep.has(chain)) { bodies = new Map(meshStep.get(chain)); continue; }
    try {
      if (f.type === 'meshimport') {
        const text = getBlob(f.blob);
        if (!text) throw new Error('Netzdaten nicht geladen – Datei erneut einfügen');
        let m = decodeMesh(text);
        const k = MESH_UNITS[f.unit || 'mm'] || 1;
        const M = new THREE.Matrix4().makeScale(k, k, k);
        if (f.yUp) M.premultiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
        m = meshApply(m, M);
        const bb = meshBounds(m);
        const shift = new THREE.Vector3(+f.dx || 0, +f.dy || 0, +f.dz || 0);
        if (f.center) { const c = bb.getCenter(new THREE.Vector3()); shift.x -= c.x; shift.y -= c.y; }
        if (f.floor) shift.z -= bb.min.z;
        if (shift.lengthSq()) m = meshApply(m, new THREE.Matrix4().makeTranslation(shift.x, shift.y, shift.z));
        bodies.set(f.id, { id: f.id, name: f.name, mesh: m });
      } else {
        const t = bodies.get(f.target);
        if (!t) throw new Error('Netzkörper fehlt – Ziel wählen');
        let m = t.mesh;
        if (f.kind === 'transform') m = meshTransform(m, f);
        else if (f.kind === 'flip') m = meshFlip(m);
        else if (f.kind === 'repair') m = meshRepair(m, { tol: f.tol, holes: f.holes !== false, orientation: f.orient !== false });
        else if (f.kind === 'smooth') m = meshSmooth(m, +f.iterations || 3, +f.strength || 0.5);
        else if (f.kind === 'reduce') m = meshDecimate(m, (+f.percent || 50) / 100);
        else if (f.kind === 'cut') {
          const r = meshCut(m, f.axis || 'z', +f.offset || 0, f.keep || 'pos', f.cap !== false);
          if (Array.isArray(r)) {
            bodies.delete(t.id);
            r.forEach((mm, i) => { if (mm.idx.length) bodies.set(`${t.id}~${f.id}${i}`, { id: `${t.id}~${f.id}${i}`, name: `${t.name} ${i ? 'unten' : 'oben'}`, mesh: mm }); });
            meshStep.set(chain, [...bodies]);
            continue;
          }
          m = r;
        } else if (f.kind === 'split') {
          const parts = meshSplit(m);
          bodies.delete(t.id);
          parts.forEach((mm, i) => bodies.set(i ? `${t.id}~${f.id}${i}` : t.id, { id: i ? `${t.id}~${f.id}${i}` : t.id, name: i ? `${t.name} (${i + 1})` : t.name, mesh: mm }));
          meshStep.set(chain, [...bodies]);
          continue;
        }
        if (!m.idx.length) throw new Error('Ergebnis ist leer');
        bodies.set(t.id, { ...t, mesh: m });
      }
    } catch (err) { errors[f.id] = err.message || String(err); }
    meshStep.set(chain, [...bodies]);
  }
  if (meshStep.size > 80) [...meshStep.keys()].slice(0, meshStep.size - 80).forEach(k => meshStep.delete(k));
  const list = [...bodies.values()].map(b => ({ ...b, name: bodyMeta(b.id).name || b.name, geometry: meshToGeometry(b.mesh) }));
  meshState = { key, bodies: list, errors };
  return meshState;
}
const allErrors = () => ({ ...getModel().errors, ...getMeshes().errors });
const meshBox = () => { const b = new THREE.Box3(); for (const mb of getMeshes().bodies) if (!state.hiddenBodies.has(mb.id)) b.union(mb.geometry.boundingBox); return b; };

async function importMesh(file) {
  const busy = $('#loading');
  try {
    busy && (busy.hidden = false, $('#loadingText').textContent = 'Netz wird gelesen …');
    const ext = file.name.toLowerCase().split('.').pop();
    const tri = ext === 'obj' ? parseOBJ(await file.text()) : parseSTL(await file.arrayBuffer());
    const m = meshWeld(tri, 1e-4);
    const blob = await putBlob(encodeMesh(m));
    const id = uid('nm');
    const bb = meshBounds(m);
    commit(p => p.features.push({ id, type: 'meshimport', name: file.name.replace(/\.[^.]+$/, ''), file: file.name, blob, unit: 'mm', yUp: false, center: false, floor: bb.min.z < -1e-6, dx: 0, dy: 0, dz: 0 }));
    select('feature', id);
    fitView();
    status(`„${file.name}“ eingefügt – ${(m.idx.length / 3).toLocaleString('de-DE')} Dreiecke, bleibt als Netz (kein B-Rep)`);
  } catch (err) {
    alert('Netz konnte nicht gelesen werden: ' + (err.message || err));
  } finally { if (busy) busy.hidden = true; }
}

function createMeshOp(kind, target) {
  if (state.sketchId) return;
  const ms = getMeshes().bodies;
  const t = target || (state.sel?.kind === 'mesh' ? state.sel.id : null) || ms[ms.length - 1]?.id;
  if (!t) return status('Zuerst ein Netz einfügen (STL oder OBJ).');
  const id = uid('mo');
  const box = ms.find(x => x.id === t)?.geometry.boundingBox;
  const defs = { transform: { dx: 0, dy: 0, dz: 0, rx: 0, ry: 0, rz: 0, scale: 1 }, cut: { axis: 'z', offset: box ? f2((box.min.z + box.max.z) / 2) : 0, keep: 'neg', cap: true },
    reduce: { percent: 50 }, smooth: { iterations: 3, strength: 0.5 }, repair: { tol: 0.001, holes: true, orient: true }, flip: {}, split: {} }[kind];
  pendingNew = { id, depth: undoDepth() };
  insertFeature({ id, type: 'meshop', kind, target: t, name: nextName(state.project.features, MESH_OPS[kind]), ...defs });
  state.sel = { kind: 'feature', id };
  renderAll();
}

const meshTargets = f => {
  // mesh bodies that exist before this feature
  const fs = state.project.features, i = fs.findIndex(x => x.id === f.id);
  const ids = new Set();
  for (const x of fs.slice(0, i)) if (x.type === 'meshimport') ids.add(x.id);
  const now = getMeshes().bodies.map(b => [b.id, b.name]);
  const opts = now.filter(([id]) => ids.has(id.split('~')[0]) || ids.has(id));
  if (!opts.some(([id]) => id === f.target)) opts.push([f.target, f.target]);
  return opts;
};

function meshStatsBlock(m) {
  const st = meshStats(m);
  const sz = st.box.getSize(new THREE.Vector3());
  return h('div', { class: 'stats' },
    h('span', null, 'Dreiecke'), h('b', null, st.tris.toLocaleString('de-DE')),
    h('span', null, 'Eckpunkte'), h('b', null, st.verts.toLocaleString('de-DE')),
    h('span', null, 'Abmessungen'), h('b', null, `${f2(sz.x)} × ${f2(sz.y)} × ${f2(sz.z)} mm`),
    h('span', null, 'Volumen'), h('b', null, st.closed ? `${f2(Math.abs(st.volume) / 1000)} cm³` : '– (nicht geschlossen)'),
    h('span', null, 'Oberfläche'), h('b', null, `${f2(st.area / 100)} cm²`),
    h('span', null, 'Teile'), h('b', null, st.shells),
    h('span', null, 'Zustand'), h('b', { style: st.closed ? 'color:var(--ok)' : 'color:var(--danger)' }, st.closed ? 'geschlossen (wasserdicht) ✓' : `${st.open} offene Kanten${st.nonManifold ? `, ${st.nonManifold} nicht-mannigfaltig` : ''}`));
}

function propsMeshImport(b, f, ed) {
  const mb = getMeshes().bodies.find(x => x.id === f.id);
  b.append(
    row('Datei', h('span', null, f.file || '–')),
    row('Einheit der Datei', sel(Object.keys(MESH_UNITS).map(k => [k, { mm: 'Millimeter', cm: 'Zentimeter', m: 'Meter', in: 'Zoll' }[k]]), f.unit || 'mm', v => ed(x => (x.unit = v)))),
    row('Y-oben → Z-oben', chk(f.yUp, v => ed(x => (x.yUp = v)))),
    row('In XY zentrieren', chk(f.center, v => ed(x => (x.center = v)))),
    row('Auf Boden (Z = 0)', chk(f.floor, v => ed(x => (x.floor = v)))),
    sec('VERSCHIEBUNG'),
    ...['dx', 'dy', 'dz'].map(k => row(k.slice(1).toUpperCase(), num(f[k] || 0, v => ed(x => (x[k] = v)), { unit: 'mm' }))),
    sec('NETZ'),
    mb ? meshStatsBlock(mb.mesh) : null,
    h('p', { class: 'hint' }, 'Das Netz bleibt ein Dreiecksnetz (kein B-Rep). Bearbeiten unter NETZ: Reparieren, Reduzieren, Glätten, Ebenenschnitt … 3D-Frässtrategien in der Fertigung können es direkt bearbeiten.'));
}

function propsMeshOp(b, f, ed) {
  setTitle(MESH_OPS[f.kind].toUpperCase());
  const N = (label, key, opt = {}) => row(label, num(f[key], v => ed(x => (x[key] = v)), { unit: 'mm', ...opt }));
  b.append(row('Netzkörper', sel(meshTargets(f), f.target, v => ed(x => (x.target = v)))));
  if (f.kind === 'transform') b.append(sec('VERSCHIEBEN'), N('X', 'dx'), N('Y', 'dy'), N('Z', 'dz'), sec('DREHEN (UM DIE MITTE)'), N('Um X', 'rx', { unit: '°' }), N('Um Y', 'ry', { unit: '°' }), N('Um Z', 'rz', { unit: '°' }), sec('SKALIEREN'), N('Faktor', 'scale', { unit: null, min: 0.0001 }));
  if (f.kind === 'cut') b.append(row('Ebene senkrecht zu', sel([['x', 'X'], ['y', 'Y'], ['z', 'Z']], f.axis, v => ed(x => (x.axis = v)))), N('Lage', 'offset'),
    row('Behalten', sel([['neg', 'Unterhalb / Minusseite'], ['pos', 'Oberhalb / Plusseite'], ['both', 'Beide (in zwei Körper teilen)']], f.keep, v => ed(x => (x.keep = v)))),
    row('Schnitt schließen (Deckel)', chk(f.cap !== false, v => ed(x => (x.cap = v)))));
  if (f.kind === 'reduce') b.append(row('Behalten', num(f.percent, v => ed(x => (x.percent = v)), { unit: '% der Dreiecke', min: 1 })), h('p', { class: 'hint' }, 'Reduziert die Dreiecke durch Zusammenfassen benachbarter Punkte – kleinere Dateien, schnellere Bahnberechnung.'));
  if (f.kind === 'smooth') b.append(row('Durchgänge', num(f.iterations, v => ed(x => (x.iterations = v)), { unit: null, min: 1, int: true })), row('Stärke', num(f.strength, v => ed(x => (x.strength = v)), { unit: null, min: 0.05 })),
    h('p', { class: 'hint' }, 'Glättet stufige Scans und 3D-Druck-Netze ohne zu schrumpfen; offene Ränder bleiben stehen.'));
  if (f.kind === 'repair') b.append(N('Verschweißtoleranz', 'tol', { min: 0 }), row('Löcher schließen', chk(f.holes !== false, v => ed(x => (x.holes = v)))), row('Ausrichtung korrigieren', chk(f.orient !== false, v => ed(x => (x.orient = v)))),
    h('p', { class: 'hint' }, 'Verbindet doppelte Punkte, entfernt entartete und doppelte Dreiecke, dreht falsch herum liegende Dreiecke und schließt Löcher.'));
  if (f.kind === 'split') b.append(h('p', { class: 'hint' }, 'Nicht verbundene Teile des Netzes werden zu eigenen Netzkörpern.'));
  if (f.kind === 'flip') b.append(h('p', { class: 'hint' }, 'Dreht die Richtung aller Dreiecke um (innen ↔ außen).'));
  const res = getMeshes().bodies.filter(x => x.id === f.target || x.id.startsWith(f.target + '~' + f.id));
  if (res.length) b.append(sec('ERGEBNIS'), ...res.map(r => meshStatsBlock(r.mesh)));
}

function propsMeshBody(b, mb) {
  setTitle('NETZKÖRPER');
  b.append(row('Name', txt(mb.name, v => commit(p => { p.bodyMeta ||= {}; (p.bodyMeta[mb.id] ||= {}).name = v; }, 'meta'))), meshStatsBlock(mb.mesh),
    h('div', { class: 'btns' },
      ...['repair', 'reduce', 'smooth', 'cut', 'transform', 'flip', 'split'].map(k => btn(MESH_OPS[k], () => createMeshOp(k, mb.id), k === 'repair' ? 'primary' : '')),
      btn('Als STL exportieren', () => exportMeshSTL([mb]))));
  if (!meshStats(mb.mesh).closed) b.append(h('p', { class: 'hint' }, 'Offene Kanten werden rot angezeigt. „Reparieren“ schließt Löcher.'));
}

function exportMeshSTL(list) {
  const grp = new THREE.Group();
  list.forEach(x => grp.add(new THREE.Mesh(x.geometry)));
  download(`${list.length === 1 ? list[0].name : safeName()}.stl`, new STLExporter().parse(grp, { binary: true }), 'model/stl');
}

function drawMeshes() {
  vp.clear(vp.meshes);
  const cam = state.workspace === 'cam';
  const ghost = cam && sim.open && !$('#simModel').checked;
  for (const mb of getMeshes().bodies) {
    if (state.hiddenBodies.has(mb.id)) continue;
    const selected = state.sel?.kind === 'mesh' && state.sel.id === mb.id;
    const st = cam ? state.project.cam.setups.find(x => x.id === activeSetupId()) : null;
    let mat = ghost ? matGhost : display === 'wire' ? matWire : selected ? matMeshSel : matMesh;
    if (st?.fixtures?.includes(mb.id)) mat = bodyMaterial(mb.id);
    const mesh = new THREE.Mesh(mb.geometry, mat);
    mesh.userData = { meshBody: mb.id, cached: true };
    vp.meshes.add(mesh);
    // triangle edges when selected (mesh display), open edges in red
    if (selected && mb.mesh.idx.length < 600000) {
      const w = new THREE.LineSegments(new THREE.WireframeGeometry(mb.geometry), matMeshWire);
      vp.meshes.add(w);
    }
    if (selected || state.workspace === 'design') {
      const oe = meshOpenEdges(mb.mesh);
      if (oe.length && (selected || oe.length < 60000)) {
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(oe, 3));
        const l = new THREE.LineSegments(g, matOpenEdge);
        l.renderOrder = 9;
        vp.meshes.add(l);
      }
    }
  }
}

// click a mesh in the canvas selects it
vp.canvas.addEventListener('pointerup', e => {
  if (!downAt || state.pick || state.sketchId || e.button !== 0) return;
  if (Math.hypot(e.clientX - downAt[0], e.clientY - downAt[1]) >= 5) return;
  const hit = vp.raycast(e, vp.meshes.children.filter(o => o.isMesh))[0];
  const bhit = vp.raycast(e, vp.model.children.filter(o => o.isMesh))[0];
  if (hit && (!bhit || hit.distance < bhit.distance)) select('mesh', hit.object.userData.meshBody);
});

// ---------- Postprozess dialog (settings + operations, post properties) ----------
let outDir = null; // FileSystemDirectoryHandle chosen as output folder
const fsDb = () => new Promise((res, rej) => { const r = indexedDB.open('openfab.fs', 1); r.onupgradeneeded = () => r.result.createObjectStore('h'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
(async () => { try { const d = await fsDb(); const q = d.transaction('h').objectStore('h').get('out'); q.onsuccess = () => { outDir = q.result || null; }; } catch { /* no IndexedDB */ } })();
async function rememberDir(hd) { outDir = hd; try { const d = await fsDb(); d.transaction('h', 'readwrite').objectStore('h').put(hd, 'out'); } catch { /* ignore */ } }

async function writeOutput(name, code) {
  if (outDir) {
    try {
      if ((await outDir.queryPermission?.({ mode: 'readwrite' })) !== 'granted' && (await outDir.requestPermission?.({ mode: 'readwrite' })) !== 'granted') throw new Error('kein Schreibrecht');
      const fh = await outDir.getFileHandle(name, { create: true });
      const w = await fh.createWritable();
      await w.write(code);
      await w.close();
      return `gespeichert in „${outDir.name}“`;
    } catch (err) { console.warn('Ordner nicht beschreibbar, Download stattdessen', err); }
  }
  download(name, code, 'text/plain');
  return 'heruntergeladen';
}

// ----- NC-Editor with backplot (NC program preview) -----
// Lines with colours and numbers; clicking a line (or moving the slider) shows where the tool is at that line
// in the 3D view and draws the path travelled so far.
function parseNcPositions(code, heidenhain, toolRad = null) {
  const pos = { x: 0, y: 0, z: 0 }, seen = new Set();
  let mode = 0, tool = null, known = false, cyc = null, cc = null, tch = null, aPos = null;
  let hhDir = null, hhSide = 'L', hhCyc = null, sinCyc = null; // + the last CYCL DEF 2xx with its Q parameters // Heidenhain: direction at the end of the last move, side of the radius compensation
  const out = [];
  // Heidenhain touch probe cycles 410–413 and 417: the moves the control makes on its own (pre-positioning at
  // the safe height Q260, protected moves to the safety distance Q320, measuring moves that end at the first
  // contact, back to the safe height). Returned as one point carrying the whole sequence.
  const tchMoves = c => {
    const q = c.q, R = toolRad ? toolRad(tool) || 0 : 0, sd = q[320] ?? 2, zs = q[260] ?? pos.z;
    const seq = [];
    let cur = { ...pos };
    const mv = (x, y, z, probe = 'move') => { cur = { x, y, z }; seq.push({ x, y, z, probe }); };
    mv(cur.x, cur.y, Math.max(cur.z, zs));
    if (c.n === 417) {
      const x = q[263], y = q[264], z = q[294];
      if (x == null || y == null || z == null) return null;
      mv(x, y, cur.z); mv(x, y, z + sd); mv(x, y, z - sd, 'measure'); mv(x, y, zs);
    } else if (c.n >= 410 && c.n <= 413) {
      const cx = q[321], cy = q[322], hm = q[261];
      if (cx == null || cy == null || hm == null) return null;
      let dirs;
      if (c.n >= 412) {
        const r = (q[262] || 0) / 2, n = Math.max(3, Math.round(q[423] || 4)), a0 = ((q[325] || 0) * Math.PI) / 180, st = ((q[247] || 360 / n) * Math.PI) / 180;
        dirs = Array.from({ length: n }, (_, i) => [Math.cos(a0 + i * st), Math.sin(a0 + i * st), r]);
      } else {
        const w = (q[323] || 0) / 2, l = (q[324] || 0) / 2;
        dirs = [[1, 0, w], [-1, 0, w], [0, 1, l], [0, -1, l]];
      }
      if (c.n === 410 || c.n === 412) {
        // inside: down in the middle, then out towards each wall
        mv(cx, cy, cur.z); mv(cx, cy, hm);
        for (const [dx, dy, r] of dirs) {
          const a = Math.max(0, r - sd - R);
          mv(cx + dx * a, cy + dy * a, hm); mv(cx + dx * (r + sd), cy + dy * (r + sd), hm, 'measure'); mv(cx, cy, hm);
        }
        mv(cx, cy, zs);
      } else {
        // outside: each point from outside, over the safe height in between (Q301 = 1)
        for (const [dx, dy, r] of dirs) {
          const a = r + sd + R, b = Math.max(0, r - sd);
          mv(cx + dx * a, cy + dy * a, zs); mv(cx + dx * a, cy + dy * a, hm); mv(cx + dx * b, cy + dy * b, hm, 'measure');
          mv(cx + dx * a, cy + dy * a, hm); mv(cx + dx * a, cy + dy * a, zs);
        }
      }
    } else return null;
    const last = seq[seq.length - 1];
    Object.assign(pos, { x: last.x, y: last.y, z: last.z });
    for (const a of 'XYZ') seen.add(a);
    const pt = { ...last, rapid: false, tool, first: !known, seq, arc: seq.slice(0, -1) };
    known = true;
    return pt;
  };
  const num = (up, k) => { const m = up.match(new RegExp('(?:^|[^A-Z])' + k + '\\s*([+-]?\\d*\\.?\\d+)')); return m ? +m[1] : null; };
  // points along a circular arc (XY plane) from a to b around centre c; cw = clockwise
  const arcPts = (a, b, c, cw) => {
    const r = Math.hypot(a.x - c[0], a.y - c[1]);
    if (!(r > 1e-6)) return null;
    const a0 = Math.atan2(a.y - c[1], a.x - c[0]), a1 = Math.atan2(b.y - c[1], b.x - c[0]);
    let sw = a1 - a0;
    if (cw && sw >= -1e-9) sw -= Math.PI * 2;
    if (!cw && sw <= 1e-9) sw += Math.PI * 2;
    const n = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 24)));
    const res = [];
    for (let k = 1; k < n; k++) { const t = k / n, an = a0 + sw * t; res.push({ x: c[0] + r * Math.cos(an), y: c[1] + r * Math.sin(an), z: a.z + (b.z - a.z) * t }); }
    return res;
  };
  // controls without tool numbers (GRBL, manual change): the operation comment "(T1 Schaftfraeser …)" names the tool
  const noTWords = !heidenhain && !/(?:^|\s|N\d+\s*)T\s*\d+/m.test(code.replace(/\([^)]*\)/g, '').replace(/;.*$/gm, '').toUpperCase());
  for (const raw of code.split('\n')) {
    if (noTWords) { const cm = raw.match(/^\s*\(T(\d+)\s/); if (cm) tool = +cm[1]; }
    let s = raw.replace(/\([^)]*\)/g, '');
    if (heidenhain) s = s.replace(/;.*$/, ''); else s = s.replace(/;.*$/, '');
    const up = s.toUpperCase();
    const tm = up.match(/(?:^|\s|N\d+\s*)T\s*(\d+)/) || up.match(/TOOL CALL\s+(\d+)/);
    if (tm) tool = +tm[1];
    if (heidenhain) {
      // a probe cycle spans several lines (continued with ~); its Q parameters are collected up to the last one
      const tp = up.match(/TCH PROBE\s+(4\d\d)/);
      if (tp) tch = { n: +tp[1], q: {}, k: out.length };
      if (tch) {
        for (const m of up.matchAll(/Q(\d+)\s*=\s*([+-]?\d*\.?\d+)/g)) tch.q[+m[1]] = +m[2];
        if (!/~\s*$/.test(raw.trimEnd())) {
          // the cycle is shown and reported at its TCH PROBE line
          out[tch.k] = tchMoves(tch);
          tch = null;
          out.push(null);
          continue;
        }
        out.push(null);
        continue;
      }
    }
    if (heidenhain) {
      const cd = up.match(/CYCL DEF\s+(2\d\d)(?![\d.])/);
      // a pattern (220/221) keeps the machining cycle defined before it
      if (cd) hhCyc = { n: +cd[1], q: {}, open: true, prev: [220, 221].includes(+cd[1]) && hhCyc && !hhCyc.open ? (hhCyc.prev || hhCyc) : null };
      if (hhCyc?.open) {
        for (const m of up.matchAll(/Q(\d+)\s*=\s*([+-]?\d*\.?\d+)/g)) hhCyc.q[+m[1]] = +m[2];
        if (!/~\s*$/.test(raw.trimEnd())) {
          hhCyc.open = false;
          if ((hhCyc.n === 220 || hhCyc.n === 221) && hhCyc.prev) {
            const pat = hhCyc;
            hhCyc = pat.prev;
            const pt = patternMoves(patternPoints(pat), pat.prev, pat.q[203] ?? pat.prev.q[203] ?? 0, pat.q[204] ?? pat.prev.q[204] ?? 2, toolRad ? toolRad(tool) || 0 : 0);
            if (pt) { out.push({ ...pt, tool, first: !known }); known = true; Object.assign(pos, { x: pt.x, y: pt.y, z: pt.z }); for (const k of 'XYZ') seen.add(k); continue; }
          }
        }
        out.push(null);
        continue;
      }
    }
    let rapid = null;
    const before = { ...pos };
    let arcC = null, arcCw = false;
    if (heidenhain) {
      // CC: circle centre for the following C (arc) lines
      if (/^\s*\d*\s*CC\b/.test(up)) { cc = [num(up, 'X') ?? pos.x, num(up, 'Y') ?? pos.y]; out.push(null); continue; }
      // CP: polar arc around CC – helix with incremental angle IPA (or absolute PA) and Z (IZ / Z)
      if (/(?:^|\s)CP\s/.test(up)) {
        if (!cc || seen.size < 3) { out.push(null); continue; }
        const r = Math.hypot(pos.x - cc[0], pos.y - cc[1]), a0 = Math.atan2(pos.y - cc[1], pos.x - cc[0]);
        const ipa = num(up, 'IPA'), pa = num(up, 'PA'), iz = num(up, 'IZ'), z = num(up, 'Z');
        let sw = ipa != null ? (ipa * Math.PI) / 180 : null;
        if (sw == null && pa != null) {
          sw = (pa * Math.PI) / 180 - a0;
          if (/DR-/.test(up) && sw >= -1e-9) sw -= Math.PI * 2;
          if (!/DR-/.test(up) && sw <= 1e-9) sw += Math.PI * 2;
        }
        if (sw == null || !(r > 1e-6)) { out.push(null); continue; }
        const z0 = pos.z, z1 = iz != null ? z0 + iz : z != null ? z : z0;
        const n = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 24))), arc = [];
        for (let k = 1; k < n; k++) { const t = k / n, an = a0 + sw * t; arc.push({ x: cc[0] + r * Math.cos(an), y: cc[1] + r * Math.sin(an), z: z0 + (z1 - z0) * t }); }
        Object.assign(pos, { x: cc[0] + r * Math.cos(a0 + sw), y: cc[1] + r * Math.sin(a0 + sw), z: z1 });
        out.push({ x: pos.x, y: pos.y, z: pos.z, rapid: false, tool, first: !known, ...(known ? { arc } : {}) });
        known = true;
        continue;
      }
      if (/(?:^|\s)C\s/.test(up) && cc) { arcC = cc; arcCw = /DR-/.test(up); }
      if (/\bR([LR])\b/.test(up)) hhSide = up.match(/\bR([LR])\b/)[1];
      const dep = up.match(/\bDEP\s+(LN|LT|CT)\b/);
      if (dep && hhDir && seen.size === 3) {
        const len = num(up, 'LEN') ?? 0, rT = toolRad ? toolRad(tool) || 0 : 0, [tx, ty] = hhDir;
        const nx = hhSide === 'R' ? ty : -ty, ny = hhSide === 'R' ? -tx : tx; // away from the material
        const b0 = { ...pos };
        let arc = null;
        if (dep[1] === 'LN') Object.assign(pos, { x: pos.x + nx * (len + rT), y: pos.y + ny * (len + rT) });
        else if (dep[1] === 'LT') Object.assign(pos, { x: pos.x + tx * len, y: pos.y + ty * len });
        else {
          const R = Math.abs(num(up, 'R') ?? 0), cca = ((num(up, 'CCA') ?? 90) * Math.PI) / 180, c = [pos.x + nx * R, pos.y + ny * R];
          const s = hhSide === 'R' ? -1 : 1, a0 = Math.atan2(pos.y - c[1], pos.x - c[0]);
          arc = [];
          for (let q = 1; q < 12; q++) { const an = a0 + (s * cca * q) / 12; arc.push({ x: c[0] + R * Math.cos(an), y: c[1] + R * Math.sin(an), z: pos.z }); }
          Object.assign(pos, { x: c[0] + R * Math.cos(a0 + s * cca), y: c[1] + R * Math.sin(a0 + s * cca) });
        }
        out.push({ x: pos.x, y: pos.y, z: pos.z, rapid: false, tool, first: !known, ...(arc && known ? { arc } : {}) });
        hhDir = null;
        continue;
      }
      if (/\bL\b|^\s*\d+\s+L\s/.test(up)) rapid = /FMAX/.test(up);
      else if (/\bC\b|^\s*\d+\s+C\s/.test(up)) rapid = false;
    } else {
      for (const g of up.matchAll(/G0*([0-3])(?!\d)/g)) { mode = +g[1]; cyc = null; }
      // drilling cycles (G73–G89): the tool drills to Z, then goes back to the R plane (G99) or the start height (G98)
      const cm = up.match(/G(7[346]|8[1-9])(?!\d)/);
      if (cm) cyc = { ret: /G99/.test(up) ? 'r' : 'i', r: null, start: pos.z };
      if (/G80(?!\d)/.test(up)) cyc = null;
      rapid = mode === 0 && !cyc;
      // Sinumerik pocket cycles: POCKET3 (rectangle) / POCKET4 (circle) with the centre in the call
      const pk = raw.toUpperCase().match(/POCKET([34])\s*\(([^)]*)\)/);
      // Sinumerik drilling: MCALL CYCLE8x(RTP, RFP, SDIS, DP …) is called at every position until MCALL
      const RU = raw.toUpperCase();
      const mcl = RU.match(/MCALL\s+CYCLE8\d\s*\(([^)]*)\)/);
      if (mcl) { const a = mcl[1].split(',').map(v => (v.trim() === '' ? null : +v)); sinCyc = { n: 200, q: { 201: (a[3] ?? 0) - (a[1] ?? 0), 203: a[1] ?? 0, 204: (a[0] ?? 0) - (a[1] ?? 0) } }; out.push(null); continue; }
      if (/^\s*N?\d*\s*MCALL\s*$/.test(up)) { sinCyc = null; out.push(null); continue; }
      const sh = sinCyc && RU.match(/(HOLES2|CYCLE801)\s*\(([^)]*)\)/);
      if (sh) {
        const a = sh[2].split(',').map(v => (v.trim() === '' ? 0 : +v));
        const pp = sh[1] === 'HOLES2' ? patternPoints({ n: 220, q: { 216: a[0], 217: a[1], 244: 2 * a[2], 245: a[3], 246: a[3] + a[4] * (a[5] - 1), 241: a[5] } })
          : patternPoints({ n: 221, q: { 225: a[0], 226: a[1], 224: a[2], 237: a[3], 238: a[4], 242: a[5], 243: a[6] } });
        const pt = patternMoves(pp, sinCyc, sinCyc.q[203], sinCyc.q[204], toolRad ? toolRad(tool) || 0 : 0);
        if (pt) { out.push({ ...pt, tool, first: !known }); known = true; Object.assign(pos, { x: pt.x, y: pt.y, z: pt.z }); for (const k of 'XYZ') seen.add(k); continue; }
      }
      if (sinCyc && !/CYCLE|POCKET/.test(RU)) {
        let mv = false;
        for (const m of up.matchAll(/(?:^|[^A-Z])([XY])\s*([+-]?\d*\.?\d+)/g)) { pos[m[1].toLowerCase()] = +m[2]; seen.add(m[1]); mv = true; }
        if (mv) {
          const top = sinCyc.q[203], zr = top + sinCyc.q[204];
          out.push({ x: pos.x, y: pos.y, z: top + sinCyc.q[201], rapid: false, cycle: true, zr, tool, first: !known });
          known = true; pos.z = zr; seen.add('Z');
          continue;
        }
      }
      // spigots: CYCLE76 (rectangle) / CYCLE77 (circle), blank size AP1/AP2
      const sp = raw.toUpperCase().match(/CYCLE7([67])\s*\(([^)]*)\)/);
      if (sp) {
        const a = sp[2].split(',').map(v => (v.trim() === '' ? null : +v));
        const rT = toolRad ? toolRad(tool) || 0 : 0, rect = sp[1] === '6';
        const [RTP, RFP, SDIS, DP] = a;
        const q = rect
          ? { 218: a[5], 219: a[6], 220: a[7], 224: a[10] || 0, 202: a[11], 368: a[12] || 0, 424: a[18], 425: a[19] }
          : { 223: 2 * (a[5] || 0), 202: a[8], 368: a[9] || 0, 222: a[15] };
        Object.assign(q, { 201: DP - RFP, 200: SDIS ?? 1, 370: 0.8 });
        const at = rect ? { x: a[8], y: a[9] } : { x: a[6], y: a[7] };
        const pt = pos.z != null ? hhPocketMoves({ n: rect ? 256 : 257, q }, { ...pos, ...at }, RFP, RTP ?? pos.z, rT) : null;
        if (pt) { out.push({ ...pt, tool, first: !known }); known = true; Object.assign(pos, { x: pt.x, y: pt.y, z: pt.z }); for (const k of 'XYZ') seen.add(k); continue; }
      }
      if (pk) {
        const a = pk[2].split(',').map(v => (v.trim() === '' ? null : +v));
        const rT = toolRad ? toolRad(tool) || 0 : 0, rect = pk[1] === '3';
        const [RTP, RFP, SDIS, DP] = a;
        const q = rect
          ? { 218: a[4], 219: a[5], 220: a[6], 224: a[9] || 0, 202: a[10], 368: a[11] || 0, 370: rT > 0 && a[17] ? a[17] / rT : 1 }
          : { 223: 2 * (a[4] || 0), 202: a[7], 368: a[8] || 0, 370: rT > 0 && a[14] ? a[14] / rT : 1 };
        Object.assign(q, { 201: DP - RFP, 200: SDIS ?? 1 });
        const at = rect ? { x: a[7], y: a[8] } : { x: a[5], y: a[6] };
        const pt = pos.z != null ? hhPocketMoves({ n: rect ? 251 : 252, q }, { ...pos, ...at }, RFP, RTP ?? pos.z, rT) : null;
        if (pt) { out.push({ ...pt, tool, first: !known }); known = true; Object.assign(pos, { x: pt.x, y: pt.y, z: pt.z }); for (const k of 'XYZ') seen.add(k); continue; }
      }
      if ((mode === 2 || mode === 3) && !cyc) {
        const I = num(up, 'I'), J = num(up, 'J'), Rr = num(up, 'R');
        arcCw = mode === 2;
        if (I != null || J != null) arcC = [pos.x + (I || 0), pos.y + (J || 0)];
        else if (Rr != null) arcC = { r: Rr };
      }
    }
    // datum / cycle / stock definition lines carry coordinates but are no tool moves
    if (/G5[3-9]|G28|G30|G92|G10|CYCL|CYCLE|TRANS|DATUM|BLK FORM|TCH PROBE|^\s*\d*\s*Q\d+\s*=/.test(up)) { out.push(null); continue; }
    // touch probe macros (Renishaw): P9810 protected positioning, P9811 measuring move to a surface,
    // P9812/P9814 measuring cycles around the current position (no positioning of their own here)
    let probe = null;
    const pm = up.match(/G65\s*P0*(98\d\d)/);
    if (pm) {
      if (pm[1] === '9810') probe = 'move';
      else if (pm[1] === '9811') probe = 'measure';
      else { out.push(null); continue; }
    }
    let moved = false;
    for (const m of up.matchAll(/(?:^|[^A-Z])([XYZ])\s*([+-]?\d*\.?\d+)/g)) { pos[m[1].toLowerCase()] = +m[2]; seen.add(m[1]); moved = true; }
    // rotary axis A (4-axis): the part is turned about X through the origin
    const am = up.match(/(?:^|[^A-Z])A\s*([+-]?\d*\.?\d+)/);
    if (am) { aPos = +am[1]; moved = true; }
    // the position is only known once X, Y and Z have all been given
    if (cyc) {
      const rm = up.match(/(?:^|[^A-Z])R\s*([+-]?\d*\.?\d+)/);
      if (rm) cyc.r = +rm[1];
    }
    // Heidenhain cycle call (M99 / CYCL CALL): drilling at the hole, pockets as rings level by level
    if (heidenhain && hhCyc && /\bM99\b|CYCL CALL/.test(up) && seen.size === 3) {
      const q = hhCyc.q, top = q[203] ?? pos.z, zr = top + (q[204] ?? q[200] ?? 2);
      if ([251, 252, 253, 256, 257].includes(hhCyc.n)) {
        const pt = hhPocketMoves(hhCyc, pos, top, zr, toolRad ? toolRad(tool) || 0 : 0);
        if (pt) { out.push({ ...pt, tool, first: !known }); known = true; Object.assign(pos, { z: zr }); continue; }
      } else {
        out.push({ x: pos.x, y: pos.y, z: top + (q[201] ?? 0), rapid: false, cycle: true, zr, tool, first: !known });
        known = true;
        pos.z = zr;
        continue;
      }
    }
    if (moved && cyc && seen.size >= 2) {
      // hole: shown at its bottom (the depth stays valid for the following holes); afterwards the tool is back up
      if (/(?:^|[^A-Z])Z\s*[+-]?\d/.test(up)) cyc.depth = pos.z;
      const zr = cyc.ret === 'r' && cyc.r != null ? cyc.r : cyc.start;
      out.push({ x: pos.x, y: pos.y, z: cyc.depth ?? pos.z, rapid: false, cycle: true, zr, tool, first: !known });
      known = true;
      pos.z = zr;
      continue;
    }
    if (moved && seen.size === 3) {
      const pt = { x: pos.x, y: pos.y, z: pos.z, rapid: !!rapid && !probe, tool, first: !known };
      if (aPos != null) pt.a = aPos;
      if (probe) pt.probe = probe;
      // arc given by its radius (R): the centre lies on the bisector, on the side of the turning direction
      if (arcC && !Array.isArray(arcC)) {
        const r = arcC.r, dx = pos.x - before.x, dy = pos.y - before.y, L = Math.hypot(dx, dy);
        if (L > 1e-9 && Math.abs(r) >= L / 2 - 1e-6) {
          const hgt = Math.sqrt(Math.max(0, r * r - (L / 2) * (L / 2))), side = (arcCw ? -1 : 1) * (r < 0 ? -1 : 1);
          arcC = [before.x + dx / 2 - (dy / L) * hgt * side, before.y + dy / 2 + (dx / L) * hgt * side];
        } else arcC = null;
      }
      if (Array.isArray(arcC) && known) pt.arc = arcPts(before, pos, arcC, arcCw);
      // direction at the end of the move (for DEP): along the line, or the tangent of the arc
      if (Array.isArray(arcC)) { const rx = pos.x - arcC[0], ry = pos.y - arcC[1], l = Math.hypot(rx, ry); if (l > 1e-9) hhDir = arcCw ? [ry / l, -rx / l] : [-ry / l, rx / l]; }
      else { const dx = pos.x - before.x, dy = pos.y - before.y, l = Math.hypot(dx, dy); if (l > 1e-6) hhDir = [dx / l, dy / l]; }
      out.push(pt);
      known = true;
    }
    else out.push(null);
  }
  return out;
}
// Hole positions of a pattern cycle (Heidenhain 220 bolt circle, 221 grid; Sinumerik patterns mapped onto them)
function patternPoints(c) {
  const q = c.q, out = [];
  if (c.n === 220) {
    const n = Math.max(1, Math.round(q[241] || 1)), r = (q[244] || 0) / 2, a0 = q[245] || 0;
    const st = q[247] ? q[247] : n > 1 ? ((q[246] ?? a0) - a0) / (n - 1) : 0;
    for (let i = 0; i < n; i++) { const a = ((a0 + i * st) * Math.PI) / 180; out.push({ x: (q[216] || 0) + r * Math.cos(a), y: (q[217] || 0) + r * Math.sin(a) }); }
  } else {
    const ang = ((q[224] || 0) * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
    for (let j = 0; j < Math.max(1, Math.round(q[243] || 1)); j++)
      for (let i = 0; i < Math.max(1, Math.round(q[242] || 1)); i++) {
        const u = i * (q[237] || 0), v = j * (q[238] || 0);
        out.push({ x: (q[225] || 0) + u * ca - v * sa, y: (q[226] || 0) + u * sa + v * ca });
      }
  }
  return out;
}
// the machining cycle at every position of a pattern: drilling (down to the depth, back to the 2nd safety
// height) or a pocket cycle – one point carrying the whole sequence
function patternMoves(pts, mc, top, q204, rT) {
  if (!pts.length) return null;
  const zr = top + q204, seq = [];
  for (const p of pts) {
    if ([251, 252, 253, 256, 257].includes(mc.n)) { const pk = hhPocketMoves(mc, { ...p, z: zr }, top, zr, rT); if (pk) seq.push(...pk.seq); continue; }
    seq.push({ x: p.x, y: p.y, z: zr, rapid: true });
    seq.push({ x: p.x, y: p.y, z: top + (mc.q[201] ?? 0), cycle: true, zr });
    seq.push({ x: p.x, y: p.y, z: zr, rapid: true });
  }
  if (!seq.length) return null;
  const last = seq[seq.length - 1];
  return { ...last, rapid: false, seq, arc: seq.slice(0, -1) };
}

// Heidenhain pocket cycles 251/252 as the control mills them (approximately): down at the centre on each
// level, then rings from the inside out with the overlap Q370 × tool radius, finally up to the 2nd safety height.
function hhPocketMoves(c, pos, top, zr, rT) {
  const q = c.q, n = c.n, stl = q[368] || 0, stud = n === 256 || n === 257;
  // studs: the tool runs outside the finished size, rings from the blank size inwards
  const dmax = stud ? -(rT + stl) : rT + stl;
  const bottom = top + (q[201] ?? 0), dz = Math.abs(q[202] || Math.abs(q[201] || 1)), step = Math.max(0.05, (q[370] || 1) * Math.max(rT, 0.1));
  const ang = ((n === 251 || n === 256 ? q[224] || 0 : n === 253 ? q[374] || 0 : 0) * Math.PI) / 180, ca = Math.cos(ang), sa = Math.sin(ang);
  const round = n === 252 || n === 257;
  const L1 = round ? q[223] || 0 : q[218] || 0, L2 = round ? L1 : q[219] || 0;
  const a0 = L1 / 2 - dmax, b0 = L2 / 2 - dmax;
  if (!(a0 > 0 && b0 > 0)) return null;
  const rc0 = round ? a0 : n === 253 ? b0 : Math.max(0, (q[220] || 0) - dmax);
  if (stud) {
    // blank size Q424/Q425 (Q222): from there inwards to the finished size, approached from outside on +X
    const B1 = round ? q[222] || L1 : q[424] || L1, B2 = round ? B1 : q[425] || L2;
    const grow = Math.max(0, Math.min(B1 - L1, B2 - L2) / 2);
    const seq = [], levels = [];
    for (let z = top - dz; z > bottom + 1e-6; z -= dz) levels.push(z);
    levels.push(bottom);
    const ringS = (a, b, rc, z) => {
      rc = Math.min(rc, a, b);
      const pts = [], N = 8, cs = [[a - rc, b - rc, 0], [-(a - rc), b - rc, 1], [-(a - rc), -(b - rc), 2], [a - rc, -(b - rc), 3]];
      pts.push([a, 0]);
      for (const [ux, uy, k] of cs) for (let i = 0; i <= N; i++) { const t = ((k + i / N) * Math.PI) / 2; pts.push([ux + rc * Math.cos(t), uy + rc * Math.sin(t)]); }
      pts.push([a, 0]);
      return pts.map(([u, v]) => ({ x: pos.x + u * ca - v * sa, y: pos.y + u * sa + v * ca, z }));
    };
    const out0 = a0 + grow + rT + (q[200] ?? 2);
    const P0 = { x: pos.x + out0 * ca, y: pos.y + out0 * sa };
    for (const z of levels) {
      seq.push({ ...P0, z: top + (q[200] ?? 2), rapid: true });
      seq.push({ ...P0, z });
      const nR = Math.ceil(grow / step);
      for (let k = nR; k >= 0; k--) { const s = Math.min(grow, k * step); for (const p of ringS(a0 + s, b0 + s, rc0 + s, z)) seq.push(p); }
      seq.push({ ...P0, z });
    }
    seq.push({ ...seq[seq.length - 1], z: zr, rapid: true });
    const last = seq[seq.length - 1];
    return { ...last, rapid: false, seq, arc: seq.slice(0, -1) };
  }
  const ring = (a, b, rc, z) => {
    // rounded rectangle (circle when rc = a = b) around the centre, start on +X, counter-clockwise
    rc = Math.min(rc, a, b);
    const pts = [], N = 8, cs = [[a - rc, b - rc, 0], [-(a - rc), b - rc, 1], [-(a - rc), -(b - rc), 2], [a - rc, -(b - rc), 3]];
    pts.push([a, 0]);
    for (const [ux, uy, k] of cs) for (let i = 0; i <= N; i++) { const t = ((k + i / N) * Math.PI) / 2; pts.push([ux + rc * Math.cos(t), uy + rc * Math.sin(t)]); }
    pts.push([a, 0]);
    return pts.map(([u, v]) => ({ x: pos.x + u * ca - v * sa, y: pos.y + u * sa + v * ca, z }));
  };
  const seq = [];
  const levels = [];
  for (let z = top - dz; z > bottom + 1e-6; z -= dz) levels.push(z);
  levels.push(bottom);
  for (const z of levels) {
    seq.push({ x: pos.x, y: pos.y, z: Math.min(zr, top + (q[200] ?? 2)) , rapid: true });
    seq.push({ x: pos.x, y: pos.y, z });
    const n = Math.floor(Math.min(a0, b0) / step);
    for (let k = n; k >= 0; k--) {
      const s = k * step;
      for (const p of ring(a0 - s, b0 - s, Math.max(0, rc0 - s), z)) seq.push(p);
    }
  }
  seq.push({ ...seq[seq.length - 1], z: zr, rapid: true });
  const last = seq[seq.length - 1];
  return { ...last, rapid: false, seq, arc: seq.slice(0, -1) };
}

// Collision check of the NC program against the finished part (setup frame): holder or shank touching the
// part, rapid moves through it. Every move is sampled along its length.
function ncCollisions(g, pts) {
  // Collision check against the material that is still there at each line: the stock is cut away move by move
  // (flat or ball end), and before every move the holder, the shank and rapids are tested against it.
  const s = g.stock;
  // fixtures of the setup (vise, clamps) in the setup frame; the grid covers the stock and them
  const fxIds = new Set(g.setup?.fixtures || []);
  const fxBodies = getModel().bodies.filter(b => fxIds.has(b.id) && b.geometry).map(b => ({ geometry: b.geometry.clone().applyMatrix4(g.T) }));
  const fxBox = new THREE.Box3();
  for (const b of fxBodies) { b.geometry.computeBoundingBox(); fxBox.union(b.geometry.boundingBox); }
  const pad = 30;
  let gx0 = s.minX - pad, gy0 = s.minY - pad, gx1 = s.maxX + pad, gy1 = s.maxY + pad;
  if (fxBodies.length) { gx0 = Math.min(gx0, fxBox.min.x - 5); gy0 = Math.min(gy0, fxBox.min.y - 5); gx1 = Math.max(gx1, fxBox.max.x + 5); gy1 = Math.max(gy1, fxBox.max.y + 5); }
  const W = gx1 - gx0, H = gy1 - gy0;
  const res = Math.max(0.3, Math.max(W, H) / 300);
  const nx = Math.ceil(W / res) + 1, ny = Math.ceil(H / res) + 1, x0 = gx0, y0 = gy0;
  const h = new Float32Array(nx * ny).fill(-Infinity), lo = new Float32Array(nx * ny).fill(-Infinity); // top and lower end of the material
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const x = x0 + i * res, y = y0 + j * res;
    if (x >= s.minX && x <= s.maxX && y >= s.minY && y <= s.maxY) { h[j * nx + i] = s.shape ? stockTopAt(s, x, y) : s.top; lo[j * nx + i] = stockBotAt(s, x, y); }
  }
  let top = s.top;
  // the fixtures get their own height field on the same grid; they are never cut away
  let fh = null, fxTop = -Infinity;
  if (fxBodies.length) {
    fh = buildHeightmap(fxBodies, { minX: x0, minY: y0, maxX: x0 + (nx - 1) * res, maxY: y0 + (ny - 1) * res, top: fxBox.max.z }, res).h;
    fxBodies.forEach(b => b.geometry.dispose());
    for (const v of fh) if (v > fxTop) fxTop = v;
  }
  const fxAbove = (x, y, r, z) => !disc(x, y, r, idx => !(fh[idx] > z));
  const fxHit = (x, y, z, R, shaft, flute, holder, stick) => z <= fxTop + 0.05 && (fxAbove(x, y, R, z + 0.05) || (z + flute <= fxTop && fxAbove(x, y, shaft / 2, z + flute)) || (z + stick <= fxTop && fxAbove(x, y, holder / 2, z + stick)));
  const disc = (x, y, r, fn) => {
    const i0 = Math.max(0, Math.floor((x - r - x0) / res)), i1 = Math.min(nx - 1, Math.ceil((x + r - x0) / res));
    const j0 = Math.max(0, Math.floor((y - r - y0) / res)), j1 = Math.min(ny - 1, Math.ceil((y + r - y0) / res));
    for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
      const dx = x0 + i * res - x, dy = y0 + j * res - y, d2 = dx * dx + dy * dy;
      if (d2 <= r * r && fn(j * nx + i, d2) === false) return false;
    }
    return true;
  };
  const above = (x, y, r, z) => !disc(x, y, r, idx => h[idx] <= z || h[idx] <= lo[idx]); // material higher than z within r?
  // material inside the cutting part (ball end: above the ball's surface, not just above its tip)?
  // height of the cutting edge at distance² d2 from the axis; ball: true = ball end, a number = corner radius of a torus cutter
  const edgeZ = (z, R, d2, ball) => {
    if (ball === true) return z + R - Math.sqrt(Math.max(0, R * R - d2));
    if (ball > 0) { const d = Math.sqrt(d2), rf = R - ball; return d <= rf ? z : z + ball - Math.sqrt(Math.max(0, ball * ball - (d - rf) * (d - rf))); }
    return z;
  };
  const inTool = (x, y, R, z, ball) => !disc(x, y, R * 0.98, (idx, d2) => h[idx] <= edgeZ(z, R, d2, ball) + 0.05 || h[idx] <= lo[idx]);
  const cut = (x, y, z, R, ball) => disc(x, y, R, (idx, d2) => { const t = edgeZ(z, R, d2, ball); if (h[idx] > t) h[idx] = t; });
  const o = originOf(g.setup, s);
  const tools = new Map(state.project.cam.tools.map(t => [+t.number, t]));
  const out = [];
  let prev = null;
  // a probe cycle carries all its moves: each one is checked on its own (same line)
  pts.forEach((p, k) => (p?.seq ? p.seq.forEach(q => step({ ...q, tool: p.tool }, k)) : step(p, k)));
  const once = new Set();
  return out.filter(is => !once.has(is.k + is.kind) && once.add(is.k + is.kind));
  function step(p, k) {
    if (!p) return;
    // turned part (A ≠ 0°): the height field does not apply – the next 3-axis move starts afresh
    if (p.a != null && Math.abs((((p.a % 360) + 540) % 360) - 180) < 179.999) { prev = null; return; }
    const t = tools.get(+p.tool);
    const a = prev, b = { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z };
    prev = p.cycle ? { ...b, z: p.zr + o.z } : b;
    if (!t || !a) return;
    const R = (+t.dia || 1) / 2, flute = toolFlute(t), stick = toolStick(t), shaft = toolShaft(t), holder = +(t.holderDia ?? defaultHolderDia(t));
    const ball = toolBase(t) === 'ball' ? true : cornerOf(t);
    // a drilling cycle: the hole is drilled (the cutting part may go into the material)
    if (p.cycle) {
      if (b.z + stick < top && above(b.x, b.y, holder / 2, b.z + stick)) out.push({ k, kind: 'holder', at: { x: p.x, y: p.y, z: p.z } });
      if (fh && fxHit(b.x, b.y, b.z, R, shaft, flute, holder, stick)) out.push({ k, kind: 'fixture', at: { x: p.x, y: p.y, z: p.z } });
      cut(b.x, b.y, b.z, R, false);
      return;
    }
    const kinds = new Set();
    // touch probe: it never cuts; touching is expected on a measuring move, anywhere else the probe hits
    if (p.probe || toolBase(t) === 'probe') {
      const n = Math.min(4000, Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / res)));
      let free = a;
      for (let q = 1; q <= n; q++) {
        const x = a.x + (b.x - a.x) * (q / n), y = a.y + (b.y - a.y) * (q / n), z = a.z + (b.z - a.z) * (q / n);
        // the probe stops at the first contact: wanted on a measuring move, an alarm on any other move
        if (z < top && above(x, y, R * 0.98, z + 0.05)) {
          if (p.probe !== 'measure') kinds.add('probe');
          prev = free;
          break;
        }
        free = { x, y, z };
        if (!kinds.has('holder') && z + stick < top && above(x, y, holder / 2, z + stick + 0.05)) kinds.add('holder');
        if (fh && !kinds.has('fixture') && fxHit(x, y, z, p.probe === 'measure' ? 0.01 : R, shaft, flute, holder, stick)) kinds.add('fixture');
      }
      for (const kind of kinds) out.push({ k, kind, at: { x: p.x, y: p.y, z: p.z } });
      return;
    }
    const chain = [a, ...(p.arc || []).map(q => ({ x: q.x + o.x, y: q.y + o.y, z: q.z + o.z })), b];
    for (let c = 1; c < chain.length; c++) {
      const A = chain[c - 1], B = chain[c];
      const n = Math.min(4000, Math.max(1, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) / Math.max(res, R / 3))));
      for (let q = 1; q <= n; q++) {
        const x = A.x + (B.x - A.x) * (q / n), y = A.y + (B.y - A.y) * (q / n), z = A.z + (B.z - A.z) * (q / n);
        if (!kinds.has('holder') && z + stick < top && (q % 3 === 0 || q === n) && above(x, y, holder / 2, z + stick + 0.05)) kinds.add('holder');
        if (!kinds.has('shank') && shaft / 2 >= R - 1e-6 && z + flute < top && above(x, y, shaft / 2, z + flute + 0.05)) kinds.add('shank');
        if (p.rapid && !kinds.has('rapid') && z < top && inTool(x, y, R, z, ball)) kinds.add('rapid');
        if (fh && !kinds.has('fixture') && fxHit(x, y, z, R, shaft, flute, holder, stick)) kinds.add('fixture');
        cut(x, y, z, R, ball);
      }
    }
    for (const kind of kinds) out.push({ k, kind, at: { x: p.x, y: p.y, z: p.z } });
  }
}
// Lathe programs: X is the diameter (G7, radius with G8), Z0 the finished face. Positions come out as
// x = radius, y = 0, z relative to the face; the tool number is the first half of T0101.
// Lathe cycles of the control, expanded to the moves they make (for backplot and check): roughing along a
// contour that rises steadily towards the chuck (Okuma G85 / Fanuc G71), passes of depth D from the start point
// down to the contour, then once along the contour; threading (Okuma G71 / Fanuc G76) in passes to the depth H.
function latheRoughChain(st, cp, D) {
  if (!(D > 0) || cp.length < 2) return [];
  const xmin = Math.min(...cp.map(q => q.x));
  const zAt = rl => {
    const k = cp.findIndex(q => q.x >= rl - 1e-9);
    if (k < 0) return cp[cp.length - 1].z;
    if (k === 0) return cp[0].z;
    const a = cp[k - 1], b = cp[k];
    return b.x - a.x > 1e-9 ? a.z + ((b.z - a.z) * (rl - a.x)) / (b.x - a.x) : b.z;
  };
  const ch = [];
  for (let rl = st.x - D, guard = 0; rl > xmin + 1e-6 && guard < 2000; rl -= D, guard++) {
    const zc = zAt(rl);
    if (zc >= st.z - 1e-6) continue;
    ch.push({ x: rl + 0.5, y: 0, z: st.z }, { x: rl, y: 0, z: st.z }, { x: rl, y: 0, z: zc }, { x: rl + 0.5, y: 0, z: zc + 0.5 }, { x: rl + 0.5, y: 0, z: st.z });
  }
  for (const q of cp) ch.push({ x: q.x, y: 0, z: q.z });
  const e = cp[cp.length - 1];
  ch.push({ x: Math.max(e.x, st.x), y: 0, z: e.z });
  return ch;
}
function latheThreadChain(st, xr, ze, H, D) {
  if (!(H > 0)) return [];
  const inside = xr > st.x, d1 = D > 0 ? D : H / 6, ch = [];
  for (let k = 1, d = 0; d < H - 1e-9 && k < 200; k++) {
    d = Math.min(H, d1 * Math.sqrt(k));
    const x = inside ? xr - H + d : xr + H - d;
    ch.push({ x, y: 0, z: st.z }, { x, y: 0, z: ze }, { x: st.x, y: 0, z: ze }, { x: st.x, y: 0, z: st.z });
  }
  return ch;
}
function parseNcLathe(code) {
  const pos = { x: 0, z: 0 };
  let mode = 0, tool = null, known = false, sx = false, sz = false, diam = true, cAng = null, polar = false;
  const out = [];
  const ups = code.split('\n').map(raw => raw.replace(/\([^)]*\)/g, '').replace(/;.*$/, '').toUpperCase());
  const wv = (up, k) => { const m = up.match(new RegExp(`(?:^|[^A-Z])${k}\\s*([+-]?\\d*\\.?\\d+)`)); return m ? +m[1] : null; };
  const skip = new Set();
  let fanucU = null;
  // contour blocks i0..i1 read from the start point (X diameter, modal)
  const contourOf = (i0, i1) => {
    const c = { ...pos }, pts = [];
    for (let j = i0; j <= i1; j++) {
      const u = ups[j].replace(/^\s*N\d+/, ''), x = wv(u, 'X'), z = wv(u, 'Z');
      if (x == null && z == null) continue;
      if (x != null) c.x = diam ? x / 2 : x;
      if (z != null) c.z = z;
      pts.push({ x: c.x, z: c.z });
    }
    return pts;
  };
  for (let i = 0; i < ups.length; i++) {
    const up = ups[i];
    if (skip.has(i)) { out.push(null); continue; }
    // roughing cycles: Okuma G85 N<label> D… (contour N<label> G81 … G80), Fanuc G71 U… R… / G71 P… Q…
    const okR = up.match(/G85\s*N(\d+)/), okF = up.match(/G87\s*N(\d+)/);
    const faF = /G70(?![\d.])/.test(up) && wv(up, 'P') != null && wv(up, 'Q') != null;
    const faR = /G71/.test(up) && wv(up, 'P') != null && wv(up, 'Q') != null && wv(up, 'X') == null;
    if (/G71/.test(up) && wv(up, 'U') != null && wv(up, 'P') == null && wv(up, 'X') == null) fanucU = wv(up, 'U');
    if ((okR || faR || okF || faF) && known) {
      // the contour: Okuma N<label> G81 … G80, Fanuc blocks N<P> … N<Q> (for finishing: those of the roughing before)
      let i0 = -1, i1 = -1;
      const lab = okR || okF;
      if (lab) {
        i0 = ups.findIndex(u => new RegExp(`^\\s*N${lab[1]}\\s*G81`).test(u));
        if (i0 >= 0) i1 = ups.findIndex((u, j) => j > i0 && /G80/.test(u));
      } else {
        const ns = Math.round(wv(up, 'P')), nf = Math.round(wv(up, 'Q'));
        i0 = ups.findIndex((u, j) => (faR ? j > i : j !== i) && new RegExp(`^\\s*N0*${ns}(?!\\d)`).test(u));
        if (i0 >= 0) i1 = ups.findIndex((u, j) => j >= i0 && new RegExp(`^\\s*N0*${nf}(?!\\d)`).test(u));
      }
      if (i0 >= 0 && i1 >= i0) {
        const cp = contourOf(lab ? i0 + 1 : i0, lab ? i1 - 1 : i1);
        if (okR || faR) {
          for (let j = i0; j <= i1; j++) skip.add(j);
          // finishing allowance U (diameter): the roughing stays that far outside the contour
          const u = (wv(up.replace(/G71\s*U[^A-Z]*R[\d.]*/, ''), 'U') || 0) / (diam ? 2 : 1);
          out.push({ x: pos.x, y: 0, z: pos.z, rapid: false, tool, cycle: true, arc: latheRoughChain(pos, cp.map(q => ({ x: q.x + u, z: q.z })), okR ? wv(up, 'D') : fanucU) });
        } else if (cp.length) {
          // finishing: once along the contour, out and back to the start point
          const e = cp[cp.length - 1];
          out.push({ x: pos.x, y: 0, z: pos.z, rapid: false, tool, cycle: true, arc: [...cp.map(q => ({ x: q.x, y: 0, z: q.z })), { x: Math.max(pos.x, e.x), y: 0, z: e.z }, { x: pos.x, y: 0, z: pos.z }] });
        }
        continue;
      }
    }
    // threading cycles: Okuma G71 X Z H D F, Fanuc G76 X Z P(µm) Q(µm) F
    const okT = /G71/.test(up) && wv(up, 'X') != null && wv(up, 'H') != null;
    const faT = /G76/.test(up) && wv(up, 'X') != null;
    if ((okT || faT) && known) {
      const xr = diam ? wv(up, 'X') / 2 : wv(up, 'X'), ze = wv(up, 'Z') ?? pos.z;
      const H = okT ? wv(up, 'H') : (wv(up, 'P') || 0) / 1000, D = okT ? wv(up, 'D') : (wv(up, 'Q') || 0) / 1000;
      out.push({ x: pos.x, y: 0, z: pos.z, rapid: false, thread: true, tool, cycle: true, arc: latheThreadChain(pos, xr, ze, H, D) });
      continue;
    }
    const tm = up.match(/(?:^|[^A-Z])T\s*(\d+)/);
    // T0101 (Fanuc: tool + offset), T010101 (Okuma: offset + tool + nose)
    if (tm) { tool = tm[1].length === 4 ? +tm[1].slice(0, 2) : tm[1].length === 6 ? +tm[1].slice(2, 4) : +tm[1]; cAng = null; }
    if (/G12\.1|G112(?![\d.])/.test(up)) polar = true;
    if (/G13\.1|G113(?![\d.])/.test(up)) { polar = false; cAng = null; }
    { const cw = /G0*7\.1|G107(?![\d.])/.test(up) ? null : wv(up, 'C'); if (cw != null) cAng = cw; }
    if (/G0*7(?![\d.])/.test(up)) diam = true;
    if (/G0*8(?![\d.])/.test(up)) diam = false;
    // dwell (X = time) and reference / datum moves are no tool moves
    if (/G0*4(?![\d.])|G28|G30|G53|G5[0-9]|G10|G92/.test(up)) { out.push(null); continue; }
    for (const g of up.matchAll(/G0*(\d+)(\.\d)?/g)) { const v = +g[1]; if (!g[2] && [0, 1, 2, 3, 32, 33].includes(v)) mode = v; }
    let moved = false;
    const before = { ...pos };
    for (const m of up.matchAll(/(?:^|[^A-Z])([XZ])\s*([+-]?\d*\.?\d+)/g)) {
      if (m[1] === 'X') { pos.x = diam ? +m[2] / 2 : +m[2]; sx = true; } else { pos.z = +m[2]; sz = true; }
      moved = true;
    }
    if (polar && sx && sz && wv(up, 'C') != null) moved = true; // polar mode: a C word alone is a move too
    if (moved && sx && sz) {
      const pt = { x: pos.x, y: 0, z: pos.z, rapid: mode === 0, thread: mode === 32 || mode === 33, tool, first: !known };
      if ((mode === 2 || mode === 3) && known) pt.arc = latheArc(before, pos, up, mode === 2);
      if (cAng != null) pt.c = cAng;
      // polar mode: X/C are Cartesian on the part -> radius and angle
      if (polar && cAng != null) { pt.c = (Math.atan2(cAng, pos.x) * 180) / Math.PI; pt.x = Math.hypot(pos.x, cAng); }
      out.push(pt);
      known = true;
    } else out.push(null);
  }
  return out;
}
// Lathe arc (G18, Z to the right, X up: G2 clockwise) from a to b, centre by I/K (radius values, relative to
// the start) or by R; returned as points in between (x = radius).
function latheArc(a, b, up, cw) {
  const num = k => { const m = up.match(new RegExp(`(?:^|[^A-Z])${k}\\s*([+-]?\\d*\\.?\\d+)`)); return m ? +m[1] : null; };
  const I = num('I'), K = num('K'), R = num('R');
  let cu, cv;
  if (I != null || K != null) { cu = a.z + (K || 0); cv = a.x + (I || 0); }
  else if (R != null) {
    const du = b.z - a.z, dv = b.x - a.x, L = Math.hypot(du, dv);
    if (!(L > 1e-9) || Math.abs(R) < L / 2 - 1e-6) return null;
    const hgt = Math.sqrt(Math.max(0, R * R - (L / 2) ** 2)), side = (cw ? -1 : 1) * (R < 0 ? -1 : 1);
    cu = a.z + du / 2 - (dv / L) * hgt * side; cv = a.x + dv / 2 + (du / L) * hgt * side;
  } else return null;
  const r = Math.hypot(a.z - cu, a.x - cv);
  if (!(r > 1e-6)) return null;
  const a0 = Math.atan2(a.x - cv, a.z - cu), a1 = Math.atan2(b.x - cv, b.z - cu);
  let sw = a1 - a0;
  if (cw && sw >= -1e-9) sw -= Math.PI * 2;
  if (!cw && sw <= 1e-9) sw += Math.PI * 2;
  const n = Math.max(2, Math.ceil(Math.abs(sw) / (Math.PI / 36)));
  return Array.from({ length: n - 1 }, (_, k) => { const an = a0 + (sw * (k + 1)) / n; return { x: cv + r * Math.sin(an), y: 0, z: cu + r * Math.cos(an) }; });
}
// NC check for turning: the stock is a radius profile r(z), cut move by move with the edge of each tool.
// Reported: rapids into material, moves into the chuck (below the end of the stock), cuts below the finished
// contour (threads excluded), turning tools cutting backwards (+Z) and grooving tools loaded sideways.
// Bores: drills and boring bars cut the ring from the inside; the bar body must stay clear of the bore wall.
function ncLatheCheck(g, pts) {
  const s = g.stock, prof = g.profile;
  const S = new LatheStock(s), dz = S.dz;
  const tools = new Map(state.project.cam.tools.map(t => [+t.number, t]));
  // finished radius at z; at shoulders the smaller neighbour counts (the profile is sampled)
  const edge = z => z <= prof.z0 + 2 * dz || z >= prof.z1 - 2 * dz;
  const need = z => (edge(z) ? -Infinity : Math.min(prof.at(z - prof.dz), prof.at(z), prof.at(z + prof.dz)));
  const needIn = z => (edge(z) ? Infinity : Math.max(prof.atIn(z - prof.dz), prof.atIn(z), prof.atIn(z + prof.dz)));
  const out = [];
  let prev = null;
  pts.forEach((p, k) => {
    if (!p) return;
    const t = tools.get(+p.tool);
    const a = prev, b = { x: p.x, z: p.z + s.modelTop };
    prev = b;
    if (!t || !a || p.c != null) return; // driven tools (C axis) do not cut the turned profile
    const sh = turnCutShape(t), kinds = new Set();
    // the trailing edge starts behind the nose: material it removes means the tool went down too steeply
    const trail = sh.rn != null ? sh.rn * 1.5 + dz : Infinity;
    let removed = 0, flank = 0, backZ = 0;
    const chain = [a, ...(p.arc || []).map(q => ({ x: q.x, z: q.z + s.modelTop })), b];
    for (let c = 1; c < chain.length; c++) {
      const u = chain[c - 1], v = chain[c];
      const steps = Math.min(20000, Math.max(1, Math.ceil(Math.hypot(v.x - u.x, v.z - u.z) / (dz * 0.7))));
      let segRem = 0;
      for (let q = 1; q <= steps; q++) {
        const x = u.x + ((v.x - u.x) * q) / steps, z = u.z + ((v.z - u.z) * q) / steps;
        if (!kinds.has('chuck') && z + sh.lo < s.bottom - 0.05 && x < s.r + 15) kinds.add('chuck');
        segRem += S.cutAt(x, z, sh, (i, zi, d, rem, nr) => {
          if (d > trail) flank += rem;
          if (!p.thread && !kinds.has('contour') && (sh.side === 'out' ? nr < need(zi) - 0.05 : nr > needIn(zi) + 0.05)) kinds.add('contour');
        });
        if (sh.bar && !kinds.has('bar') && S.barHit(x, z, sh) != null) kinds.add('bar');
      }
      removed += segRem;
      if (segRem > 0.05 && v.z - u.z > 0.05) backZ += segRem;
    }
    if (p.rapid && removed > 0.05) kinds.add('rapid');
    if (!p.rapid && removed > 0.05) {
      const turning = t.type === 'turn' || t.type === 'turnbore';
      if (turning && backZ > 0.05) kinds.add('back');
      if (turning && flank > 0.2 && !kinds.has('back')) kinds.add('flank');
      if (t.type === 'groove' && Math.abs(b.z - a.z) > 0.05) kinds.add('side');
    }
    for (const kind of kinds) out.push({ k, kind, at: { x: p.x, y: 0, z: p.z } });
  });
  return out;
}
// Machine check for a (tilted) milling setup: rotary axis positions within their limits, and the tool, holder
// and spindle nose clear of the machine table (a disc under the part and its fixtures) along the whole program.
function ncMachineCheck(g, pts) {
  const kin = g.machine?.kin;
  if (!kin || kin.type === 'none' || !g.setup) return { issues: [], info: null };
  const v = new THREE.Vector3(0, 0, 1).transformDirection(g.T.clone().invert());
  // 4-axis simultaneous setup: the part lies along the A axis as the setup shows (clamping, no swivel)
  const rotary = [...(g.results?.values() || [])].some(r => r?.rotary);
  const ang = rotary ? { ok: true, txt: 'Teil entlang der A-Achse gespannt' } : kinAngles(kin, v);
  const issues = [], k0 = Math.max(0, pts.findIndex(p => p));
  if (!ang.ok) issues.push({ k: k0, kind: 'limit', at: pts[k0] || { x: 0, y: 0, z: 0 } });
  const R = +kin.tableR || 0;
  if (kin.type !== 'A' && R > 0) {
    // the stock (setup frame) and the fixtures, in the model frame: the table is under their lowest point
    const s = g.stock, Ti = g.T.clone().invert(), box = new THREE.Box3();
    for (const x of [s.minX, s.maxX]) for (const y of [s.minY, s.maxY]) for (const z of [s.bottom, s.top]) box.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(Ti));
    const fx = new Set(g.setup.fixtures || []);
    for (const b of getModel().bodies.filter(b => b.geometry && fx.has(b.id))) { b.geometry.computeBoundingBox(); box.union(b.geometry.boundingBox); }
    if (!box.isEmpty()) {
      // table top just under the stock / lowest fixture, centred under the stock (model frame) → setup frame
      const cx = (box.min.x + box.max.x) / 2, cy = (box.min.y + box.max.y) / 2, cz = box.min.z;
      const qs = [];
      for (const f of [1, 0.75, 0.5, 0.25, 0]) {
        const n = f ? Math.round(64 * f) : 1;
        for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; qs.push(new THREE.Vector3(cx + R * f * Math.cos(a), cy + R * f * Math.sin(a), cz).applyMatrix4(g.T)); }
      }
      const o = originOf(g.setup, g.stock);
      const tools = new Map(state.project.cam.tools.map(t => [+t.number, t]));
      const nose = (+kin.spindleD || 0) / 2;
      let prev = null;
      pts.forEach((p, k) => {
        if (!p) return;
        const b = { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z }, a = prev || b;
        prev = b;
        const t = tools.get(+p.tool);
        if (!t) return;
        const r = (+t.dia || 1) / 2, flute = toolFlute(t), stick = toolStick(t), shaft = toolShaft(t), hd = +(t.holderDia ?? defaultHolderDia(t)), hl = Math.max(20, hd * 1.4);
        const radAt = hgt => (hgt <= flute ? r : hgt <= stick ? shaft / 2 : hgt <= stick + hl ? hd / 2 : Math.max(nose, hd / 2));
        const n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z) / 5)), kinds = new Set();
        for (let s = 1; s <= n; s++) {
          const x = a.x + ((b.x - a.x) * s) / n, y = a.y + ((b.y - a.y) * s) / n, z = a.z + ((b.z - a.z) * s) / n;
          // only the cutting part below the table top: a cut through the stock into the table (no spoil board)
          let hit = null;
          for (const q of qs) {
            const hgt = q.z - z;
            if (hgt <= 0.05 || Math.hypot(q.x - x, q.y - y) >= radAt(hgt)) continue;
            hit = hgt > flute ? 'table' : 'tablecut';
            if (hit === 'table') break;
          }
          if (hit && !kinds.has(hit)) { kinds.add(hit); issues.push({ k, kind: hit, at: { x: p.x, y: p.y, z: p.z } }); }
          if (kinds.has('table')) break;
        }
      });
    }
  }
  return { issues, info: ang.ok ? `${rotary ? '4-Achs: ' : 'Schwenkwinkel '}${ang.txt} · ${g.machine.name}` : null, why: ang.ok ? null : ang.why };
}
// 4-axis lines (A) of a program: cut move by move on a cylinder map of the stock around the A axis and compared
// with the part (at shoulders the lower neighbour counts: the maps are sampled)
function ncRotaryCheck(g, pts) {
  const rot = [...(g.results?.values() || [])].find(r => r?.rotary && !r.error)?.rotary;
  if (!rot || !pts.some(p => p?.a != null)) return [];
  const s = g.stock, o = originOf(g.setup, s);
  const cs = new CylStock({ x0: s.minX, x1: s.maxX, cy: rot.y, cz: rot.z, r: rot.r });
  const bvhs = setupBodies(getModel().bodies.filter(b => b.geometry), g.setup).map(b => new MeshBVH(b.geometry.clone().applyMatrix4(g.T)));
  const raw = cylPartMap(cs, bvhs), part = new Float32Array(raw.length);
  for (let i = 0; i < cs.nx; i++) for (let j = 0; j < cs.nt; j++) {
    let m = Infinity;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) { const ii = i + di; if (ii < 0 || ii >= cs.nx) continue; m = Math.min(m, raw[ii * cs.nt + ((j + dj + cs.nt) % cs.nt)]); }
    part[i * cs.nt + j] = m;
  }
  const tools = new Map(state.project.cam.tools.map(t => [+t.number, t]));
  const out = [];
  let prev = null;
  // every line of the program against the same cylinder stock: moves that turn A as radial cuts, moves at a
  // fixed A (3-axis lines: before the first A word, at A0, or indexed) with the tool along Z on the turned part
  pts.forEach((p, k) => {
    if (!p) return;
    const cur = { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z, a: p.a ?? prev?.a ?? 0 };
    cur.rho = Math.hypot(cur.y - rot.y, cur.z - rot.z);
    const a = prev;
    // drilling cycle: down to the point, back to the retract plane
    prev = p.cycle && p.zr != null ? { ...cur, z: p.zr + o.z, rho: Math.hypot(cur.y - rot.y, p.zr + o.z - rot.z) } : cur;
    const t = tools.get(+p.tool);
    if (!t || !a) return;
    const kinds = new Set(), R = (+t.dia || 1) / 2, ball = toolBase(t) === 'ball';
    const onPart = (idx, e) => { if (!kinds.has('contour') && e < part[idx] - 0.05) kinds.add('contour'); };
    if (Math.abs(cur.a - a.a) > 1e-6) {
      const res = cs.cutMove(a, cur, { R, ball }, onPart);
      if (p.rapid && res.removed > 0.05) kinds.add('rapid');
      if (res.removed > 0.05 && res.top > toolFlute(t) + 0.05) kinds.add('shank');
    } else {
      const th = (cur.a * Math.PI) / 180, flute = toolFlute(t), shaft = toolShaft(t), stick = toolStick(t), holder = +(t.holderDia ?? defaultHolderDia(t));
      const chain = [a, ...(p.arc || []).map(q => ({ x: q.x + o.x, y: q.y + o.y, z: q.z + o.z })), cur];
      for (let c = 1; c < chain.length; c++) {
        const A = chain[c - 1], B = chain[c];
        const n = Math.min(3000, Math.max(1, Math.ceil(Math.hypot(B.x - A.x, B.y - A.y, B.z - A.z) / Math.max(0.25, R / 4))));
        for (let q = 1; q <= n; q++) {
          const x = A.x + (B.x - A.x) * (q / n), y = A.y + (B.y - A.y) * (q / n), z = A.z + (B.z - A.z) * (q / n);
          if (z - rot.z > cs.r0 + 0.5) continue; // above the stock
          if (!kinds.has('shank') && shaft / 2 >= R - 1e-6 && cs.cutVertical(x, y, z + flute, { R: shaft / 2, ball: false }, null, th, true).removed > 0.05) kinds.add('shank');
          if (!kinds.has('holder') && (q % 3 === 0 || q === n) && cs.cutVertical(x, y, z + stick, { R: holder / 2, ball: false }, null, th, true).removed > 0.05) kinds.add('holder');
          const rem = cs.cutVertical(x, y, z, { R, ball }, onPart, th).removed;
          if (p.rapid && rem > 0.05) kinds.add('rapid');
        }
      }
    }
    for (const kind of kinds) out.push({ k, kind, at: { x: p.x, y: p.y, z: p.z } });
  });
  return out;
}
const NC_ISSUE = { tablecut: 'Werkzeug schneidet durch das Rohteil in den Maschinentisch (Opferplatte oder Spannmittel unterlegen)', limit: 'Schwenkwinkel liegt außerhalb der Achsgrenzen der Maschine (Werkstück anders aufspannen)', table: 'Werkzeug, Halter oder Spindelnase fährt in den Maschinentisch', bar: 'Bohrstange berührt die Bohrungswand (Bohrstange zu dick oder Bohrung zu klein)', flank: 'Nebenschneide schneidet – Bahn taucht steiler ein, als Eckenwinkel und Einstellwinkel der Wendeplatte erlauben', chuck: 'Werkzeug fährt ins Spannfutter (unter das Rohteil-Ende)', contour: 'Fertigkontur verletzt (Werkzeug schneidet zu tief)', back: 'Drehmeißel schneidet rückwärts (+Z) ins Material', side: 'Stechmeißel schneidet seitlich (Z-Bewegung im Material)', holder: 'Halter berührt das Material', shank: 'Schaft berührt das Material (Schneidenlänge zu kurz)', rapid: 'Eilgang ins Material', fixture: 'Werkzeug oder Halter fährt in ein Spannmittel', probe: 'Taster stößt außerhalb einer Messbewegung an (geschützte Bewegung bricht ab)' };

// Heidenhain Klartext: syntax check of the program as the control reads it (line by line, before it runs)
Object.assign(NC_ISSUE, {
  hhNum: 'Satznummern nicht fortlaufend (die Steuerung erwartet 0, 1, 2 …)',
  hhPgm: 'BEGIN PGM / END PGM fehlt oder Programmname/Maßeinheit stimmen nicht überein',
  hhCC: 'Kreisbogen C/CP ohne vorherigen Kreismittelpunkt CC',
  hhDR: 'Kreisbogen ohne Drehsinn DR+ / DR-',
  hhCyc: 'Zyklus unvollständig (Q-Parameter fehlen oder Fortsetzungszeile ~ endet nicht)',
  hhTool: 'Bewegung mit Vorschub vor dem ersten TOOL CALL',
  hhWord: 'Unbekanntes oder falsch geschriebenes Wort (Klartext-Syntax)',
  hhCall: 'Zyklus-Aufruf M99 / CYCL CALL ohne vorher definierten Zyklus',
  hhAppr: 'APPR ohne Radiuskorrektur RL/RR oder unvollständig (LEN / R / CCA fehlt)',
});
const HH_CYC_Q = {
  220: [216, 217, 244, 245, 246, 247, 241, 200, 203, 204, 301], 221: [225, 226, 237, 238, 242, 243, 224, 200, 203, 204, 301],
  253: [215, 218, 219, 368, 374, 207, 351, 201, 202, 206, 200, 203, 204, 366], 256: [218, 424, 219, 425, 220, 368, 224, 207, 351, 201, 202, 206, 200, 203, 204, 370],
  257: [223, 222, 368, 207, 351, 201, 202, 206, 200, 203, 204, 370],
  251: [215, 218, 219, 220, 368, 224, 207, 351, 201, 202, 206, 200, 203, 204, 370, 366], 252: [215, 223, 368, 207, 351, 201, 202, 206, 200, 203, 204, 370, 366],
  200: [200, 201, 206, 202, 210, 203, 204, 211], 201: [200, 201, 206, 211, 208, 203, 204], 202: [200, 201, 206, 211, 208, 203, 204],
  203: [200, 201, 206, 202, 203, 204], 207: [200, 201, 239, 203, 204],
};
function ncHeidenhainCheck(code) {
  const lines = code.split('\n'), issues = [];
  const add = (k, kind) => issues.push({ k, kind, at: null });
  let expect = null, begin = null, cc = false, tool = false, cyc = null, cycDef = false, numbered = 0;
  const L = s => s.replace(/;.*$/, '').trim();
  for (let k = 0; k < lines.length; k++) {
    const raw = lines[k];
    if (!raw.trim()) continue;
    const cont = /^\s/.test(raw); // continuation of a cycle definition (Q parameters)
    let s = raw.trim();
    if (!cont) {
      const nm = s.match(/^(\d+)\s+(.*)$/);
      if (nm) {
        numbered++;
        if (expect != null && +nm[1] !== expect) add(k, 'hhNum');
        expect = +nm[1] + 1;
        s = nm[2];
      } else if (numbered) add(k, 'hhNum');
    }
    if (cyc) {
      for (const m of raw.matchAll(/Q(\d+)\s*=/g)) cyc.q.add(+m[1]);
      if (!/~\s*$/.test(raw.trimEnd())) {
        const need = HH_CYC_Q[cyc.n] || [];
        if (need.some(q => !cyc.q.has(q))) add(cyc.k, 'hhCyc');
        cyc = null;
      }
      if (cont) continue;
    } else if (cont) { add(k, 'hhCyc'); continue; }
    if (s.startsWith(';') || s.startsWith('*')) continue;
    const u = L(s).toUpperCase();
    let m;
    if ((m = u.match(/^BEGIN PGM\s+(\S+)\s+(MM|INCH)$/))) { begin = { name: m[1], unit: m[2], k }; continue; }
    if ((m = u.match(/^END PGM\s+(\S+)\s+(MM|INCH)$/))) { if (!begin || begin.name !== m[1] || begin.unit !== m[2]) add(k, 'hhPgm'); begin = begin && { ...begin, closed: true }; continue; }
    if (/^BLK FORM 0\.[12]\b/.test(u)) continue;
    if (/^TOOL CALL\b/.test(u)) { tool = true; if (!/^TOOL CALL\s+(\d+|"[^"]+")(\s+[XYZ])?(\s+S[+-]?\d*\.?\d+)?(\s+F\d+)?(\s+D[LR][+-]?\d*\.?\d+)*$/.test(u)) add(k, 'hhWord'); continue; }
    if ((m = u.match(/^CYCL DEF\s+(\d+)(\.\d)?/))) {
      if (!m[2]) { cyc = { n: +m[1], k, q: new Set() }; if (!/~\s*$/.test(raw.trimEnd())) { if ((HH_CYC_Q[cyc.n] || []).length) add(k, 'hhCyc'); cyc = null; } }
      if (+m[1] >= 200 || m[2] === '.0') cycDef = true;
      continue;
    }
    if (/^TCH PROBE\s+\d+/.test(u)) { if (/~\s*$/.test(raw.trimEnd())) cyc = { n: 0, k, q: new Set() }; continue; }
    if (/^CYCL CALL\b/.test(u)) { if (!cycDef) add(k, 'hhCall'); continue; }
    if (/^(PLANE|M\d+|FN\s*\d+|Q\d+\s*=|LBL|CALL|STOP|TRANS|FUNCTION|DECLARE|SEL|\*)/.test(u)) continue;
    if ((m = u.match(/^(APPR|DEP)\s+(LCT|LT|LN|CT)\b(.*)$/))) {
      const [, fn, ty, rest] = m;
      if (!/^(\s+(X|Y|Z)[+-]?\d*\.?\d+|\s+LEN\s*[+-]?\d*\.?\d+|\s+CCA\s*[+-]?\d*\.?\d+|\s+R[+-]\d*\.?\d+|\s+R[LR]|\s+F(MAX|Q\d+|\d*\.?\d+)|\s+M\d+)*$/.test(rest)) add(k, 'hhWord');
      const need = { LN: /LEN/, LT: /LEN/, CT: /CCA.*R[+-]/, LCT: /\sR[+-]/ }[ty];
      if (!need.test(rest) || (fn === 'APPR' && (!/\sR[LR]\b/.test(rest) || !/\sX/.test(rest) || !/\sY/.test(rest))) || (fn === 'DEP' && ty === 'LCT' && !/\sX/.test(rest))) add(k, 'hhAppr');
      if (!tool) add(k, 'hhTool');
      continue;
    }
    if (/^CC\b/.test(u)) { if (!/^CC(\s+[XY][+-]?\d*\.?\d+)+$/.test(u)) add(k, 'hhWord'); cc = true; continue; }
    const wordsOk = t => /^(\s+(I?[XYZABC]|IPA|PA|IZ|PR|IPR)[+-]?\d*\.?\d+|\s+DR[+-]|\s+R[0LR]|\s+FMAX|\s+FAUTO|\s+FQ\d+|\s+F\d*\.?\d+|\s+M\d+)*$/.test(t);
    if ((m = u.match(/^(L|C|CP|CR|CT|LP)\b(.*)$/))) {
      const [, w, rest] = m;
      if (!wordsOk(rest)) add(k, 'hhWord');
      if ((w === 'C' || w === 'CP') && !cc) add(k, 'hhCC');
      if ((w === 'C' || w === 'CP' || w === 'CR') && !/DR[+-]/.test(rest)) add(k, 'hhDR');
      if (/\bM99\b/.test(rest) && !cycDef) add(k, 'hhCall');
      if (!tool && w !== 'L') add(k, 'hhTool');
      else if (!tool && /\sF(\d|Q)/.test(rest) && !/FMAX/.test(rest)) add(k, 'hhTool');
      continue;
    }
    add(k, 'hhWord');
  }
  if (cyc) add(cyc.k, 'hhCyc');
  if (!begin || !begin.closed) add(begin ? begin.k : 0, 'hhPgm');
  return issues;
}

const ncPlot = new THREE.Group();
vp.scene.add(ncPlot);
function ncViewer(results) {
  document.querySelector('.nc-win')?.remove();
  vp.clear(ncPlot);
  let i = 0, cur = -1, timer = null;
  const win = h('div', { class: 'nc-win' });
  const tabs = h('div', { class: 'nc-tabs' }), warn = h('div', { class: 'nc-warn' });
  const code = h('div', { class: 'nc-code no-i18n', tabindex: '0' });
  const info = h('div', { class: 'nc-info' });
  const slider = h('input', { type: 'range', min: 0, max: 0, value: 0, class: 'nc-slider' });
  const search = h('input', { type: 'search', class: 'twl-search', placeholder: 'Suchen (Enter = weiter)' });
  let pts = [], toolOf = new Map(), M = null, origin = null, lines = [], issues = [], editing = false;
  const issueBox = h('div', { class: 'nc-issues' });
  const close = () => { clearInterval(timer); win.remove(); vp.clear(ncPlot); };
  // colours for words: G (motion) blue, M orange, coordinates green, feed / speed violet, comments grey
  const colour = line => {
    const esc = t => t.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);
    const cm = line.match(/(\(.*\)|;.*)$/);
    const body = cm ? line.slice(0, cm.index) : line;
    const html = esc(body).replace(/\b([GM])(\d+(?:\.\d+)?)/g, (m, a, b) => `<span class="${a === 'G' ? 'ncg' : 'ncm'}">${a}${b}</span>`)
      .replace(/(^|\s)([XYZIJKRABC])\s*([+-]?\d*\.?\d+)/g, (m, s, a, b) => `${s}<span class="ncc">${a}${b}</span>`)
      .replace(/(^|\s)([FST])\s*([+-]?\d*\.?\d+)/g, (m, s, a, b) => `${s}<span class="ncf">${a}${b}</span>`)
      .replace(/\b(TOOL CALL|FMAX|CYCL DEF|CALL|BLK FORM|BEGIN PGM|END PGM|L|CC|CP|C)\b/g, '<span class="ncg">$1</span>');
    return html + (cm ? `<span class="ncx">${esc(cm[0])}</span>` : '');
  };
  const show = () => {
    const r = results[i];
    clearInterval(timer);
    lines = r.code.split('\n');
    warn.replaceChildren(...r.warnings.map(w => h('div', null, '⚠ ' + w)));
    tabs.replaceChildren(...results.map((x, k) => h('button', { class: k === i ? 'on' : '', onclick: () => { i = k; show(); } }, x.file)));
    code.innerHTML = lines.map((l, k) => `<div class="ncl" data-k="${k}"><i>${k + 1}</i>${colour(l) || '&nbsp;'}</div>`).join('');
    tabs.replaceChildren(...results.map((x, k) => h('button', { class: k === i ? 'on' : '', onclick: () => { i = k; editing = false; show(); } }, x.file + (x.edited ? ' ●' : ''))));
    // backplot: NC coordinates → setup frame (+ origin) → world
    const g = r.gen;
    const lathe = g?.kind === 'turn';
    let kinInfo = null, kinWhy = null;
    if (g?.stock && lathe) {
      origin = { x: 0, y: 0, z: g.stock.modelTop };
      M = new THREE.Matrix4();
      pts = parseNcLathe(r.code);
      toolOf = new Map(state.project.cam.tools.map(t => [+t.number, t]));
      try { issues = ncLatheCheck(g, pts); } catch (e) { console.warn(e); issues = []; }
    } else if (g?.stock) {
      origin = originOf(g.setup, g.stock);
      M = g.T.clone().invert();
      const fam = String(r.postId || state.project.post.flavor);
      const tools = state.project.cam.tools;
      // Klartext also for own copies of the Heidenhain post (their id does not start with "heidenhain")
      const hhCode = fam.startsWith('heidenhain') || /^\s*\d*\s*BEGIN PGM\b/m.test(r.code);
      pts = parseNcPositions(r.code, hhCode, n => (+tools.find(t => +t.number === +n)?.dia || 0) / 2);
      toolOf = new Map(tools.map(t => [+t.number, t]));
      try { issues = ncCollisions(g, pts); } catch { issues = []; }
      if (hhCode) try { issues.push(...ncHeidenhainCheck(r.code)); } catch (e) { console.warn(e); }
      try { const mc = ncMachineCheck(g, pts); issues.push(...mc.issues); kinInfo = mc.info; kinWhy = mc.why; } catch (e) { console.warn(e); }
      const nA = pts.filter(p => p?.a != null && Math.abs((((p.a % 360) + 540) % 360) - 180) < 179.999).length;
      // 4-axis program on a cylinder stock: all lines (also the 3-axis ones) are checked on the cylinder below;
      // the flat height field only keeps the clamping devices
      if (nA && [...(g.results?.values() || [])].some(x => x?.rotary && !x.error)) issues = issues.filter(is => !['holder', 'shank', 'rapid', 'contour', 'probe'].includes(is.kind));
      if (nA) {
        let rotIssues = null;
        try { rotIssues = ncRotaryCheck(g, pts); issues.push(...rotIssues); } catch (e) { console.warn(e); }
        kinInfo = `${kinInfo ? kinInfo + ' · ' : ''}${nA} Zeilen 4-achsig (A)${rotIssues ? ': gegen ein Zylinder-Rohteil um die A-Achse und das Teil geprüft' : ''}`;
      }
    } else { pts = []; M = null; issues = []; }
    for (const is of issues) code.children[is.k]?.classList.add('bad');
    const byKind = {};
    for (const is of issues) (byKind[is.kind] ||= []).push(is);
    issueBox.replaceChildren(...(kinInfo ? [h('div', { class: 'nc-kin' }, '⟲ ' + kinInfo)] : []), ...(kinWhy ? [h('div', { class: 'nc-issue' }, '⚠ ' + kinWhy)] : []), ...(!M ? [] : issues.length
      ? Object.entries(byKind).map(([kind, list]) => h('div', { class: 'nc-issue' }, `⚠ ${NC_ISSUE[kind]}: `, ...list.slice(0, 12).map(is => h('a', { onclick: () => go(is.k) }, `Z. ${is.k + 1}`)), list.length > 12 ? ` … (${list.length})` : ''))
      : [h('div', { class: 'nc-ok' }, lathe ? '✓ Keine Kollision (Eilgänge, Futter, Fertigkontur, Schneidrichtung) – Zeile für Zeile gegen das jeweils verbliebene Rohteil geprüft'
        : `✓ Keine Kollision mit dem Material (Halter, Schaft, Eilgänge)${g.setup?.fixtures?.length ? ' und den Spannmitteln' : ''} – Zeile für Zeile gegen das jeweils verbliebene Rohteil geprüft`)]));
    slider.max = Math.max(0, lines.length - 1);
    slider.value = 0;
    cur = -1;
    go(firstMove());
  };
  const firstMove = () => Math.max(0, pts.findIndex(p => p));
  const world = p => {
    if (p.c != null) { const th = (p.c * Math.PI) / 180; p = { x: p.x * Math.cos(th), y: p.x * Math.sin(th), z: p.z }; }
    if (p.a) {
      const th = (p.a * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
      p = { x: p.x, y: p.y * c + p.z * s, z: -p.y * s + p.z * c };
    }
    return new THREE.Vector3(p.x + origin.x, p.y + origin.y, p.z + origin.z).applyMatrix4(M);
  };
  const go = k => {
    k = Math.max(0, Math.min(lines.length - 1, k));
    if (k === cur) return;
    cur = k;
    slider.value = k;
    tplUpdate?.();
    code.querySelector('.ncl.on')?.classList.remove('on');
    const el = code.children[k];
    el?.classList.add('on');
    if (el) { const top = el.offsetTop, h0 = code.clientHeight; if (top < code.scrollTop || top > code.scrollTop + h0 - 30) code.scrollTop = top - h0 / 3; }
    vp.clear(ncPlot);
    if (!M) { info.textContent = 'Kein Backplot (ohne Rohteil)'; return; }
    // path up to this line: feed yellow, rapids dashed; the rest faint
    const done = [], rap = [], rest = [];
    let last = null, at = null, tool = null;
    pts.forEach((p, n) => {
      if (!p) return;
      const w = world(p);
      if (last) {
        const arr = n <= k ? (p.rapid ? rap : done) : rest;
        let a = last;
        for (const q of p.arc || []) { const wq = world(q); arr.push(a, wq); a = wq; }
        arr.push(a, w);
      }
      last = w;
      if (n <= k) { at = w; tool = p.tool; }
    });
    const mk = (arr, mat) => { if (!arr.length) return; const l = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(arr), mat); if (mat.isLineDashedMaterial) l.computeLineDistances(); l.renderOrder = 24; ncPlot.add(l); };
    mk(rest, new THREE.LineBasicMaterial({ color: 0x8a949e, transparent: true, opacity: 0.25, depthTest: false }));
    mk(done, new THREE.LineBasicMaterial({ color: 0xf2c200, depthTest: false, transparent: true }));
    mk(rap, new THREE.LineDashedMaterial({ color: 0xe03131, dashSize: 2, gapSize: 1.5, depthTest: false, transparent: true }));
    for (const is of issues) {
      if (!is.at) continue; // syntax findings have no place in space
      const ball = new THREE.Mesh(new THREE.SphereGeometry(1.2, 10, 8), new THREE.MeshBasicMaterial({ color: 0xff2020, depthTest: false }));
      ball.position.copy(world(is.at));
      ball.renderOrder = 27;
      ncPlot.add(ball);
    }
    if (at) {
      // the tool at this line: a cylinder of its diameter along the tool axis of the setup
      const t = toolOf.get(+tool);
      if (results[i].gen?.kind === 'turn') {
        // lathe tool: the holder lies along +X from the tip, the insert above the tip in Z
        const wz = t?.type === 'groove' ? Math.max(1, +t.width || 3) : 8;
        const axial = ['turnbore', 'drill', 'center', 'spot'].includes(t?.type) || !!t?.internal, D = Math.max(1, +t?.dia || 6);
        const bar = new THREE.Mesh(axial ? new THREE.CylinderGeometry(D / 2, D / 2, 40, 20).rotateX(Math.PI / 2) : new THREE.BoxGeometry(30, 6, wz), new THREE.MeshStandardMaterial({ color: 0x5dade2, transparent: true, opacity: 0.55, depthTest: false }));
        if (axial) bar.position.set(at.x - (t.type === 'turnbore' || t.internal ? Math.max(0.5, 0.2 * D) + D / 2 : 0), at.y, at.z + 20);
        else bar.position.set(at.x + 15, at.y, at.z + (t?.type === 'groove' ? 0 : wz / 2));
        bar.renderOrder = 25;
        const tip = new THREE.Mesh(new THREE.SphereGeometry(0.7, 12, 8), new THREE.MeshBasicMaterial({ color: 0xe8590c, depthTest: false }));
        tip.position.copy(at);
        tip.renderOrder = 26;
        ncPlot.add(bar, tip);
        const p = pts.slice(0, k + 1).reverse().find(q => q);
        info.textContent = `Zeile ${k + 1} · X Ø${f2(2 * p.x)}  Z ${f2(p.z)}${t ? ` · T${t.number} ${t.name}` : ''}${p.rapid ? ' · Eilgang' : p.thread ? ' · Gewinde' : ''}`;
        return;
      }
      const d = Math.max(1, +t?.dia || 6), len = Math.max(20, d * 4);
      const axis = new THREE.Vector3(0, 0, 1).transformDirection(M).normalize();
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(d / 2, d / 2, len, 24), new THREE.MeshStandardMaterial({ color: 0x5dade2, transparent: true, opacity: 0.55, depthTest: false }));
      cyl.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), axis);
      cyl.position.copy(at).addScaledVector(axis, len / 2);
      cyl.renderOrder = 25;
      const tip = new THREE.Mesh(new THREE.SphereGeometry(Math.max(0.6, d * 0.12), 12, 8), new THREE.MeshBasicMaterial({ color: 0xe8590c, depthTest: false }));
      tip.position.copy(at);
      tip.renderOrder = 26;
      ncPlot.add(cyl, tip);
      const p = pts.slice(0, k + 1).reverse().find(q => q);
      info.textContent = `Zeile ${k + 1} · X ${f2(p.x)}  Y ${f2(p.y)}  Z ${f2(p.z)}${t ? ` · T${t.number} Ø${f2(t.dia)}` : ''}${p.rapid ? ' · Eilgang' : ''}`;
    } else info.textContent = `Zeile ${k + 1} · vor der ersten Bewegung`;
  };
  code.addEventListener('click', e => { const l = e.target.closest('.ncl'); if (l) go(+l.dataset.k); });
  code.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); go(cur + (e.key === 'ArrowDown' ? 1 : -1)); }
    if (e.key === 'PageDown' || e.key === 'PageUp') { e.preventDefault(); go(cur + (e.key === 'PageDown' ? 25 : -25)); }
  });
  slider.oninput = () => go(+slider.value);
  let lastHit = -1;
  search.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || !search.value) return;
    const q = search.value.toLowerCase();
    const k = lines.findIndex((l, n) => n > lastHit && l.toLowerCase().includes(q));
    const hit = k >= 0 ? k : lines.findIndex(l => l.toLowerCase().includes(q));
    if (hit < 0) return status(`„${search.value}“ nicht gefunden`);
    lastHit = hit;
    go(hit);
  });
  const play = h('button', { title: 'Abspielen / Anhalten', onclick: () => {
    if (timer) { clearInterval(timer); timer = null; play.textContent = '▶'; return; }
    play.textContent = '❚❚';
    timer = setInterval(() => { if (cur >= lines.length - 1) { clearInterval(timer); timer = null; play.textContent = '▶'; return; } go(cur + Math.max(1, Math.round(lines.length / 600))); }, 30);
  } }, '▶');
  // edit mode: the code as plain text; "Übernehmen" re-reads it for the backplot and the check
  const ta = h('textarea', { class: 'nc-edit', spellcheck: 'false' });
  // the template of the post processor that wrote the current line, opened in the post editor
  const tplBtn = h('button', { class: 'nc-editbtn', disabled: true, title: 'Die Vorlage des Postprozessors bearbeiten, die diese Zeile geschrieben hat', onclick: () => {
    const r = results[i], src = r.src?.[cur];
    if (!src || r.edited) return;
    postFocus = src; postWantFocus = src;
    openPostEditor(r.postId);
  } }, '✎ Vorlage');
  const tplUpdate = () => {
    const r = results[i], src = !r.edited && r.src?.[cur];
    tplBtn.disabled = !src;
    tplBtn.textContent = src ? `✎ Vorlage „${Object.fromEntries(SECTIONS)[src] || src}“` : '✎ Vorlage';
  };
  const editBtn = h('button', { class: 'nc-editbtn', onclick: () => {
    if (!editing) { editing = true; ta.value = results[i].code; code.replaceWith(ta); editBtn.textContent = 'Übernehmen'; ta.focus(); return; }
    editing = false;
    if (ta.value !== results[i].code) { results[i] = { ...results[i], code: ta.value, edited: true }; status('NC-Code geändert – Backplot und Prüfung neu.'); }
    ta.replaceWith(code);
    editBtn.textContent = 'Bearbeiten';
    show();
  } }, 'Bearbeiten');
  win.append(
    h('div', { class: 'modal-head nc-head' }, 'NC-PROGRAMM', h('button', { onclick: close }, '✕')),
    tabs, warn,
    h('p', { class: 'warn', style: 'margin:4px 12px' }, '⚠ Jedes NC-Programm vor dem ersten Lauf prüfen: an der Maschine im Probelauf (Einzelsatz, reduzierter Eilgang) oder in einem externen NC-Simulator. Die Simulation hier ersetzt das nicht – Nutzung auf eigene Gefahr, ohne Gewährleistung.'),
    h('div', { class: 'nc-bar' }, search, tplBtn, editBtn),
    issueBox,
    code,
    h('div', { class: 'nc-play' }, h('button', { title: 'Zum Anfang', onclick: () => go(firstMove()) }, '⏮'), play, slider, h('button', { title: 'Zum Ende', onclick: () => go(lines.length - 1) }, '⏭')),
    info,
    h('div', { class: 'modal-foot' },
      h('span', { class: 'hint', style: 'margin-right:auto' }, 'Zeile anklicken = Werkzeug im 3D-Fenster. Vor dem ersten Lauf an der Maschine prüfen.'),
      h('button', { onclick: () => navigator.clipboard.writeText(results[i].code).then(() => status('NC-Code kopiert')) }, 'Kopieren'),
      h('button', { onclick: () => download(results[i].file, results[i].code, 'text/plain') }, 'Herunterladen'),
      h('button', { class: 'primary', onclick: close }, 'Schließen')));
  document.body.append(win);
  show();
  code.focus();
}

function openPostDialog(saved = null) {
  document.querySelector('.post-back')?.remove();
  const p = state.project;
  const pp = p.post || {};
  const sid = activeSetupId();
  const g0 = getCam().setups.get(sid);
  // dialog state (stored in the project when the post runs)
  const d = {
    useMachine: saved?.useMachine ?? pp.useMachine ?? true,
    postId: saved?.postId || (pp.useMachine !== false && g0?.machine?.post) || pp.flavor,
    name: saved?.name ?? pp.programName ?? String(p.cam.setups.find(x => x.id === sid)?.programNumber || 1001),
    file: saved?.file ?? pp.fileName ?? '',
    comment: saved?.comment ?? pp.programComment ?? '',
    openEditor: saved?.openEditor ?? pp.openEditor ?? true,
    saveInDoc: !!saved,
    ops: new Set(saved?.ops || p.cam.ops.filter(o => o.setup === sid && o.enabled !== false).map(o => o.id)),
    props: JSON.parse(JSON.stringify(saved?.props || pp.props || {})),
    tab: 'settings',
  };
  const back = h('div', { class: 'modal-back post-back' });
  const close = () => back.remove();
  const left = h('div', { class: 'pd-left' }), right = h('div', { class: 'pd-right' });
  const tabBar = h('div', { class: 'pd-tabs' });
  const def = () => findPost(p, d.postId);
  const propVals = () => (d.props[d.postId] ||= {});
  const closedGroups = new Set(['probing', 'builtin']);

  const R = (label, ctl, help) => h('div', { class: 'pd-row' }, h('label', { title: help || '' }, label), h('div', { class: 'pd-ctl' }, ctl));
  const CB = (v, on) => { const i = h('input', { type: 'checkbox' }); i.checked = !!v; i.onchange = () => on(i.checked); return i; };
  const TX = (v, on, ph = '') => { const i = h('input', { type: 'text', value: v ?? '', placeholder: ph }); i.oninput = () => on(i.value); return i; };
  const SL = (opts, v, on) => { const s = h('select', null, ...opts.map(([k, l]) => h('option', { value: k }, l))); s.value = String(v); s.onchange = () => on(s.value); return s; };

  const drawLeft = () => {
    const dd = def();
    if (d.tab === 'ops') {
      left.replaceChildren(h('div', { class: 'pd-title' }, 'Operationen'),
        h('p', { class: 'hint' }, 'Häkchen = wird ausgegeben. Mehrere Setups ergeben je ein NC-Programm.'),
        ...p.cam.setups.map(st => {
          const ops = p.cam.ops.filter(o => o.setup === st.id);
          const all = ops.length && ops.every(o => d.ops.has(o.id));
          return h('div', { class: 'pd-setup' },
            h('label', { class: 'pd-check' }, CB(all, v => { ops.forEach(o => (v ? d.ops.add(o.id) : d.ops.delete(o.id))); drawLeft(); }), h('b', null, st.name)),
            ...ops.map(o => {
              const r = getCam().results.get(o.id);
              return h('label', { class: 'pd-check pd-op' + (o.enabled === false || r?.error ? ' off' : '') }, CB(d.ops.has(o.id), v => { v ? d.ops.add(o.id) : d.ops.delete(o.id); drawLeft(); }),
                h('span', null, o.name), r?.error ? h('small', { class: 'err' }, ' (Fehler)') : o.enabled === false ? h('small', { class: 'hint' }, ' (deaktiviert)') : null);
            }));
        }));
      return;
    }
    const posts = allPosts(p).filter(x => !!x.lathe === (g0?.setup?.kind === 'turn') || x.id === d.postId);
    const dirLabel = outDir ? outDir.name : 'Downloads (Browser)';
    left.replaceChildren(...[
      h('div', { class: 'pd-title' }, 'Maschine und Postprozessor'),
      R('Maschinenkonfiguration verwenden', CB(d.useMachine, v => { d.useMachine = v; if (v && g0?.machine?.post) d.postId = g0.machine.post; drawLeft(); drawRight(); }), 'Postprozessor und Grenzen aus der Maschine des Setups'),
      R('Postprozessor', h('div', { class: 'pd-inline' },
        SL(posts.map(x => [x.id, x.name + (x.builtin ? '' : ' (eigen)')]), d.postId, v => { d.postId = v; drawLeft(); drawRight(); }),
        h('button', { class: 'pd-ico', title: 'Postprozessor bearbeiten', onclick: () => { close(); openPostEditor(d.postId); } }, '✎'),
        h('button', { class: 'pd-ico', title: 'Postprozessor importieren (.cps / .json)', onclick: () => $('#postFileInput').click() }, '📂'))),
      g0?.machine ? R('Maschine', h('span', null, g0.machine.name)) : null,
      h('div', { class: 'pd-title' }, 'Programm'),
      R('Name/Nummer', TX(d.name, v => { d.name = v; fileIn.placeholder = v || 'Programm'; })),
      R('Dateiname', (() => { const i = TX(d.file, v => (d.file = v), d.name || 'Programm'); return i; })()),
      R('Kommentar', TX(d.comment, v => (d.comment = v))),
      R('Ausgabeordner', h('div', { class: 'pd-inline' }, h('span', { class: 'pd-path', title: dirLabel }, dirLabel),
        window.showDirectoryPicker ? h('button', { class: 'pd-ico', title: 'Ordner wählen', onclick: async () => { try { await rememberDir(await window.showDirectoryPicker({ mode: 'readwrite' })); drawLeft(); } catch { /* cancelled */ } } }, '📂') : null,
        outDir ? h('button', { class: 'pd-ico', title: 'Wieder in Downloads speichern', onclick: async () => { await rememberDir(null); drawLeft(); } }, '✕') : null)),
      R('NC-Erweiterung', h('span', { class: 'hint' }, '.' + (dd.ext || 'nc'))),
      R('Einheit', SL([['mm', 'Millimeter']], 'mm', () => {})),
      R('NC-Datei im Editor öffnen', CB(d.openEditor, v => (d.openEditor = v))),
      h('div', { class: 'pd-title' }, 'Im Dokument speichern'),
      R('NC-Programm erstellen', CB(d.saveInDoc, v => (d.saveInDoc = v)), 'Einstellungen als NC-Programm im Browser speichern'),
    ].filter(Boolean));
    const fileIn = left.querySelectorAll('.pd-row input[type=text]')[1];
  };

  const drawRight = () => {
    const dd = def(), vals = postProps(dd, propVals());
    right.replaceChildren(h('div', { class: 'pd-title' }, 'Postprozessor-Eigenschaften'));
    for (const [gk, gl] of POST_PROP_GROUPS) {
      const props = POST_PROPS.filter(x => x.group === gk && propApplies(x, dd));
      if (!props.length) continue;
      const open = !closedGroups.has(gk);
      right.append(h('div', { class: 'pd-group', onclick: () => { open ? closedGroups.add(gk) : closedGroups.delete(gk); drawRight(); } }, h('span', { class: 'pd-tw' }, open ? '▾' : '▸'), gl));
      if (!open) continue;
      for (const pr of props) {
        const ty = propType(pr, dd), v = vals[pr.key];
        const set = x => { propVals()[pr.key] = x; };
        const changed = propVals()[pr.key] != null && propVals()[pr.key] !== postProps(dd, {})[pr.key];
        const ctl = ty === 'bool' ? CB(v, set) : ty === 'num' ? (() => { const i = h('input', { type: 'number', value: v, step: 'any' }); i.onchange = () => set(+i.value); return i; })()
          : ty === 'text' ? TX(v, set) : SL(ty, v, set);
        right.append(h('div', { class: 'pd-row pd-prop' + (changed ? ' changed' : '') }, h('label', { title: pr.help || '' }, pr.label), h('div', { class: 'pd-ctl' }, ctl)));
      }
    }
    right.append(h('p', { class: 'hint', style: 'margin:10px 4px' }, 'Kühlmittel wählst du je Operation (Reiter Werkzeug). Werte in Blau wurden geändert.'));
  };

  const drawTabs = () => tabBar.replaceChildren(
    h('button', { class: d.tab === 'settings' ? 'on' : '', onclick: () => { d.tab = 'settings'; drawTabs(); drawLeft(); } }, 'Einstellungen'),
    h('button', { class: d.tab === 'ops' ? 'on' : '', onclick: () => { d.tab = 'ops'; drawTabs(); drawLeft(); } }, 'Operationen'));

  const run = async () => {
    const dd = def();
    const ext = dd.ext || 'nc';
    const rp = resolved();
    const cam = getCam();
    const setups = p.cam.setups.filter(st => p.cam.ops.some(o => o.setup === st.id && d.ops.has(o.id)));
    if (!setups.length) return status('Keine Operation ausgewählt (Reiter „Operationen“).');
    // remember the settings in the project
    commit(pp2 => {
      ensurePost(pp2, d.postId);
      pp2.post.flavor = d.postId;
      pp2.post.useMachine = d.useMachine;
      pp2.post.programName = d.name; pp2.post.fileName = d.file; pp2.post.programComment = d.comment; pp2.post.openEditor = d.openEditor;
      pp2.post.props = d.props;
      if (d.saveInDoc) {
        pp2.cam.ncPrograms ||= [];
        const rec = { id: saved?.id || uid('nc'), name: d.name || 'NC-Programm', postId: d.postId, useMachine: d.useMachine, file: d.file, comment: d.comment, openEditor: d.openEditor, ops: [...d.ops], props: d.props };
        const k = pp2.cam.ncPrograms.findIndex(x => x.id === rec.id);
        if (k >= 0) pp2.cam.ncPrograms[k] = rec; else pp2.cam.ncPrograms.push(rec);
      }
    }, 'meta');
    const out = [];
    for (const st of setups) {
      const g = cam.setups.get(st.id);
      if (!g?.stock) continue;
      const num = /^\d+$/.test(d.name.trim()) ? +d.name.trim() : undefined;
      const res = postProcess(rp, g, g.machine, { postId: d.postId, opIds: [...d.ops], programName: d.name || undefined, programNumber: num, comment: d.comment || undefined });
      const baseName = (d.file || d.name || safeName()).replace(/[\\/:*?"<>|]+/g, '_');
      const file = `${baseName}${setups.length > 1 ? '_' + st.name.replace(/[\\/:*?"<>|]+/g, '_') : ''}.${ext}`;
      const where = await writeOutput(file, res.code);
      out.push({ ...res, file, where, gen: g, postId: d.postId });
      lastPost = res;
    }
    close();
    status(out.map(r => `${r.file} ${r.where}`).join(' · '));
    if (d.openEditor || out.some(r => r.warnings.length)) ncViewer(out);
  };

  back.append(h('div', { class: 'pd' },
    h('div', { class: 'pd-head' }, tabBar, h('span', { style: 'flex:1' }), h('button', { class: 'pd-x', title: 'Schließen', onclick: close }, '✕')),
    h('div', { class: 'pd-main' }, left, right),
    h('div', { class: 'pd-foot' }, h('button', { class: 'primary', onclick: run }, 'Postprozessor'), h('button', { onclick: close }, 'Abbrechen'))));
  back.addEventListener('keydown', e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } });
  document.body.append(back);
  drawTabs(); drawLeft(); drawRight();
}

// ---------- boot ----------
(async () => {
  try {
    await Promise.all([loadKernel(), loadFonts().catch(err => console.warn('Schriften nicht geladen', err))]);
  } catch (err) {
    $('#loadingText').textContent = 'CAD-Kern konnte nicht geladen werden: ' + (err.message || err) + ' – WerkFab neu starten.';
    return;
  }
  // chosen geometry kernel (OpenCascade stays loaded for STEP/IGES import and as fallback)
  if ((getSettings().kernel || 'occ') !== 'occ') {
    try { await setActiveKernel(getSettings().kernel); } catch (err) { console.warn('Geometriekern nicht geladen', err); kernelFailed.add(getSettings().kernel); }
  }
  $('#loading').hidden = true;
  const saved = loadSaved();
  if (saved) await loadBlobs(saved);
  applySettings();
  setProject(saved && Array.isArray(saved.features) ? migrate(saved) : getSettings().startExample ? migrate(exampleProject()) : freshProject());
  if (!state.project.docId) { ensureDocId(state.project); persist(); }
  addTab(state.project);
  cleanSnap.set(state.project.docId, JSON.stringify(state.project));
  renderDocTabs();
  storeCurrent(state.project).catch(() => {});
  if (getSettings().startWorkspace === 'cam' && state.workspace !== 'cam') { $('#workspace').value = 'cam'; $('#workspace').dispatchEvent(new Event('change')); }
  applyTheme();
  fitView();
  initUpdates(status);
  // steps waiting for the full kernel (delete face, fillet with radius points) are computed as soon as it is there
  onFullKernel(() => { clearTimelineCache(); model.key = null; renderAll(); });
})();
