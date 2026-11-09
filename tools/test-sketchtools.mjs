// Tests for the extra sketch drawing methods (node tools/test-sketchtools.mjs)
import { centerRect, rect3, circle2, circleThrough, centerArc } from '../js/sketchtools.js';
const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
const J = JSON.stringify;
ok('Mittelpunkt-Rechteck', J(centerRect([10, 5], [16, 9])) === J({ x: 4, y: 1, w: 12, h: 8 }), J(centerRect([10, 5], [16, 9])));
ok('Mittelpunkt-Rechteck (Ecke links unten)', J(centerRect([0, 0], [-3, -2])) === J({ x: -3, y: -2, w: 6, h: 4 }));
ok('3-Punkt-Rechteck achsparallel', J(rect3([0, 0], [10, 0], [7, 4])) === J([[0, 0], [10, 0], [10, 4], [0, 4]]), J(rect3([0, 0], [10, 0], [7, 4])));
const r = rect3([0, 0], [6, 8], [0, 20]);
const d = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]);
ok('3-Punkt-Rechteck gedreht (rechte Winkel)', r && Math.abs(d(r[0], r[2]) ** 2 - d(r[0], r[1]) ** 2 - d(r[1], r[2]) ** 2) < 1e-6, J(r));
ok('2-Punkt-Kreis', J(circle2([0, 0], [10, 0])) === J({ cx: 5, cy: 0, r: 5 }));
ok('3-Punkt-Kreis', J(circleThrough([5, 0], [0, 5], [-5, 0])) === J({ cx: 0, cy: 0, r: 5 }), J(circleThrough([5, 0], [0, 5], [-5, 0])));
ok('3-Punkt-Kreis kollinear → null', circleThrough([0, 0], [1, 1], [2, 2]) === null);
const a = centerArc([0, 0], [10, 0], [0, 3]);
ok('Mittelpunkt-Bogen (Viertel, Ende auf Kreis)', J(a) === J([[10, 0], [7.0711, 7.0711], [0, 10]]), J(a));
const b = centerArc([0, 0], [10, 0], [0, -3]);
ok('Mittelpunkt-Bogen im Uhrzeigersinn', b[1][1] < 0 && J(b[2]) === J([0, -10]), J(b));
import { endTangent, tangentArc } from '../js/sketchtools.js';
{
  const ents = [{ id: 'L', type: 'poly', pts: [[0, 0], [10, 0]] }, { id: 'A', type: 'poly', curve: 'arc', pts: [[10, 0], [17.0711, 2.9289], [20, 10]] }];
  const t = endTangent(ents, 'L:p1');
  ok('Tangente am Linienende', JSON.stringify(t) === JSON.stringify({ p: [10, 0], T: [1, 0], curve: 'L:l0' }), JSON.stringify(t));
  const ta = endTangent(ents, 'A:p2');
  ok('Tangente am Bogenende (nach oben)', ta && Math.abs(ta.T[0]) < 1e-3 && ta.T[1] > 0.999, JSON.stringify(ta));
  const q = tangentArc([10, 0], [1, 0], [20, 10]);
  ok('Tangentialbogen = Viertelkreis', JSON.stringify(q) === JSON.stringify([[10, 0], [17.0711, 2.9289], [20, 10]]), JSON.stringify(q));
  const q2 = tangentArc([10, 0], [1, 0], [10, -20]);
  ok('Tangentialbogen nach rechts unten (Halbkreis)', q2 && JSON.stringify(q2[1]) === JSON.stringify([20, -10]), JSON.stringify(q2));
  ok('geradeaus → kein Bogen', tangentArc([0, 0], [1, 0], [5, 0]) === null);
  ok('Mittelpunkt eines Linienzugs → keine Tangente', endTangent([{ id: 'P', type: 'poly', pts: [[0, 0], [1, 0], [1, 1]] }], 'P:p1') === null);
}
