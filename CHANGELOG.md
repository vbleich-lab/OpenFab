# Änderungen

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
