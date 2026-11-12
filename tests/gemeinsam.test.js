// Tests für gemeinsam.js (gemeinsame Hilfsfunktionen von index.html, screen-editor.html und logo.html):
// a) Datei in der App-Hülle und offline abrufbar; Projektansicht, Screen-Editor und Logo-Seite starten offline wie bisher.
// b) Keine der ausgelagerten Funktionen ist in den drei HTML-Dateien selbst definiert (Quelltextprüfung).
// c) Das Token steht in keinem Cache; gemeinsam.js speichert nichts und liest kein Token.
// Dazu: Verhalten der Hilfsfunktionen mit den Einstellungen beider Seiten (401-Text, Fehlerart ohne Token, …).
// Aufruf: node --test tests/gemeinsam.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const FILE = 'gemeinsam.js';
const PAGES = ['index.html', 'screen-editor.html', 'logo.html'];
const TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
const BASE = '/repos/konstantin9ezm/aether';
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

// Alle Funktionen, die jetzt nur noch in gemeinsam.js stehen
const FUNKTIONEN = ['AppError', 'fmtTime', 'shortSha', 'needTokenError', 'projTimeoutError', 'withProjTimeout',
  'githubApi', 'errorFromResponse', 'api', 'contentsPath', 'mitGeste', 'meldung', 'kannTeilen', 'kannHerunterladen', 'herunterladen'];
// Kennzeichnende Stellen aus den Funktionsrümpfen: fänden sich auch in einer umbenannten Kopie.
const RUEMPFE = [
  [/AppError\.prototype\s*=/, 'AppError.prototype'],
  [/GitHub lehnt das Token ab\./, '401-Text (errorFromResponse)'],
  [/GitHub-Rate-Limit erreicht\./, 'Rate-Limit-Text (errorFromResponse)'],
  [/'Authorization'\s*:/, 'Authorization-Header (api)'],
  [/'timeout',\s*'GitHub antwortet nicht\.',\s*'Prüfe die Internetverbindung/, 'Zeitlimit-Fehler (projTimeoutError)'],
  [/Promise\.race\(/, 'Promise.race (withProjTimeout)'],
  [/AETHER_TEST_PROJECT_TIMEOUT_MS/, 'Test-Zeitlimit (projTimeoutMs)'],
  [/15 \* 1000/, '15 s (PROJECT_TIMEOUT_MS)'],
  [/Für die Projektübersicht braucht das Dashboard ein GitHub-Token/, 'Hinweis ohne Token (needTokenError)'],
  [/\[0-9a-f\]\{7,40\}/, 'SHA-Muster (shortSha)'],
  [/isTrusted\s*!==\s*true/, 'Nutzergeste (mitGeste)'],
  [/navigator\.canShare\(/, 'Teilen-Prüfung (kannTeilen)'],
  [/'download' in HTMLAnchorElement/, 'Download-Prüfung (kannHerunterladen)'],
  [/a\.download\s*=[^;]*;\s*a\.hidden\s*=\s*true/, 'unsichtbarer Download-Link (herunterladen)'],
  [/t\.length > 60 \? 5000 : 2600/, 'Meldungsdauer (meldung)']
];
function definiert(src, name) {
  const n = name.replace(/\$/g, '\\$');
  return new RegExp(`function\\s*\\*?\\s+${n}\\s*\\(`).test(src) ||
    new RegExp(`(^|[^.\\w$])${n}\\s*=\\s*(async\\s+)?(function\\b|\\([^)]*\\)\\s*=>|[A-Za-z_$][\\w$]*\\s*=>)`, 'm').test(src);
}

// ---------------------------------------------------------------------------
// Quelltext
// ---------------------------------------------------------------------------
describe('gemeinsam.js: Quelltext', () => {
  test('b) keine ausgelagerte Funktion ist in index.html, screen-editor.html oder logo.html selbst definiert', () => {
    for (const p of PAGES) {
      const html = read(p);
      for (const name of FUNKTIONEN) assert.ok(!definiert(html, name), `${name} ist in ${p} noch selbst definiert`);
      for (const [re, was] of RUEMPFE) assert.doesNotMatch(html, re, `${p} enthält noch eine Kopie: ${was}`);
    }
    // Gegenkontrolle: die Prüfung erkennt Definitionen (sonst wäre sie wirkungslos)
    const js = read(FILE);
    for (const name of FUNKTIONEN) assert.ok(definiert(js, name), `${name} in gemeinsam.js gefunden`);
    for (const [re, was] of RUEMPFE) assert.match(js, re, `gemeinsam.js enthält ${was}`);
    assert.ok(definiert('function mitGeste(ev){', 'mitGeste') && definiert('const meldung = t => 1', 'meldung') && definiert('var api = async function (p) {}', 'api'));
    assert.ok(!definiert('const { api, contentsPath } = G.githubApi({', 'api') && !definiert('var api = gh.api;', 'api'), 'Übernahme ist keine Definition');
  });

  test('jede Funktion steht genau einmal in gemeinsam.js; die drei Seiten binden die Datei vor ihrem Skript ein', () => {
    const js = read(FILE);
    for (const name of FUNKTIONEN) {
      assert.equal([...js.matchAll(new RegExp(`function\\s+${name}\\s*\\(`, 'g'))].length, 1, `${name} genau einmal`);
    }
    for (const p of PAGES) {
      const html = read(p);
      const srcs = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)].map((m) => m[1]);
      assert.equal(srcs.filter((s) => s === FILE).length, 1, `${p} bindet ${FILE} genau einmal ein`);
      assert.ok(html.indexOf(`<script src="${FILE}"></script>`) < html.indexOf('<script>\n(function'), `${p}: ${FILE} vor dem eigenen Skript`);
      assert.match(html, /window\.AetherGemeinsam/, `${p} nutzt window.AetherGemeinsam`);
    }
  });

  test('c) gemeinsam.js speichert nichts, liest kein Token, lädt nichts von außen', () => {
    // Nur der Code, ohne Kommentare (der Kopfkommentar nennt die Regeln mit diesen Wörtern)
    const js = read(FILE).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/[^\n]*/g, '$1');
    assert.doesNotMatch(js, /localStorage|sessionStorage|indexedDB|caches\.|document\.cookie|serviceWorker/, 'kein Speicher, kein Cache');
    assert.doesNotMatch(js, /githubToken|TOKEN_KEY|github_pat_|gh[opsu]_[A-Za-z0-9]{20,}/, 'kein Token-Schlüssel, kein Token');
    assert.doesNotMatch(js, /https?:\/\//, 'keine Adressen (API-Basis kommt von der Seite)');
    assert.doesNotMatch(js, /\bimport\b|require\(|XMLHttpRequest|sendBeacon|WebSocket|eval\(|new Function/, 'nichts nachladen');
  });

  test('nicht im Spiel-iframe und nicht im WebGPU-Check; Hülle und Workflow', () => {
    const index = read('index.html');
    assert.equal(index.split(`src="${FILE}"`).length - 1, 1, 'index.html lädt gemeinsam.js nur einmal (eigene Seite)');
    assert.doesNotMatch(index, /srcdoc[^\n]*gemeinsam|'<script src=/, 'nicht ins Spiel-iframe');
    const boot = index.slice(index.indexOf('function iframeBoot('), index.indexOf('function iframeBoot(') + 20000);
    assert.doesNotMatch(boot, /gemeinsam\.js|AetherGemeinsam/);
    assert.doesNotMatch(read('webgpu-check.html'), /gemeinsam\.js|AetherGemeinsam/, 'WebGPU-Check bleibt eigenständig');
    const sw = read('sw.js');
    assert.match(/var SHELL = \[([^\]]*)\]/.exec(sw)[1], /'gemeinsam\.js'/, 'gemeinsam.js in der App-Hülle');
    assert.match(sw, /var SHELL_CACHE = 'aether-shell-v1';/, 'Cache-Name unverändert');
    assert.match(read('.github/workflows/pages.yml'), /cp [^\n]*gemeinsam\.js[^\n]*_site\//, 'Workflow kopiert gemeinsam.js');
  });
});

// ---------------------------------------------------------------------------
// Browser: Server (kann „kein Netz“ spielen) und Mock-API
// ---------------------------------------------------------------------------
const net = { offline: false };
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8' };
let server, baseUrl, browser;
const SVG = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200"><g id="ring-hinten"><rect x="20" y="60" width="60" height="80" fill="#f00"/></g><g id="schatten"/><g id="schrift"/><g id="ring-vorne"/></svg>';

before(async () => {
  server = http.createServer((req, res) => {
    if (net.offline) { req.socket.destroy(); return; }
    const u = new URL(req.url, 'http://x');
    let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    if (p === 'leer.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(`<!doctype html><body><div id="toast"></div><script src="${FILE}"></script></body>`); }
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
const mock = { requests: [] };
async function githubApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  mock.requests.push(url.pathname);
  if (net.offline) return route.abort('internetdisconnected');
  if (headers.authorization !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: '{"message":"Bad credentials"}' });
  if (url.pathname === `${BASE}/contents/art/logo/logo.svg`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: SVG });
  if (url.pathname === `${BASE}/commits`) return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ sha: '1234567abcdef0123456789abcdef0123456789a' }]) });
  if (url.pathname === `${BASE}/contents/index.json`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: '[]' });
  return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"message":"Not Found"}' });
}
async function newPage() {
  net.offline = false; mock.requests = [];
  const context = await browser.newContext({ viewport: { width: 1194, height: 834 }, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const log = { errors: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  await context.addInitScript((t) => { if (window === window.top) localStorage.setItem('aether.githubToken', t); }, TOKEN);
  await context.route('https://api.github.com/**', githubApi);
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  return { context, page, log };
}

describe('gemeinsam.js: Verhalten mit den Einstellungen beider Seiten', () => {
  test('401-Text, Fehlerart ohne Token, notFound, beiAntwort, contentsPath, shortSha, Zeitlimit, meldung', async () => {
    const { context, page, log } = await newPage();
    await page.goto(baseUrl + 'leer.html');
    const r = await page.evaluate(async () => {
      const G = window.AetherGemeinsam;
      const cfg = (o) => Object.assign({ apiBase: 'https://api.github.com', repoFull: 'konstantin9ezm/aether', repoPath: '/repos/konstantin9ezm/aether', ref: 'main' }, o);
      const res = (status, body, h) => new Response(body || '{}', { status, headers: h || {} });
      const index = G.githubApi(cfg({ ref: 'web-build', tokenOrt: 'hier', ohneTokenArt: 'auth' }));
      const logo = G.githubApi(cfg({ tokenOrt: 'im Dashboard', ohneTokenArt: 'notoken' }));
      const out = {};
      out.i401 = (await index.errorFromResponse(res(401))).text;
      out.l401 = (await logo.errorFromResponse(res(401))).text;
      const nf = new G.AppError('nologo', 'x');
      out.nfObj = (await logo.errorFromResponse(res(404), { notFound: nf })) === nf;
      out.nfFn = (await index.errorFromResponse(res(404), { notFound: async () => nf })) === nf;
      out.rate = (await index.errorFromResponse(res(403, '{}', { 'retry-after': '120' }))).text;
      out.forb = (await index.errorFromResponse(res(403), { perm: 'Actions: Read-only' })).text;
      try { await index.api('/x', {}); } catch (e) { out.iOhne = [e.kind, e.title, e.text, e instanceof Error]; }
      try { await logo.api('/x', {}); } catch (e) { out.lOhne = [e.kind, e.title, e.text]; }
      let seen = null, standard = 'tok-aus-seite';
      const mitStandard = G.githubApi(cfg({ tokenOrt: 'hier', ohneTokenArt: 'auth', standardToken: () => standard, beiAntwort: (rs) => { seen = rs.status; } }));
      try { await mitStandard.api('/repos/konstantin9ezm/aether/missing', {}); } catch (e) { out.beiAntwort = [seen, e.kind]; }
      out.cpIndex = index.contentsPath('/index.json/');
      out.cpLogo = logo.contentsPath('art/logo/logo.svg');
      out.sha = [G.shortSha('ABCDEF1234567'), G.shortSha('xyz'), G.shortSha(null)];
      out.ms = G.projTimeoutMs;
      const t0 = Date.now();
      try { await G.withProjTimeout(new Promise(() => {})); } catch (e) { out.timeout = [e.kind, e.title, Date.now() - t0 >= 1400]; }
      out.ok = await G.withProjTimeout(Promise.resolve(7));
      out.noToken = [G.needTokenError('konstantin9ezm/aether').kind, G.needTokenError('konstantin9ezm/aether').text];
      G.meldung('Hallo');
      out.toast = [document.getElementById('toast').textContent, document.getElementById('toast').classList.contains('on')];
      out.geste = [G.mitGeste(null), G.mitGeste({ isTrusted: false })];
      out.frozen = Object.isFrozen(G);
      return out;
    });
    assert.equal(r.i401, 'Das Token ist falsch, abgelaufen oder wurde widerrufen. Erzeuge auf GitHub ein neues Token und gib es hier ein.');
    assert.equal(r.l401, 'Das Token ist falsch, abgelaufen oder wurde widerrufen. Erzeuge auf GitHub ein neues Token und gib es im Dashboard ein.');
    assert.deepEqual([r.nfObj, r.nfFn], [true, true]);
    assert.equal(r.rate, 'Es wurden zu viele Anfragen an die GitHub-API geschickt. Bitte ca. 2 Min. warten.');
    assert.equal(r.forb, 'Das Token braucht für konstantin9ezm/aether die Berechtigung „Actions: Read-only“. Falls das Repo einer Organisation gehört, muss diese Fine-grained Tokens erlauben.');
    assert.deepEqual(r.iOhne, ['auth', 'Kein Token gespeichert.', 'Bitte zuerst ein Token eingeben.', true]);
    assert.deepEqual(r.lOhne, ['notoken', 'Kein Token gespeichert.', 'Bitte zuerst ein Token eingeben.']);
    assert.deepEqual(r.beiAntwort, [401, 'auth'], 'beiAntwort vor der Fehlerprüfung; Standard-Token der Seite (vom Mock abgelehnt)');
    assert.equal(r.cpIndex, '/repos/konstantin9ezm/aether/contents/index.json?ref=web-build');
    assert.equal(r.cpLogo, '/repos/konstantin9ezm/aether/contents/art/logo/logo.svg?ref=main', 'wie bisher in logo.html');
    assert.deepEqual(r.sha, ['abcdef1', '', '']);
    assert.equal(r.ms, 15000, 'Zeitlimit 15 s');
    assert.equal(r.ok, 7);
    assert.deepEqual(r.noToken, ['notoken', 'Für die Projektübersicht braucht das Dashboard ein GitHub-Token mit Lesezugriff auf konstantin9ezm/aether.']);
    assert.deepEqual(r.toast, ['Hallo', true]);
    assert.deepEqual(r.geste, [false, false]);
    assert.equal(r.frozen, true);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Zeitlimit über AETHER_TEST_PROJECT_TIMEOUT_MS (wie bisher in beiden Seiten)', async () => {
    const { context, page } = await newPage();
    await context.addInitScript(() => { window.AETHER_TEST_PROJECT_TIMEOUT_MS = 300; });
    await page.goto(baseUrl + 'leer.html');
    const r = await page.evaluate(async () => {
      const t0 = Date.now();
      try { await window.AetherGemeinsam.withProjTimeout(new Promise(() => {})); } catch (e) { return [window.AetherGemeinsam.projTimeoutMs, e.kind, Date.now() - t0]; }
      return null;
    });
    assert.equal(r[0], 300);
    assert.equal(r[1], 'timeout');
    assert.ok(r[2] >= 250 && r[2] < 3000, `nach ca. 300 ms (${r[2]})`);
    await context.close();
  });
});

describe('gemeinsam.js: offline aus der App-Hülle, Token in keinem Cache', () => {
  test('a) in der Hülle, offline abrufbar; Projektansicht, Screen-Editor und Logo-Seite starten offline; c) kein Token im Cache', async () => {
    const { context, page, log } = await newPage();
    await page.goto(baseUrl);
    const swReady = await page.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 10000))]));
    assert.ok(swReady, 'Service Worker aktiv');
    const keys = await page.evaluate(async () => (await (await caches.open('aether-shell-v1')).keys()).map((r) => new URL(r.url).pathname));
    assert.ok(keys.includes('/' + FILE), `${FILE} in der App-Hülle: ${keys.join(', ')}`);
    // Logo einmal online laden (gespeicherte Fassung für offline)
    await page.goto(baseUrl + 'logo.html');
    await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() === 'online');
    assert.ok(mock.requests.length > 0, 'API wurde online genutzt');

    // Netz weg
    net.offline = true;
    await context.setOffline(true);
    const geholt = await page.evaluate(async (f) => { const r = await fetch(f); return { ok: r.ok, text: await r.text() }; }, FILE);
    assert.ok(geholt.ok, `${FILE} offline abrufbar`);
    assert.equal(geholt.text, read(FILE), 'offline derselbe Inhalt');

    // Projektansicht offline wie bisher
    await page.goto(baseUrl + '#projekt');
    await page.waitForSelector('#projOffline:not([hidden])');
    await page.waitForSelector('#engineCard #engineBody .chip');
    assert.equal((await page.$$('#engineBody .chip')).length, 20, 'Engine-Karte aus der App-Hülle');
    assert.equal(await page.evaluate(() => typeof window.AetherGemeinsam), 'object');
    // Screen-Editor offline
    await page.goto(baseUrl + 'screen-editor.html');
    await page.waitForFunction(() => !!window.AetherScreenEditor);
    await page.click('#btnZufall');
    // Logo-Seite offline mit gespeicherter Fassung
    await page.goto(baseUrl + 'logo.html');
    await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() !== 'laden');
    assert.equal(await page.evaluate(() => window.AetherLogo.stand()), 'offline');
    assert.equal((await page.textContent('#hinweis')).trim(), 'Offline – zuletzt geladene Fassung');

    // c) Token in keinem Cache (auch nicht im Eintrag von gemeinsam.js)
    const cache = await page.evaluate(async (token) => {
      const out = [];
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const req of await c.keys()) {
          const body = await (await c.match(req)).text();
          out.push({ name, url: req.url, token: body.includes(token) || req.url.includes(token), auth: req.headers.get('authorization') });
        }
      }
      return out;
    }, TOKEN);
    assert.ok(cache.some((c) => c.url.endsWith('/' + FILE)));
    for (const c of cache) {
      assert.ok(!c.token && !c.auth, `kein Token im Cache: ${c.name} ${c.url}`);
      assert.ok(!c.url.includes('api.github.com'), `keine API-Antwort im Cache: ${c.url}`);
    }
    net.offline = false;
    await context.setOffline(false);
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});
