# Änderungen

## v1.0.0-rc.11 – 2026-11-14

### Normteile
- **Gewinde**: Schrauben, Gewindestifte, Gewindestangen und Muttern tragen ihr Gewinde – wahlweise als Kennzeichnung (der Körper bleibt glatt, die Zeichnung zeigt das Gewinde), ausmodelliert (der Gewindegang wird wirklich geschnitten) oder als glatter Zylinder. Die Bohrung einer Mutter hat jetzt den Kerndurchmesser.
- **Sieben weitere Reihen** (zusammen 25): Zylinderschraube mit niedrigem Kopf (DIN 7984), Hutmutter (DIN 1587), Scheibe kleine Reihe (ISO 7092), Kegelstift (ISO 2339), Spannstift (ISO 8752), Passfeder Form B (DIN 6885), Wellendichtring (DIN 3760).
- Der Körper eines Normteils heißt wie das Teil („ISO 4762 M6×20“) – im Browser und in der Stückliste.
- Behoben: in Bohrungen von Blechteilen ließ sich kein Normteil einsetzen (siehe Blech).
- **Verschraubung in einem Zug**: zur Schraube kommen auf Wunsch Scheibe unter dem Kopf, Mutter auf der Gegenseite und Scheibe unter der Mutter – ein Klick auf die Bohrung setzt alles, ein Schritt im Verlauf. Die Klemmdicke ist die Länge der Bohrung, auch durch mehrere Teile, wenn ihre Bohrungen fluchten und aneinanderstoßen.
- **Größe und Länge als Vorschlag**: die Gewindegröße richtet sich auf Wunsch nach der Bohrung, die Länge nach der Klemmdicke – mit Mutter die kürzeste Vorzugslänge, bei der die Schraube zwei Gewindegänge übersteht. Ist die gewählte Schraube zu kurz, sagt es die Statuszeile.
- **Schraube auf eine Fläche – die Bohrung entsteht mit**: neue Position „Fläche anklicken“. An jedem Klickpunkt auf einer ebenen Fläche entsteht die Durchgangsbohrung für die Schraube (ISO 273, Reihe mittel; M3 … M24) durch alle Teile, die dort aufeinanderliegen, und die Schraube sitzt gleich darin – mit Scheiben und Mutter, wenn gewählt. Senkschrauben bekommen die 90°-Senkung, Zylinderschrauben auf Wunsch eine Senkbohrung (DIN 974-1, Reihe 1) so tief wie der Kopf. Ein Schritt im Verlauf; Bohrung und Schraube bleiben danach änderbar.
- **Gewindebohrung im untersten Teil**: ohne Mutter endet die Durchgangsbohrung auf Wunsch dort, wo das unterste Teil beginnt; dort entsteht das Kernloch mit Gewinde – drei Gewindegänge tiefer, als die Schraube reicht, oder durch das ganze Teil. Ein einzelnes Teil bekommt das Gewinde von der Fläche an. Die Statuszeile nennt die Einschraubtiefe und warnt, wenn sie kleiner ist als der Gewindedurchmesser.

### Blech
- **Runde Bohrungen, Langlöcher und runde Ecken sind echte Zylinderflächen** (vorher Vielecke): Bohrungen in Blechteilen werden als Bohrungen erkannt – für Normteile, Bohrbearbeitungen, Durchmessermaße und Mittellinien. Auch die Biegungen gerader Laschen sind echte Zylinder; ein Blechteil hat damit einen Bruchteil der Flächen (Platte mit vier Laschen: 48 statt 156).
- **Prägungen mit schräger Wand**: Wandschräge 0 … 60° je Prägung, für eckige und runde Konturen; das Blech behält seine Dicke.
- **Schneidprogramm**: Haltestege (Anzahl je Umriss und Breite – der Strahl setzt dort aus, der Fräser hebt auf halbe Blechdicke), Kiemenschlitze werden mitgeschnitten, Vorlagen für die Steuerung (allgemein M3/M5, GRBL-Laser, LinuxCNC QtPlasmaC, M7/M9 oder eigene Befehle für Ein und Aus).
- Geprüft: geschlossene Ecken bleiben geschlossen, wenn eine Lasche an einer Biegelinie geteilt wird.
- **Laschen an gebogenen Kanten sind echte Ringflächen**: die Biegung um eine runde Kante ist eine Fläche statt rund 30 Kegelstreifen – glatter in der Ansicht, kleiner im STEP, sauber wählbar.
- **Schneidprogramm – Vorschau**: vor dem Speichern zeigt ein Bild je Tafel die Bahn – Schnitte, Anschnitte mit Einstichpunkt, Eilgänge, Haltestege und die Reihenfolge der Konturen; dazu Schnittlänge, Zahl der Einstiche und Haltestege, Ersparnis und ungefähre Dauer.
- **Haltestege auch in Ausschnitten**: Ausschnitte ab einem wählbaren Umfang bekommen Stege, damit große Abfallstücke nicht kippen.
- **Gemeinsame Schnittkanten**: liegen zwei Zuschnitte genau eine Schnittfuge auseinander, wird die gemeinsame Kante nur einmal geschnitten (Laser: Strahl aus und Eilgang; Fräser: abheben und neu eintauchen).
- Der Anschnitt liegt nie in einem Nachbarteil: fehlt freier Abfall neben einer Kontur, wird auf der Kontur eingestochen.
- **Eckfreischnitte mit glatten Wänden**: der Freischnitt an einer Ecke zwischen zwei Laschen ist ein glatter Schnitt statt einer Treppe aus sechs Stufen – eckige Freischnitte mit ebenen Wänden und echten Bögen, runde mit glatten Freiformflächen. Das gilt auch für Ecken, die kein rechter Winkel sind (Dreieck, Parallelogramm, Vieleck).

### Netz
- **Netz → Körper: Kegel in einem Stück**: Kegel, Kegelstümpfe und Spitzen, wie sie ein CAD-Programm vernetzt (mehrere Ringe mit verschiedener Teilung, dazwischen ebene Streifen, eine Spitze), werden eine einzige Kegelfläche – ein Kegelstumpf kommt mit 3 statt 65 Flächen an, ein Kegel mit Spitze mit 2 statt 80. Sehr fein vernetzte runde Flächen hängen beim Erkennen jetzt zusammen.
- **Netz → Körper: Verrundungen um runde Kanten als echte Ringflächen**: Viertel- und Teilringe an Scheiben, Taschenböden und Platten mit runden Ecken werden erkannt (auch mit schräger Achse) und kommen als Torus in den Körper; der Rauminhalt stimmt bis auf die Vernetzung. Die Meldung nennt ihre Zahl.
- **Kugelkuppen rund hundertmal schneller**: Kuppen, Mulden und Kugelenden entstehen in Zehntelsekunden statt in 10 bis 20 Sekunden – erst vertreten wenige große Facetten die vielen kleinen, dann kommt die echte Fläche dazu.
- Behoben: Facettenreihen einer Verrundung wurden als viele kurze Zylinderstücke gelesen.
- **Ringflächen zur Achse hin sind echte Flächen**: der verrundete Rand einer Bohrung oder Senkung und die Hohlkehle am Fuß eines Zapfens kommen als Torus in den Körper (Viertelring, Ringradius mindestens das 1,6-Fache des Rundungsradius).
- **Volle Ringe**: ein O-Ring oder Torus als ganzes Netz wird erkannt – auch schräg im Raum – und als exakter Ring ausgegeben.
- **Verrundungen um runde Kanten 5- bis 50-mal schneller**: eine scharfe Ecke vertritt die Verrundung, bis die echte Fläche geschnitten ist – eine Scheibe mit verrundeter Kante braucht unter einer Sekunde statt 12, ein Zapfen mit Hohlkehle rund 2 statt 85 Sekunden.
- **Halbrunde Kanten und Teilringe**: auch Ringflächen, die kein Viertelkreis sind (halbrunder Rand einer Scheibe, rundum verrundete Platte mit runden Ecken), gehen den schnellen Weg – ein halbrunder Rand in unter einer Sekunde, eine rundum verrundete Platte mit 8 Ring- und 12 Zylinderflächen.
- Behoben: bei fein vernetzten Ringen wurden Streifen quer über den Ring als kurze Zylinderstücke gelesen – der Ring blieb unerkannt und die Umwandlung dauerte sehr lange. Ein Ring, an den ein Kegel anschließt, wird jetzt erkannt.
- **Sicherheitsnetz**: der geschriebene STEP-Körper wird zurückgelesen und mit dem Netz verglichen; stimmt der Rauminhalt nicht, wird ohne Ringflächen oder zuletzt mit den Facetten ausgegeben – nie ein kaputter Körper.
- Behoben: der Rauminhalt mancher Ringflächen wurde falsch geschätzt (die Fläche blieb dann facettiert); gerade Verrundungen, die in eine Eckverrundung übergehen, konnten den Körper zerstören.

## v1.0.0-rc.10 – 2026-11-14

### Normteile
- **Normteil einfügen**: statt einer einzelnen Schraube ein Katalog mit 18 Reihen – Zylinder-, Sechskant-, Senk- und Linsenkopfschrauben, Gewindestifte und Gewindestangen (ISO 4762, 4017, 10642, 7380, 4026, DIN 976), Muttern (ISO 4032, 4035, 10511), Scheiben und Federringe (ISO 7089, 7093, DIN 127), Zylinderstifte und Passfedern (ISO 2338, DIN 6885), Sicherungsringe für Wellen und Bohrungen (DIN 471, 472), Rillenkugellager (DIN 625) und O-Ringe (ISO 3601). Größe und Länge aus der Normreihe; das Teil kommt als eigener Körper mit der Normbezeichnung als Namen („ISO 4762 M6×20“) in die Stückliste.
- Einsetzen am Ursprung oder durch Anklicken von Bohrungen – mehrere nacheinander; Schrauben sitzen in der Bohrung, Muttern und Scheiben darauf, Stifte und Lager mittig darin.
- Gewinde sind als glatte Zylinder dargestellt; die Maße sind Richtmaße der Norm ohne Toleranzen.

### Blech
- **Schachtelplan als Schneidprogramm**: neben Skizze, Körper und DXF gibt „Schachteln“ je Tafel ein NC-Programm aus – für Laser, Plasma, Wasserstrahl oder Fräse. Die Bahn läuft um die halbe Schnittfuge (beim Fräsen den halben Fräser) neben dem Umriss im Abfall, Ausschnitte kommen vor dem Umriss ihres Teils, das nächstliegende Teil folgt, jede Kontur beginnt mit einem Anschnitt aus dem Abfall. Beim Fräsen in mehreren Zustellungen bis unter das Blech. Die Meldung nennt Schnittlänge, Einstiche und die ungefähre Zeit. Das Programm ist vor dem Einsatz an der Maschine oder in einem NC-Simulator zu prüfen.
- **Laschen an Biegelinien**: läuft eine Lasche über eine Biegelinie hinweg, wird sie dort von selbst geteilt und freigestellt – im gebogenen Teil, in der Abwicklung und im DXF.
- **Kiemen**: eine Linie in der Platte wird zum Lüftungsschlitz mit hochgezogener Haube (Tiefe und Höhe, nach oben oder unten, Öffnung links oder rechts der Linie). Der Schlitz liegt in der Abwicklung und zählt zur Schnittlänge.
- **Prägungen**: ein geschlossenes Profil in der Platte wird um eine Höhe hoch- oder tiefgestellt statt ausgeschnitten; das Blech behält seine Dicke.
- **Senkprägungen**: der Rand einer runden Bohrung wird kegelig eingezogen, damit ein Senkkopf bündig sitzt.
- Neue Hinweise: Prägung zu hoch oder zu schmal für die Blechdicke, Senkprägung zu tief, Kieme zu nah am Rand.
- **Biegung an einer Skizzenlinie**: eine gerade Linie der Skizze (auch eine Hilfslinie) quer durch die Platte wird zur Biegelinie. Die Skizze ist dort der Zuschnitt, die Linie die Mitte der Biegezone; das größte Stück bleibt liegen, alles jenseits der Linie schwenkt mit seinen Laschen, Ausschnitten und Formelementen mit. Mehrere Linien ergeben U-, Z- und Stufenprofile. Die Biegungen stehen als L1, L2 … in der Biegetabelle und in der Abwicklung.
- **Sicken**: eine Linie in der Platte wird zur Versteifungsrippe – Breite und Höhe, nach oben oder unten, im Querschnitt und an den Enden rund; das Blech behält seine Dicke.
- **Durchzüge**: der Rand einer runden Bohrung wird zu einem Kragen hochgezogen (etwa für ein Gewinde). Der Durchmesser der Skizze ist der fertige Innendurchmesser, im Zuschnitt liegt die kleinere Vorbohrung; die Aufweitung wird gemeldet.
- Sicken und Durchzüge erscheinen als dünner Umriss in der Abwicklung und im DXF auf der Ebene UMFORMUNG. Neue Hinweise: Lasche kreuzt eine Biegelinie, Ausschnitt neben der Biegelinie, Sicke oder Durchzug zu nah am Rand.
- **Gehrung zwischen gebogener und gerader Kante**: mit „Ecke: Geschlossen“ läuft auch eine Lasche an einer gebogenen Kante an einer echten Ecke bis zur Gehrung – im gebogenen Teil und in der Abwicklung (dort ohne Eckfreistellung).
- **Laschenmaß**: die Laschenlänge gilt wahlweise für den geraden Teil (wie bisher), als Außenmaß ab Außenfläche der Platte oder als Innenmaß. Der gerade Teil wird aus Biegeradius, Blechdicke und Winkel zurückgerechnet.
- **Presskraft in der Biegetabelle**: Richtwert je Biegung für freies Biegen (Gesenkweite nach Blechdicke, Zugfestigkeit nach Werkstoff), dazu der kürzeste Schenkel für dieses Gesenk und die größte Biegung.
- **Ineinander schachteln**: die Zuschnitte werden in die Lücken und Buchten ihrer Nachbarn und in deren Ausschnitte gelegt (bis zu vier Lagen, ohne 90°-Drehen um 180° gewendet). Der Abstand wird nie unterschritten. Liegt der Plan in Reihen nicht schlechter, bleibt es bei den Reihen; der Haken „Ineinander schachteln“ im Dialog schaltet es ab.
- **Laschen laufen um runde Ecken**: geht eine gebogene Kante ohne Knick in ihre Nachbarkante über und haben beide eine Lasche mit gleichem Biegewinkel, entfällt der Freischnitt – Wannen mit runden Ecken und Langloch-Formen bekommen eine durchgehende Wand, der Zuschnitt ist ein Stück.
- **Ausschnitte in Laschen an gebogenen Kanten**: Bohrungen, Fenster und Konturen aus einer Skizze werden auch im runden Rand geschnitten und erscheinen in der Abwicklung (Lage entlang des Bogens).
- **Laschen an gebogenen Kanten**: Bögen und Kreise in der Grundskizze werden als eine Kante angeboten („Kante 3 (Bogen R40, 62,8 mm)“, „Kante 1 (Kreis R30)“). Die Lasche läuft als echte Drehfläche um den Bogen – nach außen wie nach innen gewölbt, auch rundum (Deckel, Napf). Die Abwicklung zeigt den Ring mit gebogener Biegelinie, die Biegetabelle die Bogenlänge.
- **Prüfung für gebogene Laschen**: meldet, um wie viel Prozent der Rand beim Umformen gestaucht (Faltengefahr) oder gestreckt (Rissgefahr) wird – ab 15 % als Warnung.
- **Schachteln**: die Zuschnitte aller Blechteile (mit Stückzahl) werden auf Tafeln verteilt – Abstand, Drehen um 90°, mehrere Tafeln, Ausnutzung in Prozent. Ergebnis als Skizze, als flache Körper in Blechdicke (in der Fertigung mit 2D-Kontur ausschneiden) oder als DXF (Tafelrand auf Ebene TAFEL).
- **Freie Konturen in Laschen**: „Kontur aus Skizze“ schneidet die geschlossenen Profile einer Skizze aus einer Lasche (X entlang der Kante, Y in die Lasche hinein, Nullpunkt verschiebbar) – im gebogenen Teil, in der Abwicklung, in Zeichnung und DXF; die Prüfungen (Abstand zur Biegung, Überstand) gelten auch dafür.
- **Ausschnitte**: weitere geschlossene Profile in der Blech-Skizze (Fenster, Löcher) werden aus der Platte geschnitten – im gebogenen Teil, in der Abwicklung, im DXF und in der Skizze der Abwicklung. Die größte Kontur ist die Platte.
- **Bohrungen und Fenster in Laschen**: je Lasche (auch in Laschen an Laschen) mit Lage entlang der Kante, Abstand von der Biegung und Größe – sie sitzen im gebogenen Teil an der richtigen Stelle und wandern in die Abwicklung, das DXF und die Zeichnung. Hinweis, wenn sie zu nah an der Biegung liegen oder über die Lasche hinausragen.
- **Teillaschen**: je Lasche „Abstand Anfang / Ende“ – die Lasche sitzt nur auf einem Stück der Kante. Eine Ecke neben einer Teillasche bleibt offen.
- **Blechregeln**: Vorgaben für Stahl, Edelstahl und Aluminium setzen Dicke, Biegeradius und K-Faktor gemeinsam.
- **Prüfung beim Konstruieren**: Hinweise bei zu kleinem Biegeradius, zu kurzer Lasche, Ausschnitt zu nah an der Biegung, ungewöhnlichem K-Faktor und wenn sich die Abwicklung überlappt.
- Abwicklung zeigt zusätzlich Fläche, Schnittlänge (für Laser/Wasserstrahl), Zahl der Ausschnitte und Masse.
- **Abwicklung in der Zeichnung**: eigene verschiebbare Ansicht mit Umriss, Biegelinien (B1 …), Gesamtmaßen, Biegetabelle (in allen Sprachen) und der Lage jeder Biegelinie als Koordinatenmaß von der linken unteren Ecke des Zuschnitts.
- DXF der Abwicklung: Biegelinien liegen auf der Ebene BIEGUNG, der Umriss auf Ebene 0.
- Reiter BLECH: Abwicklung, DXF, Als Skizze und Zeichnung direkt in der Werkzeugleiste.

### Netz
- **Netz → Körper erkennt Kegel aus CAD-Exporten**: Fasen, Senkungen und Kegelstümpfe, die ein CAD-Programm zwischen zwei Eckenringen frei in Dreiecke teilt (ohne gleich breite Streifen), werden echte Kegelflächen – auch mit Zwischenringen und als Teil eines Rings. Eine gefaste Platte mit runden Ecken kommt mit 26 statt 206 Flächen an; eine Senkung wird nicht mehr für eine Kugel gehalten.
- **Netz → Körper aufgeräumt und schneller**: jede ebene Fläche des Netzes kommt als eine Fläche in den Körper statt als viele Dreiecke, runde Flächen werden zuerst in einem schnellen Durchgang eingesetzt. Typische Teile sind 2,5- bis 6-mal schneller umgewandelt.
- **Netz → Körper erkennt Kegelsegmente**: die Fase um eine runde Ecke (ein Viertelkegel) und andere Teile eines Kegelrings werden echte Kegelflächen, auch mehrere in einem Zug um das Teil.
- **Netz → Körper erkennt Kugelausschnitte**: eine flache Kuppe auf einer dünnen Platte oder eine Kugelkalotte, bei der die ganze Kugel nicht ins Teil passt, wird eine echte Kugelfläche. Die Kugel wird durch die echten Eckpunkte der Facetten gelegt, nicht durch Schnittpunkte.
- **Netz → Körper erkennt Kegel und Kugeln**: Senkungen, Kegelspitzen, Kegelstümpfe und kegelige Bohrungen werden echte Kegelflächen, Kugeln, Kugelkuppen und kugelige Mulden echte Kugelflächen. Die Meldung nennt die Anzahl.
- **Nadeldreiecke werden vor dem Umwandeln geschlossen**: hauchdünne Dreiecke aus dem Verrechnen von Netzen ließen bisher Lücken, an denen das Erkennen runder Flächen still scheiterte.
- **Netz → Körper erkennt auch Verrundungen, Hohlkehlen und Teilzylinder**: Facettenbögen um eine Achse (ab drei gleichmäßigen Streifen) werden echte Zylinderflächen – nach außen wie nach innen gewölbt.
- **Boolesch für große Netze**: gerechnet wird nur dort, wo sich die beiden Netze begegnen können; der Rest wird vorher abgetrennt und danach wieder angesetzt. Ein Netz mit 130 000 Dreiecken und ein kleiner Eingriff brauchen etwa eine Sekunde (vorher abgelehnt). Nähte mit fast zusammenfallenden Punkten werden zuverlässiger geschlossen.
- Ebenenschnitt mit Deckel: ein Umriss in einem anderen bleibt ein Loch (ein geschnittenes Rohr bekommt einen Ring statt einer Scheibe).
- **Netz → Körper**: ein geschlossenes Netz wird ein Volumenkörper (Flächen in einer Ebene werden zusammengefasst) – danach sind Verrundung, Ausschneiden und 2D-Bearbeitung möglich.
- **Runde Bohrungen und Zapfen werden echte Zylinder**: „Netz → Körper“ erkennt Facettenringe um eine Achse und ersetzt sie durch Zylinderflächen (Bohrungserkennung, Durchmessermaße und Mittellinien funktionieren danach). Der Durchmesser weicht dabei um 0,2 µm vom Netz ab.
- **Boolesch für Netze**: zwei geschlossene Netze wirklich vereinigen, voneinander abziehen oder die Schnittmenge bilden; die Schnittkanten werden neu vernetzt, das Ergebnis bleibt geschlossen.
- Spiegeln mit Original entfernt die Trennwand auf der Spiegelebene.
- **Körper → Netz**: ein Volumenkörper wird als Dreiecksnetz übernommen.
- **Schnitt als Skizze**: die Schnittkontur eines Netzes mit einer Ebene wird eine Skizze (auch direkt aus dem Ebenenschnitt).
- Neue Netz-Befehle: **Spiegeln** (auf Wunsch mit Original – zwei Hälften werden ein geschlossenes Teil), **Vereinen** (zwei Netzkörper zu einem), **Verfeinern** (Kanten über einer Länge teilen, Form bleibt gleich).
- **3MF und PLY einfügen**, **OBJ und 3MF speichern** (neben STL).

### Sprachen
- **Arabisch und Hebräisch** mit gespiegelter Oberfläche (von rechts nach links); Zahlen, Einheiten, NC-Code und Eingabefelder bleiben von links nach rechts. Zusammen 28 Sprachen. Maschinell übersetzt, noch nicht von Muttersprachlern geprüft.
- Gespiegelte Oberfläche nachgebessert: NC-Code in der Vorschau des Postprozessor-Editors läuft von links nach rechts, das Kontextmenü öffnet zur Leserichtung, gekürzte Namen im Browser zeigen ihren Anfang. Schnittdaten in der Werkzeugbibliothek zeigen Zahl vor Einheit; die Beschriftung „Format ({text})“ im Postprozessor-Editor ist übersetzt.
- Meldungen mit vorangestelltem ⚠ (Fehler einer Operation, Hinweise des Postprozessors) werden jetzt in allen Sprachen übersetzt.

- **Lücke in allen Sprachen geschlossen**: rund 50 Wörter, die auf Deutsch und Englisch gleich lauten (Name, Operation, Material, Position, Standard, Browser …), waren nie übersetzt und sind es jetzt in allen 26 Fremdsprachen; die Ausrichtung des Setups im Browser („Oben“) wird ebenfalls übersetzt.
- **Gespiegelte Oberfläche durchgesehen** (Konstruktion, Fertigung, Eigenschaften, Einstellungen, Werkzeugbibliothek, Simulation, Zeichnung): Werte mit Einheiten bleiben lesbar („30 mm“), Eingabefelder richten sich nach ihrem Inhalt.

### Fertigung (Drehen)
- **Tasche Mantelfläche (C-Achse)**: geschlossene Konturen einer Skizze, die längs zur Drehachse liegt, werden auf den Umfang gewickelt und von innen nach außen geräumt (Zylinder-Interpolation), Inseln bleiben stehen. Der Fräser taucht auf einer Rampe entlang des innersten Rings ein (Rampenwinkel einstellbar, Vorgabe 3°) oder wahlweise gerade.
- **Simulation trägt angetriebene radiale Schnitte wirklich ab**: Tasche und Kontur auf der Mantelfläche, Passfedernuten und Querbohrungen erscheinen mit ihrer Tiefe im Rohteil (vorher nur als dunkle Fläche auf der Oberfläche); auch die Rampe ist zu sehen. Dasselbe gilt für Kontur und Tasche auf der Planfläche und für axiale Bohrungen: der Bereich über dem tiefsten dieser Schnitte wird von der Stirnseite her als Höhenfeld gezeichnet. Schlüsselflächen bleiben Schnittebenen.
- **„Vergleich“ auch beim Drehen**: das simulierte Teil wird mit dem Modell verglichen – grün = auf Maß, blau = Restmaterial, rot = zu tief, mit Anteilen und größter Abweichung. Außengewinde, die nur die Gewindeoperation kennt, zählen nicht als „zu tief“. Die Bohrung (innen) wird nicht verglichen.
- **Y-Achse statt Polar-Interpolation** (Postprozessor-Einstellung): Schlüsselflächen, Konturen und Taschen auf der Planfläche fahren mit feststehendem Teil in X und Y; was über den Y-Verfahrweg hinausgeht, bleibt bei der Polar-Interpolation. Neue Vorlagen „Y-Achse ein/aus“ (dort die C-Klemmung der Maschine eintragen) – für Fanuc und LinuxCNC (G17 / G18) und Okuma (G138 / G136). Die Codes sind nicht an Maschinen erprobt: vor dem ersten Lauf mit dem Maschinenhandbuch vergleichen.

### Zeichnung
- **Toleranzzusätze im Toleranzrahmen**: (M), (L), (P), (F), (E) hinter Wert oder Bezug werden als Buchstabe im Kreis gezeichnet, z. B. Ø0,05(M) A(M).

### Dokumentation
- Bilder und Demo-Animation der README mit dem neuen Aussehen neu aufgenommen.

## v1.0.0-rc.9 – 2026-11-13

### Aussehen
- **Neue Seite „Aussehen“ in den Einstellungen** mit allem, was die Oberfläche anpasst:
  - **Zehn Designs** zur Auswahl: Standard (hell/dunkel), Graphit, Mitternacht, Wald, Glut, Papier, Schiefer, Minze sowie hoher Kontrast in dunkel und hell.
  - **Akzentfarbe** als Farbfelder (acht Farben) oder als frei gewählte eigene Farbe.
  - **Symbole in der Akzentfarbe** (kräftiger als bisher), wahlweise neutral grau oder in einer eigenen Farbe; Größe klein, normal, groß.
  - **Dichte** (kompakt, normal, luftig), **Ecken** (eckig, leicht gerundet, rund), **Schrift** (acht Systemschriften), **Deckkraft der Fenster** (60–100 %, mit Weichzeichner dahinter).
  - **Farbsehschwäche**: Statusfarben ohne Rot gegen Grün.
  - **Eigenes Design**: fünf Farben frei wählen (Hintergrund, Fenster, Schrift, Linien, Titelleiste), alles Übrige wird daraus gemischt; Design samt Farben, Symbolen, Form und Schrift **als Datei speichern und laden**.
- **Schrift auf der Akzentfarbe** passt sich an: dunkel auf heller, weiß auf dunkler Akzentfarbe (behebt schlecht lesbare „OK“-Knöpfe im dunklen Farbschema). Alle Designs sind auf Kontrast durchgesehen.
- **Ansicht nach der Skizze**: alles einpassen, zurück zur Ansicht vor der Skizze oder Ansicht behalten.
- **Kantenglättung** ein/aus und **Bodenschatten** unter dem Modell (Einstellungen → Grafik); **Koordinaten am Mauszeiger** in der Skizze.
- **Neues Programmsymbol in 3D**: das W als gefrästes Werkstück mit Schaftfräser am Ende der Bahn (Quelle `icons/icon.svg`, erzeugt mit `tools/make-icon.cjs`).
- **Symbole der Werkzeugleiste mit Licht und Schatten**: Körper sind wie das Programmsymbol von oben links beleuchtet und in der Akzentfarbe gehalten.
- **Akzentfarbe wählbar** (Blau, Türkis, Grün, Orange, Violett, Rot) – Auswahl, Schaltflächen und Symbole folgen ihr.
- **Größe der Oberfläche** von 80 % bis 150 %.
- **Profile**: alle Einstellungen unter einem Namen speichern und wieder anwenden (z. B. Laptop, großer Bildschirm, Vorführung).
- **Skizze: Fang aussetzen**, solange Alt (oder Strg) gedrückt ist.
- **Dreizehn weitere Sprachen**: Tschechisch, Dänisch, Finnisch, Norwegisch, Ukrainisch, Kroatisch, Bosnisch, Serbisch, Georgisch, Lettisch, Malaiisch, Galicisch und britisches Englisch, dazu wieder Russisch – zusammen 26. Maschinell übersetzt, noch nicht von Muttersprachlern geprüft. Das englische Wörterbuch ist jetzt durchgehend amerikanisch geschrieben, „English (UK)“ britisch.

### Sprachen und Steuerung
- **Neun weitere Sprachen**: Französisch, Spanisch, Italienisch, Portugiesisch (Brasilien), Niederländisch, Polnisch, Türkisch, Japanisch und Koreanisch. Maschinell übersetzt und noch von keinem Muttersprachler geprüft; was einer Sprache fehlt, erscheint auf Englisch. Die Sprachwahl hat den Eintrag „System“ (Sprache des Browsers oder Betriebssystems).
- **Ansicht über die Tastatur**: Strg+1 … 6 für die Ansichten von vorne, hinten, links, rechts, oben, unten, Strg+7 isometrisch, Strg+8 senkrecht auf die gewählte Skizze oder Ebene; Pfeiltasten drehen um 15° (mit Umschalt um 90°), Strg + Pfeiltasten verschieben, Bild↑ / Bild↓ und + / − zoomen.
- **Weitere Tasten**: Strg+O öffnen, Strg+Umschalt+S speichern unter, F2 benennt die Auswahl um. In der Skizze: O Versatz, P Projizieren (Polygon jetzt G, Langloch U).
- **Navigation**: Drehen um die Mitte der Ansicht, den Ursprung oder den Punkt unter dem Mauszeiger; Doppelklick mit der mittleren Taste passt ein oder geht zur Ausgangsansicht; Zoomgeschwindigkeit, Verschieben umkehren, Ansichtswechsel ohne oder mit schnellerer Animation.
- **Touchpad**: eigene Belegung (Umschalt + bewegen verschiebt, Alt + bewegen dreht, ohne Maustaste) und „Scrollen mit zwei Fingern verschiebt“.
- **Skizze endet erst beim zweiten Esc** (abschaltbar unter Einstellungen → Konstruktion): Ein Esc zu viel schließt die Skizze nicht mehr.
- Behoben: Beim Umschalten auf den eingeschränkten Orbit aus einer Ansicht genau von oben oder unten verschwand das Modell.

### Hinweise bei Schritten ohne Wirkung
- **Muster und Spiegelungen**: Hinweis, wenn Kopien eines Schnitts keinen Körper treffen oder Kopien einer Verbindung den Körper nicht berühren.
- **Verbindung ohne Berührung**: Hinweis, wenn eine Extrusion (oder ein anderes Feature) mit „Verbinden“ den Körper nicht berührt und ein loses Stück hinterlässt.
- **Außengewinde im vollen Material**: Warnung an der Gewindefräs-Operation, wenn um den Zapfen noch Rohmaterial steht, mit dem Knopf „Kontur zum Freifräsen davor anlegen“. Der Gewindefräser taucht jetzt 1 mm neben dem Nenndurchmesser ein statt einen Fräserdurchmesser entfernt.
- **Zeichnung**: Außengewinde bekommen den Gewindeabschluss als breite Linie; in Schnittansichten entfallen weggeschnittene Bolzen, und aufgeschnittene Gewindebohrungen, die die Draufsicht nicht benennt, tragen ihre Gewindebezeichnung.

### Konstruktion
- **Hinweis bei Bohrungen, die seitlich aus dem Körper ragen**, und bei Schnitten (Extrusion, Rotation …), die keinen Körper treffen. Bohrungen, die eine vorhandene Bohrung aufweiten, gelten nicht als „außerhalb“.
- **Zeichnung: Gewinde im Schnitt** – aufgeschnittene Gewindebohrungen mit dünnen Volllinien am Nenndurchmesser und breitem Gewindeabschluss; Mittelkreuze in der Draufsicht auch für Bohrungen ohne eigenen Kreis.
- **Warnung bei Bohrungen außerhalb des Körpers**: Liegen Bohrungen (auch einzelne eines Bohrbilds) neben dem Körper, zeigt die Bohrung einen gelben Hinweis in der Zeitachse und in den Eigenschaften.
- **Flächenauswahl für alle Verrundungen und Fasen**: auch bei veränderlichem Radius (mit Stützpunkten, durchlaufend ringsum) und bei Fasen mit zwei Abständen oder Winkel – dort wird der erste Abstand auf der gewählten Fläche gemessen.
- **Bohrbild in der Bohrung**: Raster oder Lochkreis direkt im Bohrungs-Werkzeug; Gewinde und Bohrungserkennung kennen die zusätzlichen Bohrungen.
- **Verrundung und Fase über Flächen**: Eine gewählte Fläche steht für alle Kanten ringsum.
- **Fase mit zwei Abständen oder mit Abstand und Winkel**, mit „Seiten tauschen“; tangential anschließende Kanten laufen mit.
- **Ausrichten nach Kanten**: gerade Kanten kommen deckungsgleich aufeinander, Kreiskanten (Bohrung und Zapfen) werden mittig zueinander gelegt.
- **Rechteck-Muster entlang Konstruktionsachsen**: Musterrichtungen dürfen schräg im Raum liegen.

### Oberfläche und Dokumentation
- Fenster- und Feldüberschriften in Großbuchstaben erscheinen jetzt auch auf Englisch und Chinesisch übersetzt.
- README mit den Neuerungen seit RC7 und zwei neuen Bildern (Bohrungen erkennen, Bild nachzeichnen); alle Bilder neu aufgenommen.

### Fertigung
- **Gewindefräsen in mehreren Zustellungen**: Die Gewindetiefe wird in Schritten gefräst, die jeweils etwa gleich viel abnehmen; auf Wunsch mit Leerdurchgang am Ende.
- **Restmaterial-Schlichten („Ecke“) fährt Wände nur so hoch ab, wie dort Material steht** – im Test 13 statt 16 Minuten.
- **Einrichteblatt in der Sprache der Oberfläche** (Deutsch, Englisch, Chinesisch) samt Datum; die CSV-Werkzeugliste nutzt außerhalb des Deutschen Komma und Dezimalpunkt.
- **Behoben: Außengewinde an Zapfen** wurde nur bis zum Nenndurchmesser gefräst (es entstand kein Gewinde); der Fräser geht jetzt bis zum Kerndurchmesser.
- **Simulationsvergleich kennt Gewinde**: Gewindefräsen in Bohrungen und an Zapfen gilt nicht mehr als „zu tief“.
- **Werkzeugliste als CSV** im Einrichteblatt (Semikolon und Dezimalkomma, mit Einsatzzeit und Operationen je Werkzeug).
- **Einrichteblatt** zeigt manuelle NC-Sätze (Programmhalte hervorgehoben und gezählt), Bahnmuster, Eckenfreistiche, Zustellungen und Notizen in einer Spalte „Hinweis“.

## v1.0.0-rc.8 – 2026-11-11

### Fertigung
- **Wirbelfräsen (trochoidal)** für Nuten: Das Werkzeug fräst in Kreisen, deren Mitte entlang der Nut wandert, und ist nie über die volle Breite im Eingriff. Für Langlöcher und – mit Angabe der Nutbreite – für offene Linien.
- **Tauchschruppen**: senkrechte Tauchgänge Reihe für Reihe bis auf das Modell plus Aufmaß, mit kurzem Abheben von der Wand vor dem Rückzug. Für lange Werkzeuge und tiefe Kavitäten.
- **Bohrungen erkennen**: findet alle Bohrungen entlang der Werkzeugachse, gruppiert sie nach Durchmesser und Art (Durchgang, Sackloch, Senkung, Gewinde) und legt Anbohren, Bohren, Gewindebohren und Senkungen in einem Zug an. Fehlende Werkzeuge werden mit Schnittdaten angelegt.
- **Manuelle NC**: Kommentar, Programmhalt (M0), wahlweiser Halt (M1), Verweilzeit, Meldung für den Bediener oder eigener NC-Code zwischen den Operationen. Nach einem Programmhalt schaltet die nächste Operation Spindel und Kühlmittel wieder ein.
- **Bahnmuster**: Die fertige Bahn einer Operation wird linear (Reihen und Spalten), kreisförmig oder gespiegelt wiederholt. Bohrzyklen und Bohrbilder bleiben erhalten; im Spiegelbild wechselt die Radiuskorrektur die Seite.
- **Torusfräser mit echter Form**: Die 3D-Strategien rechnen den Eckenradius mit (bisher wie ein Schaftfräser, also unnötig weit weg von Schrägen und Rundungen). Simulation, Kollisionsprüfung und der kürzeste sichere Weg kennen die Form ebenfalls; das Aufmaß wirkt senkrecht zur Fläche.
- **Tauchschruppen kennt die vorigen Operationen**: Wo schon gefräst ist, wird nicht mehr getaucht, und jeder Tauchgang beginnt erst am verbliebenen Material (abschaltbar).
- **Gewindefräsen aus der Bohrungserkennung**: Für Gewindebohrungen lässt sich statt Gewindebohren auch Gewindefräsen wählen.
- **Eckenfreistich (Dogbone / T-Bone)** an 2D-Tasche und 2D-Kontur: An jeder scharfen Innenecke fährt der Fräser kurz in die Ecke und zurück, damit ein eckiges Gegenstück hineinpasst.
- **Restmaterial gegen ein Referenzwerkzeug aus der Liste** (Strategie „Ecke“): Es zählt die Form des vorigen Werkzeugs, zum Beispiel was ein Torusfräser in den Hohlkehlen stehen lässt.
- **Außengewinde fräsen aus der Bohrungserkennung**: Zapfen mit Gewinde werden erkannt und bekommen eine Operation „Gewindefräsen außen“.
- **Wirbelfräsen als Kreisbögen im NC-Programm**: Die Kreise sind jetzt fein genug, dass der Postprozessor Bögen ausgibt (im Test 724 statt 5168 Sätze).
- **Bohrungen anfasen** aus der Bohrungserkennung: eine Fase um die Mündung jeder Bohrung, mit dem Fasenfräser.
- **Werkzeugwechsel sparen**: ordnet die Operationen eines Setups so, dass gleiche Werkzeuge zusammenrücken – ohne Operationen zu überholen, die an derselben Stelle arbeiten; manuelle NC und Antasten bleiben, wo sie sind.
- **Vorschubanpassung in Ecken**: langsamerer Vorschub vor und nach scharfen Richtungswechseln (Winkel, Strecke und Prozentwert einstellbar).

### Skizze
- **Bild nachzeichnen**: Aus einem Bild (PNG, JPG, WebP, GIF, BMP, SVG) werden Kurven – wahlweise Konturen außen und innen, nur Außenkonturen, nur Innenkonturen oder die Mittellinie der Striche. Mit Vorschau, Schwellwert, Invertieren, Genauigkeit und Glätten. Das Ergebnis kommt in die offene Skizze (oder als neue Skizze) und lässt sich als SVG oder DXF speichern; das Bild kann als Vorlage dahinterliegen.
- **Nachzeichnen erkennt Formen**: gerade Kanten, scharfe Ecken, Rundungen und Kreise werden als Geraden, Drei-Punkt-Bögen und Kreise eingefügt statt als viele kurze Linien (umschaltbar auf Linienzüge). Beim Glätten bleiben Ecken scharf.
- **Nachzeichnen nach Farben** (einzelne Randpixel zwischen zwei Farben werden bereinigt): Ein Farbbild wird in 2 bis 8 Farben zerlegt; jede angehakte Farbe wird für sich nachgezeichnet und in der SVG-Datei in ihrer Farbe gespeichert.
- **Bild als Vorlage auf der Skizzenebene** und **Vorlage kalibrieren**: zwei Punkte im Bild anklicken, wirklichen Abstand eingeben – das Bild bekommt den richtigen Maßstab.
- **SVG und DXF in die offene Skizze einfügen** (eigene Gruppe EINFÜGEN in der Skizzenleiste).
- **Projizieren erweitert**: einzelne Kanten (Kreise bleiben Kreise, Kreisbögen werden Bögen), der Umriss eines ganzen Körpers und die Schnittkurven der Skizzenebene mit einem Körper. Projizierte Geometrie ist violett.
- **Projektion folgt dem Körper**: Ändert sich der Körper, wird die projizierte Geometrie beim Neuberechnen mitgeführt (nächste Kante bzw. Fläche gleicher Art). „Verknüpfung lösen“ macht daraus gewöhnliche Skizzengeometrie.
- **Projektion abgesichert**: Projizierte Geometrie wird vom Löser nicht mehr verschoben, Maße und Abhängigkeiten daran stimmen sofort nach der Neuberechnung, und wenn nach einer großen Änderung nicht eindeutig ist, welche Kante oder Fläche gemeint war, steht ein Warnzeichen an der Skizze und am Element („Geprüft – stimmt“ nimmt es weg).
- **Verschieben und Drehen mit der Maus**: Ausgangspunkt und Ziel bzw. Drehpunkt und Winkel anklicken, mit Vorschau; der Wert lässt sich danach als Zahl ändern.
- **Skizzenpalette**: Ansehen, Schnitt an der Skizzenebene, Profile hervorheben, Normal ↔ Konstruktion.

### Konstruktion
- **Extrusion mit Schrägungswinkel**: Die Seitenwände neigen sich um einen Winkel, auch symmetrisch und nach zwei Seiten. Kreise werden zu Kegeln, Ringe zu Kegelringen (die Öffnung wird enger, wo der Körper breiter wird).
- **Verrundung mit veränderlichem Radius**: Der Radius wächst gleichmäßig vom Anfang zum Ende der gewählten Kante.
- **Fläche löschen**: Bohrungen, Taschen, Verrundungen oder Fasen entfernen – die Nachbarflächen schließen die Lücke. Der Schritt rechnet bei Änderungen am Körper mit; dafür lädt beim ersten Mal der große Geometriekern.
- **Fläche ersetzen**: Eine ebene Fläche wird auf eine andere Ebene gelegt (Grundebene mit Versatz oder Konstruktionsebene, auch geneigt); der Körper wächst bis dorthin oder wird gekürzt.
- **Verrundung mit Stützpunkten**: Zusätzlich zu Anfangs- und Endradius lassen sich Radien an beliebigen Stellen der Kante vorgeben.
- **Fläche versetzen**: ebene Flächen verschieben, Bohrungen und Zapfen im Durchmesser ändern.
- **Ausrichten**: einen Körper mit einer seiner Flächen auf die Fläche eines anderen Körpers legen (gegenüber oder gleich gerichtet, mit Abstand).
- **Verrundung über Kantenketten durchlaufend**: Der Radius läuft vom Anfang einer Kette aneinanderhängender Kanten bis zu ihrem Ende; Stützpunkte gelten in % der Kettenlänge.
- **Skizze: Verschieben/Kopieren, Drehen, Skalieren** der gewählten Elemente über Zahlenwerte; Eckenradien und Fasen wachsen beim Skalieren mit.
- **Trägheitsmomente** Ixx / Iyy / Izz um den Schwerpunkt in den Körpereigenschaften.

### Behoben
- Viele Warnungen des Postprozessors wurden nie übersetzt, weil das Übersetzungswerkzeug an einer Zeile des Postprozessors aus dem Tritt kam. Sie erscheinen jetzt auf Englisch und Chinesisch.

- IGES-Import und -Export lesen ihre Ergebnisdatei jetzt unabhängig vom Dateinamen, den der große Kern vergibt.

### Tests
- Neue Prüfungen für alle Punkte oben (`npm run test:cam`, neu: `npm run test:design`); der G-Code-Prüfer wertet M0 als Spindelhalt.

## v1.0.0-rc.7 – 2026-11-11

### Neues Programmsymbol
- WerkFab hat ein eigenes Symbol: ein „W" als Werkzeugbahn mit Fräser am Ende. Es ersetzt die blaue Raute in App, Installer, Browser-Version und Fenstersymbol.

### Behoben: Zeichnungsfenster blieb leer
- Wurde das Zeichnungsfenster über das Fenster-Menü statt über die Schaltfläche „Zeichnung" geöffnet, blieb das Blatt leer, bis man etwas änderte. Es füllt sich jetzt bei jedem Öffnen.

### Werkzeuge
- `tools/capture-tour.cjs` nimmt die Bildfolgen für das Einführungsvideo auf (von der Skizze bis zum NC-Programm).

## v1.0.0-rc.6 – 2026-11-11

### Behoben: Windows-Version ohne Installation startete nicht
- Die Zip-Version für Windows (`…-windows-x64-portable.zip`, vorher `…-windows-x64.zip`) zeigte seit RC3 nur ein leeres Fenster: Beim Packen fehlte eine Programmdatei, weil die Ausschlussliste unter Windows zu viel traf. Der Installer und die Browser-Version waren nicht betroffen.
- Die Zip-Version wird jetzt bei jedem Release wie die anderen Pakete gestartet und geprüft.

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
