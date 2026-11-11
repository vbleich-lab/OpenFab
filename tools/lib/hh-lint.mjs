// Strict checker for Heidenhain Klartext programs written by Toolbahn: the grammar of every block and the
// modal state a TNC keeps (tool, spindle, feed, circle centre, radius compensation, cycle, labels, tilted plane).
// Returns a list of { line, text, msg }.
const NUM = '[+-]?(?:\\d+\\.?\\d*|\\.\\d+)';
const VAL = `(?:${NUM}|Q\\d+)`;
const AXIS = `(?:I?[XYZABC]${VAL})`;
const FEED = `(?:F(?:MAX|AUTO|Q\\d+|${NUM}))`;
const MCODES = '(?:\\s+M\\d+)*';
const re = s => new RegExp('^' + s + '$');
const RE = {
  begin: re('BEGIN PGM (\\S+) (MM|INCH)'), end: re('END PGM (\\S+) (MM|INCH)'),
  blk1: re(`BLK FORM 0\\.1 [XYZ] X${NUM} Y${NUM} Z${NUM}`), blk2: re(`BLK FORM 0\\.2 X${NUM} Y${NUM} Z${NUM}`),
  toolCall: re(`TOOL CALL (\\d+|"[^"]+")(?: [XYZ])?(?: S${NUM})?(?: F${NUM})?(?: DL${NUM})?(?: DR${NUM})?`),
  toolDef: re('TOOL DEF (\\d+|"[^"]+")'),
  line: re(`L((?:\\s+${AXIS})*)(?:\\s+(R0|RL|RR))?(?:\\s+${FEED})?${MCODES}`),
  cc: re(`CC(?:\\s+I?[XYZ]${VAL}){2}`),
  arc: re(`C((?:\\s+${AXIS})+)\\s+DR[+-](?:\\s+(R0|RL|RR))?(?:\\s+${FEED})?${MCODES}`),
  cp: re(`CP(?:\\s+I?PA${VAL})(?:\\s+IZ${VAL}|\\s+Z${VAL})?\\s+DR[+-](?:\\s+(R0|RL|RR))?(?:\\s+${FEED})?${MCODES}`),
  appr: re(`APPR (LT|LN|CT|LCT)((?:\\s+${AXIS})*)(?:\\s+CCA${VAL})?(?:\\s+R${VAL})?(?:\\s+LEN${VAL})?\\s+(RL|RR)(?:\\s+${FEED})?${MCODES}`),
  dep: re(`DEP (LT|LN|CT|LCT)((?:\\s+${AXIS})*)(?:\\s+CCA${VAL})?(?:\\s+R${VAL})?(?:\\s+LEN${VAL})?(?:\\s+${FEED})?${MCODES}`),
  cyclOld: re('CYCL DEF (\\d+)\\.(\\d+)(?: .+)?'), // an empty 32.1 resets the tolerance
  cycl: re('(CYCL DEF|TCH PROBE) (\\d+) [A-Z0-9ÄÖÜ .\\-/]+( ~)?'),
  qline: re(`Q\\d+=${NUM}\\s*;[^~]*?( ~)?`),
  cyclCall: re(`CYCL CALL${MCODES}`),
  fn0: re(`FN 0: Q\\d+ = ?${NUM}(?: ?;.*)?`),
  lbl: re('LBL (\\d+|"[^"]+")'), callLbl: re('CALL LBL (\\d+|"[^"]+")(?: REP\\d+)?'),
  mOnly: re('M\\d+(?:\\s+M\\d+)*'),
  m140: re(`M140 MB (?:MAX|${NUM})(?:\\s+${FEED})?${MCODES}`),
  planeSpatial: re(`PLANE SPATIAL SPA${NUM} SPB${NUM} SPC${NUM} (?:MOVE|TURN|STAY)(?: MB (?:MAX|${NUM}))?(?: (?:DIST|SETUP)${NUM})?(?: ${FEED})?(?: SEQ[+-])?(?: TABLE ROT| COORD ROT)?`),
  planeReset: re(`PLANE RESET (?:MOVE|TURN|STAY)(?: MB (?:MAX|${NUM}))?(?: (?:DIST|SETUP)${NUM})?(?: ${FEED})?`),
  tcpm: re('FUNCTION (?:TCPM F TCP AXIS POS PATHCTRL AXIS|RESET TCPM)'),
  comment: /^;/, stop: re('STOP(?:\\s+M\\d+)*'),
};
const SPINDLE_FREE_CYCLES = new Set([7, 9, 10, 11, 19, 26, 32, 247]); // need no cutting tool / spindle

export function lintHeidenhain(code, opts = {}) {
  const issues = [];
  const rows = code.split('\n');
  const st = { n: null, tool: false, spindle: false, feed: false, cc: false, comp: 'R0', cycle: null, plane: false, tcpm: false, ended: false, inCycl: null, lastQCont: false, zSafeAfterTool: true, pos: {} };
  let begin = null, endName = null, afterEnd = false;
  const labels = new Map(), calls = [];
  // pass 1: block numbers, characters, where the labels are
  const bodies = [], lblAt = new Map();
  rows.forEach((raw, k) => {
    const bad = msg => issues.push({ line: k + 1, text: raw, msg });
    if (raw === '') { bad('Leerzeile im Klartext-Programm'); bodies.push(null); return; }
    if (/[^\x20-\x7e]/.test(raw)) bad('Zeichen außerhalb ASCII');
    const m = raw.match(/^(\d+) (.*)$/);
    let body = raw;
    if (opts.lineNumbers !== false) {
      // the Q lines of a cycle continue its block and carry no number
      if (!m && k > 0 && / ~$/.test(rows[k - 1])) { bodies.push(raw.trim()); return; }
      if (!m) { bad('Satznummer fehlt'); bodies.push(null); return; }
      if (st.n != null && +m[1] !== st.n + 1) bad(`Satznummer ${m[1]} folgt nicht auf ${st.n}`);
      st.n = +m[1];
      body = m[2];
    }
    if (body !== body.trimEnd() || (/ {2,}/.test(body.replace(/^ +/, '')) && !RE.comment.test(body.trim()))) bad('Doppelte oder abschließende Leerzeichen');
    bodies.push(body.trim());
    const l = body.trim().match(RE.lbl);
    if (l && l[1] !== '0') { if (lblAt.has(l[1])) bad(`LBL ${l[1]} doppelt`); lblAt.set(l[1], k); }
  });
  // pass 2: run the program (CALL LBL jumps into the label and returns at LBL 0)
  const visited = new Set(), stack = [];
  let pc = 0, guard = 0;
  const step = k => {
    const raw = rows[k], t = bodies[k];
    const bad = msg => { if (!visited.has(k) || true) issues.push({ line: k + 1, text: raw, msg }); };
    if (t == null) return;
    if (afterEnd) { bad('Satz nach END PGM'); return; }
    // continuation lines of a Q cycle
    if (st.inCycl) {
      if (!RE.qline.test(t)) { bad(`Zyklus ${st.inCycl}: Q-Parameter-Zeile erwartet`); st.inCycl = null; }
      else {
        const q = t.match(/^Q(\d+)=([+-]?[\d.]+)/);
        if (st.q.has(+q[1])) bad(`Zyklus ${st.inCycl}: Q${q[1]} doppelt`);
        st.q.set(+q[1], +q[2]);
        if (!/ ~$/.test(t)) { for (const msg of cycleParams(st.inCycl, st.q, st.probe)) bad(msg); st.inCycl = null; }
        return;
      }
    }
    if (RE.comment.test(t)) return;
    let x;
    if ((x = t.match(RE.begin))) { if (k !== 0) bad('BEGIN PGM nicht im ersten Satz'); begin = x[1]; if (!/^[A-Z0-9_\-]{1,32}$/.test(x[1])) bad('Programmname: nur A–Z, 0–9, _ und -'); return; }
    if (!begin && k === 0) bad('Programm beginnt nicht mit BEGIN PGM');
    if ((x = t.match(RE.end))) { endName = x[1]; afterEnd = true; if (x[1] !== begin) bad('END PGM mit anderem Namen als BEGIN PGM'); return; }
    if (RE.blk1.test(t) || RE.blk2.test(t)) {
      if (st.tool) bad('BLK FORM nach dem ersten Werkzeugaufruf');
      const v = [...t.matchAll(/ ([XYZ])([+-]?[\d.]+)/g)].map(q => +q[2]);
      if (RE.blk1.test(t)) st.blk = v; else if (!st.blk) bad('BLK FORM 0.2 ohne 0.1'); else if (v.some((b, i) => !(b > st.blk[i]))) bad('BLK FORM: MAX-Punkt ist nicht in allen Achsen größer als der MIN-Punkt');
      return;
    }
    if (RE.tcpm.test(t)) { st.tcpm = !/RESET/.test(t); return; }
    if ((x = t.match(RE.toolCall))) {
      if (st.spindle) bad('TOOL CALL bei laufender Spindel (M5 fehlt davor)');
      if (st.comp !== 'R0') bad('TOOL CALL mit aktiver Radiuskorrektur');
      if (st.plane) bad('TOOL CALL in geschwenkter Ebene');
      st.hasS = / S/.test(t); // a touch probe is called without speed and must not get M3
      Object.assign(st, { tool: true, feed: false, cc: false, ccp: null, cycle: null, zSafeAfterTool: false });
      return;
    }
    if (RE.toolDef.test(t)) return;
    if (RE.fn0.test(t)) return;
    if ((x = t.match(RE.lbl))) {
      if (x[1] === '0') {
        if (st.comp !== 'R0') bad('Unterprogramm endet mit aktiver Radiuskorrektur');
        if (stack.length) return { ret: true };
        bad('LBL 0 ohne Aufruf erreicht');
        return;
      }
      // reached in the normal flow (not by a call): the body is skipped up to its LBL 0
      labels.set(x[1], k + 1);
      if (!stack.length) {
        if (!st.ended) bad('Unterprogramm (LBL) vor dem Programmende M30/M2');
        let e = k + 1;
        while (e < rows.length && bodies[e] !== 'LBL 0') e++;
        if (e >= rows.length) { bad(`LBL ${x[1]} ohne LBL 0`); return; }
        return { skipTo: e + 1 };
      }
      return;
    }
    if ((x = t.match(RE.callLbl))) {
      calls.push({ id: x[1], line: k + 1, text: raw });
      if (!lblAt.has(x[1])) return; // reported below
      if (stack.length > 8) { bad('CALL LBL zu tief verschachtelt'); return; }
      labels.set(x[1], lblAt.get(x[1]) + 1);
      return { call: lblAt.get(x[1]) };
    }
    const mcodes = [...t.matchAll(/(?:^|\s)M(\d+)\b/g)].map(q => +q[1]);
    const applyM = () => {
      for (const c of mcodes) {
        if (c === 3 || c === 4 || c === 13 || c === 14) { st.spindle = true; if (!st.hasS) bad('Spindel ein (M3/M4) ohne Drehzahl im TOOL CALL'); }
        if (c === 5 || c === 30 || c === 2 || c === 0) st.spindle = false;
        if (c === 30 || c === 2) { st.ended = true; if (st.comp !== 'R0') bad('Programmende mit aktiver Radiuskorrektur'); if (st.plane) bad('Programmende mit geschwenkter Ebene (PLANE RESET fehlt)'); if (st.tcpm) bad('Programmende mit aktivem TCPM'); }
      }
    };
    if (RE.mOnly.test(t) || RE.stop.test(t)) { applyM(); return; }
    if (RE.m140.test(t)) { applyM(); st.zSafeAfterTool = true; st.pos.Z = null; return; }
    if (RE.planeSpatial.test(t)) { if (st.comp !== 'R0') bad('PLANE bei aktiver Radiuskorrektur'); st.plane = true; return; }
    if (RE.planeReset.test(t)) { st.plane = false; return; }
    if ((x = t.match(RE.cyclOld))) {
      const no = +x[1];
      if (+x[2] === 0) st.oldCycl = { no, next: 1 };
      else if (!st.oldCycl || st.oldCycl.no !== no || st.oldCycl.next !== +x[2]) bad(`CYCL DEF ${x[1]}.${x[2]} außerhalb der Reihenfolge`);
      else st.oldCycl.next++;
      // cycle 19: tilted while any angle is not zero; the empty 19.1 switches the function off
      if (no === 19 && +x[2] === 1) st.plane = [...t.matchAll(/[ABC]([+-]?[\d.]+)/g)].some(q => +q[1] !== 0);
      if (!SPINDLE_FREE_CYCLES.has(no)) st.cycle = no;
      return;
    }
    if ((x = t.match(RE.cycl))) {
      const no = +x[2], probe = x[1] === 'TCH PROBE';
      if (!st.tool) bad('Zyklus vor dem ersten TOOL CALL');
      if (st.comp !== 'R0') bad('Zyklusdefinition bei aktiver Radiuskorrektur');
      if (x[3]) { st.inCycl = no; st.q = new Map(); st.probe = probe; } else if (no >= 200) bad(`Zyklus ${no} ohne Q-Parameter`);
      if (!probe && !SPINDLE_FREE_CYCLES.has(no) && !(no >= 220 && no <= 221)) st.cycle = no;
      if (!probe && (no === 220 || no === 221)) { if (st.cycle == null) bad(`Muster ${no} ohne vorher definierten Bearbeitungszyklus`); if (!st.spindle) bad(`Muster ${no} bei stehender Spindel`); }
      return;
    }
    if (RE.cyclCall.test(t)) { if (st.cycle == null) bad('CYCL CALL ohne definierten Zyklus'); if (!st.spindle) bad('CYCL CALL bei stehender Spindel'); applyM(); return; }
    if ((x = t.match(RE.cc))) {
      if (!st.tool) bad('CC vor TOOL CALL');
      st.cc = true;
      const cx = t.match(/\sX([+-]?[\d.]+)/), cy = t.match(/\sY([+-]?[\d.]+)/);
      st.ccp = cx && cy ? [+cx[1], +cy[1]] : null;
      return;
    }
    const P = st.pos, word = k2 => { const q = t.match(new RegExp(`\\s${k2}([+-]?[\\d.]+)`)); return q ? +q[1] : null; };
    const setXYZ = () => { for (const a of ['X', 'Y', 'Z']) { const v = word(a); if (v != null) P[a] = /\sM9[12]\b/.test(t) ? null : v; } };
    const motion = kind => {
      if (!st.tool) bad('Bewegung vor dem ersten TOOL CALL');
      const fmax = /\sFMAX\b/.test(t), hasF = /\sF(?:Q\d+|AUTO|[+-]?[\d.]+)/.test(t);
      const f0 = t.match(/\sF([+-]?[\d.]+)/);
      if (f0 && !(+f0[1] > 0)) bad('Vorschub F ist nicht größer als 0');
      if (hasF) st.feed = true;
      // spindle: M3 in the same block acts at its start
      const mStart = mcodes.some(c => [3, 4, 13, 14].includes(c));
      const axes = [...t.replace(/^(L|C|CP|APPR \w+|DEP \w+)/, '').matchAll(/\s(I?)([XYZABC])([+-]?[\d.]+)/g)];
      const zOnlyUp = kind === 'L' && axes.length === 1 && axes[0][2] === 'Z';
      if (!fmax) {
        if (!st.feed) bad('Vorschubsatz ohne Vorschub (kein F seit TOOL CALL / LBL)');
        if (!st.spindle && !mStart && !opts.probeTool?.(st)) bad('Vorschubsatz bei stehender Spindel');
      }
      if (!st.zSafeAfterTool) { if (!(zOnlyUp && fmax)) bad('Erste Bewegung nach TOOL CALL ist kein Freifahren in Z mit FMAX'); st.zSafeAfterTool = true; }
      if (kind === 'L' && !axes.length && !mcodes.length) bad('L-Satz ohne Achse und ohne M-Funktion');
      const seen = new Set();
      for (const a of axes) { if (seen.has(a[2])) bad(`Achse ${a[2]} doppelt im Satz`); seen.add(a[2]); }
      if (mcodes.includes(99)) { if (st.cycle == null) bad('M99 ohne definierten Zyklus'); if (!st.spindle && !mStart) bad('M99 bei stehender Spindel'); }
      applyM();
    };
    if ((x = t.match(RE.line))) {
      const rc = x[2];
      if (!rc) bad('L-Satz ohne Radiuskorrektur R0/RL/RR');
      else {
        if (rc !== st.comp && /\sFMAX\b/.test(t) && rc !== 'R0') bad('Radiuskorrektur im Eilgang eingeschaltet');
        if (rc !== st.comp && !/\s[XY][+-]?[\d.]/.test(t)) bad(`Radiuskorrektur wechselt (${st.comp} → ${rc}) ohne Bewegung in der Ebene`);
        st.comp = rc;
      }
      motion('L');
      setXYZ();
      return;
    }
    if ((x = t.match(RE.arc))) {
      if (!st.cc) bad('Kreisbogen C ohne Kreismittelpunkt CC seit TOOL CALL / LBL');
      if (x[2] && x[2] !== st.comp) bad(`Radiuskorrektur wechselt im Kreisbogen (${st.comp} → ${x[2]})`);
      if (/\sFMAX\b/.test(t)) bad('Kreisbogen im Eilgang');
      motion('C');
      {
        const ex = word('X') ?? P.X, ey = word('Y') ?? P.Y;
        if (st.ccp && P.X != null && P.Y != null && ex != null && ey != null) {
          const r0 = Math.hypot(P.X - st.ccp[0], P.Y - st.ccp[1]), r1 = Math.hypot(ex - st.ccp[0], ey - st.ccp[1]);
          if (Math.abs(r0 - r1) > 0.008) bad(`Kreisendpunkt liegt nicht auf dem Kreis (Radius ${r0.toFixed(3)} → ${r1.toFixed(3)})`);
          if (r0 < 0.001) bad('Kreisbogen mit Radius 0');
        }
        if (word('Z') != null && P.Z != null && Math.abs(word('Z') - P.Z) > 1e-6) bad('Kreisbogen C mit Z-Änderung (Schraubenlinie braucht CP)');
      }
      setXYZ();
      return;
    }
    if ((x = t.match(RE.cp))) {
      if (!st.cc) bad('Polarkreis CP ohne Pol CC seit TOOL CALL / LBL');
      if (x[1] && x[1] !== st.comp) bad(`Radiuskorrektur wechselt im Kreisbogen (${st.comp} → ${x[1]})`);
      motion('CP');
      {
        const ipa = t.match(/\sIPA([+-]?[\d.]+)/), iz = t.match(/\sIZ([+-]?[\d.]+)/), dr = t.match(/\sDR([+-])/)[1];
        if (ipa && +ipa[1] !== 0 && (+ipa[1] > 0) !== (dr === '+')) bad('CP: Vorzeichen von IPA passt nicht zur Drehrichtung DR');
        if (ipa && Math.abs(+ipa[1]) > 5400.001) bad('CP: Winkel größer als 5400°');
        if (ipa && st.ccp && P.X != null && P.Y != null) {
          const a = (+ipa[1] * Math.PI) / 180, dx = P.X - st.ccp[0], dy = P.Y - st.ccp[1];
          if (Math.hypot(dx, dy) < 0.001) bad('Polarkreis mit Radius 0');
          P.X = st.ccp[0] + dx * Math.cos(a) - dy * Math.sin(a); P.Y = st.ccp[1] + dx * Math.sin(a) + dy * Math.cos(a);
        } else { P.X = null; P.Y = null; }
        if (iz && P.Z != null) P.Z += +iz[1]; else if (word('Z') != null) P.Z = word('Z');
      }
      return;
    }
    if ((x = t.match(RE.appr))) {
      if (st.comp !== 'R0') bad('APPR bei bereits aktiver Radiuskorrektur');
      const kind = x[1];
      if (!/\s[XY][+-]?[\d.]/.test(t)) bad('APPR ohne Konturpunkt X/Y');
      if ((kind === 'LT' || kind === 'LN') && !/\sLEN/.test(t)) bad(`APPR ${kind} ohne LEN`);
      if (kind === 'CT' && (!/\sCCA/.test(t) || !/\sR[+-]?[\d.]/.test(t))) bad('APPR CT ohne CCA oder R');
      if (kind === 'LCT' && !/\sR[+-]?[\d.]/.test(t)) bad('APPR LCT ohne R');
      st.comp = x[3];
      motion('APPR');
      setXYZ();
      return;
    }
    if ((x = t.match(RE.dep))) {
      if (st.comp === 'R0') bad('DEP ohne aktive Radiuskorrektur');
      const kind = x[1];
      if ((kind === 'LT' || kind === 'LN') && !/\sLEN/.test(t)) bad(`DEP ${kind} ohne LEN`);
      if (kind === 'CT' && (!/\sCCA/.test(t) || !/\sR[+-]?[\d.]/.test(t))) bad('DEP CT ohne CCA oder R');
      if (kind === 'LCT' && (!/\sR[+-]?[\d.]/.test(t) || !/\s[XY][+-]?[\d.]/.test(t))) bad('DEP LCT ohne R oder Endpunkt');
      st.comp = 'R0';
      motion('DEP');
      // the end point is the control's (known only for LCT)
      if (kind === 'LCT') setXYZ(); else { P.X = null; P.Y = null; }
      return;
    }
    bad('Unbekannter oder fehlerhaft aufgebauter Satz');
  };
  const seenIssue = new Set();
  while (pc < rows.length && guard++ < 5e6) {
    const k = pc++;
    const n0 = issues.length;
    const act = step(k);
    // a label body runs once per call: report each finding of a line only once
    for (let i = issues.length - 1; i >= n0; i--) { const key = issues[i].line + '|' + issues[i].msg; if (seenIssue.has(key)) issues.splice(i, 1); else seenIssue.add(key); }
    visited.add(k);
    if (act?.call != null) { stack.push(pc); pc = act.call + 1; }
    else if (act?.ret) pc = stack.pop();
    else if (act?.skipTo != null) pc = act.skipTo;
  }
  if (!begin) issues.push({ line: 1, text: rows[0], msg: 'BEGIN PGM fehlt' });
  if (!endName) issues.push({ line: rows.length, text: rows[rows.length - 1], msg: 'END PGM fehlt' });
  if (!st.ended) issues.push({ line: rows.length, text: '', msg: 'Programmende M30/M2 fehlt' });
  if (st.inCycl) issues.push({ line: rows.length, text: '', msg: 'Zyklus am Programmende nicht abgeschlossen' });
  for (const c of calls) if (!labels.has(c.id)) issues.push({ line: c.line, text: c.text, msg: `CALL LBL ${c.id}: Label fehlt` });
  for (const [id, k] of lblAt) if (!calls.some(c => c.id === id)) issues.push({ line: k + 1, text: rows[k], msg: `LBL ${id} wird nie aufgerufen` });
  return issues;
}

// Value rules of the Q parameters (what a TNC refuses or what makes no sense), per cycle number.
function cycleParams(no, q, probe) {
  const out = [], has = n => q.has(n), v = n => q.get(n);
  const need = (...ns) => { for (const n of ns) if (!has(n)) out.push(`Zyklus ${no}: Q${n} fehlt`); };
  const pos = (...ns) => { for (const n of ns) if (has(n) && !(v(n) > 0)) out.push(`Zyklus ${no}: Q${n} muss größer als 0 sein (${v(n)})`); };
  const nonNeg = (...ns) => { for (const n of ns) if (has(n) && v(n) < 0) out.push(`Zyklus ${no}: Q${n} darf nicht negativ sein (${v(n)})`); };
  if (probe && no === 417) { need(263, 264, 294, 320, 260); nonNeg(320); if (has(260) && has(294) && v(260) <= v(294)) out.push('Zyklus 417: sichere Höhe Q260 liegt nicht über dem Messpunkt Q294'); return out; }
  if (probe) { need(261, 320, 260); nonNeg(320); if (has(260) && has(261) && v(260) <= v(261)) out.push(`Zyklus ${no}: sichere Höhe Q260 liegt nicht über der Messhöhe Q261`); return out; }
  if ([200, 201, 202, 203, 205, 207, 208, 209, 251, 252, 253, 254, 256, 257, 262].includes(no)) {
    need(200, 201, 203, 204);
    if (has(201) && !(v(201) < 0)) out.push(`Zyklus ${no}: Tiefe Q201 muss negativ sein (${v(201)})`);
    nonNeg(200, 204);
  }
  if ([200, 203, 205].includes(no)) { need(202, 206); pos(202, 206); }
  if ([201, 202].includes(no)) { need(206); pos(206, 208); }
  if (no === 207) { need(239); if (has(239) && v(239) === 0) out.push('Zyklus 207: Gewindesteigung Q239 ist 0'); }
  if ([251, 252, 253, 256, 257].includes(no)) {
    need(207, 351, 202, 206); pos(207, 202, 206);
    if (has(351) && Math.abs(v(351)) !== 1) out.push(`Zyklus ${no}: Fräsart Q351 muss +1 oder -1 sein`);
    if (has(370) && !(v(370) >= 0.1 && v(370) <= 1.9999)) out.push(`Zyklus ${no}: Bahnüberlappung Q370 außerhalb 0,1…1,9999 (${v(370)})`);
    if (has(366) && ![0, 1, 2].includes(v(366))) out.push(`Zyklus ${no}: Eintauchart Q366 muss 0, 1 oder 2 sein`);
    if (has(215) && ![0, 1, 2].includes(v(215))) out.push(`Zyklus ${no}: Bearbeitungsumfang Q215 muss 0, 1 oder 2 sein`);
    nonNeg(368, 369, 338);
  }
  if (no === 251 || no === 256) { need(218, 219, 220); pos(218, 219); nonNeg(220); if (has(220) && v(220) > Math.min(v(218), v(219)) / 2 + 1e-6) out.push(`Zyklus ${no}: Eckenradius Q220 größer als die halbe Seitenlänge`); }
  if (no === 253) { need(218, 219); pos(218, 219); if (has(218) && has(219) && v(218) < v(219)) out.push('Zyklus 253: Nutlänge Q218 kleiner als Nutbreite Q219'); }
  if (no === 252) { need(223); pos(223); }
  if (no === 256) { need(424, 425); if (has(424) && v(424) < v(218)) out.push('Zyklus 256: Rohteilmaß Q424 kleiner als das Fertigmaß Q218'); if (has(425) && v(425) < v(219)) out.push('Zyklus 256: Rohteilmaß Q425 kleiner als das Fertigmaß Q219'); }
  if (no === 257) { need(223, 222); pos(223); if (has(222) && v(222) <= v(223)) out.push('Zyklus 257: Rohteil-Ø Q222 ist nicht größer als der Fertigteil-Ø Q223'); }
  if (no === 220) { need(216, 217, 244, 245, 246, 247, 241, 200, 203, 204); pos(244, 241); }
  if (no === 221) { need(225, 226, 237, 238, 242, 243, 224, 200, 203, 204); pos(242, 243); if (has(242) && v(242) > 1 && v(237) === 0) out.push('Zyklus 221: Abstand Q237 ist 0 bei mehreren Spalten'); if (has(243) && v(243) > 1 && v(238) === 0) out.push('Zyklus 221: Abstand Q238 ist 0 bei mehreren Zeilen'); }
  return out;
}

// groups the findings by message: [{ msg, n, first: 'line: text' }]
export function lintSummary(issues) {
  const by = new Map();
  for (const is of issues) { const g = by.get(is.msg) || { msg: is.msg, n: 0, first: `${is.line}: ${is.text}` }; g.n++; by.set(is.msg, g); }
  return [...by.values()];
}
