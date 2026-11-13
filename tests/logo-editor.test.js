// Tests für den Logo-Editor Stufe 1 (Projekt + Schrift) in logo.html: Schriftliste und Ausgrauen je Schrift,
// Wechsel auf eine Schrift ohne Kursiv/ohne Stärke, Stärke exakt in den SVG-Pfaden (Vergleich mit den
// Schriftdateien), SVG nur aus Pfaden ohne <text>/<script>/externe Verweise mit Ebenen-Gruppen, PNG transparent in
// 1024/2048/4096 px, Bühne/PNG/SVG aus einer Beschreibung, Rückgängig/Wiederholen, Projekt sichern/laden (Rundlauf,
// kaputte und fremde Datei, unbekannte Schrift), Speicherung nach Neuladen, offline, keine fremden Server, Token in
// keinem Speicher/Cache/Projekt, Backspace im Hex-Feld, Layout (iPhone 16 Pro hoch/quer, iPad quer, Desktop),
// bestehende Logo-Funktionen unverändert (4 Anfragen, aufklappbare Karten).
// Aufruf: node --test tests/logo-editor.test.js
// Gegenproben (müssen rot werden): AETHER_GEGENPROBE=kursiv|text|kaputt|verlauf|fremd|token node --test tests/logo-editor.test.js
'use strict';

const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { chromium, devices } = require('playwright');
const { testLogo } = require('./test-png');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(__dirname, 'output');
const TOKEN = 'github_pat_11TESTTOKEN0000_mockSecretValueForTestsOnly1234567890abcdef';
const BASE = '/repos/konstantin9ezm/aether';
const COMMIT = '1234567abcdef0123456789abcdef0123456789a';
const PNG_COMMIT = 'fedcba9876543210fedcba9876543210fedcba98';
fs.mkdirSync(OUT, { recursive: true });

// ---------------------------------------------------------------------------
// Gegenproben: Stellen in logo.html, die der Testserver beim Ausliefern ersetzt
// ---------------------------------------------------------------------------
const GEGENPROBE = process.env.AETHER_GEGENPROBE || '';
const PATCHES = {
  kursiv: [["b.disabled = k && !s.kursiv;", 'b.disabled = false;']],
  text: [["ebene('schrift', '', '<path d=\"' + dText + '\" fill=\"url(#aeth-verlauf)\"/>');", "ebene('schrift', '', '<text x=\"0\" y=\"0\" font-family=\"Jost\" font-weight=\"' + z.staerke + '\" fill=\"url(#aeth-verlauf)\">Aether</text><path d=\"' + dText + '\" fill=\"none\"/>');"]],
  kaputt: [["try { o = JSON.parse(text); } catch (e) { return { fehler:'kaputt' }; }", "try { o = JSON.parse(text); } catch (e) { return normalisiere({}); }"]],
  verlauf: [['const rueckgaengig = () => springe(vpos - 1)', 'const rueckgaengig = () => springe(Math.max(0, vpos - (vpos > 2 ? 2 : 1)))']],
  fremd: [["const p = fetch(datei, { credentials:'same-origin' })", "const p = fetch('https://fonts.gstatic.com/s/' + datei, { credentials:'omit' })"]],
  token: [["einstellungen:{ ...z } };", "einstellungen:{ ...z }, token:localStorage.getItem('aether.githubToken') };"]]
};
if (GEGENPROBE && !PATCHES[GEGENPROBE]) throw new Error('Unbekannte Gegenprobe: ' + GEGENPROBE);
function logoHtml() {
  let s = fs.readFileSync(path.join(ROOT, 'logo.html'), 'utf8');
  for (const [a, b] of PATCHES[GEGENPROBE] || []) { assert.ok(s.includes(a), `Gegenprobe ${GEGENPROBE}: Stelle gefunden`); s = s.replace(a, b); }
  return s;
}

// ---------------------------------------------------------------------------
// Schrift-Lader und Geometrie aus logo.html (in Node ausgeführt, für den Vergleich mit den Schriftdateien)
// ---------------------------------------------------------------------------
function aus(src, start, ende) {
  const a = src.indexOf(start), b = src.indexOf(ende, a);
  assert.ok(a >= 0 && b > a, `Block ${start} gefunden`);
  return src.slice(a, b);
}
const HTML = fs.readFileSync(path.join(ROOT, 'logo.html'), 'utf8');
const NODE = new Function(aus(HTML, 'const SchriftLader = (() => {', '\nconst PROJEKT_KEY') + aus(HTML, '/* ---------- Geometrie ---------- */', '// Kantenfarbe') +
  'return { SchriftLader, segmente, pfadD, segBox, schiebeSeg };')();
async function erwarteterPfad(datei, abstand = 0) {
  const b = fs.readFileSync(path.join(ROOT, datei));
  const font = await NODE.SchriftLader.lade(b.buffer.slice(b.byteOffset, b.byteOffset + b.length));
  let segs = NODE.SchriftLader.textKonturen(font, 'Aether', 100, abstand).konturen.map(NODE.segmente).filter((l) => l.length);
  const bb = NODE.segBox(segs);
  segs = NODE.schiebeSeg(segs, -(bb.x1 + bb.x2) / 2, -(bb.y1 + bb.y2) / 2);
  return { d: NODE.pfadD(segs), font };
}

// Test-SVG der Arbeitsdatei: Ring hinten (rot) und Ring vorne (gelb) links/rechts der Schrift (blau), Schatten grün
const testSvg = () => Buffer.from([
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 200">',
  '  <defs><linearGradient id="ringfarbe"><stop offset="0" stop-color="#ff0000"/><stop offset="1" stop-color="#ff0000"/></linearGradient></defs>',
  '  <script>window.__pwned=1</script>',
  '  <g transform="translate(10 0)"><g id="ring-hinten"><rect x="10" y="60" width="60" height="80" fill="url(#ringfarbe)"/></g></g>',
  '  <g id="schatten"><rect x="120" y="60" width="60" height="80" fill="#00ff00"/></g>',
  '  <g id="schrift"><rect x="200" y="70" width="40" height="60" fill="#0000ff"/></g>',
  '  <g id="ring-vorne"><rect x="320" y="60" width="60" height="80" fill="#ffff00" onclick="window.__pwned=2"/></g>',
  '</svg>', ''].join('\n'), 'utf8');
const SVG = testSvg();
const PNG = testLogo();

// ---------------------------------------------------------------------------
// Server (kann „kein Netz“ spielen) und Mock-API
// ---------------------------------------------------------------------------
const net = { offline: false };
const mock = { mode: 'ok', requests: [] };
const TYPES = { '.html': 'text/html; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.js': 'text/javascript; charset=utf-8', '.txt': 'text/plain; charset=utf-8', '.woff': 'font/woff', '.ttf': 'font/ttf' };
let server, baseUrl, browser;
before(async () => {
  server = http.createServer((req, res) => {
    if (net.offline) { req.socket.destroy(); return; }
    const u = new URL(req.url, 'http://x');
    let p = path.normalize(decodeURIComponent(u.pathname)).replace(/^([/\\])+/, '');
    if (!p || p.endsWith('/')) p += 'index.html';
    if (p === 'logo.html') { res.writeHead(200, { 'content-type': TYPES['.html'] }); return res.end(logoHtml()); }
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

const CORS = { 'access-control-allow-origin': '*' };
async function githubApi(route) {
  const req = route.request();
  const url = new URL(req.url());
  const headers = await req.allHeaders();
  if (req.method() === 'OPTIONS') return route.fulfill({ status: 204, headers: { ...CORS, 'access-control-allow-methods': 'GET', 'access-control-allow-headers': 'Authorization, Accept' } });
  mock.requests.push({ path: url.pathname, query: url.search, auth: headers.authorization || null });
  if (mock.mode === 'offline') return route.abort('internetdisconnected');
  if (headers.authorization !== `Bearer ${TOKEN}`) return route.fulfill({ status: 401, headers: CORS, contentType: 'application/json', body: '{"message":"Bad credentials"}' });
  const p = url.searchParams.get('path');
  if (url.pathname === `${BASE}/contents/art/logo/logo.svg`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: SVG });
  if (url.pathname === `${BASE}/contents/game/assets/ui/logo.png`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: PNG });
  if (url.pathname === `${BASE}/commits` && p === 'art/logo/logo.svg') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ sha: COMMIT }]) });
  if (url.pathname === `${BASE}/commits` && p === 'game/assets/ui/logo.png') return route.fulfill({ status: 200, headers: CORS, contentType: 'application/json', body: JSON.stringify([{ sha: PNG_COMMIT }]) });
  if (url.pathname === `${BASE}/contents/index.json`) return route.fulfill({ status: 200, headers: { ...CORS, 'content-type': 'application/vnd.github.raw+json' }, body: '[]' });
  return route.fulfill({ status: 404, headers: CORS, contentType: 'application/json', body: '{"message":"Not Found"}' });
}

// Teilen-Dialog nachgebaut: hält Name, Typ, Bytes (als Text bzw. Pixelproben) fest
function shareMock() {
  window.__share = { calls: [] };
  navigator.canShare = (d) => !!(d && d.files && d.files.length);
  navigator.share = async (d) => {
    const active = navigator.userActivation ? navigator.userActivation.isActive : null;
    const files = await Promise.all(d.files.map(async (f) => {
      const buf = await f.arrayBuffer();
      const out = { name: f.name, type: f.type, bytes: buf.byteLength };
      if (f.type === 'image/png') {
        const v = new DataView(buf); out.w = v.getUint32(16); out.h = v.getUint32(20);
        const bmp = await createImageBitmap(f), cv = new OffscreenCanvas(bmp.width, bmp.height), ctx = cv.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const px = (x, y) => [...ctx.getImageData(Math.min(bmp.width - 1, Math.round(x * bmp.width)), Math.min(bmp.height - 1, Math.round(y * bmp.height)), 1, 1).data];
        out.ecken = [px(0, 0), px(1, 0), px(0, 1), px(1, 1)];
        const d = ctx.getImageData(0, 0, bmp.width, bmp.height).data;
        let deckend = 0, transparent = 0;
        for (let i = 3; i < d.length; i += 4 * 97) { if (d[i] > 250) deckend++; if (d[i] === 0) transparent++; }
        out.deckend = deckend; out.transparent = transparent;
      } else out.text = await f.text();
      return out;
    }));
    window.__share.calls.push({ title: d.title, files, active });
  };
}

async function newPage(opts = {}) {
  const { viewport = { width: 1194, height: 834 }, withToken = true, init, device } = opts;
  net.offline = false; mock.mode = 'ok'; mock.requests = [];
  const context = await browser.newContext({ ...(device || { viewport }), locale: 'de-DE', timezoneId: 'Europe/Berlin' });
  const page = await context.newPage();
  const log = { urls: [], errors: [] };
  page.on('pageerror', (e) => log.errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') log.errors.push(m.text()); });
  context.on('request', (r) => log.urls.push(r.url()));
  if (withToken) await context.addInitScript((t) => { if (window === window.top) localStorage.setItem('aether.githubToken', t); }, TOKEN);
  await context.addInitScript(shareMock);
  if (init) await context.addInitScript(init.fn, init.arg);
  await context.route('https://api.github.com/**', githubApi);
  await context.route(/^https?:\/\/(?!localhost|api\.github\.com)/, (r) => r.abort());
  return { context, page, log };
}
const echteFehler = (log) => log.errors.filter((e) => !/ERR_INTERNET_DISCONNECTED|Failed to load resource|net::ERR_FAILED/.test(e));
const E = (page, f, arg) => page.evaluate(f, arg);
const zustand = (page) => E(page, () => window.AetherLogoEditor.zustand());
async function bereit(page) { await page.waitForFunction(() => window.AetherLogoEditor && window.AetherLogoEditor.bereit(), null, { timeout: 20000 }); }
async function openLogo(page, { ring = true } = {}) {
  await page.goto(baseUrl + 'logo.html');
  await page.waitForFunction(() => window.AetherLogo && window.AetherLogo.stand() !== 'laden' && window.AetherLogo.pngStand() !== 'laden');
  if (ring) await page.waitForFunction(() => !['laden'].includes(window.AetherLogoEditor.ring().stand));
  await bereit(page);
}
const svgText = (page) => E(page, () => window.AetherLogoEditor.svg());
// Regler wie mit dem Finger/der Maus: viele input-Ereignisse, am Ende ein change
async function regler(page, id, wert) {
  await page.$eval('#' + id, (e, v) => {
    const a = Number(e.value), schritte = 6;
    for (let i = 1; i <= schritte; i++) { e.value = String(a + (v - a) * i / schritte); e.dispatchEvent(new Event('input', { bubbles: true })); }
    e.value = String(v); e.dispatchEvent(new Event('input', { bubbles: true })); e.dispatchEvent(new Event('change', { bubbles: true }));
  }, wert);
  await bereit(page);
}
async function schrift(page, id) { await page.selectOption('#sSchrift', id); await bereit(page); }
const tab = async (page, name) => { await page.click('#tab' + name); };
function gruppen(svg) { return [...svg.matchAll(/<g id="([^"]+)"/g)].map((m) => m[1]); }
function pfadVon(svg, id) { const m = new RegExp(`<g id="${id}"[^>]*><path d="([^"]+)"`).exec(svg); return m && m[1]; }
const STIL = { 100: 'Thin', 200: 'ExtraLight', 300: 'Light', 500: 'Medium', 600: 'SemiBold', 700: 'Bold', 800: 'ExtraBold', 900: 'Black' };
const SCHRIFTEN = [
  ['jost', 'Jost', [100, 200, 300, 400, 500, 600, 700, 800, 900], true],
  ['exo-2', 'Exo 2', [100, 200, 300, 400, 500, 600, 700, 800, 900], true],
  ['orbitron', 'Orbitron', [400, 500, 600, 700, 800, 900], false],
  ['rajdhani', 'Rajdhani', [300, 400, 500, 600, 700], false],
  ['saira', 'Saira', [100, 200, 300, 400, 500, 600, 700, 800, 900], true],
  ['space-grotesk', 'Space Grotesk', [300, 400, 500, 600, 700], false],
  ['michroma', 'Michroma', [400], false],
  ['audiowide', 'Audiowide', [400], false]
];
// Datei je Schrift/Stärke/Stil (unabhängig vom Katalog in logo.html)
const dateiFuer = (id, w, k) => id === 'orbitron' ? `fonts/orbitron/Orbitron-${w === 400 ? 'Regular' : STIL[w]}.ttf` : id === 'audiowide' ? 'fonts/audiowide/Audiowide-Regular.ttf' : `fonts/${id}/${id}-latin-${w}-${k ? 'italic' : 'normal'}.woff`;
const START = { schrift: 'jost', staerke: 500, kursiv: false, abstand: 0, farbe1: '#8C7CF0', farbe2: '#C4BBFF', tiefe: 0, richtung: 'so', umriss: 0, umrissFarbe: '#1B1838', effekt: 'schatten', weich: 0, ringHinten: true, ringVorne: true };

// ---------------------------------------------------------------------------
describe('Logo-Editor: Schriften', () => {
  test('Schriftdateien: Lizenz, Prüfsummen, alle Stärken/Stile vorhanden, Buchstaben von „Aether“, richtige Stärke je Datei', async () => {
    const sums = fs.readFileSync(path.join(ROOT, 'fonts/SHA256SUMS'), 'utf8').trim().split('\n').map((l) => l.split(/\s+/));
    const dateien = fs.readdirSync(path.join(ROOT, 'fonts'), { recursive: true }).filter((f) => fs.statSync(path.join(ROOT, 'fonts', f)).isFile() && f !== 'SHA256SUMS').sort();
    assert.deepEqual(sums.map((s) => s[1]).sort(), dateien, 'SHA256SUMS listet genau die Dateien in fonts/');
    for (const [sum, f] of sums) assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, 'fonts', f))).digest('hex'), sum, `Prüfsumme ${f}`);
    const sw = fs.readFileSync(path.join(ROOT, 'sw.js'), 'utf8');
    const swListe = [...aus(sw, 'var SCHRIFT_DATEIEN = [', '];').matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    const erwartet = [];
    for (const [id, name, staerken, kursiv] of SCHRIFTEN) {
      const lizenz = fs.readFileSync(path.join(ROOT, 'fonts', id, 'OFL.txt'), 'utf8');
      assert.match(lizenz, /SIL OPEN FONT LICENSE Version 1\.1/, `${name}: OFL 1.1`);
      assert.doesNotMatch(lizenz, /GNU|GPL/, `${name}: kein GPL`);
      const rfn = /Reserved Font Name/i.test(lizenz.split('\n')[0]);
      assert.equal(rfn, ['orbitron', 'audiowide'].includes(id), `${name}: Reserved Font Name wie im Bericht`);
      for (const w of staerken) for (const k of kursiv ? [false, true] : [false]) {
        const datei = dateiFuer(id, w, k);
        erwartet.push(datei);
        const { font } = await erwarteterPfad(datei);
        for (const c of 'Aether') assert.ok(font.glyphe(c.codePointAt(0)) > 0, `${datei}: Zeichen ${c}`);
        const stil = w === 400 ? (k ? 'Italic' : 'Regular') : STIL[w] + (k ? ' Italic' : '');
        assert.equal(font.vollname, `${name} ${stil}`, `${datei}: Stärke/Stil laut Datei`);
        assert.equal(font.kursiv, k, `${datei}: Kursiv-Kennung`);
      }
    }
    assert.deepEqual(swListe, [...erwartet].sort(), 'sw.js hält genau alle Schriftdateien vor');
    assert.equal(erwartet.length, 72);
    // RFN-Schriften: unveränderte Originale (TTF, Prüfsummen der Quelle)
    const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(path.join(ROOT, f))).digest('hex');
    assert.equal(sha('fonts/audiowide/Audiowide-Regular.ttf'), 'c7c0f2b0f6fad8c623e31772ce79f94a4edb9321ffce9fce978ea892d20ae730');
    const wf = fs.readFileSync(path.join(ROOT, '.github/workflows/pages.yml'), 'utf8');
    assert.match(wf, /cp -r fonts _site\//, 'Pages veröffentlicht fonts/');
  });

  test('Schriftliste und Ausgrauen je Schrift (Stärken und Kursiv)', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    assert.deepEqual(await page.$$eval('#sSchrift option', (os) => os.map((o) => [o.value, o.textContent])), SCHRIFTEN.map((s) => [s[0], s[1]]));
    assert.deepEqual(await zustand(page), START, 'Startzustand = heutiges Logo');
    for (const [id, name, staerken, kursiv] of SCHRIFTEN) {
      await schrift(page, id);
      const st = await page.$$eval('#sStaerke button', (bs) => bs.map((b) => ({ w: Number(b.dataset.w), aus: b.disabled, op: Number(getComputedStyle(b).opacity) })));
      assert.deepEqual(st.filter((b) => !b.aus).map((b) => b.w), staerken, `${name}: wählbare Stärken`);
      for (const b of st.filter((x) => x.aus)) assert.ok(b.op < 0.6, `${name} ${b.w}: ausgegraut`);
      const k = await page.$eval('#sStil [data-kursiv="1"]', (b) => ({ aus: b.disabled, op: Number(getComputedStyle(b).opacity) }));
      assert.equal(k.aus, !kursiv, `${name}: Kursiv ${kursiv ? 'wählbar' : 'ausgegraut'}`);
      if (!kursiv) {
        assert.ok(k.op < 0.6);
        await page.click('#sStil [data-kursiv="1"]', { force: true });
        await page.waitForTimeout(50);
        assert.equal((await zustand(page)).kursiv, false, `${name}: Kursiv nicht wählbar`);
      }
      // ausgegraute Stärke lässt sich nicht wählen
      const aus = st.find((b) => b.aus);
      if (aus) {
        await page.click(`#sStaerke [data-w="${aus.w}"]`, { force: true });
        await page.waitForTimeout(50);
        assert.ok(staerken.includes((await zustand(page)).staerke), `${name}: Stärke ${aus.w} nicht wählbar`);
      }
    }
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Wechsel auf eine Schrift ohne Kursiv bzw. ohne die Stärke: nächster vorhandener Wert mit Meldung', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    await page.click('#sStaerke [data-w="300"]');
    await page.click('#sStil [data-kursiv="1"]');
    await bereit(page);
    assert.deepEqual([(await zustand(page)).staerke, (await zustand(page)).kursiv], [300, true]);
    await schrift(page, 'orbitron');
    let z = await zustand(page);
    assert.deepEqual([z.schrift, z.staerke, z.kursiv], ['orbitron', 400, false]);
    assert.equal(await page.textContent('#editorMeldung'), 'Orbitron hat keine Stärke 300 – 400 gewählt · Orbitron hat kein Kursiv – Normal gewählt');
    assert.equal(await page.getAttribute('#sStil [data-kursiv="0"]', 'aria-pressed'), 'true');
    // 900 → Rajdhani (bis 700) → 700; Michroma → 400; Gleichstand nimmt die schwerere Stärke
    await page.click('#sStaerke [data-w="900"]'); await bereit(page);
    await schrift(page, 'rajdhani');
    assert.equal((await zustand(page)).staerke, 700);
    assert.equal(await page.textContent('#editorMeldung'), 'Rajdhani hat keine Stärke 900 – 700 gewählt');
    await schrift(page, 'michroma');
    assert.equal((await zustand(page)).staerke, 400);
    // zurück auf Jost: Stärke bleibt 400, Kursiv bleibt aus (keine stille Rückkehr)
    await schrift(page, 'jost');
    z = await zustand(page);
    assert.deepEqual([z.staerke, z.kursiv], [400, false]);
    assert.equal(await page.textContent('#editorMeldung'), '');
    // ein Schritt je Schriftwechsel; Rückgängig stellt Orbitron-Zustand und dann Jost 300 kursiv her
    await page.click('#btnUndo'); await page.click('#btnUndo'); await page.click('#btnUndo'); await page.click('#btnUndo'); await bereit(page);
    z = await zustand(page);
    assert.deepEqual([z.schrift, z.staerke, z.kursiv], ['orbitron', 400, false]);
    await page.click('#btnUndo'); await bereit(page);
    z = await zustand(page);
    assert.deepEqual([z.schrift, z.staerke, z.kursiv], ['jost', 300, true]);
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
describe('Logo-Editor: SVG und PNG aus einer Beschreibung', () => {
  test('Stärke exakt in den Pfaden: verschiedene Stärken → verschiedene Pfade, gleiche Einstellung → gleiche Pfade, Pfad = Schriftdatei', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    for (const [id, , staerken, kursiv] of SCHRIFTEN) {
      await schrift(page, id);
      const pfade = new Map();
      for (const k of kursiv ? [false, true] : [false]) {
        await page.click(`#sStil [data-kursiv="${k ? 1 : 0}"]`); await bereit(page);
        for (const w of staerken) {
          await page.click(`#sStaerke [data-w="${w}"]`); await bereit(page);
          const svg = await svgText(page), d = pfadVon(svg, 'schrift');
          assert.ok(d && d.length > 200, `${id} ${w}: Pfad vorhanden`);
          const datei = dateiFuer(id, w, k);
          assert.ok((await E(page, (i) => window.AetherLogoEditor.schriften().find((s) => s.id === i), id)).dateien.includes(datei), `${datei} im Katalog`);
          assert.equal(d, (await erwarteterPfad(datei)).d, `${id} ${w}${k ? ' kursiv' : ''}: Pfad = Umriss aus ${datei}`);
          pfade.set(`${w}${k}`, d);
        }
      }
      assert.equal(new Set(pfade.values()).size, pfade.size, `${id}: jede Stärke/Stil ergibt einen eigenen Pfad`);
    }
    // gleiche Einstellung → byte-gleiches SVG (auch nach Umweg)
    await schrift(page, 'jost');
    await page.click('#sStaerke [data-w="700"]'); await bereit(page);
    const a = await svgText(page);
    await page.click('#sStaerke [data-w="300"]'); await bereit(page);
    await page.click('#sStaerke [data-w="700"]'); await bereit(page);
    assert.equal(await svgText(page), a, 'gleiche Einstellung, gleiches SVG');
    // Buchstabenabstand ändert die Pfade (wie im Lader berechnet)
    await regler(page, 'sAbstand', 12);
    const datei = 'fonts/jost/jost-latin-700-normal.woff';
    assert.equal(pfadVon(await svgText(page), 'schrift'), (await erwarteterPfad(datei, 12)).d, 'Abstand 12 px');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('SVG: nur Pfade (kein <text>, kein <script>, keine externen Verweise, keine Schriftdatei), Ebenen als Gruppen in fester Reihenfolge', async () => {
    const { context, page, log } = await newPage({ init: { fn: () => { window.__pwned = undefined; } } });
    await openLogo(page);
    assert.equal((await E(page, () => window.AetherLogoEditor.ring())).stand, 'bereit');
    const pruefe = (svg, label) => {
      assert.doesNotMatch(svg, /<text[\s>]/i, `${label}: kein <text>`);
      assert.doesNotMatch(svg, /<script/i, `${label}: kein <script>`);
      assert.doesNotMatch(svg, /@font-face|font-family|\.woff|\.ttf|data:font|<style/i, `${label}: keine Schrift eingebettet`);
      assert.doesNotMatch(svg, /\son[a-z]+\s*=/i, `${label}: keine Handler`);
      assert.doesNotMatch(svg, /foreignObject|<image|<use/i, `${label}: keine Einbettungen`);
      for (const m of svg.matchAll(/(?:href|src)\s*=\s*"([^"]*)"/gi)) assert.match(m[1], /^#/, `${label}: Verweis ${m[1]} intern`);
      for (const m of svg.matchAll(/url\(([^)]*)\)/g)) assert.match(m[1], /^#/, `${label}: url(${m[1]}) intern`);
      const urls = [...svg.matchAll(/https?:\/\/[^\s"'<>)]+/g)].map((x) => x[0]);
      assert.deepEqual([...new Set(urls)], ['http://www.w3.org/2000/svg'], `${label}: nur der SVG-Namensraum`);
    };
    // Start: Ring hinten, Schatten, Schrift, Ring vorne
    let svg = await svgText(page);
    pruefe(svg, 'Start');
    assert.deepEqual(gruppen(svg), ['ring-hinten', 'schatten', 'schrift', 'ring-vorne']);
    // Alles an: Tiefe, Umriss, Schatten weich
    await regler(page, 'sTiefe', 14);
    await regler(page, 'sUmriss', 3);
    await regler(page, 'sWeich', 8);
    svg = await svgText(page);
    pruefe(svg, 'alles an');
    assert.deepEqual(gruppen(svg), ['ring-hinten', 'schatten', 'tiefe', 'schrift', 'umriss', 'ring-vorne']);
    assert.match(svg, /<filter id="aeth-weich"[^>]*><feGaussianBlur stdDeviation="4"\/><\/filter>/, 'Weichheit als SVG-Filter');
    assert.match(svg, /<linearGradient id="aeth-verlauf" gradientUnits="userSpaceOnUse"[^>]*><stop offset="0" stop-color="#8C7CF0"\/><stop offset="1" stop-color="#C4BBFF"\/>/, 'Verlauf als SVG-Verlauf');
    assert.match(svg, /<linearGradient id="aeth-kante"[^>]*><stop offset="0" stop-color="#4D4484"\/><stop offset="1" stop-color="#6C678C"\/>/, 'Kante dunkler aus dem Verlauf');
    assert.match(svg, /<g id="umriss"><path d="[^"]+" fill="none" stroke="#1B1838" stroke-width="3" stroke-linejoin="round"\/><\/g>/, 'Umriss als Kontur');
    // Leuchten statt Schatten, Ringe einzeln aus
    await page.click('#sEffekt [data-effekt="leuchten"]'); await bereit(page);
    await tab(page, 'Ring');
    await page.click('label[data-ring="hinten"]'); await bereit(page);
    svg = await svgText(page);
    pruefe(svg, 'Leuchten');
    assert.deepEqual(gruppen(svg), ['leuchten', 'tiefe', 'schrift', 'umriss', 'ring-vorne']);
    await page.click('label[data-ring="vorne"]'); await bereit(page);
    await tab(page, 'Schrift');
    await page.click('#sEffekt [data-effekt="aus"]'); await bereit(page);
    assert.deepEqual(gruppen(await svgText(page)), ['tiefe', 'schrift', 'umriss']);
    // Ring aus der Arbeitsdatei: bereinigt (kein onclick, kein script), Gradient der Datei übernommen, Vorfahren-Transformation erhalten
    await tab(page, 'Ring');
    await page.click('label[data-ring="hinten"]'); await page.click('label[data-ring="vorne"]'); await bereit(page);
    svg = await svgText(page);
    pruefe(svg, 'mit Ring');
    assert.match(svg, /<linearGradient id="ringfarbe"/);
    assert.match(svg, /<g id="ring-hinten" transform="scale\([0-9.]+\) translate\(-200 -100\)"><g [^>]*transform="translate\(10 0\)"><g><rect x="10"/, 'Ringmitte auf Schriftmitte, Transformation der Datei');
    assert.equal(await E(page, () => window.__pwned), undefined, 'nichts aus der Arbeitsdatei ausgeführt');
    // Maßstab: Höhe der Schrift-Gruppe der Datei (60) ↔ Jost 500 bei Größe 100
    const r = await E(page, () => window.AetherLogoEditor.ring());
    const jost = (await erwarteterPfad('fonts/jost/jost-latin-500-normal.woff')).font;
    const bb = NODE.segBox(NODE.SchriftLader.textKonturen(jost, 'Aether', 100, 0).konturen.map(NODE.segmente));
    assert.ok(Math.abs(r.k - (bb.y2 - bb.y1) / 60) < 0.02, `Maßstab ${r.k}`);
    assert.deepEqual(Object.values(r.box).map(Math.round), [20, 60, 380, 140], 'Ring-Box aus der Datei');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('PNG: transparent, Breite 1024/2048/4096, Seitenverhältnis wie das SVG; Bühne, PNG und SVG aus derselben Beschreibung', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    await regler(page, 'sTiefe', 14);
    await tab(page, 'Ausgabe');
    const svg = await svgText(page);
    // Bühne zeigt genau das SVG der Datei
    const buehne = await E(page, async () => (await (await fetch(document.getElementById('editorBild').src)).text()));
    assert.equal(buehne, svg, 'Bühne = SVG-Datei');
    await page.click('#btnEditorSvg');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    let c = await E(page, () => window.__share.calls[0]);
    assert.equal(c.active, true, 'Teilen innerhalb der Nutzergeste');
    assert.match(c.files[0].name, /^aether-logo-projekt-\d{8}-\d{4}\.svg$/);
    assert.equal(c.files[0].type, 'image/svg+xml');
    assert.equal(c.files[0].text, svg, 'SVG-Datei = Beschreibung');
    const vb = /viewBox="([-\d.]+) ([-\d.]+) ([\d.]+) ([\d.]+)"/.exec(svg).slice(1).map(Number);
    let n = 1;
    for (const w of [1024, 2048, 4096]) {
      await page.click(`#eBreite [data-w="${w}"]`);
      await page.waitForFunction(() => window.AetherLogoEditor.pngBereit(), null, { timeout: 20000 });
      const quelle = await E(page, () => window.AetherLogoEditor.pngSvg());
      const h = Math.round(w * vb[3] / vb[2]);
      assert.equal(quelle, svg.replace(/width="[^"]+" height="[^"]+"/, `width="${w}" height="${h}"`), `${w}: PNG-Quelle = SVG mit Pixelmaßen`);
      await page.click('#btnEditorPng');
      n++;
      await page.waitForFunction((n) => window.__share.calls.length === n, n, { timeout: 30000 });
      c = await E(page, (n) => window.__share.calls[n - 1], n);
      const f = c.files[0];
      assert.match(f.name, new RegExp(`^aether-logo-projekt-\\d{8}-\\d{4}-${w}\\.png$`));
      assert.deepEqual([f.type, f.w, f.h], ['image/png', w, h], `${w}: Maße`);
      for (const e of f.ecken) assert.equal(e[3], 0, `${w}: Ecke transparent`);
      assert.ok(f.transparent > 0 && f.deckend > 0, `${w}: transparenter Hintergrund und deckende Schrift`);
    }
    // Pixelvergleich Bühne ↔ PNG (beide auf 400 px Breite)
    const diff = await E(page, async () => {
      const img = document.getElementById('editorBild');
      const W = 400, H = Math.round(W * img.naturalHeight / img.naturalWidth);
      const a = new OffscreenCanvas(W, H).getContext('2d'); a.drawImage(img, 0, 0, W, H);
      const p = new Image(); p.src = URL.createObjectURL(new Blob([window.AetherLogoEditor.pngSvg()], { type: 'image/svg+xml' })); await p.decode();
      const b = new OffscreenCanvas(W, H).getContext('2d'); b.drawImage(p, 0, 0, W, H);
      const x = a.getImageData(0, 0, W, H).data, y = b.getImageData(0, 0, W, H).data;
      let s = 0; for (let i = 0; i < x.length; i++) s += Math.abs(x[i] - y[i]);
      return s / x.length;
    });
    assert.ok(diff < 3, `Bühne und PNG sehen gleich aus (mittlere Abweichung ${diff.toFixed(2)})`);
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
describe('Logo-Editor: Rückgängig, Projekt, Speicher', () => {
  test('Rückgängig/Wiederholen stellt exakt die vorherigen Zustände her; ein Zug am Regler = ein Schritt; mindestens 50 Schritte', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    assert.equal(await page.isDisabled('#btnUndo'), true);
    assert.equal(await page.isDisabled('#btnRedo'), true);
    const staende = [await zustand(page)];
    const schritte = [
      () => regler(page, 'sAbstand', 10), () => page.click('#sStaerke [data-w="700"]'), () => page.click('#sStil [data-kursiv="1"]'),
      () => regler(page, 'sTiefe', 14), () => page.click('#sRichtung [data-r="no"]'), () => regler(page, 'sUmriss', 2.5),
      () => page.fill('#sUmrissHex', '#FF00AA').then(() => page.press('#sUmrissHex', 'Enter')), () => page.click('#sEffekt [data-effekt="leuchten"]'),
      () => regler(page, 'sWeich', 9), () => schrift(page, 'saira'), () => page.$eval('#sFarbe1', (e) => { e.value = '#112233'; e.dispatchEvent(new Event('input')); e.value = '#123456'; e.dispatchEvent(new Event('input')); e.dispatchEvent(new Event('change')); }),
      async () => { await tab(page, 'Ring'); await page.click('label[data-ring="vorne"]'); await tab(page, 'Schrift'); }
    ];
    for (const s of schritte) { await s(); await bereit(page); staende.push(await zustand(page)); }
    for (let i = 1; i < staende.length; i++) assert.notDeepEqual(staende[i], staende[i - 1], `Schritt ${i} ändert etwas`);
    assert.deepEqual(await E(page, () => window.AetherLogoEditor.verlauf().laenge), staende.length, 'je Aktion genau ein Schritt (Regler: keine Zwischenwerte)');
    assert.deepEqual(staende[staende.length - 1].umrissFarbe, '#FF00AA');
    assert.deepEqual(staende[staende.length - 1].farbe1, '#123456');
    // zurück bis zum Start, jeder Zwischenstand exakt
    for (let i = staende.length - 2; i >= 0; i--) {
      await page.click('#btnUndo'); await bereit(page);
      assert.deepEqual(await zustand(page), staende[i], `Rückgängig → Stand ${i}`);
    }
    assert.equal(await page.isDisabled('#btnUndo'), true);
    // Strg+Z / Strg+Umschalt+Z
    for (let i = 1; i < staende.length; i++) {
      if (i % 2) await page.click('#btnRedo'); else await page.keyboard.press('Control+Shift+Z');
      await bereit(page);
      assert.deepEqual(await zustand(page), staende[i], `Wiederholen → Stand ${i}`);
    }
    await page.keyboard.press('Control+Z'); await bereit(page);
    assert.deepEqual(await zustand(page), staende[staende.length - 2], 'Strg+Z');
    // neue Änderung nach Rückgängig verwirft die Zukunft
    await page.click('#sStaerke [data-w="300"]'); await bereit(page);
    assert.equal(await page.isDisabled('#btnRedo'), true);
    // 60 Schritte, davon mindestens 50 zurück
    for (let i = 0; i < 60; i++) await regler(page, 'sAbstand', -20 + (i % 70));
    const v = await E(page, () => window.AetherLogoEditor.verlauf());
    assert.ok(v.max >= 50 && v.laenge >= 51, `mindestens 50 Schritte (${v.laenge})`);
    const vorher = [];
    for (let i = 0; i < 50; i++) { vorher.push((await zustand(page)).abstand); await page.click('#btnUndo'); }
    await bereit(page);
    assert.equal((await zustand(page)).abstand, -20 + (9 % 70), '50 Schritte zurück');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Projekt sichern/laden: Rundlauf, kaputte Datei, fremde Datei, falsche Version, unbekannte Schrift; Token nie in der Datei', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    await schrift(page, 'exo-2');
    await page.click('#sStaerke [data-w="800"]'); await page.click('#sStil [data-kursiv="1"]');
    await regler(page, 'sTiefe', 9); await page.click('#sRichtung [data-r="sw"]');
    await bereit(page);
    const gesichert = await zustand(page);
    await page.click('#btnProjSichern');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const f = (await E(page, () => window.__share.calls[0])).files[0];
    assert.match(f.name, /^aether-logo-projekt-\d{8}-\d{4}\.json$/);
    assert.equal(f.type, 'application/json');
    const o = JSON.parse(f.text);
    assert.deepEqual(Object.keys(o), ['format', 'version', 'text', 'gespeichert', 'einstellungen']);
    assert.deepEqual([o.format, o.version, o.text], ['aether-logo-projekt', 1, 'Aether']);
    assert.deepEqual(o.einstellungen, gesichert);
    assert.ok(!f.text.includes(TOKEN) && !/github_pat_|token/i.test(f.text), 'kein Token in der Projektdatei');
    // ändern, dann die Datei laden → Zustand exakt zurück (ein Schritt, rückgängig machbar)
    await schrift(page, 'audiowide');
    const geaendert = await zustand(page);
    const datei = (name, inhalt, mimeType = 'application/json') => ({ name, mimeType, buffer: Buffer.from(inhalt) });
    await page.setInputFiles('#projDatei', datei('p.json', f.text));
    await bereit(page);
    assert.deepEqual(await zustand(page), gesichert, 'Rundlauf');
    assert.equal(await page.textContent('#editorMeldung'), 'Projekt geladen');
    await page.click('#btnUndo'); await bereit(page);
    assert.deepEqual(await zustand(page), geaendert, 'Laden ist ein Schritt');
    // Fehlerfälle: Meldung, Projekt und Speicher unverändert
    const speicher = await E(page, () => localStorage.getItem('aether.logoProjekt'));
    const faelle = [
      ['kaputt.json', f.text.slice(0, 40), 'Die Projektdatei ist beschädigt – das aktuelle Projekt bleibt unverändert.'],
      ['leer.json', '', 'Die Projektdatei ist beschädigt – das aktuelle Projekt bleibt unverändert.'],
      ['fremd.json', JSON.stringify({ name: 'etwas anderes', einstellungen: { schrift: 'orbitron' } }), 'Das ist keine Logo-Projektdatei – das aktuelle Projekt bleibt unverändert.'],
      ['liste.json', '[1,2,3]', 'Das ist keine Logo-Projektdatei – das aktuelle Projekt bleibt unverändert.'],
      ['bild.png', PNG, 'Die Projektdatei ist beschädigt – das aktuelle Projekt bleibt unverändert.'],
      ['v2.json', JSON.stringify({ ...o, version: 2 }), 'Projektdatei-Version 2 wird nicht unterstützt – das aktuelle Projekt bleibt unverändert.'],
      ['ohne.json', JSON.stringify({ format: 'aether-logo-projekt', version: 1 }), 'Die Projektdatei ist beschädigt – das aktuelle Projekt bleibt unverändert.']
    ];
    const v0 = await E(page, () => window.AetherLogoEditor.verlauf());
    for (const [name, inhalt, text] of faelle) {
      await page.setInputFiles('#projDatei', datei(name, inhalt, name.endsWith('.png') ? 'image/png' : 'application/json'));
      await page.waitForFunction((t) => document.getElementById('editorMeldung').textContent === t, text);
      assert.deepEqual(await zustand(page), geaendert, `${name}: Projekt unverändert`);
      assert.equal(await E(page, () => localStorage.getItem('aether.logoProjekt')), speicher, `${name}: Speicher unverändert`);
      assert.deepEqual(await E(page, () => window.AetherLogoEditor.verlauf()), v0, `${name}: kein Schritt`);
      await page.evaluate(() => { document.getElementById('editorMeldung').textContent = ''; });
    }
    // unbekannte Schrift → Jost mit Meldung; unpassende Werte werden begrenzt
    await page.setInputFiles('#projDatei', datei('alt.json', JSON.stringify({ ...o, einstellungen: { ...o.einstellungen, schrift: 'Comic Sans', tiefe: 999, richtung: 'quer', farbe1: 'rot' } })));
    await bereit(page);
    const z = await zustand(page);
    assert.deepEqual([z.schrift, z.staerke, z.kursiv, z.tiefe, z.richtung, z.farbe1], ['jost', 800, true, 40, 'so', '#8C7CF0']);
    assert.equal(await page.textContent('#editorMeldung'), 'Projekt geladen · Schrift „Comic Sans“ ist unbekannt – Jost gewählt');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Speicherung nach Neuladen (localStorage „aether.logoProjekt“), ohne Token; ohne Arbeitsdatei läuft das Projekt ohne Ring mit Hinweis', async () => {
    const { context, page, log } = await newPage({ withToken: false });
    await openLogo(page);
    // ohne Token und ohne gespeicherte Arbeitsdatei: kein Ring, Hinweis, Schalter aus
    assert.equal((await E(page, () => window.AetherLogoEditor.ring())).stand, 'keine');
    assert.deepEqual(gruppen(await svgText(page)), ['schatten', 'schrift']);
    await tab(page, 'Ring');
    assert.equal((await page.textContent('#ringHinweis')).trim(), 'Keine Arbeitsdatei gespeichert – das Projekt läuft ohne Ring. Einmal online (mit Token) öffnen, dann kommt der Ring aus art/logo/logo.svg.');
    assert.equal(await page.isDisabled('#rHinten'), true);
    assert.equal(await page.isDisabled('#rVorne'), true);
    assert.match(await page.textContent('#panelRing'), /Ring bearbeiten folgt in Stufe 2\./);
    await tab(page, 'Schrift');
    await schrift(page, 'space-grotesk');
    await page.click('#sStaerke [data-w="600"]'); await regler(page, 'sUmriss', 1.5);
    const z = await zustand(page);
    await page.reload();
    await openLogo(page);
    assert.deepEqual(await zustand(page), z, 'nach Neuladen wieder da');
    assert.equal(await page.inputValue('#sSchrift'), 'space-grotesk');
    assert.equal(await page.getAttribute('#sStaerke [data-w="600"]', 'aria-pressed'), 'true');
    const gespeichert = JSON.parse(await E(page, () => localStorage.getItem('aether.logoProjekt')));
    assert.deepEqual([gespeichert.format, gespeichert.version], ['aether-logo-projekt', 1]);
    assert.deepEqual(gespeichert.einstellungen, z);
    // kaputter Speicher → Startzustand, keine Fehlermeldung
    await E(page, () => localStorage.setItem('aether.logoProjekt', '{kaputt'));
    await page.reload(); await openLogo(page);
    assert.deepEqual(await zustand(page), START);
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
describe('Logo-Editor: Offline, Netz, Token', () => {
  test('offline: Editor und alle acht Schriften aus der App-Hülle, mit Ring der gespeicherten Arbeitsdatei', async () => {
    const { context, page, log } = await newPage();
    await page.goto(baseUrl);
    assert.ok(await E(page, () => Promise.race([navigator.serviceWorker.ready.then(() => true), new Promise((r) => setTimeout(() => r(false), 15000))])), 'Service Worker aktiv');
    const keys = await E(page, async () => (await (await caches.open('aether-shell-v1')).keys()).map((r) => new URL(r.url).pathname));
    const schriftKeys = keys.filter((k) => k.startsWith('/fonts/'));
    assert.equal(schriftKeys.length, 72, 'alle Schriftdateien in der App-Hülle');
    await openLogo(page);
    const groesse = await E(page, async () => { let n = 0; const c = await caches.open('aether-shell-v1'); for (const r of await c.keys()) if (new URL(r.url).pathname.startsWith('/fonts/')) n += (await (await c.match(r)).arrayBuffer()).byteLength; return n; });
    assert.ok(groesse > 1.3e6 && groesse < 1.6e6, `Größe der Schriften im Cache: ${groesse}`);
    net.offline = true; mock.mode = 'offline';
    await context.setOffline(true);
    await page.reload();
    await openLogo(page);
    assert.equal(await E(page, () => window.AetherLogo.stand()), 'offline');
    assert.equal((await E(page, () => window.AetherLogoEditor.ring())).stand, 'bereit', 'Ring aus der gespeicherten Arbeitsdatei');
    for (const [id, , staerken, kursiv] of SCHRIFTEN) {
      await schrift(page, id);
      await page.click(`#sStaerke [data-w="${staerken[staerken.length - 1]}"]`); await bereit(page);
      if (kursiv) { await page.click('#sStil [data-kursiv="1"]'); await bereit(page); await page.click('#sStil [data-kursiv="0"]'); await bereit(page); }
      assert.ok(pfadVon(await svgText(page), 'schrift').length > 200, `${id} offline gezeichnet`);
    }
    await page.screenshot({ path: path.join(OUT, 'logo-editor-offline.png') });
    net.offline = false;
    await context.setOffline(false);
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('keine Anfrage an fremde Server; Schriften nur vom eigenen Ursprung; beim Öffnen weiter genau 4 API-Anfragen', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    for (const [id] of SCHRIFTEN) await schrift(page, id);
    const fremd = log.urls.filter((u) => !u.startsWith(baseUrl) && !u.startsWith('https://api.github.com/') && !u.startsWith('blob:') && !u.startsWith('data:'));
    assert.deepEqual(fremd, [], 'keine fremden Server');
    const schriften = log.urls.filter((u) => /\.(woff2?|ttf|otf)(\?|$)/.test(u));
    assert.ok(schriften.length >= 8 && schriften.every((u) => u.startsWith(baseUrl + 'fonts/')), 'Schriften nur aus fonts/ des eigenen Ursprungs');
    assert.deepEqual(mock.requests.map((r) => r.path + (r.path.endsWith('/commits') ? '?' + new URLSearchParams(r.query).get('path') : '')).sort(),
      [`${BASE}/commits?art/logo/logo.svg`, `${BASE}/commits?game/assets/ui/logo.png`, `${BASE}/contents/art/logo/logo.svg`, `${BASE}/contents/game/assets/ui/logo.png`], 'genau die 4 bisherigen Anfragen');
    assert.doesNotMatch(HTML, /fonts\.googleapis|fonts\.gstatic|@import|<link[^>]+stylesheet/i);
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  test('Token in keinem Speicher, keinem Cache und keinem Projekt', async () => {
    const { context, page, log } = await newPage();
    await page.goto(baseUrl);
    await E(page, () => Promise.race([navigator.serviceWorker.ready, new Promise((r) => setTimeout(r, 15000))]));
    await openLogo(page);
    await schrift(page, 'orbitron');
    await page.click('#btnProjSichern');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const st = await E(page, async (token) => {
      const ls = Object.keys(localStorage).filter((k) => k !== 'aether.githubToken').map((k) => [k, localStorage.getItem(k)]);
      const cache = [];
      for (const name of await caches.keys()) {
        const c = await caches.open(name);
        for (const req of await c.keys()) {
          const body = new TextDecoder('latin1').decode(await (await c.match(req)).arrayBuffer());
          cache.push({ url: req.url, token: body.includes(token) || req.url.includes(token), auth: req.headers.get('authorization') });
        }
      }
      return { ls, ss: Object.keys(sessionStorage), cache, dbs: indexedDB.databases ? (await indexedDB.databases()).map((d) => d.name) : [], datei: window.__share.calls[0].files[0].text, svg: window.AetherLogoEditor.svg() };
    }, TOKEN);
    assert.ok(st.ls.some(([k]) => k === 'aether.logoProjekt') && st.ls.some(([k]) => k === 'aether.logo'), 'Projekt und Arbeitsdatei gespeichert');
    for (const [k, v] of st.ls) assert.ok(!v.includes(TOKEN) && !v.includes('github_pat_'), `kein Token in ${k}`);
    assert.deepEqual(Object.keys(JSON.parse(st.ls.find(([k]) => k === 'aether.logoProjekt')[1])), ['format', 'version', 'text', 'gespeichert', 'einstellungen']);
    assert.deepEqual(st.ss, []);
    assert.deepEqual(st.dbs, []);
    for (const c of st.cache) { assert.ok(!c.token && !c.auth, `kein Token im Cache: ${c.url}`); assert.ok(!c.url.includes('api.github.com'), `keine API im Cache: ${c.url}`); }
    assert.ok(!st.datei.includes(TOKEN) && !/github_pat_|"token"/i.test(st.datei), 'kein Token in der Projektdatei');
    assert.ok(!st.svg.includes(TOKEN), 'kein Token im SVG');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });
});

// ---------------------------------------------------------------------------
describe('Logo-Editor: Bedienung und Layout', () => {
  test('Backspace im Hex-Feld löscht nur Zeichen (kein Rückgängig, kein Schließen); außerhalb schließt es den Dialog', async () => {
    const { context, page, log } = await newPage({ init: { fn: () => { delete navigator.share; delete navigator.canShare; delete Navigator.prototype.share; delete Navigator.prototype.canShare; delete HTMLAnchorElement.prototype.download; } } });
    await openLogo(page);
    await page.click('#sStaerke [data-w="700"]'); await bereit(page);
    const z = await zustand(page), v = await E(page, () => window.AetherLogoEditor.verlauf());
    await page.click('#sFarbe2Hex');
    await page.press('#sFarbe2Hex', 'End');
    for (let i = 0; i < 3; i++) await page.keyboard.press('Backspace');
    assert.equal(await page.inputValue('#sFarbe2Hex'), '#C4B', 'Zeichen gelöscht');
    await page.waitForTimeout(100);
    assert.deepEqual(await zustand(page), z, 'Projekt unverändert (Backspace hat nichts rückgängig gemacht)');
    assert.deepEqual(await E(page, () => window.AetherLogoEditor.verlauf()), v);
    assert.equal(page.url(), baseUrl + 'logo.html', 'Seite bleibt');
    await page.keyboard.type('CDD');
    await page.press('#sFarbe2Hex', 'Enter'); await bereit(page);
    assert.equal((await zustand(page)).farbe2, '#C4BCDD', 'Hex-Eingabe übernommen');
    // Dialog „Lange drücken“ (ohne Teilen und Download): Backspace außerhalb eines Textfelds schließt ihn
    await tab(page, 'Ausgabe');
    await page.click('#btnProjSichern');
    await page.waitForSelector('#modal:not([hidden])');
    assert.match(await page.textContent('#mText'), /Link lange drücken/);
    await page.keyboard.press('Backspace');
    assert.ok(await page.isHidden('#modal'), 'Backspace = zurück');
    assert.deepEqual((await zustand(page)).farbe2, '#C4BCDD', 'Backspace außerhalb macht nichts rückgängig');
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });

  const GERAETE = [
    ['iPhone 16 Pro hoch', { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['iPhone 16 Pro quer', { viewport: { width: 874, height: 402 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true }],
    ['iPad quer', { viewport: { width: 1194, height: 834 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['iPad hoch', { viewport: { width: 834, height: 1194 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }],
    ['Desktop', { viewport: { width: 1440, height: 900 } }],
    ['schmal 320', { viewport: { width: 320, height: 568 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true }]
  ];
  for (const [name, device] of GERAETE) {
    test(`Layout ${name}: kein waagerechtes Scrollen, Tippflächen ≥ 44 × 44 px, Regler per Touch ohne Seiten-Scrollen`, async () => {
      const { context, page, log } = await newPage({ device });
      await openLogo(page);
      const W = device.viewport.width;
      for (const t of ['Schrift', 'Ring', 'Ausgabe']) {
        await tab(page, t);
        await page.waitForTimeout(50);
        const m = await E(page, () => {
          const ziele = [...document.querySelectorAll('#editorKarte button, #editorKarte a, #editorKarte label.check, #editorKarte select, #editorKarte input:not([type="file"]):not([type="checkbox"]), .klapp')].filter((e) => e.offsetParent !== null);
          return {
            overflow: document.documentElement.scrollWidth - window.innerWidth,
            karte: document.getElementById('editorKarte').scrollWidth - document.getElementById('editorKarte').clientWidth,
            ziele: ziele.map((e) => { const r = e.getBoundingClientRect(); return { t: (e.id || e.textContent.trim()).slice(0, 24), w: r.width, h: r.height, x0: r.left, x1: r.right }; }),
            regler: [...document.querySelectorAll('input[type="range"]')].map((e) => getComputedStyle(e).touchAction)
          };
        });
        assert.ok(m.overflow <= 0, `${name}/${t}: kein waagerechtes Scrollen (${m.overflow})`);
        assert.ok(m.karte <= 0, `${name}/${t}: Karte läuft nicht über`);
        for (const z of m.ziele) {
          assert.ok(z.w >= 44 && z.h >= 44, `${name}/${t}: Tippfläche „${z.t}“ ${z.w}×${z.h}`);
          assert.ok(z.x0 >= -0.5 && z.x1 <= W + 0.5, `${name}/${t}: „${z.t}“ im Fenster`);
        }
        assert.ok(m.regler.every((v) => v === 'none'), `${name}: Regler fangen Touch ab`);
        if (t === 'Schrift') await page.screenshot({ path: path.join(OUT, `logo-editor-${name.replace(/\s+/g, '-').toLowerCase()}.png`), fullPage: true });
      }
      // Bühne oben, darunter die Reiter, darunter die zugeklappten Karten
      const r = await E(page, () => Object.fromEntries(['editorBuehne', 'tabSchrift', 'klappSvg', 'klappPng'].map((id) => [id, document.getElementById(id).getBoundingClientRect().toJSON()])));
      assert.ok(r.editorBuehne.bottom <= r.tabSchrift.top && r.tabSchrift.bottom <= r.klappSvg.top && r.klappSvg.bottom <= r.klappPng.top + 0.5, `${name}: Reihenfolge Bühne → Reiter → Karten`);
      if (device.hasTouch) {
        // Ziehen am Regler (Touch) ändert den Wert, nicht die Scroll-Position
        await tab(page, 'Schrift');
        const box = await page.$eval('#sTiefe', (e) => { e.scrollIntoView({ block: 'center' }); const b = e.getBoundingClientRect(); return { x: b.left, y: b.top + b.height / 2, w: b.width }; });
        const y0 = await E(page, () => window.scrollY);
        const cdp = await context.newCDPSession(page);
        const pt = (x, y) => [{ x, y }];
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: pt(box.x + 8, box.y) });
        for (let i = 1; i <= 8; i++) await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: pt(box.x + 8 + i * box.w / 20, box.y - i * 12) });
        await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
        await page.waitForTimeout(200);
        assert.equal(await E(page, () => window.scrollY), y0, `${name}: Seite scrollt beim Ziehen am Regler nicht`);
      }
      assert.deepEqual(echteFehler(log), []);
      await context.close();
    });
  }

  test('bestehende Logo-Funktionen: Karten zugeklappt unter dem Editor, aufklappbar, Inhalt und Sichern wie bisher', async () => {
    const { context, page, log } = await newPage();
    await openLogo(page);
    // Standard zugeklappt
    assert.deepEqual(await page.$$eval('.klapp', (bs) => bs.map((b) => [b.id, b.textContent.replace(/\s+/g, ' ').trim(), b.getAttribute('aria-expanded')])),
      [['klappSvg', 'Arbeitsdatei (SVG)', 'false'], ['klappPng', 'Im Spiel (PNG) – so zeigt das Startmenü das Logo', 'false']]);
    for (const id of ['logoInhalt', 'ebenenKarte', 'pngInhalt']) assert.ok(await page.isHidden('#' + id), `${id} zu`);
    // Inhalte sind trotzdem geladen (gleicher Ablauf wie bisher)
    assert.equal(await E(page, () => window.AetherLogo.stand()), 'online');
    assert.equal(await E(page, () => window.AetherLogo.pngStand()), 'online');
    // aufklappen
    await page.click('#klappSvg');
    assert.ok(await page.isVisible('#logoBild') && await page.isVisible('#ebenenKarte') && await page.isHidden('#pngInhalt'));
    await page.click('#klappPng');
    assert.ok(await page.isVisible('#pngBild'));
    // Hintergrund-Schalter gilt für alle drei Bühnen
    await page.click('#hintergrund [data-bg="kariert"]');
    assert.deepEqual(await E(page, () => ['editorBuehne', 'buehne', 'pngBuehne'].map((id) => document.getElementById(id).dataset.bg)), ['kariert', 'kariert', 'kariert']);
    // SVG sichern der Arbeitsdatei: byte-gleich wie bisher
    await page.click('#btnSvg');
    await page.waitForFunction(() => window.__share.calls.length === 1);
    const c = await E(page, () => window.__share.calls[0].files[0]);
    assert.deepEqual([c.name, c.type, c.text], ['aether-logo-1234567.svg', 'image/svg+xml', SVG.toString('utf8')]);
    // zuklappen
    await page.click('#klappSvg');
    assert.ok(await page.isHidden('#logoInhalt') && await page.isHidden('#ebenenKarte'));
    // Speicherschlüssel wie bisher
    const ls = await E(page, () => ({ logo: Object.keys(JSON.parse(localStorage.getItem('aether.logo'))).sort(), png: Object.keys(JSON.parse(localStorage.getItem('aether.logoPng'))).sort() }));
    assert.deepEqual(ls, { logo: ['commit', 'geladen', 'svg'], png: ['geladen', 'png', 'sha'] });
    await page.screenshot({ path: path.join(OUT, 'logo-editor-karten.png'), fullPage: true });
    assert.deepEqual(echteFehler(log), []);
    await context.close();
  });
});
