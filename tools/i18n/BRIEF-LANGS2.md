# Translating the WerkFab user interface into further languages

WerkFab is a CAD/CAM program (sketches, 3D modelling, assemblies, drawings, CNC milling and turning, post
processors). Its user interface is written in German; an English translation exists. You translate one chunk of
its texts into the languages named in your task.

Language codes: `cs` Czech, `da` Danish, `fi` Finnish, `nb` Norwegian Bokmål, `uk` Ukrainian, `hr` Croatian (Latin script,
ijekavian), `bs` Bosnian (Latin script, ijekavian), `sr` Serbian (Cyrillic script, ekavian; brand and file names, units, key
names and placeholders stay in Latin script), `ka` Georgian (Mkhedruli, never Mtavruli capitals), `lv` Latvian, `ms` Malay,
`gl` Galician.

## Input and output

- Input: `tools/i18n/ref/NNN.json` – a JSON object `{ "German text": "English translation", … }`. The German text
  is the original and decides the meaning; the English text shows the intended CAD/CAM terms.
- Output: one file per language, `tools/i18n/out/<code>-NNN.json`, each a JSON object
  `{ "German text exactly as given": "translation", … }`.
- Write the files with the Write tool (UTF-8, real characters). Do **not** write a script that translates and do
  not call any translation service – you are the translator. Work through the chunk in order, one language after
  the other; do not skip texts because they are long. You may write a language's file in two or three parts and
  join them, as long as the result is one valid JSON object with every text.
- Afterwards run `node tools/i18n-build.mjs check tools/i18n/out/<code>-NNN.json` from the project folder for each
  file and fix everything it reports until it says `0 Fehler` and the count of translated texts is (nearly) the
  count of texts in the chunk.
- Touch no other files. Do not run `merge`, do not edit `js/`.

## Rules

1. The key must be **byte-identical** to the German text of the input (copy it; same quotes „ “, dashes –,
   spaces, `\n`).
2. `{0}`, `{1}` … stand for values put in at run time (numbers, names). Every placeholder of the key must appear
   in the translation, each exactly as often; reorder them freely to make a natural sentence. A placeholder glued
   to a German word (`Fläche{1}`) carries a plural ending: write the placeholder with a space or in brackets where
   your language needs it, but keep it.
3. Keep line breaks (`\n`) in the same number, keep symbols (Ø, ×, °, ±, →, …, ✕, ⚠), units, G-code words (G41,
   M8, CYCL DEF 251), file formats (STEP, DXF), product and control names (WerkFab, Heidenhain, Fanuc, Sinumerik,
   Okuma, LinuxCNC, GRBL). Key names are translated the way keyboards of that language name them (Umschalt →
   Shift / Maj / Mayús …, Strg → Ctrl, Entf → Del / Supr …).
4. German decimal commas inside example values stay as they are (`Ra 3,2`, `±0,1`): the program reads them so.
5. Texts in CAPITALS are headings: keep them in capitals where the script has capitals.
6. Keep the length close to the original: button labels, menu entries, table headings, tooltips and hints in
   narrow panels. Buttons and menu entries: short, in the form professional CAD/CAM software of that language
   uses (infinitive or noun).
7. Leading and trailing punctuation and symbols stay (a trailing `:` or `…`, a leading `⚠ ` or `+ `).
8. Leave out (no entry at all) only texts that read exactly the same in the target language (a unit, a product
   name, a formula). Everything else gets a translation.
9. Use the established terms of CAD/CAM software and of CNC documentation in each language, consistently within
   the chunk: the words a machinist or designer of that country knows. Where a loan word is usual (Loft, Sweep,
   Spline, Offset, post processor), keep it.
10. Formal, impersonal address; commands on buttons in the form software of that language uses.
11. Scripts without letter case (Georgian) write headings in ordinary letters.

## Report

Reply with one line per language: file, number of texts translated, result of the check. Name any text you were
unsure about (at most five).

## Fixed terms

The file `tools/i18n/TERMS-2.md` has a table of the main terms in all twelve languages. Read it and use exactly
those terms, so that all chunks agree.

## Your task line

Your task names a chunk number NNN and three language codes. Input `tools/i18n/ref/NNN.json`, output
`tools/i18n/out/<code>-NNN.json` for each of the three languages. Translate every text (also key names such as
"Strg+1" → "Ctrl+1"). Project folder: C:UsersbleiDownloadsopenfab.
