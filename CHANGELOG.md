# Änderungen

## v1.0.0-rc.5 – 2026-11-11

### Updates direkt von GitHub
- WerkFab sieht beim Start nach einer neuen Version. Die **installierte Windows-App** und das **Linux-AppImage** laden das Update auf Wunsch selbst und installieren es beim Neustart oder beim Beenden.
- Der Windows-Ordner ohne Installation, macOS (ohne gekauftes Zertifikat lässt Apple keine Selbst-Updates zu) und die Browser-Version zeigen einen Hinweis und öffnen die Download-Seite.
- Abschaltbar unter Voreinstellungen → Allgemein → Updates; dort gibt es auch „Jetzt nach Updates suchen". Das ist die einzige Verbindung ins Netz, die das Programm von sich aus aufbaut.

### Online-Demo
- Die Browser-Version läuft jetzt auch direkt im Netz: https://vbleich-lab.github.io/WerkFab/ (wird bei jeder Änderung neu gebaut).

### Starttest der Apps
- Bei jedem Release werden die gepackten Apps für Windows, Linux und macOS einmal gestartet und geprüft, ob die Oberfläche erscheint.
- README-Bilder und Demo-GIF neu aufgenommen (englische Oberfläche).

## v1.0.0-rc.4 – 2026-11-11

### Installer und Apps für Windows, Linux und macOS
- **Windows**: Installer `WerkFab-<Version>-windows-x64-setup.exe` (Installation je Benutzer, Startmenü, Desktop-Verknüpfung, Deinstallation); die Version ohne Installation gibt es weiter als Zip.
- **Linux**: AppImage und tar.gz (x86_64).
- **macOS**: dmg für Apple Silicon und für Intel, ad hoc signiert (nicht von Apple beglaubigt – erster Start per Rechtsklick → Öffnen). Mit eigenem Bearbeiten-Menü, damit Kopieren und Einfügen per Tastatur gehen.
- Linux und macOS werden automatisch auf GitHub gebaut und sind dort nicht von Hand getestet.

### Neuer Name: WerkFab
- Das Programm heißt jetzt **WerkFab** (Werkstück + Fabrikation). Der frühere Name war schon anderweitig vergeben. Gespeicherte Projekte, Einstellungen und Bibliotheken bleiben erhalten; die Windows-App heißt `WerkFab.exe`, die Download-Dateien `WerkFab-<Version>-…zip`.

### Sprachen: Englisch und Chinesisch
- Die Oberfläche gibt es jetzt auf **Deutsch, Englisch und Chinesisch**. Beim ersten Start richtet sie sich nach der Sprache des Browsers (unbekannte Sprachen: Englisch); umstellen unter Voreinstellungen → Einheiten- und Wertanzeige → Sprache.
- Die Texte werden beim Anzeigen übersetzt (Wörterbücher in `js/lang/`), auch Meldungen mit Zahlen und Namen, Tooltips, die Würfelbeschriftung und die exportierte Zeichnung, das Einrichteblatt und die Werkzeugliste. Was keine Übersetzung hat, bleibt deutsch; Kommentare im NC-Programm sind immer deutsch.
- Neue Werkzeuge: `node tools/i18n-extract.mjs` sammelt die Texte aus dem Quelltext, `node tools/i18n-build.mjs merge` baut die Wörterbücher, `npm run test:i18n` prüft sie.

### Sicherheitshinweis am NC-Programm
- Das Fenster „NC-Programm" zeigt jetzt in jeder Sprache den Hinweis, dass jedes Programm vor dem ersten Lauf an der Maschine im Probelauf oder in einem externen NC-Simulator geprüft werden muss. Die README (jetzt auf Englisch, die deutsche Fassung in `README.de.md`) hat dazu einen eigenen Abschnitt.

### Zeichnung: Halbschnitt und abgesetzter Schnitt
- Der Schnitt der Vorderansicht hat einen **Schnittverlauf**: Vollschnitt, **Halbschnitt** (nur die rechte Hälfte geschnitten) oder **abgesetzt** (zwei Ebenen mit Sprung bei einem X-Wert – automatisch links und rechts durch die jeweiligen Bohrungen). Die Schnittlinie in der Draufsicht folgt dem Verlauf, mit dicken Enden und Ecken.

### Fräsen: Restmaterial bei der 2D-Kontur
- Auch die **2D-Kontur** hat „Restmaterialbearbeitung": gefahren werden nur die Stellen, denen ein größerer Fräser nicht folgen konnte (Innenecken, enge Stellen), mit kurzem Überlapp auf die fertige Wand – im Testfall 266 statt 686 mm. Ohne An-/Abfahrbögen, Haltestege und Schlichtdurchgänge; Korrektur im Rechner.

### Skizze: Verlängern und exakte Schnittkanten
- **Verlängern** geht auch an offenen Linienzügen mit Abrundungen oder Fasen.
- Langlöcher, gerundete Rechtecke und Linienzüge mit Abrundungen zählen beim Stutzen und Verlängern mit ihren exakten Bögen als Schnittkanten (vorher angenähert).

### Zeichnung: mehrere Details mit eigenen Maßen, zweiter Schnitt
- **Mehrere Detailansichten** auf einem Blatt („Detail hinzufügen" beliebig oft). Jede hat ihre eigene Vergrößerung (bis 10×), ihren Radius und lässt sich einzeln neu platzieren, verschieben und entfernen.
- **Maße in der Detailansicht**: Längen, Durchmesser, Radien, Winkel, Hinweise und Toleranzrahmen lassen sich direkt im Detail setzen und zeigen die wahren Größen. Sie wandern mit, wenn das Detail verschoben wird, und verschwinden mit ihm.
- **Seitenansicht als Schnitt**: zusätzlich zum Schnitt der Vorderansicht ein zweiter Schnitt quer dazu (Schnittlage X automatisch durch die Bohrungen oder von Hand). Die Schnittlinie mit Pfeilen steht in der Vorderansicht.
- Schnitte und Details teilen sich eine Buchstabenreihe (Schnitt A–A, Schnitt B–B, Detail C …). Ein Detail aus einer Schnittansicht zeigt die Schraffur mit.

### Skizze: Stutzen für Langlöcher und gerundete Konturen, Stutzen durch Wischen
- **Stutzen** geht jetzt auch bei Langlöchern, gerundeten Rechtecken und Linienzügen mit Abrundungen oder Fasen: die Form wird dabei in ihre Linien und Bögen zerlegt, das angeklickte Stück entfernt.
- **Wischen**: Maustaste gedrückt halten und über alles fahren, was weg soll – jedes überfahrene Stück wird gestutzt.
- Ellipsen, Splines und Text bleiben Schnittkanten, lassen sich aber selbst nicht stutzen.

### Fräsen: Restmaterial bei der 2D-Tasche
- Die **2D-Tasche** hat den Schalter „Restmaterialbearbeitung" mit dem Durchmesser des vorigen Fräsers. Gefräst wird dann nur dort, wo der größere Fräser Material stehen gelassen hat (Ecken, enge Stellen) – im Testfall 490 statt 3931 mm Schnittweg.
- Mit Restmaterial wird kein Steuerungszyklus ausgegeben (die Steuerung kennt das Restmaterial nicht).

## v1.0.0-rc.3 – 2026-11-10

### Konstruktion: Gewindebohrung im Bohrungs-Feature
- Die **Bohrung** hat den Schalter „Gewindebohrung" mit Gewindegröße (M3 … M30) und optionaler Gewindetiefe. Gebohrt wird das Kernloch; das Gewinde erscheint als Gewindedarstellung am Modell. Bei Senkbohrungen und Senkungen beginnt es unter der Senkung.
- In der Zeichnung heißt die Bohrung dann automatisch nach dem Gewinde („4× M8×1,25 ↧8,5"), mit Dreiviertelkreis in der Draufsicht und gestrichelten Linien in den Seitenansichten.

### Skizze: Versatz als Klick-Werkzeug
- **Versatz** arbeitet jetzt wie Abrunden und Fase: Werkzeug wählen, mit der Maus neben eine Kontur fahren (die Seite bestimmt die Richtung, Vorschau des Ergebnisses), klicken, Abstand bestätigen (vorbelegt mit dem letzten Wert). Das Werkzeug bleibt aktiv, Esc beendet.
- Neu auch für **offene Linienzüge** (Versatz links oder rechts der Linie, Ecken auf Gehrung, sehr spitze Ecken abgeschnitten). Kreise bleiben Kreise, einfache Rechtecke bleiben Rechtecke (ein Eckenradius wächst mit).
- Mit vorher gewählten geschlossenen Konturen arbeitet die Schaltfläche wie bisher sofort.
- **Spiegeln mit Vorschau**: Elemente wählen, „Spiegeln“, über die Spiegelachse fahren (das Spiegelbild wird angezeigt) und klicken. Auch Konstruktionslinien dienen als Achse. Wie bisher geht auch: Achse als letztes Element mitwählen.
- **Muster mit Vorschau**: Elemente wählen, „Rechteck-Muster“ oder „Kreis-Muster“; die Maus zeigt den Abstand der ersten Kopie bzw. den Mittelpunkt, die Kopien erscheinen als Vorschau. Nach dem Klick eine Eingabe statt vier („3; 20; 1; 20“ bzw. „6; 360“), vorbelegt mit dem Gezeigten. Fast waagerechte oder senkrechte Abstände rasten auf die Achse.
- Neues Modul `js/sketchoffset.js`, Test `tools/test-sketchoffset.mjs` (19 Prüfungen, auch Spiegeln) in `npm run test:sketch`.
- Zeichnung: Eine Ansicht ohne Linien (noch kein Körper sichtbar) erzeugte ungültige Zahlen im Blatt – sie wird jetzt ausgelassen. Die Hinweislinie einer Fasenangabe zeigt vom Teil weg.

### Zeichnung: Winkelmaße, Hinweise, Toleranzen
- **Winkelmaß**: Richtung „Winkel" wählen, dann die Ecke und je einen Punkt auf beiden Schenkeln anklicken – Maßbogen mit Gradzahl.
- **Hinweis mit Pfeil**: Stelle in einer Ansicht anklicken (rastet an Ecken), Text eingeben; Winkel der Hinweislinie einstellbar.
- **Zusatz hinter der Maßzahl**: Textfeld je Maß für Toleranz, Passung oder Anzahl („±0,1", „H7", „4×") – auch bei Durchmesser, Radius und Winkel.
- **Mittellinien**: Achsen von Zylindern (Wellen, Zapfen, Bohrungen) erscheinen als Strichpunktlinie, wo die Achse in der Blattebene liegt, und als Kreuz, wo sie auf den Betrachter zeigt; im Dialog abschaltbar.
- **Pfeilspitzen** der Maße sind jetzt 2,5 mm lang (vorher drei Linienbreiten, etwa 0,5 mm).
- **Maße mit der Maus verschieben**: eigene Maße und Hinweise im Blatt greifen und ziehen – Abstand der Maßlinie, Winkel (und Länge) der Hinweislinie, Radius des Winkelbogens; mit Vorschau beim Ziehen.
- **Oberflächenzeichen**: „Oberflächenzeichen hinzufügen“, eine Körperkante anklicken, Rauheit eingeben (z. B. Ra 3,2). Das Zeichen (Haken mit Querstrich nach ISO 1302, materialabtragend) steht auf der Seite der Kante, von der geklickt wurde, und lässt sich mit der Maus in 15°-Schritten drehen.
- Oberflächenzeichen in drei Formen: spanend, beliebiges Verfahren, ohne Materialabtrag.
- **Form- und Lagetoleranzen**: Toleranzrahmen mit Hinweislinie – Art (Position, Ebenheit, Geradheit, Rundheit, Zylinderform, Parallelität, Rechtwinkligkeit, Neigung, Koaxialität, Symmetrie, Rundlauf), Toleranzwert und Bezüge („Ø0,05 A B“). Die Symbole sind gezeichnet, nicht aus einer Schrift.
- **Bezug**: gefülltes Dreieck auf der Kante mit Buchstabe im Quadrat; der nächste freie Buchstabe wird vorgeschlagen.
- **Gewinde** werden normgerecht dargestellt: in Achsrichtung gesehen ein dünner Dreiviertelkreis, Bolzengewinde von der Seite mit dünnen Linien am Kerndurchmesser und dem Gewindenamen an einer Hinweislinie; Gewindebohrungen heißen in der Bohrungsangabe „M8×1,25 ↧12“ statt nach dem Kernloch.
- Gewindebohrungen erscheinen auch von der Seite: dünne gestrichelte Linien am Nenndurchmesser über die Gewindelänge, mit Abschlusslinie.
- **Fasenangabe**: Richtung „Fase“ wählen und beide Enden der schrägen Kante anklicken – ergibt „2×45°“ bzw. „2×3“ an einer Hinweislinie.
- Test `npm run test:drawing` (23 Prüfungen).

### Rendern: Studio-Look
- Neuer Hintergrund **„Studio-Verlauf"** (Voreinstellung): weicher senkrechter Verlauf passend zur Umgebung (hell, dunkel, warm, neutral) statt der unscharfen Umgebung mit ihren hellen Lichtflächen; der Boden ist ein Lichtfleck unter dem Teil, der zum Rand hin ausblendet – keine Horizontlinie mehr.
- Weicher Kontaktschatten unter dem Teil, kräftigeres Hauptlicht und etwas zurückgenommene Belichtung: das Teil wirkt plastischer und nicht mehr ausgewaschen. Spiegelung in der Voreinstellung dezenter (0,12 statt 0,25).
- „Umgebung (unscharf)" und „Einfarbig" bleiben wählbar; bestehende Projekte mit eigener Hintergrund-Einstellung ändern sich nicht.

### Drehen: freie Konturen mit der C-Achse
- **Neue Operation „Kontur Planfläche"**: Kurven einer Skizze auf der Stirnseite mit axial stehendem angetriebenem Fräser (X und C gemeinsam, Fanuc Polar-Interpolation G12.1). Fräser auf der Kurve, innen oder außen an geschlossenen Konturen; offene Kurven hin und zurück; Zustellung in Z.
- **Neue Operation „Kontur Mantelfläche"**: Kurven einer Skizze, die längs zur Drehachse liegt, werden auf den Umfang gewickelt und mit radial stehendem Fräser gefräst (Z und C gemeinsam). Fanuc mit Zylinder-Interpolation (`G19 W0 H0`, `G7.1 C<Radius>` … `G7.1 C0`, `G18`) über die neuen Vorlagen „Zylinder-Interpolation ein/aus"; ohne Vorlage mit Hinweis.
- **Neue Operation „Tasche Planfläche"**: Tasche aus den geschlossenen Konturen einer Skizze auf der Stirnseite (innere Konturen bleiben als Inseln), von innen nach außen geräumt, Eintauchen auf einer Rampe entlang der innersten Bahn, innerhalb einer Ebene ohne Abheben; Polar-Interpolation.
- Simulation: die gefrästen Konturen erscheinen als Bänder auf Planfläche und Umfang; NC-Prüfung und Dreh-Prüfer kennen G7.1.
- Tests: Bahn liegt auf den Skizzenkurven (abgewickelt auf 0,001 mm), Tasche bleibt in der Kontur und räumt vollständig; 9 neue Prüfungen in `npm run test:lathe`.

### Dreh-Postprozessoren: strenger Prüfer und Sicherheitskorrekturen
- **Neuer Prüfer für Drehprogramme** (`tools/lib/lathe-lint.mjs`) für Fanuc, Okuma OSP-L und LinuxCNC: Werkzeugaufruf, Hauptspindel, angetriebenes Werkzeug und C-Achse, Vorschub, Dreh- und Gewindezyklen samt Konturzeilen, Polar-Interpolation und der Ort des Revolverwechsels. `npm run test:lathe`: die Beispielwelle mit allen Operationen als Bahn und als Zyklen, 86 Prüfungen.
- **Revolver schaltet nicht mehr am Teil**: Der Werkzeugwechsel stand 2 mm neben dem Rohteil und 5 mm vor der Planfläche. Jetzt Fanuc `G28 U0 W0` (auch am Programmende), Okuma und LinuxCNC eine Wechselposition (Voreinstellung Rohteil-Ø + 200 mm, 100 mm vor dem Sicherheitsabstand; neue Postprozessor-Eigenschaften „Werkzeugwechsel X (Ø)" und „Werkzeugwechsel Z").
- Keine Fahrt in Werkstückkoordinaten mehr am Programmanfang, bevor ein Werkzeug aufgerufen ist.
- **Satznummern + Drehzyklen**: Konturzeilen bekamen eine zweite N-Nummer (`N200 N9010 …`), der Zyklus fand seine Kontur nicht. Zeilen mit eigener Nummer behalten sie, die laufende Nummerierung überspringt diese Werte.

### G-Code-Postprozessoren: strenger Prüfer und Sicherheitskorrekturen
- **Neuer G-Code-Prüfer** (`tools/lib/iso-lint.mjs`) für Fanuc/ISO, Okuma OSP-M, LinuxCNC, GRBL und Sinumerik 840D: Wörter jedes Satzes und der Zustand der Steuerung (Maßeinheit, Werkzeug und Längenkorrektur, Spindel und Drehrichtung, Vorschub, Radiuskorrektur, Bohrzyklus, Kreisgeometrie). `npm run test:iso`: jedes Programm in fünf Optionskombinationen, 100 Prüfungen.
- **Fanuc**: Werkzeuglängenkorrektur `G43 H…` nach jedem Werkzeugwechsel (fehlte ganz); vor dem Werkzeugwechsel und am Programmanfang `G91 G28 Z0`.
- **Alle Steuerungen mit Längenkorrektur**: keine Z-Fahrt in Werkstückkoordinaten mehr am Programmanfang, bevor ein Werkzeug mit Korrektur aktiv ist (LinuxCNC `G53 G0 Z0`, Sinumerik `G0 SUPA Z0 D0`, Okuma ohne).
- **Linksgewinde mit G74**: Spindel läuft dafür links (`M4`), danach wieder rechts.
- **Sinumerik**: Bohrzyklen CYCLE81/82/83 bekommen ihren Vorschub (`F…` vor dem Zyklus; vorher galt der Vorschub der vorigen Operation). Rückzug in Maschinenkoordinaten als `G0 SUPA Z0 D0` statt G28/G53.
- **Okuma OSP-M**: kein `G5.1` (Fanuc-Glättung) und kein G28/G53-Rückzug mehr (G53 hebt dort die Längenkorrektur auf) – mit Hinweis.
- Bohrpositionen eines Zyklus ohne führendes Leerzeichen.

### Fräsen: kürzester sicherer Weg zwischen den Schnitten
- Neue Rückzugsrichtlinie **„Kürzester sicherer Weg (über dem Restmaterial)"**: Das Werkzeug hebt zwischen zwei Schnitten nur so weit ab, wie das Material auf dem Weg es verlangt – Rohteil abzüglich allem, was das Setup bis dahin gefräst hat, nie unter dem Modell – plus Sicherheitsabstand, und beginnt den Vorschub erst dort. Voreinstellung für neue 3D-Operationen; bestehende Operationen bleiben beim vollständigen Rückzug. Mit gewählten Spannmitteln bleibt es beim vollständigen Rückzug.
- Am Prüfteil nach dem Schruppen: Ecken-Restmaterial 41 → 29 min, Steilbereiche 44 → 35 min, Spirale 31 → 23 min, Planflächen 8,4 → 6,7 min.
- Test: Eilgänge gegen das exakte Teil und gegen ein eigenes, feineres Restmaterial-Modell geprüft (mindestens 1,00 mm Abstand), Schnittbahn unverändert.

### Heidenhain und Fräsen: Feinschliff
- **Neuer Klartext-Prüfer** (`tools/lib/hh-lint.mjs`): prüft jeden Satz gegen die Klartext-Regeln und führt den Zustand der Steuerung mit (Werkzeug, Spindel, Vorschub, Kreismittelpunkt, Radiuskorrektur, Zyklus, Label, Schwenkebene, Zyklusparameter, Kreisendpunkte). Er läuft über alle Frässtrategien und über ein Programm mit allen Zyklen in sechs Optionskombinationen (`npm run test:hh`, 74 Prüfungen; dazu 44 in `test:cam`).
- **Geschwenkte Aufspannung**: Freifahren vor dem Schwenken und am Ende mit `M140 MB MAX` statt einer Höhe über dem noch nicht geschwenkten Nullpunkt; am Programmende `PLANE RESET TURN` (Achsen zurück auf 0); Werkzeugwechsel im ungeschwenkten System. Zyklus 19 positioniert jetzt die Drehachsen (`L A+Q120 C+Q122`, nach der Kinematik der Maschine) und wird vollständig zurückgesetzt.
- **Radiuskorrektur ohne APPR/DEP** endet auf der Abfahrbewegung in der Ebene (R0 bzw. G40) statt auf dem reinen Z-Rückzug danach.
- **Kreisbögen**: Schraubenlinien-Stücke werden nicht mehr zu Ketten verbunden, deren Endpunkt neben dem Kreis liegt (trat bei der 3D-Spirale auf); Bögen enden nur auf Punkten, die auf dem Kreis liegen; Reste eines Vollkreises werden ein Bogen um denselben Mittelpunkt statt einzelner Geraden.
- **Zyklen mit Tiefe 0** (Skizze ohne Tiefe) werden nicht mehr ausgegeben – stattdessen die Bahn mit Hinweis; der Zyklus beginnt dann an der Oberkante der Operation.
- Kommentare: Minuszeichen, Gedankenstriche, Grad- und Anführungszeichen bleiben lesbar („−Y nach oben" wurde zu „Y nach oben"); der Werkzeugdurchmesser steht nicht mehr doppelt im Werkzeugkommentar.
- **2D-Tasche**: Die Ringe einer Ebene werden ohne Abheben verbunden (Übergang genau einen Bahnabstand lang) – ein Eintauchen pro Ebene statt eines pro Ring; im Beispielteil 37 % weniger Weg.
- **Kreistasche**: taucht auf einer Schraubenlinie ein (kleiner als der Fräser, kein Kern) statt senkrecht in der Mitte; Ausgabe als CP-Satz.
- **Schlankere NC-Programme**: Punkte, die auf der Geraden zwischen ihren Nachbarn liegen, entfallen (höchstens ein Viertel der Toleranz der Operation, maximal 0,002 mm). 3D-Schruppen mit Versatzbahnen: 73 % weniger Sätze bei gleicher Bahn.

### Drehen: angetriebene Werkzeuge (C-Achse)
- **Neue Operation „Bohren angetrieben"** (Reiter DREHEN): axial in die Planfläche auf einem Lochkreis oder radial als Querbohrung in den Durchmesser. Positionen über Anzahl + Startwinkel oder einzelne Winkel („0; 90; 200"), mit Entspanen.
- **Bohrungen aus dem Modell übernehmen**: erkennt Bohrungen parallel zur Drehachse und Querbohrungen durch die Achse und trägt Lochkreis bzw. Position Z, Winkel und Tiefe ein (beim Anlegen automatisch).
- **NC-Ausgabe** mit C-Wort; neue Postprozessor-Vorlagen „C-Achse und angetriebenes Werkzeug ein/aus" für Fanuc (M45/M46, M13), Okuma (M110/M109, SB= M13) und LinuxCNC. Danach läuft die Hauptspindel wieder an. Die M-Codes sind maschinenabhängig – das Programm weist darauf hin.
- **Simulation**: Werkzeug steht bei Querbohrungen radial, Bohrungen erscheinen im gedrehten Rohteil; Anzeige X/Z/C.
- **NC-Prüfung**: Zeilen mit C werden im Backplot am richtigen Winkel gezeichnet und nicht gegen das Drehprofil geprüft.
- **Neue Operation „Nut angetrieben"**: Nut längs der Drehachse (Passfedernut) mit radial stehendem Fräser, an einem oder mehreren Winkeln, in radialen Zustellungen im Zickzack; offen zur Planfläche oder mit Eintauchen am Start.
- **Neue Operation „Schlüsselflächen"**: Zweiflach, Vierkant, Sechskant am Teilende mit axial stehendem Schaftfräser; Schlüsselweite, Länge, Zustellung radial und in Z. Ausgabe in **Polar-Interpolation** (Fanuc G12.1 … G13.1, X als Durchmesser, C in mm, Eilwege als schnelle G1) über die neuen Vorlagen „Polar-Interpolation ein/aus"; ohne Vorlage als kurze X/C-Schritte (Sehnenfehler ≤ 0,01 mm) mit Hinweis.
- Simulation: Nuten als Ausschnitt im Rohteil, Flächen werden am gedrehten Rohteil abgeschnitten; NC-Prüfung liest G12.1/G13.1.
- Tests: 30 neue Prüfungen in `npm run test:cam` (Positionen, Tiefen, Eilgänge, Geradheit der Flächenbahnen, alle drei Dreh-Postprozessoren).

### Skizze: Abrunden und Fase
- **Ecke anklicken**: Abrunden und Fase sind Klick-Werkzeuge wie Stutzen – Werkzeug wählen, über eine Ecke fahren (Vorschau des Ergebnisses), anklicken, Wert bestätigen (vorbelegt mit dem letzten Wert); das Werkzeug bleibt für weitere Ecken aktiv, Esc beendet. Vorher gewählte Eckpunkte werden wie bisher auf einmal geändert.
- **Neues Werkzeug Skizzen-Fase** (gleicher Abstand oder ungleich „2; 3“), neben Abrunden in der Skizzenleiste und im Markierungsmenü; im Eigenschaftenfenster pro Eckpunkt Radius (R) und Fase (F).
- Abrunden und Fase wirken jetzt auch an **Rechteckecken** (das Rechteck wird ein Linienzug, bleibt über Horizontal-/Vertikal-Bedingungen rechtwinklig, Formeln wie `=laenge` bleiben erhalten) und an Punkten, an denen **zwei einzelne Linien** zusammentreffen (sie werden zu einem Linienzug verbunden, Bedingungen werden umnummeriert).
- **Exakte Geometrie**: gerundete/gefaste Ecken werden im Körper echte Zylinder- und Fasenflächen statt vieler Facetten (Volumen am Prüfteil exakt); offene Linienzüge mit Rundung behalten ihren Bogen auch bei Flächen und Pfaden (wurde vorher ignoriert).
- Anzeige und CAM-Konturen: Bögen mit höchstens 0,005 mm Sehnenfehler (vorher feste 0,4-mm-Schritte, höchstens 64 Stück).
- Zu große Radien/Fasen werden auf jeder Kante gemeinsam verkleinert und gemeldet, statt einzeln auf die halbe Kantenlänge gekürzt.
- Spiegeln behält Rundungen und Fasen (wurden vorher verworfen).
- Tests: `tools/test-sketchcorner.mjs` (29 Prüfungen) in `npm run test:sketch`.

## v1.0.0-rc.2 – 2026-11-09

### Neu
- **Dreh-Schlichtzyklus der Steuerung**: Konturschlichten „Als Steuerungszyklus ausgeben“ schreibt Fanuc `G70 P…Q…` bzw. Okuma `G87 N…` auf die Kontur des Schruppzyklus davor (G71 / G85). Das Schlichtaufmaß geht jetzt als `U` an die Steuerung, die Zykluskontur ist die Fertigkontur (schneidenradiuskompensiert), der Schlichtvorschub steht im ersten Konturblock. Die NC-Prüfung/Simulation liest G70/G87 und das Aufmaß U mit.
- **Exakte Flächenberührung in 3D**: die Höhenkarte kennt jetzt die Dreiecke des Netzes; Kugel- und Schaftfräser werden an Fläche, Kante und Ecke der Dreiecke um die erwartete Berührstelle exakt abgesenkt (auch Dreiecke kleiner als das Raster und Wandoberkanten zwischen den Kantenproben). Schlichtbahnen am Prüfteil: tiefster Punkt 0,02–0,026 → ≤ 0,013 mm gegen die ideale Kugel, davon bis 0,005 mm Facettenfehler des Prüfnetzes. Testtoleranz Schlichten 0,04 → 0,02 mm.
- **Automatische CAM-Tests** (`npm run test:cam`, 90 Prüfungen): alle 36 Frässtrategien an einem Prüfteil mit exakt bekannter Form, alle Postprozessoren, alle Drehoperationen, Lochmuster und Bohrreihenfolge. Laufen bei jedem Push auf GitHub.

### Behoben (von den neuen Tests gefunden)
- 3D-Strategien schnitten an **senkrechten Außenecken** bis 0,46 mm ins Teil: die Höhenkarte sucht jetzt auch die Eckpunkte selbst.
- **Z-Ebenen-Strategien** (Kontur, Steil & Flach, Räumen, Adaptiv 3D, Materialeinfahrt, Ecke) lagen bis 0,37 mm zu nah an Wänden: Konturen werden jetzt zwischen den Rasterpunkten exakt verfolgt (Marching Squares + Bisektion) statt aus Rasterzellen zusammengesetzt.
- **Aufmaß** wirkt jetzt senkrecht zur Fläche statt nur in Z: an steilen Wänden blieb vorher seitlich kein Aufmaß stehen.
- Bahnen über **Wandkanten** (Parallel, Spirale, Radial, HSC-Kontur, Morph …) schnitten die Kante bis 0,4 mm an: steile Sprünge werden jetzt immer eingegrenzt.
- **Schaftfräser** an schrägen/gewölbten Flächen bis 0,26 mm zu tief: der Werkzeugrand wird jetzt mitgeprüft.
- **Adaptiv 3D** hielt das Aufmaß um bis 0,18 mm nicht ein (Rasterrundung).
- **3D-Horizontal** schnitt bis 0,5 mm in ansteigende Flächen.
- **Drehen**: Schneidenmodell korrigiert (Schneidenrundung bis zum Tangentenpunkt der Nebenschneide), Profil feiner und sicher abgetastet, Ecken werden nachverfeinert, Punktreduktion nach Douglas-Peucker – Konturschlichten schnitt Kanten bis 0,1 mm an.

## v1.0.0-rc.1 – 2026-11-09

Erster Release Candidate für WerkFab 1.0.

### Neu seit den Vorabversionen
- **CAM-Strategietest** an einem eigenen Prüfteil (36 Operationen): alle Strategien ohne Verletzung des Fertigteils (außer Gewindebohren/Entgraten, die bewusst bis auf Kontur gehen).
- 3D-Bahnen glätten mit Douglas-Peucker statt gierig; steile Sprünge an Wandkanten werden nachverfeinert.
- Höhenkarte mit Kanten-Unterabtastung: Kugelfräser schneiden nicht mehr in senkrechte Außenwände.
- Restmaterial in Ecken: Vergleich der bearbeiteten Fläche statt Werkzeugmittelpunkt-Höhen (296 → 18 min am Prüfteil).
- **Schneller rechnen**: Adaptiv 3D 23 → 8 s, 2D-Adaptiv 16 → 4,5 s, Geodätisch 20 → 9,4 s, 3D-Radial 7 → 4,6 s bei identischen Bahnen.
- Simulation prüft den Werkzeugschaft mit dem echten Schaftdurchmesser.
- **Blech**: geschlossene Ecken (Gehrung mit Spalt) und Eckfreistellung rund/eckig in der Abwicklung und im gebogenen Teil.
- Lasche an Lasche (U-Falz, Z-Stufe, Umschlag).
- Steuerungszyklen: Taschen, Nuten, Zapfen, Lochkreise/-raster (Heidenhain, Sinumerik), Dreh-Schrupp- und Gewindezyklen (Fanuc, Okuma).
- Heidenhain APPR/DEP, Helix-Ausgabe, Syntaxprüfung.
- Postprozessor-Editor mit Live-Vorschau und eigener Bibliothek.
- 4-Achs-Simultan (Rotation, Schruppen, Abwickeln) mit Zylinder-Simulation und NC-Prüfung.
- Drehen innen (Bohren, Innendrehen, Innen-Einstich, Innengewinde) und Schneidengeometrie in der Prüfung.
- 3+2-Kinematik mit Achsgrenzen- und Tischkollisionsprüfung.

### Bekannt
- Okuma-Ausgabe ist nicht an einer echten Steuerung geprüft – Probelauf!
- Kein simultanes 5-Achs-Fräsen, keine angetriebenen Werkzeuge beim Drehen.
