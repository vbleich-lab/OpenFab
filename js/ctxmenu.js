// Right-click context menu (used by the browser tree, timeline and window title bars).
// items: { label, onclick, icon, key, checked, disabled, danger } or { sep: true }
let cur = null;

export function closeCtxMenu() {
  if (cur) { cur.remove(); cur = null; }
}

export function ctxMenu(x, y, items, title) {
  closeCtxMenu();
  const m = document.createElement('div');
  m.className = 'ctxmenu';
  if (title) {
    const t = document.createElement('div');
    t.className = 'ctx-title';
    t.textContent = title;
    m.append(t);
  }
  for (const it of items) {
    if (!it) continue;
    if (it.sep) { m.append(Object.assign(document.createElement('hr'))); continue; }
    const b = document.createElement('button');
    b.className = 'ctx-item' + (it.danger ? ' danger' : '');
    b.disabled = !!it.disabled;
    const ic = document.createElement('span');
    ic.className = 'ctx-ico';
    ic.textContent = it.checked ? '✓' : it.icon || '';
    const lb = document.createElement('span');
    lb.className = 'ctx-label';
    lb.textContent = it.label;
    b.append(ic, lb);
    if (it.key) { const k = document.createElement('span'); k.className = 'ctx-key'; k.textContent = it.key; b.append(k); }
    b.onclick = e => { e.stopPropagation(); closeCtxMenu(); it.onclick?.(); };
    m.append(b);
  }
  document.body.append(m);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(4, Math.min(x, innerWidth - r.width - 4)) + 'px';
  m.style.top = Math.max(4, Math.min(y, innerHeight - r.height - 4)) + 'px';
  cur = m;
}

addEventListener('pointerdown', e => { if (cur && !cur.contains(e.target)) closeCtxMenu(); }, true);
addEventListener('keydown', e => { if (e.key === 'Escape') closeCtxMenu(); });
addEventListener('blur', closeCtxMenu);
