// User preferences ("Einstellungen"), stored per browser/app.
const KEY = 'openfab.settings.v1';

export const DEFAULTS = {
  // Allgemein
  autosave: true,
  confirmDelete: true,
  startExample: false,
  startWorkspace: 'design', // design | cam
  undoLimit: 200,
  updateCheck: true,        // ask GitHub for a new version at start
  toolbarLabels: true,
  hoverHighlight: true,
  accent: 'blue',           // blue | teal | green | orange | violet | red | pink | yellow | custom
  accentCustom: '#1487e0',  // for accent: 'custom'
  uiScale: 1,               // size of the whole interface (0.8 … 1.5)
  design: 'standard',       // standard (light / dark by "theme"), one of DESIGNS, or custom (the five colours below)
  customBg: '#161b22',      // own design: background of the window
  customPanel: '#1f2630',   //             panels and windows
  customText: '#e6ebf1',    //             text
  customLine: '#34404d',    //             lines and borders
  customTop: '#10151b',     //             title bar
  antialias: true,          // smooth edges in the 3D view (read when the program starts)
  groundShadow: false,      // soft shadow under the model
  sketchCoords: true,       // X / Y of the pointer while sketching
  corners: 'soft',          // square | soft | round
  density: 'normal',        // normal | compact | roomy
  uiFont: 'system',         // key of FONTS
  panelOpacity: 100,        // floating windows: 60 … 100 %
  iconColor: 'accent',      // accent | neutral | custom
  iconCustom: '#7f93a8',
  iconSize: 'normal',       // small | normal | large
  colorVision: 'off',       // off | redgreen | blueyellow: status colours that do not rely on red against green
  sketchEndView: 'fit',     // after a sketch: fit (isometric, everything) | back (the view before the sketch) | keep
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
  orbitAround: 'target',    // target (centre of the view) | origin | cursor (point of the model under the pointer)
  zoomSpeed: 1,
  invertPan: false,
  scrollPans: false,        // two-finger scroll moves the view, pinch / Ctrl + wheel zooms
  midDouble: 'fit',         // middle double-click: home | fit | off
  animViews: true,
  animSpeed: 1,
  doubleEsc: true,          // a sketch ends on the second Esc
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
  snapOffKey: 'alt',        // key that switches snapping off while it is held: alt | ctrl | none
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
  openfab: { label: 'WerkFab (links drehen, Mitte/rechts verschieben)' },
  fusion: { label: 'Fusion 360 (Mitte verschieben, Umschalt+Mitte drehen)' },
  solidworks: { label: 'SolidWorks (Mitte drehen, Strg+Mitte verschieben)' },
  inventor: { label: 'Inventor (Mitte verschieben, Umschalt+Mitte drehen)' },
  tinkercad: { label: 'Tinkercad (rechts drehen, Mitte verschieben)' },
  touchpad: { label: 'Touchpad (Umschalt + bewegen verschieben, Alt + bewegen drehen)' },
};

// accent colours: [light theme, dark theme]
export const ACCENTS = {
  blue: ['#1487e0', '#3fb0ff'], teal: ['#0c8f9c', '#35c6d4'], green: ['#2a8f4c', '#4fce7a'],
  orange: ['#d9730d', '#ff9d3c'], violet: ['#7357d6', '#a48bff'], red: ['#cf3d4a', '#ff6f7b'],
  pink: ['#c9388f', '#ff7cc4'], yellow: ['#a8870a', '#f2c230'],
};
// designs of the interface: name → base colour scheme (the colours are in css/style.css, [data-design])
export const DESIGNS = {
  graphite: 'dark', midnight: 'dark', forest: 'dark', ember: 'dark', contrastDark: 'dark',
  paper: 'light', slate: 'light', mint: 'light', contrastLight: 'light',
};
// fonts every system brings along (the app loads nothing from the net)
export const UI_FONTS = {
  system: '"Segoe UI", system-ui, sans-serif', arial: 'Arial, Helvetica, sans-serif', verdana: 'Verdana, Geneva, sans-serif', tahoma: 'Tahoma, Geneva, sans-serif',
  calibri: 'Calibri, Candara, "Segoe UI", sans-serif', trebuchet: '"Trebuchet MS", "Lucida Grande", sans-serif', georgia: 'Georgia, "Times New Roman", serif', mono: 'Consolas, "Cascadia Mono", "Courier New", monospace',
};

// named sets of preferences ("Profile"): e.g. laptop, large monitor, presentation
const PKEY = 'openfab.profiles.v1';
export function getProfiles() { try { const p = JSON.parse(localStorage.getItem(PKEY) || '{}'); return p && typeof p === 'object' ? p : {}; } catch { return {}; } }
export function saveProfile(name, values) { const p = getProfiles(); p[name] = { ...values }; try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { /* storage unavailable */ } }
export function deleteProfile(name) { const p = getProfiles(); delete p[name]; try { localStorage.setItem(PKEY, JSON.stringify(p)); } catch { /* storage unavailable */ } }

// what a design file carries (Einstellungen → Aussehen → Design als Datei)
export const LOOK_KEYS = ['design', 'theme', 'accent', 'accentCustom', 'iconColor', 'iconCustom', 'iconSize', 'corners', 'density', 'uiFont', 'panelOpacity', 'colorVision',
  'customBg', 'customPanel', 'customText', 'customLine', 'customTop', 'background', 'bgColor'];

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
