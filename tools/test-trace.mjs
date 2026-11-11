// Tracing pictures (js/trace.js): outlines and centre lines of drawn test shapes with known sizes.
// Run: npm run test:trace
import './lib/node-env.mjs';
const { inkFromRGBA, contours, centerlines, traceImage, toSketch, toSVG, simplify } = await import('../js/trace.js');

const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
// picture from a coverage function (0…1 per sample), 4 x 4 samples per pixel for soft edges
function draw(w, h, fn) {
  const ink = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    let s = 0;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) s += fn(x + (i + 0.5) / 4, y + (j + 0.5) / 4) ? 1 : 0;
    ink[y * w + x] = Math.round((s / 16) * 255);
  }
  return { w, h, ink };
}
const polyArea = pts => Math.abs(pts.reduce((s, a, i) => { const b = pts[(i + 1) % pts.length]; return s + a[0] * b[1] - b[0] * a[1]; }, 0) / 2);
const radii = (pts, cx, cy) => pts.map(p => Math.hypot(p[0] - cx, p[1] - cy));

// ---- outlines ----
{
  const disc = draw(64, 64, (x, y) => Math.hypot(x - 32, y - 32) <= 20);
  const c = contours(disc, 128);
  const rr = radii(c[0].pts, 32, 32);
  ok('Kreisscheibe: eine Kontur auf dem Rand', c.length === 1 && c[0].depth === 0 && Math.max(...rr) < 20.3 && Math.min(...rr) > 19.7, `Radius ${Math.min(...rr).toFixed(2)}…${Math.max(...rr).toFixed(2)}, ${c[0].pts.length} Punkte`);
  ok('Kreisscheibe: Fläche stimmt auf 1 %', Math.abs(c[0].area - Math.PI * 400) / (Math.PI * 400) < 0.01, c[0].area.toFixed(1));

  const ring = draw(80, 80, (x, y) => { const r = Math.hypot(x - 40, y - 40); return r <= 25 && r >= 15; });
  const all = traceImage(ring, { mode: 'all' }), outer = traceImage(ring, { mode: 'outer' }), inner = traceImage(ring, { mode: 'inner' });
  ok('Ring: außen und innen = 2 Konturen, nur außen = 1, nur innen = 1', all.length === 2 && outer.length === 1 && inner.length === 1, `${all.length} / ${outer.length} / ${inner.length}`);
  const ro = radii(outer[0].pts, 40, 40), ri = radii(inner[0].pts, 40, 40);
  ok('Ring: Außenkontur bei R 25, Innenkontur bei R 15', Math.abs(Math.max(...ro) - 25) < 0.4 && Math.abs(Math.min(...ro) - 25) < 0.6 && Math.abs(Math.max(...ri) - 15) < 0.6 && Math.abs(Math.min(...ri) - 15) < 0.6, `außen ${Math.min(...ro).toFixed(2)}…${Math.max(...ro).toFixed(2)}, innen ${Math.min(...ri).toFixed(2)}…${Math.max(...ri).toFixed(2)}`);
  ok('Ring: vereinfacht auf wenige Punkte', outer[0].pts.length < 120 && outer[0].closed, `${outer[0].pts.length} Punkte`);

  // island in a hole: depth 0, 1, 2 – "outer" takes the ring and the island, "inner" the hole
  const island = draw(90, 90, (x, y) => { const r = Math.hypot(x - 45, y - 45); return (r <= 40 && r >= 25) || r <= 10; });
  const ci = contours(island);
  ok('Insel im Loch: Tiefen 0, 1, 2', ci.length === 3 && ci.map(l => l.depth).join() === '0,1,2' && traceImage(island, { mode: 'outer' }).length === 2 && traceImage(island, { mode: 'inner' }).length === 1);

  // a shape touching the border is closed, specks are dropped
  const edge = draw(40, 40, (x, y) => x < 12 || (Math.abs(x - 30) < 0.8 && Math.abs(y - 30) < 0.8));
  ok('Form am Bildrand ist geschlossen, Fleck entfällt', traceImage(edge, { minSize: 8 }).length === 1 && contours(edge).length === 2 && Math.abs(polyArea(contours(edge)[0].pts) - 12 * 40) < 6);

  // a square keeps its corners after simplifying: 4 points
  const sq = draw(60, 60, (x, y) => x >= 10 && x <= 50 && y >= 15 && y <= 45);
  const s4 = traceImage(sq, { smoothing: 0, tolerance: 0.6 });
  ok('Rechteck: vier Ecken, Maße 40 × 30', s4.length === 1 && s4[0].pts.length === 4 && Math.abs(polyArea(s4[0].pts) - 1200) < 40, `${s4[0].pts.length} Punkte, Fläche ${polyArea(s4[0].pts).toFixed(1)}`);
}

// ---- centre lines ----
{
  const bar = draw(60, 20, (x, y) => x >= 8 && x <= 52 && Math.abs(y - 10) <= 1.5);
  const cl = traceImage(bar, { mode: 'center', smoothing: 0 });
  const xs = cl[0]?.pts.map(p => p[0]) || [], ys = cl[0]?.pts.map(p => p[1]) || [];
  ok('Strich: eine offene Mittellinie in der Mitte', cl.length === 1 && !cl[0].closed && Math.max(...ys.map(y => Math.abs(y - 10))) <= 0.6 && Math.min(...xs) < 11 && Math.max(...xs) > 49, `x ${Math.min(...xs).toFixed(1)}…${Math.max(...xs).toFixed(1)}, y-Abweichung ${Math.max(...ys.map(y => Math.abs(y - 10))).toFixed(2)}`);

  const ring = draw(80, 80, (x, y) => { const r = Math.hypot(x - 40, y - 40); return r <= 22 && r >= 18; });
  const cr = traceImage(ring, { mode: 'center' });
  const rr = cr[0] ? radii(cr[0].pts, 40, 40) : [0];
  ok('Kreisring: eine geschlossene Mittellinie bei R 20', cr.length === 1 && cr[0].closed && Math.abs(Math.max(...rr) - 20) < 1.2 && Math.abs(Math.min(...rr) - 20) < 1.2, `R ${Math.min(...rr).toFixed(2)}…${Math.max(...rr).toFixed(2)}, ${cr[0]?.pts.length} Punkte`);

  const tee = draw(60, 60, (x, y) => (Math.abs(y - 12) <= 1.5 && x >= 10 && x <= 50) || (Math.abs(x - 30) <= 1.5 && y >= 12 && y <= 50));
  const ct = traceImage(tee, { mode: 'center', smoothing: 0, minSize: 5 });
  const ends = ct.flatMap(l => [l.pts[0], l.pts[l.pts.length - 1]]);
  const near = (p, q) => Math.hypot(p[0] - q[0], p[1] - q[1]) < 3;
  ok('T-Form: drei Linien, die sich im Knoten treffen', ct.length === 3 && ends.filter(p => near(p, [30, 12])).length === 3 && ends.some(p => near(p, [11, 12])) && ends.some(p => near(p, [49, 12])) && ends.some(p => near(p, [30, 49])), `${ct.length} Linien`);
  ok('Mittellinie: kurze Stücke entfallen', traceImage(draw(30, 30, (x, y) => Math.hypot(x - 15, y - 15) < 1.6), { mode: 'center', minSize: 8 }).length === 0);
}

// ---- helpers ----
{
  // white on black with "invert", transparent = paper
  const rgba = new Uint8Array([0, 0, 0, 255, 255, 255, 255, 255, 10, 10, 10, 0, 128, 128, 128, 255]);
  const a = inkFromRGBA(rgba, 4, 1), b = inkFromRGBA(rgba, 4, 1, true);
  ok('Grauwerte: dunkel = Linie, durchsichtig = Papier, Invertieren kehrt um', a[0] === 255 && a[1] === 0 && a[2] === 0 && Math.abs(a[3] - 127) <= 1 && b[0] === 0 && b[1] === 255, [...a].join(',') + ' | ' + [...b].join(','));
  const img = { w: 200, h: 100 };
  const mm = toSketch([{ closed: true, pts: [[0, 0], [200, 0], [200, 100]] }], img, 50, 10, 5);
  ok('Maßstab: Breite 50 mm, Y nach oben, Bildmitte am Zielpunkt', JSON.stringify(mm[0].pts) === '[[-15,17.5],[35,17.5],[35,-7.5]]', JSON.stringify(mm[0].pts));
  const svg = toSVG(mm, 50, 25, 10, 5);
  ok('SVG: Größe in mm, Pfad geschlossen', /width="50mm" height="25mm"/.test(svg) && /d="M0 0 L50 0 L50 25 Z"/.test(svg), svg.split('\n')[2].trim().slice(0, 60));
  const line = Array.from({ length: 50 }, (_, i) => [i, i % 2 ? 0.05 : -0.05]);
  ok('Vereinfachen: Zickzack unter der Toleranz wird eine Gerade', simplify(line, 0.2).length === 2);
}

// ---- straight lines, arcs, circles, corners ----
{
  const { fitCurve, toEntities, quantize, inkOfColors } = await import('../js/trace.js');
  const sq = draw(80, 70, (x, y) => x >= 10 && x <= 60 && y >= 15 && y <= 50);
  const f = traceImage(sq, { curves: 'fit' });
  const cornersOk = f[0]?.segs?.every(s => [[10, 15], [60, 15], [60, 50], [10, 50]].some(c => Math.hypot(s.a[0] - c[0], s.a[1] - c[1]) < 0.2));
  ok('Angleichen: Rechteck = 4 Geraden mit scharfen Ecken auf 0,2 Pixel', f.length === 1 && f[0].closed && f[0].segs.length === 4 && f[0].segs.every(s => s.t === 'l') && cornersOk, f[0]?.segs?.map(s => s.a.map(v => v.toFixed(2)).join('/')).join(' '));
  ok('Angleichen: Rechteck-Fläche auf 0,5 %', Math.abs(polyArea(f[0].segs.map(s => s.a)) - 1750) < 9, polyArea(f[0].segs.map(s => s.a)).toFixed(1));

  const disc = traceImage(draw(64, 64, (x, y) => Math.hypot(x - 32, y - 32) <= 20), { curves: 'fit' });
  ok('Angleichen: Kreisscheibe = ein Kreis R 20', disc.length === 1 && !!disc[0].circle && Math.abs(disc[0].circle.r - 20) < 0.1 && Math.hypot(disc[0].circle.c[0] - 32, disc[0].circle.c[1] - 32) < 0.1, disc[0].circle ? `R ${disc[0].circle.r.toFixed(3)}` : 'kein Kreis');

  // rounded rectangle 60 x 40, corner radius 10: 4 lines and 4 arcs of R 10
  const rr = draw(90, 70, (x, y) => { const dx = Math.max(Math.abs(x - 45) - 20, 0), dy = Math.max(Math.abs(y - 35) - 10, 0); return Math.hypot(dx, dy) <= 10; });
  const fr = traceImage(rr, { curves: 'fit' })[0];
  const arcs = fr.segs.filter(s => s.t === 'a'), lines = fr.segs.filter(s => s.t === 'l');
  ok('Angleichen: Rechteck mit runden Ecken = Geraden und Bögen R 10', arcs.length >= 4 && arcs.length <= 6 && lines.length >= 4 && lines.length <= 8 && arcs.every(a => Math.abs(a.r - 10) < 1.2), `${lines.length} Geraden, ${arcs.length} Bögen, R ${arcs.map(a => a.r.toFixed(2)).join(' ')}`);
  const flat = fr.pts, dev = Math.max(...flat.map(([x, y]) => { const dx = Math.max(Math.abs(x - 45) - 20, 0), dy = Math.max(Math.abs(y - 35) - 10, 0); return Math.abs(Math.hypot(dx, dy) - 10); }).filter(d => d < 5));
  ok('Angleichen: Kurve bleibt auf 0,6 Pixel an der Form', dev < 0.6, dev.toFixed(3));
  const ents = toEntities(toSketch([fr], rr, 90));
  const ends = ents.flatMap(e => [e.pts[0], e.pts[e.pts.length - 1]]), key = p => p.map(v => v.toFixed(3)).join(',');
  const cnt = ends.reduce((m, p) => m.set(key(p), (m.get(key(p)) || 0) + 1), new Map());
  ok('Angleichen: Geraden und Bögen schließen lückenlos aneinander', ents.some(e => e.curve === 'arc' && e.pts.length === 3) && [...cnt.values()].every(v => v === 2), `${ents.length} Elemente`);
  ok('Angleichen: Rechteck wird ein geschlossener Linienzug, Kreis ein Kreis', toEntities(toSketch(f, sq, 80))[0].closed === true && toEntities(toSketch(f, sq, 80))[0].pts.length === 4 && toEntities(toSketch(disc, { w: 64, h: 64 }, 64))[0].type === 'circle');

  // polylines with smoothing keep the corners of a square
  const sm = traceImage(sq, { smoothing: 2 })[0];
  const worst = Math.max(...[[10, 15], [60, 15], [60, 50], [10, 50]].map(c => Math.min(...sm.pts.map(p => Math.hypot(p[0] - c[0], p[1] - c[1])))));
  ok('Glätten lässt Ecken scharf', worst < 0.75, `Abstand Ecke–Kurve höchstens ${worst.toFixed(2)} px`);

  // centre line of an L: two straight lines
  const ell = draw(60, 60, (x, y) => (Math.abs(x - 15) <= 1.5 && y >= 10 && y <= 45) || (Math.abs(y - 45) <= 1.5 && x >= 15 && x <= 50));
  const fl = traceImage(ell, { mode: 'center', curves: 'fit', tolerance: 0.8 });
  ok('Angleichen: Mittellinie eines Winkels aus wenigen Geraden', fl.length === 1 && fl[0].segs.length <= 4 && fl[0].segs.filter(s => s.t === 'l').length >= 2, `${fl[0]?.segs.length} Stücke`);

  // ---- colours ----
  const w = 60, h = 40, rgba = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const c = Math.hypot(x - 15, y - 20) < 10 ? [220, 30, 30] : x >= 35 && x < 55 && y >= 10 && y < 30 ? [30, 60, 200] : [255, 255, 255];
    rgba.set([...c, 255], (y * w + x) * 4);
  }
  const q = quantize(rgba, w, h, 4);
  const find = c => q.palette.findIndex(p => Math.hypot(p[0] - c[0], p[1] - c[1], p[2] - c[2]) < 12);
  ok('Farben: drei Farben gefunden (Weiß, Rot, Blau), keine vierte erfunden', q.palette.length === 3 && find([255, 255, 255]) >= 0 && find([220, 30, 30]) >= 0 && find([30, 60, 200]) >= 0, JSON.stringify(q.palette));
  const blue = traceImage({ w, h, ink: inkOfColors(q.index, w, h, [find([30, 60, 200])]) }, { curves: 'fit' });
  ok('Farben: die blaue Fläche allein ergibt ein Rechteck 20 × 20', blue.length === 1 && blue[0].segs?.length === 4 && Math.abs(polyArea(blue[0].segs.map(s => s.a)) - 400) < 12, blue[0]?.segs ? polyArea(blue[0].segs.map(s => s.a)).toFixed(1) : '');
  const red = traceImage({ w, h, ink: inkOfColors(q.index, w, h, [find([220, 30, 30])]) }, { curves: 'fit', tolerance: 0.8 });
  ok('Farben: die rote Fläche allein ergibt einen Kreis R 10', red.length === 1 && !!red[0].circle && Math.abs(red[0].circle.r - 10) < 0.6, red[0]?.circle ? red[0].circle.r.toFixed(2) : 'kein Kreis');
  const svg = toSVG([{ closed: true, pts: [[0, 0], [1, 0], [1, 1]], color: '#dc1e1e' }, { closed: false, pts: [[0, 0], [1, 1]] }], 10, 10, 5, 5);
  ok('SVG: Farben als eigene Pfade', (svg.match(/<path/g) || []).length === 2 && /stroke="#dc1e1e"/.test(svg));
}
