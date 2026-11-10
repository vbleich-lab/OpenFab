# Änderungen

## Unveröffentlicht

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

Erster Release Candidate für OpenFab 1.0.

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
