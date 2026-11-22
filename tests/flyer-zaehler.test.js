// Tests „Flyer-Zähler in allen Blöcken mit Status-Punkten“ (Variante b) und „Flyer-Abgleich in einem Schritt“.
// Zähler: In jedem Block (data-block mit data-zaehler), in dem ein Punkt (data-s) einen Status hat – aus dem Paket oder
// aus der Änderungsschicht –, steht der Zähler schon beim ersten Darstellen (Kachel, Vollbild, Druck/PDF, „Alle als
// PDF“, Bild); Blöcke ohne Status bleiben ohne Zähler; der Export bleibt unverändert.
// Abgleich: Änderungsschicht und neue Basis in EINER IndexedDB-Transaktion; erzwungener Fehler → beides unverändert.
// Nur Platzhalter-Pakete. Aufruf: node --test tests/flyer-zaehler.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const H = require('./flyer-hilfe.js');
const { assert, mitSeite, oeffneFlyer, importiere, ruhe, idb, VERSION, STAND, FLYER_CSS } = H;

before(H.starte);
after(H.beende);

const zahl = (v) => String(Math.round(v * 10000) / 10000);
const li = (k, st) => `<li data-s="${k}"${st ? ` data-status="${st}"` : ''}><ae-t data-t="t${k.slice(1)}0">Platzhalter ${k}</ae-t></li>`;
// Vier Blöcke wie im echten Paket (<div data-block><h3 data-zaehler>…), dazu einer mit Wert (Zähler außerhalb):
//  B1: ok, run, plan, ohne      → 1 von 4, --anteil 0.25, --anteil-laeuft 0.25
//  B2: ohne Status              → kein Zähler
//  B3: plan, next               → 0 von 2 (Block mit Status, aber nichts fertig)
//  B4: ok, run, run             → 1 von 3, --anteil 0.3333, --anteil-laeuft 0.6667 (4 Nachkommastellen)
//  B5 (data-block="b5", Zähler außerhalb, ohne Status) → kein Zähler
function zaehlerHtml() {
  return '<section class="page"><div class="body">' +
    '<div class="blk" data-block><h3 data-zaehler><ae-t data-t="t1">Platzhalter-Block eins</ae-t></h3><ul>' + li('s1', 'ok') + li('s2', 'run') + li('s3', 'plan') + li('s4') + '</ul></div>' +
    '<div class="blk" data-block><h3 data-zaehler><ae-t data-t="t2">Platzhalter-Block zwei</ae-t></h3><ul>' + li('s5') + li('s6') + '</ul></div>' +
    '<div class="blk" data-block><h3 data-zaehler><ae-t data-t="t3">Platzhalter-Block drei</ae-t></h3><ul>' + li('s7', 'plan') + li('s8', 'next') + '</ul></div>' +
    '<div class="blk" data-block><h3 data-zaehler><ae-t data-t="t4">Platzhalter-Block vier</ae-t></h3><ul>' + li('s9', 'ok') + li('s11', 'run') + li('s12', 'run') + '</ul></div>' +
    '<p data-zaehler="b5"><ae-t data-t="t5">Platzhalter außen</ae-t></p><ul data-block="b5">' + li('s13') + li('s14') + '</ul>' +
    '<div class="fill"></div></div></section>';
}
const ERWARTET = [
  ['1 von 4 fertig', zahl(1 / 4), zahl(1 / 4)],
  [null, '', ''],
  ['0 von 2 fertig', '0', '0'],
  ['1 von 3 fertig', zahl(1 / 3), zahl(2 / 3)],
  [null, '', '']
];
function paket(o = {}) {
  const css = FLYER_CSS + '\n[data-zaehler]:has(> .zaehler){display:flex;justify-content:space-between;background:linear-gradient(90deg,#00ff00 0 calc(var(--anteil,0)*100%),#333 0)}';
  return { format: 'aether-flyer-paket', formatVersion: 1, version: o.version || VERSION, stand: STAND, titel: 'Platzhalter-Zähler',
    css: { flyer: css, infografik: '' }, kategorien: [{ id: 'k', name: 'Platzhalter' }],
    dokumente: [
      { id: 'Z1', art: 'flyer', kategorie: 'k', titel: 'Platzhalter Zähler', breite: 794, hoehe: 1123, html: zaehlerHtml() },
      { id: 'Z2', art: 'flyer', kategorie: 'k', titel: o.titel2 || 'Platzhalter zwei', breite: 794, hoehe: 1123, html: zaehlerHtml().replace('Platzhalter-Block eins', 'Platzhalter-Block eins (2)') }
    ] };
}
// Zähler aller data-zaehler-Elemente in einem Shadow-Host bzw. in einem HTML-Text
const lies = (z) => [z.querySelector(':scope > .zaehler') ? z.querySelector(':scope > .zaehler').textContent : null,
  z.style.getPropertyValue('--anteil'), z.style.getPropertyValue('--anteil-laeuft')];
async function hostZaehler(page, sel) {
  return page.$eval(sel, (h, liesTxt) => {
    const lies = new Function('return ' + liesTxt)();
    return [...h.shadowRoot.querySelectorAll('[data-zaehler]')].map(lies);
  }, lies.toString());
}
function druckStub() { window.__druck = 0; window.print = () => { window.__druck++; }; }
// Bild: Markup, das in das SVG-Bild kommt (XMLSerializer im Bild-Weg), mitschneiden
function bildMitschnitt() {
  window.__bild = [];
  const orig = XMLSerializer.prototype.serializeToString;
  XMLSerializer.prototype.serializeToString = function (n) { const s = orig.call(this, n); window.__bild.push(s); return s; };
}

describe('Flyer-Zähler in allen Blöcken mit Status', () => {
  test('h) Block mit Status → Zähler beim ersten Darstellen (Kachel, Vollbild, Druck, „Alle als PDF“, Bild); ohne Status kein Zähler; x/y/--anteil/--anteil-laeuft stimmen', async () => {
    await mitSeite({ init: [druckStub, bildMitschnitt] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      await ruhe(page);
      // Kachel: sofort, ohne jede Änderung
      assert.deepEqual(await hostZaehler(page, '#kacheln .kachel[data-id="Z1"] .flyer-host'), ERWARTET, 'Kachel');
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.alle().length), 0, 'keine eigene Änderung');
      // Kein „0 von y“ in Blöcken ohne Status, nirgends ein Zähler mit „0 von 2“ außer Block drei
      const texte = await page.$eval('#kacheln .kachel[data-id="Z1"] .flyer-host', (h) => h.shadowRoot.textContent);
      assert.equal((texte.match(/0 von 2 fertig/g) || []).length, 1);
      // Balken nur dort, wo ein Zähler steht
      const balken = await page.$eval('#kacheln .kachel[data-id="Z1"] .flyer-host', (h) => [...h.shadowRoot.querySelectorAll('[data-zaehler]')].map((z) => getComputedStyle(z).backgroundImage !== 'none'));
      assert.deepEqual(balken, [true, false, true, true, false]);
      // Vollbild
      await page.click('#kacheln .kachel[data-id="Z1"]');
      await page.waitForSelector('#vbBuehne .flyer-host');
      assert.deepEqual(await hostZaehler(page, '#vbBuehne .flyer-host'), ERWARTET, 'Vollbild');
      // Druck/PDF (ein Dokument)
      await page.evaluate(() => window.AetherFlyerExport.druckeEins());
      await page.waitForFunction(() => document.querySelectorAll('#druck .flyer-host').length === 1);
      assert.deepEqual(await hostZaehler(page, '#druck .druck-seite[data-id="Z1"] .flyer-host'), ERWARTET, 'Druck');
      await page.click('#vbZu');
      // „Alle als PDF“
      await page.click('#btnAllePdf');
      await page.waitForFunction(() => document.querySelectorAll('#druck .flyer-host').length === 2);
      assert.deepEqual(await hostZaehler(page, '#druck .druck-seite[data-id="Z1"] .flyer-host'), ERWARTET, 'Alle als PDF');
      assert.deepEqual(await hostZaehler(page, '#druck .druck-seite[data-id="Z2"] .flyer-host'), ERWARTET, 'Alle als PDF, Dokument zwei');
      // Bild
      await page.evaluate(() => { window.__bild = []; });
      await page.evaluate(() => { const a = window.AetherFlyerAnsicht; return window.AetherFlyerExport.seitenBild(a.paket().dokumente.find((d) => d.id === 'Z1')).then(() => true, () => true); });
      const bild = await page.evaluate((liesTxt) => {
        const lies = new Function('return ' + liesTxt)();
        const s = window.__bild.find((x) => x.includes('Platzhalter-Block eins'));
        if (!s) return null;
        const doc = new DOMParser().parseFromString('<!doctype html><body>' + s, 'text/html');
        return [...doc.querySelectorAll('[data-zaehler]')].map(lies);
      }, lies.toString());
      assert.deepEqual(bild, ERWARTET, 'Bild');
      assert.deepEqual(log.errors, []);
    });
  });

  test('h2) Status aus der Änderungsschicht: Block ohne Status bekommt den Zähler; Status wieder weg → kein Zähler, kein „0 von y“; Export unverändert', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      await ruhe(page);
      await page.evaluate(() => window.AetherFlyerAenderungen.setze('Z1', 'status', 's5', 'run').then(() => window.AetherFlyerAnsicht.aktualisiere('Z1')));
      await ruhe(page);
      let z = await hostZaehler(page, '#kacheln .kachel[data-id="Z1"] .flyer-host');
      assert.deepEqual(z[1], ['0 von 2 fertig', '0', '0.5'], 'Block zwei mit eigenem Status');
      // Export: Zähler nur im Block mit eigener Änderung (Block zwei), Blöcke mit Paket-Status ohne angelegten Zähler
      const ex = await page.evaluate(() => {
        const e = window.AetherFlyerAenderungen.exportPaket(null);
        const s = e.paket.versionen[0].seiten.find((d) => d.id === 'Z1');
        const doc = new DOMParser().parseFromString(s.html, 'text/html');
        return [...doc.querySelectorAll('[data-zaehler]')].map((z) => !!z.querySelector(':scope > .zaehler'));
      });
      assert.deepEqual(ex, [false, true, false, false, false], 'Export wie bisher: nur nach eigener Status-Änderung');
      // Status wieder entfernen (eigener Wert „ohne Status“): Block zwei hat keinen Status → kein Zähler
      await page.evaluate(() => window.AetherFlyerAenderungen.setze('Z1', 'status', 's5', '').then(() => window.AetherFlyerAnsicht.aktualisiere('Z1')));
      await ruhe(page);
      z = await hostZaehler(page, '#kacheln .kachel[data-id="Z1"] .flyer-host');
      assert.deepEqual(z, ERWARTET, 'ohne Status kein Zähler, kein „0 von 2“');
      assert.deepEqual(log.errors, []);
    });
  });
});

// ---------------------------------------------------------------------------
// Flyer-Abgleich in einem Schritt (Risiko 1 aus Bericht Nr. 84)
// ---------------------------------------------------------------------------
// Basis-Store „put“ scheitert, solange window.__basisFehler gesetzt ist (erzwungener Fehler beim Speichern der Basis).
function basisFehler() {
  const orig = IDBObjectStore.prototype.put;
  IDBObjectStore.prototype.put = function (...a) {
    if (window.__basisFehler && this.name === 'basis') throw new DOMException('erzwungener Fehler', 'UnknownError');
    return orig.apply(this, a);
  };
}
const schicht = (db) => (db.aenderungen ? db.aenderungen.schluessel.map((k, i) => [k, JSON.stringify(db.aenderungen.werte[i])]) : []);

describe('Flyer-Abgleich in einem Schritt', () => {
  test('i) erzwungener Fehler beim Speichern: Basis und Schicht unverändert (gespeichert, auf der Seite und nach Neuladen), Fehlerweg; danach gelingt es', async () => {
    await mitSeite({ init: [basisFehler] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      await page.evaluate(() => window.AetherFlyerAenderungen.setze('Z1', 'status', 's5', 'run'));
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig && window.AetherFlyerAenderungen.fertig());
      const vorher = await idb(page);
      assert.equal(vorher.basis.werte[0].paket.version, VERSION);
      const schichtVorher = schicht(vorher);
      assert.ok(schichtVorher.some(([k]) => k.includes('s5')), 'eigener Status s5 gespeichert');

      // Neue Fassung, in der s5 schon „run“ ist: Der Abgleich ließe den Eintrag entfallen (Schicht ändert sich).
      const neu = paket({ version: '2020-02-02.1' });
      neu.dokumente[0].html = neu.dokumente[0].html.replace('<li data-s="s5">', '<li data-s="s5" data-status="run">');
      await page.evaluate(() => { window.__basisFehler = true; });
      await importiere(page, neu);   // wartet, bis die Übernahme (gelungen oder gescheitert) durch ist
      const nach = await idb(page);
      assert.equal(nach.basis.werte[0].paket.version, VERSION, 'Basis unverändert');
      assert.deepEqual(schicht(nach), schichtVorher, 'Schicht unverändert');
      assert.equal(await page.isVisible('#fehler'), true, 'Fehlerweg der Übernahme');
      assert.match(await page.textContent('#fehler'), /Speichern fehlgeschlagen\..*nichts übernommen/);
      const seite = await page.evaluate(() => ({
        version: window.AetherFlyerAnsicht.paket().version,
        eintraege: window.AetherFlyerAenderungen.alle().map((e) => e.k)
      }));
      assert.deepEqual(seite, { version: VERSION, eintraege: ['s5'] }, 'auf der Seite: alter Stand');
      // Neu laden: alter Stand, zusammenpassend
      await page.reload();
      await oeffneFlyer(page, null);
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig && window.AetherFlyerAenderungen.fertig());
      assert.deepEqual(await page.evaluate(() => ({
        version: window.AetherFlyerAnsicht.paket().version, eintraege: window.AetherFlyerAenderungen.alle().map((e) => e.k)
      })), { version: VERSION, eintraege: ['s5'] }, 'nach Neuladen: alte Basis mit alter Schicht');

      // Ohne Fehler: beides in einem Schritt
      await page.evaluate(() => { window.__basisFehler = false; });
      await importiere(page, neu);
      await ruhe(page);
      const gut = await idb(page);
      assert.equal(gut.basis.werte[0].paket.version, '2020-02-02.1');
      assert.ok(!schicht(gut).some(([k]) => k.includes('s5')), 'Eintrag s5 entfallen (Wert jetzt in der Basis)');
      assert.equal(await page.isHidden('#fehler'), true);
      assert.deepEqual(log.errors, []);
    });
  });
});
