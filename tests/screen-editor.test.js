// Tests für die Tools-Karte der Projektansicht und den Screen-Editor (screen-editor.html):
// Lage und Umbruch der Karte, Offline-Verhalten mit Service Worker, keine externen Anfragen, Anordnung mit
// Trennleisten (keine Überlappung), Regel C rechnerisch, „Ränder füllen“, Import der Versionen 1 und 2,
// Bild-Export. Aufruf: node --test tests/screen-editor.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const PAGE = 'screen-editor.html';
const THREE_FILE = 'vendor/three-r128.min.js';
const THREE_SHA256 = '9274bbcec8d96168626c732b5d31c775aa8cfb7eaa0599bec0c175908a2c1ce2'; // npm three@0.128.0 build/three.min.js
const PROFILE_URL = 'https://github.com/konstantin9ezm/aether/actions/workflows/profile.yml';
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Statischer Server (kann „kein Netz“ spielen: Verbindungen werden gekappt)
// ---------------------------------------------------------------------------
const net = { offline: false, requests: [] };
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8' };
let server, baseUrl, browser;

before(async () => {
  server = http.createServer((req, res) => {
    if (net.offline) { req.socket.destroy(); return; }
    const u = new URL(req.url, 'http://x');
    net.requests.push(u.pathname);
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

// Kein Token: die Projektansicht macht dann keine API-Aufrufe (die Tools-Karte braucht keine).
async function newPage(opts = {}) {
  const { viewport = { width: 1280, height: 800 }, device = {}, init } = opts;
  net.offline = false; // falls ein vorheriger Test mitten im Offline-Teil abgebrochen ist
  const context = await browser.newContext({ viewport, ...device, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const log = { urls: [], errors: [], console: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  context.on('request', (r) => log.urls.push(r.url()));
  // Alles außer dem eigenen Server wird abgebrochen (und mitgeschrieben).
  await context.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  if (init) await context.addInitScript(init.fn, init.arg);
  return { context, page, log };
}
const editorUrl = () => baseUrl + PAGE;
async function openEditor(page) {
  await page.goto(editorUrl());
  await page.waitForFunction(() => !!window.AetherScreenEditor);
}
const rect = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, w: r.width, h: r.height }; });
const overlaps = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0) > 0.5 && Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0) > 0.5;
const inside = (a, b, tol = 0.5) => a.x0 >= b.x0 - tol && a.x1 <= b.x1 + tol && a.y0 >= b.y0 - tol && a.y1 <= b.y1 + tol;

// ---------------------------------------------------------------------------
// Tools-Karte
// ---------------------------------------------------------------------------
describe('Tools-Karte', () => {
  test('liegt zwischen Stand-Zeile und Build-Ampel; Ziele der Knöpfe; Logo nicht antippbar', async () => {
    const { context, page, log } = await newPage();
    await page.goto(baseUrl + '#projekt');
    await page.waitForSelector('#projectView:not([hidden])');
    // DOM-Reihenfolge und Lage auf dem Bildschirm
    const order = await page.evaluate(() => {
      const head = document.querySelector('#projectView .proj-head'), tools = document.getElementById('toolsCard'), ci = document.getElementById('ciCard');
      const after = (a, b) => !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
      return { headBeforeTools: after(head, tools), toolsBeforeCi: after(tools, ci), inGrid: !!tools.closest('#projGrid'), title: tools.querySelector('h2').textContent,
        cls: tools.className, ciCls: ci.className };
    });
    assert.deepEqual(order, { headBeforeTools: true, toolsBeforeCi: true, inGrid: false, title: 'Tools', cls: 'card', ciCls: 'card' });
    const head = await rect(page, '#projectView .proj-head'), tools = await rect(page, '#toolsCard'), ci = await rect(page, '#ciCard');
    assert.ok(tools.y0 >= head.y1 - 0.5, `Tools unter der Stand-Zeile (${tools.y0} ≥ ${head.y1})`);
    assert.ok(tools.y1 <= ci.y0 + 0.5, `Tools über der Build-Ampel (${tools.y1} ≤ ${ci.y0})`);
    // gleicher Kartenstil wie die Ampel
    const style = await page.evaluate(() => ['toolsCard', 'ciCard'].map((id) => { const c = getComputedStyle(document.getElementById(id)); return [c.backgroundColor, c.borderTopWidth, c.borderRadius, c.paddingTop].join(' '); }));
    assert.equal(style[0], style[1], 'gleicher Kartenstil');

    const btns = await page.$$eval('#tools > *', (es) => es.map((e) => ({ id: e.id, tag: e.tagName, text: e.textContent.replace(/\s+/g, ' ').trim(),
      href: e.getAttribute('href'), target: e.getAttribute('target'), rel: e.getAttribute('rel'), disabled: e.disabled === true, aria: e.getAttribute('aria-disabled'), cls: e.className })));
    assert.deepEqual(btns.map((b) => b.text), ['Screen-Editor ›', 'Messflug ›', 'Logo geplant', 'WebGPU-Check ›']);
    assert.deepEqual(btns.map((b) => b.cls), ['btn', 'btn', 'btn', 'btn'], 'Knopfstil wie „Aktualisieren“');
    assert.equal(await page.getAttribute('#projReload', 'class'), 'btn');
    const [ed, prof, logo, gpu] = btns;
    assert.deepEqual([ed.tag, ed.href, ed.target], ['A', 'screen-editor.html', null], 'Screen-Editor im selben Fenster');
    assert.deepEqual([prof.tag, prof.href, prof.target], ['A', PROFILE_URL, '_blank'], 'Messflug in neuem Tab');
    assert.deepEqual(prof.rel.split(/\s+/).sort(), ['noopener', 'noreferrer']);
    assert.deepEqual([gpu.tag, gpu.href, gpu.target], ['A', 'webgpu-check.html', null], 'WebGPU-Check im selben Fenster');
    assert.deepEqual([logo.tag, logo.disabled, logo.aria, logo.href], ['BUTTON', true, 'true', null], 'Logo: ausgegraut, nicht antippbar');
    assert.ok(Number(await page.$eval('#toolLogo', (e) => getComputedStyle(e).opacity)) < 0.6, 'Logo sichtbar grau');
    // Antippen des Platzhalters ändert nichts
    const urlBefore = page.url();
    await page.click('#toolLogo', { force: true });
    await page.waitForTimeout(200);
    assert.equal(page.url(), urlBefore);
    // Kopfzeilen-Symbol „WebGPU-Check“ unverändert vorhanden
    assert.equal(await page.getAttribute('#hdrWebgpu', 'href'), 'webgpu-check.html');

    // Screen-Editor öffnet im selben Fenster, „Zum Dashboard“ führt zurück in die Projektansicht.
    await page.click('#toolEditor');
    await page.waitForURL(/screen-editor\.html$/);
    await page.waitForFunction(() => !!window.AetherScreenEditor);
    assert.equal(context.pages().length, 1, 'kein neuer Tab');
    const back = await page.$eval('#zumDashboard', (a) => ({ href: a.getAttribute('href'), text: a.textContent.trim(), r: a.getBoundingClientRect().toJSON() }));
    assert.deepEqual([back.href, back.text], ['./#projekt', '‹ Zum Dashboard']);
    assert.ok(back.r.height >= 44 && back.r.width >= 44 && back.r.top < 80, `deutlich sichtbar oben: ${JSON.stringify(back.r)}`);
    await page.click('#zumDashboard');
    await page.waitForSelector('#projectView:not([hidden])');
    assert.match(page.url(), /#projekt$/);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Knöpfe brechen um statt waagerecht zu scrollen (320–1400 px), Tippflächen ≥ 44 × 44 px', async () => {
    const { context, page, log } = await newPage({ viewport: { width: 320, height: 700 } });
    await page.goto(baseUrl + '#projekt');
    await page.waitForSelector('#projectView:not([hidden])');
    for (const w of [320, 360, 375, 390, 414, 480, 600, 768, 834, 900, 1024, 1180, 1280, 1400]) {
      await page.setViewportSize({ width: w, height: 800 });
      await page.waitForTimeout(50);
      const m = await page.evaluate(() => {
        const card = document.getElementById('toolsCard').getBoundingClientRect();
        const bs = [...document.querySelectorAll('#tools > *')].map((e) => e.getBoundingClientRect());
        return { overflow: document.documentElement.scrollWidth - window.innerWidth, cardOverflow: document.getElementById('toolsCard').scrollWidth - document.getElementById('toolsCard').clientWidth,
          card: { x0: card.left, x1: card.right }, bs: bs.map((r) => ({ x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, w: r.width, h: r.height })) };
      });
      assert.ok(m.overflow <= 0, `${w}px: kein waagerechtes Scrollen (${m.overflow})`);
      assert.ok(m.cardOverflow <= 0, `${w}px: Karte läuft nicht über`);
      for (const b of m.bs) {
        assert.ok(b.w >= 44 && b.h >= 44, `${w}px: Tippfläche ${b.w}×${b.h}`);
        assert.ok(b.x0 >= m.card.x0 && b.x1 <= m.card.x1, `${w}px: Knopf in der Karte`);
      }
      for (let i = 0; i < m.bs.length; i++) for (let j = i + 1; j < m.bs.length; j++) assert.ok(!overlaps(m.bs[i], m.bs[j]), `${w}px: Knöpfe ${i}/${j} überlappen`);
      const rows = new Set(m.bs.map((b) => Math.round(b.y0))).size;
      if (w === 320) assert.ok(rows >= 2, '320px: Umbruch in eine neue Zeile');
      if (w >= 900) assert.equal(rows, 1, `${w}px: alle in einer Zeile`);
      if (w === 320 || w === 1400) await (await page.$('#toolsCard')).screenshot({ path: path.join(OUT, `tools-karte-${w}.png`) });
    }
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Offline: Karte sichtbar, Messflug und WebGPU-Check ausgegraut, Screen-Editor startet aus dem Service Worker', async () => {
    net.offline = false;
    const { context, page, log } = await newPage({ viewport: { width: 1194, height: 834 } });
    await page.goto(baseUrl);
    const swReady = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]));
    assert.ok(swReady, 'Service Worker aktiv');
    const keys = await page.evaluate(async () => (await (await caches.open('aether-shell-v1')).keys()).map((r) => new URL(r.url).pathname));
    for (const p of ['/screen-editor.html', '/' + 'vendor/three-r128.min.js']) assert.ok(keys.includes(p), `${p} in der App-Hülle: ${keys.join(', ')}`);

    // Online: alle aktiv
    await page.click('#tabProject');
    await page.waitForSelector('#projectView:not([hidden])');
    assert.equal(await page.getAttribute('#toolProfile', 'aria-disabled'), null);
    assert.equal(await page.getAttribute('#toolWebgpu', 'href'), 'webgpu-check.html');

    // Netz weg
    net.offline = true;
    await context.setOffline(true);
    await page.reload(); // Adresse steht auf …#projekt
    await page.waitForSelector('#projOffline:not([hidden])');
    for (const id of ['ciCard', 'timelineCard', 'roadmapCard']) assert.ok(await page.isHidden('#' + id), `übrige Karten: nur der Hinweis (${id} aus)`);
    await page.waitForSelector('#engineCard #engineBody .chip');
    assert.equal((await page.$$('#engineBody .chip')).length, 20, 'Engine-Karte aus der App-Hülle');
    assert.ok(await page.isVisible('#toolsCard'), 'Tools-Karte bleibt sichtbar');
    for (const id of ['toolProfile', 'toolWebgpu']) {
      const s = await page.$eval('#' + id, (a) => ({ href: a.getAttribute('href'), aria: a.getAttribute('aria-disabled'), text: a.textContent.replace(/\s+/g, ' ').trim(), op: Number(getComputedStyle(a).opacity), pe: getComputedStyle(a).pointerEvents }));
      assert.equal(s.href, null, `${id}: kein Ziel offline`);
      assert.equal(s.aria, 'true');
      assert.match(s.text, /nur online$/);
      assert.ok(s.op < 0.6 && s.pe === 'none', `${id}: ausgegraut`);
    }
    assert.equal(await page.getAttribute('#toolEditor', 'href'), 'screen-editor.html', 'Screen-Editor bleibt offline aktiv');
    await page.screenshot({ path: path.join(OUT, 'tools-offline.png') });

    // Screen-Editor startet ohne Netz aus dem Service Worker (Seite und three.js)
    const before = net.requests.length;
    await page.click('#toolEditor');
    await page.waitForURL(/screen-editor\.html$/);
    await page.waitForFunction(() => !!window.AetherScreenEditor && typeof window.THREE === 'object' && window.THREE.REVISION === '128');
    assert.equal(net.requests.length, before, 'nichts vom Server geladen');
    await page.click('#btnZufall');
    assert.match(await page.textContent('#zaehler'), /12 Asteroiden/);
    assert.equal(await page.textContent('#speicher'), 'Wird auf diesem Gerät gespeichert.');
    await page.click('#zumDashboard');
    await page.waitForSelector('#projectView:not([hidden])');
    assert.ok(await page.isVisible('#toolsCard'));

    // Netz wieder da: Knöpfe wieder aktiv
    net.offline = false;
    await context.setOffline(false);
    await page.waitForFunction(() => document.getElementById('toolProfile').getAttribute('aria-disabled') === null);
    assert.equal(await page.getAttribute('#toolProfile', 'href'), PROFILE_URL);
    assert.equal(await page.textContent('#toolWebgpu'), 'WebGPU-Check ›');
    assert.deepEqual(log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource/.test(e)), []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Screen-Editor: Dateien, Netz, Speichern
// ---------------------------------------------------------------------------
describe('Screen-Editor: Dateien und Netz', () => {
  test('keine externen Adressen, kein Token, keine GitHub-API; three.js r128 im Repo mit Lizenz; Hülle und Workflow', () => {
    const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
    assert.doesNotMatch(html, /https?:\/\//i, 'keine absoluten Adressen (CDN, Schriften, APIs)');
    assert.doesNotMatch(html, /api\.github|githubToken|github_pat_|Authorization|aether\.githubToken/i, 'kein Token, keine GitHub-API');
    assert.doesNotMatch(html, /window\.claude|\.use\('db'\)|downloads\.save/, 'keine Teile für das Claude-Konto');
    assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket|<link[^>]+stylesheet/i, 'nichts nachladen');
    const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
    assert.deepEqual(scripts, [THREE_FILE]);
    const three = fs.readFileSync(path.join(ROOT, THREE_FILE));
    assert.equal(crypto.createHash('sha256').update(three).digest('hex'), THREE_SHA256, 'three.js entspricht der veröffentlichten r128');
    assert.match(three.slice(0, 200).toString(), /@license[\s\S]*SPDX-License-Identifier: MIT/);
    const lic = fs.readFileSync(path.join(ROOT, 'vendor/three-r128.LICENSE.txt'), 'utf8');
    assert.match(lic, /The MIT License/);
    assert.match(lic, /three@0\.128\.0/);
    assert.match(lic, new RegExp(THREE_SHA256));
    assert.match(fs.readFileSync(path.join(ROOT, 'vendor/Jost-OFL.txt'), 'utf8'), /SIL Open Font License/);
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const shell = /var SHELL = \[([^\]]*)\]/.exec(sw)[1];
    assert.match(shell, /'screen-editor\.html'/);
    assert.match(shell, /'vendor\/three-r128\.min\.js'/);
    assert.match(sw, /var SHELL_CACHE = 'aether-shell-v1';/, 'Cache-Name unverändert');
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8');
    assert.match(wf, /cp [^\n]*screen-editor\.html[^\n]*_site\//);
    assert.match(wf, /cp [^\n]*vendor\/three-r128\.min\.js[^\n]*_site\/vendor\//);
  });

  test('lädt nur eigene Dateien, keine Anfrage an api.github.com; Speichern nur auf dem Gerät', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    await page.click('#btnZufall');
    await page.click('#untenWahl [data-u="vergleich"]');
    await page.waitForTimeout(400);
    await page.click('#btnText');
    await page.click('#mBtns button:has-text("Schließen")');
    const own = log.urls.filter((u) => !/^(data|blob):/.test(u));
    assert.ok(own.every((u) => u.startsWith(baseUrl)), `nur eigener Ursprung: ${own.filter((u) => !u.startsWith(baseUrl)).join(', ')}`);
    assert.ok(!log.urls.some((u) => u.includes('api.github.com')));
    assert.deepEqual([...new Set(own.map((u) => new URL(u).pathname))].sort(), ['/screen-editor.html', '/' + THREE_FILE].sort());
    assert.equal(await page.textContent('#speicher'), 'Wird auf diesem Gerät gespeichert.');
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem('aether.screenEditor')));
    assert.equal(stored.screens[0].asteroiden.length, 12);
    assert.equal(await page.evaluate(() => localStorage.getItem('aether.githubToken')), null);
    await page.reload();
    await page.waitForFunction(() => !!window.AetherScreenEditor);
    assert.match(await page.textContent('#zaehler'), /12 Asteroiden/, 'nach Neuladen noch da');
    // Logo-Schrift (Jost, eingebettet) ist geladen
    assert.ok(await page.evaluate(() => document.fonts.check('500 40px "Jost Aether"')));
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Speicher gesperrt: Editor startet trotzdem, Hinweis statt Fehler', async () => {
    const { context, page, log } = await newPage({ init: { fn: () => {
      const no = () => { throw new DOMException('gesperrt', 'SecurityError'); };
      Object.defineProperty(window, 'localStorage', { get: no, configurable: true });
    } } });
    await openEditor(page);
    await page.click('#btnZufall');
    assert.match(await page.textContent('#speicher'), /nicht möglich/);
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Anordnung: keine Überlappung, Trennleisten
// ---------------------------------------------------------------------------
const LAYOUTS = [
  { name: 'iPhone 16 Pro hoch', viewport: { width: 402, height: 874 }, device: { deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'iPhone 16 Pro quer', viewport: { width: 874, height: 402 }, device: { deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'iPad quer', viewport: { width: 1194, height: 834 }, device: { deviceScaleFactor: 2, isMobile: true, hasTouch: true }, b: true },
  { name: 'iPad hoch', viewport: { width: 834, height: 1194 }, device: { deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: 'Desktop 1280×800', viewport: { width: 1280, height: 800 }, b: true },
  { name: 'schmal 360×700', viewport: { width: 360, height: 700 } },
  { name: 'schmal 600×800', viewport: { width: 600, height: 800 } }
];
async function layoutRects(page) {
  return page.evaluate(() => {
    const box = (e) => { if (!e || e.hidden) return null; const cs = getComputedStyle(e); if (cs.display === 'none' || cs.visibility === 'hidden') return null; const r = e.getBoundingClientRect(); return r.width > 0 && r.height > 0 ? { x0: r.left, x1: r.right, y0: r.top, y1: r.bottom, w: r.width, h: r.height } : null; };
    const out = {}, inner = {};
    for (const id of ['kopf', 'stage', 'leiste', 'trennerB', 'unten', 'trennerP', 'panel']) { const b = box(document.getElementById(id)); if (b) out[id] = b; }
    for (const id of ['modus', 'griffA', 'mini', 'frame', 'untenWahl', 'vergleich', 'zumDashboard']) { const b = box(document.getElementById(id)); if (b) inner[id] = b; }
    return { out, inner, W: window.innerWidth, H: window.innerHeight, sw: document.documentElement.scrollWidth, sh: document.documentElement.scrollHeight, b: document.getElementById('ansichten').classList.contains('b') };
  });
}
function assertNoOverlap(m, label) {
  const ids = Object.keys(m.out);
  for (const id of ['kopf', 'stage', 'leiste', 'unten', 'panel']) assert.ok(m.out[id], `${label}: ${id} sichtbar`);
  for (let i = 0; i < ids.length; i++) {
    assert.ok(inside(m.out[ids[i]], { x0: 0, x1: m.W, y0: 0, y1: m.H }), `${label}: ${ids[i]} im Fenster ${JSON.stringify(m.out[ids[i]])}`);
    for (let j = i + 1; j < ids.length; j++) assert.ok(!overlaps(m.out[ids[i]], m.out[ids[j]]), `${label}: ${ids[i]} überlappt ${ids[j]}: ${JSON.stringify([m.out[ids[i]], m.out[ids[j]]])}`);
  }
  assert.ok(m.sw <= m.W && m.sh <= m.H, `${label}: kein Seiten-Scrollen (${m.sw}×${m.sh})`);
  assert.ok(inside(m.inner.modus, m.out.leiste), `${label}: Umschalter in der Leiste`);
  assert.ok(inside(m.inner.frame, m.out.stage), `${label}: Bild in der Bühne`);
  if (m.inner.mini) assert.ok(inside(m.inner.mini, m.out.unten), `${label}: Draufsicht im unteren Bereich, nicht über der Bühne`);
  if (m.inner.vergleich) assert.ok(inside(m.inner.vergleich, m.out.unten), `${label}: Vergleich im unteren Bereich`);
  assert.ok(inside(m.inner.untenWahl, m.out.unten), `${label}: Umschalter Draufsicht/Vergleich im unteren Bereich`);
  assert.ok(m.out.stage.h >= 100 && m.out.stage.w >= 150, `${label}: Bühne bedienbar groß (${m.out.stage.w}×${m.out.stage.h})`);
  assert.ok(m.out.unten.h >= 90 && m.out.unten.w >= 150, `${label}: unterer Bereich bedienbar groß (${m.out.unten.w}×${m.out.unten.h})`);
  assert.ok(m.out.panel.h >= 120, `${label}: Bedienfeld bedienbar groß (${m.out.panel.h})`);
  for (const id of ['leiste', 'trennerB', 'trennerP']) if (m.out[id]) assert.ok(Math.min(m.out[id].w, m.out[id].h) >= 44, `${label}: ${id} Tippfläche ≥ 44 px`);
}

describe('Screen-Editor: Anordnung', () => {
  for (const L of LAYOUTS) {
    test(`keine Überlappung von Bühne, Trennleisten, unterem Bereich und Bedienfeld (${L.name})`, async () => {
      for (const anordnung of ['A', 'B']) {
        for (const unten of ['karte', 'vergleich']) {
          const { context, page, log } = await newPage({ viewport: L.viewport, device: L.device, init: { fn: (a) => { try { localStorage.setItem('aether.screenEditor.layout', JSON.stringify(a)); } catch (e) {} }, arg: { anordnung, unten } } });
          await openEditor(page);
          await page.waitForTimeout(250);
          const m = await layoutRects(page);
          const label = `${L.name}, ${anordnung}, ${unten}`;
          assertNoOverlap(m, label);
          const tasten = await page.$$eval('#modus button, #untenWahl button, #zumDashboard', (es) => es.map((e) => { const r = e.getBoundingClientRect(); return [e.textContent.trim(), r.width, r.height]; }));
          for (const [t, w, h] of tasten) assert.ok(w >= 44 && h >= 36, `${label}: „${t}“ ${w}×${h}`);
          const wantB = anordnung === 'B' && !!L.b;
          assert.equal(m.b, wantB, `${label}: Nebeneinander ${wantB ? 'wirksam' : 'fällt auf Untereinander zurück'}`);
          if (wantB) {
            assert.ok(m.out.trennerB && m.out.unten.x0 >= m.out.stage.x1 && m.out.trennerB.x0 >= m.out.stage.x1 - 0.5 && m.out.trennerB.x1 <= m.out.unten.x0 + 0.5, `${label}: Bühne | Trennleiste | unterer Bereich`);
          } else {
            assert.ok(!m.out.trennerB, `${label}: keine senkrechte Trennleiste`);
            assert.ok(m.out.leiste.y0 >= m.out.stage.y1 - 0.5 && m.out.unten.y0 >= m.out.leiste.y1 - 0.5, `${label}: Bühne / Leiste / unterer Bereich untereinander`);
            assert.ok(Math.abs(m.out.unten.w - m.out.stage.w) <= 1, `${label}: unterer Bereich in voller Breite`);
          }
          const portrait = L.viewport.height > L.viewport.width || L.viewport.width <= 700;
          assert.equal(!!m.out.trennerP, portrait, `${label}: Trennleiste zum Bedienfeld nur hochkant`);
          if (portrait) assert.ok(m.out.trennerP.y0 >= m.out.unten.y1 - 0.5 && m.out.panel.y0 >= m.out.trennerP.y1 - 0.5);
          if (anordnung === 'A' && unten === 'karte') await page.screenshot({ path: path.join(OUT, `editor-${L.viewport.width}x${L.viewport.height}.png`) });
          if (anordnung === 'B' && unten === 'vergleich' && wantB) await page.screenshot({ path: path.join(OUT, `editor-B-vergleich-${L.viewport.width}x${L.viewport.height}.png`) });
          assert.deepEqual(log.errors, [], label);
          await context.close();
        }
      }
    });
  }

  test('Draufsicht aus: Bühne nutzt die ganze Fläche, Umschalter bleibt erreichbar', async () => {
    const { context, page } = await newPage();
    await openEditor(page);
    const before = await rect(page, '#stage');
    await page.click('#karte');
    const m = await layoutRects(page);
    assert.ok(!m.out.unten && !m.out.trennerB, 'unterer Bereich ausgeblendet');
    assert.ok(m.out.stage.h > before.h + 90, 'Bühne größer');
    assert.ok(inside(m.inner.modus, m.out.leiste) && Math.abs(m.out.leiste.y1 - m.H) <= 1, 'Leiste unten');
    await context.close();
  });

  async function drag(page, sel, dx, dy) {
    const r = await page.$eval(sel, (e) => { const b = e.getBoundingClientRect(); return { x: b.left + Math.min(b.width / 2, 22), y: b.top + b.height / 2 }; });
    await page.mouse.move(r.x, r.y);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) await page.mouse.move(r.x + dx * i / 8, r.y + dy * i / 8);
    await page.mouse.up();
  }
  test('Trennleiste ziehen ändert Größen, bleibt nach Neuladen, Doppeltipp setzt zurück (A, B, hochkant)', async () => {
    // A: waagerechte Leiste
    let { context, page, log } = await newPage({ viewport: { width: 1280, height: 800 } });
    await openEditor(page);
    const h0 = (await rect(page, '#stage')).h;
    await drag(page, '#griffA', 0, 90);
    const h1 = (await rect(page, '#stage')).h;
    assert.ok(Math.abs(h1 - h0 - 90) <= 3, `Bühne +90 px (${h0} → ${h1})`);
    const u1 = (await rect(page, '#unten')).h;
    await page.reload(); await page.waitForFunction(() => !!window.AetherScreenEditor);
    assert.ok(Math.abs((await rect(page, '#stage')).h - h1) <= 2, 'nach Neuladen gleich');
    assert.ok(Math.abs((await rect(page, '#unten')).h - u1) <= 2);
    // Mindestgröße: weit ziehen lässt den unteren Bereich bedienbar
    await drag(page, '#griffA', 0, 900);
    assert.ok((await rect(page, '#unten')).h >= 100, 'unterer Bereich nicht kleiner als 100 px');
    await page.dblclick('#griffA');
    await page.waitForTimeout(100);
    assert.ok(Math.abs((await rect(page, '#stage')).h - h0) <= 2, 'Doppeltipp: Standard');
    assert.equal(JSON.parse(await page.evaluate(() => localStorage.getItem('aether.screenEditor.layout'))).a, 0.62);
    // B: senkrechte Trennleiste
    await page.click('#anordnung [data-o="B"]');
    const w0 = (await rect(page, '#unten')).w;
    await drag(page, '#trennerB', -100, 0);
    const w1 = (await rect(page, '#unten')).w;
    assert.ok(Math.abs(w1 - w0 - 100) <= 3, `unterer Bereich +100 px breit (${w0} → ${w1})`);
    await page.reload(); await page.waitForFunction(() => !!window.AetherScreenEditor);
    assert.ok(Math.abs((await rect(page, '#unten')).w - w1) <= 2, 'B: nach Neuladen gleich');
    await page.dblclick('#trennerB');
    assert.ok(Math.abs((await rect(page, '#unten')).w - w0) <= 2, 'B: Doppeltipp setzt zurück');
    // Tastatur am Griff
    await page.click('#anordnung [data-o="A"]');
    await page.focus('#griffA');
    await page.keyboard.press('ArrowDown');
    assert.ok((await rect(page, '#stage')).h > h0 + 10, 'Pfeiltaste vergrößert die Bühne');
    await page.keyboard.press('Home');
    assert.ok(Math.abs((await rect(page, '#stage')).h - h0) <= 2, 'Pos1 setzt zurück');
    assert.deepEqual(log.errors, []);
    await context.close();

    // Hochkant: Trennleiste zwischen Ansichten und Bedienfeld
    ({ context, page, log } = await newPage({ viewport: { width: 402, height: 874 } }));
    await openEditor(page);
    const a0 = (await rect(page, '#trennerP')).y0;
    await drag(page, '#trennerP', 0, 70);
    const a1 = (await rect(page, '#trennerP')).y0;
    assert.ok(Math.abs(a1 - a0 - 70) <= 3, `Ansichten +70 px (${a0} → ${a1})`);
    await page.reload(); await page.waitForFunction(() => !!window.AetherScreenEditor);
    assert.ok(Math.abs((await rect(page, '#trennerP')).y0 - a1) <= 2, 'hochkant: nach Neuladen gleich');
    await drag(page, '#trennerP', 0, 900);
    assert.ok((await rect(page, '#panel')).h >= 140, 'Bedienfeld bleibt mindestens 140 px hoch');
    await page.dblclick('#trennerP');
    assert.ok(Math.abs((await rect(page, '#trennerP')).y0 - a0) <= 2, 'hochkant: Doppeltipp setzt zurück');
    assertNoOverlap(await layoutRects(page), 'hochkant nach Ziehen');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Nebeneinander fällt in schmalen Fenstern auf Untereinander zurück und kommt wieder', async () => {
    const { context, page } = await newPage({ viewport: { width: 1280, height: 800 } });
    await openEditor(page);
    await page.click('#anordnung [data-o="B"]');
    assert.ok((await layoutRects(page)).b, '1280 px: nebeneinander');
    for (const vp of [{ width: 900, height: 700 }, { width: 600, height: 800 }, { width: 1100, height: 1300 }]) {
      await page.setViewportSize(vp);
      await page.waitForTimeout(100);
      const m = await layoutRects(page);
      assert.equal(m.b, false, `${vp.width}×${vp.height}: untereinander`);
      assertNoOverlap(m, `${vp.width}×${vp.height} (B gewählt)`);
      assert.match(await page.textContent('#anordnungNote'), /deshalb untereinander/);
    }
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.waitForTimeout(100);
    assert.ok((await layoutRects(page)).b, 'wieder breit: nebeneinander');
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Regel C
// ---------------------------------------------------------------------------
const FORMATE = { ultrawide: [2560, 1080], iphone: [874, 402], desktop: [1920, 1080], ipad: [1194, 834] };
const T16 = Math.tan(65.9 / 2 * Math.PI / 180);
// Unabhängig von der Seite gerechnet: 16:9 bei 65,9° senkrecht ist immer ganz sichtbar.
function erwartet(w, h) {
  const A = w / h, A16 = 16 / 9;
  return A >= A16 ? { tanH: T16 * A, tanV: T16 } : { tanH: T16 * A16, tanV: T16 * A16 / A };
}

describe('Screen-Editor: Regel C', () => {
  test('sichtbare Rechtecke aller vier Formate; 16:9 immer vollständig enthalten', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    const fm = await page.evaluate(() => window.AetherScreenEditor.formate());
    assert.deepEqual(Object.keys(fm), ['ultrawide', 'iphone', 'desktop', 'ipad']);
    for (const [k, [w, h]] of Object.entries(FORMATE)) assert.deepEqual([fm[k].w, fm[k].h], [w, h], `Format ${k}`);
    let uH = 0, uV = 0;
    for (const [k, [w, h]] of Object.entries(FORMATE)) {
      const e = erwartet(w, h), s = await page.evaluate((key) => window.AetherScreenEditor.sicht(key), k);
      assert.ok(Math.abs(s.tanH - e.tanH) < 1e-12 && Math.abs(s.tanV - e.tanV) < 1e-12, `${k}: ${JSON.stringify(s)} ≠ ${JSON.stringify(e)}`);
      assert.ok(Math.abs(s.tanH / s.tanV - w / h) < 1e-12, `${k}: Seitenverhältnis`);
      // 16:9-Rechteck (±T16·16/9 × ±T16) liegt vollständig darin, an einer Achse genau am Rand
      assert.ok(s.tanH >= T16 * 16 / 9 - 1e-12 && s.tanV >= T16 - 1e-12, `${k}: 16:9 enthalten`);
      assert.ok(Math.abs(s.tanH - T16 * 16 / 9) < 1e-12 || Math.abs(s.tanV - T16) < 1e-12, `${k}: 16:9 berührt den Rand`);
      if (w / h > 16 / 9) assert.ok(Math.abs(s.tanV - T16) < 1e-12 && s.tanH > T16 * 16 / 9, `${k}: breiter → gleiche Höhe, seitlich mehr`);
      if (w / h < 16 / 9) assert.ok(Math.abs(s.tanH - T16 * 16 / 9) < 1e-12 && s.tanV > T16, `${k}: schmaler → volle 16:9-Breite, oben/unten mehr`);
      uH = Math.max(uH, e.tanH); uV = Math.max(uV, e.tanV);
    }
    const u = await page.evaluate(() => window.AetherScreenEditor.sichtAlle());
    assert.ok(Math.abs(u.tanH - erwartet(2560, 1080).tanH) < 1e-12 && Math.abs(u.tanV - erwartet(1194, 834).tanV) < 1e-12, 'Bühne = 21:9-Breite × iPad-Höhe');
    // Bühnenkamera zeigt genau diese Fläche
    const cam = await page.evaluate(() => window.AetherScreenEditor.kamera());
    assert.ok(Math.abs(Math.tan(cam.fov * Math.PI / 360) - uV) < 1e-9 && Math.abs(cam.aspect - uH / uV) < 1e-9, `Bühnenkamera ${JSON.stringify(cam)}`);
    // Rahmen auf der Bühne: 16:9 in jedem anderen, Seitenverhältnisse stimmen
    const R = Object.fromEntries((await page.evaluate(() => window.AetherScreenEditor.rahmen())).map((r) => [r.k, r]));
    assert.deepEqual(Object.keys(R).sort(), ['desktop', 'ipad', 'iphone', 'ultrawide']);
    for (const k of ['ultrawide', 'iphone', 'ipad']) assert.ok(inside(R.desktop, R[k], 1.5), `16:9-Rahmen liegt in ${k}`);
    for (const [k, [w, h]] of Object.entries(FORMATE)) assert.ok(Math.abs((R[k].x1 - R[k].x0) / (R[k].y1 - R[k].y0) - w / h) < 0.03 * w / h, `Rahmen ${k}: Seitenverhältnis`);
    assert.ok(Math.abs((R.ipad.x1 - R.ipad.x0) - (R.desktop.x1 - R.desktop.x0)) <= 3.5, 'iPad: volle 16:9-Breite');
    assert.ok(Math.abs((R.ultrawide.y1 - R.ultrawide.y0) - (R.desktop.y1 - R.desktop.y0)) <= 3.5, '21:9: gleiche Höhe wie 16:9');
    // Beschriftungen und Farben
    const labels = await page.$$eval('#rahmenBox .rahmen', (es) => es.map((e) => [e.dataset.k, e.textContent, getComputedStyle(e).borderTopColor, getComputedStyle(e).borderTopWidth]));
    const L = Object.fromEntries(labels.map((l) => [l[0], l]));
    assert.equal(L.desktop[1], '16:9 · Switch 2 · Hauptformat = sicherer Bereich');
    assert.deepEqual([L.desktop[2], L.iphone[2], L.ipad[2], L.ultrawide[2]], ['rgb(255, 160, 46)', 'rgb(196, 187, 255)', 'rgb(120, 220, 150)', 'rgb(120, 200, 255)']);
    assert.ok(parseFloat(L.desktop[3]) > parseFloat(L.iphone[3]), '16:9 kräftiger Rahmen');
    // Abdunklung außerhalb von 16:9 (ca. 55–60 %)
    const dim = await page.$$eval('#rahmenBox .schatten', (es) => es.map((e) => getComputedStyle(e).backgroundColor));
    assert.equal(dim.length, 4);
    for (const c of dim) { const a = Number(/rgba\(0, 0, 0, ([\d.]+)\)/.exec(c)[1]); assert.ok(a >= 0.55 && a <= 0.6, c); }
    // „Rahmen der anderen Geräte“ blendet nur die anderen aus
    await page.click('#rahmen');
    assert.deepEqual((await page.evaluate(() => window.AetherScreenEditor.rahmen())).map((r) => r.k), ['desktop']);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Vorschau, Vergleich und Bild nutzen dieselbe Rechnung; Logo-Maßstab nach dem 16:9-Bereich', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    for (const [k, [w, h]] of Object.entries(FORMATE)) {
      await page.click(`#ansicht [data-g="${k}"]`);
      await page.click('#btnVorschau');
      const cam = await page.evaluate(() => window.AetherScreenEditor.kamera());
      const e = erwartet(w, h), t = Math.tan(cam.fov * Math.PI / 360);
      assert.ok(Math.abs(t - e.tanV) < 1e-9 && Math.abs(cam.aspect - w / h) < 1e-9, `Vorschau ${k}: ${JSON.stringify(cam)}`);
      // Ecken des 16:9-Bilds landen im Bild (|NDC| ≤ 1)
      assert.ok(T16 * 16 / 9 / (t * cam.aspect) <= 1 + 1e-9 && T16 / t <= 1 + 1e-9, `Vorschau ${k}: 16:9 ganz sichtbar`);
      const fr = await rect(page, '#frame');
      assert.ok(Math.abs(fr.w / fr.h - w / h) < 0.01 * w / h, `Vorschau ${k}: genau das Format (${fr.w}×${fr.h})`);
      await page.click('#fertig');
      // Maßstab von Logo und Menübox: Höhe des 16:9-Bereichs / 400, höchstens 1,6
      const E = await page.evaluate((key) => window.AetherScreenEditor.elemente(key), k);
      const h16 = h * T16 / e.tanV;
      assert.ok(Math.abs(E.s - Math.min(h16 / 400, 1.6)) < 1e-9, `Maßstab ${k}: ${E.s}`);
    }
    assert.ok(Math.abs((await page.evaluate(() => window.AetherScreenEditor.elemente('iphone'))).s - 402 / 400) < 1e-9);
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Ränder füllen
// ---------------------------------------------------------------------------
describe('Screen-Editor: Ränder füllen', () => {
  test('setzt nur außerhalb von 16:9 (alle Eckpunkte), sichtbar auf einem anderen Gerät, frei halten, Rückgängig', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    for (let i = 0; i < 8; i++) await page.click('#plus');
    assert.equal(await page.textContent('#anzahl'), '20');
    await page.click('#btnRaender');
    const n1 = (await page.evaluate(() => window.AetherScreenEditor.zustand())).screens[0].asteroiden.length;
    await page.click('#btnRaender');
    const pts = await page.evaluate(() => window.AetherScreenEditor.eckpunkte());
    assert.ok(pts.length >= 30, `genug gesetzt: ${pts.length}`);
    const kH = T16 * 16 / 9;
    for (const a of pts) {
      const nd = a.punkte.map(([x, y, z]) => [x / -z / kH, y / -z / T16]);
      const side = [nd.every((p) => p[0] > 1), nd.every((p) => p[0] < -1), nd.every((p) => p[1] > 1), nd.every((p) => p[1] < -1)];
      assert.ok(side.some(Boolean), `Asteroid ${a.id} ragt in den 16:9-Bereich`);
      // Mitte auf mindestens einem anderen Gerät sichtbar
      const cx = a.punkte.reduce((s, p) => s + p[0] / -p[2], 0) / a.punkte.length, cy = a.punkte.reduce((s, p) => s + p[1] / -p[2], 0) / a.punkte.length;
      assert.ok(['ultrawide', 'iphone', 'ipad'].some((k) => { const e = erwartet(...FORMATE[k]); return Math.abs(cx) <= e.tanH * 1.02 && Math.abs(cy) <= e.tanV * 1.02; }), `Asteroid ${a.id} auf keinem Gerät sichtbar`);
    }
    // gleiche Größenlogik wie „Zufällig verteilen“ (25–500 m, Radius 1,2–8,2 % des Abstands), bekannte Farben und Formen
    const st = await page.evaluate(() => window.AetherScreenEditor.zustand());
    for (const a of st.screens[0].asteroiden) {
      const d = -a.z;
      assert.ok(d >= 24.9 && d <= 500.1 && a.r >= d * 0.012 - 0.01 && a.r <= d * 0.082 + 0.01, JSON.stringify(a));
      assert.ok(a.form >= 1 && a.form <= 8 && ['grau', 'braun', 'dunkel', 'rost'].includes(a.farbe));
    }
    await page.click('#btnUndo');
    assert.equal((await page.evaluate(() => window.AetherScreenEditor.zustand())).screens[0].asteroiden.length, n1, 'Rückgängig nimmt den zweiten Durchgang zurück');
    await page.click('#btnUndo');
    assert.equal((await page.evaluate(() => window.AetherScreenEditor.zustand())).screens[0].asteroiden.length, 0, 'Rückgängig nimmt beide Durchgänge zurück');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('„Logo und Menübox frei halten“: kein Asteroid über Logo oder Menübox (alle Formate)', async () => {
    const { context, page } = await newPage();
    await openEditor(page);
    for (let i = 0; i < 28; i++) await page.click('#plus');
    await page.click('#btnZufall');
    await page.click('#btnRaender');
    const res = await page.evaluate(() => {
      const api = window.AetherScreenEditor, rects = [];
      for (const k of Object.keys(api.formate())) { const E = api.elemente(k); rects.push(E.logo, E.menue); }
      return { rects, pts: api.eckpunkte() };
    });
    assert.ok(res.pts.length >= 40);
    for (const a of res.pts) {
      const t = a.punkte.map(([x, y, z]) => [x / -z, y / -z]);
      const b = { x0: Math.min(...t.map((p) => p[0])), x1: Math.max(...t.map((p) => p[0])), y0: Math.min(...t.map((p) => p[1])), y1: Math.max(...t.map((p) => p[1])) };
      for (const R of res.rects) assert.ok(!overlaps(b, R), `Asteroid ${a.id} über Logo/Menübox`);
    }
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Import der Versionen 1 und 2 (Format aus dem bisherigen Artefakt)
// ---------------------------------------------------------------------------
// Version 2: genau das Format, das exportText() des Artefakts (Version 2) schreibt.
const EXPORT_V2 = JSON.stringify({
  format: 'aether-menue-screens', version: 2,
  einheiten: 'Meter, Grad; Lage von Logo und Menübox in Punkten bei Maßstab 1 (Spiel: Maßstab = Bildhöhe / 400, höchstens 1,6), Verschiebung gegenüber der Standardlage',
  kamera: { position: [0, 0, 0], blickrichtung: [0, 0, -1], oben: [0, 1, 0], sichtfeldGrad: 65.9, sichtfeldAchse: 'senkrecht angenommen, im Spiel noch zu prüfen' },
  hinweis: 'radius ist ungefähr. form (1–8) und farbe sind Varianten dieses Editors; die Zuordnung zu den Spiel-Asteroiden passiert beim Einbau. Drehung als Euler-Winkel in der Reihenfolge YXZ (drehen um Y, kippen um X, rollen um Z). Ausblenden im Editor wird nicht exportiert.',
  screens: [
    { name: 'Startmenü iPad', hauptformat: 'ipad', sternenSeed: 424242, lage: { logo: [12.5, -8], menue: [-4, 20.5] },
      asteroiden: [
        { position: [12.34, -3.5, -80], radius: 4.2, form: 3, drehungGrad: { kippen: 10.5, drehen: 200, rollen: 33.3 }, farbe: 'rost' },
        { position: [-40, 11.25, -150.75], radius: 9.99, form: 8, drehungGrad: { kippen: 0, drehen: 0, rollen: 0 }, farbe: 'dunkel' }
      ] },
    { name: 'Breit', hauptformat: 'iphone', sternenSeed: 7, lage: { logo: [0, 0], menue: [0, 0] },
      asteroiden: [{ position: [60, 0, -50], radius: 2, form: 1, drehungGrad: { kippen: 1, drehen: 2, rollen: 3 }, farbe: 'grau' }] }
  ]
}, null, 1);
// Version 1: ohne Lage und ohne Rollen, Hauptformat unter „geraet“ (vom Import des Artefakts so gelesen).
const EXPORT_V1 = JSON.stringify({
  format: 'aether-menue-screens', version: 1,
  screens: [{ name: 'Erster Wurf', geraet: 'desktop', sternenSeed: 99,
    asteroiden: [{ position: [1.5, 2.5, -30], radius: 1.25, form: 2, drehungGrad: { kippen: 45, drehen: 90 }, farbe: 'braun' }] }]
});

async function importText(page, text, knopf) {
  await page.click('#btnImport');
  await page.fill('#mArea', text);
  await page.click(`#mBtns button:has-text("${knopf}")`);
}
async function exportiert(page) {
  await page.click('#btnText');
  const t = await page.inputValue('#mArea');
  await page.click('#mBtns button:has-text("Schließen")');
  return JSON.parse(t);
}

describe('Screen-Editor: Import und Export', () => {
  test('Exporte der Versionen 1 und 2 werden gelesen und als Version 3 unverändert weitergegeben', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    await importText(page, EXPORT_V2, 'Alles ersetzen');
    assert.match(await page.textContent('#toast'), /Screens ersetzt \(aus Version 2 übernommen/);
    let ex = await exportiert(page);
    assert.equal(ex.format, 'aether-menue-screens');
    assert.equal(ex.version, 3);
    assert.equal(ex.hauptformat, '16:9');
    assert.match(ex.regel, /^C: Das 16:9-Bild ist auf jedem Gerät vollständig sichtbar/);
    assert.deepEqual(ex.formate.map((f) => [f.schluessel, f.breite, f.hoehe]), [['ultrawide', 2560, 1080], ['iphone', 874, 402], ['desktop', 1920, 1080], ['ipad', 1194, 834]]);
    assert.equal(ex.formate.find((f) => f.schluessel === 'desktop').sichtfeldSenkrechtGrad, 65.9);
    assert.deepEqual(ex.kamera.sichtfeldGrad, 65.9);
    assert.equal(ex.screens.length, 2);
    const v2 = JSON.parse(EXPORT_V2);
    for (let i = 0; i < 2; i++) {
      const a = ex.screens[i], b = v2.screens[i];
      assert.equal(a.name, b.name);
      assert.equal(a.sternenSeed, b.sternenSeed);
      assert.equal(a.hauptformat, undefined, 'Hauptformat je Screen entfällt');
      assert.deepEqual(a.lage, b.lage, 'Lage unverändert');
      assert.deepEqual(a.asteroiden, b.asteroiden, 'Asteroiden unverändert');
    }
    // Version 1 dazu: fehlende Lage und fehlendes Rollen = 0
    await importText(page, EXPORT_V1, 'Hinzufügen');
    assert.match(await page.textContent('#toast'), /1 Screen\(s\) hinzugefügt \(aus Version 1 übernommen/);
    ex = await exportiert(page);
    assert.equal(ex.screens.length, 3);
    assert.deepEqual(ex.screens[2], { name: 'Erster Wurf', sternenSeed: 99, lage: { logo: [0, 0], menue: [0, 0] },
      asteroiden: [{ position: [1.5, 2.5, -30], radius: 1.25, form: 2, drehungGrad: { kippen: 45, drehen: 90, rollen: 0 }, farbe: 'braun' }] });
    assert.equal(await page.inputValue('#screenName'), 'Erster Wurf');
    // Version 3 lässt sich wieder einlesen (Rundlauf)
    const v3 = JSON.stringify(ex);
    await importText(page, v3, 'Alles ersetzen');
    assert.match(await page.textContent('#toast'), /^Screens ersetzt$/);
    assert.deepEqual((await exportiert(page)).screens, ex.screens);
    // Ungültig: fremdes Format und unbekannte Version
    await importText(page, JSON.stringify({ ...ex, version: 4 }), 'Alles ersetzen');
    assert.match(await page.textContent('#toast'), /kein gültiger Screens-Text/);
    await page.click('#mBtns button:has-text("Abbrechen")');
    assert.equal((await exportiert(page)).screens.length, 3, 'nichts ersetzt');
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Bild-Export
// ---------------------------------------------------------------------------
// Teilen-Dialog nachgestellt: canShare erlaubt Dateien, share schreibt Namen, Typ und PNG-Maße mit.
function shareMock() {
  window.__share = { calls: [] };
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    const files = await Promise.all(d.files.map(async (f) => {
      const b = new Uint8Array(await f.arrayBuffer()), v = new DataView(b.buffer);
      const sig = [...b.slice(0, 8)].join(',');
      return { name: f.name, type: f.type, sig, w: v.getUint32(16), h: v.getUint32(20), bytes: b.length };
    }));
    window.__share.calls.push({ title: d.title, files, active: navigator.userActivation ? navigator.userActivation.isActive : null });
  };
}
const PNG_SIG = '137,80,78,71,13,10,26,10';

describe('Screen-Editor: Als Bild sichern', () => {
  test('vier PNG in den Formatgrößen über den Teilen-Dialog; Vorschau sichert genau das gezeigte Format; nur mit Nutzergeste', async () => {
    const { context, page, log } = await newPage({ init: { fn: shareMock } });
    await openEditor(page);
    await page.fill('#screenName', 'Mein Menü 1/2');
    await page.click('#btnZufall');
    // Ohne Nutzergeste (Skript-Klick): kein Teilen
    await page.evaluate(() => document.getElementById('btnBild').click());
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => window.__share.calls.length), 0, 'Skript-Klick löst nichts aus');
    assert.match(await page.textContent('#toast'), /Bitte den Knopf antippen/);
    // Mit echtem Klick
    await page.click('#btnBild');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const call = await page.evaluate(() => window.__share.calls[0]);
    assert.equal(call.active, true, 'share() innerhalb der Nutzergeste');
    assert.deepEqual(call.files.map((f) => [f.name, f.type, f.sig, f.w, f.h]), [
      ['aether-screen-Mein-Menü-1-2-21x9.png', 'image/png', PNG_SIG, 2560, 1080],
      ['aether-screen-Mein-Menü-1-2-iphone-quer.png', 'image/png', PNG_SIG, 874, 402],
      ['aether-screen-Mein-Menü-1-2-16x9-switch2.png', 'image/png', PNG_SIG, 1920, 1080],
      ['aether-screen-Mein-Menü-1-2-ipad-quer.png', 'image/png', PNG_SIG, 1194, 834]
    ]);
    for (const f of call.files) assert.ok(f.bytes > 5000, `${f.name}: echtes Bild (${f.bytes} B)`);
    // Vorschau ohne Hilfen: nur das gezeigte Format
    await page.click('#ansicht [data-g="ipad"]');
    await page.click('#btnVorschau');
    const kn = await page.$$eval('#vorschauKnoepfe button', (es) => es.map((e) => { const r = e.getBoundingClientRect(); return [e.textContent, r.height >= 44, r.top < 80, r.right > window.innerWidth - 400]; }));
    assert.deepEqual(kn, [['Als Bild sichern', true, true, true], ['Vorschau beenden', true, true, true]]);
    await page.click('#btnBildVorschau');
    await page.waitForFunction(() => window.__share.calls.length === 2);
    const c2 = await page.evaluate(() => window.__share.calls[1]);
    assert.deepEqual(c2.files.map((f) => [f.name, f.w, f.h]), [['aether-screen-Mein-Menü-1-2-ipad-quer.png', 1194, 834]]);
    await page.evaluate(() => document.getElementById('btnBildVorschau').click());
    await page.waitForTimeout(200);
    assert.equal(await page.evaluate(() => window.__share.calls.length), 2, 'Skript-Klick in der Vorschau löst nichts aus');
    await page.click('#fertig');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('ohne Teilen-Dialog: Download-Links; ohne Download: Bild mit „Lange drücken und sichern“', async () => {
    let { context, page, log } = await newPage({ init: { fn: () => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; delete navigator.share; } } });
    await openEditor(page);
    const downloads = [];
    page.on('download', (d) => downloads.push(d.suggestedFilename()));
    await page.click('#btnVorschau');
    await page.click('#btnBildVorschau');
    await page.waitForFunction(() => document.getElementById('toast').textContent.includes('heruntergeladen'));
    await page.waitForTimeout(500);
    assert.deepEqual(downloads, ['aether-screen-Screen-1-16x9-switch2.png']);
    await page.click('#fertig');
    await page.click('#btnBild');
    await page.waitForSelector('#modal:not([hidden]) #mBilder figure');
    const links = await page.$$eval('#mBilder a', (as) => as.map((a) => [a.getAttribute('download'), a.href.startsWith('blob:')]));
    assert.deepEqual(links.map((l) => l[0]), ['aether-screen-Screen-1-21x9.png', 'aether-screen-Screen-1-iphone-quer.png', 'aether-screen-Screen-1-16x9-switch2.png', 'aether-screen-Screen-1-ipad-quer.png']);
    assert.ok(links.every((l) => l[1]));
    assert.deepEqual(log.errors, []);
    await context.close();

    ({ context, page, log } = await newPage({ init: { fn: () => { delete Navigator.prototype.share; delete Navigator.prototype.canShare; delete HTMLAnchorElement.prototype.download; } } }));
    await openEditor(page);
    await page.click('#btnBild');
    await page.waitForSelector('#modal:not([hidden]) #mBilder figure');
    assert.equal(await page.textContent('#mText'), 'Lange drücken und sichern.');
    const imgs = await page.$$eval('#mBilder img', (is) => is.map((i) => [i.naturalWidth || i.width, i.naturalHeight || i.height, i.src.startsWith('data:image/png')]));
    assert.deepEqual(imgs, [[2560, 1080, true], [874, 402, true], [1920, 1080, true], [1194, 834, true]]);
    assert.equal((await page.$$('#mBilder a')).length, 0);
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Bestehende Funktionen von Version 2 (Stichprobe)
// ---------------------------------------------------------------------------
describe('Screen-Editor: Funktionen aus Version 2', () => {
  test('Setzen per Antippen, Auswahl, Regler, Duplizieren, Ebenen, Screens, Draufsicht-Auswahl', async () => {
    const { context, page, log } = await newPage();
    await openEditor(page);
    await page.check('#platzieren');
    const f = await rect(page, '#frame');
    await page.mouse.click(f.x0 + f.w * 0.2, f.y0 + f.h * 0.3);
    let st = await page.evaluate(() => window.AetherScreenEditor.zustand());
    assert.equal(st.screens[0].asteroiden.length, 1);
    assert.ok(await page.isVisible('#selCtl'), 'neuer Asteroid ist ausgewählt');
    await page.fill('#selD', '700');
    await page.dispatchEvent('#selD', 'change');
    await page.click('#btnDup');
    st = await page.evaluate(() => window.AetherScreenEditor.zustand());
    assert.equal(st.screens[0].asteroiden.length, 2);
    assert.equal((await page.$$('#listeAst .zeile')).length, 2);
    await page.click('#listeAst .zeile .auge');
    assert.equal((await page.$$('#listeAst .zeile.aus')).length, 1);
    await page.click('#btnAlleAn');
    // Draufsicht: Antippen eines Asteroiden wählt ihn
    await page.click('#btnWeg');
    await page.waitForTimeout(100);
    const ast = (await page.evaluate(() => window.AetherScreenEditor.zustand())).screens[0].asteroiden[0];
    assert.ok(ast);
    await page.click('#btnNeu');
    assert.equal(await page.inputValue('#screenName'), 'Screen 2');
    await page.click('#btnKopie');
    assert.equal(await page.inputValue('#screenName'), 'Screen 2 (Kopie)');
    assert.equal((await page.$$('#screenSel option')).length, 3);
    await page.click('#layoutEdit');
    const logo = await rect(page, '#logoEl');
    await page.mouse.move(logo.x0 + 20, logo.y0 + 20); await page.mouse.down(); await page.mouse.move(logo.x0 + 60, logo.y0 + 30, { steps: 5 }); await page.mouse.up();
    const lage = (await page.evaluate(() => window.AetherScreenEditor.zustand())).screens.at(-1).lage.logo;
    assert.ok(lage.x > 10 && lage.y > 2, `Logo verschoben: ${JSON.stringify(lage)}`);
    await page.click('#btnUndo');
    assert.deepEqual((await page.evaluate(() => window.AetherScreenEditor.zustand())).screens.at(-1).lage.logo, { x: 0, y: 0 });
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});
