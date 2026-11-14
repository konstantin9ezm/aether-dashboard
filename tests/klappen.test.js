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

