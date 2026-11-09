// Tests: arcs in the constraint solver (node tools/test-solver-arcs.mjs)
import { solveSketch, sketchHandles, constraintFor } from '../js/solver.js';
const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
const f = v => +v.toFixed(3);

// line along X, arc starting at its end but bent off (not tangent)
const line = { id: 'L', type: 'poly', pts: [[0, 0], [10, 0]] };
const arc = { id: 'A', type: 'poly', curve: 'arc', pts: [[10, 0], [14, 6], [12, 12]] };
const H = sketchHandles([line, arc]);
const o = H.circles.find(c => c.ref === 'A:o');
ok('Bogen ist als Kurve wählbar (Handle A:o)', !!o && Number.isFinite(o.r) && !!o.span, o && `r=${f(o.r)}`);
ok('Tangential Linie–Bogen ist zulässig', constraintFor('tangent', ['L:l0', 'A:o']));
const cons = [
  { id: 'c1', type: 'coincident', refs: ['A:p0', 'L:p1'] },
  { id: 'c2', type: 'tangent', refs: ['A:o', 'L:l0'] },
  { id: 'c3', type: 'fix', refs: ['L:p0'], at: [0, 0] },
  { id: 'c4', type: 'horizontal', refs: ['L:l0'] },
];
const res = solveSketch([line, arc], cons);
const e = res.entities;
const H2 = sketchHandles([e.L, e.A]);
const c = H2.circle('A:o');
// tangent to the X axis at (10,0): centre straight above or below the end point
ok('Gelöst: Bogenmittelpunkt senkrecht über dem Linienende', Math.abs(c.c[0] - e.L.pts[1][0]) < 1e-3 && Math.abs(Math.abs(c.c[1]) - c.r) < 1e-3, `c=(${f(c.c[0])}, ${f(c.c[1])}) r=${f(c.r)}`);
ok('Keine unerfüllten Bedingungen', !res.unsatisfied?.length, JSON.stringify(res.unsatisfied));

// radius dimension on an arc
const res2 = solveSketch([{ ...arc }], [{ id: 'd', type: 'dim', kind: 'radius', refs: ['A:o'], value: 20 }]);
ok('Radius-Bemaßung am Bogen', Math.abs(sketchHandles([res2.entities.A]).circle('A:o').r - 20) < 1e-3, f(sketchHandles([res2.entities.A]).circle('A:o').r));

// concentric arc and circle
const res3 = solveSketch([{ ...arc }, { id: 'K', type: 'circle', cx: 3, cy: 3, r: 2 }], [{ id: 'k', type: 'concentric', refs: ['A:o', 'K:o'] }]);
const h3 = sketchHandles(Object.values(res3.entities));
ok('Konzentrisch Bogen–Kreis', Math.hypot(h3.circle('A:o').c[0] - h3.circle('K:o').c[0], h3.circle('A:o').c[1] - h3.circle('K:o').c[1]) < 1e-3);
