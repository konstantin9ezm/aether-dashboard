// Tests für die Seite „Flyer & Infografiken“ (flyer.html mit flyer-paket.js, flyer-speicher.js, flyer-ansicht.js,
// flyer-online.js, flyer-export.js, flyer.js) mit nachgebauter GitHub-API und einem Mini-Paket nur aus Platzhaltern:
// Import, Kacheln, Chips, Vollbild (Tasten, Knöpfe, Wischen), Schriftanpassung, Bereinigung (script, on*, javascript:,
// externe url(), @import, link, iframe, externe Bilder), Paket-Funktionen, Online-Prüfung (sha, Banner, 404, falscher
// Dateiname, ohne Token, zu neu, Fehler, nie zwei gleichzeitig), PDF (Seiten, A4, auch ohne Vorbereitung über
// „beforeprint“), Bild (PNG doppelte Größe, verkleinert über 16 777 216 Pixel, nicht bereit, Selbstprobe/„tainted“),
// Offline aus der App-Hülle, Token in keinem Speicher, IndexedDB (Upgrade nicht blockiert, ohne IndexedDB), fehlende
// Module, Layout 320–1400 px (auch Neu-Skalieren bei Größenänderung), Dateien.
// Aufruf: node --test tests/flyer.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
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
const SHA_C = 'ccccccc000000000000000000000000000000003';
const SHA_D = 'ddddddd000000000000000000000000000000004';
const EVIL = 'https://evil.example';
const MODULE = ['flyer-paket.js', 'flyer-struktur.js', 'flyer-speicher.js', 'flyer-ansicht.js', 'flyer-online.js', 'flyer-export.js', 'flyer-zip.js', 'flyer-medien.js', 'flyer-aenderungen.js', 'flyer-bearbeiten.js', 'flyer-uebersicht.js', 'flyer-grafik.js', 'flyer-pptx.js', 'flyer-bibliothek.js', 'flyer-medien-tafeln.js', 'flyer-player.js', 'flyer-medien-online.js', 'flyer-werte.js', 'flyer.js'];   // dynamische Werte: flyer-werte.js; F3b: + Bibliothek (flyer-medien.js … flyer-medien-online.js); + PowerPoint-Export (flyer-pptx.js)
const FLYER_DATEIEN = ['flyer.html', ...MODULE];
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Mini-Paket (nur Platzhalter, kein echter Flyer-Inhalt)
// ---------------------------------------------------------------------------
const VERSION = '2026-11-17.1';
const STAND = '2026-11-17';
const KURZ = 'Kurzer Platzhaltertext.';
// Fülltext aus Platzhalter-Wörtern
function fuelltext(n) {
  const w = ['Platzhalter', 'Beispiel', 'Mustertext', 'Lorem', 'ipsum', 'dolor', 'sit', 'amet', 'Blindtext', 'Probe'];
  return Array.from({ length: n }, (_, i) => w[i % w.length]).join(' ') + '.';
}
const LANG = fuelltext(260);          // läuft bei --s = 1.42 über, passt deutlich über 0.80
const SEHR_LANG = fuelltext(2400);    // läuft auch bei 0.80 noch über

// Farben aus dem Paket-CSS (für die Pixelprüfung im Bild)
const FLYER_GRUND = [0x1a, 0x2b, 0x3c];
const IG_GRUND = [0xf0, 0xe0, 0xd0];
const IG_RECHTECK = [0x2a, 0x3b, 0x4c];
const IG_HOEHE = 2000;                // feste Höhe der Infografik im Paket-CSS (hoehe im Paket: null)

const FLYER_CSS = [
  '@font-face{font-family:"Platzhalter Jost";src:url("fonts/jost/jost-latin-400-normal.woff") format("woff");font-weight:400;font-style:normal}',
  '@font-face{font-family:"Platzhalter Jost";src:url("fonts/jost/jost-latin-700-normal.woff") format("woff");font-weight:700;font-style:normal}',
  '@page{size:A4;margin:0}',
  ':root{--s:1;--grund:#1a2b3c;--schrift:#f4f2fb}',
  'body{margin:0;font-family:"Platzhalter Jost",sans-serif}',
  '.page{width:794px;height:1123px;box-sizing:border-box;padding:48px;display:flex;flex-direction:column;overflow:hidden;' +
    'background:var(--grund);color:var(--schrift);font-family:"Platzhalter Jost",sans-serif;font-size:calc(20px*var(--s));line-height:1.3}',
  '.kopf{flex:none;display:flex;justify-content:space-between;align-items:baseline;gap:16px}',
  '.kopf h1{margin:0 0 24px;font-size:calc(36px*var(--s));font-weight:700}',
  '.body{flex:1;overflow:hidden;display:flex;flex-direction:column;min-height:0}',
  '.body p{margin:0 0 12px}',
  '.liste{margin:0 0 12px;padding-left:1.2em}',
  '.fill{flex:1;min-height:0;background:#2c3e50}',
  '.fill.off{display:none}',
  '.fuss{flex:none;padding-top:16px;font-size:16px}',
  '@media print{.page{break-inside:avoid}}'
].join('\n');

const IG_CSS = [
  ':root{--ig-grund:#f0e0d0}',
  `.ig{width:1080px;height:${IG_HOEHE}px;box-sizing:border-box;padding:40px;overflow:hidden;background:var(--ig-grund);color:#202020;` +
    'font-family:"Platzhalter Jost",sans-serif;font-size:32px}',
  '.ig h1{margin:0 0 20px;font-size:48px}',
  '.ig svg{display:block;width:1000px;height:1600px}',
  '@media print{.ig{break-inside:auto}}'
].join('\n');

// Markierungen wie im Paket-Format: data-t="t<n>" (eindeutig je Dokument), data-s="s<n>" mit data-status
// ok|run|next|plan, data-block mit data-zaehler, data-stand="kurz"|"lang", <ae-t> als Textstück.
// abstand: optional ein fester Block (px) vor der .fill-Fläche, um deren Höhe genau einzustellen
function flyerHtml(id, titel, text, stand, abstand) {
  return `<section class="page" data-stand="${stand}">` +
    `<header class="kopf"><h1 data-t="t1">${titel}</h1><span data-block="b1" data-zaehler="1">${id}</span></header>` +
    `<div class="body"><p data-t="t2"><ae-t>${text}</ae-t></p>` +
    '<ul class="liste"><li data-s="s1" data-status="run">Platzhalter-Status</li></ul>' +
    (abstand ? `<div class="abstand" style="height:${abstand}px;flex:none"></div>` : '') +
    '<div class="fill"></div></div>' +
    '<footer class="fuss"><span data-t="t3">Platzhalter-Fußzeile</span></footer></section>';
}
function igHtml() {
  return '<section class="ig" data-stand="lang"><h1 data-t="t1">Platzhalter-Infografik</h1>' +
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1000 1600" width="1000" height="1600">' +
    '<defs><linearGradient id="ig-verlauf"><stop offset="0" stop-color="#ff8800"/><stop offset="1" stop-color="#8800ff"/></linearGradient></defs>' +
    '<rect x="0" y="0" width="1000" height="1600" fill="#2a3b4c"/><circle cx="500" cy="400" r="200" fill="url(#ig-verlauf)"/>' +
    '<text x="500" y="900" text-anchor="middle" font-size="60" fill="#ffffff" data-t="t2">Platzhalter-Beschriftung</text></svg>' +
    '<p data-block="b1" data-zaehler="2"><ae-t>Platzhalter</ae-t> <span data-s="s1" data-status="ok">fertig</span></p></section>';
}
// 2 Flyer (T1, T2), 1 Infografik (I1), 2 Kategorien (Reihenfolge im Paket: grafik vor info), alle sechs Markierungen.
function testPaket(opts = {}) {
  const { version = VERSION, stand = STAND, formatVersion = 1, texte = {}, abstand = {}, titel = 'Platzhalter-Paket', leereKategorie = false } = opts;
  return {
    format: 'aether-flyer-paket',
    formatVersion,
    titel,
    version,
    stand,
    css: { flyer: FLYER_CSS, infografik: IG_CSS },
    kategorien: [
      { id: 'grafik', name: 'Platzhalter Grafik' },
      ...(leereKategorie ? [{ id: 'leer', name: 'Platzhalter ohne Dokumente' }] : []),
      { id: 'info', name: 'Platzhalter Info' }
    ],
    dokumente: [
      { id: 'T1', art: 'flyer', kategorie: 'info', titel: 'Platzhalter eins', breite: 794, hoehe: 1123, html: flyerHtml('T1', 'Platzhalter eins', texte.T1 || KURZ, 'kurz', abstand.T1) },
      { id: 'T2', art: 'flyer', kategorie: 'info', titel: 'Platzhalter zwei', breite: 794, hoehe: 1123, html: flyerHtml('T2', 'Platzhalter zwei', texte.T2 || KURZ, 'lang', abstand.T2) },
      { id: 'I1', art: 'infografik', kategorie: 'grafik', titel: 'Platzhalter-Infografik', breite: 1080, hoehe: null, html: igHtml() }
    ],
    unbekanntesFeld: { bleibt: true }
  };
}
// Dasselbe Paket mit eingeschleusten Gefahren in T1 und im Flyer-CSS
function boesesPaket() {
  const p = testPaket();
  const t1 = p.dokumente[0];
  t1.html = t1.html.replace('<div class="fill"></div>', [
    '<script>window.__pwned=(window.__pwned||[]).concat("script")</script>',
    '<img alt="" class="kaputt" src="data:image/png;base64,kaputt" onerror="window.__pwned=(window.__pwned||[]).concat(\'onerror\')">',
    '<a class="link" href="javascript:window.__pwned=(window.__pwned||[]).concat(\'javascript\')">Platzhalter-Link</a>',
    `<span class="stil" style="background-image:url('${EVIL}/style-attr.png');color:#123456">Platzhalter</span>`,
    `<link rel="stylesheet" href="${EVIL}/link.css">`,
    `<iframe src="${EVIL}/frame.html"></iframe>`,
    `<img alt="" class="fremd" src="${EVIL}/img.png">`,
    `<svg width="20" height="20" onload="window.__pwned=(window.__pwned||[]).concat('svg')"><image class="fremd" href="${EVIL}/svg-image.png" width="20" height="20"/>` +
      `<a><set attributeName="href" to="${EVIL}/set"/><text x="0" y="10">x</text></a></svg>`,
    `<style>@import url("${EVIL}/style-import.css"); .stil{background:url(${EVIL}/style-el.png)}</style>`,
    '<div class="fill"></div>'
  ].join(''));
  p.css.flyer = `@import url("${EVIL}/import.css");\n${p.css.flyer}\n.page{border-image:url(${EVIL}/css.png) 30}\n` +
    `.kopf{background:\\75 rl(${EVIL}/escape.png)}\n.liste{background-image:image-set("${EVIL}/set.png" 1x)}`;
  return p;
}

// ---------------------------------------------------------------------------
// Statischer Server (kann „kein Netz“ spielen) und Mock-API
// ---------------------------------------------------------------------------
const net = { offline: false };
const mock = {};
function mockZurueck() {
  Object.assign(mock, {
    modus: 'ok',            // ok | 404 (kein Ordner docs/flyer) | auth (401) | offline (abgebrochen) | hang (antwortet nie)
    ordner: null,           // eigene Ordnerliste statt der Standardliste
    sha: SHA_A,             // sha der Paket-Datei in der Ordnerliste
    datei: JSON.stringify(testPaket()),
    blobs: {},              // sha → Inhalt für git/blobs (der aktuelle mock.sha liefert mock.datei)
    halteDatei: null,       // Promise: die Datei-Antwort (contents) wartet darauf
    verzoegerung: 0,        // ms bis zur Antwort
    requests: [], offen: 0, maxOffen: 0
  });
}
mockZurueck();
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.ttf': 'font/ttf' };
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

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset' };
function standardOrdner() {
  return [
    { name: 'README.md', path: 'docs/flyer/README.md', sha: 'eeeeeee000000000000000000000000000000005', type: 'file' },
    { name: 'aether-flyer-paket.json', path: 'docs/flyer/aether-flyer-paket.json', sha: mock.sha, type: 'file' },
    { name: 'bilder', path: 'docs/flyer/bilder', sha: 'fffffff000000000000000000000000000000006', type: 'dir' }
  ];
}
async function antwort(route, url, headers) {
  const json = (status, obj) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(obj) });
  if (headers.authorization !== `Bearer ${TOKEN}` || mock.modus === 'auth') return json(401, { message: 'Bad credentials' });
  const ref = url.searchParams.get('ref');
  if (url.pathname === ORDNER && ref === 'main') {
    if (mock.modus === '404') return json(404, { message: 'Not Found' });
    return json(200, mock.ordner || standardOrdner());
  }
  if (url.pathname === DATEI && ref === 'main') {
    if (mock.halteDatei) await mock.halteDatei;
    if (mock.modus === '404') return json(404, { message: 'Not Found' });
    // Wie GitHub: nur mit Accept raw kommt die Datei selbst, sonst JSON mit base64-Inhalt.
    if (headers.accept === RAW) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': `${RAW}; charset=utf-8` }, body: mock.datei });
    return json(200, { name: 'aether-flyer-paket.json', sha: mock.sha, encoding: 'base64', content: Buffer.from(mock.datei).toString('base64') });
  }
  // Wie GitHub: git/blobs/<sha> liefert genau den Inhalt zu diesem sha (unveränderlich), mit Accept raw als Datei
  if (url.pathname.startsWith(BLOBS)) {
    const sha = url.pathname.slice(BLOBS.length);
    const inhalt = Object.prototype.hasOwnProperty.call(mock.blobs, sha) ? mock.blobs[sha] : (sha === mock.sha ? mock.datei : null);
    if (inhalt === null || mock.modus === '404') return json(404, { message: 'Not Found' });
    if (headers.accept === RAW) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': `${RAW}; charset=utf-8` }, body: inhalt });
    return json(200, { sha, encoding: 'base64', content: Buffer.from(inhalt).toString('base64') });
  }
  // Das Dashboard selbst (für den Service Worker geöffnet) fragt die Build-Liste ab: leer.
  if (url.pathname === `${BASE}/contents/index.json`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': RAW }, body: '[]' });
  return json(404, { message: 'Not Found' });
}
async function githubApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  mock.requests.push({ method: req.method(), path: url.pathname, query: url.search, ref: url.searchParams.get('ref'), auth: headers.authorization || null, accept: headers.accept || '' });
  if (mock.modus === 'offline') return route.abort('internetdisconnected').catch(() => {});
  if (mock.modus === 'hang') return; // antwortet nie
  mock.offen++;
  mock.maxOffen = Math.max(mock.maxOffen, mock.offen);
  try {
    if (mock.verzoegerung) await new Promise((r) => setTimeout(r, mock.verzoegerung));
    await antwort(route, url, headers);
  } catch (e) { /* Kontext schon geschlossen */ } finally { mock.offen--; }
}
// Anfragen an die Mock-API kurz benannt: 'ordner', 'datei', 'blob:<sha>' oder der Pfad
const anfragen = () => mock.requests.filter((r) => r.path.startsWith(ORDNER) || r.path.startsWith(BLOBS))
  .map((r) => (r.path === ORDNER ? 'ordner' : r.path === DATEI ? 'datei' : r.path.startsWith(BLOBS) ? 'blob:' + r.path.slice(BLOBS.length) : r.path));

// Teilen-Dialog nachgebaut (wie in logo.test.js): merkt sich Dateien, PNG-Maße, Pixel an window.__punkte und den Inhalt
function shareMock() {
  window.__share = { calls: [] };
  window.__punkte = [];
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    const active = navigator.userActivation ? navigator.userActivation.isActive : null;
    const files = await Promise.all(d.files.map(async (f) => {
      const buf = await f.arrayBuffer(), b = new Uint8Array(buf);
      const out = { name: f.name, type: f.type, bytes: b.length, sig: [...b.slice(0, 8)].join(',') };
      if (f.type === 'image/png') {
        const v = new DataView(buf); out.w = v.getUint32(16); out.h = v.getUint32(20);
        const bmp = await createImageBitmap(f), cv = new OffscreenCanvas(bmp.width, bmp.height), ctx = cv.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        out.pixel = window.__punkte.map(([x, y]) => [...ctx.getImageData(x, y, 1, 1).data]);
        out.base64 = await new Promise((r) => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(f); });
      }
      return out;
    }));
    window.__share.calls.push({ title: d.title, files, active });
  };
}
// window.print gestubbt: zählt Aufrufe (die PDF entsteht per page.pdf)
function druckStub() { window.__druck = 0; window.print = () => { window.__druck++; }; }
// Ereignisse der Ansicht mitschreiben
function ereignisseMitschreiben() {
  window.__ereignisse = [];
  document.addEventListener('flyer:vollbild', (e) => window.__ereignisse.push(['vollbild', e.detail && e.detail.dok ? e.detail.dok.id : null, e.detail ? e.detail.offen : null]));
  document.addEventListener('flyer:kategorie', (e) => window.__ereignisse.push(['kategorie', e.detail ? e.detail.kategorie : null, ((e.detail && e.detail.liste) || []).map((d) => d.id).join(',')]));
}

// Neue Seite in eigenem Kontext; der Kontext wird immer geschlossen (auch wenn ein Test scheitert).
async function mitSeite(opts, fn) {
  const { viewport = { width: 1194, height: 834 }, withToken = true, init = [], hasTouch = false } = opts;
  net.offline = false;
  mockZurueck();
  const context = await browser.newContext({ viewport, hasTouch, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  try {
    const page = await context.newPage();
    const log = { urls: [], errors: [], fremd: [] };
    page.on('pageerror', (e) => log.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
    context.on('request', (r) => log.urls.push(r.url()));
    await context.addInitScript(() => { window.AETHER_TEST_PROJECT_TIMEOUT_MS = 3000; window.AETHER_TEST_KARTEN_OFFEN = true; });
    if (withToken) await context.addInitScript((t) => { if (window === window.top) localStorage.setItem('aether.githubToken', t); }, TOKEN);
    for (const i of init) await context.addInitScript(i);
    await context.route('https://api.github.com/**', githubApi);
    // Alles Fremde abbrechen und protokollieren
    await context.route(/^https?:\/\/(?!localhost[:/]|api\.github\.com\/)/, (r) => { log.fremd.push(r.request().url()); return r.abort(); });
    await fn({ context, page, log });
  } finally {
    net.offline = false;
    await context.close();
  }
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------
const flyerUrl = () => baseUrl + 'flyer.html';
const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, ' ').trim());
const AKTUELL = (v) => new RegExp(`^Aktuell \\(Version ${v.replace(/\./g, '\\.')}\\) · geprüft \\d\\d:\\d\\d Uhr$`);
// Nur erwartete Netzfehler-Meldungen herausfiltern
const ohne = (errors, re) => errors.filter((e) => !re.test(e));
// Chromium meldet schon beim Parsen eines on*-Attributs per DOMParser (fremdes, inaktives Dokument) unter der CSP der
// Seite „Executing inline event handler violates …“ – ausgeführt wird dabei nichts. Diese Meldung ist hier erwartet.
const CSP_PARSE = /^Executing inline event handler violates the following Content Security Policy directive 'script-src 'self''/;
async function bis(fn, was, timeout = 10000) {
  const ende = Date.now() + timeout;
  while (!fn()) {
    if (Date.now() > ende) throw new Error(`Zeitlimit: ${was}`);
    await new Promise((r) => setTimeout(r, 20));
  }
}
async function oeffneFlyer(page, url = flyerUrl()) {
  if (url) await page.goto(url);
  await page.waitForFunction(() => window.AetherFlyer && window.AetherFlyer.bereit);
  await page.evaluate(() => window.AetherFlyer.bereit);
}
// Wartet, bis keine Online-Prüfung (und kein Laden über das Banner) mehr läuft.
async function onlineFertig(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('btnOnline'), h = document.getElementById('onlineHinweis').textContent;
    return b && !b.hidden && !b.disabled && !/^(Prüfe|Lade) online/.test(h);
  });
}
// Datei über #dateiImport wählen; fertig, wenn das Feld zurückgesetzt und der Knopf wieder frei ist.
async function importiere(page, inhalt, name = 'aether-flyer-paket.json') {
  const buffer = Buffer.from(typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt, null, 2), 'utf8');
  await page.setInputFiles('#dateiImport', { name, mimeType: 'application/json', buffer });
  await page.waitForFunction(() => document.getElementById('dateiImport').value === '' && !document.getElementById('btnImport').disabled);
}
// Bis alle angestoßenen Darstellungen fertig angepasst sind (Schriften bereit, dann ein Bild)
async function ruhe(page) {
  await page.evaluate(async () => {
    await window.AetherFlyerAnsicht.schriftenBereit();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
const kacheln = (page) => page.$$eval('#kacheln .kachel', (ks) => ks.map((k) => ({
  id: k.dataset.id, art: k.dataset.art, kid: k.querySelector('.kachel-id').textContent, titel: k.querySelector('.kachel-titel').textContent,
  warnung: !k.querySelector('.kachel-warnung').hidden, warnText: k.querySelector('.kachel-warnung').textContent, tag: k.tagName
})));
// F3a: Ordner statt Kategorie-Chips. Ordner-Kacheln [id, Name, Zahl] und der Pfad (Glieder, das aktuelle mit „*“)
const ordnerKacheln = (page) => page.$$eval('#ordnerKacheln .ordner-kachel', (ks) => ks.map((k) => [k.dataset.ordner, k.querySelector('.ok-name').textContent, k.querySelector('.ok-zahl').textContent]));
const pfad = (page) => page.$$eval('#pfad .pfad-glied', (bs) => bs.map((b) => b.textContent + (b.hasAttribute('aria-current') ? '*' : '')));
// „Alle“ über den Pfad, ein Ordner über seine Kachel (von „Alle“ aus) – ersetzt den Klick auf einen Chip
async function waehle(page, id) {
  if (await page.evaluate(() => window.AetherFlyerAnsicht.aktuellerOrdner()) !== null) await page.click('#pfad .pfad-glied[data-ordner=""]');
  if (id !== 'alle') await page.click(`#ordnerKacheln .ordner-kachel[data-ordner="${id}"] .ok-oeffnen`);
}
const vollbildOffen = (page) => page.$eval('#vollbild', (v) => !v.hidden && getComputedStyle(v).display !== 'none');
const zaehler = (page) => text(page, '#vbZaehler');
// --s der Wurzel und die .fill-Flächen (Höhe ohne „off“ gemessen) eines Darstellungs-Hosts
const wurzelInfo = (page, sel) => page.$eval(sel, (host) => {
  const w = host.shadowRoot.querySelector('section');
  const fills = [...w.querySelectorAll('.fill')].map((f) => {
    const off = f.classList.contains('off');
    f.classList.remove('off');
    const h = f.offsetHeight;
    if (off) f.classList.add('off');
    return { off, h };
  });
  return { s: w.style.getPropertyValue('--s'), fills, tag: w.localName };
});
const KACHEL_HOST = (id) => `#kacheln .kachel[data-id="${id}"] .flyer-host`;
const VB_HOST = '#vbBuehne .flyer-host';
// Touch-Wischen auf der Bühne (TouchEvent wie auf iPhone/iPad)
async function wische(page, dx, dy) {
  await page.evaluate(([dx, dy]) => {
    const el = document.getElementById('vbBuehne');
    const r = el.getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 200);
    const t0 = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
    el.dispatchEvent(new TouchEvent('touchstart', { touches: [t0], targetTouches: [t0], changedTouches: [t0], bubbles: true, cancelable: true }));
    const t1 = new Touch({ identifier: 1, target: el, clientX: x + dx, clientY: y + dy });
    el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t1], bubbles: true, cancelable: true }));
  }, [dx, dy]);
}
// PDF: Seiten zählen (/Type /Page ohne s) und MediaBox lesen
function pdfInfo(buf) {
  const s = buf.toString('latin1');
  assert.equal(s.slice(0, 5), '%PDF-', 'PDF-Signatur');
  const seiten = (s.match(/\/Type\s*\/Page(?!s)/g) || []).length;
  const boxen = [...s.matchAll(/\/MediaBox\s*\[\s*([-\d.\s]+?)\s*\]/g)].map((m) => m[1].split(/\s+/).map(Number));
  return { seiten, boxen };
}
// PDF: Inhalt (entpackter Content-Stream) je Seite in Seitenreihenfolge (Seitenbaum über /Kids)
function pdfSeiten(buf) {
  const s = buf.toString('latin1');
  const obj = new Map();
  for (const m of s.matchAll(/(\d+) 0 obj\s*([\s\S]*?)endobj/g)) obj.set(Number(m[1]), m[2]);
  const strom = (n) => {
    const o = obj.get(n), i = o.indexOf('stream');
    let a = i + 6;
    if (o[a] === '\r') a++;
    if (o[a] === '\n') a++;
    const roh = Buffer.from(o.slice(a, o.lastIndexOf('endstream')), 'latin1');
    return (/FlateDecode/.test(o.slice(0, i)) ? zlib.inflateSync(roh) : roh).toString('latin1');
  };
  const katalog = [...obj.values()].find((o) => /\/Type\s*\/Catalog/.test(o));
  const seiten = [];
  const geh = (n) => {
    const o = obj.get(n);
    if (/\/Type\s*\/Pages\b/.test(o)) for (const k of /\/Kids\s*\[([^\]]*)\]/.exec(o)[1].matchAll(/(\d+) 0 R/g)) geh(Number(k[1]));
    else seiten.push(o);
  };
  geh(Number(/\/Pages\s+(\d+) 0 R/.exec(katalog)[1]));
  return seiten.map((o) => [...o.matchAll(/\/Contents\s+(\d+) 0 R/g)].map((m) => strom(Number(m[1]))).join('\n'));
}
// Erster Ausschnitt (clip) einer Seite in Punkt (über die erste Transformation): ohne Seitenrand = ganze Seite ab 0 0
function pdfAusschnitt(inhalt) {
  const cm = /(-?[\d.]+) 0 0 (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) cm/.exec(inhalt);
  const re = /(-?[\d.]+) (-?[\d.]+) (-?[\d.]+) (-?[\d.]+) re\s+W\*? n/.exec(inhalt);
  if (!cm || !re) return null;
  const [a, d] = [Math.abs(Number(cm[1])), Math.abs(Number(cm[2]))];
  return { x: Number(re[1]) * a, y: Number(re[2]) * d, w: Number(re[3]) * a, h: Number(re[4]) * d };
}
function assertA4(boxen, label) {
  assert.ok(boxen.length > 0, `${label}: MediaBox vorhanden`);
  for (const b of boxen) {
    const [x0, y0, x1, y1] = b;
    assert.ok(Math.abs((x1 - x0) - 595.3) < 2 && Math.abs((y1 - y0) - 841.9) < 2, `${label}: MediaBox A4 (≈ 595 × 842 pt), ist ${b.join(' ')}`);
  }
}
// Alles, was die Seite speichert: localStorage, sessionStorage, alle Caches (Inhalt) und alle IndexedDB-Stores
async function speicher(page) {
  return page.evaluate(async (token) => {
    const ls = Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]);
    const ss = Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)]);
    const cache = [];
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) {
        const body = await (await c.match(req)).text();
        // Nur das echte Token (index.html enthält den Platzhalter „github_pat_…“ im Eingabefeld)
        cache.push({ name, url: req.url, token: body.includes(token) || req.url.includes(token), auth: req.headers.get('authorization') });
      }
    }
    const idb = [];
    const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
    for (const { name } of await indexedDB.databases()) {
      const db = await req(indexedDB.open(name));
      for (const store of [...db.objectStoreNames]) {
        const s = db.transaction(store, 'readonly').objectStore(store);
        const [werte, schluessel] = await Promise.all([req(s.getAll()), req(s.getAllKeys())]);
        idb.push({ db: name, version: db.version, store, schluessel, werte, json: JSON.stringify(werte) });
      }
      db.close();
    }
    return { ls, ss, cache, idb, cookie: document.cookie };
  }, TOKEN);
}
function assertKeinToken(st, label) {
  for (const [k, v] of st.ls) if (k !== 'aether.githubToken') assert.ok(!v.includes(TOKEN) && !v.includes('github_pat_'), `${label}: kein Token in localStorage ${k}`);
  assert.deepEqual(st.ss, [], `${label}: sessionStorage leer`);
  assert.equal(st.cookie, '', `${label}: keine Cookies`);
  for (const c of st.cache) {
    assert.ok(!c.token && !c.auth, `${label}: kein Token im Cache ${c.name}: ${c.url}`);
    assert.ok(!c.url.includes('api.github.com'), `${label}: keine API-Antwort im Cache: ${c.url}`);
  }
  for (const e of st.idb) assert.ok(!e.json.includes(TOKEN) && !e.json.includes('github_pat_'), `${label}: kein Token in IndexedDB ${e.db}/${e.store}`);
}

// ---------------------------------------------------------------------------
describe('Flyer: Import und Ansicht', () => {
  test('ohne Paket: Kopfzeile, Leer-Hinweis; Import: Kopfzeile, Paket-Zeile, Kacheln, Chips, Kategorien; gespeichert', async () => {
    await mitSeite({ withToken: false, init: [ereignisseMitschreiben] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      assert.equal(await page.title(), 'Aether – Flyer');
      assert.equal(await text(page, '#status'), 'noch kein Paket');
      assert.ok(await page.isVisible('#leer'));
      assert.equal(await text(page, '#leer'), 'Noch kein Paket – „Online prüfen“ oder „Paket importieren“.');
      assert.equal(await page.evaluate(() => window.AetherFlyer.stand()), 'leer');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket()), null);
      assert.equal(await page.$$eval('#kacheln > *', (es) => es.length), 0);
      assert.equal(await page.$$eval('#ordnerKacheln > *', (es) => es.length), 0, 'ohne Paket keine Ordner (F3a statt Chips)');
      assert.ok(await page.isHidden('#pfad'));
      assert.equal(await text(page, '#paketInfo'), '');
      // Kopfzeile wie im Logo-Werkzeug
      const back = await page.$eval('#zumDashboard', (a) => ({ href: a.getAttribute('href'), text: a.textContent.trim(), r: a.getBoundingClientRect().toJSON() }));
      assert.deepEqual([back.href, back.text], ['./#projekt', '‹ Dashboard']);
      assert.ok(back.r.height >= 44 && back.r.width >= 44);
      assert.equal(await text(page, '.kopf .titel'), 'Flyer & Infografiken');
      assert.equal(await page.getAttribute('#dateiImport', 'accept'), null, 'kein accept-Attribut (iOS)');
      // Module: je ein eingefrorenes Objekt
      const module = await page.evaluate(() => ['AetherFlyerPaket', 'AetherFlyerSpeicher', 'AetherFlyerAnsicht', 'AetherFlyerOnline', 'AetherFlyerExport', 'AetherFlyer']
        .map((n) => [n, typeof window[n], Object.isFrozen(window[n])]));
      for (const [n, typ, frozen] of module) assert.deepEqual([n, typ, frozen], [n, 'object', true]);
      assert.ok(await page.evaluate(() => window.AetherFlyer.bereit instanceof Promise));
      // Online ohne Token: nur Hinweis
      await onlineFertig(page);
      assert.equal(await text(page, '#onlineHinweis'), 'Ohne Token keine Online-Prüfung – gezeigt wird der gespeicherte Stand.');

      // Import (mit einer Kategorie ohne Dokumente: F3a – sie wird ein leerer Ordner)
      await importiere(page, testPaket({ leereKategorie: true }));
      assert.ok(await page.isHidden('#fehler'), 'kein Fehler');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      assert.equal(await text(page, '#paketInfo'), 'Platzhalter-Paket · Version 2026-11-17.1 · 3 Dokumente');
      assert.ok(await page.isHidden('#leer'), 'Leer-Hinweis aus');
      assert.equal(await text(page, '#toast'), 'Paket importiert (Version 2026-11-17.1, 3 Dokumente)');
      assert.equal(await page.evaluate(() => window.AetherFlyer.stand()), 'paket');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), VERSION);
      assert.deepEqual(await kacheln(page), [
        { id: 'T1', art: 'flyer', kid: 'T1', titel: 'Platzhalter eins', warnung: false, warnText: 'Text zu lang', tag: 'BUTTON' },
        { id: 'T2', art: 'flyer', kid: 'T2', titel: 'Platzhalter zwei', warnung: false, warnText: 'Text zu lang', tag: 'BUTTON' },
        { id: 'I1', art: 'infografik', kid: 'I1', titel: 'Platzhalter-Infografik', warnung: false, warnText: 'Text zu lang', tag: 'BUTTON' }
      ]);
      assert.deepEqual(await ordnerKacheln(page), [['grafik', 'Platzhalter Grafik', '1 Seite'], ['leer', 'Platzhalter ohne Dokumente', '0 Seiten'], ['info', 'Platzhalter Info', '2 Seiten']],
        'Ordner (aus den Kategorien) in Paket-Reihenfolge');
      assert.deepEqual(await pfad(page), ['Alle*']);
      // Vorschau: Host in Shadow DOM, per transform auf Kachelbreite skaliert
      const vorschau = await page.$$eval('#kacheln .kachel', (ks) => ks.map((k) => {
        const bild = k.querySelector('.kachel-bild'), host = bild.querySelector('.flyer-host');
        return { id: host.dataset.id, art: host.dataset.art, shadow: !!host.shadowRoot, wurzel: host.shadowRoot && host.shadowRoot.querySelector('section') ? host.shadowRoot.querySelector('section').className : null,
          bildBreite: bild.getBoundingClientRect().width, hostBreite: host.getBoundingClientRect().width, transform: host.style.transform };
      }));
      for (const v of vorschau) {
        assert.ok(v.shadow, `${v.id}: Shadow Root`);
        assert.ok(Math.abs(v.bildBreite - v.hostBreite) <= 1.5, `${v.id}: auf Kachelbreite skaliert (${v.hostBreite} vs. ${v.bildBreite})`);
        assert.match(v.transform, /scale\(/, `${v.id}: Skalierung per transform`);
      }
      assert.deepEqual(vorschau.map((v) => [v.id, v.art, v.wurzel]), [['T1', 'flyer', 'page'], ['T2', 'flyer', 'page'], ['I1', 'infografik', 'ig']]);
      // Seiten-CSS wirkt nicht ins Dokument, Paket-CSS nur im Shadow Root
      const grund = await page.$eval(KACHEL_HOST('T1'), (h) => getComputedStyle(h.shadowRoot.querySelector('section')).backgroundColor);
      assert.equal(grund, 'rgb(26, 43, 60)', 'Paket-CSS (:root → :host) wirkt im Shadow Root');
      assert.notEqual(await page.$eval('body', (b) => getComputedStyle(b).backgroundColor), 'rgb(26, 43, 60)', 'Paket-CSS wirkt nicht auf die Seite');
      // Gespeichert (IndexedDB, ohne Token)
      const g = await page.evaluate(() => window.AetherFlyer.gespeichert());
      assert.deepEqual(Object.keys(g).sort(), ['paket', 'quelle', 'sha', 'uebernommen']);
      assert.deepEqual([g.quelle, g.sha, g.paket.version, g.paket.dokumente.length], ['import', null, VERSION, 3]);
      assert.match(g.uebernommen, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
      assert.deepEqual(g.paket.unbekanntesFeld, { bleibt: true }, 'unbekannte Felder bleiben');

      // Kategorien
      await waehle(page, 'info');
      assert.deepEqual((await kacheln(page)).map((k) => k.id), ['T1', 'T2']);
      assert.deepEqual(await pfad(page), ['Alle', 'Platzhalter Info*']);
      assert.equal(await page.evaluate(() => window.AetherFlyerAnsicht.aktuelleKategorie()), 'info');
      await waehle(page, 'grafik');
      assert.deepEqual((await kacheln(page)).map((k) => k.id), ['I1']);
      await waehle(page, 'alle');
      assert.deepEqual((await kacheln(page)).map((k) => k.id), ['T1', 'T2', 'I1']);
      await ruhe(page);
      const ev = await page.evaluate(() => window.__ereignisse.filter((e) => e[0] === 'kategorie'));
      for (const e of [['kategorie', 'info', 'T1,T2'], ['kategorie', 'grafik', 'I1'], ['kategorie', 'alle', 'T1,T2,I1']]) {
        assert.ok(ev.some((x) => JSON.stringify(x) === JSON.stringify(e)), `Ereignis flyer:kategorie ${e.join(' ')} (${JSON.stringify(ev)})`);
      }
      await page.screenshot({ path: path.join(OUT, 'flyer-import-1194x834.png') });
      // Nach Neuladen: dasselbe Paket aus IndexedDB
      await page.reload();
      await oeffneFlyer(page, null);
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      assert.equal((await kacheln(page)).length, 3);
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Vollbild: „1 / 3“, ←/→ und ‹/› blättern (ohne Umlauf), Wischen, Esc/Backspace schließen; Tasten wirken nicht in Eingabefeldern und nicht mit Strg/Cmd/Alt', async () => {
    await mitSeite({ withToken: false, hasTouch: true, init: [ereignisseMitschreiben] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, testPaket());
      // Ohne offenes Vollbild bewirken die Tasten nichts
      await page.keyboard.press('ArrowRight');
      assert.equal(await vollbildOffen(page), false);
      await page.click('#kacheln .kachel[data-id="T1"]');
      await ruhe(page);
      assert.equal(await vollbildOffen(page), true);
      assert.equal(await zaehler(page), '1 / 3');
      assert.equal(await text(page, '#vbTitel'), 'T1 · Platzhalter eins');
      assert.ok(await page.isHidden('#vbWarnung'));
      assert.equal(await page.getAttribute('#vollbild', 'role'), 'dialog');
      // Dokument auf Bühnenbreite skaliert
      const sk = await page.evaluate(() => {
        const b = document.getElementById('vbBuehne'), h = b.querySelector('.flyer-host');
        return { id: h.dataset.id, bw: b.clientWidth, hw: h.getBoundingClientRect().width, t: h.style.transform };
      });
      assert.equal(sk.id, 'T1');
      assert.ok(sk.hw <= sk.bw + 1 && sk.hw >= sk.bw - 40, `auf Bühnenbreite skaliert (${sk.hw} von ${sk.bw})`);
      assert.match(sk.t, /scale\(/);
      await page.screenshot({ path: path.join(OUT, 'flyer-vollbild-T1.png') });

      // Tasten
      await page.keyboard.press('ArrowLeft');
      assert.equal(await zaehler(page), '1 / 3', 'am Anfang kein Umlauf');
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehler(page), '2 / 3');
      assert.equal(await text(page, '#vbTitel'), 'T2 · Platzhalter zwei');
      assert.equal(await page.$eval(VB_HOST, (h) => h.dataset.id), 'T2');
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehler(page), '3 / 3');
      assert.equal(await text(page, '#vbTitel'), 'I1 · Platzhalter-Infografik');
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehler(page), '3 / 3', 'am Ende kein Umlauf');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await zaehler(page), '2 / 3');
      // Knöpfe ‹/›
      await page.click('#vbWeiter');
      assert.equal(await zaehler(page), '3 / 3');
      await page.click('#vbZurueck');
      await page.click('#vbZurueck');
      assert.equal(await zaehler(page), '1 / 3');
      assert.deepEqual(await page.$$eval('#vbZurueck, #vbWeiter, #vbZu', (bs) => bs.map((b) => b.getAttribute('aria-label'))), ['Voriges', 'Nächstes', 'Schließen']);
      // Wischen: nach links = nächstes, nach rechts = voriges; zu kurz oder zu schräg = nichts
      await wische(page, -200, 10);
      assert.equal(await zaehler(page), '2 / 3', 'nach links gewischt');
      await wische(page, 200, -20);
      assert.equal(await zaehler(page), '1 / 3', 'nach rechts gewischt');
      await wische(page, -40, 0);
      assert.equal(await zaehler(page), '1 / 3', 'zu kurz');
      await wische(page, -80, 70);
      assert.equal(await zaehler(page), '1 / 3', 'zu schräg');
      await wische(page, 200, 0);
      assert.equal(await zaehler(page), '1 / 3', 'am Anfang kein Umlauf beim Wischen');
      // Esc schließt, Fokus zurück auf die Kachel
      await page.keyboard.press('Escape');
      assert.equal(await vollbildOffen(page), false);
      assert.equal(await page.evaluate(() => { const a = document.activeElement; return a && a.closest('.kachel') ? a.closest('.kachel').dataset.id : null; }), 'T1', 'Fokus auf der Kachel');
      assert.equal(await page.$$eval('#vbBuehne .flyer-host', (h) => h.length), 0, 'Bühne geleert');
      // Backspace schließt ebenso
      await page.click('#kacheln .kachel[data-id="T2"]');
      assert.equal(await zaehler(page), '2 / 3');
      await page.keyboard.press('Backspace');
      assert.equal(await vollbildOffen(page), false);
      assert.equal(await page.evaluate(() => document.activeElement.closest('.kachel')?.dataset.id), 'T2');
      // Enter auf einer Kachel öffnet ebenso
      await page.focus('#kacheln .kachel[data-id="I1"]');
      await page.keyboard.press('Enter');
      assert.equal(await vollbildOffen(page), true, 'Enter auf der Kachel öffnet');
      assert.equal(await zaehler(page), '3 / 3');
      await page.keyboard.press('Escape');
      assert.equal(await vollbildOffen(page), false);
      assert.equal(await page.evaluate(() => document.activeElement.closest('.kachel')?.dataset.id), 'I1');
      // Gehaltene Taste (repeat) schließt nicht
      await page.click('#kacheln .kachel[data-id="T1"]');
      for (const key of ['Escape', 'Backspace']) {
        await page.evaluate((key) => document.dispatchEvent(new KeyboardEvent('keydown', { key, repeat: true, bubbles: true, cancelable: true })), key);
        assert.equal(await vollbildOffen(page), true, `${key} mit repeat schließt nicht`);
      }
      // Fokus in einem Texteingabefeld: ←/→/Esc/Backspace wirken nicht
      // (auch Datum, Zeit, Regler, Zahl, Farbe, Auswahlknopf und Auswahlliste: dort gehören Pfeile/Backspace dem Feld)
      const INPUT_TYPEN = ['date', 'datetime-local', 'time', 'month', 'week', 'range', 'number', 'color', 'radio', 'email', 'password'];
      for (const art of ['input', 'textarea', 'contenteditable', 'shadow-input', 'select', 'textarea-readonly', ...INPUT_TYPEN.map((t) => 'input-' + t)]) {
        await page.evaluate((art) => {
          let el;
          if (art === 'input') { el = document.createElement('input'); el.type = 'text'; el.value = 'Platzhalter'; }
          else if (art.startsWith('input-')) { el = document.createElement('input'); el.type = art.slice(6); }
          else if (art === 'select') { el = document.createElement('select'); for (const t of ['eins', 'zwei']) el.add(new Option('Platzhalter ' + t, t)); }
          else if (art === 'textarea-readonly') { el = document.createElement('textarea'); el.readOnly = true; el.value = 'Platzhalter'; }
          else if (art === 'textarea') { el = document.createElement('textarea'); el.value = 'Platzhalter'; }
          else if (art === 'contenteditable') { el = document.createElement('div'); el.contentEditable = 'true'; el.textContent = 'Platzhalter'; }
          else {
            // Eingabefeld in einem Shadow Root (Fokus muss durch den Shadow Root verfolgt werden)
            el = document.createElement('div');
            const i = document.createElement('input'); i.type = 'search'; i.value = 'Platzhalter';
            el.attachShadow({ mode: 'open' }).appendChild(i);
          }
          el.id = 'testEingabe';
          document.getElementById('vollbild').appendChild(el);
          (el.shadowRoot ? el.shadowRoot.querySelector('input') : el).focus();
        }, art);
        for (const key of ['ArrowRight', 'ArrowLeft', 'Escape', 'Backspace']) {
          await page.keyboard.press(key);
          assert.equal(await vollbildOffen(page), true, `${art}: ${key} schließt nicht`);
          assert.equal(await zaehler(page), '1 / 3', `${art}: ${key} blättert nicht`);
        }
        await page.evaluate(() => document.getElementById('testEingabe').remove());
      }
      // Gegenstück: Knöpfe (auch <input type="button">) sind keine Eingabefelder – dort blättern die Pfeile
      await page.evaluate(() => {
        const el = document.createElement('input'); el.type = 'button'; el.value = 'Platzhalter'; el.id = 'testEingabe';
        document.getElementById('vollbild').appendChild(el); el.focus();
      });
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehler(page), '2 / 3', 'input type=button: → blättert');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await zaehler(page), '1 / 3', 'input type=button: ← blättert');
      await page.evaluate(() => document.getElementById('testEingabe').remove());
      // Fokus auf einem Kontrollkästchen (kein Texteingabefeld): Pfeile blättern
      await page.evaluate(() => {
        const c = document.createElement('input'); c.type = 'checkbox'; c.id = 'testEingabe';
        document.getElementById('vollbild').appendChild(c); c.focus();
      });
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehler(page), '2 / 3', 'Kontrollkästchen: Pfeil blättert');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await zaehler(page), '1 / 3');
      await page.evaluate(() => { document.getElementById('testEingabe').remove(); document.getElementById('vbBuehne').focus(); });
      // Mit Strg/Cmd/Alt wirken die Tasten nicht
      for (const mod of ['Control', 'Meta', 'Alt']) {
        await page.keyboard.press(`${mod}+ArrowRight`);
        assert.equal(await zaehler(page), '1 / 3', `${mod}+Pfeil blättert nicht`);
        await page.keyboard.press(`${mod}+Escape`);
        assert.equal(await vollbildOffen(page), true, `${mod}+Esc schließt nicht`);
      }
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehler(page), '2 / 3', 'ohne Zusatztaste blättert der Pfeil wieder');
      // ✕ schließt
      await page.click('#vbZu');
      assert.equal(await vollbildOffen(page), false);
      // Im Vollbild zählt die Liste der gewählten Kategorie
      await waehle(page, 'info');
      await page.click('#kacheln .kachel[data-id="T2"]');
      assert.equal(await zaehler(page), '2 / 2');
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehler(page), '2 / 2');
      assert.deepEqual(await page.evaluate(() => [window.AetherFlyerAnsicht.offenesDokument().id, window.AetherFlyerAnsicht.aktuelleListe().map((d) => d.id)]), ['T2', ['T1', 'T2']]);
      await page.keyboard.press('Escape');
      assert.equal(await page.evaluate(() => window.AetherFlyerAnsicht.offenesDokument()), null);
      // Ereignisse für den Export
      const ev = await page.evaluate(() => window.__ereignisse.filter((e) => e[0] === 'vollbild'));
      assert.deepEqual(ev.slice(0, 3), [['vollbild', 'T1', true], ['vollbild', 'T2', true], ['vollbild', 'I1', true]], 'Öffnen und Blättern (← am Anfang meldet nichts)');
      assert.ok(ev.some((e) => e[2] === false), 'Schließen meldet offen:false');
      assert.deepEqual(ev[ev.length - 1], ['vollbild', 'T2', false]);
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Schriftanpassung: kurz → --s 1.42; lang → zwischen 0.80 und 1.42 ohne Hinweis; sehr lang → 0.80 und „Text zu lang“ an Kachel und Vollbild; .fill unter 90 px aus', async () => {
    await mitSeite({ withToken: false }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, testPaket({ texte: { T1: KURZ, T2: LANG } }));
      // Paket-Schriften vom eigenen Ursprung geladen (fonts/jost/…)
      const schriften = await page.evaluate(() => [...document.fonts].filter((f) => /Platzhalter Jost/.test(f.family)).map((f) => [f.weight, f.status]).sort());
      assert.deepEqual(schriften, [['400', 'loaded'], ['700', 'loaded']]);
      assert.equal(await page.evaluate(() => window.AetherFlyerAnsicht.schriftenGeladen()), true);
      for (const w of ['400', '700']) assert.ok(log.urls.includes(`${baseUrl}fonts/jost/jost-latin-${w}-normal.woff`), `Schrift ${w} vom eigenen Ursprung`);
      const dokRegeln = await page.$eval('head style#flyerDokRegeln', (s) => s.textContent);
      assert.equal((dokRegeln.match(/@font-face/g) || []).length, 2, '@font-face im Dokument');
      assert.match(dokRegeln, /@page\s*\{\s*size:\s*A4\s*!important;\s*margin:\s*0\s*!important\s*\}\s*$/, 'eigene @page-Regel (mit !important) als letzte');
      assert.doesNotMatch(dokRegeln, /\.page\s*\{/, 'nur @font-face und @page im Dokument');

      // kurz
      const t1 = await wurzelInfo(page, KACHEL_HOST('T1'));
      assert.equal(t1.s, '1.42', 'kurzer Text: --s = 1.42');
      assert.equal(t1.fills.length, 1);
      assert.ok(!t1.fills[0].off && t1.fills[0].h >= 90, `kurzer Text: .fill bleibt (${t1.fills[0].h} px)`);
      // lang
      const t2 = await wurzelInfo(page, KACHEL_HOST('T2'));
      const s2 = Number(t2.s);
      assert.match(t2.s, /^\d\.\d\d$/, '--s mit zwei Nachkommastellen');
      assert.ok(s2 < 1.42 && s2 > 0.80, `langer Text: 0.80 < --s < 1.42 (ist ${t2.s})`);
      for (const f of t2.fills) assert.equal(f.off, f.h < 90, `.fill off genau dann, wenn niedriger als 90 px (${f.h} px, off=${f.off})`);
      // Infografik ohne .body: keine Anpassung
      assert.equal((await wurzelInfo(page, KACHEL_HOST('I1'))).s, '', 'Infografik ohne --s');
      assert.deepEqual((await kacheln(page)).map((k) => k.warnung), [false, false, false], 'kein Hinweis');
      // Vollbild: gleiche Anpassung
      await page.click('#kacheln .kachel[data-id="T2"]');
      await ruhe(page);
      assert.equal((await wurzelInfo(page, VB_HOST)).s, t2.s, 'Vollbild: gleiches --s wie die Kachel');
      assert.ok(await page.isHidden('#vbWarnung'), 'Vollbild: kein Hinweis');
      // Direkter Aufruf liefert dasselbe
      const r = await page.$eval(VB_HOST, (h) => window.AetherFlyerAnsicht.schriftAnpassen(h.shadowRoot.querySelector('section')));
      assert.deepEqual(r, { s: s2, zuLang: false });
      await page.keyboard.press('Escape');

      // Kategorie bleibt bei neuem Paket erhalten; sehr langer Text
      await waehle(page, 'info');
      await importiere(page, testPaket({ texte: { T2: SEHR_LANG } }));
      assert.equal(await page.evaluate(() => window.AetherFlyerAnsicht.aktuelleKategorie()), 'info', 'Kategorie bleibt');
      assert.deepEqual(await pfad(page), ['Alle', 'Platzhalter Info*'], 'Ordner bleibt geöffnet');
      const k = await kacheln(page);
      assert.deepEqual(k.map((x) => [x.id, x.warnung]), [['T1', false], ['T2', true]], '„Text zu lang“ an der Kachel');
      assert.ok(await page.isVisible('#kacheln .kachel[data-id="T2"] .kachel-warnung'));
      const t2b = await wurzelInfo(page, KACHEL_HOST('T2'));
      assert.equal(t2b.s, '0.80', 'sehr langer Text: --s = 0.80');
      assert.ok(t2b.fills.every((f) => f.off && f.h < 90), '.fill aus (kein Platz)');
      await page.click('#kacheln .kachel[data-id="T2"]');
      await ruhe(page);
      assert.equal(await zaehler(page), '2 / 2');
      assert.ok(await page.isVisible('#vbWarnung'), '„Text zu lang“ im Vollbild');
      assert.equal(await text(page, '#vbWarnung'), 'Text zu lang');
      assert.equal((await wurzelInfo(page, VB_HOST)).s, '0.80');
      await page.screenshot({ path: path.join(OUT, 'flyer-zu-lang.png') });
      // Blättern zu T1: Hinweis verschwindet
      await page.keyboard.press('ArrowLeft');
      await ruhe(page);
      assert.ok(await page.isHidden('#vbWarnung'), 'T1 ohne Hinweis');
      assert.equal((await wurzelInfo(page, VB_HOST)).s, '1.42');
      await page.keyboard.press('Escape');

      // Schwelle 90 px genau: Block so hoch, dass bei --s = 1.42 noch 45 px (T1) bzw. 140 px (T2) für .fill bleiben
      const h0 = t1.fills[0].h;
      await importiere(page, testPaket({ abstand: { T1: h0 - 45, T2: h0 - 140 } }));
      const a1 = await wurzelInfo(page, KACHEL_HOST('T1')), a2 = await wurzelInfo(page, KACHEL_HOST('T2'));
      assert.deepEqual([a1.s, a1.fills[0].off, Math.round(a1.fills[0].h)], ['1.42', true, 45], '.fill 45 px hoch → off');
      assert.deepEqual([a2.s, a2.fills[0].off, Math.round(a2.fills[0].h)], ['1.42', false, 140], '.fill 140 px hoch → bleibt (auch nach vorher 0.80 für T2)');
      assert.deepEqual((await kacheln(page)).map((x) => x.warnung), [false, false]);
      // Knapp an der Schwelle: 88 px → off, 92 px → bleibt (Gegenprobe: eine Schwelle von 60 px oder 100 px wird rot)
      await importiere(page, testPaket({ abstand: { T1: h0 - 88, T2: h0 - 92 } }));
      const b1 = await wurzelInfo(page, KACHEL_HOST('T1')), b2 = await wurzelInfo(page, KACHEL_HOST('T2'));
      assert.deepEqual([b1.s, b1.fills[0].off, Math.round(b1.fills[0].h)], ['1.42', true, 88], '.fill 88 px hoch → off');
      assert.deepEqual([b2.s, b2.fills[0].off, Math.round(b2.fills[0].h)], ['1.42', false, 92], '.fill 92 px hoch → bleibt');
      // Überlauf-Kriterium genau „scrollHeight > clientHeight + 1“: Inhalt fester Höhe (unabhängig von --s), 1 px zu
      // hoch → gilt noch als passend (1.42); 2 px zu hoch → läuft bei jedem s über (0.80, „zu lang“).
      const toleranz = await page.evaluate(() => {
        const A = window.AetherFlyerAnsicht;
        const box = document.createElement('div');
        box.style.cssText = 'position:absolute;left:0;top:0;width:794px';
        document.body.appendChild(box);
        const d = A.darstellen({ id: 'X1', art: 'flyer', kategorie: 'info', titel: 'X', breite: 794, hoehe: 1123,
          html: '<section class="page"><div class="body"><div class="block" style="height:10px;flex:none"></div></div></section>' }, box);
        const body = d.wurzel.querySelector('.body'), block = d.wurzel.querySelector('.block');
        const ch = body.clientHeight;
        const mit = (px) => { block.style.height = (ch + px) + 'px'; return A.schriftAnpassen(d.wurzel); };
        const r = { ch, p0: mit(0), p1: mit(1), p2: mit(2), p1b: mit(1) };
        box.remove();
        return r;
      });
      assert.ok(toleranz.ch > 500, `.body hat Höhe (${toleranz.ch} px)`);
      assert.deepEqual(toleranz.p0, { s: 1.42, zuLang: false }, 'genau voll: passt');
      assert.deepEqual(toleranz.p1, { s: 1.42, zuLang: false }, '1 px Überstand: noch passend (+1)');
      assert.deepEqual(toleranz.p2, { s: 0.8, zuLang: true }, '2 px Überstand: Überlauf bis 0.80');
      assert.deepEqual(toleranz.p1b, { s: 1.42, zuLang: false }, 'wieder 1 px: zurück auf 1.42');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Schriften erst nach der Frist da: Kacheln, Vollbild, Druck und „Text zu lang“ werden mit der echten Schrift neu angepasst', async () => {
    // Frist kurz (300 ms), Paket-Schriften kommen erst auf Freigabe; Ersatzschrift monospace (deutlich breiter als Jost)
    const init = [() => {
      window.AETHER_TEST_FLYER_SCHRIFT_FRIST_MS = 300;
      window.__schriftenSpaet = 0;
      document.addEventListener('flyer:schriften', () => { window.__schriftenSpaet++; });
    }, druckStub];
    await mitSeite({ withToken: false, init }, async ({ context, page, log }) => {
      let freigabe;
      const schriftenFrei = new Promise((r) => { freigabe = r; });
      await context.route(/\/fonts\/jost\/[^/]+\.woff$/, async (route) => { await schriftenFrei; await route.continue().catch(() => {}); });
      await oeffneFlyer(page);
      const p = testPaket({ texte: { T2: LANG } });
      p.css.flyer = p.css.flyer.replace(/"Platzhalter Jost",sans-serif/g, '"Platzhalter Jost",monospace');
      await importiere(page, p);
      const status = () => page.evaluate(() => [...document.fonts].filter((f) => /Platzhalter Jost/.test(f.family)).map((f) => f.status).sort().join(','));
      assert.equal(await status(), 'loading,loading', 'Schriften laden noch (Frist abgelaufen)');
      const frueh = await wurzelInfo(page, KACHEL_HOST('T2'));
      const fruehWarnung = (await kacheln(page)).find((k) => k.id === 'T2').warnung;
      // Vollbild und Druck schon jetzt (mit der Ersatzschrift) vorbereitet
      await page.click('#kacheln .kachel[data-id="T2"]');
      await page.evaluate(() => window.AetherFlyerExport.druckvorbereitung(window.AetherFlyerAnsicht.paket().dokumente.filter((d) => d.art === 'flyer')));
      freigabe();
      await page.waitForFunction(() => window.__schriftenSpaet > 0, null, { timeout: 15000 });
      assert.equal(await status(), 'loaded,loaded');
      await ruhe(page);
      // Überlaufkriterium mit der echten Schrift: bei s kein Überlauf, bei s + 0.02 Überlauf (bzw. s = 1.42)
      const pruefe = (sel) => page.$eval(sel, (h) => {
        const w = h.shadowRoot.querySelector('section'), body = w.querySelector('.body');
        const s = Number(w.style.getPropertyValue('--s'));
        const ueber = () => body.scrollHeight > body.clientHeight + 1;
        const beiS = ueber();
        w.style.setProperty('--s', (Math.round((s + 0.02) * 100) / 100).toFixed(2));
        const darueber = s >= 1.42 || ueber();
        w.style.setProperty('--s', s.toFixed(2));
        return { s, beiS, darueber };
      });
      const kachel = await pruefe(KACHEL_HOST('T2'));
      assert.deepEqual([kachel.beiS, kachel.darueber], [false, true], `Kachel T2 mit echter Schrift angepasst (--s ${kachel.s}, mit Ersatzschrift ${frueh.s})`);
      assert.ok(Number(frueh.s) < kachel.s, `Ersatzschrift ergab ein kleineres --s (${frueh.s} → ${kachel.s}) – sonst prüfte der Test nichts`);
      assert.deepEqual(await pruefe(VB_HOST), kachel, 'Vollbild ebenso');
      assert.equal(await page.$eval('#druck .druck-seite[data-id="T2"] .flyer-host', (h) => h.shadowRoot.querySelector('section').style.getPropertyValue('--s')),
        kachel.s.toFixed(2), 'Druck ebenso');
      // „Text zu lang“ folgt der neuen Messung
      const k = (await kacheln(page)).find((x) => x.id === 'T2');
      assert.equal(k.warnung, false, `kein „Text zu lang“ mit der echten Schrift (vorher: ${fruehWarnung})`);
      assert.ok(await page.isHidden('#vbWarnung'));
      await page.keyboard.press('Escape');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Bereinigung: kein Skript, keine Anfrage nach außen, nichts Gefährliches im Shadow-DOM; alle sechs Markierungen bleiben', async () => {
    await mitSeite({ withToken: false, init: [() => { window.__pwned = undefined; }] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      const p = boesesPaket();
      assert.match(p.dokumente[0].html, /<script>[\s\S]*onerror=[\s\S]*javascript:[\s\S]*<iframe/, 'Testpaket enthält die Gefahren');
      await importiere(page, p);
      assert.ok(await page.isHidden('#fehler'));
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      await page.click('#kacheln .kachel[data-id="T1"]');
      await ruhe(page);
      // Kaputtes eingebettetes Bild ist fertig (Fehler-Ereignis vorbei), bevor geprüft wird
      await page.waitForFunction(() => [...document.querySelectorAll('.flyer-host[data-id="T1"]')].every((h) => [...h.shadowRoot.querySelectorAll('img')].every((i) => i.complete)));
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => setTimeout(r, 0))));
      assert.equal(await page.evaluate(() => window.__pwned), undefined, 'nichts ausgeführt');
      // Link anklicken führt nichts aus
      await page.$eval(VB_HOST, (h) => h.shadowRoot.querySelector('a.link').click());
      assert.equal(await page.evaluate(() => window.__pwned), undefined, 'Link führt nichts aus');
      const hosts = await page.evaluate(() => [...document.querySelectorAll('.flyer-host[data-id="T1"]')].map((h) => {
        const sr = h.shadowRoot;
        const css = [...sr.adoptedStyleSheets].map((s) => [...s.cssRules].map((r) => r.cssText).join('\n')).join('\n') + '\n' +
          [...sr.querySelectorAll('style')].map((s) => s.textContent).join('\n');
        const alle = [...sr.querySelectorAll('*')];
        const m = (sel) => [...sr.querySelectorAll(sel)];
        return {
          ort: h.closest('#vbBuehne') ? 'vollbild' : 'kachel',
          html: sr.innerHTML, css,
          elemente: [...new Set(alle.map((e) => e.localName))],
          attrs: alle.flatMap((e) => [...e.attributes].map((a) => [e.localName, a.name, a.value])),
          link: m('a.link').map((a) => a.getAttribute('href')),
          stil: m('.stil').map((e) => e.getAttribute('style')),
          kaputt: m('img.kaputt').map((i) => i.getAttribute('src')),
          fremd: m('.fremd').map((e) => [e.localName, e.getAttribute('src'), e.getAttribute('href')]),
          marken: {
            t: m('[data-t]').map((e) => e.getAttribute('data-t')),
            aet: m('ae-t').length,
            s: m('[data-s]').map((e) => [e.getAttribute('data-s'), e.getAttribute('data-status')]),
            block: m('[data-block]').map((e) => [e.getAttribute('data-block'), e.getAttribute('data-zaehler')]),
            stand: m('[data-stand]').map((e) => e.getAttribute('data-stand'))
          }
        };
      }));
      assert.deepEqual(hosts.map((h) => h.ort).sort(), ['kachel', 'vollbild']);
      for (const h of hosts) {
        const l = h.ort;
        for (const el of ['script', 'iframe', 'link', 'set', 'meta', 'base', 'object', 'embed']) assert.ok(!h.elemente.includes(el), `${l}: kein <${el}>`);
        assert.deepEqual(h.attrs.filter(([, n]) => /^on/i.test(n)), [], `${l}: keine on*-Attribute`);
        assert.deepEqual(h.attrs.filter(([, , v]) => /evil\.example|javascript:/i.test(v)), [], `${l}: keine fremden Ziele in Attributen`);
        assert.doesNotMatch(h.html, /evil\.example|javascript:|<script|<iframe|<link|\son[a-z]+\s*=/i, `${l}: nichts davon im Shadow-DOM`);
        assert.doesNotMatch(h.css, /evil\.example|@import/i, `${l}: kein externes CSS`);
        assert.deepEqual(h.link, [null], `${l}: javascript:-Link ohne href`);
        assert.equal(h.stil.length, 1);
        assert.match(h.stil[0], /color:\s*#123456/, `${l}: harmloser Stil bleibt`);
        assert.deepEqual(h.kaputt, ['data:image/png;base64,kaputt'], `${l}: data:image bleibt (ohne Handler)`);
        assert.deepEqual(h.fremd, [['img', null, null], ['image', null, null]], `${l}: externe Bilder ohne Ziel`);
        // Markierungen
        assert.deepEqual(h.marken.t, ['t1', 't2', 't3'], `${l}: data-t`);
        assert.equal(h.marken.aet, 1, `${l}: <ae-t>`);
        assert.deepEqual(h.marken.s, [['s1', 'run']], `${l}: data-s + data-status`);
        assert.deepEqual(h.marken.block, [['b1', '1']], `${l}: data-block + data-zaehler`);
        assert.deepEqual(h.marken.stand, ['kurz'], `${l}: data-stand`);
      }
      // Markierungen der Infografik (auch an SVG-Text)
      const ig = await page.$eval(KACHEL_HOST('I1'), (h) => {
        const sr = h.shadowRoot;
        return { t: [...sr.querySelectorAll('[data-t]')].map((e) => [e.localName, e.getAttribute('data-t')]), aet: sr.querySelectorAll('ae-t').length,
          s: sr.querySelector('[data-s]').getAttribute('data-status'), z: sr.querySelector('[data-block]').getAttribute('data-zaehler'), stand: sr.querySelector('[data-stand]').getAttribute('data-stand'),
          fill: sr.querySelector('circle').getAttribute('fill') };
      });
      assert.deepEqual(ig, { t: [['h1', 't1'], ['text', 't2']], aet: 1, s: 'ok', z: '2', stand: 'lang', fill: 'url(#ig-verlauf)' }, 'Infografik: Markierungen und lokaler Verlauf url(#…)');
      assert.doesNotMatch(await page.$eval('#flyerDokRegeln', (s) => s.textContent), /evil\.example|@import/);
      assert.equal(await page.evaluate(() => document.scripts.length), 1 + MODULE.length, 'nur die eigenen Skripte (gemeinsam.js und die Module)');   // F3b: Zahl aus der Modulliste
      assert.ok(!log.urls.some((u) => u.includes('evil.example')), 'nichts von evil.example angefragt');
      assert.deepEqual(log.fremd, []);
      // Je eingeschleustem Handler (onerror, onload) höchstens eine Meldung vom Parsen; ein überlebender Handler käme dazu
      assert.ok(log.errors.filter((e) => CSP_PARSE.test(e)).length <= 2, `CSP-Meldungen nur vom Parsen (${log.errors.length})`);
      assert.deepEqual(ohne(log.errors, CSP_PARSE), [], 'kein Fehler');
    });
  });

  test('Paket-Funktionen: Format prüfen, Version vergleichen, Datum, CSS bereinigen und zerlegen, Wurzel-Selektoren', async () => {
    await mitSeite({ withToken: false }, async ({ page, log }) => {
      await oeffneFlyer(page);
      const r = await page.evaluate(([paket, flyerCss]) => {
        const P = window.AetherFlyerPaket;
        const fang = (fn) => { try { fn(); return null; } catch (e) { return { kind: e.kind, title: e.title, text: e.text }; } };
        const kopie = () => JSON.parse(JSON.stringify(paket));
        const mit = (f) => { const p = kopie(); f(p); return p; };
        return {
          konst: [P.FORMAT, P.FORMAT_VERSION, P.DATEI],
          gleich: P.pruefe(paket) === paket,
          vergleich: [['2026-11-17.2', '2026-11-17.1'], ['2026-11-17.1', '2026-11-16.9'], ['2026-11-17.10', '2026-11-17.9'], ['2026-11-16.9', '2026-11-17.1'],
            ['2026-11-17.1', '2026-11-17.1'], ['2026-11-17', '2026-11-17.0'], ['2026-11-18-kaputt', '2026-11-17.5']].map(([a, b]) => P.vergleicheVersion(a, b)),
          datum: [P.datum('2026-11-17'), P.datum('kein Datum')],
          wurzel: [':root{--a:1}', 'html, body{margin:0}', 'body > .page{a:1}', '@media print{body{a:1}}',
            '.body{flex:1}', '.page .body{a:1}', '.body > p{a:1}', 'body.x{a:1}', 'tbody td{a:1}', '#body{a:1}', 'body-x{a:1}', '[body]{a:1}',
            '.a{content:"body"}', '@supports (display:grid){.body{a:1}}'].map((c) => P.wurzelSelektoren(c, ':host')),
          wurzelBild: P.wurzelSelektoren(':root{--a:1}\nbody .x{b:2}', '.ae-wurzel'),
          css: ['.a{background:url(https://evil.example/x.png)}', '.a{background:\\75 rl(https://evil.example/x.png)}', '@import url("x.css");.a{color:red}',
            '/* Kommentar */.a{color:red}', '.a{background:url(data:image/png;base64,AAAA)}', '.a{fill:url(#g)}', '@font-face{src:url("fonts/jost/x.woff")}',
            '@font-face{src:url("fonts/../geheim.woff")}', '.a{background:image-set("https://evil.example/a.png" 1x)}', '.a{content:"\\2192"}',
            '@media print{@import "y.css";.a{color:red}}', '.a{background:URL( "//evil.example/x.png" )}'].map((c) => P.bereinigeCss(c)),
          // url(#…) nur in fill, stroke, clip-path, filter, marker* (dort lokaler Verweis); sonst holte der Browser die Seite
          anker: ['.a{background:url(#g)}', '.a{background-image:url("#g")}', '.a{content:url(#g)}', '.a{--x:url(#g)}', '@font-face{src:url(#f)}',
            '.a{clip-path:url("#c");stroke:url(#s);filter:url(#f);marker-end:url(#m);FILL:url(#g)}', '.a{fill:url(#g)}.b{list-style-image:url(#g)}',
            '.a{background:var(--x,[;fill:] url(#g))}', '.a{border-image:image-set("#g" 1x)}', '.a{fill/**/:url(#g)}'].map((c) => P.bereinigeCss(c)),
          ankerStil: P.bereinigeHtml('<section style="background:url(#g);fill:url(#g)"></section>').getAttribute('style'),
          // @font-face/@page auch aus Gruppenregeln; @page mit Seitenauswahl und @font-face mit Schriftnamen der Seite weg
          gruppen: P.zerlegeCss('@layer basis{@font-face{font-family:"X";src:url("fonts/jost/a.woff")}.p{color:red}}\n' +
            '@media print{@page{margin:5mm}.a{b:c}}\n@supports (display:grid){@font-face{font-family:"Y";src:url("fonts/jost/b.woff")}}\n' +
            '@page :first{size:A3}\n@page titel{size:A3}\n@media print{@page :left{margin:9mm}}\n' +
            '@font-face{font-family:"Avenir Next";src:url("fonts/jost/c.woff")}\n@font-face{font-family:Segoe   UI;src:url("fonts/jost/d.woff")}\n' +
            '@media screen{@font-face{font-family:"-apple-system";src:url("fonts/jost/e.woff")}}\n.p{color:blue}'),
          seite: [P.SEITEN_VARIABLEN, P.SEITEN_SCHRIFTEN],
          zerlegt: P.zerlegeCss(flyerCss),
          html: (() => { const w = P.bereinigeHtml('<script>x</script><section class="w" onclick="x()"><a href="#anker">a</a><a href="https://evil.example/">b</a><img src="data:image/png;base64,AA"></section>'); return [w.localName, w.outerHTML]; })(),
          leer: fang(() => P.bereinigeHtml('nur Text')),
          fehler: {
            json: fang(() => P.lies('{')),
            format: fang(() => P.lies('{"format":"x"}')),
            zuneu: fang(() => P.pruefe(mit((p) => { p.formatVersion = 3; }))),
            fv: fang(() => P.pruefe(mit((p) => { p.formatVersion = '1'; }))),
            art: fang(() => P.pruefe(mit((p) => { delete p.dokumente[2].art; }))),
            doppelt: fang(() => P.pruefe(mit((p) => { p.dokumente[1].id = 'T1'; }))),
            keine: fang(() => P.pruefe(mit((p) => { p.dokumente = []; }))),
            stand: fang(() => P.pruefe(mit((p) => { p.stand = '17.11.2026'; }))),
            breite: fang(() => P.pruefe(mit((p) => { p.dokumente[0].breite = 0; })))
          }
        };
      }, [testPaket(), FLYER_CSS]);
      assert.deepEqual(r.konst, ['aether-flyer-paket', 2, 'aether-flyer-paket.json']);
      assert.equal(r.gleich, true, 'pruefe gibt das Objekt zurück');
      assert.deepEqual(r.vergleich, [1, 1, 1, -1, 0, 0, 1]);
      assert.deepEqual(r.datum, ['17.11.2026', 'kein Datum']);
      assert.deepEqual(r.wurzel, [':host{--a:1}', ':host, :host{margin:0}', ':host > .page{a:1}', '@media print{:host{a:1}}',
        '.body{flex:1}', '.page .body{a:1}', '.body > p{a:1}', 'body.x{a:1}', 'tbody td{a:1}', '#body{a:1}', 'body-x{a:1}', '[body]{a:1}',
        '.a{content:"body"}', '@supports (display:grid){.body{a:1}}']);
      assert.equal(r.wurzelBild, '.ae-wurzel{--a:1}\n.ae-wurzel .x{b:2}');
      const [extern, escape, imp, kommentar, daten, anker, schrift, schriftHoch, imageSet, pfeil, impVerschachtelt, gross] = r.css;
      assert.equal(extern, '.a{background:none}');
      assert.doesNotMatch(escape, /evil|url/i); assert.match(escape, /none/);
      assert.equal(imp.trim(), '.a{color:red}');
      assert.equal(kommentar, '.a{color:red}');
      assert.equal(daten, '.a{background:url(data:image/png;base64,AAAA)}');
      assert.equal(anker, '.a{fill:url(#g)}');
      assert.equal(schrift, '@font-face{src:url("fonts/jost/x.woff")}');
      assert.doesNotMatch(schriftHoch, /\.\./); assert.match(schriftHoch, /none/);
      assert.doesNotMatch(imageSet, /evil/); assert.match(imageSet, /none/);
      assert.equal(pfeil, '.a{content:"\\2192"}');
      assert.doesNotMatch(impVerschachtelt, /@import|y\.css/); assert.match(impVerschachtelt, /\.a\{color:red\}/);
      assert.doesNotMatch(gross, /evil/i); assert.match(gross, /none/);
      assert.deepEqual(r.anker, ['.a{background:none}', '.a{background-image:none}', '.a{content:none}', '.a{--x:none}', '@font-face{src:none}',
        '.a{clip-path:url("#c");stroke:url(#s);filter:url(#f);marker-end:url(#m);FILL:url(#g)}', '.a{fill:url(#g)}.b{list-style-image:none}',
        '.a{background:var(--x,[;fill:] none)}', '.a{border-image:none}', '.a{fill:url(#g)}'], 'url(#…) nur in Verweis-Eigenschaften');
      assert.equal(r.ankerStil, 'background:none;fill:url(#g)', 'style-Attribut ebenso');
      assert.equal(r.gruppen.dokument, '@layer basis{@font-face{font-family:"X";src:url("fonts/jost/a.woff")}}\n@media print{@page{margin:5mm}}\n' +
        '@supports (display:grid){@font-face{font-family:"Y";src:url("fonts/jost/b.woff")}}', 'Dokument-Regeln aus Gruppen, ohne Seitenauswahl/Seiten-Schriften');
      for (const weg of ['c.woff', 'd.woff', 'e.woff', 'Avenir Next', 'Segoe']) {
        assert.ok(!r.gruppen.schatten.includes(weg) && !r.gruppen.sauber.includes(weg), `${weg}: verworfen`);
      }
      assert.match(r.gruppen.schatten, /\.p\{color:blue\}/, 'übrige Regeln bleiben');
      // zerlegeCss
      const [seitenVariablen, seitenSchriften] = r.seite;
      assert.ok(seitenVariablen.length >= 15 && seitenSchriften.includes('avenir next'));
      assert.equal(r.zerlegt.schatten.split('\n')[0], ':host{all:initial;display:block;' + seitenVariablen.map((v) => v + ':initial').join(';') + '}',
        'Shadow-CSS beginnt mit :host{all:initial;display:block; Seiten-Variablen initial}');
      assert.equal(r.zerlegt.sauber.includes('.page{width:794px'), true, 'sauber: bereinigtes Paket-CSS');
      assert.match(r.zerlegt.schatten, /:host\{margin:0 !important;padding:0 !important;border:0 !important;display:block !important\}\s*$/);
      assert.match(r.zerlegt.schatten, /:host\{--s:1;--grund:#1a2b3c/);
      assert.match(r.zerlegt.schatten, /\.body\{flex:1;overflow:hidden/, '.body bleibt');
      assert.equal((r.zerlegt.dokument.match(/@font-face/g) || []).length, 2);
      assert.match(r.zerlegt.dokument, /@page\{size:A4;margin:0\}/);
      assert.equal(r.zerlegt.dokument.split('\n').length, 3, 'nur die zwei @font-face und die @page-Regel');
      assert.doesNotMatch(r.zerlegt.dokument, /\.page|:root|body/);
      // bereinigeHtml
      assert.equal(r.html[0], 'section', 'vorangestelltes script wird nicht Wurzel');
      assert.doesNotMatch(r.html[1], /onclick|evil|script/);
      assert.match(r.html[1], /href="#anker"/);
      assert.match(r.html[1], /src="data:image\/png;base64,AA"/);
      assert.deepEqual([r.leer.kind, r.leer.title], ['format', 'Dokument ohne Inhalt.']);
      // Fehler
      const f = r.fehler;
      assert.deepEqual([f.json.kind, f.json.title], ['format', 'Datei ist kein gültiges JSON.']);
      assert.deepEqual(f.format, { kind: 'format', title: 'Kein Aether-Flyer-Paket.', text: 'Erwartet wird format „aether-flyer-paket“ (gefunden: „x“).' });
      assert.deepEqual(f.zuneu, { kind: 'zuneu', title: 'Paket zu neu', text: 'Das Paket hat formatVersion 3; diese Seite kennt Version 2. Bitte das Dashboard aktualisieren.' });
      for (const k of ['fv', 'art', 'doppelt', 'keine', 'stand', 'breite']) assert.equal(f[k] && f[k].kind, 'format', `${k}: format-Fehler`);
      for (const k of ['art', 'doppelt', 'keine', 'stand', 'breite']) assert.equal(f[k].title, 'Paket fehlerhaft.', `${k}: Titel`);
      assert.match(f.art.text, /Dokument 3/); assert.match(f.art.text, /art/);
      assert.match(f.doppelt.text, /Dokument 2/);
      assert.deepEqual(ohne(log.errors, CSP_PARSE), []);
    });
  });

  test('Import-Fehler: kein JSON, falsches Format, fehlerhaft, zu neu → Fehlerbox, nichts überschrieben, Feld zurückgesetzt', async () => {
    await mitSeite({ withToken: false }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, testPaket());
      const vorher = await page.evaluate(() => window.AetherFlyer.gespeichert());
      const faelle = [
        ['kein JSON', '{"format": "aether-flyer-paket", ', 'Datei ist kein gültiges JSON.', null],
        ['falsches Format', JSON.stringify({ format: 'anderes', formatVersion: 1 }), 'Kein Aether-Flyer-Paket.', 'Erwartet wird format „aether-flyer-paket“ (gefunden: „anderes“).'],
        ['fehlerhaft', JSON.stringify({ ...testPaket(), dokumente: [{ id: 'X', kategorie: 'info', titel: 'x', breite: 794, hoehe: 1123, html: '<section></section>' }] }), 'Paket fehlerhaft.', /Dokument 1.*art/],
        ['zu neu', testPaket({ formatVersion: 3, version: '2026-12-01.1' }), 'Paket zu neu', 'Das Paket hat formatVersion 3; diese Seite kennt Version 2. Bitte das Dashboard aktualisieren.']
      ];
      for (const [label, inhalt, titel, textErw] of faelle) {
        await importiere(page, inhalt, `${label}.json`);
        assert.ok(await page.isVisible('#fehler'), `${label}: Fehlerbox sichtbar`);
        assert.equal(await page.$eval('#fehler b', (b) => b.textContent), titel, `${label}: Titel`);
        if (typeof textErw === 'string') assert.equal(await page.$eval('#fehler div', (d) => d.textContent), textErw, `${label}: Text`);
        else if (textErw) assert.match(await page.$eval('#fehler div', (d) => d.textContent), textErw, `${label}: Text`);
        assert.equal(await page.$$eval('#fehler a', (a) => a.length), 0, `${label}: kein Token-Link`);
        assert.equal(await page.getAttribute('#fehler', 'role'), 'alert');
        assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), VERSION, `${label}: Paket unverändert`);
        assert.deepEqual(await page.evaluate(() => window.AetherFlyer.gespeichert()), vorher, `${label}: gespeichertes Paket unverändert`);
        assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
        assert.equal((await kacheln(page)).length, 3);
        assert.equal(await page.$eval('#dateiImport', (i) => i.value), '', `${label}: Feld zurückgesetzt`);
      }
      // Ein gültiger Import danach räumt die Fehlerbox weg
      await importiere(page, testPaket({ version: '2026-11-17.2' }));
      assert.ok(await page.isHidden('#fehler'));
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-17.2');
      // fehler()/fehlerWeg() der Schnittstelle (mit Token-Link)
      await page.evaluate(() => window.AetherFlyer.fehler('Platzhalter-Titel', 'Platzhalter-Text', true));
      assert.deepEqual(await page.$eval('#fehler', (h) => [h.hidden, h.querySelector('b').textContent, h.querySelector('div').textContent, h.querySelector('a').getAttribute('href'), h.querySelector('a').textContent]),
        [false, 'Platzhalter-Titel', 'Platzhalter-Text', './', 'Token eingeben ›']);
      await page.evaluate(() => window.AetherFlyer.fehlerWeg());
      assert.ok(await page.isHidden('#fehler'));
      assert.deepEqual(log.errors, []);
    });
  });
});

// ---------------------------------------------------------------------------
describe('Flyer: Online-Prüfung', () => {
  test('ohne lokales Paket sofort geladen (Accept raw, Token nur im Header); gleicher sha → keine Datei-Anfrage, „Aktuell …“', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await onlineFertig(page);
      assert.ok(await page.isVisible('#btnOnline'));
      assert.equal(await text(page, '#btnOnline'), 'Online prüfen');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      assert.equal((await kacheln(page)).length, 3);
      assert.match(await text(page, '#onlineHinweis'), AKTUELL(VERSION));
      assert.equal(await text(page, '#toast'), `Paket geladen (Version ${VERSION})`);
      assert.ok(await page.isHidden('#banner'));
      assert.ok(await page.isHidden('#fehler'));
      assert.deepEqual(anfragen(), ['ordner', 'datei']);
      assert.ok(mock.requests.every((r) => r.method === 'GET' && r.ref === 'main'), 'nur GET auf main');
      assert.ok(mock.requests.every((r) => r.auth === `Bearer ${TOKEN}`), 'Token im Header');
      assert.equal(mock.requests.find((r) => r.path === DATEI).accept, RAW, 'Accept der Datei-Anfrage');
      assert.ok(!log.urls.some((u) => u.includes(TOKEN) || u.includes('github_pat_')), 'Token nie in einer Adresse');
      const g = await page.evaluate(() => window.AetherFlyer.gespeichert());
      assert.deepEqual([g.quelle, g.sha, g.paket.version], ['online', SHA_A, VERSION]);
      // Gespeichert: Paket und Online-Stand, nie das Token
      const st = await speicher(page);
      assertKeinToken(st, 'nach Online-Laden');
      const db = st.idb.filter((e) => e.db === 'aether-flyer');
      assert.deepEqual(db.map((e) => e.store).sort(), ['aenderungen', 'basis', 'geraet', 'medien', 'online', 'struktur', 'werte']);
      assert.equal(db[0].version, 5, 'DB_VERSION 5 (dynamische Werte)');
      assert.deepEqual(db.find((e) => e.store === 'aenderungen').schluessel, [], 'Änderungsschicht leer');
      const online = db.find((e) => e.store === 'online');
      assert.deepEqual(online.schluessel, ['stand']);
      assert.deepEqual(Object.keys(online.werte[0]).sort(), ['geprueft', 'sha', 'stand', 'version']);
      assert.deepEqual([online.werte[0].sha, online.werte[0].version, online.werte[0].stand], [SHA_A, VERSION, STAND]);
      assert.deepEqual(db.find((e) => e.store === 'basis').schluessel, ['aktuell']);
      // Neu laden: gleicher sha → nur die Ordnerliste
      mock.requests = [];
      await page.reload();
      await oeffneFlyer(page, null);
      await onlineFertig(page);
      assert.match(await text(page, '#onlineHinweis'), AKTUELL(VERSION));
      assert.deepEqual(anfragen(), ['ordner'], 'keine Datei-Anfrage bei gleichem sha');
      assert.ok(await page.isHidden('#banner'));
      // „Online prüfen“ ebenso
      mock.requests = [];
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.deepEqual(anfragen(), ['ordner']);
      assert.match(await text(page, '#onlineHinweis'), AKTUELL(VERSION));
      // Gleicher Inhalt unter neuem sha (z. B. neu hochgeladen): kein Banner, „Aktuell“
      mock.sha = SHA_D; mock.requests = [];
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.deepEqual(anfragen(), ['ordner', 'datei']);
      assert.ok(await page.isHidden('#banner'), 'gleicher Inhalt: kein Banner');
      assert.match(await text(page, '#onlineHinweis'), AKTUELL(VERSION));
      assert.ok(!log.urls.some((u) => u.includes(TOKEN)), 'Token nie in einer Adresse');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('neuer sha → Banner „Neue Version online“, „Laden“ ersetzt das Paket (auch nach Neuladen); ältere Version → „Trotzdem laden“', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await onlineFertig(page);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), VERSION);
      // Neue Version online
      mock.sha = SHA_B;
      mock.datei = JSON.stringify(testPaket({ version: '2026-11-18.1', stand: '2026-11-18' }));
      mock.requests = [];
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.deepEqual(anfragen(), ['ordner', 'datei']);
      assert.ok(await page.isVisible('#banner'));
      assert.equal(await text(page, '#bannerText'), 'Neue Version online: 2026-11-18.1 (Stand 18.11.2026)');
      assert.equal(await text(page, '#bannerLaden'), 'Laden');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), VERSION, 'noch nicht ersetzt');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      await page.screenshot({ path: path.join(OUT, 'flyer-banner.png') });
      // Neu laden ohne „Laden“: Version bekannt → Banner ohne Download
      mock.requests = [];
      await page.reload();
      await oeffneFlyer(page, null);
      await onlineFertig(page);
      assert.deepEqual(anfragen(), ['ordner'], 'bekannte Online-Version: kein Download');
      assert.equal(await text(page, '#bannerText'), 'Neue Version online: 2026-11-18.1 (Stand 18.11.2026)');
      // „Laden“
      await page.click('#bannerLaden');
      await onlineFertig(page);
      assert.ok(await page.isHidden('#banner'), 'Banner weg');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-18.1');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 18.11.2026');
      assert.equal(await text(page, '#paketInfo'), 'Platzhalter-Paket · Version 2026-11-18.1 · 3 Dokumente');
      assert.match(await text(page, '#onlineHinweis'), AKTUELL('2026-11-18.1'));
      const g = await page.evaluate(() => window.AetherFlyer.gespeichert());
      assert.deepEqual([g.quelle, g.sha, g.paket.version], ['online', SHA_B, '2026-11-18.1']);
      // Nach Neuladen noch da, gleicher sha → „Aktuell“
      mock.requests = [];
      await page.reload();
      await oeffneFlyer(page, null);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-18.1');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 18.11.2026');
      await onlineFertig(page);
      assert.match(await text(page, '#onlineHinweis'), AKTUELL('2026-11-18.1'));
      assert.deepEqual(anfragen(), ['ordner']);
      // Ältere Version online
      mock.sha = SHA_C;
      mock.datei = JSON.stringify(testPaket({ version: '2026-11-10.1', stand: '2026-11-10' }));
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.ok(await page.isVisible('#banner'));
      assert.equal(await text(page, '#bannerText'), 'Online liegt eine ältere Version (2026-11-10.1)');
      assert.equal(await text(page, '#bannerLaden'), 'Trotzdem laden');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-18.1');
      await page.click('#bannerLaden');
      await onlineFertig(page);
      assert.ok(await page.isHidden('#banner'));
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-10.1');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 10.11.2026');
      assert.ok(mock.requests.every((r) => r.method === 'GET' && r.auth === `Bearer ${TOKEN}`));
      assert.ok(!log.urls.some((u) => u.includes(TOKEN)), 'Token nie in einer Adresse');
      assertKeinToken(await speicher(page), 'nach Laden über das Banner');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('404 → „Noch keine Online-Version.“; falscher Dateiname → „gefunden: …“; offline, abgelehntes Token, kaputte Datei', async () => {
    await mitSeite({}, async ({ page, log }) => {
      mock.modus = '404';
      await oeffneFlyer(page);
      await onlineFertig(page);
      assert.equal(await text(page, '#onlineHinweis'), 'Noch keine Online-Version.');
      assert.ok(await page.isHidden('#fehler'), '404 ist kein Fehler');
      assert.ok(await page.isHidden('#banner'));
      assert.equal(await text(page, '#status'), 'noch kein Paket');
      assert.ok(await page.isVisible('#leer'));
      assert.deepEqual(anfragen(), ['ordner']);
      // Falscher Dateiname
      mock.modus = 'ok';
      mock.ordner = [
        { name: 'flyer-paket.json', path: 'docs/flyer/flyer-paket.json', sha: SHA_B, type: 'file' },
        { name: 'alt.json', path: 'docs/flyer/alt.json', sha: SHA_C, type: 'file' },
        { name: 'README.md', path: 'docs/flyer/README.md', sha: SHA_D, type: 'file' },
        { name: 'aether-flyer-paket.json', path: 'docs/flyer/aether-flyer-paket.json', sha: SHA_A, type: 'dir' }
      ];
      mock.requests = [];
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.equal(await text(page, '#onlineHinweis'), 'In docs/flyer liegt keine Datei mit genau dem Namen aether-flyer-paket.json (gefunden: flyer-paket.json, alt.json)');
      assert.deepEqual(anfragen(), ['ordner']);
      assert.ok(await page.isHidden('#fehler'));
      // Ordner ohne .json-Dateien
      mock.ordner = [{ name: 'README.md', path: 'docs/flyer/README.md', sha: SHA_D, type: 'file' }];
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.equal(await text(page, '#onlineHinweis'), 'Noch keine Online-Version.');
      // Kein Netz (Anfrage bricht ab) → wie offline, kein Fehler
      mock.ordner = null;
      mock.modus = 'offline';
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.equal(await text(page, '#onlineHinweis'), 'Offline – gezeigt wird der gespeicherte Stand.');
      assert.ok(await page.isHidden('#fehler'));
      // Token abgelehnt → Fehlerbox mit Token-Link
      mock.modus = 'auth';
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.ok(await page.isVisible('#fehler'));
      assert.deepEqual(await page.$eval('#fehler', (h) => [h.querySelector('b').textContent, h.querySelector('a').getAttribute('href'), h.querySelector('a').textContent]),
        ['GitHub lehnt das Token ab.', './', 'Token eingeben ›']);
      assert.doesNotMatch(await text(page, '#fehler'), /github_pat_|TESTTOKEN/, 'Token nie in einer Meldung');
      // Kaputte Datei → Fehlerbox, nichts übernommen
      mock.modus = 'ok';
      mock.datei = JSON.stringify({ format: 'aether-flyer-paket', formatVersion: 1, version: '2026-11-17.3' });
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.equal(await page.$eval('#fehler b', (b) => b.textContent), 'Online-Datei ist kein gültiges Flyer-Paket.');
      assert.equal(await page.$$eval('#fehler a', (a) => a.length), 0);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket()), null, 'nichts übernommen');
      // Danach gelingt die Prüfung: Fehlerbox weg, Paket geladen
      mock.datei = JSON.stringify(testPaket());
      mock.sha = SHA_B;
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.ok(await page.isHidden('#fehler'), 'erfolgreiche Prüfung räumt die Fehlerbox weg');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      assert.ok(!log.urls.some((u) => u.includes(TOKEN)));
      assert.deepEqual(ohne(log.errors, /Failed to load resource: the server responded with a status of 40[14]|ERR_INTERNET_DISCONNECTED/), []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('ohne Token: Hinweis statt Fehler, keine API-Anfrage (auch nicht per „Online prüfen“)', async () => {
    await mitSeite({ withToken: false }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await onlineFertig(page);
      assert.equal(await text(page, '#onlineHinweis'), 'Ohne Token keine Online-Prüfung – gezeigt wird der gespeicherte Stand.');
      assert.ok(await page.isHidden('#fehler'));
      assert.ok(await page.isHidden('#banner'));
      await importiere(page, testPaket());
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.equal(await text(page, '#onlineHinweis'), 'Ohne Token keine Online-Prüfung – gezeigt wird der gespeicherte Stand.');
      assert.ok(await page.isHidden('#fehler'));
      assert.equal(mock.requests.length, 0, 'keine API-Anfrage');
      assert.ok(!log.urls.some((u) => u.startsWith('https://api.github.com')));
      assert.deepEqual(log.errors, []);
    });
  });

  test('formatVersion 3 online → „Paket zu neu …“, nichts überschrieben', async () => {
    await mitSeite({}, async ({ page, log }) => {
      mock.modus = '404';
      await oeffneFlyer(page);
      await onlineFertig(page);
      await importiere(page, testPaket());
      const vorher = await page.evaluate(() => window.AetherFlyer.gespeichert());
      mock.modus = 'ok';
      mock.sha = SHA_B;
      mock.datei = JSON.stringify(testPaket({ formatVersion: 3, version: '2026-11-19.1', stand: '2026-11-19' }));
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.equal(await text(page, '#onlineHinweis'), 'Paket zu neu: Online-Version 2026-11-19.1 braucht ein neueres Dashboard.');
      assert.ok(await page.isHidden('#banner'), 'kein Banner');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), VERSION, 'nichts überschrieben');
      assert.deepEqual(await page.evaluate(() => window.AetherFlyer.gespeichert()), vorher, 'gespeichertes Paket unverändert');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      assert.deepEqual(ohne(log.errors, /Failed to load resource: the server responded with a status of 404/), []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('nie zwei Prüfungen gleichzeitig; Intervall prüft erneut; Zeitlimit beendet eine hängende Prüfung', async () => {
    const init = [() => { window.AETHER_TEST_FLYER_INTERVALL_MS = 250; window.AETHER_TEST_PROJECT_TIMEOUT_MS = 1500; }];
    await mitSeite({ init }, async ({ page, log }) => {
      mock.verzoegerung = 400;
      await oeffneFlyer(page);
      // Weitere Auslöser während einer laufenden Prüfung: kein zweiter Lauf
      await page.evaluate(() => { window.AetherFlyerOnline.pruefe(); window.AetherFlyerOnline.pruefe(); window.dispatchEvent(new Event('online')); });
      await bis(() => anfragen().filter((a) => a === 'ordner').length >= 4, 'Intervall prüft mehrmals', 15000);
      assert.equal(mock.maxOffen, 1, 'nie zwei Anfragen gleichzeitig');
      assert.equal(anfragen().filter((a) => a === 'datei').length, 1, 'Datei nur einmal geladen');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), VERSION);
      // Hängende API: während der Prüfung „Prüfe online …“ und Knopf gesperrt; nach dem Zeitlimit „Offline – …“, Knopf wieder frei
      mock.modus = 'hang';
      const t0 = Date.now();
      await page.waitForFunction(() => document.getElementById('onlineHinweis').textContent === 'Prüfe online …' && document.getElementById('btnOnline').disabled, null, { timeout: 5000 });
      await page.waitForFunction(() => document.getElementById('onlineHinweis').textContent === 'Offline – gezeigt wird der gespeicherte Stand.' && !document.getElementById('btnOnline').disabled, null, { timeout: 10000 });
      assert.ok(Date.now() - t0 < 6000, 'nach dem Zeitlimit');
      assert.ok(await page.isHidden('#fehler'));
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('nach einem Import: Banner und „Aktuell“ neu bewertet; „Laden“ übernimmt keine inzwischen ältere Version ohne „Trotzdem laden“', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await onlineFertig(page);
      assert.match(await text(page, '#onlineHinweis'), AKTUELL(VERSION));
      mock.sha = SHA_B;
      mock.datei = JSON.stringify(testPaket({ version: '2026-11-18.1', stand: '2026-11-18' }));
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.equal(await text(page, '#bannerText'), 'Neue Version online: 2026-11-18.1 (Stand 18.11.2026)');
      // Neueres Paket importieren: das Banner darf nicht mehr „Neue Version online … Laden“ anbieten
      await importiere(page, testPaket({ version: '2026-11-20.1', stand: '2026-11-20' }));
      await onlineFertig(page);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-20.1');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 20.11.2026');
      assert.ok(await page.isVisible('#banner'));
      assert.equal(await text(page, '#bannerText'), 'Online liegt eine ältere Version (2026-11-18.1)');
      assert.equal(await text(page, '#bannerLaden'), 'Trotzdem laden');
      assert.doesNotMatch(await text(page, '#onlineHinweis'), /^Aktuell/, 'kein „Aktuell (Version 2026-11-17.1)“ mehr');
      // „Trotzdem laden“ übernimmt ausdrücklich die ältere
      await page.click('#bannerLaden');
      await onlineFertig(page);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-18.1');
      assert.match(await text(page, '#onlineHinweis'), AKTUELL('2026-11-18.1'));
      // Banner „Laden“ steht, dann kommt (an der Online-Prüfung vorbei) ein neueres Paket: „Laden“ übernimmt nicht
      mock.sha = SHA_C;
      mock.datei = JSON.stringify(testPaket({ version: '2026-11-19.1', stand: '2026-11-19' }));
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.equal(await text(page, '#bannerText'), 'Neue Version online: 2026-11-19.1 (Stand 19.11.2026)');
      assert.equal(await text(page, '#bannerLaden'), 'Laden');
      await page.evaluate((pk) => window.AetherFlyer.uebernehme(pk, { quelle: 'import' }), testPaket({ version: '2026-11-21.1', stand: '2026-11-21' }));
      await page.click('#bannerLaden');
      await onlineFertig(page);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-21.1', 'ältere Online-Fassung nicht über „Laden“ übernommen');
      assert.equal(await text(page, '#bannerText'), 'Online liegt eine ältere Version (2026-11-19.1)');
      assert.equal(await text(page, '#bannerLaden'), 'Trotzdem laden');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Import derselben Datei, die online liegt: „Aktuell“ ohne Banner, auch nach Neuladen nur die Ordnerliste', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await onlineFertig(page);
      // Fall 1: geladene Online-Datei noch einmal importieren (z. B. aus der Dateien-App)
      await importiere(page, testPaket());
      await onlineFertig(page);
      assert.ok(await page.isHidden('#banner'), 'kein Banner „Neue Version online: 2026-11-17.1“');
      assert.match(await text(page, '#onlineHinweis'), AKTUELL(VERSION));
      mock.requests = [];
      await page.reload();
      await oeffneFlyer(page, null);
      await onlineFertig(page);
      assert.ok(await page.isHidden('#banner'), 'nach Neuladen kein Banner');
      assert.match(await text(page, '#onlineHinweis'), AKTUELL(VERSION));
      assert.deepEqual(anfragen(), ['ordner'], 'nach Neuladen nur die Ordnerliste');
      // Fall 2: angebotene neue Online-Fassung selbst importieren statt „Laden“
      mock.sha = SHA_B;
      mock.datei = JSON.stringify(testPaket({ version: '2026-11-18.1', stand: '2026-11-18' }));
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.equal(await text(page, '#bannerText'), 'Neue Version online: 2026-11-18.1 (Stand 18.11.2026)');
      await importiere(page, mock.datei);
      await onlineFertig(page);
      assert.ok(await page.isHidden('#banner'));
      assert.match(await text(page, '#onlineHinweis'), AKTUELL('2026-11-18.1'));
      const g = await page.evaluate(() => window.AetherFlyer.gespeichert());
      assert.deepEqual([g.sha, g.paket.version], [SHA_B, '2026-11-18.1'], 'sha der Online-Datei gemerkt');
      mock.requests = [];
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.deepEqual(anfragen(), ['ordner']);
      assert.ok(await page.isHidden('#banner'));
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('„Laden“ ohne vorher geladene Datei übernimmt genau die angebotene Fassung (über ihren sha), nicht die inzwischen geänderte', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await onlineFertig(page);
      const p18 = JSON.stringify(testPaket({ version: '2026-11-18.1', stand: '2026-11-18' }));
      mock.sha = SHA_B;
      mock.datei = p18;
      await page.click('#btnOnline');
      await onlineFertig(page);
      // Neu laden: Banner über die bekannte Version, ohne Download
      mock.requests = [];
      await page.reload();
      await oeffneFlyer(page, null);
      await onlineFertig(page);
      assert.deepEqual(anfragen(), ['ordner']);
      assert.equal(await text(page, '#bannerText'), 'Neue Version online: 2026-11-18.1 (Stand 18.11.2026)');
      // Bevor „Laden“ getippt wird, liegt online schon eine andere (ältere) Datei
      mock.blobs[SHA_B] = p18;
      mock.sha = SHA_C;
      mock.datei = JSON.stringify(testPaket({ version: '2026-11-10.1', stand: '2026-11-10' }));
      mock.requests = [];
      await page.click('#bannerLaden');
      await onlineFertig(page);
      assert.deepEqual(anfragen(), [`blob:${SHA_B}`], 'genau die angebotene Fassung über ihren sha');
      assert.equal(mock.requests[0].accept, RAW, 'Accept raw');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-18.1');
      assert.match(await text(page, '#onlineHinweis'), AKTUELL('2026-11-18.1'));
      const g = await page.evaluate(() => window.AetherFlyer.gespeichert());
      assert.deepEqual([g.quelle, g.sha, g.paket.version], ['online', SHA_B, '2026-11-18.1']);
      const online = (await speicher(page)).idb.find((e) => e.db === 'aether-flyer' && e.store === 'online');
      assert.deepEqual([online.werte[0].sha, online.werte[0].version], [SHA_B, '2026-11-18.1'], 'sha und Version passen zusammen');
      // Nächste Prüfung sieht die geänderte Datei richtig als ältere
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.equal(await text(page, '#bannerText'), 'Online liegt eine ältere Version (2026-11-10.1)');
      // Angebotene Fassung inzwischen weg (404 auf den sha): neu prüfen statt etwas anderes zu übernehmen
      await page.reload();
      await oeffneFlyer(page, null);
      await onlineFertig(page);
      assert.equal(await text(page, '#bannerText'), 'Online liegt eine ältere Version (2026-11-10.1)');
      mock.sha = SHA_D;
      mock.datei = JSON.stringify(testPaket({ version: '2026-11-19.1', stand: '2026-11-19' }));
      mock.requests = [];
      await page.click('#bannerLaden');
      await onlineFertig(page);
      assert.deepEqual(anfragen(), [`blob:${SHA_C}`, 'ordner', 'datei']);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-18.1', 'nichts übernommen');
      assert.equal(await text(page, '#bannerText'), 'Neue Version online: 2026-11-19.1 (Stand 19.11.2026)');
      assert.ok(await page.isHidden('#fehler'));
      assert.deepEqual(ohne(log.errors, /Failed to load resource: the server responded with a status of 404/), []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Import während des ersten Online-Ladens (noch kein Paket): das importierte Paket bleibt, die Online-Fassung wird nur angeboten', async () => {
    // Speichern der Basis langsam (wie ein großes Paket auf einem älteren iPad): „complete“ kommt 600 ms später
    const langsam = () => {
      const desc = Object.getOwnPropertyDescriptor(IDBTransaction.prototype, 'oncomplete');
      const orig = IDBDatabase.prototype.transaction;
      IDBDatabase.prototype.transaction = function (names, mode, opts) {
        const tx = orig.call(this, names, mode, opts);
        if (mode === 'readwrite' && [].concat(names).includes('basis')) {
          Object.defineProperty(tx, 'oncomplete', { configurable: true, get() { return desc.get.call(tx); },
            set(fn) { desc.set.call(tx, function (ev) { setTimeout(() => fn.call(this, ev), 600); }); } });
        }
        return tx;
      };
    };
    await mitSeite({ init: [langsam] }, async ({ page, log }) => {
      let los;
      mock.halteDatei = new Promise((r) => { los = r; });
      await page.goto(flyerUrl());
      await page.waitForFunction(() => window.AetherFlyer && window.AetherFlyer.bereit);
      await page.evaluate(() => window.AetherFlyer.bereit);
      await bis(() => anfragen().includes('datei'), 'Datei-Anfrage');
      // Import anstoßen (noch nicht fertig gespeichert), dann kommt die Online-Datei
      await page.setInputFiles('#dateiImport', { name: 'aether-flyer-paket.json', mimeType: 'application/json',
        buffer: Buffer.from(JSON.stringify(testPaket({ version: '2026-11-20.1', stand: '2026-11-20' }))) });
      await new Promise((r) => setTimeout(r, 100));
      los();
      await page.waitForFunction(() => document.getElementById('dateiImport').value === '' && !document.getElementById('btnImport').disabled, null, { timeout: 20000 });
      // Fertig, sobald das Banner steht oder (falsch) die Online-Fassung als „Aktuell“ übernommen wurde
      await page.waitForFunction(() => !document.getElementById('banner').hidden || /^Aktuell/.test(document.getElementById('onlineHinweis').textContent), null, { timeout: 20000 });
      await onlineFertig(page);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-20.1', 'Import bleibt');
      const g = await page.evaluate(() => window.AetherFlyer.gespeichert());
      assert.deepEqual([g.quelle, g.paket.version], ['import', '2026-11-20.1']);
      assert.equal(await text(page, '#bannerText'), 'Online liegt eine ältere Version (2026-11-17.1)');
      assert.equal(await text(page, '#bannerLaden'), 'Trotzdem laden');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 20.11.2026');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });
});

// ---------------------------------------------------------------------------
describe('Flyer: PDF und Bild', () => {
  test('PDF: „PDF“ im Vollbild = eine A4-Seite; „Alle als PDF (2)“ = genau eine Seite je Flyer; Infografik bricht um', async () => {
    await mitSeite({ withToken: false, init: [druckStub] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, testPaket({ texte: { T2: LANG } }));
      await page.waitForFunction(() => !document.getElementById('btnAllePdf').hidden);
      assert.equal(await text(page, '#btnAllePdf'), 'Alle als PDF (2)', 'Kategorie „alle“: nur die Flyer');
      const druckBereit = () => page.waitForFunction(() => document.fonts.status === 'loaded' &&
        [...document.querySelectorAll('#druck .flyer-host')].every((h) => h.dataset.art !== 'flyer' || h.shadowRoot.querySelector('section').style.getPropertyValue('--s')));
      const pdf = async (name) => {
        await druckBereit();
        await ruhe(page);
        const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
        fs.writeFileSync(path.join(OUT, name), buf);
        return pdfInfo(buf);
      };
      // Ein Dokument aus dem Vollbild
      await page.click('#kacheln .kachel[data-id="T1"]');
      assert.ok(await page.isVisible('#vbPdf'));
      await page.click('#vbPdf');
      assert.equal(await page.evaluate(() => window.__druck), 1, 'window.print aufgerufen');
      assert.deepEqual(await page.$$eval('#druck .druck-seite', (ss) => ss.map((s) => [s.className, s.querySelector('.flyer-host').dataset.id])), [['druck-seite druck-flyer', 'T1']]);
      let info = await pdf('flyer-T1.pdf');
      assert.equal(info.seiten, 1, 'ein Flyer = eine Seite');
      assertA4(info.boxen, 'PDF T1');
      await page.keyboard.press('Escape');
      // Alle Flyer
      await page.click('#btnAllePdf');
      assert.equal(await page.evaluate(() => window.__druck), 2);
      assert.deepEqual(await page.$$eval('#druck .flyer-host', (hs) => hs.map((h) => h.dataset.id)), ['T1', 'T2']);
      const s = await page.$$eval('#druck .flyer-host', (hs) => hs.map((h) => h.shadowRoot.querySelector('section').style.getPropertyValue('--s')));
      assert.equal(s[0], '1.42', 'Schriftanpassung auch im Druck');
      assert.ok(Number(s[1]) < 1.42 && Number(s[1]) > 0.8, `T2 im Druck angepasst (${s[1]})`);
      info = await pdf('flyer-alle.pdf');
      assert.equal(info.seiten, 2, 'genau eine Seite je Flyer, keine leere Seite');
      assertA4(info.boxen, 'PDF alle');
      // Druckansicht: nur #druck sichtbar
      await page.emulateMedia({ media: 'print' });
      assert.deepEqual(await page.evaluate(() => [...document.body.children].filter((e) => getComputedStyle(e).display !== 'none' && e.tagName !== 'SCRIPT').map((e) => e.id)), ['druck']);
      await page.screenshot({ path: path.join(OUT, 'flyer-druckansicht.png'), fullPage: true });
      await page.emulateMedia({ media: null });   // zurück (mit 'screen' würde page.pdf die Bildschirmansicht drucken)
      // Kategorie mit Infografik: alle Dokumente der Kategorie; Infografik per zoom auf Seitenbreite, über zwei Seiten
      await waehle(page, 'grafik');
      assert.equal(await text(page, '#btnAllePdf'), 'Alle als PDF (1)');
      await page.click('#btnAllePdf');
      assert.equal(await page.evaluate(() => window.__druck), 3);
      const ig = await page.$eval('#druck .druck-seite', (sd) => ({ cls: sd.className, id: sd.querySelector('.flyer-host').dataset.id, zoom: Number(sd.querySelector('.flyer-host').style.zoom) }));
      assert.deepEqual([ig.cls, ig.id], ['druck-seite druck-ig', 'I1']);
      assert.ok(Math.abs(ig.zoom - 793.7 / 1080) < 0.001, `zoom auf Seitenbreite (${ig.zoom})`);
      info = await pdf('flyer-I1.pdf');
      assert.equal(info.seiten, 2, `Infografik (${IG_HOEHE} px hoch) über zwei A4-Seiten`);
      assertA4(info.boxen, 'PDF I1');
      await waehle(page, 'info');
      assert.equal(await text(page, '#btnAllePdf'), 'Alle als PDF (2)');
      // Drucken ohne Vorbereitung (Teilen-Menü → Drucken, Strg+P): „beforeprint“ bereitet die aktuelle Liste vor …
      info = await pdf('flyer-ohne-vorbereitung-liste.pdf');
      assert.equal(await page.evaluate(() => window.__druck), 3, 'kein window.print-Aufruf');
      assert.deepEqual(await page.$$eval('#druck .flyer-host', (hs) => hs.map((h) => h.dataset.id)), ['T1', 'T2'], 'beforeprint: aktuelle Liste');
      const s2 = await page.$$eval('#druck .flyer-host', (hs) => hs.map((h) => h.shadowRoot.querySelector('section').style.getPropertyValue('--s')));
      assert.ok(s2[0] === '1.42' && Number(s2[1]) < 1.42 && Number(s2[1]) > 0.8, `beforeprint: Schrift angepasst (${s2})`);
      assert.equal(info.seiten, 2);
      assertA4(info.boxen, 'PDF ohne Vorbereitung (Liste)');
      // … bzw. das offene Vollbild-Dokument
      await page.click('#kacheln .kachel[data-id="T2"]');
      info = await pdf('flyer-ohne-vorbereitung-vollbild.pdf');
      assert.deepEqual(await page.$$eval('#druck .flyer-host', (hs) => hs.map((h) => h.dataset.id)), ['T2'], 'beforeprint: offenes Dokument');
      assert.equal(info.seiten, 1);
      assertA4(info.boxen, 'PDF ohne Vorbereitung (Vollbild)');
      assert.equal(await page.evaluate(() => window.__druck), 3);
      await page.keyboard.press('Escape');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('PDF: Seiten ohne Rand; position:fixed bleibt auf der Seite seines Flyers; @page :first/:left des Pakets ändert nichts; Druck-Container ohne Flächen-Effekte', async () => {
    await mitSeite({ withToken: false, init: [druckStub] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      const p = testPaket();
      // Magenta-Quadrat (im PDF „1 0 1 rg“) fest unten links im ersten Flyer
      p.dokumente[0].html = p.dokumente[0].html.replace('<div class="fill">',
        '<div class="leck" style="position:fixed;left:0;bottom:0;width:50px;height:50px;background:#ff00ff"></div><div class="fill">');
      // Seitenregeln mit Seitenauswahl (höhere Spezifität als die eigene A4-Regel), auch mit !important
      p.css.infografik = '@page :first{size:A3 landscape !important;margin:40mm !important}\n@media print{@page :left{size:A5;margin:30mm}}\n' + p.css.infografik;
      p.css.flyer += '\n@page{size:A3 landscape !important;margin:25mm !important}';
      await importiere(page, p);
      await page.click('#btnAllePdf');
      await page.waitForFunction(() => document.fonts.status === 'loaded' &&
        [...document.querySelectorAll('#druck .flyer-host')].every((h) => h.shadowRoot.querySelector('section').style.getPropertyValue('--s')));
      await ruhe(page);
      const buf = await page.pdf({ preferCSSPageSize: true, printBackground: true });
      fs.writeFileSync(path.join(OUT, 'flyer-druck-isoliert.pdf'), buf);
      const info = pdfInfo(buf);
      assert.equal(info.seiten, 2, 'genau eine Seite je Flyer (keine Leerseite durch @page :first)');
      assertA4(info.boxen, 'PDF mit Paket-@page');
      const seiten = pdfSeiten(buf);
      assert.equal(seiten.length, 2);
      assert.deepEqual(seiten.map((x) => /\b1 0 1 rg\b/.test(x)), [true, false], 'fixed-Element nur auf der Seite seines Flyers');
      for (const [i, inhalt] of seiten.entries()) {
        const a = pdfAusschnitt(inhalt);
        assert.ok(a, `Seite ${i + 1}: Ausschnitt gefunden`);
        assert.ok(Math.abs(a.x) < 0.5 && Math.abs(a.y) < 0.5 && Math.abs(a.w - 595.3) < 2 && Math.abs(a.h - 841.9) < 2,
          `Seite ${i + 1}: ohne Rand (Inhalt ab 0 0 über die ganze Seite, ist ${JSON.stringify(a)})`);
      }
      // Was die Seite für den Druck hinzufügt, zeichnet keine Fläche (iPhone/iPad: PDF-Ansicht)
      await page.emulateMedia({ media: 'print' });
      const stile = await page.evaluate(() => {
        const els = [document.documentElement, document.body, document.getElementById('druck'), ...document.querySelectorAll('#druck .druck-seite, #druck .flyer-host')];
        return els.map((e) => {
          const cs = getComputedStyle(e);
          return { el: e.id || e.className || e.localName, boxShadow: cs.boxShadow, filter: cs.filter, backdrop: cs.backdropFilter, bild: cs.backgroundImage,
            clip: cs.webkitBackgroundClip || cs.backgroundClip, textShadow: cs.textShadow, opacity: cs.opacity, maske: cs.webkitMaskImage || cs.maskImage,
            grund: e === document.documentElement ? 'rgba(0, 0, 0, 0)' : cs.backgroundColor };
        });
      });
      assert.ok(stile.length >= 6, 'html, body, #druck, 2 Seiten, 2 Hosts');
      for (const st of stile) {
        assert.deepEqual([st.boxShadow, st.filter, st.backdrop, st.bild, st.textShadow, st.opacity, st.maske, st.grund],
          ['none', 'none', 'none', 'none', 'none', '1', 'none', 'rgba(0, 0, 0, 0)'], `${st.el}: keine Fläche, kein Effekt`);
        assert.notEqual(st.clip, 'text', `${st.el}: kein background-clip:text`);
      }
      await page.emulateMedia({ media: null });
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Bild: PNG in doppelter Größe (Flyer 1588 × 2246, Infografik 2160 × 2·Höhe) über den Teilen-Dialog; nur mit Nutzergeste', async () => {
    await mitSeite({ withToken: false, init: [shareMock] }, async ({ context, page, log }) => {
      // Die Schriften fürs Bild holt die Seite per fetch (fonts/…) – hier lässt sich das verzögern
      let schriftPause = 0;
      await context.route(/\/fonts\/jost\/[^/?#]+\.woff$/, async (r) => {
        if (schriftPause) await new Promise((res) => setTimeout(res, schriftPause));
        return r.continue().catch(() => {});
      });
      await oeffneFlyer(page);
      await importiere(page, testPaket());
      await ruhe(page);
      schriftPause = 3000;
      await page.click('#kacheln .kachel[data-id="T1"]');
      await page.waitForFunction(() => !document.getElementById('vbBild').hidden);
      assert.equal(await text(page, '#vbBild'), 'Bild');
      // Noch nicht vorbereitet: nur ein Hinweis, nichts geteilt
      await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
      await page.click('#vbBild');
      await page.waitForFunction(() => document.getElementById('toast').textContent !== '');
      assert.equal(await text(page, '#toast'), 'Einen Moment – das Bild wird vorbereitet');
      assert.equal(await page.evaluate(() => window.__share.calls.length), 0, 'nicht bereit: nichts geteilt');
      schriftPause = 0;
      // Warten, bis das Bild vorbereitet ist (dieselbe Vorbereitung wie beim Öffnen)
      assert.equal(await page.evaluate(() => window.AetherFlyerExport.bildVorbereiten(window.AetherFlyerAnsicht.offenesDokument())), true, 'Bild vorbereitet');
      // Ohne Nutzergeste: nichts
      await page.evaluate(() => { document.getElementById('toast').textContent = ''; document.getElementById('vbBild').click(); });
      await page.waitForFunction(() => document.getElementById('toast').textContent !== '');
      assert.equal(await page.evaluate(() => window.__share.calls.length), 0, 'Skript-Klick teilt nichts');
      // Pixel: Ecke (Seitenhintergrund aus dem Paket-CSS über :root-Variable)
      await page.evaluate(() => { window.__punkte = [[4, 4], [1583, 2241], [794, 1123]]; });
      await page.click('#vbBild');
      await page.waitForFunction(() => window.__share.calls.length === 1, null, { timeout: 30000 });
      let c = await page.evaluate(() => window.__share.calls[0]);
      let f = c.files[0];
      assert.equal(c.active, true, 'share() innerhalb der Nutzergeste');
      assert.deepEqual([c.files.length, f.name, f.type, f.sig, f.w, f.h], [1, 'aether-T1.png', 'image/png', '137,80,78,71,13,10,26,10', 1588, 2246]);
      for (const px of f.pixel.slice(0, 2)) assert.deepEqual(px, [...FLYER_GRUND, 255], 'Flyer-Hintergrund aus dem Paket-CSS');
      fs.writeFileSync(path.join(OUT, 'flyer-bild-T1.png'), Buffer.from(f.base64, 'base64'));
      // Infografik
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehler(page), '3 / 3');
      assert.equal(await page.evaluate(() => window.AetherFlyerExport.bildVorbereiten(window.AetherFlyerAnsicht.offenesDokument())), true);
      await page.evaluate(() => { window.__punkte = [[4, 4], [200, 2000]]; });
      await page.click('#vbBild');
      await page.waitForFunction(() => window.__share.calls.length === 2, null, { timeout: 30000 });
      c = await page.evaluate(() => window.__share.calls[1]);
      f = c.files[0];
      assert.deepEqual([f.name, f.type, f.sig, f.w, f.h], ['aether-I1.png', 'image/png', '137,80,78,71,13,10,26,10', 2160, 2 * IG_HOEHE]);
      assert.deepEqual(f.pixel[0], [...IG_GRUND, 255], 'Infografik-Hintergrund');
      assert.deepEqual(f.pixel[1], [...IG_RECHTECK, 255], 'SVG der Infografik gezeichnet');
      fs.writeFileSync(path.join(OUT, 'flyer-bild-I1.png'), Buffer.from(f.base64, 'base64'));
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Bild über 16 777 216 Pixel: proportional verkleinert, mit Meldung', async () => {
    await mitSeite({ withToken: false, init: [shareMock] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      // Infografik 1080 × 4200 → doppelt 2160 × 8400 = 18 144 000 Pixel
      const p = testPaket();
      p.css.infografik = p.css.infografik.replace(`height:${IG_HOEHE}px`, 'height:4200px');
      await importiere(page, p);
      await page.click('#kacheln .kachel[data-id="I1"]');
      await page.waitForFunction(() => !document.getElementById('vbBild').hidden);
      assert.equal(await page.evaluate(() => window.AetherFlyerExport.bildVorbereiten(window.AetherFlyerAnsicht.offenesDokument())), true);
      await page.evaluate(() => { window.__punkte = [[4, 4]]; document.getElementById('toast').textContent = ''; });
      await page.click('#vbBild');
      await page.waitForFunction(() => window.__share.calls.length === 1, null, { timeout: 30000 });
      const f = await page.evaluate(() => { const x = window.__share.calls[0].files[0]; return { name: x.name, sig: x.sig, w: x.w, h: x.h, pixel: x.pixel }; });
      assert.deepEqual([f.name, f.sig], ['aether-I1.png', '137,80,78,71,13,10,26,10']);
      assert.ok(f.w * f.h <= 16777216, `höchstens 16 777 216 Pixel (${f.w} × ${f.h})`);
      assert.ok(f.w * f.h > 16777216 * 0.998, `kaum kleiner als nötig (${f.w} × ${f.h})`);
      assert.ok(Math.abs(f.w / f.h - 2160 / 8400) < 0.001, `Seitenverhältnis bleibt (${f.w} × ${f.h})`);
      assert.deepEqual(f.pixel[0], [...IG_GRUND, 255], 'Infografik-Hintergrund');
      await page.waitForFunction(() => /verkleinert/.test(document.getElementById('toast').textContent));
      assert.match(await text(page, '#toast'), new RegExp(`verkleinert auf ${f.w} × ${f.h} Pixel`), 'Meldung');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Bild: Selbstprobe scheitert → kein „Bild“ (PDF bleibt); Canvas „tainted“ beim Zeichnen → Meldung, „Bild“ aus', async () => {
    // Jedes Canvas „tainted“: schon die Selbstprobe scheitert
    const immer = () => { HTMLCanvasElement.prototype.toDataURL = function () { throw new DOMException('Test: tainted', 'SecurityError'); }; };
    await mitSeite({ withToken: false, init: [shareMock, immer] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      assert.equal(await page.evaluate(() => window.AetherFlyerExport.einrichten()), false, 'Selbstprobe scheitert');
      await importiere(page, testPaket());
      await page.click('#kacheln .kachel[data-id="T1"]');
      assert.ok(await page.isVisible('#vbPdf'), '„PDF“ bleibt');
      assert.ok(await page.isHidden('#vbBild'), '„Bild“ bleibt verborgen');
      await page.keyboard.press('ArrowRight');
      assert.ok(await page.isHidden('#vbBild'));
      assert.deepEqual(log.errors, []);
    });
    // Selbstprobe (8 × 8) gelingt, das echte Bild ist „tainted“
    const gross = () => {
      const echt = HTMLCanvasElement.prototype.toDataURL;
      HTMLCanvasElement.prototype.toDataURL = function (...a) {
        if (this.width > 8) throw new DOMException('Test: tainted', 'SecurityError');
        return echt.apply(this, a);
      };
    };
    await mitSeite({ withToken: false, init: [shareMock, gross] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      assert.equal(await page.evaluate(() => window.AetherFlyerExport.einrichten()), true, 'Selbstprobe gelingt');
      await importiere(page, testPaket());
      await page.click('#kacheln .kachel[data-id="T1"]');
      await page.waitForFunction(() => !document.getElementById('vbBild').hidden);
      assert.equal(await page.evaluate(() => window.AetherFlyerExport.bildVorbereiten(window.AetherFlyerAnsicht.offenesDokument())), true);
      await page.evaluate(() => { document.getElementById('toast').textContent = ''; });
      await page.click('#vbBild');
      await page.waitForFunction(() => document.getElementById('toast').textContent !== '');
      assert.equal(await text(page, '#toast'), 'Dieser Browser gibt das Bild nicht heraus – „Bild“ ist hier nicht verfügbar');
      assert.ok(await page.isHidden('#vbBild'), '„Bild“ ausgeblendet');
      assert.equal(await page.evaluate(() => window.__share.calls.length), 0, 'nichts geteilt');
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehler(page), '2 / 3');
      assert.ok(await page.isHidden('#vbBild'), '„Bild“ bleibt aus');
      assert.deepEqual(log.errors, []);
    });
  });
});

// ---------------------------------------------------------------------------
describe('Flyer: Offline, Speicher, Module, Layout', () => {
  test('offline: Seite aus der App-Hülle mit gespeichertem Paket; „Flyer ›“ offline aktiv; „‹ Dashboard“; Token in keinem Cache und nicht in IndexedDB', async () => {
    await mitSeite({}, async ({ context, page, log }) => {
      mock.modus = '404';
      await page.goto(baseUrl);
      const swReady = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]));
      assert.ok(swReady, 'Service Worker aktiv');
      const keys = await page.evaluate(async () => (await (await caches.open('aether-shell-v1')).keys()).map((r) => new URL(r.url).pathname));
      for (const d of FLYER_DATEIEN) assert.ok(keys.includes('/' + d), `${d} in der App-Hülle`);
      for (const w of ['400', '700']) assert.ok(keys.includes(`/fonts/jost/jost-latin-${w}-normal.woff`), `Schrift ${w} in der App-Hülle`);
      // Flyer-Seite (vom Service Worker kontrolliert), Paket importieren
      await oeffneFlyer(page);
      assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Seite läuft unter dem Service Worker');
      await onlineFertig(page);
      await importiere(page, testPaket());
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      const st = await speicher(page);
      assertKeinToken(st, 'online');
      assert.ok(st.cache.length > 0);
      assert.ok(st.cache.some((c) => c.url.endsWith('/flyer.html')));
      assert.ok(st.idb.some((e) => e.db === 'aether-flyer' && e.store === 'basis' && e.werte.length === 1), 'Paket in IndexedDB');
      // Netz weg (Browser offline, Server kappt, API bricht ab)
      net.offline = true; mock.modus = 'offline';
      await context.setOffline(true);
      mock.requests = [];
      await page.reload();
      await oeffneFlyer(page, null);
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      assert.equal(await text(page, '#paketInfo'), 'Platzhalter-Paket · Version 2026-11-17.1 · 3 Dokumente');
      assert.deepEqual((await kacheln(page)).map((k) => k.id), ['T1', 'T2', 'I1']);
      await onlineFertig(page);
      assert.equal(await text(page, '#onlineHinweis'), 'Offline – gezeigt wird der gespeicherte Stand.');
      assert.ok(await page.isHidden('#fehler'));
      assert.equal(mock.requests.length, 0, 'offline keine API-Anfrage');
      const schriften = await page.evaluate(() => [...document.fonts].filter((f) => /Platzhalter Jost/.test(f.family)).map((f) => f.status));
      assert.deepEqual(schriften, ['loaded', 'loaded'], 'Schriften offline aus der App-Hülle');
      assert.equal((await wurzelInfo(page, KACHEL_HOST('T1'))).s, '1.42');
      await page.screenshot({ path: path.join(OUT, 'flyer-offline.png') });
      assertKeinToken(await speicher(page), 'offline');
      // „‹ Dashboard“ → ./#projekt; „Flyer ›“ in „Tools“ offline aktiv, öffnet die Seite im selben Fenster
      assert.equal(await page.getAttribute('#zumDashboard', 'href'), './#projekt');
      await page.click('#zumDashboard');
      await page.waitForURL(/\/#projekt$/);
      await page.waitForSelector('#projectView:not([hidden])');
      assert.deepEqual(await page.$eval('#toolFlyer', (a) => [a.getAttribute('href'), a.getAttribute('aria-disabled'), a.getAttribute('target'), a.textContent.trim()]),
        ['flyer.html', null, null, 'Flyer ›'], '„Flyer ›“ offline aktiv');
      await page.click('#toolFlyer');
      await page.waitForURL(/flyer\.html$/);
      await oeffneFlyer(page, null);
      assert.equal((await kacheln(page)).length, 3);
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      net.offline = false;
      await context.setOffline(false);
      assert.deepEqual(ohne(log.errors, /ERR_INTERNET_DISCONNECTED|Failed to load resource/), []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('fehlt ein optionales Modul (Online, Export), bleiben seine Knöpfe verborgen; Import und Ansicht laufen', async () => {
    await mitSeite({ withToken: false }, async ({ context, page, log }) => {
      await context.route(/\/flyer-(online|export|bearbeiten)\.js$/, (r) => r.fulfill({ status: 200, contentType: 'text/javascript; charset=utf-8', body: '// im Test zurückgenommen\n' }));
      await oeffneFlyer(page);
      assert.deepEqual(await page.evaluate(() => [typeof window.AetherFlyerOnline, typeof window.AetherFlyerExport, typeof window.AetherFlyerBearbeiten]), ['undefined', 'undefined', 'undefined']);
      for (const id of ['btnOnline', 'btnAllePdf', 'vbPdf', 'vbBild', 'btnExport', 'btnSichern', 'btnEinspielen', 'btnVerwerfen', 'vbModus', 'onlineStellen']) assert.ok(await page.isHidden('#' + id), `#${id} verborgen`);
      assert.equal(await text(page, '#status'), 'noch kein Paket');
      await importiere(page, testPaket());
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      assert.equal((await kacheln(page)).length, 3);
      await page.click('#kacheln .kachel[data-id="T1"]');
      assert.equal(await zaehler(page), '1 / 3');
      for (const id of ['vbPdf', 'vbBild', 'vbModus']) assert.ok(await page.isHidden('#' + id), `#${id} verborgen`);
      await page.keyboard.press('Escape');
      assert.deepEqual(log.errors, []);
    });
  });

  test('IndexedDB: „versionchange“ schließt die Verbindung (Upgrade auf eine neuere Version nicht blockiert), Paket danach weiter lesbar', async () => {
    await mitSeite({ withToken: false }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, testPaket());   // Verbindung der Seite ist jetzt offen
      const upgrade = await page.evaluate(() => new Promise((resolve) => {
        let blockiert = false;
        const uhr = setTimeout(() => resolve({ zeitlimit: true, blockiert }), 5000);
        const r = indexedDB.open('aether-flyer', 6);   // dynamische Werte: die Seite hat jetzt 5 – „neuer“ ist 6
        r.onblocked = () => { blockiert = true; };
        r.onupgradeneeded = (ev) => { if (ev.oldVersion < 6) r.result.createObjectStore('kuenftig'); };
        r.onsuccess = () => { clearTimeout(uhr); const db = r.result; const st = [...db.objectStoreNames].sort(); db.close(); resolve({ blockiert, version: db.version, stores: st }); };
        r.onerror = () => { clearTimeout(uhr); resolve({ fehler: String(r.error) }); };
      }));
      assert.deepEqual(upgrade, { blockiert: false, version: 6, stores: ['aenderungen', 'basis', 'geraet', 'kuenftig', 'medien', 'online', 'struktur', 'werte'] }, 'Upgrade nicht blockiert');
      // Die Seite liest und schreibt weiter (öffnet die neuere Version, solange basis und online darin liegen)
      assert.equal(await page.evaluate(() => window.AetherFlyer.gespeichert().then((g) => g && g.paket.version)), VERSION);
      await importiere(page, testPaket({ version: '2026-11-17.2' }));
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      await page.reload();
      await oeffneFlyer(page, null);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-17.2');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 17.11.2026');
      assert.deepEqual(log.errors, []);
    });
  });

  test('ohne IndexedDB (Speicher gesperrt): Seite läuft, Kopfzeile „Stand … · nicht offline gespeichert“', async () => {
    const gesperrt = () => { IDBFactory.prototype.open = function () { throw new DOMException('Test: Speicher gesperrt', 'SecurityError'); }; };
    await mitSeite({ withToken: false, init: [gesperrt] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      assert.equal(await text(page, '#status'), 'noch kein Paket');
      await importiere(page, testPaket());
      assert.ok(await page.isHidden('#fehler'));
      assert.equal(await text(page, '#status'), 'Stand 17.11.2026 · nicht offline gespeichert');
      assert.equal(await text(page, '#paketInfo'), 'Platzhalter-Paket · Version 2026-11-17.1 · 3 Dokumente');
      assert.equal((await kacheln(page)).length, 3);
      assert.equal(await page.evaluate(() => window.AetherFlyer.gespeichert()), null);
      assert.deepEqual(log.errors, []);
    });
  });

  test('Layout 320–1400 px ohne waagerechtes Scrollen (Kacheln und Vollbild), Tippflächen ≥ 44 × 44 px', async () => {
    await mitSeite({ withToken: false, init: [druckStub], viewport: { width: 320, height: 700 } }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, testPaket({ texte: { T2: SEHR_LANG }, titel: 'Platzhalter-Paket mit einem sehr langen Titel, der umbrechen muss' }));
      const groessen = [[320, 568], [375, 667], [390, 844], [414, 896], [600, 900], [768, 1024], [834, 1194], [874, 402], [1024, 768], [1194, 834], [1280, 800], [1400, 900]];
      const messen = () => page.evaluate(() => {
        const box = (e) => { const r = e.getBoundingClientRect(); return { x0: r.left, x1: r.right, w: r.width, h: r.height }; };
        const ziele = [...document.querySelectorAll('button, a, .kachel')].filter((e) => e.offsetParent !== null && !e.closest('#modal') && !e.closest('.flyer-host'));
        return { overflow: document.documentElement.scrollWidth - window.innerWidth, ziele: ziele.map((e) => ({ t: (e.getAttribute('aria-label') || e.textContent).trim().slice(0, 30), ...box(e) })) };
      });
      for (const [w, h] of groessen) {
        await page.setViewportSize({ width: w, height: h });
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
        for (const zustand of ['kacheln', 'vollbild']) {
          if (zustand === 'vollbild') {
            await page.click('#kacheln .kachel[data-id="T2"]');
            await ruhe(page);
          }
          const m = await messen();
          const label = `${w}×${h} ${zustand}`;
          assert.ok(m.overflow <= 0, `${label}: kein waagerechtes Scrollen (${m.overflow})`);
          if (zustand === 'kacheln') {
            // ResizeObserver: Vorschau nach der Größenänderung wieder auf Kachelbreite
            const ab = await page.$$eval('#kacheln .kachel-bild', (bs) => bs.map((b) => b.getBoundingClientRect().width - b.querySelector('.flyer-host').getBoundingClientRect().width));
            assert.ok(ab.length === 3 && ab.every((d) => Math.abs(d) <= 1.5), `${label}: Vorschau auf Kachelbreite (${ab})`);
          }
          for (const z of m.ziele) {
            assert.ok(z.w >= 44 && z.h >= 44, `${label}: Tippfläche „${z.t}“ ${z.w}×${z.h}`);
            assert.ok(z.x0 >= -0.5 && z.x1 <= w + 0.5, `${label}: „${z.t}“ im Fenster`);
          }
          if (zustand === 'vollbild') {
            const sk = await page.evaluate(() => { const b = document.getElementById('vbBuehne'), host = b.querySelector('.flyer-host'); return { bw: b.clientWidth, hw: host.getBoundingClientRect().width, sw: b.scrollWidth }; });
            assert.ok(sk.hw <= sk.bw + 1 && sk.sw <= sk.bw + 1, `${label}: Dokument passt in die Bühne (${sk.hw}/${sk.bw})`);
          }
          if ([320, 390, 1194, 1400].includes(w)) await page.screenshot({ path: path.join(OUT, `flyer-${zustand}-${w}x${h}.png`) });
          if (zustand === 'vollbild') await page.keyboard.press('Escape');
        }
      }
      // Fenstergröße bei offenem Vollbild ändern → neu skaliert
      await page.setViewportSize({ width: 1194, height: 834 });
      await page.click('#kacheln .kachel[data-id="T1"]');
      await ruhe(page);
      for (const w of [600, 320, 1024]) {
        await page.setViewportSize({ width: w, height: 800 });
        await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(r)))));
        const sk = await page.evaluate(() => { const b = document.getElementById('vbBuehne'), host = b.querySelector('.flyer-host'); return { bw: b.clientWidth, hw: host.getBoundingClientRect().width, sw: b.scrollWidth }; });
        assert.ok(sk.hw <= sk.bw + 1 && sk.hw >= sk.bw - 40 && sk.sw <= sk.bw + 1, `Vollbild nach Größenänderung auf ${w} px neu skaliert (${sk.hw}/${sk.bw})`);
      }
      await page.keyboard.press('Escape');
      assert.deepEqual(log.errors, []);
    });
  });
});

// ---------------------------------------------------------------------------
describe('Flyer: Isolation (Gegenbeispiele)', () => {
  const HOST_UEBER_ALLES = ':host{position:fixed!important;inset:0!important;width:auto!important;height:auto!important;' +
    'z-index:2147483647!important;transform:none!important}';
  // Gezeichnete Farbe [r, g, b] in der Mitte eines Elements (Bildschirmfoto eines Pixels)
  const pixelMitte = async (page, sel) => {
    const b = await page.$eval(sel, (el) => { const r = el.getBoundingClientRect(); return { x: Math.round(r.left + r.width / 2), y: Math.round(r.top + r.height / 2) }; });
    const png = await page.screenshot({ clip: { x: b.x, y: b.y, width: 1, height: 1 } });
    return page.evaluate(async (b64) => {
      const img = new Image();   // (CSP: fetch auf data: ist nicht erlaubt, Bilder schon)
      img.src = 'data:image/png;base64,' + b64;
      await img.decode();
      const cv = new OffscreenCanvas(1, 1), ctx = cv.getContext('2d');
      ctx.drawImage(img, 0, 0);
      return [...ctx.getImageData(0, 0, 1, 1).data.slice(0, 3)];
    }, png.toString('base64'));
  };
  // Mitte eines Elements → das dort getroffene Element (id, sonst Klasse)
  const treffer = (page, sel) => page.$eval(sel, (el) => {
    const r = el.getBoundingClientRect();
    const t = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return t ? (t.id || t.className || t.localName) : null;
  });
  for (const ort of ['css', 'style']) {
    test(`:host-Regel mit !important (${ort === 'css' ? 'im Paket-CSS' : 'als <style> im Dokument'}) legt kein Dokument über die Seite; Knöpfe bleiben bedienbar`, async () => {
      await mitSeite({ withToken: false }, async ({ page, log }) => {
        await oeffneFlyer(page);
        const p = testPaket();
        const rot = '.page{background:#cc0000!important}';
        if (ort === 'css') p.css.flyer += `\n${HOST_UEBER_ALLES}\n${rot}`;
        else p.dokumente[0].html = p.dokumente[0].html.replace('<div class="fill">', `<style>${HOST_UEBER_ALLES}\n${rot}</style><div class="fill">`);
        await importiere(page, p);
        await ruhe(page);
        // Die :host-Regel greift (sonst prüfte der Test nichts) …
        assert.equal(await page.$eval(KACHEL_HOST('T1'), (h) => getComputedStyle(h).position), 'fixed');
        // … bleibt aber im Rahmen der Kachel: Lage und Gezeichnetes (das Kachelbild ist inert – Klicks gingen auch
        // ohne Rahmen durch, aber das Dokument läge sichtbar über der Seite)
        const r = await page.$eval('#kacheln .kachel[data-id="T1"]', (k) => {
          const rr = (e) => { const x = e.getBoundingClientRect(); return [x.left, x.top, x.right, x.bottom]; };
          return { bild: rr(k.querySelector('.kachel-bild')), host: rr(k.querySelector('.flyer-host')) };
        });
        assert.ok(r.host[0] >= r.bild[0] - 1 && r.host[1] >= r.bild[1] - 1 && r.host[2] <= r.bild[2] + 1 && r.host[3] <= r.bild[3] + 1,
          `Host liegt im Kachelbild (Host ${r.host.map(Math.round)}, Bild ${r.bild.map(Math.round)})`);
        for (const sel of ['#zumDashboard', '#btnImport', '#kacheln .kachel[data-id="I1"] .kachel-titel']) {
          assert.notDeepEqual(await pixelMitte(page, sel), [204, 0, 0], `${sel}: nicht vom Dokument übermalt`);
        }
        // Kopfzeile, Knöpfe und die anderen Kacheln sind erreichbar
        assert.equal(await treffer(page, '#zumDashboard'), 'zumDashboard');
        assert.equal(await treffer(page, '#btnImport'), 'btnImport');
        assert.equal(await treffer(page, '#kacheln .kachel[data-id="I1"] .kachel-titel'), 'kachel-titel');
        const lage = await page.$eval('#kacheln .kachel[data-id="T1"] .kachel-bild', (b) => {
          const r = b.getBoundingClientRect();
          // Was an Punkten knapp außerhalb des Kachelbilds liegt, gehört nicht zum Dokument
          const aussen = [[r.left + r.width / 2, r.bottom + 4], [r.right + 4, r.top + r.height / 2], [r.left + r.width / 2, r.top - 4]]
            .map(([x, y]) => document.elementFromPoint(x, y)).map((e) => (e ? e.closest('.flyer-host') !== null : false));
          return { aussen };
        });
        assert.deepEqual(lage.aussen, [false, false, false], 'neben dem Kachelbild trifft man nicht das Dokument');
        // Vollbild: ✕ ist anklickbar und schließt
        await page.click('#kacheln .kachel[data-id="T1"]');
        await ruhe(page);
        assert.equal(await treffer(page, '#vbZu'), 'vbZu');
        assert.equal(await treffer(page, '#vbWeiter'), 'vbWeiter');
        await page.click('#vbZu', { timeout: 3000 });
        assert.equal(await page.evaluate(() => window.AetherFlyerAnsicht.offenesDokument()), null, '✕ schließt');
        assert.deepEqual(log.errors, []);
        assert.deepEqual(log.fremd, []);
      });
    });
  }

  test('Seiten-Variablen (--bg, --text, --accent …) wirken nicht ins Dokument – hell wie dunkel gleich; eigene Paket-Variablen gelten', async () => {
    await mitSeite({ withToken: false }, async ({ page, log }) => {
      await oeffneFlyer(page);
      const p = testPaket();
      p.css.flyer += '\n:root{--panel:rgb(10, 20, 30)}\n.kopf{color:var(--panel,rgb(0, 0, 0))}' +
        '\n.fuss{background-color:var(--bg,rgb(1, 2, 3));color:var(--text,rgb(4, 5, 6));border-top:3px solid var(--accent,rgb(7, 8, 9))}';
      await importiere(page, p);
      const werte = () => page.$eval(KACHEL_HOST('T1'), (h) => {
        const cs = (sel) => getComputedStyle(h.shadowRoot.querySelector(sel));
        return { fussGrund: cs('.fuss').backgroundColor, fussSchrift: cs('.fuss').color, fussLinie: cs('.fuss').borderTopColor, kopf: cs('.kopf').color,
          seite: getComputedStyle(document.body).backgroundColor };
      });
      const erwartet = { fussGrund: 'rgb(1, 2, 3)', fussSchrift: 'rgb(4, 5, 6)', fussLinie: 'rgb(7, 8, 9)', kopf: 'rgb(10, 20, 30)' };
      await page.emulateMedia({ colorScheme: 'light' });
      const hell = await werte();
      await page.emulateMedia({ colorScheme: 'dark' });
      const dunkel = await werte();
      assert.notEqual(hell.seite, dunkel.seite, 'die Seite selbst wechselt hell/dunkel');
      for (const [name, w] of [['hell', hell], ['dunkel', dunkel]]) {
        const { seite, ...dok } = w;
        assert.deepEqual(dok, erwartet, `${name}: Ersatzwerte des Pakets, nicht die Seiten-Variablen`);
      }
      assert.deepEqual(log.errors, []);
    });
  });

  test('@font-face des Pakets mit einem Schriftnamen der Seite ändert die Seite nicht; @font-face in @layer/@media/@supports wirkt', async () => {
    await mitSeite({ withToken: false }, async ({ context, page, log }) => {
      await oeffneFlyer(page);
      const p = testPaket();
      const [jost400, jost700, ...rest] = FLYER_CSS.split('\n');
      p.css.flyer = '@font-face{font-family:"Avenir Next";src:url("fonts/jost/jost-latin-700-normal.woff") format("woff")}\n' +
        '@font-face{font-family:-apple-system;src:url("fonts/jost/jost-latin-700-normal.woff") format("woff")}\n' +
        `@layer basis{${jost400}}\n@supports (display:grid){@media screen{${jost700}}}\n` + rest.join('\n');
      await importiere(page, p);
      await ruhe(page);
      const regeln = await page.$eval('#flyerDokRegeln', (s) => s.textContent);
      assert.doesNotMatch(regeln, /Avenir Next|apple-system/, 'Seiten-Schriftnamen nicht im Dokument');
      assert.match(regeln, /@layer basis\{@font-face\{font-family:"Platzhalter Jost"/, '@font-face aus @layer');
      assert.match(regeln, /@supports \(display:grid\)\{@media screen\{@font-face\{font-family:"Platzhalter Jost"/, '@font-face aus @supports/@media');
      // Die Seite zeichnet ihre Texte weiter mit Systemschriften, das Dokument mit der Paket-Schrift
      const cdp = await context.newCDPSession(page);
      await cdp.send('DOM.enable');
      await cdp.send('CSS.enable');
      const { root } = await cdp.send('DOM.getDocument', { depth: -1, pierce: true });
      const schriften = async (sel) => {
        const { nodeId } = await cdp.send('DOM.querySelector', { nodeId: root.nodeId, selector: sel });
        return (await cdp.send('CSS.getPlatformFontsForNode', { nodeId })).fonts;
      };
      for (const sel of ['.kopf .titel', '#btnImport', '#status']) {
        const f = await schriften(sel);
        assert.ok(f.length > 0 && f.every((x) => !x.isCustomFont), `${sel}: keine Paket-Schrift (${f.map((x) => x.familyName).join(', ')})`);
      }
      const familien = await page.evaluate(() => [...document.fonts].map((f) => [f.family.replace(/"/g, ''), f.weight, f.status]).sort());
      assert.deepEqual(familien, [['Platzhalter Jost', '400', 'loaded'], ['Platzhalter Jost', '700', 'loaded']], 'nur die Paket-Schrift, geladen');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('url(#…) außerhalb von fill/stroke/clip-path/filter/marker lädt nichts (auch nicht die Seite selbst)', async () => {
    await mitSeite({ withToken: false }, async ({ page, log }) => {
      await oeffneFlyer(page);
      const p = testPaket();
      p.css.flyer += '\n.page{background-image:url(#anker1)}\n.fuss{border-image:url("#anker2") 10}\n.liste{list-style-image:url(#anker3)}\n.kopf::after{content:url(#anker4)}';
      p.dokumente[1].html = p.dokumente[1].html.replace('<div class="fill">', '<div class="fill" style="background-image:url(#anker5)">');
      const vorher = log.urls.length;
      await importiere(page, p);
      await page.click('#kacheln .kachel[data-id="T2"]');
      await ruhe(page);
      await page.evaluate(() => new Promise((r) => setTimeout(r, 300)));
      const danach = log.urls.slice(vorher);
      assert.deepEqual(danach.filter((u) => !/\/fonts\/jost\//.test(u)), [], 'keine Anfrage (z. B. flyer.html#anker…)');
      // Der lokale Verlauf der Infografik (fill="url(#…)") bleibt
      assert.equal(await page.$eval(KACHEL_HOST('I1'), (h) => h.shadowRoot.querySelector('circle').getAttribute('fill')), 'url(#ig-verlauf)');
      assert.deepEqual(log.fremd, []);
    });
  });
});

describe('Flyer: Dateien', () => {
  test('App-Hülle (sw.js), Workflow, Tools-Knopf; Skripte, CSP; kein innerHTML & Co., kein localStorage.setItem', () => {
    const OOXML = 'http://schemas.openxmlformats.org/';
    const PPTX_NAMENSRAEUME = [OOXML + 'drawingml/2006/main', OOXML + 'officeDocument/2006/relationships', OOXML + 'presentationml/2006/main',
      OOXML + 'package/2006/relationships', OOXML + 'officeDocument/2006/relationships/', OOXML + 'package/2006/content-types',
      OOXML + 'package/2006/metadata/core-properties', OOXML + 'package/2006/relationships/metadata/core-properties',
      OOXML + 'officeDocument/2006/extended-properties', OOXML + 'officeDocument/2006/docPropsVTypes',
      'http://purl.org/dc/elements/1.1/', 'http://purl.org/dc/terms/', 'http://purl.org/dc/dcmitype/'];
    const lies = (d) => fs.readFileSync(path.join(ROOT, d), 'utf8');
    const sw = lies('sw.js');
    const shell = /var SHELL = \[([^\]]*)\]/.exec(sw)[1];
    for (const d of FLYER_DATEIEN) assert.match(shell, new RegExp(`'${d.replace('.', '\\.')}'`), `${d} in SHELL`);
    assert.match(sw, /var SHELL_CACHE = 'aether-shell-v1';/, 'Cache-Name unverändert');
    const wf = lies('.github/workflows/pages.yml');
    const cp = wf.split('\n').find((z) => /^\s*cp [^\n]*index\.html[^\n]*_site\/\s*$/.test(z));
    assert.ok(cp, 'cp-Zeile im Workflow');
    for (const d of FLYER_DATEIEN) assert.ok(cp.split(/\s+/).includes(d), `Workflow kopiert ${d}`);
    // index.html: Knopf direkt nach „Logo ›“
    const index = lies('index.html');
    assert.match(index, /<a class="btn" id="toolLogo" href="logo\.html">Logo ›<\/a>\r?\n\s*<a class="btn" id="toolFlyer" href="flyer\.html">Flyer ›<\/a>\r?\n/);
    // flyer.html: Skripte in fester Reihenfolge, kein Inline-Skript, CSP, nichts aus dem Netz
    const html = lies('flyer.html');
    assert.deepEqual([...html.matchAll(/<script\b([^>]*)>/g)].map((m) => (/src="([^"]*)"/.exec(m[1]) || [])[1] || 'INLINE'), ['gemeinsam.js', ...MODULE]);
    assert.ok(html.includes('<meta http-equiv="Content-Security-Policy" content="default-src \'self\'; script-src \'self\'; style-src \'self\' \'unsafe-inline\'; img-src \'self\' data: blob:; media-src \'self\' blob:; font-src \'self\' data:; connect-src \'self\' https://api.github.com; object-src \'none\'; base-uri \'none\'; form-action \'none\'; frame-src \'none\'">'), 'CSP (F3b: media-src blob: für Videos der Bibliothek)');
    assert.doesNotMatch(html, /<link[^>]+stylesheet/i);
    assert.match(html, /<title>Aether – Flyer<\/title>/);
    assert.match(html, /<input type="file" id="dateiImport" hidden>/);
    // Rahmen um jedes dargestellte Dokument (Kachel, Vollbild, Druckseite)
    assert.match(html, /\.kachel-bild, \.vb-huelle, \.druck-seite\{ contain:paint; \}/, 'contain:paint um jedes Dokument');
    // Was flyer-paket.js über die Seite weiß, passt zu flyer.html: alle eigenen Variablen, alle Schriftnamen
    const fenster = {};
    require('node:vm').runInNewContext(lies('flyer-paket.js'), { window: fenster });
    const stil = /<style>([\s\S]*?)<\/style>/.exec(html)[1];
    const variablen = [...new Set([...stil.matchAll(/(--[a-z][a-z-]*)\s*:/g)].map((m) => m[1]))].sort();
    assert.ok(variablen.length >= 15);
    assert.deepEqual([...fenster.AetherFlyerPaket.SEITEN_VARIABLEN].sort(), variablen, 'SEITEN_VARIABLEN = Variablen von flyer.html');
    const schriften = [...stil.matchAll(/font-family:([^;}]+)/g)].flatMap((m) => m[1].split(',')).map((f) => f.trim().replace(/^["']|["']$/g, '').toLowerCase());
    assert.ok(schriften.includes('avenir next'));
    for (const f of schriften) assert.ok(fenster.AetherFlyerPaket.SEITEN_SCHRIFTEN.includes(f), `Schrift „${f}“ der Seite in SEITEN_SCHRIFTEN`);
    for (const d of FLYER_DATEIEN) {
      const t = lies(d);
      assert.doesNotMatch(t, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/, `${d}: kein innerHTML & Co.`);
      assert.doesNotMatch(t, /localStorage\.setItem/, `${d}: Token wird nie geschrieben`);
      const urls = [...t.matchAll(/https?:\/\/[^\s'"<>);]+/g)].map((m) => m[0]).filter((u) => !u.startsWith('http://www.w3.org/'));
      // Teil 2: in flyer.html zusätzlich genau der Upload-Link der Hilfe „Online stellen“ (Navigation, kein Abruf)
      const erlaubt = d === 'flyer.html' ? ['https://api.github.com', 'https://github.com/konstantin9ezm/aether/upload/main/docs/flyer']
        // F3b: in flyer-medien.js genau der Upload-Link von „Medien online stellen“ (Navigation, kein Abruf)
        : d === 'flyer-medien.js' ? ['https://api.github.com', 'https://github.com/konstantin9ezm/aether-medien/upload/main/medien']
        // PowerPoint-Export: genau die XML-Namensräume von Office Open XML und Dublin Core (Kennungen in der Datei, nie abgerufen)
        : d === 'flyer-pptx.js' ? ['https://api.github.com', ...PPTX_NAMENSRAEUME] : ['https://api.github.com'];
      assert.deepEqual(urls.filter((u) => !erlaubt.includes(u)), [], `${d}: nur die GitHub-API`);
    }
    // Module: IIFE mit 'use strict', genau ein window.AetherFlyerX = Object.freeze(…)
    const namen = { 'flyer-paket.js': 'AetherFlyerPaket', 'flyer-struktur.js': 'AetherFlyerStruktur', 'flyer-speicher.js': 'AetherFlyerSpeicher', 'flyer-ansicht.js': 'AetherFlyerAnsicht', 'flyer-online.js': 'AetherFlyerOnline', 'flyer-export.js': 'AetherFlyerExport', 'flyer-aenderungen.js': 'AetherFlyerAenderungen', 'flyer-bearbeiten.js': 'AetherFlyerBearbeiten', 'flyer-uebersicht.js': 'AetherFlyerUebersicht', 'flyer-zip.js': 'AetherFlyerZip', 'flyer-grafik.js': 'AetherFlyerGrafik', 'flyer-pptx.js': 'AetherFlyerPptx', 'flyer-medien.js': 'AetherFlyerMedien', 'flyer-bibliothek.js': 'AetherFlyerBibliothek', 'flyer-medien-tafeln.js': 'AetherFlyerMedienTafeln', 'flyer-player.js': 'AetherFlyerPlayer', 'flyer-medien-online.js': 'AetherFlyerMedienOnline', 'flyer-werte.js': 'AetherFlyerWerte', 'flyer.js': 'AetherFlyer' };
    for (const [d, n] of Object.entries(namen)) {
      const t = lies(d);
      const code = t.replace(/^(\s*\/\/[^\n]*\n)*/, '');
      assert.match(code, /^\(function \(\) \{\s*\n\s*'use strict';/, `${d}: IIFE mit 'use strict'`);
      assert.match(code.trimEnd(), /\}\)\(\);$/, `${d}: endet mit })();`);
      assert.deepEqual([...t.matchAll(/window\.(AetherFlyer\w*)\s*=(?!=)/g)].map((m) => m[1]), [n], `${d}: setzt genau window.${n}`);
      assert.match(t, new RegExp(`window\\.${n} = Object\\.freeze\\(`), `${d}: Object.freeze`);
      assert.doesNotMatch(t, /^\s*(import|export)\s/m, `${d}: keine ES-Module`);
    }
    // Speicher: DB_VERSION 5, Migration 1 → 2 legt nur den Store „aenderungen“ an (Teil 2), 2 → 3 die Stores „struktur“
    // und „geraet“ und versioniert die Änderungsschicht (F3a), 3 → 4 nur den Store „medien“ (F3b), 4 → 5 nur den Store „werte“
    const sp = lies('flyer-speicher.js');
    assert.match(sp, /DB_VERSION = 5\b/);
    assert.match(sp, /if \(alt < 1\) \{ db\.createObjectStore\('basis'\); db\.createObjectStore\('online'\); \}\s*\n\s*if \(alt < 2\) db\.createObjectStore\('aenderungen'\);[^\n]*\n\s*if \(alt < 3\) \{ db\.createObjectStore\('struktur'\); db\.createObjectStore\('geraet'\); verschiebeAufVersion\(req\.transaction\); \}\s*\n\s*if \(alt < 4\) db\.createObjectStore\('medien'\);[^\n]*\n\s*if \(alt < 5\) db\.createObjectStore\('werte'\);/);
    // Nur lesende Anfragen an die API
    assert.doesNotMatch(lies('flyer-online.js'), /method:\s*'(POST|PUT|PATCH|DELETE)'/i);
  });
});
