# WerkFab

[English](README.md) · **Deutsch**

**CAD/CAM für Konstruktion und Fertigung – komplett offline, im Browser oder als App für Windows, Linux und macOS.**

WerkFab ist ein parametrisches 3D-CAD mit integriertem CAM. Teile werden über Skizzen und eine Feature-Zeitachse konstruiert. Danach lassen sich Baugruppen, Zeichnungen und Renderings erstellen und NC-Programme für Fräs- und Drehmaschinen erzeugen, simulieren und prüfen. Alles läuft lokal: kein Konto, keine Cloud, keine Telemetrie.

**[Im Browser ausprobieren](https://vbleich-lab.github.io/WerkFab/)** – die Online-Demo ist das vollständige Programm; es wird nichts hochgeladen, die Arbeit bleibt im eigenen Browser.

> [!CAUTION]
> **Jedes NC-Programm muss vor dem ersten Einsatz geprüft werden – an der Maschine im Probelauf (Einzelsatz, reduzierter Eilgang, ohne Werkstück oder mit Abstand in Z) oder in einem externen NC-Simulator.** Die Simulation in WerkFab ersetzt diese Prüfung nicht. WerkFab ist freie Software ohne jede Gewährleistung; für Schäden an Maschine, Werkzeug, Werkstück oder Personen wird nicht gehaftet (siehe [Sicherheit](#sicherheit-nc-programme-immer-vorher-simulieren)).

> **Status: Release Candidate 7 (v1.0.0-rc.7).** Der Funktionsumfang ist vollständig für 1.0.

![Konstruktion über die Zeitachse, danach Fräsbahnen und Simulation mit Materialabtrag](docs/media/demo.gif)

*Von der Skizze zum fertigen Teil: Konstruktion Schritt für Schritt, danach Werkzeugwege und Simulation.*

---

## Bilder

| Konstruktion | Skizze |
|---|---|
| ![Parametrisches 3D-Modell mit Browser und Zeitachse](docs/media/01-konstruktion.png) | ![Skizze mit Abhängigkeiten und Bemaßungen](docs/media/02-skizze.png) |
| **Fertigung: Werkzeugwege** | **Simulation mit Materialabtrag** |
| ![Fräsbahnen für Planen, Tasche, Bohren und Kontur](docs/media/03-fertigung.png) | ![Simulation der Fräsbearbeitung](docs/media/04-simulation.png) |
| **Drehen** | **Rendern** |
| ![Drehteil mit Schrupp-, Schlicht-, Einstech- und Gewindebahnen](docs/media/05-drehen.png) | ![Rendering im Fotostudio](docs/media/06-rendern.png) |

---

## Funktionen

### Konstruktion (CAD)
- **Skizzen** mit Linie, Rechteck (2 Punkte, Mitte, 3 Punkte), Kreis (Mitte, 2 Punkte, 3 Punkte), Bögen (3 Punkte, Mittelpunkt, tangential), Langloch, Polygon, Text und Konstruktionslinien
- **Geometrischer Solver** mit Bemaßungen und Abhängigkeiten (tangential, konzentrisch, gleich … auch an Bögen)
- **Stutzen und Verlängern**: Abhängigkeiten und Bemaßungen bleiben dabei erhalten; Stutzen auch an Langlöchern und gerundeten Konturen und durch Wischen mit gedrückter Maustaste
- **Abrunden, Fase und Versatz** als Klick-Werkzeuge mit Vorschau am Mauszeiger
- **Volumenkörper**: Extrusion, Rotation, Sweep, Loft, Rohr, Spirale, Rippe, Drücken/Ziehen, Bohrung (auch als Gewindebohrung), Gewinde, Verrundung, Fase, Formschräge, Wandung, Aufdicken, Prägen (eben oder auf Zylinder gewickelt), Kombinieren, Teilen, Skalieren
- **Muster**: rechteckig, kreisförmig und entlang eines Pfades; Spiegeln
- **Konstruktionsgeometrie**: Ebenen (versetzt, unter Winkel, durch 3 Punkte, tangential), Achsen und Punkte
- **Flächen**: Extrusion, Rotation, Loft, Pflaster, Versatz, Vernähen, Trennen, Verlängern, Füllen
- **Blech**: Laschen, Lasche an Lasche (U-Falz, Z-Stufe, 180°-Umschlag), offene oder geschlossene Ecken mit Eckfreistellung (rund oder eckig), Abwicklung mit Biegetabelle
- **Zeitachse** mit Zwischenspeicher: Änderungen berechnen nur die betroffenen Features neu, mit schrittweiser Berechnung und Fortschrittsanzeige

### Baugruppen
- Gelenke: starr, Dreh-, Schiebe-, Zylinder-, Kugel- und Ebenengelenk
- Gelenkursprünge, Grenzen, Kontaktstopp, gekoppelte Bewegungen, Bewegungsstudie
- Kollisionsprüfung zwischen Körpern

### Zeichnung
- Normalansichten, Isometrie, Schnitte (Vollschnitt, Halbschnitt, abgesetzter Schnitt; Vorder- und Seitenansicht) und mehrere Detailansichten mit eigenen Maßen; Mittellinien an Wellen, Zapfen und Bohrungen
- Eigene Maße (linear, Durchmesser, Radius, Winkel) mit Toleranz-/Passungszusatz, Hinweise mit Pfeil, Oberflächenzeichen, Form- und Lagetoleranzen mit Bezügen, Gewinde- und Fasenangaben, Positionsnummern, Stückliste, Schriftfeld
- Export als SVG, Drucken bzw. Speichern als PDF

### Rendern
- Studioumgebungen, Belichtung, Bodenschatten und Spiegelung
- Progressive Kantenglättung, Tiefenschärfe, PNG-Export
- Darstellungen per Drag-and-Drop auf Körper ziehen

### Fertigung (CAM)
- **Einrichtungen** mit Rohteil (Quader, Zylinder, Restmaterial aus der vorigen Aufspannung), Nullpunkt, Spannmitteln und 3+2-Schwenkung
- **2D-Fräsen**: Planen, Kontur und Tasche (beide auch nur für das Restmaterial eines größeren Fräsers), 2D-Adaptiv, Nut, Gravur, Fase/Entgraten, Bohren, Gewindefräsen, Zirkularfräsen, Antasten
- **3D-Fräsen**: Adaptiv-Schruppen, Parallel, Kontur (Z-Ebenen), Spirale, Radial, Morph, Geodätisch, Scallop, Planflächen, Restmaterial in Ecken und weitere
- **4-Achs-Simultan**: Rotation (Helix/Linien), 4-Achs-Schruppen, Abwickeln von Skizzen auf den Zylinder
- **Drehen**: Plandrehen, Schruppen/Schlichten (mit Schneidenradius-Kompensation), Einstechen, Gewinde, Abstechen, Bohren in der Drehachse, Innendrehen, Innen-Einstiche und Innengewinde; mit angetriebenem Werkzeug und C-Achse: Bohren (axial auf dem Lochkreis, radial als Querbohrung), Passfedernuten, Schlüsselflächen (Zweiflach, Vierkant, Sechskant) freie Skizzenkonturen auf der Planfläche oder abgewickelt auf dem Umfang und Taschen in der Planfläche
- **Werkzeugbibliothek** mit Schnittdaten-Rechner, Werkstoff-Sätzen, Standzeit und Halterdarstellung
- **Simulation** mit Materialabtrag (auch auf Zylinder-Rohteilen), Vergleich mit dem Fertigteil (Rest / zu tief), Bearbeitungszeit je Aufspannung
- **NC-Editor** mit Backplot, Suche und Bearbeiten; die **NC-Prüfung** erkennt Kollisionen von Halter, Schaft und Eilgang, Spannmittel- und Tischkontakt, Achsgrenzen und Syntaxfehler (Heidenhain)
- **Postprozessoren**: Heidenhain Klartext (inkl. APPR/DEP, Zyklen 2xx, Lochmuster 220/221), Fanuc, Sinumerik, Okuma (Fräsen/Drehen), LinuxCNC, GRBL und weitere. Eigene Postprozessoren lassen sich im integrierten Editor mit Live-Vorschau anpassen.
- **Steuerungszyklen** statt ausgerechneter Bahnen: Bohr- und Taschenzyklen, Zapfen, Lochkreise und -raster, Dreh-Schruppzyklus und Gewindezyklus

### Bedienung
- **Sprachen**: Deutsch, Englisch und Chinesisch (Voreinstellungen → Einheiten- und Wertanzeige → Sprache; beim ersten Start nach der Sprache des Browsers)
- **Updates**: Das Programm sieht beim Start auf GitHub nach einer neuen Version. Die installierte Windows-App und das Linux-AppImage laden und installieren sie auf Wunsch selbst; der Windows-Ordner ohne Installation, macOS und die Browser-Version zeigen einen Hinweis mit der Download-Seite. Diese Abfrage ist die einzige Verbindung ins Netz, die WerkFab von sich aus aufbaut, und sie lässt sich abschalten (Voreinstellungen → Allgemein → Updates).
- Markierungsmenü (Rechtsklick), ViewCube, Tastenkürzel (z. B. Q Drücken/Ziehen, F Verrundung, M Verschieben, I Messen, X Konstruktionslinie)
- Mehrere Dokumente in Tabs, Versionsstände beim Speichern; Import von STEP, IGES, STL, OBJ und DXF, Werkzeugbibliotheken und Postprozessoren (.cps)

---

## Starten

Alle Downloads stehen auf der Seite [Releases](../../releases).

| System | Datei | Starten |
|---|---|---|
| Windows | `WerkFab-<Version>-windows-x64-setup.exe` | Installer ausführen. Er installiert für den angemeldeten Benutzer, legt Startmenü- und Desktop-Eintrag an und bringt eine Deinstallation mit. |
| Windows, ohne Installation | `WerkFab-<Version>-windows-x64-portable.zip` | Entpacken und `WerkFab.exe` starten. |
| Linux | `WerkFab-<Version>-linux-x86_64.AppImage` | Ausführbar machen (`chmod +x WerkFab-*.AppImage`) und starten. Oder das `.tar.gz` entpacken und `werkfab` starten. |
| macOS (Apple Silicon) | `WerkFab-<Version>-macos-arm64.dmg` | Abbild öffnen und WerkFab in „Programme“ ziehen. |
| macOS (Intel) | `WerkFab-<Version>-macos-x64.dmg` | Ebenso. |
| Jedes System, im Browser | `WerkFab-<Version>-browser.zip` | Siehe unten. |

Die Apps sind nicht mit einem gekauften Zertifikat signiert. Windows SmartScreen warnt eventuell beim ersten Start („Weitere Informationen“ → „Trotzdem ausführen“). macOS verweigert den ersten Start per Doppelklick: Rechtsklick auf die App → „Öffnen“, oder unter Systemeinstellungen → Datenschutz & Sicherheit erlauben; meldet macOS, die App sei beschädigt, einmal `xattr -dr com.apple.quarantine /Applications/WerkFab.app` ausführen. Die Linux- und macOS-Pakete werden automatisch gebaut; bei jedem Release werden sie auf den Rechnern von GitHub einmal gestartet und geprüft, ob die Oberfläche erscheint – von Hand hat aber noch niemand damit gearbeitet.

### Browser-Version (offline-fähig)
Lade `WerkFab-<Version>-browser.zip` und entpacke es. Dann im Ordner einen lokalen Webserver starten, zum Beispiel:

```bash
python -m http.server 8765
```

und `http://localhost:8765` öffnen. Nach dem ersten Laden funktioniert die App auch ohne Netzwerk (Service Worker). Hinweise dazu stehen in `LIESMICH.txt` im Archiv.

### Aus dem Quellcode
Voraussetzungen: [Node.js](https://nodejs.org) 18 oder neuer. Für die Browser-Variante zusätzlich Python 3 (oder ein anderer statischer Webserver).

```bash
npm install
```

```bash
npm start
```

startet die Electron-App. Alternativ startet `start.bat` einen lokalen Webserver und öffnet WerkFab im Browser.

---

## Bauen

| Befehl | Ergebnis |
|---|---|
| `npm run build` bzw. `build-exe.bat` | Windows-App (Ordner) in `dist/WerkFab-win32-x64` |
| `npm run dist:win` / `dist:linux` / `dist:mac` | Installer bzw. App-Paket in `dist/installers` (Windows-Setup, Linux AppImage und tar.gz, macOS dmg – jeweils auf dem eigenen System) |
| `npm run build:web` bzw. `build-web.bat` | Browser-Version in `dist/WerkFab-Browser` (+ ZIP über die .bat) |
| `npm run build:kernel` | Rust-Kern nach WebAssembly (`vendor/werkfab-kernel`), benötigt Rust + `wasm32-unknown-unknown` |

## Tests

Alle Tests auf einmal:

```bash
npm test
```

| Befehl | Prüft |
|---|---|
| `npm run test:trim` | Skizze: Stutzen und Verlängern |
| `npm run test:sketch` | Skizzenwerkzeuge (Rechtecke, Kreise, Bögen) |
| `npm run test:solver` | Abhängigkeiten und Bemaßungen an Bögen |
| `npm run test:kernel` | Rust-Kern (WebAssembly) |
| `npm run test:cam` | Alle Frässtrategien an einem Prüfteil mit exakt bekannter Form: keine Verletzung von Teil und Aufmaß (Toleranz Schlichten 0,02 mm, Schruppen 0,04 mm); alle Postprozessoren (gültige Werte, Programmrahmen, zurückgelesene Positionen = Bahn); alle Drehoperationen und Dreh-Posts, Schneide gegen Kontur, Schrupp-/Schlichtzyklus G71/G70 und G85/G87; Lochmuster und Bohrreihenfolge |
| `npm run test:hh` | Heidenhain Klartext: ein Programm mit allen Zyklen, APPR/DEP, Schraubenlinien, Tastzyklus und geschwenkter Aufspannung in sechs Optionskombinationen, Satz für Satz gegen die Klartext-Regeln und den Zustand der Steuerung geprüft |
| `npm run test:iso` | G-Code für Fanuc/ISO, Okuma OSP-M, LinuxCNC, GRBL und Sinumerik: dasselbe Programm in fünf Optionskombinationen, Satz für Satz geprüft (Längenkorrektur, Spindel, Vorschub, Zyklen, Kreisbögen) |
| `npm run test:lathe` | Drehprogramme für Fanuc, Okuma und LinuxCNC: alle Operationen als Bahn und als Zyklen, Satz für Satz geprüft (Werkzeugwechsel abseits des Teils, Spindel, C-Achse, Zyklen mit Kontur) |
| `npm run test:drawing` | Zeichnung: eigene Maße, Winkelmaße, Hinweise und Maßzusätze im erzeugten SVG |

Die Tests laufen ohne Browser in Node.js und bei jedem Push automatisch auf GitHub.

### Neue Version veröffentlichen

1. Version in `package.json` setzen (z. B. `1.0.0`) und `CHANGELOG.md` ergänzen.
2. Committen, Tag setzen und hochladen:

```bash
git tag v1.0.0
```

```bash
git push origin main --tags
```

Der Workflow **Release** (`.github/workflows/release.yml`) testet, baut die Pakete für Windows, Linux und macOS sowie die Browser-Version und hängt sie an den GitHub-Release. Tags mit Bindestrich (z. B. `v1.0.0-rc.2`) werden als Vorabversion veröffentlicht. Bei jedem Push auf `main` laufen außerdem die Tests (`.github/workflows/ci.yml`).

---

## Aufbau

| Ordner | Inhalt |
|---|---|
| `js/` | Anwendung (ES-Module, ohne Bundler): Modell, Skizze, Solver, CAM, Simulation, Postprozessoren, Oberfläche |
| `css/`, `icons/` | Oberfläche und Symbole |
| `electron/` | Hülle für die Desktop-Apps (Windows, Linux, macOS) |
| `vendor/` | Mitgelieferte Bibliotheken (OpenCascade/replicad, three.js, Clipper, opentype.js …) |
| `rust/werkfab-kernel/` | Experimenteller eigener Geometriekern in Rust (truck), als WebAssembly eingebunden |
| `tools/` | Build- und Testskripte |

Standardmäßig rechnet WerkFab mit **OpenCascade** (über replicad/WebAssembly). Der Rust-Kern ist eine experimentelle Alternative, die über die Kern-Schnittstelle umgeschaltet werden kann.

---

## Sicherheit: NC-Programme immer vorher simulieren

WerkFab erzeugt Programme, die echte Maschinen bewegen. Ein falsches Programm kann Werkzeug, Spannmittel, Spindel und Maschine zerstören und Menschen verletzen.

- **Vor dem ersten Lauf jedes Programm prüfen:** an der Maschine im Probelauf (Einzelsatz, reduzierter Vorschub und Eilgang, erst in der Luft) **oder in einem externen NC-Simulator** bzw. der Grafiksimulation der Steuerung.
- Die Simulation und die NC-Prüfung in WerkFab rechnen mit den Bahnen, die WerkFab selbst erzeugt hat. Sie kennen die Steuerung, ihre Parameter und die Maschine nicht und ersetzen die Prüfung an der Maschine nicht.
- Die Postprozessoren sind gegen die Programmierregeln der Steuerungen getestet, **aber nicht an echten Maschinen gelaufen**. M-Codes, Werkzeugwechsel, Schwenken, Zyklen und C-Achse sind maschinenabhängig und müssen an die eigene Maschine angepasst werden.
- Nullpunkt, Werkzeuglängen, Spannmittel und Verfahrwege liegen in der Verantwortung des Bedieners.
- WerkFab wird ohne jede Gewährleistung bereitgestellt (GPL-3.0, Abschnitte 15 und 16). Die Nutzung erfolgt auf eigene Gefahr.
- **Haftung:** WerkFab wird unentgeltlich überlassen. Soweit gesetzlich zulässig, haftet der Autor nur für Vorsatz und grobe Fahrlässigkeit (wie bei einer Schenkung, §§ 521, 523, 524 BGB); jede weitergehende Haftung ist ausgeschlossen.

---

## Bekannte Grenzen

- Die Okuma-Syntax (Fräsen und Drehen, inkl. G85/G81-Zyklen) wurde nach allgemeinem Wissen umgesetzt und nicht an einer echten Steuerung geprüft.
- Kein simultanes 5-Achs-Fräsen. Unterstützt werden 3+2 (geschwenkte Aufspannungen) und 4-Achs-Simultan um die A-Achse.
- Angetriebene Werkzeuge an der Drehmaschine: Bohren, Nuten, Flächen und Skizzenkonturen auf Planfläche und Umfang; keine Y-Achse, Taschen nur auf der Planfläche. Polar- und Zylinder-Interpolation (G12.1, G7.1) nur im Fanuc-Postprozessor, sonst kurze X/C-Schritte bzw. Z/C ohne Interpolation. In der Simulation erscheinen Konturen als Bänder, nicht als Materialabtrag. Die M-Codes für C-Achse und Werkzeugspindel sind maschinenabhängig und müssen im Postprozessor geprüft werden. Die NC-Prüfung rechnet angetriebene Bearbeitungen nicht gegen das Rohteil.
- Keine Freiform-/T-Spline-Modellierung.
- Übersetzungen: Die Oberfläche ist auf Deutsch geschrieben. In den anderen Sprachen können einzelne zusammengesetzte Meldungen deutsch bleiben; Kommentare im NC-Programm sind immer deutsch.
- Große 3D-Strategien (Adaptiv 3D, Geodätisch) brauchen je nach Teil mehrere Sekunden Rechenzeit.

---

## Lizenz

WerkFab steht unter der **GNU General Public License v3.0 oder später**, siehe [LICENSE](LICENSE).

Mitgelieferte Bibliotheken stehen unter ihren eigenen Lizenzen, siehe [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md); die Lizenztexte liegen in [`licenses/`](licenses).

Namen von Steuerungen, Maschinen und anderer Software (Heidenhain, Fanuc, Sinumerik, Okuma, LinuxCNC, GRBL und andere) sind Marken ihrer Inhaber. Sie werden nur genannt, um zu sagen, wofür Ausgabe und Import von WerkFab gedacht sind; WerkFab steht mit keinem dieser Unternehmen in Verbindung.

---

## Unterstützen

WerkFab ist kostenlos und entsteht in der Freizeit. Wenn dir das Programm hilft, freue ich mich über einen Kaffee:

<a href="https://paypal.me/VitalijBleich"><img src="docs/media/kaffee-button.svg" alt="Spendier mir einen Kaffee (PayPal)" height="48"></a>
