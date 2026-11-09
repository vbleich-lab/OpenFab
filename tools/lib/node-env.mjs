// Import this first in Node tests: gives the app modules the same environment as in the browser
// (importmap for three.js, ClipperLib as a global).
import { register, createRequire } from 'node:module';
register('./three-hooks.mjs', import.meta.url);
globalThis.window ||= globalThis;
globalThis.window.ClipperLib ||= createRequire(import.meta.url)('../../vendor/clipper/clipper.js');
