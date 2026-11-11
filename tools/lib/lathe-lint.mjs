// Strict checker for the lathe programs WerkFab writes (Fanuc, Okuma OSP-L, LinuxCNC): the words of every block
// and the modal state of the control – tool, main spindle, driven tool and C axis, feed, turning and threading
// cycles with their contour blocks, polar interpolation, where the turret indexes.
// lintLathe(code, { dialect: 'fanuc' | 'okuma' | 'linuxcnc', safeX }) -> [{ line, text, msg }]
// safeX: diameter from which a rapid counts as "away from the part" (stock diameter + clearance).
const DIALECTS = {
  fanuc: { decimal: true, percent: true, tool: /^T(\d{4})$/, liveOn: [45], liveOff: [46], liveSpin: [13, 14], end: [30] },
  okuma: { decimal: true, tool: /^T(\d{6})$/, liveOn: [110], liveOff: [109], liveSpin: [13, 14], liveStop: [12], end: [2, 30] },
  linuxcnc: { tool: /^T(\d+)$/, end: [30, 2], m6: true },
};

export function lintLathe(code, opts = {}) {
  const dia = opts.dialect || 'fanuc', D = DIALECTS[dia];
  const issues = [], rows = code.split('\n');
  const st = { tool: null, spindle: false, speed: 0, live: false, liveSpin: false, feed: null, motion: null, polar: false, ended: false, pos: { X: null, Z: null }, away: true, labels: new Map(), refs: [], contour: null, coolant: false, cut: false };
  // block labels (N…) for the cycles
  rows.forEach((raw, k) => { const m = raw.match(/^N(\d+)\b/); if (m) { if (st.labels.has(+m[1])) issues.push({ line: k + 1, text: raw, msg: `Satznummer N${m[1]} doppelt` }); st.labels.set(+m[1], k); } });
  let first = null, last = null;
  rows.forEach((raw, k) => {
    const bad = msg => issues.push({ line: k + 1, text: raw, msg });
    if (/[^\x20-\x7e]/.test(raw)) bad('Zeichen außerhalb ASCII');
    let t = raw.replace(/\([^()]*\)/g, ' ').replace(/;.*$/, '').trim();
    if (/[()]/.test(t)) bad('Klammer ohne Gegenstück');
    if (t === '') return;
    if (first == null) first = k;
    last = k;
    if (t === '%') { if (!D.percent) bad('% ist bei dieser Steuerung nicht üblich'); return; }
    if (st.ended) { bad('Satz nach dem Programmende'); return; }
    if (/^O\d+$/.test(t)) return;
    t = t.replace(/^N\d+\s*/, '');
    if (!t) return;
    // Okuma: speed of the driven tool
    let sb = null;
    t = t.replace(/\bSB=(\d+\.?\d*)/, (_, v) => { sb = +v; return ' '; });
    // LinuxCNC: spindle selector $n
    let sel = 0;
    t = t.replace(/\$(\d)/, (_, v) => { sel = +v; return ' '; });
    const words = [];
    let rest = t.replace(/\s+/g, '');
    while (rest.length) {
      const m = rest.match(/^([A-Z])([+-]?(?:\d+\.?\d*|\.\d+))/);
      if (!m) { bad(`Unlesbares Wort bei „${rest.slice(0, 12)}“`); return; }
      words.push([m[1], m[2]]);
      rest = rest.slice(m[0].length);
    }
    const all = L => words.filter(w => w[0] === L).map(w => w[1]);
    const one = L => { const v = all(L); if (v.length > 1 && !'GMU'.includes(L)) bad(`Wort ${L} doppelt im Satz`); return v.length ? +v[0] : null; };
    const g = all('G').map(Number), m = all('M').map(Number);
    const X = one('X'), Z = one('Z'), C = one('C'), F = one('F'), S = one('S'), P = one('P'), Q = one('Q'), K = one('K');
    const has = c => g.includes(c);
    const tw = words.find(w => w[0] === 'T');
    // which cycle forms are in the block (the same G number means different things per control)
    const fanucRough1 = dia === 'fanuc' && has(71) && P == null && X == null, fanucRough2 = dia === 'fanuc' && has(71) && P != null;
    const fanucFinish = dia === 'fanuc' && has(70), fanucThread = dia === 'fanuc' && has(76);
    const okRough = dia === 'okuma' && has(85), okFinish = dia === 'okuma' && has(87), okThread = dia === 'okuma' && has(71), okLapStart = dia === 'okuma' && has(81), okLapEnd = dia === 'okuma' && has(80);
    const cycleBlock = fanucRough1 || fanucRough2 || fanucFinish || fanucThread || okRough || okFinish || okThread;
    const dwell = has(4), ref = has(28) || has(53) || has(30);
    // decimal point on lengths
    if (D.decimal && !dwell) for (const [L, v] of words) {
      if (!'XZUWIKR'.includes(L) || v.includes('.') || +v === 0) continue;
      if (fanucThread && 'R'.includes(L)) continue;
      bad(`${L}${v} ohne Dezimalpunkt`);
    }
    if (S != null) { if (!(S >= 0)) bad('Drehzahl negativ'); if (!has(50)) st.speed = S; }
    if (F != null && !dwell) { if (!(F > 0)) bad('Vorschub F ist nicht größer als 0'); if (!has(32) && !has(33) && !fanucThread && !okThread) st.feed = F; }

    // ---- tool call ----
    if (tw) {
      const tm = ('T' + tw[1]).match(D.tool);
      if (!tm) bad(`Werkzeugaufruf T${tw[1]} hat nicht die Form der Steuerung`);
      else if (dia === 'fanuc' && tw[1].slice(0, 2) !== tw[1].slice(2)) bad('T-Wort: Werkzeug- und Korrekturnummer verschieden');
      else if (dia === 'okuma' && !(tw[1].slice(0, 2) === tw[1].slice(2, 4) && tw[1].slice(2, 4) === tw[1].slice(4))) bad('T-Wort: Korrektur-, Werkzeug- und Schneidennummer verschieden');
      if (D.m6 && !m.includes(6)) bad('Werkzeugaufruf ohne M6');
      if (D.m6 && !has(43)) bad('Werkzeugaufruf ohne G43');
      if (st.spindle || st.liveSpin) bad('Werkzeugwechsel bei laufender Spindel (M5 fehlt)');
      if (st.live) bad('Werkzeugwechsel bei eingekuppelter C-Achse');
      if (st.polar || st.cyl) bad('Werkzeugwechsel bei aktiver Polar-/Zylinder-Interpolation');
      if (st.coolant) bad('Werkzeugwechsel bei laufendem Kühlmittel (M9 fehlt)');
      if (!st.away) bad('Revolver schaltet am Teil: vor dem Werkzeugwechsel fehlt das Freifahren (Referenzpunkt oder Wechselposition)');
      st.tool = tw[1]; st.feed = null; st.cut = false;
    }

    // ---- M functions ----
    for (const c of m) {
      if (c === 3 || c === 4) {
        if (sel === 1) { st.liveSpin = true; st.live = true; }
        else { if (!(st.speed > 0)) bad('Spindel ein ohne Drehzahl'); if (st.live) bad('Hauptspindel ein bei eingekuppelter C-Achse'); st.spindle = true; }
      }
      if (c === 5) { if (sel === 1) { st.liveSpin = false; st.live = false; } else if (dia === 'fanuc' && st.liveSpin) st.liveSpin = false; else st.spindle = false; if (dia === 'linuxcnc' && sel === 0) st.spindle = false; }
      if (D.liveOn?.includes(c)) { if (st.spindle) bad('C-Achse eingekuppelt bei laufender Hauptspindel'); st.live = true; }
      if (D.liveOff?.includes(c)) { if (st.liveSpin) bad('C-Achse ausgekuppelt bei laufendem angetriebenem Werkzeug'); if (st.polar) bad('C-Achse ausgekuppelt bei aktiver Polar-Interpolation'); st.live = false; }
      if (D.liveSpin?.includes(c)) { if (!st.live) bad('Angetriebenes Werkzeug ein ohne eingekuppelte C-Achse'); if (!(sb > 0) && !(S > 0) && !(st.speed > 0)) bad('Angetriebenes Werkzeug ein ohne Drehzahl'); st.liveSpin = true; }
      if (D.liveStop?.includes(c)) st.liveSpin = false;
      if (c === 8 || c === 7) st.coolant = true;
      if (c === 9) st.coolant = false;
      if (D.end.includes(c)) {
        st.ended = true;
        if (st.spindle || st.liveSpin) bad('Programmende bei laufender Spindel');
        if (st.live) bad('Programmende mit eingekuppelter C-Achse');
        if (st.polar) bad('Programmende mit aktiver Polar-Interpolation');
        if (st.cyl) bad('Programmende mit aktiver Zylinder-Interpolation');
        if (st.coolant) bad('Programmende bei laufendem Kühlmittel');
      }
    }
    // ---- polar interpolation ----
    if (has(12.1) || has(112)) { if (!st.live) bad('Polar-Interpolation ohne eingekuppelte C-Achse'); if (st.posC !== 0) bad('Polar-Interpolation eingeschaltet, ohne dass C auf 0 steht'); st.polar = true; return; }
    if (has(13.1) || has(113)) { st.polar = false; return; }
    // cylindrical interpolation: G7.1 C<radius> on, G7.1 C0 off (the C word is the radius here)
    if (has(7.1) || has(107)) { if (!st.live) bad('Zylinder-Interpolation ohne eingekuppelte C-Achse'); if (C == null) bad('G7.1 ohne Radius C'); st.cyl = C > 0; return; }
    if (has(19) || has(18) || has(17)) { if (X == null && Z == null) return; }
    if (dwell || has(50)) return;
    // reference return of the linear axes (G28 H0 only references C)
    if (ref) { if (words.some(w => 'UWXZ'.includes(w[0]))) { st.away = true; st.pos.X = null; st.pos.Z = null; } return; }

    // ---- cycles ----
    if (fanucRough1) { if (one('U') == null || one('R') == null) bad('G71 (1. Satz) ohne U oder R'); st.g71a = true; return; }
    if (fanucRough2 || fanucFinish) {
      if (fanucRough2 && !st.g71a) bad('G71 P…Q… ohne den Satz G71 U…R… davor');
      st.g71a = false;
      if (P == null || Q == null) { bad('Zyklus ohne P oder Q'); return; }
      if (!st.labels.has(P) || !st.labels.has(Q)) bad(`Zyklus verweist auf N${P}…N${Q}, die es nicht gibt`);
      else {
        const i0 = st.labels.get(P), i1 = st.labels.get(Q);
        if (!(i1 > i0)) bad('Kontur: N(Q) steht nicht hinter N(P)');
        if (fanucRough2 && i0 !== k + 1) bad('Kontur beginnt nicht direkt nach dem G71-Satz');
        if (fanucRough2) {
          if (/Z[+-]?[\d.]/.test(rows[i0].replace(/^N\d+\s*/, ''))) bad('G71 Typ I: erster Kontursatz darf kein Z enthalten');
          if (!/G0?[01]\b/.test(rows[i0])) bad('Erster Kontursatz ohne G0/G1');
          if (F == null) bad('G71 ohne Vorschub F');
          st.roughed = `${P}-${Q}`;
        } else if (st.roughed !== `${P}-${Q}`) bad('G70 ohne Schruppzyklus G71 auf derselben Kontur davor');
      }
      if (!st.spindle) bad('Drehzyklus bei stehender Spindel');
      if (st.pos.X == null || st.pos.Z == null) bad('Drehzyklus ohne definierten Startpunkt');
      st.cut = true; st.away = false;
      return;
    }
    if (okRough || okFinish) {
      const N = one('N') ?? (t.match(/N(\d+)/) ? +t.match(/N(\d+)/)[1] : null);
      const lab = +(raw.match(/G8[57]\s*N(\d+)/) || [])[1];
      if (!Number.isFinite(lab)) { bad('LAP-Zyklus ohne Konturnummer N'); return; }
      const i0 = st.labels.get(lab);
      if (i0 == null || !/G81\b/.test(rows[i0])) bad(`LAP-Kontur N${lab} G81 fehlt`);
      else { let e = i0 + 1; while (e < rows.length && !/^\s*(N\d+\s+)?G80\b/.test(rows[e])) e++; if (e >= rows.length) bad('LAP-Kontur ohne G80'); }
      if (okRough) { if (one('D') == null || !(one('D') > 0)) bad('G85 ohne Schnitttiefe D'); if (F == null) bad('G85 ohne Vorschub F'); st.roughed = String(lab); }
      else if (st.roughed !== String(lab)) bad('G87 ohne Schruppzyklus G85 auf derselben Kontur davor');
      if (!st.spindle) bad('Drehzyklus bei stehender Spindel');
      st.cut = true; st.away = false;
      void N;
      return;
    }
    if (okLapStart) { st.contour = 'lap'; return; }
    if (okLapEnd) { st.contour = null; return; }
    if (fanucThread) {
      if (X == null) { const p6 = (words.find(w => w[0] === 'P') || [])[1]; if (!/^\d{6}$/.test(p6 || '')) bad('G76 (1. Satz): P braucht 6 Stellen'); if (Q == null) bad('G76 (1. Satz) ohne Q'); st.g76a = true; return; }
      if (!st.g76a) bad('G76 X…Z… ohne den ersten G76-Satz');
      st.g76a = false;
      if (Z == null || P == null || Q == null || F == null) bad('G76 (2. Satz) braucht X, Z, P, Q und F');
      if (!st.spindle) bad('Gewindezyklus bei stehender Spindel');
      st.cut = true; st.away = false;
      return;
    }
    if (okThread) {
      if (X == null || Z == null || one('H') == null || one('D') == null || F == null) bad('G71 (Gewindezyklus) braucht X, Z, D, H und F');
      if (!st.spindle) bad('Gewindezyklus bei stehender Spindel');
      st.cut = true; st.away = false;
      return;
    }
    void cycleBlock; void K;

    // ---- motion ----
    for (const c of g) if ([0, 1, 2, 3, 32, 33].includes(c)) st.motion = c;
    if (C != null) {
      if (!st.live) bad('C-Wort ohne eingekuppelte C-Achse');
      if (!st.polar) st.posC = ((C % 360) + 360) % 360 === 0 ? 0 : C;
    }
    if (X == null && Z == null && C == null) return;
    if (st.motion == null) { bad('Bewegung ohne Wegbedingung'); return; }
    const inContour = st.contour === 'lap' || (st.roughed && dia === 'fanuc' && (() => { const [a, b] = st.roughed.split('-').map(Number); return k >= st.labels.get(a) && k <= st.labels.get(b); })());
    if (!inContour) {
      if (st.tool == null) bad('Bewegung vor dem ersten Werkzeugaufruf');
      if (st.polar && st.motion === 0) bad('G0 bei aktiver Polar-Interpolation');
      if (st.cyl && st.motion === 0) bad('G0 bei aktiver Zylinder-Interpolation');
      if (st.motion !== 0) {
        if (st.motion === 32 || st.motion === 33) { if (F == null && K == null && st.thrLead == null) bad('Gewindeschnitt ohne Steigung'); st.thrLead = F ?? K ?? st.thrLead; if (!st.spindle) bad('Gewindeschnitt bei stehender Spindel'); }
        else {
          if (st.feed == null) bad('Vorschubbewegung ohne F seit dem Werkzeugaufruf');
          if (!st.spindle && !st.liveSpin) bad('Vorschubbewegung bei stehender Spindel');
          if (st.live && !st.liveSpin) bad('Vorschub mit C-Achse, aber das angetriebene Werkzeug steht');
        }
        st.cut = true;
      }
      // away from the part: a rapid out to the safe diameter (or beyond the face) is not enough for the turret,
      // only the reference point / tool change position counts (see "ref" above and opts.tcX)
      if (st.motion === 0 && X != null && opts.tcX != null && X >= opts.tcX - 1e-6) st.away = true;
      else st.away = false;
    }
    if (X != null) st.pos.X = X; if (Z != null) st.pos.Z = Z;
  });
  if (D.percent) {
    if (rows[first ?? 0]?.trim() !== '%') issues.push({ line: 1, text: rows[0], msg: 'Programm beginnt nicht mit %' });
    if (rows[last ?? rows.length - 1]?.trim() !== '%') issues.push({ line: rows.length, text: rows[rows.length - 1], msg: 'Programm endet nicht mit %' });
  }
  if (!st.ended) issues.push({ line: rows.length, text: '', msg: 'Programmende (M30/M2) fehlt' });
  return issues;
}
