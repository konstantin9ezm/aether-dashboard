# aether-dashboard

Statische Web-App, mit der sich die Web-Builds von [Aether](https://github.com/konstantin9ezm/aether)
auf iPad und iPhone starten lassen. Eine zweite Ansicht **Projekt** zeigt den Stand des Projekts.
Die App besteht aus einer einzigen `index.html` mit eingebettetem CSS und JavaScript, dem Service Worker
`sw.js` (für den Offline-Start, siehe [Offline](#offline)) und der Datendatei `engine-map.json`.
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

## Schnittstelle Spiel ↔ Dashboard (Version 1)

**Die Sandbox bleibt bewusst unverändert** (`sandbox="allow-scripts allow-pointer-lock"`, kein `allow-same-origin`).
Mit `allow-same-origin` hätte das Spiel denselben Ursprung wie das Dashboard und könnte das GitHub-Token lesen.
Stattdessen bittet das Spiel das Dashboard per `postMessage`, Dinge stellvertretend zu erledigen.

Vom Dashboard ins Spiel, beim Start als erstes Skript im `srcdoc` (vor dem Boot-Skript und allen Spielskripten):

```js
window.AETHER_HOST = { version: 1, settings: true, feedback: true, dialogInput: true };
window.AETHER_HOST_SETTINGS = { "<schlüssel>": "<wert>", ... }; // gespeicherte Spiel-Einstellungen, sonst {}
```

Ein neues Spiel erkennt ein altes Dashboard daran, dass `window.AETHER_HOST` fehlt. Ein altes Spiel sendet die
Nachrichten nie, dann passiert im Dashboard nichts.

`dialogInput: true` ist eine rückwärtskompatible Erweiterung innerhalb von Version 1 (`version` bleibt `1`): Nur
ein Dashboard mit diesem Feld versteht `aether:dialog-input`. Ein Spiel schickt die Nachricht nur, wenn
`window.AETHER_HOST.dialogInput === true` ist; ältere Dashboards kündigen sie nicht an (und würden sie ignorieren),
ältere Spiele schicken sie nie, dann bleibt der Dialog wie bisher per Touch/Tastatur bedienbar.

| Richtung | Nachricht | Wirkung |
|---|---|---|
| Spiel → Dashboard | `{ type: "aether:setting", key, value }` | Speichert `value` (String) unter `key`; `value: null` löscht den Schlüssel. Keine Antwort. |
| Spiel → Dashboard | `{ type: "aether:feedback", subject, body }` | Öffnet den Feedback-Dialog. |
| Spiel → Dashboard | `{ type: "aether:feedback-close" }` | Schließt den Dialog (z. B. Controller-Taste B). |
| Spiel → Dashboard | `{ type: "aether:dialog-input", action }` | Controller-Bedienung des offenen Dialogs, `action` genau `"show"`, `"prev"`, `"next"` oder `"press"` (nur bei `dialogInput: true`, siehe unten). |
| Dashboard → Spiel | `{ type: "aether:feedback-state", open: true \| false }` | Nach dem Öffnen und nach jedem Schließen des Dialogs. |

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
- **Schließen** geht über den Knopf, Esc, Antippen außerhalb des Dialogs, `aether:feedback-close` oder das Beenden
  des Spiels (X mit Rückfrage oder `aether:quit`). Danach meldet das Dashboard `open: false`, und der Fokus geht
  zurück ins Spiel-iframe.
- Bedienung: Touch und Maus; Tab/Umschalt+Tab und die Pfeiltasten wechseln zwischen den Knöpfen, Enter/Leertaste
  lösen aus. Beim Öffnen hat „Mail öffnen“ den Fokus. Den Controller liest das Dashboard nicht; das Spiel schickt
  bei B `aether:feedback-close`.

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

1. Der Service Worker `sw.js` liefert die Seite selbst (`index.html`, `manifest.json`, Icons) aus dem Cache
   `aether-shell-v1`, wenn das Netz nicht antwortet. Online holt er immer die aktuelle Seite vom Server
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
   „Aktualisieren“ wiederholt die Online-Prüfung und lädt bei Erfolg die Ansicht.

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
2. **Zeitleiste** – gemergte PRs (`pulls?state=closed&base=main`) und Commits auf `main` (`commits?sha=main`),
   neueste zuerst, mit Titel, PR-Nummer, Datum/Uhrzeit und kurzem Hash. Merge- und Squash-Commits erscheinen als
   PR-Eintrag; Commits, die nur im PR-Branch lagen, werden ausgeblendet. Antippen öffnet den PR (bzw. Commit) auf GitHub.
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

## WebGPU-Check

Eigenständige Seite zum Prüfen der eigenen Geräte (iPad, iPhone; Safari und Home-Bildschirm-App):
**https://konstantin9ezm.github.io/aether-dashboard/webgpu-check.html**. Der Link „WebGPU-Check“
steht in der Kopfzeile oben rechts, links neben dem Umschalter „Spielen | Projekt“ (Build- und Projektansicht;
auf dem iPhone hochkant als Symbol mit derselben 44-px-Tippfläche), und unten auf dem Token-Bildschirm. Auf dem
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
  fehlende Dateien, kaputte `engine-map.json`).
- `tests/host.test.js` – Schnittstelle Spiel ↔ Dashboard im **vollen Chromium** (`channel: "chromium"`, nicht die
  Headless-Shell): Einstellungen speichern/löschen, Ablehnung ungültiger Nachrichten und fremder Quellen, Grenze von
  64 Schlüsseln, `"</script>"` im Wert, „Token löschen“; Feedback-Dialog mit echtem Klick und echter Enter-Taste
  (Nachweis über die Chromium-Meldung „Launched external handler for 'mailto:…'“), Controller-„press“ auf „Mail
  öffnen“ mit und ohne Nutzeraktivierung (sofort Hinweis, kein `mailto:`-Versuch, gezählt per CDP
  `Page.frameRequestedNavigation`), Kürzen auf 2000 Zeichen,
  Zwischenablage (ausgelesen in einem zweiten Kontext), alle Wege zum Schließen samt Fokus zurück ins Spiel, Layout
  auf iPhone 16 Pro quer, iPad Pro 11 quer und Desktop.
- `tests/start-frame.test.js` – Spielstart im Rahmen (Headless Chromium): Tipp im Rahmen startet, Dokument
  (Kennung `doc`) und iframe-Element vor und nach dem Start dieselben, kein erneutes Laden, Attribute unverändert;
  Nachrichten aus falscher Quelle (Seite, Klon-iframe, alter Start-Rahmen) starten nichts; Build-Wechsel und Beenden
  führen zu neuen Rahmen; Start per Enter mit Touch-Emulation (`maxTouchPoints` 5 per CDP) zeigt den Hinweis, der
  Tipp darauf kommt im Spiel an und blendet ihn aus, Feedback-Dialog blendet ihn aus, Desktop ohne Hinweis; Layout
  (iPhone 16 Pro quer, iPad Pro 11 quer, Desktop: Knopf an der Stelle und in der Größe des früheren Knopfs, ±1 px);
  `?fps=1` mit und ohne Parameter.
- `tests/webgpu-check.test.js` – WebGPU-Check im **vollen Chromium** mit WebGPU aus SwiftShader
  (`--enable-unsafe-webgpu --use-angle=swiftshader --enable-features=Vulkan --use-vulkan=swiftshader`): lädt ohne
  Token und ohne Anfrage an api.github.com, alle Abschnitte gefüllt, Probe direkt und im iframe grün, iframe-Attribute
  gleich denen aus `createGameFrame()`, Bildtakt-Stufen a/b/d (c übersprungen), Ergebnistext mit Pflicht-Schlüsseln,
  Kopieren, mailto ≤ 2000 Zeichen; Rückfall ohne die Flags („kein Adapter“, WebGL-Rückfall) und ohne
  `navigator.gpu` („WebGPU fehlt“); Layout auf iPhone 16 Pro hoch/quer und iPad quer; Link „WebGPU-Check“ auf dem
  Token-Bildschirm und in der Kopfzeile (Build- und Projektansicht auf iPhone 16 Pro hoch/quer, iPad, Desktop: links
  neben dem Umschalter, gleiche Höhe, Tippfläche ≥ 44 × 44 px per Treffertest, kein Überlappen, einzeilig). Gegenproben (müssen rot
  werden): `AETHER_GEGENPROBE=iframe-attr|mailto|pflicht|safari-os node --test tests/webgpu-check.test.js`.

Mit `AETHER_REAL_BUILD=/pfad/zu/builds/<hash> npm test` läuft zusätzlich ein echter Emscripten-Build durch den Mock.
Screenshots landen in `tests/output/`.

Icons neu erzeugen (nach Änderungen an `icons/icon.svg`): `npm run icons`.

## Deployment

`.github/workflows/pages.yml` testet jeden Pull Request und veröffentlicht `main` (`index.html`, `sw.js`,
`manifest.json`, `engine-map.json`, `webgpu-check.html` mit eingesetztem Commit, `icons/`) auf GitHub Pages
(alle Actions sind auf Commit-SHAs gepinnt). Einmalig in den Repo-Einstellungen unter
**Settings → Pages → Source** „GitHub Actions“ auswählen.
