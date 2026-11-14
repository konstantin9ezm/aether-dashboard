// Ein- und Ausklappen: Fortschritt (Teil A), Build-Liste (Teil B), Zeitleiste (Teil C).
// Startzustand bei jedem Laden, kein Speichern, Tastatur, Tippflächen, „Einklappen“ am Listenende.
// Aufruf: node --test tests/klappen.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./mock-dashboard');
const { mock, srv } = H;

before(H.start);
after(H.stop);

const storageKeys = (page) => page.evaluate(() => ({ local: Object.keys(localStorage).sort(), session: Object.keys(sessionStorage).sort() }));
const noOverflow = async (page, label) => {
  const o = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  assert.ok(o <= 0, `waagerechter Überlauf (${label}): ${o}px`);
};

// ---------------------------------------------------------------------------
// Teil A – Fortschritt
// ---------------------------------------------------------------------------
const sections = (page) => page.$$eval('#roadmapBody .rm-sec', (ds) => ds.map((d) => {
  const b = d.querySelector('.rm-head .rm-pfeil');
  const r = b.getBoundingClientRect();
  const m = new DOMMatrix(getComputedStyle(b, '::before').transform);
  const ul = d.querySelector('.rm-items');
  return {
    name: d.querySelector('.rm-head .name').textContent, num: d.querySelector('.rm-head .num').textContent,
    tag: b.tagName, expanded: b.getAttribute('aria-expanded'), label: b.getAttribute('aria-label'), controls: b.getAttribute('aria-controls') === ul.id,
    w: Math.round(r.width), h: Math.round(r.height), left: r.left - d.getBoundingClientRect().left,
    // rotate(-45deg) → Pfeil nach rechts (›), rotate(45deg) → nach unten (⌄)
    dir: m.b < -0.5 ? 'rechts' : m.b > 0.5 ? 'unten' : '?',
    open: !ul.hidden && ul.getBoundingClientRect().height > 0,
    unten: [...d.querySelectorAll('.klapp-breit')].filter((k) => k.getBoundingClientRect().height > 0).map((k) => k.textContent)
  };
}));

describe('Teil A – Fortschritt', () => {
  for (const device of [null, 'iPhone 13']) {
    test(`„Erledigt“ startet zu, Pfeil-Knöpfe ≥ 44 × 44 in allen Abschnitten (${device || 'Desktop'})`, async () => {
      mock.reset();
      const { context, page, log } = await H.newPage({ device });
      await H.openProject(page);
      const s = await sections(page);
      assert.deepEqual(s.map((x) => [x.name, x.num]), [['Erledigt', '12/12'], ['Als Nächstes', '1/2'], ['Danach (laut Engine-Plan)', '0/1'], ['Für später', '0/1']], 'Zählung unverändert');
      assert.deepEqual(s.map((x) => [x.expanded, x.dir, x.open]), [['false', 'rechts', false], ['true', 'unten', true], ['true', 'unten', true], ['true', 'unten', true]]);
      for (const x of s) {
        assert.equal(x.tag, 'BUTTON');
        assert.ok(x.w >= 44 && x.h >= 44, `${x.name}: ${x.w}x${x.h}`);
        assert.ok(x.left < 20, `${x.name}: Pfeil links im Kopf`);
        assert.ok(x.controls, 'aria-controls zeigt auf die Liste');
        assert.equal(x.label, `Abschnitt „${x.name}“`);
        assert.deepEqual(x.unten, [], `${x.name}: kein Einklappen-Knopf sichtbar`);
      }
      assert.match(await page.textContent('#roadmapBody .rm-total'), /13 \/ 16 erledigt/, 'Gesamtfortschritt unverändert');
      // PR-Links bleiben (auch im zugeklappten Abschnitt im DOM)
      assert.equal(await page.$$eval('#roadmapBody .rm-sec >> nth=0 >> a.pr-link', (a) => a.length), 12);
      await noOverflow(page, device || 'Desktop');
      await page.screenshot({ path: path.join(H.OUT, `klappen-fortschritt-${device ? 'iphone' : 'desktop'}.png`), fullPage: true });
      assert.deepEqual(log.errors, []);
      await context.close();
    });
  }

  test('Kopf antippen, Tastatur, „Einklappen“ am Ende nur bei „Erledigt“, Scrollen zum Kopf, nach Neuladen wieder zu, nichts gespeichert', async () => {
    mock.reset();
    mock.roadmap = H.roadmap(40);
    const { context, page, log } = await H.newPage({ device: 'iPhone 13' });
    await H.openProject(page);
    const keysBefore = await storageKeys(page);
    // Ganzer Kopf antippbar (hier: auf den Titel)
    await page.click('#roadmapBody .rm-sec >> nth=0 >> .rm-head .name');
    let s = await sections(page);
    assert.deepEqual([s[0].expanded, s[0].dir, s[0].open], ['true', 'unten', true]);
    assert.deepEqual(s[0].unten, ['Einklappen'], 'Einklappen am Listenende von „Erledigt“');
    assert.deepEqual(s.slice(1).map((x) => x.unten), [[], [], []], 'kurze Abschnitte ohne Einklappen-Knopf');
    const k = await H.rectOf(page, '#roadmapBody .rm-sec >> nth=0 >> .klapp-breit');
    assert.ok(k.h >= 44 && k.w >= 200, `breiter Knopf ${k.w}x${k.h}`);
    assert.equal(await page.getAttribute('#roadmapBody .rm-sec >> nth=0 >> .klapp-breit', 'aria-expanded'), 'true');
    // Einklappen am Ende: Kopf liegt danach oben außerhalb → wird sichtbar gescrollt.
    await page.$eval('#roadmapBody .rm-sec >> nth=0 >> .klapp-breit', (b) => b.scrollIntoView({ block: 'end' }));
    assert.ok((await H.rectOf(page, '#roadmapBody .rm-sec >> nth=0 >> .rm-head')).bottom < 0, 'Kopf vorher außer Sicht');
    await page.click('#roadmapBody .rm-sec >> nth=0 >> .klapp-breit');
    s = await sections(page);
    assert.deepEqual([s[0].expanded, s[0].dir, s[0].open], ['false', 'rechts', false]);
    const head = await H.rectOf(page, '#roadmapBody .rm-sec >> nth=0 >> .rm-head');
    const vh = await page.evaluate(() => innerHeight);
    assert.ok(head.top >= 0 && head.bottom <= vh, `Kopf sichtbar: ${head.top}..${head.bottom} von ${vh}`);
    assert.equal(await page.evaluate(() => document.activeElement.className), 'rm-pfeil', 'Fokus auf dem Pfeil-Knopf');
    // Tastatur: Enter und Leertaste auf dem Pfeil-Knopf
    await page.focus('#roadmapBody .rm-sec >> nth=1 >> .rm-pfeil');
    await page.keyboard.press('Enter');
    assert.equal((await sections(page))[1].expanded, 'false');
    await page.keyboard.press('Space');
    assert.equal((await sections(page))[1].expanded, 'true');
    await page.keyboard.press('Tab');
    await page.keyboard.press('Shift+Tab');
    assert.equal(await page.evaluate(() => document.activeElement.className), 'rm-pfeil', 'per Tab erreichbar');
    // Öffnen per Pfeil-Knopf
    await page.click('#roadmapBody .rm-sec >> nth=0 >> .rm-pfeil');
    assert.equal((await sections(page))[0].expanded, 'true');
    // Kein Speicher: keine neuen Schlüssel, nach Neuladen wieder zu
    assert.deepEqual(await storageKeys(page), keysBefore, 'keine neuen Speicher-Schlüssel');
    await page.reload();
    await page.click('#tabProject');
    await H.waitProjectLoaded(page);
    s = await sections(page);
    assert.deepEqual(s.map((x) => x.expanded), ['false', 'true', 'true', 'true'], 'nach Neuladen wieder Startzustand');
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});


// ---------------------------------------------------------------------------
// Teil B – Build-Liste
// ---------------------------------------------------------------------------
const buildRows = (page) => page.$$eval('#buildList .build', (ls) => ls.filter((l) => l.getBoundingClientRect().height > 0).map((l) => {
  const i = l.querySelector('input');
  return l.querySelector('code').textContent + (i.checked ? '*' : '') + ([...l.querySelectorAll('.badge')].map((b) => ' ' + b.textContent).join(''));
}));
const buildsBtn = (page) => page.$$eval('#buildsKlapp button', (bs) => bs.map((b) => ({ id: b.id, text: b.textContent, expanded: b.getAttribute('aria-expanded'), label: b.getAttribute('aria-label'), h: Math.round(b.getBoundingClientRect().height), w: Math.round(b.getBoundingClientRect().width) })));

describe('Teil B – Build-Liste', () => {
  test('7 Builds: 3 sichtbar + „Ältere Builds anzeigen (4)“, aufgeklappt alle + „Einklappen“, Startzustand nach Neuladen', async () => {
    mock.reset();
    mock.builds = H.makeBuilds(7);
    const { context, page, log } = await H.newPage({ device: 'iPhone 13' });
    await H.openBuilds(page);
    const keysBefore = await storageKeys(page);
    const shorts = mock.builds.map((b) => b.short);
    let rows = await buildRows(page);
    assert.equal(rows.length, 3);
    assert.match(rows[0], new RegExp(`^${shorts[0]}\\* neuester gespeichert$`), 'Auswahl und Abzeichen unverändert');
    assert.deepEqual(rows.slice(1), [shorts[1], shorts[2]]);
    let btn = await buildsBtn(page);
    assert.equal(btn.length, 1);
    assert.deepEqual([btn[0].id, btn[0].text, btn[0].expanded], ['buildsMore', 'Ältere Builds anzeigen (4)', 'false']);
    assert.ok(btn[0].h === 44 && btn[0].w >= (await page.$eval('#buildList', (u) => u.getBoundingClientRect().width)) - 1, `volle Breite, 44 px: ${btn[0].w}x${btn[0].h}`);
    const listW = await page.$eval('#buildList', (u) => Math.round(u.getBoundingClientRect().width));
    assert.equal(btn[0].w, listW, 'volle Listenbreite');
    // Knopf liegt zwischen Liste und „Spielen“
    const order = await page.evaluate(() => {
      const l = document.getElementById('buildList').getBoundingClientRect(), b = document.getElementById('buildsMore').getBoundingClientRect(), s = document.getElementById('playSlot').getBoundingClientRect();
      return l.bottom <= b.top && b.bottom <= s.top;
    });
    assert.ok(order, 'Knopf unter der Liste, über „Spielen“');
    await page.screenshot({ path: path.join(H.OUT, 'klappen-builds-zu.png'), fullPage: true });
    // Tastatur: Tab erreicht den Knopf, Enter klappt auf
    await page.focus('#buildsMore');
    await page.keyboard.press('Enter');
    rows = await buildRows(page);
    assert.equal(rows.length, 7, 'alle Builds');
    btn = await buildsBtn(page);
    assert.deepEqual([btn[0].id, btn[0].text, btn[0].expanded, btn[0].h], ['buildsLess', 'Einklappen', 'true', 44]);
    await page.screenshot({ path: path.join(H.OUT, 'klappen-builds-offen.png'), fullPage: true });
    // Einklappen am Ende: danach Startzustand und „… anzeigen“ sichtbar
    await page.$eval('#buildsLess', (b) => b.scrollIntoView({ block: 'end' }));
    await page.click('#buildsLess');
    assert.equal((await buildRows(page)).length, 3);
    const more = await H.rectOf(page, '#buildsMore');
    const vh = await page.evaluate(() => innerHeight);
    assert.ok(more.top >= 0 && more.bottom <= vh, 'Knopf „Ältere Builds anzeigen“ sichtbar');
    // Start-Rahmen folgt dem verschobenen Knopf „Spielen“
    await page.waitForFunction(() => {
      const s = document.getElementById('playSlot').getBoundingClientRect(), f = document.querySelector('#game.slot iframe').getBoundingClientRect();
      return Math.abs(s.top - f.top) < 1 && Math.abs(s.left - f.left) < 1;
    });
    await noOverflow(page, 'Build-Liste');
    assert.deepEqual(await storageKeys(page), keysBefore, 'kein Speicher für den Klapp-Zustand');
    // Aufklappen, neu laden → wieder zu
    await page.click('#buildsMore');
    await page.reload();
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    assert.equal((await buildRows(page)).length, 3, 'nach Neuladen wieder zugeklappt');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  for (const n of [1, 3]) {
    test(`${n} Build(s): kein Klapp-Knopf`, async () => {
      mock.reset();
      mock.builds = H.makeBuilds(n);
      const { context, page } = await H.newPage({});
      await H.openBuilds(page);
      assert.equal((await buildRows(page)).length, n);
      assert.deepEqual(await buildsBtn(page), []);
      await context.close();
    });
  }

  test('gewählter älterer Build bleibt als 4. Eintrag sichtbar, n zählt ihn nicht; Wechsel auf neuere Auswahl blendet ihn aus', async () => {
    mock.reset();
    mock.builds = H.makeBuilds(6);
    const s = mock.builds.map((b) => b.short);
    const { context, page } = await H.newPage({});
    await H.openBuilds(page);
    await page.click('#buildsMore');
    await page.click(`#buildList label:has-text("${s[4]}")`);
    await page.waitForFunction((x) => document.querySelector('#game.slot iframe')?.getAttribute('title') === 'Aether ' + x, s[4]);
    await page.click('#buildsLess');
    assert.deepEqual(await buildRows(page), [`${s[0]} neuester gespeichert`, s[1], s[2], `${s[4]}*`]);
    assert.equal((await buildsBtn(page))[0].text, 'Ältere Builds anzeigen (2)');
    assert.equal(await page.getAttribute('#game.slot iframe', 'title'), `Aether ${s[4]}`, 'Auswahl und Start-Rahmen bleiben');
    // Auswahl auf einen der 3 neuesten → der 4. Eintrag verschwindet, n zählt wieder alle verborgenen
    await page.click(`#buildList label:has-text("${s[1]}")`);
    assert.deepEqual(await buildRows(page), [`${s[0]} neuester gespeichert`, `${s[1]}*`, s[2]]);
    assert.equal((await buildsBtn(page))[0].text, 'Ältere Builds anzeigen (3)');
    await context.close();
  });
});

// ---------------------------------------------------------------------------
// Teil C – Zeitleiste
// ---------------------------------------------------------------------------
const tlShown = (page) => page.$$eval('#timeline a', (as) => as.filter((a) => a.getBoundingClientRect().height > 0).map((a) => a.querySelector('.num').textContent));
const tlBtn = (page) => page.$$eval('#timelineBody .klapp-breit', (bs) => bs.map((b) => ({ id: b.id, text: b.textContent, expanded: b.getAttribute('aria-expanded'), h: Math.round(b.getBoundingClientRect().height) })));

describe('Teil C – Zeitleiste', () => {
  test('je Filter 3 Einträge + „Ältere anzeigen (n)“, ein Tipp zeigt alle, „Einklappen“, Filterwechsel setzt zurück, nach Neuladen zu', async () => {
    mock.reset();
    mock.pulls = H.makePulls(10, 50);
    mock.dashPulls = H.makePulls(7, 30).map((p) => ({ ...p, merged_at: new Date(Date.parse(p.merged_at) + 1800e3).toISOString() }));
    const { context, page, log } = await H.newPage({ device: 'iPhone 13' });
    await H.openProject(page);
    const keysBefore = await storageKeys(page);
    const cases = [['alle', 17, ['Dashboard · PR #30', 'PR #50', 'Dashboard · PR #29']], ['spiel', 10, ['PR #50', 'PR #49', 'PR #48']], ['dashboard', 7, ['Dashboard · PR #30', 'Dashboard · PR #29', 'Dashboard · PR #28']]];
    for (const [f, n, first3] of cases) {
      await page.click(`#timelineFilter button[data-filter="${f}"]`);
      assert.deepEqual(await tlShown(page), first3, `${f}: die 3 neuesten`);
      assert.deepEqual(await tlBtn(page), [{ id: 'timelineMore', text: `Ältere anzeigen (${n - 3})`, expanded: 'false', h: 44 }]);
      await page.click('#timelineMore');
      const all = await tlShown(page);
      assert.equal(all.length, n, `${f}: ein Tipp zeigt alle`);
      assert.deepEqual(all.slice(0, 3), first3, 'Reihenfolge unverändert');
      assert.deepEqual(await tlBtn(page), [{ id: 'timelineLess', text: 'Einklappen', expanded: 'true', h: 44 }]);
    }
    // Filterwechsel im aufgeklappten Zustand → Startzustand der neuen Filteransicht
    await page.click('#timelineFilter button[data-filter="spiel"]');
    assert.equal((await tlShown(page)).length, 3);
    assert.equal((await tlBtn(page))[0].text, 'Ältere anzeigen (7)');
    // Tastatur
    await page.focus('#timelineMore');
    await page.keyboard.press('Space');
    assert.equal((await tlShown(page)).length, 10);
    // Einklappen am Ende: Knopf „Ältere anzeigen“ danach sichtbar
    await page.$eval('#timelineLess', (b) => b.scrollIntoView({ block: 'end' }));
    await page.click('#timelineLess');
    assert.equal((await tlShown(page)).length, 3);
    const more = await H.rectOf(page, '#timelineMore');
    const vh = await page.evaluate(() => innerHeight);
    assert.ok(more.top >= 0 && more.bottom <= vh, `„Ältere anzeigen“ sichtbar (${more.top}..${more.bottom})`);
    assert.equal(await page.evaluate(() => document.activeElement.id), 'timelineMore');
    await noOverflow(page, 'Zeitleiste');
    await page.screenshot({ path: path.join(H.OUT, 'klappen-zeitleiste.png'), fullPage: true });
    // Kein Speicher; nach Neuladen wieder 3 Einträge (Filter „Alle“)
    await page.click('#timelineMore');
    assert.deepEqual(await storageKeys(page), keysBefore);
    await page.reload();
    await page.click('#tabProject');
    await H.waitProjectLoaded(page);
    assert.equal((await tlShown(page)).length, 3);
    assert.equal((await tlBtn(page))[0].text, 'Ältere anzeigen (14)');
    // Links unverändert (neuer Tab, DB-/PR-Abzeichen)
    const a = await page.$eval('#timeline a', (x) => [x.target, x.rel, x.querySelector('.ic').textContent]);
    assert.deepEqual(a, ['_blank', 'noopener noreferrer', 'DB']);
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('höchstens 3 Einträge: kein Knopf', async () => {
    mock.reset();
    mock.pulls = H.makePulls(3, 10);
    const { context, page } = await H.newPage({});
    await H.openProject(page);
    assert.equal((await tlShown(page)).length, 3);
    assert.deepEqual(await tlBtn(page), []);
    await context.close();
  });
});
