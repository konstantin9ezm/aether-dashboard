// ZIP ohne Bibliothek für den Export „Grafiken & Daten“ (flyer.html, F3a): Methode „stored“ (ohne Kompression – PNG
// ist schon komprimiert), CRC-32 (IEEE 802.3, Polynom 0xEDB88320), lokale Köpfe, zentrales Verzeichnis und Abschluss
// nach PKWARE APPNOTE 6.3. Nur ASCII-Dateinamen (der Aufrufer sorgt dafür); kein ZIP64 (höchstens 65 535 Dateien und
// 4 GB – weit mehr als ein Flyer-Paket). Reine Funktionen, kein DOM, kein Netz.
// F3b („Alle sichern“ der Bibliothek): crc32 rechnet auch stückweise weiter (zweiter Wert = CRC bis hierher), und
// schreiber.add nimmt einen Blob mit vorher berechneter CRC an ({ crc }) – der Blob bleibt ein Teil der fertigen ZIP
// (new Blob(teile)), sein Inhalt wird dafür nicht noch einmal in den Speicher geholt.
(function () {
  'use strict';

  const TAFEL = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      t[n] = c >>> 0;
    }
    return t;
  })();
  const MAX_DATEIEN = 65535;
  const MAX_BYTES = 0xffffffff;

  // CRC-32 eines Byte-Felds (Uint8Array) → Zahl ohne Vorzeichen; vorher = CRC der Bytes davor (stückweise rechnen)
  function crc32(u8, vorher) {
    let c = typeof vorher === 'number' ? (vorher ^ 0xffffffff) >>> 0 : 0xffffffff;
    for (let i = 0; i < u8.length; i++) c = TAFEL[(c ^ u8[i]) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  }
  function alsBytes(d) {
    if (d instanceof Uint8Array) return d;
    if (d instanceof ArrayBuffer) return new Uint8Array(d);
    if (typeof d === 'string') return new TextEncoder().encode(d);
    throw new Error('ZIP: Daten müssen Uint8Array, ArrayBuffer oder Text sein.');
  }
  // DOS-Zeit und -Datum (Ortszeit), Jahre 1980–2107
  function dosZeit(d) {
    const j = Math.min(2107, Math.max(1980, d.getFullYear()));
    return { zeit: (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), datum: ((j - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
  }

  // Schreiber für viele oder große Dateien: add(name, daten) hängt eine Datei an (die Teile bleiben einzeln, bis sie als
  // Blob zusammenkommen – so wird nichts doppelt im Speicher gehalten), teile() gibt alle Teile samt Verzeichnis zurück.
  function schreiber(zeit) {
    const t = dosZeit(zeit instanceof Date ? zeit : new Date());
    const namen = new Set();
    const teile = [], zentral = [];
    let pos = 0, anzahl = 0;
    function add(nameRoh, daten, opt) {
      if (anzahl >= MAX_DATEIEN) throw new Error('ZIP: zu viele Dateien.');
      const d = { name: nameRoh, daten: daten };
      const istBlob = typeof Blob === 'function' && daten instanceof Blob;
      if (istBlob && !(opt && typeof opt.crc === 'number')) throw new Error('ZIP: Blob nur mit vorher berechneter CRC.');
      const name = String(d.name);
      if (!/^[\x20-\x7e]+$/.test(name) || /^[/\\]|\.\.|\\/.test(name)) throw new Error('ZIP: Dateiname nur ASCII, ohne „..“ und Backslash: ' + name);
      if (namen.has(name)) throw new Error('ZIP: Dateiname doppelt: ' + name);
      namen.add(name);
      const n = new TextEncoder().encode(name), b = istBlob ? d.daten : alsBytes(d.daten), crc = istBlob ? opt.crc >>> 0 : crc32(b);
      const laenge = istBlob ? b.size : b.length;
      if (laenge > MAX_BYTES || pos > MAX_BYTES) throw new Error('ZIP: zu groß (ohne ZIP64 höchstens 4 GB).');
      const kopf = new DataView(new ArrayBuffer(30));
      kopf.setUint32(0, 0x04034b50, true);   // lokaler Kopf
      kopf.setUint16(4, 10, true);           // benötigte Version 1.0 (stored)
      kopf.setUint16(6, 0, true);            // Flags
      kopf.setUint16(8, 0, true);            // Methode 0 = stored
      kopf.setUint16(10, t.zeit, true);
      kopf.setUint16(12, t.datum, true);
      kopf.setUint32(14, crc, true);
      kopf.setUint32(18, laenge, true);    // komprimiert = unkomprimiert
      kopf.setUint32(22, laenge, true);
      kopf.setUint16(26, n.length, true);
      kopf.setUint16(28, 0, true);
      teile.push(new Uint8Array(kopf.buffer), n, b);
      const z = new DataView(new ArrayBuffer(46));
      z.setUint32(0, 0x02014b50, true);      // Eintrag im zentralen Verzeichnis
      z.setUint16(4, 20, true);              // erstellt mit 2.0
      z.setUint16(6, 10, true);
      z.setUint16(8, 0, true);
      z.setUint16(10, 0, true);
      z.setUint16(12, t.zeit, true);
      z.setUint16(14, t.datum, true);
      z.setUint32(16, crc, true);
      z.setUint32(20, laenge, true);
      z.setUint32(24, laenge, true);
      z.setUint16(28, n.length, true);
      z.setUint16(30, 0, true);
      z.setUint16(32, 0, true);
      z.setUint16(34, 0, true);
      z.setUint16(36, 0, true);
      z.setUint32(38, 0, true);
      z.setUint32(42, pos, true);            // Lage des lokalen Kopfs
      zentral.push(new Uint8Array(z.buffer), n);
      pos += 30 + n.length + laenge;
      anzahl++;
    }
    function alleTeile() {
      if (!anzahl) throw new Error('ZIP: keine Dateien.');
      const zGroesse = zentral.reduce((s, x) => s + x.length, 0);
      const ende = new DataView(new ArrayBuffer(22));
      ende.setUint32(0, 0x06054b50, true);   // Ende des zentralen Verzeichnisses
      ende.setUint16(8, anzahl, true);
      ende.setUint16(10, anzahl, true);
      ende.setUint32(12, zGroesse, true);
      ende.setUint32(16, pos, true);
      return teile.concat(zentral, [new Uint8Array(ende.buffer)]);
    }
    return { add: add, teile: alleTeile, anzahl: () => anzahl, bytes: () => pos };
  }

  // dateien = [{ name: 'a.png', daten: Uint8Array|ArrayBuffer|Text }], zeit = Date (Standard: jetzt) → Uint8Array
  function zip(dateien, zeit) {
    if (!Array.isArray(dateien) || !dateien.length) throw new Error('ZIP: keine Dateien.');
    if (dateien.length > MAX_DATEIEN) throw new Error('ZIP: zu viele Dateien.');
    const sch = schreiber(zeit);
    for (const d of dateien) sch.add(d.name, d.daten);
    const alle = sch.teile();
    const aus = new Uint8Array(alle.reduce((s, x) => s + x.length, 0));
    let o = 0;
    for (const x of alle) { aus.set(x, o); o += x.length; }
    return aus;
  }

  window.AetherFlyerZip = Object.freeze({ crc32: crc32, zip: zip, schreiber: schreiber });
})();
