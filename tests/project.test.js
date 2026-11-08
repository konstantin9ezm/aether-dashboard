// End-to-End-Tests für die Projektansicht (Build-Ampel, Zeitleiste, ROADMAP.md, Engine-Karte)
// mit nachgebauter GitHub-REST-API. Aufruf: node --test tests/
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
const OWNER = 'konstantin9ezm';
const REPO = 'aether';
const BASE = `/repos/${OWNER}/${REPO}`;
const GH = `https://github.com/${OWNER}/${REPO}`;

fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Testdaten
// ---------------------------------------------------------------------------
const sha = (c) => c.repeat(40);
const S = {
  direct: sha('a'), // direkter Commit auf main
  m3: sha('b'),     // Merge-Commit von PR #3
  p3b: sha('c'),    // Commit im PR-Branch #3
  p3a: sha('d'),    // Commit im PR-Branch #3
  s2: sha('e'),     // Squash-Merge von PR #2
  init: sha('f'),   // Initial commit
  m1: '1'.repeat(40) // Merge-Commit von PR #1, nicht mehr in der Commit-Liste
};
const commit = (s, message, date, parents) => ({
  sha: s, html_url: `${GH}/commit/${s}`,
  commit: { message, author: { date }, committer: { date } },
  parents: parents.map((p) => ({ sha: p }))
});
const COMMITS = [
  commit(S.direct, 'README: Tippfehler korrigiert', '2026-11-05T10:00:00Z', [S.m3]),
  commit(S.m3, 'Merge pull request #3 from konstantin9ezm/kamera\n\nNeue Kamera', '2026-11-04T20:00:00Z', [S.s2, S.p3b]),
  commit(S.p3b, 'Kamera: Feinschliff', '2026-11-04T19:00:00Z', [S.p3a]),
  commit(S.p3a, 'Kamera: erster Wurf', '2026-11-04T18:00:00Z', [S.s2]),
  commit(S.s2, 'Web-Build veröffentlichen (#2)', '2026-11-03T12:00:00Z', [S.init]),
  commit(S.init, 'Initial commit', '2026-11-01T09:00:00Z', [])
];
const pr = (number, title, merged_at, merge_commit_sha) => ({
  number, title, merged_at, merge_commit_sha, state: 'closed', base: { ref: 'main' },
  html_url: `${GH}/pull/${number}`
});
const PULLS = [
  pr(4, 'Abgelehnter Versuch', null, sha('9')),
  pr(3, 'Neue Kamera', '2026-11-04T20:00:01Z', S.m3),
  pr(2, 'Web-Build über GitHub Pages', '2026-11-03T12:00:00Z', S.s2),
  pr(1, 'Grundgerüst der Engine', '2026-10-30T15:30:00Z', S.m1)
];

const ROADMAP_NORMAL = `<!--
Format dieser Datei (wird vom Dashboard gelesen):
## Abschnitt
- [x] erledigter Punkt (PR #99)
- [ ] offener Punkt
-->
# Aether – Roadmap

## Erledigt
- [x] Kern: Log, Mathe, Spielschleife (PR #1)
- [x] SDL3- und NULL-Backend (PR #2)
- [x] Web/Emscripten-Build (PR #3)

## Als Nächstes (Etappe 4)
- [x] Projektübersicht im Dashboard (PR #5)
- [ ] Flugmodell verfeinern
- [ ] WebGL-2-Renderer stabilisieren

## Danach (laut Engine-Plan)
- [ ] Physik mit Jolt
- [ ] ECS mit EnTT
- [ ] Audio mit miniaudio

## Für später
- [ ] Vulkan-RHI
- [ ] Lua-Skripting
`;

// Unerwartete Zeilen: BOM, CRLF, Punkte vor dem ersten Abschnitt, Unterüberschrift, Tabelle,
// Freitext, Liste ohne Checkbox, Einrückung, großes X, mehrere PRs, leerer Punkt, HTML im Text,
// unbekanntes Häkchen, leerer und unbekannter Abschnitt, Kommentar mitten in der Datei.
const ROADMAP_WEIRD = '\uFEFF' + [
  '<!-- Formatbeschreibung',
  '## Das ist kein Abschnitt',
  '- [x] und kein Punkt',
  '-->',
  '- [x] Punkt vor dem ersten Abschnitt',
  '# Titel',
  'Einfach nur Text.',
  '## Erledigt',
  '- [X] Großes X (PR #7) (PR #8)',
  '  - [x] eingerückt (PR #9)',
  '- [x]ohne Leerzeichen',
  '* [ ] Stern statt Strich',
  '- [ ]',
  '- normale Liste ohne Kästchen',
  '- [~] unbekanntes Häkchen',
  '| Spalte | Spalte |',
  '### Unterüberschrift',
  '## Als Nächstes (Etappe 4)',
  '- [ ] <img src=x onerror="window.__xss=1"> nicht als HTML (PR #abc)',
  '<!-- ein Kommentar --> - [x] nach Kommentar',
  '## Ganz neuer Abschnitt',
  '##',
  '- [ ] Punkt im namenlosen Abschnitt',
  ''
].join('\r\n');

// ---------------------------------------------------------------------------
// Mock der GitHub-REST-API
// ---------------------------------------------------------------------------
const mock = {
  reset() {
    Object.assign(this, { mode: 'ok', run: 'success', actions: 'ok', roadmap: 'normal', requests: [] });
  }
};
mock.reset();

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'ETag, Link, Retry-After, X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Used, X-RateLimit-Resource, X-RateLimit-Reset'
};
const rate = (remaining) => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800) });
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, ...rate(4990), 'content-type': 'application/json; charset=utf-8' }, body: JSON.stringify(body) });

function runFor(kind) {
  const base = {
    id: 9001, run_number: 57, name: 'Build', head_branch: 'main', head_sha: '0abc1234def5678900000000000000000000beef',
    event: 'push', display_title: 'README: Tippfehler korrigiert',
    head_commit: { message: 'README: Tippfehler korrigiert\n\nmehr Text' },
    created_at: '2026-11-05T10:01:00Z', run_started_at: '2026-11-05T10:01:05Z', updated_at: '2026-11-05T10:07:30Z'
  };
  if (kind === 'success') return { ...base, status: 'completed', conclusion: 'success' };
  if (kind === 'failure') return { ...base, status: 'completed', conclusion: 'failure' };
  if (kind === 'in_progress') return { ...base, status: 'in_progress', conclusion: null };
  return null;
}

async function githubApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept', 'access-control-max-age': '86400' } });
  }
  mock.requests.push({ path: url.pathname, query: url.search, auth: headers.authorization || null, accept: headers.accept || '' });
  if (mock.mode === 'offline') return route.abort('internetdisconnected');
  if (mock.mode === 'ratelimit') {
    return route.fulfill({ status: 403, headers: { ...CORS, ...rate(0), 'content-type': 'application/json' }, body: JSON.stringify({ message: 'API rate limit exceeded for user.' }) });
  }
  if (headers.authorization !== `Bearer ${TOKEN}` || mock.mode === 'revoked') return json(route, 401, { message: 'Bad credentials' });

  const p = url.pathname;
  const q = url.searchParams;
  if (p.startsWith(`${BASE}/actions/`) && mock.actions === 'forbidden') {
    return json(route, 403, { message: 'Resource not accessible by personal access token' });
  }
  if (p === `${BASE}/actions/workflows`) {
    return json(route, 200, { total_count: 2, workflows: [
      { id: 7, name: 'Web-Build', path: '.github/workflows/web.yml', state: 'active' },
      { id: 42, name: 'Build', path: '.github/workflows/build.yml', state: 'active' }
    ] });
  }
  if (p === `${BASE}/actions/workflows/42/runs`) {
    assert.equal(q.get('branch'), 'main', 'Läufe nur von main');
    const run = runFor(mock.run);
    return json(route, 200, { total_count: run ? 1 : 0, workflow_runs: run ? [run] : [] });
  }
  if (p === `${BASE}/pulls`) {
    assert.equal(q.get('state'), 'closed');
    assert.equal(q.get('base'), 'main');
    return json(route, 200, PULLS);
  }
  if (p === `${BASE}/commits`) {
    assert.equal(q.get('sha'), 'main');
    return json(route, 200, COMMITS);
  }
  if (p === `${BASE}/contents/ROADMAP.md`) {
    assert.equal(q.get('ref'), 'main');
    assert.ok(headers.accept.includes('application/vnd.github.raw'), 'ROADMAP.md roh laden');
    if (mock.roadmap === 'missing') return json(route, 404, { message: 'Not Found' });
    const body = mock.roadmap === 'weird' ? ROADMAP_WEIRD : ROADMAP_NORMAL;
    return route.fulfill({ status: 200, headers: { ...CORS, ...rate(4990), 'content-type': 'application/vnd.github.raw+json; charset=utf-8' }, body });
  }
  // Spielansicht (nur für den Wechsel zurück)
  if (p === `${BASE}/contents/index.json`) {
    return route.fulfill({ status: 200, headers: { ...CORS, ...rate(4990), 'content-type': 'application/vnd.github.raw+json' },
      body: JSON.stringify([{ commit: sha('a'), short: 'aaaaaaa', message: 'Ein Build', date: '2026-11-04T21:05:14Z', path: 'builds/aaaaaaa/' }]) });
  }
  return json(route, 404, { message: 'Not Found' });
}

// ---------------------------------------------------------------------------
// Statischer Server
// ---------------------------------------------------------------------------
let server, baseUrl, browser;
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };

before(async () => {
  server = http.createServer((req, res) => {
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

async function newPage(deviceName, { withToken = true, timezoneId = 'Europe/Berlin' } = {}) {
  const opts = deviceName ? { ...devices[deviceName] } : { viewport: { width: 1180, height: 820 } };
  const context = await browser.newContext({ ...opts, locale: 'de-DE', timezoneId });
  const page = await context.newPage();
  const log = { console: [], urls: [], errors: [] };
  page.on('console', (m) => log.console.push(m.text()));
  page.on('pageerror', (e) => log.errors.push(String(e)));
  context.on('request', (r) => log.urls.push(r.url()));
  page.on('dialog', (d) => d.accept());
  if (withToken) await context.addInitScript((t) => localStorage.setItem('aether.githubToken', t), TOKEN);
  await context.route('https://api.github.com/**', githubApi);
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  return { context, page, log };
}

async function openProject(page) {
  await page.goto(baseUrl);
  await page.click('#tabProject');
  await page.waitForSelector('#projectView:not([hidden])');
  await waitProjectLoaded(page);
}
async function waitProjectLoaded(page) {
  await page.waitForFunction(() => ['ciBody', 'timelineBody', 'roadmapBody', 'engineBody']
    .every((id) => { const b = document.getElementById(id); return b.firstChild && !b.querySelector('.loadline'); }));
}
const text = (page, sel) => page.textContent(sel).then((t) => t.replace(/\s+/g, ' ').trim());

async function assertNoLeak(log, page) {
  for (const u of log.urls) assert.ok(!u.includes(TOKEN) && !u.includes('github_pat_'), `Token in URL: ${u}`);
  for (const c of log.console) assert.ok(!c.includes(TOKEN), 'Token in Konsolenausgabe');
  assert.equal(await page.evaluate((t) => document.documentElement.outerHTML.includes(t), TOKEN), false, 'Token im DOM');
  assert.deepEqual(log.errors, [], 'keine Skriptfehler');
}

async function assertTouchFriendly(page, label) {
  const small = await page.evaluate(() => {
    const out = [];
    document.querySelectorAll('#tabs button, #projectView a, #projectView button, #projectView summary').forEach((e) => {
      const r = e.getBoundingClientRect();
      if (r.width === 0 && r.height === 0) return; // eingeklappt
      if (r.height < 44 || r.width < 44) out.push(`${e.tagName}.${e.className} ${Math.round(r.width)}x${Math.round(r.height)} "${e.textContent.trim().slice(0, 30)}"`);
    });
    return out;
  });
  assert.deepEqual(small, [], `zu kleine Tippflächen (${label})`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(overflow <= 0, `horizontaler Überlauf (${label}): ${overflow}px`);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------
for (const deviceName of [null, 'iPad Pro 11', 'iPad Pro 11 landscape', 'iPhone 13']) {
  const label = deviceName || 'Desktop';
  test(`Projektansicht: alle vier Teile (${label})`, async () => {
    mock.reset();
    const { context, page, log } = await newPage(deviceName);
    await openProject(page);

    // Umschalter
    assert.equal(await page.getAttribute('#tabProject', 'aria-selected'), 'true');
    assert.ok(await page.isHidden('#buildsView'), 'Spielansicht ausgeblendet');

    // 1. Build-Ampel
    assert.equal(await page.getAttribute('#ciLight', 'data-state'), 'ok');
    const ci = await text(page, '#ciLight');
    assert.match(ci, /Erfolgreich/);
    assert.match(ci, /05\.11\.2026, 11:07 Uhr/, 'Zeit in deutscher Ortszeit');
    assert.match(ci, /0abc123/, 'kurzer Commit-Hash');
    assert.doesNotMatch(ci, /0abc1234/, 'nur 7 Zeichen');
    assert.equal(await page.getAttribute('#ciLight', 'href'), `${GH}/actions/runs/9001`);

    // 2. Zeitleiste
    const tl = await page.$$eval('#timeline a', (as) => as.map((a) => ({ kind: a.dataset.kind, href: a.href, target: a.target, rel: a.rel, text: a.textContent.replace(/\s+/g, ' ').trim() })));
    assert.deepEqual(tl.map((e) => e.kind), ['commit', 'pr', 'pr', 'commit', 'pr']);
    assert.match(tl[0].text, /README: Tippfehler korrigiert.*05\.11\.2026, 11:00 Uhr.*aaaaaaa/);
    assert.match(tl[1].text, /Neue Kamera.*PR #3.*04\.11\.2026, 21:00 Uhr.*bbbbbbb/);
    assert.match(tl[2].text, /Web-Build über GitHub Pages.*PR #2.*03\.11\.2026, 13:00 Uhr.*eeeeeee/);
    assert.match(tl[3].text, /Initial commit/);
    assert.match(tl[4].text, /Grundgerüst der Engine.*PR #1.*30\.10\.2026, 16:30 Uhr.*1111111/);
    assert.equal(tl[1].href, `${GH}/pull/3`);
    assert.equal(tl[0].href, `${GH}/commit/${S.direct}`);
    for (const e of tl) { assert.equal(e.target, '_blank'); assert.match(e.rel, /noopener/); }
    const tlText = await text(page, '#timelineBody');
    assert.doesNotMatch(tlText, /Kamera: (Feinschliff|erster Wurf)/, 'Commits aus PR-Branches ausgeblendet');
    assert.doesNotMatch(tlText, /Abgelehnter Versuch/, 'nicht gemergte PRs ausgeblendet');
    assert.doesNotMatch(tlText, /Merge pull request/, 'Merge-Commit erscheint als PR');

    // 3. Roadmap
    const secs = await page.$$eval('#roadmapBody .rm-sec', (ds) => ds.map((d) => ({
      name: d.querySelector('summary .name').textContent, num: d.querySelector('summary .num').textContent,
      now: d.querySelector('.bar').getAttribute('aria-valuenow'), max: d.querySelector('.bar').getAttribute('aria-valuemax'),
      width: d.querySelector('.bar > div').style.width
    })));
    assert.deepEqual(secs, [
      { name: 'Erledigt', num: '3/3', now: '3', max: '3', width: '100%' },
      { name: 'Als Nächstes (Etappe 4)', num: '1/3', now: '1', max: '3', width: '33%' },
      { name: 'Danach (laut Engine-Plan)', num: '0/3', now: '0', max: '3', width: '0%' },
      { name: 'Für später', num: '0/2', now: '0', max: '2', width: '0%' }
    ]);
    assert.match(await text(page, '#roadmapBody .rm-total'), /4 \/ 11 erledigt/);
    const rmText = await text(page, '#roadmapBody');
    assert.doesNotMatch(rmText, /Format dieser Datei|PR #99/, 'HTML-Kommentar ignoriert');
    assert.doesNotMatch(rmText, /übersprungen/, 'keine unbekannten Zeilen');
    assert.equal(await page.getAttribute('#roadmapBody a.pr-link:has-text("PR #5")', 'href'), `${GH}/pull/5`);
    assert.equal(await text(page, '#roadmapBody .rm-items li:has(a.pr-link:has-text("PR #2")) .txt'), 'SDL3- und NULL-Backend', 'PR-Verweis aus dem Text gelöst');

    // 4. Engine-Karte (aus engine-map.json im Repo)
    const layers = await page.$$eval('#engineBody .em-layer', (ls) => ls.map((l) => ({
      name: l.querySelector('h3').textContent,
      chips: [...l.querySelectorAll('.chip')].map((c) => `${c.querySelector('.cn').textContent}=${c.dataset.status}`)
    })));
    assert.deepEqual(layers.map((l) => l.name), ['Spiel/Lua', 'Engine-Systeme', 'Kern', 'Plattform-Layer/RHI']);
    assert.deepEqual(layers[0].chips, ['Lua-Skripting=geplant']);
    assert.deepEqual(layers[1].chips, ['Flugmodell=vorschau', 'Physik=geplant', 'ECS=geplant', 'Audio=geplant', 'UI=geplant', 'Debug-UI=geplant', 'Profiler=geplant']);
    assert.deepEqual(layers[2].chips, ['Log=fertig', 'Mathe=fertig', 'Spielschleife=fertig']);
    assert.deepEqual(layers[3].chips, ['SDL3-Backend=fertig', 'NULL-Backend=fertig', 'Web/Emscripten=fertig', 'OpenGL ES 3.0 / WebGL 2=vorschau', 'Vulkan-RHI=geplant']);
    assert.match(await text(page, '#engineBody'), /Jolt · geplant.*EnTT.*miniaudio.*RmlUi.*Dear ImGui.*Tracy.*double-Positionen · fertig.*60 Hz/);
    assert.match(await text(page, '#engineLegend'), /fertig: 6.*Vorschau: 2.*geplant: 8/);
    assert.deepEqual(await page.$$eval('#engineBody .em-layer:last-child .glabel', (g) => g.map((x) => x.textContent)), ['Plattform', 'Renderer']);

    await assertTouchFriendly(page, label);
    await page.screenshot({ path: path.join(OUT, `projekt-${label.replace(/\W+/g, '_')}.png`), fullPage: true });

    // Antippen öffnet den PR auf GitHub (neuer Tab).
    const [req] = await Promise.all([
      context.waitForEvent('request', (r) => r.url() === `${GH}/pull/3`),
      page.click('#timeline a[href$="/pull/3"]')
    ]);
    assert.ok(req);

    // Für jeden Teil höchstens ein Aufruf, Token nur im Header.
    for (const r of mock.requests) assert.equal(r.auth, `Bearer ${TOKEN}`);
    await assertNoLeak(log, page);
    await context.close();
  });
}

test('iPad Hoch- und Querformat: Spalten passen sich an', async () => {
  mock.reset();
  const { context, page } = await newPage('iPad Pro 11');
  await openProject(page);
  const cols = () => page.evaluate(() => getComputedStyle(document.querySelector('.proj-grid')).gridTemplateColumns.split(' ').length);
  assert.equal(await cols(), 1, 'Hochformat: eine Spalte');
  await page.setViewportSize({ width: 1194, height: 834 });
  assert.equal(await cols(), 2, 'Querformat: zwei Spalten');
  await assertTouchFriendly(page, 'iPad gedreht');
  await context.close();
});

test('Zeit wird auch auf Geräten in anderer Zeitzone in deutscher Ortszeit angezeigt', async () => {
  mock.reset();
  const { context, page } = await newPage(null, { timezoneId: 'America/New_York' });
  await openProject(page);
  assert.match(await text(page, '#ciLight'), /05\.11\.2026, 11:07 Uhr/);
  assert.match(await text(page, '#timeline li:first-child'), /05\.11\.2026, 11:00 Uhr/);
  await context.close();
});

test('Build-Ampel: läuft (gelb), fehlgeschlagen (rot), noch kein Lauf', async () => {
  mock.reset();
  mock.run = 'in_progress';
  const { context, page, log } = await newPage(null);
  await openProject(page);
  assert.equal(await page.getAttribute('#ciLight', 'data-state'), 'warn');
  assert.match(await text(page, '#ciLight'), /Läuft.*gestartet 05\.11\.2026, 11:01 Uhr.*0abc123/);

  mock.run = 'failure';
  await page.click('#projReload');
  await page.waitForSelector('#ciLight[data-state="err"]');
  assert.match(await text(page, '#ciLight'), /Fehlgeschlagen.*11:07 Uhr/);

  mock.run = 'none';
  await page.click('#projReload');
  await page.waitForSelector('#ciBody >> text=noch keinen Lauf');
  await assertNoLeak(log, page);
  await context.close();
});

test('Kurzer Cache: erneutes Öffnen ohne neue Anfragen, Aktualisieren lädt neu', async () => {
  mock.reset();
  const { context, page } = await newPage(null);
  await openProject(page);
  const first = mock.requests.length;
  // index.json + Dateiliste des neuesten Builds (Spielansicht, beim Start) + die vier Teile der Projektansicht
  assert.ok(first >= 6 && first <= 7, `Anfragen beim ersten Laden: ${first}`);
  await page.click('#tabPlay');
  await page.waitForSelector('#buildsView:not([hidden])');
  const afterPlay = mock.requests.length;
  await page.click('#tabProject');
  await waitProjectLoaded(page);
  assert.equal(mock.requests.length, afterPlay, 'innerhalb der Cache-Zeit keine neuen Anfragen');
  await page.click('#projReload');
  await page.waitForFunction(() => !document.getElementById('projReload').disabled);
  const reload = mock.requests.slice(afterPlay).map((r) => r.path);
  assert.ok(reload.includes(`${BASE}/commits`) && reload.includes(`${BASE}/contents/ROADMAP.md`) && reload.some((p) => p.endsWith('/runs')), 'Aktualisieren lädt neu');
  assert.ok(!reload.includes(`${BASE}/actions/workflows`), 'Workflow-ID bleibt länger im Cache');
  await context.close();
});

test('Spielansicht bleibt unverändert erreichbar', async () => {
  mock.reset();
  const { context, page } = await newPage(null);
  await page.goto(baseUrl + '#projekt');
  await page.waitForSelector('#projectView:not([hidden])');
  await waitProjectLoaded(page);
  await page.click('#tabPlay');
  await page.waitForSelector('#buildsView:not([hidden])');
  assert.equal(await page.getAttribute('#tabPlay', 'aria-selected'), 'true');
  assert.match(await text(page, '#buildList'), /Ein Build/);
  assert.ok(await page.isEnabled('#playBtn'));
  assert.ok(await page.isHidden('#projectView'));
  assert.equal(await page.evaluate(() => location.hash), '');
  await context.close();
});

test('ROADMAP.md mit unerwarteten Zeilen wird tolerant gelesen', async () => {
  mock.reset();
  mock.roadmap = 'weird';
  const { context, page, log } = await newPage('iPad Pro 11');
  await openProject(page);
  const secs = await page.$$eval('#roadmapBody .rm-sec', (ds) => ds.map((d) => ({
    name: d.querySelector('summary .name').textContent,
    num: d.querySelector('summary .num').textContent,
    items: [...d.querySelectorAll('.rm-items li:not(.empty) .txt')].map((t) => t.textContent)
  })));
  assert.deepEqual(secs, [
    { name: 'Ohne Abschnitt', num: '1/1', items: ['Punkt vor dem ersten Abschnitt'] },
    { name: 'Erledigt', num: '3/5', items: ['Großes X', 'eingerückt', 'ohne Leerzeichen', 'Stern statt Strich', '(ohne Text)'] },
    { name: 'Als Nächstes (Etappe 4)', num: '1/2', items: ['<img src=x onerror="window.__xss=1"> nicht als HTML (PR #abc)', 'nach Kommentar'] },
    { name: 'Ganz neuer Abschnitt', num: '0/0', items: [] },
    { name: '(ohne Namen)', num: '0/1', items: ['Punkt im namenlosen Abschnitt'] }
  ]);
  assert.deepEqual(await page.$$eval('#roadmapBody a.pr-link', (as) => as.map((a) => a.getAttribute('href'))), [7, 8, 9].map((n) => `${GH}/pull/${n}`));
  // Freitext, Liste ohne Kästchen, [~], Tabelle, ###-Überschrift
  assert.match(await text(page, '#roadmapBody .note'), /5 Zeilen hatten kein bekanntes Format/);
  assert.match(await text(page, '#roadmapBody .rm-sec:nth-of-type(4)'), /Keine Punkte/);
  assert.equal(await page.evaluate(() => window.__xss), undefined, 'kein HTML aus der Datei ausgeführt');
  assert.equal(await page.$('#roadmapBody img'), null);
  const rmText = await text(page, '#roadmapBody');
  assert.doesNotMatch(rmText, /Das ist kein Abschnitt|und kein Punkt|Formatbeschreibung/);
  // Die anderen Teile laufen normal weiter.
  assert.equal(await page.getAttribute('#ciLight', 'data-state'), 'ok');
  await assertTouchFriendly(page, 'ROADMAP unerwartet');
  await page.screenshot({ path: path.join(OUT, 'projekt-roadmap-unerwartet.png'), fullPage: true });
  await assertNoLeak(log, page);
  await context.close();
});

test('Fehlerfälle: Token fehlt, keine Rechte, Rate-Limit, offline, Token abgelehnt, ROADMAP.md fehlt', async () => {
  // Token fehlt
  mock.reset();
  let { context, page, log } = await newPage('iPad Pro 11 landscape', { withToken: false });
  await page.goto(baseUrl);
  await page.waitForSelector('#tokenView:not([hidden])');
  assert.ok(await page.isVisible('#tabProject'), 'Umschalter auch ohne Token sichtbar');
  await page.click('#tabProject');
  await waitProjectLoaded(page);
  for (const id of ['ciBody', 'timelineBody', 'roadmapBody']) {
    assert.match(await text(page, `#${id} .msg`), /Kein Token gespeichert/);
    assert.equal(await page.getAttribute(`#${id} .msg`, 'data-kind'), 'notoken');
  }
  assert.equal(mock.requests.length, 0, 'ohne Token keine API-Aufrufe');
  assert.equal((await page.$$('#engineBody .chip')).length, 16, 'Engine-Karte kommt ohne Token aus');
  await page.click('#ciBody button:has-text("Token eingeben")');
  await page.waitForSelector('#tokenView:not([hidden])');
  await page.fill('#tokenInput', TOKEN);
  await page.click('#tokenSave');
  await page.waitForSelector('#projectView:not([hidden])');
  await waitProjectLoaded(page);
  assert.equal(await page.getAttribute('#ciLight', 'data-state'), 'ok', 'nach Token-Eingabe zurück in der Projektansicht');
  await assertNoLeak(log, page);
  await context.close();

  // Keine Rechte für Actions: nur die Ampel zeigt den Fehler.
  mock.reset();
  mock.actions = 'forbidden';
  ({ context, page, log } = await newPage(null));
  await openProject(page);
  const ciMsg = await text(page, '#ciBody .msg');
  assert.match(ciMsg, /keinen Zugriff.*Actions: Read-only/);
  assert.ok(await page.isVisible('#ciBody button:has-text("Neues Token eingeben")'));
  assert.equal((await page.$$('#timeline a')).length, 5, 'Zeitleiste trotzdem da');
  assert.equal((await page.$$('#roadmapBody .rm-sec')).length, 4, 'Roadmap trotzdem da');
  mock.actions = 'ok';
  await page.click('#ciBody button:has-text("Erneut versuchen")');
  await page.waitForSelector('#ciLight[data-state="ok"]');

  // ROADMAP.md fehlt
  mock.roadmap = 'missing';
  await page.click('#projReload');
  await page.waitForSelector('#roadmapBody .msg >> text=ROADMAP.md fehlt');

  // Rate-Limit
  mock.mode = 'ratelimit';
  await page.click('#projReload');
  await page.waitForSelector('#ciBody .msg[data-kind="ratelimit"]');
  await waitProjectLoaded(page); // auch die Engine-Karte ist nach dem Neuladen fertig
  for (const id of ['ciBody', 'timelineBody', 'roadmapBody']) {
    assert.match(await text(page, `#${id} .msg`), /Rate-Limit erreicht.*Wieder möglich ab \d\d:\d\d Uhr/);
  }
  assert.equal((await page.$$('#engineBody .chip')).length, 16);

  // Offline
  mock.mode = 'offline';
  await page.click('#projReload');
  await page.waitForSelector('#ciBody .msg[data-kind="network"]');
  assert.match(await text(page, '#timelineBody .msg'), /Keine Verbindung zu GitHub/);
  assert.match(await text(page, '#roadmapBody .msg'), /Keine Verbindung zu GitHub/);

  // Wieder online: "Erneut versuchen" im Teil lädt nur diesen neu.
  mock.mode = 'ok';
  mock.roadmap = 'normal';
  await page.click('#timelineBody button:has-text("Erneut versuchen")');
  await page.waitForSelector('#timeline');
  assert.ok(await page.isVisible('#roadmapBody .msg'));

  // Token abgelehnt
  mock.mode = 'revoked';
  await page.click('#projReload');
  await page.waitForSelector('#ciBody .msg[data-kind="auth"]');
  assert.match(await text(page, '#roadmapBody .msg'), /lehnt das Token ab/);
  assert.ok(await page.isVisible('#roadmapBody button:has-text("Neues Token eingeben")'));
  await assertNoLeak(log, page);
  await context.close();
});

test('engine-map.json: kaputt, fehlend und mit unbekannten Werten', async () => {
  mock.reset();
  let mapBody = null, mapStatus = 200;
  const { context, page, log } = await newPage(null);
  await context.route(/\/engine-map\.json(\?|$)/, (r) => r.fulfill({ status: mapStatus, contentType: 'application/json', body: mapBody }));

  mapBody = '{ "schichten": [ kaputt';
  await openProject(page);
  assert.match(await text(page, '#engineBody .msg'), /engine-map.json ist kaputt.*kein gültiges JSON/);
  assert.equal(await page.getAttribute('#ciLight', 'data-state'), 'ok');

  mapStatus = 404; mapBody = 'nope';
  await page.click('#projReload');
  await page.waitForSelector('#engineBody .msg >> text=engine-map.json fehlt');

  mapStatus = 200;
  mapBody = JSON.stringify({ schichten: [
    { name: 'Neu', bausteine: [{ name: 'X', status: 'FERTIG' }, { name: 'Y', status: 'irgendwas' }, { status: 'geplant' }, 'quatsch'] },
    null,
    { bausteine: 'keine Liste' }
  ], unbekannt: true });
  await page.click('#projReload');
  await page.waitForSelector('#engineBody .chip');
  const chips = await page.$$eval('#engineBody .chip', (cs) => cs.map((c) => `${c.querySelector('.cn').textContent}=${c.dataset.status}`));
  assert.deepEqual(chips, ['X=fertig', 'Y=unbekannt']);
  assert.deepEqual(await page.$$eval('#engineBody h3', (h) => h.map((x) => x.textContent)), ['Neu', '(ohne Namen)']);
  assert.match(await text(page, '#engineLegend'), /unbekannt: 1/);
  await assertNoLeak(log, page);
  await context.close();
});

test('engine-map.json ist gültig und wird mit veröffentlicht', () => {
  const map = JSON.parse(fs.readFileSync(path.join(ROOT, 'engine-map.json'), 'utf8'));
  assert.ok(Array.isArray(map.schichten));
  for (const l of map.schichten) for (const b of l.bausteine) assert.ok(['fertig', 'vorschau', 'geplant'].includes(b.status), `${b.name}: ${b.status}`);
  const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8');
  assert.match(wf, /cp [^\n]*engine-map\.json/, 'engine-map.json wird nach _site kopiert');
});
