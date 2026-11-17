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

  /* ---------- Zustand ---------- */
  let basis = null;               // übernommenes Paket: { paket, quelle:'online'|'import', sha|null, uebernommen } (ohne Token)
  let gesichert = false;          // liegt genau dieses Paket offline auf dem Gerät?
  let reihe = Promise.resolve();  // Übernahmen und die erste Anzeige nacheinander

  /* ---------- Hilfen ---------- */
  // Token nur lesen (wie liesToken im Logo-Werkzeug); gesperrter Speicher → kein Token.
  function liesToken() { try { return localStorage.getItem('aether.githubToken') || null; } catch (e) { return null; } }
  function datum(iso) { try { return P.datum(iso); } catch (e) { return String(iso || ''); } }
  function anzahlText(n) { return n + (n === 1 ? ' Dokument' : ' Dokumente'); }
  function paketTitel(p) { return typeof p.titel === 'string' && p.titel.trim() ? p.titel.trim() : STANDARD_TITEL; }
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
  function zeigeKopf() {
    const p = basis && basis.paket;
    const n = AE && p ? AE.nichtExportiert() : 0;
    $('status').textContent = (!p ? 'noch kein Paket'
      : gesichert ? 'offline bereit · Stand ' + datum(p.stand)
      : 'Stand ' + datum(p.stand) + ' · nicht offline gespeichert') +
      (n > 0 ? ' · ' + n + (n === 1 ? ' Änderung' : ' Änderungen') + ' nicht exportiert' : '');
  }
  function zeigeInfo() {
    const p = basis && basis.paket;
    $('paketInfo').textContent = p ? paketTitel(p) + ' · Version ' + p.version + ' · ' + anzahlText(p.dokumente.length) : '';
    $('leer').hidden = !!p;
  }
  // Paket-Zeile und Ansicht (Chips, Kacheln); Promise endet, wenn alle Kacheln dargestellt und angepasst sind.
  function anzeigen() {
    zeigeInfo();
    if (!A || typeof A.zeigePaket !== 'function') return Promise.resolve();
    let arbeit;
    try { arbeit = Promise.resolve(A.zeigePaket(basis ? basis.paket : null)); } catch (e) { arbeit = Promise.reject(e); }
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
    P.pruefe(paket);
    if (opt.nurWennLeer === true && basis && basis.paket) return 'schonDa';
    // Teil 2: Änderungsschicht genau einmal mit dem neuen Paket abgleichen (Konflikte zeigt flyer-bearbeiten.js)
    if (AE) { try { await AE.abgleichen(paket); } catch (e) { /* Schicht bleibt, wie sie war */ } }
    const eintrag = {
      paket: paket,
      quelle: opt.quelle === 'online' ? 'online' : 'import',
      sha: typeof opt.sha === 'string' && opt.sha ? opt.sha : null,
      uebernommen: new Date().toISOString()
    };
    const ok = await speichereBasis(eintrag);
    basis = eintrag;
    gesichert = ok;
    await anzeigen();
    zeigeKopf();
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
    G.meldung('Paket importiert (Version ' + paket.version + ', ' + anzahlText(paket.dokumente.length) + ')');
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
    paket: () => (basis ? basis.paket : null),
    onlineVersion: async () => { const o = await ladeOnline(); return o && typeof o.version === 'string' ? o.version : null; },
    fehler: fehler,
    fehlerWeg: fehlerWeg,
    kopf: () => zeigeKopf()
  });

  /* ---------- Änderungsschicht (Teil 2) ---------- */
  // Jede Darstellung (Kachel, Vollbild, Druck, Bild): Basis + Änderungsschicht; markiert nur im Vollbild in Text/Status.
  function anpasserSetzen() {
    if (!AE || !A || typeof A.setzeAnpasser !== 'function') return;
    AE.einrichten({ paket: () => (basis ? basis.paket : null) });
    A.setzeAnpasser((wurzel, dok, ort) => {
      let markieren = false;
      try { markieren = ort === 'vollbild' && !!B && typeof B.modus === 'function' && B.modus() !== 'ansehen'; } catch (e) { markieren = false; }
      AE.anwenden(wurzel, dok.id, AE.fuerDok(dok.id), { markieren: markieren });
    });
    document.addEventListener('flyer:aenderungen', () => { zeigeKopf(); });
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
  }
  async function start() {
    persistAnfragen();
    anpasserSetzen();
    // Änderungsschicht zuerst in die Reihe: eine frühe Übernahme (Import) gleicht erst danach ab
    if (AE) reihe = reihe.then(() => AE.laden()).catch(() => {});
    const b = await ladeBasis();
    if (b && b.paket) {
      try {
        P.pruefe(b.paket);
        basis = { paket: b.paket, quelle: b.quelle === 'online' ? 'online' : 'import', sha: typeof b.sha === 'string' && b.sha ? b.sha : null, uebernommen: b.uebernommen || null };
        gesichert = true;
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
    paket: () => (basis ? basis.paket : null),
    uebernehme: uebernehme,                                 // (paket, { quelle:'online'|'import', sha, nurWennLeer }) → Promise<Boolean|'schonDa'>
    fehler: fehler,                                         // (titel, text, mitTokenLink)
    fehlerWeg: fehlerWeg,
    gespeichert: () => ladeBasis()                          // → Promise<Basis-Eintrag|null> (aus IndexedDB)
  });
})();
