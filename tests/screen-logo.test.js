// Tests für „Logo dieses Screens“ im Screen-Editor: jeder Screen kann ein eigenes PNG vom Gerät laden (gespeichert in
// IndexedDB, im Screen nur ein Verweis). Erzeugte Test-PNG (tests/test-png.js) in eindeutigen Farben: Spiel-Logo
// (Mock-API) Cyan, eigene Logos Magenta bzw. Gelb – so lässt sich in Bühne, Vergleich und Bild-Export messen, welches
// Logo gezeichnet ist und mit welchem Seitenverhältnis. Gewartet wird nur auf Seitenzustand.
// Aufruf: node --test tests/screen-logo.test.js
// Gegenproben (müssen rot werden): AETHER_GEGENPROBE=ein-logo|neuladen|gestreckt|leiche node --test tests/screen-logo.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');
const { testLogo } = require('./test-png');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
const BASE = '/repos/konstantin9ezm/aether';
const DB = 'aether.screenEditor.logos';
fs.mkdirSync(OUT, { recursive: true });

const CYAN = [0, 255, 255], MAGENTA = [255, 0, 255], GELB = [255, 255, 0];
const SPIEL = testLogo(1874, 681, CYAN);          // Standard: game/assets/ui/logo.png aus der Mock-API
const EIGEN_A = testLogo(1874, 681, MAGENTA);
const EIGEN_B = testLogo(800, 400, GELB);
const HOCH = testLogo(300, 1200, MAGENTA);         // stark anderes Seitenverhältnis (1 : 4)
const BREIT = testLogo(2000, 100, MAGENTA);        // 20 : 1
const kb = (n) => Math.max(1, Math.round(n / 1024)) + ' KB';

// Gegenproben: der Server liefert eine absichtlich falsche Fassung des Editors aus
const GEGENPROBE = process.env.AETHER_GEGENPROBE || '';
const PATCHES = {
  'ein-logo': [['const l = screen().logo;\n  if (l){ const e = eigeneBilder.get(l.id);', 'const l = state.screens.map(s => s.logo).find(Boolean);\n  if (l){ const e = eigeneBilder.get(l.id);']],
  neuladen: [['if (s.logo !== undefined && !logoVerweisOk(s.logo)) delete s.logo;', 'delete s.logo;']],
  gestreckt: [['object-fit:contain; object-position:50% 50%; pointer-events:none', 'object-fit:fill; object-position:50% 50%; pointer-events:none'],
    ['f = Math.min(w / iw, h / ih), dw = iw * f, dh = ih * f;\n    ctx.drawImage(bild', 'f = 1, dw = w, dh = h;\n    ctx.drawImage(bild']],
  leiche: [['if (weg.length) await logoAblage', 'if (false) await logoAblage']]
};
function editorQuelltext() {
  let s = fs.readFileSync(path.join(ROOT, 'screen-editor.html'), 'utf8');
  for (const [a, b] of PATCHES[GEGENPROBE] || []) { assert.ok(s.includes(a), `Gegenprobe ${GEGENPROBE}: Stelle gefunden`); s = s.replace(a, b); }
  return s;
}
if (GEGENPROBE && !PATCHES[GEGENPROBE]) throw new Error('Unbekannte Gegenprobe: ' + GEGENPROBE);

// ---------------------------------------------------------------------------
// Statischer Server und Mock-API
// ---------------------------------------------------------------------------
const net = { offline: false };
const mock = { mode: 'ok' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
let server, baseUrl, browser;

before(async () => {
  server = http.createServer((req, res) => {
    if (net.offline) { req.socket.destroy(); return; }
    const u = new URL(req.url, 'http://x');
    let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    if (p === 'screen-editor.html') return res.end(editorQuelltext());
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

const CORS = { 'access-control-allow-origin': '*' };
async function githubApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  if (mock.mode === 'offline') return route.abort('internetdisconnected');
  const headers = await req.allHeaders();
  if (headers.authorization !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: '{"message":"Bad credentials"}' });
  if (url.pathname === `${BASE}/contents/game/assets/ui/logo.png` && url.searchParams.get('ref') === 'main') {
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: SPIEL });
  }
  return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"message":"Not Found"}' });
}

// Teilen-Dialog nachgestellt: merkt sich die Dateien als Objekt-URLs, damit der Test ihre Pixel prüfen kann
function shareMock() {
  window.__share = { calls: [] };
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => { window.__share.calls.push(d.files.map((f) => ({ name: f.name, url: URL.createObjectURL(f) }))); };
}

async function newPage(opts = {}) {
  const { viewport = { width: 1280, height: 800 }, init, device = {} } = opts;
  net.offline = false; mock.mode = 'ok';
  const context = await browser.newContext({ viewport, ...device, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const log = { errors: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  await context.addInitScript((t) => { if (window === window.top) localStorage.setItem('aether.githubToken', t); }, TOKEN);
  if (init) await context.addInitScript(init.fn, init.arg);
  await context.route('https://api.github.com/**', githubApi);
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  return { context, page, log };
}
const echteFehler = (log) => log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, ' ').trim());

// Seite bereit: Spiel-Logo entschieden und eigene Logos aus IndexedDB geladen
const bereit = (page) => page.waitForFunction(() => window.AetherScreenEditor && window.AetherScreenEditor.logoBild() !== 'laden' && window.AetherScreenEditor.eigeneLogos() === 'fertig');
async function openEditor(page) { await page.goto(baseUrl + 'screen-editor.html'); await bereit(page); }
// Bild in der Logo-Box und im Vorschaubild geladen und von der Farbe der Erwartung (Quelle des Bildes)
const boxZeigt = (page, sel) => page.waitForFunction((s) => { const i = document.querySelector(s); return !!i && i.complete && i.naturalWidth > 0; }, sel);
async function pngLaden(page, name, buf) {
  const vorher = await page.evaluate(() => JSON.stringify(window.AetherScreenEditor.zustand().screens.map((s) => s.logo || null)));
  await page.setInputFiles('#logoDatei', { name, mimeType: 'image/png', buffer: buf });
  // fertig, wenn sich der Logo-Verweis geändert hat oder eine Meldung steht
  await page.waitForFunction((v) => JSON.stringify(window.AetherScreenEditor.zustand().screens.map((s) => s.logo || null)) !== v || !document.getElementById('logoMeldung').hidden, vorher);
}

// IndexedDB direkt lesen (unabhängig von der Seite): Schlüssel der gespeicherten Bilder
const idbSchluessel = (page) => page.evaluate(async (db) => {
  if (!(await indexedDB.databases()).some((d) => d.name === db)) return [];
  return new Promise((ok, nein) => {
    const r = indexedDB.open(db);
    r.onsuccess = () => { const d = r.result; if (!d.objectStoreNames.contains('logos')) { d.close(); ok([]); return; }
      const q = d.transaction('logos').objectStore('logos').getAllKeys(); q.onsuccess = () => { d.close(); ok(q.result.slice().sort()); }; q.onerror = () => nein(q.error); };
    r.onerror = () => nein(r.error);
  });
}, DB);
// Wartet (über Bilder der Seite, nicht über Wanduhr-Zeit), bis IndexedDB genau diese Schlüssel enthält
async function idbWarten(page, soll, label) {
  let ist;
  for (let i = 0; i < 300; i++) {
    ist = await idbSchluessel(page);
    if (JSON.stringify(ist) === JSON.stringify([...soll].sort())) return ist;
    await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => r())));
  }
  assert.deepEqual(ist, [...soll].sort(), label);
}
const zustand = (page) => page.evaluate(() => window.AetherScreenEditor.zustand());

// Pixel einer Farbe in einem Element (Bildschirmfoto) bzw. in einem Bild (URL): Ausdehnung in Bildpunkten des Elements
async function farbeIn(page, sel, rgb) {
  const el = await page.$(sel);
  await el.scrollIntoViewIfNeeded();
  const r = await el.evaluate((e) => { const b = e.getBoundingClientRect(); return { w: b.width, h: b.height }; });
  const shot = await el.screenshot();
  return page.evaluate(async ({ b64, r, rgb }) => {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height), ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data, k = bmp.width / r.w;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) {
      const i = (y * bmp.width + x) * 4;
      if (Math.abs(d[i] - rgb[0]) < 40 && Math.abs(d[i + 1] - rgb[1]) < 40 && Math.abs(d[i + 2] - rgb[2]) < 40) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (!n) return null;
    return { x0: x0 / k, y0: y0 / k, x1: (x1 + 1) / k, y1: (y1 + 1) / k, w: (x1 + 1 - x0) / k, h: (y1 + 1 - y0) / k, elW: r.w, elH: r.h, n };
  }, { b64: shot.toString('base64'), r, rgb });
}
// Gleiche Messung für ein Canvas (Vergleich) oder eine Bild-URL (Bild-Export)
const farbeImCanvas = (page, sel, rgb) => page.$eval(sel, (cv, rgb) => {
  const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
    const i = (y * cv.width + x) * 4;
    if (Math.abs(d[i] - rgb[0]) < 40 && Math.abs(d[i + 1] - rgb[1]) < 40 && Math.abs(d[i + 2] - rgb[2]) < 40) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return n ? { w: x1 + 1 - x0, h: y1 + 1 - y0, n } : null;
}, rgb);
const farbeImBild = (page, url, rgb) => page.evaluate(async ({ url, rgb }) => {
  const bmp = await createImageBitmap(await (await fetch(url)).blob());
  const cv = new OffscreenCanvas(bmp.width, bmp.height), ctx = cv.getContext('2d');
  ctx.drawImage(bmp, 0, 0);
  const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
  for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) {
    const i = (y * bmp.width + x) * 4;
    if (Math.abs(d[i] - rgb[0]) < 40 && Math.abs(d[i + 1] - rgb[1]) < 40 && Math.abs(d[i + 2] - rgb[2]) < 40) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return n ? { w: x1 + 1 - x0, h: y1 + 1 - y0, n } : null;
}, { url, rgb });
function assertSeiten(m, w, h, label, tol = 0.04) {
  assert.ok(m, `${label}: Bildpixel sichtbar`);
  const soll = w / h, ist = m.w / m.h;
  assert.ok(Math.abs(ist / soll - 1) <= tol, `${label}: Seitenverhältnis ${ist.toFixed(3)} statt ${soll.toFixed(3)} (${m.w.toFixed(1)} × ${m.h.toFixed(1)})`);
}
// Welches Logo zeigt die Logo-Box? 'spiel' (Cyan), 'a' (Magenta), 'b' (Gelb)
async function logoDerBox(page) {
  await boxZeigt(page, '#logoEl img.logoPng');
  const src = await page.$eval('#logoEl img.logoPng', (i) => i.src);
  await page.waitForFunction((s) => { const i = document.querySelector('#logoEl img.logoPng'); return i && i.src === s && i.complete; }, src);
  const t = [['spiel', CYAN], ['a', MAGENTA], ['b', GELB]];
  const da = [];
  for (const [k, rgb] of t) if (await farbeIn(page, '#logoEl', rgb)) da.push(k);
  return da.join('+');
}
async function panelAngaben(page) {
  return { name: await text(page, '#logoName'), masse: await text(page, '#logoMasse'), standardAus: await page.isDisabled('#btnLogoStandard') };
}
const STANDARD = { name: 'Spiel-Logo (Standard)', masse: 'game/assets/ui/logo.png', standardAus: true };
const vergleichMit = async (page, rgb) => {
  if (await page.getAttribute('#untenWahl [data-u="vergleich"]', 'aria-pressed') !== 'true') await page.click('#untenWahl [data-u="vergleich"]');
  await page.waitForFunction((rgb) => { const cv = document.querySelector('#vergleich figure[data-k="desktop"] canvas'); if (!cv.width) return false;
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    for (let i = 0; i < d.length; i += 4) if (Math.abs(d[i] - rgb[0]) < 40 && Math.abs(d[i + 1] - rgb[1]) < 40 && Math.abs(d[i + 2] - rgb[2]) < 40) return true; return false; }, rgb);
};

// ---------------------------------------------------------------------------
describe('Screen-Editor: Logo dieses Screens', () => {
  test('(a) PNG laden: Vorschaubild, Name, Maße, Größe und das Bild in der Logo-Box', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    assert.equal(await text(page, '#logoScreen h2'), 'Logo dieses Screens');
    // Abschnitt direkt unter „Screen“
    assert.equal(await page.evaluate(() => document.getElementById('logoScreen').previousElementSibling.querySelector('h2').textContent), 'Screen');
    assert.equal(await text(page, '#logoScreen .note:not(#logoMeldung)'), 'Das Logo wird mit diesem Screen gespeichert und passt sich unverzerrt in die Logo-Box ein – wie im Spiel.');
    assert.deepEqual(await panelAngaben(page), STANDARD, 'Neu = Spiel-Logo');
    assert.equal(await logoDerBox(page), 'spiel');
    assert.equal(await page.getAttribute('#logoDatei', 'accept'), 'image/png,.png', 'Dateiauswahl nur PNG');
    assert.equal(await text(page, '#btnLogoLaden'), 'PNG laden …');
    // Knopf öffnet die Dateiauswahl
    const [chooser] = await Promise.all([page.waitForEvent('filechooser'), page.click('#btnLogoLaden')]);
    assert.equal(chooser.isMultiple(), false);
    await chooser.setFiles({ name: 'mein-logo.png', mimeType: 'image/png', buffer: EIGEN_A });
    await page.waitForFunction(() => !!window.AetherScreenEditor.zustand().screens[0].logo);
    assert.deepEqual(await panelAngaben(page), { name: 'mein-logo.png', masse: `eigenes PNG · 1874 × 681 px · ${kb(EIGEN_A.length)}`, standardAus: false });
    await boxZeigt(page, '#logoVorschau img');
    assert.ok(await farbeIn(page, '#logoVorschau', MAGENTA), 'Vorschaubild zeigt das PNG');
    assert.equal(await page.$eval('#logoVorschau', (e) => getComputedStyle(e).backgroundColor), 'rgb(3, 4, 10)', 'dunkler Hintergrund');
    assert.equal(await logoDerBox(page), 'a', 'Logo-Box zeigt das eigene PNG');
    assert.ok(await page.isHidden('#logoMeldung'));
    assert.ok(await page.isHidden('#logoHinweis'));
    assert.equal(await page.isDisabled('#btnLogoLaden'), false, 'nach dem Laden wieder bedienbar');
    // Verweis + Metadaten im Screen, Bild in IndexedDB, nicht in localStorage
    const l = (await zustand(page)).screens[0].logo;
    assert.deepEqual(Object.keys(l).sort(), ['art', 'bytes', 'h', 'id', 'name', 'w']);
    assert.deepEqual([l.art, l.name, l.w, l.h, l.bytes], ['eigen', 'mein-logo.png', 1874, 681, EIGEN_A.length]);
    await idbWarten(page, [l.id], 'Bild in IndexedDB');
    const gespeichert = await page.evaluate(() => localStorage.getItem('aether.screenEditor'));
    assert.ok(gespeichert.includes(l.id) && !/iVBORw0|data:image|blob:/.test(gespeichert), 'nur Verweis in localStorage');
    await page.screenshot({ path: path.join(OUT, 'screen-logo-eigen.png') });
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(b) nach Neuladen ist das Logo des Screens noch da', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    await pngLaden(page, 'neu-laden.png', EIGEN_A);
    const id = (await zustand(page)).screens[0].logo.id;
    await page.reload();
    await bereit(page);
    assert.equal((await zustand(page)).screens[0].logo?.id, id, 'Verweis gespeichert');
    assert.deepEqual(await panelAngaben(page), { name: 'neu-laden.png', masse: `eigenes PNG · 1874 × 681 px · ${kb(EIGEN_A.length)}`, standardAus: false });
    assert.equal(await logoDerBox(page), 'a');
    await idbWarten(page, [id], 'Bild noch in IndexedDB');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(c) zwei Screens mit verschiedenen Logos bleiben getrennt (auch nach Neuladen); Neu = Standard', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    await pngLaden(page, 'a.png', EIGEN_A);
    await page.click('#btnNeu');
    assert.deepEqual(await panelAngaben(page), STANDARD, 'neuer Screen: Spiel-Logo');
    assert.equal(await logoDerBox(page), 'spiel');
    await pngLaden(page, 'b.png', EIGEN_B);
    assert.equal(await logoDerBox(page), 'b');
    assert.deepEqual(await panelAngaben(page), { name: 'b.png', masse: `eigenes PNG · 800 × 400 px · ${kb(EIGEN_B.length)}`, standardAus: false });
    // dritter Screen bleibt Standard
    await page.click('#btnNeu');
    assert.equal(await logoDerBox(page), 'spiel');
    const st = await zustand(page);
    const [s1, s2, s3] = st.screens;
    assert.notEqual(s1.logo.id, s2.logo.id);
    assert.equal(s3.logo, undefined);
    for (const runde of ['vorher', 'nach Neuladen']) {
      for (const [s, soll, name] of [[s1, 'a', 'a.png'], [s2, 'b', 'b.png'], [s3, 'spiel', 'Spiel-Logo (Standard)']]) {
        await page.selectOption('#screenSel', s.id);
        assert.equal(await logoDerBox(page), soll, `${runde}: ${s.name}`);
        assert.equal(await text(page, '#logoName'), name, `${runde}: Name ${s.name}`);
        await vergleichMit(page, soll === 'a' ? MAGENTA : soll === 'b' ? GELB : CYAN);
      }
      if (runde === 'vorher') { await page.reload(); await bereit(page); }
    }
    await idbWarten(page, [s1.logo.id, s2.logo.id], 'zwei Bilder');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(d) Kopie übernimmt das Logo des Originals; Löschen eines der beiden lässt das Bild für das andere', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    await pngLaden(page, 'original.png', EIGEN_B);
    const orig = (await zustand(page)).screens[0];
    await page.click('#btnKopie');
    const kopie = (await zustand(page)).screens[1];
    assert.equal(kopie.name, orig.name + ' (Kopie)');
    assert.deepEqual(kopie.logo, orig.logo, 'gleicher Verweis und gleiche Metadaten');
    assert.equal(await logoDerBox(page), 'b');
    assert.deepEqual(await panelAngaben(page), { name: 'original.png', masse: `eigenes PNG · 800 × 400 px · ${kb(EIGEN_B.length)}`, standardAus: false });
    // Original löschen: Kopie zeigt das Bild weiter, Bild bleibt in IndexedDB
    await page.selectOption('#screenSel', orig.id);
    await page.click('#btnScreenWeg');
    await page.click('#mBtns button:has-text("Löschen")');
    await page.waitForFunction(() => window.AetherScreenEditor.zustand().screens.length === 1);
    assert.equal(await logoDerBox(page), 'b');
    await idbWarten(page, [orig.logo.id], 'Bild noch gebraucht');
    // Kopie auf eigenes anderes Logo: Original-Bild wird frei
    await pngLaden(page, 'ersatz.png', EIGEN_A);
    const neu = (await zustand(page)).screens[0].logo.id;
    assert.notEqual(neu, orig.logo.id);
    await idbWarten(page, [neu], 'Ersetzen gibt das alte Bild frei');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(e) „Spiel-Logo verwenden“ setzt auf Standard zurück (und ist bei Standard ausgegraut)', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    assert.equal(await page.isDisabled('#btnLogoStandard'), true);
    await pngLaden(page, 'zurueck.png', EIGEN_A);
    assert.equal(await logoDerBox(page), 'a');
    await page.click('#btnLogoStandard');
    assert.deepEqual(await panelAngaben(page), STANDARD);
    assert.equal(await logoDerBox(page), 'spiel');
    assert.equal((await zustand(page)).screens[0].logo, undefined);
    await page.reload(); await bereit(page);
    assert.equal(await logoDerBox(page), 'spiel', 'bleibt nach Neuladen Standard');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(f) Löschen eines Screens bzw. Zurücksetzen gibt das Bild in IndexedDB frei', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    await pngLaden(page, 'eins.png', EIGEN_A);
    await page.click('#btnNeu');
    await pngLaden(page, 'zwei.png', EIGEN_B);
    const [s1, s2] = (await zustand(page)).screens;
    await idbWarten(page, [s1.logo.id, s2.logo.id], 'beide gespeichert');
    // Screen 2 löschen
    await page.click('#btnScreenWeg');
    await page.click('#mBtns button:has-text("Löschen")');
    await page.waitForFunction(() => window.AetherScreenEditor.zustand().screens.length === 1);
    await idbWarten(page, [s1.logo.id], 'Löschen gibt frei');
    // Screen 1 zurücksetzen
    await page.click('#btnLogoStandard');
    await idbWarten(page, [], 'Zurücksetzen gibt frei');
    // „Alles ersetzen“ per Import gibt ebenfalls frei
    await pngLaden(page, 'drei.png', EIGEN_A);
    const id3 = (await zustand(page)).screens[0].logo.id;
    await idbWarten(page, [id3], 'drittes gespeichert');
    await page.click('#btnText');
    const t = await page.inputValue('#mArea');
    await page.click('#mBtns button:has-text("Schließen")');
    await page.click('#btnImport');
    await page.fill('#mArea', t);
    await page.click('#mBtns button:has-text("Alles ersetzen")');
    await idbWarten(page, [], 'Alles ersetzen gibt frei');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(g) ungültige Datei (kein PNG, zu groß, zu viele Pixel, beschädigt) → Meldung, Screen unverändert', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    const grenzen = await page.evaluate(() => window.AetherScreenEditor.logoGrenzen());
    assert.deepEqual(grenzen, { bytes: 5 * 1024 * 1024, px: 4096 });
    const ihdr = (w, h) => { const b = Buffer.from(testLogo(4, 4)); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
    const gross = Buffer.concat([testLogo(4, 4), Buffer.alloc(grenzen.bytes + 1024 * 1024)]);
    const kaputt = Buffer.concat([testLogo(4, 4).subarray(0, 33), Buffer.from('kein Bildinhalt, nur Text')]);
    const keinIhdr = Buffer.from(testLogo(4, 4)); keinIhdr.write('IHDX', 12, 'ascii');
    const faelle = [
      ['notiz.png', Buffer.from('Das ist Text, kein Bild.'), 'Keine PNG-Datei – Screen unverändert'],
      ['foto.jpg', Buffer.from([0xff, 0xd8, 0xff, 0xe0, ...Buffer.alloc(60)]), 'Keine PNG-Datei – Screen unverändert'],
      ['riesig.png', gross, 'Datei zu groß (6 MB, höchstens 5 MB) – Screen unverändert'],
      ['breit.png', ihdr(5000, 100), 'Bild zu groß (5000 × 100 px, höchstens 4096 px je Seite) – Screen unverändert'],
      ['ohne-ihdr.png', keinIhdr, 'PNG beschädigt (Kopfblock IHDR fehlt) – Screen unverändert'],
      ['kaputt.png', kaputt, 'Das PNG ließ sich nicht öffnen (Datei beschädigt?) – Screen unverändert']
    ];
    for (const ausgang of ['Standard', 'eigenes Logo']) {
      if (ausgang === 'eigenes Logo') { await pngLaden(page, 'gut.png', EIGEN_B); assert.equal(await logoDerBox(page), 'b'); }
      for (const [name, buf, meldung] of faelle) {
        const vorher = await zustand(page), idbVorher = await idbSchluessel(page), panelVorher = await panelAngaben(page);
        await page.setInputFiles('#logoDatei', { name, mimeType: name.endsWith('.jpg') ? 'image/jpeg' : 'image/png', buffer: buf });
        await page.waitForFunction(() => !document.getElementById('logoMeldung').hidden && !document.getElementById('btnLogoLaden').disabled).catch((e) => { throw new Error(name + ': ' + e.message); });
        assert.equal(await text(page, '#logoMeldung'), meldung, `${ausgang}: ${name}`);
        assert.equal(await page.$eval('#logoMeldung', (e) => e.className), 'note', 'Stil der bestehenden Hinweise');
        const nachher = await zustand(page);
        delete vorher.gespeichertUm; delete nachher.gespeichertUm;
        assert.deepEqual(nachher, vorher, `${ausgang}: ${name}: Screen unverändert`);
        assert.deepEqual(await panelAngaben(page), panelVorher);
        assert.deepEqual(await idbSchluessel(page), idbVorher, `${ausgang}: ${name}: nichts in IndexedDB`);
        assert.equal(await logoDerBox(page), ausgang === 'Standard' ? 'spiel' : 'b');
      }
    }
    // Meldung verschwindet beim nächsten gültigen Laden
    await pngLaden(page, 'gut2.png', EIGEN_A);
    assert.ok(await page.isHidden('#logoMeldung'));
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('(h) Seitenverhältnis bleibt erhalten (1 : 4 und 20 : 1): Bühne, Vorschaubild, Vergleich; Box unverändert', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    const box = () => page.evaluate(() => ({ e: window.AetherScreenEditor.elemente('desktop').logo, r: document.getElementById('logoEl').getBoundingClientRect().toJSON() }));
    const bezug = await box();
    for (const [buf, w, h] of [[HOCH, 300, 1200], [BREIT, 2000, 100]]) {
      await pngLaden(page, `${w}x${h}.png`, buf);
      await boxZeigt(page, '#logoEl img.logoPng');
      assert.deepEqual(await box(), bezug, 'Größe und Lage der Logo-Box unverändert');
      const m = await farbeIn(page, '#logoEl', MAGENTA), label = `Bühne ${w}×${h}`;
      assertSeiten(m, w, h, label, 0.06);
      const fuellt = Math.abs(m.w - m.elW) <= 2 || Math.abs(m.h - m.elH) <= 2;
      assert.ok(fuellt, `${label}: so groß wie die Box es zulässt`);
      assert.ok(Math.abs((m.x0 + m.x1) / 2 - m.elW / 2) <= 1.5 && Math.abs((m.y0 + m.y1) / 2 - m.elH / 2) <= 1.5, `${label}: mittig`);
      await boxZeigt(page, '#logoVorschau img');
      assertSeiten(await farbeIn(page, '#logoVorschau', MAGENTA), w, h, `Vorschaubild ${w}×${h}`, 0.12);
      await vergleichMit(page, MAGENTA);
      // auf den neuen Stand des Vergleichs warten (Seitenverhältnis des neuen Bildes)
      await page.waitForFunction(({ w, h }) => { const cv = document.querySelector('#vergleich figure[data-k="desktop"] canvas');
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; let x0 = 1e9, x1 = -1, y0 = 1e9, y1 = -1;
        for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) { const i = (y * cv.width + x) * 4; if (d[i] > 215 && d[i + 1] < 40 && d[i + 2] > 215) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); } }
        return x1 > 0 && Math.abs(((x1 - x0 + 1) / (y1 - y0 + 1)) / (w / h) - 1) < 0.5; }, { w, h });
      assertSeiten(await farbeImCanvas(page, '#vergleich figure[data-k="desktop"] canvas', MAGENTA), w, h, `Vergleich ${w}×${h}`, 0.15);
    }
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(i) „Vergleich“ und „Als Bild sichern“ enthalten das eigene Logo des jeweiligen Screens', async () => {
    const { context, page, log } = await newPage({ init: { fn: shareMock } });
    await openEditor(page);
    await pngLaden(page, 'export.png', EIGEN_A);
    await page.click('#btnNeu');               // zweiter Screen mit Spiel-Logo
    await page.selectOption('#screenSel', (await zustand(page)).screens[0].id);
    await vergleichMit(page, MAGENTA);
    for (const k of ['ultrawide', 'iphone', 'desktop', 'ipad']) {
      assertSeiten(await farbeImCanvas(page, `#vergleich figure[data-k="${k}"] canvas`, MAGENTA), 1874, 681, `Vergleich ${k}`, 0.08);
      assert.equal(await farbeImCanvas(page, `#vergleich figure[data-k="${k}"] canvas`, CYAN), null, `Vergleich ${k}: kein Spiel-Logo`);
    }
    await page.click('#btnBild');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const dateien = await page.evaluate(() => window.__share.calls[0]);
    assert.equal(dateien.length, 4);
    for (const d of dateien) {
      assertSeiten(await farbeImBild(page, d.url, MAGENTA), 1874, 681, `Bild ${d.name}`, 0.02);
      assert.equal(await farbeImBild(page, d.url, CYAN), null, `Bild ${d.name}: kein Spiel-Logo`);
    }
    // Vorschau: „Als Bild sichern“ (ein Format)
    await page.click('#btnVorschau');
    await page.click('#btnBildVorschau');
    await page.waitForFunction(() => window.__share.calls.length === 2);
    const [vd] = await page.evaluate(() => window.__share.calls[1]);
    assertSeiten(await farbeImBild(page, vd.url, MAGENTA), 1874, 681, 'Vorschau-Bild', 0.02);
    await page.click('#fertig');
    // Zweiter Screen: Spiel-Logo im Bild
    await page.selectOption('#screenSel', (await zustand(page)).screens[1].id);
    await page.click('#btnBild');
    await page.waitForFunction(() => window.__share.calls.length === 3);
    for (const d of await page.evaluate(() => window.__share.calls[2])) {
      assert.ok(await farbeImBild(page, d.url, CYAN), `Bild ${d.name}: Spiel-Logo`);
      assert.equal(await farbeImBild(page, d.url, MAGENTA), null, `Bild ${d.name}: kein fremdes Logo`);
    }
    // Export-Text: Verweis mit Dateiname und Maßen, kein Bild; deutlicher Hinweis im Dialog
    await page.selectOption('#screenSel', (await zustand(page)).screens[0].id);
    await page.click('#btnText');
    assert.match(await text(page, '#mText'), /Eigene Logo-Bilder \(1 Screen\) stehen nicht im Text, nur Dateiname und Maße – sie bleiben auf diesem Gerät\./);
    const ex = JSON.parse(await page.inputValue('#mArea'));
    await page.click('#mBtns button:has-text("Schließen")');
    assert.deepEqual(ex.screens[0].logo, { art: 'eigen', datei: 'export.png', breite: 1874, hoehe: 681, bytes: EIGEN_A.length });
    assert.equal(ex.screens[1].logo, undefined, 'Standard ohne Angabe');
    assert.ok(!JSON.stringify(ex).includes('iVBORw0'));
    // Einfügen „Hinzufügen“: nichts geht kaputt, eingefügte Screens nutzen das Spiel-Logo, Hinweis
    await page.click('#btnImport');
    await page.fill('#mArea', JSON.stringify(ex));
    await page.click('#mBtns button:has-text("Hinzufügen")');
    assert.match(await page.textContent('#toast'), /2 Screen\(s\) hinzugefügt – eigene Logo-Bilder sind nicht im Text: dieser Screen zeigt das Spiel-Logo/);
    const st = await zustand(page);
    assert.equal(st.screens.length, 4);
    assert.equal(st.screens[2].logo, undefined);
    assert.equal(st.screens[0].logo.name, 'export.png', 'vorhandener Screen behält sein Logo');
    assert.equal(await logoDerBox(page), 'spiel');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(j) alte Screen-Daten ohne Logo-Angabe laden als Standard (unverändert); unbrauchbare Angabe → Standard', async () => {
    const alt = { version: 3, aktiv: 'alt1', gespeichertUm: 1, screens: [
      { id: 'alt1', name: 'Alt eins', sterne: 4711, asteroiden: [{ id: 'q1', x: 1, y: 2, z: -40, r: 2, form: 3, dreh: 10, kipp: 20, roll: 30, aus: false, farbe: 'rost' }], lage: { logo: { x: 5, y: -3 }, menue: { x: 0, y: 0 } }, zeigeLogo: true, zeigeMenue: true },
      { id: 'alt2', name: 'Alt zwei', sterne: 7, asteroiden: [], lage: { logo: { x: 0, y: 0 }, menue: { x: 0, y: 0 } }, zeigeLogo: true, zeigeMenue: true, logo: { art: 'kaputt' } }
    ] };
    const { context, page, log } = await newPage({ init: { fn: (a) => { if (!sessionStorage.getItem('gesetzt')) { localStorage.setItem('aether.screenEditor', JSON.stringify(a)); sessionStorage.setItem('gesetzt', '1'); } }, arg: alt } });
    await openEditor(page);
    const st = await zustand(page);
    assert.equal(st.screens.length, 2);
    assert.deepEqual(st.screens[0], alt.screens[0], 'Screen ohne Logo-Angabe unverändert');
    assert.equal(st.screens[1].logo, undefined, 'unbrauchbare Angabe → Standard');
    assert.deepEqual(await panelAngaben(page), STANDARD);
    assert.equal(await logoDerBox(page), 'spiel');
    assert.match(await page.textContent('#zaehler'), /1 Asteroid in diesem Screen/);
    assert.ok(await page.isHidden('#logoHinweis'));
    // Verweis auf ein Bild, das es auf dem Gerät nicht gibt: Spiel-Logo mit Hinweis, nichts geht kaputt
    await page.evaluate(() => { const s = JSON.parse(localStorage.getItem('aether.screenEditor')); s.screens[0].logo = { art: 'eigen', id: 'lg-fehltfehlt', name: 'weg.png', w: 10, h: 10, bytes: 100 }; localStorage.setItem('aether.screenEditor', JSON.stringify(s)); });
    await page.reload(); await bereit(page);
    assert.equal(await logoDerBox(page), 'spiel');
    assert.equal(await text(page, '#logoHinweis'), 'Eigenes Logo-Bild fehlt auf diesem Gerät – Spiel-Logo');
    assert.equal(await text(page, '#logoName'), 'weg.png');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(k) offline (App aus dem Service Worker, kein Netz): eigenes PNG sichtbar, Standard-Screen mit Annäherung + Hinweis', async () => {
    const { context, page, log } = await newPage();
    await page.goto(baseUrl);
    await page.evaluate(() => navigator.serviceWorker.ready.then(() => true));
    await openEditor(page);
    await pngLaden(page, 'offline.png', EIGEN_A);
    await page.click('#btnNeu');
    net.offline = true; mock.mode = 'offline';
    await context.setOffline(true);
    await page.reload();
    await bereit(page);
    assert.equal(await page.evaluate(() => window.AetherScreenEditor.logoBild()), 'annaeherung', 'Spiel-Logo offline nicht da');
    // Standard-Screen: Annäherung wie seit PR #26
    assert.equal(await page.$$eval('#logoEl svg', (s) => s.length), 1);
    assert.equal(await text(page, '#logoHinweis'), 'Logo-Bild nicht geladen – Annäherung');
    // Screen mit eigenem PNG: Bild aus IndexedDB, kein Hinweis
    await page.selectOption('#screenSel', (await zustand(page)).screens[0].id);
    assert.equal(await logoDerBox(page), 'a');
    assert.ok(await page.isHidden('#logoHinweis'));
    await boxZeigt(page, '#logoVorschau img');
    assert.ok(await farbeIn(page, '#logoVorschau', MAGENTA));
    await vergleichMit(page, MAGENTA);
    net.offline = false; mock.mode = 'ok';
    await context.setOffline(false);
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('(l) iPhone hochkant: kein waagerechtes Scrollen, Tippflächen ≥ 44 px, langer Dateiname bricht um', async () => {
    for (const viewport of [{ width: 402, height: 874 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
      const { context, page, log } = await newPage({ viewport, device: { deviceScaleFactor: 3, isMobile: true, hasTouch: true } });
      await openEditor(page);
      const label = `${viewport.width}×${viewport.height}`;
      for (const zustandArt of ['Standard', 'eigenes PNG']) {
        if (zustandArt === 'eigenes PNG') await pngLaden(page, 'ein-sehr-langer-dateiname-ohne-leerzeichen-fuer-das-logo-des-startmenues-v12.png', EIGEN_A);
        await page.$eval('#logoScreen', (e) => e.scrollIntoView());
        const m = await page.evaluate(() => {
          const p = document.getElementById('panel'), s = document.getElementById('logoScreen');
          return { sw: document.documentElement.scrollWidth, W: window.innerWidth, panel: p.scrollWidth - p.clientWidth, sek: s.getBoundingClientRect().toJSON(),
            teile: [...s.querySelectorAll('.vorschaubild, .angaben, .note')].map((e) => e.getBoundingClientRect().toJSON()),
            knoepfe: [...s.querySelectorAll('button')].map((e) => e.getBoundingClientRect().toJSON()) };
        });
        assert.ok(m.sw <= m.W, `${label} ${zustandArt}: kein waagerechtes Scrollen (${m.sw} > ${m.W})`);
        assert.ok(m.panel <= 0, `${label} ${zustandArt}: Bedienfeld läuft nicht über`);
        for (const t of m.teile) assert.ok(t.left >= 0 && t.right <= m.sek.right + 0.5, `${label} ${zustandArt}: Inhalt im Abschnitt`);
        assert.equal(m.knoepfe.length, 2);
        for (const k of m.knoepfe) assert.ok(k.width >= 44 && k.height >= 44 && k.right <= m.W + 0.5, `${label}: Tippfläche ${k.width}×${k.height}`);
      }
      assert.equal(await logoDerBox(page), 'a');
      if (viewport.width === 402) await page.screenshot({ path: path.join(OUT, 'screen-logo-iphone-hoch.png') });
      assert.deepEqual(log.errors, []);
      await context.close();
    }
  });

  test('Notiz zu Logo und Menübox stimmt (Logo echt, Menübox angenähert)', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    const t = await text(page, '#notizLogoMenue');
    assert.match(t, /^Das Logo ist echt \(Spiel-Logo oder das eigene PNG dieses Screens\), die Menübox ist angenähert \(Systemschrift\)\./);
    assert.ok(!/Logo und Menübox sind angenähert/.test(await page.textContent('#panel')));
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});
