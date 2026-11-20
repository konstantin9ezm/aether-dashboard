// Tests für F3b der Flyer-Seite in Chromium: Migration v3 → v4 (a), Bibliothek (c), Größen und Safari-Hinweis (d),
// Online-Abgleich mit nachgebauten Antworten von aether-medien (e), Player mit einer zur Laufzeit erzeugten WebM (f),
// Vorlage „Bild / Video“ mit Druck/Bild/Export (g), Löschen und Sicherung (h), iPhone-Breite (i), Repo-Inhalt (j).
// Alle Medien sind synthetisch und entstehen im Test (Canvas, MediaRecorder, wenige Bytes GIF/PNG); nichts davon liegt
// im Repo. Mini-Paket nur aus Platzhaltern (tests/flyer-hilfe.js).
// Aufruf: node --test tests/flyer-f3b.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const H = require('./flyer-hilfe');
const { assert, mitSeite, oeffneFlyer, importiere, text, ruhe, tafel, tafelKnopf, paketV1, idb } = H;

before(H.starte);
after(H.beende);

const MED = '/repos/konstantin9ezm/aether-medien';
const RAW = 'application/vnd.github.raw+json';
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP4z8DwnwECJgYGBgYAPPQD/S5Yj/YAAAAASUVORK5CYII=', 'base64');
const gitSha = (b) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + b.length + '\0'), b])).digest('hex');
// Animiertes GIF, 1 × 1 Pixel, n Bilder zu je verz/100 s (synthetisch)
function gif(n = 2, verz = 50) {
  const t = [Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0x80, 0, 0, 255, 0, 0, 0, 0, 255])];
  for (let i = 0; i < n; i++) t.push(Buffer.from([0x21, 0xf9, 4, 0, verz, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, i % 2 ? 0x4c : 0x44, 1, 0]));
  t.push(Buffer.from([0x3b]));
  return Buffer.concat(t);
}
// WebM im Browser (Canvas + MediaRecorder, VP8) mit ms Dauer → Byte-Liste
const webm = (page, ms) => page.evaluate(async (ms) => {
  const c = document.createElement('canvas'); c.width = 160; c.height = 90;
  const x = c.getContext('2d');
  const rec = new MediaRecorder(c.captureStream(25), { mimeType: 'video/webm;codecs=vp8' });
  const teile = [];
  rec.ondataavailable = (e) => { if (e.data.size) teile.push(e.data); };
  let n = 0;
  const uhr = setInterval(() => { x.fillStyle = n % 2 ? '#2a9d8f' : '#e76f51'; x.fillRect(0, 0, 160, 90); x.fillStyle = '#fff'; x.fillRect((n * 7) % 160, 30, 20, 30); n++; }, 40);
  const fertig = new Promise((r) => { rec.onstop = r; });
  rec.start(100);
  await new Promise((r) => setTimeout(r, ms));
  rec.stop(); await fertig; clearInterval(uhr);
  return Array.from(new Uint8Array(await new Blob(teile).arrayBuffer()));
}, ms);
// Dateien über die Bibliothek hinzufügen (wie nach der Auswahl im Datei-Eingabefeld) → Ergebnisse
const hinzu = (page, dateien, ordner) => page.evaluate(async ([dateien, ordner]) => {
  // fake: nur Name, Größe, Typ (über 500 MB, wird vorher abgelehnt); nullen: so viele Null-Bytes, im Browser erzeugt
  const fs = dateien.map((d) => (d.fake ? { name: d.name, size: d.size, type: d.type } : new File([d.nullen !== undefined ? new Uint8Array(d.nullen) : new Uint8Array(d.bytes)], d.name, { type: d.type })));
  const r = await window.AetherFlyerMedienTafeln.dateienHinzufuegen(fs, ordner || null);
  const t = document.getElementById('tafelInhalt').textContent;
  window.AetherFlyerUebersicht.schliesseTafel();
  return { r: r.map((x) => (x.datei ? { id: x.datei.id, name: x.datei.name, art: x.datei.art, groesse: x.datei.groesse, hinweise: x.hinweise } : { name: x.name, fehler: x.fehler })), text: t.replace(/\s+/g, ' ') };
}, [dateien.map((d) => (d.fake || d.nullen !== undefined ? d : Object.assign({}, d, { bytes: Array.from(d.bytes) }))), ordner]);
const bibliothek = async (page) => { await page.click('#reiter button[data-reiter="bibliothek"]'); await page.waitForFunction(() => !document.getElementById('bibliothek').hidden); };
const kachelStatus = (page) => page.$$eval('#bAbschnitte .m-kachel', (ks) => ks.map((k) => [k.dataset.id, k.querySelector('.m-status').dataset.status]));
const medien = (page) => page.evaluate(() => (window.AetherFlyer.paketV2().medien || { dateien: [] }).dateien.map((d) => d.id));
const vbWurzel = null;   // Platzhalter-Argument (der Shadow Root wird in der Seite direkt gelesen; kein eval wegen der CSP)
// Nachgebaute API von aether-medien: modus 'ok' | 'kein401' | 'kein403' | 'kein404' | 'leer' | 'haengt'
function medienApi(repo) {
  return async (route) => {
    const req = route.request(), url = new URL(req.url());
    if (!url.pathname.startsWith(MED)) return route.fallback();
    repo.anfragen.push({ pfad: url.pathname, accept: req.headers().accept || '', auth: /^Bearer /.test(req.headers().authorization || ''), modus: repo.modus });
    const cors = { 'access-control-allow-origin': '*' };
    const json = (st, o) => route.fulfill({ status: st, headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
    if (repo.modus === 'haengt') return;   // keine Antwort (Zeitlimit)
    if (repo.modus === 'kein401') return json(401, { message: 'Bad credentials' });
    if (repo.modus === 'kein403') return json(403, { message: 'Resource not accessible by personal access token' });
    if (repo.modus === 'kein404') return json(404, { message: 'Not Found' });
    if (url.pathname === MED + '/contents/medien') return repo.modus === 'leer' ? json(404, { message: 'Not Found' }) : json(200, repo.dateien.map((d) => ({ name: d.name, path: 'medien/' + d.name, sha: gitSha(d.inhalt), size: d.inhalt.length, type: 'file' })));
    if (url.pathname === MED) return json(200, { full_name: 'konstantin9ezm/aether-medien', private: true });
    if (url.pathname.startsWith(MED + '/git/blobs/')) {
      if (repo.blobHaengt) return;
      const d = repo.dateien.find((x) => gitSha(x.inhalt) === url.pathname.split('/').pop());
      return d ? route.fulfill({ status: 200, headers: { ...cors, 'content-type': RAW }, body: d.inhalt }) : json(404, { message: 'Not Found' });
    }
    return json(404, { message: 'Not Found' });
  };
}

describe('F3b a) Speicher', () => {
  test('IndexedDB-Migration 3 → 4: alle Stores und Einträge (Basis, Online-Stand, Änderungen, Struktur, Gerät) bleiben unverändert, Store „medien“ kommt dazu', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await page.goto(H.umgebung.baseUrl + 'manifest.json');
      const v2 = H.paketV1();
      const basis = { paket: v2, quelle: 'online', sha: H.SHA_A, uebernommen: '2026-01-01T00:00:00.000Z' };
      const online = { sha: H.SHA_A, version: v2.version, stand: v2.stand, geprueft: '2026-01-01T00:00:00.000Z' };
      const eintrag = { ver: '1.1', dok: 'S1', k: 't2', art: 'text', alt: 'Platzhalter eins', neu: 'Vor F3b geändert', exportiert: null, zeit: '2026-01-02T00:00:00.000Z', konflikt: null };
      const struktur = { paket: null, konflikte: [], exportiert: null };
      await page.evaluate(([b, o, e, s]) => new Promise((resolve, reject) => {
        const r = indexedDB.open('aether-flyer', 3);
        r.onupgradeneeded = () => { for (const n of ['basis', 'online', 'aenderungen', 'struktur', 'geraet']) r.result.createObjectStore(n); };
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result, tx = db.transaction(['basis', 'online', 'aenderungen', 'struktur', 'geraet'], 'readwrite');
          tx.objectStore('basis').put(b, 'aktuell');
          tx.objectStore('online').put(o, 'stand');
          tx.objectStore('aenderungen').put(e, 'e:1.1\nS1\ntext\nt2');
          tx.objectStore('aenderungen').put({ exporte: ['2026-01-01.1'] }, 'meta');
          tx.objectStore('struktur').put(s, 'lokal');
          tx.objectStore('geraet').put('1.1', 'version');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }), [basis, online, eintrag, struktur]);
      await oeffneFlyer(page);
      await ruhe(page);
      const db = await idb(page);
      assert.deepEqual(Object.keys(db).sort(), ['aenderungen', 'basis', 'geraet', 'medien', 'online', 'struktur']);
      assert.equal(db.basis.version, 4);
      assert.deepEqual(db.basis.werte, [basis], 'basis unverändert');
      assert.deepEqual(db.online.werte, [online], 'online unverändert');
      assert.deepEqual(db.aenderungen.werte.sort((a, b) => (a.dok ? 1 : -1)), [{ exporte: ['2026-01-01.1'] }, eintrag], 'Änderungen unverändert');
      assert.deepEqual(db.struktur.werte, [struktur]);
      assert.deepEqual(db.geraet.werte, ['1.1']);
      assert.deepEqual(db.medien.schluessel, [], 'medien leer');
      assert.match(await text(page, '#status'), /· 1 Änderung nicht exportiert$/);
      assert.deepEqual(log.errors, []);
    });
  });
});

describe('F3b c) Bibliothek', () => {
  test('Reiter „Seiten | Bibliothek“ (gemerkt), Ordner verschachtelt mit Pfad und ‹/Backspace, Mehrfachzuordnung, Filter je Version und „nicht verwendet“, „Zuletzt hinzugefügt“, Menü „···“ der Ordner', async () => {
    await mitSeite({}, async ({ page, log }) => {
      page.on('dialog', (d) => d.accept());
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      assert.deepEqual(await page.$$eval('#reiter button', (bs) => bs.map((b) => [b.textContent, b.getAttribute('aria-pressed')])), [['Seiten', 'true'], ['Bibliothek', 'false']]);
      assert.ok(await page.isHidden('#reiterZusatz'));
      await bibliothek(page);
      assert.equal(await text(page, '#reiterZusatz'), 'gilt für alle Versionen');
      assert.ok(await page.isHidden('#kacheln') && await page.isHidden('#ordnerKacheln'), 'Seiten verborgen');
      assert.equal(await text(page, '#bPfadListe'), 'Bibliothek');
      assert.equal(await text(page, '#bAbschnitte'), 'Noch keine Dateien – „+ Hinzufügen“.');
      assert.deepEqual(await page.$$eval('#bFilter option', (os) => os.map((o) => o.value)), ['alle', '1.1', 'nicht-verwendet']);
      assert.match(await text(page, '#bPlatz'), /^Speicher: .+ belegt · .+ frei$/);
      // Ordner: „Aus Flyern“ (nur lesen) zuerst, dann „+ Neuer Ordner“
      assert.deepEqual(await page.$$eval('#bOrdner .ordner-kachel', (ks) => ks.map((k) => [k.dataset.ordner, k.querySelector('.ok-name').textContent, !!k.querySelector('.ok-mehr'), (k.querySelector('.ok-marke') || {}).textContent || ''])),
        [['aus-flyern', 'Aus Flyern', false, 'nur lesen']]);
      await page.click('#bNeuerOrdner');
      await page.fill('#tafelFeld', 'Fotos');
      await tafelKnopf(page, 'Übernehmen');
      await page.click('#bOrdner .ordner-kachel[data-ordner="mo1"] .ok-oeffnen');
      assert.equal(await text(page, '#bPfadListe'), 'Bibliothek›Fotos');
      await page.click('#bNeuerOrdner');
      await page.fill('#tafelFeld', 'Unterordner');
      await tafelKnopf(page, 'Übernehmen');
      await page.click('#bOrdner .ordner-kachel[data-ordner="mo2"] .ok-oeffnen');
      assert.equal(await text(page, '#bPfadListe'), 'Bibliothek›Fotos›Unterordner');
      // Hinzufügen in den geöffneten Ordner (Unterordner), dann zusätzlich nach „Fotos“
      const r = await hinzu(page, [{ name: 'Kardos Ring.png', type: 'image/png', bytes: PNG }, { name: 'Logo dreht sich.gif', type: 'image/gif', bytes: gif(3) }], 'mo2');
      assert.deepEqual(r.r.map((x) => [x.id, x.name, x.art]), [['m1', 'Kardos Ring', 'foto'], ['m2', 'Logo dreht sich', 'animation']]);
      await page.evaluate(() => window.AetherFlyer.aendereStruktur((p) => window.AetherFlyerMedien.dateiInOrdner(p, 'm1', ['mo1', 'mo2'])));
      assert.deepEqual(await kachelStatus(page), [['m1', 'geraet'], ['m2', 'geraet']]);
      assert.deepEqual(await page.$$eval('#bAbschnitte .m-kachel', (ks) => ks.map((k) => [k.querySelector('.m-name').textContent, k.querySelector('.m-art').textContent, (k.querySelector('.m-dauer') || {}).textContent || '', !!k.querySelector('img')])),
        [['Kardos Ring', 'PNG · 1 KB', '', true], ['Logo dreht sich', 'GIF · 0:01 · 1 KB', 'GIF', true]]);
      await page.keyboard.press('Backspace');
      assert.equal(await text(page, '#bPfadListe'), 'Bibliothek›Fotos');
      assert.deepEqual((await kachelStatus(page)).map((k) => k[0]), ['m1'], 'Mehrfachzuordnung: m1 auch in Fotos');
      assert.equal(await text(page, '#bOrdner .ordner-kachel[data-ordner="mo2"] .ok-zahl'), '2 Dateien');
      await page.click('#bPfadZurueck');
      assert.equal(await text(page, '#bOrdner .ordner-kachel[data-ordner="mo1"] .ok-zahl'), '1 Datei · 1 Ordner');
      assert.deepEqual(await page.$$eval('#bAbschnitte .t-abschnitt', (a) => a.map((x) => x.textContent)), ['Zuletzt hinzugefügt']);
      assert.deepEqual((await kachelStatus(page)).map((k) => k[0]), ['m2', 'm1'], 'neueste zuerst');
      // Filter: Version 1.2 (Kopie) mit einer Seite, die m2 zeigt
      await page.evaluate(async () => {
        const ST = window.AetherFlyerStruktur, M = window.AetherFlyerMedien;
        await window.AetherFlyer.aendereStruktur((p) => { ST.versionKopieren(p, '1.1', '1.2'); const s = ST.seiteAnlegen(p, '1.2', { vorlage: 'bild-video', heute: '2026-11-20', medium: 'm2' }); return s; });
        void M;
      });
      assert.deepEqual(await page.$$eval('#bFilter option', (os) => os.map((o) => o.textContent)), ['Alle', '1.1', '1.2', 'nicht verwendet']);
      await page.selectOption('#bFilter', '1.2');
      assert.deepEqual((await kachelStatus(page)).map((k) => k[0]), ['m2']);
      await page.selectOption('#bFilter', '1.1');
      assert.match(await text(page, '#bAbschnitte'), /In Version 1\.1 wird keine Datei verwendet\./);
      await page.selectOption('#bFilter', 'nicht-verwendet');
      assert.deepEqual((await kachelStatus(page)).map((k) => k[0]), ['m1']);
      await page.selectOption('#bFilter', 'alle');
      // Ordner-Menü: Umbenennen, Verschieben (nie in sich selbst), Löschen (Dateien bleiben)
      await page.click('#bOrdner .ordner-kachel[data-ordner="mo1"] .ok-mehr');
      assert.deepEqual((await tafel(page)).knoepfe, ['Öffnen', 'Umbenennen', 'Verschieben …', 'Löschen']);
      await tafelKnopf(page, 'Verschieben …');
      assert.deepEqual((await tafel(page)).knoepfe, ['Bibliothek (oberste Ebene)'], 'nicht in sich selbst oder den eigenen Unterordner');
      await page.click('#tafelZu');
      await page.click('#bOrdner .ordner-kachel[data-ordner="mo1"] .ok-mehr');
      await tafelKnopf(page, 'Löschen');
      await page.waitForFunction(() => !document.querySelector('#bOrdner .ordner-kachel[data-ordner="mo1"]'));
      assert.deepEqual(await medien(page), ['m1', 'm2'], 'Dateien bleiben');
      assert.ok(await page.$('#bOrdner .ordner-kachel[data-ordner="mo2"]'), 'Unterordner wandert nach oben');
      // Reiter bleibt gemerkt (nur dieses Gerät)
      await page.reload();
      await oeffneFlyer(page, null);
      await page.waitForFunction(() => !document.getElementById('bibliothek').hidden);
      assert.equal(await page.getAttribute('#reiter button[data-reiter="bibliothek"]', 'aria-pressed'), 'true');
      await page.click('#reiter button[data-reiter="seiten"]');
      assert.ok(await page.isVisible('#kacheln'));
      assert.deepEqual(log.errors, []);
    });
  });

  test('„Aus Flyern“: alle Grafiken der gewählten Version nach Seite gruppiert, nur lesen (kein Menü, Löschen gesperrt); „Als eigene Datei übernehmen“ und „Grafik aus einem Flyer“ legen eine PNG-Datei an', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await bibliothek(page);
      assert.equal(await text(page, '#bOrdner .ordner-kachel[data-ordner="aus-flyern"] .ok-zahl'), 'Grafiken · automatisch');
      await page.click('#bOrdner .ordner-kachel[data-ordner="aus-flyern"] .ok-oeffnen');
      await page.waitForFunction(() => /Grafiken auf 4 Seiten/.test(document.getElementById('bAbschnitte').textContent), null, { timeout: 30000 });
      assert.equal(await text(page, '#bPfadListe'), 'Bibliothek›Aus Flyern');
      assert.equal(await page.$$eval('#bOrdner > *', (x) => x.length), 0, 'kein „+ Neuer Ordner“ in „Aus Flyern“');
      const gruppen = await page.$$eval('#bAbschnitte .f-seite', (fs) => fs.map((f) => [f.dataset.seite, f.querySelectorAll('.g-mini').length, [...f.querySelectorAll('.m-status')].every((s) => s.dataset.status === 'flyer')]));
      assert.deepEqual(gruppen.map((g) => g[0]), ['S1', 'S2', 'E1', 'I1']);
      assert.ok(gruppen.every((g) => g[1] > 0 && g[2]), 'jede Seite mit Grafiken, Status grau „Flyer“');
      const summe = gruppen.reduce((x, g) => x + g[1], 0);
      assert.match(await text(page, '#bAbschnitte p[role="status"]'), new RegExp('^' + summe + ' Grafiken auf 4 Seiten$'));
      // Menü einer Grafik: übernehmen, Löschen gesperrt
      await page.click('#bAbschnitte .f-seite[data-seite="S1"] .g-mini[data-nr="2"]');
      const t = await tafel(page);
      assert.equal(t.titel, 'S1 · Grafik 02');
      assert.deepEqual(t.knoepfe, ['Als eigene Datei übernehmen', 'Löschen (nur eigene Dateien)']);
      assert.ok(await page.isDisabled('#tafelInhalt button:has-text("Löschen")'), '„Aus Flyern“ nicht löschbar');
      await tafelKnopf(page, 'Als eigene Datei übernehmen');
      await page.waitForFunction(() => (window.AetherFlyer.paketV2().medien || { dateien: [] }).dateien.length === 1);
      const d = await page.evaluate(() => window.AetherFlyer.paketV2().medien.dateien[0]);
      assert.deepEqual([d.id, d.name, d.art, d.mime, d.herkunft, d.quelle, d.datei], ['m1', 'S1 · Kennzahlen', 'grafik', 'image/png', 'flyer-kopie', { version: '1.1', seite: 'S1', grafik: 2 }, 's1-kennzahlen_m1.png']);
      assert.ok(d.breite > 0 && d.hoehe > 0 && d.groesse > 0);
      assert.equal(await page.$$eval('#bOrdner .ordner-kachel', (k) => k.length), 0, 'in „Aus Flyern“ keine Ordner-Kacheln');
      await page.click('#bPfadZurueck');
      assert.equal(await text(page, '#bOrdner .ordner-kachel[data-ordner="aus-flyern"] .ok-zahl'), summe + ' Grafiken · automatisch');
      assert.equal(await text(page, '#bAbschnitte .m-kachel .m-art'), 'PNG · aus Flyer · ' + await page.evaluate(() => window.AetherFlyerMedien.groesseText(window.AetherFlyer.paketV2().medien.dateien[0].groesse)));
      // „+ Hinzufügen“ → „Grafik aus einem Flyer“ → Seite → Grafik
      await page.click('#bHinzufuegen');
      assert.deepEqual((await tafel(page)).knoepfe, ['Aus FotosFotos und Videos aus der Fotos-App ›', 'Aus DateienJPG, PNG, WebP, HEIC, GIF, SVG, MP4, MOV, WebM ›', 'Grafik aus einem Flyereine Grafik einer Seite als eigene Datei übernehmen ›']);
      assert.equal(await text(page, '#tafelInhalt > p.t-klein'), 'Ziel: Bibliothek');
      await page.click('#tafelInhalt button[data-k="flyer"]');
      await tafelKnopf(page, 'I1 · Platzhalter-Infografik');
      await page.waitForSelector('#tafelInhalt .g-mini');
      assert.ok(await page.isDisabled('#tafelInhalt button.g-sel'), 'ohne Wahl nicht übernehmbar');
      await page.click('#tafelInhalt .g-mini[data-nr="1"]');
      await page.click('#tafelInhalt button.g-sel');
      await page.waitForFunction(() => window.AetherFlyer.paketV2().medien.dateien.length === 2);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paketV2().medien.dateien[1].name), 'I1 · Kasten');
      assert.deepEqual(log.errors, []);
    });
  });
});

describe('F3b d) Größen und Hinweise im Browser', () => {
  test('25 MiB genau ohne Hinweis, ein Byte mehr mit Hinweis (Kachel, Ergebnis, „Medien online stellen“); über 500 MB und zu wenig Platz mit Meldung – nichts still abgelehnt; Format nicht unterstützt mit Grund', async () => {
    await mitSeite({ init: [() => {
      const echt = navigator.storage.estimate.bind(navigator.storage);
      // Platz: 40 MiB frei, solange window.__wenigPlatz gesetzt ist (nachgebaut)
      navigator.storage.estimate = () => (window.__wenigPlatz ? Promise.resolve({ usage: 0, quota: 40 * 1024 * 1024 }) : echt());
    }] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await bibliothek(page);
      const MiB = 1024 * 1024;
      const r = await hinzu(page, [
        { name: 'Genau 25.png', type: 'image/png', nullen: 25 * MiB },
        { name: 'Ein Byte mehr.png', type: 'image/png', nullen: 25 * MiB + 1 },
        { name: 'Riesig.mp4', type: 'video/mp4', size: 500 * MiB + 1, fake: true },
        { name: 'Notiz.txt', type: 'text/plain', bytes: Buffer.from('x') }]);
      assert.deepEqual(r.r.map((x) => [x.name, x.groesse || null, (x.hinweise || []).filter((h) => /25 MiB/.test(h)).length, x.fehler || '']), [
        ['Genau 25', 26214400, 0, ''],
        ['Ein Byte mehr', 26214401, 1, ''],
        ['Riesig.mp4', null, 0, 'Datei zu groß: 500 MB (höchstens 500 MB je Datei).'],
        ['Notiz.txt', null, 0, 'Format nicht unterstützt (txt). Möglich: JPG, PNG, WebP, HEIC, GIF, SVG, MP4, MOV, WebM.']]);
      assert.match(r.text, /Fertig: 2 von 4 hinzugefügt/);
      assert.match(r.text, /Ein Byte mehrFoto · PNG · 25,0 MB \(tatsächliche Größe\)Zu groß für den Upload im Browser \(GitHub: höchstens 25 MiB je Datei\) – bleibt vorerst nur auf diesem Gerät\./);
      assert.deepEqual(await page.$$eval('#bAbschnitte .m-kachel', (ks) => ks.map((k) => [k.dataset.id, !!k.querySelector('.m-gross')])), [['m2', true], ['m1', false]]);
      // Zu wenig Platz: klare Meldung
      await page.evaluate(() => { window.__wenigPlatz = true; });
      const r2 = await hinzu(page, [{ name: 'Gross.png', type: 'image/png', nullen: 35 * MiB }]);
      assert.match(r2.r[0].fehler, /^Nicht genug Speicher auf diesem Gerät: frei 40,0 MB, nötig etwa 46,8 MB\./);
      await page.evaluate(() => { window.__wenigPlatz = false; });
      // „Medien online stellen“: beide Dateien, Hinweis nur bei 25 MiB + 1, nur die erste in „Alle sichern“
      await page.click('#bOnline');
      await page.waitForFunction(() => /^Bereit/.test(document.getElementById('mSicherungStand').textContent), null, { timeout: 20000 });
      assert.equal(await text(page, '#mOnlineKopf'), '2 neue Dateien nur auf diesem Gerät · zusammen 50,0 MB');
      assert.deepEqual(await page.$$eval('#tafelInhalt .m-zeile', (zs) => zs.map((z) => [z.querySelector('.m-dname > div').textContent, z.classList.contains('zu-gross'), z.querySelector('.m-dgroesse').textContent])),
        [['genau-25_m1.png', false, '25,0 MB'], ['ein-byte-mehr_m2.png', true, '25,0 MB']]);
      assert.equal(await text(page, '#mSicherungStand'), 'Bereit: 1 Datei als ZIP (25,0 MB)');
      assert.deepEqual(log.errors, []);
    });
  });

  test('Safari-Hinweis (F10) dauerhaft in der Bibliothek nur in Safari außerhalb der Home-Bildschirm-App (nachgebaut) und nur bei Dateien „nur Gerät“', async () => {
    const ua = 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    for (const app of [false, true]) {
      await mitSeite({ init: [[(a) => {
        Object.defineProperty(navigator, 'userAgent', { get: () => a.ua });
        const mm = window.matchMedia.bind(window);
        window.matchMedia = (q) => (/display-mode:\s*standalone/.test(q) ? { matches: a.app, media: q, addEventListener() {}, removeEventListener() {} } : mm(q));
      }, { ua, app }]].map(([fn, arg]) => ({ content: '(' + fn + ')(' + JSON.stringify(arg) + ')' })) }, async ({ page, log }) => {
        await oeffneFlyer(page);
        await importiere(page, paketV1());
        await bibliothek(page);
        assert.ok(await page.isHidden('#bSafari'), 'ohne Dateien kein Hinweis');
        await hinzu(page, [{ name: 'Bild.png', type: 'image/png', bytes: PNG }]);
        if (app) assert.ok(await page.isHidden('#bSafari'), 'Home-Bildschirm-App: kein Hinweis');
        else assert.equal(await text(page, '#bSafari'), 'Nur auf diesem Gerät: in Safari können Daten nach einigen Tagen ohne Besuch gelöscht werden – Home-Bildschirm-App nutzen oder online stellen');
        assert.deepEqual(log.errors, []);
      });
    }
  });
});

describe('F3b e) Online-Abgleich mit aether-medien (nachgebaute API)', () => {
  test('„Online prüfen“: Liste → Status grün; zweites Gerät lädt fehlende Dateien bis 5 MiB per git/blobs roh nach (Prüfsumme), danach offline verfügbar; nur lesend, mit Token', async () => {
    const repo = { modus: 'ok', dateien: [], anfragen: [] };
    let paket;
    await mitSeite({ withToken: true }, async ({ context, page, log }) => {
      await page.route('https://api.github.com/**', medienApi(repo));
      await oeffneFlyer(page);
      assert.equal(repo.anfragen.length, 0, 'ohne Dateien keine Anfrage an aether-medien');
      await bibliothek(page);
      await hinzu(page, [{ name: 'Kardos.png', type: 'image/png', bytes: PNG }, { name: 'Dreht.gif', type: 'image/gif', bytes: gif(2) }]);
      assert.deepEqual(await kachelStatus(page), [['m2', 'geraet'], ['m1', 'geraet']]);
      repo.dateien = [{ name: 'kardos_m1.png', inhalt: PNG }];
      await page.click('#btnOnline');
      await page.waitForFunction(() => document.querySelector('#bAbschnitte .m-kachel[data-id="m1"] .m-status').dataset.status === 'online');
      assert.deepEqual(await kachelStatus(page), [['m2', 'geraet'], ['m1', 'online']]);
      assert.equal(await text(page, '#bAbschnitte .m-kachel[data-id="m1"] .m-status'), 'online');
      assert.ok(repo.anfragen.every((a) => a.auth), 'mit Token');
      assert.deepEqual([...new Set(repo.anfragen.map((a) => a.pfad))], [MED + '/contents/medien']);
      const gespeichert = (await idb(page)).medien;
      assert.equal(gespeichert.werte[gespeichert.schluessel.indexOf('online')].liste[0].sha, gitSha(PNG), 'Liste gespeichert (ohne Token)');
      assert.doesNotMatch(JSON.stringify(gespeichert.werte.filter((w) => !(w && w.blob))), /github_pat/);
      paket = await page.evaluate(() => window.AetherFlyer.paketV2());
      assert.deepEqual(log.errors, []);
      void context;
    });
    // Zweites Gerät: Paket mit den Metadaten, Inhalte nur online
    repo.anfragen = [];
    repo.dateien.push({ name: 'dreht_m2.gif', inhalt: gif(2) });
    await mitSeite({ withToken: true }, async ({ context, page, log }) => {
      await page.route('https://api.github.com/**', medienApi(repo));
      await oeffneFlyer(page);
      await importiere(page, paket);
      await bibliothek(page);
      await page.click('#btnOnline');
      await page.waitForFunction(() => window.AetherFlyerMedien.hatInhalt('m1') && window.AetherFlyerMedien.hatInhalt('m2'), null, { timeout: 15000 });
      const blobs = repo.anfragen.filter((a) => a.pfad.includes('/git/blobs/'));
      assert.deepEqual(blobs.map((a) => [a.pfad.split('/').pop(), a.accept]).sort(), [[gitSha(PNG), RAW], [gitSha(gif(2)), RAW]].sort(), 'roh, je Datei einmal');
      const db = await idb(page);
      assert.ok(db.medien.schluessel.includes('d:m1') && db.medien.schluessel.includes('d:m2'), 'im Geräte-Speicher');
      // Ohne Netz zur API (Anfragen scheitern wie offline): Neu geöffnet zeigt die Bibliothek alles aus dem Speicher,
      // der Status kommt aus der gespeicherten Liste
      await page.route('https://api.github.com/**', (r) => r.abort('internetdisconnected'));
      await page.reload();
      await oeffneFlyer(page, null);
      await page.waitForFunction(() => !document.getElementById('bibliothek').hidden);
      await page.waitForFunction(() => document.querySelectorAll('#bAbschnitte .m-kachel img').length === 2);
      assert.deepEqual((await kachelStatus(page)).sort(), [['m1', 'online'], ['m2', 'online']], 'Status aus der gespeicherten Liste');
      await context.setOffline(true);
      await page.click('#bAbschnitte .m-kachel[data-id="m2"]');
      await page.waitForSelector('#tafelInhalt .m-vorschau img');
      assert.equal(await page.isDisabled('#tafelInhalt button[data-k="teilen"]'), false, 'offline aus dem Speicher teilbar');
      await context.setOffline(false);
      assert.deepEqual(log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
    });
  });

  test('Zeitlimit (Liste hängt), fehlender Zugriff bei 401, 403 und 404 (einmalige Meldung, keine Wiederholungsschleife, „Online prüfen“ fragt erneut), Repo ohne Ordner medien/, offline: keine Anfrage, „offline nicht verfügbar“', async () => {
    for (const modus of ['kein401', 'kein403', 'kein404']) {
      const repo = { modus: 'ok', dateien: [], anfragen: [] };
      await mitSeite({ withToken: true, init: [() => { window.AETHER_TEST_FLYER_INTERVALL_MS = 150; }] }, async ({ page, log }) => {
        await page.route('https://api.github.com/**', medienApi(repo));
        await oeffneFlyer(page);
        await importiere(page, paketV1());
        await hinzu(page, [{ name: 'Kardos.png', type: 'image/png', bytes: PNG }]);
        repo.modus = modus;
        await page.click('#btnOnline');
        await page.waitForFunction(() => window.AetherFlyerMedienOnline.keinZugriff());
        await page.waitForFunction(() => /Kein Zugriff auf aether-medien/.test(document.getElementById('toast').textContent));
        assert.equal(await text(page, '#toast'), 'Kein Zugriff auf aether-medien – Repo anlegen bzw. den Token um das Repo erweitern');
        // Bis „kein Zugriff“ feststeht, können eine Prüfung des Intervalls (150 ms) und die des Klicks zugleich laufen – je
        // Durchgang Liste (bei 404 dazu die Probe des Repos); danach (unten) keine einzige weitere Anfrage
        const je = modus === 'kein404' ? 2 : 1, vorher = repo.anfragen.filter((a) => a.modus === modus);
        assert.ok(vorher.length >= je && vorher.length <= 2 * je, modus + ': ' + vorher.length + ' Anfragen bis „kein Zugriff“');
        assert.ok(vorher.every((a) => /\/contents\/medien$|aether-medien$/.test(a.pfad)), 'nur Liste und Repo-Probe');
        await page.waitForTimeout(300);   // eine zweite, schon gestartete Prüfung endet
        const n = repo.anfragen.length;
        // Intervall (150 ms) und online-Ereignisse: keine weiteren Anfragen
        await page.evaluate(() => { for (let i = 0; i < 5; i++) window.dispatchEvent(new Event('online')); });
        await page.waitForTimeout(1200);
        assert.equal(repo.anfragen.length, n, modus + ': keine Wiederholungsschleife');
        await bibliothek(page);
        assert.equal(await text(page, '#bZugriff'), 'Kein Zugriff auf aether-medien – Repo anlegen bzw. den Token um das Repo erweitern. Alles andere funktioniert weiter; erneut prüfen mit „Online prüfen“.');
        assert.deepEqual(await kachelStatus(page), [['m1', 'geraet']], 'alles andere funktioniert weiter');
        // ausdrücklich: genau ein neuer Durchgang, die Meldung kommt nicht noch einmal als Toast
        await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
        await page.click('#btnOnline');
        await page.waitForFunction((n) => window.AetherFlyerMedienOnline.anfragen().length >= n + 1, n);
        await page.waitForTimeout(300);
        assert.equal(repo.anfragen.length - n, je, 'genau ein neuer Durchgang');
        assert.equal(await text(page, '#toast'), '', 'Meldung nur einmal');
        assert.deepEqual(log.errors.filter((e) => !/40[134]/.test(e)), []);
      });
    }
    // Repo vorhanden, Ordner medien/ fehlt: kein Fehler, Status orange; Zeitlimit; offline
    const repo = { modus: 'leer', dateien: [], anfragen: [] };
    await mitSeite({ withToken: true }, async ({ context, page, log }) => {
      await page.route('https://api.github.com/**', medienApi(repo));
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await hinzu(page, [{ name: 'Kardos.png', type: 'image/png', bytes: PNG }]);
      assert.equal(await page.evaluate(() => window.AetherFlyerMedienOnline.pruefe({ ausdruecklich: true })), 'aktuell');
      assert.deepEqual(repo.anfragen.map((a) => a.pfad), [MED + '/contents/medien', MED]);
      assert.equal(await page.evaluate(() => window.AetherFlyerMedienOnline.keinZugriff()), false);
      repo.modus = 'haengt';
      const t0 = Date.now();
      assert.equal(await page.evaluate(() => window.AetherFlyerMedienOnline.pruefe({ ausdruecklich: true })), 'offline', 'Zeitlimit wie offline');
      const dauer = Date.now() - t0;
      assert.ok(dauer >= 2500 && dauer < 8000, 'Zeitlimit der Tests (3 s): ' + dauer + ' ms');
      // offline: keine Anfrage
      repo.anfragen = [];
      await context.setOffline(true);
      assert.equal(await page.evaluate(() => window.AetherFlyerMedienOnline.pruefe({ ausdruecklich: true })), 'offline');
      assert.equal(repo.anfragen.length, 0);
      // fehlender Inhalt offline: „offline nicht verfügbar“
      await page.evaluate(async () => {
        const M = window.AetherFlyerMedien;
        await window.AetherFlyer.aendereStruktur((p) => M.dateiAnlegen(p, { name: 'Fehlt', art: 'foto', mime: 'image/png', groesse: 10, endung: 'png', gitSha: 'c'.repeat(40) }));
      });
      await bibliothek(page);
      await page.click('#bAbschnitte .m-kachel[data-id="m2"]');
      await page.waitForFunction(() => /offline nicht verfügbar/.test(document.getElementById('tafelInhalt').textContent));
      await context.setOffline(false);
      assert.deepEqual(log.errors.filter((e) => !/404|ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
    });
  });
});

describe('F3b f) Player (WebM, zur Laufzeit erzeugt)', () => {
  test('Abspielen/Pause, Zeit, Springen, Ton, Schleife, Tempo, Vollbild-Knopf, Leertaste außerhalb von Textfeldern, Tippflächen ≥ 44 px (iPad und iPhone), Laden erst beim Abspielen, Object-URL wieder freigegeben', async () => {
    for (const viewport of [{ width: 1194, height: 834 }, { width: 390, height: 844 }]) {
      await mitSeite({ viewport }, async ({ page, log }) => {
        await oeffneFlyer(page);
        await importiere(page, paketV1());
        const bytes = await webm(page, 3000);
        assert.ok(bytes.length < 100 * 1024, 'kleine WebM: ' + bytes.length);
        const r = await hinzu(page, [{ name: 'Flug durch Kardos.webm', type: 'video/webm', bytes: Buffer.from(bytes) }]);
        assert.equal(r.r[0].art, 'video');
        const d = await page.evaluate(() => window.AetherFlyer.paketV2().medien.dateien[0]);
        assert.ok(d.dauer > 2 && d.dauer < 4, 'Dauer ' + d.dauer);
        assert.ok(d.startbild > 0 && d.startbild <= 1, 'Startbild aus der ersten Sekunde: ' + d.startbild);
        assert.deepEqual([d.breite, d.hoehe], [160, 90]);
        await page.evaluate(() => window.AetherFlyerMedienTafeln.neueSeite('m1'));
        await page.waitForFunction(() => window.AetherFlyerAnsicht.vollbildHost() && window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('.ae-pl'));
        await page.waitForTimeout(200);
        const pl = await page.evaluate((w) => {
          const r = window.AetherFlyerAnsicht.vollbildHost().shadowRoot, p = r.querySelector('.ae-pl'), v = p.querySelector('video');
          return { preload: v.preload, playsinline: v.hasAttribute('playsinline'), muted: v.muted, loop: v.loop, autoplay: v.autoplay, paused: v.paused, poster: v.poster.slice(0, 5), zeit: p.querySelector('.ae-pl-zeit').textContent,
            masse: [...p.querySelectorAll('.ae-pl-leiste button, .ae-pl-leiste input')].map((b) => { const x = b.getBoundingClientRect(); return [b.getAttribute('aria-label'), Math.round(x.width), Math.round(x.height)]; }) };
        }, vbWurzel);
        assert.deepEqual([pl.preload, pl.playsinline, pl.muted, pl.loop, pl.autoplay, pl.paused, pl.poster], ['none', true, false, false, false, true, 'blob:'], 'Standard: Ton an, Schleife aus, Autostart aus, nichts geladen');
        assert.equal(pl.zeit, '0:00 / ' + (d.dauer >= 3 ? '0:03' : '0:02'));
        assert.deepEqual(pl.masse.map((m) => m[0]), ['Abspielen', 'Zeitleiste', 'Ton an', 'Schleife', 'Tempo', 'Vollbild']);
        for (const [n, w, h] of pl.masse) assert.ok(w >= 44 && h >= 44, `${viewport.width} px: ${n} ${w} × ${h} ≥ 44 px`);
        const v = (e) => page.evaluate((e) => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('video')[e], e);
        const klick = (sel) => page.evaluate(([w, sel]) => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector(sel).click(), [vbWurzel, sel]);
        // Abspielen
        await klick('.ae-pl-spiel');
        await page.waitForFunction((w) => { const v = window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('video'); return !v.paused && v.currentTime > 0.3; }, vbWurzel);
        assert.match(await v('src'), /^blob:/);
        assert.equal(await page.evaluate((w) => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('.ae-pl-spiel').getAttribute('aria-label'), vbWurzel), 'Pause');
        // Leertaste (Fokus auf der Bühne, kein Textfeld) → Pause; in einem Textfeld nicht
        await page.focus('#vbBuehne');
        await page.keyboard.press(' ');
        assert.equal(await v('paused'), true, 'Leertaste: Pause');
        await page.keyboard.press(' ');
        assert.equal(await v('paused'), false, 'Leertaste: Abspielen');
        await page.keyboard.press(' ');
        await page.click('#vbModus button[data-modus="text"]');
        await page.evaluate((w) => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('[data-t="t1"]').click(), vbWurzel);
        await page.waitForSelector('#vbEditFeld', { state: 'visible' });
        await page.focus('#vbEditFeld');
        await page.keyboard.press(' ');
        assert.equal(await v('paused'), true, 'im Textfeld schreibt die Leertaste');
        assert.match(await page.inputValue('#vbEditFeld'), / $/);
        await page.click('#vbEditAb');
        await page.click('#vbModus button[data-modus="ansehen"]');
        await page.waitForFunction((w) => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('.ae-pl video'), vbWurzel);
        // Springen über die Zeitleiste
        await page.evaluate((w) => { const z = window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('.ae-pl input[type=range]'); z.value = '1.5'; z.dispatchEvent(new Event('input', { bubbles: true })); }, vbWurzel);
        await page.waitForFunction((w) => Math.abs(window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('video').currentTime - 1.5) < 0.2, vbWurzel);
        await page.waitForFunction((w) => /^0:01 \//.test(window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('.ae-pl-zeit').textContent), vbWurzel);
        // Ton, Schleife, Tempo
        await klick('.ae-pl-ton');
        assert.equal(await v('muted'), true);
        assert.equal(await page.evaluate((w) => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('.ae-pl-ton').getAttribute('aria-pressed'), vbWurzel), 'false');
        await klick('.ae-pl-ton');
        assert.equal(await v('muted'), false);
        await klick('.ae-pl-schleife');
        assert.equal(await v('loop'), true);
        const tempi = [];
        for (let i = 0; i < 4; i++) { await klick('.ae-pl-tempo'); tempi.push([await v('playbackRate'), await page.evaluate((w) => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('.ae-pl-tempo').textContent, vbWurzel)]); }
        assert.deepEqual(tempi, [[1.5, '1,5×'], [2, '2×'], [0.5, '0,5×'], [1, '1×']]);
        // Schließen: Player weg, Object-URL freigegeben und angehalten
        await page.keyboard.press('Escape');
        assert.equal(await page.evaluate(() => window.AetherFlyerPlayer.anzahl()), 0, 'kein Player mehr offen');
        assert.deepEqual(log.errors, []);
      });
    }
  });

  test('Autostart nur mit „Ton aus“ (sonst abgelehnt mit Hinweis); mit „Ton aus“ startet das Video stumm von selbst; Schleife aus der Seite; Menü einer Datei mit Player und Kenndaten; MP4/MOV-Wiedergabe dieses Chromium nur berichtet', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      const bytes = await webm(page, 2000);
      await hinzu(page, [{ name: 'Clip.webm', type: 'video/webm', bytes: Buffer.from(bytes) }]);
      const s = await page.evaluate(() => window.AetherFlyerMedienTafeln.neueSeite('m1').then((s) => s.id));
      await page.waitForFunction(() => !document.querySelector('#vbModus button[data-modus="medium"]').hidden);
      await page.click('#vbModus button[data-modus="medium"]');
      assert.ok(await page.isVisible('#vbMedium'));
      assert.equal(await page.inputValue('#vbMediumWahl'), 'm1');
      await page.click('#vbMediumAutostart');
      await page.waitForFunction(() => /Autostart nur mit „Ton aus“/.test(document.getElementById('vbMediumHinweis').textContent));
      assert.equal(await page.isChecked('#vbMediumAutostart'), false, 'abgelehnt');
      assert.doesNotMatch(await page.evaluate((s) => window.AetherFlyer.sicht().dokumente.find((d) => d.id === s).html, s), /data-autostart/);
      await page.click('#vbMediumTonAus');
      await page.waitForFunction((s) => /data-ton="aus"/.test(window.AetherFlyer.sicht().dokumente.find((d) => d.id === s).html), s);
      await page.click('#vbMediumSchleife');
      await page.waitForFunction((s) => /data-schleife="an"/.test(window.AetherFlyer.sicht().dokumente.find((d) => d.id === s).html), s);
      await page.click('#vbMediumAutostart');
      await page.waitForFunction((s) => /data-autostart="an"/.test(window.AetherFlyer.sicht().dokumente.find((d) => d.id === s).html), s);
      await page.waitForFunction((w) => { const v = window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('video'); return v && !v.paused && v.muted && v.loop; }, vbWurzel, { timeout: 10000 });
      // Paket: nur der Verweis und die Schalter
      const html = await page.evaluate((s) => window.AetherFlyer.sicht().dokumente.find((d) => d.id === s).html, s);
      assert.match(html, /<div class="medium" data-medium="m1" style="[^"]*" data-ton="aus" data-schleife="an" data-autostart="an"><\/div>/);
      // Direkter Weg (Modell) lehnt Autostart mit Ton an ebenfalls ab
      const fehler = await page.evaluate((s) => window.AetherFlyer.aendereStruktur((p) => window.AetherFlyerMedien.seiteMitMedium(p, '1.1', s, { tonAus: false })).then(() => '', (e) => e.title), s);
      assert.match(fehler, /Autostart nur mit „Ton aus“/);
      await page.keyboard.press('Escape');
      // Menü einer Datei: Player, Kenndaten, Knöpfe
      await bibliothek(page);
      await page.click('#bAbschnitte .m-kachel[data-id="m1"]');
      await page.waitForSelector('#tafelInhalt .ae-pl');
      assert.match(await text(page, '#tafelInhalt .m-kenn'), /^Video · WebM · 160 × 90 · 0:0\d · \d+ KB · nur auf diesem Gerät$/);
      assert.deepEqual((await tafel(page)).knoepfe.filter((k) => !['▶', 'Ton', 'Schleife', '1×', 'Vollbild'].includes(k)), ['Abspielen', 'Umbenennen', 'In Ordner …', 'In Seite einsetzen …', 'Herunterladen / Teilen', 'Bearbeiten (ab F3d)', 'Löschen']);
      assert.ok(await page.isDisabled('#tafelInhalt button:has-text("Bearbeiten (ab F3d)")'));
      await tafelKnopf(page, 'Abspielen');
      await page.waitForFunction(() => { const v = document.querySelector('#tafelInhalt video'); return v && !v.paused; });
      await page.focus('#tafelZu');
      await page.evaluate(() => document.activeElement.blur());
      await page.keyboard.press(' ');
      assert.equal(await page.evaluate(() => document.querySelector('#tafelInhalt video').paused), true, 'Leertaste in der Tafel');
      const mp4 = await page.evaluate(() => { const v = document.createElement('video'); return { mp4: v.canPlayType('video/mp4; codecs="avc1.42E01E"'), mov: v.canPlayType('video/quicktime') }; });
      console.log('# Chromium der Tests: MP4 (H.264) „' + mp4.mp4 + '“, MOV „' + mp4.mov + '“ – MP4/MOV werden am Gerät geprüft (Checkliste)');
      assert.deepEqual(log.errors, []);
    });
  });
});

describe('F3b g) Vorlage „Bild / Video“', () => {
  test('„+ Seite“ mit „Bild / Video“ (freigeschaltet), data-medium als einziger Verweis, „In Seite einsetzen …“, Platzhalter „Medium fehlt“; PDF, „Bild“ und Grafik-Export zeigen das Startbild', async () => {
    await mitSeite({}, async ({ page, log }) => {
      page.on('dialog', (d) => d.accept());
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await page.click('#btnNeueSeite');
      assert.equal(await page.isDisabled('#tafelInhalt .vorlage[data-vorlage="bild-video"]'), false);
      await page.click('#tafelInhalt .vorlage[data-vorlage="bild-video"]');
      await page.click('#btnAnlegen');
      await page.waitForFunction(() => window.AetherFlyerAnsicht.offenesDokument() && window.AetherFlyerAnsicht.offenesDokument().id === 'N1');
      assert.equal(await page.evaluate((w) => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('[data-medium]').textContent, vbWurzel), 'Kein Medium gewählt – Modus „Medium“');
      const html0 = await page.evaluate(() => window.AetherFlyer.sicht().dokumente.find((d) => d.id === 'N1').html);
      assert.match(html0, /<div class="medium" data-medium="" style="position:relative;aspect-ratio:16\/9;/);
      assert.match(html0, /<h3 data-t="t4">Zu sehen<\/h3><p class="pp" data-t="t5">Text<\/p>/);
      await page.keyboard.press('Escape');
      const bytes = await webm(page, 2000);
      await hinzu(page, [{ name: 'Clip.webm', type: 'video/webm', bytes: Buffer.from(bytes) }, { name: 'Foto.png', type: 'image/png', bytes: PNG }]);
      await bibliothek(page);
      await page.click('#bAbschnitte .m-kachel[data-id="m1"]');
      await tafelKnopf(page, 'In Seite einsetzen …');
      assert.deepEqual((await tafel(page)).knoepfe, ['N1 · Neue Seite (Bild / Video) (noch leer)', 'Neue Seite mit diesem Medium']);
      await tafelKnopf(page, 'N1 · Neue Seite (Bild / Video) (noch leer)');
      await page.waitForFunction(() => /data-medium="m1"/.test(window.AetherFlyer.sicht().dokumente.find((d) => d.id === 'N1').html));
      const pk = await page.evaluate(() => JSON.stringify(window.AetherFlyer.paketV2()));
      assert.ok(pk.length < 60000, 'Paket klein: nur Metadaten (' + pk.length + ' Zeichen)');
      assert.doesNotMatch(pk, /data:video|data:image\/jpeg|blob:/, 'kein Inhalt im Paket');
      // Kachel zeigt das Startbild (Bild), Vollbild den Player
      await page.click('#reiter button[data-reiter="seiten"]');
      await page.waitForFunction(() => { const h = document.querySelector('#kacheln .kachel[data-id="N1"] .flyer-host'); return h && h.shadowRoot.querySelector('[data-medium] img[data-medium-bild]'); });
      // Druck (PDF) und „Bild“: Startbild als Bild, kein Video
      await page.evaluate(async () => { const d = window.AetherFlyer.sicht().dokumente.find((x) => x.id === 'N1'); await window.AetherFlyerExport.druckvorbereitung([d]); });
      const druck = await page.evaluate(() => { const h = document.querySelector('#druck .flyer-host'); const m = h.shadowRoot.querySelector('[data-medium]'); return [!!m.querySelector('img[data-medium-bild]'), !!m.querySelector('video')]; });
      assert.deepEqual(druck, [true, false], 'PDF: Startbild');
      const bild = await page.evaluate(async () => {
        const d = window.AetherFlyer.sicht().dokumente.find((x) => x.id === 'N1');
        const b = await window.AetherFlyerExport.seitenBild(d);
        const img = b.klon.querySelector('[data-medium] img');
        return { ok: !!b.img, src: img ? img.getAttribute('src').slice(0, 23) : null, video: !!b.klon.querySelector('video') };
      });
      assert.deepEqual(bild, { ok: true, src: 'data:image/jpeg;base64,', video: false }, '„Bild“: Startbild als data:-URL');
      const ex = await page.evaluate(async () => {
        const d = window.AetherFlyer.sicht().dokumente.find((x) => x.id === 'N1');
        const s = await window.AetherFlyerGrafik.seiteVorbereiten(d, '1.1', {});
        return s.grafiken.map((g) => g.art);
      });
      assert.ok(ex.includes('bild'), 'Grafik-Export erkennt das Startbild als Bild: ' + ex.join(','));
      // Platzhalter „Medium fehlt“ nach dem Löschen der Datei
      await bibliothek(page);
      await page.click('#bAbschnitte .m-kachel[data-id="m1"]');
      await tafelKnopf(page, 'Löschen');
      await page.waitForFunction(() => window.AetherFlyer.paketV2().medien.dateien.length === 1);
      await page.click('#reiter button[data-reiter="seiten"]');
      await page.waitForFunction(() => { const h = document.querySelector('#kacheln .kachel[data-id="N1"] .flyer-host'); return h && h.shadowRoot.querySelector('[data-medium]').textContent === 'Medium fehlt (m1)'; });
      assert.deepEqual(log.errors, []);
    });
  });
});

describe('F3b h) Löschen und Sicherung', () => {
  test('Löschen: Rückfrage nennt die Seiten (Version · Kennung) und ob die Datei online bleibt; abgelehnt ändert nichts; Inhalt und Bilder weg; Sicherung v3 mit Bibliotheks-Metadaten, Einspielen auf einem zweiten Gerät; Export ohne Inhalte', async () => {
    let sicherung, exportiert;
    const fragen = [];
    await mitSeite({}, async ({ page, log }) => {
      let antwort = false;
      page.on('dialog', (d) => { fragen.push(d.message()); return antwort ? d.accept() : d.dismiss(); });
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await hinzu(page, [{ name: 'Kardos.png', type: 'image/png', bytes: PNG }, { name: 'Dreht.gif', type: 'image/gif', bytes: gif(2) }]);
      await page.evaluate(async () => {
        const ST = window.AetherFlyerStruktur;
        await window.AetherFlyer.aendereStruktur((p) => { ST.seiteAnlegen(p, '1.1', { vorlage: 'bild-video', heute: '2026-11-20', medium: 'm1' }); ST.versionKopieren(p, '1.1', '1.2'); });
      });
      await page.evaluate(() => window.AetherFlyerMedien.setzeOnline([window.AetherFlyer.paketV2().medien.dateien[0].gitSha], new Date().toISOString(), 'ok'));
      await bibliothek(page);
      await page.click('#bAbschnitte .m-kachel[data-id="m1"]');
      await tafelKnopf(page, 'Löschen');
      assert.equal(fragen.pop(), 'Datei „Kardos“ löschen? Sie wird verwendet in: 1.1 · N1, 1.2 · N1 – diese Seiten zeigen danach „Medium fehlt (m1)“. Die Datei bleibt im Repo aether-medien (kardos_m1.png), bis du sie dort selbst löschst.');
      assert.deepEqual(await medien(page), ['m1', 'm2'], 'abgelehnt: nichts geändert');
      await page.click('#tafelZu');
      await page.click('#bAbschnitte .m-kachel[data-id="m2"]');
      antwort = true;
      await tafelKnopf(page, 'Löschen');
      assert.equal(fragen.pop(), 'Datei „Dreht“ löschen? Sie liegt nur auf diesem Gerät und ist danach weg.');
      await page.waitForFunction(() => window.AetherFlyer.paketV2().medien.dateien.length === 1);
      assert.deepEqual((await idb(page)).medien.schluessel.filter((k) => /m2$/.test(k)), [], 'Inhalt und Bilder entfernt');
      // Sicherung: Download, Version 3, Struktur mit Bibliotheks-Feldern, ohne Inhalte
      H.ohneTeilen && await page.evaluate(H.ohneTeilen);
      await page.waitForFunction(() => !document.getElementById('btnSichern').disabled);
      const dl = await H.download(page, () => page.click('#btnSichern'));
      sicherung = JSON.parse(dl.puffer.toString('utf8'));
      assert.equal(sicherung.version, 3);
      assert.ok(sicherung.struktur.some((f) => f.k === 'M|*|m1|da') && sicherung.struktur.some((f) => f.k === 'Z|*'));
      assert.doesNotMatch(dl.puffer.toString('utf8'), /data:image|base64|blob:/);
      assert.match(await text(page, '#toast'), /Dateien der Bibliothek nicht darin: über „Medien online stellen“ bzw\. „Alle sichern“/);
      // Paket exportieren: Metadaten ja, Inhalte nein
      const ex = await H.download(page, () => page.click('#btnExport'));
      exportiert = JSON.parse(ex.puffer.toString('utf8'));
      assert.equal(exportiert.formatVersion, 2);
      assert.deepEqual(exportiert.medien.dateien.map((d) => [d.id, d.datei, d.gitSha]), [['m1', 'kardos_m1.png', gitSha(PNG)]]);
      assert.doesNotMatch(ex.puffer.toString('utf8'), /data:image\/(png|jpeg)|blob:/);
      assert.deepEqual(log.errors, []);
    });
    // Zweites Gerät: Sicherung einspielen stellt die Bibliothek (Metadaten) her
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await H.einspielen(page, sicherung);
      assert.deepEqual(await medien(page), ['m1']);
      assert.equal(await page.evaluate(() => window.AetherFlyerMedien.hatInhalt('m1')), false, 'Inhalt nicht in der Sicherung');
      await bibliothek(page);
      assert.equal(await text(page, '#bAbschnitte .m-kachel[data-id="m1"] .m-ersatz'), 'nicht auf diesem Gerät');
      assert.deepEqual(log.errors, []);
    });
  });
});

describe('F3b i) Darstellung', () => {
  test('iPhone hoch (390 px): Bibliothek, Tafeln, Menü und „Medien online stellen“ ohne waagerechtes Scrollen, Tippflächen ≥ 44 px; Seiten ohne Medium unverändert (keine Platzhalter)', async () => {
    await mitSeite({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true, deviceScaleFactor: 3 }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await bibliothek(page);
      await hinzu(page, [{ name: 'Ein sehr langer Dateiname für ein Foto aus der Fotos-App vom iPhone.png', type: 'image/png', bytes: PNG }, { name: 'Dreht.gif', type: 'image/gif', bytes: gif(2) }]);
      const pruefe = async (wo) => {
        const r = await page.evaluate(() => {
          const klein = [];
          for (const b of document.querySelectorAll('button, select, a, input[type=checkbox]')) {
            if (b.closest('[hidden]') || !b.offsetParent || b.closest('.kachel-bild')) continue;
            const x = b.getBoundingClientRect();
            if (x.width < 44 || x.height < 44) klein.push((b.id || b.className || b.textContent).slice(0, 30) + ' ' + Math.round(x.width) + '×' + Math.round(x.height));
          }
          return { breit: document.documentElement.scrollWidth, fenster: window.innerWidth, klein };
        });
        assert.ok(r.breit <= r.fenster, wo + ': kein waagerechtes Scrollen (' + r.breit + ')');
        assert.deepEqual(r.klein.filter((k) => !/^(t-check|g-mini)/.test(k)), [], wo + ': Tippflächen');
      };
      await pruefe('Bibliothek');
      assert.equal(await page.$$eval('#bAbschnitte .m-kacheln', (r) => getComputedStyle(r[0]).gridTemplateColumns.split(' ').length), 2, 'zwei Kacheln je Reihe');
      await page.click('#bHinzufuegen');
      await pruefe('Hinzufügen');
      await page.click('#tafelZu');
      await page.click('#bAbschnitte .m-kachel[data-id="m1"]');
      await pruefe('Menü einer Datei');
      await page.click('#tafelZu');
      await page.click('#bOnline');
      await page.waitForFunction(() => /^Bereit/.test(document.getElementById('mSicherungStand').textContent));
      await pruefe('Medien online stellen');
      await page.click('#tafelZu');
      // Original-Seiten: keine Medien-Elemente in der Darstellung
      await page.click('#reiter button[data-reiter="seiten"]');
      assert.equal(await page.$$eval('#kacheln .flyer-host', (hs) => hs.filter((h) => h.shadowRoot.querySelector('[data-medium-platzhalter], .ae-pl, [data-medium-bild]')).length), 0);
      assert.deepEqual(log.errors, []);
    });
  });
});

describe('F3b j) Kein Medien- und kein Paketinhalt im Repo', () => {
  test('tests/ enthält keine Mediendateien und keine Datei über 1 MB; kein Paket und keine Medien im Repo', () => {
    const ROOT = path.join(__dirname, '..');
    let dateien;
    try { dateien = execFileSync('git', ['-C', ROOT, 'ls-files'], { encoding: 'utf8' }).split('\n').filter(Boolean); } catch (e) {
      dateien = [];
      const geh = (d) => { for (const x of fs.readdirSync(path.join(ROOT, d), { withFileTypes: true })) { if (x.name === '.git' || x.name === 'node_modules' || x.name === 'output') continue; const p = path.join(d, x.name); if (x.isDirectory()) geh(p); else dateien.push(p); } };
      geh('');
    }
    const MEDIEN = /\.(jpe?g|png|webp|heic|heif|gif|mp4|m4v|mov|webm|avif)$/i;
    const inTests = dateien.filter((f) => f.startsWith('tests/') && !f.startsWith('tests/output/'));
    assert.deepEqual(inTests.filter((f) => MEDIEN.test(f)), [], 'keine Mediendateien in tests/ (alle Testmedien entstehen im Test)');
    for (const f of inTests) assert.ok(fs.statSync(path.join(ROOT, f)).size <= 1024 * 1024, f + ' ≤ 1 MB');
    assert.deepEqual(dateien.filter((f) => /aether-flyer-paket\.json$|aether-flyer-aenderungen\.json$|(^|\/)medien\//.test(f)), [], 'kein Paket, keine Sicherung, kein Ordner medien/');
    const erlaubteBilder = dateien.filter((f) => MEDIEN.test(f));
    assert.ok(erlaubteBilder.every((f) => f.startsWith('icons/')), 'Bilder nur die App-Icons: ' + erlaubteBilder.join(', '));
  });
});
