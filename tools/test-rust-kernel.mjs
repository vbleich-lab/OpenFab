// Smoke test for the Rust kernel (node tools/test-rust-kernel.mjs)
import fs from 'fs';
import { loadBytes, call, mesh, boolean } from '../js/kern/rustwasm.js';

const wasm = new URL('../vendor/openfab-kernel/openfab_kernel.wasm', import.meta.url);
await loadBytes(fs.readFileSync(wasm));
const ok = (name, cond, extra = '') => { console.log((cond ? 'OK   ' : 'FEHL ') + name + (extra ? '  ' + extra : '')); if (!cond) process.exitCode = 1; };
const bb = h => call({ op: 'info', h }).bbox.map(p => p.map(v => +v.toFixed(2)));
const vol = h => +call({ op: 'volume', h }).toFixed(1);

console.log(call({ op: 'version' }));
const box = call({ op: 'box', x: 0, y: 0, z: 0, w: 100, d: 60, h: 20 });
ok('Quader Volumen', Math.abs(vol(box) - 120000) < 1, vol(box));
ok('Quader Hülle', JSON.stringify(bb(box)) === JSON.stringify([[0, 0, 0], [100, 60, 20]]), JSON.stringify(bb(box)));
const cyl = call({ op: 'cylinder', x: 50, y: 30, z: -5, r: 10, h: 30 });
ok('Zylinder Volumen', Math.abs(vol(cyl) - Math.PI * 100 * 30) < 30, vol(cyl));
const cut = boolean('cut', box, cyl);
ok('Bohrung (Ausschneiden)', Math.abs(vol(cut) - (120000 - Math.PI * 100 * 20)) < 40, vol(cut));
const inf = call({ op: 'info', h: cut });
ok('Flächen/Kanten', inf.faces.length >= 7 && inf.edges.length >= 12, `${inf.faces.length} Flächen, ${inf.edges.length} Kanten`);
const m = mesh(cut);
ok('Netz', m.triangles.length > 30 && m.faceGroups.length === inf.faces.length && m.edgeGroups.length === inf.edges.length,
  `${m.triangles.length / 3} Dreiecke, ${m.faceGroups.length} Gruppen, ${m.edgeGroups.length} Kanten`);
const join = boolean('or', box, call({ op: 'box', x: 90, y: 0, z: 0, w: 30, d: 20, h: 40 }));
ok('Verbinden (überlappend, koplanar)', Math.abs(vol(join) - (120000 + 30 * 20 * 40 - 10 * 20 * 20)) < 10, vol(join));
const plane = { o: [0, 0, 20], x: [1, 0, 0], n: [0, 0, 1] };
const rect = [{ t: 'M', p: [10, 10] }, { t: 'L', p: [40, 10] }, { t: 'L', p: [40, 30] }, { t: 'L', p: [10, 30] }, { t: 'L', p: [10, 10] }];
const hole = [{ t: 'M', p: [30, 20] }, { t: 'A', m: [25, 25], p: [20, 20] }, { t: 'A', m: [25, 15], p: [30, 20] }];
const ex = call({ op: 'extrude', plane, regions: [{ outer: rect, holes: [hole] }], from: 0, len: 15 });
ok('Extrusion mit Loch', Math.abs(vol(ex) - (600 - Math.PI * 25) * 15) < 10, vol(ex));
const exn = call({ op: 'extrude', plane, regions: [{ outer: rect, holes: [] }], from: 0, len: -5 });
ok('Extrusion negativ', Math.abs(vol(exn) - 3000) < 1 && bb(exn)[0][2] === 15, JSON.stringify(bb(exn)));
const rev = call({ op: 'revolve', plane: { o: [0, 0, 0], x: [1, 0, 0], n: [0, -1, 0] }, regions: [{ outer: [{ t: 'M', p: [5, 0] }, { t: 'L', p: [10, 0] }, { t: 'L', p: [10, 20] }, { t: 'L', p: [5, 20] }, { t: 'L', p: [5, 0] }], holes: [] }], axisO: [0, 0, 0], axisD: [0, 0, 1], angle: 360 });
ok('Rotation (Rohr)', Math.abs(vol(rev) - Math.PI * (100 - 25) * 20) < 40, vol(rev));
const sph = call({ op: 'sphere', x: 0, y: 0, z: 0, r: 10 });
ok('Kugel', Math.abs(vol(sph) - (4 / 3) * Math.PI * 1000) < 40, vol(sph));
const tor = call({ op: 'torus', R: 20, r: 5 });
ok('Torus', Math.abs(vol(tor) - 2 * Math.PI ** 2 * 20 * 25) < 80, vol(tor));
const mir = call({ op: 'transform', h: box, m: [-1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1] });
ok('Spiegeln', Math.abs(vol(mir) - 120000) < 1 && bb(mir)[0][0] === -100, JSON.stringify(bb(mir)));
const step = call({ op: 'step', hs: [cut] });
ok('STEP-Export', step.startsWith('ISO-10303-21') && step.includes('MANIFOLD_SOLID_BREP'), step.length + ' Zeichen');
call({ op: 'free', h: box });
let err = '';
try { call({ op: 'info', h: box }); } catch (e) { err = e.message; }
ok('Freigabe', /Ungültig/.test(err), err);
const same = call({ op: 'extrude', plane, regions: [{ outer: rect, holes: [] }], from: 0, len: 25 });
let r = null, e2 = '';
try { r = boolean('or', exn, same); } catch (e) { e2 = e.message; }
ok('Verbinden, gleiches Profil (alle Seiten koplanar)', r != null && Math.abs(vol(r) - 600 * 30) < 20, r != null ? vol(r) : e2);
