// Translations: work files → dictionaries of the app.
//   node tools/i18n-build.mjs split [n]     tools/i18n/keys.json → tools/i18n/chunks/NN.json (n texts each)
//   node tools/i18n-build.mjs check <file>  checks one translated chunk (tools/i18n/out/<lang>-NN.json)
//   node tools/i18n-build.mjs merge         tools/i18n/out/<lang>-*.json → js/lang/<lang>.js, with a report
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'tools', 'i18n');
const read = f => JSON.parse(readFileSync(f, 'utf8'));
const holders = s => (s.match(/\{\d+\}/g) || []).sort().join('');

// problems of one dictionary against the list of German texts
export function problems(dict, keys) {
  const known = new Set(keys), out = [];
  for (const [k, v] of Object.entries(dict)) {
    if (!known.has(k)) { out.push(`unbekannter Schlüssel: ${JSON.stringify(k.slice(0, 60))}`); continue; }
    if (typeof v !== 'string' || !v.trim()) { out.push(`leer: ${JSON.stringify(k.slice(0, 60))}`); continue; }
    if (holders(k) !== holders(v)) out.push(`Platzhalter anders: ${JSON.stringify(k.slice(0, 60))} → ${JSON.stringify(v.slice(0, 60))}`);
    if ((k.match(/\n/g) || []).length !== (v.match(/\n/g) || []).length) out.push(`Zeilenumbrüche anders: ${JSON.stringify(k.slice(0, 60))}`);
  }
  return out;
}

const cmd = process.argv[2];
if (cmd === 'split') {
  const keys = read(join(dir, 'keys.json')), n = +process.argv[3] || 380;
  mkdirSync(join(dir, 'chunks'), { recursive: true });
  mkdirSync(join(dir, 'out'), { recursive: true });
  let c = 0;
  for (let i = 0; i < keys.length; i += n) writeFileSync(join(dir, 'chunks', String(++c).padStart(2, '0') + '.json'), JSON.stringify(keys.slice(i, i + n), null, 1));
  console.log(`${keys.length} Texte in ${c} Teilen`);
} else if (cmd === 'check') {
  const f = process.argv[3], dict = read(f);
  const m = /-(\d+)\.json$/.exec(basename(f));
  const keys = read(join(dir, 'chunks', m[1] + '.json'));
  const bad = problems(dict, keys);
  console.log(`${Object.keys(dict).length} von ${keys.length} übersetzt, ${bad.length} Fehler`);
  for (const b of bad) console.log('  ' + b);
  if (bad.length) process.exitCode = 1;
} else if (cmd === 'merge') {
  const keys = read(join(dir, 'keys.json'));
  const files = existsSync(join(dir, 'out')) ? readdirSync(join(dir, 'out')).filter(f => /^[a-z]{2}-\d+\.json$/.test(f)) : [];
  const langs = [...new Set(files.map(f => f.slice(0, 2)))];
  mkdirSync(join(root, 'js', 'lang'), { recursive: true });
  for (const lang of langs) {
    const dict = {};
    for (const f of files.filter(x => x.startsWith(lang + '-')).sort()) Object.assign(dict, read(join(dir, 'out', f)));
    // hand-made additions and corrections win
    const fix = join(dir, `fix-${lang}.json`);
    if (existsSync(fix)) Object.assign(dict, read(fix));
    const bad = problems(dict, keys);
    const known = new Set(keys);
    const clean = Object.fromEntries(Object.entries(dict).filter(([k, v]) => known.has(k) && typeof v === 'string' && v.trim() && v !== k && holders(k) === holders(v)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
    writeFileSync(join(root, 'js', 'lang', `${lang}.js`), `// ${lang}: translations of the user interface (German text → translation). Built by tools/i18n-build.mjs\n// from tools/i18n/out and tools/i18n/fix-${lang}.json – edit those, not this file.\nexport default ${JSON.stringify(clean, null, 0).replace(/","/g, '",\n"')};\n`);
    console.log(`${lang}: ${Object.keys(clean).length} von ${keys.length} Texten, ${bad.length} verworfen`);
    for (const b of bad.slice(0, 15)) console.log('  ' + b);
  }
} else console.log('split | check <file> | merge');
