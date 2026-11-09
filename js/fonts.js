// Sketch text: glyph outlines from a web font, flattened to polygons.
const OPENTYPE_URL = new URL('../vendor/opentype/opentype.module.js', import.meta.url).href;
export const FONTS = {
  sans: { label: 'Roboto', url: new URL('../vendor/fonts/roboto-latin-400-normal.woff', import.meta.url).href },
  mono: { label: 'Roboto Mono', url: new URL('../vendor/fonts/roboto-mono-latin-400-normal.woff', import.meta.url).href },
};

const fonts = {};
export async function loadFonts() {
  const ot = await import(OPENTYPE_URL);
  const parse = ot.parse || ot.default.parse;
  await Promise.all(Object.entries(FONTS).map(async ([k, f]) => {
    fonts[k] = parse(await (await fetch(f.url)).arrayBuffer());
  }));
}

const cache = new Map();

export function textPolys(e) {
  const font = fonts[e.font] || fonts.sans;
  if (!font || !e.text) return [];
  const key = JSON.stringify([e.text, e.x, e.y, e.size, e.rot, e.font]);
  if (cache.has(key)) return cache.get(key);
  const path = font.getPath(String(e.text), 0, 0, +e.size || 10);
  const contours = [];
  let cur = null, px = 0, py = 0;
  const seg = Math.max(4, Math.min(16, Math.round((+e.size || 10) / 1.5)));
  for (const c of path.commands) {
    if (c.type === 'M') { cur = [[c.x, c.y]]; contours.push(cur); }
    else if (c.type === 'L') cur.push([c.x, c.y]);
    else if (c.type === 'Q') {
      for (let i = 1; i <= seg; i++) {
        const t = i / seg, u = 1 - t;
        cur.push([u * u * px + 2 * u * t * c.x1 + t * t * c.x, u * u * py + 2 * u * t * c.y1 + t * t * c.y]);
      }
    } else if (c.type === 'C') {
      for (let i = 1; i <= seg; i++) {
        const t = i / seg, u = 1 - t;
        cur.push([
          u * u * u * px + 3 * u * u * t * c.x1 + 3 * u * t * t * c.x2 + t * t * t * c.x,
          u * u * u * py + 3 * u * u * t * c.y1 + 3 * u * t * t * c.y2 + t * t * t * c.y,
        ]);
      }
    }
    if (c.type !== 'Z') { px = c.x; py = c.y; }
  }
  const a = ((+e.rot || 0) * Math.PI) / 180, ca = Math.cos(a), sa = Math.sin(a);
  const out = [];
  for (const ctr of contours) {
    // font space is y-down; drop the duplicated closing point
    // zero-length segments break the B-rep wire builder
    let pts = ctr.map(([x, y]) => [x, -y]).filter((p, i, a) => i === 0 || Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) > 1e-4);
    while (pts.length > 1 && Math.hypot(pts[0][0] - pts[pts.length - 1][0], pts[0][1] - pts[pts.length - 1][1]) < 1e-4) pts.pop();
    if (pts.length < 3) continue;
    pts = pts.map(([x, y]) => [+e.x + x * ca - y * sa, +e.y + x * sa + y * ca]);
    let area = 0;
    for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; area += p[0] * q[1] - q[0] * p[1]; }
    if (Math.abs(area) > 1e-6) out.push(area < 0 ? pts.reverse() : pts);
  }
  if (cache.size > 200) cache.clear();
  cache.set(key, out);
  return out;
}
