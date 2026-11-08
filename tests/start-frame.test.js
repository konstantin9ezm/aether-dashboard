// Tests für den Spielstart im abgeschotteten Rahmen: Der Knopf „Spielen“ sitzt IM Spiel-iframe,
// damit Safari das iframe als angetippt behandelt (sonst rAF-Drosselung auf 30 fps). Die Drosselung
// selbst ist in Chromium nicht messbar; geprüft wird, dass nach dem Tipp dasselbe Dokument im selben
// iframe-Element weiterläuft, die Quellprüfung, der Rückfall-Hinweis, das Layout und ?fps=1.
// Aufruf: node --test tests/start-frame.test.js
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
const OWNER = 'konstantin9ezm';
const REPO = 'aether';
const REF = 'web-build';
const HINT = 'Einmal ins Spielbild tippen für flüssigere Darstellung';
// Erlaubte Abweichung der Knopf-Lage/-Größe gegenüber dem bisherigen Dashboard-Knopf.
const TOL = 1; // px

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Test-Spiel: meldet Kennung des Dokuments, Tipps und schickt auf Tasten v1-Nachrichten.
// ---------------------------------------------------------------------------
const GAME_JS = `
window.__g = { doc: window.__aetherDoc, host: window.AETHER_HOST && window.AETHER_HOST.version, taps: [], ready: false };
window.addEventListener('pointerdown', function (e) { window.__g.taps.push(e.pointerType); }, true);
document.addEventListener('keydown', function (e) {
  if (e.key === 'f') window.parent.postMessage({ type: 'aether:feedback', subject: 'Betreff', body: 'Text' }, '*');
  if (e.key === 'q') window.parent.postMessage({ type: 'aether:quit' }, '*');
});
window.__g.ready = true;`;
const GAME_HTML = `<!doctype html><html lang=de><head><meta charset=utf-8><title>Rahmen-Test</title>
<style>html,body{margin:0;height:100%;background:#123}canvas{display:block;width:100%;height:100%}</style></head>
<body><canvas id=canvas tabindex=0></canvas><script src="spiel.js"></script></body></html>`;
const BUILDS = [
  { commit: 'aaa1111' + '0'.repeat(33), short: 'aaa1111', message: 'Build A', date: '2026-11-08T10:00:00Z', path: 'builds/aaa1111/',
    files: { 'index.html': Buffer.from(GAME_HTML), 'spiel.js': Buffer.from(GAME_JS) } },
  { commit: 'bbb2222' + '0'.repeat(33), short: 'bbb2222', message: 'Build B (ohne HTML)', date: '2026-11-07T10:00:00Z', path: 'builds/bbb2222/',
    files: { 'b.js': Buffer.from(GAME_JS + '\nwindow.__g.build = "B";') } }
];
const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const blobs = new Map();
for (const b of BUILDS) for (const buf of Object.values(b.files)) blobs.set(gitSha(buf), buf);

const mock = { requests: 0, blobs: 0 };
const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset' };
const RATE = () => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800) });
function json(route, status, body) {
  return route.fulfill({ status, headers: { ...CORS, ...RATE(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
}
async function githubApi(route) {
  const req = route.request();
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept, Content-Type' } });
  }
  mock.requests++;
  if (headers.authorization !== `Bearer ${TOKEN}`) return json(route, 401, { message: 'Bad credentials' });
  const p = decodeURIComponent(new URL(req.url()).pathname);
  const base = `/repos/${OWNER}/${REPO}`;
  if (p === `${base}/contents/index.json`) {
    const index = BUILDS.map(({ commit, short, message, date, path }) => ({ commit, short, message, date, path }));
    return route.fulfill({ status: 200, headers: { ...CORS, ...RATE(), 'content-type': 'application/vnd.github.raw+json' }, body: JSON.stringify(index) });
  }
  const b = BUILDS.find((x) => p === `${base}/contents/${x.path.replace(/\/$/, '')}`);
  if (b) return json(route, 200, Object.entries(b.files).map(([name, buf]) => ({ name, path: b.path + name, sha: gitSha(buf), size: buf.length, type: 'file' })));
  const m = /\/git\/blobs\/([0-9a-f]{40})$/.exec(p);
  if (m && blobs.has(m[1])) {
    mock.blobs++;
    return route.fulfill({ status: 200, headers: { ...CORS, ...RATE(), 'content-type': 'application/octet-stream' }, body: blobs.get(m[1]) });
  }
  return json(route, 404, { message: 'Not Found' });
}

// ---------------------------------------------------------------------------
// Server, Browser, Hilfen
// ---------------------------------------------------------------------------
let server, baseUrl, browser;
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript' };

before(async () => {
  server = http.createServer((req, res) => {
    let p = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
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

// touchPoints: per CDP gesetztes navigator.maxTouchPoints (Playwright emuliert sonst 1, echte iPads melden 5).
async function newPage(deviceName, opts = {}) {
  const dev = deviceName ? { ...devices[deviceName] } : { viewport: { width: 1180, height: 820 } };
  const context = await browser.newContext({ ...dev, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const log = { errors: [], dialogs: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.accept(); });
  await context.route('https://api.github.com/**', githubApi);
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  if (opts.touchPoints) {
    const cdp = await context.newCDPSession(page);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: opts.touchPoints });
  }
  await page.addInitScript((t) => {
    if (window !== window.top) return; // nur im Dashboard (das Spiel-iframe hat keinen Speicher)
    localStorage.setItem('aether.githubToken', t);
    // Alle Nachrichten mitschreiben, die beim Dashboard ankommen (läuft vor dessen eigenem Listener).
    window.__msgs = [];
    window.addEventListener('message', (e) => {
      const d = e.data;
      if (!d || typeof d !== 'object') return;
      const f = document.querySelector('#game iframe');
      window.__msgs.push({ type: d.type || (d.aether ? 'aether:' + d.aether : '?'), doc: d.doc, pointerType: d.pointerType, fps: d.fps, fromCurrent: !!f && e.source === f.contentWindow });
    });
  }, TOKEN);
  await page.goto(baseUrl + (opts.query || ''));
  await page.waitForSelector('#buildsView:not([hidden])');
  return { context, page, log };
}

// Start-Rahmen: iframe mit Knopf „Spielen“ an der Stelle des bisherigen Dashboard-Knopfs.
async function startFrame(page) {
  const handle = await page.waitForSelector('#game.slot:not([hidden]) iframe');
  const frame = await handle.contentFrame();
  await frame.waitForSelector('#aetherStart:not([disabled])');
  return { handle, frame };
}
const attrsOf = (handle) => handle.evaluate((f) => f.getAttributeNames().sort().map((n) => [n, f.getAttribute(n)]));
const EXPECTED_ATTRS = { allow: 'gamepad *; fullscreen *; autoplay *', referrerpolicy: 'no-referrer', sandbox: 'allow-scripts allow-pointer-lock' };
function assertFrameAttrs(attrs, short) {
  const o = Object.fromEntries(attrs);
  assert.deepEqual(Object.keys(o), ['allow', 'referrerpolicy', 'sandbox', 'srcdoc', 'title'], 'genau die bisherigen Attribute');
  assert.equal(o.sandbox, EXPECTED_ATTRS.sandbox);
  assert.ok(!/allow-same-origin|allow-popups|allow-top-navigation/.test(o.sandbox));
  assert.equal(o.allow, EXPECTED_ATTRS.allow);
  assert.ok(!/clipboard-write/.test(o.allow));
  assert.equal(o.referrerpolicy, EXPECTED_ATTRS.referrerpolicy);
  assert.equal(o.title, `Aether ${short}`);
  assert.match(o.srcdoc, /id="aetherStart"/, 'srcdoc vom Dashboard (Start-Dokument mit Boot-Skript)');
}
// Spiel läuft: Test-Spielskript fertig, Spielansicht offen, Fokus im iframe ("started" verarbeitet).
async function waitStarted(page, frame) {
  await frame.waitForFunction(() => window.__g && window.__g.ready);
  await page.waitForFunction(() => document.documentElement.classList.contains('playing') && !document.getElementById('game').classList.contains('slot') &&
    document.activeElement && document.activeElement.tagName === 'IFRAME');
}
async function startByEnter(page) {
  const { handle, frame } = await startFrame(page);
  await frame.focus('#aetherStart'); // Tastatur-Fokus, kein Zeiger
  await page.keyboard.press('Enter');
  await waitStarted(page, frame);
  return { handle, frame };
}
const msgs = (page) => page.evaluate(() => window.__msgs);
const hintState = (page) => page.evaluate(() => {
  const h = document.getElementById('gameHint');
  const r = h.getBoundingClientRect();
  return { text: h.textContent, visible: r.width > 0 && r.height > 0 && getComputedStyle(h).display !== 'none', rect: r.toJSON() };
});
async function assertFreshStartFrame(page, old) {
  assert.equal(await old.evaluate((f) => f.isConnected), false, 'altes iframe entfernt');
  const { handle } = await startFrame(page);
  assert.equal(await handle.evaluate((f, o) => f !== o, old), true, 'frischer Start-Rahmen');
  assert.equal(await page.evaluate(() => document.querySelectorAll('iframe').length), 1);
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('playing')), false);
  assert.equal((await hintState(page)).text, '', 'kein Hinweis in der Build-Liste');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
describe('Start im Rahmen', () => {
  test('Tipp im Rahmen startet das Spiel: dasselbe Dokument, dasselbe iframe-Element, Attribute unverändert', async () => {
    const { context, page, log } = await newPage(null);
    const { handle, frame } = await startFrame(page);
    const attrsBefore = await attrsOf(handle);
    assertFrameAttrs(attrsBefore, 'aaa1111');
    // Vor dem Tipp: nur der Knopf, keine Spieldateien im iframe.
    const pre = await frame.evaluate(() => ({ doc: window.__aetherDoc, scripts: document.scripts.length, g: typeof window.__g, module: typeof window.Module, btn: document.getElementById('aetherStart').textContent }));
    assert.equal(typeof pre.doc, 'string');
    assert.ok(pre.doc.length >= 6, 'zufällige Kennung gesetzt');
    assert.deepEqual([pre.scripts, pre.g, pre.module, pre.btn], [1, 'undefined', 'undefined', 'Spielen']);
    // Beobachter: neue Ladevorgänge des iframes und Änderungen an den Kindern von #game.
    await handle.evaluate((f) => {
      f.__mark = 'start-rahmen';
      f.__loads = 0;
      f.addEventListener('load', () => { f.__loads++; });
      window.__mut = [];
      new MutationObserver((list) => list.forEach((m) => {
        m.addedNodes.forEach((n) => window.__mut.push('+' + n.nodeName));
        m.removedNodes.forEach((n) => window.__mut.push('-' + n.nodeName));
      })).observe(document.getElementById('game'), { childList: true, subtree: true });
      window.__parentAtTap = f.parentNode.id;
    });

    await frame.click('#aetherStart'); // echter Mausklick im iframe
    await waitStarted(page, frame);

    const after = await frame.evaluate(() => ({ doc: window.__aetherDoc, gameDoc: window.__g.doc, host: window.__g.host, title: document.title }));
    assert.equal(after.doc, pre.doc, 'dasselbe Dokument im iframe (Kennung vor dem Tipp)');
    assert.equal(after.gameDoc, pre.doc, 'Spielskript sieht dieselbe Kennung');
    assert.equal(after.host, 1, 'AETHER_HOST vor dem Spielskript, Version 1');
    assert.equal(after.title, 'Rahmen-Test', 'Spiel-HTML im selben Dokument eingesetzt');
    const el = await handle.evaluate((f) => ({ same: f === document.querySelector('#game iframe'), mark: f.__mark, loads: f.__loads, parent: f.parentNode.id, parentAtTap: window.__parentAtTap, mut: window.__mut.filter((x) => /IFRAME/.test(x)), count: document.querySelectorAll('iframe').length }));
    assert.deepEqual(el, { same: true, mark: 'start-rahmen', loads: 0, parent: 'game', parentAtTap: 'game', mut: [], count: 1 }, 'iframe-Element nicht neu erzeugt, nicht umgehängt, nicht neu geladen');
    assert.deepEqual(await attrsOf(handle), attrsBefore, 'Attribute (inkl. srcdoc) exakt wie vor dem Tipp');
    const m = await msgs(page);
    const tap = m.filter((x) => x.type === 'aether:start-tap');
    const started = m.filter((x) => x.type === 'aether:started');
    assert.equal(tap.length, 1);
    assert.deepEqual([tap[0].doc, tap[0].pointerType, tap[0].fromCurrent], [pre.doc, 'mouse', true]);
    assert.equal(started.length, 1);
    assert.deepEqual([started[0].doc, started[0].fromCurrent], [pre.doc, true], 'started meldet dieselbe Kennung');
    assert.equal(m.filter((x) => x.type === 'aether:fps').length, 0, 'ohne ?fps=1 keine Messung');

    // Spielansicht füllt den Bildschirm, Tastatur kommt im Spiel an.
    const geo = await page.evaluate(() => ({ r: document.querySelector('#game iframe').getBoundingClientRect().toJSON(), vw: innerWidth, vh: innerHeight }));
    assert.deepEqual([geo.r.x, geo.r.y, geo.r.width, geo.r.height], [0, 0, geo.vw, geo.vh]);
    assert.equal((await hintState(page)).text, '', 'Desktop: kein Hinweis');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Nachrichten aus falscher Quelle (Seite, fremdes iframe, alter Start-Rahmen) starten nichts', async () => {
    const { context, page, log } = await newPage(null);
    const { handle: oldA } = await startFrame(page);
    const reqBefore = mock.requests;
    const srcdoc = await oldA.getAttribute('srcdoc');

    // Build-Wechsel: neuer Start-Rahmen für B, der alte ist weg.
    await page.click('#buildList label:has-text("bbb2222")');
    const { handle: curB } = await startFrame(page);
    assert.equal(await curB.evaluate((f, o) => f !== o, oldA), true, 'neuer Rahmen beim Build-Wechsel');
    assert.equal(await curB.getAttribute('title'), 'Aether bbb2222');
    assert.equal(await oldA.evaluate((f) => f.isConnected), false);

    // Wartet (ohne Wanduhr), bis das Dashboard eine start-tap-Nachricht der Quelle verarbeitet hat:
    // Dieser Listener kommt nach dem des Dashboards dran.
    const armSeen = (sel) => page.evaluate((s) => { window.__seen = new Promise((resolve) => {
      window.addEventListener('message', function h(e) {
        const src = s === 'self' ? window : (document.querySelector(s) || {}).contentWindow;
        if (e.source === src && e.data && e.data.type === 'aether:start-tap') { window.removeEventListener('message', h); resolve(true); }
      });
    }); }, sel);
    const seen = () => page.evaluate(() => window.__seen);

    // (a) Die Seite selbst.
    await armSeen('self');
    await page.evaluate(() => window.postMessage({ type: 'aether:start-tap', pointerType: 'mouse' }, '*'));
    await seen();
    // (b) Fremdes iframe mit genau demselben Start-Dokument (echtes Boot-Skript), echter Klick.
    await page.evaluate((s) => {
      const f = document.createElement('iframe');
      f.id = 'klon';
      f.setAttribute('sandbox', 'allow-scripts allow-pointer-lock');
      f.setAttribute('srcdoc', s);
      document.body.appendChild(f);
    }, srcdoc);
    await armSeen('#klon');
    await page.frameLocator('#klon').locator('#aetherStart').click();
    await seen();
    // (c) Der alte Start-Rahmen (Element von Build A), wieder eingehängt, echter Klick.
    // discardFrame() leert srcdoc beim Entfernen; das ursprüngliche Start-Dokument wieder einsetzen.
    await oldA.evaluate((f, s) => { f.id = 'alt'; f.setAttribute('srcdoc', s); document.body.appendChild(f); }, srcdoc);
    await armSeen('#alt');
    await page.frameLocator('#alt').locator('#aetherStart').click();
    await seen();

    const st = await page.evaluate(() => ({
      loading: !document.getElementById('loadingView').hidden, builds: !document.getElementById('buildsView').hidden,
      slot: document.getElementById('game').classList.contains('slot'), playing: document.documentElement.classList.contains('playing')
    }));
    assert.deepEqual(st, { loading: false, builds: true, slot: true, playing: false }, 'nichts gestartet');
    assert.equal(mock.requests, reqBefore, 'keine API-Aufrufe');
    const { frame: fB } = await startFrame(page); // Knopf im echten Rahmen weiter bereit (nicht „Lädt …“)
    assert.equal(await fB.textContent('#aetherStart'), 'Spielen');

    // Aufräumen, dann startet der echte Rahmen (B) wie erwartet.
    await page.evaluate(() => { document.getElementById('klon').remove(); document.getElementById('alt').remove(); });
    await fB.click('#aetherStart');
    await waitStarted(page, fB);
    assert.equal(await fB.evaluate(() => window.__g.build), 'B');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Build-Wechsel legt einen neuen Start-Rahmen an; Beenden (X, aether:quit) führt zu einem frischen', async () => {
    const { context, page, log } = await newPage(null);
    const { handle: a1 } = await startFrame(page);
    await page.click('#buildList label:has-text("bbb2222")');
    const { handle: b1 } = await startFrame(page);
    await page.click('#buildList label:has-text("aaa1111")');
    const { handle: a2, frame } = await startFrame(page);
    assert.deepEqual(await page.evaluate(([x, y, z]) => [x.isConnected, y.isConnected, z.isConnected, z === document.querySelector('#game iframe')], [a1, b1, a2]), [false, false, true, true]);
    assert.equal(await a2.getAttribute('title'), 'Aether aaa1111');

    // Schließen-X mit Rückfrage.
    await frame.click('#aetherStart');
    await waitStarted(page, frame);
    await page.click('#exitBtn');
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.deepEqual(log.dialogs, ['Spiel beenden?']);
    await assertFreshStartFrame(page, a2);

    // aether:quit aus dem Spiel (echte Taste "q" im Spiel), ohne Rückfrage.
    const { handle: a3, frame: f3 } = await startFrame(page);
    await f3.click('#aetherStart');
    await waitStarted(page, f3);
    await page.keyboard.press('q');
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.equal(log.dialogs.length, 1);
    await assertFreshStartFrame(page, a3);
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

describe('Rückfall-Hinweis', () => {
  test('Start per Enter auf dem iPad: Hinweis erscheint, Tipp geht durch ins Spiel und blendet ihn aus', async () => {
    const { context, page, log } = await newPage('iPad Pro 11 landscape', { touchPoints: 5 });
    assert.equal(await page.evaluate(() => navigator.maxTouchPoints), 5);
    const { frame } = await startByEnter(page);
    const tap = (await msgs(page)).find((x) => x.type === 'aether:start-tap');
    assert.equal(tap.pointerType, '', 'Start ohne Zeiger');
    assert.equal(await frame.evaluate(() => window.__g.taps.length), 0);

    const h = await hintState(page);
    assert.equal(h.text, HINT);
    assert.ok(h.visible);
    assert.doesNotMatch(h.text, /60|fps/i, 'verspricht keine Bildrate');
    const props = await page.evaluate(() => {
      const hint = document.getElementById('gameHint');
      const z = (el) => Number(getComputedStyle(el).zIndex);
      return {
        role: hint.getAttribute('role'), live: hint.getAttribute('aria-live'),
        pe: [hint, ...hint.querySelectorAll('*')].map((e) => getComputedStyle(e).pointerEvents),
        parent: hint.parentNode.id,
        z: { iframe: z(document.querySelector('#game iframe')), hint: z(hint), feedback: z(document.getElementById('feedback')), bar: z(document.getElementById('gameBar')) },
        notToast: hint !== document.getElementById('gameToast')
      };
    });
    assert.deepEqual([props.role, props.live, props.parent, props.notToast], ['status', 'polite', 'game', true]);
    assert.ok(props.pe.every((p) => p === 'none'), 'pointer-events: none (auch Kinder)');
    assert.ok(props.z.hint > props.z.iframe && props.z.hint < props.z.feedback && props.z.hint < props.z.bar, JSON.stringify(props.z));
    // Unten mittig als Pille.
    const vw = 1194, vh = 834;
    assert.ok(Math.abs(h.rect.x + h.rect.width / 2 - vw / 2) <= TOL, 'mittig');
    assert.ok(h.rect.y + h.rect.height > vh - 40 && h.rect.y + h.rect.height <= vh, 'unten');
    await page.screenshot({ path: path.join(OUT, 'rahmen-hinweis-ipad.png') });

    // Tipp genau auf den Hinweis: kommt im Spiel an und blendet den Hinweis aus.
    const cx = h.rect.x + h.rect.width / 2, cy = h.rect.y + h.rect.height / 2;
    assert.equal(await page.evaluate(([x, y]) => document.elementFromPoint(x, y) === document.querySelector('#game iframe'), [cx, cy]), true, 'unter dem Hinweis liegt das Spiel');
    await page.touchscreen.tap(cx, cy);
    await page.waitForFunction(() => document.getElementById('gameHint').textContent === '');
    assert.deepEqual(await frame.evaluate(() => window.__g.taps), ['touch'], 'Tipp kam im Spiel an');
    assert.equal((await msgs(page)).filter((x) => x.type === 'aether:tapped').length, 1, 'erster Tipp gemeldet');
    assert.equal((await hintState(page)).visible, false);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Feedback-Dialog blendet den Hinweis aus; X, aether:quit und Vollbild wie bisher; Neustart ohne Hinweis-Rest', async () => {
    const { context, page, log } = await newPage('iPhone 16 Pro landscape', { touchPoints: 5 });
    let { handle } = await startByEnter(page);
    assert.equal((await hintState(page)).text, HINT);
    await page.keyboard.press('f'); // Spiel schickt aether:feedback
    await page.waitForSelector('#feedback:not([hidden])');
    assert.equal((await hintState(page)).text, '', 'Feedback-Dialog blendet den Hinweis aus');
    await page.click('#fbClose');
    await page.waitForSelector('#feedback', { state: 'hidden' });
    assert.equal((await hintState(page)).text, '', 'bleibt aus');

    // Vollbild auf #game: das iframe ist darin und füllt es.
    await page.click('#fsBtn');
    await page.waitForFunction(() => document.fullscreenElement === document.getElementById('game'));
    assert.equal(await page.evaluate(() => document.getElementById('game').contains(document.querySelector('iframe'))), true);
    await page.evaluate(() => document.exitFullscreen());
    await page.waitForFunction(() => !document.fullscreenElement);

    // Schließen-X (mit Rückfrage) beendet; Hinweis weg.
    await page.click('#exitBtn');
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.deepEqual(log.dialogs, ['Spiel beenden?']);
    await assertFreshStartFrame(page, handle);

    // Erneut per Enter: Hinweis da; aether:quit beendet und entfernt ihn (stopGame).
    ({ handle } = await startByEnter(page));
    assert.equal((await hintState(page)).text, HINT);
    await page.keyboard.press('q');
    await page.waitForSelector('#buildsView:not([hidden])');
    await assertFreshStartFrame(page, handle);
    assert.equal(log.dialogs.length, 1);

    // Start per Tipp im Rahmen: kein Hinweis.
    const { frame } = await startFrame(page);
    await frame.tap('#aetherStart');
    await waitStarted(page, frame);
    assert.equal((await hintState(page)).text, '');
    assert.equal((await msgs(page)).filter((x) => x.type === 'aether:start-tap').pop().pointerType, 'touch');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Desktop ohne Touch: Start per Enter zeigt keinen Hinweis', async () => {
    const { context, page, log } = await newPage(null);
    assert.equal(await page.evaluate(() => navigator.maxTouchPoints), 0);
    await startByEnter(page);
    assert.equal((await msgs(page)).find((x) => x.type === 'aether:start-tap').pointerType, '');
    const h = await hintState(page);
    assert.deepEqual([h.text, h.visible], ['', false]);
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

describe('Layout des Start-Rahmens', () => {
  // Der bisherige Knopf (.btn.primary.block.big.mt) saß in der Karte unter der Build-Liste:
  // links/rechts Karteninnenkante (1 px Rand + 18 px Innenabstand), 12 px unter der Liste,
  // 54 px hoch, 19 px über der Kartenunterkante.
  for (const deviceName of ['iPhone 16 Pro landscape', 'iPad Pro 11 landscape', null]) {
    const label = deviceName || 'Desktop';
    test(`Knopf im Rahmen an der Stelle und in der Größe des bisherigen Knopfs (${label}, Toleranz ${TOL} px)`, async () => {
      const { context, page, log } = await newPage(deviceName);
      const { frame } = await startFrame(page);
      const measure = async () => {
        const btn = await frame.evaluate(() => document.getElementById('aetherStart').getBoundingClientRect().toJSON());
        return page.evaluate((b) => {
          const f = document.querySelector('#game iframe').getBoundingClientRect();
          const card = document.querySelector('#buildsView .card').getBoundingClientRect();
          const list = document.getElementById('buildList').getBoundingClientRect();
          return { btn: { left: f.left + b.left, top: f.top + b.top, right: f.left + b.right, bottom: f.top + b.bottom, height: b.height }, card: card.toJSON(), list: list.toJSON() };
        }, btn);
      };
      const check = (m, what) => {
        const near = (a, b, n) => assert.ok(Math.abs(a - b) <= TOL, `${what}: ${n} ${a} statt ${b}`);
        near(m.btn.left, m.card.left + 19, 'links');
        near(m.btn.right, m.card.right - 19, 'rechts');
        near(m.btn.top, m.list.bottom + 12, 'oben');
        near(m.btn.height, 54, 'Höhe');
        near(m.card.bottom - m.btn.bottom, 19, 'Abstand unten');
        assert.ok(m.btn.height >= 44, 'mindestens 44 px hoch');
      };
      check(await measure(), 'Start');

      // Aussehen wie der bisherige Knopf (gleiche Klassen im Dashboard zum Vergleich).
      const want = await page.evaluate(() => {
        const b = document.createElement('button');
        b.className = 'btn primary block big';
        b.textContent = 'Spielen';
        document.body.appendChild(b);
        const s = getComputedStyle(b);
        const r = { bg: s.backgroundImage, color: s.color, size: s.fontSize, weight: s.fontWeight, family: s.fontFamily, radius: s.borderTopLeftRadius, line: s.lineHeight };
        b.remove();
        return r;
      });
      const got = await frame.evaluate(() => {
        const s = getComputedStyle(document.getElementById('aetherStart'));
        return { bg: s.backgroundImage, color: s.color, size: s.fontSize, weight: s.fontWeight, family: s.fontFamily, radius: s.borderTopLeftRadius, line: s.lineHeight };
      });
      assert.deepEqual(got, want);
      assert.equal(await frame.textContent('#aetherStart'), 'Spielen');

      // Rahmen folgt: Meldung über der Liste ("Cache leeren") verschiebt die Karte; Scrollen.
      await page.click('#clearCacheBtn');
      await page.waitForSelector('#message:not([hidden])');
      await page.waitForFunction((tol) => {
        const f = document.querySelector('#game iframe').getBoundingClientRect();
        const list = document.getElementById('buildList').getBoundingClientRect();
        return Math.abs(f.top - (list.bottom + 12)) <= tol;
      }, TOL);
      check(await measure(), 'nach Meldung');
      await page.evaluate(() => window.scrollTo(0, 60));
      check(await measure(), 'gescrollt');
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({ path: path.join(OUT, `rahmen-${label.replace(/\W+/g, '_')}.png`), fullPage: true });
      assert.deepEqual(log.errors, []);
      await context.close();
    });
  }
});

describe('Messhilfe ?fps=1', () => {
  test('mit ?fps=1 zeigt die Spielansicht die im iframe gemessene Bildrate', async () => {
    const { context, page, log } = await newPage(null, { query: '?fps=1' });
    const { handle, frame } = await startFrame(page);
    assert.match(await handle.getAttribute('srcdoc'), /\{"fps":true\}/);
    await frame.click('#aetherStart');
    await waitStarted(page, frame);
    await page.waitForFunction(() => /^\d+,\d fps$/.test(document.getElementById('gameFps').textContent));
    const s = await page.evaluate(() => {
      const el = document.getElementById('gameFps');
      const r = el.getBoundingClientRect();
      return { text: el.textContent, visible: r.width > 0 && r.height > 0, pe: getComputedStyle(el).pointerEvents };
    });
    assert.ok(s.visible);
    assert.equal(s.pe, 'none');
    const fps = Number(s.text.replace(' fps', '').replace(',', '.'));
    assert.ok(fps > 0 && fps < 1000, s.text);
    const m = (await msgs(page)).filter((x) => x.type === 'aether:fps');
    assert.ok(m.length >= 1 && m.every((x) => x.fromCurrent && typeof x.fps === 'number'));
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('ohne Parameter: keine Anzeige und keine Messung', async () => {
    const { context, page, log } = await newPage(null);
    const { handle, frame } = await startFrame(page);
    const srcdoc = await handle.getAttribute('srcdoc');
    assert.match(srcdoc, /\{"fps":false\}/);
    assert.doesNotMatch(srcdoc, /"fps":true/);
    await frame.click('#aetherStart');
    await waitStarted(page, frame);
    // 90 Bilder im iframe abwarten (mehr als eine Messperiode), dann darf nichts gemeldet worden sein.
    await frame.evaluate(() => new Promise((resolve) => { let n = 0; const t = () => (++n >= 90 ? resolve() : requestAnimationFrame(t)); requestAnimationFrame(t); }));
    assert.equal((await msgs(page)).filter((x) => x.type === 'aether:fps').length, 0);
    const s = await page.evaluate(() => { const el = document.getElementById('gameFps'); const r = el.getBoundingClientRect(); return { text: el.textContent, visible: r.width > 0 && r.height > 0 }; });
    assert.deepEqual(s, { text: '', visible: false });
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});
