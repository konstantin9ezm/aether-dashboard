// PowerPoint-Export der Flyer-Seite (flyer-pptx.js): „Alle als PowerPoint (n)“ und „PowerPoint“ im Vollbild, Auswahl
// „A4 hochkant | 16:9 quer“, Datei (Office Open XML) mit einer Folie je Seite als JPEG, Notizen, Dateinamen, Layout.
// Nur Platzhalter-Pakete (tests/flyer-hilfe.js), kein echter Flyer-Inhalt. Die Datei wird hier unabhängig vom
// Schreiber gelesen (ZIP-Leser aus flyer-hilfe.js, XML per Muster, JPEG-Maße aus dem SOF-Block, Dekodieren im Browser).
'use strict';

const { test, describe, before, after } = require('node:test');
const H = require('./flyer-hilfe');
const { assert, mitSeite, oeffneFlyer, importiere, ruhe, download, text, paketV1, liesZip } = H;

before(H.starte);
after(H.beende);

const EMU_CM = 360000;
const A4 = { cx: 7560000, cy: 10692000 };
const B169 = { cx: 12192000, cy: 6858000 };
const IG_HOEHE = 3095;   // hohe Infografik (wie IG-Technik-2 nach PR #37), Breite 1080
const HEUTE = () => { const d = new Date(); const z = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${z(d.getMonth() + 1)}-${z(d.getDate())}`; };

// Platzhalter-Paket: Ordner „spiel“ heißt „Spiel & Über“ (Umlaut, Sonderzeichen), die Infografik ist hoch
function paket() {
  const pk = paketV1();
  pk.kategorien[0].name = 'Spiel & Über';
  pk.css.infografik += `\n.ig{min-height:${IG_HOEHE}px;box-sizing:border-box}`;
  pk.dokumente[1].titel = 'Titel mit & <Probe> „Anführung“ äöü';
  return pk;
}

/* ---------- Datei lesen (unabhängig vom Schreiber) ---------- */
function entities(s) { return s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&'); }
function jpegMasse(b) {
  assert.ok(b[0] === 0xff && b[1] === 0xd8, 'JPEG beginnt mit SOI');
  assert.ok(b[b.length - 2] === 0xff && b[b.length - 1] === 0xd9, 'JPEG endet mit EOI');
  let p = 2;
  while (p < b.length) {
    assert.equal(b[p], 0xff, 'JPEG-Marker');
    const m = b[p + 1], len = b.readUInt16BE(p + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(p + 5), w: b.readUInt16BE(p + 7) };
    p += 2 + len;
  }
  throw new Error('JPEG ohne SOF');
}
function attr(xml, el, a) { const m = new RegExp(`<${el}\\b[^>]*\\b${a}="([^"]*)"`).exec(xml); return m ? m[1] : null; }
function rels(xml) { return [...xml.matchAll(/<Relationship\b([^>]*)\/>/g)].map((m) => ({ id: /Id="([^"]*)"/.exec(m[1])[1], typ: /Type="([^"]*)"/.exec(m[1])[1], ziel: /Target="([^"]*)"/.exec(m[1])[1] })); }
function relPfad(teil) { const i = teil.lastIndexOf('/'); return teil.slice(0, i + 1) + '_rels/' + teil.slice(i + 1) + '.rels'; }
function aufloesen(von, ziel) {
  const teile = von.split('/').slice(0, -1);
  for (const s of ziel.split('/')) { if (s === '..') teile.pop(); else if (s !== '.') teile.push(s); }
  return teile.join('/');
}
// → { dateien: Map, groesse: { cx, cy }, folien: [{ teil, bild: { w, h, daten }, off, ext, notiz: [Zeilen], descr }] }
function liesPptx(puffer) {
  const z = liesZip(puffer);
  for (const d of z) { assert.ok(d.crcOk, `${d.name}: CRC`); assert.equal(d.methode, 0, `${d.name}: stored`); }
  const dateien = new Map(z.map((d) => [d.name, d]));
  const txt = (n) => { assert.ok(dateien.has(n), `Teil ${n} vorhanden`); return dateien.get(n).daten.toString('utf8'); };
  const pres = txt('ppt/presentation.xml');
  const presRels = rels(txt('ppt/_rels/presentation.xml.rels'));
  const ids = [...pres.matchAll(/<p:sldId id="(\d+)" r:id="([^"]+)"\/>/g)].map((m) => m[2]);
  const folien = ids.map((rid) => {
    const teil = aufloesen('ppt/presentation.xml', presRels.find((r) => r.id === rid).ziel);
    const x = txt(teil), r = rels(txt(relPfad(teil)));
    const bildRid = attr(x, 'a:blip', 'r:embed');
    const bildTeil = aufloesen(teil, r.find((y) => y.id === bildRid).ziel);
    const notizTeil = aufloesen(teil, r.find((y) => y.typ.endsWith('/notesSlide')).ziel);
    const daten = dateien.get(bildTeil).daten;
    const pics = x.match(/<p:pic>[\s\S]*?<\/p:pic>/g) || [];
    assert.equal(pics.length, 1, `${teil}: genau ein Bild`);
    const pic = pics[0];
    return {
      teil, bildTeil, bild: Object.assign({ daten }, jpegMasse(daten)),
      off: { x: Number(attr(pic, 'a:off', 'x')), y: Number(attr(pic, 'a:off', 'y')) },
      ext: { cx: Number(attr(pic, 'a:ext', 'cx')), cy: Number(attr(pic, 'a:ext', 'cy')) },
      descr: entities((/<p:cNvPr id="2" name="[^"]*" descr="([^"]*)"/.exec(x) || [])[1] || ''),
      notiz: [...txt(notizTeil).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => entities(m[1]))
    };
  });
  return { dateien, txt, groesse: { cx: Number(attr(pres, 'p:sldSz', 'cx')), cy: Number(attr(pres, 'p:sldSz', 'cy')) }, folien };
}
// Bild vollständig eingepasst (Seitenverhältnis wie das JPEG, eine Seite füllt die Folie) und mittig
function pruefeLage(f, groesse, wo) {
  const { off, ext, bild } = f;
  assert.ok(off.x >= 0 && off.y >= 0 && off.x + ext.cx <= groesse.cx && off.y + ext.cy <= groesse.cy, `${wo}: ganz auf der Folie`);
  assert.ok(Math.abs(ext.cx / ext.cy - bild.w / bild.h) < 0.002, `${wo}: Seitenverhältnis bleibt (${ext.cx}/${ext.cy} vs ${bild.w}/${bild.h})`);
  assert.ok(ext.cx === groesse.cx || ext.cy === groesse.cy, `${wo}: füllt Breite oder Höhe`);
  assert.ok(Math.abs(groesse.cx - ext.cx - 2 * off.x) <= 1 && Math.abs(groesse.cy - ext.cy - 2 * off.y) <= 1, `${wo}: mittig`);
}

/* ---------- Bedienung ---------- */
async function bereit(page, pk = paket()) {
  await oeffneFlyer(page);
  await importiere(page, pk);
  await ruhe(page);
  assert.equal(await page.evaluate(() => window.AetherFlyerPptx.bereit()), true, 'PowerPoint möglich (Selbstprobe von „Bild“)');
}
async function exportAlle(page, format) {
  await page.click('#btnAllePptx');
  return download(page, () => page.click(`#pptxWahl [data-format="${format}"]`));
}
async function oeffneVollbild(page, id) {
  await page.click(`#kacheln .kachel[data-id="${id}"]`);
  await page.waitForSelector('#vollbild:not([hidden])');
  await page.waitForSelector('#vbPptx:not([hidden])');
}
const ausblenden = (page, id) => page.evaluate((id) => window.AetherFlyer.aendereStruktur((pk) => window.AetherFlyerStruktur.seiteAusblenden(pk, '1.1', id, true)), id);
const notizIds = (p) => p.folien.map((f) => f.notiz[0].replace(/^Seite: /, ''));

describe('PowerPoint-Export (jede Seite als Bild auf einer Folie)', () => {
  test('a) „Alle als PowerPoint (n)“ steht neben „Alle als PDF (n)“ und nimmt genau dieselben Seiten: ohne ausgeblendete, Ordner nur den Ordner; Fortschritt und Sperre', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await bereit(page);
      // Reihenfolge in der Leiste: direkt nach „Alle als PDF“
      assert.deepEqual(await page.$$eval('.leiste > button:not([hidden])', (bs) => bs.map((b) => b.id)).then((ids) => ids.slice(ids.indexOf('btnAllePdf'), ids.indexOf('btnAllePdf') + 2)), ['btnAllePdf', 'btnAllePptx']);
      assert.equal(await page.$eval('#btnAllePptx', (b) => b.className), await page.$eval('#btnAllePdf', (b) => b.className), 'gleicher Stil');
      assert.equal(await text(page, '#btnAllePdf'), 'Alle als PDF (3)');
      assert.equal(await text(page, '#btnAllePptx'), 'Alle als PowerPoint (3)');
      await ausblenden(page, 'S2');
      await page.waitForFunction(() => document.getElementById('btnAllePptx').textContent === 'Alle als PowerPoint (2)');
      assert.equal(await text(page, '#btnAllePdf'), 'Alle als PDF (2)');
      // Auch „Ausgeblendete zeigen“ ändert nichts an der Auswahl (wie beim PDF)
      await page.click('#btnAusgeblendete');
      const pdfIds = await page.evaluate(() => window.AetherFlyerExport.druckListe().map((d) => d.id));
      assert.deepEqual(pdfIds, ['S1', 'E1'], 'PDF: Flyer der Version ohne ausgeblendete (Infografik nicht in „Alle“)');
      // Fortschritt („Folie x / n“) und gesperrte Knöpfe während des Exports
      await page.click('#btnAllePptx');
      const [dl, waehrend] = await Promise.all([
        page.waitForEvent('download'),
        page.click('#pptxWahl [data-format="a4"]').then(() => page.waitForFunction(() => /^Folie \d+ \/ 2$/.test(document.getElementById('btnAllePptx').textContent))
          .then(() => page.evaluate(() => ({ t: document.getElementById('btnAllePptx').textContent, a: document.getElementById('btnAllePptx').disabled, l: window.AetherFlyerPptx.laeuft() }))))
      ]);
      assert.ok(waehrend.a && waehrend.l, 'während des Exports gesperrt: ' + JSON.stringify(waehrend));
      const p = liesPptx(require('node:fs').readFileSync(await dl.path()));
      assert.deepEqual(notizIds(p), pdfIds, 'Folien = Seiten von „Alle als PDF“, gleiche Reihenfolge');
      await page.waitForFunction(() => !document.getElementById('btnAllePptx').disabled && document.getElementById('btnAllePptx').textContent === 'Alle als PowerPoint (2)');
      // Ordner „Spiel & Über“: nur dessen sichtbare Seiten (S2 ausgeblendet → nur S1); Ordner „ig“: die Infografik
      await page.click('#ordnerKacheln .ordner-kachel[data-ordner="spiel"] .ok-oeffnen');
      await page.waitForFunction(() => document.getElementById('btnAllePptx').textContent === 'Alle als PowerPoint (1)');
      assert.equal(await text(page, '#btnAllePdf'), 'Alle als PDF (1)');
      const o = await exportAlle(page, '16x9');
      assert.equal(o.name, `Aether-Flyer_Version-1.1_Spiel-Ueber_16x9_${HEUTE()}.pptx`);
      assert.deepEqual(notizIds(liesPptx(o.puffer)), ['S1']);
      await page.click('#pfadZurueck');
      await page.click('#ordnerKacheln .ordner-kachel[data-ordner="ig"] .ok-oeffnen');
      await page.waitForFunction(() => document.getElementById('btnAllePptx').textContent === 'Alle als PowerPoint (1)');
      const i = await exportAlle(page, 'a4');
      assert.deepEqual(notizIds(liesPptx(i.puffer)), ['I1']);
      // Ordner ohne Seiten: Knopf gesperrt
      await page.click('#pfadZurueck');
      await page.click('#ordnerKacheln .ordner-kachel[data-ordner="leer"] .ok-oeffnen');
      await page.waitForFunction(() => document.getElementById('btnAllePptx').textContent === 'Alle als PowerPoint (0)');
      assert.ok(await page.$eval('#btnAllePptx', (b) => b.disabled));
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, [], 'kein fremder Dienst');
    });
  });

  test('b) „PowerPoint“ im Vollbild zwischen „Bild“ und „Export“: genau eine Folie mit der angezeigten Seite', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await bereit(page);
      await oeffneVollbild(page, 'S2');
      const reihe = await page.$$eval('.vb-leiste > button:not([hidden])', (bs) => bs.map((b) => b.id));
      assert.deepEqual(reihe.slice(reihe.indexOf('vbBild'), reihe.indexOf('vbBild') + 3), ['vbBild', 'vbPptx', 'vbExport']);
      assert.equal(await page.$eval('#vbPptx', (b) => b.className), await page.$eval('#vbBild', (b) => b.className), 'gleicher Stil wie „Bild“');
      await page.click('#vbWeiter');   // geblättert: S2 → E1
      await page.waitForFunction(() => window.AetherFlyerAnsicht.offenesDokument().id === 'E1');
      await page.click('#vbPptx');
      const d = await download(page, () => page.click('#pptxWahl [data-format="16x9"]'));
      assert.equal(d.name, `Aether-Flyer_Version-1.1_E1_16x9_${HEUTE()}.pptx`);
      const p = liesPptx(d.puffer);
      assert.equal(p.folien.length, 1);
      assert.deepEqual(notizIds(p), ['E1']);
      assert.ok(await page.isVisible('#vollbild'), 'Vollbild bleibt offen');
      assert.deepEqual(log.errors, []);
    });
  });

  test('c) Format A 21,0 × 29,7 cm, Format B 33,867 × 19,05 cm; Seitenbild (doppelte Auflösung) vollständig eingepasst und mittig, auch die hohe Infografik', async () => {
    await mitSeite({}, async ({ page }) => {
      await bereit(page);
      const P = (f) => page.evaluate(async (f) => {
        const A = window.AetherFlyerAnsicht, X = window.AetherFlyerPptx;
        const e = await X.exportiere(A.paket().dokumente, { format: f, name: 'x.pptx' });
        const b = new Uint8Array(await e.datei.arrayBuffer());
        let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(s);
      }, f).then((b64) => liesPptx(Buffer.from(b64, 'base64')));
      for (const [f, g] of [['a4', A4], ['16x9', B169]]) {
        const p = await P(f);
        assert.deepEqual(p.groesse, g, `${f}: Foliengröße`);
        assert.deepEqual(notizIds(p), ['S1', 'S2', 'E1', 'I1']);
        for (const fo of p.folien) pruefeLage(fo, g, `${f} ${fo.notiz[0]}`);
        // Flyer 794 × 1123 → 1588 × 2246 Pixel; Infografik 1080 × 3095 → 2160 × 6190
        assert.deepEqual([p.folien[0].bild.w, p.folien[0].bild.h], [1588, 2246]);
        assert.deepEqual([p.folien[3].bild.w, p.folien[3].bild.h], [2160, IG_HOEHE * 2]);
        // Hohe Infografik: volle Folienhöhe, schmal, mittig
        assert.equal(p.folien[3].ext.cy, g.cy);
        assert.ok(p.folien[3].ext.cx < g.cx * 0.5);
        if (f === 'a4') assert.ok(Math.abs(p.folien[0].ext.cx - g.cx) < 1000 && p.folien[0].ext.cy === g.cy, 'A4: Flyer füllt die Folie');
        if (f === '16x9') assert.equal(p.folien[0].ext.cy, g.cy, '16:9: Flyer auf volle Höhe');
      }
      assert.equal((A4.cx / EMU_CM).toFixed(1) + ' × ' + (A4.cy / EMU_CM).toFixed(1), '21.0 × 29.7');
      assert.equal((B169.cx / EMU_CM).toFixed(3) + ' × ' + (B169.cy / EMU_CM).toFixed(2), '33.867 × 19.05');
    });
  });

  test('d) Notizen jeder Folie: Seiten-Id, Titel und Stand (auch mit Sonderzeichen im Titel)', async () => {
    await mitSeite({}, async ({ page }) => {
      await bereit(page);
      const d = await exportAlle(page, 'a4');
      const p = liesPptx(d.puffer);
      assert.deepEqual(p.folien.map((f) => f.notiz), [
        ['Seite: S1', 'Titel: Platzhalter eins', 'Stand: 01.02.2020'],
        ['Seite: S2', 'Titel: Titel mit & <Probe> „Anführung“ äöü', 'Stand: 01.02.2020'],
        ['Seite: E1', 'Titel: Platzhalter drei', 'Stand: 01.02.2020']
      ]);
      assert.equal(p.folien[1].descr, 'S2 · Titel mit & <Probe> „Anführung“ äöü', 'Alternativtext des Bildes');
      // Infografik: Stand im Langformat aus ihrem data-stand-Element
      const v = await page.evaluate(async () => {
        const A = window.AetherFlyerAnsicht, X = window.AetherFlyerPptx;
        const e = await X.exportiere([A.paket().dokumente.find((x) => x.id === 'I1')], { format: '16x9', name: 'x.pptx' });
        const b = new Uint8Array(await e.datei.arrayBuffer());
        let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
        return btoa(s);
      });
      assert.deepEqual(liesPptx(Buffer.from(v, 'base64')).folien[0].notiz, ['Seite: I1', 'Titel: Platzhalter-Infografik', 'Stand: 1. Februar 2020']);
    });
  });

  test('e) Dateinamen: Alle, Ordner (Umlaut, Sonderzeichen) und Einzelseite; dateisicher', async () => {
    await mitSeite({}, async ({ page }) => {
      await oeffneFlyer(page);
      const n = await page.evaluate(() => {
        const X = window.AetherFlyerPptx, d = new Date(2026, 10, 22, 12, 0, 0);
        return [
          X.dateiName({ version: '1.1', format: 'a4', datum: d }),
          X.dateiName({ version: '1.1', ordner: 'Spiel & Über', format: '16x9', datum: d }),
          X.dateiName({ version: '1.1', ordner: 'Größe/Äpfel: „Öl“ (é)', format: 'a4', datum: d }),
          X.dateiName({ version: '2.3', seite: 'IG-Technik-2', format: '16x9', datum: d }),
          X.dateiName({ version: '1.1', ordner: '***', format: 'a4', datum: d }),
          X.dateisicher('a..b'), X.dateisicher(' ..x.. ')
        ];
      });
      assert.deepEqual(n, [
        'Aether-Flyer_Version-1.1_Alle_A4_2026-11-22.pptx',
        'Aether-Flyer_Version-1.1_Spiel-Ueber_16x9_2026-11-22.pptx',
        'Aether-Flyer_Version-1.1_Groesse-Aepfel-Oel-e_A4_2026-11-22.pptx',
        'Aether-Flyer_Version-2.3_IG-Technik-2_16x9_2026-11-22.pptx',
        'Aether-Flyer_Version-1.1_Ordner_A4_2026-11-22.pptx',
        'a.b', 'x'
      ]);
    });
    // Echte Downloads (Alle; Ordner und Einzelseite in a und b)
    await mitSeite({}, async ({ page }) => {
      await bereit(page);
      const d = await exportAlle(page, 'a4');
      assert.equal(d.name, `Aether-Flyer_Version-1.1_Alle_A4_${HEUTE()}.pptx`);
      assert.match(d.name, /^[A-Za-z0-9._-]+$/);
    });
  });

  test('f) Auswahl: Standard „A4 hochkant“, merkt sich die letzte Variante (Gerätespeicher); Esc und Tippen daneben schließen ohne Export; Tastatur', async () => {
    await mitSeite({}, async ({ page, log }) => {
      const downloads = [];
      page.on('download', (x) => downloads.push(x.suggestedFilename()));
      await bereit(page);
      await page.click('#btnAllePptx');
      assert.ok(await page.isVisible('#pptxWahl'));
      assert.equal(await page.getAttribute('#btnAllePptx', 'aria-expanded'), 'true');
      assert.deepEqual(await page.$$eval('#pptxWahl button', (bs) => bs.map((b) => [b.textContent, b.getAttribute('aria-checked')])), [['A4 hochkant', 'true'], ['16:9 quer', 'false']], 'erstes Mal: A4 hervorgehoben');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-format')), 'a4', 'Fokus auf der hervorgehobenen Variante');
      // Esc schließt ohne Export, Fokus zurück auf den Knopf
      await page.keyboard.press('Escape');
      assert.ok(await page.isHidden('#pptxWahl'));
      assert.equal(await page.evaluate(() => document.activeElement.id), 'btnAllePptx');
      assert.equal(await page.getAttribute('#btnAllePptx', 'aria-expanded'), 'false');
      // Tippen daneben schließt ohne Export
      await page.click('#btnAllePptx');
      await page.mouse.click(5, 300);
      assert.ok(await page.isHidden('#pptxWahl'));
      // Erneutes Antippen des Knopfs schließt
      await page.click('#btnAllePptx');
      await page.click('#btnAllePptx');
      assert.ok(await page.isHidden('#pptxWahl'));
      await page.waitForTimeout(800);
      assert.deepEqual(downloads, [], 'kein Export');
      // Tastatur: Pfeil → „16:9 quer“, Enter startet den Export
      await page.focus('#btnAllePptx');
      await page.keyboard.press('Enter');
      await page.keyboard.press('ArrowRight');
      assert.equal(await page.evaluate(() => document.activeElement.getAttribute('data-format')), '16x9');
      const d = await download(page, () => page.keyboard.press('Enter'));
      assert.match(d.name, /_Alle_16x9_/);
      await page.waitForFunction(async () => (await window.AetherFlyerSpeicher.ladeGeraet('pptxFormat')) === '16x9');
      // Neu laden: „16:9 quer“ ist hervorgehoben (auch im Vollbild)
      await page.reload();
      await oeffneFlyer(page, null);
      await page.evaluate(() => window.AetherFlyerPptx.bereit());
      await oeffneVollbild(page, 'S1');
      await page.click('#vbPptx');
      assert.deepEqual(await page.$$eval('#pptxWahl button', (bs) => bs.map((b) => b.getAttribute('aria-checked'))), ['false', 'true']);
      // Esc im Vollbild schließt nur die Auswahl, nicht das Vollbild; Pfeile blättern nicht
      await page.keyboard.press('ArrowLeft');
      assert.equal(await page.evaluate(() => window.AetherFlyerAnsicht.offenesDokument().id), 'S1', 'Pfeil blättert nicht');
      await page.keyboard.press('Escape');
      assert.ok(await page.isHidden('#pptxWahl'));
      assert.ok(await page.isVisible('#vollbild'), 'Vollbild bleibt offen');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'vbPptx');
      // Vollbild schließen schließt eine offene Auswahl
      await page.click('#vbPptx');
      await page.click('#vbZu');
      assert.ok(await page.isHidden('#pptxWahl'));
      assert.deepEqual(downloads, ['Aether-Flyer_Version-1.1_Alle_16x9_' + HEUTE() + '.pptx']);
      assert.deepEqual(log.errors, []);
    });
  });

  test('g) Datei gültig: Pflichtteile, Content-Types, alle Beziehungen vorhanden; JPEG lesbar (Qualität 0,92, ohne Transparenz)', async () => {
    await mitSeite({}, async ({ page }) => {
      await bereit(page);
      await oeffneVollbild(page, 'I1');
      await page.click('#vbPptx');
      const eins = await download(page, () => page.click('#pptxWahl [data-format="a4"]'));
      await page.click('#vbZu');
      const alle = await exportAlle(page, '16x9');
      for (const d of [eins, alle]) {
        const p = liesPptx(d.puffer);
        const namen = [...p.dateien.keys()];
        assert.equal(namen[0], '[Content_Types].xml', 'Content-Types zuerst');
        for (const t of ['_rels/.rels', 'docProps/core.xml', 'docProps/app.xml', 'ppt/presentation.xml', 'ppt/_rels/presentation.xml.rels',
          'ppt/presProps.xml', 'ppt/viewProps.xml', 'ppt/tableStyles.xml', 'ppt/slideMasters/slideMaster1.xml', 'ppt/slideMasters/_rels/slideMaster1.xml.rels',
          'ppt/slideLayouts/slideLayout1.xml', 'ppt/slideLayouts/_rels/slideLayout1.xml.rels', 'ppt/theme/theme1.xml', 'ppt/theme/theme2.xml',
          'ppt/notesMasters/notesMaster1.xml', 'ppt/notesMasters/_rels/notesMaster1.xml.rels']) assert.ok(p.dateien.has(t), `Pflichtteil ${t}`);
        const n = p.folien.length;
        for (let i = 1; i <= n; i++) {
          for (const t of [`ppt/slides/slide${i}.xml`, `ppt/slides/_rels/slide${i}.xml.rels`, `ppt/notesSlides/notesSlide${i}.xml`, `ppt/notesSlides/_rels/notesSlide${i}.xml.rels`, `ppt/media/image${i}.jpeg`]) assert.ok(p.dateien.has(t), t);
        }
        assert.equal(namen.length, 17 + 5 * n, 'keine weiteren Teile');
        // Content-Types: jeder Teil hat einen Typ (Override oder Default nach Endung), jeder Override einen Teil
        const ct = p.txt('[Content_Types].xml');
        const defaults = new Map([...ct.matchAll(/<Default Extension="([^"]+)" ContentType="([^"]+)"\/>/g)].map((m) => [m[1], m[2]]));
        const overrides = new Map([...ct.matchAll(/<Override PartName="\/([^"]+)" ContentType="([^"]+)"\/>/g)].map((m) => [m[1], m[2]]));
        assert.equal(defaults.get('jpeg'), 'image/jpeg');
        assert.equal(defaults.get('rels'), 'application/vnd.openxmlformats-package.relationships+xml');
        for (const t of namen) if (t !== '[Content_Types].xml') assert.ok(overrides.has(t) || defaults.has(t.split('.').pop()), `${t}: Content-Type`);
        for (const t of overrides.keys()) assert.ok(p.dateien.has(t), `Override ${t} hat einen Teil`);
        assert.equal(overrides.get('ppt/presentation.xml'), 'application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml');
        for (let i = 1; i <= n; i++) {
          assert.equal(overrides.get(`ppt/slides/slide${i}.xml`), 'application/vnd.openxmlformats-officedocument.presentationml.slide+xml');
          assert.equal(overrides.get(`ppt/notesSlides/notesSlide${i}.xml`), 'application/vnd.openxmlformats-officedocument.presentationml.notesSlide+xml');
        }
        // Beziehungen: jedes Ziel existiert; jede Folie hat Layout, Bild und Notizen; Notizen zeigen auf Master und Folie
        for (const t of namen.filter((x) => x.endsWith('.rels'))) {
          const quelle = t === '_rels/.rels' ? '' : t.replace(/_rels\/([^/]+)\.rels$/, '$1');
          for (const r of rels(p.txt(t))) {
            const ziel = quelle === '' ? r.ziel : aufloesen(quelle, r.ziel);
            assert.ok(p.dateien.has(ziel), `${t}: Ziel ${r.ziel} (${ziel}) vorhanden`);
          }
        }
        for (let i = 1; i <= n; i++) {
          const typen = rels(p.txt(`ppt/slides/_rels/slide${i}.xml.rels`)).map((r) => r.typ.split('/').pop()).sort();
          assert.deepEqual(typen, ['image', 'notesSlide', 'slideLayout']);
          assert.deepEqual(rels(p.txt(`ppt/notesSlides/_rels/notesSlide${i}.xml.rels`)).map((r) => r.typ.split('/').pop()).sort(), ['notesMaster', 'slide']);
        }
        assert.deepEqual(rels(p.txt('_rels/.rels')).map((r) => r.typ.split('/').pop()).sort(), ['core-properties', 'extended-properties', 'officeDocument']);
        // Wohlgeformt: Browser-XML-Parser liest jeden XML-Teil ohne Fehler
        const xmls = namen.filter((x) => /\.(xml|rels)$/.test(x)).map((x) => p.txt(x));
        assert.deepEqual(await page.evaluate((xs) => xs.map((x) => new DOMParser().parseFromString(x, 'application/xml').getElementsByTagName('parsererror').length), xmls), xmls.map(() => 0), 'alle XML-Teile wohlgeformt');
        assert.match(p.txt('docProps/app.xml'), new RegExp(`<Slides>${n}</Slides><Notes>${n}</Notes>`));
        // JPEG im Browser dekodierbar, Maße wie im SOF-Block, Ecke in Seitenfarbe bzw. Paket-Grund (deckend)
        for (const f of p.folien) {
          const r = await page.evaluate(async (b64) => {
            const bin = atob(b64), u8 = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
            const bmp = await createImageBitmap(new Blob([u8], { type: 'image/jpeg' }));
            const c = new OffscreenCanvas(bmp.width, bmp.height), ctx = c.getContext('2d');
            ctx.drawImage(bmp, 0, 0);
            return { w: bmp.width, h: bmp.height, a: ctx.getImageData(2, 2, 1, 1).data[3] };
          }, f.bild.daten.toString('base64'));
          assert.deepEqual([r.w, r.h], [f.bild.w, f.bild.h], `${f.bildTeil}: lesbar`);
          assert.equal(r.a, 255, 'JPEG deckend');
        }
      }
      // Hintergrund der Folien und des Masters in Seitenfarbe #0c0f1d
      const p = liesPptx(alle.puffer);
      assert.match(p.txt('ppt/slides/slide1.xml'), /<p:bg><p:bgPr><a:solidFill><a:srgbClr val="0C0F1D"\/>/);
      assert.match(p.txt('ppt/slideMasters/slideMaster1.xml'), /<a:srgbClr val="0C0F1D"\/>/);
      assert.equal(await page.evaluate(() => window.AetherFlyerPptx.JPEG_QUALITAET), 0.92);
    });
  });

  test('Weitergabe: Teilen-Menü mit Datei (MIME pptx); nach langem Zeichnen erst „Teilen“ antippen; Fehler als Meldung, Knöpfe wieder frei', async () => {
    const teilen = () => {
      window.__geteilt = [];
      navigator.canShare = () => true;
      navigator.share = (d) => { window.__geteilt.push(d.files.map((f) => [f.name, f.type, f.size])); return Promise.resolve(); };
      Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ isActive: window.__geste === true, hasBeenActive: true }) });
    };
    await mitSeite({ init: [teilen] }, async ({ page, log }) => {
      await bereit(page);
      // Geste noch frisch → Teilen-Menü direkt
      await page.evaluate(() => { window.__geste = true; });
      await page.click('#btnAllePptx');
      await page.click('#pptxWahl [data-format="a4"]');
      await page.waitForFunction(() => window.__geteilt.length === 1);
      const g = await page.evaluate(() => window.__geteilt[0]);
      assert.equal(g.length, 1);
      assert.equal(g[0][0], `Aether-Flyer_Version-1.1_Alle_A4_${HEUTE()}.pptx`);
      assert.equal(g[0][1], 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      assert.ok(await page.isHidden('#modal'));
      // Geste verbraucht → Hinweis mit „Teilen“; erst der Tipp öffnet das Teilen-Menü
      await page.evaluate(() => { window.__geste = false; });
      await page.click('#btnAllePptx');
      await page.click('#pptxWahl [data-format="16x9"]');
      await page.waitForSelector('#modal:not([hidden])');
      assert.equal(await text(page, '#mTitel'), `Aether-Flyer_Version-1.1_Alle_16x9_${HEUTE()}.pptx`);
      assert.match(await text(page, '#mText'), /^Fertig: 3 Folien · \d+ KB\. Zum Weitergeben „Teilen“ antippen\.$/);
      assert.equal(await page.evaluate(() => window.__geteilt.length), 1);
      await page.click('#mInhalt button');
      await page.waitForFunction(() => window.__geteilt.length === 2);
      assert.ok(await page.isHidden('#modal'));
      // Fehler (Canvas gibt kein Bild heraus): verständliche Meldung, Knöpfe wieder frei, nichts geteilt
      await page.evaluate(() => { HTMLCanvasElement.prototype.toBlob = function (cb) { cb(null); }; });
      await page.click('#btnAllePptx');
      await page.click('#pptxWahl [data-format="a4"]');
      await page.waitForFunction(() => /PowerPoint-Datei ließ sich nicht erstellen/.test(document.getElementById('toast').textContent));
      assert.equal(await text(page, '#toast'), 'Die PowerPoint-Datei ließ sich nicht erstellen – Seite S1: Canvas zu groß');
      await page.waitForFunction(() => !document.getElementById('btnAllePptx').disabled);
      assert.equal(await text(page, '#btnAllePptx'), 'Alle als PowerPoint (3)');
      assert.equal(await page.evaluate(() => window.__geteilt.length), 2);
      assert.deepEqual(log.errors, []);
    });
  });

  test('h) Layout: Knöpfe und Auswahl auf 1024 × 768, 1366 × 1024 und 844 × 390 ohne Überlauf; Tippflächen ≥ 44 px; Auswahl direkt unter dem Knopf', async () => {
    for (const vp of [{ width: 1024, height: 768 }, { width: 1366, height: 1024 }, { width: 844, height: 390 }]) {
      await mitSeite({ viewport: vp, hasTouch: vp.width === 844, isMobile: vp.width === 844 }, async ({ page, log }) => {
        await bereit(page);
        const pruefe = (knopf, wo) => page.evaluate(([knopf, wo]) => {
          const vw = document.documentElement.clientWidth, vh = window.innerHeight;
          const k = document.getElementById(knopf).getBoundingClientRect();
          const m = document.getElementById('pptxWahl'), r = m.getBoundingClientRect();
          const bs = [...m.querySelectorAll('button')].map((b) => b.getBoundingClientRect());
          const fehler = [];
          if (document.documentElement.scrollWidth > vw) fehler.push('Seite läuft waagerecht über');
          if (k.width < 44 || k.height < 44) fehler.push('Knopf < 44 px');
          if (k.left < 0 || k.right > vw) fehler.push('Knopf außerhalb');
          if (r.left < 0 || r.right > vw || r.top < 0 || r.bottom > vh) fehler.push(`Auswahl außerhalb ${JSON.stringify(r)}`);
          for (const b of bs) if (b.width < 44 || b.height < 44) fehler.push('Variante < 44 px');
          for (const b of bs) if (b.right > r.right + 0.5 || b.left < r.left - 0.5) fehler.push('Variante läuft aus der Auswahl');
          const unter = Math.abs(r.top - (k.bottom + 4)) <= 1, ueber = Math.abs(r.bottom - (k.top - 4)) <= 1;
          if (!unter && !(ueber && k.bottom + 4 + r.height > vh - 8)) fehler.push('Auswahl nicht direkt am Knopf');
          for (const el of document.querySelectorAll(wo)) if (el.scrollWidth > el.clientWidth + 1) fehler.push(`${wo} läuft über`);
          return fehler;
        }, [knopf, wo]);
        await page.click('#btnAllePptx');
        assert.deepEqual(await pruefe('btnAllePptx', '.leiste'), [], `${vp.width} × ${vp.height}: Übersicht`);
        await page.screenshot({ path: `${H.OUT}/pptx-uebersicht-${vp.width}x${vp.height}.png` });
        await page.keyboard.press('Escape');
        await oeffneVollbild(page, 'S1');
        await page.click('#vbPptx');
        assert.deepEqual(await pruefe('vbPptx', '.vb-leiste'), [], `${vp.width} × ${vp.height}: Vollbild`);
        // Auswahl liegt über dem Vollbild (oberstes Element an ihrer Mitte)
        assert.ok(await page.evaluate(() => { const r = document.getElementById('pptxWahl').getBoundingClientRect(); const e = document.elementFromPoint(r.left + r.width / 4, r.top + r.height / 2); return !!e && !!e.closest('#pptxWahl'); }), 'Auswahl sichtbar über dem Vollbild');
        await page.screenshot({ path: `${H.OUT}/pptx-vollbild-${vp.width}x${vp.height}.png` });
        assert.deepEqual(log.errors, []);
      });
    }
  });
});
