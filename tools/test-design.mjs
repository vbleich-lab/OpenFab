// Design helpers without a browser: moments of inertia from a mesh, scaling of sketch elements.
// Run: npm run test:design
import './lib/node-env.mjs';
const THREE = await import('three');
const { meshInertia } = await import('../js/mesh.js');
const { scaleEntity, translateEntity, rotateEntity } = await import('../js/profiles.js');

const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
const near = (a, b, rel = 1e-6) => Math.abs(a - b) <= rel * Math.max(1, Math.abs(b));

// ---- moments of inertia ----
{
  // box 40 x 20 x 10 with a corner at (5, 7, -3): I = V (b² + c²) / 12 about the centre
  const a = 40, b = 20, c = 10, g = new THREE.BoxGeometry(a, b, c).translate(5 + a / 2, 7 + b / 2, -3 + c / 2);
  const m = meshInertia(g), V = a * b * c;
  ok('Quader: Volumen und Schwerpunkt', near(m.volume, V) && near(m.com[0], 25) && near(m.com[1], 17) && near(m.com[2], 2), `${m.volume} mm³, ${m.com.map(v => +v.toFixed(4))}`);
  ok('Quader: Ixx, Iyy, Izz', near(m.I[0], (V * (b * b + c * c)) / 12) && near(m.I[1], (V * (a * a + c * c)) / 12) && near(m.I[2], (V * (a * a + b * b)) / 12), m.I.slice(0, 3).map(v => Math.round(v)).join(' / '));
  ok('Quader: keine Deviationsmomente', m.I.slice(3).every(v => Math.abs(v) < 1e-6 * V));
  // the same box without an index and turned inside out: same numbers
  const flipped = g.toNonIndexed();
  const p = flipped.attributes.position;
  for (let t = 0; t < p.count; t += 3) { const x = [p.getX(t + 1), p.getY(t + 1), p.getZ(t + 1)]; p.setXYZ(t + 1, p.getX(t + 2), p.getY(t + 2), p.getZ(t + 2)); p.setXYZ(t + 2, ...x); }
  const m2 = meshInertia(flipped);
  ok('Quader mit umgekehrten Dreiecken: gleiche Werte', near(m2.volume, V) && near(m2.I[0], m.I[0]) && near(m2.I[2], m.I[2]));
  // cylinder R 10, height 30 along Y (three.js): Iyy = V R² / 2, Ixx = V (3 R² + h²) / 12 – fine facets
  const R = 10, hgt = 30, cyl = meshInertia(new THREE.CylinderGeometry(R, R, hgt, 720, 1));
  const Vc = Math.PI * R * R * hgt;
  ok('Zylinder: Iyy = V·R²/2, Ixx = V·(3R² + h²)/12', near(cyl.volume, Vc, 1e-4) && near(cyl.I[1], (Vc * R * R) / 2, 1e-4) && near(cyl.I[0], (Vc * (3 * R * R + hgt * hgt)) / 12, 1e-4), `${cyl.I.slice(0, 3).map(v => Math.round(v)).join(' / ')}`);
  ok('Offenes Netz ohne Volumen: kein Ergebnis', meshInertia(new THREE.PlaneGeometry(10, 10)) === null);
}

// ---- scaling sketch elements ----
{
  const poly = { id: 'a', type: 'poly', closed: true, pts: [[0, 0], [10, 0], [10, 5], [0, 5]], radii: { 1: 1 }, chamfers: { 2: [0.5, 1] } };
  const s = scaleEntity(poly, 2, [0, 0]);
  ok('Skalieren: Linienzug mit Eckenradius und Fase', s.pts[2][0] === 20 && s.pts[2][1] === 10 && s.radii[1] === 2 && s.chamfers[2][0] === 1 && s.chamfers[2][1] === 2 && s.id === 'a' && poly.pts[2][0] === 10);
  const r = scaleEntity({ id: 'r', type: 'rect', x: 10, y: 10, w: 20, h: 10, r: 2 }, 0.5, [10, 10]);
  ok('Skalieren: Rechteck um seine Ecke', r.x === 10 && r.y === 10 && r.w === 10 && r.h === 5 && r.r === 1);
  const c = scaleEntity({ id: 'c', type: 'circle', cx: 4, cy: 0, r: 3 }, 3, [1, 0]);
  ok('Skalieren: Kreis um einen Fixpunkt', c.cx === 10 && c.cy === 0 && c.r === 9);
  const sl = scaleEntity({ id: 's', type: 'slot', cx: 0, cy: 0, len: 12, w: 4, rot: 30 }, 1.5);
  ok('Skalieren: Langloch behält die Drehung', sl.len === 18 && sl.w === 6 && sl.rot === 30);
  const el = scaleEntity({ id: 'e', type: 'ellipse', cx: 2, cy: 2, rx: 5, ry: 3 }, 2, [2, 2]);
  ok('Skalieren: Ellipse', el.cx === 2 && el.rx === 10 && el.ry === 6);
  const tx = scaleEntity({ id: 't', type: 'text', x: 1, y: 1, text: 'A', size: 10 }, 2);
  ok('Skalieren: Text', tx.x === 2 && tx.size === 20);
  // move and turn keep the id (in place) and give numbers
  const mv = translateEntity({ id: 'c', type: 'circle', cx: 4, cy: 0, r: 3 }, 5, -2), rt = rotateEntity({ id: 'p', type: 'poly', pts: [[1, 0], [2, 0]] }, 90, [0, 0]);
  ok('Verschieben und Drehen', mv.cx === 9 && mv.cy === -2 && mv.id === 'c' && Math.abs(rt.pts[1][0]) < 1e-12 && Math.abs(rt.pts[1][1] - 2) < 1e-12);
}

// ---- projection of a mesh onto a plane ----
{
  const { silhouette, planeCut, curveEntity, chainLoop } = await import('../js/projection.js');
  // box 40 x 20 x 10 with a corner at the origin; a square hole 10 x 10 through it along Z would need CSG – a plain box suffices
  const g = new THREE.BoxGeometry(40, 20, 10).translate(20, 10, 5), idx = g.index.array, pos = g.attributes.position.array;
  const tri = (t, k) => idx[t * 3 + k], nT = idx.length / 3;
  const top = i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2] - 4];           // plane z = 4, seen from above
  const side = i => [pos[i * 3], pos[i * 3 + 2], -(pos[i * 3 + 1] - 5)];        // plane y = 5 (XZ)
  const area = p => Math.abs(p.reduce((s, a, i) => { const b = p[(i + 1) % p.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
  const sil = silhouette(nT, tri, top);
  ok('Körperumriss eines Quaders von oben: ein Rechteck 40 × 20', sil.length === 1 && sil[0].pts.length === 4 && Math.abs(area(sil[0].pts) - 800) < 1e-3, `${sil[0]?.pts.length} Punkte`);
  const cut = planeCut(nT, tri, top), cutS = planeCut(nT, tri, side);
  ok('Schnitt bei Z 4: Rechteck 40 × 20; Schnitt bei Y 5: Rechteck 40 × 10', cut.length === 1 && cut[0].closed && Math.abs(area(cut[0].pts) - 800) < 1e-3 && cutS.length === 1 && Math.abs(area(cutS[0].pts) - 400) < 1e-3, `${cut[0]?.pts.length} / ${cutS[0]?.pts.length} Punkte`);
  ok('Ebene neben dem Körper: kein Schnitt', planeCut(nT, tri, i => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2] - 50]).length === 0);
  // a circle seen from above stays a circle, seen at 60° it becomes a closed curve, seen end-on nothing
  const ring = t => Array.from({ length: 65 }, (_, i) => { const a = (i / 64) * 2 * Math.PI; return [5 + 3 * Math.cos(a), 2 + 3 * Math.sin(a) * Math.cos(t), 3 * Math.sin(a) * Math.sin(t)]; });
  const c0 = curveEntity(ring(0)), c60 = curveEntity(ring(Math.PI / 3)), line = curveEntity([[0, 0, 0], [0, 0, 5]]);
  ok('Kante: Kreis bleibt Kreis, schräg gesehen eine Ellipse als Linienzug, von vorn gesehen nichts', c0.type === 'circle' && c0.cx === 5 && c0.cy === 2 && c0.r === 3 && c60.type === 'poly' && c60.closed && line === null, `${c60.pts.length} Punkte`);
  const loop = chainLoop([[[0, 0, 0], [4, 0, 0]], [[4, 3, 0], [4, 0, 0]], [[4, 3, 0], [0, 3, 0]], [[0, 3, 0], [0, 0, 0]]]);
  ok('Kanten einer Fläche in beliebiger Richtung werden zu einer Schleife', !!loop && loop.length === 5 && loop[2][0] === 4 && loop[2][1] === 3 && curveEntity(loop).pts.length === 4);
}
{
  const { curveEntity } = await import('../js/projection.js');
  const half = Array.from({ length: 65 }, (_, i) => { const a = (i / 64) * Math.PI; return [10 + 4 * Math.cos(a), 10 + 4 * Math.sin(a), 0]; });
  const e = curveEntity(half);
  ok('Kante: Halbkreis wird ein Drei-Punkt-Bogen', e.curve === 'arc' && e.pts.length === 3 && e.pts[0][0] === 14 && e.pts[1][1] === 14 && e.pts[2][0] === 6, JSON.stringify(e.pts));
}
