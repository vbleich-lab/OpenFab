// Post-processors as editable templates.
//
// Every post (built-in or user-made) is a plain definition object: number
// format, comment style, line numbering and text templates for each event
// (program start, tool change, rapid, linear, arcs, drill cycle, ...).
// Template syntax:
//   {X} {Y} {Z} {F} {I} {J}  address words ("X12.5"); X/Y/Z/F only when changed (modal)
//   {X!} {Y!} {Z!}            address word, always written
//   {x} {cx} {safe} ...       bare formatted values (see VARIABLES)
//   lines starting with "#"   become comments in the post's comment format
//   lines starting with spaces are continuation lines (never numbered)
//   a line that is empty after substitution is dropped (literal empty lines are kept)
import { originOf, originLabel, orientationLabel, OP_TYPES, setupMatrix } from './cam.js';

export const VARIABLES = {
  'Programm': { project: 'Projektname', setup: 'Setup-Name', orientation: 'Ausrichtung des Setups', pgm: 'Programmname (Großbuchstaben, ohne Sonderzeichen)', prognum: 'Programmnummer', wcs: 'WKS-Versatz (G54 … G59)', wcsh: 'WKS-Nummer (Okuma G15 H…)', comment: 'Programmkommentar aus dem Setup', date: 'Datum/Uhrzeit', origin: 'Nullpunkt', machine: 'Maschine' },
  'Rohteil': { stockx: 'Länge X', stocky: 'Breite Y', stockz: 'Höhe Z', sminx: 'min X', sminy: 'min Y', sminz: 'min Z', smaxx: 'max X', smaxy: 'max Y', smaxz: 'max Z', safe: 'Sicherheitshöhe Z' },
  'Drehen': { safex: 'Rückzug X (Durchmesser)', safez: 'Rückzug Z', tt: 'Werkzeug+Korrektur (z. B. 0101)', tt6: 'Okuma: Korrektur+Werkzeug+Schneide (z. B. 010101)', maxrpm: 'Drehzahlbegrenzung G50 S (Maschine)', pitch: 'Gewindesteigung' },
  'Werkzeug': { t: 'Nummer', toolname: 'Bezeichnung', tooldia: 'Durchmesser', rpm: 'Drehzahl', coolanton: 'Kühlmittel-ein-Vorlage (wenn aktiv)', coolantoff: 'Kühlmittel-aus-Vorlage (wenn aktiv)' },
  'Operation': { opname: 'Name', optype: 'Strategie' },
  'Bewegung': { x: 'X-Wert', y: 'Y-Wert', z: 'Z-Wert', f: 'Vorschub', cx: 'Kreismittelpunkt X (absolut)', cy: 'Kreismittelpunkt Y (absolut)', i: 'I (relativ)', j: 'J (relativ)', ipa: 'Schraubenlinie: Winkel inkremental (°, + = gegen Uhrzeigersinn)', iz: 'Schraubenlinie: Z inkremental' },
  'Bohrzyklus': {
    ztop: 'Oberfläche Z', zbottom: 'Bohrgrund Z', rplane: 'Rückzugsebene R (Z)', depth: 'Tiefe (negativ)', peck: 'Zustelltiefe', zfirst: 'erste Bohrtiefe Z',
    dwell: 'Verweilzeit s', dwellms: 'Verweilzeit ms', pitch: 'Steigung', pitchsigned: 'Steigung (negativ = links)', f: 'Vorschub', dfeed: 'Vorschub',
    sdis: 'Sicherheitsabstand', q200: 'Sicherheitsabstand', q204: '2. Sicherheitsabstand', vari: '1 = Rückzug, 0 = Spanbruch',
  },
};

export const SECTIONS = [
  ['header', 'Programmanfang'], ['footer', 'Programmende'],
  ['opStart', 'Operationsbeginn'], ['toolChangeFirst', 'Erster Werkzeugaufruf'], ['toolChange', 'Werkzeugwechsel'],
  ['spindleOn', 'Spindel ein / Drehzahl'], ['coolantOn', 'Kühlmittel ein'], ['coolantOff', 'Kühlmittel aus'],
  ['rapid', 'Eilgang'], ['linear', 'Linear'], ['arcCW', 'Kreisbogen im Uhrzeigersinn'], ['arcCCW', 'Kreisbogen gegen Uhrzeigersinn'],
  ['helixCW', 'Schraubenlinie im Uhrzeigersinn (leer = Kreisbogen mit Z)'], ['helixCCW', 'Schraubenlinie gegen Uhrzeigersinn (leer = Kreisbogen mit Z)'],
  ['cyclePocketRect', 'Zyklus Rechtecktasche'], ['cyclePocketCirc', 'Zyklus Kreistasche'], ['cyclePocketSlot', 'Zyklus Nut / Langloch (leer = Rechtecktasche)'],
  ['cycleStudRect', 'Zyklus Rechteckzapfen'], ['cycleStudCirc', 'Zyklus Kreiszapfen'],
  ['approach', 'Anfahren an die Kontur (Radiuskorrektur an der Steuerung)'], ['depart', 'Abfahren von der Kontur'],
  ['dwell', 'Verweilzeit'],
  ['cycleDrill', 'Zyklus Bohren'], ['cycleDwell', 'Zyklus Bohren mit Verweilzeit'], ['cyclePeck', 'Zyklus Tieflochbohren'], ['cycleChip', 'Zyklus Spanbruch'],
  ['cycleTap', 'Zyklus Gewindebohren rechts'], ['cycleTapLeft', 'Zyklus Gewindebohren links'], ['cycleReam', 'Zyklus Reiben'], ['cycleBore', 'Zyklus Ausdrehen'],
  ['cyclePoint', 'Zyklus: weitere Bohrposition'], ['cyclePatternCircle', 'Bohrbild Lochkreis (statt einzelner Positionen)'], ['cyclePatternGrid', 'Bohrbild Raster / Lochreihe'], ['cycleEnd', 'Zyklus beenden'],
  ['threadMove', 'Drehen: Gewindeschnitt'],
  ['cycleTurnRough', 'Drehen: Schruppzyklus ({contour} = Konturzeilen)'], ['cycleTurnFinish', 'Drehen: Schlichtzyklus (Kontur des Schruppzyklus)'], ['contourFirst', 'Drehen: Vorsatz erste Konturzeile'], ['contourLast', 'Drehen: Vorsatz letzte Konturzeile'],
  ['cycleTurnThread', 'Drehen: Gewindezyklus'],
  ['probeZ', 'Antasten: Z-Fläche'], ['probeBore', 'Antasten: Bohrung'], ['probeBoss', 'Antasten: Zapfen'], ['probeRectOut', 'Antasten: Rechteck außen'], ['probeRectIn', 'Antasten: Rechtecktasche innen'],
];
export const CYCLE_KEYS = { drill: 'cycleDrill', dwell: 'cycleDwell', peck: 'cyclePeck', chip: 'cycleChip', tap: 'cycleTap', tapLeft: 'cycleTapLeft', ream: 'cycleReam', bore: 'cycleBore' };

const GCODE_MOTION = {
  rapid: 'G0{X}{Y}{Z}', linear: 'G1{X}{Y}{Z}{F}', arcCW: 'G2{X!}{Y!}{Z}{I}{J}{F}', arcCCW: 'G3{X!}{Y!}{Z}{I}{J}{F}',
};
const GCODE_BASE = {
  decimals: 3, trimZeros: true, signed: false, modalCodes: true, feedAfterRapid: false, separator: ' ',
  comment: '({text})', asciiComments: true, arcs: true, useDrillCycle: false,
  lineNumbers: { enabled: false, start: 10, step: 10, prefix: 'N', comments: false },
  opStart: '\n# {opname} - {optype}', spindleOn: 'S{rpm} M3', coolantOn: 'M8', coolantOff: 'M9',
  dwell: 'G4 P{dwell}', cycleFirstInDef: true, cyclePoint: '{X}{Y}', cycleEnd: 'G80', ...GCODE_MOTION,
};
// ISO canned cycles (Fanuc style); the first hole is part of the cycle block
const G8X = {
  useDrillCycle: true,
  cycleDrill: 'G98 G81{X!}{Y!} Z{zbottom} R{rplane} F{f}',
  cycleDwell: 'G98 G82{X!}{Y!} Z{zbottom} R{rplane} P{dwellms} F{f}',
  cyclePeck: 'G98 G83{X!}{Y!} Z{zbottom} R{rplane} Q{peck} F{f}',
  cycleChip: 'G98 G73{X!}{Y!} Z{zbottom} R{rplane} Q{peck} F{f}',
  cycleTap: 'G98 G84{X!}{Y!} Z{zbottom} R{rplane} F{f}',
  cycleTapLeft: 'G98 G74{X!}{Y!} Z{zbottom} R{rplane} F{f}',
  cycleReam: 'G98 G85{X!}{Y!} Z{zbottom} R{rplane} F{f}',
  cycleBore: 'G98 G86{X!}{Y!} Z{zbottom} R{rplane} F{f}',
};
const HEADER_INFO = '# OpenFab - {project}\n# Erstellt {date}\n# Rohteil X{stockx} Y{stocky} Z{stockz}\n# {setup}: {orientation}, Nullpunkt {origin}{comment}';

const CYCL200 = 'CYCL DEF 200 BOHREN ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q201={depth} ;TIEFE ~\n  Q206={dfeed} ;VORSCHUB TIEFENZ. ~\n  Q202={peck} ;ZUSTELL-TIEFE ~\n  Q210=+0 ;VERWEILZEIT OBEN ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST. ~\n  Q211={dwell} ;VERWEILZEIT UNTEN';
const CYCL207 = 'CYCL DEF 207 GEWINDEBOHREN GS ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q201={depth} ;TIEFE GEWINDE ~\n  Q239={pitchsigned} ;GEWINDESTEIGUNG ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST.';

export const BUILTIN_POSTS = [
  {
    ...GCODE_BASE, family: 'grbl', id: 'grbl', name: 'GRBL (Hobby-CNC)', ext: 'nc', builtin: true,
    header: `${HEADER_INFO}\nG90 G94 G17\nG21\nG0 Z{safe}`,
    toolChangeFirst: '# T{t} {toolname} D{tooldia}',
    toolChange: 'M5\n# T{t} {toolname} D{tooldia}\nG0 Z{safe}\n# WERKZEUG WECHSELN, dann fortsetzen\nM0',
    footer: '\nG0 Z{safe}\n{coolantoff}\nM5\nM30',
  },
  {
    ...GCODE_BASE, ...G8X, family: 'linuxcnc', id: 'linuxcnc', name: 'LinuxCNC', ext: 'ngc', builtin: true,
    // LinuxCNC has no G84/G74 (rigid tapping is G33.1) -> tapping is written out
    cycleTap: '', cycleTapLeft: '',
    header: `${HEADER_INFO}\nG90 G94 G17\nG21\nG54\nG0 Z{safe}`,
    toolChangeFirst: '# T{t} {toolname} D{tooldia}\nT{t} M6\nG43 H{t}',
    toolChange: 'M5\n# T{t} {toolname} D{tooldia}\nT{t} M6\nG43 H{t}',
    footer: '\nG0 Z{safe}\n{coolantoff}\nM5\nM30',
  },
  {
    ...GCODE_BASE, ...G8X, family: 'fanuc', id: 'fanuc', name: 'Fanuc / ISO generisch', ext: 'nc', builtin: true, dwell: 'G4 X{dwell}', decimalPoint: true,
    // Renishaw Inspection Plus macros (protected move P9810, then the measuring cycle)
    probeZ: 'G0 X{cx} Y{cy}\nG0 Z{zsafe}\nG65 P9810 Z{zabove} F{pfeed}\nG65 P9811 Z{z} S{wcsn}\nG65 P9810 Z{zsafe} F{pfeed}',
    probeBore: 'G0 X{cx} Y{cy}\nG0 Z{zsafe}\nG65 P9810 Z{zmeas} F{pfeed}\nG65 P9814 D{dia} S{wcsn}\nG65 P9810 Z{zsafe} F{pfeed}',
    probeBoss: 'G0 X{cx} Y{cy}\nG0 Z{zsafe}\nG65 P9810 Z{zabove} F{pfeed}\nG65 P9814 D{dia} Z{zmeas} S{wcsn}\nG65 P9810 Z{zsafe} F{pfeed}',
    probeRectOut: 'G0 X{cx} Y{cy}\nG0 Z{zsafe}\nG65 P9810 Z{zabove} F{pfeed}\nG65 P9812 X{w} Z{zmeas} S{wcsn}\nG65 P9812 Y{l} Z{zmeas} S{wcsn}\nG65 P9810 Z{zsafe} F{pfeed}',
    probeRectIn: 'G0 X{cx} Y{cy}\nG0 Z{zsafe}\nG65 P9810 Z{zmeas} F{pfeed}\nG65 P9812 X{w} S{wcsn}\nG65 P9812 Y{l} S{wcsn}\nG65 P9810 Z{zsafe} F{pfeed}',
    header: `%\nO1000\n${HEADER_INFO}\nG90 G94 G17\nG21\nG54\nG0 Z{safe}`,
    toolChangeFirst: '# T{t} {toolname} D{tooldia}\nT{t} M6',
    toolChange: 'M5\n# T{t} {toolname} D{tooldia}\nT{t} M6',
    footer: '\nG0 Z{safe}\n{coolantoff}\nM5\nM30\n%',
  },
  {
    // Okuma OSP-M (machining centres): work offset G15 H…, tool length G56 H…, fixed cycles G81–G86 with R point,
    // decimal point always, program end M02
    ...GCODE_BASE, ...G8X, family: 'fanuc', id: 'okuma-mill', name: 'Okuma OSP-M Fräsen', ext: 'min', builtin: true, decimalPoint: true,
    dwell: 'G4 F{dwell}',
    cycleDrill: 'G81{X!}{Y!} Z{zbottom} R{rplane} F{f}', cycleDwell: '',
    cyclePeck: 'G83{X!}{Y!} Z{zbottom} R{rplane} Q{peck} F{f}', cycleChip: 'G73{X!}{Y!} Z{zbottom} R{rplane} Q{peck} F{f}',
    cycleTap: 'G84{X!}{Y!} Z{zbottom} R{rplane} F{f}', cycleTapLeft: 'G74{X!}{Y!} Z{zbottom} R{rplane} F{f}',
    cycleReam: 'G85{X!}{Y!} Z{zbottom} R{rplane} F{f}', cycleBore: 'G86{X!}{Y!} Z{zbottom} R{rplane} F{f}',
    header: `O{prognum}\n${HEADER_INFO}\nG15 H{wcsh}\nG17 G40 G80 G90 G94\nG0 Z{safe}`,
    toolChangeFirst: '# T{t} {toolname} D{tooldia}\nT{t} M6\nG56 H{t}',
    toolChange: 'M5\n# T{t} {toolname} D{tooldia}\nT{t} M6\nG56 H{t}',
    footer: '\nG0 Z{safe}\n{coolantoff}\nM5\nM2',
  },
  {
    ...GCODE_BASE, family: 'sinumerik', id: 'sinumerik', name: 'Siemens Sinumerik 840D', ext: 'mpf', builtin: true, comment: '; {text}',
    // modal cycle call: MCALL CYCLE8x(...), then one positioning block per hole, MCALL ends it
    useDrillCycle: true, cycleFirstInDef: false, cyclePoint: 'G0{X!}{Y!}', cycleEnd: 'MCALL', dwell: 'G4 F{dwell}',
    cycleDrill: 'MCALL CYCLE81({safe},{ztop},{sdis},{zbottom})',
    cycleDwell: 'MCALL CYCLE82({safe},{ztop},{sdis},{zbottom},,{dwell})',
    cyclePeck: 'MCALL CYCLE83({safe},{ztop},{sdis},{zbottom},,{zfirst},,{peck},0,0,1,1)',
    cycleChip: 'MCALL CYCLE83({safe},{ztop},{sdis},{zbottom},,{zfirst},,{peck},0,0,1,0)',
    cycleTap: 'MCALL CYCLE84({safe},{ztop},{sdis},{zbottom},,0,3,,{pitch},0,{rpm},{rpm})',
    cycleTapLeft: 'MCALL CYCLE84({safe},{ztop},{sdis},{zbottom},,0,4,,{pitchsigned},0,{rpm},{rpm})',
    cycleReam: 'MCALL CYCLE85({safe},{ztop},{sdis},{zbottom},,0,{f},{f})',
    cycleBore: '',
    // pockets as standard cycles (operation option "Steuerungszyklus"); the call carries the centre
    cyclePocketRect: 'POCKET3({safe},{ztop},{sdis},{zbottom},{plen1},{plen2},{pcrs},{px},{py},{pangs},{stepdown},{stl},0,{pfeed},{dfeed},{cdir},{vari},{mida},0,0,0,{rad1},{dp1})',
    cyclePatternCircle: 'HOLES2({pcx},{pcy},{prad},{pa0},{pastep},{pn})',
    cyclePatternGrid: 'CYCLE801({gx},{gy},{gang},{gd1},{gd2},{gnc},{gnr})',
    cycleStudRect: 'CYCLE76({safe},{ztop},{sdis},{zbottom},,{plen1},{plen2},{pcr},{px},{py},{pangs},{stepdown},{stl},0,{pfeed},{dfeed},{cdir},1,{blank1},{blank2})',
    cycleStudCirc: 'CYCLE77({safe},{ztop},{sdis},{zbottom},,{prad},{px},{py},{stepdown},{stl},0,{pfeed},{dfeed},{cdir},1,{pblank})',
    cyclePocketCirc: 'POCKET4({safe},{ztop},{sdis},{zbottom},{prad},{px},{py},{stepdown},{stl},0,{pfeed},{dfeed},{cdir},{vari},{mida},0,0,{rad1},{dp1})',
    header: `${HEADER_INFO}\nG17 G90 G94 G71\nG54\nG0 Z{safe}`,
    toolChangeFirst: '# T{t} {toolname} D{tooldia}\nT{t} D1\nM6',
    toolChange: 'M5\n# T{t} {toolname} D{tooldia}\nT{t} D1\nM6',
    footer: '\nG0 Z{safe}\n{coolantoff}\nM5\nM30',
  },
  {
    family: 'heidenhain', id: 'heidenhain', name: 'Heidenhain iTNC 530 (Klartext)', ext: 'h', builtin: true,
    probeZ: 'TCH PROBE 417 BZPKT TS.-ACHSE ~\n  Q263={cx} ;1. PUNKT 1. ACHSE ~\n  Q264={cy} ;1. PUNKT 2. ACHSE ~\n  Q294={z} ;1. PUNKT 3. ACHSE ~\n  Q320={sdist} ;SICHERHEITS-ABST. ~\n  Q260={zsafe} ;SICHERE HOEHE ~\n  Q305={preset} ;NR. IN TABELLE ~\n  Q333={z} ;BEZUGSPUNKT ~\n  Q303={transfer} ;MESSWERT-UEBERGABE',
    probeBore: 'TCH PROBE 412 BZPKT KREIS INNEN ~\n  Q321={cx} ;MITTE 1. ACHSE ~\n  Q322={cy} ;MITTE 2. ACHSE ~\n  Q262={dia} ;SOLL-DURCHMESSER ~\n  Q325=+0 ;STARTWINKEL ~\n  Q247=+90 ;WINKELSCHRITT ~\n  Q261={zmeas} ;MESSHOEHE ~\n  Q320={sdist} ;SICHERHEITS-ABST. ~\n  Q260={zsafe} ;SICHERE HOEHE ~\n  Q301=+1 ;FAHREN AUF S. HOEHE ~\n  Q305={preset} ;NR. IN TABELLE ~\n  Q331={cx} ;BEZUGSPUNKT ~\n  Q332={cy} ;BEZUGSPUNKT ~\n  Q303={transfer} ;MESSWERT-UEBERGABE ~\n  Q381=+0 ;ANTASTEN TS-ACHSE ~\n  Q382=+0 ;1. KO. FUER TS-ACHSE ~\n  Q383=+0 ;2. KO. FUER TS-ACHSE ~\n  Q384=+0 ;3. KO. FUER TS-ACHSE ~\n  Q333=+0 ;BEZUGSPUNKT ~\n  Q423=+4 ;ANZAHL MESSPUNKTE ~\n  Q365=+1 ;VERFAHRART',
    probeBoss: 'TCH PROBE 413 BZPKT KREIS AUSSEN ~\n  Q321={cx} ;MITTE 1. ACHSE ~\n  Q322={cy} ;MITTE 2. ACHSE ~\n  Q262={dia} ;SOLL-DURCHMESSER ~\n  Q325=+0 ;STARTWINKEL ~\n  Q247=+90 ;WINKELSCHRITT ~\n  Q261={zmeas} ;MESSHOEHE ~\n  Q320={sdist} ;SICHERHEITS-ABST. ~\n  Q260={zsafe} ;SICHERE HOEHE ~\n  Q301=+1 ;FAHREN AUF S. HOEHE ~\n  Q305={preset} ;NR. IN TABELLE ~\n  Q331={cx} ;BEZUGSPUNKT ~\n  Q332={cy} ;BEZUGSPUNKT ~\n  Q303={transfer} ;MESSWERT-UEBERGABE ~\n  Q381=+0 ;ANTASTEN TS-ACHSE ~\n  Q382=+0 ;1. KO. FUER TS-ACHSE ~\n  Q383=+0 ;2. KO. FUER TS-ACHSE ~\n  Q384=+0 ;3. KO. FUER TS-ACHSE ~\n  Q333=+0 ;BEZUGSPUNKT ~\n  Q423=+4 ;ANZAHL MESSPUNKTE ~\n  Q365=+1 ;VERFAHRART',
    probeRectOut: 'TCH PROBE 411 BZPKT RECHT. AUS. ~\n  Q321={cx} ;MITTE 1. ACHSE ~\n  Q322={cy} ;MITTE 2. ACHSE ~\n  Q323={w} ;1. SEITEN-LAENGE ~\n  Q324={l} ;2. SEITEN-LAENGE ~\n  Q261={zmeas} ;MESSHOEHE ~\n  Q320={sdist} ;SICHERHEITS-ABST. ~\n  Q260={zsafe} ;SICHERE HOEHE ~\n  Q301=+1 ;FAHREN AUF S. HOEHE ~\n  Q305={preset} ;NR. IN TABELLE ~\n  Q331={cx} ;BEZUGSPUNKT ~\n  Q332={cy} ;BEZUGSPUNKT ~\n  Q303={transfer} ;MESSWERT-UEBERGABE ~\n  Q381=+0 ;ANTASTEN TS-ACHSE ~\n  Q382=+0 ;1. KO. FUER TS-ACHSE ~\n  Q383=+0 ;2. KO. FUER TS-ACHSE ~\n  Q384=+0 ;3. KO. FUER TS-ACHSE ~\n  Q333=+0 ;BEZUGSPUNKT',
    probeRectIn: 'TCH PROBE 410 BZPKT RECHT. INNEN ~\n  Q321={cx} ;MITTE 1. ACHSE ~\n  Q322={cy} ;MITTE 2. ACHSE ~\n  Q323={w} ;1. SEITEN-LAENGE ~\n  Q324={l} ;2. SEITEN-LAENGE ~\n  Q261={zmeas} ;MESSHOEHE ~\n  Q320={sdist} ;SICHERHEITS-ABST. ~\n  Q260={zsafe} ;SICHERE HOEHE ~\n  Q301=+1 ;FAHREN AUF S. HOEHE ~\n  Q305={preset} ;NR. IN TABELLE ~\n  Q331={cx} ;BEZUGSPUNKT ~\n  Q332={cy} ;BEZUGSPUNKT ~\n  Q303={transfer} ;MESSWERT-UEBERGABE ~\n  Q381=+0 ;ANTASTEN TS-ACHSE ~\n  Q382=+0 ;1. KO. FUER TS-ACHSE ~\n  Q383=+0 ;2. KO. FUER TS-ACHSE ~\n  Q384=+0 ;3. KO. FUER TS-ACHSE ~\n  Q333=+0 ;BEZUGSPUNKT',
    decimals: 3, trimZeros: false, signed: true, modalCodes: false, feedAfterRapid: true, separator: ' ',
    comment: '; {text}', asciiComments: true, arcs: true, useDrillCycle: true, resetModalPerOp: true, coolantPerOp: false,
    lineNumbers: { enabled: true, start: 0, step: 1, prefix: '', comments: true },
    header: 'BEGIN PGM {pgm} MM\nBLK FORM 0.1 Z X{sminx} Y{sminy} Z{sminz}\nBLK FORM 0.2 X{smaxx} Y{smaxy} Z{smaxz}\n# OpenFab - {project}\n# {setup}: {orientation}, Nullpunkt {origin}{comment}',
    opStart: '# {opname} - {optype}',
    toolChangeFirst: '# T{t} {toolname} D{tooldia}\nTOOL CALL {t} Z S{rpm}\nL Z{safe} R0 FMAX M3',
    toolChange: 'L Z{safe} R0 FMAX M5\n# T{t} {toolname} D{tooldia}\nTOOL CALL {t} Z S{rpm}\nL Z{safe} R0 FMAX M3',
    spindleOn: '', coolantOn: 'M8', coolantOff: 'M9',
    rapid: 'L{X}{Y}{Z} R0 FMAX', linear: 'L{X}{Y}{Z} R0{F}',
    dwell: 'CYCL DEF 9.0 VERWEILZEIT\nCYCL DEF 9.1 V.ZEIT {dwell}',
    cycleFirstInDef: false, cyclePoint: 'L{X!}{Y!} R0 FMAX M99', cycleEnd: '',
    arcCW: 'CC X{cx} Y{cy}\nC{X!}{Y!} DR- R0{F}', arcCCW: 'CC X{cx} Y{cy}\nC{X!}{Y!} DR+ R0{F}',
    // helix (Z changes along the arc): polar arc, incremental angle and Z
    helixCW: 'CC X{cx} Y{cy}\nCP IPA{ipa} IZ{iz} DR- R0{F}', helixCCW: 'CC X{cx} Y{cy}\nCP IPA{ipa} IZ{iz} DR+ R0{F}',
    // contour with compensation at the control: the control's own approach / departure (LN, LT, CT, LCT)
    approach: 'APPR {appr} {rc}{F}', depart: 'DEP {dep}{F}',
    // pockets as the control's cycles (operation option "Steuerungszyklus"), called at the centre with M99
    cyclePocketRect: 'CYCL DEF 251 RECHTECKTASCHE ~\n  Q215=1 ;BEARBEITUNGS-UMFANG ~\n  Q218={plen1} ;1. SEITEN-LAENGE ~\n  Q219={plen2} ;2. SEITEN-LAENGE ~\n  Q220={pcr} ;ECKENRADIUS ~\n  Q368={stl} ;AUFMASS SEITE ~\n  Q224={pang} ;DREHLAGE ~\n  Q367=+0 ;TASCHENLAGE ~\n  Q207={pfeed} ;VORSCHUB FRAESEN ~\n  Q351={climb} ;FRAESART ~\n  Q201={depth} ;TIEFE ~\n  Q202={stepdown} ;ZUSTELL-TIEFE ~\n  Q369=+0 ;AUFMASS TIEFE ~\n  Q206={dfeed} ;VORSCHUB TIEFENZ. ~\n  Q338=+0 ;ZUST. SCHLICHTEN ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST. ~\n  Q370={overlap} ;BAHN-UEBERLAPPUNG ~\n  Q366={plungemode} ;EINTAUCHEN ~\n  Q385={pfeed} ;VORSCHUB SCHLICHTEN',
    cyclePatternCircle: 'CYCL DEF 220 MUSTER KREIS ~\n  Q216={pcx} ;MITTE 1. ACHSE ~\n  Q217={pcy} ;MITTE 2. ACHSE ~\n  Q244={pdia} ;TEILKREIS-DURCHM. ~\n  Q245={pa0} ;STARTWINKEL ~\n  Q246={pa1} ;ENDWINKEL ~\n  Q247=+0 ;WINKELSCHRITT ~\n  Q241={pn} ;ANZAHL BEARBEITUNGEN ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST. ~\n  Q301=1 ;FAHREN AUF S. HOEHE ~\n  Q365=0 ;VERFAHRART',
    cyclePatternGrid: 'CYCL DEF 221 MUSTER LINIEN ~\n  Q225={gx} ;STARTPUNKT 1. ACHSE ~\n  Q226={gy} ;STARTPUNKT 2. ACHSE ~\n  Q237={gd1} ;ABSTAND 1. ACHSE ~\n  Q238={gd2} ;ABSTAND 2. ACHSE ~\n  Q242={gnc} ;ANZAHL SPALTEN ~\n  Q243={gnr} ;ANZAHL ZEILEN ~\n  Q224={gang} ;DREHLAGE ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST. ~\n  Q301=1 ;FAHREN AUF S. HOEHE',
    cyclePocketSlot: 'CYCL DEF 253 NUTENFRAESEN ~\n  Q215=1 ;BEARBEITUNGS-UMFANG ~\n  Q218={plen1} ;NUTLAENGE ~\n  Q219={plen2} ;NUTBREITE ~\n  Q368={stl} ;AUFMASS SEITE ~\n  Q374={pang} ;DREHLAGE ~\n  Q367=+0 ;NUTLAGE ~\n  Q207={pfeed} ;VORSCHUB FRAESEN ~\n  Q351={climb} ;FRAESART ~\n  Q201={depth} ;TIEFE ~\n  Q202={stepdown} ;ZUSTELL-TIEFE ~\n  Q369=+0 ;AUFMASS TIEFE ~\n  Q206={dfeed} ;VORSCHUB TIEFENZ. ~\n  Q338=+0 ;ZUST. SCHLICHTEN ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST. ~\n  Q366={slotplunge} ;EINTAUCHEN ~\n  Q385={pfeed} ;VORSCHUB SCHLICHTEN',
    cycleStudRect: 'CYCL DEF 256 RECHTECKZAPFEN ~\n  Q218={plen1} ;1. SEITEN-LAENGE ~\n  Q424={blank1} ;ROHTEILMASS 1 ~\n  Q219={plen2} ;2. SEITEN-LAENGE ~\n  Q425={blank2} ;ROHTEILMASS 2 ~\n  Q220={pcr} ;ECKENRADIUS ~\n  Q368={stl} ;AUFMASS SEITE ~\n  Q224={pang} ;DREHLAGE ~\n  Q367=+0 ;ZAPFENLAGE ~\n  Q207={pfeed} ;VORSCHUB FRAESEN ~\n  Q351={climb} ;FRAESART ~\n  Q201={depth} ;TIEFE ~\n  Q202={stepdown} ;ZUSTELL-TIEFE ~\n  Q206={dfeed} ;VORSCHUB TIEFENZ. ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST. ~\n  Q370={overlap} ;BAHN-UEBERLAPPUNG',
    cycleStudCirc: 'CYCL DEF 257 KREISZAPFEN ~\n  Q223={pdia} ;FERTIGTEIL-DURCHM. ~\n  Q222={pblank} ;ROHTEIL-DURCHMESSER ~\n  Q368={stl} ;AUFMASS SEITE ~\n  Q207={pfeed} ;VORSCHUB FRAESEN ~\n  Q351={climb} ;FRAESART ~\n  Q201={depth} ;TIEFE ~\n  Q202={stepdown} ;ZUSTELL-TIEFE ~\n  Q206={dfeed} ;VORSCHUB TIEFENZ. ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST. ~\n  Q370={overlap} ;BAHN-UEBERLAPPUNG',
    cyclePocketCirc: 'CYCL DEF 252 KREISTASCHE ~\n  Q215=1 ;BEARBEITUNGS-UMFANG ~\n  Q223={pdia} ;KREISDURCHMESSER ~\n  Q368={stl} ;AUFMASS SEITE ~\n  Q207={pfeed} ;VORSCHUB FRAESEN ~\n  Q351={climb} ;FRAESART ~\n  Q201={depth} ;TIEFE ~\n  Q202={stepdown} ;ZUSTELL-TIEFE ~\n  Q369=+0 ;AUFMASS TIEFE ~\n  Q206={dfeed} ;VORSCHUB TIEFENZ. ~\n  Q338=+0 ;ZUST. SCHLICHTEN ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST. ~\n  Q370={overlap} ;BAHN-UEBERLAPPUNG ~\n  Q366={plungemode} ;EINTAUCHEN ~\n  Q385={pfeed} ;VORSCHUB SCHLICHTEN',
    cycleDrill: CYCL200, cycleDwell: CYCL200, cyclePeck: CYCL200,
    cycleChip: 'CYCL DEF 203 UNIVERSAL-BOHREN ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q201={depth} ;TIEFE ~\n  Q206={dfeed} ;VORSCHUB TIEFENZ. ~\n  Q202={peck} ;ZUSTELL-TIEFE ~\n  Q210=+0 ;VERWEILZEIT OBEN ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST. ~\n  Q212=+0 ;ABNAHMEBETRAG ~\n  Q213=+0 ;ANZ. SPANBRUECHE ~\n  Q205=+0 ;MIN. ZUSTELL-TIEFE ~\n  Q211={dwell} ;VERWEILZEIT UNTEN ~\n  Q208=+99999 ;VORSCHUB RUECKZUG ~\n  Q256=+0.2 ;RZ BEI SPANBRUCH',
    cycleTap: CYCL207, cycleTapLeft: CYCL207,
    cycleReam: 'CYCL DEF 201 REIBEN ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q201={depth} ;TIEFE ~\n  Q206={dfeed} ;VORSCHUB TIEFENZ. ~\n  Q211={dwell} ;VERWEILZEIT UNTEN ~\n  Q208={dfeed} ;VORSCHUB RUECKZUG ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST.',
    cycleBore: 'CYCL DEF 202 AUSDREHEN ~\n  Q200={q200} ;SICHERHEITS-ABST. ~\n  Q201={depth} ;TIEFE ~\n  Q206={dfeed} ;VORSCHUB TIEFENZ. ~\n  Q211={dwell} ;VERWEILZEIT UNTEN ~\n  Q208=+99999 ;VORSCHUB RUECKZUG ~\n  Q203={dtop} ;KOOR. OBERFLAECHE ~\n  Q204={q204} ;2. SICHERHEITS-ABST. ~\n  Q214=+0 ;FREIFAHR-RICHTUNG ~\n  Q336=+0 ;WINKEL SPINDEL',
    footer: 'L Z{safe} R0 FMAX M5\n{coolantoff}\nM30\nEND PGM {pgm} MM',
  },
];

// Lathe posts: X is written as diameter, Z0 = finished face of the part.
const LATHE_BASE = {
  lathe: true, decimals: 3, trimZeros: true, signed: false, modalCodes: true, feedAfterRapid: false, separator: ' ',
  comment: '({text})', asciiComments: true, arcs: false, useDrillCycle: false,
  lineNumbers: { enabled: false, start: 10, step: 10, prefix: 'N', comments: false },
  opStart: '\n# {opname} - {optype}', spindleOn: 'G97 S{rpm} M3', coolantOn: 'M8', coolantOff: 'M9', dwell: 'G4 X{dwell}',
  rapid: 'G0{X}{Z}', linear: 'G1{X}{Z}{F}', arcCW: '', arcCCW: '',
};
BUILTIN_POSTS.push(
  {
    ...LATHE_BASE, family: 'lathe', id: 'fanuc-lathe', name: 'Fanuc Drehen (Drehmaschine)', ext: 'nc', builtin: true, decimalPoint: true,
    header: '%\nO2000\n# OpenFab - {project}\n# {setup}: Z0 = Planfläche, X = Durchmesser\nG18 G21 G40 G98\nG0 X{safex} Z{safez}',
    toolChangeFirst: '# T{t} {toolname}\nT{tt}', toolChange: 'G0 X{safex} Z{safez}\nM5\n# T{t} {toolname}\nT{tt}',
    threadMove: 'G32{Z} F{pitch}',
    // G71 type I (contour N{ns}…N{nf}, rising steadily), G76 two-block threading (1 finishing pass, 60°)
    // G70 finishes along the contour N{ns}…N{nf} of the G71 before it (feed: F of the first contour block)
    cycleTurnRough: 'G0 X{sx} Z{sz}\nG71 U{ap} R0.5\nG71 P{ns} Q{nf} U{u} W0 F{f}\n{contour}', contourFirst: 'N{ns} ', contourLast: 'N{nf} ',
    cycleTurnFinish: 'G0 X{sx} Z{sz}\nG70 P{ns} Q{nf}',
    cycleTurnThread: 'G0 X{tsx} Z{tsz}\nG76 P010060 Q{tqmin} R0\nG76 X{tx} Z{tz} P{thu} Q{tdu} F{pitch}',
    footer: '\nG0 X{safex} Z{safez}\n{coolantoff}\nM5\nM30\n%',
  },
  {
    ...LATHE_BASE, family: 'lathe', id: 'linuxcnc-lathe', name: 'LinuxCNC Drehen', ext: 'ngc', builtin: true, spindleOn: 'S{rpm} M3',
    header: '# OpenFab - {project}\n# {setup}: Z0 = Planfläche, X = Durchmesser\nG7 G18 G21 G90 G94\nG0 X{safex} Z{safez}',
    toolChangeFirst: '# T{t} {toolname}\nT{t} M6 G43', toolChange: 'G0 X{safex} Z{safez}\nM5\n# T{t} {toolname}\nT{t} M6 G43',
    threadMove: 'G33{Z} K{pitch}',
    footer: '\nG0 X{safex} Z{safez}\n{coolantoff}\nM5\nM30',
  },
  {
    // Okuma OSP (LB/LU/Genos L): program name O…, speed limit G50 S, tool T + offset + nose (6 digits),
    // feed per minute G94, threading G33 with the lead F, end M02
    ...LATHE_BASE, family: 'lathe', id: 'okuma-lathe', name: 'Okuma OSP Drehen', ext: 'min', builtin: true, decimalPoint: true,
    comment: '({text})',
    header: 'O{prognum}\n# OpenFab - {project}\n# {setup}: Z0 = Planfläche, X = Durchmesser\nG50 S{maxrpm}\nG94\nG0 X{safex} Z{safez}',
    toolChangeFirst: '# T{t} {toolname}\nG0 X{safex} Z{safez}\nT{tt6}', toolChange: 'G0 X{safex} Z{safez}\nM5\n# T{t} {toolname}\nT{tt6}',
    spindleOn: 'G97 S{rpm} M3', dwell: 'G4 F{dwell}',
    threadMove: 'G33{Z} F{pitch}',
    // LAP: G85 bar turning with the contour N… G81 … G80, threading cycle G71 (straight infeed B0)
    // G87 finishes along the LAP contour N{lap} (feed: F of the first contour block)
    cycleTurnRough: 'G0 X{sx} Z{sz}\nG85 N{lap} D{ap} F{f} U{u} W0\nN{lap} G81\n{contour}\nG80', contourFirst: '', contourLast: '',
    cycleTurnFinish: 'G0 X{sx} Z{sz}\nG87 N{lap}',
    cycleTurnThread: 'G0 X{tsx} Z{tsz}\nG71 X{tx} Z{tz} B0 D{td} H{th} F{pitch}',
    footer: '\nG0 X{safex} Z{safez}\n{coolantoff}\nM5\nM2',
  },
);

// own posts of the app's library (all projects): set by the app; a post of the project with the same id wins
let LIBRARY = () => [];
export function setPostLibrary(fn) { LIBRARY = fn; }
export function allPosts(project) {
  const own = project.posts || [], ids = new Set([...BUILTIN_POSTS, ...own].map(p => p.id));
  let lib = [];
  try { lib = LIBRARY() || []; } catch { /* no storage */ }
  return [...BUILTIN_POSTS, ...own, ...lib.filter(p => p && !ids.has(p.id) && typeof p.linear === 'string').map(p => ({ ...p, libOnly: true }))];
}
export function findPost(project, id) { return allPosts(project).find(p => p.id === id) || BUILTIN_POSTS[0]; }
// legacy names used by the UI
export const POSTS = Object.fromEntries(BUILTIN_POSTS.map(p => [p.id, p.name]));
export const POST_EXT = Object.fromEntries(BUILTIN_POSTS.map(p => [p.id, p.ext]));

// Editable copy of a post (for "Duplizieren" / new custom posts).
export function copyPost(def, id, name) {
  const c = JSON.parse(JSON.stringify(def));
  delete c.builtin;
  return { ...c, id, name };
}

// Controllers and senders often choke on non-ASCII, even inside comments.
const ascii = s => s.replace(/Ø/g, 'D').replace(/×/g, 'x').replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue')
  .replace(/Ä/g, 'Ae').replace(/Ö/g, 'Oe').replace(/Ü/g, 'Ue').replace(/ß/g, 'ss').replace(/[^\x20-\x7e]/g, '');

// ---------- arc fitting ----------
// Runs of feed moves in one Z level that lie on a circle become arc moves
// { t: 'a', x, y, z, cx, cy, cw, f } (at most 180° each, deviation < tol).
function circle3(a, b, c) {
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-12) return null;
  const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
  const x = (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d;
  const y = (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d;
  return { x, y, r: Math.hypot(a.x - x, a.y - y) };
}

export function fitArcs(moves, tol = 0.005, helix = true) {
  const out = [];
  let i = 0;
  while (i < moves.length) {
    const m = moves[i];
    const st = moves[i - 1];
    // planar arcs and helical arcs (Z changes evenly with the angle: helix boring, thread milling, ramps)
    if (!st || m.t !== 'f' || st.a != null || m.a != null) { out.push(m); i++; continue; }
    let best = -1, bestArc = null;
    for (let j = i + 2; j < moves.length && j < i + 720; j++) {
      const mj = moves[j];
      if (mj.t !== 'f' || mj.f !== m.f || mj.comp !== m.comp || mj.lead !== m.lead || mj.a != null) break;
      const c = circle3(st, moves[Math.floor((i - 1 + j) / 2)], mj);
      if (!c || c.r < 0.05 || c.r > 5000) break;
      let ok = true, sweep = 0, dir = 0;
      for (let k = i - 1; k < j && ok; k++) {
        const p = moves[k], q = moves[k + 1];
        if (Math.abs(Math.hypot(q.x - c.x, q.y - c.y) - c.r) > tol) ok = false;
        // the straight segment between two points must also stay on the arc (long lines are not arcs)
        const seg = Math.hypot(q.x - p.x, q.y - p.y);
        if (c.r - Math.sqrt(Math.max(0, c.r * c.r - seg * seg / 4)) > tol) ok = false;
        const cr = (p.x - c.x) * (q.y - c.y) - (p.y - c.y) * (q.x - c.x);
        const dt = (p.x - c.x) * (q.x - c.x) + (p.y - c.y) * (q.y - c.y);
        const da = Math.atan2(cr, dt);
        const sg = Math.sign(da);
        if (!sg || (dir && sg !== dir)) ok = false;
        dir = sg;
        sweep += Math.abs(da);
      }
      if (!ok || sweep > Math.PI) break;
      // Z linear in the swept angle (planar: constant)
      if (Math.abs(mj.z - st.z) > 1e-9 || moves.slice(i, j).some(q => Math.abs(q.z - st.z) > 1e-9)) {
        if (!helix) break;
        let acc = 0;
        for (let k = i - 1; k < j && ok; k++) {
          const p = moves[k], q = moves[k + 1];
          acc += Math.abs(Math.atan2((p.x - c.x) * (q.y - c.y) - (p.y - c.y) * (q.x - c.x), (p.x - c.x) * (q.x - c.x) + (p.y - c.y) * (q.y - c.y)));
          if (Math.abs(q.z - (st.z + ((mj.z - st.z) * acc) / sweep)) > tol) ok = false;
        }
        if (!ok) break;
      }
      // nearly straight runs stay lines: huge-radius arcs are numerically fragile on controls
      const chord = Math.hypot(mj.x - st.x, mj.y - st.y);
      const sag = c.r - Math.sqrt(Math.max(0, c.r * c.r - (chord / 2) ** 2));
      if (c.r > 1000 || sag < 4 * tol) continue;
      best = j;
      bestArc = { cx: c.x, cy: c.y, cw: dir < 0, sw: sweep };
    }
    if (best >= i + 2) {
      const e = moves[best];
      out.push({ t: 'a', x: e.x, y: e.y, z: e.z, f: m.f, ...bestArc, ...(m.comp ? { comp: m.comp } : {}), ...(m.lead ? { lead: m.lead } : {}) });
      i = best + 1;
    } else { out.push(m); i++; }
  }
  return out;
}

function activeOps(project, results, ops = project.cam.ops) {
  return ops.filter(op => {
    const r = results.get(op.id);
    return op.enabled !== false && r && !r.error && r.moves.length;
  });
}

// Helical arcs around the same centre with the same pitch become one move: a polar arc (Heidenhain CP)
// may turn more than 360°, so a helix bore is one block per pass instead of two per turn.
function mergeHelix(moves) {
  const out = [];
  let z = null; // end height of the previous move
  for (const m of moves) {
    const last = out[out.length - 1];
    if (m.t === 'a' && last?.t === 'a' && last.z0 != null && z != null && m.sw > 0 && last.sw > 0 && m.cw === last.cw && m.f === last.f && m.comp === last.comp &&
      Math.abs(m.cx - last.cx) < 1e-6 && Math.abs(m.cy - last.cy) < 1e-6) {
      const dz = m.z - z, dzl = last.z - last.z0;
      if (Math.abs(dz) > 1e-6 && Math.abs(dzl) > 1e-6 && Math.abs(dz / m.sw - dzl / last.sw) < 1e-4 && last.sw + m.sw < (3600 * Math.PI) / 180) {
        out[out.length - 1] = { ...last, x: m.x, y: m.y, z: m.z, sw: last.sw + m.sw };
        z = m.z;
        continue;
      }
    }
    out.push(m.t === 'a' ? { ...m, z0: z } : m);
    if (m.z != null) z = m.z;
  }
  return out;
}

// Hole patterns: all holes of an operation on one bolt circle (equal pitch, full circle or arc) or in a
// grid / row (any rotation). Returns null when the holes form no such pattern.
export function holePattern(pts, tol = 0.01) {
  const n = pts.length;
  if (n < 3) return null;
  // grid: axis directions from the vectors between the holes (modulo 90°)
  const q = Math.PI / 2, cands = [];
  for (let i = 1; i < n; i++) {
    const a = ((Math.atan2(pts[i][1] - pts[0][1], pts[i][0] - pts[0][0]) % q) + q) % q;
    if (!cands.some(c => Math.abs(c - a) < 1e-6 || Math.abs(Math.abs(c - a) - q) < 1e-6)) cands.push(a);
  }
  const cluster = vs => { const s = [...vs].sort((a, b) => a - b), out = []; for (const v of s) if (!out.length || v - out[out.length - 1] > tol) out.push(v); return out; };
  const even = U => U.length < 2 || U.every((u, i) => i === 0 || Math.abs(u - U[i - 1] - (U[1] - U[0])) < tol);
  for (const th of cands) {
    const c = Math.cos(th), s = Math.sin(th);
    const uv = pts.map(([x, y]) => [x * c + y * s, -x * s + y * c]);
    const U = cluster(uv.map(p => p[0])), V = cluster(uv.map(p => p[1]));
    if (U.length * V.length !== n || !even(U) || !even(V)) continue;
    const idx = new Set(uv.map(([u, v]) => U.findIndex(x => Math.abs(x - u) <= tol) + ',' + V.findIndex(x => Math.abs(x - v) <= tol)));
    if (idx.size !== n || idx.has('-1,0') || [...idx].some(k => k.includes('-1'))) continue;
    const d1 = U.length > 1 ? U[1] - U[0] : 0, d2 = V.length > 1 ? V[1] - V[0] : 0;
    return { kind: 'grid', x: U[0] * c - V[0] * s, y: U[0] * s + V[0] * c, d1: d1 || d2, d2: d2 || d1, nc: U.length, nr: V.length, ang: (th * 180) / Math.PI };
  }
  // bolt circle: all on one circle, equal angular pitch (one bigger gap = arc)
  const P = pts.map(([x, y]) => ({ x, y }));
  const cc = circle3(P[0], P[1], P[2]);
  if (!cc || cc.r < 0.5 || P.some(p => Math.abs(Math.hypot(p.x - cc.x, p.y - cc.y) - cc.r) > tol)) return null;
  const an = P.map(p => Math.atan2(p.y - cc.y, p.x - cc.x)).sort((a, b) => a - b);
  const gaps = an.map((a, i) => (i + 1 < n ? an[i + 1] - a : an[0] + 2 * Math.PI - a));
  const tolA = tol / cc.r;
  let big = gaps.indexOf(Math.max(...gaps));
  const st = gaps[(big + 1) % n];
  if (gaps.every((g, i) => i === big || Math.abs(g - st) < tolA) && (gaps[big] > st - tolA)) {
    if (Math.abs(gaps[big] - st) < tolA) big = n - 1; // full circle: start at the smallest angle
    const a0 = an[(big + 1) % n];
    const deg = v => (v * 180) / Math.PI;
    return { kind: 'circle', cx: cc.x, cy: cc.y, r: cc.r, a0: deg(a0), step: deg(st), n, a1: deg(a0 + (n - 1) * st) };
  }
  return null;
}

// Several patterns in one operation: the largest pattern among the holes first (rows / grids from neighbour
// directions, bolt circles through neighbour triples), then again with the rest; what is left are single holes.
// Mixed operations: circles and grids need 4 holes, rows 3 (three holes always lie on some "arc").
export function holePatterns(pts, tol = 0.01) {
  const whole = holePattern(pts, tol);
  if (whole) return { groups: [{ ...whole, pts }], singles: [] };
  let rest = pts.map(([x, y], i) => ({ x, y, i }));
  const groups = [];
  for (let guard = 0; guard < 100 && rest.length >= 3; guard++) {
    const best = bestPatternGroup(rest, tol);
    if (!best) break;
    groups.push({ ...best.pat, pts: best.members.map(q => [q.x, q.y]) });
    const used = new Set(best.members.map(q => q.i));
    rest = rest.filter(q => !used.has(q.i));
  }
  return groups.length ? { groups, singles: rest.map(q => [q.x, q.y]) } : null;
}
function bestPatternGroup(P, tol) {
  // spatial hash (1 mm cells) for "is there a hole here"
  const H = new Map(), key = (x, y) => Math.floor(x) + ',' + Math.floor(y);
  for (const p of P) { const k = key(p.x, p.y); (H.get(k) || H.set(k, []).get(k)).push(p); }
  const at = (x, y) => {
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++)
      for (const p of H.get(key(x + dx, y + dy)) || []) if (Math.abs(p.x - x) <= tol && Math.abs(p.y - y) <= tol) return p;
    return null;
  };
  const near = p => P.filter(q => q !== p).sort((a, b) => Math.hypot(a.x - p.x, a.y - p.y) - Math.hypot(b.x - p.x, b.y - p.y)).slice(0, 6);
  let best = null;
  const offer = (members, minN) => {
    if (members.length < minN || (best && members.length <= best.members.length)) return;
    const pat = holePattern(members.map(q => [q.x, q.y]), tol);
    if (pat && (pat.kind === 'grid' ? (pat.nr > 1 ? members.length >= 4 : true) : members.length >= 4)) best = { pat, members };
  };
  for (const p of P) {
    const nb = near(p);
    for (const q of nb) {
      const a = [q.x - p.x, q.y - p.y];
      // rows: p, p + a, p + 2a … (p must be the first hole of the row)
      if (at(p.x - a[0], p.y - a[1])) continue;
      const run = [];
      for (let m = 0; ; m++) { const h = at(p.x + m * a[0], p.y + m * a[1]); if (!h) break; run.push(h); }
      offer(run, 3);
      // grids: a second direction at right angles, every row complete
      for (const r of nb) {
        if (r === q) continue;
        const b = [r.x - p.x, r.y - p.y], la = Math.hypot(...a), lb = Math.hypot(...b);
        if (Math.abs(a[0] * b[0] + a[1] * b[1]) > 1e-3 * la * lb || at(p.x - b[0], p.y - b[1])) continue;
        const cells = [];
        for (let n = 0; ; n++) {
          const row = [];
          for (let m = 0; m < run.length; m++) { const h = at(p.x + m * a[0] + n * b[0], p.y + m * a[1] + n * b[1]); if (!h) break; row.push(h); }
          if (row.length < run.length) break;
          cells.push(...row);
        }
        offer(cells, 4);
      }
    }
    // bolt circles through p and two of its neighbours
    for (let j = 0; j < nb.length; j++) for (let k = j + 1; k < nb.length; k++) {
      const c = circle3(p, nb[j], nb[k]);
      if (!c || c.r < 0.5) continue;
      offer(P.filter(h => Math.abs(Math.hypot(h.x - c.x, h.y - c.y) - c.r) <= tol), 4);
    }
  }
  return best;
}

// ---------- template engine ----------
class Writer {
  constructor(def) {
    this.def = def;
    this.out = [];
    this.st = {};          // modal state: last written X/Y/Z/F
    this.lastCode = null;  // last motion code for modal G-codes
    this.rapidBefore = true;
    this.srcMap = new Map(); // template text -> section key (for the editor: which template wrote a line)
  }

  // remember which section a (possibly rewritten) template belongs to
  tag(tpl, key) { if (tpl && key && !this.srcMap.has(String(tpl))) this.srcMap.set(String(tpl), key); return tpl; }

  num(v) {
    const d = this.def;
    const dec = Number.isFinite(+d.decimals) ? +d.decimals : 3;
    let s = (Math.round(v * 10 ** dec) / 10 ** dec).toFixed(dec);
    if (d.trimZeros !== false && dec > 0) s = s.replace(/0+$/, '').replace(/\.$/, '');
    if (d.decimalPoint && !s.includes('.')) s += '.';
    if (/^-0(\.0*)?$/.test(s)) s = s.slice(1);
    if (d.signed && !s.startsWith('-')) s = '+' + s;
    return s;
  }

  comment(text) {
    const d = this.def;
    let t = d.asciiComments !== false ? ascii(text) : text;
    if ((d.comment || '').startsWith('(')) t = t.replace(/[()]/g, '');
    return (d.comment || '({text})').replace('{text}', t);
  }

  // Expand one template with variables; motion words use the modal state.
  expand(tpl, vars = {}, motion = null) {
    if (!tpl) return;
    const d = this.def;
    const sep = d.separator ?? ' ';
    const src = this.srcMap.get(String(tpl)) || this.src || null;
    const n0 = this.out.length;
    const res = this.expandLines(tpl, vars, motion, d, sep);
    for (let i = n0; i < this.out.length; i++) if (this.out[i].src === undefined) this.out[i].src = src;
    return res;
  }

  expandLines(tpl, vars, motion, d, sep) {
    for (const raw of String(tpl).split('\n')) {
      if (raw === '') { this.out.push({ text: '', blank: true }); continue; }
      const isComment = raw.startsWith('#');
      let line = isComment ? raw.slice(1).trimStart() : raw;
      let wroteAxis = false;
      line = line.replace(/\{([A-Za-z][A-Za-z0-9]*)(!?)\}/g, (_, key, force) => {
        if (motion && /^[XYZA]$/.test(key)) {
          if (motion[key.toLowerCase()] == null) return '';
          const v = this.num(motion[key.toLowerCase()]);
          // axis words are modal: written only when the value changes (unless forced with "!")
          if (!force && this.st[key] === v) return '';
          this.st[key] = v;
          wroteAxis = true;
          return `${sep}${key}${v}`;
        }
        if (motion && key === 'F') {
          if (motion.f == null) return '';
          const f = Math.round(motion.f);
          if (this.st.F === f && !(d.feedAfterRapid && this.rapidBefore)) return '';
          this.st.F = f;
          // parametric feed (Heidenhain): FQ1, FQ2 …
          if (this.qfeed?.has(f)) return `${sep}FQ${this.qfeed.get(f)}`;
          return `${sep}F${f}`;
        }
        if (motion && (key === 'I' || key === 'J')) return `${sep}${key}${this.num(motion[key.toLowerCase()])}`;
        const v = vars[key] ?? vars[key.toLowerCase()];
        if (v == null) return '';
        return typeof v === 'number' ? this.num(v) : String(v);
      });
      if (motion && !wroteAxis && !motion.arc) return false; // nothing moved
      if (isComment) { this.out.push({ text: this.comment(line), comment: true }); continue; }
      if (motion && d.modalCodes !== false) {
        const code = line.match(/^(G0?[0-3])\b/)?.[1];
        if (code) {
          if (code === this.lastCode && !motion.arc) line = line.slice(code.length).trimStart();
          this.lastCode = code;
        }
      }
      if (!line.trim()) continue;
      this.out.push({ text: line, cont: /^\s/.test(raw) });
    }
    return true;
  }

  resetModal() { this.st = {}; this.lastCode = null; this.rapidBefore = true; }

  text() {
    const ln = this.def.lineNumbers || {};
    let n = +ln.start || 0;
    return this.out.map(l => {
      if (l.blank) return '';
      // tape start/end (%) and the program number line are never numbered
      if (!ln.enabled || l.cont || (l.comment && !ln.comments) || l.text === '%' || /^O\d+$/.test(l.text)) return l.text;
      const s = `${ln.prefix ?? 'N'}${n} ${l.text}`;
      n += +ln.step || 1;
      return s;
    }).join('\n');
  }
}

// ---------- post properties (like the "Postprozessor-Eigenschaften" in Fusion) ----------
export const COOLANT_MODES = { off: 'Aus', flood: 'Flutkühlung', mist: 'Minimalmenge (Nebel)', air: 'Luft außen', airThrough: 'Luft durch Spindel', through: 'Innenkühlung (durch Werkzeug)', floodAir: 'Flut + Luft außen' };
export const POST_PROP_GROUPS = [
  ['prefs', 'Einstellungen'], ['coolant', 'Kühlmittel (M-Codes)'], ['retract', 'Sicherer Rückzug und Referenzposition'],
  ['multiaxis', 'Mehrachsen (3+2 Schwenken)'], ['formats', 'Formate'], ['probing', 'Antasten und Messen'], ['builtin', 'Integriert'],
];
const HH = ['heidenhain'], ISO_SMOOTH = ['heidenhain', 'fanuc', 'sinumerik'];
export const POST_PROPS = [
  { key: 'subroutines', group: 'prefs', label: 'Unterprogramme verwenden', type: [['none', 'Nein'], ['ops', 'Alle Operationen (LBL)']], def: 'none', only: HH, help: 'Jede Operation als Unterprogramm (LBL) am Programmende, Aufruf mit CALL LBL' },
  { key: 'optionalStop', group: 'prefs', label: 'Optionaler Halt', type: 'bool', def: false, help: 'M1 vor jedem Werkzeugwechsel' },
  { key: 'preloadTool', group: 'prefs', label: 'Werkzeug vorwählen', type: 'bool', def: false, help: 'Nächstes Werkzeug schon vorbereiten (TOOL DEF bzw. T-Wort)' },
  { key: 'drillPatterns', group: 'prefs', label: 'Bohrbilder als Zyklus', type: 'bool', def: true, only: ['heidenhain', 'sinumerik'], help: 'Bohrungen auf einem Lochkreis oder in einem Raster als Musterzyklus (Heidenhain 220/221, Sinumerik HOLES2/CYCLE801) statt einzelner Positionen' },
  { key: 'apprDep', group: 'prefs', label: 'An-/Abfahren mit APPR/DEP', type: 'bool', def: true, only: HH, help: 'Konturen mit Radiuskorrektur an der Steuerung (RL/RR) fahren mit APPR/DEP an und ab; die Steuerung berechnet Hilfspunkt und Korrektur selbst' },
  { key: 'toolAsName', group: 'prefs', label: 'Werkzeug als Name', type: 'bool', def: false, only: HH, help: 'TOOL CALL "NAME" statt Werkzeugnummer' },
  { key: 'parametricFeed', group: 'prefs', label: 'Parametrischer Vorschub', type: 'bool', def: false, only: HH, help: 'Vorschübe als Q-Parameter (FQ1 …) – an der Maschine zentral anpassbar' },
  { key: 'smoothing', group: 'prefs', label: 'Glättung verwenden', type: [['off', 'Aus'], ['auto', 'Automatisch (Schruppen/Schlichten)'], ['low', 'Niedrig (0,05 mm)'], ['medium', 'Mittel (0,02 mm)'], ['high', 'Hoch (0,005 mm)']], def: 'off', only: ISO_SMOOTH, help: 'Heidenhain Zyklus 32 TOLERANZ, Fanuc G5.1, Sinumerik CYCLE832' },
  { key: 'coolFlood', group: 'coolant', label: 'Flutkühlung', type: 'text', def: 'M8' },
  { key: 'coolMist', group: 'coolant', label: 'Minimalmenge (Nebel)', type: 'text', def: 'M7' },
  { key: 'coolAir', group: 'coolant', label: 'Luft außen', type: 'text', def: { heidenhain: 'M28', default: 'M7' } },
  { key: 'coolAirThrough', group: 'coolant', label: 'Luft durch Spindel', type: 'text', def: 'M26' },
  { key: 'coolThrough', group: 'coolant', label: 'Innenkühlung', type: 'text', def: 'M88' },
  { key: 'coolOff', group: 'coolant', label: 'Kühlmittel aus', type: 'text', def: 'M9' },
  { key: 'coolAirOff', group: 'coolant', label: 'Luft aus', type: 'text', def: 'M9', help: 'Falls die Maschine für Luft einen eigenen Aus-Befehl hat (z. B. M29)' },
  { key: 'safeRetract', group: 'retract', label: 'Sicherer Rückzug', type: { heidenhain: [['clearance', 'Sicherheitshöhe'], ['m91', 'M91 (Maschinenkoordinaten)']], default: [['clearance', 'Sicherheitshöhe'], ['g28', 'G28 (Referenzpunkt)'], ['g53', 'G53 (Maschinenkoordinaten)']] }, def: 'clearance' },
  { key: 'm91Z', group: 'retract', label: 'Rückzugshöhe M91', type: 'num', def: 0, only: HH, help: 'Z-Wert in Maschinenkoordinaten für den M91-Rückzug' },
  { key: 'useM140', group: 'retract', label: 'M140 verwenden', type: 'bool', def: false, only: HH, help: 'M140 MB MAX: in Werkzeugachse maximal zurückziehen' },
  { key: 'homeXY', group: 'retract', label: 'XY-Referenz am Ende', type: 'bool', def: false, help: 'Am Programmende in X/Y auf Maschinen-Null fahren (M91 / G28)' },
  { key: 'preferTilt', group: 'multiaxis', label: 'Schwenkrichtung bevorzugen', type: [['neg', 'Negativ'], ['pos', 'Positiv'], ['either', 'Beliebig']], def: 'neg', only: HH },
  { key: 'tcpm', group: 'multiaxis', label: 'FUNCTION TCPM verwenden', type: 'bool', def: false, only: HH, help: 'Werkzeugspitzen-Nachführung einschalten' },
  { key: 'tiltedPlane', group: 'multiaxis', label: 'Geschwenkte Bearbeitungsebene', type: [['spatial', 'PLANE SPATIAL'], ['cycle19', 'Zyklus 19'], ['off', 'Aus']], def: 'spatial', only: HH, help: 'Für Setups, die nicht von oben bearbeitet werden' },
  { key: 'showNotes', group: 'formats', label: 'Notizen ausgeben', type: 'bool', def: false, help: 'Notizen der Operationen als Kommentar' },
  { key: 'structureComments', group: 'formats', label: 'Strukturkommentare', type: 'bool', def: true, help: 'Operationsname als Kommentar vor jeder Operation' },
  { key: 'writeMachine', group: 'formats', label: 'Maschine ausgeben', type: 'bool', def: true },
  { key: 'writeToolList', group: 'formats', label: 'Werkzeugliste ausgeben', type: 'bool', def: true },
  { key: 'writeVersion', group: 'formats', label: 'Version ausgeben', type: 'bool', def: false },
  { key: 'probeCycles', group: 'probing', label: 'Tastzyklen ausgeben', type: 'bool', def: true, help: 'Antast-Operationen als Steuerungszyklen (Heidenhain TCH PROBE 4xx, Renishaw G65 P98xx)' },
  { key: 'probeFeed', group: 'probing', label: 'Antastvorschub', type: 'num', def: 300, help: 'Vorschub für das geschützte Anfahren (Renishaw)' },
  { key: 'lineNumbers', group: 'builtin', label: 'Satznummern', type: 'bool', def: { heidenhain: true, default: false } },
  { key: 'arcs', group: 'builtin', label: 'Kreisbögen ausgeben', type: 'bool', def: true },
  { key: 'cycles', group: 'builtin', label: 'Bohrzyklen ausgeben', type: 'bool', def: true },
];
export const postFamily = def => def.family || (def.lathe ? 'lathe' : ['heidenhain', 'fanuc', 'sinumerik', 'linuxcnc', 'grbl'].find(f => String(def.id).startsWith(f)) || 'gcode');
export const propApplies = (prop, def) => !prop.only || prop.only.includes(postFamily(def));
const pick = (v, fam) => (v && typeof v === 'object' && !Array.isArray(v) ? (v[fam] ?? v.default) : v);
export const propType = (prop, def) => pick(prop.type, postFamily(def));
export function postProps(def, values = {}) {
  const fam = postFamily(def), out = {};
  for (const p of POST_PROPS) out[p.key] = values[p.key] ?? pick(p.def, fam);
  return out;
}

const SMOOTH_TOL = { low: 0.05, medium: 0.02, high: 0.005 };
const ROUGH_OPS = ['face', 'pocket', 'adaptive', 'rough3d', 'contour3d'];

// Euler angles for PLANE SPATIAL (rotations about the fixed machine axes X, then Y, then Z)
function tiltAngles(setup, prefer) {
  const R = setupMatrix(setup).clone().invert().elements; // setup axes in machine coordinates (column major)
  const r = (i, j) => R[j * 4 + i];
  const deg = x => Math.round((x * 180) / Math.PI * 1000) / 1000 + 0;
  let b = -Math.asin(Math.max(-1, Math.min(1, r(2, 0))));
  let a = Math.atan2(r(2, 1), r(2, 2)), c = Math.atan2(r(1, 0), r(0, 0));
  const identity = Math.abs(a) < 1e-9 && Math.abs(b) < 1e-9 && Math.abs(c) < 1e-9;
  return { a: deg(a), b: deg(b), c: deg(c), identity, seq: prefer === 'pos' ? '+' : prefer === 'neg' ? '-' : '' };
}

/**
 * Runs a post definition over one CAM setup.
 * opts.props: post properties (see POST_PROPS); opts.machine adds limit checks;
 * opts.opIds limits the program to these operations.
 */
export function runPost(def, project, gen, opts = {}) {
  const { stock, results, setup } = gen;
  const lathe = gen.kind === 'turn';
  const fam = postFamily(def), hh = fam === 'heidenhain';
  // own Heidenhain copies from before helix / approach templates existed get the built-in ones
  if (hh) {
    const base = BUILTIN_POSTS.find(x => x.id === 'heidenhain');
    if (base && def.helixCW == null && def.helixCCW == null) def = { ...def, helixCW: base.helixCW, helixCCW: base.helixCCW };
    if (base && def.approach == null && def.depart == null) def = { ...def, approach: base.approach, depart: base.depart };
  }
  const P = postProps(def, { ...(opts.legacy || {}), ...(opts.props || {}) });
  const o = lathe ? { x: 0, y: 0, z: stock.modelTop } : originOf(setup, stock);
  const W = new Writer({ ...def, lineNumbers: { ...(def.lineNumbers || {}), enabled: !!P.lineNumbers } });
  for (const [key] of SECTIONS) W.tag(def[key], key);
  W.tag(def.drillCycle, 'cycleDrill'); W.tag(def.drillPoint, 'cyclePoint');
  const machine = opts.machine;
  const warnings = [];
  const clean = v => ascii(v).replace(/[^A-Za-z0-9_]/g, '_');
  const safe = stock.top + +setup.safeZ;
  const clear = stock.top + +setup.retract;
  const base = {
    project: project.name, setup: setup.name, orientation: orientationLabel(setup), origin: originLabel(setup), machine: machine?.name || '',
    pgm: (opts.programName ? clean(opts.programName) : setup.programName ? clean(setup.programName) : (clean(project.name).slice(0, 12) || 'OPENFAB') + '_' + clean(setup.name).slice(0, 8)).toUpperCase(),
    maxrpm: String(Math.round(+machine?.maxRpm || 3000)),
    prognum: String(Math.max(1, Math.round(+(opts.programNumber ?? setup.programNumber)) || 1000)),
    wcs: 'G' + (53 + Math.min(6, Math.max(1, Math.round(+setup.wcsOffset) || 1))),
    wcsh: String(Math.max(1, Math.round(+setup.wcsOffset) || 1)),
    comment: (opts.comment ?? setup.comment) ? ' - ' + ascii(String(opts.comment ?? setup.comment)).replace(/[()]/g, '') : '',
    date: new Date().toLocaleString('de-DE'),
    stockx: stock.maxX - stock.minX, stocky: stock.maxY - stock.minY, stockz: stock.top - stock.bottom,
    sminx: stock.minX - o.x, sminy: stock.minY - o.y, sminz: stock.bottom - o.z,
    smaxx: stock.maxX - o.x, smaxy: stock.maxY - o.y, smaxz: stock.top - o.z,
    safe: safe - o.z,
    safex: lathe ? 2 * (stock.r + 2) : 0, safez: lathe ? stock.top + (+setup.safeZ || 5) - o.z : 0,
  };
  if (lathe && !def.lathe) warnings.push('Dreh-Setup mit Fräs-Postprozessor – bitte einen Dreh-Postprozessor wählen.');
  if (!lathe && def.lathe) warnings.push('Fräs-Setup mit Dreh-Postprozessor – bitte einen Fräs-Postprozessor wählen.');

  // ---- coolant per operation ----
  const coolCodes = { flood: [P.coolFlood], mist: [P.coolMist], air: [P.coolAir], airThrough: [P.coolAirThrough], through: [P.coolThrough], floodAir: [P.coolFlood, P.coolAir] };
  const offCodes = mode => (mode === 'air' || mode === 'airThrough' ? [P.coolAirOff] : mode === 'floodAir' ? [...new Set([P.coolOff, P.coolAirOff])] : [P.coolOff]);
  const defaultCool = opts.coolant ? 'flood' : 'off';
  let cool = 'off', turnLabel = 9000, lastRough = null;
  // cutting edge geometry: a finishing cycle may follow the roughing contour only with the same nose
  const edgeSig = t => JSON.stringify([t.kind, +t.noseRadius || 0, +t.insertAngle || 0, +t.leadAngle || 0, +t.angle || 0, +t.edgeLen || 0, +t.width || 0, !!t.internal]);
  const setCoolant = mode => {
    if (mode === cool) return;
    if (cool !== 'off') for (const c of offCodes(cool)) if (c) W.expand(c);
    if (mode !== 'off') for (const c of coolCodes[mode] || []) if (c) W.expand(c);
    cool = mode;
  };

  // ---- retract templates (M91 / M140 / G28 / G53) ----
  const retractTpl = tpl => {
    if (!tpl) return tpl;
    let t = String(tpl);
    if (hh) {
      if (P.safeRetract === 'm91') t = t.replace(/^L Z\{safe\} R0 FMAX/gm, `L Z${W.num(+P.m91Z || 0)} R0 FMAX M91`);
      if (P.useM140) t = t.replace(/^L Z\{safe\} R0 FMAX( M5)?$/gm, (_, m5) => `M140 MB MAX${m5 || ''}`).replace(/^(L Z[^\n]*? M91)( M5)?$/gm, (_, l, m5) => `M140 MB MAX${m5 || ''}`);
      if (P.toolAsName) t = t.replace(/TOOL CALL \{t\}/g, 'TOOL CALL {tcall}');
    } else if (!lathe) {
      if (P.safeRetract === 'g28') t = t.replace(/^G0 Z\{safe\}$/gm, 'G91 G28 Z0\nG90');
      if (P.safeRetract === 'g53') t = t.replace(/^G0 Z\{safe\}$/gm, 'G53 G0 Z0');
    }
    return t;
  };
  const tcFirst = W.tag(retractTpl(def.toolChangeFirst ?? def.toolChange), def.toolChangeFirst ? 'toolChangeFirst' : 'toolChange'), tcNext = W.tag(retractTpl(def.toolChange), 'toolChange');
  let footer = W.tag(retractTpl(def.footer), 'footer');

  // built-in and imported posts write G54 / O1000: use the setup's WCS offset and program number
  const header = W.tag(String(def.header || '').replace(/\bG54\b/g, '{wcs}').replace(/^O1000$/m, 'O{prognum}'), 'header');
  const ops = activeOps(project, results, gen.ops).filter(op => !opts.opIds || opts.opIds.includes(op.id));
  W.expand(header, { ...base, coolanton: '', coolantoff: '' });
  if (P.writeMachine && machine) W.expand(`# Maschine: ${machine.name}`);
  if (P.writeVersion) W.expand('# OpenFab CAD/CAM 1.0');
  if (P.writeToolList) {
    const used = [...new Map(ops.map(op => [results.get(op.id).tool.id, results.get(op.id).tool])).values()];
    if (used.length) W.expand('# Werkzeuge:');
    for (const t of used) W.expand(`# T${t.number} D${+(+t.dia).toFixed(3)} ${t.name}`);
  }
  if (hh && P.tcpm && !lathe) W.expand('FUNCTION TCPM F TCP AXIS POS PATHCTRL AXIS');

  // ---- tilted working plane for setups not machined from the top ----
  // 4-axis simultaneous: the setup orientation is how the part is clamped along the A axis, not a swivelled plane
  const rotarySetup = ops.some(op => results.get(op.id)?.rotary);
  const tilt = lathe || rotarySetup ? { identity: true } : tiltAngles(setup, P.preferTilt);
  let planeOn = false;
  const planeStart = () => {
    if (tilt.identity || planeOn) return;
    if (hh && P.tiltedPlane === 'spatial') W.expand(`PLANE SPATIAL SPA${W.num(tilt.a)} SPB${W.num(tilt.b)} SPC${W.num(tilt.c)} TURN MB MAX FMAX${tilt.seq ? ' SEQ' + tilt.seq : ''} TABLE ROT`);
    else if (hh && P.tiltedPlane === 'cycle19') W.expand(`CYCL DEF 19.0 BEARBEITUNGSEBENE\nCYCL DEF 19.1 A${W.num(tilt.a)} B${W.num(tilt.b)} C${W.num(tilt.c)}`);
    else { warnings.push(`Setup „${setup.name}“ ist geschwenkt – dieser Postprozessor gibt keine Schwenkebene aus. Werkstück entsprechend aufspannen.`); planeOn = true; return; }
    planeOn = true;
  };
  const planeEnd = () => {
    if (!planeOn || tilt.identity || !hh) return;
    if (P.tiltedPlane === 'spatial') W.expand('PLANE RESET STAY');
    else if (P.tiltedPlane === 'cycle19') W.expand('CYCL DEF 19.0 BEARBEITUNGSEBENE\nCYCL DEF 19.1 A+0 B+0 C+0');
  };

  // ---- smoothing ----
  let smoothOn = false;
  const smoothFor = op => {
    if (P.smoothing === 'off' || ['drill', 'probe'].includes(op.type) || lathe) return null;
    if (P.smoothing === 'auto') return ROUGH_OPS.includes(op.type) ? { tol: 0.05, rough: true } : { tol: 0.01, rough: false };
    return { tol: SMOOTH_TOL[P.smoothing] || 0.02, rough: P.smoothing === 'low' };
  };
  const smoothStart = sm => {
    if (!sm) { smoothReset(); return; }
    if (hh) W.expand(`CYCL DEF 32.0 TOLERANZ\nCYCL DEF 32.1 T${W.num(sm.tol)}\nCYCL DEF 32.2 HSC-MODE:${sm.rough ? 1 : 0}`);
    else if (fam === 'fanuc') W.expand('G5.1 Q1');
    else if (fam === 'sinumerik') W.expand(`CYCLE832(${sm.tol},${sm.rough ? '_ROUGH' : '_FINISH'},1)`);
    smoothOn = true;
  };
  const smoothReset = () => {
    if (!smoothOn) return;
    if (hh) W.expand('CYCL DEF 32.0 TOLERANZ\nCYCL DEF 32.1');
    else if (fam === 'fanuc') W.expand('G5.1 Q0');
    else if (fam === 'sinumerik') W.expand('CYCLE832(0,_OFF,1)');
    smoothOn = false;
  };

  const labels = [];
  let tool = null, totalTime = 0;
  const tcallOf = t => (hh && P.toolAsName ? `"${ascii(t.name).replace(/"/g, '').toUpperCase().slice(0, 32)}"` : String(t.number));
  ops.forEach((op, oi) => {
    const r = results.get(op.id);
    const t = r.tool;
    const probe = op.type === 'probe';
    totalTime += r.time;
    let rpm = Math.round(t.rpm);
    if (machine?.maxRpm && rpm > machine.maxRpm) { warnings.push(`${op.name}: Drehzahl ${rpm} > Maschinenmaximum ${machine.maxRpm} – begrenzt`); rpm = machine.maxRpm; }
    const tv = { ...base, coolanton: '', coolantoff: '', tt: String(t.number).padStart(2, '0').repeat(2), tt6: String(t.number).padStart(2, '0').repeat(3),t: String(t.number), tcall: tcallOf(t), toolname: t.name, tooldia: String(+(+t.dia).toFixed(3)), rpm: String(probe ? 0 : rpm), opname: op.name, optype: OP_TYPES[op.type] };
    const toolChanged = tool !== t.id;
    if (toolChanged) {
      smoothReset();
      setCoolant('off');
      if (tool !== null && P.optionalStop) W.expand('M1');
    }
    if (P.structureComments !== false) W.expand(def.opStart, tv);
    if (P.showNotes && op.note) for (const line of String(op.note).split('\n')) W.expand('# ' + line);
    if (toolChanged) {
      let tpl = tool === null ? tcFirst : tcNext;
      if (probe) tpl = W.tag(String(tpl || '').replace(/ M3\b/g, '').replace(/ S\{rpm\}/g, ''), 'toolChange'); // no spindle for the touch probe
      W.expand(tpl, tv);
      W.resetModal();
      if (!probe) W.expand(def.spindleOn, tv);
      tool = t.id;
      if (P.preloadTool) {
        const next = ops.slice(oi + 1).map(x => results.get(x.id).tool).find(x => x.id !== t.id);
        if (next) W.expand(hh ? `TOOL DEF ${tcallOf(next)}` : `T${next.number}`);
      }
    } else if (def.resetModalPerOp) W.resetModal();
    planeStart();

    // ---- touch probe cycles ----
    if (probe) {
      const pr = r.probe;
      const tpl = def[{ z: 'probeZ', bore: 'probeBore', boss: 'probeBoss', rectOut: 'probeRectOut', rectIn: 'probeRectIn' }[pr.mode]];
      if (!P.probeCycles) return;
      if (!tpl) { warnings.push(`${op.name}: Dieser Postprozessor hat keinen Tastzyklus für „${pr.mode}“ – übersprungen`); return; }
      const pv = {
        ...tv, cx: pr.x - o.x, cy: pr.y - o.y, z: pr.z - o.z, zmeas: pr.zMeas - o.z, dia: pr.dia || 0, w: pr.w || 0, l: pr.l || 0,
        sdist: pr.clearance, zclear: clear - o.z, zsafe: safe - o.z, zabove: pr.z + pr.clearance - o.z,
        preset: '+' + Math.round(+(op.probePreset ?? setup.wcsOffset ?? 1) || 0), transfer: (+(op.probeTransfer ?? 1) < 0 ? '' : '+') + Math.round(+(op.probeTransfer ?? 1)), wcsn: String(Math.round(+setup.wcsOffset || 1)), pfeed: String(Math.round(+P.probeFeed || 300)),
      };
      W.expand(tpl, pv);
      W.resetModal();
      return;
    }

    if (!probe) smoothStart(smoothFor(op));
    setCoolant(op.coolant || t.coolant || defaultCool);
    const maxF = machine?.maxFeed || Infinity;
    const feedOf = f => { if (f > maxF) { warnings.push(`${op.name}: Vorschub ${Math.round(f)} > Maschinenmaximum ${maxF} – begrenzt`); return maxF; } return f; };

    // the operation body may go into a subprogram
    const subs = hh && P.subroutines === 'ops';
    const mark = W.out.length;
    if (subs) W.resetModal();

    // parametric feeds: one Q parameter per feed of the operation
    W.qfeed = null;
    const willCycle = op.type === 'drill' && r.cycle && (P.cycles ?? def.useDrillCycle) && (def[CYCLE_KEYS[r.cycle.type === 'tap' && r.cycle.left ? 'tapLeft' : r.cycle.type || 'drill']] || def.drillCycle);
    if (hh && P.parametricFeed && !willCycle) {
      const feeds = [...new Set(r.moves.filter(m => m.t !== 'r' && !m.dwell && m.f).map(m => Math.round(feedOf(m.f))))].sort((a, b) => a - b);
      if (feeds.length) {
        W.qfeed = new Map(feeds.map((f, i) => [f, i + 1]));
        feeds.forEach((f, i) => W.expand(`FN 0: Q${i + 1} = +${f} ; VORSCHUB ${i === 0 && feeds.length > 1 ? 'EINTAUCHEN' : i === feeds.length - 1 ? 'SCHNEIDEN' : i + 1}`));
      }
    }

    const c = op.type === 'drill' ? r.cycle : null;
    const ctype = c ? (c.type === 'tap' && c.left ? 'tapLeft' : c.type || 'drill') : null;
    const cycleTpl = c && (def[CYCLE_KEYS[ctype]] || (['drill', 'dwell', 'peck'].includes(ctype) ? def.drillCycle : ''));
    const pointTpl = def.cyclePoint || def.drillPoint;
    let done = false;
    if (c && (P.cycles ?? def.useDrillCycle) && cycleTpl && pointTpl) {
      const depth = c.bottom - c.top;
      const cv = {
        ...tv, ztop: c.top - o.z, zbottom: c.bottom - o.z, rplane: (c.clear ?? clear) - o.z, depth, f: feedOf(c.feed), dfeed: feedOf(c.feed),
        peck: c.peck > 0 ? c.peck : Math.abs(depth), zfirst: c.top - o.z - (c.peck > 0 ? c.peck : Math.abs(depth)),
        dwell: c.dwell || 0, dwellms: String(Math.round((c.dwell || 0) * 1000)), pitch: c.pitch || 0, pitchsigned: (c.left ? -1 : 1) * (c.pitch || 0),
        sdis: Math.max(0.5, clear - c.top), q200: Math.max(0.5, clear - c.top), dtop: c.top - o.z, q204: safe - c.top, vari: c.type === 'chip' ? '0' : '1',
      };
      const pos = ([x, y]) => ({ x: x - o.x, y: y - o.y, z: c.top - o.z, f: null, arc: true });
      // bolt circles / grids as the control's pattern cycles (they call the cycle defined just before at each
      // hole); single holes first with the point template, so M99 surely calls the drilling cycle
      const pats = P.drillPatterns !== false && !def.cycleFirstInDef ? holePatterns(c.pts) : null;
      const patKey = pat => (pat.kind === 'circle' ? 'cyclePatternCircle' : 'cyclePatternGrid');
      if (pats && pats.groups.every(pat => def[patKey(pat)])) {
        W.expand(cycleTpl, cv);
        for (const pt of pats.singles) W.expand(pointTpl, cv, pos(pt));
        for (const pat of pats.groups) {
          const pvv = pat.kind === 'circle'
            ? { pcx: pat.cx - o.x, pcy: pat.cy - o.y, pdia: 2 * pat.r, prad: pat.r, pa0: pat.a0, pa1: pat.a1, pastep: pat.step, pn: String(pat.n) }
            : { gx: pat.x - o.x, gy: pat.y - o.y, gd1: pat.d1, gd2: pat.d2, gnc: String(pat.nc), gnr: String(pat.nr), gang: pat.ang };
          W.expand(W.tag(def[patKey(pat)], patKey(pat)), { ...cv, ...pvv });
        }
      } else if (def.cycleFirstInDef) {
        W.expand(cycleTpl, cv, pos(c.pts[0]));
        for (const pt of c.pts.slice(1)) W.expand(pointTpl, cv, { ...pos(pt), arc: false });
      } else {
        W.expand(cycleTpl, cv);
        for (const pt of c.pts) W.expand(pointTpl, cv, pos(pt));
      }
      W.expand(def.cycleEnd, cv);
      W.resetModal();
      done = true;
    }
    // pocket / stud as the control's cycle (rectangle, circle, slot): Heidenhain defines it once per shape and
    // calls it at the centre (M99); Sinumerik-style calls carry the centre themselves ({px}/{py})
    const studOp = op.type === 'contour';
    if (!done && (op.type === 'pocket' || studOp) && op.ctrlCycle) {
      const pc = studOp ? r.studCycle : r.pocketCycle, why = studOp ? r.studCycleWhy : r.pocketCycleWhy;
      const keyOf = s => (studOp ? (s.kind === 'circ' ? 'cycleStudCirc' : 'cycleStudRect')
        : s.kind === 'circ' ? 'cyclePocketCirc' : s.kind === 'slot' && def.cyclePocketSlot ? 'cyclePocketSlot' : 'cyclePocketRect');
      const what = studOp ? 'Zapfenzyklus' : 'Taschenzyklus';
      if (!pc) warnings.push(`${op.name}: Steuerungszyklus nicht möglich (${why || 'Form nicht erkannt'}) – als Bahn ausgegeben`);
      else if (!pc.pockets.every(s => def[keyOf(s)] && (/\{px\}/.test(def[keyOf(s)]) || pointTpl))) warnings.push(`${op.name}: Postprozessor ohne ${what} für diese Form – als Bahn ausgegeben`);
      else {
        const sg = v => { const t = W.num(v).replace(/^\+/, ''); return (t.startsWith('-') ? '' : '+') + t; };
        const rT = pc.toolR || (+t.dia || 0) / 2;
        const pv = {
          ...tv, depth: pc.bottom - pc.top, stepdown: pc.stepdown, stl: pc.stl, pfeed: String(Math.round(feedOf(pc.feed))), dfeed: String(Math.round(feedOf(pc.plunge))),
          climb: pc.climb ? '+1' : '-1', cdir: pc.climb ? '0' : '1', overlap: +pc.overlap.toFixed(3), mida: +(pc.overlap * rT).toFixed(3),
          plungemode: pc.helix ? '1' : '0', slotplunge: pc.helix ? '1' : '0', vari: pc.helix ? '21' : '11',
          q200: Math.max(0.5, (pc.clear ?? clear) - pc.top), sdis: Math.max(0.5, (pc.clear ?? clear) - pc.top), dtop: pc.top - o.z, ztop: pc.top - o.z, zbottom: pc.bottom - o.z, q204: safe - pc.top,
        };
        let lastDef = null;
        for (const s of pc.pockets) {
          const key = keyOf(s), tpl = W.tag(def[key], key);
          const minHalf = s.kind === 'circ' ? s.d / 2 : Math.min(s.w, s.l) / 2;
          const rad1 = Math.max(0.5, Math.min(rT, minHalf - rT - 0.2));
          const v = {
            ...pv, plen1: s.w, plen2: s.l, pcr: s.rc || 0, pcrs: Math.max(s.rc || 0, rT), pang: sg(s.ang || 0), pangs: s.ang || 0, pdia: s.d, prad: (s.d || 0) / 2,
            blank1: (s.w || 0) + 2 * (s.blank || 0), blank2: (s.l || 0) + 2 * (s.blank || 0), pblank: (s.d || 0) + 2 * (s.blank || 0),
            px: s.cx - o.x, py: s.cy - o.y, rad1, dp1: Math.max(0.1, Math.min(pc.stepdown, 2 * Math.PI * rad1 * Math.tan(((pc.ramp || 3) * Math.PI) / 180))),
          };
          if (/\{px\}/.test(def[key])) { W.expand(tpl, v); continue; }
          const sig = key + JSON.stringify([s.w, s.l, s.rc, s.ang, s.d, s.blank]);
          if (sig !== lastDef) { W.expand(tpl, v); lastDef = sig; }
          W.expand(pointTpl, v, { x: s.cx - o.x, y: s.cy - o.y, z: pc.top - o.z, f: null, arc: true });
        }
        if (pc.pockets.some(s => !/\{px\}/.test(def[keyOf(s)]))) W.expand(def.cycleEnd, pv);
        W.resetModal();
        done = true;
      }
    }
    // turning: roughing / threading as the control's cycle (the contour is part of the program)
    if (!done && lathe && op.ctrlCycle && ['trough', 'tthread'].includes(op.type)) {
      const tc = r.turnCycle, key = op.type === 'trough' ? 'cycleTurnRough' : 'cycleTurnThread';
      if (!tc) warnings.push(`${op.name}: Steuerungszyklus nicht möglich (${r.turnCycleWhy || 'keine Zyklusdaten'}) – als Bahn ausgegeben`);
      else if (!def[key]) warnings.push(`${op.name}: Postprozessor ohne Drehzyklus – als Bahn ausgegeben`);
      else {
        W.resetModal();
        const zz = z => z - o.z;
        if (tc.kind === 'rough') {
          if (tc.under) warnings.push(`${op.name}: Zyklus schruppt nur bis zur Hüllkontur – Hinterschnitt/Einstich bis ${String(+tc.under.toFixed(2)).replace('.', ',')} mm (Radius) bleibt stehen; vor dem Schlichten einstechen`);
          turnLabel += 10;
          const v = { ...tv, sx: 2 * tc.sx, sz: zz(tc.sz), ap: tc.ap, u: String(+(2 * (tc.u || 0)).toFixed(3)), f: String(Math.round(feedOf(tc.feed))), lap: String(turnLabel), ns: String(turnLabel), nf: String(turnLabel + 1) };
          // a finishing cycle later in the program takes its feed from the first contour block (the roughing
          // cycle ignores F there)
          let fin = null;
          for (const x of ops.slice(oi + 1)) {
            if (x.type === 'trough' && x.ctrlCycle) break;
            if (x.type === 'tfinish' && x.ctrlCycle) { fin = x; break; }
          }
          const [pre, post = ''] = String(def[key]).split(/\n?\{contour\}\n?/);
          W.expand(W.tag(pre, key), v);
          W.st.X = W.num(2 * tc.sx); W.st.Z = W.num(zz(tc.sz)); W.lastCode = null;
          const n0 = W.out.length, pts = tc.pts;
          // first block X only (Fanuc type I), then the contour from its start on the face to the chuck side
          W.expand(def.rapid, tv, { x: 2 * pts[0][0], z: zz(tc.sz), f: null });
          for (const [x, z] of pts) W.expand(def.linear, tv, { x: 2 * x, z: zz(z), f: null });
          const fill = tpl => String(tpl || '').replace(/\{(\w+)\}/g, (_, n) => v[n] ?? '');
          if (W.out.length > n0) {
            W.out[n0].text = fill(def.contourFirst) + W.out[n0].text;
            if (fin && def.cycleTurnFinish) W.out[n0].text += ` F${Math.round(feedOf(results.get(fin.id).tool.feed))}`;
            if (W.out.length - 1 > n0) W.out[W.out.length - 1].text = fill(def.contourLast) + W.out[W.out.length - 1].text;
          }
          if (post) W.expand(W.tag(post, key), v);
          lastRough = { ...v, sxr: tc.sx, szr: tc.sz, sig: edgeSig(t), zEnd: op.zEnd ?? '', under: tc.under, op: op.name };
        } else {
          const v = {
            ...tv, tsx: 2 * tc.sx, tsz: zz(tc.sz), tx: 2 * tc.xEnd, tz: zz(tc.ze), th: tc.h, td: tc.d1, pitch: tc.pitch,
            thu: String(Math.round(tc.h * 1000)), tdu: String(Math.round(tc.d1 * 1000)), tqmin: String(Math.max(10, Math.round(tc.d1 * 250))),
          };
          W.expand(W.tag(def[key], key), v);
        }
        W.resetModal();
        done = true;
      }
    }
    // turning: finishing as the control's cycle along the contour of the roughing cycle before it
    if (!done && lathe && op.ctrlCycle && op.type === 'tfinish') {
      const why = !def.cycleTurnFinish ? 'Postprozessor ohne Schlichtzyklus'
        : !lastRough ? 'kein Schruppzyklus davor (Längsschruppen „Als Steuerungszyklus“)'
        : lastRough.sig !== edgeSig(t) ? `Schneide anders als beim Schruppen (${lastRough.op}) – die Kontur ist für dessen Schneidenradius gerechnet`
        : String(op.zEnd ?? '') !== String(lastRough.zEnd) ? `Ende Z anders als beim Schruppen (${lastRough.op})` : null;
      if (why) warnings.push(`${op.name}: Schlichtzyklus nicht möglich (${why}) – als Bahn ausgegeben`);
      else {
        if (+op.stockToLeave) warnings.push(`${op.name}: Schlichtzyklus fährt die Fertigkontur – Aufmaß ${op.stockToLeave} mm wird nicht berücksichtigt`);
        if (lastRough.under) warnings.push(`${op.name}: Schlichtzyklus folgt der Hüllkontur – Hinterschnitt/Einstich bleibt stehen`);
        W.resetModal();
        W.expand(W.tag(def.cycleTurnFinish, 'cycleTurnFinish'), { ...tv, sx: 2 * lastRough.sxr, sz: lastRough.szr - o.z, ns: lastRough.ns, nf: lastRough.nf, lap: lastRough.lap });
        W.resetModal();
        done = true;
      }
    }
    if (!done) {
      if (c && c.type === 'tap') warnings.push(`${op.name}: Steuerung/Postprozessor ohne Gewindebohrzyklus – als Vorschubbewegung ausgegeben (nur mit Ausgleichsfutter!)`);
      // arc fitting follows the tolerance of the operation (Fusion: "Toleranz")
      const tolA = Math.min(0.05, Math.max(0.001, (+op.tolerance || 0.01) / 2));
      // helices only where the post can write them (helix template, or an arc template with Z)
      const helixOk = !!(def.helixCW && def.helixCCW) || (/\{Z/.test(def.arcCW || '') && /\{Z/.test(def.arcCCW || ''));
      const moves = P.arcs !== false && !lathe && !r.rotary ? fitArcs(r.moves, tolA, helixOk) : r.moves;
      // 4-axis moves: machine values (Y/Z of the tip with the part turned by A), rotary word added to the templates
      const rot = r.rotary;
      const withA = tpl => (!rot || /\{A!?\}/.test(tpl || '') ? tpl : W.tag(String(tpl || '').replace('{Z}', '{Z}{A}'), tpl === def.rapid ? 'rapid' : 'linear'));
      if (rot) {
        if (Math.abs(o.y - rot.y) > 0.01 || Math.abs(o.z - rot.z) > 0.01) warnings.push(`${op.name}: Nullpunkt Y/Z liegt nicht auf der Drehachse A (Achse bei Y${W.num(rot.y - o.y)} Z${W.num(rot.z - o.z)}) – für 4-Achs-Simultan den Nullpunkt auf die Achse legen (Rohteil-Punkt Mitte Y/Z)`);
        if (machine?.kin && machine.kin.type !== 'A' && (machine.kin.type !== 'AC' || Array.isArray(machine.kin.a))) warnings.push(`${op.name}: Die gewählte Maschine hat keine endlos drehende A-Achse`);
        if (!machine?.kin) warnings.push(`${op.name}: 4-Achs-Simultan – Maschine mit Drehachse A wählen`);
      }
      let px = null, py = null, pz = null, comp = null;
      W.lastCC = null; // circle centre CC: modal on the control, written again only when it changes (and per operation)
      const list = def.helixCW && def.helixCCW ? mergeHelix(moves) : moves;
      const useAppr = hh && !lathe && !rot && P.apprDep !== false && def.approach && def.depart;
      const R0t = (+t.dia || 0) / 2;
      // a lead (run of moves with the same lead tag) as APPR/DEP words, or null when the control's functions do not fit
      const leadRun = mi => { let j = mi; while (list[j + 1]?.lead === list[mi].lead) j++; return j; };
      const leadWords = (L, end, i0, i1) => {
        for (let k = i0; k <= i1; k++) if (Math.abs(list[k].z - list[i1].z) > 1e-6) return null; // ramped leads stay as moves
        const n = v => W.num(v), xy = ` X${n(end.x - o.x)} Y${n(end.y - o.y)}`, inn = L.k === 'in';
        if (L.perp) { const len = L.R + L.linear - R0t; return len > 0.01 ? `LN${inn ? xy : ''} LEN${n(len)}` : null; }
        if (L.R > 0) return L.linear > 0 ? `LCT${xy} R${n(L.R)}` : `CT${inn ? xy : ''} CCA${n(Math.min(180, Math.max(1, L.sweep)))} R${n(L.R)}`;
        return L.linear > 0 ? `LT${inn ? xy : ''} LEN${n(L.linear)}` : null;
      };
      for (let mi = 0; mi < list.length; mi++) {
        const m = list[mi];
        if (m.dwell) { W.expand(def.dwell, { ...tv, dwell: m.dwell }); continue; }
        if (useAppr && m.lead && m.comp && list[mi - 1]?.lead !== m.lead) {
          const j = leadRun(mi), L = m.lead, end = list[j];
          const words = leadWords(L, end, L.k === 'in' ? Math.max(0, mi - 1) : mi, j);
          if (words && (L.k === 'out' || list[j + 1]?.comp === m.comp)) {
            if (L.k === 'in') W.expand(W.tag(def.approach, 'approach'), { ...tv, appr: words, rc: m.comp === 'L' ? 'RL' : 'RR' }, { f: feedOf(m.f), arc: true });
            else W.expand(W.tag(def.depart, 'depart'), { ...tv, dep: words }, { f: feedOf(m.f), arc: true });
            // the control ends the approach on the contour, the departure at the end point (compensation off)
            W.st.X = W.num(end.x - o.x); W.st.Y = W.num(end.y - o.y); W.st.Z = W.num(end.z - o.z);
            W.rapidBefore = false;
            comp = L.k === 'in' ? m.comp : null;
            px = end.x; py = end.y; pz = end.z;
            mi = j;
            continue;
          }
        }
        // cutter radius compensation at the control (G41/G42 … G40, Heidenhain RL/RR … R0)
        const mc = m.t === 'r' ? null : m.comp || null;
        if (mc !== comp && !lathe) {
          if (fam === 'grbl') { if (mc) warnings.push(`${op.name}: GRBL kennt keine Radiuskorrektur (G41/G42) – Bahn ohne Korrektur ausgegeben`); }
          else if (!hh) W.expand(mc ? `${mc === 'L' ? 'G41' : 'G42'}${fam === 'sinumerik' ? '' : ' D' + t.number}` : 'G40');
          comp = mc;
        }
        const mark0 = W.out.length;
        // lathe: x is the radius in the toolpath, the program wants the diameter
        const mv = { x: lathe ? 2 * m.x : m.x - o.x, y: m.y - o.y, z: m.z - o.z, f: m.t === 'r' ? null : feedOf(m.f) };
        if (m.a != null) Object.assign(mv, { y: m.my - o.y, z: m.mz - o.z, a: m.a });
        if (m.t === 't') { W.expand(def.threadMove, { ...tv, pitch: m.pitch }, { ...mv, f: null }); W.rapidBefore = false; px = m.x; py = m.y; pz = m.z; continue; }
        if (m.t === 'a') {
          Object.assign(mv, { arc: true, cx: m.cx - o.x, cy: m.cy - o.y, i: m.cx - px, j: m.cy - py });
          let helix = pz != null && Math.abs(m.z - pz) > 1e-6 && (m.cw ? def.helixCW : def.helixCCW);
          let arcT = m.cw ? def.arcCW : def.arcCCW;
          if (hh) {
            const ccKey = W.num(mv.cx) + ' ' + W.num(mv.cy);
            if (ccKey === W.lastCC) {
              const strip = (tpl, key) => W.tag(String(tpl).split('\n').filter(l => !/^CC\b/.test(l)).join('\n'), key);
              if (helix) helix = strip(helix, m.cw ? 'helixCW' : 'helixCCW'); else arcT = strip(arcT, m.cw ? 'arcCW' : 'arcCCW');
            }
            W.lastCC = ccKey;
          }
          if (helix) {
            // polar arc: the end point follows from the angle – the axis words are now known to the control
            const ipa = ((m.cw ? -1 : 1) * (m.sw ?? 0) * 180) / Math.PI;
            const sgn = v => { const t = W.num(v).replace(/^\+/, ''); return (t.startsWith('-') ? '' : '+') + t; };
            W.expand(helix, { ...tv, cx: mv.cx, cy: mv.cy, ipa: sgn(ipa), iz: sgn(m.z - pz) }, { ...mv, x: null, y: null, z: null });
            W.st.X = W.num(mv.x); W.st.Y = W.num(mv.y); W.st.Z = W.num(mv.z);
          } else W.expand(arcT, { ...tv, cx: mv.cx, cy: mv.cy, i: mv.i, j: mv.j }, mv);
          W.rapidBefore = false;
        } else if (m.t === 'r') {
          W.expand(withA(def.rapid), tv, mv);
          W.rapidBefore = true;
        } else if (W.expand(withA(def.linear), tv, mv)) W.rapidBefore = false;
        if (hh && comp && fam !== 'grbl') for (let k = mark0; k < W.out.length; k++) W.out[k].text = W.out[k].text.replace(/ R0\b/, comp === 'L' ? ' RL' : ' RR');
        px = m.x; py = m.y; pz = m.z;
      }
      if (comp && !hh && fam !== 'grbl' && !lathe) W.expand('G40');
    }
    W.qfeed = null;
    if (subs) {
      const body = W.out.splice(mark);
      const n = labels.length + 1;
      labels.push({ n, name: op.name, body });
      W.expand(`CALL LBL ${n}`);
      W.resetModal();
    }
  });
  smoothReset();
  planeEnd();
  if (cool !== 'off') {
    const offs = offCodes(cool);
    cool = 'off';
    footer = W.tag(String(footer || '').replace('{coolantoff}', offs.filter(Boolean).join('\n')), 'footer');
  }
  W.expand(footer, { ...base, coolanton: '', coolantoff: '' });
  if (hh && P.tcpm && !lathe) {
    const end = W.out.findIndex(l => /^M30\b|^M2\b/.test(l.text));
    if (end >= 0) W.out.splice(end, 0, { text: 'FUNCTION RESET TCPM' });
  }
  if (P.homeXY && !lathe) {
    const end = W.out.findIndex(l => /^M30\b|^M2\b/.test(l.text));
    const home = hh ? [{ text: 'L X+0 Y+0 R0 FMAX M91' }] : fam === 'sinumerik' ? [{ text: 'G0 SUPA X0 Y0' }] : [{ text: 'G91 G28 X0 Y0' }, { text: 'G90' }];
    if (end >= 0) W.out.splice(end, 0, ...home);
  }
  // subprograms after the end of the main program (before END PGM)
  if (labels.length) {
    let at = W.out.findIndex(l => /^END PGM/.test(l.text));
    if (at < 0) at = W.out.length;
    const rows = [];
    for (const lb of labels) rows.push({ text: W.comment(`Unterprogramm ${lb.n}: ${lb.name}`), comment: true }, { text: `LBL ${lb.n}` }, ...lb.body, { text: 'LBL 0' });
    W.out.splice(at, 0, ...rows);
  }

  // machine envelope: stock and toolpath extents must fit the travels
  if (machine?.travel) {
    const tr = machine.travel;
    const ext = { x: stock.maxX - stock.minX, y: stock.maxY - stock.minY, z: safe - stock.bottom };
    for (const k of ['x', 'y', 'z']) if (tr[k] && ext[k] > tr[k]) warnings.push(`${k.toUpperCase()}-Verfahrweg ${tr[k]} mm reicht nicht (benötigt ${ext[k].toFixed(1)} mm)`);
  }
  const code = W.text();
  // src[i]: section key of the template that wrote line i (null: post properties / automatic lines)
  return { code, lines: code.split('\n').length, time: totalTime, warnings: [...new Set(warnings)], src: W.out.map(l => l.src || null) };
}

// Entry point used by the app: post id from project.post.flavor (or the machine).
export function postProcess(project, gen, machine = null, extra = {}) {
  const def = findPost(project, extra.postId || project.post.flavor);
  const pp = project.post || {};
  // older projects kept these switches directly in project.post
  const legacy = { arcs: pp.arcs !== false, cycles: pp.cycles !== false, ...(def.builtin && def.id !== 'heidenhain' && pp.lineNumbers != null ? { lineNumbers: !!pp.lineNumbers } : {}) };
  return runPost(def, project, gen, { coolant: !!pp.coolant, legacy, props: { ...(pp.props?.[def.id] || {}) }, machine, ...extra });
}
