// Übersicht der Flyer-Seite (flyer.html, F3a): Knopf „Version <n> ▾“ mit der Tafel „Versionen“ (Versions-Ordner V1,
// V2 …, „+ Neue Unterversion“, „+ Neue Hauptversion“, Menü „···“ je Version) und die Tafeln dazu. Eine Tafel ist ein
// Dialog über der Seite (auch über dem Vollbild); Tafeln stapeln sich („‹“ zurück, „✕“ schließt alle).
// Tasten: Esc schließt die Tafel, Backspace geht eine Ebene zurück (beide nicht in Texteingaben).
// Die Änderungen selbst rechnet AetherFlyerStruktur auf einer Kopie, flyer.js speichert und zeigt sie (h.aendere).
// Hier wird nur bedient. Nichts aus einem Paket wird als HTML eingesetzt (nur textContent). Das Token kommt nie vor.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const G = () => window.AetherGemeinsam;
  const ST = () => window.AetherFlyerStruktur;
  const AE = () => window.AetherFlyerAenderungen || null;
  // input-Typen, die KEIN Eingabefeld sind (wie in flyer-ansicht.js)
  const KNOPF_TYPEN = ['button', 'submit', 'reset', 'image', 'hidden', 'file', 'checkbox', 'radio'];

  /* ---------- Zustand ---------- */
  let h = null;          // Hilfen von flyer.js (siehe einrichten)
  let stapel = [];       // offene Tafeln: { titel, bauen(inhalt) }
  let oeffner = null;    // Element, das die erste Tafel geöffnet hat (Fokus zurück)
  let eingerichtet = false;

  /* ---------- Hilfen ---------- */
  function meldung(t) { try { G().meldung(t); } catch (e) { /* ohne #toast */ } }
  function leeren(el) { while (el.firstChild) el.removeChild(el.firstChild); }
  function el(tag, text, klasse) { const e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = text; if (klasse) e.className = klasse; return e; }
  function knopf(text, fn, klasse) {
    const b = el('button', text, klasse);
    b.type = 'button';
    b.addEventListener('click', (ev) => { fn(ev); });
    return b;
  }
  function paket() { try { return h ? h.paketV2() : null; } catch (e) { return null; } }
  function offen() { try { return h ? h.version() : ST().STANDARD_VERSION; } catch (e) { return ST().STANDARD_VERSION; } }
  function fehlerZeigen(e) {
    const t = (e && e.title) || 'Unerwarteter Fehler.', x = (e && e.text) || (e && !e.title ? String(e.message || e) : '');
    meldung(x ? t + ' ' + x : t);
  }
  // Rückfrage (wie „Alle Änderungen verwerfen“): window.confirm
  function frage(text) { try { return window.confirm(text) === true; } catch (e) { return false; } }
  function istTexteingabe(e) {
    if (!e) return false;
    if (e.isContentEditable) return true;
    const n = String(e.localName || '').toLowerCase();
    if (n === 'input') return !KNOPF_TYPEN.includes(String(e.type || 'text').toLowerCase());
    return n === 'textarea' || n === 'select';
  }
  function zahlText(n, eins, mehr) { return n + ' ' + (n === 1 ? eins : mehr); }

  /* ---------- Tafel ---------- */
  function tafelOffen() { const t = $('tafel'); return !!t && !t.hidden; }
  // Oberste Tafel neu aufbauen (nach einer Änderung); Fokus auf den ersten Knopf, wenn nichts mehr fokussiert ist
  function zeichneTafel(fokusErster) {
    const t = $('tafel'), inhalt = $('tafelInhalt');
    if (!t || !inhalt) return;
    const oben = stapel[stapel.length - 1];
    if (!oben) { schliesseTafel(); return; }
    $('tafelTitel').textContent = oben.titel;
    $('tafelZurueck').hidden = stapel.length < 2;
    leeren(inhalt);
    try { oben.bauen(inhalt); } catch (e) { fehlerZeigen(e); }
    t.hidden = false;
    if (fokusErster !== false) {
      const erstes = inhalt.querySelector('input:not([type="checkbox"]),textarea,select') || inhalt.querySelector('button:not(:disabled)');
      try { (erstes || $('tafelZu')).focus({ preventScroll: true }); } catch (e) { /* egal */ }
    }
  }
  // Neue Tafel obenauf. bauen(inhalt) füllt das Element; titel steht im Kopf.
  function tafel(titel, bauen) {
    if (!stapel.length) oeffner = document.activeElement;
    stapel.push({ titel: titel, bauen: bauen });
    zeichneTafel();
  }
  function zurueck() {
    if (stapel.length < 2) { schliesseTafel(); return; }
    stapel.pop();
    zeichneTafel();
  }
  function schliesseTafel() {
    stapel = [];
    const t = $('tafel');
    if (t) t.hidden = true;
    const i = $('tafelInhalt');
    if (i) leeren(i);
    const o = oeffner;
    oeffner = null;
    if (o && o.isConnected) { try { o.focus({ preventScroll: true }); } catch (e) { /* egal */ } }
  }
  function neuZeichnen() { if (tafelOffen()) zeichneTafel(false); }
  function abschnitt(text) { return el('div', text, 't-abschnitt'); }

  // Eingabe in der Tafel: Feld (höchstens max Zeichen), Zähler, Hinweiszeile, „Übernehmen“ und „Abbrechen“.
  // pruefen(wert) → Fehlertext oder ''; fertig(wert) → Promise (Fehler erscheinen als Hinweis, die Tafel bleibt).
  function eingabeTafel(titel, beschriftung, wert, max, pruefen, fertig) {
    tafel(titel, (inhalt) => {
      const lab = el('label', beschriftung, 't-label');
      const feld = el('input');
      feld.type = 'text';
      feld.id = 'tafelFeld';
      feld.value = wert || '';
      feld.maxLength = max;
      feld.setAttribute('autocomplete', 'off');
      lab.htmlFor = 'tafelFeld';
      const zaehler = el('span', '', 't-zaehler');
      const hinweis = el('p', '', 't-hinweis');
      hinweis.setAttribute('role', 'alert');
      const zeige = () => { zaehler.textContent = feld.value.length + ' / ' + max; };
      zeige();
      feld.addEventListener('input', () => { zeige(); hinweis.textContent = ''; });
      const ok = async () => {
        const f = pruefen ? pruefen(feld.value) : '';
        if (f) { hinweis.textContent = f; return; }
        try { await fertig(feld.value); } catch (e) { hinweis.textContent = [(e && e.title) || 'Fehler.', e && e.text].filter(Boolean).join(' '); }
      };
      feld.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); ok(); } });
      const row = el('div', undefined, 'row');
      row.append(knopf('Übernehmen', ok, 'primary'), knopf('Abbrechen', () => zurueck()));
      inhalt.append(lab, feld, zaehler, hinweis, row);
    });
  }

  // Struktur ändern (flyer.js: Kopie → fn → prüfen → speichern → neu zeigen). Fehler: Meldung, nichts geändert.
  async function aendere(fn, erfolg) {
    try {
      const r = await h.aendere(fn);
      if (erfolg) meldung(typeof erfolg === 'function' ? erfolg(r) : erfolg);
      return r;
    } catch (e) { fehlerZeigen(e); throw e; }
  }

  /* ---------- Versionen (Teil B) ---------- */
  function versionsKnopf() {
    const z = $('versionsZeile'), b = $('btnVersion');
    if (!z || !b) return;
    const pk = paket();
    z.hidden = !pk;
    if (!pk) return;
    const v = ST().version(pk, offen());
    $('versionName').textContent = 'Version ' + offen() + ' ▾';
    $('versionZusatz').textContent = 'Ordner ' + ST().versionsOrdner(offen()) + ' · ' + zahlText(ST().seitenZahl(v), 'Seite', 'Seiten');
  }

  async function oeffneVersion(nr) {
    try { await h.oeffneVersion(nr); } catch (e) { fehlerZeigen(e); return; }
    meldung('Version ' + nr + ' geöffnet');
  }
  // Neue Version als Kopie von quelle (zeigt, was die Quelle gerade zeigt: Basis + Änderungsschicht) und öffnen
  async function neueVersion(quelle, ziel) {
    const ae = AE();
    const htmlFn = ae && typeof ae.htmlMitSchicht === 'function' ? (nr, seite) => ae.htmlMitSchicht(nr, seite) : null;
    try {
      await aendere((pk) => ST().versionKopieren(pk, quelle, ziel, htmlFn));
      await h.oeffneVersion(ziel);
      meldung('Version ' + ziel + ' angelegt (Kopie von ' + quelle + ')');
    } catch (e) { /* gemeldet */ }
    neuZeichnen();
  }

  function versionenTafel() {
    tafel('Versionen', (inhalt) => {
      const pk = paket();
      if (!pk) { inhalt.appendChild(el('p', 'Noch kein Paket.', 't-hinweis')); return; }
      const akt = offen();
      for (const g of ST().versionsGruppen(pk)) {
        inhalt.appendChild(abschnitt('Ordner ' + g.ordner));
        const liste = el('div', undefined, 't-liste');
        for (const v of g.versionen) {
          const zeile = el('div', undefined, 't-zeile' + (v.ausgeblendet ? ' abgeblendet' : ''));
          zeile.setAttribute('data-version', v.nummer);
          const auf = knopf('', () => { if (v.nummer !== offen()) oeffneVersion(v.nummer).then(neuZeichnen); }, 't-haupt');
          auf.appendChild(el('b', v.nummer));
          if (v.beschreibung) auf.appendChild(el('span', v.beschreibung, 't-text'));
          auf.appendChild(el('span', zahlText(ST().seitenZahl(v), 'Seite', 'Seiten'), 't-klein'));
          if (v.nummer === akt) { auf.appendChild(el('span', 'aktuell', 'marke aktuell')); auf.setAttribute('aria-current', 'true'); zeile.classList.add('aktuell'); }
          if (v.ausgeblendet) auf.appendChild(el('span', 'ausgeblendet', 'marke'));
          const mehr = knopf('···', () => versionMenue(v.nummer), 't-mehr');
          mehr.setAttribute('aria-label', 'Menü Version ' + v.nummer);
          zeile.append(auf, mehr);
          liste.appendChild(zeile);
        }
        inhalt.appendChild(liste);
      }
      const unter = ST().naechsteUnterversion(pk, akt), haupt = ST().naechsteHauptversion(pk);
      const neu = el('div', undefined, 't-liste');
      const bU = knopf('+ Neue Unterversion (' + unter + ' aus ' + akt + ')', () => neueVersion(akt, unter), 'neu');
      bU.id = 'btnNeueUnterversion';
      const bH = knopf('+ Neue Hauptversion (' + ST().versionsOrdner(haupt) + ' · ' + haupt + ')', () => neueVersion(akt, haupt), 'neu');
      bH.id = 'btnNeueHauptversion';
      neu.append(bU, bH);
      inhalt.appendChild(neu);
    });
  }

  function versionMenue(nr) {
    tafel('Version ' + nr, (inhalt) => {
      const pk = paket(), v = ST().version(pk, nr);
      if (!v) { zurueck(); return; }
      const liste = el('div', undefined, 't-liste t-menue');
      liste.appendChild(knopf('Öffnen', () => { oeffneVersion(nr).then(schliesseTafel); }));
      liste.appendChild(knopf('Beschreibung ändern', () => beschreibungTafel(nr)));
      const ziel = ST().naechsteUnterversion(pk, nr);
      liste.appendChild(knopf('Kopie als neue Unterversion (' + ziel + ')', () => { zurueck(); neueVersion(nr, ziel); }));
      liste.appendChild(knopf(v.ausgeblendet ? 'Einblenden' : 'Ausblenden', () => {
        const an = !v.ausgeblendet;
        aendere((p) => ST().versionAusblenden(p, nr, an), 'Version ' + nr + (an ? ' ausgeblendet' : ' eingeblendet')).then(neuZeichnen, () => {});
      }));
      if (nr !== ST().STANDARD_VERSION) {
        liste.appendChild(knopf('Löschen', () => versionLoeschen(nr), 'gefahr'));
      } else {
        const b = knopf('Löschen (nicht bei ' + nr + ')', () => {});
        b.disabled = true;
        liste.appendChild(b);
      }
      inhalt.appendChild(liste);
    });
  }
  function beschreibungTafel(nr) {
    const v = ST().version(paket(), nr);
    eingabeTafel('Beschreibung · Version ' + nr, 'Beschreibung (höchstens ' + ST().MAX_BESCHREIBUNG + ' Zeichen)', v ? v.beschreibung : '', ST().MAX_BESCHREIBUNG,
      (w) => (w.trim().length > ST().MAX_BESCHREIBUNG ? 'Höchstens ' + ST().MAX_BESCHREIBUNG + ' Zeichen.' : ''),
      async (w) => { await h.aendere((p) => ST().versionBeschreiben(p, nr, w)); meldung('Beschreibung gespeichert'); zurueck(); });
  }
  async function versionLoeschen(nr) {
    if (!frage('Version ' + nr + ' löschen? Ihre Seiten, Ordner und Änderungen gehen verloren.')) return;
    try {
      await aendere((p) => ST().versionLoeschen(p, nr));
      const ae = AE();
      if (ae && typeof ae.entferne === 'function') await ae.entferne(nr);
      meldung('Version ' + nr + ' gelöscht');
    } catch (e) { /* gemeldet */ }
    zurueck();
  }

  /* ---------- Tasten ---------- */
  function taste(e) {
    if (!tafelOffen() || e.metaKey || e.ctrlKey || e.altKey) return;
    const m = $('modal');
    if (m && !m.hidden) return;   // Dialog darüber hat Vorrang
    if (e.key !== 'Escape' && e.key !== 'Backspace') return;
    if (istTexteingabe(document.activeElement)) {
      // Im Feld: Backspace löscht Zeichen; Esc geht eine Ebene zurück
      if (e.key !== 'Escape') return;
    }
    e.preventDefault();
    e.stopPropagation();
    if (e.repeat) return;
    if (e.key === 'Escape') { if (istTexteingabe(document.activeElement)) zurueck(); else schliesseTafel(); } else zurueck();
  }

  /* ---------- Einrichten ---------- */
  // h = { paketV2(), version(), oeffneVersion(nr), aendere(fn) } von flyer.js
  function einrichten(hilfen) {
    h = hilfen;
    if (eingerichtet) { versionsKnopf(); return; }
    eingerichtet = true;
    const b = $('btnVersion');
    if (b) b.addEventListener('click', versionenTafel);
    $('tafelZu').addEventListener('click', schliesseTafel);
    $('tafelZurueck').addEventListener('click', zurueck);
    $('tafel').addEventListener('click', (e) => { if (e.target === $('tafel')) schliesseTafel(); });   // Klick neben die Tafel
    window.addEventListener('keydown', taste, true);
    document.addEventListener('flyer:struktur', () => { versionsKnopf(); neuZeichnen(); });
    document.addEventListener('flyer:kategorie', versionsKnopf);
    versionsKnopf();
  }

  window.AetherFlyerUebersicht = Object.freeze({
    einrichten: einrichten,
    tafel: tafel,
    eingabeTafel: eingabeTafel,
    zurueck: zurueck,
    schliesseTafel: schliesseTafel,
    tafelOffen: tafelOffen,
    versionenTafel: versionenTafel,
    versionMenue: versionMenue,
    neueVersion: neueVersion
  });
})();
