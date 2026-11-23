// Tests für Teil 2 der Seite „Flyer & Infografiken“ (flyer.html): Export (#btnExport, Fassung „<heute>.<n>“, Download,
// Teilen, Blob-URL freigeben), Abgleich bei jeder Übernahme (Regeln 1–4, fehlende Kennung/fehlendes Dokument,
// Idempotenz, Konfliktwahl, Online „Laden“), Sicherung (sichern, verwerfen, einspielen, Fehlerfälle) und die
// IndexedDB-Migration 1 → 2 (basis und online bleiben, Token nie gespeichert, nie exportiert, nie gesichert).
// Nur ein selbst gebautes Mini-Paket mit Platzhaltertexten; „heute“ kommt immer aus dem Browser
// (AetherFlyerAenderungen.heute(), Kontext Europe/Berlin), damit die Tests an jedem Tag laufen.
// Aufruf: node --test tests/flyer-abgleich.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
const BASE = '/repos/konstantin9ezm/aether';
const ORDNER = `${BASE}/contents/docs/flyer`;
const DATEI = `${ORDNER}/aether-flyer-paket.json`;
const BLOBS = `${BASE}/git/blobs/`;
const RAW = 'application/vnd.github.raw+json';
const SHA_A = 'aaaaaaa000000000000000000000000000000001';
const SHA_B = 'bbbbbbb000000000000000000000000000000002';
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

// ---------------------------------------------------------------------------
// Mini-Paket (nur Platzhalter)
// ---------------------------------------------------------------------------
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
  '.fuss{flex:none;padding-top:16px;font-size:16px}'
].join('\n');
const IG_CSS = [
  '.ig{width:1080px;height:1400px;box-sizing:border-box;padding:40px;overflow:hidden;background:#f0e0d0;color:#202020;' +
    'font-family:"Platzhalter Jost",sans-serif;font-size:32px}',
  '.ig h1{margin:0 0 20px;font-size:48px}'
].join('\n');

const zahl = (v) => String(Math.round(v * 10000) / 10000);
// Flyer mit Zähler-Block (data-zaehler="b1" → Liste data-block="b1"), drei Status-Punkten, Texten t1–t3 und einem
// Stand-Element mit reinem Text. o: t1, t2, t3, umbruch, status[], standFormat, standText, ohneT3
function flyerHtml(o) {
  const st = o.status || ['ok', 'run', 'plan'];
  const ok = st.filter((s) => s === 'ok').length, run = st.filter((s) => s === 'run').length;
  const a = zahl(ok / st.length), l = zahl(run / st.length);   // --anteil-laeuft = run/y (Regel des Pakets)
  const t2 = o.t2 !== undefined ? o.t2 : (o.umbruch ? 'Platzhalter Zeile eins<br>Platzhalter Zeile zwei' : 'Kurzer Platzhaltertext.');
  const standText = o.standText || (o.standFormat === 'lang' ? 'Stand: 1. Februar 2020' : 'Stand 01.02.2020');
  return '<section class="page">' +
    `<header class="kopf"><h1 data-t="t1">${o.t1}</h1><span class="zahl" data-zaehler="b1" style="--anteil:${a};--anteil-laeuft:${l}"><ae-t>${ok} von ${st.length} fertig</ae-t></span></header>` +
    `<div class="body"><p data-t="t2"><ae-t>${t2}</ae-t></p>` +
    `<ul class="liste" data-block="b1" style="--anteil:${a};--anteil-laeuft:${l}">` +
    st.map((s, i) => `<li data-s="s${i + 1}"${s ? ` data-status="${s}"` : ''}>Platzhalter-Punkt ${i + 1}</li>`).join('') + '</ul>' +
    '<div class="fill"></div></div>' +
    `<footer class="fuss">${o.ohneT3 ? '' : `<span data-t="t3">${o.t3 || 'Platzhalter-Fußzeile'}</span> `}<span data-stand="${o.standFormat || 'kurz'}">${standText}</span></footer></section>`;
}
// Infografik: data-stand an einem Element mit Kindern (kein reiner Text → kein Stand-Eintrag)
function igHtml() {
  return '<section class="ig" data-stand="lang"><h1 data-t="t1">Platzhalter-Infografik</h1>' +
    '<p data-block="b1" data-zaehler="2"><ae-t>Platzhalter</ae-t> <span data-s="s1" data-status="ok">fertig</span></p></section>';
}
// T1 (mit <br> in t2, Stand kurz), T2 (Stand lang), I1. o: version, stand, T1, T2 (Überschreibungen), ohneT2
function paket(o = {}) {
  const { version = '2020-02-01.1', stand = '2020-02-01', T1 = {}, T2 = {}, ohneT2 = false } = o;
  return {
    format: 'aether-flyer-paket',
    formatVersion: 1,
    titel: 'Platzhalter-Paket',
    version,
    stand,
    css: { flyer: FLYER_CSS, infografik: IG_CSS },
    kategorien: [{ id: 'info', name: 'Platzhalter Info' }, { id: 'grafik', name: 'Platzhalter Grafik' }],
    dokumente: [
      { id: 'T1', art: 'flyer', kategorie: 'info', titel: 'Platzhalter eins', breite: 794, hoehe: 1123, html: flyerHtml({ t1: 'Platzhalter eins', umbruch: true, standFormat: 'kurz', ...T1 }) },
      ...(ohneT2 ? [] : [{ id: 'T2', art: 'flyer', kategorie: 'info', titel: 'Platzhalter zwei', breite: 794, hoehe: 1123, html: flyerHtml({ t1: 'Platzhalter zwei', standFormat: 'lang', ...T2 }) }]),
      { id: 'I1', art: 'infografik', kategorie: 'grafik', titel: 'Platzhalter-Infografik', breite: 1080, hoehe: null, html: igHtml() }
    ]
  };
}
// ISO-Tag → „TT.MM.JJJJ“ bzw. „T. Monat JJJJ“
function kurz(iso) { const [j, m, t] = iso.split('-'); return `${t}.${m}.${j}`; }
function lang(iso) { const [j, m, t] = iso.split('-').map(Number); return `${t}. ${MONATE[m - 1]} ${j}`; }

// ---------------------------------------------------------------------------
// Statischer Server und Mock-API (wie in tests/flyer.test.js)
// ---------------------------------------------------------------------------
const mock = {};
function mockZurueck() {
  Object.assign(mock, { modus: 'ok', sha: SHA_A, datei: JSON.stringify(paket()), blobs: {}, requests: [] });
}
mockZurueck();
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.woff': 'font/woff', '.ttf': 'font/ttf' };
let server, baseUrl, browser;

before(async () => {
  server = http.createServer((req, res) => {
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
    { name: 'aether-flyer-paket.json', path: 'docs/flyer/aether-flyer-paket.json', sha: mock.sha, type: 'file' }
  ];
}
async function antwort(route, url, headers) {
  const json = (status, obj) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(obj) });
  if (headers.authorization !== `Bearer ${TOKEN}`) return json(401, { message: 'Bad credentials' });
  // Paket-Umzug (Übergang): aether-medien/flyer ohne Paket – gelesen wird wie bisher am alten Ort docs/flyer
  if (url.pathname === '/repos/konstantin9ezm/aether-medien/contents/flyer') return json(200, [{ name: 'README.md', path: 'flyer/README.md', sha: 'ccccccc000000000000000000000000000000009', type: 'file' }]);
  const ref = url.searchParams.get('ref');
  if (url.pathname === ORDNER && ref === 'main') return json(200, standardOrdner());
  if (url.pathname === DATEI && ref === 'main') {
    if (headers.accept === RAW) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': `${RAW}; charset=utf-8` }, body: mock.datei });
    return json(200, { name: 'aether-flyer-paket.json', sha: mock.sha, encoding: 'base64', content: Buffer.from(mock.datei).toString('base64') });
  }
  if (url.pathname.startsWith(BLOBS)) {
    const sha = url.pathname.slice(BLOBS.length);
    const inhalt = Object.prototype.hasOwnProperty.call(mock.blobs, sha) ? mock.blobs[sha] : (sha === mock.sha ? mock.datei : null);
    if (inhalt === null) return json(404, { message: 'Not Found' });
    if (headers.accept === RAW) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': `${RAW}; charset=utf-8` }, body: inhalt });
    return json(200, { sha, encoding: 'base64', content: Buffer.from(inhalt).toString('base64') });
  }
  return json(404, { message: 'Not Found' });
}
async function githubApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  mock.requests.push({ method: req.method(), path: url.pathname, auth: headers.authorization || null });
  try { await antwort(route, url, headers); } catch (e) { /* Kontext schon geschlossen */ }
}
const anfragen = () => mock.requests.filter((r) => r.path.startsWith(ORDNER) || r.path.startsWith(BLOBS))
  .map((r) => (r.path === ORDNER ? 'ordner' : r.path === DATEI ? 'datei' : 'blob:' + r.path.slice(BLOBS.length)));

// Teilen-Dialog nachgebaut: merkt sich Name, Typ und Text der geteilten Dateien
function shareMock() {
  window.__share = { calls: [] };
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    const active = navigator.userActivation ? navigator.userActivation.isActive : null;
    const files = await Promise.all(d.files.map(async (f) => ({ name: f.name, type: f.type, text: await f.text() })));
    window.__share.calls.push({ title: d.title, files, active });
  };
}
// Kein Teilen-Dialog (wie ein Desktop-Browser): Weitergabe per Download
function ohneTeilen() {
  Object.defineProperty(Navigator.prototype, 'share', { value: undefined, configurable: true, writable: true });
  Object.defineProperty(Navigator.prototype, 'canShare', { value: undefined, configurable: true, writable: true });
}
// Blob-URLs sofort freigeben und mitschneiden (erzeugt, freigegeben, per Link heruntergeladen)
function urlsMitschneiden() {
  window.AETHER_TEST_FLYER_FREIGABE_MS = 0;
  window.__urls = { erzeugt: [], frei: [], links: [] };
  const c = URL.createObjectURL, r = URL.revokeObjectURL;
  URL.createObjectURL = function (b) { const u = c.call(URL, b); window.__urls.erzeugt.push(u); return u; };
  URL.revokeObjectURL = function (u) { window.__urls.frei.push(u); return r.call(URL, u); };
  const klick = HTMLAnchorElement.prototype.click;
  HTMLAnchorElement.prototype.click = function () { if (this.hasAttribute('download')) window.__urls.links.push({ href: this.href, name: this.download }); return klick.call(this); };
}

// Neue Seite in eigenem Kontext; der Kontext wird immer geschlossen.
async function mitSeite(opts, fn) {
  const { viewport = { width: 1194, height: 834 }, withToken = false, init = [] } = opts;
  mockZurueck();
  const context = await browser.newContext({ viewport, locale: 'de-DE', timezoneId: 'Europe/Berlin', acceptDownloads: true });
  try {
    const page = await context.newPage();
    const log = { urls: [], errors: [], fremd: [] };
    page.on('pageerror', (e) => log.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
    context.on('request', (r) => log.urls.push(r.url()));
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
// Hilfen
// ---------------------------------------------------------------------------
const flyerUrl = () => baseUrl + 'flyer.html';
const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, ' ').trim());
async function oeffneFlyer(page, url = flyerUrl()) {
  if (url) await page.goto(url);
  await page.waitForFunction(() => window.AetherFlyer && window.AetherFlyer.bereit);
  await page.evaluate(() => window.AetherFlyer.bereit);
}
async function onlineFertig(page) {
  await page.waitForFunction(() => {
    const b = document.getElementById('btnOnline'), h = document.getElementById('onlineHinweis').textContent;
    return b && !b.hidden && !b.disabled && !/^(Prüfe|Lade) online/.test(h);
  });
}
async function importiere(page, inhalt, name = 'aether-flyer-paket.json') {
  const buffer = Buffer.from(typeof inhalt === 'string' ? inhalt : JSON.stringify(inhalt, null, 2), 'utf8');
  await page.setInputFiles('#dateiImport', { name, mimeType: 'application/json', buffer });
  await page.waitForFunction(() => document.getElementById('dateiImport').value === '' && !document.getElementById('btnImport').disabled);
}
// Sicherung über #dateiEinspielen; fertig, wenn das Feld zurückgesetzt und der Knopf wieder frei ist
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
const heute = (page) => page.evaluate(() => window.AetherFlyerAenderungen.heute());
const alle = (page) => page.evaluate(() => window.AetherFlyerAenderungen.alle()
  .sort((a, b) => (a.dok + a.art + a.k < b.dok + b.art + b.k ? -1 : 1)));
const ohneZeit = (liste) => liste.map(({ zeit, ...r }) => r);
const konflikte = (page) => page.evaluate(() => window.AetherFlyerAenderungen.konflikte());
const KACHEL_HOST = (id) => `#kacheln .kachel[data-id="${id}"] .flyer-host`;
// Darstellung eines Dokuments in einem Host (Kachel oder Vollbild): Texte, Status, Zähler, Stand, Markierungen
const darstellung = (page, sel) => page.$eval(sel, (host) => {
  const r = host.shadowRoot;
  return {
    t: [...r.querySelectorAll('[data-t]')].map((e) => [e.getAttribute('data-t'), e.textContent, e.querySelectorAll('br').length]),
    s: [...r.querySelectorAll('[data-s]')].map((e) => [e.getAttribute('data-s'), e.getAttribute('data-status')]),
    z: [...r.querySelectorAll('[data-zaehler]')].map((e) => [e.textContent, e.style.getPropertyValue('--anteil').trim(), e.style.getPropertyValue('--anteil-laeuft').trim()]),
    block: [...r.querySelectorAll('[data-block]')].map((e) => [e.style.getPropertyValue('--anteil').trim(), e.style.getPropertyValue('--anteil-laeuft').trim()]),
    stand: [...r.querySelectorAll('[data-stand]')].map((e) => e.children.length ? null : e.textContent),
    marken: r.querySelectorAll('[data-ae-geaendert]').length
  };
});
const alleDarstellungen = async (page) => {
  const ids = await page.$$eval('#kacheln .kachel', (ks) => ks.map((k) => k.dataset.id));
  const r = {};
  for (const id of ids) r[id] = await darstellung(page, KACHEL_HOST(id));
  return r;
};
const tWert = (d, k) => (d.t.find((x) => x[0] === k) || [])[1];
const sWert = (d, k) => (d.s.find((x) => x[0] === k) || [])[1];
// Eigenen Wert setzen (reine Logik) und Kachel/Vollbild neu darstellen
async function setze(page, dok, art, k, wert) {
  await page.evaluate(async ([dok, art, k, wert]) => {
    await window.AetherFlyerAenderungen.setze(dok, art, k, wert);
    await window.AetherFlyerAnsicht.aktualisiere(dok);
  }, [dok, art, k, wert]);
}
async function uebernehme(page, r) {
  return page.evaluate((r) => window.AetherFlyer.uebernehme(r, { quelle: 'import' }), r);
}
// Export über #btnExport mit Download → { name, inhalt, paket }
async function exportDownload(page) {
  const vorher = await page.evaluate(() => window.AetherFlyerAenderungen.letzteFassung());
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
  const name = dl.suggestedFilename();
  const inhalt = fs.readFileSync(await dl.path(), 'utf8');
  await page.waitForFunction((v) => window.AetherFlyerAenderungen.letzteFassung() !== v, vorher);
  await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
  const paketR = JSON.parse(inhalt);
  await page.waitForFunction((f) => document.getElementById('hilfeFassung').textContent === f, paketR.version);
  return { name, inhalt, paket: wieV1(paketR), v2: paketR };
}
async function sichernDownload(page) {
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnSichern')]);
  return { name: dl.suggestedFilename(), inhalt: fs.readFileSync(await dl.path(), 'utf8') };
}
// F3a: Ein exportiertes Paket hat das Format v2. Für die Prüfungen von Teil 2 (ein Flyer) zurückgerechnet wie v1:
// Kategorien = Ordner der obersten Ebene, Dokumente = Seiten der Version 1.1 (kategorie = erster Ordner).
function wieV1(p) {
  assert.equal(p.formatVersion, 2, 'Export im Format v2');
  assert.deepEqual(p.versionen.map((v) => v.nummer), ['1.1'], 'genau Version 1.1');
  const v = p.versionen[0];
  return {
    ...p,
    kategorien: v.ordner.filter((o) => o.eltern === null).map((o) => ({ id: o.id, name: o.name })),
    dokumente: v.seiten.map((s) => ({ id: s.id, art: s.art, kategorie: s.ordner[0], titel: s.titel, breite: s.breite, hoehe: s.hoehe, html: s.html }))
  };
}
// Markierungen je Dokument (im Browser per DOMParser gelesen)
async function markierungen(page, pk) {
  return page.evaluate((doks) => doks.map((d) => {
    const b = new DOMParser().parseFromString('<!doctype html><body>' + d.html, 'text/html').body;
    const m = { id: d.id };
    for (const a of ['data-t', 'data-s', 'data-block', 'data-zaehler', 'data-stand']) m[a] = [...b.querySelectorAll('[' + a + ']')].map((e) => e.getAttribute(a));
    m['ae-t'] = b.querySelectorAll('ae-t').length;
    return m;
  }), pk.dokumente);
}
// Werte eines exportierten Dokuments (im Browser gelesen)
async function dokWerte(page, html) {
  return page.evaluate((html) => {
    const b = new DOMParser().parseFromString('<!doctype html><body>' + html, 'text/html').body;
    return {
      t: [...b.querySelectorAll('[data-t]')].map((e) => [e.getAttribute('data-t'), e.textContent]),
      s: [...b.querySelectorAll('[data-s]')].map((e) => [e.getAttribute('data-s'), e.getAttribute('data-status')]),
      z: [...b.querySelectorAll('[data-zaehler]')].map((e) => [e.textContent, e.getAttribute('style')]),
      block: [...b.querySelectorAll('[data-block]')].map((e) => e.getAttribute('style')),
      stand: [...b.querySelectorAll('[data-stand]')].map((e) => e.textContent),
      marken: b.querySelectorAll('[data-ae-geaendert]').length
    };
  }, html);
}
const pruefeImBrowser = (page, inhalt) => page.evaluate((t) => {
  try { window.AetherFlyerPaket.pruefe(JSON.parse(t)); return null; } catch (e) { return [e.title, e.text].join(' '); }
}, inhalt);
// Alles, was die Seite speichert (localStorage, sessionStorage, Caches, IndexedDB)
async function speicher(page) {
  return page.evaluate(async (token) => {
    const ls = Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]);
    const ss = Object.keys(sessionStorage).map((k) => [k, sessionStorage.getItem(k)]);
    const cache = [];
    for (const name of await caches.keys()) {
      const c = await caches.open(name);
      for (const req of await c.keys()) {
        const body = await (await c.match(req)).text();
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
// Vollbild öffnen (Kachel antippen) und Modus wählen
async function oeffneVollbild(page, id) {
  await page.click(`#kacheln .kachel[data-id="${id}"]`);
  await page.waitForFunction((id) => {
    const A = window.AetherFlyerAnsicht, d = A.offenesDokument(), h = A.vollbildHost();
    return d && d.id === id && h && h.shadowRoot && h.shadowRoot.querySelector('section');
  }, id);
}
async function modus(page, m) {
  await page.click(`#vbModus [data-modus="${m}"]`);
  await page.waitForFunction((m) => window.AetherFlyerBearbeiten.modus() === m, m);
}
const VB = () => '#vbBuehne .flyer-host';
async function warteKachel(page, id, fn, arg) {
  await page.waitForFunction(([sel, fnText, arg]) => {
    const h = document.querySelector(sel);
    if (!h || !h.shadowRoot) return false;
    return new Function('r', 'arg', fnText)(h.shadowRoot, arg);
  }, [KACHEL_HOST(id), fn, arg]);
}

// ---------------------------------------------------------------------------
describe('Flyer Teil 2: Export', () => {
  test('Export per Download: Dateiname, gültiges Paket, Markierungen erhalten, Änderungen drin, Fassung <heute>.1/.2, Basis <heute>.4 → .5; exportiert gesetzt, Kopfzeile, Hilfe', async () => {
    await mitSeite({ init: [ohneTeilen] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      const basis = paket();
      await importiere(page, basis);
      await ruhe(page);
      const h = await heute(page);
      assert.match(h, /^\d{4}-\d\d-\d\d$/);
      assert.ok(await page.isVisible('#btnExport'), '„Paket exportieren“ sichtbar');
      assert.equal(await text(page, '#btnExport'), 'Paket exportieren');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 01.02.2020', 'ohne Änderungen kein Zusatz');
      assert.equal(await text(page, '#hilfeFassung'), 'noch nicht exportiert');
      // Änderungen über die Oberfläche: Text (Modus Text) und Status (Modus Status)
      await oeffneVollbild(page, 'T1');
      await modus(page, 'text');
      await page.locator(VB()).locator('[data-t="t1"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      assert.equal(await page.inputValue('#vbEditFeld'), 'Platzhalter eins');
      await page.fill('#vbEditFeld', 'Neuer Platzhaltertitel');
      await page.click('#vbEditOk');
      await page.waitForFunction(() => window.AetherFlyerAenderungen.nichtExportiert() === 1);
      await page.waitForFunction(() => /· 1 Änderung nicht exportiert$/.test(document.getElementById('status').textContent));
      await modus(page, 'status');
      await page.locator(VB()).locator('[data-s="s3"]').click();
      await page.waitForSelector('#vbStatus:not([hidden])');
      await page.click('#vbStatus [data-status="ok"]');
      await page.waitForFunction(() => window.AetherFlyerAenderungen.nichtExportiert() === 2);
      await page.click('#vbZu');
      await warteKachel(page, 'T1', 'return r.querySelector(\'[data-s="s3"]\').getAttribute("data-status") === "ok" && r.querySelector(\'[data-t="t1"]\').textContent === "Neuer Platzhaltertitel";');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 01.02.2020 · 2 Änderungen nicht exportiert');
      const dT1 = await darstellung(page, KACHEL_HOST('T1'));
      assert.deepEqual(dT1.z, [['2 von 3 fertig', '0.6667', '0.3333']], 'Zähler in der Kachel neu berechnet (--anteil-laeuft = run/y)');
      assert.deepEqual(dT1.stand, ['Stand ' + kurz(h)], 'Stand in der Kachel auf heute');
      assert.equal(dT1.marken, 0, 'keine Markierung in der Kachel');

      // Export (Download)
      const e1 = await exportDownload(page);
      assert.equal(e1.name, 'aether-flyer-paket.json');
      assert.equal(await pruefeImBrowser(page, e1.inhalt), null, 'besteht AetherFlyerPaket.pruefe');
      assert.equal(e1.paket.version, h + '.1', 'Basis anderen Datums → <heute>.1');
      assert.equal(e1.paket.stand, h);
      assert.equal(e1.paket.format, 'aether-flyer-paket');
      assert.deepEqual(e1.paket.css, basis.css);
      assert.deepEqual(e1.paket.kategorien, basis.kategorien);
      assert.deepEqual(await markierungen(page, e1.paket), await markierungen(page, basis), 'alle Markierungen je Dokument erhalten');
      assert.deepEqual(e1.paket.dokumente.map((d) => [d.id, d.art, d.kategorie, d.titel, d.breite, d.hoehe]),
        basis.dokumente.map((d) => [d.id, d.art, d.kategorie, d.titel, d.breite, d.hoehe]));
      const w1 = await dokWerte(page, e1.paket.dokumente[0].html);
      assert.deepEqual(w1.t, [['t1', 'Neuer Platzhaltertitel'], ['t2', 'Platzhalter Zeile einsPlatzhalter Zeile zwei'], ['t3', 'Platzhalter-Fußzeile']]);
      assert.deepEqual(w1.s, [['s1', 'ok'], ['s2', 'run'], ['s3', 'ok']]);
      assert.deepEqual(w1.stand, ['Stand ' + kurz(h)], 'Stand auf heute');
      assert.equal(w1.z[0][0], '2 von 3 fertig', 'Zähler-Text im Export');
      assert.match(w1.z[0][1], /--anteil:\s*0\.6667/);
      assert.match(w1.z[0][1], /--anteil-laeuft:\s*0\.3333(;|$)/);
      assert.match(w1.block[0], /--anteil:\s*0\.6667/);
      assert.equal(w1.marken, 0, 'keine Markierung im Export');
      assert.ok(/<br>/.test(e1.paket.dokumente[0].html), '<br> der Basis bleibt');
      assert.equal(e1.paket.dokumente[1].html, basis.dokumente[1].html, 'unverändertes T2: html wie die Basis');
      assert.equal(e1.paket.dokumente[2].html, basis.dokumente[2].html, 'unverändertes I1: html wie die Basis');
      // exportiert gesetzt (Store aenderungen), Kopfzeile ohne Zusatz, Hilfe
      await page.waitForFunction(() => !/nicht exportiert/.test(document.getElementById('status').textContent));
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 01.02.2020');
      const st = await speicher(page);
      const store = st.idb.find((e) => e.db === 'aether-flyer' && e.store === 'aenderungen');
      assert.ok(store, 'Store aenderungen');
      const eintraege = store.werte.filter((w, i) => store.schluessel[i] !== 'meta');
      assert.equal(eintraege.length, 3, 'Text, Status, Stand');
      for (const e of eintraege) assert.equal(e.exportiert, e.neu, `exportiert = neu (${e.art} ${e.k})`);
      assert.deepEqual(store.werte[store.schluessel.indexOf('meta')].exporte, [h + '.1']);
      assert.ok(await page.isVisible('#onlineStellen'));
      assert.equal(await text(page, '#hilfeFassung'), h + '.1');
      assert.equal(await page.getAttribute('#hilfeLink', 'href'), 'https://github.com/konstantin9ezm/aether-medien/upload/main/flyer');
      assert.equal(await text(page, '#hilfeCommit'), `Flyer-Paket ${h}.1 [skip ci]`);
      assert.equal(await page.isDisabled('#hilfeKopieren'), false);

      // Erneuter Export → <heute>.2
      const e2 = await exportDownload(page);
      assert.equal(e2.name, 'aether-flyer-paket.json');
      assert.equal(e2.paket.version, h + '.2', 'zweiter Export → <heute>.2');
      assert.equal(await text(page, '#hilfeCommit'), `Flyer-Paket ${h}.2 [skip ci]`);
      // Basis mit Fassung <heute>.4 → Export <heute>.5
      await importiere(page, paket({ version: h + '.4', stand: h }));
      const e3 = await exportDownload(page);
      assert.equal(e3.paket.version, h + '.5', 'Basis <heute>.4 → <heute>.5');
      assert.equal(await pruefeImBrowser(page, e3.inhalt), null);
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Fassung zählt die bekannte Online-Fassung des Tages mit (Online-Prüfung über die Mock-API, auch nach Neuladen)', async () => {
    await mitSeite({ withToken: true, init: [ohneTeilen] }, async ({ page, log }) => {
      mock.datei = JSON.stringify(paket());
      await oeffneFlyer(page);
      await onlineFertig(page);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2020-02-01.1', 'Basis online geladen');
      const h = await heute(page);
      // Online liegt eine Fassung von heute (.7): wird geladen und gemerkt, aber nicht übernommen
      mock.sha = SHA_B;
      mock.datei = JSON.stringify(paket({ version: h + '.7', stand: h }));
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.ok(await page.isVisible('#banner'), 'Banner „Neue Version online“');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2020-02-01.1');
      await setze(page, 'T2', 'text', 't3', 'Geänderte Platzhalter-Fußzeile');
      const e1 = await exportDownload(page);
      assert.equal(e1.paket.version, h + '.8', 'höher als die bekannte Online-Fassung <heute>.7');
      // Nach Neuladen: Online-Fassung aus dem Store, frühere Exporte gemerkt
      await page.reload();
      await oeffneFlyer(page, null);
      await onlineFertig(page);
      const e2 = await exportDownload(page);
      assert.equal(e2.paket.version, h + '.9');
      assert.ok(!e1.inhalt.includes(TOKEN) && !e2.inhalt.includes('github_pat_'), 'kein Token im Export');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('Export → Import derselben Datei: gleiche Darstellung (Text, Status, Zähler, Stand), Schicht danach leer', async () => {
    await mitSeite({ init: [ohneTeilen] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      const h = await heute(page);
      await setze(page, 'T1', 'text', 't2', 'Neue Zeile A\nNeue Zeile B');
      await setze(page, 'T1', 'status', 's2', 'ok');
      await setze(page, 'T2', 'status', 's1', '');
      await setze(page, 'T2', 'text', 't1', 'Zwei mit\nUmbruch');
      await ruhe(page);
      const vorher = await alleDarstellungen(page);
      assert.equal(tWert(vorher.T1, 't2'), 'Neue Zeile ANeue Zeile B');
      assert.equal(vorher.T1.t.find((x) => x[0] === 't2')[2], 1, 'Zeilenumbruch als <br> (Basis hat <br>)');
      assert.equal(tWert(vorher.T2, 't1'), 'Zwei mit Umbruch', 'ohne <br> in der Basis: Leerzeichen');
      assert.deepEqual(vorher.T1.z, [['2 von 3 fertig', '0.6667', '0']]);
      assert.deepEqual(vorher.T2.z, [['0 von 3 fertig', '0', '0.3333']]);
      assert.deepEqual(vorher.T2.stand, ['Stand: ' + lang(h)]);
      assert.equal((await alle(page)).length, 6);
      const e = await exportDownload(page);
      await importiere(page, e.inhalt);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), h + '.1');
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
      assert.deepEqual(await alle(page), [], 'Schicht leer (Regel 1: r = neu → entfällt)');
      assert.ok(await page.isHidden('#konflikte'), 'keine Konflikte');
      await ruhe(page);
      assert.deepEqual(await alleDarstellungen(page), vorher, 'gleiche Darstellung');
      assert.equal(await text(page, '#status'), `offline bereit · Stand ${kurz(h)}`);
      assert.deepEqual(log.errors, []);
    });
  });

  test('Export mit Teilen-Dialog: Datei aether-flyer-paket.json geht an navigator.share (in der Nutzergeste), danach exportiert', async () => {
    await mitSeite({ init: [shareMock] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      const h = await heute(page);
      await setze(page, 'T1', 'text', 't3', 'Geteilte Platzhalter-Fußzeile');
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.nichtExportiert()), 1);
      // Ohne Nutzergeste (Skript-Klick): nichts geteilt
      await page.evaluate(() => document.getElementById('btnExport').click());
      await page.waitForFunction(() => document.getElementById('toast').textContent !== '');
      assert.equal(await page.evaluate(() => window.__share.calls.length), 0, 'Skript-Klick teilt nichts');
      await page.click('#btnExport');
      await page.waitForFunction(() => window.__share.calls.length === 1);
      const c = await page.evaluate(() => window.__share.calls[0]);
      assert.equal(c.active, true, 'share() in der Nutzergeste');
      assert.equal(c.files.length, 1);
      assert.equal(c.files[0].name, 'aether-flyer-paket.json');
      assert.equal(c.files[0].type, 'application/json');
      const pk = JSON.parse(c.files[0].text);
      assert.equal(pk.version, h + '.1');
      assert.equal(await pruefeImBrowser(page, c.files[0].text), null);
      assert.ok(c.files[0].text.includes('Geteilte Platzhalter-Fußzeile'));
      await page.waitForFunction(() => window.AetherFlyerAenderungen.nichtExportiert() === 0);
      await page.waitForFunction(() => !/nicht exportiert/.test(document.getElementById('status').textContent));
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.letzteFassung()), h + '.1');
      assert.deepEqual(log.errors, []);
    });
  });

  test('Download: Blob-URL wird freigegeben (FREIGABE_MS = 0) – beim Export und beim „Bild“', async () => {
    await mitSeite({ init: [ohneTeilen, urlsMitschneiden] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      await ruhe(page);
      const [dl] = await Promise.all([page.waitForEvent('download'), page.click('#btnExport')]);
      assert.equal(dl.suggestedFilename(), 'aether-flyer-paket.json');
      await page.waitForFunction(() => window.__urls.links.length === 1);
      const link = await page.evaluate(() => window.__urls.links[0]);
      assert.equal(link.name, 'aether-flyer-paket.json');
      assert.match(link.href, /^blob:/);
      assert.ok(await page.evaluate((u) => window.__urls.erzeugt.includes(u), link.href), 'URL per createObjectURL erzeugt');
      await page.waitForFunction((u) => window.__urls.frei.includes(u), link.href);
      // „Bild“ (Teil 1) im Vollbild: ebenfalls per Download, URL wird freigegeben
      await oeffneVollbild(page, 'T1');
      await page.waitForFunction(() => !document.getElementById('vbBild').hidden);
      assert.equal(await page.evaluate(() => window.AetherFlyerExport.bildVorbereiten(window.AetherFlyerAnsicht.offenesDokument())), true, 'Bild vorbereitet');
      const [bild] = await Promise.all([page.waitForEvent('download', { timeout: 30000 }), page.click('#vbBild')]);
      assert.equal(bild.suggestedFilename(), 'aether-T1.png');
      await page.waitForFunction(() => window.__urls.links.length === 2);
      const link2 = await page.evaluate(() => window.__urls.links[1]);
      assert.equal(link2.name, 'aether-T1.png');
      await page.waitForFunction((u) => window.__urls.frei.includes(u), link2.href);
      assert.deepEqual(log.errors, []);
    });
  });
});

// ---------------------------------------------------------------------------
describe('Flyer Teil 2: Abgleich', () => {
  test('Regeln 1–3 bei der Übernahme: r = neu → entfällt, r = alt bzw. r = exportiert → bleibt (alt := r), Stand: späteres Datum gewinnt; idempotent', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      const h = await heute(page);
      await setze(page, 'T1', 'text', 't1', 'Mein Titel');
      await setze(page, 'T1', 'status', 's3', 'ok');
      await setze(page, 'T1', 'text', 't3', 'Meine Fußzeile');
      await setze(page, 'T2', 'text', 't1', 'Zwei neu');
      await page.evaluate(() => window.AetherFlyerAenderungen.markiereExportiert('2020-02-01.9'));
      await setze(page, 'T2', 'text', 't1', 'Zwei neuer');
      assert.deepEqual(ohneZeit(await alle(page)), [
        { dok: 'T1', k: 'stand1', art: 'stand', alt: 'Stand 01.02.2020', neu: 'Stand ' + kurz(h), exportiert: 'Stand ' + kurz(h) },
        { dok: 'T1', k: 's3', art: 'status', alt: 'plan', neu: 'ok', exportiert: 'ok' },
        { dok: 'T1', k: 't1', art: 'text', alt: 'Platzhalter eins', neu: 'Mein Titel', exportiert: 'Mein Titel' },
        { dok: 'T1', k: 't3', art: 'text', alt: 'Platzhalter-Fußzeile', neu: 'Meine Fußzeile', exportiert: 'Meine Fußzeile' },
        { dok: 'T2', k: 'stand1', art: 'stand', alt: 'Stand: 1. Februar 2020', neu: 'Stand: ' + lang(h), exportiert: 'Stand: ' + lang(h) },
        { dok: 'T2', k: 't1', art: 'text', alt: 'Platzhalter zwei', neu: 'Zwei neuer', exportiert: 'Zwei neu' }
      ]);
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.nichtExportiert()), 1);
      // R: T1 t1 und s3 wie meins (Regel 1), T1 t3 wie die Basis (Regel 2 alt), T2 t1 = mein Export (Regel 2 exportiert),
      // T1-Stand früher (bleibt), T2-Stand später (entfällt)
      const R = paket({
        version: '2020-02-02.1', stand: '2020-02-02',
        T1: { t1: 'Mein Titel', status: ['ok', 'run', 'ok'] },
        T2: { t1: 'Zwei neu', standText: 'Stand: 1. Januar 2999' }
      });
      await uebernehme(page, R);
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
      const nachher = ohneZeit(await alle(page));
      assert.deepEqual(nachher, [
        { dok: 'T1', k: 'stand1', art: 'stand', alt: 'Stand 01.02.2020', neu: 'Stand ' + kurz(h), exportiert: 'Stand ' + kurz(h) },
        { dok: 'T1', k: 't3', art: 'text', alt: 'Platzhalter-Fußzeile', neu: 'Meine Fußzeile', exportiert: 'Meine Fußzeile' },
        { dok: 'T2', k: 't1', art: 'text', alt: 'Zwei neu', neu: 'Zwei neuer', exportiert: 'Zwei neu' }
      ], 'Regel 1 entfällt, Regel 2 bleibt (alt := r), Stand später → entfällt, früher → bleibt');
      assert.deepEqual(await konflikte(page), []);
      assert.ok(await page.isHidden('#konflikte'), 'kein Konflikt-Banner');
      const d = await alleDarstellungen(page);
      assert.equal(tWert(d.T1, 't1'), 'Mein Titel');
      assert.equal(sWert(d.T1, 's3'), 'ok');
      assert.equal(tWert(d.T1, 't3'), 'Meine Fußzeile');
      assert.deepEqual(d.T1.stand, ['Stand ' + kurz(h)]);
      assert.equal(tWert(d.T2, 't1'), 'Zwei neuer');
      assert.deepEqual(d.T2.stand, ['Stand: 1. Januar 2999'], 'späteres Datum aus R gilt');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 02.02.2020 · 1 Änderung nicht exportiert');
      // Idempotenz: dieselbe Übernahme noch einmal
      const zustand = [await alle(page), await konflikte(page)];
      await uebernehme(page, R);
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
      assert.deepEqual([await alle(page), await konflikte(page)], zustand, 'zweite Übernahme ändert nichts');
      assert.deepEqual(await alleDarstellungen(page), d);
      // Regel 3: R mit früherem Stand-Datum → Stand-Eintrag bleibt, alt := r
      const R2 = paket({ version: '2020-02-03.1', stand: '2020-02-03', T1: { t1: 'Mein Titel', status: ['ok', 'run', 'ok'], standText: 'Stand 03.02.2020' }, T2: { t1: 'Zwei neu' } });
      await uebernehme(page, R2);
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
      const s1 = (await alle(page)).find((e) => e.dok === 'T1' && e.art === 'stand');
      assert.deepEqual([s1.alt, s1.neu], ['Stand 03.02.2020', 'Stand ' + kurz(h)], 'früheres Datum in R: Stand bleibt, alt := r');
      assert.deepEqual(await konflikte(page), []);
      assert.deepEqual(log.errors, []);
    });
  });

  test('Regel 4 und fehlende Stellen: anderer Wert, k fehlt, dok fehlt → Konflikte (Banner, Liste Basis/Meins/Online); bis zur Wahl gilt meins; „Meins behalten“ / „Online übernehmen“; F3a: dok fehlt → Struktur-Konflikt', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      await setze(page, 'T1', 'text', 't1', 'Mein Titel');
      await setze(page, 'T1', 'text', 't3', 'Meine Fußzeile');
      await setze(page, 'T1', 'status', 's2', 'next');
      await setze(page, 'T2', 'text', 't2', 'Mein Text zwei');
      // R: T1 t1 anders (Regel 4), T1 s2 anders (Regel 4), T1 ohne t3 (k fehlt), ohne T2 (dok fehlt)
      const R = paket({ version: '2020-02-02.1', stand: '2020-02-02', T1: { t1: 'Online-Titel', status: ['ok', 'plan', 'plan'], ohneT3: true }, ohneT2: true });
      await uebernehme(page, R);
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
      const k = await konflikte(page);
      const kurzK = k.map((x) => [x.dok, x.art, x.k, x.basis, x.meins, x.online, x.fehlt]).sort();
      // F3a (Teil E): T2 fehlt online, ist lokal geändert → T2 bleibt (Struktur-Konflikt), seine Texte sind keine Konflikte
      assert.deepEqual(kurzK, [
        ['T1', 'status', 's2', 'run', 'next', 'plan', false],
        ['T1', 'text', 't1', 'Platzhalter eins', 'Mein Titel', 'Online-Titel', false],
        ['T1', 'text', 't3', 'Platzhalter-Fußzeile', 'Meine Fußzeile', null, true]
      ]);
      const sk = await page.evaluate(() => window.AetherFlyer.strukturKonflikte());
      assert.deepEqual(sk.map((x) => [x.objekt, x.was, x.zeilen.map((z) => [z.feld, z.lokal, z.andere])]),
        [['P|1.1|T2', 'Seite T2 · Platzhalter zwei (Version 1.1)', [['vorhanden', 'vorhanden', 'nicht vorhanden'], ['Name', 'Platzhalter zwei', '–'], ['In Ordner', 'info', '–']]]]);
      assert.ok(await page.isVisible('#konflikte'), 'Konflikt-Banner');
      assert.match(await text(page, '#konflikteText'), /^4 Konflikte\b/);
      // Bis zur Entscheidung: eigener Wert in der Kachel
      let d = await darstellung(page, KACHEL_HOST('T1'));
      assert.equal(tWert(d, 't1'), 'Mein Titel', 'Kachel zeigt meins');
      assert.equal(sWert(d, 's2'), 'next');
      assert.equal(tWert(await darstellung(page, KACHEL_HOST('T2')), 't2'), 'Mein Text zwei', 'T2 bleibt bis zur Wahl (lokal)');
      // Liste
      assert.ok(await page.isHidden('#konfliktListe'));
      await page.click('#konflikteZeigen');
      assert.ok(await page.isVisible('#konfliktListe'));
      assert.equal(await page.getAttribute('#konflikteZeigen', 'aria-expanded'), 'true');
      const karten = await page.$$eval('#konfliktListe .konflikt:not(.struktur)', (ks) => ks.map((x) => ({
        s: x.getAttribute('data-schluessel'), basis: x.querySelector('.k-basis').textContent, meins: x.querySelector('.k-meins').textContent,
        online: x.querySelector('.k-online').textContent, knoepfe: [...x.querySelectorAll('[data-wahl]')].map((b) => b.getAttribute('data-wahl'))
      })));
      assert.equal(karten.length, 3, 'drei Text-Konflikte');
      assert.equal(await page.$$eval('#konfliktListe .konflikt.struktur', (ks) => ks.length), 1, 'ein Struktur-Konflikt');
      const karte = (s) => karten.find((x) => x.s === s);
      // F3a: Schlüssel beginnt mit der Version („1.1\n…“)
      assert.deepEqual(karte('1.1\nT1\ntext\nt1'), { s: '1.1\nT1\ntext\nt1', basis: 'Platzhalter eins', meins: 'Mein Titel', online: 'Online-Titel', knoepfe: ['meins', 'online'] });
      assert.equal(karte('1.1\nT1\ntext\nt3').online, 'nicht mehr im Paket');
      assert.ok(karte('1.1\nT1\nstatus\ns2'), 'Status-Konflikt in der Liste');
      const waehle = async (s, wahl) => {
        const i = await page.$$eval('#konfliktListe .konflikt', (ks, s) => ks.findIndex((x) => x.getAttribute('data-schluessel') === s), s);
        assert.ok(i >= 0, `Karte ${JSON.stringify(s)}`);
        await page.locator('#konfliktListe .konflikt').nth(i).locator(`[data-wahl="${wahl}"]`).click();
        await page.waitForFunction((s) => !window.AetherFlyerAenderungen.konflikte().some((x) => x.schluessel === s), s);
        await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
      };
      // „Meins behalten“: Eintrag bleibt, alt := Online-Wert, Kachel zeigt meins
      await waehle('1.1\nT1\ntext\nt1', 'meins');
      let e = (await alle(page)).find((x) => x.dok === 'T1' && x.k === 't1');
      assert.deepEqual([e.alt, e.neu], ['Online-Titel', 'Mein Titel']);
      await warteKachel(page, 'T1', 'return r.querySelector(\'[data-t="t1"]\').textContent === "Mein Titel";');
      // „Online übernehmen“: Eintrag entfällt, Kachel zeigt den Online-Wert
      await waehle('1.1\nT1\nstatus\ns2', 'online');
      assert.equal((await alle(page)).find((x) => x.dok === 'T1' && x.k === 's2'), undefined);
      await warteKachel(page, 'T1', 'return r.querySelector(\'[data-s="s2"]\').getAttribute("data-status") === "plan";');
      d = await darstellung(page, KACHEL_HOST('T1'));
      assert.deepEqual(d.z, [['1 von 3 fertig', '0.3333', '0']], 'Zähler nach der Wahl neu berechnet');
      await waehle('1.1\nT1\ntext\nt3', 'online');
      assert.equal((await alle(page)).find((x) => x.dok === 'T1' && x.k === 't3'), undefined, 'k fehlt + online → entfällt');
      // Ein Konflikt übrig (Struktur T2): Einzahl; „Lokal behalten“ → T2 bleibt mit seinen Texten
      await page.waitForFunction(() => /^1 Konflikt\b/.test(document.getElementById('konflikteText').textContent));
      await page.click('#konfliktListe .konflikt.struktur [data-wahl="lokal"]');
      await page.waitForFunction(() => document.getElementById('konflikte').hidden);
      assert.ok(await page.isHidden('#konfliktListe'), 'Liste weg');
      assert.deepEqual(await konflikte(page), []);
      assert.ok((await alle(page)).find((x) => x.dok === 'T2' && x.k === 't2'), 'dok fehlt + lokal → bleibt');
      assert.deepEqual((await alle(page)).map((x) => [x.dok, x.art, x.k]), [['T1', 'stand', 'stand1'], ['T1', 'text', 't1'], ['T2', 'stand', 'stand1'], ['T2', 'text', 't2']]);
      assert.equal(tWert(await darstellung(page, KACHEL_HOST('T1')), 't1'), 'Mein Titel');
      // Nach Neuladen: entschiedene Konflikte bleiben entschieden
      await page.reload();
      await oeffneFlyer(page, null);
      assert.ok(await page.isHidden('#konflikte'));
      assert.deepEqual((await alle(page)).map((x) => [x.dok, x.art, x.k]), [['T1', 'stand', 'stand1'], ['T1', 'text', 't1'], ['T2', 'stand', 'stand1'], ['T2', 'text', 't2']]);
      assert.ok(await page.$(KACHEL_HOST('T2')), 'T2 bleibt (lokaler Stand)');
      assert.deepEqual(log.errors, []);
    });
  });

  test('Abgleich bei Import-Datei und offener Konflikt über Neuladen; Online-Prüfung: neue Fassung, „Laden“ (#bannerLaden) → Abgleich', async () => {
    await mitSeite({ withToken: true }, async ({ page, log }) => {
      mock.datei = JSON.stringify(paket());
      await oeffneFlyer(page);
      await onlineFertig(page);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2020-02-01.1');
      await setze(page, 'T1', 'text', 't1', 'Mein Titel');
      await setze(page, 'T1', 'text', 't3', 'Meine Fußzeile');
      await setze(page, 'T2', 'status', 's3', 'ok');
      // Neue Fassung online: T1 t1 anders (Konflikt), T2 s3 wie meins (entfällt), T1 t3 unverändert (bleibt)
      mock.sha = SHA_B;
      mock.datei = JSON.stringify(paket({ version: '2020-02-05.1', stand: '2020-02-05', T1: { t1: 'Online-Titel' }, T2: { status: ['ok', 'run', 'ok'] } }));
      await page.click('#btnOnline');
      await onlineFertig(page);
      assert.ok(await page.isVisible('#banner'));
      assert.equal(await text(page, '#bannerLaden'), 'Laden');
      assert.deepEqual(await konflikte(page), [], 'vor „Laden“ kein Abgleich');
      await page.click('#bannerLaden');
      await onlineFertig(page);
      await page.waitForFunction(() => window.AetherFlyer.paket().version === '2020-02-05.1');
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
      assert.ok(await page.isHidden('#banner'));
      const k = await konflikte(page);
      assert.deepEqual(k.map((x) => [x.dok, x.art, x.k, x.basis, x.meins, x.online]), [['T1', 'text', 't1', 'Platzhalter eins', 'Mein Titel', 'Online-Titel']]);
      await page.waitForFunction(() => !document.getElementById('konflikte').hidden);
      assert.match(await text(page, '#konflikteText'), /^1 Konflikt\b/);
      assert.equal((await alle(page)).find((x) => x.dok === 'T2' && x.k === 's3'), undefined, 'r = neu → entfällt');
      assert.ok((await alle(page)).find((x) => x.dok === 'T1' && x.k === 't3'), 'r = alt → bleibt');
      assert.equal(tWert(await darstellung(page, KACHEL_HOST('T1')), 't1'), 'Mein Titel', 'bis zur Wahl gilt meins');
      // Offener Konflikt übersteht Neuladen (gespeichert), Banner wieder da
      await page.reload();
      await oeffneFlyer(page, null);
      await onlineFertig(page);
      await page.waitForFunction(() => !document.getElementById('konflikte').hidden);
      assert.equal((await konflikte(page)).length, 1);
      assert.equal(tWert(await darstellung(page, KACHEL_HOST('T1')), 't1'), 'Mein Titel');
      // Import-Datei mit T1 t1 = meins: Konflikt löst sich (Regel 1)
      await importiere(page, paket({ version: '2020-02-06.1', stand: '2020-02-06', T1: { t1: 'Mein Titel' }, T2: { status: ['ok', 'run', 'ok'] } }));
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
      assert.deepEqual(await konflikte(page), []);
      await page.waitForFunction(() => document.getElementById('konflikte').hidden);
      assert.deepEqual((await alle(page)).map((x) => [x.dok, x.art, x.k]), [['T1', 'stand', 'stand1'], ['T1', 'text', 't3']]);
      assert.ok(mock.requests.every((r) => r.auth === `Bearer ${TOKEN}`));
      assert.ok(!log.urls.some((u) => u.includes(TOKEN)), 'Token nie in einer Adresse');
      assertKeinToken(await speicher(page), 'nach Abgleich');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });
});

// ---------------------------------------------------------------------------
describe('Flyer Teil 2: Sicherung', () => {
  test('sichern → verwerfen (Rückfrage ablehnen/annehmen) → einspielen: derselbe Stand; Fehlerfälle ändern nichts; eigene Einträge gehen vor', async () => {
    await mitSeite({ init: [ohneTeilen] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      const basis = paket();
      await importiere(page, basis);
      const h = await heute(page);
      assert.ok(await page.isVisible('#btnSichern'));
      assert.equal(await page.isDisabled('#btnSichern'), true, 'ohne Änderungen nichts zu sichern');
      assert.equal(await page.isDisabled('#btnVerwerfen'), true);
      assert.equal(await page.getAttribute('#dateiEinspielen', 'accept'), null, 'kein accept-Attribut');
      await setze(page, 'T1', 'text', 't1', 'Gesicherter Titel');
      await setze(page, 'T1', 'status', 's1', 'plan');
      await setze(page, 'T2', 'text', 't3', 'Gesicherte Fußzeile');
      await ruhe(page);
      const stand = await alle(page);
      const bild = await alleDarstellungen(page);
      assert.equal(stand.length, 5);
      // Sichern (Download)
      await page.waitForFunction(() => !document.getElementById('btnSichern').disabled);
      const s = await sichernDownload(page);
      assert.equal(s.name, 'aether-flyer-aenderungen.json');
      const o = JSON.parse(s.inhalt);
      // F3a: Sicherung mit Einträgen mit ver und Struktur-Feldern (Teil 2 prüfte v1); F3b: Version 3 (Bibliothek in struktur)
      assert.deepEqual(Object.keys(o).sort(), ['eintraege', 'format', 'gesichert', 'paketFassung', 'struktur', 'version', 'versionNummer']);
      assert.equal(o.format, 'aether-flyer-aenderungen');
      assert.equal(o.version, 3);
      assert.equal(o.versionNummer, '1.1');
      assert.deepEqual(o.struktur, [], 'keine Struktur-Änderungen');
      assert.equal(o.paketFassung, '2020-02-01.1');
      assert.match(o.gesichert, /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(\.\d+)?Z$/);
      for (const e of o.eintraege) assert.deepEqual(Object.keys(e).sort(), ['alt', 'art', 'dok', 'exportiert', 'k', 'neu', 'ver', 'zeit']);
      assert.ok(o.eintraege.every((e) => e.ver === '1.1'));
      const sortiert = (l) => l.slice().sort((a, b) => (a.dok + a.art + a.k < b.dok + b.art + b.k ? -1 : 1));
      assert.deepEqual(sortiert(o.eintraege.map(({ ver, ...r }) => r)), stand);
      // Verwerfen: Rückfrage abgelehnt → nichts passiert
      let frage = null;
      page.once('dialog', (dlg) => { frage = { typ: dlg.type(), text: dlg.message() }; dlg.dismiss(); });
      await page.click('#btnVerwerfen');
      assert.ok(frage, 'Rückfrage gestellt');
      assert.equal(frage.typ, 'confirm');
      await page.waitForTimeout(300);
      assert.deepEqual(await alle(page), stand, 'abgelehnt: nichts verworfen');
      // Annehmen → alles weg, Basis dargestellt
      page.once('dialog', (dlg) => dlg.accept());
      await page.click('#btnVerwerfen');
      await page.waitForFunction(() => window.AetherFlyerAenderungen.alle().length === 0);
      await page.evaluate(() => window.AetherFlyerAenderungen.fertig());
      await warteKachel(page, 'T1', 'return r.querySelector(\'[data-t="t1"]\').textContent === "Platzhalter eins";');
      await warteKachel(page, 'T2', 'return r.querySelector(\'[data-t="t3"]\').textContent === "Platzhalter-Fußzeile";');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 01.02.2020');
      assert.equal((await speicher(page)).idb.find((e) => e.store === 'aenderungen').schluessel.filter((x) => x !== 'meta').length, 0, 'Store leer');
      // Einspielen → derselbe Stand und dieselbe Darstellung
      await einspielen(page, s.inhalt);
      assert.ok(await page.isHidden('#fehler'));
      assert.deepEqual(await alle(page), stand, 'AetherFlyerAenderungen.alle() gleich');
      await ruhe(page);
      assert.deepEqual(await alleDarstellungen(page), bild, 'Darstellung gleich');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 01.02.2020 · 3 Änderungen nicht exportiert');

      // Fehlerfälle: Fehlerbox, nichts ändert sich
      const gueltig = { dok: 'T2', k: 't1', art: 'text', alt: 'Platzhalter zwei', neu: 'Darf nicht kommen', exportiert: null, zeit: '2026-01-01T00:00:00.000Z' };
      const faelle = [
        ['falsches Format', JSON.stringify({ format: 'etwas-anderes', version: 1, eintraege: [gueltig] }), /Keine Änderungs-Sicherung/],
        ['kaputtes JSON', '{ "format": "aether-flyer-aenderungen", ', /kein gültiges JSON/],
        ['falscher Feldtyp', JSON.stringify({ format: 'aether-flyer-aenderungen', version: 1, paketFassung: 'x', gesichert: 'y', eintraege: [gueltig, { ...gueltig, k: 't2', neu: 5 }] }), /Sicherung fehlerhaft/],
        ['zu neue Version', JSON.stringify({ format: 'aether-flyer-aenderungen', version: 4, eintraege: [gueltig] }), /Sicherung zu neu/],   // F3b: die Seite kennt jetzt v3
        ['über 5 MB', JSON.stringify({ format: 'aether-flyer-aenderungen', version: 1, eintraege: [gueltig], fuell: 'x'.repeat(5 * 1024 * 1024) }), /zu groß/]
      ];
      for (const [label, inhalt, re] of faelle) {
        await page.evaluate(() => window.AetherFlyer.fehlerWeg());
        await einspielen(page, inhalt);
        assert.ok(await page.isVisible('#fehler'), `${label}: Fehlerbox`);
        assert.match(await text(page, '#fehler'), re, `${label}: Meldung`);
        assert.deepEqual(await alle(page), stand, `${label}: Schicht unverändert`);
        assert.deepEqual(await alleDarstellungen(page), bild, `${label}: Darstellung unverändert`);
      }
      // Eigene vorhandene Einträge gehen vor; neue kommen dazu
      await page.evaluate(() => window.AetherFlyer.fehlerWeg());
      await setze(page, 'T1', 'text', 't1', 'Jetzt meins');
      await einspielen(page, {
        format: 'aether-flyer-aenderungen', version: 1, paketFassung: '2020-02-01.1', gesichert: '2026-01-01T00:00:00.000Z',
        eintraege: [
          { dok: 'T1', k: 't1', art: 'text', alt: 'Platzhalter eins', neu: 'Aus der Sicherung', exportiert: null, zeit: '2026-01-01T00:00:00.000Z' },
          { dok: 'T2', k: 't2', art: 'text', alt: 'Kurzer Platzhaltertext.', neu: 'Neu aus der Sicherung', exportiert: null, zeit: '2026-01-01T00:00:00.000Z' }
        ]
      });
      assert.ok(await page.isHidden('#fehler'));
      let jetzt = await alle(page);
      assert.equal(jetzt.find((x) => x.dok === 'T1' && x.k === 't1').neu, 'Jetzt meins', 'eigener Eintrag geht vor');
      assert.equal(jetzt.find((x) => x.dok === 'T2' && x.k === 't2').neu, 'Neu aus der Sicherung', 'neuer Eintrag eingespielt');
      await warteKachel(page, 'T2', 'return r.querySelector(\'[data-t="t2"]\').textContent === "Neu aus der Sicherung";');
      assert.equal(tWert(await darstellung(page, KACHEL_HOST('T1')), 't1'), 'Jetzt meins');
      // Eingeordnet wie beim Abgleich gegen die aktuelle Basis: neu = Basis → entfällt, alt ≠ Basis und neu ≠ Basis → Konflikt
      const vorEinspielen = jetzt.length;
      await einspielen(page, {
        format: 'aether-flyer-aenderungen', version: 1, paketFassung: '2019-01-01.1', gesichert: '2026-01-01T00:00:00.000Z',
        eintraege: [
          { dok: 'I1', k: 't1', art: 'text', alt: 'Ganz alt', neu: 'Platzhalter-Infografik', exportiert: null, zeit: '2026-01-01T00:00:00.000Z' },
          { dok: 'T2', k: 't1', art: 'text', alt: 'Ganz alt', neu: 'Sicherung anders', exportiert: null, zeit: '2026-01-01T00:00:00.000Z' }
        ]
      });
      jetzt = await alle(page);
      assert.equal(jetzt.find((x) => x.dok === 'I1'), undefined, 'neu = Basis → entfällt');
      assert.equal(jetzt.length, vorEinspielen + 1);
      const kk = await konflikte(page);
      assert.deepEqual(kk.map((x) => [x.dok, x.k, x.basis, x.meins, x.online]), [['T2', 't1', 'Ganz alt', 'Sicherung anders', 'Platzhalter zwei']], 'anderer Wert → Konflikt');
      await page.waitForFunction(() => !document.getElementById('konflikte').hidden);
      assert.ok(h);
      assert.deepEqual(log.errors, []);
    });
  });
});

// ---------------------------------------------------------------------------
describe('Flyer Teil 2: Speicher', () => {
  test('IndexedDB-Migration 1 → 3: basis und online bleiben, Stores aenderungen, struktur und geraet kommen dazu, Paket angezeigt; Token nie in IndexedDB, Export oder Sicherung', async () => {
    await mitSeite({ withToken: true, init: [ohneTeilen] }, async ({ page, log }) => {
      // Datenbank in Version 1 (wie Teil 1) auf einer anderen Seite desselben Ursprungs anlegen und befüllen
      await page.goto(baseUrl + 'manifest.json');
      const h = await page.evaluate(() => { const d = new Date(), z = (n) => (n < 10 ? '0' : '') + n; return d.getFullYear() + '-' + z(d.getMonth() + 1) + '-' + z(d.getDate()); });
      const basisEintrag = { paket: paket(), quelle: 'import', sha: null, uebernommen: '2026-01-01T00:00:00.000Z' };
      const onlineEintrag = { sha: SHA_B, version: h + '.3', stand: h, geprueft: '2026-01-01T00:00:00.000Z' };
      mock.sha = SHA_B;
      mock.datei = JSON.stringify(paket({ version: h + '.3', stand: h }));
      const angelegt = await page.evaluate(([b, o]) => new Promise((resolve, reject) => {
        const r = indexedDB.open('aether-flyer', 1);
        r.onupgradeneeded = () => { r.result.createObjectStore('basis'); r.result.createObjectStore('online'); };
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result;
          const tx = db.transaction(['basis', 'online'], 'readwrite');
          tx.objectStore('basis').put(b, 'aktuell');
          tx.objectStore('online').put(o, 'stand');
          tx.oncomplete = () => { const v = db.version, st = [...db.objectStoreNames].sort(); db.close(); resolve({ v, st }); };
          tx.onerror = () => reject(tx.error);
        };
      }), [basisEintrag, onlineEintrag]);
      assert.deepEqual(angelegt, { v: 1, st: ['basis', 'online'] });
      // flyer.html laden → Version 3 (F3a; Teil 2 prüfte hier Version 2)
      await oeffneFlyer(page);
      await onlineFertig(page);
      assert.equal(await heute(page), h, 'heute wie auf der Seite davor');
      assert.equal(await page.$$eval('#kacheln .kachel', (ks) => ks.length), 3, 'Paket angezeigt');
      assert.equal(await text(page, '#paketInfo'), 'Platzhalter-Paket · Version 2020-02-01.1 · 3 Dokumente');
      assert.equal(await text(page, '#status'), 'offline bereit · Stand 01.02.2020');
      let st = await speicher(page);
      const db = st.idb.filter((e) => e.db === 'aether-flyer');
      assert.deepEqual(db.map((e) => e.store).sort(), ['aenderungen', 'basis', 'geraet', 'medien', 'online', 'struktur', 'werte'], 'Stores nach der Migration');
      assert.ok(db.every((e) => e.version === 5), 'Version 5 (dynamische Werte)');
      const b = db.find((e) => e.store === 'basis'), on = db.find((e) => e.store === 'online');
      assert.deepEqual([b.schluessel, b.werte], [['aktuell'], [basisEintrag]], 'basis unverändert');
      assert.deepEqual([on.schluessel, on.werte], [['stand'], [onlineEintrag]], 'online unverändert');
      assertKeinToken(st, 'nach der Migration');
      // Änderung, Export (bekannte Online-Fassung <heute>.3 aus dem Store zählt mit), Sicherung: nirgends das Token
      await setze(page, 'T1', 'text', 't1', 'Platzhalter nach Migration');
      const e = await exportDownload(page);
      assert.equal(e.paket.version, h + '.4', 'Online-Fassung aus dem Store online zählt mit');
      assert.ok(!e.inhalt.includes(TOKEN) && !e.inhalt.includes('github_pat_'), 'kein Token im Export');
      const s = await sichernDownload(page);
      assert.ok(!s.inhalt.includes(TOKEN) && !s.inhalt.includes('github_pat_'), 'kein Token in der Sicherung');
      st = await speicher(page);
      assertKeinToken(st, 'nach Export und Sicherung');
      const ae = st.idb.find((x) => x.db === 'aether-flyer' && x.store === 'aenderungen');
      assert.ok(ae.schluessel.includes('meta'));
      assert.ok(ae.werte.some((w) => w.neu === 'Platzhalter nach Migration'));
      const b2 = st.idb.find((x) => x.db === 'aether-flyer' && x.store === 'basis');
      assert.deepEqual(b2.werte, [basisEintrag], 'Basis bleibt unverändert (Änderungen liegen nur in der Schicht)');
      assert.ok(!log.urls.some((u) => u.includes(TOKEN)), 'Token nie in einer Adresse');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });
});

describe('Flyer Teil 2: Befunde der Prüfung', () => {
  test('Hilfe „Online stellen“ zeigt die zuletzt exportierte Fassung auch nach dem Neuladen (Kopieren aktiv)', async () => {
    await mitSeite({ init: [ohneTeilen] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      await setze(page, 'T1', 'text', 't1', 'Platzhalter geändert');
      const ex = await exportDownload(page);
      await page.reload();
      await oeffneFlyer(page, null);
      await page.waitForFunction((f) => document.getElementById('hilfeFassung').textContent === f, ex.paket.version);
      assert.equal(await text(page, '#hilfeCommit'), `Flyer-Paket ${ex.paket.version} [skip ci]`);
      assert.equal(await page.$eval('#hilfeKopieren', (b) => b.disabled), false);
      assert.deepEqual(log.errors, []);
    });
  });

  test('Teilen scheitert (NotAllowedError) → Dialog mit Link statt Download ohne Geste; exportiert erst nach Antippen des Links; Blob-URL beim Schließen per Esc frei', async () => {
    const teilenScheitert = () => {
      navigator.canShare = () => true;
      navigator.share = () => Promise.reject(new DOMException('Test: keine Aktivierung', 'NotAllowedError'));
    };
    await mitSeite({ init: [teilenScheitert, urlsMitschneiden] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      await setze(page, 'T1', 'text', 't1', 'Platzhalter geändert');
      await page.click('#btnExport');
      await page.waitForFunction(() => !document.getElementById('modal').hidden);
      const dl = await page.evaluate(() => window.__urls.links.length);
      assert.equal(dl, 0, 'kein Download ohne Geste');
      assert.match(await text(page, '#status'), /1 Änderung nicht exportiert/, 'noch nicht als exportiert markiert');
      const link = await page.$eval('#mInhalt a', (a) => [a.textContent, a.getAttribute('download'), a.href.startsWith('blob:')]);
      assert.deepEqual(link, ['aether-flyer-paket.json', 'aether-flyer-paket.json', true]);
      const url = await page.$eval('#mInhalt a', (a) => a.href);
      await page.keyboard.press('Escape');
      await page.waitForFunction(() => document.getElementById('modal').hidden);
      await page.waitForFunction((u) => window.__urls.frei.includes(u), url);
      assert.match(await text(page, '#status'), /1 Änderung nicht exportiert/);
      assert.deepEqual(log.errors, []);
    });
  });

  test('Einspielen: Datei über 5 MB (auch in Bytes mit Mehrbyte-Zeichen) wird abgelehnt, nichts ändert sich', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      await setze(page, 'T1', 'text', 't1', 'Platzhalter geändert');
      const vorher = await alle(page);
      // ca. 6 MB in Bytes, aber nur ca. 2 Mio. Zeichen (dreibytige Zeichen)
      const gross = JSON.stringify({ format: 'aether-flyer-aenderungen', version: 1, eintraege: [], fuell: '€'.repeat(2 * 1024 * 1024) });
      await einspielen(page, gross);
      assert.equal(await page.$eval('#fehler b', (b) => b.textContent), 'Datei zu groß.');
      const r = await page.evaluate((t) => window.AetherFlyerAenderungen.einspielen(t).then(() => 'ok', (e) => e.title), gross);
      assert.equal(r, 'Datei zu groß.', 'auch die Byte-Grenze im Modul');
      assert.deepEqual(await alle(page), vorher);
      assert.deepEqual(log.errors, []);
    });
  });

  test('Während einer Übernahme sind Eingaben gesperrt (kein Umgehen des Abgleichs); Konflikt „dok fehlt“ behält den Titel', async () => {
    await mitSeite({}, async ({ page, log }) => {
      await oeffneFlyer(page);
      await importiere(page, paket());
      await setze(page, 'T2', 'text', 't1', 'Platzhalter meins');
      const r = await page.evaluate(() => {
        const ae = window.AetherFlyerAenderungen;
        ae.sperre(true);
        return ae.setze('T1', 'status', 's2', 'ok').then(() => 'gesetzt', (e) => e.kind).finally(() => ae.sperre(false));
      });
      assert.equal(r, 'gesperrt');
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.geaendert('T1', 'status', 's2')), false);
      // Übernahme ohne T2 → F3a (Teil E): Struktur-Konflikt mit dem Titel aus dem bisherigen Stand (Teil 2: Text-Konflikte „fehlt“)
      await uebernehme(page, paket({ version: '2020-02-02.1', stand: '2020-02-02', ohneT2: true }));
      assert.deepEqual(await konflikte(page), []);
      const k = await page.evaluate(() => window.AetherFlyer.strukturKonflikte());
      assert.deepEqual(k.map((x) => [x.objekt, x.was]), [['P|1.1|T2', 'Seite T2 · Platzhalter zwei (Version 1.1)']]);
      await page.click('#konflikteZeigen');
      assert.match(await text(page, '#konfliktListe .konflikt b'), /^Seite T2 · Platzhalter zwei/);
      assert.deepEqual(log.errors, []);
    });
  });

  test('data-t mit weiteren Markierungen darin: nur der eigene Text wird ersetzt, Markierungen bleiben, Export gelingt', async () => {
    await mitSeite({ init: [ohneTeilen] }, async ({ page, log }) => {
      await oeffneFlyer(page);
      const pk = paket();
      pk.dokumente[0].html = pk.dokumente[0].html.replace('<h1 data-t="t1">Platzhalter eins</h1>',
        '<h1 data-t="t1">Platzhalter Kopf <span data-t="t9">Platzhalter innen</span></h1>');
      await importiere(page, pk);
      await setze(page, 'T1', 'text', 't1', 'Neu ');
      const h = await page.$eval('#kacheln .kachel[data-id="T1"] .flyer-host', (x) => x.shadowRoot.querySelector('h1').outerHTML);
      assert.equal(h, '<h1 data-t="t1">Neu <span data-t="t9">Platzhalter innen</span></h1>');
      const ex = await exportDownload(page);
      assert.match(ex.paket.dokumente[0].html, /<h1 data-t="t1">Neu <span data-t="t9">Platzhalter innen<\/span><\/h1>/);   // Seite der Version 1.1 (wieV1)
      assert.deepEqual(log.errors, []);
    });
  });
});
