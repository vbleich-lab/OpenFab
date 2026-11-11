// Low-level access to the WerkFab Rust kernel (WebAssembly, no generated bindings):
// JSON command in, JSON (or binary mesh) out. Works in the browser, in Electron and in Node (tests).

let inst = null, mem = null, epoch = 0;
const enc = new TextEncoder(), dec = new TextDecoder();

// truck pulls in a few wasm-bindgen helpers (time stamps, errors); these stubs satisfy them
function stubs() {
  const text = (p, n) => dec.decode(new Uint8Array(mem.buffer, p, n));
  const env = new Proxy({}, {
    get: (_, name) => {
      const n = String(name);
      if (n.includes('getTime')) return () => Date.now();
      if (n.includes('throw')) return (p, len) => { throw new Error(text(p, len)); };
      if (n.includes('table_grow')) return () => 0;
      return () => 0;
    },
  });
  return new Proxy({}, { get: () => env });
}

export async function instantiate(bytesOrUrl) {
  let bytes = bytesOrUrl;
  if (typeof bytesOrUrl === 'string' || bytesOrUrl instanceof URL) bytes = await (await fetch(bytesOrUrl)).arrayBuffer();
  const { instance } = await WebAssembly.instantiate(bytes, stubs());
  inst = instance.exports;
  mem = inst.memory;
  inst.of_init?.();
  epoch++;
  return epoch;
}
export const kernelEpoch = () => epoch;
export const isLoaded = () => !!inst;

let lastBytes = null;
export async function reload() {
  if (lastBytes) await instantiate(lastBytes);
}
export async function load(url) {
  const bytes = await (await fetch(url)).arrayBuffer();
  lastBytes = bytes;
  return instantiate(bytes);
}
export async function loadBytes(bytes) {
  lastBytes = bytes;
  return instantiate(bytes);
}

function raw(cmd) {
  if (!inst) throw new Error('Rust-Kern nicht geladen');
  const data = enc.encode(JSON.stringify(cmd));
  const p = inst.of_alloc(data.length);
  new Uint8Array(mem.buffer, p, data.length).set(data);
  let rp;
  const sp = inst.__stack_pointer?.value;
  try {
    rp = inst.of_call(p, data.length);
  } catch (err) {
    // a Rust panic traps; with the stack pointer restored the kernel (and its shapes) stays usable
    const n = inst.of_panic_len?.() || 0;
    const why = n ? dec.decode(new Uint8Array(mem.buffer, inst.of_panic_ptr(), n)).replace(/^panicked at [\s\S]*?:\d+:\d+:\s*/, '') : String(err.message || err);
    if (sp != null) inst.__stack_pointer.value = sp;
    else { inst = null; reload().catch(() => {}); }
    throw new Error('Rust-Kern: interner Fehler (' + why.split(/\r?\n/)[0].slice(0, 160) + ')');
  }
  inst.of_dealloc(p, data.length);
  const n = inst.of_result_len();
  return new Uint8Array(mem.buffer, rp, n).slice();
}

// command → value (throws the kernel's message on failure)
export function call(cmd) {
  const out = raw(cmd);
  const r = JSON.parse(dec.decode(out));
  if (r.err) throw new Error(r.err);
  return r.ok;
}

// triangulation of a shape: same layout as replicad's mesh()/meshEdges() results
export function mesh(h, tol = 0.02) {
  const out = raw({ op: 'mesh', h, tol });
  if (out[0] !== 77) { const r = JSON.parse(dec.decode(out)); throw new Error(r.err || 'Vernetzung fehlgeschlagen'); }
  const dv = new DataView(out.buffer, out.byteOffset + 1, out.byteLength - 1);
  let o = 0;
  const u32 = () => { const v = dv.getUint32(o, true); o += 4; return v; };
  const [nv, nt, nf, nl, ne] = [u32(), u32(), u32(), u32(), u32()];
  const f32s = n => { const a = new Float32Array(n); for (let i = 0; i < n; i++) { a[i] = dv.getFloat32(o, true); o += 4; } return a; };
  const u32s = n => { const a = new Uint32Array(n); for (let i = 0; i < n; i++) { a[i] = dv.getUint32(o, true); o += 4; } return a; };
  const vertices = f32s(nv * 3), normals = f32s(nv * 3), triangles = u32s(nt * 3), fgs = u32s(nf * 2);
  const lines = f32s(nl * 3), egs = u32s(ne * 2);
  const faceGroups = [], edgeGroups = [];
  for (let i = 0; i < nf; i++) faceGroups.push({ start: fgs[i * 2], count: fgs[i * 2 + 1], faceId: i });
  for (let i = 0; i < ne; i++) edgeGroups.push({ start: egs[i * 2], count: egs[i * 2 + 1], edgeId: i });
  return { vertices, normals, triangles, faceGroups, lines, edgeGroups };
}

// boolean operation: exact first; on failure (coincident faces) the kernel's fallback variants,
// each in its own call so an internal error in one variant does not stop the next. → handle or null
export const VARIANTS = 4;
export function boolean(kind, a, b) {
  let first = null;
  for (let variant = 0; variant <= VARIANTS; variant++) {
    try {
      return call({ op: 'bool', kind, a, b, variant });
    } catch (err) {
      first ||= err;
      if (!inst) break;
    }
  }
  throw first;
}
