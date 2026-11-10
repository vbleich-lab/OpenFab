// Lathe posts (Fanuc, Okuma OSP-L, LinuxCNC): the example shaft with every operation – turning, bore work,
// threads, driven tools on the C axis – as toolpaths and as control cycles, checked block by block with
// tools/lib/lathe-lint.mjs.
// Run: npm run test:lathe
import './lib/node-env.mjs';
import fs from 'fs';
const cam = await import('../js/cam.js');
const post = await import('../js/post.js');
const { lintLathe } = await import('./lib/lathe-lint.mjs');
const { lintSummary } = await import('./lib/hh-lint.mjs');
const { turnCase } = await import('./lib/turncase.mjs');

const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
const dumpDir = process.argv[2];
const POSTS = { 'fanuc-lathe': 'fanuc', 'okuma-lathe': 'okuma', 'linuxcnc-lathe': 'linuxcnc' };
const VARIANTS = { Standard: {}, 'Satznummern + M1 + ohne Kommentare': { lineNumbers: true, optionalStop: true, structureComments: false, writeToolList: false }, 'Wechselposition X400 Z250': { tcX: 400, tcZ: 250 } };
for (const cycles of [false, true]) {
  const { p, st, bodies } = turnCase(cycles);
  const g = cam.generateSetup(p, bodies, st, null, null);
  g.setup = st;
  if (!cycles) for (const op of g.ops) { const r = g.results.get(op.id); ok(`Erzeugt: ${op.name}`, r && !r.error && r.moves?.length > 0, r?.error || ''); }
  if (!cycles) {
    // distance of a point from a polyline
    const distTo = (q, pts, closed) => {
      let d = Infinity;
      for (let i = 0; i + 1 < pts.length + (closed ? 1 : 0); i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length], ux = b[0] - a[0], uy = b[1] - a[1], L2 = ux * ux + uy * uy;
        const t = L2 ? Math.max(0, Math.min(1, ((q[0] - a[0]) * ux + (q[1] - a[1]) * uy) / L2)) : 0;
        d = Math.min(d, Math.hypot(q[0] - a[0] - t * ux, q[1] - a[1] - t * uy));
      }
      return d;
    };
    const sk = id => p.features.find(f => f.id === id).entities;
    const top = g.stock.modelTop;
    // contour on the face: the cutter centre follows the sketch curves, in two levels down to 1.5 mm
    const rf = g.results.get('fc1'), ff = rf.moves.filter(m => m.t === 'f' && m.polar);
    const dev = Math.max(...ff.map(m => Math.min(...sk('skFace').map(e => distTo([m.x, m.y], e.pts, e.closed)))));
    const zsF = [...new Set(ff.map(m => +(top - m.z).toFixed(3)))].sort((a, b) => a - b);
    ok('Kontur Planfläche: Bahn liegt auf den Skizzenkurven, Tiefen 0,75 und 1,5 mm', rf.polar === true && dev < 1e-6 && zsF.join() === '0.75,1.5', `Abweichung ${dev.toExponential(1)}, Tiefen ${zsF.join('/')}`);
    ok('Kontur Planfläche: Eilgänge nur über dem Rohteil', rf.moves.filter(m => m.t === 'r' && m.polar).every(m => m.z >= g.stock.top + 1 - 1e-9));
    // pocket on the face: the cutter centre stays one tool radius inside the outline, reaches the floor, covers
    // the pocket (no point of it further than the stepover + radius from a path), and lifts once per level
    {
      const rp = g.results.get('tp1'), fp = rp.moves.filter(m => m.t === 'f' && m.polar);
      const X0 = -2.5, X1 = 2.5, Y0 = 5.2, Y1 = 9.2, R = 1;
      const inside = fp.every(m => m.x >= X0 + R - 1e-3 && m.x <= X1 - R + 1e-3 && m.y >= Y0 + R - 1e-3 && m.y <= Y1 - R + 1e-3);
      const floor = fp.filter(m => Math.abs(m.z - (top - 2)) < 1e-9);
      let gap = 0;
      for (let x = X0 + R; x <= X1 - R + 1e-9; x += 0.1) for (let y = Y0 + R; y <= Y1 - R + 1e-9; y += 0.1) gap = Math.max(gap, distTo([x, y], floor.map(m => [m.x, m.y]), false));
      const lifts = rp.moves.filter((m, i) => m.polar && m.t === 'r' && i && rp.moves[i - 1].t === 'f').length;
      ok('Tasche Planfläche: Fräser bleibt in der Kontur, erreicht den Grund, räumt alles', rp.polar === true && inside && floor.length > 4 && gap <= 0.6, `Grundpunkte ${floor.length}, größter Abstand eines Taschenpunkts von der Bahn ${gap.toFixed(2)} mm (Fräserradius 1)`);
      ok('Tasche Planfläche: Rampe statt senkrechtem Eintauchen, ein Abheben pro Ebene', lifts === 2 && !fp.some((m, i) => { const a = rp.moves[rp.moves.indexOf(m) - 1]; return a && Math.hypot(m.x - a.x, m.y - a.y) < 1e-6 && m.z < a.z - 0.3; }), `${lifts} Abheben`);
    }
    // wrapped contour: angle and Z unwound again must lie on the sketch (Ø30: 1 mm of sketch = 3.8197°)
    const rw = g.results.get('wr1'), fw = rw.moves.filter(m => m.t === 'f' && m.live === 'rad');
    const back = m => [((m.c + 90) * Math.PI / 180) * 15, m.z];
    const devW = Math.max(...fw.map(m => Math.min(...sk('skWrap').map(e => distTo(back(m), e.pts, false)))));
    const radii = [...new Set(fw.map(m => +m.xr.toFixed(3)))].sort((a, b) => b - a);
    ok('Kontur Mantelfläche: abgewickelt liegt die Bahn auf den Skizzenkurven, Radien 14 und 13', rw.cyl === 15 && devW < 1e-3 && radii.join() === '14,13', `Abweichung ${devW.toExponential(1)}, Radien ${radii.join('/')}, Abwickelradius ${rw.cyl}`);
    const span = fw.filter(m => Math.abs(m.z - 8) < 1e-9).map(m => m.c);
    ok('Kontur Mantelfläche: waagerechte Strecke von 20 mm wird ein Bogen von 76,39°', Math.abs(Math.max(...span) - Math.min(...span) - (20 / 15) * 180 / Math.PI) < 1e-3, `${(Math.max(...span) - Math.min(...span)).toFixed(3)}°`);
    const fan = post.postProcess(p, g, null, { postId: 'fanuc-lathe' }).code;
    ok('Fanuc: Zylinder-Interpolation G7.1 C15. … G7.1 C0 um die Mantelkontur, ohne G0 darin', /G19 W0 H0\nG7\.1 C15\.\n/.test(fan) && /G7\.1 C0\nG18\n/.test(fan) && !fan.split('G7.1 C15.').slice(1).some(part => /^G0\b/m.test(part.split('G7.1 C0')[0])));
    ok('Fanuc: Stirnkontur in Polar-Interpolation', (fan.match(/^G12\.1$/gm) || []).length >= 2);
    const oku = post.postProcess(p, g, null, { postId: 'okuma-lathe' });
    ok('Okuma: Hinweis auf fehlende Zylinder-Interpolation', oku.warnings.some(w => /Zylinder-Interpolation/.test(w)));
  }
  for (const [id, dialect] of Object.entries(POSTS)) for (const [vname, props] of Object.entries(VARIANTS)) for (const coolant of [false, true]) {
    const name = `${id} / ${cycles ? 'Zyklen' : 'Bahnen'} / ${vname}${coolant ? ' / Kühlmittel' : ''}`;
    let res;
    try { res = post.postProcess(p, g, null, { postId: id, props, coolant }); } catch (e) { ok(`${name}: läuft`, false, e.stack.split('\n').slice(0, 3).join(' | ')); continue; }
    if (dumpDir) fs.writeFileSync(`${dumpDir}/${id}_${cycles ? 'cyc' : 'path'}_${Object.keys(VARIANTS).indexOf(vname)}${coolant ? 'k' : ''}.nc`, res.code);
    // where the turret may index: the tool change position of the post (Fanuc: reference point)
    const tcX = props.tcX || 2 * (g.stock.r + 2) + 200;
    const issues = lintLathe(res.code, { dialect, tcX });
    ok(`${name}: Programm fehlerfrei`, issues.length === 0, issues.length ? lintSummary(issues).slice(0, 6).map(s => `${s.n}× ${s.msg} [${s.first}]`).join(' ‖ ') : `${res.lines} Sätze`);
    const bad = res.code.match(/NaN|undefined|Infinity|\bnull\b|\[object|\{[A-Za-z0-9]+!?\}/);
    ok(`${name}: keine ungültigen Werte oder offenen Platzhalter`, !bad, bad ? `„${bad[0]}“ in Zeile ${res.code.slice(0, bad.index).split('\n').length}` : '');
  }
}
