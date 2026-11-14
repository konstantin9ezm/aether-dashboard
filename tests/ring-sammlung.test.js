// Tests für die Ring-Sammlung im Reiter „Ring“ von logo.html: Ringe unter Namen speichern (Speichern, Speichern
// unter, Umbenennen, Kopieren, Löschen mit Rückfrage), Umschalten lädt den Ring-Teil exakt (Regler, Zufallswert,
// Einzeländerungen, eigene Brocken, Ring hinten/vorne), Rückfrage bei ungespeicherten Änderungen, Namensregeln,
// eigener Speicher „aether.logoRinge“ unabhängig vom Projekt, Neuladen/Neustart/offline, Datei sichern/laden,
// kaputter Speicher, Tastatur (Enter, Esc, Backspace), Rückgängig nach Umschalten, Layout.
// Aufruf: node --test tests/ring-sammlung.test.js
// Gegenproben (müssen rot werden): AETHER_GEGENPROBE=ohne-frage|ohne-einzel|im-projekt|doppelt|backspace
//   node --test tests/ring-sammlung.test.js
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
  // a) Umschalten ohne Rückfrage bei ungespeicherten Änderungen
  'ohne-frage': [['  if (ringGeaendert()){\n    const w = await fragen(', '  if (false){\n    const w = await fragen(']],
  // b) Einzeländerungen an Brocken werden beim Speichern nicht mitgespeichert
  'ohne-einzel': [['ring:ringNormal(z.ring), brocken:brockenNormal(z.brocken), eigene:', 'ring:ringNormal(z.ring), brocken:{}, eigene:']],
  // c) Sammlung im Projekt-Speicher statt im eigenen
  'im-projekt': [["const RINGE_KEY = 'aether.logoRinge';", "const RINGE_KEY = 'aether.logoProjekt';"]],
  // d) doppelte Namen erlaubt
  doppelt: [['const nameFrei = ausser => t => sammlung.some(', 'const nameFrei = ausser => t => false && sammlung.some(']],
  // e) Backspace im Namensfeld schließt den Dialog
  backspace: [["(e.key === 'Backspace' && !istTextfeld(e.target))){ e.preventDefault(); if (nameDialog)", "(e.key === 'Backspace')){ e.preventDefault(); if (nameDialog)"]]
};
if (GEGENPROBE && !PATCHES[GEGENPROBE]) throw new Error('Unbekannte Gegenprobe: ' + GEGENPROBE);
function logoHtml() {
  let s = fs.readFileSync(path.join(ROOT, 'logo.html'), 'utf8');
  for (const [a, b] of PATCHES[GEGENPROBE] || []) { assert.ok(s.includes(a), `Gegenprobe ${GEGENPROBE}: Stelle gefunden`); s = s.replace(a, b); }
  return s;
}
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
// ---------------------------------------------------------------------------
// Hilfen für die Sammlung
// ---------------------------------------------------------------------------
const sammlung = (page) => E(page, () => window.AetherLogoEditor.sammlung());
const ringTeil = (z) => ({ ringHinten: z.ringHinten, ringVorne: z.ringVorne, ring: z.ring, brocken: z.brocken, eigene: z.eigene });
const verlaufPos = (page) => E(page, () => window.AetherLogoEditor.verlauf());
const gespeichert = (page) => E(page, () => localStorage.getItem('aether.logoRinge'));
const meldungText = (page) => page.textContent('#editorMeldung');
// Ring-Teil mit Einzeländerungen und eigenen Brocken (alle Felder wie nach der Prüfung im Editor)
const AENDERUNGEN = {
  ringHinten: true, ringVorne: false,
  ring: { ...SPIEL, neigung: 0.3, breite: 2.1, anzahl: 120, zufall: 4242 },
  brocken: {
    3: { dx: 0.1, dy: -0.05, groesse: 1.5, drehung: 30, lage: 'vorne', geloescht: false },
    7: { dx: 0, dy: 0, groesse: 1, drehung: 0, lage: null, geloescht: true }
  },
  eigene: [{ id: 1, x: 0.5, y: 0.2, groesse: 1.2, drehung: 10, lage: 'hinten', form: 12345 }]
};
const SPIELRING = { ringHinten: true, ringVorne: true, ring: SPIEL, brocken: {}, eigene: [] };
const projektText = (einst) => JSON.stringify({ format: 'aether-logo-projekt', version: 2, text: 'Aether', gespeichert: '2026-11-14T08:00:00.000Z', einstellungen: einst });
const ringeText = (ringe) => JSON.stringify({ format: 'aether-logo-ringe', version: 1, gespeichert: '2026-11-14T08:00:00.000Z', ringe });
// Speicher vorbelegen (Projekt und/oder Sammlung) und neu laden
async function vorbelegen(page, { projekt, ringe }) {
  await E(page, ([p, r]) => { if (p) localStorage.setItem('aether.logoProjekt', p); if (r) localStorage.setItem('aether.logoRinge', r); }, [projekt || null, ringe || null]);
  await page.reload(); await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() !== 'laden'); await bereit(page);
}
async function oeffne(page) { await openLogo(page); await tab(page, 'Ring'); }
// Namensdialog ausfüllen und bestätigen
async function nameEingeben(page, name) {
  await page.waitForSelector('#rsName:not([hidden])');
  await page.fill('#rsNameFeld', name);
  await page.click('#rsNameOk');
}
async function speichernUnter(page, name) {
  await page.click('#rsSpeichernUnter');
  await nameEingeben(page, name);
  await page.waitForSelector('#rsName', { state: 'hidden' });
  await bereit(page);
}
async function waehle(page, name) { await page.selectOption('#rsAuswahl', name); }
const optionen = (page) => page.$$eval('#rsAuswahl option', (os) => os.map((o) => o.textContent));
const fokus = (page) => E(page, () => document.activeElement && (document.activeElement.id || document.activeElement.dataset.wert || document.activeElement.textContent));

// ---------------------------------------------------------------------------
describe('Ring-Sammlung: Verwalten', () => {
  test('Speichern unter: neuer Ring mit Namen, eigener Speicher (Format/Version), Projekt merkt sich nur den Namen', async () => {
    const { context, page, log } = await newPage();
    await oeffne(page);
    assert.deepEqual(await optionen(page), ['– ungespeichert –'], 'leer: nur „– ungespeichert –“');
    for (const id of ['rsUmbenennen', 'rsKopieren', 'rsLoeschen']) assert.equal(await page.isDisabled('#' + id), true, `${id} ohne Ring gesperrt`);
    assert.equal(await page.isHidden('#rsGeaendert'), true);
    await vorbelegen(page, { projekt: projektText({ schrift: 'orbitron', farbe1: '#112233', ...AENDERUNGEN }) });
    await tab(page, 'Ring');
    const z = await zustand(page);
    await speichernUnter(page, '  Alpha  ');
    const s = await sammlung(page);
    assert.deepEqual(s.ringe.map((r) => r.name), ['Alpha'], 'Leerzeichen entfernt');
    assert.equal(s.aktiv, 'Alpha');
    assert.equal(s.geaendert, false);
    assert.deepEqual(s.ringe[0].daten, ringTeil(z), 'Ring-Teil exakt gespeichert (Regler, Zufallswert, Einzeländerungen, eigene Brocken, hinten/vorne)');
    assert.deepEqual(await optionen(page), ['Alpha'], '„– ungespeichert –“ verschwindet');
    assert.equal(await page.inputValue('#rsAuswahl'), 'Alpha');
    const roh = JSON.parse(await gespeichert(page));
    assert.deepEqual(Object.keys(roh), ['format', 'version', 'gespeichert', 'ringe']);
    assert.deepEqual([roh.format, roh.version], ['aether-logo-ringe', 1]);
    assert.deepEqual(Object.keys(roh.ringe[0]), ['name', 'gespeichert', 'daten']);
    assert.deepEqual(Object.keys(roh.ringe[0].daten), ['ringHinten', 'ringVorne', 'ring', 'brocken', 'eigene'], 'nur der Ring-Teil (keine Schrift, Farben, Ausgabe)');
    const proj = JSON.parse(await E(page, () => localStorage.getItem('aether.logoProjekt')));
    assert.equal(proj.version, 2, 'Projektformat bleibt Version 2');
    assert.equal(proj.einstellungen.ringName, 'Alpha', 'Projekt merkt sich den Namen');
    assert.ok(!('ringe' in proj) && !('ringe' in proj.einstellungen), 'Sammlung nicht im Projekt');
    for (const id of ['rsUmbenennen', 'rsKopieren', 'rsLoeschen']) assert.equal(await page.isDisabled('#' + id), false);
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Speichern überschreibt den gewählten Ring; „geändert“ erscheint und verschwindet; ohne Namen wie „Speichern unter …“', async () => {
    const { context, page, log } = await newPage();
    await oeffne(page);
    await page.click('#rsSpeichern');
    await nameEingeben(page, 'Erster');
    await page.waitForSelector('#rsName', { state: 'hidden' });
    assert.equal((await sammlung(page)).aktiv, 'Erster', 'Speichern ohne Namen fragt nach dem Namen');
    await regler(page, 'rNeigung', 0.4);
    assert.equal(await page.isVisible('#rsGeaendert'), true, '„geändert“ sichtbar');
    assert.equal((await sammlung(page)).geaendert, true);
    await page.click('#rsSpeichern');
    await page.waitForSelector('#rsGeaendert', { state: 'hidden' });
    const s = await sammlung(page);
    assert.equal(s.ringe.length, 1, 'kein zweiter Ring');
    assert.equal(s.ringe[0].daten.ring.neigung, 0.4, 'überschrieben');
    assert.equal(await page.isHidden('#rsName'), true, 'kein Dialog beim Überschreiben');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Umbenennen und Kopieren (eigener Dialog, Vorschlag „<Name> (Kopie)“), Löschen mit Rückfrage (Abbrechen vorgewählt)', async () => {
    const { context, page, log } = await newPage();
    let prompts = 0;
    page.on('dialog', (d) => { prompts++; d.dismiss(); });
    await oeffne(page);
    await speichernUnter(page, 'Alpha');
    await page.click('#rsUmbenennen');
    await page.waitForSelector('#rsName:not([hidden])');
    assert.equal(await page.textContent('#rsNameTitel'), 'Ring umbenennen');
    assert.equal(await page.inputValue('#rsNameFeld'), 'Alpha');
    assert.equal(await fokus(page), 'rsNameFeld', 'Textfeld hat den Fokus');
    await page.fill('#rsNameFeld', 'Beta'); await page.keyboard.press('Enter');   // Enter bestätigt
    await page.waitForSelector('#rsName', { state: 'hidden' });
    let s = await sammlung(page);
    assert.deepEqual([s.ringe.map((r) => r.name), s.aktiv], [['Beta'], 'Beta']);
    assert.equal((await zustand(page)).ringName, 'Beta');
    await page.click('#rsKopieren');
    await page.waitForSelector('#rsName:not([hidden])');
    assert.equal(await page.inputValue('#rsNameFeld'), 'Beta (Kopie)', 'Vorschlag');
    await page.click('#rsNameOk');
    await page.waitForSelector('#rsName', { state: 'hidden' });
    s = await sammlung(page);
    assert.deepEqual([s.ringe.map((r) => r.name), s.aktiv], [['Beta', 'Beta (Kopie)'], 'Beta (Kopie)']);
    assert.deepEqual(s.ringe[1].daten, s.ringe[0].daten, 'Kopie hat denselben Ring');
    // Löschen: Rückfrage, Abbrechen vorgewählt (Enter = Abbrechen)
    await page.click('#rsLoeschen');
    await page.waitForSelector('#rsFrage:not([hidden])');
    assert.equal(await page.textContent('#rsFrageText'), 'Ring „Beta (Kopie)“ löschen?');
    assert.deepEqual(await page.$$eval('#rsFrageKnoepfe button', (bs) => bs.map((b) => b.textContent)), ['Löschen', 'Abbrechen']);
    assert.equal(await fokus(page), 'abbrechen', 'Abbrechen vorgewählt');
    await page.keyboard.press('Enter');
    await page.waitForSelector('#rsFrage', { state: 'hidden' });
    assert.equal((await sammlung(page)).ringe.length, 2, 'Abbrechen: nichts gelöscht');
    await page.click('#rsLoeschen');
    await page.click('#rsFrageKnoepfe [data-wert="loeschen"]');
    await page.waitForSelector('#rsFrage', { state: 'hidden' });
    s = await sammlung(page);
    assert.deepEqual([s.ringe.map((r) => r.name), s.aktiv], [['Beta'], null]);
    assert.deepEqual(await optionen(page), ['– ungespeichert –', 'Beta']);
    assert.equal(await page.inputValue('#rsAuswahl'), '');
    assert.equal('ringName' in (await zustand(page)), false, 'Projekt ohne Namen');
    // Rückgängig holt keinen verwaisten Namen zurück
    while (!(await page.isDisabled('#btnUndo'))) await page.click('#btnUndo');
    assert.notEqual((await zustand(page)).ringName, 'Beta (Kopie)');
    assert.notEqual((await zustand(page)).ringName, 'Alpha');
    assert.equal(prompts, 0, 'kein window.prompt/confirm');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Namen: leer, nur Leerzeichen, zu lang und doppelt (Groß-/Kleinschreibung egal) werden im Dialog abgelehnt', async () => {
    const { context, page, log } = await newPage();
    await oeffne(page);
    await speichernUnter(page, 'Alpha');
    for (const [name, muster] of [['', /Namen eingeben/], ['    ', /Namen eingeben/], ['x'.repeat(41), /40 Zeichen/], ['alpha', /gibt es schon/], ['  ALPHA ', /gibt es schon/]]) {
      await page.click('#rsSpeichernUnter');
      await nameEingeben(page, name);
      assert.equal(await page.isVisible('#rsName'), true, `„${name}“: Dialog bleibt offen`);
      assert.match(await page.textContent('#rsNameFehler'), muster, `„${name}“: Meldung im Dialog`);
      assert.equal(await page.getAttribute('#rsNameFeld', 'aria-invalid'), 'true');
      await page.click('#rsNameAbbrechen');
      await page.waitForSelector('#rsName', { state: 'hidden' });
    }
    assert.deepEqual((await sammlung(page)).ringe.map((r) => r.name), ['Alpha'], 'nichts angelegt');
    // Umbenennen auf doppelten Namen abgelehnt, auf andere Schreibweise desselben Rings erlaubt
    await speichernUnter(page, 'Beta');
    await page.click('#rsUmbenennen'); await nameEingeben(page, 'ALPHA');
    assert.match(await page.textContent('#rsNameFehler'), /gibt es schon/);
    await page.fill('#rsNameFeld', 'BETA'); await page.click('#rsNameOk');
    await page.waitForSelector('#rsName', { state: 'hidden' });
    assert.deepEqual((await sammlung(page)).ringe.map((r) => r.name), ['Alpha', 'BETA']);
    // genau 40 Zeichen sind erlaubt
    await speichernUnter(page, 'y'.repeat(40));
    assert.equal((await sammlung(page)).aktiv, 'y'.repeat(40));
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
describe('Ring-Sammlung: Umschalten', () => {
  test('Umschalten lädt Regler, Zufallswert, Einzeländerungen, eigene Brocken und hinten/vorne exakt; Schrift/Farben bleiben', async () => {
    const { context, page, log } = await newPage();
    await oeffne(page);
    await vorbelegen(page, { projekt: projektText({ schrift: 'orbitron', farbe1: '#112233', ...AENDERUNGEN }), ringe: ringeText([{ name: 'Spiel', gespeichert: '', daten: SPIELRING }]) });
    await tab(page, 'Ring');
    const vorher = await zustand(page);
    assert.deepEqual(Object.keys(vorher.brocken), ['3', '7']);
    await speichernUnter(page, 'Mit Änderungen');
    const svgVorher = await svgText(page);
    await waehle(page, 'Spiel');
    await bereit(page);
    let z = await zustand(page);
    assert.deepEqual(ringTeil(z), SPIELRING, 'Ring „Spiel“ geladen');
    assert.deepEqual([z.schrift, z.farbe1, z.ringName], ['orbitron', '#112233', 'Spiel'], 'Schrift und Farben unverändert');
    assert.equal(await page.inputValue('#rNeigung'), String(SPIEL.neigung), 'Regler zeigen den Ring');
    assert.equal(await page.inputValue('#rZufall'), String(SPIEL.zufall), 'Zufallswert-Feld zeigt den Ring');
    assert.equal(await page.isChecked('#rVorne'), true);
    await waehle(page, 'Mit Änderungen');
    await bereit(page);
    z = await zustand(page);
    assert.deepEqual(ringTeil(z), ringTeil(vorher), 'Ring-Daten vorher/nachher gleich');
    assert.equal(await svgText(page), svgVorher, 'gleiches Bild');
    assert.equal(await page.inputValue('#rZufall'), '4242');
    assert.equal(await page.isChecked('#rVorne'), false);
    assert.equal((await sammlung(page)).geaendert, false);
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Ungespeicherte Änderungen: Rückfrage „Änderungen an „<Name>“ speichern?“ – Abbrechen, Verwerfen, Speichern', async () => {
    const { context, page, log } = await newPage();
    await oeffne(page);
    await vorbelegen(page, { ringe: ringeText([{ name: 'A', gespeichert: '', daten: SPIELRING }, { name: 'B', gespeichert: '', daten: { ...SPIELRING, ring: { ...SPIEL, breite: 2.5 } } }]) });
    await tab(page, 'Ring');
    await waehle(page, 'A'); await bereit(page);
    await regler(page, 'rNeigung', 0.5);
    assert.equal(await page.isVisible('#rsGeaendert'), true);
    const geaendert = await zustand(page);
    // Abbrechen: Auswahl und Ring unverändert
    await waehle(page, 'B');
    await page.waitForSelector('#rsFrage:not([hidden])');
    assert.equal(await page.textContent('#rsFrageText'), 'Änderungen an „A“ speichern?');
    assert.deepEqual(await page.$$eval('#rsFrageKnoepfe button', (bs) => bs.map((b) => b.textContent)), ['Speichern', 'Verwerfen', 'Abbrechen']);
    assert.equal(await fokus(page), 'abbrechen', 'Abbrechen vorgewählt');
    assert.equal(await page.inputValue('#rsAuswahl'), 'A', 'Auswahl bleibt während der Rückfrage');
    await page.click('#rsFrageKnoepfe [data-wert="abbrechen"]');
    await page.waitForSelector('#rsFrage', { state: 'hidden' });
    assert.deepEqual(await zustand(page), geaendert, 'Abbrechen: Ring unverändert');
    assert.equal(await page.inputValue('#rsAuswahl'), 'A');
    assert.equal(await page.isVisible('#rsGeaendert'), true, 'weiter „geändert“');
    // Esc = Abbrechen
    await waehle(page, 'B'); await page.waitForSelector('#rsFrage:not([hidden])');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#rsFrage', { state: 'hidden' });
    assert.deepEqual(await zustand(page), geaendert, 'Esc: Ring unverändert');
    // Verwerfen: B geladen, A in der Sammlung unverändert
    await waehle(page, 'B'); await page.waitForSelector('#rsFrage:not([hidden])');
    await page.click('#rsFrageKnoepfe [data-wert="verwerfen"]');
    await bereit(page);
    let s = await sammlung(page);
    assert.equal(s.aktiv, 'B');
    assert.equal((await zustand(page)).ring.breite, 2.5);
    assert.equal(s.ringe[0].daten.ring.neigung, SPIEL.neigung, 'Verwerfen: A nicht gespeichert');
    // Speichern: A übernimmt die Änderung, dann B
    await waehle(page, 'A'); await bereit(page);
    assert.equal(await page.isHidden('#rsFrage'), true, 'ohne Änderungen keine Rückfrage');
    await regler(page, 'rNeigung', 0.6);
    await waehle(page, 'B'); await page.waitForSelector('#rsFrage:not([hidden])');
    await page.click('#rsFrageKnoepfe [data-wert="speichern"]');
    await bereit(page);
    s = await sammlung(page);
    assert.equal(s.aktiv, 'B');
    assert.equal(s.ringe[0].daten.ring.neigung, 0.6, 'Speichern: A gespeichert');
    assert.equal((await zustand(page)).ring.neigung, SPIEL.neigung, 'B geladen');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Rückgängig nach Umschalten holt den vorigen Ring zurück (ein Schritt), Wiederholen wieder den neuen', async () => {
    const { context, page, log } = await newPage();
    await oeffne(page);
    await vorbelegen(page, { projekt: projektText({ ...AENDERUNGEN }), ringe: ringeText([{ name: 'Spiel', gespeichert: '', daten: SPIELRING }]) });
    await tab(page, 'Ring');
    const vorher = await zustand(page), pos = (await verlaufPos(page)).pos;
    await waehle(page, 'Spiel'); await bereit(page);
    assert.equal((await verlaufPos(page)).pos, pos + 1, 'Umschalten = ein Schritt');
    await page.click('#btnUndo'); await bereit(page);
    assert.deepEqual(await zustand(page), vorher, 'Rückgängig: voriger Ring');
    assert.deepEqual(await optionen(page), ['– ungespeichert –', 'Spiel']);
    assert.equal(await page.inputValue('#rsAuswahl'), '');
    await page.click('#btnRedo'); await bereit(page);
    assert.deepEqual(ringTeil(await zustand(page)), SPIELRING, 'Wiederholen: neuer Ring');
    assert.equal(await page.inputValue('#rsAuswahl'), 'Spiel');
    // „Wie im Spiel (zurücksetzen)“ ändert die Sammlung nicht
    await regler(page, 'rBreite', 2.2);
    const roh = await gespeichert(page);
    await page.click('#btnWieImSpiel'); await bereit(page);
    assert.equal(await gespeichert(page), roh, 'Sammlung unverändert');
    assert.deepEqual((await zustand(page)).ring, SPIEL);
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
describe('Ring-Sammlung: Speicher, Datei, Tastatur', () => {
  test('Sammlung übersteht Neuladen, Neustart (neuer Kontext) und offline; unabhängig vom Projekt', async () => {
    const { context, page, log } = await newPage();
    await page.goto(baseUrl);
    await E(page, () => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 15000))]));
    await oeffne(page);
    await vorbelegen(page, { projekt: projektText({ ...AENDERUNGEN }) });
    await tab(page, 'Ring');
    await speichernUnter(page, 'Bleibt');
    const s0 = await sammlung(page);
    await page.reload(); await bereit(page);
    assert.deepEqual(await sammlung(page), s0, 'nach Neuladen');
    // Projekt wechseln (Datei laden): Sammlung bleibt, das andere Projekt hat keinen aktiven Ring
    await page.setInputFiles('#projDatei', { name: 'p.json', mimeType: 'application/json', buffer: Buffer.from(projektText({ schrift: 'saira' })) });
    await page.waitForFunction(() => window.AetherLogoEditor.zustand().schrift === 'saira'); await bereit(page);
    let s = await sammlung(page);
    assert.deepEqual(s.ringe, s0.ringe, 'Sammlung unverändert nach Projekt laden');
    assert.equal(s.aktiv, null);
    const proj = await E(page, () => localStorage.getItem('aether.logoProjekt'));
    assert.ok(!proj.includes('Bleibt'), 'Sammlung steht nicht im Projekt');
    assert.ok(await gespeichert(page), 'eigener Speicher „aether.logoRinge“');
    // Projekt-Speicher löschen und neu laden: Sammlung bleibt
    await E(page, () => localStorage.removeItem('aether.logoProjekt'));
    await page.reload(); await bereit(page);
    assert.deepEqual((await sammlung(page)).ringe, s0.ringe, 'Sammlung ohne Projekt');
    // Neustart: neuer Kontext mit demselben Speicher
    const state = await context.storageState();
    const ctx2 = await browser.newContext({ viewport: { width: 1194, height: 834 }, storageState: state, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
    await ctx2.route('https://api.github.com/**', githubApi);
    const p2 = await ctx2.newPage();
    await openLogo(p2);
    assert.deepEqual((await sammlung(p2)).ringe, s0.ringe, 'nach Neustart');
    await ctx2.close();
    // offline (Flugmodus): Seite aus dem Cache, Sammlung da
    net.offline = true; mock.mode = 'offline';
    await context.setOffline(true);
    await page.reload(); await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() !== 'laden'); await bereit(page);
    s = await sammlung(page);
    assert.deepEqual(s.ringe, s0.ringe, 'offline');
    await tab(page, 'Ring');
    await waehle(page, 'Bleibt'); await bereit(page);
    assert.deepEqual(ringTeil(await zustand(page)), s0.ringe[0].daten, 'offline umschalten');
    await context.setOffline(false); net.offline = false; mock.mode = 'ok';
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Sammlung als Datei sichern (Name, Format) und laden: Namenskonflikt „ (2)“, Anzahl gemeldet, falsches Format ändert nichts', async () => {
    const { context, page, log } = await newPage();
    await oeffne(page);
    assert.equal(await page.isDisabled('#rsDateiSichern'), true, 'leere Sammlung: nichts zu sichern');
    await speichernUnter(page, 'Alpha');
    await regler(page, 'rBreite', 2.4);
    await speichernUnter(page, 'Beta');
    await page.click('#rsDateiSichern');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const f = await E(page, () => window.__share.calls[0].files[0]);
    assert.match(f.name, /^aether-logo-ringe-\d{8}-\d{4}\.json$/);
    assert.equal(f.type, 'application/json');
    const datei = JSON.parse(f.text);
    assert.deepEqual([datei.format, datei.version, datei.ringe.map((r) => r.name)], ['aether-logo-ringe', 1, ['Alpha', 'Beta']]);
    assert.deepEqual(datei.ringe, (await sammlung(page)).ringe, 'Datei = Sammlung');
    const pos = await verlaufPos(page), z = await zustand(page);
    // Laden: vorhandene bleiben, gleichnamige bekommen „ (2)“, „ (3)“
    const laden = async (name, text) => {
      await page.setInputFiles('#rsDatei', { name, mimeType: 'application/json', buffer: Buffer.from(text) });
      await page.waitForFunction((n) => document.getElementById('editorMeldung').textContent.length > 0 && document.getElementById('editorMeldung').dataset.alt !== n, name);
      const t = await meldungText(page);
      await E(page, (n) => { document.getElementById('editorMeldung').dataset.alt = n; document.getElementById('editorMeldung').textContent = ''; }, name);
      return t;
    };
    const d2 = { ...datei, ringe: [datei.ringe[0], { ...datei.ringe[1], name: 'Neu' }, { ...datei.ringe[0], name: 'alpha (2)' }] };
    let t = await laden('r1.json', JSON.stringify(d2));
    assert.match(t, /3 Ringe übernommen/);
    assert.deepEqual((await sammlung(page)).ringe.map((r) => r.name), ['Alpha', 'Beta', 'Alpha (2)', 'Neu', 'alpha (2) (2)']);
    t = await laden('r2.json', JSON.stringify({ ...datei, ringe: [datei.ringe[0]] }));
    assert.match(t, /1 Ring übernommen/);
    assert.equal((await sammlung(page)).ringe.at(-1).name, 'Alpha (3)');
    const vorher = await gespeichert(page);
    for (const [n, text, muster] of [
      ['kaputt.json', '{nicht json', /beschädigt/],
      ['fremd.json', projektText({}), /keine Ring-Sammlung/],
      ['version.json', JSON.stringify({ ...datei, version: 9 }), /Version 9 wird nicht unterstützt/],
      ['ohne-liste.json', JSON.stringify({ format: 'aether-logo-ringe', version: 1 }), /beschädigt/]
    ]) {
      t = await laden(n, text);
      assert.match(t, muster, n);
      assert.match(t, /bleibt unverändert/, n);
      assert.equal(await gespeichert(page), vorher, `${n}: nichts geändert`);
    }
    assert.deepEqual(await verlaufPos(page), pos, 'Sammlung laden ändert den Verlauf nicht');
    assert.deepEqual(await zustand(page), z, 'und nicht den Ring im Editor');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Kaputter Speicherinhalt: verworfen ohne Absturz, mit Meldung; einzelne kaputte Einträge fallen weg', async () => {
    for (const [roh, leer] of [['{kaputt', true], ['[1,2,3]', true], [JSON.stringify({ format: 'aether-logo-ringe', version: 7, ringe: [] }), true],
      [ringeText([{ name: 'Gut', daten: SPIELRING }, { name: '', daten: SPIELRING }, { name: 'gut', daten: SPIELRING }, { name: 'Ohne' }, 42, null, { name: 'Schief', daten: { ring: { anzahl: 'viel' }, brocken: 'x', eigene: 5 } }]), false]]) {
      const { context, page, log } = await newPage({ init: { fn: (r) => { if (!sessionStorage.getItem('x')) { sessionStorage.setItem('x', '1'); localStorage.setItem('aether.logoRinge', r); } }, arg: roh } });
      await openLogo(page);
      const s = await sammlung(page);
      if (leer) {
        assert.deepEqual(s.ringe, [], `${roh.slice(0, 20)}: leer`);
        assert.match(await meldungText(page), /beschädigt und wurde verworfen/);
        assert.equal(await gespeichert(page), null, 'kaputter Inhalt entfernt');
      } else {
        assert.deepEqual(s.ringe.map((r) => r.name), ['Gut', 'Schief']);
        assert.deepEqual(s.ringe[1].daten, SPIELRING, 'ungültige Werte → Spielwerte');
        assert.match(await meldungText(page), /5 beschädigte Einträge verworfen/);
      }
      await tab(page, 'Ring');
      await speichernUnter(page, 'Neu');
      assert.ok((await sammlung(page)).ringe.some((r) => r.name === 'Neu'), 'Speichern funktioniert');
      assert.deepEqual(echteFehler(log), []);
      await context.close();
    }
  });

  test('Tastatur: Backspace im Namensfeld löscht nur Zeichen, außerhalb schließt es; Esc schließt; Kürzel bei offenem Dialog gesperrt', async () => {
    const { context, page, log } = await newPage();
    await oeffne(page);
    await speichernUnter(page, 'Alpha');
    await regler(page, 'rNeigung', 0.4);
    const pos = await verlaufPos(page), z = await zustand(page);
    await page.click('#rsSpeichernUnter');
    await page.waitForSelector('#rsName:not([hidden])');
    await page.fill('#rsNameFeld', 'Gamma');
    await page.focus('#rsNameFeld');
    await page.keyboard.press('End');
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    assert.equal(await page.inputValue('#rsNameFeld'), 'Gam', 'Backspace löscht Zeichen');
    assert.equal(await page.isVisible('#rsName'), true, 'Dialog bleibt offen');
    await page.keyboard.press('Control+z');
    await page.focus('#rsNameOk');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Delete');
    assert.deepEqual(await verlaufPos(page), pos, 'Strg+Z bei offenem Dialog gesperrt');
    assert.deepEqual(await zustand(page), z);
    assert.equal(await page.isVisible('#rsName'), true);
    // (Strg+Z auf dem Knopf darf das eingebaute Rückgängig des Browsers im Textfeld auslösen; es setzt den Fokus dorthin)
    await page.focus('#rsNameOk');
    await page.keyboard.press('Backspace');   // außerhalb des Textfelds: schließt
    await page.waitForSelector('#rsName', { state: 'hidden' });
    assert.equal((await sammlung(page)).ringe.length, 1, 'Schließen = Abbrechen');
    await page.click('#rsSpeichernUnter');
    await page.waitForSelector('#rsName:not([hidden])');
    await page.keyboard.press('Escape');
    await page.waitForSelector('#rsName', { state: 'hidden' });
    await page.click('#rsSpeichernUnter');
    await page.waitForSelector('#rsName:not([hidden])');
    await page.keyboard.type('Delta'); await page.keyboard.press('Enter');
    await page.waitForSelector('#rsName', { state: 'hidden' });
    assert.equal((await sammlung(page)).aktiv, 'Delta', 'Enter bestätigt');
    // Rückfrage: Backspace = Abbrechen
    await page.click('#rsLoeschen'); await page.waitForSelector('#rsFrage:not([hidden])');
    await page.keyboard.press('Control+z');
    assert.equal((await sammlung(page)).aktiv, 'Delta', 'Strg+Z gesperrt');
    await page.keyboard.press('Backspace');
    await page.waitForSelector('#rsFrage', { state: 'hidden' });
    assert.equal((await sammlung(page)).ringe.length, 2, 'Backspace = Abbrechen');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
describe('Ring-Sammlung: Layout', () => {
  const GERAETE = [
    ['iPhone hoch', { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['iPhone quer', { viewport: { width: 874, height: 402 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['iPad', { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['Desktop', { viewport: { width: 1440, height: 900 } }]
  ];
  for (const [name, device] of GERAETE) {
    test(`Layout ${name}: Sammlungszeile und Dialoge ohne Überlappung und waagerechtes Scrollen, Tippflächen ≥ 44 × 44`, async () => {
      const { context, page, log } = await newPage({ device });
      await oeffne(page);
      await speichernUnter(page, 'Ein ziemlich langer Ringname für Tests');
      await regler(page, 'rNeigung', 0.4);   // „geändert“ sichtbar
      const W = device.viewport.width;
      const pruefe = async (was, sel) => {
        const m = await E(page, (s) => {
          const ziele = [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null);
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            ziele: ziele.map((e) => { const r = e.getBoundingClientRect(); return { t: (e.id || e.textContent.trim()).slice(0, 24), w: r.width, h: r.height, x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, tippen: !['span', 'label'].includes(e.localName) }; })
          };
        }, sel);
        assert.ok(m.overflow <= 0, `${name}/${was}: kein waagerechtes Scrollen (${m.overflow})`);
        assert.ok(m.ziele.length >= 2, `${name}/${was}: Elemente sichtbar`);
        for (const z of m.ziele) {
          if (z.tippen) assert.ok(z.w >= 44 && z.h >= 44, `${name}/${was}: Tippfläche „${z.t}“ ${z.w}×${z.h}`);
          assert.ok(z.x0 >= -0.5 && z.x1 <= W + 0.5, `${name}/${was}: „${z.t}“ im Fenster`);
        }
        for (let i = 0; i < m.ziele.length; i++) for (let j = i + 1; j < m.ziele.length; j++) {
          const a = m.ziele[i], b = m.ziele[j];
          const ueber = Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
          assert.ok(!ueber, `${name}/${was}: „${a.t}“ und „${b.t}“ überlappen nicht`);
        }
      };
      const ZEILE = '#ringSammlung select, #ringSammlung button, #ringSammlung .rs-geaendert, #ringSammlung label';
      assert.equal(await page.isVisible('#rsGeaendert'), true);
      await pruefe('Zeile', ZEILE);
      await page.screenshot({ path: path.join(OUT, `ring-sammlung-${name.replace(/\s+/g, '-').toLowerCase()}.png`) });
      await page.click('#rsUmbenennen');
      await page.waitForSelector('#rsName:not([hidden])');
      await pruefe('Namensdialog', '#rsName input, #rsName button');
      await page.click('#rsNameAbbrechen');
      await page.click('#rsLoeschen');
      await page.waitForSelector('#rsFrage:not([hidden])');
      await pruefe('Rückfrage Löschen', '#rsFrage button');
      await page.click('#rsFrageKnoepfe [data-wert="abbrechen"]');
      await speichernUnter(page, 'Zweiter');
      await regler(page, 'rBreite', 2.4);
      await waehle(page, 'Ein ziemlich langer Ringname für Tests');
      await page.waitForSelector('#rsFrage:not([hidden])');
      await pruefe('Rückfrage Umschalten', '#rsFrage button');
      await page.click('#rsFrageKnoepfe [data-wert="abbrechen"]');
      assert.deepEqual(echteFehler(log), []);
      await context.close();
    });
  }
});
