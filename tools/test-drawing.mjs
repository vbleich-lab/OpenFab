// Drawing annotations without a browser: own dimensions (length, diameter, angle), notes with a leader and the
// text behind a number, rendered for a plain plate.
// Run: npm run test:drawing
import './lib/node-env.mjs';
const { makeDrawing } = await import('../js/drawing.js');

const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
const THREE = await import('three');
// a plate 120 × 80 × 10 as in the app: indexed mesh, its feature edges, no round edges
const plate = new THREE.BoxGeometry(120, 80, 10).translate(60, 40, 5);
const bodies = [{ id: 'b1', geometry: plate, edges: new THREE.EdgesGeometry(plate, 30), shape: { edges: [] } }];
const base = { sheet: 'A3', scale: 'auto', views: { front: true, top: true, left: true, iso: false }, title: { name: 'Test' } };
const plain = makeDrawing(bodies, { ...base, userDims: [] });
ok('Zeichnung ohne eigene Maße', typeof plain.svg === 'string' && plain.svg.includes('<svg'), `${plain.svg.length} Zeichen`);
const userDims = [
  { view: 'top', kind: 'h', a: [0, 0], b: [120, 0], off: 16, txt: '±0,1' },
  { view: 'top', kind: 'dia', c: [62, -40], r: 5, ang: 30, txt: 'H7' },
  { view: 'top', kind: 'ang', v: [0, 0], a: [120, 0], b: [0, -80], off: 20 },
  { view: 'top', kind: 'ang', v: [0, 0], a: [100, 0], b: [100, -100], off: 14, txt: '±0,5°' },
  { view: 'front', kind: 'note', a: [10, 10], text: 'Kanten gebrochen', ang: 60, off: 14 },
];
const d = makeDrawing(bodies, { ...base, userDims });
const texts = [...d.svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
ok('Längenmaß mit Toleranz-Zusatz', texts.includes('120 ±0,1'), texts.filter(t => /120/.test(t)).join(' | '));
ok('Durchmesser mit Passung', texts.includes('Ø10 H7'), texts.filter(t => /Ø10/.test(t)).join(' | '));
ok('Winkelmaß 90° zwischen zwei Kanten', texts.includes('90°'), texts.filter(t => /°/.test(t)).join(' | '));
ok('Winkelmaß 45° mit Zusatz', texts.includes('45° ±0,5°'));
ok('Hinweis mit Pfeil', texts.includes('Kanten gebrochen') && d.svg.length > plain.svg.length);
// the arc of the 90° dimension: short pieces at 20 mm from the corner on the sheet
const segs = [...d.svg.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" class="dim( arrow1)?"\/>/g)].map(m => m.slice(1, 5).map(Number));
const bad = d.svg.match(/NaN|undefined|Infinity/);
ok('Keine ungültigen Werte im SVG', !bad, bad ? bad[0] : `${segs.length} Maßlinien`);

// centre lines: an axis along Z lies in the front and side view (one dash-dot line each, 3 mm beyond the
// cylinder) and points at the viewer in the top view (nothing: holes get their crosses there); an axis along Y
// gives a cross in the front view and a line in the two others
const ctr = svg => [...svg.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" class="ctr"\/>/g)].map(m => m.slice(1, 5).map(Number));
const zAxis = makeDrawing(bodies, { ...base, userDims: [], axes: [{ p: [60, 40, 0], d: [0, 0, 1], t0: 0, t1: 10, r: 5 }] });
const cz = ctr(zAxis.svg), sc = zAxis.scale;
ok('Mittellinie: Achse längs Z gibt je eine senkrechte Linie in Vorder- und Seitenansicht', cz.length === 2 && cz.every(l => Math.abs(l[0] - l[2]) < 1e-6 && Math.abs(Math.abs(l[1] - l[3]) - (10 * sc + 6)) < 0.01), `${cz.length} Linien, Länge ${cz.map(l => Math.abs(l[1] - l[3]).toFixed(2)).join('/')} mm bei Maßstab ${sc}`);
const yAxis = makeDrawing(bodies, { ...base, userDims: [], axes: [{ p: [60, 0, 5], d: [0, 1, 0], t0: 0, t1: 80, r: 3 }] });
ok('Mittellinie: Achse längs Y gibt ein Kreuz vorn und je eine Linie in Drauf- und Seitenansicht', ctr(yAxis.svg).length === 4, `${ctr(yAxis.svg).length} Linien`);
ok('Mittellinien abschaltbar (keine Achsen übergeben)', ctr(plain.svg).length === 0);
// arrowheads in sheet millimetres
ok('Pfeilspitzen 2,5 mm lang', /markerUnits="userSpaceOnUse" markerWidth="2.5"/.test(plain.svg));
// own dimensions are groups the drawing window can grab: one per dimension, every line with a wide twin
const groups = [...d.svg.matchAll(/<g class="udim" data-dim="(\d+)">/g)].map(m => +m[1]).sort((a, b) => a - b); // (grouped by view in the file)
ok('Eigene Maße als greifbare Gruppen (eine je Maß, mit breiten Greiflinien)', groups.join() === '0,1,2,3,4' && (d.svg.match(/class="hit"/g) || []).length >= 10 && !/class="hit"/.test(plain.svg), `${groups.length} Gruppen, ${(d.svg.match(/class="hit"/g) || []).length} Greiflinien`);
// surface symbol: tick with bar and value; turned by 90° the bar runs along the sheet's vertical
{
  const one = ang => makeDrawing(bodies, { ...base, userDims: [{ view: 'front', kind: 'surf', a: [60, 10], text: 'Ra 3,2', ang }] }).svg;
  const dimLines = svg => [...svg.matchAll(/<g class="udim"[^>]*>([\s\S]*?)<\/g>/g)].flatMap(m => [...m[1].matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" class="dim"\/>/g)].map(q => q.slice(1, 5).map(Number)));
  const up = dimLines(one(0)), side = dimLines(one(90));
  const tip = up[0].slice(0, 2), bar = up[3], barS = side[3];
  ok('Oberflächenzeichen: Haken mit Querstrich und Wertstrich, Spitze auf der Kante, Text Ra 3,2', up.length === 4 && Math.abs(up[1][0] - tip[0]) < 1e-6 && Math.abs(bar[1] - bar[3]) < 1e-6 && Math.abs(bar[1] - (tip[1] - 6)) < 1e-3 && />Ra 3,2</.test(one(0)), `${up.length} Linien, Wertstrich ${Math.abs(bar[2] - bar[0]).toFixed(1)} mm lang`);
  ok('Oberflächenzeichen um 90° gedreht: Wertstrich senkrecht, Spitze bleibt', Math.abs(barS[0] - barS[2]) < 1e-3 && Math.abs(side[0][0] - tip[0]) < 1e-6 && Math.abs(side[0][1] - tip[1]) < 1e-6);
}
// geometric tolerance frame, datum triangle, the other surface symbol forms
{
  const svg = makeDrawing(bodies, { ...base, userDims: [
    { view: 'top', kind: 'gdt', a: [120, -40], sym: 'perp', text: 'Ø0,05 A B', ang: 30, off: 14 },
    { view: 'front', kind: 'datum', a: [30, 0], text: 'A', ang: 180 },
    { view: 'front', kind: 'surf', a: [80, 10], text: 'Rz 16', sym: 'none', ang: 0 },
    { view: 'front', kind: 'surf', a: [100, 10], text: '', sym: 'any', ang: 0 }] }).svg;
  const grp = [...svg.matchAll(/<g class="udim" data-dim="(\d+)">([\s\S]*?)<\/g>/g)].reduce((o, m) => ({ ...o, [m[1]]: m[2] }), {});
  const n = (g, re) => (g.match(re) || []).length;
  const tx = g => [...g.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map(m => m[1]);
  ok('Toleranzrahmen: Symbolfeld und drei Felder (Ø0,05 | A | B) mit Hinweislinie', tx(grp[0]).join('|') === 'Ø0,05|A|B' && n(grp[0], /class="dim arrow1"/g) === 1 && n(grp[0], /class="dim"\/>/g) === 1 + 2 + 5 + 2, `${n(grp[0], /class="dim"\/>/g)} Linien, Texte ${tx(grp[0]).join(' | ')}`);
  ok('Bezug: gefülltes Dreieck, Stiel, Buchstabe im Quadrat', /<path[^>]*fill="#000"/.test(grp[1]) && tx(grp[1]).join() === 'A' && n(grp[1], /class="dim"\/>/g) === 5);
  ok('Oberflächenzeichen „ohne Abtrag“ mit Kreis, „beliebig“ ohne Querstrich', n(grp[2], /<circle/g) === 1 && n(grp[2], /class="dim"\/>/g) === 3 && n(grp[3], /<circle/g) === 0 && n(grp[3], /class="dim"\/>/g) === 3);
  const bad2 = svg.match(/NaN|undefined|Infinity/);
  ok('Keine ungültigen Werte in den neuen Zeichen', !bad2, bad2 ? bad2[0] : '');
}
// threads: a bolt thread along X shows two thin lines and its name in the views it lies in and a three-quarter
// circle where it points at the viewer; a tapped hole along Z gets the circle in the top view
{
  const bolt = { id: 't1', name: 'M10×1.5', c: [0, 40, 5], d: [1, 0, 0], r: 5, L: 20, P: 1.5, outside: true };
  const tap = { id: 't2', name: 'M8×1.25', c: [60, 40, 10], d: [0, 0, -1], r: 4 - 0.5413 * 1.25, L: 8, P: 1.25, outside: false };
  const none = makeDrawing(bodies, { ...base, userDims: [] }).svg, withT = makeDrawing(bodies, { ...base, userDims: [], threads: [bolt, tap] }).svg;
  const cnt = (svg, re) => (svg.match(re) || []).length;
  const arcs = [...withT.matchAll(/<path d="M[\d. -]+A([\d.]+) [\d.]+ 0 1 0 [^"]*" class="dim"/g)].map(m => +m[1]);
  const sc = makeDrawing(bodies, { ...base, userDims: [] }).scale;
  ok('Gewinde: Dreiviertelkreise (Bolzen von der Seite gesehen am Kerndurchmesser, Gewindebohrung am Nenndurchmesser)', arcs.length === 2 && arcs.some(r => Math.abs(r - (5 - 0.6134 * 1.5) * sc) < 0.01) && arcs.some(r => Math.abs(r - 4 * sc) < 0.01), `Radien ${arcs.map(r => r.toFixed(2)).join(' / ')} mm bei Maßstab ${sc}`);
  ok('Gewinde: Bolzen mit dünnen Linien und Namen in Vorder- und Draufsicht', cnt(withT, />M10×1,5</g) === 2 && cnt(withT, /class="dim"\/>/g) - cnt(none, /class="dim"\/>/g) === 2 * (2 + 1));
  // the tapped hole along Z from the side: two dashed lines 8 mm apart (M8) and its end, in front and side view
  const thr = [...withT.matchAll(/<line x1="([\d.-]+)" y1="([\d.-]+)" x2="([\d.-]+)" y2="([\d.-]+)" class="thr"\/>/g)].map(m => m.slice(1, 5).map(Number));
  const vert = thr.filter(l => Math.abs(l[0] - l[2]) < 1e-6), xs = [...new Set(vert.map(l => l[0].toFixed(2)))].map(Number).sort((a, b) => a - b);
  ok('Gewindebohrung von der Seite: gestrichelte Linien am Nenndurchmesser über die Gewindelänge, mit Abschluss', thr.length === 6 && vert.length === 4 && vert.every(l => Math.abs(Math.abs(l[1] - l[3]) - 8 * sc) < 0.01) && Math.abs(xs[1] - xs[0] - 8 * sc) < 0.01 && !/class="thr"/.test(none), `${thr.length} Linien, Abstand ${(xs[1] - xs[0]).toFixed(2)} mm`);
  const badT = withT.match(/NaN|undefined|Infinity/);
  ok('Gewinde: keine ungültigen Werte', !badT, badT ? badT[0] : '');
}
// nothing to draw (no body): an empty sheet without broken numbers
{
  const empty = makeDrawing([], { ...base, userDims: [] }).svg, badE = empty.match(/NaN|undefined|Infinity/);
  ok('Zeichnung ohne Körper: leeres Blatt ohne ungültige Werte', !badE && empty.includes('<svg'), badE ? badE[0] : '');
}

