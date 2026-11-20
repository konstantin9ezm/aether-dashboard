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

  /* ---------- Felder (Zählung der Änderungen, Abgleich) ---------- */
  // Bekannte Felder je Objekt; alles andere landet als „extra“ (JSON) im Feld des Objekts selbst (verlustfrei).
  const V_BEKANNT = new Set(['nummer', 'beschreibung', 'ausgeblendet', 'zaehler', 'ordner', 'seiten']);
  const O_BEKANNT = new Set(['id', 'name', 'eltern']);
  const P_BEKANNT = new Set(['id', 'titel', 'ordner', 'ausgeblendet', 'html']);
  function extra(o, bekannt) { const r = {}; Object.keys(o).sort().forEach((k) => { if (!bekannt.has(k)) r[k] = o[k]; }); return r; }
  // Schlüssel: V|<nr>|<feld>, O|<nr>|<id>|<feld>, P|<nr>|<id>|<feld>; Z|<nr> = zaehler (zählt nicht als Änderung).
  // Felder „da“ gibt es genau, wenn das Objekt existiert.
  function felder(pk) {
    const f = new Map(), j = (x) => JSON.stringify(x);
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
    if (t[0] === 'O' || t[0] === 'P') return t[0] + '|' + t[1] + '|' + t.slice(2, -1).join('|');
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
  // Gleicher Stand (alle Felder samt Zähler)?
  function gleich(a, b) {
    const fa = felder(a), fb = felder(b);
    if (fa.size !== fb.size) return false;
    for (const [k, w] of fa) if (fb.get(k) !== w) return false;
    return true;
  }

  window.AetherFlyerStruktur = Object.freeze({
    STANDARD_VERSION: STANDARD_VERSION,
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
    // Felder
    felder: felder,
    objektVon: objektVon,
    pruefwert: pruefwert,
    pruefwerte: pruefwerte,
    aenderungenZahl: aenderungenZahl,
    gleich: gleich
  });
})();
