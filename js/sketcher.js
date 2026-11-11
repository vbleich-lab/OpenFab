// Interactive 2D sketching on an arbitrary sketch plane (local u/v coordinates):
// drawing tools, handle selection (points, lines, circles), dragging through
// the constraint solver and automatic coincidence when snapping.
import * as THREE from 'three';
import { state, feature, uid } from './state.js';
import { distToEntity, arcPts, splinePts, entityPoly } from './profiles.js';
import { basis, planeMatrix, toLocal, toWorld } from './plane.js';
import { sketchHandles, refKind, refEntity, dimensionFor, dimBase } from './solver.js';
import { trimAt, extendAt, remapConstraints } from './trim.js';
import { cornerAt, cornerPreview } from './sketchcorner.js';
import { offsetHit, offsetCurves } from './sketchoffset.js';
import { entityOutlines, mirrorEntity, translateEntity, rotateEntity } from './profiles.js';
import { centerRect, rect3, circle2, circleThrough, centerArc, endTangent, tangentArc } from './sketchtools.js';

const r2 = v => Math.round(v * 100) / 100;

function segDist([px, py], [ax, ay], [bx, by]) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export class Sketcher {
  constructor(vp, hooks) {
    this.vp = vp;
    this.hooks = hooks; // { changed, tip, resolve, commitSketch, dragSolve, preview }
    this.tool = 'line';
    this.pts = [];
    this.ptRefs = [];
    this.cur = null;
    this.snapRef = null;
    this.selection = [];
    this.selected = null;
    this.selConstraint = null;
    this.override = null;
    this.dim = null;        // dimension tool: { refs } picked so far
    this.dimPreview = null; // dimension following the mouse
    this.hoverRef = null;
    this.cornerVal = { fillet: 3, chamfer: 1 }; // last value of the corner tools (preview and prompt)
    this.offsetVal = 2; // last offset distance (preview and prompt)
    this.xformIds = []; // entities the mirror / pattern tools work on (set when the tool starts)
    this.patternVal = { nx: 3, ny: 1, n: 6, ang: 360 }; // last pattern counts (preview and prompt)
    this.xbase = null; // move / rotate tools: the first clicked point (start of the move, pivot of the turn)
    this.locks = {};        // values typed while drawing
    this.segDims = [];      // typed line lengths, per polyline segment
    this.inp = null;        // value boxes while drawing
    this.preview = new THREE.Group();
    this.preview.matrixAutoUpdate = false;
    vp.overlay.add(this.preview);

    const c = vp.canvas;
    c.addEventListener('pointerdown', e => this.onDown(e));
    c.addEventListener('pointermove', e => { if (this.active) this.move(e); });
    c.addEventListener('pointerup', e => this.onUp(e));
    c.addEventListener('pointerleave', () => this.active && this.hooks.tip(null));
  }

  // Geometry comes from the solved, parameter-resolved sketch; edits go to the raw one by id.
  get sketch() { return state.sketchId ? (this.hooks.resolve ? this.hooks.resolve(state.sketchId) : feature(state.sketchId)) : null; }
  get active() { return !!this.sketch; }
  get entities() { return this.override || this.sketch.entities; }

  start() {
    this.pts = [];
    this.ptRefs = [];
    this.selection = [];
    this.selected = null;
    this.selConstraint = null;
    this.tool = 'line';
    this.vp.controls.enableRotate = false;
    this.syncPlane();
  }

  syncPlane() {
    const b = basis(this.sketch);
    this.basis = b;
    this.preview.matrix.copy(planeMatrix(this.sketch));
    // GridHelper lies in its local XZ plane: map X->x, Y->n, Z->-y.
    const g = this.vp.grid;
    g.matrixAutoUpdate = false;
    g.matrix.makeBasis(b.x, b.n, b.y.clone().negate()).setPosition(b.o);
  }

  stop() {
    this.closeInputs();
    this.dim = null;
    this.dimPreview = null;
    this.hoverRef = null;
    this.pts = [];
    this.selection = [];
    this.selected = null;
    this.override = null;
    this.drag = null;
    this.vp.clear(this.preview);
    this.vp.controls.enableRotate = true;
    this.vp.resetGrid();
    this.hooks.tip(null);
  }

  setTool(t) {
    // the dimension tool starts with a fitting selection (line, circle, two points ...)
    const sel = this.selection.slice();
    this.dim = t === 'dim' ? { refs: dimensionFor(sel) || (sel.length === 1 && refKind(sel[0]) === 'P') ? sel : [] } : null;
    this.dimPreview = null;
    this.hoverRef = null;
    this.tool = t;
    this.resetDrawing();
    this.hooks.tip(null);
    if (t !== 'select') { this.selection = []; this.selected = null; }
    this.drawPreview();
    this.hooks.changed();
  }

  localPoint(e) {
    this.syncPlane();
    const b = this.basis;
    const p = this.vp.raycastPlaneN(e, b.n, b.o);
    return p ? toLocal(b, p) : null;
  }

  snap([x, y]) {
    const tol = this.vp.worldPerPixel() * 9;
    let best = null, bd = tol;
    const H = sketchHandles(this.entities);
    const cands = H.points.map(h => ({ p: h.p, ref: h.ref }));
    if (this.pts.length) cands.push({ p: this.pts[0], ref: null, first: true });
    for (const q of cands) {
      const d = Math.hypot(q.p[0] - x, q.p[1] - y);
      if (d < bd) { bd = d; best = q; }
    }
    this.snapped = !!best;
    this.snapRef = best ? best.ref : null;
    if (best) return [best.p[0], best.p[1]];
    const s = state.snap > 0 ? state.snap : 0.01;
    return [r2(Math.round(x / s) * s), r2(Math.round(y / s) * s)];
  }

  resetDrawing() {
    this.pts = [];
    this.ptRefs = [];
    this.locks = {};
    this.segDims = [];
    this.closeInputs();
  }

  // nearest handle: points first, then lines, circles, finally whole entities
  pick([x, y]) {
    const wpp = this.vp.worldPerPixel();
    const H = sketchHandles(this.entities);
    let best = null, bd = wpp * 9;
    for (const h of H.points) { const d = Math.hypot(h.p[0] - x, h.p[1] - y); if (d < bd) { bd = d; best = h.ref; } }
    if (best) return best;
    bd = wpp * 7;
    for (const l of H.lines) { const d = segDist([x, y], l.a, l.b); if (d < bd) { bd = d; best = l.ref; } }
    const onSpan = c => {
      if (!c.span) return true;
      const t = Math.atan2(y - c.c[1], x - c.c[0]), TAU = Math.PI * 2, n = v => ((v % TAU) + TAU) % TAU;
      const d = c.span.sw >= 0 ? n(t - c.span.a0) : n(c.span.a0 - t);
      return d <= Math.abs(c.span.sw);
    };
    for (const c of H.circles) { if (!onSpan(c)) continue; const d = Math.abs(Math.hypot(x - c.c[0], y - c.c[1]) - c.r); if (d < bd) { bd = d; best = c.ref; } }
    if (best) return best;
    if (Math.abs(y) < wpp * 6) return 'xaxis';
    if (Math.abs(x) < wpp * 6) return 'yaxis';
    for (const e of this.entities) {
      if (distToEntity(e, [x, y]) < wpp * 8) return e.type === 'text' ? `${e.id}:p0` : `${e.id}:c`;
    }
    return null;
  }

  // points that move when a handle is dragged
  dragPoints(ref) {
    const kind = refKind(ref);
    const id = refEntity(ref);
    const e = this.entities.find(x => x.id === id);
    if (kind === 'P') return [ref];
    if (kind === 'O') return [`${id}:c`];
    if (kind === 'L') {
      const k = +ref.split(':')[1].slice(1);
      if (e.type === 'poly') return [`${id}:p${k}`, `${id}:p${(k + 1) % e.pts.length}`];
      if (e.type === 'rect') return [`${id}:p${k}`, `${id}:p${(k + 1) % 4}`];
      if (e.type === 'slot') return [`${id}:p0`, `${id}:p1`];
    }
    return [];
  }

  onDown(e) {
    this.down = [e.clientX, e.clientY, e.button];
    this.swipe = null;
    // trim by swiping (common CAD/CAM): hold the button and drag across everything that should go
    if (this.active && this.tool === 'trim' && e.button === 0) { this.swipe = { on: false, n: 0 }; return; }
    if (!this.active || this.tool !== 'select' || e.button !== 0) return;
    const p = this.localPoint(e);
    if (!p) return;
    const ref = this.pick(p);
    if (!ref || ref === 'origin' || ref === 'xaxis' || ref === 'yaxis') return;
    const H = sketchHandles(this.entities);
    const pts = this.dragPoints(ref).map(r => ({ ref: r, p0: H.point(r) }));
    if (pts.length) this.dragCand = { start: p, pts };
  }

  onUp(e) {
    if (!this.active || !this.down) return;
    const [x, y, b] = this.down;
    this.down = null;
    if (this.swipe?.on) { const n = this.swipe.n; this.swipe = null; this.hooks.status?.(n ? `${n} Stück(e) gestutzt` : 'Stutzen: nichts überfahren'); return; }
    this.swipe = null;
    if (this.drag) {
      const ents = this.override;
      this.drag = null;
      this.dragCand = null;
      this.override = null;
      this.hooks.tip(null);
      if (ents) this.hooks.commitDrag(ents);
      return;
    }
    this.dragCand = null;
    if (b === 0 && Math.hypot(e.clientX - x, e.clientY - y) < 5) this.click(e);
  }

  move(e) {
    const p = this.localPoint(e);
    if (!p) return;
    if (this.dragCand && this.down && Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) >= 4) this.drag = this.dragCand;
    if (this.drag) {
      const d = [p[0] - this.drag.start[0], p[1] - this.drag.start[1]];
      const targets = this.drag.pts.map(q => ({ ref: q.ref, to: [q.p0[0] + d[0], q.p0[1] + d[1]] }));
      this.override = this.hooks.dragSolve(targets);
      this.hooks.preview();
      this.hooks.tip(`Δ ${r2(d[0])}, ${r2(d[1])}`, e);
      return;
    }
    if (this.tool === 'dim') {
      const ref = this.pick(p);
      const hov = ref && !this.dim.refs.includes(ref) ? ref : null;
      const pv = this.dim.refs.length ? this.dimFromMouse(p) : null;
      const changed = hov !== this.hoverRef || pv || this.dimPreview;
      this.hoverRef = hov;
      this.dimPreview = pv;
      if (changed) this.hooks.overlay();
      this.hooks.tip(pv ? 'Klicken: Bemaßung hier ablegen' : this.dim.refs.length ? 'Zweites Element wählen' : 'Linie, Kreis oder Punkt wählen', e);
      return;
    }
    if (this.tool === 'xmove' || this.tool === 'xrot') {
      this.cur = this.snap(p);
      this.drawPreview();
      const q = this.xbase && this.xformValue(this.cur), c = v => String(+(+v).toFixed(2)).replace('.', ',');
      this.hooks.tip(this.tool === 'xmove'
        ? (q ? `Klicken: um X ${c(q.dx)} / Y ${c(q.dy)} mm verschieben · Esc beendet` : 'Ausgangspunkt anklicken · Esc beendet')
        : (q ? `Klicken: um ${c(q.ang)}° drehen · Esc beendet` : 'Drehpunkt anklicken · Esc beendet'), e);
      return;
    }
    if (this.tool === 'mirror' || this.tool === 'prect' || this.tool === 'pcirc') {
      this.cur = this.tool === 'mirror' ? p : this.snap(p);
      this.drawPreview();
      const ax = this.tool === 'mirror' && this.axisAt(p);
      this.hooks.tip(this.tool === 'mirror' ? (ax ? 'Klicken: an dieser Linie spiegeln' : 'Spiegelachse: über eine Linie fahren und klicken · Esc beendet')
        : this.tool === 'prect' ? `Klicken: Abstand der ersten Kopie (${this.patternVal.nx} × ${this.patternVal.ny}) · Esc beendet` : `Klicken: Mittelpunkt des Kreismusters (${this.patternVal.n} Stück) · Esc beendet`, e);
      return;
    }
    if (this.tool === 'offset') {
      this.cur = p;
      const hit = offsetHit(this.entities, p, this.vp.worldPerPixel() * 60);
      this.drawPreview();
      this.hooks.tip(hit ? `Klicken: Versatz ${this.offsetVal} mm auf dieser Seite` : 'Mit der Maus neben eine Kontur fahren (die Seite bestimmt die Richtung) · Esc beendet', e);
      return;
    }
    if (this.tool === 'fillet' || this.tool === 'chamfer') {
      this.cur = p;
      const c = cornerAt(this.entities, p, this.vp.worldPerPixel() * 16);
      this.drawPreview();
      const v = this.cornerVal[this.tool];
      this.hooks.tip(c ? `Klicken: ${this.tool === 'fillet' ? 'Abrundung R' : 'Fase '}${Array.isArray(v) ? v.join('/') : v} an dieser Ecke` : 'Ecke anklicken (Linienzug, Rechteck, zwei Linien) · Esc beendet', e);
      return;
    }
    if (this.tool === 'trim' && this.swipe && this.down && (this.swipe.on || Math.hypot(e.clientX - this.down[0], e.clientY - this.down[1]) >= 5)) {
      // everything the mouse passes over goes: tested along the way from the last position, so fast moves miss nothing
      const sw = this.swipe, from = sw.last || p, tol = this.vp.worldPerPixel() * 3;
      sw.on = true;
      const L = Math.hypot(p[0] - from[0], p[1] - from[1]), n = Math.min(200, Math.max(1, Math.ceil(L / (tol * 1.5))));
      for (let i = 1; i <= n; i++) {
        const q = [from[0] + ((p[0] - from[0]) * i) / n, from[1] + ((p[1] - from[1]) * i) / n];
        const r = trimAt(this.entities, q, tol);
        if (r && !r.unsupported && this.trimClick(q, tol)) sw.n++;
      }
      sw.last = p;
      this.cur = null;
      this.drawPreview();
      this.hooks.tip('Loslassen beendet das Stutzen', e);
      return;
    }
    if (this.tool === 'trim' || this.tool === 'extend') {
      this.cur = p;
      this.drawPreview();
      this.hooks.tip(this.tool === 'trim' ? 'Klicken: rot markiertes Stück entfernen · gedrückt ziehen: alles Überfahrene stutzen' : 'Klicken: Ende bis zur nächsten Kante verlängern', e);
      return;
    }
    this.rawCur = this.snap(p);
    const [lp, changed] = this.applyLocks(this.rawCur);
    if (changed) this.snapped = false;
    this.cur = lp;
    this.drawPreview();
    this.updateInputs();
    this.hooks.tip(this.inp ? null : this.tipText(), e);
  }

  // ---------- dimension tool ----------
  // Like the mouse position decides between aligned, horizontal and vertical.
  dimFromMouse(p) {
    const refs = this.dim.refs, H = sketchHandles(this.entities);
    const K = refs.map(refKind).join('');
    const region = (a, b) => {
      const inX = p[0] > Math.min(a[0], b[0]) && p[0] < Math.max(a[0], b[0]);
      const inY = p[1] > Math.min(a[1], b[1]) && p[1] < Math.max(a[1], b[1]);
      return inX && !inY ? 'h' : !inX && inY ? 'v' : 'a';
    };
    let kind, rr = refs;
    try {
      if (K === 'L') {
        if (refs[0] === 'xaxis' || refs[0] === 'yaxis') return null;
        const [a, b] = H.line(refs[0]);
        kind = 'length';
        const ends = this.dragPoints(refs[0]);
        if (Math.abs(a[0] - b[0]) > 1e-6 && Math.abs(a[1] - b[1]) > 1e-6 && ends.length === 2) {
          const r = region(a, b);
          if (r === 'h') { kind = 'hdist'; rr = ends; } else if (r === 'v') { kind = 'vdist'; rr = ends; }
        }
      } else if (K === 'O') kind = 'diameter';
      else if (K === 'PP') { const r = region(H.point(refs[0]), H.point(refs[1])); kind = r === 'h' ? 'hdist' : r === 'v' ? 'vdist' : 'dist'; }
      else { const d = dimensionFor(refs); if (!d) return null; kind = d.kind; if (kind === 'diameter' && this.entities.find(e => e.id === refs[0].split(':')[0])?.curve === 'arc') kind = 'radius'; }
      const c = { kind, refs: rr };
      const base = dimBase(H, c);
      return { ...c, lp: [p[0] - base[0], p[1] - base[1]] };
    } catch { return null; }
  }

  dimClick(raw) {
    const ref = this.pick(raw);
    const refs = this.dim.refs;
    const ownEnd = ref && refs.some(r => this.dragPoints(r).includes(ref));
    if (ref && !refs.includes(ref) && !ownEnd && refs.length < 2 && (!refs.length || dimensionFor([...refs, ref]))) {
      refs.push(ref);
      this.hoverRef = null;
      this.dimPreview = this.dimFromMouse(raw);
      this.hooks.overlay();
      return;
    }
    if (this.dimPreview) {
      const d = this.dimPreview;
      this.dim = { refs: [] };
      this.dimPreview = null;
      this.hoverRef = null;
      this.hooks.addDim(d);
      return;
    }
    if (!ref) { this.dim.refs = []; this.hooks.overlay(); }
  }

  // ---------- value boxes while drawing (type a number, Tab = next box, Enter = done) ----------
  inputFields() {
    const a = this.pts[0], c = this.cur;
    if (!a || !c) return null;
    const mid = (p, q) => [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    if (this.tool === 'rect') return [
      { key: 'w', at: [(a[0] + c[0]) / 2, Math.min(a[1], c[1])], side: 'below', val: Math.abs(c[0] - a[0]) },
      { key: 'h', at: [Math.max(a[0], c[0]), (a[1] + c[1]) / 2], side: 'right', val: Math.abs(c[1] - a[1]) }];
    if (this.tool === 'circle') return [{ key: 'd', pre: 'Ø', at: mid(a, c), side: 'center', val: 2 * Math.hypot(c[0] - a[0], c[1] - a[1]) }];
    if (this.tool === 'ngon') return [{ key: 'r', pre: 'R', at: mid(a, c), side: 'center', val: Math.hypot(c[0] - a[0], c[1] - a[1]) }];
    if (this.tool === 'slot' && this.pts.length === 1) return [{ key: 'len', at: mid(a, c), side: 'center', val: Math.hypot(c[0] - a[0], c[1] - a[1]) }];
    if (this.tool === 'line') {
      const b = this.pts[this.pts.length - 1];
      return [{ key: 'len', at: mid(b, c), side: 'center', val: Math.hypot(c[0] - b[0], c[1] - b[1]) },
        { key: 'ang', unit: '°', at: b, side: 'right', val: (Math.atan2(c[1] - b[1], c[0] - b[0]) * 180) / Math.PI }];
    }
    return null;
  }

  // the cursor point with the typed values applied
  applyLocks(pt) {
    const L = this.locks, a = this.pts[0];
    if (!a || !Object.keys(L).length) return [pt, false];
    let [x, y] = pt;
    const dirTo = (o, q) => { const d = Math.hypot(q[0] - o[0], q[1] - o[1]); return d > 1e-9 ? [(q[0] - o[0]) / d, (q[1] - o[1]) / d] : [1, 0]; };
    if (this.tool === 'rect') {
      if (L.w != null) x = a[0] + (Math.sign(x - a[0]) || 1) * L.w;
      if (L.h != null) y = a[1] + (Math.sign(y - a[1]) || 1) * L.h;
    } else if (this.tool === 'circle' && L.d != null) { const d = dirTo(a, pt); x = a[0] + (d[0] * L.d) / 2; y = a[1] + (d[1] * L.d) / 2; }
    else if (this.tool === 'ngon' && L.r != null) { const d = dirTo(a, pt); x = a[0] + d[0] * L.r; y = a[1] + d[1] * L.r; }
    else if (this.tool === 'slot' && this.pts.length === 1 && L.len != null) { const d = dirTo(a, pt); x = a[0] + d[0] * L.len; y = a[1] + d[1] * L.len; }
    else if (this.tool === 'line') {
      const b = this.pts[this.pts.length - 1];
      const len = L.len ?? Math.hypot(x - b[0], y - b[1]);
      const ang = L.ang != null ? (L.ang * Math.PI) / 180 : Math.atan2(y - b[1], x - b[0]);
      x = b[0] + len * Math.cos(ang);
      y = b[1] + len * Math.sin(ang);
    }
    const out = [+x.toFixed(6), +y.toFixed(6)];
    return [out, out[0] !== pt[0] || out[1] !== pt[1]];
  }

  closeInputs() {
    if (this.inp) this.inp.el.remove();
    this.inp = null;
  }

  updateInputs() {
    const fields = this.active ? this.inputFields() : null;
    if (!fields) { this.closeInputs(); return; }
    const host = this.vp.el;
    if (!this.inp || this.inp.tool !== this.tool || this.inp.n !== fields.length) {
      this.closeInputs();
      if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
      const el = document.createElement('div');
      el.className = 'sk-inputs';
      const boxes = fields.map((f, i) => {
        const box = document.createElement('label');
        box.className = 'sk-in ' + f.side;
        box.innerHTML = `${f.pre ? `<b>${f.pre}</b>` : ''}<input type="text" spellcheck="false"><i>${f.unit || 'mm'}</i>`;
        const input = box.querySelector('input');
        input.addEventListener('pointerdown', ev => ev.stopPropagation());
        input.addEventListener('input', () => {
          const v = this.parseNum(input.value);
          if (v == null) delete this.locks[f.key]; else this.locks[f.key] = v;
          box.classList.toggle('locked', v != null);
          this.reapply();
        });
        input.addEventListener('keydown', ev => {
          ev.stopPropagation();
          if (ev.key === 'Tab') {
            ev.preventDefault();
            const v = this.parseNum(input.value);
            if (v != null) { this.locks[f.key] = v; box.classList.add('locked'); }
            const bs = this.inp.boxes;
            const next = bs[(i + (ev.shiftKey ? -1 : 1) + bs.length) % bs.length];
            next.input.focus();
            next.input.select();
            this.reapply();
          } else if (ev.key === 'Enter') {
            ev.preventDefault();
            const v = this.parseNum(input.value);
            if (v != null) this.locks[f.key] = v;
            this.reapply();
            input.blur();
            this.place(this.cur, null);
          } else if (ev.key === 'Escape') {
            ev.preventDefault();
            input.blur();
            this.resetDrawing();
            this.drawPreview();
          }
        });
        el.append(box);
        return { box, input, key: f.key };
      });
      host.append(el);
      this.inp = { el, boxes, tool: this.tool, n: fields.length };
    }
    fields.forEach((f, i) => {
      const { box, input } = this.inp.boxes[i];
      if (document.activeElement !== input && this.locks[f.key] == null) input.value = r2(f.val);
      const sp = this.vp.screenPos(toWorld(this.basis, f.at[0], f.at[1]));
      box.style.left = sp.x + 'px';
      box.style.top = sp.y + 'px';
    });
  }

  reapply() {
    if (!this.rawCur) return;
    this.cur = this.applyLocks(this.rawCur)[0];
    this.drawPreview();
    this.updateInputs();
  }

  parseNum(t) {
    const str = String(t).trim().replace(',', '.');
    if (!str) return null;
    const v = this.hooks.evalNum ? this.hooks.evalNum(str) : +str;
    return Number.isFinite(v) ? v : null;
  }

  // typing a number while drawing jumps into the first open value box
  focusInput(e) {
    if (!this.inp || !/^[0-9.,-]$/.test(e.key) || e.ctrlKey || e.metaKey || e.altKey) return false;
    const b = this.inp.boxes.find(x => this.locks[x.key] == null) || this.inp.boxes[0];
    b.input.focus();
    b.input.select();
    return true;
  }

  tipText() {
    const [x, y] = this.cur;
    const a = this.pts[0];
    if (this.tool === 'rect' && a) return `${r2(Math.abs(x - a[0]))} × ${r2(Math.abs(y - a[1]))} mm`;
    if ((this.tool === 'circle' || this.tool === 'ngon') && a) {
      const r = Math.hypot(x - a[0], y - a[1]);
      return this.tool === 'circle' ? `Ø ${r2(2 * r)} mm` : `R ${r2(r)} mm`;
    }
    if (this.tool === 'slot' && a) {
      if (this.pts.length === 1) return `Länge ${r2(Math.hypot(x - a[0], y - a[1]))} mm`;
      return `Breite ${r2(2 * this.slotHalfWidth())} mm`;
    }
    if (this.tool === 'ellipse' && a) {
      if (this.pts.length === 1) return `Halbachse ${r2(Math.hypot(x - a[0], y - a[1]))} mm`;
      return `Halbachse 2: ${r2(this.ellipseMinor())} mm`;
    }
    if (this.tool === 'arc' && a) return this.pts.length === 1 ? `Sehne ${r2(Math.hypot(x - a[0], y - a[1]))} mm` : 'Punkt auf dem Bogen';
    if (this.tool === 'line' && this.pts.length) {
      const b = this.pts[this.pts.length - 1];
      const len = Math.hypot(x - b[0], y - b[1]);
      const ang = (Math.atan2(y - b[1], x - b[0]) * 180) / Math.PI;
      return `${r2(len)} mm  ∠ ${r2(ang)}°`;
    }
    return `${r2(x)}, ${r2(y)}`;
  }

  slotHalfWidth() {
    const [a, b] = this.pts;
    const [x, y] = this.cur;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    return Math.abs(((x - a[0]) * dy - (y - a[1]) * dx) / L);
  }

  ellipseMinor() {
    const [a, b] = this.pts;
    const [x, y] = this.cur;
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const L = Math.hypot(dx, dy) || 1;
    return Math.abs(((x - a[0]) * dy - (y - a[1]) * dx) / L);
  }

  // a single straight line under p that can serve as a mirror axis (not one of the entities being mirrored)
  axisAt(p) {
    const tol = this.vp.worldPerPixel() * 12;
    let best = null, bd = tol;
    for (const x of this.entities) {
      if (x.type !== 'poly' || x.pts.length !== 2 || x.curve || this.xformIds.includes(x.id)) continue;
      const a = x.pts[0].map(Number), b = x.pts[1].map(Number), dx = b[0] - a[0], dy = b[1] - a[1], L2 = dx * dx + dy * dy;
      if (L2 < 1e-12) continue;
      const u = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / L2)), d = Math.hypot(p[0] - a[0] - u * dx, p[1] - a[1] - u * dy);
      if (d < bd) { bd = d; best = x; }
    }
    return best;
  }
  // a spacing that is almost along X or Y is taken as exactly along it
  axisLock(dx, dy) { return Math.abs(dy) <= 0.1 * Math.abs(dx) ? [dx, 0] : Math.abs(dx) <= 0.1 * Math.abs(dy) ? [0, dy] : [dx, dy]; }
  // middle of the entities a pattern starts from (the mouse gives the spacing from here)
  xformOrigin() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const id of this.xformIds) { const x = this.entities.find(q => q.id === id); if (x) for (const o of entityOutlines(x)) for (const [px, py] of o.pts) { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); } }
    return Number.isFinite(x0) ? [(x0 + x1) / 2, (y0 + y1) / 2] : [0, 0];
  }

  // what the move / rotate tool would do with the mouse at sp: { dx, dy } or { c, ang } (angle in steps of 1°,
  // measured from the direction pivot → middle of the elements, or from +X when the pivot is that middle)
  xformValue(sp) {
    const b = this.xbase;
    if (!b) return null;
    if (this.tool === 'xmove') { const [dx, dy] = this.axisLock(sp[0] - b[0], sp[1] - b[1]); return { dx: +dx.toFixed(3), dy: +dy.toFixed(3) }; }
    const o = this.xformOrigin(), ref = Math.hypot(o[0] - b[0], o[1] - b[1]) > 1e-6 ? Math.atan2(o[1] - b[1], o[0] - b[0]) : 0;
    if (Math.hypot(sp[0] - b[0], sp[1] - b[1]) < 1e-9) return { c: b, ang: 0 };
    let ang = ((Math.atan2(sp[1] - b[1], sp[0] - b[0]) - ref) * 180) / Math.PI;
    ang = Math.round((((ang + 180) % 360) + 360) % 360 - 180);
    return { c: [+b[0].toFixed(3), +b[1].toFixed(3)], ang };
  }

  click(e) {
    const raw = this.localPoint(e);
    if (!raw) return;

    if (this.tool === 'xmove' || this.tool === 'xrot') {
      const sp = this.snap(raw);
      if (!this.xbase) { this.xbase = sp; this.cur = sp; this.drawPreview(); return; }
      const q = this.xformValue(sp);
      this.xbase = null;
      this.hooks.xform?.(this.tool, q);
      return;
    }

    if (this.tool === 'project') { this.hooks.project(e); return; }

    if (this.tool === 'dim') { this.dimClick(raw); return; }

    if (this.tool === 'trim') { this.trimClick(raw); return; }
    if (this.tool === 'mirror') {
      const ax = this.axisAt(raw);
      if (!ax) { this.hooks.status?.('Keine Linie hier – eine einzelne gerade Linie (auch Konstruktionslinie) als Spiegelachse anklicken.'); return; }
      this.hooks.xform?.('mirror', { axis: ax.id });
      return;
    }
    if (this.tool === 'prect' || this.tool === 'pcirc') {
      const sp = this.snap(raw), o = this.xformOrigin();
      const [ldx, ldy] = this.axisLock(sp[0] - o[0], sp[1] - o[1]);
      this.hooks.xform?.(this.tool, this.tool === 'prect' ? { dx: +ldx.toFixed(3), dy: +ldy.toFixed(3) } : { c: [+sp[0].toFixed(3), +sp[1].toFixed(3)] });
      return;
    }
    if (this.tool === 'offset') {
      const hit = offsetHit(this.entities, raw, this.vp.worldPerPixel() * 60);
      if (!hit) { this.hooks.status?.('Keine Kontur in der Nähe – neben eine Linie, ein Rechteck oder einen Kreis klicken.'); return; }
      this.hooks.offset?.(hit.e.id, hit.sign);
      return;
    }
    if (this.tool === 'fillet' || this.tool === 'chamfer') {
      const c = cornerAt(this.entities, raw, this.vp.worldPerPixel() * 16);
      if (!c) { this.hooks.status?.('Keine Ecke hier – Eckpunkt eines Linienzugs, Rechtecks oder Treffpunkt zweier Linien anklicken.'); return; }
      this.hooks.corner?.(this.tool, c.ref);
      return;
    }
    if (this.tool === 'extend') { this.extendClick(raw); return; }

    if (this.tool === 'select') {
      const ref = this.pick(raw);
      if (e.shiftKey && ref) {
        const i = this.selection.indexOf(ref);
        if (i >= 0) this.selection.splice(i, 1); else this.selection.push(ref);
      } else this.selection = ref ? [ref] : [];
      const last = this.selection[this.selection.length - 1];
      this.selected = last ? refEntity(last) : null;
      this.selConstraint = null;
      this.hooks.changed();
      return;
    }

    const sp = this.snap(raw);
    const [pt, locked] = this.applyLocks(sp);
    this.place(pt, locked ? null : this.snapRef);
  }

  // next point of the active drawing tool (mouse click, or Enter in a value box)
  place(pt, sref) {
    const L = this.locks;
    this.locks = {};
    if (this.inp) for (const b of this.inp.boxes) b.box.classList.remove('locked');
    const off = 22 * this.vp.worldPerPixel();

    if (this.tool === 'text') {
      this.add({ type: 'text', x: pt[0], y: pt[1], text: 'Text', size: 10, font: 'sans', rot: 0 }, sref ? [['p0', sref]] : []);
      this.tool = 'select';
      this.hooks.changed();
      return;
    }

    if (this.tool === 'spline') {
      if (this.pts.length >= 3 && Math.hypot(pt[0] - this.pts[0][0], pt[1] - this.pts[0][1]) < 1e-6) {
        this.addPoly(true, 'spline');
      } else {
        const last = this.pts[this.pts.length - 1];
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) { this.pts.push(pt); this.ptRefs.push(sref); }
      }
      this.drawPreview();
      return;
    }

    if (this.tool === 'arc') {
      if (this.pts.length < 2) { this.pts.push(pt); this.ptRefs.push(sref); this.drawPreview(); return; }
      const [a, b] = this.pts;
      const refs = this.ptRefs;
      this.pts = [];
      this.ptRefs = [];
      // stored as start, point on arc, end
      this.add({ type: 'poly', curve: 'arc', pts: [a, pt, b], closed: false }, [['p0', refs[0]], ['p1', sref], ['p2', refs[1]]].filter(x => x[1]));
      this.drawPreview();
      return;
    }

    if (this.tool === 'ellipse') {
      if (this.pts.length < 2) { this.pts.push(pt); this.ptRefs.push(sref); this.drawPreview(); return; }
      const [a, b] = this.pts;
      const ry = r2(this.ellipseMinor());
      const rx = r2(Math.hypot(b[0] - a[0], b[1] - a[1]));
      const aref = this.ptRefs[0];
      this.pts = [];
      this.ptRefs = [];
      if (rx > 0 && ry > 0) this.add({ type: 'ellipse', cx: a[0], cy: a[1], rx, ry, rot: r2((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) }, aref ? [['c', aref]] : []);
      this.drawPreview();
      return;
    }

    if (this.tool === 'line') {
      if (this.pts.length >= 3 && Math.hypot(pt[0] - this.pts[0][0], pt[1] - this.pts[0][1]) < 1e-6) {
        this.addPoly(true);
      } else {
        const last = this.pts[this.pts.length - 1];
        if (!last || last[0] !== pt[0] || last[1] !== pt[1]) {
          this.pts.push(pt);
          this.ptRefs.push(sref);
          if (L.len != null && this.pts.length >= 2) this.segDims.push({ k: this.pts.length - 2, value: L.len });
        }
      }
      this.cur = pt;
      this.drawPreview();
      this.updateInputs();
      return;
    }

    if (this.tool === 'slot') {
      if (this.pts.length < 2) { this.pts.push(pt); this.ptRefs.push(sref); this.cur = pt; this.drawPreview(); this.updateInputs(); return; }
      const [a, b] = this.pts;
      const w = r2(2 * this.slotHalfWidth());
      const refs = this.ptRefs;
      this.resetDrawing();
      if (w > 0) this.add({ type: 'slot', cx: r2((a[0] + b[0]) / 2), cy: r2((a[1] + b[1]) / 2), len: r2(Math.hypot(b[0] - a[0], b[1] - a[1])), w, rot: r2((Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI) },
        [['p0', refs[0]], ['p1', refs[1]]].filter(x => x[1]));
      this.drawPreview();
      return;
    }

    // tangent arc: starts at the end of a line or arc and continues it smoothly
    if (this.tool === 'arct') {
      if (!this.pts.length) {
        const t = endTangent(this.entities, sref);
        if (!t) { this.hooks.status?.('Tangentialbogen: am offenen Ende einer Linie oder eines Bogens beginnen (der Punkt rastet ein).'); return; }
        this.pts = [t.p];
        this.ptRefs = [sref];
        this.arcT = t.T;
        this.arcFrom = t.curve;
        this.cur = pt;
        this.drawPreview();
        return;
      }
      const q = tangentArc(this.pts[0], this.arcT, pt), r0 = this.ptRefs[0];
      this.resetDrawing();
      if (q) this.add({ type: 'poly', curve: 'arc', pts: q, closed: false }, [['p0', r0], ['p2', sref]].filter(x => x[1]), [], this.arcFrom ? [['tangent', 'o', this.arcFrom]] : []);
      this.drawPreview();
      return;
    }

    // three clicks: 3-point rectangle (edge, then width), 3-point circle, centre-point arc (centre, start, end)
    if (this.tool === 'rect3' || this.tool === 'circle3' || this.tool === 'arcc') {
      if (this.pts.length < 2) { this.pts.push(pt); this.ptRefs.push(sref); this.cur = pt; this.drawPreview(); return; }
      const [a, b] = this.pts, refs = this.ptRefs;
      this.resetDrawing();
      if (this.tool === 'rect3') { const q = rect3(a, b, pt); if (q) this.add({ type: 'poly', pts: q, closed: true }, [['p0', refs[0]], ['p1', refs[1]]].filter(x => x[1])); }
      else if (this.tool === 'circle3') { const k = circleThrough(a, b, pt); if (k) this.add({ type: 'circle', ...k }); }
      else { const q = centerArc(a, b, pt); if (q) this.add({ type: 'poly', curve: 'arc', pts: q, closed: false }, [['p0', refs[1]]].filter(x => x[1])); }
      this.drawPreview();
      return;
    }

    if (!this.pts.length) {
      this.pts = [pt];
      this.ptRefs = [sref];
      this.cur = pt;
      this.updateInputs();
      return;
    }
    const a = this.pts[0], aref = this.ptRefs[0];
    this.resetDrawing();
    // typed values become dimensions (like common CAD/CAM)
    if (this.tool === 'rect') {
      const w = Math.abs(pt[0] - a[0]), h = Math.abs(pt[1] - a[1]);
      // corner index of the first click in the normalised rectangle
      const k = a[0] <= pt[0] ? (a[1] <= pt[1] ? 0 : 3) : (a[1] <= pt[1] ? 1 : 2);
      const dims = [];
      if (L.w != null) dims.push({ kind: 'length', key: 'l0', value: L.w, lp: [0, -off] });
      if (L.h != null) dims.push({ kind: 'length', key: 'l1', value: L.h, lp: [off, 0] });
      if (w > 0 && h > 0) this.add({ type: 'rect', x: Math.min(a[0], pt[0]), y: Math.min(a[1], pt[1]), w: L.w ?? r2(w), h: L.h ?? r2(h), r: 0 },
        [[`p${k}`, aref], [`p${(k + 2) % 4}`, sref]].filter(x => x[1]), dims);
    } else if (this.tool === 'circle') {
      const r = L.d != null ? L.d / 2 : r2(Math.hypot(pt[0] - a[0], pt[1] - a[1]));
      if (r > 0) this.add({ type: 'circle', cx: a[0], cy: a[1], r }, aref ? [['c', aref]] : [],
        L.d != null ? [{ kind: 'diameter', key: 'o', value: L.d, lp: [(r + off) * 0.707, (r + off) * 0.707] }] : []);
    } else if (this.tool === 'ngon') {
      const r = L.r ?? Math.hypot(pt[0] - a[0], pt[1] - a[1]);
      const rot = (Math.atan2(pt[1] - a[1], pt[0] - a[0]) * 180) / Math.PI - 90;
      if (r > 0) this.add({ type: 'ngon', cx: a[0], cy: a[1], r: L.r ?? r2(r), n: 6, rot: r2(rot) }, aref ? [['c', aref]] : []);
    } else if (this.tool === 'rectc') {
      const k = centerRect(a, pt);
      // corners: p0 (x0,y0), p1 (x1,y0), p2 (x1,y1), p3 (x0,y1); the first click is the centre handle c
      const kc = pt[0] >= a[0] ? (pt[1] >= a[1] ? 2 : 1) : (pt[1] >= a[1] ? 3 : 0);
      if (k.w > 0 && k.h > 0) this.add({ type: 'rect', ...k, r: 0 }, [['c', aref], [`p${kc}`, sref]].filter(x => x[1]));
    } else if (this.tool === 'circle2') {
      const k = circle2(a, pt);
      if (k) this.add({ type: 'circle', ...k });
    }
    this.drawPreview();
  }

  addPoly(closed, curve) {
    const refs = this.ptRefs.map((r, k) => [`p${k}`, r]).filter(x => x[1]);
    const off = 22 * this.vp.worldPerPixel();
    const dims = curve ? [] : this.segDims.map(({ k, value }) => {
      const a = this.pts[k], b = this.pts[(k + 1) % this.pts.length];
      const d = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
      return { kind: 'length', key: `l${k}`, value, lp: [(-(b[1] - a[1]) / d) * off, ((b[0] - a[0]) / d) * off] };
    });
    this.add({ type: 'poly', pts: this.pts, closed, ...(curve ? { curve } : {}) }, refs, dims);
    this.resetDrawing();
  }

  // links: [[own handle key, other ref]] become coincident constraints
  add(ent, links = [], dims = [], extra = []) {
    const id = state.sketchId;
    ent.id = uid('e');
    const cons = links.map(([k, ref]) => ({ id: uid('c'), type: 'coincident', refs: [`${ent.id}:${k}`, ref] }));
    for (const [type, own, other] of extra) cons.push({ id: uid('c'), type, refs: [`${ent.id}:${own}`, other] });
    for (const d of dims) cons.push({ id: uid('c'), type: 'dim', kind: d.kind, refs: [`${ent.id}:${d.key}`], value: +(+d.value).toFixed(4), sign: 1, lp: d.lp.map(v => +v.toFixed(3)) });
    this.hooks.commitSketch(id, sk => {
      sk.entities.push(ent);
      if (cons.length) (sk.constraints ||= []).push(...cons);
    });
    if (ent.type === 'text') { this.selection = [`${ent.id}:p0`]; this.selected = ent.id; }
  }

  finishPolyline() {
    if (this.tool === 'line' && this.pts.length >= 2) this.addPoly(false);
    if (this.tool === 'spline' && this.pts.length >= 2) this.addPoly(false, 'spline');
    this.resetDrawing();
    this.drawPreview();
  }

  // ---------- Stutzen / Verlängern ----------
  trimClick(p, tol = this.vp.worldPerPixel() * 8) {
    const r = trimAt(this.entities, p, tol);
    if (!r) return false;
    if (r.unsupported) { this.hooks.status?.('Stutzen geht bei Linien, Rechtecken, Polygonen, Langlöchern, Bögen und Kreisen (nicht bei Ellipsen, Splines und Text).'); return false; }
    const gone = new Set(r.remove);
    this.selection = [];
    this.selected = null;
    const ids = r.add.map(() => uid('e'));
    this.hooks.commitSketch(state.sketchId, sk => {
      sk.entities = sk.entities.filter(e => !gone.has(e.id));
      // constraints and dimensions of the kept points / edges move to the remaining pieces
      sk.constraints = remapConstraints(sk.constraints, r, ids);
      r.add.forEach(({ map, ...e }, i) => sk.entities.push({ ...e, id: ids[i], pts: e.pts.map(q => [+q[0].toFixed(4), +q[1].toFixed(4)]) }));
    });
    this.cur = null;
    this.drawPreview();
    return true;
  }

  extendClick(p) {
    const r = extendAt(this.entities, p, this.vp.worldPerPixel() * 8);
    if (!r) { this.hooks.status?.('Keine Kante in Verlängerungsrichtung gefunden (geht bei offenen Linien und Bögen).'); return; }
    this.hooks.commitSketch(state.sketchId, sk => {
      const e = sk.entities.find(x => x.id === r.id);
      if (e) e.pts = r.pts.map(q => [+q[0].toFixed(4), +q[1].toFixed(4)]);
    });
    this.drawPreview();
  }

  // common CAD/CAM "Normal/Konstruktion" (X): selected geometry becomes dashed helper geometry and stops forming profiles
  toggleConstruction() {
    const ids = new Set(this.selection.map(refEntity).filter(Boolean));
    if (this.selected) ids.add(this.selected);
    if (!ids.size) return false;
    this.hooks.commitSketch(state.sketchId, sk => {
      const on = !sk.entities.filter(e => ids.has(e.id)).every(e => e.cons);
      for (const e of sk.entities) if (ids.has(e.id)) { if (on) e.cons = true; else delete e.cons; }
    });
    return true;
  }

  deleteSelected() {
    const id = state.sketchId;
    if (this.selConstraint) {
      const cid = this.selConstraint;
      this.selConstraint = null;
      this.hooks.commitSketch(id, sk => { sk.constraints = (sk.constraints || []).filter(c => c.id !== cid); });
      return true;
    }
    const ids = new Set(this.selection.map(refEntity).filter(Boolean));
    if (this.selected) ids.add(this.selected);
    if (!ids.size) return false;
    this.selection = [];
    this.selected = null;
    this.hooks.commitSketch(id, sk => {
      sk.entities = sk.entities.filter(e => !ids.has(e.id));
      sk.constraints = (sk.constraints || []).filter(c => !c.refs.some(r => ids.has(refEntity(r))));
    });
    return true;
  }

  key(e) {
    if (this.focusInput(e)) return 'focus';
    if (e.key === 'Escape') {
      if (this.tool === 'dim' && (this.dim?.refs.length || this.dimPreview)) { this.dim = { refs: [] }; this.dimPreview = null; this.hooks.overlay(); }
      else if (this.pts.length) { this.resetDrawing(); this.drawPreview(); }
      else if (this.selection.length) { this.selection = []; this.selected = null; this.hooks.changed(); }
      else if (this.tool !== 'select') this.setTool('select');
      else return false;
      return true;
    }
    if (e.key === 'Enter') { this.finishPolyline(); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') return this.deleteSelected();
    if (!e.ctrlKey && !e.metaKey && e.key.toLowerCase() === 'x') return this.toggleConstruction();
    //: T = Stutzen (text has no shortcut there)
    const map = { l: 'line', r: 'rect', c: 'circle', p: 'ngon', s: 'select', o: 'slot', t: 'trim', j: 'project', a: 'arc', e: 'ellipse', b: 'spline', d: 'dim' };
    if (!e.ctrlKey && !e.metaKey && map[e.key.toLowerCase()]) { this.setTool(map[e.key.toLowerCase()]); return true; }
    return false;
  }

  drawPreview() {
    this.vp.clear(this.preview);
    if (this.active && this.cur && (this.tool === 'xmove' || this.tool === 'xrot')) {
      // the elements where they would land, and the way of the mouse from the first point
      this.preview.matrix.copy(planeMatrix(this.sketch));
      const mat = new THREE.LineBasicMaterial({ color: 0xff7a00, depthTest: false, transparent: true });
      const add = pts => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(q => new THREE.Vector3(q[0], q[1], 0.06))), mat); l.renderOrder = 11; this.preview.add(l); };
      const r = this.vp.worldPerPixel() * 6, at = this.xbase || this.cur;
      if (Number.isFinite(r)) add(Array.from({ length: 25 }, (_, i) => [at[0] + r * Math.cos((i / 24) * Math.PI * 2), at[1] + r * Math.sin((i / 24) * Math.PI * 2)]));
      const q = this.xformValue(this.cur);
      if (!q) return;
      add([this.xbase, this.cur]);
      for (const id of this.xformIds) {
        const x = this.entities.find(y => y.id === id);
        if (!x) continue;
        const c = this.tool === 'xmove' ? translateEntity(x, q.dx, q.dy) : rotateEntity(x, q.ang, q.c);
        for (const o of entityOutlines(c)) add(o.closed ? [...o.pts, o.pts[0]] : o.pts);
      }
      return;
    }
    if (this.active && this.cur && (this.tool === 'mirror' || this.tool === 'prect' || this.tool === 'pcirc')) {
      // the copies the tool would make, drawn as outlines
      const src = this.xformIds.map(id => this.entities.find(x => x.id === id)).filter(Boolean);
      let copies = [];
      const ax = this.tool === 'mirror' ? this.axisAt(this.cur) : null;
      if (ax) copies = src.map(x => mirrorEntity(x, ax.pts[0].map(Number), ax.pts[1].map(Number)));
      else if (this.tool === 'prect') {
        const o = this.xformOrigin(), [dx, dy] = this.axisLock(this.cur[0] - o[0], this.cur[1] - o[1]), { nx, ny } = this.patternVal;
        for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) if (i || j) for (const x of src) copies.push(translateEntity(x, i * dx, j * (ny > 1 ? dy : 0)));
        if (ny <= 1) copies = copies.map((c, k) => translateEntity(c, 0, ((Math.floor(k / src.length) + 1) * dy)));
      } else if (this.tool === 'pcirc') {
        const { n, ang } = this.patternVal, step = Math.abs(Math.abs(ang) - 360) < 1e-6 ? ang / n : ang / Math.max(1, n - 1);
        for (let i = 1; i < n; i++) for (const x of src) copies.push(rotateEntity(x, step * i, this.cur));
      }
      this.preview.matrix.copy(planeMatrix(this.sketch));
      const mat = new THREE.LineBasicMaterial({ color: 0xff7a00, depthTest: false, transparent: true });
      const add = pts => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(q => new THREE.Vector3(q[0], q[1], 0.06))), mat); l.renderOrder = 11; this.preview.add(l); };
      for (const c of copies) if (c) for (const o of entityOutlines(c)) add(o.closed ? [...o.pts, o.pts[0]] : o.pts);
      if (ax) add(ax.pts.map(q => q.map(Number)));
      if (this.tool === 'pcirc') { const r = this.vp.worldPerPixel() * 6; add(Array.from({ length: 25 }, (_, i) => [this.cur[0] + r * Math.cos((i / 24) * Math.PI * 2), this.cur[1] + r * Math.sin((i / 24) * Math.PI * 2)])); }
      return;
    }
    if (this.active && this.cur && this.tool === 'offset') {
      // the offset of the nearest contour, on the side the mouse is on
      const hit = offsetHit(this.entities, this.cur, this.vp.worldPerPixel() * 60);
      if (!hit) return;
      this.preview.matrix.copy(planeMatrix(this.sketch));
      const mat = new THREE.LineBasicMaterial({ color: 0xff7a00, depthTest: false, transparent: true });
      for (const c of offsetCurves(hit.e, hit.sign * this.offsetVal)) {
        const pts = c.closed ? [...c.pts, c.pts[0]] : c.pts;
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(q => new THREE.Vector3(q[0], q[1], 0.06))), mat);
        l.renderOrder = 11;
        this.preview.add(l);
      }
      return;
    }
    if (this.active && this.cur && (this.tool === 'fillet' || this.tool === 'chamfer')) {
      const c = cornerAt(this.entities, this.cur, this.vp.worldPerPixel() * 16);
      if (!c) return;
      this.preview.matrix.copy(planeMatrix(this.sketch));
      const mat = new THREE.LineBasicMaterial({ color: 0xff7a00, depthTest: false, transparent: true });
      const add = pts => { const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(q => new THREE.Vector3(q[0], q[1], 0.06))), mat); l.renderOrder = 11; this.preview.add(l); };
      const rr = this.vp.worldPerPixel() * 7;
      add(Array.from({ length: 25 }, (_, i) => [c.p[0] + rr * Math.cos((i / 24) * Math.PI * 2), c.p[1] + rr * Math.sin((i / 24) * Math.PI * 2)]));
      const o = cornerPreview(this.entities, c.ref, this.tool, this.cornerVal[this.tool]);
      if (o) add(o.closed ? [...o.pts, o.pts[0]] : o.pts);
      return;
    }
    if (this.active && this.cur && (this.tool === 'trim' || this.tool === 'extend')) {
      this.preview.matrix.copy(planeMatrix(this.sketch));
      const tol = this.vp.worldPerPixel() * 8;
      const r = this.tool === 'trim' ? trimAt(this.entities, this.cur, tol) : extendAt(this.entities, this.cur, tol);
      const pts = r && (this.tool === 'trim' ? r.piece : [r.from, r.to]);
      if (pts) {
        const mat = new THREE.LineBasicMaterial({ color: this.tool === 'trim' ? 0xe5484d : 0xff7a00, depthTest: false, transparent: true, linewidth: 2 });
        const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(q => new THREE.Vector3(q[0], q[1], 0.06))), mat);
        l.renderOrder = 11;
        this.preview.add(l);
      }
      return;
    }
    if (!this.active || !this.cur || this.tool === 'select' || this.tool === 'dim') return;
    this.preview.matrix.copy(planeMatrix(this.sketch));
    const z = 0.05;
    const V = p => new THREE.Vector3(p[0], p[1], z);
    const mat = new THREE.LineBasicMaterial({ color: 0xff7a00, depthTest: false, transparent: true });
    const line = pts => {
      const l = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts.map(V)), mat);
      l.renderOrder = 10;
      this.preview.add(l);
    };
    const c = this.cur, a = this.pts[0];
    if (this.tool === 'line' && this.pts.length) line([...this.pts, c]);
    if (this.tool === 'spline' && this.pts.length) line(splinePts([...this.pts, c], false));
    if (this.tool === 'arc' && a) line(this.pts.length === 1 ? [a, c] : arcPts(a, c, this.pts[1]));
    if (this.tool === 'ellipse' && a) {
      if (this.pts.length === 1) line([a, c]);
      else {
        const b = this.pts[1];
        const poly = entityPoly({ type: 'ellipse', cx: a[0], cy: a[1], rx: Math.hypot(b[0] - a[0], b[1] - a[1]), ry: Math.max(0.01, this.ellipseMinor()), rot: (Math.atan2(b[1] - a[1], b[0] - a[0]) * 180) / Math.PI });
        if (poly) line([...poly, poly[0]]);
      }
    }
    if (this.tool === 'rect' && a) line([a, [c[0], a[1]], c, [a[0], c[1]], a]);
    if (this.tool === 'slot' && a) {
      if (this.pts.length === 1) line([a, c]);
      else {
        const b = this.pts[1], r = this.slotHalfWidth();
        const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
        const pts = [];
        const half = (p, a0) => { for (let i = 0; i <= 24; i++) { const t = a0 + (i / 24) * Math.PI; pts.push([p[0] + r * Math.cos(t), p[1] + r * Math.sin(t)]); } };
        half(b, ang - Math.PI / 2);
        half(a, ang + Math.PI / 2);
        pts.push(pts[0]);
        line(pts);
      }
    }
    if ((this.tool === 'circle' || this.tool === 'ngon') && a) {
      const r = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const n = this.tool === 'circle' ? 64 : 6;
      const rot = this.tool === 'ngon' ? Math.atan2(c[1] - a[1], c[0] - a[0]) : 0;
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const t = rot + (i / n) * Math.PI * 2;
        pts.push([a[0] + r * Math.cos(t), a[1] + r * Math.sin(t)]);
      }
      line(pts);
      line([a, c]);
    }
    const ring = k => { const out = []; for (let i = 0; i <= 64; i++) { const t = (i / 64) * Math.PI * 2; out.push([k.cx + k.r * Math.cos(t), k.cy + k.r * Math.sin(t)]); } return out; };
    if (this.tool === 'rectc' && a) { const k = centerRect(a, c); line([[k.x, k.y], [k.x + k.w, k.y], [k.x + k.w, k.y + k.h], [k.x, k.y + k.h], [k.x, k.y]]); }
    if (this.tool === 'circle2' && a) { const k = circle2(a, c); if (k) line(ring(k)); line([a, c]); }
    if (this.tool === 'rect3' && a) {
      if (this.pts.length === 1) line([a, c]);
      else { const q = rect3(a, this.pts[1], c); line(q ? [...q, q[0]] : [a, this.pts[1]]); }
    }
    if (this.tool === 'circle3' && a) {
      if (this.pts.length === 1) line([a, c]);
      else { const k = circleThrough(a, this.pts[1], c); if (k) line(ring(k)); else line([a, this.pts[1], c]); }
    }
    if (this.tool === 'arct' && a && this.arcT) { const q = tangentArc(a, this.arcT, c); line(q ? arcPts(q[0], q[1], q[2]) : [a, c]); }
    if (this.tool === 'arcc' && a) {
      if (this.pts.length === 1) line([a, c]);
      else { const q = centerArc(a, this.pts[1], c); line([a, this.pts[1]]); if (q) line(arcPts(q[0], q[1], q[2])); }
    }
    const dot = new THREE.Points(
      new THREE.BufferGeometry().setFromPoints([V(c)]),
      new THREE.PointsMaterial({ color: this.snapped ? 0x2f9e44 : 0xff7a00, size: this.snapped ? 9 : 6, sizeAttenuation: false, depthTest: false, transparent: true }),
    );
    dot.renderOrder = 11;
    this.preview.add(dot);
  }
}
