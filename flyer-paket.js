// Flyer-Paket für die Seite „Flyer & Infografiken“ (flyer.html): Format lesen und prüfen, Versionen vergleichen und
// alle Inhalte eines Pakets bereinigen (Rahmen 5), bevor sie angezeigt werden. Reine Funktionen ohne Zustand; DOM
// nur über DOMParser (fremdes, inaktives Dokument) – nie innerHTML o. Ä. im Dokument der Seite.
// Ziel der Bereinigung: Nichts aus einem Paket führt Code aus oder lädt etwas aus dem Netz.
//   HTML: ohne script, iframe, object, link, meta, base, form, template … und SVG-Animationen auf href/src; ohne
//         on*-Attribute; href/src nur „#…“ oder „data:image/…“ (Links nur „#…“); url() in Attributen nur „#…“/„data:“.
//   CSS:  ohne Kommentare und @import; url()/src()/image-set()/image()/cross-fade() nur auf „data:…“ und „fonts/…“
//         (ohne „..“), sonst wird die ganze Funktion zu „none“. „#…“ (lokaler Verweis, z. B. SVG-Verlauf url(#g)) nur in
//         den Eigenschaften fill, stroke, clip-path, filter und marker*: Dort lädt der Browser nichts; in anderen
//         (background-image, content, border-image, list-style-image, shape-outside …) holt Chromium für url(#x) die
//         Seite selbst noch einmal (geprüft) – das wäre eine Netzanfrage.
// Zusätzlich sichert die Content-Security-Policy von flyer.html ab. Das Token kommt hier nie vor.
(function () {
  'use strict';

  var FORMAT = 'aether-flyer-paket';
  var FORMAT_VERSION = 1;
  var DATEI = 'aether-flyer-paket.json';

  // AppError aus gemeinsam.js (wird vorher geladen); ohne gemeinsam.js ein gleich gebauter Error.
  function fehler(kind, title, text) {
    var G = window.AetherGemeinsam;
    if (G && typeof G.AppError === 'function') return new G.AppError(kind, title, text);
    var e = new Error(title); e.kind = kind; e.title = title; e.text = text || '';
    return e;
  }
  function formatFehler(grund) { return fehler('format', 'Paket fehlerhaft.', grund); }

  // Gefundenen Wert für Fehlertexte kurz zeigen
  function kurz(v) {
    var t;
    if (v === undefined) t = '';
    else if (typeof v === 'string') t = v;
    else { try { t = JSON.stringify(v); } catch (e) { t = String(v); } }
    t = String(t).replace(/[\u0000-\u001f\u007f]/g, ' ');
    return t.length > 60 ? t.slice(0, 59) + '…' : t;
  }
  function istObjekt(v) { return v !== null && typeof v === 'object' && !Array.isArray(v); }
  // Nur ASCII-Buchstaben klein (CSS vergleicht Namen „ASCII case-insensitive“)
  function kleinAscii(t) { return String(t).replace(/[A-Z]/g, function (c) { return String.fromCharCode(c.charCodeAt(0) + 32); }); }

  // ---------------------------------------------------------------------------
  // Datum und Version
  // ---------------------------------------------------------------------------
  function gueltigerTag(j, m, t) {
    if (m < 1 || m > 12 || t < 1) return false;
    return t <= new Date(Date.UTC(j, m, 0)).getUTCDate();
  }
  function istIsoTag(v) {
    var m = typeof v === 'string' ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(v) : null;
    return !!m && gueltigerTag(Number(m[1]), Number(m[2]), Number(m[3]));
  }
  // '2026-11-17' → '17.11.2026'; alles andere bleibt unverändert
  function datum(isoTag) {
    if (isoTag === undefined || isoTag === null) return '';
    var t = String(isoTag);
    if (!istIsoTag(t)) return t;
    return t.slice(8, 10) + '.' + t.slice(5, 7) + '.' + t.slice(0, 4);
  }

  // Version „YYYY-MM-DD.n“ (n fehlt = 0). Nicht lesbar: nur das Datum vom Anfang zählt, ohne Datum ist nichts lesbar.
  function zerlegeVersion(v) {
    var t = String(v === undefined || v === null ? '' : v).trim();
    var m = /^(\d{4}-\d{2}-\d{2})(?:\.(\d+))?$/.exec(t);
    if (m) return { datum: m[1], n: (m[2] || '0').replace(/^0+(?=\d)/, ''), voll: true };
    m = /^(\d{4}-\d{2}-\d{2})/.exec(t);
    return m ? { datum: m[1], n: '0', voll: false } : null;
  }
  // Ganze Zahlen als Ziffernfolgen vergleichen (auch sehr lange, ohne Rundung)
  function vergleicheZiffern(a, b) {
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a === b ? 0 : (a < b ? -1 : 1);
  }
  // → -1 (a älter), 0 (gleich oder nicht vergleichbar), 1 (a neuer)
  function vergleicheVersion(a, b) {
    var x = zerlegeVersion(a), y = zerlegeVersion(b);
    if (!x || !y) return 0;
    if (x.datum !== y.datum) return x.datum < y.datum ? -1 : 1;
    if (!x.voll || !y.voll) return 0;
    return vergleicheZiffern(x.n, y.n);
  }

  // ---------------------------------------------------------------------------
  // Format lesen und prüfen
  // ---------------------------------------------------------------------------
  function lies(text) {
    if (typeof text !== 'string') throw fehler('format', 'Datei ist kein gültiges JSON.', 'Die Datei enthält keinen Text.');
    var obj;
    try {
      obj = JSON.parse(text.replace(/^\uFEFF/, ''));
    } catch (e) {
      var grund = e && e.message ? String(e.message) : '';
      if (grund.length > 160) grund = grund.slice(0, 159) + '…';
      throw fehler('format', 'Datei ist kein gültiges JSON.', 'Die Datei lässt sich nicht als JSON lesen' + (grund ? ' (' + grund + ')' : '') + '.');
    }
    return pruefe(obj);
  }

  // Text-Feld prüfen: fehlt → „… fehlt“, falscher Typ → „… muss ein Text sein“
  function pruefeText(wert, wo, leerErlaubt) {
    if (wert === undefined) throw formatFehler(wo + ' fehlt');
    if (typeof wert !== 'string') throw formatFehler(wo + ' muss ein Text sein (gefunden: „' + kurz(wert) + '“)');
    if (!leerErlaubt && !wert.trim()) throw formatFehler(wo + ' ist leer');
  }

  // Prüft ein gelesenes Paket und gibt es unverändert zurück (unbekannte Felder werden ignoriert).
  function pruefe(obj) {
    var format = istObjekt(obj) ? obj.format : undefined;
    if (format !== FORMAT) {
      throw fehler('format', 'Kein Aether-Flyer-Paket.', 'Erwartet wird format „' + FORMAT + '“ (gefunden: „' + kurz(format) + '“).');
    }
    var fv = obj.formatVersion;
    if (typeof fv !== 'number' || !Number.isInteger(fv) || fv < 1) {
      throw formatFehler('formatVersion muss eine ganze Zahl ab 1 sein (gefunden: „' + kurz(fv) + '“' + (typeof fv === 'string' ? ' als Text' : '') + ')');
    }
    if (fv > FORMAT_VERSION) {
      throw fehler('zuneu', 'Paket zu neu', 'Das Paket hat formatVersion ' + fv + '; diese Seite kennt Version ' + FORMAT_VERSION + '. Bitte das Dashboard aktualisieren.');
    }

    pruefeText(obj.version, 'version', false);
    if (obj.stand === undefined) throw formatFehler('stand fehlt');
    if (!istIsoTag(obj.stand)) throw formatFehler('stand muss ein Datum JJJJ-MM-TT sein (gefunden: „' + kurz(obj.stand) + '“)');

    if (obj.css === undefined) throw formatFehler('css fehlt');
    if (!istObjekt(obj.css)) throw formatFehler('css muss ein Objekt sein (mit flyer und infografik)');
    ['flyer', 'infografik'].forEach(function (art) {
      var c = obj.css[art];
      if (c !== undefined && typeof c !== 'string') throw formatFehler('css.' + art + ' muss ein Text sein (gefunden: „' + kurz(c) + '“)');
    });

    if (obj.kategorien === undefined) throw formatFehler('kategorien fehlt');
    if (!Array.isArray(obj.kategorien)) throw formatFehler('kategorien muss eine Liste sein');
    obj.kategorien.forEach(function (k, i) {
      var wo = 'Kategorie ' + (i + 1);
      if (!istObjekt(k)) throw formatFehler(wo + ': kein Objekt');
      pruefeText(k.id, wo + ': id', false);
      pruefeText(k.name, wo + ': name', true);
    });

    if (obj.dokumente === undefined) throw formatFehler('dokumente fehlt');
    if (!Array.isArray(obj.dokumente)) throw formatFehler('dokumente muss eine Liste sein');
    if (!obj.dokumente.length) throw formatFehler('dokumente ist leer (mindestens ein Dokument nötig)');
    var ids = new Map();
    obj.dokumente.forEach(function (d, i) {
      var wo = 'Dokument ' + (i + 1);
      if (!istObjekt(d)) throw formatFehler(wo + ': kein Objekt');
      pruefeText(d.id, wo + ': id', false);
      if (ids.has(d.id)) throw formatFehler(wo + ': id „' + kurz(d.id) + '“ kommt doppelt vor (auch Dokument ' + ids.get(d.id) + ')');
      ids.set(d.id, i + 1);
      if (d.art === undefined) throw formatFehler(wo + ': art fehlt');
      if (d.art !== 'flyer' && d.art !== 'infografik') throw formatFehler(wo + ': art muss „flyer“ oder „infografik“ sein (gefunden: „' + kurz(d.art) + '“)');
      pruefeText(d.kategorie, wo + ': kategorie', true);
      pruefeText(d.titel, wo + ': titel', true);
      if (d.breite === undefined) throw formatFehler(wo + ': breite fehlt');
      if (typeof d.breite !== 'number' || !isFinite(d.breite) || d.breite <= 0) throw formatFehler(wo + ': breite muss eine Zahl größer 0 sein (gefunden: „' + kurz(d.breite) + '“)');
      // hoehe: Zahl > 0 oder null (Infografik: Höhe ergibt sich aus dem Inhalt); fehlend gilt wie null
      if (d.hoehe !== undefined && d.hoehe !== null && (typeof d.hoehe !== 'number' || !isFinite(d.hoehe) || d.hoehe <= 0)) {
        throw formatFehler(wo + ': hoehe muss eine Zahl größer 0 oder null sein (gefunden: „' + kurz(d.hoehe) + '“)');
      }
      pruefeText(d.html, wo + ': html', false);
    });
    return obj;
  }

  // ---------------------------------------------------------------------------
  // CSS-Scanner nach CSS Syntax Level 3 (§4 Tokenisierung) – genau an den Stellen, auf die es für die Sicherheit
  // ankommt: Strings (enden auch an einem Zeilenumbruch), Kommentare, Escapes in Namen (\75 rl( = url(), url-Token
  // samt „bad url“, Klammern und Blöcke. Arbeitet auf dem unveränderten Text (\r\n, \r, \f = Zeilenumbruch, NUL wie
  // U+FFFD), damit die Ausgabe außerhalb der Änderungen wörtlich bleibt.
  // Token: { t: Art, a: Anfang, e: Ende (exklusiv), w: Wert (Namen/Strings/URL mit aufgelösten Escapes), zu: geschlossen }
  // Arten: leer, kommentar, string, badstring, url, badurl, funktion, name, at, hash, zahl, zeichen, cdo, cdc,
  //        ( ) [ ] { } , : ;
  // ---------------------------------------------------------------------------
  function istZiffer(c) { return c >= 48 && c <= 57; }
  function istHex(c) { return istZiffer(c) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102); }
  function istUmbruch(c) { return c === 10 || c === 13 || c === 12; }
  function istLeer(c) { return c === 10 || c === 13 || c === 12 || c === 9 || c === 32; }
  function istNamensStart(c) { return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c >= 128 || c === 0; }
  function istNamensZeichen(c) { return istNamensStart(c) || istZiffer(c) || c === 45; }
  function istNichtDruckbar(c) { return (c >= 1 && c <= 8) || c === 11 || (c >= 14 && c <= 31) || c === 127; }

  function tokenisiere(s) {
    var n = s.length, tk = [];
    function cc(i) { return i < n ? s.charCodeAt(i) : -1; }
    function gueltigesEscape(i) { return cc(i) === 92 && !istUmbruch(cc(i + 1)); }
    function leerLaenge(i) { return cc(i) === 13 && cc(i + 1) === 10 ? 2 : 1; }
    function neu(t, a, e, w, zu) { tk.push({ t: t, a: a, e: e, w: w === undefined ? '' : w, zu: zu !== false }); return e; }

    // i zeigt hinter den Backslash
    function liesEscape(i) {
      var c = cc(i);
      if (c === -1) return { z: '\uFFFD', e: i };
      if (istHex(c)) {
        var j = i;
        while (j < n && j - i < 6 && istHex(cc(j))) j++;
        var wert = parseInt(s.slice(i, j), 16);
        if (istLeer(cc(j))) j += leerLaenge(j);
        if (wert === 0 || (wert >= 0xd800 && wert <= 0xdfff) || wert > 0x10ffff) wert = 0xfffd;
        return { z: String.fromCodePoint(wert), e: j };
      }
      var cp = s.codePointAt(i);
      return { z: c === 0 ? '\uFFFD' : String.fromCodePoint(cp), e: i + (cp > 0xffff ? 2 : 1) };
    }
    function liesName(i) {
      var w = '';
      for (;;) {
        var c = cc(i);
        if (istNamensZeichen(c)) { w += c === 0 ? '\uFFFD' : s[i]; i++; }
        else if (gueltigesEscape(i)) { var r = liesEscape(i + 1); w += r.z; i = r.e; }
        else return { w: w, e: i };
      }
    }
    function startetName(i) {
      var c1 = cc(i), c2 = cc(i + 1);
      if (c1 === 45) return istNamensStart(c2) || c2 === 45 || gueltigesEscape(i + 1);
      if (istNamensStart(c1)) return true;
      return gueltigesEscape(i);
    }
    function startetZahl(i) {
      var c1 = cc(i), c2 = cc(i + 1);
      if (c1 === 43 || c1 === 45) return istZiffer(c2) || (c2 === 46 && istZiffer(cc(i + 2)));
      if (c1 === 46) return istZiffer(c2);
      return istZiffer(c1);
    }
    function liesZahl(i) {
      if (cc(i) === 43 || cc(i) === 45) i++;
      while (istZiffer(cc(i))) i++;
      if (cc(i) === 46 && istZiffer(cc(i + 1))) { i += 2; while (istZiffer(cc(i))) i++; }
      var c = cc(i), c2 = cc(i + 1);
      if ((c === 69 || c === 101) && (istZiffer(c2) || ((c2 === 43 || c2 === 45) && istZiffer(cc(i + 2))))) {
        i += istZiffer(c2) ? 1 : 2;
        while (istZiffer(cc(i))) i++;
      }
      if (startetName(i)) return liesName(i).e;
      if (cc(i) === 37) return i + 1;
      return i;
    }
    // i zeigt auf das öffnende Anführungszeichen q
    function liesString(i, q) {
      var w = '';
      i++;
      for (;;) {
        var c = cc(i);
        if (c === q) return { t: 'string', e: i + 1, w: w, zu: true };
        if (c === -1) return { t: 'string', e: i, w: w, zu: false };
        if (istUmbruch(c)) return { t: 'badstring', e: i, w: w, zu: false }; // Zeilenumbruch gehört nicht dazu
        if (c === 92) {
          var c2 = cc(i + 1);
          if (c2 === -1) { i++; continue; }
          if (istUmbruch(c2)) { i += 1 + leerLaenge(i + 1); continue; }
          var r = liesEscape(i + 1); w += r.z; i = r.e; continue;
        }
        w += c === 0 ? '\uFFFD' : s[i]; i++;
      }
    }
    // Rest einer ungültigen URL bis „)“ (Escapes beachten, Anführungszeichen zählen hier nicht)
    function resteUrl(i) {
      for (;;) {
        var c = cc(i);
        if (c === 41) return { t: 'badurl', e: i + 1, w: '', zu: true };
        if (c === -1) return { t: 'badurl', e: i, w: '', zu: false };
        if (gueltigesEscape(i)) i = liesEscape(i + 1).e; else i++;
      }
    }
    // unquotiertes url(…) – i zeigt hinter „url(“
    function liesUrl(i) {
      var w = '';
      while (istLeer(cc(i))) i++;
      for (;;) {
        var c = cc(i);
        if (c === 41) return { t: 'url', e: i + 1, w: w, zu: true };
        if (c === -1) return { t: 'url', e: i, w: w, zu: false };
        if (istLeer(c)) {
          while (istLeer(cc(i))) i++;
          if (cc(i) === 41) return { t: 'url', e: i + 1, w: w, zu: true };
          if (cc(i) === -1) return { t: 'url', e: i, w: w, zu: false };
          return resteUrl(i);
        }
        if (c === 34 || c === 39 || c === 40 || istNichtDruckbar(c)) return resteUrl(i);
        if (c === 92) {
          if (!gueltigesEscape(i)) return resteUrl(i);
          var r = liesEscape(i + 1); w += r.z; i = r.e; continue;
        }
        w += c === 0 ? '\uFFFD' : s[i]; i++;
      }
    }
    function nameArtig(a) {
      var r = liesName(a);
      if (cc(r.e) !== 40) return neu('name', a, r.e, r.w);
      if (kleinAscii(r.w) === 'url') {
        var j = r.e + 1;
        while (istLeer(cc(j)) && istLeer(cc(j + 1))) j++;
        var c1 = cc(j), c2 = cc(j + 1);
        if (c1 === 34 || c1 === 39 || (istLeer(c1) && (c2 === 34 || c2 === 39))) return neu('funktion', a, j, r.w);
        var u = liesUrl(j);
        return neu(u.t, a, u.e, u.w, u.zu);
      }
      return neu('funktion', a, r.e + 1, r.w);
    }

    var EINZELN = { 40: '(', 41: ')', 91: '[', 93: ']', 123: '{', 125: '}', 44: ',', 58: ':', 59: ';' };
    var i = 0;
    while (i < n) {
      var c = cc(i), a = i, r;
      if (c === 47 && cc(i + 1) === 42) {
        var ende = s.indexOf('*/', i + 2);
        i = neu('kommentar', a, ende < 0 ? n : ende + 2, '', ende >= 0);
      } else if (istLeer(c)) {
        while (istLeer(cc(i))) i++;
        neu('leer', a, i);
      } else if (c === 34 || c === 39) {
        r = liesString(i, c); i = neu(r.t, a, r.e, r.w, r.zu);
      } else if (c === 35) {
        if (istNamensZeichen(cc(i + 1)) || gueltigesEscape(i + 1)) { r = liesName(i + 1); i = neu('hash', a, r.e, r.w); }
        else i = neu('zeichen', a, i + 1, '#');
      } else if (EINZELN[c]) {
        i = neu(EINZELN[c], a, i + 1);
      } else if (c === 43 || c === 46) {
        i = startetZahl(i) ? neu('zahl', a, liesZahl(i)) : neu('zeichen', a, i + 1, s[i]);
      } else if (c === 45) {
        if (startetZahl(i)) i = neu('zahl', a, liesZahl(i));
        else if (cc(i + 1) === 45 && cc(i + 2) === 62) i = neu('cdc', a, i + 3);
        else if (startetName(i)) i = nameArtig(i);
        else i = neu('zeichen', a, i + 1, '-');
      } else if (c === 60) {
        i = s.startsWith('!--', i + 1) ? neu('cdo', a, i + 4) : neu('zeichen', a, i + 1, '<');
      } else if (c === 64) {
        if (startetName(i + 1)) { r = liesName(i + 1); i = neu('at', a, r.e, r.w); }
        else i = neu('zeichen', a, i + 1, '@');
      } else if (c === 92) {
        i = gueltigesEscape(i) ? nameArtig(i) : neu('zeichen', a, i + 1, '\\');
      } else if (istZiffer(c)) {
        i = neu('zahl', a, liesZahl(i));
      } else if (istNamensStart(c)) {
        i = nameArtig(i);
      } else {
        i = neu('zeichen', a, i + 1, s[i]);
      }
    }
    return tk;
  }

  // Index des passenden Schließers zum Öffner bei i (funktion, (, [, {) – wie „consume a simple block/function“:
  // fremde Schließer innerhalb zählen nicht. Ohne Schließer: tk.length.
  function passend(tk, i) {
    var stapel = [tk[i].t === '[' ? ']' : tk[i].t === '{' ? '}' : ')'];
    for (var j = i + 1; j < tk.length; j++) {
      var t = tk[j].t;
      if (t === 'funktion' || t === '(') stapel.push(')');
      else if (t === '[') stapel.push(']');
      else if (t === '{') stapel.push('}');
      else if (t === stapel[stapel.length - 1]) { stapel.pop(); if (!stapel.length) return j; }
    }
    return tk.length;
  }
  function istOeffner(t) { return t === 'funktion' || t === '(' || t === '[' || t === '{'; }

  // Ende (exklusiv) einer at-Regel ab Token i: bis „;“, einschließlich eines {}-Blocks, verschachtelt bis vor das „}“
  // des umgebenden Blocks, sonst bis zum Ende.
  function atRegelEnde(tk, i, ende, verschachtelt) {
    for (var j = i + 1; j < ende; j++) {
      var t = tk[j].t;
      if (t === ';') return j + 1;
      if (t === '{') return Math.min(passend(tk, j) + 1, ende);
      if (t === '}' && verschachtelt) return j;
      if (t === 'funktion' || t === '(' || t === '[') j = passend(tk, j);
    }
    return ende;
  }

  // ---------------------------------------------------------------------------
  // Erlaubte Ziele und Lade-Funktionen
  // ---------------------------------------------------------------------------
  // Ziel wie der URL-Parser vorbereiten: Tab/Zeilenumbruch fallen weg, Steuerzeichen und Leerzeichen am Rand auch.
  // Steuerzeichen mitten im Ziel → nicht erlaubt.
  function zielText(w) {
    return String(w).replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
  }
  // CSS (mitFonts): „data:…“, „fonts/…“ ohne „..“, „#…“ nur mitAnker (siehe ANKER_EIGENSCHAFTEN);
  // Attribute: „data:…“ und „#…“ (fill="url(#g)" usw.)
  function erlaubtesZiel(w, mitFonts, mitAnker) {
    var z = zielText(w);
    if (/[\u0000-\u001f\u007f]/.test(z)) return false;
    if (z.charAt(0) === '#') return !!mitAnker;
    if (/^data:/i.test(z)) return true;
    return !!mitFonts && z.indexOf('fonts/') === 0 && !/\.\.|%2e|\\/i.test(z);
  }
  // Funktionen, die etwas laden können (auch mit Herstellerpräfix, z. B. -webkit-image-set, -webkit-cross-fade)
  var LADER = new Set(['url', 'src', 'image-set', 'image', 'cross-fade']);
  // CSS-Eigenschaften, in denen url(#…) ein lokaler Verweis auf ein Element ist und nichts lädt (Chromium geprüft:
  // keine Anfrage; WebKit löst Verweise auf das eigene Dokument dort ebenfalls lokal auf).
  var ANKER_EIGENSCHAFTEN = new Set(['fill', 'stroke', 'clip-path', 'filter', 'marker', 'marker-start', 'marker-mid', 'marker-end']);
  function istLader(name) { return LADER.has(kleinAscii(name).replace(/^-(webkit|moz|o|ms)-/, '')); }
  // Funktionen, deren Wert erst später feststeht – in einer Lade-Funktion nicht prüfbar, also nicht erlaubt
  function istUnpruefbar(name) {
    var k = kleinAscii(name);
    return k === 'var' || k === 'env' || k === 'attr' || k === 'inherit' || k.indexOf('--') === 0;
  }
  // Lade-Funktion tk[a] … tk[e] (Schließer) prüfen: jeder String und jedes url-Token darin braucht ein erlaubtes Ziel.
  // Ausnahme: Strings direkt in type(…) (MIME-Typ in image-set). Ungültige Strings/URLs → nicht erlaubt.
  function funktionErlaubt(tk, a, e, mitFonts, mitAnker) {
    var stapel = [];
    for (var j = a + 1; j < e && j < tk.length; j++) {
      var t = tk[j];
      switch (t.t) {
        case 'funktion':
          if (istUnpruefbar(t.w)) return false;
          stapel.push({ z: ')', n: kleinAscii(t.w) });
          break;
        case '(': stapel.push({ z: ')', n: '' }); break;
        case '[': stapel.push({ z: ']', n: '' }); break;
        case '{': stapel.push({ z: '}', n: '' }); break;
        case ')': case ']': case '}':
          if (stapel.length && stapel[stapel.length - 1].z === t.t) stapel.pop();
          break;
        case 'string':
          if (stapel.length && stapel[stapel.length - 1].n === 'type') break;
          if (!erlaubtesZiel(t.w, mitFonts, mitAnker)) return false;
          break;
        case 'url':
          if (!erlaubtesZiel(t.w, mitFonts, mitAnker)) return false;
          break;
        case 'badstring': case 'badurl':
          return false;
      }
    }
    return true;
  }
  // Lädt ein Attributwert (als CSS gelesen) etwas von einem Ziel außer „#…“/„data:“?
  function laedtFremdes(wert) {
    var s = String(wert);
    if (s.indexOf('(') < 0) return false; // ohne „(“ weder url-Token noch Funktion
    var tk = tokenisiere(s);
    for (var i = 0; i < tk.length; i++) {
      var t = tk[i];
      if (t.t === 'badurl') return true;
      if (t.t === 'url' && !erlaubtesZiel(t.w, false, true)) return true;
      if (t.t === 'funktion' && istLader(t.w) && !funktionErlaubt(tk, i, passend(tk, i), false, true)) return true;
    }
    return false;
  }

  // ---------------------------------------------------------------------------
  // bereinigeCss
  // ---------------------------------------------------------------------------
  // Beim Entfernen (Kommentar, @import) dürfen Nachbar-Token nicht verschmelzen (u/**/rl( darf nicht url( werden).
  // Ist eine Seite sicher, entfällt der Text ganz, sonst bleibt ein leerer Kommentar „/**/“ als Grenze stehen.
  var SICHER_LINKS = new Set(['anfang', 'leer', 'kommentar', '{', '}', '(', ')', '[', ']', ';', ',', ':', 'funktion', 'string', 'badstring', 'url', 'badurl', 'cdo', 'cdc']);
  var SICHER_RECHTS = new Set(['ende', 'leer', '{', '}', ')', '[', ']', ';', ',', ':', 'string', 'badstring']);

  function bereinigeCss(css) {
    var s = css === undefined || css === null ? '' : String(css);
    var tk = tokenisiere(s);
    var aus = [], stapel = [], letzter = 'anfang';
    function ausgeben(text, art) { aus.push(text); letzter = art; }
    // Art des nächsten Tokens ab j, das stehen bleibt (Kommentare fallen ohnehin weg)
    function art(j) { while (j < tk.length && tk[j].t === 'kommentar') j++; return j < tk.length ? tk[j].t : 'ende'; }
    function grenze(naechster) { if (!SICHER_LINKS.has(letzter) && !SICHER_RECHTS.has(art(naechster))) ausgeben('/**/', 'kommentar'); }
    function ersetzeDurchNone(naechster) { ausgeben('none', 'name'); if (!SICHER_RECHTS.has(art(naechster))) ausgeben(' ', 'leer'); }
    // Eigenschaft der laufenden Deklaration (klein; '' = keine bzw. unbekannt), für url(#…). Neu bestimmt nach „{“, „}“
    // und „;“ auf Regel-Ebene (in Funktionen/Klammern zählen sie nicht): ein Name, auf den „:“ folgt.
    var eigenschaft = '', namenStart = true;
    function naechsterIstDoppelpunkt(j) {
      while (j < tk.length && (tk[j].t === 'leer' || tk[j].t === 'kommentar')) j++;
      return j < tk.length && tk[j].t === ':';
    }

    var i = 0;
    while (i < tk.length) {
      var t = tk[i];
      if (t.t === 'kommentar') { grenze(i + 1); i++; continue; }
      // @import nur als Regel (Ebene eines Blocks oder ganz oben), nie als Token in einer Funktion/Klammer
      var regelEbene = !stapel.length || stapel[stapel.length - 1] === '}';
      if (regelEbene && (t.t === '{' || t.t === '}' || t.t === ';')) { eigenschaft = ''; namenStart = true; }
      else if (t.t !== 'leer') {
        if (namenStart && t.t === 'name' && naechsterIstDoppelpunkt(i + 1)) eigenschaft = kleinAscii(t.w);
        namenStart = false;
      }
      var mitAnker = ANKER_EIGENSCHAFTEN.has(eigenschaft);
      if (t.t === 'at' && regelEbene && kleinAscii(t.w) === 'import') {
        var e = atRegelEnde(tk, i, tk.length, stapel.length > 0);
        grenze(e);
        i = e;
        eigenschaft = ''; namenStart = true;
        continue;
      }
      if (t.t === 'url' || t.t === 'badurl') {
        if (t.t === 'url' && erlaubtesZiel(t.w, true, mitAnker)) ausgeben(s.slice(t.a, t.e), t.t);
        else ersetzeDurchNone(i + 1);
        i++;
        continue;
      }
      if (t.t === 'funktion' && istLader(t.w)) {
        var zu = passend(tk, i);
        if (!funktionErlaubt(tk, i, zu, true, mitAnker)) {
          var weiter = Math.min(zu + 1, tk.length);
          ersetzeDurchNone(weiter);
          i = weiter;
          continue;
        }
      }
      if (t.t === 'funktion' || t.t === '(') stapel.push(')');
      else if (t.t === '[') stapel.push(']');
      else if (t.t === '{') stapel.push('}');
      else if ((t.t === ')' || t.t === ']' || t.t === '}') && stapel[stapel.length - 1] === t.t) stapel.pop();
      ausgeben(s.slice(t.a, t.e), t.t);
      i++;
    }
    return aus.join('');
  }

  // Offene Kommentare, Strings, URLs, Klammern und Blöcke am Ende schließen und eine offene letzte Regel beenden
  // (at-Regel mit „;“, Stilregel ohne Block mit „{}“), damit angehängte Regeln (Host-Kasten, @page{size:A4;margin:0})
  // eigenständig bleiben und nicht in einen offenen Block oder ein Prelude geraten.
  function abschliessen(s) {
    var tk = tokenisiere(s);
    if (!tk.length) return s;
    var zusatz = '';
    var rest = /\\+$/.exec(s);
    if (rest && rest[0].length % 2 === 1) zusatz += '\n'; // Backslash am Ende würde sonst den Schließer maskieren
    var letztes = tk[tk.length - 1];
    if (!letztes.zu) {
      if (letztes.t === 'kommentar') zusatz += '*/';
      else if (letztes.t === 'string') zusatz += s.charAt(letztes.a);
      else if (letztes.t === 'url' || letztes.t === 'badurl') zusatz += ')';
    }
    var stapel = [];
    for (var i = 0; i < tk.length; i++) {
      var t = tk[i].t;
      if (t === 'funktion' || t === '(') stapel.push(')');
      else if (t === '[') stapel.push(']');
      else if (t === '{') stapel.push('}');
      else if ((t === ')' || t === ']' || t === '}') && stapel[stapel.length - 1] === t) stapel.pop();
    }
    var zu = s + zusatz + stapel.reverse().join('');
    var regeln = obersteRegeln(tokenisiere(zu));
    var letzte = regeln[regeln.length - 1];
    if (letzte && letzte.offen) zu += letzte.at ? ';' : '{}';
    return zu;
  }

  // ---------------------------------------------------------------------------
  // Regel-Struktur (für wurzelSelektoren und zerlegeCss)
  // ---------------------------------------------------------------------------
  // at-Regeln, deren Block wieder Regeln mit Selektoren enthält
  var REGEL_BLOECKE = new Set(['media', 'supports', 'layer', 'container', 'document', '-moz-document', 'scope', 'starting-style']);

  // Regelliste tk[i … ende): oben = oberste Ebene des Stylesheets. beiSelektor(a, e) für jedes Selektor-Prelude.
  function regelListe(tk, i, ende, oben, beiSelektor) {
    while (i < ende) {
      var t = tk[i];
      if (t.t === 'leer' || t.t === 'kommentar' || t.t === 'cdo' || t.t === 'cdc') { i++; continue; }
      if (t.t === 'at') { i = atRegel(tk, i, ende, !oben, REGEL_BLOECKE.has(kleinAscii(t.w)) ? 'regeln' : null, beiSelektor); continue; }
      // Stilregel: Prelude bis „{“
      var j = i, abbruch = false;
      for (; j < ende; j++) {
        var u = tk[j].t;
        if (u === '{') break;
        if (u === ';' && !oben) { abbruch = true; break; }
        if (u === 'funktion' || u === '(' || u === '[') j = passend(tk, j);
      }
      if (abbruch) { i = j + 1; continue; }
      if (j >= ende) return;
      var blockEnde = Math.min(passend(tk, j), ende);
      beiSelektor(i, j);
      deklarationsBlock(tk, j + 1, blockEnde, beiSelektor);
      i = blockEnde + 1;
    }
  }
  // at-Regel ab i; inhalt: 'regeln' (Regelliste), 'block' (Deklarationen + verschachtelte Regeln) oder null (nicht anfassen)
  function atRegel(tk, i, ende, verschachtelt, inhalt, beiSelektor) {
    for (var j = i + 1; j < ende; j++) {
      var u = tk[j].t;
      if (u === ';') return j + 1;
      if (u === '}' && verschachtelt) return j;
      if (u === '{') {
        var blockEnde = Math.min(passend(tk, j), ende);
        if (inhalt === 'regeln') regelListe(tk, j + 1, blockEnde, false, beiSelektor);
        else if (inhalt === 'block') deklarationsBlock(tk, j + 1, blockEnde, beiSelektor);
        return blockEnde + 1;
      }
      if (u === 'funktion' || u === '(' || u === '[') j = passend(tk, j);
    }
    return ende;
  }
  // Inhalt eines Stilregel-Blocks: Deklarationen und (CSS-Verschachtelung) Regeln mit eigenem Selektor
  function deklarationsBlock(tk, i, ende, beiSelektor) {
    while (i < ende) {
      var t = tk[i];
      if (t.t === 'leer' || t.t === 'kommentar' || t.t === ';') { i++; continue; }
      if (t.t === 'at') { i = atRegel(tk, i, ende, true, REGEL_BLOECKE.has(kleinAscii(t.w)) ? 'block' : null, beiSelektor); continue; }
      var eigeneEigenschaft = t.t === 'name' && t.w.indexOf('--') === 0; // --x: { … } ist eine Deklaration
      var j = i, regel = false;
      for (; j < ende; j++) {
        var u = tk[j].t;
        if (u === ';') break;
        if (u === '{') { if (!eigeneEigenschaft) { regel = true; break; } j = passend(tk, j); continue; }
        if (u === 'funktion' || u === '(' || u === '[') j = passend(tk, j);
      }
      if (!regel) { i = j + 1; continue; }
      var blockEnde = Math.min(passend(tk, j), ende);
      beiSelektor(i, j);
      deklarationsBlock(tk, j + 1, blockEnde, beiSelektor);
      i = blockEnde + 1;
    }
  }

  // Ist die Verbindung (zusammengesetzter Selektor, Token-Indizes ohne Kommentare) genau :root, html oder body?
  function istWurzelVerbindung(tk, idx) {
    if (idx.length === 1) {
      var t = tk[idx[0]];
      if (t.t !== 'name') return false;
      var k = kleinAscii(t.w);
      return k === 'html' || k === 'body';
    }
    return idx.length === 2 && tk[idx[0]].t === ':' && tk[idx[1]].t === 'name' && kleinAscii(tk[idx[1]].w) === 'root';
  }

  // Selektor-Prelude tk[a … e) zerlegen: je komplexem Selektor (Komma) die Folge aus Verbindungen und Kombinatoren.
  // Eigenständige :root/html/body werden ersetzt; mehrere hintereinander (html body, :root > body) werden zu EINEM
  // Ersatz (sonst entstünde „:host :host“, das nie passt).
  function selektorBereiche(tk, a, e, bereiche) {
    var teile = [], v = null;
    function verbindungFertig() { if (v) { teile.push(v); v = null; } }
    function auswerten() {
      verbindungFertig();
      var lauf = null;
      for (var k = 0; k <= teile.length; k++) {
        var p = teile[k];
        if (p && p.art === 'v' && istWurzelVerbindung(tk, p.idx)) {
          if (!lauf) lauf = { a: tk[p.idx[0]].a, e: 0 };
          lauf.e = tk[p.idx[p.idx.length - 1]].e;
          continue;
        }
        if (p && p.art === 'k' && lauf && (p.z === ' ' || p.z === '>')) {
          var q = teile[k + 1];
          if (q && q.art === 'v' && istWurzelVerbindung(tk, q.idx)) continue; // Kette geht weiter
        }
        if (lauf) { bereiche.push(lauf); lauf = null; }
      }
      teile = [];
    }
    for (var i = a; i < e; i++) {
      var t = tk[i];
      if (t.t === 'kommentar') continue;
      if (t.t === 'leer') {
        verbindungFertig();
        if (teile.length && teile[teile.length - 1].art !== 'k') teile.push({ art: 'k', z: ' ' });
        continue;
      }
      if (t.t === ',') { auswerten(); continue; }
      if (t.t === 'zeichen' && (t.w === '>' || t.w === '+' || t.w === '~')) {
        verbindungFertig();
        if (teile.length && teile[teile.length - 1].art === 'k') teile[teile.length - 1].z = t.w;
        else teile.push({ art: 'k', z: t.w });
        continue;
      }
      if (!v) v = { art: 'v', idx: [] };
      v.idx.push(i);
      if (istOeffner(t.t)) {
        var zu = passend(tk, i);
        if (zu < e) v.idx.push(zu);
        i = zu;
      }
    }
    auswerten();
  }

  // Ersetzt in Selektoren eigenständige :root, html, body durch ersatz (z. B. ':host', '.ae-wurzel'). Alles andere
  // (at-Regel-Preludes, Deklarationen, Strings, Kommentare, .body, #body, tbody, body-x, [body], body.x) bleibt wörtlich.
  function wurzelSelektoren(css, ersatz) {
    var s = css === undefined || css === null ? '' : String(css);
    var neu = String(ersatz);
    var tk = tokenisiere(s);
    var bereiche = [];
    regelListe(tk, 0, tk.length, true, function (a, e) { selektorBereiche(tk, a, e, bereiche); });
    if (!bereiche.length) return s;
    bereiche.sort(function (x, y) { return x.a - y.a; });
    var aus = [], pos = 0;
    bereiche.forEach(function (b) {
      if (b.a < pos) return;
      aus.push(s.slice(pos, b.a), neu);
      pos = b.e;
    });
    aus.push(s.slice(pos));
    return aus.join('');
  }

  // Oberste Regeln eines (bereinigten) Stylesheets: [{ name: at-Name klein oder '' für Stilregeln, a, e }] (Zeichen)
  function obersteRegeln(tk) {
    var r = [], i = 0;
    while (i < tk.length) {
      var t = tk[i];
      if (t.t === 'leer' || t.t === 'kommentar' || t.t === 'cdo' || t.t === 'cdc') { i++; continue; }
      var ende = -1, offen = false, j, blockEnde;
      if (t.t === 'at') {
        for (j = i + 1; j < tk.length; j++) {
          var u = tk[j].t;
          if (u === ';') { ende = j + 1; break; }
          if (u === '{') { blockEnde = passend(tk, j); ende = Math.min(blockEnde + 1, tk.length); offen = blockEnde >= tk.length; break; }
          if (u === 'funktion' || u === '(' || u === '[') j = passend(tk, j);
        }
        if (ende < 0) { ende = tk.length; offen = true; } // Prelude ohne „;“ bis zum Ende
      } else {
        j = i;
        while (j < tk.length && tk[j].t !== '{') { if (istOeffner(tk[j].t)) j = passend(tk, j); j++; }
        if (j >= tk.length) { ende = tk.length; offen = true; } // Prelude ohne Block bis zum Ende
        else { blockEnde = passend(tk, j); ende = Math.min(blockEnde + 1, tk.length); offen = blockEnde >= tk.length; }
      }
      r.push({ name: t.t === 'at' ? kleinAscii(t.w) : '', at: t.t === 'at', a: t.a, e: tk[ende - 1].e, offen: offen });
      i = ende;
    }
    return r;
  }

  // Was flyer.html selbst nutzt (muss zu dessen <style> passen; tests/flyer.test.js gleicht es mit flyer.html ab):
  // - SEITEN_VARIABLEN: eigene Custom Properties (:root). Sie würden in jeden Shadow Root erben (all:initial setzt
  //   Custom Properties nicht zurück) – ein Paket mit var(--bg, …) sähe dann je nach Hell/Dunkel der Seite anders aus.
  //   Darum setzt der Shadow-Anfang sie auf initial (ungültig → die Ersatzwerte des Pakets gelten); das Paket-CSS
  //   danach kann sie wie gewohnt selbst setzen.
  // - SEITEN_SCHRIFTEN: Schriftfamilien der Seite (font-family in flyer.html, klein). Eine Paket-@font-face mit einem
  //   dieser Namen stünde im Dokument (siehe dokument unten) und änderte Kopfzeile, Knöpfe und Meldungen der Seite –
  //   sie wird verworfen (Bildschirm, Druck und Bild gleich).
  var SEITEN_VARIABLEN = ['--bg', '--panel', '--line', '--text', '--muted', '--accent', '--accent-ink', '--sel', '--sel-ink',
    '--field', '--danger', '--chip', '--warn-bg', '--warn-line', '--warn-text'];
  var SEITEN_SCHRIFTEN = new Set(['avenir next', 'futura', 'segoe ui', 'system-ui', '-apple-system', 'sans-serif',
    'ui-monospace', 'sfmono-regular', 'menlo', 'monospace']);
  // Gruppen-Regeln, in denen @font-face bzw. @page stehen dürfen (werden samt Hülle ins Dokument übernommen)
  var DOK_GRUPPEN = new Set(['media', 'supports', 'layer']);

  // Ende (Token-Index, exklusiv) und Block ({-Index oder -1) einer at-Regel ab i innerhalb von tk[i … ende)
  function atRegelBlock(tk, i, ende) {
    for (var j = i + 1; j < ende; j++) {
      var u = tk[j].t;
      if (u === ';') return { ende: j + 1, block: -1, blockEnde: -1 };
      if (u === '{') { var be = Math.min(passend(tk, j), ende); return { ende: Math.min(be + 1, ende), block: j, blockEnde: be }; }
      if (u === '}') return { ende: j, block: -1, blockEnde: -1 };
      if (u === 'funktion' || u === '(' || u === '[') j = passend(tk, j);
    }
    return { ende: ende, block: -1, blockEnde: -1 };
  }
  // Schriftfamilie(n) aus dem Block einer @font-face-Regel (klein, Leerraum vereinheitlicht)
  function fontFaceFamilien(tk, a, e) {
    var r = [];
    for (var j = a; j < e; j++) {
      if (tk[j].t !== 'name' || kleinAscii(tk[j].w) !== 'font-family') continue;
      var k = j + 1;
      while (k < e && (tk[k].t === 'leer' || tk[k].t === 'kommentar')) k++;
      if (k >= e || tk[k].t !== ':') continue;
      var teile = [];
      for (k++; k < e && tk[k].t !== ';'; k++) {
        if (tk[k].t === 'string' || tk[k].t === 'name') teile.push(tk[k].w);
        else if (tk[k].t === 'funktion' || tk[k].t === '(' || tk[k].t === '[' || tk[k].t === '{') k = passend(tk, k);
      }
      r.push(kleinAscii(teile.join(' ')).replace(/\s+/g, ' ').trim());
      j = k;
    }
    return r;
  }
  // Entfernt (überall im Stylesheet) @font-face-Regeln, deren Familie die Seite selbst nutzt.
  function ohneSeitenSchriften(s) {
    var tk = tokenisiere(s), weg = [];
    for (var i = 0; i < tk.length; i++) {
      if (tk[i].t !== 'at' || kleinAscii(tk[i].w) !== 'font-face') continue;
      var r = atRegelBlock(tk, i, tk.length);
      if (r.block < 0) continue;
      if (fontFaceFamilien(tk, r.block + 1, r.blockEnde).some(function (f) { return SEITEN_SCHRIFTEN.has(f); })) {
        weg.push([tk[i].a, tk[r.ende - 1].e]);
        i = r.ende - 1;
      }
    }
    if (!weg.length) return s;
    var aus = [], pos = 0;
    weg.forEach(function (w) { aus.push(s.slice(pos, w[0]), '\n'); pos = w[1]; });
    aus.push(s.slice(pos));
    return aus.join('');
  }
  // @font-face und @page (ohne Seitenauswahl wie :first, :left, :right, :blank oder Namen – die würden die eigene
  // A4-Regel über die Spezifität aushebeln) aus der Regelliste tk[i … ende), auch aus @media, @supports und @layer
  // (samt Hülle, z. B. „@media print{@page{…}}“). Stilregeln und alles andere bleiben weg.
  function dokumentRegeln(tk, s, i, ende) {
    var aus = [];
    while (i < ende) {
      var t = tk[i];
      if (t.t !== 'at') {
        if (t.t === 'leer' || t.t === 'kommentar' || t.t === 'cdo' || t.t === 'cdc' || t.t === ';') { i++; continue; }
        // Stilregel überspringen (Prelude bis „{“, dann den Block)
        var j = i;
        while (j < ende && tk[j].t !== '{') { if (istOeffner(tk[j].t)) j = passend(tk, j); j++; }
        i = j >= ende ? ende : Math.min(passend(tk, j), ende) + 1;
        continue;
      }
      var name = kleinAscii(t.w), r = atRegelBlock(tk, i, ende);
      if (r.block >= 0) {
        if (name === 'font-face') aus.push(s.slice(t.a, tk[r.ende - 1].e));
        else if (name === 'page') {
          var mitAuswahl = false;
          for (var k = i + 1; k < r.block; k++) if (tk[k].t !== 'leer' && tk[k].t !== 'kommentar') { mitAuswahl = true; break; }
          if (!mitAuswahl) aus.push(s.slice(t.a, tk[r.ende - 1].e));
        } else if (DOK_GRUPPEN.has(name)) {
          var innen = dokumentRegeln(tk, s, r.block + 1, r.blockEnde);
          if (innen) aus.push(s.slice(t.a, tk[r.block].e) + innen + '}');
        }
      }
      i = Math.max(r.ende, i + 1);
    }
    return aus.join('\n');
  }

  // Paket-CSS für die Darstellung aufteilen (§4.3):
  //   schatten: :host{all:initial;display:block; Seiten-Variablen initial} + bereinigtes CSS mit :root/html/body → :host
  //             + neutraler Host-Kasten
  //   dokument: die bereinigten @font-face- und @page-Regeln (wirken im Shadow Root nicht), auch aus @media/@supports/
  //             @layer; ohne @page mit Seitenauswahl
  //   sauber:   das bereinigte, abgeschlossene CSS (ohne @font-face mit Schriftnamen der Seite) – fürs Bild
  function zerlegeCss(css) {
    var sauber = ohneSeitenSchriften(abschliessen(bereinigeCss(css)));
    var tk = tokenisiere(sauber);
    var dokument = dokumentRegeln(tk, sauber, 0, tk.length);
    var zuruecksetzen = SEITEN_VARIABLEN.map(function (v) { return v + ':initial'; }).join(';');
    var schatten = ':host{all:initial;display:block;' + zuruecksetzen + '}\n' + wurzelSelektoren(sauber, ':host') +
      '\n:host{margin:0 !important;padding:0 !important;border:0 !important;display:block !important}';
    return { schatten: schatten, dokument: dokument, sauber: sauber };
  }

  // ---------------------------------------------------------------------------
  // bereinigeHtml
  // ---------------------------------------------------------------------------
  // Elemente, die samt Inhalt wegfallen (Vergleich über localName klein, alle Namensräume)
  var WEG_ELEMENTE = new Set(['script', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'link', 'meta', 'base',
    'form', 'template', 'portal', 'noscript', 'fencedframe', 'handler', 'listener']);
  // SVG-Animationen: weg, wenn sie href/xlink:href/src (oder ein on*-Attribut) setzen
  var ANIMATIONEN = new Set(['set', 'animate', 'animatemotion', 'animatetransform']);
  // Verweis-Attribute: nur „#…“ oder „data:image/…“ (an a/area nur „#…“)
  var VERWEIS_ATTRIBUTE = new Set(['href', 'src', 'action', 'formaction', 'poster', 'background', 'ping', 'lowsrc', 'dynsrc',
    'longdesc', 'codebase', 'data', 'manifest']);
  // immer weg (srcset kann mehrere Ziele enthalten; autofocus würde der Seite den Fokus nehmen)
  var IMMER_WEG_ATTRIBUTE = new Set(['srcset', 'imagesrcset', 'srcdoc', 'autofocus']);
  var LINK_ELEMENTE = new Set(['a', 'area']);

  function basisName(n) { n = n.toLowerCase(); return n.slice(n.lastIndexOf(':') + 1); }

  function sichererVerweis(wert, nurAnker) {
    var z = String(wert).replace(/[\t\n\r]/g, '').replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '');
    if (/[\u0000-\u001f\u007f-\u009f]/.test(z)) return false;
    if (z.charAt(0) === '#') return true;
    return !nurAnker && /^data:image\//i.test(z);
  }
  function zieltAufVerweis(el) {
    for (var i = 0; i < el.attributes.length; i++) {
      var a = el.attributes[i];
      if (a.localName.toLowerCase() !== 'attributename') continue;
      var ziel = basisName(a.value.replace(/[\u0000-\u0020\u007f-\u009f]/g, ''));
      if (ziel === 'href' || ziel === 'src' || ziel.indexOf('on') === 0) return true;
    }
    return false;
  }
  function bereinigeAttribute(el, name) {
    var liste = Array.prototype.slice.call(el.attributes);
    for (var i = 0; i < liste.length; i++) {
      var a = liste[i];
      var qn = a.name.toLowerCase(), ln = a.localName.toLowerCase(), basis = basisName(ln);
      var weg = false;
      if (qn.indexOf('on') === 0 || ln.indexOf('on') === 0 || basis.indexOf('on') === 0) weg = true;
      else if (IMMER_WEG_ATTRIBUTE.has(basis) || qn === 'xml:base') weg = true;
      else if (VERWEIS_ATTRIBUTE.has(basis)) weg = !sichererVerweis(a.value, LINK_ELEMENTE.has(name) && basis === 'href');
      else if (qn === 'style') { var sauber = bereinigeCss(a.value); if (sauber !== a.value) a.value = sauber; }
      else weg = laedtFremdes(a.value); // fill="url(…)", filter, mask, data-* …: nur „#…“/„data:“
      if (weg) el.removeAttributeNode(a);
    }
  }

  // html → bereinigte Wurzel (erstes Element), noch im fremden Dokument; Aufrufer nimmt document.importNode(wurzel, true).
  // Bereinigt wird der ganze body vor der Wahl der Wurzel, damit z. B. ein vorangestelltes <script> nicht Wurzel wird.
  function bereinigeHtml(html) {
    var doc = new DOMParser().parseFromString('<!doctype html><body>' + (html === undefined || html === null ? '' : String(html)), 'text/html');
    var body = doc.body;
    if (body) {
      // Kommentare weg (nur Ballast; im PNG-Export könnten sie das XML stören)
      var gaenger = doc.createTreeWalker(body, 128), kommentare = [];
      while (gaenger.nextNode()) kommentare.push(gaenger.currentNode);
      kommentare.forEach(function (k) { k.remove(); });
      var alle = Array.prototype.slice.call(body.querySelectorAll('*'));
      for (var i = 0; i < alle.length; i++) {
        var el = alle[i];
        if (!body.contains(el)) continue; // schon mit einem Vorfahren entfernt
        var name = basisName(el.localName);
        if (WEG_ELEMENTE.has(name) || (ANIMATIONEN.has(name) && zieltAufVerweis(el))) { el.remove(); continue; }
        bereinigeAttribute(el, name);
        if (name === 'style') el.textContent = bereinigeCss(el.textContent);
      }
    }
    var wurzel = body && body.firstElementChild;
    if (!wurzel) throw fehler('format', 'Dokument ohne Inhalt.', 'Im Feld html steht kein Element.');
    return wurzel;
  }

  window.AetherFlyerPaket = Object.freeze({
    FORMAT: FORMAT,
    FORMAT_VERSION: FORMAT_VERSION,
    DATEI: DATEI,
    lies: lies,
    pruefe: pruefe,
    vergleicheVersion: vergleicheVersion,
    datum: datum,
    bereinigeHtml: bereinigeHtml,
    bereinigeCss: bereinigeCss,
    zerlegeCss: zerlegeCss,
    wurzelSelektoren: wurzelSelektoren,
    SEITEN_VARIABLEN: Object.freeze(SEITEN_VARIABLEN.slice()),
    SEITEN_SCHRIFTEN: Object.freeze(Array.from(SEITEN_SCHRIFTEN))
  });
})();
