// Struktur der Flyer-Seite (flyer.html, F3a): Versionen, Ordner und Seiten eines Pakets im Format v2
// (AetherFlyerPaket.alsV2). Reine Funktionen ohne Zustand und ohne DOM – flyer.js hält den Zustand.
// sicht(paket, nummer): eine Version so, wie Ansicht, Änderungsschicht, Druck und Bild sie brauchen – Dokumente wie im
// Format v1 (id, art, kategorie, titel, breite, hoehe, html) plus ordner, ausgeblendet, herkunft und vorlage.
// Änderungen (Versionen anlegen, beschreiben, ausblenden, löschen …) arbeiten auf einer Kopie, die flyer.js übergibt,
// und werfen bei ungültigen Eingaben einen AppError (dann ändert flyer.js nichts).
// felder(paket): das Paket als flache Liste „Feld → Wert (JSON-Text)“ – Grundlage für die Zählung der Änderungen und
// den Abgleich mit der Online-Datei.
(function () {
  'use strict';

  const STANDARD_VERSION = '1.1';   // der heutige Flyer; jedes Paket hat sie, sie lässt sich nie löschen
  const MAX_BESCHREIBUNG = 80;      // F5

  function fehler(kind, title, text) {
    const G = window.AetherGemeinsam;
    if (G && typeof G.AppError === 'function') return new G.AppError(kind, title, text || '');
    const e = new Error(title); e.kind = kind; e.title = title; e.text = text || ''; return e;
  }
  function kopie(x) { return JSON.parse(JSON.stringify(x)); }

  function version(pk, nummer) {
    if (!pk || !Array.isArray(pk.versionen)) return null;
    return pk.versionen.find((v) => v && v.nummer === nummer) || null;
  }
  // „1.3“ → „V1“ (Versions-Ordner aus der ersten Zahl)
  function versionsOrdner(nummer) { return 'V' + String(nummer).split('.')[0]; }

  // Sicht der Version nummer (gibt es sie nicht: Version 1.1). Die Dokument-Objekte sind neu je Aufruf – flyer.js hält
  // eine Sicht fest, solange sich Paket und Version nicht ändern (Ansicht und Bild vergleichen Objekte).
  function sicht(pk, nummer) {
    const v = version(pk, nummer) || version(pk, STANDARD_VERSION);
    if (!v) return null;
    return {
      format: pk.format, formatVersion: pk.formatVersion, version: pk.version, stand: pk.stand, titel: pk.titel, css: pk.css,
      nummer: v.nummer,
      kategorien: v.ordner.filter((o) => o.eltern === null).map((o) => ({ id: o.id, name: o.name })),
      ordner: v.ordner,
      dokumente: v.seiten.map((s) => ({
        id: s.id, art: s.art,
        kategorie: s.ordner.length ? s.ordner[0] : (typeof s.kategorie === 'string' ? s.kategorie : ''),
        titel: s.titel, breite: s.breite, hoehe: s.hoehe, html: s.html,
        ordner: s.ordner.slice(), ausgeblendet: s.ausgeblendet === true, herkunft: s.herkunft, vorlage: s.vorlage
      }))
    };
  }

  /* ---------- Versionen (Teil B) ---------- */
  function teile(nummer) { const t = String(nummer).split('.'); return { haupt: Number(t[0]), unter: Number(t[1]) }; }
  function vergleicheNummer(a, b) { const x = teile(a), y = teile(b); return x.haupt - y.haupt || x.unter - y.unter; }
  function versionOderFehler(pk, nummer) {
    const v = version(pk, nummer);
    if (!v) throw fehler('struktur', 'Version nicht gefunden.', 'Version ' + nummer + ' gibt es nicht.');
    return v;
  }
  // Versions-Ordner V1, V2 … (nach Zahl sortiert) mit ihren Versionen (nach Unterversion sortiert)
  function versionsGruppen(pk) {
    const g = new Map();
    for (const v of (pk && pk.versionen) || []) {
      const h = teile(v.nummer).haupt;
      if (!g.has(h)) g.set(h, []);
      g.get(h).push(v);
    }
    return Array.from(g.keys()).sort((a, b) => a - b).map((h) => ({
      ordner: 'V' + h, haupt: h, versionen: g.get(h).slice().sort((a, b) => vergleicheNummer(a.nummer, b.nummer))
    }));
  }
  // E6: nächste freie Unterversion im Ordner der Quelle (höchste + 1; 1.1 → 1.4, wenn 1.2 und 1.3 existieren)
  function naechsteUnterversion(pk, quelle) {
    const h = teile(quelle).haupt;
    let max = 0;
    for (const v of pk.versionen) { const t = teile(v.nummer); if (t.haupt === h && t.unter > max) max = t.unter; }
    return h + '.' + (max + 1);
  }
  // E6: nächster freier Versions-Ordner als <n>.1
  function naechsteHauptversion(pk) {
    let max = 0;
    for (const v of pk.versionen) max = Math.max(max, teile(v.nummer).haupt);
    return (max + 1) + '.1';
  }
  // Vollständige Kopie der Version quelle als ziel (eigene Seiten, Ordner, Texte, Status, Ausblendungen). htmlFn(nummer,
  // seite) liefert das HTML, wie die Quelle es gerade zeigt (Basis + Änderungsschicht); ohne htmlFn bleibt es.
  // Die Versionen bleiben nach Nummer sortiert. → die neue Version
  function versionKopieren(pk, quelle, ziel, htmlFn) {
    const q = versionOderFehler(pk, quelle);
    if (!/^[1-9]\d*\.[1-9]\d*$/.test(String(ziel))) throw fehler('struktur', 'Ungültige Versionsnummer.', String(ziel));
    if (version(pk, ziel)) throw fehler('struktur', 'Version gibt es schon.', 'Version ' + ziel + ' gibt es schon.');
    const v = kopie(q);
    v.nummer = ziel;
    v.beschreibung = 'Kopie von ' + quelle;
    v.ausgeblendet = false;
    if (typeof htmlFn === 'function') v.seiten.forEach((s, i) => { s.html = String(htmlFn(q.nummer, q.seiten[i])); });
    pk.versionen.push(v);
    pk.versionen.sort((a, b) => vergleicheNummer(a.nummer, b.nummer));
    return v;
  }
  function versionBeschreiben(pk, nummer, text) {
    const v = versionOderFehler(pk, nummer);
    const t = String(text === undefined || text === null ? '' : text).replace(/\s+/g, ' ').trim();
    if (t.length > MAX_BESCHREIBUNG) throw fehler('struktur', 'Beschreibung zu lang.', 'Höchstens ' + MAX_BESCHREIBUNG + ' Zeichen (jetzt ' + t.length + ').');
    v.beschreibung = t;
    return v;
  }
  function versionAusblenden(pk, nummer, an) { const v = versionOderFehler(pk, nummer); v.ausgeblendet = an === true; return v; }
  // F5: eigene Versionen löschen; 1.1 nie
  function versionLoeschen(pk, nummer) {
    if (nummer === STANDARD_VERSION) throw fehler('struktur', 'Version ' + STANDARD_VERSION + ' lässt sich nicht löschen.', 'Sie ist der Flyer selbst; ausblenden geht.');
    versionOderFehler(pk, nummer);
    pk.versionen = pk.versionen.filter((v) => v.nummer !== nummer);
  }
  // Sichtbare (nicht ausgeblendete) Seiten einer Version
  function seitenZahl(v) { return v ? v.seiten.filter((s) => s.ausgeblendet !== true).length : 0; }

  /* ---------- Ordner (Teil C) ---------- */
  const MAX_ORDNERNAME = 60;        // Teil C
  function ordnerVon(v, id) { return v.ordner.find((o) => o.id === id) || null; }
  function ordnerOderFehler(v, id) {
    const o = ordnerVon(v, id);
    if (!o) throw fehler('struktur', 'Ordner nicht gefunden.', 'Den Ordner gibt es in Version ' + v.nummer + ' nicht (mehr).');
    return o;
  }
  // Unterordner von elternId (null = oberste Ebene), in der Reihenfolge der Version
  function kinderOrdner(v, elternId) { return v.ordner.filter((o) => o.eltern === (elternId === undefined ? null : elternId)); }
  // Seiten im Ordner (null = „Alle“: jede Seite der Version genau einmal), ohne Ausgeblendete außer mitAusgeblendeten
  function seitenIn(v, ordnerId, mitAusgeblendeten) {
    return v.seiten.filter((s) => (ordnerId === null || ordnerId === undefined || s.ordner.indexOf(ordnerId) >= 0) &&
      (mitAusgeblendeten === true || s.ausgeblendet !== true));
  }
  // Pfad von der obersten Ebene bis zum Ordner (ohne „Alle“)
  function pfad(v, id) {
    const r = [];
    let o = id === null || id === undefined ? null : ordnerVon(v, id);
    const gesehen = new Set();
    while (o && !gesehen.has(o.id)) { gesehen.add(o.id); r.unshift(o); o = o.eltern === null ? null : ordnerVon(v, o.eltern); }
    return r;
  }
  // Alle Unterordner (beliebig tief) eines Ordners
  function nachfahren(v, id) {
    const r = new Set(), offen = [id];
    while (offen.length) {
      const x = offen.pop();
      for (const o of v.ordner) if (o.eltern === x && !r.has(o.id)) { r.add(o.id); offen.push(o.id); }
    }
    return r;
  }
  // Ordner als Baum (Tiefe zuerst, Reihenfolge der Version): [{ ordner, ebene }]
  function ordnerBaum(v) {
    const r = [];
    const geh = (eltern, ebene) => { for (const o of kinderOrdner(v, eltern)) { r.push({ ordner: o, ebene: ebene }); geh(o.id, ebene + 1); } };
    geh(null, 0);
    return r;
  }
  // „n Seiten · m Ordner“: sichtbare Seiten direkt im Ordner, Unterordner direkt darin
  function ordnerZahlen(v, id) { return { seiten: seitenIn(v, id, false).length, ordner: kinderOrdner(v, id).length }; }
  function vergleichsName(t) { return String(t).trim().toLocaleLowerCase('de-DE'); }
  // Name prüfen: nicht leer, höchstens 60 Zeichen, kein gleicher Name im selben Elternordner (ohne ausser) → Name | wirft
  function ordnerName(v, eltern, name, ausser) {
    const t = String(name === undefined || name === null ? '' : name).replace(/\s+/g, ' ').trim();
    if (!t) throw fehler('struktur', 'Name fehlt.', 'Der Ordner braucht einen Namen.');
    if (t.length > MAX_ORDNERNAME) throw fehler('struktur', 'Name zu lang.', 'Höchstens ' + MAX_ORDNERNAME + ' Zeichen (jetzt ' + t.length + ').');
    const gleich = kinderOrdner(v, eltern).find((o) => o.id !== ausser && vergleichsName(o.name) === vergleichsName(t));
    if (gleich) throw fehler('struktur', 'Name schon vergeben.', 'In diesem Ordner gibt es schon „' + gleich.name + '“.');
    return t;
  }
  // Neue Kennung „<praefix><n>“: höher als der Zähler und als jede vorhandene Kennung dieser Art, nie eine vorhandene
  function neueKennung(praefix, zaehler, vorhanden) {
    const re = new RegExp('^' + praefix + '([1-9]\\d*)$');
    let n = zaehler;
    for (const id of vorhanden) { const m = re.exec(id); if (m) n = Math.max(n, Number(m[1])); }
    n++;
    while (vorhanden.has(praefix + n)) n++;
    return { id: praefix + n, n: n };
  }
  // Neuer Ordner (Kennung O<n>) im Ordner eltern (null = oberste Ebene) → der Ordner
  function ordnerAnlegen(pk, nummer, eltern, name) {
    const v = versionOderFehler(pk, nummer);
    if (eltern !== null) ordnerOderFehler(v, eltern);
    const t = ordnerName(v, eltern, name, null);
    const k = neueKennung('O', v.zaehler.ordner, new Set(v.ordner.map((o) => o.id)));
    const o = { id: k.id, name: t, eltern: eltern };
    v.ordner.push(o);
    v.zaehler.ordner = k.n;
    return o;
  }
  function ordnerUmbenennen(pk, nummer, id, name) {
    const v = versionOderFehler(pk, nummer), o = ordnerOderFehler(v, id);
    o.name = ordnerName(v, o.eltern, name, o.id);
    return o;
  }
  // F4: Verschieben in einen anderen Elternordner – nie in sich selbst oder einen eigenen Unterordner
  function ordnerVerschieben(pk, nummer, id, eltern) {
    const v = versionOderFehler(pk, nummer), o = ordnerOderFehler(v, id);
    const ziel = eltern === undefined ? null : eltern;
    if (ziel !== null) {
      ordnerOderFehler(v, ziel);
      if (ziel === id || nachfahren(v, id).has(ziel)) throw fehler('struktur', 'Verschieben nicht möglich.', 'Ein Ordner kann nicht in sich selbst oder einen eigenen Unterordner.');
    }
    ordnerName(v, ziel, o.name, o.id);   // gleicher Name im Ziel → abgelehnt
    o.eltern = ziel;
    return o;
  }
  // F4: Löschen – die Seiten bleiben (verlieren nur diese Zuordnung), Unterordner wandern in den Elternordner
  function ordnerLoeschen(pk, nummer, id) {
    const v = versionOderFehler(pk, nummer), o = ordnerOderFehler(v, id);
    for (const k of v.ordner) if (k.eltern === id) k.eltern = o.eltern;
    for (const s of v.seiten) s.ordner = s.ordner.filter((x) => x !== id);
    v.ordner = v.ordner.filter((x) => x.id !== id);
    return o;
  }

  /* ---------- Seiten (Teil D) ---------- */
  const MAX_SEITENNAME = 120;       // selbst gewählt (Name der Kachel)
  // E3: Vorlagen; F3b: „Bild / Video“ freigeschaltet (Titel, Untertitel, ein Medium, Kasten „Zu sehen“)
  const VORLAGEN = Object.freeze([
    { id: 'leer', name: 'Leer' }, { id: 'titel-text', name: 'Titel + Text' }, { id: 'liste-status', name: 'Liste mit Status' },
    { id: 'kennzahlen', name: 'Kennzahlen' }, { id: 'zwei-kaesten', name: 'Zwei Kästen' },
    { id: 'bild-video', name: 'Bild / Video' }
  ].map(Object.freeze));
  // F3b: Platz des Mediums in der Vorlage „Bild / Video“ (16:9; den Inhalt setzt flyer-player.js bei jeder Darstellung
  // ein – im Paket steht nur der Verweis data-medium="m<n>", nie der Inhalt)
  const MEDIUM_STIL = 'position:relative;aspect-ratio:16/9;width:100%;border-radius:14px;overflow:hidden;background:#0b1222;margin:0 0 14px';
  const KENNUNG_MEDIUM = /^m[1-9]\d*$/;
  function esc(t) { return String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function datumKurz(iso) { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso)); return m ? m[3] + '.' + m[2] + '.' + m[1] : String(iso); }
  // Aufzählungszeichen wie im Paket (Stern)
  const BLT = '<svg class="blt" viewBox="0 0 10 10" aria-hidden="true"><path d="M5 0C5.45 3.3 6.7 4.55 10 5 6.7 5.45 5.45 6.7 5 10 4.55 6.7 3.3 5.45 0 5 3.3 4.55 4.55 3.3 5 0z"></path></svg>';
  // F7: HTML einer neuen Seite aus einer Vorlage – dieselben Markierungen wie das Paket (data-t t1…, data-s mit data-status,
  // data-block/data-zaehler mit Zähler, data-stand, <ae-t>) und dasselbe Aussehen (Klassen des Pakets: Hintergrund der
  // Seite, Logo oben links, Marke oben rechts, Fußzeile mit Kennung und Stand).
  // opt = { kennung, heute: 'JJJJ-MM-TT', klasse: 'page …', marke, medium (nur „Bild / Video“: m<n> oder leer) }
  function vorlageHtml(vorlage, opt) {
    let n = 0;
    const t = () => ' data-t="t' + (++n) + '"';
    const titel = vorlage === 'leer' ? '' : '<h1' + t() + '>Titel</h1><p class="sub"' + t() + '>Untertitel</p>';
    const kopf = '<header class="hd"><div class="brand"><i class="logo" role="img" aria-label="Aether"></i><span class="kick"' + t() + '>' +
      esc(opt.marke || 'Eigene Seite') + '</span></div>' + titel + '</header>';
    let body = '';
    if (vorlage === 'titel-text') {
      body = '<p class="lead"' + t() + '>Einleitung</p><div class="grid"><div class="blk span2"><p class="pp"' + t() + '>Text</p></div></div>';
    } else if (vorlage === 'liste-status') {
      const st = ['ok', 'run', 'next', 'plan'];
      body = '<div class="grid"><div class="blk t-list span2" data-block=""><h3 data-zaehler="" style="--anteil:0.25;--anteil-laeuft:0.25"><ae-t' + t() +
        '>Liste</ae-t><span class="zaehler">1 von 4 fertig</span></h3><ul class="ls">' +
        st.map((s, i) => '<li data-s="s' + (i + 1) + '" data-status="' + s + '">' + BLT + '<ae-t' + t() + '>Punkt ' + (i + 1) + '</ae-t></li>').join('') +
        '</ul></div></div>';
    } else if (vorlage === 'kennzahlen') {
      body = '<div class="grid"><div class="blk t-stats span2"><div class="st">' +
        [1, 2, 3, 4].map((i) => '<div class="sti"><div class="stv"' + t() + '>' + (i * 10) + '</div><div class="stl"' + t() + '>Kennzahl ' + i + '</div></div>').join('') +
        '</div></div></div>';
    } else if (vorlage === 'zwei-kaesten') {
      body = '<div class="grid">' + [1, 2].map((i) => '<div class="blk"><h3' + t() + '>Kasten ' + i + '</h3><p class="pp"' + t() + '>Text</p></div>').join('') + '</div>';
    } else if (vorlage === 'bild-video') {
      const m = typeof opt.medium === 'string' && KENNUNG_MEDIUM.test(opt.medium) ? opt.medium : '';
      body = '<div class="medium" data-medium="' + esc(m) + '" style="' + MEDIUM_STIL + '"></div>' +
        '<div class="blk zu-sehen"><h3' + t() + '>Zu sehen</h3><p class="pp"' + t() + '>Text</p></div>';
    }
    const fuss = '<footer class="ft"><span class="src"' + t() + '>Quelle</span><span class="pg"><ae-t' + t() + '>' + esc(opt.kennung) +
      ' · Stand </ae-t><span data-stand="kurz">' + esc(datumKurz(opt.heute)) + '</span></span></footer>';
    return '<section class="' + esc(opt.klasse || 'page') + '" data-id="' + esc(opt.kennung) + '" style="--s:1">' + kopf +
      '<div class="body">' + body + '</div>' + fuss + '</section>';
  }
  function seiteVon(v, id) { return v.seiten.find((s) => s.id === id) || null; }
  function seiteOderFehler(v, id) {
    const s = seiteVon(v, id);
    if (!s) throw fehler('struktur', 'Seite nicht gefunden.', 'Seite ' + id + ' gibt es in Version ' + v.nummer + ' nicht (mehr).');
    return s;
  }
  // Klassen der Wurzel einer Flyer-Seite (für das Aussehen einer neuen Seite: wie die Seiten im Ordner)
  function wurzelKlasse(html) { const m = /^\s*<section\b[^>]*\sclass="([^"]*)"/.exec(String(html)); return m && /\bpage\b/.test(m[1]) ? m[1] : null; }
  function klasseFuer(v, ordnerId) {
    const flyer = v.seiten.filter((s) => s.art === 'flyer');
    const im = ordnerId === null ? [] : flyer.filter((s) => s.ordner.indexOf(ordnerId) >= 0);
    for (const s of im.concat(flyer)) { const k = wurzelKlasse(s.html); if (k) return k; }
    return 'page';
  }
  function reEsc(t) { return String(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  // HTML einer Kopie: Kennung an der Wurzel (data-id) und in der Fußzeile („S1 · Stand“ → „N1 · Stand“); sonst gleich
  function kopieHtml(html, alt, neu) {
    let h = String(html).replace(new RegExp('^(\\s*<[a-zA-Z][^>]*\\sdata-id=")' + reEsc(esc(alt)) + '"'), (m, a) => a + esc(neu) + '"');
    h = h.replace(new RegExp('>' + reEsc(esc(alt)) + ' · Stand '), () => '>' + esc(neu) + ' · Stand ');
    return h;
  }
  // Neue Seite (Kennung N<n>, nie vorhanden, nie wiederverwendet – zaehler.seite). opt = { vorlage } oder
  // { kopieVon, html? (HTML, wie die Quelle es zeigt) }, dazu ordner: [ids] und heute. → die Seite
  function seiteAnlegen(pk, nummer, opt) {
    const v = versionOderFehler(pk, nummer);
    const ordner = Array.isArray(opt.ordner) ? opt.ordner : [];
    for (const o of ordner) ordnerOderFehler(v, o);
    const k = neueKennung('N', v.zaehler.seite, new Set(v.seiten.map((s) => s.id)));
    let s;
    if (opt.kopieVon) {
      const q = seiteOderFehler(v, opt.kopieVon);
      s = kopie(q);
      Object.assign(s, { id: k.id, titel: q.titel + ' (Kopie)', herkunft: 'eigen', vorlage: 'kopie', kopieVon: q.id, ordner: ordner.slice(), ausgeblendet: false,
        html: kopieHtml(opt.html !== undefined ? opt.html : q.html, q.id, k.id) });
    } else {
      const vl = VORLAGEN.find((x) => x.id === opt.vorlage);
      if (!vl || vl.gesperrt) throw fehler('struktur', 'Vorlage nicht verfügbar.', vl ? vl.name + ' kommt ' + vl.hinweis + '.' : String(opt.vorlage));
      const erster = ordner.length ? v.ordner.find((o) => o.id === ordner[0]) : null;
      s = { id: k.id, art: 'flyer', titel: 'Neue Seite (' + vl.name + ')', herkunft: 'eigen', vorlage: vl.id, ordner: ordner.slice(), ausgeblendet: false,
        breite: 794, hoehe: 1123,
        html: vorlageHtml(vl.id, { kennung: k.id, heute: opt.heute, klasse: klasseFuer(v, ordner.length ? ordner[0] : null), marke: erster ? erster.name : 'Eigene Seite', medium: opt.medium }) };
    }
    v.seiten.push(s);
    v.zaehler.seite = k.n;
    return s;
  }
  // F3: Umbenennen ändert nur den Namen der Kachel; der Inhalt der Seite bleibt
  function seiteUmbenennen(pk, nummer, id, titel) {
    const v = versionOderFehler(pk, nummer), s = seiteOderFehler(v, id);
    const t = String(titel === undefined || titel === null ? '' : titel).replace(/\s+/g, ' ').trim();
    if (!t) throw fehler('struktur', 'Name fehlt.', 'Die Seite braucht einen Namen.');
    if (t.length > MAX_SEITENNAME) throw fehler('struktur', 'Name zu lang.', 'Höchstens ' + MAX_SEITENNAME + ' Zeichen (jetzt ' + t.length + ').');
    s.titel = t;
    return s;
  }
  // F3: „In Ordner …“ – Ordner der Seite (mehrere möglich), in der Reihenfolge der Version
  function seiteInOrdner(pk, nummer, id, ids) {
    const v = versionOderFehler(pk, nummer), s = seiteOderFehler(v, id);
    const wahl = new Set(ids || []);
    for (const o of wahl) ordnerOderFehler(v, o);
    s.ordner = v.ordner.filter((o) => wahl.has(o.id)).map((o) => o.id);
    return s;
  }
  function seiteAusblenden(pk, nummer, id, an) { const v = versionOderFehler(pk, nummer), s = seiteOderFehler(v, id); s.ausgeblendet = an === true; return s; }
  // E4: Original-Seiten nie löschen (nur ausblenden); eigene Seiten löschen
  function seiteLoeschen(pk, nummer, id) {
    const v = versionOderFehler(pk, nummer), s = seiteOderFehler(v, id);
    if (s.herkunft !== 'eigen') throw fehler('struktur', 'Original-Seiten lassen sich nicht löschen.', 'Seite ' + id + ' lässt sich nur ausblenden.');
    v.seiten = v.seiten.filter((x) => x.id !== id);
    return s;
  }

  /* ---------- Felder (Zählung der Änderungen, Abgleich) ---------- */
  // Bekannte Felder je Objekt; alles andere landet als „extra“ (JSON) im Feld des Objekts selbst (verlustfrei).
  const V_BEKANNT = new Set(['nummer', 'beschreibung', 'ausgeblendet', 'zaehler', 'ordner', 'seiten']);
  const O_BEKANNT = new Set(['id', 'name', 'eltern']);
  const P_BEKANNT = new Set(['id', 'titel', 'ordner', 'ausgeblendet', 'html']);
  function extra(o, bekannt) { const r = {}; Object.keys(o).sort().forEach((k) => { if (!bekannt.has(k)) r[k] = o[k]; }); return r; }
  // Schlüssel: V|<nr>|<feld>, O|<nr>|<id>|<feld>, P|<nr>|<id>|<feld>; Z|<nr> = zaehler (zählt nicht als Änderung).
  // Felder „da“ gibt es genau, wenn das Objekt existiert.
  // F3b: Bibliothek (gilt für alle Versionen, „Version“ *): M|*|<id>|<feld> (Datei: name, ordner, meta = alles andere),
  // MO|*|<id>|<feld> (Bibliotheks-Ordner: name, eltern, extra), Z|* = zaehler der Bibliothek (nur, wenn es medien gibt).
  const M_BEKANNT = new Set(['id', 'name', 'ordner']);
  const BIBLIOTHEK = '*';
  function felder(pk) {
    const f = new Map(), j = (x) => JSON.stringify(x);
    const m = pk && pk.medien;
    if (m && typeof m === 'object' && !Array.isArray(m)) {
      f.set('Z|*', j(m.zaehler || { datei: 0, ordner: 0 }));
      for (const o of m.ordner || []) {
        const k = 'MO|*|' + o.id + '|';
        f.set(k + 'da', '1');
        f.set(k + 'name', j(o.name));
        f.set(k + 'eltern', j(o.eltern));
        f.set(k + 'extra', j(extra(o, O_BEKANNT)));
      }
      for (const d of m.dateien || []) {
        const k = 'M|*|' + d.id + '|';
        f.set(k + 'da', '1');
        f.set(k + 'name', j(d.name));
        f.set(k + 'ordner', j(d.ordner));
        f.set(k + 'meta', j(extra(d, M_BEKANNT)));
      }
    }
    for (const v of (pk && pk.versionen) || []) {
      const vn = v.nummer;
      f.set('V|' + vn + '|da', '1');
      f.set('V|' + vn + '|beschreibung', j(v.beschreibung));
      f.set('V|' + vn + '|ausgeblendet', j(v.ausgeblendet === true));
      f.set('V|' + vn + '|extra', j(extra(v, V_BEKANNT)));
      f.set('Z|' + vn, j(v.zaehler));
      for (const o of v.ordner) {
        const k = 'O|' + vn + '|' + o.id + '|';
        f.set(k + 'da', '1');
        f.set(k + 'name', j(o.name));
        f.set(k + 'eltern', j(o.eltern));
        f.set(k + 'extra', j(extra(o, O_BEKANNT)));
      }
      for (const s of v.seiten) {
        const k = 'P|' + vn + '|' + s.id + '|';
        f.set(k + 'da', '1');
        f.set(k + 'titel', j(s.titel));
        f.set(k + 'ordner', j(s.ordner));
        f.set(k + 'ausgeblendet', j(s.ausgeblendet === true));
        f.set(k + 'html', j(s.html));
        f.set(k + 'meta', j(extra(s, P_BEKANNT)));
      }
    }
    return f;
  }
  // Objekt eines Feld-Schlüssels: „V|1.2“, „O|1.1|spiel“, „P|1.1|S1“ (Z|… → null)
  function objektVon(k) {
    const t = k.split('|');
    if (t[0] === 'V') return 'V|' + t[1];
    if (t[0] === 'O' || t[0] === 'P' || t[0] === 'M' || t[0] === 'MO') return t[0] + '|' + t[1] + '|' + t.slice(2, -1).join('|');
    return null;
  }
  // Kurzer Prüfwert eines Feldwerts (FNV-1a, 32 Bit) – für den Stand beim letzten Export (spart das HTML im Speicher)
  function pruefwert(t) {
    let h = 0x811c9dc5;
    const s = String(t);
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return h.toString(16) + ':' + s.length;
  }
  function pruefwerte(pk) { const r = {}; felder(pk).forEach((w, k) => { r[k] = pruefwert(w); }); return r; }
  // Anzahl geänderter Objekte (Versionen, Ordner, Seiten) gegenüber einem Bezug (Paket oder Prüfwerte vom letzten Export).
  // Eine neue oder gelöschte Version zählt einmal (nicht ihr Inhalt). Zähler zählen nicht.
  function aenderungenZahl(bezug, pk) {
    const a = bezug && !bezug.versionen ? new Map(Object.entries(bezug)) : null;   // Prüfwerte
    const fb = a ? null : felder(bezug), fl = felder(pk);
    const wert = (k) => (a ? (a.has(k) ? a.get(k) : undefined) : (fb.has(k) ? pruefwert(fb.get(k)) : undefined));
    const schluessel = new Set(a ? Array.from(a.keys()) : Array.from(fb.keys()));
    fl.forEach((w, k) => schluessel.add(k));
    const versionNeu = new Set(), objekte = new Set();
    schluessel.forEach((k) => {
      if (k[0] !== 'V' || !k.endsWith('|da')) return;
      const l = fl.has(k) ? '1' : undefined, b = wert(k);
      if ((l === undefined) !== (b === undefined)) versionNeu.add(k.split('|')[1]);
    });
    versionNeu.forEach((n) => objekte.add('V|' + n));
    schluessel.forEach((k) => {
      if (k[0] === 'Z') return;
      if (versionNeu.has(k.split('|')[1])) return;
      const l = fl.has(k) ? pruefwert(fl.get(k)) : undefined;
      if (l !== wert(k)) objekte.add(objektVon(k));
    });
    return objekte.size;
  }
  // Paket aus Feldern bauen (Umkehrung von felder): oben = Paket, dessen oberste Felder (Format, Fassung, Stand, CSS …)
  // gelten; reihe = Pakete, deren Reihenfolge von Ordnern und Seiten gilt (die erste zuerst, Neues hinten).
  function ausFeldern(f, oben, reihe) {
    const p = (k) => JSON.parse(f.get(k));
    const aus = {};
    Object.keys(oben).forEach((k) => { if (k !== 'versionen' && k !== 'medien') aus[k] = oben[k]; });
    const nummern = [];
    f.forEach((w, k) => { const t = k.split('|'); if (t[0] === 'V' && t[2] === 'da') nummern.push(t[1]); });
    nummern.sort(vergleicheNummer);
    const ordnung = (art, nr) => {
      const r = [];
      for (const pk of reihe || []) {
        const v = version(pk, nr);
        if (!v) continue;
        for (const x of (art === 'O' ? v.ordner : v.seiten)) if (r.indexOf(x.id) < 0) r.push(x.id);
      }
      return r;
    };
    aus.versionen = nummern.map((nr) => {
      const ids = (art) => {
        const da = [];
        const vor = art + '|' + nr + '|';
        f.forEach((w, k) => { if (k.indexOf(vor) === 0 && k.endsWith('|da')) da.push(k.slice(vor.length, -3)); });
        const o = ordnung(art, nr);
        return da.sort((a, b) => { const x = o.indexOf(a), y = o.indexOf(b); return (x < 0 ? 1e9 : x) - (y < 0 ? 1e9 : y) || (a < b ? -1 : a > b ? 1 : 0); });
      };
      const v = { nummer: nr, beschreibung: p('V|' + nr + '|beschreibung'), ausgeblendet: p('V|' + nr + '|ausgeblendet'),
        zaehler: f.has('Z|' + nr) ? p('Z|' + nr) : { seite: 0, ordner: 0 } };
      v.ordner = ids('O').map((id) => {
        const k = 'O|' + nr + '|' + id + '|';
        return Object.assign({ id: id, name: p(k + 'name'), eltern: p(k + 'eltern') }, p(k + 'extra'));
      });
      v.seiten = ids('P').map((id) => {
        const k = 'P|' + nr + '|' + id + '|', m = p(k + 'meta');
        const s = { id: id, art: m.art, titel: p(k + 'titel'), herkunft: m.herkunft, vorlage: m.vorlage, ordner: p(k + 'ordner'),
          ausgeblendet: p(k + 'ausgeblendet'), breite: m.breite, hoehe: m.hoehe, html: p(k + 'html') };
        Object.keys(m).forEach((x) => { if (!(x in s)) s[x] = m[x]; });
        return s;
      });
      Object.assign(v, p('V|' + nr + '|extra'));
      return v;
    });
    // F3b: Bibliothek (Reihenfolge wie in reihe, Neues hinten); unbekannte Felder des medien-Objekts aus oben
    if (f.has('Z|*')) {
      const reiheM = (art) => {
        const r = [];
        for (const pk of reihe || []) {
          const mm = pk && pk.medien;
          if (!mm) continue;
          for (const x of (art === 'MO' ? mm.ordner : mm.dateien) || []) if (r.indexOf(x.id) < 0) r.push(x.id);
        }
        return r;
      };
      const idsM = (art) => {
        const da = [], vor = art + '|*|';
        f.forEach((w, k) => { if (k.indexOf(vor) === 0 && k.endsWith('|da')) da.push(k.slice(vor.length, -3)); });
        const o = reiheM(art);
        const nummer = (id) => Number(String(id).replace(/^\D+/, '')) || 0;
        return da.sort((a, b) => { const x = o.indexOf(a), y = o.indexOf(b); return (x < 0 ? 1e9 : x) - (y < 0 ? 1e9 : y) || nummer(a) - nummer(b); });
      };
      const alt = oben && oben.medien && typeof oben.medien === 'object' ? oben.medien : {};
      const medien = {};
      Object.keys(alt).forEach((k) => { if (k !== 'zaehler' && k !== 'ordner' && k !== 'dateien') medien[k] = alt[k]; });
      medien.zaehler = p('Z|*');
      medien.ordner = idsM('MO').map((id) => {
        const k = 'MO|*|' + id + '|';
        return Object.assign({ id: id, name: p(k + 'name'), eltern: p(k + 'eltern') }, p(k + 'extra'));
      });
      medien.dateien = idsM('M').map((id) => {
        const k = 'M|*|' + id + '|';
        return Object.assign({ id: id, name: p(k + 'name'), ordner: p(k + 'ordner') }, p(k + 'meta'));
      });
      aus.medien = medien;
    }
    return aus;
  }
  // Verweise nach einem Abgleich/Einspielen in Ordnung bringen und berichten (nie still): Zuordnung zu einem fehlenden
  // Ordner fällt weg, fehlender Elternordner → oberste Ebene, Ordner-Kreis → der erste Ordner im Kreis wandert nach oben;
  // Zähler nie kleiner als die höchste vergebene Kennung. → [{ art, nummer, id, ordner }]
  function verweise(pk) {
    const bericht = [];
    for (const v of pk.versionen) {
      const ids = new Set(v.ordner.map((o) => o.id));
      for (const o of v.ordner) if (o.eltern !== null && !ids.has(o.eltern)) { bericht.push({ art: 'eltern', nummer: v.nummer, id: o.id, ordner: o.eltern }); o.eltern = null; }
      for (const o of v.ordner) {
        const gesehen = new Set([o.id]);
        let x = o.eltern === null ? null : v.ordner.find((y) => y.id === o.eltern);
        while (x) {
          if (gesehen.has(x.id)) { bericht.push({ art: 'kreis', nummer: v.nummer, id: o.id, ordner: o.eltern }); o.eltern = null; break; }
          gesehen.add(x.id);
          x = x.eltern === null ? null : v.ordner.find((y) => y.id === x.eltern);
        }
      }
      for (const s of v.seiten) {
        const weg = s.ordner.filter((o) => !ids.has(o));
        for (const o of weg) bericht.push({ art: 'zuordnung', nummer: v.nummer, id: s.id, ordner: o });
        if (weg.length) s.ordner = s.ordner.filter((o) => ids.has(o));
      }
      const hoechste = (re, liste) => liste.reduce((m, x) => { const r = re.exec(x.id); return r ? Math.max(m, Number(r[1])) : m; }, 0);
      v.zaehler = { seite: Math.max(v.zaehler.seite, hoechste(/^N([1-9]\d*)$/, v.seiten.filter((x) => x.herkunft === 'eigen'))),
        ordner: Math.max(v.zaehler.ordner, hoechste(/^O([1-9]\d*)$/, v.ordner)) };
    }
    // F3b: Bibliothek wie die Ordner einer Version (Zuordnung zu fehlendem Ordner fällt weg, Kreis → oberste Ebene)
    const m = pk.medien;
    if (m && Array.isArray(m.ordner) && Array.isArray(m.dateien)) {
      const ids = new Set(m.ordner.map((o) => o.id));
      for (const o of m.ordner) if (o.eltern !== null && !ids.has(o.eltern)) { bericht.push({ art: 'eltern', nummer: BIBLIOTHEK, id: o.id, ordner: o.eltern }); o.eltern = null; }
      for (const o of m.ordner) {
        const gesehen = new Set([o.id]);
        let x = o.eltern === null ? null : m.ordner.find((y) => y.id === o.eltern);
        while (x) {
          if (gesehen.has(x.id)) { bericht.push({ art: 'kreis', nummer: BIBLIOTHEK, id: o.id, ordner: o.eltern }); o.eltern = null; break; }
          gesehen.add(x.id);
          x = x.eltern === null ? null : m.ordner.find((y) => y.id === x.eltern);
        }
      }
      for (const d of m.dateien) {
        const weg = d.ordner.filter((o) => !ids.has(o));
        for (const o of weg) bericht.push({ art: 'zuordnung', nummer: BIBLIOTHEK, id: d.id, ordner: o });
        if (weg.length) d.ordner = d.ordner.filter((o) => ids.has(o));
      }
      const hoechste = (re, liste) => liste.reduce((n, x) => { const r = re.exec(x.id); return r ? Math.max(n, Number(r[1])) : n; }, 0);
      const z = m.zaehler || { datei: 0, ordner: 0 };
      m.zaehler = { datei: Math.max(z.datei || 0, hoechste(/^m([1-9]\d*)$/, m.dateien)), ordner: Math.max(z.ordner || 0, hoechste(/^mo([1-9]\d*)$/, m.ordner)) };
    }
    return bericht;
  }
  // Struktur-Änderungen einer Version gegenüber der Basis (für „Änderungen sichern“): [{ k, alt, neu }] (null = fehlt)
  function feldAenderungen(basis, pk, nummer) {
    const fb = felder(basis), fl = felder(pk), r = [];
    const meins = (k) => k.split('|')[1] === nummer;
    const ks = new Set();
    fb.forEach((w, k) => { if (meins(k)) ks.add(k); });
    fl.forEach((w, k) => { if (meins(k)) ks.add(k); });
    Array.from(ks).sort().forEach((k) => {
      const b = fb.has(k) ? fb.get(k) : null, l = fl.has(k) ? fl.get(k) : null;
      if (b !== l) r.push({ k: k, alt: b, neu: l });
    });
    return r;
  }
  /* ---------- Zusammenführen (Einspielen, Teil D; Abgleich, Teil E) ---------- */
  // Felder eines Objekts (bei einer Version: alles in ihr, auch Ordner und Seiten) in einer Feld-Liste
  function gehoertZu(k, objekt) {
    const t = objekt.split('|');
    if (t[0] === 'V') { const u = k.split('|'); return u[1] === t[1] && u[0] !== 'Z'; }
    return k.indexOf(objekt + '|') === 0;
  }
  function wert(f, k) { return f && f.has(k) ? f.get(k) : null; }
  function maxZaehler(a, b) {
    if (a === null) return b;
    if (b === null) return a;
    const x = JSON.parse(a), y = JSON.parse(b);
    if ('datei' in x || 'datei' in y) return JSON.stringify({ datei: Math.max(x.datei || 0, y.datei || 0), ordner: Math.max(x.ordner || 0, y.ordner || 0) });   // F3b: Bibliothek
    return JSON.stringify({ seite: Math.max(x.seite, y.seite), ordner: Math.max(x.ordner, y.ordner) });
  }
  // Struktur zusammenführen: fb = Felder der Basis, fl = lokal, fa = die andere Seite (online bzw. Sicherung).
  // modus 'abgleich' (Teil E, je Feld drei Stände): lokal = online → fertig; lokal = Basis → online übernehmen;
  //   online = Basis → lokal bleibt; sonst Konflikt (bis zur Wahl gilt lokal).
  // modus 'sicherung' (Teil D, wie bei Texten): eigene Änderung (lokal ≠ Basis) geht vor; Basis = neu → entfällt;
  //   Basis = alt (opt.alt) → übernehmen; sonst Konflikt. Nur die Felder der Sicherung (opt.schluessel).
  // Danach je Objekt (Version, Ordner, Seite): Löschen von der anderen Seite, während lokal etwas daran geändert ist
  // (Feld oder opt.eigene(objekt): Texte/Status), wird zum Konflikt statt zur Löschung; Änderungen der anderen Seite an
  // einem lokal gelöschten Objekt ebenso. Fehlende Ordner, auf die verwiesen wird, und Ordner-Kreise werden ebenfalls
  // zu Konflikten (nichts geht still verloren). Zähler: das Maximum.
  // → { felder: Map, konflikte: [{ objekt, lokal: {k: w|null}, andere: {k: w|null} }], uebernommen, verworfen }
  function zusammenfuehren(fb, fl, fa, opt) {
    const o = opt || {};
    const m = new Map(fl), eigene = typeof o.eigene === 'function' ? o.eigene : () => false;
    const setze = (k, w) => { if (w === null || w === undefined) m.delete(k); else m.set(k, w); };
    let schluessel = o.schluessel;
    if (!schluessel) { const u = new Set(fb.keys()); fl.forEach((w, k) => u.add(k)); fa.forEach((w, k) => u.add(k)); schluessel = Array.from(u); }
    const imUmfang = new Set(schluessel);
    // Wert der anderen Seite; Felder außerhalb des Umfangs (Sicherung: nicht in der Datei) gelten als lokal
    const anders = (k) => (imUmfang.has(k) ? wert(fa, k) : wert(fl, k));
    const genommen = new Set(), konfliktFelder = new Set();
    let uebernommen = 0, verworfen = 0;
    for (const k of schluessel) {
      const b = wert(fb, k), l = wert(fl, k), t = anders(k);
      if (k[0] === 'Z') { const z = maxZaehler(l, t); if (z !== l) setze(k, z); continue; }
      if (o.modus === 'sicherung') {
        if (l !== b || b === t) { verworfen++; continue; }
        if (b === wert(o.alt, k)) { setze(k, t); genommen.add(k); uebernommen++; continue; }
        konfliktFelder.add(k);
      } else {
        if (l === t) continue;
        if (l === b) { setze(k, t); genommen.add(k); uebernommen++; continue; }
        if (t === b) continue;
        konfliktFelder.add(k);
      }
    }
    const konflikte = new Map();   // objekt → { objekt, lokal, andere }
    const konflikt = (objekt, keys) => {
      if (!konflikte.has(objekt)) konflikte.set(objekt, { objekt: objekt, lokal: {}, andere: {} });
      const kk = konflikte.get(objekt);
      for (const k of keys) {
        if (!(k in kk.lokal)) kk.lokal[k] = wert(fl, k);
        if (!(k in kk.andere)) kk.andere[k] = anders(k);
      }
    };
    const alleFelder = (objekt) => {
      const r = new Set();
      for (const f of [fb, fl, fa]) f.forEach((w, k) => { if (gehoertZu(k, objekt)) r.add(k); });
      return Array.from(r);
    };
    // Feld-Konflikte je Objekt
    for (const k of konfliktFelder) konflikt(objektVon(k), [k]);
    // Objekte, deren Dasein sich durch die andere Seite änderte oder lokal anders ist
    const objekte = new Set();
    for (const k of schluessel) if (k.endsWith('|da')) objekte.add(objektVon(k));
    for (const objekt of objekte) {
      const da = objekt + '|da', l = wert(fl, da), t = anders(da);
      const felderO = alleFelder(objekt);
      const lokalGeaendert = felderO.some((k) => k !== da && wert(fl, k) !== wert(fb, k)) || eigene(objekt);
      if (l === '1' && !m.has(da) && genommen.has(da) && lokalGeaendert) {
        // Löschen von der anderen Seite, lokal geändert → lokal bleibt, Konflikt
        for (const k of felderO) setze(k, wert(fl, k));
        konflikt(objekt, felderO);
      } else if (l === null && t === '1' && felderO.some((k) => konfliktFelder.has(k) || (genommen.has(k) && !m.has(da)))) {
        // lokal gelöscht, die andere Seite hat es geändert → bleibt gelöscht, Konflikt über das ganze Objekt
        for (const k of felderO) if (!m.has(da)) m.delete(k);
        konflikt(objekt, felderO);
      } else if (konflikte.has(objekt) && (l === null) !== (t === null)) {
        konflikt(objekt, felderO);   // Wahl soll das Objekt ganz herstellen bzw. ganz löschen
      }
    }
    // Fehlende Ordner, auf die verwiesen wird
    // F3b: Dateien der Bibliothek verweisen auf Bibliotheks-Ordner (MO), Seiten auf Ordner ihrer Version (O)
    const ordnerArt = (art) => (art === 'M' || art === 'MO' ? 'MO' : 'O');
    const ordnerDa = (oa, nr, id) => m.has(oa + '|' + nr + '|' + id + '|da');
    const verweis = [];
    m.forEach((w, k) => {
      const t = k.split('|');
      if ((t[0] === 'P' || t[0] === 'M') && k.endsWith('|ordner')) for (const id of JSON.parse(w)) { if (!ordnerDa(ordnerArt(t[0]), t[1], id)) verweis.push({ k: k, nr: t[1], id: id, oa: ordnerArt(t[0]) }); }
      if ((t[0] === 'O' || t[0] === 'MO') && k.endsWith('|eltern')) { const e = JSON.parse(w); if (e !== null && !ordnerDa(t[0], t[1], e)) verweis.push({ k: k, nr: t[1], id: e, oa: t[0] }); }
    });
    for (const v of verweis) {
      const obj = v.oa + '|' + v.nr + '|' + v.id, felderO = alleFelder(obj);
      if (wert(fl, obj + '|da') === '1') {
        // die andere Seite löschte den Ordner, lokal wird auf ihn verwiesen → Ordner bleibt (lokal), Konflikt
        for (const k of felderO) setze(k, wert(fl, k));
        konflikt(obj, felderO.concat([v.k]));
      } else {
        // lokal gelöscht, die andere Seite verweist auf ihn → Verweis fällt (lokal), Konflikt stellt ihn auf Wunsch her
        const w = JSON.parse(m.get(v.k));
        const lokalWert = Array.isArray(w) ? JSON.stringify(w.filter((x) => x !== v.id)) : 'null';
        konflikt(obj, felderO.concat([v.k]));
        const kk = konflikte.get(obj);
        kk.lokal[v.k] = lokalWert;
        if (!(v.k in kk.andere) || kk.andere[v.k] === null) kk.andere[v.k] = m.get(v.k);
        m.set(v.k, lokalWert);
      }
    }
    // Ordner-Kreise (lokal A in B verschoben, online B in A): übernommene Elternordner im Kreis → lokal, Konflikt
    const kreisPruefen = () => {
      const vers = new Set();
      m.forEach((w, k) => { const t = k.split('|'); if ((t[0] === 'O' || t[0] === 'MO') && k.endsWith('|eltern')) vers.add(t[0] + '|' + t[1]); });
      for (const vk of vers) {
        const oa = vk.split('|')[0], nr = vk.split('|')[1];
        const eltern = new Map();
        m.forEach((w, k) => { const t = k.split('|'); if (t[0] === oa && t[1] === nr && t[t.length - 1] === 'eltern') eltern.set(t.slice(2, -1).join('|'), JSON.parse(w)); });
        for (const start of eltern.keys()) {
          const weg = [];
          let x = start;
          while (x !== null && eltern.has(x) && weg.indexOf(x) < 0) { weg.push(x); x = eltern.get(x); }
          if (x === null || !eltern.has(x)) continue;
          const kreis = weg.slice(weg.indexOf(x));
          const ks = kreis.map((id) => oa + '|' + nr + '|' + id + '|eltern');
          const fremd = ks.filter((k) => genommen.has(k));
          const zurueck = fremd.length ? fremd : [ks[0]];
          for (const k of zurueck) { setze(k, fremd.length ? wert(fl, k) : 'null'); genommen.delete(k); }
          for (const k of ks) konflikt(objektVon(k), [k]);
          return true;
        }
      }
      return false;
    };
    for (let i = 0; i < 50 && kreisPruefen(); i++) { /* bis kein Kreis mehr */ }
    return { felder: m, konflikte: Array.from(konflikte.values()), uebernommen: uebernommen, verworfen: verworfen };
  }
  // Wahl in einem Struktur-Konflikt anwenden: Felder f (Map) auf die Werte der gewählten Seite setzen
  function waehle(f, k, wahl) {
    const m = new Map(f), werte = wahl === 'andere' ? k.andere : k.lokal;
    Object.keys(werte).forEach((x) => { if (werte[x] === null) m.delete(x); else m.set(x, werte[x]); });
    return m;
  }
  // Text für die Konfliktliste: Objekt („Seite S5 · Titel“) und je Feld „Name“, Wert lokal, Wert der anderen Seite
  const FELDNAMEN = { da: 'vorhanden', beschreibung: 'Beschreibung', ausgeblendet: 'ausgeblendet', extra: 'weitere Angaben', name: 'Name',
    eltern: 'Elternordner', titel: 'Name', ordner: 'In Ordner', html: 'Inhalt', meta: 'Art und Maße' };
  // F3b: Kenndaten einer Datei der Bibliothek (meta) kurz statt als JSON
  function metaText(x) {
    if (!x || typeof x !== 'object' || typeof x.art !== 'string' || typeof x.groesse !== 'number') return JSON.stringify(x);
    return x.art + ' · ' + x.groesse + ' Bytes' + (typeof x.gitSha === 'string' ? ' · ' + x.gitSha.slice(0, 7) : '') + (x.startbild !== null && x.startbild !== undefined ? ' · Startbild ' + x.startbild + ' s' : '');
  }
  function konfliktText(k, fl, fa) {
    const t = k.objekt.split('|');
    const titelK = t[0] === 'P' ? k.objekt + '|titel' : (t[0] === 'O' || t[0] === 'M' || t[0] === 'MO') ? k.objekt + '|name' : null;
    const tw = titelK ? (k.lokal[titelK] || k.andere[titelK] || wert(fl, titelK) || wert(fa, titelK)) : null;
    const name = tw ? JSON.parse(tw) : '';
    const was = t[0] === 'V' ? 'Version ' + t[1]
      : (t[0] === 'M' || t[0] === 'MO') ? (t[0] === 'M' ? 'Datei ' : 'Ordner ') + t.slice(2).join('|') + (name ? ' · ' + name : '') + ' (Bibliothek)'
        : (t[0] === 'O' ? 'Ordner ' : 'Seite ') + t.slice(2).join('|') + (name ? ' · ' + name : '') + ' (Version ' + t[1] + ')';
    const zeile = (feld, w) => {
      if (w === null) return feld === 'da' ? 'nicht vorhanden' : '–';
      if (feld === 'da') return 'vorhanden';
      const x = JSON.parse(w);
      if (typeof x === 'boolean') return x ? 'ja' : 'nein';
      if (feld === 'html') return 'Inhalt (' + x.length + ' Zeichen)';
      if (Array.isArray(x)) return x.length ? x.join(', ') : '(keiner)';
      if (x === null) return feld === 'eltern' ? 'oberste Ebene' : '–';
      if (feld === 'meta') return metaText(x);
      if (typeof x === 'object') return JSON.stringify(x);
      return String(x) === '' ? '(leer)' : String(x);
    };
    const felderK = Array.from(new Set(Object.keys(k.lokal).concat(Object.keys(k.andere))));
    const da = felderK.find((x) => x.endsWith('|da'));
    // Beim Dasein eines Objekts nur die sprechenden Felder (Name, Zuordnungen), keine Nebenangaben
    const neben = new Set(['extra', 'meta', 'html', 'eltern', 'ausgeblendet', 'beschreibung']);
    const reihe = (da ? [da] : []).concat(felderK.filter((x) => x !== da && k.lokal[x] !== k.andere[x] &&
      (!da || x.indexOf(k.objekt + '|') !== 0 || !neben.has(x.split('|').pop()) || (k.lokal[x] !== null && k.andere[x] !== null))));
    return {
      was: was,
      zeilen: reihe.map((x) => {
        const feld = x.split('|').pop(), fremd = x.indexOf(k.objekt + '|') !== 0;
        const fn = fremd ? 'Zuordnung ' + x.split('|').slice(2, -1).join('|') : (FELDNAMEN[feld] || feld);
        return { feld: fn, lokal: zeile(feld, k.lokal[x]), andere: zeile(feld, k.andere[x]) };
      })
    };
  }
  // Gleicher Stand (alle Felder samt Zähler)?
  function gleich(a, b) {
    const fa = felder(a), fb = felder(b);
    if (fa.size !== fb.size) return false;
    for (const [k, w] of fa) if (fb.get(k) !== w) return false;
    return true;
  }

  window.AetherFlyerStruktur = Object.freeze({
    STANDARD_VERSION: STANDARD_VERSION,
    BIBLIOTHEK: BIBLIOTHEK,
    MEDIUM_STIL: MEDIUM_STIL,
    MAX_BESCHREIBUNG: MAX_BESCHREIBUNG,
    version: version,
    versionsOrdner: versionsOrdner,
    sicht: sicht,
    // Versionen
    vergleicheNummer: vergleicheNummer,
    versionsGruppen: versionsGruppen,
    naechsteUnterversion: naechsteUnterversion,
    naechsteHauptversion: naechsteHauptversion,
    versionKopieren: versionKopieren,
    versionBeschreiben: versionBeschreiben,
    versionAusblenden: versionAusblenden,
    versionLoeschen: versionLoeschen,
    seitenZahl: seitenZahl,
    // Seiten
    VORLAGEN: VORLAGEN,
    MAX_SEITENNAME: MAX_SEITENNAME,
    vorlageHtml: vorlageHtml,
    kopieHtml: kopieHtml,
    seiteAnlegen: seiteAnlegen,
    seiteUmbenennen: seiteUmbenennen,
    seiteInOrdner: seiteInOrdner,
    seiteAusblenden: seiteAusblenden,
    seiteLoeschen: seiteLoeschen,
    // Ordner
    MAX_ORDNERNAME: MAX_ORDNERNAME,
    kinderOrdner: kinderOrdner,
    seitenIn: seitenIn,
    pfad: pfad,
    nachfahren: nachfahren,
    ordnerBaum: ordnerBaum,
    ordnerZahlen: ordnerZahlen,
    ordnerAnlegen: ordnerAnlegen,
    ordnerUmbenennen: ordnerUmbenennen,
    ordnerVerschieben: ordnerVerschieben,
    ordnerLoeschen: ordnerLoeschen,
    neueKennung: neueKennung,
    // Felder
    felder: felder,
    objektVon: objektVon,
    pruefwert: pruefwert,
    pruefwerte: pruefwerte,
    aenderungenZahl: aenderungenZahl,
    ausFeldern: ausFeldern,
    verweise: verweise,
    feldAenderungen: feldAenderungen,
    zusammenfuehren: zusammenfuehren,
    waehle: waehle,
    konfliktText: konfliktText,
    gleich: gleich
  });
})();
