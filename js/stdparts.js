// Standard parts ("Normteile"): screws, nuts, washers, pins, keys, retaining rings, bearings, O-rings.
// Guide dimensions (nominal sizes of the standards, no tolerances). A thread is a step of its own: the cylinder is
// marked as a thread (drawings show it) or, on request, cut as a real helix.
//
// A part is a list of steps around its axis (z along the axis, r away from it; z = 0 is the seat: the face
// the head, the nut or the washer lies on – a shank runs to −z, into the hole):
//   { k: 'rev', pts: [[r, z], …], op }             closed outline in the r–z half plane, turned once around
//   { k: 'ring', r, z, rad, op }                   a circle of radius rad at (r, z), turned once around (torus)
//   { k: 'prism', shape: 'hex' | 'circle' | 'rect', s | r | w, h, rr, hole, z, dist, op }
//   { k: 'thread', r, z, size }                    the cylinder face of radius r at height z carries the thread size
// op: 'new' for the first step, then 'join' or 'cut' (applied to the part itself).

const T30 = Math.tan(Math.PI / 6);

// metric sizes: d, then per standard
const M = {
  //        d   4762: dk k s t       hex: s k    nut m  thin  lock   10642: dk k s          7380: dk k s         4026 s  7089: d1 d2 h     7093: d2 h   127: d1 d2 s
  M3: { d: 3, cap: [5.5, 3, 2.5, 1.3], hex: [5.5, 2], m: 2.4, mt: 1.8, ml: 4, csk: [6.72, 1.86, 2], btn: [5.7, 1.65, 2], set: 1.5, w: [3.2, 7, 0.5], wl: [9, 0.8], sp: [3.1, 6.2, 0.8] },
  M4: { d: 4, cap: [7, 4, 3, 2], hex: [7, 2.8], m: 3.2, mt: 2.2, ml: 5, csk: [8.96, 2.48, 2.5], btn: [7.6, 2.2, 2.5], set: 2, w: [4.3, 9, 0.8], wl: [12, 1], sp: [4.1, 7.6, 0.9] },
  M5: { d: 5, cap: [8.5, 5, 4, 2.5], hex: [8, 3.5], m: 4.7, mt: 2.7, ml: 5, csk: [11.2, 3.1, 3], btn: [9.5, 2.75, 3], set: 2.5, w: [5.3, 10, 1], wl: [15, 1.2], sp: [5.1, 9.2, 1.2] },
  M6: { d: 6, cap: [10, 6, 5, 3], hex: [10, 4], m: 5.2, mt: 3.2, ml: 6, csk: [13.44, 3.72, 4], btn: [10.5, 3.3, 4], set: 3, w: [6.4, 12, 1.6], wl: [18, 1.6], sp: [6.1, 11.8, 1.6] },
  M8: { d: 8, cap: [13, 8, 6, 4], hex: [13, 5.3], m: 6.8, mt: 4, ml: 8, csk: [17.92, 4.96, 5], btn: [14, 4.4, 5], set: 4, w: [8.4, 16, 1.6], wl: [24, 2], sp: [8.1, 14.8, 2] },
  M10: { d: 10, cap: [16, 10, 8, 5], hex: [16, 6.4], m: 8.4, mt: 5, ml: 10, csk: [22.4, 6.2, 6], btn: [17.5, 5.5, 6], set: 5, w: [10.5, 20, 2], wl: [30, 2.5], sp: [10.2, 18.1, 2.2] },
  M12: { d: 12, cap: [18, 12, 10, 6], hex: [18, 7.5], m: 10.8, mt: 6, ml: 12, csk: [26.88, 7.44, 8], btn: [21, 6.6, 8], set: 6, w: [13, 24, 2.5], wl: [37, 3], sp: [12.2, 21.1, 2.5] },
  M16: { d: 16, cap: [24, 16, 14, 8], hex: [24, 10], m: 14.8, mt: 8, ml: 16, csk: [33.6, 8.8, 10], btn: [28, 8.8, 10], set: 8, w: [17, 30, 3], wl: [50, 3], sp: [16.2, 27.4, 3.5] },
  M20: { d: 20, cap: [30, 20, 17, 10], hex: [30, 12.5], m: 18, mt: 10, ml: 20, csk: [40.32, 10.16, 12], set: 10, w: [21, 37, 3], wl: [60, 4], sp: [20.2, 33.6, 4] },
  M24: { d: 24, cap: [36, 24, 19, 12], hex: [36, 15], m: 21.5, mt: 12, ml: 24, set: 12, w: [25, 44, 4], wl: [72, 5], sp: [24.5, 40, 5] },
};
// further series: low head cap screw DIN 7984 (dk, k, s), cap nut DIN 1587 (s, h), small washer ISO 7092 (d2, h)
const MORE = {
  M3: { low: [5.5, 2, 2], ws: [6, 0.5] }, M4: { low: [7, 2.8, 2.5], cn: [7, 8], ws: [8, 0.5] }, M5: { low: [8.5, 3.5, 3], cn: [8, 10], ws: [9, 1] }, M6: { low: [10, 4, 4], cn: [10, 12], ws: [11, 1.6] },
  M8: { low: [13, 5, 5], cn: [13, 15], ws: [15, 1.6] }, M10: { low: [16, 6, 7], cn: [17, 18], ws: [18, 1.6] }, M12: { low: [18, 7, 8], cn: [19, 22], ws: [20, 2] }, M16: { low: [24, 9, 12], cn: [24, 28], ws: [28, 2.5] }, M20: { cn: [30, 34], ws: [34, 3] },
};
for (const k of Object.keys(MORE)) Object.assign(M[k], MORE[k]);
// coarse pitch; the hole of a nut is the minor diameter of its thread
const PITCH = { M3: 0.5, M4: 0.7, M5: 0.8, M6: 1, M8: 1.25, M10: 1.5, M12: 1.75, M16: 2, M20: 2.5, M24: 3 };
const core = z => M[z].d - 1.0825 * PITCH[z];
const mSizes = key => Object.keys(M).filter(k => M[k][key] != null);
// spring pins ISO 8752: nominal Ø → wall
const SPRING = { 2: 0.4, 3: 0.6, 4: 0.8, 5: 1, 6: 1.25, 8: 1.5, 10: 2, 12: 2.5, 16: 3, 20: 4 };
// rotary shaft seals DIN 3760: d × D × b
const SEALS = { '10×22×7': [10, 22, 7], '12×24×7': [12, 24, 7], '15×30×7': [15, 30, 7], '20×35×7': [20, 35, 7], '25×40×7': [25, 40, 7], '30×47×7': [30, 47, 7], '35×52×7': [35, 52, 7], '40×62×8': [40, 62, 8], '50×72×8': [50, 72, 8] };

// feather keys DIN 6885: b × h
const KEYS = { '4×4': [4, 4], '5×5': [5, 5], '6×6': [6, 6], '8×7': [8, 7], '10×8': [10, 8], '12×8': [12, 8], '14×9': [14, 9], '16×10': [16, 10], '18×11': [18, 11], '20×12': [20, 12] };
// retaining rings: nominal Ø → thickness s, Ø unloaded d3, radial width b
const RING_SHAFT = { 10: [1, 9.3, 1.8], 12: [1, 11, 1.8], 15: [1, 13.8, 2.2], 16: [1, 14.7, 2.2], 20: [1.2, 18.5, 2.6], 25: [1.2, 23.2, 3], 30: [1.5, 27.9, 3.5], 35: [1.5, 32.2, 3.9], 40: [1.75, 36.5, 4.4], 50: [2, 45.8, 5.1] };
const RING_BORE = { 10: [1, 10.8, 1.4], 12: [1, 13, 1.7], 16: [1, 17.3, 2], 20: [1, 21.5, 2.3], 25: [1.2, 26.9, 2.7], 30: [1.2, 32.1, 3], 35: [1.5, 37.8, 3.4], 40: [1.75, 43.5, 3.9], 50: [2, 54.2, 4.6] };
// deep groove ball bearings: d, D, B
const BEARINGS = { 623: [3, 10, 4], 624: [4, 13, 5], 625: [5, 16, 5], 626: [6, 19, 6], 608: [8, 22, 7], 6000: [10, 26, 8], 6001: [12, 28, 8], 6002: [15, 32, 9], 6003: [17, 35, 10], 6004: [20, 42, 12], 6005: [25, 47, 12], 6006: [30, 55, 13],
  6200: [10, 30, 9], 6201: [12, 32, 10], 6202: [15, 35, 11], 6203: [17, 40, 12], 6204: [20, 47, 14], 6205: [25, 52, 15], 6206: [30, 62, 16] };
// O-rings: inner Ø × cord Ø
const ORINGS = { '6×1,5': [6, 1.5], '8×2': [8, 2], '10×2': [10, 2], '12×2': [12, 2], '16×2': [16, 2], '20×2,5': [20, 2.5], '25×3': [25, 3], '30×3': [30, 3], '40×3,5': [40, 3.5], '50×4': [50, 4] };
const PINS = [2, 3, 4, 5, 6, 8, 10, 12, 16, 20];

const shank = (d, L) => { const c = Math.min(0.1 * d, 0.3 * L); return [[0, -L], [d / 2 - c, -L], [d / 2, -L + c], [d / 2, 0]]; };
// the corners of a hexagon cut off at 30°: what is left of a turned blank (top = +1: at z, material below)
const hexChamfer = (s, z, top) => { const r0 = 0.47 * s, r1 = s / Math.sqrt(3) + 0.3, dz = (r1 - r0) * T30 * (top ? -1 : 1); return { k: 'rev', pts: [[r0, z], [r1, z], [r1, z + dz]], op: 'cut' }; };
const thread = (z, r, at) => ({ k: 'thread', r, z: at, size: z });
// (z: the size; the hole is the minor diameter and carries the thread)
const nut = (z, s, m, collar = 0) => { const d = core(z); return [
  { k: 'prism', shape: 'hex', s, hole: d / 2, z: 0, dist: m, op: 'new' }, hexChamfer(s, 0, false), ...(collar ? [] : [hexChamfer(s, m, true)]),
  ...(collar ? [{ k: 'rev', pts: [[d / 2, m - 0.01], [0.45 * s, m - 0.01], [0.45 * s, m + collar - 0.15 * collar], [0.45 * s - 0.15 * collar, m + collar], [d / 2, m + collar]], op: 'join' }] : []), thread(z, d / 2, m / 2)]; };
// a dome over a hexagon: quarter circle of radius rd from height z0 up
const dome = (rd, z0, ri) => { const pts = [[ri, z0 - 0.01], [rd, z0 - 0.01]]; for (let i = 0; i <= 8; i++) { const a = (i * Math.PI) / 16; pts.push([rd * Math.cos(a), z0 + rd * Math.sin(a)]); } pts[pts.length - 1][0] = 0; pts.push([0, z0 + 0.75 * rd], [ri, z0 + 0.75 * rd - 0.577 * ri]); return pts; };
const washer = (ri, ro, h) => [{ k: 'rev', pts: [[ri, 0], [ro, 0], [ro, h], [ri, h]], op: 'new' }];
const splitRing = (ri, ro, h, gap) => [...washer(ri, ro, h), { k: 'prism', shape: 'rect', w: ro + 1, h: gap, cx: (ro + 1) / 2, z: -0.5, dist: h + 1, op: 'cut' }];

/**
 * The families. len: the part has a length (default, list of preferred lengths); seat: 'in' – the part reaches
 * into the hole (screws, pins), 'on' – it lies on the face around the hole (nuts, washers, rings), 'mid' – free
 * part, placed at the origin or centred in a bore.
 */
export const STD_FAMILIES = [
  { id: 'iso4762', group: 'Schrauben', name: 'Zylinderschraube mit Innensechskant (ISO 4762)', norm: 'ISO 4762', sizes: () => mSizes('cap'), len: 20, seat: 'in',
    make: (z, L) => { const [dk, k, s, t] = M[z].cap, d = M[z].d, c = 0.08 * dk; return [{ k: 'rev', pts: [...shank(d, L), [dk / 2, 0], [dk / 2, k - c], [dk / 2 - c, k], [0, k]], op: 'new' }, { k: 'prism', shape: 'hex', s, z: k, dist: -t, op: 'cut' }, thread(z, d / 2, -L / 2)]; },
    dims: z => { const [dk, k, s] = M[z].cap; return `d ${M[z].d} · dk ${dk} · k ${k} · SW ${s}`; } },
  { id: 'din7984', group: 'Schrauben', name: 'Zylinderschraube mit niedrigem Kopf (DIN 7984)', norm: 'DIN 7984', sizes: () => mSizes('low'), len: 16, seat: 'in',
    make: (z, L) => { const [dk, k, s] = M[z].low, d = M[z].d, c = 0.08 * dk; return [{ k: 'rev', pts: [...shank(d, L), [dk / 2, 0], [dk / 2, k - c], [dk / 2 - c, k], [0, k]], op: 'new' }, { k: 'prism', shape: 'hex', s, z: k, dist: -0.6 * k, op: 'cut' }, thread(z, d / 2, -L / 2)]; },
    dims: z => { const [dk, k, s] = M[z].low; return `d ${M[z].d} · dk ${dk} · k ${k} · SW ${s}`; } },
  { id: 'iso4017', group: 'Schrauben', name: 'Sechskantschraube (ISO 4017 / ISO 4014)', norm: 'ISO 4017 / ISO 4014', sizes: () => mSizes('hex'), len: 30, seat: 'in',
    make: (z, L) => { const [s, k] = M[z].hex, d = M[z].d; return [{ k: 'prism', shape: 'hex', s, z: 0, dist: k, op: 'new' }, { k: 'rev', pts: [...shank(d, L), [0, 0]], op: 'join' }, hexChamfer(s, k, true), thread(z, d / 2, -L / 2)]; },
    dims: z => `d ${M[z].d} · SW ${M[z].hex[0]} · k ${M[z].hex[1]}` },
  { id: 'iso10642', group: 'Schrauben', name: 'Senkschraube mit Innensechskant (ISO 10642)', norm: 'ISO 10642', sizes: () => mSizes('csk'), len: 20, seat: 'in', lenTotal: true,
    make: (z, L) => { const [dk, k, s] = M[z].csk, d = M[z].d, LL = Math.max(L, k + 1), c = Math.min(0.1 * d, 0.3 * LL); return [{ k: 'rev', pts: [[0, -LL], [d / 2 - c, -LL], [d / 2, -LL + c], [d / 2, -k], [dk / 2, 0], [0, 0]], op: 'new' }, { k: 'prism', shape: 'hex', s, z: 0, dist: -0.6 * k, op: 'cut' }, thread(z, d / 2, -(LL + k) / 2)]; },
    dims: z => { const [dk, k, s] = M[z].csk; return `d ${M[z].d} · dk ${dk} · k ${k} · SW ${s} · 90°`; } },
  { id: 'iso7380', group: 'Schrauben', name: 'Linsenkopfschraube mit Innensechskant (ISO 7380)', norm: 'ISO 7380', sizes: () => mSizes('btn'), len: 16, seat: 'in',
    make: (z, L) => { const [dk, k, s] = M[z].btn, d = M[z].d; return [{ k: 'rev', pts: [...shank(d, L), [dk / 2, 0], [dk / 2, 0.25 * k], [0.42 * dk, 0.7 * k], [0.3 * dk, k], [0, k]], op: 'new' }, { k: 'prism', shape: 'hex', s, z: k, dist: -0.55 * k, op: 'cut' }, thread(z, d / 2, -L / 2)]; },
    dims: z => { const [dk, k, s] = M[z].btn; return `d ${M[z].d} · dk ${dk} · k ${k} · SW ${s}`; } },
  { id: 'iso4026', group: 'Schrauben', name: 'Gewindestift mit Innensechskant (ISO 4026)', norm: 'ISO 4026', sizes: () => mSizes('set'), len: 10, seat: 'in',
    make: (z, L) => { const d = M[z].d, c = Math.min(0.12 * d, 0.3 * L); return [{ k: 'rev', pts: [[0, -L], [d / 2 - c, -L], [d / 2, -L + c], [d / 2, -c], [d / 2 - c, 0], [0, 0]], op: 'new' }, { k: 'prism', shape: 'hex', s: M[z].set, z: 0, dist: -Math.min(0.6 * d, 0.6 * L), op: 'cut' }, thread(z, d / 2, -L / 2)]; },
    dims: z => `d ${M[z].d} · SW ${M[z].set}` },
  { id: 'din976', group: 'Schrauben', name: 'Gewindestange (DIN 976)', norm: 'DIN 976', sizes: () => Object.keys(M), len: 100, seat: 'in',
    make: (z, L) => { const d = M[z].d, c = Math.min(0.1 * d, 0.3 * L); return [{ k: 'rev', pts: [[0, -L], [d / 2 - c, -L], [d / 2, -L + c], [d / 2, -c], [d / 2 - c, 0], [0, 0]], op: 'new' }, thread(z, d / 2, -L / 2)]; },
    dims: z => `d ${M[z].d}` },
  { id: 'iso4032', group: 'Muttern', name: 'Sechskantmutter (ISO 4032)', norm: 'ISO 4032', sizes: () => mSizes('m'), seat: 'on',
    make: z => nut(z, M[z].hex[0], M[z].m), dims: z => `d ${M[z].d} · SW ${M[z].hex[0]} · m ${M[z].m}` },
  { id: 'iso4035', group: 'Muttern', name: 'Sechskantmutter, niedrig (ISO 4035)', norm: 'ISO 4035', sizes: () => mSizes('mt'), seat: 'on',
    make: z => nut(z, M[z].hex[0], M[z].mt), dims: z => `d ${M[z].d} · SW ${M[z].hex[0]} · m ${M[z].mt}` },
  { id: 'iso10511', group: 'Muttern', name: 'Sicherungsmutter mit Klemmteil (ISO 10511 / DIN 985)', norm: 'ISO 10511 / DIN 985', sizes: () => mSizes('ml'), seat: 'on',
    make: z => nut(z, M[z].hex[0], 0.7 * M[z].ml, 0.3 * M[z].ml), dims: z => `d ${M[z].d} · SW ${M[z].hex[0]} · h ${M[z].ml}` },
  { id: 'din1587', group: 'Muttern', name: 'Hutmutter, hohe Form (DIN 1587)', norm: 'DIN 1587', sizes: () => mSizes('cn'), seat: 'on',
    make: z => { const [s, hh] = M[z].cn, d = core(z), rd = 0.45 * s, m = hh - rd; return [{ k: 'prism', shape: 'hex', s, hole: d / 2, z: 0, dist: m, op: 'new' }, hexChamfer(s, 0, false), { k: 'rev', pts: dome(rd, m, d / 2), op: 'join' }, thread(z, d / 2, m / 2)]; },
    dims: z => `d ${M[z].d} · SW ${M[z].cn[0]} · h ${M[z].cn[1]}` },
  { id: 'iso7089', group: 'Scheiben', name: 'Scheibe (ISO 7089)', norm: 'ISO 7089', sizes: () => mSizes('w'), seat: 'on',
    make: z => washer(M[z].w[0] / 2, M[z].w[1] / 2, M[z].w[2]), dims: z => `${M[z].w[0]} × ${M[z].w[1]} × ${M[z].w[2]}` },
  { id: 'iso7092', group: 'Scheiben', name: 'Scheibe, kleine Reihe (ISO 7092)', norm: 'ISO 7092', sizes: () => mSizes('ws'), seat: 'on',
    make: z => washer(M[z].w[0] / 2, M[z].ws[0] / 2, M[z].ws[1]), dims: z => `${M[z].w[0]} × ${M[z].ws[0]} × ${M[z].ws[1]}` },
  { id: 'iso7093', group: 'Scheiben', name: 'Scheibe, große Reihe (ISO 7093)', norm: 'ISO 7093', sizes: () => mSizes('wl'), seat: 'on',
    make: z => washer(M[z].w[0] / 2, M[z].wl[0] / 2, M[z].wl[1]), dims: z => `${M[z].w[0]} × ${M[z].wl[0]} × ${M[z].wl[1]}` },
  { id: 'din127', group: 'Scheiben', name: 'Federring (DIN 127)', norm: 'DIN 127', sizes: () => mSizes('sp'), seat: 'on',
    make: z => splitRing(M[z].sp[0] / 2, M[z].sp[1] / 2, M[z].sp[2], 0.5 * M[z].sp[2]), dims: z => `${M[z].sp[0]} × ${M[z].sp[1]} × ${M[z].sp[2]}` },
  { id: 'iso2338', group: 'Stifte und Passfedern', name: 'Zylinderstift (ISO 2338 / ISO 8734)', norm: 'ISO 2338 / ISO 8734', sizes: () => PINS.map(String), len: 20, seat: 'in',
    make: (z, L) => { const d = +z, c = Math.min(0.15 * d, 0.3 * L); return [{ k: 'rev', pts: [[0, -L], [d / 2 - c, -L], [d / 2, -L + c], [d / 2, -c], [d / 2 - c, 0], [0, 0]], op: 'new' }]; },
    dims: z => `Ø ${z}` },
  { id: 'iso2339', group: 'Stifte und Passfedern', name: 'Kegelstift 1:50 (ISO 2339)', norm: 'ISO 2339', sizes: () => PINS.map(String), len: 30, seat: 'in',
    make: (z, L) => { const d = +z; return [{ k: 'rev', pts: [[0, -L], [d / 2, -L], [d / 2 + L / 100, 0], [0, 0]], op: 'new' }]; },
    dims: z => `Ø ${z} (kleines Ende) · 1:50` },
  { id: 'iso8752', group: 'Stifte und Passfedern', name: 'Spannstift, geschlitzt (ISO 8752)', norm: 'ISO 8752', sizes: () => Object.keys(SPRING), len: 20, seat: 'in',
    make: (z, L) => { const d = +z, s = SPRING[z], ro = d / 2, ri = ro - s, c = Math.min(0.5 * s, 0.2 * L); return [{ k: 'rev', pts: [[ri, -L], [ro - c, -L], [ro, -L + c], [ro, -c], [ro - c, 0], [ri, 0]], op: 'new' }, { k: 'prism', shape: 'rect', w: ro + 1, h: 0.25 * d, cx: (ro + 1) / 2, z: -L - 0.5, dist: L + 1, op: 'cut' }]; },
    dims: z => `Ø ${z} · s ${SPRING[z]}` },
  { id: 'din6885', group: 'Stifte und Passfedern', name: 'Passfeder, Form A (DIN 6885)', norm: 'DIN 6885', sizes: () => Object.keys(KEYS), len: 25, seat: 'mid',
    make: (z, L) => { const [b, hh] = KEYS[z], LL = Math.max(L, b + 0.5); return [{ k: 'prism', shape: 'rect', w: LL, h: b, rr: b / 2, z: 0, dist: hh, op: 'new' }]; },
    dims: z => `b ${KEYS[z][0]} · h ${KEYS[z][1]}` },
  { id: 'din6885b', group: 'Stifte und Passfedern', name: 'Passfeder, Form B (DIN 6885)', norm: 'DIN 6885', sizes: () => Object.keys(KEYS), len: 25, seat: 'mid',
    make: (z, L) => { const [b, hh] = KEYS[z]; return [{ k: 'prism', shape: 'rect', w: Math.max(L, 1), h: b, z: 0, dist: hh, op: 'new' }]; },
    dims: z => `b ${KEYS[z][0]} · h ${KEYS[z][1]}` },
  { id: 'din471', group: 'Sicherungsringe', name: 'Sicherungsring für Wellen (DIN 471)', norm: 'DIN 471', sizes: () => Object.keys(RING_SHAFT), seat: 'mid',
    make: z => { const [s, d3, b] = RING_SHAFT[z]; return splitRing(d3 / 2, d3 / 2 + b, s, 0.25 * d3); },
    dims: z => `Welle Ø ${z} · s ${RING_SHAFT[z][0]}` },
  { id: 'din472', group: 'Sicherungsringe', name: 'Sicherungsring für Bohrungen (DIN 472)', norm: 'DIN 472', sizes: () => Object.keys(RING_BORE), seat: 'mid',
    make: z => { const [s, d3, b] = RING_BORE[z]; return splitRing(d3 / 2 - b, d3 / 2, s, 0.25 * d3); },
    dims: z => `Bohrung Ø ${z} · s ${RING_BORE[z][0]}` },
  { id: 'din625', group: 'Lager und Dichtungen', name: 'Rillenkugellager (DIN 625)', norm: 'DIN 625', sizes: () => Object.keys(BEARINGS), seat: 'mid',
    make: z => {
      const [d, D, B] = BEARINGS[z], ri = d / 2, ro = D / 2, w = ro - ri, c = Math.min(0.06 * w + 0.15, 0.2 * B), g = Math.min(0.08 * B, 0.6), a = ri + 0.3 * w, b = ri + 0.7 * w;
      return [{ k: 'rev', pts: [[ri + c, 0], [ro - c, 0], [ro, c], [ro, B - c], [ro - c, B], [ri + c, B], [ri, B - c], [ri, c]], op: 'new' },
        { k: 'rev', pts: [[a, -0.01], [b, -0.01], [b, g], [a, g]], op: 'cut' }, { k: 'rev', pts: [[a, B - g], [b, B - g], [b, B + 0.01], [a, B + 0.01]], op: 'cut' }];
    },
    dims: z => `${BEARINGS[z][0]} × ${BEARINGS[z][1]} × ${BEARINGS[z][2]}` },
  { id: 'din3760', group: 'Lager und Dichtungen', name: 'Wellendichtring (DIN 3760)', norm: 'DIN 3760', sizes: () => Object.keys(SEALS), seat: 'mid',
    make: z => { const [d, D, b] = SEALS[z], ri = d / 2, ro = D / 2, w = 0.25 * (ro - ri); return [{ k: 'rev', pts: [[ri, 0], [ro, 0], [ro, b], [ro - w, b], [ro - w, 0.35 * b], [ri + w, 0.35 * b], [ri + w, b], [ri, b]], op: 'new' }]; },
    dims: z => `${SEALS[z][0]} × ${SEALS[z][1]} × ${SEALS[z][2]}` },
  { id: 'iso3601', group: 'Lager und Dichtungen', name: 'O-Ring (ISO 3601)', norm: 'ISO 3601', sizes: () => Object.keys(ORINGS), seat: 'mid',
    make: z => { const [di, cs] = ORINGS[z]; return [{ k: 'ring', r: di / 2 + cs / 2, z: cs / 2, rad: cs / 2, op: 'new' }]; },
    dims: z => `Ø innen ${ORINGS[z][0]} · Schnur ${ORINGS[z][1]}` },
];

export const stdFamily = id => STD_FAMILIES.find(f => f.id === id);
// preferred lengths of screws and pins
export const STD_LENGTHS = [4, 5, 6, 8, 10, 12, 16, 20, 25, 30, 35, 40, 45, 50, 60, 70, 80, 90, 100, 120, 140, 160, 200];

/** The metric thread that goes through a clearance hole of this diameter (the largest that passes without rattling), or null. */
export function boltSizeFor(dia, famId = 'iso4762') {
  const fam = stdFamily(famId), ok = (fam ? fam.sizes() : []).filter(z => M[z] && M[z].d <= dia + 1e-6 && dia <= 1.3 * M[z].d + 0.3);
  return ok.length ? ok[ok.length - 1] : null;
}

// clearance holes ISO 273 (medium series) and the counterbores for cap screws DIN 974-1 (series 1), by thread
const HOLES = { M3: [3.4, 6.5], M4: [4.5, 8], M5: [5.5, 10], M6: [6.6, 11], M8: [9, 15], M10: [11, 18], M12: [13.5, 20], M16: [17.5, 26], M20: [22, 33], M24: [26, 40] };

/**
 * The hole a screw goes through: { dia, kind: 'simple' | 'cbore' | 'csink', cbDia, cbDepth, csDia, csAngle, seat }.
 * A countersunk screw gets its 90° countersink (head flush); a cap screw – on request (sink) – a counterbore as
 * deep as its head. seat: how far below the surface the head rests.
 */
export function boltHole(famId, size, sink = false) {
  const fam = stdFamily(famId), z = String(size), hl = HOLES[z];
  if (!fam || !M[z]) throw new Error('Diese Größe gibt es in der Norm nicht');
  if (!hl) throw new Error(`Für ${z} ist keine Durchgangsbohrung hinterlegt`);
  const out = { dia: hl[0], kind: 'simple', cbDia: hl[1], cbDepth: 0, csDia: 2 * hl[0], csAngle: 90, seat: 0 };
  if (fam.lenTotal && M[z].csk) return { ...out, kind: 'csink', csDia: M[z].csk[0] };
  if (sink && (famId === 'iso4762' || famId === 'din7984')) { const s = stdPartSteps(famId, z, 0), k = +s.z1.toFixed(3); return { ...out, kind: 'cbore', cbDepth: k, seat: k }; }
  return out;
}

/**
 * A bolted joint through a hole: screw, washer under the head, washer and nut on the far side. clamp: thickness
 * of the clamped parts. o: { headWasher, nut, nutWasher } – family ids or ''. Returns the heights of the pieces
 * and the preferred length that lets the screw look two pitches out of the nut: { len, need, hw, nw, m }.
 * (A countersunk screw has its head in the part: no washer under it, its length counts from the top of the head.)
 */
export function boltStack(famId, size, clamp, o = {}) {
  const fam = stdFamily(famId), z = String(size);
  if (!fam || !M[z]) throw new Error('Diese Größe gibt es in der Norm nicht');
  const hgt = id => { if (!id) return 0; const s = stdPartSteps(id, z, 0); return s.z1 - s.z0; };
  const hw = fam.lenTotal ? 0 : hgt(o.headWasher), nw = o.nut ? hgt(o.nutWasher) : 0, m = hgt(o.nut);
  const need = hw + clamp + nw + m + (o.nut ? 2 * PITCH[z] : 0);
  const len = STD_LENGTHS.find(q => q >= need - 1e-9) ?? Math.ceil(need);
  return { len, need, hw, nw, m };
}

/** Short name of a part, e.g. "ISO 4762 M6×20". */
export function stdPartName(fam, size, len) {
  const norm = fam.norm.split(' / ')[0] + (fam.id === 'din6885b' ? ' B' : '');
  return fam.len ? `${norm} ${size}×${len}` : `${norm} ${size}`;
}

/** The steps of a part and its extent along the axis: { steps, z0, z1, rmax }. */
export function stdPartSteps(famId, size, len) {
  const fam = stdFamily(famId);
  if (!fam) throw new Error('Normteil unbekannt');
  if (!fam.sizes().includes(String(size))) throw new Error('Diese Größe gibt es in der Norm nicht');
  const L = fam.len ? Math.max(1, +len || fam.len) : 0;
  const steps = fam.make(String(size), L);
  let z0 = Infinity, z1 = -Infinity, rmax = 0;
  for (const s of steps) {
    if (s.op === 'cut' || s.k === 'thread') continue;
    if (s.k === 'rev') for (const [r, z] of s.pts) { z0 = Math.min(z0, z); z1 = Math.max(z1, z); rmax = Math.max(rmax, r); }
    else if (s.k === 'ring') { z0 = Math.min(z0, s.z - s.rad); z1 = Math.max(z1, s.z + s.rad); rmax = Math.max(rmax, s.r + s.rad); }
    else { z0 = Math.min(z0, s.z, s.z + s.dist); z1 = Math.max(z1, s.z, s.z + s.dist); rmax = Math.max(rmax, s.shape === 'hex' ? s.s / Math.sqrt(3) : s.shape === 'rect' ? Math.hypot(s.w, s.h) / 2 + Math.abs(s.cx || 0) : s.r); }
  }
  return { steps, z0, z1, rmax, fam, L };
}

/** Volume of a part in mm³ from its steps (prisms and turned outlines; cuts taken off; the chamfer of a hexagon counts as a whole ring, so nuts come out a little light) – for the tests. */
export function stdPartVolume(steps) {
  let v = 0;
  for (const s of steps) {
    if (s.k === 'thread') continue;
    let q = 0;
    if (s.k === 'rev') { // Pappus: area × path of the centroid
      let a = 0, cx = 0;
      for (let i = 0; i < s.pts.length; i++) { const p = s.pts[i], n = s.pts[(i + 1) % s.pts.length], w = p[0] * n[1] - n[0] * p[1]; a += w; cx += (p[0] + n[0]) * w; }
      q = Math.abs((cx / 6) * 2 * Math.PI);
    } else if (s.k === 'ring') q = Math.PI * s.rad * s.rad * 2 * Math.PI * s.r;
    else {
      const area = s.shape === 'hex' ? (Math.sqrt(3) / 2) * s.s * s.s : s.shape === 'rect' ? s.w * s.h - (4 - Math.PI) * (s.rr || 0) ** 2 : Math.PI * s.r * s.r;
      q = (area - (s.hole ? Math.PI * s.hole * s.hole : 0)) * Math.abs(s.dist);
    }
    v += s.op === 'cut' ? -q : q;
  }
  return v;
}
