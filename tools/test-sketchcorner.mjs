// Tests for sketch fillets and chamfers (node tools/test-sketchcorner.mjs)
import { cornerPlan, cornerPts, applyCorners } from '../js/sketchcorner.js';
const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
const J = JSON.stringify, near = (a, b, t = 1e-6) => Math.abs(a[0] - b[0]) < t && Math.abs(a[1] - b[1]) < t;
let idc = 0;
const newId = () => 'c' + ++idc;
const area = pts => pts.reduce((s, p, i) => { const q = pts[(i + 1) % pts.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
const sq = { id: 'S', type: 'poly', closed: true, pts: [[0, 0], [20, 0], [20, 10], [0, 10]] };

// ---- geometry ----
{
  const e = { ...sq, radii: { 1: 3 } };
  const pl = cornerPlan(e), arc = pl.segs.find(s => s.k === 'A');
  ok('Abrundung: Bogen tangential (Mitte, Radius)', arc && near(arc.c, [17, 3]) && Math.abs(arc.r - 3) < 1e-9 && near(arc.a, [17, 0]) && near(arc.b, [20, 3]), J(arc));
  const A = area(cornerPts(e, 0.001)), exact = 200 - (9 - (Math.PI * 9) / 4);
  ok('Abrundung: Fläche = Rechteck − Eckzwickel', Math.abs(A - exact) < 0.005, `${A.toFixed(4)} / ${exact.toFixed(4)}`);
  const pts = cornerPts(e, 0.005);
  const worst = Math.max(...pts.map(p => (p[0] > 17 && p[1] < 3 ? Math.abs(Math.hypot(p[0] - 17, p[1] - 3) - 3) : 0)));
  // chord error between the points: centre-to-chord distance ≥ r − tol
  let sag = 0;
  for (let i = 0; i + 1 < pts.length; i++) { const a = pts[i], b = pts[i + 1]; if (a[0] >= 17 - 1e-9 && b[1] <= 3 + 1e-9 && a[1] < 3 && b[0] > 17) { const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; sag = Math.max(sag, 3 - Math.hypot(m[0] - 17, m[1] - 3)); } }
  ok('Abrundung: Punkte auf dem Kreis, Sehnenfehler ≤ 0,005', worst < 1e-9 && sag <= 0.005 + 1e-9, `Sehne ${sag.toFixed(4)}`);
}
{
  const e = { ...sq, chamfers: { 2: 2 } };
  const pts = cornerPts(e);
  ok('Fase gleichschenklig: Ecke (20,10) → (20,8)–(18,10)', pts.some(p => near(p, [20, 8])) && pts.some(p => near(p, [18, 10])) && !pts.some(p => near(p, [20, 10])), J(pts));
  ok('Fase: Fläche', Math.abs(area(pts) - (200 - 2)) < 1e-9, area(pts).toFixed(4));
  const e2 = { ...sq, chamfers: { 2: [1, 4] } }; // 1 along the edge to the previous vertex (20,0), 4 towards (0,10)
  const p2 = cornerPts(e2);
  ok('Fase ungleich (1 / 4)', p2.some(p => near(p, [20, 9])) && p2.some(p => near(p, [16, 10])), J(p2));
}
{
  // too big: both corners of the 10 mm edge shrink to 5 mm each
  const e = { ...sq, radii: { 1: 8, 2: 8 } };
  const pl = cornerPlan(e), arcs = pl.segs.filter(s => s.k === 'A');
  ok('zu groß: beide Radien gemeinsam verkleinert und gemeldet', arcs.length === 2 && arcs.every(a => Math.abs(a.r - 5) < 1e-9) && J(pl.clamped) === J([1, 2]), arcs.map(a => a.r).join(', '));
  ok('zu groß: keine Kante mit Länge 0', pl.segs.every(s => Math.hypot(s.b[0] - s.a[0], s.b[1] - s.a[1]) > 1e-9));
}
{
  // corner at vertex 0 of a closed polyline, and at a 60° corner of an open one
  const e = { ...sq, radii: { 0: 2 } };
  const pts = cornerPts(e);
  ok('Abrundung an Punkt 0 (geschlossen)', !pts.some(p => near(p, [0, 0])) && pts.some(p => near(p, [2, 0])) && pts.some(p => near(p, [0, 2])), `${pts.length} Punkte`);
  const o = { id: 'O', type: 'poly', pts: [[0, 0], [10, 0], [5, 8.660254]], radii: { 1: 1, 0: 5, 2: 5 } };
  const pl = cornerPlan(o);
  ok('offen: Endpunkte bleiben, nur innere Ecke gerundet', near(pl.segs[0].a, [0, 0]) && near(pl.segs[pl.segs.length - 1].b, [5, 8.660254]) && pl.segs.filter(s => s.k === 'A').length === 1);
  const arc = pl.segs.find(s => s.k === 'A');
  ok('60°-Ecke: Tangentenlänge r/tan(30°)', Math.abs(Math.hypot(arc.a[0] - 10, arc.a[1]) - 1 / Math.tan(Math.PI / 6)) < 1e-6);
}

// ---- applying ----
{
  const r = applyCorners([sq], [], ['S:p1', 'S:p3'], 'fillet', 2, newId);
  ok('Linienzug: zwei Ecken abgerundet', r.done === 2 && J(r.entities[0].radii) === J({ 1: 2, 3: 2 }) && !r.changed.length);
  const r2 = applyCorners(r.entities, [], ['S:p1'], 'chamfer', [1, 2], newId);
  ok('Fase ersetzt Rundung an derselben Ecke', J(r2.entities[0].radii) === J({ 3: 2 }) && J(r2.entities[0].chamfers) === J({ 1: [1, 2] }));
  const r3 = applyCorners(r2.entities, [], ['S:p1', 'S:p3'], 'fillet', 0, newId);
  ok('Wert 0 entfernt Rundung und Fase', !r3.entities[0].radii && !r3.entities[0].chamfers);
  ok('Eingabe bleibt unverändert', !sq.radii && !sq.chamfers);
}
{
  const rect = { id: 'R', type: 'rect', x: 0, y: 0, w: 30, h: 20 };
  const cons = [{ id: 'd1', type: 'distance', refs: ['R:p0', 'R:p1'], value: 30 }];
  const r = applyCorners([rect], cons, ['R:p2'], 'chamfer', 3, newId);
  const e = r.entities[0];
  ok('Rechteck → Linienzug mit Fase an Ecke 2', e.type === 'poly' && e.closed && J(e.pts) === J([[0, 0], [30, 0], [30, 20], [0, 20]]) && e.chamfers[2] === 3 && J(r.changed) === J(['R']), J(e));
  const hv = r.constraints.filter(c => c.type === 'horizontal' || c.type === 'vertical');
  ok('Rechteck bleibt rechtwinklig (H/V-Bedingungen) und Bemaßung bleibt', hv.length === 4 && r.constraints.some(c => c.id === 'd1' && J(c.refs) === J(['R:p0', 'R:p1'])), J(hv.map(c => c.type + c.refs)));
  const rr = applyCorners([{ ...rect, r: 2 }], [], ['R:p0'], 'fillet', 5, newId).entities[0];
  ok('Rechteck mit Eckenradius: übrige Ecken behalten ihn', J(rr.radii) === J({ 0: 5, 1: 2, 2: 2, 3: 2 }));
  const blocked = applyCorners([rect], [{ id: 'm', type: 'coincident', refs: ['R:c', 'origin'] }], ['R:p0'], 'fillet', 2, newId);
  ok('Rechteck mit Bedingung an der Mitte bleibt unverändert', blocked.done === 0 && blocked.entities[0].type === 'rect');
}
{
  // two separate lines meeting at (10,0): joined, the corner rounded; constraints follow the new numbers
  const A = { id: 'A', type: 'poly', pts: [[0, 0], [10, 0]] }, B = { id: 'B', type: 'poly', pts: [[10, 0], [10, 8]] };
  const cons = [{ id: 'k', type: 'coincident', refs: ['A:p1', 'B:p0'] }, { id: 'h', type: 'horizontal', refs: ['A:l0'] }, { id: 'v', type: 'vertical', refs: ['B:l0'] }, { id: 'f', type: 'fix', refs: ['B:p1'] }];
  const r = applyCorners([A, B], cons, ['B:p0'], 'fillet', 3, newId);
  const e = r.entities.find(x => x.id === 'A');
  ok('zwei Linien → ein Linienzug, Ecke gerundet', r.entities.length === 1 && J(e.pts) === J([[0, 0], [10, 0], [10, 8]]) && J(e.radii) === J({ 1: 3 }), J(r.entities));
  ok('Bedingungen umnummeriert, Koinzidenz entfällt', !r.constraints.some(c => c.id === 'k') && J(r.constraints.find(c => c.id === 'v').refs) === J(['A:l1']) && J(r.constraints.find(c => c.id === 'f').refs) === J(['A:p2']), J(r.constraints));
  // reversed second line (ends at the junction) and a closing third line → closed polyline
  const B2 = { id: 'B', type: 'poly', pts: [[10, 8], [10, 0]] }, Cc = { id: 'C', type: 'poly', pts: [[10, 8], [0, 0]] };
  const r2 = applyCorners([A, B2, Cc], [{ id: 'q', type: 'fix', refs: ['B:p0'] }], ['A:p1', 'C:p0'], 'chamfer', 1, newId);
  const e2 = r2.entities[0];
  ok('drei Linien → geschlossener Linienzug mit zwei Fasen', r2.entities.length === 1 && e2.closed && e2.pts.length === 3 && Object.keys(e2.chamfers || {}).length === 2 && J(r2.constraints[0].refs) === J(['A:p2']), J(r2.entities));
  const lone = applyCorners([A], [], ['A:p1'], 'fillet', 2, newId);
  ok('Linienende ohne zweite Linie: übersprungen', lone.done === 0 && lone.skipped === 1);
}

// ---- picking a corner by clicking near it ----
{
  const { cornerAt, cornerPreview } = await import('../js/sketchcorner.js');
  const ents = [{ id: 'R', type: 'rect', x: 0, y: 0, w: 30, h: 20 }, { id: 'A', type: 'poly', pts: [[50, 0], [60, 0]] }, { id: 'B', type: 'poly', pts: [[60, 0], [60, 10]] },
    { id: 'Z', type: 'poly', pts: [[80, 0], [90, 0], [90, 10]] }, { id: 'K', type: 'poly', cons: true, closed: true, pts: [[0, 40], [5, 40], [5, 45]] }];
  ok('Klick neben Rechteckecke → Ecke', cornerAt(ents, [29.2, 19.5], 1.5)?.ref === 'R:p2');
  ok('Klick am Treffpunkt zweier Linien', ['A:p1', 'B:p0'].includes(cornerAt(ents, [59.5, 0.4], 1.5)?.ref));
  ok('Linienende ohne zweite Linie / offenes Ende → keine Ecke', cornerAt(ents, [80.3, 0.2], 1.5) === null && cornerAt(ents, [90, 10.4], 1.5) === null);
  ok('innerer Punkt eines offenen Linienzugs', cornerAt(ents, [89.6, 0.5], 1.5)?.ref === 'Z:p1');
  ok('Konstruktionslinien werden ignoriert, zu weit weg → nichts', cornerAt(ents, [5, 40], 1.5) === null && cornerAt(ents, [15, 10], 1.5) === null);
  const pv = cornerPreview(ents, 'R:p2', 'fillet', 5);
  ok('Vorschau: Rechteck mit gerundeter Ecke', pv && pv.closed && pv.pts.some(p => near(p, [25, 20])) && pv.pts.some(p => near(p, [30, 15])));
}
