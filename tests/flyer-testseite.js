// Hilfsdatei (kein eigener Test): künstliche Testseite für die Prüfungen des Flyer-Exports (tests/flyer-export-dichte.test.js,
// tests/flyer-export-webkit.test.js). Eine Flyer-Seite 794 × 1123 px mit farbigen Marken in den vier Ecken, einem Symbol
// (SVG) und einem „Testkasten“ mit Marken in seinen Ecken und einer 1 px breiten Linie – nur einfache Formen, kein echter
// Flyer-Inhalt. Seite und Kasten haben wie echte Flyer-Seiten eine eigene Ebene (position, overflow:hidden).
'use strict';

const BREITE = 794, HOEHE = 1123, FAKTOR = 2;   // Seite in CSS-Pixeln; Bild in doppelter Auflösung (1588 × 2246)
const GRUND = [0x20, 0x40, 0x60];
const FARBEN = {
  rot: [255, 0, 0], gruen: [0, 255, 0], blau: [0, 0, 255], gelb: [255, 255, 0],   // Ecken der Seite, je 40 × 40
  magenta: [255, 0, 255], cyan: [0, 255, 255],                                     // Ecken des Kastens, je 20 × 20
  lila: [128, 0, 128], petrol: [0, 128, 128]                                       // Ecken des Symbols, je 12 × 12
};
const KASTEN = { x: 200, y: 300, w: 300, h: 200 };
const SYMBOL = { x: 600, y: 150, w: 48, h: 48 };
const LINIE_X = 150;   // 1 CSS-Pixel breite weiße Linie im Kasten (Schärfe: im Bild genau 2 Pixel)
const CSS = [
  '.page{--s:1;width:794px;height:1123px;position:relative;overflow:hidden;background:#204060;color:#ffffff;font-family:sans-serif}',
  '.m{position:absolute;width:40px;height:40px}',
  '.sym{position:absolute;left:600px;top:150px;width:48px;height:48px}',
  '.blk{position:absolute;left:200px;top:300px;width:300px;height:200px;box-sizing:border-box;overflow:hidden;background:#808080}',
  '.k{position:absolute;width:20px;height:20px}',
  '.linie{position:absolute;left:150px;top:40px;width:1px;height:120px;background:#ffffff}',
  '.blk p{position:absolute;left:170px;top:80px;margin:0;font-size:18px}'
].join('\n');
const HTML = '<section class="page" data-id="T1" style="--s:1">' +
  '<i class="m" style="left:0;top:0;background:#ff0000"></i><i class="m" style="right:0;top:0;background:#00ff00"></i>' +
  '<i class="m" style="left:0;bottom:0;background:#0000ff"></i><i class="m" style="right:0;bottom:0;background:#ffff00"></i>' +
  '<svg class="sym" viewBox="0 0 48 48"><rect width="48" height="48" fill="#ff8000"></rect><rect width="12" height="12" fill="#800080"></rect>' +
  '<rect x="36" y="36" width="12" height="12" fill="#008080"></rect></svg>' +
  '<div class="blk"><i class="k" style="left:0;top:0;background:#ff00ff"></i><i class="k" style="right:0;bottom:0;background:#00ffff"></i>' +
  '<i class="linie"></i><p data-t="t1">Testkasten</p></div>' +
  '</section>';
function paket() {
  return {
    format: 'aether-flyer-paket', formatVersion: 1, titel: 'Testpaket', version: '2020-02-01.1', stand: '2020-02-01',
    css: { flyer: CSS, infografik: '' },
    kategorien: [{ id: 'test', name: 'Test' }],
    dokumente: [{ id: 'T1', art: 'flyer', kategorie: 'test', titel: 'Testseite', breite: BREITE, hoehe: HOEHE, html: HTML }]
  };
}

module.exports = { BREITE, HOEHE, FAKTOR, GRUND, FARBEN, KASTEN, SYMBOL, LINIE_X, CSS, HTML, paket };
