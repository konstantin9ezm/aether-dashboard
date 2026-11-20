// F3a h) Darstellung mit dem echten Flyer-Paket – NUR LOKAL. Das Paket ist privat und liegt nie im Repo: Der Test
// läuft nur, wenn FLYER_ECHT=<Pfad zur Paketdatei> gesetzt ist, sonst wird er übersprungen (so auch in der CI).
// Er vergleicht jede Seite, wie der alte Code (Stand vor F3a, Commit FLYER_ALT_COMMIT bzw. das Verzeichnis FLYER_ALT)
// und der neue Code sie darstellen, Pixel für Pixel (nach der Umwandlung v1 → v2), zählt die Grafiken je Seite für den
// Export und misst die Paketgröße (v2 mit 1 und mit 4 Versionen). Ausgegeben werden nur Zahlen und Kennungen
// (S1, IG-Technik-2 …), nie Inhalte; Bilder und die Zusammenfassung landen in FLYER_AUSGABE (Standard: ein
// temporäres Verzeichnis außerhalb des Repos).
// Aufruf: FLYER_ECHT=/pfad/aether-flyer-paket.json node --test tests/flyer-echt.test.js
'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');

const ECHT = process.env.FLYER_ECHT || '';
const ALT_COMMIT = process.env.FLYER_ALT_COMMIT || '3e35c4f';
const ROOT = path.join(__dirname, '..');
const AUSGABE = process.env.FLYER_AUSGABE || path.join(os.tmpdir(), 'aether-flyer-echt');
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.js': 'text/javascript; charset=utf-8', '.woff': 'font/woff', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.svg': 'image/svg+xml', '.png': 'image/png' };

let browser = null;
const server = [];
function dienen(wurzel) {
  return new Promise((resolve) => {
    const s = http.createServer((req, res) => {
      let p = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
      if (!p || p.endsWith('/')) p += 'index.html';
      const f = path.join(wurzel, p);
      if (!f.startsWith(wurzel) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end(); }
      res.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' });
      fs.createReadStream(f).pipe(res);
    });
    server.push(s);
    s.listen(0, '127.0.0.1', () => resolve(`http://localhost:${s.address().port}/`));
  });
}
// Alten Code bereitstellen: FLYER_ALT (Verzeichnis) oder git archive des Commits in ein temporäres Verzeichnis
function alterCode() {
  if (process.env.FLYER_ALT) return path.resolve(process.env.FLYER_ALT);
  const ziel = fs.mkdtempSync(path.join(os.tmpdir(), 'aether-alt-'));
  const tar = path.join(ziel, 'alt.tar');
  execFileSync('git', ['-C', ROOT, 'archive', '--format=tar', '-o', tar, ALT_COMMIT]);
  execFileSync('tar', ['-x', '-f', tar, '-C', ziel]);
  fs.rmSync(tar);
  return ziel;
}

// Jede Seite 1:1 abseits der Oberfläche darstellen (deckend weißer Grund) und als PNG aufnehmen → { id → Buffer }
async function aufnahmen(url) {
  const context = await browser.newContext({ viewport: { width: 1300, height: 1400 }, deviceScaleFactor: 1, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  try {
    const page = await context.newPage();
    const fehler = [];
    page.on('pageerror', (e) => fehler.push(String(e)));
    await context.route('https://api.github.com/**', (r) => r.abort());
    await page.goto(url + 'flyer.html');
    await page.waitForFunction(() => window.AetherFlyer && window.AetherFlyer.bereit);
    await page.evaluate(() => window.AetherFlyer.bereit);
    await page.setInputFiles('#dateiImport', ECHT);
    await page.waitForFunction(() => window.AetherFlyerAnsicht.paket() && document.getElementById('dateiImport').value === '');
    await page.evaluate(() => window.AetherFlyerAnsicht.schriftenBereit());
    const ids = await page.evaluate(() => window.AetherFlyerAnsicht.paket().dokumente.map((d) => d.id));
    const bilder = {};
    for (const id of ids) {
      await page.evaluate(async (id) => {
        const A = window.AetherFlyerAnsicht, dok = A.paket().dokumente.find((d) => d.id === id);
        const alt = document.getElementById('echt-box');
        if (alt) alt.remove();
        const box = document.createElement('div');
        box.id = 'echt-box';
        box.style.cssText = 'position:absolute;left:0;top:0;z-index:99999;background:#ffffff;width:' + dok.breite + 'px';
        document.body.appendChild(box);
        const d = A.darstellen(dok, box, A.optionen(dok, 'bild'));
        await d.fertig;
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      }, id);
      bilder[id] = await page.locator('#echt-box .flyer-host').screenshot({ animations: 'disabled' });
    }
    assert.deepEqual(fehler, []);
    return { ids, bilder };
  } finally {
    await context.close();
  }
}

before(async () => {
  if (!ECHT) return;
  const { chromium } = require('playwright');
  browser = await chromium.launch();
  fs.mkdirSync(AUSGABE, { recursive: true });
});
after(async () => {
  if (browser) await browser.close();
  for (const s of server) await new Promise((r) => s.close(r));
});

test('h) die Original-Seiten des echten Pakets sehen nach der Umwandlung pixelgleich aus wie vorher; Grafiken je Seite; Paketgröße', { skip: !ECHT && 'FLYER_ECHT nicht gesetzt (nur lokal, das echte Paket kommt nie in die CI)' }, async () => {
  const neuUrl = await dienen(ROOT), altUrl = await dienen(alterCode());
  const alt = await aufnahmen(altUrl), neu = await aufnahmen(neuUrl);
  assert.deepEqual(neu.ids, alt.ids, 'dieselben Seiten in derselben Reihenfolge');
  // Pixelvergleich im Browser (dekodierte RGBA-Werte)
  const context = await browser.newContext();
  const page = await context.newPage();
  const ergebnis = [];
  for (const id of alt.ids) {
    const r = await page.evaluate(async ([a, b]) => {
      const lies = async (b64) => {
        const bin = atob(b64), u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
        const c = new OffscreenCanvas(bmp.width, bmp.height), ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        return { w: bmp.width, h: bmp.height, d: ctx.getImageData(0, 0, bmp.width, bmp.height).data };
      };
      const x = await lies(a), y = await lies(b);
      if (x.w !== y.w || x.h !== y.h) return { w: x.w, h: x.h, w2: y.w, h2: y.h, anders: -1 };
      let n = 0;
      for (let i = 0; i < x.d.length; i += 4) if (x.d[i] !== y.d[i] || x.d[i + 1] !== y.d[i + 1] || x.d[i + 2] !== y.d[i + 2] || x.d[i + 3] !== y.d[i + 3]) n++;
      return { w: x.w, h: x.h, anders: n };
    }, [alt.bilder[id].toString('base64'), neu.bilder[id].toString('base64')]);
    ergebnis.push(Object.assign({ id }, r));
    if (r.anders !== 0) {
      fs.writeFileSync(path.join(AUSGABE, id.replace(/[^A-Za-z0-9-]/g, '_') + '-alt.png'), alt.bilder[id]);
      fs.writeFileSync(path.join(AUSGABE, id.replace(/[^A-Za-z0-9-]/g, '_') + '-neu.png'), neu.bilder[id]);
    }
  }
  await context.close();
  // Grafiken je Seite (Export) und Paketgröße – im neuen Code
  const ctx2 = await browser.newContext({ viewport: { width: 1194, height: 834 } });
  const p2 = await ctx2.newPage();
  await ctx2.route('https://api.github.com/**', (r) => r.abort());
  await p2.goto(neuUrl + 'flyer.html');
  await p2.waitForFunction(() => window.AetherFlyer && window.AetherFlyer.bereit);
  await p2.evaluate(() => window.AetherFlyer.bereit);
  await p2.setInputFiles('#dateiImport', ECHT);
  await p2.waitForFunction(() => window.AetherFlyerAnsicht.paket() && document.getElementById('dateiImport').value === '');
  const export_ = await p2.evaluate(async () => {
    const A = window.AetherFlyerAnsicht, GR = window.AetherFlyerGrafik, ST = window.AetherFlyerStruktur, P = window.AetherFlyerPaket;
    const pk = A.paket(), aus = [];
    for (const d of pk.dokumente) {
      const s = await GR.seiteVorbereiten(d, pk.nummer, {});
      aus.push({ id: d.id, n: s.grafiken.length, png: s.grafiken.filter((g) => g.png).length, echt: s.grafiken.filter((g) => g.svgEcht).length, zeilen: s.zeilen.length,
        pngBytes: s.grafiken.reduce((a, g) => a + (g.png ? g.png.length : 0), 0), svgBytes: s.grafiken.reduce((a, g) => a + g.svg.length, 0) });
    }
    const v2 = P.alsV2(window.AetherFlyer.paket());
    const bytes = (x) => new TextEncoder().encode(JSON.stringify(x, null, 2)).length;
    const eins = bytes(v2);
    const vier = JSON.parse(JSON.stringify(v2));
    ST.versionKopieren(vier, '1.1', '1.2'); ST.versionKopieren(vier, '1.1', '1.3'); ST.versionKopieren(vier, '1.1', '2.1');
    return { aus, eins, vier: bytes(vier), html: v2.versionen[0].seiten.every((s, i) => s.html === window.AetherFlyer.paket().dokumente[i].html) };
  });
  await ctx2.close();
  const gleich = ergebnis.filter((r) => r.anders === 0).length;
  const zeilen = [
    `Seiten: ${ergebnis.length}, pixelgleich: ${gleich}`,
    ...ergebnis.filter((r) => r.anders !== 0).map((r) => `  ${r.id}: ${r.anders === -1 ? 'andere Größe' : r.anders + ' Pixel anders'}`),
    `HTML nach der Umwandlung bytegleich: ${export_.html}`,
    `Paket v2 (formatiert wie der Export): 1 Version ${export_.eins} Bytes, 4 Versionen ${export_.vier} Bytes`,
    `Grafiken gesamt: ${export_.aus.reduce((a, x) => a + x.n, 0)} (davon echte SVG ${export_.aus.reduce((a, x) => a + x.echt, 0)})`,
    'Grafiken je Seite: ' + export_.aus.map((x) => `${x.id} ${x.n}`).join(', '),
    `PNG gesamt ${(export_.aus.reduce((a, x) => a + x.pngBytes, 0) / 1048576).toFixed(1)} MB, SVG gesamt ${(export_.aus.reduce((a, x) => a + x.svgBytes, 0) / 1048576).toFixed(1)} MB`
  ];
  fs.writeFileSync(path.join(AUSGABE, 'zusammenfassung.txt'), zeilen.join('\n') + '\n');
  console.log(zeilen.join('\n'));
  assert.ok(export_.html, 'HTML bytegleich');
  assert.ok(export_.aus.every((x) => x.png === x.n), 'jede Grafik als PNG');
  assert.equal(gleich, ergebnis.length, 'alle Seiten pixelgleich');
});
