// Tests für die dynamischen Werte der Flyer-Seite (Stufe 1, flyer-werte.js) und den Umzug des Pakets nach aether-medien
// (flyer-online.js) in Chromium – mit nachgebauter GitHub-API über context.route (Suche, ROADMAP.md, Läufe, Jobs,
// CMakeLists.txt, Ordner, Commits; ETag/304) und einem Mini-Paket nur aus Platzhaltern (tests/flyer-hilfe.js plus eine
// Seite W1 mit data-wert). Zeitabhängiges (Zeitlimit, 24-h-Grenze) mit der Seitenuhr (README „Seitenuhr statt Wanduhr“).
// a) Formate  b) offline / ohne Token / ohne Speicher  c) Fehler, Zeitlimit, 24-h-Grenze  d) Export PDF/Bild/PowerPoint
// e) Paket-Export  f) Überschreiben, Verknüpfen, Abgleich  g) Migration v4 → v5  h) CSV  i) Ratenbudget, ETag/304
// j) Paket-Quelle aether-medien  k) Layout von Tafel, Abzeichen und Fußzeile
// Aufruf: node --test tests/flyer-werte.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const H = require('./flyer-hilfe');
const { assert, mitSeite, oeffneFlyer, importiere, text, ruhe, paketV1, idb, liesZip, FLYER_CSS } = H;

before(H.starte);
after(H.beende);

const AE_ = '/repos/konstantin9ezm/aether';
const MED = '/repos/konstantin9ezm/aether-medien';
const RAW = 'application/vnd.github.raw+json';
const START = new Date('2026-11-23T02:10:00+01:00');   // Seitenuhr: 23.11.2026, 02:10 Berlin
const STUNDE = 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Platzhalter-Paket: paketV1 + Seite W1 mit dynamischen Werten (nur Platzhalter-Texte)
// ---------------------------------------------------------------------------
function werteHtml() {
  const w = (cls, attrs, txt) => `<span class="${cls}" ${attrs}>${txt}</span>`;
  return '<section class="page c-spiel" data-id="W1" style="--s:1"><header class="hd"><h1 data-t="t1">Platzhalter Werte</h1></header>' +
    '<div class="body"><div class="st">' +
    `<div class="sti"><div class="stv">${w('w-zahl', 'data-wert="aether.prs.gemergt"', '65')}</div><div class="stl" data-t="t2">Platzhalter PRs</div></div>` +
    `<div class="sti"><div class="stv">${w('w-proz', 'data-wert="aether.roadmap.prozent"', '10 %')}</div><div class="stl" data-t="t3">Platzhalter Anteil</div></div>` +
    '<div class="sti"><div class="stv" data-t="t4">12</div><div class="stl" data-t="t5">Platzhalter frei</div></div></div>' +
    `<p class="w-zeile" data-t="t6">Platzhalter Zeile ${w('w-anteil', 'data-wert="aether.roadmap.anteil"', '1/2')} Punkte</p>` +
    `<p>${w('w-dauer', 'data-wert="aether.ci.pr.dauer"', '5 min')} · ${w('w-median', 'data-wert="aether.ci.pr.dauer" data-wert-teil="median"', '6 min')} · ` +
    `${w('w-merge', 'data-wert="aether.ci.merge.dauer"', '9 min')} ${w('w-art', 'data-wert="aether.ci.merge.dauer" data-wert-teil="art"', 'voll')}</p>` +
    `<p>${w('w-lang', 'data-wert="aether.letzterMerge" data-format="datum-lang"', '1. Januar 2020')} · ${w('w-kurz', 'data-wert="aether.letzterMerge"', '01.01.2020')}</p>` +
    `<p>${w('w-liste', 'data-wert="aether.roadmap.naechstes" data-wert-teil="2"', 'Platzhalter-Liste')}</p>` +
    `<p>${w('w-dash', 'data-wert="dashboard.prs.gemergt"', '3')} · ${w('w-engine', 'data-wert="engine.fertig"', '1')} · ${w('w-tests', 'data-wert="aether.tests.nativ"', '2')} · ` +
    `${w('w-welten', 'data-wert="aether.welten"', '0')} · ${w('w-systeme', 'data-wert="aether.systeme"', '0')} · ${w('w-commits', 'data-wert="aether.commits.seit" data-wert-teil="2026-11-01"', '0')} · ` +
    `${w('w-gross', 'data-wert="aether.prs.gemergt" data-format="zahl"', '0')} · ${w('w-unbekannt', 'data-wert="aether.tests.browser"', '3.308')}</p>` +
    '</div><footer class="ft"><span class="src" data-t="t9">Platzhalter-Quellen</span><span class="pg"><ae-t data-t="t10">W1 · Stand </ae-t>' +
    '<span class="w-stand" data-stand="kurz" data-stand-quelle="werte">01.02.2020</span></span></footer></section>';
}
function wertePaket(opts = {}) {
  const p = paketV1(opts);
  p.dokumente.push({ id: 'W1', art: 'flyer', kategorie: 'spiel', titel: 'Platzhalter Werte', breite: 794, hoehe: 1123, html: opts.html || werteHtml() });
  return p;
}

// ---------------------------------------------------------------------------
// Nachgebaute API (nur die Quellen der dynamischen Werte; alles andere geht an tests/flyer-hilfe.js)
// ---------------------------------------------------------------------------
const ROADMAP = ['## Erledigt', '- [x] A (PR #1)', '- [x] B', '- [x] C', '## Als Nächstes', '- [ ] Punkt A', '- [ ] Punkt B', '- [ ] Punkt C',
  '## Danach (laut Engine-Plan)', '- [ ] D1', '- [ ] D2', '## Für später', '- [ ] S1', '- [ ] S2'].join('\n');
const lauf = (id, min, ereignis) => ({ id, run_started_at: '2026-11-22T10:00:00Z', created_at: '2026-11-22T10:00:00Z', updated_at: new Date(Date.parse('2026-11-22T10:00:00Z') + min * 60000).toISOString(), event: ereignis, conclusion: 'success' });
function neueApi() {
  return { modus: 'ok', stand: 1, anfragen: [], n304: 0, prs: 1234, halt: null };
}
function artVon(p, url) {
  if (p === '/search/issues') return /aether-dashboard/.test(url.searchParams.get('q') || '') ? 'dashboard' : 'pulls';
  if (p === AE_ + '/contents/ROADMAP.md') return 'roadmap';
  if (p === AE_ + '/actions/workflows/build.yml/runs') return url.searchParams.get('event') === 'push' ? 'cimerge' : 'cipr';
  if (p === AE_ + '/actions/runs/777/jobs') return 'jobs';
  if (p === AE_ + '/contents/CMakeLists.txt') return 'cmake';
  if (p === AE_ + '/contents/game/assets/worlds') return 'welten';
  if (p === AE_ + '/contents/game/assets/systems') return 'systeme';
  if (p === AE_ + '/commits') return 'commits';
  return null;
}
function werteApi(m) {
  return async (route) => {
    const req = route.request(), url = new URL(req.url()), art = artVon(url.pathname, url);
    if (!art) return route.fallback();
    const cors = { 'access-control-allow-origin': '*', 'access-control-expose-headers': 'ETag, Link' };
    if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...cors, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept, If-None-Match' } });
    const kopf = req.headers();
    m.anfragen.push({ art, auth: /^Bearer /.test(kopf.authorization || ''), inm: kopf['if-none-match'] || null, since: url.searchParams.get('since') });
    const json = (st, o, extra) => route.fulfill({ status: st, headers: { ...cors, ...(extra || {}) }, contentType: 'application/json', body: JSON.stringify(o) });
    if (m.modus === 'offline') return route.abort('internetdisconnected').catch(() => {});
    if (m.modus === 'haengt') return;   // keine Antwort (Zeitlimit)
    if (m.halt) await m.halt;
    if (m.modus === 'fehler') return json(500, { message: 'Server Error' });
    if (art !== 'dashboard' && kopf.authorization !== `Bearer ${H.TOKEN}`) return json(401, { message: 'Bad credentials' });
    const etag = `"${art}-${m.stand}${art === 'commits' ? '-' + url.searchParams.get('since') : ''}"`;
    if (kopf['if-none-match'] === etag) { m.n304++; return route.fulfill({ status: 304, headers: { ...cors, etag } }); }
    const e = { etag };
    if (art === 'dashboard') return json(200, { total_count: 40, items: [] }, e);
    if (art === 'pulls') return json(200, { total_count: m.prs, items: [{ pull_request: { merged_at: '2026-11-20T10:00:00Z' } }, { pull_request: { merged_at: '2026-11-22T10:00:00Z' } }, { pull_request: null }] }, e);
    if (art === 'roadmap' || art === 'cmake') {
      const body = art === 'roadmap' ? ROADMAP : 'add_test(NAME a COMMAND a)\n  add_test(NAME b COMMAND b)\n# add_test(NAME alt COMMAND alt)\nadd_test (NAME c COMMAND c)\n';
      return route.fulfill({ status: 200, headers: { ...cors, ...e, 'content-type': RAW }, body });
    }
    if (art === 'cipr') return json(200, { workflow_runs: [lauf(5, 41, 'pull_request'), lauf(4, 20, 'pull_request'), lauf(3, 30, 'pull_request'), lauf(2, 25, 'pull_request'), lauf(1, 35, 'pull_request')] }, e);
    if (art === 'cimerge') return json(200, { workflow_runs: [lauf(777, 7, 'push')] }, e);
    if (art === 'jobs') return json(200, { jobs: [{ name: 'web / bauen', conclusion: 'success' }, { name: 'web / Browser-Test Teil 1', conclusion: 'skipped' }] });
    if (art === 'welten') return json(200, [{ name: 'a.aetherwelt', type: 'file' }, { name: 'b.aetherwelt', type: 'file' }, { name: 'README.md', type: 'file' }, { name: 'drafts', type: 'dir' }], e);
    if (art === 'systeme') return json(200, [{ name: 'g.aethersystem', type: 'file' }], e);
    if (art === 'commits') return json(200, [{ sha: 'x' }], { ...e, link: `<https://api.github.com${AE_}/commits?sha=main&per_page=1&page=2>; rel="next", <https://api.github.com${AE_}/commits?sha=main&per_page=1&page=17>; rel="last"` });
    return json(404, { message: 'Not Found' });
  };
}

// ---------------------------------------------------------------------------
// Hilfen
// ---------------------------------------------------------------------------
// Seite mit Uhr und API: opts.uhr (page.clock ab START), opts.token, opts.init
async function mitWerten(opts, fn) {
  const api = neueApi();
  const init = [() => { window.AETHER_TEST_FLYER_WERTE_INTERVALL_MS = 2000000000; }].concat(opts.init || []);
  await mitSeite({ withToken: opts.token !== false, viewport: opts.viewport, init }, async (umg) => {
    await umg.context.route('https://api.github.com/**', werteApi(api));
    if (opts.uhr !== false) await umg.page.clock.install({ time: START });
    await fn(Object.assign({ api }, umg));
  });
}
const auffrischen = (page) => page.evaluate(() => window.AetherFlyerWerte.auffrischen());
async function mitPaket(page, paket) {
  await oeffneFlyer(page);
  await importiere(page, paket || wertePaket());
  await auffrischen(page);
  await ruhe(page);
}
// Text eines Elements in der Kachel bzw. im Vollbild (Shadow DOM, ohne eigene Abzeichen und Fußzeile)
function textIn(page, ort, sel) {
  return page.evaluate(([ort, sel]) => {
    const host = ort === 'vollbild' ? window.AetherFlyerAnsicht.vollbildHost() : document.querySelector('#kacheln .kachel[data-id="W1"] .flyer-host');
    const el = host && host.shadowRoot.querySelector(sel);
    if (!el) return null;
    const k = el.cloneNode(true);
    for (const x of k.querySelectorAll('[data-ae-abzeichen],[data-ae-werte-fuss]')) x.remove();
    return k.textContent.replace(/\s+/g, ' ').trim();
  }, [ort, sel]);
}
function attrIn(page, ort, sel, attr) {
  return page.evaluate(([ort, sel, attr]) => {
    const host = ort === 'vollbild' ? window.AetherFlyerAnsicht.vollbildHost() : document.querySelector('#kacheln .kachel[data-id="W1"] .flyer-host');
    const el = host && host.shadowRoot.querySelector(sel);
    return el ? el.getAttribute(attr) : undefined;
  }, [ort, sel, attr]);
}
async function vollbildText(page) {
  await page.click('#kacheln .kachel[data-id="W1"]');
  await page.waitForFunction(() => !document.getElementById('vollbild').hidden);
  await page.click('#vbModus button[data-modus="text"]');
  await page.waitForFunction(() => { const h = window.AetherFlyerAnsicht.vollbildHost(); return h && h.shadowRoot.querySelector('[data-ae-wz]'); });
}
const vb = (page, sel) => page.locator('#vbBuehne .flyer-host ' + sel);
const fuss = (page, ort) => page.evaluate((ort) => {
  const host = ort === 'vollbild' ? window.AetherFlyerAnsicht.vollbildHost() : document.querySelector('#kacheln .kachel[data-id="W1"] .flyer-host');
  const f = host && host.shadowRoot.querySelector('[data-ae-werte-fuss]');
  return f ? { text: f.textContent, farbe: getComputedStyle(f).color, zustand: f.getAttribute('data-ae-werte-fuss') } : null;
}, ort);
const W_ = (page, fn, arg) => page.evaluate(fn, arg);

// ---------------------------------------------------------------------------
describe('Dynamische Werte a) Formate und Darstellung', () => {
  test('Werte füllen und formatieren: zahl mit Tausenderpunkt, prozent, dauer-min (letzter/Median), datum lang/kurz, liste (Anzahl), Teile, Fußzeile türkis, Stand aus den Quellen; Ansehen ohne Markierung', async () => {
    await mitWerten({}, async ({ page, api, log }) => {
      await mitPaket(page);
      const erwartet = {
        '.w-zahl': '1.234', '.w-gross': '1.234', '.w-proz': '30 %', '.w-anteil': '3/10', '.w-dauer': '41 min', '.w-median': '30 min', '.w-merge': '7 min',
        '.w-art': 'verkürzt', '.w-lang': '22. November 2026', '.w-kurz': '22.11.2026', '.w-liste': 'Punkt A · Punkt B', '.w-dash': '40', '.w-engine': '25',
        '.w-tests': '3', '.w-welten': '2', '.w-systeme': '1', '.w-commits': '17', '.w-unbekannt': '3.308'
      };
      for (const [sel, t] of Object.entries(erwartet)) assert.equal(await textIn(page, 'kachel', sel), t, `Kachel ${sel}`);
      assert.equal(await textIn(page, 'kachel', '[data-t="t6"]'), 'Platzhalter Zeile 3/10 Punkte', 'Wert im Text bleibt Teil des Satzes');
      // Fußzeile nach den Quellen, türkis; Stand = jüngste Quelle
      const f = await fuss(page, 'kachel');
      assert.equal(f.text, ' · Werte vom 23.11.2026, 02:10');
      assert.equal(f.farbe, 'rgb(127, 240, 245)', '#7ff0f5');
      assert.equal(await textIn(page, 'kachel', '.w-stand'), '23.11.2026', 'data-stand-quelle="werte"');
      // Seite ohne data-wert: keine Fußzeile, Stand wie heute
      assert.equal(await page.evaluate(() => document.querySelector('#kacheln .kachel[data-id="S1"] .flyer-host').shadowRoot.querySelector('[data-ae-werte-fuss]')), null);
      // Ansehen im Vollbild: Werte live, keine Markierung
      await page.click('#kacheln .kachel[data-id="W1"]');
      await page.waitForFunction(() => !document.getElementById('vollbild').hidden);
      assert.equal(await textIn(page, 'vollbild', '.w-zahl'), '1.234');
      assert.equal(await page.evaluate(() => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelectorAll('[data-ae-wz],[data-ae-abzeichen]').length), 0, 'Ansehen ohne Markierung');
      // Text-Modus: live türkis gepunktet mit „↻ live“; unbekannter Schlüssel „Hand · Stufe 2“
      await page.click('#vbModus button[data-modus="text"]');
      await page.waitForFunction(() => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('[data-ae-wz]'));
      const m = await page.evaluate(() => {
        const r = window.AetherFlyerAnsicht.vollbildHost().shadowRoot;
        const el = r.querySelector('.w-zahl'), cs = getComputedStyle(el);
        return { wz: el.getAttribute('data-ae-wz'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor + ' ' + cs.outlineOffset,
          abz: el.querySelector('[data-ae-abzeichen]').textContent, unbekannt: r.querySelector('.w-unbekannt [data-ae-abzeichen]').textContent,
          normal: getComputedStyle(r.querySelector('[data-t="t5"]')).outlineStyle };
      });
      assert.deepEqual(m, { wz: 'live', outline: 'dotted 2px rgb(63, 209, 216) 3px', abz: '↻ live', unbekannt: 'Hand · Stufe 2', normal: 'none' });
      assert.ok(api.anfragen.length > 0);
      assert.deepEqual(log.errors, []);
      assert.deepEqual(log.fremd, []);
    });
  });
});

describe('Dynamische Werte b) offline, ohne Token, ohne Speicher', () => {
  test('ohne Token: Werte aus aether bleiben beim letzten Stand, öffentliche (aether-dashboard, ohne Authorization) und Engine-Karte werden gelesen', async () => {
    await mitWerten({ token: false }, async ({ page, api, log }) => {
      await page.goto(H.umgebung.baseUrl + 'manifest.json');
      await page.evaluate((t) => localStorage.setItem('aether.githubToken', t), H.TOKEN);
      await mitPaket(page);
      assert.equal(await textIn(page, 'kachel', '.w-zahl'), '1.234');
      // Neu laden ohne Token, neue Zahlen online
      await page.evaluate(() => localStorage.removeItem('aether.githubToken'));
      api.anfragen = []; api.prs = 2000; api.stand = 2;
      await page.reload();
      await oeffneFlyer(page, null);
      await auffrischen(page);
      await ruhe(page);
      assert.equal(await textIn(page, 'kachel', '.w-zahl'), '1.234', 'letzter bekannter Wert aus dem Speicher');
      assert.equal(await textIn(page, 'kachel', '.w-dash'), '40');
      assert.ok(api.anfragen.length >= 1, 'öffentliches Repo gelesen');
      assert.ok(api.anfragen.every((a) => a.art === 'dashboard' && a.auth === false), 'nur das öffentliche Repo, ohne Token');
      assert.equal(await W_(page, () => window.AetherFlyerWerte.zustand('aether.prs.gemergt')), 'live', 'noch keine 24 h alt');
      assert.deepEqual(log.errors, []);
    });
  });
  test('offline: letzter Wert bleibt, „⚠ offline“ orange, Fußzeile „· offline“ orange; ohne gespeicherten Wert gilt der Paket-Text', async () => {
    await mitWerten({}, async ({ page, api, context, log }) => {
      await mitPaket(page);
      await context.setOffline(true);
      await auffrischen(page);
      await ruhe(page);
      assert.equal(await textIn(page, 'kachel', '.w-zahl'), '1.234', 'letzter Wert');
      assert.equal(await W_(page, () => window.AetherFlyerWerte.zustand('aether.prs.gemergt')), 'alt');
      const f = await fuss(page, 'kachel');
      assert.match(f.text, /^ · Werte vom 23\.11\.2026, 02:10 · offline$/);
      assert.equal(f.farbe, 'rgb(255, 208, 138)', '#ffd08a');
      await vollbildText(page);
      const m = await page.evaluate(() => { const el = window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('.w-zahl'); return [el.getAttribute('data-ae-wz'), el.querySelector('[data-ae-abzeichen]').textContent, getComputedStyle(el).outlineColor]; });
      assert.deepEqual(m, ['alt', '⚠ offline', 'rgb(255, 179, 71)']);
      await context.setOffline(false);
      assert.deepEqual(log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to fetch|net::/.test(e)), []);
    });
    // Ohne Speicher (neues Gerät) und offline: Paket-Text
    await mitWerten({}, async ({ page, api, context }) => {
      await oeffneFlyer(page);
      await importiere(page, wertePaket());
      api.modus = 'offline';
      await auffrischen(page);
      await ruhe(page);
      assert.equal(await textIn(page, 'kachel', '.w-zahl'), '65', 'Text aus dem Paket');
      assert.equal(await textIn(page, 'kachel', '.w-engine'), '25', 'Engine-Karte (gleicher Ursprung) trotzdem');
      assert.notEqual(await W_(page, () => window.AetherFlyerWerte.zustand('aether.prs.gemergt')), 'live');
    });
  });
});

describe('Dynamische Werte c) Fehler, Zeitlimit, 24-h-Grenze (Seitenuhr)', () => {
  test('Fehler (500) lässt den alten Wert stehen und markiert „veraltet“ (⚠ Fehler); Zeitlimit genau nach der Grenze (grenze−1 offen, +1 abgebrochen)', async () => {
    await mitWerten({}, async ({ page, api }) => {
      await mitPaket(page);
      api.modus = 'fehler'; api.stand = 2;
      await auffrischen(page);
      await ruhe(page);
      assert.equal(await textIn(page, 'kachel', '.w-zahl'), '1.234');
      const e = await W_(page, () => window.AetherFlyerWerte.eintrag('aether.prs.gemergt'));
      assert.equal(e.fehler.art, 'fehler');
      assert.equal(await W_(page, () => window.AetherFlyerWerte.zustand('aether.prs.gemergt')), 'alt');
      await vollbildText(page);
      assert.equal(await page.evaluate(() => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('.w-zahl [data-ae-abzeichen]').textContent), '⚠ Fehler');
      // Zeitlimit: Uhr anhalten, Anfrage hängt
      api.modus = 'haengt';
      const jetzt = await page.evaluate(() => Date.now());
      await page.clock.pauseAt(jetzt + 1000);
      const vorher = api.anfragen.length;
      await page.evaluate(() => { window.__fertig = false; window.AetherFlyerWerte.auffrischen().then(() => { window.__fertig = true; }); });
      for (let i = 0; i < 200 && api.anfragen.length === vorher; i++) await new Promise((r) => setTimeout(r, 20));
      assert.ok(api.anfragen.length > vorher, 'Anfrage abgeschickt');
      const grenze = await page.evaluate(() => window.AetherGemeinsam.projTimeoutMs);
      await page.clock.runFor(grenze - 1);
      assert.equal(await page.evaluate(() => window.__fertig), false, 'grenze − 1: noch offen');
      await page.clock.runFor(1);
      await page.waitForFunction(() => window.__fertig === true);
      const z = await W_(page, () => window.AetherFlyerWerte.eintrag('aether.prs.gemergt'));
      assert.equal(z.fehler.art, 'offline', 'Zeitlimit wie offline');
      assert.equal(z.wert, 1234, 'alter Wert bleibt');
      assert.equal(api.anfragen.length, vorher + 1, 'nach dem Zeitlimit keine weiteren GitHub-Anfragen in dieser Auffrischung');
    });
  });
  test('24-h-Grenze: genau 24 h nach dem Lesen noch live, 1 ms später veraltet (⚠ 24 Std. alt)', async () => {
    await mitWerten({}, async ({ page }) => {
      await mitPaket(page);
      const e = await W_(page, () => window.AetherFlyerWerte.eintrag('aether.prs.gemergt'));
      const t = Date.parse(e.zeit), V = await W_(page, () => window.AetherFlyerWerte.VERALTET_MS);
      assert.equal(V, 24 * STUNDE);
      await page.clock.pauseAt(t + V - 1);
      assert.equal(await W_(page, () => window.AetherFlyerWerte.zustand('aether.prs.gemergt')), 'live', 'grenze − 1');
      await page.clock.runFor(1);
      assert.equal(await W_(page, () => window.AetherFlyerWerte.zustand('aether.prs.gemergt')), 'live', 'genau an der Grenze');
      await page.clock.runFor(1);
      assert.equal(await W_(page, () => window.AetherFlyerWerte.zustand('aether.prs.gemergt')), 'alt', 'grenze + 1');
      await page.evaluate(() => window.AetherFlyerWerte.neuZeichnen());
      await vollbildText(page);
      assert.equal(await page.evaluate(() => window.AetherFlyerAnsicht.vollbildHost().shadowRoot.querySelector('.w-zahl [data-ae-abzeichen]').textContent), '⚠ 24 Std. alt');
      assert.match((await fuss(page, 'vollbild')).text, / · veraltet$/);
    });
  });
});

describe('Dynamische Werte d) Export PDF, Bild, PowerPoint', () => {
  test('mit den Werten aus dem Zwischenspeicher (eingefroren zum Exportzeitpunkt), ohne Markierung; PowerPoint-Notiz „Werte vom …“', async () => {
    await mitWerten({}, async ({ page, api }) => {
      await mitPaket(page);
      await vollbildText(page);   // auch aus dem Modus „Text“ heraus: Export ohne Markierung
      // PDF (Druckvorbereitung)
      const druck = await page.evaluate(async () => {
        const dok = window.AetherFlyerAnsicht.offenesDokument();
        await window.AetherFlyerExport.druckvorbereitung([dok]);
        const r = document.querySelector('#druck .flyer-host').shadowRoot;
        return { zahl: r.querySelector('.w-zahl').textContent, marken: r.querySelectorAll('[data-ae-wz],[data-ae-abzeichen]').length, fuss: r.querySelector('[data-ae-werte-fuss]').textContent };
      });
      assert.deepEqual(druck, { zahl: '1.234', marken: 0, fuss: ' · Werte vom 23.11.2026, 02:10' });
      // Bild: dieselbe Darstellung wie „Bild“ (seitenBild), gemessen an der Wurzel
      const bild = await page.evaluate(async () => {
        const dok = window.AetherFlyerAnsicht.offenesDokument();
        let m = null;
        await window.AetherFlyerExport.seitenBild(dok, undefined, (w) => { m = { zahl: w.querySelector('.w-zahl').textContent, marken: w.querySelectorAll('[data-ae-wz],[data-ae-abzeichen]').length }; return null; });
        return m;
      });
      assert.deepEqual(bild, { zahl: '1.234', marken: 0 });
      // PowerPoint: Notiz der Folie
      api.prs = 5555; api.stand = 3;   // online schon neuer, aber noch nicht gelesen → Export zeigt den gespeicherten Stand
      const notiz = await page.evaluate(async () => {
        const dok = window.AetherFlyerAnsicht.offenesDokument();
        const r = await window.AetherFlyerPptx.exportiere([dok], { format: 'a4', name: 'test.pptx', titel: 'Test' });
        return Array.from(new Uint8Array(await r.datei.arrayBuffer()));
      });
      const zip = liesZip(Buffer.from(notiz));
      const n = zip.find((d) => d.name === 'ppt/notesSlides/notesSlide1.xml').daten.toString('utf8');
      assert.match(n, /Werte vom 23\.11\.2026, 02:10/);
      assert.match(n, /Seite: W1/);
      assert.equal(await textIn(page, 'kachel', '.w-zahl'), '1.234', 'eingefroren: nichts nachgeladen');
    });
  });
});

describe('Dynamische Werte e) Paket-Export', () => {
  test('Platzhalter bleibt, Text = aktueller Wert (Schnappschuss); Rundlauf Import → Abgleich ohne Konflikt; unverändertes Paket ohne Werte bitgleich', async () => {
    await mitWerten({}, async ({ page }) => {
      await oeffneFlyer(page);
      // Ohne Werte: jede Seite bitgleich
      const p0 = paketV1();
      // Schreibweisen, die ein neu geschriebenes HTML ändern würde (einfache Anführungszeichen, <br/>): müssen bleiben
      p0.dokumente[0].html = p0.dokumente[0].html.replace('<h1 data-t="t2">', "<h1 data-t='t2'>").replace('Platzhalter-Untertitel', 'Platzhalter-<br/>Untertitel');
      await importiere(page, p0);
      await auffrischen(page);
      const e0 = await page.evaluate(() => window.AetherFlyerAenderungen.exportPaket(null).paket);
      assert.deepEqual(e0.versionen[0].seiten.map((s) => s.html), p0.dokumente.map((d) => d.html), 'HTML bitgleich');
      // Mit Werten
      const p = wertePaket();
      await importiere(page, p);
      await auffrischen(page);
      const e = await page.evaluate(() => window.AetherFlyerAenderungen.exportPaket(null).paket);
      const html = e.versionen[0].seiten.find((s) => s.id === 'W1').html;
      assert.match(html, /<span class="w-zahl" data-wert="aether\.prs\.gemergt">1\.234<\/span>/);
      assert.match(html, /data-wert="aether\.ci\.merge\.dauer" data-wert-teil="art">verkürzt</);
      assert.match(html, /data-wert="aether\.tests\.browser">3\.308</, 'unbekannter Schlüssel: Text bleibt');
      assert.doesNotMatch(html, /data-ae-/, 'keine Hilfsangaben der Darstellung');
      assert.deepEqual(e.versionen[0].seiten.filter((s) => s.id !== 'W1').map((s) => s.html), p.dokumente.filter((d) => d.id !== 'W1').map((d) => d.html), 'andere Seiten bitgleich');
      // Rundlauf: der Export als neue Basis → kein Konflikt, nichts geändert
      await importiere(page, e);
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.konflikte().length), 0);
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.alleVersionen().length), 0);
      // Export eines Pakets, dessen Texte schon den Werten entsprechen: bitgleich
      const e2 = await page.evaluate(() => window.AetherFlyerAenderungen.exportPaket(null).paket);
      assert.deepEqual(e2.versionen[0].seiten.map((s) => s.html), e.versionen[0].seiten.map((s) => s.html));
    });
  });
});

describe('Dynamische Werte f) Überschreiben, Verknüpfen, Abgleich der Änderungsart „wert“', () => {
  test('Tafel, „Von Hand überschreiben …“, „Original“; „Mit Wert verknüpfen …“ und Lösen; Export und Abgleich', async () => {
    await mitWerten({}, async ({ page, api, log }) => {
      await mitPaket(page);
      await vollbildText(page);
      // Tafel
      await vb(page, '.w-zahl').click();
      await page.waitForSelector('#vbWert:not([hidden])');
      assert.equal(await text(page, '#vbWertLabel'), 'W1 · dynamischer Wert „aether.prs.gemergt“');
      assert.equal(await text(page, '#vbWertZahl'), '1.234');
      assert.equal(await text(page, '#vbWertBeschr'), 'Pull Requests im Repo aether, gemergt');
      assert.equal(await text(page, '#vbWertQuelle'), 'Quelle: GitHub · aether · gelesen 23.11.2026, 02:10 · im Paket gespeichert: 65');
      assert.ok(await page.isHidden('#vbEdit'), 'kein Textfeld: gesperrt');
      assert.ok(await page.isHidden('#vbWertOrig'));
      // „Jetzt neu lesen“
      api.prs = 1300; api.stand = 2;
      await page.click('#vbWertNeu');
      await page.waitForFunction(() => document.getElementById('vbWertZahl').textContent === '1.300');
      // Überschreiben
      await page.click('#vbWertHand');
      await page.fill('#vbWertFeld', '99');
      await page.click('#vbWertHandOk');
      await page.waitForFunction(() => window.AetherFlyerAenderungen.alleVersionen().some((e) => e.art === 'wert'));
      await ruhe(page);
      assert.equal(await textIn(page, 'vollbild', '.w-zahl'), '99');
      assert.equal(await textIn(page, 'kachel', '.w-zahl'), '99');
      assert.equal(await textIn(page, 'kachel', '.w-gross'), '1.300', 'zweites Vorkommen bleibt live');
      assert.deepEqual(await page.evaluate(() => window.AetherFlyerAenderungen.alleVersionen().filter((e) => e.art === 'wert').map((e) => [e.dok, e.k, e.alt, e.neu])),
        [['W1', 'aether.prs.gemergt#1', '@aether.prs.gemergt', '=99']]);
      assert.equal(await attrIn(page, 'vollbild', '.w-zahl', 'data-ae-wz'), 'hand');
      // Neue Live-Zahl: kein Konflikt, Überschreiben bleibt
      api.prs = 1400; api.stand = 3;
      await auffrischen(page);
      assert.equal(await textIn(page, 'kachel', '.w-zahl'), '99');
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.konflikte().length), 0);
      // Export: data-wert-hand und Text; Sicherung v3 trägt den Eintrag
      const ex = await page.evaluate(() => window.AetherFlyerAenderungen.exportPaket(null).paket);
      assert.match(ex.versionen[0].seiten.find((s) => s.id === 'W1').html, /<span class="w-zahl" data-wert="aether\.prs\.gemergt" data-wert-hand="99">99<\/span>/);
      const sich = await page.evaluate(() => window.AetherFlyerAenderungen.sicherung());
      assert.equal(sich.version, 3);
      assert.ok(sich.eintraege.some((e) => e.art === 'wert' && e.neu === '=99'));
      assert.doesNotThrow(() => JSON.stringify(sich));
      assert.deepEqual(await page.evaluate((t) => window.AetherFlyerAenderungen.leseSicherung(t).eintraege.filter((e) => e.art === 'wert').map((e) => [e.k, e.neu]), JSON.stringify(sich)),
        [['aether.prs.gemergt#1', '=99']], 'Sicherung wieder lesbar');
      // „Original“: wieder live
      await vb(page, '.w-zahl').click();
      await page.waitForSelector('#vbWert:not([hidden])');
      assert.ok(await page.isVisible('#vbWertOrig'));
      await page.click('#vbWertOrig');
      await page.waitForFunction(() => !window.AetherFlyerAenderungen.alleVersionen().length);
      await ruhe(page);
      assert.equal(await textIn(page, 'vollbild', '.w-zahl'), '1.400');
      // Verknüpfen: normales Textelement t4 („12“) → engine.fertig
      await vb(page, '[data-t="t4"]').click();
      await page.waitForSelector('#vbEdit:not([hidden])');
      assert.ok(await page.isVisible('#vbEditWert'));
      await page.click('#vbEditWert');
      await page.waitForSelector('#vbVerknuepfen:not([hidden])');
      const zeile = await page.$eval('#vbVerknuepfen button[data-schluessel="engine.fertig"]', (b) => b.textContent);
      assert.match(zeile, /^25 engine\.fertig/);
      await page.click('#vbVerknuepfen button[data-schluessel="engine.fertig"]');
      await page.waitForFunction(() => window.AetherFlyerAenderungen.alleVersionen().some((e) => e.k === 't:t4'));
      await ruhe(page);
      assert.equal(await textIn(page, 'vollbild', '[data-t="t4"]'), '25');
      assert.equal(await attrIn(page, 'vollbild', '[data-t="t4"]', 'data-ae-wz'), 'live');
      // Export trägt die Verknüpfung als data-wert; Rundlauf ohne Konflikt
      const ex2 = await page.evaluate(() => window.AetherFlyerAenderungen.exportPaket(null).paket);
      assert.match(ex2.versionen[0].seiten.find((s) => s.id === 'W1').html, /<div class="stv" data-t="t4" data-wert="engine\.fertig">25<\/div>/);
      // Lösen: Tafel → „Original“
      await vb(page, '[data-t="t4"]').click();
      await page.waitForSelector('#vbWert:not([hidden])');
      assert.match(await text(page, '#vbWertLabel'), /verknüpft$/);
      await page.click('#vbWertOrig');
      await page.waitForFunction(() => !window.AetherFlyerAenderungen.alleVersionen().length);
      await ruhe(page);
      assert.equal(await textIn(page, 'vollbild', '[data-t="t4"]'), '12');
      // Abgleich: Rundlauf mit dem Export (Verknüpfung) → Eintrag entfällt, kein Konflikt
      await page.evaluate(() => window.AetherFlyerAenderungen.setze('W1', 'wert', 't:t4', '@engine.fertig'));
      await importiere(page, ex2);
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.konflikte().length), 0);
      assert.equal(await page.evaluate(() => window.AetherFlyerAenderungen.alleVersionen().length), 0, 'Verknüpfung steht jetzt im Paket');
      // Konflikt: eigenes Überschreiben, online anders überschrieben
      await page.evaluate(() => window.AetherFlyerAenderungen.setze('W1', 'wert', 'aether.prs.gemergt#1', '=99'));
      const anders = wertePaket({ version: '2026-11-24.1', stand: '2026-11-24', html: werteHtml().replace('data-wert="aether.prs.gemergt">65', 'data-wert="aether.prs.gemergt" data-wert-hand="77">77') });
      await importiere(page, anders);
      const k = await page.evaluate(() => window.AetherFlyerAenderungen.konflikte().map((x) => [x.art, x.k, x.basis, x.meins, x.online]));
      assert.deepEqual(k, [['wert', 'aether.prs.gemergt#1', '@aether.prs.gemergt', '=99', '=77']]);
      await page.click('#vbZu');
      await page.waitForFunction(() => document.getElementById('vollbild').hidden);
      await page.click('#konflikteZeigen');
      assert.deepEqual(await page.$eval('#konfliktListe .konflikt', (k) => [k.querySelector('b').textContent, k.querySelector('.k-basis').textContent, k.querySelector('.k-meins').textContent, k.querySelector('.k-online').textContent]),
        ['W1 · Platzhalter Werte – Wert aether.prs.gemergt#1', 'live: aether.prs.gemergt', 'von Hand: 99', 'von Hand: 77']);
      assert.deepEqual(log.errors, []);
    });
  });
});

describe('Dynamische Werte g) IndexedDB-Migration v4 → v5', () => {
  test('alle Stores und Einträge bleiben unverändert, Store „werte“ kommt dazu', async () => {
    await mitWerten({ uhr: false }, async ({ page }) => {
      await page.goto(H.umgebung.baseUrl + 'manifest.json');
      const p = paketV1();
      const basis = { paket: p, quelle: 'online', sha: H.SHA_A, uebernommen: '2026-01-01T00:00:00.000Z' };
      const online = { sha: H.SHA_A, version: p.version, stand: p.stand, geprueft: '2026-01-01T00:00:00.000Z' };
      const eintrag = { ver: '1.1', dok: 'S1', k: 't2', art: 'text', alt: 'Platzhalter eins', neu: 'Vor v5 geändert', exportiert: null, zeit: '2026-01-02T00:00:00.000Z', konflikt: null };
      const struktur = { paket: null, konflikte: [], exportiert: null };
      const medienOnline = { geprueft: '2026-01-01T00:00:00.000Z', zugriff: 'ok', liste: [] };
      await page.evaluate(([b, o, e, s, mo]) => new Promise((resolve, reject) => {
        const r = indexedDB.open('aether-flyer', 4);
        r.onupgradeneeded = () => { for (const n of ['basis', 'online', 'aenderungen', 'struktur', 'geraet', 'medien']) r.result.createObjectStore(n); };
        r.onerror = () => reject(r.error);
        r.onsuccess = () => {
          const db = r.result, tx = db.transaction(['basis', 'online', 'aenderungen', 'struktur', 'geraet', 'medien'], 'readwrite');
          tx.objectStore('basis').put(b, 'aktuell');
          tx.objectStore('online').put(o, 'stand');
          tx.objectStore('aenderungen').put(e, 'e:1.1\nS1\ntext\nt2');
          tx.objectStore('aenderungen').put({ exporte: ['2026-01-01.1'] }, 'meta');
          tx.objectStore('struktur').put(s, 'lokal');
          tx.objectStore('geraet').put('1.1', 'version');
          tx.objectStore('medien').put(mo, 'online');
          tx.oncomplete = () => { db.close(); resolve(); };
          tx.onerror = () => reject(tx.error);
        };
      }), [basis, online, eintrag, struktur, medienOnline]);
      await oeffneFlyer(page);
      await ruhe(page);
      const db = await idb(page);
      assert.deepEqual(Object.keys(db).sort(), ['aenderungen', 'basis', 'geraet', 'medien', 'online', 'struktur', 'werte']);
      assert.equal(db.basis.version, 5);
      assert.deepEqual(db.basis.werte, [basis]);
      assert.deepEqual(db.online.werte, [online]);
      assert.deepEqual(db.aenderungen.schluessel.sort(), ['e:1.1\nS1\ntext\nt2', 'meta']);
      assert.deepEqual(db.aenderungen.werte.find((w) => w.k === 't2'), eintrag);
      assert.deepEqual(db.struktur.werte, [struktur]);
      assert.deepEqual(db.geraet.werte, ['1.1']);
      assert.deepEqual(db.medien.werte, [medienOnline]);
      assert.deepEqual(db.werte.werte, [], 'Store „werte“ leer angelegt');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), p.version);
    });
  });
});

describe('Dynamische Werte h) CSV der Grafiken & Daten', () => {
  test('Zeilenart art=wert mit Schlüssel, Wert, Quelle, Zeit; Seiten ohne Werte unverändert', async () => {
    await mitWerten({}, async ({ page }) => {
      await mitPaket(page);
      const r = await page.evaluate(async () => {
        const s = window.AetherFlyer.sicht();
        const w1 = await window.AetherFlyerGrafik.seiteVorbereiten(s.dokumente.find((d) => d.id === 'W1'), '1.1');
        const s1 = await window.AetherFlyerGrafik.seiteVorbereiten(s.dokumente.find((d) => d.id === 'S1'), '1.1');
        return { w1: w1.csv, s1: s1.csv, json: JSON.parse(w1.json).eintraege.filter((e) => e.art === 'wert').slice(0, 1) };
      });
      const zeilen = r.w1.replace(/^﻿/, '').split('\r\n');
      assert.equal(zeilen[0], 'version;seite;kennung;art;wert;status;quelle;zeit');
      const zahl = zeilen.find((z) => z.startsWith('1.1;W1;aether.prs.gemergt;wert;'));
      assert.match(zahl, /^1\.1;W1;aether\.prs\.gemergt;wert;1\.234;;GitHub · aether;2026-11-23T01:10:\d\d\.\d{3}Z$/);
      assert.ok(zeilen.some((z) => /^1\.1;W1;aether\.commits\.seit\|2026-11-01;wert;17;;/.test(z)), 'Teil in der Kennung');
      assert.ok(zeilen.some((z) => /^1\.1;W1;t9;text;Platzhalter-Quellen;;;$/.test(z)), 'Fußzeile „Werte vom“ nicht im Text der Quellen');
      assert.equal(r.s1.replace(/^﻿/, '').split('\r\n')[0], 'version;seite;kennung;art;wert;status', 'ohne Werte wie bisher');
      assert.deepEqual(Object.keys(r.json[0]).sort(), ['art', 'kennung', 'quelle', 'status', 'wert', 'zeit']);
    });
  });
});

describe('Dynamische Werte i) Ratenbudget und ETag', () => {
  test('höchstens 10 GitHub-Anfragen je Auffrischung; zweite Auffrischung bedingt (If-None-Match → 304, Zeit erneuert)', async () => {
    // zwei Daten für commits.seit: 9 Abrufe + 2 = 11 > 10
    const html = werteHtml().replace('</p></div><footer', ' · <span data-wert="aether.commits.seit" data-wert-teil="2026-10-01">0</span></p></div><footer');
    await mitWerten({}, async ({ page, api }) => {
      await mitPaket(page, wertePaket({ html }));
      // Erste Auffrischung überhaupt (die ersten 10 Anfragen; Auffrischungen laufen nie gleichzeitig): ohne ETag
      const erste = api.anfragen.slice(0, 10);
      assert.equal(erste.length, 10);
      assert.ok(erste.every((a) => a.inm === null), 'erste Auffrischung ohne ETag');
      assert.equal(erste.filter((a) => a.art === 'commits').length, 1, 'zweites Datum wartet auf die nächste Auffrischung');
      assert.ok((await W_(page, () => window.AetherFlyerWerte.letzte().anfragen)) <= 10);
      // Alles geändert (neue ETags): genau das Budget, nicht mehr
      api.stand = 2; api.anfragen = [];
      await auffrischen(page);
      assert.equal(api.anfragen.length, 10, 'Budget ausgeschöpft, nicht überschritten');
      assert.equal(await W_(page, () => window.AetherFlyerWerte.letzte().anfragen), 10);
      assert.equal(api.anfragen.filter((a) => a.art === 'commits').length, 1);
      const z1 = (await W_(page, () => window.AetherFlyerWerte.eintrag('aether.prs.gemergt'))).zeit;
      api.n304 = 0;
      await page.clock.runFor(60000);
      api.anfragen = [];
      await auffrischen(page);
      assert.ok(api.anfragen.length <= 10);
      assert.ok(api.anfragen.filter((a) => a.art !== 'commits' || a.since === '2026-11-01T00:00:00Z').every((a) => a.inm !== null), 'bedingt (If-None-Match)');
      assert.ok(api.n304 >= 8, '304 vom Server');
      assert.equal(api.anfragen.filter((a) => a.art === 'jobs').length, 0, 'Merge-Lauf unverändert: keine Jobs-Anfrage');
      const e = await W_(page, () => window.AetherFlyerWerte.eintrag('aether.prs.gemergt'));
      assert.ok(Date.parse(e.zeit) > Date.parse(z1), 'Zeit erneuert');
      assert.equal(e.wert, 1234);
      assert.equal(await W_(page, () => window.AetherFlyerWerte.eintrag('aether.commits.seit', '2026-10-01').wert), 17, 'jetzt auch das zweite Datum');
      // Ohne Seiten mit Werten: keine Anfrage
      await importiere(page, paketV1());
      api.anfragen = [];
      assert.deepEqual(await auffrischen(page), { anfragen: 0, ergebnis: 'leer' });
      assert.equal(api.anfragen.length, 0);
    });
  });
});

describe('Dynamische Werte j) Paket-Quelle aether-medien', () => {
  // Nachbau: aether-medien/flyer (modus 'da' | '404' | 'ohne' | '401' | '403'), alter Ort aus tests/flyer-hilfe.js
  function medienFlyer(m) {
    return async (route) => {
      const req = route.request(), url = new URL(req.url());
      if (!url.pathname.startsWith(MED + '/contents/flyer') && !url.pathname.startsWith(MED + '/git/blobs/')) return route.fallback();
      m.anfragen.push(url.pathname.replace(MED, ''));
      const cors = { 'access-control-allow-origin': '*' };
      const json = (st, o) => route.fulfill({ status: st, headers: cors, contentType: 'application/json', body: JSON.stringify(o) });
      if (m.modus === '401') return json(401, { message: 'Bad credentials' });
      if (m.modus === '403') return json(403, { message: 'Resource not accessible by personal access token' });
      if (m.modus === '404') return json(404, { message: 'Not Found' });
      if (url.pathname === MED + '/contents/flyer') return json(200, m.modus === 'ohne' ? [{ name: 'notiz.txt', type: 'file', sha: H.SHA_B }] : [{ name: 'aether-flyer-paket.json', path: 'flyer/aether-flyer-paket.json', sha: H.SHA_B, type: 'file' }]);
      if (url.pathname === MED + '/contents/flyer/aether-flyer-paket.json' || url.pathname === MED + '/git/blobs/' + H.SHA_B) return route.fulfill({ status: 200, headers: { ...cors, 'content-type': RAW }, body: m.datei });
      return json(404, { message: 'Not Found' });
    };
  }
  const altAnfragen = () => H.mock.requests.filter((p) => p.startsWith(AE_ + '/contents/docs/flyer') || p.startsWith(AE_ + '/git/blobs/'));
  test('Datei in aether-medien → von dort (gilt auch, wenn es die alte gibt), kein Hinweis', async () => {
    await mitWerten({ uhr: false }, async ({ page, context, log }) => {
      const m = { modus: 'da', anfragen: [], datei: JSON.stringify(paketV1({ version: '2026-11-23.1', stand: '2026-11-23', titel: 'Platzhalter neu' })) };
      await context.route('https://api.github.com/**', medienFlyer(m));
      await oeffneFlyer(page);
      await page.waitForFunction(() => window.AetherFlyer.stand() === 'paket');
      assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), '2026-11-23.1');
      assert.deepEqual(m.anfragen, ['/contents/flyer', '/contents/flyer/aether-flyer-paket.json']);
      assert.deepEqual(altAnfragen(), [], 'alter Ort nicht gefragt');
      assert.ok(await page.isHidden('#paketOrt'));
      assert.deepEqual(log.errors, []);
    });
  });
  test('404 bzw. Ordner ohne Datei → alter Ort mit einmaligem Hinweis (nicht wiederholend)', async () => {
    for (const modus of ['404', 'ohne']) {
      await mitWerten({ uhr: false, init: [() => { window.AETHER_TEST_FLYER_INTERVALL_MS = 200; }] }, async ({ page, context }) => {
        const m = { modus, anfragen: [], datei: '' };
        await context.route('https://api.github.com/**', medienFlyer(m));
        await page.addInitScript(() => {
          document.addEventListener('DOMContentLoaded', () => {
            window.__ortTexte = [];
            new MutationObserver(() => { const el = document.getElementById('paketOrt'); window.__ortTexte.push(el.hidden ? '' : el.textContent); }).observe(document.getElementById('paketOrt'), { childList: true, characterData: true, subtree: true, attributes: true });
          });
        });
        await oeffneFlyer(page);
        await page.waitForFunction(() => window.AetherFlyer.stand() === 'paket');
        assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), H.VERSION, `${modus}: Paket vom alten Ort`);
        assert.ok(altAnfragen().length >= 2, `${modus}: alter Ort gelesen`);
        assert.equal(await text(page, '#paketOrt'), 'Paket noch am alten Ort – bitte nach aether-medien/flyer/ hochladen');
        // weitere Prüfungen (Intervall 200 ms, „Online prüfen“): Hinweis wird nicht erneut gesetzt
        const n = m.anfragen.length;
        await page.waitForFunction((n) => window.__ortTexte && true, n);
        for (let i = 0; i < 100 && m.anfragen.length < n + 3; i++) await new Promise((r) => setTimeout(r, 30));
        assert.ok(m.anfragen.length >= n + 3, `${modus}: weiter zuerst aether-medien gefragt`);
        const setzungen = await page.evaluate(() => window.__ortTexte.filter((t) => t).length);
        assert.ok(setzungen >= 1 && setzungen <= 2, `${modus}: Hinweis einmal gesetzt (Text + hidden), nicht wiederholt (${setzungen})`);
        assert.equal(await text(page, '#paketOrt'), 'Paket noch am alten Ort – bitte nach aether-medien/flyer/ hochladen');
      });
    }
  });
  test('401/403 → wie bei den Medien: einmalige Meldung, keine automatischen Versuche dort; „Online prüfen“ fragt erneut; Paket vom alten Ort', async () => {
    for (const modus of ['401', '403']) {
      await mitWerten({ init: [() => { window.AETHER_TEST_FLYER_INTERVALL_MS = 60000; }] }, async ({ page, context }) => {
        const m = { modus, anfragen: [], datei: '' };
        await context.route('https://api.github.com/**', medienFlyer(m));
        // Meldungen mitschreiben (die nächste Meldung ersetzt den Text in #toast sofort)
        await page.addInitScript(() => {
          document.addEventListener('DOMContentLoaded', () => {
            window.__toasts = [];
            const t = document.getElementById('toast');
            new MutationObserver(() => { if (window.__toasts[window.__toasts.length - 1] !== t.textContent) window.__toasts.push(t.textContent); }).observe(t, { childList: true, characterData: true, subtree: true });
          });
        });
        await oeffneFlyer(page);
        await page.waitForFunction(() => window.AetherFlyer.stand() === 'paket');
        const kein = 'Kein Zugriff auf aether-medien – Repo anlegen bzw. den Token um das Repo erweitern';
        await page.waitForFunction((k) => window.__toasts.includes(k), kein);
        assert.equal(m.anfragen.length, 1);
        assert.equal(await page.evaluate(() => window.AetherFlyer.paket().version), H.VERSION, `${modus}: alter Ort`);
        // Intervall und online-Ereignis: keine Anfrage an aether-medien mehr
        await page.waitForFunction(() => !document.getElementById('btnOnline').disabled);
        await page.clock.runFor(60000);
        await page.evaluate(() => window.dispatchEvent(new Event('online')));
        await page.waitForFunction(() => !document.getElementById('btnOnline').disabled);
        await page.evaluate(() => window.AetherFlyerOnline.pruefe());
        assert.equal(m.anfragen.length, 1, `${modus}: keine Wiederholungsschleife`);
        // „Online prüfen“ ausdrücklich: genau einmal erneut
        await page.click('#btnOnline');
        await page.waitForFunction(() => !document.getElementById('btnOnline').disabled && !/^Prüfe/.test(document.getElementById('onlineHinweis').textContent));
        assert.equal(m.anfragen.length, 2, `${modus}: „Online prüfen“ fragt erneut`);
        assert.equal(await page.evaluate((k) => window.__toasts.filter((t) => t === k).length, kein), 1, `${modus}: Meldung genau einmal`);
      });
    }
  });
});

describe('Dynamische Werte k) Layout', () => {
  for (const viewport of [{ width: 1024, height: 768 }, { width: 1366, height: 1024 }, { width: 844, height: 390 }]) {
    test(`Tafel, Abzeichen und Fußzeile auf ${viewport.width} × ${viewport.height}: kein Überlauf, Tippflächen ≥ 44 px`, async () => {
      await mitWerten({ viewport }, async ({ page }) => {
        await mitPaket(page);
        await vollbildText(page);
        await vb(page, '.w-zahl').click();
        await page.waitForSelector('#vbWert:not([hidden])');
        await page.click('#vbWertHand');
        await page.waitForSelector('#vbWertHandZeile:not([hidden])');
        const r = await page.evaluate(() => {
          const raus = [];
          const vw = document.documentElement.clientWidth;
          for (const el of document.querySelectorAll('#vbWert, #vbWert *')) {
            if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
            const b = el.getBoundingClientRect();
            if (b.width && (b.left < -0.5 || b.right > vw + 0.5)) raus.push(el.id || el.className || el.tagName);
            if (el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).overflowX !== 'visible') raus.push('scroll:' + (el.id || el.className));
          }
          const knoepfe = [...document.querySelectorAll('#vbWert button')].filter((b) => b.offsetParent !== null).map((b) => { const x = b.getBoundingClientRect(); return [b.id, Math.round(x.width), Math.round(x.height)]; });
          const host = window.AetherFlyerAnsicht.vollbildHost(), rr = host.shadowRoot;
          const seite = rr.querySelector('.page').getBoundingClientRect();
          const abz = [...rr.querySelectorAll('[data-ae-abzeichen]')].map((a) => a.getBoundingClientRect()).filter((b) => b.width);
          const fuss = rr.querySelector('[data-ae-werte-fuss]').getBoundingClientRect();
          const ft = rr.querySelector('.ft').getBoundingClientRect();
          return { raus, knoepfe, seitenScroll: document.documentElement.scrollWidth > vw,
            abzRaus: abz.filter((b) => b.left < seite.left - 0.5 || b.right > seite.right + 0.5).length, abzahl: abz.length,
            fussIn: fuss.left >= ft.left - 0.5 && fuss.right <= ft.right + 0.5 && fuss.bottom <= seite.bottom + 0.5 };
        });
        assert.deepEqual(r.raus, [], 'nichts ragt aus dem Bildschirm');
        assert.equal(r.seitenScroll, false, 'kein waagerechtes Scrollen');
        assert.ok(r.knoepfe.length >= 4);
        for (const [id, w, h] of r.knoepfe) assert.ok(w >= 44 && h >= 44, `${id}: ${w} × ${h}`);
        assert.ok(r.abzahl > 5, 'Abzeichen sichtbar');
        assert.equal(r.abzRaus, 0, 'Abzeichen innerhalb der Seite');
        assert.ok(r.fussIn, 'Fußzeile innerhalb der Fußleiste');
      });
    });
  }
});
