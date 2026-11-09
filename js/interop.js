// Data exchange: STEP/IGES geometry, tool libraries (Fusion 360 / HSM, CSV) and
// Fusion .cps post-processors (converted into an editable OpenFab template).
import { R } from './kernel.js';
import { BUILTIN_POSTS, copyPost } from './post.js';

// ---------- imported files (kept in IndexedDB, too big for localStorage) ----------
const mem = new Map();
const DB = 'openfab.blobs', STORE = 'blobs';
const idb = () => new Promise((res, rej) => {
  const r = indexedDB.open(DB, 1);
  r.onupgradeneeded = () => r.result.createObjectStore(STORE);
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

async function hashText(text) {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return 'b' + [...new Uint8Array(d)].slice(0, 12).map(x => x.toString(16).padStart(2, '0')).join('');
}

export async function putBlob(text) {
  const key = await hashText(text);
  mem.set(key, text);
  try {
    const db = await idb();
    await new Promise((res, rej) => { const tx = db.transaction(STORE, 'readwrite'); tx.objectStore(STORE).put(text, key); tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
  } catch (err) { console.warn('IndexedDB nicht verfügbar – Import nur bis zum Neuladen gespeichert', err); }
  return key;
}

export const getBlob = key => mem.get(key);

// Loads the stored files a project refers to (call before the first rebuild).
export async function loadBlobs(project) {
  const keys = blobKeys(project).filter(k => !mem.has(k));
  if (!keys.length) return;
  try {
    const db = await idb();
    await Promise.all(keys.map(k => new Promise(res => {
      const r = db.transaction(STORE).objectStore(STORE).get(k);
      r.onsuccess = () => { if (r.result) mem.set(k, r.result); res(); };
      r.onerror = () => res();
    })));
  } catch { /* no IndexedDB */ }
}

const blobKeys = project => (project.features || []).filter(f => ['import', 'meshimport', 'canvas', 'decal'].includes(f.type) && f.blob).map(f => f.blob);

// .ofab files carry the imported files inline so they open anywhere.
export function withBlobs(project) {
  const blobs = {};
  for (const k of blobKeys(project)) if (mem.has(k)) blobs[k] = mem.get(k);
  return { ...project, blobs };
}
export async function takeBlobs(p) {
  for (const text of Object.values(p.blobs || {})) await putBlob(text);
  delete p.blobs;
  return p;
}

// ---------- STEP / IGES ----------
// IGES needs the full OpenCascade build (66 MB); it is loaded only when used and
// talks to the main kernel through STEP text.
const FULL_OC = new URL('../vendor/opencascade-full/opencascade.wasm.js', import.meta.url).href;
const FULL_WASM = new URL('../vendor/opencascade-full/opencascade.wasm.wasm', import.meta.url).href;
let fullOC = null;
async function loadFullOC() {
  if (!fullOC) fullOC = import(FULL_OC).then(m => new m.default({ locateFile: () => FULL_WASM }));
  return fullOC;
}

export async function igesToStep(igesText) {
  const oc = await loadFullOC();
  oc.FS.writeFile('/in.igs', igesText);
  const rd = new oc.IGESControl_Reader_1();
  if (rd.ReadFile('/in.igs').value !== 1) throw new Error('IGES-Datei konnte nicht gelesen werden');
  rd.TransferRoots();
  const sh = rd.OneShape();
  if (sh.IsNull()) throw new Error('Keine Geometrie in der IGES-Datei');
  // loose IGES faces: try to sew them into closed solids
  let out = sh;
  try {
    const sew = new oc.BRepBuilderAPI_Sewing(0.01, true, true, true, false);
    sew.Add(sh);
    sew.Perform(new oc.Handle_Message_ProgressIndicator_1());
    out = sew.SewedShape();
    const mk = new oc.TopExp_Explorer_2(out, oc.TopAbs_ShapeEnum.TopAbs_SHELL, oc.TopAbs_ShapeEnum.TopAbs_SOLID);
    const solids = new oc.BRep_Builder(), comp = new oc.TopoDS_Compound();
    solids.MakeCompound(comp);
    let any = false;
    for (; mk.More(); mk.Next()) {
      const ms = new oc.BRepBuilderAPI_MakeSolid_3(oc.TopoDS.Shell_1(mk.Current()));
      if (ms.IsDone()) { solids.Add(comp, ms.Solid()); any = true; }
    }
    const ex = new oc.TopExp_Explorer_2(out, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) { solids.Add(comp, ex.Current()); any = true; }
    if (any) out = comp;
  } catch { out = sh; }
  const w = new oc.STEPControl_Writer_1();
  w.Transfer(out, oc.STEPControl_StepModelType.STEPControl_AsIs, true);
  w.Write('/out.step');
  return oc.FS.readFile('/out.step', { encoding: 'utf8' });
}

export async function stepToIges(stepText) {
  const oc = await loadFullOC();
  oc.FS.writeFile('/x.step', stepText);
  const rd = new oc.STEPControl_Reader_1();
  rd.ReadFile('/x.step');
  rd.TransferRoots();
  const w = new oc.IGESControl_Writer_2('MM', 1); // 1 = B-rep solids (MSBO)
  w.AddShape(rd.OneShape());
  w.ComputeModel();
  w.Write_2('/x.igs', false);
  return oc.FS.readFile('/x.igs', { encoding: 'utf8' });
}

// Synchronous read with the main kernel (used while rebuilding the history).
const solidCache = new Map();
export function stepSolids(key) {
  if (solidCache.has(key)) return solidCache.get(key).map(s => s.clone());
  const text = getBlob(key);
  if (!text) throw new Error('Importdatei fehlt – Projekt mit eingebetteter Datei (.ofab) öffnen');
  const oc = R.getOC();
  const fn = `imp_${key}.step`;
  oc.FS.writeFile('/' + fn, text);
  const rd = new oc.STEPControl_Reader();
  try {
    if (rd.ReadFile(fn) !== oc.IFSelect_ReturnStatus.IFSelect_RetDone) throw new Error('STEP-Datei unlesbar');
    rd.TransferRoots();
    const sh = rd.OneShape();
    const list = [];
    const ex = new oc.TopExp_Explorer(sh, oc.TopAbs_ShapeEnum.TopAbs_SOLID, oc.TopAbs_ShapeEnum.TopAbs_SHAPE);
    for (; ex.More(); ex.Next()) list.push(R.cast(ex.Current()));
    if (!list.length) {
      // surfaces only: keep them as one (non-solid) body
      const s = R.cast(sh);
      if (!s || s.isNull) throw new Error('Keine Geometrie in der Datei');
      list.push(s);
    }
    solidCache.set(key, list);
    return list.map(s => s.clone());
  } finally {
    try { oc.FS.unlink('/' + fn); } catch { /* ignore */ }
  }
}

// ---------- zip (Fusion .tools files are zipped JSON) ----------
async function unzipFirst(buf, pred) {
  const v = new DataView(buf);
  let eocd = -1;
  for (let i = buf.byteLength - 22; i >= Math.max(0, buf.byteLength - 65557); i--) if (v.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Keine gültige ZIP-Datei');
  let p = v.getUint32(eocd + 16, true);
  const n = v.getUint16(eocd + 10, true);
  for (let k = 0; k < n; k++) {
    const method = v.getUint16(p + 10, true), csize = v.getUint32(p + 20, true);
    const nlen = v.getUint16(p + 28, true), xlen = v.getUint16(p + 30, true), clen = v.getUint16(p + 32, true);
    const off = v.getUint32(p + 42, true);
    const name = new TextDecoder().decode(new Uint8Array(buf, p + 46, nlen));
    p += 46 + nlen + xlen + clen;
    if (!pred(name)) continue;
    const start = off + 30 + v.getUint16(off + 26, true) + v.getUint16(off + 28, true);
    const data = new Uint8Array(buf, start, csize);
    if (method === 0) return new TextDecoder().decode(data);
    if (method !== 8) throw new Error('ZIP-Kompression nicht unterstützt');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return await new Response(stream).text();
  }
  throw new Error('Keine Werkzeugdaten in der ZIP-Datei');
}

// ---------- tool libraries ----------
const num = v => {
  if (v == null || v === '') return NaN;
  if (typeof v === 'number') return v;
  return parseFloat(String(v).replace(',', '.'));
};
const r3 = v => Math.round(v * 1000) / 1000;

// Fusion 360 / HSM tool type -> OpenFab tool type (null = not usable here)
function mapType(raw) {
  const s = String(raw || '').toLowerCase();
  if (/probe|taster/.test(s)) return 'probe';
  if (/holder|halter/.test(s)) return null;
  if (/turning.*groov|grooving|stech/.test(s)) return 'groove';
  if (/turning.*thread|gewindedreh/.test(s)) return 'tthread';
  if (/turning|dreh/.test(s)) return /boring/.test(s) ? null : 'turn';
  if (/^tap|tap |tapping|gewindebohr/.test(s)) return 'tap';
  if (/thread|gewindefr/.test(s)) return 'thread';
  if (/ream|reib/.test(s)) return 'ream';
  if (/spot|center drill|zentrier|drill|bohrer/.test(s)) return 'drill';
  if (/ball|lollipop|kugel|radius mill/.test(s)) return 'ball';
  if (/chamfer|counter ?sink|engrav|dovetail|tapered|fase|senk|gravier|v-bit|v-fr/.test(s)) return 'chamfer';
  if (/boring bar|counter ?bore|ausdreh/.test(s)) return null;
  if (/bull ?nose|torus/.test(s)) return 'torus';
  if (/face ?mill|planfr/.test(s)) return 'facemill';
  return 'flat';
}

const TYPE_LABEL = { probe: '3D-Taster', torus: 'Torusfräser', facemill: 'Planfräser', flat: 'Schaftfräser', ball: 'Kugelfräser', chamfer: 'Fasenfräser', drill: 'Bohrer', tap: 'Gewindebohrer', ream: 'Reibahle', thread: 'Gewindefräser', turn: 'Drehmeißel', groove: 'Stechmeißel', tthread: 'Gewindedrehmeißel' };

function finishTool(t, raw) {
  const type = t.type;
  const dia = r3(t.dia);
  // missing cutting data: carbide guide values from the diameter (vc in m/min, feed per tooth/rev)
  if (!(t.rpm > 0) && !['turn', 'groove', 'tthread'].includes(type)) {
    const vc = { drill: 70, tap: 10, ream: 15, thread: 120 }[type] || 150;
    t.rpm = Math.min(24000, (vc * 1000) / (Math.PI * dia));
  } else if (!(t.rpm > 0)) t.rpm = 1500;
  if (!(t.feed > 0) && type !== 'tap') {
    const per = ['drill', 'ream'].includes(type) ? Math.min(0.3, 0.02 * dia) : Math.min(0.1, Math.max(0.01, 0.008 * dia)) * (t.flutes > 0 ? t.flutes : 2);
    t.feed = ['turn', 'groove', 'tthread'].includes(type) ? 0.15 * t.rpm : per * t.rpm;
  }
  const tool = {
    number: Math.max(1, Math.round(t.number || 1)),
    name: (t.name || `${TYPE_LABEL[type]} Ø${dia}`).trim().slice(0, 60),
    type, dia,
    flutes: t.flutes > 0 ? Math.round(t.flutes) : 2,
    rpm: t.rpm > 0 ? Math.round(t.rpm) : type === 'tap' ? 400 : 10000,
    feed: t.feed > 0 ? Math.round(t.feed) : 500,
    plunge: Math.round(t.plunge > 0 ? t.plunge : ['drill', 'ream'].includes(type) ? t.feed : t.feed / 3),
    stepdown: t.stepdown > 0 ? r3(t.stepdown) : r3(Math.max(0.2, dia * 0.25)),
    stepover: t.stepover > 0 && t.stepover < 1 ? t.stepover : type === 'ball' ? 0.1 : 0.4,
  };
  if (t.fluteLen > 0) tool.fluteLen = r3(t.fluteLen);
  if (t.holderDia > 0) tool.holderDia = r3(t.holderDia);
  if (t.stickout > 0) tool.stickout = r3(t.stickout);
  if (t.cornerR > 0) tool.cornerR = r3(t.cornerR);
  if (type === 'chamfer') { tool.angle = t.angle > 0 ? r3(t.angle) : 90; tool.tip = t.tip > 0 ? r3(t.tip) : 0; }
  if (type === 'drill') tool.angle = t.angle > 0 ? r3(t.angle) : 118;
  if (type === 'tap' || type === 'thread' || type === 'tthread') tool.pitch = t.pitch > 0 ? r3(t.pitch) : type === 'tap' ? 1 : 1.5;
  if (type === 'tap' && t.left) tool.hand = 'left';
  if (type === 'turn') tool.noseRadius = t.cornerR > 0 ? r3(t.cornerR) : 0.4;
  if (type === 'groove') tool.width = t.width > 0 ? r3(t.width) : dia;
  if (type === 'tap') tool.feed = tool.plunge = r3(tool.rpm * tool.pitch);
  // descriptive data like in Fusion's tool library
  for (const k of ['vendor', 'productId', 'productLink', 'material', 'coolant']) if (t[k]) tool[k] = String(t[k]).slice(0, 120);
  for (const k of ['length', 'shaftDia', 'shoulderLen']) if (t[k] > 0) tool[k] = r3(t[k]);
  if (t.cw === false) tool.cw = false;
  if (Array.isArray(t.presets) && t.presets.length) tool.presets = t.presets;
  if (type === 'flat' && t.cornerR > 0 && t.cornerR < dia / 2 - 1e-6) tool.type = 'torus';
  if (type === 'probe') { tool.rpm = 0; tool.feed = tool.plunge = Math.round(t.feed > 0 ? t.feed : 300); }
  if (raw) tool.source = raw;
  return tool;
}

const coolMap = c => ({ flood: 'flood', mist: 'mist', air: 'air', 'air through tool': 'airThrough', 'through tool': 'through', 'flood and through tool': 'through', 'flood and mist': 'flood', disabled: 'off', off: 'off' })[String(c || '').toLowerCase()] || undefined;

// Fusion 360 / HSM JSON: { data: [ { type, description, geometry: { DC, NOF, ... }, ... } ] }
function fromFusionJson(j) {
  const list = Array.isArray(j) ? j : j.data || j.tools || [];
  const out = [], skipped = [];
  for (const x of list) {
    if (!x || typeof x !== 'object') continue;
    // already OpenFab format
    if (typeof x.dia === 'number' && x.type && !x.geometry) { out.push(finishTool({ ...x, number: x.number })); continue; }
    const type = mapType(x.type);
    const label = x.description || x.type || '?';
    if (!type) { skipped.push(label); continue; }
    const g = x.geometry || {}, pp = x['post-process'] || {}, preset = x['start-values']?.presets?.[0] || {};
    const k = /inch/i.test(x.unit || '') ? 25.4 : 1;
    const seg = x.holder?.segments?.[0];
    const half = num(g.TA);
    const t = {
      type, number: num(pp.number), name: x.description || [x.vendor, x['product-id']].filter(Boolean).join(' '),
      dia: num(g.DC) * k, flutes: num(g.NOF), fluteLen: num(g.LCF) * k, stickout: num(g.LB) * k, cornerR: num(g.RE) * k,
      holderDia: num(seg?.['lower-diameter']) * k,
      // chamfer mills store the half angle (TA = 45 for a 90° tool); drills the point angle SIG
      angle: type === 'chamfer' ? (half > 0 ? 2 * half : num(g.SIG)) : num(g.SIG),
      tip: num(g['tip-diameter']) * k, pitch: num(g.TP) * k, left: /left/i.test(x.type) || g.HAND === false,
      width: num(g.CW ?? g.width) * k,
      rpm: num(preset.n), feed: num(preset.v_f) * k, plunge: num(preset.v_f_plunge) * k,
      stepdown: num(preset.stepdown) * k, stepover: num(preset.stepover) * k / (num(g.DC) * k),
      vendor: x.vendor, productId: x['product-id'], productLink: x['product-link'], material: x.BMC,
      length: num(g.OAL) * k, shaftDia: num(g.SFDM) * k, shoulderLen: num(g['shoulder-length']) * k, cw: g.CSP !== false && g.HAND !== false,
      coolant: coolMap(preset['tool-coolant']),
      // further cutting data presets
      presets: (x['start-values']?.presets || []).slice(1).map((q, i) => ({ id: 'p' + i, name: q.name || `Vorgabe ${i + 2}`, rpm: num(q.n), feed: num(q.v_f) * k, plunge: num(q.v_f_plunge) * k, leadIn: num(q.v_f_leadIn) * k, leadOut: num(q.v_f_leadOut) * k, coolant: coolMap(q['tool-coolant']) })).filter(q => q.rpm > 0 || q.feed > 0),
    };
    if (!(t.dia > 0)) { skipped.push(label); continue; }
    out.push(finishTool(t, 'Fusion 360'));
  }
  return { tools: out, skipped };
}

// HSMWorks / Inventor CAM .hsmlib (XML)
function fromHsmlib(text) {
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.querySelector('parsererror')) throw new Error('Ungültige XML-Datei');
  const out = [], skipped = [];
  for (const el of doc.querySelectorAll('tool')) {
    const type = mapType(el.getAttribute('type'));
    const desc = el.querySelector('description')?.textContent || el.getAttribute('type');
    if (!type) { skipped.push(desc); continue; }
    const a = (sel, name) => num(el.querySelector(sel)?.getAttribute(name));
    const k = /inch/i.test(el.getAttribute('unit') || '') ? 25.4 : 1;
    const ta = a('body', 'taper-angle');
    const t = {
      type, number: a('nc', 'number'), name: desc,
      dia: a('body', 'diameter') * k, flutes: a('body', 'number-of-flutes'), fluteLen: a('body', 'flute-length') * k,
      stickout: a('body', 'body-length') * k, cornerR: a('body', 'corner-radius') * k,
      angle: type === 'chamfer' ? (ta > 0 ? 2 * ta : NaN) : a('body', 'point-angle') || a('body', 'tip-angle'),
      tip: a('body', 'tip-diameter') * k, pitch: a('body', 'thread-pitch') * k, left: /left/i.test(el.getAttribute('type')),
      rpm: a('motion', 'spindle-rpm'), feed: a('motion', 'cutting-feedrate') * k, plunge: a('motion', 'plunge-feedrate') * k,
    };
    if (!(t.dia > 0)) { skipped.push(desc); continue; }
    out.push(finishTool(t, 'HSM'));
  }
  return { tools: out, skipped };
}

// CSV / tab separated tables (e.g. exported from SolidWorks CAM, Excel or a tool shop)
const CSV_COLS = [
  ['number', /^(t|nr\.?|no\.?|#|nummer|number|tool ?(no|nr|number|#)|werkzeug ?(nr|nummer)|wz ?nr|platz|pocket|station)$/],
  ['plunge', /eintauch|plunge|z-?vorschub|vf.?plunge/],
  ['fluteLen', /schneidenl|flute ?len|lcf|cut(ting)? ?len|nutzl/],
  ['flutes', /schneiden(zahl|anzahl)?$|flutes|^z$|^nof$|z(ä|ae)hne|teeth/],
  ['holderDia', /halter/],
  ['stickout', /auskrag|stick ?out|ausspann|^lb$/],
  ['cornerR', /ecken ?radius|corner|^re$|^r$/],
  ['pitch', /steigung|pitch/],
  ['angle', /winkel|angle|spitze/],
  ['dia', /durchmesser|diameter|^dia\.?$|^d$|^dc$|^ø|ø$|^d ?\(mm\)$/],
  ['rpm', /drehzahl|rpm|spindle|^s$|^n$|u\/min|1\/min/],
  ['feed', /vorschub|feed|^f$|^vf$|mm\/min/],
  ['type', /^(typ|type|art|werkzeugtyp|tool ?type|kategorie|category)$/],
  ['name', /name|bezeichnung|beschreibung|description|comment|kommentar|werkzeug$|tool$/],
];

function splitCsvLine(line, d) {
  const out = [];
  let cur = '', q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) { if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; } else if (c === '"') q = false; else cur += c; }
    else if (c === '"') q = true;
    else if (c === d) { out.push(cur.trim()); cur = ''; }
    else cur += c;
  }
  out.push(cur.trim());
  return out;
}

function fromCsv(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) throw new Error('Tabelle ohne Daten');
  const d = ['\t', ';', ','].map(c => [c, lines[0].split(c).length]).sort((a, b) => b[1] - a[1])[0][0];
  const head = splitCsvLine(lines[0], d).map(s => s.toLowerCase().replace(/\s*\[.*?\]|\s*\(.*?\)/g, '').trim());
  const col = {};
  head.forEach((hname, i) => {
    for (const [key, re] of CSV_COLS) if (col[key] == null && re.test(hname)) { col[key] = i; break; }
  });
  if (col.dia == null) throw new Error('Keine Spalte „Durchmesser“ gefunden. Erkannte Spalten: ' + head.join(', '));
  const out = [], skipped = [];
  for (const line of lines.slice(1)) {
    const c = splitCsvLine(line, d);
    const g = key => (col[key] == null ? undefined : c[col[key]]);
    const typeText = `${g('type') || ''} ${g('name') || ''}`;
    const type = mapType(typeText);
    if (!type) { skipped.push(g('name') || typeText.trim()); continue; }
    const t = {
      type, number: num(g('number')), name: g('name'), dia: num(g('dia')), flutes: num(g('flutes')), fluteLen: num(g('fluteLen')),
      holderDia: num(g('holderDia')), stickout: num(g('stickout')), cornerR: num(g('cornerR')), pitch: num(g('pitch')), angle: num(g('angle')),
      rpm: num(g('rpm')), feed: num(g('feed')), plunge: num(g('plunge')), left: /links|left|lh/i.test(typeText),
    };
    if (!(t.dia > 0)) { skipped.push(g('name') || line.slice(0, 30)); continue; }
    out.push(finishTool(t, 'CSV'));
  }
  return { tools: out, skipped };
}

// Returns { tools: [...without id], skipped: [names], format }
export async function parseToolLibrary(file) {
  const name = file.name.toLowerCase();
  const buf = await file.arrayBuffer();
  const isZip = new Uint8Array(buf, 0, 2).every((b, i) => b === [0x50, 0x4b][i]);
  if (isZip) {
    const text = await unzipFirst(buf, n => /\.json$/i.test(n) || !n.includes('.'));
    return { ...fromFusionJson(JSON.parse(text)), format: 'Fusion 360 (.tools)' };
  }
  const text = new TextDecoder().decode(buf);
  const t = text.trimStart();
  if (t.startsWith('{') || t.startsWith('[')) return { ...fromFusionJson(JSON.parse(text)), format: name.endsWith('.json') ? 'JSON (Fusion 360 / OpenFab)' : 'JSON' };
  if (t.startsWith('<')) return { ...fromHsmlib(text), format: 'HSMWorks / Inventor CAM (.hsmlib)' };
  return { ...fromCsv(text), format: 'Tabelle (CSV)' };
}

// ---------- Fusion 360 / HSM .cps post-processors ----------
// A .cps file is a JavaScript program for Autodesk's post engine. It is not
// executed here; its settings are read and mapped onto the closest built-in
// template, which can then be refined in the post editor.
function block(text, start) {
  const i = text.search(start);
  if (i < 0) return '';
  const b = text.indexOf('{', i);
  if (b < 0) return '';
  let depth = 0;
  for (let k = b; k < text.length; k++) {
    if (text[k] === '{') depth++;
    else if (text[k] === '}' && --depth === 0) return text.slice(b + 1, k);
  }
  return '';
}

function cpsProperties(text) {
  const body = block(text, /\bproperties\s*=\s*\{/);
  const props = {};
  const val = s => {
    s = s.trim().replace(/,$/, '');
    if (/^(true|false)$/.test(s)) return s === 'true';
    if (/^-?\d+(\.\d+)?$/.test(s)) return +s;
    const m = s.match(/^["'](.*)["']$/);
    return m ? m[1] : s;
  };
  // new style:  name: { title: ..., value: X, ... }
  for (const m of body.matchAll(/(\w+)\s*:\s*\{([^{}]*(?:\{[^{}]*\}[^{}]*)*)\}/g)) {
    const v = m[2].match(/\bvalue\s*:\s*("[^"]*"|'[^']*'|[^,\n}]+)/);
    if (v) props[m[1]] = val(v[1]);
  }
  // old style:  name: X,
  for (const m of body.matchAll(/^\s*(\w+)\s*:\s*("[^"]*"|'[^']*'|true|false|-?\d+(?:\.\d+)?)\s*,?\s*(\/\/.*)?$/gm)) if (!(m[1] in props)) props[m[1]] = val(m[2]);
  return props;
}

export function convertCps(text, fileName = 'post.cps') {
  const str = re => text.match(re)?.[1];
  const description = str(/\bdescription\s*=\s*"([^"]*)"/) || str(/\bdescription\s*=\s*'([^']*)'/) || fileName.replace(/\.cps$/i, '');
  const vendor = str(/\bvendor\s*=\s*"([^"]*)"/) || '';
  const ext = str(/\bextension\s*=\s*"([^"]*)"/) || 'nc';
  const lathe = /CAPABILITY_TURNING/.test(text.match(/\bcapabilities\s*=([^;]*);/)?.[1] || '') || /turning|lathe|drehen/i.test(description);
  const hay = `${vendor} ${description} ${fileName}`.toLowerCase();
  const baseId = /heidenhain|tnc/.test(hay) ? 'heidenhain'
    : /siemens|sinumerik|840d|828d/.test(hay) ? 'sinumerik'
    : /grbl/.test(hay) ? 'grbl'
    : /linuxcnc|emc2?\b|mach ?3|mach ?4/.test(hay) ? (lathe ? 'linuxcnc-lathe' : 'linuxcnc')
    : lathe ? 'fanuc-lathe' : 'fanuc';
  const base = BUILTIN_POSTS.find(p => p.id === baseId);
  const def = copyPost(base, null, description);
  const report = [`Grundlage: ${base.name} (aus Hersteller/Beschreibung „${[vendor, description].filter(Boolean).join(' – ')}“)`];
  def.ext = ext.replace(/^\./, '');
  report.push(`Dateiendung: .${def.ext}`);
  if (baseId === 'heidenhain') return { def, report: [...report, 'Klartext-Steuerung: Satzaufbau aus der OpenFab-Vorlage übernommen.'] };

  // comments
  const fc = block(text, /function\s+formatComment\s*\(/);
  if (/["']\s*;\s*["']|["'];\s?["']/.test(fc) || /";\s*"\s*\+/.test(fc)) { def.comment = '; {text}'; report.push('Kommentare: ; Text'); }
  else if (/["']\(["']/.test(fc)) { def.comment = '({text})'; report.push('Kommentare: (Text)'); }

  // number format
  const xyz = text.match(/\bxyzFormat\s*=\s*createFormat\(\s*\{([^}]*)\}/)?.[1] || '';
  const dec = xyz.match(/decimals\s*:\s*\(?\s*unit\s*==\s*MM\s*\?\s*(\d)/) || xyz.match(/decimals\s*:\s*(\d)/);
  if (dec) { def.decimals = +dec[1]; report.push(`Nachkommastellen: ${def.decimals}`); }
  if (/forceDecimal\s*:\s*true/.test(xyz)) { def.decimalPoint = true; report.push('Dezimalpunkt immer schreiben (X10.)'); }
  if (/forceSign\s*:\s*true/.test(xyz)) def.signed = true;

  // G00 vs G0
  const gf = text.match(/\bgFormat\s*=\s*createFormat\(\s*\{([^}]*)\}/)?.[1] || '';
  if (/zeropad\s*:\s*true/.test(gf) && /width\s*:\s*2/.test(gf)) {
    const pad = s => (typeof s === 'string' ? s.replace(/\bG([0-4])(?![0-9.])/g, 'G0$1') : s);
    for (const k of Object.keys(def)) if (typeof def[k] === 'string' && k !== 'name' && k !== 'ext' && k !== 'comment') def[k] = pad(def[k]);
    report.push('G-Codes zweistellig (G00, G01, …)');
  }

  // properties
  const P = cpsProperties(text);
  if ('showSequenceNumbers' in P) {
    const on = P.showSequenceNumbers === true || P.showSequenceNumbers === 'true';
    def.lineNumbers = { ...def.lineNumbers, enabled: on };
    report.push(`Satznummern: ${on ? 'ein' : P.showSequenceNumbers === 'toolChange' ? 'nur bei Werkzeugwechsel (→ aus)' : 'aus'}`);
  }
  if (P.sequenceNumberStart > 0) def.lineNumbers = { ...def.lineNumbers, start: P.sequenceNumberStart };
  if (P.sequenceNumberIncrement > 0) def.lineNumbers = { ...def.lineNumbers, step: P.sequenceNumberIncrement };
  if (P.separateWordsWithSpace === false) { def.separator = ''; report.push('Adressen ohne Leerzeichen'); }
  if (P.useRadius === true) report.push('⚠ Kreisbögen mit R statt I/J werden nicht unterstützt – I/J wird ausgegeben');
  if (P.useCycles === false || P.expandCycles === true) { def.useDrillCycle = false; report.push('Bohrzyklen ausgeschrieben'); }
  if ('useG28' in P ? P.useG28 === true : /gFormat\.format\(28\)/.test(text)) {
    if (!lathe) def.footer = String(def.footer).replace(/G00? Z\{safe\}/, m => `${m}\n${m.startsWith('G00') ? 'G91 G28 Z0.' : 'G91 G28 Z0'}\nG90`);
    report.push('Rückfahrt zum Referenzpunkt mit G28 am Programmende');
  }
  if (P.useM6 === false) { def.toolChangeFirst = String(def.toolChangeFirst).replace(/ M6/g, ''); def.toolChange = String(def.toolChange).replace(/ M6/g, ''); report.push('Werkzeugwechsel ohne M6'); }
  if (typeof P.programName === 'string' && /^\d+$/.test(P.programName)) def.header = String(def.header).replace(/O\d+/, 'O' + P.programName);

  // coolant codes
  const flood = text.match(/COOLANT_FLOOD[^}]*?\bon\s*:\s*(\d+)/) || text.match(/case\s+COOLANT_FLOOD\s*:[^;]*?(\d+)/);
  if (flood) { def.coolantOn = `M${flood[1]}`; report.push(`Kühlmittel ein: ${def.coolantOn}`); }
  const off = text.match(/COOLANT_FLOOD[^}]*?\boff\s*:\s*(\d+)/) || text.match(/COOLANT_OFF[^}]*?(\d+)/);
  if (off) def.coolantOff = `M${off[1]}`;

  // work offset / units / plane block
  if (/\bG54\b|gFormat\.format\(54\)|workOffset/.test(text) && !/G54/.test(def.header) && !lathe) def.header = String(def.header).replace(/\nG0 Z\{safe\}/, '\nG54\nG0 Z{safe}');
  report.push('⚠ Programmlogik (JavaScript) wird nicht ausgeführt: Sonderfunktionen, 4./5. Achse, Messzyklen und Maschinenoptionen bitte im Postprozessor-Editor prüfen.');
  return { def, report };
}
