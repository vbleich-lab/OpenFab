// Strict checker for the G-code programs OpenFab writes for milling machines (Fanuc / ISO, Okuma OSP-M, LinuxCNC,
// GRBL, Sinumerik 840D): the words of every block and the modal state a control keeps (units, tool and length
// offset, spindle, feed, radius compensation, canned cycle, arc geometry).
// lintIso(code, { dialect: 'fanuc' | 'okuma' | 'linuxcnc' | 'grbl' | 'sinumerik' }) -> [{ line, text, msg }]
const DIALECTS = {
  fanuc: { decimal: true, lenComp: 'G43', percent: true, oWord: true, end: [30], cycles: true },
  okuma: { decimal: true, lenComp: 'G56', oWord: true, end: [2, 30], cycles: true, forbid: [28, 53, 43] },
  linuxcnc: { lenComp: 'G43', end: [30, 2], cycles: true, noTapCycle: true },
  grbl: { end: [30, 2], noToolChange: true, noCycles: true, noComp: true },
  sinumerik: { end: [30, 2, 17], dWord: true, siemens: true, forbid: [28, 43, 21, 98] },
};
const MOTION = new Set([0, 1, 2, 3]);
const CYCLES = new Set([73, 74, 76, 81, 82, 83, 84, 85, 86, 87, 88, 89]);
// G codes the posts may write, per dialect extras
const KNOWN_G = new Set([0, 1, 2, 3, 4, 17, 18, 19, 20, 21, 28, 40, 41, 42, 43, 49, 53, 54, 55, 56, 57, 58, 59, 80, 90, 91, 94, 95, 98, 99, ...CYCLES]);
const EXTRA_G = { fanuc: [5.1, 65, 31], okuma: [15, 56, 31], linuxcnc: [64, 61, 38.2, 33.1], grbl: [], sinumerik: [70, 71, 64, 60, 500, 153] };
const SIEMENS_CALL = /^(MCALL\s+)?(CYCLE\d+|HOLES\d|POCKET\d|SLOT\d|LONGHOLE)\((.*)\)$/;

export function lintIso(code, opts = {}) {
  const D = DIALECTS[opts.dialect] || DIALECTS.fanuc, dia = opts.dialect || 'fanuc';
  const known = new Set([...KNOWN_G, ...(EXTRA_G[dia] || [])]);
  const issues = [];
  const rows = code.split('\n');
  const st = {
    units: false, abs: true, motion: null, tool: null, toolLoaded: D.noToolChange ? true : false, lenComp: !D.lenComp && !D.dWord, spindle: false, speed: 0,
    feed: null, comp: 0, cycle: null, mcall: false, ended: false, pos: { X: null, Y: null, Z: null }, probe: false, lastN: null, anyTool: !!D.noToolChange,
  };
  let firstCode = null, lastCode = null;
  rows.forEach((raw, k) => {
    const bad = msg => issues.push({ line: k + 1, text: raw, msg });
    if (/[^\x20-\x7e]/.test(raw)) bad('Zeichen außerhalb ASCII');
    // comments: ( ... ) and ; ...
    let t = D.siemens ? raw.replace(/;.*$/, '') : raw.replace(/\([^()]*\)/g, ' ').replace(/;.*$/, ''); // Sinumerik: ( ) are cycle parameters
    if (/[()]/.test(t)) { if (!D.siemens) bad('Klammer ohne Gegenstück'); }
    t = t.trim();
    if (t === '') return;
    if (firstCode == null) firstCode = k;
    lastCode = k;
    if (t === '%') { if (!D.percent) bad('% ist bei dieser Steuerung nicht üblich'); return; }
    if (st.ended && !(D.percent && t === '%')) { bad('Satz nach dem Programmende'); return; }
    // block number
    const nm = t.match(/^N(\d+)\s*/);
    if (nm) { if (st.lastN != null && +nm[1] <= st.lastN) bad('Satznummer nicht aufsteigend'); st.lastN = +nm[1]; t = t.slice(nm[0].length); if (!t) return; }
    if (/^O\d+$/.test(t)) { if (!D.oWord) bad('O-Nummer ist bei dieser Steuerung nicht üblich'); if (st.anyMotion) bad('O-Nummer nach Programmbeginn'); return; }

    // ---- Sinumerik statements ----
    if (D.siemens) {
      if (t === 'MCALL') { if (!st.mcall) bad('MCALL ohne aktiven modalen Zyklus'); st.mcall = false; st.cycle = null; return; }
      const sc = t.match(SIEMENS_CALL);
      if (sc) {
        const args = sc[3].split(',').map(a => a.trim());
        if (args.some(a => a !== '' && !/^[+-]?(\d+\.?\d*|\.\d+)$/.test(a) && !/^_?[A-Z_]+$/.test(a))) bad(`${sc[2]}: Parameter ist keine Zahl`);
        if (!st.toolLoaded) bad('Zyklus vor dem Werkzeugwechsel');
        if (/^CYCLE8[1-9]$/.test(sc[2])) {
          const [rtp, rfp, sdis, dp] = args.map(Number);
          if (!(rtp > rfp)) bad(`${sc[2]}: Rückzugsebene RTP liegt nicht über der Referenzebene RFP`);
          if (!(dp < rfp)) bad(`${sc[2]}: Endbohrtiefe DP liegt nicht unter der Referenzebene RFP`);
          if (!(sdis > 0)) bad(`${sc[2]}: Sicherheitsabstand SDIS ist nicht größer als 0`);
          if (!st.spindle && sc[2] !== 'CYCLE84') bad(`${sc[2]} bei stehender Spindel`);
          if (st.feed == null && sc[2] !== 'CYCLE84' && sc[2] !== 'CYCLE85') bad(`${sc[2]} ohne programmierten Vorschub`);
          if (sc[2] === 'CYCLE83' && !(Number(args[5]) < rfp && Number(args[5]) >= dp)) bad('CYCLE83: erste Bohrtiefe FDEP liegt nicht zwischen RFP und DP');
        }
        if (/^(HOLES\d|CYCLE801)$/.test(sc[2]) && !st.mcall) bad(`${sc[2]} ohne modalen Bohrzyklus (MCALL) davor`);
        if (st.comp) bad('Zyklus bei aktiver Radiuskorrektur');
        if (sc[1]) { if (st.mcall) bad('MCALL bei bereits aktivem modalen Zyklus'); st.mcall = true; st.cycle = sc[2]; }
        return;
      }
    }

    // SUPA: this block in machine coordinates
    let supa = false;
    if (D.siemens && /\bSUPA\b/.test(t)) { supa = true; t = t.replace(/\bSUPA\b/, ' '); }
    // ---- words ----
    const compact = t.replace(/\s+/g, '');
    const words = [];
    let rest = compact;
    while (rest.length) {
      const m = rest.match(/^([A-Z])([+-]?(?:\d+\.?\d*|\.\d+))/) || (dia === 'linuxcnc' && rest.match(/^(\$)(\d+)/));
      if (!m) { bad(`Unlesbares Wort bei „${rest.slice(0, 12)}“`); return; }
      words.push([m[1], m[2]]);
      rest = rest.slice(m[0].length);
    }
    const all = L => words.filter(w => w[0] === L).map(w => w[1]);
    const one = L => { const v = all(L); if (v.length > 1 && !'GM'.includes(L)) bad(`Wort ${L} doppelt im Satz`); return v.length ? +v[0] : null; };
    const g = all('G').map(Number), m = all('M').map(Number);
    for (const c of g) if (!known.has(c) || (D.forbid || []).includes(c)) bad(`G${c} ist für diese Steuerung nicht vorgesehen`);
    if (g.filter(c => MOTION.has(c) || CYCLES.has(c)).length > 1) bad('Mehrere Wegbedingungen in einem Satz');
    if (g.includes(20)) bad('Zoll-Programm (G20) – OpenFab schreibt Millimeter');
    if (g.includes(21) || g.includes(71)) st.units = true;
    if (g.includes(90)) st.abs = true;
    if (g.includes(91)) st.abs = false;
    const X = one('X'), Y = one('Y'), Z = one('Z'), I = one('I'), J = one('J'), Rw = one('R'), F = one('F'), S = one('S'), T = one('T'), H = one('H'), Dw = one('D'), Q = one('Q'), P = one('P');
    const macro = g.includes(65), dwell = g.includes(4), ref = g.includes(28) || g.includes(53) || supa;
    // decimal point on lengths (a control may read X10 as 0.010)
    if (D.decimal && !macro) for (const [L, v] of words) if ('XYZIJR'.includes(L) && !v.includes('.') && +v !== 0 && !(dwell && L === 'X')) bad(`${L}${v} ohne Dezimalpunkt`);

    if (S != null) { if (!(S >= 0)) bad('Drehzahl negativ'); st.speed = S; }
    if (F != null && !dwell) { if (!(F > 0)) bad('Vorschub F ist nicht größer als 0'); st.feed = F; }
    // tool change
    if (T != null && !macro) st.tool = T;
    if (m.includes(6)) {
      if (D.noToolChange) bad('M6 – diese Steuerung wechselt nicht automatisch');
      if (st.tool == null) bad('M6 ohne Werkzeugnummer');
      if (st.spindle) bad('Werkzeugwechsel bei laufender Spindel (M5 fehlt)');
      if (st.comp) bad('Werkzeugwechsel bei aktiver Radiuskorrektur');
      if (st.cycle || st.mcall) bad('Werkzeugwechsel bei aktivem Bohrzyklus');
      st.toolLoaded = true; st.anyTool = true; st.loaded = st.tool;
      st.lenComp = !D.lenComp && !D.dWord;
      st.feed = null; // F is modal on the control, but a new tool must get its own feed
    }
    if (D.lenComp && g.includes(+D.lenComp.slice(1))) {
      if (H == null) bad(`${D.lenComp} ohne H`);
      else if (st.loaded != null && H !== st.loaded) bad(`${D.lenComp} H${H} passt nicht zum Werkzeug T${st.loaded}`);
      st.lenComp = true;
    }
    if (D.dWord && Dw != null && T != null) st.pendingD = true;
    if (D.dWord && m.includes(6)) st.lenComp = !!st.pendingD;
    if (D.dWord && Dw != null && st.toolLoaded && T == null && !g.includes(41) && !g.includes(42)) st.lenComp = true;
    // spindle
    for (const c of m) {
      if (c === 3 || c === 4) { if (!(st.speed > 0)) bad('Spindel ein ohne Drehzahl'); if (st.spindle && st.dir !== c) bad('Drehrichtung gewechselt ohne M5'); st.spindle = true; st.dir = c; }
      if (c === 5) st.spindle = false;
      if (D.end.includes(c) && [2, 30, 17].includes(c)) {
        st.ended = true;
        if (st.spindle) bad('Programmende bei laufender Spindel');
        if (st.comp) bad('Programmende mit aktiver Radiuskorrektur');
        if (st.cycle || st.mcall) bad('Programmende mit aktivem Bohrzyklus');
        if (!st.abs) bad('Programmende im Kettenmaß (G91)');
        st.spindle = false;
      }
      if (c === 0 || c === 1) { /* stop */ }
    }
    if (m.includes(3) && m.includes(5)) bad('M3 und M5 im selben Satz');
    // radius compensation
    if (g.includes(41) || g.includes(42)) {
      if (D.noComp) bad('G41/G42 kennt diese Steuerung nicht');
      if (st.comp) bad('G41/G42 bei bereits aktiver Radiuskorrektur');
      if (g.includes(2) || g.includes(3) || ((st.motion === 2 || st.motion === 3) && (X != null || Y != null) && !g.includes(0) && !g.includes(1))) bad('Radiuskorrektur auf einem Kreisbogen eingeschaltet');
      if ((dia === 'fanuc' || dia === 'okuma' || dia === 'linuxcnc') && Dw == null) bad('G41/G42 ohne D');
      st.comp = g.includes(41) ? 41 : 42;
    }
    if (g.includes(40)) { if (g.includes(2) || g.includes(3)) bad('Radiuskorrektur auf einem Kreisbogen ausgeschaltet'); st.comp = 0; }
    if (g.includes(80)) st.cycle = null;
    if (macro) { if (P == null) bad('G65 ohne P'); st.probe = true; return; }
    if (dwell) { if (X == null && P == null && F == null && all('U').length === 0) bad('G4 ohne Zeit'); return; }
    if (ref) { // reference / machine coordinates: position unknown afterwards
      for (const a of ['X', 'Y', 'Z']) if (one(a) != null) st.pos[a] = null;
      if (g.includes(28) && st.abs && (X != null || Y != null || Z != null) && !g.includes(91)) { /* G28 through an absolute point */ }
      return;
    }
    // motion
    const cyc = g.find(c => CYCLES.has(c));
    const mot = g.find(c => MOTION.has(c));
    if (mot != null) { if (st.cycle && !g.includes(80) && !D.siemens) bad(`G${mot} bei aktivem Bohrzyklus G${st.cycle} (G80 fehlt)`); st.motion = mot; if (!D.siemens) st.cycle = null; }
    const moves = X != null || Y != null || Z != null;
    if (cyc != null) {
      if (D.noCycles) bad('Bohrzyklus – diese Steuerung kennt keine');
      if (D.noTapCycle && (cyc === 84 || cyc === 74)) bad('G84/G74 kennt diese Steuerung nicht');
      if (Z == null) bad(`G${cyc} ohne Z`);
      if (Rw == null) bad(`G${cyc} ohne R`);
      if (st.feed == null) bad(`G${cyc} ohne Vorschub`);
      if ((cyc === 83 || cyc === 73) && !(Q > 0)) bad(`G${cyc} ohne Zustellung Q`);
      if (cyc === 82 && P == null) bad('G82 ohne Verweilzeit P');
      if (Z != null && Rw != null && !(Z < Rw)) bad(`G${cyc}: Bohrtiefe Z liegt nicht unter der R-Ebene`);
      if (!st.spindle) bad(`G${cyc} bei stehender Spindel`);
      if (cyc === 74 && st.dir !== 4) bad('G74 (Linksgewinde) mit rechtsdrehender Spindel');
      if (cyc === 84 && st.dir !== 3) bad('G84 (Rechtsgewinde) mit linksdrehender Spindel');
      if (st.comp) bad('Bohrzyklus bei aktiver Radiuskorrektur');
      if (!st.lenComp) bad('Bohrzyklus ohne Werkzeuglängenkorrektur');
      st.cycle = cyc;
      if (X != null) st.pos.X = X; if (Y != null) st.pos.Y = Y;
      st.anyMotion = true;
      return;
    }
    if (!moves) {
      if (I != null || J != null) bad('I/J ohne Achsbewegung');
      return;
    }
    st.anyMotion = true;
    if (!st.abs) { bad('Bewegung im Kettenmaß (G91)'); return; }
    if (st.cycle && (!D.siemens || st.mcall)) { // hole position of the modal cycle
      if (Z != null) bad('Z in einer Bohrposition des Zyklus');
      if (X != null) st.pos.X = X; if (Y != null) st.pos.Y = Y;
      return;
    }
    if (st.motion == null) { bad('Bewegung ohne Wegbedingung (G0/G1)'); return; }
    if (!st.units && dia !== 'okuma') bad('Bewegung vor der Maßeinheit (G21/G71)');
    if (!st.toolLoaded && !st.probe && (X != null || Y != null) && st.anyTool === false && st.motion !== 0) bad('Vorschub vor dem ersten Werkzeugwechsel');
    if (Z != null && !st.toolLoaded && !D.noToolChange) bad('Z-Bewegung in Werkstückkoordinaten vor dem ersten Werkzeugwechsel (keine Längenkorrektur aktiv)');
    if (Z != null && st.toolLoaded && !st.lenComp && !(D.siemens && st.mcall)) { bad(`Z-Bewegung ohne Werkzeuglängenkorrektur (${D.lenComp || 'D-Nummer'}) nach dem Werkzeugwechsel`); st.lenComp = true; }
    if (st.motion !== 0) {
      if (st.feed == null) bad('Vorschubbewegung ohne F');
      if (!st.spindle && !st.probe && !(D.siemens && st.mcall)) bad('Vorschubbewegung bei stehender Spindel');
      if (!st.toolLoaded) bad('Vorschubbewegung vor dem Werkzeugwechsel');
    } else if (st.comp && Z == null && (X != null || Y != null)) { /* rapid with compensation: allowed but unusual */ }
    if (st.motion === 2 || st.motion === 3) {
      if (I == null && J == null && Rw == null) bad('Kreisbogen ohne I/J oder R');
      const P0 = st.pos, ex = X ?? P0.X, ey = Y ?? P0.Y;
      if (Rw == null && P0.X != null && P0.Y != null && ex != null && ey != null) {
        const cx = P0.X + (I || 0), cy = P0.Y + (J || 0), r0 = Math.hypot(I || 0, J || 0), r1 = Math.hypot(ex - cx, ey - cy);
        if (r0 < 0.001) bad('Kreisbogen mit Radius 0');
        else if (Math.abs(r0 - r1) > 0.008) bad(`Kreisendpunkt liegt nicht auf dem Kreis (Radius ${r0.toFixed(3)} → ${r1.toFixed(3)})`);
      }
      if (X == null && Y == null) bad('Kreisbogen ohne Endpunkt in der Ebene');
    } else if (I != null || J != null) bad('I/J in einem Geradensatz');
    if (X != null) st.pos.X = X; if (Y != null) st.pos.Y = Y; if (Z != null) st.pos.Z = Z;
  });
  if (D.percent) {
    if (rows[firstCode ?? 0]?.trim() !== '%') issues.push({ line: 1, text: rows[0], msg: 'Programm beginnt nicht mit %' });
    if (rows[lastCode ?? rows.length - 1]?.trim() !== '%') issues.push({ line: rows.length, text: rows[rows.length - 1], msg: 'Programm endet nicht mit %' });
  }
  if (!st.ended) issues.push({ line: rows.length, text: '', msg: 'Programmende (M30/M2) fehlt' });
  return issues;
}
