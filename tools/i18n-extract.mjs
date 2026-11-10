// Collects the German texts of the user interface from the source: every string and template literal of the
// app's modules (template expressions become {0}, {1} …) and the texts of index.html.
// Run: node tools/i18n-extract.mjs            → writes tools/i18n/keys.json
//      node tools/i18n-extract.mjs --missing en  → lists keys without a translation in js/lang/en.js
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
// modules without texts for the user (NC output, kernels, the translations themselves)
const SKIP = new Set(['i18n.js', 'fonts.js', 'icons.js']);

const LOWER = new Set('links rechts vorne hinten unten oben ein aus generisch endlos gewählt gleichsinnig gegensinnig hoch runter automatisch mittig inaktiv deaktiviert berechnet ausstehend vorgaben und aktiv keine von bis nein waagerecht senkrecht ausgerichtet spanend beliebig heruntergeladen|schwer zerspanbar|und aktiviert|gerade eben'.split('|').flatMap((x, i) => (i ? [x] : x.split(' '))));

// string and template literals of a JavaScript source, in order
export function literals(src) {
  const out = [];
  let i = 0, prev = ''; // prev: last significant token kind, to tell a regex from a division
  const n = src.length;
  const regexAllowed = () => prev === '' || /[(,=:[!&|?{};+\-*%<>~^]$/.test(prev) || /(?:^|[^\w$.])(?:return|typeof|case|in|of|delete|void|throw|new|else|do)$/.test(prev);
  const readString = q => {
    let s = '';
    i++;
    while (i < n && src[i] !== q) {
      if (src[i] === '\\') {
        const c = src[i + 1];
        if (c === 'n') s += '\n'; else if (c === 't') s += '\t'; else if (c === 'r') s += '\r';
        else if (c === 'u') { const m = /^u\{([0-9a-fA-F]+)\}|^u([0-9a-fA-F]{4})/.exec(src.slice(i + 1, i + 12)); if (m) { s += String.fromCodePoint(parseInt(m[1] || m[2], 16)); i += m[0].length + 1; continue; } s += 'u'; }
        else if (c === 'x') { s += String.fromCharCode(parseInt(src.slice(i + 2, i + 4), 16)); i += 4; continue; }
        else if (c === '\n') { /* line continuation */ } else s += c;
        i += 2;
      } else s += src[i++];
    }
    i++;
    return s;
  };
  const readTemplate = () => {
    // returns the text with {k} for every expression; nested literals inside expressions are collected too
    let s = '', k = 0;
    i++;
    while (i < n && src[i] !== '`') {
      if (src[i] === '\\') { const c = src[i + 1]; s += c === 'n' ? '\n' : c === 't' ? '\t' : c; i += 2; continue; }
      if (src[i] === '$' && src[i + 1] === '{') {
        i += 2;
        const start = i;
        let depth = 1;
        while (i < n && depth) {
          const c = src[i];
          if (c === '{') { depth++; i++; }
          else if (c === '}') { depth--; i++; }
          else if (c === '\'' || c === '"') readString(c);
          else if (c === '`') { const inner = readTemplate(); out.push(inner); }
          else if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; }
          else if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i) + 2; }
          else i++;
        }
        // plain strings inside the expression
        for (const m of literals(src.slice(start, i - 1))) out.push(m);
        s += `{${k++}}`;
        continue;
      }
      s += src[i++];
    }
    i++;
    return s;
  };
  while (i < n) {
    const c = src[i];
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') i++; continue; }
    if (c === '/' && src[i + 1] === '*') { const e = src.indexOf('*/', i); i = e < 0 ? n : e + 2; continue; }
    if (c === '\'' || c === '"') { out.push(readString(c)); prev = 'x'; continue; }
    if (c === '`') { out.push(readTemplate()); prev = 'x'; continue; }
    if (c === '/' && regexAllowed()) {
      // regular expression literal
      i++;
      let cls = false;
      while (i < n && (cls || src[i] !== '/') && src[i] !== '\n') { if (src[i] === '\\') i++; else if (src[i] === '[') cls = true; else if (src[i] === ']') cls = false; i++; }
      i++;
      while (i < n && /[a-z]/.test(src[i])) i++;
      prev = 'x';
      continue;
    }
    if (/\s/.test(c)) { i++; continue; }
    if (/[\w$]/.test(c)) { let j = i; while (j < n && /[\w$]/.test(src[j])) j++; prev = (prev.slice(-1) === '.' ? '.' : ' ') + src.slice(i, j); i = j; continue; }
    prev = c;
    i++;
  }
  return out;
}

// is this a text for the user (and not a key, a CSS class, a piece of markup or NC code)?
export function isText(s) {
  const t = s.trim();
  if (t.length < 2 || t.length > 900) return false;
  if (!/\p{L}{2}/u.test(t.replace(/\{\d+\}/g, ''))) return false;
  const bare = t.replace(/\{\d+\}/g, '0');
  if (/[{};]\s*$/.test(bare)) return false;
  if (/^[<{[]/.test(bare)) return false;
  if (/<\/?[a-z][^>]*>|^\s*[.#@][\w-]+|=>|^\w+\(\S*$|^https?:|^[\w.-]+\.(js|mjs|json|svg|png|wasm|css|html|stl|step|stp|dxf|nc|h|tap)$/i.test(t)) return false;
  if (/^[\w$]+$/.test(t) && /[a-z][A-Z]|_|\d/.test(t)) return false; // camelCase, snake_case, ids with digits
  if (/^\.{0,2}\//.test(t) || /^[a-z-]+:\s*[\w#.% -]+(;|$)/.test(t) && /\d(px|%|em|mm)?|#[0-9a-f]{3}/.test(t)) return false; // paths, inline styles
  if (/^[a-z]+(-[a-z0-9]+)+$/.test(t)) return false; // kebab-case
  if (/^[GMTSFXYZNLRQ]\d|^\(|^%|^;|^[A-Z]{1,4}\d*( [A-Z]*[0-9.+-]+[A-Z0-9.+-]*)+$/.test(t) && !/[a-zäöü]{3}/.test(t)) return false; // NC words
  if (/^[\d\s.,:;+\-*/%°()=<>×Ø±]+[a-zA-Zµ°]{0,3}$/.test(t)) return false; // numbers with a unit
  // lowercase words without umlauts are keys (pocket, contour …) – except these German ones
  if (/^[a-z0-9 -]+$/.test(t) && !LOWER.has(t)) return false;
  if (/\n/.test(t) && /\b[GM]\d+\b/.test(t)) return false; // NC templates
  return true;
}

export function collect() {
  const keys = new Map(); // key → files
  const add = (s, f) => { const k = s.trim().replace(/[ \t]+/g, ' '); if (!isText(k)) return; if (!keys.has(k)) keys.set(k, new Set()); keys.get(k).add(f); };
  for (const f of readdirSync(join(root, 'js')).filter(x => x.endsWith('.js') && !SKIP.has(x))) {
    for (const s of literals(readFileSync(join(root, 'js', f), 'utf8'))) add(s, f);
  }
  const html = readFileSync(join(root, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<!--[\s\S]*?-->/g, '');
  for (const m of html.matchAll(/>([^<>]+)</g)) add(m[1].replace(/&amp;/g, '&').replace(/&nbsp;/g, ' '), 'index.html');
  for (const m of html.matchAll(/\b(?:title|placeholder|aria-label)="([^"]+)"/g)) add(m[1], 'index.html');
  // texts the style sheets show themselves
  for (const f of readdirSync(join(root, 'css')).filter(x => x.endsWith('.css'))) {
    for (const m of readFileSync(join(root, 'css', f), 'utf8').matchAll(/content:\s*'([^']*\p{L}{2}[^']*)'/gu)) add(m[1], f);
  }
  return keys;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const keys = collect();
  const mi = process.argv.indexOf('--missing');
  if (mi > 0) {
    const lang = process.argv[mi + 1];
    const dict = (await import(pathToFileURL(join(root, 'js', 'lang', `${lang}.js`)).href)).default;
    const miss = [...keys.keys()].filter(k => !(k in dict));
    console.log(JSON.stringify(miss, null, 1));
    console.error(`${miss.length} von ${keys.size} ohne Übersetzung (${lang})`);
  } else {
    const dir = join(root, 'tools', 'i18n');
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'keys.json'), JSON.stringify([...keys.keys()], null, 1));
    const chars = [...keys.keys()].reduce((a, k) => a + k.length, 0);
    console.log(`${keys.size} Texte, ${chars} Zeichen → tools/i18n/keys.json`);
    const by = {};
    for (const fs of keys.values()) for (const f of fs) by[f] = (by[f] || 0) + 1;
    console.log(Object.entries(by).sort((a, b) => b[1] - a[1]).map(([f, c]) => `${f} ${c}`).join(', '));
  }
}
