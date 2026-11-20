// Ansicht der Flyer-Seite (flyer.html, Teil C): zeigt die Dokumente des Flyer-Pakets als Kacheln und im Vollbild
// (Blättern per ‹/›, Wischen und Pfeiltasten; Esc/Backspace schließt).
// F3a: Ordner statt Kategorie-Chips – Pfad „Alle › …“ mit ‹ zurück, Ordner-Kacheln („n Seiten · m Ordner“, Menü „···“,
// „+ Neuer Ordner“), darunter „SEITEN“ mit den Seiten-Kacheln (Menü „···“) und „Ausgeblendete zeigen (n)“. „Alle“ zeigt
// jede Seite der Version genau einmal. Menüs und „+ Neuer Ordner“ kommen über setzeUebersicht (flyer-uebersicht.js);
// ohne sie gibt es keine Menü-Knöpfe. Backspace in der Übersicht (nicht in Texteingaben) geht einen Ordner zurück.
// Jedes Dokument steht in einem eigenen Shadow Root (div.flyer-host): Das Paket-CSS (bereinigt, :root/html/body → :host,
// aus AetherFlyerPaket.zerlegeCss) wirkt nur dort, und nichts von der Seite wirkt hinein. @font-face und @page des
// Pakets stehen im Dokument (<style id="flyerDokRegeln">), weil Chromium @font-face im Shadow Root nicht beachtet und
// @page dort nicht wirkt. Paket-Inhalte kommen nur über AetherFlyerPaket.bereinigeHtml (DOMParser) und
// document.importNode ins Dokument – nie als HTML-Text. Das Aussehen kommt allein aus dem Paket-CSS; die Ansicht
// skaliert nur (immer per transform, damit offsetHeight bei der Schriftanpassung unverändert bleibt).
// Schriftanpassung: --s von 1.42 in Schritten von 0.02 bis höchstens 0.80 verkleinern, bis .body nicht mehr überläuft;
// .fill-Flächen unter 90 px werden ausgeblendet (Klasse „off“). „Text zu lang“, wenn es bei 0.80 noch überläuft.
// darstellen(dok, ziel, optionen) ist die Schnittstelle für Teil 2 (Änderungsschicht über optionen.anpassen): flyer.js
// setzt per setzeAnpasser(fn) die Änderungsschicht; Kacheln und Vollbild (hier) sowie Druck und Bild (flyer-export.js,
// über optionen(dok, ort)) stellen damit dieselben Änderungen dar. aktualisiere(id) stellt Kachel und Vollbild eines
// Dokuments nach einer Änderung neu dar (samt Schriftanpassung, Bildlaufposition im Vollbild bleibt).
// Kein Speicher: nichts wird im Browser abgelegt, nichts aus dem Netz geladen.
(function () {
  'use strict';

  const ARTEN = ['flyer', 'infografik'];
  // Schriftanpassung (Werte der Flyer-Vorlagen): Start, Untergrenze, Schritt; .fill unter 90 px wird ausgeblendet.
  const S_START = 1.42, S_MIN = 0.80, S_SCHRITT = 0.02;
  const FILL_MIN_PX = 90;
  // Selbst gewählt: höchstens 5 s auf die Paket-Schriften warten, danach trotzdem anzeigen (nie hängen); kommen sie
  // später doch noch, wird alles Dargestellte neu angepasst (spaeteSchriften). Tests setzen
  // window.AETHER_TEST_FLYER_SCHRIFT_FRIST_MS vor dem Laden.
  const SCHRIFT_FRIST_MS = (typeof window.AETHER_TEST_FLYER_SCHRIFT_FRIST_MS === 'number' && window.AETHER_TEST_FLYER_SCHRIFT_FRIST_MS > 0)
    ? window.AETHER_TEST_FLYER_SCHRIFT_FRIST_MS : 5000;
  // Wischen im Vollbild: mindestens 50 px waagerecht und deutlich mehr waagerecht als senkrecht.
  const WISCH_MIN_PX = 50, WISCH_VERHAELTNIS = 1.5;
  // input-Typen, die KEIN Eingabefeld sind (Knöpfe und das Kontrollkästchen – dort tun Pfeile und Backspace nichts).
  // Bei allen anderen (Text, Zahl, Datum, Zeit, Regler, Farbe, Auswahlknopf …) gehören Pfeile/Esc/Backspace dem Feld –
  // dann blättert und schließt das Vollbild nicht.
  const KNOPF_TYPEN = ['button', 'submit', 'reset', 'image', 'hidden', 'file', 'checkbox'];
  const DOK_REGELN_ID = 'flyerDokRegeln';
  // Eigene, letzte Seitenregel: Flyer = genau eine A4-Seite ohne Rand. !important, damit keine @page-Regel des Pakets
  // (auch eine mit !important) Format oder Rand ändert; @page mit Seitenauswahl (:first …) lässt zerlegeCss weg.
  const EIGENE_SEITENREGEL = '@page{size:A4 !important;margin:0 !important}';

  const $ = (id) => document.getElementById(id);
  const P = () => window.AetherFlyerPaket;

  /* ---------- Zustand ---------- */
  let aktPaket = null;                                  // gezeigtes Paket (zeigePaket)
  const schattenCss = { flyer: '', infografik: '' };    // Shadow-CSS je Art (Text)
  const blaetter = { flyer: null, infografik: null };   // dasselbe als CSSStyleSheet (null → Fallback <style>)
  let adoptierbar = null;                               // adoptedStyleSheets nutzbar? (einmal geprüft)
  let familien = new Set();                             // Schriftfamilien aus den Paket-@font-face (klein, ohne Anführungszeichen)
  let schriftenPromise = null;                          // laufendes/fertiges schriftenBereit()
  let vorlagen = new Map();                             // Dokument-Id → { html, wurzel } (bereinigt, im fremden Dokument)
  let sCache = new Map();                               // Dokument-Id → zuletzt ermitteltes s (wird immer nachgeprüft)
  let messungen = new Map();                            // Dokument-Id → { inhalt, s, zuLang, aus[] } letzte echte Messung

  let ordner = null;                                    // geöffneter Ordner (id; null = „Alle“)
  let mitAusgeblendeten = false;                        // „Ausgeblendete zeigen“
  let uebersicht = null;                                // F3a: { ordnerMenue(o, knopf), seitenMenue(dok, knopf), neuerOrdner(eltern) }
  let liste = [];                                       // Dokumente des Ordners (Reihenfolge des Pakets)
  let generation = 0;                                   // zählt Kachel-Darstellungen (veraltete Ergebnisse verwerfen)
  let kachelSkalen = new Map();                         // .kachel-bild → { host, breite }
  let kachelFlyer = [];                                 // Flyer-Kacheln der aktuellen Darstellung: { wurzel, warnung }
  const hostWurzeln = new WeakMap();                    // div.flyer-host → dargestellte Wurzel (wurzelVon)
  let kachelBeobachter = null;                          // ResizeObserver der Kachelbilder
  let vb = null;                                        // offenes Vollbild: { index, dok, host, wurzel, huelle }
  let vbNummer = 0;                                     // zählt Vollbild-Darstellungen
  let vbBeobachter = null;                              // ResizeObserver für Bühne und Host im Vollbild
  let vbGeplant = false;                                // Neu-Skalierung fürs nächste Bild geplant
  let oeffner = null;                                   // Kachel, von der aus das Vollbild geöffnet wurde
  let wisch = null;                                     // Anfang einer Wischbewegung { x, y }
  let eingerichtet = false;
  let anpasser = null;                                  // Teil 2: (wurzel, dok, ort) → Änderungsschicht anwenden

  /* ---------- Hilfen ---------- */
  function leeren(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function span(klasse, text) { const s = document.createElement('span'); s.className = klasse; s.textContent = text; return s; }
  function melde(name, detail) { document.dispatchEvent(new CustomEvent(name, { detail: detail })); }
  function ohneAnfuehrung(f) { return String(f || '').trim().replace(/^(['"])(.*)\1$/, '$2').trim().toLowerCase(); }
  // Schriftfamilien aller @font-face-Regeln eines CSS-Textes.
  function familienAus(css) {
    const s = new Set();
    const re = /@font-face\s*\{([^}]*)\}/gi;
    let m;
    while ((m = re.exec(css))) {
      const f = /font-family\s*:\s*([^;]+)/i.exec(m[1]);
      if (f) s.add(ohneAnfuehrung(f[1]));
    }
    return s;
  }
  function kannAdoptieren() {
    if (adoptierbar === null) {
      try {
        adoptierbar = typeof CSSStyleSheet === 'function' && typeof ShadowRoot === 'function' &&
          'adoptedStyleSheets' in ShadowRoot.prototype && typeof new CSSStyleSheet().replaceSync === 'function';
      } catch (e) { adoptierbar = false; }
    }
    return adoptierbar;
  }
  // Breite eines Dokuments laut Paket (px), sonst gemessen.
  function nennBreite(dok, host) { return dok && dok.breite > 0 ? dok.breite : ((host && host.offsetWidth) || 1); }

  /* ---------- Paket vorbereiten ---------- */
  // Einmal je Paket: Shadow-CSS je Art (als CSSStyleSheet, sonst Text für <style>), Dokument-Regeln (@font-face, @page)
  // beider Arten in <style id="flyerDokRegeln"> im <head> plus die eigene A4-Seitenregel als letzte.
  function vorbereiten(paket) {
    const css = (paket && paket.css) || {};
    const dokTeile = [];
    let cssNeu = false;
    for (const art of ARTEN) {
      const z = P().zerlegeCss(typeof css[art] === 'string' ? css[art] : '');
      const text = String((z && z.schatten) || '');
      if (text !== schattenCss[art] || (!blaetter[art] && kannAdoptieren())) {
        let blatt = null;
        if (kannAdoptieren()) {
          try { blatt = new CSSStyleSheet(); blatt.replaceSync(text); } catch (e) { blatt = null; }
        }
        blaetter[art] = blatt;
        schattenCss[art] = text;
        cssNeu = true;
      }
      if (z && z.dokument) dokTeile.push(String(z.dokument));
    }
    dokTeile.push(EIGENE_SEITENREGEL);
    const regeln = dokTeile.join('\n');
    let st = $(DOK_REGELN_ID);
    if (!st) { st = document.createElement('style'); st.id = DOK_REGELN_ID; document.head.appendChild(st); }
    // Nur bei Änderung neu setzen: sonst würden die Schriften neu geladen (kurz falsche Schrift, schriftenGeladen() false).
    if (st.textContent !== regeln) { st.textContent = regeln; schriftenPromise = null; cssNeu = true; }
    familien = familienAus(regeln);
    // Vorlagen nur für Dokumente dieses Pakets behalten (je Id und HTML; ändert sich das HTML, wird neu bereinigt).
    const ids = new Set(((paket && paket.dokumente) || []).map((d) => d && d.id));
    for (const id of Array.from(vorlagen.keys())) if (!ids.has(id)) vorlagen.delete(id);
    // sCache darf bleiben (jeder Treffer wird nachgemessen); Messungen für verborgene Wurzeln nur bei gleichem CSS.
    if (cssNeu) messungen = new Map();
  }

  // Bereinigte Wurzel eines Dokuments (je Id zwischengespeichert, solange sich das HTML nicht ändert).
  function vorlage(dok) {
    const v = vorlagen.get(dok.id);
    if (v && v.html === dok.html) return v.wurzel;
    const wurzel = P().bereinigeHtml(String(dok.html));
    vorlagen.set(dok.id, { html: dok.html, wurzel: wurzel });
    return wurzel;
  }

  /* ---------- Schriften ---------- */
  function paketSchriften() {
    const r = [];
    if (!familien.size || !document.fonts) return r;
    try {
      getComputedStyle(document.documentElement).getPropertyValue('color');   // Stil aktuell → neue @font-face bekannt
      document.fonts.forEach((f) => { if (familien.has(ohneAnfuehrung(f.family))) r.push(f); });
    } catch (e) { /* ohne FontFaceSet: nichts zu laden */ }
    return r;
  }
  // Lädt die Schriften des Pakets (FontFace.load), wartet dann auf document.fonts.ready – höchstens 5 s, lehnt nie ab.
  // Endet die Frist vorher, wird mit der Ersatzschrift angepasst; sobald die Schriften doch da sind, passt
  // spaeteSchriften alles Dargestellte neu an (sonst bliebe ein Flyer mit der Ersatzschrift-Messung stehen und liefe
  // mit der echten Schrift womöglich über, ohne „Text zu lang“).
  let spaetNr = 0;                                      // zählt Anmeldungen der Nachanpassung (nur die letzte gilt)
  function schriftenBereit() {
    if (schriftenPromise) return schriftenPromise;
    let geladen = null;
    const p = new Promise((resolve) => {
      let fertig = false;
      const ende = () => { if (!fertig) { fertig = true; clearTimeout(uhr); resolve(); } };
      const uhr = setTimeout(ende, SCHRIFT_FRIST_MS);
      try {
        geladen = Promise.all(paketSchriften().map((f) => f.load().catch(() => null)))
          .then(() => (document.fonts ? document.fonts.ready : null));
        geladen.then(ende, ende);
      } catch (e) { geladen = null; ende(); }
    });
    schriftenPromise = p;
    p.then(() => {
      if (schriftenGeladen()) return;
      // Zeitlimit erreicht, aber noch nicht geladen: beim nächsten Aufruf erneut versuchen …
      if (schriftenPromise === p) schriftenPromise = null;
      // … und nachanpassen, sobald sie da sind (nur die letzte Anmeldung gilt: sie gehört zu den aktuellen Schriften).
      if (geladen) {
        const nr = ++spaetNr;
        const nachher = () => { if (nr === spaetNr && schriftenGeladen()) spaeteSchriften(); };
        geladen.then(nachher, nachher);
      }
    });
    return p;
  }
  // true, wenn keine Paket-Schrift mehr lädt oder auf Laden wartet (geladen oder endgültig gescheitert).
  function schriftenGeladen() {
    return paketSchriften().every((f) => f.status === 'loaded' || f.status === 'error');
  }
  // Schriften kamen nach der Frist: alle dargestellten Flyer (Kacheln, Vollbild) neu anpassen, „Text zu lang“ neu
  // setzen und 'flyer:schriften' melden (flyer-export.js passt #druck an und bereitet das Bild neu vor).
  function spaeteSchriften() {
    for (const k of kachelFlyer) {
      if (!k.wurzel.isConnected) continue;
      try { const r = schriftAnpassen(k.wurzel); k.warnung.hidden = !r.zuLang; } catch (e) { /* nächste Kachel */ }
    }
    if (vb && vb.wurzel && vb.dok && vb.dok.art !== 'infografik' && vb.wurzel.isConnected) {
      try {
        const r = schriftAnpassen(vb.wurzel);
        const w = $('vbWarnung');
        if (w) w.hidden = !r.zuLang;
      } catch (e) { /* bleibt beim letzten Stand */ }
      skaliereVollbild();
    }
    melde('flyer:schriften', {});
  }

  /* ---------- Schriftanpassung ---------- */
  function hostId(wurzel) {
    try { const r = wurzel.getRootNode(); return (r && r.host && r.host.getAttribute('data-id')) || null; } catch (e) { return null; }
  }
  const runde = (x) => Math.round(x * 100) / 100;

  // Synchron. --s von 1.42 abwärts (Schritt 0.02, bis 0.80), solange .body überläuft; danach .fill unter 90 px aus.
  function schriftAnpassen(wurzel) {
    const body = wurzel && typeof wurzel.querySelector === 'function' ? wurzel.querySelector('.body') : null;
    if (!body) return { s: null, zuLang: false };
    const fills = Array.from(wurzel.querySelectorAll('.fill'));
    for (const f of fills) f.classList.remove('off');
    const setze = (s) => wurzel.style.setProperty('--s', s.toFixed(2));
    const laeuftUeber = () => body.scrollHeight > body.clientHeight + 1;
    const id = hostId(wurzel);

    // Nicht dargestellt (z. B. in einem verborgenen Behälter): nichts messbar. Dann die letzte echte Messung desselben
    // Inhalts übernehmen, sonst Startwert ohne ausgeblendete Flächen (statt alles als „zu niedrig“ auszublenden).
    if (!body.getClientRects().length) {
      const m = id ? messungen.get(id) : null;
      if (m && m.inhalt === wurzel.textContent && m.aus.length === fills.length) {
        setze(m.s);
        fills.forEach((f, i) => { if (m.aus[i]) f.classList.add('off'); });
        return { s: m.s, zuLang: m.zuLang };
      }
      setze(S_START);
      return { s: S_START, zuLang: false };
    }

    let s = null, zuLang = false;
    // Abkürzung: zuletzt ermitteltes s nur übernehmen, wenn es bei s nicht überläuft (bzw. s = 0.80) und
    // (s = 1.42 oder bei s + 0.02 überläuft) – dasselbe Ergebnis wie der volle Durchlauf.
    const c = id ? sCache.get(id) : undefined;
    if (typeof c === 'number') {
      setze(c);
      const ueber = laeuftUeber();
      let gilt = !ueber || c <= S_MIN;
      if (gilt && c < S_START) { setze(runde(c + S_SCHRITT)); gilt = laeuftUeber(); setze(c); }
      if (gilt) { s = c; zuLang = ueber; }
    }
    if (s === null) {
      s = S_START;
      setze(s);
      let ueber = laeuftUeber();
      while (ueber && s > S_MIN) {
        s = runde(s - S_SCHRITT);
        setze(s);
        ueber = laeuftUeber();
      }
      zuLang = ueber;   // läuft bei 0.80 noch über
    }
    // offsetHeight ist unabhängig von transform-Skalierung (Kachel, Vollbild).
    const aus = fills.map((f) => {
      const weg = f.offsetHeight < FILL_MIN_PX;
      if (weg) f.classList.add('off'); else f.classList.remove('off');
      return weg;
    });
    if (id) {
      sCache.set(id, s);
      messungen.set(id, { inhalt: wurzel.textContent, s: s, zuLang: zuLang, aus: aus });
    }
    return { s: s, zuLang: zuLang };
  }

  /* ---------- Änderungsschicht (Teil 2) ---------- */
  // fn(wurzel, dok, ort) mit ort 'kachel' | 'vollbild' | 'druck' | 'bild'; null = ohne Änderungsschicht
  function setzeAnpasser(fn) { anpasser = typeof fn === 'function' ? fn : null; }
  // Optionen für darstellen: Änderungsschicht dieses Dokuments am Ort ort (Fehler darin stören die Darstellung nicht)
  function optionen(dok, ort) {
    if (!anpasser) return undefined;
    const fn = anpasser;
    return { anpassen: (wurzel) => { try { fn(wurzel, dok, ort); } catch (e) { /* Basis bleibt sichtbar */ } } };
  }

  /* ---------- Darstellung (Schnittstelle für Teil 2) ---------- */
  // Neues div.flyer-host mit Shadow Root (Paket-CSS + Klon der bereinigten Wurzel) an ziel (muss im Dokument liegen).
  // optionen.anpassen(wurzel) läuft vor dem Einsetzen. fertig: nach Schriften und Schriftanpassung (nur Flyer).
  function darstellen(dok, ziel, optionen) {
    if (!dok || !ziel) throw new Error('darstellen: Dokument und Ziel fehlen.');
    const art = dok.art === 'infografik' ? 'infografik' : 'flyer';
    const wurzel = document.importNode(vorlage(dok), true);
    const host = document.createElement('div');
    host.className = 'flyer-host';
    host.setAttribute('data-id', String(dok.id));
    host.setAttribute('data-art', String(dok.art));
    if (dok.breite > 0) host.style.width = dok.breite + 'px';
    const schatten = host.attachShadow({ mode: 'open' });
    if (blaetter[art]) schatten.adoptedStyleSheets = [blaetter[art]];
    else { const st = document.createElement('style'); st.textContent = schattenCss[art]; schatten.appendChild(st); }
    // Bis die Schriften da sind, mit dem Startwert zeigen (die Anpassung setzt --s danach ohnehin neu).
    if (art === 'flyer' && wurzel.style && wurzel.querySelector('.body')) wurzel.style.setProperty('--s', S_START.toFixed(2));
    if (optionen && typeof optionen.anpassen === 'function') optionen.anpassen(wurzel);
    schatten.appendChild(wurzel);
    hostWurzeln.set(host, wurzel);
    ziel.appendChild(host);
    const fertig = schriftenBereit().then(() => {
      let r = { s: null, zuLang: false };
      if (art === 'flyer') { try { r = schriftAnpassen(wurzel); } catch (e) { r = { s: null, zuLang: false }; } }
      return { s: r.s, zuLang: r.zuLang, breite: nennBreite(dok, host), hoehe: wurzel.offsetHeight || (dok.hoehe > 0 ? dok.hoehe : 0) };
    });
    return { host: host, wurzel: wurzel, fertig: fertig };
  }

  /* ---------- Kacheln ---------- */
  function skaliereKachel(bild, breitePx) {
    const e = kachelSkalen.get(bild);
    if (!e) return;
    const w = typeof breitePx === 'number' ? breitePx : bild.clientWidth;
    e.host.style.transform = 'scale(' + (w / e.breite) + ')';
  }
  // Erst alle Breiten lesen, dann alle setzen (eine Layout-Berechnung statt einer je Kachel).
  function alleKachelnSkalieren() {
    const breiten = [];
    kachelSkalen.forEach((e, bild) => breiten.push([bild, bild.clientWidth]));
    for (const [bild, w] of breiten) skaliereKachel(bild, w);
  }
  function kachelFuer(id) {
    const ziel = $('kacheln');
    if (!ziel) return null;
    for (const k of ziel.querySelectorAll('.kachel')) if (k.getAttribute('data-id') === String(id)) return k;
    return null;
  }

  // Dokumente des geöffneten Ordners (Alle: jedes Dokument genau einmal); Ausgeblendete nur mit „Ausgeblendete zeigen“
  function listeBerechnen() {
    const alle = aktPaket ? aktPaket.dokumente : [];
    return alle.filter((d) => (ordner === null || (Array.isArray(d.ordner) && d.ordner.indexOf(ordner) >= 0)) &&
      (mitAusgeblendeten || d.ausgeblendet !== true));
  }
  function ausgeblendeteHier() {
    const alle = aktPaket ? aktPaket.dokumente : [];
    return alle.filter((d) => d.ausgeblendet === true && (ordner === null || (Array.isArray(d.ordner) && d.ordner.indexOf(ordner) >= 0))).length;
  }
  function kachelnZeichnen() {
    const gen = ++generation;
    if (kachelBeobachter) kachelBeobachter.disconnect();
    kachelSkalen = new Map();
    kachelFlyer = [];
    liste = listeBerechnen();
    const ziel = $('kacheln');
    if (!ziel) return Promise.resolve([]);
    leeren(ziel);
    const warten = liste.map((dok, i) => {
      const platz = document.createElement('div');
      platz.className = 'kachel-platz' + (dok.ausgeblendet === true ? ' ausgeblendet' : '');
      platz.setAttribute('data-id', String(dok.id));
      const k = document.createElement('button');
      k.type = 'button';
      k.className = 'kachel';
      k.setAttribute('data-id', String(dok.id));
      k.setAttribute('data-art', String(dok.art));
      const bild = document.createElement('div');
      bild.className = 'kachel-bild';
      // Nur Vorschau: nicht fokussierbar, nicht anklickbar (Klick trifft die Kachel), nicht vorgelesen.
      bild.setAttribute('aria-hidden', 'true');
      bild.inert = true;
      const warnung = span('kachel-warnung warnung', 'Text zu lang');
      warnung.hidden = true;
      k.append(bild, span('kachel-id', String(dok.id)), span('kachel-titel', String(dok.titel)), warnung);
      if (dok.ausgeblendet === true) k.appendChild(span('marke', 'ausgeblendet'));
      k.addEventListener('click', () => { oeffne(i); });
      platz.appendChild(k);
      if (uebersicht && typeof uebersicht.seitenMenue === 'function') {
        const mehr = document.createElement('button');
        mehr.type = 'button';
        mehr.className = 'kachel-mehr';
        mehr.textContent = '···';
        mehr.setAttribute('aria-label', 'Menü ' + dok.id);
        mehr.addEventListener('click', () => { uebersicht.seitenMenue(dok, mehr); });
        platz.appendChild(mehr);
      }
      ziel.appendChild(platz);
      return kachelBild(dok, bild, warnung, gen);
    });
    alleKachelnSkalieren();
    ausgeblendetKnopf();
    return Promise.all(warten);
  }
  // „Ausgeblendete zeigen (n)“ / „Ausgeblendete verbergen“ (nur, wenn es hier ausgeblendete Seiten gibt)
  function ausgeblendetKnopf() {
    const z = $('ausgeblendetZeile'), b = $('btnAusgeblendete');
    if (!z || !b) return;
    const n = ausgeblendeteHier();
    if (n === 0) mitAusgeblendeten = false;   // nichts mehr ausgeblendet: Umschalter zurück
    z.hidden = !aktPaket || n === 0;
    b.textContent = mitAusgeblendeten ? 'Ausgeblendete verbergen' : 'Ausgeblendete zeigen (' + n + ')';
    b.setAttribute('aria-pressed', String(mitAusgeblendeten));
  }
  function zeigeAusgeblendete(an) {
    mitAusgeblendeten = an === true;
    if (!aktPaket) { ausgeblendetKnopf(); return Promise.resolve([]); }
    if (vb) schliesse();
    const fertig = kachelnZeichnen();
    melde('flyer:kategorie', ereignis());
    return fertig;
  }

  // Dokument in ein Kachelbild darstellen (auch zum Neu-Darstellen nach einer Änderung) → Promise (Ergebnis von fertig)
  function kachelBild(dok, bild, warnung, gen) {
    let d;
    try { d = darstellen(dok, bild, optionen(dok, 'kachel')); } catch (e) { return Promise.resolve(null); }   // Dokument ohne Inhalt: leere Kachel
    kachelSkalen.set(bild, { host: d.host, breite: nennBreite(dok, d.host) });
    if (dok.art !== 'infografik') kachelFlyer.push({ wurzel: d.wurzel, warnung: warnung });
    if (kachelBeobachter) kachelBeobachter.observe(bild);
    return d.fertig.then((r) => { if (gen === generation) warnung.hidden = !r.zuLang; return r; });
  }
  // Teil 2: Kachel und (falls offen) Vollbild eines Dokuments neu darstellen, z. B. nach einer Änderung. Meldet danach
  // 'flyer:aktualisiert' (flyer-export.js bereitet das Bild neu vor). Promise: wenn beide fertig angepasst sind.
  function aktualisiere(id) {
    const warten = [];
    const dok = aktPaket ? aktPaket.dokumente.find((d) => d && d.id === id) : null;
    const k = dok ? kachelFuer(id) : null;
    const bild = k ? k.querySelector('.kachel-bild') : null;
    if (dok && bild) {
      for (const h of Array.from(bild.querySelectorAll('.flyer-host'))) {
        const w = hostWurzeln.get(h);
        if (w) kachelFlyer = kachelFlyer.filter((e) => e.wurzel !== w);
        h.remove();
      }
      if (kachelBeobachter) kachelBeobachter.unobserve(bild);
      kachelSkalen.delete(bild);
      const warnung = k.querySelector('.kachel-warnung');
      warten.push(kachelBild(dok, bild, warnung, generation));
      skaliereKachel(bild);
    }
    if (vb && vb.dok && vb.dok.id === id) warten.push(vollbildNeu());
    return Promise.all(warten).then((r) => { melde('flyer:aktualisiert', { id: id }); return r; });
  }

  /* ---------- Ordner (F3a) ---------- */
  function alleOrdner() { return aktPaket && Array.isArray(aktPaket.ordner) ? aktPaket.ordner : []; }
  function ordnerVon(id) { return alleOrdner().find((o) => o.id === id) || null; }
  function kinderVon(id) { return alleOrdner().filter((o) => o.eltern === id); }
  function zahlText(n, eins, mehr) { return n + ' ' + (n === 1 ? eins : mehr); }
  function pfadVon(id) {
    const r = [], gesehen = new Set();
    let o = id === null ? null : ordnerVon(id);
    while (o && !gesehen.has(o.id)) { gesehen.add(o.id); r.unshift(o); o = o.eltern === null ? null : ordnerVon(o.eltern); }
    return r;
  }
  function ereignis() { return { kategorie: ordner === null ? 'alle' : ordner, ordner: ordner, liste: liste.slice() }; }
  // Pfad „Alle › …“ (jedes Glied anklickbar, das letzte ist der geöffnete Ordner) und ‹ (eine Ebene zurück)
  function pfadZeichnen() {
    const nav = $('pfad'), ol = $('pfadListe'), zur = $('pfadZurueck');
    if (!nav || !ol) return;
    leeren(ol);
    nav.hidden = !aktPaket;
    if (!aktPaket) return;
    const glieder = [{ id: null, name: 'Alle' }].concat(pfadVon(ordner));
    glieder.forEach((g, i) => {
      const li = document.createElement('li');
      if (i) li.appendChild(span('pfad-trenner', '›'));
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pfad-glied';
      b.textContent = String(g.name);
      b.setAttribute('data-ordner', g.id === null ? '' : String(g.id));
      if (i === glieder.length - 1) b.setAttribute('aria-current', 'location');
      b.addEventListener('click', () => waehleOrdner(g.id));
      li.appendChild(b);
      ol.appendChild(li);
    });
    if (zur) zur.disabled = ordner === null;
    const zahl = $('pfadZahl');
    if (zahl) zahl.textContent = zahlText(listeBerechnen().length, 'Seite', 'Seiten');
  }
  // Ordner-Kacheln des geöffneten Ordners und „+ Neuer Ordner“
  function ordnerZeichnen() {
    const ziel = $('ordnerKacheln');
    if (!ziel) return;
    leeren(ziel);
    if (!aktPaket) return;
    for (const o of kinderVon(ordner)) {
      const kachel = document.createElement('div');
      kachel.className = 'ordner-kachel';
      kachel.setAttribute('data-ordner', String(o.id));
      const auf = document.createElement('button');
      auf.type = 'button';
      auf.className = 'ok-oeffnen';
      const n = aktPaket.dokumente.filter((d) => d.ausgeblendet !== true && Array.isArray(d.ordner) && d.ordner.indexOf(o.id) >= 0).length;
      const m = kinderVon(o.id).length;
      const sym = span('ok-symbol', '');
      sym.setAttribute('aria-hidden', 'true');
      auf.append(sym, span('ok-name', String(o.name)), span('ok-zahl', zahlText(n, 'Seite', 'Seiten') + (m ? ' · ' + zahlText(m, 'Ordner', 'Ordner') : '')));
      auf.addEventListener('click', () => waehleOrdner(o.id));
      kachel.appendChild(auf);
      if (uebersicht && typeof uebersicht.ordnerMenue === 'function') {
        const mehr = document.createElement('button');
        mehr.type = 'button';
        mehr.className = 'ok-mehr';
        mehr.textContent = '···';
        mehr.setAttribute('aria-label', 'Menü Ordner ' + o.name);
        mehr.addEventListener('click', () => { uebersicht.ordnerMenue(o, mehr); });
        kachel.appendChild(mehr);
      }
      ziel.appendChild(kachel);
    }
    if (uebersicht && typeof uebersicht.neuerOrdner === 'function') {
      const neu = document.createElement('button');
      neu.type = 'button';
      neu.className = 'ordner-neu';
      neu.id = 'btnNeuerOrdner';
      neu.textContent = '+ Neuer Ordner';
      neu.addEventListener('click', () => { uebersicht.neuerOrdner(ordner); });
      ziel.appendChild(neu);
    }
    const titel = $('seitenTitel');
    if (titel) titel.hidden = false;
  }
  function uebersichtZeichnen() { pfadZeichnen(); ordnerZeichnen(); }
  function waehleOrdner(id) {
    if (!aktPaket) return;
    const neu = id === null || id === undefined || !ordnerVon(id) ? null : id;
    if (neu === ordner) return;
    ordner = neu;
    if (vb) schliesse();
    uebersichtZeichnen();
    kachelnZeichnen();
    pfadZeichnen();
    melde('flyer:kategorie', ereignis());
  }
  function ordnerZurueck() {
    if (ordner === null) return false;
    const o = ordnerVon(ordner);
    waehleOrdner(o ? o.eltern : null);
    return true;
  }
  // flyer-uebersicht.js: Menüs und „+ Neuer Ordner“ (danach neu zeichnen)
  function setzeUebersicht(u) {
    uebersicht = u && typeof u === 'object' ? u : null;
    if (aktPaket) { uebersichtZeichnen(); kachelnZeichnen(); }
  }

  /* ---------- Vollbild ---------- */
  // Dokument auf die Breite der Bühne skalieren: Hülle mit expliziter Breite/Höhe (skaliert), Host absolut + transform.
  // Zweimal, falls dabei eine Bildlaufleiste erscheint oder verschwindet und die Bühne schmaler/breiter wird.
  function skaliereVollbild() {
    const b = $('vbBuehne');
    if (!vb || !vb.host || !b) return;
    const innen = () => {
      const cs = getComputedStyle(b);
      return Math.max(0, b.clientWidth - (parseFloat(cs.paddingLeft) || 0) - (parseFloat(cs.paddingRight) || 0));
    };
    const breite = nennBreite(vb.dok, vb.host);
    let verfuegbar = innen();
    for (let i = 0; i < 2; i++) {
      const k = verfuegbar / breite;
      vb.host.style.transform = 'scale(' + k + ')';
      vb.huelle.style.width = (breite * k) + 'px';
      vb.huelle.style.height = (vb.host.offsetHeight * k) + 'px';
      const neu = innen();
      if (neu === verfuegbar) break;
      verfuegbar = neu;
    }
  }
  // Aus ResizeObserver/resize: erst im nächsten Bild skalieren (sonst meldet ResizeObserver eine Schleife).
  function planeVollbild() {
    if (!vb || vbGeplant) return;
    vbGeplant = true;
    requestAnimationFrame(() => { vbGeplant = false; skaliereVollbild(); });
  }
  function vbAufraeumen() {
    if (vbBeobachter) vbBeobachter.disconnect();
    const b = $('vbBuehne');
    if (b) leeren(b);
  }

  // Dokument Nummer index der aktuellen Liste im Vollbild zeigen (auch zum Blättern). Promise: Ergebnis von fertig.
  function oeffne(index, behalteScroll) {
    einrichten();
    const i = Number(index);
    const fenster = $('vollbild'), buehne = $('vbBuehne');
    if (!Number.isInteger(i) || i < 0 || i >= liste.length || !fenster || !buehne) return Promise.resolve(null);
    const dok = liste[i];
    const warZu = !vb;
    if (warZu) {
      const a = document.activeElement;
      oeffner = a && typeof a.closest === 'function' ? a.closest('.kachel') : null;
    }
    vbAufraeumen();
    const nummer = ++vbNummer;
    const zaehler = $('vbZaehler'), titel = $('vbTitel'), warnung = $('vbWarnung');
    if (zaehler) zaehler.textContent = (i + 1) + ' / ' + liste.length;
    if (titel) titel.textContent = dok.id + ' · ' + dok.titel;
    if (warnung) warnung.hidden = true;
    fenster.hidden = false;
    const huelle = document.createElement('div');
    huelle.className = 'vb-huelle';
    huelle.style.position = 'relative';
    huelle.style.overflow = 'hidden';
    buehne.appendChild(huelle);
    // Neu-Darstellung desselben Dokuments (Teil 2): Bildlaufposition behalten
    const scroll = behalteScroll === true && !warZu ? buehne.scrollTop : 0;
    buehne.scrollTop = 0;
    let d = null;
    try { d = darstellen(dok, huelle, optionen(dok, 'vollbild')); } catch (e) { d = null; }   // Dokument ohne Inhalt: leere Bühne
    vb = { index: i, dok: dok, host: d ? d.host : null, wurzel: d ? d.wurzel : null, huelle: huelle };
    skaliereVollbild();
    if (scroll) buehne.scrollTop = scroll;
    if (vbBeobachter) { vbBeobachter.observe(buehne); if (d) vbBeobachter.observe(d.host); }
    if (warZu) {
      // Fokus in den Dialog: auf die Bühne (dann scrollen ↑/↓/Leertaste sie).
      if (!buehne.hasAttribute('tabindex')) buehne.setAttribute('tabindex', '-1');
      try { buehne.focus({ preventScroll: true }); } catch (e) { /* ohne Fokus geht es auch */ }
    }
    melde('flyer:vollbild', { dok: dok, offen: true });
    if (!d) return Promise.resolve(null);
    return d.fertig.then((r) => {
      if (nummer === vbNummer && vb) {
        if (warnung) warnung.hidden = !r.zuLang;
        skaliereVollbild();   // Höhe kann sich mit Schrift und Anpassung geändert haben
        if (scroll) buehne.scrollTop = scroll;
      }
      return r;
    });
  }
  // Teil 2: offenes Vollbild-Dokument neu darstellen (Änderung, Wechsel Ansehen/Text/Status), Bildlauf bleibt
  function vollbildNeu() {
    if (!vb) return Promise.resolve(null);
    return oeffne(vb.index, true);
  }
  function blaettere(richtung) {
    if (!vb) return;
    const n = vb.index + richtung;
    if (n < 0 || n >= liste.length) return;   // am Ende nicht umlaufen
    oeffne(n);
  }
  function schliesse() {
    if (!vb) return;
    const dok = vb.dok;
    vbAufraeumen();
    vb = null;
    vbNummer++;
    const fenster = $('vollbild'), warnung = $('vbWarnung');
    if (fenster) fenster.hidden = true;
    if (warnung) warnung.hidden = true;
    melde('flyer:vollbild', { dok: dok, offen: false });
    // Fokus zurück auf die Kachel (die des zuletzt gezeigten Dokuments, sonst die, von der aus geöffnet wurde).
    const k = kachelFuer(dok.id) || oeffner;
    oeffner = null;
    if (k && k.isConnected) { try { k.focus(); } catch (e) { /* egal */ } }
  }

  /* ---------- Tastatur und Wischen ---------- */
  // Fokus durch Shadow Roots hindurch verfolgen.
  function tiefesAktivesElement() {
    let a = document.activeElement;
    while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement;
    return a;
  }
  function istTexteingabe(el) {
    if (!el) return false;
    if (el.isContentEditable) return true;
    const n = String(el.localName || '').toLowerCase();
    if (n === 'input') return !KNOPF_TYPEN.includes(String(el.type || 'text').toLowerCase());
    return n === 'textarea' || n === 'select';
  }
  function taste(e) {
    if (e.metaKey || e.ctrlKey || e.altKey) return;
    if (istTexteingabe(tiefesAktivesElement())) return;
    if (!vb) {
      // F3a: Übersicht – Backspace geht einen Ordner zurück (nicht in Texteingaben, nicht unter Dialog oder Tafel)
      const m = $('modal'), t = $('tafel');
      if (e.key !== 'Backspace' || e.repeat || (m && !m.hidden) || (t && !t.hidden)) return;
      if (ordnerZurueck()) e.preventDefault();
      return;
    }
    const modal = $('modal');
    if (modal && !modal.hidden) return;                // Sichern-Dialog liegt darüber: der hat Vorrang
    const tafel = $('tafel');
    if (tafel && !tafel.hidden) return;                // F3a: Tafel liegt darüber (flyer-uebersicht.js)
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      blaettere(e.key === 'ArrowRight' ? 1 : -1);
    } else if (e.key === 'Escape' || e.key === 'Backspace') {
      if (e.repeat) return;
      e.preventDefault();
      schliesse();
    }
  }
  function wischStart(e) {
    if (!vb || (e.touches && e.touches.length > 1)) { wisch = null; return; }   // zwei Finger: Zoomen, nicht Blättern
    const t = (e.touches && e.touches[0]) || (e.changedTouches && e.changedTouches[0]);
    wisch = t ? { x: t.clientX, y: t.clientY } : null;
  }
  function wischEnde(e) {
    const start = wisch;
    wisch = null;
    if (!start || !vb) return;
    const t = e.changedTouches && e.changedTouches[0];
    if (!t) return;
    // Hineingezoomt (Seite vergrößert): waagerechtes Ziehen verschiebt den Ausschnitt, blättert nicht.
    if (window.visualViewport && window.visualViewport.scale > 1.01) return;
    const dx = t.clientX - start.x, dy = t.clientY - start.y;
    if (Math.abs(dx) > WISCH_MIN_PX && Math.abs(dx) > WISCH_VERHAELTNIS * Math.abs(dy)) blaettere(dx < 0 ? 1 : -1);
  }

  // Bedienung einmalig anbinden (erst beim ersten Zeigen – beim Laden tut das Modul nichts außer Definitionen).
  function einrichten() {
    if (eingerichtet) return;
    eingerichtet = true;
    if (typeof ResizeObserver === 'function') {
      kachelBeobachter = new ResizeObserver((eintraege) => {
        for (const en of eintraege) skaliereKachel(en.target, en.contentRect.width);
      });
      vbBeobachter = new ResizeObserver(() => { planeVollbild(); });
    }
    window.addEventListener('resize', () => {
      if (!kachelBeobachter) alleKachelnSkalieren();
      planeVollbild();
    });
    document.addEventListener('keydown', taste);
    const zurueck = $('vbZurueck'), weiter = $('vbWeiter'), zu = $('vbZu'), buehne = $('vbBuehne');
    const pz = $('pfadZurueck'), aus = $('btnAusgeblendete');
    if (pz) pz.addEventListener('click', () => { ordnerZurueck(); });
    if (aus) aus.addEventListener('click', () => { zeigeAusgeblendete(!mitAusgeblendeten); });
    if (zurueck) zurueck.addEventListener('click', () => blaettere(-1));
    if (weiter) weiter.addEventListener('click', () => blaettere(1));
    if (zu) zu.addEventListener('click', () => schliesse());
    if (buehne) {
      buehne.addEventListener('touchstart', wischStart, { passive: true });
      buehne.addEventListener('touchend', wischEnde, { passive: true });
      buehne.addEventListener('touchcancel', () => { wisch = null; }, { passive: true });
    }
  }

  /* ---------- Paket zeigen ---------- */
  // Vorbereiten, Chips neu, Kacheln der gewählten Kategorie (bleibt erhalten, wenn es sie noch gibt). Ein offenes
  // Vollbild bleibt beim selben Dokument (falls noch in der Liste). Promise: wenn alle Kacheln dargestellt und angepasst sind.
  function zeigePaket(paket) {
    einrichten();
    const offenId = vb ? vb.dok.id : null;
    if (!paket || !Array.isArray(paket.dokumente) || !paket.dokumente.length) {
      schliesse();
      aktPaket = null;
      ordner = null;
      liste = [];
      generation++;
      if (kachelBeobachter) kachelBeobachter.disconnect();
      kachelSkalen = new Map();
      kachelFlyer = [];
      const ziel = $('kacheln'), ok = $('ordnerKacheln'), titel = $('seitenTitel');
      if (ziel) leeren(ziel);
      if (ok) leeren(ok);
      if (titel) titel.hidden = true;
      pfadZeichnen();
      ausgeblendetKnopf();
      melde('flyer:kategorie', ereignis());
      return Promise.resolve([]);
    }
    vorbereiten(paket);
    aktPaket = paket;
    if (ordner !== null && !ordnerVon(ordner)) ordner = null;   // Ordner gibt es nicht mehr: „Alle“
    const fertig = kachelnZeichnen();
    uebersichtZeichnen();
    melde('flyer:kategorie', ereignis());
    if (offenId !== null) {
      const i = liste.findIndex((d) => d.id === offenId);
      if (i >= 0) oeffne(i); else schliesse();
    }
    return fertig;
  }

  window.AetherFlyerAnsicht = Object.freeze({
    vorbereiten: vorbereiten,
    darstellen: darstellen,
    schriftenBereit: schriftenBereit,
    schriftenGeladen: schriftenGeladen,
    schriftAnpassen: schriftAnpassen,
    wurzelVon: (host) => hostWurzeln.get(host) || null,   // Wurzel eines Darstellungs-Hosts (z. B. in #druck)
    zeigePaket: zeigePaket,
    oeffne: oeffne,
    schliesse: schliesse,
    aktuelleListe: () => liste.slice(),
    aktuelleKategorie: () => (ordner === null ? 'alle' : ordner),   // wie bisher: 'alle' oder der geöffnete Ordner
    // F3a: Ordner
    aktuellerOrdner: () => ordner,
    oeffneDok: (id) => { const i = liste.findIndex((d) => d.id === id); return i >= 0 ? oeffne(i) : Promise.resolve(null); },
    oeffneOrdner: (id) => waehleOrdner(id === undefined ? null : id),
    ordnerZurueck: ordnerZurueck,
    zeigeAusgeblendete: zeigeAusgeblendete,
    ausgeblendeteSichtbar: () => mitAusgeblendeten,
    setzeUebersicht: setzeUebersicht,
    offenesDokument: () => (vb ? vb.dok : null),
    paket: () => aktPaket,
    // Teil 2
    setzeAnpasser: setzeAnpasser,
    optionen: optionen,
    aktualisiere: aktualisiere,
    vollbildNeu: vollbildNeu,
    vollbildHost: () => (vb ? vb.host : null)
  });
})();
