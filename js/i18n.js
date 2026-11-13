// Languages of the user interface. The app is written in German; the other languages are dictionaries
// (js/lang/<code>.js: German text → translation, {0} {1} … for the changing parts of a text). The texts are
// translated where they reach the page: text nodes and the title / placeholder attributes are replaced as soon
// as they appear, so no module has to know about languages. What has no translation stays German.
//
// The German original of everything translated is remembered: code that reads a text back from the page uses
// deText(el) / deAttr(el, name).
export const LANGS = {
  de: 'Deutsch', en: 'English', gb: 'English (UK)', bs: 'Bosanski', cs: 'Čeština', da: 'Dansk', es: 'Español', fr: 'Français', gl: 'Galego', hr: 'Hrvatski',
  it: 'Italiano', lv: 'Latviešu', ms: 'Bahasa Melayu', nl: 'Nederlands', nb: 'Norsk bokmål', pl: 'Polski', pt: 'Português (Brasil)', fi: 'Suomi', tr: 'Türkçe',
  ru: 'Русский', sr: 'Српски', uk: 'Українська', ka: 'ქართული', he: 'עברית', ar: 'العربية', ja: '日本語', ko: '한국어', zh: '中文',
};
// written from right to left: the page is mirrored (dir="rtl"), numbers and NC code stay left to right
export const RTL = new Set(['ar', 'he']);
// what the document is declared as (hyphenation, fonts, screen readers)
const HTML_LANG = { zh: 'zh-CN', pt: 'pt-BR', gb: 'en-GB' };
// language tags of the system that do not start with the code of their dictionary
const TAGS = { 'en-gb': 'gb', 'en-au': 'gb', 'en-nz': 'gb', 'en-ie': 'gb', 'en-za': 'gb', 'en-in': 'gb', no: 'nb', nn: 'nb' };
const KEY = 'openfab.lang';

// the stored choice: a language code, or 'system' (follow the languages of the browser / operating system)
export function langChoice() {
  try { const saved = localStorage.getItem(KEY); return saved && LANGS[saved] ? saved : 'system'; } catch { return 'system'; }
}

function detect() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved && LANGS[saved]) return saved;
  } catch { /* no storage */ }
  for (const l of (typeof navigator !== 'undefined' && navigator.languages) || []) {
    const tag = String(l).toLowerCase(), c = TAGS[tag] || TAGS[tag.slice(0, 2)] || tag.slice(0, 2);
    if (LANGS[c]) return c;
  }
  // unknown language: English reaches more people than German
  return typeof navigator !== 'undefined' && navigator.language ? 'en' : 'de';
}

export let lang = detect();
let exact = null; // Map: German text → translation
let byPrefix = null; // Map: first characters → [{ re, to }], for texts with changing parts
let loose = []; // patterns that start with a changing part
let upper = null; // Map: German text in capitals → translation in capitals (window and panel headings)
const cache = new Map();
const PRE = 3;

export function setLanguage(code) {
  if (code !== 'system' && !LANGS[code]) return;
  try { if (code === 'system') localStorage.removeItem(KEY); else localStorage.setItem(KEY, code); } catch { /* no storage */ }
  if (typeof location !== 'undefined') location.reload();
}

const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function compile(dict) {
  exact = new Map();
  byPrefix = new Map();
  loose = [];
  upper = new Map();
  for (const [k, v] of Object.entries(dict)) {
    if (typeof v !== 'string' || !v) continue;
    if (!/\{\d+\}/.test(k)) {
      exact.set(k, v);
      // headings are written in capitals by the program: "Bohrungen erkennen" is shown as "BOHRUNGEN ERKENNEN"
      const ku = k.toUpperCase();
      if (ku !== k && !upper.has(ku)) upper.set(ku, v.toUpperCase());
      continue;
    }
    // "Maß {0} von {1}" → /^Maß (.+?) von (.+?)$/ with the groups in the order of their numbers
    const order = [];
    const src = k.split(/(\{\d+\})/).map(part => { const m = /^\{(\d+)\}$/.exec(part); if (!m) return esc(part); order.push(+m[1]); return '([\\s\\S]*?)'; }).join('');
    const lit = k.split(/\{\d+\}/).join('');
    if (lit.replace(/[\s\d.,:;()–-]/g, '').length < 2) continue; // nothing to recognise it by
    // a placeholder glued to a word carries a German plural ending (Fläche{1} → Flächen): dropped in translations
    const glued = new Set([...k.matchAll(/\p{L}\{(\d+)\}/gu)].map(m => +m[1]));
    const p = { re: new RegExp('^' + src + '$'), to: v, order, weight: lit.length, glued };
    const head = k.slice(0, k.search(/\{\d+\}/));
    if (head.length >= PRE) { const h = head.slice(0, PRE); if (!byPrefix.has(h)) byPrefix.set(h, []); byPrefix.get(h).push(p); }
    else loose.push(p);
  }
  // the pattern with the most fixed text wins
  for (const list of byPrefix.values()) list.sort((a, b) => b.weight - a.weight);
  loose.sort((a, b) => b.weight - a.weight);
}

function lookup(s, depth) {
  const hit = exact.get(s);
  if (hit != null) return hit;
  if (s === s.toUpperCase() && /\p{Lu}{3}/u.test(s)) {
    const up = upper.get(s);
    if (up != null) return up;
    // "2D-TASCHE : NAME" – the kind in front of the name of an operation or setup
    const cut = s.indexOf(' : ');
    if (cut > 0) { const head = exact.get(s.slice(0, cut)) ?? upper.get(s.slice(0, cut)); if (head != null) return head + s.slice(cut); }
  }
  if (s.length > 1200 || depth > 2) return null;
  for (const list of [byPrefix.get(s.slice(0, PRE)), loose]) {
    if (!list) continue;
    for (const p of list) {
      const m = p.re.exec(s);
      if (!m) continue;
      const args = [];
      p.order.forEach((n, i) => { const part = m[i + 1]; args[n] = p.glued.has(n) && /^(e|n|en|er|s)?$/.test(part) ? '' : /\p{L}{2}/u.test(part) ? lookup(part.trim(), depth + 1) ?? part : part; });
      return p.to.replace(/\{(\d+)\}/g, (_, n) => args[+n] ?? '');
    }
  }
  return null;
}

/** Uses a dictionary directly (tests; the app loads its own in initI18n). */
export function useDictionary(dict) { cache.clear(); if (dict) compile(dict); else exact = null; }

/** The text in the chosen language (the German text itself when there is no translation). */
export function t(s) {
  if (!exact || typeof s !== 'string' || !s) return s;
  let out = cache.get(s);
  if (out !== undefined) return out ?? s;
  const core = s.trim();
  const one = c => (c && /\p{L}{2}/u.test(c) ? lookup(c.replace(/[ \t]+/g, ' '), 0) : null);
  let r = one(core);
  // a sign the program puts in front of a message ("⚠ " + error): the message itself is looked up
  if (r == null) { const m = /^([⚠✓✗ⓘ]\s+)([\s\S]+)$/u.exec(core); if (m) { const x = one(m[2]); if (x != null) r = m[1] + x; } }
  // several lines put together by the program (a name above a hint): line by line
  if (r == null && core.includes('\n')) {
    const lines = core.split('\n').map(l => { const c = l.trim(), x = one(c); return x == null ? l : l.replace(c, () => x); }).join('\n');
    if (lines !== core) r = lines;
  }
  out = r == null ? null : s.replace(core, () => r);
  if (cache.size > 20000) cache.clear();
  cache.set(s, out);
  return out ?? s;
}

/** Texts between the tags of an HTML or SVG string (exports: drawing, setup sheet). */
export function tHtml(html) {
  if (!exact) return html;
  return String(html).replace(/>([^<>]*\p{L}{2}[^<>]*)</gu, (m, txt) => '>' + t(txt.replace(/&amp;/g, '&')).replace(/&(?!\w+;|#\d+;)/g, '&amp;') + '<');
}

// ---------- the page ----------
const ORIG = new WeakMap(); // text node → { de, tr }
const ORIG_ATTR = new WeakMap(); // element → { title: { de, tr }, … }
const ATTRS = ['title', 'placeholder', 'aria-label'];
const SKIP = new Set(['SCRIPT', 'STYLE', 'TEXTAREA', 'PRE', 'CODE', 'INPUT']);

const skipped = el => { for (let e = el; e && e.nodeType === 1; e = e.parentNode) { if (SKIP.has(e.nodeName) || e.isContentEditable || e.classList?.contains('no-i18n')) return true; } return false; };

function textNode(node) {
  const v = node.nodeValue;
  if (!v || v.length < 2) return;
  const o = ORIG.get(node);
  if (o && o.tr === v) return; // our own change
  if (skipped(node.parentNode)) return;
  const tr = t(v);
  ORIG.set(node, { de: v, tr });
  if (tr !== v) node.nodeValue = tr;
}
function attrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute?.(a);
    if (!v) continue;
    const rec = ORIG_ATTR.get(el) || {};
    if (rec[a] && rec[a].tr === v) continue;
    const tr = t(v);
    rec[a] = { de: v, tr };
    ORIG_ATTR.set(el, rec);
    if (tr !== v) el.setAttribute(a, tr);
  }
}
function tree(root) {
  if (root.nodeType === 3) return textNode(root);
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) { if (SKIP.has(root.nodeName)) { if (root.nodeName === 'INPUT' || root.nodeName === 'TEXTAREA') attrs(root); return; } attrs(root); }
  const w = document.createTreeWalker(root, 5 /* elements + text */);
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) textNode(n); else attrs(n); }
}

// texts the style sheets put on the page themselves (content: '…' of ::before / ::after)
function cssTexts() {
  const out = [];
  for (const sheet of document.styleSheets) {
    let rules;
    try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules || []) {
      const c = r.style?.content;
      if (!c || !r.selectorText) continue;
      const m = /^(['"])(.*\p{L}{2}.*)\1$/u.exec(c);
      const tr = m && t(m[2]);
      if (tr && tr !== m[2]) out.push(`${r.selectorText}{content:${JSON.stringify(tr)}}`);
    }
  }
  if (out.length) document.head.appendChild(Object.assign(document.createElement('style'), { textContent: out.join('\n') }));
}

/** German original of an element's text (textContent gives the translation). */
export function deText(el) {
  if (!el) return '';
  if (!exact) return el.textContent;
  if (el.nodeType === 3) return ORIG.get(el)?.de ?? el.nodeValue;
  let s = '';
  const w = document.createTreeWalker(el, 4);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const o = ORIG.get(n); s += o && o.tr === n.nodeValue ? o.de : n.nodeValue; }
  return s;
}
/** German original of a translated attribute. */
export function deAttr(el, name) {
  const v = el?.getAttribute?.(name) ?? '';
  const o = ORIG_ATTR.get(el)?.[name];
  return o && o.tr === v ? o.de : v;
}

/** Loads the dictionary of the chosen language and keeps the page translated. Call once, before the app starts. */
export async function initI18n() {
  if (lang === 'de' || typeof document === 'undefined') return;
  try {
    const own = (await import(`./lang/${lang}.js`)).default;
    // a text a language does not have yet is shown in English rather than in German
    let base = {};
    if (lang !== 'en') { try { base = (await import('./lang/en.js')).default; } catch { /* German stays */ } }
    compile({ ...base, ...own });
  } catch (e) {
    console.warn('Sprache nicht geladen:', lang, e);
    lang = 'de';
    return;
  }
  document.documentElement.lang = HTML_LANG[lang] || lang;
  if (RTL.has(lang)) document.documentElement.dir = 'rtl';
  tree(document.documentElement);
  cssTexts();
  if (document.title) document.title = t(document.title);
  new MutationObserver(list => {
    for (const m of list) {
      if (m.type === 'characterData') textNode(m.target);
      else if (m.type === 'attributes') attrs(m.target);
      else for (const n of m.addedNodes) tree(n);
    }
  }).observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  // the browser's own dialogs
  for (const fn of ['alert', 'confirm', 'prompt']) {
    const orig = window[fn].bind(window);
    window[fn] = (msg, ...rest) => orig(typeof msg === 'string' ? msg.split('\n').map(line => t(line)).join('\n') : msg, ...rest);
  }
}
