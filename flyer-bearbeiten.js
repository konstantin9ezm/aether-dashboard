// Bearbeiten der Flyer-Seite (flyer.html, Teil 2): Umschalter „Ansehen | Text | Status“ im Vollbild, Bearbeitungsleiste
// (Text: mehrzeiliges Feld, Übernehmen/Abbrechen/Original, Cmd/Strg+Enter, Esc) und Status-Auswahl (fertig, läuft
// gerade, als Nächstes, geplant, ohne Status), dazu Konfliktliste nach einem Abgleich, „Paket exportieren“ samt Hilfe
// „Online stellen“, „Änderungen sichern“, „Änderungen einspielen“ und „Alle Änderungen verwerfen“.
// Die Werte selbst verwaltet AetherFlyerAenderungen (flyer-aenderungen.js); hier wird nur bedient und neu dargestellt
// (AetherFlyerAnsicht.aktualisiere: Kachel und Vollbild samt Schriftanpassung). Geänderte Stellen sind nur in den
// Modi Text und Status markiert; Kacheln, Druck und Bild zeigen die Änderungen ohne Markierung.
// Nichts hier schreibt in ein Repo: Der Export ist eine Datei, die Konstantin selbst im Repo aether hochlädt.
// Weitergabe wie beim Bild: Teilen-Dialog (navigator.share mit Datei), sonst Download (Blob-URL wird freigegeben),
// sonst ein Dialog mit Link. Das Token kommt hier nie vor.
(function () {
  'use strict';

  const MODI = ['ansehen', 'text', 'status'];
  const STATUS_NAMEN = { ok: 'fertig', run: 'läuft gerade', next: 'als Nächstes', plan: 'geplant', '': 'ohne Status' };
  const DATEI_PAKET = 'aether-flyer-paket.json';
  const DATEI_SICHERUNG = 'aether-flyer-aenderungen.json';
  const COMMIT = (f) => 'Flyer-Paket ' + f + ' [skip ci]';

  const $ = (id) => document.getElementById(id);
  const G = () => window.AetherGemeinsam;
  const A = () => window.AetherFlyerAnsicht || null;
  const AE = () => window.AetherFlyerAenderungen || null;
  const EX = () => window.AetherFlyerExport || null;

  /* ---------- Zustand ---------- */
  let h = null;                 // Hilfen von flyer.js: paket(), onlineVersion(), fehler(), fehlerWeg(), kopf()
  let modus = 'ansehen';
  let offen = null;             // offene Leiste: { art:'text'|'status', dok, k }
  let onlineVersion = null;     // zuletzt bekannte Online-Fassung (für die Fassungszählung, ohne Warten im Klick)
  let listeOffen = false;       // Konfliktliste aufgeklappt?
  let eingerichtet = false;

  /* ---------- Hilfen ---------- */
  function meldung(t) { try { G().meldung(t); } catch (e) { /* ohne #toast */ } }
  function leeren(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function el(tag, text, klasse) { const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (klasse) e.className = klasse; return e; }
  function paket() { try { return h ? h.paket() : null; } catch (e) { return null; } }
  function offenesDok() { const a = A(); return a ? a.offenesDokument() : null; }
  function fehlerZeigen(e) {
    const t = (e && e.title) || 'Unerwarteter Fehler.', x = (e && e.text) || (e && !e.title ? String(e.message || e) : '');
    try { h.fehler(t, x, false); } catch (z) { meldung(t); }
  }
  function kurz(t) { t = String(t === null || t === undefined ? '' : t).replace(/\s+/g, ' ').trim(); return t.length > 60 ? t.slice(0, 59) + '…' : t; }
  // Neu darstellen: Kachel und (offenes) Vollbild der betroffenen Dokumente
  function neuDarstellen(doks) {
    const a = A();
    if (!a || typeof a.aktualisiere !== 'function') return Promise.resolve();
    return Promise.all(Array.from(new Set(doks)).map((d) => a.aktualisiere(d).catch(() => null)));
  }

  /* ---------- Modus ---------- */
  function setzeModus(m, neuZeichnen) {
    if (MODI.indexOf(m) < 0) m = 'ansehen';
    const war = modus;
    modus = m;
    leisteZu(false);
    const box = $('vbModus');
    if (box) for (const b of box.querySelectorAll('button[data-modus]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-modus') === m));
    knopfReset();
    // Markierungen gibt es nur in Text/Status: beim Wechsel das Vollbild neu darstellen
    if (neuZeichnen !== false && war !== m && A() && offenesDok()) A().vollbildNeu();
  }
  function knopfReset() {
    const r = $('vbReset');
    if (!r) return;
    const d = offenesDok();
    r.hidden = modus === 'ansehen' || !d || !AE().hatAenderungen(d.id);
  }

  /* ---------- Leisten (Text, Status) ---------- */
  function leisteZu(fokusZurueck) {
    const war = offen;
    offen = null;
    const e = $('vbEdit'), s = $('vbStatus');
    if (e) e.hidden = true;
    if (s) s.hidden = true;
    if (war && fokusZurueck !== false) {
      const b = $('vbBuehne');
      if (b) { try { b.focus({ preventScroll: true }); } catch (x) { /* egal */ } }
    }
  }
  function oeffneText(dok, k) {
    const ae = AE();
    const wert = ae.aktuellerWert(dok.id, 'text', k);
    if (wert === null) return;
    offen = { art: 'text', dok: dok, k: k };
    $('vbStatus').hidden = true;
    $('vbEditLabel').textContent = dok.id + ' · Text ' + k + (ae.geaendert(dok.id, 'text', k) ? ' (geändert)' : '');
    const feld = $('vbEditFeld');
    feld.value = wert;
    $('vbEditOrig').disabled = !ae.geaendert(dok.id, 'text', k);
    $('vbEdit').hidden = false;
    try { feld.focus({ preventScroll: true }); } catch (x) { /* egal */ }
  }
  function oeffneStatus(dok, k) {
    const ae = AE();
    const wert = ae.aktuellerWert(dok.id, 'status', k);
    if (wert === null) return;
    offen = { art: 'status', dok: dok, k: k };
    $('vbEdit').hidden = true;
    $('vbStatusLabel').textContent = dok.id + ' · Status ' + k + ': ' + (STATUS_NAMEN[wert] || wert) + (ae.geaendert(dok.id, 'status', k) ? ' (geändert)' : '');
    for (const b of $('vbStatus').querySelectorAll('button[data-status]')) b.setAttribute('aria-pressed', String(b.getAttribute('data-status') === wert));
    $('vbStatus').hidden = false;
    const gewaehlt = $('vbStatus').querySelector('button[aria-pressed="true"]');
    if (gewaehlt) { try { gewaehlt.focus({ preventScroll: true }); } catch (x) { /* egal */ } }
  }
  // Nach jeder Änderung: speichern (AetherFlyerAenderungen), Dokument neu darstellen inkl. Schriftanpassung
  async function aendern(art, wert, original) {
    const o = offen;
    if (!o) return;
    leisteZu();
    try {
      if (original) await AE().original(o.dok.id, art, o.k);
      else await AE().setze(o.dok.id, art, o.k, wert);
    } catch (e) { fehlerZeigen(e); }
    if (!AE().gespeichert()) meldung('Änderung nicht offline gespeichert');
    await neuDarstellen([o.dok.id]);
    knopfReset();
  }
  function uebernehmen() { if (offen && offen.art === 'text') aendern('text', $('vbEditFeld').value, false); }

  // Klick/Antippen im Vollbild (Modi Text und Status): Element mit data-t bzw. data-s im Dokument finden
  function klickImDokument(ev) {
    if (modus === 'ansehen') return;
    const a = A(), dok = offenesDok();
    const host = a && typeof a.vollbildHost === 'function' ? a.vollbildHost() : null;
    if (!dok || !host || !host.shadowRoot) return;
    const attr = modus === 'text' ? 'data-t' : 'data-s';
    const pfad = typeof ev.composedPath === 'function' ? ev.composedPath() : [];
    let treffer = null;
    for (const n of pfad) {
      if (n === host) break;
      if (n && n.nodeType === 1 && n.hasAttribute(attr) && n.getRootNode() === host.shadowRoot) { treffer = n; break; }
    }
    if (!treffer) return;
    ev.preventDefault();   // z. B. ein Link „#…“ im Dokument: im Bearbeiten nicht folgen
    const k = treffer.getAttribute(attr);
    if (modus === 'text') oeffneText(dok, k); else oeffneStatus(dok, k);
  }

  /* ---------- Tasten ---------- */
  function tasteFeld(e) {
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); uebernehmen(); return; }
    if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!e.repeat) leisteZu(); }
    // Pfeile, Backspace usw. gehören dem Feld: die Ansicht blättert und schließt nicht (Texteingabe hat den Fokus)
  }
  // Leiste offen und der Fokus nicht im Textfeld: Esc/Backspace schließen nur die Leiste (vor der Ansicht, die sonst das
  // Vollbild schlösse). Im Feld behandelt tasteFeld Esc; Backspace löscht dort nur Zeichen.
  function tasteFenster(e) {
    if (!offen || e.metaKey || e.ctrlKey || e.altKey) return;
    if (e.key !== 'Escape' && e.key !== 'Backspace') return;
    const m = $('modal');
    if (m && !m.hidden) return;
    const akt = document.activeElement;
    if (akt === $('vbEditFeld')) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) leisteZu();
  }

  async function dokumentZuruecksetzen() {
    const d = offenesDok();
    if (!d || !AE().hatAenderungen(d.id)) return false;
    let ja = false;
    try { ja = window.confirm('Alle Änderungen an ' + d.id + ' zurücksetzen?'); } catch (e) { ja = false; }
    if (!ja) return false;
    leisteZu(false);
    await AE().dokumentZuruecksetzen(d.id);
    await neuDarstellen([d.id]);
    knopfReset();
    return true;
  }

  /* ---------- Einrichten ---------- */
  function knoepfeZeigen() {
    const n = AE().alle().length;
    const pk = !!paket();
    for (const id of ['btnExport', 'btnSichern', 'btnEinspielen', 'btnVerwerfen']) { const b = $(id); if (b) b.hidden = !pk; }
    const v = $('btnVerwerfen'); if (v) v.disabled = !n;
    const s = $('btnSichern'); if (s) s.disabled = !n;
    const hl = $('onlineStellen'); if (hl) hl.hidden = !pk;
    const m = $('vbModus'); if (m) m.hidden = false;
  }

  // h = { paket(), onlineVersion(), fehler(titel, text, mitTokenLink), fehlerWeg(), kopf() } von flyer.js
  function einrichten(hilfen) {
    h = hilfen;
    if (eingerichtet) return Promise.resolve();
    eingerichtet = true;
    const box = $('vbModus');
    if (box) for (const b of box.querySelectorAll('button[data-modus]')) b.addEventListener('click', () => setzeModus(b.getAttribute('data-modus')));
    const buehne = $('vbBuehne');
    if (buehne) buehne.addEventListener('click', klickImDokument);
    const feld = $('vbEditFeld');
    if (feld) feld.addEventListener('keydown', tasteFeld);
    $('vbEditOk').addEventListener('click', uebernehmen);
    $('vbEditAb').addEventListener('click', () => leisteZu());
    $('vbEditOrig').addEventListener('click', () => { if (offen && offen.art === 'text') aendern('text', null, true); });
    for (const b of $('vbStatus').querySelectorAll('button[data-status]')) b.addEventListener('click', () => { if (offen && offen.art === 'status') aendern('status', b.getAttribute('data-status'), false); });
    $('vbStatusAb').addEventListener('click', () => leisteZu());
    $('vbReset').addEventListener('click', () => { dokumentZuruecksetzen(); });
    window.addEventListener('keydown', tasteFenster, true);
    // Vollbild: beim Schließen zurück auf „Ansehen“; beim Blättern Leiste zu
    document.addEventListener('flyer:vollbild', (e) => {
      const d = e && e.detail;
      if (d && d.offen === false) { setzeModus('ansehen', false); return; }
      if (offen && d && d.dok && offen.dok.id !== d.dok.id) leisteZu(false);
      knopfReset();
    });
    document.addEventListener('flyer:aenderungen', () => { knoepfeZeigen(); knopfReset(); });
    document.addEventListener('flyer:kategorie', () => { knoepfeZeigen(); });
    knoepfeZeigen();
    return Promise.resolve();
  }

  window.AetherFlyerBearbeiten = Object.freeze({
    einrichten: einrichten,
    modus: () => modus,
    setzeModus: (m) => setzeModus(m),
  });
})();
