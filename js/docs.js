// Local document store (data panel, but on this computer):
// every design is kept in IndexedDB with its saved versions and a thumbnail.
const DB = 'openfab.docs';
let dbp = null;
function db() {
  return (dbp ||= new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => {
      r.result.createObjectStore('docs', { keyPath: 'id' });
      r.result.createObjectStore('versions'); // key "docId@v" -> project JSON
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
}
const tx = async (stores, mode, fn) => {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(stores, mode);
    let out;
    t.oncomplete = () => res(out);
    t.onerror = () => rej(t.error);
    out = fn(...[].concat(stores).map(s => t.objectStore(s)));
  });
};
const req = r => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export async function listDocs() {
  const d = await db();
  const all = await req(d.transaction('docs').objectStore('docs').getAll());
  return all.sort((a, b) => b.updated - a.updated);
}

export async function getDoc(id) {
  const d = await db();
  return req(d.transaction('docs').objectStore('docs').get(id));
}

// keeps the current state of a design (no new version)
export async function storeCurrent(project, thumb) {
  if (!project?.docId) return;
  const old = (await getDoc(project.docId)) || { id: project.docId, versions: [], created: Date.now() };
  const rec = { ...old, name: project.name, updated: Date.now(), current: JSON.stringify(project), ...(thumb ? { thumb } : {}) };
  await tx('docs', 'readwrite', s => s.put(rec));
  return rec;
}

// "Speichern": a new version with a description
export async function saveVersion(project, note, thumb) {
  const rec = await storeCurrent(project, thumb);
  const v = (rec.versions.at(-1)?.v || 0) + 1;
  rec.versions = [...rec.versions, { v, date: Date.now(), note: note || '', thumb: thumb || rec.thumb || '' }];
  await tx(['docs', 'versions'], 'readwrite', (docs, vers) => { docs.put(rec); vers.put(rec.current, `${rec.id}@${v}`); });
  return v;
}

export async function loadCurrent(id) {
  const rec = await getDoc(id);
  return rec ? JSON.parse(rec.current) : null;
}

export async function loadVersion(id, v) {
  const d = await db();
  const s = await req(d.transaction('versions').objectStore('versions').get(`${id}@${v}`));
  return s ? JSON.parse(s) : null;
}

export async function renameDoc(id, name) {
  const rec = await getDoc(id);
  if (!rec) return;
  rec.name = name;
  const p = JSON.parse(rec.current);
  p.name = name;
  rec.current = JSON.stringify(p);
  await tx('docs', 'readwrite', s => s.put(rec));
}

export async function deleteDoc(id) {
  const rec = await getDoc(id);
  await tx(['docs', 'versions'], 'readwrite', (docs, vers) => {
    docs.delete(id);
    for (const v of rec?.versions || []) vers.delete(`${id}@${v.v}`);
  });
}

// small preview image of the current view
export function thumbnail(renderer, scene, camera, bg = '#3a434d', w = 240, h = 160) {
  try {
    renderer.render(scene, camera);
    const src = renderer.domElement;
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const g = c.getContext('2d');
    g.fillStyle = bg;
    g.fillRect(0, 0, w, h);
    const k = Math.max(w / src.width, h / src.height);
    const sw = w / k, sh = h / k;
    g.drawImage(src, (src.width - sw) / 2, (src.height - sh) / 2, sw, sh, 0, 0, w, h);
    return c.toDataURL('image/jpeg', 0.8);
  } catch { return ''; }
}
