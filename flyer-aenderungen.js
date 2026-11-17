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
  // Wert in einem Paket (undefined, wenn es das Dokument oder die Kennung dort nicht gibt)
  function wertIn(paket, dokId, art, k) {
    const dok = dokIn(paket, dokId);
    if (!dok) return undefined;
    const m = werte(dok)[art];
    if (!m || !m.has(k)) return undefined;
    const v = m.get(k);
    return typeof v === 'string' ? v : v.wert;
  }

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
  function zaehlerText(z, x, y) {
    // Vorhandene Stelle „x von y“ (nicht in einem Listenpunkt des Blocks) ersetzen …
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
      return;
    }
    // … sonst nur in einen leeren Träger schreiben (nie eine Überschrift überschreiben)
    const tr = textTraeger(z);
    if (!tr.firstElementChild && !tr.textContent.trim()) tr.textContent = x + ' von ' + y + ' fertig';
  }
  // Für jeden Block (data-block mit data-zaehler): y = Listenpunkte (data-s) im Block (alle Elemente mit demselben
  // data-block-Wert), x = davon data-status="ok"; Text „x von y fertig“, --anteil = x/y, --anteil-laeuft = (ok+run)/y,
  // y = 0 → 0. Die Variablen werden am Zähler und an den Block-Elementen gesetzt und überall im Block ersetzt, wo das
  // Paket sie schon im style-Attribut setzt. nurVorhandene (Export): nur vorhandene Werte ersetzen, nichts hinzufügen.
  function zaehlerBerechnen(wurzel, opt) {
    const nurVorhandene = !!(opt && opt.nurVorhandene);
    const bloecke = new Map();
    for (const el of mitAttr(wurzel, 'data-block')) {
      const w = el.getAttribute('data-block');
      if (!bloecke.has(w)) bloecke.set(w, []);
      bloecke.get(w).push(el);
    }
    const ergebnis = [];
    for (const z of mitAttr(wurzel, 'data-zaehler')) {
      const zw = z.getAttribute('data-zaehler');
      let wert = null;
      if (zw && bloecke.has(zw)) wert = zw;
      else if (z.hasAttribute('data-block')) wert = z.getAttribute('data-block');
      else {
        const a = z.parentElement ? z.parentElement.closest('[data-block]') : null;
        if (a) wert = a.getAttribute('data-block');
      }
      if (wert === null) continue;
      const els = bloecke.get(wert) || [];
      const punkte = new Set();
      for (const b of els) {
        if (b.hasAttribute('data-s')) punkte.add(b);
        for (const p of b.querySelectorAll('[data-s]')) punkte.add(p);
      }
      let ok = 0, run = 0;
      for (const p of punkte) {
        const st = p.getAttribute('data-status');
        if (st === 'ok') ok++; else if (st === 'run') run++;
      }
      const y = punkte.size;
      const anteil = y ? ok / y : 0, laeuft = y ? (ok + run) / y : 0;
      zaehlerText(z, ok, y);
      const a = zahl(anteil), l = zahl(laeuft);
      const ziele = [z].concat(els);
      for (const el of ziele) {
        const da = ersetzeVar(el, '--anteil', a), dl = ersetzeVar(el, '--anteil-laeuft', l);
        if (!nurVorhandene && el.style) {
          if (!da) el.style.setProperty('--anteil', a);
          if (!dl) el.style.setProperty('--anteil-laeuft', l);
        }
        for (const d of el.querySelectorAll('[style]')) { ersetzeVar(d, '--anteil', a); ersetzeVar(d, '--anteil-laeuft', l); }
      }
      ergebnis.push({ block: wert, x: ok, y: y, anteil: a, laeuft: l });
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
    return zaehlerBerechnen(wurzel, { nurVorhandene: o.nurVorhandene });
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
  // Stand-Einträge eines Dokuments: nach einer Änderung auf heute (heute = true), ohne Änderungen weg.
  function standNachziehen(dokId, aufHeute) {
    const pk = basis(), dok = dokIn(pk, dokId);
    const mit = hatAenderungen(dokId);
    for (const e of liste()) if (e.dok === dokId && e.art === 'stand' && (!mit || !dok)) eintraege.delete(sk(e));
    if (!mit || !dok || !aufHeute) return;
    const iso = heute(), zeit = jetztIso();
    werte(dok).stand.forEach((b, k) => {
      const key = schluessel(dokId, 'stand', k);
      const neu = normalisiere(standText(b.wert, b.format, iso), b.umbruch);
      const vorhanden = eintraege.get(key);
      if (neu === b.wert) { if (vorhanden && !vorhanden.konflikt) eintraege.delete(key); return; }
      if (vorhanden) { if (vorhanden.neu !== neu) { vorhanden.neu = neu; vorhanden.zeit = zeit; } return; }
      eintraege.set(key, { dok: dokId, k: k, art: 'stand', alt: b.wert, neu: neu, exportiert: null, zeit: zeit, konflikt: null });
    });
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
    standNachziehen(dokId, true);
    const p = speichern();
    melde({ dok: dokId });
    return p;
  }
  // „Original“: Eintrag weg (Basis-Wert gilt); ohne weitere Änderungen auch der Stand-Eintrag.
  function original(dokId, art, k) {
    eintraege.delete(schluessel(dokId, art, k));
    standNachziehen(dokId, false);
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
  // Abgleich bei jeder Übernahme eines neuen Pakets R (aus flyer.js uebernehme, genau einmal je Übernahme).
  // Idempotent: derselbe Abgleich noch einmal ändert nichts. → { entfallen, behalten, konflikte, doks }
  function abgleichRechnen(paketR, liste_) {
    const aus = { entfallen: 0, behalten: 0, konflikte: 0, doks: new Set(), neu: [] };
    for (const e of liste_) {
      const r = wertIn(paketR, e.dok, e.art, e.k);
      const was = einordnen(e, r);
      if (was === 'entfaellt') { aus.entfallen++; aus.doks.add(e.dok); continue; }
      const n = kopie(e);
      if (was === 'bleibt') { n.alt = r; n.konflikt = null; aus.behalten++; }
      else { n.konflikt = r === undefined ? { fehlt: true } : { online: r }; aus.konflikte++; }
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
    for (const e of liste()) if (e.art === 'stand' && !hatAenderungen(e.dok)) { eintraege.delete(sk(e)); aus.doks.add(e.dok); }
    const ergebnis = { entfallen: aus.entfallen, behalten: aus.behalten, konflikte: konflikte().length, doks: Array.from(aus.doks) };
    if (JSON.stringify(liste().map(kopie)) === vorher) return Promise.resolve(ergebnis);
    return speichern().then(() => { melde({ doks: ergebnis.doks, abgleich: true }); return ergebnis; });
  }
  // Offene Konflikte für die Liste
  function konflikte() {
    const pk = basis();
    return liste().filter((e) => e.konflikt).map((e) => {
      const d = dokIn(pk, e.dok);
      return {
        schluessel: sk(e), dok: e.dok, titel: d ? String(d.titel) : '', art: e.art, k: e.k,
        basis: e.alt, meins: e.neu, online: e.konflikt.fehlt ? null : e.konflikt.online, fehlt: !!e.konflikt.fehlt
      };
    });
  }
  // „Meins behalten“ (Eintrag bleibt, alt := Online-Wert) oder „Online übernehmen“ (Eintrag entfällt)
  function entscheide(key, wahl) {
    const e = eintraege.get(key);
    if (!e || !e.konflikt) return Promise.resolve(false);
    if (wahl === 'meins') {
      if (typeof e.konflikt.online === 'string') e.alt = e.konflikt.online;
      e.konflikt = null;
    } else if (wahl === 'online') {
      eintraege.delete(key);
      standNachziehen(e.dok, false);
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
  function htmlMitAenderungen(html, dokId, eigene) {
    const doc = new DOMParser().parseFromString('<!doctype html><body>' + String(html), 'text/html');
    anwenden(doc.body, dokId, eigene, { nurVorhandene: true });
    return doc.body.innerHTML;
  }
  // Paket = Basis + Änderungsschicht. → { paket, fassung, text } oder wirft (AppError) – dann wird nichts ausgegeben.
  function exportPaket(onlineVersion) {
    const pk = basis();
    if (!pk) throw fehler('export', 'Kein Paket zum Exportieren.', 'Erst ein Paket laden oder importieren.');
    const fassung = naechsteFassung(bekannteFassungen(pk, onlineVersion));
    const neu = JSON.parse(JSON.stringify(pk));
    const proDok = new Map();
    for (const e of eintraege.values()) {
      if (!proDok.has(e.dok)) proDok.set(e.dok, []);
      proDok.get(e.dok).push(e);
    }
    for (const d of neu.dokumente) {
      const eigene = proDok.get(d.id);
      if (!eigene || !eigene.length) continue;
      const vorher = markierungen(d.html);
      d.html = htmlMitAenderungen(d.html, d.id, eigene);
      if (markierungen(d.html) !== vorher) throw fehler('export', 'Export fehlgeschlagen.', 'Dokument ' + d.id + ': Markierungen wären verändert worden.');
    }
    neu.version = fassung;
    neu.stand = heute();
    try { P().pruefe(neu); } catch (e) {
      throw fehler('export', 'Export fehlgeschlagen.', 'Das Ergebnis ist kein gültiges Paket: ' + [e && e.title, e && e.text].filter(Boolean).join(' '));
    }
    return { paket: neu, fassung: fassung, text: JSON.stringify(neu, null, 2) };
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
    zaehlerBerechnen: zaehlerBerechnen,
    formatiereStand: formatiereStand,
    standText: standText,
    werteAus: werteAus,
    heute: heute,
    // Bearbeiten
    setze: setze,
    original: original,
    dokumentZuruecksetzen: dokumentZuruecksetzen,
    aktuellerWert: aktuellerWert,
    // Abgleich, Export, Sicherung
    abgleichen: abgleichen,
    konflikte: konflikte,
    entscheide: entscheide,
    exportPaket: exportPaket,
    naechsteFassung: (onlineVersion) => naechsteFassung(bekannteFassungen(basis(), onlineVersion)),
    markiereExportiert: markiereExportiert,
    letzteFassung: letzteFassung,
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
