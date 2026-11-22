// Teil 3 PowerPoint-Export: Messung mit dem echten Flyer-Paket – NUR LOKAL. Das Paket ist privat und liegt nie im Repo:
// Der Test läuft nur, wenn FLYER_ECHT=<Pfad zur Paketdatei> gesetzt ist, sonst wird er übersprungen (so auch in der CI).
// Er exportiert „Alle als PowerPoint“ (dieselben Seiten wie „Alle als PDF“) in beiden Formaten im Chromium und gibt
// nur Zahlen und Kennungen aus: Folienzahl, Dateigröße, Dauer, größte Einzelfolie (JPEG), verkleinerte Seiten.
// Die Dateien selbst landen – wenn FLYER_AUSGABE gesetzt ist – dort (außerhalb des Repos), sonst nirgends.
// Aufruf: FLYER_ECHT=/pfad/aether-flyer-paket.json [FLYER_AUSGABE=/tmp/x] node --test tests/flyer-pptx-messung.test.js
'use strict';

const { test, before, after } = require('node:test');
const fs = require('node:fs');
const path = require('node:path');
const H = require('./flyer-hilfe');
const { assert } = H;

const ECHT = process.env.FLYER_ECHT || '';
const AUSGABE = process.env.FLYER_AUSGABE || '';
// Ziel aus dem Auftrag: 30 Seiten unter ca. 25 MB
const ZIEL_BYTES = 25 * 1024 * 1024;

before(async () => { if (ECHT) await H.starte(); });
after(async () => { if (ECHT) await H.beende(); });

test('Messung: „Alle als PowerPoint“ mit dem echten Paket in A4 hochkant und 16:9 quer (Größe, Dauer, größte Folie)', { skip: !ECHT && 'FLYER_ECHT nicht gesetzt (nur lokal, das echte Paket kommt nie in die CI)', timeout: 900000 }, async () => {
  const zeilen = [];
  await H.mitSeite({ init: AUSGABE ? [() => { window.__ausgabe = true; }] : [] }, async ({ page, log }) => {
    await H.oeffneFlyer(page);
    await page.setInputFiles('#dateiImport', ECHT);
    await page.waitForFunction(() => window.AetherFlyerAnsicht.paket() && document.getElementById('dateiImport').value === '');
    await H.ruhe(page);
    assert.equal(await page.evaluate(() => window.AetherFlyerPptx.bereit()), true);
    const n = await page.evaluate(() => window.AetherFlyerExport.druckListe().length);
    zeilen.push(`Seiten „Alle als PDF“ = „Alle als PowerPoint“: ${n} (Knopf: ${await H.text(page, '#btnAllePptx')})`);
    for (const format of ['a4', '16x9']) {
      const r = await page.evaluate(async (format) => {
        const X = window.AetherFlyerPptx, EX = window.AetherFlyerExport;
        const e = await X.exportiere(EX.druckListe(), { format, name: 'messung-' + format + '.pptx', titel: 'Messung' });
        let b64 = null;
        if (window.__ausgabe) {
          const b = new Uint8Array(await e.datei.arrayBuffer());
          let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000));
          b64 = btoa(s);
        }
        return { bytes: e.datei.size, ms: e.ms, folien: e.folien, groesste: e.groessteFolie, verkleinert: e.verkleinert, b64 };
      }, format);
      assert.equal(r.folien, n);
      if (AUSGABE && r.b64) { fs.mkdirSync(AUSGABE, { recursive: true }); fs.writeFileSync(path.join(AUSGABE, 'messung-' + format + '.pptx'), Buffer.from(r.b64, 'base64')); }
      zeilen.push(`${format}: ${r.folien} Folien, ${(r.bytes / 1048576).toFixed(1)} MB (${r.bytes} Bytes), ${(r.ms / 1000).toFixed(1)} s, ` +
        `größte Folie ${r.groesste.id} ${(r.groesste.bytes / 1048576).toFixed(2)} MB, verkleinert: ${r.verkleinert.length ? r.verkleinert.join(', ') : 'keine'}` +
        (r.bytes > ZIEL_BYTES ? ' – ÜBER DEM ZIEL' : ' – unter dem Ziel'));
      assert.ok(r.bytes < ZIEL_BYTES, `${format}: ${r.bytes} Bytes unter ca. 25 MB`);
    }
    assert.deepEqual(log.errors, []);
  }).catch((e) => { console.log(zeilen.join('\n')); throw e; });
  console.log(zeilen.join('\n'));
});
