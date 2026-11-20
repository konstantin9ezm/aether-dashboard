// Steuerung der Seite „Flyer & Infografiken“ (flyer.html, Teil A): startet alles. Beim Öffnen wird das gespeicherte
// Flyer-Paket (IndexedDB „aether-flyer“ über AetherFlyerSpeicher) gezeigt (AetherFlyerAnsicht), danach werden die
// optionalen Teile eingerichtet: Online-Prüfung (AetherFlyerOnline) und PDF/Bild (AetherFlyerExport). Jedes optionale
// Modul wird auf Vorhandensein geprüft – fehlt eines (z. B. per git revert zurückgenommen), bleiben seine Knöpfe
// verborgen und der Rest läuft weiter.
// „Paket importieren“: Datei wählen → Text → AetherFlyerPaket.lies (Format prüfen) → speichern → zeigen.
// Ein neues Paket (Import oder online) ersetzt das vorige; Übernahmen laufen nacheinander, nie gleichzeitig.
// Token: gehört dem Dashboard (localStorage „aether.githubToken“), wird hier nur gelesen und nur an flyer-online.js
// weitergereicht – nie geschrieben, nie gespeichert (auch nicht in IndexedDB), nie in Adressen, Meldungen oder Logs.
// Kopfzeile #status: „offline bereit · Stand TT.MM.JJJJ“ (Paket liegt auf dem Gerät), „Stand TT.MM.JJJJ · nicht
// offline gespeichert“ (Speichern schlug fehl) oder „noch kein Paket“; dazu „· n Änderungen nicht exportiert“ (Teil 2).
// Teil 2: Änderungsschicht (AetherFlyerAenderungen) – beim Start vor der ersten Anzeige geladen und über
// AetherFlyerAnsicht.setzeAnpasser in jede Darstellung gelegt; jede Übernahme (Import, online) gleicht sie genau einmal
// mit dem neuen Paket ab. Bearbeiten, Export und Sicherung richtet AetherFlyerBearbeiten ein (optional wie die übrigen).
// window.AetherFlyer: Schnittstelle für die Tests und Teil 2 (siehe unten).
// F3a: Die Basis bleibt gespeichert, wie sie kam (Format v1 oder v2), und gilt hier als v2 (AetherFlyerPaket.alsV2).
// Der lokale Stand (Versionen, Ordner, Seiten – AetherFlyerStruktur) liegt in IndexedDB „struktur“ (null = wie die
// Basis), die geöffnete Version merkt sich das Gerät („geraet“, beim ersten Start 1.1). Ansicht, Änderungsschicht,
// Druck und Bild sehen die Sicht der geöffneten Version; Export und Online-Prüfung das ganze Paket.
// F3b: Bibliothek (Feld „medien“ des lokalen Stands, für alle Versionen) – Metadaten ändern wie die Struktur über
// aendereStruktur; Inhalte liegen nur im Store „medien“ (AetherFlyerSpeicher). Die optionalen Module Bibliothek
// (AetherFlyerBibliothek), Player (AetherFlyerPlayer, legt Medien in jede Darstellung) und der Online-Abgleich der
// Medien (AetherFlyerMedienOnline) bekommen ihre Hilfen hier; fehlt eines, läuft der Rest weiter.
(function () {
  'use strict';

  // Selbst gewählt: höchstens 20 s auf die Darstellung eines Pakets warten (die Ansicht wartet selbst höchstens 5 s
  // auf die Schriften); danach gilt die Anzeige als fertig, damit Kopfzeile und „bereit“ nie hängen bleiben.
  const ANZEIGE_FRIST_MS = 20 * 1000;
  // Paket-Zeile, wenn das Paket keinen eigenen Titel mitbringt (titel ist im Format kein Pflichtfeld).
  const STANDARD_TITEL = 'Flyer-Paket';

  const $ = (id) => document.getElementById(id);
  const G = window.AetherGemeinsam;
  const P = window.AetherFlyerPaket;
  const S = window.AetherFlyerSpeicher || null;
  // Optionale Module (je ein Teil, einzeln zurücknehmbar)
  const A = window.AetherFlyerAnsicht || null;
  const O = window.AetherFlyerOnline || null;
  const E = window.AetherFlyerExport || null;
  const AE = window.AetherFlyerAenderungen || null;
  const B = window.AetherFlyerBearbeiten || null;
  const U = window.AetherFlyerUebersicht || null;
  const GR = window.AetherFlyerGrafik || null;
  const ST = window.AetherFlyerStruktur;
  const M = window.AetherFlyerMedien || null;
  const BI = window.AetherFlyerBibliothek || null;
  const PL = window.AetherFlyerPlayer || null;
  const MO = window.AetherFlyerMedienOnline || null;

  /* ---------- Zustand ---------- */
  let basis = null;               // übernommenes Paket: { paket, quelle:'online'|'import', sha|null, uebernommen } (ohne Token)
  let basisV2 = null;             // dasselbe Paket im Format v2
  let lokal = null;               // lokaler Stand (v2) mit Struktur-Änderungen; null = wie die Basis
  let strukturRest = { konflikte: [], exportiert: null };   // weitere Teile des Stores „struktur“
  let version = ST.STANDARD_VERSION;   // geöffnete Version (gemerkt je Gerät)
  let sichtCache = null;          // { pk, nummer, sicht } – dieselben Objekte, solange Paket und Version gleich bleiben
  let gesichert = false;          // liegt genau dieses Paket offline auf dem Gerät?
  let reihe = Promise.resolve();  // Übernahmen und die erste Anzeige nacheinander

  /* ---------- Hilfen ---------- */
  // Token nur lesen (wie liesToken im Logo-Werkzeug); gesperrter Speicher → kein Token.
  function liesToken() { try { return localStorage.getItem('aether.githubToken') || null; } catch (e) { return null; } }
  function datum(iso) { try { return P.datum(iso); } catch (e) { return String(iso || ''); } }
  function anzahlText(n) { return n + (n === 1 ? ' Dokument' : ' Dokumente'); }
  function paketTitel(p) { return typeof p.titel === 'string' && p.titel.trim() ? p.titel.trim() : STANDARD_TITEL; }
  // Stand aller Versionen, wie er hier gilt (lokal, sonst die Basis), und die Sicht der geöffneten Version
  function effektiv() { return lokal || basisV2; }
  function sicht() {
    const pk = effektiv();
    if (!pk) return null;
    if (!ST.version(pk, version)) version = ST.STANDARD_VERSION;
    if (!sichtCache || sichtCache.pk !== pk || sichtCache.nummer !== version) sichtCache = { pk: pk, nummer: version, sicht: ST.sicht(pk, version) };
    return sichtCache.sicht;
  }
  function alsFehler(e, titel) {
    if (e instanceof G.AppError) return e;
    return new G.AppError('unknown', titel || 'Unerwarteter Fehler.', String((e && e.message) || e || ''));
  }
  // Wartet auf p, höchstens ms; endet nie mit einem Fehler.
  function mitFrist(p, ms) {
    let t;
    const zeit = new Promise((fertig) => { t = setTimeout(fertig, ms); });
    return Promise.race([Promise.resolve(p).catch(() => {}), zeit]).finally(() => clearTimeout(t));
  }

  /* ---------- Fehlerbox (wie hinweis() im Logo-Werkzeug) ---------- */
  // <b>Titel</b><div>Text</div>, bei auth/forbidden zusätzlich der Link „Token eingeben ›“ zum Dashboard.
  function fehler(titel, text, mitTokenLink) {
    const h = $('fehler');
    h.textContent = '';
    if (!titel) { h.hidden = true; return; }
    const b = document.createElement('b'); b.textContent = String(titel); h.appendChild(b);
    if (text) { const d = document.createElement('div'); d.textContent = String(text); h.appendChild(d); }
    if (mitTokenLink) { const a = document.createElement('a'); a.href = './'; a.textContent = 'Token eingeben ›'; h.appendChild(a); }
    h.hidden = false;
  }
  function fehlerWeg() { const h = $('fehler'); h.hidden = true; h.textContent = ''; }

  /* ---------- Anzeige ---------- */
  // Struktur-Änderungen (Versionen, Ordner, Seiten), die noch nicht exportiert sind: geänderte Objekte gegenüber dem
  // Stand beim letzten Export, sonst gegenüber der Basis (zwischengespeichert, solange sich nichts ändert)
  let zahlCache = null;
  function strukturZahl() {
    if (!lokal || !basisV2) return 0;
    const bezug = strukturRest.exportiert || basisV2;
    if (!zahlCache || zahlCache.lokal !== lokal || zahlCache.bezug !== bezug) zahlCache = { lokal: lokal, bezug: bezug, n: ST.aenderungenZahl(bezug, lokal) };
    return zahlCache.n;
  }
  function zeigeKopf() {
    const p = effektiv();
    const n = (AE && p ? AE.nichtExportiert() : 0) + strukturZahl();
    $('status').textContent = (!p ? 'noch kein Paket'
      : gesichert ? 'offline bereit · Stand ' + datum(p.stand)
      : 'Stand ' + datum(p.stand) + ' · nicht offline gespeichert') +
      (n > 0 ? ' · ' + n + (n === 1 ? ' Änderung' : ' Änderungen') + ' nicht exportiert' : '');
  }
  function zeigeInfo() {
    const p = effektiv(), s = sicht();
    $('paketInfo').textContent = p && s ? paketTitel(p) + ' · Version ' + p.version + ' · ' + anzahlText(s.dokumente.length) : '';
    $('leer').hidden = !!p;
  }
  // Paket-Zeile und Ansicht (Chips, Kacheln); Promise endet, wenn alle Kacheln dargestellt und angepasst sind.
  function anzeigen() {
    zeigeInfo();
    if (!A || typeof A.zeigePaket !== 'function') return Promise.resolve();
    let arbeit;
    try { arbeit = Promise.resolve(A.zeigePaket(sicht())); } catch (e) { arbeit = Promise.reject(e); }
    return mitFrist(arbeit.catch((e) => {
      const f = alsFehler(e, 'Anzeige fehlgeschlagen.');
      fehler(f.title, f.text, false);
    }), ANZEIGE_FRIST_MS);
  }

  /* ---------- Speicher (alles optional: ohne IndexedDB läuft die Seite, nur nicht offline) ---------- */
  async function speichereBasis(eintrag) {
    if (!S) return false;
    try { return (await S.speichereBasis(eintrag)) === true; } catch (e) { return false; }
  }
  async function ladeBasis() {
    if (!S) return null;
    try { return await S.ladeBasis(); } catch (e) { return null; }
  }
  async function ladeOnline() {
    if (!S) return null;
    try { return await S.ladeOnline(); } catch (e) { return null; }
  }
  async function merkeOnline(o) {
    if (!S || !o) return false;
    // Teil 2: bekannte Online-Fassung für die Zählung der Export-Fassung (flyer-bearbeiten.js)
    try { document.dispatchEvent(new CustomEvent('flyer:onlinefassung', { detail: { version: o.version } })); } catch (e) { /* egal */ }
    try { return (await S.speichereOnline({ sha: o.sha, version: o.version, stand: o.stand })) === true; } catch (e) { return false; }
  }
  // Dauerhaften Speicher anfragen (der Browser löscht das Paket dann nicht bei Platzmangel); Fehler sind egal.
  function persistAnfragen() {
    try {
      if (S && typeof S.persistAnfragen === 'function') { S.persistAnfragen().catch(() => {}); return; }
      const st = navigator.storage;
      if (!st || typeof st.persist !== 'function') return;
      Promise.resolve(typeof st.persisted === 'function' ? st.persisted() : false)
        .then((schon) => (schon === true ? true : st.persist())).catch(() => {});
    } catch (e) { /* ohne dauerhaften Speicher geht es auch */ }
  }

  /* ---------- Übernehmen (Import, online) ---------- */
  // Prüfen → speichern → anzeigen → Kopfzeile. Ersetzt das vorige Paket. Promise: true, wenn offline gespeichert;
  // lehnt mit dem AppError der Prüfung ab (dann bleibt alles, wie es war). opt.nurWennLeer: nur, wenn beim Zug in der
  // Reihe noch kein Paket da ist, sonst bleibt alles und das Ergebnis ist 'schonDa' (erstes Online-Laden, während
  // ein Import schon in der Reihe steht).
  function uebernehme(paket, opt) {
    const auftrag = reihe.then(() => uebernehmeJetzt(paket, opt || {}));
    reihe = auftrag.catch(() => {});
    return auftrag;
  }
  async function uebernehmeJetzt(paket, opt) {
    const neuV2 = P.alsV2(paket);   // prüft (v1 oder v2) und wandelt v1 um
    if (opt.nurWennLeer === true && basis && basis.paket) return 'schonDa';
    // Teil E: Struktur abgleichen (Basis, lokal, neu – je Feld), bevor die Änderungsschicht abgleicht
    const zusammen = basisV2 ? strukturAbgleich(neuV2) : null;
    // Teil 2: Änderungsschicht genau einmal mit dem neuen Stand abgleichen (Konflikte zeigt flyer-bearbeiten.js)
    if (AE) { AE.sperre(true); try { await AE.abgleichen(zusammen ? zusammen.paket : neuV2); } catch (e) { /* Schicht bleibt, wie sie war */ } }
    try { return await basisWechseln(paket, neuV2, opt, zusammen); } finally { if (AE) AE.sperre(false); }
  }
  // Teil E: Struktur der neuen Fassung R mit dem lokalen Stand L zusammenführen (Bezug: bisherige Basis B). Wirft, wenn
  // das Ergebnis kein gültiges Paket ist (dann bleibt alles, wie es war). → { paket, konflikte, alte }
  function strukturAbgleich(neuV2) {
    const L = effektiv(), fb = ST.felder(basisV2), fl = ST.felder(L), fr = ST.felder(neuV2);
    const r = ST.zusammenfuehren(fb, fl, fr, { modus: 'abgleich', eigene: eigeneEintraege() });
    const pk = ST.ausFeldern(r.felder, neuV2, [neuV2, L]);
    const bericht = ST.verweise(pk);
    try { P.pruefe(pk); } catch (e) {
      const x = alsFehler(e);
      throw new G.AppError('struktur', 'Abgleich der Struktur fehlgeschlagen.', [x.title, x.text].filter(Boolean).join(' ') + ' Es wurde nichts übernommen.');
    }
    // Offene Konflikte von früher: bleiben, solange lokal noch genau so ist und die neue Fassung anders ist
    const fm = ST.felder(pk), neu = new Set(r.konflikte.map((k) => k.objekt));
    const alte = strukturRest.konflikte.filter((k) => {
      if (neu.has(k.objekt)) return false;
      const ks = Object.keys(k.lokal);
      const lokalGleich = ks.every((x) => (fm.has(x) ? fm.get(x) : null) === k.lokal[x]);
      const andersOnline = ks.some((x) => (fr.has(x) ? fr.get(x) : null) !== k.lokal[x]);
      if (lokalGleich && andersOnline && k.quelle === 'online') { ks.forEach((x) => { k.andere[x] = fr.has(x) ? fr.get(x) : null; }); return true; }
      return lokalGleich && k.quelle === 'sicherung';
    });
    return { paket: pk, konflikte: r.konflikte, alte: alte, bericht: bericht };
  }
  async function basisWechseln(paket, neuV2, opt, zusammen) {
    const vorher = effektiv();
    const eintrag = {
      paket: paket,
      quelle: opt.quelle === 'online' ? 'online' : 'import',
      sha: typeof opt.sha === 'string' && opt.sha ? opt.sha : null,
      uebernommen: new Date().toISOString()
    };
    const ok = await speichereBasis(eintrag);
    basis = eintrag;
    basisV2 = neuV2;
    gesichert = ok;
    // Teil E: lokaler Stand = zusammengeführter Stand (null, wenn gleich der neuen Basis); Bezug der Zählung ist die
    // neue Basis; Konflikte der Struktur in die Liste
    if (zusammen) {
      lokal = ST.gleich(zusammen.paket, neuV2) ? null : zusammen.paket;
      strukturRest.konflikte = zusammen.alte;
      konflikteDazu(zusammen.konflikte, 'online');
    } else { lokal = null; strukturRest.konflikte = []; }
    strukturRest.exportiert = null;
    zahlCache = null;
    sichtCache = null;
    if (vorher) await schichtAufraeumen(vorher, effektiv());
    await strukturSpeichern();
    if (!ST.version(effektiv(), version)) await setzeVersion(ST.STANDARD_VERSION);
    await anzeigen();
    zeigeKopf();
    melde('flyer:struktur', {});
    return ok;
  }

  /* ---------- Import ---------- */
  async function importiere(datei) {
    let text;
    try { text = await datei.text(); } catch (e) {
      throw new G.AppError('datei', 'Datei ließ sich nicht lesen.', String((e && e.message) || e || ''));
    }
    const paket = P.lies(text);
    await uebernehme(paket, { quelle: 'import' });
    fehlerWeg();
    const s = sicht();
    G.meldung('Paket importiert (Version ' + paket.version + ', ' + anzahlText(s ? s.dokumente.length : 0) + ')');
    // Banner/„Aktuell …“ der Online-Prüfung gehörten zum vorigen Paket: neu prüfen lassen.
    if (O && typeof O.nachImport === 'function') {
      try { Promise.resolve(O.nachImport()).catch(() => {}); } catch (e) { /* Seite läuft ohne Online-Prüfung */ }
    }
  }
  $('btnImport').addEventListener('click', () => { $('dateiImport').click(); });
  $('dateiImport').addEventListener('change', async () => {
    const eingabe = $('dateiImport'), knopf = $('btnImport');
    const datei = eingabe.files && eingabe.files[0];
    if (!datei) return;
    knopf.disabled = true;
    try {
      await importiere(datei);
    } catch (e) {
      const f = alsFehler(e);
      // Zu neu oder fehlerhaft: nichts überschrieben, das bisherige Paket bleibt.
      if (f.kind === 'zuneu') fehler('Paket zu neu', f.text, false);
      else fehler(f.title, f.text, false);
    } finally {
      eingabe.value = '';
      knopf.disabled = false;
    }
  });

  /* ---------- Hilfen für flyer-online.js ---------- */
  const hilfen = Object.freeze({
    token: liesToken,
    // Gezeigtes Paket, dessen sha (nur bei online übernommenen Paketen) und die zuletzt bekannte Online-Datei.
    lokal: async () => {
      const o = await ladeOnline();
      return {
        paket: basis ? basis.paket : null,
        basisSha: basis ? basis.sha : null,
        online: o && typeof o.sha === 'string' && o.sha ? { sha: o.sha, version: o.version, stand: o.stand } : null
      };
    },
    uebernehme: uebernehme,
    merkeOnline: merkeOnline,
    fehler: fehler,
    fehlerWeg: fehlerWeg
  });

  /* ---------- Hilfen für flyer-bearbeiten.js (Teil 2) ---------- */
  const bearbeitenHilfen = Object.freeze({
    paket: () => sicht(),
    paketV2: () => effektiv(),
    strukturSicherung: () => strukturSicherung(),
    strukturVerwerfbar: () => strukturVerwerfbar(),
    strukturEinspielen: (l) => strukturEinspielen(l),
    strukturKonflikte: () => strukturKonflikte(),
    strukturEntscheide: (id, wahl) => strukturEntscheide(id, wahl),
    strukturVerwerfen: () => strukturVerwerfen(),
    onlineVersion: async () => { const o = await ladeOnline(); return o && typeof o.version === 'string' ? o.version : null; },
    fehler: fehler,
    fehlerWeg: fehlerWeg,
    kopf: () => zeigeKopf()
  });

  /* ---------- Hilfen für flyer-uebersicht.js (F3a) ---------- */
  const uebersichtHilfen = Object.freeze({
    paketV2: () => effektiv(),
    version: () => (effektiv() ? sicht().nummer : version),
    sicht: () => sicht(),
    oeffneVersion: oeffneVersion,
    aendere: aendereStruktur
  });

  /* ---------- Hilfen für Bibliothek, Player und Medien online (F3b) ---------- */
  const medienHilfen = Object.freeze({
    token: liesToken,
    paketV2: () => effektiv(),
    version: () => (effektiv() ? sicht().nummer : version),
    sicht: () => sicht(),
    aendere: aendereStruktur,
    oeffneVersion: oeffneVersion,
    fehler: fehler,
    fehlerWeg: fehlerWeg,
    persistAnfragen: () => persistAnfragen()
  });

  /* ---------- Änderungsschicht (Teil 2) ---------- */
  // Jede Darstellung (Kachel, Vollbild, Druck, Bild): Basis + Änderungsschicht; markiert nur im Vollbild in Text/Status.
  // F3b: danach setzt der Player die Medien ein (data-medium: Player im Vollbild, sonst das Startbild).
  function anpasserSetzen() {
    if (!A || typeof A.setzeAnpasser !== 'function') return;
    const mitPlayer = !!PL && typeof PL.anpassen === 'function';
    if (!AE && !mitPlayer) return;
    if (AE) AE.einrichten({ paket: () => sicht(), version: () => (effektiv() ? sicht().nummer : version), lokal: () => effektiv() });
    A.setzeAnpasser((wurzel, dok, ort) => {
      if (AE) {
        let markieren = false;
        try { markieren = ort === 'vollbild' && !!B && typeof B.modus === 'function' && (B.modus() === 'text' || B.modus() === 'status'); } catch (e) { markieren = false; }
        try { AE.anwenden(wurzel, dok.id, AE.fuerDok(dok.id), { markieren: markieren }); } catch (e) { /* Basis bleibt sichtbar */ }
      }
      if (mitPlayer) PL.anpassen(wurzel, dok, ort);
    });
    if (!AE) return;
    document.addEventListener('flyer:aenderungen', (e) => {
      // Export gelungen: auch die Struktur gilt ab jetzt als exportiert (Prüfwerte des lokalen Stands)
      if (e && e.detail && e.detail.exportiert) {
        strukturRest.exportiert = lokal ? ST.pruefwerte(lokal) : null;
        zahlCache = null;
        strukturSpeichern();
      }
      zeigeKopf();
    });
  }

  /* ---------- Lokaler Stand und geöffnete Version (F3a) ---------- */
  function melde(name, detail) { try { document.dispatchEvent(new CustomEvent(name, { detail: detail || {} })); } catch (e) { /* egal */ } }
  async function strukturSpeichern() {
    if (!S || typeof S.speichereStruktur !== 'function') return false;
    try { return (await S.speichereStruktur({ paket: lokal, konflikte: strukturRest.konflikte, exportiert: strukturRest.exportiert })) === true; } catch (e) { return false; }
  }
  // Struktur ändern: fn(kopie) ändert eine Kopie des ganzen Stands (wirft bei ungültiger Eingabe – dann bleibt alles).
  // Das Ergebnis muss AetherFlyerPaket.pruefe bestehen; danach gespeichert (lokal = null, wenn gleich der Basis) und neu
  // gezeigt. Nacheinander mit den Übernahmen (reihe). → Promise<Ergebnis von fn>
  function aendereStruktur(fn) {
    const auftrag = reihe.then(async () => {
      const alt = effektiv();
      if (!alt) throw new G.AppError('struktur', 'Kein Paket geladen.', 'Erst ein Paket laden oder importieren.');
      const neu = JSON.parse(JSON.stringify(alt));
      const ergebnis = fn(neu);
      try { P.pruefe(neu); } catch (e) {
        const f = alsFehler(e);
        throw new G.AppError('struktur', 'Änderung nicht möglich.', [f.title, f.text].filter(Boolean).join(' '));
      }
      lokal = ST.gleich(neu, basisV2) ? null : neu;
      sichtCache = null;
      const ok = await strukturSpeichern();
      if (!ok) { try { G.meldung('Änderung nicht offline gespeichert'); } catch (e) { /* ohne #toast */ } }
      if (!ST.version(effektiv(), version)) await setzeVersion(ST.STANDARD_VERSION);
      await anzeigen();
      zeigeKopf();
      melde('flyer:struktur', {});
      return ergebnis;
    });
    reihe = auftrag.catch(() => {});
    return auftrag;
  }
  // Lokalen Stand aus Feldern setzen (prüft, speichert, zeigt); entfernt Einträge der Änderungsschicht von Seiten und
  // Versionen, die es danach nicht mehr gibt (nur nach einer ausdrücklichen Wahl: Konflikt, Verwerfen)
  async function lokalAusFeldern(f, reihe2) {
    const alt = effektiv();
    const neu = ST.ausFeldern(f, alt, reihe2 || [alt, basisV2]);
    ST.verweise(neu);   // Sicherheitsnetz: Verweise und Zähler (die Wahl selbst hält sie stimmig)
    try { P.pruefe(neu); } catch (e) {
      const x = alsFehler(e);
      throw new G.AppError('struktur', 'Änderung nicht möglich.', [x.title, x.text].filter(Boolean).join(' '));
    }
    lokal = ST.gleich(neu, basisV2) ? null : neu;
    sichtCache = null;
    await schichtAufraeumen(alt, effektiv());
  }
  async function schichtAufraeumen(alt, neu) {
    if (!AE || typeof AE.entferne !== 'function') return;
    for (const v of alt.versionen) {
      const nv = ST.version(neu, v.nummer);
      if (!nv) { try { await AE.entferne(v.nummer); } catch (e) { /* egal */ } continue; }
      for (const sx of v.seiten) if (!nv.seiten.some((y) => y.id === sx.id)) { try { await AE.entferne(v.nummer, sx.id); } catch (e) { /* egal */ } }
    }
  }
  // Texte/Status in einem Objekt der Struktur (Seite, Version)? – lokal geändert, auch wenn kein Struktur-Feld anders ist
  function eigeneEintraege() {
    const r = new Set();
    if (AE && typeof AE.alleVersionen === 'function') for (const e of AE.alleVersionen()) { r.add('V|' + e.ver); r.add('P|' + e.ver + '|' + e.dok); }
    return (objekt) => r.has(objekt);
  }
  let konfliktNr = 0;
  function konflikteDazu(liste, quelle) {
    for (const k of liste) {
      strukturRest.konflikte = strukturRest.konflikte.filter((x) => x.objekt !== k.objekt);
      strukturRest.konflikte.push(Object.assign({ id: 's' + Date.now().toString(36) + '-' + (++konfliktNr), quelle: quelle }, k));
    }
  }
  // „Änderungen sichern“: Struktur-Felder der geöffneten Version, die anders sind als in der Basis; F3b: dazu die
  // Metadaten der Bibliothek (für alle Versionen, ohne Datei-Inhalte)
  function strukturSicherung() {
    if (!lokal || !basisV2) return [];
    return ST.feldAenderungen(basisV2, lokal, sicht() ? sicht().nummer : version).concat(ST.BIBLIOTHEK ? ST.feldAenderungen(basisV2, lokal, ST.BIBLIOTHEK) : []);
  }
  // F3b: was „Alle Änderungen verwerfen“ zurücknimmt (nur die geöffnete Version; die Bibliothek bleibt)
  function strukturVerwerfbar() { return lokal && basisV2 ? ST.feldAenderungen(basisV2, lokal, sicht() ? sicht().nummer : version).length : 0; }
  // „Änderungen einspielen“: Struktur-Felder einordnen (eigene Änderung geht vor, sonst wie bei Texten) → Zahlen
  function strukturEinspielen(liste) {
    const auftrag = reihe.then(async () => {
      const pk = effektiv();
      if (!pk) throw new G.AppError('einspielen', 'Kein Paket geladen.', 'Erst ein Paket laden oder importieren.');
      const fa = new Map(), alt = new Map();
      for (const e of liste) { if (e.neu !== null) fa.set(e.k, e.neu); if (e.alt !== null) alt.set(e.k, e.alt); }
      const r = ST.zusammenfuehren(ST.felder(basisV2), ST.felder(pk), fa, { modus: 'sicherung', alt: alt, schluessel: liste.map((e) => e.k), eigene: eigeneEintraege() });
      await lokalAusFeldern(r.felder, [pk, basisV2]);
      konflikteDazu(r.konflikte, 'sicherung');
      zahlCache = null;
      await strukturSpeichern();
      await anzeigen();
      zeigeKopf();
      melde('flyer:struktur', {});
      return { uebernommen: r.uebernommen, verworfen: r.verworfen, konflikte: r.konflikte.length };
    });
    reihe = auftrag.catch(() => {});
    return auftrag;
  }
  // Offene Struktur-Konflikte für die Konfliktliste
  function strukturKonflikte() {
    const fl = ST.felder(effektiv());
    return strukturRest.konflikte.map((k) => Object.assign({ id: k.id, quelle: k.quelle, objekt: k.objekt }, ST.konfliktText(k, fl, null)));
  }
  // Wahl in einem Struktur-Konflikt: 'lokal' (bleibt) oder 'andere' (Wert der Online-Datei bzw. Sicherung)
  function strukturEntscheide(id, wahl) {
    const auftrag = reihe.then(async () => {
      const k = strukturRest.konflikte.find((x) => x.id === id);
      if (!k) return false;
      if (wahl === 'andere') await lokalAusFeldern(ST.waehle(ST.felder(effektiv()), k, 'andere'));
      strukturRest.konflikte = strukturRest.konflikte.filter((x) => x.id !== id);
      zahlCache = null;
      await strukturSpeichern();
      await anzeigen();
      zeigeKopf();
      melde('flyer:struktur', {});
      return true;
    });
    reihe = auftrag.catch(() => {});
    return auftrag;
  }
  // „Alle Änderungen verwerfen“: Struktur der geöffneten Version wie in der Basis (eine neue Version entfällt ganz)
  function strukturVerwerfen() {
    const auftrag = reihe.then(async () => {
      if (!lokal) return false;
      const nr = sicht() ? sicht().nummer : version;
      const fl = ST.felder(lokal), fb = ST.felder(basisV2), m = new Map();
      fl.forEach((w, k) => { if (k.split('|')[1] !== nr) m.set(k, w); });
      fb.forEach((w, k) => { if (k.split('|')[1] === nr) m.set(k, w); });
      await lokalAusFeldern(m, [basisV2, lokal]);
      strukturRest.konflikte = strukturRest.konflikte.filter((x) => x.objekt.split('|')[1] !== nr);
      if (!ST.version(effektiv(), version)) await setzeVersion(ST.STANDARD_VERSION);
      zahlCache = null;
      await strukturSpeichern();
      await anzeigen();
      zeigeKopf();
      melde('flyer:struktur', {});
      return true;
    });
    reihe = auftrag.catch(() => {});
    return auftrag;
  }
  async function setzeVersion(nr) {
    version = nr;
    sichtCache = null;
    if (S && typeof S.speichereGeraet === 'function') { try { await S.speichereGeraet('version', nr); } catch (e) { /* nur dieses Mal */ } }
  }
  // Version öffnen (F2: das Gerät merkt sie sich). → Promise<Boolean>
  function oeffneVersion(nr) {
    const auftrag = reihe.then(async () => {
      if (!effektiv() || !ST.version(effektiv(), nr)) throw new G.AppError('struktur', 'Version nicht gefunden.', 'Version ' + nr + ' gibt es nicht.');
      if (A && typeof A.schliesse === 'function') { try { A.schliesse(); } catch (e) { /* egal */ } }
      await setzeVersion(nr);
      await anzeigen();
      zeigeKopf();
      melde('flyer:struktur', { version: nr });
      return true;
    });
    reihe = auftrag.catch(() => {});
    return auftrag;
  }
  async function ladeLokal() {
    let st = null, v = null;
    try { st = S && typeof S.ladeStruktur === 'function' ? await S.ladeStruktur() : null; } catch (e) { st = null; }
    try { v = S && typeof S.ladeGeraet === 'function' ? await S.ladeGeraet('version') : null; } catch (e) { v = null; }
    lokal = null;
    strukturRest = { konflikte: [], exportiert: null };
    if (st && st.paket) {
      try { P.pruefe(st.paket); lokal = st.paket; } catch (e) {
        const f = alsFehler(e);
        fehler('Lokaler Stand nicht lesbar.', [f.title, f.text].filter(Boolean).join(' '), false);
      }
    }
    if (st) strukturRest = { konflikte: st.konflikte || [], exportiert: st.exportiert || null };
    version = typeof v === 'string' && ST.version(effektiv(), v) ? v : ST.STANDARD_VERSION;
  }

  /* ---------- Start ---------- */
  function einrichtenOptional() {
    if (O && typeof O.einrichten === 'function') {
      try { Promise.resolve(O.einrichten(hilfen)).catch(() => {}); } catch (e) { /* Seite läuft ohne Online-Prüfung */ }
    }
    if (E && typeof E.einrichten === 'function') {
      try { Promise.resolve(E.einrichten()).catch(() => {}); } catch (e) { /* Seite läuft ohne PDF/Bild */ }
    }
    if (AE && B && typeof B.einrichten === 'function') {
      try { Promise.resolve(B.einrichten(bearbeitenHilfen)).catch(() => {}); } catch (e) { /* Seite läuft ohne Bearbeiten */ }
    }
    if (U && typeof U.einrichten === 'function') {
      try { U.einrichten(uebersichtHilfen); } catch (e) { /* Seite läuft ohne Versionen und Ordner */ }
    }
    if (GR && typeof GR.einrichten === 'function') {
      try { GR.einrichten(); } catch (e) { /* Seite läuft ohne „Grafiken & Daten“ */ }
    }
    // F3b: Player (Modus „Medium“), Bibliothek, Online-Abgleich der Medien
    if (M && PL && typeof PL.einrichten === 'function') {
      try { PL.einrichten(medienHilfen); } catch (e) { /* Seite läuft ohne Player */ }
    }
    if (M && BI && typeof BI.einrichten === 'function') {
      try { BI.einrichten(medienHilfen); } catch (e) { /* Seite läuft ohne Bibliothek */ }
      const MT = window.AetherFlyerMedienTafeln || null;
      if (MT && typeof MT.einrichten === 'function') { try { MT.einrichten(); } catch (e) { /* ohne Hinzufügen und Menüs */ } }
    }
    if (M && MO && typeof MO.einrichten === 'function') {
      try { Promise.resolve(MO.einrichten(medienHilfen)).catch(() => {}); } catch (e) { /* Seite läuft ohne Medien online */ }
    }
  }
  async function start() {
    persistAnfragen();
    anpasserSetzen();
    // Änderungsschicht zuerst in die Reihe: eine frühe Übernahme (Import) gleicht erst danach ab
    if (AE) reihe = reihe.then(() => AE.laden()).catch(() => {});
    const b = await ladeBasis();
    if (b && b.paket) {
      try {
        basisV2 = P.alsV2(b.paket);
        basis = { paket: b.paket, quelle: b.quelle === 'online' ? 'online' : 'import', sha: typeof b.sha === 'string' && b.sha ? b.sha : null, uebernommen: b.uebernommen || null };
        gesichert = true;
        await ladeLokal();
      } catch (e) {
        const f = alsFehler(e);
        fehler('Gespeichertes Paket nicht lesbar.', [f.title, f.text].filter(Boolean).join(' '), false);
      }
    }
    // Erste Anzeige in der Reihe: eine Übernahme (z. B. online) wartet, bis sie fertig ist.
    const anzeige = reihe.then(() => (basis ? anzeigen() : zeigeInfo()));
    reihe = anzeige.catch(() => {});
    einrichtenOptional();
    await anzeige;
    zeigeKopf();
  }

  const bereit = start().catch((e) => {
    const f = alsFehler(e);
    fehler(f.title, f.text, false);
    zeigeKopf();
  }).then(() => undefined);

  // Schnittstelle für Tests und Teil 2
  window.AetherFlyer = Object.freeze({
    bereit: bereit,                                         // Start fertig: Basis geladen, Kacheln dargestellt und angepasst
    stand: () => (basis && basis.paket ? 'paket' : 'leer'),
    paket: () => (basis ? basis.paket : null),              // Basis, wie gespeichert (v1 oder v2)
    paketV2: () => effektiv(),                              // F3a: Stand aller Versionen (lokal, sonst Basis) im Format v2
    sicht: () => sicht(),                                   // F3a: Sicht der geöffneten Version
    version: () => (effektiv() ? sicht().nummer : version), // F3a: Nummer der geöffneten Version
    aendereStruktur: aendereStruktur,                       // F3a: (fn(kopie)) → Promise
    oeffneVersion: oeffneVersion,                           // F3a: (nummer) → Promise
    strukturZahl: () => strukturZahl(),
    strukturKonflikte: () => strukturKonflikte(),
    uebernehme: uebernehme,                                 // (paket, { quelle:'online'|'import', sha, nurWennLeer }) → Promise<Boolean|'schonDa'>
    fehler: fehler,                                         // (titel, text, mitTokenLink)
    fehlerWeg: fehlerWeg,
    gespeichert: () => ladeBasis()                          // → Promise<Basis-Eintrag|null> (aus IndexedDB)
  });
})();
