// Loads the OpenCascade B-rep kernel (via replicad) once.
const OC_URL = new URL('../vendor/replicad/replicad_single.js', import.meta.url).href;
const WASM_URL = new URL('../vendor/replicad/replicad_single.wasm', import.meta.url).href;
const REPLICAD_URL = new URL('../vendor/replicad/replicad.js', import.meta.url).href;

export let R = null;

export async function loadKernel() {
  if (R) return R;
  const [ocMod, rep] = await Promise.all([import(OC_URL), import(REPLICAD_URL)]);
  const oc = await ocMod.default({ locateFile: () => WASM_URL });
  rep.setOC(oc);
  R = rep;
  return R;
}
