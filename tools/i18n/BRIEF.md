# Translating the OpenFab user interface

OpenFab is a CAD/CAM program (sketches, 3D modelling, assemblies, drawings, CNC milling and turning, post
processors) whose user interface is written in German. You translate one chunk of its texts into **English (en)** and
**Simplified Chinese (zh)** (the glossary also has a Russian column; Russian is not shipped at present).

## Input and output

- Input: `tools/i18n/chunks/NN.json` – a JSON array of German texts.
- Output: the files `tools/i18n/out/en-NN.json` and `tools/i18n/out/zh-NN.json`, each a JSON
  object `{ "German text exactly as given": "translation", … }`.
- Write the files with the Write tool (UTF-8, real characters, no \u escapes needed). Do **not** write a script
  that translates – you are the translator. Work through the chunk in order; do not skip texts because they are long.
- Afterwards run `node tools/i18n-build.mjs check tools/i18n/out/en-NN.json` (and the same for zh) from the
  project folder and fix everything it reports until it says `0 Fehler`.

## Rules

1. The key must be **byte-identical** to the German text in the chunk (copy it; same quotes „ “, dashes –, spaces, `\n`).
2. `{0}`, `{1}` … stand for values put in at run time (numbers, names). Every placeholder of the key must appear in
   the translation, each exactly as often; reorder them freely to make a natural sentence.
3. Keep line breaks (`\n`) in the same number, keep symbols (Ø, ×, °, ±, →, …, ✕, ⚠), keep units, G-code words
   (G41, M8, CYCL DEF 251), file formats (STEP, DXF), product and control names (Heidenhain, Fanuc, Sinumerik, Okuma,
   LinuxCNC, GRBL, Fusion), key names can be translated (Umschalt → Shift, Strg → Ctrl, Entf → Del, Esc).
4. German decimal commas inside example values stay as they are (e.g. `Ra 3,2`, `±0,1`), because the program reads them that way.
5. Texts in CAPITALS are headings: keep them in capitals in English and Russian.
6. Keep the length close to the original: these are button labels, menu entries, table headings, tooltips and
   hints in narrow panels. Buttons and menu entries: short, imperative or noun, as in professional CAD/CAM software.
7. Leading/trailing punctuation and symbols stay (a trailing `:` or `…`, a leading `⚠ ` or `+ `).
8. **Leave out** (no entry at all) every text that is not German text for the user: identifiers, keys, CSS class
   names, DXF/STEP keywords, NC code, plain proper names, formulas, or anything that reads the same in the target
   language. When in doubt whether a lowercase word is an identifier or German: German words get translated.
9. Use the established terms of CAD/CAM software in each language (as in Autodesk Fusion, SolidWorks, Siemens NX and
   the documentation of CNC controls), consistently – see the glossary. Russian: formal, infinitive for commands
   («Создать эскиз», «Удалить»). Chinese: Simplified, mainland terminology, no spaces between Chinese words,
   full-width punctuation in sentences (，。：), half-width for symbols and numbers.

## Glossary (German → en / ru / zh)

| German | en | ru | zh |
|---|---|---|---|
| Skizze | Sketch | Эскиз | 草图 |
| Extrusion / Extrudieren | Extrude | Выдавливание | 拉伸 |
| Rotation / Drehen (Feature) | Revolve | Вращение | 旋转 |
| Sweep | Sweep | Сдвиг | 扫掠 |
| Erhebung | Loft | Лофт | 放样 |
| Bohrung | Hole | Отверстие | 孔 |
| Gewinde | Thread | Резьба | 螺纹 |
| Gewindebohrung | Tapped hole | Резьбовое отверстие | 螺纹孔 |
| Senkung (zyl.) / Kegelsenkung | Counterbore / Countersink | Цековка / Зенковка | 沉头孔 / 埋头孔 |
| Verrundung / Abrunden | Fillet | Скругление | 圆角 |
| Fase | Chamfer | Фаска | 倒角 |
| Schale | Shell | Оболочка | 抽壳 |
| Formschräge | Draft | Уклон | 拔模 |
| Muster | Pattern | Массив | 阵列 |
| Spiegeln | Mirror | Зеркало | 镜像 |
| Körper | Body | Тело | 实体 |
| Volumenkörper | Solid | Твёрдое тело | 实体 |
| Fläche (Reiter, Flächenmodell) | Surface | Поверхность | 曲面 |
| Fläche (eines Körpers) | Face | Грань | 面 |
| Kante | Edge | Ребро | 边 |
| Netz | Mesh | Сетка | 网格 |
| Blech | Sheet Metal | Листовой металл | 钣金 |
| Lasche | Flange | Фланец | 凸缘 |
| Abwicklung | Flat pattern | Развёртка | 展开图 |
| Baugruppe | Assembly | Сборка | 装配 |
| Komponente | Component | Компонент | 零部件 |
| Gelenk | Joint | Соединение | 联接 |
| Gelenkursprung | Joint origin | Начало соединения | 联接原点 |
| Abhängigkeit | Constraint | Зависимость | 约束 |
| Bemaßung / Maß | Dimension | Размер | 尺寸 |
| Stutzen | Trim | Обрезать | 修剪 |
| Verlängern | Extend | Удлинить | 延伸 |
| Versatz | Offset | Смещение | 偏移 |
| Langloch | Slot | Паз | 槽 |
| Konstruktionslinie | Construction line | Вспомогательная линия | 构造线 |
| Zeitachse | Timeline | Временная шкала | 时间轴 |
| Browser (Strukturbaum) | Browser | Браузер | 浏览器 |
| Arbeitsbereich | Workspace | Рабочее пространство | 工作空间 |
| Konstruktion | Design | Проектирование | 设计 |
| Fertigung | Manufacture | Производство | 制造 |
| Zeichnung / Zeichnungsableitung | Drawing | Чертёж | 工程图 |
| Schnitt / Halbschnitt / Detailansicht | Section / Half section / Detail view | Разрез / Полуразрез / Выносной элемент | 剖视图 / 半剖视图 / 局部放大图 |
| Vorderansicht / Draufsicht / Seitenansicht | Front view / Top view / Side view | Вид спереди / Вид сверху / Вид сбоку | 主视图 / 俯视图 / 侧视图 |
| Schriftfeld | Title block | Основная надпись | 标题栏 |
| Stückliste | Parts list | Спецификация | 明细表 |
| Oberflächenzeichen | Surface texture symbol | Знак шероховатости | 表面粗糙度符号 |
| Form- und Lagetoleranz | Geometric tolerance | Допуск формы и расположения | 几何公差 |
| Bezug | Datum | База | 基准 |
| Einrichtung / Setup | Setup | Установ | 设置 |
| Rohteil | Stock | Заготовка | 毛坯 |
| Nullpunkt | Work origin (WCS) | Нулевая точка | 工件原点 |
| Spannmittel | Fixture | Приспособление | 夹具 |
| Werkzeug | Tool | Инструмент | 刀具 |
| Werkzeugbibliothek | Tool library | Библиотека инструментов | 刀具库 |
| Schaftfräser / Kugelfräser / Torusfräser | Flat end mill / Ball end mill / Bull nose mill | Концевая фреза / Сферическая фреза / Тороидальная фреза | 平底立铣刀 / 球头铣刀 / 圆鼻铣刀 |
| Bohrer / Gewindebohrer / Reibahle | Drill / Tap / Reamer | Сверло / Метчик / Развёртка | 钻头 / 丝锥 / 铰刀 |
| Fasenfräser | Chamfer mill | Фасочная фреза | 倒角刀 |
| Schneidenlänge / Schaft / Halter | Flute length / Shank / Holder | Длина режущей части / Хвостовик / Державка | 刃长 / 刀柄 / 刀夹 |
| Drehzahl | Spindle speed | Частота вращения шпинделя | 主轴转速 |
| Vorschub | Feed rate | Подача | 进给速度 |
| Eintauchvorschub | Plunge feed | Подача врезания | 下刀进给 |
| Schnittgeschwindigkeit | Cutting speed | Скорость резания | 切削速度 |
| Zustellung / Tiefenzustellung | Stepdown | Шаг по глубине | 每层切深 |
| Bahnabstand / Querzustellung | Stepover | Шаг между проходами | 步距 |
| Aufmaß | Stock to leave | Припуск | 余量 |
| Schruppen / Schlichten | Roughing / Finishing | Черновая обработка / Чистовая обработка | 粗加工 / 精加工 |
| Planen / Planfräsen | Face | Торцевание | 面铣 |
| Kontur | Contour | Контур | 轮廓 |
| Tasche | Pocket | Карман | 型腔 |
| Nut | Slot | Паз | 槽 |
| Gravur / Gravieren | Engrave | Гравировка | 雕刻 |
| Bohren | Drilling | Сверление | 钻孔 |
| Gewindefräsen | Thread milling | Резьбофрезерование | 螺纹铣削 |
| Zirkularfräsen | Bore milling | Расфрезеровка отверстия | 镗铣 |
| Antasten | Probing | Измерение щупом | 探测 |
| Adaptiv | Adaptive clearing | Адаптивная обработка | 自适应清洁 |
| Restmaterial | Rest material | Остаточный материал | 残料 |
| Gleichlauf / Gegenlauf | Climb / Conventional | Попутное / Встречное | 顺铣 / 逆铣 |
| Anfahren / Abfahren | Lead-in / Lead-out | Подвод / Отвод | 切入 / 切出 |
| Rampe / Helix / Eintauchen | Ramp / Helix / Plunge | Наклонное врезание / Спираль / Врезание | 斜插 / 螺旋 / 直插 |
| Rückzug / Rückzugshöhe | Retract / Retract height | Отвод / Высота отвода | 退刀 / 退刀高度 |
| Sicherheitshöhe | Clearance height | Безопасная высота | 安全高度 |
| Eilgang | Rapid | Ускоренное перемещение | 快速移动 |
| Haltesteg | Tab | Перемычка | 连接桥 |
| Radiuskorrektur | Cutter compensation | Коррекция на радиус | 刀具半径补偿 |
| Werkzeuglängenkorrektur | Tool length offset | Коррекция на длину инструмента | 刀具长度补偿 |
| Kühlmittel | Coolant | СОЖ | 冷却液 |
| Postprozessor | Post processor | Постпроцессор | 后处理器 |
| NC-Programm | NC program | Управляющая программа | NC 程序 |
| Steuerung | Control | Система ЧПУ | 数控系统 |
| Steuerungszyklus | Control cycle | Цикл системы ЧПУ | 系统固定循环 |
| Satznummer | Block number | Номер кадра | 程序段号 |
| Einrichteblatt | Setup sheet | Карта наладки | 工序卡 |
| Simulation / Abtrag | Simulation / Stock removal | Симуляция / Съём материала | 仿真 / 材料去除 |
| Verletzung / Kollision | Gouge / Collision | Зарез / Столкновение | 过切 / 碰撞 |
| Drehen (Fertigung) | Turning | Точение | 车削 |
| Drehmaschine / Fräsmaschine | Lathe / Milling machine | Токарный станок / Фрезерный станок | 车床 / 铣床 |
| Längsdrehen / Plandrehen | Longitudinal turning / Facing | Продольное точение / Подрезка торца | 外圆车削 / 端面车削 |
| Einstechen / Abstechen | Grooving / Parting | Обработка канавок / Отрезка | 切槽 / 切断 |
| Gewindedrehen | Thread turning | Нарезание резьбы резцом | 车螺纹 |
| Futter / Spannfutter | Chuck | Патрон | 卡盘 |
| Revolver | Turret | Револьверная головка | 刀塔 |
| Angetriebenes Werkzeug | Live tool | Приводной инструмент | 动力刀具 |
| C-Achse | C axis | Ось C | C 轴 |
| Schwenken / Schwenkachse | Tilt / Tilting axis | Наклон / Поворотная ось | 摆动 / 摆动轴 |
| Drehachse | Rotary axis | Ось вращения | 旋转轴 |
| Abrunden (Zahl) | Round | Округлить | 四舍五入 |
| Ansicht | View | Вид | 视图 |
| Einpassen | Fit | Вписать | 适合窗口 |
| Messen | Measure | Измерить | 测量 |
| Voreinstellungen | Preferences | Настройки | 首选项 |
| Rückgängig / Wiederholen | Undo / Redo | Отменить / Повторить | 撤销 / 重做 |
| Speichern / Öffnen / Exportieren / Importieren | Save / Open / Export / Import | Сохранить / Открыть / Экспорт / Импорт | 保存 / 打开 / 导出 / 导入 |
| Abbrechen / Übernehmen / Fertig | Cancel / Apply / Done | Отмена / Применить / Готово | 取消 / 应用 / 完成 |
| Löschen / Umbenennen / Duplizieren | Delete / Rename / Duplicate | Удалить / Переименовать / Дублировать | 删除 / 重命名 / 复制 |
