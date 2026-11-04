# aether-dashboard

Statische Web-App, mit der sich die Web-Builds von [Aether](https://github.com/konstantin9ezm/aether)
auf iPad und iPhone starten lassen. Sie besteht aus einer einzigen `index.html` mit eingebettetem
CSS und JavaScript. Es gibt keine externen Skripte und keinen Build-Schritt.

## Benutzung

1. Die Seite über GitHub Pages öffnen (in Safari: Teilen → „Zum Home-Bildschirm“, dann startet sie ohne Browserleisten).
2. Beim ersten Start ein **Fine-grained Personal Access Token** eingeben:
   - Repository access: *Only select repositories* → nur `konstantin9ezm/aether`
   - Repository permissions: **Contents: Read-only**
   - mit Ablaufdatum
3. Build auswählen (Standard: neuester) → **Spielen**.

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

## Entwicklung & Tests

```sh
npm ci
npx playwright install chromium
npm test
```

Die Tests (`tests/e2e.test.js`) bauen die GitHub-REST-API mit Playwright-Routing nach und prüfen die Seite in
Headless Chromium als Desktop, iPhone 13 und iPad Pro 11. Mit
`AETHER_REAL_BUILD=/pfad/zu/builds/<hash> npm test` läuft zusätzlich ein echter Emscripten-Build durch den Mock.
Screenshots landen in `tests/output/`.

Icons neu erzeugen (nach Änderungen an `icons/icon.svg`): `npm run icons`.

## Deployment

`.github/workflows/pages.yml` testet jeden Pull Request und veröffentlicht `main` auf GitHub Pages
(alle Actions sind auf Commit-SHAs gepinnt). Einmalig in den Repo-Einstellungen unter
**Settings → Pages → Source** „GitHub Actions“ auswählen.
