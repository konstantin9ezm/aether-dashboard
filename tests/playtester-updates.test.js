// Playtester-Updates sammeln und veröffentlichen (README): Das Dashboard liest freigabe.json aus web-build (aether,
// Workflow „Playtester-Freigabe“), zeigt in der Fassung „Playtester“ den Kasten „Bei Playtestern: …“ mit den Marken
// FREIGEGEBEN/NEU, in der Fassung „Entwickler“ nur BEI PLAYTESTERN. „Playtester-Fassung updaten ›“ öffnet die Auswahl
// (eine Obergrenze, ältere werden mitgewählt), „Veröffentlichen ›“ kopiert die Kennung und zeigt die Schritte auf GitHub.
// Das Dashboard schreibt nie (nur GET-Anfragen), merkt sich nichts als „freigegeben“.
// Aufruf: node --test tests/playtester-updates.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const H = require('./mock-dashboard');
const { mock } = H;

before(H.start);
after(H.stop);

const WORKFLOW_URL = 'https://github.com/konstantin9ezm/aether/actions/workflows/playtester-freigabe.yml';
const ZEIT = '2026-11-27T13:18:29Z'; // erste echte Freigabe (cb5c0ae): 14:18 Uhr in Berlin

// n Builds (neuester zuerst) mit PR-Nachrichten #(100+n-1) … #100 und Playtester-Fassung; ohne: Stellen ohne Playtester-Fassung.
function builds(n = 6, ohne = []) {
  return H.makeBuilds(n).map((b, i) => {
    const out = { ...b, message: `Merge pull request #${100 + n - 1 - i} from konstantin9ezm/claude/beispiel-${i}\n\nText` };
    if (!ohne.includes(i)) out.playtester = `playtester/${b.short}/`;
    return out;
  });
}
const freigabeVon = (b, zeit = ZEIT) => ({ version: 1, build: b.short, commit: b.commit, zeit, vorheriger: null });

async function seite(opts = {}) {
  const r = await H.newPage(opts);
  if (opts.fassung !== 'entwickler') {
    await r.context.addInitScript(() => { if (window === window.top) localStorage.setItem('aether.fassung', 'playtester'); });
  }
  r.methods = [];
  r.page.on('request', (q) => { if (q.url().startsWith('https://api.github.com/')) r.methods.push(q.method()); });
  return r;
}
const kasten = (page) => page.evaluate(() => {
  const box = document.getElementById('fgBox');
  const t = (id) => { const e = document.getElementById(id); return e.hidden ? null : e.textContent; };
  return {
    hidden: box.hidden, art: box.dataset.art, cls: box.className, stand: t('fgStand'), neu: t('fgNeu'), off: t('fgOff'),
    knopf: document.getElementById('fgUpdate').disabled ? 'gesperrt' : 'aktiv', nur: !document.getElementById('fgNur').hidden
  };
});
// Normale Liste: Kurz-Hash und Marken je Build
const marken = (page) => page.$$eval('#buildList .build', (els) => els.map((e) =>
  [e.querySelector('code').textContent, ...[...e.querySelectorAll('.badge:not(.saved)')].map((b) => b.textContent)].join(' ')));
// Auswahlliste: Kurz-Hash, Kästchen (x = Haken), wählbar (w) bzw. gesperrt (-), Hinweis
const auswahl = (page) => page.$$eval('#fgListe .build', (els) => els.map((e) => {
  const i = e.querySelector('input');
  const hint = e.querySelector('.no-variant');
  return `${i.dataset.short} ${i.checked ? 'x' : 'o'}${i.disabled ? '-' : 'w'}${hint ? ' ' + hint.textContent : ''}`;
}));
const leiste = (page) => page.evaluate(() => ({
  summe: document.getElementById('fgSumme').textContent, bis: document.getElementById('fgBis').textContent,
  veroeffentlichen: document.getElementById('fgVeroeffentlichen').disabled ? 'gesperrt' : 'aktiv'
}));
const tippe = (page, short) => page.click(`#fgListe label:has(input[data-short="${short}"])`, { force: true });
const frei = (page) => page.evaluate(() => [...document.querySelectorAll('#buildList .badge.frei')].map((b) => b.closest('.build').querySelector('code').textContent));
const ladeReqs = () => mock.requests.filter((r) => /\/contents\/(index|freigabe)\.json/.test(r)).map((r) => r.replace(/^.*\/contents\//, '').replace(/\?.*$/, ''));
async function aktualisieren(page) {
  await page.click('#reloadBtn');
  await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
}
async function oeffneAuswahl(page) {
  await page.click('#fgUpdate');
  await page.waitForSelector('#fgAuswahl:not([hidden]) #fgListe .build');
}

describe('Anzeige: Kasten, Zählung, Marken', () => {
  test('Playtester: Kasten mit Freigabe-Uhrzeit (nicht Build-Zeit), 3 neue Updates, Marken FREIGEGEBEN/NEU/NEUESTER', async () => {
    mock.reset();
    mock.builds = builds(6);
    mock.freigabe = freigabeVon(mock.builds[3]);
    const S = mock.builds.map((b) => b.short);
    const { context, page, log, methods } = await seite();
    await H.openBuilds(page);
    assert.deepEqual(await kasten(page), {
      hidden: false, art: 'ok', cls: 'fg-box', stand: `Bei Playtestern: ${S[3]} · PR #102 · freigegeben 27.11., 14:18`,
      neu: '3 neue Updates noch nicht veröffentlicht', off: null, knopf: 'aktiv', nur: false
    });
    // Gegenprobe zur Uhrzeit: der freigegebene Build entstand am 10.11. um 10:00 – das steht nicht im Kasten
    assert.doesNotMatch(await page.textContent('#fgStand'), /10\.11\.|10:00/);
    assert.deepEqual(await marken(page), [`${S[0]} neuester neu`, `${S[1]} neu`, `${S[2]} neu`, `${S[3]} freigegeben`, S[4], S[5]]);
    // Farben aus den vorhandenen Variablen: FREIGEGEBEN grün (--ok), NEU orange (--warn)
    const farben = await page.evaluate(() => ({
      frei: getComputedStyle(document.querySelector('#buildList .badge.frei')).color,
      neu: getComputedStyle(document.querySelector('#buildList .badge.neu')).color,
      ok: getComputedStyle(document.documentElement).getPropertyValue('--ok').trim(),
      warn: getComputedStyle(document.documentElement).getPropertyValue('--warn').trim()
    }));
    assert.equal(farben.frei, 'rgb(74, 222, 128)', `FREIGEGEBEN in --ok (${farben.ok})`);
    assert.equal(farben.neu, 'rgb(251, 191, 36)', `NEU in --warn (${farben.warn})`);
    assert.equal(await page.$eval('#buildList .badge.frei', (b) => getComputedStyle(b).textTransform), 'uppercase');
    // Liste wie bisher: neuester vorausgewählt, Start-Rahmen da
    assert.equal(await page.$eval('input[name="build"]:checked', (i) => i.dataset.short), S[0]);
    assert.ok(await page.$('#game.slot iframe'), 'Start-Rahmen');
    assert.ok(methods.every((m) => m === 'GET'), `nur Lese-Anfragen: ${methods}`);
    await page.screenshot({ path: path.join(H.OUT, 'playtester-updates-1-playtester.png') });
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Einzahl und „Keine neuen Updates“ (Knopf gesperrt), PR aus Squash-Nachricht „… (#n)“', async () => {
    mock.reset();
    mock.builds = builds(3);
    mock.builds[1].message = 'Fast Travel (#77)';
    mock.freigabe = freigabeVon(mock.builds[1]);
    const S = mock.builds.map((b) => b.short);
    const { context, page } = await seite();
    await H.openBuilds(page);
    let k = await kasten(page);
    assert.equal(k.stand, `Bei Playtestern: ${S[1]} · PR #77 · freigegeben 27.11., 14:18`);
    assert.equal(k.neu, '1 neues Update noch nicht veröffentlicht');
    assert.equal(k.knopf, 'aktiv');
    mock.freigabe = freigabeVon(mock.builds[0], '2026-11-28T08:05:00Z');
    await aktualisieren(page);
    k = await kasten(page);
    assert.equal(k.stand, `Bei Playtestern: ${S[0]} · PR #102 · freigegeben 28.11., 09:05`);
    assert.equal(k.neu, 'Keine neuen Updates');
    assert.equal(k.knopf, 'gesperrt');
    assert.deepEqual(await marken(page), [`${S[0]} neuester freigegeben`, S[1], S[2]]);
    await context.close();
  });

  test('Entwickler: unverändert, nur die Marke BEI PLAYTESTERN (grün); kein Kasten', async () => {
    mock.reset();
    mock.builds = builds(6);
    mock.freigabe = freigabeVon(mock.builds[3]);
    const S = mock.builds.map((b) => b.short);
    const { context, page, log } = await seite({ fassung: 'entwickler' });
    await H.openBuilds(page);
    assert.equal((await kasten(page)).hidden, true);
    assert.ok(await page.isVisible('#fassungBox'));
    assert.deepEqual(await marken(page), [`${S[0]} neuester`, S[1], S[2], `${S[3]} bei Playtestern`, S[4], S[5]]);
    assert.equal(await page.$eval('#buildList .badge.frei', (b) => getComputedStyle(b).color), 'rgb(74, 222, 128)');
    const r = await page.$$eval('#buildList input', (is) => is.map((i) => [i.type, i.disabled, i.checked]));
    assert.deepEqual(r, [['radio', false, true], ...Array(5).fill(['radio', false, false])], 'Auswahlkreise wie heute');
    await page.screenshot({ path: path.join(H.OUT, 'playtester-updates-4-entwickler.png') });
    // Umschalten auf Playtester zeigt den Kasten (ohne neue Anfrage)
    const n = mock.requests.length;
    await page.click('#fassungPlaytester');
    await page.waitForSelector('#fgBox:not([hidden])');
    assert.equal(ladeReqs().length, 2);
    assert.ok(mock.requests.slice(n).every((q) => !/freigabe|index\.json/.test(q)), 'Umschalten lädt nichts nach');
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Genau 1 zusätzliche Anfrage pro Laden (freigabe.json, Branch web-build, Rohinhalt), auch bei „Aktualisieren“', async () => {
    mock.reset();
    mock.builds = builds(4);
    mock.freigabe = freigabeVon(mock.builds[2]);
    const { context, page, methods } = await seite();
    const headers = [];
    page.on('request', (q) => { if (/freigabe\.json/.test(q.url())) headers.push(q.headers()); });
    await H.openBuilds(page);
    assert.deepEqual(ladeReqs().sort(), ['freigabe.json', 'index.json']);
    assert.deepEqual(mock.requests.filter((r) => /freigabe/.test(r)), ['/repos/konstantin9ezm/aether/contents/freigabe.json?ref=web-build']);
    assert.equal(headers[0].accept, 'application/vnd.github.raw+json', 'gleicher Lese-Weg wie index.json');
    assert.match(headers[0].authorization, /^Bearer /);
    mock.requests = [];
    await aktualisieren(page);
    assert.deepEqual(ladeReqs().sort(), ['freigabe.json', 'index.json'], '„Aktualisieren“ holt beide frisch');
    assert.equal(mock.requests.length, 2, `sonst nichts (Build schon gespeichert): ${mock.requests}`);
    assert.ok(methods.every((m) => m === 'GET'), 'kein Schreiben, kein Workflow-Aufruf');
    await context.close();
  });
});

describe('Sonderfälle: nicht in der Liste, keine Datei, kaputt, offline', () => {
  test('Freigegebener Build nicht mehr in index.json: Hash mit Zusatz, neu nur Builds nach der Freigabe (Datum)', async () => {
    mock.reset();
    mock.builds = builds(5);
    mock.freigabe = { version: 1, build: 'abcdef1', commit: 'abcdef1' + '0'.repeat(33), zeit: '2026-11-10T10:30:00Z', vorheriger: null };
    const S = mock.builds.map((b) => b.short);
    const { context, page } = await seite();
    await H.openBuilds(page);
    const k = await kasten(page);
    assert.equal(k.stand, 'Bei Playtestern: abcdef1 (nicht mehr in der Liste) · freigegeben 10.11., 11:30');
    assert.equal(k.neu, '2 neue Updates noch nicht veröffentlicht');
    assert.deepEqual(await marken(page), [`${S[0]} neuester neu`, `${S[1]} neu`, S[2], S[3], S[4]]);
    await oeffneAuswahl(page);
    assert.deepEqual(await auswahl(page), [`${S[0]} ow`, `${S[1]} ow`, `${S[2]} o-`, `${S[3]} o-`, `${S[4]} o-`]);
    await tippe(page, S[1]);
    assert.deepEqual(await leiste(page), { summe: '1 Update wird veröffentlicht', bis: `bis #103 · ${S[1]}`, veroeffentlichen: 'aktiv' });
    await context.close();
  });

  test('Keine Freigabe-Datei (404): „automatisch (jeder Merge)“, keine NEU-Marken, Knopf aktiv, erste Freigabe möglich', async () => {
    mock.reset();
    mock.builds = builds(4, [1]);
    mock.freigabe = null;
    const S = mock.builds.map((b) => b.short);
    const { context, page, log } = await seite();
    await H.openBuilds(page);
    const k = await kasten(page);
    assert.equal(k.stand, 'Bei Playtestern: automatisch (jeder Merge)');
    assert.equal(k.art, 'keine');
    assert.equal(k.knopf, 'aktiv');
    assert.deepEqual(await marken(page), [`${S[0]} neuester`, S[1], S[2], S[3]]);
    assert.ok(await page.isHidden('#message'), 'keine Fehlermeldung (404 ist hier normal)');
    await oeffneAuswahl(page);
    assert.deepEqual(await auswahl(page), [`${S[0]} ow`, `${S[1]} o- keine Playtester-Fassung`, `${S[2]} ow`, `${S[3]} ow`]);
    await tippe(page, S[2]);
    assert.deepEqual(await auswahl(page), [`${S[0]} ow`, `${S[1]} o- keine Playtester-Fassung`, `${S[2]} xw`, `${S[3]} xw`]);
    assert.deepEqual(await leiste(page), { summe: '2 Updates werden veröffentlicht', bis: `bis #101 · ${S[2]}`, veroeffentlichen: 'aktiv' });
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Kaputte bzw. unlesbare Freigabe-Datei: „Freigabe-Stand nicht lesbar“ mit Grund, Knopf gesperrt, Liste wie heute', async () => {
    const S = builds(3).map((b) => b.short);
    for (const [inhalt, status, grund] of [
      ['{ "version": 1, "build": ', 200, 'freigabe.json enthält kein gültiges JSON.'],
      [{ version: 2, build: S[1] }, 200, 'freigabe.json hat eine unbekannte Version.'],
      [{ version: 1, build: 'NICHT/OK' }, 200, 'In freigabe.json fehlt eine gültige Build-Kennung.'],
      [{ version: 1, build: S[1] }, 500, 'GitHub hat gerade Probleme (HTTP 500).']
    ]) {
      mock.reset();
      mock.builds = builds(3);
      mock.freigabe = inhalt;
      mock.freigabeStatus = status;
      const { context, page, log } = await seite();
      await H.openBuilds(page);
      const k = await kasten(page);
      assert.equal(k.stand, 'Freigabe-Stand nicht lesbar', grund);
      assert.equal(k.neu, grund);
      assert.equal(k.cls, 'fg-box fehler');
      assert.equal(k.knopf, 'gesperrt');
      assert.deepEqual(await marken(page), [`${S[0]} neuester`, S[1], S[2]], 'keine Freigabe-Marken');
      assert.equal(await page.$eval('input[name="build"]:checked', (i) => i.dataset.short), S[0], 'Liste funktioniert weiter');
      assert.ok(await page.$('#game.slot iframe'), 'Start-Rahmen da');
      assert.ok(await page.isHidden('#message'), 'keine Fehlermeldung über der Liste');
      assert.deepEqual(log.errors, []);
      await context.close();
    }
  });

  test('Offline: letzter Stand mit „offline – Stand von …“, Knopf gesperrt „nur online“; ohne gespeicherten Stand: nicht bekannt', async () => {
    mock.reset();
    mock.builds = builds(4);
    mock.freigabe = freigabeVon(mock.builds[2]);
    const S = mock.builds.map((b) => b.short);
    const { context, page, log } = await seite();
    await H.openBuilds(page);
    const at = await page.evaluate(() => JSON.parse(localStorage.getItem('aether.lastIndex')).freigabe.at);
    const erwartet = new Date(at).toLocaleString('de-DE', { timeZone: 'Europe/Berlin', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
    mock.mode = 'offline';
    await page.reload();
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    await page.waitForSelector('#offlineHint:not([hidden])');
    let k = await kasten(page);
    assert.equal(k.stand, `Bei Playtestern: ${S[2]} · PR #101 · freigegeben 27.11., 14:18`);
    assert.equal(k.neu, '2 neue Updates noch nicht veröffentlicht');
    assert.equal(k.off, `offline – Stand von ${erwartet}`);
    assert.equal(k.knopf, 'gesperrt');
    assert.equal(k.nur, true, '„nur online“');
    assert.deepEqual(await marken(page), [`${S[0]} neuester neu`, `${S[1]} neu`, `${S[2]} freigegeben`, S[3]]);
    await page.click('#fgUpdate', { force: true });
    assert.ok(await page.isHidden('#fgAuswahl'), 'offline keine Auswahl');
    // Ereignis „offline“ während die Seite online war: dieselben Regeln
    mock.mode = 'ok';
    await aktualisieren(page);
    assert.equal((await kasten(page)).knopf, 'aktiv');
    await oeffneAuswahl(page);
    await context.setOffline(true);
    await page.waitForSelector('#fgAuswahl', { state: 'hidden' });
    k = await kasten(page);
    assert.equal(k.knopf, 'gesperrt', 'offline: Auswahl verlassen, Knopf gesperrt');
    assert.match(k.off, /^offline – Stand von \d\d\.\d\d\., \d\d:\d\d$/);
    await context.setOffline(false);
    await page.waitForSelector('#offlineHint', { state: 'hidden' });   // „online“ lädt neu – abwarten, bevor der Speicher geändert wird
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    // Gespeicherte Liste von vor dem Umbau (ohne Freigabe-Stand) und offline
    await page.evaluate(() => { const v = JSON.parse(localStorage.getItem('aether.lastIndex')); delete v.freigabe; localStorage.setItem('aether.lastIndex', JSON.stringify(v)); });
    mock.mode = 'offline';
    await page.reload();
    await page.waitForSelector('#buildsView:not([hidden]) #buildList .build');
    k = await kasten(page);
    assert.equal(k.stand, 'Freigabe-Stand nicht bekannt');
    assert.equal(k.off, 'offline – kein gespeicherter Stand');
    assert.equal(k.knopf, 'gesperrt');
    assert.deepEqual(await marken(page), [`${S[0]} neuester`, S[1], S[2], S[3]]);
    assert.deepEqual(log.errors, []);
    await context.close();
  });
});

describe('Auswahl: Obergrenze, Mitwählen, Abwählen, nicht wählbare Builds', () => {
  test('Auswahlmodus: Kopf statt Umschalter, Kästchen, nichts vorgewählt; Mitwählen und Abwählen; Abbrechen und Esc', async () => {
    mock.reset();
    mock.builds = builds(6, [1]);
    mock.freigabe = freigabeVon(mock.builds[4]);
    const S = mock.builds.map((b) => b.short);
    const { context, page, log, methods } = await seite();
    await H.openBuilds(page);
    assert.equal((await kasten(page)).neu, '3 neue Updates noch nicht veröffentlicht', 'ohne Playtester-Fassung zählt nicht');
    await page.click(`#buildList label:has(input[data-short="${S[2]}"])`);
    await page.waitForFunction((x) => document.querySelector('#game.slot iframe')?.getAttribute('title') === 'Aether ' + x, S[2]);
    const n = mock.requests.length;
    await oeffneAuswahl(page);
    assert.equal(await page.textContent('#fgKopf'), 'Updates für Playtester auswählen');
    for (const sel of ['#fassungBox', '#fgBox', '#buildList', '#playSlot']) assert.ok(await page.isHidden(sel), `${sel} ausgeblendet`);
    assert.equal(await page.$('#game iframe'), null, 'kein Start-Rahmen im Auswahlmodus');
    assert.deepEqual(await page.$$eval('#fgListe input', (is) => [...new Set(is.map((i) => i.type))]), ['checkbox']);
    // Vorauswahl: nichts. Freigegebener (#101) und älter grau mit Haken; ohne Playtester-Fassung grau mit Hinweis.
    assert.deepEqual(await auswahl(page), [`${S[0]} ow`, `${S[1]} o- keine Playtester-Fassung`, `${S[2]} ow`, `${S[3]} ow`, `${S[4]} x-`, `${S[5]} x-`]);
    assert.deepEqual(await leiste(page), { summe: 'Noch kein Update gewählt', bis: 'Build antippen: er und alle älteren neuen Updates', veroeffentlichen: 'gesperrt' });
    assert.equal(await page.textContent('#fgAuswahl .fg-regel'), 'Ein Update enthält immer alle Updates davor. Builds ohne Playtester-Fassung sind nicht wählbar.');
    // Antippen wählt den Build und alle älteren wählbaren bis zum freigegebenen mit
    await tippe(page, S[2]);
    assert.deepEqual(await auswahl(page), [`${S[0]} ow`, `${S[1]} o- keine Playtester-Fassung`, `${S[2]} xw`, `${S[3]} xw`, `${S[4]} x-`, `${S[5]} x-`]);
    assert.deepEqual(await leiste(page), { summe: '2 Updates werden veröffentlicht', bis: `bis #103 · ${S[2]}`, veroeffentlichen: 'aktiv' });
    // Build ohne Playtester-Fassung: nicht antippbar
    await tippe(page, S[1]);
    assert.equal((await auswahl(page))[1], `${S[1]} o- keine Playtester-Fassung`);
    // Neueren antippen: neue Obergrenze, alles darunter gewählt (ohne den Build ohne Playtester-Fassung)
    await tippe(page, S[0]);
    assert.deepEqual(await auswahl(page), [`${S[0]} xw`, `${S[1]} o- keine Playtester-Fassung`, `${S[2]} xw`, `${S[3]} xw`, `${S[4]} x-`, `${S[5]} x-`]);
    assert.deepEqual(await leiste(page), { summe: '3 Updates werden veröffentlicht', bis: `bis #105 · ${S[0]}`, veroeffentlichen: 'aktiv' });
    // Gewählten antippen: er und alle neueren ab
    await tippe(page, S[2]);
    assert.deepEqual(await auswahl(page), [`${S[0]} ow`, `${S[1]} o- keine Playtester-Fassung`, `${S[2]} ow`, `${S[3]} xw`, `${S[4]} x-`, `${S[5]} x-`]);
    assert.deepEqual(await leiste(page), { summe: '1 Update wird veröffentlicht', bis: `bis #102 · ${S[3]}`, veroeffentlichen: 'aktiv' });
    // Freigegebenen antippen: keine Wirkung (der ältere liegt zugeklappt unter „Ältere Builds anzeigen“)
    await tippe(page, S[4]);
    assert.deepEqual(await leiste(page), { summe: '1 Update wird veröffentlicht', bis: `bis #102 · ${S[3]}`, veroeffentlichen: 'aktiv' });
    // Letzten gewählten abwählen: nichts gewählt
    await tippe(page, S[3]);
    assert.equal((await leiste(page)).veroeffentlichen, 'gesperrt');
    // Abbrechen: zurück ohne Änderung (Auswahl in der Liste, Start-Rahmen, Kasten)
    await tippe(page, S[0]);
    await page.click('#fgAbbrechen');
    await page.waitForSelector('#fgAuswahl', { state: 'hidden' });
    assert.ok(await page.isVisible('#fassungBox') && await page.isVisible('#fgBox'));
    assert.equal(await page.$eval('input[name="build"]:checked', (i) => i.dataset.short), S[2], 'gewählter Build bleibt');
    await page.waitForFunction((x) => document.querySelector('#game.slot iframe')?.getAttribute('title') === 'Aether ' + x, S[2]);
    assert.equal((await kasten(page)).neu, '3 neue Updates noch nicht veröffentlicht');
    // Erneut öffnen: wieder nichts vorgewählt; Esc verlässt ebenso
    await oeffneAuswahl(page);
    assert.equal((await leiste(page)).summe, 'Noch kein Update gewählt');
    await tippe(page, S[2]);
    await page.keyboard.press('Escape');
    await page.waitForSelector('#fgAuswahl', { state: 'hidden' });
    assert.ok(await page.isVisible('#fassungBox'));
    assert.equal(mock.requests.length, n, 'Auswahl lädt nichts');
    assert.ok(methods.every((m) => m === 'GET'));
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('„Ältere Builds anzeigen“ in der Auswahl: dieselben Regeln; Obergrenze unter den älteren', async () => {
    mock.reset();
    mock.builds = builds(9);
    mock.freigabe = freigabeVon(mock.builds[6]);
    const S = mock.builds.map((b) => b.short);
    const { context, page } = await seite();
    await H.openBuilds(page);
    await oeffneAuswahl(page);
    const sichtbar = () => page.$$eval('#fgListe li', (ls) => ls.filter((l) => !l.hidden).map((l) => l.querySelector('code').textContent));
    // zugeklappt: die neuesten 3 und der freigegebene als Bezug
    assert.deepEqual(await sichtbar(), [S[0], S[1], S[2], S[6]]);
    assert.equal(await page.textContent('#fgMore'), 'Ältere Builds anzeigen (5)');
    await page.click('#fgMore');
    assert.equal((await sichtbar()).length, 9);
    await tippe(page, S[4]);
    assert.deepEqual(await auswahl(page), [...[0, 1, 2, 3].map((i) => `${S[i]} ow`), `${S[4]} xw`, `${S[5]} xw`, `${S[6]} x-`, `${S[7]} x-`, `${S[8]} x-`]);
    assert.deepEqual(await leiste(page), { summe: '2 Updates werden veröffentlicht', bis: `bis #104 · ${S[4]}`, veroeffentlichen: 'aktiv' });
    // Einklappen: die gewählten bleiben sichtbar
    await page.click('#fgLess');
    assert.deepEqual(await sichtbar(), [S[0], S[1], S[2], S[4], S[5], S[6]]);
    await tippe(page, S[1]);
    assert.deepEqual((await auswahl(page)).filter((x) => / xw$/.test(x)).map((x) => x.split(' ')[0]), [S[1], S[2], S[3], S[4], S[5]]);
    await tippe(page, S[5]);
    assert.deepEqual(await leiste(page), { summe: 'Noch kein Update gewählt', bis: 'Build antippen: er und alle älteren neuen Updates', veroeffentlichen: 'gesperrt' });
    await context.close();
  });
});

describe('Veröffentlichen: Kennung kopieren, Hinweis, GitHub-Link', () => {
  test('Kopiert die Kennung der Obergrenze, Dialog mit Schritten, Link und rel; Schließen per X, Esc, Tipp außerhalb; nichts gemerkt', async () => {
    mock.reset();
    mock.builds = builds(6);
    mock.freigabe = freigabeVon(mock.builds[3]);
    const S = mock.builds.map((b) => b.short);
    const { context, page, log, methods } = await seite();
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await H.openBuilds(page);
    await oeffneAuswahl(page);
    await tippe(page, S[1]);
    const n = mock.requests.length;
    await page.click('#fgVeroeffentlichen');
    await page.waitForFunction(() => /kopiert ✓$/.test(document.getElementById('fgTitel').textContent));
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), S[1], 'Kurz-Hash der Obergrenze, genau wie index.json "short"');
    assert.match(S[1], /^[0-9a-f]{4,40}$/, 'Format, das der Workflow annimmt');
    const d = await page.evaluate(() => ({
      titel: document.getElementById('fgTitel').textContent,
      umfang: document.getElementById('fgUmfang').textContent,
      schritte: [...document.querySelectorAll('.fg-schritte li')].map((l) => l.textContent),
      danach: document.getElementById('fgDanach').textContent,
      kennung: document.getElementById('fgKennung').textContent,
      gross: document.getElementById('fgKennungGross').hidden
    }));
    assert.deepEqual(d, {
      titel: `Kennung ${S[1]} kopiert ✓`,
      umfang: '2 Updates (#103, #104) für Playtester',
      schritte: ['„Run workflow“ tippen (GitHub-App: „Konfigurieren“)', 'Branch „main“ lassen', 'Ins Feld „Build-Kennung“ einfügen (statt „neuester“)',
        'Starten – Lauf ca. 1 Minute, Cloudflare danach 1–2 Minuten'],
      danach: 'Danach „Aktualisieren“: #104 wird FREIGEGEBEN.',
      kennung: S[1],
      gross: true
    });
    const a = await page.$eval('#fgGithub', (e) => ({ tag: e.tagName, href: e.getAttribute('href'), target: e.target, rel: e.rel, text: e.textContent }));
    assert.deepEqual(a, { tag: 'A', href: WORKFLOW_URL, target: '_blank', rel: 'noopener noreferrer', text: 'Zu GitHub ›' });
    // Auswahl verlassen, Liste wie vorher dahinter
    assert.ok(await page.isHidden('#fgAuswahl'));
    assert.ok(await page.isVisible('#fgDialog'));
    await page.screenshot({ path: path.join(H.OUT, 'playtester-updates-3-hinweis.png') });
    // „Kennung nochmal kopieren“
    await page.evaluate(() => navigator.clipboard.writeText('anderes'));
    await page.click('#fgNochmal');
    await page.waitForFunction((x) => navigator.clipboard.readText().then((t) => t === x), S[1]);
    // Schließen: X
    await page.click('#fgZu');
    assert.ok(await page.isHidden('#fgDialog'));
    // Esc und Tipp außerhalb (über erneutes Veröffentlichen)
    for (const zu of ['esc', 'aussen']) {
      await oeffneAuswahl(page);
      await tippe(page, S[2]);
      await page.click('#fgVeroeffentlichen');
      await page.waitForSelector('#fgDialog:not([hidden])');
      assert.equal(await page.evaluate(() => navigator.clipboard.readText()), S[2]);
      if (zu === 'esc') await page.keyboard.press('Escape');
      else await page.mouse.click(5, 5);
      await page.waitForSelector('#fgDialog', { state: 'hidden' });
      assert.ok(await page.isHidden('#fgAuswahl'), `${zu}: Auswahl bleibt geschlossen`);
    }
    // Das Dashboard merkt sich nichts: Kasten und Marken unverändert, keine Anfrage, nichts gespeichert
    assert.equal((await kasten(page)).stand, `Bei Playtestern: ${S[3]} · PR #102 · freigegeben 27.11., 14:18`);
    assert.deepEqual(await frei(page), [S[3]]);
    assert.equal(mock.requests.length, n, 'Veröffentlichen schickt keine Anfrage');
    assert.ok(methods.every((m) => m === 'GET'));
    const keys = await page.evaluate(() => Object.keys(localStorage).sort());
    assert.ok(keys.every((k) => !/frei|veroeff|playtester-upd/i.test(k)), `keine neuen Schlüssel: ${keys}`);
    // Maßgeblich: freigabe.json nach „Aktualisieren“
    mock.freigabe = freigabeVon(mock.builds[1], '2026-11-29T17:20:00Z');
    await aktualisieren(page);
    assert.deepEqual(await frei(page), [S[1]]);
    assert.deepEqual(await kasten(page), {
      hidden: false, art: 'ok', cls: 'fg-box', stand: `Bei Playtestern: ${S[1]} · PR #104 · freigegeben 29.11., 18:20`,
      neu: '1 neues Update noch nicht veröffentlicht', off: null, knopf: 'aktiv', nur: false
    });
    assert.deepEqual(log.errors, []);
    await context.close();
  });

  test('Kopieren: Ersatzweg (execCommand) wie im Feedback-Dialog; scheitert auch der, Kennung markiert zum Kopieren', async () => {
    mock.reset();
    mock.builds = builds(4);
    mock.freigabe = freigabeVon(mock.builds[2]);
    const S = mock.builds.map((b) => b.short);
    for (const execOk of [true, false]) {
      const { context, page, log } = await seite();
      await context.addInitScript((ok) => {
        if (window !== window.top) return;
        window.__kopiert = [];
        Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new Error('NotAllowedError')) } });
        document.execCommand = function (cmd) {
          const a = document.activeElement;
          window.__kopiert.push([cmd, a && a.tagName, a && a.value]);
          return ok;
        };
      }, execOk);
      await H.openBuilds(page);
      await oeffneAuswahl(page);
      await tippe(page, S[0]);
      await page.click('#fgVeroeffentlichen');
      if (execOk) {
        await page.waitForFunction(() => /kopiert ✓$/.test(document.getElementById('fgTitel').textContent));
        assert.deepEqual(await page.evaluate(() => window.__kopiert), [['copy', 'TEXTAREA', S[0]]]);
        assert.ok(await page.isHidden('#fgKennungGross'));
        assert.equal(await page.evaluate(() => document.querySelectorAll('#fgDialog textarea').length), 0, 'Hilfsfeld wieder entfernt');
      } else {
        await page.waitForFunction(() => /^Kopieren nicht möglich/.test(document.getElementById('fgTitel').textContent));
        assert.equal(await page.textContent('#fgTitel'), 'Kopieren nicht möglich – Kennung markieren:');
        assert.ok(await page.isVisible('#fgKennungGross'));
        assert.equal(await page.textContent('#fgKennungGross'), S[0]);
        assert.equal(await page.evaluate(() => String(window.getSelection())), S[0], 'Kennung markiert');
        assert.equal(await page.$eval('#fgKennungGross', (e) => getComputedStyle(e).userSelect), 'text');
        await page.screenshot({ path: path.join(H.OUT, 'playtester-updates-3-ohne-kopieren.png') });
      }
      assert.deepEqual(log.errors, []);
      await context.close();
    }
  });
});

describe('Layout: 320 px, iPhone quer, iPad', () => {
  // Elemente der Karte bzw. des Dialogs, die seitlich hinausragen, und Überlappungen nebeneinanderliegender Teile.
  const pruefe = (page, wo) => page.evaluate((wo) => {
    const r = (e) => e.getBoundingClientRect();
    const sicht = (e) => { const b = r(e); return b.width > 0 && b.height > 0; };
    // Überlappung des Inhalts (Text bzw. Knopf), nicht der Innenabstände
    const inhalt = (e) => { if (e.tagName === 'BUTTON' || e.tagName === 'A') return r(e); const g = document.createRange(); g.selectNodeContents(e); return g.getBoundingClientRect(); };
    const ueber = (a, b) => { const x = inhalt(a), y = inhalt(b); return x.left < y.right - 0.5 && y.left < x.right - 0.5 && x.top < y.bottom - 0.5 && y.top < x.bottom - 0.5; };
    const raus = (rahmen, sel) => [...rahmen.querySelectorAll(sel)].filter(sicht).filter((e) => {
      const a = r(e), c = r(rahmen);
      return a.left < c.left - 0.5 || a.right > c.right + 0.5;
    }).map((e) => e.tagName + (e.id ? '#' + e.id : '.' + e.className));
    const paare = [['.fg-text', '.fg-aktion'], ['.fg-summe', '.fg-knoepfe'], ['#fgAbbrechen', '#fgVeroeffentlichen'], ['#fgGithub', '#fgNochmal'], ['#fgZu', '#fgTitel']];
    const ueberlapp = paare.filter(([a, b]) => { const x = document.querySelector(a), y = document.querySelector(b); return x && y && sicht(x) && sicht(y) && ueber(x, y); });
    // jeder Rahmen für sich: Karte, Kasten, Kopf, Leiste (ein Knopf darf auch nicht über die Leiste ragen)
    const rahmen = ['#buildsCard', '.fg-box', '#fgKopf', '.fg-leiste'].map((q) => document.querySelector(q)).filter((e) => e && sicht(e));
    const out = { raus: rahmen.flatMap((c) => raus(c, '*')), ueberlapp, scroll: document.documentElement.scrollWidth - window.innerWidth };
    if (wo === 'dialog') {
      const dlg = document.querySelector('.fg-dlg'), b = r(dlg);
      out.raus = raus(dlg, '*');
      out.dlg = b.left >= -0.5 && b.right <= window.innerWidth + 0.5 && b.top >= -0.5 && b.bottom <= window.innerHeight + 0.5;
      // alles im Dialog erreichbar: entweder sichtbar oder per Scrollen im Dialog
      out.scrollbar = dlg.scrollHeight <= dlg.clientHeight + 1 || getComputedStyle(dlg).overflowY === 'auto';
    }
    return out;
  }, wo);
  for (const [name, opts] of [['320 px', { viewport: { width: 320, height: 568 } }], ['iPhone quer', { device: 'iPhone 13 landscape' }],
    ['iPad', { device: 'iPad Pro 11' }], ['iPad quer', { device: 'iPad Pro 11 landscape' }]]) {
    test(`${name}: Kasten, Auswahl und Hinweis ragen nicht über die Karte, keine Überlappung`, async () => {
      mock.reset();
      mock.builds = builds(5);
      mock.builds[0].message = 'Merge pull request #104 from konstantin9ezm/claude/sehr-langer-branch-name-fuer-den-test-ohne-leerzeichen';
      mock.freigabe = freigabeVon(mock.builds[3]);
      const S = mock.builds.map((b) => b.short);
      const { context, page, log } = await seite(opts);
      await context.grantPermissions(['clipboard-read', 'clipboard-write']);
      await H.openBuilds(page);
      const datei = name.replace(/\s+/g, '-');
      let m = await pruefe(page, 'liste');
      assert.deepEqual([m.raus, m.ueberlapp], [[], []], `${name} Liste: ${JSON.stringify(m)}`);
      assert.ok(m.scroll <= 0, `${name} Liste: waagerechter Überlauf ${m.scroll}`);
      await page.screenshot({ path: path.join(H.OUT, `playtester-updates-${datei}-1.png`), fullPage: true });
      await oeffneAuswahl(page);
      await tippe(page, S[1]);
      m = await pruefe(page, 'auswahl');
      assert.deepEqual(m.raus, [], `${name} Auswahl ragt hinaus`);
      assert.deepEqual(m.ueberlapp, [], `${name} Auswahl überlappt`);
      assert.ok(m.scroll <= 0, `${name}: waagerechter Überlauf ${m.scroll}`);
      const knoepfe = await page.$$eval('.fg-knoepfe .btn, #fgUpdate', (bs) => bs.filter((b) => b.offsetParent).map((b) => b.getBoundingClientRect().height));
      assert.ok(knoepfe.every((h) => h >= 40), `Tippflächen ${knoepfe}`);
      await page.screenshot({ path: path.join(H.OUT, `playtester-updates-${datei}-2.png`), fullPage: true });
      await page.click('#fgVeroeffentlichen');
      await page.waitForFunction(() => /kopiert ✓$/.test(document.getElementById('fgTitel').textContent));
      m = await pruefe(page, 'dialog');
      assert.deepEqual(m.raus, [], `${name} Dialog ragt hinaus`);
      assert.deepEqual(m.ueberlapp, [], `${name} Dialog überlappt`);
      assert.ok(m.dlg, `${name}: Dialog im sichtbaren Bereich`);
      assert.ok(m.scrollbar, `${name}: Dialog scrollbar`);
      // Knopf „Zu GitHub ›“ erreichbar (im Dialog in den sichtbaren Bereich scrollbar und antippbar)
      await page.$eval('#fgGithub', (e) => e.scrollIntoView({ block: 'nearest' }));
      const hit = await page.$eval('#fgGithub', (e) => { const b = e.getBoundingClientRect(); return document.elementFromPoint(b.left + b.width / 2, b.top + b.height / 2) === e; });
      assert.ok(hit, `${name}: „Zu GitHub ›“ antippbar`);
      await page.screenshot({ path: path.join(H.OUT, `playtester-updates-${datei}-3.png`) });
      assert.deepEqual(log.errors, []);
      await context.close();
    });
  }
});
