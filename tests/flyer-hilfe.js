// Hilfsdatei für die Flyer-Tests ab F3a (kein eigener Test): statischer Server, Chromium, eine Seite je Test mit
// nachgebauter GitHub-API (nur docs/flyer im Repo aether), Import, Downloads, Speicher-Auszug und ein Mini-Paket nur aus
// Platzhaltern (kein echter Flyer-Inhalt). Infrastruktur wie in tests/flyer.test.js.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const zlib = require('node:zlib');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
const BASE = '/repos/konstantin9ezm/aether';
const ORDNER = `${BASE}/contents/docs/flyer`;
const DATEI = `${ORDNER}/aether-flyer-paket.json`;
const BLOBS = `${BASE}/git/blobs/`;
const RAW = 'application/vnd.github.raw+json';
const SHA_A = 'aaaaaaa000000000000000000000000000000001';
const SHA_B = 'bbbbbbb000000000000000000000000000000002';
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Mini-Paket (Platzhalter) im Aufbau wie das echte: .page mit Kopf (Logo, Marke), Kästen (data-block), Kennzahlen,
// Balken, Symbol, Fußzeile mit Stand; eine Infografik mit Kästen und einem SVG-Diagramm.
// ---------------------------------------------------------------------------
const VERSION = '2020-02-01.1';
const STAND = '2020-02-01';
const LOGO = 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 30 11"><rect width="30" height="11" rx="2" fill="#8c7cf0"/></svg>').toString('base64');
const FLYER_CSS = [
  '@font-face{font-family:"Platzhalter Jost";src:url("fonts/jost/jost-latin-400-normal.woff") format("woff");font-weight:400}',
  '@font-face{font-family:"Platzhalter Jost";src:url("fonts/jost/jost-latin-600-normal.woff") format("woff");font-weight:600}',
  '@page{size:A4;margin:0}',
  'body{margin:0;font-family:"Platzhalter Jost",sans-serif}',
  '.page{--s:1;width:794px;height:1123px;position:relative;overflow:hidden;display:flex;flex-direction:column;background:#101a2c;color:#eef0f6;font-family:"Platzhalter Jost",sans-serif}',
  '.hd{padding:40px 48px 16px;flex:none}.brand{display:flex;justify-content:space-between;align-items:center}',
  '.logo{display:block;width:120px;height:44px;background:url("' + LOGO + '") left center/contain no-repeat}',
  '.kick{font-size:14px;text-transform:uppercase;letter-spacing:.1em}',
  'h1{margin:24px 0 0;font-size:calc(40px*var(--s));font-weight:600}.sub{margin:6px 0 0;font-size:calc(18px*var(--s))}',
  '.body{flex:1;min-height:0;overflow:hidden;padding:0 48px;display:flex;flex-direction:column}',
  '.lead{font-size:calc(16px*var(--s));margin:0 0 12px}',
  '.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.span2{grid-column:1/-1}',
  '.blk{background:#1c2a44;border:2px solid #34466a;border-radius:12px;padding:12px 14px;font-size:calc(14px*var(--s))}',
  '.blk h3{margin:0 0 6px;font-size:calc(13px*var(--s));text-transform:uppercase}',
  '.ls{margin:0;padding:0 0 0 18px}.st{display:flex;gap:10px}.sti{flex:1}.stv{font-size:calc(28px*var(--s));font-weight:600}',
  '.bars{display:flex;flex-direction:column;gap:6px}.bt{height:12px;background:#2a3550;border-radius:6px}.bf{height:100%;background:#8c7cf0;border-radius:6px}',
  '.fill{flex:1;min-height:0;display:flex;align-items:flex-end;justify-content:center}.fill svg{width:100%;height:100%;max-height:200px}.fill.off{visibility:hidden}',
  '.ft{flex:none;display:flex;justify-content:space-between;padding:14px 48px 28px;font-size:13px;color:#9aa3b8}',
  '[data-zaehler]:has(> .zaehler){display:flex;justify-content:space-between}.zaehler{font-size:.8em}'
].join('\n');
const IG_CSS = [
  '.ig{width:1080px;position:relative;padding:48px;background:#160f33;color:#ece8ff;font-family:"Platzhalter Jost",sans-serif}',
  '.ig h1{font-size:56px;margin:0 0 20px}.box{background:#211a4a;border:2px solid #3b3270;border-radius:20px;padding:20px;margin:0 0 20px;font-size:22px}',
  '.dia{display:block;width:100%;height:auto}.svt{font-family:"Platzhalter Jost";font-size:24px;fill:#ffffff}'
].join('\n');
const BLT = '<svg class="blt" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0L10 5 5 10 0 5z"></path></svg>';
function flyerHtml(id, titel, kat) {
  return `<section class="page c-${kat}" data-id="${id}" style="--s:1">` +
    '<header class="hd"><div class="brand"><i class="logo" role="img" aria-label="Logo"></i>' +
    `<span class="kick" data-t="t1">Platzhalter ${kat}</span></div><h1 data-t="t2">${titel}</h1><p class="sub" data-t="t3">Platzhalter-Untertitel</p></header>` +
    '<div class="body"><p class="lead" data-t="t4">Platzhalter-Einleitung für die Tests.</p><div class="grid">' +
    '<div class="blk t-stats span2"><div class="st"><div class="sti"><div class="stv" data-t="t5">12</div><div class="stl" data-t="t6">Platzhalter-Zahl</div></div>' +
    '<div class="sti"><div class="stv" data-t="t7">34</div><div class="stl" data-t="t8">Platzhalter-Zahl zwei</div></div></div></div>' +
    '<div class="blk t-list" data-block=""><h3 data-zaehler=""><ae-t data-t="t9">Platzhalter-Liste</ae-t></h3><ul class="ls">' +
    `<li data-s="s1" data-status="ok">${BLT}<ae-t data-t="t10">Punkt eins</ae-t></li><li data-s="s2" data-status="run">${BLT}<ae-t data-t="t11">Punkt zwei; mit „Umlaut“ äöü</ae-t></li></ul></div>` +
    '<div class="blk t-bars"><h3 data-t="t12">Platzhalter-Balken</h3><div class="bars"><div class="bt"><div class="bf" style="width:60%"></div></div></div></div>' +
    '</div><div class="fill"><svg viewBox="0 0 600 190" fill="none" stroke="currentColor" stroke-width="2"><circle cx="300" cy="95" r="80"></circle><path d="M40 150h520"></path></svg></div></div>' +
    `<footer class="ft"><span class="src" data-t="t13">Platzhalter-Quelle</span><span class="pg"><ae-t data-t="t14">${id} · Stand </ae-t><span data-stand="kurz">01.02.2020</span></span></footer></section>`;
}
function igHtml() {
  return '<section class="ig"><h1 data-t="t1">Platzhalter-Infografik</h1>' +
    '<div class="box" data-block=""><p data-t="t2">Platzhalter-Kasten</p></div>' +
    '<svg class="dia" viewBox="0 0 900 300"><rect x="10" y="10" width="880" height="280" rx="20" fill="#2a2258" stroke="#5e55a0" stroke-width="3"></rect>' +
    '<text x="450" y="160" text-anchor="middle" class="svt" data-t="t3">Platzhalter-Diagramm</text></svg>' +
    '<p class="ft" data-t="t4">Platzhalter-Fuß · <span data-stand="lang">1. Februar 2020</span></p></section>';
}
// 3 Flyer (S1, S2 in „spiel“, E1 in „engine“), 1 Infografik (I1 in „ig“), 4 Kategorien (eine ohne Dokumente)
function paketV1(opts = {}) {
  const { version = VERSION, stand = STAND, titel = 'Platzhalter-Paket' } = opts;
  return {
    format: 'aether-flyer-paket', formatVersion: 1, titel, version, stand,
    css: { flyer: FLYER_CSS, infografik: IG_CSS },
    kategorien: [{ id: 'spiel', name: 'Platzhalter Spiel' }, { id: 'engine', name: 'Platzhalter Engine' }, { id: 'ig', name: 'Platzhalter Infografik' }, { id: 'leer', name: 'Platzhalter leer' }],
    dokumente: [
      { id: 'S1', art: 'flyer', kategorie: 'spiel', titel: 'Platzhalter eins', breite: 794, hoehe: 1123, html: flyerHtml('S1', 'Platzhalter eins', 'spiel') },
      { id: 'S2', art: 'flyer', kategorie: 'spiel', titel: 'Platzhalter zwei', breite: 794, hoehe: 1123, html: flyerHtml('S2', 'Platzhalter zwei', 'spiel') },
      { id: 'E1', art: 'flyer', kategorie: 'engine', titel: 'Platzhalter drei', breite: 794, hoehe: 1123, html: flyerHtml('E1', 'Platzhalter drei', 'engine') },
      { id: 'I1', art: 'infografik', kategorie: 'ig', titel: 'Platzhalter-Infografik', breite: 1080, hoehe: null, html: igHtml() }
    ],
    zusatz: { bleibt: true }
  };
}

// ---------------------------------------------------------------------------
// Server, Browser, Mock-API
// ---------------------------------------------------------------------------
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.woff': 'font/woff', '.ttf': 'font/ttf' };
const umgebung = { server: null, baseUrl: '', browser: null };
async function starte() {
  umgebung.server = http.createServer((req, res) => {
    const u = new URL(req.url, 'http://x');
    let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => umgebung.server.listen(0, '127.0.0.1', r));
  umgebung.baseUrl = `http://localhost:${umgebung.server.address().port}/`;
  umgebung.browser = await chromium.launch();
}
async function beende() {
  await umgebung.browser?.close();
  await new Promise((r) => umgebung.server.close(r));
}
const mock = {};
function mockZurueck() { Object.assign(mock, { sha: SHA_A, datei: JSON.stringify(paketV1()), blobs: {}, requests: [] }); }
mockZurueck();
const CORS = { 'access-control-allow-origin': '*' };
async function githubApi(route) {
  const req = route.request(), url = new URL(req.url()), headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  mock.requests.push(url.pathname);
  const json = (status, obj) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(obj) });
  if (headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' });
  if (url.pathname === ORDNER) return json(200, [{ name: 'aether-flyer-paket.json', path: 'docs/flyer/aether-flyer-paket.json', sha: mock.sha, type: 'file' }]);
  if (url.pathname === DATEI) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': RAW }, body: mock.datei });
  if (url.pathname.startsWith(BLOBS)) {
    const sha = url.pathname.slice(BLOBS.length);
    const inhalt = mock.blobs[sha] || (sha === mock.sha ? mock.datei : null);
    if (inhalt === null) return json(404, { message: 'Not Found' });
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': RAW }, body: inhalt });
  }
  return json(404, { message: 'Not Found' });
}
// Ohne Teilen-Dialog (Download-Weg)
function ohneTeilen() { try { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } catch (e) { /* egal */ } navigator.share = undefined; navigator.canShare = undefined; }

// Neue Seite in eigenem Kontext; der Kontext wird immer geschlossen.
async function mitSeite(opts, fn) {
  const { viewport = { width: 1194, height: 834 }, withToken = false, init = [], hasTouch = false, isMobile = false, deviceScaleFactor } = opts;
  mockZurueck();
  const context = await umgebung.browser.newContext({ viewport, hasTouch, isMobile, deviceScaleFactor, locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptDownloads: true });
  try {
    const page = await context.newPage();
    const log = { errors: [], fremd: [] };
    page.on('pageerror', (e) => log.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
    await context.addInitScript(() => { window.AETHER_TEST_PROJECT_TIMEOUT_MS = 3000; window.AETHER_TEST_FLYER_FREIGABE_MS = 0; });
    if (withToken) await context.addInitScript((t) => { if (window === window.top) localStorage.setItem('aether.githubToken', t); }, TOKEN);
    for (const i of init) await context.addInitScript(i);
    await context.route('https://api.github.com/**', githubApi);
    await context.route(/^https?:\/\/(?!localhost[:/]|api\.github\.com\/)/, (r) => { log.fremd.push(r.request().url()); return r.abort(); });
    await fn({ context, page, log });
  } finally {
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Hilfen auf der Seite
// ---------------------------------------------------------------------------
const flyerUrl = () => umgebung.baseUrl + 'flyer.html';
const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, ' ').trim());
async function oeffneFlyer(page, url = flyerUrl()) {
  if (url) await page.goto(url);
  await page.waitForFunction(() => window.AetherFlyer && window.AetherFlyer.bereit);
  await page.evaluate(() => window.AetherFlyer.bereit);
}
async function importiere(page, inhalt, name = 'aether-flyer-paket.json') {
  const buffer = Buffer.from(typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt, null, 2), 'utf8');
  await page.setInputFiles('#dateiImport', { name, mimeType: 'application/json', buffer });
  await page.waitForFunction(() => document.getElementById('dateiImport').value === '' && !document.getElementById('btnImport').disabled);
}
async function einspielen(page, inhalt, name = 'aether-flyer-aenderungen.json') {
  const buffer = Buffer.from(typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt, null, 2), 'utf8');
  await page.setInputFiles('#dateiEinspielen', { name, mimeType: 'application/json', buffer });
  await page.waitForFunction(() => document.getElementById('dateiEinspielen').value === '' && !document.getElementById('btnEinspielen').disabled);
  await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
}
async function ruhe(page) {
  await page.evaluate(async () => {
    await window.AetherFlyerAnsicht.schriftenBereit();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
// Download über einen Klick → { name, puffer }
async function download(page, klick) {
  const [dl] = await Promise.all([page.waitForEvent('download'), klick()]);
  return { name: dl.suggestedFilename(), puffer: fs.readFileSync(await dl.path()) };
}
// Alles in IndexedDB „aether-flyer“: { store → { schluessel, werte, version } }
async function idb(page) {
  return page.evaluate(async () => {
    const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    const db = await req(indexedDB.open('aether-flyer'));
    const aus = {};
    for (const store of [...db.objectStoreNames]) {
      const s = db.transaction(store, 'readonly').objectStore(store);
      const [werte, schluessel] = await Promise.all([req(s.getAll()), req(s.getAllKeys())]);
      aus[store] = { schluessel, werte, version: db.version };
    }
    db.close();
    return aus;
  });
}
// Tafel: Titel und Knöpfe (Text) der obersten Tafel
async function tafel(page) {
  return page.evaluate(() => {
    const t = document.getElementById('tafel');
    if (!t || t.hidden) return null;
    // Knopftext: Teile (Kind-Elemente) mit Leerzeichen getrennt
    const teile = (b) => (b.children.length ? [...b.childNodes].map((n) => n.textContent.trim()).filter(Boolean).join(' ') : b.textContent).replace(/\s+/g, ' ').trim();
    return { titel: document.getElementById('tafelTitel').textContent, knoepfe: [...document.querySelectorAll('#tafelInhalt button')].map(teile) };
  });
}
async function tafelKnopf(page, textOderRe) {
  const re = typeof textOderRe === 'string' ? new RegExp('^' + textOderRe.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$') : textOderRe;
  await page.locator('#tafelInhalt button', { hasText: re }).first().click();
}

// Unabhängiger ZIP-Leser für die Prüfung (lokale Köpfe, zentrales Verzeichnis, Abschluss; CRC mit zlib.crc32)
// → [{ name, methode, crc, groesse, roh, daten (Buffer), crcOk }]
function liesZip(buf) {
  const b = Buffer.from(buf);
  const ende = b.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  assert.ok(ende >= 0, 'Ende des zentralen Verzeichnisses');
  const anzahl = b.readUInt16LE(ende + 10), zGroesse = b.readUInt32LE(ende + 12), zStart = b.readUInt32LE(ende + 16);
  assert.equal(b.readUInt16LE(ende + 8), anzahl);
  assert.equal(zStart + zGroesse, ende, 'zentrales Verzeichnis direkt vor dem Abschluss');
  const dateien = [];
  let p = zStart;
  for (let i = 0; i < anzahl; i++) {
    assert.equal(b.readUInt32LE(p), 0x02014b50, 'Eintrag im Verzeichnis');
    const methode = b.readUInt16LE(p + 10), crc = b.readUInt32LE(p + 16), groesse = b.readUInt32LE(p + 20), roh = b.readUInt32LE(p + 24);
    const nl = b.readUInt16LE(p + 28), xl = b.readUInt16LE(p + 30), kl = b.readUInt16LE(p + 32), lokal = b.readUInt32LE(p + 42);
    const name = b.subarray(p + 46, p + 46 + nl).toString('latin1');
    p += 46 + nl + xl + kl;
    assert.equal(b.readUInt32LE(lokal), 0x04034b50, `${name}: lokaler Kopf`);
    assert.equal(b.readUInt32LE(lokal + 14), crc, `${name}: CRC im lokalen Kopf = Verzeichnis`);
    const lnl = b.readUInt16LE(lokal + 26), lxl = b.readUInt16LE(lokal + 28);
    assert.equal(b.subarray(lokal + 30, lokal + 30 + lnl).toString('latin1'), name);
    const daten = b.subarray(lokal + 30 + lnl + lxl, lokal + 30 + lnl + lxl + groesse);
    dateien.push({ name, methode, crc, groesse, roh, daten, crcOk: zlib.crc32(daten) === crc });
  }
  return dateien;
}
// PNG: Breite und Höhe aus dem IHDR-Block
function pngMasse(buf) {
  const b = Buffer.from(buf);
  assert.ok(b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), 'PNG-Signatur');
  assert.equal(b.subarray(12, 16).toString('latin1'), 'IHDR');
  return { w: b.readUInt32BE(16), h: b.readUInt32BE(20) };
}

module.exports = {
  ROOT, OUT, TOKEN, SHA_A, SHA_B, VERSION, STAND, umgebung, starte, beende, mock, mitSeite, ohneTeilen, flyerUrl, text, oeffneFlyer,
  importiere, einspielen, ruhe, download, idb, tafel, tafelKnopf, paketV1, flyerHtml, igHtml, FLYER_CSS, IG_CSS, assert, liesZip, pngMasse
};
