// The example shaft with every lathe operation (turning, bore work, threads, driven tools on the C axis) as a mesh
// setup: shared by the lathe post tests. cycles = roughing / finishing / threading as control cycles.
import * as THREE from 'three';
import { exampleTurning } from '../../js/example.js';

export function turnCase(cycles = false) {
  const p = exampleTurning();
  p.machines = []; p.posts = [];
  const prof = p.features[0].entities[0].pts.map(([r, z]) => new THREE.Vector2(r, z));
  prof.push(prof[0].clone());
  const geo = new THREE.LatheGeometry(prof, 256);
  geo.rotateX(Math.PI / 2);
  const st = p.cam.setups[0];
  p.cam.tools.push(
    { id: 'L8', number: 18, name: 'Bohrer Ø2 angetrieben', type: 'drill', dia: 2, angle: 118, fluteLen: 15, length: 40, rpm: 4000, feed: 120, plunge: 80, stepdown: 1, stepover: 0.5 },
    { id: 'L9', number: 19, name: 'Schaftfräser Ø6 angetrieben', type: 'flat', dia: 6, flutes: 3, fluteLen: 16, length: 50, rpm: 3000, feed: 200, plunge: 60, stepdown: 1, stepover: 0.5 },
    { id: 'L10', number: 20, name: 'Schaftfräser Ø2 angetrieben', type: 'flat', dia: 2, flutes: 2, fluteLen: 6, length: 40, rpm: 6000, feed: 150, plunge: 50, stepdown: 1, stepover: 0.5 });
  // sketches for contours with the C axis: on the face (z = 70) and along the axis (plane y = 0, wrapped on Ø30)
  p.features.push(
    { id: 'skFace', type: 'sketch', name: 'Stirnkontur', hidden: true, plane: { o: [0, 0, 70], x: [1, 0, 0], n: [0, 0, 1] }, entities: [
      { id: 'f1', type: 'poly', closed: false, pts: [[6, -3], [8, 0], [6, 3]] },
      { id: 'f2', type: 'poly', closed: true, pts: [[-6, -2], [-8, -2], [-8, 2], [-6, 2]] }] },
    { id: 'skPock', type: 'sketch', name: 'Stirntasche', hidden: true, plane: { o: [0, 0, 70], x: [1, 0, 0], n: [0, 0, 1] }, entities: [
      { id: 'q1', type: 'poly', closed: true, pts: [[-2.5, 5.2], [2.5, 5.2], [2.5, 9.2], [-2.5, 9.2]] }] },
    { id: 'skWrap', type: 'sketch', name: 'Mantelkontur', hidden: true, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0] }, entities: [
      { id: 'w1', type: 'poly', closed: false, pts: [[-8, 12], [8, 26]] },
      { id: 'w2', type: 'poly', closed: false, pts: [[-10, 8], [10, 8]] }] },
    { id: 'skWPock', type: 'sketch', name: 'Manteltasche', hidden: true, plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, 1, 0] }, entities: [
      { id: 'wq1', type: 'poly', closed: true, pts: [[-9, -36], [9, -36], [9, -50], [-9, -50]] }] });
  const o = { setup: st.id, enabled: true };
  const part = p.cam.ops.pop();
  p.cam.ops.push(
    { ...o, id: 'lv1', type: 'tlive', tool: 'L8', name: 'Lochkreis axial', dir: 'axial', pitchDia: 14.5, count: 4, startAngle: 45, depth: 5, peck: 2 },
    { ...o, id: 'lv2', type: 'tlive', tool: 'L8', name: 'Querbohrungen', dir: 'radial', z: 15, angles: '0; 120; 240', depth: 8 },
    { ...o, id: 'ms1', type: 'tslot', tool: 'L9', name: 'Passfedernuten', zStart: 28, zEnd: 10, depth: 3, count: 2, startAngle: 0, stepdown: 1.5 },
    { ...o, id: 'mf1', type: 'tflat', tool: 'L9', name: 'Zweiflach SW16', width: 16, length: 8, count: 2, startAngle: 0 },
    { ...o, id: 'fc1', type: 'tcontour', tool: 'L10', name: 'Stirnkontur', sketch: 'skFace', entities: 'all', side: 'on', depth: 1.5, stepdown: 0.75 },
    { ...o, id: 'tp1', type: 'tpocket', tool: 'L10', name: 'Stirntasche', sketch: 'skPock', entities: 'all', depth: 2, stepdown: 1, ramp: 5 },
    { ...o, id: 'wr1', type: 'twrap', tool: 'L9', name: 'Mantelkontur', sketch: 'skWrap', entities: 'all', side: 'on', depth: 2, stepdown: 1 },
    { ...o, id: 'wp1', type: 'twpocket', tool: 'L9', name: 'Manteltasche', sketch: 'skWPock', entities: 'all', depth: 2, stepdown: 1, rampType: 'plunge' },
    { ...o, id: 'wp2', type: 'twpocket', tool: 'L9', name: 'Manteltasche Rampe', sketch: 'skWPock', entities: 'all', depth: 2, stepdown: 1, ramp: 4 },
    part);
  if (cycles) for (const op of p.cam.ops) if (['t2', 't3', 't5', 't10'].includes(op.id)) op.ctrlCycle = true;
  return { p, st, bodies: [{ id: 'shaft', geometry: geo.toNonIndexed() }] };
}
