# aether-dashboard

Statische Web-App, mit der sich die Web-Builds von [Aether](https://github.com/konstantin9ezm/aether)
auf iPad und iPhone starten lassen. Eine zweite Ansicht **Projekt** zeigt den Stand des Projekts.
Die App besteht aus einer `index.html` mit eingebettetem CSS und JavaScript, dem Service Worker
`sw.js` (für den Offline-Start, siehe [Offline](#offline)), der Datendatei `engine-map.json` und der lokalen
Skriptdatei `gemeinsam.js` (siehe [Gemeinsame Hilfsfunktionen](#gemeinsame-hilfsfunktionen-gemeinsamjs)).
Es gibt keine externen Skripte und keinen Build-Schritt.

## Benutzung

1. Die Seite über GitHub Pages öffnen (in Safari: Teilen → „Zum Home-Bildschirm“, dann startet sie ohne Browserleisten).
2. Beim ersten Start ein **Fine-grained Personal Access Token** eingeben:
   - Repository access: *Only select repositories* → nur `konstantin9ezm/aether`
   - Repository permissions: **Contents**, **Pull requests** und **Actions** jeweils *Read-only*
     (Metadata kommt automatisch dazu; für die Spielansicht allein reicht Contents)
   - mit Ablaufdatum
3. Build auswählen (Standard: neuester) → **Spielen** (der Knopf liegt bereits im Spiel-iframe, siehe
   [Spielstart im Rahmen](#spielstart-im-rahmen)).
4. Oben rechts zwischen **Spielen** und **Projekt** umschalten. Die Projektansicht ist auch direkt
   über `…/#projekt` erreichbar.

Das Token wird nur im `localStorage` dieses Geräts gespeichert und ausschließlich im
`Authorization`-Header an `api.github.com` geschickt. Es landet nie in URLs, Logs oder im Code.
„Token löschen“ entfernt es zusammen mit dem lokalen Build-Cache.

## Funktionsweise

- `index.json` wird aus dem Branch `web-build` über `GET /repos/{owner}/{repo}/contents/index.json?ref=web-build` geladen.
- Für den gewählten Build liest die Seite die Dateiliste des Ordners (`contents/<path>?ref=web-build`) und erkennt
  HTML, JS, WASM, DATA und andere Dateien anhand der Endung. Dateinamen werden nicht geraten.
  Fehlt eine HTML-Datei, erzeugt die Seite eine minimale Emscripten-Hülle und wählt die passende JS-Datei selbst.
- Die Dateien werden über `git/blobs/<sha>` (Rohdaten) mit Fortschrittsanzeige geladen und per SHA im Cache-Storage
  zwischengespeichert. Ein vollständig gespeicherter Build startet ohne jeden API-Aufruf (siehe [Offline](#offline)).
- Das Spiel läuft in einem `sandbox`-iframe **ohne** `allow-same-origin`. Es bekommt die Dateien per `postMessage`
  und kann weder das Token noch den `localStorage` der Seite lesen. `fetch`/`XMLHttpRequest` auf Build-Dateien
  werden innerhalb des iframes aus dem Speicher beantwortet.
- Fehlermeldungen gibt es für: falsches, abgelaufenes oder widerrufenes Token (401), fehlende Berechtigung (403),
  Rate-Limit (mit Uhrzeit, ab wann es wieder geht), kein Zugriff aufs Repo, fehlender Branch, fehlende `index.json`,
  fehlenden Build-Ordner und Verbindungsprobleme.

- Das Spiel kann sich selbst beenden: `window.parent.postMessage({ type: "aether:quit" }, "*")`. Das Dashboard
  schließt es dann wie mit dem Schließen-X (verlässt auch das Vollbild), aber ohne Rückfrage. Angenommen wird nur
  eine Nachricht, deren `event.source` das Spiel-iframe ist und deren `data.type` genau `"aether:quit"` lautet
  (der Ursprung des iframes ist `"null"`, deshalb die Prüfung über `event.source`). Alles andere wird ignoriert.

Hinweis: Weil das Spiel isoliert läuft, steht ihm kein eigener `localStorage`/IndexedDB zur Verfügung. Mail-Links
und die Zwischenablage gehen dort ebenfalls nicht. Dafür gibt es die Schnittstelle unten.

## Fassung (Entwickler/Playtester)

Seit aether PR #68 legt die CI im Branch `web-build` je Build zwei Fassungen ab: `builds/<hash>/` (Entwickler-Fassung)
und `playtester/<hash>/` (Playtester-Fassung). In `index.json` haben Builds ab PR #68 das Feld
`"playtester": "playtester/<hash>/"`; ältere Builds haben es nicht (nur Entwickler-Fassung). Das Dashboard liest
`index.json` nur und ändert das Format nicht.

- Zwischen „Build wählen / Aktualisieren“ und der ersten Build-Karte sitzt der Umschalter **„Fassung: Entwickler |
  Playtester“**. Standard ist „Entwickler“ (Verhalten wie zuvor, Pfad aus `path`). Die Wahl liegt in `localStorage`
  unter `aether.fassung` (`"entwickler"` oder `"playtester"`); fehlende oder ungültige Werte gelten als „Entwickler“.
- **Playtester:** Builds mit Feld `playtester` laden ihre Dateien von diesem Pfad (gleicher Weg: GitHub-API,
  `contents/<pfad>?ref=web-build`, dann `git/blobs`). Builds ohne das Feld sind ausgegraut, nicht wählbar und zeigen
  rechts „keine Playtester-Fassung“ (auch unter „Ältere Builds anzeigen“). Ist beim Umschalten ein solcher Build
  gewählt, springt die Auswahl auf den neuesten Build mit Playtester-Fassung; gibt es keinen, ist der Start gesperrt
  (ausgegrauter Knopf) mit kurzem Hinweis unter der Liste.
- Der Knopf „Spielen“ im Start-Rahmen zeigt klein darunter die gewählte Fassung („Entwickler-Fassung“ bzw.
  „Playtester-Fassung“; `data-fassung` am Knopf, `aria-label` „Spielen, …“). Beim Wechsel von Fassung oder Build wird
  der Start-Rahmen neu aufgebaut; Sandbox und alle Attribute des iframes bleiben unverändert.
- **Speicher/Offline:** „gespeichert“ gilt je Fassung; Entwickler- und Playtester-Fassung desselben Hashs sind
  getrennte Einträge in `aether.cachedBuilds` (Playtester-Einträge tragen `"fassung": "playtester"`, Einträge ohne
  das Feld sind Entwickler-Fassung – bereits gespeicherte Builds gelten nach dem Update also weiter als gespeichert).
  Das automatische Laden des neuesten Builds beim Start nimmt die gewählte Fassung. Es bleiben **je Fassung** höchstens
  2 Builds (zuletzt gestarteter + neuester), insgesamt also höchstens 4; Dateien gleichen Inhalts liegen nur einmal im
  Cache `aether-builds-v1`. Offline sind nur gespeicherte Builds der gewählten Fassung startbar. Beim bloßen Umschalten
  wird nichts automatisch geladen.
- Tests: `tests/fassung.test.js`.

## Spielstart im Rahmen

Safari/WebKit drosselt `requestAnimationFrame` in einem fremden (cross-origin) iframe auf 30 fps, bis der Nutzer
**in dieses iframe** tippt (gemessen am 08.11.2026 auf dem iPad Pro 11, Safari 26.6, mit dem WebGPU-Check;
Controller-Tasten und programmatischer Fokus heben das nicht auf). Das Spiel-iframe bleibt absichtlich fremd
(Sandbox ohne `allow-same-origin`). Deshalb landet schon der Tipp auf „Spielen“ im Spiel-iframe:

1. **Start-Rahmen:** Ist in der Build-Liste ein startbarer Build gewählt, legt das Dashboard das Spiel-iframe sofort an
   (`createGameFrame()`, gleiche Attribute wie bisher: `sandbox="allow-scripts allow-pointer-lock"`,
   `allow="gamepad *; fullscreen *; autoplay *"`, `referrerpolicy="no-referrer"`, `title`, `srcdoc`). Das `srcdoc`
   enthält nur den Knopf „Spielen“ (Aussehen wie der frühere Dashboard-Knopf) und das Boot-Skript. Spieldateien
   werden noch nicht geladen. Das iframe liegt von Anfang an in `#game`; `#game.slot` legt es per CSS genau über den
   Platzhalter `#playSlot` in der Karte (Lage folgt per `ResizeObserver` und `resize`).
2. **Tipp:** Das Boot-Skript meldet `aether:start-tap`. Danach läuft der bisherige Ablauf (Cache bzw. Download mit
   Fortschrittsanzeige im Dashboard). Anschließend schickt das Dashboard Spiel-HTML und Dateien an **dasselbe**
   iframe; das Boot-Skript setzt head/body des Spiels in das vorhandene Dokument ein und führt die Skripte der Reihe
   nach aus. Das iframe-Element wird nie neu erzeugt oder im DOM verschoben, `src`/`srcdoc` bleiben unverändert;
   nur die Klassen an `#game` ändern das Layout (`slot` → `wait` während des Ladens → bildschirmfüllend).
3. **Build-Wechsel** legt einen neuen Start-Rahmen an. **Beenden** (Schließen-X mit Rückfrage, `aether:quit`)
   entfernt das iframe; zurück in der Build-Liste steht ein frischer Start-Rahmen. Offline bekommen nur gespeicherte
   Builds einen Rahmen; ohne gespeicherten Build steht dort ein ausgegrauter Knopf.
4. **Rückfall-Hinweis:** Wurde ohne Zeiger-Tipp gestartet (Enter/Leertaste auf dem Knopf im Rahmen) und meldet das
   Gerät `navigator.maxTouchPoints > 1` (iPhone/iPad), zeigt die Spielansicht unten mittig „Einmal ins Spielbild
   tippen für flüssigere Darstellung“ (`#gameHint`, `aria-live="polite"`, `pointer-events: none`, über dem iframe,
   unter Leiste und Feedback-Dialog). Er verschwindet beim ersten Tipp ins Spiel, beim Öffnen des Feedback-Dialogs
   und beim Beenden. Im Stromsparmodus drosselt iOS unabhängig davon.
5. **Messhilfe:** `…/?fps=1` zeigt in der Spielansicht oben mittig die Bildrate, die das Boot-Skript im iframe per
   `requestAnimationFrame` misst (Mittel über ca. 1 s). Ohne den Parameter wird nichts gemessen und nichts angezeigt.

### Dashboard-interne Nachrichten (Boot-Skript ↔ Dashboard)

Das Boot-Skript ist Dashboard-Code. Seine Nachrichten laufen durch dieselbe Verarbeitung wie die Schnittstelle
unten: angenommen nur, wenn `event.source` das `contentWindow` **genau des aktuellen** Rahmens ist (nicht die Seite,
nicht ein anderes iframe, nicht ein alter Start-Rahmen); unbekannte Felder werden ignoriert. `doc` ist eine zufällige
Kennung, die das Boot-Skript beim Laden des Rahmens setzt; sie bleibt nach dem Start dieselbe.

| Richtung | Nachricht | Bedeutung |
|---|---|---|
| iframe → Dashboard | `{ aether: "boot", doc }` | Rahmen geladen; das Dashboard merkt sich `doc`. |
| iframe → Dashboard | `{ type: "aether:start-tap", pointerType, doc }` | „Spielen“ im Rahmen ausgelöst; `pointerType` `"mouse"`/`"touch"`/`"pen"`, `""` ohne Zeiger. Startet nur im Zustand „Start-Rahmen“. |
| iframe → Dashboard | `{ type: "aether:tapped", doc }` | erster `pointerdown` im iframe (passiv, Capture); blendet den Rückfall-Hinweis aus. |
| iframe → Dashboard | `{ type: "aether:fps", fps, doc }` | nur mit `?fps=1`, etwa jede Sekunde. |
| Dashboard → iframe | `{ aether: "files", files, html }` | Spieldateien und Spiel-HTML (mit zurückgehaltenen Skripten). |
| iframe → Dashboard | `{ aether: "started", doc }` | Spielskripte eingesetzt; gilt nur bei gleichem `doc`. |

Die Schnittstelle Spiel ↔ Dashboard (Version 1) ändert sich dadurch nicht; `AETHER_HOST.version` bleibt `1`.

## Spielrahmen-Höhe in der Home-App

**Befund (Analyse vom 13.11.2026):** Auf dem iPad Pro 11" (iPadOS 26.6.2) meldet die Home-Bildschirm-App im
Querformat nur 802 pt Höhe (`innerHeight`), der Bildschirm hat 834 pt. Der frühere Höhen-Ausgleich in
`fitGameToScreen()` zog `#game` per `--game-h` auf 834 pt, iPadOS zeichnet die unteren 32 pt aber nicht – der
Touch-Stick wurde unten abgeschnitten. Vermutete Ursache: Fehler von iPadOS 26 bei `viewport-fit=cover` mit
`black-translucent`. iPhone 16 Pro quer in der Home-App ist laut Gerätetest nicht betroffen.

**Schalter:** `HOEHEN_AUSGLEICH_HOME_APP` in `index.html` (direkt vor `fitGameToScreen()`), Standard `false`.
Damit ist der Spielrahmen in der Home-App so hoch wie die gemeldete Ansicht (`innerHeight`); unten bleibt auf dem
iPad ein schmaler Streifen. Wieder einschalten: Konstante auf `true` setzen. Abgeschaltet ist nur die Höhe; der
Breiten-Ausgleich (`--game-w`) arbeitet wie bisher. Safari-Tab und Vollbild-Knopf sind nicht betroffen (der
Ausgleich galt nur in der Home-App).

**Test-Schalter:** `?strecken=1` an der Adresse schaltet den Höhen-Ausgleich nur für diesen Seitenaufruf ein
(wird nicht gespeichert). Hinweis: In der Home-Bildschirm-App gibt es keine Adresszeile, dort lässt sich der
Zusatz nicht eingeben; er dient für Tests (z. B. Playwright) bzw. eine zum Home-Bildschirm hinzugefügte Adresse
mit diesem Zusatz.

**Apple-Fix:** Meldet iPadOS künftig die volle Höhe in `innerHeight`, füllt das Spiel ohne Änderung am Code
wieder den ganzen Bildschirm.

## Schnittstelle Spiel ↔ Dashboard (Version 1)

**Die Sandbox bleibt bewusst unverändert** (`sandbox="allow-scripts allow-pointer-lock"`, kein `allow-same-origin`).
Mit `allow-same-origin` hätte das Spiel denselben Ursprung wie das Dashboard und könnte das GitHub-Token lesen.
Stattdessen bittet das Spiel das Dashboard per `postMessage`, Dinge stellvertretend zu erledigen.

Vom Dashboard ins Spiel, beim Start als erstes Skript im `srcdoc` (vor dem Boot-Skript und allen Spielskripten):

```js
window.AETHER_HOST = { version: 1, settings: true, feedback: true, dialogInput: true, settingsAck: true };
window.AETHER_HOST_SETTINGS = { "<schlüssel>": "<wert>", ... }; // gespeicherte Spiel-Einstellungen, sonst {}
```

Ein neues Spiel erkennt ein altes Dashboard daran, dass `window.AETHER_HOST` fehlt. Ein altes Spiel sendet die
Nachrichten nie, dann passiert im Dashboard nichts.

`dialogInput: true` ist eine rückwärtskompatible Erweiterung innerhalb von Version 1 (`version` bleibt `1`): Nur
ein Dashboard mit diesem Feld versteht `aether:dialog-input`. Ein Spiel schickt die Nachricht nur, wenn
`window.AETHER_HOST.dialogInput === true` ist; ältere Dashboards kündigen sie nicht an (und würden sie ignorieren),
ältere Spiele schicken sie nie, dann bleibt der Dialog wie bisher per Touch/Tastatur bedienbar.

`settingsAck: true` ist ebenso eine rückwärtskompatible Erweiterung innerhalb von Version 1 (siehe „Speichern
bestätigen“): Das Dashboard beantwortet Speicher-Nachrichten mit `id` durch `aether:settings-ack` und versteht die
Sammel-Nachricht `aether:settings`.

| Richtung | Nachricht | Wirkung |
|---|---|---|
| Spiel → Dashboard | `{ type: "aether:setting", key, value }` | Speichert `value` (String) unter `key`; `value: null` löscht den Schlüssel. Ohne `id` keine Antwort; mit `id` siehe „Speichern bestätigen“. |
| Spiel → Dashboard | `{ type: "aether:settings", id?, items: [{ key, value }, …] }` | *Ergänzung, selbst gewählt:* mehrere Schlüssel in einer Nachricht, alle oder keiner (siehe „Speichern bestätigen“). |
| Spiel → Dashboard | `{ type: "aether:feedback", subject, body }` | Öffnet den Feedback-Dialog. |
| Spiel → Dashboard | `{ type: "aether:feedback-close" }` | Schließt den Dialog (z. B. Controller-Taste B). |
| Spiel → Dashboard | `{ type: "aether:dialog-input", action }` | Controller-Bedienung des offenen Dialogs, `action` genau `"show"`, `"prev"`, `"next"` oder `"press"` (nur bei `dialogInput: true`, siehe unten). |
| Dashboard → Spiel | `{ type: "aether:feedback-state", open: true \| false }` | Nach dem Öffnen und nach jedem Schließen des Dialogs. |
| Dashboard → Spiel | `{ type: "aether:settings-ack", id, ok, grund, keys }` | *Ergänzung, selbst gewählt:* Antwort auf jede Speicher-Nachricht **mit** `id`. |

Spiel → Dashboard per `window.parent.postMessage(nachricht, "*")`, Dashboard → Spiel per
`iframe.contentWindow.postMessage(nachricht, "*")` (der Ursprung des iframes ist `"null"`).

Regeln:

- Das Dashboard nimmt eine Nachricht nur an, wenn `event.source === iframe.contentWindow` ist und `type` exakt
  stimmt. Das Spiel prüft bei `aether:feedback-state`, dass `event.source === window.parent` ist.
- Schlüssel: genau `/^aether\.[A-Za-z0-9_.-]{1,64}$/`. Wert: String mit höchstens 1024 Zeichen oder `null`.
  Höchstens 64 Schlüssel. Alles andere wird stillschweigend ignoriert.
- `subject` höchstens 200 Zeichen, `body` höchstens 4000 Zeichen (das Dashboard kürzt längere Texte). Beide
  müssen Strings sein.
- Die Empfänger-Adresse ist fest `feedback.aether@gmail.com`. Das Dashboard baut den `mailto:`-Link selbst und
  übernimmt nie eine URL aus einer Nachricht.
- Die bestehenden Nachrichten (`{ aether: "boot" | "started" | "error" | "files" }`, `{ type: "aether:quit" }`)
  bleiben unverändert.

### Einstellungs-Speicher

- Eigener `localStorage`-Schlüssel `aether.gameSettings` (JSON-Objekt Schlüssel → Wert), getrennt vom Token. Jeder
  Zugriff steht in `try/catch`. Kaputtes JSON oder ein falscher Typ zählt als leeres Objekt, ungültige Einträge
  werden beim Lesen verworfen.
- Beim Spielstart wird das Objekt mit `JSON.stringify` serialisiert und jedes `<` als `\u003c` geschrieben.
  So beendet ein Wert wie `"</script>"` das Skript nicht vorzeitig.
- „Token löschen“ lässt die Spiel-Einstellungen stehen. Sie enthalten keine Zugangsdaten, sondern nur Vorlieben wie
  „Boost-Knopf (Touch) anzeigen“. Wer das Token erneuert, soll sie nicht verlieren.

### Speichern bestätigen (Ergänzung zu Version 1, selbst gewählt)

Rückwärtskompatible Ergänzung innerhalb von Version 1 (`AETHER_HOST.version` bleibt `1`). Namen und Felder sind
**selbst gewählt**. Das heutige Spiel (aether main `cf5a485`) schickt nur `aether:setting` ohne `id` und merkt nichts
davon: Sein einziger `message`-Listener (`web/shell.html`) nimmt nur `aether:feedback-state` an und verwirft alle anderen
Typen, also auch `aether:settings-ack`.

- **Ankündigung `AETHER_HOST.settingsAck: true`** (selbst gewählt): bedeutet „Dieses Dashboard beantwortet
  `aether:setting`/`aether:settings` mit `id` durch `aether:settings-ack` und versteht `aether:settings`.“ Vorhanden ab
  dem Dashboard-PR nach #38 (Ausgangsstand `ad0f473`). Antworten gibt es schon seit PR #37; ein Dashboard zwischen
  PR #37 und diesem Stand antwortet also, kündigt es aber nicht an (ein Spiel behandelt es wie ein altes). Das Feld steht an jeder
  Stelle, an der `AETHER_HOST` ins Spiel-iframe kommt (jeder Start, Neustart, Build-Wechsel, gespeicherter Build offline;
  alle gehen über `hostScript()` in `index.html`). `version` bleibt `1`, `settings`, `feedback` und `dialogInput` sind
  unverändert. Ein Spiel soll Sammel-Nachrichten und Antworten nur nutzen, wenn `window.AETHER_HOST.settingsAck === true`
  ist; sonst (älteres Dashboard ohne das Feld) wie bisher einzelne `aether:setting` ohne `id`. Spiele, die das Feld nicht
  kennen, sind nicht betroffen: Für sie ändert sich nichts.

- **Sammel-Nachricht** `{ type: "aether:settings", id?, items: [{ key, value }, …] }`: 1 bis 64 Einträge. Gleiche
  Regeln wie bei `aether:setting` (Schlüssel-Muster, Wert String ≤ 1024 Zeichen oder `null` = löschen). Ein späterer
  Eintrag mit demselben Schlüssel gewinnt. Das Dashboard prüft vorher alles (Form, Grenzen, höchstens 64 Schlüssel nach
  dem Schreiben) und schreibt dann in **einem** `localStorage.setItem`: alle oder keiner. Bei einem Fehler bleibt der
  alte Stand.
- **Antwort** auf jede Nachricht mit gültiger `id` (Text mit 1–64 Zeichen oder ganze Zahl), einzeln oder als Sammel-Nachricht:
  `{ type: "aether:settings-ack", id, ok: true|false, grund, keys }`. `grund` ist bei `ok: true` `null`, sonst
  `"voll"` (QuotaExceededError, Speicher des Browsers voll), `"grenze"` (Wert über 1024 Zeichen oder mehr als 64
  Schlüssel), `"ungueltig"` (Schlüssel/Wert falsch geformt, `items` kein Feld mit 1–64 Einträgen), `"anderes-fenster"`
  (dieses Fenster speichert nicht, siehe „Nur ein Fenster speichert“) oder `"fehler"` (anderer Fehler beim Schreiben).
  `keys` = die Schlüssel der Nachricht (ohne Doppelte). Die Antwort geht an genau das Spiel-iframe, das gefragt hat.
- **Ohne `id`** (bzw. mit ungültiger `id`) verhält sich jede Nachricht wie bisher: Es gibt keine Antwort, Falsches wird
  stillschweigend ignoriert.
- **Hinweis „Speichern nicht möglich“** (unabhängig davon, ob das Spiel die Antwort auswertet; auch für Nachrichten ohne
  `id`): erscheint, wenn ein Schreiben scheitert (`voll`, `grenze`, `fehler`; nicht bei `ungueltig`). Lage unten
  mittig über dem Spiel, bis 600 px breit, 34 px über dem unteren Rand (plus sicherer Bereich). Dunkler Grund `#1a1426`,
  links 6 px rot `#e0393e`, rundes rotes „!“, Titel „Speichern nicht möglich“, Zeile mit dem Grund (z. B. „Speicher des
  Browsers voll. Änderungen gelten nur bis zum Schließen.“), Knöpfe „Details“ und „×“ (je ≥ 44 px). Der Hinweis bleibt
  stehen, bis „×“ oder „Details“ getippt wird. „Details“ zeigt den Grund, die betroffenen Schlüssel ohne `aether.`
  (z. B. „ownWorld.2 – Speicher voll“) und „Erneut versuchen“, solange es zurückgehaltene Werte gibt (bei „Grenze“
  hilft Wiederholen nicht). Gescheiterte Werte hält das Dashboard zurück. „Erneut versuchen“ und jedes spätere
  Schreiben schreiben sie mit (alle oder keiner). Mehrere Fehler kurz hintereinander ergeben **einen** Hinweis, die
  Liste wächst.
- **„Wieder gespeichert“**: Gelingt ein Schreiben nach einem Fehler, erscheint kurz „Wieder gespeichert – Alle
  Änderungen gesichert.“ (links grün `#3cc47a`, ✓, bis 380 px). Er verschwindet nach 3 s. Normales erfolgreiches
  Speichern zeigt nichts.
- Bedienung: Touch, Maus und Tastatur. Esc = ×, Enter = Details, solange der Fokus im Hinweis oder auf keinem Element
  liegt. Im Spiel-iframe gehören die Tasten dem Spiel, Tab bzw. Antippen erreicht den Hinweis. Der Hinweis holt nie den
  Fokus, pausiert das Spiel nicht und nimmt außerhalb seiner Fläche keine Eingaben an. Nach „×“ per Tastatur geht der
  Fokus zurück ins Spiel.
- Beendet man das Spiel, verfallen zurückgehaltene Werte („gelten nur bis zum Schließen“), und der Hinweis verschwindet.

### Nur ein Fenster speichert

Ist die Seite mit dem Spiel (`index.html`) in mehreren Fenstern oder Tabs **desselben Browsers** offen, speichert
immer nur eines:

- **Web Locks API** (`navigator.locks`, Sperre `aether-dashboard-spiel`, selbst gewählt): Beim Öffnen fragt die Seite
  mit `ifAvailable`. Bekommt sie die Sperre, hält sie sie bis zum Schließen und lädt den Spielrahmen wie bisher.
  Gemessen in Headless Chromium: Sperre nach ca. 9 ms, kein merkbarer Unterschied beim Start. Bekommt sie die Sperre
  nicht, lädt sie **keinen** Spielrahmen und schreibt nichts. Eine Speicher-Nachricht bekäme dort die Antwort `ok: false`,
  `grund: "anderes-fenster"`.
- **Ersatzweg** ohne Web Locks: `BroadcastChannel` mit demselben Namen. Ein neues Fenster fragt „wer spielt?“ und wartet
  150 ms auf Antwort. Gibt es weder Web Locks noch BroadcastChannel, speichert jedes Fenster wie bisher.
- **Tafel** im Fenster ohne Speicherrecht: mittig über abgedunkeltem Hintergrund (`rgba(5,6,14,0.72)`), bis 600 px
  breit, Grund `#121731`, Rand `#3a4170`, Ecken 20 px. Titel „Aether läuft schon in einem anderen Fenster“, Text „Damit
  nichts verloren geht, speichert immer nur ein Fenster. Hier ist das Spiel angehalten.“, Knöpfe „Hier weiterspielen“
  (violett `#8b7cf6`, hat den Fokus) und „Fenster schließen“, dazu der Hinweis „„Hier weiterspielen“ hält das andere
  Fenster an; dort erscheint dieselbe Tafel mit „Hier weiterspielen“.“. Die übrige Seite ist solange `inert`.
- **„Hier weiterspielen“** (auch Enter) übernimmt die Sperre mit `steal: true` (Ersatzweg: Nachricht „übernehme“).
  Dieses Fenster lädt den Spielrahmen neu (Knopf „Spielen“ in der Build-Liste). Das andere Fenster bekommt einen
  `AbortError`, bricht ein laufendes Laden ab, entlädt sein Spiel (iframe entfernt, Vollbild beendet) und zeigt
  dieselbe Tafel.
- **„Fenster schließen“** ruft `window.close()`. Browser schließen so nur Fenster, die ein Skript geöffnet hat. Sonst
  (normaler Tab, Home-Bildschirm-App) erscheint in der Tafel: „Der Browser lässt dieses Fenster nicht per Knopf
  schließen. Bitte den Tab bzw. die App selbst schließen – oder „Hier weiterspielen“ tippen.“
- Nur lesend für Diagnose und Tests: `window.__aetherFenster` mit `zustand` (`pruefe` | `halter` | `wartet` |
  `uebernimmt`), `weg` (`locks` | `kanal` | `keiner`), `startMs`, `bereitMs`, `rahmenMs` und `speicherSchutz`.

### Speicher-Schutz

Beim Öffnen von `index.html` fragt die Seite einmal `navigator.storage.persisted()` und, falls noch nicht dauerhaft,
`navigator.storage.persist()` (nur wenn vorhanden; fehlt die API, passiert nichts). Es gibt keine Anzeige, weil das
Dashboard keine Diagnose-Stelle hat. Das Ergebnis steht nur intern (`ja` | `nein` | `unbekannt`, lesbar über
`window.__aetherFenster.speicherSchutz`).

### Feedback-Dialog

- Erscheint über dem laufenden Spiel mit dem Titel „Feedback senden“, der sichtbaren Zeile
  „An: feedback.aether@gmail.com“ (für Geräte ohne Mail-App) und einer schreibgeschützten, innen scrollenden
  Vorschau („Betreff: …“, Leerzeile, Text). Der Text wird nur über `.value`/`textContent` gesetzt, nie als HTML.
- **Mail öffnen** öffnet synchron im Klick
  `mailto:feedback.aether@gmail.com?subject=<encodeURIComponent>&body=<encodeURIComponent>`. Ist der ganze Link
  länger als 2000 Zeichen, wird der Text von hinten gekürzt und „(gekürzt – vollständig über 'Text kopieren')“
  angehängt. Der Dialog bleibt offen.
- **Text kopieren** schreibt „Betreff: …“, eine Leerzeile und den Text per `navigator.clipboard.writeText` (synchron
  im Klick). Geht das nicht, folgt `execCommand("copy")`. Scheitert auch das, wird der Text in der Vorschau markiert
  und „Bitte manuell kopieren“ angezeigt. Bei Erfolg erscheint kurz „Kopiert“.
- **Schließen** geht über den Knopf, Esc, Backspace (siehe unten), Antippen außerhalb des Dialogs, `aether:feedback-close` oder das Beenden
  des Spiels (X mit Rückfrage oder `aether:quit`). Danach meldet das Dashboard `open: false`, und der Fokus geht
  zurück ins Spiel-iframe.
- Bedienung: Touch und Maus; Tab/Umschalt+Tab und die Pfeiltasten wechseln zwischen den Knöpfen, Enter/Leertaste
  lösen aus. Beim Öffnen hat „Mail öffnen“ den Fokus. Den Controller liest das Dashboard nicht; das Spiel schickt
  bei B `aether:feedback-close`.
- Tastenbelegung des Dialogs:

  | Taste | Wirkung |
  |---|---|
  | Tab / Umschalt+Tab | nächster / vorheriger Knopf (mit Umlauf) |
  | Pfeiltasten | nächster / vorheriger Knopf, solange ein Knopf den Fokus hat |
  | Enter / Leertaste | löst den fokussierten Knopf aus |
  | Esc | schließt den Dialog |
  | Backspace | schließt den Dialog wie Esc bzw. Controller-B (für das Magic Keyboard des iPads ohne Esc-Taste) |

  Backspace schließt **nicht**, solange ein Texteingabefeld den Fokus hat (`input` vom Typ text, password, search,
  email, url, tel oder number, `textarea` ohne `readonly`, `contenteditable`); dort löscht es wie gewohnt Zeichen.
  Die schreibgeschützte Vorschau zählt nicht als Texteingabe. Eine gehaltene Taste (Tastenwiederholung,
  `event.repeat`) löst nichts aus: ein Druck schließt höchstens einmal. Ohne offenen Dialog bewirkt Backspace im
  Dashboard nichts Neues (keine Navigation, kein Ansichtswechsel; das Token-Feld funktioniert unverändert).

### Controller im Feedback-Dialog (`aether:dialog-input`)

Das Spiel bleibt der einzige Controller-Leser (kein `navigator.getGamepads` im Dashboard). Bei offenem Dialog
übersetzt es Controller-Eingaben in `{ type: "aether:dialog-input", action }`:

| `action` | Wirkung |
|---|---|
| `"show"` | Macht den weißen Fokusrahmen (3 px) um den gewählten Knopf sichtbar, ohne die Auswahl zu bewegen. |
| `"prev"` / `"next"` | Auswahl einen Knopf nach links/rechts (Mail öffnen → Text kopieren → Schließen), am Ende bleibt sie stehen (kein Umlauf). Rahmen wird sichtbar. |
| `"press"` | Löst den gewählten Knopf aus (siehe unten). |

- Angenommen nur mit derselben Quellprüfung wie die übrigen Nachrichten (`event.source` ist das Spiel-iframe) und
  nur, solange der Dialog offen ist. Unbekannte `action`-Werte werden ignoriert, zusätzliche Felder ebenfalls
  (die Nachricht gilt dann mit ihrer `action`). Es gibt keine Antwort.
- Beim Öffnen ist „Mail öffnen“ gewählt, der Rahmen zunächst unsichtbar. Antippen/Klick im Dialog blendet ihn aus.
  Tastatur-Fokus und Controller-Auswahl sind derselbe Knopf. Solange der Rahmen sichtbar ist, steht unter den
  Knöpfen „◀ ▶ wechseln · Ⓐ auswählen · Ⓑ schließen“. Rahmen und Zeile ändern weder Knopfgröße noch -anordnung.
- `"press"` auf **Schließen** schließt wie der Knopf (`open: false`, Fokus zurück ins Spiel).
- Browser erlauben Mail-Link und Zwischenablage oft nur nach echter Nutzeraktion; ein Controller zählt dafür nicht
  überall. Im Dialog erscheint dann „Per Controller nicht möglich – bitte antippen oder Enter drücken.“:
  - **Mail öffnen**: Das Dashboard versucht per Controller **keinen** `mailto:`-Link und zeigt sofort den Hinweis.
    Grund: Safari öffnet einen Mail-Link ohne echte Nutzeraktion nur einmal pro Seitenaufruf und meldet danach
    „Safari kann die Seite nicht öffnen, da die Adresse ungültig ist.“. Enter auf dem fokussierten Knopf (der
    Fokus liegt bei offenem Dialog im Dashboard, nicht im Spiel-iframe), Antippen und Klick öffnen die Mail-App
    weiterhin über den Klick-Handler.
  - **Text kopieren**: `navigator.clipboard.writeText`, sonst `execCommand("copy")`. Scheitert beides → Hinweis
    (die Vorschau wird nicht markiert; das bleibt dem Antippen vorbehalten). Bei Erfolg kurz „Kopiert“.
  - Der Hinweis verschwindet bei der nächsten Eingabe (Controller, Antippen, Taste) oder beim Schließen.

## Offline

Das Dashboard lässt sich auch ohne Internet öffnen und startet dann den zuletzt gespeicherten Build.

**Ablauf beim Start**

1. Der Service Worker `sw.js` liefert die Seite selbst (`index.html`, `manifest.json`, Icons), `engine-map.json`,
   den Screen-Editor (`screen-editor.html`, `vendor/three-r128.min.js`), die Logo-Seite (`logo.html`) samt Schriften (`fonts/`),
   die Flyer-Seite (`flyer.html` mit den Modulen `flyer.js`, `flyer-paket.js`, `flyer-speicher.js`, `flyer-ansicht.js`,
   `flyer-online.js`, `flyer-export.js`, `flyer-aenderungen.js`, `flyer-bearbeiten.js`; nur Programmcode, das Paket und
   die Änderungen liegen in IndexedDB, siehe
   [Flyer & Infografiken](#flyer--infografiken)) und `gemeinsam.js` aus dem Cache `aether-shell-v1`, wenn das Netz nicht antwortet. Online holt er immer die aktuelle Seite vom Server
   („Netz zuerst, sonst Cache“) und frischt den Cache dabei auf. Anfragen an `api.github.com` fasst er nie an.
2. Die Seite prüft **zuerst online**, ob es neue Builds gibt (`index.json`). Dafür gilt das Zeitlimit
   `ONLINE_CHECK_TIMEOUT_MS = 30 s`. Antwortet GitHub, wird die Liste lokal gespeichert
   (`localStorage`, Schlüssel `aether.lastIndex`). Ist der neueste Build noch nicht gespeichert, lädt die Seite
   ihn sofort mit Fortschrittsanzeige herunter („Lade neuen Build …“, abbrechbar) und legt ihn im Cache ab.
3. Schlägt die Prüfung fehl (keine Verbindung, Zeitlimit, GitHub-Serverfehler, Rate-Limit), zeigt die Seite die
   zuletzt gespeicherte Liste. Oben erscheint der Hinweis **„Offline – letzte Version `<hash>`“** mit dem Grund;
   `<hash>` ist der neueste vollständig gespeicherte Build. Nur gespeicherte Builds (Abzeichen „gespeichert“) lassen
   sich starten, die anderen sind ausgegraut. Ein falsches oder abgelaufenes Token führt wie bisher zur Token-Eingabe,
   nicht zum lokalen Stand.
4. Meldet das Gerät wieder eine Verbindung (`online`-Ereignis) oder tippt man auf „Aktualisieren“, wird die Prüfung
   wiederholt; gelingt sie, verschwindet der Hinweis.
5. Die **Projektansicht** zeigt offline nur „Offline – Projektansicht nicht verfügbar“ statt vier Fehlerkarten.
   „Aktualisieren“ wiederholt die Online-Prüfung und lädt bei Erfolg die Ansicht. Die Karte **Tools** bleibt
   sichtbar; Screen-Editor, Logo-Seite und Flyer-Seite starten offline, „Messflug“ und „WebGPU-Check“ sind ausgegraut
   („nur online“).

**Speicherort und Umfang**

- Build-Dateien liegen wie bisher per SHA im Cache-Storage `aether-builds-v1`. Welche Builds vollständig da sind,
  steht mit Dateiliste (Name, SHA, Größe) im `localStorage` unter `aether.cachedBuilds`; daraus wird ein Build
  offline ohne API rekonstruiert.
- `KEEP_BUILDS = 2`: Es bleiben der zuletzt gestartete und der neueste Build (oft derselbe). Jeder Build ist mehrere
  MB groß, und iOS begrenzt den Speicher je Web-App und verwirft bei Platzmangel alles auf einmal, deshalb nicht mehr.
  Nach jedem vollständigen Download werden ältere Builds samt Dateien entfernt. Vorher war der Wert 3 (ohne
  Offline-Start).
- Der Token liegt nur im `localStorage` (`aether.githubToken`), nie im Service-Worker-Cache oder in gespeicherten
  Antworten. Der Service Worker beantwortet ausschließlich Anfragen an den eigenen Ursprung (die Seite selbst);
  alles andere geht unverändert ins Netz.
- Das Flyer-Paket liegt nicht im Cache-Storage, sondern in IndexedDB `aether-flyer` (zuletzt übernommenes Paket,
  zuletzt bekannte Online-Datei und die eigenen Änderungen, ohne Token); damit öffnet die Flyer-Seite offline mit dem gespeicherten Stand. Die
  Online-Prüfung der Flyer-Seite (api.github.com) kommt wie alle API-Anfragen nie in einen Cache.

**Grenzen**

- Der erste Start braucht Internet: Erst dann sind Seite, Liste und Build gespeichert. Auf iOS/iPadOS gilt das
  für die Home-Bildschirm-App getrennt vom Safari-Tab (eigener Speicher), also die App einmal online öffnen.
- iOS kann die gespeicherten Daten löschen, wenn die App länger nicht benutzt wurde oder der Speicher knapp wird.
  Dann ist wieder ein Online-Start nötig.
- Nur die Prüfung auf neue Builds hat ein Zeitlimit. Der Download eines neuen Builds läuft, bis er fertig ist oder
  abgebrochen wird („Abbrechen“ zeigt die Liste; der Build lässt sich später normal starten).
- Dashboard-Updates kommen online sofort an (Netz zuerst). Bei sehr schlechter Verbindung dauert das Öffnen so
  lange, bis der Browser die Anfrage aufgibt, erst dann kommt die Seite aus dem Cache.

**Speicher leeren**

- „Cache leeren“ entfernt Build-Dateien, Build-Index und die gespeicherte Liste; die Seite selbst bleibt offline
  öffnbar.
- „Token löschen“ entfernt zusätzlich die vom Service Worker gespeicherte Seite (kompletter Neuanfang).
- Das Flyer-Paket (IndexedDB `aether-flyer`) bleibt bei beiden stehen; es enthält kein Token.
- Alles inklusive Service Worker: Safari → Einstellungen → Safari → Erweitert → Website-Daten (bzw. in der
  Home-Bildschirm-App die App löschen und neu hinzufügen).

**Testschalter:** Setzt man vor dem Laden der Seite `window.AETHER_TEST_CHECK_TIMEOUT_MS` (positive Zahl), gilt
dieses Zeitlimit statt der 30 s. Das nutzen nur die E2E-Tests; die Seite liest sonst keine Einstellung dafür.

## Projektansicht

Vier Teile, jeder lädt und meldet Fehler für sich (fällt einer aus, funktionieren die anderen weiter):

1. **Build-Ampel** – letzter Lauf des Workflows „Build“ auf `main`
   (`actions/workflows` → ID per Name, dann `actions/workflows/{id}/runs?branch=main&per_page=1`).
   Grün = erfolgreich, Gelb = läuft/wartet (wird alle 30 s nachgeladen), Rot = fehlgeschlagen/abgebrochen.
   Dazu Zeit in deutscher Ortszeit (`Europe/Berlin`, unabhängig von der Gerätezeitzone), kurzer Hash und Link zum Lauf.

   **CI-Laufzeit** (Zeile unter der Ampel) – immer für den letzten *abgeschlossenen* Lauf „Build“ auf `main`
   (läuft gerade ein neuerer Lauf, steht dessen Vorgänger mit Lauf-Nr. da: „CI (Lauf #57): …“):
   `CI: <Gesamtdauer> · <Job › Schritt> <Dauer> / <Limit> min (<Prozent> %)  ▸ Details`, darunter ein schmaler Balken.
   „<Dauer> / <Limit> min (<Prozent> %)“ bricht nie in sich um: Passt der Block nicht mehr in die Zeile, rutscht er
   als Ganzes in die nächste.
   - *Knappster Schritt*: Für jeden Job des Laufs und jeden Schritt mit eigenem `timeout-minutes` wird
     Dauer / Limit berechnet; angezeigt wird der höchste Wert. Es gibt keine festen Job- oder Schrittnamen –
     wird der Browser-Test auf mehrere Jobs aufgeteilt, funktioniert die Anzeige unverändert.
   - *Farben*: unter 70 % grün, ab 70 % gelb, ab 90 % rot (gerechnet mit dem angezeigten, gerundeten Prozentwert).
   - *Limits* stammen aus der Workflow-Datei (`.github/workflows/build.yml`, Pfad aus der Workflow-Liste) am Commit
     des Laufs (`contents/…?ref=<head_sha>`). Ein kleiner eigener Leser holt nur `jobs.<schlüssel>.name`,
     `timeout-minutes` und `steps[].name` / `timeout-minutes`; Kommentare, Leerzeilen, Einrückung und Blocktexte
     (`run: |`) stören nicht. Zuordnung API-Job ↔ YAML-Job über `name` oder Schlüssel, auch mit `${{ … }}` im
     Namen; Matrix-Varianten („e2e (2)“) erben das Limit des Matrix-Jobs. Ohne Zuordnung oder ohne Limit:
     „Limit unbekannt“ (zählt nicht für den knappsten Schritt). Ohne `timeout-minutes` gilt hier *kein* Standardwert.
   - *▸ Details* (standardmäßig zu, Zustand wird nicht gespeichert): Balken der letzten 5 abgeschlossenen Läufe
     mit waagerechter Linie beim höchsten Job-Limit, dazu der Block „Knappster Schritt (letzter Lauf)“ mit Trend
     gegenüber dem ältesten der 5 Läufe. Das Dashboard merkt sich Dauern gesehener Läufe in `localStorage`
     (`aether.ciHistory`, höchstens 12 Läufe, nur Lauf-ID und Sekunden, ohne Token); ist der älteste Lauf dort nicht
     bekannt (oder der Eintrag hieß damals anders), entfällt der Trend.
     - *Balkenfarben nach Ausgang* (nur aus `conclusion` und `run_attempt` der Laufliste, keine weitere Anfrage):
       grün = beim ersten Mal erfolgreich (`success`, Versuch 1), gelb `#E8B54A` = nach Re-run erfolgreich
       (`success`, Versuch > 1), rot = fehlgeschlagen/abgebrochen (`failure`, `cancelled`, `timed_out`,
       `startup_failure`), grau = sonstige Ergebnisse (`neutral`, `skipped`, `stale`, `action_required`, …).
       Die Prozentfarben des knappsten Schritts sind davon unabhängig.
     - *Gesamtdauer*: ohne Re-run `run_started_at` → `updated_at`; bei Re-runs die Zeit, in der Jobs aller Versuche
       liefen (ohne Wartezeit dazwischen). Ist sie für einen der älteren Läufe unbekannt (meist ältere Re-runs),
       werden dessen Jobs einmalig mit `filter=all` nachgeladen und mit derselben Rechnung ermittelt; das Ergebnis
       bleibt dauerhaft in `aether.ciHistory` (abgeschlossene Läufe ändern sich nicht). Höchstens 4 solche
       Anfragen pro Laden, im Normalfall keine. Scheitert eine oder fehlen Daten: kurzer Stummel in der Statusfarbe
       mit „Dauer ?“, keine Fehlerkarte; beim nächsten Laden wird es erneut versucht.
     - *Beschriftung*: der Wert steht 2 px über dem Balken. Würde er die Limit-Linie oder ihren Text berühren
       (Zone 2 px unter bis 17 px über der Linie), steht er innerhalb des Balkens oben in dunkler Schrift –
       direkt unter der Linie, wenn sie durch den Balken läuft; ist dafür kein Platz (unter 19 px), über der Linie.
     - *Versuchs-Hinweis* beim knappsten Schritt eines Re-runs: Bei „Re-run failed jobs“ führt GitHub nicht neu
       gestartete Jobs in der Jobliste des neuen Versuchs mit neuer ID, neuem `run_attempt` und neuem `created_at`,
       aber mit `started_at`/`completed_at` des Versuchs, in dem sie liefen. Erkennung: `started_at` vor
       `created_at` und gleiches Zeitfenster wie ein Job eines früheren Versuchs → „Lief in Versuch 1, in Versuch 2
       übernommen“; lief der Job wirklich im genannten Versuch → „Gemessen in Versuch x von n“. Ist der Versuch
       nicht sicher bekannt (nur die Kopie liegt vor), entfällt die Zeile.
   - *Zusätzliche API-Anfragen*: 3 pro Laden – `actions/workflows/{id}/runs?branch=main&status=completed&per_page=5`,
     `actions/runs/{id}/jobs` des letzten abgeschlossenen Laufs (`filter=latest`, bei Re-run `filter=all`) und die
     Workflow-Datei – plus höchstens 4 einmalige Nachlade-Anfragen (siehe oben). Gleicher 60-s-Cache wie die übrige
     Projektansicht; das automatische Nachladen eines laufenden Builds nutzt den Cache.
   - *Fehler* (API, Rate-Limit, Datei nicht lesbar): Statt der Zeile steht „CI-Laufzeit nicht verfügbar“, die Ampel und
     die anderen Teile bleiben unberührt. Offline zeigt die Projektansicht wie bisher nur ihren Hinweis.
2. **Zeitleiste** – gemergte PRs (`pulls?state=closed&base=main`) und Commits auf `main` (`commits?sha=main`),
   neueste zuerst, mit Titel, PR-Nummer, Datum/Uhrzeit und kurzem Hash. Merge- und Squash-Commits erscheinen als
   PR-Eintrag; Commits, die nur im PR-Branch lagen, werden ausgeblendet. Antippen öffnet den PR (bzw. Commit) auf GitHub.
   - *Dashboard-PRs*: Dazu kommen die gemergten PRs dieses Repos (`aether-dashboard`, öffentlich) aus
     `pulls?state=closed&base=main` – eine zusätzliche Anfrage, gleicher 60-s-Cache, Zeitlimit 15 s. Beide Repos stehen
     in **einer** Liste, sortiert nach Merge- bzw. Commit-Zeit (neueste zuerst). Dashboard-Einträge haben das
     Abzeichen „DB“ (türkis) und die Metazeile „Dashboard · PR #n  Datum, Uhrzeit  Hash“; Antippen öffnet den PR in
     `aether-dashboard` (neuer Tab). aether-Einträge sehen aus wie bisher.
   - *Nachladen*: Die aether-Einträge erscheinen, sobald sie da sind; die Dashboard-PRs werden danach eingemischt
     (bis dahin unter den Chips „Dashboard-PRs werden geladen …“, im Filter „Spiel“ ohne Hinweis), Filter und
     aufgeklapptes „Ältere anzeigen“ bleiben dabei erhalten; liegen sie im 60-s-Cache, erscheint die Liste in einem Schritt.
   - *Token*: Die Anfrage geht zuerst mit dem Token an `api.github.com`. Lehnt GitHub ab (401/403/404, z. B. weil das
     fine-grained Token nur `aether` freigibt), folgt genau einmal dieselbe Anfrage **ohne** Token; danach (bis zum
     Leeren des Speicher-Caches) gleich ohne. Das Token geht an keinen anderen Host, im Cache liegt nur die PR-Liste.
   - *Filter*: Chips „Alle | Spiel | Dashboard“ unter der Überschrift (Standard „Alle“, wird nicht gespeichert).
     „Spiel“ = Repo `aether` (PRs und Commits), „Dashboard“ = Repo `aether-dashboard`. „Ältere anzeigen (n)“ zählt
     und lädt die gerade gefilterte Liste.
   - *Fehler beim Dashboard-Repo*: Die aether-Einträge erscheinen trotzdem, darüber die Zeile „Dashboard-PRs nicht
     verfügbar“. Offline zeigt die Projektansicht wie bisher nur ihren Hinweis.
3. **Fortschritt** – `ROADMAP.md` aus dem Hauptverzeichnis von `main` (`contents/ROADMAP.md?ref=main`).
   Gelesen werden Abschnitte `## Name` und Punkte `- [x] Text` / `- [ ] Text`, optional mit `(PR #123)`.
   HTML-Kommentare werden ignoriert. Pro Abschnitt gibt es einen Balken erledigt/gesamt, PR-Verweise sind antippbar:
   - `(PR #31)` → PR im Repo `aether` (`https://github.com/konstantin9ezm/aether/pull/31`),
   - `(Repo aether-dashboard, PR #8)` → PR in diesem Repo (`https://github.com/konstantin9ezm/aether-dashboard/pull/8`),
   - `(Repo aether-dashboard)` ohne Nummer bleibt als Text stehen (kein Link).

   Leerzeichen um `#` sind erlaubt (`(PR # 13)`, `(Repo aether-dashboard, PR # 8)`), Groß-/Kleinschreibung ist egal.
   Andere Repos werden nicht erkannt und bleiben Text. Der Link heißt in beiden Fällen „PR #n“.
   Tolerant: Punkte vor dem ersten Abschnitt landen unter „Ohne Abschnitt“, unbekannte Abschnitte werden normal
   angezeigt, nicht erkannte Zeilen (Freitext, Tabellen, `###`, Listen ohne Kästchen …) werden übersprungen und gezählt.
   Der Inhalt wird nur als Text eingesetzt, nie als HTML.
4. **Engine-Karte** – aus `engine-map.json` in diesem Repo, Schichten von oben nach unten.

API-Antworten werden 60 Sekunden im Speicher gehalten (die Workflow-ID 30 Minuten), „Aktualisieren“ lädt sofort neu.
Fehlermeldungen gibt es für: kein Token, Token abgelehnt, fehlende Berechtigung (mit Name der nötigen Berechtigung),
Rate-Limit (mit Uhrzeit), keine Verbindung, fehlende `ROADMAP.md`, fehlenden Workflow und kaputte `engine-map.json`.

### `engine-map.json` bearbeiten

```json
{
  "schichten": [
    { "name": "Kern", "bausteine": [
      { "name": "Spielschleife", "detail": "60 Hz", "status": "fertig" }
    ] },
    { "name": "Plattform-Layer/RHI", "bausteine": [
      { "gruppe": "Renderer", "name": "Vulkan-RHI", "status": "geplant" }
    ] }
  ]
}
```

- Reihenfolge der `schichten` = Reihenfolge von oben nach unten.
- `status`: `fertig`, `vorschau` oder `geplant` (andere Werte werden als „unbekannt“ angezeigt).
- `detail` (z. B. Bibliothek) und `gruppe` (Unterzeile innerhalb einer Schicht) sind optional.
- Felder wie `$hinweis` werden ignoriert. Nach dem Merge auf `main` ist die Änderung live.

## Tools

Karte in der Projektansicht, zwischen der Zeile „Stand … · API … · Aktualisieren“ und der Build-Ampel (außerhalb
der übrigen Karten, deshalb auch offline sichtbar). Knöpfe im Stil von „Aktualisieren“, mindestens 44 × 44 px; reicht
die Breite nicht, rutschen sie in die nächste Zeile (kein waagerechtes Scrollen, geprüft von 320 bis 1400 px):

1. **Screen-Editor ›** – öffnet `screen-editor.html` im selben Fenster, auch offline (siehe unten).
2. **Messflug ›** – öffnet den Workflow `profile.yml` im Repo aether auf GitHub (neuer Tab,
   `rel="noopener noreferrer"`).
3. **Logo ›** – öffnet `logo.html` im selben Fenster, auch offline (siehe „Logo-Werkzeug“).
4. **Flyer ›** – öffnet `flyer.html` im selben Fenster, auch offline (siehe [Flyer & Infografiken](#flyer--infografiken)).
5. **WebGPU-Check ›** – öffnet `webgpu-check.html` im selben Fenster (das Symbol in der Kopfzeile bleibt).

Offline sind „Messflug“ und „WebGPU-Check“ ausgegraut mit „nur online“ (GitHub ist nicht erreichbar, der
WebGPU-Check liegt nicht in der App-Hülle). Kommt das Netz zurück, sind sie wieder aktiv. „Screen-Editor ›“, „Logo ›“
und „Flyer ›“ bleiben offline aktiv (ihre Seiten liegen in der App-Hülle).

## Screen-Editor

Werkzeug für die Menü-Screens des Spiels (Asteroiden vor dem Sternenhimmel, davor Logo und Menübox):
**https://konstantin9ezm.github.io/aether-dashboard/screen-editor.html**. Grundlage ist das frühere claude.ai-Artefakt
„Aether – Screens fürs Menü“ (Version 2); alle Funktionen sind geblieben. Oben steht „‹ Zum Dashboard“ (zurück zur
Projektansicht), weil die Home-Bildschirm-App keinen Zurück-Knopf hat.

**Bedienung**

- Asteroiden antippen und ziehen; die Leiste unter der Bühne wählt, ob Ziehen **verschiebt**, die **Tiefe** ändert
  oder **dreht**. Zwei Finger ändern Größe und Drehung. „Antippen auf freiem Himmel setzt einen neuen“,
  „Zufällig verteilen“, „Ränder füllen“, Regler für Größe, Entfernung, Drehen/Kippen/Rollen, Form, Farbe,
  Duplizieren, Ebenen (ein-/ausblenden, nur als Arbeitshilfe), mehrere Screens, Rückgängig (auch Strg/⌘+Z).
- **Anordnung:** Bühne, Draufsicht und Bedienelemente überlappen sich nie. *Untereinander* (Standard): Bühne,
  darunter die Leiste mit Griff und Umschalter, darunter der untere Bereich in voller Breite. *Nebeneinander*:
  Bühne links, senkrechte Trennleiste, unterer Bereich rechts – nur quer ab 1000 px Breite, sonst automatisch
  untereinander. Hochkant gibt es zusätzlich eine Trennleiste zwischen den Ansichten und dem Bedienfeld.
  Trennleisten ziehen ändert die Größen (Mindestgrößen: Bühne 120 px bzw. 280 px breit, unterer Bereich 100 bzw.
  220 px, Bedienfeld 140 px), Doppeltipp stellt den Standard her (am Griff auch Pfeiltasten und Pos1). Die
  Aufteilung wird auf dem Gerät gemerkt (`localStorage`, `aether.screenEditor.layout`). Der Schalter „Draufsicht“
  blendet den unteren Bereich aus; dann nutzt die Bühne die ganze Fläche.
- **Unterer Bereich:** *Draufsicht* (Kamera unten, Blick nach oben; antippen wählt, ziehen verschiebt in die Tiefe)
  oder *Vergleich*: vier kleine Bilder, so wie jedes Gerät den Screen zeigt, nach jeder Änderung neu (gedrosselt).
- **Vorschau ohne Hilfen** zeigt genau das unter „Vorschau als“ gewählte Format, mit Logo und Menübox, ohne
  Rahmen, Umrisse und Legende.
- **Legende** unter der Bühne (statt Beschriftungen auf der Bühne): nur Einträge für Rahmen und Kästen, die gerade
  sichtbar sind. „Rahmen der anderen Geräte“ steuert iPad, iPhone und 21:9 (16:9 ist immer da), „Umrisse“ die
  gestrichelten Kästen „Logo/Menübox“ (diese fehlen auch, solange „Logo und Menübox verschieben“ an ist – dann sind
  die Kästen orange – oder Logo und Menübox beide ausgeblendet sind).

**Formate und Regel C**

| Format | Größe | Sichtfeld senkrecht × waagerecht |
|---|---|---|
| 21:9 | 2560 × 1080 | 65,9° × 113,9° |
| iPhone quer | 874 × 402 | 65,9° × 109,3° |
| **16:9 · PC & Switch 2** (auch TV) | 1920 × 1080 | 65,9° × 98,1° |
| iPad quer | 1194 × 834 | 77,7° × 98,1° |

Hauptformat ist fest **16:9 · PC & Switch 2**. Regel C: *Das 16:9-Bild ist auf jedem Gerät vollständig sichtbar.*
Breitere Geräte sehen bei gleicher Höhe seitlich mehr, schmalere (iPad) die volle 16:9-Breite und oben/unten mehr.
Eine einzige Funktion `sicht(format)` rechnet das über die Kamera exakt um (Tangens des halben Sichtfelds:
`tanV = tan(65,9°/2) · max(1, (16/9) / A)`, `tanH = tanV · A`, A = Breite/Höhe); Bühne, Vorschau, Vergleich und
Bild-Export nutzen sie. Die Bühne zeigt die Fläche aller Formate zusammen (21:9-Breite × iPad-Höhe) mit den Rahmen
aller vier Formate (16:9 kräftig orange, iPhone violett, iPad grün, 21:9 blau); alles außerhalb von 16:9 ist
gedimmt, weil es nur manche Geräte zeigen. Logo und Menübox richten sich nach dem 16:9-Bereich: Maßstab = Höhe des
16:9-Bereichs in Punkten / 400, höchstens 1,6, Lage mittig im 16:9-Bereich. Das Logo nutzt die reduzierte Schrift
Jost Medium aus dem Spiel (eingebettet), die Menübox die Systemschrift.
Die Logo-Box zeigt das echte Spiel-Logo `game/assets/ui/logo.png` (eine API-Anfrage je Öffnen, gleicher Weg und
gleiches Token wie im Logo-Werkzeug, offline dessen gespeicherte Fassung `aether.logoPng`), mittig mit erhaltenem
Seitenverhältnis so groß wie die Box es zulässt, auch in Vergleich und Bild-Export; ohne Bild (kein Token, Fehler,
offline ohne gespeicherte Fassung) bleibt die Annäherung, mit dem Hinweis „Logo-Bild nicht geladen – Annäherung“
im Bedienfeld. Das Spiel-Logo kommt nie in die gespeicherten Screens. Jeder Screen kann stattdessen ein eigenes PNG
zeigen (siehe „Logo dieses Screens“); Box, Lage und Ziehen bleiben dabei gleich.

**Logo dieses Screens**

- Abschnitt im Bedienfeld direkt unter „Screen“: kleines Vorschaubild (dunkler Hintergrund, Seitenverhältnis
  erhalten), daneben Name und Maße – beim Standard „Spiel-Logo (Standard)“ / `game/assets/ui/logo.png`, bei eigenem
  PNG Dateiname / „eigenes PNG · B × H px · KB“. Knöpfe **„PNG laden …“** (Dateiauswahl vom Gerät, nur PNG; auf
  iPad/iPhone auch aus der Dateien-App) und **„Spiel-Logo verwenden“** (zurück zum Standard, ausgegraut beim
  Standard). Tippflächen ≥ 44 px, hochkant ohne waagerechtes Scrollen.
- Prüfung beim Laden: PNG-Signatur, erster Block `IHDR`, Breite/Höhe 1 … **4096 px** je Seite, Datei höchstens
  **5 MB**, Bild muss sich öffnen lassen. Sonst eine Meldung unter den Knöpfen (z. B. „Keine PNG-Datei – Screen
  unverändert“, „Datei zu groß (6 MB, höchstens 5 MB) – …“, „Bild zu groß (5000 × 100 px, höchstens 4096 px je
  Seite) – …“); der Screen bleibt unverändert.
- Das Bild passt sich mittig mit erhaltenem Seitenverhältnis in die Logo-Box ein (wie im Spiel) – auf der Bühne,
  im Vergleich und in „Als Bild sichern“, jeweils mit dem Logo des gezeigten Screens.
- **Speicher:** Die PNG-Bytes liegen unverändert in IndexedDB (Datenbank `aether.screenEditor.logos`, Ablage
  `logos`, Schlüssel = Verweis-ID), nicht in `localStorage`. Im Screen steht nur
  `logo: { art:'eigen', id, name, w, h, bytes }`; ohne `logo` gilt das Spiel-Logo. Ältere Screens ohne Angabe laden
  unverändert als Standard, eine unbrauchbare Angabe wird zum Standard. Fehlt ein Bild auf dem Gerät, zeigt der
  Screen das Spiel-Logo mit dem Hinweis „Eigenes Logo-Bild fehlt auf diesem Gerät – Spiel-Logo“.
- **Neu** = Standard, **Kopie** übernimmt den Verweis (beide Screens teilen sich das Bild). Nach Löschen, Ersetzen,
  „Spiel-Logo verwenden“ und „Alles ersetzen“ gibt der Editor Bilder frei, auf die kein Screen mehr verweist (beim
  Start nur, wenn gespeicherte Screens gelesen wurden). Ein eigenes PNG funktioniert offline.
- **Export/Import:** „Als Text kopieren“ nimmt das Bild bewusst nicht mit (der Text ist für den Chat gedacht; ein
  Logo als Base64 wäre schnell Hunderte KB). Screens mit eigenem PNG bekommen
  `logo: { art:'eigen', datei, breite, hoehe, bytes }`, der Dialog sagt deutlich, dass die Bilder auf dem Gerät
  bleiben. Beim Einfügen zeigen solche Screens das Spiel-Logo, mit Hinweis in der Meldung; vorhandene Screens behalten
  ihr Logo.

*Stand im Spiel (Repo aether, nur gelesen):* Das Spiel rechnet heute mit 65,9° senkrecht und **fester Höhe**
(`GlesPreviewRenderer.cpp`: `xScale = yScale · Höhe / Breite`), ein iPad sieht dort also weniger als 16:9; der
Menü-Maßstab ist `clamp(min(H/400, W/700), 1, 1,6)` über den ganzen Bildschirm (`PauseMenu.cpp`). Die Anpassung an
Regel C ist ein eigener Auftrag im Repo aether.

**Speichern, Export und Import**

- Gespeichert wird **nur auf diesem Gerät** (`localStorage`, Schlüssel `aether.screenEditor`); kein Konto, kein
  Token, keine Anfrage an api.github.com. Ist der Speicher gesperrt, läuft der Editor trotzdem (mit Hinweis).
- „Als Text kopieren“ liefert JSON im Format `aether-menue-screens`, **Version 3**: dazu `regel`, `hauptformat`
  („16:9“), `formate` (Größen und Sichtfelder), Kamera (Ursprung, Blick −Z, 65,9° senkrecht für 16:9) und je Screen
  Name, Sternen-Seed, Lage von Logo und Menübox (Punkte bei Maßstab 1) und Asteroiden (Position und Radius in Metern,
  Form 1–8, Drehung YXZ in Grad, Farbe). Das Hauptformat je Screen aus Version 2 entfällt.
- „Text einfügen“ liest Exporte der Versionen **1, 2 und 3** (Hinzufügen oder Alles ersetzen). Umrechnung: Kamera,
  Einheiten und Bezugspunkte sind in allen Versionen gleich, also bleiben Asteroiden und Lage unverändert; ein
  altes Hauptformat (iPhone, iPad, 16:9) wird zu 16:9 · PC & Switch 2. Was früher für ein breiteres Hauptformat am Rand
  lag, steht jetzt in der gedimmten Randfläche. Version 1 kannte keine Lage und kein Rollen: beides wird 0.
- **Als Bild sichern (alle Formate):** vier PNG in den Größen der Tabelle, ohne Hilfen (wie „Vorschau ohne
  Hilfen“), Namen `aether-screen-<Name>-<Format>.png` (`21x9`, `iphone-quer`, `16x9-switch2`, `ipad-quer`). In der
  Vorschau sichert „Als Bild sichern“ (oben rechts) genau das gezeigte Format. Weg: Teilen-Dialog
  (`navigator.share` mit Dateien, auf iPad/iPhone „Bild sichern“ in Fotos oder „In Dateien sichern“), sonst
  Download-Links, sonst ein Dialog mit den Bildern („Lange drücken und sichern“). Nur per Antippen/Klick (Nutzergeste),
  auch offline. Ausgeblendete Ebenen fehlen auch im Bild (z. B. Hintergrund ohne Logo).

**Lizenzen:** three.js r128 liegt unverändert als `vendor/three-r128.min.js` im Repo (npm `three@0.128.0`,
`build/three.min.js`, SHA-256 `9274bbce…1ce2`), MIT-Lizenz in `vendor/three-r128.LICENSE.txt`. Die Logo-Schrift
Jost (reduziert auf „Aether“) steht unter der SIL Open Font License 1.1 (`vendor/Jost-OFL.txt`).

**Testschnittstelle:** `window.AetherScreenEditor` (nur lesen: Formate, `sicht`, Kamera, Zustand, Rahmen,
Eckpunkte, Stand des Spiel-Logos und der eigenen Logos, Grenzen für PNG) für die automatischen Tests.

## Logo-Werkzeug

Seite `logo.html` (Kopfzeile „‹ Zum Dashboard“ und Titel „Logo“, wie der Screen-Editor). Sie zeigt das Spiel-Logo
und bietet es als Datei zum Sichern an, z. B. für Affinity.

- **Quelle:** `art/logo/logo.svg` im Repo aether, Zweig `main`, gelesen über die GitHub-API mit dem Token des
  Dashboards (nur gelesen, nie geschrieben, nie in einer Adresse). Je Öffnen zwei Anfragen, gleichzeitig:
  `contents/art/logo/logo.svg?ref=main` (roh) und `commits?sha=main&path=art/logo/logo.svg&per_page=1` (letzter
  Commit, der die Datei geändert hat). Zeitlimit 15 s wie in der Projektansicht; Fehlermeldungen wie dort. Unter dem
  Logo steht „Quelle: art/logo/logo.svg · Commit <Kurz-Hash> · geladen <Uhrzeit>“ (deutsche Zeit; an einem anderen
  Tag mit Datum).
- **Offline:** Die zuletzt geladene Fassung (SVG-Text, Commit, Zeitpunkt – ohne Token) liegt auf dem Gerät
  (`localStorage`, Schlüssel `aether.logo`). Ohne Netz (oder wenn GitHub nicht antwortet) zeigt die Seite sie mit
  dem Hinweis „Offline – zuletzt geladene Fassung“; ohne gespeicherte Fassung „Noch kein Logo geladen – einmal online
  öffnen.“ Ohne Token erscheint derselbe Hinweis wie in der Projektansicht („Kein Token gespeichert.“, Link zum
  Dashboard). Die Seite selbst liegt in der App-Hülle (`sw.js`, Cache `aether-shell-v1`); API-Antworten und das
  Token kommen nie in einen Cache.
- **Sicherheit:** Das SVG wird mit `DOMParser` gelesen; vor der Anzeige werden `script`, `foreignObject` (und andere
  Einbettungen wie `iframe`, `object`), alle `on*`-Attribute und jedes `href`/`src` entfernt, das nicht auf die Datei
  selbst (`#…`) oder ein eingebettetes Rasterbild (`data:image/png|jpeg|gif|webp;base64`) zeigt. Angezeigt wird nur
  als Bild (`img` aus einer Blob-URL), nie per `innerHTML`.
- **Anzeige:** links das Logo groß, darunter der Hintergrund „Dunkel“ (Standard) · „Hell“ · „Kariert
  (transparent)“ – nur zur Anzeige, nicht in den Dateien – und die Quellen-Zeile. Auf dem iPad quer (ab 900 px
  Breite, quer) zwei Karten nebeneinander, sonst untereinander; kein waagerechtes Scrollen, Tippflächen ≥ 44 × 44 px.
- **Ebenen:** Ring hinten, Schatten, Schrift, Ring vorne (Gruppen-IDs `ring-hinten`, `schatten`, `schrift`,
  `ring-vorne`), Standard alle an. Fehlt eine Gruppe in der Datei, ist ihr Schalter ausgegraut („fehlt in der
  Datei“). Ausblenden gilt für die Anzeige und das PNG.
- **Als Datei sichern:** „SVG sichern“ (Hauptknopf) gibt die Originaldatei unverändert mit allen Ebenen weiter
  (byte-gleich), Name `aether-logo-<hash>.svg`. „PNG sichern“: nur die sichtbaren Ebenen, transparenter Hintergrund,
  Breite 1024 / 2048 (Standard) / 4096 px, Seitenverhältnis wie im SVG (`viewBox`, sonst `width`/`height`), Name
  `aether-logo-<hash>-<breite>.png`. Weg wie „Als Bild sichern“ im Screen-Editor: Teilen-Dialog (`navigator.share`
  mit Datei, „In Dateien sichern“, Affinity …), sonst Download, sonst ein Dialog mit dem Bild („Lange drücken und
  sichern“); nur per Antippen (Nutzergeste), auch offline mit der gespeicherten Fassung. Damit der Teilen-Dialog
  innerhalb der Geste aufgeht, liegt die PNG-Quelle in der gewählten Größe vorab geladen bereit und wird beim
  Antippen synchron gezeichnet.

- **Im Spiel (PNG):** Unter der Karte „Arbeitsdatei (SVG)“ zeigt die Karte „Im Spiel (PNG)“ das Logo, wie das
  Startmenü es zeigt (`game/assets/ui/logo.png`, zwei weitere Anfragen: Datei roh und letzter Commit; Quellzeile mit
  Commit-Link, Maßen und Größe; „PNG sichern (Original)“ gibt die Datei byte-gleich weiter; offline die gespeicherte
  Fassung `aether.logoPng`; Fehler erscheinen nur in dieser Karte, die SVG-Karte arbeitet unabhängig weiter).

**Testschnittstelle:** `window.AetherLogo` (nur lesen: Zustand, Fassung, angezeigtes SVG, Ebenen; PNG-Zustand und -Maße).

### Logo-Editor (Stufe 1: Projekt + Schrift, Stufe 2: Ring)

Oben auf der Logo-Seite. Darunter liegen die Karten „Arbeitsdatei (SVG)“ und „Im Spiel (PNG)“ mit allen bisherigen
Funktionen als aufklappbare Karten (Standard: zugeklappt; Laden, Speicherschlüssel und Anfragen unverändert).

- **Bühne „Logo-Projekt“** mit „Rückgängig“, „Wiederholen“ (auch Strg/⌘+Z, Strg/⌘+Umschalt+Z), „Projekt sichern“
  und „Projekt laden“. Der Hintergrund-Schalter Dunkel/Hell/Kariert gilt für alle drei Bühnen.
- **Reiter „Schrift“:** Schriftart (acht Schriften, siehe unten), Stärke 100–900 (nicht vorhandene ausgegraut),
  Normal/Kursiv (ohne Kursiv ausgegraut; keine künstliche Schräge oder Verfettung), Buchstabenabstand −20…60 px,
  Farbverlauf (Standard #8C7CF0 links unten → #C4BBFF rechts oben, Farbwähler und Hex-Feld), Tiefe 0–40 px mit
  8 Richtungen (Kante = Verlauf mit 55 % Helligkeit), Umriss 0–10 px mit Farbe, Schatten/Leuchten mit Weichheit 0–30
  px. px gelten bei Schriftgröße 100. Wechselt man auf eine Schrift ohne die eingestellte Stärke/Kursiv, wird der
  nächste vorhandene Wert genommen (bei Gleichstand der schwerere) und kurz gemeldet. Text immer „Aether“.
- **Reiter „Ring“:** Schalter „Ring hinten“/„Ring vorne“ und der Ring per Regler. Der Ring wird nach der Rechnung
  des Spiels erzeugt (`game/src/Logo.cpp` im Repo aether, Stand b151e26, nach JavaScript übertragen: gleiche Formeln,
  gleicher Zufallsgenerator XorShift32, Rechnung in float wie im Spiel, Formen mit 6–8 Ecken und hellerer Facette,
  Farben, hintere Brocken zuerst). Mit den Standardwerten entsteht genau der Ring des bisherigen Spiel-Logos
  (`art/logo/logo.svg`: alle 150 Brocken auf 0,001 px gleich), Mitte auf der Mitte der Schrift, Schriftgröße 100.
  Die Arbeitsdatei wird dafür nicht mehr gebraucht. Regler (Startwerte = Spielwerte): Neigung (−45…45°, Schritt
  0,005 rad; 15,5°), Breite (Halbachse 80–300 px; 178), Höhe (Halbachse 5–120 px; 30), Anzahl Brocken (10–400;
  150), Brocken-Größe kleinster/größter Radius (0,2–15 bzw. 0,5–20 px; 1,1–7,5; der andere Regler folgt, damit
  kleinster ≤ größter), Lage des Kopfs (0–360°; 129° vorne links), Schweif-Länge (29–360°; 335°), Dichte am Kopf
  (Exponent der Verteilung 1–5; 2,3), Zufallswert (1 … 4 294 967 295, Textfeld, Übernahme mit Enter/Verlassen) mit
  „Neu würfeln“ und „Wie im Spiel (zurücksetzen)“ (alle Ring-Regler auf die Spielwerte, ein Schritt). Die Streuung
  quer zum Ring (0,085 → 0,03) hat keinen Regler.
- **Ring: „Ring (Regler) | Brocken bearbeiten“** (Umschalter im Reiter „Ring“). Im Modus „Ring (Regler)“ lässt sich
  auf der Bühne nichts anfassen. Im Modus „Brocken bearbeiten“ (nur dann `touch-action: none` auf der Bühne): Antippen
  wählt einen Brocken (orangefarbener Rahmen mit Eckgriffen, nur Anzeige), eine freie Stelle hebt die Auswahl auf,
  Ziehen verschiebt (Finger, Maus, Trackpad gleich), Regler „Größe“ (0,25–4 ×) und „Drehung“ (±180°), „Vor die
  Schrift“, „Hinter die Schrift“, „Löschen“ (Taste Entf; Backspace löscht nie), „+ Brocken setzen“ (danach auf eine
  Stelle tippen: eigener Brocken mit Form aus dem Zufallsgenerator, mittlerer Größe, vorne/hinten nach der Lage).
  Anzeige „Ausgewählt: Brocken <Nr.>“ (Nr. = `brocken-<Nr.>` im SVG) bzw. „Eigener Brocken“. Jede Aktion, jeder Zug
  ist ein Rückgängig-Schritt.
- **Einzeländerungen (E3):** je Brocken-Nummer in `einstellungen.brocken` (`dx`, `dy` = Versatz in Ring-Koordinaten,
  in Halbachsen; `groesse` = Faktor; `drehung` = Zusatzwinkel in Grad; `lage` = Vorrang vorne/hinten; `geloescht`);
  eigene Brocken in `einstellungen.eigene` (Lage in Ring-Koordinaten, Größe relativ zur mittleren Brocken-Größe).
  Neigung, Breite, Höhe und Brocken-Größe behalten die Änderungen (sie machen sie mit). Anzahl, Zufallswert, „Neu
  würfeln“, Lage des Kopfs, Schweif-Länge, Dichte und „Wie im Spiel“ verteilen den Ring neu: Gibt es Änderungen an
  Brocken des Rings, fragt die Seite vorher „Änderungen an Brocken des Rings verwerfen? Selbst gesetzte Brocken
  bleiben.“ (Verwerfen/Abbrechen; Esc = Abbrechen). Rückfrage und Änderung sind zusammen ein Schritt.
- **Ring-Sammlung** (Reiter „Ring“, ganz oben): Zeile „Ring:“ mit Auswahlliste der gespeicherten Ringe (erster
  Eintrag „– ungespeichert –“, solange der aktuelle Ring keinen Namen hat), Markierung „geändert“ und den Knöpfen
  „Speichern“ (überschreibt den gewählten Ring; ohne Namen wie „Speichern unter …“), „Speichern unter …“,
  „Umbenennen“, „Kopieren“ (Vorschlag „<Name> (Kopie)“; speichert den Ring, wie er gerade ist, unter neuem Namen und
  wählt die Kopie) und „Löschen“ (Rückfrage, Abbrechen vorgewählt). Darunter „Sammlung als Datei sichern“ und
  „Sammlung laden“. Ein Ring ist genau der Ring-Teil des Projekts: `ring` (Regler, Zufallswert), `brocken`
  (Einzeländerungen), `eigene` (eigene Brocken), `ringHinten`, `ringVorne` – keine Schrift, Farben, Hintergrund oder
  Ausgabe. Umschalten lädt den Ring sofort (ein Rückgängig-Schritt); bei ungespeicherten Änderungen am gewählten
  Ring fragt die Seite „Änderungen an „<Name>“ speichern?“ (Speichern/Verwerfen/Abbrechen, Abbrechen vorgewählt).
  Ein ungespeicherter Ring ohne Namen wird ohne Rückfrage ersetzt; Rückgängig holt ihn zurück. Namen: 1–40 Zeichen,
  Leerzeichen am Rand entfernt, keine doppelten (Groß-/Kleinschreibung egal), Fehler im Dialog. Höchstens 100 Ringe.
  Dialoge im Stil der Seite (kein `window.prompt`): Enter bestätigt, Esc und Backspace (außerhalb des Textfelds)
  schließen, im Namensfeld löscht Backspace nur Zeichen; Tastenkürzel der Seite sind bei offenem Dialog gesperrt.
  - Speicher: EINE Sammlung für alle Projekte in `localStorage` `aether.logoRinge`:
    `{ "format": "aether-logo-ringe", "version": 1, "gespeichert", "ringe": [{ "name", "gespeichert", "daten": {
    "ringHinten", "ringVorne", "ring", "brocken", "eigene" } }] }`. Kaputter Inhalt wird verworfen (Meldung), einzelne
    kaputte Einträge fallen weg. Das Projekt merkt sich nur den Namen des aktiven Rings im optionalen Feld
    `einstellungen.ringName` (Projektformat bleibt Version 2; ältere Fassungen ignorieren das Feld).
  - Datei: gleiches Format, Name `aether-logo-ringe-<JJJJMMTT-HHMM>.json`. Laden: vorhandene Ringe bleiben,
    gleichnamige bekommen „ (2)“, „ (3)“ …; die Anzahl übernommener Ringe wird gemeldet; falsches Format → Meldung,
    nichts geändert. Laden und Sichern der Sammlung ändern den Verlauf nicht.
- **Reiter „Ausgabe“:** „PNG sichern“ (transparent, nur sichtbare Ebenen, 1024/2048/4096 px) und „SVG sichern“
  (Schrift als Pfade, kein `<text>`, keine Schriftdatei; Gruppen `ring-hinten`, `schatten` bzw. `leuchten`, `tiefe`,
  `schrift`, `umriss`, `ring-vorne` je nach Inhalt; Verlauf als `linearGradient`, Weichheit als `feGaussianBlur`).
  Namen `aether-logo-projekt-<JJJJMMTT-HHMM>[-<breite>].png/.svg`. Weg wie bisher: Teilen-Dialog, sonst Download,
  sonst „Lange drücken“.
- **Ein Zeichenweg:** Eine Funktion baut aus Einstellungen, Schrift-Umrissen und Ring ein SVG. Die Bühne zeigt genau
  diesen Text, die SVG-Datei ist dieser Text, das PNG zeichnet ihn mit Pixelmaßen auf ein Canvas.
- **Schrift-Umrisse:** eigener kleiner Lader in `logo.html` (TTF/WOFF 1.0, `cmap`, `glyf`, `hmtx`, Kerning aus GPOS
  oder `kern`, WOFF entpackt mit `DecompressionStream`). Keine fremde Bibliothek; alle Schriften sind statisch je
  Stärke, also stimmt die Stärke exakt.
- **Projekt:** automatisch in `localStorage` `aether.logoProjekt` (klein, sofort gespeichert, offline und nach Neustart
  da). Die Projektdatei ist JSON `{ "format": "aether-logo-projekt", "version": 2, "text", "gespeichert",
  "einstellungen" }`; `einstellungen.ring` enthält die Ring-Regler. Projekte der Version 1 (ohne Ring) werden weiter
  geladen, der Ring hat dann die Spielwerte. Beim Laden: kaputte, fremde Datei oder andere Version → Meldung, Projekt unverändert; unbekannte
  Schrift → Jost mit Meldung; Werte außerhalb der Bereiche werden begrenzt. Laden ist ein Schritt im Verlauf.
  Der Verlauf hält 100 Schritte (nur im Speicher der Seite); ein Zug am Regler ist ein Schritt. Kein Token in
  Projekt, Speicher oder Cache.
- **Bedienung:** Regler mit `touch-action: none` (Ziehen scrollt die Seite nicht), Tippflächen ≥ 44 × 44 px. In den
  Hex-Feldern löscht Backspace nur Zeichen; außerhalb von Textfeldern schließt Backspace einen offenen Dialog.

**Testschnittstelle:** `window.AetherLogoEditor` (nur lesen: Zustand, SVG, Ebenen, PNG-Quelle, Verlauf, Ring mit
Brocken, Modus, Auswahl, Markierung, Bild→Bildschirm-Koordinaten).

## Schriften (Logo-Editor)

Acht Schriften für den Logo-Editor auf der Logo-Seite. Sie liegen im Repo unter `fonts/<name>/` (je Ordner der
Lizenztext `OFL.txt` aus der Quelle, Prüfsummen aller Dateien in `fonts/SHA256SUMS`), werden nur vom eigenen
Ursprung geladen (kein Google-Fonts-CDN, keine fremden Server) und liegen für den Offline-Start in der App-Hülle
(`sw.js`, Cache `aether-shell-v1`). Zusammen 72 Schriftdateien, ca. 1,4 MB. Alle sind statische Dateien je Stärke
und Stil (keine variablen Schriften), damit die gewählte Stärke in den Pfaden exakt stimmt.

| Name | Lizenz | Quelle | Version | Stärken | Kursiv | Reserved Font Name |
|---|---|---|---|---|---|---|
| Jost | SIL OFL 1.1 | npm `@fontsource/jost@5.3.0` (Teilsatz „latin“, WOFF) | 3.710 (Fontsource v20, 2025-09-10) | 100–900 | ja | nein |
| Exo 2 | SIL OFL 1.1 | npm `@fontsource/exo-2@5.3.0` (Teilsatz „latin“, WOFF) | 2.010 (Fontsource v26, 2025-09-02) | 100–900 | ja | nein |
| Orbitron | SIL OFL 1.1 | `googlefonts/orbitron-vf` @ `f164828` (`fonts/ttf/`, unverändert, TTF) | 2.001 | 400–900 | nein | ja („Orbitron“) |
| Rajdhani | SIL OFL 1.1 | npm `@fontsource/rajdhani@5.3.0` (Teilsatz „latin“, WOFF) | 1.201 (Fontsource v17, 2025-09-16) | 300–700 | nein | nein |
| Saira | SIL OFL 1.1 | npm `@fontsource/saira@5.3.0` (Teilsatz „latin“, WOFF) | 1.101 (Fontsource v23, 2025-11-18) | 100–900 | ja | nein |
| Space Grotesk | SIL OFL 1.1 | npm `@fontsource/space-grotesk@5.3.0` (Teilsatz „latin“, WOFF) | 2.000 (Fontsource v22, 2025-09-05) | 300–700 | nein | nein |
| Michroma | SIL OFL 1.1 | npm `@fontsource/michroma@5.3.0` (Teilsatz „latin“, WOFF) | 1.100 (Fontsource v21, 2025-09-05) | 400 | nein | nein |
| Audiowide | SIL OFL 1.1 | `google/fonts` @ `29b4ec6` (`ofl/audiowide/`, unverändert, TTF) | 1.003 | 400 | nein | ja („Audiowide“) |

Die Fontsource-Pakete 5.3.0 sind vom 19.07.2026. Orbitron und Audiowide haben einen Reserved Font Name; von ihnen
liegen nur die unveränderten Originaldateien im Repo (kein Teilsatz). Orbitron ist bei Google Fonts nur als
variable Datei verfügbar; die statischen Originale stammen aus dem Quell-Repo, das Google Fonts dafür angibt
(`ofl/orbitron/METADATA.pb`). Der Teilsatz „latin“ enthält die Buchstaben von „Aether“ (geprüft in den Tests).

## Flyer & Infografiken

Seite `flyer.html` (Kopfzeile „‹ Dashboard“ zurück zur Projektansicht `./#projekt`, Titel „Flyer & Infografiken“,
rechts der Stand). Sie zeigt die Dokumente eines Flyer-Pakets – Flyer (DIN A4) und Infografiken –, läuft offline,
prüft online auf eine neue Version und gibt Dokumente als PDF oder Bild weiter. Texte und Status lassen sich im Vollbild
selbst ändern (Teil 2): Die Änderungen liegen offline auf dem Gerät über dem übernommenen Paket, werden als neue
Paket-Fassung exportiert und von Hand im Repo aether hochgeladen – das Dashboard schreibt selbst nie in ein Repo.
Seit F3a gibt es **Versionen** (jede ein eigener, vollständiger Flyer), **Ordner** (als Kacheln, verschachtelt), **neue
Seiten** aus Vorlagen oder als Kopie, **Ausblenden** der Original-Seiten und den Export **„Grafiken & Daten“** (PNG, SVG,
CSV, JSON, ZIP); alles steht in derselben einen Paketdatei (Format v2, siehe unten).

**Bedienung**

- **Kopfzeile:** „offline bereit · Stand `<TT.MM.JJJJ>`“ (Paket liegt auf dem Gerät), „Stand `<TT.MM.JJJJ>` · nicht offline
  gespeichert“ (Speichern schlug fehl, z. B. ohne IndexedDB) oder „noch kein Paket“; solange es nicht exportierte
  Änderungen gibt, dazu „· `<n>` Änderungen nicht exportiert“ (bei einer: „· 1 Änderung nicht exportiert“; gezählt werden
  Text- und Status-Änderungen, der Stand folgt ihnen von selbst). Darunter die Paket-Zeile
  „`<Titel>` · Version `<version>` · `<n>` Dokumente“ (ohne `titel` im Paket „Flyer-Paket“); ohne Paket „Noch kein Paket –
  „Online prüfen“ oder „Paket importieren“.“
- **Ansehen:** Ordner der geöffneten Version als Kacheln (siehe „Ordner“ unten; die Kategorie-Chips früherer Fassungen
  entfallen) und darunter die Seiten des geöffneten Ordners („Alle“: jede Seite genau einmal). Kacheln sind die
  verkleinerte Live-Darstellung des Dokuments (per `transform` auf Kachelbreite skaliert) mit Id, Titel und Menü „···“.
  Antippen öffnet das **Vollbild**: Dokument auf Bildschirmbreite skaliert, oben „‹“, „n / Anzahl“, „›“, „Id · Titel“,
  „PDF“, „Bild“, „Export“ und „✕“. Blättern per ‹/›,
  Wischen (waagerecht, mindestens 50 px; nicht mit zwei Fingern oder hineingezoomt) oder ←/→, am Ende ohne Umlauf.
  Esc, Backspace oder ✕ schließen (Fokus zurück auf die Kachel); eine gehaltene Taste schließt nur einmal. Die Tasten
  wirken nur bei offenem Vollbild, nie solange ein Eingabefeld den Fokus hat (jedes `input` außer Knöpfen – `button`,
  `submit`, `reset`, `image`, `file` – und dem Kontrollkästchen, also auch Datum, Zeit, Zahl, Regler, Farbe und
  Auswahlknopf; dazu `textarea`, `select`, `contenteditable`, auch in Shadow Roots) und nie mit Cmd, Strg oder Alt.
- **Schriftanpassung** (jeder Flyer bei jeder Anzeige: Kachel, Vollbild, Druck, Bild; erst wenn die Paket-Schriften
  geladen sind, höchstens 5 s Wartezeit – kommen sie später doch noch, werden Kacheln, Vollbild und Druck mit der
  echten Schrift neu angepasst, „Text zu lang“ neu gesetzt und das Bild neu vorbereitet): `--s` ab 1,42 in Schritten
  von 0,02 verkleinern, solange `.body` überläuft
  (`scrollHeight > clientHeight + 1`), höchstens bis 0,80. Danach bekommt jedes `.fill` die Klasse `off`, wenn es
  niedriger als 90 px ist (`offsetHeight`, unabhängig von der Skalierung), sonst wird `off` entfernt. Läuft es bei
  0,80 noch über, steht „Text zu lang“ an Kachel und Vollbild.
- **PDF:** „PDF“ im Vollbild (ein Dokument) und „Alle als PDF (n)“ („Alle“: alle Flyer der geöffneten Version; sonst alle
  Dokumente des geöffneten Ordners; ausgeblendete Seiten nie) öffnen den Druckdialog (`window.print`, dort „Als PDF sichern“; iPad: Teilen-Menü).
  Je Flyer genau eine A4-Seite ohne Rand (`@page{size:A4 !important;margin:0 !important}`, gegen `@page`-Regeln des
  Pakets); Infografiken werden per `zoom` auf Seitenbreite skaliert und dürfen über mehrere Seiten gehen. Die
  `@media print`-Regeln des Paket-CSS gelten. Die Seite fügt im Druck nur Seiten-Container hinzu (Lage, Größe,
  Seitenumbruch, `contain:paint` als Rahmen) – keine `box-shadow`, kein `background-clip:text`, kein `filter`, keine
  Verläufe mit Transparenz (die PDF-Ansicht von iPhone/iPad zeichnet so etwas als Fläche). Drucken
  ohne Knopf (Strg+P, Teilen-Menü → Drucken) bereitet über `beforeprint` das offene Vollbild-Dokument vor, sonst die
  gezeigte Liste.
- **Bild:** PNG des offenen Dokuments in doppelter Auflösung (Flyer 1588 × 2246 px), Name `aether-<Id>.png`. Ohne
  Bibliothek: SVG mit `foreignObject` (als `data:`-URL) → Bild → Canvas → PNG, die Schriften (`fonts/…`) als
  `data:`-URL eingebettet. Das Bild wird beim Öffnen und Blättern vorbereitet und beim Antippen synchron gezeichnet
  (sonst „Einen Moment – das Bild wird vorbereitet“). Über 16 777 216 Pixel (Canvas-Grenze von Safari auf iPhone/iPad)
  wird es proportional verkleinert, mit Meldung. Weg wie im Logo-Werkzeug: Teilen-Dialog (`navigator.share` mit Datei),
  sonst Download, sonst ein Dialog „Lange drücken und sichern.“; nur per Antippen (Nutzergeste), auch offline.
- **Online prüfen:** siehe unten. Kein Token oder offline: nur ein kleiner Hinweis, kein Fehler; die Seite läuft mit
  dem gespeicherten Stand.
- **Paket importieren:** Dateiauswahl ohne `accept` (sonst graut iOS die Datei in der Dateien-App aus); den Inhalt
  prüft die Seite selbst. Erfolg: „Paket importiert (Version `<version>`, `<n>` Dokumente)“, das gespeicherte Paket wird
  ersetzt; Banner und „Aktuell …“ der Online-Prüfung gehörten zum vorigen Paket, deshalb wird danach neu geprüft. Kein
  JSON, falsches Format, fehlerhaftes oder zu neues Paket → Fehlerbox, nichts überschrieben.

**Versionen, Ordner und Seiten (F3a)**

- **Versionen:** Knopf „Version `<n>` ▾“ (dazu Versions-Ordner und Seitenzahl) öffnet die Tafel „Versionen“: Versions-Ordner V1, V2 … (aus
  der ersten Zahl; V1 enthält 1.1, 1.2 …), die offene Version orange mit „aktuell“, ausgeblendete abgeblendet. Der Flyer
  von heute ist Version 1.1 in V1. „+ Neue Unterversion“ kopiert die gewählte (sonst die offene) Version in die nächste
  freie Unterversion ihres Versions-Ordners (höchste + 1: aus 1.1 wird 1.4, wenn es 1.2 und 1.3 gibt), „+ Neue
  Hauptversion“ in den nächsten Versions-Ordner (`<n>.1`). Jede Version ist ein eigener, vollständiger Flyer (Seiten,
  Ordner, Texte, Status, Ausblendungen); Änderungen in einer Version ändern keine andere. Menü „···“ je Version:
  Öffnen, Beschreibung (höchstens 80 Zeichen), Ausblenden/Einblenden, Löschen (mit Rückfrage; 1.1 nie). Welche Version
  offen ist, merkt sich jedes Gerät selbst (IndexedDB, Ablage `geraet`; nicht im Paket), anfangs 1.1. Neue Kopien
  bekommen die Beschreibung „Kopie von `<x.y>`“.
- **Ordner** (Kacheln wie in der Dateien-App, Variante B der Vorschau): Pfad „Alle › … “ mit „‹“ (eine Ebene zurück,
  in „Alle“ gesperrt) und Seitenzahl; Ordner-Kacheln mit Name, „`<n>` Seiten · `<m>` Ordner“ und Menü „···“, auf
  schmalen Geräten 2 je Reihe; „+ Neuer Ordner“ legt im geöffneten Ordner an (Name per Textfeld, Vorschlag „Neuer
  Ordner“, höchstens 60 Zeichen, nicht leer, kein doppelter Name im selben Elternordner – auch nicht in anderer
  Schreibweise). Menü „···“: Öffnen, Umbenennen, Verschieben (nie in sich selbst oder einen eigenen Unterordner),
  Löschen (mit Rückfrage; die Seiten bleiben und verlieren nur diese Zuordnung, Unterordner wandern eine Ebene hoch).
  Eine Seite kann in mehreren Ordnern liegen. Aus den Kategorien eines Pakets v1 werden die Ordner der Version 1.1.
  Kennungen `O<n>`, nie wiederverwendet. Backspace (nicht in einem Textfeld) = eine Ebene zurück.
- **Neue Seiten:** „+ Seite“ öffnet die Tafel „Neue Seite“ (Zielordner = geöffneter Ordner): Vorlagen „Leer“, „Titel +
  Text“, „Liste mit Status“, „Kennzahlen“, „Zwei Kästen“; „Bild / Video“ ist sichtbar, aber ausgegraut („ab F3b“); oder
  „Kopie einer bestehenden Seite …“. „Anlegen“ öffnet die neue Seite im Vollbild; befüllt wird sie mit „Text“ und
  „Status“ wie jede andere. Vorlagen tragen dieselben Markierungen wie das Paket (`data-t`, `data-s`/`data-status`,
  `data-block`/`data-zaehler` mit Zähler, `data-stand`, `<ae-t>`) und dasselbe Aussehen (Klassen der Flyer im Ordner:
  Hintergrund, Logo oben links, Marke = Ordnername oben rechts, Fußzeile mit Kennung und Stand), sodass Text-,
  Status-, Zähler- und Datumslogik ohne Sonderfälle greifen. Neue Seiten heißen „Neue Seite (`<Vorlage>`)“, Kopien
  „`<Titel>` (Kopie)“ (mit dem Stand, den die Quelle gerade zeigt); Kennungen `N<n>`, nie wiederverwendet (der Zähler
  steht in der Version). Freies Verschieben von Elementen kommt erst mit F3c.
- **Menü „···“ einer Seite:** Öffnen, Kopie anlegen (in denselben Ordnern), Umbenennen (nur der Name der Kachel,
  höchstens 120 Zeichen; der Inhalt bleibt), In Ordner … (Ankreuzliste aller Ordner der Version, eingerückt nach Ebene,
  mehrere möglich, wirkt sofort), Grafiken & Daten exportieren, bei Original-Seiten „Ausblenden“/„Einblenden“ (und
  „Löschen (nur eigene Seiten)“ gesperrt), bei eigenen Seiten „Löschen“ (mit Rückfrage).
- **Ausblenden:** Die Original-Seiten lassen sich nie löschen, nur ausblenden. Ausgeblendete Seiten fehlen in den
  Kacheln, in „Alle als PDF“, in den Zählungen und im ZIP der Version; unten schaltet „Ausgeblendete zeigen (`<n>`)“ sie
  (abgeblendet, mit Marke „ausgeblendet“) wieder ein.
- **Tafeln** (Versionen, Neue Seite, Menüs, Grafiken & Daten) liegen über Seite und Vollbild und stapeln sich („‹“
  zurück, „✕“ schließt alle). Esc schließt, Backspace geht eine Tafel zurück – beides nicht in Textfeldern (dort löscht
  Backspace Zeichen, Esc geht zurück).

**Bibliothek (F3b)** – zweiter Reiter „Seiten | Bibliothek“ neben der Versionswahl, Zusatz „gilt für alle Versionen“
(eine gemeinsame Bibliothek für alle Versionen; das Gerät merkt sich den Reiter).

- **Aufbau:** Pfad „Bibliothek“ mit „‹“ (Backspace geht einen Ordner zurück, außer in Textfeldern), „+ Hinzufügen“,
  „Medien online“, Filter „Version: Alle ▾“ (jede Version und „nicht verwendet“; eine Version zeigt die Dateien, die in
  ihren Seiten vorkommen), belegter und freier Platz (`navigator.storage.estimate`), Ordner-Kacheln (Name, Zahl der
  Dateien, Menü „···“: Öffnen, Umbenennen, Verschieben, Löschen – die Dateien bleiben, Unterordner wandern nach oben),
  „+ Neuer Ordner“, darunter die Datei-Kacheln (Mini-Bild, bei Videos Spieldauer, bei Animationen „GIF“, Name,
  Art · Größe, Status-Punkt). Ordner wie bei den Seiten: verschachtelt, eine Datei in mehreren Ordnern, getrennt von
  den Seiten-Ordnern (Kennungen `mo<n>`). Auf der obersten Ebene „Zuletzt hinzugefügt“ (höchstens 12) und „Weitere ohne
  Ordner“ (Dateien ohne Ordner, die nicht schon dort stehen).
- **Status je Datei:** grün „online“ (eine Datei mit derselben Git-Blob-SHA liegt in `aether-medien/medien/`), orange
  „nur Gerät“, grau „Flyer“ (Grafik aus „Aus Flyern“). Die Git-Blob-SHA (SHA-1 über `blob <Größe>\0` + Inhalt) rechnet
  das Gerät selbst – bis 64 MiB mit Web Crypto, darüber stückweise mit eigenem SHA-1 (eine große Datei liegt so nie ganz
  im Speicher).
- **„Aus Flyern“** (Marke „nur lesen“): alle Grafiken der Seiten der gewählten Version (Filter-Version, bei „Alle“ die
  geöffnete), nach Seite gruppiert – dieselbe Erkennung wie der Export „Grafiken & Daten“ (am echten Paket 227 Grafiken).
  Nicht löschbar; „Als eigene Datei übernehmen“ macht eine benennbare PNG-Datei daraus („<Seite> · <Grafik-Art>“,
  `herkunft` „flyer-kopie“ mit Seite und Grafik-Nummer).
- **„+ Hinzufügen“:** Ziel = geöffneter Ordner. „Aus Fotos“ (Datei-Eingabefeld mit `accept="image/*,video/*"` – auf
  iOS bietet das die Fotos-Mediathek an), „Aus Dateien“ (Endungen, öffnet die Dateien-App), beide mit Mehrfachauswahl,
  und „Grafik aus einem Flyer“ (Seite → Grafik). Beim ersten Hinzufügen fragt die Seite `navigator.storage.persist()` an.
  Je Datei: Format prüfen, Annahme bis 500 MB, Platz prüfen, SVG bereinigen (DOMParser, ohne Skripte, Handler, fremde
  Verweise), Maße und Dauer lesen, Startbild aus der ersten Sekunde (bei 1 s, kürzere Videos in der Mitte) und Mini-Bild
  erzeugen, Git-Blob-SHA. Name = Dateiname ohne Endung (umbenennbar). Die Tafel „Hinzugefügt“ zeigt je Datei die
  tatsächliche Größe, den Hinweis über 25 MiB bzw. den Grund einer Ablehnung – nichts wird still gekürzt oder abgelehnt.
- **Formate:** Fotos JPG, PNG, WebP, HEIC (Vorschau nur, wo der Browser HEIC kann; sonst „Vorschau in diesem Browser nicht
  möglich“), Grafiken SVG (nur als Bild), Videos MP4, MOV, WebM (Hinweis, wenn der Browser das Format nicht abspielt),
  Animationen GIF, animiertes WebP und APNG (am Inhalt erkannt, laufen wie Bilder in Schleife).
- **Größen:** Über 25 MiB (26 214 400 Bytes; genau 25 MiB ist noch ohne) steht an der Kachel und in „Medien online
  stellen“ „Zu groß für den Upload im Browser (GitHub: höchstens 25 MiB je Datei) – bleibt vorerst nur auf diesem Gerät.“
  Angenommen wird bis 500 MB je Datei (500 MiB), wenn der Platz reicht (frei mindestens Größe + 5 % + 10 MB, sonst
  „Nicht genug Speicher auf diesem Gerät …“). Vermutung (bisheriger Stand des WebKit-Blogs „Updates to Storage Policy“,
  2023 – webkit.org war bei der Umsetzung nicht erreichbar): seit Safari 17 gilt ein Kontingent je Ursprung als Anteil
  der Festplatte (Chromium ebenso), 500 MB reichen also meist; am Gerät noch nicht mit 500 MB geprüft (siehe Grenzen).
- **Menü einer Datei:** großes Vorschaubild bzw. Player, Kenndaten (Art, Maße, Dauer, Größe, Status), Abspielen bzw.
  Ansehen, Umbenennen (nur der Name in der Bibliothek; der Dateiname im Repo bleibt), In Ordner … (Ankreuzliste), In Seite
  einsetzen … (Seiten der offenen Version aus der Vorlage „Bild / Video“ oder „Neue Seite mit diesem Medium“ im
  aktuellen Seiten-Ordner), Herunterladen / Teilen (wie beim Bild), „Bearbeiten (ab F3d)“ ausgegraut, Löschen. Die
  Rückfrage beim Löschen nennt die Seiten (`Version · Kennung`), die danach „Medium fehlt (m<n>)“ zeigen, und – wenn die
  Datei online ist –, dass sie im Repo aether-medien bleibt, bis man sie dort selbst löscht.
- **Player** (Bibliothek und Seiten): eigene Steuerleiste – Abspielen/Pause, Zeit „0:12 / 0:42“, Zeitleiste zum
  Springen, Ton an/aus, Schleife, Tempo 0,5×/1×/1,5×/2×, Vollbild (iPad: Vollbild des Players, iPhone: Vollbild des
  Videos) –, `playsinline`, Tippflächen ≥ 44 px auch in einer verkleinert dargestellten Seite, Leertaste
  Abspielen/Pause außerhalb von Textfeldern. Standard: Ton an, Schleife aus, Autostart aus. Ein Video wird erst beim
  Abspielen gelesen (`preload="none"`, Object-URL aus dem Geräte-Speicher, sonst online nachladen); Object-URLs werden
  freigegeben, sobald der Player weg ist.
- **Vorlage „Bild / Video“** (freigeschaltet): Titel, Untertitel, ein Medium (16:9) und der Kasten „Zu sehen“ mit Text.
  Im Vollbild neuer Modus „Medium“ neben „Ansehen | Text | Status“ (nur bei solchen Seiten): Medium wählen, Startbild
  (Zeitpunkt, erzeugt das Startbild neu), Ton aus, Schleife, Autostart – Autostart nur zusammen mit „Ton aus“ (Browser
  starten Videos von selbst nur stumm), sonst ein Hinweis. In der Seite steht nur der Verweis:
  `<div class="medium" data-medium="m<n>" … data-ton="aus" data-schleife="an" data-autostart="an">` – nie der Inhalt.
  Fehlt die Datei: Platzhalter „Medium fehlt (m<n>)“. PDF, „Bild“ und Grafik-Export zeigen bei Videos das Startbild, bei
  Animationen das erste Bild.
- **„Medien online stellen“** (Knopf „Medien online“): alle Dateien „nur Gerät“ mit dem Dateinamen im Repo und der
  Größe, Summe, Hinweis über 25 MiB. „Alle sichern“: eine ZIP aller Dateien bis 25 MiB („stored“; CRC vorab stückweise,
  Inhalte als Blob-Teile, nichts doppelt im Speicher) bis zusammen 512 MiB, darüber die Dateien einzeln (ein
  Teilen-Dialog mit allen Dateien, sonst Herunterladen je Datei). „Upload-Seite öffnen“:
  `https://github.com/konstantin9ezm/aether-medien/upload/main/medien`. Anleitung: 1) „Alle sichern“ → in der Dateien-App
  ablegen (ZIP vorher in der Dateien-App entpacken) · 2) Upload-Seite öffnen · 3) Dateien hineinziehen bzw. auswählen,
  Nachricht `Medien <JJJJ-MM-TT>.<n> [skip ci]` · 4) „Commit changes“ · 5) danach wie gewohnt „Paket exportieren“ und
  das Paket ins Repo aether hochladen (das Paket kennt Dateinamen und Prüfsummen). Danach „Online prüfen“: grün.
- **Online-Abgleich** (im Ablauf von „Online prüfen“, beim Start, beim online-Ereignis und alle 10 Minuten – nur, wenn
  die Bibliothek Dateien hat): `GET /repos/konstantin9ezm/aether-medien/contents/medien?ref=main` (bei 404 zusätzlich
  `GET /repos/konstantin9ezm/aether-medien`: Repo da → noch nichts online), Inhalte per
  `GET …/git/blobs/<sha>` mit `Accept: application/vnd.github.raw+json` (roh, nicht als Base64 im JSON; CORS geht wie
  beim Paket). Zeitlimit für die Antwort wie alle Anfragen (15 s), für den Inhalt danach 15 s plus 2 s je MiB. Jeder
  geladene Inhalt wird per Git-Blob-SHA geprüft und kommt in den Geräte-Speicher. Beim Prüfen werden nur fehlende Dateien
  bis 5 MiB nachgeladen, größere beim Öffnen bzw. Abspielen. 401, 403 und 404 gelten gleich als „kein Zugriff“: einmal
  „Kein Zugriff auf aether-medien – Repo anlegen bzw. den Token um das Repo erweitern“ (und dauerhaft in der Bibliothek),
  danach keine automatischen Versuche mehr, bis „Online prüfen“ ausdrücklich gedrückt wird; alles andere läuft weiter.
- **Offline:** Bibliothek, Player und Seiten mit Medien laufen mit allem, was im Geräte-Speicher liegt (Status aus der
  zuletzt gelesenen Liste); fehlende Dateien zeigen „offline nicht verfügbar“.
- **Safari:** Außerhalb der Home-Bildschirm-App (`display-mode: standalone` bzw. `navigator.standalone`) steht bei
  Dateien „nur Gerät“ dauerhaft „Nur auf diesem Gerät: in Safari können Daten nach einigen Tagen ohne Besuch gelöscht
  werden – Home-Bildschirm-App nutzen oder online stellen“. Vermutung (bisheriger Stand des WebKit-Blogs, 2020; nicht
  nachgeprüft, webkit.org war nicht erreichbar): Safari löscht Website-Daten wie IndexedDB nach 7 Tagen Browser-Nutzung
  ohne Besuch der Seite; Home-Bildschirm-Apps sind davon ausgenommen.

**Repo aether-medien (einmalig einrichten):** Auf GitHub ein **privates** Repo `konstantin9ezm/aether-medien` anlegen
(mit README, damit es einen Zweig `main` gibt) und darin den Ordner `medien/` (entsteht beim ersten Upload über die
Upload-Seite). Den vorhandenen Fine-grained-Token des Dashboards um dieses Repo erweitern (Repository access: auch
aether-medien; Permissions: Contents „Read-only“ – keine Schreibrechte). Das Dashboard liest nur; hochgeladen wird per
Hand über die GitHub-Weboberfläche (höchstens 25 MiB je Datei). Medien liegen nie im Repo aether-dashboard und nie im
Paket.

**Export „Grafiken & Daten“ (F3a)** – „Export“ im Vollbild bzw. „Grafiken & Daten exportieren“ im Menü „···“ öffnet die
Tafel für die Seite: „Alle Grafiken als PNG“, „Alle Grafiken als SVG“, „Daten als CSV“, „Daten als JSON“, „Einzeln
wählen“ (Raster mit Mini-Bildern, Mehrfachauswahl, Umschalter PNG | SVG, „Auswahl herunterladen (`<n>`)“) und „Alles als
ZIP (`<n>` Seiten)“. Der Knopf „Grafiken & Daten exportieren“ oben in der Übersicht erstellt das ZIP der ganzen geöffneten
Version (mit Fortschritt, „Abbrechen“; am Ende „ZIP sichern“).

- **Grafik** = automatisch erkanntes Element der Seite (Regel am echten Paket festgelegt): Kandidaten sind Kästen
  (`[data-block]`, `.blk`, `.box`, `.quote`, `.cd`), Gruppen (`.flow4`, `.states`, `.forms`, `.stepper`, `.rm`,
  `.legend`), Kennzahlen (`.st`, `.stats3`), Balken (`.bars`, `.stack`, `.budget`, `.gantt`, `.chart`, `.codebar`) und
  Bilder (`svg`, `img`, `[role=img]`, z. B. das Logo). Es zählt nur der äußerste Kandidat (keiner seiner Vorfahren ist
  selbst einer), mindestens 24 × 24 px und nicht in einem ausgeblendeten Füllbild (`.fill.off`). Art: Bild-Element ab
  200 × 80 px „bild“, kleiner „symbol“; Balken (auch darin, oder `.stepper`) „balken“; `.forms`/`.legend` „symbol“;
  Kennzahlen (auch darin) „kennzahlen“; sonst „kasten“. Am echten Paket: 227 Grafiken auf 38 Seiten (3 bis 12 je Seite).
- **PNG:** derselbe Weg wie „Bild“ (SVG mit `foreignObject` → Canvas, doppelte Auflösung, Änderungsschicht), aus dem Bild
  der ganzen Seite ausgeschnitten – Hintergrund wie auf der Seite.
- **SVG:** SVG-Elemente als echte SVG (die berechneten Stile aus dem Paket-CSS werden eingesetzt, Schriften als
  `data:`-URL eingebettet, wenn Text vorkommt); das Logo (Hintergrund aus einer `data:`-SVG) als genau diese SVG.
  HTML-Kästen: Eine saubere SVG bräuchte einen eigenen Layout-Umsetzer (Umbruch, Schriften, Rahmen, Verläufe); darum
  sind sie SVG mit eingebettetem HTML (`foreignObject`, ganze Seite, `viewBox` auf den Kasten) – die Tafel sagt das
  ausdrücklich: „nur im Browser genau, in Grafikprogrammen evtl. nicht“.
- **CSV:** UTF-8 mit BOM, Trenner „;“, Zeilenende CRLF, Spalten `version;seite;kennung;art;wert;status` (art = `text` |
  `status` | `zaehler` | `stand`; Kennungen wie beim Bearbeiten: `t<n>`, `s<n>`, `zaehler<n>`, `stand<n>`), Werte, wie
  die Seite sie zeigt (Basis + Änderungsschicht; beim Status ist `wert` der Text des Punkts). Anführungszeichen nur, wo
  nötig (`;`, `"`, Zeilenumbruch, Leerraum am Rand).
- **JSON:** `{ "format": "aether-flyer-daten", "formatVersion": 1, "paketFassung", "version", "seite", "titel", "art",
  "breite", "hoehe", "eintraege": [{ "kennung", "art", "wert", "status" (Zähler zusätzlich "fertig", "laeuft",
  "gesamt") }], "grafiken": [{ "nr", "art", "x", "y", "breite", "hoehe", "png", "svg", "svgArt" }] }`.
- **Dateinamen** (nur ASCII): `<version>_<kennung>_<nn>_<art>.png` bzw. `.svg`, Daten `<version>_<kennung>.csv`/`.json`;
  mehrere Dateien einer Seite als `<version>_<kennung>_png.zip`, `…_svg.zip` bzw. `…_auswahl.zip` (eine Datei direkt), die
  Version als `aether-flyer_<version>.zip` mit einem Ordner je Seite (ausgeblendete Seiten nicht). ZIP ohne Bibliothek
  (`flyer-zip.js`: Methode „stored“, CRC-32). Am echten Paket ist das ZIP der Version etwa 47 MB groß (PNG 18,4 MB,
  SVG 28,5 MB).
- **Weitergabe** wie bei PDF und Bild: Teilen-Dialog (iPad: „In Dateien sichern“), sonst Download, sonst ein Dialog
  mit Link – immer im Antippen, darum bereitet die Tafel alles vorher vor („Grafiken werden erkannt und vorbereitet …“).

**PowerPoint-Export** – jede Seite als Bild auf einer Folie (Variante a). „Alle als PowerPoint (`<n>`)“ steht in der
Übersicht direkt neben „Alle als PDF (`<n>`)“, „PowerPoint“ im Vollbild zwischen „Bild“ und „Export“ (gleicher Stil).
Ein Tipp öffnet direkt unter dem Knopf die Auswahl „A4 hochkant | 16:9 quer“; die zuletzt gewählte Variante ist
hervorgehoben (beim ersten Mal „A4 hochkant“) und wird nur auf diesem Gerät gemerkt (IndexedDB `aether-flyer`, Ablage
`geraet`, Schlüssel `pptxFormat`). Antippen einer Variante startet den Export; Esc, Backspace oder Tippen daneben schließt
die Auswahl ohne Export (Pfeile wechseln die Variante, Enter startet, Tab schließt; Tippflächen ≥ 44 px).

- **Seitenwahl:** „Alle als PowerPoint“ nimmt genau dieselben Seiten wie „Alle als PDF“ (`AetherFlyerExport.druckListe`):
  in „Alle“ die Flyer der geöffneten Version, in einem Ordner alle seine Seiten (auch Infografiken), ausgeblendete nie;
  `<n>` zählt wie dort. „PowerPoint“ im Vollbild exportiert nur die angezeigte Seite (eine Folie). Reihenfolge der
  Folien = Reihenfolge der Ansicht.
- **Formate** (eine Datei hat ein Format für alle Folien): „A4 hochkant“ 21,0 × 29,7 cm; „16:9 quer“ 33,867 × 19,05 cm
  (PowerPoint-Breitbild). Das Seitenbild wird vollständig eingepasst und mittig gesetzt, der Rest der Folie ist
  Hintergrund in Seitenfarbe `#0c0f1d` (Richtwert). Flyer füllen die A4-Folie (bis auf Rundung), auf 16:9 stehen sie auf
  voller Höhe (ca. 40 % der Fläche); Infografiken mit eigener Höhe stehen in beiden Formaten auf voller Folienhöhe.
- **Bild:** dieselbe Darstellung wie „Bild“ (Änderungsschicht, doppelte Auflösung, über 16,7 Mio. Pixel verkleinert),
  als JPEG Qualität 0,92 auf Grund in Seitenfarbe; Seiten mit Video oder Animation zeigen das Standbild wie PDF/Bild.
- **Notizen** jeder Folie: `Seite: <Id>`, `Titel: <Titel>`, `Stand: <Stand der Seite>` (Text des ersten
  `data-stand`-Elements der Darstellung, sonst der Stand des Pakets). Das Bild hat „<Id> · <Titel>“ als Alternativtext.
- **Dateiname:** `Aether-Flyer_Version-<Version>_<Alle|Ordnername>_<A4|16x9>_<JJJJ-MM-TT>.pptx`, im Vollbild
  `Aether-Flyer_Version-<Version>_<Seiten-Id>_<A4|16x9>_<JJJJ-MM-TT>.pptx` (Datum des Geräts). Ordnernamen werden
  dateisicher (Ä/Ö/Ü/ä/ö/ü/ß → Ae/Oe/Ue/ae/oe/ue/ss, Akzente weg, Leerraum → „-“, sonstige Zeichen entfallen), z. B.
  „Spiel & Über“ → `Spiel-Ueber`.
- **Ablauf:** Folien werden nacheinander gezeichnet (Fortschritt „Folie 7 / 30“ im Knopf, beide PowerPoint-Knöpfe so
  lange gesperrt); jedes JPEG wird sofort ein Blob-Teil der Datei und das Canvas freigegeben – nie alle Bilder
  gleichzeitig als Pixel im Speicher (iPad). Fehler kommen als Meldung („Die PowerPoint-Datei ließ sich nicht erstellen
  – Seite S1: …“). Weitergabe wie bei PDF/ZIP: Teilen-Menü mit der Datei (MIME
  `application/vnd.openxmlformats-officedocument.presentationml.presentation`), sonst Download. Ist die Nutzergeste
  nach dem Zeichnen verbraucht (iPhone/iPad verlangen sie fürs Teilen; bei vielen Folien der Fall), erscheint ein kurzer
  Hinweis „Fertig: … Folien · … MB“ mit „Teilen“ – ein Tipp öffnet dann das Teilen-Menü. Offline, kein Upload, kein
  fremder Dienst.
- **Datei:** eigener kleiner Schreiber ohne Bibliothek (`flyer-pptx.js`, Office Open XML auf Basis von `flyer-zip.js`,
  Methode „stored“): `[Content_Types].xml`, `_rels/.rels`, `docProps/core.xml` und `app.xml`, `ppt/presentation.xml`,
  Folienmaster mit einem leeren Layout, zwei Themes (Folien, Notizen), Notizenmaster, je Folie `slide<n>.xml`,
  `notesSlide<n>.xml` und `media/image<n>.jpeg` samt Beziehungen. Geprüft im Container mit python-pptx 1.0.2
  (Folienzahl, Foliengröße, Bildlage, Notizen) und LibreOffice headless (Umwandlung in PDF); dass PowerPoint (Windows,
  Mac, iPad) und Keynote sie öffnen, ist noch am Gerät zu prüfen.
- **Am echten Paket** („Alle“, 30 Folien): je Format 10,6 MB, ca. 16 s in Chromium (Desktop), größte Folie 0,41 MB,
  keine Seite verkleinert.
- **Grenzen:** Der Text auf den Folien ist **nicht bearbeitbar** (ein Bild je Folie); bearbeitbarer Text wäre
  Variante b (später, nach F3c). Auf dem Beamer steht A4 hochkant mit Rand links und rechts, auf 16:9 ist die Seite
  deutlich kleiner. PowerPoint-Knöpfe gibt es nur, wenn „Bild“ in diesem Browser möglich ist (Selbstprobe).

**Bearbeiten (Teil 2)** – nur im Vollbild, Umschalter „Ansehen | Text | Status“ (Standard „Ansehen“, Tippflächen ≥ 44 px;
beim Schließen des Vollbilds zurück auf „Ansehen“). In „Ansehen“ verhält sich alles wie oben (Wischen, Tasten).

- **Text:** Antippen eines Textes (`data-t`) öffnet unten eine Leiste mit mehrzeiligem Feld (vorbelegt mit dem aktuellen
  Text), „Übernehmen“, „Abbrechen“ und „Original“ (zurück auf den Wert des Pakets, Eintrag gelöscht). Cmd/Strg+Enter =
  Übernehmen, Esc = Abbrechen (das Vollbild bleibt offen). Solange das Feld den Fokus hat, blättern ←/→ nicht und
  Backspace löscht nur Zeichen. Leerer Text ist erlaubt. Der Text wird immer als Text eingesetzt (Textknoten, nie HTML);
  steht im Element ein `<ae-t>`, kommt er dorthin (übrige Gestaltung bleibt); enthält es weitere Markierungen, bleiben
  diese stehen und nur sein eigener Text wird ersetzt. Zeilenumbrüche nur, wenn das Element im Paket schon `<br>` hat
  (dann als `<br>`), sonst werden sie zu Leerzeichen. Während ein neues Paket übernommen wird (Abgleich bis zum
  Basiswechsel), sind Eingaben kurz gesperrt („Gerade wird ein neues Paket übernommen.“).
- **Status:** Antippen eines Listenpunkts (`data-s`) öffnet die Auswahl fertig (`ok`) · läuft gerade (`run`) · als
  Nächstes (`next`) · geplant (`plan`) · ohne Status (Attribut entfernt). Statuslinien und Legendenpunkte folgen über das
  Paket-CSS, Zähler und Balken sofort.
- Geänderte Stellen sind nur in „Text“ und „Status“ markiert (gestrichelte Unterlinie in Akzentfarbe), nie in „Ansehen“,
  Kacheln, Druck und Bild. Nach jeder Änderung wird gespeichert und das Dokument neu dargestellt (Kachel und Vollbild,
  samt Schriftanpassung und „Text zu lang“; die Bildlaufposition im Vollbild bleibt). „Dokument zurücksetzen“ (mit
  Rückfrage) nimmt alle Änderungen des offenen Dokuments zurück.
- **Zähler und Balken** (nach jeder Darstellung neu, Regel wie im echten Paket): Ein Block ist das nächste Element
  mit `data-block` um die Überschrift `data-zaehler` (im Paket Attribute ohne Wert; mit Wert gehören alle Elemente mit
  diesem `data-block`-Wert zum Block). y = Listenpunkte (`data-s`) im Block, x = davon `ok`. Der Zähler ist ein
  `<span class="zaehler">x von y fertig</span>` als letztes Kind des `data-zaehler`-Elements – das Paket-CSS zeigt den
  Balken nur mit `[data-zaehler]:has(> .zaehler)`. **Darstellung** (Kachel, Vollbild, Druck/PDF, „Alle als PDF“, Bild):
  Der Zähler wird sofort angelegt, sobald mindestens ein Listenpunkt des Blocks einen Status hat (`ok`, `run`, `next`
  oder `plan`, aus dem Paket oder aus der Änderungsschicht). Blöcke ganz ohne Status bekommen keinen Zähler, nirgends
  steht dort „0 von y fertig“. **Export**: unverändert, der Zähler wird nur angelegt, wenn ein Listenpunkt des Blocks
  einen eigenen Status hat (Änderungsschicht). Ein unverändertes Paket wird also bitgenau exportiert. Steht der Zähler
  schon im Paket (z. B. nach Export und Import), wird er immer neu berechnet. Am echten Paket (38 Dokumente, 51 Blöcke)
  zeigen so 2 Blöcke einen Zähler (beide in IG-Technik-2), vorher 0. 48 der 50 Status-Punkte liegen außerhalb von
  Blöcken.
  `--anteil` = x/y und `--anteil-laeuft` = run/y (auf vier Nachkommastellen, y = 0 → 0) stehen am Zähler-Element; das
  Paket-CSS zeichnet „läuft“ von `--anteil` bis `--anteil` + `--anteil-laeuft`. Eine vorhandene Stelle „x von y“ im Text
  eines Zählers wird ebenso ersetzt, ein leeres Zähler-Element bekommt „x von y fertig“; eine Überschrift mit eigenem
  Text wird nie überschrieben.
- **Stand:** Elemente mit `data-stand` (nur reiner Text, ggf. `<ae-t>`/`<br>`; Kennung `stand1`, `stand2` … in
  Dokumentreihenfolge) zeigen nach einer Änderung am Dokument das heutige Datum: `kurz` = `TT.MM.JJJJ`, `lang` =
  „`T. Monat JJJJ`“ – wie im echten Paket (Flyer kurz, Infografiken lang; ein vorhandenes Datum im Text wird ersetzt,
  der Rest bleibt). „Original“ der letzten Änderung bzw. „Dokument zurücksetzen“ nimmt den Stand zurück.
- **Paket exportieren:** Paket = Basis + Änderungen (Markierungen bleiben; unveränderte Dokumente wörtlich, geänderte
  über `DOMParser` neu geschrieben), `version` „`<JJJJ-MM-TT>.<n>`“ (heute; n = 1 bzw. eins mehr als die höchste bekannte
  Fassung desselben Tags aus Basis, letzter Online-Prüfung und früheren Exporten), `stand` = heute, Dateiname immer
  `aether-flyer-paket.json`. Seit F3a stehen alle Versionen darin (Format v2, siehe unten), es bleibt bei einer Datei.
  Besteht das Ergebnis `AetherFlyerPaket.pruefe` nicht oder fehlte eine Markierung: Fehlerbox, nichts wird ausgegeben.
  Ab 20 MB erscheint ein deutlicher Hinweis (die GitHub-Weboberfläche nimmt nach Angabe ca. 25 MB je Datei – nicht
  nachgeprüft); gekürzt oder still geteilt wird nie. Gemessen am echten Paket: v2 mit 1 Version 416 331 Bytes, mit
  4 Versionen 1 200 876 Bytes. Weitergabe wie beim Bild (Teilen-Dialog, sonst Download – die Blob-URL wird nach 60 s
  freigegeben –, sonst ein Dialog mit Link; scheitert das Teilen, kommt wie beim Bild der Dialog). Erst nach erfolgreicher
  Weitergabe (bzw. Antippen des Links im Dialog) gelten alle Änderungen als exportiert (Kopfzeile ohne Zusatz). Die Hilfe
  zeigt die zuletzt exportierte Fassung auch nach dem Neuladen.
- **Online stellen** (aufklappbare Hilfe, mit F3a unverändert – weiter genau eine Datei): 1) „Paket exportieren“ (Fassung wird angezeigt), 2) Link öffnen
  <https://github.com/konstantin9ezm/aether/upload/main/docs/flyer>, 3) Datei `aether-flyer-paket.json` auswählen
  (ersetzt die alte), 4) Commit-Nachricht „Flyer-Paket `<Fassung>` [skip ci]“ (Knopf „Kopieren“), 5) „Commit directly to
  the main branch“, „Commit changes“. „[skip ci]“ startet keinen CI-Lauf und kostet nichts.
- **Abgleich** bei jeder Übernahme eines neuen Pakets R (online „Laden“, erstes Online-Laden, Import), genau einmal und
  idempotent, für jeden Eintrag e mit r = Wert in R: r = e.neu → Eintrag entfällt; r = e.alt oder r = e.exportiert →
  Eintrag bleibt, alt := r; Stand: das spätere Datum gewinnt; sonst – auch wenn die Stelle in R fehlt – Konflikt
  (fehlt in R das ganze Dokument, entscheidet seit F3a der Abgleich der Struktur, siehe unten). Konflikte: Banner „`<n>` Konflikte …“ → Liste mit Dokument-Id und Titel, Basis-Wert, eigenem Wert und neuem
  Online-Wert, je Konflikt „Meins behalten“ (Eintrag bleibt, alt := r) oder „Online übernehmen“ (Eintrag entfällt). Bis
  zur Entscheidung gilt der eigene Wert. Stand-Einträge ohne verbleibende Änderung im Dokument fallen weg. Texte,
  Status und Stand werden je Version abgeglichen.
  **In einem Schritt:** Ändert der Abgleich die Schicht, speichert die Seite die angeglichene Schicht und die neue Basis
  in **einer** IndexedDB-Transaktion über `basis` und `aenderungen` (`AetherFlyerSpeicher.speichereBasisUndAenderungen`,
  in der Reihe der Schicht-Speichervorgänge). Scheitert sie, bleiben beide gespeichert und auf der Seite auf dem alten
  Stand, und die Übernahme meldet „Speichern fehlgeschlagen. … Es wurde nichts übernommen; das bisherige Paket bleibt.“
  (derselbe Fehlerweg wie bei einem fehlerhaften Paket). Ohne IndexedDB läuft die Seite wie bisher nur ohne
  Offline-Speicher. Ändert der Abgleich die Schicht nicht, wird wie bisher nur die Basis gespeichert.
- **Abgleich der Struktur (F3a):** Versionen, Ordner und Seiten (Dasein, Name/Titel, Beschreibung, Eltern, Ordner,
  Ausblenden, HTML) werden je Feld mit drei Ständen verglichen – Basis, lokal, online: lokal = online →
  fertig; lokal = Basis → online wird übernommen; online = Basis → lokal bleibt; sonst Konflikt (bis zur Wahl gilt lokal).
  Löscht die andere Seite etwas, das lokal geändert ist (auch Texte/Status darin), oder ändert sie etwas lokal Gelöschtes,
  wird das zum Konflikt statt still zu verschwinden; ebenso ein fehlender Ordner, auf den verwiesen wird, und Ordner-Kreise.
  Die Zähler für neue Kennungen nehmen das Maximum. Strukturkonflikte stehen in derselben Liste („Lokal behalten“ |
  „Online übernehmen“); verschwindet die offene Version online, öffnet die Seite wieder 1.1.
- **Änderungen sichern / einspielen / verwerfen:** „Änderungen sichern“ gibt `aether-flyer-aenderungen.json` weiter
  (`{ "format": "aether-flyer-aenderungen", "version": 3, "paketFassung", "versionNummer", "gesichert", "eintraege": [ … ],
  "struktur": [ … ] }`; je Eintrag zusätzlich `ver` = Versionsnummer, `struktur` = geänderte Struktur-Felder der offenen
  Version mit altem und neuem Wert – neue, kopierte, umbenannte, verschobene und ausgeblendete Seiten und Ordner kommen
  so mit zurück). F3b (Sicherung `version` 3): `struktur` enthält zusätzlich die Metadaten der Bibliothek (Felder
  `M|*|<id>|…`, `MO|*|<id>|…`, `Z|*`), nie die Datei-Inhalte – die gehen über „Medien online stellen“ bzw. „Alle sichern“
  (die Meldung nach dem Sichern sagt das). Sicherungen `version` 1 und 2 werden weiter gelesen (v1 gilt für die offene
  Version). Sichern und Verwerfen wirken auf die offene Version; „Alle Änderungen verwerfen“ lässt die Bibliothek
  unverändert. Der Abgleich der Bibliotheks-Metadaten mit der Online-Datei folgt denselben Regeln wie die Struktur
  (Konfliktliste mit „Lokal behalten“ / „Online übernehmen“, z. B. „Datei m4 · … (Bibliothek)“).
  „Änderungen einspielen“ (Dateiauswahl ohne `accept`) prüft den Inhalt selbst (Format, Version, Feldtypen, höchstens
  5 MB und 20 000 Einträge, nur Text-Werte) und ordnet die Einträge wie beim Abgleich gegen die aktuelle Basis ein;
  vorhandene eigene Einträge gehen vor, Widersprüche kommen in die Konfliktliste. Falsches Format oder zu neue Version
  ändern nichts (Fehlerbox). „Alle Änderungen verwerfen“ fragt vorher nach.

**Online-Datei:** `docs/flyer/aether-flyer-paket.json` im Repo aether (`konstantin9ezm/aether`, Zweig `main`), gelesen
über die GitHub-API mit dem Token des Dashboards (`localStorage` `aether.githubToken`, nur gelesen) über `githubApi` aus
`gemeinsam.js`, Fehlertexte wie im Logo-Werkzeug. Nur lesende GET-Anfragen, jede mit Zeitlimit 15 s (danach
abgebrochen), nie zwei Prüfungen gleichzeitig.

1. Ordnerliste `contents/docs/flyer?ref=main` (kleine JSON-Antwort). 404 → „Noch keine Online-Version.“ (kein Fehler).
   Fehlt die Datei, liegen dort aber andere `.json`-Dateien: „In docs/flyer liegt keine Datei mit genau dem Namen
   aether-flyer-paket.json (gefunden: …)“.
2. sha der Datei gleich dem des gespeicherten Pakets → „Aktuell (Version `<version>`) · geprüft `<HH:MM>` Uhr“, nichts
   geladen. Ist die sha schon aus einer früheren Prüfung samt Version bekannt, entscheidet die Seite ohne Download –
   außer bei einem importierten Paket mit derselben Version (das kann genau diese Datei sein: dann wird geladen und
   verglichen). Sonst lädt sie die Datei (`contents/…`, `Accept: application/vnd.github.raw+json`, geht auch über 1 MB)
   und prüft das Format.
3. Ohne lokales Paket wird sie sofort übernommen („Paket geladen (Version …)“) – außer es wurde inzwischen eines
   importiert (auch wenn dessen Speichern noch läuft): Dann bleibt der Import, und die Online-Fassung wird wie unten
   angeboten. Sonst Banner „Neue Version online: `<version>` (Stand `<TT.MM.JJJJ>`)“ mit „Laden“; ist sie älter als das
   gespeicherte Paket (Vergleich Datum, dann Zähler n der Version `JJJJ-MM-TT.n`): „Online liegt eine ältere Version
   (`<version>`)“ mit „Trotzdem laden“. Laden ersetzt das gespeicherte Paket. Gleicher Inhalt wie das gespeicherte Paket
   (z. B. vorher importiert): kein Banner, nur die sha wird übernommen.
   „Laden“ übernimmt genau die angebotene Fassung: Liegt sie nicht schon im Speicher (Banner nach Neuladen ohne
   Download), wird sie über ihren sha geladen (`git/blobs/<sha>`, raw – nicht „was gerade auf main liegt“); gibt es sie
   nicht mehr, prüft die Seite neu. Vor dem Übernehmen vergleicht sie noch einmal mit dem gespeicherten Paket: Ist die
   Online-Fassung inzwischen älter (z. B. neueres Paket importiert), erscheint „Online liegt eine ältere Version …“ mit
   „Trotzdem laden“, statt sie zu übernehmen.
4. Wann: beim Öffnen, per „Online prüfen“, beim `online`-Ereignis und alle 10 Minuten, solange die Seite offen ist.
5. Hinweise statt Fehler: „Ohne Token keine Online-Prüfung – gezeigt wird der gespeicherte Stand.“ (dann keine
   API-Anfrage) und „Offline – gezeigt wird der gespeicherte Stand.“ (auch bei Zeitlimit). Token abgelehnt oder fehlende
   Rechte: Fehlerbox mit „Token eingeben ›“. Kaputte Online-Datei: „Online-Datei ist kein gültiges Flyer-Paket.“; zu neu:
   „Paket zu neu: Online-Version `<version>` braucht ein neueres Dashboard.“ – beide Male bleibt das gespeicherte Paket.

**Paket-Format v2** (seit F3a; hier nur Platzhalter): eine Liste von Versionen statt Kategorien und Dokumenten. Die
Export-Fassung (`version` `<JJJJ-MM-TT>.<n>`) bleibt der Stempel des ganzen Pakets.

```json
{
  "format": "aether-flyer-paket", "formatVersion": 2, "version": "2026-11-20.1", "stand": "2026-11-20", "titel": "…",
  "css": { "flyer": "<CSS>", "infografik": "<CSS>" },
  "versionen": [
    { "nummer": "1.1", "beschreibung": "", "ausgeblendet": false, "zaehler": { "seite": 1, "ordner": 1 },
      "ordner": [{ "id": "kat1", "name": "…", "eltern": null }, { "id": "O1", "name": "…", "eltern": "kat1" }],
      "seiten": [
        { "id": "F1", "art": "flyer", "titel": "…", "herkunft": "original", "vorlage": null, "ordner": ["kat1"], "ausgeblendet": false, "breite": 794, "hoehe": 1123, "html": "<section class=\"page …\">…</section>" },
        { "id": "N1", "art": "flyer", "titel": "Neue Seite (Leer)", "herkunft": "eigen", "vorlage": "leer", "ordner": ["O1"], "ausgeblendet": false, "breite": 794, "hoehe": 1123, "html": "…" }
      ] }
  ]
}
```

- Version: `nummer` „x.y“ (ganze Zahlen ab 1, eindeutig; 1.1 ist Pflicht und darf nicht leer sein), `beschreibung`,
  `ausgeblendet`, `zaehler` (höchste vergebene Kennung `N<n>`/`O<n>`), `ordner` (`id` eindeutig, `eltern` null oder ein
  Ordner derselben Version, kein Kreis), `seiten` (Felder wie die Dokumente in v1 ohne `kategorie`, dazu `herkunft`
  „original“ | „eigen“ – eigene Seiten heißen `N<n>` mit n ≤ `zaehler.seite` –, `vorlage` (null oder Text), `ordner`
  (Liste von Ordner-ids), `ausgeblendet`).
- Unbekannte Felder bleiben auf jeder Ebene erhalten (oben, je Version, je Ordner, je Seite).
- **Feld `medien` (F3b, optional, oben im Paket – gilt für alle Versionen; nur Metadaten, nie Inhalte):**

  ```json
  "medien": {
    "zaehler": { "datei": 2, "ordner": 1 },
    "ordner": [{ "id": "mo1", "name": "Videos", "eltern": null }],
    "dateien": [
      { "id": "m1", "name": "…", "ordner": ["mo1"], "art": "video", "mime": "video/mp4", "groesse": 18874368,
        "breite": 1920, "hoehe": 1080, "dauer": 42, "datei": "platzhalter-video_m1.mp4",
        "gitSha": "<40 Hex-Zeichen>", "herkunft": "eigen", "startbild": 1, "erstellt": "2026-11-20T17:42:00.000Z" },
      { "id": "m2", "name": "S1 · Kennzahlen", "ordner": [], "art": "grafik", "mime": "image/png", "groesse": 12000,
        "breite": 640, "hoehe": 200, "dauer": null, "datei": "s1-kennzahlen_m2.png", "gitSha": "<40 Hex-Zeichen>",
        "herkunft": "flyer-kopie", "quelle": { "version": "1.1", "seite": "S1", "grafik": 2 }, "startbild": null, "erstellt": "…" }
    ]
  }
  ```

  `id` `m<n>` bzw. `mo<n>` (n ≤ Zähler, nie wiederverwendet), `name` ≤ 120 Zeichen, `art` foto | video | animation |
  grafik, `groesse` in Bytes, `dauer`/`startbild` in Sekunden, `datei` = Dateiname im Repo aether-medien (nur ASCII:
  `<name-als-slug>_<id>.<endung>`), `gitSha` = Git-Blob-SHA-1 des Inhalts. Fehlerhafte Medien werden mit Fundstelle
  abgelehnt. **`formatVersion` bleibt 2:** Der F3a-Stand liest ein Paket mit diesem Feld weiter (unbekannte Felder
  bleiben erhalten; per Test mit dem Code von `aed37d7` geprüft).
- **Umwandlung v1 → v2** (beim Import, Online-Laden und für gespeicherte Pakete, verlustfrei): eine Version 1.1 ohne
  Beschreibung; jede Kategorie wird ein Ordner (gleiche id, Reihenfolge des Pakets, doppelte id: die erste gilt); jedes
  Dokument eine Original-Seite im Ordner seiner Kategorie, das HTML bytegleich (am echten Paket: alle 38 Seiten
  pixelgleich dargestellt wie vorher). Gespeichert bleibt die Basis so, wie sie kam (v1 oder v2).
- Pakete `formatVersion` 1 werden weiter gelesen; `formatVersion` > 2: „Paket zu neu“ („… diese Seite kennt Version 2 …“).
- Ältere Dashboard-Fassungen (vor F3a) lesen ein Paket v2 nicht („Paket zu neu“).

**Paket-Format v1** (wird weiter gelesen; hier nur Platzhalter):

```json
{
  "format": "aether-flyer-paket", "formatVersion": 1, "version": "2026-11-17.2", "stand": "2026-11-17", "titel": "…",
  "css": { "flyer": "<CSS>", "infografik": "<CSS>" },
  "kategorien": [{ "id": "kat1", "name": "…" }],
  "dokumente": [
    { "id": "F1", "art": "flyer", "kategorie": "kat1", "titel": "…", "breite": 794, "hoehe": 1123, "html": "<section class=\"page …\" style=\"--s:…\">…</section>" },
    { "id": "I1", "art": "infografik", "kategorie": "kat1", "titel": "…", "breite": 1080, "hoehe": null, "html": "<section class=\"ig …\">…</section>" }
  ]
}
```

- `format` muss genau „aether-flyer-paket“ sein (sonst „Kein Aether-Flyer-Paket.“). Pflicht sind `formatVersion` (ganze
  Zahl ab 1), `version` (Text), `stand` (Datum `JJJJ-MM-TT`), `css` (Objekt; `flyer`/`infografik` als Text),
  `kategorien` (Liste von `{ id, name }`) und `dokumente` (mindestens eins; `id` eindeutig, `art` „flyer“ oder
  „infografik“, `kategorie`, `titel`, `breite` > 0, `hoehe` > 0 oder `null`, `html`). `titel` des Pakets ist optional.
  Sonst „Paket fehlerhaft.“ mit dem Grund (z. B. „Dokument 3: art fehlt“).
- `formatVersion` > 2: „Paket zu neu“ („Das Paket hat formatVersion n; diese Seite kennt Version 2. Bitte das Dashboard
  aktualisieren.“), nichts wird überschrieben. Unbekannte Felder werden ignoriert (sie bleiben im gespeicherten Paket).
- Flyer: Wurzel `<section class="page …" style="--s:<Wert>">`, 794 × 1123 px, Inhalt in `.body`; `--s` skaliert die
  Schrift, `.fill` ist ein Füllbild. Infografik: Wurzel `<section class="ig …">`, 1080 px breit, Höhe frei.
- Das Aussehen kommt allein aus dem Paket-CSS (die Seite baut nichts nach und überschreibt nichts). Es verweist mit
  `fonts/jost/…` auf die Schrift Jost (liegt in `fonts/jost/` und in der App-Hülle).
- Markierungen im HTML – bleiben in Darstellung und Export erhalten; bearbeitet werden sie wie oben beschrieben:

  | Markierung | Bedeutung |
  |---|---|
  | `data-t="t<n>"` | editierbarer Text, eindeutig je Dokument |
  | `<ae-t>` | Textstück ohne eigene Gestaltung |
  | `data-s="s<n>"` mit `data-status` | Status-Element; `ok`, `run`, `next` oder `plan` (fehlt = ohne Status) |
  | `data-block` mit `data-zaehler` | Block mit abhakbaren Listeneinträgen und seine Überschrift |
  | `data-stand="kurz"` / `"lang"` | Datum des Dokuments |

**Speicher:** IndexedDB `aether-flyer`, Version 4, mit den Ablagen `basis` (Schlüssel `aktuell`: `{ paket, quelle:
'online'|'import', sha, uebernommen }`, das zuletzt übernommene Paket) und `online` (Schlüssel `stand`: `{ sha, version,
stand, geprueft }`, die zuletzt bekannte Online-Datei) und – seit Teil 2 – `aenderungen` (je Eintrag Schlüssel
`e:<dok>\n<art>\n<k>`: `{ dok, k, art, alt, neu, exportiert, zeit, konflikt }`, dazu `meta`: `{ exporte }`, die bisher
exportierten Fassungen) und – seit F3a – `struktur` (Schlüssel `lokal`: `{ paket, konflikte, exportiert }`, der lokale
Stand aller Versionen im Format v2, offene Strukturkonflikte und die Prüfwerte des letzten Exports) und `geraet`
(Schlüssel `version`: die offene Version dieses Geräts). Die Migration 1 → 2 legt nur `aenderungen` an; `basis` und
`online` bleiben erhalten. Die Migration 2 → 3 legt `struktur` und `geraet` an und schreibt die Änderungsschicht auf
Versionen um (Schlüssel `e:<ver>\n<dok>\n<art>\n<k>`, `ver` = „1.1“ für alles Bisherige). Die Migration 3 → 4 (F3b)
legt nur `medien` an: `d:<id>` → `{ blob, sha, groesse, mime, zeit }` (Inhalt), `b:<id>` (Startbild bzw. Vorschau,
höchstens 1600 px), `k:<id>` (Mini-Bild, 360 px), `online` → `{ geprueft, zugriff, liste: [{ sha, name, groesse }] }`
(zuletzt gelesene Liste von aether-medien, ohne Token); alles andere bleibt unverändert. Große Inhalte haben ein
längeres Zeitlimit (10 s plus 1 s je 5 MB). Die Basis
bleibt immer das zuletzt übernommene Paket; dargestellt wird Basis + Änderungsschicht. Kein Token, keine API-Antworten im
Ganzen, kein `localStorage`-Schlüssel. Jeder Zugriff hat ein Zeitlimit (Öffnen 5 s, Lesen/Schreiben 10 s); ohne IndexedDB läuft die
Seite, nur nicht offline. Beim Start fragt sie `navigator.storage.persist()` an (wenn vorhanden). Die Verbindung
schließt bei `versionchange`, damit ein Upgrade nicht blockiert wird, und eine ältere Seite liest eine neuere Datenbank
weiter, solange `basis` und `online` darin liegen.

**Bereinigung und CSP:** Paket-Inhalte kommen nie als HTML-Text ins Dokument, sondern über `DOMParser`, Bereinigung und
`document.importNode`; bereinigt wird ähnlich wie beim fremden SVG im Logo-Werkzeug.

- HTML: `script`, `iframe`, `object`, `embed`, `link`, `meta`, `base`, `form` (dazu `frame`, `frameset`, `applet`,
  `template`, `portal`, `noscript`, `fencedframe`, `handler`, `listener`) fallen samt Inhalt weg, ebenso SVG-Animationen,
  die `href`, `src` oder `on…` setzen, und Kommentare. Alle `on…`-Attribute, `srcset`, `srcdoc`, `autofocus` und
  `xml:base` werden entfernt. `href`, `src`, `xlink:href` (und andere Verweis-Attribute wie `action`, `poster`) bleiben
  nur mit „#…“ oder `data:image/…`, an Links (`a`, `area`) nur mit „#…“. Andere Attribute mit `url(…)` (z. B. `fill`,
  `filter`, `mask`) nur mit „#…“ oder `data:`.
- CSS (Paket-CSS, `<style>` und `style`-Attribute): Kommentare und `@import` fallen weg; `url()`, `src()`,
  `image-set()`, `image()` und `cross-fade()` (auch mit Herstellerpräfix) nur mit `data:…` oder `fonts/…` (ohne „..“),
  sonst wird die ganze Funktion zu `none`. „#…“ (lokaler Verweis, z. B. SVG-Verlauf `fill:url(#g)`) nur in den
  Eigenschaften `fill`, `stroke`, `clip-path`, `filter` und `marker…` – dort lädt der Browser nichts; in anderen
  (`background-image`, `content`, `border-image`, `list-style-image` …) würde Chromium für `url(#x)` die Seite selbst
  noch einmal holen. Ein eigener CSS-Leser nach CSS Syntax Level 3 erkennt dabei auch Escapes (`\75 rl(` = `url(`).
- Die Markierungen `data-t`, `data-s`, `data-status`, `data-block`, `data-zaehler`, `data-stand` und `<ae-t>` bleiben.
- Die Content-Security-Policy von `flyer.html` sichert zusätzlich: Skripte nur vom eigenen Ursprung (kein
  Inline-Skript), Bilder nur eigen, `data:` oder `blob:`, Schriften nur eigen oder `data:`, Verbindungen nur eigen und
  `https://api.github.com`, keine Frames und Objekte, kein Formular-Versand, kein `<base>`. Nichts aus dem Paket lädt
  etwas aus dem Netz.

**Isolation (Shadow DOM):** Jedes Dokument steht in einem eigenen Shadow Root (`div.flyer-host`), gewählt statt
`iframe srcdoc`, weil es leicht genug für alle Kacheln ist (das echte Paket hat 38 Dokumente) und sich im Druck
seitenweise umbrechen lässt. Shadow-CSS = `:host{all:initial;display:block}` mit den eigenen Variablen der Seite
(`--bg`, `--text`, `--accent` …) auf `initial` (`all` setzt Variablen nicht zurück; sonst sähe ein Paket mit
`var(--bg, …)` je nach Hell/Dunkel der Seite anders aus) + bereinigtes Paket-CSS mit `:root`, `html` und `body` →
`:host` + neutraler Host-Kasten (`margin`, `padding`, `border` 0). So wirkt das Paket-CSS nur im Dokument und nichts
von der Seite hinein. Jedes Dokument liegt zusätzlich in einem Rahmen mit `contain:paint` (Kachelbild, Vollbild-Hülle,
Druckseite): Eine `:host`-Regel des Pakets mit `!important` (sie schlägt aus dem Shadow Root heraus Lage und
`transform` des Hosts) oder ein `position:fixed` im Dokument bleibt darin – kein Dokument legt sich über die Seite und
ihre Knöpfe, und im Druck erscheint es nur auf den Seiten seines Dokuments. `@font-face` und `@page` wirken im Shadow
Root nicht (Chromium ignoriert `@font-face` dort), deshalb stehen sie zusätzlich im Dokument
(`<style id="flyerDokRegeln">`), auch aus `@media`, `@supports` und `@layer` (samt Hülle), als letzte Regel
`@page{size:A4 !important;margin:0 !important}`. Nicht übernommen werden `@page` mit Seitenauswahl (`:first`, `:left`,
`:right`, `:blank`, Namen – sie würden die A4-Regel über die Spezifität aushebeln) und `@font-face` mit einem
Schriftnamen, den die Seite selbst nutzt (Avenir Next, Futura, Segoe UI, system-ui, -apple-system, Menlo …; sie
änderten sonst Kopfzeile und Knöpfe – Bildschirm, Druck und Bild gleich). Auch beim Drucken mehrerer Dokumente bleibt
jedes in seinem eigenen Shadow Root.

**Module** (in dieser Reihenfolge eingebunden, jedes setzt genau ein eingefrorenes `window.Aether…`-Objekt):

| Datei | Inhalt |
|---|---|
| `gemeinsam.js` | gemeinsame Hilfsfunktionen (`githubApi`, `AppError`, `meldung`, `mitGeste`, `kannTeilen`, `herunterladen`, Zeitlimit) |
| `flyer-paket.js` | `AetherFlyerPaket`: Format v1 und v2 lesen und prüfen, Umwandlung v1 → v2 (`alsV2`), Fassungen vergleichen, Datum, Bereinigung von HTML und CSS, CSS für Shadow Root und Dokument aufteilen |
| `flyer-struktur.js` | `AetherFlyerStruktur` (F3a): Versionen, Ordner und Seiten (reine Funktionen auf einer Kopie), Vorlagen, Sicht einer Version, Felder und Zusammenführen für den Abgleich |
| `flyer-speicher.js` | `AetherFlyerSpeicher`: IndexedDB `aether-flyer`, `persist()` |
| `flyer-ansicht.js` | `AetherFlyerAnsicht`: Pfad, Ordner-Kacheln, Seiten-Kacheln mit Menü „···“, „Ausgeblendete zeigen“, Vollbild, Tasten und Wischen, Schriftanpassung; `darstellen(dok, ziel, optionen)` stellt ein Dokument dar (für Teil 2 mit der Änderungsschicht über `optionen.anpassen`) |
| `flyer-online.js` | `AetherFlyerOnline`: Online-Prüfung |
| `flyer-export.js` | `AetherFlyerExport`: PDF (Druck) und Bild, beide mit der Änderungsschicht; Seitenbild und SVG-Ausschnitt für den Export „Grafiken & Daten“ |
| `flyer-zip.js` | `AetherFlyerZip` (F3a): ZIP „stored“ mit CRC-32, ohne Bibliothek |
| `flyer-aenderungen.js` | `AetherFlyerAenderungen`: Änderungsschicht (Text, Status, Stand), Zähler und Balken, Abgleich, Export-Paket, Sicherung |
| `flyer-bearbeiten.js` | `AetherFlyerBearbeiten`: Umschalter und Leisten im Vollbild, Konfliktliste (auch Strukturkonflikte), „Paket exportieren“ (Hinweis ab 20 MB), Hilfe „Online stellen“, Sichern/Einspielen/Verwerfen |
| `flyer-uebersicht.js` | `AetherFlyerUebersicht` (F3a): Tafeln, Versionsknopf und Tafel „Versionen“, Menüs „···“ für Version, Ordner und Seite, „+ Neuer Ordner“, „+ Seite“ |
| `flyer-grafik.js` | `AetherFlyerGrafik` (F3a): Export „Grafiken & Daten“ (Erkennung, PNG, SVG, CSV, JSON, Einzelauswahl, ZIP der Version) |
| `flyer-pptx.js` | `AetherFlyerPptx`: PowerPoint-Export (PPTX-Schreiber ohne Bibliothek, Formate A4 hochkant und 16:9 quer, Folien aus dem Seitenbild, Knöpfe und Auswahl) |
| `flyer-medien.js` | `AetherFlyerMedien` (F3b): Datenmodell der Bibliothek, Formate, Größen, Git-Blob-SHA, Status, Einlesen (Maße, Startbild, Mini, SVG bereinigen), Bild-Zwischenspeicher |
| `flyer-bibliothek.js` | `AetherFlyerBibliothek` (F3b): Reiter „Seiten \| Bibliothek“, Pfad, Filter, Ordner, „Aus Flyern“, Datei-Kacheln |
| `flyer-medien-tafeln.js` | `AetherFlyerMedienTafeln` (F3b): „+ Hinzufügen“, Menü einer Datei, Löschen, „Medien online stellen“ |
| `flyer-player.js` | `AetherFlyerPlayer` (F3b): Player, Medien in Seiten (`data-medium`), Modus „Medium“ |
| `flyer-medien-online.js` | `AetherFlyerMedienOnline` (F3b): Abgleich mit dem privaten Repo aether-medien (nur lesend) |
| `flyer.js` | `AetherFlyer`: Start, Import, Kopfzeile, Struktur (lokaler Stand v2, offene Version, Abgleich); Schnittstelle für Tests und Teil 2 |

Fehlt eines der Module Ansicht, Online, Export, Bearbeiten, Übersicht, Grafik, PowerPoint, Bibliothek, Tafeln, Player oder Medien
online, bleiben seine Knöpfe verborgen und der Rest läuft weiter. Die CSP erlaubt seit F3b `media-src 'self' blob:`
(Videos aus dem eigenen Speicher).

**Testschalter:** Setzt man vor dem Laden `window.AETHER_TEST_FLYER_INTERVALL_MS` (positive Zahl), gilt dieses
Intervall statt der 10 Minuten; `window.AETHER_TEST_FLYER_SCHRIFT_FRIST_MS` ersetzt die 5 s Wartezeit auf die
Paket-Schriften; `window.AETHER_TEST_FLYER_FREIGABE_MS` ersetzt die 60 s bis zur Freigabe einer Download-Blob-URL;
`window.AETHER_TEST_PROJECT_TIMEOUT_MS` (aus `gemeinsam.js`) verkürzt das Zeitlimit der Anfragen. Das nutzen nur die E2E-Tests. **Testschnittstelle:** `window.AetherFlyer` (`bereit`, `stand`, `paket`,
`paketV2`, `sicht`, `version`, `aendereStruktur`, `oeffneVersion`, `strukturZahl`, `strukturKonflikte`, `uebernehme`,
`fehler`, `fehlerWeg`, `gespeichert`) und die Modul-Objekte.

**Grenzen**

- Auf iPhone/iPad (Safari) noch nicht am Gerät geprüft; die Tests laufen in Chromium. „Bild“ erscheint nur, wenn beim
  Start eine Selbstprobe gelingt (kleines SVG mit `foreignObject` → Canvas → Pixel lesen → `toDataURL`). Gibt der
  Browser das Bild beim echten Zeichnen nicht heraus (Canvas „tainted“), erscheint „Dieser Browser gibt das Bild nicht
  heraus – „Bild“ ist hier nicht verfügbar“ und der Knopf bleibt aus. „PDF“ ist davon nicht betroffen.
- `window.print` in der Home-Bildschirm-App: iOS öffnete dort lange gar keinen Druckdialog; ob das heute noch gilt, ist
  unsicher. Kommt nach 2,5 s kein `beforeprint`, erscheint „Falls sich kein Druckdialog öffnet: das Dashboard in Safari
  öffnen und dort drucken.“
- Ältere Safari-Fassungen beachten `@page size` nicht; iOS druckt dann im Papierformat der Region (in Deutschland A4),
  der Flyer passt mit 210 × 297 mm trotzdem auf eine Seite.
- Wie überall braucht der erste Start Internet, damit die Seite in der App-Hülle liegt; das Paket kommt online oder per
  Import.
- Die Tests nutzen nur Platzhalter-Pakete; Zähler-Regel und Stand-Formate wurden einmalig lokal am echten Paket
  geprüft (es liegt nie in diesem Repo). Änderungen liegen nur auf diesem Gerät, bis sie exportiert (oder gesichert) sind.
- F3a (Versionen, Ordner, neue Seiten, Export „Grafiken & Daten“) ist auf iPhone/iPad noch nicht am Gerät geprüft. Der
  Export braucht für PNG dieselbe Selbstprobe wie „Bild“ (sonst nur SVG und Daten); das ZIP der Version wird im
  Speicher gebaut (am echten Paket ca. 47 MB). SVG mit eingebettetem HTML zeigen Grafikprogramme evtl. nicht genau.
  Tabellenprogramme mit deutscher Einstellung können die Spalte `version` („1.1“) als Datum lesen.
- F3b (Bibliothek, Player, aether-medien) ist auf iPhone/iPad noch nicht am Gerät geprüft. Die Tests spielen eine zur
  Laufzeit erzeugte WebM ab; MP4/MOV (H.264/HEVC) prüft die Gerätetest-Checkliste. Vermutung (Doku, nicht geprüft): iOS
  wandelt HEIC aus der Fotos-Mediathek bei `accept="image/*"` meist in JPEG um und kann Videos vor der Übergabe
  komprimieren – die Tafel „Hinzugefügt“ zeigt darum die tatsächliche Größe. Ob Safari 500-MB-Blobs in IndexedDB
  zuverlässig speichert, ist am Gerät zu prüfen (Kontingent vermutlich ausreichend, siehe oben). Die Contents-API liefert höchstens
  1000 Einträge je Ordner. „Alle sichern“ baut die ZIP aus Blob-Teilen; ob Safari beim Teilen großer ZIPs den Inhalt
  ganz in den Speicher holt, ist offen (darum die Grenze 512 MiB).

## WebGPU-Check

Eigenständige Seite zum Prüfen der eigenen Geräte (iPad, iPhone; Safari und Home-Bildschirm-App):
**https://konstantin9ezm.github.io/aether-dashboard/webgpu-check.html**. Der Link „WebGPU-Check“
steht in der Kopfzeile oben rechts, links neben dem Umschalter „Spielen | Projekt“ (Build- und Projektansicht;
auf dem iPhone hochkant als Symbol mit derselben 44-px-Tippfläche; bis 400 px Breite entfällt dafür das Logo), und unten auf dem Token-Bildschirm. Auf dem
Token-Bildschirm ist der Kopfzeilen-Link ausgeblendet, während ein Spiel läuft ebenfalls. Die Seite braucht kein Token, liest
keins und ruft api.github.com nie auf; alles steckt in der einen Datei (keine externen Skripte oder Schriften).
Sie ist absichtlich nicht Teil der Offline-App-Hülle in `sw.js`.

Was gemessen wird (von oben nach unten):

- **Ergebnis** – WebGPU direkt, WebGPU im Dashboard-iframe, WebGL 2 und der daraus folgende Grafikweg fürs Spiel
  (WebGPU / WebGL-Rückfall / keiner; maßgeblich ist der iframe, weil das Spiel dort läuft).
- **Gerät** – kompletter User-Agent, Browser und Version (Safari aus „Version/…“, nicht aus dem seit iOS 26
  eingefrorenen OS-Feld; Chrome/Firefox auf iOS; `userAgentData` bei Chromium), Gerätetyp (iPad auch, wenn es sich
  als Mac meldet; das genaue Modell ist im Browser nicht ermittelbar), Home-Bildschirm-App, Bildschirm- und
  Fenstergrößen, Ausrichtung, devicePixelRatio, sichere Ränder, Touch/Zeiger/Hover, Controller (erscheinen erst nach
  einem Tastendruck).
- **Grafik (WebGPU)** – Canvas-Format, WGSL-Sprachfeatures, `requestAdapter`/`requestDevice` mit Zeit,
  Adapter-Infos, alle Features und alle Limits, `device.lost` und `uncapturederror`.
- **Grafik (WebGL 2)** – Renderer/Vendor (über `WEBGL_debug_renderer_info`, falls verfügbar), `MAX_TEXTURE_SIZE`,
  `MAX_SAMPLES`, Anzahl Erweiterungen, `EXT_color_buffer_float`.
- **Probe** – dieselbe Mini-Probe direkt und in einem iframe mit genau den Attributen des Spiel-iframes
  (`srcdoc`, `sandbox="allow-scripts allow-pointer-lock"`, `allow="gamepad *; fullscreen *; autoplay *"`,
  `referrerpolicy="no-referrer"`): Canvas konfigurieren, 5 Frames Löschen + Dreieck, Pixelprüfung, Compute-Shader
  mit `mapAsync`, `device.destroy()` → `device.lost` „destroyed“, dazu WebGL 2 Löschen + `readPixels`. Der iframe
  meldet per `postMessage`; die Seite nimmt nur Nachrichten dieses iframes an.
- **Bildtakt** – je 5 s mit `requestAnimationFrame` während einer Testszene (WebGPU, sonst WebGL 2): Frames,
  mittlere fps, Median, 1 %-Tief, längster Frame, Frames über 20 ms und 33,4 ms, erkannte Obergrenze, Diagramm.
  Geführt in Stufen: a) direkt, b) im iframe ohne Interaktion, c) im iframe nach einer Controller-Taste (optional),
  d) im iframe nach einmal Antippen. Dazu eine Deutung (Safari drosselt fremde iframes bis zur Interaktion auf
  30 fps; im Stromsparmodus drosselt iOS überall auf 30 fps).
- **Weitere Fähigkeiten** – sicherer Kontext, Cross-Origin-Isolation, SharedArrayBuffer, Kerne, Gerätespeicher,
  reduzierte Bewegung, Speicher-Kontingent, WebAssembly (SIMD, JSPI, Threads).

Das komplette Ergebnis steht unten als Text im Format `AETHER-CHECK v1` (eine Angabe pro Zeile, mit deutscher
Ortszeit und dem Commit des Dashboards; den setzt der Pages-Workflow ein, lokal „nicht bekannt“).
„Ergebnis kopieren“ legt es in die Zwischenablage, „Per Mail senden“ öffnet eine Mail an feedback.aether@gmail.com
(höchstens 2000 Zeichen, Zusammenfassung zuerst, Features/Limits zuletzt, bei Kürzung mit Hinweis).

**Datenschutz:** Nichts wird automatisch gesendet oder gespeichert (kein localStorage, keine Cookies). Was weitergeht,
entscheidest du selbst über Kopieren oder Mail.

## Gemeinsame Hilfsfunktionen (`gemeinsam.js`)

`index.html`, `screen-editor.html` und `logo.html` binden `gemeinsam.js` per `<script src="gemeinsam.js">` ein
(globales Objekt `window.AetherGemeinsam`). Dort steht jede Hilfsfunktion, die mehr als eine dieser Seiten braucht,
genau **einmal**: `AppError`, `fmtTime`, `shortSha`, `needTokenError`, Zeitlimit 15 s (`projTimeoutMs`,
`projTimeoutError`, `withProjTimeout`), `githubApi(cfg)` mit `errorFromResponse`, `api` und `contentsPath`,
sowie fürs Sichern `mitGeste`, `meldung`, `kannTeilen`, `kannHerunterladen` und `herunterladen`.

Was hineingehört: reine Hilfsfunktionen ohne seitenspezifische Konfiguration. Was je Seite verschieden ist
(Repo, Zweig, Ende des 401-Textes, Fehlerart ohne Token, Rate-Limit-Anzeige der Projektansicht), übergibt die Seite
als `cfg` an `githubApi`. Was **nicht** hineingehört: Token lesen oder speichern (bleibt in den Seiten, nur
`localStorage`), sonstiger Speicher oder Cache, Seiten-Texte und Abläufe, die sich je Seite unterscheiden (z. B. der
Teilen-Ablauf mit seinen Meldungen). Die Datei wird nicht ins Spiel-iframe geladen; `webgpu-check.html` bleibt
bewusst eigenständig. Sie gehört zur App-Hülle in `sw.js` und wird von `pages.yml` veröffentlicht – ohne sie starten
die drei Seiten offline nicht. `tests/gemeinsam.test.js` prüft, dass keine der Funktionen in den HTML-Dateien erneut
definiert wird. Auch `flyer.html` bindet die Datei ein (vor den Flyer-Modulen, siehe
[Flyer & Infografiken](#flyer--infografiken)).

## Ein- und Ausklappen

Drei Listen sind beim Laden kurz und lassen sich aufklappen. Der Klapp-Zustand gilt **nur für die laufende
Sitzung** (Variablen im Speicher, kein `localStorage`/`sessionStorage`): Nach jedem Neustart bzw. Neuladen der Seite
gilt wieder der Startzustand. Automatisches und manuelles Neuladen der *Daten* lässt ihn dagegen stehen.

| Stelle | Startzustand | Aufklappen | Am Ende (aufgeklappt) |
| --- | --- | --- | --- |
| Projekt › Fortschritt | „Erledigt“ zu, alle übrigen Abschnitte offen | Pfeil-Knopf links im Kopf oder ganzer Kopf | nur „Erledigt“: „Einklappen ⌃“ |
| Spielen › Build wählen | die 3 neuesten Builds (+ ein gewählter älterer Build als zusätzlicher Eintrag) | „Ältere Builds anzeigen (n) ⌄“ (n = verborgene Builds; ≤ 3 Builds: kein Knopf) | „Einklappen ⌃“ |
| Projekt › Zeitleiste | die 3 neuesten Einträge der Filteransicht (Alle / Spiel / Dashboard) | „Ältere anzeigen (n) ⌄“ zeigt **alle** Einträge der Filteransicht | „Einklappen ⌃“ |

- Alle Klapp-Knöpfe sind `<button>`-Elemente mit `aria-expanded` und `aria-label`, per Tab und Enter/Leertaste
  bedienbar, Tippfläche mindestens 44 × 44 px. Die Pfeile (›/⌄ im Fortschritt, ⌄/⌃ an den breiten Knöpfen) zeichnet
  CSS, sie sind keine Schriftzeichen.
- Breiter Knopf: volle Listenbreite, 44 px hoch, Hintergrund `--panel-2`/Rand `--line` (innerhalb eines
  Fortschritt-Abschnitts etwas heller: `#242D41`/`#404D69`). Fortschritt-Pfeil-Knopf: 44 × 44 px, `#242D41`/`#404D69`.
- „Einklappen“ stellt den Startzustand her; liegt der Listenkopf bzw. der Knopf „… anzeigen“ danach außerhalb des
  sichtbaren Bereichs, wird dorthin gescrollt (Fokus auf diesen Knopf).
- Zeitleiste: Je Quelle sind schon bis zu 50 Einträge geladen (wie bisher); „Ältere anzeigen“ blendet sie nur ein,
  es gibt keine weitere API-Anfrage. Ein Filterwechsel setzt die Liste auf die 3 neuesten zurück.
- Build-Liste: Ältere Builds bleiben ausgeblendet im DOM; Auswahl, Abzeichen „NEUESTER“/„GESPEICHERT“, Start-Rahmen
  und „Aktualisieren“ funktionieren wie bisher. Wird ein Build unter den 3 neuesten gewählt, verschwindet der
  zusätzliche Eintrag wieder.

## Selbst aktualisieren

### Daten (Projektansicht und Build-Liste)

Die sichtbare Ansicht lädt im Hintergrund neu:

- alle `AUTO_AKTUALISIEREN_MS` = 120 s (`0` = aus), solange die Seite sichtbar ist
  (`document.visibilityState === 'visible'`), das Gerät online ist und ein Token gespeichert ist;
- zusätzlich sofort bei Rückkehr in die App bzw. den Tab (`visibilitychange`) und beim Ereignis `online`, aber
  frühestens `AUTO_MIN_ABSTAND_MS` = 60 s nach dem letzten Laden (entspricht dem 60-s-Cache);
- **nie**, während ein Spiel lädt oder läuft (nach dem Tipp im Start-Rahmen bis zum Schließen) oder der
  Feedback-Dialog offen ist. Nach dem Schließen des Spiels wird sofort einmal aktualisiert.

Das Neuladen ist still: kein „Lade …“, keine Fehlermeldung, keine Fehlerkarte. Klapp-Zustand, Zeitleisten-Filter,
CI-Details, Scroll-Position und gewählter Build bleiben. Erst wenn alle Teile da sind, wird in einem Schritt
gezeichnet; Teile mit Fehler (offline, Zeitlimit, API) bleiben wie sie sind, der Stempel „Stand: …“ ändert sich nur
bei vollständigem Erfolg. Der Offline-Zustand (Hinweis oben) wird wie bisher über das Ereignis `online` bzw.
„Aktualisieren“ aufgeräumt. Ein neuer Build erscheint in der Liste (Abzeichen „NEUESTER“), wird aber erst beim
Starten oder mit „Aktualisieren“ heruntergeladen (dafür bräuchte es die Ladeansicht).

API-Anfragen je automatischem Neuladen (Limit 5000/h):

| Ansicht | Anfragen | höchstens pro Stunde |
| --- | --- | --- |
| Projektansicht | 8 (letzter Lauf, abgeschlossene Läufe, Jobs, `build.yml`, PRs, Commits, Dashboard-PRs, `ROADMAP.md`; Workflow-ID aus dem 30-min-Cache, `engine-map.json` vom eigenen Ursprung) | Intervall: 30 × 8 = 240; mit häufigem Wechsel in die App höchstens 60 × 8 = 480 (Mindestabstand 60 s) |
| Build-Liste | 1 (`index.json`) | 30, höchstens 60 |

Dazu kommen wie bisher das Nachladen eines laufenden Builds alle 30 s und ggf. das Nachholen älterer CI-Dauern.
Beim ersten Laden entstehen keine zusätzlichen Anfragen.

Tests: `window.AETHER_TEST_AUTO_MS` und `window.AETHER_TEST_AUTO_MIN_MS` (vor dem Skript gesetzt) verkürzen
Intervall und Mindestabstand; nur dann schreibt die Seite ein Protokoll der Versuche nach `window.__aetherAuto`
(Grund und Ergebnis, keine Daten).

### Neue Dashboard-Version (nur `index.html`)

`pages.yml` setzt beim Veröffentlichen den Commit in `<meta name="aether-version" content="…">` der Hauptseite.
Die offene Seite liest beim Start (nach 3 s), bei Rückkehr in die App und mit jeder Intervall-Runde `index.html`
am Browser-Cache vorbei (`cache: 'no-store'`, über den Service Worker, der dabei auch die App-Hülle auffrischt) und
vergleicht die Marke. Ist sie neu:

- läuft kein Spiel, ist kein Feedback-Dialog offen und hat kein Texteingabefeld den Fokus (z. B. Token): sofort
  `location.reload()`;
- sonst wartet die Seite und lädt neu, sobald das zutrifft (nach dem Schließen des Spiels, beim Verlassen des Felds,
  bei jedem Ansichtswechsel, bei der nächsten Prüfung).

Kein Kreislauf: Vor dem Neuladen merkt sich die Seite die neue Version in `sessionStorage`
(`aether.versionNeugeladen`, nur die Versionsmarke). Zeigt die Seite danach immer noch die alte Marke (z. B. CDN
noch nicht aktuell), wird für diese Version nicht noch einmal neu geladen. Offline wird nicht geprüft; Fehler
bleiben still. Lokal (ohne `pages.yml`) steht der Platzhalter `__AETHER_VERSION__` in der Seite, dann ist die
Prüfung aus.

`screen-editor.html` und `logo.html` laden **nicht** automatisch neu (dort könnten ungespeicherte Änderungen
verloren gehen); sie verhalten sich wie bisher. `sw.js`, `aether-shell-v1` und `aether-builds-v1` sind
unverändert; api.github.com landet weiterhin nie in einem Cache.

Bereits installierte Home-Apps laufen bis zum nächsten echten Seitenaufruf mit der alten Fassung (ohne diese
Prüfung). Einmal die App beenden und neu öffnen (oder warten, bis iOS sie verwirft) – danach übernimmt sie neue
Versionen selbst.

## Entwicklung & Tests

```sh
npm ci
npx playwright install chromium
npm test
```

Die Tests bauen die GitHub-REST-API mit Playwright-Routing nach und prüfen die Seite in Headless Chromium:

- `tests/e2e.test.js` – Spielansicht (Desktop, iPhone 13, iPad Pro 11), dazu `aether:quit` (Desktop) und der
  Block „Offline“: neuer Build wird beim Start erkannt, geladen und gespeichert (höchstens 2 Builds bleiben);
  Seite lädt ohne Netz (Browser offline, Mock-API bricht ab, Testserver kappt Verbindungen), Hinweis, gespeicherter
  Build startet, andere ausgegraut, Projektansicht zeigt den Hinweis; hängende API führt per verkürztem Zeitlimit
  (1,5 s) zum lokalen Stand; Token in keinem Cache. Gegenprobe: `AETHER_NO_SW=1 npm test` liefert `sw.js` nicht aus,
  dann muss der Offline-Test rot werden.
- `tests/project.test.js` – Projektansicht (Desktop, iPad Pro 11 hoch und quer, iPhone 13): alle vier Teile,
  Ampelzustände, deutsche Ortszeit bei fremder Gerätezeitzone, Cache, Tippflächen ≥ 44 px, eine `ROADMAP.md` mit
  unerwarteten Zeilen sowie die Fehlerfälle (kein Token, keine Rechte, Rate-Limit, offline, Token abgelehnt,
  fehlende Dateien, kaputte `engine-map.json`). Dazu die CI-Laufzeit: Werte der Zeile, Farben an den Schwellen
  69/70/89/90 %, knappster Schritt über aufgeteilte Jobs und Matrix-Varianten, `build.yml` mit Kommentaren/CRLF,
  fehlendes Limit, laufender neuerer Lauf, API-Fehler ohne Fehlerkarte, Details auf/zu, Trend und Layout in
  402×874, 874×402, 1194×834 und 1280×800; Balkenfarben je Ausgang samt Legende, Nachladen und Merken der Dauer
  älterer Re-runs (zweites Laden ohne Anfrage, Stummel „Dauer ?“ bei Fehler), Beschriftung nie unter der
  Limit-Linie (geometrisch) und der Versuchs-Hinweis mit übernommenen Jobs wie in echten Re-run-Daten. Außerdem die
  CI-Zeile mit langen Job- und Schrittnamen (Re-run): „Dauer / Limit (Prozent)“ liegt bei 1194×834, 834×1194,
  874×402, 402×874, 390×844, 360 und 320 px sowie in 10-px-Schritten von 320 bis 1400 px immer in einer Zeile,
  ohne Überlauf aus der Karte. Gegenprobe (muss rot werden): ohne `white-space: nowrap` am Block.
- `tests/fassung.test.js` – Umschalter „Fassung: Entwickler | Playtester“ mit nachgestelltem `index.json` (Builds mit und
  ohne `playtester`): Standard Entwickler, Speichern/Wiederherstellen (`aether.fassung`, ungültige Werte), Ausgrauen
  und Nicht-Wählbarkeit auch unter „Ältere Builds“, Sprung der Auswahl, gesperrter Start, Pfad beim Laden
  (`builds/…` bzw. `playtester/…`), Beschriftung im Start-Rahmen, „gespeichert“ und Obergrenze je Fassung, vorhandener
  Entwickler-Eintrag, Offline. Gegenproben (müssen rot werden): Ausgrauen entfernt, Pfad vertauscht, `localStorage`
  ignoriert, Fassung im Cache-Eintrag ignoriert, Beschriftung entfernt.
- `tests/klappen.test.js` – Ein- und Ausklappen (Desktop, iPhone 13): Fortschritt mit „Erledigt“ beim Laden zu,
  Pfeil-Knöpfe ≥ 44 × 44 in allen Abschnitten, Pfeilrichtung und `aria-expanded`, ganzer Kopf antippbar, Tastatur,
  „Einklappen“ nur am Ende von „Erledigt“ samt Scrollen zum Kopf; Build-Liste mit 3 Builds + „Ältere Builds
  anzeigen (n)“, aufgeklappt alle + „Einklappen“, ≤ 3 Builds ohne Knopf, gewählter älterer Build als 4. Eintrag;
  Zeitleiste je Filter 3 Einträge + „Ältere anzeigen (n)“, ein Tipp zeigt alle, „Einklappen“, Filterwechsel setzt
  zurück; jeweils nach Neuladen wieder Startzustand und keine neuen Speicher-Schlüssel. Gemeinsame Mock-API und
  Server mit Versionsmarke: `tests/mock-dashboard.js`.
- `tests/selbst-aktualisieren.test.js` – Selbst aktualisieren mit verkürztem Intervall (Test-Schalter, Protokoll
  `window.__aetherAuto`, keine festen Wartezeiten): Projektansicht und Build-Liste laden nach dem Intervall neu,
  Klapp-Zustand, Filter, CI-Details, Auswahl, Start-Rahmen und Scroll-Position bleiben, kein „Lade …“, 8 bzw. 1
  Anfrage je Neuladen; nicht bei verborgener Seite, Rückkehr lädt sofort, aber erst nach dem Mindestabstand;
  Standardwerte 120 s / 60 s; nie beim Laden oder Spielen eines Builds und bei offenem Feedback-Dialog, danach sofort
  einmal; Fehler (500, abgebrochen) lassen Daten stehen. Neue Dashboard-Version: Neuladen ohne Spiel, mit Spiel und
  Feedback-Dialog erst nach dem Schließen, mit Fokus im Token-Feld erst danach, kein Kreislauf bei weiter alter
  Seite, Screen-Editor und Logo-Seite laden nicht neu, mit Service Worker neue Version in der App-Hülle, offline
  keine Prüfung.
- `tests/host.test.js` – Schnittstelle Spiel ↔ Dashboard im **vollen Chromium** (`channel: "chromium"`, nicht die
  Headless-Shell): Einstellungen speichern/löschen, Ablehnung ungültiger Nachrichten und fremder Quellen, Grenze von
  64 Schlüsseln, `"</script>"` im Wert, „Token löschen“; Feedback-Dialog mit echtem Klick und echter Enter-Taste
  (Nachweis über die Chromium-Meldung „Launched external handler for 'mailto:…'“), Controller-„press“ auf „Mail
  öffnen“ mit und ohne Nutzeraktivierung (sofort Hinweis, kein `mailto:`-Versuch, gezählt per CDP
  `Page.frameRequestedNavigation`), Kürzen auf 2000 Zeichen,
  Zwischenablage (ausgelesen in einem zweiten Kontext), alle Wege zum Schließen samt Fokus zurück ins Spiel, Layout
  auf iPhone 16 Pro quer, iPad Pro 11 quer und Desktop. Backspace im Token-Feld (mit Dummy-Wert, nichts gespeichert):
  ein Druck löscht genau ein Zeichen, eine gehaltene Taste mehrere; keine Navigation, kein neuer Verlaufseintrag,
  kein Ansichtswechsel, Dialog unberührt, das Dashboard fängt die Taste nicht ab (`defaultPrevented` bleibt aus,
  auch ohne Fokus im Feld). Gegenprobe (muss rot werden): Backspace-Zweig greift auch ohne offenen Dialog.
- `tests/speichern.test.js` – Speichern bestätigen, Nur ein Fenster speichert, Speicher-Schutz (Headless Chromium,
  Test-Spiel): a) Sammel-Nachricht alle bzw. keiner (Wert > 1024, mehr als 64 Schlüssel, genau 64, `null` löscht),
  `ungueltig` ohne Hinweis, Einzel-Nachricht mit `id`; b) ohne `id` keine Antwort, ungültige `id` = ohne `id`;
  c) QuotaExceededError → Antwort `voll`, ein Hinweis bei zwei Fehlern, Spiel behält den Fokus, Details mit
  Schlüsseln, „Erneut versuchen“ noch voll (bleibt rot) bzw. nach Freigabe → grün, weg nach ca. 3 s; nächstes
  Schreiben aus dem Spiel schreibt Zurückgehaltenes mit; Tastatur (Enter/Esc, im Spiel nicht), `fehler`;
  d) Erfolg ohne Hinweis; Layout des Hinweises in 1024 × 768, 1366 × 1024, 844 × 390 (mit Details, Knöpfe ≥ 44 px,
  34 px unten); e) zwei Seiten im selben Kontext: zweite mit Tafel ohne Spielrahmen, Farben/Texte, nur eine schreibt
  (Zählung von `setItem`), `anderes-fenster`, „Hier weiterspielen“ (Klick und Enter) wechselt hin und zurück,
  „Fenster schließen“ (Skript-Fenster schließt, Tab mit Verlauf zeigt den Hinweis), Ersatzweg BroadcastChannel;
  f) ein Fenster: Sperre < 50 ms, Rahmen wie bisher; Layout der Tafel in den drei Größen; g) `persist()` (frei,
  abgelehnt, schon dauerhaft, Fehler, API fehlt). Test-Schalter `AETHER_TEST_SPEICHER` (nur Tests) gibt
  `window.__aetherSpeicherTest(msg)` frei. Gegenproben (müssen rot werden): `writeGameSettings` verschluckt den
  Fehler → c) rot; `darfSpeichern()` immer `true` → e) rot.
- `tests/flyer-zaehler.test.js` – h) Zähler mit Platzhalter-Paket: Block mit Status (Paket) → Zähler schon beim ersten
  Darstellen in Kachel, Vollbild, Druck, „Alle als PDF“ und Bild (Markup des SVG-Bildes), ohne Status kein Zähler,
  x/y, `--anteil`, `--anteil-laeuft` (vier Nachkommastellen), „0 von 2“ nur im Block mit Status; Status aus der
  Änderungsschicht, wieder entfernt → kein Zähler; Export unverändert; i) Abgleich mit erzwungenem Fehler (`put` auf
  `basis` wirft): Basis und Schicht unverändert (IndexedDB, Seite, nach Neuladen), Fehlerweg; ohne Fehler beides
  neu. Gegenproben: alte Regel (`eigen` statt Status) → h) rot; alter Ablauf in `flyer.js` (Schicht zuerst, Basis
  getrennt) → i) rot bei „Schicht unverändert“.
- `tests/start-frame.test.js` – Spielstart im Rahmen (Headless Chromium): Tipp im Rahmen startet, Dokument
  (Kennung `doc`) und iframe-Element vor und nach dem Start dieselben, kein erneutes Laden, Attribute unverändert;
  Nachrichten aus falscher Quelle (Seite, Klon-iframe, alter Start-Rahmen) starten nichts; Build-Wechsel und Beenden
  führen zu neuen Rahmen; Start per Enter mit Touch-Emulation (`maxTouchPoints` 5 per CDP) zeigt den Hinweis, der
  Tipp darauf kommt im Spiel an und blendet ihn aus, Feedback-Dialog blendet ihn aus, Desktop ohne Hinweis; Layout
  (iPhone 16 Pro quer, iPad Pro 11 quer, Desktop: Knopf an der Stelle und in der Größe des früheren Knopfs, ±1 px);
  `?fps=1` mit und ohne Parameter. Spielrahmen-Höhe in der Home-App (`navigator.standalone` per Init-Skript,
  Ansicht 1194 × 802, Bildschirm 1194 × 834): Standard ohne `--game-h` (802 px), mit `?strecken=1` 834 px,
  Breiten-Ausgleich bei 1150 px Ansichtsbreite wie bisher, ohne Home-App-Modus nichts gesetzt. Gegenproben (von
  Hand, müssen rot werden): `HOEHEN_AUSGLEICH_HOME_APP = true` → Fall a rot; Breiten-Zeile ebenfalls abgeschaltet
  → Fall c rot.
- `tests/webgpu-check.test.js` – WebGPU-Check im **vollen Chromium** mit WebGPU aus SwiftShader
  (`--enable-unsafe-webgpu --use-angle=swiftshader --enable-features=Vulkan --use-vulkan=swiftshader`): lädt ohne
  Token und ohne Anfrage an api.github.com, alle Abschnitte gefüllt, Probe direkt und im iframe grün, iframe-Attribute
  gleich denen aus `createGameFrame()`, Bildtakt-Stufen a/b/d (c übersprungen), Ergebnistext mit Pflicht-Schlüsseln,
  Kopieren, mailto ≤ 2000 Zeichen; Rückfall ohne die Flags („kein Adapter“, WebGL-Rückfall) und ohne
  `navigator.gpu` („WebGPU fehlt“); Layout auf iPhone 16 Pro hoch/quer und iPad quer; Link „WebGPU-Check“ auf dem
  Token-Bildschirm und in der Kopfzeile (Build- und Projektansicht auf iPhone 16 Pro hoch/quer, iPad, Desktop: links
  neben dem Umschalter, gleiche Höhe, Tippfläche ≥ 44 × 44 px per Treffertest, kein Überlappen, einzeilig). Gegenproben (müssen rot
  werden): `AETHER_GEGENPROBE=iframe-attr|mailto|pflicht|safari-os node --test tests/webgpu-check.test.js`.

- `tests/screen-editor.test.js` – Tools-Karte und Screen-Editor (Headless Chromium): Lage der Karte zwischen
  Stand-Zeile und Build-Ampel, Ziele der Knöpfe („Logo ›“ und „Flyer ›“ aktiv, auch offline), Umbruch ohne waagerechtes Scrollen bei
  320–1400 px; offline Karte sichtbar, Messflug/WebGPU-Check ausgegraut, Editor startet aus dem Service Worker; keine
  externen Anfragen, three.js-Prüfsumme; keine Überlappung von Bühne, Trennleisten, unterem Bereich und Bedienfeld
  (402×874, 874×402, 1194×834, 834×1194, 1280×800, 360×700, 600×800 je Untereinander/Nebeneinander und
  Draufsicht/Vergleich), Trennleisten ziehen/Neuladen/Doppeltipp, Rückfall auf Untereinander; Regel C rechnerisch
  für alle vier Formate; „Ränder füllen“ nur außerhalb von 16:9 (alle Eckpunkte); Import der Versionen 1 und 2;
  Bild-Export (vier PNG, Teilen-Dialog nachgestellt, nur mit Nutzergeste, Download- und „Lange drücken“-Rückfall);
  Legende je Schalterkombination („Rahmen der anderen Geräte“, „Umrisse“).
- `tests/logo.test.js` – Logo-Werkzeug mit Mock-API und Test-SVG (vier Gruppen, eingeschleustes `script`,
  `onload`, `foreignObject`, externes Bild): Anzeige, Commit und Quellen-Zeile, genau zwei API-Anfragen; jeder
  Ebenen-Schalter blendet genau seine Gruppe aus (Pixelprobe); nichts wird ausgeführt, nichts nach außen geladen;
  SVG byte-gleich (SHA-256, auch per Download); PNG 1024/2048/4096 px mit transparenten Ecken, ausgeblendete Ebenen
  fehlen; offline nach einmaligem Laden aus der App-Hülle, offline ohne Fassung, hängende API (Zeitlimit), ohne Token;
  Token in keinem Speicher und keinem Cache; Layout 320–1400 px mit und ohne Logo. Gegenproben (müssen rot werden):
  SVG per `innerHTML` ins Dokument (Script läuft), PNG mit allen Ebenen trotz ausgeschalteter Ebene, `logo.html` nicht
  in der App-Hülle.
- `tests/logo-png.test.js` – Spiel-Logo `game/assets/ui/logo.png` (erzeugte Test-PNG, `tests/test-png.js`) im
  Logo-Werkzeug und im Screen-Editor: Bild, Quellzeile, Seitenverhältnis (gemessen an den Bildpixeln, auch hochkant),
  „PNG sichern (Original)“ byte-gleich, Hintergrund für beide Vorschauen, Fehler/offline, Box-Maße unverändert,
  Annäherung mit Hinweis, iPhone hochkant. Gegenproben (müssen rot werden): Annäherung statt Bild, Bild auf die Box
  gestreckt, Fehlerfall ohne Rückfall.
- `tests/screen-logo.test.js` – „Logo dieses Screens“ (erzeugte Test-PNG in eindeutigen Farben: Spiel-Logo Cyan,
  eigene Magenta/Gelb): Laden mit Vorschaubild, Name, Maßen und Größe; nach Neuladen noch da; zwei Screens getrennt;
  Kopie übernimmt; „Spiel-Logo verwenden“; Löschen/Zurücksetzen/Ersetzen/„Alles ersetzen“ geben das Bild in IndexedDB
  frei; ungültige Dateien (kein PNG, zu groß, zu viele Pixel, ohne IHDR, beschädigt) → Meldung, Screen unverändert;
  Seitenverhältnis 1 : 4 und 20 : 1 (Bühne, Vorschaubild, Vergleich); Vergleich und „Als Bild sichern“ mit dem Logo
  des jeweiligen Screens, Export/Import; alte Daten ohne Angabe; offline aus dem Service Worker; iPhone hochkant.
  Gegenproben (müssen rot werden): `AETHER_GEGENPROBE=ein-logo|neuladen|gestreckt|leiche node --test
  tests/screen-logo.test.js` (ein Logo für alle Screens, Logo nach Neuladen weg, Bild gestreckt, Bildleiche).
- `tests/logo-editor.test.js` – Logo-Editor: Schriftdateien (Lizenz, Prüfsummen, Stärke/Stil laut Datei, Buchstaben
  von „Aether“, `sw.js`-Liste), Schriftliste und Ausgrauen je Schrift, Wechsel ohne Kursiv/Stärke, Pfade = Umrisse
  der richtigen Datei je Stärke/Stil, SVG ohne `<text>`/`<script>`/externe Verweise mit Gruppen, PNG 1024/2048/4096
  transparent, Bühne = SVG = PNG-Quelle (auch Pixelvergleich), Rückgängig/Wiederholen, Projekt sichern/laden,
  Neuladen, offline, keine fremden Server, Token, Backspace, Layout (iPhone 16 Pro hoch/quer, iPad quer/hoch,
  Desktop, 320 px), Karten aufklappbar. Gegenproben (müssen rot werden):
  `AETHER_GEGENPROBE=kursiv|text|kaputt|verlauf|fremd|token node --test tests/logo-editor.test.js`.
  `logo.test.js` und `logo-png.test.js` starten die Karten mit `window.AETHER_TEST_KARTEN_OFFEN = true` offen.
- `tests/logo-ring.test.js` – Logo-Editor Stufe 2 (Ring): Standardwerte ergeben die Referenz-Brocken des Spiels
  (eigene, im Test festgehaltene Werte: Lage, Umriss, Farben, 49 hinten/101 vorne, Ausdehnung 375 × 137 px), jeder
  Regler ändert den Ring, „Wie im Spiel“, Zufallswert/„Neu würfeln“, Anzahl 10–400, Projekt Version 2 (Rundlauf) und
  Version 1 (lädt mit Spielwerten), SVG/PNG mit Ring, Neuladen, offline, 4 API-Anfragen, kein Token, Leistung;
  Modus-Umschalter, Auswahl/Markierung, Ziehen (Maus und Touch ohne Seiten-Scrollen), Größe, Drehung, vor/hinter,
  Löschen (Entf, nicht Backspace), eigener Brocken, E3 (Änderungen folgen Neigung/Breite/Höhe/Größe), Rückfrage nur
  mit Änderungen, Abbrechen/Verwerfen, Rückgängig/Wiederholen, Projekt mit Änderungen, Layout in beiden Modi.
  Gegenproben (müssen rot werden): `AETHER_GEGENPROBE=referenz|neigung|ohne-frage|verwerfen-alles|loeschen|regler-anfassbar|version1
  node --test tests/logo-ring.test.js`.
- `tests/ring-sammlung.test.js` – Ring-Sammlung: Speichern unter, Speichern, Umbenennen, Kopieren, Löschen mit
  Rückfrage, Umschalten lädt den Ring-Teil exakt, Rückfrage bei ungespeicherten Änderungen
  (Speichern/Verwerfen/Abbrechen/Esc), Namensregeln, Neuladen/Neustart/offline, unabhängig vom Projekt, Datei
  sichern/laden (Namenskonflikt, falsches Format), kaputter Speicher, Tastatur, Rückgängig nach Umschalten, Layout
  (iPhone hoch/quer, iPad, Desktop). Gegenproben (müssen rot werden):
  `AETHER_GEGENPROBE=ohne-frage|ohne-einzel|im-projekt|doppelt|backspace node --test tests/ring-sammlung.test.js`.
- `tests/gemeinsam.test.js` – `gemeinsam.js`: keine der ausgelagerten Funktionen ist in `index.html`,
  `screen-editor.html` oder `logo.html` selbst definiert (Quelltextprüfung), alle drei binden die Datei ein, sie
  speichert nichts und liest kein Token; sie liegt in der App-Hülle und ist offline abrufbar, Projektansicht,
  Screen-Editor und Logo-Seite starten offline wie bisher; kein Token in einem Cache; nicht im Spiel-iframe.
  Gegenproben (von Hand, müssen rot werden): `'gemeinsam.js'` aus `SHELL` in `sw.js` entfernen → Offline-Test rot;
  eine Kopie einer Funktion (z. B. `mitGeste`) zurück in `logo.html` → Quelltextprüfung rot.
- `tests/flyer.test.js` – Flyer & Infografiken mit Mock-API (Ordnerliste, Datei und `git/blobs/<sha>` wie GitHub, Datei
  nur mit Accept raw) und einem Mini-Paket nur aus Platzhaltern (2 Flyer, 1 Infografik mit SVG-Beschriftung, alle sechs
  Markierungen mit Werten wie im Paket-Format: `data-t="t1"`, `data-s="s1"` mit `data-status="run"`/`"ok"`,
  `data-block`/`data-zaehler`, `data-stand="kurz"`/`"lang"`):
  ohne Paket; Import (Kopfzeile, Paket-Zeile, 3 Kacheln als Shadow-DOM-Vorschau auf Kachelbreite, Paket-CSS nur im
  Shadow Root, Chips nur für Kategorien mit Dokumenten, gespeichert ohne Token, unbekannte Felder bleiben, nach Neuladen
  da); Import-Fehler (kein JSON, falsches Format, fehlerhaft, zu neu: nichts überschrieben); Vollbild „1 / 3“, ←/→ und
  ‹/› ohne Umlauf, Wischen, Esc/Backspace, Tasten wirkungslos mit Fokus in einem Eingabefeld (Text, Datum, Zeit,
  Zahl, Regler, Farbe, Auswahlknopf, Auswahlliste, `textarea`, `contenteditable`, im Shadow Root) und mit
  Strg/Cmd/Alt, auf Knöpfen und Kontrollkästchen blättern die Pfeile; Schriftanpassung (kurz → `--s` 1.42, lang →
  zwischen 0.80 und 1.42 ohne Hinweis, sehr lang → 0.80 und „Text zu lang“ an Kachel und Vollbild, `.fill` unter
  90 px `off` – 88 px aus, 92 px bleibt –, Überlauf genau ab `clientHeight + 2`); Schriften erst nach der Frist
  (Kacheln, Vollbild und Druck danach mit der echten Schrift angepasst, „Text zu lang“ neu); Bereinigung (`script`, `onerror`, `javascript:`-Link,
  externe `url()` in CSS und `style`, `\75 rl(`, `image-set`, `@import`, `link`, `iframe`, externe Bilder, SVG-`set`:
  nichts ausgeführt, nichts von außen angefragt, nichts davon im Shadow-DOM, Markierungen bleiben); Paket-Funktionen
  (Format, Versionsvergleich, Datum, CSS bereinigen und zerlegen, Wurzel-Selektoren); Online-Prüfung (ohne lokales
  Paket sofort geladen, Token nur im Header, gleicher sha → keine Datei-Anfrage, neuer sha → Banner, „Laden“ ersetzt
  das Paket auch nach Neuladen, ältere Version → „Trotzdem laden“, 404, falscher Dateiname, offline, abgelehntes
  Token, kaputte Datei, ohne Token keine Anfrage, formatVersion 2, nie zwei Prüfungen gleichzeitig, Intervall,
  Zeitlimit; nach einem Import neu bewertet, „Laden“ übernimmt keine inzwischen ältere Fassung, Import derselben Datei →
  „Aktuell“ ohne Banner, „Laden“ nach Neuladen lädt genau die angebotene Fassung über `git/blobs/<sha>`, Import
  während des ersten Online-Ladens bleibt); PDF per `page.pdf` (eine A4-Seite je Flyer, Infografik über zwei Seiten,
  auch über `beforeprint` ohne Knopf; Seiten ohne Rand laut Content-Stream, `position:fixed` nur auf der Seite seines
  Flyers, `@page :first`/`:left`/`!important` des Pakets ändern A4 nicht, Druck-Container ohne `box-shadow`, `filter`,
  Hintergrund o. Ä.); Isolation (`:host`-Regel mit `!important` im Paket-CSS bzw. als `<style>` bleibt im Kachelbild,
  ✕ bleibt bedienbar; Seiten-Variablen wirken nicht ins Dokument, hell wie dunkel; `@font-face` mit Schriftnamen der
  Seite ändert die Seite nicht, `@font-face` aus `@layer`/`@supports`/`@media` wirkt; `url(#…)` außerhalb von
  `fill`/`stroke`/`clip-path`/`filter`/`marker` lädt nichts); Bild (PNG 1588 × 2246 bzw. 2160 × doppelte Höhe über den Teilen-Dialog, Pixel aus dem Paket-CSS, nur mit
  Nutzergeste, über 16 777 216 Pixel verkleinert, Selbstprobe scheitert bzw. Canvas „tainted“ → „Bild“ aus); offline
  aus der App-Hülle samt Schriften, „Flyer ›“ offline aktiv, Token in keinem Cache und nicht in IndexedDB; fehlende
  Module (auch Bearbeiten); IndexedDB-Upgrade auf eine neuere Version nicht blockiert; ohne IndexedDB; Layout 320–1400 px (Kacheln und Vollbild,
  Tippflächen ≥ 44 × 44 px, Neu-Skalieren); Dateien (`sw.js`, `pages.yml`, Tools-Knopf, Skripte, CSP, kein
  `innerHTML` & Co., kein `localStorage.setItem`, `contain:paint` um jedes Dokument, Variablen- und Schriftliste in
  `flyer-paket.js` passend zu `flyer.html`). Gegenproben (von Hand, müssen rot werden): in `flyer-paket.js`
  `'script'` aus `WEG_ELEMENTE` nehmen, das Entfernen der `on*`-Attribute abschalten oder jedes Ziel erlauben (auch
  „#…“ überall) → Bereinigung rot; in `flyer-online.js` den sha-Vergleich (`sha === lokal.basisSha`) abschalten →
  „gleicher sha“ rot; in `flyer-ansicht.js` den Überlauf nie melden, `.fill` nie ausblenden, `FILL_MIN_PX` auf 60 oder
  die Toleranz auf `+ 50` setzen → Schriftanpassung rot; `spaeteSchriften` leeren → „Schriften erst nach der Frist“
  rot; `'flyer.html'` aus `SHELL` in `sw.js` entfernen → Offline-Test rot; `contain:paint` in `flyer.html` entfernen →
  Isolation und PDF rot; `!important` aus der eigenen `@page`-Regel nehmen oder `margin:10mm` setzen → PDF rot;
  `box-shadow` an `.druck-seite` → PDF rot; in `flyer.js` `nachImport` nicht aufrufen oder `nurWennLeer` übergehen
  bzw. in `flyer-online.js` „Laden“ über den Pfad statt den sha laden → jeweilige Online-Gegenbeispiele rot.

- `tests/flyer-v2.test.js` (F3a, ohne Browser) – a) Umwandlung v1 → v2 verlustfrei (HTML bytegleich, Kategorien →
  Ordner, 1.1 in V1, unbekannte Felder bleiben, Prüfung v2); b) Versionen (Unter-/Hauptversion, Kopie unabhängig, 1.1
  nie löschbar, Ausblenden, Beschreibung ≤ 80); c) Ordner (verschachtelt, mehrfach zugeordnet, „Alle“ ohne Doppelte,
  Verschieben ohne Kreis, Löschen erhält Seiten); d) Seiten (Vorlagen mit gültigen Markierungen, Kopie, Kennungen `N…`
  nie wiederverwendet, Original nie löschbar, Ausblenden); ZIP (CRC-32 gegen `zlib.crc32`, eigener ZIP-Leser) und CSV
  (BOM, „;“, Umlaute, CRLF), Dateinamen nur ASCII.
- `tests/flyer-f3a.test.js` (F3a, Chromium, Helfer `tests/flyer-hilfe.js`) – Versionen, Ordner, Seiten, Sichern/Einspielen
  mit Struktur (e), Abgleich mit Strukturkonflikten (f), Export „Grafiken & Daten“ (g: Erkennung, PNG 2× mit Pixeln der
  Seite, echte SVG und SVG mit eingebettetem HTML, CSV/JSON mit der Änderungsschicht, Einzelauswahl, ZIP der Version,
  Teilen-Weg) und die Oberfläche auf dem iPhone (i: 390 px ohne waagerechtes Scrollen, Tippflächen ≥ 44 px, Ordner 2 je
  Reihe, Backspace in Tafeln und Textfeldern).
- `tests/flyer-echt.test.js` (h, nur lokal) – läuft nur mit `FLYER_ECHT=/pfad/aether-flyer-paket.json` (das echte Paket
  kommt nie ins Repo oder in die CI, sonst übersprungen): stellt jede Seite mit dem Code vor F3a (`git archive` von
  `FLYER_ALT_COMMIT`, Standard `3e35c4f`, oder `FLYER_ALT=<Verzeichnis>`) und dem neuen Code dar und vergleicht Pixel für
  Pixel, zählt die Grafiken je Seite und misst die Paketgröße; Ausgaben (nur Zahlen und Kennungen) nach `FLYER_AUSGABE`.
  Gewollte Abweichungen stehen ausdrücklich in `ERWARTET`: IG-Technik-2 bekommt seit PR #37 zwei Zähler-Zeilen
  (3069 → 3095 px). Je Seite muss die Zahl der neu angelegten Zähler genau `ERWARTET` entsprechen (sonst 0) und die
  Mehrhöhe stimmen; nach Entfernen genau dieser Zähler muss die Seite pixelgleich sein (38 von 38 wie erwartet).
- `tests/flyer-pptx.test.js` (PowerPoint-Export, Chromium, Platzhalter) – a) „Alle als PowerPoint“ = Seiten von „Alle
  als PDF“ (ohne ausgeblendete, Ordner nur der Ordner, Fortschritt und Sperre); b) Vollbild genau eine Folie; c)
  Foliengrößen A4/16:9, Bild vollständig eingepasst und mittig (auch hohe Infografik); d) Notizen (Id, Titel, Stand,
  Sonderzeichen); e) Dateinamen (Alle, Ordner mit Umlaut, Einzelseite); f) Auswahl merkt sich die Variante, Esc und
  Tippen daneben ohne Export, Tastatur, Vollbild bleibt offen; g) Datei gültig (Pflichtteile, Content-Types,
  Beziehungen, wohlgeformtes XML, JPEG lesbar); Weitergabe (Teilen, Hinweis „Teilen“, Fehlermeldung); h) Layout auf
  1024 × 768, 1366 × 1024 und 844 × 390. Die Datei wird unabhängig vom Schreiber gelesen (ZIP-Leser, JPEG-SOF).
- `tests/flyer-pptx-messung.test.js` (nur lokal mit `FLYER_ECHT`, sonst übersprungen) – „Alle als PowerPoint“ mit dem
  echten Paket in beiden Formaten: Folienzahl, Größe, Dauer, größte Folie; Ziel unter ca. 25 MB.
- Gegenproben PowerPoint (von Hand, müssen rot werden): in `flyer-pptx.js` das Bild nicht mittig setzen (`x: 0, y: 0`)
  → c) rot; „Stand“ aus den Notizen nehmen → d) rot; die Seiten aus `aktuelleListe()` statt `druckListe()` nehmen → a)
  rot; Esc nicht behandeln → f) rot; in `tests/flyer-echt.test.js` `ERWARTET` leeren bzw. `mehrPx` ändern → h) rot.
- Gegenproben F3a (von Hand, müssen rot werden): in `flyer-paket.js` das HTML bei der Umwandlung verändern (`trim()`) →
  a) rot; in `flyer-struktur.js` die Version flach kopieren (`Object.assign({}, q)`) → b) rot, die Herkunftsprüfung in
  `seiteLoeschen` abschalten → d) rot, beim Verschieben nur `ziel === id` prüfen → c) und Ordner-Test rot; in
  `flyer-zip.js` die CRC verfälschen → ZIP-Tests rot; in `flyer-grafik.js` das BOM weglassen → CSV-Tests rot.

Mit `AETHER_REAL_BUILD=/pfad/zu/builds/<hash> npm test` läuft zusätzlich ein echter Emscripten-Build durch den Mock.
Screenshots landen in `tests/output/`.

Icons neu erzeugen (nach Änderungen an `icons/icon.svg`): `npm run icons`.

## Deployment

`.github/workflows/pages.yml` testet jeden Pull Request und veröffentlicht `main` (`index.html`, `sw.js`,
`manifest.json`, `engine-map.json`, `webgpu-check.html` mit eingesetztem Commit, `screen-editor.html`, `logo.html`,
`gemeinsam.js`, `flyer.html` mit `flyer.js`, `flyer-paket.js`, `flyer-struktur.js`, `flyer-speicher.js`, `flyer-ansicht.js`,
`flyer-online.js`, `flyer-export.js`, `flyer-zip.js`, `flyer-aenderungen.js`, `flyer-bearbeiten.js`, `flyer-uebersicht.js`,
`flyer-grafik.js` und `flyer-pptx.js` (F3b-Module ebenso), `vendor/` mit three.js und Lizenzen, `fonts/` mit den Schriften des Logo-Editors, `icons/`) auf GitHub Pages
(alle Actions sind auf Commit-SHAs gepinnt). Einmalig in den Repo-Einstellungen unter
**Settings → Pages → Source** „GitHub Actions“ auswählen.
