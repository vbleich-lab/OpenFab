// Languages without a browser: every dictionary in js/lang against the German texts of the source (keys exist,
// placeholders and line breaks kept, coverage), and the translation at run time (exact texts, texts with
// changing parts, nested parts, markup of exports).
// Run: npm run test:i18n
import { readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { collect, literals, isText } from './i18n-extract.mjs';
import { problems } from './i18n-build.mjs';

const ok = (n, c, x = '') => { console.log((c ? 'OK   ' : 'FEHL ') + n + '  ' + x); if (!c) process.exitCode = 1; };
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const { t, tHtml, useDictionary, LANGS } = await import('../js/i18n.js');

// ---- the extractor ----
{
  const src = "const a = 'Maß hinzufügen'; const b = `${n} Element(e) gespiegelt`; // 'Kommentar bleibt draußen'\nconst re = /'kein Text'/g; const c = cond ? \"Abbrechen\" : `Wert ${x ? 'innen' : `tief ${y}`} mm`; x = a / 2; s = 'pocket';";
  const lit = literals(src);
  ok('Texte aus dem Quelltext: Zeichenketten und Vorlagen', lit.includes('Maß hinzufügen') && lit.includes('{0} Element(e) gespiegelt') && lit.includes('Abbrechen') && lit.includes('Wert {0} mm') && lit.includes('innen') && lit.includes('tief {0}'), JSON.stringify(lit));
  ok('Kommentare und reguläre Ausdrücke zählen nicht', !lit.some(s => /Kommentar|kein Text/.test(s)));
  ok('Schlüssel und Klassen sind keine Texte', !isText('pocket') && !isText('modal-head nc-head') && !isText('stepDown') && !isText('G0 X0 Y0') && isText('Tasche') && isText('automatisch') && isText('Ø {0} mm Bohrer'));
}

// ---- the dictionaries ----
const keys = [...collect().keys()];
ok('Texte der Oberfläche gefunden', keys.length > 2500, `${keys.length} Texte`);
const files = readdirSync(join(root, 'js', 'lang')).filter(f => f.endsWith('.js'));
ok('Jede angebotene Sprache hat ihr Wörterbuch', Object.keys(LANGS).filter(l => l !== 'de').every(l => files.includes(l + '.js')), files.join(', '));
const dicts = {};
for (const f of files) {
  const lang = f.slice(0, -3), dict = (await import(pathToFileURL(join(root, 'js', 'lang', f)).href)).default;
  dicts[lang] = dict;
  const n = Object.keys(dict).length, bad = problems(dict, keys).filter(b => !/^unbekannter/.test(b)), stale = Object.keys(dict).filter(k => !keys.includes(k)).length;
  ok(`${lang}: Platzhalter und Zeilenumbrüche stimmen`, bad.length === 0, bad.slice(0, 3).join(' · '));
  // most texts are translated (identifiers and names that read the same are left out on purpose)
  ok(`${lang}: Abdeckung`, n - stale >= keys.length * 0.8, `${n - stale} von ${keys.length} Texten (${Math.round(((n - stale) / keys.length) * 100)} %), ${stale} veraltet`);
  // the texts everybody sees
  const must = ['Skizze', 'Extrusion', 'Bohrung', 'Verlängern', 'Abbrechen', 'Tasche', 'Kontur', 'Werkzeug', 'NC-PROGRAMM', 'Maß hinzufügen'];
  ok(`${lang}: Grundbegriffe übersetzt`, must.every(k => dict[k] && (dict[k] !== k || !['en', 'zh'].includes(lang))), must.filter(k => !dict[k]).join(', '));
  const warn = Object.keys(dict).find(k => /^⚠ Jedes NC-Programm vor dem ersten Lauf prüfen/.test(k));
  ok(`${lang}: Sicherheitshinweis am NC-Programm übersetzt`, !!warn, warn ? dict[warn].slice(0, 60) + ' …' : 'fehlt');
}

// ---- translation at run time ----
{
  useDictionary({
    'Abbrechen': 'Cancel', 'Tasche': 'Pocket', 'Kontur': 'Contour',
    '{0} Element(e) gespiegelt': '{0} element(s) mirrored',
    'Versatz {0} mm erstellt – weitere Kontur anklicken oder Esc': 'Offset {0} mm created – click another contour or Esc',
    'Detail {0} ({1})': 'Detail {0} ({1})',
    '{0}: {1} von {2}': '{2} total, {1} done: {0}',
    'Restmaterial: {0}': 'Rest material: {0}',
    'Restmaterial: {0} (Vorfräser Ø{1})': 'Rest material: {0} (previous cutter Ø{1})',
    'Schnitt {0}–{1}': 'Section {0}–{1}',
  });
  ok('Fester Text', t('Abbrechen') === 'Cancel' && t('Unbekannt') === 'Unbekannt');
  ok('Leerraum außen bleibt', t('  Abbrechen ') === '  Cancel ');
  ok('Text mit Zahl', t('3 Element(e) gespiegelt') === '3 element(s) mirrored', t('3 Element(e) gespiegelt'));
  ok('Text mit Zahl in der Mitte', t('Versatz 2,5 mm erstellt – weitere Kontur anklicken oder Esc') === 'Offset 2,5 mm created – click another contour or Esc');
  ok('Reihenfolge der Platzhalter darf wechseln', t('Schruppen: 3 von 7') === '7 total, 3 done: Schruppen', t('Schruppen: 3 von 7'));
  ok('Eingesetzter Teil wird selbst übersetzt', t('Restmaterial: Tasche') === 'Rest material: Pocket', t('Restmaterial: Tasche'));
  ok('Das genauere Muster gewinnt', t('Restmaterial: Kontur (Vorfräser Ø12)') === 'Rest material: Contour (previous cutter Ø12)', t('Restmaterial: Kontur (Vorfräser Ø12)'));
  ok('Zahlen und Namen bleiben', t('12,5') === '12,5' && t('M8×1,25') === 'M8×1,25');
  ok('Texte in Markup (Export)', tHtml('<text x="1">Schnitt A–A</text><td>Tasche</td><style>.a{b:c}</style>') === '<text x="1">Section A–A</text><td>Pocket</td><style>.a{b:c}</style>', tHtml('<text x="1">Schnitt A–A</text><td>Tasche</td>'));
  useDictionary(null);
  ok('Ohne Wörterbuch bleibt alles deutsch', t('Abbrechen') === 'Abbrechen' && tHtml('<b>Tasche</b>') === '<b>Tasche</b>');
}

// ---- the real dictionaries at run time: a few sentences as the app builds them ----
for (const [lang, dict] of Object.entries(dicts)) {
  useDictionary(dict);
  const same = ['Skizze', 'Abbrechen', 'Verlängern'].filter(k => t(k) === k);
  ok(`${lang}: Laufzeit übersetzt`, same.length === 0, same.join(', '));
}
useDictionary(null);
