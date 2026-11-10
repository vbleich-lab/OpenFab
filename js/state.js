import { t } from './i18n.js';
// Global app state, project data model, undo/redo and autosave.

export const state = {
  project: null,
  workspace: 'design',   // 'design' | 'cam'
  sel: null,             // { kind: 'feature'|'op'|'setup'|'tools'|'post', id }
  sketchId: null,        // sketch currently being edited
  pick: null,            // { mode: 'plane'|'edges'|'faces'|'measure', id }
  rollback: null,        // timeline marker: number of features replayed (null = all)
  camSetup: null,        // last active CAM setup id
  section: null,         // section analysis { axis, offset, flip }
  hiddenBodies: new Set(),
  snap: 1,
};

const listeners = [];
export const onChange = fn => listeners.push(fn);
export const emit = (reason = 'change') => listeners.forEach(fn => fn(reason));

const KEY = 'openfab.project.v1';
let undoStack = [];
let redoStack = [];
let undoLimit = 200;
export const setUndoLimit = n => { undoLimit = Math.max(10, Math.min(2000, Math.round(+n) || 200)); while (undoStack.length > undoLimit) undoStack.shift(); };

export const uid = (p = 'id') => p + '_' + Math.random().toString(36).slice(2, 9);

export function commit(fn, reason = 'edit') {
  undoStack.push(JSON.stringify(state.project));
  while (undoStack.length > undoLimit) undoStack.shift();
  redoStack = [];
  fn(state.project);
  persist();
  emit(reason);
}

export function undo() {
  if (!undoStack.length) return;
  redoStack.push(JSON.stringify(state.project));
  state.project = JSON.parse(undoStack.pop());
  persist();
  emit('undo');
}

export function redo() {
  if (!redoStack.length) return;
  undoStack.push(JSON.stringify(state.project));
  state.project = JSON.parse(redoStack.pop());
  persist();
  emit('redo');
}

export function setProject(p) {
  state.project = p;
  undoStack = [];
  redoStack = [];
  state.sel = null;
  state.sketchId = null;
  state.pick = null;
  state.rollback = null;
  state.camSetup = null;
  state.section = null;
  state.hiddenBodies.clear();
  persist();
  emit('load');
}

export function persist() {
  if (state.noAutosave) return;
  try { localStorage.setItem(KEY, JSON.stringify(state.project)); } catch { /* storage unavailable */ }
}

export function loadSaved() {
  try {
    const s = localStorage.getItem(KEY);
    return s ? JSON.parse(s) : null;
  } catch {
    return null;
  }
}

export const feature = id => state.project.features.find(f => f.id === id);
export const camOp = id => state.project.cam.ops.find(o => o.id === id);
export const camTool = id => state.project.cam.tools.find(t => t.id === id);

// default names (Skizze1, Extrusion2 …) in the language of the interface
export function nextName(list, base) {
  base = t(base);
  const names = new Set(list.map(x => x.name));
  let n = 1;
  while (names.has(base + n)) n++;
  return base + n;
}

export function defaultTools() {
  return [
    { id: 'T1', number: 1, name: 'Schaftfräser Ø6', type: 'flat', dia: 6, rpm: 12000, feed: 800, plunge: 250, stepdown: 1.5, stepover: 0.45 },
    { id: 'T2', number: 2, name: 'Schaftfräser Ø3', type: 'flat', dia: 3, rpm: 16000, feed: 500, plunge: 150, stepdown: 0.8, stepover: 0.4 },
    { id: 'T3', number: 3, name: 'Bohrer Ø6', type: 'drill', dia: 6, angle: 118, rpm: 3000, feed: 150, plunge: 150, stepdown: 2, stepover: 0.5 },
    { id: 'T4', number: 4, name: 'Kugelfräser R3', type: 'ball', dia: 6, rpm: 14000, feed: 1200, plunge: 300, stepdown: 1, stepover: 0.1 },
    { id: 'T5', number: 5, name: 'Fasenfräser 90°', type: 'chamfer', dia: 10, angle: 90, tip: 0.5, rpm: 10000, feed: 600, plunge: 200, stepdown: 1, stepover: 0.3 },
    { id: 'T6', number: 6, name: 'Gewindefräser Ø6', type: 'thread', dia: 6, rpm: 8000, feed: 300, plunge: 150, stepdown: 1, stepover: 0.3 },
    { id: 'T7', number: 7, name: 'Gewindebohrer M8', type: 'tap', dia: 8, pitch: 1.25, rpm: 300, feed: 375, plunge: 375, stepdown: 1, stepover: 0.3 },
    { id: 'T8', number: 8, name: 'Bohrer Ø6,8 (M8)', type: 'drill', dia: 6.8, angle: 118, rpm: 2800, feed: 140, plunge: 140, stepdown: 2, stepover: 0.5 },
  ];
}

export function defaultSetup(n = 1) {
  return { id: 'S' + n + '_' + Math.random().toString(36).slice(2, 6), name: 'Setup' + n, orientation: 'top', marginSide: 3, marginTop: 1, marginBottom: 0, origin: 'top-corner', safeZ: 10, retract: 3 };
}

export function newProject() {
  return {
    version: 2,
    name: 'Unbenannt',
    params: [],
    features: [],
    cam: {
      setups: [defaultSetup()],
      tools: defaultTools(),
      ops: [],
    },
    post: { flavor: 'grbl', lineNumbers: false, coolant: false, cycles: true },
    bodyMeta: {},
  };
}

// Bring older project files up to the current data model.
export function migrate(p) {
  p.params ||= [];
  p.bodyMeta ||= {};
  p.machines ||= [];
  p.posts ||= [];
  p.assembly ||= { placements: {}, joints: [] };
  for (const s of p.cam.setups) s.kind ||= 'mill';
  if (!p.cam.setups) {
    p.cam.setups = [{ ...defaultSetup(), ...(p.cam.setup || {}), name: 'Setup1', orientation: 'top' }];
    delete p.cam.setup;
  }
  for (const o of p.cam.ops) if (!p.cam.setups.some(s => s.id === o.setup)) o.setup = p.cam.setups[0].id;
  p.post = { coolant: false, cycles: true, ...p.post };
  for (const f of p.features) {
    if (f.type === 'sketch' && !f.plane) { f.plane = { o: [0, 0, +f.z || 0], x: [1, 0, 0], n: [0, 0, 1] }; delete f.z; }
  }
  const have = new Set(p.cam.tools.map(t => t.id));
  for (const t of defaultTools()) if (!have.has(t.id) && !p.cam.tools.some(x => x.number === t.number)) p.cam.tools.push(t);
  p.version = 2;
  return p;
}

// Command dialogs (Fusion-style OK / Abbrechen): remember the undo depth when a
// dialog opens and roll back to it on cancel.
export const undoDepth = () => undoStack.length;
export function revertTo(depth) {
  if (depth == null || depth >= undoStack.length) return false;
  while (undoStack.length > depth + 1) undoStack.pop();
  state.project = JSON.parse(undoStack.pop());
  redoStack = [];
  persist();
  emit('undo');
  return true;
}
