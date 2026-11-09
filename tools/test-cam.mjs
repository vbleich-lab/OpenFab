// CAM tests without a browser: every strategy on a test part whose exact shape is known, checked for cuts into
// the part (and into the stock to leave), plus the NC output of every built-in post and the lathe operations.
// Run: npm run test:cam
import './lib/node-env.mjs';
const THREE = await import('three');
const { partBodies, testProject, checkMoves } = await import('./lib/testpart.mjs');
const cam = await import('../js/cam.js');
const post = await import('../js/post.js');
const { exampleTurning } = await import('../js/example.js');
const { turnCutShape } = await import('../js/turning.js');

const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
const TOL = 0.02; // finishing: exact triangle contacts - what is left is path sag between points and the mesh facets (dome ~0.005)
const ROUGH_TOL = 0.04; // roughing layers: offset contours approximate arcs by chords
const XY = z => ({ o: [0, 0, z], x: [1, 0, 0], n: [0, 0, 1] });
const bodies = partBodies();

// extra sketches some operations need
function project() {
  const p = testProject();
  p.features.push(
    { id: 'skBig', type: 'sketch', name: 'Große Bohrungen', plane: XY(10), entities: [[100, 60], [100, 70], [112, 65]].map(([cx, cy], i) => ({ id: 'g' + i, type: 'circle', cx, cy, r: 5 })) },
    { id: 'skSlot', type: 'sketch', name: 'Nut', plane: XY(10), entities: [{ id: 's1', type: 'slot', cx: 100, cy: 8, len: 12, w: 4, rot: 0 }] },
    { id: 'skGuide', type: 'sketch', name: 'Leitkurven', plane: XY(10), entities: [
      { id: 'l1', type: 'poly', closed: false, pts: [[44, 24], [80, 24]] },
      { id: 'l2', type: 'poly', closed: false, pts: [[44, 56], [80, 56]] },
    ] },
    { id: 'skDome', type: 'sketch', name: 'Kuppelbereich', plane: XY(10), entities: [{ id: 'd1', type: 'rect', x: 48, y: 26, w: 28, h: 28 }] },
  );
  p.cam.tools.push({ id: 'P1', number: 20, name: 'Taster', type: 'probe', dia: 4, rpm: 0, feed: 500, plunge: 300, stepdown: 1, stepover: 0.5 });
  return p;
}
const toolOf = (p, id) => p.cam.tools.find(t => t.id === id);

function run(op) {
  const p = project();
  p.cam.ops = [{ id: 'o1', name: op.type, setup: 'S1', enabled: true, ...op }];
  const t0 = performance.now();
  const g = cam.generateSetup(p, bodies, p.cam.setups[0], null, null);
  return { p, g, r: g.results.get('o1'), ms: Math.round(performance.now() - t0) };
}

// ---- 1. milling: every strategy generates, and the 3D ones stay out of the part ----
const SK = { contour: 'skBoss', pocket: 'skPocket', adaptive: 'skPocket', chamfer: 'skBoss', trace: 'skBoss', vcarve: 'skBoss', drill: 'skHoles', bore: 'skBig', thread: 'skBig', circular: 'skBig', slot: 'skSlot', blend3d: 'skGuide', guidemorph3d: 'skGuide', flow3d: 'skDome', morph3d: 'skDome', project3d: 'skDome', probe: 'skBoss' };
const TOOL = { drill: 'T3', thread: 'T6', bore: 'T1', circular: 'T1', slot: 'T2', chamfer: 'T5', vcarve: 'T5', deburr3d: 'T5', probe: 'P1', trace: 'T2' };
// these cut into geometry on purpose (edges, engraving) or into holes the test part does not model
const NO_GOUGE_CHECK = new Set(['chamfer', 'trace', 'vcarve', 'deburr3d', 'drill', 'bore', 'thread', 'circular', 'slot', 'probe', 'project3d']);
const EXTRA = { contour: { side: 'outside' }, probe: { probeMode: 'z' } };
const { TURN_OPS } = await import('../js/turning.js');
const MILL = Object.keys(cam.OP_TYPES).filter(t => !(t in TURN_OPS) && !t.startsWith('rotary'));

const cases = [];
for (const type of MILL) cases.push({ type, tool: TOOL[type] || (cam.OPS_3D.includes(type) ? 'T4' : 'T1') });
// flat end mill on the 3D strategies that are often used with one
for (const type of ['rough3d', 'adaptive3d', 'contour3d', 'horizontal3d', 'parallel3d']) cases.push({ type, tool: 'T1' });
// stock to leave must hold on steep walls too (measured normal to the surface)
for (const type of ['parallel3d', 'contour3d', 'spiral3d', 'scallop3d']) cases.push({ type, tool: 'T4', stockToLeave: 0.5 });

for (const c of cases) {
  const op = { type: c.type, tool: c.tool, ...(SK[c.type] ? { sketch: SK[c.type], entities: 'all' } : {}), ...(EXTRA[c.type] || {}) };
  if (c.stockToLeave != null) op.stockToLeave = c.stockToLeave;
  const { p, g, r, ms } = run(op);
  const label = `${c.type} (${c.tool}${c.stockToLeave != null ? ', Aufmaß ' + c.stockToLeave : ''})`;
  const n = r?.moves?.length || 0;
  if (r?.error || !n) { ok(label + ' erzeugt Bahnen', false, r?.error || 'keine Bewegungen'); continue; }
  if (NO_GOUGE_CHECK.has(c.type)) { ok(label + ' erzeugt Bahnen', true, `${n} Bewegungen, ${ms} ms`); continue; }
  const t = toolOf(p, c.tool);
  // effective stock to leave: the operation's own value, 0.3 is the default of the roughing strategies
  const stl = c.stockToLeave ?? (['rough3d', 'adaptive3d', 'pocket3d'].includes(c.type) ? 0.3 : 0);
  const chk = checkMoves(r.moves, g.T, { r: t.dia / 2, ball: t.type === 'ball' });
  const tol = ['rough3d', 'adaptive3d', 'pocket3d'].includes(c.type) ? ROUGH_TOL : TOL;
  const feedOk = chk.feed.pen <= tol - stl, rapidOk = chk.rapid.pen <= tol;
  ok(label + ' ohne Verletzung', feedOk && rapidOk,
    `${n} Bew., ${ms} ms, tiefster Punkt ${(chk.feed.pen + stl).toFixed(3)} mm ${stl ? 'ins Aufmaß' : 'ins Teil'}${feedOk ? '' : ' bei ' + JSON.stringify(chk.feed.at)}${rapidOk ? '' : `, Eilgang ${chk.rapid.pen.toFixed(3)} bei ${JSON.stringify(chk.rapid.at)}`}`);
}

// ---- 2. NC output of every milling post ----
// positions of linear/arc end points read back from the program (G-code words or Heidenhain L/C lines)
function readBack(code, hh) {
  const pts = [];
  const st = { X: null, Y: null, Z: null };
  for (let line of code.split('\n')) {
    line = line.replace(/\(.*?\)/g, '').replace(/;.*$/, '').trim();
    if (!line) continue;
    if (hh) {
      if (!/^\d*\s*(L|C)\s/.test(line) || /M9[12]/.test(line)) continue;
    } else if (/G(28|53|10|92)\b/.test(line) || /^%|^O\d/.test(line)) continue;
    let any = false;
    for (const a of ['X', 'Y', 'Z']) {
      const m = line.match(new RegExp(`(?:^|\\s|\\d)${a}([+-]?\\d*\\.?\\d+)`));
      if (m) { st[a] = +m[1]; any = true; }
    }
    if (any && st.X != null && st.Y != null && st.Z != null) pts.push([st.X, st.Y, st.Z]);
  }
  return pts;
}
const bbox = pts => pts.reduce((b, q) => q.map((v, i) => [Math.min(b[i][0], v), Math.max(b[i][1], v)]), [[Infinity, -Infinity], [Infinity, -Infinity], [Infinity, -Infinity]]);
{
  const p = project();
  const o = { setup: 'S1', enabled: true };
  p.cam.ops = [
    { ...o, id: 'a', type: 'face', tool: 'T1' },
    { ...o, id: 'b', type: 'contour', tool: 'T1', sketch: 'skBoss', entities: 'all', side: 'outside' },
    { ...o, id: 'c', type: 'pocket', tool: 'T1', sketch: 'skPocket', entities: 'all' },
    { ...o, id: 'd', type: 'drill', tool: 'T3', sketch: 'skHoles', entities: 'all' },
    { ...o, id: 'e', type: 'parallel3d', tool: 'T4', boundary: 'box' },
  ];
  const g = cam.generateSetup(p, bodies, p.cam.setups[0], null, null);
  g.setup = p.cam.setups[0];
  const org = cam.originOf(g.setup, g.stock);
  // where the CAM moves go, in program coordinates (without the retract/safe heights the posts add)
  const all = [...g.results.values()].flatMap(r => r.moves || []).filter(m => Number.isFinite(m.x));
  const cb = bbox(all.map(m => [m.x - org.x, m.y - org.y, m.z - org.z]));
  for (const def of post.BUILTIN_POSTS.filter(d => !d.lathe)) {
    let res;
    try { res = post.postProcess(p, g, null, { postId: def.id }); } catch (e) { ok(`Post ${def.id} läuft`, false, e.message); continue; }
    const code = res.code;
    const bad = code.match(/NaN|undefined|Infinity|null|\[object/);
    ok(`Post ${def.id}: keine ungültigen Werte`, !bad, bad ? `„${bad[0]}“ in Zeile ${code.slice(0, bad.index).split('\n').length}` : `${res.lines} Zeilen`);
    const hh = post.postFamily(def) === 'heidenhain';
    if (hh) ok(`Post ${def.id}: Programmrahmen`, /BEGIN PGM (\S+)/.test(code) && code.includes('END PGM ' + code.match(/BEGIN PGM (\S+)/)[1]));
    else ok(`Post ${def.id}: Programmende`, /\bM(30|2|02)\b/.test(code));
    const pts = readBack(code, hh);
    const b = bbox(pts);
    // read-back positions must lie inside the CAM range (arc fitting keeps end points on the path) and span it
    const inside = [0, 1].every(i => b[i][0] >= cb[i][0] - 0.01 && b[i][1] <= cb[i][1] + 0.01) && b[2][0] >= cb[2][0] - 0.01;
    const spans = [0, 1].every(i => b[i][1] - b[i][0] >= 0.95 * (cb[i][1] - cb[i][0])) && Math.abs(b[2][0] - cb[2][0]) < 0.01;
    ok(`Post ${def.id}: Positionen passen zur Bahn`, pts.length > 50 && inside && spans,
      `${pts.length} Punkte, X ${b[0].map(v => v.toFixed(2))} / Bahn ${cb[0].map(v => v.toFixed(2))}, Z min ${b[2][0].toFixed(3)} / ${cb[2][0].toFixed(3)}`);
  }
}

// ---- 3. turning: the example shaft as a mesh, all operations and lathe posts ----
{
  const p = exampleTurning();
  p.machines = []; p.posts = [];
  const prof = p.features[0].entities[0].pts.map(([r, z]) => new THREE.Vector2(r, z));
  prof.push(prof[0].clone());
  const geo = new THREE.LatheGeometry(prof, 256);
  geo.rotateX(Math.PI / 2);
  const st = p.cam.setups[0];
  const g = cam.generateSetup(p, [{ id: 'shaft', geometry: geo.toNonIndexed() }], st, null, null);
  g.setup = st;
  for (const op of p.cam.ops) {
    const r = g.results.get(op.id);
    ok(`Drehen ${op.name}`, r && !r.error && r.moves?.length > 0, r?.error || `${r?.moves?.length} Bewegungen`);
  }
  // finishing must follow the outer contour: never inside the profile radius (with the nose radius a bit outside)
  const fin = g.results.get('t3').moves.filter(m => Number.isFinite(m.x) && Number.isFinite(m.z)); // feed and rapid moves
  const pr = p.features[0].entities[0].pts;
  // depth of a point (r, z) inside the profile polygon (negative = outside, by its distance to the outline)
  const depth = (r, z) => {
    let inside = false, dmin = Infinity;
    for (let i = 0; i < pr.length; i++) {
      const [r0, z0] = pr[i], [r1, z1] = pr[(i + 1) % pr.length];
      if ((z0 > z) !== (z1 > z) && r < r0 + ((r1 - r0) * (z - z0)) / (z1 - z0)) inside = !inside;
      const dr = r1 - r0, dz = z1 - z0, L2 = dr * dr + dz * dz;
      const u = L2 ? Math.max(0, Math.min(1, ((r - r0) * dr + (z - z0) * dz) / L2)) : 0;
      dmin = Math.min(dmin, Math.hypot(r - r0 - u * dr, z - z0 - u * dz));
    }
    return inside ? dmin : -dmin;
  };
  // the program follows the theoretical tip; the cutting edge (nose rounding + trailing edge, as OpenFab models
  // the insert) must not reach into the contour anywhere along the moves
  const sh = turnCutShape(p.cam.tools.find(t => t.id === 'L1'));
  let worst = -Infinity, at = null;
  for (let k = 1; k < fin.length; k++) {
    const a = fin[k - 1], b = fin[k], n = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.z - a.z) / 0.02));
    for (let q = 0; q <= n; q++) {
      const x = a.x + ((b.x - a.x) * q) / n, z = a.z + ((b.z - a.z) * q) / n;
      for (let d = sh.lo; d <= Math.min(sh.hi, 3) + 1e-9; d += 0.01) {
        const e = depth(sh.at(x, d), z + d);
        if (e > worst) { worst = e; at = [+x.toFixed(3), +z.toFixed(3)]; }
      }
    }
  }
  ok('Drehen Konturschlichten: Schneide bleibt außerhalb der Kontur', worst <= 0.01, `tiefster Punkt ${worst.toFixed(3)} mm bei r/z ${JSON.stringify(at)}`);
  const top = g.stock.modelTop;
  const all = [...g.results.values()].flatMap(r => r.moves || []).filter(m => Number.isFinite(m.x));
  const zMin = Math.min(...all.map(m => m.z)) - top, xMax = 2 * Math.max(...all.map(m => m.x));
  for (const def of post.BUILTIN_POSTS.filter(d => d.lathe)) {
    let res;
    try { res = post.postProcess(p, g, null, { postId: def.id }); } catch (e) { ok(`Post ${def.id} läuft`, false, e.message); continue; }
    const bad = res.code.match(/NaN|undefined|Infinity|null|\[object/);
    ok(`Post ${def.id}: keine ungültigen Werte`, !bad, bad ? `„${bad[0]}“` : `${res.lines} Zeilen`);
    const zs = [...res.code.matchAll(/\bZ(-?\d*\.?\d+)/g)].map(m => +m[1]), xs = [...res.code.matchAll(/\bX(-?\d*\.?\d+)/g)].map(m => +m[1]);
    ok(`Post ${def.id}: Z und X (Durchmesser) im Bereich`, Math.abs(Math.min(...zs) - zMin) < 0.01 && Math.max(...xs) <= xMax + 0.01,
      `Z min ${Math.min(...zs)} / ${zMin.toFixed(3)}, X max ${Math.max(...xs)} / ${xMax.toFixed(3)}`);
  }

  // roughing + finishing as the control's cycles: G71 … G70 (Fanuc), G85 … G87 (Okuma) on the same contour
  for (const o of p.cam.ops) if (o.id === 't2' || o.id === 't3') o.ctrlCycle = true;
  const gc = cam.generateSetup(p, [{ id: 'shaft', geometry: geo.toNonIndexed() }], st, null, null);
  gc.setup = st;
  const tc = gc.results.get('t2').turnCycle;
  ok('Drehzyklus: Schruppkontur vorhanden', !!tc && tc.pts.length > 2, tc ? `${tc.pts.length} Punkte, Aufmaß U ${2 * tc.u}` : gc.results.get('t2').turnCycleWhy);
  if (tc) {
    // the contour is what G70 / G87 finish along: the cutting edge must stay outside the part along it
    let w = -Infinity, wat = null;
    for (let k = 1; k < tc.pts.length; k++) {
      const [ax, az] = tc.pts[k - 1], [bx, bz] = tc.pts[k], n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.02));
      for (let q = 0; q <= n; q++) {
        const x = ax + ((bx - ax) * q) / n, z = az + ((bz - az) * q) / n;
        for (let d = sh.lo; d <= Math.min(sh.hi, 3) + 1e-9; d += 0.01) {
          const e = depth(sh.at(x, d), z + d);
          if (e > w) { w = e; wat = [+x.toFixed(3), +z.toFixed(3)]; }
        }
      }
    }
    ok('Drehzyklus: Schlichtkontur verletzt das Teil nicht', w <= 0.01, `tiefster Punkt ${w.toFixed(3)} mm bei r/z ${JSON.stringify(wat)}`);
  }
  const cyc = { 'fanuc-lathe': [/G71 P(\d+) Q(\d+) U0\.6 /, /G70 P(\d+) Q(\d+)/], 'okuma-lathe': [/G85 N(\d+) .*U0\.6 /, /G87 N(\d+)/] };
  for (const [id, [reR, reF]] of Object.entries(cyc)) {
    const res = post.postProcess(p, gc, null, { postId: id });
    const mr = res.code.match(reR), mf = res.code.match(reF);
    const fail = res.warnings.find(x => /Schlichtzyklus nicht möglich/.test(x));
    ok(`Post ${id}: Schlichtzyklus auf der Kontur des Schruppzyklus`, !!mr && !!mf && mr.slice(1).join() === mf.slice(1).join() && !fail,
      fail || `${mr?.[0] ?? 'kein Schruppzyklus'} → ${mf?.[0] ?? 'kein Schlichtzyklus'}`);
    // the finishing feed sits in the first contour block (only the finishing cycle uses it)
    const first = id === 'fanuc-lathe' ? res.code.split('\n').find(l => new RegExp(`^N${mr?.[1]} `).test(l)) : res.code.split('\n')[res.code.split('\n').findIndex(l => /^N\d+ G81/.test(l)) + 1];
    ok(`Post ${id}: Schlichtvorschub im ersten Konturblock`, / F300\b/.test(first || ''), first || '–');
  }
}

// ---- 4. hole patterns and hole order ----
{
  const grid = []; for (let i = 0; i < 4; i++) for (let j = 0; j < 3; j++) grid.push([10 + 15 * i, 5 + 12 * j]);
  const hg = post.holePatterns(grid);
  ok('Lochmuster: Raster 4×3 erkannt', hg.groups.length === 1 && hg.groups[0].kind === 'grid' && hg.groups[0].nc * hg.groups[0].nr === 12, JSON.stringify(hg.groups.map(q => q.kind)));
  const circ = Array.from({ length: 8 }, (_, k) => [50 + 20 * Math.cos(k * Math.PI / 4), 40 + 20 * Math.sin(k * Math.PI / 4)]);
  const hc = post.holePatterns(circ);
  ok('Lochmuster: Lochkreis 8× erkannt', hc.groups.length === 1 && hc.groups[0].kind === 'circle' && Math.abs(hc.groups[0].r - 20) < 1e-6, JSON.stringify(hc.groups.map(q => q.kind)));
  const mixed = [...grid, ...circ.map(([x, y]) => [x + 100, y]), [5, 90]];
  const hm = post.holePatterns(mixed);
  const covered = hm.groups.reduce((s, q) => s + q.pts.length, 0) + hm.singles.length;
  ok('Lochmuster: gemischt – alle Bohrungen genau einmal', covered === mixed.length, `${hm.groups.length} Muster, ${hm.singles.length} einzeln`);

  let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const holes = Array.from({ length: 300 }, (_, i) => ({ id: i, x: rnd() * 200, y: rnd() * 150 }));
  const o = cam.orderHoles(holes, h => [h.x, h.y], 'shortest');
  ok('Bohrreihenfolge: jede Bohrung genau einmal', o.items.length === 300 && new Set(o.items.map(h => h.id)).size === 300);
  ok('Bohrreihenfolge: kürzer als die Eingabereihenfolge', o.len < o.before * 0.3, `${o.len.toFixed(0)} statt ${o.before.toFixed(0)} mm`);
}
