// Änderungsschicht der Flyer-Seite (flyer.html, Teil 2): eigene Texte (data-t), Status (data-s → data-status) und das
// Stand-Datum (data-stand) je Dokument liegen als Einträge über dem zuletzt übernommenen Paket (Basis, bleibt
// unverändert). Dargestellt wird immer Basis + Änderungsschicht (anwenden, über optionen.anpassen der Ansicht), danach
// werden die Zähler und Balken jedes Blocks neu berechnet (zaehlerBerechnen).
// Eintrag: { dok, k, art:'text'|'status'|'stand', alt, neu, exportiert, zeit } – alt = Wert der Basis beim Anlegen
// (bzw. nach dem Abgleich), neu = eigener Wert, exportiert = Wert beim letzten Export (sonst null), zeit = ISO-Zeit.
// Im Speicher kommt konflikt hinzu (null oder { online } bzw. { fehlt:true }): offener Konflikt aus dem Abgleich.
// Text wird nur als Text eingesetzt (Textknoten, nie HTML); Zeilenumbrüche nur, wenn das Element in der Basis schon
// <br> hat (dann als <br>), sonst als Leerzeichen.
// Export: Paket = Basis + Änderungsschicht (Markierungen bleiben), Fassung „<JJJJ-MM-TT>.<n>“, muss
// AetherFlyerPaket.pruefe bestehen. Abgleich bei jeder Übernahme (abgleichen). Sicherung „aether-flyer-aenderungen“ v1.
// Gespeichert wird über AetherFlyerSpeicher (IndexedDB „aether-flyer“, Store „aenderungen“) – nie das Token.
(function () {
  'use strict';

  const ARTEN = ['text', 'status', 'stand'];
  const STATUS = ['ok', 'run', 'next', 'plan'];          // dazu '' = ohne Status
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
  const SICHERUNG_FORMAT = 'aether-flyer-aenderungen';
  const SICHERUNG_VERSION = 1;
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
  let paketQuelle = () => null;    // → Basis-Paket (von flyer.js)
  const werteCache = new Map();    // html → { text, status, stand } der Basis (bereinigt gelesen)

  /* ---------- Hilfen ---------- */
  function fehler(kind, title, text) {
    const G = window.AetherGemeinsam;
    if (G && typeof G.AppError === 'function') return new G.AppError(kind, title, text || '');
    const e = new Error(title); e.kind = kind; e.title = title; e.text = text || ''; return e;
  }
  function istObjekt(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function schluessel(dok, art, k) { return dok + '\n' + art + '\n' + k; }
  function sk(e) { return schluessel(e.dok, e.art, e.k); }
  function kopie(e) { return { dok: e.dok, k: e.k, art: e.art, alt: e.alt, neu: e.neu, exportiert: e.exportiert, zeit: e.zeit, konflikt: e.konflikt ? Object.assign({}, e.konflikt) : null }; }
  function rein(e) { return { dok: e.dok, k: e.k, art: e.art, alt: e.alt, neu: e.neu, exportiert: e.exportiert, zeit: e.zeit }; }
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
  // Text als Textknoten einsetzen (nie HTML); Zeilenumbrüche als <br>, wenn erlaubt.
  function textSchreiben(traeger, wert, umbruch) {
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

  /* ---------- Werte der Basis ---------- */
  // Werte eines Dokuments (bereinigt gelesen, wie dargestellt): text k → { wert, umbruch }, status k → wert ('' = ohne),
  // stand k → { wert, format } (nur Stand-Elemente mit reinem Text).
  function werteAus(wurzel) {
    const text = new Map(), status = new Map(), stand = new Map();
    for (const el of mitAttr(wurzel, 'data-t')) {
      const k = el.getAttribute('data-t');
      if (!k || text.has(k)) continue;
      const tr = textTraeger(el);
      text.set(k, { wert: textLesen(tr), umbruch: hatUmbruch(tr) });
    }
    for (const el of mitAttr(wurzel, 'data-s')) {
      const k = el.getAttribute('data-s');
      if (!k || status.has(k)) continue;
      const st = el.getAttribute('data-status');
      status.set(k, st === null ? '' : st);
    }
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
  // Wert in einem Paket (undefined, wenn es das Dokument oder die Kennung dort nicht gibt)
  function wertIn(paket, dokId, art, k) {
    const dok = dokIn(paket, dokId);
    if (!dok) return undefined;
    const m = werte(dok)[art];
    if (!m || !m.has(k)) return undefined;
    const v = m.get(k);
    return typeof v === 'string' ? v : v.wert;
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
          if (o.markieren) markiere(el);
        }
      }
    }
    return [];
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
  function basis() { try { return paketQuelle() || null; } catch (e) { return null; } }
  function hatAenderungen(dokId) {
    for (const e of eintraege.values()) if (e.dok === dokId && e.art !== 'stand') return true;
    return false;
  }
  // Eigenen Wert setzen (aus dem Vollbild). neu = Basis-Wert → Eintrag weg. → Promise<Boolean> (gespeichert)
  function setze(dokId, art, k, wert) {
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
    const key = schluessel(dokId, art, k);
    const vorher = eintraege.get(key);
    // Unverändert (auch wenn sich nur Quelltext-Zeilenumbrüche der Basis zu Leerzeichen normalisiert haben) → kein Eintrag
    if (neu === altWert || (art === 'text' && neu === normalisiere(altWert, b.umbruch))) eintraege.delete(key);
    else if (vorher) {
      vorher.neu = neu; vorher.zeit = jetztIso();
      // Neue eigene Eingabe entscheidet einen offenen Konflikt für „meins“ (alt = jetziger Basis-Wert)
      if (vorher.konflikt) { vorher.alt = altWert; vorher.konflikt = null; }
    } else {
      eintraege.set(key, { dok: dokId, k: k, art: art, alt: altWert, neu: neu, exportiert: null, zeit: jetztIso(), konflikt: null });
    }
    const p = speichern();
    melde({ dok: dokId });
    return p;
  }
  // „Original“: Eintrag weg (Basis-Wert gilt); ohne weitere Änderungen auch der Stand-Eintrag.
  function original(dokId, art, k) {
    eintraege.delete(schluessel(dokId, art, k));
    const p = speichern();
    melde({ dok: dokId });
    return p;
  }
  // Alle Änderungen eines Dokuments zurücknehmen (samt Stand)
  function dokumentZuruecksetzen(dokId) {
    for (const e of liste()) if (e.dok === dokId) eintraege.delete(sk(e));
    const p = speichern();
    melde({ dok: dokId });
    return p;
  }
  // Aktueller (eigener) Wert einer Stelle für das Bearbeitungsfeld bzw. die Auswahl
  function aktuellerWert(dokId, art, k) {
    const e = eintraege.get(schluessel(dokId, art, k));
    if (e) return e.neu;
    const v = wertIn(basis(), dokId, art, k);
    return v === undefined ? null : v;
  }

  /* ---------- Abfragen ---------- */
  function fuerDok(dokId) {
    const r = [];
    for (const e of eintraege.values()) if (e.dok === dokId) r.push(e);
    return r;
  }
  // Nicht exportierte Änderungen (Texte und Status; der Stand folgt ihnen von selbst)
  function nichtExportiert() {
    let n = 0;
    for (const e of eintraege.values()) if (e.art !== 'stand' && e.exportiert !== e.neu) n++;
    return n;
  }
  function geaendert(dokId, art, k) { return eintraege.has(schluessel(dokId, art, k)); }

  function einrichten(h) {
    if (h && typeof h.paket === 'function') paketQuelle = h.paket;
  }

  window.AetherFlyerAenderungen = Object.freeze({
    STATUS: Object.freeze(STATUS.slice()),
    SICHERUNG_FORMAT: SICHERUNG_FORMAT,
    SICHERUNG_VERSION: SICHERUNG_VERSION,
    einrichten: einrichten,
    laden: laden,
    // Darstellung
    anwenden: anwenden,
    werteAus: werteAus,
    // Bearbeiten
    setze: setze,
    original: original,
    dokumentZuruecksetzen: dokumentZuruecksetzen,
    aktuellerWert: aktuellerWert,
    // Abgleich, Export, Sicherung
    // Abfragen
    alle: () => liste().map(rein),
    fuerDok: fuerDok,
    hatAenderungen: hatAenderungen,
    geaendert: geaendert,
    nichtExportiert: nichtExportiert,
    gespeichert: () => gespeichertOk,
    fertig: () => reihe
  });
})();
