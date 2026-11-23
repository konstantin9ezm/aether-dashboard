// Dynamische Werte der Flyer-Seite (flyer.html, Stufe 1): Zahlen und Listen in den Seiten kommen aus den Repos statt aus
// dem Paket-Text. Platzhalter im Seiten-HTML:
//   <span data-wert="<schlüssel>" data-format="zahl|prozent|dauer-min|datum-kurz|datum-lang|liste" data-wert-teil="…">Text</span>
// Der Text ist zugleich Rückfallwert (Paket allein lesbar, offline, ältere Dashboards); data-format fehlt → Format des
// Schlüssels; data-wert-teil wählt einen Teil (z. B. „median“, „art“, bei Listen die Anzahl, bei aether.commits.seit das
// Datum JJJJ-MM-TT). Feste Liste der Quellen unten (Schlüssel → Abruf + Ableitung + Beschreibung + Quelle-Text).
// Zwischenspeicher: IndexedDB „aether-flyer“ v5, Store „werte“ (AetherFlyerSpeicher.ladeWerte/speichereWerte) – zuletzt
// gelesener Wert, Zeitpunkt, ETag und letzter Fehler; nie das Token.
// Auffrischen: beim Öffnen, per „Online prüfen“, beim online-Ereignis und alle 10 Minuten; nie zwei gleichzeitig; nur
// die Quellen, die die geöffnete Version wirklich nutzt (data-wert oder Verknüpfung); höchstens MAX_ANFRAGEN
// GitHub-Anfragen je Auffrischung, bedingt (ETag → 304 kostet kein Rate-Limit); jede mit Zeitlimit (withProjTimeout,
// danach abgebrochen). Token nur über h.token() (nur gelesen, nur als Header an api.github.com, nie gespeichert).
// Ohne Token: Werte aus aether bleiben beim letzten bekannten Wert, öffentliche Werte (aether-dashboard) und die
// Engine-Karte (gleicher Ursprung) werden trotzdem gelesen.
// Darstellung (anwenden, im Anpasser von flyer.js nach der Änderungsschicht): Wert aus dem Zwischenspeicher als Text
// (nie HTML); ohne gespeicherten Wert bleibt der Paket-Text. Fußzeile „Werte vom TT.MM.JJJJ, HH:MM“ (Türkis; veraltet
// oder offline in Orange mit „· offline“ bzw. „· veraltet“) nur auf Seiten mit mindestens einem Wert; data-stand mit
// data-stand-quelle="werte" zeigt den Zeitpunkt der jüngsten gelesenen Quelle der Seite. Markiert wird nur im Vollbild
// im Modus „Text“: live türkis gepunktet mit „↻ live“, veraltet orange gepunktet mit „⚠ <Alter>“ bzw. „⚠ offline“.
// „Veraltet“: kein erfolgreiches Lesen seit VERALTET_MS (24 h, Entscheidung 23.11.) oder letzter Versuch mit Fehler.
// Antippen im Modus „Text“ öffnet die Tafel (#vbWert): Wert, Beschreibung, Quelle, Zeitpunkt, Wert im Paket; „Jetzt neu
// lesen“, „Von Hand überschreiben …“ (Änderungsart „wert“ der Änderungsschicht) und „Original“ (wieder live).
// Export: PDF, Bild und PowerPoint zeichnen über denselben Anpasser (Werte zum Exportzeitpunkt, ohne Markierung);
// schnappschuss(wurzel) schreibt für den Paket-Export den aktuellen Wert als Text (data-wert bleibt).
(function () {
  'use strict';

  // Entscheidung Konstantin (23.11.): „veraltet“ nach 24 Stunden ohne erfolgreiches Lesen – eine Konstante, leicht änderbar.
  const VERALTET_MS = 24 * 60 * 60 * 1000;
  // Selbst gewählt: wie die Paket-Prüfung alle 10 Minuten; höchstens 10 GitHub-Anfragen je Auffrischung.
  const INTERVALL_MS = 10 * 60 * 1000;
  const MAX_ANFRAGEN = 10;
  const API = 'https://api.github.com';
  const AETHER = 'konstantin9ezm/aether';
  const DASHBOARD = 'konstantin9ezm/aether-dashboard';
  const RAW = 'application/vnd.github.raw+json';
  // Richtwerte der Vorschau
  const FARBE = Object.freeze({ live: '#3fd1d8', liveText: '#7ff0f5', alt: '#ffb347', altText: '#ffd08a', hand: '#8c7cf0' });
  const FORMATE = Object.freeze(['zahl', 'prozent', 'dauer-min', 'datum-kurz', 'datum-lang', 'liste']);
  const MONATE = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni', 'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];

  const $ = (id) => document.getElementById(id);
  const G = () => window.AetherGemeinsam;
  const S = () => window.AetherFlyerSpeicher || null;
  const AE = () => window.AetherFlyerAenderungen || null;
  const A = () => window.AetherFlyerAnsicht || null;
  const B = () => window.AetherFlyerBearbeiten || null;

  /* ---------- Quellen Q1–Q8 (Teil 2) ---------- */
  const ABRUFE = [];
  const SCHLUESSEL = {};
  /* ---------- Ende Quellen ---------- */

  /* ---------- Zustand ---------- */
  let h = null;                    // Hilfen von flyer.js
  let gh = null;                   // githubApi (gemeinsam.js)
  const werte = new Map();         // Speicher-Schlüssel → Eintrag { schluessel, wert, teile, quelle, zeit, etag, fehler }
  let geladen = null;              // Promise: Zwischenspeicher gelesen
  let laeuft = null;               // laufende Auffrischung
  let letzte = null;               // Ergebnis der letzten Auffrischung (für Tests)
  const anfragen = [];             // nur für Tests: Pfade der GitHub-Anfragen (ohne Token), beim Absenden gezählt
  const versucht = new Set();      // in dieser Sitzung schon gelesene Speicher-Schlüssel
  let tafel = null;                // offene Tafel: { dok, schluessel, teil, k }

  /* ---------- Hilfen ---------- */
  function abrufVon(id) { return ABRUFE.find((a) => a.id === id) || null; }
  function defVon(schluessel) { return Object.prototype.hasOwnProperty.call(SCHLUESSEL, schluessel) ? SCHLUESSEL[schluessel] : null; }
  // Speicher-Schlüssel: bei Abrufen mit Teil (z. B. aether.commits.seit|2026-11-01) gehört der Teil dazu
  function speicherSchluessel(schluessel, teil) {
    const d = defVon(schluessel), a = d ? abrufVon(d.abruf) : null;
    return a && a.mitTeil ? schluessel + '|' + (teil || '') : schluessel;
  }
  function eintrag(schluessel, teil) { return werte.get(speicherSchluessel(schluessel, teil)) || null; }
  function jetzt() { return Date.now(); }
  const zwei = (n) => (n < 10 ? '0' : '') + n;
  function alsDatum(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(String(iso || ''));
    return isNaN(d.getTime()) ? null : d;
  }
  function zeitText(iso) {
    const d = alsDatum(iso);
    return d ? zwei(d.getDate()) + '.' + zwei(d.getMonth() + 1) + '.' + d.getFullYear() + ', ' + zwei(d.getHours()) + ':' + zwei(d.getMinutes()) : '';
  }
  function tausender(n) {
    const r = Math.round(Number(n));
    return (r < 0 ? '-' : '') + String(Math.abs(r)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  }
  function alterText(ms) {
    const min = Math.max(0, Math.floor(ms / 60000));
    if (min < 60) return min + ' Min. alt';
    const std = Math.floor(min / 60);
    if (std < 48) return std + ' Std. alt';
    const tage = Math.floor(std / 24);
    return tage + (tage === 1 ? ' Tag alt' : ' Tage alt');
  }
  function meldung(t) { try { G().meldung(t); } catch (e) { /* ohne #toast */ } }
  function tokenLesen() { try { const t = h && h.token(); return typeof t === 'string' && t ? t : null; } catch (e) { return null; } }

  /* ---------- Formate ---------- */
  // Wert eines Eintrags als Text: format (data-format, sonst das des Schlüssels), teil wählt einen Teil (teile[teil]) bzw.
  // bei Listen die Anzahl der Einträge.
  function formatiere(e, format, teil) {
    if (!e) return null;
    let v = e.wert;
    if (teil && e.teile && Object.prototype.hasOwnProperty.call(e.teile, teil)) v = e.teile[teil];
    if (v === null || v === undefined) return null;
    if (Array.isArray(v)) {
      const n = /^[1-9]\d*$/.test(String(teil || '')) ? Number(teil) : v.length;
      return v.slice(0, n).join(' · ');
    }
    if (typeof v !== 'number') {
      if (format === 'datum-kurz' || format === 'datum-lang') {
        const d = alsDatum(v);
        if (d) return format === 'datum-lang' ? d.getDate() + '. ' + MONATE[d.getMonth()] + ' ' + d.getFullYear() : zwei(d.getDate()) + '.' + zwei(d.getMonth() + 1) + '.' + d.getFullYear();
      }
      return String(v);
    }
    if (format === 'prozent') return Math.round(v) + ' %';
    if (format === 'dauer-min') return v < 0.5 ? '< 1 min' : tausender(v) + ' min';
    return tausender(v);
  }
  function formatVon(el, d) {
    const f = el.getAttribute('data-format');
    return FORMATE.indexOf(f) >= 0 ? f : (d ? d.format : 'zahl');
  }

  /* ---------- Zustand eines Werts ---------- */
  // 'live' | 'alt' (veraltet: Fehler beim letzten Versuch oder älter als VERALTET_MS) | 'leer' (nie gelesen)
  function zustandVon(e) {
    if (!e || e.wert === null || e.wert === undefined) return e && e.fehler ? 'alt' : 'leer';
    if (e.fehler) return 'alt';
    const t = Date.parse(e.zeit || '');
    if (!isFinite(t) || jetzt() - t > VERALTET_MS) return 'alt';
    return 'live';
  }
  function abzeichenVon(e, zustand) {
    if (zustand === 'live') return '↻ live';
    if (e && e.fehler && e.fehler.art === 'offline') return '⚠ offline';
    if (e && e.fehler) return '⚠ Fehler';
    if (zustand === 'leer') return '⚠ kein Wert';
    return '⚠ ' + alterText(jetzt() - Date.parse(e.zeit || ''));
  }

  /* ---------- Darstellung ---------- */
  function mitAttr(wurzel, attr) {
    const r = [];
    if (wurzel.nodeType === 1 && wurzel.hasAttribute(attr)) r.push(wurzel);
    for (const el of wurzel.querySelectorAll('[' + attr + ']')) r.push(el);
    return r;
  }
  const EIGENE = '[data-ae-abzeichen],[data-ae-werte-fuss]';
  // Text eines Werts (ohne eigene Abzeichen und Fußzeile), Textträger wie in der Änderungsschicht (erstes <ae-t>)
  function textVon(el) {
    const tr = el.querySelector('ae-t') || el;
    let t = '';
    const lauf = (n) => {
      for (const c of n.childNodes) {
        if (c.nodeType === 3) t += c.data;
        else if (c.nodeType === 1 && !(c.matches && c.matches(EIGENE))) lauf(c);
      }
    };
    lauf(tr);
    return t;
  }
  function textSetzen(el, t) {
    const ae = AE();
    if (ae && typeof ae.textSetzen === 'function') { ae.textSetzen(el, t); return; }
    const tr = el.querySelector('ae-t') || el;
    tr.textContent = t;
  }
  function abzeichen(el, text, farbe, schrift, grund) {
    const doc = el.ownerDocument;
    const b = doc.createElement('span');
    b.setAttribute('data-ae-abzeichen', '');
    b.setAttribute('aria-hidden', 'true');
    b.textContent = text;
    const st = b.style;
    for (const [k, v] of [['position', 'absolute'], ['left', '0'], ['bottom', '100%'], ['margin', '0 0 6px'], ['padding', '1px 7px'],
      ['border-radius', '7px'], ['border', '1px solid ' + farbe], ['background', grund], ['color', schrift], ['font', '600 12px/1.4 system-ui, sans-serif'],
      ['letter-spacing', '0'], ['text-transform', 'none'], ['white-space', 'nowrap'], ['pointer-events', 'none'], ['z-index', '5']]) st.setProperty(k, v, 'important');
    if (getComputedStyleSicher(el) === 'static') el.style.setProperty('position', 'relative', 'important');
    el.appendChild(b);
  }
  // Vor dem Einsetzen gibt es keinen berechneten Stil: dann nur nach dem style-Attribut gehen
  function getComputedStyleSicher(el) {
    const p = el.style && el.style.getPropertyValue('position');
    return p || 'static';
  }
  function markiere(el, zustand, e) {
    el.setAttribute('data-ae-wz', zustand);
    const st = el.style;
    if (!st) return;
    if (zustand === 'live' || zustand === 'alt' || zustand === 'leer') {
      const f = zustand === 'live' ? FARBE.live : FARBE.alt;
      st.setProperty('outline', '2px dotted ' + f, 'important');
      st.setProperty('outline-offset', '3px', 'important');
      st.setProperty('border-radius', '4px', 'important');
      abzeichen(el, abzeichenVon(e, zustand), f, zustand === 'live' ? FARBE.liveText : FARBE.altText, zustand === 'live' ? '#0b2d33' : '#33240b');
    } else {
      // von Hand überschrieben bzw. (noch) kein bekannter Schlüssel: wie normaler Text gestrichelt
      st.setProperty('text-decoration', 'underline dashed ' + FARBE.hand, 'important');
      st.setProperty('text-decoration-thickness', '2px', 'important');
      st.setProperty('text-underline-offset', '3px', 'important');
      abzeichen(el, zustand === 'hand' ? '✎ von Hand' : 'Hand · Stufe 2', FARBE.hand, '#e3ddff', '#1f1a40');
    }
  }
  // Werte auf eine Darstellung anwenden (Kachel, Vollbild, Druck, Bild): opt.markieren nur im Vollbild im Modus „Text“.
  // → { anzahl, zeiten } (für Tests und PowerPoint-Notizen)
  function anwenden(wurzel, dok, opt) {
    const o = opt || {};
    const els = mitAttr(wurzel, 'data-wert');
    if (!els.length) return { anzahl: 0 };
    const zeiten = [];
    let alt = false, offline = false;
    for (const el of els) {
      const schluessel = el.getAttribute('data-wert') || '';
      const teil = el.getAttribute('data-wert-teil') || '';
      const d = defVon(schluessel);
      if (!el.hasAttribute('data-ae-paket')) el.setAttribute('data-ae-paket', textVon(el));
      const hand = el.getAttribute('data-wert-hand');
      let zustand, e = null;
      if (hand !== null) { textSetzen(el, hand); zustand = 'hand'; }
      else if (!d) zustand = 'unbekannt';
      else {
        e = eintrag(schluessel, teil);
        const t = formatiere(e, formatVon(el, d), teil);
        if (t !== null) textSetzen(el, t);
        zustand = zustandVon(e);
        if (e && e.zeit) zeiten.push(e.zeit);
        if (zustand !== 'live') alt = true;
        if (e && e.fehler && e.fehler.art === 'offline') offline = true;
      }
      if (o.markieren) markiere(el, zustand, e);
    }
    fussZeile(wurzel, zeiten, alt, offline || navigator.onLine === false);
    standQuelle(wurzel, zeiten);
    return { anzahl: els.length, zeiten: zeiten };
  }
  function aeltester(zeiten) { return zeiten.slice().sort((a, b) => Date.parse(a) - Date.parse(b))[0]; }
  function juengster(zeiten) { return zeiten.slice().sort((a, b) => Date.parse(b) - Date.parse(a))[0]; }
  // „Werte vom …“ nach den Quellen der Fußzeile (erstes Textelement der Fußzeile, sonst die Fußzeile selbst)
  function fussZeile(wurzel, zeiten, alt, offline) {
    if (!zeiten.length) return;
    const ziel = wurzel.querySelector('footer [data-t], .ft [data-t]') || wurzel.querySelector('footer, .ft');
    if (!ziel) return;
    const z = zeitText(aeltester(zeiten));
    const sp = wurzel.ownerDocument.createElement('span');
    sp.setAttribute('data-ae-werte-fuss', alt ? 'alt' : 'live');
    sp.setAttribute('data-ae-werte-zeit', z);
    sp.textContent = ' · Werte vom ' + z + (alt ? (offline ? ' · offline' : ' · veraltet') : '');
    sp.style.setProperty('color', alt ? FARBE.altText : FARBE.liveText, 'important');
    ziel.appendChild(sp);
  }
  // data-stand mit data-stand-quelle="werte": Datum der jüngsten gelesenen Quelle der Seite (sonst bleibt alles wie heute)
  function standQuelle(wurzel, zeiten) {
    if (!zeiten.length) return;
    const d = alsDatum(juengster(zeiten));
    if (!d) return;
    const iso = d.getFullYear() + '-' + zwei(d.getMonth() + 1) + '-' + zwei(d.getDate());
    const ae = AE();
    for (const el of mitAttr(wurzel, 'data-stand')) {
      if (el.getAttribute('data-stand-quelle') !== 'werte') continue;
      const alt = textVon(el);
      const neu = ae && typeof ae.standText === 'function' ? ae.standText(alt, el.getAttribute('data-stand'), iso) : iso;
      textSetzen(el, neu);
    }
  }
  // Paket-Export: aktuellen Wert als Text schreiben (data-wert bleibt; von Hand überschrieben → dieser Text).
  // → true, wenn sich ein Text geändert hat (sonst bleibt das HTML der Seite bitgleich)
  function schnappschuss(wurzel) {
    let geaendert = false;
    for (const el of mitAttr(wurzel, 'data-wert')) {
      const schluessel = el.getAttribute('data-wert') || '', teil = el.getAttribute('data-wert-teil') || '';
      const hand = el.getAttribute('data-wert-hand');
      const d = defVon(schluessel);
      const t = hand !== null ? hand : (d ? formatiere(eintrag(schluessel, teil), formatVon(el, d), teil) : null);
      if (t === null || textVon(el) === t) continue;
      textSetzen(el, t);
      geaendert = true;
    }
    return geaendert;
  }

  /* ---------- Welche Werte braucht die geöffnete Version? ---------- */
  const TAG_RE = /<[a-zA-Z][^>]*?\sdata-wert\s*=\s*(?:"([^"]*)"|'([^']*)')[^>]*>/g;
  function benoetigt() {
    const r = new Map();   // Speicher-Schlüssel → { schluessel, teil }
    const doks = new Set();
    let s = null;
    try { s = h && h.sicht ? h.sicht() : null; } catch (e) { s = null; }
    if (!s || !Array.isArray(s.dokumente)) return { werte: r, doks: doks };
    const dazu = (schluessel, teil, dok) => {
      if (!defVon(schluessel)) return;
      doks.add(dok);
      r.set(speicherSchluessel(schluessel, teil), { schluessel: schluessel, teil: teil || '' });
    };
    for (const d of s.dokumente) {
      const html = String(d.html || '');
      if (html.indexOf('data-wert') < 0) continue;
      for (const m of html.matchAll(TAG_RE)) {
        const tm = /\sdata-wert-teil\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[0]);
        dazu(m[1] !== undefined ? m[1] : m[2], tm ? (tm[1] !== undefined ? tm[1] : tm[2]) : '', d.id);
      }
    }
    // Verknüpfungen aus der Änderungsschicht (Art „wert“, neu „@<schlüssel>“)
    const ae = AE();
    if (ae && typeof ae.fuerDok === 'function') {
      for (const d of s.dokumente) for (const e of ae.fuerDok(d.id)) if (e.art === 'wert' && /^@/.test(e.neu)) dazu(e.neu.slice(1), '', d.id);
    }
    return { werte: r, doks: doks };
  }

  /* ---------- Speicher ---------- */
  async function laden() {
    const s = S();
    let liste = null;
    try { liste = s && typeof s.ladeWerte === 'function' ? await s.ladeWerte() : null; } catch (e) { liste = null; }
    werte.clear();
    for (const w of liste || []) werte.set(w.schluessel, w);
    return werte.size;
  }
  async function speichern(liste) {
    const s = S();
    if (!s || typeof s.speichereWerte !== 'function' || !liste.length) return false;
    try { return (await s.speichereWerte(liste)) === true; } catch (e) { return false; }
  }

  /* ---------- Auffrischen ---------- */
  function fehlerArt(e) {
    const k = e && e.kind;
    if (k === 'network' || k === 'timeout' || (e && e.name === 'AbortError')) return 'offline';
    if (k === 'auth' || k === 'forbidden' || k === 'notfound' || k === 'keinzugriff') return 'zugriff';
    return 'fehler';
  }
  // Zustandsbild der Werte (für „hat sich etwas geändert?“)
  function bild(liste) {
    return liste.map((k) => { const e = werte.get(k); return k + '=' + (e ? JSON.stringify([e.wert, e.teile, zustandVon(e)]) : '-'); }).join('\n');
  }
  async function auffrischenJetzt() {
    if (geladen) await geladen;
    const { werte: ziele, doks } = benoetigt();
    const keys = Array.from(ziele.keys());
    if (!keys.length) { letzte = { anfragen: 0, ergebnis: 'leer' }; return letzte; }
    const vorher = bild(keys);
    const token = tokenLesen();
    const online = navigator.onLine !== false;
    let gezaehlt = 0, offlineSeit = false;
    const geschrieben = [];
    const merke = (k, wert) => { werte.set(k, wert); geschrieben.push(wert); versucht.add(k); };
    for (const abruf of ABRUFE) {
      // Gruppen: ohne Teil eine, mit Teil (aether.commits.seit) je Teil eine
      const gruppen = new Map();
      for (const [k, z] of ziele) {
        const d = defVon(z.schluessel);
        if (!d || d.abruf !== abruf.id) continue;
        const g = abruf.mitTeil ? z.teil : '';
        if (!gruppen.has(g)) gruppen.set(g, []);
        gruppen.get(g).push({ k: k, schluessel: z.schluessel });
      }
      for (const [teil, gruppe] of gruppen) {
        const github = abruf.art !== 'eigen';
        if (abruf.art === 'aether' && !token) continue;   // ohne Token: letzter bekannter Wert bleibt
        const fehlerSetzen = (art) => {
          const z = new Date(jetzt()).toISOString();
          for (const g of gruppe) {
            const alt = werte.get(g.k);
            merke(g.k, Object.assign({ schluessel: g.k, wert: null, teile: null, quelle: abruf.quelle, zeit: null, etag: null }, alt || {}, { fehler: { art: art, zeit: z } }));
          }
        };
        if (github && (!online || offlineSeit)) { fehlerSetzen('offline'); continue; }
        if (github && gezaehlt >= MAX_ANFRAGEN) continue;   // Budget erschöpft: bleibt bis zur nächsten Auffrischung
        // Gemeinsamer ETag der Gruppe (nur wenn jeder Wert der Gruppe schon mit diesem ETag gelesen wurde)
        const etags = gruppe.map((g) => { const e = werte.get(g.k); return e && e.wert !== null && e.etag ? e.etag : null; });
        const etag = etags.every((x) => x && x === etags[0]) ? etags[0] : null;
        const ctx = {
          teil: teil,
          etag: etag,
          token: token,
          hole: (pfad, o) => {
            const oo = o || {};
            if (gezaehlt >= MAX_ANFRAGEN) throw new (G().AppError)('budget', 'Anfragen-Budget erschöpft.', '');
            gezaehlt++;
            anfragen.push(pfad.replace(/\?.*$/, ''));
            const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
            const p = gh.api(pfad, { token: oo.ohneToken ? null : token, ohneToken: oo.ohneToken === true, accept: oo.accept, signal: ctrl ? ctrl.signal : undefined,
              notFound: new (G().AppError)('notfound', 'Nicht gefunden.', pfad), etag: oo.etag || null, erlaube304: !!oo.etag })
              .then(async (res) => ({ status: res.status, etag: res.headers.get('etag'), link: res.headers.get('link'), daten: res.status === 304 ? null : (oo.text ? await res.text() : await res.json()) }));
            return G().withProjTimeout(p).catch((e) => { if (ctrl) ctrl.abort(); throw e; });
          }
        };
        try {
          const r = await abruf.lesen(ctx);
          const z = new Date(jetzt()).toISOString();
          if (r === 'unveraendert') {
            for (const g of gruppe) merke(g.k, Object.assign({}, werte.get(g.k), { zeit: z, fehler: null }));
            continue;
          }
          for (const g of gruppe) {
            const w = r.werte[g.schluessel];
            if (!w) { fehlerSetzen('fehler'); continue; }
            merke(g.k, { schluessel: g.k, wert: w.wert, teile: w.teile || null, quelle: abruf.quelle, zeit: z, etag: r.etag || null, fehler: null });
          }
        } catch (e) {
          if (e && e.kind === 'budget') continue;
          const art = fehlerArt(e);
          if (art === 'offline' && github) offlineSeit = true;   // keine weiteren Anfragen in dieser Auffrischung
          fehlerSetzen(art);
        }
      }
    }
    await speichern(geschrieben);
    const geaendert = bild(keys) !== vorher;
    if (geaendert) await neuZeichnen(doks);
    letzte = { anfragen: gezaehlt, ergebnis: geaendert ? 'geaendert' : 'gleich' };
    return letzte;
  }
  // Eine Auffrischung starten (läuft schon eine, kommt deren Promise zurück). Lehnt nie ab.
  function auffrischen() {
    if (!h || !gh) return Promise.resolve({ anfragen: 0, ergebnis: 'aus' });
    if (laeuft) return laeuft;
    laeuft = auffrischenJetzt().catch(() => ({ anfragen: 0, ergebnis: 'fehler' })).finally(() => { laeuft = null; });
    return laeuft;
  }
  // Seiten mit Werten neu darstellen (Kachel und Vollbild; Druck und Bild bereiten sich über flyer:aktualisiert neu vor)
  function neuZeichnen(doks) {
    const a = A();
    if (!a || typeof a.aktualisiere !== 'function') return Promise.resolve();
    const ids = doks ? Array.from(doks) : Array.from(benoetigt().doks);
    return Promise.all(ids.map((id) => a.aktualisiere(id).catch(() => null))).then(() => { if (tafel) tafelZeigen(); });
  }
  // Neue Schlüssel (neues Paket, neue Verknüpfung): nur dann sofort lesen, wenn es etwas Ungelesenes gibt
  function neueSchluessel() {
    const z = benoetigt().werte;
    for (const k of z.keys()) if (!versucht.has(k)) { auffrischen(); return; }
  }

  /* ---------- Tafel (Antippen im Modus „Text“) ---------- */
  function info(schluessel, teil) {
    const d = defVon(schluessel), e = eintrag(schluessel, teil);
    return { bekannt: !!d, beschreibung: d ? d.beschreibung : '', quelle: e && e.quelle ? e.quelle : (d ? (abrufVon(d.abruf) || {}).quelle || '' : ''),
      zeit: e && e.zeit ? e.zeit : null, zustand: zustandVon(e), text: d ? formatiere(e, d.format, teil) : null, eintrag: e };
  }
  function tafelZu() {
    tafel = null;
    const t = $('vbWert');
    if (t) t.hidden = true;
    const z = $('vbWertHandZeile');
    if (z) z.hidden = true;
  }
  // el: angetipptes Element mit data-wert im Vollbild (dargestellt), dok: Dokument der Sicht
  function oeffneTafel(dok, el) {
    if (!$('vbWert')) return false;
    const k = el.getAttribute('data-ae-wk') || '';
    tafel = {
      dok: dok, schluessel: el.getAttribute('data-wert') || '', teil: el.getAttribute('data-wert-teil') || '', k: k,
      format: el.getAttribute('data-format'), paketText: el.getAttribute('data-ae-paket') || '', hand: el.getAttribute('data-wert-hand'),
      jetzt: textVon(el), verknuepft: /^t:/.test(k) && el.hasAttribute('data-ae-verknuepft')
    };
    tafelZeigen();
    return true;
  }
  function tafelZeigen() {
    const t = tafel;
    if (!t) return;
    const i = info(t.schluessel, t.teil);
    const d = defVon(t.schluessel);
    const ae = AE();
    const eigen = !!(ae && t.k && ae.geaendert(t.dok.id, 'wert', t.k));
    $('vbWertLabel').textContent = t.dok.id + ' · dynamischer Wert „' + t.schluessel + '“' + (t.teil ? ' (' + t.teil + ')' : '') + (eigen ? (t.hand !== null ? ' · von Hand überschrieben' : ' · verknüpft') : '');
    const kasten = $('vbWertKasten');
    kasten.setAttribute('data-zustand', t.hand !== null ? 'hand' : (d ? i.zustand : 'unbekannt'));
    const wertText = t.hand !== null ? t.hand : (d ? formatiere(i.eintrag, d ? (FORMATE.indexOf(t.format) >= 0 ? t.format : d.format) : 'zahl', t.teil) : null);
    $('vbWertZahl').textContent = wertText !== null ? wertText : t.jetzt;
    $('vbWertBeschr').textContent = d ? d.beschreibung : 'Schlüssel noch ohne Quelle (kommt später) – der Text aus dem Paket gilt.';
    const teile = [];
    if (i.quelle) teile.push('Quelle: ' + i.quelle);
    teile.push(i.zeit ? 'gelesen ' + zeitText(i.zeit) : 'noch nicht gelesen');
    if (i.eintrag && i.eintrag.fehler) teile.push(i.eintrag.fehler.art === 'offline' ? 'zuletzt offline' : 'letzter Versuch mit Fehler');
    else if (d && i.zustand === 'alt') teile.push('veraltet');
    teile.push('im Paket gespeichert: ' + (t.paketText || '–'));
    $('vbWertQuelle').textContent = teile.join(' · ');
    $('vbWertOrig').hidden = !eigen;
    $('vbWertHand').hidden = t.hand !== null && eigen;
    $('vbWert').hidden = false;
  }
  async function nachAenderung(dokId) {
    const ae = AE();
    if (ae && !ae.gespeichert()) meldung('Änderung nicht offline gespeichert');
    const a = A();
    if (a && typeof a.aktualisiere === 'function') await a.aktualisiere(dokId).catch(() => null);
  }
  async function handUebernehmen() {
    const t = tafel, ae = AE();
    if (!t || !ae) return;
    const text = $('vbWertFeld').value;
    tafelZu();
    try { await ae.setze(t.dok.id, 'wert', t.k, '=' + text); } catch (e) { fehlerZeigen(e); }
    await nachAenderung(t.dok.id);
  }
  async function original() {
    const t = tafel, ae = AE();
    if (!t || !ae || !t.k) return;
    tafelZu();
    try { await ae.original(t.dok.id, 'wert', t.k); } catch (e) { fehlerZeigen(e); }
    await nachAenderung(t.dok.id);
  }
  function fehlerZeigen(e) {
    try { h.fehler((e && e.title) || 'Unerwarteter Fehler.', (e && e.text) || '', false); } catch (x) { meldung((e && e.title) || 'Fehler'); }
  }
  function handOeffnen() {
    const t = tafel;
    if (!t) return;
    // Verknüpftes Textelement: „Überschreiben“ löst die Verknüpfung und öffnet das normale Textfeld
    if (t.verknuepft) {
      const ae = AE(), b = B();
      tafelZu();
      Promise.resolve(ae ? ae.original(t.dok.id, 'wert', t.k) : null).catch(fehlerZeigen)
        .then(() => nachAenderung(t.dok.id))
        .then(() => { if (b && typeof b.oeffneText === 'function') b.oeffneText(t.dok, t.k.slice(2)); });
      return;
    }
    $('vbWertFeld').value = $('vbWertZahl').textContent;
    $('vbWertHandZeile').hidden = false;
    try { $('vbWertFeld').focus({ preventScroll: true }); } catch (x) { /* egal */ }
  }

  /* ---------- Liste für „Mit Wert verknüpfen …“ ---------- */
  // → [{ schluessel, text (aktueller Wert oder null), beschreibung, zustand }]
  function liste() {
    return Object.keys(SCHLUESSEL).filter((k) => !abrufVon(SCHLUESSEL[k].abruf).mitTeil).map((k) => {
      const e = eintrag(k, '');
      return { schluessel: k, text: formatiere(e, SCHLUESSEL[k].format, ''), beschreibung: SCHLUESSEL[k].beschreibung, zustand: zustandVon(e) };
    });
  }

  /* ---------- Einrichten ---------- */
  // h = { token(), sicht(), fehler(titel, text, mitTokenLink) } von flyer.js
  function einrichten(hilfen) {
    const erstesMal = !h;
    h = hilfen;
    if (!erstesMal) return auffrischen();
    gh = G().githubApi({ apiBase: API, repoFull: AETHER, repoPath: '/repos/' + AETHER, ref: 'main', tokenOrt: 'im Dashboard', ohneTokenArt: 'notoken' });
    if (!geladen) geladen = laden();
    const btn = $('btnOnline');
    if (btn) btn.addEventListener('click', () => { auffrischen(); });
    window.addEventListener('online', () => { auffrischen(); });
    const t = window.AETHER_TEST_FLYER_WERTE_INTERVALL_MS;
    setInterval(() => { auffrischen(); }, (typeof t === 'number' && t > 0) ? t : INTERVALL_MS);
    const knopf = (id, fn) => { const b = $(id); if (b) b.addEventListener('click', fn); };
    knopf('vbWertZu', () => tafelZu());
    knopf('vbWertNeu', () => { auffrischen().then(() => tafelZeigen()); });
    knopf('vbWertHand', () => handOeffnen());
    knopf('vbWertOrig', () => { original(); });
    knopf('vbWertHandOk', () => { handUebernehmen(); });
    knopf('vbWertHandAb', () => { const z = $('vbWertHandZeile'); if (z) z.hidden = true; });
    const feld = $('vbWertFeld');
    if (feld) feld.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); handUebernehmen(); }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); $('vbWertHandZeile').hidden = true; }
    });
    document.addEventListener('flyer:modus', () => tafelZu());
    document.addEventListener('flyer:vollbild', (e) => { const d = e && e.detail; if (!d || d.offen === false || (tafel && d.dok && d.dok.id !== tafel.dok.id)) tafelZu(); });
    document.addEventListener('flyer:struktur', () => neueSchluessel());
    document.addEventListener('flyer:aenderungen', () => neueSchluessel());
    return geladen.then(() => auffrischen());
  }

  window.AetherFlyerWerte = Object.freeze({
    VERALTET_MS: VERALTET_MS,
    MAX_ANFRAGEN: MAX_ANFRAGEN,
    FORMATE: FORMATE,
    einrichten: einrichten,
    laden: () => (geladen || (geladen = laden())),
    anwenden: anwenden,
    schnappschuss: schnappschuss,
    auffrischen: auffrischen,
    neuZeichnen: () => neuZeichnen(null),
    formatiere: formatiere,
    zeitText: zeitText,
    oeffneTafel: oeffneTafel,
    tafelZu: tafelZu,
    liste: liste,
    info: info,
    schluessel: () => Object.keys(SCHLUESSEL),
    zustand: (schluessel, teil) => zustandVon(eintrag(schluessel, teil)),
    eintrag: (schluessel, teil) => { const e = eintrag(schluessel, teil); return e ? JSON.parse(JSON.stringify(e)) : null; },
    benoetigt: () => Array.from(benoetigt().werte.keys()),
    anfragen: () => anfragen.slice(),
    letzte: () => letzte
  });
})();
