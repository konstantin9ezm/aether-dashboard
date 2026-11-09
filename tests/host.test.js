// Tests der Schnittstelle Spiel ↔ Dashboard (Version 1): Einstellungs-Speicher und Feedback-Dialog.
// Läuft im vollen Chromium (channel "chromium"), weil nur dort mailto-Starts in der Konsole gemeldet werden.
// Aufruf: node --test tests/host.test.js
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
const SETTINGS_KEY = 'aether.gameSettings';
const TO = 'feedback.aether@gmail.com';
const CUT_NOTE = "(gekürzt – vollständig über 'Text kopieren')";

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Test-Spiel: meldet, was es vom Dashboard bekommt, und schickt auf Tastendruck Nachrichten.
// ---------------------------------------------------------------------------
const GAME_HTML = `<!doctype html><html lang=de><head><meta charset=utf-8><title>Host-Test</title>
<style>html,body{margin:0;height:100%;background:#123}</style></head>
<body><canvas id=canvas tabindex=0 style="width:100%;height:100%;display:block"></canvas>
<script>
  window.__t = {
    host: window.AETHER_HOST === undefined ? 'fehlt' : JSON.parse(JSON.stringify(window.AETHER_HOST)),
    settings: window.AETHER_HOST_SETTINGS === undefined ? 'fehlt' : JSON.parse(JSON.stringify(window.AETHER_HOST_SETTINGS)),
    states: [], keys: [], foreign: 0
  };
  window.addEventListener('message', function (e) {
    if (!e.data || e.data.type !== 'aether:feedback-state') return;
    if (e.source === window.parent) window.__t.states.push(e.data.open); else window.__t.foreign++;
  });
  // Test-Relais: Das Dashboard bittet das Spiel, eine Nachricht zu schicken (Quelle bleibt das Spiel-iframe).
  window.addEventListener('message', function (e) {
    if (e.source === window.parent && e.data && e.data.type === 'test:relay') window.parent.postMessage(e.data.msg, '*');
  });
  window.__fb = { subject: 'Rückmeldung: Ä & Ö = 100 % #1?', body: 'Zeile 1\\nZeile 2 mit &, ?, =, #, + und Emoji 🚀\\n<b>kein HTML</b>' };
  document.addEventListener('keydown', function (e) {
    window.__t.keys.push(e.key);
    if (e.key === 'f') window.parent.postMessage({ type: 'aether:feedback', subject: window.__fb.subject, body: window.__fb.body }, '*');
  });
  window.__t.ready = true;
</script><script src="spiel.js"></script></body></html>`;
const FILES = { 'index.html': Buffer.from(GAME_HTML), 'spiel.js': Buffer.from('window.__t.js = true;') };
const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const blobs = new Map(Object.values(FILES).map((b) => [gitSha(b), b]));
const BUILD = { commit: 'abc1234' + '0'.repeat(33), short: 'abc1234', message: 'Host-Test', date: '2026-11-08T10:00:00Z', path: 'builds/abc1234/' };

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
  if (headers.authorization !== `Bearer ${TOKEN}`) return json(route, 401, { message: 'Bad credentials' });
  const p = decodeURIComponent(new URL(req.url()).pathname);
  const base = `/repos/${OWNER}/${REPO}`;
  if (p === base) return json(route, 200, { full_name: `${OWNER}/${REPO}`, private: true });
  if (p === `${base}/branches/${REF}`) return json(route, 200, { name: REF });
  if (p === `${base}/contents/index.json`) {
    return route.fulfill({ status: 200, headers: { ...CORS, ...RATE(), 'content-type': 'application/vnd.github.raw+json' }, body: JSON.stringify([BUILD]) });
  }
  if (p === `${base}/contents/builds/abc1234`) {
    return json(route, 200, Object.entries(FILES).map(([name, buf]) => ({ name, path: `builds/abc1234/${name}`, sha: gitSha(buf), size: buf.length, type: 'file' })));
  }
  const m = /\/git\/blobs\/([0-9a-f]{40})$/.exec(p);
  if (m && blobs.has(m[1])) {
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
  // Volles Chromium (nicht die Headless-Shell): meldet "Launched external handler for 'mailto:…'".
  browser = await chromium.launch({ channel: 'chromium' });
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

async function newPage(deviceName, opts = {}) {
  const dev = deviceName ? { ...devices[deviceName] } : { viewport: { width: 1180, height: 820 } };
  const context = await browser.newContext({ ...dev, locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const log = { console: [], errors: [] };
  page.on('console', (m) => log.console.push(m.text()));
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await context.route('https://api.github.com/**', githubApi);
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  if (opts.settings !== undefined) {
    await page.addInitScript(([k, v]) => {
      if (window !== window.top) return; // läuft sonst auch im Spiel-iframe (dort ist Speicher gesperrt)
      if (!sessionStorage.getItem('seededSettings')) { localStorage.setItem(k, v); sessionStorage.setItem('seededSettings', '1'); }
    }, [SETTINGS_KEY, opts.settings]);
  }
  await page.addInitScript((t) => { if (window === window.top && !sessionStorage.getItem('seededToken')) { localStorage.setItem('aether.githubToken', t); sessionStorage.setItem('seededToken', '1'); } }, TOKEN);
  return { context, page, log };
}

const gameFrame = (page) => page.frames().find((f) => f !== page.mainFrame() && f.parentFrame() === page.mainFrame() && f.name() !== 'fremd');

async function startGame(page) {
  await page.waitForSelector('#buildsView:not([hidden])');
  // „Spielen“ ist ein Knopf IM Start-Rahmen (Spiel-iframe): echter Klick dort, nicht per evaluate.
  const start = await (await page.waitForSelector('#game.slot:not([hidden]) iframe')).contentFrame();
  await start.click('#aetherStart');
  await page.waitForFunction(() => document.querySelector('#game iframe') && !document.getElementById('game').hidden && !document.getElementById('game').classList.contains('slot'));
  let frame;
  while (!(frame = gameFrame(page))) await page.waitForEvent('frameattached');
  await frame.waitForFunction(() => window.__t && window.__t.ready && window.__t.js);
  // Spiel ist sichtbar und hat den Fokus ("started" verarbeitet).
  await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'IFRAME');
  return frame;
}
async function stopGameByX(page) {
  await page.click('#exitBtn'); // Rückfrage "Spiel beenden?" wird bestätigt
  await page.waitForSelector('#buildsView:not([hidden])');
}
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), SETTINGS_KEY);
const storedObj = async (page) => JSON.parse((await stored(page)) || 'null');
const post = (frame, msg) => frame.evaluate((m) => window.parent.postMessage(m, '*'), msg);
// Nachrichten einer Quelle werden in Reihenfolge verarbeitet: Ist der Wächter gespeichert, sind alle vorigen durch.
async function sentinel(page, frame, v) {
  await post(frame, { type: 'aether:setting', key: 'aether.waechter', value: v });
  await page.waitForFunction(([k, v]) => { try { return JSON.parse(localStorage.getItem(k))['aether.waechter'] === v; } catch (e) { return false; } }, [SETTINGS_KEY, v]);
}
// Fremde Quellen: die Seite selbst und ein zweites sandboxed iframe.
async function postFromForeign(page, msg) {
  await page.evaluate((m) => {
    window.postMessage(m, '*');
    const f = document.createElement('iframe');
    f.name = 'fremd';
    f.setAttribute('sandbox', 'allow-scripts');
    f.srcdoc = '<script>parent.postMessage(' + JSON.stringify(m).replace(/</g, '\\u003c') + ', "*"); parent.postMessage("fremd-fertig", "*");<\/script>';
    return new Promise((resolve) => {
      window.addEventListener('message', function h(e) { if (e.data === 'fremd-fertig') { window.removeEventListener('message', h); f.remove(); resolve(); } });
      document.body.appendChild(f);
    });
  }, msg);
}
const dialogOpen = (page) => page.evaluate(() => !document.getElementById('feedback').hidden);
const launched = (log) => log.console.filter((c) => c.startsWith('Launched external handler for'));
const expectedMailto = (s, b) => `mailto:${TO}?subject=${encodeURIComponent(s)}&body=${encodeURIComponent(b)}`;
async function waitLaunch(page, log, n) {
  // Auf die Konsolenmeldung warten, ohne im Seitenkontext etwas auszuführen.
  while (launched(log).length < n) await page.waitForEvent('console');
}
async function openFeedbackByKey(page, frame) {
  await page.keyboard.press('f'); // echte Taste im Spiel → aether:feedback
  await page.waitForSelector('#feedback:not([hidden])');
  await frame.waitForFunction(() => window.__t.states.includes(true));
}
// Controller-Zustand des Dialogs.
const PAD_BLOCKED = 'Per Controller nicht möglich – bitte antippen oder Enter drücken.';
const PAD_LINE = '◀ ▶ wechseln · Ⓐ auswählen · Ⓑ schließen';
const padState = (page) => page.evaluate(() => {
  const sel = [...document.querySelectorAll('#fbActions .btn.fb-sel')];
  const hint = document.getElementById('fbPadHint');
  const s = sel[0] && getComputedStyle(sel[0]);
  return {
    sel: sel.map((b) => b.id).join(),
    ring: s ? `${s.outlineWidth} ${s.outlineStyle} ${s.outlineColor}` : '',
    line: !hint.hidden && hint.getBoundingClientRect().height > 0,
    lineText: hint.textContent,
    focus: document.activeElement.id,
    status: document.getElementById('fbStatus').textContent,
    warn: document.getElementById('fbStatus').classList.contains('warn')
  };
});
const RING = '3px solid rgb(255, 255, 255)';
const input = (frame, action) => post(frame, { type: 'aether:dialog-input', action });
// Nachrichten des Spiels ohne jede Nutzeraktivierung: Jedes Playwright-evaluate zählt als Geste (userGesture)
// und aktiviert über das Spiel-iframe auch das Dashboard. Deshalb läuft alles per CDP ohne Geste in einem
// Schritt: warten, bis die Aktivierung im Dashboard abgelaufen ist, dann für jeden Schritt das Spiel über das
// Test-Relais `action` senden lassen und (weiter ohne Geste) auf den Status `want` warten. Liefert je Schritt
// die Zeit ab dem Senden.
async function padNoGesture(cdp, steps) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      const steps = ${JSON.stringify(steps)};
      const st = () => document.getElementById('fbStatus').textContent;
      const out = [];
      const idle = () => {
        if (navigator.userActivation.isActive) return setTimeout(idle, 50);
        next(0);
      };
      const next = (i) => {
        if (i === steps.length) return resolve({ out });
        const t0 = performance.now();
        document.querySelector('#game iframe').contentWindow.postMessage({ type: 'test:relay', msg: { type: 'aether:dialog-input', action: steps[i].action } }, '*');
        const wait = () => {
          if (st() === steps[i].want) { out.push({ ms: performance.now() - t0, active: navigator.userActivation.isActive }); return next(i + 1); }
          if (performance.now() - t0 > 20000) return resolve({ timeout: true, step: i, status: st() });
          setTimeout(wait, 5);
        };
        wait();
      };
      idle();
    })`,
    awaitPromise: true, returnByValue: true, userGesture: false
  });
  const v = r.result.value;
  assert.ok(!v.timeout, `Schritt ${v.step}: Status "${v.step === undefined ? '' : steps[v.step].want}" erwartet, ist "${v.status}"`);
  v.out.forEach((o, i) => assert.equal(o.active, false, `Dashboard blieb ohne Nutzeraktivierung (Schritt ${i})`));
  return v.out.map((o) => o.ms);
}
const pressNoGesture = async (cdp, wantStatus) => (await padNoGesture(cdp, [{ action: 'press', want: wantStatus }]))[0];
// Dasselbe MIT Nutzeraktivierung im Dashboard (CDP userGesture: true): meldet, ob die Aktivierung beim Senden
// aktiv war, und wartet auf den Status.
async function pressWithGesture(cdp, wantStatus) {
  const r = await cdp.send('Runtime.evaluate', {
    expression: `new Promise((resolve) => {
      const st = () => document.getElementById('fbStatus').textContent;
      const active = navigator.userActivation.isActive;
      const t0 = performance.now();
      document.querySelector('#game iframe').contentWindow.postMessage({ type: 'test:relay', msg: { type: 'aether:dialog-input', action: 'press' } }, '*');
      const wait = () => {
        if (st() === ${JSON.stringify(wantStatus)}) return resolve({ ms: performance.now() - t0, active });
        if (performance.now() - t0 > 20000) return resolve({ timeout: true, status: st() });
        setTimeout(wait, 5);
      };
      wait();
    })`,
    awaitPromise: true, returnByValue: true, userGesture: true
  });
  const v = r.result.value;
  assert.ok(!v.timeout, `Status "${wantStatus}" erwartet, ist "${v.status}"`);
  assert.equal(v.active, true, 'Dashboard hatte beim Senden Nutzeraktivierung');
  return v.ms;
}
// Jeder Navigationsversuch zu mailto: im Dashboard, auch ein vom Browser blockierter (ohne Nutzeraktivierung
// meldet Chromium dann keinen "Launched external handler", der Versuch erscheint aber hier).
async function mailtoAttempts(cdp) {
  const list = [];
  cdp.on('Page.frameRequestedNavigation', (e) => { if (e.url.startsWith('mailto:')) list.push(e.url); });
  await cdp.send('Page.enable');
  return list;
}
async function assertClosedAndFocused(page, frame, count) {
  await page.waitForSelector('#feedback', { state: 'hidden' });
  await frame.waitForFunction((n) => window.__t.states.filter((s) => s === false).length === n, count);
  await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'IFRAME');
  // Tastatur kommt wieder beim Spiel an.
  const before = (await frame.evaluate(() => window.__t.keys.length));
  await page.keyboard.press('x');
  await frame.waitForFunction((n) => window.__t.keys.length > n && window.__t.keys[window.__t.keys.length - 1] === 'x', before);
}

// ---------------------------------------------------------------------------
// Einstellungs-Speicher
// ---------------------------------------------------------------------------
describe('Spiel-Einstellungen', () => {
  test('Sandbox unverändert; AETHER_HOST vor den Spielskripten; ohne Einstellungen leeres Objekt', async () => {
    const { context, page, log } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    const attrs = await page.evaluate(() => ({ sandbox: document.querySelector('#game iframe').getAttribute('sandbox'), allow: document.querySelector('#game iframe').getAttribute('allow') }));
    assert.equal(attrs.sandbox, 'allow-scripts allow-pointer-lock');
    assert.ok(!attrs.sandbox.includes('allow-same-origin'));
    assert.equal(attrs.allow, 'gamepad *; fullscreen *; autoplay *');
    const t = await frame.evaluate(() => window.__t);
    assert.deepEqual(t.host, { version: 1, settings: true, feedback: true, dialogInput: true });
    assert.equal(t.host.dialogInput, true);
    assert.deepEqual(t.settings, {});
    assert.equal(await dialogOpen(page), false, 'ohne Nachricht kein Dialog');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('speichern, nach Schließen und Neustart im Spiel, null löscht, Token löschen lässt sie stehen', async () => {
    const { context, page, log } = await newPage(null);
    await page.goto(baseUrl);
    let frame = await startGame(page);
    await post(frame, { type: 'aether:setting', key: 'aether.touch.boost', value: 'true' });
    await post(frame, { type: 'aether:setting', key: 'aether.vol', value: '0.5' });
    await post(frame, { type: 'aether:setting', key: 'aether.alt', value: 'weg' });
    await sentinel(page, frame, '1');
    await post(frame, { type: 'aether:setting', key: 'aether.alt', value: null });
    await post(frame, { type: 'aether:setting', key: 'aether.nie-da', value: null });
    await sentinel(page, frame, '2');
    assert.deepEqual(await storedObj(page), { 'aether.touch.boost': 'true', 'aether.vol': '0.5', 'aether.waechter': '2' });

    await stopGameByX(page);
    frame = await startGame(page);
    assert.deepEqual(await frame.evaluate(() => window.__t.settings), { 'aether.touch.boost': 'true', 'aether.vol': '0.5', 'aether.waechter': '2' });

    // Auch nach Neuladen der Seite.
    await page.reload();
    frame = await startGame(page);
    assert.equal(await frame.evaluate(() => window.__t.settings['aether.touch.boost']), 'true');
    await stopGameByX(page);

    // "Token löschen" lässt die Spiel-Einstellungen unverändert.
    const vorher = await stored(page);
    await page.click('#deleteTokenBtn');
    await page.waitForSelector('#tokenView:not([hidden])');
    assert.equal(await page.evaluate(() => localStorage.getItem('aether.githubToken')), null);
    assert.equal(await stored(page), vorher);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('ungültige Schlüssel, Werte, Typen und fremde Quellen werden ignoriert', async () => {
    const { context, page } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    await post(frame, { type: 'aether:setting', key: 'aether.ok', value: 'ja' });
    await post(frame, { type: 'aether:setting', key: 'aether.max', value: 'm'.repeat(1024) });
    await sentinel(page, frame, 'a');
    const good = await stored(page);

    const bad = [
      { type: 'aether:setting', key: 'foo', value: 'x' },
      { type: 'aether:setting', key: 'aether.', value: 'x' },
      { type: 'aether:setting', key: 'aether.' + 'a'.repeat(65), value: 'x' },
      { type: 'aether:setting', key: 'aether.ä', value: 'x' },
      { type: 'aether:setting', key: 'aether.a b', value: 'x' },
      { type: 'aether:setting', key: 'Aether.x', value: 'x' },
      { type: 'aether:setting', key: 'aether.x\n', value: 'x' },
      { type: 'aether:setting', key: ' aether.x', value: 'x' },
      { type: 'aether:setting', key: 42, value: 'x' },
      { type: 'aether:setting', key: ['aether.x'], value: 'x' },
      { type: 'aether:setting', key: 'aether.ok', value: 'z'.repeat(1025) },
      { type: 'aether:setting', key: 'aether.ok', value: 5 },
      { type: 'aether:setting', key: 'aether.ok', value: true },
      { type: 'aether:setting', key: 'aether.ok', value: { a: 1 } },
      { type: 'aether:setting', key: 'aether.ok', value: ['x'] },
      { type: 'aether:setting', key: 'aether.ok' },
      { type: 'aether:setting ', key: 'aether.ok', value: 'falsch' },
      { type: 'AETHER:SETTING', key: 'aether.ok', value: 'falsch' },
      { type: 'aether:settings', key: 'aether.ok', value: 'falsch' },
      { aether: 'setting', key: 'aether.ok', value: 'falsch' },
      'aether:setting', null
    ];
    for (const m of bad) await post(frame, m);
    await postFromForeign(page, { type: 'aether:setting', key: 'aether.ok', value: 'fremd' });
    await postFromForeign(page, { type: 'aether:setting', key: 'aether.fremd', value: 'fremd' });
    await sentinel(page, frame, 'b');
    assert.equal(await stored(page), good.replace('"aether.waechter":"a"', '"aether.waechter":"b"'));
    assert.equal((await storedObj(page))['aether.max'].length, 1024);
    await context.close();
  });

  test('höchstens 64 Schlüssel', async () => {
    const { context, page } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    // Wächter zählt mit: 63 weitere + Wächter = 64.
    await sentinel(page, frame, '0');
    await frame.evaluate(() => { for (let i = 1; i <= 63; i++) window.parent.postMessage({ type: 'aether:setting', key: 'aether.k' + i, value: String(i) }, '*'); });
    await post(frame, { type: 'aether:setting', key: 'aether.zuviel', value: 'x' });
    await sentinel(page, frame, 'voll'); // vorhandener Schlüssel: Ändern geht auch bei 64
    let obj = await storedObj(page);
    assert.equal(Object.keys(obj).length, 64);
    assert.equal(obj['aether.zuviel'], undefined);
    assert.equal(obj['aether.k63'], '63');
    // Nach Löschen ist wieder Platz.
    await post(frame, { type: 'aether:setting', key: 'aether.k1', value: null });
    await post(frame, { type: 'aether:setting', key: 'aether.neu', value: 'n' });
    await sentinel(page, frame, 'fertig');
    obj = await storedObj(page);
    assert.equal(Object.keys(obj).length, 64);
    assert.equal(obj['aether.neu'], 'n');
    assert.equal(obj['aether.k1'], undefined);
    await context.close();
  });

  test('Wert mit "</script>" bricht nicht aus; kaputter Speicher = leeres Objekt', async () => {
    const evil = '</script><script>window.__pwned=1;parent.postMessage({type:"aether:quit"},"*")</script><!--   "\'\\';
    const { context, page, log } = await newPage(null, { settings: JSON.stringify({ 'aether.boese': evil, 'aether.gut': 'ok', 'kein.aether': 'x', 'aether.zahl': 3 }) });
    await page.goto(baseUrl);
    const frame = await startGame(page);
    const t = await frame.evaluate(() => ({ settings: window.__t.settings, pwned: window.__pwned, scripts: document.scripts.length }));
    assert.deepEqual(t.settings, { 'aether.boese': evil, 'aether.gut': 'ok' }, 'nur gültige Einträge, Wert unverändert');
    assert.equal(t.pwned, undefined, 'kein eingeschleustes Skript gelaufen');
    assert.ok(await page.evaluate(() => !!document.querySelector('#game iframe') && document.documentElement.classList.contains('playing')), 'Spiel läuft weiter');
    assert.deepEqual(log.errors, []);
    await context.close();

    // Kaputtes JSON bzw. falscher Typ im Speicher.
    for (const raw of ['{kaputt', '[1,2]', '"text"', 'null']) {
      const c = await newPage(null, { settings: raw });
      await c.page.goto(baseUrl);
      const f = await startGame(c.page);
      assert.deepEqual(await f.evaluate(() => window.__t.settings), {}, `Speicher ${raw}`);
      await post(f, { type: 'aether:setting', key: 'aether.neu', value: '1' });
      await c.page.waitForFunction((k) => localStorage.getItem(k) === '{"aether.neu":"1"}', SETTINGS_KEY);
      await c.context.close();
    }
  });
});

// ---------------------------------------------------------------------------
// Feedback-Dialog
// ---------------------------------------------------------------------------
describe('Feedback-Dialog', () => {
  test('öffnet nur aus dem Spiel mit exaktem type; zeigt Adresse und Text; Zustand kommt im Spiel an', async () => {
    const { context, page, log } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);

    for (const m of [
      { type: 'aether:Feedback', subject: 's', body: 'b' },
      { type: 'aether:feedback ', subject: 's', body: 'b' },
      { aether: 'feedback', subject: 's', body: 'b' },
      { type: 'aether:feedback', subject: 1, body: 'b' },
      { type: 'aether:feedback', subject: 's' },
      'aether:feedback'
    ]) await post(frame, m);
    await postFromForeign(page, { type: 'aether:feedback', subject: 'fremd', body: 'fremd' });
    await sentinel(page, frame, 'x');
    assert.equal(await dialogOpen(page), false, 'falsche Quelle / falscher type öffnet nicht');
    assert.deepEqual(await frame.evaluate(() => window.__t.states), []);

    // Fremdes feedback-close darf einen offenen Dialog nicht schließen.
    await openFeedbackByKey(page, frame);
    await postFromForeign(page, { type: 'aether:feedback-close' });
    await sentinel(page, frame, 'y');
    assert.equal(await dialogOpen(page), true);

    const fb = await frame.evaluate(() => window.__fb);
    const ui = await page.evaluate(() => ({
      title: document.getElementById('fbTitle').textContent,
      to: document.querySelector('#feedback .fb-to').textContent,
      text: document.getElementById('fbText').value,
      readonly: document.getElementById('fbText').readOnly,
      html: document.getElementById('fbText').innerHTML,
      buttons: [...document.querySelectorAll('#fbActions button')].map((b) => b.textContent),
      hint: document.querySelector('#feedback .fb-hint').textContent,
      focus: document.activeElement.id,
      boldInjected: !!document.querySelector('#feedback b:not(#fbTo)')
    }));
    assert.equal(ui.title, 'Feedback senden');
    assert.equal(ui.to, `An: ${TO}`);
    assert.equal(ui.text, `Betreff: ${fb.subject}\n\n${fb.body}`);
    assert.ok(ui.readonly);
    assert.equal(ui.boldInjected, false, 'Text wird nicht als HTML eingesetzt');
    assert.deepEqual(ui.buttons, ['Mail öffnen', 'Text kopieren', 'Schließen']);
    assert.equal(ui.hint, 'Keine Mail-App? Text kopieren und an die Adresse oben schicken.');
    assert.equal(ui.focus, 'fbMail', '"Mail öffnen" hat beim Öffnen den Fokus');
    assert.deepEqual(await frame.evaluate(() => window.__t.states), [true]);
    assert.equal(await frame.evaluate(() => window.__t.foreign), 0);
    assert.equal(launched(log).length, 0, 'Öffnen startet keine Mail');

    // Lange Texte werden gekürzt (subject 200, body 4000).
    await post(frame, { type: 'aether:feedback', subject: 'S'.repeat(300), body: 'B'.repeat(5000) + '\uD800' });
    await page.waitForFunction(() => document.getElementById('fbText').value.startsWith('Betreff: SSS') );
    assert.equal(await page.inputValue('#fbText'), `Betreff: ${'S'.repeat(200)}\n\n${'B'.repeat(4000)}`);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('"Mail öffnen" per echtem Klick und per Enter startet den korrekt kodierten mailto-Link; Dialog bleibt offen', async () => {
    const { context, page, log } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    const fb = await frame.evaluate(() => window.__fb);
    const want = `Launched external handler for '${expectedMailto(fb.subject, fb.body)}'.`;
    assert.ok(expectedMailto(fb.subject, fb.body).includes('%C3%84%20%26%20%C3%96%20%3D%20100%20%25%20%231%3F'), 'Testtext enthält Sonderzeichen');

    await openFeedbackByKey(page, frame);
    assert.equal(launched(log).length, 0);
    await page.locator('#fbMail').click();
    await waitLaunch(page, log, 1);
    assert.deepEqual(launched(log), [want]);
    assert.equal(await dialogOpen(page), true, 'Dialog bleibt nach "Mail öffnen" offen');

    // Per Tastatur: Fokus liegt nach dem Öffnen auf "Mail öffnen", Enter löst aus.
    await page.keyboard.press('Escape');
    await assertClosedAndFocused(page, frame, 1);
    await openFeedbackByKey(page, frame);
    await page.keyboard.press('Enter');
    await waitLaunch(page, log, 2);
    assert.deepEqual(launched(log), [want, want]);

    // Leertaste nach Pfeiltasten-Runde (rechts ×3 = wieder "Mail öffnen").
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    await page.keyboard.press(' ');
    await waitLaunch(page, log, 3);
    assert.equal(launched(log).length, 3);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Überlänge: mailto-Link ≤ 2000 Zeichen, Text von hinten gekürzt mit Hinweis', async () => {
    const { context, page, log } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    // < 4000 Zeichen (wird also nicht schon beim Empfang gekürzt), kodiert aber weit über 2000.
    const body = Array.from({ length: 150 }, (_, i) => `Zeile ${i}: Ä ö ü & 🚀`).join('\n');
    assert.ok(body.length < 4000 && encodeURIComponent(body).length > 4000);
    await frame.evaluate((b) => { window.__fb.body = b; }, body);
    await openFeedbackByKey(page, frame);
    await page.locator('#fbMail').click();
    await waitLaunch(page, log, 1);
    const url = /^Launched external handler for '(.*)'\.$/.exec(launched(log)[0])[1];
    assert.ok(url.length <= 2000, `Länge ${url.length}`);
    assert.ok(url.length > 1900, `nicht unnötig stark gekürzt: ${url.length}`);
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1).replace(/\+/g, '%2B'));
    assert.ok(url.startsWith(`mailto:${TO}?subject=${encodeURIComponent('Rückmeldung: Ä & Ö = 100 % #1?')}&body=`));
    const sentBody = params.get('body');
    assert.ok(sentBody.endsWith('\n\n' + CUT_NOTE), 'Hinweis angehängt');
    assert.ok(body.startsWith(sentBody.slice(0, -(CUT_NOTE.length + 2))), 'Anfang des Textes bleibt erhalten');
    // Vorschau zeigt weiterhin den vollständigen Text.
    assert.ok((await page.inputValue('#fbText')).endsWith('Zeile 149: Ä ö ü & 🚀'));
    await context.close();
  });

  test('"Text kopieren" legt Betreff und Text in die Zwischenablage', async () => {
    const { context, page } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    const fb = await frame.evaluate(() => window.__fb);
    await openFeedbackByKey(page, frame);
    await page.locator('#fbCopy').click();
    await page.waitForFunction(() => document.getElementById('fbStatus').textContent === 'Kopiert');
    assert.equal(await dialogOpen(page), true);

    // In separatem Kontext mit Leserecht auslesen.
    const reader = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const rp = await reader.newPage();
    await reader.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await rp.goto(baseUrl + 'manifest.json');
    const clip = await rp.evaluate(() => navigator.clipboard.readText());
    assert.equal(clip, `Betreff: ${fb.subject}\n\n${fb.body}`);
    await reader.close();
    await context.close();
  });

  test('Schließen über Esc, Knopf, Antippen außerhalb und aether:feedback-close; danach Fokus im Spiel', async () => {
    const { context, page } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);

    await openFeedbackByKey(page, frame);
    await page.keyboard.press('Escape');
    await assertClosedAndFocused(page, frame, 1);

    await openFeedbackByKey(page, frame);
    // Tab / Umschalt+Tab bleiben im Dialog.
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'fbCopy');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'fbClose');
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'fbMail');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'fbClose');
    await page.keyboard.press('ArrowLeft');
    assert.equal(await page.evaluate(() => document.activeElement.id), 'fbCopy');
    await page.locator('#fbClose').click();
    await assertClosedAndFocused(page, frame, 2);

    await openFeedbackByKey(page, frame);
    const vp = page.viewportSize();
    await page.mouse.click(Math.round(vp.width / 2), vp.height - 3); // Hintergrund unterhalb des Dialogs
    await assertClosedAndFocused(page, frame, 3);

    await openFeedbackByKey(page, frame);
    // Klick in den Dialog schließt nicht.
    await page.click('#fbTitle');
    assert.equal(await dialogOpen(page), true);
    await post(frame, { type: 'aether:feedback-close' }); // z. B. Controller B
    await assertClosedAndFocused(page, frame, 4);

    // feedback-close ohne offenen Dialog: keine weitere Zustandsmeldung.
    await post(frame, { type: 'aether:feedback-close' });
    await sentinel(page, frame, 'z');
    assert.deepEqual(await frame.evaluate(() => window.__t.states), [true, false, true, false, true, false, true, false]);
    await context.close();
  });

  test('Beenden des Spiels (X oder aether:quit) schließt den Dialog', async () => {
    const { context, page } = await newPage(null);
    const dialogs = [];
    page.on('dialog', (d) => dialogs.push(d.message()));
    await page.goto(baseUrl);
    let frame = await startGame(page);
    const gameIframe = await page.$('#game iframe');
    await openFeedbackByKey(page, frame);
    await page.click('#exitBtn');
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.deepEqual(dialogs, ['Spiel beenden?'], 'X fragt weiter nach');
    assert.equal(await dialogOpen(page), false);
    assert.equal(await gameIframe.evaluate((f) => f.isConnected), false, 'Spiel-iframe entfernt');
    assert.equal(await page.evaluate(() => document.documentElement.classList.contains('playing')), false);

    frame = await startGame(page);
    assert.equal(await dialogOpen(page), false, 'neues Spiel startet ohne Dialog');
    await openFeedbackByKey(page, frame);
    await post(frame, { type: 'aether:quit' });
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.equal(await dialogOpen(page), false);
    assert.equal(dialogs.length, 1, 'aether:quit ohne Rückfrage');
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Feedback-Dialog: Controller-Bedienung (aether:dialog-input)
// ---------------------------------------------------------------------------
describe('Feedback-Dialog: Controller', () => {
  test('nur aus dem Spiel und nur bei offenem Dialog; unbekannte action ignoriert; Zusatzfelder stören nicht', async () => {
    const { context, page, log } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);

    // Geschlossener Dialog: nichts passiert, auch später beim Öffnen nicht.
    for (const a of ['show', 'next', 'next', 'press', 'prev']) await input(frame, a);
    await sentinel(page, frame, 'zu');
    assert.equal(await dialogOpen(page), false);
    assert.deepEqual(await frame.evaluate(() => window.__t.states), []);
    assert.equal(await page.evaluate(() => document.getElementById('feedback').classList.contains('fb-pad')), false);

    await openFeedbackByKey(page, frame);
    const start = await padState(page);
    assert.equal(start.sel, 'fbMail', 'beim Öffnen ist "Mail öffnen" gewählt');
    assert.equal(start.line, false, 'Hinweiszeile zunächst unsichtbar');
    assert.notEqual(start.ring, RING, 'Rahmen zunächst unsichtbar');
    assert.equal(start.lineText, PAD_LINE);

    // Fremde Quellen.
    for (const a of ['show', 'next', 'press']) await postFromForeign(page, { type: 'aether:dialog-input', action: a });
    await sentinel(page, frame, 'fremd');
    assert.deepEqual(await padState(page), start, 'fremde Quelle ändert nichts');
    assert.equal(await dialogOpen(page), true);

    // Unbekannte actions und falsche types.
    for (const m of [
      { type: 'aether:dialog-input', action: 'Next' },
      { type: 'aether:dialog-input', action: 'next ' },
      { type: 'aether:dialog-input', action: 'left' },
      { type: 'aether:dialog-input', action: 'toString' },
      { type: 'aether:dialog-input', action: 1 },
      { type: 'aether:dialog-input', action: ['next'] },
      { type: 'aether:dialog-input', action: null },
      { type: 'aether:dialog-input' },
      { type: 'aether:dialog-input ', action: 'next' },
      { type: 'aether:Dialog-input', action: 'next' },
      { aether: 'dialog-input', action: 'next' },
      'aether:dialog-input'
    ]) await post(frame, m);
    await sentinel(page, frame, 'unbekannt');
    assert.deepEqual(await padState(page), start, 'unbekannte action ändert nichts');
    assert.equal(await dialogOpen(page), true);

    // Zusätzliche Felder werden ignoriert, die action gilt.
    await post(frame, { type: 'aether:dialog-input', action: 'next', extra: 'x', subject: 'egal' });
    await page.waitForFunction(() => document.querySelector('#fbActions .fb-sel').id === 'fbCopy');
    assert.deepEqual(await frame.evaluate(() => window.__t.states), [true]);
    assert.equal(launched(log).length, 0);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('show/prev/next: Rahmen sichtbar, Auswahl wandert ohne Umlauf; Antippen blendet aus', async () => {
    const { context, page, log } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    await openFeedbackByKey(page, frame);

    await input(frame, 'show');
    await page.waitForFunction(() => document.getElementById('feedback').classList.contains('fb-pad'));
    let st = await padState(page);
    assert.equal(st.sel, 'fbMail', 'show bewegt die Auswahl nicht');
    assert.equal(st.ring, RING);
    assert.equal(st.line, true, 'Hinweiszeile sichtbar');

    const steps = [['prev', 'fbMail'], ['next', 'fbCopy'], ['next', 'fbClose'], ['next', 'fbClose'], ['next', 'fbClose'], ['prev', 'fbCopy'], ['prev', 'fbMail'], ['prev', 'fbMail'], ['next', 'fbCopy']];
    for (const [i, [a, want]] of steps.entries()) {
      await input(frame, a);
      await sentinel(page, frame, 's' + i);
      st = await padState(page);
      assert.equal(st.sel, want, `${a} → ${want} (Schritt ${i})`);
      assert.equal(st.ring, RING);
      assert.equal(st.focus, want, 'Tastatur-Fokus folgt der Auswahl');
      assert.equal(st.line, true);
    }
    assert.equal(await dialogOpen(page), true, 'prev/next lösen nichts aus');
    assert.equal(launched(log).length, 0);

    // Antippen/Klick im Dialog blendet Rahmen und Hinweiszeile aus; Dialog bleibt offen.
    await page.click('#fbTitle');
    await page.waitForFunction(() => !document.getElementById('feedback').classList.contains('fb-pad'));
    st = await padState(page);
    assert.notEqual(st.ring, RING);
    assert.equal(st.line, false);
    assert.equal(await dialogOpen(page), true);

    // Neues Öffnen: wieder "Mail öffnen", Rahmen aus; next ohne show macht ihn gleich sichtbar.
    await input(frame, 'show');
    await input(frame, 'next');
    await sentinel(page, frame, 'vor-zu');
    await post(frame, { type: 'aether:feedback-close' });
    await assertClosedAndFocused(page, frame, 1);
    await openFeedbackByKey(page, frame);
    st = await padState(page);
    assert.equal(st.sel, 'fbMail');
    assert.equal(st.line, false);
    await input(frame, 'next');
    await sentinel(page, frame, 'n');
    st = await padState(page);
    assert.equal(st.sel, 'fbCopy');
    assert.equal(st.ring, RING);
    assert.equal(st.line, true);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('press auf "Schließen" schließt wie der Knopf (open:false, Fokus im Spiel)', async () => {
    const { context, page, log } = await newPage(null);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    await openFeedbackByKey(page, frame);
    for (const a of ['next', 'next', 'press']) await input(frame, a);
    await assertClosedAndFocused(page, frame, 1);
    assert.deepEqual(await frame.evaluate(() => window.__t.states), [true, false]);
    assert.equal(await page.evaluate(() => document.getElementById('feedback').classList.contains('fb-pad')), false);
    // Nach dem Schließen wirkt press nicht mehr.
    await input(frame, 'press');
    await sentinel(page, frame, 'danach');
    assert.deepEqual(await frame.evaluate(() => window.__t.states), [true, false]);
    assert.equal(launched(log).length, 0);
    await context.close();
  });

  test('press auf "Text kopieren" und "Mail öffnen" ohne Nutzeraktion: Hinweis (Mail sofort, ohne mailto-Versuch, auch beim 2. und 3. Druck); Antippen und Enter gehen weiter', async () => {
    const { context, page, log } = await newPage(null);
    const cdp = await context.newCDPSession(page);
    const attempts = await mailtoAttempts(cdp);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    const fb = await frame.evaluate(() => window.__fb);
    await openFeedbackByKey(page, frame);

    // Text kopieren: Zwischenablage verweigert (keine Nutzeraktivierung) → Hinweis, kein Markieren der Vorschau.
    await input(frame, 'next');
    await sentinel(page, frame, 'k');
    await pressNoGesture(cdp, PAD_BLOCKED);
    let st = await padState(page);
    assert.equal(st.warn, true);
    assert.equal(st.focus, 'fbCopy', 'Fokus bleibt auf dem Knopf');
    assert.equal(await dialogOpen(page), true);

    // Der Hinweis verschwindet bei der nächsten Eingabe.
    await input(frame, 'show');
    await page.waitForFunction(() => document.getElementById('fbStatus').textContent === '');

    // Mail öffnen per Controller: kein mailto-Versuch, Hinweis sofort – dreimal hintereinander, dazwischen
    // blendet "show" den Hinweis aus (alles ohne Nutzeraktivierung).
    await input(frame, 'prev');
    await sentinel(page, frame, 'm');
    assert.equal((await padState(page)).sel, 'fbMail');
    const ms = await padNoGesture(cdp, [
      { action: 'press', want: PAD_BLOCKED }, { action: 'show', want: '' },
      { action: 'press', want: PAD_BLOCKED }, { action: 'show', want: '' },
      { action: 'press', want: PAD_BLOCKED }
    ]);
    // Sofort heißt: weit unter der früheren Erkennungszeit von 1500 ms (zwei postMessage-Wege, 5-ms-Abfrage).
    for (const i of [0, 2, 4]) assert.ok(ms[i] < 500, `Hinweis nach ${ms[i]} ms (Druck ${i / 2 + 1})`);
    st = await padState(page);
    assert.equal(st.warn, true);
    assert.equal(st.sel, 'fbMail');
    assert.equal(st.focus, 'fbMail', 'Fokus bleibt auf "Mail öffnen"');
    assert.equal(await dialogOpen(page), true);
    assert.deepEqual(attempts, [], 'kein mailto-Versuch bei press auf "Mail öffnen"');
    const launchesAfterPress = launched(log).length;
    assert.equal(launchesAfterPress, 0);

    // Antippen im Dialog blendet den Hinweis aus.
    await page.click('#fbTitle');
    await page.waitForFunction(() => document.getElementById('fbStatus').textContent === '');

    // Hinweis verschwindet auch beim Schließen.
    await input(frame, 'next');
    await pressNoGesture(cdp, PAD_BLOCKED);
    await post(frame, { type: 'aether:feedback-close' });
    await assertClosedAndFocused(page, frame, 1);
    assert.equal(await page.evaluate(() => document.getElementById('fbStatus').textContent), '');

    // Antippen und Enter funktionieren weiter wie bisher.
    await openFeedbackByKey(page, frame);
    await input(frame, 'show');
    await page.locator('#fbCopy').click();
    await page.waitForFunction(() => document.getElementById('fbStatus').textContent === 'Kopiert');
    const want = `Launched external handler for '${expectedMailto(fb.subject, fb.body)}'.`;
    await page.locator('#fbMail').focus();
    await page.keyboard.press('Enter');
    await waitLaunch(page, log, launchesAfterPress + 1);
    assert.equal(launched(log)[launchesAfterPress], want);
    await page.locator('#fbMail').click();
    await waitLaunch(page, log, launchesAfterPress + 2);
    assert.equal(launched(log)[launchesAfterPress + 1], want);
    // Der Zähler sieht mailto-Versuche (Enter und Klick), also ist das leere Ergebnis oben aussagekräftig.
    assert.deepEqual(attempts, [expectedMailto(fb.subject, fb.body), expectedMailto(fb.subject, fb.body)]);
    assert.equal(await dialogOpen(page), true);
    assert.equal((await padState(page)).status, 'Kopiert');

    // Zwischenablage enthält den per Klick kopierten Text.
    const reader = await browser.newContext({ permissions: ['clipboard-read', 'clipboard-write'] });
    const rp = await reader.newPage();
    await reader.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
    await rp.goto(baseUrl + 'manifest.json');
    assert.equal(await rp.evaluate(() => navigator.clipboard.readText()), `Betreff: ${fb.subject}\n\n${fb.body}`);
    await reader.close();
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('press auf "Mail öffnen" MIT Nutzeraktivierung im Dashboard: ebenfalls nur Hinweis, kein mailto-Versuch', async () => {
    const { context, page, log } = await newPage(null);
    const cdp = await context.newCDPSession(page);
    const attempts = await mailtoAttempts(cdp);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    await openFeedbackByKey(page, frame);
    await input(frame, 'show');
    await sentinel(page, frame, 'a');
    assert.equal((await padState(page)).sel, 'fbMail');
    for (let i = 0; i < 3; i++) {
      const ms = await pressWithGesture(cdp, PAD_BLOCKED);
      assert.ok(ms < 500, `Hinweis nach ${ms} ms (Druck ${i + 1})`);
      await input(frame, 'show');
      await page.waitForFunction(() => document.getElementById('fbStatus').textContent === '');
    }
    assert.equal(await dialogOpen(page), true);
    await sentinel(page, frame, 'b');
    assert.deepEqual(attempts, [], 'kein mailto-Versuch, auch wenn die Seite gerade aktiviert ist');
    assert.equal(launched(log).length, 0);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Enter auf "Mail öffnen" kommt als echte Taste im Dashboard an (nicht im Spiel-iframe) und startet mailto, auch nach Controller-Auswahl', async () => {
    const { context, page, log } = await newPage(null);
    const cdp = await context.newCDPSession(page);
    const attempts = await mailtoAttempts(cdp);
    await page.goto(baseUrl);
    const frame = await startGame(page);
    const fb = await frame.evaluate(() => window.__fb);
    const url = expectedMailto(fb.subject, fb.body);
    const want = `Launched external handler for '${url}'.`;
    const gameKeys = () => frame.evaluate(() => window.__t.keys.slice());

    // Dialog per Taste im Spiel geöffnet (Fokus lag im iframe): Danach hat "Mail öffnen" im Dashboard den Fokus.
    await openFeedbackByKey(page, frame);
    assert.equal((await padState(page)).focus, 'fbMail');
    const keysBefore = await gameKeys();
    await page.keyboard.press('Enter');
    await waitLaunch(page, log, 1);
    assert.deepEqual(launched(log), [want]);

    // Pfeiltasten-Runde (rechts ×3 = wieder "Mail öffnen") + Enter.
    for (let i = 0; i < 3; i++) await page.keyboard.press('ArrowRight');
    assert.equal((await padState(page)).focus, 'fbMail');
    await page.keyboard.press('Enter');
    await waitLaunch(page, log, 2);

    // Auswahl per Controller (next, prev → Fokus folgt), dann Enter.
    await input(frame, 'next');
    await input(frame, 'prev');
    await sentinel(page, frame, 'c');
    assert.equal((await padState(page)).focus, 'fbMail');
    await page.keyboard.press('Enter');
    await waitLaunch(page, log, 3);
    assert.deepEqual(launched(log), [want, want, want]);
    assert.deepEqual(attempts, [url, url, url]);
    // Keine dieser Tasten ist im Spiel angekommen (dort würde sie seit aether PR #31 als Controller zählen).
    assert.deepEqual(await gameKeys(), keysBefore);
    assert.equal(await dialogOpen(page), true);
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------
describe('Feedback-Dialog: Layout', () => {
  for (const dev of ['iPhone 16 Pro landscape', 'iPad Pro 11 landscape', null]) {
    const label = dev || 'Desktop';
    test(`vollständig sichtbar, Knöpfe ≥ 44 px, Vorschau scrollt innen (${label})`, async () => {
      const { context, page } = await newPage(dev);
      await page.goto(baseUrl);
      const frame = await startGame(page);
      await frame.evaluate(() => { window.__fb.body = Array.from({ length: 120 }, (_, i) => 'Zeile ' + i).join('\n'); });
      await page.keyboard.press('f');
      await page.waitForSelector('#feedback:not([hidden])');
      const g = await page.evaluate(() => {
        const r = (el) => el.getBoundingClientRect().toJSON();
        const ta = document.getElementById('fbText');
        return {
          vw: window.innerWidth, vh: window.innerHeight,
          box: r(document.querySelector('#feedback .fb-box')),
          parts: ['fbTitle', 'fbTo', 'fbText', 'fbMail', 'fbCopy', 'fbClose'].map((id) => ({ id, ...r(document.getElementById(id)) }))
            .concat([{ id: 'hint', ...r(document.querySelector('#feedback .fb-hint')) }]),
          bar: r(document.getElementById('gameBar')),
          taScroll: ta.scrollHeight > ta.clientHeight, taOverflow: getComputedStyle(ta).overflowY, taH: ta.clientHeight,
          docScroll: document.documentElement.scrollWidth - window.innerWidth
        };
      });
      for (const p of [g.box, ...g.parts]) {
        assert.ok(p.left >= 0 && p.top >= 0 && p.right <= g.vw + 0.5 && p.bottom <= g.vh + 0.5, `${p.id || 'Dialog'} sichtbar: ${JSON.stringify(p)} in ${g.vw}×${g.vh}`);
        assert.ok(p.top >= g.box.top - 0.5 && p.bottom <= g.box.bottom + 0.5, `${p.id || 'Dialog'} nicht abgeschnitten`);
      }
      const overlap = !(g.bar.right <= g.box.left || g.bar.left >= g.box.right || g.bar.bottom <= g.box.top || g.bar.top >= g.box.bottom);
      assert.equal(overlap, false, `Knöpfe oben links verdecken den Dialog nicht: ${JSON.stringify(g.bar)} / ${JSON.stringify(g.box)}`);
      for (const id of ['fbMail', 'fbCopy', 'fbClose']) assert.ok(g.parts.find((p) => p.id === id).height >= 44, `${id} ≥ 44 px`);
      assert.ok(g.taScroll && g.taOverflow === 'auto', 'Text-Vorschau scrollt innen');
      assert.ok(g.taH >= 40, `Vorschau hat sichtbare Höhe: ${g.taH}`);
      assert.ok(g.docScroll <= 0);
      // Scrollen in der Vorschau verändert nur die Vorschau.
      await page.hover('#fbText');
      await page.mouse.wheel(0, 300);
      await page.waitForFunction(() => document.getElementById('fbText').scrollTop > 0);
      await page.screenshot({ path: path.join(OUT, `feedback-${label.replace(/\W+/g, '_')}.png`) });
      // Antippen außerhalb des Dialogs (Touch auf iPhone/iPad, sonst Maus) schließt.
      const at = [Math.round(g.vw / 2), Math.round(Math.min(g.vh - 2, g.box.bottom + (g.vh - g.box.bottom) / 2))];
      if (g.box.bottom >= g.vh - 2) { at[0] = Math.max(2, Math.round(g.box.left / 2)); at[1] = Math.round(g.vh / 2); }
      if (dev) await page.touchscreen.tap(at[0], at[1]); else await page.mouse.click(at[0], at[1]);
      await page.waitForSelector('#feedback', { state: 'hidden' });
      await frame.waitForFunction(() => window.__t.states.join() === 'true,false');
      await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'IFRAME');
      await context.close();
    });

    test(`Controller-Rahmen und Hinweiszeile überdecken nichts, Knöpfe unverändert (${label})`, async () => {
      const { context, page } = await newPage(dev);
      await page.goto(baseUrl);
      const frame = await startGame(page);
      await frame.evaluate(() => { window.__fb.body = Array.from({ length: 120 }, (_, i) => 'Zeile ' + i).join('\n'); });
      await openFeedbackByKey(page, frame);
      const rects = () => page.evaluate(() => {
        const r = (el) => el.getBoundingClientRect().toJSON();
        const sel = document.querySelector('#fbActions .btn.fb-sel');
        const cs = getComputedStyle(sel);
        const grow = parseFloat(cs.outlineWidth) + parseFloat(cs.outlineOffset);
        const b = r(sel);
        return {
          vw: window.innerWidth, vh: window.innerHeight,
          box: r(document.querySelector('#feedback .fb-box')),
          sel: sel.id, grow,
          ring: { left: b.left - grow, top: b.top - grow, right: b.right + grow, bottom: b.bottom + grow },
          parts: ['fbTitle', 'fbTo', 'fbText', 'fbMail', 'fbCopy', 'fbClose', 'fbPadHint'].map((id) => ({ id, ...r(document.getElementById(id)) }))
            .concat([{ id: 'hint', ...r(document.querySelector('#feedback .fb-hint')) }, { id: 'fbStatus', ...r(document.getElementById('fbStatus')) }]),
          bar: r(document.getElementById('gameBar')),
          docScroll: document.documentElement.scrollWidth - window.innerWidth
        };
      });
      const before = await rects();
      const size = (g, id) => { const p = g.parts.find((x) => x.id === id); return [Math.round(p.width * 10) / 10, Math.round(p.height * 10) / 10]; };
      const hit = (a, b) => !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
      await input(frame, 'show');
      for (const [i, want] of ['fbMail', 'fbCopy', 'fbClose'].entries()) {
        if (i) await input(frame, 'next');
        await page.waitForFunction((id) => document.querySelector('#fbActions .fb-sel').id === id && document.getElementById('feedback').classList.contains('fb-pad'), want);
        const g = await rects();
        assert.equal(g.sel, want);
        assert.ok(g.grow >= 3, `Rahmen sichtbar: ${g.grow}`);
        for (const id of ['fbMail', 'fbCopy', 'fbClose']) assert.deepEqual(size(g, id), size(before, id), `${id}: Größe unverändert`);
        for (const id of ['fbMail', 'fbCopy', 'fbClose']) assert.ok(g.parts.find((p) => p.id === id).height >= 44);
        // Rahmen innerhalb des Dialogs (nicht abgeschnitten) und auf keinem anderen Element.
        assert.ok(g.ring.left >= g.box.left && g.ring.right <= g.box.right && g.ring.top >= g.box.top && g.ring.bottom <= g.box.bottom, `Rahmen im Dialog: ${JSON.stringify(g.ring)} / ${JSON.stringify(g.box)}`);
        for (const p of g.parts) {
          if (p.id === want || p.height === 0) continue;
          assert.equal(hit(g.ring, p), false, `Rahmen um ${want} überdeckt ${p.id}: ${JSON.stringify(g.ring)} / ${JSON.stringify(p)}`);
        }
        // Alle Teile (inkl. Hinweiszeile) vollständig sichtbar und überlappungsfrei.
        const pad = g.parts.find((p) => p.id === 'fbPadHint');
        assert.ok(pad.height > 0, 'Hinweiszeile sichtbar');
        for (const p of [g.box, ...g.parts]) {
          if (p.height === 0) continue;
          assert.ok(p.left >= 0 && p.top >= 0 && p.right <= g.vw + 0.5 && p.bottom <= g.vh + 0.5, `${p.id || 'Dialog'} sichtbar: ${JSON.stringify(p)} in ${g.vw}×${g.vh}`);
          assert.ok(p.top >= g.box.top - 0.5 && p.bottom <= g.box.bottom + 0.5, `${p.id || 'Dialog'} nicht abgeschnitten`);
        }
        const others = g.parts.filter((p) => p.height > 0);
        for (let a = 0; a < others.length; a++) {
          for (let b = a + 1; b < others.length; b++) assert.equal(hit(others[a], others[b]), false, `${others[a].id} überlappt ${others[b].id}`);
        }
        assert.ok(pad.top >= Math.max(...['fbMail', 'fbCopy', 'fbClose'].map((id) => g.parts.find((p) => p.id === id).bottom)), 'Hinweiszeile unter den Knöpfen');
        assert.equal(hit(g.bar, g.box), false, 'Knöpfe oben links verdecken den Dialog nicht');
        assert.ok(g.docScroll <= 0);
      }
      await page.screenshot({ path: path.join(OUT, `feedback-controller-${label.replace(/\W+/g, '_')}.png`) });
      // Antippen im Dialog blendet Rahmen und Zeile aus.
      const t = before.parts.find((p) => p.id === 'fbTitle');
      if (dev) await page.touchscreen.tap(Math.round(t.left + 10), Math.round(t.top + t.height / 2)); else await page.mouse.click(Math.round(t.left + 10), Math.round(t.top + t.height / 2));
      await page.waitForFunction(() => !document.getElementById('feedback').classList.contains('fb-pad') && document.getElementById('fbPadHint').hidden);
      const after = await rects();
      for (const id of ['fbMail', 'fbCopy', 'fbClose']) assert.deepEqual(size(after, id), size(before, id));
      assert.equal(await dialogOpen(page), true);
      await context.close();
    });
  }
});
