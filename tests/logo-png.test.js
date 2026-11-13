// Tests für das echte Spiel-Logo (game/assets/ui/logo.png) im Logo-Werkzeug (Karte „Im Spiel (PNG)“) und im
// Screen-Editor (Logo/Menübox), mit nachgebauter GitHub-API und erzeugten Test-PNG: Bild, Quellzeile (Maße, Größe,
// Commit-Link), Seitenverhältnis (auch bei anderem Seitenverhältnis), „PNG sichern (Original)“ byte-gleich,
// Hintergrund-Schalter für beide Vorschauen, Fehlerfall und offline, Box-Maße unverändert, Annäherung mit Hinweis,
// iPhone hochkant ohne waagerechtes Scrollen. Gewartet wird nur auf Seitenzustand.
// Aufruf: node --test tests/logo-png.test.js
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
const SVG_COMMIT = '1234567abcdef0123456789abcdef0123456789a';
const PNG_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
fs.mkdirSync(OUT, { recursive: true });

// Test-SVG (eine Ebene genügt hier) und Test-PNG: Maße wie das echte Logo (1874 × 681) bzw. hochkant (400 × 500)
const SVG = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g id="schrift"><rect x="20" y="20" width="360" height="160" fill="#00ff00"/></g></svg>', 'utf8');
const PNG = testLogo();
const PNG_HOCH = testLogo(400, 500);
const sha256 = (b) => crypto.createHash('sha256').update(b).digest('hex');
const kb = (n) => Math.max(1, Math.round(n / 1024)) + ' KB';

// ---------------------------------------------------------------------------
// Statischer Server und Mock-API
// ---------------------------------------------------------------------------
const net = { offline: false };
const mock = { mode: 'ok', png: PNG, pngMode: 'ok', requests: [] };
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

const CORS = { 'access-control-allow-origin': '*' };
async function githubApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  mock.requests.push({ path: url.pathname, file: url.pathname.endsWith('/commits') ? url.searchParams.get('path') : null, auth: headers.authorization || null, accept: headers.accept || '' });
  if (mock.mode === 'offline') return route.abort('internetdisconnected');
  if (headers.authorization !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: '{"message":"Bad credentials"}' });
  const istPng = url.pathname === `${BASE}/contents/game/assets/ui/logo.png` || url.searchParams.get('path') === 'game/assets/ui/logo.png';
  if (istPng && mock.pngMode === 'offline') return route.abort('internetdisconnected');
  if (istPng && mock.pngMode === 'fehler') return route.fulfill({ status: 500, headers: CORS, contentType: 'application/json', body: '{"message":"Server Error"}' });
  if (url.pathname === `${BASE}/contents/art/logo/logo.svg` && url.searchParams.get('ref') === 'main') {
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: SVG });
  }
  if (url.pathname === `${BASE}/contents/game/assets/ui/logo.png` && url.searchParams.get('ref') === 'main') {
    return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: mock.png });
  }
  if (url.pathname === `${BASE}/commits` && url.searchParams.get('sha') === 'main') {
    const p = url.searchParams.get('path');
    if (p === 'art/logo/logo.svg') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ sha: SVG_COMMIT }]) });
    if (p === 'game/assets/ui/logo.png') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ sha: PNG_COMMIT }]) });
  }
  return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"message":"Not Found"}' });
}

function shareMock() {
  window.__share = { calls: [] };
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    const files = await Promise.all(d.files.map(async (f) => {
      const buf = await f.arrayBuffer();
      const sha = [...new Uint8Array(await crypto.subtle.digest('SHA-256', buf))].map((x) => x.toString(16).padStart(2, '0')).join('');
      return { name: f.name, type: f.type, bytes: buf.byteLength, sha };
    }));
    window.__share.calls.push({ title: d.title, files, active: navigator.userActivation ? navigator.userActivation.isActive : null });
  };
}

async function newPage(opts = {}) {
  const { viewport = { width: 1194, height: 834 }, withToken = true, init, device = {} } = opts;
  net.offline = false;
  mock.mode = 'ok'; mock.png = PNG; mock.pngMode = 'ok'; mock.requests = [];
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
// Konsolenfehler, die zum Fehlerfall gehören (abgebrochene bzw. abgelehnte Anfragen)
const echteFehler = (log) => log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e));
const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, ' ').trim());

async function openLogo(page) {
  await page.goto(baseUrl + 'logo.html');
  await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() !== 'laden' && window.AetherLogo.pngStand() !== 'laden');
}
async function openEditor(page) {
  await page.goto(baseUrl + 'screen-editor.html');
  await page.waitForFunction(() => window.AetherScreenEditor && window.AetherScreenEditor.logoBild() !== 'laden');
}
const pngGeladen = (page) => page.waitForFunction(() => { const i = document.getElementById('pngBild'); return !i.hidden && i.complete && i.naturalWidth > 0; });
const editorBildGeladen = (page) => page.waitForFunction(() => { const i = document.querySelector('#logoEl img.logoPng'); return !!i && i.complete && i.naturalWidth > 0; });

// Fläche der Bildpixel (Magenta) in einem Element, aus einem Bildschirmfoto gemessen – in CSS-Pixeln relativ zum
// Element. null, wenn kein Bildpixel zu sehen ist.
async function magentaIn(page, sel) {
  const el = await page.$(sel);
  const r = await el.evaluate((e) => { const b = e.getBoundingClientRect(); return { w: b.width, h: b.height }; });
  const shot = await el.screenshot();
  return page.evaluate(async ({ b64, r }) => {
    const bin = atob(b64), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const bmp = await createImageBitmap(new Blob([u8], { type: 'image/png' }));
    const cv = new OffscreenCanvas(bmp.width, bmp.height), ctx = cv.getContext('2d');
    ctx.drawImage(bmp, 0, 0);
    const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < bmp.height; y++) for (let x = 0; x < bmp.width; x++) {
      const i = (y * bmp.width + x) * 4;
      if (d[i] > 225 && d[i + 1] < 45 && d[i + 2] > 225) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    if (!n) return null;
    const k = bmp.width / r.w;
    return { x0: x0 / k, y0: y0 / k, x1: (x1 + 1) / k, y1: (y1 + 1) / k, w: (x1 + 1 - x0) / k, h: (y1 + 1 - y0) / k, elW: r.w, elH: r.h, n };
  }, { b64: shot.toString('base64'), r });
}
// Dasselbe für ein Canvas (Vergleichsbild des Screen-Editors), direkt aus seinen Pixeln
async function magentaImCanvas(page, sel) {
  return page.$eval(sel, (cv) => {
    const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data;
    let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1, n = 0;
    for (let y = 0; y < cv.height; y++) for (let x = 0; x < cv.width; x++) {
      const i = (y * cv.width + x) * 4;
      if (d[i] > 225 && d[i + 1] < 45 && d[i + 2] > 225) { n++; if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    }
    return n ? { w: x1 + 1 - x0, h: y1 + 1 - y0, n } : null;
  });
}
function assertSeiten(m, w, h, label, tol = 0.03) {
  assert.ok(m, `${label}: Bildpixel sichtbar`);
  const soll = w / h, ist = m.w / m.h;
  assert.ok(Math.abs(ist / soll - 1) <= tol, `${label}: Seitenverhältnis ${ist.toFixed(3)} statt ${soll.toFixed(3)} (${m.w.toFixed(1)} × ${m.h.toFixed(1)})`);
}

// ---------------------------------------------------------------------------
describe('Logo-Werkzeug: Karte „Im Spiel (PNG)“', () => {
  test('(a) Karten-Titel; PNG-Karte zeigt das Bild, Quellzeile mit Commit-Link, Maßen und Größe; Hinweis „Neues Logo“', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    assert.equal(await text(page, '#logoTitel'), 'Arbeitsdatei (SVG)');
    assert.equal(await text(page, '#pngTitel'), 'Im Spiel (PNG) – so zeigt das Startmenü das Logo');
    const zusatz = await page.$eval('#pngTitel .zusatz', (e) => [getComputedStyle(e).color, getComputedStyle(document.getElementById('pngTitel')).color]);
    assert.notEqual(zusatz[0], zusatz[1], 'Zusatz gedämpft');
    assert.equal(await page.evaluate(() => window.AetherLogo.pngStand()), 'online');
    await pngGeladen(page);
    assert.deepEqual(await page.evaluate(() => window.AetherLogo.pngInfo()), { sha: PNG_COMMIT, w: 1874, h: 681, bytes: PNG.length });
    assert.equal(await text(page, '#pngQuelle'), `Quelle: game/assets/ui/logo.png · Commit fedcba9 · 1874 × 681 px · ${kb(PNG.length)}`);
    const link = await page.$eval('#pngQuelle a', (a) => ({ href: a.href, text: a.textContent, target: a.target, rel: a.rel }));
    assert.deepEqual(link, { href: `https://github.com/konstantin9ezm/aether/commit/${PNG_COMMIT}`, text: 'fedcba9', target: '_blank', rel: 'noopener noreferrer' });
    assert.equal(await text(page, '#pngNeu'), 'Neues Logo: PNG in game/assets/ui/ ersetzen');
    assert.equal(await page.$eval('#pngNeu', (e) => e.className), 'note', 'Hinweis gedämpft wie die anderen Notizen');
    assert.ok(await page.isHidden('#pngHinweis'), 'keine Meldung online');
    // Das gezeigte Bild sind die Bytes der Datei (Pixel des Test-PNG sichtbar)
    assert.ok(await magentaIn(page, '#pngBuehne'), 'Bildpixel in der Vorschau');
    // Linke Spalte: SVG-Karte, darunter PNG-Karte; rechts Ebenen (iPad quer)
    const r = await page.evaluate(() => Object.fromEntries(['logoKarte', 'pngKarte', 'ebenenKarte'].map((id) => [id, document.getElementById(id).getBoundingClientRect().toJSON()])));
    assert.ok(r.pngKarte.top >= r.logoKarte.bottom && Math.abs(r.pngKarte.left - r.logoKarte.left) < 1, 'PNG-Karte unter der SVG-Karte');
    assert.ok(r.ebenenKarte.left >= r.logoKarte.right && Math.abs(r.ebenenKarte.top - r.logoKarte.top) < 1, 'rechte Spalte daneben');
    // Anfragen: je Datei Inhalt + letzter Commit, alle mit Token, roh
    assert.deepEqual(mock.requests.filter((q) => q.path.endsWith('logo.png') || q.file === 'game/assets/ui/logo.png').map((q) => q.path).sort(),
      [`${BASE}/commits`, `${BASE}/contents/game/assets/ui/logo.png`]);
    assert.ok(mock.requests.every((q) => q.auth === `Bearer ${TOKEN}`));
    assert.equal(mock.requests.find((q) => q.path.endsWith('logo.png')).accept, 'application/vnd.github.raw+json');
    assert.ok(!log.urls.some((u) => u.includes(TOKEN)));
    // Gespeichert für offline: Base64, Commit, Zeitpunkt – ohne Token
    const st = await page.evaluate(() => JSON.parse(localStorage.getItem('aether.logoPng')));
    assert.deepEqual(Object.keys(st).sort(), ['geladen', 'png', 'sha']);
    assert.equal(sha256(Buffer.from(st.png, 'base64')), sha256(PNG));
    await page.screenshot({ path: path.join(OUT, 'logo-png-1194x834.png'), fullPage: true });
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(b) Seitenverhältnis bleibt erhalten (1874 × 681 und hochkant 400 × 500)', async () => {
    for (const [png, w, h] of [[PNG, 1874, 681], [PNG_HOCH, 400, 500]]) {
      const { context, page, log } = await newPage();
      mock.png = png;
      await openLogo(page);
      await pngGeladen(page);
      assertSeiten(await magentaIn(page, '#pngBuehne'), w, h, `Logo-Werkzeug ${w}×${h}`);
      assert.equal(await text(page, '#pngQuelle'), `Quelle: game/assets/ui/logo.png · Commit fedcba9 · ${w} × ${h} px · ${kb(png.length)}`);
      assert.deepEqual(log.errors, []);
      await context.close();
    }
  });

  test('(c) „PNG sichern (Original)“ gibt die Originalbytes unverändert über den Teilen-Dialog aus; nur mit Nutzergeste', async () => {
    const { context, page, log } = await newPage({ init: { fn: shareMock } });
    await openLogo(page);
    await page.waitForFunction(() => !document.getElementById('btnPngOriginal').disabled);
    assert.equal(await text(page, '#btnPngOriginal'), 'PNG sichern (Original)');
    await page.evaluate(() => document.getElementById('btnPngOriginal').click());
    assert.equal(await page.evaluate(() => window.__share.calls.length), 0, 'Skript-Klick löst nichts aus');
    await page.click('#btnPngOriginal');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const c = await page.evaluate(() => window.__share.calls[0]);
    assert.equal(c.active, true, 'innerhalb der Nutzergeste');
    assert.equal(c.title, 'Aether – Logo', 'derselbe Weg wie die anderen Sichern-Knöpfe');
    assert.deepEqual(c.files.map((f) => [f.name, f.type, f.bytes, f.sha]), [['aether-logo-fedcba9-original.png', 'image/png', PNG.length, sha256(PNG)]]);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(d) Hintergrund-Schalter wirkt auf beide Vorschauen', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    for (const [k, farbe] of [['hell', 'rgb(244, 242, 251)'], ['kariert', 'rgb(255, 255, 255)'], ['dunkel', 'rgb(3, 4, 10)']]) {
      await page.click(`#hintergrund [data-bg="${k}"]`);
      const bg = await page.evaluate(() => ['buehne', 'pngBuehne'].map((id) => { const e = document.getElementById(id); return [e.dataset.bg, getComputedStyle(e).backgroundColor, getComputedStyle(e).backgroundImage !== 'none']; }));
      assert.deepEqual(bg, [[k, farbe, k === 'kariert'], [k, farbe, k === 'kariert']], `beide „${k}“`);
    }
    assert.equal(await page.$$eval('.seg#hintergrund', (s) => s.length), 1, 'ein Schalter für beide');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  for (const art of ['fehler', 'offline']) {
    test(`(e) ${art === 'fehler' ? 'Fehler (HTTP 500)' : 'offline'} nur beim PNG: Meldung in der PNG-Karte, SVG-Karte funktioniert`, async () => {
      const { context, page, log } = await newPage({ init: { fn: shareMock } });
      mock.pngMode = art;
      await openLogo(page);
      assert.equal(await page.evaluate(() => window.AetherLogo.stand()), 'online', 'SVG geladen');
      assert.equal(await page.evaluate(() => window.AetherLogo.pngStand()), art === 'fehler' ? 'fehler' : 'offline-leer');
      if (art === 'fehler') {
        assert.ok(await page.isVisible('#pngHinweis'));
        assert.equal(await page.$eval('#pngHinweis', (e) => e.className), 'hinweis', 'Stil der bestehenden Fehlermeldungen');
        assert.equal(await text(page, '#pngHinweis b'), 'GitHub hat gerade Probleme (HTTP 500).');
        assert.equal(await text(page, '#pngLeer'), 'Kein Logo-Bild verfügbar.');
      } else {
        assert.equal(await text(page, '#pngLeer'), 'Noch kein Logo-Bild geladen – einmal online öffnen.');
      }
      assert.ok(await page.isHidden('#pngBild'));
      assert.equal(await text(page, '#pngQuelle'), '');
      assert.equal(await page.isDisabled('#btnPngOriginal'), true);
      // SVG-Karte unabhängig: Bild, Quellzeile, kein Hinweis, Sichern geht
      assert.ok(await page.isHidden('#hinweis'));
      assert.match(await text(page, '#quelle'), /^Quelle: art\/logo\/logo\.svg · Commit 1234567 · geladen /);
      await page.waitForFunction(() => { const i = document.getElementById('logoBild'); return !i.hidden && i.complete && i.naturalWidth > 0; });
      await page.click('#btnSvg');
      await page.waitForFunction(() => window.__share.calls.length === 1);
      assert.equal(await page.evaluate(() => window.__share.calls[0].files[0].sha), sha256(SVG));
      assert.deepEqual(echteFehler(log), []);
      await context.close();
    });
  }

  test('(e) ganz offline nach einmaligem Laden: beide Karten aus dem Gerätespeicher mit Offline-Hinweis', async () => {
    const { context, page, log } = await newPage({ init: { fn: shareMock } });
    await openLogo(page);
    await pngGeladen(page);
    mock.mode = 'offline';
    await page.reload();
    await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() !== 'laden' && window.AetherLogo.pngStand() !== 'laden');
    assert.deepEqual(await page.evaluate(() => [window.AetherLogo.stand(), window.AetherLogo.pngStand()]), ['offline', 'offline']);
    assert.equal(await text(page, '#pngHinweis'), 'Offline – zuletzt geladene Fassung');
    await pngGeladen(page);
    assert.equal(await text(page, '#pngQuelle'), `Quelle: game/assets/ui/logo.png · Commit fedcba9 · 1874 × 681 px · ${kb(PNG.length)}`);
    await page.click('#btnPngOriginal');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    assert.equal(await page.evaluate(() => window.__share.calls[0].files[0].sha), sha256(PNG), 'offline byte-gleich');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('ohne Token: auch für das PNG keine Anfrage', async () => {
    const { context, page, log } = await newPage({ withToken: false });
    await openLogo(page);
    assert.equal(await page.evaluate(() => window.AetherLogo.pngStand()), 'notoken');
    assert.equal(mock.requests.length, 0);
    assert.equal(await text(page, '#pngLeer'), 'Noch kein Logo-Bild geladen – einmal online öffnen.');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('(h) iPhone hochkant: Karten untereinander, kein waagerechtes Scrollen, Tippflächen ≥ 44 px', async () => {
    for (const viewport of [{ width: 402, height: 874 }, { width: 375, height: 667 }, { width: 320, height: 568 }]) {
      const { context, page, log } = await newPage({ viewport, device: { deviceScaleFactor: 3, isMobile: true, hasTouch: true } });
      await openLogo(page);
      await pngGeladen(page);
      const m = await page.evaluate(() => {
        const r = (id) => document.getElementById(id).getBoundingClientRect().toJSON();
        return { sw: document.documentElement.scrollWidth, W: window.innerWidth, svg: r('logoKarte'), png: r('pngKarte'), ebenen: r('ebenenKarte'),
          ziele: [...document.querySelectorAll('#pngKarte button, #pngKarte a')].map((e) => e.getBoundingClientRect().toJSON()),
          karten: [...document.querySelectorAll('.karte')].map((k) => k.scrollWidth - k.clientWidth) };
      });
      const label = `${viewport.width}×${viewport.height}`;
      assert.ok(m.sw <= m.W, `${label}: kein waagerechtes Scrollen (${m.sw} > ${m.W})`);
      for (const o of m.karten) assert.ok(o <= 0, `${label}: Karte läuft nicht über`);
      assert.ok(m.png.top >= m.svg.bottom && m.ebenen.top >= m.png.bottom, `${label}: untereinander`);
      for (const k of [m.svg, m.png, m.ebenen]) assert.ok(k.left >= 0 && k.right <= m.W + 0.5, `${label}: Karte im Fenster`);
      for (const z of m.ziele) assert.ok(z.width >= 44 && z.height >= 44 && z.right <= m.W + 0.5, `${label}: Tippfläche ${z.width}×${z.height}`);
      assertSeiten(await magentaIn(page, '#pngBuehne'), 1874, 681, label);
      if (viewport.width === 402) await page.screenshot({ path: path.join(OUT, 'logo-png-iphone-hoch.png'), fullPage: true });
      assert.deepEqual(log.errors, []);
      await context.close();
    }
  });
});

// ---------------------------------------------------------------------------
describe('Screen-Editor: Logo/Menübox mit logo.png', () => {
  // Box-Maße und Lage der Logo-Box (Rechnung und gezeichnetes Element)
  const boxMasse = (page) => page.evaluate(() => ({ e: window.AetherScreenEditor.elemente('desktop').logo, r: document.getElementById('logoEl').getBoundingClientRect().toJSON() }));

  test('(f) Logo-Box zeigt Pixel des Bildes: mittig, Seitenverhältnis erhalten, so groß wie möglich; Box-Maße unverändert; eine Anfrage', async () => {
    // Bezug: Box-Maße mit der Annäherung (ohne Token, also ohne Bild)
    const ohne = await newPage({ viewport: { width: 1280, height: 800 }, withToken: false });
    await openEditor(ohne.page);
    assert.equal(await ohne.page.evaluate(() => window.AetherScreenEditor.logoBild()), 'annaeherung');
    const bezug = await boxMasse(ohne.page);
    assert.equal(mock.requests.length, 0, 'ohne Token keine Anfrage');
    await ohne.context.close();

    for (const [png, w, h] of [[PNG, 1874, 681], [PNG_HOCH, 400, 500]]) {
      const { context, page, log } = await newPage({ viewport: { width: 1280, height: 800 } });
      mock.png = png;
      await openEditor(page);
      assert.equal(await page.evaluate(() => window.AetherScreenEditor.logoBild()), 'bild');
      await editorBildGeladen(page);
      assert.deepEqual(await boxMasse(page), bezug, 'Box-Maße und Lage unverändert');
      assert.ok(await page.isHidden('#logoHinweis'), 'kein Hinweis mit Bild');
      assert.equal(await page.$$eval('#logoEl svg', (s) => s.length), 0, 'keine Annäherung');
      const m = await magentaIn(page, '#logoEl');
      const label = `Bühne ${w}×${h}`;
      assertSeiten(m, w, h, label);
      // so groß wie die Box es zulässt (Breite oder Höhe füllt die Box) und mittig
      const fuellt = Math.abs(m.w - m.elW) <= 2 || Math.abs(m.h - m.elH) <= 2;
      assert.ok(fuellt, `${label}: füllt die Box in einer Richtung (${m.w.toFixed(1)}×${m.h.toFixed(1)} in ${m.elW.toFixed(1)}×${m.elH.toFixed(1)})`);
      assert.ok(Math.abs((m.x0 + m.x1) / 2 - m.elW / 2) <= 1.5 && Math.abs((m.y0 + m.y1) / 2 - m.elH / 2) <= 1.5, `${label}: mittig`);
      // Vergleich (Canvas, derselbe Weg wie „Als Bild sichern“)
      await page.click('#untenWahl [data-u="vergleich"]');
      await page.waitForFunction(() => { const cv = document.querySelector('#vergleich figure[data-k="desktop"] canvas'); if (!cv.width) return false;
        const d = cv.getContext('2d').getImageData(0, 0, cv.width, cv.height).data; for (let i = 0; i < d.length; i += 4) if (d[i] > 225 && d[i + 1] < 45 && d[i + 2] > 225) return true; return false; });
      assertSeiten(await magentaImCanvas(page, '#vergleich figure[data-k="desktop"] canvas'), w, h, `Vergleich ${w}×${h}`, 0.06);
      // Genau eine Anfrage (die Datei selbst, roh, mit Token)
      assert.deepEqual(mock.requests.map((q) => [q.path, q.accept, q.auth]), [[`${BASE}/contents/game/assets/ui/logo.png`, 'application/vnd.github.raw+json', `Bearer ${TOKEN}`]]);
      // Das Bild kommt nicht in die gespeicherten Screens und nicht in den Export
      await page.click('#btnZufall');
      const gespeichert = await page.evaluate(() => localStorage.getItem('aether.screenEditor'));
      assert.ok(gespeichert && !/iVBORw0|data:image|logoPng|blob:/.test(gespeichert), 'kein Bild in den Screen-Daten');
      assert.ok(!JSON.stringify(await page.evaluate(() => window.AetherScreenEditor.zustand())).includes('iVBORw0'));
      if (w === 1874) await page.screenshot({ path: path.join(OUT, 'editor-logo-png.png') });
      assert.deepEqual(log.errors, []);
      await context.close();
    }
  });

  test('(f) Ziehen der Logo-Box funktioniert mit Bild wie vorher', async () => {
    const { context, page, log } = await newPage({ viewport: { width: 1280, height: 800 } });
    await openEditor(page);
    await editorBildGeladen(page);
    await page.check('#layoutEdit');
    const r0 = await page.$eval('#logoEl', (e) => e.getBoundingClientRect().toJSON());
    await page.mouse.move(r0.x + r0.width / 2, r0.y + r0.height / 2);
    await page.mouse.down();
    await page.mouse.move(r0.x + r0.width / 2 + 40, r0.y + r0.height / 2 + 20, { steps: 4 });
    await page.mouse.up();
    const r1 = await page.$eval('#logoEl', (e) => e.getBoundingClientRect().toJSON());
    assert.ok(Math.abs(r1.x - r0.x - 40) <= 1.5 && Math.abs(r1.y - r0.y - 20) <= 1.5, `verschoben (${r1.x - r0.x}, ${r1.y - r0.y})`);
    assert.ok(Math.abs(r1.width - r0.width) < 0.5 && Math.abs(r1.height - r0.height) < 0.5, 'Größe gleich');
    const lage = await page.evaluate(() => window.AetherScreenEditor.zustand().screens[0].lage.logo);
    assert.ok(lage.x !== 0 && lage.y !== 0, 'Lage gespeichert');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  for (const art of ['fehler', 'offline', 'ohne Token']) {
    test(`(f) Bild nicht ladbar (${art}): Annäherung wie bisher und Hinweis „Logo-Bild nicht geladen – Annäherung“`, async () => {
      const { context, page, log } = await newPage({ viewport: { width: 1280, height: 800 }, withToken: art !== 'ohne Token' });
      if (art === 'fehler') mock.pngMode = 'fehler';
      if (art === 'offline') mock.mode = 'offline';
      await openEditor(page);
      assert.equal(await page.evaluate(() => window.AetherScreenEditor.logoBild()), 'annaeherung');
      assert.equal(await page.$$eval('#logoEl svg', (s) => s.length), 1, 'Annäherung (SVG) in der Box');
      assert.equal(await page.$$eval('#logoEl img', (s) => s.length), 0, 'kein (kaputtes) Bild');
      assert.ok(await page.isVisible('#logoHinweis'));
      assert.equal(await text(page, '#logoHinweis'), 'Logo-Bild nicht geladen – Annäherung');
      assert.equal(await page.$eval('#logoHinweis', (e) => e.className), 'note', 'gedämpft');
      // Annäherung ist zu sehen (Schrift-Verlauf der Annäherung: helle Lila-Pixel in der Box), kein Magenta
      assert.equal(await magentaIn(page, '#logoEl'), null);
      const lila = await page.$eval('#logoEl svg', (s) => s.getBoundingClientRect().width > 0 && s.querySelectorAll('text').length === 2);
      assert.ok(lila, 'Annäherung gezeichnet');
      // Der Hinweis steht im Bedienfeld, nicht auf der Bühne
      assert.equal(await page.$eval('#overlay', (o) => o.textContent.includes('Annäherung')), false);
      assert.deepEqual(echteFehler(log), []);
      await context.close();
    });
  }

  test('(f) offline mit der vom Logo-Werkzeug gespeicherten Fassung: Bild statt Annäherung', async () => {
    const { context, page, log } = await newPage({ viewport: { width: 1280, height: 800 } });
    await openLogo(page);
    await pngGeladen(page);
    mock.mode = 'offline';
    await openEditor(page);
    assert.equal(await page.evaluate(() => window.AetherScreenEditor.logoBild()), 'bild');
    await editorBildGeladen(page);
    assertSeiten(await magentaIn(page, '#logoEl'), 1874, 681, 'offline');
    assert.ok(await page.isHidden('#logoHinweis'));
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });
});
