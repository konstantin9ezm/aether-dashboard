// Gemeinsame Test-Hilfe für tests/klappen.test.js und tests/selbst-aktualisieren.test.js:
// nachgebaute GitHub-REST-API (Spiel- und Projektansicht), statischer Server mit steuerbarer
// Dashboard-Version und Seitenaufbau mit Test-Schaltern. Keine festen Wartezeiten.
'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium, devices } = require('playwright');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
const OWNER = 'konstantin9ezm';
const BASE = `/repos/${OWNER}/aether`;
const DASH_BASE = `/repos/${OWNER}/aether-dashboard`;
fs.mkdirSync(OUT, { recursive: true });

const sha = (c) => String(c).repeat(40).slice(0, 40);
const gitSha = (buf) => crypto.createHash('sha1').update(`blob ${buf.length}\0`).update(buf).digest('hex');

// Test-Spiel (wie in start-frame.test.js): Taste „f“ öffnet den Feedback-Dialog.
const GAME_JS = `
window.__g = { ready: false };
document.addEventListener('keydown', function (e) {
  if (e.key === 'f') window.parent.postMessage({ type: 'aether:feedback', subject: 'Betreff', body: 'Text' }, '*');
});
window.__g.ready = true;`;
const GAME_HTML = `<!doctype html><html lang=de><head><meta charset=utf-8><title>Test</title></head>
<body><canvas id=canvas tabindex=0></canvas><script src="spiel.js"></script></body></html>`;
const GAME_FILES = { 'index.html': Buffer.from(GAME_HTML), 'spiel.js': Buffer.from(GAME_JS) };
const blobs = new Map();
for (const buf of Object.values(GAME_FILES)) blobs.set(gitSha(buf), buf);

// n Builds, neuester zuerst; alle mit denselben (kleinen) Spieldateien.
function makeBuilds(n, prefix = '') {
  return Array.from({ length: n }, (_, i) => {
    const short = (prefix + String(i + 1).padStart(2, '0') + 'b'.repeat(7)).slice(0, 7);
    return { commit: short + '0'.repeat(33), short, message: `Build ${i + 1}`, date: new Date(Date.UTC(2026, 10, 10, 12) - i * 3600e3).toISOString(), path: `builds/${short}/` };
  });
}
// Gemergte PRs (neueste zuerst), Tage rückwärts ab start.
function makePulls(n, first, startDay = 28) {
  return Array.from({ length: n }, (_, i) => ({
    number: first - i, title: `PR ${first - i}`, state: 'closed', base: { ref: 'main' },
    merged_at: new Date(Date.UTC(2026, 9, startDay, 12) - i * 3600e3).toISOString(), merge_commit_sha: sha((i % 9) + 1)
  }));
}
function roadmap(erledigt = 12, extra = '') {
  const items = Array.from({ length: erledigt }, (_, i) => `- [x] Erledigter Punkt ${i + 1} (PR #${i + 1})`).join('\n');
  return `# Roadmap\n\n## Erledigt\n${items}\n\n## Als Nächstes\n- [x] Fast fertig\n- [ ] Offen 1\n\n## Danach (laut Engine-Plan)\n- [ ] Physik\n\n## Für später\n- [ ] Vulkan${extra}\n`;
}

const RUN = { id: 9001, run_number: 57, name: 'Build', head_branch: 'main', head_sha: '0abc1234def5678900000000000000000000beef', event: 'push',
  display_title: 'Test', head_commit: { message: 'Test' }, status: 'completed', conclusion: 'success',
  created_at: '2026-11-05T10:01:00Z', run_started_at: '2026-11-05T10:01:05Z', updated_at: '2026-11-05T10:07:30Z' };
const YAML = 'name: Build\non: push\njobs:\n  build:\n    name: build\n    timeout-minutes: 15\n    steps:\n      - name: Bauen\n        run: echo\n';
const JOBS = [{ id: 1, name: 'build', status: 'completed', conclusion: 'success', started_at: '2026-11-05T10:01:05Z', completed_at: '2026-11-05T10:05:05Z', steps: [] }];

const mock = {
  reset() {
    Object.assign(this, { builds: makeBuilds(2), pulls: makePulls(5, 50), dashPulls: [], roadmap: roadmap(), mode: 'ok', requests: [], hold: false, held: [] });
  },
  release() { this.hold = false; const h = this.held; this.held = []; h.forEach((go) => go()); }
};
mock.reset();

const CORS = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset' };
const RATE = () => ({ 'x-ratelimit-limit': '5000', 'x-ratelimit-remaining': '4990', 'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 1800) });
const json = (route, status, body) => route.fulfill({ status, headers: { ...CORS, ...RATE(), 'content-type': 'application/json' }, body: JSON.stringify(body) });
const raw = (route, body, type = 'application/vnd.github.raw+json') => route.fulfill({ status: 200, headers: { ...CORS, ...RATE(), 'content-type': type }, body });

async function githubApi(route) {
  const req = route.request();
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') {
    return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  }
  const url = new URL(req.url());
  const p = decodeURIComponent(url.pathname);
  mock.requests.push(p + url.search);
  if (mock.hold) await new Promise((go) => mock.held.push(go));
  if (mock.mode === 'offline') return route.abort('internetdisconnected');
  if (mock.mode === 'error') return json(route, 500, { message: 'Server Error' });
  if (p === `${DASH_BASE}/pulls`) return json(route, 200, mock.dashPulls);
  if (headers.authorization !== `Bearer ${TOKEN}`) return json(route, 401, { message: 'Bad credentials' });
  if (p === `${BASE}/contents/index.json`) return raw(route, JSON.stringify(mock.builds));
  const b = mock.builds.find((x) => p === `${BASE}/contents/${x.path.replace(/\/$/, '')}`);
  if (b) return json(route, 200, Object.entries(GAME_FILES).map(([name, buf]) => ({ name, path: b.path + name, sha: gitSha(buf), size: buf.length, type: 'file' })));
  const m = /\/git\/blobs\/([0-9a-f]{40})$/.exec(p);
  if (m && blobs.has(m[1])) return raw(route, blobs.get(m[1]), 'application/octet-stream');
  if (p === `${BASE}/actions/workflows`) return json(route, 200, { total_count: 1, workflows: [{ id: 42, name: 'Build', path: '.github/workflows/build.yml', state: 'active' }] });
  if (p === `${BASE}/actions/workflows/42/runs`) return json(route, 200, { total_count: 1, workflow_runs: [RUN] });
  if (/\/actions\/runs\/\d+\/jobs$/.test(p)) return json(route, 200, { total_count: 1, jobs: JOBS });
  if (p === `${BASE}/contents/.github/workflows/build.yml`) return raw(route, YAML);
  if (p === `${BASE}/pulls`) return json(route, 200, mock.pulls);
  if (p === `${BASE}/commits`) return json(route, 200, []);
  if (p === `${BASE}/contents/ROADMAP.md`) return raw(route, mock.roadmap);
  return json(route, 404, { message: 'Not Found' });
}

// ---------------------------------------------------------------------------
// Statischer Server. index.html bekommt die Versionsmarke server.version (wie pages.yml mit GITHUB_SHA);
// server.navVersion (falls gesetzt) gilt nur für Seitenaufrufe (sec-fetch-dest: document), z. B. um
// eine CDN-Verzögerung nachzustellen. server.docLoads zählt die Seitenaufrufe von index.html.
// ---------------------------------------------------------------------------
const srv = { version: 'v1', navVersion: null, docLoads: 0, base: '' };
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript', '.woff': 'font/woff', '.ttf': 'font/ttf' };
let server, browser;

async function start() {
  server = http.createServer((req, res) => {
    let p = path.normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    const file = path.join(ROOT, p);
    if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('nope'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] || 'application/octet-stream', 'cache-control': 'no-cache' });
    if (p === 'index.html') {
      const nav = req.headers['sec-fetch-dest'] === 'document';
      if (nav) srv.docLoads++;
      const v = nav && srv.navVersion ? srv.navVersion : srv.version;
      return res.end(fs.readFileSync(file, 'utf8').replace('__AETHER_VERSION__', v));
    }
    fs.createReadStream(file).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  srv.base = `http://localhost:${server.address().port}/`;
  browser = await chromium.launch();
}
async function stop() {
  await browser?.close();
  await new Promise((r) => server.close(r));
}

// opts: device, viewport, auto (AETHER_TEST_AUTO_MS), minGap (AETHER_TEST_AUTO_MIN_MS),
// versionStart (AETHER_TEST_VERSION_START_MS), noSw (Service Worker blockieren), withToken (Standard true)
async function newPage(opts = {}) {
  const dev = opts.device ? { ...devices[opts.device] } : { viewport: opts.viewport || { width: 1180, height: 820 } };
  const context = await browser.newContext({ ...dev, locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: opts.noSw ? 'block' : 'allow' });
  const page = await context.newPage();
  const log = { errors: [], dialogs: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('dialog', (d) => { log.dialogs.push(d.message()); d.accept(); });
  await context.route('https://api.github.com/**', githubApi);
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  await context.addInitScript((o) => {
    if (window !== window.top) return;
    if (o.withToken !== false) localStorage.setItem('aether.githubToken', o.token);
    if (typeof o.auto === 'number') window.AETHER_TEST_AUTO_MS = o.auto;
    if (typeof o.minGap === 'number') window.AETHER_TEST_AUTO_MIN_MS = o.minGap;
    if (typeof o.versionStart === 'number') window.AETHER_TEST_VERSION_START_MS = o.versionStart;
  }, { token: TOKEN, withToken: opts.withToken, auto: opts.auto, minGap: opts.minGap, versionStart: opts.versionStart });
  return { context, page, log };
}

async function waitProjectLoaded(page) {
  await page.waitForFunction(() => ['ciBody', 'timelineBody', 'roadmapBody', 'engineBody']
    .every((id) => { const b = document.getElementById(id); return b.firstChild && !b.querySelector('.loadline'); })
    && !document.querySelector('#timelineList[data-dash="loading"]') && !document.getElementById('projReload').disabled);
}
async function openProject(page, url = '') {
  await page.goto(srv.base + url);
  await page.click('#tabProject');
  await page.waitForSelector('#projectView:not([hidden])');
  await waitProjectLoaded(page);
}
async function openBuilds(page) {
  await page.goto(srv.base);
  await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
}
// Sichtbarkeit der Seite nachstellen (Playwright-Seiten sind immer „visible“).
async function setVisibility(page, state) {
  await page.evaluate((s) => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => s });
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => s !== 'visible' });
    document.dispatchEvent(new Event('visibilitychange'));
  }, state);
}
// Start-Rahmen antippen und warten, bis das Spiel läuft.
async function startGame(page) {
  const handle = await page.waitForSelector('#game.slot:not([hidden]) iframe');
  const frame = await handle.contentFrame();
  await frame.waitForSelector('#aetherStart:not([disabled])');
  await frame.click('#aetherStart');
  await frame.waitForFunction(() => window.__g && window.__g.ready);
  await page.waitForFunction(() => document.documentElement.classList.contains('playing') && !document.getElementById('game').classList.contains('slot'));
  return frame;
}
// Tippfläche und Sichtbarkeit eines Elements.
const rectOf = (page, sel) => page.$eval(sel, (e) => { const r = e.getBoundingClientRect(); return { w: r.width, h: r.height, top: r.top, bottom: r.bottom, visible: r.width > 0 && r.height > 0 }; });

module.exports = { ROOT, OUT, TOKEN, BASE, DASH_BASE, mock, srv, start, stop, newPage, openProject, openBuilds, waitProjectLoaded, setVisibility, startGame, rectOf, makeBuilds, makePulls, roadmap, sha };
