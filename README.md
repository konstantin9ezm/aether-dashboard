# aether-dashboard

Statische Web-App, mit der sich die Web-Builds von [Aether](https://github.com/konstantin9ezm/aether)
auf iPad und iPhone starten lassen. Eine zweite Ansicht **Projekt** zeigt den Stand des Projekts.
Die App besteht aus einer einzigen `index.html` mit eingebettetem CSS und JavaScript plus der
Datendatei `engine-map.json`. Es gibt keine externen Skripte und keinen Build-Schritt.

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
  zwischengespeichert. Ein zweiter Start desselben Builds lädt also nichts neu.
- Das Spiel läuft in einem `sandbox`-iframe **ohne** `allow-same-origin`. Es bekommt die Dateien per `postMessage`
  und kann weder das Token noch den `localStorage` der Seite lesen. `fetch`/`XMLHttpRequest` auf Build-Dateien
  werden innerhalb des iframes aus dem Speicher beantwortet.
- Fehlermeldungen gibt es für: falsches, abgelaufenes oder widerrufenes Token (401), fehlende Berechtigung (403),
  Rate-Limit (mit Uhrzeit, ab wann es wieder geht), kein Zugriff aufs Repo, fehlender Branch, fehlende `index.json`,
  fehlenden Build-Ordner und Verbindungsprobleme.

Hinweis: Weil das Spiel isoliert läuft, steht ihm kein eigener `localStorage`/IndexedDB zur Verfügung.

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

- `tests/e2e.test.js` – Spielansicht (Desktop, iPhone 13, iPad Pro 11).
- `tests/project.test.js` – Projektansicht (Desktop, iPad Pro 11 hoch und quer, iPhone 13): alle vier Teile,
  Ampelzustände, deutsche Ortszeit bei fremder Gerätezeitzone, Cache, Tippflächen ≥ 44 px, eine `ROADMAP.md` mit
  unerwarteten Zeilen sowie die Fehlerfälle (kein Token, keine Rechte, Rate-Limit, offline, Token abgelehnt,
  fehlende Dateien, kaputte `engine-map.json`). Mit
`AETHER_REAL_BUILD=/pfad/zu/builds/<hash> npm test` läuft zusätzlich ein echter Emscripten-Build durch den Mock.
Screenshots landen in `tests/output/`.

Icons neu erzeugen (nach Änderungen an `icons/icon.svg`): `npm run icons`.

## Deployment

`.github/workflows/pages.yml` testet jeden Pull Request und veröffentlicht `main` (`index.html`, `manifest.json`,
`engine-map.json`, `icons/`) auf GitHub Pages
(alle Actions sind auf Commit-SHAs gepinnt). Einmalig in den Repo-Einstellungen unter
**Settings → Pages → Source** „GitHub Actions“ auswählen.
