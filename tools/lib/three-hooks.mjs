// Node module hooks for the tests: map the bare imports of the browser importmap onto the vendored files,
// and load the app's .js files as ES modules (package.json has no "type").
const ROOT = new URL('../../', import.meta.url).href;
const MAP = {
  three: ROOT + 'vendor/three/build/three.module.js',
  'three-mesh-bvh': ROOT + 'vendor/three-mesh-bvh/index.module.js',
};
export async function resolve(spec, ctx, next) {
  if (MAP[spec]) return { url: MAP[spec], shortCircuit: true };
  if (spec.startsWith('three/addons/')) return { url: ROOT + 'vendor/three/examples/jsm/' + spec.slice(13), shortCircuit: true };
  return next(spec, ctx);
}
export async function load(url, ctx, next) {
  if (url.startsWith(ROOT) && url.endsWith('.js') && !url.includes('/vendor/clipper/')) return next(url, { ...ctx, format: 'module' });
  return next(url, ctx);
}
