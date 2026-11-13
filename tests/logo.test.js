// Tests für das Logo-Werkzeug (logo.html) mit nachgebauter GitHub-API und Test-SVG: Anzeige, Commit und
// Quellen-Zeile, Ebenen-Schalter, Bereinigung (script/on*/foreignObject/externe href), SVG byte-gleich, PNG in
// 1024/2048/4096 px mit transparenten Ecken, Offline mit und ohne gespeicherte Fassung, ohne Token, Token in keinem
// Speicher und keinem Cache, Layout 320–1400 px. Aufruf: node --test tests/logo.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');
const { testLogo } = require('./test-png');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
const BASE = '/repos/konstantin9ezm/aether';
const COMMIT = '1234567abcdef0123456789abcdef0123456789a';
fs.mkdirSync(OUT, { recursive: true });

// Test-SVG: vier Gruppen als farbige Rechtecke an getrennten Stellen (Ecken frei), dazu ein eingeschleustes
// script-Element, ein onload-Attribut, foreignObject und ein externes Bild. CRLF und Umlaut prüfen die Byte-Gleichheit.
const GRUPPEN = {
  'ring-hinten': { x: 20, farbe: [255, 0, 0] },
  schatten: { x: 120, farbe: [0, 255, 0] },
  schrift: { x: 220, farbe: [0, 0, 255] },
  'ring-vorne': { x: 320, farbe: [255, 255, 0] }
};
const PIXEL = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR4nGNgAAIAAAUAAXpeqz8AAAAASUVORK5CYII='; // 1×1, durchsichtig
const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
function testSvg({ ohne = [] } = {}) {
  const g = Object.entries(GRUPPEN).filter(([id]) => !ohne.includes(id))
    .map(([id, v]) => `  <g id="${id}"><rect x="${v.x}" y="60" width="60" height="80" fill="${hex(v.farbe)}"/></g>`).join('\r\n');
  return Buffer.from([
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!-- Aether-Logo (Testdatei, Größe: 400 × 200, Umlaute: äöü) -->',
    '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 400 200">',
    '  <script>window.__pwned=(window.__pwned||[]).concat("script")</script>',
    // onload an einem eingebetteten, durchsichtigen 1×1-PNG: feuert, sobald das SVG ins Dokument käme (innerHTML)
    `  <image x="0" y="0" width="1" height="1" href="data:image/png;base64,${PIXEL}" onload="window.__pwned=(window.__pwned||[]).concat('onload')"/>`,
    '  <foreignObject x="0" y="0" width="10" height="10"><div xmlns="http://www.w3.org/1999/xhtml">x</div></foreignObject>',
    '  <image href="https://evil.example/pixel.png" xlink:href="https://evil.example/pixel2.png" x="0" y="0" width="5" height="5"/>',
    g,
    '</svg>',
    ''
  ].join('\r\n'), 'utf8');
}
const SVG = testSvg();
const SVG_SHA = crypto.createHash('sha256').update(SVG).digest('hex');
// Spiel-Logo (game/assets/ui/logo.png) für die zweite Karte; die eigenen Tests dazu stehen in logo-png.test.js.
const PNG = testLogo();
const PNG_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';

// ---------------------------------------------------------------------------
// Statischer Server (kann „kein Netz“ spielen) und Mock-API
// ---------------------------------------------------------------------------
const net = { offline: false };
const mock = { mode: 'ok', svg: SVG, png: PNG, requests: [] };
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
async function githubApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  mock.requests.push({ path: url.pathname, query: url.search, auth: headers.authorization || null, accept: headers.accept || '' });
  if (mock.mode === 'offline') return route.abort('internetdisconnected');
  if (mock.mode === 'hang') return; // antwortet nie
  if (headers.authorization !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: '{"message":"Bad credentials"}' });
  if (url.pathname === `${BASE}/contents/art/logo/logo.svg` && url.searchParams.get('ref') === 'main') {
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: mock.svg });
  }
  if (url.pathname === `${BASE}/contents/game/assets/ui/logo.png` && url.searchParams.get('ref') === 'main') {
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: mock.png });
  }
  if (url.pathname === `${BASE}/commits` && url.searchParams.get('path') === 'game/assets/ui/logo.png' && url.searchParams.get('sha') === 'main') {
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ sha: PNG_COMMIT, commit: { message: 'Logo als PNG' } }]) });
  }
  // Das Dashboard selbst (für den Service Worker geöffnet) fragt die Build-Liste ab: leer.
  if (url.pathname === `${BASE}/contents/index.json`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: '[]' });
  if (url.pathname === `${BASE}/commits` && url.searchParams.get('path') === 'art/logo/logo.svg' && url.searchParams.get('sha') === 'main') {
    return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ sha: COMMIT, commit: { message: 'Logo' } }]) });
  }
  return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"message":"Not Found"}' });
}

function shareMock() {
  window.__share = { calls: [] };
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    const active = navigator.userActivation ? navigator.userActivation.isActive : null;
    const files = await Promise.all(d.files.map(async (f) => {
      const buf = await f.arrayBuffer(), b = new Uint8Array(buf);
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((x) => x.toString(16).padStart(2, '0')).join('');
      const out = { name: f.name, type: f.type, bytes: b.length, sha, sig: [...b.slice(0, 8)].join(',') };
      if (f.type === 'image/png') {
        const v = new DataView(buf); out.w = v.getUint32(16); out.h = v.getUint32(20);
        const bmp = await createImageBitmap(f), cv = new OffscreenCanvas(bmp.width, bmp.height), ctx = cv.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const px = (x, y) => [...ctx.getImageData(Math.round(x * bmp.width), Math.round(y * bmp.height), 1, 1).data];
        // Mitte jeder Gruppe (Anteile der Breite/Höhe des 400 × 200-Bilds) und die vier Ecken
        out.gruppen = { 'ring-hinten': px(50 / 400, 0.5), schatten: px(150 / 400, 0.5), schrift: px(250 / 400, 0.5), 'ring-vorne': px(350 / 400, 0.5) };
        out.ecken = [px(0, 0), px(0.999, 0), px(0, 0.999), px(0.999, 0.999)];
      }
      return out;
    }));
    window.__share.calls.push({ title: d.title, files, active });
  };
}

async function newPage(opts = {}) {
  const { viewport = { width: 1194, height: 834 }, withToken = true, init, device = {} } = opts;
  net.offline = false;
  mock.mode = 'ok'; mock.svg = SVG; mock.png = PNG; mock.requests = [];
  const context = await browser.newContext({ viewport, ...device, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const log = { urls: [], errors: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  context.on('request', (r) => log.urls.push(r.url()));
  if (withToken) await context.addInitScript((t) => { if (window === window.top) localStorage.setItem('aether.githubToken', t); }, TOKEN);
  if (init) await context.addInitScript(init.fn, init.arg);
  await context.route('https://api.github.com/**', githubApi);
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  return { context, page, log };
}
const logoUrl = () => baseUrl + 'logo.html';
async function openLogo(page) {
  await page.goto(logoUrl());
  await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() !== 'laden');
}
async function waitPngReady(page) { await page.waitForFunction(() => window.AetherLogo.pngBereit()); }
const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, ' ').trim());
// Farbe in der Mitte jeder Gruppe im angezeigten Bild (img), gezeichnet auf 400 × 200
async function angezeigt(page) {
  await page.waitForFunction(() => { const i = document.getElementById('logoBild'); return !i.hidden && i.complete && i.naturalWidth > 0; });
  return page.evaluate(() => {
    const img = document.getElementById('logoBild'), cv = document.createElement('canvas');
    cv.width = 400; cv.height = 200;
    const ctx = cv.getContext('2d'); ctx.drawImage(img, 0, 0, 400, 200);
    const px = (x, y) => [...ctx.getImageData(x, y, 1, 1).data];
    return { 'ring-hinten': px(50, 100), schatten: px(150, 100), schrift: px(250, 100), 'ring-vorne': px(350, 100) };
  });
}
const sichtbarIn = (px) => Object.keys(px).filter((k) => px[k][3] > 200);
function assertFarben(px, sichtbar, label) {
  assert.deepEqual(sichtbarIn(px).sort(), [...sichtbar].sort(), `${label}: sichtbare Gruppen`);
  for (const k of sichtbar) assert.deepEqual(px[k].slice(0, 3), GRUPPEN[k].farbe, `${label}: Farbe von ${k}`);
}
const ALLE = Object.keys(GRUPPEN);

// ---------------------------------------------------------------------------
describe('Logo-Werkzeug: Laden und Anzeige', () => {
  test('zeigt das Logo, Commit und Quellen-Zeile; zwei API-Anfragen mit Token (dazu zwei für das PNG); Kopfzeile', async () => {
    const { context, page, log } = await newPage({ init: { fn: () => { window.__pwned = undefined; } } });
    await openLogo(page);
    assert.equal(await page.evaluate(() => window.AetherLogo.stand()), 'online');
    assert.match(await text(page, '#quelle'), /^Quelle: art\/logo\/logo\.svg · Commit 1234567 · geladen \d\d:\d\d Uhr$/);
    assert.equal(await text(page, '#quelle code'), '1234567');
    assert.ok(await page.isHidden('#hinweis'), 'kein Hinweis online');
    assertFarben(await angezeigt(page), ALLE, 'alle an');
    // Kopfzeile wie im Screen-Editor
    const back = await page.$eval('#zumDashboard', (a) => ({ href: a.getAttribute('href'), text: a.textContent.trim(), r: a.getBoundingClientRect().toJSON() }));
    assert.deepEqual([back.href, back.text], ['./#projekt', '‹ Zum Dashboard']);
    assert.ok(back.r.height >= 44 && back.r.width >= 44);
    assert.equal(await text(page, '.kopf .titel'), 'Logo');
    // Genau zwei Anfragen für das SVG, dazu zwei für das PNG der zweiten Karte; alle mit Token im Header, nie in der Adresse
    await page.waitForFunction(() => window.AetherLogo.pngStand() !== 'laden');
    assert.deepEqual(mock.requests.filter((r) => !r.query.includes('logo.png') && !r.path.endsWith('logo.png')).map((r) => r.path).sort(), [`${BASE}/commits`, `${BASE}/contents/art/logo/logo.svg`]);
    assert.deepEqual(mock.requests.map((r) => r.path + (r.path.endsWith('/commits') ? '?' + new URLSearchParams(r.query).get('path') : '')).sort(),
      [`${BASE}/commits?art/logo/logo.svg`, `${BASE}/commits?game/assets/ui/logo.png`, `${BASE}/contents/art/logo/logo.svg`, `${BASE}/contents/game/assets/ui/logo.png`]);
    assert.ok(mock.requests.every((r) => r.auth === `Bearer ${TOKEN}`));
    assert.ok(!log.urls.some((u) => u.includes(TOKEN)), 'Token nie in einer Adresse');
    assert.equal(mock.requests.find((r) => r.path.endsWith('logo.svg')).accept, 'application/vnd.github.raw+json');
    // Hintergrund-Umschalter (nur Anzeige), Standard „Dunkel“
    const bg = await page.$$eval('#hintergrund button', (bs) => bs.map((b) => [b.textContent, b.getAttribute('aria-pressed')]));
    assert.deepEqual(bg, [['Dunkel', 'true'], ['Hell', 'false'], ['Kariert (transparent)', 'false']]);
    for (const [k, farbe] of [['hell', 'rgb(244, 242, 251)'], ['kariert', 'rgb(255, 255, 255)'], ['dunkel', 'rgb(3, 4, 10)']]) {
      await page.click(`#hintergrund [data-bg="${k}"]`);
      assert.equal(await page.$eval('#buehne', (e) => [e.dataset.bg, getComputedStyle(e).backgroundColor].join('|')), `${k}|${farbe}`);
    }
    await page.screenshot({ path: path.join(OUT, 'logo-1194x834.png') });
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('das SVG führt nichts aus: script, on*, foreignObject und externe href entfernt; kein innerHTML; keine Anfrage nach außen', async () => {
    const { context, page, log } = await newPage({ init: { fn: () => { window.__pwned = undefined; } } });
    await openLogo(page);
    await angezeigt(page);
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__pwned), undefined, 'kein Script ausgeführt');
    const svg = await page.evaluate(() => window.AetherLogo.angezeigtesSvg());
    assert.doesNotMatch(svg, /<script/i, 'script entfernt');
    assert.doesNotMatch(svg, /\son[a-z]+\s*=/i, 'on*-Attribute entfernt');
    assert.doesNotMatch(svg, /foreignObject/i, 'foreignObject entfernt');
    assert.doesNotMatch(svg, /evil\.example/, 'externe href entfernt');
    assert.match(svg, /id="ring-hinten"/);
    assert.match(SVG.toString('utf8'), /<script>[\s\S]*onload=/, 'Testdatei enthält script und onload');
    assert.match(svg, /href="data:image\/png;base64,/, 'eingebettetes Rasterbild bleibt (ohne Handler)');
    // Bild aus Blob-URL, SVG nicht im Dokument
    const dom = await page.evaluate(() => ({ src: document.getElementById('logoBild').src, svgImDok: document.querySelectorAll('svg').length, scripts: document.scripts.length }));
    assert.match(dom.src, /^blob:/);
    assert.equal(dom.svgImDok, 0, 'kein SVG-Element im Dokument');
    assert.equal(dom.scripts, 2, 'nur das eigene Skript und gemeinsam.js');
    assert.ok(!log.urls.some((u) => u.includes('evil.example')), 'externes Bild nie angefragt');
    const html = fs.readFileSync(path.join(ROOT, 'logo.html'), 'utf8');
    assert.doesNotMatch(html, /\.innerHTML\s*=|insertAdjacentHTML|outerHTML\s*=|document\.write/, 'nie per innerHTML ins Dokument');
    assert.match(html, /new DOMParser\(\)\.parseFromString/);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('jeder Ebenen-Schalter blendet genau seine Gruppe aus (Reihenfolge, Standard an, Tippflächen)', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    const schalter = await page.$$eval('#ebenen label', (ls) => ls.map((l) => ({ id: l.dataset.ebene, text: l.textContent.trim(), an: l.querySelector('input').checked, aus: l.querySelector('input').disabled, h: l.getBoundingClientRect().height, w: l.getBoundingClientRect().width })));
    assert.deepEqual(schalter.map((s) => [s.id, s.text, s.an, s.aus]), [
      ['ring-hinten', 'Ring hinten', true, false], ['schatten', 'Schatten', true, false], ['schrift', 'Schrift', true, false], ['ring-vorne', 'Ring vorne', true, false]]);
    for (const s of schalter) assert.ok(s.h >= 44 && s.w >= 44, `Tippfläche ${s.id}`);
    for (const id of ALLE) {
      await page.click(`#ebenen label[data-ebene="${id}"]`);
      assert.equal(await page.isChecked(`#ebene-${id}`), false);
      await page.waitForFunction((id) => window.AetherLogo.angezeigtesSvg().includes('display:none'), id);
      assertFarben(await angezeigt(page), ALLE.filter((k) => k !== id), `${id} aus`);
      const svg = await page.evaluate(() => window.AetherLogo.angezeigtesSvg());
      assert.equal((svg.match(/display:none/g) || []).length, 1, `${id}: genau eine Gruppe ausgeblendet`);
      assert.match(svg, new RegExp(`<g id="${id}" style=";?display:none`));
      await page.click(`#ebenen label[data-ebene="${id}"]`);
      assertFarben(await angezeigt(page), ALLE, `${id} wieder an`);
    }
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('fehlt eine Gruppe in der Datei, ist ihr Schalter ausgegraut mit Hinweis', async () => {
    const { context, page, log } = await newPage();
    mock.svg = testSvg({ ohne: ['schatten'] });
    await openLogo(page);
    const s = await page.$eval('#ebenen label[data-ebene="schatten"]', (l) => ({ dis: l.querySelector('input').disabled, an: l.querySelector('input').checked, text: l.textContent.trim(), op: Number(getComputedStyle(l).opacity) }));
    assert.equal(s.dis, true);
    assert.equal(s.an, false);
    assert.match(s.text, /^Schatten.*fehlt in der Datei/);
    assert.ok(s.op < 0.6, 'ausgegraut');
    for (const id of ['ring-hinten', 'schrift', 'ring-vorne']) assert.equal(await page.isDisabled(`#ebene-${id}`), false);
    assertFarben(await angezeigt(page), ['ring-hinten', 'schrift', 'ring-vorne'], 'ohne Schatten');
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
describe('Logo-Werkzeug: Sichern', () => {
  test('„SVG sichern“: Originaldatei byte-gleich, alle Ebenen, Name mit Commit; nur mit Nutzergeste; Hinweiszeile', async () => {
    const { context, page, log } = await newPage({ init: { fn: shareMock } });
    await openLogo(page);
    assert.equal(await text(page, '#sichernHinweis'), 'Sichern öffnet den Teilen-Dialog („In Dateien sichern“, Affinity …)');
    assert.equal(await page.getAttribute('#btnSvg', 'class'), 'primary', 'Hauptknopf');
    // Eine Ebene aus: das SVG bleibt trotzdem das Original
    await page.click('#ebenen label[data-ebene="schrift"]');
    await page.evaluate(() => document.getElementById('btnSvg').click());
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__share.calls.length), 0, 'Skript-Klick löst nichts aus');
    await page.click('#btnSvg');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const c = await page.evaluate(() => window.__share.calls[0]);
    assert.equal(c.active, true, 'share() innerhalb der Nutzergeste');
    assert.deepEqual([c.files.length, c.files[0].name, c.files[0].type], [1, 'aether-logo-1234567.svg', 'image/svg+xml']);
    assert.equal(c.files[0].bytes, SVG.length, 'gleiche Länge');
    assert.equal(c.files[0].sha, SVG_SHA, 'byte-gleich mit der Originaldatei (SHA-256)');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('„PNG sichern“: 1024/2048 (Standard)/4096 px, Seitenverhältnis wie im SVG, transparente Ecken, ausgeblendete Ebenen fehlen', async () => {
    const { context, page, log } = await newPage({ init: { fn: shareMock } });
    await openLogo(page);
    assert.deepEqual(await page.$$eval('#breite button', (bs) => bs.map((b) => [b.textContent, b.getAttribute('aria-pressed')])), [['1024 px', 'false'], ['2048 px', 'true'], ['4096 px', 'false']]);
    let n = 0;
    const sichere = async () => {
      await waitPngReady(page);
      await page.click('#btnPng');
      n++;
      await page.waitForFunction((n) => window.__share.calls.length === n, n, { timeout: 30000 });
      return page.evaluate((n) => window.__share.calls[n - 1], n);
    };
    // Standard 2048, alle Ebenen
    let c = await sichere();
    let f = c.files[0];
    assert.equal(c.active, true);
    assert.deepEqual([f.name, f.type, f.sig, f.w, f.h], ['aether-logo-1234567-2048.png', 'image/png', '137,80,78,71,13,10,26,10', 2048, 1024]);
    for (const e of f.ecken) assert.equal(e[3], 0, 'Ecke transparent');
    assertFarben(f.gruppen, ALLE, 'PNG 2048 alle');
    // 1024 und 4096, je mit einer anderen ausgeschalteten Ebene
    for (const [w, aus] of [[1024, 'schatten'], [4096, 'ring-vorne']]) {
      await page.click(`#breite [data-w="${w}"]`);
      for (const id of ALLE) await page.setChecked(`#ebene-${id}`, id !== aus);
      c = await sichere();
      f = c.files[0];
      assert.deepEqual([f.name, f.w, f.h], [`aether-logo-1234567-${w}.png`, w, w / 2]);
      for (const e of f.ecken) assert.equal(e[3], 0, `${w}: Ecke transparent`);
      assertFarben(f.gruppen, ALLE.filter((k) => k !== aus), `PNG ${w} ohne ${aus}`);
    }
    // Zwei Ebenen aus
    await page.click('#breite [data-w="1024"]');
    await page.setChecked('#ebene-ring-hinten', false);
    await page.setChecked('#ebene-schrift', false);
    await page.setChecked('#ebene-ring-vorne', true);
    await page.setChecked('#ebene-schatten', true);
    c = await sichere();
    assertFarben(c.files[0].gruppen, ['schatten', 'ring-vorne'], 'PNG ohne Ring hinten und Schrift');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('ohne Teilen-Dialog: Download mit demselben Dateinamen', async () => {
    const { context, page, log } = await newPage({ init: { fn: () => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; } } });
    await openLogo(page);
    const downloads = [];
    page.on('download', (d) => downloads.push(d));
    await page.click('#btnSvg');
    await waitPngReady(page);
    await page.click('#btnPng');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('heruntergeladen'));
    await page.waitForTimeout(500);
    assert.deepEqual(downloads.map((d) => d.suggestedFilename()), ['aether-logo-1234567.svg', 'aether-logo-1234567-2048.png']);
    const p = await downloads[0].path();
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex'), SVG_SHA, 'Download byte-gleich');
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
describe('Logo-Werkzeug: Offline, ohne Token, Speicher', () => {
  test('offline nach einmaligem Laden: Seite aus der App-Hülle, gespeicherte Fassung mit Hinweis; Sichern geht', async () => {
    const { context, page, log } = await newPage({ init: { fn: shareMock } });
    await page.goto(baseUrl);
    const swReady = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]));
    assert.ok(swReady, 'Service Worker aktiv');
    const keys = await page.evaluate(async () => (await (await caches.open('aether-shell-v1')).keys()).map((r) => new URL(r.url).pathname));
    assert.ok(keys.includes('/logo.html'), `logo.html in der App-Hülle: ${keys.join(', ')}`);
    await openLogo(page);
    assert.equal(await page.evaluate(() => window.AetherLogo.stand()), 'online');
    const quelle = await text(page, '#quelle');
    // Netz weg (Browser offline, Server kappt, API bricht ab)
    net.offline = true; mock.mode = 'offline';
    await context.setOffline(true);
    await page.reload();
    await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() !== 'laden');
    assert.equal(await page.evaluate(() => window.AetherLogo.stand()), 'offline');
    assert.equal(await text(page, '#hinweis'), 'Offline – zuletzt geladene Fassung');
    assert.equal(await text(page, '#quelle'), quelle, 'Quellen-Zeile der gespeicherten Fassung');
    assertFarben(await angezeigt(page), ALLE, 'offline');
    await page.click('#btnSvg');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    assert.equal(await page.evaluate(() => window.__share.calls[0].files[0].sha), SVG_SHA, 'offline byte-gleich');
    await page.screenshot({ path: path.join(OUT, 'logo-offline.png') });
    // Über die Tools-Karte offline erreichbar
    await page.click('#zumDashboard');
    await page.waitForSelector('#projectView:not([hidden])');
    assert.equal(await page.getAttribute('#toolLogo', 'href'), 'logo.html', '„Logo ›“ offline aktiv');
    await page.click('#toolLogo');
    await page.waitForURL(/logo\.html$/);
    await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() === 'offline');
    net.offline = false;
    await context.setOffline(false);
    assert.deepEqual(log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
    await context.close();
  });

  test('offline ohne gespeicherte Fassung: Hinweis „Noch kein Logo geladen – einmal online öffnen.“', async () => {
    const { context, page, log } = await newPage();
    mock.mode = 'offline';
    await openLogo(page);
    assert.equal(await page.evaluate(() => window.AetherLogo.stand()), 'offline-leer');
    assert.equal(await text(page, '#leer'), 'Noch kein Logo geladen – einmal online öffnen.');
    assert.ok(await page.isHidden('#logoBild'));
    assert.equal(await page.isDisabled('#btnSvg'), true);
    assert.equal(await page.isDisabled('#btnPng'), true);
    assert.equal(await text(page, '#quelle'), '');
    assert.equal(await page.evaluate(() => localStorage.getItem('aether.logo')), null);
    assert.deepEqual(log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
    await context.close();
  });

  test('hängende API: nach dem Zeitlimit gespeicherte Fassung mit Offline-Hinweis', async () => {
    const { context, page, log } = await newPage({ init: { fn: () => { window.AETHER_TEST_PROJECT_TIMEOUT_MS = 1500; } } });
    await openLogo(page);
    assert.equal(await page.evaluate(() => window.AetherLogo.stand()), 'online');
    mock.mode = 'hang';
    const t0 = Date.now();
    await page.reload();
    await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() !== 'laden', null, { timeout: 10000 });
    assert.ok(Date.now() - t0 < 6000, 'nach dem Zeitlimit');
    assert.equal(await page.evaluate(() => window.AetherLogo.stand()), 'offline');
    assert.equal(await text(page, '#hinweis'), 'Offline – zuletzt geladene Fassung');
    assertFarben(await angezeigt(page), ALLE, 'nach Zeitlimit');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('ohne Token: derselbe Hinweis wie in der Projektansicht, keine API-Anfrage', async () => {
    const { context, page, log } = await newPage({ withToken: false });
    await openLogo(page);
    assert.equal(await page.evaluate(() => window.AetherLogo.stand()), 'notoken');
    assert.equal(mock.requests.length, 0, 'keine API-Anfrage');
    const h = await page.evaluate(() => ({ b: document.querySelector('#hinweis b').textContent, t: document.querySelector('#hinweis div').textContent, a: document.querySelector('#hinweis a').getAttribute('href') }));
    assert.equal(await text(page, '#leer'), 'Noch kein Logo geladen – einmal online öffnen.');
    // Vergleich mit der Projektansicht (gleicher Titel und Text)
    await page.goto(baseUrl + '#projekt');
    await page.waitForSelector('#ciBody .msg[data-kind="notoken"]');
    const p = await page.evaluate(() => ({ b: document.querySelector('#ciBody .msg b').textContent, t: document.querySelector('#ciBody .msg div').textContent }));
    assert.deepEqual([h.b, h.t], [p.b, p.t], 'gleicher Hinweis');
    assert.equal(h.a, './', 'Token eingeben im Dashboard');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Token steht in keinem Speicher der Logo-Seite und in keinem Cache; API-Antworten nie im Cache', async () => {
    const { context, page, log } = await newPage();
    await page.goto(baseUrl);
    await page.evaluate(() => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 10000))]));
    await openLogo(page);
    await page.reload();
    await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() === 'online');
    const st = await page.evaluate(async (token) => {
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
      const dbs = indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [];
      return { ls, ss, cache, dbs, cookie: document.cookie };
    }, TOKEN);
    const eigene = st.ls.filter(([k]) => k !== 'aether.githubToken');
    assert.ok(eigene.some(([k]) => k === 'aether.logo'), 'gespeicherte Fassung vorhanden');
    for (const [k, v] of eigene) assert.ok(!v.includes(TOKEN) && !v.includes('github_pat_'), `kein Token in ${k}`);
    const logo = JSON.parse(st.ls.find(([k]) => k === 'aether.logo')[1]);
    assert.deepEqual(Object.keys(logo).sort(), ['commit', 'geladen', 'svg'], 'nur SVG-Text, Commit, Zeitpunkt');
    assert.deepEqual(st.ss, []);
    assert.deepEqual(st.dbs, []);
    assert.equal(st.cookie, '');
    assert.ok(st.cache.length > 0);
    for (const c of st.cache) {
      assert.ok(!c.token && !c.auth, `kein Token im Cache: ${c.url}`);
      assert.ok(!c.url.includes('api.github.com'), `keine API-Antwort im Cache: ${c.url}`);
    }
    assert.ok(st.cache.some((c) => c.url.endsWith('/logo.html')));
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
describe('Logo-Werkzeug: Layout', () => {
  for (const zustand of ['mit Logo', 'ohne Logo (offline)']) {
    test(`320–1400 px ohne waagerechtes Scrollen, zwei Karten quer ab 900 px, Tippflächen ≥ 44 × 44 px (${zustand})`, async () => {
      const { context, page, log } = await newPage({ viewport: { width: 320, height: 700 } });
      if (zustand !== 'mit Logo') mock.mode = 'offline';
      await openLogo(page);
      const groessen = [[320, 568], [360, 740], [375, 667], [390, 844], [402, 874], [414, 896], [480, 800], [600, 900], [768, 1024], [834, 1194], [874, 402],
        [900, 700], [1024, 768], [1180, 820], [1194, 834], [1280, 800], [1366, 1024], [1400, 900]];
      for (const [w, h] of groessen) {
        await page.setViewportSize({ width: w, height: h });
        await page.waitForTimeout(60);
        const m = await page.evaluate(() => {
          const box = (e) => { const r = e.getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, w: r.width, h: r.height }; };
          const ziele = [...document.querySelectorAll('button, a, label.check')].filter((e) => e.offsetParent !== null && !e.closest('#modal'));
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            links: box(document.getElementById('logoKarte')), rechts: box(document.getElementById('ebenenKarte')),
            ziele: ziele.map((e) => ({ t: e.textContent.trim().slice(0, 30), ...box(e) })),
            karteOverflow: [...document.querySelectorAll('.karte')].map((k) => k.scrollWidth - k.clientWidth)
          };
        });
        const label = `${w}×${h}`;
        assert.ok(m.overflow <= 0, `${label}: kein waagerechtes Scrollen (${m.overflow})`);
        for (const o of m.karteOverflow) assert.ok(o <= 0, `${label}: Karte läuft nicht über`);
        for (const z of m.ziele) {
          assert.ok(z.w >= 44 && z.h >= 44, `${label}: Tippfläche „${z.t}“ ${z.w}×${z.h}`);
          assert.ok(z.x0 >= -0.5 && z.x1 <= w + 0.5, `${label}: „${z.t}“ im Fenster`);
        }
        const nebeneinander = w >= 900 && w > h;
        if (nebeneinander) {
          assert.ok(m.rechts.x0 >= m.links.x1 - 0.5 && Math.abs(m.rechts.y0 - m.links.y0) < 1, `${label}: Karten nebeneinander (links Logo)`);
        } else {
          assert.ok(m.rechts.y0 >= m.links.y1 - 0.5, `${label}: Karten untereinander`);
        }
        if ([320, 390, 1194, 1400].includes(w)) await page.screenshot({ path: path.join(OUT, `logo-${zustand === 'mit Logo' ? 'an' : 'offline'}-${w}x${h}.png`), fullPage: true });
      }
      assert.deepEqual(log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
      await context.close();
    });
  }
});

// ---------------------------------------------------------------------------
describe('Logo-Werkzeug: Dateien', () => {
  test('App-Hülle (sw.js, Cache-Name unverändert), Workflow kopiert logo.html; keine externen Skripte', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    assert.match(/var SHELL = \[([^\]]*)\]/.exec(sw)[1], /'logo\.html'/);
    assert.match(sw, /var SHELL_CACHE = 'aether-shell-v1';/);
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8');
    assert.match(wf, /cp [^\n]*logo\.html[^\n]*_site\//);
    const html = fs.readFileSync(path.join(ROOT, 'logo.html'), 'utf8');
    assert.deepEqual([...html.matchAll(/<script[^>]*src="([^"]*)"/g)].map((m) => m[1]), ['gemeinsam.js'], 'kein nachgeladenes Skript außer dem lokalen gemeinsam.js');
    assert.doesNotMatch(html, /<link[^>]+stylesheet/i);
    assert.deepEqual([...html.matchAll(/https?:\/\/[^\s'"<>)]+/g)].map((m) => m[0]).filter((u) => !u.startsWith('http://www.w3.org/')).sort(), ['https://api.github.com', 'https://github.com/'], 'nur die GitHub-API (und der Commit-Link der PNG-Karte)');
    assert.doesNotMatch(html, /localStorage\.setItem\(\s*TOKEN_KEY/, 'Token wird nie geschrieben');
  });
});
