// Flyer-Export in einer echten WebKit-Engine – NUR LOKAL. Der Fehler vom Gerätetest (iPad, 24.11.2026: Seite im
// PowerPoint-Bild nur einfach groß oben links, PNG-/SVG-Ausschnitte falsch) entsteht nur in WebKit: Es wendet Maßstab
// und Verschiebung einer viewBox nicht auf HTML im foreignObject an, das eine eigene Ebene hat. Chromium (CI) zeigt
// ihn nicht; dort sichert tests/flyer-export-dichte.test.js den Aufbau des SVG-Bildes. Dieser Test prüft dasselbe mit
// Pixeln in WebKitGTK (gleiche Zeichen-Engine wie Safari) über dessen WebDriver und läuft nur, wenn
// AETHER_WEBKIT_DRIVER=<Pfad zu WebKitWebDriver> gesetzt ist – sonst wird er übersprungen (so auch in der CI).
// Einrichten (Ubuntu): apt-get install webkit2gtk-driver xvfb
// Aufruf: AETHER_WEBKIT_DRIVER=/usr/bin/WebKitWebDriver node --test tests/flyer-export-webkit.test.js
// Pixeldichte: GDK_SCALE=1 und 2 (devicePixelRatio 1 und 2; mehr kann der Bildschirm-Ersatz Xvfb hier nicht).
// Nur die künstliche Testseite (tests/flyer-testseite.js), kein echter Flyer-Inhalt.
'use strict';

const { test, before, after } = require('node:test');
const http = require('node:http');
const { spawn } = require('node:child_process');
const H = require('./flyer-hilfe');
const { assert } = H;
const { BREITE, HOEHE, FAKTOR, GRUND, FARBEN, KASTEN, LINIE_X, paket } = require('./flyer-testseite');

const TREIBER = process.env.AETHER_WEBKIT_DRIVER || '';

before(async () => { if (TREIBER) await H.starte(); });
after(async () => { if (TREIBER) await H.beende(); });

/* ---------- Kleiner WebDriver-Client (W3C WebDriver über HTTP) ---------- */
function anfrage(port, methode, pfad, inhalt) {
  return new Promise((ok, nein) => {
    const daten = inhalt === undefined ? null : Buffer.from(JSON.stringify(inhalt));
    const r = http.request({ host: '127.0.0.1', port, path: pfad, method: methode, headers: daten ? { 'content-type': 'application/json', 'content-length': daten.length } : {} }, (a) => {
      const t = [];
      a.on('data', (c) => t.push(c));
      a.on('end', () => { const s = Buffer.concat(t).toString('utf8'); try { ok(JSON.parse(s)); } catch (e) { nein(new Error('WebDriver: ' + s.slice(0, 300))); } });
    });
    r.on('error', nein);
    if (daten) r.write(daten);
    r.end();
  });
}
async function webkit(dichte) {
  const port = 4600 + Math.floor(Math.random() * 300);
  const env = Object.assign({}, process.env, { GDK_SCALE: String(dichte), WEBKIT_DISABLE_SANDBOX_THIS_IS_DANGEROUS: '1', NO_AT_BRIDGE: '1' });
  for (const k of Object.keys(env)) if (/_proxy$/i.test(k)) delete env[k];   // nur localhost
  const ohneBildschirm = !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY;
  const p = ohneBildschirm
    ? spawn('xvfb-run', ['-a', TREIBER, '--port=' + port], { env, stdio: 'ignore', detached: true })
    : spawn(TREIBER, ['--port=' + port], { env, stdio: 'ignore', detached: true });
  const stopp = () => { try { process.kill(-p.pid, 'SIGTERM'); } catch (e) { /* schon beendet */ } };
  try {
    let da = false;
    for (let i = 0; i < 75 && !da; i++) { await new Promise((r) => setTimeout(r, 200)); try { await anfrage(port, 'GET', '/status'); da = true; } catch (e) { /* noch nicht */ } }
    assert.ok(da, 'WebKitWebDriver antwortet');
    const s = await anfrage(port, 'POST', '/session', { capabilities: { alwaysMatch: { 'webkitgtk:browserOptions': { args: ['--automation'] } } } });
    assert.ok(s.value && s.value.sessionId, 'WebDriver-Sitzung: ' + JSON.stringify(s).slice(0, 300));
    const b = '/session/' + s.value.sessionId;
    await anfrage(port, 'POST', b + '/timeouts', { script: 120000, pageLoad: 60000 });
    return {
      oeffne: (url) => anfrage(port, 'POST', b + '/url', { url }),
      // fn: async-Funktion, läuft auf der Seite; Ergebnis bzw. Fehler kommen zurück
      fuehreAus: async (fn, ...args) => {
        const script = 'const fertig = arguments[arguments.length - 1]; (' + fn.toString() + ').apply(null, Array.prototype.slice.call(arguments, 0, -1))' +
          '.then((v) => fertig({ ok: v }), (e) => fertig({ fehler: String((e && e.stack) || e) }));';
        const r = await anfrage(port, 'POST', b + '/execute/async', { script, args });
        if (!r.value || !('ok' in r.value)) throw new Error('Auf der Seite: ' + JSON.stringify(r.value).slice(0, 600));
        return r.value.ok;
      },
      ende: async () => { try { await anfrage(port, 'DELETE', b); } catch (e) { /* egal */ } stopp(); }
    };
  } catch (e) { stopp(); throw e; }
}

/* ---------- Auf der Seite: Testpaket importieren, exportieren, Pixel lesen ---------- */
async function messung(pk, farben, tol, linieX) {
  const warte = (ms) => new Promise((r) => setTimeout(r, ms));
  for (let i = 0; i < 150 && !(window.AetherFlyer && window.AetherFlyer.bereit); i++) await warte(100);
  await window.AetherFlyer.bereit;
  const eingabe = document.getElementById('dateiImport');
  const dt = new DataTransfer();
  dt.items.add(new File([JSON.stringify(pk)], 'aether-flyer-paket.json', { type: 'application/json' }));
  eingabe.files = dt.files;
  eingabe.dispatchEvent(new Event('change', { bubbles: true }));
  const dokument = () => { const p = window.AetherFlyerAnsicht.paket(); return p ? p.dokumente.find((d) => d.id === 'T1') : null; };
  for (let i = 0; i < 150 && !dokument(); i++) await warte(100);
  await window.AetherFlyerAnsicht.schriftenBereit();
  const probe = await window.AetherFlyerExport.einrichten();
  const dok = dokument();
  // Flächen (umschließendes Rechteck je Farbe) und einzelne Pixel eines Canvas
  function lesen(cv, punkte) {
    const w = cv.width, h = cv.height, d = cv.getContext('2d').getImageData(0, 0, w, h).data, flaechen = {};
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
    return { w, h, flaechen, punkte: (punkte || []).map(([x, y]) => Array.from(d.slice((y * w + x) * 4, (y * w + x) * 4 + 4))) };
  }
  async function bild(url, zielW, zielH) {
    const img = new Image();
    await new Promise((ok, nein) => { img.onload = ok; img.onerror = () => nein(new Error('Bild nicht lesbar')); img.src = url; });
    try { await img.decode(); } catch (e) { /* Safari: decode von SVG kann ablehnen */ }
    const cv = document.createElement('canvas');
    cv.width = zielW || img.naturalWidth; cv.height = zielH || img.naturalHeight;
    const ctx = cv.getContext('2d');
    for (let i = 0; i < 3; i++) { ctx.clearRect(0, 0, cv.width, cv.height); ctx.drawImage(img, 0, 0, cv.width, cv.height); await warte(150); }   // WebKit: erst nach dem ersten Zeichnen sicher da
    return cv;
  }
  const b64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); };
  // Seitenbild wie für die PowerPoint-Folie (flyer-pptx.js folienBild: Grund in Seitenfarbe, dann das Bild in Zielgröße)
  const sb = await window.AetherFlyerExport.seitenBild(dok);
  if (!sb.img) return { probe, fehler: String(sb.bildFehler) };
  const cv = document.createElement('canvas');
  cv.width = sb.w; cv.height = sb.h;
  const ctx = cv.getContext('2d');
  ctx.fillStyle = '#0c0f1d';
  ctx.fillRect(0, 0, sb.w, sb.h);
  ctx.drawImage(sb.img, 0, 0, sb.w, sb.h);
  const seite = lesen(cv, [[397, 400], [1191, 400], [397, 1800], [1191, 1800]]);
  // „Grafiken & Daten“: PNG und SVG des Kastens
  const s = await window.AetherFlyerGrafik.seiteVorbereiten(dok, '1.1', {});
  const g = s.grafiken.find((x) => x.art === 'kasten');
  const x2 = linieX * 2;
  const png = g.png ? lesen(await bild('data:image/png;base64,' + b64(g.png)), [[100, 300], [x2 - 1, 200], [x2, 200], [x2 + 1, 200], [x2 + 2, 200]]) : null;
  const svg = lesen(await bild('data:image/svg+xml;base64,' + b64(new TextEncoder().encode(g.svg))), [[50, 150]]);
  return { probe, dpr: window.devicePixelRatio, engine: navigator.userAgent, seite, png, svg, namen: s.grafiken.map((x) => x.namen.png) };
}

function liegtBei(a, name, x, y, b, h, f, wo) {
  const fl = a.flaechen[name];
  assert.ok(fl, `${wo}: Marke ${name} im Bild vorhanden`);
  const soll = { x0: x * f, y0: y * f, x1: (x + b) * f - 1, y1: (y + h) * f - 1 };
  for (const k of ['x0', 'y0', 'x1', 'y1']) assert.ok(Math.abs(fl[k] - soll[k]) <= 2, `${wo}: Marke ${name} ${k} = ${fl[k]}, erwartet ${soll[k]} (± 2 px)`);
}
const nahe = (ist, soll, wo, tol = 4) => soll.forEach((v, i) => assert.ok(Math.abs(ist[i] - v) <= tol, `${wo}: Pixel ${ist} ≈ ${soll}`));

for (const dichte of [1, 2]) {
  test(`WebKit, Pixeldichte ${dichte}: Seitenbild randgenau (alle vier Ecken), Kasten als PNG und SVG zeigt genau den Kasten`,
    { skip: !TREIBER && 'AETHER_WEBKIT_DRIVER nicht gesetzt (nur lokal: WebKitGTK mit WebKitWebDriver)' }, async () => {
      const w = await webkit(dichte);
      let r;
      try {
        await w.oeffne(H.flyerUrl());
        r = await w.fuehreAus(messung, paket(), FARBEN, 4, LINIE_X);
      } finally { await w.ende(); }
      assert.equal(r.fehler, undefined, 'Seitenbild erzeugt');
      assert.equal(r.probe, true, 'Selbstprobe von „Bild“ bestanden');
      assert.equal(r.dpr, dichte, 'Pixeldichte');
      assert.match(r.engine, /AppleWebKit/);
      console.log(`  WebKit (${r.engine.replace(/^.*(AppleWebKit\/[\d.]+).*$/, '$1')}), devicePixelRatio ${r.dpr}: Seitenbild ${r.seite.w} × ${r.seite.h}, Marke unten rechts bis ` +
        `${r.seite.flaechen.gelb ? r.seite.flaechen.gelb.x1 + '/' + r.seite.flaechen.gelb.y1 : '– (fehlt)'}`);
      // Teil 1: ganze Seite, randgenau
      assert.deepEqual([r.seite.w, r.seite.h], [BREITE * FAKTOR, HOEHE * FAKTOR], 'Bildgröße');
      liegtBei(r.seite, 'rot', 0, 0, 40, 40, FAKTOR, 'Seite oben links');
      liegtBei(r.seite, 'gruen', BREITE - 40, 0, 40, 40, FAKTOR, 'Seite oben rechts');
      liegtBei(r.seite, 'blau', 0, HOEHE - 40, 40, 40, FAKTOR, 'Seite unten links');
      liegtBei(r.seite, 'gelb', BREITE - 40, HOEHE - 40, 40, 40, FAKTOR, 'Seite unten rechts');
      liegtBei(r.seite, 'magenta', KASTEN.x, KASTEN.y, 20, 20, FAKTOR, 'Seite: Kasten oben links');
      liegtBei(r.seite, 'cyan', KASTEN.x + KASTEN.w - 20, KASTEN.y + KASTEN.h - 20, 20, 20, FAKTOR, 'Seite: Kasten unten rechts');
      r.seite.punkte.forEach((p, i) => nahe(p, [...GRUND, 255], `Seitenhintergrund in Viertel ${i + 1}`));
      // Teil 2: PNG und SVG des Kastens
      assert.deepEqual(r.namen, ['1.1_T1_01_symbol.png', '1.1_T1_02_kasten.png']);
      assert.ok(r.png, 'Kasten-PNG erzeugt');
      assert.deepEqual([r.png.w, r.png.h], [KASTEN.w * FAKTOR, KASTEN.h * FAKTOR], 'Kasten-PNG: Größe = Element × 2');
      liegtBei(r.png, 'magenta', 0, 0, 20, 20, FAKTOR, 'Kasten-PNG oben links');
      liegtBei(r.png, 'cyan', KASTEN.w - 20, KASTEN.h - 20, 20, 20, FAKTOR, 'Kasten-PNG unten rechts');
      assert.equal(r.png.flaechen.rot, null, 'Kasten-PNG: nicht die Ecke der Seite');
      nahe(r.png.punkte[0], [128, 128, 128, 255], 'Kasten-PNG: Fläche des Kastens');
      nahe(r.png.punkte[1], [128, 128, 128, 255], 'Kasten-PNG: links neben der Linie (scharf)');
      nahe(r.png.punkte[2], [255, 255, 255, 255], 'Kasten-PNG: Linie, erste Spalte');
      nahe(r.png.punkte[3], [255, 255, 255, 255], 'Kasten-PNG: Linie, zweite Spalte');
      nahe(r.png.punkte[4], [128, 128, 128, 255], 'Kasten-PNG: rechts neben der Linie (scharf)');
      assert.deepEqual([r.svg.w, r.svg.h], [KASTEN.w, KASTEN.h], 'Kasten-SVG: Größe = Element');
      liegtBei(r.svg, 'magenta', 0, 0, 20, 20, 1, 'Kasten-SVG oben links');
      liegtBei(r.svg, 'cyan', KASTEN.w - 20, KASTEN.h - 20, 20, 20, 1, 'Kasten-SVG unten rechts');
      assert.equal(r.svg.flaechen.rot, null, 'Kasten-SVG: nicht die Ecke der Seite');
      nahe(r.svg.punkte[0], [128, 128, 128, 255], 'Kasten-SVG: Fläche des Kastens');
    });
}
