// Tests für F3b ohne Browser (Node, Module im selben Kontext): Datenmodell der Bibliothek (a), Git-Blob-SHA und Status
// (b), Größen und Hinweise (d), Abgleich und Sicherung der Metadaten (h, ohne DOM). Alle Pakete und Medien sind erfunden
// (Platzhalter, wenige Bytes); kein echter Flyer- oder Medieninhalt.
// Aufruf: node --test tests/flyer-f3b-modell.test.js
'use strict';

const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..');
globalThis.window = {};
for (const d of ['flyer-paket.js', 'flyer-struktur.js', 'flyer-zip.js', 'flyer-medien.js', 'flyer-aenderungen.js']) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, d), 'utf8'), { filename: d });
}
const { AetherFlyerPaket: P, AetherFlyerStruktur: ST, AetherFlyerMedien: M, AetherFlyerAenderungen: AE, AetherFlyerZip: Z } = globalThis.window;
const kopie = (x) => JSON.parse(JSON.stringify(x));
const fehlerText = (fn) => { try { fn(); } catch (e) { return [e.title, e.text].filter(Boolean).join(' '); } return null; };
const gitNode = (b) => crypto.createHash('sha1').update(Buffer.concat([Buffer.from('blob ' + b.length + '\0'), b])).digest('hex');
const SHA0 = 'e69de29bb2d1d6434b8b29ae775ad8c2e48c5391';   // leere Datei (git hash-object /dev/null)

function paketV2() {
  return {
    format: 'aether-flyer-paket', formatVersion: 2, version: '2020-02-01.1', stand: '2020-02-01', css: { flyer: '', infografik: '' },
    versionen: [
      { nummer: '1.1', beschreibung: '', ausgeblendet: false, zaehler: { seite: 1, ordner: 0 }, ordner: [], seiten: [
        { id: 'S1', art: 'flyer', titel: 'Platzhalter', herkunft: 'original', vorlage: null, ordner: [], ausgeblendet: false, breite: 794, hoehe: 1123, html: '<section class="page">x</section>' },
        { id: 'N1', art: 'flyer', titel: 'Platzhalter Video', herkunft: 'eigen', vorlage: 'bild-video', ordner: [], ausgeblendet: false, breite: 794, hoehe: 1123, html: '<section class="page"><div class="medium" data-medium="m2"></div></section>' }] },
      { nummer: '1.2', beschreibung: '', ausgeblendet: false, zaehler: { seite: 1, ordner: 0 }, ordner: [], seiten: [
        { id: 'N1', art: 'flyer', titel: 'Platzhalter', herkunft: 'eigen', vorlage: 'bild-video', ordner: [], ausgeblendet: false, breite: 794, hoehe: 1123, html: '<section class="page"><div data-medium="m1"></div></section>' }] }
    ]
  };
}
function meta(name, extra) {
  return Object.assign({ name: name, art: 'foto', mime: 'image/png', groesse: 10, breite: 4, hoehe: 3, dauer: null, endung: 'png', gitSha: SHA0, herkunft: 'eigen', startbild: null, ordner: [] }, extra || {});
}
function mitMedien() {
  const pk = paketV2();
  const o = M.ordnerAnlegen(pk, null, 'Fotos'), u = M.ordnerAnlegen(pk, o.id, 'Unterordner');
  M.dateiAnlegen(pk, meta('Kardos Ring', { ordner: [o.id, u.id] }));
  M.dateiAnlegen(pk, meta('Flug durchs Feld', { art: 'video', mime: 'video/webm', endung: 'webm', dauer: 2.5, startbild: 1 }));
  M.dateiAnlegen(pk, meta('Unbenutzt'));
  return pk;
}

describe('F3b a) Datenmodell', () => {
  test('Paket mit und ohne „medien“: Prüfung, Umwandlung v1 → v2 behält das Feld, formatVersion bleibt 2, fehlerhafte Medien mit Fundstelle abgelehnt', () => {
    assert.equal(P.FORMAT_VERSION, 2);
    const ohne = paketV2();
    assert.equal(P.pruefe(ohne), ohne);
    assert.ok(!('medien' in ST.ausFeldern(ST.felder(ohne), ohne, [ohne])), 'ohne medien bleibt es ohne');
    const pk = mitMedien();
    P.pruefe(pk);
    assert.deepEqual(pk.medien.zaehler, { datei: 3, ordner: 2 });
    assert.deepEqual(pk.medien.dateien.map((d) => [d.id, d.datei, d.ordner]), [['m1', 'kardos-ring_m1.png', ['mo1', 'mo2']], ['m2', 'flug-durchs-feld_m2.webm', []], ['m3', 'unbenutzt_m3.png', []]]);
    for (const d of pk.medien.dateien) assert.deepEqual(Object.keys(d).sort(), ['art', 'breite', 'datei', 'dauer', 'erstellt', 'gitSha', 'groesse', 'herkunft', 'hoehe', 'id', 'mime', 'name', 'ordner', 'startbild'], 'Felder laut F1 – keine Inhalte');
    // v1-Paket mit medien (Export nach dem ersten Hinzufügen ist v2; ein v1 mit dem Feld bleibt lesbar und behält es)
    const v1 = { format: 'aether-flyer-paket', formatVersion: 1, version: '2020-02-01.1', stand: '2020-02-01', css: {}, kategorien: [], dokumente: [{ id: 'S1', art: 'flyer', kategorie: '', titel: 'x', breite: 794, hoehe: 1123, html: '<p>x</p>' }], medien: kopie(pk.medien) };
    assert.deepEqual(P.alsV2(v1).medien, pk.medien);
    // Felder → Paket (Abgleich/Einspielen) verlustfrei, auch unbekannte Felder
    const mit = kopie(pk); mit.medien.dateien[0].kuenftig = { a: 1 }; mit.medien.unbekannt = 'bleibt';
    const zur = ST.ausFeldern(ST.felder(mit), mit, [mit]);
    assert.ok(ST.gleich(zur, mit));
    assert.deepEqual(zur.medien.dateien[0].kuenftig, { a: 1 });
    assert.equal(zur.medien.unbekannt, 'bleibt');
    // fehlerhafte Medien
    const faelle = [
      [(m) => { m.dateien[0].id = 'x1'; }, /id muss „m<n>“ sein/],
      [(m) => { m.zaehler.datei = 1; }, /Kennung „m2“ ist größer als zaehler\.datei/],
      [(m) => { m.dateien[1].id = 'm1'; }, /kommt doppelt vor/],
      [(m) => { m.dateien[0].datei = 'kärdos_m1.png'; }, /nur ASCII/],
      [(m) => { m.dateien[0].datei = 'kardos_m9.png'; }, /datei muss „<name>_m1\.<endung>“/],
      [(m) => { m.dateien[0].gitSha = 'abc'; }, /gitSha muss 40 Hex-Zeichen/],
      [(m) => { m.dateien[0].art = 'ton'; }, /art muss foto, video, animation oder grafik/],
      [(m) => { m.dateien[0].ordner = ['mo9']; }, /Ordner „mo9“ gibt es in der Bibliothek nicht/],
      [(m) => { m.ordner[0].eltern = 'mo2'; }, /liegt in sich selbst/],
      [(m) => { m.dateien[0].name = 'x'.repeat(121); }, /mehr als 120 Zeichen/],
      [(m) => { m.dateien[0].herkunft = 'flyer-kopie'; }, /quelle muss \{ version, seite, grafik \}/],
      [(m) => { m.dateien = 'x'; }, /dateien muss eine Liste sein/]
    ];
    for (const [fn, re] of faelle) {
      const x = kopie(pk); fn(x.medien);
      assert.match(fehlerText(() => P.pruefe(x)) || '', re);
    }
  });

  test('Kennungen m<n> und mo<n> nie wiederverwendet; Dateinamen nur ASCII (<slug>_<id>.<endung>); Umbenennen ändert den Dateinamen im Repo nicht', () => {
    const pk = mitMedien();
    M.dateiLoeschen(pk, 'm3');
    M.dateiLoeschen(pk, 'm2');
    assert.equal(M.dateiAnlegen(pk, meta('Neu')).id, 'm4', 'nach dem Löschen der höchsten: m4, nicht m2');
    M.ordnerLoeschen(pk, 'mo2');
    assert.equal(M.ordnerAnlegen(pk, null, 'Videos').id, 'mo3');
    assert.equal(M.neueKennung('m', 2, new Set(['m1', 'm7'])).id, 'm8', 'höher als Zähler und jede vorhandene Kennung');
    P.pruefe(pk);
    const namen = ['Flug durchs Feld', 'Ärger über Straße – Ölé!', '火箭 🚀', '', '   ', '../../etc/passwd', 'x'.repeat(200), 'IMG_1234 (2)', 'trim.5D3F.MOV'];
    for (const n of namen) {
      const d = M.dateiAnlegen(pk, meta(n, { endung: 'MOV' }));
      assert.match(d.datei, /^[a-z0-9]+(?:-[a-z0-9]+)*_m[1-9]\d*\.[a-z0-9]{1,5}$/, `Dateiname für „${n}“`);
      assert.ok(/^[\x20-\x7e]+$/.test(d.datei), 'nur ASCII');
      assert.ok(d.name.length <= 120 && d.name.length > 0);
    }
    assert.equal(M.slug('Ärger über Straße – Ölé!'), 'aerger-ueber-strasse-oele');
    const d = pk.medien.dateien[0], alt = d.datei;
    M.dateiUmbenennen(pk, d.id, 'Ganz anders');
    assert.deepEqual([d.name, d.datei], ['Ganz anders', alt]);
    assert.match(fehlerText(() => M.dateiUmbenennen(pk, d.id, '  ')), /Name fehlt/);
    P.pruefe(pk);
  });

  test('Ordner der Bibliothek: verschachtelt, Mehrfachzuordnung, Löschen erhält Dateien, kein Kreis; Filter je Version und „nicht verwendet“; Verwendung je Seite', () => {
    const pk = mitMedien();
    assert.deepEqual(M.pfad(pk, 'mo2').map((o) => o.name), ['Fotos', 'Unterordner']);
    assert.deepEqual(M.inOrdner(M.dateien(pk), 'mo1').map((d) => d.id), ['m1']);
    assert.deepEqual(M.inOrdner(M.dateien(pk), 'mo2').map((d) => d.id), ['m1'], 'dieselbe Datei in zwei Ordnern');
    assert.deepEqual(M.inOrdner(M.dateien(pk), null).map((d) => d.id), ['m2', 'm3'], 'ohne Ordner');
    assert.match(fehlerText(() => M.ordnerVerschieben(pk, 'mo1', 'mo2')), /nicht in sich selbst oder einen eigenen Unterordner/);
    assert.match(fehlerText(() => M.ordnerAnlegen(pk, null, 'fotos')), /Name schon vergeben/);
    assert.match(fehlerText(() => M.ordnerAnlegen(pk, null, 'Aus Flyern')), /automatische Ordner/);
    assert.deepEqual(M.gefiltert(pk, 'alle').map((d) => d.id), ['m1', 'm2', 'm3']);
    assert.deepEqual(M.gefiltert(pk, '1.1').map((d) => d.id), ['m2']);
    assert.deepEqual(M.gefiltert(pk, '1.2').map((d) => d.id), ['m1']);
    assert.deepEqual(M.gefiltert(pk, 'nicht-verwendet').map((d) => d.id), ['m3']);
    assert.deepEqual(M.verwendung(pk, 'm1'), [{ version: '1.2', seite: 'N1', titel: 'Platzhalter' }]);
    M.ordnerLoeschen(pk, 'mo1');
    assert.deepEqual(pk.medien.dateien.map((d) => d.id), ['m1', 'm2', 'm3'], 'Dateien bleiben');
    assert.deepEqual(pk.medien.dateien[0].ordner, ['mo2']);
    assert.equal(pk.medien.ordner[0].eltern, null, 'Unterordner wandert in den Elternordner');
    assert.deepEqual(M.zuletzt([{ erstellt: '1' }, { erstellt: '3' }, { erstellt: '2' }]).map((d) => d.erstellt), ['3', '2', '1']);
    const viele = Array.from({ length: 20 }, (_, i) => ({ erstellt: String(i).padStart(2, '0') }));
    assert.equal(M.zuletzt(viele).length, 12, 'höchstens 12');
  });
});

describe('F3b b) Git-Blob-SHA und Status', () => {
  test('bekannte Prüfwerte (leere Datei e69de29…, „hello\\n“ ce01362…), Web Crypto und stückweises SHA-1 gleich (auch über Stückgrenzen), wie git hash-object', async () => {
    assert.equal(await M.gitSha(new Uint8Array(0)), SHA0);
    assert.equal(await M.gitSha(new Uint8Array(0), { ohneWebCrypto: true }), SHA0);
    const hallo = new TextEncoder().encode('hello\n');
    assert.equal(await M.gitSha(hallo), 'ce013625030ba8dba906f756967f9e9ca394464a');
    assert.equal(await M.gitSha(new Blob([hallo]), { ohneWebCrypto: true }), 'ce013625030ba8dba906f756967f9e9ca394464a');
    for (const n of [1, 55, 56, 63, 64, 65, 127, 128, 1000, 4 * 1024 * 1024 - 1, 4 * 1024 * 1024 + 9]) {
      const b = crypto.randomBytes(n), u8 = new Uint8Array(b);
      const soll = gitNode(b);
      assert.equal(await M.gitSha(u8), soll, `Web Crypto ${n} Bytes`);
      assert.equal(await M.gitSha(new Blob([u8]), { ohneWebCrypto: true }), soll, `stückweise ${n} Bytes`);
    }
    assert.equal(M.WEBCRYPTO_MAX, 64 * 1024 * 1024);
    // CRC-32 stückweise = in einem Stück (für „Alle sichern“)
    const b = new Uint8Array(crypto.randomBytes(9 * 1024 * 1024 + 5));
    assert.equal(await M.crc32Blob(new Blob([b])), Z.crc32(b));
    assert.equal(Z.crc32(b.subarray(100), Z.crc32(b.subarray(0, 100))), Z.crc32(b));
  });
  test('Status: grün „online“ (gleiche SHA in aether-medien), orange „nur Gerät“, grau „Flyer“', () => {
    const d = { gitSha: 'a'.repeat(40) };
    assert.equal(M.status(d, new Set(['a'.repeat(40)])), 'online');
    assert.equal(M.status(d, new Set(['b'.repeat(40)])), 'geraet');
    assert.equal(M.status(d, null), 'geraet', 'noch nie geprüft bzw. kein Zugriff');
    assert.equal(M.status(null, null), 'flyer', 'Grafik aus „Aus Flyern“');
    assert.deepEqual(M.STATUS_TEXT, { online: 'online', geraet: 'nur Gerät', flyer: 'Flyer' });
  });
});

describe('F3b d) Größen und Hinweise', () => {
  test('25-MiB-Hinweis genau an der Grenze (26 214 400 Bytes noch ohne), Annahme bis 500 MB mit Meldung darüber, Platz-Meldung; nichts still abgelehnt', () => {
    assert.equal(M.GRENZE_UPLOAD, 26214400);
    assert.equal(M.groessenHinweis(26214400), '');
    assert.equal(M.groessenHinweis(26214401), 'Zu groß für den Upload im Browser (GitHub: höchstens 25 MiB je Datei) – bleibt vorerst nur auf diesem Gerät.');
    assert.equal(M.annahmeMeldung(500 * 1024 * 1024), '');
    assert.match(M.annahmeMeldung(500 * 1024 * 1024 + 1), /^Datei zu groß: 500 MB \(höchstens 500 MB je Datei\)\.$/);
    assert.match(M.annahmeMeldung(612 * 1024 * 1024), /^Datei zu groß: 612 MB/);
    assert.equal(M.platzMeldung(100 * 1024 * 1024, null), '', 'Platz unbekannt: angenommen');
    assert.equal(M.platzMeldung(100 * 1024 * 1024, { frei: 1024 * 1024 * 1024 }), '');
    assert.match(M.platzMeldung(100 * 1024 * 1024, { frei: 50 * 1024 * 1024 }), /^Nicht genug Speicher auf diesem Gerät: frei 50,0 MB, nötig etwa 115 MB\./);
    assert.deepEqual([M.groesseText(2.1 * 1024 * 1024), M.groesseText(500), M.dauerText(42), M.dauerText(12.9), M.dauerText(3723)], ['2,1 MB', '1 KB', '0:42', '0:12', '1:02:03']);
  });
  test('Safari-Hinweis (F10) nur in Safari außerhalb der Home-Bildschirm-App und nur bei Dateien „nur Gerät“', () => {
    const ipad = 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
    const mac = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Safari/605.1.15';
    const chromeIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/130.0 Mobile/15E148 Safari/604.1';
    const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36';
    const firefoxIos = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/131.0 Mobile/15E148 Safari/605.1.15';
    for (const ua of [ipad, iphone, mac]) {
      assert.equal(M.safariHinweisNoetig(ua, false, true), true, 'Safari, Browser-Tab, Datei nur Gerät');
      assert.equal(M.safariHinweisNoetig(ua, true, true), false, 'Home-Bildschirm-App');
      assert.equal(M.safariHinweisNoetig(ua, false, false), false, 'alles online');
    }
    for (const ua of [chromeIos, chrome, firefoxIos]) assert.equal(M.safariHinweisNoetig(ua, false, true), false, ua.slice(0, 40));
    assert.match(M.HINWEIS_SAFARI, /^Nur auf diesem Gerät: in Safari können Daten nach einigen Tagen ohne Besuch gelöscht werden – Home-Bildschirm-App nutzen oder online stellen$/);
  });
  test('Formate (F5) nach Endung bzw. MIME; Animationen am Inhalt erkannt (GIF, APNG, animiertes WebP) mit Dauer', () => {
    assert.deepEqual(['a.JPG', 'b.jpeg', 'c.png', 'd.webp', 'e.heic', 'f.gif', 'g.svg', 'h.mp4', 'i.MOV', 'j.webm'].map((n) => { const f = M.formatVon(n, ''); return f.art + ':' + f.endung; }),
      ['foto:jpg', 'foto:jpg', 'foto:png', 'foto:webp', 'foto:heic', 'animation:gif', 'grafik:svg', 'video:mp4', 'video:mov', 'video:webm']);
    assert.equal(M.formatVon('ohne', 'video/quicktime').endung, 'mov');
    assert.equal(M.formatVon('x.txt', 'text/plain'), null);
    // GIF mit 3 Bildern zu je 0,5 s (erfunden, 1 × 1 Pixel)
    const gif = (n) => {
      const t = [Buffer.from('GIF89a'), Buffer.from([1, 0, 1, 0, 0x80, 0, 0, 255, 0, 0, 0, 0, 255])];
      for (let i = 0; i < n; i++) t.push(Buffer.from([0x21, 0xf9, 4, 0, 50, 0, 0, 0, 0x2c, 0, 0, 0, 0, 1, 0, 1, 0, 0, 2, 2, 0x44, 1, 0]));
      t.push(Buffer.from([0x3b]));
      return new Uint8Array(Buffer.concat(t));
    };
    assert.deepEqual(M.animationLesen(gif(3), 'gif'), { animiert: true, dauer: 1.5, bilder: 3 });
    assert.deepEqual(M.animationLesen(gif(1), 'gif'), { animiert: false, dauer: null, bilder: 1 });
    // APNG: Signatur, acTL, zwei fcTL (je 1/4 s), IEND (CRC egal für das Lesen)
    const chunk = (typ, daten) => { const l = Buffer.alloc(4); l.writeUInt32BE(daten.length); return Buffer.concat([l, Buffer.from(typ), daten, Buffer.alloc(4)]); };
    const fctl = () => { const d = Buffer.alloc(26); d.writeUInt16BE(1, 20); d.writeUInt16BE(4, 22); return d; };
    const apng = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk('IHDR', Buffer.alloc(13)), chunk('acTL', Buffer.alloc(8)), chunk('fcTL', fctl()), chunk('IDAT', Buffer.alloc(2)), chunk('fcTL', fctl()), chunk('fdAT', Buffer.alloc(6)), chunk('IEND', Buffer.alloc(0))]);
    assert.deepEqual(M.animationLesen(new Uint8Array(apng), 'png'), { animiert: true, dauer: 0.5, bilder: 2 });
    // WebP: VP8X mit Animations-Bit, zwei ANMF zu je 100 ms
    const wchunk = (typ, daten) => { const l = Buffer.alloc(4); l.writeUInt32LE(daten.length); return Buffer.concat([Buffer.from(typ), l, daten, daten.length % 2 ? Buffer.alloc(1) : Buffer.alloc(0)]); };
    const anmf = () => { const d = Buffer.alloc(16); d.writeUIntLE(100, 12, 3); return d; };
    const inhalt = Buffer.concat([Buffer.from('WEBP'), wchunk('VP8X', Buffer.from([0x02, 0, 0, 0, 0, 0, 0, 0, 0, 0])), wchunk('ANIM', Buffer.alloc(6)), wchunk('ANMF', anmf()), wchunk('ANMF', anmf())]);
    const groesse = Buffer.alloc(4); groesse.writeUInt32LE(inhalt.length);
    assert.deepEqual(M.animationLesen(new Uint8Array(Buffer.concat([Buffer.from('RIFF'), groesse, inhalt])), 'webp'), { animiert: true, dauer: 0.2, bilder: 2 });
  });
});

describe('F3b h) Abgleich und Sicherung der Metadaten', () => {
  test('Felder M|*|…: nur online → übernommen, nur lokal → bleibt, beide → Konflikt mit Text; Ordner online gelöscht bei lokaler Zuordnung → Konflikt; Zähler = Maximum; zählt als Änderung', () => {
    const basis = mitMedien();
    const L = kopie(basis), R = kopie(basis);
    M.dateiUmbenennen(L, 'm1', 'Lokal umbenannt');
    M.dateiAnlegen(R, meta('Online neu'));
    M.dateiAnlegen(L, meta('Lokal neu'));   // beide m4: Kennungs-Kollision → Konflikt, nichts geht still verloren
    const r = ST.zusammenfuehren(ST.felder(basis), ST.felder(L), ST.felder(R), { modus: 'abgleich' });
    const e = ST.ausFeldern(r.felder, R, [R, L]);
    ST.verweise(e);
    P.pruefe(e);
    assert.equal(e.medien.dateien.find((d) => d.id === 'm1').name, 'Lokal umbenannt');
    assert.equal(r.konflikte.length, 1);
    assert.equal(r.konflikte[0].objekt, 'M|*|m4');
    const kt = ST.konfliktText(r.konflikte[0], r.felder, null);
    assert.equal(kt.was, 'Datei m4 · Lokal neu (Bibliothek)');
    assert.deepEqual(JSON.parse(r.felder.get('Z|*')), { datei: 4, ordner: 2 });
    assert.ok(ST.aenderungenZahl(basis, L) >= 2, 'Bibliothek zählt als Änderung');
    // Online löscht Ordner mo2, lokal liegt m3 darin → Ordner bleibt, Konflikt
    const L2 = kopie(basis), R2 = kopie(basis);
    M.dateiInOrdner(L2, 'm3', ['mo2']);
    M.ordnerLoeschen(R2, 'mo2');
    const r2 = ST.zusammenfuehren(ST.felder(basis), ST.felder(L2), ST.felder(R2), { modus: 'abgleich' });
    const e2 = ST.ausFeldern(r2.felder, R2, [R2, L2]);
    P.pruefe(e2);
    assert.ok(e2.medien.ordner.some((o) => o.id === 'mo2'));
    assert.ok(r2.konflikte.some((k) => k.objekt === 'MO|*|mo2'));
    // Wahl „Online übernehmen“ stellt die Online-Seite her
    const k = r.konflikte[0];
    const w = ST.ausFeldern(ST.waehle(r.felder, k, 'andere'), R, [R, L]);
    assert.equal(w.medien.dateien.find((d) => d.id === 'm4').name, 'Online neu');
  });
  test('Sicherung v3 enthält die Bibliotheks-Felder (nie Inhalte); v2 und v1 werden weiter gelesen; v2 mit Bibliotheks-Feld abgelehnt; v4 „zu neu“', () => {
    assert.equal(AE.SICHERUNG_VERSION, 3);
    const basis = paketV2(), pk = mitMedien();
    const felder = ST.feldAenderungen(basis, pk, ST.BIBLIOTHEK);
    assert.ok(felder.length > 0);
    assert.ok(felder.every((f) => /^(M\|\*\|m\d+|MO\|\*\|mo\d+)\|(da|name|ordner|meta|eltern|extra)$|^Z\|\*$/.test(f.k)), 'nur Bibliotheks-Felder');
    assert.deepEqual(ST.feldAenderungen(basis, pk, '1.1'), [], 'die Version selbst ist unverändert');
    const text = (v, struktur) => JSON.stringify({ format: 'aether-flyer-aenderungen', version: v, eintraege: [], struktur: struktur });
    const g = AE.leseSicherung(text(3, felder));
    assert.equal(g.struktur.length, felder.length);
    assert.doesNotMatch(text(3, felder), /base64|blob:/, 'keine Inhalte');
    assert.match(fehlerText(() => AE.leseSicherung(text(2, felder))), /unbekanntes Feld/);
    assert.equal(AE.leseSicherung(text(2, [{ k: 'P|1.1|S1|titel', alt: '"a"', neu: '"b"' }])).struktur.length, 1, 'v2 weiter lesbar');
    assert.equal(AE.leseSicherung(JSON.stringify({ format: 'aether-flyer-aenderungen', version: 1, eintraege: [] })).struktur.length, 0, 'v1 weiter lesbar');
    assert.match(fehlerText(() => AE.leseSicherung(text(4, []))), /Sicherung zu neu/);
    // Einspielen in einen Stand ohne Bibliothek stellt sie her
    const fa = new Map(), alt = new Map();
    for (const e of felder) { if (e.neu !== null) fa.set(e.k, e.neu); if (e.alt !== null) alt.set(e.k, e.alt); }
    const r = ST.zusammenfuehren(ST.felder(basis), ST.felder(basis), fa, { modus: 'sicherung', alt: alt, schluessel: felder.map((e) => e.k) });
    const neu = ST.ausFeldern(r.felder, basis, [basis]);
    P.pruefe(neu);
    assert.deepEqual(neu.medien.dateien.map((d) => d.id), ['m1', 'm2', 'm3']);
  });
  test('F3a-Code (Stand aed37d7) liest ein Paket mit „medien“ und behält das Feld – darum bleibt formatVersion 2', (t) => {
    let alt;
    try { alt = ['flyer-paket.js', 'flyer-struktur.js'].map((d) => execFileSync('git', ['-C', ROOT, 'show', 'aed37d7:' + d], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })); } catch (e) {
      t.skip('Commit aed37d7 nicht im Checkout (CI mit flacher Historie) – lokal geprüft');
      return;
    }
    const ctx = { window: {} };
    vm.createContext(ctx);
    for (const code of alt) vm.runInContext(code, ctx);
    const P0 = ctx.window.AetherFlyerPaket, ST0 = ctx.window.AetherFlyerStruktur;
    const pk = mitMedien();
    const text = JSON.stringify(pk);
    const gelesen = P0.lies(text);
    assert.equal(gelesen.formatVersion, 2);
    assert.deepEqual(JSON.parse(JSON.stringify(P0.alsV2(gelesen).medien)), pk.medien, 'alsV2 behält medien');
    const zur = ST0.ausFeldern(ST0.felder(gelesen), gelesen, [gelesen]);
    assert.deepEqual(JSON.parse(JSON.stringify(zur.medien)), pk.medien, 'Struktur-Änderungen in F3a behalten medien (oben)');
  });
});
