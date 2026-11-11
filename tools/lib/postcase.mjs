// One CAM project with every kind of NC output (moves, arcs, helices, leads with compensation, all drilling
// cycles, pocket / stud / slot cycles, hole patterns, touch probe, a second tilted setup): shared by the post tests.
import { testProject } from './testpart.mjs';

const XY = z => ({ o: [0, 0, z], x: [1, 0, 0], n: [0, 0, 1] });

export function project() {
  const p = testProject();
  p.features.push(
    { id: 'skBig', type: 'sketch', name: 'Große Bohrungen', plane: XY(10), entities: [[100, 60], [100, 70], [112, 65]].map(([cx, cy], i) => ({ id: 'g' + i, type: 'circle', cx, cy, r: 5 })) },
    { id: 'skSlot', type: 'sketch', name: 'Nut', plane: XY(10), entities: [{ id: 's1', type: 'slot', cx: 100, cy: 8, len: 12, w: 7, rot: 0 }] },
    { id: 'skCirc', type: 'sketch', name: 'Lochkreis', plane: XY(10), entities: Array.from({ length: 6 }, (_, i) => ({ id: 'k' + i, type: 'circle', cx: +(62 + 26 * Math.cos((i * Math.PI) / 3)).toFixed(6), cy: +(40 + 26 * Math.sin((i * Math.PI) / 3)).toFixed(6), r: 2 })) },
    { id: 'skOne', type: 'sketch', name: 'Einzelbohrung', plane: XY(10), entities: [{ id: 'o1', type: 'circle', cx: 45, cy: 8, r: 3.4 }] },
    { id: 'skRound', type: 'sketch', name: 'Kreistasche', plane: XY(10), entities: [{ id: 'r1', type: 'circle', cx: 70, cy: 10, r: 6 }] },
  );
  p.cam.tools.push(
    { id: 'P1', number: 20, name: 'Taster', type: 'probe', dia: 4, rpm: 0, feed: 500, plunge: 300, stepdown: 1, stepover: 0.5 },
    { id: 'R1', number: 21, name: 'Reibahle Ø6,8H7', type: 'ream', dia: 6.8, rpm: 400, feed: 80, plunge: 80, stepdown: 1, stepover: 0.5 },
  );
  // second setup: machined from the front (tilted plane)
  p.cam.setups.push({ ...p.cam.setups[0], id: 'S2', name: 'Vorne', orientation: 'front' });
  return p;
}

const o = { setup: 'S1', enabled: true, entities: 'all' };
const deep = { heights: { bottom: { from: 'top', offset: -8 }, top: { from: 'pick', z: 10, offset: 0 } } };
export const OPS = [
  { ...o, id: 'pz', name: 'Antasten Z', type: 'probe', tool: 'P1', probeMode: 'z', sketch: 'skOut' },
  { ...o, id: 'fa', name: 'Planen', type: 'face', tool: 'T1' },
  { ...o, id: 'c1', name: 'Kontur gerechnet', type: 'contour', tool: 'T1', sketch: 'skBoss', side: 'outside', leadIn: 3 },
  { ...o, id: 'c2', name: 'Kontur RL Bogen', type: 'contour', tool: 'T1', sketch: 'skBoss', side: 'outside', compType: 'control', leadIn: 4, leadLinear: 2 },
  { ...o, id: 'c3', name: 'Kontur RL senkrecht', type: 'contour', tool: 'T1', sketch: 'skBoss', side: 'outside', compType: 'control', leadIn: 0, leadInOn: true, leadLinear: 5, leadPerp: true },
  { ...o, id: 'c4', name: 'Kontur RR ohne Anfahrt', type: 'contour', tool: 'T1', sketch: 'skBoss', side: 'outside', compType: 'control', direction: 'conventional' },
  { ...o, id: 'c5', name: 'Kontur Verschleiss Stege', type: 'contour', tool: 'T1', sketch: 'skBoss', side: 'outside', compType: 'wear', leadIn: 3, tabs: true, tabCount: 4, tabWidth: 5, tabHeight: 1.5 },
  { ...o, id: 'c6', name: 'Zapfen Zyklus', type: 'contour', tool: 'T1', sketch: 'skBoss', side: 'outside', ctrlCycle: true },
  { ...o, id: 'p1', name: 'Tasche Bahn Helix', type: 'pocket', tool: 'T1', sketch: 'skPocket', ramp: 3 },
  { ...o, id: 'p2', name: 'Tasche Zyklus Rechteck', type: 'pocket', tool: 'T1', sketch: 'skPocket', ctrlCycle: true },
  { ...o, id: 'p3', name: 'Tasche Zyklus Kreis', type: 'pocket', tool: 'T2', sketch: 'skRound', ctrlCycle: true, ...deep },
  { ...o, id: 'p4', name: 'Nut Zyklus', type: 'pocket', tool: 'T2', sketch: 'skSlot', ctrlCycle: true, ...deep },
  { ...o, id: 'ad', name: 'Adaptiv', type: 'adaptive', tool: 'T1', sketch: 'skPocket' },
  { ...o, id: 'd1', name: 'Bohren Raster', type: 'drill', tool: 'T3', sketch: 'skHoles', ...deep },
  { ...o, id: 'd2', name: 'Bohren Lochkreis Tiefloch', type: 'drill', tool: 'T3', sketch: 'skCirc', peck: 3, ...deep },
  { ...o, id: 'd3', name: 'Bohren Spanbruch', type: 'drill', tool: 'T3', sketch: 'skOne', cycle: 'chip', peck: 2, ...deep },
  { ...o, id: 'd4', name: 'Bohren Verweilen', type: 'drill', tool: 'T3', sketch: 'skOne', cycle: 'dwell', dwell: 0.5, ...deep },
  { ...o, id: 'd5', name: 'Kernloch', type: 'drill', tool: 'T8', sketch: 'skOne', ...deep },
  { ...o, id: 'd6', name: 'Reiben', type: 'drill', tool: 'R1', sketch: 'skOne', dwell: 0.2, ...deep },
  { ...o, id: 'd7', name: 'Gewindebohren', type: 'drill', tool: 'T7', sketch: 'skOne', pitch: 1.25, ...deep },
  { ...o, id: 'd8', name: 'Gewindebohren links', type: 'drill', tool: 'T7', sketch: 'skOne', pitch: 1.25, hand: 'left', ...deep },
  { ...o, id: 'd9', name: 'Ausdrehen', type: 'drill', tool: 'T3', sketch: 'skOne', cycle: 'bore', dwell: 0.3, ...deep },
  { ...o, id: 'ci', name: 'Zirkular', type: 'circular', tool: 'T1', sketch: 'skBig', ...deep },
  { ...o, id: 'bo', name: 'Bohrfraesen', type: 'bore', tool: 'T1', sketch: 'skBig', ...deep },
  { ...o, id: 'th', name: 'Gewindefraesen', type: 'thread', tool: 'T6', sketch: 'skBig', ...deep },
  { ...o, id: 'ch', name: 'Fase', type: 'chamfer', tool: 'T5', sketch: 'skBoss' },
  { ...o, id: 'pa', name: 'Parallel', type: 'parallel3d', tool: 'T4', boundary: 'box' },
  // manual NC lines, trochoidal slot, toolpath pattern, corner feed, plunge roughing
  { ...o, id: 'mn1', name: 'Hinweis', type: 'manual', manualKind: 'comment', manualText: 'Spaene entfernen' },
  { ...o, id: 'mn2', name: 'Halt', type: 'manual', manualKind: 'stop', manualText: 'Teil pruefen' },
  { ...o, id: 'mn3', name: 'Warten', type: 'manual', manualKind: 'dwell', manualSec: 1.5 },
  { ...o, id: 'mn4', name: 'Meldung', type: 'manual', manualKind: 'message', manualText: 'Nut messen' },
  { ...o, id: 'sl', name: 'Nut wirbelnd', type: 'slot', tool: 'T2', sketch: 'skSlot', slotStyle: 'trochoid', multiDepth: false, ...deep },
  { ...o, id: 'mn5', name: 'Wahlhalt', type: 'manual', manualKind: 'optstop' },
  { ...o, id: 'dp', name: 'Bohren Muster', type: 'drill', tool: 'T3', sketch: 'skOne', patKind: 'linear', patN1: 3, patDx1: 9, ...deep },
  { ...o, id: 'c7', name: 'Kontur Eckenvorschub Spiegel', type: 'contour', tool: 'T1', sketch: 'skBoss', side: 'outside', compType: 'control', leadIn: 3, feedOpt: true, feedOptAngle: 10, patKind: 'mirror', patAxis: 'x', patCx: 150 },
  { ...o, id: 'pl', name: 'Tauchschruppen', type: 'plunge3d', tool: 'T1', stockToLeave: 0.5, stepoverMm: 4, rowStep: 5 },
  { ...o, id: 'f2', name: 'Vorne Planen', type: 'face', tool: 'T1', setup: 'S2' },
  { ...o, id: 'pa2', name: 'Vorne Kontur 3D', type: 'contour3d', tool: 'T1', setup: 'S2' },
];

