// Hilfsdatei für die Tests (kein eigener Test): erzeugt echte PNG-Dateien (RGBA, 8 Bit) ohne Abhängigkeiten.
// pngDatei(w, h, farbe) – farbe(x, y) → [r, g, b, a]
'use strict';

const zlib = require('node:zlib');

const CRC_TAB = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TAB[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function block(typ, daten) {
  const len = Buffer.alloc(4); len.writeUInt32BE(daten.length);
  const td = Buffer.concat([Buffer.from(typ, 'ascii'), daten]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function pngDatei(w, h, farbe) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0; // 8 Bit, RGBA
  const roh = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    const z = y * (w * 4 + 1);
    roh[z] = 0;
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = farbe(x, y);
      roh.set([r, g, b, a], z + 1 + x * 4);
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    block('IHDR', ihdr),
    block('IDAT', zlib.deflateSync(roh, { level: 9 })),
    block('IEND', Buffer.alloc(0))
  ]);
}

// Test-Logo: Maße wie das echte game/assets/ui/logo.png (1874 × 681), ganz deckend Magenta, damit sich die
// gezeichnete Fläche (und damit das Seitenverhältnis) im Bild messen lässt; leichtes Rauschen, damit die Datei
// nicht winzig ist.
const MAGENTA = [255, 0, 255];
function testLogo(w = 1874, h = 681, rgb = MAGENTA) {
  return pngDatei(w, h, (x, y) => [rgb[0], rgb[1] ^ (((x * 7 + y * 13) % 5 === 0) ? 1 : 0), rgb[2], 255]);
}

module.exports = { pngDatei, testLogo, MAGENTA };
