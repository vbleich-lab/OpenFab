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

// every strategy as a Heidenhain program: each block checked against the Klartext rules (tools/lib/hh-lint.mjs)
const { lintHeidenhain, lintSummary } = await import('./lib/hh-lint.mjs');
function hhLint(p, g, label) {
  g.setup = p.cam.setups[0];
  let res;
  try { res = post.postProcess(p, g, null, { postId: 'heidenhain' }); } catch (e) { ok(label + ' Heidenhain-Klartext', false, e.message); return; }
  const is = lintHeidenhain(res.code);
  ok(label + ' Heidenhain-Klartext fehlerfrei', is.length === 0, is.length ? lintSummary(is).slice(0, 4).map(q => `${q.n}× ${q.msg} [${q.first}]`).join(' ‖ ') : `${res.lines} Sätze`);
}

for (const c of cases) {
  const op = { type: c.type, tool: c.tool, ...(SK[c.type] ? { sketch: SK[c.type], entities: 'all' } : {}), ...(EXTRA[c.type] || {}) };
  if (c.stockToLeave != null) op.stockToLeave = c.stockToLeave;
  const { p, g, r, ms } = run(op);
  const label = `${c.type} (${c.tool}${c.stockToLeave != null ? ', Aufmaß ' + c.stockToLeave : ''})`;
  const n = r?.moves?.length || 0;
  if (r?.error || !n) { ok(label + ' erzeugt Bahnen', false, r?.error || 'keine Bewegungen'); continue; }
  hhLint(p, g, label);
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

// ---- 1b. links over the remaining material ("Kürzester sicherer Weg") ----
// After roughing, the finishing strategies with many links: rapids must stay clear of the part (exact shapes)
// and of the material still standing – checked on an own, finer height field cut by all feed moves in order.
{
  const o = { setup: 'S1', enabled: true };
  const rough = { ...o, id: 'r', name: 'Schruppen', type: 'rough3d', tool: 'T1', strategy: 'adaptive', stepover: 0.12, stepdown: 9, stockToLeave: 0.3, ramp: 2 };
  for (const [type, tool, extra] of [['steep3d', 'T4', { stepdown: 0.5 }], ['corner3d', 'T4', {}], ['spiral3d', 'T4', {}], ['contour3d', 'T1', { stepdown: 0.5 }], ['horizontal3d', 'T1', {}]]) {
    const gen = pol => {
      const p = project();
      p.cam.ops = [rough, { ...o, id: 'o1', name: type, type, tool, ...extra, retractPolicy: pol }];
      return { p, g: cam.generateSetup(p, bodies, p.cam.setups[0], null, null) };
    };
    const full = gen('full'), { p, g } = gen('stock');
    const r = g.results.get('o1'), r0 = full.g.results.get('o1'), st = g.stock;
    if (r.error || r0.error) { ok(`Kurze Wege ${type}: erzeugt`, false, r.error || r0.error); continue; }
    // own stock model: 0.25 mm cells, a cell is cut when its centre lies under the tool
    const res = 0.25, nx = Math.round((st.maxX - st.minX) / res) + 1, ny = Math.round((st.maxY - st.minY) / res) + 1, H = new Float32Array(nx * ny).fill(st.top);
    let worst = Infinity, at = null;
    const each = (m, R, fn) => {
      const i0 = Math.max(0, Math.ceil((m.x - R - st.minX) / res)), i1 = Math.min(nx - 1, Math.floor((m.x + R - st.minX) / res));
      const j0 = Math.max(0, Math.ceil((m.y - R - st.minY) / res)), j1 = Math.min(ny - 1, Math.floor((m.y + R - st.minY) / res));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) { const d2 = (st.minX + i * res - m.x) ** 2 + (st.minY + j * res - m.y) ** 2; if (d2 <= R * R) fn(j * nx + i, d2); }
    };
    for (const id of ['r', 'o1']) {
      const rr = g.results.get(id), t = toolOf(p, id === 'r' ? 'T1' : tool), R = t.dia / 2, ball = t.type === 'ball';
      const zAt = (z, d2) => (ball ? z + R - Math.sqrt(Math.max(0, R * R - d2)) : z);
      for (let k = 1; k < rr.moves.length; k++) {
        const a = rr.moves[k - 1], b = rr.moves[k], L = Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z), n = Math.max(1, Math.ceil(L / 0.1));
        for (let q = 1; q <= n; q++) {
          const m = { x: a.x + ((b.x - a.x) * q) / n, y: a.y + ((b.y - a.y) * q) / n, z: a.z + ((b.z - a.z) * q) / n };
          if (b.t !== 'r') each(m, R, (c, d2) => { const z = zAt(m.z, d2); if (z < H[c]) H[c] = z; });
          // rapids of the finishing operation: clearance of the tool (shrunk by one cell at the rim) above the material
          // (the straight lift out of a cut and the drop back to the old start height are as before: only travel counts)
          else if (id === 'o1' && Math.hypot(b.x - a.x, b.y - a.y) > 1e-6) each(m, R - res, (c, d2) => { const cl = zAt(m.z, d2) - H[c]; if (cl < worst) { worst = cl; at = [+m.x.toFixed(2), +m.y.toFixed(2), +m.z.toFixed(2)]; } });
        }
      }
    }
    const t = toolOf(p, tool), chk = checkMoves(r.moves, g.T, { r: t.dia / 2, ball: t.type === 'ball' });
    ok(`Kurze Wege ${type}: Eilgänge frei vom Teil und vom Restmaterial`, chk.rapid.pen <= TOL && worst >= 0.5, `Abstand zum Restmaterial mindestens ${worst.toFixed(2)} mm${worst < 0.5 ? ' bei ' + JSON.stringify(at) : ''}, ins Teil ${chk.rapid.pen.toFixed(3)}`);
    ok(`Kurze Wege ${type}: Schnittbahn unverändert, kürzere Laufzeit`, Math.abs(r.moves.filter(m => m.t !== 'r').length - r0.moves.filter(m => m.t !== 'r').length) === 0 && r.time < r0.time * 0.97 && chk.feed.pen <= TOL,
      `${(r0.time / 60).toFixed(1)} → ${(r.time / 60).toFixed(1)} min, ${r.shortLinks?.n ?? 0} Wege verkürzt`);
  }
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
    // (the turret indexes at the tool change position: 200 mm outside in diameter, 100 mm in front of the face)
    const tc = l => /^G0 X[\d.]+ Z[\d.]+$/.test(l) && Math.abs(+l.match(/X([\d.]+)/)[1] - (xMax + 200)) < 0.01;
    const body = res.code.split('\n').filter(l => !tc(l)).join('\n');
    const zs = [...body.matchAll(/\bZ(-?\d*\.?\d+)/g)].map(m => +m[1]), xs = [...body.matchAll(/\bX(-?\d*\.?\d+)/g)].map(m => +m[1]);
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

  // driven tools (C axis): 4 axial holes on the face and 3 cross holes, before parting off
  {
    const q = exampleTurning();
    q.machines = []; q.posts = [];
    const sq = q.cam.setups[0];
    q.cam.tools.push({ id: 'L8', number: 18, name: 'Bohrer Ø2 angetrieben', type: 'drill', dia: 2, angle: 118, fluteLen: 15, length: 40, rpm: 4000, feed: 120, plunge: 80, stepdown: 1, stepover: 0.5 });
    const base = { setup: sq.id, enabled: true, tool: 'L8', type: 'tlive' };
    const part = q.cam.ops.pop();
    q.cam.ops.push(
      { ...base, id: 'lv1', name: 'Lochkreis axial', dir: 'axial', pitchDia: 14.5, count: 4, startAngle: 45, depth: 5, peck: 2 },
      { ...base, id: 'lv2', name: 'Querbohrungen', dir: 'radial', z: 15, angles: '0; 120; 240', depth: 8 },
      part);
    const gl = cam.generateSetup(q, [{ id: 'shaft', geometry: geo.toNonIndexed() }], sq, null, null);
    gl.setup = sq;
    const r1 = gl.results.get('lv1'), r2 = gl.results.get('lv2'), topZ = gl.stock.modelTop;
    ok('Angetrieben axial: erzeugt', r1 && !r1.error && r1.live === 'ax', r1?.error || `${r1?.moves.length} Bewegungen`);
    ok('Angetrieben radial: erzeugt', r2 && !r2.error && r2.live === 'rad', r2?.error || `${r2?.moves.length} Bewegungen`);
    const feeds = r => (r?.moves || []).filter(m => m.t === 'f' && m.live);
    const deep = (r, k) => { const by = new Map(); for (const m of feeds(r)) by.set(m.c, Math.min(by.get(m.c) ?? Infinity, m[k])); return by; };
    const d1 = deep(r1, 'z'), d2 = deep(r2, 'xr');
    ok('Angetrieben axial: 4 Bohrungen bei C45/135/225/315, Tiefe 5 ab Planfläche', [...d1.keys()].join() === '45,135,225,315' && [...d1.values()].every(z => Math.abs(z - (topZ - 5)) < 1e-6) && feeds(r1).every(m => Math.abs(m.xr - 7.25) < 1e-9),
      JSON.stringify([...d1]));
    ok('Angetrieben axial: Entspanen in 2-mm-Schritten', feeds(r1).length === 12, `${feeds(r1).length} Vorschubbewegungen`);
    ok('Angetrieben radial: 3 Bohrungen bei C0/120/240 bis Radius 7 (Ø30, Tiefe 8)', [...d2.keys()].join() === '0,120,240' && [...d2.values()].every(x => Math.abs(x - 7) < 1e-6) && feeds(r2).every(m => Math.abs(m.z - 15) < 1e-9),
      JSON.stringify([...d2]));
    // position on the part: radius xr turned by c
    const bad = [...(r1?.moves || []), ...(r2?.moves || [])].filter(m => m.live && (Math.abs(m.x - m.xr * Math.cos((m.c * Math.PI) / 180)) > 1e-9 || Math.abs(m.y - m.xr * Math.sin((m.c * Math.PI) / 180)) > 1e-9));
    ok('Angetrieben: Lage am Teil = Radius um C gedreht', bad.length === 0, `${bad.length} Abweichungen`);
    // rapids never inside the part: axial above the stock, radial outside the turned diameter
    const rIn = [...(r1?.moves || [])].filter(m => m.live && m.t === 'r' && m.z < gl.stock.top + 0.99).length;
    const peckBack = feeds(r1).length - 4; // rapids back into the hole after chip breaking
    ok('Angetrieben axial: Eilgang nur über dem Rohteil oder zurück in die Bohrung', rIn === peckBack, `${rIn} Eilgänge unter Rohteil + 1 mm, ${peckBack} Rückwege`);
    const want = { 'fanuc-lathe': [/^M45$/m, /^M46$/m, /^G97 S4000 M13$/m], 'okuma-lathe': [/^M110$/m, /^M109$/m, /^SB=4000 M13$/m], 'linuxcnc-lathe': [/^M5 \$0$/m, /^M5 \$1$/m, /^S4000 M3 \$1$/m] };
    for (const def of post.BUILTIN_POSTS.filter(d => d.lathe)) {
      const res = post.postProcess(q, gl, null, { postId: def.id });
      const code = res.code, [on, off, spin] = want[def.id] || [];
      const badV = code.match(/NaN|undefined|Infinity|null|\[object/);
      ok(`Post ${def.id} angetrieben: C-Achse ein/aus und Werkzeugspindel`, !badV && on?.test(code) && off?.test(code) && spin?.test(code), badV ? `„${badV[0]}“` : '');
      // axial: X = pitch circle Ø with C, feed in Z; radial: Z15 with C120, feed to X14
      const lines = code.split('\n');
      const iOn = lines.findIndex(l => on?.test(l)), iOff = lines.findIndex((l, i) => i > iOn && off?.test(l));
      const body = lines.slice(iOn, iOff).join('\n');
      ok(`Post ${def.id} angetrieben: Lochkreis X14.5 mit C45/C135/C225/C315`, /X14\.5 C45/.test(body) && /C135/.test(body) && /C225/.test(body) && /C315/.test(body) && /G1 Z-5\.?$/m.test(body), (body.match(/.*C45.*/) || ['–'])[0]);
      ok(`Post ${def.id} angetrieben: Querbohrung bei Z-55 bis X14, C0/C120/C240`, /G1 X14\.?( F80)?$/m.test(body) && /C120/.test(body) && /C240/.test(body) && /Z-55\.?( |$)/m.test(body), (body.match(/.*C120.*/) || ['–'])[0]);
      // after the driven tool the main spindle runs again for parting off, and no C word is left there
      const tail = lines.slice(iOff + 1).join('\n');
      ok(`Post ${def.id} angetrieben: danach Hauptspindel ein, kein C mehr`, /S1000 M3/.test(tail) && !/\bC-?\d/.test(tail), (tail.match(/.*S1000 M3.*/) || ['–'])[0]);
      ok(`Post ${def.id} angetrieben: Hinweis auf maschinenabhängige M-Codes`, res.warnings.some(w => /maschinenabhängig/.test(w)));
    }

    // driven milling: two keyways on the Ø30 section and two flats (width 16) at the Ø20 end
    q.cam.tools.push({ id: 'L9', number: 19, name: 'Schaftfräser Ø6 angetrieben', type: 'flat', dia: 6, flutes: 3, fluteLen: 16, length: 50, rpm: 3000, feed: 200, plunge: 60, stepdown: 1, stepover: 0.5 });
    q.cam.ops = q.cam.ops.filter(o => o.type !== 'tlive' && o.type !== 'tpart');
    const mb = { setup: sq.id, enabled: true, tool: 'L9' };
    q.cam.ops.push(
      { ...mb, id: 'ms1', type: 'tslot', name: 'Passfedernuten', zStart: 28, zEnd: 10, depth: 3, count: 2, startAngle: 0, stepdown: 1.5 },
      { ...mb, id: 'mf1', type: 'tflat', name: 'Zweiflach SW16', width: 16, length: 8, count: 2, startAngle: 0 });
    const gm = cam.generateSetup(q, [{ id: 'shaft', geometry: geo.toNonIndexed() }], sq, null, null);
    gm.setup = sq;
    const rs = gm.results.get('ms1'), rf = gm.results.get('mf1');
    ok('Nut angetrieben: erzeugt', rs && !rs.error && rs.live === 'rad', rs?.error || `${rs?.moves.length} Bewegungen`);
    ok('Schlüsselflächen: erzeugt', rf && !rf.error && rf.polar === true, rf?.error || `${rf?.moves.length} Bewegungen`);
    const sf = (rs?.moves || []).filter(m => m.t === 'f' && m.live);
    ok('Nut angetrieben: C0 und C180, Z 10…28, Grund auf Radius 12 in 2 Zustellungen',
      [...new Set(sf.map(m => m.c))].join() === '0,180' && sf.every(m => m.z >= 10 - 1e-9 && m.z <= 28 + 1e-9 && m.xr >= 12 - 1e-9) && Math.abs(Math.min(...sf.map(m => m.xr)) - 12) < 1e-9 && [...new Set(sf.map(m => +m.xr.toFixed(3)))].join() === '13.5,12',
      `Radien ${[...new Set(sf.map(m => +m.xr.toFixed(3)))].join('/')}, Z ${Math.min(...sf.map(m => m.z))}…${Math.max(...sf.map(m => m.z))}`);
    // each pass of a flat: a straight line at 8 + 3 mm from the axis, from outside the round to outside the round
    const mvF = rf?.moves || [];
    let passes = 0, worstD = 0, minEnd = Infinity;
    for (let k = 1; k < mvF.length; k++) {
      const a = mvF[k - 1], b2 = mvF[k];
      if (!(b2.polar && b2.t === 'f')) continue;
      passes++;
      const L = Math.hypot(b2.x - a.x, b2.y - a.y), dist = Math.abs(a.x * (b2.y - a.y) - a.y * (b2.x - a.x)) / L;
      worstD = Math.max(worstD, Math.abs(dist - 11));
      minEnd = Math.min(minEnd, Math.hypot(a.x, a.y), Math.hypot(b2.x, b2.y));
    }
    ok('Schlüsselflächen: 2 gerade Bahnen im Abstand 11 mm (SW16 + Fräserradius), Z bis 8 mm unter der Planfläche', passes === 2 && worstD < 1e-6 && mvF.filter(m => m.polar && m.t === 'f').every(m => Math.abs(m.z - (topZ - 8)) < 1e-9), `${passes} Bahnen, Abweichung ${worstD.toExponential(1)}`);
    ok('Schlüsselflächen: Ein- und Ausfahren außerhalb des Runden (Radius ≥ 14)', minEnd >= 14 - 1e-6, `kleinster Radius am Bahnende ${minEnd.toFixed(3)}`);
    {
      const res = post.postProcess(q, gm, null, { postId: 'fanuc-lathe' });
      const lines = res.code.split('\n'), i0 = lines.indexOf('G12.1'), i1 = lines.indexOf('G13.1');
      const body = lines.slice(i0 + 1, i1);
      ok('Post fanuc-lathe: Flächen in Polar-Interpolation G12.1 … G13.1 ohne G0', i0 > 0 && i1 > i0 && lines[i0 - 1] === 'G0 C0' && !body.some(l => /\bG0\b/.test(l)) && body.some(l => /^G1 X22\. Z[\d.]+ C-8\.66 F5000$/.test(l)) && body.includes('C8.66 F200') && body.includes('X-22.') && body.includes('C-8.66 F200'),
        body.find(l => /C8\.66/.test(l)) || lines.slice(i0, i0 + 4).join(' | '));
      ok('Post fanuc-lathe: Nut mit C180 und Vorschub in Z', /C180\./.test(res.code) && /^Z-60\. F200$/m.test(res.code), (res.code.match(/.*C180.*/) || ['–'])[0]);
    }
    {
      // no polar template: short X/C steps in degrees close to the straight line, with a warning
      const res = post.postProcess(q, gm, null, { postId: 'okuma-lathe' });
      const lines = res.code.split('\n'), i0 = lines.findIndex(l => /Zweiflach/.test(l));
      let x = null, c = null, n = 0, dev = 0, feedOn = false;
      for (const l of lines.slice(i0)) {
        const g = l.match(/^G([01])\b/); if (g) feedOn = g[1] === '1';
        const mx = l.match(/X(-?[\d.]+)/), mc = l.match(/C(-?[\d.]+)/);
        if (mx) x = +mx[1] / 2; if (mc) c = +mc[1];
        if (!feedOn || x == null || c == null || !(mx || mc)) continue;
        // distance from the axis along the flat's direction (0° or 180°): must stay at 11 mm
        n++;
        dev = Math.max(dev, Math.abs(Math.abs(x * Math.cos((c * Math.PI) / 180)) - 11));
      }
      ok('Post okuma-lathe: Flächen als X/C-Schritte nahe der Geraden, mit Hinweis', n > 20 && dev < 0.02 && res.warnings.some(w => /Polar-Interpolation/.test(w)), `${n} Schritte, Abweichung ${dev.toFixed(4)} mm`);
    }
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
