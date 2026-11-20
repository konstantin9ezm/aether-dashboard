// Struktur der Flyer-Seite (flyer.html, F3a): Versionen, Ordner und Seiten eines Pakets im Format v2
// (AetherFlyerPaket.alsV2). Reine Funktionen ohne Zustand und ohne DOM – flyer.js hält den Zustand.
// sicht(paket, nummer): eine Version so, wie Ansicht, Änderungsschicht, Druck und Bild sie brauchen – Dokumente wie im
// Format v1 (id, art, kategorie, titel, breite, hoehe, html) plus ordner, ausgeblendet, herkunft und vorlage.
(function () {
  'use strict';

  const STANDARD_VERSION = '1.1';   // der heutige Flyer; jedes Paket hat sie, sie lässt sich nie löschen

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

  window.AetherFlyerStruktur = Object.freeze({
    STANDARD_VERSION: STANDARD_VERSION,
    version: version,
    versionsOrdner: versionsOrdner,
    sicht: sicht
  });
})();
