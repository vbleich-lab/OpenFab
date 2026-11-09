// User parameters and expressions. Numeric fields may hold "=expr" strings
// (e.g. "=breite/2"); resolveProject() turns them into numbers.

const FUNCS = {
  sqrt: Math.sqrt, sin: d => Math.sin((d * Math.PI) / 180), cos: d => Math.cos((d * Math.PI) / 180),
  tan: d => Math.tan((d * Math.PI) / 180), abs: Math.abs, min: Math.min, max: Math.max, round: Math.round, PI: Math.PI,
};

export function evalExpr(expr, scope = {}) {
  const s = String(expr).trim().replace(/,/g, '.');
  if (!s) return NaN;
  if (!/^[\w\s+\-*/().]+$/.test(s)) return NaN;
  const all = { ...FUNCS, ...scope };
  const ids = s.match(/[A-Za-z_]\w*/g) || [];
  if (ids.some(id => !(id in all))) return NaN;
  try {
    const names = Object.keys(all);
    const v = Function(...names, `"use strict";return (${s})`)(...names.map(n => all[n]));
    return typeof v === 'number' ? v : NaN;
  } catch {
    return NaN;
  }
}

export function paramScope(project) {
  const scope = {};
  for (const p of project.params || []) {
    const v = evalExpr(p.expr, scope);
    if (/^[A-Za-z_]\w*$/.test(p.name)) scope[p.name] = Number.isFinite(v) ? v : NaN;
  }
  return scope;
}

export function resolveValue(v, scope) {
  return typeof v === 'string' && v.startsWith('=') ? evalExpr(v.slice(1), scope) : v;
}

function walk(o, scope) {
  if (Array.isArray(o)) return o.map(x => walk(x, scope));
  if (o && typeof o === 'object') {
    const out = {};
    for (const k in o) out[k] = walk(o[k], scope);
    return out;
  }
  return resolveValue(o, scope);
}

// Returns a copy of the project with every "=expr" replaced by its number.
export function resolveProject(project) {
  const scope = paramScope(project);
  return { ...project, features: walk(project.features, scope), cam: walk(project.cam, scope) };
}
