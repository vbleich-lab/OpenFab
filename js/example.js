// Demo part: parametric plate with rounded pocket, counterbored holes and filleted
// top edge, plus a complete CAM setup.
import { newProject } from './state.js';

const XY = z => ({ o: [0, 0, z], x: [1, 0, 0], n: [0, 0, 1] });

// Demo turned part: stepped shaft with groove and M20×1.5 thread, revolved about Z.
export function exampleTurning() {
  const p = newProject();
  p.name = 'Beispiel Welle';
  p.features = [
    { id: 'sk1', type: 'sketch', name: 'Skizze1', hidden: true, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0] }, entities: [
      { id: 'pr', type: 'poly', closed: true, pts: [[0, 0], [15, 0], [15, 30], [12, 30], [12, 37.5], [10, 37.5], [10, 42.5], [12, 42.5], [12, 50], [10, 52], [10, 70], [4.45, 70], [4.45, 63], [5.2, 63], [5.2, 61], [4.45, 61], [4.45, 58], [0, 55.33]] },
    ] },
    { id: 'rv1', type: 'revolve', name: 'Rotation1', sketch: 'sk1', profiles: 'all', axis: 'y', angle: 360, op: 'new' },
  ];
  const st = p.cam.setups[0];
  Object.assign(st, { name: 'Drehen', kind: 'turn', stockDia: 34, marginTop: 1, marginBottom: 10, safeZ: 5, machine: null });
  p.cam.tools.push(
    { id: 'L1', number: 11, name: 'Drehmeißel DCMT R0,4', type: 'turn', dia: 12, noseRadius: 0.4, insertAngle: 55, leadAngle: 93, rpm: 2000, feed: 300, plunge: 150, stepdown: 1.5, stepover: 0.5 },
    { id: 'L2', number: 12, name: 'Stechmeißel 3 mm', type: 'groove', dia: 3, width: 3, rpm: 1000, feed: 60, plunge: 60, stepdown: 1, stepover: 0.5 },
    { id: 'L3', number: 13, name: 'Gewindedrehmeißel 60°', type: 'tthread', dia: 6, rpm: 800, feed: 1200, plunge: 1200, stepdown: 1, stepover: 0.5 },
    { id: 'L4', number: 14, name: 'Bohrer Ø6', type: 'drill', dia: 6, angle: 118, fluteLen: 30, length: 70, rpm: 1500, feed: 120, plunge: 90, stepdown: 1, stepover: 0.5 },
    { id: 'L5', number: 15, name: 'Bohrstange Ø5 R0,2', type: 'turnbore', dia: 5, noseRadius: 0.2, insertAngle: 55, leadAngle: 93, rpm: 1800, feed: 150, plunge: 80, stepdown: 0.5, stepover: 0.5 },
    { id: 'L6', number: 16, name: 'Innen-Stechmeißel 2 mm', type: 'groove', internal: true, dia: 6, width: 2, rpm: 1200, feed: 50, plunge: 40, stepdown: 1, stepover: 0.5 },
    { id: 'L7', number: 17, name: 'Innengewindemeißel 60°', type: 'tthread', internal: true, dia: 6, rpm: 600, feed: 600, plunge: 600, stepdown: 1, stepover: 0.5 },
  );
  const o = { setup: st.id, enabled: true };
  p.cam.ops = [
    { ...o, id: 't1', type: 'tface', name: 'Plandrehen', tool: 'L1', stepdown: 0.5 },
    { ...o, id: 't2', type: 'trough', name: 'Längsschruppen', tool: 'L1', stepdown: 1.5, stockToLeave: 0.3, zEnd: 0 },
    { ...o, id: 't3', type: 'tfinish', name: 'Konturschlichten', tool: 'L1', zEnd: 0 },
    { ...o, id: 't7', type: 'tdrill', name: 'Bohren Ø6', tool: 'L4', peck: 5, stockToLeave: 0.2 },
    { ...o, id: 't8', type: 'tbore', name: 'Innendrehen Ø8,9', tool: 'L5', stepdown: 0.5 },
    { ...o, id: 't9', type: 'tgroove', name: 'Innen-Einstich', tool: 'L6', z: 62, width: 2, dia: 10.4 },
    { ...o, id: 't10', type: 'tthread', name: 'Innengewinde M10×1', tool: 'L7', zStart: 70, zEnd: 62.5, majorDia: 10, pitch: 1, passes: 5 },
    { ...o, id: 't4', type: 'tgroove', name: 'Einstich', tool: 'L2', z: 40, width: 5, dia: 20 },
    { ...o, id: 't5', type: 'tthread', name: 'Gewinde M20×1,5', tool: 'L3', zStart: 70, zEnd: 54, majorDia: 20, pitch: 1.5, passes: 6 },
    { ...o, id: 't6', type: 'tpart', name: 'Abstechen', tool: 'L2' },
  ];
  p.post.flavor = 'fanuc-lathe';
  return p;
}

export function exampleProject() {
  const p = newProject();
  p.name = 'Beispiel Grundplatte';
  p.params = [
    { name: 'laenge', expr: '120' },
    { name: 'breite', expr: '80' },
    { name: 'dicke', expr: '15' },
  ];
  p.features = [
    { id: 'sk1', type: 'sketch', name: 'Skizze1', hidden: true, plane: XY(0), entities: [{ id: 'e1', type: 'rect', x: 0, y: 0, w: '=laenge', h: '=breite', r: 6 }] },
    { id: 'ex1', type: 'extrude', name: 'Extrusion1', sketch: 'sk1', profiles: 'all', distance: '=dicke', extent: 'one', op: 'new' },
    { id: 'sk2', type: 'sketch', name: 'Skizze2', hidden: true, plane: XY('=dicke'), entities: [{ id: 'e2', type: 'rect', x: 30, y: 22, w: '=laenge-60', h: '=breite-44', r: 5 }] },
    { id: 'ex2', type: 'extrude', name: 'Extrusion2', sketch: 'sk2', profiles: 'all', distance: -6, extent: 'one', op: 'cut' },
    {
      id: 'sk3', type: 'sketch', name: 'Skizze3', hidden: true, plane: XY('=dicke'), entities: [
        { id: 'h1', type: 'circle', cx: 12, cy: 12, r: 3 },
        { id: 'h2', type: 'circle', cx: '=laenge-12', cy: 12, r: 3 },
        { id: 'h3', type: 'circle', cx: '=laenge-12', cy: '=breite-12', r: 3 },
        { id: 'h4', type: 'circle', cx: 12, cy: '=breite-12', r: 3 },
      ],
    },
    { id: 'ho1', type: 'hole', name: 'Bohrung1', sketch: 'sk3', points: 'all', kind: 'cbore', dia: 6.6, through: true, depth: 15, cbDia: 11, cbDepth: 6.5, csDia: 12, csAngle: 90, tip: false },
    {
      // top outer edges of the plate (straight edges + corner arcs), referenced by midpoint
      id: 'fi1', type: 'fillet', name: 'Verrundung1', radius: 1.5, all: false, edges: [
        [60, 0, 15], [120, 40, 15], [60, 80, 15], [0, 40, 15],
        [118.243, 1.757, 15], [118.243, 78.243, 15], [1.757, 78.243, 15], [1.757, 1.757, 15],
      ],
    },
  ];
  p.cam.ops = [
    { id: 'op1', type: 'face', name: 'Planfräsen1', tool: 'T1', enabled: true, bottom: null, bottomOffset: 0 },
    { id: 'op2', type: 'pocket', name: '2D-Tasche1', tool: 'T1', sketch: 'sk2', entities: 'all', enabled: true, bottom: null, bottomOffset: 0, stockToLeave: 0, direction: 'climb', ramp: 3 },
    { id: 'op3', type: 'drill', name: 'Bohren1', tool: 'T3', sketch: 'sk3', entities: 'all', enabled: true, bottom: null, bottomOffset: -1, peck: 3 },
    { id: 'op4', type: 'contour', name: '2D-Kontur1', tool: 'T1', sketch: 'sk1', entities: 'all', enabled: true, side: 'outside', bottom: null, bottomOffset: -0.3, stockToLeave: 0, direction: 'climb', tabs: true, tabCount: 4, tabWidth: 6, tabHeight: 1.5, ramp: 0 },
  ];
  return p;
}
