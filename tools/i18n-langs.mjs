// Further languages of the user interface: work files for translators.
//   node tools/i18n-langs.mjs split [n]            keys that have an English text → tools/i18n/chunks/1NN.json
//                                                  (German texts) and tools/i18n/ref/1NN.json (German → English)
//   node tools/i18n-langs.mjs missing <lang> [NN]  texts of the English dictionary a language does not have yet
//                                                  → tools/i18n/chunks/NN.json and tools/i18n/ref/NN.json (NN default 199)
//   node tools/i18n-langs.mjs status               how complete every language is
// Translated chunks go to tools/i18n/out/<lang>-NN.json; `node tools/i18n-build.mjs merge` builds js/lang/<lang>.js.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dir = join(root, 'tools', 'i18n');
const dictOf = async lang => { try { return (await import(pathToFileURL(join(root, 'js', 'lang', `${lang}.js`)).href + '?' + Date.now())).default; } catch { return {}; } };
const keys = JSON.parse(readFileSync(join(dir, 'keys.json'), 'utf8'));
const en = await dictOf('en');
const wanted = keys.filter(k => en[k]);
const put = (nn, list) => {
  mkdirSync(join(dir, 'chunks'), { recursive: true });
  mkdirSync(join(dir, 'ref'), { recursive: true });
  writeFileSync(join(dir, 'chunks', nn + '.json'), JSON.stringify(list, null, 1));
  writeFileSync(join(dir, 'ref', nn + '.json'), JSON.stringify(Object.fromEntries(list.map(k => [k, en[k]])), null, 1));
};

const cmd = process.argv[2];
if (cmd === 'split') {
  const n = +process.argv[3] || 330;
  let c = 0;
  for (let i = 0; i < wanted.length; i += n) put(String(101 + c++), wanted.slice(i, i + n));
  console.log(`${wanted.length} Texte in ${c} Teilen (101 … ${100 + c})`);
} else if (cmd === 'missing') {
  const lang = process.argv[3], nn = process.argv[4] || '199';
  const have = await dictOf(lang), list = wanted.filter(k => !have[k]);
  put(nn, list);
  console.log(`${lang}: ${list.length} Texte fehlen → chunks/${nn}.json`);
} else if (cmd === 'status') {
  for (const f of readdirSync(join(root, 'js', 'lang')).filter(x => x.endsWith('.js'))) {
    const d = await dictOf(f.slice(0, -3));
    console.log(`${f.slice(0, -3)}: ${wanted.filter(k => d[k]).length} von ${wanted.length}`);
  }
} else console.log('split [n] | missing <lang> [NN] | status');
