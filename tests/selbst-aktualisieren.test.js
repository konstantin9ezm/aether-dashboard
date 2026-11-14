// Selbst aktualisieren: Daten im Hintergrund (Teil D) und neue Dashboard-Version (Teil E).
// Intervall und Mindestabstand per Test-Schalter verkürzt (AETHER_TEST_AUTO_MS, AETHER_TEST_AUTO_MIN_MS);
// gewartet wird auf Zustände (Protokoll window.__aetherAuto, DOM, Seitenaufrufe), nie eine feste Zeit.
// Aufruf: node --test tests/selbst-aktualisieren.test.js
'use strict';

const { test, before, after, afterEach, describe } = require('node:test');
const assert = require('node:assert/strict');
const H = require('./mock-dashboard');
const { mock, srv, BASE, DASH_BASE } = H;

before(H.start);
after(H.stop);
// Schlägt ein Test fehl, bevor er seinen Kontext schließt, liefe dessen Intervall weiter und verfälschte die
// Anfragezählung der folgenden Tests: daher nach jedem Test alle Kontexte schließen.
afterEach(H.closeAll);

// Protokoll der automatischen Versuche: [{ grund, ergebnis }]; Versionsprüfungen (Teil E) stehen mit grund 'version' darin.
const auto = (page) => page.evaluate(() => window.__aetherAuto.slice());
const daten = (list) => list.filter((x) => x.grund !== 'version');
// Warten, bis n (weitere) Einträge mit diesem Ergebnis im Protokoll stehen.
async function untilAuto(page, ergebnis, n = 1, from = 0) {
  await page.waitForFunction(([e, k, f]) => window.__aetherAuto.slice(f).filter((x) => x.ergebnis === e).length >= k, [ergebnis, n, from], { timeout: 20000 });
}
const autoLen = (page) => page.evaluate(() => window.__aetherAuto.length);
const apiCount = () => mock.requests.length;

// Anfragen je automatischem Neuladen der Projektansicht (Workflow-ID kommt aus dem 30-min-Cache).
const PROJEKT_ANFRAGEN = [
  `${BASE}/actions/workflows/42/runs?branch=main&per_page=1&exclude_pull_requests=true`,
  `${BASE}/actions/workflows/42/runs?branch=main&status=completed&per_page=5&exclude_pull_requests=true`,
  `${BASE}/actions/runs/9001/jobs?filter=latest&per_page=100`,
  `${BASE}/contents/.github/workflows/build.yml?ref=0abc1234def5678900000000000000000000beef`,
  `${BASE}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=50`,
  `${BASE}/commits?sha=main&per_page=50`,
  `${DASH_BASE}/pulls?state=closed&base=main&sort=updated&direction=desc&per_page=50`,
  `${BASE}/contents/ROADMAP.md?ref=main`
].sort();

// Beobachter: „Lade …“-Zeilen, Fehlerkarten oder Meldungen, die während des Tests auftauchen.
async function watchNoise(page) {
  await page.evaluate(() => {
    window.__noise = [];
    new MutationObserver((list) => list.forEach((m) => m.addedNodes.forEach((n) => {
      if (n.nodeType !== 1) return;
      if (n.matches('.loadline, .msg.error, #timelineDashLoading') || n.querySelector('.loadline, .msg.error, #timelineDashLoading')) window.__noise.push(n.className || n.id);
    }))).observe(document.getElementById('app'), { childList: true, subtree: true });
  });
}
const noise = (page) => page.evaluate(() => window.__noise.concat(document.getElementById('message').hidden ? [] : ['#message']));

const uiState = (page) => page.evaluate(() => ({
  rm: [...document.querySelectorAll('#roadmapBody .rm-pfeil')].map((b) => b.getAttribute('aria-expanded')),
  filter: document.querySelector('#timelineFilter button[aria-pressed="true"]').dataset.filter,
  tlShown: [...document.querySelectorAll('#timeline a')].filter((a) => a.getBoundingClientRect().height > 0).length,
  tlBtn: (document.querySelector('#timelineBody .klapp-breit') || {}).id || null,
  ci: document.getElementById('ciMore').getAttribute('aria-expanded'),
  ciHidden: document.getElementById('ciDetails').hidden
}));

describe('Teil D – Daten selbst aktualisieren', () => {
  test('Projektansicht lädt nach dem Intervall neu: Klapp-Zustand, Filter, CI-Details und Scroll-Position bleiben, kein „Lade …“', async () => {
    mock.reset();
    mock.pulls = H.makePulls(10, 50);
    const { context, page, log } = await H.newPage({ device: 'iPhone 13', auto: 400, minGap: 200 });
    await H.openProject(page);
    // Zustand der Sitzung herstellen
    await page.click('#roadmapBody .rm-sec >> nth=0 >> .rm-pfeil');   // „Erledigt“ auf
    await page.click('#roadmapBody .rm-sec >> nth=1 >> .rm-pfeil');   // „Als Nächstes“ zu
    await page.click('#timelineFilter button[data-filter="spiel"]');
    await page.click('#timelineMore');
    await page.click('#ciMore');
    const before = await uiState(page);
    assert.deepEqual(before, { rm: ['true', 'false', 'true', 'true'], filter: 'spiel', tlShown: 10, tlBtn: 'timelineLess', ci: 'true', ciHidden: false });
    await page.evaluate(() => window.scrollTo(0, 700));
    const y = await page.evaluate(() => window.scrollY);
    assert.ok(y > 300, 'Seite ist gescrollt');
    await watchNoise(page);
    // Neue Daten auf GitHub
    mock.roadmap = H.roadmap(12, '\n- [ ] Neuer Punkt aus dem Intervall');
    mock.pulls = [...H.makePulls(1, 60, 29), ...mock.pulls];
    await page.waitForFunction(() => /Neuer Punkt aus dem Intervall/.test(document.getElementById('roadmapBody').textContent) && /PR #60/.test(document.getElementById('timelineBody').textContent), null, { timeout: 20000 });
    const nachher = await uiState(page);
    assert.deepEqual(nachher, { ...before, tlShown: 11 }, 'Klapp-Zustand, Filter, CI-Details bleiben (eine Zeile mehr in der Zeitleiste)');
    assert.equal(await page.evaluate(() => window.scrollY), y, 'Scroll-Position unverändert');
    assert.match(await page.textContent('#roadmapBody .rm-sec >> nth=3'), /0\/2/, 'Zählung aktualisiert');
    assert.deepEqual(await noise(page), [], 'kein „Lade …“, keine Fehlerkarte, keine Meldung');
    // API-Anfragen je automatischem Neuladen: zwischen zwei Abschlüssen genau eine Runde
    const k = (await auto(page)).filter((x) => x.ergebnis === 'geladen').length;
    const r0 = apiCount();
    await untilAuto(page, 'geladen', k + 1);
    const r1 = apiCount();
    await untilAuto(page, 'geladen', k + 2);
    const runde = mock.requests.slice(r1, apiCount()).sort();
    assert.deepEqual(runde, PROJEKT_ANFRAGEN, `Anfragen je Neuladen (${runde.length})`);
    assert.ok(r1 - r0 === PROJEKT_ANFRAGEN.length, `auch die Runde davor: ${r1 - r0}`);
    assert.ok(daten(await auto(page)).every((x) => x.grund === 'intervall'));
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Build-Liste: neuer Build erscheint, Auswahl, Klapp-Zustand, Start-Rahmen und Scroll-Position bleiben; 1 Anfrage je Neuladen', async () => {
    mock.reset();
    mock.builds = H.makeBuilds(6);
    const s = mock.builds.map((b) => b.short);
    const { context, page, log } = await H.newPage({ device: 'iPhone 13', auto: 400, minGap: 200 });
    await H.openBuilds(page);
    await page.click('#buildsMore');
    await page.click(`#buildList label:has-text("${s[4]}")`);
    await page.waitForFunction((x) => document.querySelector('#game.slot iframe')?.getAttribute('title') === 'Aether ' + x, s[4]);
    const iframe = await page.$('#game.slot iframe');
    await page.evaluate(() => window.scrollTo(0, 250));
    const y = await page.evaluate(() => window.scrollY);
    assert.ok(y > 100);
    await watchNoise(page);
    const neu = { ...H.makeBuilds(1, 'n')[0], message: 'Ganz neuer Build', date: '2026-11-11T12:00:00Z' };
    mock.builds = [neu, ...mock.builds];
    await page.waitForFunction((x) => !!document.querySelector(`#buildList input[data-short="${x}"]`), neu.short, { timeout: 20000 });
    assert.equal(await page.$eval('input[name="build"]:checked', (i) => i.dataset.short), s[4], 'Auswahl bleibt');
    assert.equal(await page.$eval('#buildList .build', (l) => l.textContent.includes('neuester')), true);
    assert.equal(await page.$$eval('#buildList li', (ls) => ls.filter((l) => !l.hidden).length), 7, 'bleibt aufgeklappt');
    assert.equal(await page.evaluate(() => window.scrollY), y, 'Scroll-Position unverändert');
    assert.equal(await iframe.evaluate((f) => f.isConnected && f === document.querySelector('#game.slot iframe')), true, 'Start-Rahmen nicht neu erzeugt');
    assert.deepEqual(await noise(page), []);
    // Unveränderte Liste: genau 1 Anfrage (index.json), nichts neu gezeichnet
    const n0 = (await auto(page)).length;
    await untilAuto(page, 'unveraendert', 1, n0);
    const r1 = apiCount();
    const n1 = (await auto(page)).length;
    await untilAuto(page, 'unveraendert', 1, n1);
    assert.deepEqual(mock.requests.slice(r1), [`${BASE}/contents/index.json?ref=web-build`]);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('nicht bei verborgener Seite; bei Rückkehr sofort, aber frühestens nach dem Mindestabstand', async () => {
    mock.reset();
    const { context, page } = await H.newPage({ auto: 250, minGap: 1500 });
    await H.openProject(page);
    await H.setVisibility(page, 'hidden');
    const r0 = apiCount();
    const n0 = await autoLen(page);
    // Verborgen über mehr als den Mindestabstand (7 Intervall-Runden à 250 ms, im Protokoll gezählt)
    await untilAuto(page, 'verborgen', 7, n0);
    assert.equal(apiCount(), r0, 'keine Anfrage, solange die Seite verborgen ist');
    // Rückkehr: sofort neu laden
    const n1 = await autoLen(page);
    await H.setVisibility(page, 'visible');
    await page.waitForFunction((f) => window.__aetherAuto.slice(f).some((x) => x.grund === 'sichtbar'), n1);
    await page.waitForFunction((f) => window.__aetherAuto.slice(f).some((x) => x.grund === 'sichtbar' && x.ergebnis === 'geladen'), n1);
    assert.ok(apiCount() - r0 >= 8, 'Rückkehr hat geladen');
    // Gleich danach noch einmal zurück: zu früh (Mindestabstand), keine Anfrage
    await H.setVisibility(page, 'hidden');
    const r2 = apiCount();
    const n2 = await autoLen(page);
    await H.setVisibility(page, 'visible');
    const e2 = (await auto(page)).slice(n2).filter((x) => x.grund === 'sichtbar');
    assert.deepEqual(e2.map((x) => x.ergebnis), ['zu-frueh']);
    assert.equal(apiCount(), r2);
    await context.close();
  });

  test('Standardwerte: 120 s Intervall, 60 s Mindestabstand – Rückkehr und „online“ kurz nach dem Laden laden nicht', async () => {
    mock.reset();
    // Intervall 1 h (läuft im Test nie), Mindestabstand Standard (60 s)
    const { context, page } = await H.newPage({ auto: 3600000 });
    await H.openProject(page);
    const src = await page.evaluate(() => document.documentElement.outerHTML);
    assert.match(src, /var AUTO_AKTUALISIEREN_MS = 120 \* 1000; \/\/ 0 = aus/);
    assert.match(src, /var AUTO_MIN_ABSTAND_MS = 60 \* 1000;/);
    const r0 = apiCount();
    await H.setVisibility(page, 'hidden');
    await H.setVisibility(page, 'visible');
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    assert.deepEqual(daten(await auto(page)).map((x) => x.grund + ':' + x.ergebnis), ['sichtbar:zu-frueh', 'online:zu-frueh']);
    assert.equal(apiCount(), r0);
    await context.close();
    // Ohne Test-Schalter: kein Protokoll
    const p2 = await H.newPage({});
    await H.openBuilds(p2.page);
    assert.equal(await p2.page.evaluate(() => typeof window.__aetherAuto), 'undefined');
    await p2.context.close();
  });

  test('nie während ein Spiel lädt oder läuft, nie bei offenem Feedback-Dialog; nach dem Schließen sofort einmal', async () => {
    mock.reset();
    mock.builds = H.makeBuilds(2);
    const { context, page, log } = await H.newPage({ auto: 300, minGap: 0 });
    await H.openBuilds(page);
    // Start eines nicht gespeicherten Builds: Dateiliste hängt → Ladeansicht nach dem Tipp im Start-Rahmen
    const s1 = mock.builds[1].short;
    await page.click(`#buildList label:has-text("${s1}")`);
    await page.waitForFunction((x) => document.querySelector('#game.slot iframe')?.getAttribute('title') === 'Aether ' + x, s1);
    const handle = await page.waitForSelector('#game.slot:not([hidden]) iframe');
    const frame = await handle.contentFrame();
    await frame.waitForSelector('#aetherStart:not([disabled])');
    mock.hold = true;
    const nLaden = await autoLen(page);
    await frame.click('#aetherStart');
    await untilAuto(page, 'laedt', 2, nLaden);
    mock.release();
    await frame.waitForFunction(() => window.__g && window.__g.ready);
    await page.waitForFunction(() => document.documentElement.classList.contains('playing'));
    const r0 = apiCount();
    const n0 = await autoLen(page);
    await untilAuto(page, 'spiel', 3, n0);
    // Feedback-Dialog öffnen (Taste „f“ im Spiel)
    await page.focus('#game iframe');
    await frame.press('canvas', 'f');
    await page.waitForSelector('#feedback:not([hidden])');
    const n1 = await autoLen(page);
    await untilAuto(page, 'feedback', 3, n1);
    assert.equal(apiCount(), r0, 'keine Anfrage während Spiel und Dialog');
    assert.ok(daten((await auto(page)).slice(n0)).every((x) => x.ergebnis === 'spiel' || x.ergebnis === 'feedback'));
    await page.click('#fbClose');
    // Spiel schließen → sofort einmal aktualisieren
    const n2 = await autoLen(page);
    await page.click('#exitBtn');
    await page.waitForSelector('#buildsView:not([hidden])');
    await page.waitForFunction((f) => window.__aetherAuto.slice(f).some((x) => x.grund === 'spielende' && x.ergebnis !== 'laeuft'), n2);
    const e = (await auto(page)).slice(n2).find((x) => x.grund === 'spielende' && x.ergebnis !== 'laeuft');
    assert.ok(['unveraendert', 'geladen'].includes(e.ergebnis), `nach dem Spiel: ${e.ergebnis}`);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  for (const mode of ['error', 'offline']) {
    test(`Fehler beim Neuladen (${mode}): vorhandene Daten bleiben, keine Meldung`, async () => {
      mock.reset();
      mock.builds = H.makeBuilds(4);
      const { context, page, log } = await H.newPage({ auto: 300, minGap: 0 });
      await H.openProject(page);
      const html = await page.evaluate(() => ['ciBody', 'timelineBody', 'roadmapBody', 'engineBody'].map((id) => document.getElementById(id).innerHTML));
      const stamp = await page.textContent('#projStamp');
      await watchNoise(page);
      mock.mode = mode;
      const n0 = await autoLen(page);
      // engine-map.json kommt vom eigenen Ursprung und gelingt weiter: „teilweise“
      await untilAuto(page, 'teilweise', 2, n0);
      assert.deepEqual(await page.evaluate(() => ['ciBody', 'timelineBody', 'roadmapBody', 'engineBody'].slice(0, 3).map((id) => document.getElementById(id).innerHTML)), html.slice(0, 3), 'Projektansicht unverändert');
      assert.equal(await page.textContent('#projStamp'), stamp);
      assert.deepEqual(await noise(page), []);
      assert.ok(await page.isHidden('#projOffline'), 'kein Offline-Hinweis');
      assert.ok(await page.isHidden('#offlineHint'));
      // Build-Liste ebenso
      await page.click('#tabPlay');
      await page.waitForSelector('#buildsView:not([hidden])');
      const list = await page.$eval('#buildList', (u) => u.innerHTML);
      const n1 = await autoLen(page);
      await untilAuto(page, 'fehler', 2, n1);
      assert.equal(await page.$eval('#buildList', (u) => u.innerHTML), list, 'Build-Liste unverändert');
      assert.deepEqual(await noise(page), []);
      // Wieder erreichbar: lädt weiter
      mock.mode = 'ok';
      mock.builds = H.makeBuilds(5);
      await page.waitForFunction(() => document.querySelectorAll('#buildList li').length === 5, null, { timeout: 20000 });
      assert.deepEqual(log.errors, []);
      await context.close();
    });
  }
});

// ---------------------------------------------------------------------------
// Teil E – neue Dashboard-Version
// ---------------------------------------------------------------------------
// Auf eine Bedingung im Test-Server warten (Seitenaufrufe zählen), kurz nachgesehen – keine feste Wartezeit.
async function until(cond, label, ms = 20000) {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('Zeitüberschreitung: ' + label);
    await new Promise((r) => setTimeout(r, 20));
  }
}
const version = (page) => page.$eval('meta[name="aether-version"]', (m) => m.content);
// Mit blockiertem Service Worker (serviceWorkers: 'block', nur um Seitenaufrufe zu zählen) meldet Chromium im
// abgeschotteten Spiel-iframe einen SecurityError beim Lesen von navigator.serviceWorker – Folge der Testumgebung.
const echteFehler = (errors) => errors.filter((e) => !/Service worker is disabled because the context is sandboxed/.test(e));
const vlog = (page) => page.evaluate(() => window.__aetherAuto.filter((x) => x.grund === 'version').map((x) => x.ergebnis));
async function untilVersion(page, ergebnis, n = 1) {
  await page.waitForFunction(([e, k]) => window.__aetherAuto.filter((x) => x.grund === 'version' && x.ergebnis === e).length >= k, [ergebnis, n], { timeout: 20000 });
}

describe('Teil E – neue Dashboard-Version', () => {
  test('neue Version → Neuladen ohne Spiel, danach kein weiteres Neuladen', async () => {
    mock.reset();
    srv.version = 'v1'; srv.navVersion = null; srv.docLoads = 0;
    const { context, page, log } = await H.newPage({ auto: 300, minGap: 0, versionStart: 0, noSw: true });
    await H.openBuilds(page);
    assert.equal(await version(page), 'v1');
    await untilVersion(page, 'gleich', 2);
    assert.equal(srv.docLoads, 1);
    srv.version = 'v2';
    await until(() => srv.docLoads === 2, 'Neuladen');
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    assert.equal(await version(page), 'v2');
    await untilVersion(page, 'gleich', 3);
    assert.equal(srv.docLoads, 2, 'genau ein automatisches Neuladen');
    assert.deepEqual(await page.evaluate(() => Object.keys(sessionStorage)), ['aether.versionNeugeladen'], 'nur der Merker gegen Kreislauf');
    assert.deepEqual(echteFehler(log.errors), []);
    await context.close();
  });

  test('kein Kreislauf: liefert der Seitenaufruf weiter die alte Version, wird nur einmal neu geladen', async () => {
    mock.reset();
    srv.version = 'v2'; srv.navVersion = 'v1'; srv.docLoads = 0;
    const { context, page } = await H.newPage({ auto: 250, minGap: 0, versionStart: 0, noSw: true });
    await page.goto(srv.base);
    await until(() => srv.docLoads === 2, 'ein Neuladen');
    await page.waitForSelector('#buildsView:not([hidden])');
    await untilVersion(page, 'schon-neugeladen', 4);
    assert.equal(srv.docLoads, 2, 'kein weiteres Neuladen');
    assert.equal(await version(page), 'v1');
    srv.navVersion = null;
    await context.close();
  });

  test('mit laufendem Spiel (und Feedback-Dialog) erst nach dem Schließen neu laden', async () => {
    mock.reset();
    srv.version = 'v1'; srv.navVersion = null; srv.docLoads = 0;
    const { context, page } = await H.newPage({ auto: 300, minGap: 0, versionStart: 0, noSw: true });
    await H.openBuilds(page);
    const frame = await H.startGame(page);
    srv.version = 'v2';
    await untilVersion(page, 'wartet', 2);
    await page.focus('#game iframe');
    await frame.press('canvas', 'f');
    await page.waitForSelector('#feedback:not([hidden])');
    const w = (await vlog(page)).filter((x) => x === 'wartet').length;
    await untilVersion(page, 'wartet', w + 2);
    assert.equal(srv.docLoads, 1, 'nicht während des Spiels');
    await page.click('#fbClose');
    await untilVersion(page, 'wartet', w + 3);
    assert.equal(srv.docLoads, 1, 'Spiel läuft noch');
    await page.click('#exitBtn');
    await until(() => srv.docLoads === 2, 'Neuladen nach dem Schließen');
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.equal(await version(page), 'v2');
    await context.close();
  });

  test('Texteingabefeld mit Fokus (Token): erst nach dem Verlassen des Felds', async () => {
    mock.reset();
    srv.version = 'v1'; srv.navVersion = null; srv.docLoads = 0;
    const { context, page } = await H.newPage({ auto: 300, minGap: 0, versionStart: 0, noSw: true, withToken: false });
    await page.goto(srv.base);
    await page.waitForSelector('#tokenView:not([hidden])');
    await page.focus('#tokenInput');
    await page.keyboard.type('github_pat_');
    srv.version = 'v2';
    await untilVersion(page, 'wartet', 2);
    assert.equal(srv.docLoads, 1);
    await page.click('#tokenView h2');
    await until(() => srv.docLoads === 2, 'Neuladen nach dem Verlassen');
    await context.close();
  });

  test('Screen-Editor und Logo-Seite laden nicht automatisch neu', async () => {
    mock.reset();
    srv.version = 'v1'; srv.navVersion = null; srv.docLoads = 0;
    const { context, page } = await H.newPage({ auto: 300, minGap: 0, versionStart: 0, noSw: true });
    await H.openBuilds(page);
    const editors = [];
    for (const f of ['screen-editor.html', 'logo.html']) {
      const p = await context.newPage();
      await p.goto(srv.base + f);
      await p.evaluate(() => { window.__marke = 'ungespeichert'; });
      editors.push(p);
    }
    srv.version = 'v2';
    await until(() => srv.docLoads === 2, 'Hauptseite lädt neu');
    for (const p of editors) {
      await H.setVisibility(p, 'hidden');
      await H.setVisibility(p, 'visible');
      await p.evaluate(() => window.dispatchEvent(new Event('online')));
    }
    // Hauptseite prüft weiter (gleich), die Editor-Seiten bleiben unverändert offen.
    await page.waitForSelector('#buildsView:not([hidden])');
    await untilVersion(page, 'gleich', 2);
    for (const p of editors) assert.equal(await p.evaluate(() => window.__marke), 'ungespeichert', `${p.url()} nicht neu geladen`);
    for (const f of ['screen-editor.html', 'logo.html']) {
      const src = require('node:fs').readFileSync(require('node:path').join(H.ROOT, f), 'utf8');
      assert.doesNotMatch(src, /aether-version|versionspruefung|location\.reload/, `${f} ohne Versions-Neuladen`);
    }
    await context.close();
  });

  test('mit Service Worker: neue Version landet in der App-Hülle, offline keine Prüfung und keine Fehler', async () => {
    mock.reset();
    srv.version = 'v1'; srv.navVersion = null; srv.docLoads = 0;
    const { context, page, log } = await H.newPage({ auto: 300, minGap: 0, versionStart: 0 });
    await H.openBuilds(page);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.evaluate(() => { window.__marke = 1; });
    srv.version = 'v2';
    await page.waitForFunction(() => !window.__marke && document.querySelector('meta[name="aether-version"]')?.content === 'v2', null, { timeout: 20000 }).catch(async () => {
      // Navigation kann den Kontext zerstören; dann auf die neue Seite warten.
      await page.waitForSelector('meta[name="aether-version"][content="v2"]', { state: 'attached', timeout: 20000 });
    });
    await page.waitForSelector('#buildsView:not([hidden])');
    assert.equal(await version(page), 'v2');
    const shell = await page.evaluate(async () => {
      const c = await caches.open('aether-shell-v1');
      const r = await c.match(location.origin + '/');
      return r ? (await r.text()).match(/name="aether-version" content="([^"]*)"/)[1] : null;
    });
    assert.equal(shell, 'v2', 'App-Hülle enthält die neue Version (offline startbar)');
    const keys = await page.evaluate(async () => (await caches.keys()).sort());
    assert.ok(keys.every((k) => k === 'aether-shell-v1' || k === 'aether-builds-v1'), keys.join(','));
    // Offline: keine Prüfung, keine Fehler
    await context.setOffline(true);
    await H.setVisibility(page, 'hidden');
    await H.setVisibility(page, 'visible');
    await untilVersion(page, 'offline', 1);
    assert.deepEqual(log.errors, []);
    await context.setOffline(false);
    await context.close();
  });
});
