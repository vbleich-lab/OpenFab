// Geometric constraint solver for sketches.
//
// Entity parameters become unknowns; constraints and dimensions are residual
// functions of "handles" (points, lines, circles). A damped Gauss-Newton
// (Levenberg-Marquardt) iteration with a weak pull towards the start values
// solves the system, so under-constrained sketches move as little as possible.

const DEG = Math.PI / 180;
const TAU = Math.PI * 2;
// circle through three points (null when they are on one line)
function circleOf3(a, m, b) {
  const d = 2 * (a[0] * (m[1] - b[1]) + m[0] * (b[1] - a[1]) + b[0] * (a[1] - m[1]));
  if (Math.abs(d) < 1e-12) return null;
  const A = a[0] ** 2 + a[1] ** 2, M = m[0] ** 2 + m[1] ** 2, B = b[0] ** 2 + b[1] ** 2;
  const cx = (A * (m[1] - b[1]) + M * (b[1] - a[1]) + B * (a[1] - m[1])) / d;
  const cy = (A * (b[0] - m[0]) + M * (a[0] - b[0]) + B * (m[0] - a[0])) / d;
  return { c: [cx, cy], r: Math.hypot(a[0] - cx, a[1] - cy) };
}
const isArc = e => e && e.type === 'poly' && e.curve === 'arc' && e.pts.length === 3;

export const CONSTRAINTS = {
  coincident: 'Koinzident', horizontal: 'Horizontal', vertical: 'Vertikal', parallel: 'Parallel',
  perpendicular: 'Senkrecht', collinear: 'Kollinear', equal: 'Gleich', tangent: 'Tangential',
  concentric: 'Konzentrisch', midpoint: 'Mittelpunkt', symmetric: 'Symmetrisch', fix: 'Fixiert', dim: 'Bemaßung',
};
export const GLYPH = {
  coincident: '●', horizontal: 'H', vertical: 'V', parallel: '∥', perpendicular: '⊥', collinear: '⫽',
  equal: '=', tangent: '⌒', concentric: '◎', midpoint: '△', symmetric: '⇹', fix: '🔒',
};
export const DIM_KINDS = { length: 'Länge', dist: 'Abstand', hdist: 'Horizontalabstand', vdist: 'Vertikalabstand', pldist: 'Abstand Punkt–Linie', diameter: 'Durchmesser', radius: 'Radius', angle: 'Winkel' };

// ---------- references ----------
// "eid:p2" point, "eid:l1" line, "eid:c" centre point, "eid:o" circle; "origin", "xaxis", "yaxis".
export const refKind = ref => {
  if (ref === 'origin') return 'P';
  if (ref === 'xaxis' || ref === 'yaxis') return 'L';
  const k = ref.split(':')[1] || '';
  return k[0] === 'l' ? 'L' : k === 'o' ? 'O' : 'P';
};
export const refEntity = ref => (ref.includes(':') ? ref.split(':')[0] : null);

// ---------- unknowns ----------
// Rectangles are solved by their corners (x, y, x1, y1) so dragging one corner
// keeps the opposite one in place.
function varKeys(e) {
  switch (e.type) {
    case 'poly': return e.pts.flatMap((_, k) => [`p${k}x`, `p${k}y`]);
    case 'rect': return ['x', 'y', 'x1', 'y1'];
    case 'circle': return ['cx', 'cy', 'r'];
    case 'ngon': return ['cx', 'cy', 'r', 'rot'];
    case 'slot': return ['cx', 'cy', 'len', 'w', 'rot'];
    case 'text': return ['x', 'y'];
    case 'ellipse': return ['cx', 'cy', 'rx', 'ry', 'rot'];
  }
  return [];
}
// raw entity fields that, when locked (expression or pinned), freeze a key
const LOCK_FIELD = { x1: 'w', y1: 'h' };

function rawValue(e, key) {
  if (e.type === 'poly') { const m = key.match(/^p(\d+)([xy])$/); return e.pts[+m[1]][m[2] === 'x' ? 0 : 1]; }
  if (e.type === 'rect' && key === 'x1') return e.x + e.w;
  if (e.type === 'rect' && key === 'y1') return e.y + e.h;
  return +e[key];
}

function isLocked(e, key, locked) {
  if (e.type === 'poly') { const m = key.match(/^p(\d+)([xy])$/); return locked.has(`${e.id}.pts.${m[1]}.${m[2] === 'x' ? 0 : 1}`); }
  return locked.has(`${e.id}.${LOCK_FIELD[key] || key}`) || (key === 'x1' && locked.has(`${e.id}.x`) && locked.has(`${e.id}.w`));
}

class System {
  constructor(entities, locked) {
    this.byId = Object.fromEntries(entities.map(e => [e.id, e]));
    this.vars = [];
    this.index = new Map();
    for (const e of entities) {
      for (const key of varKeys(e)) {
        if (isLocked(e, key, locked)) continue;
        this.index.set(`${e.id}.${key}`, this.vars.length);
        this.vars.push({ e, key, v0: rawValue(e, key) });
      }
    }
    this.x = this.vars.map(v => v.v0);
  }

  val(e, key) {
    const i = this.index.get(`${e.id}.${key}`);
    if (i !== undefined) return this.x[i];
    // locked rectangle extent: the far corner follows the near one
    if (e.type === 'rect' && key === 'x1') return this.val(e, 'x') + e.w;
    if (e.type === 'rect' && key === 'y1') return this.val(e, 'y') + e.h;
    return rawValue(e, key);
  }

  point(ref) {
    if (ref === 'origin') return [0, 0];
    const [id, k] = ref.split(':');
    const e = this.byId[id];
    if (!e) return [NaN, NaN];
    const V = key => this.val(e, key);
    switch (e.type) {
      case 'poly': { const i = +k.slice(1); return [V(`p${i}x`), V(`p${i}y`)]; }
      case 'rect': {
        const x0 = V('x'), y0 = V('y'), x1 = V('x1'), y1 = V('y1');
        return { p0: [x0, y0], p1: [x1, y0], p2: [x1, y1], p3: [x0, y1], c: [(x0 + x1) / 2, (y0 + y1) / 2] }[k] || [NaN, NaN];
      }
      case 'slot': {
        const a = V('rot') * DEG, dx = (Math.cos(a) * V('len')) / 2, dy = (Math.sin(a) * V('len')) / 2;
        if (k === 'p0') return [V('cx') - dx, V('cy') - dy];
        if (k === 'p1') return [V('cx') + dx, V('cy') + dy];
        return [V('cx'), V('cy')];
      }
      case 'text': return [V('x'), V('y')];
      default: return [V('cx'), V('cy')];
    }
  }

  line(ref) {
    if (ref === 'xaxis') return [[0, 0], [1, 0]];
    if (ref === 'yaxis') return [[0, 0], [0, 1]];
    const [id, k] = ref.split(':');
    const e = this.byId[id];
    const i = +k.slice(1);
    if (e.type === 'poly') return [this.point(`${id}:p${i}`), this.point(`${id}:p${(i + 1) % e.pts.length}`)];
    if (e.type === 'rect') return [this.point(`${id}:p${i}`), this.point(`${id}:p${(i + 1) % 4}`)];
    if (e.type === 'slot') return [this.point(`${id}:p0`), this.point(`${id}:p1`)];
    return [[NaN, NaN], [NaN, NaN]];
  }

  circle(ref) {
    const e = this.byId[refEntity(ref)];
    if (isArc(e)) {
      // a 3-point arc counts as its circle (tangent, concentric, equal, radius …); span = the drawn part
      const a = this.point(`${e.id}:p0`), m = this.point(`${e.id}:p1`), b = this.point(`${e.id}:p2`);
      const k = circleOf3(a, m, b);
      if (!k) return { c: [NaN, NaN], r: NaN };
      const ang = p => Math.atan2(p[1] - k.c[1], p[0] - k.c[0]), norm = x => ((x % TAU) + TAU) % TAU;
      const a0 = ang(a);
      let sw = norm(ang(b) - a0);
      if (norm(ang(m) - a0) > sw) sw -= TAU;
      return { ...k, span: { a0, sw } };
    }
    return { c: this.point(`${e.id}:c`), r: e.type === 'slot' ? this.val(e, 'w') / 2 : this.val(e, 'r') };
  }

  writeBack() {
    const out = {};
    for (const [id, e] of Object.entries(this.byId)) {
      const c = JSON.parse(JSON.stringify(e));
      if (e.type === 'poly') c.pts = e.pts.map((_, k) => [this.val(e, `p${k}x`), this.val(e, `p${k}y`)]);
      else if (e.type === 'rect') {
        const x0 = this.val(e, 'x'), y0 = this.val(e, 'y'), x1 = this.val(e, 'x1'), y1 = this.val(e, 'y1');
        Object.assign(c, { x: Math.min(x0, x1), y: Math.min(y0, y1), w: Math.abs(x1 - x0), h: Math.abs(y1 - y0) });
      } else for (const key of varKeys(e)) c[key] = this.val(e, key);
      out[id] = c;
    }
    return out;
  }
}

// ---------- residuals ----------
const sub = (a, b) => [a[0] - b[0], a[1] - b[1]];
const len = v => Math.hypot(v[0], v[1]);
const cross = (a, b) => a[0] * b[1] - a[1] * b[0];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1];
const ptLine = (p, [a, b]) => { const d = sub(b, a); return cross(d, sub(p, a)) / (len(d) || 1e-12); };
const angleBetween = (L, M) => { const a = sub(L[1], L[0]), b = sub(M[1], M[0]); return Math.atan2(cross(a, b), dot(a, b)); };

function residuals(S, c, value) {
  const R = c.refs, K = R.map(refKind);
  const P = r => S.point(r), L = r => S.line(r), C = r => S.circle(r);
  switch (c.type) {
    case 'coincident':
      if (K[0] === 'P' && K[1] === 'P') return sub(P(R[0]), P(R[1]));
      if (K[0] === 'P' && K[1] === 'L') return [ptLine(P(R[0]), L(R[1]))];
      if (K[0] === 'L' && K[1] === 'P') return [ptLine(P(R[1]), L(R[0]))];
      if (K[0] === 'P' && K[1] === 'O') { const o = C(R[1]); return [len(sub(P(R[0]), o.c)) - o.r]; }
      if (K[0] === 'O' && K[1] === 'P') { const o = C(R[0]); return [len(sub(P(R[1]), o.c)) - o.r]; }
      return [];
    case 'horizontal': {
      if (K[0] === 'L') { const [a, b] = L(R[0]); return [a[1] - b[1]]; }
      return [P(R[0])[1] - P(R[1])[1]];
    }
    case 'vertical': {
      if (K[0] === 'L') { const [a, b] = L(R[0]); return [a[0] - b[0]]; }
      return [P(R[0])[0] - P(R[1])[0]];
    }
    case 'parallel': { const a = L(R[0]), b = L(R[1]); const u = sub(a[1], a[0]), v = sub(b[1], b[0]); return [(10 * cross(u, v)) / (len(u) * len(v) || 1e-12)]; }
    case 'perpendicular': { const a = L(R[0]), b = L(R[1]); const u = sub(a[1], a[0]), v = sub(b[1], b[0]); return [(10 * dot(u, v)) / (len(u) * len(v) || 1e-12)]; }
    case 'collinear': { const a = L(R[0]), b = L(R[1]); return [ptLine(b[0], a), ptLine(b[1], a)]; }
    case 'equal':
      if (K[0] === 'L') { const a = L(R[0]), b = L(R[1]); return [len(sub(a[1], a[0])) - len(sub(b[1], b[0]))]; }
      return [C(R[0]).r - C(R[1]).r];
    case 'tangent': {
      if (K[0] === 'O' && K[1] === 'O') { const a = C(R[0]), b = C(R[1]); const d = len(sub(a.c, b.c)); return [Math.min(Math.abs(d - (a.r + b.r)), Math.abs(d - Math.abs(a.r - b.r)))]; }
      const [l, o] = K[0] === 'L' ? [L(R[0]), C(R[1])] : [L(R[1]), C(R[0])];
      return [Math.abs(ptLine(o.c, l)) - o.r];
    }
    case 'concentric': {
      const ctr = r => (refKind(r) === 'O' ? C(r).c : P(r));
      return sub(ctr(R[0]), ctr(R[1]));
    }
    case 'midpoint': {
      const [p, l] = K[0] === 'P' ? [P(R[0]), L(R[1])] : [P(R[1]), L(R[0])];
      return sub(p, [(l[0][0] + l[1][0]) / 2, (l[0][1] + l[1][1]) / 2]);
    }
    case 'symmetric': {
      const a = P(R[0]), b = P(R[1]), l = L(R[2]);
      const m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const d = sub(l[1], l[0]);
      return [ptLine(m, l), dot(sub(b, a), d) / (len(d) || 1e-12)];
    }
    case 'fix': return sub(P(R[0]), c.at);
    case 'dim': {
      const v = +value;
      switch (c.kind) {
        case 'length': { const [a, b] = L(R[0]); return [len(sub(b, a)) - v]; }
        case 'dist': return [len(sub(P(R[1]), P(R[0]))) - v];
        case 'hdist': return [(P(R[1])[0] - P(R[0])[0]) * (c.sign || 1) - v];
        case 'vdist': return [(P(R[1])[1] - P(R[0])[1]) * (c.sign || 1) - v];
        case 'pldist': { const [p, l] = K[0] === 'P' ? [P(R[0]), L(R[1])] : [P(R[1]), L(R[0])]; return [Math.abs(ptLine(p, l)) - v]; }
        case 'diameter': return [2 * C(R[0]).r - v];
        case 'radius': return [C(R[0]).r - v];
        case 'angle': return [10 * (angleBetween(L(R[0]), L(R[1])) * (c.sign || 1) - v * DEG)];
      }
    }
  }
  return [];
}

// Current measured value of a dimension (used when creating it).
export function measure(entities, c) {
  const S = new System(entities, new Set());
  const r = residuals(S, { ...c, type: 'dim', sign: 1 }, 0);
  const v = r[0];
  if (c.kind === 'angle') return v / 10 / DEG;
  return v;
}

// ---------- linear algebra ----------
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let piv = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < 1e-14) continue;
    [M[c], M[piv]] = [M[piv], M[c]];
    for (let r = 0; r < n; r++) {
      if (r === c) continue;
      const f = M[r][c] / M[c][c];
      if (f) for (let k = c; k <= n; k++) M[r][k] -= f * M[c][k];
    }
  }
  return M.map((row, i) => (Math.abs(row[i]) < 1e-14 ? 0 : row[n] / row[i]));
}

function rank(J, tol = 1e-7) {
  const M = J.map(r => r.slice());
  const rows = M.length, cols = rows ? M[0].length : 0;
  let rk = 0;
  for (let c = 0; c < cols && rk < rows; c++) {
    let piv = rk;
    for (let r = rk + 1; r < rows; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
    if (Math.abs(M[piv][c]) < tol) continue;
    [M[rk], M[piv]] = [M[piv], M[rk]];
    for (let r = rk + 1; r < rows; r++) {
      const f = M[r][c] / M[rk][c];
      for (let k = c; k < cols; k++) M[r][k] -= f * M[rk][k];
    }
    rk++;
  }
  return rk;
}

// ---------- solve ----------
// opts.locked: Set of "eid.field" that must not change (expressions, pinned edits)
// opts.drag:   [{ ref, to: [u, v] }] soft targets for dragged points
export function solveSketch(entities, constraints, values = {}, opts = {}) {
  const S = new System(entities, opts.locked || new Set());
  const n = S.x.length;
  const active = constraints.filter(c => c.refs.every(r => !refEntity(r) || S.byId[refEntity(r)]));
  const hard = x => { S.x = x; return active.flatMap(c => residuals(S, c, values[c.id] ?? c.value)); };
  const drag = opts.drag || [];

  const residualFn = (wDrag, wReg) => x => {
    const r = hard(x);
    for (const d of drag) { const p = S.point(d.ref); r.push(wDrag * (p[0] - d.to[0]), wDrag * (p[1] - d.to[1])); }
    for (let i = 0; i < n; i++) r.push(wReg * (x[i] - S.vars[i].v0));
    return r;
  };

  // Phase 1 balances drag targets and minimal motion against the constraints;
  // phase 2 polishes the constraints to full accuracy from that solution.
  let x = S.x.slice();
  if (n) {
    x = levenbergMarquardt(residualFn(1, 1e-3), x, true);
    x = levenbergMarquardt(residualFn(0, 1e-8), x, false);
  }
  S.x = x;

  const unsatisfied = active.filter(c => residuals(S, c, values[c.id] ?? c.value).some(v => Math.abs(v) > 1e-5)).map(c => c.id);
  let dof = n;
  if (n) {
    const Jh = jacobian(hard, x);
    S.x = x;
    dof = n - rank(Jh);
  }
  return { entities: S.writeBack(), unsatisfied, dof };

  function levenbergMarquardt(f, x0, soft) {
    let x = x0;
    let r = f(x);
    let err = r.reduce((a, v) => a + v * v, 0);
    let mu = 1e-3;
    for (let it = 0; it < 80; it++) {
      const J = jacobian(f, x, r);
      const A = Array.from({ length: n }, () => new Array(n).fill(0));
      const g = new Array(n).fill(0);
      for (let i = 0; i < r.length; i++) {
        const Ji = J[i];
        for (let a = 0; a < n; a++) {
          if (!Ji[a]) continue;
          g[a] += Ji[a] * r[i];
          for (let b = 0; b < n; b++) A[a][b] += Ji[a] * Ji[b];
        }
      }
      let improved = false;
      for (let tries = 0; tries < 8; tries++) {
        const Ad = A.map((row, i) => row.map((v, j) => (i === j ? v + mu * (1 + v) : v)));
        const dx = solveLinear(Ad, g.map(v => -v));
        const xn = x.map((v, i) => v + dx[i]);
        const rn = f(xn);
        const en = rn.reduce((a, v) => a + v * v, 0);
        if (en < err) { improved = err - en > 1e-18; x = xn; r = rn; err = en; mu = Math.max(1e-9, mu / 3); break; }
        mu *= 5;
      }
      if (!improved) break;
      if (!soft && hard(x).every(v => Math.abs(v) < 1e-10)) break;
    }
    return x;
  }

  function jacobian(f, x, r0 = f(x)) {
    const J = r0.map(() => new Array(n).fill(0));
    for (let j = 0; j < n; j++) {
      const h = 1e-6 * Math.max(1, Math.abs(x[j]));
      const xp = x.slice();
      xp[j] += h;
      const rp = f(xp);
      for (let i = 0; i < r0.length; i++) J[i][j] = (rp[i] - r0[i]) / h;
    }
    return J;
  }
}
// Raw entity fields holding "=expr" strings are driven by parameters.
export function lockedFields(rawEntities) {
  const out = new Set();
  for (const e of rawEntities) {
    for (const [k, v] of Object.entries(e)) if (typeof v === 'string' && v.startsWith('=')) out.add(`${e.id}.${k}`);
    if (e.type === 'poly') e.pts.forEach((p, i) => p.forEach((v, j) => { if (typeof v === 'string') out.add(`${e.id}.pts.${i}.${j}`); }));
  }
  return out;
}

// Handles for picking, snapping and highlighting (sketch-local coordinates).
export function sketchHandles(entities) {
  const S = new System(entities, new Set(entities.map(e => varKeys(e).map(k => `${e.id}.${LOCK_FIELD[k] || k}`)).flat()));
  const points = [{ ref: 'origin', p: [0, 0] }], lines = [], circles = [];
  for (const e of entities) {
    const id = e.id;
    if (e.type === 'poly') {
      e.pts.forEach((_, k) => points.push({ ref: `${id}:p${k}`, p: S.point(`${id}:p${k}`) }));
      // arcs and splines: only their points are handles, not the chords between them
      const nl = e.curve ? 0 : e.closed ? e.pts.length : e.pts.length - 1;
      for (let k = 0; k < nl; k++) { const [a, b] = S.line(`${id}:l${k}`); lines.push({ ref: `${id}:l${k}`, a, b }); }
      // an arc itself can be picked as a curve (for tangent, radius, concentric …)
      if (isArc(e)) { const o = S.circle(`${id}:o`); if (Number.isFinite(o.r)) circles.push({ ref: `${id}:o`, c: o.c, r: o.r, span: o.span }); }
    } else if (e.type === 'rect') {
      for (let k = 0; k < 4; k++) points.push({ ref: `${id}:p${k}`, p: S.point(`${id}:p${k}`) });
      points.push({ ref: `${id}:c`, p: S.point(`${id}:c`) });
      for (let k = 0; k < 4; k++) { const [a, b] = S.line(`${id}:l${k}`); lines.push({ ref: `${id}:l${k}`, a, b }); }
    } else if (e.type === 'circle' || e.type === 'ngon') {
      points.push({ ref: `${id}:c`, p: S.point(`${id}:c`) });
      if (e.type === 'circle') circles.push({ ref: `${id}:o`, c: S.point(`${id}:c`), r: +e.r });
    } else if (e.type === 'slot') {
      points.push({ ref: `${id}:c`, p: S.point(`${id}:c`) }, { ref: `${id}:p0`, p: S.point(`${id}:p0`) }, { ref: `${id}:p1`, p: S.point(`${id}:p1`) });
      const [a, b] = S.line(`${id}:l0`);
      lines.push({ ref: `${id}:l0`, a, b });
      circles.push({ ref: `${id}:o`, c: S.point(`${id}:c`), r: +e.w / 2 });
    } else if (e.type === 'text') points.push({ ref: `${id}:p0`, p: [+e.x, +e.y] });
    else if (e.type === 'ellipse') points.push({ ref: `${id}:c`, p: S.point(`${id}:c`) });
  }
  return { points, lines, circles, point: ref => S.point(ref), line: ref => S.line(ref), circle: ref => S.circle(ref) };
}

// Which constraint types fit a selection (kinds in click order).
export function constraintFor(type, refs) {
  const K = refs.map(refKind).join('');
  const ok = {
    coincident: ['PP', 'PL', 'LP', 'PO', 'OP'],
    horizontal: ['L', 'PP'], vertical: ['L', 'PP'],
    parallel: ['LL'], perpendicular: ['LL'], collinear: ['LL'],
    equal: ['LL', 'OO'], tangent: ['LO', 'OL', 'OO'], concentric: ['OO', 'PP', 'OP', 'PO'],
    midpoint: ['PL', 'LP'], symmetric: ['PPL'], fix: ['P'],
  }[type];
  return ok && ok.includes(K);
}

export function dimensionFor(refs) {
  const K = refs.map(refKind).join('');
  if (K === 'L') return { kind: 'length' };
  if (K === 'O') return { kind: 'diameter' };
  if (K === 'PP') return { kind: 'dist' };
  if (K === 'PL' || K === 'LP') return { kind: 'pldist' };
  if (K === 'LL') return { kind: 'angle' };
  return null;
}

// Base point of a dimension; its label sits at base + c.lp (lp = offset the user dragged it to).
export function dimBase(H, c) {
  const pt = ref => {
    const k = refKind(ref);
    if (k === 'P') return H.point(ref);
    if (k === 'L') { const [a, b] = ref === 'xaxis' ? [[0, 0], [10, 0]] : ref === 'yaxis' ? [[0, 0], [0, 10]] : H.line(ref); return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2]; }
    return H.circle(ref).c;
  };
  const a = pt(c.refs[0]), b = c.refs[1] ? pt(c.refs[1]) : null;
  if (c.kind === 'diameter' || c.kind === 'radius' || !b) return a;
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}
