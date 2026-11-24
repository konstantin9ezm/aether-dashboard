// Export der Flyer-Seite (flyer.html, Teil D): „Alle als PDF“ und „PDF“ (Drucken der Dokumente in #druck über
// window.print – im Druckdialog „Als PDF sichern“) sowie „Bild“ (PNG des offenen Dokuments in doppelter Auflösung).
// Ohne Bibliothek: Das Bild entsteht über SVG/foreignObject → Image → Canvas → PNG; Schriften (fonts/…) werden
// dafür als data:-URL eingebettet, weil ein SVG-Bild nichts nachladen darf. Paket-Inhalte kommen nur über
// AetherFlyerAnsicht.darstellen (DOMParser, Shadow DOM) und XMLSerializer – nie als HTML-Text ins Dokument.
// Das Aussehen kommt allein aus dem Paket-CSS (im Druck gelten dessen @media-print-Regeln von selbst, im Bild steht
// es wörtlich mit .ae-wurzel statt :root/html/body). Hier wird nichts gestaltet außer der Lage auf der Druckseite.
// Druck: nichts hinzufügen, was die PDF-Ansicht von iPhone/iPad als Fläche zeichnet (keine box-shadow, kein
// background-clip:text, kein filter, keine Verläufe mit Transparenz) – dieses Modul setzt im Druck nur position und zoom.
// Kein Speicher: nichts wird im Browser abgelegt; geladen wird nur fonts/… vom eigenen Ursprung (fürs Bild).
// Teil 2: Druck und Bild zeigen dieselbe Änderungsschicht wie Kacheln und Vollbild (AetherFlyerAnsicht.optionen mit
// ort 'druck' bzw. 'bild'); nach einer Änderung ('flyer:aenderungen') wird ein vorbereitetes Bild verworfen und neu
// vorbereitet. Blob-URLs eines Downloads werden nach FREIGABE_MS wieder freigegeben (weitergeben).
// F3a: seitenBild(dok, optionen, messen) zeichnet eine Seite genauso wie „Bild“ (für den Export „Grafiken & Daten“,
// flyer-grafik.js) und misst dabei die Grafiken auf der dargestellten Wurzel; svgAusschnitt schneidet daraus eine SVG.
//
// Safari-Eigenheiten (iPhone/iPad), soweit bekannt und hier berücksichtigt:
// - SVG mit foreignObject als Bild: Safari meldet „load“ teils, bevor die eingebetteten Schriften/Bilder im SVG
//   bereit sind; der erste drawImage zeichnet dann Ersatzschrift oder nichts. Deshalb wird das Bild beim Öffnen und
//   Blättern des Vollbilds vorbereitet, dekodiert und „aufgewärmt“ (zweimal klein auf ein Canvas gezeichnet, mit
//   Pause) – beim Antippen wird es synchron gezeichnet. document.fonts sagt über Schriften im SVG-Bild nichts.
// - Canvas „tainted“: ältere WebKit-Fassungen markierten ein Canvas nach drawImage eines SVG mit foreignObject als
//   fremd, toDataURL wirft dann SecurityError. Chromium tut das heute noch, wenn das SVG aus einer blob:-URL kommt
//   (aus einer data:-URL nicht) – darum hier data:-URLs statt Blob-URLs. Die Selbstprobe beim Einrichten (kleines SVG
//   mit foreignObject als data:-URL → Canvas → Pixel lesen → toDataURL) prüft genau diesen Weg; scheitert sie, bleibt
//   „Bild“ verborgen. Fehler beim echten Bild → „Bild“ aus.
// - Maßstab im SVG-Bild: WebKit (Safari, alle Browser auf iPhone/iPad) wendet einen Maßstab oder eine Verschiebung
//   des SVG (viewBox ≠ width/height, transform) nicht auf HTML im foreignObject an, das eine eigene Ebene hat
//   (position, overflow, opacity, transform … – die Flyer-Seite selbst: position:relative; overflow:hidden). Ein
//   über die viewBox auf doppelte Größe gezogenes Seitenbild zeigte die Seite deshalb nur einfach groß oben links
//   (ein Viertel des Bildes, Rest leer) – unabhängig von devicePixelRatio. Darum ist das SVG-Bild der Seite genau
//   1 : 1 (width/height = Seitenmaß in CSS-Pixeln, keine viewBox); vergrößert wird erst beim Zeichnen auf das Canvas
//   (drawImage mit Zielgröße – das SVG wird dabei als Vektor in Zielgröße gezeichnet, bleibt also scharf). Aus
//   demselben Grund verschiebt svgAusschnitt den Inhalt per CSS (negative Ränder) statt über die viewBox.
// - Canvas-Größe: Safari auf iPhone/iPad zeichnet höchstens 16 777 216 Pixel (4096 × 4096) je Canvas; größer
//   bleibt es leer und toDataURL liefert „data:,“. Größere Bilder werden proportional verkleinert (mit Meldung), das
//   Canvas danach sofort freigegeben (Breite/Höhe 0), weil iOS auch den Canvas-Speicher insgesamt begrenzt.
// - Teilen: navigator.share braucht eine frische Nutzergeste – darum alles synchron im Klick, vorher mitGeste(ev).
//   Übergeben werden nur die Dateien ({ files }): title/text sichert iOS bei „In Dateien sichern“ als eigene kleine
//   Textdatei („Text“, „Text 2“ …) neben der Datei.
// - window.print: auf iOS kehrt es sofort zurück (der Dialog ist nicht blockierend), auf dem Desktop erst nach dem
//   Dialog. In der Home-Bildschirm-App (standalone) öffnete iOS lange gar keinen Druckdialog; ob das heute noch gilt,
//   ist unsicher. Darum dort ein Hinweis, wenn nach dem Aufruf kein „beforeprint“ kommt.
// - @page (size, margin): ältere Safari-Fassungen beachten size nicht; iOS druckt dann im Papierformat der Region
//   (in Deutschland A4) – der Flyer ist genau 210 × 297 mm groß und passt so trotzdem auf eine Seite.
(function () {
  'use strict';

  // Druck: A4-Breite in CSS-Pixeln (210 mm bei 96 px/Zoll = 793,7 px); Infografiken per zoom auf diese Breite.
  const A4_BREITE_PX = 793.7;
  // Bild: doppelte Auflösung, höchstens 16 777 216 Pixel (Canvas-Grenze von Safari auf iPhone/iPad).
  const BILD_FAKTOR = 2;
  const MAX_PIXEL = 16777216;
  // Selbst gewählt: Zeitlimits fürs Laden einer eingebetteten Datei (fonts/…) und fürs Laden des SVG-Bilds,
  // Höchstgröße einer eingebetteten Datei, Pause beim Aufwärmen (Safari), Zeitlimit der Selbstprobe.
  const DATEI_FRIST_MS = 10000;
  const BILD_FRIST_MS = 15000;
  const MAX_DATEI_BYTES = 4 * 1024 * 1024;
  const AUFWAERM_MS = 200;
  const PROBE_FRIST_MS = 5000;
  // Selbst gewählt: so lange nach window.print() auf „beforeprint“ warten, bevor die Home-Bildschirm-App einen
  // Hinweis zeigt.
  const DRUCK_HINWEIS_MS = 2500;
  // Selbst gewählt: Blob-URL eines Downloads 60 s nach dem Klick freigeben (Safari fragt beim Download erst nach; so
  // lange muss die URL gelten). Tests setzen window.AETHER_TEST_FLYER_FREIGABE_MS vor dem Laden.
  const FREIGABE_MS = (typeof window.AETHER_TEST_FLYER_FREIGABE_MS === 'number' && window.AETHER_TEST_FLYER_FREIGABE_MS >= 0)
    ? window.AETHER_TEST_FLYER_FREIGABE_MS : 60000;
  const XHTML = 'http://www.w3.org/1999/xhtml';
  // Verweise auf fonts/… in url(…)/src(…) (bereinigeCss lässt nur data:, fonts/ ohne „..“ und – in fill, stroke,
  // clip-path, filter, marker* – #… stehen).
  const FONTS_URL = /\b(?:url|src)\(\s*(?:"(fonts\/[^"\\\n]*)"|'(fonts\/[^'\\\n]*)'|(fonts\/[^"'()\\\s]*))\s*\)/gi;
  const MIME = { woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', otf: 'font/otf', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif' };

  const $ = (id) => document.getElementById(id);
  const G = () => window.AetherGemeinsam;
  const A = () => window.AetherFlyerAnsicht;
  const P = () => window.AetherFlyerPaket;
  const meldung = (t) => { try { G().meldung(t); } catch (e) { /* ohne #toast keine Meldung */ } };

  /* ---------- Zustand ---------- */
  let eingerichtet = false;
  let druckNr = 0;            // zählt Druckvorbereitungen (späte Nachmessungen alter Vorbereitungen verwerfen)
  let druckBereit = false;    // #druck wurde für den laufenden Druck vorbereitet (bis „afterprint“)
  let druckGesehen = false;   // „beforeprint“ seit dem letzten window.print() gekommen
  let bildMoeglich = false;   // Selbstprobe bestanden und kein „tainted“ Canvas
  let bild = null;            // vorbereitetes Bild: { dok, paket, zustand:'laedt'|'bereit'|'fehler', img, w, h, … }
  let bildFehlerDok = null;   // Dokument, bei dem das Zeichnen scheiterte („Bild“ dafür verborgen)
  const dateiCache = new Map();   // Pfad fonts/… → Promise<data:-URL|null> (nur im Speicher)

  /* ---------- Hilfen ---------- */
  function leeren(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function warte(ms) { return new Promise((r) => setTimeout(r, ms)); }
  function art(dok) { return dok && dok.art === 'infografik' ? 'infografik' : 'flyer'; }
  function base64(u8) { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
  // SVG-Text → data:-URL (UTF-8, base64). Keine Blob-URL: Chromium markiert das Canvas sonst als „tainted“.
  function svgDatenUrl(svg) { return 'data:image/svg+xml;base64,' + base64(new TextEncoder().encode(svg)); }
  // Darstellungs-Optionen der Ansicht (Teil 2: Änderungsschicht) für ort 'druck' | 'bild'
  function optionenFuer(dok, ort) {
    const a = A();
    return a && typeof a.optionen === 'function' ? a.optionen(dok, ort) : undefined;
  }
  // Datei über eine Blob-URL herunterladen; die URL wird nach FREIGABE_MS freigegeben (kein Speicherleck).
  function herunterladenUndFreigeben(datei) {
    const url = URL.createObjectURL(datei);
    try { G().herunterladen(url, datei.name); } finally {
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (e) { /* egal */ } }, FREIGABE_MS);
    }
    return url;
  }
  function homeBildschirmApp() {
    try { return navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches; } catch (e) { return false; }
  }

  /* ---------- Knöpfe ---------- */
  // „Alle als PDF“: „Alle“ → alle Flyer der Version (Reihenfolge des Pakets), sonst alle Dokumente des geöffneten Ordners;
  // ausgeblendete Seiten nie (F3a).
  function druckListe() {
    const a = A();
    const pk = a ? a.paket() : null;
    if (!pk || !Array.isArray(pk.dokumente)) return [];
    if (a.aktuelleKategorie() === 'alle') return pk.dokumente.filter((d) => d && d.art === 'flyer' && d.ausgeblendet !== true);
    return a.aktuelleListe().filter((d) => d.ausgeblendet !== true);
  }
  function knopfAllePdf() {
    const b = $('btnAllePdf');
    if (!b) return;
    const n = druckListe().length;
    b.textContent = 'Alle als PDF (' + n + ')';
    b.disabled = n === 0;
  }
  function knopfBild() {
    const b = $('vbBild');
    if (!b) return;
    const a = A();
    const dok = a ? a.offenesDokument() : null;
    b.hidden = !bildMoeglich || !dok || dok === bildFehlerDok;
  }

  /* ---------- Druck ---------- */
  // #druck ist auf dem Bildschirm display:none – dann ist nichts messbar. Für die Schriftanpassung kurz (synchron,
  // ohne dass dazwischen gezeichnet wird) unsichtbar und außerhalb des Bildes darstellen, danach zurück.
  function messbar(fn) {
    const d = $('druck');
    if (!d) return fn();
    const alt = d.getAttribute('style');
    d.style.cssText = 'display:block;position:absolute;left:-100000px;top:0;visibility:hidden;pointer-events:none';
    try { return fn(); } finally {
      if (alt === null) d.removeAttribute('style'); else d.setAttribute('style', alt);
    }
  }

  // Leert #druck und stellt die Dokumente dort dar: je Dokument eine .druck-seite (Flyer: 794 × 1123 px auf
  // 210 × 297 mm, Rest abgeschnitten; Infografik: per zoom auf Seitenbreite, im Fluss, damit sie über mehrere Seiten
  // umbricht). Schriftanpassung je Flyer sofort (synchron) und nach dem Laden der Schriften noch einmal.
  // Promise: wenn alle Dokumente fertig angepasst sind (Ergebnisse von darstellen().fertig).
  function druckvorbereitung(doks) {
    const nr = ++druckNr;
    const ziel = $('druck');
    const a = A();
    if (!ziel) return Promise.resolve([]);
    leeren(ziel);
    if (!a || !Array.isArray(doks) || !doks.length) return Promise.resolve([]);
    const fertige = [];
    messbar(() => {
      const flyer = [];
      for (const dok of doks) {
        if (!dok) continue;
        const seite = document.createElement('div');
        seite.className = 'druck-seite ' + (art(dok) === 'infografik' ? 'druck-ig' : 'druck-flyer');
        seite.setAttribute('data-id', String(dok.id));
        ziel.appendChild(seite);
        let d;
        try { d = a.darstellen(dok, seite, optionenFuer(dok, 'druck')); } catch (e) { seite.remove(); continue; }   // Dokument ohne Inhalt
        if (art(dok) === 'infografik') {
          // Im Fluss statt absolut (sonst hätte die Seite keine Höhe und nichts bräche um); zoom statt transform,
          // damit Layout und Seitenumbruch die verkleinerte Höhe kennen.
          const breite = dok.breite > 0 ? dok.breite : 1080;
          d.host.style.position = 'static';
          d.host.style.zoom = String(A4_BREITE_PX / breite);
        } else {
          flyer.push(d.wurzel);
        }
        fertige.push(d.fertig.then((r) => {
          // Nach dem Laden der Schriften mit echter Messung nachziehen (darstellen misst im verborgenen #druck nicht).
          if (nr === druckNr && art(dok) === 'flyer' && d.wurzel.isConnected) {
            try { messbar(() => a.schriftAnpassen(d.wurzel)); } catch (e) { /* bleibt beim letzten Stand */ }
          }
          return r;
        }, () => null));
      }
      // Sofort anpassen, damit ein direkt folgendes window.print() schon die passende Schriftgröße hat.
      for (const w of flyer) { try { a.schriftAnpassen(w); } catch (e) { /* weiter mit dem nächsten */ } }
    });
    return Promise.all(fertige);
  }

  // Vorbereiten und window.print() – direkt in der Klick-Behandlung (iPad: öffnet Drucken/Teilen).
  function drucke(doks) {
    if (!doks || !doks.length) { meldung('Nichts zu drucken'); return false; }
    druckvorbereitung(doks);
    if (typeof window.print !== 'function') { meldung('Drucken ist in diesem Browser nicht möglich'); return false; }
    druckBereit = true;
    druckGesehen = false;
    try { window.print(); } catch (e) { druckBereit = false; meldung('Drucken ist in diesem Browser nicht möglich'); return false; }
    if (homeBildschirmApp()) {
      setTimeout(() => {
        if (!druckGesehen) meldung('Falls sich kein Druckdialog öffnet: das Dashboard in Safari öffnen und dort drucken.');
      }, DRUCK_HINWEIS_MS);
    }
    return true;
  }
  function druckeAlle() { return drucke(druckListe()); }
  function druckeEins(dok) {
    const a = A();
    const d = dok && typeof dok === 'object' && 'html' in dok ? dok : (a ? a.offenesDokument() : null);
    return drucke(d ? [d] : []);
  }
  // Drucken ohne Vorbereitung (z. B. Teilen-Menü → Drucken, Strg+P): offenes Vollbild-Dokument, sonst die aktuelle Liste.
  function vorDemDruck() {
    druckGesehen = true;
    if (druckBereit) return;
    const a = A();
    if (!a) return;
    const offen = a.offenesDokument();
    druckvorbereitung(offen ? [offen] : a.aktuelleListe());
  }
  // #druck bleibt bis zur nächsten Vorbereitung stehen (die Tests prüfen per page.pdf()).
  function nachDemDruck() { druckBereit = false; }
  // Paket-Schriften kamen erst nach der Frist (Ereignis 'flyer:schriften' der Ansicht): die Flyer in #druck mit der
  // echten Schrift neu anpassen und ein schon vorbereitetes Bild verwerfen und neu vorbereiten (es hatte die Ersatzschrift).
  function spaeteSchriften() {
    const a = A(), ziel = $('druck');
    if (a && ziel && typeof a.wurzelVon === 'function') {
      const wurzeln = Array.from(ziel.querySelectorAll('.druck-flyer > .flyer-host')).map((h) => a.wurzelVon(h)).filter(Boolean);
      if (wurzeln.length) messbar(() => { for (const w of wurzeln) { try { a.schriftAnpassen(w); } catch (e) { /* nächster */ } } });
    }
    const offen = a ? a.offenesDokument() : null;
    bildVerwerfen();   // auch ein laufendes (es misst mit der Ersatzschrift); bildVorbereiten verwirft dessen Ergebnis
    if (bildMoeglich && offen) bildVorbereiten(offen);
  }

  /* ---------- Bild: eingebettete Dateien ---------- */
  // fonts/… vom eigenen Ursprung laden (mit Zeitlimit) → data:-URL. null bei Fehler (dann ohne diese Datei).
  function datenUrl(pfad) {
    if (dateiCache.has(pfad)) return dateiCache.get(pfad);
    const p = (async () => {
      if (/(^|[\/\\])\.\.([\/\\]|$)/.test(pfad)) return null;
      // Nur unterhalb von fonts/ des eigenen Ursprungs (auch „%2e%2e“ löst der URL-Parser zu „..“ auf).
      const u = new URL(pfad, document.baseURI), ordner = new URL('fonts/', document.baseURI);
      if (u.origin !== location.origin || u.origin !== ordner.origin || !u.pathname.startsWith(ordner.pathname)) return null;
      const ab = typeof AbortController === 'function' ? new AbortController() : null;
      const uhr = setTimeout(() => { if (ab) ab.abort(); }, DATEI_FRIST_MS);
      try {
        const res = await Promise.race([
          fetch(u.href, { credentials: 'same-origin', signal: ab ? ab.signal : undefined }),
          warte(DATEI_FRIST_MS + 100).then(() => null)
        ]);
        if (!res || !res.ok) return null;
        const blob = await res.blob();
        if (!blob.size || blob.size > MAX_DATEI_BYTES) return null;
        const endung = (/\.([a-z0-9]+)$/i.exec(u.pathname) || [])[1];
        const typ = MIME[String(endung || '').toLowerCase()] || blob.type || 'application/octet-stream';
        return await new Promise((resolve) => {
          const fr = new FileReader();
          fr.onload = () => resolve(typeof fr.result === 'string' ? fr.result : null);
          fr.onerror = () => resolve(null);
          fr.readAsDataURL(new Blob([blob], { type: typ }));
        });
      } catch (e) {
        return null;
      } finally {
        clearTimeout(uhr);
      }
    })();
    dateiCache.set(pfad, p);
    p.then((d) => { if (!d) dateiCache.delete(pfad); });   // gescheitert: beim nächsten Bild erneut versuchen
    return p;
  }
  // Alle Verweise auf fonts/… im CSS durch data:-URLs ersetzen (nicht ladbare bleiben stehen; ein SVG-Bild lädt sie nie).
  async function mitDaten(css) {
    const pfade = new Set();
    css.replace(FONTS_URL, (m, a, b, c) => { pfade.add(a || b || c); return m; });
    const daten = new Map();
    await Promise.all(Array.from(pfade).map((p) => datenUrl(p).then((d) => { daten.set(p, d); })));
    return css.replace(FONTS_URL, (m, a, b, c) => {
      const d = daten.get(a || b || c);
      return d ? 'url("' + d + '")' : m;
    });
  }

  /* ---------- Bild: vorbereiten ---------- */
  function ladeBild(url) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.decoding = 'sync';
      const uhr = setTimeout(() => { img.onload = img.onerror = null; reject(new Error('Zeitlimit')); }, BILD_FRIST_MS);
      img.onload = () => { clearTimeout(uhr); resolve(img); };
      img.onerror = () => { clearTimeout(uhr); reject(new Error('Bild nicht lesbar')); };
      img.src = url;
    });
  }
  // Safari: Schriften und Bilder im SVG erst nach dem ersten Zeichnen sicher da – klein vorzeichnen, kurz warten.
  async function aufwaermen(img) {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 16;
    const ctx = cv.getContext('2d');
    for (let i = 0; i < 2; i++) {
      try { if (ctx) ctx.drawImage(img, 0, 0, 16, 16); } catch (e) { /* zeigt sich beim echten Zeichnen */ }
      await warte(AUFWAERM_MS);
    }
    cv.width = cv.height = 0;
  }
  // Pixelmaße des fertigen Bildes: doppelte Auflösung, über MAX_PIXEL proportional verkleinert. Unabhängig von
  // devicePixelRatio (iPhone 3, iPad 2, Desktop 1): Lage, Ausschnitt und Auflösung sind auf jedem Gerät gleich.
  function pixelMasse(breite, hoehe) {
    let w = Math.max(1, Math.round(breite * BILD_FAKTOR)), h = Math.max(1, Math.round(hoehe * BILD_FAKTOR));
    let verkleinert = false;
    if (w * h > MAX_PIXEL) {
      const f = Math.sqrt(MAX_PIXEL / (w * h));
      w = Math.max(1, Math.floor(w * f));
      h = Math.max(1, Math.floor(h * f));
      while (w * h > MAX_PIXEL) { if (h > 1) h--; else w--; }
      verkleinert = true;
    }
    return { w: w, h: h, verkleinert: verkleinert };
  }
  // CSS fürs Bild: @font-face/@page der anderen Art (auf dem Bildschirm gelten die @font-face beider Arten), dann wie
  // im Shadow Root (§4.3) mit .ae-wurzel statt :host: zurücksetzen, Paket-CSS (:root/html/body → .ae-wurzel),
  // Kasten neutral. Jeder Teil in einem eigenen <style>, damit ein offener Block im Paket-CSS nichts verschluckt.
  async function bildCss(pk, dokArt) {
    const p = P();
    const css = (pk && pk.css) || {};
    const andere = dokArt === 'flyer' ? 'infografik' : 'flyer';
    const fremd = typeof css[andere] === 'string' ? String(p.zerlegeCss(css[andere]).dokument || '') : '';
    // Wie auf dem Bildschirm bereinigt (zerlegeCss: ohne @font-face mit Schriftnamen der Seite), dann .ae-wurzel
    const eigen = p.wurzelSelektoren(String(p.zerlegeCss(typeof css[dokArt] === 'string' ? css[dokArt] : '').sauber || ''), '.ae-wurzel');
    const [a, b] = await Promise.all([mitDaten(fremd), mitDaten(eigen)]);
    return [
      a,
      '.ae-wurzel{all:initial;display:block}',
      b,
      '.ae-wurzel{margin:0 !important;padding:0 !important;border:0 !important;display:block !important}'
    ];
  }
  // Dokument abseits (unsichtbar, außerhalb des Bildes) darstellen und anpassen, wie auf dem Bildschirm; zurück kommt
  // ein Klon der Wurzel (mit --s und .fill.off) samt Maßen.
  async function abseitsDarstellen(dok, optionen, messen) {
    const box = document.createElement('div');
    box.setAttribute('aria-hidden', 'true');
    box.inert = true;
    box.style.cssText = 'position:fixed;left:-100000px;top:0;visibility:hidden;pointer-events:none;width:' +
      (dok.breite > 0 ? dok.breite : 1080) + 'px';
    document.body.appendChild(box);
    try {
      const d = A().darstellen(dok, box, optionen);
      const r = await d.fertig;
      // F3a: Messen auf der dargestellten Wurzel (Lage und Größe, berechnete Stile), solange sie im Dokument steht
      const mess = typeof messen === 'function' ? messen(d.wurzel) : null;
      const klon = d.wurzel.cloneNode(true);
      // Ein SVG-Bild lädt verzögerte Bilder womöglich nie: im Klon sofort laden lassen.
      if (typeof klon.querySelectorAll === 'function') klon.querySelectorAll('img[loading]').forEach((i) => i.removeAttribute('loading'));
      return { klon: klon, r: r, mess: mess };
    } finally {
      box.remove();
    }
  }
  // Seite (Stile + Klon der Wurzel) als XHTML-Text für ein foreignObject
  function wurzelText(teile, klon) {
    const div = document.createElementNS(XHTML, 'div');
    div.setAttribute('class', 'ae-wurzel');
    for (const t of teile) {
      if (!t) continue;
      const st = document.createElementNS(XHTML, 'style');
      st.textContent = t;   // XMLSerializer maskiert < und & – der Text bleibt CSS, nichts wird zu Markup
      div.appendChild(st);
    }
    div.appendChild(klon);
    return new XMLSerializer().serializeToString(div);
  }
  // SVG-Bild der ganzen Seite, genau 1 : 1 in CSS-Pixeln (ohne viewBox, ohne Maßstab – siehe Kopf, „Maßstab im
  // SVG-Bild“). Die Pixelmaße (pixelMasse) gelten erst beim Zeichnen: drawImage(img, 0, 0, w, h).
  function svgText(teile, klon, breite, hoehe) {
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + breite + '" height="' + hoehe + '">' +
      '<foreignObject x="0" y="0" width="' + breite + '" height="' + hoehe + '">' + wurzelText(teile, klon) +
      '</foreignObject></svg>';
  }

  function bildVerwerfen() {
    const b = bild;
    bild = null;
    if (!b) return;
    if (b.img) { b.img.onload = b.img.onerror = null; b.img.removeAttribute('src'); }
  }

  // Bild des Dokuments vorbereiten (beim Öffnen/Blättern des Vollbilds). Promise<Boolean>: true, sobald es beim
  // Antippen synchron gezeichnet werden kann. Gleiches Dokument (und Paket) → dieselbe Vorbereitung.
  // optionen wie bei darstellen; ohne optionen die Änderungsschicht der Ansicht (ort 'bild').
  function bildVorbereiten(dok, optionen) {
    const a = A();
    if (!a || !P() || !dok || !document.body) return Promise.resolve(false);
    if (optionen === undefined) optionen = optionenFuer(dok, 'bild');
    const pk = a.paket();
    if (bild && bild.dok === dok && bild.paket === pk && bild.zustand !== 'fehler') return bild.promise;
    bildVerwerfen();
    const b = { dok: dok, paket: pk, zustand: 'laedt', img: null, w: 0, h: 0, verkleinert: false, promise: null };
    bild = b;
    const gilt = () => bild === b;
    b.promise = (async () => {
      try {
        await a.schriftenBereit();
        if (!gilt()) return false;
        const teile = await bildCss(pk, art(dok));
        if (!gilt()) return false;
        const { klon, r } = await abseitsDarstellen(dok, optionen);
        if (!gilt()) return false;
        const breite = dok.breite > 0 ? dok.breite : Math.max(1, r.breite || 0);
        const hoehe = art(dok) === 'flyer' && dok.hoehe > 0 ? dok.hoehe : Math.max(1, r.hoehe || dok.hoehe || 0);
        const m = pixelMasse(breite, hoehe);
        const img = await ladeBild(svgDatenUrl(svgText(teile, klon, breite, hoehe)));
        if (!gilt()) return false;
        if (typeof img.decode === 'function') { try { await img.decode(); } catch (e) { /* Safari: decode von SVG kann ablehnen */ } }
        await aufwaermen(img);
        if (!gilt()) return false;
        b.img = img; b.w = m.w; b.h = m.h; b.verkleinert = m.verkleinert;
        b.zustand = 'bereit';
        return true;
      } catch (e) {
        if (gilt()) b.zustand = 'fehler';
        return false;
      }
    })();
    return b.promise;
  }

  /* ---------- F3a: Seitenbild für „Grafiken & Daten“ ---------- */
  // Wie bildVorbereiten, aber ohne den Zustand des Vollbilds: → { img, w, h, breite, hoehe, faktor, teile, klon, mess,
  // bildFehler }. Lässt sich das Bild nicht laden (oder ist „Bild“ hier nicht möglich), ist img null und bildFehler
  // gesetzt – Messung, Klon und CSS (für SVG und Daten) gibt es trotzdem.
  async function seitenBild(dok, optionen, messen) {
    const a = A();
    if (!a || !P() || !dok || !document.body) throw new Error('nicht bereit');
    if (optionen === undefined) optionen = optionenFuer(dok, 'bild');
    const pk = a.paket();
    await a.schriftenBereit();
    const teile = await bildCss(pk, art(dok));
    const { klon, r, mess } = await abseitsDarstellen(dok, optionen, messen);
    const breite = dok.breite > 0 ? dok.breite : Math.max(1, r.breite || 0);
    const hoehe = art(dok) === 'flyer' && dok.hoehe > 0 ? dok.hoehe : Math.max(1, r.hoehe || dok.hoehe || 0);
    const m = pixelMasse(breite, hoehe);
    let img = null, bildFehler = null;
    try {
      if (probe) await probe;
      if (!bildMoeglich) throw new Error('Bild in diesem Browser nicht möglich');
      img = await ladeBild(svgDatenUrl(svgText(teile, klon, breite, hoehe)));
      if (typeof img.decode === 'function') { try { await img.decode(); } catch (e) { /* Safari: decode von SVG kann ablehnen */ } }
      await aufwaermen(img);
    } catch (e) { img = null; bildFehler = e; }
    return { img: img, w: m.w, h: m.h, breite: breite, hoehe: hoehe, faktor: m.w / breite, verkleinert: m.verkleinert, teile: teile, klon: klon, mess: mess, bildFehler: bildFehler };
  }
  // SVG eines Ausschnitts (x, y, w, h in CSS-Pixeln der Seite) mit der ganzen Seite als eingebettetem HTML
  // (foreignObject; nur im Browser genau) – für HTML-Kästen. Gleiche @font-face-Regeln (beide Arten binden dieselben
  // Schriften ein) stehen nur einmal darin; das Bild der Seite („Bild“, PNG) bleibt davon unberührt.
  // Der Ausschnitt entsteht per CSS im eingebetteten HTML (Rahmen w × h mit overflow:hidden, die Seite darin um
  // −x/−y verschoben), nicht über die viewBox: WebKit (Safari) verschiebt HTML mit eigener Ebene nicht mit der
  // viewBox mit und zeigte sonst die linke obere Ecke der Seite statt des Kastens (siehe Kopf, „Maßstab im SVG-Bild“).
  function ohneDoppelteSchriften(teile) {
    const gesehen = new Set();
    return teile.map((t) => (typeof t !== 'string' ? t : t.replace(/@font-face\s*\{[^}]*\}/gi, (m) => {
      const k = m.replace(/\s+/g, ' ');
      if (gesehen.has(k)) return '';
      gesehen.add(k);
      return m;
    })));
  }
  // Rahmen-Stile fest (!important), damit eine allgemeine Regel des Paket-CSS (z. B. „*“ oder „div“) sie nicht verstellt
  const FEST = 'display:block !important;box-sizing:content-box !important;position:static !important;float:none !important;' +
    'transform:none !important;padding:0 !important;border:0 !important;';
  function svgAusschnitt(bild, x, y, w, h) {
    if (!bild.svgInhalt) bild.svgInhalt = wurzelText(ohneDoppelteSchriften(bild.teile), bild.klon);
    return '<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h + '" viewBox="0 0 ' + w + ' ' + h + '">' +
      '<foreignObject x="0" y="0" width="' + w + '" height="' + h + '">' +
      '<div xmlns="' + XHTML + '" style="' + FEST + 'margin:0 !important;width:' + w + 'px !important;height:' + h + 'px !important;overflow:hidden !important">' +
      '<div style="' + FEST + 'margin:' + (-y) + 'px 0 0 ' + (-x) + 'px !important;width:' + bild.breite + 'px !important">' +
      bild.svgInhalt + '</div></div></foreignObject></svg>';
  }
  // @font-face-Regeln des Pakets mit eingebetteten Schriften (für echte SVG mit Text)
  async function schriftRegeln() {
    const a = A(), pk = a ? a.paket() : null, css = (pk && pk.css) || {};
    const r = [];
    for (const k of ['flyer', 'infografik']) if (typeof css[k] === 'string') r.push(String(P().zerlegeCss(css[k]).dokument || ''));
    return mitDaten((r.join('\n').match(/@font-face\s*\{[^}]*\}/gi) || []).join('\n'));
  }

  /* ---------- Bild: zeichnen und sichern ---------- */
  function dateiName(dok) { return 'aether-' + String(dok.id).replace(/[^A-Za-z0-9._-]+/g, '-') + '.png'; }
  // Synchron: vorbereitetes Bild auf ein Canvas → PNG. Wirft, wenn nichts bereit ist ('nicht bereit') oder das
  // Canvas nicht lesbar ist (SecurityError = „tainted“) bzw. zu groß war.
  function bildDatei() {
    const b = bild;
    if (!b || b.zustand !== 'bereit' || !b.img) throw new Error('nicht bereit');
    const cv = document.createElement('canvas');
    cv.width = b.w; cv.height = b.h;
    let url;
    try {
      const ctx = cv.getContext('2d');
      if (!ctx) throw new Error('kein Canvas');
      ctx.clearRect(0, 0, b.w, b.h);   // durchsichtiger Hintergrund (Fläche kommt allein aus dem Paket-CSS)
      ctx.drawImage(b.img, 0, 0, b.w, b.h);
      url = cv.toDataURL('image/png');
    } finally {
      cv.width = cv.height = 0;   // Speicher frei (iOS)
    }
    if (!/^data:image\/png;base64,/.test(url)) throw new Error('Canvas zu groß');
    const bin = atob(url.slice(url.indexOf(',') + 1)), u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return { url: url, datei: new File([u8], dateiName(b.dok), { type: 'image/png' }), breite: b.w, hoehe: b.h, verkleinert: b.verkleinert };
  }

  // Sichern-Dialog (wie logo.html dialogZeigen): Bild zum Lange-Drücken.
  function dialogZeigen(datei, url, zusatz) {
    const m = $('modal'), titel = $('mTitel'), text = $('mText'), box = $('mInhalt');
    if (!m || !box) return;
    if (titel) titel.textContent = datei.name;
    if (text) text.textContent = 'Lange drücken und sichern.' + zusatz;
    leeren(box);
    const img = document.createElement('img');
    img.src = url; img.alt = datei.name;   // Größe regelt das Seiten-CSS (.dlg img)
    box.appendChild(img);
    m.hidden = false;
    const zu = $('mZu');
    if (zu) zu.focus();
  }
  function dialogZu() {
    const m = $('modal');
    if (!m || m.hidden) return;
    m.hidden = true;
    const b = $('vbBild');
    if (b && !b.hidden) { try { b.focus(); } catch (e) { /* egal */ } }
  }

  // „Bild“: nur mit Nutzergeste; teilen (Datei), sonst herunterladen, sonst Dialog.
  function bildSichern(ev) {
    const g = G(), a = A();
    const dok = a ? a.offenesDokument() : null;
    if (!dok || !g) return;
    if (!g.mitGeste(ev)) { meldung('Bitte den Knopf antippen'); return; }
    const b = bild;
    if (!b || b.dok !== dok || b.paket !== a.paket() || b.zustand !== 'bereit') {
      if (b && b.dok === dok && b.zustand === 'fehler') meldung('Das Bild ließ sich nicht vorbereiten – neuer Versuch läuft');
      else meldung('Einen Moment – das Bild wird vorbereitet');
      bildVorbereiten(dok);
      return;
    }
    let d;
    try { d = bildDatei(); } catch (e) {
      if (e && e.name === 'SecurityError') {
        bildMoeglich = false;
        meldung('Dieser Browser gibt das Bild nicht heraus – „Bild“ ist hier nicht verfügbar');
      } else {
        bildFehlerDok = dok;
        meldung('Das Bild ließ sich nicht erzeugen');
      }
      knopfBild();
      return;
    }
    const zusatz = d.verkleinert ? ' – verkleinert auf ' + d.breite + ' × ' + d.hoehe + ' Pixel (Höchstgröße für iPhone/iPad)' : '';
    const files = [d.datei];
    if (g.kannTeilen(files)) {
      // Nur die Datei – ein title/text würde auf iPhone/iPad als eigene Textdatei mitgesichert
      navigator.share({ files: files })
        .then(() => meldung('Bild weitergegeben' + zusatz))
        .catch((e) => { if (e && e.name === 'AbortError') return; dialogZeigen(d.datei, d.url, zusatz ? ' (' + zusatz.slice(3) + ')' : ''); });
      return;
    }
    if (g.kannHerunterladen()) {
      herunterladenUndFreigeben(d.datei);
      meldung('Bild wird heruntergeladen' + zusatz);
      return;
    }
    dialogZeigen(d.datei, d.url, zusatz ? ' (' + zusatz.slice(3) + ')' : '');
  }

  /* ---------- Selbstprobe ---------- */
  // Kleines SVG mit foreignObject (data:-URL wie beim echten Bild) → Canvas → Pixel lesen → toDataURL. true nur, wenn
  // das Grün ankommt und nichts wirft.
  // Bis zu drei Versuche mit Pause (Safari zeichnet foreignObject beim ersten Mal teils leer).
  function selbstprobe() {
    return new Promise((resolve) => {
      let fertig = false;
      const ende = (ok) => {
        if (fertig) return;
        fertig = true;
        clearTimeout(uhr);
        resolve(ok);
      };
      const uhr = setTimeout(() => ende(false), PROBE_FRIST_MS);
      try {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><foreignObject x="0" y="0" width="8" height="8">' +
          '<div xmlns="' + XHTML + '" style="width:8px;height:8px;background:#00ff00"></div></foreignObject></svg>';
        const img = new Image();
        const versuch = (n) => {
          let ok = false;
          const cv = document.createElement('canvas');
          cv.width = cv.height = 8;
          try {
            const ctx = cv.getContext('2d');
            ctx.drawImage(img, 0, 0, 8, 8);
            const px = ctx.getImageData(4, 4, 1, 1).data;
            ok = px[1] > 200 && px[3] > 200 && px[0] < 60 && /^data:image\/png;base64,/.test(cv.toDataURL('image/png'));
          } catch (e) {
            ende(false);   // SecurityError („tainted“) oder kein Canvas: kein neuer Versuch
            return;
          } finally {
            cv.width = cv.height = 0;
          }
          if (ok) ende(true);
          else if (n > 1) setTimeout(() => versuch(n - 1), 150);
          else ende(false);
        };
        img.onload = () => versuch(3);
        img.onerror = () => ende(false);
        img.src = svgDatenUrl(svg);
      } catch (e) {
        ende(false);
      }
    });
  }

  /* ---------- Einrichten ---------- */
  // Nach der Ansicht: zeigt „Alle als PDF“ und „PDF“, „Bild“ nach bestandener Selbstprobe; hört auf die Ereignisse
  // der Ansicht. Promise: Ergebnis der Selbstprobe.
  let probe = null;
  function einrichten() {
    if (eingerichtet) return probe;
    eingerichtet = true;
    const alle = $('btnAllePdf'), pdf = $('vbPdf'), bildKnopf = $('vbBild'), zu = $('mZu');
    if (alle) { alle.hidden = false; alle.addEventListener('click', () => { druckeAlle(); }); }
    if (pdf) { pdf.hidden = false; pdf.addEventListener('click', () => { druckeEins(); }); }
    if (bildKnopf) { bildKnopf.hidden = true; bildKnopf.addEventListener('click', bildSichern); }
    if (zu) zu.addEventListener('click', dialogZu);
    // Sichern-Dialog: Esc oder Backspace schließt nur den Dialog (vor allen anderen Tasten-Behandlungen, damit das
    // Vollbild darunter offen bleibt).
    window.addEventListener('keydown', (e) => {
      const m = $('modal');
      if (!m || m.hidden || e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key !== 'Escape' && e.key !== 'Backspace') return;
      e.preventDefault();
      e.stopPropagation();
      if (!e.repeat) dialogZu();
    }, true);
    document.addEventListener('flyer:kategorie', knopfAllePdf);
    document.addEventListener('flyer:vollbild', (e) => {
      const d = e && e.detail;
      if (d && d.offen && d.dok) {
        if (bildFehlerDok && bildFehlerDok !== d.dok) bildFehlerDok = null;
        knopfBild();
        if (bildMoeglich) bildVorbereiten(d.dok);
      } else {
        bildFehlerDok = null;
        bildVerwerfen();
        knopfBild();
      }
    });
    window.addEventListener('beforeprint', vorDemDruck);
    window.addEventListener('afterprint', nachDemDruck);
    document.addEventListener('flyer:schriften', spaeteSchriften);
    // Teil 2: Änderung → vorbereitetes Bild gilt nicht mehr (zeigte den alten Stand); neu vorbereiten
    document.addEventListener('flyer:aenderungen', () => {
      bildVerwerfen();
      bildFehlerDok = null;
      const a = A();
      const offen = a ? a.offenesDokument() : null;
      knopfBild();
      if (bildMoeglich && offen) bildVorbereiten(offen);
    });
    knopfAllePdf();
    probe = selbstprobe().then((ok) => {
      bildMoeglich = ok;
      knopfBild();
      const a = A();
      const offen = a ? a.offenesDokument() : null;
      if (ok && offen) bildVorbereiten(offen);
      return ok;
    });
    return probe;
  }

  window.AetherFlyerExport = Object.freeze({
    einrichten: einrichten,
    druckvorbereitung: druckvorbereitung,
    druckeAlle: druckeAlle,
    druckeEins: druckeEins,
    druckListe: druckListe,   // PowerPoint-Export (flyer-pptx.js): genau die Seiten von „Alle als PDF“
    bildVorbereiten: bildVorbereiten,
    bildDatei: bildDatei,
    herunterladenUndFreigeben: herunterladenUndFreigeben,
    seitenBild: seitenBild,
    svgAusschnitt: svgAusschnitt,
    schriftRegeln: schriftRegeln
  });
})();
