// Flyer-Speicher für die Seite „Flyer & Infografiken“ (flyer.html): das zuletzt übernommene Flyer-Paket (Basis) und
// die zuletzt bekannte Online-Datei liegen in IndexedDB „aether-flyer“, damit die Seite offline startet.
// Gespeichert wird nur, was unten steht (Felder werden einzeln übernommen): nie das Token, nie API-Antworten im Ganzen.
// Alle Funktionen liefern ein Promise, das immer endet (Zeitlimit) und nie scheitert: fehlt IndexedDB oder geht etwas
// schief, gibt es null bzw. false. Die Verbindung wird erst beim ersten Zugriff geöffnet und schließt bei
// „versionchange“, damit eine neuere Seite die Datenbank aufrüsten kann.
// Version 2 (Teil 2): Store „aenderungen“ mit der Änderungsschicht (eigene Texte, Status, Stand je Dokument) und einem
// Meta-Eintrag (bisher exportierte Fassungen). Die Migration 1 → 2 legt nur den Store an; basis und online bleiben.
// Version 3 (F3a): Stores „struktur“ (lokaler Stand der Versionen, Ordner und Seiten samt offener Struktur-Konflikte)
// und „geraet“ (was sich nur dieses Gerät merkt, z. B. die geöffnete Version). Die Migration 2 → 3 gibt jedem Eintrag
// der Änderungsschicht die Version 1.1 (Feld ver, Schlüssel „e:<ver>\n<dok>\n<art>\n<k>“); basis (bleibt, wie es
// gespeichert wurde – ein v1-Paket wird erst beim Lesen in v2 umgewandelt), online und meta bleiben unverändert.
// Version 4 (F3b): Store „medien“ mit den Datei-Inhalten der Bibliothek (Blob, nie im Paket) und ihren Bildern:
// „d:<id>“ → { blob, sha, groesse, mime, zeit } (Inhalt), „b:<id>“ → Blob (Startbild bzw. Vorschau, höchstens 1600 px),
// „k:<id>“ → Blob (Mini-Bild für Kacheln, höchstens 360 px), „online“ → { geprueft, zugriff, liste: [{ sha, name, groesse }] }
// (zuletzt gelesene Liste von aether-medien/medien/, für die Status-Punkte offline). Die Migration 3 → 4 legt nur den
// Store an; alle anderen Stores bleiben unverändert.
(function () {
  'use strict';

  var DB_NAME = 'aether-flyer';
  var DB_VERSION = 4;
  var STORES = Object.freeze(['basis', 'online']);
  var SCHLUESSEL_BASIS = 'aktuell';  // Store basis:  { paket, quelle:'online'|'import', sha:String|null, uebernommen:ISO }
  var SCHLUESSEL_ONLINE = 'stand';   // Store online: { sha, version, stand, geprueft:ISO } – zuletzt bekannte Online-Datei
  // Store aenderungen: je Eintrag Schlüssel „e:<ver>\n<dok>\n<art>\n<k>“ → { ver, dok, k, art, alt, neu, exportiert, zeit, konflikt }
  // (konflikt: null oder { online, titel } bzw. { fehlt, titel } – offener Konflikt aus dem Abgleich), dazu „meta“ → { exporte: [Fassung …] }.
  var STORE_AENDERUNGEN = 'aenderungen';
  var SCHLUESSEL_META = 'meta';
  var ARTEN = ['text', 'status', 'stand'];
  var STANDARD_VERSION = '1.1';      // Einträge ohne ver (vor F3a) gehören zu Version 1.1
  // Store struktur: „lokal“ → { paket: v2-Paket|null (lokaler Stand; null = wie die Basis), konflikte: [...], exportiert: {...}|null }
  // Store geraet:   „version“ → Nummer der zuletzt geöffneten Version (nur dieses Gerät, nie im Paket)
  var STORE_STRUKTUR = 'struktur';
  var STORE_GERAET = 'geraet';
  var SCHLUESSEL_LOKAL = 'lokal';
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
        if (alt < 3) { db.createObjectStore('struktur'); db.createObjectStore('geraet'); verschiebeAufVersion(req.transaction); }
        if (alt < 4) db.createObjectStore('medien');   // F3b: Datei-Inhalte und Bilder der Bibliothek (sonst bleibt alles)
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

  // Migration 2 → 3 (in der Upgrade-Transaktion): Einträge „e:<dok>\n<art>\n<k>“ ohne ver → ver 1.1 unter dem neuen
  // Schlüssel. Andere Schlüssel (meta) und schon versionierte Einträge bleiben, wie sie sind.
  function verschiebeAufVersion(tx) {
    try {
      var st = tx.objectStore('aenderungen');
      var c = st.openCursor();
      c.onsuccess = function () {
        var cur = c.result;
        if (!cur) return;
        var k = cur.key, w = cur.value;
        if (typeof k === 'string' && k.indexOf('e:') === 0 && istObjekt(w) && typeof w.ver !== 'string' && k.split('\n').length === 3) {
          var neu = Object.assign({}, w, { ver: STANDARD_VERSION });
          st.put(neu, 'e:' + STANDARD_VERSION + '\n' + k.slice(2));
          cur.delete();
        }
        cur.continue();
      };
    } catch (e) { /* ohne Store aenderungen (frisch angelegt) nichts zu tun */ }
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
  // Schreib-Transaktion über mehrere Stores: arbeit(tx) legt alle Anfragen an; alles oder nichts (Fehler einer
  // Anfrage oder Ausnahme in arbeit bricht die ganze Transaktion ab). → { ok:Boolean } | null (keine Datenbank/Stores)
  async function ausfuehrenMehrere(stores, arbeit, nochmal) {
    var p = datenbank();
    var db = await p;
    if (!db || stores.some(function (n) { return !db.objectStoreNames.contains(n); })) return null;
    var tx;
    try {
      tx = db.transaction(stores, 'readwrite', { durability: 'strict' });
    } catch (e) {
      vergiss(p);
      try { db.close(); } catch (e2) { /* egal */ }
      return nochmal ? ausfuehrenMehrere(stores, arbeit, false) : { ok: false };
    }
    return new Promise(function (resolve) {
      tx.oncomplete = function () { resolve({ ok: true }); };
      tx.onabort = function () { resolve({ ok: false }); };
      try { arbeit(tx); } catch (e) {
        try { tx.abort(); } catch (e2) { /* schon beendet */ }
        resolve({ ok: false });
      }
    });
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

  // Basis-Eintrag mit nur den bekannten Feldern (null bei falschem Typ)
  function basisEintrag(e) {
    if (!istObjekt(e) || !istObjekt(e.paket)) return null;
    return {
      paket: e.paket,
      quelle: typeof e.quelle === 'string' ? e.quelle : '',
      sha: textOderNull(e.sha),
      uebernommen: textOderNull(e.uebernommen) || jetztIso()
    };
  }
  // e = { paket, quelle:'online'|'import', sha, uebernommen } → true|false. Ersetzt die vorige Basis.
  async function speichereBasis(e) {
    try {
      var eintrag = basisEintrag(e);
      if (!eintrag) return false;
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
    var ver = typeof e.ver === 'string' && /^[1-9]\d*\.[1-9]\d*$/.test(e.ver) ? e.ver : STANDARD_VERSION;
    if (typeof e.neu !== 'string') return null;
    var k = istObjekt(e.konflikt) && typeof e.konflikt.online === 'string' ? { online: e.konflikt.online } :
      (istObjekt(e.konflikt) && e.konflikt.fehlt === true ? { fehlt: true } : null);
    if (k && typeof e.konflikt.titel === 'string') k.titel = e.konflikt.titel;   // Titel des Dokuments beim Abgleich
    return {
      ver: ver, dok: e.dok, k: e.k, art: e.art,
      alt: textOderLeer(e.alt), neu: e.neu, exportiert: textOderLeer(e.exportiert),
      zeit: textOderNull(e.zeit) || jetztIso(), konflikt: k
    };
  }
  function eintragSchluessel(e) { return 'e:' + e.ver + '\n' + e.dok + '\n' + e.art + '\n' + e.k; }

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

  // Änderungsschicht bereinigen → { eintraege, exporte } | null
  function schichtSauber(stand) {
    if (!istObjekt(stand) || !Array.isArray(stand.eintraege)) return null;
    return {
      eintraege: stand.eintraege.map(eintragSauber).filter(Boolean),
      exporte: (Array.isArray(stand.exporte) ? stand.exporte : []).filter(function (f) { return typeof f === 'string' && f; })
    };
  }
  // Ganze Schicht in den Store schreiben (in einer laufenden Transaktion) → letzte Anfrage
  function schichtSchreiben(s, sauber) {
    s.clear();
    sauber.eintraege.forEach(function (e) { s.put(e, eintragSchluessel(e)); });
    return s.put({ exporte: sauber.exporte }, SCHLUESSEL_META);
  }
  // Ersetzt die ganze Änderungsschicht in einer Transaktion (alles oder nichts) → true|false.
  // stand = { eintraege: [...], exporte: [...] }
  async function speichereAenderungen(stand) {
    try {
      var sauber = schichtSauber(stand);
      if (!sauber) return false;
      var db = await datenbank();
      if (!db || !db.objectStoreNames.contains(STORE_AENDERUNGEN)) return false;
      var r = await vorgang(STORE_AENDERUNGEN, 'readwrite', function (s) { return schichtSchreiben(s, sauber); });
      return r.ok === true;
    } catch (err) { return false; }
  }

  // Abgleich in einem Schritt: neue Basis und angeglichene Änderungsschicht in EINER Transaktion über die Stores
  // „basis“ und „aenderungen“ – scheitert sie, bleiben beide auf dem alten Stand.
  // → true (beides gespeichert) | false (Transaktion gescheitert, nichts geändert) | null (kein IndexedDB bzw. Stores
  // fehlen: die Seite läuft dann wie bisher ohne Offline-Speicher)
  async function speichereBasisUndAenderungen(basis, stand) {
    try {
      var eintrag = basisEintrag(basis), sauber = schichtSauber(stand);
      if (!eintrag || !sauber) return false;
      var r = await mitZeitlimit(ausfuehrenMehrere(['basis', STORE_AENDERUNGEN], function (tx) {
        tx.objectStore('basis').put(eintrag, SCHLUESSEL_BASIS);
        schichtSchreiben(tx.objectStore(STORE_AENDERUNGEN), sauber);
      }, true), ZEIT_VORGANG_MS, { ok: false });
      return r === null ? null : r.ok === true;
    } catch (err) { return false; }
  }

  // ---------------------------------------------------------------------------
  // Struktur und Gerät (F3a)
  // ---------------------------------------------------------------------------
  async function hatStore(name) {
    var db = await datenbank();
    return !!db && db.objectStoreNames.contains(name);
  }
  // → { paket, konflikte, exportiert } | null
  async function ladeStruktur() {
    try {
      if (!(await hatStore(STORE_STRUKTUR))) return null;
      var r = await vorgang(STORE_STRUKTUR, 'readonly', function (s) { return s.get(SCHLUESSEL_LOKAL); });
      var w = r.ok ? r.wert : null;
      if (!istObjekt(w)) return null;
      return {
        paket: istObjekt(w.paket) ? w.paket : null,
        konflikte: Array.isArray(w.konflikte) ? w.konflikte.filter(istObjekt) : [],
        exportiert: istObjekt(w.exportiert) ? w.exportiert : null
      };
    } catch (e) { return null; }
  }
  // s = { paket: v2|null, konflikte: [...], exportiert: {...}|null } → true|false
  async function speichereStruktur(s) {
    try {
      if (!istObjekt(s) || (s.paket !== null && !istObjekt(s.paket))) return false;
      if (!(await hatStore(STORE_STRUKTUR))) return false;
      var eintrag = {
        paket: s.paket,
        konflikte: Array.isArray(s.konflikte) ? s.konflikte : [],
        exportiert: istObjekt(s.exportiert) ? s.exportiert : null
      };
      var r = await vorgang(STORE_STRUKTUR, 'readwrite', function (st) { return st.put(eintrag, SCHLUESSEL_LOKAL); });
      return r.ok === true;
    } catch (e) { return false; }
  }
  // Nur dieses Gerät: einfache Texte (z. B. „version“ → „1.2“) → Text | null
  async function ladeGeraet(name) {
    try {
      if (!(await hatStore(STORE_GERAET))) return null;
      var r = await vorgang(STORE_GERAET, 'readonly', function (s) { return s.get(String(name)); });
      return r.ok && typeof r.wert === 'string' ? r.wert : null;
    } catch (e) { return null; }
  }
  async function speichereGeraet(name, wert) {
    try {
      if (typeof wert !== 'string' || !(await hatStore(STORE_GERAET))) return false;
      var r = await vorgang(STORE_GERAET, 'readwrite', function (s) { return s.put(wert, String(name)); });
      return r.ok === true;
    } catch (e) { return false; }
  }

  // ---------------------------------------------------------------------------
  // Bibliothek (F3b): Datei-Inhalte und Bilder
  // ---------------------------------------------------------------------------
  var STORE_MEDIEN = 'medien';
  // Selbst gewählt: große Dateien brauchen länger – 10 s plus 1 s je angefangene 5 MB (500 MB → 110 s)
  function fristFuer(bytes) { return ZEIT_VORGANG_MS + Math.ceil(Math.max(0, Number(bytes) || 0) / (5 * 1024 * 1024)) * 1000; }
  function istKennung(id) { return typeof id === 'string' && /^m[1-9]\d*$/.test(id); }
  function istBlob(b) { return typeof Blob === 'function' && b instanceof Blob; }
  async function medienVorgang(modus, arbeit, frist) {
    if (!(await hatStore(STORE_MEDIEN))) return { ok: false };
    return mitZeitlimit(ausfuehren(STORE_MEDIEN, modus, arbeit, true), frist || ZEIT_VORGANG_MS, { ok: false });
  }
  // → { blob, sha, groesse, mime, zeit } | null
  async function ladeMedienInhalt(id) {
    try {
      if (!istKennung(id)) return null;
      var r = await medienVorgang('readonly', function (s) { return s.get('d:' + id); });
      var w = r.ok ? r.wert : null;
      return istObjekt(w) && istBlob(w.blob) ? w : null;
    } catch (e) { return null; }
  }
  // e = { blob, sha, mime } → true|false
  async function speichereMedienInhalt(id, e) {
    try {
      if (!istKennung(id) || !istObjekt(e) || !istBlob(e.blob)) return false;
      var eintrag = { blob: e.blob, sha: textOderNull(e.sha), groesse: e.blob.size, mime: textOderNull(e.mime) || e.blob.type || '', zeit: jetztIso() };
      var r = await medienVorgang('readwrite', function (s) { return s.put(eintrag, 'd:' + id); }, fristFuer(e.blob.size));
      return r.ok === true;
    } catch (err) { return false; }
  }
  // art 'b' (Startbild/Vorschau) oder 'k' (Mini) → Blob | null
  async function ladeMedienBild(id, art) {
    try {
      if (!istKennung(id) || (art !== 'b' && art !== 'k')) return null;
      var r = await medienVorgang('readonly', function (s) { return s.get(art + ':' + id); });
      return r.ok && istBlob(r.wert) ? r.wert : null;
    } catch (e) { return null; }
  }
  // bilder = { b: Blob|null, k: Blob|null } → true|false (null entfernt das Bild)
  async function speichereMedienBilder(id, bilder) {
    try {
      if (!istKennung(id) || !istObjekt(bilder)) return false;
      var r = await medienVorgang('readwrite', function (s) {
        var letzte;
        ['b', 'k'].forEach(function (a) {
          if (!(a in bilder)) return;
          letzte = istBlob(bilder[a]) ? s.put(bilder[a], a + ':' + id) : s.delete(a + ':' + id);
        });
        return letzte;
      });
      return r.ok === true;
    } catch (e) { return false; }
  }
  // Inhalt und Bilder einer Datei entfernen → true|false
  async function entferneMedium(id) {
    try {
      if (!istKennung(id)) return false;
      var r = await medienVorgang('readwrite', function (s) { s.delete('d:' + id); s.delete('b:' + id); return s.delete('k:' + id); });
      return r.ok === true;
    } catch (e) { return false; }
  }
  // Kennungen mit Inhalt auf dem Gerät → [id] | null (ohne Store)
  async function medienAufGeraet() {
    try {
      var r = await medienVorgang('readonly', function (s) { return s.getAllKeys(); });
      if (!r.ok || !Array.isArray(r.wert)) return null;
      return r.wert.filter(function (k) { return typeof k === 'string' && k.indexOf('d:') === 0; }).map(function (k) { return k.slice(2); });
    } catch (e) { return null; }
  }
  // Zuletzt gelesene Liste von aether-medien (ohne Token, nur sha, Name, Größe)
  async function ladeMedienOnline() {
    try {
      var r = await medienVorgang('readonly', function (s) { return s.get('online'); });
      var w = r.ok ? r.wert : null;
      if (!istObjekt(w)) return null;
      return {
        geprueft: textOderNull(w.geprueft), zugriff: w.zugriff === 'kein' ? 'kein' : 'ok',
        liste: Array.isArray(w.liste) ? w.liste.filter(function (x) { return istObjekt(x) && typeof x.sha === 'string'; }) : []
      };
    } catch (e) { return null; }
  }
  async function speichereMedienOnline(o) {
    try {
      if (!istObjekt(o)) return false;
      var eintrag = {
        geprueft: textOderNull(o.geprueft) || jetztIso(), zugriff: o.zugriff === 'kein' ? 'kein' : 'ok',
        liste: (Array.isArray(o.liste) ? o.liste : []).filter(istObjekt).map(function (x) {
          return { sha: String(x.sha), name: typeof x.name === 'string' ? x.name : '', groesse: typeof x.groesse === 'number' ? x.groesse : null };
        })
      };
      var r = await medienVorgang('readwrite', function (s) { return s.put(eintrag, 'online'); });
      return r.ok === true;
    } catch (e) { return false; }
  }
  // Belegter und freier Platz (navigator.storage.estimate) → { belegt, frei, quote } | null
  async function platz() {
    try {
      var st = navigator.storage;
      if (!st || typeof st.estimate !== 'function') return null;
      var e = await mitZeitlimit(st.estimate(), ZEIT_OEFFNEN_MS, null);
      if (!e || typeof e.quota !== 'number') return null;
      var belegt = typeof e.usage === 'number' ? e.usage : 0;
      return { belegt: belegt, quote: e.quota, frei: Math.max(0, e.quota - belegt) };
    } catch (e) { return null; }
  }
  async function istDauerhaft() {
    try {
      var st = navigator.storage;
      if (!st || typeof st.persisted !== 'function') return null;
      return (await mitZeitlimit(st.persisted(), ZEIT_OEFFNEN_MS, null)) === true;
    } catch (e) { return null; }
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
    speichereBasisUndAenderungen: speichereBasisUndAenderungen,
    ladeStruktur: ladeStruktur,
    speichereStruktur: speichereStruktur,
    ladeGeraet: ladeGeraet,
    speichereGeraet: speichereGeraet,
    persistAnfragen: persistAnfragen,
    // F3b: Bibliothek
    ladeMedienInhalt: ladeMedienInhalt,
    speichereMedienInhalt: speichereMedienInhalt,
    ladeMedienBild: ladeMedienBild,
    speichereMedienBilder: speichereMedienBilder,
    entferneMedium: entferneMedium,
    medienAufGeraet: medienAufGeraet,
    ladeMedienOnline: ladeMedienOnline,
    speichereMedienOnline: speichereMedienOnline,
    platz: platz,
    istDauerhaft: istDauerhaft
  });
})();
