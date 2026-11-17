// Flyer-Speicher für die Seite „Flyer & Infografiken“ (flyer.html): das zuletzt übernommene Flyer-Paket (Basis) und
// die zuletzt bekannte Online-Datei liegen in IndexedDB „aether-flyer“, damit die Seite offline startet.
// Gespeichert wird nur, was unten steht (Felder werden einzeln übernommen): nie das Token, nie API-Antworten im Ganzen.
// Alle Funktionen liefern ein Promise, das immer endet (Zeitlimit) und nie scheitert: fehlt IndexedDB oder geht etwas
// schief, gibt es null bzw. false. Die Verbindung wird erst beim ersten Zugriff geöffnet und schließt bei
// „versionchange“, damit eine neuere Seite (Teil 2) die Datenbank aufrüsten kann.
(function () {
  'use strict';

  var DB_NAME = 'aether-flyer';
  var DB_VERSION = 1;
  var STORES = Object.freeze(['basis', 'online']);
  var SCHLUESSEL_BASIS = 'aktuell';  // Store basis:  { paket, quelle:'online'|'import', sha:String|null, uebernommen:ISO }
  var SCHLUESSEL_ONLINE = 'stand';   // Store online: { sha, version, stand, geprueft:ISO } – zuletzt bekannte Online-Datei
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
        // Teil 2: if (alt < 2) db.createObjectStore('aenderungen', …) – Änderungsschicht; DB_VERSION auf 2.
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
    persistAnfragen: persistAnfragen
  });
})();
