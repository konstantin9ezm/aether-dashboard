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
3. Build auswählen (Standard: neuester) → **Spielen**.
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

Hinweis: Weil das Spiel isoliert läuft, steht ihm kein eigener `localStorage`/IndexedDB zur Verfügung.

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
   HTML-Kommentare werden ignoriert. Pro Abschnitt gibt es einen Balken erledigt/gesamt, PR-Verweise sind antippbar.
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
  fehlende Dateien, kaputte `engine-map.json`). Mit
`AETHER_REAL_BUILD=/pfad/zu/builds/<hash> npm test` läuft zusätzlich ein echter Emscripten-Build durch den Mock.
Screenshots landen in `tests/output/`.

Icons neu erzeugen (nach Änderungen an `icons/icon.svg`): `npm run icons`.

## Deployment

`.github/workflows/pages.yml` testet jeden Pull Request und veröffentlicht `main` (`index.html`, `sw.js`,
`manifest.json`, `engine-map.json`, `icons/`) auf GitHub Pages
(alle Actions sind auf Commit-SHAs gepinnt). Einmalig in den Repo-Einstellungen unter
**Settings → Pages → Source** „GitHub Actions“ auswählen.
