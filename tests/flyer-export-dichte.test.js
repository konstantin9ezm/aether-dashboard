// Flyer-Export und Pixeldichte: PowerPoint (A4 hochkant, 16:9 quer) und „Grafiken & Daten“ (PNG, SVG) zeigen Lage,
// Ausschnitt und Größe auf jedem Gerät gleich – geprüft mit deviceScaleFactor 1 (Desktop), 2 (iPad) und 3 (iPhone).
// Dazu: der Teilen-Dialog bekommt nur die Datei (kein title/text – den sichert iOS als eigene Textdatei daneben).
//
// Hintergrund (Gerätetest iPad, 24.11.2026): Im PowerPoint-Bild stand die Seite nur einfach groß oben links (ein
// Viertel des Bildes), die PNG-Ausschnitte lagen falsch. Ursache war nicht devicePixelRatio, sondern WebKit (Safari):
// Es wendet Maßstab und Verschiebung einer viewBox nicht auf HTML im foreignObject an, das eine eigene Ebene hat
// (position, overflow …). Chromium – der Test-Browser hier und in der CI – hat diesen Fehler nicht. Darum gibt es
// zwei Arten von Prüfungen:
//   1. Pixel: farbige Marken einer künstlichen Testseite liegen im Folienbild und in den Element-Bildern an der
//      erwarteten Stelle (± 2 px), bei jeder Pixeldichte gleich.
//   2. Aufbau (die eigentliche Sicherung gegen den WebKit-Fehler): Das SVG-Bild der Seite ist genau 1 : 1 – ohne
//      viewBox, ohne Maßstab; die Kasten-SVG schneidet per CSS aus, ihre viewBox beginnt bei 0 0 in Originalgröße.
// Nur eine künstliche Testseite („Testkasten“, einfache Formen) – kein echter Flyer-Inhalt.
'use strict';

const { test, describe, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./flyer-hilfe');
const { assert, mitSeite, oeffneFlyer, importiere, ruhe, download, tafelKnopf, liesZip, pngMasse } = H;

before(H.starte);
after(H.beende);

/* ---------- Künstliche Testseite (tests/flyer-testseite.js) ---------- */
const { BREITE, HOEHE, FAKTOR, GRUND, FARBEN, KASTEN, SYMBOL, LINIE_X, paket } = require('./flyer-testseite');

/* ---------- Hilfen ---------- */
// Merkt sich jedes SVG, das als Bild geladen wird (so entsteht das Seitenbild): window.__svgBilder
function svgMerker() {
  window.__svgBilder = [];
  const d = Object.getOwnPropertyDescriptor(HTMLImageElement.prototype, 'src');
  Object.defineProperty(HTMLImageElement.prototype, 'src', {
    configurable: true, enumerable: d.enumerable,
    get() { return d.get.call(this); },
    set(v) { if (typeof v === 'string' && v.indexOf('data:image/svg+xml;base64,') === 0) window.__svgBilder.push(v); d.set.call(this, v); }
  });
}
// Köpfe (bis einschließlich <foreignObject …>) aller als Bild geladenen SVG mit eingebettetem HTML
const svgKoepfe = (page) => page.evaluate(() => window.__svgBilder.map((u) => {
  const bin = atob(u.slice(u.indexOf(',') + 1)), u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  const t = new TextDecoder().decode(u8), fo = t.indexOf('<foreignObject');
  return fo < 0 ? null : t.slice(0, t.indexOf('>', fo) + 1);
}).filter(Boolean));
// Bild (JPEG, PNG, SVG) im Browser dekodieren → { w, h, flaechen: { name: { x0, y0, x1, y1, n } | null }, punkte: [[r, g, b, a]] }
// Fläche = umschließendes Rechteck aller Pixel, die der Farbe bis auf tol je Kanal gleichen (deckend)
function analyse(page, puffer, mime, opt = {}) {
  return page.evaluate(async ([b64, mime, farben, tol, punkte]) => {
    const img = new Image();
    await new Promise((ok, nein) => { img.onload = ok; img.onerror = () => nein(new Error('Bild nicht lesbar')); img.src = 'data:' + mime + ';base64,' + b64; });
    const w = img.naturalWidth, h = img.naturalHeight;
    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d', { willReadFrequently: true });
    ctx.drawImage(img, 0, 0);
    const d = ctx.getImageData(0, 0, w, h).data;
    const flaechen = {};
    for (const name of Object.keys(farben)) {
      const [r, g, b] = farben[name];
      let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] > 200 && Math.abs(d[i] - r) <= tol && Math.abs(d[i + 1] - g) <= tol && Math.abs(d[i + 2] - b) <= tol) {
          n++;
          if (x < x0) x0 = x;
          if (x > x1) x1 = x;
          if (y < y0) y0 = y;
          if (y > y1) y1 = y;
        }
      }
      flaechen[name] = n ? { x0, y0, x1, y1, n } : null;
    }
    return { w, h, flaechen, punkte: punkte.map(([x, y]) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4))) };
  }, [Buffer.from(puffer).toString('base64'), mime, FARBEN, opt.tol === undefined ? 50 : opt.tol, opt.punkte || []]);
}
// Marke (CSS-Pixel x, y, Breite b, Höhe h) liegt im Bild (Maßstab f) an der erwarteten Stelle, ± 2 Bildpixel
function liegtBei(a, name, x, y, b, h, f, wo) {
  const fl = a.flaechen[name];
  assert.ok(fl, `${wo}: Marke ${name} im Bild vorhanden`);
  const soll = { x0: x * f, y0: y * f, x1: (x + b) * f - 1, y1: (y + h) * f - 1 };
  for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(fl[k] - soll[k]) <= 2, `${wo}: Marke ${name} ${k} = ${fl[k]}, erwartet ${soll[k]} (± 2 px)`);
}
const nahe = (ist, soll, wo, tol = 4) => soll.forEach((v, i) => assert.ok(Math.abs(ist[i] - v) <= tol, `${wo}: Pixel ${ist} ≈ ${soll}`));
function jpegMasse(b) {
  assert.ok(b[0] === 0xff && b[1] === 0xd8, 'JPEG beginnt mit SOI');
  let p = 2;
  while (p < b.length) {
    assert.equal(b[p], 0xff, 'JPEG-Marker');
    const m = b[p + 1], len = b.readUInt16BE(p + 2);
    if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: b.readUInt16BE(p + 5), w: b.readUInt16BE(p + 7) };
    p += 2 + len;
  }
  throw new Error('JPEG ohne SOF');
}
// PowerPoint-Datei → Foliengröße, Bildrahmen und Bild der ersten Folie (unabhängig vom Schreiber gelesen)
function liesFolie(puffer) {
  const z = new Map(liesZip(puffer).map((d) => [d.name, d]));
  const zahl = (xml, el, a) => Number(new RegExp(`<${el}\\b[^>]*\\b${a}="(\\d+)"`).exec(xml)[1]);
  const pres = z.get('ppt/presentation.xml').daten.toString('utf8'), folie = z.get('ppt/slides/slide1.xml').daten.toString('utf8');
  const pic = /<p:pic>[\s\S]*?<\/p:pic>/.exec(folie)[0];
  const bild = z.get('ppt/media/image1.jpeg').daten;
  return {
    groesse: { cx: zahl(pres, 'p:sldSz', 'cx'), cy: zahl(pres, 'p:sldSz', 'cy') },
    rahmen: { x: zahl(pic, 'a:off', 'x'), y: zahl(pic, 'a:off', 'y'), cx: zahl(pic, 'a:ext', 'cx'), cy: zahl(pic, 'a:ext', 'cy') },
    bild, masse: jpegMasse(bild)
  };
}
// Erwarteter Bildrahmen: vollständig eingepasst, mittig (unabhängig nachgerechnet)
function rahmenSoll(bw, bh, sw, sh) {
  const f = Math.min(sw / bw, sh / bh);
  const cx = Math.min(sw, Math.round(bw * f)), cy = Math.min(sh, Math.round(bh * f));
  return { x: Math.round((sw - cx) / 2), y: Math.round((sh - cy) / 2), cx, cy };
}
async function bereit(page) {
  await oeffneFlyer(page);
  await importiere(page, paket());
  await ruhe(page);
  assert.equal(await page.evaluate(() => window.AetherFlyerPptx.bereit()), true, 'PowerPoint möglich (Selbstprobe von „Bild“)');
}
async function pptx(page, format) {
  await page.click('#btnAllePptx');
  return download(page, () => page.click(`#pptxWahl [data-format="${format}"]`));
}
// Folienbild: ganze Seite, randgenau – jede Ecke der Seite an ihrer Stelle, kein dunkler Rand, kein Abschnitt
function pruefeSeitenbild(a, wo) {
  assert.deepEqual([a.w, a.h], [BREITE * FAKTOR, HOEHE * FAKTOR], `${wo}: Bildgröße`);
  liegtBei(a, 'rot', 0, 0, 40, 40, FAKTOR, `${wo} oben links`);
  liegtBei(a, 'gruen', BREITE - 40, 0, 40, 40, FAKTOR, `${wo} oben rechts`);
  liegtBei(a, 'blau', 0, HOEHE - 40, 40, 40, FAKTOR, `${wo} unten links`);
  liegtBei(a, 'gelb', BREITE - 40, HOEHE - 40, 40, 40, FAKTOR, `${wo} unten rechts`);
  liegtBei(a, 'magenta', KASTEN.x, KASTEN.y, 20, 20, FAKTOR, `${wo} Kasten oben links`);
  liegtBei(a, 'cyan', KASTEN.x + KASTEN.w - 20, KASTEN.y + KASTEN.h - 20, 20, 20, FAKTOR, `${wo} Kasten unten rechts`);
  // Mitte jedes Viertels: Seitenhintergrund (nicht die dunkle Grundfarbe #0c0f1d des JPEG)
  a.punkte.forEach((p, i) => nahe(p, GRUND, `${wo}: Seitenhintergrund in Viertel ${i + 1}`, 12));
}
const VIERTEL = [[397, 400], [1191, 400], [397, 1800], [1191, 1800]];   // Bildpixel, je eine freie Stelle der Seite

describe('Flyer-Export bei Pixeldichte 1, 2 und 3: Lage, Ausschnitt und Größe bleiben gleich', () => {
  const ergebnis = {};
  for (const dichte of [1, 2, 3]) {
    test(`deviceScaleFactor ${dichte}: PowerPoint A4 und 16:9 (Folienbild randgenau im Rahmen), Grafiken als PNG und SVG (genau das Element), SVG-Bild 1 : 1`, async () => {
      await mitSeite({ deviceScaleFactor: dichte, init: [H.ohneTeilen, svgMerker] }, async ({ page, log }) => {
        await bereit(page);
        assert.equal(await page.evaluate(() => window.devicePixelRatio), dichte, 'Pixeldichte des Test-Browsers');

        /* --- Exporte (wie am Gerät: über die Knöpfe) --- */
        const a4 = await pptx(page, 'a4');
        const quer = await pptx(page, '16x9');
        await page.click('#btnGrafikenVersion');
        await page.waitForSelector('#tafelInhalt .g-fertig', { timeout: 60000 });
        const zip = await download(page, () => tafelKnopf(page, 'ZIP sichern'));
        const koepfe = await svgKoepfe(page);   // vor den Analysen unten (die laden selbst Bilder)
        await page.keyboard.press('Escape');

        /* --- Aufbau des SVG-Bildes der Seite: genau 1 : 1, keine viewBox, kein Maßstab (WebKit) --- */
        const seiten = koepfe.filter((k) => !/ width="8" height="8">/.test(k));   // ohne die Selbstprobe (8 × 8)
        assert.ok(seiten.length >= 3, `Seitenbild für A4, 16:9 und Grafiken geladen (${seiten.length})`);
        for (const k of seiten) {
          assert.equal(k, `<svg xmlns="http://www.w3.org/2000/svg" width="${BREITE}" height="${HOEHE}"><foreignObject x="0" y="0" width="${BREITE}" height="${HOEHE}">`,
            'SVG-Bild der Seite 1 : 1 in CSS-Pixeln');
          assert.ok(!/viewBox|preserveAspectRatio|transform/.test(k), 'ohne viewBox, ohne Maßstab');
        }

        /* --- Teil 1: PowerPoint --- */
        assert.match(a4.name, /^Aether-Flyer_Version-1\.1_Alle_A4_\d{4}-\d\d-\d\d\.pptx$/);
        assert.match(quer.name, /^Aether-Flyer_Version-1\.1_Alle_16x9_\d{4}-\d\d-\d\d\.pptx$/);
        const fa = liesFolie(a4.puffer), fq = liesFolie(quer.puffer);
        assert.deepEqual(fa.groesse, { cx: 7560000, cy: 10692000 }, 'Format A: A4 hochkant');
        assert.deepEqual(fq.groesse, { cx: 12192000, cy: 6858000 }, 'Format B: 16:9 quer');
        assert.deepEqual(fa.masse, { w: BREITE * FAKTOR, h: HOEHE * FAKTOR }, 'A4: JPEG in doppelter Auflösung');
        assert.deepEqual(fq.masse, fa.masse, '16:9: dasselbe Seitenbild');
        assert.deepEqual(fa.rahmen, rahmenSoll(fa.masse.w, fa.masse.h, 7560000, 10692000), 'A4: Rahmen füllt die Folie');
        assert.deepEqual(fq.rahmen, rahmenSoll(fq.masse.w, fq.masse.h, 12192000, 6858000), '16:9: Rahmen in voller Folienhöhe, mittig');
        assert.equal(fq.rahmen.cy, 6858000, '16:9: volle Folienhöhe');
        const ba = await analyse(page, fa.bild, 'image/jpeg', { punkte: VIERTEL });
        const bq = await analyse(page, fq.bild, 'image/jpeg', { punkte: VIERTEL });
        pruefeSeitenbild(ba, 'A4');
        pruefeSeitenbild(bq, '16:9');

        /* --- Teil 2: Grafiken herunterladen --- */
        assert.equal(zip.name, 'aether-flyer_1.1.zip');
        const z = liesZip(zip.puffer);
        assert.deepEqual(z.map((d) => d.name), ['T1/1.1_T1_01_symbol.png', 'T1/1.1_T1_01_symbol.svg', 'T1/1.1_T1_02_kasten.png', 'T1/1.1_T1_02_kasten.svg', 'T1/1.1_T1.csv', 'T1/1.1_T1.json'],
          'ZIP-Aufbau und Dateinamen unverändert');
        const datei = (n) => z.find((d) => d.name === 'T1/' + n).daten;
        const j = JSON.parse(datei('1.1_T1.json').toString('utf8'));
        assert.deepEqual(j.grafiken.map((g) => [g.nr, g.art, g.x, g.y, g.breite, g.hoehe, g.png, g.svg, g.svgArt]), [
          [1, 'symbol', SYMBOL.x, SYMBOL.y, SYMBOL.w, SYMBOL.h, '1.1_T1_01_symbol.png', '1.1_T1_01_symbol.svg', 'svg'],
          [2, 'kasten', KASTEN.x, KASTEN.y, KASTEN.w, KASTEN.h, '1.1_T1_02_kasten.png', '1.1_T1_02_kasten.svg', 'html']
        ], 'JSON: Lage und Größe der Grafiken in CSS-Pixeln');
        // PNG des Kastens: Größe = Element × 2, Marken des Kastens in seinen Ecken, Fläche und scharfe Linie
        const kp = datei('1.1_T1_02_kasten.png');
        assert.deepEqual(pngMasse(kp), { w: KASTEN.w * FAKTOR, h: KASTEN.h * FAKTOR }, 'Kasten-PNG: Größe = Element × 2');
        const ak = await analyse(page, kp, 'image/png', { tol: 4, punkte: [[100, 300], [LINIE_X * 2 - 1, 200], [LINIE_X * 2, 200], [LINIE_X * 2 + 1, 200], [LINIE_X * 2 + 2, 200]] });
        liegtBei(ak, 'magenta', 0, 0, 20, 20, FAKTOR, 'Kasten-PNG oben links');
        liegtBei(ak, 'cyan', KASTEN.w - 20, KASTEN.h - 20, 20, 20, FAKTOR, 'Kasten-PNG unten rechts');
        for (const n of ['rot', 'gruen', 'blau', 'gelb', 'lila', 'petrol']) assert.equal(ak.flaechen[n], null, `Kasten-PNG: nichts anderes von der Seite (${n})`);
        nahe(ak.punkte[0], [128, 128, 128, 255], 'Kasten-PNG: Fläche des Kastens');
        nahe(ak.punkte[1], [128, 128, 128, 255], 'Kasten-PNG: links neben der Linie die Fläche (scharf)');
        nahe(ak.punkte[2], [255, 255, 255, 255], 'Kasten-PNG: Linie, erste Spalte');
        nahe(ak.punkte[3], [255, 255, 255, 255], 'Kasten-PNG: Linie, zweite Spalte');
        nahe(ak.punkte[4], [128, 128, 128, 255], 'Kasten-PNG: rechts neben der Linie die Fläche (scharf)');
        // PNG des Symbols
        const sp = datei('1.1_T1_01_symbol.png');
        assert.deepEqual(pngMasse(sp), { w: SYMBOL.w * FAKTOR, h: SYMBOL.h * FAKTOR }, 'Symbol-PNG: Größe = Element × 2');
        const as = await analyse(page, sp, 'image/png', { tol: 4, punkte: [[48, 48]] });
        liegtBei(as, 'lila', 0, 0, 12, 12, FAKTOR, 'Symbol-PNG oben links');
        liegtBei(as, 'petrol', SYMBOL.w - 12, SYMBOL.h - 12, 12, 12, FAKTOR, 'Symbol-PNG unten rechts');
        nahe(as.punkte[0], [255, 128, 0, 255], 'Symbol-PNG: Fläche des Symbols');
        // SVG des Kastens (eingebettetes HTML): Ausschnitt per CSS, viewBox ohne Verschiebung und ohne Maßstab
        const ks = datei('1.1_T1_02_kasten.svg').toString('utf8');
        assert.match(ks, new RegExp(`^<svg xmlns="http://www\\.w3\\.org/2000/svg" width="${KASTEN.w}" height="${KASTEN.h}" viewBox="0 0 ${KASTEN.w} ${KASTEN.h}">` +
          `<foreignObject x="0" y="0" width="${KASTEN.w}" height="${KASTEN.h}"><div xmlns="http://www\\.w3\\.org/1999/xhtml" style="[^"]*overflow:hidden !important">` +
          `<div style="[^"]*margin:-${KASTEN.y}px 0 0 -${KASTEN.x}px !important;width:${BREITE}px !important">`), 'Kasten-SVG: Kopf');
        assert.ok(!/<svg[^>]*\btransform=|<foreignObject[^>]*\btransform=/.test(ks), 'Kasten-SVG: keine Verschiebung über das SVG');
        const av = await analyse(page, Buffer.from(ks, 'utf8'), 'image/svg+xml', { tol: 4, punkte: [[50, 150]] });
        assert.deepEqual([av.w, av.h], [KASTEN.w, KASTEN.h], 'Kasten-SVG: Größe = Element');
        liegtBei(av, 'magenta', 0, 0, 20, 20, 1, 'Kasten-SVG oben links');
        liegtBei(av, 'cyan', KASTEN.w - 20, KASTEN.h - 20, 20, 20, 1, 'Kasten-SVG unten rechts');
        assert.equal(av.flaechen.rot, null, 'Kasten-SVG: nicht die Ecke der Seite');
        nahe(av.punkte[0], [128, 128, 128, 255], 'Kasten-SVG: Fläche des Kastens');
        // SVG des Symbols: echte SVG in Elementgröße
        const ss = datei('1.1_T1_01_symbol.svg').toString('utf8');
        const asv = await analyse(page, Buffer.from(ss, 'utf8'), 'image/svg+xml', { tol: 4 });
        assert.deepEqual([asv.w, asv.h], [SYMBOL.w, SYMBOL.h], 'Symbol-SVG: Größe = Element');
        liegtBei(asv, 'lila', 0, 0, 12, 12, 1, 'Symbol-SVG oben links');
        // CSV unverändert
        assert.equal(datei('1.1_T1.csv').toString('utf8'), '﻿version;seite;kennung;art;wert;status\r\n1.1;T1;t1;text;Testkasten;\r\n');

        ergebnis[dichte] = {
          a4: [fa.masse, fa.rahmen, ba.flaechen], quer: [fq.masse, fq.rahmen, bq.flaechen],
          kasten: [pngMasse(kp), ak.flaechen], symbol: [pngMasse(sp), as.flaechen], json: j.grafiken
        };
        if (dichte === 2) {
          fs.writeFileSync(path.join(H.OUT, 'flyer-export-dichte-folie.jpg'), fa.bild);
          fs.writeFileSync(path.join(H.OUT, 'flyer-export-dichte-kasten.png'), kp);
        }
        assert.deepEqual(log.errors, []);
        assert.deepEqual(log.fremd, []);
      });
    });
  }

  test('Pixeldichte 1, 2 und 3 liefern dasselbe: gleiche Bildgröße, gleicher Rahmen, gleiche Lage aller Marken', () => {
    assert.deepEqual(Object.keys(ergebnis), ['1', '2', '3'], 'alle drei Läufe vorhanden');
    assert.deepEqual(ergebnis[2], ergebnis[1], 'Pixeldichte 2 (iPad) wie 1');
    assert.deepEqual(ergebnis[3], ergebnis[1], 'Pixeldichte 3 (iPhone) wie 1');
  });
});

describe('Teilen ohne Textdatei: der Teilen-Dialog bekommt nur die Datei', () => {
  test('PowerPoint, „Bild“, ZIP und CSV: navigator.share bekommt genau { files } – kein title, kein text, keine url', async () => {
    const teilen = () => {
      window.__geteilt = [];
      navigator.canShare = () => true;
      navigator.share = (d) => { window.__geteilt.push({ schluessel: Object.keys(d).sort(), dateien: d.files.map((f) => [f.name, f.type]) }); return Promise.resolve(); };
      Object.defineProperty(navigator, 'userActivation', { configurable: true, get: () => ({ isActive: true, hasBeenActive: true }) });
    };
    await mitSeite({ deviceScaleFactor: 2, init: [teilen] }, async ({ page, log }) => {
      await bereit(page);
      const geteilt = (n) => page.waitForFunction((n) => window.__geteilt.length === n, n).then(() => page.evaluate(() => window.__geteilt[window.__geteilt.length - 1]));
      // PowerPoint (beide Formate)
      await page.click('#btnAllePptx');
      await page.click('#pptxWahl [data-format="a4"]');
      let g = await geteilt(1);
      assert.deepEqual(g.schluessel, ['files'], 'PowerPoint A4: nur files');
      assert.match(g.dateien[0][0], /^Aether-Flyer_Version-1\.1_Alle_A4_\d{4}-\d\d-\d\d\.pptx$/);
      assert.equal(g.dateien[0][1], 'application/vnd.openxmlformats-officedocument.presentationml.presentation');
      await page.waitForFunction(() => !document.getElementById('btnAllePptx').disabled);
      await page.click('#btnAllePptx');
      await page.click('#pptxWahl [data-format="16x9"]');
      g = await geteilt(2);
      assert.deepEqual(g.schluessel, ['files'], 'PowerPoint 16:9: nur files');
      // ZIP der Version („Grafiken & Daten“)
      await page.waitForFunction(() => !document.getElementById('btnAllePptx').disabled);
      await page.click('#btnGrafikenVersion');
      await page.waitForSelector('#tafelInhalt .g-fertig', { timeout: 60000 });
      await tafelKnopf(page, 'ZIP sichern');
      g = await geteilt(3);
      assert.deepEqual([g.schluessel, g.dateien], [['files'], [['aether-flyer_1.1.zip', 'application/zip']]], 'ZIP: nur files');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#tafel', { state: 'hidden' });
      // „Bild“ (PNG) und „Daten als CSV“ der Seite im Vollbild
      await page.click('#kacheln .kachel[data-id="T1"]');
      await page.waitForSelector('#vollbild:not([hidden])');
      assert.equal(await page.evaluate(() => window.AetherFlyerExport.bildVorbereiten(window.AetherFlyerAnsicht.offenesDokument())), true, 'Bild vorbereitet');
      await page.click('#vbBild');
      g = await geteilt(4);
      assert.deepEqual([g.schluessel, g.dateien], [['files'], [['aether-T1.png', 'image/png']]], 'Bild: nur files');
      await page.click('#vbExport');
      await page.waitForSelector('#tafelInhalt .g-knopf[data-k="csv"]');
      await page.click('#tafelInhalt .g-knopf[data-k="csv"]');
      g = await geteilt(5);
      assert.deepEqual([g.schluessel, g.dateien], [['files'], [['1.1_T1.csv', 'text/csv']]], 'CSV: nur files');
      assert.deepEqual(log.errors, []);
    });
  });

  test('Quelltext der Flyer-Seite: jeder Aufruf von navigator.share übergibt nur files', () => {
    const dateien = fs.readdirSync(H.ROOT).filter((n) => /^flyer.*\.(js|html)$/.test(n));
    const aufrufe = [];
    for (const n of dateien) {
      const t = fs.readFileSync(path.join(H.ROOT, n), 'utf8');
      for (const m of t.matchAll(/navigator\.share\(([^)]*)\)/g)) aufrufe.push([n, m[1].replace(/\s+/g, ' ').trim()]);
    }
    assert.ok(aufrufe.length >= 3, `Aufrufe gefunden (${aufrufe.length})`);
    for (const [n, a] of aufrufe) assert.match(a, /^\{ files: [\w.]+ \}$/, `${n}: navigator.share(${a})`);
  });
});
