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
    // pocket wrapped on the diameter: 18 × 14 mm on the developed surface, cutter Ø6 → its centre stays 3 mm inside
    // the outline (arc length = angle × wrap radius 15), two levels, the floor is covered
    {
      const rq = g.results.get('wp1'), fq = rq.moves.filter(m => m.t === 'f'), Rw = rq.cyl; // (the part is turned down there: the pocket wraps on that diameter)
      // the sketch plane looks along +Y: its normal direction is the angle 90°, the arc length grows from there
      const sOf = m => { let dc = m.c - 90; while (dc > 180) dc -= 360; while (dc < -180) dc += 360; return (dc * Math.PI / 180) * Rw; };
      const sv = fq.map(m => Math.abs(sOf(m))), zv = fq.map(m => m.z), lv = [...new Set(fq.map(m => +m.xr.toFixed(3)))].sort((a, b) => b - a);
      ok('Tasche Mantelfläche: erzeugt, Fräsermitte bleibt 3 mm innerhalb der Kontur, zwei Zustellungen', !rq.error && Rw > 5 && Math.max(...sv) <= 6 + 1e-3 && Math.min(...zv) >= 39 - 1e-3 && Math.max(...zv) <= 47 + 1e-3 && lv.join() === [Rw - 1, Rw - 2].map(v => +v.toFixed(3)).join(),
        rq.error || `Bogenlänge bis ${Math.max(...sv).toFixed(3)}, Z ${Math.min(...zv).toFixed(2)}…${Math.max(...zv).toFixed(2)}, Radien ${lv.join('/')}`);
      const floor = fq.filter(m => Math.abs(m.xr - (Rw - 2)) < 1e-6);
      let gap = 0;
      for (let s = -5.5; s <= 5.5; s += 0.5) for (let z = 39.5; z <= 46.5; z += 0.5) gap = Math.max(gap, distTo([s, z], floor.map(m => [sOf(m), m.z]), false));
      ok('Tasche Mantelfläche: der Grund wird ganz geräumt', gap <= 3 + 1e-6, `größter Abstand eines Grundpunkts zur Bahn ${gap.toFixed(2)} mm (Fräserradius 3)`);
      ok('Tasche Mantelfläche: Eilgänge nur über dem Durchmesser', rq.moves.filter(m => m.t === 'r' && m.xr != null).every(m => m.xr >= Rw + 1 - 1e-9));
    }
    // the same pocket entered on a ramp of 4°: no feed move drops steeper than that, the floor is still reached
    {
      const rr = g.results.get('wp2'), fr = rr.moves.filter(m => m.t === 'f'), Rw = rr.cyl;
      const sOf = m => { let dc = m.c - 90; while (dc > 180) dc -= 360; while (dc < -180) dc += 360; return (dc * Math.PI / 180) * Rw; };
      let steep = 0, ramps = 0;
      for (let i = 1; i < rr.moves.length; i++) {
        const a = rr.moves[i - 1], b = rr.moves[i];
        if (b.t !== 'f' || a.xr == null || b.xr == null || !(a.xr <= Rw + 1e-9) || !(b.xr < a.xr - 1e-9)) continue; // going deeper inside the material
        const run = Math.hypot(sOf(b) - sOf(a), b.z - a.z), ang = Math.atan2(a.xr - b.xr, run) * 180 / Math.PI;
        steep = Math.max(steep, ang); ramps++;
      }
      const deepest = Math.min(...fr.map(m => m.xr));
      ok('Tasche Mantelfläche mit Rampe: kein Eintauchen steiler als 4°, Grund erreicht', !rr.error && ramps > 2 && steep <= 4 + 0.01 && Math.abs(deepest - (Rw - 2)) < 1e-6, rr.error || `${ramps} Rampenstücke, steilstes ${steep.toFixed(2)}°, tiefster Radius ${deepest.toFixed(3)}`);
    }
    // simulation: the pocket on the diameter is really taken out of the stock (floor at its depth, the far side of
    // the part untouched), contours on the face are drawn as ribbons with round ends
    {
      const { TurnSim } = await import('../js/turning.js'), THREE = await import('three');
      const ts = new TurnSim(new THREE.Group());
      ts.build(g.stock);
      for (const op of g.ops) { const r = g.results.get(op.id); if (!r?.moves || (r.live === 'rad' && op.id !== 'wp2')) continue; for (let i = 1; i < r.moves.length; i++) ts.cut(r.moves[i - 1], r.moves[i], r.tool, 0, 1); }
      ts.update();
      const rr = g.results.get('wp2'), Rw = rr.cyl, fr = rr.moves.filter(m => m.t === 'f'), deep = fr.find(m => m.xr < Rw - 2 + 1e-6 && m.z > 44 && m.z < 48); // (above the turned groove at z 37.5 … 42.5)
      const floor = ts.radiusAt(deep.c, deep.z), far = ts.radiusAt(deep.c + 180, deep.z);
      const mesh = ts.group.children.find(c => c.userData.carved), col = mesh?.geometry.getAttribute('color');
      let dark = 0;
      if (col) for (let i = 0; i < col.count; i++) if (col.getX(i) < 0.9) dark++;
      ok('Simulation: Tasche auf dem Mantel wird abgetragen (Grund auf Tiefe, Gegenseite unberührt)', Math.abs(floor - (Rw - 2)) < 0.02 && Math.abs(far - Rw) < 0.05 && dark > 50, `Grund ${floor.toFixed(3)}, Gegenseite ${far.toFixed(3)}, Soll ${(Rw - 2).toFixed(3)} / ${Rw.toFixed(3)}, ${dark} abgetragene Punkte`);
      // the pocket in the face and the holes along the axis are taken out as well: floor and hole bottom at their depth
      const deepOf = id => g.results.get(id).moves.filter(m => m.t === 'f').reduce((a, m) => (m.z < a.z ? m : a));
      const pk = deepOf('tp1'), hl = deepOf('lv1'), fm = ts.group.children.find(c => c.userData.face), fc = fm?.geometry.getAttribute('color');
      let fd = 0, fl = 0;
      if (fc) for (let k = 0; k < fc.count; k++) fc.getX(k) < 0.9 ? fd++ : fl++;
      ok('Simulation: Tasche in der Planfläche und axiale Bohrungen werden abgetragen', Math.abs(ts.topAt(pk.x, pk.y) - pk.z) < 0.02 && Math.abs(ts.topAt(hl.x, hl.y) - hl.z) < 0.02 && fd > 50 && fl > 50 && ts.marks.size === 0, `Taschengrund ${ts.topAt(pk.x, pk.y).toFixed(3)} (Soll ${pk.z.toFixed(3)}), Bohrungsgrund ${ts.topAt(hl.x, hl.y).toFixed(3)} (Soll ${hl.z.toFixed(3)}), ${fd} abgetragene / ${fl} übrige Punkte`);
    }
    // comparison with the part (here: its turned outline all around): most of it at size, the pocket on the
    // diameter too deep by its depth (the outline has no pocket), nothing counted without a part
    {
      const { TurnSim } = await import('../js/turning.js'), THREE = await import('three');
      const ts = new TurnSim(new THREE.Group());
      ts.build(g.stock);
      for (const op of g.ops) { const r = g.results.get(op.id); if (!r?.moves || (r.live && op.id !== 'wp2')) continue; for (let i = 1; i < r.moves.length; i++) ts.cut(r.moves[i - 1], r.moves[i], r.tool, 0, 1); }
      const n = ts.S.n, NT = ts.NT, rad = new Float32Array(n * NT), top = new Float32Array((ts.NR + 1) * NT).fill(-Infinity);
      for (let i = 0; i < n; i++) { const z = g.stock.bottom + i * ts.S.dz, r = z >= g.stock.modelBottom && z <= g.stock.modelTop ? g.profile.at(z) : 0; for (let j = 0; j < NT; j++) rad[i * NT + j] = r; }
      const none = ts.compareStats();
      ts.setCompare({ rad, top, threads: [] });
      const st = ts.compareStats();
      ok('Simulation: Vergleich beim Drehen (auf Maß / Rest / zu tief)', none === null && st && st.ok > 0.5 && st.gouge > 0.005 && Math.abs(st.worst + 2) < 0.6 && Math.abs(st.ok + st.left + st.gouge - 1) < 1e-9, st ? `${(st.ok * 100).toFixed(1)} % auf Maß, ${(st.left * 100).toFixed(1)} % Rest, ${(st.gouge * 100).toFixed(1)} % zu tief (max. ${st.worst.toFixed(2)})` : 'keine Werte');
    }
    // Y axis on the other controls: LinuxCNC G17 / G18, Okuma Y-axis mode G138 / G136
    {
      const lc = post.postProcess(p, g, null, { postId: 'linuxcnc-lathe', props: { latheY: true } }).code.split('Zweiflach SW16')[1].split('(')[0];
      const ok1 = lc.includes('G17') && lc.includes(' Y') && lc.includes('G18');
      const okc = post.postProcess(p, g, null, { postId: 'okuma-lathe', props: { latheY: true } }).code.split('Zweiflach SW16')[1];
      ok('Y-Achse: LinuxCNC mit G17 / G18, Okuma mit G138 / G136', ok1 && okc.includes('G138') && okc.includes('G136') && okc.includes(' Y'));
    }
    // Y axis: the flats and the face contour with the part standing still – G17, Y words, C only as an index angle
    {
      const y = post.postProcess(p, g, null, { postId: 'fanuc-lathe', props: { latheY: true } });
      const flat = y.code.split('Zweiflach SW16')[1].split('(')[0];
      ok('Y-Achse: Schlüsselflächen mit G17 und Y-Wörtern statt Polar-Interpolation', flat.includes('G17') && flat.includes(' Y') && !flat.includes('G12.1') && flat.includes('G18'), flat.split(String.fromCharCode(10)).slice(0, 8).join(' | '));
      const cs = [...new Set(flat.split(String.fromCharCode(10)).map(l => (l.split(' ').find(w => w[0] === 'C' && '0123456789'.includes(w[1])) || '')).filter(Boolean))];
      ok('Y-Achse: C steht je Fläche fest (0° und 180°)', cs.length === 2 && cs.includes('C0.') && cs.includes('C180.'), cs.join(' '));
      const narrow = post.postProcess(p, g, null, { postId: 'fanuc-lathe', props: { latheY: true, latheYTravel: 2 } });
      ok('Y-Achse: Bahn über dem Y-Verfahrweg bleibt bei der Polar-Interpolation, mit Hinweis', narrow.warnings.some(w => w.includes('Y-Verfahrweg')) && narrow.code.split('Zweiflach SW16')[1].split('(')[0].includes('G12.1'));
    }
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
