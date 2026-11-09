// Minimal DXF (ASCII) import/export for sketches.
// Import: LINE, ARC, CIRCLE, LWPOLYLINE (with bulges), POLYLINE/VERTEX.
// Loose lines and arcs are chained into polylines; closed chains become profiles.
// Export: R12 POLYLINE/VERTEX and CIRCLE entities (read by practically every CAD/CAM/laser tool).
import { entityOutlines } from './profiles.js';

const TAU = Math.PI * 2;

function pairs(text) {
  const lines = text.split(/\r?\n/);
  const out = [];
  for (let i = 0; i + 1 < lines.length; i += 2) out.push([+lines[i].trim(), lines[i + 1].trim()]);
  return out;
}

function arcPoints(cx, cy, r, a0, a1, ccw = true) {
  let sweep = a1 - a0;
  if (ccw) { while (sweep <= 0) sweep += TAU; } else { while (sweep >= 0) sweep -= TAU; }
  const n = Math.max(2, Math.min(256, Math.ceil((Math.abs(sweep) * r) / 0.4)));
  return Array.from({ length: n + 1 }, (_, i) => { const a = a0 + (sweep * i) / n; return [cx + r * Math.cos(a), cy + r * Math.sin(a)]; });
}

// bulge = tan(sweep/4) between two polyline vertices
function bulgePoints(p, q, b) {
  if (!b) return [q];
  const sweep = 4 * Math.atan(b);
  const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
  const r = d / (2 * Math.sin(Math.abs(sweep) / 2));
  const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
  const h = Math.sqrt(Math.max(0, r * r - (d / 2) ** 2)) * Math.sign(b) * (Math.abs(sweep) > Math.PI ? -1 : 1);
  const nx = -(q[1] - p[1]) / d, ny = (q[0] - p[0]) / d;
  const c = [mid[0] + nx * h, mid[1] + ny * h];
  const a0 = Math.atan2(p[1] - c[1], p[0] - c[0]);
  return arcPoints(c[0], c[1], r, a0, a0 + sweep, sweep > 0).slice(1);
}

export function parseDXF(text) {
  const P = pairs(text);
  let i = P.findIndex(([c, v]) => c === 2 && v === 'ENTITIES');
  if (i < 0) throw new Error('Kein ENTITIES-Abschnitt gefunden (nur ASCII-DXF wird unterstützt)');
  const circles = [], polys = [], segs = [];
  const skipped = {};
  let cur = null;
  const flush = () => {
    if (!cur) return;
    const g = cur.g;
    const num = c => (g[c] ? +g[c][0] : 0);
    if (cur.type === 'LINE') segs.push([[num(10), num(20)], [num(11), num(21)]]);
    else if (cur.type === 'CIRCLE') circles.push({ cx: num(10), cy: num(20), r: num(40) });
    else if (cur.type === 'ARC') segs.push(arcPoints(num(10), num(20), num(40), (num(50) * Math.PI) / 180, (num(51) * Math.PI) / 180, true));
    else if (cur.type === 'LWPOLYLINE') {
      const xs = g[10] || [], ys = g[20] || [];
      const closed = (num(70) & 1) === 1;
      // bulges belong to vertices; rebuild per-vertex order from the raw sequence
      const verts = cur.seq;
      const pts = [];
      for (let k = 0; k < verts.length; k++) {
        const v = verts[k], nx = verts[(k + 1) % verts.length];
        if (!pts.length) pts.push([v.x, v.y]);
        if (k === verts.length - 1 && !closed) break;
        pts.push(...bulgePoints([v.x, v.y], [nx.x, nx.y], v.b));
      }
      if (closed && pts.length > 1) pts.pop();
      if (xs.length) polys.push({ pts, closed });
    } else if (cur.type === 'POLYLINE') {
      cur.closed = (num(70) & 1) === 1;
      return; // vertices follow
    } else if (cur.type === 'VERTEX' && cur.parent) cur.parent.verts.push({ x: num(10), y: num(20), b: num(42) });
    else if (cur.type === 'SEQEND' && cur.parent) {
      const pl = cur.parent, vs = pl.verts, pts = [];
      for (let k = 0; k < vs.length; k++) {
        if (!pts.length) pts.push([vs[k].x, vs[k].y]);
        if (k === vs.length - 1 && !pl.closed) break;
        pts.push(...bulgePoints([vs[k].x, vs[k].y], [vs[(k + 1) % vs.length].x, vs[(k + 1) % vs.length].y], vs[k].b));
      }
      if (pl.closed && pts.length > 1) pts.pop();
      polys.push({ pts, closed: pl.closed });
    } else skipped[cur.type] = (skipped[cur.type] || 0) + 1;
  };
  let polyline = null;
  for (i = i + 1; i < P.length; i++) {
    const [c, v] = P[i];
    if (c === 0) {
      if (cur && cur.type === 'POLYLINE') { flush(); polyline = { verts: [], closed: cur.closed }; }
      else flush();
      if (v === 'ENDSEC') { cur = null; break; }
      cur = { type: v, g: {}, seq: [], parent: polyline };
      if (v === 'SEQEND') { flush(); polyline = null; cur = null; }
      continue;
    }
    if (!cur) continue;
    (cur.g[c] ||= []).push(v);
    if (cur.type === 'LWPOLYLINE') {
      if (c === 10) cur.seq.push({ x: +v, y: 0, b: 0 });
      else if (c === 20 && cur.seq.length) cur.seq[cur.seq.length - 1].y = +v;
      else if (c === 42 && cur.seq.length) cur.seq[cur.seq.length - 1].b = +v;
    }
  }
  flush();
  // chain loose segments end-to-end
  const tol = 1e-3;
  const near = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < tol;
  const rest = segs.map(s => s.slice());
  while (rest.length) {
    let chain = rest.shift();
    let grew = true;
    while (grew) {
      grew = false;
      for (let k = 0; k < rest.length; k++) {
        const s = rest[k];
        const head = chain[0], tail = chain[chain.length - 1];
        if (near(tail, s[0])) chain = chain.concat(s.slice(1));
        else if (near(tail, s[s.length - 1])) chain = chain.concat(s.slice(0, -1).reverse());
        else if (near(head, s[s.length - 1])) chain = s.slice(0, -1).concat(chain);
        else if (near(head, s[0])) chain = s.slice(1).reverse().concat(chain);
        else continue;
        rest.splice(k, 1);
        grew = true;
        break;
      }
    }
    const closed = chain.length > 2 && near(chain[0], chain[chain.length - 1]);
    if (closed) chain.pop();
    polys.push({ pts: chain, closed });
  }
  return { circles, polys, skipped };
}

const r6 = v => +(+v).toFixed(6);

export function writeDXF(entities) {
  const out = ['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '4', '0', 'ENDSEC', '0', 'SECTION', '2', 'ENTITIES'];
  for (const e of entities) {
    if (e.type === 'circle') { out.push('0', 'CIRCLE', '8', '0', '10', r6(e.cx), '20', r6(e.cy), '30', '0', '40', r6(e.r)); continue; }
    for (const o of entityOutlines(e)) {
      if (o.pts.length < 2) continue;
      out.push('0', 'POLYLINE', '8', '0', '66', '1', '10', '0', '20', '0', '30', '0', '70', o.closed ? '1' : '0');
      for (const [x, y] of o.pts) out.push('0', 'VERTEX', '8', '0', '10', r6(x), '20', r6(y), '30', '0');
      out.push('0', 'SEQEND', '8', '0');
    }
  }
  out.push('0', 'ENDSEC', '0', 'EOF');
  return out.join('\n');
}
