// Sheet metal (flat pattern, cut-outs, partial flanges, checks) and mesh tools (mirror, combine, refine,
// section, OBJ / 3MF / PLY) without a browser. Run: npm run test:sheetmesh
import './lib/node-env.mjs';
const THREE = await import('three');
const M = await import('../js/mesh.js');
const { flatPattern, sheetChecks, bendAllowance, SHEET_RULES } = await import('../js/sheetmetal.js');
const { writeDXF } = await import('../js/dxf.js');

const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
const near = (a, b, tol = 1e-3) => Math.abs(a - b) <= tol;

// ---- sheet metal ----
{
  const poly = [[0, 0], [100, 0], [100, 60], [0, 60]];
  const f = { thickness: 2, radius: 2, kfactor: 0.4, flanges: [] };
  const plain = flatPattern(poly, f);
  ok('Abwicklung ohne Laschen: Fläche und Schnittlänge der Platte', near(plain.area, 6000, 0.01) && near(plain.cutLength, 320, 0.01) && !plain.overlap, `${plain.area.toFixed(2)} mm², ${plain.cutLength.toFixed(2)} mm`);
  // cut-outs: a 20 x 10 window and a hole as a polygon
  const win = [[40, 25], [60, 25], [60, 35], [40, 35]];
  const cut = flatPattern(poly, f, [win]);
  const cw = cut.outline.filter(p => THREE.ShapeUtils.isClockWise(p.map(([x, y]) => new THREE.Vector2(x, y))));
  ok('Ausschnitt: Loch in der Abwicklung, Fläche kleiner, Schnittlänge größer', cut.outline.length === 2 && cw.length === 1 && near(cut.area, 6000 - 200, 0.01) && near(cut.cutLength, 320 + 60, 0.01), `${cut.outline.length} Konturen, ${cut.area.toFixed(2)} mm², ${cut.cutLength.toFixed(2)} mm`);
  // flange over the whole edge (shortened by the relief r + t on both sides) and a partial flange
  const ba = bendAllowance(90, 2, 2, 0.4);
  const full = flatPattern(poly, { ...f, flanges: [{ edge: 0, on: true, h: 15, angle: 90 }] });
  ok('Lasche: Zuschnitt wächst um Biegezugabe + Laschenlänge', near(full.size[1], 60 + ba + 15, 0.02) && near(full.table[0].length, 100 - 2 * 4), `${full.size.map(v => v.toFixed(3)).join(' × ')}, Biegelänge ${full.table[0].length}`);
  const part = flatPattern(poly, { ...f, flanges: [{ edge: 0, on: true, h: 15, angle: 90, offA: 20, offB: 30 }] });
  const xs = part.outline.flat().filter(p => p[1] < -1).map(p => p[0]);
  ok('Teillasche: Abstand vom Kantenanfang und -ende', near(part.table[0].length, 50) && near(Math.min(...xs), 20, 0.01) && near(Math.max(...xs), 70, 0.01), `Länge ${part.table[0].length}, X ${Math.min(...xs).toFixed(2)} … ${Math.max(...xs).toFixed(2)}`);
  // a closed corner stays open next to a partial flange
  const mixed = flatPattern(poly, { ...f, corner: 'closed', flanges: [{ edge: 0, on: true, h: 15, angle: 90, offB: 10 }, { edge: 1, on: true, h: 15, angle: 90 }] });
  ok('Teillasche neben geschlossener Ecke: Ecke bleibt offen', near(mixed.table[0].length, 100 - 4 - 10) && near(mixed.table[1].length, 60 - 8) && !mixed.overlap, `Biegelänge ${mixed.table[0].length}`);
  // checks
  const txt = c => c.map(x => x.text).join(' | ');
  const c0 = sheetChecks(poly, [], { ...f, flanges: [{ edge: 0, on: true, h: 15, angle: 90 }] }, full);
  ok('Prüfung: sauberes Teil ohne Hinweise', c0.length === 0, txt(c0));
  const c1 = sheetChecks(poly, [], { ...f, radius: 0.5, flanges: [{ edge: 0, on: true, h: 3, angle: 90 }] }, full);
  ok('Prüfung: kleiner Radius und kurze Lasche', c1.length === 2 && /Biegeradius/.test(c1[0].text) && /kürzer als 2/.test(c1[1].text), txt(c1));
  const c2 = sheetChecks(poly, [[[40, 1], [60, 1], [60, 8], [40, 8]]], { ...f, flanges: [{ edge: 0, on: true, h: 15, angle: 90 }] }, full);
  ok('Prüfung: Ausschnitt neben der Biegung', c2.length === 1 && /Ausschnitt/.test(c2[0].text), txt(c2));
  // an L-shaped plate whose two inner flanges fall on each other when unfolded
  const ell = [[0, 0], [60, 0], [60, 20], [20, 20], [20, 60], [0, 60]];
  const eg = { ...f, flanges: [{ edge: 2, on: true, h: 30, angle: 90, relief: 0.1 }, { edge: 3, on: true, h: 30, angle: 90, relief: 0.1 }] };
  const ef = flatPattern(ell, eg);
  ok('Prüfung: überlappende Abwicklung wird erkannt', ef.overlap && sheetChecks(ell, [], eg, ef).some(x => /überlappt/.test(x.text)));
  ok('Blechregeln: Dicke, Radius, K-Faktor', SHEET_RULES.length >= 6 && SHEET_RULES.every(r => r.thickness > 0 && r.radius > 0 && r.kfactor > 0.2 && r.kfactor < 0.5));
  // DXF: bend lines on their own layer
  const dxf = writeDXF([{ id: 'o', type: 'poly', closed: true, pts: poly }, { id: 'b', type: 'poly', closed: false, pts: [[0, -3], [100, -3]], layer: 'BIEGUNG' }]).split('\n');
  const layers = dxf.filter((l, i) => dxf[i - 1] === '8');
  ok('DXF: Biegelinien auf eigener Ebene', layers.includes('BIEGUNG') && layers.includes('0'), [...new Set(layers)].join(', '));
}

// ---- meshes ----
{
  const box = (w, d, hgt, x = 0, y = 0, z = 0) => M.fromGeometry(new THREE.BoxGeometry(w, d, hgt).translate(x + w / 2, y + d / 2, z + hgt / 2));
  const b = box(20, 10, 6);
  const s0 = M.stats(b);
  ok('Körper → Netz: geschlossener Quader', s0.closed && s0.tris === 12 && s0.verts === 8 && near(s0.volume, 1200), `${s0.tris} Dreiecke, ${s0.verts} Punkte, ${s0.volume} mm³`);
  // mirror
  const mi = M.mirror(b, 'x', 0), sm = M.stats(mi);
  ok('Spiegeln: gleiche Größe auf der anderen Seite, Außenseite bleibt außen', sm.closed && near(sm.volume, 1200) && near(sm.box.min.x, -20) && near(sm.box.max.x, 0), `Volumen ${sm.volume}, X ${sm.box.min.x} … ${sm.box.max.x}`);
  // the open half of a box mirrored with its original: one closed part
  const half = M.cutPlane(M.fromGeometry(new THREE.BoxGeometry(20, 10, 6)), 'x', 0, 'pos', false);
  const whole = M.mirror(half, 'x', 0, true), sw = M.stats(whole);
  ok('Spiegeln mit Original: zwei offene Hälften werden ein geschlossenes Teil', !M.stats(half).closed && sw.closed && sw.shells === 1 && near(sw.volume, 1200), `${sw.open} offene Kanten, ${sw.shells} Teil(e), ${sw.volume.toFixed(2)} mm³`);
  // combine
  const two = M.combine([b, box(5, 5, 5, 40, 0, 0)]), st = M.stats(two);
  ok('Vereinen: zwei Netze werden ein Netzkörper mit zwei Teilen', st.closed && st.shells === 2 && near(st.volume, 1200 + 125) && M.split(two).length === 2, `${st.tris} Dreiecke, ${st.shells} Teile`);
  // refine
  const r1 = M.subdivide(b, 0, 1), s1 = M.stats(r1);
  ok('Verfeinern (alle Kanten): viermal so viele Dreiecke, Form unverändert', s1.tris === 48 && s1.closed && near(s1.volume, 1200) && near(s1.area, s0.area), `${s1.tris} Dreiecke`);
  const r2 = M.subdivide(b, 4, 6), s2 = M.stats(r2);
  let longest = 0;
  for (let t = 0; t < r2.idx.length; t += 3) for (let k = 0; k < 3; k++) { const a = r2.idx[t + k], c = r2.idx[t + (k + 1) % 3]; longest = Math.max(longest, Math.hypot(r2.pos[a * 3] - r2.pos[c * 3], r2.pos[a * 3 + 1] - r2.pos[c * 3 + 1], r2.pos[a * 3 + 2] - r2.pos[c * 3 + 2])); }
  ok('Verfeinern (größte Kantenlänge 4): bleibt geschlossen, keine Kante länger', s2.closed && s2.nonManifold === 0 && near(s2.volume, 1200, 0.01) && longest <= 4 + 1e-6, `${s2.tris} Dreiecke, längste Kante ${longest.toFixed(3)}`);
  let threw = false;
  try { M.subdivide(b, 0, 8, 1000); } catch { threw = true; }
  ok('Verfeinern: Obergrenze der Dreiecke', threw);
  // section
  const sec = M.sectionLoops(b, 'z', 3);
  const area = p => Math.abs(p.reduce((a, q, i) => { const n = p[(i + 1) % p.length]; return a + q[0] * n[1] - n[0] * q[1]; }, 0) / 2);
  ok('Schnitt als Kontur: Rechteck 20 × 10 mit vier Ecken', sec.length === 1 && sec[0].closed && sec[0].pts.length === 4 && near(area(sec[0].pts), 200), `${sec.length} Kontur(en), ${sec[0]?.pts.length} Punkte, ${sec[0] ? area(sec[0].pts) : 0} mm²`);
  const secX = M.sectionLoops(two, 'y', 2.5);
  ok('Schnitt durch zwei Teile: zwei Konturen in (Z, X)', secX.length === 2 && secX.every(l => l.closed) && near(secX.reduce((a, l) => a + area(l.pts), 0), 20 * 6 + 25), `${secX.length} Konturen`);
  const cyl = M.fromGeometry(new THREE.CylinderGeometry(8, 8, 20, 48).rotateX(Math.PI / 2));
  const sc = M.sectionLoops(cyl, 'z', 0.5);
  ok('Schnitt durch einen Zylinder: ein Kreis aus 48 Punkten', sc.length === 1 && sc[0].closed && sc[0].pts.length === 48 && sc[0].pts.every(p => near(Math.hypot(p[0], p[1]), 8, 1e-3)), `${sc[0]?.pts.length} Punkte`);
  const open = M.sectionLoops(M.cutPlane(b, 'x', 10, 'neg', false), 'z', 3);
  ok('Schnitt durch ein offenes Netz: offene Kontur', open.length === 1 && !open[0].closed && open[0].pts.length === 4, `${open[0]?.pts.length} Punkte, geschlossen: ${open[0]?.closed}`);
  // OBJ
  const obj = M.toOBJ([{ name: 'Teil A', mesh: b }, { name: 'B', mesh: box(5, 5, 5, 40, 0, 0) }]);
  const back = M.weld(M.parseOBJ(obj)), sb = M.stats(back);
  ok('OBJ schreiben und wieder lesen', /^o Teil_A$/m.test(obj) && sb.tris === 24 && sb.closed && near(sb.volume, 1325), `${sb.tris} Dreiecke, ${sb.volume} mm³`);
  // 3MF: a zip package; read back by the own reader and checked against Node's inflate for a deflated one
  const pkg = M.to3MF([{ name: 'Teil', mesh: b }]);
  const files = await M.unzip(pkg.buffer);
  const m3 = M.weld(await M.parse3MF(pkg.buffer)), s3 = M.stats(m3);
  ok('3MF schreiben und wieder lesen', [...files.keys()].join() === '[Content_Types].xml,_rels/.rels,3D/3dmodel.model' && s3.tris === 12 && s3.closed && near(s3.volume, 1200), `${pkg.length} Bytes, ${s3.tris} Dreiecke`);
  // a 3MF as slicers write it: deflated, in inches, the object placed on the build plate
  const zlib = await import('node:zlib');
  const xml = `<?xml version="1.0"?><model unit="inch" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="7" type="model"><mesh><vertices>
<vertex x="0" y="0" z="0"/><vertex x="1" y="0" z="0"/><vertex x="0" y="1" z="0"/><vertex x="0" y="0" z="1"/></vertices><triangles>
<triangle v1="0" v2="2" v3="1"/><triangle v1="0" v2="1" v3="3"/><triangle v1="1" v2="2" v3="3"/><triangle v1="0" v2="3" v3="2"/></triangles></mesh></object></resources>
<build><item objectid="7" transform="1 0 0 0 1 0 0 0 1 2 0 0"/></build></model>`;
  const raw = new TextEncoder().encode(xml), def = new Uint8Array(zlib.deflateRawSync(raw));
  const nm = new TextEncoder().encode('3D/3dmodel.model');
  const lh = new DataView(new ArrayBuffer(30)); lh.setUint32(0, 0x04034b50, true); lh.setUint16(8, 8, true); lh.setUint32(18, def.length, true); lh.setUint32(22, raw.length, true); lh.setUint16(26, nm.length, true);
  const ch = new DataView(new ArrayBuffer(46)); ch.setUint32(0, 0x02014b50, true); ch.setUint16(10, 8, true); ch.setUint32(20, def.length, true); ch.setUint32(24, raw.length, true); ch.setUint16(28, nm.length, true);
  const en = new DataView(new ArrayBuffer(22)); en.setUint32(0, 0x06054b50, true); en.setUint16(8, 1, true); en.setUint16(10, 1, true); en.setUint32(12, 46 + nm.length, true); en.setUint32(16, 30 + nm.length + def.length, true);
  const zip = new Uint8Array(Buffer.concat([Buffer.from(lh.buffer), nm, def, Buffer.from(ch.buffer), nm, Buffer.from(en.buffer)]));
  const tet = M.weld(await M.parse3MF(zip.buffer)), stt = M.stats(tet);
  ok('3MF lesen: komprimiert, Zoll, auf der Bauplatte verschoben', stt.tris === 4 && stt.closed && near(Math.abs(stt.volume), 25.4 ** 3 / 6, 0.01) && near(stt.box.min.x, 50.8) && near(stt.box.max.x, 76.2), `Volumen ${Math.abs(stt.volume).toFixed(2)} mm³, X ${stt.box.min.x.toFixed(2)} … ${stt.box.max.x.toFixed(2)}`);
  // PLY: ASCII and binary
  const quad = 'ply\nformat ascii 1.0\nelement vertex 4\nproperty float x\nproperty float y\nproperty float z\nelement face 1\nproperty list uchar int vertex_indices\nend_header\n0 0 0\n10 0 0\n10 5 0\n0 5 0\n4 0 1 2 3\n';
  const pa = M.weld(M.parsePLY(new TextEncoder().encode(quad).buffer));
  ok('PLY (Text): Viereck wird zu zwei Dreiecken', pa.idx.length === 6 && near(M.stats(pa).area, 50), `${pa.idx.length / 3} Dreiecke`);
  const hd = new TextEncoder().encode('ply\nformat binary_little_endian 1.0\nelement vertex 3\nproperty float x\nproperty float y\nproperty float z\nproperty uchar red\nelement face 1\nproperty list uchar uint vertex_index\nend_header\n');
  const body = new DataView(new ArrayBuffer(3 * 13 + 13));
  [[0, 0, 0], [8, 0, 0], [0, 6, 0]].forEach((p, i) => { p.forEach((v, k) => body.setFloat32(i * 13 + k * 4, v, true)); body.setUint8(i * 13 + 12, 200); });
  body.setUint8(39, 3); [0, 1, 2].forEach((v, k) => body.setUint32(40 + k * 4, v, true));
  const pb = M.weld(M.parsePLY(new Uint8Array(Buffer.concat([Buffer.from(hd), Buffer.from(body.buffer)])).buffer));
  ok('PLY (binär, mit Farben): Dreieck', pb.idx.length === 3 && near(M.stats(pb).area, 24), `Fläche ${M.stats(pb).area}`);
}

// ---- flange cut-outs ----
{
  const { chainAt } = await import('../js/sheetmetal.js');
  const poly = [[0, 0], [100, 0], [100, 60], [0, 60]];
  const f = { thickness: 2, radius: 2, kfactor: 0.4, flanges: [{ edge: 0, on: true, h: 20, angle: 90, next: [{ h: 12, angle: 90 }], holes: [{ lv: 0, kind: 'circle', s: 50, d: 10, dia: 6 }, { lv: 1, kind: 'rect', s: 30, d: 6, w: 10, h: 4 }] }] };
  const fp = flatPattern(poly, f), ba = bendAllowance(90, 2, 2, 0.4);
  const cw = fp.outline.filter(p => THREE.ShapeUtils.isClockWise(p.map(([x, y]) => new THREE.Vector2(x, y))));
  const cen = p => [p.reduce((a, q) => a + q[0], 0) / p.length, p.reduce((a, q) => a + q[1], 0) / p.length];
  const cs = cw.map(cen).sort((a, b) => b[1] - a[1]);
  ok('Ausschnitte in Laschen: Bohrung und Fenster liegen in der Abwicklung an der abgewickelten Stelle', cw.length === 2 && near(cs[0][0], 50, 0.01) && near(cs[0][1], -(ba + 10), 0.01) && near(cs[1][0], 30, 0.01) && near(cs[1][1], -(ba + 20 + ba + 6), 0.01), cs.map(c => c.map(v => v.toFixed(3)).join('/')).join('  '));
  const base = flatPattern(poly, { ...f, flanges: [{ ...f.flanges[0], holes: [] }] });
  ok('Ausschnitte in Laschen: Fläche um Kreis und Rechteck kleiner', near(base.area - fp.area, Math.PI * 9 + 40, 0.1), (base.area - fp.area).toFixed(3));
  // folded: the first flange stands upright, the hole centre 10 mm above the end of the bend
  const at = chainAt(2, 2, 0.4, [{ angle: 90, h: 20 }, { angle: 90, h: 12 }], 0, 10);
  ok('Ausschnitte in Laschen: Lage im gebogenen Teil', near(at.pos[0], 3) && near(at.pos[1], 4 + 10) && near(at.dir[1], 1) && near(at.dev, ba + 10), `u ${at.pos[0].toFixed(3)}, v ${at.pos[1].toFixed(3)}`);
  const w1 = sheetChecks(poly, [], { ...f, flanges: [{ edge: 0, on: true, h: 20, angle: 90, holes: [{ lv: 0, kind: 'circle', s: 50, d: 5, dia: 6 }, { lv: 0, kind: 'circle', s: 50, d: 19, dia: 6 }] }] }, fp);
  ok('Prüfung: Bohrung in der Lasche zu nah an der Biegung / über den Rand', w1.length === 2 && /neben der Biegung/.test(w1[0].text) && /ragt über/.test(w1[1].text), w1.map(x => x.text).join(' | '));
}

// ---- mesh boolean, mirror without the wall, cylinders ----
{
  const box = (w, d, hgt, x = 0, y = 0, z = 0) => M.fromGeometry(new THREE.BoxGeometry(w, d, hgt).translate(x + w / 2, y + d / 2, z + hgt / 2));
  const a = box(20, 20, 20), b = box(20, 20, 20, 10, 10, 10);
  for (const [op, vol, name] of [['union', 15000, 'Vereinigung'], ['cut', 7000, 'Differenz'], ['intersect', 1000, 'Schnittmenge']]) {
    const r = M.boolean(a, b, op), s = M.stats(r);
    ok(`Boolesch – ${name} zweier Würfel: geschlossen, Volumen stimmt`, s.closed && s.shells === 1 && near(Math.abs(s.volume), vol, 0.01) && s.volume > 0, `${s.tris} Dreiecke, ${s.open} offene Kanten, ${s.volume.toFixed(3)} mm³`);
  }
  // a cylinder through a plate: a round hole
  const plate = box(40, 30, 6), cyl = M.fromGeometry(new THREE.CylinderGeometry(5, 5, 20, 32).rotateX(Math.PI / 2).translate(20, 15, 3));
  const holed = M.boolean(plate, cyl, 'cut'), sh = M.stats(holed), polyA = 0.5 * 32 * 25 * Math.sin((2 * Math.PI) / 32);
  ok('Boolesch – Zylinder aus Platte: Loch, geschlossen', sh.closed && near(sh.volume, 40 * 30 * 6 - polyA * 6, 0.05), `${sh.tris} Dreiecke, ${sh.open} offen, ${sh.nonManifold} nicht-mannigfaltig, ${sh.volume.toFixed(2)} mm³`);
  const un = M.boolean(plate, cyl, 'union'), su = M.stats(un);
  ok('Boolesch – Zylinder und Platte vereinigt', su.closed && near(su.volume, 40 * 30 * 6 + polyA * 14, 0.05), `${su.open} offen, ${su.volume.toFixed(2)} mm³`);
  const apart = M.boolean(a, box(5, 5, 5, 50, 0, 0), 'intersect');
  ok('Boolesch – Schnittmenge ohne Berührung ist leer', apart.idx.length === 0);
  // mirror of a capped half: no wall left on the mirror plane
  const halfC = M.cutPlane(M.fromGeometry(new THREE.BoxGeometry(20, 10, 6)), 'x', 0, 'pos', true);
  const mw = M.mirror(halfC, 'x', 0, true), sw = M.stats(mw);
  let wall = 0;
  for (let t = 0; t < mw.idx.length; t += 3) if ([0, 1, 2].every(k => Math.abs(mw.pos[mw.idx[t + k] * 3]) < 1e-6)) wall++;
  ok('Spiegeln einer geschlossenen Hälfte: keine Trennwand, ein geschlossenes Teil', M.stats(halfC).closed && sw.closed && sw.nonManifold === 0 && wall === 0 && near(sw.volume, 1200), `${wall} Dreiecke in der Spiegelebene, ${sw.volume.toFixed(2)} mm³`);
  // cylinders
  const found = M.findCylinders(holed);
  ok('Zylinder erkennen: Bohrung Ø10 durch die Platte', found.length === 1 && found[0].hole && near(found[0].r, 5, 1e-3) && near(found[0].h, 6, 1e-3) && near(Math.abs(found[0].d[2]), 1) && near(found[0].c[0], 20, 1e-3) && near(found[0].c[1], 15, 1e-3), JSON.stringify(found.map(c => ({ r: +c.r.toFixed(4), h: +c.h.toFixed(3), hole: c.hole, n: c.n }))));
  const pin = M.findCylinders(M.fromGeometry(new THREE.CylinderGeometry(8, 8, 25, 48).translate(3, 0, -2)));
  ok('Zylinder erkennen: Bolzen Ø16 entlang Y', pin.length === 1 && !pin[0].hole && near(pin[0].r, 8, 1e-3) && near(pin[0].h, 25, 1e-3) && near(Math.abs(pin[0].d[1]), 1) && pin[0].n === 48, JSON.stringify(pin.map(c => ({ r: c.r, h: c.h, hole: c.hole, n: c.n }))));
  ok('Zylinder erkennen: Quader und Kegel haben keine', M.findCylinders(plate).length === 0 && M.findCylinders(M.fromGeometry(new THREE.ConeGeometry(8, 20, 32))).length === 0);
  const half = M.cutPlane(M.fromGeometry(new THREE.CylinderGeometry(8, 8, 25, 48)), 'x', 0, 'pos', true);
  const hc = M.findCylinders(half);
  ok('Teilzylinder: halber Zylinder als Bogen von 180°', hc.length === 1 && !hc[0].full && !hc[0].hole && near(hc[0].r, 8, 1e-3) && near(hc[0].sweep, Math.PI, 1e-3) && near(hc[0].h, 25, 1e-3) && hc[0].n === 48, JSON.stringify(hc.map(c => ({ r: +c.r.toFixed(4), sweep: +(c.sweep * 180 / Math.PI).toFixed(2), n: c.n, full: c.full }))));
  ok('Teilzylinder: Fläche zwischen Sehnen und Kreis', near(hc[0].sl, 24 * 32 * ((2 * Math.PI) / 48 - Math.sin((2 * Math.PI) / 48)), 1e-3), hc[0].sl.toFixed(5));
  // a plate with four rounded corners (R6, twelve strips each)
  const rsh = new THREE.Shape();
  rsh.moveTo(6, 0); rsh.lineTo(34, 0); rsh.absarc(34, 6, 6, -Math.PI / 2, 0); rsh.lineTo(40, 24); rsh.absarc(34, 24, 6, 0, Math.PI / 2); rsh.lineTo(6, 30); rsh.absarc(6, 24, 6, Math.PI / 2, Math.PI); rsh.lineTo(0, 6); rsh.absarc(6, 6, 6, Math.PI, 1.5 * Math.PI);
  const rb = M.fromGeometry(new THREE.ExtrudeGeometry(rsh, { depth: 8, bevelEnabled: false, curveSegments: 6 }));
  const fr = M.findCylinders(rb);
  ok('Verrundungen: vier Ecken R6 einer Platte', M.stats(rb).closed && fr.length === 4 && fr.every(c => !c.full && !c.hole && near(c.r, 6, 2e-3) && near(c.sweep, Math.PI / 2, 2e-3) && near(c.h, 8, 1e-3) && c.n === 48), JSON.stringify(fr.map(c => ({ r: +c.r.toFixed(3), sweep: +(c.sweep * 180 / Math.PI).toFixed(1), hole: c.hole, n: c.n }))));
  const cs = fr.map(c => [Math.round(c.c[0]), Math.round(c.c[1])]).sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  ok('Verrundungen: Mittelpunkte', JSON.stringify(cs) === '[[6,6],[6,24],[34,6],[34,24]]', JSON.stringify(cs));
  // a cove: a cylinder cut out of an edge of a block leaves a hollow quarter
  const cove = M.boolean(box(30, 20, 10), M.fromGeometry(new THREE.CylinderGeometry(6, 6, 40, 32).translate(0, 10, 10)), 'cut');
  const fc = M.findCylinders(cove);
  ok('Hohlkehle: nach innen gewölbter Viertelkreis', M.stats(cove).closed && fc.length === 1 && fc[0].hole && !fc[0].full && near(fc[0].r, 6, 2e-3) && near(fc[0].sweep, Math.PI / 2, 2e-3) && near(fc[0].h, 20, 1e-3), JSON.stringify(fc.map(c => ({ r: +c.r.toFixed(3), sweep: +(c.sweep * 180 / Math.PI).toFixed(1), hole: c.hole, h: c.h }))));
  // a prism with twelve unequal sides is no arc; a chamfered block neither
  const pr = new THREE.Shape([[0, 0], [10, 0], [18, 3], [22, 9], [23, 20], [20, 26], [10, 30], [0, 28]].map(p => new THREE.Vector2(...p)));
  ok('Kein Bogen: unregelmäßiges Prisma', M.findCylinders(M.fromGeometry(new THREE.ExtrudeGeometry(pr, { depth: 8, bevelEnabled: false }))).length === 0);
}

// ---- free outlines in flanges, slanted edges, nesting ----
{
  const { nestParts } = await import('../js/sheetmetal.js');
  const poly = [[0, 0], [100, 0], [100, 60], [0, 60]];
  const f = { thickness: 2, radius: 2, kfactor: 0.4, flanges: [] };
  const ba = bendAllowance(90, 2, 2, 0.4);
  // a triangle 12 wide, 8 high, origin 40 along the edge and 6 above the bend
  const tri = [[0, 0], [12, 0], [0, 8]];
  const ff = { ...f, flanges: [{ edge: 0, on: true, h: 25, angle: 90, holes: [{ lv: 0, kind: 'poly', s: 40, d: 6, pts: tri }] }] };
  const fp = flatPattern(poly, ff), base = flatPattern(poly, { ...f, flanges: [{ edge: 0, on: true, h: 25, angle: 90 }] });
  const cw = fp.outline.filter(p => THREE.ShapeUtils.isClockWise(p.map(([x, y]) => new THREE.Vector2(x, y))));
  const ys = (cw[0] || []).map(p => p[1]), xs = (cw[0] || []).map(p => p[0]);
  ok('Freie Kontur in der Lasche: Dreieck in der Abwicklung an der richtigen Stelle', cw.length === 1 && near(base.area - fp.area, 48, 0.05) && near(Math.max(...ys), -(ba + 6), 0.01) && near(Math.min(...ys), -(ba + 14), 0.01) && near(Math.min(...xs), 40, 0.01) && near(Math.max(...xs), 52, 0.01), `Fläche −${(base.area - fp.area).toFixed(3)}, X ${Math.min(...xs).toFixed(2)}…${Math.max(...xs).toFixed(2)}, Y ${Math.min(...ys).toFixed(2)}…${Math.max(...ys).toFixed(2)}`);
  const w = sheetChecks(poly, [], { ...f, flanges: [{ edge: 0, on: true, h: 25, angle: 90, holes: [{ lv: 0, kind: 'poly', s: 40, d: 1, pts: tri }, { lv: 0, kind: 'poly', s: 40, d: 20, pts: tri }] }] }, fp);
  ok('Prüfung: freie Kontur zu nah an der Biegung / über den Rand', w.length === 2 && /neben der Biegung/.test(w[0].text) && /ragt über/.test(w[1].text), w.map(x => x.text).join(' | '));
  ok('Kontur aus Skizze ohne Auflösung wird übergangen (kein Absturz)', near(flatPattern(poly, { ...f, flanges: [{ edge: 0, on: true, h: 25, angle: 90, holes: [{ lv: 0, kind: 'sketch', sketch: 'x', s: 0, d: 0 }] }] }).area, base.area, 1e-6));
  // slanted edge: trapezoid, flange on the slanted side
  const trap = [[0, 0], [100, 0], [70, 50], [0, 50]];
  const ft = flatPattern(trap, { ...f, flanges: [{ edge: 1, on: true, h: 15, angle: 90 }] });
  const L = Math.hypot(30, 50), A0 = (100 + 70) / 2 * 50;
  ok('Lasche an schräger Kante: Biegelänge und Fläche', !ft.overlap && near(ft.table[0].length, L - 8, 0.01) && near(ft.area, A0 + (L - 8) * (ba + 15), 0.5), `Biegelänge ${ft.table[0].length.toFixed(3)}, Fläche ${ft.area.toFixed(2)}`);
  // nesting
  const rect = (w2, h2) => [[[0, 0], [w2, 0], [w2, h2], [0, h2]]];
  const n1 = nestParts([{ id: 'a', outline: rect(100, 40), qty: 6 }, { id: 'b', outline: rect(30, 80), qty: 3 }], 300, 200, 5, true);
  const boxes = n1.placed.map(p => { const X = p.loops.flat().map(q => q[0]), Y = p.loops.flat().map(q => q[1]); return [Math.min(...X), Math.min(...Y), Math.max(...X), Math.max(...Y), p.sheet]; });
  let clash = 0, outside = 0;
  for (let i = 0; i < boxes.length; i++) {
    const a = boxes[i];
    if (a[0] < 5 - 1e-6 || a[1] < 5 - 1e-6 || a[2] > 295 + 1e-6 || a[3] > 195 + 1e-6) outside++;
    for (let j = i + 1; j < boxes.length; j++) { const b = boxes[j]; if (a[4] === b[4] && a[0] < b[2] + 5 - 1e-6 && b[0] < a[2] + 5 - 1e-6 && a[1] < b[3] + 5 - 1e-6 && b[1] < a[3] + 5 - 1e-6) clash++; }
  }
  ok('Schachteln: alle Teile auf der Tafel, Abstand eingehalten', n1.placed.length === 9 && n1.left.length === 0 && clash === 0 && outside === 0 && n1.sheets === 1 && near(n1.used, (6 * 4000 + 3 * 2400) / 60000, 1e-6), `${n1.sheets} Tafel(n), ${Math.round(n1.used * 100)} %, ${clash} Überschneidungen`);
  const n2 = nestParts([{ id: 'a', outline: rect(100, 40), qty: 12 }, { id: 'big', outline: rect(500, 500), qty: 1 }, { id: 'tall', outline: rect(40, 250), qty: 1 }], 300, 200, 5, true);
  ok('Schachteln: zweite Tafel, zu großes Teil bleibt übrig, hohes Teil wird gedreht', n2.sheets === 2 && n2.left.length === 1 && n2.left[0] === 'big' && n2.placed.find(p => p.id === 'tall')?.rot === true && n2.placed.length === 13, `${n2.sheets} Tafeln, übrig ${n2.left.join(',')}`);
  const n3 = nestParts([{ id: 'tall', outline: rect(40, 250), qty: 1 }], 300, 200, 5, false);
  ok('Schachteln ohne Drehen: hohes Teil passt nicht', n3.placed.length === 0 && n3.left.length === 1 && n3.sheets === 0);
  // a turned part keeps its shape: an L outline has the same area and its box is swapped
  const Lsh = [[[0, 0], [40, 0], [40, 10], [10, 10], [10, 250], [0, 250]]];
  const n4 = nestParts([{ id: 'L', outline: Lsh, qty: 1 }], 300, 200, 5, true), lp = n4.placed[0].loops[0];
  const area = l => Math.abs(l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0) / 2);
  const sgn = l => Math.sign(l.reduce((s, p, i) => { const q = l[(i + 1) % l.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0));
  ok('Schachteln: gedrehtes Teil behält Form und Umlaufsinn', near(area(lp), area(Lsh[0]), 1e-6) && sgn(lp) === sgn(Lsh[0]) && near(Math.max(...lp.map(p => p[0])) - 5, 250, 1e-6) && near(Math.max(...lp.map(p => p[1])) - 5, 40, 1e-6));
}

// ---- boolean with spatial preselection, caps with holes ----
{
  const box = (w, d, hgt, x = 0, y = 0, z = 0) => M.fromGeometry(new THREE.BoxGeometry(w, d, hgt).translate(x + w / 2, y + d / 2, z + hgt / 2));
  // a tube cut across: the cap is a ring
  const tube = M.boolean(M.fromGeometry(new THREE.CylinderGeometry(10, 10, 30, 48)), M.fromGeometry(new THREE.CylinderGeometry(6, 6, 40, 48)), 'cut');
  const ht = M.cutPlane(tube, 'y', 0, 'pos', true), st = M.stats(tube), sh = M.stats(ht);
  ok('Schnitt durch ein Rohr: Deckel ist ein Ring, Volumen halbiert', st.closed && sh.closed && sh.nonManifold === 0 && near(sh.volume, st.volume / 2, 0.01), `${st.volume.toFixed(2)} → ${sh.volume.toFixed(2)} mm³, ${sh.open} offen`);
  // a large mesh (a ball of 130 000 triangles) and a small block at its side
  const ball = M.fromGeometry(new THREE.SphereGeometry(50, 360, 180)), sb = M.stats(ball);
  const blk = box(10, 10, 10, 45, -5, -5), exp = M.stats(M.boolean(M.fromGeometry(new THREE.SphereGeometry(50, 360, 180)), blk, 'intersect')).volume;
  for (const [op, vol, name] of [['cut', sb.volume - exp, 'Differenz'], ['union', sb.volume + 1000 - exp, 'Vereinigung'], ['intersect', exp, 'Schnittmenge']]) {
    const t0 = Date.now(), r = M.boolean(ball, blk, op), s = M.stats(r);
    ok(`Boolesch mit räumlicher Vorauswahl – ${name} an einer Kugel aus ${sb.tris} Dreiecken`, s.closed && s.nonManifold === 0 && s.shells === 1 && near(s.volume, vol, 0.5) && Date.now() - t0 < 20000, `${s.tris} Dreiecke, ${s.open} offen, ${s.volume.toFixed(2)} mm³ (erwartet ${vol.toFixed(2)}), ${Date.now() - t0} ms`);
  }
  ok('Schnittmenge an der Kugel: plausibel (zwischen 400 und 600 mm³)', exp > 400 && exp < 600, exp.toFixed(2));
  // the small one first: block minus ball
  const r2 = M.boolean(blk, ball, 'cut'), s2 = M.stats(r2);
  ok('Boolesch mit Vorauswahl – kleiner Block minus große Kugel', s2.closed && near(s2.volume, 1000 - exp, 0.5), `${s2.volume.toFixed(2)} mm³`);
  // apart: union keeps both, difference keeps the first
  const far = box(5, 5, 5, 200, 0, 0);
  ok('Boolesch ohne Berührung: Vereinigung = beide, Differenz = das erste', near(M.stats(M.boolean(blk, far, 'union')).volume, 1125) && near(M.stats(M.boolean(blk, far, 'cut')).volume, 1000));
  let thrown = false;
  try { M.boolean(ball, M.fromGeometry(new THREE.SphereGeometry(49, 360, 180)), 'cut'); } catch { thrown = true; }
  ok('Boolesch: zwei große, ganz überlappende Netze werden weiter abgelehnt', thrown);
}

// ---- flanges on curved edges ----
{
  const { polyArcs } = await import('../js/sheetmetal.js');
  const f = { thickness: 1, radius: 1, kfactor: 0.4, flanges: [] }, ba = bendAllowance(90, 1, 1, 0.4);
  const circ = (cx, cy, R, a0, a1, n) => Array.from({ length: n + 1 }, (_, i) => [cx + R * Math.cos(a0 + ((a1 - a0) * i) / n), cy + R * Math.sin(a0 + ((a1 - a0) * i) / n)]);
  // a disc: one edge all the way round
  const disc = circ(0, 0, 30, 0, 2 * Math.PI, 72).slice(0, -1), ad = polyArcs(disc);
  ok('Gebogene Kante: Kreisscheibe ist eine Kante rundum', ad.size === 1 && ad.get(0)?.full && near(ad.get(0).R, 30, 1e-6) && near(ad.get(0).L, 60 * Math.PI, 1e-6));
  const fd = flatPattern(disc, { ...f, flanges: [{ edge: 0, on: true, h: 10, angle: 90 }] });
  ok('Lasche rund um eine Scheibe (Deckel): Zuschnitt ist eine größere Scheibe', !fd.overlap && fd.outline.length === 1 && near(fd.size[0], 2 * (30 + ba + 10), 0.05) && near(fd.area, Math.PI * (30 + ba + 10) ** 2, 12) && fd.table.length === 1 && fd.table[0].curved && near(fd.table[0].length, 60 * Math.PI, 1e-6), `${fd.size.map(v => v.toFixed(2)).join(' × ')}, ${fd.area.toFixed(1)} mm²`);
  const cd = sheetChecks(disc, [], { ...f, flanges: [{ edge: 0, on: true, h: 10, angle: 90 }] }, fd);
  ok('Prüfung: Rand der Lasche wird gestaucht (nach außen gewölbte Kante)', cd.length === 1 && /gestaucht/.test(cd[0].text) && cd[0].level === 'warn', cd.map(x => x.text).join(' | '));
  // a plate with a round end: straight edges and one arc of 180°
  const dsh = [[0, 0], [60, 0], ...circ(60, 20, 20, -Math.PI / 2, Math.PI / 2, 30).slice(1), [0, 40]], aD = polyArcs(dsh);
  const run = [...aD.values()][0];
  ok('Gebogene Kante: Halbkreis-Ende einer Platte', aD.size === 1 && run.i0 === 1 && run.m === 30 && run.convex && !run.full && near(run.sweep, Math.PI, 1e-6) && near(run.c[0], 60, 1e-6) && near(run.c[1], 20, 1e-6), JSON.stringify({ i0: run?.i0, m: run?.m, R: run?.R }));
  const pl = flatPattern(dsh, f), fa = flatPattern(dsh, { ...f, flanges: [{ edge: 1, on: true, h: 8, angle: 90 }] });
  const span = Math.PI - 2 * (2 / 20), ring = (span / 2) * ((20 + ba + 8) ** 2 - 20 ** 2);
  ok('Lasche am Halbkreis: Ring-Ausschnitt in der Abwicklung, Freischnitt an beiden Enden', !fa.overlap && near(fa.area - pl.area, ring, 2.5) && near(fa.table[0].length, 20 * span, 1e-6) && fa.bends.length === 2 && fa.bends[0].length > 10, `+${(fa.area - pl.area).toFixed(2)} mm² (Ring ${ring.toFixed(2)}), Biegelänge ${fa.table[0].length.toFixed(3)}`);
  const fs2 = flatPattern(dsh, { ...f, flanges: [{ edge: 0, on: true, h: 8, angle: 90 }] });
  ok('Gerade Lasche neben dem Bogen bleibt wie sie war', near(fs2.table[0].length, 60 - 4, 1e-6) && !fs2.table[0].curved && near(fs2.area - pl.area, 56 * (ba + 8), 0.6), (fs2.area - pl.area).toFixed(2));
  // a hollow arc: a round bite out of the long side
  const bite = [[0, 0], [20, 0], ...circ(40, 0, 20, Math.PI, 0, 30).slice(1), [80, 0], [80, 50], [0, 50]], aB = polyArcs(bite), rb = [...aB.values()][0];
  ok('Gebogene Kante: nach innen gewölbt', aB.size === 1 && !rb.convex && near(rb.R, 20, 1e-6) && rb.sweep < 0, JSON.stringify({ i0: rb?.i0, m: rb?.m, sweep: rb?.sweep }));
  const fb = flatPattern(bite, { ...f, flanges: [{ edge: rb.i0, on: true, h: 6, angle: 90 }] }), pb = flatPattern(bite, f);
  const ringB = (span / 2) * (20 ** 2 - (20 - ba - 6) ** 2);
  ok('Lasche an der Hohlkante: der Ring liegt innen', !fb.overlap && near(fb.area - pb.area, ringB, 2.5), `+${(fb.area - pb.area).toFixed(2)} mm² (Ring ${ringB.toFixed(2)})`);
  const cb = sheetChecks(bite, [], { ...f, flanges: [{ edge: rb.i0, on: true, h: 6, angle: 90 }] }, fb);
  ok('Prüfung: Rand der Lasche wird gestreckt (Hohlkante)', cb.some(x => /gestreckt/.test(x.text)), cb.map(x => x.text).join(' | '));
  let err = '';
  try { flatPattern(bite, { ...f, flanges: [{ edge: rb.i0, on: true, h: 30, angle: 90 }] }); } catch (e) { err = e.message; }
  ok('Hohlkante: zu lange Lasche wird abgelehnt', /zu eng/.test(err), err);
  ok('Vieleck ohne Bögen: keine gebogenen Kanten', polyArcs([[0, 0], [100, 0], [100, 60], [0, 60]]).size === 0 && polyArcs([[0, 0], [10, 0], [18, 3], [22, 9], [23, 20], [20, 26], [10, 30], [0, 28]]).size === 0);
}

// ---- cones and spheres ----
{
  const box = (w, d, hgt, x = 0, y = 0, z = 0) => M.fromGeometry(new THREE.BoxGeometry(w, d, hgt).translate(x + w / 2, y + d / 2, z + hgt / 2));
  const show = r => JSON.stringify({ cyl: r.cylinders.length, cones: r.cones.map(c => ({ r0: +c.r0.toFixed(3), r1: +c.r1.toFixed(3), h: +(c.t1 - c.t0).toFixed(3), hole: c.hole, n: c.n })), sph: r.spheres.map(s => ({ r: +s.r.toFixed(3), hole: s.hole, n: s.n })) });
  const cone = M.findRound(M.fromGeometry(new THREE.ConeGeometry(8, 20, 32).translate(5, 3, 1)));
  ok('Kegel erkennen: Spitzkegel R8 × 20', cone.cones.length === 1 && cone.cylinders.length === 0 && cone.spheres.length === 0 && !cone.cones[0].hole && near(cone.cones[0].r1, 8, 2e-3) && near(cone.cones[0].r0, 0, 2e-3) && near(cone.cones[0].t1 - cone.cones[0].t0, 20, 2e-3) && cone.cones[0].n === 32 && near(cone.cones[0].apex[1], 13, 2e-3) && near(Math.abs(cone.cones[0].d[1]), 1, 1e-4), show(cone));
  const fr = M.findRound(M.fromGeometry(new THREE.CylinderGeometry(4, 10, 12, 40)));
  ok('Kegel erkennen: Kegelstumpf R4/R10 × 12', fr.cones.length === 1 && fr.cylinders.length === 0 && near(fr.cones[0].r0, 4, 2e-3) && near(fr.cones[0].r1, 10, 2e-3) && near(fr.cones[0].t1 - fr.cones[0].t0, 12, 2e-3) && !fr.cones[0].hole && fr.cones[0].n === 40, show(fr));
  // a conical hole through a plate: R2 at the bottom, R7 one millimetre above the top
  const plate = box(40, 30, 8), ch = M.boolean(plate, M.fromGeometry(new THREE.CylinderGeometry(7, 2, 10, 32).rotateX(Math.PI / 2).translate(20, 15, 4)), 'cut'), rc = M.findRound(ch);
  ok('Kegelbohrung durch eine Platte: Kegel als Loch, keine Kugel', M.stats(ch).closed && rc.cones.length === 1 && rc.spheres.length === 0 && rc.cylinders.length === 0 && rc.cones[0].hole && near(rc.cones[0].r0, 2.5, 5e-3) && near(rc.cones[0].r1, 6.5, 5e-3) && near(rc.cones[0].t1 - rc.cones[0].t0, 8, 5e-3) && rc.cones[0].n === 32, show(rc));
  const two = M.findRound(M.boolean(M.boolean(plate, M.fromGeometry(new THREE.CylinderGeometry(3, 3, 30, 24).rotateX(Math.PI / 2).translate(10, 15, 4)), 'cut'), M.fromGeometry(new THREE.CylinderGeometry(7, 2, 10, 32).rotateX(Math.PI / 2).translate(28, 15, 4)), 'cut'));
  ok('Bohrung und Kegelbohrung nebeneinander: ein Zylinder, ein Kegel', two.cylinders.length === 1 && two.cones.length === 1 && two.spheres.length === 0 && two.cones[0].hole && two.cones[0].n === 32, show(two));
  const nd = M.collapseNeedles(ch), sn = M.stats(nd);
  ok('Nadeln schließen: Netz bleibt geschlossen, Volumen gleich', sn.closed && near(sn.volume, M.stats(ch).volume, 0.01) && sn.tris <= M.stats(ch).tris, `${M.stats(ch).tris} → ${sn.tris} Dreiecke`);
  const cyl2 = M.findRound(M.fromGeometry(new THREE.CylinderGeometry(6, 6, 9, 32)));
  ok('Zylinder ist weder Kegel noch Kugel', cyl2.cylinders.length === 1 && cyl2.cones.length === 0 && cyl2.spheres.length === 0, show(cyl2));
  const ball = M.findRound(M.fromGeometry(new THREE.SphereGeometry(12, 48, 24).translate(2, -3, 7)));
  const exact = (4 / 3) * Math.PI * 12 ** 3, meshVol = M.stats(M.fromGeometry(new THREE.SphereGeometry(12, 48, 24))).volume;
  ok('Kugel erkennen: Kugel R12, Volumen zwischen Facetten und Kugel', ball.spheres.length === 1 && ball.cones.length === 0 && ball.cylinders.length === 0 && !ball.spheres[0].hole && near(ball.spheres[0].r, 12, 2e-3) && near(ball.spheres[0].c[2], 7, 2e-3) && near(ball.spheres[0].vol, exact - meshVol, 0.5), `${show(ball)} vol ${ball.spheres[0]?.vol.toFixed(2)} (erwartet ${(exact - meshVol).toFixed(2)})`);
  // a pin with a ball end: cylinder and half a sphere
  const pinb = M.boolean(M.fromGeometry(new THREE.CylinderGeometry(5, 5, 20, 32)), M.fromGeometry(new THREE.SphereGeometry(5, 32, 16).translate(0, 10, 0)), 'union'), rp = M.findRound(pinb);
  ok('Stift mit Kugelkopf: ein Zylinder, eine Kugel', M.stats(pinb).closed && rp.cylinders.length === 1 && rp.spheres.length === 1 && near(rp.spheres[0].r, 5, 3e-3) && !rp.spheres[0].hole, show(rp));
  const hollow = M.findRound(M.boolean(box(30, 30, 30, -15, -15, -15), M.fromGeometry(new THREE.SphereGeometry(8, 32, 16).translate(0, 0, 15)), 'cut'));
  ok('Kugelmulde: Kugel als Hohlform', hollow.spheres.length === 1 && hollow.spheres[0].hole && near(hollow.spheres[0].r, 8, 3e-3), show(hollow));
  const none = M.findRound(box(10, 20, 30));
  ok('Quader: nichts Rundes', none.cylinders.length + none.cones.length + none.spheres.length === 0);
}

// ---- true nesting, joined flanges and cut-outs on curved edges ----
{
  const { nestParts, flangeJoins, polyArcs } = await import('../js/sheetmetal.js');
  const segD = (p, a, b) => { const dx = b[0] - a[0], dy = b[1] - a[1], l2 = dx * dx + dy * dy, s = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0; return Math.hypot(p[0] - a[0] - dx * s, p[1] - a[1] - dy * s); };
  const minDist = n => {
    let d = Infinity;
    for (let i = 0; i < n.placed.length; i++) for (let j = i + 1; j < n.placed.length; j++) {
      const A = n.placed[i], B = n.placed[j];
      if (A.sheet !== B.sheet) continue;
      for (const la of A.loops) for (const lb of B.loops) for (let p = 0; p < la.length; p++) for (let q = 0; q < lb.length; q++) d = Math.min(d, segD(la[p], lb[q], lb[(q + 1) % lb.length]), segD(lb[q], la[p], la[(p + 1) % la.length]));
    }
    return d;
  };
  const border = (n, W, H) => { let d = Infinity; for (const p of n.placed) for (const l of p.loops) for (const [x, y] of l) d = Math.min(d, x, y, W - x, H - y); return d; };
  // two triangles make a square
  const tri = [[[0, 0], [100, 0], [0, 100]]];
  const t1 = nestParts([{ id: 't', outline: tri, qty: 2 }], 130, 130, 5, true), t0 = nestParts([{ id: 't', outline: tri, qty: 2 }], 130, 130, 5, true, false);
  ok('Schachteln ineinander: zwei Dreiecke auf einer Tafel statt auf zwei', t1.sheets === 1 && t1.tight && t0.sheets === 2 && t1.placed.length === 2 && minDist(t1) >= 5 - 1e-6 && border(t1, 130, 130) >= 5 - 1e-6, `${t1.sheets} / ${t0.sheets} Tafeln, Abstand ${minDist(t1).toFixed(2)}, Rand ${border(t1, 130, 130).toFixed(2)}`);
  const t2 = nestParts([{ id: 't', outline: tri, qty: 2 }], 130, 130, 5, false);
  ok('Schachteln ineinander ohne 90°-Drehen: um 180° gewendet', t2.sheets === 1 && t2.placed.every(p => !p.rot) && t2.placed.some(p => p.turn === 180));
  // small parts into the window of a frame
  const frame = [[[0, 0], [200, 0], [200, 200], [0, 200]], [[25, 25], [25, 175], [175, 175], [175, 25]]];
  const sq = [[[0, 0], [60, 0], [60, 60], [0, 60]]];
  const n5 = nestParts([{ id: 'frame', outline: frame, qty: 1 }, { id: 'sq', outline: sq, qty: 4 }], 215, 215, 5, true), n5r = nestParts([{ id: 'frame', outline: frame, qty: 1 }, { id: 'sq', outline: sq, qty: 4 }], 215, 215, 5, true, false);
  const inWin = n5.placed.filter(p => p.id === 'sq').every(p => p.loops[0].every(([x, y]) => x > 30 - 1e-6 && x < 180 + 1e-6 && y > 30 - 1e-6 && y < 180 + 1e-6));
  ok('Schachteln ineinander: kleine Teile im Fenster des Rahmens', n5.sheets === 1 && n5r.sheets === 2 && n5.placed.length === 5 && n5.left.length === 0 && inWin && minDist(n5) >= 5 - 1e-6 && near(n5.used, (40000 - 22500 + 4 * 3600) / (215 * 215), 1e-6), `${n5.sheets} / ${n5r.sheets} Tafeln, Abstand ${minDist(n5).toFixed(2)}, ${Math.round(n5.used * 100)} %`);
  // many L shapes: never closer than the gap, all on the sheets
  const Ls = [[[0, 0], [90, 0], [90, 25], [25, 25], [25, 90], [0, 90]]];
  const n6 = nestParts([{ id: 'L', outline: Ls, qty: 12 }, { id: 't', outline: tri, qty: 5 }], 500, 300, 4, true), n6r = nestParts([{ id: 'L', outline: Ls, qty: 12 }, { id: 't', outline: tri, qty: 5 }], 500, 300, 4, true, false);
  ok('Schachteln ineinander: L-Teile und Dreiecke, nie enger als der Abstand', n6.placed.length === 17 && n6.sheets <= n6r.sheets && minDist(n6) >= 4 - 1e-6 && border(n6, 500, 300) >= 4 - 1e-6, `${n6.sheets} / ${n6r.sheets} Tafeln${n6.tight ? ' (ineinander)' : ' (Reihen)'}, Abstand ${minDist(n6).toFixed(2)}`);

  // a stadium: two straight edges, two half circles – the flanges go round in one piece
  const st = [[0, -20], [60, -20]];
  for (let i = 1; i <= 24; i++) st.push([60 + 20 * Math.cos(-Math.PI / 2 + (i * Math.PI) / 24), 20 * Math.sin(-Math.PI / 2 + (i * Math.PI) / 24)]);
  st.push([0, 20]);
  for (let i = 1; i < 24; i++) st.push([20 * Math.cos(Math.PI / 2 + (i * Math.PI) / 24), 20 * Math.sin(Math.PI / 2 + (i * Math.PI) / 24)]);
  const f = { thickness: 2, radius: 2, kfactor: 0.4 }, ba = bendAllowance(90, 2, 2, 0.4), d = ba + 10;
  const arcs = polyArcs(st), keys = [...arcs.keys()].sort((a, b) => a - b);
  const all = { ...f, flanges: [0, keys[0], keys[0] + 24, keys[1]].map(edge => ({ edge, on: true, h: 10, angle: 90 })) };
  const jn = flangeJoins(st, all), fp = flatPattern(st, all);
  const want = 60 * (40 + 2 * d) + Math.PI * (20 + d) ** 2;
  ok('Laschen rundum (Langloch-Form): ohne Freischnitt verbunden, Zuschnitt ein Stück', keys.length === 2 && jn.size === 4 && [...jn.values()].every(q => q.a && q.b) && fp.outline.length === 1 && !fp.overlap && near(fp.area, want, 5) && near(fp.table.find(q => q.edge === 0).length, 60, 1e-6), `Fläche ${fp.area.toFixed(1)} (soll ${want.toFixed(1)}), ${fp.outline.length} Kontur(en)`);
  const two = { ...f, flanges: [{ edge: 0, on: true, h: 10, angle: 90 }, { edge: keys[0], on: true, h: 10, angle: 60 }] };
  ok('Verschiedene Biegewinkel: Laschen bleiben getrennt', flangeJoins(st, two).size === 0 && near(flatPattern(st, two).table.find(q => q.edge === 0).length, 60 - 8, 1e-6));
  const off = { ...f, flanges: [{ edge: 0, on: true, h: 10, angle: 90, offB: 6 }, { edge: keys[0], on: true, h: 10, angle: 90 }] };
  ok('Abstand am Ende: Lasche endet dort, der Bogen behält den Freischnitt', flangeJoins(st, off).size === 0 && near(flatPattern(st, off).table.find(q => q.edge === 0).length, 60 - 4 - 6, 1e-6));

  // cut-outs in a flange on a curved edge
  const disc = Array.from({ length: 72 }, (_, i) => [30 * Math.cos((i * Math.PI) / 36), 30 * Math.sin((i * Math.PI) / 36)]);
  const lid = { ...f, flanges: [{ edge: 0, on: true, h: 15, angle: 90 }] }, base = flatPattern(disc, lid);
  const hol = { ...f, flanges: [{ edge: 0, on: true, h: 15, angle: 90, holes: [{ lv: 0, kind: 'circle', s: 10, d: 7, dia: 6 }, { lv: 0, kind: 'rect', s: 60, d: 8, w: 8, h: 4 }] }] }, fh = flatPattern(disc, hol);
  const cw = fh.outline.filter(p => THREE.ShapeUtils.isClockWise(p.map(([x, y]) => new THREE.Vector2(x, y))));
  const cen = l => [l.reduce((a, p) => a + p[0], 0) / l.length, l.reduce((a, p) => a + p[1], 0) / l.length];
  const c0 = cw.map(cen).sort((a, b) => Math.atan2(a[1], a[0]) - Math.atan2(b[1], b[0]))[0] || [0, 0];
  ok('Ausschnitte in der Lasche an gebogener Kante: in der Abwicklung an der richtigen Stelle', cw.length === 2 && near(base.area - fh.area, 0.5 * 48 * 9 * Math.sin(Math.PI / 24) + 32, 0.05) && near(Math.hypot(...c0), 30 + ba + 7, 0.01) && near(Math.atan2(c0[1], c0[0]), 10 / 30, 1e-3), `Fläche −${(base.area - fh.area).toFixed(2)}, Mitte R${Math.hypot(...c0).toFixed(3)} bei ${(Math.atan2(c0[1], c0[0]) * 180 / Math.PI).toFixed(2)}°`);
  const w1 = sheetChecks(disc, [], hol, fh).filter(x => /Ausschnitt/.test(x.text));
  const w2 = sheetChecks(disc, [], { ...f, flanges: [{ edge: 0, on: true, h: 15, angle: 90, holes: [{ lv: 0, kind: 'circle', s: 10, d: 14, dia: 6 }, { lv: 0, kind: 'circle', s: 10, d: 5, dia: 6 }] }] }, fh).filter(x => /Ausschnitt/.test(x.text));
  ok('Prüfung der Ausschnitte an gebogener Kante', w1.length === 0 && w2.length === 2 && /ragt über/.test(w2[0].text) && /neben der Biegung/.test(w2[1].text), w2.map(x => x.text).join(' | '));
}

// ---- parts of cones, patches of spheres ----
{
  const box = (w, d, hgt, x = 0, y = 0, z = 0) => M.fromGeometry(new THREE.BoxGeometry(w, d, hgt).translate(x + w / 2, y + d / 2, z + hgt / 2));
  // a plate with rounded corners and a chamfer all round: the chamfer of a corner is a quarter of a cone
  const sh = new THREE.Shape();
  sh.moveTo(10, 0); sh.lineTo(50, 0); sh.absarc(50, 10, 10, -Math.PI / 2, 0); sh.lineTo(60, 30); sh.absarc(50, 30, 10, 0, Math.PI / 2); sh.lineTo(10, 40); sh.absarc(10, 30, 10, Math.PI / 2, Math.PI); sh.lineTo(0, 10); sh.absarc(10, 10, 10, Math.PI, 1.5 * Math.PI);
  const cham = M.fromGeometry(new THREE.ExtrudeGeometry(sh, { depth: 6, bevelEnabled: true, bevelThickness: 2, bevelSize: 2, bevelSegments: 1, curveSegments: 12 }));
  const rc = M.findRound(cham), segs = rc.cones.filter(c => c.sweep);
  ok('Kegelsegmente: Fase um runde Ecken (8 Viertelkegel)', segs.length === 8 && segs.every(c => c.sweep > 1.43 && c.sweep < 1.5709 && near(c.r1, 12, 5e-3) && near(c.r0, 10, 5e-3) && !c.hole) && rc.cones.length === 8, JSON.stringify({ cones: rc.cones.map(c => [+c.r0.toFixed(2), +c.r1.toFixed(2), c.sweep ? +(c.sweep * 180 / Math.PI).toFixed(1) : 360]), cyl: rc.cylinders.length }));
  // a low dome on a thin plate: the whole sphere would not fit the part
  const dome = M.findRound(M.boolean(box(30, 30, 2, -15, -15, 0), M.boolean(M.fromGeometry(new THREE.SphereGeometry(20, 64, 32).rotateX(Math.PI / 2).translate(0, 0, -17)), box(60, 60, 10, -30, -30, 1), 'intersect'), 'union'));
  const s0 = dome.spheres[0];
  ok('Kugelausschnitt: flache Kuppe auf dünner Platte', dome.spheres.length === 1 && !s0.hole && near(s0.r, 20, 5e-3) && near(s0.alpha, Math.acos(19 / 20), 0.02) && near(s0.ax[2], 1, 1e-3) && s0.rin > 19.9 && s0.rin < 20, s0 ? `R${s0.r.toFixed(3)}, Öffnung ${(s0.alpha * 180 / Math.PI).toFixed(2)}°, innen ${s0.rin.toFixed(3)}` : 'keine');
}

// ---- mitre between a curved and a straight edge, flange dimension, press force ----
{
  const { flangeEnds, polyEdges, polyArcs, sheetDims, pressForce } = await import('../js/sheetmetal.js');
  const f = { thickness: 2, radius: 2, kfactor: 0.4 }, ba = bendAllowance(90, 2, 2, 0.4);
  // a D shape: a straight edge on the left (x = 0, from y = 30 down to −30) and a half circle on the right
  const D = [[0, 30], [0, -30]];
  for (let i = 1; i < 24; i++) D.push([30 * Math.cos(-Math.PI / 2 + (i * Math.PI) / 24), 30 * Math.sin(-Math.PI / 2 + (i * Math.PI) / 24)]);
  const arcs = polyArcs(D), i0 = [...arcs.keys()][0];
  const fl = [{ edge: 0, on: true, h: 12, angle: 90 }, { edge: i0, on: true, h: 12, angle: 90 }];
  const open = { ...f, flanges: fl }, closed = { ...f, corner: 'closed', cornerGap: 0.4, flanges: fl };
  const en = flangeEnds(polyEdges(D), closed), eo = flangeEnds(polyEdges(D), open);
  ok('Gehrung Bogen/gerade Kante: beide Ecken geschlossen, offen bleibt offen', arcs.size === 1 && !!en[0].a && !!en[0].b && !!en[i0].a && !!en[i0].b && !eo[0].a && !eo[i0].b && near(Math.hypot(...en[i0].a.m), 1, 1e-9) && near(en[0].b.m[0] * en[i0].a.m[0] + en[0].b.m[1] * en[i0].a.m[1], -1, 1e-9));
  const fo = flatPattern(D, open), fc = flatPattern(D, closed);
  ok('Gehrung Bogen/gerade Kante: Zuschnitt ein Stück, größer als offen, ohne Überlappung', fc.outline.length === 1 && !fc.overlap && !fo.overlap && fc.area > fo.area + 2 * 4 * (ba + 12) && near(fc.table.find(q => q.edge === 0).length, 60, 1e-6) && near(fo.table.find(q => q.edge === 0).length, 52, 1e-6), `Fläche offen ${fo.area.toFixed(1)}, geschlossen ${fc.area.toFixed(1)}`);
  // flange dimension
  const od = sheetDims({ ...f, flangeDim: 'outer', flanges: [{ edge: 0, on: true, h: 20, angle: 90 }, { edge: 1, on: true, h: 20, angle: 60 }, { edge: 2, on: false, h: 1, angle: 90 }] });
  const id = sheetDims({ ...f, flangeDim: 'inner', flanges: [{ edge: 0, on: true, h: 20, angle: 90 }] });
  let thrown = '';
  try { sheetDims({ ...f, flangeDim: 'outer', flanges: [{ edge: 0, on: true, h: 3, angle: 90 }] }); } catch (err) { thrown = err.message; }
  ok('Laschenmaß außen / innen: gerader Teil wird zurückgerechnet', near(od.flanges[0].h, 16, 1e-9) && near(od.flanges[1].h, 20 - 4 * Math.tan(Math.PI / 6), 1e-9) && od.flanges[2].h === 1 && near(id.flanges[0].h, 18, 1e-9) && /kleiner als die Biegung/.test(thrown) && sheetDims(f) === f, thrown);
  const sq = [[0, 0], [100, 0], [100, 60], [0, 60]];
  const fpO = flatPattern(sq, sheetDims({ ...f, flangeDim: 'outer', flanges: [{ edge: 0, on: true, h: 20, angle: 90 }] }));
  ok('Laschenmaß außen: Zuschnitt aus dem zurückgerechneten geraden Teil', near(fpO.size[1], 60 + ba + 16, 0.02), fpO.size[1].toFixed(3));
  const pf = pressForce(2, 1000, 400), pf8 = pressForce(8, 1000, 400);
  ok('Presskraft: 2 mm Stahl auf 1 m, Gesenk 16 mm', pf.V === 16 && near(pf.kN, 142, 0.01) && near(pf.minFlange, 11.2, 1e-9) && pf8.V === 80, `${pf.kN.toFixed(1)} kN`);
}

// ---- bends on lines across the plate, beads, collars ----
{
  const { foldPlan, collarPlan, beadShape, holeCircle } = await import('../js/sheetmetal.js');
  const poly = [[0, 0], [100, 0], [100, 60], [0, 60]], f = { thickness: 2, radius: 2, kfactor: 0.4, flanges: [] };
  const ba = bendAllowance(90, 2, 2, 0.4), line = x => ({ a: [x, -5], b: [x, 70], angle: 90 });
  const p1 = foldPlan(poly, { ...f, folds: [line(70)] });
  ok('Biegelinie: Platte in zwei Stücke, das größere bleibt liegen', p1.cells.length === 2 && p1.cells[0].path.length === 0 && near(p1.cells[0].area, (70 - ba / 2) * 60, 0.05) && p1.cells[1].path.length === 1 && p1.cells[1].path[0].s === -1 && p1.edges.length === 1, `${p1.cells.map(c => c.area.toFixed(1)).join(' / ')}`);
  const fp1 = flatPattern(poly, { ...f, folds: [line(70)] });
  ok('Biegelinie: Zuschnitt bleibt die Skizze, zwei Zonengrenzen, Zeile in der Biegetabelle', near(fp1.area, 6000, 0.01) && fp1.bends.length === 2 && fp1.table.length === 1 && fp1.table[0].line === 0 && near(fp1.table[0].length, 60, 1e-6) && near(fp1.table[0].allowance, ba, 1e-9) && near(Math.abs(fp1.bends[0][0][0] - fp1.bends[1][0][0]), ba, 1e-6), `Zugabe ${ba.toFixed(3)}`);
  const p2 = foldPlan(poly, { ...f, folds: [line(30), { ...line(70), angle: -90 }] });
  ok('Zwei Biegelinien (U): die Mitte bleibt, beide Seiten schwenken einmal', p2.cells.length === 3 && near(p2.cells[0].area, (40 - ba) * 60, 0.05) && p2.cells[1].path.length === 1 && p2.cells[2].path.length === 1 && p2.cells[1].path[0].i !== p2.cells[2].path[0].i);
  const p3 = foldPlan(poly, { ...f, folds: [line(60), line(80)] });
  const far = p3.cells.find(c => c.path.length === 2);
  ok('Zwei Biegelinien hintereinander (Z): das äußere Stück macht beide Biegungen mit', p3.cells.length === 3 && !!far && far.path[0].i === 0 && far.path[1].i === 1 && p3.edges.find(e => e.i === 1).path.length === 1);
  let e1 = '', e2 = '', e3 = '';
  try { foldPlan(poly, { ...f, folds: [line(50), { a: [-5, 30], b: [105, 30], angle: 90 }] }); } catch (err) { e1 = err.message; }
  try { foldPlan(poly, { ...f, folds: [line(150)] }); } catch (err) { e2 = err.message; }
  const spl = flatPattern(poly, { ...f, folds: [line(50)], flanges: [{ edge: 0, on: true, h: 10, angle: 90, holes: [{ lv: 0, kind: 'circle', s: 20, d: 5, dia: 3 }, { lv: 0, kind: 'circle', s: 50, d: 5, dia: 3 }] }] });
  const fb = spl.table.filter(b => b.edge === 0);
  try { flatPattern(poly, { ...f, folds: [{ a: [-5, 1], b: [105, 1], angle: 90 }], flanges: [{ edge: 0, on: true, h: 10, angle: 90 }] }); } catch (err) { e3 = err.message; }
  const okFl = flatPattern(poly, { ...f, folds: [line(50)], flanges: [{ edge: 0, on: true, h: 10, angle: 90, offB: 60 }] });
  ok('Biegelinien: gekreuzt, neben der Platte, Lasche über die Linie werden abgelehnt; Teillasche davor geht', /kreuzen/.test(e1) && /nicht in der Platte/.test(e2) && /nicht in der Platte/.test(e3) && okFl.table.length === 2, `${e1} | ${e2} | ${e3}`);
  // flange 4 … 96 on the edge, zone 50 ± ba/2, relief 4 on both sides; the cut-out at 20 stays, the one in the gap goes
  ok('Lasche über die Biegelinie: geteilt und freigestellt, Ausschnitt bleibt in seinem Stück', fb.length === 2 && near(fb[0].length, 50 - ba / 2 - 4 - 4, 1e-6) && near(fb[1].length, fb[0].length, 1e-6) && spl.outline.length === 2 && sheetChecks(poly, [], { ...f, folds: [line(50)], flanges: [{ edge: 0, on: true, h: 10, angle: 90 }] }, spl).some(c => /geteilt/.test(c.text)), `${fb.map(b => b.length.toFixed(3)).join(' + ')}, ${spl.outline.length} Umrisse`);
  // an L-shaped plate: the line runs through one leg only where it lies in the plate
  const ell = [[0, 0], [100, 0], [100, 30], [40, 30], [40, 80], [0, 80]];
  const fpL = flatPattern(ell, { ...f, folds: [{ a: [0, 50], b: [40, 50], angle: 45 }] });
  ok('Biegelinie durch einen Schenkel eines Winkels: Biegelänge = Schenkelbreite', near(fpL.table[0].length, 40, 1e-6) && fpL.bends.length === 2);
  // collars
  const g = { thickness: 1, radius: 1, kfactor: 0.4, flanges: [] }, circ = (c, r, n = 24) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
  const hole = circ([30, 30], 4), win = [[60, 20], [80, 20], [80, 40], [60, 40]];
  const hc = holeCircle(hole);
  const cp = collarPlan([hole, win], { ...g, collars: [{ hole: 0, h: 2 }, { hole: 1, h: 2 }] }).get(0), ba1 = bendAllowance(90, 1, 1, 0.4);
  ok('Durchzug: runde Bohrung erkannt, Fenster nicht; Vorbohrung aus Biegezugabe und Höhe', near(hc.R, 4, 1e-9) && !holeCircle(win) && !!cp && near(cp.Rb, 6, 1e-9) && near(cp.hs, 1, 1e-9) && near(cp.flat, 6 - ba1 - 1, 1e-9), `Vorbohrung Ø ${(2 * cp.flat).toFixed(3)}`);
  const fpC = flatPattern(poly, { ...g, collars: [{ hole: 0, h: 2 }] }, [hole]);
  const loopC = fpC.outline.find(p => p.length > 30 && p.every(q => Math.hypot(q[0] - 30, q[1] - 30) < 5));
  ok('Durchzug: im Zuschnitt die kleinere Vorbohrung, dazu der Umriss der Umformung', !!loopC && loopC.every(q => near(Math.hypot(q[0] - 30, q[1] - 30), cp.flat, 2e-3)) && fpC.forms.length === 1 && near(Math.hypot(fpC.forms[0][0][0] - 30, fpC.forms[0][0][1] - 30), 6, 1e-6));
  let e4 = '';
  try { flatPattern(poly, { ...g, collars: [{ hole: 0, h: 6 }] }, [hole]); } catch (err) { e4 = err.message; }
  const chC = sheetChecks(poly, [hole], { ...g, collars: [{ hole: 0, h: 3 }] }, null), chHigh = sheetChecks(poly, [hole], { ...g, collars: [{ hole: 0, h: 6 }] }, null);
  ok('Durchzug: zu hoch wird abgelehnt, starke Aufweitung gemeldet', /zu hoch/.test(e4) && chC.some(c => c.level === 'warn' && /aufgeweitet/.test(c.text)) && chHigh.some(c => /zu hoch/.test(c.text)), e4);
  // beads
  const bs = beadShape(1, { a: [20, 30], b: [80, 30], w: 8, h: 2 });
  let e5 = '';
  try { beadShape(1, { a: [20, 30], b: [80, 30], w: 8, h: 5 }); } catch (err) { e5 = err.message; }
  const fpB = flatPattern(poly, { ...g, beads: [{ a: [20, 30], b: [80, 30], w: 8, h: -2 }] });
  const bx = fpB.forms[0].map(p => p[0]), by = fpB.forms[0].map(p => p[1]);
  ok('Sicke: Radius aus Breite und Höhe, Umriss im Zuschnitt, zu hohe Sicke abgelehnt', near(bs.rho, 5, 1e-9) && near(bs.ri, 4, 1e-9) && bs.sg === 1 && /halbe Breite/.test(e5) && near(fpB.area, 6000, 0.01) && near(Math.min(...bx), 16, 1e-6) && near(Math.max(...bx), 84, 1e-6) && near(Math.min(...by), 26, 1e-6) && near(Math.max(...by), 34, 1e-6));
  const chB = sheetChecks(poly, [], { ...g, beads: [{ a: [20, 30], b: [80, 30], w: 8, h: 4 }, { a: [20, 56], b: [80, 56], w: 8, h: 2 }] }, null);
  ok('Sicke: starke Streckung und Lage am Rand gemeldet', chB.some(c => /Sicke 1: das Blech wird/.test(c.text)) && sheetChecks(poly, [], { ...g, beads: [{ a: [20, 30], b: [80, 30], w: 8, h: 2 }, { a: [20, 30], b: [80, 30], w: 8, h: 5 }] }, null).some(c => /Sicke 2: die Höhe/.test(c.text)) && chB.some(c => /Sicke 2: liegt/.test(c.text)) && !chB.some(c => /Sicke 2: das Blech/.test(c.text)), chB.map(c => c.text.slice(0, 40)).join(' | '));
}

// ---- standard parts ----
{
  const { STD_FAMILIES, stdPartSteps, stdPartVolume, stdPartName, stdFamily } = await import('../js/stdparts.js');
  let n = 0, bad = [];
  for (const fam of STD_FAMILIES) for (const z of fam.sizes()) {
    n++;
    try {
      const p = stdPartSteps(fam.id, z, fam.len || 0), v = stdPartVolume(p.steps);
      const okPts = p.steps.every(s => s.k !== 'rev' || (s.pts.length >= 3 && s.pts.every(q => q[0] >= -1e-9 && Number.isFinite(q[0]) && Number.isFinite(q[1]))));
      if (!(v > 0) || !okPts || p.steps[0].op !== 'new' || p.steps.slice(1).some(s => s.op === 'new') || !(p.rmax > 0) || !(p.z1 > p.z0) || !fam.dims(z)) bad.push(`${fam.id} ${z}`);
    } catch (err) { bad.push(`${fam.id} ${z}: ${err.message}`); }
  }
  ok('Normteile: jede Familie in jeder Größe ergibt ein Teil mit Volumen', STD_FAMILIES.length >= 18 && n > 150 && !bad.length, `${STD_FAMILIES.length} Familien, ${n} Größen ${bad.slice(0, 4).join('; ')}`);
  const w = stdPartSteps('iso7089', 'M8'), cap = stdPartSteps('iso4762', 'M6', 20), csk = stdPartSteps('iso10642', 'M6', 20), nut = stdPartSteps('iso4032', 'M10');
  ok('Normteile: Scheibe M8 = 8,4 × 16 × 1,6; Zylinderschraube M6×20 reicht von −20 bis Kopfhöhe 6', near(stdPartVolume(w.steps), Math.PI * (64 - 4.2 * 4.2) * 1.6, 1e-6) && near(cap.z0, -20) && near(cap.z1, 6) && near(cap.rmax, 5) && near(csk.z1, 0) && near(csk.z0, -20) && near(csk.rmax, 6.72));
  const vn = stdPartVolume(nut.steps), rc = (10 - 1.0825 * 1.5) / 2, vhex = (Math.sqrt(3) / 2) * 256 * 8.4 - Math.PI * rc * rc * 8.4;
  ok('Normteile: Mutter M10 – Sechskant SW 16 × 8,4 mit Bohrung, Fasen nehmen wenig weg', vn < vhex && vn > 0.85 * vhex && near(nut.z1, 8.4), `${vn.toFixed(1)} von ${vhex.toFixed(1)} mm³`);
  const th = stdPartSteps('iso4762', 'M8', 30).steps.find(q => q.k === 'thread'), tn = stdPartSteps('iso4032', 'M8').steps.find(q => q.k === 'thread'), sp = stdPartSteps('iso8752', '6', 20), tp = stdPartSteps('iso2339', '6', 50);
  ok('Normteile: 25 Reihen; Gewinde als eigener Schritt (Schraube außen auf d, Mutter innen auf dem Kerndurchmesser), Spannstift hohl, Kegelstift 1:50', STD_FAMILIES.length === 25 && th.size === 'M8' && near(th.r, 4) && near(th.z, -15) && near(tn.r, (8 - 1.0825 * 1.25) / 2) && !stdPartSteps('iso7089', 'M8').steps.some(q => q.k === 'thread') && stdPartVolume(sp.steps) < 0.75 * Math.PI * 9 * 20 && near(tp.rmax, 3.5) && stdPartName(stdFamily('din6885b'), '6×6', 25) === 'DIN 6885 B 6×6×25');
  let e = '';
  try { stdPartSteps('iso7380', 'M24', 20); } catch (err) { e = err.message; }
  ok('Normteile: Name und fehlende Größe', stdPartName(stdFamily('iso4762'), 'M6', 20) === 'ISO 4762 M6×20' && stdPartName(stdFamily('din625'), '608', 0) === 'DIN 625 608' && /gibt es in der Norm nicht/.test(e));
}

// ---- louvres, embossing, dimples ----
{
  const { louverShape, pressPlan } = await import('../js/sheetmetal.js');
  const poly = [[0, 0], [100, 0], [100, 60], [0, 60]], g = { thickness: 1, radius: 1, kfactor: 0.4, flanges: [] };
  const circ = (c, r, n = 24) => Array.from({ length: n }, (_, i) => [c[0] + r * Math.cos((2 * Math.PI * i) / n), c[1] + r * Math.sin((2 * Math.PI * i) / n)]);
  const lv = { a: [20, 20], b: [60, 20], w: 6, h: 3 }, q = louverShape(1, lv);
  let e1 = '', e2 = '';
  try { louverShape(1, { ...lv, h: 7 }); } catch (err) { e1 = err.message; }
  try { louverShape(1, { ...lv, b: [30, 20] }, 2); } catch (err) { e2 = err.message; }
  const fpL = flatPattern(poly, { ...g, louvers: [lv, { ...lv, a: [20, 50], b: [60, 50], w: -6 }] });
  const ys = fpL.forms[0].map(p => p[1]), ys2 = fpL.forms[1].map(p => p[1]);
  ok('Kieme: Radius der Haube, Schlitz als Schnitt im Zuschnitt, Haube links / rechts der Linie', near(q.rho, (36 + 9) / 6, 1e-9) && near(q.a1[0], 26) && near(q.b1[0], 54) && /höchstens die Tiefe/.test(e1) && /Kieme 3: der Schlitz/.test(e2) && fpL.slits.length === 2 && near(fpL.area, 6000, 0.01) && near(fpL.cutLength, 320 + 80, 0.01) && near(Math.max(...ys), 26, 1e-6) && near(Math.min(...ys), 20, 1e-6) && near(Math.min(...ys2), 44, 1e-6) && near(Math.max(...ys2), 50, 1e-6));
  const win = [[60, 20], [80, 20], [80, 40], [60, 40]], hole = circ([30, 30], 3);
  const pp = pressPlan([hole, win], { ...g, embosses: [{ hole: 1, h: 2 }], dimples: [{ hole: 0, h: -1 }, { hole: 1, h: -1 }] });
  const fpE = flatPattern(poly, { ...g, embosses: [{ hole: 1, h: 2 }], dimples: [{ hole: 0, h: -1 }] }, [hole, win]);
  ok('Prägung und Senkprägung: Prägung bleibt im Zuschnitt zu, die Bohrung der Senkprägung bleibt; Umrisse der Umformung', pp.get(1).kind === 'emboss' && pp.get(0).kind === 'dimple' && near(pp.get(0).Ro, 4, 1e-9) && fpE.outline.length === 2 && near(fpE.area, 6000 - Math.abs(fpL.area - fpL.area) - 0.5 * 24 * 9 * Math.sin(Math.PI / 12), 0.01) && fpE.forms.length === 2);
  const ch = sheetChecks(poly, [hole, win], { ...g, embosses: [{ hole: 1, h: 4 }], dimples: [{ hole: 0, h: -3 }], louvers: [{ a: [20, 2], b: [60, 2], w: -6, h: 3 }] }, null);
  ok('Prägung zu hoch, Senkprägung zu tief, Kieme am Rand gemeldet', ch.some(c => /Prägung 2: 4 mm ist höher/.test(c.text)) && ch.some(c => /Senkprägung 1/.test(c.text)) && ch.some(c => /Kieme 1: liegt/.test(c.text)), ch.map(c => c.text.slice(0, 30)).join(' | '));
}

// ---- cutting program from a nesting plan ----
{
  const { cutProgram } = await import('../js/sheetmetal.js');
  const sq = [[10, 10], [60, 10], [60, 40], [10, 40]], hole = [[30, 20], [30, 30], [40, 30], [40, 20]], sq2 = [[100, 10], [130, 10], [130, 30], [100, 30]];
  const p = cutProgram([sq, hole, sq2], { mode: 'laser', kerf: 0.2, feed: 1200, lead: 3, pierce: 0.5, power: 800, thickness: 2, name: 'Test (1)' });
  const lines = p.text.trim().split('\n'), g1 = lines.filter(l => l.startsWith('G1'));
  const xs = p.paths[1].pts.map(q => q[0]), hx = p.paths[0].pts.map(q => q[0]);
  const inHole = p.paths[0].lead[0] > 30 && p.paths[0].lead[0] < 40 && p.paths[0].lead[1] > 20 && p.paths[0].lead[1] < 30, outside = !(p.paths[1].lead[0] > 10 && p.paths[1].lead[0] < 60 && p.paths[1].lead[1] > 10 && p.paths[1].lead[1] < 40);
  ok('Schneidprogramm: Ausschnitt vor Umriss, Bahn um die halbe Fuge im Abfall, Anschnitt aus dem Abfall', p.pierces === 3 && p.paths[0].hole && !p.paths[1].hole && near(Math.min(...xs), 9.9, 2e-3) && near(Math.max(...xs), 60.1, 2e-3) && near(Math.min(...hx), 30.1, 2e-3) && near(Math.max(...hx), 39.9, 2e-3) && inHole && outside, `${p.pierces} Einstiche, ${p.length.toFixed(1)} mm`);
  ok('Schneidprogramm: Kopf mit Warnung, M3 S / G4 / M5 je Kontur, Ende M30', lines[0] === '(Test  1 )' && /ACHTUNG/.test(lines[2]) && lines[3] === 'G21 G90 G17' && lines.filter(l => l === 'M3 S800').length === 3 && lines.filter(l => l === 'G4 P0.5').length === 3 && lines.filter(l => l === 'M5').length === 3 && lines[lines.length - 1] === 'M30' && /F1200$/.test(g1[0]) && near(p.length, 2 * (50.2 + 30.2) + 2 * (9.8 + 9.8) + 2 * (30.2 + 20.2) + 3 * 3, 0.5) && p.minutes > 0.2);
  const m = cutProgram([sq], { mode: 'mill', kerf: 3, feed: 600, lead: 4, thickness: 2, step: 1, rpm: 18000 });
  const ml = m.text.trim().split('\n'), zs = ml.filter(l => /^G1 Z/.test(l)).map(l => +l.match(/Z(-?[\d.]+)/)[1]);
  ok('Schneidprogramm Fräsen: Durchgänge bis unter das Blech, Bahn um den halben Fräser außen', ml.includes('M3 S18000') && zs.join(',') === '-1,-2,-2.3' && near(Math.min(...m.paths[0].pts.map(q => q[0])), 8.5, 2e-3) && ml.filter(l => l === 'G0 Z5').length === 2 && !ml.some(l => l.startsWith('G4')), zs.join(' / '));
  // tabs, open cuts, controls
  const big = [[0, 0], [100, 0], [100, 50], [0, 50]];
  const tb = cutProgram([big, [[20, 20], [20, 30], [30, 30], [30, 20]]], { mode: 'laser', kerf: 0, feed: 1000, lead: 2, pierce: 0.2, power: 500, thickness: 2, tabs: 4, tabW: 1 });
  const tl = tb.text.trim().split('\n'), outer = tb.paths.find(q => !q.hole);
  ok('Schneidprogramm: Haltestege – der Strahl setzt je Steg aus, Ausschnitte bekommen keine', tb.tabs === 4 && outer.tabs.length === 4 && tb.paths.find(q => q.hole).tabs.length === 0 && tb.pierces === 2 + 4 && tl.filter(l => l === 'M5').length === 6 && near(tb.length, 300 + 40 - 4 + 2 + 2, 0.05) && outer.tabs.every(([a, b]) => near(b - a, 1, 1e-9)), `${tb.pierces} Einstiche, ${tb.length.toFixed(2)} mm`);
  const tm = cutProgram([big], { mode: 'mill', kerf: 2, feed: 600, lead: 3, thickness: 3, step: 1.5, tabs: 2, tabW: 3, tabH: 1 });
  const tz = tm.text.trim().split('\n').filter(l => /^G1 Z/.test(l)).map(l => +l.match(/Z(-?[\d.]+)/)[1]);
  ok('Schneidprogramm Fräsen: Stege bleiben 1 mm hoch stehen (nur in den Durchgängen darunter)', tm.tabs === 2 && tz.join(',') === '-1.5,-3,-2,-3,-2,-3,-3.3,-2,-3.3,-2,-3.3' && near(tm.paths[0].tabs[0][1] - tm.paths[0].tabs[0][0], 5, 1e-9), tz.join(' '));
  const sl = cutProgram([big], { mode: 'plasma', kerf: 1, feed: 2000, lead: 3, pierce: 0.3, thickness: 2, open: [[[40, 20], [70, 20]]], control: 'plasmac' });
  const sll = sl.text.trim().split('\n');
  ok('Schneidprogramm: Kiemenschlitz auf seiner Linie vor dem Umriss, QtPlasmaC ohne G4', sl.paths[0].open && sl.pierces === 2 && sll.includes('G0 X40 Y20') && sll.includes('G1 X70 Y20 F2000') && sll.filter(l => l === 'M3 $0 S1').length === 2 && sll.filter(l => l === 'M5 $0').length === 2 && !sll.some(l => l.startsWith('G4')) && sll.indexOf('G1 X70 Y20 F2000') < sll.findIndex(l => /^G1 X-?[\d.]+ Y-0\.5/.test(l)), sll.slice(4, 9).join(' | '));
  const cu = cutProgram([big], { mode: 'waterjet', kerf: 0.8, feed: 300, thickness: 2, control: 'custom', onCode: 'M62 P1\nM64', offCode: 'M63 P1' }), gr = cutProgram([big], { mode: 'laser', power: 700, control: 'grbl' });
  ok('Schneidprogramm: eigene Befehle (einzeilig) und GRBL-Laser M4', cu.text.includes('\nM62 P1 M64\n') && cu.text.includes('\nM63 P1\n') && gr.text.includes('\nM4 S700\n') && gr.text.includes('\nM5\n'));
  const { nestParts } = await import('../js/sheetmetal.js');
  for (const tight of [false, true]) {
    const np = nestParts([{ id: 'a', outline: [[[0, 0], [80, 0], [80, 30], [0, 30]]], open: [[[10, 15], [40, 15]]], qty: 2 }], 60, 200, 5, true, tight);
    const good = np.placed.length === 2 && np.placed.every(p => { const xs = p.loops[0].map(q => q[0]), ys = p.loops[0].map(q => q[1]), o = p.open[0]; return o && near(Math.hypot(o[1][0] - o[0][0], o[1][1] - o[0][1]), 30, 1e-6) && o.every(q => q[0] > Math.min(...xs) + 5 && q[0] < Math.max(...xs) - 5 && q[1] > Math.min(...ys) + 5 && q[1] < Math.max(...ys) - 5); });
    ok(`Schachteln (${tight ? 'ineinander' : 'Reihen'}): Schlitze wandern gedreht mit ihrem Zuschnitt`, good, JSON.stringify(np.placed.map(p => p.open[0])));
  }
  {
    const sqr = (x0, y0, x1, y1) => [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], inP = ([x, y], P) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) if ((P[i][1] > y) !== (P[j][1] > y) && x < ((P[j][0] - P[i][0]) * (y - P[i][1])) / (P[j][1] - P[i][1]) + P[i][0]) c = !c; return c; };
    const base = { mode: 'laser', kerf: 0.2, feed: 1000, lead: 3, pierce: 0.2, thickness: 2 };
    const h1 = cutProgram([sqr(0, 0, 100, 60), sqr(20, 20, 50, 50)], { ...base, tabs: 4, tabW: 1, holeTabs: 100 }), h2 = cutProgram([sqr(0, 0, 100, 60), sqr(20, 20, 50, 50)], { ...base, tabs: 4, tabW: 1, holeTabs: 200 });
    ok('Schneidprogramm: Haltestege auch in Ausschnitten ab dem gewählten Umfang', h1.tabs === 8 && h1.paths.find(q => q.hole).tabs.length === 4 && h2.tabs === 4 && h2.paths.find(q => q.hole).tabs.length === 0, `${h1.tabs} ${h2.tabs}`);
    const A = sqr(0, 0, 50, 50), B = sqr(50.2, 0, 100.2, 50);
    const c1 = cutProgram([A, B], { ...base, common: true }), c0 = cutProgram([A, B], base);
    ok('Schneidprogramm: gemeinsame Kante zweier Zuschnitte (eine Schnittfuge Abstand) wird nur einmal geschnitten', near(c1.saved, 50, 0.3) && c0.saved === 0 && near(c0.length - c1.length, c1.saved, 1e-6) && c1.pierces >= 2, `${c1.saved} ${c0.length} ${c1.length}`);
    ok('Schneidprogramm: der Anschnitt liegt nicht im Nachbarteil', [c1, c0].every(p => p.paths.every(q => !inP(q.lead, A) && !inP(q.lead, B))), JSON.stringify(c1.paths.map(q => q.lead)));
    const tight = cutProgram([sqr(0, 0, 60, 60), sqr(10, 10, 50, 50), sqr(10.2, 10.2, 49.8, 49.8)], base);
    ok('Schneidprogramm: ohne freien Abfall neben der Kontur wird auf der Kontur eingestochen', tight.paths.length === 3 && tight.paths.filter(q => q.lead[0] === q.pts[0][0] && q.lead[1] === q.pts[0][1]).length === 2, JSON.stringify(tight.paths.map(q => [q.lead, q.pts[0]])));
    const sum = k => c1.trace.filter(q => q[4] === k).reduce((a, q) => a + Math.hypot(q[2] - q[0], q[3] - q[1]), 0);
    ok('Schneidprogramm: die Spur für die Vorschau (Schnitt + Anschnitt = Schnittlänge, Eilgang, Stege)', near(sum(1) + sum(2), c1.length, 1e-6) && sum(0) > 50 && h1.trace.filter(q => q[4] === 3).length >= 8 && c1.trace.every(q => q.length === 5), `${sum(1) + sum(2)} ${c1.length}`);
    const cm = cutProgram([A, sqr(53, 0, 103, 50)], { mode: 'mill', kerf: 3, feed: 600, lead: 4, thickness: 2, step: 1, common: true });
    ok('Schneidprogramm Fräsen: über der gemeinsamen Kante fährt der Fräser oben im Eilgang', near(cm.saved, 50, 3.2) && cm.text.split('\n').filter(l => l === 'G0 Z5').length >= 4, String(cm.saved));
    const { boltSizeFor, boltStack } = await import('../js/stdparts.js');
    const bs = boltStack('iso4762', 'M6', 12, { headWasher: 'iso7089', nut: 'iso4032', nutWasher: 'iso7089' }), bc = boltStack('iso10642', 'M6', 12, { headWasher: 'iso7089', nut: 'iso10511' }), bn = boltStack('iso4017', 'M8', 30, {});
    ok('Normteile: Verschraubung – Größe aus der Bohrung, Länge aus Klemmdicke + Scheiben + Mutter + 2 Gänge', boltSizeFor(6.6) === 'M6' && boltSizeFor(9) === 'M8' && boltSizeFor(5.5) === 'M5' && boltSizeFor(2) === null && boltSizeFor(40) === null
      && near(bs.need, 12 + 1.6 + 1.6 + 5.2 + 2) && bs.len === 25 && bc.hw === 0 && near(bc.need, 20) && bc.len === 20 && bn.len === 30 && bn.m === 0, JSON.stringify([bs, bc, bn]));
  }
}

// ---- a cone as a CAD export triangulates it: rings of corners with different divisions ----
{
  const ring = (r, z, n) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z]);
  const build = (flip) => {
    const A = ring(10, 0, 48), B = ring(8.5, 1.5, 24), C = ring(7, 3, 48), tris = [];
    const add = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2]], g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; const out = n[0] * g[0] + n[1] * g[1] > 0; tris.push(...(out !== flip ? [a, b, c] : [a, c, b])); };
    for (let j = 0; j < 24; j++) for (const F of [A, C]) { const f0 = F[2 * j], f1 = F[2 * j + 1], f2 = F[(2 * j + 2) % 48], c0 = B[j], c1 = B[(j + 1) % 24]; add(f0, f1, c0); add(f1, f2, c1); add(f1, c1, c0); }
    return M.weld(new Float32Array(tris.flat()));
  };
  const pin = M.findRound(build(false)), hole = M.findRound(build(true));
  const c = pin.cones[0], hc = hole.cones[0];
  // what the facets leave out: frustum minus the two faceted frustums (48 ↔ 24 corners, by the prismatoid rule)
  ok('Netz: Kegel aus Punktringen verschiedener Teilung (CAD-Export) erkannt, als Zapfen und als Senkung', pin.cones.length === 1 && pin.spheres.length === 0 && !!c && near(c.r0, 7, 1e-3) && near(c.r1, 10, 1e-3) && near(c.t1 - c.t0, 3, 1e-3) && !c.hole && c.vol > 0.5 && c.vol < 6 && c.n >= 8 && !c.sweep && hole.cones.length === 1 && hc.hole && near(hc.vol, c.vol, 1e-6), c ? `Rest ${c.vol.toFixed(3)} mm³, n ${c.n}` : '');
}

// ---- a cone as the kernel meshes it: rings of different division, flat strips in between, a tip ----
{
  const ring = (r, z, n, ph = 0) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n + ph), r * Math.sin((2 * Math.PI * i) / n + ph), z]);
  const tris = [];
  const add = (a, b, c) => { const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]], n = [u[1] * v[2] - u[2] * v[1], u[2] * v[0] - u[0] * v[2]], g = [(a[0] + b[0] + c[0]) / 3, (a[1] + b[1] + c[1]) / 3]; tris.push(...(n[0] * g[0] + n[1] * g[1] > 0 ? [a, b, c] : [a, c, b])); };
  // two rings zipped by angle
  const band = (A, B) => { let i = 0, j = 0; const na = A.length, nb = B.length; while (i < na || j < nb) { if (j >= nb || (i < na && (i + 1) / na <= (j + 1) / nb)) { add(A[i % na], A[(i + 1) % na], B[j % nb]); i++; } else { add(B[j % nb], B[(j + 1) % nb], A[i % na]); j++; } } };
  const build = rs => { tris.length = 0; for (let k = 0; k + 1 < rs.length; k++) { if (rs[k + 1].length === 1) rs[k].forEach((p, i) => add(p, rs[k][(i + 1) % rs[k].length], rs[k + 1][0])); else band(rs[k], rs[k + 1]); } return M.findRound(M.weld(new Float32Array(tris.flat()))); };
  const fr = build([ring(10, 0, 45), ring(8.25, 2, 32), ring(6.5, 4, 32), ring(4.75, 6, 32), ring(3, 8, 42)]), c = fr.cones[0];
  ok('Netz: Kegelstumpf mit fünf Ringen (45/32/32/32/42 Ecken, Streifen dazwischen fast eben zum Rand) in einem Stück', fr.cones.length === 1 && !!c && near(c.r0, 3, 2e-3) && near(c.r1, 10, 2e-3) && near(c.t1 - c.t0, 8, 2e-3) && !c.hole && c.vol > 0, JSON.stringify(fr.cones.map(q => [+q.r0.toFixed(2), +q.r1.toFixed(2), q.n])));
  const tp = build([ring(10, 0, 45), ring(8, 2.4, 32), [[0, 0, 12]]]), t = tp.cones[0];
  ok('Netz: Kegel mit Spitze – der unregelmäßige Rand gehört dazu', tp.cones.length === 1 && !!t && near(t.r0, 0, 1e-6) && near(t.r1, 10, 2e-3) && near(t.t1 - t.t0, 12, 2e-3) && t.vol > 0 && t.vol < 0.02 * ((Math.PI * 100 * 12) / 3), JSON.stringify(tp.cones.map(q => [+q.r0.toFixed(2), +q.r1.toFixed(2), q.n, +(q.vol ?? -1).toFixed(2)])));
}

// ---- a torus: the fillet round a round edge, as rings of corners on a circle in the plane through the axis ----
{
  const ring = (r, z, n, a0 = 0, sw = 2 * Math.PI) => Array.from({ length: sw < 6.28 ? n + 1 : n }, (_, i) => [r * Math.cos(a0 + (sw * i) / n), r * Math.sin(a0 + (sw * i) / n), z]);
  const mk = (rings, { flip = false, open = false, cap = false } = {}) => {
    const tris = [], put = t => tris.push(...(flip ? [t[0], t[2], t[1]] : t));
    for (let k = 0; k + 1 < rings.length; k++) { const A = rings[k], B = rings[k + 1], n = A.length; for (let i = 0; i < (open ? n - 1 : n); i++) { const j = (i + 1) % n; put([A[i], A[j], B[j]]); put([A[i], B[j], B[i]]); } }
    if (cap) { const L = rings[rings.length - 1], F = rings[0], n = L.length; for (let i = 0; i < n; i++) { put([L[i], L[(i + 1) % n], [0, 0, L[0][2]]]); put([F[(i + 1) % n], F[i], [0, 0, F[0][2]]]); } }
    return M.weld(new Float32Array(tris.flat()));
  };
  const volOf = m => { let v = 0; const P = m.pos, I = m.idx; for (let t = 0; t < I.length; t += 3) { const a = [P[I[t] * 3], P[I[t] * 3 + 1], P[I[t] * 3 + 2]], b = [P[I[t + 1] * 3], P[I[t + 1] * 3 + 1], P[I[t + 1] * 3 + 2]], c = [P[I[t + 2] * 3], P[I[t + 2] * 3 + 1], P[I[t + 2] * 3 + 2]]; v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return v; };
  const N = 48, K = 6, HP = Math.PI / 2;
  // a disc Ø 20 × 5 with its upper edge rounded 2 mm
  const prof = (n, a0, sw) => [ring(10, 0, n, a0, sw), ring(10, 3, n, a0, sw), ...Array.from({ length: K }, (_, i) => { const s = ((i + 1) * HP) / K; return ring(8 + 2 * Math.cos(s), 3 + 2 * Math.sin(s), n, a0, sw); })];
  const m1 = mk(prof(N), { cap: true }), f1 = M.findRound(m1), t1 = f1.tori[0], g = (2 * Math.PI) / N;
  // what the facets leave out: the true solid less the mesh, less what the cylinder below leaves out
  const want = Math.PI * 100 * 3 + Math.PI * 64 * 2 + 2 * Math.PI * (8 + 8 / (3 * Math.PI)) * Math.PI - volOf(m1) - Math.PI * 100 * 3 * (1 - Math.sin(g) / g);
  ok('Netz: Verrundung um eine runde Kante als Torus erkannt (Scheibe, Kante oben 2 mm)', f1.tori.length === 1 && f1.cylinders.length === 1 && !f1.cones.length && !f1.spheres.length && near(t1.R, 8, 1e-3) && near(t1.r, 2, 1e-3) && t1.s0 === 0 && t1.s1 === HP && !t1.inner && !t1.hole && !t1.sweep && t1.n === N && near(t1.c[2], 3, 1e-3) && near(t1.vol, want, 0.02 * want), `${t1?.vol} ${want}`);
  const f2 = M.findRound(mk(prof(N), { cap: true, flip: true })), t2 = f2.tori[0];
  ok('Netz: dieselbe Form als Hohlraum (Tasche mit rundem Grund) – Material außen', f2.tori.length === 1 && !f2.cones.length && t2.hole && !t2.inner && near(t2.vol, t1.vol, 1e-6), String(t2?.vol));
  const f3 = M.findRound(mk(prof(12, 0.3, HP), { open: true })), t3 = f3.tori[0];
  ok('Netz: Viertel eines Torus (Verrundung um eine runde Ecke) mit Anfang und Bogen', f3.tori.length === 1 && !f3.cones.length && near(t3.a0, 0.3, 1e-3) && near(t3.sweep, HP, 1e-3) && near(t3.vol, t1.vol / 4, 0.01 * t1.vol) && t3.n === N, JSON.stringify([t3?.a0, t3?.sweep, t3?.vol, t3?.n]));
  // the rim of a hole Ø 12, rounded 2 mm: the half of the tube that looks to the axis
  const rim = [ring(6, 0, N), ring(6, 3, N), ...Array.from({ length: K }, (_, i) => { const s = ((i + 1) * HP) / K; return ring(8 - 2 * Math.cos(s), 3 + 2 * Math.sin(s), N); })];
  const f4 = M.findRound(mk(rim, { flip: true })), t4 = f4.tori[0];
  ok('Netz: gerundeter Bohrungsrand – innere Hälfte des Torus, die Facetten liegen beiderseits der Fläche', f4.tori.length === 1 && !f4.cones.length && t4.inner && !t4.hole && t4.vol === null && near(t4.R, 8, 1e-3) && near(t4.r, 2, 1e-3) && t4.din > 1e-3 && t4.dout > 1e-3, JSON.stringify([t4?.din, t4?.dout]));
  const tilt = m => { const c = Math.cos(0.4), s = Math.sin(0.4), P = m.pos; for (let i = 0; i < P.length; i += 3) { const y = P[i + 1], z = P[i + 2]; P[i + 1] = y * c - z * s; P[i + 2] = y * s + z * c; } return m; };
  const f5 = M.findRound(tilt(mk(prof(N).slice(1)))), t5 = f5.tori[0];
  ok('Netz: Torus mit schräger Achse, ohne Zylinder daneben (Achse aus den Flächenrichtungen)', f5.tori.length === 1 && near(t5.R, 8, 1e-3) && near(t5.r, 2, 1e-3) && near(Math.abs(t5.d[2]), Math.cos(0.4), 1e-4), JSON.stringify(t5?.d));
  // (two bands only say nothing: a cone is no torus, a ball stays a ball)
  const f6 = M.findRound(mk([ring(10, 0, N), ring(8, 2, N), ring(6, 4, N), ring(4, 6, N), ring(2, 8, N)]));
  ok('Netz: ein Kegel aus mehreren Ringen wird kein Torus', f6.tori.length === 0 && f6.cones.length === 1, `${f6.tori.length} ${f6.cones.length}`);
}

// ---- large facets stand in for the many small ones of a torus or of the cap of a sphere ----
{
  const ring = (r, z, n) => Array.from({ length: n }, (_, i) => [r * Math.cos((2 * Math.PI * i) / n), r * Math.sin((2 * Math.PI * i) / n), z]);
  const volOf = m => { let v = 0; const P = m.pos, I = m.idx; for (let t = 0; t < I.length; t += 3) { const a = [P[I[t] * 3], P[I[t] * 3 + 1], P[I[t] * 3 + 2]], b = [P[I[t + 1] * 3], P[I[t + 1] * 3 + 1], P[I[t + 1] * 3 + 2]], c = [P[I[t + 2] * 3], P[I[t + 2] * 3 + 1], P[I[t + 2] * 3 + 2]]; v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return v; };
  const N = 64, K = 12, HP = Math.PI / 2, rings = [ring(10, 0, N), ring(10, 3, N), ...Array.from({ length: K }, (_, i) => { const s = ((i + 1) * HP) / K; return ring(8 + 2 * Math.cos(s), 3 + 2 * Math.sin(s), N); })];
  const tris = [], put = t => tris.push(...t);
  for (let k = 0; k + 1 < rings.length; k++) for (let i = 0; i < N; i++) { const j = (i + 1) % N; put([rings[k][i], rings[k][j], rings[k + 1][j]]); put([rings[k][i], rings[k + 1][j], rings[k + 1][i]]); }
  for (let i = 0; i < N; i++) { put([rings[K + 1][i], rings[K + 1][(i + 1) % N], [0, 0, 5]]); put([rings[0][(i + 1) % N], rings[0][i], [0, 0, 0]]); }
  const m = M.weld(new Float32Array(tris.flat())), f = M.findRound(m), st = M.standIn(m, f.tori, f.spheres), it = st.tori[0];
  // the true solid: cylinder 3 high, disc Ø 16 × 2, a quarter circle turned around
  const full = Math.PI * 100 * 3 + Math.PI * 64 * 2 + 2 * Math.PI * (8 + 8 / (3 * Math.PI)) * Math.PI, g = (2 * Math.PI) / N, cylGap = Math.PI * 100 * 3 * (1 - Math.sin(g) / g);
  ok('Netz → Körper: eine scharfe Ecke vertritt die Verrundung einer runden Kante (Netz bleibt geschlossen, Rauminhalt bis zur echten Fläche stimmt)', st.tori.length === 1 && it.corner && M.stats(st.m).closed && st.m.idx.length < m.idx.length / 3 && near(it.dout, 2 * (Math.SQRT2 - 1), 0.02) && near(volOf(st.m), Math.PI * 100 * 5 * (Math.sin(g) / g), 0.01) && near(volOf(st.m) - it.vol, full - cylGap, 0.05), `${m.idx.length / 3} → ${st.m.idx.length / 3} Dreiecke, ${volOf(st.m) - it.vol} ${full - cylGap}`);
  // a cap of a sphere r 10 (1 rad from its pole) on a plate 30 × 30 × 2
  const t2 = [], p2 = t => t2.push(...t), R0 = 10, al = 1, n = 48, kk = 10, zc = -R0 * Math.cos(al);
  const rr = Array.from({ length: kk }, (_, i) => { const a = al * (1 - i / kk); return ring(R0 * Math.sin(a), zc + R0 * Math.cos(a), n); });
  for (let k = 0; k + 1 < rr.length; k++) for (let i = 0; i < n; i++) { const j = (i + 1) % n; p2([rr[k][i], rr[k][j], rr[k + 1][j]]); p2([rr[k][i], rr[k + 1][j], rr[k + 1][i]]); }
  for (let i = 0; i < n; i++) p2([rr[kk - 1][i], rr[kk - 1][(i + 1) % n], [0, 0, zc + R0]]);
  const B = rr[0], cs = [[15, 15, 0], [-15, 15, 0], [-15, -15, 0], [15, -15, 0]], lo = cs.map(p => [p[0], p[1], -2]);
  for (let i = 0; i < n; i++) p2([B[(i + 1) % n], B[i], cs[Math.floor(i / (n / 4))]]);
  for (let q = 0; q < 4; q++) { const r = (q + 1) % 4; p2([cs[q], cs[r], B[((q + 1) * n) / 4 % n]]); p2([cs[q], lo[q], lo[r]]); p2([cs[q], lo[r], cs[r]]); }
  p2([lo[0], lo[2], lo[1]]); p2([lo[0], lo[3], lo[2]]);
  const m2 = M.weld(new Float32Array(t2.flat())), f2 = M.findRound(m2), s2 = M.standIn(m2, f2.tori, f2.spheres), cap = s2.spheres[0], hh = R0 - R0 * Math.cos(al);
  ok('Netz → Körper: ein flacher Deckel vertritt die Kugelkuppe – übrig bleibt die Platte, die Kuppe kommt als echtes Kugelstück dazu', M.stats(m2).closed && f2.spheres.length === 1 && s2.spheres.length === 1 && M.stats(s2.m).closed && near(volOf(s2.m), 1800, 1e-2) && near(cap.h0, R0 * Math.cos(al), 1e-3) && near(cap.vol, (Math.PI * hh * hh * (3 * R0 - hh)) / 3, 0.01) && Math.abs(cap.ax[2]) > 0.9999, `${volOf(s2.m)} ${cap?.vol}`);
}

// ---- the half of a tube that looks to the axis, and a ring on its own ----
{
  const volOf = m => { let v = 0; const P = m.pos, I = m.idx; for (let t = 0; t < I.length; t += 3) { const a = [P[I[t] * 3], P[I[t] * 3 + 1], P[I[t] * 3 + 2]], b = [P[I[t + 1] * 3], P[I[t + 1] * 3 + 1], P[I[t + 1] * 3 + 2]], c = [P[I[t + 2] * 3], P[I[t + 2] * 3 + 1], P[I[t + 2] * 3 + 2]]; v += (a[0] * (b[1] * c[2] - b[2] * c[1]) - a[1] * (b[0] * c[2] - b[2] * c[0]) + a[2] * (b[0] * c[1] - b[1] * c[0])) / 6; } return v; };
  // a closed profile (distance from the axis, height) turned around z in N steps
  const turn = (prof, N) => {
    const tris = [], pt = (p, i) => [p[0] * Math.cos((2 * Math.PI * i) / N), p[0] * Math.sin((2 * Math.PI * i) / N), p[1]];
    for (let k = 0; k < prof.length; k++) { const a = prof[k], b = prof[(k + 1) % prof.length]; for (let i = 0; i < N; i++) { tris.push(pt(a, i), pt(b, i), pt(b, i + 1)); tris.push(pt(a, i), pt(b, i + 1), pt(a, i + 1)); } }
    let m = M.weld(new Float32Array(tris.flat()));
    if (volOf(m) < 0) { const I = m.idx; for (let t = 0; t < I.length; t += 3) { const x = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = x; } }
    return m;
  };
  const N = 96, kN = (N * Math.sin((2 * Math.PI) / N)) / (2 * Math.PI), K = 12;
  // a disc Ø 40 × 6 with a hole Ø 12, the rim of the hole rounded with 1.5
  const arc = Array.from({ length: K + 1 }, (_, i) => { const s = (Math.PI / 2) * (1 - i / K); return [7.5 - 1.5 * Math.cos(s), 4.5 + 1.5 * Math.sin(s)]; });
  const m = turn([[6, 0], [20, 0], [20, 6], ...arc], N), f = M.findRound(m), to = f.tori[0], st = M.standIn(m, f.tori, f.spheres), it = st.tori[0];
  const corner = 2 * Math.PI * 1.5 * 1.5 * (7.5 * (1 - Math.PI / 4) - 1.5 / 6);
  ok('Netz → Körper: am verrundeten Rand einer Bohrung vertritt eine scharfe Ecke die Ringfläche (geschlossen, Rauminhalt der Ecke stimmt)', f.tori.length === 1 && to.inner && !to.hole && near(to.R, 7.5, 1e-3) && near(to.r, 1.5, 1e-3) && st.tori.length === 1 && it.corner && M.stats(st.m).closed && near(volOf(st.m), kN * Math.PI * (400 - 36) * 6, 0.01) && near(it.vol, corner + 1.5 * Math.PI * 36 * (1 - kN), 0.01) && near(it.dout, 1.5 * (Math.SQRT2 - 1), 0.02), `${f.tori.length} ${volOf(st.m)} ${kN * Math.PI * (400 - 36) * 6} ${it?.vol} ${corner}`);
  // a pin Ø 16 on a disc Ø 40 × 4, the foot rounded with 2
  const arc2 = Array.from({ length: K + 1 }, (_, i) => { const s = -(Math.PI / 2) * (i / K); return [10 - 2 * Math.cos(s), 6 + 2 * Math.sin(s)]; });
  const m2 = turn([[0, 0], [20, 0], [20, 4], ...arc2.slice().reverse(), [8, 10], [0, 10]], N), f2 = M.findRound(m2), t2 = f2.tori[0], s2 = M.standIn(m2, f2.tori, f2.spheres), i2 = s2.tori[0];
  ok('Netz → Körper: an der Hohlkehle am Fuß eines Zapfens ebenso – die Ecke wird aufgefüllt', f2.tori.length === 1 && t2.inner && t2.hole && near(t2.R, 10, 1e-3) && s2.tori.length === 1 && i2.corner && M.stats(s2.m).closed && near(volOf(s2.m), kN * Math.PI * (400 * 4 + 64 * 6), 0.01) && near(i2.vol, 2 * Math.PI * 4 * (10 * (1 - Math.PI / 4) - 2 / 6) + 2 * Math.PI * 64 * (1 - kN), 0.01), `${f2.tori.length} ${volOf(s2.m)} ${i2?.vol}`);
  // an O-ring 30 × 4, lying askew
  const ringP = Array.from({ length: 24 }, (_, i) => [15 + 2 * Math.cos((2 * Math.PI * i) / 24), 2 * Math.sin((2 * Math.PI * i) / 24)]);
  const m3 = turn(ringP, 64), ca = Math.cos(0.5), sa = Math.sin(0.5);
  for (let i = 0; i < m3.pos.length; i += 3) { const y = m3.pos[i + 1], z = m3.pos[i + 2]; m3.pos[i] += 7; m3.pos[i + 1] = y * ca - z * sa + 3; m3.pos[i + 2] = y * sa + z * ca - 2; }
  const f3 = M.findRound(m3), t3 = f3.tori[0], s3 = M.standIn(m3, f3.tori, f3.spheres), full = 2 * Math.PI * Math.PI * 15 * 4;
  ok('Netz → Körper: ein Ring für sich (O-Ring) wird als ganzer Torus erkannt, auch schräg im Raum', f3.tori.length === 1 && f3.cylinders.length === 0 && t3.whole && near(t3.R, 15, 1e-3) && near(t3.r, 2, 1e-3) && near(t3.c[0], 7, 1e-3) && near(t3.c[1], 3, 1e-3) && near(t3.c[2], -2, 1e-3) && near(Math.abs(t3.d[2]), ca, 1e-4) && near(t3.vol, full - volOf(m3), 1e-2) && s3.tori.length === 0 && t3.ti.length === m3.idx.length / 3, `${f3.tori.length} ${f3.cylinders.length} ${t3?.R} ${t3?.r} ${t3?.c} ${t3?.vol} ${full - volOf(m3)}`);
  // (a ball is no ring)
  const ball = turn(Array.from({ length: 13 }, (_, i) => [5 * Math.sin((Math.PI * i) / 12), -5 * Math.cos((Math.PI * i) / 12)]), 32);
  ok('Netz → Körper: eine Kugel wird kein Ring', !M.findRound(ball).tori.length, `${M.findRound(ball).tori.length}`);
}

// ---- the hole a screw brings along ----
{
  const { boltHole, boltSizeFor } = await import('../js/stdparts.js');
  const a = boltHole('iso4762', 'M6', true), b = boltHole('iso4762', 'M6', false), c = boltHole('iso10642', 'M8', false), d = boltHole('iso4017', 'M10', true);
  let thrown = false; try { boltHole('iso4762', 'M99'); } catch { thrown = true; }
  ok('Normteile: Bohrung zur Schraube – Durchgangsloch ISO 273 mittel, Senkbohrung so tief wie der Kopf, 90°-Senkung für den Senkkopf', a.dia === 6.6 && a.kind === 'cbore' && a.cbDia === 11 && near(a.cbDepth, 6) && near(a.seat, 6) && b.kind === 'simple' && b.seat === 0 && b.dia === 6.6 && c.kind === 'csink' && c.dia === 9 && near(c.csDia, 17.92) && c.csAngle === 90 && c.seat === 0 && d.kind === 'simple' && d.dia === 11 && thrown && boltSizeFor(a.dia) === 'M6' && boltSizeFor(c.dia) === 'M8', JSON.stringify([a, b, c, d]));
}
