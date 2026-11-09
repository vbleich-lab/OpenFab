// Floating panel windows (Fusion-style): drag by the title bar, resize from any
// edge or corner, collapse to the title bar, maximize, close. The layout is
// remembered per browser.

import { ctxMenu } from './ctxmenu.js';

const KEY = 'openfab.layout.v2';
const SNAP = 10;
const MIN_W = 180, MIN_H = 60;

function loadLayout() {
  try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; }
}

export class WindowManager {
  constructor(container) {
    this.c = container;
    this.wins = new Map();
    this.z = 20;
    this.saved = loadLayout();
    this.onChange = null;
    new ResizeObserver(() => this.wins.forEach(w => w.clamp(true))).observe(container);
  }

  add(el, defaults) {
    const w = new FloatWin(this, el, defaults);
    this.wins.set(el.id, w);
    return w;
  }

  get(id) { return this.wins.get(id); }
  bounds() { return { w: this.c.clientWidth, h: this.c.clientHeight }; }

  save() {
    const out = {};
    this.wins.forEach((w, id) => { out[id] = { ...w.s }; });
    try { localStorage.setItem(KEY, JSON.stringify(out)); } catch { /* storage unavailable */ }
    if (this.onChange) this.onChange();
  }

  reset() {
    try { localStorage.removeItem(KEY); } catch { /* ignore */ }
    this.saved = {};
    this.wins.forEach(w => { w.s = { ...w.defaults(this.bounds()), collapsed: false, max: false, hidden: w.el.dataset.closable ? true : false }; w.apply(); });
    this.save();
  }

  front(w) { w.el.style.zIndex = ++this.z; }
}

class FloatWin {
  constructor(wm, el, defaults) {
    this.wm = wm;
    this.el = el;
    this.defaults = defaults;
    this.forcedHidden = false;
    const saved = wm.saved[el.id];
    this.s = saved ? { ...saved } : { collapsed: false, max: false, hidden: el.hasAttribute('hidden'), ...defaults(wm.bounds()) };
    this.build();
    this.apply();
  }

  build() {
    const head = this.el.querySelector('.fwin-head');
    this.head = head;
    const collapse = document.createElement('button');
    collapse.className = 'fw-btn fw-collapse';
    collapse.title = 'Einklappen / Ausklappen (Doppelklick auf die Titelleiste)';
    collapse.textContent = '▾';
    collapse.onclick = () => this.toggleCollapse();
    head.prepend(collapse);
    this.collapseBtn = collapse;
    const right = document.createElement('span');
    right.className = 'fw-right';
    const pin = document.createElement('button');
    pin.className = 'fw-btn fw-pin';
    pin.title = 'Anheften (Position sperren)';
    pin.innerHTML = '<svg viewBox="0 0 16 16" width="13" height="13"><path d="M10 1.5 14.5 6l-1.6.4-2.6 2.6.3 3.2-1.1 1.1L6.3 10.1 2.5 14 2 13.5l3.9-3.8L2.7 6.5l1.1-1.1 3.2.3 2.6-2.6z" fill="none" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>';
    pin.onclick = () => this.togglePin();
    right.append(pin);
    this.pinBtn = pin;
    const max = document.createElement('button');
    max.className = 'fw-btn';
    max.title = 'Maximieren / Wiederherstellen';
    max.textContent = '□';
    max.onclick = () => this.toggleMax();
    right.append(max);
    if (this.el.dataset.closable) {
      const close = document.createElement('button');
      close.className = 'fw-btn fw-close';
      close.title = 'Schließen';
      close.textContent = '✕';
      close.onclick = () => this.show(false);
      right.append(close);
    }
    head.append(right);
    for (const d of ['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw']) {
      const hnd = document.createElement('div');
      hnd.className = `fw-rs fw-rs-${d}`;
      hnd.addEventListener('pointerdown', e => this.startResize(e, d));
      this.el.append(hnd);
    }
    head.addEventListener('pointerdown', e => this.startDrag(e));
    head.addEventListener('dblclick', e => { if (!e.target.closest('button')) this.toggleCollapse(); });
    head.addEventListener('contextmenu', e => { e.preventDefault(); this.headMenu(e.clientX, e.clientY); });
    this.el.addEventListener('pointerdown', () => this.wm.front(this), true);
  }

  apply() {
    const { el, s } = this;
    el.hidden = !!s.hidden || this.forcedHidden;
    el.classList.toggle('collapsed', !!s.collapsed);
    el.classList.toggle('maximized', !!s.max);
    el.classList.toggle('pinned', !!s.pinned);
    el.dataset.dock = s.dock || '';
    this.pinBtn.classList.toggle('on', !!s.pinned);
    this.collapseBtn.textContent = s.collapsed ? '▸' : '▾';
    if (s.max) {
      Object.assign(el.style, { left: '6px', top: '6px', width: 'calc(100% - 12px)', height: 'calc(100% - 12px)' });
    } else {
      Object.assign(el.style, { left: s.x + 'px', top: s.y + 'px', width: s.w + 'px', height: s.collapsed ? '' : s.h + 'px' });
    }
  }

  clamp(applyNow) {
    const B = this.wm.bounds();
    if (!B.w || !B.h) return;
    const s = this.s;
    if (s.dock === 'left') { s.x = 0; s.y = 0; s.h = B.h; }
    if (s.dock === 'right') { s.x = B.w - s.w; s.y = 0; s.h = B.h; }
    if (s.dock === 'bottom') { s.x = 0; s.y = B.h - s.h; s.w = B.w; }
    s.w = Math.max(MIN_W, Math.min(s.w, B.w));
    s.h = Math.max(MIN_H, Math.min(s.h, B.h));
    // keep the whole window visible (a window at the right edge stays at the right edge when the app gets narrower)
    s.x = Math.max(0, Math.min(s.x, B.w - s.w));
    s.y = Math.max(0, Math.min(s.y, B.h - (s.collapsed ? 28 : s.h)));
    if (applyNow) this.apply();
  }

  show(on = true) {
    this.s.hidden = !on;
    if (on) { this.wm.front(this); this.clamp(); }
    this.apply();
    this.wm.save();
  }

  setForcedHidden(v) {
    if (this.forcedHidden === v) return;
    this.forcedHidden = v;
    this.apply();
  }

  togglePin() { this.s.pinned = !this.s.pinned; this.apply(); this.wm.save(); }

  dock(side) {
    const B = this.wm.bounds();
    const s = this.s;
    s.dock = side; s.max = false; s.collapsed = false;
    if (side === 'bottom') s.h = Math.min(s.h, Math.max(MIN_H, Math.round(B.h / 3)));
    else s.w = Math.min(s.w, Math.round(B.w / 2));
    this.clamp(true);
    this.wm.save();
  }

  headMenu(x, y) {
    const s = this.s;
    ctxMenu(x, y, [
      { label: s.collapsed ? 'Ausklappen' : 'Einklappen', icon: s.collapsed ? '▸' : '▾', onclick: () => this.toggleCollapse() },
      { label: 'Anheften', checked: !!s.pinned, onclick: () => this.togglePin() },
      { sep: true },
      { label: 'Links andocken', checked: s.dock === 'left', onclick: () => this.dock('left') },
      { label: 'Rechts andocken', checked: s.dock === 'right', onclick: () => this.dock('right') },
      { label: 'Unten andocken', checked: s.dock === 'bottom', onclick: () => this.dock('bottom') },
      { label: 'Frei schweben', checked: !s.dock, onclick: () => { s.dock = null; this.apply(); this.wm.save(); } },
      { sep: true },
      { label: s.max ? 'Wiederherstellen' : 'Maximieren', icon: '□', onclick: () => this.toggleMax() },
      this.el.dataset.closable ? { label: 'Schließen', icon: '✕', onclick: () => this.show(false) } : null,
    ], this.el.dataset.title);
  }

  toggleCollapse() { this.s.collapsed = !this.s.collapsed; this.apply(); this.wm.save(); }
  toggleMax() { this.s.max = !this.s.max; if (this.s.max) this.s.collapsed = false; this.apply(); this.wm.save(); }

  // snap an edge coordinate to the container edges
  snap(v, size, limit) {
    if (Math.abs(v) < SNAP) return 0;
    if (Math.abs(v + size - limit) < SNAP) return limit - size;
    return v;
  }

  startDrag(e) {
    if (e.button !== 0 || e.target.closest('button') || this.s.pinned) return;
    e.preventDefault();
    if (this.s.max) { this.s.max = false; this.apply(); }
    this.s.dock = null;
    const start = { x: e.clientX, y: e.clientY, sx: this.s.x, sy: this.s.y };
    this.el.classList.add('dragging');
    this.head.setPointerCapture(e.pointerId);
    const move = ev => {
      const B = this.wm.bounds();
      const h = this.el.offsetHeight;
      this.s.x = this.snap(start.sx + ev.clientX - start.x, this.s.w, B.w);
      this.s.y = this.snap(start.sy + ev.clientY - start.y, h, B.h);
      this.clamp(true);
    };
    const up = () => {
      this.el.classList.remove('dragging');
      this.head.removeEventListener('pointermove', move);
      this.head.removeEventListener('pointerup', up);
      this.wm.save();
    };
    this.head.addEventListener('pointermove', move);
    this.head.addEventListener('pointerup', up);
  }

  startResize(e, dir) {
    if (e.button !== 0) return;
    e.preventDefault();
    e.stopPropagation();
    if (this.s.max) { this.s.max = false; this.apply(); }
    if (this.s.collapsed || this.s.pinned) return;
    const t = e.currentTarget;
    t.setPointerCapture(e.pointerId);
    const st = { ...this.s };
    const px = e.clientX, py = e.clientY;
    const move = ev => {
      const dx = ev.clientX - px, dy = ev.clientY - py;
      const B = this.wm.bounds();
      const s = this.s;
      if (dir.includes('e')) s.w = Math.max(MIN_W, Math.min(st.w + dx, B.w - st.x));
      if (dir.includes('s')) s.h = Math.max(MIN_H, Math.min(st.h + dy, B.h - st.y));
      if (dir.includes('w')) { const w = Math.max(MIN_W, Math.min(st.w - dx, st.x + st.w)); s.x = st.x + st.w - w; s.w = w; }
      if (dir.includes('n')) { const h = Math.max(MIN_H, Math.min(st.h - dy, st.y + st.h)); s.y = st.y + st.h - h; s.h = h; }
      if (s.dock && dir !== { left: 'e', right: 'w', bottom: 'n' }[s.dock]) s.dock = null;
      this.apply();
    };
    const up = () => {
      t.removeEventListener('pointermove', move);
      t.removeEventListener('pointerup', up);
      this.wm.save();
    };
    t.addEventListener('pointermove', move);
    t.addEventListener('pointerup', up);
  }
}
