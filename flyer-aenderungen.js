// Änderungsschicht der Flyer-Seite (flyer.html, Teil 2): eigene Texte (data-t), Status (data-s → data-status) und das
// Stand-Datum (data-stand) je Dokument liegen als Einträge über dem zuletzt übernommenen Paket (Basis, bleibt
// unverändert). Dargestellt wird immer Basis + Änderungsschicht (anwenden, über optionen.anpassen der Ansicht), danach
// werden die Zähler und Balken jedes Blocks neu berechnet (zaehlerBerechnen, Regel wie im echten Paket: Zähler
// <span class="zaehler"> im data-zaehler-Element, --anteil = ok/y, --anteil-laeuft = run/y).
// Eintrag: { dok, k, art:'text'|'status'|'stand', alt, neu, exportiert, zeit } – alt = Wert der Basis beim Anlegen
// (bzw. nach dem Abgleich), neu = eigener Wert, exportiert = Wert beim letzten Export (sonst null), zeit = ISO-Zeit.
// Im Speicher kommt konflikt hinzu (null oder { online } bzw. { fehlt:true }): offener Konflikt aus dem Abgleich.
// Text wird nur als Text eingesetzt (Textknoten, nie HTML); Zeilenumbrüche nur, wenn das Element in der Basis schon
// <br> hat (dann als <br>), sonst als Leerzeichen.
// Export: Paket = Basis + Änderungsschicht (Markierungen bleiben), Fassung „<JJJJ-MM-TT>.<n>“, muss
// AetherFlyerPaket.pruefe bestehen. Abgleich bei jeder Übernahme (abgleichen). Sicherung „aether-flyer-aenderungen“ v2
// (F3a: Einträge mit ver, dazu struktur = Feld-Änderungen der Version; v1 wird weiter gelesen und gilt für die
// geöffnete Version).
// F3a: Jeder Eintrag gehört zu einer Version (ver, z. B. „1.1“). Bearbeitet wird immer die geöffnete Version (h.version),
// dargestellt über ihre Sicht (h.paket: Dokumente wie im Format v1). Abgleich und Export arbeiten auf dem ganzen Paket
// im Format v2 (h.lokal: lokaler Stand aller Versionen; Abgleich gegen das neue Paket im Format v2).
// Gespeichert wird über AetherFlyerSpeicher (IndexedDB „aether-flyer“, Store „aenderungen“) – nie das Token.
(function () {
  'use strict';

  const ARTEN = ['text', 'status', 'stand'];
  const STATUS = ['ok', 'run', 'next', 'plan'];          // dazu '' = ohne Status
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const STANDARD_VERSION = '1.1';
  const SICHERUNG_FORMAT = 'aether-flyer-aenderungen';
  const SICHERUNG_VERSION = 2;
  // Selbst gewählt: Sicherungsdatei höchstens 5 MB und 20 000 Einträge (der Paket-Import aus Teil 1 hat keine eigene
  // Grenze); höchstens 50 gemerkte Export-Fassungen (für die Zählung n der Fassung).
  const MAX_SICHERUNG_BYTES = 5 * 1024 * 1024;
  const MAX_EINTRAEGE = 20000;
  const MAX_EXPORTE = 50;
  // Markierung geänderter Stellen (nur Vollbild, Modi Text und Status): gestrichelte Unterlinie in der Akzentfarbe.
  const MARKE_ATTR = 'data-ae-geaendert';
  const MARKE_FARBE = '#6a59df';
  // Zähler: „x von y fertig“ (vorhandene Stelle „x von y“ im Text wird ersetzt, Leerraum und „fertig“ bleiben wie im Paket)
  const ZAEHLER_RE = /(\d+)(\s*)von(\s*)(\d+)(\s*fertig)?/;
  const RE_KURZ = /(\d{1,2})\.(\d{1,2})\.(\d{4})/;
  const RE_LANG = new RegExp('(\\d{1,2})\\.\\s*(' + MONATE.join('|') + ')\\s+(\\d{4})');

  const S = () => window.AetherFlyerSpeicher || null;
  const P = () => window.AetherFlyerPaket;

  /* ---------- Zustand ---------- */
  const eintraege = new Map();     // Schlüssel → Eintrag
  let exporte = [];                // bisher exportierte Fassungen (neueste zuletzt)
  let gespeichertOk = true;        // letzter Speichervorgang gelungen?
  let reihe = Promise.resolve();   // Speichervorgänge nacheinander
  let paketQuelle = () => null;    // → Sicht der geöffneten Version (von flyer.js)
  let versionQuelle = () => STANDARD_VERSION;   // → Nummer der geöffneten Version
  let lokalQuelle = () => null;    // → lokaler Stand aller Versionen (Format v2)
  const werteCache = new Map();    // html → { text, status, stand } der Basis (bereinigt gelesen)
  let gesperrt = false;            // läuft gerade eine Übernahme (Abgleich bis Basiswechsel)? Dann keine Eingaben

  /* ---------- Hilfen ---------- */
  function fehler(kind, title, text) {
    const G = window.AetherGemeinsam;
    if (G && typeof G.AppError === 'function') return new G.AppError(kind, title, text || '');
    const e = new Error(title); e.kind = kind; e.title = title; e.text = text || ''; return e;
  }
  function istObjekt(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function schluessel(ver, dok, art, k) { return ver + '\n' + dok + '\n' + art + '\n' + k; }
  function sk(e) { return schluessel(e.ver, e.dok, e.art, e.k); }
  function kopie(e) { return { ver: e.ver, dok: e.dok, k: e.k, art: e.art, alt: e.alt, neu: e.neu, exportiert: e.exportiert, zeit: e.zeit, konflikt: e.konflikt ? Object.assign({}, e.konflikt) : null }; }
  function rein(e) { return { dok: e.dok, k: e.k, art: e.art, alt: e.alt, neu: e.neu, exportiert: e.exportiert, zeit: e.zeit }; }
  function reinMitVer(e) { return Object.assign({ ver: e.ver }, rein(e)); }
  function ver() { try { const v = versionQuelle(); return typeof v === 'string' && v ? v : STANDARD_VERSION; } catch (e) { return STANDARD_VERSION; } }
  function lokal() { try { return lokalQuelle() || null; } catch (e) { return null; } }
  // Seite dok der Version v im Paket pk (Format v2)
  function seiteV2(pk, v, dok) {
    const vs = pk && Array.isArray(pk.versionen) ? pk.versionen.find((x) => x && x.nummer === v) : null;
    return vs && Array.isArray(vs.seiten) ? vs.seiten.find((d) => d && d.id === dok) || null : null;
  }
  function jetztIso() { return new Date().toISOString(); }
  const zwei = (n) => (n < 10 ? '0' : '') + n;
  // Heutiges Datum (Ortszeit des Geräts) als JJJJ-MM-TT
  function heute() { const d = new Date(); return d.getFullYear() + '-' + zwei(d.getMonth() + 1) + '-' + zwei(d.getDate()); }
  function melde(detail) { try { document.dispatchEvent(new CustomEvent('flyer:aenderungen', { detail: detail || {} })); } catch (e) { /* egal */ } }

  // Elemente mit attr = wert in wurzel (wurzel selbst eingeschlossen), Vergleich ohne CSS-Selektor (kein Escaping nötig)
  function alleMit(wurzel, attr, wert) {
    const r = [];
    if (wurzel.nodeType === 1 && wurzel.getAttribute(attr) === wert) r.push(wurzel);
    for (const el of wurzel.querySelectorAll('[' + attr + ']')) if (el.getAttribute(attr) === wert) r.push(el);
    return r;
  }
  function mitAttr(wurzel, attr) {
    const r = [];
    if (wurzel.nodeType === 1 && wurzel.hasAttribute(attr)) r.push(wurzel);
    for (const el of wurzel.querySelectorAll('[' + attr + ']')) r.push(el);
    return r;
  }
  function name(el) { return String(el.localName || '').toLowerCase(); }
  // Textträger: das erste <ae-t> im Element (Textstück ohne eigene Gestaltung), sonst das Element selbst.
  function textTraeger(el) { return el.querySelector('ae-t') || el; }
  function hatUmbruch(traeger) { return !!traeger.querySelector('br'); }
  // Nur Text und <br> (sonst nichts) im Element? Nur dann wird ein Stand-Datum hineingeschrieben.
  function nurText(el) { return !Array.prototype.some.call(el.querySelectorAll('*'), (c) => name(c) !== 'ae-t' && name(c) !== 'br'); }
  // Text eines Trägers: Textknoten, <br> als Zeilenumbruch
  function textLesen(n) {
    let t = '';
    for (const c of n.childNodes) {
      if (c.nodeType === 3) t += c.data;
      else if (c.nodeType === 1) t += name(c) === 'br' ? '\n' : textLesen(c);
    }
    return t;
  }
  function normalisiere(wert, umbruch) {
    const t = String(wert === undefined || wert === null ? '' : wert).replace(/\r\n?/g, '\n');
    return umbruch ? t : t.replace(/\n/g, ' ');
  }
  const MARKEN_SEL = '[data-t],[data-s],[data-block],[data-zaehler],[data-stand],ae-t';
  // Text als Textknoten einsetzen (nie HTML); Zeilenumbrüche als <br>, wenn erlaubt. Enthält der Träger weitere
  // Markierungen, bleiben diese Elemente stehen: nur die eigenen Textknoten werden ersetzt (der erste bekommt den Text).
  function textSchreiben(traeger, wert, umbruch) {
    if (traeger.querySelector(MARKEN_SEL)) {
      const eigene = Array.prototype.filter.call(traeger.childNodes, (n) => n.nodeType === 3);
      const t = normalisiere(wert, false);
      if (eigene.length) { eigene[0].data = t; for (const n of eigene.slice(1)) n.data = ''; }
      else traeger.insertBefore(traeger.ownerDocument.createTextNode(t), traeger.firstChild);
      return;
    }
    while (traeger.firstChild) traeger.removeChild(traeger.firstChild);
    const doc = traeger.ownerDocument;
    normalisiere(wert, umbruch).split('\n').forEach((teil, i) => {
      if (i) traeger.appendChild(doc.createElement('br'));
      if (teil) traeger.appendChild(doc.createTextNode(teil));
    });
  }
  // Elemente mit data-stand in Dokumentreihenfolge; Kennung „stand<n>“ (n ab 1)
  function standElemente(wurzel) { return mitAttr(wurzel, 'data-stand'); }
  function standKennung(i) { return 'stand' + (i + 1); }

  /* ---------- Stand-Datum ---------- */
  // ISO-Tag → Text im Format des Pakets: kurz „TT.MM.JJJJ“, lang „T. Monat JJJJ“ (selbst gewählt, siehe README)
  function formatiereStand(iso, format) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return String(iso || '');
    const j = m[1], mo = Number(m[2]), t = Number(m[3]);
    return format === 'lang' ? t + '. ' + MONATE[mo - 1] + ' ' + j : zwei(t) + '.' + zwei(mo) + '.' + j;
  }
  // Erstes Datum im Text (kurz oder lang) → { index, laenge, iso, format } | null
  function datumImText(text) {
    const t = String(text || '');
    const a = RE_KURZ.exec(t), b = RE_LANG.exec(t);
    const kandidaten = [];
    if (a) kandidaten.push({ index: a.index, laenge: a[0].length, j: Number(a[3]), m: Number(a[2]), t: Number(a[1]), format: 'kurz' });
    if (b) kandidaten.push({ index: b.index, laenge: b[0].length, j: Number(b[3]), m: MONATE.indexOf(b[2]) + 1, t: Number(b[1]), format: 'lang' });
    kandidaten.sort((x, y) => x.index - y.index);
    for (const k of kandidaten) {
      if (k.m >= 1 && k.m <= 12 && k.t >= 1 && k.t <= 31) return { index: k.index, laenge: k.laenge, iso: k.j + '-' + zwei(k.m) + '-' + zwei(k.t), format: k.format };
    }
    return null;
  }
  // Neuer Text eines Stand-Elements: vorhandenes Datum durch iso ersetzen (Rest des Textes bleibt), sonst nur das Datum.
  // Format laut data-stand („kurz“/„lang“), sonst wie das vorhandene Datum.
  function standText(alterText, format, iso) {
    const d = datumImText(alterText);
    const f = format === 'kurz' || format === 'lang' ? format : (d ? d.format : 'kurz');
    if (!d) return formatiereStand(iso, f);
    return alterText.slice(0, d.index) + formatiereStand(iso, f) + alterText.slice(d.index + d.laenge);
  }

  /* ---------- Werte der Basis ---------- */
  // Werte eines Dokuments (bereinigt gelesen, wie dargestellt): text k → { wert, umbruch }, status k → wert ('' = ohne),
  // stand k → { wert, format } (nur Stand-Elemente mit reinem Text).
  function werteAus(wurzel) {
    const text = new Map(), status = new Map(), stand = new Map();
    for (const el of mitAttr(wurzel, 'data-t')) {
      const k = el.getAttribute('data-t');
      if (!k || text.has(k)) continue;
      const tr = textTraeger(el);
      // Mit weiteren Markierungen darin: nur die eigenen Textknoten (siehe textSchreiben)
      if (tr.querySelector(MARKEN_SEL)) { text.set(k, { wert: Array.prototype.filter.call(tr.childNodes, (n) => n.nodeType === 3).map((n) => n.data).join(''), umbruch: false }); continue; }
      text.set(k, { wert: textLesen(tr), umbruch: hatUmbruch(tr) });
    }
    for (const el of mitAttr(wurzel, 'data-s')) {
      const k = el.getAttribute('data-s');
      if (!k || status.has(k)) continue;
      const st = el.getAttribute('data-status');
      status.set(k, st === null ? '' : st);
    }
    standElemente(wurzel).forEach((el, i) => {
      if (!nurText(el)) return;
      const tr = textTraeger(el);
      stand.set(standKennung(i), { wert: textLesen(tr), format: el.getAttribute('data-stand'), umbruch: hatUmbruch(tr) });
    });
    return { text: text, status: status, stand: stand };
  }
  function werte(dok) {
    const html = String(dok.html);
    let w = werteCache.get(html);
    if (!w) {
      try { w = werteAus(P().bereinigeHtml(html)); } catch (e) { w = { text: new Map(), status: new Map(), stand: new Map() }; }
      if (werteCache.size > 200) werteCache.clear();
      werteCache.set(html, w);
    }
    return w;
  }
  function dokIn(paket, id) {
    if (!paket || !Array.isArray(paket.dokumente)) return null;
    return paket.dokumente.find((d) => d && d.id === id) || null;
  }
  // Wert eines Dokuments (undefined, wenn es das Dokument oder die Kennung dort nicht gibt)
  function wertVon(dok, art, k) {
    if (!dok) return undefined;
    const m = werte(dok)[art];
    if (!m || !m.has(k)) return undefined;
    const v = m.get(k);
    return typeof v === 'string' ? v : v.wert;
  }
  function wertIn(paket, dokId, art, k) { return wertVon(dokIn(paket, dokId), art, k); }
  function wertInV2(pk, v, dokId, art, k) { return wertVon(seiteV2(pk, v, dokId), art, k); }

  /* ---------- Zähler und Balken ---------- */
  function zahl(v) { return String(Math.round(v * 10000) / 10000); }
  // Deklaration name im style-Attribut ersetzen, wenn vorhanden (Rest des Attributs bleibt wörtlich) → true, wenn ersetzt
  function ersetzeVar(el, nameVar, wert) {
    const s = el.getAttribute && el.getAttribute('style');
    if (s === null || s === undefined || s.indexOf(nameVar) < 0) return false;
    let ersetzt = false;
    const teile = s.split(';').map((d) => {
      const i = d.indexOf(':');
      if (i < 0 || d.slice(0, i).trim() !== nameVar) return d;
      ersetzt = true;
      const vorne = d.slice(0, i + 1), wertTeil = d.slice(i + 1);
      const lead = /^\s*/.exec(wertTeil)[0], wichtig = /\s*!important\s*$/i.exec(wertTeil);
      return vorne + lead + wert + (wichtig ? wichtig[0] : '');
    });
    if (ersetzt) el.setAttribute('style', teile.join(';'));
    return ersetzt;
  }
  // Zähler-Text in ein Zähler-Element schreiben. → true, wenn es einen Zähler gab (sonst bleibt der Text unverändert)
  //   1. Kind „.zaehler“ (Regel des Pakets, das Paket-CSS zeigt den Balken nur mit [data-zaehler]:has(> .zaehler)):
  //      dessen Text = „x von y fertig“
  //   2. vorhandene Stelle „x von y“ im Text (nicht in einem Listenpunkt): ersetzen, Leerraum und „fertig“ bleiben
  //   3. leerer Träger: „x von y fertig“
  //   sonst (Überschrift mit eigenem Text): nichts – eine Überschrift wird nie überschrieben
  function zaehlerText(z, x, y) {
    const kind = Array.prototype.find.call(z.children, (c) => c.classList && c.classList.contains('zaehler'));
    if (kind) { kind.textContent = x + ' von ' + y + ' fertig'; return 'kind'; }
    const doc = z.ownerDocument;
    const gaenger = doc.createTreeWalker(z, 4);
    while (gaenger.nextNode()) {
      const n = gaenger.currentNode;
      let p = n.parentNode, inPunkt = false;
      while (p && p !== z) { if (p.nodeType === 1 && p.hasAttribute('data-s')) { inPunkt = true; break; } p = p.parentNode; }
      if (inPunkt) continue;
      const m = ZAEHLER_RE.exec(n.data);
      if (!m) continue;
      n.data = n.data.slice(0, m.index) + x + m[2] + 'von' + m[3] + y + (m[5] !== undefined ? m[5] : '') + n.data.slice(m.index + m[0].length);
      return 'text';
    }
    const tr = textTraeger(z);
    if (!tr.firstElementChild && !tr.textContent.trim()) { tr.textContent = x + ' von ' + y + ' fertig'; return 'text'; }
    return null;
  }
  // Block eines Zähler-Elements: data-zaehler mit Wert = data-block-Wert → alle Elemente mit diesem Wert; sonst das
  // nächste Element mit data-block (das Element selbst oder ein Vorfahr) – mit Wert alle Elemente dieses Werts, ohne
  // Wert (wie im echten Paket: <div data-block><h3 data-zaehler>…) genau dieses eine Element.
  function blockVon(z, wurzel) {
    const alle = mitAttr(wurzel, 'data-block');
    const zw = z.getAttribute('data-zaehler');
    if (zw) { const g = alle.filter((e) => e.getAttribute('data-block') === zw); if (g.length) return g; }
    const el = z.hasAttribute('data-block') ? z : (z.parentElement ? z.parentElement.closest('[data-block]') : null);
    if (!el) return null;
    const w = el.getAttribute('data-block');
    return w ? alle.filter((e) => e.getAttribute('data-block') === w) : [el];
  }
  // Für jeden Block mit Zähler (data-zaehler): y = Listenpunkte (data-s) im Block, x = davon data-status="ok";
  // --anteil = x/y und --anteil-laeuft = run/y (Regel des Pakets: Das Paket-CSS zeichnet „läuft“ von --anteil bis
  // --anteil + --anteil-laeuft), y = 0 → 0. Der Text „x von y fertig“ kommt in den vorhandenen Zähler (siehe zaehlerText).
  // Hat das Zähler-Element noch keinen Zähler (Überschrift wie im echten Paket), legt anwenden ihn nur an, wenn ein
  // Listenpunkt des Blocks einen eigenen Status hat (opt.aktiv): <span class="zaehler"> als letztes Kind – so bleibt ein
  // unverändertes Paket bitgenau, wie es ist. Die Variablen stehen am Zähler-Element; bei Blöcken mit Wert (Zähler
  // außerhalb) zusätzlich an den Block-Elementen. Vorhandene Deklarationen im style-Attribut im Block werden ersetzt.
  // nurVorhandene (Export): an Block-Elementen nur vorhandene Werte ersetzen, nichts hinzufügen.
  function zaehlerBerechnen(wurzel, opt) {
    const nurVorhandene = !!(opt && opt.nurVorhandene);
    const aktiv = (opt && opt.aktiv) || null;
    const ergebnis = [];
    for (const z of mitAttr(wurzel, 'data-zaehler')) {
      const els = blockVon(z, wurzel);
      if (!els) continue;
      const punkte = new Set();
      for (const b of els) {
        if (b.hasAttribute('data-s')) punkte.add(b);
        for (const p of b.querySelectorAll('[data-s]')) punkte.add(p);
      }
      let ok = 0, run = 0, eigen = false;
      for (const p of punkte) {
        const st = p.getAttribute('data-status');
        if (st === 'ok') ok++; else if (st === 'run') run++;
        if (aktiv && aktiv.has(p)) eigen = true;
      }
      const y = punkte.size;
      const a = zahl(y ? ok / y : 0), l = zahl(y ? run / y : 0);
      let art = zaehlerText(z, ok, y);
      if (!art && eigen) {
        const sp = z.ownerDocument.createElement('span');
        sp.className = 'zaehler';
        sp.textContent = ok + ' von ' + y + ' fertig';
        z.appendChild(sp);
        art = 'kind';
      }
      if (!art) continue;   // kein Zähler im Block und nichts geändert: alles bleibt, wie es im Paket steht
      const setze = (el, hinzu) => {
        const da = ersetzeVar(el, '--anteil', a), dl = ersetzeVar(el, '--anteil-laeuft', l);
        if (hinzu && el.style) {
          if (!da) el.style.setProperty('--anteil', a);
          if (!dl) el.style.setProperty('--anteil-laeuft', l);
        }
        for (const d of el.querySelectorAll('[style]')) { ersetzeVar(d, '--anteil', a); ersetzeVar(d, '--anteil-laeuft', l); }
      };
      setze(z, true);
      const mitWert = els.some((e) => e.getAttribute('data-block'));
      for (const el of els) if (el !== z) setze(el, mitWert && !nurVorhandene);
      ergebnis.push({ x: ok, y: y, anteil: a, laeuft: l });
    }
    return ergebnis;
  }

  /* ---------- Anwenden ---------- */
  function markiere(el) {
    el.setAttribute(MARKE_ATTR, '');
    if (!el.style) return;
    el.style.setProperty('text-decoration', 'underline dashed ' + MARKE_FARBE, 'important');
    el.style.setProperty('text-decoration-thickness', '2px', 'important');
    el.style.setProperty('text-underline-offset', '3px', 'important');
    el.style.setProperty('text-decoration-skip-ink', 'none', 'important');
  }
  // Einträge eines Dokuments auf wurzel (bereinigter Klon bzw. geparstes HTML) anwenden, danach Zähler und Balken.
  // opt.markieren: geänderte Stellen markieren (nur Vollbild in Text/Status). opt.nurVorhandene: Export.
  function anwenden(wurzel, dokId, liste, opt) {
    const o = opt || {};
    const stande = standElemente(wurzel);
    const aktiv = new Set();   // Listenpunkte mit eigenem Status (Zähler wird dann angelegt, siehe zaehlerBerechnen)
    for (const e of liste || []) {
      if (!e || e.dok !== dokId) continue;
      if (e.art === 'text') {
        for (const el of alleMit(wurzel, 'data-t', e.k)) {
          const tr = textTraeger(el);
          textSchreiben(tr, e.neu, hatUmbruch(tr));
          if (o.markieren) markiere(el);
        }
      } else if (e.art === 'status') {
        for (const el of alleMit(wurzel, 'data-s', e.k)) {
          if (e.neu) el.setAttribute('data-status', e.neu); else el.removeAttribute('data-status');
          aktiv.add(el);
          if (o.markieren) markiere(el);
        }
      } else if (e.art === 'stand') {
        const m = /^stand(\d+)$/.exec(e.k);
        const el = m ? stande[Number(m[1]) - 1] : null;
        if (el && nurText(el)) {
          const tr = textTraeger(el);
          textSchreiben(tr, e.neu, hatUmbruch(tr));
          if (o.markieren) markiere(el);
        }
      }
    }
    return zaehlerBerechnen(wurzel, { nurVorhandene: o.nurVorhandene, aktiv: aktiv });
  }

  /* ---------- Speichern ---------- */
  function liste() { return Array.from(eintraege.values()); }
  function speichern() {
    const s = S();
    const stand = { eintraege: liste().map(kopie), exporte: exporte.slice() };
    const auftrag = reihe.then(async () => {
      if (!s || typeof s.speichereAenderungen !== 'function') { gespeichertOk = false; return false; }
      const ok = await s.speichereAenderungen(stand).catch(() => false);
      gespeichertOk = ok === true;
      return gespeichertOk;
    });
    reihe = auftrag.catch(() => {});
    return auftrag;
  }
  // Einmal beim Start (vor der ersten Anzeige): Änderungsschicht aus IndexedDB
  async function laden() {
    const s = S();
    let r = null;
    try { r = s && typeof s.ladeAenderungen === 'function' ? await s.ladeAenderungen() : null; } catch (e) { r = null; }
    eintraege.clear();
    exporte = [];
    if (r) {
      for (const e of r.eintraege) eintraege.set(sk(e), kopie(e));
      exporte = r.exporte.slice(-MAX_EXPORTE);
    }
    melde({ geladen: true });
    return eintraege.size;
  }

  /* ---------- Bearbeiten ---------- */
  // Während einer Übernahme (flyer.js: Abgleich, Speichern der neuen Basis, Basiswechsel) sind Eingaben gesperrt –
  // sonst würde eine Änderung gegen die alte Basis eingeordnet und den Abgleich umgehen.
  function sperre(an) { gesperrt = an === true; }
  function gesperrtFehler() { return Promise.reject(fehler('gesperrt', 'Gerade wird ein neues Paket übernommen.', 'Bitte gleich noch einmal versuchen.')); }
  function basis() { try { return paketQuelle() || null; } catch (e) { return null; } }
  function hatAenderungen(dokId, v) {
    const vv = v || ver();
    for (const e of eintraege.values()) if (e.ver === vv && e.dok === dokId && e.art !== 'stand') return true;
    return false;
  }
  // Stand-Einträge eines Dokuments: nach einer Änderung auf heute (heute = true), ohne Änderungen weg.
  function standNachziehen(dokId, aufHeute, v) {
    const vv = v || ver();
    const dok = vv === ver() ? dokIn(basis(), dokId) : seiteV2(lokal(), vv, dokId);
    const mit = hatAenderungen(dokId, vv);
    for (const e of liste()) if (e.ver === vv && e.dok === dokId && e.art === 'stand' && (!mit || !dok)) eintraege.delete(sk(e));
    if (!mit || !dok || !aufHeute) return;
    const iso = heute(), zeit = jetztIso();
    werte(dok).stand.forEach((b, k) => {
      const key = schluessel(vv, dokId, 'stand', k);
      const neu = normalisiere(standText(b.wert, b.format, iso), b.umbruch);
      const vorhanden = eintraege.get(key);
      if (neu === b.wert) { if (vorhanden && !vorhanden.konflikt) eintraege.delete(key); return; }
      if (vorhanden) { if (vorhanden.neu !== neu) { vorhanden.neu = neu; vorhanden.zeit = zeit; } return; }
      eintraege.set(key, { ver: vv, dok: dokId, k: k, art: 'stand', alt: b.wert, neu: neu, exportiert: null, zeit: zeit, konflikt: null });
    });
  }
  // Eigenen Wert setzen (aus dem Vollbild). neu = Basis-Wert → Eintrag weg. → Promise<Boolean> (gespeichert)
  function setze(dokId, art, k, wert) {
    if (gesperrt) return gesperrtFehler();
    if (art !== 'text' && art !== 'status') return Promise.reject(fehler('bearbeiten', 'Unbekannte Art.', String(art)));
    const dok = dokIn(basis(), dokId);
    if (!dok) return Promise.reject(fehler('bearbeiten', 'Dokument nicht im Paket.', String(dokId)));
    const w = werte(dok)[art];
    if (!w.has(k)) return Promise.reject(fehler('bearbeiten', 'Stelle nicht im Dokument.', String(k)));
    const b = w.get(k);
    const altWert = art === 'text' ? b.wert : b;
    let neu;
    if (art === 'text') neu = normalisiere(wert, b.umbruch);
    else {
      neu = wert === null || wert === undefined ? '' : String(wert);
      if (neu && STATUS.indexOf(neu) < 0) return Promise.reject(fehler('bearbeiten', 'Unbekannter Status.', neu));
    }
    const key = schluessel(ver(), dokId, art, k);
    const vorher = eintraege.get(key);
    // Unverändert (auch wenn sich nur Quelltext-Zeilenumbrüche der Basis zu Leerzeichen normalisiert haben) → kein Eintrag
    if (neu === altWert || (art === 'text' && neu === normalisiere(altWert, b.umbruch))) eintraege.delete(key);
    else if (vorher) {
      vorher.neu = neu; vorher.zeit = jetztIso();
      // Neue eigene Eingabe entscheidet einen offenen Konflikt für „meins“ (alt = jetziger Basis-Wert)
      if (vorher.konflikt) { vorher.alt = altWert; vorher.konflikt = null; }
    } else {
      eintraege.set(key, { ver: ver(), dok: dokId, k: k, art: art, alt: altWert, neu: neu, exportiert: null, zeit: jetztIso(), konflikt: null });
    }
    standNachziehen(dokId, true);
    const p = speichern();
    melde({ dok: dokId });
    return p;
  }
  // „Original“: Eintrag weg (Basis-Wert gilt); ohne weitere Änderungen auch der Stand-Eintrag.
  function original(dokId, art, k) {
    if (gesperrt) return gesperrtFehler();
    eintraege.delete(schluessel(ver(), dokId, art, k));
    standNachziehen(dokId, false);
    const p = speichern();
    melde({ dok: dokId });
    return p;
  }
  // Alle Änderungen eines Dokuments zurücknehmen (samt Stand)
  function dokumentZuruecksetzen(dokId) {
    if (gesperrt) return gesperrtFehler();
    const vv = ver();
    for (const e of liste()) if (e.ver === vv && e.dok === dokId) eintraege.delete(sk(e));
    const p = speichern();
    melde({ dok: dokId });
    return p;
  }
  // „Alle Änderungen verwerfen“ (Rückfrage stellt die Oberfläche) – in der geöffneten Version
  function verwerfen() {
    if (gesperrt) return gesperrtFehler();
    const vv = ver();
    const doks = Array.from(new Set(liste().filter((e) => e.ver === vv).map((e) => e.dok)));
    for (const e of liste()) if (e.ver === vv) eintraege.delete(sk(e));
    const p = speichern();
    melde({ doks: doks });
    return p;
  }
  // F3a: Einträge einer Version (bzw. einer Seite darin) entfernen – wenn die Version oder Seite gelöscht wird
  function entferne(v, dokId) {
    if (gesperrt) return gesperrtFehler();
    const doks = [];
    for (const e of liste()) if (e.ver === v && (!dokId || e.dok === dokId)) { eintraege.delete(sk(e)); doks.push(e.dok); }
    if (!doks.length) return Promise.resolve(true);
    const p = speichern();
    melde({ doks: Array.from(new Set(doks)), entfernt: v });
    return p;
  }
  // Aktueller (eigener) Wert einer Stelle für das Bearbeitungsfeld bzw. die Auswahl
  function aktuellerWert(dokId, art, k) {
    const e = eintraege.get(schluessel(ver(), dokId, art, k));
    if (e) return e.neu;
    const v = wertIn(basis(), dokId, art, k);
    return v === undefined ? null : v;
  }

  /* ---------- Abgleich (Teil F) ---------- */
  // Ein Eintrag gegen den Wert r eines neuen Pakets: → 'entfaellt' | 'bleibt' (alt := r) | 'konflikt'
  function einordnen(e, r) {
    if (r === undefined) return 'konflikt';
    if (e.art === 'stand') {
      if (r === e.neu) return 'entfaellt';
      const dr = datumImText(r), dn = datumImText(e.neu);
      if (dr && dn) return dr.iso >= dn.iso ? 'entfaellt' : 'bleibt';   // das spätere Datum gewinnt
      return 'bleibt';
    }
    if (r === e.neu) return 'entfaellt';
    if (r === e.alt || (e.exportiert !== null && r === e.exportiert)) return 'bleibt';
    return 'konflikt';
  }
  // Abgleich bei jeder Übernahme eines neuen Pakets R (aus flyer.js uebernehme, genau einmal je Übernahme; R im
  // Format v2, Werte je Version und Seite). Idempotent: derselbe Abgleich noch einmal ändert nichts.
  // → { entfallen, behalten, konflikte, doks }
  function abgleichRechnen(paketR, liste_) {
    const aus = { entfallen: 0, behalten: 0, konflikte: 0, doks: new Set(), neu: [] };
    for (const e of liste_) {
      const r = wertInV2(paketR, e.ver, e.dok, e.art, e.k);
      const was = einordnen(e, r);
      if (was === 'entfaellt') { aus.entfallen++; aus.doks.add(e.dok); continue; }
      const n = kopie(e);
      if (was === 'bleibt') { n.alt = r; n.konflikt = null; aus.behalten++; }
      else {
        // Titel merken: aus R, sonst (Dokument in R entfernt) aus dem bisherigen Stand
        const d = seiteV2(paketR, e.ver, e.dok) || seiteV2(lokal(), e.ver, e.dok);
        n.konflikt = r === undefined ? { fehlt: true } : { online: r };
        if (d) n.konflikt.titel = String(d.titel);
        aus.konflikte++;
      }
      if (n.alt !== e.alt || !!n.konflikt !== !!e.konflikt) aus.doks.add(e.dok);
      aus.neu.push(n);
    }
    return aus;
  }
  function abgleichen(paketR) {
    if (!eintraege.size) return Promise.resolve({ entfallen: 0, behalten: 0, konflikte: 0, doks: [] });
    const aus = abgleichRechnen(paketR, liste());
    const vorher = JSON.stringify(liste().map(kopie));
    eintraege.clear();
    for (const n of aus.neu) eintraege.set(sk(n), n);
    // Stand-Einträge ohne verbleibende Änderung im Dokument fallen weg
    for (const e of liste()) if (e.art === 'stand' && !hatAenderungen(e.dok, e.ver)) { eintraege.delete(sk(e)); aus.doks.add(e.dok); }
    const ergebnis = { entfallen: aus.entfallen, behalten: aus.behalten, konflikte: konflikte().length, doks: Array.from(aus.doks) };
    if (JSON.stringify(liste().map(kopie)) === vorher) return Promise.resolve(ergebnis);
    return speichern().then(() => { melde({ doks: ergebnis.doks, abgleich: true }); return ergebnis; });
  }
  // Offene Konflikte für die Liste
  function konflikte() {
    const pk = lokal();
    return liste().filter((e) => e.konflikt).map((e) => {
      const d = seiteV2(pk, e.ver, e.dok);
      return {
        schluessel: sk(e), ver: e.ver, dok: e.dok, titel: d ? String(d.titel) : (typeof e.konflikt.titel === 'string' ? e.konflikt.titel : ''), art: e.art, k: e.k,
        basis: e.alt, meins: e.neu, online: e.konflikt.fehlt ? null : e.konflikt.online, fehlt: !!e.konflikt.fehlt
      };
    });
  }
  // „Meins behalten“ (Eintrag bleibt, alt := Online-Wert) oder „Online übernehmen“ (Eintrag entfällt)
  function entscheide(key, wahl) {
    if (gesperrt) return gesperrtFehler();
    const e = eintraege.get(key);
    if (!e || !e.konflikt) return Promise.resolve(false);
    if (wahl === 'meins') {
      if (typeof e.konflikt.online === 'string') e.alt = e.konflikt.online;
      e.konflikt = null;
    } else if (wahl === 'online') {
      eintraege.delete(key);
      standNachziehen(e.dok, false, e.ver);
    } else return Promise.resolve(false);
    const p = speichern();
    melde({ dok: e.dok });
    return p;
  }

  /* ---------- Export (Teil E) ---------- */
  function versionTag(v) {
    const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(v || '').trim());
    return m ? { tag: m[1], n: m[2].replace(/^0+(?=\d)/, '') } : null;
  }
  function groesser(a, b) { return a.length !== b.length ? a.length > b.length : a > b; }
  // Nächste Fassung „<heute>.<n>“: n = 1 bzw. eins mehr als die höchste bekannte Fassung desselben Tags
  function naechsteFassung(bekannte) {
    const tag = heute();
    let n = '0';
    for (const v of bekannte) {
      const t = versionTag(v);
      if (t && t.tag === tag && groesser(t.n, n)) n = t.n;
    }
    // Ziffernfolge + 1 (ohne Rundung, auch bei sehr langen Zahlen)
    const z = n.split('').map(Number);
    let i = z.length - 1;
    while (i >= 0) { if (z[i] < 9) { z[i]++; break; } z[i] = 0; i--; }
    if (i < 0) z.unshift(1);
    return tag + '.' + z.join('');
  }
  function bekannteFassungen(pk, onlineVersion) {
    return [pk && pk.version, onlineVersion].concat(exporte).filter((v) => typeof v === 'string' && v);
  }
  // Markierungen eines HTML-Textes (Werte in Reihenfolge) – Export muss sie unverändert erhalten
  function markierungen(html) {
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html), 'text/html');
    const b = doc.body;
    const m = {};
    for (const a of ['data-t', 'data-s', 'data-block', 'data-zaehler', 'data-stand']) m[a] = mitAttr(b, a).map((el) => el.getAttribute(a));
    m['ae-t'] = b.querySelectorAll('ae-t').length;
    return JSON.stringify(m);
  }
  // Elemente, die die Bereinigung samt Inhalt entfernt (wie WEG_ELEMENTE in flyer-paket.js): Die Wurzel für den Export
  // ist wie in der Darstellung das erste Element, das die Bereinigung übrig lässt – so zählen stand1, stand2 … gleich.
  const WEG = ['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base', 'form', 'template',
    'portal', 'noscript', 'fencedframe', 'handler', 'listener'];
  function htmlMitAenderungen(html, dokId, eigene) {
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html), 'text/html');
    const wurzel = Array.prototype.find.call(doc.body.children, (c) => WEG.indexOf(name(c)) < 0) || doc.body;
    anwenden(wurzel, dokId, eigene, { nurVorhandene: true });
    return doc.body.innerHTML;
  }
  // Paket = lokaler Stand aller Versionen (Format v2) + Änderungsschicht. → { paket, fassung, text, bytes } oder wirft
  // (AppError) – dann wird nichts ausgegeben.
  function exportPaket(onlineVersion) {
    const pk = lokal();
    if (!pk) throw fehler('export', 'Kein Paket zum Exportieren.', 'Erst ein Paket laden oder importieren.');
    const fassung = naechsteFassung(bekannteFassungen(pk, onlineVersion));
    const neu = JSON.parse(JSON.stringify(pk));
    const proDok = new Map();
    for (const e of eintraege.values()) {
      const key = e.ver + '\n' + e.dok;
      if (!proDok.has(key)) proDok.set(key, []);
      proDok.get(key).push(e);
    }
    for (const v of neu.versionen) {
      for (const d of v.seiten) {
        const eigene = proDok.get(v.nummer + '\n' + d.id);
        if (!eigene || !eigene.length) continue;
        const vorher = markierungen(d.html);
        d.html = htmlMitAenderungen(d.html, d.id, eigene);
        if (markierungen(d.html) !== vorher) throw fehler('export', 'Export fehlgeschlagen.', 'Version ' + v.nummer + ', Seite ' + d.id + ': Markierungen wären verändert worden.');
      }
    }
    neu.version = fassung;
    neu.stand = heute();
    try { P().pruefe(neu); } catch (e) {
      throw fehler('export', 'Export fehlgeschlagen.', 'Das Ergebnis ist kein gültiges Paket: ' + [e && e.title, e && e.text].filter(Boolean).join(' '));
    }
    const text = JSON.stringify(neu, null, 2);
    return { paket: neu, fassung: fassung, text: text, bytes: new TextEncoder().encode(text).length };
  }
  // HTML einer Seite mit den Änderungen ihrer Version (für Kopien von Seiten und Versionen: die Kopie zeigt, was die
  // Quelle gerade zeigt)
  function htmlMitSchicht(v, dok) {
    const eigene = [];
    for (const e of eintraege.values()) if (e.ver === v && e.dok === dok.id) eigene.push(e);
    return eigene.length ? htmlMitAenderungen(dok.html, dok.id, eigene) : dok.html;
  }
  // Nach erfolgreicher Weitergabe: exportiert := neu für alle Einträge, Fassung merken
  function markiereExportiert(fassung) {
    for (const e of eintraege.values()) e.exportiert = e.neu;
    if (typeof fassung === 'string' && fassung) exporte = exporte.filter((f) => f !== fassung).concat([fassung]).slice(-MAX_EXPORTE);
    const p = speichern();
    melde({ exportiert: fassung });
    return p;
  }
  function letzteFassung() { return exporte.length ? exporte[exporte.length - 1] : null; }

  /* ---------- Sicherung (Teil G) ---------- */
  // Sicherung der geöffneten Version; struktur (Feld-Änderungen) setzt flyer-bearbeiten.js über flyer.js ein
  function sicherung() {
    const pk = basis(), vv = ver();
    return {
      format: SICHERUNG_FORMAT,
      version: SICHERUNG_VERSION,
      paketFassung: pk ? String(pk.version) : '',
      versionNummer: vv,
      gesichert: jetztIso(),
      eintraege: liste().filter((e) => e.ver === vv).map(reinMitVer),
      struktur: []
    };
  }
  function istTextOderNull(v) { return v === null || typeof v === 'string'; }
  // Inhalt einer Sicherungsdatei prüfen → { eintraege, struktur }; wirft AppError (dann ändert sich nichts)
  function pruefeSicherung(text) {
    if (typeof text !== 'string') throw fehler('format', 'Datei ist kein gültiges JSON.', 'Die Datei enthält keinen Text.');
    if (text.length > MAX_SICHERUNG_BYTES || new TextEncoder().encode(text).length > MAX_SICHERUNG_BYTES) throw fehler('format', 'Datei zu groß.', 'Eine Sicherung hat höchstens 5 MB.');
    let o;
    try { o = JSON.parse(text.replace(/^﻿/, '')); } catch (e) { throw fehler('format', 'Datei ist kein gültiges JSON.', 'Die Datei lässt sich nicht als JSON lesen.'); }
    if (!istObjekt(o) || o.format !== SICHERUNG_FORMAT) throw fehler('format', 'Keine Änderungs-Sicherung.', 'Erwartet wird format „' + SICHERUNG_FORMAT + '“.');
    if (typeof o.version !== 'number' || !Number.isInteger(o.version) || o.version < 1) throw fehler('format', 'Sicherung fehlerhaft.', 'version muss eine ganze Zahl ab 1 sein.');
    if (o.version > SICHERUNG_VERSION) throw fehler('zuneu', 'Sicherung zu neu', 'Die Sicherung hat Version ' + o.version + '; diese Seite kennt Version ' + SICHERUNG_VERSION + '. Bitte das Dashboard aktualisieren.');
    if (o.paketFassung !== undefined && typeof o.paketFassung !== 'string') throw fehler('format', 'Sicherung fehlerhaft.', 'paketFassung muss ein Text sein.');
    if (o.gesichert !== undefined && typeof o.gesichert !== 'string') throw fehler('format', 'Sicherung fehlerhaft.', 'gesichert muss ein Text sein.');
    if (!Array.isArray(o.eintraege)) throw fehler('format', 'Sicherung fehlerhaft.', 'eintraege muss eine Liste sein.');
    if (o.eintraege.length > MAX_EINTRAEGE) throw fehler('format', 'Sicherung fehlerhaft.', 'Zu viele Einträge.');
    const v2 = o.version >= 2;
    if (v2 && o.versionNummer !== undefined && !istNummer(o.versionNummer)) throw fehler('format', 'Sicherung fehlerhaft.', 'versionNummer muss „x.y“ sein.');
    const gesehen = new Set();
    const eintraegeS = o.eintraege.map((e, i) => {
      const wo = 'Eintrag ' + (i + 1) + ': ';
      if (!istObjekt(e)) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'kein Objekt.');
      if (v2 && !istNummer(e.ver)) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'ver muss eine Versionsnummer „x.y“ sein.');
      const vv = v2 ? e.ver : ver();
      if (typeof e.dok !== 'string' || !e.dok) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'dok fehlt.');
      if (typeof e.k !== 'string' || !e.k) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'k fehlt.');
      if (ARTEN.indexOf(e.art) < 0) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'art muss text, status oder stand sein.');
      if (typeof e.neu !== 'string') throw fehler('format', 'Sicherung fehlerhaft.', wo + 'neu muss ein Text sein.');
      if (!istTextOderNull(e.alt) || !istTextOderNull(e.exportiert)) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'alt und exportiert müssen Text oder null sein.');
      if (e.zeit !== undefined && typeof e.zeit !== 'string') throw fehler('format', 'Sicherung fehlerhaft.', wo + 'zeit muss ein Text sein.');
      if (e.art === 'status' && e.neu && STATUS.indexOf(e.neu) < 0) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'unbekannter Status.');
      if (e.art === 'stand' && !/^stand\d+$/.test(e.k)) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'unbekannte Stand-Kennung.');
      const key = schluessel(vv, e.dok, e.art, e.k);
      if (gesehen.has(key)) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'doppelt.');
      gesehen.add(key);
      return { ver: vv, dok: e.dok, k: e.k, art: e.art, alt: e.alt === undefined ? null : e.alt, neu: e.neu,
        exportiert: e.exportiert === undefined ? null : e.exportiert, zeit: typeof e.zeit === 'string' && e.zeit ? e.zeit : jetztIso(), konflikt: null };
    });
    // Struktur (v2): [{ k: Feld, alt: JSON-Text|null, neu: JSON-Text|null }]
    const struktur = v2 && o.struktur !== undefined ? o.struktur : [];
    if (!Array.isArray(struktur)) throw fehler('format', 'Sicherung fehlerhaft.', 'struktur muss eine Liste sein.');
    if (struktur.length > MAX_EINTRAEGE) throw fehler('format', 'Sicherung fehlerhaft.', 'Zu viele Struktur-Einträge.');
    const felder = new Set();
    const strukturS = struktur.map((f, i) => {
      const wo = 'Struktur ' + (i + 1) + ': ';
      if (!istObjekt(f) || typeof f.k !== 'string' || !/^(V|O|P)\|[1-9]\d*\.[1-9]\d*\|.+|^Z\|[1-9]\d*\.[1-9]\d*$/.test(f.k)) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'unbekanntes Feld.');
      if (!istTextOderNull(f.alt) || !istTextOderNull(f.neu)) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'alt und neu müssen Text oder null sein.');
      for (const w of [f.alt, f.neu]) { if (w !== null) { try { JSON.parse(w); } catch (e) { throw fehler('format', 'Sicherung fehlerhaft.', wo + 'Wert ist kein JSON.'); } } }
      if (felder.has(f.k)) throw fehler('format', 'Sicherung fehlerhaft.', wo + 'doppelt.');
      felder.add(f.k);
      return { k: f.k, alt: f.alt, neu: f.neu };
    });
    return { eintraege: eintraegeS, struktur: strukturS };
  }
  function istNummer(v) { return typeof v === 'string' && /^[1-9]\d*\.[1-9]\d*$/.test(v); }
  // Eingespielte Einträge gegen die aktuelle Basis einordnen (Regeln wie beim Abgleich); vorhandene eigene Einträge
  // gehen vor. → { uebernommen, verworfen, konflikte, doks }
  function einspielen(text) {
    if (gesperrt) return gesperrtFehler();
    let neue;
    try { neue = pruefeSicherung(text).eintraege; } catch (e) { return Promise.reject(e); }
    return einspielenEintraege(neue);
  }
  // Geprüfte Einträge einspielen (flyer-bearbeiten.js spielt vorher die Struktur ein, damit neue Seiten schon da sind)
  function einspielenEintraege(neue) {
    if (gesperrt) return gesperrtFehler();
    const pk = lokal();
    if (!pk || !basis()) return Promise.reject(fehler('einspielen', 'Kein Paket geladen.', 'Erst ein Paket laden oder importieren.'));
    const aus = { uebernommen: 0, verworfen: 0, konflikte: 0, doks: new Set() };
    const kandidaten = neue.filter((e) => { if (eintraege.has(sk(e))) { aus.verworfen++; return false; } return true; });
    const r = abgleichRechnen(pk, kandidaten);
    aus.verworfen += r.entfallen;
    for (const n of r.neu) {
      eintraege.set(sk(n), n);
      aus.doks.add(n.dok);
      if (n.konflikt) aus.konflikte++; else aus.uebernommen++;
    }
    for (const e of liste()) if (e.art === 'stand' && !hatAenderungen(e.dok, e.ver)) { eintraege.delete(sk(e)); aus.doks.add(e.dok); }
    const ergebnis = { uebernommen: aus.uebernommen, verworfen: aus.verworfen, konflikte: aus.konflikte, doks: Array.from(aus.doks) };
    return speichern().then(() => { melde({ doks: ergebnis.doks, eingespielt: true }); return ergebnis; });
  }

  /* ---------- Abfragen ---------- */
  function fuerDok(dokId, v) {
    const vv = v || ver();
    const r = [];
    for (const e of eintraege.values()) if (e.ver === vv && e.dok === dokId) r.push(e);
    return r;
  }
  // Nicht exportierte Änderungen (Texte und Status; der Stand folgt ihnen von selbst)
  function nichtExportiert() {
    let n = 0;
    for (const e of eintraege.values()) if (e.art !== 'stand' && e.exportiert !== e.neu) n++;
    return n;
  }
  function geaendert(dokId, art, k) { return eintraege.has(schluessel(ver(), dokId, art, k)); }

  // h = { paket() → Sicht der geöffneten Version, version() → ihre Nummer, lokal() → lokaler Stand (v2) }
  function einrichten(h) {
    if (h && typeof h.paket === 'function') paketQuelle = h.paket;
    if (h && typeof h.version === 'function') versionQuelle = h.version;
    if (h && typeof h.lokal === 'function') lokalQuelle = h.lokal;
  }

  window.AetherFlyerAenderungen = Object.freeze({
    STATUS: Object.freeze(STATUS.slice()),
    SICHERUNG_FORMAT: SICHERUNG_FORMAT,
    SICHERUNG_VERSION: SICHERUNG_VERSION,
    einrichten: einrichten,
    laden: laden,
    sperre: sperre,
    // Darstellung
    anwenden: anwenden,
    zaehlerBerechnen: zaehlerBerechnen,
    formatiereStand: formatiereStand,
    standText: standText,
    werteAus: werteAus,
    heute: heute,
    // Bearbeiten
    setze: setze,
    original: original,
    dokumentZuruecksetzen: dokumentZuruecksetzen,
    verwerfen: verwerfen,
    entferne: entferne,
    aktuellerWert: aktuellerWert,
    // Abgleich, Export, Sicherung
    abgleichen: abgleichen,
    konflikte: konflikte,
    entscheide: entscheide,
    exportPaket: exportPaket,
    htmlMitSchicht: htmlMitSchicht,
    naechsteFassung: (onlineVersion) => naechsteFassung(bekannteFassungen(basis(), onlineVersion)),
    markiereExportiert: markiereExportiert,
    letzteFassung: letzteFassung,
    sicherung: sicherung,
    leseSicherung: pruefeSicherung,
    einspielen: einspielen,
    einspielenEintraege: einspielenEintraege,
    // Abfragen (alle: Einträge der geöffneten Version; alleVersionen: mit ver)
    alle: () => liste().filter((e) => e.ver === ver()).map(rein),
    alleVersionen: () => liste().map(reinMitVer),
    fuerDok: fuerDok,
    hatAenderungen: hatAenderungen,
    geaendert: geaendert,
    nichtExportiert: nichtExportiert,
    gespeichert: () => gespeichertOk,
    fertig: () => reihe
  });
})();
