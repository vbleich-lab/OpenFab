# Änderungen

## Unveröffentlicht

### Neu
- **Automatische CAM-Tests** (`npm run test:cam`, 84 Prüfungen): alle 36 Frässtrategien an einem Prüfteil mit exakt bekannter Form, alle Postprozessoren, alle Drehoperationen, Lochmuster und Bohrreihenfolge. Laufen bei jedem Push auf GitHub.

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
