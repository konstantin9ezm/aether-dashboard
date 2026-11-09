// End-to-End-Tests für index.html mit nachgebauter GitHub-REST-API (Mock).
// Aufruf: node --test tests/
// Optional: AETHER_REAL_BUILD=/pfad/zu/builds/<hash> testet zusätzlich einen echten Emscripten-Build.
// Gegenprobe: AETHER_NO_SW=1 liefert sw.js nicht aus; die Offline-Tests müssen dann rot werden.
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
const WRONG_TOKEN = 'github_pat_11WRONGTOKEN000_definitelyNotValid0987654321zyxwvu';
const OWNER = 'konstantin9ezm';
const REPO = 'aether';
const REF = 'web-build';

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Testdaten: kleine Fake-Builds mit absichtlich ungewöhnlichen Dateinamen
// ---------------------------------------------------------------------------
// Minimales WASM-Modul: export add(i32, i32) -> i32
const WASM = Buffer.from([
  0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
  0x01, 0x07, 0x01, 0x60, 0x02, 0x7f, 0x7f, 0x01, 0x7f,
  0x03, 0x02, 0x01, 0x00,
  0x07, 0x07, 0x01, 0x03, 0x61, 0x64, 0x64, 0x00, 0x00,
  0x0a, 0x09, 0x01, 0x07, 0x00, 0x20, 0x00, 0x20, 0x01, 0x6a, 0x0b
]);

// Spiel-JS wie bei Emscripten: lädt .wasm und .data relativ per fetch und zeichnet auf #canvas.
function gameJs(wasmName, dataName) {
  return `
(function () {
  var M = typeof Module !== 'undefined' ? Module : {};
  var result = window.__game = { step: 'start' };
  try { localStorage.getItem('x'); result.storage = 'open'; } catch (e) { result.storage = 'blocked'; }
  try { result.parentToken = String(window.parent.localStorage.getItem('aether.githubToken')); } catch (e) { result.parentToken = 'blocked'; }
  WebAssembly.instantiateStreaming(fetch(${JSON.stringify(wasmName)}), {}).then(function (r) {
    result.sum = r.instance.exports.add(2, 3);
    ${dataName ? `return fetch(${JSON.stringify(dataName)}).then(function (x) { return x.arrayBuffer(); }).then(function (b) {
      result.dataBytes = b.byteLength;
      result.dataHead = new TextDecoder().decode(new Uint8Array(b, 0, 16));
    });` : ''}
  }).then(function () {
    var c = (M && M.canvas) || document.getElementById('canvas');
    c.width = 64; c.height = 64;
    var g = c.getContext('2d'); g.fillStyle = '#7c9cff'; g.fillRect(0, 0, 64, 64);
    result.inlineRanFirst = !!window.__inlineRan;
    result.step = 'done';
  }).catch(function (e) { result.step = 'error'; result.error = String(e); });
})();`;
}

function buildA() {
  const data = Buffer.alloc(3 * 1024 * 1024 + 123, 7);
  data.write('AETHER-DATA-OK!!', 0, 'utf8');
  const html = `<!doctype html><html lang=de><head><meta charset=utf-8><title>Fake</title>
<link rel=stylesheet href="stil.css"></head><body><canvas id=canvas></canvas>
<script>window.__inlineRan = true; var Module = { canvas: document.getElementById('canvas') };</script>
<script async src="kern.js"></script></body></html>`;
  return {
    'index.html': Buffer.from(html),
    'kern.js': Buffer.from(gameJs('kern.wasm', 'kern.data')),
    'kern.wasm': WASM,
    'kern.data': data,
    'stil.css': Buffer.from('body{background:rgb(1, 2, 3)}'),
    'musik.ogg': Buffer.alloc(2 * 1024 * 1024, 3)
  };
}
function buildB() {
  // Kein HTML: Die Seite muss selbst eine Hülle erzeugen und die Haupt-JS erkennen.
  return {
    'spiel.js': Buffer.from(gameJs('spiel.wasm', null)),
    'spiel.wasm': WASM,
    'spiel.worker.js': Buffer.from('throw new Error("Worker darf nicht als Hauptskript laufen")')
  };
}

function buildD() {
  // Taucht erst später in index.json auf (Test „neuer Build wird erkannt“); teilt die .wasm mit Build A.
  return {
    'neu.js': Buffer.from(gameJs('neu.wasm', 'neu.data')),
    'neu.wasm': WASM,
    'neu.data': Buffer.from('NEUER-BUILD-DATA' + 'x'.repeat(50000))
  };
}

function gitSha(buf) {
  return crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
}

const BUILDS = [
  { commit: 'aaa1111' + '0'.repeat(33), short: 'aaa1111', message: 'Neuester Build mit Daten\n\nDetails', date: '2026-11-04T21:05:14Z', path: 'builds/aaa1111/', files: buildA() },
  { commit: 'bbb2222' + '0'.repeat(33), short: 'bbb2222', message: 'Build ohne HTML', date: '2026-11-03T10:00:00Z', path: 'builds/bbb2222/', files: buildB() },
  { commit: 'ccc3333' + '0'.repeat(33), short: 'ccc3333', message: 'Gelöschter Build', date: '2026-11-01T08:00:00Z', path: 'builds/ccc3333/', files: null }
];

const BUILD_D = { commit: 'ddd4444' + '0'.repeat(33), short: 'ddd4444', message: 'Noch neuerer Build', date: '2026-11-05T12:00:00Z', path: 'builds/ddd4444/', files: buildD() };
const allBuilds = () => (mock.newBuild ? [BUILD_D, ...BUILDS] : BUILDS);

if (process.env.AETHER_REAL_BUILD) {
  const dir = process.env.AETHER_REAL_BUILD;
  const files = {};
  for (const n of fs.readdirSync(dir)) files[n] = fs.readFileSync(path.join(dir, n));
  BUILDS.unshift({ commit: 'f'.repeat(40), short: 'real000', message: 'Echter Build', date: '2026-11-05T00:00:00Z', path: 'builds/real000/', files });
}

// ---------------------------------------------------------------------------
// Mock der GitHub-REST-API
// ---------------------------------------------------------------------------
const mock = {
  mode: 'ok', // ok | ratelimit | revoked | offline | noindex | nobranch | hang
  newBuild: false,     // Build D in index.json aufnehmen
  serverOffline: false, // statischer Server kappt Verbindungen (echtes „kein Netz“ für den Service Worker)
  requests: [],
  blobRequests: 0,
  reset() { this.mode = 'ok'; this.newBuild = false; this.serverOffline = false; this.requests = []; this.blobRequests = 0; }
};

const blobs = new Map();
for (const b of [...BUILDS, BUILD_D]) if (b.files) for (const [n, buf] of Object.entries(b.files)) blobs.set(gitSha(buf), buf);

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'ETag, Link, Location, Retry-After, X-GitHub-OTP, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset, X-OAuth-Scopes, X-Accepted-OAuth-Scopes, X-Poll-Interval, X-GitHub-Media-Type, X-GitHub-SSO, X-GitHub-Request-Id, Deprecation, Sunset'
};
function rate(remaining) {
  return { 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800) };
}
function json(route, status, body, extra) {
  return route.fulfill({ status, headers: { ...CORS, ...rate(4990), 'content-type': 'application/json; charset=utf-8', ...(extra || {}) }, body: JSON.stringify(body) });
}

async function githubApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = await req.allHeaders();
  mock.requests.push({ url: req.url(), method: req.method(), auth: headers.authorization || null, accept: headers.accept || '' });

  if (req.method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept, Content-Type', 'access-control-max-age': '86400' } });
  }
  if (mock.mode === 'offline') return route.abort('internetdisconnected');
  if (mock.mode === 'hang') return; // antwortet nie
  if (mock.mode === 'ratelimit') {
    return route.fulfill({ status: 403, headers: { ...CORS, ...rate(0), 'content-type': 'application/json' }, body: JSON.stringify({ message: 'API rate limit exceeded for user.' }) });
  }
  if (headers.authorization !== `Bearer ${TOKEN}` || mock.mode === 'revoked') {
    return json(route, 401, { message: 'Bad credentials', documentation_url: 'https://docs.github.com/rest', status: '401' });
  }

  const p = decodeURIComponent(url.pathname);
  const base = `/repos/${OWNER}/${REPO}`;
  const raw = (headers.accept || '').includes('application/vnd.github.raw');

  if (p === base) return json(route, 200, { full_name: `${OWNER}/${REPO}`, private: true });
  if (p === `${base}/branches/${REF}`) return mock.mode === 'nobranch' ? json(route, 404, { message: 'Branch not found' }) : json(route, 200, { name: REF });

  if (p.startsWith(`${base}/contents/`)) {
    const rel = p.slice(`${base}/contents/`.length);
    if (rel !== 'index.json' && !rel.startsWith('builds/')) return json(route, 404, { message: 'Not Found' }); // z. B. ROADMAP.md der Projektansicht
    assert.equal(url.searchParams.get('ref'), REF, 'contents-Aufrufe müssen ref=web-build setzen');
    if (rel === 'index.json') {
      if (mock.mode === 'noindex' || mock.mode === 'nobranch') return json(route, 404, { message: 'Not Found' });
      assert.ok(raw, 'index.json sollte roh geladen werden');
      const index = allBuilds().map(({ commit, short, message, date, path }) => ({ commit, short, message, date, path }));
      return route.fulfill({ status: 200, headers: { ...CORS, ...rate(4990), 'content-type': 'application/vnd.github.raw+json; charset=utf-8' }, body: JSON.stringify(index, null, 2) });
    }
    const build = allBuilds().find((b) => b.path.replace(/\/$/, '') === rel);
    if (!build || !build.files) return json(route, 404, { message: 'Not Found' });
    const listing = Object.entries(build.files).map(([name, buf]) => ({
      name, path: `${rel}/${name}`, sha: gitSha(buf), size: buf.length, type: 'file',
      download_url: `https://raw.githubusercontent.com/${OWNER}/${REPO}/${REF}/${rel}/${name}?token=SHOULD_NOT_BE_USED`
    }));
    listing.push({ name: 'unterordner', path: `${rel}/unterordner`, sha: 'd'.repeat(40), size: 0, type: 'dir' });
    return json(route, 200, listing);
  }

  const m = /^\/repos\/[^/]+\/[^/]+\/git\/blobs\/([0-9a-f]{40})$/.exec(p);
  if (m) {
    const buf = blobs.get(m[1]);
    if (!buf) return json(route, 404, { message: 'Not Found' });
    mock.blobRequests++;
    assert.ok(raw, 'Blobs sollten roh geladen werden');
    return route.fulfill({ status: 200, headers: { ...CORS, ...rate(4980), 'content-type': 'application/octet-stream' }, body: buf });
  }
  return json(route, 404, { message: 'Not Found' });
}

// ---------------------------------------------------------------------------
// Statischer Server für die Seite
// ---------------------------------------------------------------------------
let server, baseUrl, browser;
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript' };

before(async () => {
  server = http.createServer((req, res) => {
    if (mock.serverOffline) { req.socket.destroy(); return; }
    const u = new URL(req.url, 'http://x');
    let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    if (p === 'sw.js' && process.env.AETHER_NO_SW) { res.writeHead(404); return res.end('Gegenprobe: kein Service Worker'); }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function newPage(deviceName) {
  const opts = deviceName ? { ...devices[deviceName] } : { viewport: { width: 1180, height: 820 } };
  const context = await browser.newContext({ ...opts, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const log = { console: [], urls: [], errors: [] };
  page.on('console', (m) => log.console.push(m.text()));
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('request', (r) => log.urls.push(r.url()));
  page.on('dialog', (d) => d.accept());
  await context.route('https://api.github.com/**', githubApi);
  // Alles andere außerhalb von localhost blockieren (keine externen Ressourcen).
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  return { context, page, log };
}

function gameFrame(page) {
  return page.frames().find((f) => f !== page.mainFrame());
}
// Start-Rahmen (iframe mit dem Knopf „Spielen“ an der Stelle des früheren Dashboard-Knopfs).
async function startFrame(page) {
  const handle = await page.waitForSelector('#game.slot:not([hidden]) iframe');
  const frame = await handle.contentFrame();
  await frame.waitForSelector('#aetherStart:not([disabled])');
  return { handle, frame };
}
// „Spielen“ mit echter Eingabe IM iframe (Maus-Klick bzw. Touch-Tipp), nicht per evaluate.
async function tapPlay(page, touch) {
  const { frame } = await startFrame(page);
  if (touch) await frame.tap('#aetherStart'); else await frame.click('#aetherStart');
}
// Nach dem Beenden: altes iframe entfernt, ein frischer Start-Rahmen steht bereit.
async function assertFreshStartFrame(page, old) {
  assert.equal(await old.evaluate((f) => f.isConnected), false, 'Spiel-iframe beim Beenden entfernt');
  const { handle } = await startFrame(page);
  assert.equal(await handle.evaluate((f, o) => f !== o, old), true, 'neuer Start-Rahmen');
  assert.equal(await page.evaluate(() => document.querySelectorAll('#game iframe').length), 1);
}
async function waitGame(page) {
  await page.waitForFunction(() => {
    const f = document.querySelector('#game iframe');
    return f && !document.getElementById('game').hidden;
  });
  let frame;
  for (let i = 0; i < 100 && !(frame = gameFrame(page)); i++) await page.waitForTimeout(50);
  await frame.waitForFunction(() => window.__game && (window.__game.step === 'done' || window.__game.step === 'error'), null, { timeout: 15000 });
  return frame.evaluate(() => window.__game);
}

function assertNoLeak(log, page) {
  for (const u of log.urls) assert.ok(!u.includes(TOKEN) && !u.includes('github_pat_'), `Token in URL: ${u}`);
  for (const c of log.console) assert.ok(!c.includes(TOKEN), 'Token in Konsolenausgabe');
  for (const e of log.errors) assert.ok(!e.includes(TOKEN), 'Token in Fehlermeldung');
  return page.evaluate((t) => document.documentElement.outerHTML.includes(t), TOKEN).then((inDom) => assert.equal(inDom, false, 'Token im DOM'));
}

async function enterToken(page, t) {
  await page.fill('#tokenInput', t);
  await page.click('#tokenSave');
}

const seedToken = (page) => page.addInitScript((t) => localStorage.setItem('aether.githubToken', t), TOKEN);
const shasOf = (build) => Object.values(build.files).map(gitSha);
// Welche Blob-SHAs im Build-Cache liegen und welche Builds der Index als gespeichert führt.
async function localState(page) {
  return page.evaluate(async () => {
    const cache = await caches.open('aether-builds-v1');
    const shas = (await cache.keys()).map((r) => r.url.split('/').pop());
    const idx = JSON.parse(localStorage.getItem('aether.cachedBuilds') || '[]');
    const last = JSON.parse(localStorage.getItem('aether.lastIndex') || 'null');
    return { shas, saved: idx.map((e) => e.short), lastIndex: last && last.builds.map((b) => b.short), cacheNames: await caches.keys() };
  });
}
async function buildRows(page) {
  return page.$$eval('.build', (els) => els.map((e) => ({
    short: e.querySelector('code').textContent,
    checked: e.querySelector('input').checked,
    disabled: e.querySelector('input').disabled,
    unavailable: e.classList.contains('unavailable'),
    saved: !!e.querySelector('.badge.saved'),
    opacity: Number(getComputedStyle(e).opacity)
  })));
}
// Der Token darf in keinem Cache (Anfrage oder Antwort) und in keinem anderen localStorage-Eintrag liegen.
async function assertTokenNotStored(page) {
  const found = await page.evaluate(async (t) => {
    const hits = [];
    for (const name of await caches.keys()) {
      const cache = await caches.open(name);
      for (const req of await cache.keys()) {
        if (req.headers.get('authorization') || req.url.includes(t)) hits.push(`${name}: ${req.url}`);
        const res = await cache.match(req);
        if (res.headers.get('authorization')) hits.push(`${name}: Antwort-Header ${req.url}`);
        if ((res.headers.get('content-type') || '').startsWith('text/') && (await res.clone().text()).includes(t)) hits.push(`${name}: Antwort-Text ${req.url}`);
      }
    }
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k !== 'aether.githubToken' && String(localStorage.getItem(k)).includes(t)) hits.push(`localStorage: ${k}`);
    }
    return hits;
  }, TOKEN);
  assert.deepEqual(found, [], 'Token in gespeicherten Daten');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
for (const deviceName of [null, 'iPhone 13', 'iPad Pro 11 landscape']) {
  const label = deviceName || 'Desktop';

  describe(`Dashboard (${label})`, () => {
    test('erster Start: fragt nach Token, falsches Token wird abgelehnt und nicht gespeichert', async () => {
      mock.reset();
      const { context, page, log } = await newPage(deviceName);
      await page.goto(baseUrl);
      await page.waitForSelector('#tokenView:not([hidden])');
      assert.equal(mock.requests.length, 0, 'ohne Token keine API-Aufrufe');
      assert.equal(await page.getAttribute('#tokenInput', 'type'), 'password');

      await enterToken(page, WRONG_TOKEN);
      await page.waitForSelector('#message:not([hidden])');
      assert.match(await page.textContent('#message'), /lehnt das Token ab/);
      assert.equal(await page.evaluate(() => localStorage.getItem('aether.githubToken')), null);
      assert.equal(await page.inputValue('#tokenInput'), '', 'Eingabefeld wird geleert');

      await enterToken(page, 'kein token');
      assert.match(await page.textContent('#message'), /nicht nach einem GitHub-Token/);
      await context.close();
    });

    test('Token speichern, Builds anzeigen, neuester vorausgewählt, Spiel startet isoliert', async () => {
      mock.reset();
      const { context, page, log } = await newPage(deviceName);
      await page.goto(baseUrl);
      await enterToken(page, TOKEN);
      await page.waitForSelector('#buildsView:not([hidden])');
      await page.screenshot({ path: path.join(OUT, `builds-${label.replace(/\W+/g, '_')}.png`) });

      assert.equal(await page.evaluate(() => localStorage.getItem('aether.githubToken')), TOKEN);
      const items = await page.$$eval('.build', (els) => els.map((e) => ({ text: e.textContent, checked: e.querySelector('input').checked })));
      assert.equal(items.length, BUILDS.length);
      assert.equal(items[0].checked, true, 'neuester Build vorausgewählt');
      assert.ok(items.slice(1).every((i) => !i.checked));
      assert.match(items[0].text, new RegExp(BUILDS[0].short));
      assert.match(items[0].text, /neuester/);
      if (!process.env.AETHER_REAL_BUILD) {
        assert.match(items[0].text, /Neuester Build mit Daten/);
        assert.match(items[0].text, /04\.11\.2026/);
        assert.doesNotMatch(items[0].text, /Details/, 'nur erste Zeile der Nachricht');
      }
      for (const r of mock.requests.filter((r) => r.method === 'GET')) {
        assert.equal(r.auth, `Bearer ${TOKEN}`, 'Token nur im Authorization-Header');
      }

      // Keine horizontale Scrollbar auf kleinen Bildschirmen.
      const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      assert.ok(overflow <= 0, `horizontaler Überlauf: ${overflow}px`);

      if (process.env.AETHER_REAL_BUILD) {
        await tapPlay(page, !!deviceName);
        await page.waitForFunction(() => !document.getElementById('game').hidden && !document.getElementById('game').classList.contains('slot'), null, { timeout: 30000 });
        const frame = await (async () => { for (;;) { const f = gameFrame(page); if (f) return f; await page.waitForTimeout(50); } })();
        // Die index.html des Builds blendet #status aus, sobald onRuntimeInitialized lief.
        await frame.waitForFunction(() => { const s = document.getElementById('status'); return s && s.style.display === 'none'; }, null, { timeout: 30000 });
        assert.deepEqual(log.errors, []);
        await page.waitForTimeout(1500);
        await page.screenshot({ path: path.join(OUT, `real-${label.replace(/\W+/g, '_')}.png`) });
        await page.click('#exitBtn');
        await page.click('#buildList label:has-text("aaa1111")');
      }

      // Fortschritt beobachten.
      const progress = [];
      await page.exposeFunction('__progress', (v) => progress.push(Number(v)));
      await page.evaluate(() => new MutationObserver(() => window.__progress(document.getElementById('progressBar').getAttribute('aria-valuenow')))
        .observe(document.getElementById('progressBar'), { attributes: true }));

      await tapPlay(page, !!deviceName);
      const result = await waitGame(page);
      assert.equal(result.step, 'done', result.error);
      assert.equal(result.sum, 5, 'WASM geladen und ausgeführt');
      assert.equal(result.dataBytes, BUILDS.find((b) => b.short === 'aaa1111').files['kern.data'].length, 'DATA geladen');
      assert.equal(result.dataHead, 'AETHER-DATA-OK!!');
      assert.equal(result.inlineRanFirst, true, 'Inline-Skripte laufen vor dem Spielskript');
      assert.equal(result.storage, 'blocked', 'Spiel hat keinen Zugriff auf localStorage');
      assert.equal(result.parentToken, 'blocked', 'Spiel kann das Token nicht lesen');
      assert.ok(progress.includes(100), 'Fortschritt erreicht 100 %');
      assert.ok(progress.some((p) => p > 0 && p < 100), `Zwischenstände sichtbar: ${progress.join(',')}`);
      const frame = gameFrame(page);
      assert.equal(await frame.evaluate(() => getComputedStyle(document.body).backgroundColor), 'rgb(1, 2, 3)', 'Stylesheet aus dem Build eingebettet');
      assert.ok(mock.requests.every((r) => !/download_url|raw\.githubusercontent/.test(r.url)));
      assert.ok(log.urls.every((u) => !u.includes('raw.githubusercontent.com')));

      // Spielansicht füllt den Bildschirm, nichts scrollt.
      const geo = await page.evaluate(() => {
        const r = document.querySelector('#game iframe').getBoundingClientRect();
        window.scrollTo(0, 500);
        return {
          w: r.width, h: r.height, vw: window.innerWidth, vh: window.innerHeight,
          scrollY: window.scrollY,
          overflow: getComputedStyle(document.documentElement).overflow,
          touch: getComputedStyle(document.body).touchAction,
          sandbox: document.querySelector('#game iframe').getAttribute('sandbox'),
          allow: document.querySelector('#game iframe').getAttribute('allow'),
          bar: document.getElementById('exitBtn').getBoundingClientRect().toJSON(),
          bg: getComputedStyle(document.documentElement).backgroundColor
        };
      });
      assert.equal(geo.w, geo.vw);
      assert.equal(geo.h, geo.vh);
      assert.equal(geo.scrollY, 0, 'Seite scrollt während des Spiels nicht');
      assert.equal(geo.overflow, 'hidden');
      assert.equal(geo.touch, 'none');
      assert.ok(!geo.sandbox.includes('allow-same-origin'));
      assert.equal(geo.sandbox, 'allow-scripts allow-pointer-lock', 'Sandbox unverändert');
      assert.match(geo.allow, /(^|;)\s*gamepad \*/, 'Gamepad im iframe erlaubt');
      assert.ok(geo.bar.left < geo.vw / 2 && geo.bar.top < geo.vh / 2, 'Schließen-Button oben links');
      assert.ok(geo.bar.left >= 12 && geo.bar.top >= 12, 'Abstand zum Rand');
      assert.ok(geo.bar.width >= 44 && geo.bar.height >= 44, 'gut treffbar');
      assert.equal(geo.bg, 'rgb(0, 0, 0)', 'schwarzer Hintergrund während des Spiels');
      const viewport = await page.getAttribute('meta[name=viewport]', 'content');
      assert.match(viewport, /user-scalable=no/);
      await page.waitForTimeout(300);
      await page.screenshot({ path: path.join(OUT, `game-${label.replace(/\W+/g, '_')}.png`) });

      // Vollbild-Button.
      assert.ok(await page.isVisible('#fsBtn'));
      await page.click('#fsBtn');
      await page.waitForTimeout(300);
      const fs1 = await page.evaluate(() => !!document.fullscreenElement || !document.getElementById('gameToast').hidden);
      assert.ok(fs1, 'Vollbild aktiv oder Hinweis angezeigt');
      await page.evaluate(() => document.fullscreenElement && document.exitFullscreen());

      // Zurück und Build ohne HTML starten.
      const oldFrame = await page.$('#game iframe');
      await page.click('#exitBtn');
      await page.waitForSelector('#buildsView:not([hidden])');
      await assertFreshStartFrame(page, oldFrame);
      await page.click(`#buildList label:has-text("bbb2222")`);
      await tapPlay(page, !!deviceName);
      const resultB = await waitGame(page);
      assert.equal(resultB.step, 'done', resultB.error);
      assert.equal(resultB.sum, 5);
      await page.click('#exitBtn');

      // Erneuter Start desselben Builds kommt aus dem Cache.
      const before = mock.blobRequests;
      await page.click(`#buildList label:has-text("aaa1111")`);
      await tapPlay(page, !!deviceName);
      const again = await waitGame(page);
      assert.equal(again.step, 'done');
      assert.equal(mock.blobRequests, before, 'zweiter Start ohne erneuten Download');
      await page.click('#exitBtn');

      // Fehlender Build.
      await page.click(`#buildList label:has-text("ccc3333")`);
      await tapPlay(page, !!deviceName);
      await page.waitForSelector('#message:not([hidden])');
      assert.match(await page.textContent('#message'), /Build ccc3333 fehlt/);
      assert.ok(await page.isVisible('#buildsView'));

      await assertNoLeak(log, page);
      await context.close();
    });

    test('gespeichertes Token: Rate-Limit, Offline, abgelaufen, fehlender Branch, Token löschen', async () => {
      mock.reset();
      const { context, page, log } = await newPage(deviceName);
      await page.addInitScript((t) => { if (!sessionStorage.getItem('seeded')) { localStorage.setItem('aether.githubToken', t); sessionStorage.setItem('seeded', '1'); } }, TOKEN);

      mock.mode = 'ratelimit';
      await page.goto(baseUrl);
      await page.waitForSelector('#message:not([hidden])');
      assert.match(await page.textContent('#message'), /Rate-Limit erreicht.*Wieder möglich ab \d\d:\d\d Uhr/s);

      mock.mode = 'offline';
      await page.click('#message button:has-text("Erneut versuchen")');
      await page.waitForSelector('#message:not([hidden]) >> text=Keine Verbindung');

      mock.mode = 'nobranch';
      await page.click('#message button:has-text("Erneut versuchen")');
      await page.waitForSelector('#message:not([hidden]) >> text=noch keinen Web-Build');

      mock.mode = 'noindex';
      await page.click('#message button:has-text("Erneut versuchen")');
      await page.waitForSelector('#message:not([hidden]) >> text=index.json fehlt');

      mock.mode = 'ok';
      await page.click('#message button:has-text("Erneut versuchen")');
      await page.waitForSelector('#buildsView:not([hidden])');
      assert.ok(await page.isHidden('#message'));

      mock.mode = 'revoked';
      await page.click('#reloadBtn');
      await page.waitForSelector('#tokenView:not([hidden])');
      assert.match(await page.textContent('#message'), /falsch, abgelaufen oder wurde widerrufen/);

      mock.mode = 'ok';
      await enterToken(page, TOKEN);
      await page.waitForSelector('#buildsView:not([hidden])');
      await page.click('#deleteTokenBtn');
      await page.waitForSelector('#tokenView:not([hidden])');
      assert.equal(await page.evaluate(() => localStorage.getItem('aether.githubToken')), null);
      assert.equal(await page.evaluate(async () => (await caches.keys()).length), 0, 'Cache geleert');
      await page.reload();
      await page.waitForSelector('#tokenView:not([hidden])');

      await assertNoLeak(log, page);
      await context.close();
    });
  });
}

test('Spiel meldet "aether:quit": Dashboard schließt das Spiel, fremde Nachrichten nicht', async () => {
  mock.reset();
  const { context, page, log } = await newPage(null);
  const dialogs = [];
  page.on('dialog', (d) => dialogs.push(d.message()));
  await page.goto(baseUrl);
  await enterToken(page, TOKEN);
  await page.waitForSelector('#buildsView:not([hidden])');
  await page.click('#buildList label:has-text("aaa1111")');
  await tapPlay(page);
  assert.equal((await waitGame(page)).step, 'done');
  const frame = gameFrame(page);
  const gameIframe = await page.$('#game iframe');
  const gameOpen = () => page.evaluate(() => !!document.querySelector('#game iframe') && !document.getElementById('game').hidden && document.documentElement.classList.contains('playing'));

  // Richtige Quelle, falscher type (bzw. falsche Form): wird ignoriert.
  await frame.evaluate(() => {
    for (const m of [{ type: 'aether:quit ' }, { type: 'AETHER:QUIT' }, { type: 'aether:exit' }, { aether: 'quit' }, { aether: 'aether:quit' }, 'aether:quit', null]) {
      window.parent.postMessage(m, '*');
    }
  });
  // Richtiger type, falsche Quelle: die Seite selbst und ein zweites (sandboxed) iframe.
  await page.evaluate(() => {
    window.postMessage({ type: 'aether:quit' }, '*');
    const f = document.createElement('iframe');
    f.id = 'fremd';
    f.setAttribute('sandbox', 'allow-scripts');
    f.srcdoc = '<script>parent.postMessage({ type: "aether:quit" }, "*"); parent.postMessage("fremd-fertig", "*");<\/script>';
    return new Promise((resolve) => {
      window.addEventListener('message', function h(e) { if (e.data === 'fremd-fertig') { window.removeEventListener('message', h); resolve(); } });
      document.body.appendChild(f);
    });
  });
  await page.waitForTimeout(500);
  assert.ok(await gameOpen(), 'Spiel bleibt bei fremden Nachrichten offen');
  await page.evaluate(() => document.getElementById('fremd').remove());

  // Vollbild an, dann "Beenden" aus dem Spiel.
  await page.click('#fsBtn');
  await page.waitForFunction(() => !!document.fullscreenElement);
  await frame.evaluate(() => window.parent.postMessage({ type: 'aether:quit' }, '*'));
  await page.waitForSelector('#buildsView:not([hidden])');
  await page.waitForFunction(() => !document.fullscreenElement);
  await assertFreshStartFrame(page, gameIframe); // Spiel entfernt, frischer Start-Rahmen
  assert.ok(await page.evaluate(() => document.getElementById('game').classList.contains('slot')), 'Spielansicht zu, nur der Start-Rahmen');
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('playing')), false);
  assert.deepEqual(dialogs, [], 'keine Rückfrage beim Beenden aus dem Spiel');

  // Danach lässt sich wieder ein Spiel starten.
  await tapPlay(page);
  assert.equal((await waitGame(page)).step, 'done');
  await assertNoLeak(log, page);
  await context.close();
});

describe('Offline', () => {
  test('Online: neuer Build wird beim Start erkannt, geladen und gespeichert; es bleiben höchstens 2 Builds', async () => {
    mock.reset();
    const { context, page, log } = await newPage(null);
    await seedToken(page);
    const A = BUILDS.find((b) => b.short === 'aaa1111'), B = BUILDS.find((b) => b.short === 'bbb2222');

    // Erster Start: Liste laden, neuester Build (A) wird sofort vollständig gespeichert.
    await page.goto(baseUrl);
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.equal(mock.blobRequests, Object.keys(A.files).length, 'alle Dateien von A geladen');
    let st = await localState(page);
    assert.deepEqual(st.saved, ['aaa1111']);
    assert.deepEqual(st.lastIndex, ['aaa1111', 'bbb2222', 'ccc3333'], 'Build-Liste lokal gespeichert');
    for (const sha of shasOf(A)) assert.ok(st.shas.includes(sha), `Datei ${sha} von A im Cache`);
    let rows = await buildRows(page);
    assert.deepEqual(rows.map((r) => r.saved), [true, false, false], 'nur A trägt „gespeichert“');
    assert.ok(rows.every((r) => !r.unavailable && !r.disabled), 'online ist nichts ausgegraut');
    assert.ok(await page.isHidden('#offlineHint'));

    // Neuer Build D erscheint: wird beim nächsten Start erkannt, geladen und gespeichert.
    mock.newBuild = true;
    const before = mock.blobRequests;
    await page.reload();
    await page.waitForSelector('#buildsView:not([hidden])');
    rows = await buildRows(page);
    assert.deepEqual(rows.map((r) => r.short), ['ddd4444', 'aaa1111', 'bbb2222', 'ccc3333']);
    assert.deepEqual(rows.map((r) => r.saved), [true, true, false, false], 'D und A gespeichert');
    assert.equal(rows[0].checked, true);
    assert.match(await page.textContent('.build:has-text("ddd4444")'), /neuester/);
    assert.equal(mock.blobRequests - before, 2, 'nur die neuen Dateien von D geladen (die .wasm lag schon im Cache)');
    st = await localState(page);
    assert.deepEqual(st.saved, ['ddd4444', 'aaa1111']);
    for (const sha of shasOf(BUILD_D)) assert.ok(st.shas.includes(sha));

    // D startet ohne weiteren Download, auch ohne API-Aufruf für die Dateiliste.
    const reqBefore = mock.requests.length;
    await tapPlay(page);
    const d = await waitGame(page);
    assert.equal(d.step, 'done', d.error);
    assert.equal(d.sum, 5);
    assert.equal(d.dataHead, 'NEUER-BUILD-DATA');
    assert.equal(mock.blobRequests - before, 2, 'Start aus dem lokalen Speicher');
    assert.equal(mock.requests.length, reqBefore, 'gespeicherter Build braucht keinen API-Aufruf');
    await page.click('#exitBtn');
    await page.waitForSelector('#buildsView:not([hidden])');

    // B starten: Speicherumfang 2 → A fliegt raus, D (neuester) und B (zuletzt gestartet) bleiben.
    await page.click('#buildList label:has-text("bbb2222")');
    await tapPlay(page);
    assert.equal((await waitGame(page)).step, 'done');
    await page.click('#exitBtn');
    await page.waitForSelector('#buildsView:not([hidden])');
    st = await localState(page);
    assert.deepEqual(st.saved, ['bbb2222', 'ddd4444']);
    for (const sha of [...shasOf(B), ...shasOf(BUILD_D)]) assert.ok(st.shas.includes(sha));
    assert.ok(!st.shas.includes(gitSha(A.files['kern.data'])) && !st.shas.includes(gitSha(A.files['kern.js'])), 'Dateien von A entfernt');
    rows = await buildRows(page);
    assert.deepEqual(rows.map((r) => r.saved), [true, false, true, false]);

    await assertTokenNotStored(page);
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Offline: Seite lädt, Hinweis erscheint, gespeicherter Build startet, andere sind ausgegraut, Projektansicht zeigt Hinweis', async () => {
    mock.reset();
    const { context, page, log } = await newPage('iPad Pro 11 landscape');
    await seedToken(page);
    await page.goto(baseUrl);
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.ok(await page.isHidden('#offlineHint'));
    // Service Worker fertig installiert (Seite, Manifest und Icons liegen im Cache). Ohne Service Worker
    // (Gegenprobe AETHER_NO_SW=1) würde "ready" nie auflösen, deshalb mit Frist.
    const swReady = await page.evaluate(() => Promise.race([
      navigator.serviceWorker.ready.then(() => true),
      new Promise((resolve) => setTimeout(() => resolve(false), 10000))
    ]));
    assert.ok(swReady, 'Service Worker ist aktiv');
    assert.ok((await localState(page)).cacheNames.includes('aether-shell-v1'), 'Service Worker hat die Seite gespeichert');
    // engine-map.json liegt nach dem ersten Laden in der App-Hülle.
    const shellKeys = await page.evaluate(async () => (await (await caches.open('aether-shell-v1')).keys()).map((r) => new URL(r.url).pathname));
    assert.ok(shellKeys.includes('/engine-map.json'), `engine-map.json in der App-Hülle: ${shellKeys.join(', ')}`);
    assert.ok(mock.requests.length > 0, 'API-Aufrufe laufen weiter über die Seite, nicht über den Service Worker');

    // Netz weg: Browser offline, Mock-API bricht ab, statischer Server kappt Verbindungen.
    mock.mode = 'offline';
    mock.serverOffline = true;
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('#buildsView:not([hidden])');
    await page.waitForSelector('#offlineHint:not([hidden])');
    const hint = (await page.textContent('#offlineHint')).replace(/\s+/g, ' ').trim();
    assert.match(hint, /^Offline – letzte Version aaa1111/);
    // Offline aus dem Cache abrufbar (Inhalt unverändert: 20 Bausteine).
    const offlineMap = await page.evaluate(async () => {
      const res = await fetch('engine-map.json', { cache: 'no-cache', credentials: 'same-origin' });
      const j = await res.json();
      return j.schichten.reduce((n, s) => n + s.bausteine.length, 0);
    });
    assert.equal(offlineMap, 20, 'engine-map.json offline aus der App-Hülle');
    assert.ok(await page.isHidden('#message'), 'keine Fehlermeldung, nur der Hinweis');
    const rows = await buildRows(page);
    assert.deepEqual(rows.map((r) => [r.short, r.unavailable, r.disabled, r.checked]), [
      ['aaa1111', false, false, true],
      ['bbb2222', true, true, false],
      ['ccc3333', true, true, false]
    ]);
    assert.ok(rows[1].opacity < 0.6 && rows[0].opacity === 1, 'nicht gespeicherte Builds sichtbar ausgegraut');
    // Startbarer Rahmen nur für den gespeicherten Build; kein ausgegrauter Ersatzknopf.
    assert.equal(await (await startFrame(page)).handle.getAttribute('title'), 'Aether aaa1111');
    assert.ok(await page.isHidden('#playOff'));
    await page.screenshot({ path: path.join(OUT, 'offline-builds.png') });

    // Gespeicherter Build startet ohne Netz.
    const reqBefore = mock.requests.length;
    await tapPlay(page);
    const r = await waitGame(page);
    assert.equal(r.step, 'done', r.error);
    assert.equal(r.sum, 5);
    assert.equal(r.dataHead, 'AETHER-DATA-OK!!');
    assert.equal(r.parentToken, 'blocked');
    assert.equal(mock.requests.length, reqBefore, 'kein API-Aufruf');
    await page.click('#exitBtn');
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.ok(await page.isVisible('#offlineHint'));

    // Nicht gespeicherte Builds bekommen keinen startbaren Rahmen: Antippen ändert die Auswahl nicht,
    // und ohne gespeicherten Build gibt es gar keinen Rahmen, nur den ausgegrauten Knopf.
    await page.click('#buildList label:has-text("bbb2222")', { force: true }); // ausgegraut: echter Klick ohne Wartebedingung
    assert.equal(await (await startFrame(page)).handle.getAttribute('title'), 'Aether aaa1111');
    await page.click('#clearCacheBtn');
    await page.waitForSelector('#playOff:not([hidden])');
    assert.equal(await page.$('#game iframe'), null, 'kein Start-Rahmen ohne gespeicherten Build');
    assert.ok(await page.isDisabled('#playOff'));
    assert.ok((await buildRows(page)).every((x) => x.unavailable && x.disabled && !x.checked), 'alles ausgegraut');

    // Projektansicht: ein klarer Hinweis statt Fehlerkarten.
    await page.click('#tabProject');
    await page.waitForSelector('#projOffline:not([hidden])');
    assert.match(await page.textContent('#projOffline'), /Offline – Projektansicht nicht verfügbar/);
    assert.ok(await page.isHidden('#projGrid'));
    assert.equal((await page.$$('#projectView .msg.error')).length, 0);
    await page.screenshot({ path: path.join(OUT, 'offline-project.png') });

    // Netz wieder da: Hinweis verschwindet, Projektansicht lädt.
    mock.mode = 'ok';
    mock.serverOffline = false;
    await context.setOffline(false);
    await page.waitForSelector('#offlineHint', { state: 'hidden' });
    await page.waitForSelector('#projGrid:not([hidden])');
    assert.ok(await page.isHidden('#projOffline'));
    // Die vier Teile laufen gegen den Mock der Spielansicht ins Leere; nur zu Ende laden lassen.
    await page.waitForFunction(() => ['ciBody', 'timelineBody', 'roadmapBody', 'engineBody']
      .every((id) => { const b = document.getElementById(id); return b.firstChild && !b.querySelector('.loadline'); }));
    assert.equal((await page.$$('#projectView .msg[data-kind="network"]')).length, 0, 'keine Verbindungsfehler mehr');
    await page.click('#tabPlay');
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.ok((await buildRows(page)).every((x) => !x.unavailable && !x.disabled), 'online wieder alles wählbar');

    await assertTokenNotStored(page);
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Zeitlimit: hängende API führt zum lokalen Stand; Standard bleibt 30 s', async () => {
    assert.match(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8'), /var ONLINE_CHECK_TIMEOUT_MS = 30 \* 1000;/, 'Standard 30 s');
    mock.reset();
    const { context, page, log } = await newPage(null);
    await seedToken(page);
    await page.addInitScript(() => { window.AETHER_TEST_CHECK_TIMEOUT_MS = 1500; });
    await page.goto(baseUrl);
    await page.waitForSelector('#buildsView:not([hidden])');

    mock.mode = 'hang';
    const t0 = Date.now();
    await page.reload();
    await page.waitForSelector('#loadingView:not([hidden]) >> text=Prüfe auf neue Builds');
    await page.waitForSelector('#buildsView:not([hidden])', { timeout: 20000 });
    const elapsed = Date.now() - t0;
    assert.ok(elapsed >= 1500 && elapsed < 20000, `Zeitlimit greift (${elapsed} ms)`);
    await page.waitForSelector('#offlineHint:not([hidden])');
    const hint = (await page.textContent('#offlineHint')).replace(/\s+/g, ' ').trim();
    assert.match(hint, /^Offline – letzte Version aaa1111/);
    // Offline aus dem Cache abrufbar (Inhalt unverändert: 20 Bausteine).
    const offlineMap = await page.evaluate(async () => {
      const res = await fetch('engine-map.json', { cache: 'no-cache', credentials: 'same-origin' });
      const j = await res.json();
      return j.schichten.reduce((n, s) => n + s.bausteine.length, 0);
    });
    assert.equal(offlineMap, 20, 'engine-map.json offline aus der App-Hülle');
    assert.match(hint, /antwortet nicht/);
    const rows = await buildRows(page);
    assert.deepEqual(rows.map((r) => [r.short, r.unavailable]), [['aaa1111', false], ['bbb2222', true], ['ccc3333', true]]);
    await tapPlay(page);
    assert.equal((await waitGame(page)).step, 'done');
    await page.click('#exitBtn');
    await page.waitForSelector('#buildsView:not([hidden])');

    // „Aktualisieren“ mit erreichbarer API: Hinweis verschwindet wieder.
    mock.mode = 'ok';
    await page.click('#reloadBtn');
    await page.waitForSelector('#offlineHint', { state: 'hidden' });
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.ok((await buildRows(page)).every((x) => !x.unavailable));
    await assertNoLeak(log, page);
    await context.close();
  });

  test('sw.js: fasst fremde Ursprünge nicht an und wird mit veröffentlicht', () => {
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    assert.match(sw, /url\.origin !== self\.location\.origin\) return;/, 'fremde Ursprünge (api.github.com) ohne respondWith');
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8');
    assert.match(wf, /cp [^\n]*sw\.js/, 'sw.js wird nach _site kopiert');
  });
});

test('Quelltext enthält kein Token und lädt keine externen Skripte', () => {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  assert.doesNotMatch(html, /github_pat_[A-Za-z0-9_]{20,}|gh[opsu]_[A-Za-z0-9]{20,}/);
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'keine externen Skripte');
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'manifest.json'), 'utf8'));
  for (const icon of manifest.icons) assert.ok(fs.existsSync(path.join(ROOT, icon.src)), icon.src);
});
