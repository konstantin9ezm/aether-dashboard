// Tests der Seite webgpu-check.html (WebGPU-Check).
// Läuft im vollen Chromium (channel "chromium"): nur dort werden mailto-Starts in der Konsole gemeldet.
// WebGPU kommt im Test aus SwiftShader (vier Flags); ein zweiter Browser ohne die Flags prüft den Rückfall.
// Aufruf: node --test tests/webgpu-check.test.js
// Gegenproben (müssen rot werden): AETHER_GEGENPROBE=iframe-attr | mailto | pflicht | safari-os
//   – der Testserver liefert dann eine gezielt verfälschte Seite aus.
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const PAGE = 'webgpu-check.html';
const TO = 'feedback.aether@gmail.com';
const CUT_NOTE = "(gekürzt - vollständig über 'Ergebnis kopieren')";
const GPU_FLAGS = ['--enable-unsafe-webgpu', '--use-angle=swiftshader', '--enable-features=Vulkan', '--use-vulkan=swiftshader'];

// Pflicht-Schlüssel des Ergebnistexts (eigene Liste des Tests, absichtlich nicht aus der Seite gelesen).
const REQUIRED_KEYS = [
  'Zeitpunkt', 'Dashboard-Commit',
  'WebGPU direkt', 'WebGPU im Dashboard-iframe', 'WebGL 2', 'Grafikweg fürs Spiel',
  'User-Agent', 'Browser', 'Gerätetyp', 'Modell', 'Home-Bildschirm-App', 'Bildschirm (screen)',
  'Verfügbar (availWidth × availHeight)', 'Ausrichtung', 'devicePixelRatio', 'Fenster (innerWidth × innerHeight)',
  'visualViewport', 'Sichere Ränder', 'Touchpunkte (maxTouchPoints)', 'Zeiger', 'Hover', 'Controller',
  'navigator.gpu', 'Bevorzugtes Canvas-Format', 'WGSL-Sprachfeatures', 'requestAdapter', 'Adapter vendor',
  'isFallbackAdapter', 'requestDevice', 'device.lost', 'Limits (Anzahl)',
  'WebGL 2 Renderer', 'MAX_TEXTURE_SIZE', 'MAX_SAMPLES', 'Erweiterungen (Anzahl)', 'EXT_color_buffer_float',
  'Probe direkt – Pixel Mitte', 'Probe iframe – Pixel Mitte', 'Probe direkt – Compute + mapAsync', 'Probe iframe – Compute + mapAsync',
  'Probe direkt – destroy → lost „destroyed“', 'Probe iframe – destroy → lost „destroyed“', 'Probe iframe – isSecureContext',
  'Bildtakt a (direkt)', 'Bildtakt b (iframe ohne Interaktion)', 'Bildtakt c (iframe nach Controller-Taste)', 'Bildtakt d (iframe nach Antippen)', 'Bildtakt Deutung',
  'isSecureContext', 'crossOriginIsolated', 'typeof SharedArrayBuffer', 'hardwareConcurrency', 'deviceMemory', 'prefers-reduced-motion',
  'Speicher-Kontingent', 'Speicher-Belegung', 'Speicher dauerhaft (persisted)', 'WebAssembly', 'WebAssembly SIMD', 'WebAssembly JSPI (Suspending)', 'WebAssembly Threads möglich'
];
const SECTION_ORDER = ['Ergebnis', 'Gerät', 'Grafik (WebGPU)', 'Grafik (WebGL 2)', 'Probe', 'Bildtakt', 'Weitere Fähigkeiten'];

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Gegenproben: gezielte Verfälschungen der ausgelieferten Seite
// ---------------------------------------------------------------------------
const GEGENPROBE = process.env.AETHER_GEGENPROBE || '';
const PATCHES = {
  'iframe-attr': ["sandbox: 'allow-scripts allow-pointer-lock',", "sandbox: 'allow-scripts allow-pointer-lock allow-popups',"],
  mailto: ['var MAILTO_MAX = 2000;', 'var MAILTO_MAX = 4000;'],
  pflicht: ["['Grafikweg fürs Spiel',", "['Grafikweg',"],
  'safari-os': ['var SAFARI_VERSION_RE = /Version\\/(\\d+(?:\\.\\d+)*)/;', 'var SAFARI_VERSION_RE = /OS (\\d+(?:[._]\\d+)*)/;']
};
function servedCheckPage() {
  let html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
  if (GEGENPROBE) {
    const p = PATCHES[GEGENPROBE];
    if (!p) throw new Error('unbekannte Gegenprobe: ' + GEGENPROBE);
    if (!html.includes(p[0])) throw new Error('Gegenprobe greift nicht (Stelle nicht gefunden): ' + p[0]);
    html = html.replace(p[0], p[1]);
  }
  return html;
}

// Attribute, die createGameFrame() in index.html dem Spiel-iframe gibt (aus dem Quelltext gelesen).
function indexFrameAttrs() {
  const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
  const start = html.indexOf('function createGameFrame(');
  assert.ok(start > 0, 'createGameFrame() in index.html gefunden');
  const body = html.slice(start, html.indexOf('\n  }\n', start));
  const get = (name) => {
    const m = new RegExp(`iframe\\.setAttribute\\('${name}', '([^']*)'\\)`).exec(body);
    assert.ok(m, `setAttribute('${name}') in createGameFrame()`);
    return m[1];
  };
  return { sandbox: get('sandbox'), allow: get('allow'), referrerpolicy: get('referrerpolicy') };
}

// ---------------------------------------------------------------------------
// Server, Browser, Hilfen
// ---------------------------------------------------------------------------
let server, baseUrl, gpuBrowser, plainBrowser;
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript' };

before(async () => {
  server = http.createServer((req, res) => {
    let p = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    if (p === PAGE) { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(servedCheckPage()); }
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream' });
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  baseUrl = `http://localhost:${server.address().port}/`;
  gpuBrowser = await chromium.launch({ channel: 'chromium', args: GPU_FLAGS });
  plainBrowser = await chromium.launch({ channel: 'chromium' });
});
after(async () => {
  await gpuBrowser?.close();
  await plainBrowser?.close();
  await new Promise((r) => server.close(r));
});

async function newPage(browser, opts = {}) {
  const dev = opts.device || { viewport: { width: 1180, height: 820 } };
  const context = await browser.newContext({ ...dev, locale: 'de-DE', timezoneId: 'Europe/Berlin', permissions: opts.permissions || [] });
  const page = await context.newPage();
  const log = { console: [], consoleErrors: [], errors: [], urls: [], github: [] };
  page.on('console', (m) => { log.console.push(m.text()); if (m.type() === 'error') log.consoleErrors.push(m.text()); });
  page.on('pageerror', (e) => log.errors.push(String(e)));
  context.on('request', (r) => log.urls.push(r.url()));
  await context.route('https://api.github.com/**', (r) => { log.github.push(r.request().url()); return r.abort(); });
  await context.route(/^https?:\/\/(?!localhost)/, (r) => r.abort());
  if (opts.init) await context.addInitScript(opts.init);
  return { context, page, log };
}

const waitReady = (page) => page.waitForFunction(() => window.__aetherCheck && window.__aetherCheck.ready(), null, { timeout: 90000 });
const probeFrame = (page) => page.frames().find((f) => f.parentFrame() === page.mainFrame());
const fpsState = (page, id) => page.evaluate((i) => {
  const st = window.__aetherCheck.state().fps[i];
  return { status: st.status, result: st.result ? { api: st.result.api, stats: st.result.stats, n: st.result.deltas.length, how: st.result.how, interactedBefore: st.result.interactedBefore, error: st.result.error } : null };
}, id);
const waitStatus = (page, id, status) => page.waitForSelector(`#fps-${id}[data-status="${status}"]`, { timeout: 60000 });
const launched = (log) => log.console.filter((c) => c.startsWith('Launched external handler for'));

function assertStats(r, label) {
  assert.ok(r && r.stats, `${label}: Messwerte vorhanden (${r && r.error})`);
  const s = r.stats;
  assert.ok(s.frames > 10, `${label}: Frames ${s.frames}`);
  assert.equal(s.frames, r.n);
  for (const k of ['meanFps', 'medianMs', 'low1Fps', 'maxMs', 'cap']) assert.ok(Number.isFinite(s[k]) && s[k] > 0, `${label}: ${k}=${s[k]}`);
  assert.ok(s.maxMs >= s.medianMs, `${label}: längster ≥ Median`);
  assert.ok(s.low1Fps <= s.meanFps + 1e-9, `${label}: 1 %-Tief ≤ Mittel`);
  assert.ok(Number.isInteger(s.over20) && Number.isInteger(s.over33) && s.over33 <= s.over20, `${label}: Zähler`);
}

async function probeCells(page) {
  return page.$$eval('#probeBody tr', (trs) => trs.map((tr) => [...tr.children].map((td) => td.textContent)));
}

// ---------------------------------------------------------------------------
// Statische Prüfungen
// ---------------------------------------------------------------------------
test('webgpu-check.html: keine externen Skripte/Anfragen, kein Token, kein Speichern', () => {
  const html = fs.readFileSync(path.join(ROOT, PAGE), 'utf8');
  assert.doesNotMatch(html, /<script[^>]+src=/i, 'keine externen Skripte');
  assert.doesNotMatch(html, /https?:\/\//i, 'keine absoluten Adressen (Schriften, CDNs, APIs)');
  assert.doesNotMatch(html, /api\.github|githubToken|github_pat_|Authorization/i, 'kein Token, keine GitHub-API');
  assert.doesNotMatch(html, /localStorage|sessionStorage|indexedDB|document\.cookie/, 'nichts speichern');
  assert.doesNotMatch(html, /fetch\(|XMLHttpRequest|sendBeacon|WebSocket/, 'nichts senden');
});

test('sw.js nimmt die Seite nicht in die App-Hülle auf; Workflow veröffentlicht sie', () => {
  const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
  const shell = /var SHELL = \[([^\]]*)\]/.exec(sw);
  assert.ok(shell, 'SHELL-Liste gefunden');
  assert.doesNotMatch(shell[1], /webgpu-check/);
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  assert.match(wf, /cp [^\n]*webgpu-check\.html[^\n]*_site\//, 'webgpu-check.html wird nach _site kopiert');
});

// Kleiner Mock der GitHub-API für die Build- und Projektansicht (nur, was die Kopfzeile braucht).
const DASH_TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
async function dashboardApi(route) {
  const req = route.request();
  const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset' };
  if (req.method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept, Content-Type' } });
  }
  const p = decodeURIComponent(new URL(req.url()).pathname);
  const base = '/repos/konstantin9ezm/aether';
  const json = (status, body, type = 'application/json') => route.fulfill({ status, headers: { ...cors, 'content-type': type }, body: JSON.stringify(body) });
  if ((await req.allHeaders()).authorization !== `Bearer ${DASH_TOKEN}`) return json(401, { message: 'Bad credentials' });
  if (p === base) return json(200, { full_name: 'konstantin9ezm/aether', private: true });
  if (p === `${base}/branches/web-build`) return json(200, { name: 'web-build' });
  if (p === `${base}/contents/index.json`) {
    return json(200, [{ commit: 'abc1234' + '0'.repeat(33), short: 'abc1234', message: 'Kopfzeilen-Test', date: '2026-11-08T10:00:00Z', path: 'builds/abc1234/' }], 'application/vnd.github.raw+json');
  }
  return json(404, { message: 'Not Found' });
}
async function newDashboardPage(device) {
  const { context, page, log } = await newPage(plainBrowser, { device });
  await context.unroute('https://api.github.com/**');
  await context.route('https://api.github.com/**', dashboardApi);
  await page.addInitScript((t) => { if (window === window.top) localStorage.setItem('aether.githubToken', t); }, DASH_TOKEN);
  return { context, page, log };
}

// Lage des Kopfzeilen-Links: links neben dem Umschalter, gleiche Höhe, Tippfläche ≥ 44 × 44 px
// (per Treffertest an den Punkten der Fläche), kein Überlappen, Kopfzeile einzeilig, kein waagerechtes Scrollen.
async function headerLinkLayout(page) {
  return page.evaluate(() => {
    const a = document.getElementById('hdrWebgpu');
    const tabs = document.getElementById('tabs');
    const header = document.querySelector('header.top');
    const r = a.getBoundingClientRect(), t = tabs.getBoundingClientRect(), h = header.getBoundingClientRect();
    // Tippfläche per Treffertest ausmessen: zusammenhängende Strecke, die den Link trifft (waagerecht und senkrecht).
    const on = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && a.contains(e); };
    const cx0 = r.left + r.width / 2, cy = r.top + r.height / 2;
    let left = cx0, right = cx0, top = cy, bottom = cy;
    while (left > 0 && on(left - 0.5, cy)) left -= 0.5;
    while (right < window.innerWidth && on(right + 0.5, cy)) right += 0.5;
    while (top > 0 && on(cx0, top - 0.5)) top -= 0.5;
    while (bottom < window.innerHeight && on(cx0, bottom + 0.5)) bottom += 0.5;
    const hit = { left, right, top, bottom };
    const hw = right - left, hh = bottom - top;
    // 44 × 44 px innerhalb der Fläche (Ränder 1 px eingerückt) müssen überall den Link treffen.
    const cx = (left + right) / 2, cyy = (top + bottom) / 2;
    const miss = [];
    for (let dx = -21; dx <= 21; dx += 7) for (let dy = -21; dy <= 21; dy += 7) {
      const e = document.elementFromPoint(cx + dx, cyy + dy);
      if (!e || !a.contains(e)) miss.push(`${dx},${dy}:${e ? e.tagName + '#' + e.id : '-'}`);
    }
    const kids = [...header.children].filter((e) => e.getBoundingClientRect().width > 0);
    const tops = kids.map((e) => e.getBoundingClientRect()).map((k) => k.top + k.height / 2);
    return {
      visible: a.offsetParent !== null && r.width > 0,
      text: a.textContent.trim(), aria: a.getAttribute('aria-label'), href: a.getAttribute('href'), target: a.getAttribute('target'),
      iconOnly: getComputedStyle(a.querySelector('.lbl')).display === 'none',
      color: getComputedStyle(a).color, accent: (() => { const x = document.createElement('span'); x.style.color = 'var(--accent)'; document.body.appendChild(x); const c = getComputedStyle(x).color; x.remove(); return c; })(),
      fontSize: parseFloat(getComputedStyle(a).fontSize), tabFont: parseFloat(getComputedStyle(tabs.querySelector('button')).fontSize),
      border: getComputedStyle(a).borderTopWidth, bg: getComputedStyle(a).backgroundColor,
      hitW: hw, hitH: hh, miss, box: [r.left, r.top, r.width, r.height].map(Math.round), tabsBox: [t.left, t.top, t.width, t.height].map(Math.round),
      leftOfTabs: r.right <= t.left, gapToTabs: t.left - hit.right,
      sameRow: Math.abs(cy - (t.top + t.height / 2)) <= 4, rowSpread: Math.max(...tops) - Math.min(...tops), headerH: h.height, tabsH: t.height,
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      inView: hit.left >= 0 && hit.right <= window.innerWidth
    };
  });
}

const HEADER_LAYOUTS = [
  { name: 'iPhone 16 Pro hoch', device: { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'iPhone 13 hoch (390 px)', device: { viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'iPhone 16 Pro quer', device: { viewport: { width: 874, height: 402 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true } },
  { name: 'iPad quer', device: { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true } },
  { name: 'Desktop', device: { viewport: { width: 1280, height: 800 } } }
];

test('index.html: Link „WebGPU-Check“ auf dem Token-Bildschirm; Kopfzeilen-Link dort ausgeblendet', async () => {
  const { context, page, log } = await newPage(gpuBrowser);
  await page.goto(baseUrl);
  await page.waitForSelector('#tokenView:not([hidden])');
  const link = page.locator('#tokenView a[href="webgpu-check.html"]');
  assert.equal(await link.count(), 1);
  assert.equal(await link.isVisible(), true);
  assert.equal((await link.textContent()).trim(), 'WebGPU-Check');
  assert.equal(await page.isVisible('#tabs'), true, 'Kopfzeile mit Umschalter ist auf dem Token-Bildschirm sichtbar');
  assert.equal(await page.isVisible('header.top a[href="webgpu-check.html"]'), false, 'kein doppelter Link in der Kopfzeile');
  assert.equal(await page.locator('#buildsView a[href="webgpu-check.html"]').count(), 0, 'nicht mehr unten in der Build-Ansicht');
  // Tools-Karte der Projektansicht (Teil 1 Screen-Editor/Tools) hat einen eigenen Knopf; auf dem Token-Bildschirm unsichtbar.
  assert.equal(await page.locator('a[href="webgpu-check.html"]:not(#toolWebgpu)').count(), 2, 'sonst keine weiteren Links (Karte + Kopfzeile)');
  assert.equal(await page.locator('#toolsCard a[href="webgpu-check.html"]').count(), 1, 'Knopf in der Tools-Karte');
  assert.equal(await page.isVisible('#toolWebgpu'), false, 'Tools-Karte auf dem Token-Bildschirm nicht sichtbar');
  assert.deepEqual(log.github, [], 'ohne Token keine API-Aufrufe');
  await context.close();
});

for (const L of HEADER_LAYOUTS) {
  test(`Kopfzeile ${L.name}: Link „WebGPU-Check“ links neben dem Umschalter in Build- und Projektansicht`, async () => {
    const { context, page, log } = await newDashboardPage(L.device);
    await page.goto(baseUrl);
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    for (const view of ['Spielen', 'Projekt']) {
      if (view === 'Projekt') {
        await page.click('#tabProject');
        await page.waitForSelector('#projectView:not([hidden])');
      }
      assert.equal(await page.locator('header.top a[href="webgpu-check.html"]').count(), 1, `${view}: Link in der Kopfzeile`);
      assert.equal(await page.locator('main a[href="webgpu-check.html"]:visible:not(#toolWebgpu)').count(), 1, `${view}: genau ein sichtbarer Link (außer dem Tools-Knopf)`);
      assert.equal(await page.locator('#toolWebgpu:visible').count(), view === 'Projekt' ? 1 : 0, `${view}: Tools-Knopf nur in der Projektansicht`);
      const m = await headerLinkLayout(page);
      const label = `${L.name}/${view}`;
      console.log(`# Kopfzeile ${label}: Link ${m.box.join(',')} Tippfläche ${m.hitW}×${m.hitH} Abstand ${m.gapToTabs} Umschalter ${m.tabsBox.join(',')} Kopfzeile ${m.headerH} Symbol ${m.iconOnly}`);
      assert.ok(m.visible, `${label}: sichtbar`);
      assert.equal(m.href, 'webgpu-check.html');
      assert.equal(m.target, null, 'öffnet wie bisher im selben Tab');
      assert.equal(m.aria, 'WebGPU-Check');
      if (!m.iconOnly) assert.equal(m.text, 'WebGPU-Check');
      assert.equal(m.color, m.accent, `${label}: Link-/Akzentblau`);
      assert.ok(m.fontSize < m.tabFont, `${label}: kleiner als die Umschalter-Beschriftung (${m.fontSize} < ${m.tabFont})`);
      assert.equal(m.border, '0px');
      assert.equal(m.bg, 'rgba(0, 0, 0, 0)');
      assert.ok(m.hitW >= 44 && m.hitH >= 44, `${label}: Tippfläche ${m.hitW}×${m.hitH}`);
      assert.deepEqual(m.miss, [], `${label}: Tippfläche trifft überall den Link`);
      assert.ok(m.leftOfTabs, `${label}: links neben dem Umschalter`);
      assert.ok(m.gapToTabs >= 0, `${label}: Tippfläche überlappt den Umschalter nicht (Abstand ${m.gapToTabs}px)`);
      assert.ok(m.sameRow, `${label}: gleiche Höhe wie der Umschalter`);
      assert.ok(m.rowSpread <= 4 && m.headerH <= m.tabsH + 1, `${label}: Kopfzeile einzeilig (Höhe ${m.headerH}, Streuung ${m.rowSpread})`);
      assert.ok(m.overflow <= 0, `${label}: kein waagerechtes Scrollen (${m.overflow}px)`);
      assert.ok(m.inView, `${label}: Tippfläche im Fenster`);
      if (L.device.viewport.width <= 460) assert.ok(m.iconOnly, 'hochkant nur Symbol');
      else assert.ok(!m.iconOnly, `${label}: Text sichtbar`);
      await page.screenshot({ path: path.join(OUT, `kopfzeile-${L.name.replace(/\W+/g, '_')}-${view}.png`), clip: { x: 0, y: 0, width: L.device.viewport.width, height: 110 } });
    }
    assert.deepEqual(log.errors, []);
    await context.close();
  });
}

// ---------------------------------------------------------------------------
// Hauptablauf mit WebGPU (Desktop)
// ---------------------------------------------------------------------------
describe('WebGPU-Check mit WebGPU (Desktop)', () => {
  let context, page, log;
  before(async () => {
    ({ context, page, log } = await newPage(gpuBrowser, { permissions: ['clipboard-read', 'clipboard-write'] }));
    await page.goto(baseUrl + PAGE);
    await waitReady(page);
  });
  after(async () => { await context?.close(); });

  test('lädt ohne Token und ohne Anfrage an api.github.com; nichts gespeichert', async () => {
    assert.deepEqual(log.github, [], 'keine Anfrage an api.github.com');
    for (const u of log.urls) assert.match(u, /^(http:\/\/localhost:\d+\/|about:|data:)/, `nur eigene Adresse: ${u}`);
    const stored = await page.evaluate(() => ({ ls: localStorage.length, ss: sessionStorage.length, cookie: document.cookie }));
    assert.deepEqual(stored, { ls: 0, ss: 0, cookie: '' });
  });

  test('WebGPU-Probe direkt und im iframe grün; WebGL 2 ok; Grafikweg WebGPU', async () => {
    assert.equal(await page.getAttribute('#chkDirect', 'data-state'), 'ok');
    assert.equal(await page.getAttribute('#chkFrame', 'data-state'), 'ok');
    assert.equal(await page.getAttribute('#chkGl2', 'data-state'), 'ok');
    assert.equal(await page.textContent('#gfxPath'), 'WebGPU');
    const rows = await probeCells(page);
    const steps = ['navigator.gpu', 'requestAdapter', 'requestDevice', 'Canvas konfigurieren', '5 Frames (Löschen + Dreieck)', 'Pixel Mitte', 'Pixel Ecke', 'Compute + mapAsync', 'destroy → lost „destroyed“', 'WebGL 2: Löschen + readPixels'];
    for (const s of steps) {
      const r = rows.find((x) => x[0] === s);
      assert.ok(r, `Schritt ${s}`);
      assert.match(r[1], /^ok/, `direkt ${s}: ${r[1]}`);
      assert.match(r[2], /^ok/, `iframe ${s}: ${r[2]}`);
    }
    const frameEnv = rows.filter((x) => ['isSecureContext', 'crossOriginIsolated'].includes(x[0])).map((x) => x[2]);
    assert.deepEqual(frameEnv, ['ja', 'nein'], 'iframe: sicherer Kontext, nicht isoliert');
    assert.match(rows.find((x) => x[0] === 'Adapter')[2], /swiftshader/i, 'Adapter-Infos aus dem iframe');
  });

  test('iframe-Attribute stimmen mit createGameFrame() in index.html überein', async () => {
    const want = indexFrameAttrs();
    const got = await page.evaluate(() => {
      const f = document.getElementById('probeFrame');
      return { sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow'), referrerpolicy: f.getAttribute('referrerpolicy'), names: f.getAttributeNames().sort(), srcdoc: f.hasAttribute('srcdoc') };
    });
    assert.deepEqual({ sandbox: got.sandbox, allow: got.allow, referrerpolicy: got.referrerpolicy }, want);
    assert.ok(!got.sandbox.includes('allow-same-origin'));
    assert.equal(got.srcdoc, true, 'srcdoc wie im Dashboard');
    assert.deepEqual(got.names, ['allow', 'id', 'referrerpolicy', 'sandbox', 'srcdoc', 'title'], 'keine weiteren Attribute');
    // Kein Zugriff auf die Seite (fremder Ursprung wie beim Spiel).
    const frame = probeFrame(page);
    assert.equal(await frame.evaluate(() => { try { return String(window.parent.document.title); } catch (e) { return 'blocked'; } }), 'blocked');
  });

  test('Bildtakt: Stufen a, b und d messen, c lässt sich überspringen', async () => {
    assert.equal(await page.isEnabled('#fpsBtn-a'), true);
    assert.equal(await page.isEnabled('#fpsBtn-b'), false, 'Stufen nacheinander');

    await page.click('#fpsBtn-a');
    await waitStatus(page, 'a', 'fertig');
    const a = await fpsState(page, 'a');
    assertStats(a.result, 'a');
    assert.equal(a.result.api, 'WebGPU');

    await page.click('#fpsBtn-b');
    await waitStatus(page, 'b', 'fertig');
    const b = await fpsState(page, 'b');
    assertStats(b.result, 'b');
    assert.equal(b.result.api, 'WebGPU');
    assert.equal(b.result.how, 'ohne Interaktion');
    assert.equal(b.result.interactedBefore, false, 'b ohne jede Interaktion mit dem iframe');

    const frame = probeFrame(page);
    await page.click('#fpsBtn-c');
    await waitStatus(page, 'c', 'wartet auf Controller-Taste');
    assert.equal(await page.isVisible('#fpsHint-c'), true);
    await frame.waitForSelector('#padHint', { state: 'visible' });
    await page.click('#fpsSkip-c');
    await waitStatus(page, 'c', 'übersprungen');
    await frame.waitForSelector('#overlay', { state: 'hidden' });

    await page.click('#fpsBtn-d');
    await waitStatus(page, 'd', 'wartet auf Antippen');
    await frame.waitForSelector('#tap', { state: 'visible' });
    assert.equal(await page.isVisible('#fpsHint-d'), true);
    // Erst klicken, wenn das iframe die eingeblendete Tippfläche gezeichnet hat: Im vollen Chromium ging ein
    // sofortiger Klick ins sandboxed iframe gelegentlich verloren (Status blieb „wartet auf Antippen“).
    // evaluate löst kein pointerdown/mousedown aus, zählt also nicht als Antippen.
    await frame.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    await frame.click('#tap');
    await waitStatus(page, 'd', 'fertig');
    const d = await fpsState(page, 'd');
    assertStats(d.result, 'd');
    assert.equal(d.result.how, 'nach Antippen');
    assert.equal(d.result.interactedBefore, true);

    for (const id of ['a', 'b', 'd']) assert.equal(await page.isVisible(`#fpsChart-${id}`), true, `Diagramm ${id}`);
    const interp = await page.textContent('#fpsInterp');
    assert.match(interp, /30 fps, bis man mit dem iframe interagiert/);
    assert.match(interp, /Stromsparmodus/);
    assert.match(interp, /Stufe c übersprungen/);
    await page.screenshot({ path: path.join(OUT, 'webgpu-check-desktop.png'), fullPage: true });
  });

  test('alle Abschnitte gefüllt', async () => {
    const secs = await page.$$eval('[data-section]', (els) => els.map((s) => ({
      name: s.getAttribute('data-section'),
      cells: [...s.querySelectorAll('dd, td, .checks .detail, #gfxPath')]
        .filter((c) => !c.matches('.checks .detail') || c.closest('li').getAttribute('data-state') !== 'ok')
        // typeof SharedArrayBuffer ist ohne Isolation zu Recht "undefined".
        .filter((c) => !(c.closest('.kv-row') && c.closest('.kv-row').querySelector('dt').textContent === 'typeof SharedArrayBuffer'))
        .map((c) => c.textContent.trim())
    })));
    assert.deepEqual(secs.map((s) => s.name), SECTION_ORDER, 'Reihenfolge der Abschnitte');
    for (const s of secs) {
      assert.ok(s.cells.length > 0, `${s.name}: Einträge vorhanden`);
      for (const c of s.cells) {
        assert.ok(c.length > 0, `${s.name}: leere Angabe`);
        assert.doesNotMatch(c, /läuft …|undefined|null|NaN|\[object/, `${s.name}: ${c}`);
      }
    }
    assert.equal(await page.$$eval('#gpuFeatures .chip', (e) => e.length) > 0, true, 'Features gelistet');
    assert.equal(await page.$$eval('#gpuLimits .kv-row', (e) => e.length) > 20, true, 'Limits gelistet');
    const order = await page.$$eval('main > section h2', (h) => h.map((x) => x.textContent));
    assert.deepEqual(order, [...SECTION_ORDER, 'Weitergabe']);
    assert.match(await page.textContent('#listMore'), /typeof SharedArrayBuffer(undefined|function)/);
    assert.equal(await page.textContent('#secShare .note'), 'Nichts wird automatisch gesendet.');
  });

  test('Ergebnistext: beginnt mit AETHER-CHECK v1, Pflicht-Schlüssel, feste Reihenfolge', async () => {
    const text = await page.textContent('#resultText');
    assert.equal(text, await page.evaluate(() => window.__aetherCheck.text()));
    assert.ok(text.startsWith('AETHER-CHECK v1\n'), 'Kopfzeile');
    const lines = text.split('\n');
    for (const l of lines.slice(1)) if (l) assert.match(l, /^[^:\n]+: .+$/, `eine Angabe pro Zeile „Schlüssel: Wert“: ${l}`);
    for (const k of REQUIRED_KEYS) {
      const re = new RegExp('^' + k.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ': .+$', 'm');
      assert.match(text, re, `Pflicht-Schlüssel fehlt: ${k}`);
    }
    const order = lines.filter((l) => l.startsWith('Abschnitt: ')).map((l) => l.slice(11));
    assert.deepEqual(order, SECTION_ORDER);
    assert.match(text, /^Zeitpunkt: \d\d\.\d\d\.\d{4}, \d\d:\d\d:\d\d \(deutsche Ortszeit\)$/m);
    assert.match(text, /^Dashboard-Commit: nicht bekannt$/m, 'lokal kein Commit eingesetzt');
    assert.match(text, /^Grafikweg fürs Spiel: WebGPU$/m);
    assert.match(text, /^Modell: Modell im Browser nicht ermittelbar$/m);
    assert.match(text, /^Bildtakt c \(iframe nach Controller-Taste\): übersprungen$/m);
    assert.match(text, /^Bildtakt b \(iframe ohne Interaktion\): \d+ Frames, .*iframe vorher berührt: nein/m);
  });

  test('„Ergebnis kopieren“ legt den kompletten Text in die Zwischenablage', async () => {
    await page.click('#copyBtn');
    await page.waitForFunction(() => document.getElementById('copyStatus').textContent === 'Kopiert.');
    const clip = await page.evaluate(() => navigator.clipboard.readText());
    assert.equal(clip, await page.textContent('#resultText'));
    assert.ok(clip.startsWith('AETHER-CHECK v1'));
  });

  test('„Per Mail senden“: mailto an die Feedback-Adresse, höchstens 2000 Zeichen, Zusammenfassung zuerst', async () => {
    const before = launched(log).length;
    await page.click('#mailBtn');
    while (launched(log).length <= before) await page.waitForEvent('console');
    const url = /^Launched external handler for '(.*)'\.$/.exec(launched(log)[before])[1];
    assert.ok(url.length <= 2000, `mailto-Länge ${url.length}`);
    assert.equal(url, await page.evaluate(() => window.__aetherCheck.mailto()));
    assert.ok(url.startsWith(`mailto:${TO}?subject=`), 'Empfänger');
    const params = new URLSearchParams(url.slice(url.indexOf('?') + 1));
    const ua = await page.evaluate(() => navigator.userAgent);
    const ver = /(?:HeadlessChrome|Chrome)\/([\d.]+)/.exec(ua)[1];
    assert.equal(params.get('subject'), `Aether WebGPU-Check - Linux Chrome ${ver}`);
    const body = params.get('body');
    assert.ok(body.startsWith('AETHER-CHECK v1\n'), 'Text beginnt mit der Kopfzeile');
    assert.ok(body.endsWith('\n\n' + CUT_NOTE), 'gekürzt mit Hinweis');
    assert.match(body, /^Grafikweg fürs Spiel: WebGPU$/m, 'Zusammenfassung enthalten');
    assert.match(body, /^Probe iframe: alle 10 Schritte ok$/m);
    assert.match(body, /^Bildtakt: a ≈ \d+ fps .*\| c übersprungen \| d ≈ \d+ fps/m);
    assert.doesNotMatch(body, /^Limit /m, 'Limits kommen zuletzt (hier abgeschnitten)');
    assert.equal(await page.evaluate(() => location.pathname.endsWith('webgpu-check.html')), true, 'Seite bleibt offen');
  });

  test('„Erneut prüfen“ läuft erneut durch und setzt den Bildtakt zurück', async () => {
    await page.click('#rerunBtn');
    await page.waitForSelector('#fps-a[data-status="offen"]');
    await waitReady(page);
    assert.equal(await page.getAttribute('#chkFrame', 'data-state'), 'ok');
    assert.equal(await page.locator('#probeFrame').count(), 1, 'genau ein iframe');
  });

  test('keine Seitenfehler in der Konsole', () => {
    assert.deepEqual(log.errors, []);
    assert.deepEqual(log.consoleErrors, []);
  });
});

// ---------------------------------------------------------------------------
// User-Agent: Safari-Version aus "Version/…", nie aus dem eingefrorenen OS-Feld
// ---------------------------------------------------------------------------
test('User-Agent: Browser-Version und Gerätetyp', async () => {
  const { context, page } = await newPage(gpuBrowser);
  await page.goto(baseUrl + PAGE);
  await page.waitForFunction(() => !!window.__aetherCheck);
  const cases = [
    { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1', touch: 5, type: 'iPhone', label: 'Safari 26.0' },
    { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_7 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.2 Mobile/15E148 Safari/604.1', touch: 5, type: 'iPhone', label: 'Safari 26.2' },
    { ua: 'Mozilla/5.0 (iPad; CPU OS 18_6_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Mobile/15E148 Safari/604.1', touch: 5, type: 'iPad', label: 'Safari 26.1' },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15', touch: 5, type: 'iPad', label: 'Safari 26.1' },
    { ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.1 Safari/605.1.15', touch: 0, type: 'Mac', label: 'Safari 26.1' },
    { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148', touch: 5, type: 'iPhone', label: 'Safari/WebKit' },
    { ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/142.0.7444.77 Mobile/15E148 Safari/604.1', touch: 5, type: 'iPhone', label: 'Chrome (iOS) 142.0.7444.77' },
    { ua: 'Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/145.0 Mobile/15E148 Safari/605.1.15', touch: 5, type: 'iPad', label: 'Firefox (iOS) 145.0' },
    { ua: 'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Mobile Safari/537.36', touch: 5, type: 'Android', label: 'Chrome 142.0.0.0' },
    { ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', touch: 0, type: 'Windows', label: 'Edge 142.0.0.0' },
    { ua: 'Mozilla/5.0 (X11; Linux x86_64; rv:145.0) Gecko/20100101 Firefox/145.0', touch: 0, type: 'Linux', label: 'Firefox 145.0' }
  ];
  const got = await page.evaluate((cs) => cs.map((c) => ({ type: window.__aetherCheck.deviceType(c.ua, c.touch), label: window.__aetherCheck.parseUA(c.ua).label })), cases);
  cases.forEach((c, i) => {
    assert.equal(got[i].label, c.label, `Browser für ${c.ua}`);
    assert.equal(got[i].type, c.type, `Gerätetyp für ${c.ua}`);
  });
  await context.close();
});

test('Dashboard-Commit erscheint, wenn der Workflow ihn eingesetzt hat', async () => {
  const { context, page } = await newPage(gpuBrowser);
  const sha = '0123456789abcdef0123456789abcdef01234567';
  await context.route(baseUrl + PAGE, async (route) => {
    const res = await route.fetch();
    route.fulfill({ response: res, body: (await res.text()).replace('__AETHER_COMMIT__', sha) });
  });
  await page.goto(baseUrl + PAGE);
  await page.waitForFunction(() => !!window.__aetherCheck && window.__aetherCheck.state() && window.__aetherCheck.state().device);
  assert.match(await page.evaluate(() => window.__aetherCheck.text()), /^Dashboard-Commit: 0123456789ab$/m);
  await context.close();
});

// ---------------------------------------------------------------------------
// Rückfall ohne WebGPU
// ---------------------------------------------------------------------------
test('ohne die WebGPU-Flags: kein Adapter, WebGL 2 ok, Grafikweg WebGL-Rückfall', async () => {
  const { context, page, log } = await newPage(plainBrowser);
  await page.goto(baseUrl + PAGE);
  await waitReady(page);
  assert.equal(await page.getAttribute('#chkDirect', 'data-state'), 'nein');
  assert.match(await page.textContent('#chkDirect .detail'), /kein Adapter/);
  assert.equal(await page.getAttribute('#chkFrame', 'data-state'), 'nein');
  assert.match(await page.textContent('#chkFrame .detail'), /kein Adapter/);
  assert.equal(await page.getAttribute('#chkGl2', 'data-state'), 'ok');
  assert.equal(await page.textContent('#gfxPath'), 'WebGL-Rückfall');
  const rows = await probeCells(page);
  const ra = rows.find((r) => r[0] === 'requestAdapter');
  assert.match(ra[1], /^kein Adapter/); assert.match(ra[2], /^kein Adapter/);
  for (const s of ['requestDevice', 'Pixel Mitte', 'Compute + mapAsync']) assert.deepEqual(rows.find((r) => r[0] === s).slice(1), ['–', '–'], s);
  const gl = rows.find((r) => r[0] === 'WebGL 2: Löschen + readPixels');
  assert.match(gl[1], /^ok/); assert.match(gl[2], /^ok/);
  // Bildtakt läuft mit der WebGL-2-Szene.
  await page.click('#fpsBtn-a');
  await waitStatus(page, 'a', 'fertig');
  const a = await fpsState(page, 'a');
  assertStats(a.result, 'a (WebGL)');
  assert.equal(a.result.api, 'WebGL 2');
  assert.match(await page.textContent('#resultText'), /^Grafikweg fürs Spiel: WebGL-Rückfall$/m);
  assert.deepEqual(log.errors, []);
  assert.deepEqual(log.consoleErrors, []);
  await context.close();
});

test('navigator.gpu entfernt: WebGPU fehlt, WebGL 2 ok', async () => {
  // Init-Skripte erreichen srcdoc-Frames in Playwright erst verzögert; deshalb setzt das Init-Skript
  // der Seite das Entfernen zusätzlich an den Anfang jedes srcdoc (gilt so ab der ersten Zeile im iframe).
  const init = () => {
    try { delete Navigator.prototype.gpu; } catch (e) { /* egal */ }
    if (window !== window.top) return;
    const d = Object.getOwnPropertyDescriptor(HTMLIFrameElement.prototype, 'srcdoc');
    Object.defineProperty(HTMLIFrameElement.prototype, 'srcdoc', {
      configurable: true, get: d.get,
      set(v) { d.set.call(this, String(v).replace('<head>', '<head><script>delete Navigator.prototype.gpu;<\/script>')); }
    });
  };
  const { context, page, log } = await newPage(gpuBrowser, { init });
  await page.goto(baseUrl + PAGE);
  await waitReady(page);
  assert.equal(await page.evaluate(() => 'gpu' in navigator), false);
  assert.equal(await page.getAttribute('#chkDirect', 'data-state'), 'nein');
  assert.match(await page.textContent('#chkDirect .detail'), /WebGPU fehlt/);
  assert.match(await page.textContent('#chkFrame .detail'), /WebGPU fehlt/);
  assert.equal(await page.getAttribute('#chkGl2', 'data-state'), 'ok');
  assert.equal(await page.textContent('#gfxPath'), 'WebGL-Rückfall');
  const rows = await probeCells(page);
  assert.deepEqual(rows.find((r) => r[0] === 'navigator.gpu').slice(1), ['WebGPU fehlt', 'WebGPU fehlt']);
  assert.deepEqual(rows.find((r) => r[0] === 'requestAdapter').slice(1), ['–', '–']);
  const text = await page.textContent('#resultText');
  assert.match(text, /^navigator\.gpu: fehlt \(WebGPU fehlt\)$/m);
  assert.match(text, /^WebGL 2: ja$/m);
  assert.deepEqual(log.errors, []);
  assert.deepEqual(log.consoleErrors, []);
  await context.close();
});

// ---------------------------------------------------------------------------
// Layout auf iPhone 16 Pro (hoch/quer) und iPad (quer)
// ---------------------------------------------------------------------------
const IOS_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1';
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15';
const LAYOUTS = [
  { name: 'iPhone 16 Pro hoch', type: 'iPhone', device: { viewport: { width: 402, height: 874 }, screen: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA } },
  { name: 'iPhone 16 Pro quer', type: 'iPhone', device: { viewport: { width: 874, height: 402 }, screen: { width: 874, height: 402 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, userAgent: IOS_UA } },
  { name: 'iPad quer', type: 'iPad', device: { viewport: { width: 1210, height: 834 }, screen: { width: 1210, height: 834 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, userAgent: IPAD_UA } }
];
for (const L of LAYOUTS) {
  test(`Layout ${L.name}: kein waagerechtes Scrollen, Knöpfe mindestens 44 px hoch`, async () => {
    // Chromium meldet bei hasTouch nur maxTouchPoints 1; echte iPhones/iPads melden 5.
    const init = () => Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => 5 });
    const { context, page, log } = await newPage(gpuBrowser, { device: L.device, init });
    await page.goto(baseUrl + PAGE);
    await waitReady(page);
    await page.click('#fpsBtn-a');
    await waitStatus(page, 'a', 'fertig');
    const m = await page.evaluate(() => ({
      overflow: document.documentElement.scrollWidth - window.innerWidth,
      bodyOverflow: document.body.scrollWidth - window.innerWidth,
      small: [...document.querySelectorAll('button, .btn')].filter((b) => b.offsetParent !== null)
        .map((b) => ({ id: b.id || b.textContent.trim(), h: b.getBoundingClientRect().height })).filter((b) => b.h < 44),
      wide: [...document.querySelectorAll('main *')].filter((e) => e.getBoundingClientRect().right > window.innerWidth + 0.5 && e.offsetParent !== null).map((e) => e.tagName + '#' + e.id + '.' + e.className).slice(0, 5)
    }));
    assert.ok(m.overflow <= 0 && m.bodyOverflow <= 0, `waagerechter Überlauf ${m.overflow}px: ${m.wide.join(', ')}`);
    assert.deepEqual(m.wide, [], 'kein Element ragt rechts heraus');
    assert.deepEqual(m.small, [], 'Knöpfe ≥ 44 px');
    assert.match(await page.textContent('#resultText'), new RegExp(`^Gerätetyp: ${L.type}`, 'm'));
    await page.screenshot({ path: path.join(OUT, `webgpu-check-${L.name.replace(/\W+/g, '_')}.png`), fullPage: true });
    assert.deepEqual(log.errors, []);
    await context.close();
  });
}
