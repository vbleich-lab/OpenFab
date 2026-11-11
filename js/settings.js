// User preferences ("Einstellungen"), stored per browser/app.
const KEY = 'openfab.settings.v1';

export const DEFAULTS = {
  // Allgemein
  autosave: true,
  confirmDelete: true,
  startExample: false,
  startWorkspace: 'design', // design | cam
  undoLimit: 200,
  toolbarLabels: true,
  hoverHighlight: true,
  // Darstellung
  theme: 'system',          // system | light | dark
  background: 'gradient',   // gradient | light | dark | solid
  bgColor: '#e8ecf0',
  showGrid: true,
  showAxes: true,
  showViewCube: true,
  showNavBar: true,
  defaultDisplay: 'edges',  // edges | shaded | wire
  camera: 'perspective',    // perspective | ortho
  fov: 40,
  quality: 'high',          // high | normal | performance
  // Einheiten- und Wertanzeige
  decimals: 2,
  // Navigation
  mouse: 'openfab',         // openfab | fusion | solidworks | inventor | tinkercad
  invertZoom: false,
  zoomToCursor: true,
  orbitSpeed: 1,
  orbitMode: 'free',
  // SpaceMouse (3Dconnexion)
  spaceMouse: true,
  smSpeed: 1,
  smDeadzone: 0.04,
  smOffsets: [0, 0, 0, 0, 0, 0],
  smGain: [1, 1, 1, 1, 1, 1],
  smInv: [false, false, false, false, false, false],
  smInvertPan: false,
  smInvertZoom: false,
  smInvertRot: false,
  smDominant: false,
  smButton1: 'search',
  smButton2: 'fit',
  // Konstruktion
  snap: 1,
  defaultExtrude: 10,
  kernel: 'occ',            // occ | rust (Geometriekern)
  autoLookAt: true,
  sketchDims: true,
  sketchGlyphs: true,
  sketchFill: true,
  // Fertigung
  defaultPost: 'fanuc',
  defaultMachine: '',
  safeZ: 10,
  retract: 3,
  coolant: true,
  arcs: true,
  lineNumbers: false,
  simSpeed: 20,
};

export const MOUSE_PRESETS = {
  openfab: { label: 'Toolbahn (links drehen, Mitte/rechts verschieben)' },
  fusion: { label: 'Fusion 360 (Mitte verschieben, Umschalt+Mitte drehen)' },
  solidworks: { label: 'SolidWorks (Mitte drehen, Strg+Mitte verschieben)' },
  inventor: { label: 'Inventor (Mitte verschieben, Umschalt+Mitte drehen)' },
  tinkercad: { label: 'Tinkercad (rechts drehen, Mitte verschieben)' },
};

let cur = null;
export function getSettings() {
  if (cur) return cur;
  let saved = {};
  try { saved = JSON.parse(localStorage.getItem(KEY) || '{}') || {}; } catch { saved = {}; }
  cur = { ...DEFAULTS, ...saved };
  return cur;
}

export function saveSettings(patch) {
  cur = { ...getSettings(), ...patch };
  try { localStorage.setItem(KEY, JSON.stringify(cur)); } catch { /* storage unavailable */ }
  return cur;
}

export function resetSettings() {
  cur = { ...DEFAULTS };
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  return cur;
}
