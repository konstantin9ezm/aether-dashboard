// Tests „Speichern bestätigen“, „Nur ein Fenster speichert“ und „Speicher-Schutz“ (Ergänzungen zur Schnittstelle
// Spiel ↔ Dashboard Version 1, siehe README): Sammel-Nachricht aether:settings (alle oder keiner), Antwort
// aether:settings-ack (nur mit id), Hinweis „Speichern nicht möglich“ / „Wieder gespeichert“, Web Locks bzw.
// BroadcastChannel mit zwei Seiten im selben Browser-Kontext, navigator.storage.persist().
// Läuft in Headless Chromium mit nachgebauter GitHub-API und einem Test-Spiel (nur Platzhalter).
// Aufruf: node --test tests/speichern.test.js
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
const TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
const OWNER = 'konstantin9ezm';
const REPO = 'aether';
const REF = 'web-build';
const SETTINGS_KEY = 'aether.gameSettings';
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Test-Spiel: merkt sich Antworten des Dashboards (aether:settings-ack) und schickt auf Wunsch Nachrichten.
// ---------------------------------------------------------------------------
const GAME_HTML = `<!doctype html><html lang=de><head><meta charset=utf-8><title>Speicher-Test</title>
<style>html,body{margin:0;height:100%;background:#123}</style></head>
<body><canvas id=canvas tabindex=0 style="width:100%;height:100%;display:block"></canvas>
<script>
  window.__t = { acks: [], fremd: 0, keys: [], alle: [], settings: JSON.parse(JSON.stringify(window.AETHER_HOST_SETTINGS || null)),
    host: window.AETHER_HOST === undefined ? 'fehlt' : JSON.parse(JSON.stringify(window.AETHER_HOST)) };
  window.addEventListener('message', function (e) {
    if (e.source === window.parent && e.data && typeof e.data.type === 'string' && e.data.type.indexOf('aether:') === 0) window.__t.alle.push(e.data.type);
    if (!e.data || e.data.type !== 'aether:settings-ack') return;
    if (e.source === window.parent) window.__t.acks.push(e.data); else window.__t.fremd++;
  });
  // Speicher-Logik eines Spiels, das settingsAck kennt: Sammel-Nachricht mit id nur bei angekündigter Fähigkeit,
  // sonst einzeln ohne id (wie bei einem älteren Dashboard).
  window.__speichereNeu = function (id, werte) {
    if (window.AETHER_HOST && window.AETHER_HOST.settingsAck === true) {
      window.parent.postMessage({ type: 'aether:settings', id: id, items: Object.keys(werte).map(function (k) { return { key: k, value: werte[k] }; }) }, '*');
      return 'sammel';
    }
    Object.keys(werte).forEach(function (k) { window.parent.postMessage({ type: 'aether:setting', key: k, value: werte[k] }, '*'); });
    return 'einzeln';
  };
  // Speicher-Logik des heutigen Spiels (kennt das Feld nicht): nur Einzel-Nachrichten ohne id.
  window.__speichereAlt = function (werte) {
    Object.keys(werte).forEach(function (k) { window.parent.postMessage({ type: 'aether:setting', key: k, value: werte[k] }, '*'); });
  };
  document.addEventListener('keydown', function (e) { window.__t.keys.push(e.key); });
</script><script src="spiel.js"></script></body></html>`;
// Ein Build braucht eine JavaScript-Datei (sonst „unvollständig“).
const FILES = { 'index.html': Buffer.from(GAME_HTML), 'spiel.js': Buffer.from('window.__t.ready = true;') };
const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');
const blobs = new Map(Object.values(FILES).map((b) => [gitSha(b), b]));
const BUILD = { commit: 'abc1234' + '0'.repeat(33), short: 'abc1234', message: 'Speicher-Test', date: '2026-11-22T10:00:00Z', path: 'builds/abc1234/' };

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
  browser = await chromium.launch();
});
after(async () => {
  await browser?.close();
  await new Promise((r) => server.close(r));
});

// Neuer Kontext (wie ein Browser-Profil) mit Token; opts.init: zusätzliches Skript vor der Seite (nur oberstes Fenster).
async function newContext(opts = {}) {
  const context = await browser.newContext({ viewport: opts.viewport || { width: 1180, height: 820 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', hasTouch: !!opts.hasTouch });
  await context.route('https://api.github.com/**', githubApi);
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  await context.addInitScript((t) => { if (window === window.top) { try { if (!localStorage.getItem('aether.githubToken')) localStorage.setItem('aether.githubToken', t); } catch (e) { /* egal */ } } }, TOKEN);
  if (opts.init) await context.addInitScript(opts.init);
  return context;
}
async function newPage(context, opts = {}) {
  const page = await context.newPage();
  const log = { errors: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  if (opts.goto !== false) await page.goto(baseUrl + 'index.html');
  return { page, log };
}
const gameFrame = (page) => page.frames().find((f) => f !== page.mainFrame() && f.parentFrame() === page.mainFrame());

async function startGame(page) {
  await page.waitForSelector('#buildsView:not([hidden])');
  const start = await (await page.waitForSelector('#game.slot:not([hidden]) iframe')).contentFrame();
  await start.waitForSelector('#aetherStart:not([disabled])');
  await start.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
  await start.click('#aetherStart');
  await page.waitForFunction(() => document.querySelector('#game iframe') && !document.getElementById('game').hidden && !document.getElementById('game').classList.contains('slot'));
  let frame;
  while (!(frame = gameFrame(page))) await page.waitForEvent('frameattached');
  await frame.waitForFunction(() => window.__t && window.__t.ready);
  await page.waitForFunction(() => document.activeElement && document.activeElement.tagName === 'IFRAME');
  return frame;
}
const storedObj = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k) || 'null'), SETTINGS_KEY);
const post = (frame, msg) => frame.evaluate((m) => window.parent.postMessage(m, '*'), msg);
const acks = (frame) => frame.evaluate(() => window.__t.acks.slice());
async function waitAck(frame, id) {
  await frame.waitForFunction((id) => window.__t.acks.some((a) => a.id === id), id);
  return (await acks(frame)).filter((a) => a.id === id).pop();
}
// Speicher voll nachstellen: setItem für die Spiel-Einstellungen wirft QuotaExceededError, solange __voll gesetzt ist.
async function speicherVoll(page, an) {
  await page.evaluate((an) => {
    if (!window.__vollEingebaut) {
      window.__vollEingebaut = true;
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) {
        if (window.__voll && k === 'aether.gameSettings') throw new DOMException('Der Speicher ist voll.', 'QuotaExceededError');
        return orig.call(this, k, v);
      };
    }
    window.__voll = an;
  }, an);
}
const hint = (page) => page.evaluate(() => {
  const h = document.getElementById('saveHint');
  const r = h.getBoundingClientRect();
  return {
    sichtbar: !h.hidden && r.height > 0, ok: h.classList.contains('ok'),
    titel: document.getElementById('shTitle').textContent, grund: document.getElementById('shGrund').textContent,
    details: !document.getElementById('shMore').hidden,
    keys: [...document.querySelectorAll('#shKeys li')].map((li) => li.textContent),
    retry: !document.getElementById('shRetry').hidden
  };
});

// ---------------------------------------------------------------------------
// Teil 1: Speichern bestätigen
// ---------------------------------------------------------------------------
describe('Speichern bestätigen', () => {
  test('a) Sammel-Nachricht: alle Schlüssel geschrieben + Antwort ok; ein Schlüssel über der Grenze → keiner + ok false', async () => {
    const context = await newContext();
    const { page, log } = await newPage(context);
    const frame = await startGame(page);
    await post(frame, { type: 'aether:settings', id: 's1', items: [
      { key: 'aether.ownWorld.1', value: 'eins' }, { key: 'aether.ownWorld.2', value: 'zwei' }, { key: 'aether.showFps', value: '1' }] });
    const a1 = await waitAck(frame, 's1');
    assert.deepEqual(a1, { type: 'aether:settings-ack', id: 's1', ok: true, grund: null, keys: ['aether.ownWorld.1', 'aether.ownWorld.2', 'aether.showFps'] });
    assert.deepEqual(await storedObj(page), { 'aether.ownWorld.1': 'eins', 'aether.ownWorld.2': 'zwei', 'aether.showFps': '1' });

    // Ein Wert mit 1025 Zeichen: keiner der Schlüssel wird geschrieben, alter Stand bleibt.
    await post(frame, { type: 'aether:settings', id: 7, items: [
      { key: 'aether.ownWorld.1', value: 'neu' }, { key: 'aether.ownWorld.3', value: 'x'.repeat(1025) }] });
    const a2 = await waitAck(frame, 7);
    assert.equal(a2.ok, false);
    assert.equal(a2.grund, 'grenze');
    assert.deepEqual(a2.keys, ['aether.ownWorld.1', 'aether.ownWorld.3']);
    assert.deepEqual(await storedObj(page), { 'aether.ownWorld.1': 'eins', 'aether.ownWorld.2': 'zwei', 'aether.showFps': '1' });
    let h = await hint(page);
    assert.ok(h.sichtbar && !h.ok, 'Grenze überschritten → Hinweis');
    assert.match(h.grund, /Grenze überschritten/);
    await page.click('#shClose');

    // Mehr als 64 Schlüssel in einer Sammel-Nachricht (3 vorhanden + 62 neue = 65): keiner.
    const viele = Array.from({ length: 62 }, (_, i) => ({ key: 'aether.k' + i, value: String(i) }));
    await post(frame, { type: 'aether:settings', id: 'viele', items: viele });
    assert.equal((await waitAck(frame, 'viele')).grund, 'grenze');
    assert.equal(Object.keys(await storedObj(page)).length, 3);
    // Genau 64: alle; null löscht in derselben Nachricht.
    await post(frame, { type: 'aether:settings', id: 'genau', items: viele.slice(0, 61).concat([{ key: 'aether.showFps', value: null }, { key: 'aether.k61', value: 'x' }]) });
    assert.equal((await waitAck(frame, 'genau')).ok, true);
    const o = await storedObj(page);
    assert.equal(Object.keys(o).length, 64);
    assert.equal(o['aether.showFps'], undefined);

    // Falsch geformt: ok false „ungueltig“, kein Hinweis, nichts geschrieben.
    await page.click('#shClose').catch(() => {});
    await post(frame, { type: 'aether:settings', id: 'u1', items: [{ key: 'aether.ok', value: 'a' }, { key: 'kein.aether', value: 'b' }] });
    assert.equal((await waitAck(frame, 'u1')).grund, 'ungueltig');
    await post(frame, { type: 'aether:settings', id: 'u2', items: 'nein' });
    assert.deepEqual(await waitAck(frame, 'u2'), { type: 'aether:settings-ack', id: 'u2', ok: false, grund: 'ungueltig', keys: [] });
    await post(frame, { type: 'aether:setting', id: 'u3', key: 'aether.ok' });
    assert.equal((await waitAck(frame, 'u3')).grund, 'ungueltig');
    assert.equal((await storedObj(page))['aether.ok'], undefined);
    h = await hint(page);
    assert.equal(h.sichtbar, false, 'falsch geformte Nachricht zeigt keinen Hinweis');
    // Einzel-Nachricht mit id: ebenfalls Antwort (vorhandener Schlüssel – bei 64 Schlüsseln geht Ändern weiter,
    // ein 65. Schlüssel nicht).
    await post(frame, { type: 'aether:setting', id: 'e1', key: 'aether.k0', value: 'ja' });
    assert.deepEqual(await waitAck(frame, 'e1'), { type: 'aether:settings-ack', id: 'e1', ok: true, grund: null, keys: ['aether.k0'] });
    await post(frame, { type: 'aether:setting', id: 'e2', key: 'aether.ok', value: 'ja' });
    assert.deepEqual(await waitAck(frame, 'e2'), { type: 'aether:settings-ack', id: 'e2', ok: false, grund: 'grenze', keys: ['aether.ok'] });
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('b) Nachrichten ohne id: Verhalten wie bisher, keine Antwort; ungültige id gilt als ohne id', async () => {
    const context = await newContext();
    const { page } = await newPage(context);
    const frame = await startGame(page);
    await post(frame, { type: 'aether:setting', key: 'aether.a', value: '1' });
    await post(frame, { type: 'aether:setting', key: 'aether.b', value: '2', id: { kaputt: true } });
    await post(frame, { type: 'aether:setting', key: 'aether.a', value: null });
    await post(frame, { type: 'aether:settings', items: [{ key: 'aether.c', value: '3' }] });
    await post(frame, { type: 'aether:setting', key: 'aether.ende', value: 'x', id: 'ende' });
    await waitAck(frame, 'ende');
    assert.deepEqual(await storedObj(page), { 'aether.b': '2', 'aether.c': '3', 'aether.ende': 'x' });
    assert.deepEqual((await acks(frame)).map((a) => a.id), ['ende'], 'nur die Nachricht mit id bekommt eine Antwort');
    assert.equal(await frame.evaluate(() => window.__t.fremd), 0);
    await context.close();
  });

  test('c) Schreibfehler (QuotaExceededError): Hinweis, Antwort „voll“, Details, „Erneut versuchen“ → grüner Hinweis, weg nach 3 s', async () => {
    const context = await newContext();
    const { page, log } = await newPage(context);
    const frame = await startGame(page);
    await post(frame, { type: 'aether:setting', id: 'v0', key: 'aether.ownWorld.1', value: 'alt' });
    await waitAck(frame, 'v0');
    await speicherVoll(page, true);
    await post(frame, { type: 'aether:setting', id: 'v1', key: 'aether.ownWorld.2', value: 'gross' });
    assert.deepEqual(await waitAck(frame, 'v1'), { type: 'aether:settings-ack', id: 'v1', ok: false, grund: 'voll', keys: ['aether.ownWorld.2'] });
    // Zweiter Fehler kurz danach (ohne id, wie das heutige Spiel): derselbe eine Hinweis.
    await post(frame, { type: 'aether:setting', key: 'aether.ownWorld.3', value: 'auch' });
    await page.waitForFunction(() => document.querySelectorAll('#saveHint').length === 1 && document.getElementById('shKeys').children.length === 2);
    let h = await hint(page);
    assert.ok(h.sichtbar && !h.ok);
    assert.equal(h.titel, 'Speichern nicht möglich');
    assert.equal(h.grund, 'Speicher des Browsers voll. Änderungen gelten nur bis zum Schließen.');
    assert.equal(h.details, false);
    assert.deepEqual(await storedObj(page), { 'aether.ownWorld.1': 'alt' }, 'alter Stand bleibt');
    // Spiel behält den Fokus und läuft weiter; der Hinweis deckt die Bildmitte nicht ab.
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'IFRAME');
    assert.equal(await page.evaluate(() => document.elementFromPoint(innerWidth / 2, innerHeight / 2).tagName), 'IFRAME');
    await page.screenshot({ path: path.join(OUT, 'speichern-hinweis.png') });

    // Bleibt stehen (kein Zeitlimit).
    await page.waitForTimeout(3500);
    assert.equal((await hint(page)).sichtbar, true);

    await page.click('#shDetails');
    h = await hint(page);
    assert.equal(h.details, true);
    assert.deepEqual(h.keys, ['ownWorld.2 – Speicher voll', 'ownWorld.3 – Speicher voll']);
    assert.equal(h.retry, true);
    await page.screenshot({ path: path.join(OUT, 'speichern-details.png') });

    // Erneut versuchen, solange noch voll: bleibt rot.
    await page.click('#shRetry');
    h = await hint(page);
    assert.ok(h.sichtbar && !h.ok);
    // Speicher wieder frei → „Erneut versuchen“: grün, alle Werte geschrieben, weg nach 3 s.
    await speicherVoll(page, false);
    await page.click('#shRetry');
    const t0 = Date.now();
    h = await hint(page);
    assert.ok(h.sichtbar && h.ok, 'grüner Hinweis');
    assert.equal(h.titel, 'Wieder gespeichert');
    assert.equal(h.grund, 'Alle Änderungen gesichert.');
    assert.deepEqual(await storedObj(page), { 'aether.ownWorld.1': 'alt', 'aether.ownWorld.2': 'gross', 'aether.ownWorld.3': 'auch' });
    const g = await page.evaluate(() => {
      const el = document.getElementById('saveHint'), s = getComputedStyle(el);
      return { links: s.borderLeftColor, breite: el.getBoundingClientRect().width, icon: document.getElementById('shIcon').textContent };
    });
    assert.equal(g.links, 'rgb(60, 196, 122)');
    assert.equal(g.icon, '✓');
    assert.ok(g.breite <= 381, 'ca. 380 px: ' + g.breite);
    await page.waitForFunction(() => document.getElementById('saveHint').hidden, null, { timeout: 6000 });
    const dauer = Date.now() - t0;
    assert.ok(dauer >= 2500 && dauer <= 5000, 'verschwindet nach ca. 3 s: ' + dauer);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('c2) Fehler, danach gelingt das nächste Schreiben aus dem Spiel: grüner Hinweis, zurückgehaltene Werte mitgeschrieben', async () => {
    const context = await newContext();
    const { page } = await newPage(context);
    const frame = await startGame(page);
    await speicherVoll(page, true);
    await post(frame, { type: 'aether:settings', id: 'f1', items: [{ key: 'aether.a', value: '1' }, { key: 'aether.b', value: '2' }] });
    assert.equal((await waitAck(frame, 'f1')).grund, 'voll');
    assert.equal(await storedObj(page), null, 'alle oder keiner: nichts geschrieben');
    await speicherVoll(page, false);
    await post(frame, { type: 'aether:setting', id: 'f2', key: 'aether.c', value: '3' });
    assert.equal((await waitAck(frame, 'f2')).ok, true);
    assert.deepEqual(await storedObj(page), { 'aether.a': '1', 'aether.b': '2', 'aether.c': '3' });
    const h = await hint(page);
    assert.ok(h.sichtbar && h.ok);
    await context.close();
  });

  test('c3) Tastatur: Enter = Details, Esc = ×; Fokus geht danach zurück ins Spiel; anderer Fehler „fehler“', async () => {
    const context = await newContext();
    const { page } = await newPage(context);
    const frame = await startGame(page);
    await page.evaluate(() => {
      const orig = Storage.prototype.setItem;
      Storage.prototype.setItem = function (k, v) { if (window.__sperre && k === 'aether.gameSettings') throw new DOMException('gesperrt', 'SecurityError'); return orig.call(this, k, v); };
      window.__sperre = true;
    });
    await post(frame, { type: 'aether:setting', id: 'x', key: 'aether.a', value: '1' });
    assert.equal((await waitAck(frame, 'x')).grund, 'fehler');
    // Im Spiel-iframe gehören die Tasten dem Spiel: Enter ändert am Hinweis nichts.
    await page.keyboard.press('Enter');
    await frame.waitForFunction(() => window.__t.keys.includes('Enter'));
    assert.equal((await hint(page)).details, false);
    // Fokus auf dem Dashboard (kein Element): Enter = Details, Esc = ×.
    await page.evaluate(() => document.activeElement.blur());
    await page.keyboard.press('Enter');
    assert.equal((await hint(page)).details, true);
    await page.focus('#shRetry');
    await page.keyboard.press('Escape');
    assert.equal((await hint(page)).sichtbar, false);
    assert.equal(await page.evaluate(() => document.activeElement.tagName), 'IFRAME', 'Fokus zurück im Spiel');
    await context.close();
  });

  test('d) erfolgreiches Speichern zeigt nichts an', async () => {
    const context = await newContext();
    const { page } = await newPage(context);
    const frame = await startGame(page);
    for (let i = 0; i < 5; i++) await post(frame, { type: 'aether:setting', key: 'aether.n', value: String(i) });
    await post(frame, { type: 'aether:settings', id: 'd', items: [{ key: 'aether.m', value: 'x' }] });
    await waitAck(frame, 'd');
    await page.waitForTimeout(300);
    const h = await hint(page);
    assert.equal(h.sichtbar, false);
    assert.equal(await page.evaluate(() => document.getElementById('saveHint').hidden), true);
    await context.close();
  });

  for (const vp of [{ width: 1024, height: 768 }, { width: 1366, height: 1024 }, { width: 844, height: 390 }]) {
    test(`Layout Hinweis ${vp.width}×${vp.height}: ohne Überlauf, Knöpfe ≥ 44 px, auch mit Details`, async () => {
      const context = await newContext({ viewport: vp, hasTouch: vp.width === 844 });
      const { page } = await newPage(context);
      const frame = await startGame(page);
      await speicherVoll(page, true);
      for (let i = 1; i <= 6; i++) await post(frame, { type: 'aether:setting', key: 'aether.ownWorld.' + i, value: 'x' });
      await page.waitForFunction(() => document.getElementById('shKeys').children.length === 6);
      const messe = () => page.evaluate(() => {
        const h = document.getElementById('saveHint'), r = h.getBoundingClientRect();
        const knoepfe = [...h.querySelectorAll('button')].filter((b) => b.offsetParent !== null).map((b) => { const q = b.getBoundingClientRect(); return { id: b.id, w: q.width, h: q.height }; });
        return { r: { l: r.left, t: r.top, rr: r.right, b: r.bottom, w: r.width }, vw: innerWidth, vh: innerHeight,
          ueber: h.scrollWidth > h.clientWidth, knoepfe, unten: innerHeight - r.bottom };
      });
      let m = await messe();
      assert.ok(m.r.l >= 0 && m.r.rr <= m.vw && m.r.t >= 0 && m.r.b <= m.vh, JSON.stringify(m.r));
      assert.equal(m.ueber, false);
      assert.ok(Math.abs(m.unten - 34) <= 1, 'Abstand unten ca. 34 px: ' + m.unten);
      assert.ok(m.r.w <= 600 && (m.vw < 624 || m.r.w >= 599), 'ca. 600 px breit: ' + m.r.w);
      for (const k of m.knoepfe) assert.ok(k.w >= 44 && k.h >= 44, JSON.stringify(k));
      await page.click('#shDetails');
      m = await messe();
      assert.ok(m.r.t >= 0 && m.r.b <= m.vh, 'mit Details im Bild: ' + JSON.stringify(m.r));
      assert.equal(m.ueber, false);
      for (const k of m.knoepfe) assert.ok(k.w >= 44 && k.h >= 44, JSON.stringify(k));
      await page.screenshot({ path: path.join(OUT, `speichern-hinweis-${vp.width}x${vp.height}.png`) });
      await context.close();
    });
  }
});

// ---------------------------------------------------------------------------
// Teil 2: Nur ein Fenster speichert
// ---------------------------------------------------------------------------
// Zählt Schreibzugriffe auf die Spiel-Einstellungen je Seite (window.__schreibt).
const ZAEHLE_SCHREIBEN = () => {
  if (window !== window.top) return;
  window.AETHER_TEST_SPEICHER = true;
  window.__schreibt = 0;
  const orig = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) { if (k === 'aether.gameSettings') window.__schreibt++; return orig.call(this, k, v); };
};
const tafel = (page) => page.evaluate(() => ({
  sichtbar: !document.getElementById('fensterTafel').hidden,
  zustand: window.__aetherFenster.zustand, weg: window.__aetherFenster.weg,
  iframes: document.querySelectorAll('iframe').length,
  titel: document.getElementById('ftTitel').textContent
}));
const schreibt = (page) => page.evaluate(() => window.__schreibt);

// ---------------------------------------------------------------------------
// Ankündigung AETHER_HOST.settingsAck
// ---------------------------------------------------------------------------
const HOST = { version: 1, settings: true, feedback: true, dialogInput: true, settingsAck: true };
describe('Ankündigung settingsAck', () => {
  test('a) im Spiel-iframe: AETHER_HOST.settingsAck === true, version 1, settings/feedback/dialogInput unverändert', async () => {
    const context = await newContext();
    const { page, log } = await newPage(context);
    const frame = await startGame(page);
    const host = await frame.evaluate(() => window.__t.host);
    assert.deepEqual(host, HOST);
    assert.equal(host.settingsAck, true);
    assert.equal(host.version, 1);
    assert.deepEqual([host.settings, host.feedback, host.dialogInput], [true, true, true]);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('b) Spiel, das settingsAck sieht: Sammel-Nachricht mit id → aether:settings-ack ok:true, Werte in aether.gameSettings', async () => {
    const context = await newContext();
    const { page, log } = await newPage(context);
    const frame = await startGame(page);
    const weg = await frame.evaluate(() => window.__speichereNeu('neu-1', { 'aether.ownWorld.1': 'eins', 'aether.showFps': '1' }));
    assert.equal(weg, 'sammel', 'das Spiel erkennt die Fähigkeit am Feld (nicht erst an der ersten Antwort)');
    assert.deepEqual(await waitAck(frame, 'neu-1'), { type: 'aether:settings-ack', id: 'neu-1', ok: true, grund: null, keys: ['aether.ownWorld.1', 'aether.showFps'] });
    assert.deepEqual(await storedObj(page), { 'aether.ownWorld.1': 'eins', 'aether.showFps': '1' });
    assert.equal((await hint(page)).sichtbar, false, 'erfolgreiches Speichern zeigt nichts');
    assert.equal(await frame.evaluate(() => window.__t.fremd), 0);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('c) Spiel ohne Kenntnis des Felds (nur Einzel-Nachrichten ohne id): Verhalten wie vorher – gespeichert, keine Antwort, kein Hinweis', async () => {
    const context = await newContext();
    const { page, log } = await newPage(context);
    let frame = await startGame(page);
    await frame.evaluate(() => window.__speichereAlt({ 'aether.touch.boost': 'true', 'aether.vol': '0.5', 'aether.alt': 'weg' }));
    await frame.evaluate(() => window.__speichereAlt({ 'aether.alt': null }));
    // Ende abwarten ohne Wanduhr: eine Nachricht mit id läuft durch dieselbe Verarbeitung und kommt erst danach zurück
    await post(frame, { type: 'aether:setting', id: 'ende', key: 'aether.waechter', value: '1' });
    await waitAck(frame, 'ende');
    assert.deepEqual(await storedObj(page), { 'aether.touch.boost': 'true', 'aether.vol': '0.5', 'aether.waechter': '1' });
    assert.deepEqual(await frame.evaluate(() => window.__t.alle), ['aether:settings-ack'], 'nur die Wächter-Nachricht mit id bekam eine Antwort, sonst keine Nachricht ans Spiel');
    assert.equal((await hint(page)).sichtbar, false, 'kein Hinweis');
    // Nach Neustart liest das Spiel die Werte wie bisher aus AETHER_HOST_SETTINGS
    await page.click('#exitBtn');
    await page.waitForSelector('#buildsView:not([hidden])');
    frame = await startGame(page);
    assert.deepEqual(await frame.evaluate(() => window.__t.settings), { 'aether.touch.boost': 'true', 'aether.vol': '0.5', 'aether.waechter': '1' });
    assert.deepEqual(await frame.evaluate(() => window.__t.alle), [], 'ohne eigene Nachricht bekommt das Spiel nichts');
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

describe('Nur ein Fenster speichert', () => {
  test('e) zwei Seiten im selben Browser-Kontext: zweite zeigt die Tafel, lädt kein Spiel; „Hier weiterspielen“ wechselt; nur eine schreibt', async () => {
    const context = await newContext({ init: ZAEHLE_SCHREIBEN });
    const A = await newPage(context);
    await A.page.waitForSelector('#game.slot:not([hidden]) iframe');
    assert.equal((await tafel(A.page)).zustand, 'halter');
    assert.equal((await tafel(A.page)).weg, 'locks');
    const frameA = await startGame(A.page);

    const B = await newPage(context);
    await B.page.waitForSelector('#fensterTafel:not([hidden])');
    await B.page.waitForSelector('#buildsView:not([hidden])');   // Build-Liste lädt dahinter trotzdem
    await B.page.waitForTimeout(300);
    let tb = await tafel(B.page);
    assert.deepEqual([tb.sichtbar, tb.zustand, tb.iframes], [true, 'wartet', 0], 'B: Tafel, kein Spielrahmen');
    assert.equal(tb.titel, 'Aether läuft schon in einem anderen Fenster');
    const box = await B.page.evaluate(() => {
      const t = document.getElementById('fensterTafel'), b = t.querySelector('.ft-box'), s = getComputedStyle(b);
      return { grund: getComputedStyle(t).backgroundColor, flaeche: s.backgroundColor, rand: s.borderTopColor, ecke: s.borderTopLeftRadius,
        haupt: getComputedStyle(document.getElementById('ftWeiter')).backgroundColor, fokus: document.activeElement.id,
        text: t.innerText, appInert: document.getElementById('app').inert };
    });
    assert.equal(box.grund, 'rgba(5, 6, 14, 0.72)');
    assert.equal(box.flaeche, 'rgb(18, 23, 49)');
    assert.equal(box.rand, 'rgb(58, 65, 112)');
    assert.equal(box.ecke, '20px');
    assert.equal(box.haupt, 'rgb(139, 124, 246)');
    assert.equal(box.fokus, 'ftWeiter');
    assert.equal(box.appInert, true);
    assert.match(box.text, /Damit nichts verloren geht, speichert immer nur ein Fenster\. Hier ist das Spiel angehalten\./);
    assert.match(box.text, /„Hier weiterspielen“ hält das andere Fenster an; dort erscheint dieselbe Tafel mit „Hier weiterspielen“\./);
    await B.page.screenshot({ path: path.join(OUT, 'fenster-tafel.png') });

    // A speichert, B nicht (auch eine Speicher-Nachricht in B → ok false „anderes-fenster“).
    await post(frameA, { type: 'aether:setting', id: 'a1', key: 'aether.a', value: '1' });
    assert.equal((await waitAck(frameA, 'a1')).ok, true);
    const ackB = await B.page.evaluate(() => window.__aetherSpeicherTest({ type: 'aether:setting', id: 'b1', key: 'aether.b', value: '2' }));
    assert.deepEqual(ackB, { type: 'aether:settings-ack', id: 'b1', ok: false, grund: 'anderes-fenster', keys: ['aether.b'] });
    const ackB2 = await B.page.evaluate(() => window.__aetherSpeicherTest({ type: 'aether:settings', id: 'b2', items: [{ key: 'aether.c', value: '3' }] }));
    assert.equal(ackB2.grund, 'anderes-fenster');
    assert.deepEqual(await storedObj(A.page), { 'aether.a': '1' });
    assert.equal(await schreibt(B.page), 0, 'B schreibt nichts');
    assert.equal(await schreibt(A.page), 1);
    assert.equal((await hint(B.page)).sichtbar, false);

    // „Hier weiterspielen“ in B (echter Klick): B lädt den Spielrahmen, A entlädt das Spiel und zeigt die Tafel.
    await B.page.click('#ftWeiter');
    await B.page.waitForSelector('#game.slot:not([hidden]) iframe');
    await A.page.waitForSelector('#fensterTafel:not([hidden])');
    tb = await tafel(B.page);
    const ta = await tafel(A.page);
    assert.deepEqual([tb.sichtbar, tb.zustand], [false, 'halter']);
    assert.deepEqual([ta.sichtbar, ta.zustand, ta.iframes], [true, 'wartet', 0], 'A: Spiel entladen, Tafel');
    assert.equal(frameA.isDetached(), true, 'Spiel-iframe in A ist weg');
    assert.equal(await A.page.evaluate(() => document.documentElement.classList.contains('playing')), false);
    const frameB = await startGame(B.page);
    assert.deepEqual(await frameB.evaluate(() => window.__t.settings), { 'aether.a': '1' }, 'B startet mit dem Stand von A');
    await post(frameB, { type: 'aether:setting', id: 'b3', key: 'aether.b', value: '2' });
    assert.equal((await waitAck(frameB, 'b3')).ok, true);
    assert.equal((await A.page.evaluate(() => window.__aetherSpeicherTest({ type: 'aether:setting', id: 'a2', key: 'aether.z', value: '9' }))).grund, 'anderes-fenster');
    assert.deepEqual(await storedObj(B.page), { 'aether.a': '1', 'aether.b': '2' });
    assert.equal(await schreibt(A.page), 1, 'A schreibt nach dem Wechsel nicht mehr');
    assert.equal(await schreibt(B.page), 1);

    // Tastatur in A: Enter = „Hier weiterspielen“ → wieder A.
    await A.page.keyboard.press('Enter');
    await B.page.waitForSelector('#fensterTafel:not([hidden])');
    await A.page.waitForSelector('#game.slot:not([hidden]) iframe');
    assert.equal(frameB.isDetached(), true);
    assert.equal((await tafel(B.page)).zustand, 'wartet');
    assert.equal((await tafel(A.page)).zustand, 'halter');
    assert.deepEqual(A.log.errors.concat(B.log.errors), []);
    await context.close();
  });

  test('e2) „Fenster schließen“: schließt, wenn der Browser es erlaubt, sonst verständlicher Hinweis', async () => {
    const context = await newContext();
    const A = await newPage(context);
    await A.page.waitForSelector('#game.slot:not([hidden]) iframe');
    // Vom Skript geöffnetes Fenster (darf geschlossen werden)
    const [C] = await Promise.all([context.waitForEvent('page'), A.page.evaluate((u) => { window.open(u, '_blank'); }, baseUrl + 'index.html')]);
    await C.waitForSelector('#fensterTafel:not([hidden])');
    // Der Klick schließt die Seite selbst: endet das Schließen noch während Playwright den Klick nachbearbeitet, meldet
    // click „Target page … has been closed“ (Wettlauf, CI-Lauf PR #40). Nur genau dieser Fall gilt als Erfolg – das
    // close-Ereignis und isClosed() unten bleiben die eigentliche Prüfung.
    await Promise.all([C.waitForEvent('close'), C.click('#ftSchliessen').catch((e) => { if (!/has been closed/.test(String(e && e.message))) throw e; })]);
    assert.equal(C.isClosed(), true);
    // Normaler Tab mit Verlauf (Browser lehnt window.close() ab): Hinweis
    const D = await newPage(context, { goto: false });
    await D.page.goto(baseUrl + 'flyer.html');
    await D.page.goto(baseUrl + 'index.html');
    await D.page.waitForSelector('#fensterTafel:not([hidden])');
    await D.page.click('#ftSchliessen');
    await D.page.waitForSelector('#ftStatus:not([hidden])');
    assert.match(await D.page.textContent('#ftStatus'), /nicht per Knopf schließen/);
    assert.equal((await tafel(A.page)).zustand, 'halter', 'A bleibt unberührt');
    await context.close();
  });

  test('e3) Ersatzweg ohne Web Locks (BroadcastChannel): zweite Seite wartet, „Hier weiterspielen“ wechselt', async () => {
    const context = await newContext({ init: () => { Object.defineProperty(Navigator.prototype, 'locks', { configurable: true, get() { return undefined; } }); } });
    const A = await newPage(context);
    await A.page.waitForSelector('#game.slot:not([hidden]) iframe');
    assert.equal((await tafel(A.page)).weg, 'kanal');
    const B = await newPage(context);
    await B.page.waitForSelector('#fensterTafel:not([hidden])');
    assert.equal((await tafel(B.page)).iframes, 0);
    await B.page.click('#ftWeiter');
    await A.page.waitForSelector('#fensterTafel:not([hidden])');
    await B.page.waitForSelector('#game.slot:not([hidden]) iframe');
    assert.deepEqual([(await tafel(A.page)).zustand, (await tafel(B.page)).zustand], ['wartet', 'halter']);
    await context.close();
  });

  test('f) ein Fenster allein: kein Unterschied – Spielrahmen lädt wie bisher, Sperre ohne merkbare Verzögerung', async () => {
    const context = await newContext();
    const { page, log } = await newPage(context);
    await page.waitForSelector('#game.slot:not([hidden]) iframe');
    const f = await page.evaluate(() => ({ ...Object.fromEntries(['zustand', 'weg', 'startMs', 'bereitMs', 'rahmenMs'].map((k) => [k, window.__aetherFenster[k]])),
      tafel: !document.getElementById('fensterTafel').hidden, inert: document.getElementById('app').inert }));
    assert.equal(f.zustand, 'halter');
    assert.equal(f.tafel, false);
    assert.equal(f.inert, false);
    const warten = f.bereitMs - f.startMs;
    console.log(`Sperre erhalten nach ${warten.toFixed(1)} ms; Spielrahmen nach ${f.rahmenMs} ms ab Seitenstart`);
    assert.ok(warten >= 0 && warten < 50, 'Sperre in < 50 ms: ' + warten);
    assert.ok(f.rahmenMs >= f.bereitMs, 'Rahmen erst nach der Sperre');
    const frame = await startGame(page);
    await post(frame, { type: 'aether:setting', id: 'f', key: 'aether.a', value: '1' });
    assert.equal((await waitAck(frame, 'f')).ok, true);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  for (const vp of [{ width: 1024, height: 768 }, { width: 1366, height: 1024 }, { width: 844, height: 390 }]) {
    test(`Layout Tafel ${vp.width}×${vp.height}: ohne Überlauf, Knöpfe ≥ 44 px`, async () => {
      const context = await newContext({ viewport: vp, hasTouch: vp.width === 844 });
      const A = await newPage(context);
      await A.page.waitForSelector('#game.slot:not([hidden]) iframe');
      const B = await newPage(context);
      await B.page.waitForSelector('#fensterTafel:not([hidden])');
      const m = await B.page.evaluate(() => {
        const b = document.querySelector('#fensterTafel .ft-box'), r = b.getBoundingClientRect();
        return { r: { l: r.left, t: r.top, rr: r.right, b: r.bottom, w: r.width }, vw: innerWidth, vh: innerHeight,
          ueber: b.scrollWidth > b.clientWidth || b.scrollHeight > b.clientHeight + 1,
          knoepfe: [...b.querySelectorAll('button')].map((x) => { const q = x.getBoundingClientRect(); return { w: q.width, h: q.height }; }),
          seite: document.documentElement.scrollWidth > innerWidth };
      });
      assert.ok(m.r.l >= 0 && m.r.rr <= m.vw && m.r.t >= 0 && m.r.b <= m.vh, JSON.stringify(m));
      assert.equal(m.ueber, false, JSON.stringify(m));
      assert.equal(m.seite, false);
      assert.ok(m.r.w <= 600 && (m.vw < 640 || m.r.w >= 599), 'ca. 600 px: ' + m.r.w);
      for (const k of m.knoepfe) assert.ok(k.w >= 44 && k.h >= 44, JSON.stringify(k));
      await B.page.screenshot({ path: path.join(OUT, `fenster-tafel-${vp.width}x${vp.height}.png`) });
      await context.close();
    });
  }
});

// ---------------------------------------------------------------------------
// Teil 3: Speicher-Schutz
// ---------------------------------------------------------------------------
describe('Speicher-Schutz', () => {
  const STORAGE_NACHBAU = (art) => {
    if (window !== window.top) return;
    window.__persist = { persisted: 0, persist: 0 };
    const nach = {
      persisted: () => { window.__persist.persisted++; return Promise.resolve(art === 'schon'); },
      persist: () => { window.__persist.persist++; return art === 'wirft' ? Promise.reject(new Error('nein')) : Promise.resolve(art !== 'abgelehnt'); },
      estimate: () => Promise.resolve({ usage: 0, quota: 1e9 })
    };
    if (art === 'fehlt') Object.defineProperty(Navigator.prototype, 'storage', { configurable: true, get() { return undefined; } });
    else Object.defineProperty(Navigator.prototype, 'storage', { configurable: true, get() { return nach; } });
  };
  for (const [art, persistAufrufe, ergebnis] of [['frei', 1, 'ja'], ['abgelehnt', 1, 'nein'], ['schon', 0, 'ja'], ['wirft', 1, 'unbekannt'], ['fehlt', null, 'unbekannt']]) {
    test(`g) persist(): ${art} → ${persistAufrufe === null ? 'API fehlt, kein Fehler' : persistAufrufe + '× persist'}, intern „${ergebnis}“, nichts sichtbar`, async () => {
      const context = await newContext({ init: `(${STORAGE_NACHBAU})(${JSON.stringify(art)})` });
      const { page, log } = await newPage(context);
      await page.waitForSelector('#buildsView:not([hidden])');
      await page.waitForFunction((e) => window.__aetherFenster.speicherSchutz === e || e === 'unbekannt', ergebnis);
      await page.waitForTimeout(200);
      const r = await page.evaluate(() => ({ p: window.__persist || null, s: window.__aetherFenster.speicherSchutz, text: document.body.innerText }));
      if (persistAufrufe === null) assert.equal(r.p.persist + r.p.persisted, 0);
      else {
        assert.equal(r.p.persisted, 1, 'einmal persisted()');
        assert.equal(r.p.persist, persistAufrufe);
      }
      assert.equal(r.s, ergebnis);
      assert.doesNotMatch(r.text, /Speicher geschützt/);
      assert.deepEqual(log.errors, []);
      await context.close();
    });
  }
});
