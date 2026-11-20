// Tests für F3a ohne Browser (Node, Module im selben Kontext geladen): Umwandlung v1 → v2 (a), Versionen (b), Ordner (c),
// Seiten (d), ZIP mit CRC-32 und CSV/Dateinamen des Exports „Grafiken & Daten“ (g, Teil ohne DOM). Das Testpaket ist
// erfunden (nur Platzhalter); kein echter Flyer-Inhalt.
// Aufruf: node --test tests/flyer-v2.test.js
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');

const ROOT = path.join(__dirname, '..');
globalThis.window = {};
for (const d of ['flyer-paket.js', 'flyer-struktur.js', 'flyer-zip.js', 'flyer-grafik.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, d), 'utf8'), { filename: d });
}
const { AetherFlyerPaket: P, AetherFlyerStruktur: ST, AetherFlyerZip: Z, AetherFlyerGrafik: GR } = globalThis.window;
const { liesZip } = require('./flyer-hilfe');   // unabhängiger ZIP-Leser (CRC mit zlib.crc32)

// Erfundenes Paket v1: HTML mit Eigenheiten, die eine Umwandlung leicht verändern würde (CRLF, Tab, Leerraum am Ende,
// Entität, Umlaut, Emoji, Kommentar, unbekanntes Attribut), Kategorien mit doppelter id und eine ohne Dokumente,
// unbekannte Felder oben und je Dokument.
const HTML_S1 = '<section class="page c-a" data-id="T1">\r\n\t<h1 data-t="t1">Platz&amp;halter äöü 🚀</h1>  \n<!-- Kommentar -->' +
  '<div class="blk" data-block="" data-unbekannt="x"><h3 data-zaehler=""><ae-t data-t="t2">Liste</ae-t></h3><ul>' +
  '<li data-s="s1" data-status="ok"><ae-t data-t="t3">Eins</ae-t></li><li data-s="s2" data-status="plan"><ae-t data-t="t4">Zwei</ae-t></li></ul></div>' +
  '<footer class="ft"><ae-t data-t="t5">T1 · Stand </ae-t><span data-stand="kurz">01.02.2020</span></footer></section>   ';
function paketV1() {
  return {
    format: 'aether-flyer-paket', formatVersion: 1, titel: 'Platzhalter-Paket', version: '2020-02-01.1', stand: '2020-02-01',
    css: { flyer: '.page{width:794px;height:1123px}', infografik: '.ig{width:1080px}' },
    kategorien: [{ id: 'a', name: 'Platzhalter A' }, { id: 'b', name: 'Platzhalter B' }, { id: 'a', name: 'doppelt' }, { id: 'leer', name: 'Platzhalter leer' }],
    dokumente: [
      { id: 'T1', art: 'flyer', kategorie: 'a', titel: 'Platzhalter eins', breite: 794, hoehe: 1123, html: HTML_S1, eigenesFeld: { bleibt: [1, 2] } },
      { id: 'T2', art: 'flyer', kategorie: 'b', titel: 'Platzhalter zwei', breite: 794, hoehe: 1123, html: '<section class="page c-b" data-id="T2"><h1 data-t="t1">Zwei</h1></section>' },
      { id: 'T3', art: 'infografik', kategorie: 'weg', titel: 'Platzhalter drei', breite: 1080, hoehe: null, html: '<section class="ig"><p data-t="t1">Drei</p></section>' }
    ],
    zusatzOben: { bleibt: true }
  };
}
const kopie = (x) => JSON.parse(JSON.stringify(x));
const fehlerText = (fn) => { try { fn(); } catch (e) { return [e.title, e.text].filter(Boolean).join(' '); } return null; };

describe('F3a a) Umwandlung v1 → v2', () => {
  test('verlustfrei: HTML bytegleich, Kategorien werden Ordner, 1.1 im Versions-Ordner V1, unbekannte Felder bleiben, Eingabe unverändert', () => {
    const v1 = paketV1();
    const vorher = JSON.stringify(v1);
    const v2 = P.alsV2(v1);
    assert.equal(JSON.stringify(v1), vorher, 'Eingabe unverändert');
    assert.equal(P.FORMAT_VERSION, 2);
    assert.deepEqual([v2.format, v2.formatVersion, v2.version, v2.stand, v2.titel], ['aether-flyer-paket', 2, '2020-02-01.1', '2020-02-01', 'Platzhalter-Paket']);
    assert.deepEqual(v2.css, v1.css);
    assert.deepEqual(v2.zusatzOben, { bleibt: true }, 'unbekanntes Feld oben bleibt');
    assert.equal(v2.versionen.length, 1);
    const v = v2.versionen[0];
    assert.deepEqual([v.nummer, v.beschreibung, v.ausgeblendet, v.zaehler], ['1.1', '', false, { seite: 0, ordner: 0 }]);
    assert.equal(ST.versionsOrdner(v.nummer), 'V1');
    assert.deepEqual(ST.versionsGruppen(v2).map((g) => [g.ordner, g.versionen.map((x) => x.nummer)]), [['V1', ['1.1']]]);
    assert.deepEqual(v.ordner, [{ id: 'a', name: 'Platzhalter A', eltern: null }, { id: 'b', name: 'Platzhalter B', eltern: null }, { id: 'leer', name: 'Platzhalter leer', eltern: null }],
      'Kategorien → Ordner (Reihenfolge, erste von doppelten gilt, leere bleibt)');
    assert.equal(v.seiten.length, 3);
    v.seiten.forEach((s, i) => {
      const d = v1.dokumente[i];
      assert.equal(s.html, d.html, `${d.id}: HTML gleich`);
      assert.ok(Buffer.from(s.html, 'utf8').equals(Buffer.from(d.html, 'utf8')), `${d.id}: HTML bytegleich`);
      assert.deepEqual([s.id, s.art, s.titel, s.breite, s.hoehe, s.herkunft, s.vorlage, s.ausgeblendet], [d.id, d.art, d.titel, d.breite, d.hoehe, 'original', null, false]);
    });
    assert.deepEqual(v.seiten.map((s) => s.ordner), [['a'], ['b'], []]);
    assert.equal(v.seiten[2].kategorie, 'weg', 'Kategorie ohne Ordner bleibt als Feld');
    assert.deepEqual(v.seiten[0].eigenesFeld, { bleibt: [1, 2] }, 'unbekanntes Feld je Dokument bleibt');
    // v2 ist gültig, zweite Umwandlung ändert nichts, die Sicht von 1.1 zeigt dieselben Dokumente
    assert.equal(P.pruefe(kopie(v2)).formatVersion, 2);
    assert.equal(JSON.stringify(P.alsV2(kopie(v2))), JSON.stringify(v2));
    const sicht = ST.sicht(v2, '1.1');
    assert.deepEqual(sicht.dokumente.map((d) => [d.id, d.html]), v1.dokumente.map((d) => [d.id, d.html]));
    assert.deepEqual(sicht.kategorien, [{ id: 'a', name: 'Platzhalter A' }, { id: 'b', name: 'Platzhalter B' }, { id: 'leer', name: 'Platzhalter leer' }]);
  });

  test('Prüfung v2: 1.1 Pflicht, Nummern eindeutig, Ordner ohne Kreis, eigene Seiten N<n> bis zaehler, formatVersion 3 zu neu', () => {
    const gut = P.alsV2(paketV1());
    const mit = (fn) => { const p = kopie(gut); fn(p); return p; };
    assert.match(fehlerText(() => P.pruefe(mit((p) => { p.versionen[0].nummer = '1.2'; }))), /Version 1\.1 fehlt/);
    assert.match(fehlerText(() => P.pruefe(mit((p) => { p.versionen.push(kopie(p.versionen[0])); }))), /kommt doppelt vor/);
    assert.match(fehlerText(() => P.pruefe(mit((p) => { p.versionen[0].nummer = '1.0'; }))), /nummer muss „x\.y“ sein/);
    assert.match(fehlerText(() => P.pruefe(mit((p) => { p.versionen[0].ordner[0].eltern = 'b'; p.versionen[0].ordner[1].eltern = 'a'; }))), /liegt in sich selbst/);
    assert.match(fehlerText(() => P.pruefe(mit((p) => { p.versionen[0].seiten[0].ordner = ['fehlt']; }))), /gibt es in dieser Version nicht/);
    assert.match(fehlerText(() => P.pruefe(mit((p) => { const s = p.versionen[0].seiten[1]; s.herkunft = 'eigen'; s.id = 'N1'; }))), /größer als zaehler\.seite/);
    assert.match(fehlerText(() => P.pruefe(mit((p) => { p.versionen[0].seiten[1].herkunft = 'eigen'; p.versionen[0].zaehler.seite = 5; }))), /Kennung „N<n>“/);
    assert.match(fehlerText(() => P.pruefe(mit((p) => { p.formatVersion = 3; }))), /^Paket zu neu .*kennt Version 2/);
  });
});

describe('F3a b) Versionen', () => {
  test('Nummernvergabe Unter-/Hauptversion, Kopie unabhängig von der Quelle, 1.1 nie löschbar, Ausblenden, Beschreibung ≤ 80', () => {
    const pk = P.alsV2(paketV1());
    assert.equal(ST.naechsteUnterversion(pk, '1.1'), '1.2');
    assert.equal(ST.naechsteHauptversion(pk), '2.1');
    const v12 = ST.versionKopieren(pk, '1.1', '1.2');
    assert.equal(v12.beschreibung, 'Kopie von 1.1');
    ST.versionKopieren(pk, '1.1', ST.naechsteUnterversion(pk, '1.1'));
    assert.deepEqual(pk.versionen.map((v) => v.nummer), ['1.1', '1.2', '1.3']);
    assert.equal(ST.naechsteUnterversion(pk, '1.2'), '1.4', 'höchste + 1 im selben Versions-Ordner');
    ST.versionKopieren(pk, '1.3', ST.naechsteHauptversion(pk));
    assert.equal(ST.naechsteHauptversion(pk), '3.1');
    assert.equal(ST.naechsteUnterversion(pk, '2.1'), '2.2');
    ST.versionLoeschen(pk, '1.2');
    assert.equal(ST.naechsteUnterversion(pk, '1.1'), '1.4', 'Lücke wird nicht gefüllt');
    assert.deepEqual(ST.versionsGruppen(pk).map((g) => [g.ordner, g.versionen.map((v) => v.nummer)]), [['V1', ['1.1', '1.3']], ['V2', ['2.1']]]);
    assert.match(fehlerText(() => ST.versionKopieren(pk, '1.1', '1.3')), /gibt es schon/);
    // Kopie unabhängig: alles an der Kopie ändern, die Quelle bleibt
    const quelle = ST.version(pk, '1.1'), vorher = JSON.stringify(quelle);
    const k = ST.version(pk, '2.1');
    assert.notEqual(k.seiten, quelle.seiten);
    assert.notEqual(k.seiten[0], quelle.seiten[0]);
    assert.notEqual(k.ordner[0], quelle.ordner[0]);
    assert.notEqual(k.zaehler, quelle.zaehler);
    k.seiten[0].titel = 'geändert'; k.seiten[0].ordner.push('b'); k.seiten[0].eigenesFeld.bleibt.push(3); k.seiten[0].html += 'x';
    k.ordner[0].name = 'geändert'; k.zaehler.seite = 9; k.seiten.pop();
    ST.ordnerAnlegen(pk, '2.1', null, 'Nur in 2.1');
    ST.seiteAnlegen(pk, '2.1', { vorlage: 'leer', heute: '2020-02-02' });
    assert.equal(JSON.stringify(quelle), vorher, 'Quelle 1.1 unverändert');
    // Kopie mit dem HTML, wie die Quelle es zeigt (Änderungsschicht)
    const v4 = ST.versionKopieren(pk, '1.1', '1.4', (nr, s) => s.html + '<!-- ' + nr + ' -->');
    assert.ok(v4.seiten.every((s, i) => s.html === quelle.seiten[i].html + '<!-- 1.1 -->'));
    // 1.1 nie löschbar; andere ja; Ausblenden
    assert.match(fehlerText(() => ST.versionLoeschen(pk, '1.1')), /^Version 1\.1 lässt sich nicht löschen/);
    assert.ok(ST.version(pk, '1.1'));
    ST.versionAusblenden(pk, '1.3', true);
    assert.equal(ST.version(pk, '1.3').ausgeblendet, true);
    ST.versionAusblenden(pk, '1.3', false);
    assert.equal(ST.version(pk, '1.3').ausgeblendet, false);
    assert.equal(ST.versionBeschreiben(pk, '1.3', '  Platzhalter   Text ').beschreibung, 'Platzhalter Text');
    assert.equal(ST.versionBeschreiben(pk, '1.3', 'x'.repeat(80)).beschreibung.length, 80);
    assert.match(fehlerText(() => ST.versionBeschreiben(pk, '1.3', 'x'.repeat(81))), /Höchstens 80 Zeichen \(jetzt 81\)/);
    assert.equal(P.pruefe(kopie(pk)).versionen.length, 4, 'Ergebnis bleibt ein gültiges Paket');
  });
});

describe('F3a c) Ordner', () => {
  test('verschachtelt, mehrfache Zuordnung, „Alle“ ohne Doppelte, Verschieben ohne Kreis, Löschen erhält Seiten, Namen', () => {
    const pk = P.alsV2(paketV1());
    const o1 = ST.ordnerAnlegen(pk, '1.1', 'a', 'Unter A');
    const o2 = ST.ordnerAnlegen(pk, '1.1', o1.id, 'Unter Unter A');
    assert.deepEqual([o1.id, o2.id], ['O1', 'O2']);
    const v = ST.version(pk, '1.1');
    assert.deepEqual(ST.pfad(v, o2.id).map((o) => o.id), ['a', 'O1', 'O2']);
    assert.deepEqual([...ST.nachfahren(v, 'a')].sort(), ['O1', 'O2']);
    assert.deepEqual(ST.ordnerBaum(v).map((x) => [x.ordner.id, x.ebene]), [['a', 0], ['O1', 1], ['O2', 2], ['b', 0], ['leer', 0]]);
    assert.match(fehlerText(() => ST.ordnerAnlegen(pk, '1.1', 'a', ' unter a ')), /Name schon vergeben/);
    assert.equal(ST.ordnerAnlegen(pk, '1.1', 'b', 'Unter A').eltern, 'b', 'gleicher Name in anderem Elternordner erlaubt');
    assert.match(fehlerText(() => ST.ordnerAnlegen(pk, '1.1', null, '  ')), /braucht einen Namen/);
    assert.match(fehlerText(() => ST.ordnerAnlegen(pk, '1.1', null, 'x'.repeat(61))), /Höchstens 60 Zeichen/);
    // Mehrfache Zuordnung: T1 in a, O2 und b; „Alle“ (Sicht) zeigt jede Seite genau einmal
    ST.seiteInOrdner(pk, '1.1', 'T1', ['b', 'O2', 'a']);
    assert.deepEqual(v.seiten[0].ordner, ['a', 'b', 'O2'], 'Reihenfolge der Version');
    assert.deepEqual(ST.seitenIn(v, 'O2', false).map((s) => s.id), ['T1']);
    assert.deepEqual(ST.seitenIn(v, 'b', false).map((s) => s.id), ['T1', 'T2']);
    const alle = ST.sicht(pk, '1.1').dokumente.map((d) => d.id);
    assert.deepEqual(alle, ['T1', 'T2', 'T3']);
    assert.equal(new Set(alle).size, alle.length, '„Alle“ ohne Doppelte');
    assert.deepEqual(ST.ordnerZahlen(v, 'a'), { seiten: 1, ordner: 1 });
    // Verschieben: nicht in sich selbst, nicht in einen eigenen Unterordner (auch nicht tiefer), sonst ja
    assert.match(fehlerText(() => ST.ordnerVerschieben(pk, '1.1', 'a', 'a')), /nicht in sich selbst oder einen eigenen Unterordner/);
    assert.match(fehlerText(() => ST.ordnerVerschieben(pk, '1.1', 'a', 'O1')), /nicht in sich selbst oder einen eigenen Unterordner/);
    assert.match(fehlerText(() => ST.ordnerVerschieben(pk, '1.1', 'a', 'O2')), /nicht in sich selbst oder einen eigenen Unterordner/);
    assert.match(fehlerText(() => ST.ordnerVerschieben(pk, '1.1', 'O1', 'b')), /Name schon vergeben/, 'gleicher Name im Ziel');
    ST.ordnerVerschieben(pk, '1.1', 'O2', 'b');
    assert.equal(ST.ordnerVerschieben(pk, '1.1', 'O2', null).eltern, null);
    assert.equal(P.pruefe(kopie(pk)).formatVersion, 2);
    // Löschen: Seiten bleiben (verlieren nur die Zuordnung), Unterordner wandern in den Elternordner
    ST.ordnerVerschieben(pk, '1.1', 'O2', 'O1');
    const seitenVorher = v.seiten.map((s) => s.id);
    ST.ordnerLoeschen(pk, '1.1', 'O1');
    assert.deepEqual(v.seiten.map((s) => s.id), seitenVorher);
    assert.deepEqual(v.seiten[0].ordner, ['a', 'b', 'O2']);
    assert.equal(v.ordner.find((o) => o.id === 'O2').eltern, 'a');
    ST.ordnerLoeschen(pk, '1.1', 'a');
    assert.deepEqual(v.seiten[0].ordner, ['b', 'O2']);
    assert.equal(v.ordner.find((o) => o.id === 'O2').eltern, null);
    // Kennungen O<n> nie wiederverwendet
    assert.equal(ST.ordnerAnlegen(pk, '1.1', null, 'Neu').id, 'O4');
    assert.equal(P.pruefe(kopie(pk)).formatVersion, 2);
  });
});

describe('F3a d) Seiten', () => {
  test('Vorlagen tragen gültige Markierungen (Zähler, Status, Stand), Bild/Video freigeschaltet (F3b), Kopie, Kennungen N… nie wiederverwendet, Original nie löschbar, Ausblenden', () => {
    const pk = P.alsV2(paketV1());
    const v = ST.version(pk, '1.1');
    assert.deepEqual(ST.VORLAGEN.map((x) => [x.id, !!x.gesperrt]), [['leer', false], ['titel-text', false], ['liste-status', false], ['kennzahlen', false], ['zwei-kaesten', false], ['bild-video', false]]);
    // F3b: „Bild / Video“ freigeschaltet (geprüft in tests/flyer-f3b.test.js); eine unbekannte Vorlage bleibt abgelehnt
    assert.match(fehlerText(() => ST.seiteAnlegen(pk, '1.1', { vorlage: 'gibt-es-nicht', heute: '2020-02-03' })), /Vorlage nicht verfügbar/);
    const tZahl = { leer: 3, 'titel-text': 7, 'liste-status': 10, kennzahlen: 13, 'zwei-kaesten': 9 };
    const neu = {};
    for (const vl of ST.VORLAGEN.filter((x) => !x.gesperrt && x.id !== 'bild-video')) {   // F3b: Bild / Video eigens in flyer-f3b.test.js
      const s = ST.seiteAnlegen(pk, '1.1', { vorlage: vl.id, ordner: ['a'], heute: '2020-02-03' });
      neu[vl.id] = s;
      assert.equal(s.herkunft, 'eigen');
      assert.equal(s.titel, 'Neue Seite (' + vl.name + ')');
      const ts = [...s.html.matchAll(/ data-t="t(\d+)"/g)].map((m) => Number(m[1])).sort((x, y) => x - y);
      assert.deepEqual(ts, Array.from({ length: tZahl[vl.id] }, (_, i) => i + 1), `${vl.id}: data-t t1…t${tZahl[vl.id]} eindeutig und lückenlos`);
      assert.match(s.html, new RegExp('^<section class="page c-a" data-id="' + s.id + '"'), `${vl.id}: Aussehen wie die Seiten im Ordner, Kennung an der Wurzel`);
      assert.match(s.html, /<i class="logo" role="img"/, 'Logo oben links');
      assert.match(s.html, /<span class="kick" data-t="t\d+">Platzhalter A<\/span>/, 'Marke = Ordnername');
      assert.match(s.html, new RegExp('<ae-t data-t="t\\d+">' + s.id + ' · Stand </ae-t><span data-stand="kurz">03\\.02\\.2020</span>'), 'Fußzeile mit Kennung und Stand');
    }
    // Liste mit Status: Zähler-Text und Anteile passen zu den Status (1 von 4 fertig, 1 läuft)
    const ls = neu['liste-status'].html;
    const status = [...ls.matchAll(/<li data-s="(s\d)" data-status="(\w+)">/g)].map((m) => [m[1], m[2]]);
    assert.deepEqual(status, [['s1', 'ok'], ['s2', 'run'], ['s3', 'next'], ['s4', 'plan']]);
    const ok = status.filter((s) => s[1] === 'ok').length, run = status.filter((s) => s[1] === 'run').length;
    assert.match(ls, new RegExp('<div class="blk t-list span2" data-block=""><h3 data-zaehler="" style="--anteil:' + ok / 4 + ';--anteil-laeuft:' + run / 4 + '">'));
    assert.match(ls, new RegExp('<span class="zaehler">' + ok + ' von ' + status.length + ' fertig</span>'));
    assert.deepEqual(Object.values(neu).map((s) => s.id), ['N1', 'N2', 'N3', 'N4', 'N5']);
    assert.equal(v.zaehler.seite, 5);
    // Kopie: eigene Seite mit „(Kopie)“, Kennung N6 an Wurzel und Fußzeile, unabhängig von der Quelle
    const q = v.seiten.find((s) => s.id === 'T1'), qVorher = JSON.stringify(q);
    const k = ST.seiteAnlegen(pk, '1.1', { kopieVon: 'T1', ordner: ['b'] });
    assert.deepEqual([k.id, k.titel, k.herkunft, k.vorlage, k.kopieVon, k.ordner, k.ausgeblendet], ['N6', 'Platzhalter eins (Kopie)', 'eigen', 'kopie', 'T1', ['b'], false]);
    assert.equal(k.html, HTML_S1.replace('data-id="T1"', 'data-id="N6"').replace('>T1 · Stand ', '>N6 · Stand '));
    k.eigenesFeld.bleibt.push(9); k.titel = 'x';
    assert.equal(JSON.stringify(q), qVorher, 'Quelle unverändert');
    // Kennungen nie wiederverwendet (auch nach dem Löschen der höchsten)
    ST.seiteLoeschen(pk, '1.1', 'N6');
    ST.seiteLoeschen(pk, '1.1', 'N5');
    assert.equal(ST.seiteAnlegen(pk, '1.1', { vorlage: 'leer', heute: '2020-02-03' }).id, 'N7');
    assert.equal(ST.neueKennung('N', 2, new Set(['N1', 'N5'])).id, 'N6', 'höher als Zähler und jede vorhandene Kennung');
    // Original nie löschbar, nur ausblenden; eigene löschen
    assert.match(fehlerText(() => ST.seiteLoeschen(pk, '1.1', 'T1')), /^Original-Seiten lassen sich nicht löschen/);
    assert.ok(v.seiten.some((s) => s.id === 'T1'));
    const n = ST.seitenZahl(v);
    ST.seiteAusblenden(pk, '1.1', 'T1', true);
    assert.equal(ST.seitenZahl(v), n - 1);
    assert.equal(ST.sicht(pk, '1.1').dokumente.find((d) => d.id === 'T1').ausgeblendet, true);
    ST.seiteAusblenden(pk, '1.1', 'T1', false);
    assert.equal(ST.seitenZahl(v), n);
    // Umbenennen: nur der Name der Kachel
    const html = q.html;
    assert.equal(ST.seiteUmbenennen(pk, '1.1', 'T1', '  Neuer   Name ').titel, 'Neuer Name');
    assert.equal(q.html, html);
    assert.match(fehlerText(() => ST.seiteUmbenennen(pk, '1.1', 'T1', 'x'.repeat(121))), /Höchstens 120 Zeichen/);
    assert.equal(P.pruefe(kopie(pk)).formatVersion, 2, 'Ergebnis bleibt ein gültiges Paket');
  });
});

describe('F3a g) ZIP, CRC-32, CSV und Dateinamen (ohne Browser)', () => {
  test('CRC-32 wie IEEE 802.3 (Prüfwert und zlib); ZIP „stored“ ist gültig: Köpfe, Verzeichnis, CRC, Größen, Inhalte', () => {
    assert.equal(Z.crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
    assert.equal(Z.crc32(new Uint8Array(0)), 0);
    const zufall = new Uint8Array(70000).map((_, i) => (i * 2654435761) >>> 24);
    assert.equal(Z.crc32(zufall), zlib.crc32(zufall));
    const eingabe = [
      { name: '1.1_S1_01_kasten.png', daten: zufall },
      { name: 'S1/1.1_S1.csv', daten: '﻿version;seite\r\n1.1;S1 äöü\r\n' },
      { name: 'leer.json', daten: new ArrayBuffer(0) }
    ];
    const zip = Z.zip(eingabe, new Date(2020, 1, 3, 4, 5, 6));
    const d = liesZip(zip);
    assert.deepEqual(d.map((x) => [x.name, x.methode, x.crcOk, x.groesse === x.roh]), eingabe.map((x) => [x.name, 0, true, true]));
    assert.ok(d[0].daten.equals(Buffer.from(zufall)));
    assert.equal(d[1].daten.toString('utf8'), '﻿version;seite\r\n1.1;S1 äöü\r\n');
    assert.equal(d[2].groesse, 0);
    // DOS-Zeit 04:05:06, 03.02.2020
    const b = Buffer.from(zip);
    assert.equal(b.readUInt16LE(10), (4 << 11) | (5 << 5) | 3);
    assert.equal(b.readUInt16LE(12), ((2020 - 1980) << 9) | (2 << 5) | 3);
    // Schreiber (Teile einzeln) ergibt dieselbe Datei
    const sch = Z.schreiber(new Date(2020, 1, 3, 4, 5, 6));
    for (const x of eingabe) sch.add(x.name, x.daten);
    assert.ok(Buffer.concat(sch.teile().map((t) => Buffer.from(t))).equals(b));
    assert.equal(sch.anzahl(), 3);
    // Ungültige Namen
    for (const name of ['äöü.png', '../x.png', 'a\\b.png', '/abs.png', '']) assert.throws(() => Z.zip([{ name, daten: 'x' }]), /ZIP: Dateiname/, name);
    assert.throws(() => Z.zip([{ name: 'a.png', daten: 'x' }, { name: 'a.png', daten: 'y' }]), /doppelt/);
    assert.throws(() => Z.zip([]), /keine Dateien/);
  });

  test('CSV: UTF-8 mit BOM, „;“, Spalten version;seite;kennung;art;wert;status, Anführungszeichen nur wo nötig, CRLF, Umlaute; Dateinamen nur ASCII', () => {
    const zeilen = [
      { kennung: 't1', art: 'text', wert: 'Größe äöüß „Zitat“', status: '' },
      { kennung: 't2', art: 'text', wert: 'mit ; Semikolon und "Anführung"', status: '' },
      { kennung: 't3', art: 'text', wert: 'zwei\nZeilen', status: '' },
      { kennung: 's1', art: 'status', wert: 'Punkt eins', status: 'ok' },
      { kennung: 'zaehler1', art: 'zaehler', wert: '1 von 2 fertig', status: '' },
      { kennung: 'stand1', art: 'stand', wert: '01.02.2020', status: '' }
    ];
    const t = GR.csv('1.1', 'S1', zeilen);
    const bytes = Buffer.from(t, 'utf8');
    assert.deepEqual([...bytes.subarray(0, 3)], [0xef, 0xbb, 0xbf], 'BOM');
    const z = t.slice(1).split('\r\n');
    assert.equal(z.pop(), '', 'endet mit CRLF');
    assert.deepEqual(z, [
      'version;seite;kennung;art;wert;status',
      '1.1;S1;t1;text;Größe äöüß „Zitat“;',
      '1.1;S1;t2;text;"mit ; Semikolon und ""Anführung""";',
      '1.1;S1;t3;text;"zwei\nZeilen";',
      '1.1;S1;s1;status;Punkt eins;ok',
      '1.1;S1;zaehler1;zaehler;1 von 2 fertig;',
      '1.1;S1;stand1;stand;01.02.2020;'
    ]);
    assert.ok(bytes.includes(Buffer.from([0xc3, 0xa4])), 'ä als UTF-8');
    assert.equal(GR.DATEN_FORMAT, 'aether-flyer-daten');
    assert.equal(GR.DATEN_VERSION, 1);
    for (const [ein, aus] of [['IG-Technik-2', 'IG-Technik-2'], ['1.1', '1.1'], ['N12', 'N12'], ['Ä ö/ü', 'x'], ['Säule 3', 'S-ule-3'], ['..x', 'x'], ['a..b', 'a.b'], ['a b', 'a-b']]) {
      const r = GR.dateiTeil(ein);
      assert.match(r, /^[A-Za-z0-9.-]+$/, `${ein} → nur ASCII`);
      assert.ok(!r.includes('..'), `${ein} → ohne „..“`);
      assert.equal(r, aus, ein);
    }
  });
});
