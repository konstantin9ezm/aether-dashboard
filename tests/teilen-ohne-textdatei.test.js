// Teilen ohne Textdatei: statische Prüfung über das ganze Repo.
//
// Auf iPhone/iPad sichert „In Dateien sichern“ einen beim Teilen mitgegebenen title/text als eigene kleine Textdatei
// („Text“, „Text 2“ …) neben der eigentlichen Datei. Darum bekommt navigator.share überall, wo eine Datei geteilt
// wird, genau { files } (README „Teilen auf iPhone/iPad: nur files übergeben“).
//
// Geprüft wird jeder Aufruf navigator.share(…) in den .html/.js/.mjs-Dateien des Repos (ohne node_modules, vendor,
// tests): Er muss ein Objekt-Literal übergeben. Enthält es files, darf daneben nichts stehen. Ohne files (bewusst nur
// Text/Link teilen) sind title, text und url erlaubt – dabei entsteht keine zusätzliche Datei.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const AUSLASSEN = new Set(['node_modules', 'vendor', 'tests', '.git', '.github']);
const NUR_TEXT_ERLAUBT = new Set(['title', 'text', 'url']);

function quelldateien(dir = ROOT, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (AUSLASSEN.has(e.name)) continue;
    const r = rel ? rel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...quelldateien(path.join(dir, e.name), r));
    else if (/\.(html|js|mjs)$/.test(e.name)) out.push(r);
  }
  return out.sort();
}

// Text ab einer öffnenden Klammer bis zur passenden schließenden (Zeichenketten und Verschachtelung beachtet).
function klammerInhalt(src, start) {
  const zu = { '(': ')', '[': ']', '{': '}' };
  const stapel = [];
  for (let i = start; i < src.length; i++) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === '\\') i++;
      continue;
    }
    if (zu[ch]) stapel.push(zu[ch]);
    else if (ch === ')' || ch === ']' || ch === '}') {
      if (stapel.pop() !== ch) return null;
      if (!stapel.length) return src.slice(start + 1, i);
    }
  }
  return null;
}

// Oberste Ebene eines Objekt-Literals an Kommas trennen.
function teile(inhalt) {
  const teile = [];
  let tiefe = 0, akt = '';
  for (let i = 0; i < inhalt.length; i++) {
    const ch = inhalt[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const a = i;
      for (i++; i < inhalt.length && inhalt[i] !== ch; i++) if (inhalt[i] === '\\') i++;
      akt += inhalt.slice(a, i + 1);
      continue;
    }
    if ('([{'.includes(ch)) tiefe++;
    if (')]}'.includes(ch)) tiefe--;
    if (ch === ',' && tiefe === 0) { teile.push(akt.trim()); akt = ''; continue; }
    akt += ch;
  }
  if (akt.trim()) teile.push(akt.trim());
  return teile;
}

// Prüft das Argument eines navigator.share-Aufrufs. Rückgabe: null (in Ordnung) oder der Grund.
function pruefeArgument(arg) {
  const a = arg.trim();
  if (!a.startsWith('{') || klammerInhalt(a, 0) === null || klammerInhalt(a, 0).length !== a.length - 2) {
    return 'kein Objekt-Literal – nicht prüfbar, ob neben files ein title/text steht';
  }
  const schluessel = [];
  for (const t of teile(klammerInhalt(a, 0))) {
    const m = /^(?:['"]?)([A-Za-z_$][\w$]*)(?:['"]?)\s*(?::|$)/.exec(t);
    if (!m) return 'Eintrag nicht lesbar: ' + t;
    schluessel.push(m[1]);
  }
  if (schluessel.includes('files')) {
    const fremd = schluessel.filter((k) => k !== 'files');
    return fremd.length ? 'neben files steht ' + fremd.join(', ') + ' (iPhone/iPad sichert das als eigene Textdatei)' : null;
  }
  const fremd = schluessel.filter((k) => !NUR_TEXT_ERLAUBT.has(k));
  return fremd.length ? 'unbekannte Schlüssel: ' + fremd.join(', ') : null;
}

// Alle Aufrufe navigator.share(…) einer Quelltext-Zeichenkette (auch navigator?.share(…) und navigator['share'](…)).
function aufrufe(src) {
  const out = [];
  const re = /navigator\s*(?:\?\.\s*share|\.\s*share|\[\s*['"]share['"]\s*\])\s*\(/g;
  for (const m of src.matchAll(re)) {
    const auf = m.index + m[0].length - 1;
    const arg = klammerInhalt(src, auf);
    out.push({ zeile: src.slice(0, m.index).split('\n').length, arg: arg === null ? '' : arg.replace(/\s+/g, ' ').trim() });
  }
  return out;
}

describe('Teilen ohne Textdatei: navigator.share im ganzen Repo', () => {
  test('Gegenkontrolle: die Prüfung erkennt title/text neben files und lässt reine Text-/Link-Aufrufe zu', () => {
    const ok = ['{ files }', '{ files: files }', '{ files: vb.dateien }', '{ files: [d.datei] }', '{ title: "Aether", url: location.href }', '{ text: t }'];
    const rot = ["{ files, title:'Aether – Logo' }", "{ files: files, text: 'x' }", '{ title: t, files }', "{ files, url: 'https://x' }", 'daten', '{ ...daten }', '{ files, [k]: 1 }'];
    for (const a of ok) assert.equal(pruefeArgument(a), null, `erlaubt: ${a}`);
    for (const a of rot) assert.notEqual(pruefeArgument(a), null, `erkannt: ${a}`);
    const quelle = "x();\nnavigator.share({ files, title:'a(b)' }).then(f);\nnavigator?.share({ files });\nnavigator['share']({ text: 'y' });\nnavigator.share = async (d) => {};";
    assert.deepEqual(aufrufe(quelle), [
      { zeile: 2, arg: "{ files, title:'a(b)' }" },
      { zeile: 3, arg: '{ files }' },
      { zeile: 4, arg: "{ text: 'y' }" }
    ], 'Aufrufe samt Klammern in Zeichenketten gefunden, Zuweisungen nicht');
  });

  test('jeder Aufruf, der eine Datei teilt, übergibt nur { files }; nur Text/Link ohne Datei ist erlaubt', () => {
    const gefunden = [], fehler = [];
    for (const rel of quelldateien()) {
      const src = fs.readFileSync(path.join(ROOT, rel), 'utf8');
      for (const a of aufrufe(src)) {
        gefunden.push(rel);
        const grund = pruefeArgument(a.arg);
        if (grund) fehler.push(`${rel}:${a.zeile}: navigator.share(${a.arg}) – ${grund}`);
      }
    }
    assert.deepEqual(fehler, [], 'navigator.share mit title/text neben files erzeugt auf iPhone/iPad eine zusätzliche Textdatei');
    // Die bekannten Stellen werden gefunden (sonst wäre die Prüfung wirkungslos)
    for (const datei of ['logo.html', 'screen-editor.html', 'flyer-export.js', 'flyer-bearbeiten.js', 'flyer-medien-tafeln.js']) {
      assert.ok(gefunden.includes(datei), `${datei}: Teilen-Aufruf gefunden`);
    }
  });
});
