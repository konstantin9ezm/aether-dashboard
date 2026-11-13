// Tests für den Logo-Editor Stufe 2 (Reiter „Ring“ in logo.html): Ring nach der Rechnung des Spiels
// (game/src/Logo.cpp) per Regler – Standardwerte ergeben die Referenz-Brocken (eigene, hier festgehaltene Werte),
// „Wie im Spiel“, jeder Regler ändert den Ring, Obergrenze der Anzahl, Zufallswert-Feld (Backspace), Projekt
// Version 2 (Rundlauf) und Version 1 (lädt mit Spielwerten), SVG/PNG mit Ring, Speicherung, offline, 4 API-Anfragen,
// kein Token.
// Aufruf: node --test tests/logo-ring.test.js
// Gegenproben (müssen rot werden): AETHER_GEGENPROBE=referenz|version1 node --test tests/logo-ring.test.js
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
const COMMIT = '1234567abcdef0123456789abcdef0123456789a';
const PNG_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Gegenproben: Stellen in logo.html, die der Testserver beim Ausliefern ersetzt
// ---------------------------------------------------------------------------
const GEGENPROBE = process.env.AETHER_GEGENPROBE || '';
const PATCHES = {
  // a) Standardwerte weichen von der Referenz ab (Kopf 2,25 → 2,3 rad)
  referenz: [['kopf:2.25, schweif:5.85', 'kopf:2.3, schweif:5.85']],
  // g) Projekt der Version 1 lässt sich nicht mehr laden
  version1: [['if (o.version !== 1 && o.version !== PROJEKT_VERSION)', 'if (o.version !== PROJEKT_VERSION)']]
};
if (GEGENPROBE && !PATCHES[GEGENPROBE]) throw new Error('Unbekannte Gegenprobe: ' + GEGENPROBE);
function logoHtml() {
  let s = fs.readFileSync(path.join(ROOT, 'logo.html'), 'utf8');
  for (const [a, b] of PATCHES[GEGENPROBE] || []) { assert.ok(s.includes(a), `Gegenprobe ${GEGENPROBE}: Stelle gefunden`); s = s.replace(a, b); }
  return s;
}

// ---------------------------------------------------------------------------
// Referenz: Brocken des Spiel-Logos bei den Spielwerten, Schriftgröße 100, Mitte (0, 0). Festgehalten aus der Rechnung
// in game/src/Logo.cpp (Repo aether, Stand b151e26) und lokal mit art/logo/logo.svg abgeglichen (dort um die Mitte
// (187,5 | 68,5) verschoben); die Datei selbst liegt nicht in diesem Repo.
// [Nummer, Mitte, Farbe, Facettenfarbe, Umriss]
// ---------------------------------------------------------------------------
const REFERENZ = [
  [0, '1.806,-31.716', '#6D6680', '#AAA5BC', '1.441,-29.924 -0.131,-30.928 0.557,-32.553 1.807,-33.543 3.296,-32.261 3.37,-30.968'],
  [1, '-39.034,-17.762', '#645D75', '#A19CB2', '-37.925,-18.574 -37.269,-17.899 -37.941,-16.746 -39.187,-16.041 -40.14,-16.89 -40.806,-17.746 -40.108,-18.88 -39.204,-19.468'],
  [2, '25.572,-38.241', '#585267', '#9590A5', '25.006,-37.016 23.767,-37.508 23.932,-39.101 25.695,-39.941 26.827,-39.166 26.974,-38.09 26.224,-36.966'],
  [48, '173.032,-48.185', '#5F5970', '#9C97AD', '177.073,-48.219 175.412,-46.214 172.112,-45.542 170.124,-46.723 169.541,-49.633 172.311,-51.082 175.815,-50.91'],
  [49, '172.608,-47.502', '#766E8A', '#B4AEC7', '175.93,-47.303 174.766,-45.436 172.237,-44.912 169.735,-45.594 169.085,-47.917 170.565,-49.881 173.095,-50.269 174.704,-48.593'],
  [50, '171.987,-46.405', '#8C83A4', '#CAC4E0', '173.402,-47.428 173.91,-45.893 171.903,-44.271 169.713,-45.207 169.605,-47.414 171.754,-48.062'],
  [148, '3.601,24.879', '#766E8A', '#B4AEC7', '3.558,20.421 7.811,23.166 8.789,26.8 3.004,29.091 -0.143,27.382 -1.259,22.004'],
  [149, '4.671,28.99', '#7E7694', '#BDB7D1', '3.708,32.812 -0.146,31.748 0.795,27.789 2.22,25.092 6.746,25.012 9.402,27.188 10.269,29.801 6.6,33.05']
];
const SPIEL = { neigung: 0.27, breite: 1.78, hoehe: 0.3, anzahl: 150, groesseMin: 0.011, groesseMax: 0.075, kopf: 2.25, schweif: 5.85, dichte: 2.3, zufall: 0x9E3779B9 };

// Test-SVG der Arbeitsdatei (wie in logo-editor.test.js)
const SVG = Buffer.from([
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">',
  '  <g id="ring-hinten"><rect x="10" y="60" width="60" height="80" fill="#ff0000"/></g>',
  '  <g id="schatten"><rect x="120" y="60" width="60" height="80" fill="#00ff00"/></g>',
  '  <g id="schrift"><rect x="200" y="70" width="40" height="60" fill="#0000ff"/></g>',
  '  <g id="ring-vorne"><rect x="320" y="60" width="60" height="80" fill="#ffff00"/></g>',
  '</svg>', ''].join('\n'), 'utf8');
const PNG = testLogo();

// ---------------------------------------------------------------------------
// Server (kann „kein Netz“ spielen) und Mock-API
// ---------------------------------------------------------------------------
const net = { offline: false };
const mock = { mode: 'ok', requests: [] };
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.ttf': 'font/ttf' };
let server, baseUrl, browser;
before(async () => {
  server = http.createServer((req, res) => {
    if (net.offline) { req.socket.destroy(); return; }
    const u = new URL(req.url, 'http://x');
    let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    if (p === 'logo.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(logoHtml()); }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
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
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  mock.requests.push({ path: url.pathname, query: url.search, auth: headers.authorization || null });
  if (mock.mode === 'offline') return route.abort('internetdisconnected');
  if (headers.authorization !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: '{"message":"Bad credentials"}' });
  const p = url.searchParams.get('path');
  if (url.pathname === `${BASE}/contents/art/logo/logo.svg`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: SVG });
  if (url.pathname === `${BASE}/contents/game/assets/ui/logo.png`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: PNG });
  if (url.pathname === `${BASE}/commits` && p === 'art/logo/logo.svg') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ sha: COMMIT }]) });
  if (url.pathname === `${BASE}/commits` && p === 'game/assets/ui/logo.png') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ sha: PNG_COMMIT }]) });
  if (url.pathname === `${BASE}/contents/index.json`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: '[]' });
  return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"message":"Not Found"}' });
}

// Teilen-Dialog nachgebaut: hält Name, Typ, Text bzw. PNG-Maße und Pixelproben fest
function shareMock() {
  window.__share = { calls: [] };
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    const files = await Promise.all(d.files.map(async (f) => {
      const buf = await f.arrayBuffer();
      const out = { name: f.name, type: f.type, bytes: buf.byteLength };
      if (f.type === 'image/png') {
        const v = new DataView(buf); out.w = v.getUint32(16); out.h = v.getUint32(20);
        const bmp = await createImageBitmap(f), cv = new OffscreenCanvas(bmp.width, bmp.height), ctx = cv.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        out.ecken = [[0, 0], [bmp.width - 1, 0], [0, bmp.height - 1], [bmp.width - 1, bmp.height - 1]].map(([x, y]) => d[(y * bmp.width + x) * 4 + 3]);
        let deckend = 0, grau = 0;
        for (let i = 0; i < d.length; i += 4 * 7) {
          if (d[i + 3] > 250) { deckend++; if (Math.abs(d[i] - d[i + 2]) < 40 && d[i] > 60 && d[i] < 230 && Math.abs(d[i] - d[i + 1]) < 30) grau++; }
        }
        out.deckend = deckend; out.grau = grau;
      } else out.text = await f.text();
      return out;
    }));
    window.__share.calls.push({ files });
  };
}

async function newPage(opts = {}) {
  const { viewport = { width: 1194, height: 834 }, withToken = true, init, device } = opts;
  net.offline = false; mock.mode = 'ok'; mock.requests = [];
  const context = await browser.newContext({ ...(device || { viewport }), locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const log = { urls: [], errors: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  context.on('request', (r) => log.urls.push(r.url()));
  if (withToken) await context.addInitScript((t) => { if (window === window.top) localStorage.setItem('aether.githubToken', t); }, TOKEN);
  await context.addInitScript(shareMock);
  if (init) await context.addInitScript(init.fn, init.arg);
  await context.route('https://api.github.com/**', githubApi);
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  return { context, page, log };
}
const echteFehler = (log) => log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|net::ERR_FAILED/.test(e));
const E = (page, f, arg) => page.evaluate(f, arg);
const zustand = (page) => E(page, () => window.AetherLogoEditor.zustand());
const ringInfo = (page) => E(page, () => window.AetherLogoEditor.ring());
async function bereit(page) { await page.waitForFunction(() => window.AetherLogoEditor && window.AetherLogoEditor.bereit(), null, { timeout: 20000 }); }
async function openLogo(page) {
  await page.goto(baseUrl + 'logo.html');
  await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() !== 'laden' && window.AetherLogo.pngStand() !== 'laden');
  await bereit(page);
}
const svgText = (page) => E(page, () => window.AetherLogoEditor.svg());
// Regler wie mit dem Finger/der Maus: viele input-Ereignisse, am Ende ein change
async function regler(page, id, wert) {
  await page.$eval('#' + id, (e, v) => {
    const a = Number(e.value), schritte = 6;
    for (let i = 1; i <= schritte; i++) { e.value = String(a + (v - a) * i / schritte); e.dispatchEvent(new Event('input', { bubbles: true })); }
    e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  }, wert);
  await bereit(page);
}
const tab = async (page, name) => { await page.click('#tab' + name); };
// Inhalt der Ring-Gruppen: { hinten: [{ id, polys: [[fill, points], …] }], vorne: … }
function ringGruppen(svg) {
  const teil = (id) => {
    const a = svg.indexOf(`<g id="${id}">`);
    if (a < 0) return null;
    let tiefe = 0, i = a;
    const re = /<g[\s>]|<\/g>/g; re.lastIndex = a;
    for (let m; (m = re.exec(svg));) { tiefe += m[0] === '</g>' ? -1 : 1; if (!tiefe) { i = m.index; break; } }
    return [...svg.slice(a, i).matchAll(/<g id="((?:brocken|eigen)-\d+)">((?:<polygon [^>]+\/>)+)<\/g>/g)]
      .map((m) => ({ id: m[1], polys: [...m[2].matchAll(/<polygon fill="([^"]+)" points="([^"]+)"\/>/g)].map((p) => [p[1], p[2]]) }));
  };
  return { hinten: teil('ring-hinten'), vorne: teil('ring-vorne') };
}
const schriftGruppe = (svg) => (/<g id="schrift">[\s\S]*?<\/g>/.exec(svg) || [''])[0];
const alleBrocken = (svg) => { const g = ringGruppen(svg); return [...(g.hinten || []), ...(g.vorne || [])]; };

// ---------------------------------------------------------------------------
describe('Ring per Regler (Teil 1)', () => {
  test('Standardwerte ergeben die Referenz-Brocken des Spiels (Lage, Form, Farben, Zahl, Gruppen vorne/hinten)', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    assert.deepEqual((await zustand(page)).ring, SPIEL, 'Startwerte = Spielwerte');
    const svg = await svgText(page), g = ringGruppen(svg);
    assert.equal(g.hinten.length, 49, '49 Brocken hinten');
    assert.equal(g.vorne.length, 101, '101 Brocken vorne');
    assert.deepEqual(g.hinten.map((b) => b.id), Array.from({ length: 49 }, (_, i) => 'brocken-' + i), 'hintere zuerst, Nummern in Zeichenreihenfolge');
    assert.deepEqual(g.vorne.map((b) => b.id), Array.from({ length: 101 }, (_, i) => 'brocken-' + (49 + i)));
    const nach = Object.fromEntries([...g.hinten, ...g.vorne].map((b) => [b.id, b]));
    const info = Object.fromEntries((await ringInfo(page)).brocken.map((b) => [b.nr, b]));
    for (const [nr, mitte, fill, facet, umriss] of REFERENZ) {
      const b = nach['brocken-' + nr];
      assert.deepEqual(b.polys[0], [fill, umriss], `brocken-${nr}: Umriss und Farbe`);
      assert.equal(b.polys[1][0], facet, `brocken-${nr}: Facettenfarbe`);
      assert.equal(b.polys[1][1].split(' ')[0], mitte, `brocken-${nr}: Facette beginnt in der Mitte`);
      const [x, y] = mitte.split(',').map(Number);
      assert.ok(Math.abs(info[nr].x - x) < 0.001 && Math.abs(info[nr].y - y) < 0.001, `brocken-${nr}: Lage`);
      assert.equal(info[nr].vorne, nr >= 49);
    }
    for (const b of [...g.hinten, ...g.vorne]) {
      const n = b.polys[0][1].split(' ').length;
      assert.ok(n >= 6 && n <= 8, `${b.id}: 6–8 Ecken (${n})`);
      assert.equal(b.polys[1][1].split(' ').length, 3, `${b.id}: Facette ist ein Dreieck`);
    }
    // Ausdehnung wie ringExtent() des Spiels: 375 × 137 px
    const box = (await ringInfo(page)).box;
    assert.deepEqual([box.x2 - box.x1, box.y2 - box.y1].map(Math.ceil), [375, 137], 'Ausdehnung des Rings');
    await page.screenshot({ path: path.join(OUT, 'logo-ring-standard.png') });
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('jeder Regler ändert den Ring; Anzeige der Werte; „Wie im Spiel“ setzt alle Ring-Regler zurück (ein Schritt)', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    await tab(page, 'Ring');
    const start = await svgText(page);
    const anzeige = await E(page, () => Object.fromEntries(['rNeigungWert', 'rBreiteWert', 'rHoeheWert', 'rAnzahlWert', 'rGroesseWert', 'rKopfWert', 'rSchweifWert', 'rDichteWert'].map((id) => [id, document.getElementById(id).textContent])));
    assert.deepEqual(anzeige, { rNeigungWert: '15,5°', rBreiteWert: '178 px', rHoeheWert: '30 px', rAnzahlWert: '150', rGroesseWert: '1,1–7,5 px', rKopfWert: '129° · vorne links', rSchweifWert: '335°', rDichteWert: '2,3' });
    assert.equal(await page.inputValue('#rZufall'), String(0x9E3779B9));
    const aenderungen = [
      ['rNeigung', 'neigung', 0.1], ['rBreite', 'breite', 2.2], ['rHoehe', 'hoehe', 0.55], ['rAnzahl', 'anzahl', 220],
      ['rGroesseMin', 'groesseMin', 0.02], ['rGroesseMax', 'groesseMax', 0.12], ['rKopf', 'kopf', 4], ['rSchweif', 'schweif', 3], ['rDichte', 'dichte', 4.1]
    ];
    let vorher = start;
    const v0 = (await E(page, () => window.AetherLogoEditor.verlauf())).laenge;
    for (const [id, key, wert] of aenderungen) {
      await regler(page, id, wert);
      const z = await zustand(page);
      assert.equal(z.ring[key], wert, `${key} übernommen`);
      const svg = await svgText(page);
      assert.notEqual(svg, vorher, `${key} ändert den Ring`);
      assert.equal(schriftGruppe(svg), schriftGruppe(start), `${key}: Schrift bleibt unverändert`);
      vorher = svg;
    }
    assert.equal((await E(page, () => window.AetherLogoEditor.verlauf())).laenge, v0 + aenderungen.length, 'je Reglerzug ein Schritt');
    // Zufallswert: Feld und „Neu würfeln“
    await page.fill('#rZufall', '12345'); await page.press('#rZufall', 'Enter'); await bereit(page);
    assert.equal((await zustand(page)).ring.zufall, 12345);
    assert.notEqual(await svgText(page), vorher, 'Zufallswert ändert den Ring');
    vorher = await svgText(page);
    await page.click('#btnWuerfeln'); await bereit(page);
    const z1 = (await zustand(page)).ring.zufall;
    assert.ok(Number.isInteger(z1) && z1 >= 1 && z1 <= 4294967295 && z1 !== 12345, `neu gewürfelt: ${z1}`);
    assert.equal(await page.inputValue('#rZufall'), String(z1));
    assert.notEqual(await svgText(page), vorher, 'Neu würfeln ändert den Ring');
    // ungültige Eingaben: alter Wert bleibt, kein Schritt
    const v1 = await E(page, () => window.AetherLogoEditor.verlauf());
    for (const t of ['0', '4294967296', 'abc', '']) {
      await page.fill('#rZufall', t); await page.press('#rZufall', 'Enter');
      assert.equal(await page.inputValue('#rZufall'), String(z1), `„${t}“ abgelehnt`);
    }
    assert.deepEqual(await E(page, () => window.AetherLogoEditor.verlauf()), v1);
    // Brocken-Größe: kleinster ≤ größter (der andere Regler folgt)
    await regler(page, 'rGroesseMin', 0.15);
    let r = (await zustand(page)).ring;
    assert.deepEqual([r.groesseMin, r.groesseMax], [0.15, 0.15]);
    await regler(page, 'rGroesseMax', 0.03);
    r = (await zustand(page)).ring;
    assert.deepEqual([r.groesseMin, r.groesseMax], [0.03, 0.03]);
    // Wie im Spiel
    const v2 = (await E(page, () => window.AetherLogoEditor.verlauf())).laenge;
    await page.click('#btnWieImSpiel'); await bereit(page);
    assert.deepEqual((await zustand(page)).ring, SPIEL, 'alle Ring-Regler auf den Spielwerten');
    assert.equal(await svgText(page), start, 'Ring wie am Anfang');
    assert.equal(await page.inputValue('#rZufall'), String(0x9E3779B9));
    assert.equal((await E(page, () => window.AetherLogoEditor.verlauf())).laenge, v2 + 1, '„Wie im Spiel“ ist ein Schritt');
    await page.click('#btnUndo'); await bereit(page);
    assert.deepEqual([(await zustand(page)).ring.groesseMin, (await zustand(page)).ring.groesseMax], [0.03, 0.03], 'Rückgängig holt die Werte zurück');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Anzahl: Obergrenze 400 (Regler, Projektdatei), Untergrenze 10; Zufallswert-Feld: Backspace löscht nur Zeichen', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    await tab(page, 'Ring');
    assert.deepEqual(await page.$eval('#rAnzahl', (e) => [e.min, e.max, e.step]), ['10', '400', '1']);
    await regler(page, 'rAnzahl', 400);
    assert.equal(alleBrocken(await svgText(page)).length, 400, '400 Brocken');
    await page.$eval('#rAnzahl', (e) => { e.max = '5000'; e.value = '5000'; e.dispatchEvent(new Event('change')); e.max = '400'; });
    await bereit(page);
    assert.equal((await zustand(page)).ring.anzahl, 400, 'mehr als 400 wird auf 400 begrenzt');
    const datei = (inhalt) => ({ name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(inhalt) });
    const projekt = (ring) => JSON.stringify({ format: 'aether-logo-projekt', version: 2, text: 'Aether', gespeichert: '2026-11-13T10:00:00Z', einstellungen: { ring } });
    await page.setInputFiles('#projDatei', datei(projekt({ ...SPIEL, anzahl: 99999, neigung: 9, zufall: -5, dichte: 'viel' })));
    await bereit(page);
    const r = (await zustand(page)).ring;
    assert.deepEqual([r.anzahl, r.neigung, r.zufall, r.dichte], [400, 0.785, 0x9E3779B9, 2.3], 'Projektdatei: Werte begrenzt bzw. Spielwerte');
    await page.setInputFiles('#projDatei', datei(projekt({ ...SPIEL, anzahl: 1 })));
    await bereit(page);
    assert.equal((await zustand(page)).ring.anzahl, 10);
    assert.equal(alleBrocken(await svgText(page)).length, 10);
    // Backspace im Zufallswert-Feld
    const z = await zustand(page), v = await E(page, () => window.AetherLogoEditor.verlauf());
    await page.click('#rZufall'); await page.press('#rZufall', 'End');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
    assert.equal(await page.inputValue('#rZufall'), String(0x9E3779B9).slice(0, -3), 'Zeichen gelöscht');
    await page.waitForTimeout(100);
    assert.deepEqual(await zustand(page), z, 'nichts rückgängig gemacht');
    assert.deepEqual(await E(page, () => window.AetherLogoEditor.verlauf()), v);
    assert.equal(page.url(), baseUrl + 'logo.html', 'Seite bleibt');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Projekt Version 2: Rundlauf mit Ring; Version 1 lädt weiter (Ring mit Spielwerten); kaputt/fremd unverändert', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    await tab(page, 'Ring');
    await regler(page, 'rNeigung', -0.3); await regler(page, 'rAnzahl', 77); await regler(page, 'rKopf', 1.5);
    await page.fill('#rZufall', '424242'); await page.press('#rZufall', 'Enter'); await bereit(page);
    const gesichert = await zustand(page), svgGesichert = await svgText(page);
    await page.click('#btnProjSichern');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const f = (await E(page, () => window.__share.calls[0])).files[0];
    const o = JSON.parse(f.text);
    assert.deepEqual([o.format, o.version], ['aether-logo-projekt', 2]);
    assert.deepEqual(o.einstellungen.ring, { ...SPIEL, neigung: -0.3, anzahl: 77, kopf: 1.5, zufall: 424242 });
    await page.click('#btnWieImSpiel'); await bereit(page);
    const datei = (name, inhalt) => ({ name, mimeType: 'application/json', buffer: Buffer.from(inhalt) });
    await page.setInputFiles('#projDatei', datei('p.json', f.text)); await bereit(page);
    assert.deepEqual(await zustand(page), gesichert, 'Rundlauf Version 2');
    assert.equal(await svgText(page), svgGesichert, 'gleicher Ring nach dem Laden');
    // Version 1 (Stufe 1, ohne Ring)
    const v1 = { format: 'aether-logo-projekt', version: 1, text: 'Aether', gespeichert: '2026-11-01T10:00:00.000Z',
      einstellungen: { schrift: 'saira', staerke: 700, kursiv: true, abstand: 4, farbe1: '#112233', farbe2: '#445566', tiefe: 6, richtung: 'n', umriss: 1, umrissFarbe: '#000000', effekt: 'leuchten', weich: 3, ringHinten: false, ringVorne: true } };
    await page.setInputFiles('#projDatei', datei('v1.json', JSON.stringify(v1))); await bereit(page);
    assert.deepEqual(await zustand(page), { ...v1.einstellungen, ring: SPIEL }, 'Version 1 lädt, Ring mit Spielwerten');
    assert.equal(await page.textContent('#editorMeldung'), 'Projekt geladen');
    // Version 1 aus dem Speicher (localStorage) nach Neuladen
    await E(page, (t) => localStorage.setItem('aether.logoProjekt', t), JSON.stringify({ ...v1, einstellungen: { ...v1.einstellungen, schrift: 'orbitron', kursiv: false } }));
    await page.reload(); await openLogo(page);
    assert.deepEqual(await zustand(page), { ...v1.einstellungen, schrift: 'orbitron', kursiv: false, ring: SPIEL }, 'Version 1 aus dem Speicher');
    // kaputt/fremd/unbekannte Version: Meldung, Projekt unverändert
    const z = await zustand(page);
    for (const [name, inhalt, text] of [
      ['kaputt.json', '{"format":"aether-logo-pro', 'Die Projektdatei ist beschädigt – das aktuelle Projekt bleibt unverändert.'],
      ['fremd.json', '{"format":"anderes","version":2}', 'Das ist keine Logo-Projektdatei – das aktuelle Projekt bleibt unverändert.'],
      ['v9.json', JSON.stringify({ ...o, version: 9 }), 'Projektdatei-Version 9 wird nicht unterstützt – das aktuelle Projekt bleibt unverändert.']
    ]) {
      await page.setInputFiles('#projDatei', datei(name, inhalt));
      await page.waitForFunction((t) => document.getElementById('editorMeldung').textContent === t, text);
      assert.deepEqual(await zustand(page), z, `${name}: unverändert`);
    }
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('SVG und PNG mit dem erzeugten Ring: Gruppen ring-hinten/ring-vorne, Polygone mit Facettenfarben, kein <text>/<script>/externe Verweise; PNG transparent', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    await tab(page, 'Ausgabe');
    await page.click('#btnEditorSvg');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const svg = (await E(page, () => window.__share.calls[0])).files[0].text;
    assert.equal(svg, await svgText(page), 'SVG-Datei = Beschreibung');
    assert.deepEqual([...svg.matchAll(/<g id="([a-z-]+)"/g)].map((m) => m[1]), ['ring-hinten', 'schatten', 'schrift', 'ring-vorne'], 'Ebenen-Gruppen');
    assert.equal(alleBrocken(svg).length, 150);
    assert.doesNotMatch(svg, /<text[\s>]|<script|<style|foreignObject|<image|<use|\son[a-z]+\s*=/i);
    for (const m of svg.matchAll(/(?:href|src)\s*=\s*"([^"]*)"/gi)) assert.match(m[1], /^#/);
    for (const m of svg.matchAll(/url\(([^)]*)\)/g)) assert.match(m[1], /^#/);
    assert.deepEqual([...new Set([...svg.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((x) => x[0]))], ['http://www.w3.org/2000/svg']);
    // Bühne zeigt genau dieses SVG
    assert.equal(await E(page, async () => (await (await fetch(document.getElementById('editorBild').src)).text())), svg, 'Bühne = SVG');
    // PNG: aus derselben Beschreibung, transparent, Ring-Pixel (grau) vorhanden
    await page.click('#eBreite [data-w="1024"]');
    await page.waitForFunction(() => window.AetherLogoEditor.pngBereit(), null, { timeout: 20000 });
    assert.equal(await E(page, () => window.AetherLogoEditor.pngSvg()), svg.replace(/width="[^"]+" height="[^"]+"/, (m) => { const vb = /viewBox="[-\d.]+ [-\d.]+ ([\d.]+) ([\d.]+)"/.exec(svg); return `width="1024" height="${Math.round(1024 * vb[2] / vb[1])}"`; }));
    await page.click('#btnEditorPng');
    await page.waitForFunction(() => window.__share.calls.length === 2, null, { timeout: 30000 });
    const mit = (await E(page, () => window.__share.calls[1])).files[0];
    assert.equal(mit.type, 'image/png'); assert.equal(mit.w, 1024);
    assert.deepEqual(mit.ecken, [0, 0, 0, 0], 'Ecken transparent');
    // ohne Ring: weniger graue Pixel
    await tab(page, 'Ring');
    await page.click('label[data-ring="hinten"]'); await page.click('label[data-ring="vorne"]'); await bereit(page);
    await tab(page, 'Ausgabe');
    await page.waitForFunction(() => window.AetherLogoEditor.pngBereit(), null, { timeout: 20000 });
    await page.click('#btnEditorPng');
    await page.waitForFunction(() => window.__share.calls.length === 3, null, { timeout: 30000 });
    const ohne = (await E(page, () => window.__share.calls[2])).files[0];
    assert.ok(mit.grau > ohne.grau + 50, `Ring im PNG (grau mit ${mit.grau}, ohne ${ohne.grau})`);
    assert.deepEqual([...(await svgText(page)).matchAll(/<g id="([a-z-]+)"/g)].map((m) => m[1]), ['schatten', 'schrift'], 'Schalter Ring hinten/vorne wirken');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Speicherung nach Neuladen, offline mit Ring, genau 4 API-Anfragen, kein Token in Projekt/Speicher/Cache/SVG', async () => {
    const { context, page, log } = await newPage();
    await page.goto(baseUrl);
    assert.ok(await E(page, () => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 15000))])), 'Service Worker aktiv');
    mock.requests = [];
    await openLogo(page);
    await tab(page, 'Ring');
    for (const [id, w] of [['rNeigung', 0.5], ['rBreite', 2], ['rHoehe', 0.4], ['rAnzahl', 300], ['rGroesseMax', 0.1], ['rKopf', 3], ['rSchweif', 4], ['rDichte', 1.5]]) await regler(page, id, w);
    await page.click('#btnWuerfeln'); await bereit(page);
    assert.deepEqual(mock.requests.map((r) => r.path).sort(), [`${BASE}/commits`, `${BASE}/commits`, `${BASE}/contents/art/logo/logo.svg`, `${BASE}/contents/game/assets/ui/logo.png`], 'genau 4 API-Anfragen, der Ring fragt nichts an');
    const z = await zustand(page), svg = await svgText(page);
    await page.reload(); await openLogo(page);
    assert.deepEqual(await zustand(page), z, 'nach Neuladen wieder da');
    assert.equal(await svgText(page), svg, 'gleicher Ring nach Neuladen');
    // offline
    net.offline = true; mock.mode = 'offline';
    await context.setOffline(true);
    await page.reload(); await openLogo(page);
    assert.equal(await E(page, () => window.AetherLogo.stand()), 'offline');
    assert.equal(await svgText(page), svg, 'offline: gleicher Ring');
    await page.screenshot({ path: path.join(OUT, 'logo-ring-offline.png') });
    await context.setOffline(false); net.offline = false; mock.mode = 'ok';
    // Token
    await page.click('#btnProjSichern');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const st = await E(page, async (token) => {
      const ls = Object.keys(localStorage).filter((k) => k !== 'aether.githubToken').map((k) => [k, localStorage.getItem(k)]);
      const cache = [];
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const req of await c.keys()) cache.push({ url: req.url, token: new TextDecoder('latin1').decode(await (await c.match(req)).arrayBuffer()).includes(token) });
      }
      return { ls, cache, datei: window.__share.calls[0].files[0].text, svg: window.AetherLogoEditor.svg() };
    }, TOKEN);
    for (const [k, v] of st.ls) assert.ok(!v.includes(TOKEN) && !v.includes('github_pat_'), `kein Token in ${k}`);
    for (const c of st.cache) { assert.ok(!c.token, `kein Token im Cache: ${c.url}`); assert.ok(!c.url.includes('api.github.com'), `keine API im Cache: ${c.url}`); }
    assert.ok(!st.datei.includes(TOKEN) && !/github_pat_|"token"/i.test(st.datei), 'kein Token in der Projektdatei');
    assert.ok(!st.svg.includes(TOKEN), 'kein Token im SVG');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Leistung: Neuberechnung + Zeichnen bei 150 und 400 Brocken bleibt flüssig', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    await tab(page, 'Ring');
    for (const n of [150, 400]) {
      await regler(page, 'rAnzahl', n);
      const ms = await E(page, async () => {
        const e = document.getElementById('rNeigung'), zeiten = [];
        for (let i = 0; i < 8; i++) {
          const t0 = performance.now();
          e.value = String(0.1 + i * 0.02); e.dispatchEvent(new Event('input'));
          await new Promise((r) => { const w = () => (window.AetherLogoEditor.bereit() ? r() : requestAnimationFrame(w)); w(); });
          zeiten.push(performance.now() - t0);
        }
        return zeiten.sort((a, b) => a - b)[4];
      });
      assert.ok(ms < 250, `${n} Brocken: ${Math.round(ms)} ms je Reglerschritt`);
    }
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });
});
