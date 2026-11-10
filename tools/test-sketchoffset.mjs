// Tests for the sketch offset tool (node tools/test-sketchoffset.mjs)
import { offsetPolyline, offsetCurves, offsetSide, offsetHit, offsetEntities } from '../js/sketchoffset.js';
const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
const J = JSON.stringify;
let idc = 0;
const newId = () => 'o' + ++idc;
const area = pts => Math.abs(pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
const r3 = pts => pts.map(p => p.map(v => +v.toFixed(3)));

// open polyline: left and right of its direction, mitred corner
const Lshape = [[0, 0], [10, 0], [10, 10]];
ok('Offener Linienzug nach links (innen an der Ecke)', J(r3(offsetPolyline(Lshape, false, 1))) === J([[0, 1], [9, 1], [9, 10]]), J(r3(offsetPolyline(Lshape, false, 1))));
ok('Offener Linienzug nach rechts (außen an der Ecke)', J(r3(offsetPolyline(Lshape, false, -1))) === J([[0, -1], [11, -1], [11, 10]]), J(r3(offsetPolyline(Lshape, false, -1))));
// every point of the offset keeps the distance to the original
{
  const src = [[0, 0], [12, 3], [20, -4], [31, 2]], off = offsetPolyline(src, false, 1.5);
  const dist = p => { let d = Infinity; for (let i = 0; i + 1 < src.length; i++) { const a = src[i], b = src[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy))); d = Math.min(d, Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy)); } return d; };
  let worst = 0;
  for (let i = 0; i + 1 < off.length; i++) for (let t = 0; t <= 1; t += 0.1) worst = Math.max(worst, Math.abs(dist([off[i][0] + (off[i + 1][0] - off[i][0]) * t, off[i][1] + (off[i + 1][1] - off[i][1]) * t]) - 1.5));
  ok('Versatz hält überall den Abstand (Ecken auf Gehrung liegen weiter außen)', off.length === 4 && worst < 0.45, `größte Abweichung ${worst.toFixed(3)} mm an den Gehrungsecken`);
}
// a very sharp corner is cut off instead of shooting out
{
  const off = offsetPolyline([[0, 0], [10, 0], [0, 1]], false, -1);
  ok('Sehr spitze Ecke wird abgeschnitten (zwei Punkte statt einer langen Gehrung)', off.length === 4 && Math.max(...off.map(p => p[0])) < 11.01, J(r3(off)));
}
// closed outlines: outwards and inwards, whatever their direction
for (const [name, pts] of [['gegen den Uhrzeigersinn', [[0, 0], [20, 0], [20, 10], [0, 10]]], ['im Uhrzeigersinn', [[0, 0], [0, 10], [20, 10], [20, 0]]]]) {
  const e = { id: 'p', type: 'poly', closed: true, pts };
  const out = offsetCurves(e, 2), inn = offsetCurves(e, -2);
  ok(`Geschlossene Kontur ${name}: +2 nach außen (24 × 14), −2 nach innen (16 × 6)`, out.length === 1 && Math.abs(area(out[0].pts) - 24 * 14) < 1e-6 && inn.length === 1 && Math.abs(area(inn[0].pts) - 16 * 6) < 1e-6, `${area(out[0]?.pts || []).toFixed(1)} / ${area(inn[0]?.pts || []).toFixed(1)} mm²`);
}
ok('Zu weit nach innen: keine Kontur', offsetCurves({ id: 'p', type: 'poly', closed: true, pts: [[0, 0], [20, 0], [20, 10], [0, 10]] }, -6).length === 0);
// entities: circle and plain rectangle keep their type
ok('Kreis bleibt Kreis', J(offsetEntities({ id: 'c', type: 'circle', cx: 5, cy: 5, r: 5 }, 2, newId).map(({ id, ...x }) => x)) === J([{ type: 'circle', cx: 5, cy: 5, r: 7 }]) && offsetEntities({ id: 'c', type: 'circle', cx: 5, cy: 5, r: 5 }, -6, newId).length === 0);
ok('Rechteck bleibt Rechteck', J(offsetEntities({ id: 'r', type: 'rect', x: 0, y: 0, w: 20, h: 10 }, 2, newId).map(({ id, ...x }) => x)) === J([{ type: 'rect', x: -2, y: -2, w: 24, h: 14 }]) && offsetEntities({ id: 'r', type: 'rect', x: 0, y: 0, w: 20, h: 10 }, -5, newId).length === 0);
ok('Rechteck mit Eckenradius: der Radius wächst mit', offsetEntities({ id: 'r', type: 'rect', x: 0, y: 0, w: 20, h: 10, r: 2 }, 1, newId)[0].r === 3);
{
  const line = { id: 'l', type: 'poly', closed: false, pts: [[0, 0], [10, 0]] }, res = offsetEntities(line, 1.5, newId);
  ok('Offene Linie wird ein offener Linienzug daneben', res.length === 1 && res[0].type === 'poly' && res[0].closed === false && J(res[0].pts) === J([[0, 1.5], [10, 1.5]]), J(res[0]?.pts));
}
// side and picking
{
  const sq = { id: 's', type: 'poly', closed: true, pts: [[0, 0], [20, 0], [20, 10], [0, 10]] }, line = { id: 'l', type: 'poly', closed: false, pts: [[30, 0], [40, 0]] };
  ok('Seite: innerhalb einer geschlossenen Kontur nach innen, außerhalb nach außen', offsetSide(sq, [10, 2]).sign === -1 && offsetSide(sq, [10, -2]).sign === 1 && Math.abs(offsetSide(sq, [10, -2]).d - 2) < 1e-9);
  ok('Seite: links und rechts einer offenen Linie', offsetSide(line, [35, 1]).sign === 1 && offsetSide(line, [35, -1]).sign === -1);
  const h = offsetHit([sq, line, { id: 't', type: 'text', x: 0, y: 0, text: 'x' }], [33, 1], 3);
  ok('Auswahl: die nächste Kontur innerhalb der Toleranz', h?.e.id === 'l' && h.sign === 1 && offsetHit([sq, line], [60, 60], 3) === null);
}

// ---- mirror (profiles.mirrorEntity) ----
{
  const { mirrorEntity } = await import('../js/profiles.js');
  const A = [0, 0], B = [0, 10]; // the Y axis
  const m1 = mirrorEntity({ id: 'c', type: 'circle', cx: 5, cy: 3, r: 2 }, A, B);
  ok('Spiegeln: Kreis an der Y-Achse', m1.type === 'circle' && m1.cx === -5 && m1.cy === 3 && m1.r === 2 && !('id' in m1), J(m1));
  const m2 = mirrorEntity({ id: 'p', type: 'poly', closed: false, pts: [[1, 0], [4, 0], [4, 5]], radii: { 1: 1 } }, A, B);
  ok('Spiegeln: Linienzug läuft andersherum, die Abrundung bleibt an ihrer Ecke', J(m2.pts) === J([[-4, 5], [-4, 0], [-1, 0]]) && J(m2.radii) === J({ 1: 1 }), J(m2));
  const m3 = mirrorEntity({ id: 'r', type: 'rect', x: 1, y: 1, w: 4, h: 2 }, [0, 0], [10, 10]);
  ok('Spiegeln: Rechteck an der Diagonalen wird ein geschlossener Linienzug 2 × 4', m3.type === 'poly' && m3.closed && Math.abs(area(m3.pts) - 8) < 1e-9 && Math.max(...m3.pts.map(q => q[1])) === 5, J(m3.pts));
  const twice = mirrorEntity({ id: 'x', ...mirrorEntity({ id: 's', type: 'slot', cx: 3, cy: 2, len: 6, w: 2, rot: 30 }, [0, 0], [1, 2]) }, [0, 0], [1, 2]);
  ok('Spiegeln: zweimal gespiegelt ergibt das Original (Langloch mit Drehlage)', Math.abs(twice.cx - 3) < 1e-3 && Math.abs(twice.cy - 2) < 1e-3 && Math.abs((((twice.rot - 30) % 360) + 360) % 360) < 1e-3, J(twice));
  ok('Spiegeln: Text wird nicht gespiegelt', mirrorEntity({ id: 't', type: 'text', x: 0, y: 0, text: 'a' }, A, B) === null);
}
