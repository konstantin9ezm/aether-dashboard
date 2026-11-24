// Tests für F3a der Flyer-Seite in Chromium (Versionen, Ordner, neue Seiten, Ausblenden, Struktur-Abgleich, Export
// „Grafiken & Daten“, Oberfläche) mit einem Mini-Paket nur aus Platzhaltern (tests/flyer-hilfe.js).
// Aufruf: node --test tests/flyer-f3a.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const H = require('./flyer-hilfe');
const { assert, mitSeite, oeffneFlyer, importiere, text, ruhe, tafel, tafelKnopf, paketV1, idb } = H;

before(H.starte);
after(H.beende);

const setze = (page, dok, art, k, wert) => page.evaluate(async ([dok, art, k, wert]) => {
  await window.AetherFlyerAenderungen.setze(dok, art, k, wert);
  await window.AetherFlyerAnsicht.aktualisiere(dok);
}, [dok, art, k, wert]);
// Text einer Markierung in der Kachel eines Dokuments
const kachelText = (page, id, t) => page.$eval(`#kacheln .kachel[data-id="${id}"] .flyer-host`, (h, t) => {
  const e = h.shadowRoot.querySelector(`[data-t="${t}"]`); return e ? e.textContent : null;
}, t);
const warteVersion = (page, nr) => page.waitForFunction((nr) => window.AetherFlyer.version() === nr && document.getElementById('versionName').textContent === 'Version ' + nr + ' ▾', nr);

describe('F3a: Versionen (Teil B)', () => {
  test('Knopf und Tafel „Versionen“; Unter-/Hauptversion als vollständige, unabhängige Kopie; Beschreibung, Ausblenden, Löschen; 1.1 nie löschbar; das Gerät merkt sich die Version', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      assert.ok(await page.isHidden('#versionsZeile'), 'ohne Paket kein Versionsknopf');
      await importiere(page, paketV1());
      assert.equal(await text(page, '#btnVersion'), 'Version 1.1 ▾ Ordner V1 · 4 Seiten');
      // Änderung in 1.1, dann Unterversion: Kopie zeigt genau, was 1.1 gerade zeigt
      await setze(page, 'S1', 'text', 't2', 'Geänderter Titel');
      await page.click('#btnVersion');
      let t = await tafel(page);
      assert.equal(t.titel, 'Versionen');
      assert.deepEqual(t.knoepfe, ['1.1 4 Seiten aktuell', '···', '+ Neue Unterversion (1.2 aus 1.1)', '+ Neue Hauptversion (V2 · 2.1)']);
      await page.click('#btnNeueUnterversion');
      await warteVersion(page, '1.2');
      t = await tafel(page);
      assert.deepEqual(t.knoepfe.slice(0, 4), ['1.1 4 Seiten', '···', '1.2 Kopie von 1.1 4 Seiten aktuell', '···']);
      assert.equal(await kachelText(page, 'S1', 't2'), 'Geänderter Titel', 'Kopie zeigt die Änderung der Quelle');
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.alle().length), 0, 'neue Version ohne eigene Einträge (Änderung steckt im HTML)');
      // Änderung nur in 1.2 → 1.1 unverändert
      await setze(page, 'S1', 'text', 't2', 'Nur in 1.2');
      await page.click('#tafelInhalt [data-version="1.1"] .t-haupt');
      await warteVersion(page, '1.1');
      await ruhe(page);
      assert.equal(await kachelText(page, 'S1', 't2'), 'Geänderter Titel', '1.1 bleibt unverändert');
      // Hauptversion aus 1.1 → 2.1
      await page.click('#btnNeueHauptversion');
      await warteVersion(page, '2.1');
      t = await tafel(page);
      assert.deepEqual(t.knoepfe.filter((x) => x !== '···'), ['1.1 4 Seiten', '1.2 Kopie von 1.1 4 Seiten', '2.1 Kopie von 1.1 4 Seiten aktuell',
        '+ Neue Unterversion (2.2 aus 2.1)', '+ Neue Hauptversion (V3 · 3.1)']);
      assert.deepEqual(await page.$$eval('#tafelInhalt .t-abschnitt', (a) => a.map((x) => x.textContent)), ['Ordner V1', 'Ordner V2']);
      // Menü „···“ von 1.2: Beschreibung (höchstens 80 Zeichen), Ausblenden, Löschen
      await page.click('#tafelInhalt [data-version="1.2"] .t-mehr');
      t = await tafel(page);
      assert.equal(t.titel, 'Version 1.2');
      assert.deepEqual(t.knoepfe, ['Öffnen', 'Beschreibung ändern', 'Kopie als neue Unterversion (1.3)', 'Ausblenden', 'Löschen']);
      await tafelKnopf(page, 'Beschreibung ändern');
      assert.equal(await page.getAttribute('#tafelFeld', 'maxlength'), '80');
      await page.fill('#tafelFeld', 'Platzhalter-Beschreibung');
      await tafelKnopf(page, 'Übernehmen');
      await page.waitForFunction(() => document.getElementById('tafelTitel').textContent === 'Version 1.2');
      await tafelKnopf(page, 'Ausblenden');
      await page.waitForFunction(() => window.AetherFlyer.paketV2().versionen.find((v) => v.nummer === '1.2').ausgeblendet === true);
      await page.click('#tafelZurueck');
      t = await tafel(page);
      assert.ok(t.knoepfe.includes('1.2 Platzhalter-Beschreibung 4 Seiten ausgeblendet'), JSON.stringify(t.knoepfe));
      assert.ok(await page.$eval('#tafelInhalt [data-version="1.2"]', (z) => z.classList.contains('abgeblendet')));
      // 1.1: Löschen gesperrt
      await page.click('#tafelInhalt [data-version="1.1"] .t-mehr');
      assert.equal(await page.isDisabled('#tafelInhalt button:has-text("Löschen")'), true, '1.1 nie löschbar');
      await page.click('#tafelZurueck');
      // 1.2 löschen (Rückfrage), seine Einträge verschwinden
      assert.deepEqual(await page.evaluate(() => window.AetherFlyerAenderungen.alleVersionen().filter((e) => e.ver === '1.2').map((e) => e.art)), ['text'],
        'Text in 1.2 (der Stand ist in der Kopie schon heute)');
      await page.click('#tafelInhalt [data-version="1.2"] .t-mehr');
      page.once('dialog', (d) => d.accept());
      await tafelKnopf(page, 'Löschen');
      await page.waitForFunction(() => !window.AetherFlyer.paketV2().versionen.some((v) => v.nummer === '1.2'));
      await page.waitForFunction(() => window.AetherFlyerAenderungen.alleVersionen().filter((e) => e.ver === '1.2').length === 0, null, { timeout: 5000 });
      // Gerät merkt sich die Version (2.1), nicht im Paket; lokaler Stand übersteht Neuladen
      await page.keyboard.press('Escape');
      assert.ok(await page.isHidden('#tafel'));
      assert.match(await text(page, '#status'), /· \d+ Änderungen? nicht exportiert$/, 'Struktur zählt als nicht exportiert');
      await page.reload();
      await oeffneFlyer(page, null);
      assert.equal(await page.evaluate(() => window.AetherFlyer.version()), '2.1');
      assert.deepEqual(await page.evaluate(() => window.AetherFlyer.paketV2().versionen.map((v) => v.nummer)), ['1.1', '2.1']);
      const db = await idb(page);
      assert.deepEqual(db.geraet.schluessel, ['version']);
      assert.deepEqual(db.geraet.werte, ['2.1']);
      assert.ok(!JSON.stringify(db.basis.werte).includes('"2.1"'), 'Basis unverändert');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });
});

const ordnerKacheln = (page) => page.$$eval('#ordnerKacheln .ordner-kachel', (ks) => ks.map((k) => [k.dataset.ordner, k.querySelector('.ok-name').textContent, k.querySelector('.ok-zahl').textContent]));
const pfad = (page) => page.$$eval('#pfad .pfad-glied', (bs) => bs.map((b) => b.textContent + (b.hasAttribute('aria-current') ? '*' : '')));
const kachelIds = (page) => page.$$eval('#kacheln .kachel', (ks) => ks.map((k) => k.dataset.id));
const ordnerId = (page, name) => page.evaluate((n) => window.AetherFlyer.sicht().ordner.find((o) => o.name === n).id, name);
async function ordnerMenue(page, id) { await page.click(`#ordnerKacheln .ordner-kachel[data-ordner="${id}"] .ok-mehr`); }
async function neuerOrdner(page, name) {
  await page.click('#btnNeuerOrdner');
  await page.fill('#tafelFeld', name);
  await tafelKnopf(page, 'Übernehmen');
}

describe('F3a: Ordner (Teil C)', () => {
  test('Kacheln mit Pfad; „+ Neuer Ordner“ (Vorschlag, leer, zu lang, doppelt); verschachtelt; mehrfache Zuordnung und „Alle“ ohne Doppelte; Umbenennen; Verschieben ohne Kreis; Löschen erhält Seiten; Backspace', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      assert.deepEqual(await ordnerKacheln(page), [['spiel', 'Platzhalter Spiel', '2 Seiten'], ['engine', 'Platzhalter Engine', '1 Seite'],
        ['ig', 'Platzhalter Infografik', '1 Seite'], ['leer', 'Platzhalter leer', '0 Seiten']]);
      assert.deepEqual(await pfad(page), ['Alle*']);
      assert.deepEqual(await kachelIds(page), ['S1', 'S2', 'E1', 'I1'], '„Alle“: jede Seite einmal');
      assert.ok(await page.isDisabled('#pfadZurueck'), '‹ in „Alle“ gesperrt');
      // + Neuer Ordner: Vorschlag, leer abgelehnt, doppelter Name (auch andere Schreibweise) abgelehnt, 60 Zeichen
      await page.click('#btnNeuerOrdner');
      assert.equal((await tafel(page)).titel, 'Neuer Ordner');
      assert.equal(await page.inputValue('#tafelFeld'), 'Neuer Ordner');
      assert.equal(await page.getAttribute('#tafelFeld', 'maxlength'), '60');
      await page.fill('#tafelFeld', '   ');
      await tafelKnopf(page, 'Übernehmen');
      assert.equal(await text(page, '#tafelInhalt .t-hinweis'), 'Der Ordner braucht einen Namen.');
      await page.fill('#tafelFeld', ' platzhalter SPIEL ');
      await tafelKnopf(page, 'Übernehmen');
      assert.match(await text(page, '#tafelInhalt .t-hinweis'), /^Name schon vergeben\. In diesem Ordner gibt es schon „Platzhalter Spiel“\.$/);
      // Backspace im Textfeld löscht Zeichen, schließt nichts
      await page.fill('#tafelFeld', 'Unterbaux');
      await page.press('#tafelFeld', 'Backspace');
      assert.equal(await page.inputValue('#tafelFeld'), 'Unterbau');
      assert.ok(await page.isVisible('#tafel'));
      await tafelKnopf(page, 'Übernehmen');
      await page.waitForFunction(() => document.getElementById('tafel').hidden);
      const unterbau = await ordnerId(page, 'Unterbau');
      assert.match(unterbau, /^O1$/, 'Kennung O<n>');
      // Verschachtelt: im Ordner „Platzhalter Spiel“ einen Unterordner anlegen
      await page.click('#ordnerKacheln .ordner-kachel[data-ordner="spiel"] .ok-oeffnen');
      assert.deepEqual(await pfad(page), ['Alle', 'Platzhalter Spiel*']);
      assert.deepEqual(await kachelIds(page), ['S1', 'S2']);
      await neuerOrdner(page, 'Karten');
      await page.waitForFunction(() => document.querySelectorAll('#ordnerKacheln .ordner-kachel').length === 1);
      const karten = await ordnerId(page, 'Karten');
      assert.deepEqual(await ordnerKacheln(page), [[karten, 'Karten', '0 Seiten']]);
      // Mehrfache Zuordnung (S1 in Spiel und Karten): „Alle“ zeigt S1 einmal, Karten zeigt S1
      await page.evaluate((k) => window.AetherFlyer.aendereStruktur((pk) => { pk.versionen[0].seiten[0].ordner = ['spiel', k]; }), karten);
      await page.click(`#ordnerKacheln .ordner-kachel[data-ordner="${karten}"] .ok-oeffnen`);
      assert.deepEqual(await pfad(page), ['Alle', 'Platzhalter Spiel', 'Karten*']);
      assert.deepEqual(await kachelIds(page), ['S1']);
      // Backspace (nicht in einem Feld) = eine Ebene zurück; ‹ ebenso
      await page.keyboard.press('Backspace');
      assert.deepEqual(await pfad(page), ['Alle', 'Platzhalter Spiel*']);
      assert.deepEqual(await ordnerKacheln(page), [[karten, 'Karten', '1 Seite']]);
      await page.click('#pfadZurueck');
      assert.deepEqual(await pfad(page), ['Alle*']);
      assert.deepEqual(await kachelIds(page), ['S1', 'S2', 'E1', 'I1'], 'S1 trotz zweier Ordner nur einmal');
      assert.deepEqual((await ordnerKacheln(page))[0], ['spiel', 'Platzhalter Spiel', '2 Seiten · 1 Ordner']);
      // Menü „···“ eines Ordners
      await ordnerMenue(page, 'spiel');
      let t = await tafel(page);
      assert.deepEqual([t.titel, t.knoepfe], ['Ordner · Platzhalter Spiel', ['Öffnen', 'Umbenennen', 'Verschieben', 'Löschen']]);
      // Verschieben: nicht in sich selbst oder den eigenen Unterordner
      await tafelKnopf(page, 'Verschieben');
      t = await tafel(page);
      assert.deepEqual(t.knoepfe, ['Oberste Ebene (Alle) (jetzt hier)', 'Platzhalter Engine', 'Platzhalter Infografik', 'Platzhalter leer', 'Unterbau']);
      assert.ok(await page.isDisabled('#tafelInhalt [data-ziel=""]'));
      await page.click('#tafelInhalt [data-ziel="' + unterbau + '"]');
      await page.waitForFunction(() => document.getElementById('tafel').hidden);
      assert.deepEqual((await ordnerKacheln(page)).map((k) => k[0]), ['engine', 'ig', 'leer', unterbau]);
      // Kreis über die Logik: Unterbau in Karten (Enkel) → abgelehnt, nichts geändert
      const kreis = await page.evaluate(([u, k]) => window.AetherFlyer.aendereStruktur((pk) => window.AetherFlyerStruktur.ordnerVerschieben(pk, '1.1', u, k)).then(() => 'ok', (e) => e.text), [unterbau, karten]);
      assert.equal(kreis, 'Ein Ordner kann nicht in sich selbst oder einen eigenen Unterordner.');
      // Umbenennen
      await ordnerMenue(page, unterbau);
      await tafelKnopf(page, 'Umbenennen');
      assert.equal(await page.inputValue('#tafelFeld'), 'Unterbau');
      await page.fill('#tafelFeld', 'Fundament');
      await tafelKnopf(page, 'Übernehmen');
      await page.waitForFunction(() => document.getElementById('tafelTitel').textContent === 'Ordner · Fundament');
      await page.keyboard.press('Escape');
      // Löschen (Rückfrage): Seiten bleiben, verlieren nur die Zuordnung; Unterordner wandern hoch
      await page.click(`#ordnerKacheln .ordner-kachel[data-ordner="${unterbau}"] .ok-oeffnen`);
      await ordnerMenue(page, 'spiel');
      let frage = '';
      page.once('dialog', (d) => { frage = d.message(); d.accept(); });
      await tafelKnopf(page, 'Löschen');
      await page.waitForFunction(() => !window.AetherFlyer.sicht().ordner.some((o) => o.id === 'spiel') && !document.querySelector('#ordnerKacheln [data-ordner="spiel"]'));
      assert.match(frage, /^Ordner „Platzhalter Spiel“ löschen\? Die Seiten bleiben erhalten/);
      const v = await page.evaluate(() => window.AetherFlyer.paketV2().versionen[0]);
      assert.deepEqual(v.seiten.map((x) => [x.id, x.ordner]), [['S1', [karten]], ['S2', []], ['E1', ['engine']], ['I1', ['ig']]], 'Seiten bleiben');
      assert.equal(v.ordner.find((o) => o.id === karten).eltern, unterbau, 'Unterordner wandert in den Elternordner');
      assert.deepEqual(await ordnerKacheln(page), [[karten, 'Karten', '1 Seite']]);
      await page.click('#pfad .pfad-glied[data-ordner=""]');
      assert.deepEqual(await kachelIds(page), ['S1', 'S2', 'E1', 'I1']);
      assert.deepEqual(log.errors, []);
    });
  });
});

async function seitenMenue(page, id) { await page.click(`#kacheln .kachel-platz[data-id="${id}"] .kachel-mehr`); }
const kachelTitel = (page) => page.$$eval('#kacheln .kachel', (ks) => ks.map((k) => [k.dataset.id, k.querySelector('.kachel-titel').textContent, !!k.querySelector('.marke')]));
// Zähler, Status und Stand eines dargestellten Dokuments
const zaehlerInfo = (page, sel) => page.$eval(sel, (h) => {
  const r = h.shadowRoot, z = r.querySelector('[data-zaehler]');
  return { text: z ? z.querySelector('.zaehler').textContent : null, anteil: z ? z.style.getPropertyValue('--anteil').trim() : null,
    status: [...r.querySelectorAll('[data-s]')].map((e) => e.getAttribute('data-status')), stand: [...r.querySelectorAll('[data-stand]')].map((e) => e.textContent) };
});

describe('F3a: Seiten (Teil D)', () => {
  test('„+ Seite“: Vorlagen (Bild / Video ab F3b freigeschaltet), Zielordner, Anlegen öffnet das Vollbild; Vorlagen mit gültigen Markierungen; Kopie zeigt die Quelle; Kennungen N… nie wiederverwendet; Umbenennen; In Ordner; Ausblenden mit Umschalter; Original nie löschbar', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      const heute = await page.evaluate(() => window.AetherFlyerAenderungen.heute());
      const kurz = heute.split('-').reverse().join('.');
      assert.ok(await page.isVisible('#btnNeueSeite'));
      assert.equal(await text(page, '#btnNeueSeite'), '+ Seite');
      // Tafel „Neue Seite“ im Ordner „Platzhalter Spiel“
      await page.click('#ordnerKacheln .ordner-kachel[data-ordner="spiel"] .ok-oeffnen');
      await page.click('#btnNeueSeite');
      let t = await tafel(page);
      assert.equal(t.titel, 'Neue Seite');
      assert.equal(await text(page, '#tafelInhalt .t-klein'), 'Ordner: Platzhalter Spiel');
      assert.deepEqual(await page.$$eval('#tafelInhalt .vorlage', (bs) => bs.map((b) => [b.dataset.vorlage, b.querySelector('span:not(.skizze span)').textContent, b.disabled, b.querySelector('small') ? b.querySelector('small').textContent : ''])),
        [['leer', 'Leer', false, ''], ['titel-text', 'Titel + Text', false, ''], ['liste-status', 'Liste mit Status', false, ''], ['kennzahlen', 'Kennzahlen', false, ''],
          ['zwei-kaesten', 'Zwei Kästen', false, ''], ['bild-video', 'Bild / Video', false, '']]);   // F3b: freigeschaltet
      assert.ok(await page.isDisabled('#btnAnlegen'), 'ohne Wahl kein Anlegen');
      assert.deepEqual(await page.$$eval('#kopieQuelle option', (os) => os.map((o) => o.textContent)), ['Kopie einer bestehenden Seite …', 'S1 · Platzhalter eins', 'S2 · Platzhalter zwei', 'E1 · Platzhalter drei', 'I1 · Platzhalter-Infografik']);
      await page.click('#tafelInhalt .vorlage[data-vorlage="liste-status"]');
      assert.equal(await page.getAttribute('#tafelInhalt .vorlage[data-vorlage="liste-status"]', 'aria-pressed'), 'true');
      await page.click('#btnAnlegen');
      await page.waitForFunction(() => !document.getElementById('vollbild').hidden && document.getElementById('vbTitel').textContent === 'N1 · Neue Seite (Liste mit Status)');
      assert.ok(await page.isHidden('#tafel'));
      await ruhe(page);
      // Vorlage „Liste mit Status“: 4 Punkte, Zähler, Stand heute; der Status wirkt auf Zähler und Balken
      let z = await zaehlerInfo(page, '#vbBuehne .flyer-host');
      assert.deepEqual(z, { text: '1 von 4 fertig', anteil: '0.25', status: ['ok', 'run', 'next', 'plan'], stand: [kurz] });
      await page.evaluate(() => window.AetherFlyerAenderungen.setze('N1', 'status', 's4', 'ok').then(() => window.AetherFlyerAnsicht.aktualisiere('N1')));
      z = await zaehlerInfo(page, '#vbBuehne .flyer-host');
      assert.deepEqual([z.text, z.anteil, z.status[3]], ['2 von 4 fertig', '0.5', 'ok']);
      await page.click('#vbZu');
      assert.deepEqual((await kachelTitel(page)).map((k) => k[0]), ['S1', 'S2', 'N1'], 'neue Seite im Zielordner');
      // Alle Vorlagen: Markierungen gültig (t eindeutig, Stand = heute, Kennung in der Fußzeile), Zähler unverändert,
      // die Seite besteht die Prüfung des Pakets
      const vorlagen = await page.evaluate((heute) => {
        const ST = window.AetherFlyerStruktur, AE = window.AetherFlyerAenderungen, P = window.AetherFlyerPaket;
        return ST.VORLAGEN.filter((v) => !v.gesperrt).map((v) => {
          const html = ST.vorlageHtml(v.id, { kennung: 'N9', heute, klasse: 'page c-spiel', marke: 'Platzhalter' });
          const w = P.bereinigeHtml(html), vorher = w.outerHTML;
          AE.anwenden(w, 'N9', [], {});
          const werte = AE.werteAus(w);
          const ts = [...w.querySelectorAll('[data-t]')].map((e) => e.getAttribute('data-t'));
          return { id: v.id, gleich: w.outerHTML === vorher, eindeutig: new Set(ts).size === ts.length, t: ts.length, s: werte.status.size,
            stand: [...werte.stand.values()].map((x) => x.wert), fuss: /N9 · Stand /.test(html), logo: !!w.querySelector('.brand .logo'), marke: !!w.querySelector('.brand .kick[data-t]') };
        });
      }, heute);
      assert.deepEqual(vorlagen.map((v) => [v.id, v.gleich, v.eindeutig, v.s, v.stand, v.fuss, v.logo, v.marke]), [
        ['leer', true, true, 0, [kurz], true, true, true], ['titel-text', true, true, 0, [kurz], true, true, true], ['liste-status', true, true, 4, [kurz], true, true, true],
        ['kennzahlen', true, true, 0, [kurz], true, true, true], ['zwei-kaesten', true, true, 0, [kurz], true, true, true],
        ['bild-video', true, true, 0, [kurz], true, true, true]]);   // F3b: Bild / Video freigeschaltet, dieselben Prüfungen
      assert.deepEqual(vorlagen.map((v) => v.t), [3, 7, 10, 13, 9, 7], 'Platzhalter-Texte je Vorlage');
      // Kopie über das Menü: zeigt die Änderung der Quelle, eigene Kennung, „(Kopie)“, Ordner wie die Quelle
      await page.evaluate(() => window.AetherFlyerAenderungen.setze('S1', 'text', 't2', 'Geänderter Titel'));
      await seitenMenue(page, 'S1');
      t = await tafel(page);
      assert.deepEqual([t.titel, t.knoepfe], ['S1 · Platzhalter eins', ['Öffnen', 'Kopie anlegen', 'Umbenennen', 'In Ordner …', 'Grafiken & Daten exportieren', 'Ausblenden', 'Löschen (nur eigene Seiten)']]);
      assert.ok(await page.isDisabled('#tafelInhalt button:has-text("Löschen (nur eigene Seiten)")'), 'Original nie löschbar');
      await tafelKnopf(page, 'Kopie anlegen');
      await page.waitForFunction(() => document.getElementById('vbTitel').textContent === 'N2 · Platzhalter eins (Kopie)');
      await page.click('#vbZu');
      const n2 = await page.evaluate(() => window.AetherFlyer.paketV2().versionen[0].seiten.find((s) => s.id === 'N2'));
      assert.deepEqual([n2.herkunft, n2.vorlage, n2.kopieVon, n2.ordner], ['eigen', 'kopie', 'S1', ['spiel']]);
      assert.match(n2.html, /^<section class="page c-spiel" data-id="N2"/);
      assert.match(n2.html, />N2 · Stand </);
      assert.match(n2.html, /<h1 data-t="t2">Geänderter Titel<\/h1>/, 'Kopie zeigt, was die Quelle gerade zeigt');
      const orig = await page.evaluate(() => window.AetherFlyer.paketV2().versionen[0].seiten.find((s) => s.id === 'S1').html);
      assert.match(orig, /data-id="S1"/, 'Quelle unverändert');
      // Original löschen über die Logik → abgelehnt
      const nein = await page.evaluate(() => window.AetherFlyer.aendereStruktur((pk) => window.AetherFlyerStruktur.seiteLoeschen(pk, '1.1', 'S1')).then(() => 'gelöscht', (e) => e.title));
      assert.equal(nein, 'Original-Seiten lassen sich nicht löschen.');
      // Eigene Seite löschen (Rückfrage), danach nie dieselbe Kennung: nächste ist N3
      await seitenMenue(page, 'N1');
      t = await tafel(page);
      assert.deepEqual(t.knoepfe, ['Öffnen', 'Kopie anlegen', 'Umbenennen', 'In Ordner …', 'Grafiken & Daten exportieren', 'Löschen']);
      page.once('dialog', (d) => d.accept());
      await tafelKnopf(page, 'Löschen');
      await page.waitForFunction(() => !document.querySelector('#kacheln .kachel[data-id="N1"]'));
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.alleVersionen().filter((e) => e.dok === 'N1').length), 0, 'Einträge von N1 entfernt');
      await page.click('#btnNeueSeite');
      await page.click('#tafelInhalt .vorlage[data-vorlage="kennzahlen"]');
      await page.click('#btnAnlegen');
      await page.waitForFunction(() => document.getElementById('vbTitel').textContent === 'N3 · Neue Seite (Kennzahlen)');
      await page.click('#vbZu');
      // Umbenennen: Name der Kachel, Inhalt bleibt
      const n3vorher = await page.evaluate(() => window.AetherFlyer.paketV2().versionen[0].seiten.find((s) => s.id === 'N3').html);
      await seitenMenue(page, 'N3');
      await tafelKnopf(page, 'Umbenennen');
      await page.fill('#tafelFeld', 'Platzhalter-Kennzahlen');
      await tafelKnopf(page, 'Übernehmen');
      await page.waitForFunction(() => document.getElementById('tafelTitel').textContent === 'N3 · Platzhalter-Kennzahlen');
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paketV2().versionen[0].seiten.find((s) => s.id === 'N3').html), n3vorher);
      // In Ordner …: mehrere möglich, eingerückt, wirkt sofort
      await seitenMenue(page, 'N3');
      await tafelKnopf(page, 'In Ordner …');
      assert.deepEqual(await page.$$eval('#tafelInhalt .t-check', (ls) => ls.map((l) => [l.textContent, l.querySelector('input').checked])),
        [['Platzhalter Spiel', true], ['Platzhalter Engine', false], ['Platzhalter Infografik', false], ['Platzhalter leer', false]]);
      await page.check('#tafelInhalt input[data-ordner="engine"]');
      await page.waitForFunction(() => window.AetherFlyer.paketV2().versionen[0].seiten.find((s) => s.id === 'N3').ordner.join() === 'spiel,engine');
      await page.uncheck('#tafelInhalt input[data-ordner="spiel"]');
      await page.waitForFunction(() => window.AetherFlyer.paketV2().versionen[0].seiten.find((s) => s.id === 'N3').ordner.join() === 'engine');
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => !document.querySelector('#kacheln .kachel[data-id="N3"]'));
      // Ausblenden (Original): verschwindet, Umschalter „Ausgeblendete zeigen (1)“, dann abgeblendet mit Marke
      await seitenMenue(page, 'S2');
      await tafelKnopf(page, 'Ausblenden');
      await page.waitForFunction(() => !document.querySelector('#kacheln .kachel[data-id="S2"]'));
      assert.equal(await text(page, '#btnAusgeblendete'), 'Ausgeblendete zeigen (1)');
      await page.click('#btnAusgeblendete');
      assert.equal(await text(page, '#btnAusgeblendete'), 'Ausgeblendete verbergen');
      assert.deepEqual((await kachelTitel(page)).find((k) => k[0] === 'S2'), ['S2', 'Platzhalter zwei', true]);
      assert.ok(await page.$eval('#kacheln .kachel-platz[data-id="S2"]', (p) => p.classList.contains('ausgeblendet') && Number(getComputedStyle(p.querySelector('.kachel')).opacity) < 0.6));
      await seitenMenue(page, 'S2');
      assert.ok((await tafel(page)).knoepfe.includes('Einblenden'));
      await tafelKnopf(page, 'Einblenden');
      await page.waitForFunction(() => document.getElementById('ausgeblendetZeile').hidden);
      // Kopfzeile: Struktur-Änderungen zählen als nicht exportiert
      assert.match(await text(page, '#status'), /· \d+ Änderungen nicht exportiert$/);
      assert.deepEqual(log.errors, []);
    });
  });

  test('Änderungen sichern/einspielen mit Struktur (Format v2): neue, kopierte, umbenannte, ausgeblendete Seiten kommen zurück; Sicherung v1 wird gelesen', async () => {
    await mitSeite({ init: [H.ohneTeilen] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await page.evaluate(async () => {
        const ST = window.AetherFlyerStruktur, F = window.AetherFlyer, heute = window.AetherFlyerAenderungen.heute();
        await F.aendereStruktur((pk) => ST.seiteAnlegen(pk, '1.1', { vorlage: 'zwei-kaesten', ordner: ['engine'], heute }));
        await F.aendereStruktur((pk) => ST.seiteAnlegen(pk, '1.1', { kopieVon: 'E1', ordner: [], heute }));
        await F.aendereStruktur((pk) => ST.seiteUmbenennen(pk, '1.1', 'S1', 'Umbenannt'));
        await F.aendereStruktur((pk) => ST.seiteAusblenden(pk, '1.1', 'S2', true));
        await window.AetherFlyerAenderungen.setze('N1', 'text', 't3', 'Text in der neuen Seite');
      });
      const vorher = await page.evaluate(() => window.AetherFlyer.paketV2());
      await page.waitForFunction(() => !document.getElementById('btnSichern').disabled);
      const s = await H.download(page, () => page.click('#btnSichern'));
      assert.equal(s.name, 'aether-flyer-aenderungen.json');
      const o = JSON.parse(s.puffer.toString('utf8'));
      assert.deepEqual([o.format, o.version, o.versionNummer], ['aether-flyer-aenderungen', 3, '1.1']);   // F3b: Sicherung v3
      assert.ok(o.struktur.some((f) => f.k === 'P|1.1|N1|da' && f.alt === null && f.neu === '1'), 'neue Seite N1');
      assert.ok(o.struktur.some((f) => f.k === 'P|1.1|S1|titel' && JSON.parse(f.neu) === 'Umbenannt'));
      assert.deepEqual(o.eintraege.map((e) => [e.ver, e.dok, e.art]), [['1.1', 'N1', 'text']], 'Text in N1 (Stand der neuen Seite ist schon heute)');
      // Verwerfen (Rückfrage) → Struktur und Texte der Version wie die Basis
      page.once('dialog', (d) => d.accept());
      await page.click('#btnVerwerfen');
      await page.waitForFunction(() => window.AetherFlyer.paketV2().versionen[0].seiten.length === 4 && window.AetherFlyerAenderungen.alle().length === 0);
      assert.equal(await page.evaluate(() => window.AetherFlyer.strukturZahl()), 0);
      // Einspielen → derselbe Stand
      await H.einspielen(page, o);
      await page.waitForFunction(() => window.AetherFlyer.paketV2().versionen[0].seiten.length === 6);
      const nachher = await page.evaluate(() => window.AetherFlyer.paketV2());
      assert.deepEqual(nachher.versionen, vorher.versionen, 'Struktur nach dem Einspielen gleich');
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.aktuellerWert('N1', 'text', 't3')), 'Text in der neuen Seite');
      // Sicherung v1 (ohne ver und Struktur) wird weiter gelesen und gilt für die geöffnete Version
      await H.einspielen(page, { format: 'aether-flyer-aenderungen', version: 1, paketFassung: H.VERSION, gesichert: '2026-01-01T00:00:00.000Z',
        eintraege: [{ dok: 'E1', k: 't2', art: 'text', alt: 'Platzhalter drei', neu: 'Aus Sicherung v1', exportiert: null, zeit: '2026-01-01T00:00:00.000Z' }] });
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.aktuellerWert('E1', 'text', 't2')), 'Aus Sicherung v1');
      assert.deepEqual(log.errors, []);
    });
  });
});

describe('F3a: Abgleich mit der Online-Datei (Teil E)', () => {
  test('Text je Version; Struktur: nur online → übernommen, nur lokal → bleibt, beide → Konflikt (Lokal behalten / Online übernehmen); online gelöscht bei lokaler Änderung → Konflikt; offen über Neuladen; Version online entfernt', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      const v1 = paketV1();
      // Basis im Format v2 mit den Versionen 1.1 und 1.2 (wie nach einem Export und „Online stellen“)
      const B = await page.evaluate((v1) => {
        const r = window.AetherFlyerPaket.alsV2(v1);
        window.AetherFlyerStruktur.versionKopieren(r, '1.1', '1.2');
        return r;
      }, v1);
      await importiere(page, B);
      assert.deepEqual(await page.evaluate(() => window.AetherFlyer.paketV2().versionen.map((x) => x.nummer)), ['1.1', '1.2'], 'v2-Import');
      assert.equal(await page.evaluate(() => window.AetherFlyer.strukturZahl()), 0);
      await page.evaluate(async () => {
        const ST = window.AetherFlyerStruktur, F = window.AetherFlyer, heute = window.AetherFlyerAenderungen.heute();
        await F.aendereStruktur((pk) => ST.seiteUmbenennen(pk, '1.1', 'S1', 'Lokal S1'));
        await F.aendereStruktur((pk) => ST.seiteAnlegen(pk, '1.1', { vorlage: 'leer', ordner: [], heute }));
        await F.aendereStruktur((pk) => ST.seiteInOrdner(pk, '1.1', 'E1', ['engine', 'leer']));
        await F.oeffneVersion('1.2');
        await window.AetherFlyerAenderungen.setze('S1', 'text', 't4', 'Lokal in 1.2');
        await F.oeffneVersion('1.1');
      });
      // Neue Fassung R: 1.2 mit anderem t4 in S1; in 1.1 S1 anders benannt (beide), S2 umbenannt (nur online), Ordner „leer“ gelöscht
      const R = await page.evaluate((b) => {
        const ST = window.AetherFlyerStruktur;
        const r = JSON.parse(JSON.stringify(b));
        const s1 = r.versionen[1].seiten[0];
        s1.html = s1.html.replace('Platzhalter-Einleitung für die Tests.', 'Online in 1.2');
        ST.seiteUmbenennen(r, '1.1', 'S1', 'Online S1');
        ST.seiteUmbenennen(r, '1.1', 'S2', 'Online S2');
        ST.ordnerLoeschen(r, '1.1', 'leer');
        r.version = '2020-02-03.1';
        return r;
      }, B);
      await page.evaluate((r) => window.AetherFlyer.uebernehme(r, { quelle: 'import' }), R);
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
      // Text: Konflikt in Version 1.2
      const tk = await page.evaluate(() => window.AetherFlyerAenderungen.konflikte().map((k) => [k.ver, k.dok, k.k, k.basis, k.meins, k.online]));
      assert.deepEqual(tk, [['1.2', 'S1', 't4', 'Platzhalter-Einleitung für die Tests.', 'Lokal in 1.2', 'Online in 1.2']]);
      // Struktur
      let sk = await page.evaluate(() => window.AetherFlyer.strukturKonflikte());
      assert.deepEqual(sk.map((k) => [k.objekt, k.was, k.zeilen.map((z) => [z.feld, z.lokal, z.andere])]), [
        ['P|1.1|S1', 'Seite S1 · Lokal S1 (Version 1.1)', [['Name', 'Lokal S1', 'Online S1']]],
        ['O|1.1|leer', 'Ordner leer · Platzhalter leer (Version 1.1)', [['vorhanden', 'vorhanden', 'nicht vorhanden'], ['Name', 'Platzhalter leer', '–'], ['Zuordnung E1', 'engine, leer', 'engine']]]
      ]);
      let v = await page.evaluate(() => window.AetherFlyer.paketV2().versionen[0]);
      assert.deepEqual(v.seiten.map((s) => [s.id, s.titel]), [['S1', 'Lokal S1'], ['S2', 'Online S2'], ['E1', 'Platzhalter drei'], ['I1', 'Platzhalter-Infografik'], ['N1', 'Neue Seite (Leer)']],
        'nur online → übernommen; beide → bis zur Wahl lokal; nur lokal (N1) → bleibt');
      assert.ok(v.ordner.some((o) => o.id === 'leer'), 'Ordner bleibt bis zur Wahl (lokal verwendet)');
      await page.waitForFunction(() => /^3 Konflikte\b/.test(document.getElementById('konflikteText').textContent));
      // Offen über Neuladen
      await page.reload();
      await oeffneFlyer(page, null);
      await page.waitForFunction(() => /^3 Konflikte\b/.test(document.getElementById('konflikteText').textContent));
      await page.click('#konflikteZeigen');
      assert.deepEqual(await page.$$eval('#konfliktListe .konflikt.struktur [data-wahl]', (bs) => bs.map((b) => b.textContent)), ['Lokal behalten', 'Online übernehmen', 'Lokal behalten', 'Online übernehmen']);
      // S1: Online übernehmen; leer: Lokal behalten
      await page.click('#konfliktListe .konflikt.struktur[data-schluessel] >> nth=0 >> [data-wahl="andere"]');
      await page.waitForFunction(() => window.AetherFlyer.strukturKonflikte().length === 1);
      await page.click('#konfliktListe .konflikt.struktur [data-wahl="lokal"]');
      await page.waitForFunction(() => window.AetherFlyer.strukturKonflikte().length === 0);
      v = await page.evaluate(() => window.AetherFlyer.paketV2().versionen[0]);
      assert.equal(v.seiten[0].titel, 'Online S1');
      assert.deepEqual(v.seiten.find((s) => s.id === 'E1').ordner, ['engine', 'leer']);
      // Gleiche Fassung noch einmal: idempotent, keine neuen Konflikte
      await page.evaluate((r) => window.AetherFlyer.uebernehme(r, { quelle: 'import' }), R);
      assert.equal(await page.evaluate(() => window.AetherFlyer.strukturKonflikte().length), 0);
      // Version online entfernt, lokal geändert (Text in 1.2) → Konflikt; Online übernehmen → 1.2 weg samt Einträgen
      const R2 = { ...R, version: '2020-02-04.1', versionen: [R.versionen[0]] };
      await page.evaluate((r) => window.AetherFlyer.uebernehme(r, { quelle: 'import' }), R2);
      sk = await page.evaluate(() => window.AetherFlyer.strukturKonflikte());
      assert.deepEqual(sk.map((k) => [k.objekt, k.zeilen[0].feld, k.zeilen[0].lokal, k.zeilen[0].andere]), [['V|1.2', 'vorhanden', 'vorhanden', 'nicht vorhanden']]);
      assert.ok(await page.evaluate(() => window.AetherFlyer.paketV2().versionen.some((x) => x.nummer === '1.2')), '1.2 bleibt bis zur Wahl');
      await page.waitForFunction(() => document.querySelector('#konfliktListe .konflikt.struktur'));
      await page.click('#konfliktListe .konflikt.struktur [data-wahl="andere"]');
      await page.waitForFunction(() => !window.AetherFlyer.paketV2().versionen.some((x) => x.nummer === '1.2'));
      await page.waitForFunction(() => !window.AetherFlyerAenderungen.alleVersionen().some((e) => e.ver === '1.2'));
      assert.deepEqual(log.errors, []);
    });
  });
});

// ---------------------------------------------------------------------------
// Teil F: Export „Grafiken & Daten“
// ---------------------------------------------------------------------------
// Große Knöpfe der Tafel: [Schlüssel, Titel, Unterzeile, gesperrt]
const grafikKnoepfe = (page) => page.$$eval('#tafelInhalt .g-knopf', (bs) => bs.map((b) => [b.dataset.k, b.querySelector('b').textContent, b.querySelector('small').textContent, b.disabled]));
const miniTexte = (page) => page.$$eval('#tafelInhalt .g-mini', (bs) => bs.map((b) => [b.querySelector('small').textContent, b.getAttribute('aria-pressed'), !!b.querySelector('canvas')]));
const warteGrafik = (page) => page.waitForSelector('#tafelInhalt .g-knopf[data-k="csv"]');
const HTML_HINWEIS = 'nur im Browser genau, in Grafikprogrammen evtl. nicht';
// Pixel eines PNG (im Browser dekodiert)
const pngPixel = (page, puffer, x, y) => page.evaluate(async ([b64, x, y]) => {
  const bin = atob(b64), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
  const c = document.createElement('canvas'); c.width = bmp.width; c.height = bmp.height;
  const ctx = c.getContext('2d'); ctx.drawImage(bmp, 0, 0);
  return [...ctx.getImageData(x, y, 1, 1).data];
}, [puffer.toString('base64'), x, y]);
const nahe = (ist, soll, wo) => soll.forEach((v, i) => assert.ok(Math.abs(ist[i] - v) <= 4, `${wo}: Pixel ${ist} ≈ ${soll}`));

describe('F3a: Export „Grafiken & Daten“ (Teil F)', () => {
  test('Vollbild „Export“ und Menü „···“: Tafel der Seite; Erkennung; PNG wie „Bild“ (2×, Hintergrund der Seite); SVG echt bzw. mit Hinweis; CSV/JSON mit der Änderungsschicht; Einzelauswahl; ZIP gültig; Dateinamen', async () => {
    await mitSeite({ init: [H.ohneTeilen] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await setze(page, 'S1', 'text', 't4', 'Geänderte Einleitung; mit Semikolon');
      await setze(page, 'S1', 'status', 's2', 'ok');
      const heute = await page.evaluate(() => window.AetherFlyerAenderungen.formatiereStand(window.AetherFlyerAenderungen.heute(), 'kurz'));
      assert.ok(await page.isHidden('#vbExport'), 'ohne Vollbild kein „Export“');
      await page.evaluate(() => window.AetherFlyerAnsicht.oeffneDok('S1'));
      await page.waitForSelector('#vbExport:not([hidden])');
      assert.equal(await text(page, '#vbExport'), 'Export');
      // Seit dem PowerPoint-Export steht „PowerPoint“ zwischen „Bild“ und „Export“
      assert.deepEqual(await page.$eval('#vbExport', (b) => [b.previousElementSibling.previousElementSibling.id, b.previousElementSibling.id]), ['vbBild', 'vbPptx'], '„Export“ steht nach „Bild“ und „PowerPoint“');
      await page.click('#vbExport');
      assert.equal((await tafel(page)).titel, 'Grafiken & Daten');
      await warteGrafik(page);
      assert.equal(await text(page, '#tafelInhalt .t-abschnitt'), 'Diese Seite (S1)');
      assert.deepEqual(await grafikKnoepfe(page), [
        ['png', 'Alle Grafiken als PNG', '4 Dateien · Kästen, Kennzahlen, Balken, Symbole', false],
        ['svg', 'Alle Grafiken als SVG', '4 Dateien · 1 echte SVG, 3 mit eingebettetem HTML – ' + HTML_HINWEIS, false],
        ['csv', 'Daten als CSV', 'Texte, Status, Zähler · für Tabellen · 18 Zeilen', false],
        ['json', 'Daten als JSON', 'alles mit Kennungen · für Programme', false],
        ['zip', 'Alles als ZIP (4 Seiten)', 'Version 1.1 · je Seite PNG, SVG, CSV und JSON', false]]);
      assert.deepEqual(await miniTexte(page), [['01 · Symbol', 'false', true], ['02 · Kennzahlen', 'false', true], ['03 · Kasten', 'false', true], ['04 · Balken', 'false', true]], 'Raster mit Mini-Bildern');
      assert.equal(await text(page, '#tafelInhalt .g-sel'), 'Auswahl herunterladen (0)');
      assert.ok(await page.isDisabled('#tafelInhalt .g-sel'));
      // JSON: Format, Version, Einträge, Grafiken (Lage in CSS-Pixeln)
      const dj = await H.download(page, () => page.click('#tafelInhalt .g-knopf[data-k="json"]'));
      assert.equal(dj.name, '1.1_S1.json');
      const j = JSON.parse(dj.puffer.toString('utf8'));
      assert.deepEqual([j.format, j.formatVersion, j.paketFassung, j.version, j.seite, j.titel, j.art, j.breite, j.hoehe], ['aether-flyer-daten', 1, H.VERSION, '1.1', 'S1', 'Platzhalter eins', 'flyer', 794, 1123]);
      assert.deepEqual(j.grafiken.map((g) => [g.nr, g.art, g.png, g.svg, g.svgArt]), [
        [1, 'symbol', '1.1_S1_01_symbol.png', '1.1_S1_01_symbol.svg', 'svg'], [2, 'kennzahlen', '1.1_S1_02_kennzahlen.png', '1.1_S1_02_kennzahlen.svg', 'html'],
        [3, 'kasten', '1.1_S1_03_kasten.png', '1.1_S1_03_kasten.svg', 'html'], [4, 'balken', '1.1_S1_04_balken.png', '1.1_S1_04_balken.svg', 'html']]);
      assert.deepEqual(j.grafiken[0], { nr: 1, art: 'symbol', x: 48, y: 40, breite: 120, hoehe: 44, png: '1.1_S1_01_symbol.png', svg: '1.1_S1_01_symbol.svg', svgArt: 'svg' }, 'Logo oben links');
      assert.deepEqual(j.eintraege.find((e) => e.kennung === 'zaehler1'), { kennung: 'zaehler1', art: 'zaehler', wert: '2 von 2 fertig', status: '', fertig: 2, laeuft: 0, gesamt: 2 });
      // CSV: BOM, „;“, Werte der Darstellung (Änderungsschicht), Kennungen wie beim Bearbeiten
      const dc = await H.download(page, () => page.click('#tafelInhalt .g-knopf[data-k="csv"]'));
      assert.equal(dc.name, '1.1_S1.csv');
      assert.deepEqual([...dc.puffer.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM');
      assert.deepEqual(dc.puffer.toString('utf8').slice(1).split('\r\n'), [
        'version;seite;kennung;art;wert;status',
        '1.1;S1;t1;text;Platzhalter spiel;', '1.1;S1;t2;text;Platzhalter eins;', '1.1;S1;t3;text;Platzhalter-Untertitel;',
        '1.1;S1;t4;text;"Geänderte Einleitung; mit Semikolon";', '1.1;S1;t5;text;12;', '1.1;S1;t6;text;Platzhalter-Zahl;', '1.1;S1;t7;text;34;',
        '1.1;S1;t8;text;Platzhalter-Zahl zwei;', '1.1;S1;zaehler1;zaehler;2 von 2 fertig;', '1.1;S1;t9;text;Platzhalter-Liste;',
        '1.1;S1;s1;status;Punkt eins;ok', '1.1;S1;t10;text;Punkt eins;', '1.1;S1;s2;status;"Punkt zwei; mit „Umlaut“ äöü";ok',
        '1.1;S1;t11;text;"Punkt zwei; mit „Umlaut“ äöü";', '1.1;S1;t12;text;Platzhalter-Balken;', '1.1;S1;t13;text;Platzhalter-Quelle;',
        '1.1;S1;t14;text;S1 · Stand;', '1.1;S1;stand1;stand;' + heute + ';', '']);
      assert.equal(j.eintraege.length, 18, 'JSON: dieselben Daten wie die CSV');
      // PNG: alle als ZIP (gültig, CRC), je Grafik doppelte Auflösung; Hintergrund und Farben wie auf der Seite
      const dp = await H.download(page, () => page.click('#tafelInhalt .g-knopf[data-k="png"]'));
      assert.equal(dp.name, '1.1_S1_png.zip');
      const png = H.liesZip(dp.puffer);
      assert.deepEqual(png.map((d) => [d.name, d.methode, d.crcOk]), j.grafiken.map((g) => [g.png, 0, true]));
      png.forEach((d, i) => {
        const g = j.grafiken[i], m = H.pngMasse(d.daten);
        assert.deepEqual([m.w, m.h], [Math.ceil((g.x + g.breite) * 2) - Math.floor(g.x * 2), Math.ceil((g.y + g.hoehe) * 2) - Math.floor(g.y * 2)], `${d.name}: 2× Auflösung`);
      });
      nahe(await pngPixel(page, png[0].daten, 120, 44), [0x8c, 0x7c, 0xf0, 255], 'Logo');
      const m3 = H.pngMasse(png[2].daten);
      nahe(await pngPixel(page, png[2].daten, m3.w - 20, m3.h - 20), [0x1c, 0x2a, 0x44, 255], 'Kasten: Fläche des Kastens');
      // SVG: Logo als echte SVG (aus der data:-SVG), Kästen mit eingebettetem HTML und Ausschnitt der Seite
      const ds = await H.download(page, () => page.click('#tafelInhalt .g-knopf[data-k="svg"]'));
      assert.equal(ds.name, '1.1_S1_svg.zip');
      const svg = H.liesZip(ds.puffer);
      assert.deepEqual(svg.map((d) => [d.name, d.crcOk]), j.grafiken.map((g) => [g.svg, true]));
      const logo = svg[0].daten.toString('utf8');
      assert.match(logo, /^<\?xml version="1\.0" encoding="UTF-8"\?>\n<svg xmlns="http:\/\/www\.w3\.org\/2000\/svg" viewBox="0 0 30 11" width="120" height="44" preserveAspectRatio="xMidYMid meet"><rect width="30" height="11" rx="2" fill="#8c7cf0"\/><\/svg>$/);
      const kasten = svg[2].daten.toString('utf8'), g3 = j.grafiken[2];
      // Ausschnitt per CSS im eingebetteten HTML (Rahmen in Kastengröße, Seite darin verschoben), viewBox ohne
      // Verschiebung und ohne Maßstab – WebKit (Safari) verschiebt HTML mit eigener Ebene nicht mit der viewBox mit
      assert.match(kasten, new RegExp(`^<svg xmlns="http://www\\.w3\\.org/2000/svg" width="${g3.breite}" height="${g3.hoehe}" viewBox="0 0 ${g3.breite} ${g3.hoehe}">` +
        `<foreignObject x="0" y="0" width="${g3.breite}" height="${g3.hoehe}"><div xmlns="http://www\\.w3\\.org/1999/xhtml" style="[^"]*width:${g3.breite}px !important;height:${g3.hoehe}px !important;overflow:hidden !important">` +
        `<div style="[^"]*margin:-${g3.y}px 0 0 -${g3.x}px !important;width:794px !important"><div xmlns="http://www\\.w3\\.org/1999/xhtml" class="ae-wurzel">`));
      assert.ok(kasten.includes('Geänderte Einleitung; mit Semikolon'), 'SVG zeigt die Änderungsschicht');
      assert.ok(!/<script|\son\w+=/i.test(kasten + logo), 'kein Skript');
      // Einzeln wählen: eine Grafik → direkt; zwei → ZIP; SVG mit Hinweis für HTML-Kästen
      await page.click('#tafelInhalt .g-mini[data-nr="3"]');
      assert.equal(await text(page, '#tafelInhalt .g-sel'), 'Auswahl herunterladen (1)');
      const e1 = await H.download(page, () => page.click('#tafelInhalt .g-sel'));
      assert.equal(e1.name, '1.1_S1_03_kasten.png');
      assert.ok(e1.puffer.equals(png[2].daten), 'dieselbe Datei wie im ZIP');
      await page.click('#tafelInhalt .g-mini[data-nr="1"]');
      assert.deepEqual((await miniTexte(page)).map((m) => m[1]), ['true', 'false', 'true', 'false']);
      const e2 = await H.download(page, () => page.click('#tafelInhalt .g-sel'));
      assert.equal(e2.name, '1.1_S1_auswahl.zip');
      assert.deepEqual(H.liesZip(e2.puffer).map((d) => [d.name, d.crcOk]), [['1.1_S1_01_symbol.png', true], ['1.1_S1_03_kasten.png', true]]);
      assert.ok(await page.isHidden('#tafelInhalt .g-hinweis'));
      await page.click('#tafelInhalt .seg button[data-format="svg"]');
      assert.equal(await text(page, '#tafelInhalt .g-hinweis'), 'SVG der Kästen mit eingebettetem HTML – ' + HTML_HINWEIS + '.');
      const e3 = await H.download(page, () => page.click('#tafelInhalt .g-sel'));
      assert.deepEqual(H.liesZip(e3.puffer).map((d) => d.name), ['1.1_S1_01_symbol.svg', '1.1_S1_03_kasten.svg']);
      await page.click('#tafelInhalt .g-mini[data-nr="3"]');
      assert.ok(await page.isHidden('#tafelInhalt .g-hinweis'), 'nur echte SVG gewählt: kein Hinweis');
      // Esc schließt die Tafel, das Vollbild bleibt
      await page.keyboard.press('Escape');
      assert.ok(await page.isHidden('#tafel'));
      assert.ok(await page.isVisible('#vollbild'));
      await page.click('#vbZu');
      // Menü „···“ der Kachel: Infografik mit SVG-Diagramm (echte SVG mit eingebetteter Schrift)
      await seitenMenue(page, 'I1');
      await tafelKnopf(page, 'Grafiken & Daten exportieren');
      await warteGrafik(page);
      assert.equal(await text(page, '#tafelInhalt .t-abschnitt'), 'Diese Seite (I1)');
      assert.deepEqual((await grafikKnoepfe(page)).slice(0, 2).map((k) => k[2]), ['2 Dateien · Kästen, Bilder', '2 Dateien · 1 echte SVG, 1 mit eingebettetem HTML – ' + HTML_HINWEIS]);
      const di = await H.download(page, () => page.click('#tafelInhalt .g-knopf[data-k="svg"]'));
      const dia = H.liesZip(di.puffer).find((d) => d.name === '1.1_I1_02_bild.svg').daten.toString('utf8');
      assert.match(dia, /^<\?xml[^>]*>\n<svg [^>]*viewBox="0 0 900 300"[^>]*><style>@font-face\{font-family:"Platzhalter Jost";src:url\("data:font\/woff;base64,/);
      assert.match(dia, /<text x="450" y="160" text-anchor="middle" class="svt" data-t="t3" style="[^"]*fill:\s*rgb\(255, 255, 255\)[^"]*font-family:\s*&quot;Platzhalter Jost&quot;[^"]*font-size:\s*24px[^"]*">Platzhalter-Diagramm<\/text>/);
      assert.ok(!dia.includes('foreignObject'));
      assert.deepEqual(log.errors, []);
    });
  });

  test('Ganze Version als ZIP (ohne ausgeblendete Seiten, Ordner je Seite, gültig), Abbrechen; Dateinamen der Version; Teilen-Weg wie bei PDF und Bild', async () => {
    await mitSeite({ init: [H.ohneTeilen] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      assert.equal(await text(page, '#btnGrafikenVersion'), 'Grafiken & Daten exportieren');
      await page.evaluate(() => window.AetherFlyer.aendereStruktur((pk) => window.AetherFlyerStruktur.seiteAusblenden(pk, '1.1', 'E1', true)));
      // Abbrechen: Tafel zu, nichts heruntergeladen
      await page.click('#btnGrafikenVersion');
      assert.equal((await tafel(page)).titel, 'Version 1.1 · Grafiken & Daten');
      await tafelKnopf(page, 'Abbrechen');
      assert.ok(await page.isHidden('#tafel'));
      await page.click('#btnGrafikenVersion');
      assert.equal(await text(page, '#tafelInhalt .t-klein'), '3 Seiten (ohne 1 ausgeblendete) · je Seite alle Grafiken als PNG und SVG, Daten als CSV und JSON');
      await page.waitForSelector('#tafelInhalt .g-fertig', { timeout: 60000 });
      const fertig = await text(page, '#tafelInhalt .g-fertig');
      assert.match(fertig, /^Fertig: 26 Dateien · \d+ KB$/, 'S1, S2 je 4 Grafiken × 2 + 2, I1 2 × 2 + 2');
      const d = await H.download(page, () => tafelKnopf(page, 'ZIP sichern'));
      assert.equal(d.name, 'aether-flyer_1.1.zip');
      const z = H.liesZip(d.puffer);
      assert.equal(z.length, 26);
      assert.ok(z.every((x) => x.crcOk && x.methode === 0 && x.groesse === x.roh), 'alle Einträge gültig');
      assert.ok(z.every((x) => /^(S1|S2|I1)\/1\.1_\1(_\d\d_(kasten|kennzahlen|balken|symbol|bild)\.(png|svg)|\.(csv|json))$/.test(x.name)), 'Dateinamen nur ASCII nach dem Muster');
      assert.deepEqual([...new Set(z.map((x) => x.name.split('/')[0]))], ['S1', 'S2', 'I1'], 'E1 (ausgeblendet) fehlt');
      for (const id of ['S1', 'S2', 'I1']) {
        const n = z.filter((x) => x.name.startsWith(id + '/'));
        assert.equal(n.filter((x) => x.name.endsWith('.png')).length, n.filter((x) => x.name.endsWith('.svg')).length, `${id}: zu jeder PNG eine SVG`);
        assert.ok(n.some((x) => x.name === `${id}/1.1_${id}.csv`) && n.some((x) => x.name === `${id}/1.1_${id}.json`));
      }
      assert.deepEqual(z.find((x) => x.name === 'S1/1.1_S1.csv').daten.subarray(0, 3), Buffer.from([0xef, 0xbb, 0xbf]));
      await page.keyboard.press('Escape');
      // Andere Version: Dateinamen tragen ihre Nummer
      await page.evaluate(async () => {
        await window.AetherFlyer.aendereStruktur((pk) => window.AetherFlyerStruktur.versionKopieren(pk, '1.1', '1.2'));
        await window.AetherFlyer.oeffneVersion('1.2');
      });
      await warteVersion(page, '1.2');
      const namen = await page.evaluate(async () => {
        const pk = window.AetherFlyerAnsicht.paket();
        const s = await window.AetherFlyerGrafik.seiteVorbereiten(pk.dokumente[0], pk.nummer, {});
        return [s.namen.csv, s.namen.json, ...s.grafiken.map((g) => g.namen.png)];
      });
      assert.deepEqual(namen, ['1.2_S1.csv', '1.2_S1.json', '1.2_S1_01_symbol.png', '1.2_S1_02_kennzahlen.png', '1.2_S1_03_kasten.png', '1.2_S1_04_balken.png']);
      assert.deepEqual(log.errors, []);
    });
    // iPad: Teilen (navigator.share mit der Datei, synchron im Klick) statt Download
    const teilen = () => {
      window.__geteilt = [];
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: (d) => { window.__geteilt.push([d.title, ...d.files.map((f) => [f.name, f.type, f.size])]); return Promise.resolve(); } });
    };
    await mitSeite({ init: [teilen] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await seitenMenue(page, 'S2');
      await tafelKnopf(page, 'Grafiken & Daten exportieren');
      await warteGrafik(page);
      await page.click('#tafelInhalt .g-knopf[data-k="csv"]');
      await page.click('#tafelInhalt .g-knopf[data-k="png"]');
      const g = await page.evaluate(() => window.__geteilt.map((x) => [x[0], x[1][0], x[1][1]]));
      assert.deepEqual(g, [['Aether 1.1 · S2 – Daten (CSV)', '1.1_S2.csv', 'text/csv'], ['Aether 1.1 · S2 – Grafiken (PNG)', '1.1_S2_png.zip', 'application/zip']]);
      assert.deepEqual(log.errors, []);
    });
  });
});

// ---------------------------------------------------------------------------
// i) Oberfläche auf dem iPhone (390 px): kein waagerechtes Scrollen, Tippflächen ≥ 44 px, 2 Ordner-Kacheln je Reihe,
// Backspace-Regel in Tafeln
// ---------------------------------------------------------------------------
const waagerecht = (page) => page.evaluate(() => {
  const d = document.documentElement, t = document.querySelector('#tafel .tafel');
  return { seite: d.scrollWidth - d.clientWidth, tafel: t && !document.getElementById('tafel').hidden ? t.scrollWidth - t.clientWidth : 0 };
});
// Sichtbare Bedienelemente unter 44 × 44 px (Knöpfe, Links, Ankreuz-Zeilen, Auswahl)
const zuKlein = (page, wurzel) => page.evaluate((wurzel) => {
  const aus = [];
  for (const e of document.querySelectorAll(wurzel + ' button, ' + wurzel + ' a[href], ' + wurzel + ' .t-check, ' + wurzel + ' select, ' + wurzel + ' input[type="text"]')) {
    const r = e.getBoundingClientRect();
    if (!r.width || !r.height || e.closest('[hidden]') || getComputedStyle(e).visibility === 'hidden') continue;
    if (r.width < 44 - 0.5 || r.height < 44 - 0.5) aus.push((e.id || e.className || e.localName) + ' ' + Math.round(r.width) + '×' + Math.round(r.height));
  }
  return aus;
}, wurzel);
async function pruefeFlaeche(page, wo, wurzel) {
  assert.deepEqual(await waagerecht(page), { seite: 0, tafel: 0 }, `${wo}: kein waagerechtes Scrollen`);
  assert.deepEqual(await zuKlein(page, wurzel), [], `${wo}: Tippflächen ≥ 44 px`);
}

describe('F3a: Oberfläche auf dem iPhone (i)', () => {
  test('390 px hoch: Übersicht, Ordner (2 je Reihe), Tafeln, Menüs, Export und Vollbild ohne waagerechtes Scrollen, Tippflächen ≥ 44 px; Backspace in Tafeln', async () => {
    await mitSeite({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 3, init: [H.ohneTeilen] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paketV1());
      await ruhe(page);
      await pruefeFlaeche(page, 'Übersicht', 'main');
      const reihen = await page.$$eval('#ordnerKacheln > *', (ks) => ks.map((k) => Math.round(k.getBoundingClientRect().top)));
      assert.equal(reihen.length, 5, '4 Ordner + „+ Neuer Ordner“');
      assert.deepEqual([reihen[0] === reihen[1], reihen[1] < reihen[2], reihen[2] === reihen[3], reihen[3] < reihen[4]], [true, true, true, true], 'Ordner-Kacheln 2 je Reihe');
      // Ordner öffnen, Tafeln darüber: Backspace schließt erst die Tafel, der Ordner bleibt
      await page.click('#ordnerKacheln .ordner-kachel[data-ordner="spiel"] .ok-oeffnen');
      await pruefeFlaeche(page, 'Ordner geöffnet', 'main');
      await page.click('#btnVersion');
      await pruefeFlaeche(page, 'Tafel Versionen', '#tafel');
      await page.keyboard.press('Backspace');
      assert.ok(await page.isHidden('#tafel'));
      assert.deepEqual(await page.$$eval('#pfadListe .pfad-glied', (bs) => bs.map((b) => b.textContent)), ['Alle', 'Platzhalter Spiel'], 'Backspace wirkte nur auf die Tafel');
      await page.click('#btnNeueSeite');
      await pruefeFlaeche(page, 'Tafel Neue Seite', '#tafel');
      await page.keyboard.press('Escape');
      // Menü „···“ → „In Ordner …“: Backspace geht eine Tafel zurück, dann zu
      await seitenMenue(page, 'S1');
      await pruefeFlaeche(page, 'Menü einer Seite', '#tafel');
      await tafelKnopf(page, 'In Ordner …');
      assert.equal((await tafel(page)).titel, 'In Ordner · S1');
      await pruefeFlaeche(page, 'Tafel In Ordner', '#tafel');
      await page.keyboard.press('Backspace');
      assert.equal((await tafel(page)).titel, 'S1 · Platzhalter eins');
      // Export-Tafel
      await tafelKnopf(page, 'Grafiken & Daten exportieren');
      await warteGrafik(page);
      await pruefeFlaeche(page, 'Tafel Grafiken & Daten', '#tafel');
      assert.equal(await page.$$eval('#tafelInhalt .g-raster', (r) => getComputedStyle(r[0]).gridTemplateColumns.split(' ').length), 3);
      await page.keyboard.press('Backspace');
      assert.equal((await tafel(page)).titel, 'S1 · Platzhalter eins');
      await page.keyboard.press('Backspace');
      assert.ok(await page.isHidden('#tafel'));
      // Textfeld: Backspace löscht Zeichen, die Tafel bleibt
      await page.click('#btnNeuerOrdner');
      await page.fill('#tafelFeld', 'Abc');
      await page.press('#tafelFeld', 'Backspace');
      assert.equal(await page.inputValue('#tafelFeld'), 'Ab');
      assert.equal((await tafel(page)).titel, 'Neuer Ordner');
      await pruefeFlaeche(page, 'Tafel Neuer Ordner', '#tafel');
      await page.keyboard.press('Escape');
      assert.ok(await page.isHidden('#tafel'));
      // Vollbild mit „Export“, ZIP der Version
      await page.evaluate(() => window.AetherFlyerAnsicht.oeffneDok('S1'));
      await page.waitForSelector('#vbExport:not([hidden])');
      await pruefeFlaeche(page, 'Vollbild', '#vollbild .vb-leiste');
      await page.click('#vbZu');
      await page.click('#btnGrafikenVersion');
      await page.waitForSelector('#tafelInhalt .g-fertig', { timeout: 60000 });
      await pruefeFlaeche(page, 'Tafel Version als ZIP', '#tafel');
      assert.deepEqual(log.errors, []);
    });
  });
});

// ---------------------------------------------------------------------------
// Teil A: IndexedDB-Migration 2 → 3 mit vorhandener Änderungsschicht (Teil 2)
// ---------------------------------------------------------------------------
describe('F3a: Speicher (Teil A)', () => {
  test('IndexedDB-Migration 2 → 3: Einträge der Änderungsschicht wandern nach Version 1.1 (Schlüssel e:1.1…), Basis bleibt v1, Stores struktur und geraet kommen dazu; Version 1.1 offen', async () => {
    await mitSeite({}, async ({ page, log }) => {
      // Datenbank in Version 2 (wie Teil 2) auf einer anderen Seite desselben Ursprungs anlegen und befüllen
      await page.goto(H.umgebung.baseUrl + 'manifest.json');
      const basis = { paket: paketV1(), quelle: 'import', sha: null, uebernommen: '2026-01-01T00:00:00.000Z' };
      const eintrag = { dok: 'S1', k: 't2', art: 'text', alt: 'Platzhalter eins', neu: 'Vor F3a geändert', exportiert: null, zeit: '2026-01-02T00:00:00.000Z', konflikt: null };
      const status = { dok: 'S2', k: 's1', art: 'status', alt: 'ok', neu: 'plan', exportiert: null, zeit: '2026-01-02T00:00:00.000Z', konflikt: null };
      await page.evaluate(([b, e, s]) => new Promise((resolve, reject) => {
        const r = indexedDB.open('aether-flyer', 2);
        r.onupgradeneeded = () => { for (const n of ['basis', 'online', 'aenderungen']) r.result.createObjectStore(n); };
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result, tx = db.transaction(['basis', 'aenderungen'], 'readwrite');
          tx.objectStore('basis').put(b, 'aktuell');
          tx.objectStore('aenderungen').put(e, 'e:S1\ntext\nt2');
          tx.objectStore('aenderungen').put(s, 'e:S2\nstatus\ns1');
          tx.objectStore('aenderungen').put({ exporte: [] }, 'meta');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }), [basis, eintrag, status]);
      await oeffneFlyer(page);
      await ruhe(page);
      const db = await idb(page);
      assert.deepEqual(Object.keys(db).sort(), ['aenderungen', 'basis', 'geraet', 'medien', 'online', 'struktur', 'werte']);
      assert.equal(db.basis.version, 5);
      assert.deepEqual(db.basis.werte, [basis], 'Basis unverändert (bleibt v1)');
      assert.deepEqual(db.aenderungen.schluessel.sort(), ['e:1.1\nS1\ntext\nt2', 'e:1.1\nS2\nstatus\ns1', 'meta']);
      const werte = db.aenderungen.werte.filter((w) => w.dok).sort((a, b) => a.dok.localeCompare(b.dok));
      assert.deepEqual(werte, [Object.assign({ ver: '1.1' }, eintrag), Object.assign({ ver: '1.1' }, status)], 'Einträge unverändert, nur mit ver');
      assert.equal(await page.evaluate(() => window.AetherFlyer.version()), '1.1');
      assert.equal(await kachelText(page, 'S1', 't2'), 'Vor F3a geändert', 'Änderung weiter sichtbar');
      assert.equal(await page.$eval('#kacheln .kachel[data-id="S2"] .flyer-host', (h) => h.shadowRoot.querySelector('[data-s="s1"]').getAttribute('data-status')), 'plan');
      assert.match(await text(page, '#status'), /· 2 Änderungen nicht exportiert$/);
      assert.deepEqual(log.errors, []);
    });
  });
});
