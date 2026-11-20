// Tests für das Bearbeiten auf der Seite „Flyer & Infografiken“ (Teil 2: flyer-aenderungen.js, flyer-bearbeiten.js,
// dazu flyer-ansicht.js, flyer-export.js, flyer-speicher.js, flyer.js) mit eigenem Mini-Paket nur aus Platzhaltern:
// Umschalter Ansehen | Text | Status im Vollbild, Text ändern (Kachel, Vollbild, Druck, Bild, nach dem Neuladen,
// offline aus der App-Hülle, Basis unverändert), Text bleibt Text (kein HTML), Zeilenumbrüche, Tasten im Feld
// (Backspace, Esc, ←/→, Cmd/Strg+Enter), „Original“, leerer Text, Status je Stellung samt Zählern und Balken-Variablen,
// Stand-Datum, Kopfzeile „· n Änderungen nicht exportiert“, Markierung nur im Vollbild in Text/Status,
// „Dokument zurücksetzen“, „Text zu lang“, Tippflächen.
// Infrastruktur (statischer Server, mitSeite, Mock-API, speicher …) übernommen aus tests/flyer.test.js.
// Aufruf: node --test tests/flyer-bearbeiten.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
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
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Mini-Paket (nur Platzhalter, kein echter Flyer-Inhalt)
// ---------------------------------------------------------------------------
const VERSION = '2026-11-17.1';
const STAND = '2026-11-17';
const KOPF_BASIS = 'offline bereit · Stand 17.11.2026';
const KURZ = 'Kurzer Platzhaltertext.';
function fuelltext(n) {
  const w = ['Platzhalter', 'Beispiel', 'Mustertext', 'Lorem', 'ipsum', 'dolor', 'sit', 'amet', 'Blindtext', 'Probe'];
  return Array.from({ length: n }, (_, i) => w[i % w.length]).join(' ') + '.';
}
const SEHR_LANG = fuelltext(2400);    // läuft auch bei --s = 0.80 noch über
// Stand-Datum der Basis absichtlich weit in der Vergangenheit (nie „heute“, an welchem Tag der Test auch läuft)
const STAND_KURZ_BASIS = 'Stand 01.10.2020';
const STAND_LANG_BASIS = 'Aktualisiert 1. Oktober 2020 (Platzhalter)';
const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const standKurz = (iso) => { const [j, m, t] = iso.split('-'); return `${t}.${m}.${j}`; };
const standLang = (iso) => { const [j, m, t] = iso.split('-'); return `${Number(t)}. ${MONATE[Number(m) - 1]} ${j}`; };

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
  '.body h2{margin:0 0 8px;font-size:calc(24px*var(--s))}',
  '.liste{margin:0 0 12px;padding-left:1.2em}',
  '.fill{flex:1;min-height:0;background:#2c3e50}',
  '.fill.off{display:none}',
  '.fuss{flex:none;padding-top:16px;font-size:16px}',
  '@media print{.page{break-inside:avoid}}'
].join('\n');

// Ein Flyer mit allen Markierungen: data-t (t1 ohne <br>, t2 mit <ae-t>, t3 mit <br>, t4 in der Fußzeile), Block b1
// (Zähler in <small>, drei Punkte ok/run/plan, Balken-Variablen im style-Attribut der Liste und eines Kinds der
// Überschrift), leerer Block b2 (leeres Zähler-Element), zwei Stand-Elemente (kurz, lang) mit Text drumherum.
function bearbeitenHtml(titel) {
  return '<section class="page">' +
    `<header class="kopf"><h1 data-t="t1">${titel}</h1><span data-stand="kurz">${STAND_KURZ_BASIS}</span></header>` +
    '<div class="body">' +
    `<p data-t="t2"><ae-t>${KURZ}</ae-t></p>` +
    '<p data-t="t3">A<br>B</p>' +
    '<h2 data-block="b1" data-zaehler="b1">Platzhalter-Block <small>1 von 3 fertig</small>' +
      '<i class="balken" style="display:block;height:4px;--anteil:0.3333;--anteil-laeuft:0.3333"></i></h2>' +
    '<ul class="liste" data-block="b1" style="--anteil:0.3333;--anteil-laeuft:0.3333">' +
      '<li data-s="s1" data-status="ok">Platzhalter-Punkt eins</li>' +
      '<li data-s="s2" data-status="run">Platzhalter-Punkt zwei</li>' +
      '<li data-s="s3" data-status="plan">Platzhalter-Punkt drei</li></ul>' +
    '<p class="leerblock" data-block="b2">Platzhalter ohne Punkte: <span data-zaehler="b2"></span></p>' +
    '<div class="fill"></div></div>' +
    `<footer class="fuss"><span data-t="t4">Platzhalter-Fußzeile</span> · <span data-stand="lang">${STAND_LANG_BASIS}</span></footer>` +
    '</section>';
}
function bearbeitenPaket(opts = {}) {
  const { version = VERSION, stand = STAND } = opts;
  return {
    format: 'aether-flyer-paket',
    formatVersion: 1,
    titel: 'Platzhalter-Paket',
    version,
    stand,
    css: { flyer: FLYER_CSS, infografik: '' },
    kategorien: [{ id: 'info', name: 'Platzhalter Info' }],
    dokumente: [
      { id: 'F1', art: 'flyer', kategorie: 'info', titel: 'Platzhalter eins', breite: 794, hoehe: 1123, html: bearbeitenHtml('Platzhalter Titel') },
      { id: 'F2', art: 'flyer', kategorie: 'info', titel: 'Platzhalter zwei', breite: 794, hoehe: 1123, html: bearbeitenHtml('Platzhalter Titel zwei') }
    ]
  };
}

// ---------------------------------------------------------------------------
// Statischer Server (kann „kein Netz“ spielen) und Mock-API (wie tests/flyer.test.js)
// ---------------------------------------------------------------------------
const net = { offline: false };
const mock = {};
function mockZurueck() {
  Object.assign(mock, { modus: 'ok', sha: SHA_A, datei: JSON.stringify(bearbeitenPaket()), requests: [] });
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
async function antwort(route, url, headers) {
  const json = (status, obj) => route.fulfill({ status, headers: CORS, contentType: 'application/json', body: JSON.stringify(obj) });
  if (headers.authorization !== `Bearer ${TOKEN}` || mock.modus === 'auth') return json(401, { message: 'Bad credentials' });
  const ref = url.searchParams.get('ref');
  if (url.pathname === ORDNER && ref === 'main') {
    if (mock.modus === '404') return json(404, { message: 'Not Found' });
    return json(200, [{ name: 'aether-flyer-paket.json', path: 'docs/flyer/aether-flyer-paket.json', sha: mock.sha, type: 'file' }]);
  }
  if (url.pathname === DATEI && ref === 'main') {
    if (mock.modus === '404') return json(404, { message: 'Not Found' });
    if (headers.accept === RAW) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': `${RAW}; charset=utf-8` }, body: mock.datei });
    return json(200, { name: 'aether-flyer-paket.json', sha: mock.sha, encoding: 'base64', content: Buffer.from(mock.datei).toString('base64') });
  }
  if (url.pathname.startsWith(BLOBS)) {
    const sha = url.pathname.slice(BLOBS.length);
    if (sha !== mock.sha || mock.modus === '404') return json(404, { message: 'Not Found' });
    if (headers.accept === RAW) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': `${RAW}; charset=utf-8` }, body: mock.datei });
    return json(200, { sha, encoding: 'base64', content: Buffer.from(mock.datei).toString('base64') });
  }
  if (url.pathname === `${BASE}/contents/index.json`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': RAW }, body: '[]' });
  return json(404, { message: 'Not Found' });
}
async function githubApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  mock.requests.push({ method: req.method(), path: url.pathname });
  if (mock.modus === 'offline') return route.abort('internetdisconnected').catch(() => {});
  try { await antwort(route, url, headers); } catch (e) { /* Kontext schon geschlossen */ }
}

// window.print gestubbt: zählt Aufrufe
function druckStub() { window.__druck = 0; window.print = () => { window.__druck++; }; }
// Bild: jede Serialisierung des vorbereiteten Klons (div.ae-wurzel → SVG/foreignObject) mitschneiden
function bildMitschnitt() {
  window.__bild = [];
  const orig = XMLSerializer.prototype.serializeToString;
  XMLSerializer.prototype.serializeToString = function (n) {
    const s = orig.call(this, n);
    try { if (n && n.nodeType === 1 && n.getAttribute('class') === 'ae-wurzel') window.__bild.push(s); } catch (e) { /* egal */ }
    return s;
  };
}

// Neue Seite in eigenem Kontext; der Kontext wird immer geschlossen (auch wenn ein Test scheitert).
async function mitSeite(opts, fn) {
  const { viewport = { width: 1194, height: 834 }, withToken = true, init = [], hasTouch = false } = opts;
  net.offline = false;
  mockZurueck();
  const context = await browser.newContext({ viewport, hasTouch, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  try {
    const page = await context.newPage();
    const log = { urls: [], errors: [], fremd: [], dialoge: [] };
    page.on('pageerror', (e) => log.errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
    // Unerwartete Dialoge (confirm/alert) nie hängen lassen: protokollieren und ablehnen
    page.on('dialog', (d) => { if (!page.__dialogErwartet) { log.dialoge.push(d.message()); d.dismiss().catch(() => {}); } });
    context.on('request', (r) => log.urls.push(r.url()));
    await context.addInitScript(() => { window.AETHER_TEST_PROJECT_TIMEOUT_MS = 3000; window.AETHER_TEST_KARTEN_OFFEN = true; });
    if (withToken) await context.addInitScript((t) => { if (window === window.top) localStorage.setItem('aether.githubToken', t); }, TOKEN);
    for (const i of init) await context.addInitScript(i);
    await context.route('https://api.github.com/**', githubApi);
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
const ohne = (errors, re) => errors.filter((e) => !re.test(e));
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
async function ruhe(page) {
  await page.evaluate(async () => {
    await window.AetherFlyerAnsicht.schriftenBereit();
    await window.AetherFlyerAenderungen.fertig();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
}
async function speicher(page) {
  return page.evaluate(async (token) => {
    const ls = Object.keys(localStorage).map((k) => [k, localStorage.getItem(k)]);
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
    return { ls, idb, token: idb.some((e) => e.json.includes(token) || e.json.includes('github_pat_')) };
  }, TOKEN);
}
// Einträge der Änderungsschicht aus IndexedDB (ohne Meta-Eintrag), sortiert
async function idbEintraege(page) {
  const st = await speicher(page);
  const s = st.idb.find((e) => e.db === 'aether-flyer' && e.store === 'aenderungen');
  assert.ok(s, 'Store aenderungen in IndexedDB aether-flyer');
  assert.equal(s.version, 3, 'IndexedDB aether-flyer Version 3 (F3a)');
  return s.werte.filter((w) => w && typeof w.dok === 'string')
    .map((w) => ({ dok: w.dok, k: w.k, art: w.art, alt: w.alt, neu: w.neu, exportiert: w.exportiert }))
    .sort((a, b) => (a.dok + a.art + a.k).localeCompare(b.dok + b.art + b.k));
}
async function idbBasis(page) {
  const st = await speicher(page);
  const s = st.idb.find((e) => e.db === 'aether-flyer' && e.store === 'basis');
  assert.ok(s && s.werte.length === 1, 'genau eine Basis in IndexedDB');
  return s.werte[0].paket;
}
const alle = (page) => page.evaluate(() => window.AetherFlyerAenderungen.alle()
  .map((e) => ({ dok: e.dok, k: e.k, art: e.art, alt: e.alt, neu: e.neu, exportiert: e.exportiert }))
  .sort((a, b) => (a.dok + a.art + a.k).localeCompare(b.dok + b.art + b.k)));

const KACHEL_HOST = (id) => `#kacheln .kachel[data-id="${id}"] .flyer-host`;
const VB_HOST = '#vbBuehne .flyer-host';
const DRUCK_HOST = (id) => `#druck .druck-seite[data-id="${id}"] .flyer-host`;
const vbDok = (page) => page.locator(VB_HOST);
const vollbildOffen = (page) => page.$eval('#vollbild', (v) => !v.hidden && getComputedStyle(v).display !== 'none');
const zaehlerVb = (page) => text(page, '#vbZaehler');
const modusJetzt = (page) => page.$$eval('#vbModus button[data-modus]', (bs) => bs.map((b) => [b.dataset.modus, b.getAttribute('aria-pressed')]));
// Alles Prüfbare eines dargestellten Dokuments (Shadow Root eines Darstellungs-Hosts)
const dokInfo = (page, hostSel) => page.$eval(hostSel, (h) => {
  const r = h.shadowRoot;
  const v = (e, n) => e.style.getPropertyValue(n).trim();
  const o = { id: h.dataset.id, t: {}, s: {}, z: {}, bloecke: {}, stand: [], marken: [], img: r.querySelectorAll('img').length, script: r.querySelectorAll('script').length };
  for (const e of r.querySelectorAll('[data-t]')) o.t[e.dataset.t] = { text: e.textContent, html: e.innerHTML, br: e.querySelectorAll('br').length, mark: e.hasAttribute('data-ae-geaendert') };
  for (const e of r.querySelectorAll('[data-s]')) o.s[e.dataset.s] = { status: e.getAttribute('data-status'), mark: e.hasAttribute('data-ae-geaendert') };
  for (const e of r.querySelectorAll('[data-zaehler]')) o.z[e.dataset.zaehler] = { text: e.textContent.replace(/\s+/g, ' ').trim(), anteil: v(e, '--anteil'), laeuft: v(e, '--anteil-laeuft') };
  for (const e of r.querySelectorAll('[data-block]')) {
    const b = e.dataset.block;
    (o.bloecke[b] = o.bloecke[b] || []).push([v(e, '--anteil'), v(e, '--anteil-laeuft')]);
    for (const d of e.querySelectorAll('[style]')) if (d.getAttribute('style').includes('--anteil')) o.bloecke[b].push([v(d, '--anteil'), v(d, '--anteil-laeuft')]);
  }
  for (const e of r.querySelectorAll('[data-stand]')) o.stand.push(e.textContent);
  for (const e of r.querySelectorAll('[data-ae-geaendert]')) o.marken.push(e.getAttribute('data-t') || (e.getAttribute('data-s') ? 's:' + e.getAttribute('data-s') : 'stand:' + e.getAttribute('data-stand')));
  return o;
});
async function oeffneVollbild(page, id) {
  await page.click(`#kacheln .kachel[data-id="${id}"]`);
  await page.waitForFunction((id) => {
    const h = document.querySelector('#vbBuehne .flyer-host');
    return h && h.dataset.id === id && !document.getElementById('vollbild').hidden;
  }, id);
  await ruhe(page);
}
async function setzeModus(page, m) {
  await page.click(`#vbModus button[data-modus="${m}"]`);
  await page.waitForFunction((m) => window.AetherFlyerBearbeiten.modus() === m, m);
  await ruhe(page);
}
// Wartet, bis im Host hostSel die Bedingung über dokInfo gilt (Darstellungen sind asynchron)
async function warteBis(page, hostSel, fn, was) {
  const ende = Date.now() + 10000;
  let letzte = null;
  for (;;) {
    try { letzte = await dokInfo(page, hostSel); if (fn(letzte)) return letzte; } catch (e) { letzte = String(e); }
    if (Date.now() > ende) throw new Error(`Zeitlimit: ${was} – zuletzt ${JSON.stringify(letzte)}`);
    await page.waitForTimeout(30);
  }
}
// Text über die Oberfläche ändern: (Modus Text muss aktiv sein) Klick auf data-t, Feld füllen, „Übernehmen“
async function textAendern(page, k, wert) {
  await vbDok(page).locator(`[data-t="${k}"]`).click();
  await page.waitForSelector('#vbEdit:not([hidden])');
  await page.fill('#vbEditFeld', wert);
  await page.click('#vbEditOk');
  await page.waitForSelector('#vbEdit', { state: 'hidden' });
  await ruhe(page);
}
// Status über die Oberfläche setzen: (Modus Status muss aktiv sein) Klick auf data-s, Knopf data-status
async function statusSetzen(page, k, wert) {
  await vbDok(page).locator(`[data-s="${k}"]`).click();
  await page.waitForSelector('#vbStatus:not([hidden])');
  await page.click(`#vbStatus button[data-status="${wert}"]`);
  await page.waitForSelector('#vbStatus', { state: 'hidden' });
  await ruhe(page);
}
// Offenes Dokument drucken (#vbPdf, window.print gestubbt) → Info der Druckseite
async function druckInfo(page, id) {
  const vorher = await page.evaluate(() => window.__druck);
  await page.click('#vbPdf');
  await page.waitForFunction((n) => window.__druck === n + 1, vorher);
  await page.evaluate(async () => { await window.AetherFlyerAnsicht.schriftenBereit(); });
  assert.deepEqual(await page.$$eval('#druck .druck-seite', (ss) => ss.map((s) => s.dataset.id)), [id], 'genau das offene Dokument in #druck');
  return dokInfo(page, DRUCK_HOST(id));
}
const groesse = (page, sel) => page.$$eval(sel, (bs) => bs.filter((b) => b.offsetParent !== null || getComputedStyle(b).display !== 'none')
  .map((b) => { const r = b.getBoundingClientRect(); return { name: b.id || b.dataset.modus || ('status:' + b.dataset.status), w: r.width, h: r.height }; }));
function assertTippflaechen(liste, label) {
  assert.ok(liste.length > 0, `${label}: Knöpfe gefunden`);
  for (const b of liste) assert.ok(b.w >= 44 && b.h >= 44, `${label}: ${b.name} mindestens 44 × 44 px (ist ${b.w} × ${b.h})`);
}
async function seiteMitPaket(page) {
  await oeffneFlyer(page);
  await importiere(page, bearbeitenPaket());
  await ruhe(page);
  assert.equal(await text(page, '#status'), KOPF_BASIS);
}

// Erwartete Werte des unveränderten Dokuments
const BASIS_Z = { b1: { text: 'Platzhalter-Block 1 von 3 fertig', anteil: '0.3333', laeuft: '0.3333' }, b2: { text: '0 von 0 fertig', anteil: '0', laeuft: '0' } };

// ---------------------------------------------------------------------------
describe('Flyer bearbeiten: Umschalter und Bedienung', () => {
  test('Umschalter: Standard „Ansehen“; in Ansehen öffnet ein Klick keine Leiste, Tasten und Wischen blättern; Leisten in Text/Status; Schließen → Ansehen; Tippflächen ≥ 44 px', async () => {
    await mitSeite({ withToken: false, hasTouch: true }, async ({ page, log }) => {
      await seiteMitPaket(page);
      await oeffneVollbild(page, 'F1');
      assert.ok(await page.isVisible('#vbModus'), 'Umschalter im Vollbild sichtbar');
      assert.deepEqual(await modusJetzt(page), [['ansehen', 'true'], ['text', 'false'], ['status', 'false']]);
      assert.equal(await page.evaluate(() => window.AetherFlyerBearbeiten.modus()), 'ansehen');
      assert.equal(await page.$eval('#vbModus', (m) => m.getAttribute('role')), 'group');
      assertTippflaechen(await groesse(page, '#vbModus button'), 'Umschalter');
      assert.ok(await page.isHidden('#vbReset'), 'ohne Änderungen kein „Dokument zurücksetzen“');

      // Ansehen: Klick auf Text/Status öffnet nichts
      await vbDok(page).locator('[data-t="t1"]').click();
      await vbDok(page).locator('[data-s="s1"]').click();
      await page.waitForTimeout(150);
      assert.ok(await page.isHidden('#vbEdit'), 'Ansehen: keine Text-Leiste');
      assert.ok(await page.isHidden('#vbStatus'), 'Ansehen: keine Status-Auswahl');
      // Tasten und Wischen blättern wie in Teil 1
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehlerVb(page), '2 / 2');
      await page.keyboard.press('ArrowLeft');
      assert.equal(await zaehlerVb(page), '1 / 2');
      const wische = (dx) => page.evaluate((dx) => {
        const el = document.getElementById('vbBuehne');
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2, y = r.top + Math.min(r.height / 2, 200);
        const t0 = new Touch({ identifier: 1, target: el, clientX: x, clientY: y });
        el.dispatchEvent(new TouchEvent('touchstart', { touches: [t0], targetTouches: [t0], changedTouches: [t0], bubbles: true, cancelable: true }));
        const t1 = new Touch({ identifier: 1, target: el, clientX: x + dx, clientY: y });
        el.dispatchEvent(new TouchEvent('touchend', { touches: [], targetTouches: [], changedTouches: [t1], bubbles: true, cancelable: true }));
      }, dx);
      await wische(-200);
      assert.equal(await zaehlerVb(page), '2 / 2', 'nach links wischen = nächstes');
      await wische(200);
      assert.equal(await zaehlerVb(page), '1 / 2', 'nach rechts wischen = voriges');
      await ruhe(page);

      // Text: Klick auf data-t öffnet die Leiste mit vorbelegtem Feld
      await setzeModus(page, 'text');
      assert.deepEqual(await modusJetzt(page), [['ansehen', 'false'], ['text', 'true'], ['status', 'false']]);
      await vbDok(page).locator('[data-t="t1"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      assert.equal(await page.inputValue('#vbEditFeld'), 'Platzhalter Titel');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'vbEditFeld', 'Feld hat den Fokus');
      assert.deepEqual(await page.$$eval('#vbEdit button', (bs) => bs.map((b) => [b.id, b.textContent.trim()])),
        [['vbEditOk', 'Übernehmen'], ['vbEditAb', 'Abbrechen'], ['vbEditOrig', 'Original']]);
      assert.ok(await page.isDisabled('#vbEditOrig'), '„Original“ ohne Änderung nicht wählbar');
      assertTippflaechen(await groesse(page, '#vbEdit button'), 'Text-Leiste');
      assert.ok(await page.isHidden('#vbStatus'));
      // Klick auf einen Status-Punkt im Modus Text öffnet keine Status-Auswahl
      await page.click('#vbEditAb');
      await page.waitForSelector('#vbEdit', { state: 'hidden' });
      await vbDok(page).locator('[data-s="s1"]').click();
      await page.waitForTimeout(150);
      assert.ok(await page.isHidden('#vbStatus') && await page.isHidden('#vbEdit'), 'Modus Text: Status-Punkt öffnet nichts');

      // Status: Klick auf data-s öffnet die Auswahl
      await setzeModus(page, 'status');
      assert.deepEqual(await modusJetzt(page), [['ansehen', 'false'], ['text', 'false'], ['status', 'true']]);
      await vbDok(page).locator('[data-s="s3"]').click();
      await page.waitForSelector('#vbStatus:not([hidden])');
      assert.deepEqual(await page.$$eval('#vbStatus button', (bs) => bs.map((b) => [b.id || 'status:' + b.dataset.status, b.getAttribute('aria-pressed')])),
        [['status:ok', 'false'], ['status:run', 'false'], ['status:next', 'false'], ['status:plan', 'true'], ['status:', 'false'], ['vbStatusAb', null]]);
      assertTippflaechen(await groesse(page, '#vbStatus button'), 'Status-Auswahl');
      assert.ok(await page.isHidden('#vbEdit'));
      // Esc bei offener Auswahl (Fokus auf einem Knopf): nur die Auswahl zu, Vollbild bleibt
      await page.keyboard.press('Escape');
      await page.waitForSelector('#vbStatus', { state: 'hidden' });
      assert.equal(await vollbildOffen(page), true, 'Esc schließt nur die Auswahl');
      // Abbrechen
      await vbDok(page).locator('[data-s="s3"]').click();
      await page.waitForSelector('#vbStatus:not([hidden])');
      await page.click('#vbStatusAb');
      await page.waitForSelector('#vbStatus', { state: 'hidden' });
      assert.deepEqual(await alle(page), [], 'Abbrechen ändert nichts');
      // Modus Status: Text-Stelle öffnet nichts
      await vbDok(page).locator('[data-t="t1"]').click();
      await page.waitForTimeout(150);
      assert.ok(await page.isHidden('#vbEdit') && await page.isHidden('#vbStatus'), 'Modus Status: Text-Stelle öffnet nichts');

      // Schließen (✕) → beim nächsten Öffnen wieder Ansehen
      await page.click('#vbZu');
      assert.equal(await vollbildOffen(page), false);
      assert.equal(await page.evaluate(() => window.AetherFlyerBearbeiten.modus()), 'ansehen');
      await oeffneVollbild(page, 'F2');
      assert.deepEqual(await modusJetzt(page), [['ansehen', 'true'], ['text', 'false'], ['status', 'false']]);
      // Schließen per Esc aus dem Modus Text → wieder Ansehen
      await setzeModus(page, 'text');
      await page.locator('#vbBuehne').focus();
      await page.keyboard.press('Escape');
      assert.equal(await vollbildOffen(page), false);
      await oeffneVollbild(page, 'F1');
      assert.deepEqual(await modusJetzt(page), [['ansehen', 'true'], ['text', 'false'], ['status', 'false']]);

      // Tippflächen auch auf dem Telefon (375 px)
      await page.setViewportSize({ width: 375, height: 740 });
      await ruhe(page);
      assertTippflaechen(await groesse(page, '#vbModus button'), 'Umschalter (375 px)');
      await setzeModus(page, 'text');
      await vbDok(page).locator('[data-t="t2"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      assertTippflaechen(await groesse(page, '#vbEdit button'), 'Text-Leiste (375 px)');
      const feld = await page.$eval('#vbEditFeld', (f) => f.getBoundingClientRect().height);
      assert.ok(feld >= 44, `Textfeld mindestens 44 px hoch (ist ${feld})`);
      await page.click('#vbEditAb');
      await setzeModus(page, 'status');
      await vbDok(page).locator('[data-s="s1"]').click();
      await page.waitForSelector('#vbStatus:not([hidden])');
      assertTippflaechen(await groesse(page, '#vbStatus button'), 'Status-Auswahl (375 px)');
      await page.click('#vbStatus button[data-status="next"]');
      await page.waitForSelector('#vbStatus', { state: 'hidden' });
      await ruhe(page);
      assert.ok(await page.isVisible('#vbReset'), 'mit Änderung: „Dokument zurücksetzen“ sichtbar');
      assertTippflaechen(await groesse(page, '#vbReset'), '„Dokument zurücksetzen“ (375 px)');
      const breit = await page.evaluate(() => document.documentElement.scrollWidth);
      assert.ok(breit <= 375, `kein waagerechter Bildlauf (${breit})`);
      await page.screenshot({ path: path.join(OUT, 'flyer-bearbeiten-375.png') });
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.dialoge, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('a) Text ändern: Kachel, Vollbild, Druck und Bild zeigen den neuen Text; bleibt nach dem Neuladen und offline; Basis in IndexedDB unverändert', async () => {
    await mitSeite({ init: [druckStub, bildMitschnitt] }, async ({ context, page, log }) => {
      // App-Hülle (Service Worker) über das Dashboard
      mock.modus = '404';
      await page.goto(baseUrl);
      const swReady = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]));
      assert.ok(swReady, 'Service Worker aktiv');
      await oeffneFlyer(page);
      assert.ok(await page.evaluate(() => !!navigator.serviceWorker.controller), 'Seite läuft unter dem Service Worker');
      await onlineFertig(page);
      const paket = bearbeitenPaket();
      await importiere(page, paket);
      await ruhe(page);
      const basisVorher = await idbBasis(page);
      assert.deepEqual(basisVorher.dokumente.map((d) => d.html), paket.dokumente.map((d) => d.html));

      await oeffneVollbild(page, 'F1');
      // Bild ist für das offene Dokument vorbereitet (Basis-Text)
      await page.waitForFunction(() => window.__bild.some((s) => s.includes('Kurzer Platzhaltertext.')));
      await setzeModus(page, 'text');
      await vbDok(page).locator('[data-t="t2"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      assert.equal(await page.inputValue('#vbEditFeld'), KURZ, 'Feld mit dem aktuellen Text vorbelegt');
      const NEU = 'Neuer Platzhaltertext eins';
      await page.fill('#vbEditFeld', NEU);
      const bildVorher = await page.evaluate(() => window.__bild.length);
      await page.click('#vbEditOk');
      await page.waitForSelector('#vbEdit', { state: 'hidden' });
      assert.equal(await vollbildOffen(page), true);
      // Vollbild
      const vb = await warteBis(page, VB_HOST, (i) => i.t.t2.text === NEU, 'Vollbild zeigt den neuen Text');
      assert.equal(vb.t.t2.html, `<ae-t>${NEU}</ae-t>`, 'Text im Textstück <ae-t>, sonst nichts');
      assert.equal(vb.t.t1.text, 'Platzhalter Titel', 'andere Stellen unverändert');
      // Kachel
      const ka = await warteBis(page, KACHEL_HOST('F1'), (i) => i.t.t2.text === NEU, 'Kachel zeigt den neuen Text');
      assert.equal(ka.t.t2.html, `<ae-t>${NEU}</ae-t>`);
      assert.deepEqual(ka.marken, [], 'Kachel ohne Markierung');
      assert.equal((await dokInfo(page, KACHEL_HOST('F2'))).t.t2.text, KURZ, 'anderes Dokument unverändert');
      // Bild: neu vorbereiteter Klon mit dem neuen Text, ohne Markierung
      await page.waitForFunction(([n, t]) => window.__bild.slice(n).some((s) => s.includes(t)), [bildVorher, NEU]);
      const bild = await page.evaluate(([n, t]) => window.__bild.slice(n).filter((s) => s.includes(t)).pop(), [bildVorher, NEU]);
      assert.ok(!bild.includes(KURZ), 'Bild ohne den alten Text');
      assert.ok(!bild.includes('data-ae-geaendert'), 'Bild ohne Markierung');
      assert.ok(!/text-decoration[^;"]*dashed/.test(bild), 'Bild ohne gestrichelte Unterlinie');
      await page.waitForSelector('#vbBild:not([hidden])');
      // Druck (PDF-Knopf, window.print gestubbt)
      const dr = await druckInfo(page, 'F1');
      assert.equal(dr.t.t2.text, NEU, 'Druck zeigt den neuen Text');
      assert.deepEqual(dr.marken, [], 'Druck ohne Markierung');
      // Gespeichert: Eintrag in der Änderungsschicht, Basis unverändert
      const heute = await page.evaluate(() => window.AetherFlyerAenderungen.heute());
      const erwartet = [
        { dok: 'F1', k: 'stand1', art: 'stand', alt: STAND_KURZ_BASIS, neu: 'Stand ' + standKurz(heute), exportiert: null },
        { dok: 'F1', k: 'stand2', art: 'stand', alt: STAND_LANG_BASIS, neu: `Aktualisiert ${standLang(heute)} (Platzhalter)`, exportiert: null },
        { dok: 'F1', k: 't2', art: 'text', alt: KURZ, neu: NEU, exportiert: null }
      ];
      assert.deepEqual(await idbEintraege(page), erwartet);
      const basisNachher = await idbBasis(page);
      assert.deepEqual(basisNachher, basisVorher, 'Basis in IndexedDB unverändert');
      assert.equal(basisNachher.dokumente[0].html, paket.dokumente[0].html);
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().dokumente[0].html), paket.dokumente[0].html, 'Basis im Speicher unverändert');
      assert.ok(!(await speicher(page)).token, 'kein Token in IndexedDB');

      // Neu laden
      await page.reload();
      await oeffneFlyer(page, null);
      await ruhe(page);
      assert.equal((await dokInfo(page, KACHEL_HOST('F1'))).t.t2.text, NEU, 'nach dem Neuladen: Kachel');
      assert.equal(await page.evaluate(() => window.AetherFlyerBearbeiten.modus()), 'ansehen');
      await oeffneVollbild(page, 'F1');
      const vb2 = await dokInfo(page, VB_HOST);
      assert.equal(vb2.t.t2.text, NEU, 'nach dem Neuladen: Vollbild');
      assert.deepEqual(vb2.marken, [], 'Ansehen ohne Markierung');
      await page.keyboard.press('Escape');

      // Offline aus der App-Hülle
      net.offline = true; mock.modus = 'offline';
      await context.setOffline(true);
      await page.reload();
      await oeffneFlyer(page, null);
      await ruhe(page);
      assert.match(await text(page, '#status'), /^offline bereit · Stand 17\.11\.2026 · 1 Änderung nicht exportiert$/);
      assert.equal((await dokInfo(page, KACHEL_HOST('F1'))).t.t2.text, NEU, 'offline: Kachel');
      await oeffneVollbild(page, 'F1');
      assert.equal((await dokInfo(page, VB_HOST)).t.t2.text, NEU, 'offline: Vollbild');
      assert.deepEqual(await idbEintraege(page), erwartet, 'offline: Änderungsschicht');
      assert.deepEqual(await idbBasis(page), basisVorher, 'offline: Basis unverändert');
      net.offline = false;
      await context.setOffline(false);
      await page.screenshot({ path: path.join(OUT, 'flyer-bearbeiten-text.png') });
      assert.deepEqual(ohne(log.errors, /ERR_INTERNET_DISCONNECTED|Failed to load resource/), []);
      assert.deepEqual(log.dialoge, []);
      assert.deepEqual(log.fremd, []);
    });
  });

  test('b) Eingabe bleibt Text (kein img/script, nichts ausgeführt); Zeilenumbruch → Leerzeichen bzw. <br>, wenn die Basis <br> hat', async () => {
    await mitSeite({ withToken: false, init: [druckStub] }, async ({ page, log }) => {
      await seiteMitPaket(page);
      await oeffneVollbild(page, 'F1');
      await setzeModus(page, 'text');
      const IMG = '<img src=x onerror=window.__pwned=1>';
      const SCRIPT = '<script>window.__pwned=2</script>';
      for (const [k, wert] of [['t2', IMG], ['t1', SCRIPT]]) {
        await textAendern(page, k, wert);
        for (const sel of [VB_HOST, KACHEL_HOST('F1')]) {
          const i = await warteBis(page, sel, (i) => i.t[k].text === wert, `${sel}: ${k} als Text`);
          assert.equal(i.img, 0, `${sel}: kein img-Element`);
          assert.equal(i.script, 0, `${sel}: kein script-Element`);
          assert.equal(i.t[k].html.includes('<img') || i.t[k].html.includes('<script'), false, `${sel}: kein Markup in ${k}`);
        }
      }
      // Auch im Druck nur Text
      const dr = await druckInfo(page, 'F1');
      assert.equal(dr.t.t2.text, IMG);
      assert.equal(dr.t.t1.text, SCRIPT);
      assert.equal(dr.img + dr.script, 0, 'Druck: kein img/script');
      await page.waitForTimeout(200);
      assert.equal(await page.evaluate(() => typeof window.__pwned), 'undefined', 'nichts ausgeführt');
      assert.equal(await page.evaluate(() => document.querySelectorAll('img[src="x"], script:not([src])').length), 0, 'nichts in der Seite');
      // Feld zeigt den gespeicherten Text wörtlich
      await vbDok(page).locator('[data-t="t2"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      assert.equal(await page.inputValue('#vbEditFeld'), IMG);
      assert.equal(await page.$eval('#vbEditLabel', (l) => l.textContent.includes('geändert')), true, 'Leiste nennt die Stelle geändert');
      await page.click('#vbEditAb');

      // Zeilenumbruch: t1 (Basis ohne <br>) → Leerzeichen
      await textAendern(page, 't1', 'Zeile eins\nZeile zwei');
      let vb = await warteBis(page, VB_HOST, (i) => i.t.t1.text === 'Zeile eins Zeile zwei', 't1 mit Leerzeichen');
      assert.equal(vb.t.t1.br, 0, 't1: kein <br>');
      assert.equal(vb.t.t1.html, 'Zeile eins Zeile zwei');
      // t3 (Basis mit <br>) → <br>
      await vbDok(page).locator('[data-t="t3"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      assert.equal(await page.inputValue('#vbEditFeld'), 'A\nB', 'Feld: <br> der Basis als Zeilenumbruch');
      await page.fill('#vbEditFeld', 'X\nY\nZ');
      await page.click('#vbEditOk');
      vb = await warteBis(page, VB_HOST, (i) => i.t.t3.html === 'X<br>Y<br>Z', 't3 mit <br>');
      assert.equal(vb.t.t3.br, 2);
      const ka = await warteBis(page, KACHEL_HOST('F1'), (i) => i.t.t3.html === 'X<br>Y<br>Z' && i.t.t1.html === 'Zeile eins Zeile zwei', 'Kachel: Umbrüche');
      assert.equal(ka.t.t1.br, 0);
      // Gespeichert wie dargestellt
      const e = (await idbEintraege(page)).filter((x) => x.art === 'text');
      assert.deepEqual(e.map((x) => [x.k, x.alt, x.neu]), [['t1', 'Platzhalter Titel', 'Zeile eins Zeile zwei'], ['t2', KURZ, IMG], ['t3', 'A\nB', 'X\nY\nZ']]);
      assert.equal(await page.evaluate(() => typeof window.__pwned), 'undefined');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.dialoge, []);
    });
  });

  test('c) Tasten im Feld: Backspace löscht nur Zeichen, Esc bricht ab, ←/→ blättern nicht, Cmd/Strg+Enter übernimmt; „Original“ setzt zurück; leerer Text erlaubt', async () => {
    await mitSeite({ withToken: false }, async ({ page, log }) => {
      await seiteMitPaket(page);
      await oeffneVollbild(page, 'F1');
      await setzeModus(page, 'text');
      assert.equal(await zaehlerVb(page), '1 / 2');
      await vbDok(page).locator('[data-t="t1"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      assert.equal(await page.evaluate(() => document.activeElement.id), 'vbEditFeld');
      // Backspace: löscht Zeichen, Vollbild und Leiste bleiben
      await page.keyboard.press('End');
      for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
      assert.equal(await page.inputValue('#vbEditFeld'), 'Platzhalter Ti');
      assert.equal(await vollbildOffen(page), true, 'Backspace schließt das Vollbild nicht');
      assert.ok(await page.isVisible('#vbEdit'), 'Backspace schließt die Leiste nicht');
      assert.equal(await zaehlerVb(page), '1 / 2');
      // ←/→ im Feld: Schreibmarke, kein Blättern
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.type('x');
      assert.equal(await page.inputValue('#vbEditFeld'), 'Platzhalter xTi', '← bewegt die Schreibmarke');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      await page.keyboard.press('ArrowRight');
      assert.equal(await zaehlerVb(page), '1 / 2', '→ im Feld blättert nicht');
      assert.equal(await page.$eval(VB_HOST, (h) => h.dataset.id), 'F1');
      // Esc: Leiste zu, Vollbild offen, nichts gespeichert
      await page.keyboard.press('Escape');
      await page.waitForSelector('#vbEdit', { state: 'hidden' });
      assert.equal(await vollbildOffen(page), true, 'Esc im Feld lässt das Vollbild offen');
      await page.waitForTimeout(150);
      assert.deepEqual(await alle(page), [], 'Esc: nichts gespeichert');
      assert.deepEqual(await idbEintraege(page), []);
      assert.equal((await dokInfo(page, VB_HOST)).t.t1.text, 'Platzhalter Titel');
      // Strg+Enter übernimmt
      await vbDok(page).locator('[data-t="t1"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      assert.equal(await page.inputValue('#vbEditFeld'), 'Platzhalter Titel', 'nach Esc wieder der alte Text');
      await page.fill('#vbEditFeld', 'Platzhalter per Strg');
      await page.keyboard.press('Control+Enter');
      await page.waitForSelector('#vbEdit', { state: 'hidden' });
      await warteBis(page, VB_HOST, (i) => i.t.t1.text === 'Platzhalter per Strg', 'Strg+Enter übernimmt');
      assert.equal(await vollbildOffen(page), true);
      // Cmd+Enter übernimmt
      await vbDok(page).locator('[data-t="t2"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      await page.fill('#vbEditFeld', 'Platzhalter per Cmd');
      await page.keyboard.press('Meta+Enter');
      await page.waitForSelector('#vbEdit', { state: 'hidden' });
      await warteBis(page, VB_HOST, (i) => i.t.t2.text === 'Platzhalter per Cmd', 'Cmd+Enter übernimmt');
      await ruhe(page);
      assert.deepEqual((await idbEintraege(page)).filter((e) => e.art === 'text').map((e) => [e.k, e.neu]), [['t1', 'Platzhalter per Strg'], ['t2', 'Platzhalter per Cmd']]);
      // Enter allein: Zeilenumbruch im Feld, nicht übernehmen
      await vbDok(page).locator('[data-t="t3"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      await page.keyboard.press('End');
      await page.keyboard.press('Enter');
      assert.ok(await page.isVisible('#vbEdit'), 'Enter allein übernimmt nicht');
      assert.equal(await page.inputValue('#vbEditFeld'), 'A\nB\n');
      await page.click('#vbEditAb');

      // „Original“: Basis-Wert, Eintrag gelöscht
      await vbDok(page).locator('[data-t="t1"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      assert.equal(await page.inputValue('#vbEditFeld'), 'Platzhalter per Strg', 'Feld mit dem eigenen Wert vorbelegt');
      assert.ok(await page.isEnabled('#vbEditOrig'), '„Original“ bei geänderter Stelle wählbar');
      await page.click('#vbEditOrig');
      await page.waitForSelector('#vbEdit', { state: 'hidden' });
      await warteBis(page, VB_HOST, (i) => i.t.t1.text === 'Platzhalter Titel', 'Original zurück (Vollbild)');
      await warteBis(page, KACHEL_HOST('F1'), (i) => i.t.t1.text === 'Platzhalter Titel', 'Original zurück (Kachel)');
      await ruhe(page);
      assert.deepEqual((await alle(page)).filter((e) => e.art === 'text').map((e) => e.k), ['t2'], 'Eintrag t1 gelöscht');
      assert.deepEqual((await idbEintraege(page)).filter((e) => e.art === 'text').map((e) => e.k), ['t2'], 'Eintrag t1 auch in IndexedDB gelöscht');
      assert.equal((await dokInfo(page, VB_HOST)).t.t1.mark, false, 'nach Original keine Markierung');

      // Leerer Text erlaubt
      await vbDok(page).locator('[data-t="t4"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      await page.fill('#vbEditFeld', '');
      await page.click('#vbEditOk');
      await page.waitForSelector('#vbEdit', { state: 'hidden' });
      await warteBis(page, VB_HOST, (i) => i.t.t4.text === '' && i.t.t4.html === '', 'leerer Text im Vollbild');
      await warteBis(page, KACHEL_HOST('F1'), (i) => i.t.t4.text === '', 'leerer Text in der Kachel');
      await ruhe(page);
      assert.deepEqual((await idbEintraege(page)).filter((e) => e.k === 't4').map((e) => [e.alt, e.neu]), [['Platzhalter-Fußzeile', '']]);
      assert.ok(await page.isHidden('#fehler'), 'kein Fehler bei leerem Text');

      // F2 (zweites Dokument): ← im Feld blättert nicht zurück
      await page.click('#vbWeiter');
      await page.waitForFunction(() => document.querySelector('#vbBuehne .flyer-host').dataset.id === 'F2');
      await ruhe(page);
      assert.equal(await zaehlerVb(page), '2 / 2');
      await vbDok(page).locator('[data-t="t1"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('ArrowLeft');
      await page.keyboard.press('Backspace');
      assert.equal(await zaehlerVb(page), '2 / 2', '← im Feld blättert nicht');
      assert.equal(await vollbildOffen(page), true);
      assert.equal(await page.inputValue('#vbEditFeld'), 'Platzhalter Titel zei');
      await page.keyboard.press('Escape');
      await page.waitForSelector('#vbEdit', { state: 'hidden' });
      assert.equal(await vollbildOffen(page), true);
      // Ohne Fokus im Feld blättern die Pfeile wieder
      await page.keyboard.press('ArrowLeft');
      assert.equal(await zaehlerVb(page), '1 / 2', 'nach dem Abbrechen blättern die Pfeile wieder');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.dialoge, []);
    });
  });
});

// ---------------------------------------------------------------------------
describe('Flyer bearbeiten: Status, Zähler, Stand, Kopfzeile, Markierung', () => {
  test('d) Status je Stellung (ok, run, next, plan, ohne) über die Oberfläche; Zähler „x von y fertig“, --anteil, --anteil-laeuft in Vollbild, Kachel und Druck; leerer Block 0 von 0', async () => {
    await mitSeite({ withToken: false, init: [druckStub] }, async ({ page, log }) => {
      await seiteMitPaket(page);
      // Basis: Zähler wie im Paket, leerer Block bekommt „0 von 0 fertig“
      for (const sel of [KACHEL_HOST('F1'), KACHEL_HOST('F2')]) {
        const i = await dokInfo(page, sel);
        assert.deepEqual(i.z, BASIS_Z, `${sel}: Zähler der Basis`);
      }
      await oeffneVollbild(page, 'F1');
      await setzeModus(page, 'status');
      const schritte = [
        // [Punkt, Stellung, erwartete Status s1..s3, Zähler-Text, --anteil, --anteil-laeuft]
        // --anteil-laeuft = run/y (Regel des echten Pakets: „läuft“ reicht von --anteil bis --anteil + --anteil-laeuft)
        ['s3', 'ok', ['ok', 'run', 'ok'], '2 von 3 fertig', '0.6667', '0.3333'],
        ['s2', 'next', ['ok', 'next', 'ok'], '2 von 3 fertig', '0.6667', '0'],
        ['s1', 'run', ['run', 'next', 'ok'], '1 von 3 fertig', '0.3333', '0.3333'],
        ['s2', 'plan', ['run', 'plan', 'ok'], '1 von 3 fertig', '0.3333', '0.3333'],
        ['s1', '', [null, 'plan', 'ok'], '1 von 3 fertig', '0.3333', '0'],
        ['s3', '', [null, 'plan', null], '0 von 3 fertig', '0', '0'],
        ['s1', 'ok', ['ok', 'plan', null], '1 von 3 fertig', '0.3333', '0'],
        ['s2', 'ok', ['ok', 'ok', null], '2 von 3 fertig', '0.6667', '0'],
        ['s3', 'ok', ['ok', 'ok', 'ok'], '3 von 3 fertig', '1', '0']
      ];
      let letzte = null;
      for (const [k, st, status, ztext, anteil, laeuft] of schritte) {
        await vbDok(page).locator(`[data-s="${k}"]`).click();
        await page.waitForSelector('#vbStatus:not([hidden])');
        await page.click(`#vbStatus button[data-status="${st}"]`);
        await page.waitForSelector('#vbStatus', { state: 'hidden' });
        const label = `${k} → „${st}“`;
        const pruefe = (i) => i.s.s1.status === status[0] && i.s.s2.status === status[1] && i.s.s3.status === status[2];
        const vb = await warteBis(page, VB_HOST, pruefe, `Vollbild ${label}`);
        const ka = await warteBis(page, KACHEL_HOST('F1'), pruefe, `Kachel ${label}`);
        for (const [ort, i] of [['Vollbild', vb], ['Kachel', ka]]) {
          assert.deepEqual(i.z.b1, { text: 'Platzhalter-Block ' + ztext, anteil, laeuft }, `${ort} ${label}: Zähler b1`);
          assert.deepEqual(i.bloecke.b1, [[anteil, laeuft], [anteil, laeuft], [anteil, laeuft]], `${ort} ${label}: Variablen an Überschrift, Balken im Block und Liste`);
          assert.deepEqual(i.z.b2, BASIS_Z.b2, `${ort} ${label}: leerer Block`);
          assert.deepEqual(i.bloecke.b2, [['0', '0'], ['0', '0']], `${ort} ${label}: leerer Block-Variablen`);
        }
        letzte = { status, ztext, anteil, laeuft };
      }
      // „ohne Status“ entfernt das Attribut wirklich (geprüft oben über null); Druck zeigt dieselben Zähler
      const dr = await druckInfo(page, 'F1');
      assert.deepEqual([dr.s.s1.status, dr.s.s2.status, dr.s.s3.status], letzte.status, 'Druck: Status');
      assert.deepEqual(dr.z.b1, { text: 'Platzhalter-Block ' + letzte.ztext, anteil: letzte.anteil, laeuft: letzte.laeuft }, 'Druck: Zähler b1');
      assert.deepEqual(dr.bloecke.b1, [[letzte.anteil, letzte.laeuft], [letzte.anteil, letzte.laeuft], [letzte.anteil, letzte.laeuft]], 'Druck: Variablen b1');
      assert.deepEqual(dr.z.b2, BASIS_Z.b2, 'Druck: leerer Block');
      assert.deepEqual(dr.marken, [], 'Druck ohne Markierung');
      // Zwischenstand mit „ohne“ auch im Druck: s2 → ohne, s1 → run
      await statusSetzen(page, 's2', '');
      await statusSetzen(page, 's1', 'run');
      const dr2 = await druckInfo(page, 'F1');
      assert.deepEqual([dr2.s.s1.status, dr2.s.s2.status, dr2.s.s3.status], ['run', null, 'ok']);
      assert.deepEqual(dr2.z.b1, { text: 'Platzhalter-Block 1 von 3 fertig', anteil: '0.3333', laeuft: '0.3333' });
      // Anderes Dokument unverändert
      assert.deepEqual((await dokInfo(page, KACHEL_HOST('F2'))).z, BASIS_Z);
      // Gespeichert: Status-Einträge (alt = Basis, neu = gewählt, '' = ohne)
      const e = (await idbEintraege(page)).filter((x) => x.art === 'status');
      assert.deepEqual(e.map((x) => [x.k, x.alt, x.neu]), [['s1', 'ok', 'run'], ['s2', 'run', ''], ['s3', 'plan', 'ok']]);
      // Auswahl zeigt die aktuelle Stellung
      await vbDok(page).locator('[data-s="s2"]').click();
      await page.waitForSelector('#vbStatus:not([hidden])');
      assert.equal(await page.getAttribute('#vbStatus button[data-status=""]', 'aria-pressed'), 'true', 'Auswahl: „ohne Status“ gewählt');
      await page.click('#vbStatusAb');
      // Nach dem Neuladen gleich
      await page.reload();
      await oeffneFlyer(page, null);
      await ruhe(page);
      const nach = await dokInfo(page, KACHEL_HOST('F1'));
      assert.deepEqual([nach.s.s1.status, nach.s.s2.status, nach.s.s3.status], ['run', null, 'ok']);
      assert.deepEqual(nach.z.b1, { text: 'Platzhalter-Block 1 von 3 fertig', anteil: '0.3333', laeuft: '0.3333' });
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.dialoge, []);
    });
  });

  test('e) Stand-Datum nach einer Änderung = heute (kurz „TT.MM.JJJJ“, lang „T. Monat JJJJ“, Text drumherum bleibt); „Original“ der letzten Änderung und „Dokument zurücksetzen“ nehmen es zurück', async () => {
    await mitSeite({ withToken: false, init: [druckStub] }, async ({ page, log }) => {
      await seiteMitPaket(page);
      const heute = await page.evaluate(() => window.AetherFlyerAenderungen.heute());
      assert.match(heute, /^\d{4}-\d{2}-\d{2}$/);
      const STAND_HEUTE = ['Stand ' + standKurz(heute), `Aktualisiert ${standLang(heute)} (Platzhalter)`];
      const STAND_BASIS = [STAND_KURZ_BASIS, STAND_LANG_BASIS];
      assert.deepEqual((await dokInfo(page, KACHEL_HOST('F1'))).stand, STAND_BASIS);
      await oeffneVollbild(page, 'F1');
      assert.deepEqual((await dokInfo(page, VB_HOST)).stand, STAND_BASIS);
      // Text-Änderung → Stand heute (Vollbild, Kachel, Druck)
      await setzeModus(page, 'text');
      await textAendern(page, 't1', 'Platzhalter geändert');
      const vb = await warteBis(page, VB_HOST, (i) => i.t.t1.text === 'Platzhalter geändert', 'Text geändert');
      assert.deepEqual(vb.stand, STAND_HEUTE, 'Vollbild: Stand heute');
      assert.deepEqual(vb.marken.filter((m) => m.startsWith('stand:')).sort(), ['stand:kurz', 'stand:lang'], 'Modus Text: Stand-Elemente markiert');
      assert.deepEqual((await warteBis(page, KACHEL_HOST('F1'), (i) => i.t.t1.text === 'Platzhalter geändert', 'Kachel')).stand, STAND_HEUTE, 'Kachel: Stand heute');
      assert.deepEqual((await druckInfo(page, 'F1')).stand, STAND_HEUTE, 'Druck: Stand heute');
      assert.deepEqual((await dokInfo(page, KACHEL_HOST('F2'))).stand, STAND_BASIS, 'anderes Dokument: Stand der Basis');
      assert.deepEqual((await alle(page)).filter((e) => e.art === 'stand').map((e) => [e.k, e.alt, e.neu]),
        [['stand1', STAND_BASIS[0], STAND_HEUTE[0]], ['stand2', STAND_BASIS[1], STAND_HEUTE[1]]]);
      // Zweite Änderung (Status), dann „Original“ der ersten: Stand bleibt heute
      await setzeModus(page, 'status');
      await statusSetzen(page, 's2', 'ok');
      await setzeModus(page, 'text');
      await vbDok(page).locator('[data-t="t1"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      await page.click('#vbEditOrig');
      await warteBis(page, VB_HOST, (i) => i.t.t1.text === 'Platzhalter Titel', 'Original t1');
      await ruhe(page);
      assert.deepEqual((await dokInfo(page, VB_HOST)).stand, STAND_HEUTE, 'noch eine Änderung: Stand bleibt heute');
      // Letzte Änderung zurück (Status wieder wie in der Basis) → Stand der Basis
      await setzeModus(page, 'status');
      await statusSetzen(page, 's2', 'run');
      const zurueck = await warteBis(page, VB_HOST, (i) => i.s.s2.status === 'run' && i.stand[0] === STAND_BASIS[0], 'Stand zurück');
      assert.deepEqual(zurueck.stand, STAND_BASIS);
      assert.deepEqual(zurueck.marken, [], 'keine Markierung mehr');
      assert.deepEqual(await alle(page), [], 'keine Einträge (auch kein Stand)');
      // Nur Text, dann „Original“ dieser letzten Änderung → Stand der Basis
      await setzeModus(page, 'text');
      await textAendern(page, 't4', 'Platzhalter-Fuß neu');
      assert.deepEqual((await warteBis(page, VB_HOST, (i) => i.t.t4.text === 'Platzhalter-Fuß neu', 't4')).stand, STAND_HEUTE);
      await vbDok(page).locator('[data-t="t4"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      await page.click('#vbEditOrig');
      const o2 = await warteBis(page, VB_HOST, (i) => i.t.t4.text === 'Platzhalter-Fußzeile', 'Original t4');
      assert.deepEqual(o2.stand, STAND_BASIS, '„Original“ der letzten Änderung: Stand der Basis');
      assert.deepEqual((await warteBis(page, KACHEL_HOST('F1'), (i) => i.t.t4.text === 'Platzhalter-Fußzeile', 'Kachel t4')).stand, STAND_BASIS);
      await ruhe(page);
      assert.deepEqual(await idbEintraege(page), [], 'IndexedDB leer');

      // „Dokument zurücksetzen“ (Rückfrage) nimmt alle Änderungen samt Stand zurück
      await textAendern(page, 't1', 'Platzhalter A');
      await setzeModus(page, 'status');
      await statusSetzen(page, 's1', 'plan');
      assert.ok(await page.isVisible('#vbReset'));
      assert.equal(await text(page, '#vbReset'), 'Dokument zurücksetzen');
      // Erst ablehnen: nichts passiert
      page.__dialogErwartet = true;
      const meldungen = [];
      const ablehnen = (d) => { meldungen.push([d.type(), d.message()]); d.dismiss(); };
      page.once('dialog', ablehnen);
      await page.click('#vbReset');
      await page.waitForTimeout(150);
      assert.equal((await alle(page)).length, 4, 'abgelehnt: Änderungen bleiben');
      page.once('dialog', (d) => { meldungen.push([d.type(), d.message()]); d.accept(); });
      await page.click('#vbReset');
      const res = await warteBis(page, VB_HOST, (i) => i.t.t1.text === 'Platzhalter Titel' && i.s.s1.status === 'ok', 'zurückgesetzt');
      page.__dialogErwartet = false;
      assert.deepEqual(meldungen.map((m) => m[0]), ['confirm', 'confirm']);
      assert.deepEqual(res.stand, STAND_BASIS);
      assert.deepEqual(res.z.b1, BASIS_Z.b1);
      await ruhe(page);
      assert.deepEqual(await alle(page), []);
      assert.deepEqual(await idbEintraege(page), []);
      assert.ok(await page.isHidden('#vbReset'), 'ohne Änderungen kein „Dokument zurücksetzen“');
      assert.equal(await text(page, '#status'), KOPF_BASIS);
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.dialoge, []);
    });
  });

  test('j) Kopfzeile: „· 1 Änderung nicht exportiert“, „· 2 Änderungen nicht exportiert“ (Stand zählt nicht), nach „Original“ wieder ohne Zusatz', async () => {
    await mitSeite({ withToken: false }, async ({ page, log }) => {
      await seiteMitPaket(page);
      await oeffneVollbild(page, 'F1');
      await setzeModus(page, 'text');
      await textAendern(page, 't1', 'Platzhalter eins neu');
      await page.waitForFunction((t) => document.getElementById('status').textContent.replace(/\s+/g, ' ').trim() === t, KOPF_BASIS + ' · 1 Änderung nicht exportiert');
      assert.equal((await alle(page)).length, 3, '1 Text + 2 Stand (Stand zählt nicht mit)');
      await setzeModus(page, 'status');
      await statusSetzen(page, 's3', 'next');
      await page.waitForFunction((t) => document.getElementById('status').textContent.replace(/\s+/g, ' ').trim() === t, KOPF_BASIS + ' · 2 Änderungen nicht exportiert');
      // Änderung in einem zweiten Dokument zählt mit
      await page.click('#vbWeiter');
      await page.waitForFunction(() => document.querySelector('#vbBuehne .flyer-host').dataset.id === 'F2');
      await ruhe(page);
      await setzeModus(page, 'text');
      await textAendern(page, 't2', 'Platzhalter zwei neu');
      await page.waitForFunction((t) => document.getElementById('status').textContent.replace(/\s+/g, ' ').trim() === t, KOPF_BASIS + ' · 3 Änderungen nicht exportiert');
      // Bleibt nach dem Neuladen
      await page.reload();
      await oeffneFlyer(page, null);
      assert.equal(await text(page, '#status'), KOPF_BASIS + ' · 3 Änderungen nicht exportiert');
      // „Original“ nacheinander
      await oeffneVollbild(page, 'F2');
      await setzeModus(page, 'text');
      await vbDok(page).locator('[data-t="t2"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      await page.click('#vbEditOrig');
      await page.waitForFunction((t) => document.getElementById('status').textContent.replace(/\s+/g, ' ').trim() === t, KOPF_BASIS + ' · 2 Änderungen nicht exportiert');
      await page.click('#vbZurueck');
      await page.waitForFunction(() => document.querySelector('#vbBuehne .flyer-host').dataset.id === 'F1');
      await ruhe(page);
      await setzeModus(page, 'status');
      await statusSetzen(page, 's3', 'plan');   // wieder wie in der Basis
      await page.waitForFunction((t) => document.getElementById('status').textContent.replace(/\s+/g, ' ').trim() === t, KOPF_BASIS + ' · 1 Änderung nicht exportiert');
      await setzeModus(page, 'text');
      await vbDok(page).locator('[data-t="t1"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      await page.click('#vbEditOrig');
      await page.waitForFunction((t) => document.getElementById('status').textContent.replace(/\s+/g, ' ').trim() === t, KOPF_BASIS);
      await ruhe(page);
      assert.equal(await text(page, '#status'), KOPF_BASIS, 'ohne Zusatz');
      assert.deepEqual(await alle(page), []);
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.dialoge, []);
    });
  });

  test('Markierung data-ae-geaendert (gestrichelte Unterlinie) nur im Vollbild in Text/Status – nicht in Ansehen, Kacheln, Druck; „Text zu lang“ nach einer Änderung', async () => {
    await mitSeite({ withToken: false, init: [druckStub] }, async ({ page, log }) => {
      await seiteMitPaket(page);
      await oeffneVollbild(page, 'F1');
      await setzeModus(page, 'text');
      await textAendern(page, 't1', 'Platzhalter markiert');
      await setzeModus(page, 'status');
      await statusSetzen(page, 's2', 'ok');
      const ERWARTET = ['s:s2', 'stand:kurz', 'stand:lang', 't1'];
      // Status: markiert (Text, Status, Stand), unveränderte Stellen nicht
      let vb = await warteBis(page, VB_HOST, (i) => i.s.s2.status === 'ok', 's2 ok');
      assert.deepEqual(vb.marken.slice().sort(), ERWARTET, 'Modus Status: geänderte Stellen markiert');
      assert.equal(vb.t.t2.mark, false);
      assert.equal(vb.s.s1.mark, false);
      const stil = await page.$eval(VB_HOST, (h) => {
        const e = h.shadowRoot.querySelector('[data-t="t1"]'), cs = getComputedStyle(e);
        const u = h.shadowRoot.querySelector('[data-t="t2"]'), cu = getComputedStyle(u);
        return { linie: cs.textDecorationLine, art: cs.textDecorationStyle, linieU: cu.textDecorationLine };
      });
      assert.equal(stil.linie, 'underline', 'Unterlinie');
      assert.equal(stil.art, 'dashed', 'gestrichelt');
      assert.equal(stil.linieU, 'none', 'unveränderte Stelle ohne Unterlinie');
      // Text: ebenso
      await setzeModus(page, 'text');
      vb = await dokInfo(page, VB_HOST);
      assert.deepEqual(vb.marken.slice().sort(), ERWARTET, 'Modus Text: geänderte Stellen markiert');
      // Ansehen: keine Markierung, Inhalt geändert
      await setzeModus(page, 'ansehen');
      vb = await dokInfo(page, VB_HOST);
      assert.deepEqual(vb.marken, [], 'Ansehen: keine Markierung');
      assert.equal(vb.t.t1.text, 'Platzhalter markiert');
      assert.equal(vb.s.s2.status, 'ok');
      const stilAnsehen = await page.$eval(VB_HOST, (h) => getComputedStyle(h.shadowRoot.querySelector('[data-t="t1"]')).textDecorationLine);
      assert.equal(stilAnsehen, 'none', 'Ansehen: keine Unterlinie');
      assert.ok(await page.isHidden('#vbReset'), 'Ansehen: kein „Dokument zurücksetzen“');
      // Kachel und Druck (aus dem Modus Status gedruckt): keine Markierung
      await setzeModus(page, 'status');
      const ka = await dokInfo(page, KACHEL_HOST('F1'));
      assert.deepEqual(ka.marken, [], 'Kachel: keine Markierung');
      assert.equal(ka.t.t1.text, 'Platzhalter markiert');
      const dr = await druckInfo(page, 'F1');
      assert.deepEqual(dr.marken, [], 'Druck: keine Markierung');
      assert.equal(await page.$$eval('#druck .flyer-host, #kacheln .flyer-host', (hs) => hs.reduce((n, h) => n + h.shadowRoot.querySelectorAll('[data-ae-geaendert]').length, 0)), 0);
      // Schließen und wieder öffnen: Ansehen, keine Markierung
      await page.click('#vbZu');
      await oeffneVollbild(page, 'F1');
      assert.deepEqual((await dokInfo(page, VB_HOST)).marken, [], 'neu geöffnet (Ansehen): keine Markierung');

      // „Text zu lang“ nach einer Änderung (Vollbild und Kachel), weg nach „Original“
      assert.ok(await page.isHidden('#vbWarnung'));
      await setzeModus(page, 'text');
      await textAendern(page, 't2', SEHR_LANG);
      await page.waitForSelector('#vbWarnung:not([hidden])');
      await page.waitForFunction(() => !document.querySelector('#kacheln .kachel[data-id="F1"] .kachel-warnung').hidden);
      assert.equal(await page.$eval(VB_HOST, (h) => h.shadowRoot.querySelector('section').style.getPropertyValue('--s')), '0.80', 'Schriftanpassung bis 0.80');
      assert.equal(await page.$eval('#kacheln .kachel[data-id="F2"] .kachel-warnung', (w) => w.hidden), true, 'andere Kachel ohne Warnung');
      await vbDok(page).locator('[data-t="t2"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      await page.click('#vbEditOrig');
      await page.waitForSelector('#vbWarnung', { state: 'hidden' });
      await page.waitForFunction(() => document.querySelector('#kacheln .kachel[data-id="F1"] .kachel-warnung').hidden);
      await ruhe(page);
      assert.equal(await page.$eval(VB_HOST, (h) => h.shadowRoot.querySelector('section').style.getPropertyValue('--s')), '1.42', 'nach Original wieder 1.42');
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.dialoge, []);
    });
  });
});

// Blöcke in der Struktur des echten Pakets (nur Platzhalter): <div data-block> ohne Wert mit Überschrift
// <h3 data-zaehler> (eigener Text, kein Zähler) und Listenpunkten; Paket-CSS zeigt den Balken nur mit > .zaehler.
function paketArtHtml() {
  const li = (k, st) => `<li data-s="${k}"${st ? ` data-status="${st}"` : ''}><ae-t data-t="t${k.slice(1)}0">Platzhalter ${k}</ae-t></li>`;
  return '<section class="page"><div class="body">' +
    '<div class="blk" data-block><h3 data-zaehler><ae-t data-t="t1">Platzhalter-Block eins</ae-t></h3><ul>' + li('s1') + li('s2') + li('s3') + li('s4') + '</ul></div>' +
    '<div class="blk" data-block><h3 data-zaehler><ae-t data-t="t2">Platzhalter-Block zwei</ae-t></h3><ul>' + li('s5', 'ok') + li('s6') + '</ul></div>' +
    '<div class="fill"></div></div></section>';
}
describe('Flyer bearbeiten: Zähler wie im echten Paket', () => {
  test('Blöcke ohne Wert: unverändert bitgenau ohne Zähler; eigener Status → <span class="zaehler"> nur in diesem Block, --anteil = ok/y, --anteil-laeuft = run/y; „Original“ nimmt ihn zurück; Export enthält ihn', async () => {
    await mitSeite({ withToken: false }, async ({ page, log }) => {
      await oeffneFlyer(page);
      const css = FLYER_CSS + '\n[data-zaehler]:has(> .zaehler){background:linear-gradient(90deg,#00ff00 0 calc(var(--anteil,0)*100%),#ffaa00 0 calc((var(--anteil,0) + var(--anteil-laeuft,0))*100%),#333333 0)}';
      const pk = { format: 'aether-flyer-paket', formatVersion: 1, version: VERSION, stand: STAND, css: { flyer: css, infografik: '' },
        kategorien: [{ id: 'k', name: 'Platzhalter' }], dokumente: [{ id: 'P1', art: 'flyer', kategorie: 'k', titel: 'Platzhalter', breite: 794, hoehe: 1123, html: paketArtHtml() }] };
      await importiere(page, pk);
      await ruhe(page);
      const zaehler = () => page.$eval('#kacheln .kachel[data-id="P1"] .flyer-host', (h) => [...h.shadowRoot.querySelectorAll('[data-zaehler]')].map((z) => ({
        html: z.outerHTML, kind: z.querySelector(':scope > .zaehler') ? z.querySelector(':scope > .zaehler').textContent : null,
        a: z.style.getPropertyValue('--anteil'), l: z.style.getPropertyValue('--anteil-laeuft'), bg: getComputedStyle(z).backgroundImage !== 'none' })));
      const vorher = await zaehler();
      // Unverändert: genau wie im Paket (kein Zähler, keine Variablen, kein Balken) – auch Block zwei mit einem „ok“
      assert.deepEqual(vorher.map((z) => [z.html, z.kind, z.a, z.l, z.bg]), [
        ['<h3 data-zaehler=""><ae-t data-t="t1">Platzhalter-Block eins</ae-t></h3>', null, '', '', false],
        ['<h3 data-zaehler=""><ae-t data-t="t2">Platzhalter-Block zwei</ae-t></h3>', null, '', '', false]]);
      // Status über die Oberfläche: s1 → ok, s2 → läuft
      await page.click('#kacheln .kachel[data-id="P1"]');
      await page.click('#vbModus button[data-modus="status"]');
      for (const [k, st] of [['s1', 'ok'], ['s2', 'run']]) {
        await page.locator('#vbBuehne .flyer-host').locator(`[data-s="${k}"]`).click();
        await page.click(`#vbStatus button[data-status="${st}"]`);
        await page.waitForFunction((k) => window.AetherFlyerAenderungen.geaendert('P1', 'status', k), k);
      }
      await ruhe(page);
      const nach = await zaehler();
      assert.deepEqual(nach.map((z) => [z.kind, z.a, z.l, z.bg]), [['1 von 4 fertig', '0.25', '0.25', true], [null, '', '', false]], 'nur Block eins bekommt Zähler und Balken');
      const vb = await page.$eval('#vbBuehne .flyer-host', (h) => h.shadowRoot.querySelector('[data-zaehler] > .zaehler').textContent);
      assert.equal(vb, '1 von 4 fertig');
      // Export: Zähler-Span und Variablen im Block eins, Markierungen gleich, Block zwei unverändert
      const ex = await page.evaluate(() => {
        const e = window.AetherFlyerAenderungen.exportPaket(null);
        // F3a: Export im Format v2 – die Seite steht in Version 1.1
        if (e.paket.formatVersion !== 2 || e.paket.versionen.length !== 1 || e.paket.versionen[0].nummer !== '1.1') return ['Format v2 mit Version 1.1 erwartet'];
        const doc = new DOMParser().parseFromString(e.paket.versionen[0].seiten[0].html, 'text/html');
        return [...doc.querySelectorAll('[data-zaehler]')].map((z) => z.outerHTML);
      });
      assert.deepEqual(ex, ['<h3 data-zaehler="" style="--anteil: 0.25; --anteil-laeuft: 0.25;"><ae-t data-t="t1">Platzhalter-Block eins</ae-t><span class="zaehler">1 von 4 fertig</span></h3>',
        '<h3 data-zaehler=""><ae-t data-t="t2">Platzhalter-Block zwei</ae-t></h3>']);
      // „Original“ für beide Punkte → wieder genau wie im Paket
      for (const k of ['s1', 's2']) {
        await page.evaluate((k) => window.AetherFlyerAenderungen.original('P1', 'status', k).then(() => window.AetherFlyerAnsicht.aktualisiere('P1')), k);
      }
      await ruhe(page);
      assert.deepEqual((await zaehler()).map((z) => z.html), vorher.map((z) => z.html), 'nach „Original“ wie im Paket');
      assert.deepEqual(log.errors, []);
    });
  });
});
