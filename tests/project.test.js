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
      ciRuns: CI_RUNS(), ciJobs: CI_JOBS_DEFAULT(), ciYaml: CI_YAML_DEFAULT, ci: 'ok',
      wfId: 42, latest: undefined, ciJobsByRun: {}, ciJobsFail: [] });
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
      { id: mock.wfId, name: 'Build', path: '.github/workflows/build.yml', state: 'active' }
    ] });
  }
  if (p === `${BASE}/actions/workflows/${mock.wfId}/runs` && q.get('status') === 'completed') {
    assert.equal(q.get('branch'), 'main', 'Läufe nur von main');
    if (mock.ci === 'runs500') return json(route, 500, { message: 'Server Error' });
    const n = Number(q.get('per_page')) || 30;
    // Wie GitHub: status=completed filtert serverseitig (außer im Modus „ignoreStatus“).
    const list = mock.ci === 'ignoreStatus' ? mock.ciRuns : mock.ciRuns.filter((r) => r.status === 'completed');
    return json(route, 200, { total_count: list.length, workflow_runs: list.slice(0, n) });
  }
  const jobsM = /^\/repos\/[^/]+\/[^/]+\/actions\/runs\/(\d+)\/jobs$/.exec(p);
  if (jobsM) {
    if (mock.ci === 'jobs500') return json(route, 500, { message: 'Server Error' });
    if (mock.ci === 'jobsRate') return route.fulfill({ status: 403, headers: { ...CORS, ...rate(0), 'content-type': 'application/json' }, body: JSON.stringify({ message: 'API rate limit exceeded for user.' }) });
    // Jobs je Lauf-ID (falls hinterlegt), einzelne Läufe können scheitern.
    if (mock.ciJobsFail.includes(Number(jobsM[1]))) return json(route, 502, { message: 'Bad Gateway' });
    // Wie GitHub: filter=latest (Standard) liefert nur die Jobs des letzten Versuchs, filter=all alle Versuche.
    let jobs = mock.ciJobsByRun[jobsM[1]] || mock.ciJobs;
    if (q.get('filter') !== 'all' && jobs.some((j) => j.run_attempt)) {
      const last = Math.max(...jobs.map((j) => j.run_attempt || 1));
      jobs = jobs.filter((j) => (j.run_attempt || 1) === last);
    }
    return json(route, 200, { total_count: jobs.length, jobs });
  }
  if (p === `${BASE}/contents/.github/workflows/build.yml`) {
    assert.ok(headers.accept.includes('application/vnd.github.raw'), 'build.yml roh laden');
    if (mock.ci === 'yaml404') return json(route, 404, { message: 'Not Found' });
    return route.fulfill({ status: 200, headers: { ...CORS, ...rate(4990), 'content-type': 'application/vnd.github.raw+json; charset=utf-8' }, body: mock.ciYaml });
  }
  if (p === `${BASE}/actions/workflows/${mock.wfId}/runs`) {
    assert.equal(q.get('branch'), 'main', 'Läufe nur von main');
    const run = mock.latest !== undefined ? mock.latest : runFor(mock.run);
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
    assert.deepEqual(layers[1].chips, ['Flugmodell=vorschau', 'Physik=geplant', 'ECS=geplant', 'Audio=geplant', 'UI=vorschau', 'Debug-UI=fertig', 'Profiler=fertig', 'Asset-System=geplant']);
    assert.deepEqual(layers[2].chips, ['Log=fertig', 'Mathe=fertig', 'Spielschleife=fertig', 'Frame-Zeiten=fertig']);
    assert.deepEqual(layers[3].chips, ['SDL3-Backend=fertig', 'NULL-Backend=fertig', 'Web/Emscripten=fertig', 'Einstellungen/Speicher=fertig', 'OpenGL ES 3.0 / WebGL 2=vorschau', 'WebGPU=geplant', 'Vulkan-RHI=geplant']);
    assert.match(await text(page, '#engineBody'), /Regler, Basiswerte v1 · Vorschau.*Jolt · geplant.*EnTT.*miniaudio.*RmlUi, bisher HUD-Tempo · Vorschau.*Dear ImGui · fertig.*Tracy.*Katalog, Streaming · geplant.*double-Positionen · fertig.*60 Hz.*Messung, 1-s-Fenster · fertig/);
    assert.match(await text(page, '#engineLegend'), /fertig: 10.*Vorschau: 3.*geplant: 7/);
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

// ---------------------------------------------------------------------------
// CI-Laufzeit mit realistischen API-Daten (Gerätebefund vom 09.11.2026, Lauf #103 nach „Re-run failed jobs“)
//
// Aufbau genau nach der dokumentierten GitHub-REST-API (API-Version 2022-11-28):
// - Workflow-Runs: https://docs.github.com/en/rest/actions/workflow-runs#list-workflow-runs-for-a-workflow
//   (id und workflow_id sind int64 – Doku-Beispiel id 30433642, echte IDs heute ~1,9·10^10; run_attempt;
//   run_started_at laut Schema „The start time of the latest run. Resets on re-runs.“; updated_at)
// - Jobs: https://docs.github.com/en/rest/actions/workflow-jobs#list-jobs-for-a-workflow-run
//   (Parameter filter: „latest“ = Jobs der letzten Ausführung (Standard), „all“ = alle Versuche;
//   jeder Job hat run_id, run_attempt, status, conclusion, started_at, completed_at, steps[])
// Die Zahlen selbst (IDs, Zeiten, Namen) sind nachgebaut; die echten Daten (privates Repo) lagen nicht vor.
// ---------------------------------------------------------------------------
const RW = { wfId: 118542077, sha103: '1a29bbc' + '4f0e2d9c7b6a5f4e3d2c1b0a9f8e7d6c5', sha101: '9c0d1e2' + 'f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d' };
function realRun(id, n, sha, { status = 'completed', conclusion = 'success', attempt = 1, created, started, updated } = {}) {
  const url = `https://api.github.com${BASE}/actions/runs/${id}`;
  return {
    id, name: 'Build', node_id: 'WFR_kwLOM' + id, head_branch: 'main', head_sha: sha, path: '.github/workflows/build.yml',
    display_title: `Merge pull request #${n - 90}`, run_number: n, event: 'push', status, conclusion,
    workflow_id: RW.wfId, check_suite_id: id + 1000000, check_suite_node_id: 'CS_kwDOM' + id,
    url, html_url: `${GH}/actions/runs/${id}`, pull_requests: [], created_at: created, updated_at: updated,
    actor: { login: OWNER, id: 1234567, type: 'User' }, triggering_actor: { login: OWNER, id: 1234567, type: 'User' },
    run_attempt: attempt, referenced_workflows: [], run_started_at: started,
    jobs_url: url + '/jobs', logs_url: url + '/logs', check_suite_url: `https://api.github.com${BASE}/check-suites/${id + 1000000}`,
    artifacts_url: url + '/artifacts', cancel_url: url + '/cancel', rerun_url: url + '/rerun',
    previous_attempt_url: attempt > 1 ? `${url}/attempts/${attempt - 1}` : null,
    workflow_url: `https://api.github.com${BASE}/actions/workflows/${RW.wfId}`,
    head_commit: { id: sha, tree_id: 'f'.repeat(40), message: `Merge pull request #${n - 90}\n\nText`, timestamp: created,
      author: { name: OWNER, email: 'x@example.invalid' }, committer: { name: 'GitHub', email: 'noreply@github.com' } },
    repository: { id: 900000001, name: REPO, full_name: `${OWNER}/${REPO}`, private: true },
    head_repository: { id: 900000001, name: REPO, full_name: `${OWNER}/${REPO}`, private: true }
  };
}
// #103: Versuch 1 21:55–22:17 UTC (Veröffentlichen rot), Re-run nur des roten Jobs 22:19:01–22:19:17 (16 s).
const RUN103 = (o = {}) => realRun(19234567890, 103, RW.sha103, { attempt: 2, created: '2026-11-09T21:55:01Z', started: '2026-11-09T22:19:01Z', updated: '2026-11-09T22:19:17Z', ...o });
const RUN101 = () => realRun(19234112233, 101, RW.sha101, { created: '2026-11-09T20:10:02Z', started: '2026-11-09T20:10:02Z', updated: '2026-11-09T20:31:20Z' });
const olderRuns = () => [
  realRun(19233000100, 100, 'b'.repeat(40), { conclusion: 'failure', created: '2026-11-09T18:00:00Z', started: '2026-11-09T18:00:00Z', updated: '2026-11-09T18:12:00Z' }),
  realRun(19232000099, 99, 'c'.repeat(40), { attempt: 2, created: '2026-11-09T15:00:00Z', started: '2026-11-09T16:40:00Z', updated: '2026-11-09T16:40:30Z' }),
  realRun(19231000098, 98, 'd'.repeat(40), { created: '2026-11-09T12:00:00Z', started: '2026-11-09T12:00:00Z', updated: '2026-11-09T12:20:00Z' })
];
let realJobId = 55123400000;
function realJob(runId, attempt, name, from, to, steps, conclusion = 'success') {
  const id = realJobId++;
  return {
    id, run_id: runId, workflow_name: 'Build', head_branch: 'main', run_url: `https://api.github.com${BASE}/actions/runs/${runId}`,
    run_attempt: attempt, node_id: 'CR_kwDOM' + id, head_sha: RW.sha103, url: `https://api.github.com${BASE}/actions/jobs/${id}`,
    html_url: `${GH}/actions/runs/${runId}/job/${id}`, status: 'completed', conclusion, created_at: from, started_at: from, completed_at: to,
    name, steps: steps.map((st, i) => ({ name: st[0], status: 'completed', conclusion: st[3] || 'success', number: i + 1, started_at: st[1], completed_at: st[2] })),
    check_run_url: `https://api.github.com${BASE}/check-runs/${id}`, labels: ['ubuntu-latest'], runner_id: 1, runner_name: 'GitHub Actions 1',
    runner_group_id: 1, runner_group_name: 'GitHub Actions'
  };
}
const T = (hms) => `2026-11-09T${hms}Z`;
// Limits: native 20 min; web / bauen 25 min, Browser-Test 15 min; veröffentlichen 10 min, Schritt 10 min.
const REAL_YAML = [
  'name: Build',
  'on:',
  '  push:',
  '    branches: [main]',
  'jobs:',
  '  native:',
  '    name: native / bauen',
  '    timeout-minutes: 20',
  '    steps:',
  '      - uses: actions/checkout@v4',
  '      - name: Bauen',
  '        run: cmake --build out',
  '  web-bauen:',
  '    name: web / bauen (web-build)',
  '    timeout-minutes: 25',
  '    steps:',
  '      - name: Browser-Test',
  '        timeout-minutes: 15',
  '        run: npm test',
  '  web-publish:',
  '    name: web / veröffentlichen (web-build)',
  '    needs: [native, web-bauen]',
  '    timeout-minutes: 10',
  '    steps:',
  '      - name: Veröffentlichen',
  '        timeout-minutes: 10',
  '        run: ./publish.sh',
  ''
].join('\n');
// Jobs von #103 über beide Versuche (filter=all). Versuch 2 enthält nur den neu gestarteten Job.
function jobs103() {
  const id = 19234567890;
  return [
    realJob(id, 1, 'native / bauen', T('21:55:12'), T('22:02:40'), [['Set up job', T('21:55:12'), T('21:55:14')], ['Bauen', T('21:55:20'), T('22:02:30')]]),
    realJob(id, 1, 'web / bauen (web-build)', T('21:55:15'), T('22:08:51'), [['Set up job', T('21:55:15'), T('21:55:17')], ['Browser-Test', T('21:57:00'), T('22:07:30')]]), // 10,5 / 15 = 70 %
    // Versuch 1 rot: Veröffentlichen hing 8,5 min (85 % des Limits) – darf NICHT als knappster Schritt zählen.
    realJob(id, 1, 'web / veröffentlichen (web-build)', T('22:09:00'), T('22:17:45'), [['Veröffentlichen', T('22:09:10'), T('22:17:40'), 'failure']], 'failure'),
    realJob(id, 2, 'web / veröffentlichen (web-build)', T('22:19:03'), T('22:19:17'), [['Veröffentlichen', T('22:19:06'), T('22:19:14')]])
  ];
}
function jobs101() {
  const id = 19234112233;
  return [
    realJob(id, 1, 'native / bauen', T('20:10:10'), T('20:18:10'), [['Bauen', T('20:10:20'), T('20:18:00')]]),
    realJob(id, 1, 'web / bauen (web-build)', T('20:10:12'), T('20:29:00'), [['Browser-Test', T('20:12:00'), T('20:24:00')]]), // 12 / 15 = 80 %
    realJob(id, 1, 'web / veröffentlichen (web-build)', T('20:29:10'), T('20:31:10'), [['Veröffentlichen', T('20:29:20'), T('20:31:00')]])
  ];
}
// #99 (Re-run, Versuch 2): Versuch 1 15:00:10–15:18:10 (18 min, Veröffentlichen rot), Versuch 2 nur Veröffentlichen 20 s.
function jobs99() {
  const id = 19232000099;
  return [
    realJob(id, 1, 'web / bauen (web-build)', T('15:00:10'), T('15:16:00'), [['Browser-Test', T('15:01:00'), T('15:12:00')]]),
    realJob(id, 1, 'web / veröffentlichen (web-build)', T('15:16:00'), T('15:18:10'), [['Veröffentlichen', T('15:16:20'), T('15:18:00'), 'failure']], 'failure'),
    realJob(id, 2, 'web / veröffentlichen (web-build)', T('16:40:05'), T('16:40:25'), [['Veröffentlichen', T('16:40:08'), T('16:40:20')]])
  ];
}
function realMock() {
  mock.reset();
  mock.wfId = RW.wfId;
  mock.ciYaml = REAL_YAML;
}
const ciQuery = (r) => /status=completed/.test(r.query);

describe('CI-Laufzeit mit realistischen API-Daten', () => {
  test('Echte int64-Lauf-IDs: CI-Zeile erscheint (Gegenprobe zum Gerätebefund)', async () => {
    realMock();
    mock.latest = RUN101();
    mock.ciRuns = [RUN101(), ...olderRuns()];
    mock.ciJobs = jobs101();
    const { context, page, log } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await page.getAttribute('#ciTime', 'data-state'), 'ok', await text(page, '#ciTime'));
    // 20:10:02 → 20:31:20 = 21,3 min (Lauf ohne Re-run: wie bisher aus run_started_at/updated_at)
    assert.equal(await ciLine(page), 'CI: 21,3 min · web / bauen (web-build) › Browser-Test 12,0 / 15 min (80 %)');
    assert.equal(await page.getAttribute('#ciLight', 'href'), `${GH}/actions/runs/19234112233`);
    // + einmalig die Jobs des älteren Re-runs #99 (Gesamtdauer bisher unbekannt, Teil 2)
    assert.deepEqual(mock.requests.filter((r) => r.path.endsWith('/jobs')).map((r) => r.path + r.query),
      [`${BASE}/actions/runs/19234112233/jobs?filter=latest&per_page=100`, `${BASE}/actions/runs/19232000099/jobs?filter=all&per_page=100`]);
    assert.ok(mock.requests.some((r) => r.path.endsWith('build.yml') && r.query === `?ref=${RW.sha101}`));
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Re-run (run_attempt 2, nur ein Job im zweiten Versuch): ehrliche Dauer, Schritt aus seinem Versuch', async () => {
    realMock();
    mock.latest = RUN103();
    mock.ciRuns = [RUN103(), RUN101(), ...olderRuns()];
    mock.ciJobs = jobs103();
    mock.ciJobsByRun = { 19232000099: jobs99() };
    const { context, page, log } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await page.getAttribute('#ciTime', 'data-state'), 'ok', await text(page, '#ciTime'));
    // Jobzeit aller Versuche ohne Wartezeit: 21:55:12–22:08:51 (13:39) + 22:09:00–22:17:45 (8:45) + 22:19:03–22:19:17 (0:14)
    // = 1358 s = 22,6 min – nicht die 16 s des zweiten Versuchs. Knappster Schritt: Browser-Test aus Versuch 1 (70 %),
    // nicht der hängende Schritt aus dem fehlgeschlagenen Versuch 1 (85 %), Veröffentlichen aus Versuch 2 (8 s).
    assert.equal(await ciLine(page), 'CI: 22,6 min (Re-run, Versuch 2) · web / bauen (web-build) › Browser-Test 10,5 / 15 min (70 %)');
    assert.equal(await page.getAttribute('#ciTime', 'data-level'), 'warn');
    assert.doesNotMatch(await ciLine(page), /0,3 min/, 'keine irreführend kurze Dauer');
    // dazu einmalig die Jobs des älteren Re-runs #99 (Dauer bisher unbekannt)
    assert.deepEqual(mock.requests.filter((r) => r.path.endsWith('/jobs')).map((r) => r.path + r.query),
      [`${BASE}/actions/runs/19234567890/jobs?filter=all&per_page=100`, `${BASE}/actions/runs/19232000099/jobs?filter=all&per_page=100`], 'bei Re-run Jobs aller Versuche');
    await page.click('#ciMore');
    const blk = await itext(page, '#ciTightBlock');
    assert.match(blk, /web \/ bauen \(web-build\) › Browser-Test 10,5 von 15 min 70 %/);
    assert.match(blk, /Gemessen in Versuch 1 von 2/);
    assert.match(blk, /Re-run \(Versuch 2\): Gesamtdauer = Laufzeit der Jobs aller Versuche/);
    // Balken: #103 mit 22,6 min; älterer Re-run #99 nachgeladen (15:00:10–15:18:10 + 16:40:05–16:40:25 = 18,3 min) statt 0,5 min.
    const cols = await page.$$eval('#ciChart .ci-col', (cs) => cs.map((c) => [c.dataset.run, c.dataset.result, c.querySelector('.ci-val').textContent, c.dataset.attempt || '']));
    assert.deepEqual(cols, [['98', 'ok', '20,0', ''], ['99', 'rerun', '18,3', '2'], ['100', 'err', '12,0', ''], ['101', 'ok', '21,3', ''], ['103', 'rerun', '22,6', '2']]);
    // Gesamtdauer wird (ohne Token) gemerkt, damit #103 später als älterer Lauf richtig erscheint.
    const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('aether.ciHistory')));
    assert.equal(hist[0].id, 19234567890);
    assert.equal(hist[0].total, 1358);
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Balkenfarben nach Ausgang: grün / gelb (Re-run erfolgreich) / rot (auch Re-run fehlgeschlagen) / grau', async () => {
    realMock();
    // conclusion laut Doku: success, failure, neutral, cancelled, skipped, timed_out, action_required, stale, startup_failure
    const R = (id, n, conclusion, attempt) => realRun(id, n, 'a'.repeat(40), { conclusion, attempt, created: T('10:00:00'), started: T('10:00:00'), updated: T('10:20:00') });
    mock.latest = RUN101();
    mock.ciJobs = jobs101();
    mock.ciRuns = [RUN101(), R(19233900099, 99, 'success', 2), R(19233800098, 98, 'failure', 2), R(19233700097, 97, 'cancelled', 1), R(19233600096, 96, 'timed_out', 3)];
    const { context, page, log } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    await page.click('#ciMore');
    const res = () => page.$$eval('#ciChart .ci-col', (cs) => cs.map((c) => [c.dataset.run, c.dataset.result, getComputedStyle(c.querySelector('.ci-runbar')).backgroundColor]));
    const ok = await cssVar(page, '--ok'), err = await cssVar(page, '--err'), muted = await cssVar(page, '--muted');
    const yellow = 'rgb(232, 181, 74)'; // #E8B54A
    assert.equal(await cssVar(page, '--rerun'), yellow);
    assert.deepEqual(await res(), [['96', 'err', err], ['97', 'err', err], ['98', 'err', err], ['99', 'rerun', yellow], ['101', 'ok', ok]]);
    assert.notEqual(yellow, await cssVar(page, '--warn'), 'eigene Farbe, nicht die Prozent-Warnfarbe');
    // Legende
    assert.equal(await text(page, '#ciDetails .ci-unit'), 'Gesamtdauer in min · grün = beim ersten Mal erfolgreich · gelb = nach Re-run erfolgreich · rot = fehlgeschlagen/abgebrochen');
    // Andere Ergebnisse: startup_failure rot; neutral, skipped, stale, action_required grau
    mock.ciRuns = [RUN101(), R(19233900095, 95, 'startup_failure', 1), R(19233900094, 94, 'neutral', 1), R(19233900093, 93, 'action_required', 2), R(19233900092, 92, 'stale', 1)];
    await ciReload(page);
    await page.click('#ciMore');
    assert.deepEqual(await res(), [['92', 'other', muted], ['93', 'other', muted], ['94', 'other', muted], ['95', 'err', err], ['101', 'ok', ok]]);
    // Prozentfarben des knappsten Schritts unverändert (80 % → gelb wie bisher)
    assert.equal(await page.$eval('#ciTightBlock .ci-pct', (d) => getComputedStyle(d).color), await cssVar(page, '--warn'));
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Dauer älterer Re-run-Läufe wird nachgeladen, gemerkt und beim zweiten Laden nicht erneut angefragt', async () => {
    realMock();
    // Gerätebefund: #95 und #98 fehlgeschlagen mit Re-run (auch Versuch 2 rot) → bisher „–“.
    const R = (id, n, o) => realRun(id, n, 'a'.repeat(40), o);
    const run98 = R(19231000098, 98, { conclusion: 'failure', attempt: 2, created: T('18:00:00'), started: T('18:30:00'), updated: T('18:41:00') });
    const run95 = R(19230000095, 95, { conclusion: 'failure', attempt: 2, created: T('12:00:00'), started: T('13:00:00'), updated: T('13:12:00') });
    mock.latest = RUN101();
    mock.ciJobs = jobs101();
    mock.ciRuns = [RUN101(), R(19233000100, 100, { created: T('19:00:00'), started: T('19:00:00'), updated: T('19:20:00') }), run98, R(19230500096, 96, { created: T('14:00:00'), started: T('14:00:00'), updated: T('14:10:00') }), run95];
    mock.ciJobsByRun = {
      // #98: Versuch 1 18:00:10–18:15:10 (15 min), Versuch 2 alle Jobs neu 18:30:05–18:40:35 (10,5 min) = 25,5 min
      19231000098: [
        realJob(19231000098, 1, 'web / bauen (web-build)', T('18:00:10'), T('18:15:10'), [], 'failure'),
        realJob(19231000098, 2, 'web / bauen (web-build)', T('18:30:05'), T('18:40:35'), [], 'failure')
      ],
      // #95: zwei überlappende Jobs 12:00:10–12:09:10 und 12:01:10–12:10:10 (10 min), Versuch 2 13:00:10–13:11:10 (11 min) = 21 min
      19230000095: [
        realJob(19230000095, 1, 'native / bauen', T('12:00:10'), T('12:09:10'), []),
        realJob(19230000095, 1, 'web / bauen (web-build)', T('12:01:10'), T('12:10:10'), [], 'failure'),
        realJob(19230000095, 2, 'web / bauen (web-build)', T('13:00:10'), T('13:11:10'), [], 'failure')
      ]
    };
    const { context, page, log } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    const jobReq = () => mock.requests.filter((r) => r.path.endsWith('/jobs')).map((r) => r.path + r.query);
    assert.deepEqual(jobReq().sort(), [
      `${BASE}/actions/runs/19230000095/jobs?filter=all&per_page=100`,
      `${BASE}/actions/runs/19231000098/jobs?filter=all&per_page=100`,
      `${BASE}/actions/runs/19234112233/jobs?filter=latest&per_page=100`
    ], 'nur die Läufe mit unbekannter Dauer, mit filter=all');
    await page.click('#ciMore');
    const cols = () => page.$$eval('#ciChart .ci-col', (cs) => cs.map((c) => [c.dataset.run, c.dataset.result, c.querySelector('.ci-val').textContent]));
    assert.deepEqual(await cols(), [['95', 'err', '21,0'], ['96', 'ok', '10,0'], ['98', 'err', '25,5'], ['100', 'ok', '20,0'], ['101', 'ok', '21,3']]);
    const h98 = await page.$eval('#ciChart .ci-col[data-run="98"] .ci-runbar', (b) => b.getBoundingClientRect().height);
    assert.ok(h98 > 50, `Balken #98 sichtbar (${h98}px)`);
    // Verlauf: Dauer gemerkt, ohne Token
    const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('aether.ciHistory')));
    assert.equal(hist.find((x) => x.id === 19231000098).total, 1530);
    assert.equal(hist.find((x) => x.id === 19230000095).total, 1260);
    assert.ok(!JSON.stringify(hist).includes(TOKEN));
    // Zweites Laden (Aktualisieren, also ohne 60-s-Cache): keine erneute Anfrage für #95/#98.
    mock.requests = [];
    await ciReload(page);
    assert.deepEqual(jobReq(), [`${BASE}/actions/runs/19234112233/jobs?filter=latest&per_page=100`], 'Dauer aus dem Verlauf');
    await page.click('#ciMore');
    assert.deepEqual((await cols()).map((c) => c[2]), ['21,0', '10,0', '25,5', '20,0', '21,3']);
    // Auch nach Neuladen der Seite (localStorage bleibt): 0 zusätzliche Anfragen.
    mock.requests = [];
    await page.reload();
    await page.waitForSelector('#projectView:not([hidden])');
    await waitProjectLoaded(page);
    await waitCiTime(page);
    assert.deepEqual(jobReq(), [`${BASE}/actions/runs/19234112233/jobs?filter=latest&per_page=100`]);
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Höchstens 4 zusätzliche Anfragen; gescheiterte Job-Anfrage → Stummel „Dauer ?“, keine Fehlerkarte', async () => {
    realMock();
    const R = (id, n, conclusion) => realRun(id, n, 'a'.repeat(40), { conclusion, attempt: 2, created: T('10:00:00'), started: T('11:00:00'), updated: T('11:00:20') });
    const ids = [19233900099, 19233800098, 19233700097, 19233600096];
    mock.latest = RUN101();
    mock.ciJobs = jobs101();
    mock.ciRuns = [RUN101(), R(ids[0], 99, 'success'), R(ids[1], 98, 'failure'), R(ids[2], 97, 'cancelled'), R(ids[3], 96, 'success')];
    // #99: 8 min; #98 scheitert (502); #97 ohne verwertbare Jobs; #96: 5 min
    mock.ciJobsByRun = {
      [ids[0]]: [realJob(ids[0], 1, 'web / bauen (web-build)', T('10:00:00'), T('10:08:00'), [])],
      [ids[2]]: [],
      [ids[3]]: [realJob(ids[3], 2, 'web / bauen (web-build)', T('11:00:00'), T('11:05:00'), [])]
    };
    mock.ciJobsFail = [ids[1]];
    const { context, page, log } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    const extra = mock.requests.filter((r) => r.path.endsWith('/jobs') && r.query.includes('filter=all'));
    assert.equal(extra.length, 4, 'höchstens 4 zusätzliche Anfragen');
    assert.equal(await page.getAttribute('#ciTime', 'data-state'), 'ok');
    assert.equal(await ciLine(page), 'CI: 21,3 min · web / bauen (web-build) › Browser-Test 12,0 / 15 min (80 %)', 'übrige Anzeige unverändert');
    assert.equal(await page.$('#ciBody .msg'), null, 'keine Fehlerkarte');
    assert.equal(await page.getAttribute('#ciLight', 'data-state'), 'ok');
    await page.click('#ciMore');
    const cols = await page.$$eval('#ciChart .ci-col', (cs) => cs.map((c) => {
      const b = c.querySelector('.ci-runbar');
      return [c.dataset.run, c.dataset.result, c.querySelector('.ci-val').textContent, Math.round(b.getBoundingClientRect().height), getComputedStyle(b).backgroundColor];
    }));
    const err = await cssVar(page, '--err');
    assert.deepEqual(cols.map((c) => c.slice(0, 3)), [['96', 'rerun', '5,0'], ['97', 'err', 'Dauer ?'], ['98', 'err', 'Dauer ?'], ['99', 'rerun', '8,0'], ['101', 'ok', '21,3']]);
    for (const c of cols.filter((x) => x[2] === 'Dauer ?')) {
      assert.ok(c[3] >= 4 && c[3] <= 8, `Stummel #${c[0]} kurz (${c[3]}px)`);
      assert.equal(c[4], err, `Stummel #${c[0]} in Statusfarbe`);
    }
    // Gescheitertes wird nicht gemerkt → beim nächsten Laden erneut versucht (nur diese beiden).
    const hist = await page.evaluate(() => JSON.parse(localStorage.getItem('aether.ciHistory')));
    assert.ok(!hist.some((x) => x.id === ids[1] || x.id === ids[2]));
    mock.ciJobsFail = [];
    mock.requests = [];
    await ciReload(page);
    assert.deepEqual(mock.requests.filter((r) => r.query.includes('filter=all')).map((r) => r.path).sort(),
      [`${BASE}/actions/runs/${ids[2]}/jobs`, `${BASE}/actions/runs/${ids[1]}/jobs`].sort());
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Balkenbeschriftung wird nie von der Limit-Linie überdeckt (geometrisch)', async () => {
    realMock();
    // Gerätebefund: „26,8“ über #101 von der 30-min-Linie durchgestrichen.
    mock.ciYaml = 'jobs:\n  w:\n    name: web / bauen (web-build)\n    timeout-minutes: 30\n';
    const R = (id, n, min, conclusion = 'success') => realRun(id, n, 'a'.repeat(40), { conclusion, created: T('10:00:00'), started: T('10:00:00'),
      updated: new Date(Date.parse(T('10:00:00')) + min * 60000).toISOString().replace('.000', '') });
    mock.ciJobs = [realJob(19234112233, 1, 'web / bauen (web-build)', T('10:00:00'), T('10:20:00'), [])];
    const { context, page, log } = await newPage(null);
    const geo = () => page.evaluate(() => {
      const r = (e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, l: b.left, r: b.right }; };
      const line = document.getElementById('ciLimitLine');
      return {
        line: r(line), text: r(line.querySelector('span')),
        cols: [...document.querySelectorAll('#ciChart .ci-col')].map((c) => ({ run: c.dataset.run, val: r(c.querySelector('.ci-val')), bar: r(c.querySelector('.ci-runbar')),
          inside: c.querySelector('.ci-val').classList.contains('ci-val-in'), color: getComputedStyle(c.querySelector('.ci-val')).color, txt: c.querySelector('.ci-val').textContent }))
      };
    });
    const hit = (a, b) => a.t < b.b && a.b > b.t && a.l < b.r && a.r > b.l;
    const scenarios = [
      [26.8, 20, 12, 18, 22],          // Gerätebefund #101
      [26.8, 28.5, 29.8, 30.6, 31.8],  // knapp unter, auf und über der Linie
      [24, 25.5, 27, 29, 33],
      [1, 2, 29.4, 29.9, 30.2]
    ];
    let first = true, sawInside = false;
    for (const sc of scenarios) {
      mock.latest = R(19234112233, 101, sc[0]);
      mock.ciRuns = [mock.latest, R(19233000100, 100, sc[1]), R(19232000099, 99, sc[2], 'failure'), R(19231000098, 98, sc[3]), R(19230000097, 97, sc[4])];
      if (first) { await openProject(page); await waitCiTime(page); first = false; } else await ciReload(page);
      await page.click('#ciMore');
      const g = await geo();
      assert.equal(await text(page, '#ciLimitLine'), 'Limit 30 min');
      for (const c of g.cols) {
        assert.ok(!hit(c.val, g.line), `#${c.run} (${c.txt}) überlappt die Linie nicht: ${JSON.stringify([c.val, g.line])}`);
        assert.ok(!hit(c.val, g.text), `#${c.run} (${c.txt}) überlappt „Limit 30 min“ nicht`);
        if (c.inside) {
          sawInside = true;
          assert.ok(c.val.t >= c.bar.t - 0.5 && c.val.b <= c.bar.b + 0.5, `#${c.run} innerhalb des Balkens`);
          assert.equal(c.color, 'rgb(11, 14, 20)', 'dunkle Schrift');
        } else {
          assert.ok(c.val.b <= c.bar.t + 0.5, `#${c.run} über dem Balken`);
        }
      }
      if (sc === scenarios[0]) {
        const c101 = g.cols.find((c) => c.run === '101');
        assert.equal(c101.txt, '26,8');
        assert.ok(c101.inside, '26,8 steht im Balken (Gerätebefund)');
        assert.ok(!g.cols.find((c) => c.run === '100').inside, 'weit unter der Linie: normal über dem Balken');
      }
    }
    assert.ok(sawInside);
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Versuchs-Hinweis: übernommene Jobs (Re-run failed jobs) werden erkannt, sonst Zeile weglassen', async () => {
    realMock();
    // Aufbau wie die echten Jobs von aether #103 (filter=all, gelesen am 10.11.2026): Jobs, die in Versuch 2
    // nicht neu liefen, stehen dort mit neuer ID, run_attempt 2 und created_at des Versuchs 2, aber
    // started_at/completed_at aus Versuch 1.
    const id = 19234567890;
    const copy = (j, created) => ({ ...j, id: realJobId++, run_attempt: 2, created_at: created });
    const nat1 = realJob(id, 1, 'native / bauen', T('21:45:37'), T('21:48:43'), [['Bauen', T('21:45:40'), T('21:48:40')]]);
    const web1 = realJob(id, 1, 'web / bauen (web-build)', T('21:45:37'), T('22:05:00'), [['Browser-Test', T('21:47:00'), T('21:59:00')]]); // 12/15 = 80 %
    const pub1 = realJob(id, 1, 'web / veröffentlichen (web-build)', T('22:08:47'), T('22:09:04'), [['Veröffentlichen', T('22:08:50'), T('22:09:00'), 'failure']], 'failure');
    const pub2 = realJob(id, 2, 'web / veröffentlichen (web-build)', T('22:19:20'), T('22:19:31'), [['Veröffentlichen', T('22:19:22'), T('22:19:30')]]);
    mock.latest = realRun(id, 103, RW.sha103, { attempt: 2, created: T('21:45:30'), started: T('22:19:16'), updated: T('22:19:32') });
    mock.ciRuns = [mock.latest, RUN101()];
    mock.ciJobsByRun = { [id]: [nat1, web1, pub1, pub2, copy(nat1, T('22:19:18')), copy(web1, T('22:19:23'))] };
    const { context, page, log } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await ciLine(page), 'CI: 19,9 min (Re-run, Versuch 2) · web / bauen (web-build) › Browser-Test 12,0 / 15 min (80 %)'); // 19:23 + 0:17 + 0:11, Kopien zählen nicht doppelt
    await page.click('#ciMore');
    assert.equal(await text(page, '#ciAttemptHint'), 'Lief in Versuch 1, in Versuch 2 übernommen');

    // Wie aether #95: der knappste Job lief in Versuch 2 wirklich neu → „Gemessen in Versuch 2 von 2“.
    const webA = realJob(id, 1, 'web / bauen (web-build)', T('05:01:11'), T('05:25:02'), [['Browser-Test', T('05:02:00'), T('05:24:00'), 'failure']], 'failure');
    const webB = realJob(id, 2, 'web / bauen (web-build)', T('14:50:05'), T('15:03:14'), [['Browser-Test', T('14:51:00'), T('15:02:00')]]); // 11/15 = 73 %
    const natA = realJob(id, 1, 'native / bauen', T('05:01:11'), T('05:04:17'), []);
    mock.latest = realRun(id, 103, RW.sha103, { attempt: 2, conclusion: 'failure', created: T('05:01:00'), started: T('14:49:59'), updated: T('15:03:15') });
    mock.ciRuns = [mock.latest, RUN101()];
    mock.ciJobsByRun = { [id]: [webA, natA, webB, copy(natA, T('14:50:03'))] };
    await ciReload(page);
    await page.click('#ciMore');
    assert.match(await itext(page, '#ciTightBlock'), /Browser-Test 11,0 von 15 min 73 %/);
    assert.equal(await text(page, '#ciAttemptHint'), 'Gemessen in Versuch 2 von 2');

    // Nur die Kopie ist da (Original fehlt in der Liste): Versuch nicht sicher bekannt → Zeile fehlt.
    mock.latest = realRun(id, 103, RW.sha103, { attempt: 2, created: T('21:45:30'), started: T('22:19:16'), updated: T('22:19:32') });
    mock.ciRuns = [mock.latest, RUN101()];
    mock.ciJobsByRun = { [id]: [pub2, copy(web1, T('22:19:23'))] };
    await ciReload(page);
    await page.click('#ciMore');
    assert.match(await itext(page, '#ciTightBlock'), /Browser-Test 12,0 von 15 min 80 %/);
    assert.equal(await page.$('#ciAttemptHint'), null, 'lieber weglassen als raten');
    assert.doesNotMatch(await itext(page, '#ciTightBlock'), /Gemessen in Versuch|übernommen/);
    await assertNoLeak(log, page);
    await context.close();
  });

  test('Neuerer laufender Lauf und laufender Re-run werden übergangen', async () => {
    realMock();
    // #104 läuft, letzter abgeschlossener ist #103 (Re-run)
    mock.latest = realRun(19235000104, 104, 'e'.repeat(40), { status: 'in_progress', conclusion: null, created: '2026-11-09T22:40:00Z', started: '2026-11-09T22:40:00Z', updated: '2026-11-09T22:41:00Z' });
    mock.ciRuns = [mock.latest, RUN103(), RUN101(), ...olderRuns()];
    mock.ciJobs = jobs103();
    const { context, page } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await page.getAttribute('#ciLight', 'data-state'), 'warn');
    assert.equal(await ciLine(page), 'CI (Lauf #103): 22,6 min (Re-run, Versuch 2) · web / bauen (web-build) › Browser-Test 10,5 / 15 min (70 %)');
    assert.ok(!mock.requests.some((r) => r.path.includes('19235000104')), 'nichts vom laufenden Lauf');

    // #103 wird gerade neu gestartet (Versuch 2 läuft): Zeile nennt #101, nicht „kein Lauf“.
    mock.latest = RUN103({ status: 'in_progress', conclusion: null, updated: '2026-11-09T22:19:05Z' });
    mock.ciRuns = [mock.latest, RUN101(), ...olderRuns()];
    mock.ciJobs = jobs101();
    mock.requests = [];
    await ciReload(page);
    assert.equal(await ciLine(page), 'CI (Lauf #101): 21,3 min · web / bauen (web-build) › Browser-Test 12,0 / 15 min (80 %)');
    assert.ok(!mock.requests.some((r) => r.path.includes('19234567890')), 'nichts vom laufenden Re-run');
    await context.close();
  });

  test('Leere oder unpassende Antwort: Diagnosetext statt „kein Lauf“', async () => {
    realMock();
    mock.latest = RUN103();
    mock.ciRuns = [];
    const { context, page, log } = await newPage(null);
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await page.getAttribute('#ciTime', 'data-state'), 'none');
    assert.equal(await text(page, '#ciTime'), 'CI-Laufzeit: API lieferte 0 Läufe');
    // Die Ampel zeigt einen fertigen Lauf → genau einmal frisch nachgeladen, nicht öfter.
    assert.equal(mock.requests.filter(ciQuery).length, 2);
    assert.equal(await page.$('#ciBody .msg'), null, 'keine Fehlerkarte');

    // Server liefert (trotz status=completed) nur einen laufenden Lauf.
    mock.ci = 'ignoreStatus';
    mock.ciRuns = [RUN103({ status: 'in_progress', conclusion: null })];
    await ciReload(page);
    assert.equal(await text(page, '#ciTime'), 'CI-Laufzeit: API lieferte 1 Lauf, keiner abgeschlossen');
    mock.ciRuns = [RUN103({ status: 'queued', conclusion: null }), { ...RUN101(), status: 'in_progress', conclusion: null }];
    await ciReload(page);
    assert.equal(await text(page, '#ciTime'), 'CI-Laufzeit: API lieferte 2 Läufe, keiner abgeschlossen');
    await assertNoLeak(log, page);
    await context.close();
  });

  test('API-Fehler (auch beim Re-run) bleiben „CI-Laufzeit nicht verfügbar“', async () => {
    realMock();
    mock.latest = RUN103();
    mock.ciRuns = [RUN103(), RUN101(), ...olderRuns()];
    mock.ciJobs = jobs103();
    const { context, page, log } = await newPage(null);
    let first = true;
    for (const mode of ['runs500', 'jobs500', 'jobsRate', 'yaml404']) {
      mock.ci = mode;
      if (first) { await openProject(page); await waitCiTime(page); first = false; } else await ciReload(page);
      assert.equal(await page.getAttribute('#ciTime', 'data-state'), 'unavailable', mode);
      assert.equal(await text(page, '#ciTime'), 'CI-Laufzeit nicht verfügbar', mode);
      assert.equal(await page.getAttribute('#ciLight', 'data-state'), 'ok', `Ampel bleibt (${mode})`);
    }
    mock.ci = 'ok';
    await ciReload(page);
    assert.equal(await page.getAttribute('#ciTime', 'data-state'), 'ok');
    await assertNoLeak(log, page);
    await context.close();
  });

  // Gerätebefund 11.11.2026 (iPad): „(43“ am Ende von Zeile 1, „%)“ allein in Zeile 2. Messwert und Prozent
  // „10,7 / 25 min (43 %)“ bilden einen untrennbaren Block: passt er nicht mehr, rutscht er ganz in die nächste Zeile.
  test('CI-Zeile: „Dauer / Limit (Prozent)“ bricht nie innerhalb um (alle Breiten 320–1400 px, kein Überlauf in Build-, Projektansicht und Token-Bildschirm)', async () => {
    realMock();
    const D = (hms) => `2026-11-11T${hms}Z`;
    const RUN104 = () => realRun(19235550104, 104, 'e'.repeat(40), { attempt: 2, created: D('05:00:01'), started: D('05:30:00'), updated: D('05:33:50') });
    const JOB = 'web / Browser-Test Teil 3 (I, E, F, H, M, N, O)';
    const STEP = 'Browser-Test Teil 3 (Abschnitte I, E, F, H, M, O, P, R, S)';
    mock.ciYaml = [
      'name: Build', 'on:', '  push:', '    branches: [main]', 'jobs:',
      '  native:', '    name: native / bauen', '    timeout-minutes: 20', '    steps:', '      - name: Bauen', '        run: cmake --build out',
      '  web-test-3:', `    name: '${JOB}'`, '    timeout-minutes: 45', '    steps:',
      `      - name: '${STEP}'`, '        timeout-minutes: 25', '        run: npm test',
      '  web-publish:', '    name: web / veröffentlichen (web-build)', '    timeout-minutes: 10', '    steps:',
      '      - name: Veröffentlichen', '        timeout-minutes: 10', '        run: ./publish.sh', ''
    ].join('\n');
    // Versuch 1: 05:00:00–05:13:00 (780 s) + 05:13:10–05:20:00 (410 s, Veröffentlichen rot); Versuch 2: 05:30:00–05:33:46 (226 s)
    // = 1416 s = 23,6 min. Knappster Schritt: 05:01:00–05:11:42 = 642 s = 10,7 von 25 min = 43 %.
    const id = 19235550104;
    mock.latest = RUN104();
    mock.ciRuns = [RUN104(), RUN101(), ...olderRuns()];
    mock.ciJobs = [
      realJob(id, 1, 'native / bauen', D('05:00:00'), D('05:08:00'), [['Bauen', D('05:00:10'), D('05:07:50')]]),
      realJob(id, 1, JOB, D('05:00:10'), D('05:13:00'), [['Set up job', D('05:00:10'), D('05:00:12')], [STEP, D('05:01:00'), D('05:11:42')]]),
      realJob(id, 1, 'web / veröffentlichen (web-build)', D('05:13:10'), D('05:20:00'), [['Veröffentlichen', D('05:13:20'), D('05:19:50'), 'failure']], 'failure'),
      realJob(id, 2, 'web / veröffentlichen (web-build)', D('05:30:00'), D('05:33:46'), [['Veröffentlichen', D('05:30:05'), D('05:31:00')]])
    ];
    mock.ciJobsByRun = { 19232000099: jobs99() };
    const BLOCK = '10,7 / 25 min (43 %)';
    const SIZES = [[1194, 834], [834, 1194], [874, 402], [402, 874], [390, 844], [360, 780], [320, 568]];
    const frame = () => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
    const { context, page, log } = await newPage(null);
    // Elemente, die links oder rechts über den sichtbaren Bereich hinausragen (für die Prüfung „kein waagerechtes Scrollen“).
    await context.addInitScript(() => {
      window.beyondViewport = () => [...document.querySelectorAll('body *')].filter((e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && (r.right > window.innerWidth + 0.5 || r.left < -0.5);
      }).map((e) => ({ el: e.tagName + (e.id ? '#' + e.id : ''), inHeader: !!e.closest('header.top') }));
      // Kopfzeile: Umschalter vollständig sichtbar, Link „WebGPU-Check“ (Text oder Symbol) mit Tippfläche ≥ 44 × 44 px.
      window.headerState = () => {
        window.scrollTo(0, 0); // Element-Screenshots scrollen die Seite; die Kopfzeile wird ganz oben geprüft.
        const vw = window.innerWidth;
        const tabs = document.getElementById('tabs');
        const t = tabs.getBoundingClientRect();
        const btns = [...tabs.querySelectorAll('button')].map((b) => {
          const r = b.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return { w: r.width, h: r.height, inView: r.left >= -0.5 && r.right <= vw + 0.5, hit: !!hit && b.contains(hit), clipped: b.scrollWidth > b.clientWidth };
        });
        const tabsOk = t.width > 0 && t.left >= -0.5 && t.right <= vw + 0.5 && btns.length === 2 && btns.every((b) => b.w >= 44 && b.h >= 44 && b.inView && b.hit && !b.clipped);
        const a = document.querySelector('header.top #hdrWebgpu');
        const r = a.getBoundingClientRect();
        const link = { visible: r.width > 0, iconOnly: getComputedStyle(a.querySelector('.lbl')).display === 'none', text: a.textContent.trim(), aria: a.getAttribute('aria-label') };
        if (link.visible) {
          const on = (x, y) => { const e = document.elementFromPoint(x, y); return !!e && a.contains(e); };
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          let l = cx, rr = cx, tp = cy, bt = cy;
          while (l > 0 && on(l - 0.5, cy)) l -= 0.5;
          while (rr < vw && on(rr + 0.5, cy)) rr += 0.5;
          while (tp > 0 && on(cx, tp - 0.5)) tp -= 0.5;
          while (bt < window.innerHeight && on(cx, bt + 0.5)) bt += 0.5;
          Object.assign(link, { hitW: rr - l, hitH: bt - tp, inView: r.left >= -0.5 && r.right <= vw + 0.5 });
        }
        const card = document.querySelector('#tokenView:not([hidden]) a[href="webgpu-check.html"]');
        const cr = card && card.getBoundingClientRect();
        return { tabsOk, btns, link, cardLink: !!cr && cr.width > 0 && cr.left >= -0.5 && cr.right <= vw + 0.5 };
      };
    });
    const assertHeader = async (w, where, linkInHeader) => {
      const h = await page.evaluate(() => window.headerState());
      assert.ok(h.tabsOk, `${w}px (${where}): Umschalter „Spielen | Projekt“ vollständig sichtbar ${JSON.stringify(h.btns)}`);
      if (linkInHeader) {
        assert.ok(h.link.visible && h.link.inView, `${w}px (${where}): Link „WebGPU-Check“ sichtbar ${JSON.stringify(h.link)}`);
        assert.equal(h.link.aria, 'WebGPU-Check');
        if (!h.link.iconOnly) assert.equal(h.link.text, 'WebGPU-Check');
        assert.ok(h.link.hitW >= 44 && h.link.hitH >= 44, `${w}px (${where}): Tippfläche ${h.link.hitW}×${h.link.hitH}`);
      } else {
        assert.ok(!h.link.visible, `${w}px (${where}): Kopfzeilen-Link ausgeblendet`);
        assert.ok(h.cardLink, `${w}px (${where}): Link „WebGPU-Check“ in der Token-Karte erreichbar`);
      }
    };
    // Build-Ansicht und Token-Bildschirm: kein waagerechter Überlauf, Kopfzeile vollständig.
    const checkView = async (where, linkInHeader) => {
      for (const [w, h] of [...SIZES, ...Array.from({ length: 109 }, (_, i) => [320 + i * 10, 900])]) {
        await page.setViewportSize({ width: w, height: h });
        await frame();
        const m = await page.evaluate(() => ({ overflow: document.documentElement.scrollWidth - window.innerWidth, beyond: window.beyondViewport() }));
        assert.deepEqual(m.beyond, [], `${w}×${h} (${where}): nichts ragt über den Rand`);
        assert.ok(m.overflow <= 0, `${w}×${h} (${where}): waagerechtes Scrollen ${m.overflow}px`);
        await assertHeader(w, where, linkInHeader);
      }
    };
    await page.setViewportSize({ width: 1194, height: 834 });
    await openProject(page);
    await waitCiTime(page);
    assert.equal(await ciLine(page), `CI: 23,6 min (Re-run, Versuch 2) · ${JOB} › ${STEP} ${BLOCK}`);
    assert.equal(await page.getAttribute('#ciTime .ci-pct', 'data-level'), 'ok', '43 % bleibt grün');
    // Anfragen der Projektansicht beim ersten Laden unverändert (9: Workflows, letzter Lauf, 5 abgeschlossene, Jobs,
    // build.yml, PRs, Commits, ROADMAP.md, einmalig Jobs des älteren Re-runs #99) – ohne die Spielansicht davor.
    const projReq = mock.requests.filter((r) => !/\/contents\/(index\.json|builds\/)/.test(r.path));
    assert.equal(projReq.length, 9, projReq.map((r) => r.path).join('\n'));

    // Lage jedes Zeichens eines Textes (ohne Leerzeichen) – unabhängig davon, wie das DOM aufgebaut ist.
    const measure = (rootSel, want) => page.evaluate(([rootSel, want]) => {
      const root = document.querySelector(rootSel);
      const chars = [];
      const tw = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
      for (let n = tw.nextNode(); n; n = tw.nextNode()) for (let i = 0; i < n.data.length; i++) chars.push([n, i]);
      const full = chars.map(([n, i]) => n.data[i]).join('');
      const at = full.lastIndexOf(want);
      if (at < 0) return { missing: full };
      const lh = parseFloat(getComputedStyle(root).lineHeight);
      const rootTop = root.getBoundingClientRect().top;
      const card = document.getElementById('ciCard').getBoundingClientRect();
      const rects = [];
      for (let k = at; k < at + want.length; k++) {
        const [n, i] = chars[k];
        if (/\s/.test(n.data[i])) continue;
        const r = document.createRange();
        r.setStart(n, i); r.setEnd(n, i + 1);
        const b = r.getBoundingClientRect();
        rects.push({ c: n.data[i], mid: (b.top + b.bottom) / 2, l: b.left, r: b.right });
      }
      const lineOf = (mid) => Math.floor((mid - rootTop) / lh) + 1;
      return {
        lines: [...new Set(rects.map((x) => lineOf(x.mid)))],
        totalLines: Math.round(root.getBoundingClientRect().height / lh),
        left: Math.min(...rects.map((x) => x.l)), right: Math.max(...rects.map((x) => x.r)),
        inCard: rects.every((x) => x.l >= card.left - 0.5 && x.r <= card.right + 0.5),
        pageOverflow: document.documentElement.scrollWidth - window.innerWidth,
        beyond: beyondViewport(),
        cardOverflow: document.getElementById('ciCard').scrollWidth - document.getElementById('ciCard').clientWidth,
        lineOverflow: root.scrollWidth - root.clientWidth
      };
    }, [rootSel, want]);
    const log2 = [];
    const check = async (w, h, where) => {
      await page.setViewportSize({ width: w, height: h });
      await frame();
      const m = await measure('#ciTimeLine', BLOCK);
      assert.ok(!m.missing, `${w}px: Block fehlt in „${m.missing}“`);
      assert.equal(m.lines.length, 1, `${w}×${h} (${where}): „${BLOCK}“ liegt in einer Zeile, gemessen in Zeilen ${m.lines}`);
      assert.ok(m.inCard, `${w}px: Block ragt aus der Karte (${m.left}–${m.right})`);
      // Kein waagerechtes Scrollen – weder durch die CI-Karte noch durch die Kopfzeile oder sonst etwas.
      assert.deepEqual(m.beyond, [], `${w}px: nichts ragt über den Rand`);
      assert.ok(m.pageOverflow <= 0, `${w}px: waagerechtes Scrollen ${m.pageOverflow}px`);
      await assertHeader(w, where, true);
      assert.ok(m.cardOverflow <= 0, `${w}px: Karte läuft über ${m.cardOverflow}px`);
      assert.ok(m.lineOverflow <= 0, `${w}px: Zeile läuft über ${m.lineOverflow}px`);
      // Dasselbe am Element des Blocks: alle seine Rechtecke (Chromium liefert je Kind eines) auf derselben Höhe.
      const tops = await page.$eval('#ciTimeLine .ci-meas', (e) => [...e.getClientRects()].map((r) => [Math.round(r.top), Math.round(r.bottom)]));
      assert.ok(tops.length >= 1 && tops.every((t) => Math.abs(t[0] - tops[0][0]) <= 1 && Math.abs(t[1] - tops[0][1]) <= 1), `${w}px: .ci-meas in einer Zeile ${JSON.stringify(tops)}`);
      log2.push({ w, h, where, line: m.lines[0], of: m.totalLines, left: Math.round(m.left), right: Math.round(m.right) });
    };
    for (const [w, h] of SIZES) {
      await check(w, h, 'fest');
      await (await page.$('#ciCard')).screenshot({ path: path.join(OUT, `ci-zeile-block-${w}x${h}.png`) });
    }
    for (let w = 320; w <= 1400; w += 10) await check(w, 900, 'Durchlauf');
    // Der Durchlauf trifft Breiten, in denen der Block am Zeilenanfang einer Folgezeile steht.
    assert.ok(log2.some((x) => x.line > 1), 'Block rutscht bei schmalen Breiten in eine Folgezeile');

    // Details „Knappster Schritt“: „10,7 von 25 min“ und „43 %“ stehen in derselben Zeile (bei allen Breiten).
    await page.click('#ciMore');
    const det = [];
    for (const w of [...SIZES.map((s) => s[0]), ...Array.from({ length: 109 }, (_, i) => 320 + i * 10)]) {
      await page.setViewportSize({ width: w, height: 900 });
      await frame();
      const m = await page.evaluate(() => {
        const row = document.querySelector('#ciTightBlock .ci-tightrow');
        const box = (e) => { const b = e.getBoundingClientRect(); return { t: b.top, b: b.bottom, rects: e.getClientRects().length }; };
        return { val: box(row.children[0]), pct: box(row.children[1]), overflow: document.documentElement.scrollWidth - window.innerWidth, beyond: window.beyondViewport() };
      });
      assert.equal(m.val.rects, 1, `${w}px: „10,7 von 25 min“ einzeilig`);
      assert.equal(m.pct.rects, 1, `${w}px: „43 %“ einzeilig`);
      assert.ok(Math.abs(m.val.t - m.pct.t) < 1 && Math.abs(m.val.b - m.pct.b) < 1, `${w}px: Wert und Prozent in derselben Zeile`);
      assert.deepEqual(m.beyond, [], `${w}px (Details offen): nichts ragt über den Rand`);
      assert.ok(m.overflow <= 0, `${w}px (Details offen): waagerechtes Scrollen ${m.overflow}px`);
      det.push(w);
    }
    assert.equal(await page.$eval('#ciTightBlock .ci-tightrow', (r) => r.textContent.replace(/\s+/g, ' ')), '10,7 von 25 min43 %');
    fs.writeFileSync(path.join(OUT, 'ci-zeile-block-lage.json'), JSON.stringify({ lage: log2 }, null, 1));

    // Build-Ansicht
    await page.setViewportSize({ width: 1194, height: 834 });
    await page.click('#tabPlay');
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    await checkView('Build-Ansicht', true);
    // Token-Bildschirm (über „Token löschen“; der Dialog wird bestätigt)
    await page.setViewportSize({ width: 1194, height: 834 });
    await page.click('#deleteTokenBtn');
    await page.waitForSelector('#tokenView:not([hidden])');
    await checkView('Token-Bildschirm', false);
    await assertNoLeak(log, page);
    await context.close();
  });
});
