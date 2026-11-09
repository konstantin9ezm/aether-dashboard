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

// Verweise auf zwei Repos: aether (ohne Angabe) und aether-dashboard (mit „Repo aether-dashboard, “),
// Leerzeichen-Varianten, Repo ohne Nummer (bleibt Text), fremdes Repo (wird nicht erkannt).
const ROADMAP_REPOS = [
  '## Verweise',
  '- [x] Engine-PR (PR #31)',
  '- [x] Dashboard-PR (Repo aether-dashboard, PR #8)',
  '- [ ] Nur Repo (Repo aether-dashboard)',
  '- [x] Leerzeichen (PR # 13)',
  '- [ ] Dashboard mit Leerzeichen (Repo aether-dashboard, PR # 9)',
  '- [x] Beide Repos, gleiche Nummer (PR #8) (Repo aether-dashboard, PR #8)',
  '## Fremd',
  '- [ ] Anderes Repo (Repo aether-tools, PR #5)',
  ''
].join('\n');


// ---------------------------------------------------------------------------
// CI-Laufzeit: abgeschlossene Läufe, Jobs und build.yml (Limits aus timeout-minutes)
// ---------------------------------------------------------------------------
const CI_SHA = '0abc1234def5678900000000000000000000beef';
const at = (min, sec = 0) => new Date(Date.UTC(2026, 10, 5, 9, 40, 30) + (min * 60 + sec) * 1000).toISOString().replace('.000', '');
// Neuester zuerst (wie die API). #57 ist derselbe Lauf wie in der Ampel (27,0 min).
function CI_RUNS() {
  const r = (id, n, conclusion, minutes, sha) => ({
    id, run_number: n, name: 'Build', head_branch: 'main', head_sha: sha, status: 'completed', conclusion,
    run_started_at: '2026-11-0' + (n - 52) + 'T08:00:00Z',
    updated_at: new Date(Date.parse('2026-11-0' + (n - 52) + 'T08:00:00Z') + minutes * 60000).toISOString()
  });
  return [
    { ...r(9001, 57, 'success', 0, CI_SHA), run_started_at: '2026-11-05T09:40:30Z', updated_at: '2026-11-05T10:07:30Z',
      created_at: '2026-11-05T09:40:00Z', head_commit: { message: 'README: Tippfehler korrigiert' } },
    r(9000, 56, 'failure', 25, sha('6')),
    r(8999, 55, 'success', 24, sha('5')),
    r(8998, 54, 'cancelled', 22.5, sha('4')),
    r(8997, 53, 'success', 21, sha('3'))
  ];
}
const step = (name, from, to, extra = {}) => ({ name, status: 'completed', conclusion: 'success', number: 1, started_at: from, completed_at: to, ...extra });
const job = (name, from, to, steps = [], extra = {}) => ({ id: Math.floor(Math.random() * 1e6), name, status: 'completed', conclusion: 'success', started_at: from, completed_at: to, steps, ...extra });
// build 4:00 / 15 (27 %), web/emscripten 26:00 / 45 (58 %), Browser-Test 24:30 / 40 (61 %), veröffentlichen 1:00 / 10 (10 %)
const CI_JOBS_DEFAULT = () => [
  job('build', at(0), at(4), [step('Set up job', at(0), at(0, 5)), step('Bauen', at(0, 5), at(3, 50))]),
  job('web/emscripten', at(0), at(26), [
    step('Checkout', at(0), at(0, 20)),
    step('Browser-Test', at(1), at(25, 30)),
    step('Post Checkout', at(25, 30), at(25, 40))
  ]),
  job('web/veröffentlichen', at(26), at(27), [step('Veröffentlichen', at(26), at(26, 50))])
];
const CI_YAML_DEFAULT = `# Build-Workflow (Kommentare, Leerzeilen und verschachtelte Schlüssel sind Absicht)
name: Build

on:
  push:
    branches: [main]

jobs:
  build:   # nativer Build
    name: build
    runs-on: ubuntu-latest
    timeout-minutes: 15
    steps:
      - uses: actions/checkout@v4

      - name: Bauen
        run: |
          cmake -B out
          # timeout-minutes: 1   (Text im Skript, kein Limit)
          cmake --build out

  web:
    name: web/emscripten
    needs: build
    # timeout-minutes: 5   (auskommentiert)
    timeout-minutes: 45 # ganzer Job
    steps:
      - name: Checkout
        uses: actions/checkout@v4
        with:
          name: kein-schritt
          timeout-minutes: 2
      - name: "Browser-Test"   # wächst
        # Limit aus build.yml
        timeout-minutes: 40
        run: npm test

  publish:
    name: 'web/veröffentlichen'
    timeout-minutes: 10
    steps:
      - name: Veröffentlichen
        run: echo ok
`;

// ---------------------------------------------------------------------------
// Mock der GitHub-REST-API
// ---------------------------------------------------------------------------
const mock = {
  reset() {
    Object.assign(this, { mode: 'ok', run: 'success', actions: 'ok', roadmap: 'normal', requests: [],
      ciRuns: CI_RUNS(), ciJobs: CI_JOBS_DEFAULT(), ciYaml: CI_YAML_DEFAULT, ci: 'ok' });
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
  // neuerer Lauf #58 läuft noch, der letzte abgeschlossene ist #57 (id 9001)
  if (kind === 'newer_running') return { ...base, id: 9002, run_number: 58, head_sha: sha('8'), status: 'in_progress', conclusion: null };
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
  if (p === `${BASE}/actions/workflows/42/runs` && q.get('status') === 'completed') {
    assert.equal(q.get('branch'), 'main', 'Läufe nur von main');
    if (mock.ci === 'runs500') return json(route, 500, { message: 'Server Error' });
    const n = Number(q.get('per_page')) || 30;
    return json(route, 200, { total_count: mock.ciRuns.length, workflow_runs: mock.ciRuns.slice(0, n) });
  }
  const jobsM = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs$/.exec(p);
  if (jobsM) {
    if (mock.ci === 'jobs500') return json(route, 500, { message: 'Server Error' });
    if (mock.ci === 'jobsRate') return route.fulfill({ status: 403, headers: { ...CORS, ...rate(0), 'content-type': 'application/json' }, body: JSON.stringify({ message: 'API rate limit exceeded for user.' }) });
    return json(route, 200, { total_count: mock.ciJobs.length, jobs: mock.ciJobs });
  }
  if (p === `${BASE}/contents/.github/workflows/build.yml`) {
    assert.ok(headers.accept.includes('application/vnd.github.raw'), 'build.yml roh laden');
    if (mock.ci === 'yaml404') return json(route, 404, { message: 'Not Found' });
    return route.fulfill({ status: 200, headers: { ...CORS, ...rate(4990), 'content-type': 'application/vnd.github.raw+json; charset=utf-8' }, body: mock.ciYaml });
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
    const body = mock.roadmap === 'weird' ? ROADMAP_WEIRD : mock.roadmap === 'repos' ? ROADMAP_REPOS : ROADMAP_NORMAL;
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
  // Nur im Dashboard selbst: Das Spiel-iframe (Start-Rahmen) hat keinen Speicherzugriff.
  if (withToken) await context.addInitScript((t) => { if (window === window.top) localStorage.setItem('aether.githubToken', t); }, TOKEN);
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
async function waitCiTime(page) {
  await page.waitForSelector('#ciTime[data-state]');
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
    assert.deepEqual(layers[1].chips, ['Flugmodell=vorschau', 'Physik=geplant', 'ECS=geplant', 'Audio=geplant', 'UI=geplant', 'Debug-UI=fertig', 'Profiler=geplant', 'Asset-System=geplant']);
    assert.deepEqual(layers[2].chips, ['Log=fertig', 'Mathe=fertig', 'Spielschleife=fertig', 'Frame-Zeiten=fertig']);
    assert.deepEqual(layers[3].chips, ['SDL3-Backend=fertig', 'NULL-Backend=fertig', 'Web/Emscripten=fertig', 'Einstellungen/Speicher=fertig', 'OpenGL ES 3.0 / WebGL 2=vorschau', 'WebGPU=geplant', 'Vulkan-RHI=geplant']);
    assert.match(await text(page, '#engineBody'), /Regler, Basiswerte v1 · Vorschau.*Jolt · geplant.*EnTT.*miniaudio.*RmlUi.*Dear ImGui · fertig.*Tracy.*Katalog, Streaming · geplant.*double-Positionen · fertig.*60 Hz.*Messung, 1-s-Fenster · fertig/);
    assert.match(await text(page, '#engineLegend'), /fertig: 9.*Vorschau: 2.*geplant: 9/);
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
  // index.json + Dateiliste des neuesten Builds (Spielansicht, beim Start) + die vier Teile der Projektansicht
  // + 3 für die CI-Laufzeit (abgeschlossene Läufe, Jobs des letzten Laufs, build.yml an dessen Commit)
  await waitCiTime(page);
  const first = mock.requests.length;
  assert.ok(first >= 9 && first <= 10, `Anfragen beim ersten Laden: ${first}`);
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
  assert.ok(await page.isVisible('#game.slot iframe'), 'Start-Rahmen mit „Spielen“ bereit');
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

test('ROADMAP.md: PR-Verweise auf aether und aether-dashboard', async () => {
  mock.reset();
  mock.roadmap = 'repos';
  const { context, page, log } = await newPage(null);
  await openProject(page);
  const DASH = `https://github.com/${OWNER}/aether-dashboard`;
  const items = await page.$$eval('#roadmapBody .rm-items li:not(.empty)', (lis) => lis.map((li) => ({
    text: li.querySelector('.txt').textContent,
    links: [...li.querySelectorAll('a.pr-link')].map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('target'), a.getAttribute('rel')])
  })));
  const ext = (n, href) => [`PR #${n}`, href, '_blank', 'noopener noreferrer'];
  assert.deepEqual(items, [
    { text: 'Engine-PR', links: [ext(31, `${GH}/pull/31`)] },
    { text: 'Dashboard-PR', links: [ext(8, `${DASH}/pull/8`)] },
    { text: 'Nur Repo (Repo aether-dashboard)', links: [] },
    { text: 'Leerzeichen', links: [ext(13, `${GH}/pull/13`)] },
    { text: 'Dashboard mit Leerzeichen', links: [ext(9, `${DASH}/pull/9`)] },
    { text: 'Beide Repos, gleiche Nummer', links: [ext(8, `${GH}/pull/8`), ext(8, `${DASH}/pull/8`)] },
    { text: 'Anderes Repo (Repo aether-tools, PR #5)', links: [] }
  ]);
  // Gleiche Darstellung wie die bisherigen Links (Klasse, Stil).
  const styles = await page.$$eval('#roadmapBody a.pr-link', (as) => [...new Set(as.map((a) => {
    const c = getComputedStyle(a);
    return [a.className, c.color, c.fontSize, c.textDecorationLine, c.backgroundColor].join('|');
  }))]);
  assert.equal(styles.length, 1, `einheitlicher Link-Stil: ${styles.join(' / ')}`);
  // Zählung unverändert: Abschnitte, Balken, erledigt/gesamt.
  const secs = await page.$$eval('#roadmapBody .rm-sec', (ds) => ds.map((d) => [
    d.querySelector('summary .name').textContent, d.querySelector('summary .num').textContent,
    d.querySelector('summary .bar').getAttribute('aria-valuenow'), d.querySelector('summary .bar').getAttribute('aria-valuemax')]));
  assert.deepEqual(secs, [['Verweise', '4/6', '4', '6'], ['Fremd', '0/1', '0', '1']]);
  assert.match(await text(page, '#roadmapBody .rm-total'), /4 \/ 7 erledigt/);
  await assertTouchFriendly(page, 'ROADMAP Repos');
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
  assert.equal((await page.$$('#engineBody .chip')).length, 20, 'Engine-Karte kommt ohne Token aus');
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
  assert.equal((await page.$$('#engineBody .chip')).length, 20);

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

// ---------------------------------------------------------------------------
// CI-Laufzeit in der Build-Ampel
// ---------------------------------------------------------------------------
const ciLine = (page) => text(page, '#ciTimeLine');
const itext = (page, sel) => page.innerText(sel).then((t) => t.replace(/\s+/g, ' ').trim());
const cssVar = (page, name) => page.evaluate((n) => {
  const d = document.createElement('div');
  d.style.color = `var(${n})`;
  document.body.appendChild(d);
  const c = getComputedStyle(d).color;
  d.remove();
  return c;
}, name);
async function ciReload(page) {
  await page.click('#projReload');
  await page.waitForFunction(() => !document.getElementById('projReload').disabled);
  await waitCiTime(page);
}

describe('CI-Laufzeit', () => {
  test('Zeile mit korrekten Werten, Balken, Details auf/zu, sparsame Anfragen', async () => {
    mock.reset();
    const { context, page, log } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await page.getAttribute('#ciTime', 'data-state'), 'ok');
    assert.equal(await ciLine(page), 'CI: 27,0 min · web/emscripten › Browser-Test 24,5 / 40 min (61 %)');
    assert.equal(await page.getAttribute('#ciTime', 'data-level'), 'ok');
    assert.equal(await page.getAttribute('#ciTime > .ci-bar', 'aria-valuenow'), '61');
    assert.equal(await page.$eval('#ciTime > .ci-bar > div', (d) => d.style.width), '61%');
    // Grün wie die Ampel
    const ok = await cssVar(page, '--ok');
    assert.equal(await page.$eval('#ciTime > .ci-bar > div', (d) => getComputedStyle(d).backgroundColor), ok);
    assert.equal(await page.$eval('#ciLight .l-g', (d) => getComputedStyle(d).backgroundColor), ok);
    // Die bisherige Ampel bleibt unverändert.
    assert.match(await text(page, '#ciLight'), /Erfolgreich.*05\.11\.2026, 11:07 Uhr.*0abc123.*Lauf #57/);

    // Details: standardmäßig zu, Knopf ≥ 44 px
    assert.equal(await page.getAttribute('#ciMore', 'aria-expanded'), 'false');
    assert.ok(await page.isHidden('#ciDetails'));
    const bb = await page.$eval('#ciMore', (b) => { const r = b.getBoundingClientRect(); return [r.width, r.height]; });
    assert.ok(bb[0] >= 44 && bb[1] >= 44, `Tippfläche ${bb}`);
    assert.equal(await text(page, '#ciMore'), '▸ Details');
    await page.click('#ciMore');
    assert.ok(await page.isVisible('#ciDetails'));
    assert.equal(await page.getAttribute('#ciMore', 'aria-expanded'), 'true');
    assert.equal(await text(page, '#ciMore'), '▾ Details');
    const cols = await page.$$eval('#ciChart .ci-col', (cs) => cs.map((c) => [c.dataset.run, c.dataset.result, c.querySelector('.ci-val').textContent]));
    assert.deepEqual(cols, [['53', 'ok', '21,0'], ['54', 'err', '22,5'], ['55', 'ok', '24,0'], ['56', 'err', '25,0'], ['57', 'ok', '27,0']]);
    assert.deepEqual(await page.$$eval('#ciChart .ci-axis span', (s) => s.map((x) => x.textContent)), ['#53', '#54', '#55', '#56', '#57']);
    assert.equal(await text(page, '#ciLimitLine'), 'Limit 45 min', 'Linie beim höchsten Job-Limit');
    // Linie liegt auf Höhe 45 min, der höchste Balken (27 min) darunter
    const geo = await page.evaluate(() => {
      const plot = document.querySelector('#ciChart .ci-plot').getBoundingClientRect();
      const line = document.getElementById('ciLimitLine').getBoundingClientRect();
      const bars = [...document.querySelectorAll('#ciChart .ci-runbar')].map((b) => b.getBoundingClientRect().height);
      return { lineFromBottom: plot.bottom - line.top, plotH: plot.height, bars };
    });
    assert.ok(Math.abs(geo.lineFromBottom / geo.bars[4] - 45 / 27) < 0.05, `Linie/Balken ${JSON.stringify(geo)}`);
    assert.equal(await page.$eval('#ciChart .ci-col[data-result="err"] .ci-runbar', (b) => getComputedStyle(b).backgroundColor), await cssVar(page, '--err'));
    const blk = await itext(page, '#ciTightBlock');
    assert.match(blk, /^Knappster Schritt \(letzter Lauf\) web\/emscripten › Browser-Test 24,5 von 40 min 61 %/);
    assert.match(blk, /Limits aus build\.yml gelesen/);
    assert.doesNotMatch(blk, /Trend/, 'ohne frühere Daten kein Trend');
    await page.click('#ciMore');
    assert.ok(await page.isHidden('#ciDetails'));
    assert.equal(await page.getAttribute('#ciMore', 'aria-expanded'), 'false');

    // API-Sparsamkeit: Jobs und build.yml nur für den letzten abgeschlossenen Lauf, am Commit des Laufs.
    const ciReq = mock.requests.filter((r) => /\/jobs$|build\.yml$/.test(r.path) || /status=completed/.test(r.query));
    assert.deepEqual(ciReq.map((r) => r.path + r.query).sort(), [
      `${BASE}/actions/runs/9001/jobs?filter=latest&per_page=100`,
      `${BASE}/actions/workflows/42/runs?branch=main&status=completed&per_page=5&exclude_pull_requests=true`,
      `${BASE}/contents/.github/workflows/build.yml?ref=${CI_SHA}`
    ].sort());
    // Zustand „aufgeklappt“ wird nicht gespeichert: nach Neuladen wieder zu.
    await page.click('#ciMore');
    await page.reload();
    await page.waitForSelector('#projectView:not([hidden])');
    await waitProjectLoaded(page);
    await waitCiTime(page);
    assert.ok(await page.isHidden('#ciDetails'));
    // Kein Token in gespeicherten Daten (auch nicht im Trend-Verlauf)
    const stored = await page.evaluate(async (t) => {
      const hits = [];
      for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k !== 'aether.githubToken' && localStorage.getItem(k).includes(t)) hits.push(k); }
      for (const n of await caches.keys()) for (const r of await (await caches.open(n)).keys()) if (r.url.includes(t) || r.headers.get('authorization')) hits.push(n);
      return hits;
    }, TOKEN);
    assert.deepEqual(stored, []);
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Trend gegenüber dem ältesten der 5 Läufe (sofern dort vorhanden)', async () => {
    mock.reset();
    const { context, page } = await newPage(null);
    await context.addInitScript(() => {
      if (window !== window.top || localStorage.getItem('aether.ciHistory')) return;
      localStorage.setItem('aether.ciHistory', JSON.stringify([{ id: 8997, entries: { 'web/emscripten › Browser-Test': 1200 } }]));
    });
    await openProject(page);
    await waitCiTime(page);
    await page.click('#ciMore');
    assert.equal(await text(page, '#ciTrend'), 'Trend: +4,5 min seit Lauf #53');
    // Eintrag im ältesten Lauf nicht vorhanden (z. B. umbenannt) → kein Trend
    await page.evaluate(() => localStorage.setItem('aether.ciHistory', JSON.stringify([{ id: 8997, entries: { 'web/alt › Browser-Test': 1200 } }])));
    await ciReload(page);
    await page.click('#ciMore');
    assert.equal(await page.$('#ciTrend'), null);
    await context.close();
  });

  test('Farben genau an den Schwellen 69 / 70 / 89 / 90 %', async () => {
    mock.reset();
    // Limit kommt aus build.yml (10 min) – nicht aus dem Code.
    mock.ciYaml = 'jobs:\n  t:\n    name: Prüfung\n    timeout-minutes: 10\n    steps:\n      - run: true\n';
    const { context, page } = await newPage(null);
    const colors = { ok: null, warn: null, err: null };
    let first = true;
    for (const [pct, level] of [[69, 'ok'], [70, 'warn'], [89, 'warn'], [90, 'err']]) {
      mock.ciJobs = [job('Prüfung', at(0), at(0, pct * 6))]; // pct % von 600 s
      if (first) { await openProject(page); await waitCiTime(page); first = false; } else await ciReload(page);
      if (!colors.warn) for (const k of ['ok', 'warn', 'err']) colors[k] = await cssVar(page, '--' + k);
      assert.equal(await ciLine(page), `CI: 27,0 min · Prüfung ${(pct / 10).toFixed(1).replace('.', ',')} / 10 min (${pct} %)`);
      assert.equal(await page.getAttribute('#ciTime', 'data-level'), level, `${pct} %`);
      assert.equal(await page.$eval('#ciTime > .ci-bar > div', (d) => getComputedStyle(d).backgroundColor), colors[level], `Balkenfarbe bei ${pct} %`);
      assert.equal(await page.$eval('#ciTimeLine .ci-pct', (d) => getComputedStyle(d).color), colors[level], `Textfarbe bei ${pct} %`);
    }
    await context.close();
  });

  test('Knappster Schritt über mehrere aufgeteilte Jobs (andere Namen, Matrix)', async () => {
    mock.reset();
    mock.ciYaml = [
      'jobs:',
      '  build:',
      '    timeout-minutes: 15',
      '    steps: [ ]',
      '  test-start:',
      '    name: web/test-start',
      '    timeout-minutes: 20',
      '  test-flug:',
      '    name: web/test-flug',
      '    timeout-minutes: 30',
      '    steps:',
      '      - name: Vorbereiten',
      '      - name: Szenen',
      '        timeout-minutes: 15',
      '  test-matrix:',
      '    name: web/test-${{ matrix.browser }}',
      '    strategy:',
      '      matrix:',
      '        browser: [chromium, webkit]',
      '    timeout-minutes: 12',
      ''
    ].join('\n');
    mock.ciJobs = [
      job('build', at(0), at(3)),                                     // 3/15 = 20 %
      job('web/test-start', at(3), at(15)),                           // 12/20 = 60 %
      job('web/test-flug', at(3), at(20), [                           // 17/30 = 57 %
        step('Vorbereiten', at(3), at(6)),
        step('Szenen', at(6), at(19, 30))                             // 13,5/15 = 90 %
      ]),
      job('web/test-chromium', at(3), at(10)),                        // 7/12 = 58 %
      job('web/test-webkit', at(3), at(13, 48))                       // 10,8/12 = 90 % (gleich, aber später)
    ];
    const { context, page } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await ciLine(page), 'CI: 27,0 min · web/test-flug › Szenen 13,5 / 15 min (90 %)');
    assert.equal(await page.getAttribute('#ciTime', 'data-level'), 'err');
    await page.click('#ciMore');
    assert.match(await itext(page, '#ciTightBlock'), /web\/test-flug › Szenen 13,5 von 15 min 90 %/);
    assert.equal(await text(page, '#ciLimitLine'), 'Limit 30 min');
    assert.doesNotMatch(await text(page, '#ciTightBlock'), /Limit unbekannt/, 'Matrix-Varianten erben das Limit');

    // Matrix-Variante ohne eigenen Namen („key (a, b)“) wird dem Matrix-Job zugeordnet.
    mock.ciYaml = 'jobs:\n  e2e:\n    timeout-minutes: 20\n    strategy:\n      matrix:\n        teil: [1, 2, 3]\n';
    mock.ciJobs = [job('e2e (1)', at(0), at(5)), job('e2e (2)', at(0), at(16)), job('e2e (3)', at(0), at(8))];
    await ciReload(page);
    assert.equal(await ciLine(page), 'CI: 27,0 min · e2e (2) 16,0 / 20 min (80 %)');
    assert.equal(await page.getAttribute('#ciTime', 'data-level'), 'warn');
    await context.close();
  });

  test('Limit aus build.yml trotz Kommentaren, CRLF, 4er-Einrückung und Strichen auf Schlüsselhöhe', async () => {
    mock.reset();
    mock.ciYaml = [
      '\uFEFF# Kopf-Kommentar',
      'name: "Build"   # Name',
      '',
      'jobs:   # alle Jobs',
      '    # Kommentar vor dem Job',
      '    web:',
      '        name: "web/emscripten"  # mit # im Kommentar',
      '        timeout-minutes: 45',
      '',
      '        steps:',
      '        - name: Browser-Test # Kommentar',
      '          # timeout-minutes: 99',
      '          timeout-minutes: "40"   # als Text',
      '          run: |',
      '            echo "timeout-minutes: 1"',
      '        -   name:   Nachlauf',
      '            timeout-minutes: 3',
      ''
    ].join('\r\n');
    mock.ciJobs = [job('web/emscripten', at(0), at(26), [step('Browser-Test', at(1), at(25, 30)), step('Nachlauf', at(25, 30), at(25, 50))])];
    const { context, page } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await ciLine(page), 'CI: 27,0 min · web/emscripten › Browser-Test 24,5 / 40 min (61 %)');
    await context.close();
  });

  test('Fehlendes Limit: „Limit unbekannt“, zählt nicht für den knappsten Schritt, kein Abbruch', async () => {
    mock.reset();
    mock.ciYaml = 'jobs:\n  build:\n    name: build\n    timeout-minutes: 15\n  ohne:\n    name: ohne-limit\n    steps:\n      - name: Lang\n';
    mock.ciJobs = [
      job('build', at(0), at(3)),                                  // 20 %
      job('ohne-limit', at(0), at(50), [step('Lang', at(0), at(49))]), // kein Limit
      job('Unbekannter Job', at(0), at(40))                         // nicht zuordenbar
    ];
    const { context, page, log } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await ciLine(page), 'CI: 27,0 min · build 3,0 / 15 min (20 %)');
    await page.click('#ciMore');
    assert.match(await text(page, '#ciTightBlock'), /Limit unbekannt: ohne-limit, Unbekannter Job/);

    // Gar kein Limit bekannt → Zeile ohne knappsten Schritt.
    mock.ciYaml = '# leer\nname: Build\n';
    await ciReload(page);
    assert.equal(await ciLine(page), 'CI: 27,0 min · Limit unbekannt');
    assert.equal(await page.$('#ciTime > .ci-bar'), null);
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Laufender neuerer Lauf wird übergangen (Zeile nennt den abgeschlossenen Lauf)', async () => {
    mock.reset();
    mock.run = 'newer_running';
    const { context, page } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await page.getAttribute('#ciLight', 'data-state'), 'warn');
    assert.match(await text(page, '#ciLight'), /Läuft.*Lauf #58/);
    assert.equal(await ciLine(page), 'CI (Lauf #57): 27,0 min · web/emscripten › Browser-Test 24,5 / 40 min (61 %)');
    const jobs = mock.requests.filter((r) => r.path.endsWith('/jobs')).map((r) => r.path);
    assert.deepEqual(jobs, [`${BASE}/actions/runs/9001/jobs`], 'Jobs nur vom letzten abgeschlossenen Lauf');
    assert.ok(mock.requests.some((r) => r.path.endsWith('build.yml') && r.query === `?ref=${CI_SHA}`));
    assert.ok(!mock.requests.some((r) => r.query.includes(sha('8'))), 'nichts vom laufenden Lauf');
    await context.close();
  });

  test('API-Fehler zeigen „CI-Laufzeit nicht verfügbar“ ohne Fehlerkarte', async () => {
    mock.reset();
    const { context, page, log } = await newPage(null);
    let first = true;
    for (const mode of ['jobs500', 'jobsRate', 'yaml404', 'runs500']) {
      mock.ci = mode;
      if (first) { await openProject(page); await waitCiTime(page); first = false; } else await ciReload(page);
      assert.equal(await page.getAttribute('#ciTime', 'data-state'), 'unavailable', mode);
      assert.equal(await text(page, '#ciTime'), 'CI-Laufzeit nicht verfügbar', mode);
      assert.equal(await page.$('#ciBody .msg'), null, `keine Fehlerkarte (${mode})`);
      assert.equal(await page.getAttribute('#ciLight', 'data-state'), 'ok', `Ampel bleibt (${mode})`);
      assert.equal((await page.$$('#timeline a')).length, 5, `Zeitleiste bleibt (${mode})`);
      assert.equal((await page.$$('#roadmapBody .rm-sec')).length, 4, `Roadmap bleibt (${mode})`);
    }
    mock.ci = 'ok';
    await ciReload(page);
    assert.equal(await page.getAttribute('#ciTime', 'data-state'), 'ok');
    await assertNoLeak(log, page);
    await context.close();
  });

  for (const [label, w, h] of [['iPhone hoch', 402, 874], ['iPhone quer', 874, 402], ['iPad', 1194, 834], ['Desktop', 1280, 800]]) {
    test(`Layout CI-Laufzeit: ${label} ${w}×${h}`, async () => {
      mock.reset();
      // langer Job-/Schrittname zum Prüfen des Umbruchs
      mock.ciJobs = CI_JOBS_DEFAULT();
      const { context, page } = await newPage(null);
      await page.setViewportSize({ width: w, height: h });
      await openProject(page);
      await waitCiTime(page);
      const lay = async () => page.evaluate(() => {
        const card = document.getElementById('ciCard').getBoundingClientRect();
        const inCard = (sel) => [...document.querySelectorAll(sel)].filter((e) => e.getBoundingClientRect().width > 0)
          .map((e) => { const r = e.getBoundingClientRect(); return { sel, l: r.left, r: r.right, ok: r.left >= card.left - 0.5 && r.right <= card.right + 0.5 }; });
        const line = document.getElementById('ciTimeLine');
        const lh = parseFloat(getComputedStyle(line).lineHeight);
        return {
          overflow: document.documentElement.scrollWidth - window.innerWidth,
          boxes: [...inCard('#ciTime .ci-bar'), ...inCard('#ciTime .ci-row'), ...inCard('#ciMore'), ...inCard('#ciDetails'), ...inCard('#ciChart'), ...inCard('.ci-runbar'), ...inCard('#ciLimitLine')],
          lines: Math.round(line.getBoundingClientRect().height / lh),
          lineScroll: line.scrollWidth - line.clientWidth
        };
      });
      let l = await lay();
      assert.ok(l.overflow <= 0, `waagerechtes Scrollen ${l.overflow}px`);
      assert.deepEqual(l.boxes.filter((b) => !b.ok), [], 'nichts breiter als die Karte');
      assert.ok(l.lineScroll <= 0, 'Zeile läuft nicht über');
      if (w >= 874) assert.equal(l.lines, 1, `einzeilig bei ${w}px`);
      else assert.ok(l.lines <= 3, `sauber umbrochen (${l.lines} Zeilen)`);
      await page.click('#ciMore');
      l = await lay();
      assert.ok(l.overflow <= 0, `waagerechtes Scrollen (offen) ${l.overflow}px`);
      assert.deepEqual(l.boxes.filter((b) => !b.ok), [], 'Details nicht breiter als die Karte');
      await assertTouchFriendly(page, `CI-Laufzeit ${label}`);
      await page.screenshot({ path: path.join(OUT, `ci-laufzeit-${w}x${h}.png`), fullPage: true });
      await (await page.$('#ciCard')).screenshot({ path: path.join(OUT, `ci-laufzeit-karte-${w}x${h}.png`) });
      await context.close();
    });
  }
});
