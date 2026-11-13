# Translating the WerkFab user interface into further languages

WerkFab is a CAD/CAM program (sketches, 3D modelling, assemblies, drawings, CNC milling and turning, post
processors). Its user interface is written in German; an English translation exists. You translate one chunk of
its texts into the languages named in your task.

Language codes: `fr` French, `es` Spanish (neutral, understood in Spain and Latin America), `it` Italian,
`pt` Portuguese (Brazilian), `nl` Dutch, `pl` Polish, `tr` Turkish, `ja` Japanese, `ko` Korean.

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
   the chunk: the words a machinist or designer of that country knows from Fusion, SolidWorks, Siemens NX,
   Mastercam and from the manuals of Heidenhain, Fanuc and Siemens controls. Examples: sketch = esquisse / boceto
   / schizzo / esboço / schets / szkic / eskiz / スケッチ / 스케치; extrude = extrusion / extruir / estrusione /
   extrusão / extruderen / wyciągnięcie / ekstrüzyon / 押し出し / 돌출; fillet = congé / empalme / raccordo /
   concordância / afronding / zaokrąglenie / radyus / フィレット / 모깎기; chamfer = chanfrein / chaflán / smusso /
   chanfro / afschuining / fazowanie / pah / 面取り / 모따기; stock = brut / material en bruto / grezzo / bruto /
   ruw materiaal / półfabrykat / ham parça / ストック / 소재; feed rate = avance / avance / avanzamento / avanço /
   voeding / posuw / ilerleme / 送り速度 / 이송 속도; spindle speed = vitesse de broche / velocidad del husillo /
   velocità mandrino / rotação do fuso / spiltoerental / obroty wrzeciona / iş mili devri / 主軸回転数 / 주축
   회전수; post processor stays a loan word where that is usual.
10. Formal address where the language distinguishes it (vous, usted, Lei, você, u, Pan-free impersonal forms in
    Polish, siz, です・ます in sentences, 합니다 style); commands on buttons in the usual impersonal form.
11. Japanese and Korean: no spaces inside Japanese text, full-width punctuation in sentences (、。), half-width
    for numbers, units and symbols; Korean with normal word spacing.

## Report

Reply with one line per language: file, number of texts translated, result of the check. Name any text you were
unsure about (at most five).

## Fixed terms (use exactly these, so all chunks agree)

| German | fr | es | it | pt | nl | pl | tr | ja | ko |
|---|---|---|---|---|---|---|---|---|---|
| KONSTRUKTION (workspace) | CONCEPTION | DISEÑO | PROGETTAZIONE | PROJETO | ONTWERP | PROJEKT | TASARIM | 設計 | 설계 |
| FERTIGUNG (workspace) | FABRICATION | FABRICACIÓN | PRODUZIONE | MANUFATURA | FABRICAGE | WYTWARZANIE | İMALAT | 製造 | 제조 |
| RENDERN (workspace) | RENDU | RENDERIZADO | RENDERING | RENDERIZAÇÃO | RENDEREN | RENDEROWANIE | GÖRSELLEŞTİRME | レンダリング | 렌더링 |
| Skizze | Esquisse | Boceto | Schizzo | Esboço | Schets | Szkic | Eskiz | スケッチ | 스케치 |
| Körper | Corps | Cuerpo | Corpo | Corpo | Lichaam | Bryła | Gövde | ボディ | 바디 |
| Fläche (eines Körpers) | Face | Cara | Faccia | Face | Vlak | Ściana | Yüzey | 面 | 면 |
| Kante | Arête | Arista | Spigolo | Aresta | Rand | Krawędź | Kenar | エッジ | 모서리 |
| Extrusion | Extrusion | Extrusión | Estrusione | Extrusão | Extrusie | Wyciągnięcie | Ekstrüzyon | 押し出し | 돌출 |
| Rotation (Feature) | Révolution | Revolución | Rivoluzione | Revolução | Wentelen | Obrót | Döndürme | 回転 | 회전 |
| Bohrung | Perçage | Agujero | Foro | Furo | Gat | Otwór | Delik | 穴 | 구멍 |
| Gewinde | Filetage | Rosca | Filettatura | Rosca | Schroefdraad | Gwint | Diş | ねじ | 나사 |
| Verrundung | Congé | Empalme | Raccordo | Concordância | Afronding | Zaokrąglenie | Radyus | フィレット | 모깎기 |
| Fase | Chanfrein | Chaflán | Smusso | Chanfro | Afschuining | Fazowanie | Pah | 面取り | 모따기 |
| Muster | Réseau | Patrón | Serie | Padrão | Patroon | Szyk | Çoğaltma | パターン | 패턴 |
| Spiegeln | Symétrie | Simetría | Specchia | Espelhar | Spiegelen | Lustro | Aynala | ミラー | 대칭 |
| Abhängigkeit | Contrainte | Restricción | Vincolo | Restrição | Beperking | Wiązanie | Kısıtlama | 拘束 | 구속조건 |
| Bemaßung / Maß | Cote | Cota | Quota | Cota | Maat | Wymiar | Ölçü | 寸法 | 치수 |
| Zeitachse | Chronologie | Línea de tiempo | Timeline | Linha do tempo | Tijdlijn | Oś czasu | Zaman çizelgesi | タイムライン | 타임라인 |
| Baugruppe | Assemblage | Ensamblaje | Assieme | Montagem | Samenstelling | Złożenie | Montaj | アセンブリ | 어셈블리 |
| Zeichnung | Mise en plan | Plano | Disegno | Desenho | Tekening | Rysunek | Teknik resim | 図面 | 도면 |
| Rohteil | Brut | Material en bruto | Grezzo | Bruto | Ruw materiaal | Półfabrykat | Ham parça | ストック | 소재 |
| Werkzeug | Outil | Herramienta | Utensile | Ferramenta | Gereedschap | Narzędzie | Takım | 工具 | 공구 |
| Operation | Opération | Operación | Operazione | Operação | Bewerking | Operacja | Operasyon | オペレーション | 작업 |
| Setup | Configuration | Configuración | Setup | Setup | Opspanning | Zamocowanie | Kurulum | セットアップ | 셋업 |
| Nullpunkt | Origine pièce | Origen de pieza | Origine pezzo | Origem da peça | Nulpunt | Punkt zerowy | Sıfır noktası | ワーク原点 | 공작물 원점 |
| Vorschub | Avance | Avance | Avanzamento | Avanço | Voeding | Posuw | İlerleme | 送り速度 | 이송 속도 |
| Drehzahl | Vitesse de broche | Velocidad del husillo | Velocità mandrino | Rotação do fuso | Spiltoerental | Obroty wrzeciona | İş mili devri | 主軸回転数 | 주축 회전수 |
| Zustellung (Tiefe) | Passe en profondeur | Profundidad de pasada | Passo in profondità | Passo em profundidade | Stapdiepte | Głębokość skrawania | Paso derinliği | 切込み深さ | 절입 깊이 |
| Bahnabstand | Pas latéral | Paso lateral | Passo laterale | Passo lateral | Zijstap | Krok boczny | Yanal paso | ステップオーバー | 경로 간격 |
| Aufmaß | Surépaisseur | Sobremetal | Sovrametallo | Sobremetal | Overmaat | Naddatek | Paso payı | 取り代 | 여유량 |
| Schruppen / Schlichten | Ébauche / Finition | Desbaste / Acabado | Sgrossatura / Finitura | Desbaste / Acabamento | Voorfrezen / Nafrezen | Zgrubna / Wykańczająca | Kaba / Finiş | 荒加工 / 仕上げ | 황삭 / 정삭 |
| Kontur | Contour | Contorno | Contorno | Contorno | Contour | Kontur | Kontur | 輪郭 | 윤곽 |
| Tasche | Poche | Cajera | Tasca | Cavidade | Kamer | Kieszeń | Cep | ポケット | 포켓 |
| Bohren | Perçage | Taladrado | Foratura | Furação | Boren | Wiercenie | Delme | 穴あけ | 드릴링 |
| Gewindefräsen | Fraisage de filets | Fresado de roscas | Fresatura filetti | Fresamento de rosca | Draadfrezen | Frezowanie gwintów | Diş frezeleme | ねじ切りフライス | 나사 밀링 |
| Postprozessor | Post-processeur | Postprocesador | Postprocessore | Pós-processador | Postprocessor | Postprocesor | Post işlemci | ポストプロセッサ | 포스트 프로세서 |
| Einstellungen | Préférences | Preferencias | Preferenze | Preferências | Voorkeuren | Ustawienia | Tercihler | 基本設定 | 환경설정 |
