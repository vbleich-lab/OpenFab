// Geometriekern-Schnittstelle: OpenFab kann mit verschiedenen B-rep-Kernen rechnen.
//
// Jeder Kern ist ein Objekt mit:
//   id, name, info                  Kennung, Anzeigename, Kurzbeschreibung
//   load()                          lädt den Kern (async), danach ready = true
//   supports(feature)               true oder ein Text, warum das Feature (noch) nicht geht
//   runFeature(feature, ctx)        führt ein Feature aus; ctx = { bodies, sketches, tools, threads, faceExtrude }
//                                   bodies: [{ id, name, shape }] – shape ist ein Körper dieses Kerns
//   mesh(shape)                     { vertices, normals, triangles, faceGroups, lines, edgeGroups }
//                                   (faceGroups/edgeGroups in derselben Reihenfolge wie shape.faces/edges)
//   props(shape)                    { volume, com, area }
//   intersectVolume(a, b)           Volumen der Überschneidung zweier Körper (0 = keine)
//   exportSTEP([{ shape, name }])   Blob mit der STEP-Datei
//
// Körper (shape) bieten unabhängig vom Kern:
//   boundingBox.bounds              [[xmin, ymin, zmin], [xmax, ymax, zmax]]
//   faces[i].geomType               'PLANE', 'CYLINDRE', … ; faces[i].normalAt(p) → {x,y,z}
//   edges[i].pointAt(t)             Punkt auf der Kante (t = 0.5: Mitte) ; edges[i].geomType ; edges[i].isClosed
//   clone()
// Alles darüber hinaus (z. B. OpenCascade-Flächenadapter) ist kernspezifisch und wird nur genutzt,
// wenn der Kern es anbietet (`kernel.native`).

const kernels = new Map();
let active = 'occ';
const listeners = [];

export function registerKernel(k) {
  kernels.set(k.id, k);
}
export const kernelList = () => [...kernels.values()];
export const getKernel = id => kernels.get(id);
export function activeKernel() {
  const k = kernels.get(active);
  return k && k.ready ? k : kernels.get('occ');
}
export const activeKernelId = () => activeKernel()?.id || 'occ';

// switches the kernel (loads it first); falls back to OpenCascade when loading fails
export async function setActiveKernel(id) {
  const k = kernels.get(id) || kernels.get('occ');
  if (!k.ready) await k.load();
  active = k.id;
  listeners.forEach(fn => fn(k));
  return k;
}
export const onKernelChange = fn => listeners.push(fn);

// message for features the active kernel cannot build
export const unsupported = (kernelName, what) => `„${what}“ wird vom ${kernelName} noch nicht unterstützt – unter Einstellungen → Konstruktion → Geometriekern „OpenCascade“ wählen.`;
