// Flyer-Speicher für die Seite „Flyer & Infografiken“ (flyer.html): das zuletzt übernommene Flyer-Paket (Basis) und
// die zuletzt bekannte Online-Datei liegen in IndexedDB „aether-flyer“, damit die Seite offline startet.
// Gespeichert wird nur, was unten steht (Felder werden einzeln übernommen): nie das Token, nie API-Antworten im Ganzen.
// Alle Funktionen liefern ein Promise, das immer endet (Zeitlimit) und nie scheitert: fehlt IndexedDB oder geht etwas
// schief, gibt es null bzw. false. Die Verbindung wird erst beim ersten Zugriff geöffnet und schließt bei
// „versionchange“, damit eine neuere Seite die Datenbank aufrüsten kann.
// Version 2 (Teil 2): Store „aenderungen“ mit der Änderungsschicht (eigene Texte, Status, Stand je Dokument) und einem
// Meta-Eintrag (bisher exportierte Fassungen). Die Migration 1 → 2 legt nur den Store an; basis und online bleiben.
(function () {
  'use strict';

  var DB_NAME = 'aether-flyer';
  var DB_VERSION = 2;
  var STORES = Object.freeze(['basis', 'online']);
  var SCHLUESSEL_BASIS = 'aktuell';  // Store basis:  { paket, quelle:'online'|'import', sha:String|null, uebernommen:ISO }
  var SCHLUESSEL_ONLINE = 'stand';   // Store online: { sha, version, stand, geprueft:ISO } – zuletzt bekannte Online-Datei
  // Store aenderungen: je Eintrag Schlüssel „e:<dok>\n<art>\n<k>“ → { dok, k, art, alt, neu, exportiert, zeit, konflikt }
  // (konflikt: null oder { online } – offener Konflikt aus dem Abgleich), dazu „meta“ → { exporte: [Fassung …] }.
  var STORE_AENDERUNGEN = 'aenderungen';
  var SCHLUESSEL_META = 'meta';
  var ARTEN = ['text', 'status', 'stand'];
  // Selbst gewählt: Öffnen höchstens 5 s, ein Lese-/Schreibvorgang höchstens 10 s (Paket kann einige MB haben).
  var ZEIT_OEFFNEN_MS = 5000;
  var ZEIT_VORGANG_MS = 10000;

  var verbindung = null; // Promise<IDBDatabase|null> der offenen Verbindung

  // Höchstens ms auf p warten; Fehler oder Zeitablauf → ersatz (nie eine Ablehnung)
  function mitZeitlimit(p, ms, ersatz) {
    var timer;
    var sicher = Promise.resolve(p).catch(function () { return ersatz; });
    return Promise.race([sicher, new Promise(function (resolve) { timer = setTimeout(function () { resolve(ersatz); }, ms); })])
      .finally(function () { clearTimeout(timer); });
  }

  // Eine Öffnen-Anfrage. mitVersion = false: vorhandene (auch neuere) Version öffnen.
  // → { db } | { versionZuNeu: true } | null
  function oeffneAnfrage(mitVersion) {
    return new Promise(function (resolve) {
      var req;
      try {
        var idb = window.indexedDB;
        if (!idb) { resolve(null); return; }
        req = mitVersion ? idb.open(DB_NAME, DB_VERSION) : idb.open(DB_NAME);
      } catch (e) { resolve(null); return; } // z. B. SecurityError (Speicher gesperrt)
      var vorbei = false;
      var timer = setTimeout(function () { vorbei = true; resolve(null); }, ZEIT_OEFFNEN_MS);
      req.onupgradeneeded = function (ev) {
        var db = req.result, alt = ev.oldVersion;
        if (alt < 1) { db.createObjectStore('basis'); db.createObjectStore('online'); }
        if (alt < 2) db.createObjectStore('aenderungen');   // Teil 2: Änderungsschicht (basis und online bleiben)
      };
      req.onsuccess = function () {
        clearTimeout(timer);
        var db = req.result;
        if (vorbei) { try { db.close(); } catch (e) { /* egal */ } return; } // zu spät: nicht offen liegen lassen
        resolve({ db: db });
      };
      req.onerror = function (ev) {
        clearTimeout(timer);
        if (ev && typeof ev.preventDefault === 'function') ev.preventDefault();
        var name = req.error && req.error.name;
        if (!vorbei) resolve(name === 'VersionError' ? { versionZuNeu: true } : null);
      };
      req.onblocked = function () { /* andere Verbindung hält eine alte Version offen – das Zeitlimit beendet das Warten */ };
    });
  }

  async function verbinde() {
    var r = await oeffneAnfrage(true);
    // Datenbank schon in neuerer Version (z. B. Teil 2 wieder zurückgenommen): vorhandene Version öffnen,
    // solange die Stores dieser Seite darin liegen – so geht das gespeicherte Paket nicht verloren.
    if (r && r.versionZuNeu) r = await oeffneAnfrage(false);
    if (!r || !r.db) return null;
    var db = r.db;
    var fehlt = STORES.some(function (n) { return !db.objectStoreNames.contains(n); });
    if (fehlt) { try { db.close(); } catch (e) { /* egal */ } return null; }
    return db;
  }

  function vergiss(p) { if (verbindung === p) verbindung = null; }

  // Offene Verbindung (einmal geöffnet, dann wiederverwendet); null, wenn IndexedDB nicht geht
  function datenbank() {
    if (verbindung) return verbindung;
    var p = verbinde().catch(function () { return null; });
    verbindung = p;
    p.then(function (db) {
      if (!db) { vergiss(p); return; } // beim nächsten Zugriff neu versuchen
      db.onversionchange = function () { try { db.close(); } catch (e) { /* egal */ } vergiss(p); };
      db.onclose = function () { vergiss(p); }; // vom Browser geschlossen (z. B. Speicher gelöscht)
    });
    return p;
  }

  // Ein Vorgang in einer Transaktion: arbeit(objectStore) → IDBRequest (oder nichts). Ergebnis erst nach „complete“.
  // → { ok:Boolean, wert }
  async function ausfuehren(store, modus, arbeit, nochmal) {
    var p = datenbank();
    var db = await p;
    if (!db) return { ok: false };
    var tx;
    try {
      tx = modus === 'readwrite' ? db.transaction(store, modus, { durability: 'strict' }) : db.transaction(store, modus);
    } catch (e) {
      // Verbindung wird gerade geschlossen (versionchange, Speicher gelöscht): einmal neu verbinden
      vergiss(p);
      try { db.close(); } catch (e2) { /* egal */ }
      return nochmal ? ausfuehren(store, modus, arbeit, false) : { ok: false };
    }
    return new Promise(function (resolve) {
      var req;
      tx.oncomplete = function () { resolve({ ok: true, wert: req ? req.result : undefined }); };
      tx.onabort = function () { resolve({ ok: false }); }; // auch nach einem Fehler der Anfrage (bricht die Transaktion ab)
      try {
        req = arbeit(tx.objectStore(store));
      } catch (e) {
        // z. B. DataCloneError beim Speichern
        try { tx.abort(); } catch (e2) { /* schon beendet */ }
        resolve({ ok: false });
      }
    });
  }
  function vorgang(store, modus, arbeit) {
    return mitZeitlimit(ausfuehren(store, modus, arbeit, true), ZEIT_VORGANG_MS, { ok: false });
  }

  function istObjekt(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  function textOderNull(v) { return typeof v === 'string' && v ? v : null; }
  function jetztIso() { return new Date().toISOString(); }

  // ---------------------------------------------------------------------------
  // Öffentliche Schnittstelle
  // ---------------------------------------------------------------------------
  // → { paket, quelle, sha, uebernommen } | null
  async function ladeBasis() {
    try {
      var r = await vorgang('basis', 'readonly', function (s) { return s.get(SCHLUESSEL_BASIS); });
      var e = r.ok ? r.wert : null;
      return istObjekt(e) && istObjekt(e.paket) ? e : null;
    } catch (e) { return null; }
  }

  // e = { paket, quelle:'online'|'import', sha, uebernommen } → true|false. Ersetzt die vorige Basis.
  async function speichereBasis(e) {
    try {
      if (!istObjekt(e) || !istObjekt(e.paket)) return false;
      var eintrag = {
        paket: e.paket,
        quelle: typeof e.quelle === 'string' ? e.quelle : '',
        sha: textOderNull(e.sha),
        uebernommen: textOderNull(e.uebernommen) || jetztIso()
      };
      var r = await vorgang('basis', 'readwrite', function (s) { return s.put(eintrag, SCHLUESSEL_BASIS); });
      return r.ok === true;
    } catch (err) { return false; }
  }

  // → { sha, version, stand, geprueft } | null
  async function ladeOnline() {
    try {
      var r = await vorgang('online', 'readonly', function (s) { return s.get(SCHLUESSEL_ONLINE); });
      return r.ok && istObjekt(r.wert) ? r.wert : null;
    } catch (e) { return null; }
  }

  // o = { sha, version, stand, geprueft? } → true|false (geprueft fehlt → jetzt)
  async function speichereOnline(o) {
    try {
      if (!istObjekt(o)) return false;
      var eintrag = {
        sha: textOderNull(o.sha),
        version: textOderNull(o.version),
        stand: textOderNull(o.stand),
        geprueft: textOderNull(o.geprueft) || jetztIso()
      };
      var r = await vorgang('online', 'readwrite', function (s) { return s.put(eintrag, SCHLUESSEL_ONLINE); });
      return r.ok === true;
    } catch (err) { return false; }
  }

  // ---------------------------------------------------------------------------
  // Änderungsschicht (Teil 2)
  // ---------------------------------------------------------------------------
  function textOderLeer(v) { return typeof v === 'string' ? v : null; }
  // Nur die bekannten Felder, nur Text-Werte (exportiert, alt dürfen null sein); sonst null.
  function eintragSauber(e) {
    if (!istObjekt(e) || typeof e.dok !== 'string' || !e.dok || typeof e.k !== 'string' || !e.k || ARTEN.indexOf(e.art) < 0) return null;
    if (typeof e.neu !== 'string') return null;
    var k = istObjekt(e.konflikt) && typeof e.konflikt.online === 'string' ? { online: e.konflikt.online } :
      (istObjekt(e.konflikt) && e.konflikt.fehlt === true ? { fehlt: true } : null);
    return {
      dok: e.dok, k: e.k, art: e.art,
      alt: textOderLeer(e.alt), neu: e.neu, exportiert: textOderLeer(e.exportiert),
      zeit: textOderNull(e.zeit) || jetztIso(), konflikt: k
    };
  }
  function eintragSchluessel(e) { return 'e:' + e.dok + '\n' + e.art + '\n' + e.k; }

  // → { eintraege: [...], exporte: [...] } | null (ohne Store oder ohne IndexedDB)
  async function ladeAenderungen() {
    try {
      var db = await datenbank();
      if (!db || !db.objectStoreNames.contains(STORE_AENDERUNGEN)) return null;
      var r = await vorgang(STORE_AENDERUNGEN, 'readonly', function (s) {
        var alle = { werte: null, schluessel: null };
        var a = s.getAll(), b = s.getAllKeys();
        a.onsuccess = function () { alle.werte = a.result; };
        b.onsuccess = function () { alle.schluessel = b.result; };
        return { get result() { return alle; } };
      });
      if (!r.ok || !r.wert || !Array.isArray(r.wert.werte) || !Array.isArray(r.wert.schluessel)) return null;
      var eintraege = [], exporte = [];
      r.wert.schluessel.forEach(function (sl, i) {
        var w = r.wert.werte[i];
        if (sl === SCHLUESSEL_META) {
          if (istObjekt(w) && Array.isArray(w.exporte)) exporte = w.exporte.filter(function (f) { return typeof f === 'string' && f; });
          return;
        }
        var e = typeof sl === 'string' && sl.indexOf('e:') === 0 ? eintragSauber(w) : null;
        if (e) eintraege.push(e);
      });
      return { eintraege: eintraege, exporte: exporte };
    } catch (e) { return null; }
  }

  // Ersetzt die ganze Änderungsschicht in einer Transaktion (alles oder nichts) → true|false.
  // stand = { eintraege: [...], exporte: [...] }
  async function speichereAenderungen(stand) {
    try {
      if (!istObjekt(stand) || !Array.isArray(stand.eintraege)) return false;
      var eintraege = stand.eintraege.map(eintragSauber).filter(Boolean);
      var exporte = (Array.isArray(stand.exporte) ? stand.exporte : []).filter(function (f) { return typeof f === 'string' && f; });
      var db = await datenbank();
      if (!db || !db.objectStoreNames.contains(STORE_AENDERUNGEN)) return false;
      var r = await vorgang(STORE_AENDERUNGEN, 'readwrite', function (s) {
        s.clear();
        eintraege.forEach(function (e) { s.put(e, eintragSchluessel(e)); });
        return s.put({ exporte: exporte }, SCHLUESSEL_META);
      });
      return r.ok === true;
    } catch (err) { return false; }
  }

  // Dauerhaften Speicher anfragen (damit der Browser das Paket nicht bei Platzmangel löscht) → true, wenn dauerhaft
  async function persistAnfragen() {
    try {
      var st = navigator.storage;
      if (!st || typeof st.persist !== 'function') return false;
      if (typeof st.persisted === 'function' && (await mitZeitlimit(st.persisted(), ZEIT_OEFFNEN_MS, false)) === true) return true;
      return (await mitZeitlimit(st.persist(), ZEIT_VORGANG_MS, false)) === true;
    } catch (e) { return false; }
  }

  window.AetherFlyerSpeicher = Object.freeze({
    DB_NAME: DB_NAME,
    DB_VERSION: DB_VERSION,
    STORES: STORES,
    ladeBasis: ladeBasis,
    speichereBasis: speichereBasis,
    ladeOnline: ladeOnline,
    speichereOnline: speichereOnline,
    ladeAenderungen: ladeAenderungen,
    speichereAenderungen: speichereAenderungen,
    persistAnfragen: persistAnfragen
  });
})();
