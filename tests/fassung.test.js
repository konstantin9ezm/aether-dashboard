// Umschalter „Fassung: Entwickler | Playtester“ in der Build-Liste (seit aether PR #68 legt die CI je Build
// builds/<hash>/ und playtester/<hash>/ ab; index.json führt die Playtester-Fassung im Feld "playtester").
// Standard, Speichern/Wiederherstellen (localStorage "aether.fassung"), Ausgrauen auch unter „Ältere Builds“,
// Sprung der Auswahl, gesperrter Start, Pfad beim Laden, Beschriftung im Start-Rahmen, „gespeichert“ je
// Fassung, Obergrenze je Fassung, Offline, vorhandener gespeicherter Entwickler-Build.
// Aufruf: node --test tests/fassung.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./mock-dashboard');
const { mock } = H;

before(H.start);
after(H.stop);

const KEY = 'aether.fassung';
// 5 Builds (neuester zuerst): nur die neuesten zwei haben eine Playtester-Fassung (wie nach aether PR #68).
function buildsMitPlaytester(nMitPt = 2, n = 5) {
  return H.makeBuilds(n).map((b, i) => (i < nMitPt ? { ...b, playtester: `playtester/${b.short}/` } : b));
}
const S = H.makeBuilds(5).map((b) => b.short); // ['01bbbbb', '02bbbbb', …]

async function rows(page) {
  return page.$$eval('#buildList .build', (els) => els.map((e) => ({
    short: e.querySelector('code').textContent,
    checked: e.querySelector('input').checked,
    disabled: e.querySelector('input').disabled,
    unavailable: e.classList.contains('unavailable'),
    hint: (e.querySelector('.meta .no-variant') || {}).textContent || '',
    saved: !!e.querySelector('.badge.saved'),
    opacity: Number(getComputedStyle(e).opacity),
    hidden: e.closest('li').hidden
  })));
}
const pressed = (page) => page.evaluate(() => ({
  entwickler: document.getElementById('fassungEntwickler').getAttribute('aria-pressed'),
  playtester: document.getElementById('fassungPlaytester').getAttribute('aria-pressed')
}));
const stored = (page) => page.evaluate((k) => localStorage.getItem(k), KEY);
// Beschriftung des Start-Rahmens (aus dem srcdoc, ohne in den Rahmen zu greifen), oder null ohne Rahmen.
const frameLabel = (page) => page.evaluate(() => {
  const f = document.querySelector('#game iframe');
  if (!f) return null;
  const m = /data-fassung="([^"]*)"/.exec(f.getAttribute('srcdoc') || '');
  return { title: f.getAttribute('title'), fassung: m ? m[1] : '' };
});
// Umschalten und warten, bis Liste und Start-Rahmen nachgeführt sind. gesperrt = true: kein startbarer Build
// erwartet (dann: kein Rahmen, #playOff und Hinweis sichtbar), sonst ein Rahmen mit der neuen Beschriftung.
// (Nur auf „#playOff sichtbar“ zu warten reicht nicht: Ohne Rahmen ist das schon vor dem Neuzeichnen wahr.)
async function switchTo(page, f, gesperrt = false) {
  const text = f === 'playtester' ? 'Playtester-Fassung' : 'Entwickler-Fassung';
  await page.click(f === 'playtester' ? '#fassungPlaytester' : '#fassungEntwickler');
  await page.waitForFunction(([t, g]) => {
    const fr = document.querySelector('#game iframe');
    if (g) return !fr && !document.getElementById('playOff').hidden && !document.getElementById('fassungHint').hidden;
    return !!fr && (fr.getAttribute('srcdoc') || '').includes('data-fassung="' + t + '"');
  }, [text, gesperrt]);
}
async function exitGame(page) {
  await page.click('#exitBtn');
  await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
}
// Inhalte außer index.json und freigabe.json (die zweite Anfrage beim Laden, seit „Playtester-Updates sammeln“)
const contentReqs = () => mock.requests.filter((r) => /\/contents\//.test(r) && !/index\.json|freigabe\.json/.test(r)).map((r) => r.replace(/^.*\/contents\//, '').replace(/\?.*$/, ''));
const blobReqs = () => mock.requests.filter((r) => /\/git\/blobs\//.test(r)).length;
const cacheIndex = (page) => page.evaluate(() => JSON.parse(localStorage.getItem('aether.cachedBuilds') || '[]'));
async function frameAttrs(page) {
  return page.evaluate(() => {
    const f = document.querySelector('#game iframe');
    return { sandbox: f.getAttribute('sandbox'), allow: f.getAttribute('allow'), referrerpolicy: f.getAttribute('referrerpolicy') };
  });
}
const SANDBOX = { sandbox: 'allow-scripts allow-pointer-lock', allow: 'gamepad *; fullscreen *; autoplay *', referrerpolicy: 'no-referrer' };

describe('Fassung: Umschalter, Speichern, Ausgrauen, Auswahl', () => {
  test('Standard ist „Entwickler“: heutiges Verhalten, Pfad builds/…, Beschriftung im Start-Rahmen', async () => {
    mock.reset();
    mock.builds = buildsMitPlaytester();
    const { context, page, log } = await H.newPage();
    await H.openBuilds(page);
    assert.deepEqual(await pressed(page), { entwickler: 'true', playtester: 'false' });
    assert.equal(await stored(page), null, 'ohne Wahl nichts gespeichert');
    const r = await rows(page);
    assert.deepEqual(r.map((x) => [x.short, x.checked, x.disabled, x.unavailable, x.hint]), [
      [S[0], true, false, false, ''], [S[1], false, false, false, ''], [S[2], false, false, false, ''],
      [S[3], false, false, false, ''], [S[4], false, false, false, '']
    ]);
    assert.ok(await page.isHidden('#fassungHint'));
    assert.deepEqual(await frameLabel(page), { title: `Aether ${S[0]}`, fassung: 'Entwickler-Fassung' });
    assert.deepEqual(contentReqs(), [`builds/${S[0]}`], 'automatisches Speichern lädt die Entwickler-Fassung');

    // Lage und Größe: zwischen „Build wählen“ und der ersten Build-Karte, volle Breite der Liste, ca. 38 px hoch.
    const geo = await page.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const seg = r(document.querySelector('#fassungBox .seg')), box = r(document.getElementById('fassungBox'));
      const list = r(document.getElementById('buildList')), head = r(document.querySelector('#buildsView .card .row'));
      const on = getComputedStyle(document.getElementById('fassungEntwickler'));
      const card = getComputedStyle(document.querySelector('#buildList .build:has(input:checked)'));
      return { h: seg.height, boxLeft: box.left, boxRight: box.right, listLeft: list.left, listRight: list.right,
        afterHead: box.top >= head.bottom - 0.5, beforeList: box.bottom <= list.top + 0.5, border: on.borderTopColor, cardBorder: card.borderTopColor };
    });
    assert.ok(Math.abs(geo.h - 38) <= 1, `Höhe ${geo.h}`);
    assert.ok(Math.abs(geo.boxLeft - geo.listLeft) <= 1 && Math.abs(geo.boxRight - geo.listRight) <= 1, 'volle Breite der Liste');
    assert.ok(geo.afterHead && geo.beforeList, 'zwischen Kopfzeile und erster Build-Karte');
    assert.equal(geo.border, geo.cardBorder, 'aktives Feld mit hellem Rand wie die gewählte Build-Karte');

    mock.requests = [];
    const frame = await H.startGame(page);
    assert.equal(await frame.evaluate(() => window.__g.fassung), undefined, 'Entwickler-Fassung läuft');
    assert.deepEqual(await frameAttrs(page), SANDBOX);
    await page.screenshot({ path: path.join(H.OUT, 'fassung-entwickler.png') });
    await exitGame(page);
    // Schmalste Breite (320 px): Umschalter bleibt in der Karte, kein waagerechter Überlauf.
    await page.setViewportSize({ width: 320, height: 568 });
    // Der Start-Rahmen folgt #playSlot erst nach dem resize-Ereignis; bis dahin warten (Frist 5 s).
    await page.waitForFunction(() => document.documentElement.scrollWidth <= window.innerWidth, null, { timeout: 5000 }).catch(() => {});
    const narrow = await page.evaluate(() => ({
      seg: document.querySelector('#fassungBox .seg').getBoundingClientRect().right,
      list: document.getElementById('buildList').getBoundingClientRect().right,
      over: document.documentElement.scrollWidth - window.innerWidth
    }));
    assert.ok(narrow.seg <= narrow.list + 0.5, `320 px: Umschalter ragt hinaus (${narrow.seg} > ${narrow.list})`);
    assert.ok(narrow.over <= 0, `320 px: waagerechter Überlauf ${narrow.over}px`);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Umschalten speichert in localStorage, Wiederherstellen nach Neuladen, ungültige Werte → Entwickler', async () => {
    mock.reset();
    mock.builds = buildsMitPlaytester();
    const { context, page, log } = await H.newPage();
    await H.openBuilds(page);
    await switchTo(page, 'playtester');
    assert.equal(await stored(page), 'playtester');
    assert.deepEqual(await pressed(page), { entwickler: 'false', playtester: 'true' });

    await page.reload();
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    assert.deepEqual(await pressed(page), { entwickler: 'false', playtester: 'true' }, 'nach Neuladen wiederhergestellt');
    assert.deepEqual(await frameLabel(page), { title: `Aether ${S[0]}`, fassung: 'Playtester-Fassung' });
    assert.deepEqual((await rows(page)).map((x) => x.disabled), [false, false, true, true, true]);

    await switchTo(page, 'entwickler');
    assert.equal(await stored(page), 'entwickler');
    await page.reload();
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    assert.deepEqual(await pressed(page), { entwickler: 'true', playtester: 'false' });

    for (const bad of ['Playtester', 'tester', '', '{"x":1}']) {
      await page.evaluate(([k, v]) => localStorage.setItem(k, v), [KEY, bad]);
      await page.reload();
      await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
      assert.deepEqual(await pressed(page), { entwickler: 'true', playtester: 'false' }, `ungültig „${bad}“ → Entwickler`);
      assert.equal((await frameLabel(page)).fassung, 'Entwickler-Fassung');
    }
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Playtester: Builds ohne Feld sind ausgegraut und nicht wählbar, auch unter „Ältere Builds anzeigen“', async () => {
    mock.reset();
    mock.builds = buildsMitPlaytester();
    const { context, page, log } = await H.newPage();
    await H.openBuilds(page);
    await switchTo(page, 'playtester');
    let r = await rows(page);
    assert.deepEqual(r.map((x) => [x.short, x.checked, x.disabled, x.unavailable, x.hint, x.hidden]), [
      [S[0], true, false, false, '', false],
      [S[1], false, false, false, '', false],
      [S[2], false, true, true, 'keine Playtester-Fassung', false],
      [S[3], false, true, true, 'keine Playtester-Fassung', true],
      [S[4], false, true, true, 'keine Playtester-Fassung', true]
    ]);
    assert.ok(r[2].opacity < 0.6 && r[0].opacity === 1, 'deutlich abgeschwächt');
    // Hinweis rechts in der Meta-Zeile.
    const right = await page.evaluate(() => {
      const meta = document.querySelectorAll('#buildList .build')[2].querySelector('.meta');
      const h = meta.querySelector('.no-variant');
      return Math.abs(meta.getBoundingClientRect().right - h.getBoundingClientRect().right) <= 1;
    });
    assert.ok(right, 'Hinweis rechtsbündig');

    await page.click('#buildsMore');
    r = await rows(page);
    assert.ok(r.every((x) => !x.hidden), 'aufgeklappt');
    assert.deepEqual(r.slice(3).map((x) => [x.disabled, x.unavailable, x.hint]), [[true, true, 'keine Playtester-Fassung'], [true, true, 'keine Playtester-Fassung']]);
    // Antippen ändert die Auswahl nicht.
    for (const s of [S[2], S[4]]) {
      await page.click(`#buildList label:has-text("${s}")`, { force: true });
      assert.equal((await rows(page)).find((x) => x.checked).short, S[0], `${s} nicht wählbar`);
      assert.equal((await frameLabel(page)).title, `Aether ${S[0]}`);
    }
    // Ein Build mit Playtester-Fassung bleibt wählbar.
    await page.click(`#buildList label:has-text("${S[1]}")`);
    await page.waitForFunction((s) => document.querySelector('#game iframe')?.getAttribute('title') === 'Aether ' + s, S[1]);
    await page.screenshot({ path: path.join(H.OUT, 'fassung-playtester.png'), fullPage: true });
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Sprung der Auswahl beim Umschalten; Build mit Playtester-Fassung bleibt gewählt; Sandbox unverändert', async () => {
    mock.reset();
    mock.builds = buildsMitPlaytester();
    const { context, page, log } = await H.newPage();
    await H.openBuilds(page);
    await page.click(`#buildList label:has-text("${S[2]}")`);
    await page.waitForFunction((s) => document.querySelector('#game iframe')?.getAttribute('title') === 'Aether ' + s, S[2]);
    await switchTo(page, 'playtester');
    assert.equal((await rows(page)).find((x) => x.checked).short, S[0], 'springt auf den neuesten Build mit Playtester-Fassung');
    assert.deepEqual(await frameLabel(page), { title: `Aether ${S[0]}`, fassung: 'Playtester-Fassung' });
    assert.deepEqual(await frameAttrs(page), SANDBOX, 'neu aufgebauter Rahmen mit unveränderten Attributen');

    await page.click(`#buildList label:has-text("${S[1]}")`);
    await page.waitForFunction((s) => document.querySelector('#game iframe')?.getAttribute('title') === 'Aether ' + s, S[1]);
    await switchTo(page, 'entwickler');
    assert.equal((await rows(page)).find((x) => x.checked).short, S[1], 'Auswahl bleibt beim Wechsel zurück');
    assert.deepEqual(await frameLabel(page), { title: `Aether ${S[1]}`, fassung: 'Entwickler-Fassung' });
    await switchTo(page, 'playtester');
    assert.equal((await rows(page)).find((x) => x.checked).short, S[1], 'Build mit Playtester-Fassung bleibt gewählt');
    assert.deepEqual(await frameAttrs(page), SANDBOX);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Ohne Build mit Playtester-Fassung: Start gesperrt (#playOff) mit Hinweis', async () => {
    mock.reset();
    mock.builds = buildsMitPlaytester(0);
    const { context, page, log } = await H.newPage();
    await H.openBuilds(page);
    await switchTo(page, 'playtester', true);
    assert.equal(await page.$('#game iframe'), null, 'kein Start-Rahmen');
    assert.ok(await page.isVisible('#playOff'));
    assert.ok(await page.isDisabled('#playOff'));
    const r = await rows(page);
    assert.ok(r.every((x) => x.disabled && x.unavailable && !x.checked && x.hint === 'keine Playtester-Fassung'));
    assert.ok(await page.isVisible('#fassungHint'));
    assert.match(await page.textContent('#fassungHint'), /Noch kein Build mit Playtester-Fassung/);
    // Neuladen: der gesperrte Zustand bleibt, kein Download.
    mock.requests = [];
    await page.reload();
    await page.waitForSelector('#buildsView:not([hidden]) #playOff:not([hidden])');
    assert.equal(blobReqs(), 0, 'nichts geladen');
    assert.deepEqual(contentReqs(), []);
    await switchTo(page, 'entwickler');
    assert.ok(await page.isHidden('#fassungHint'));
    assert.ok(await page.isHidden('#playOff'));
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

describe('Fassung: Laden, Beschriftung, Speicher, Offline', () => {
  test('Richtiger Pfad beim Laden (playtester/…) und Beschriftung im Start-Rahmen', async () => {
    mock.reset();
    mock.builds = buildsMitPlaytester();
    const { context, page, log } = await H.newPage();
    await H.openBuilds(page);
    // Beschriftung im Rahmen selbst: Knopftext „Spielen“, darunter klein die Fassung.
    const look = async () => {
      const h = await page.waitForSelector('#game.slot:not([hidden]) iframe');
      const f = await h.contentFrame();
      await f.waitForSelector('#aetherStart');
      return f.evaluate(() => {
        const b = document.getElementById('aetherStart');
        const a = getComputedStyle(b, '::after');
        return { text: b.textContent, aria: b.getAttribute('aria-label'), after: a.content, size: a.fontSize, dir: getComputedStyle(b).flexDirection };
      });
    };
    assert.deepEqual(await look(), { text: 'Spielen', aria: 'Spielen, Entwickler-Fassung', after: '"Entwickler-Fassung"', size: '12px', dir: 'column' });

    mock.requests = [];
    await switchTo(page, 'playtester');
    assert.deepEqual(await look(), { text: 'Spielen', aria: 'Spielen, Playtester-Fassung', after: '"Playtester-Fassung"', size: '12px', dir: 'column' });
    const frame = await H.startGame(page);
    assert.equal(await frame.evaluate(() => window.__g.fassung), 'playtester', 'Playtester-Fassung läuft');
    assert.deepEqual(contentReqs(), [`playtester/${S[0]}`], 'Dateiliste aus playtester/<hash>/ (GitHub-API, Branch web-build)');
    assert.ok(mock.requests.filter((r) => /\/contents\//.test(r)).every((r) => /[?&]ref=web-build/.test(r)), 'Branch web-build');
    await exitGame(page);

    // Neuladen in der Fassung Playtester: das automatische Speichern nimmt playtester/…, nie builds/….
    await page.evaluate(() => localStorage.removeItem('aether.cachedBuilds'));
    await page.evaluate(async () => caches.delete('aether-builds-v1'));
    mock.requests = [];
    await page.reload();
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    assert.deepEqual(contentReqs(), [`playtester/${S[0]}`]);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('„gespeichert“ je Fassung, Obergrenze 2 je Fassung, vorhandener Entwickler-Eintrag bleibt gespeichert', async () => {
    mock.reset();
    mock.builds = buildsMitPlaytester(3);
    const { context, page, log } = await H.newPage();
    await H.openBuilds(page);
    // Eintrag der Entwickler-Fassung im bisherigen Format (ohne Feld "fassung").
    let idx = await cacheIndex(page);
    assert.deepEqual(idx.map((e) => Object.keys(e).sort()), [['files', 'path', 'short']], 'bisheriges Format');
    assert.deepEqual(idx.map((e) => [e.short, e.path]), [[S[0], `builds/${S[0]}/`]]);
    assert.deepEqual((await rows(page)).map((x) => x.saved), [true, false, false, false, false]);

    // Playtester: derselbe Hash gilt nicht als gespeichert (getrennter Eintrag).
    await switchTo(page, 'playtester');
    assert.deepEqual((await rows(page)).map((x) => x.saved), [false, false, false, false, false]);
    await H.startGame(page);
    await exitGame(page);
    assert.deepEqual((await rows(page)).map((x) => x.saved), [true, false, false, false, false], 'Playtester-Fassung von 01 gespeichert');
    idx = await cacheIndex(page);
    assert.deepEqual(idx.map((e) => [e.short, e.fassung || 'entwickler', e.path]), [
      [S[0], 'playtester', `playtester/${S[0]}/`], [S[0], 'entwickler', `builds/${S[0]}/`]
    ]);
    await switchTo(page, 'entwickler');
    assert.deepEqual((await rows(page)).map((x) => x.saved), [true, false, false, false, false]);

    // Entwickler: 02 und 03 starten → je Fassung höchstens 2 (zuletzt gestarteter + neuester bzw. zuletzt davor).
    for (const s of [S[1], S[2]]) {
      await page.click(`#buildList label:has-text("${s}")`);
      await page.waitForFunction((x) => document.querySelector('#game iframe')?.getAttribute('title') === 'Aether ' + x, s);
      await H.startGame(page);
      await exitGame(page);
    }
    idx = await cacheIndex(page);
    assert.deepEqual(idx.map((e) => [e.short, e.fassung || 'entwickler']), [[S[2], 'entwickler'], [S[1], 'entwickler'], [S[0], 'playtester']],
      'Entwickler: 2 Einträge, Playtester-Eintrag bleibt');
    assert.deepEqual((await rows(page)).map((x) => x.saved), [false, true, true, false, false]);
    await switchTo(page, 'playtester');
    assert.deepEqual((await rows(page)).map((x) => x.saved), [true, false, false, false, false]);
    // Dateien des Playtester-Eintrags liegen weiter im Cache.
    const ok = await page.evaluate(async (shas) => {
      const c = await caches.open('aether-builds-v1');
      const have = (await c.keys()).map((r) => r.url.split('/').pop());
      return shas.every((s) => have.includes(s));
    }, Object.values(H.PT_FILES).map(H.gitSha));
    assert.ok(ok, 'Playtester-Dateien im Cache');

    const cacheNames = await page.evaluate(() => caches.keys());
    assert.ok(cacheNames.includes('aether-builds-v1') && cacheNames.every((n) => ['aether-builds-v1', 'aether-shell-v1'].includes(n)), `Cache-Namen unverändert: ${cacheNames}`);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Vorhandener gespeicherter Entwickler-Build (Eintrag von vor dem Update) bleibt gespeichert und startet ohne Download', async () => {
    mock.reset();
    mock.builds = buildsMitPlaytester();
    const { context, page, log } = await H.newPage();
    await H.openBuilds(page);
    // Stand wie von der bisherigen Version geschrieben: Eintrag { short, path, files }, kein "aether.fassung".
    const files = Object.entries(H.GAME_FILES).map(([name, buf]) => ({ name, sha: H.gitSha(buf), size: buf.length }));
    await page.evaluate(([e]) => {
      localStorage.setItem('aether.cachedBuilds', JSON.stringify([e]));
      localStorage.removeItem('aether.fassung');
    }, [{ short: S[0], path: `builds/${S[0]}/`, files }]);
    mock.requests = [];
    await page.reload();
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    assert.deepEqual((await rows(page)).map((x) => x.saved), [true, false, false, false, false], 'gilt weiter als gespeichert');
    assert.equal(blobReqs(), 0, 'kein Neuladen nötig');
    assert.deepEqual(contentReqs(), []);
    const frame = await H.startGame(page);
    assert.equal(await frame.evaluate(() => window.__g.fassung), undefined);
    assert.equal(blobReqs(), 0, 'Start aus dem lokalen Speicher');
    assert.deepEqual(contentReqs(), [], 'ohne Dateiliste');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Offline: nur gespeicherte Builds der gewählten Fassung sind startbar', async () => {
    mock.reset();
    mock.builds = buildsMitPlaytester();
    const { context, page, log } = await H.newPage();
    await H.openBuilds(page); // Entwickler: 01 automatisch gespeichert
    await page.click(`#buildList label:has-text("${S[1]}")`);
    await switchTo(page, 'playtester');
    await H.startGame(page); // Playtester: 02 gespeichert
    await exitGame(page);
    await switchTo(page, 'entwickler');

    mock.mode = 'offline';
    await context.setOffline(true);
    await page.waitForSelector('#offlineHint:not([hidden])');
    await page.waitForFunction(() => document.querySelectorAll('#buildList .build.unavailable').length > 0);
    let r = await rows(page);
    assert.deepEqual(r.map((x) => [x.short, x.disabled, x.saved]), [[S[0], false, true], [S[1], true, false], [S[2], true, false], [S[3], true, false], [S[4], true, false]]);
    assert.equal(r.find((x) => x.checked).short, S[0]);

    await switchTo(page, 'playtester');
    r = await rows(page);
    assert.deepEqual(r.map((x) => [x.short, x.disabled, x.saved, x.hint]), [
      [S[0], true, false, ''], [S[1], false, true, ''], [S[2], true, false, 'keine Playtester-Fassung'],
      [S[3], true, false, 'keine Playtester-Fassung'], [S[4], true, false, 'keine Playtester-Fassung']
    ]);
    assert.equal(r.find((x) => x.checked).short, S[1], 'gespeicherte Playtester-Fassung gewählt');
    assert.match(await page.textContent('#offlineHint'), /letzte Version 02bbbbb/);
    mock.requests = [];
    const frame = await H.startGame(page);
    assert.equal(await frame.evaluate(() => window.__g.fassung), 'playtester');
    assert.deepEqual(mock.requests, [], 'offline ohne API-Aufruf');
    await exitGame(page);

    // Ohne gespeicherte Playtester-Fassung: Start gesperrt mit Hinweis.
    await page.evaluate(() => {
      const idx = JSON.parse(localStorage.getItem('aether.cachedBuilds') || '[]').filter((e) => e.fassung !== 'playtester');
      localStorage.setItem('aether.cachedBuilds', JSON.stringify(idx));
    });
    await switchTo(page, 'entwickler');
    await switchTo(page, 'playtester', true);
    assert.equal(await page.$('#game iframe'), null);
    assert.ok(await page.isDisabled('#playOff'));
    assert.match(await page.textContent('#fassungHint'), /Keine Playtester-Fassung gespeichert/);
    assert.ok((await rows(page)).every((x) => x.disabled && !x.checked));

    mock.mode = 'ok';
    await context.setOffline(false);
    await page.waitForSelector('#offlineHint', { state: 'hidden' });
    await page.waitForFunction(() => document.querySelectorAll('#buildList .build input:not(:disabled)').length === 2);
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});
