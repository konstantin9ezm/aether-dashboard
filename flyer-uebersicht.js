// Übersicht der Flyer-Seite (flyer.html, F3a): Knopf „Version <n> ▾“ mit der Tafel „Versionen“ (Versions-Ordner V1,
// V2 …, „+ Neue Unterversion“, „+ Neue Hauptversion“, Menü „···“ je Version) und die Tafeln dazu; Menü „···“ je Ordner
// (Öffnen, Umbenennen, Verschieben, Löschen) und „+ Neuer Ordner“ (Teil C); „+ Seite“ mit der Tafel „Neue Seite“
// (Vorlagen, Kopie einer bestehenden Seite) und Menü „···“ je Seite (Öffnen, Kopie anlegen, Umbenennen, In Ordner …,
// Grafiken & Daten exportieren, Ausblenden/Einblenden bzw. Löschen) (Teil D). Eine Tafel ist ein
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
  const A = () => window.AetherFlyerAnsicht || null;
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

  /* ---------- Ordner (Teil C) ---------- */
  function versionJetzt() { return ST().version(paket(), offen()); }
  function ordnerJetzt(id) { const v = versionJetzt(); return v ? v.ordner.find((o) => o.id === id) || null : null; }
  function neuerOrdner(eltern) {
    const nr = offen();
    eingabeTafel('Neuer Ordner', 'Name (höchstens ' + ST().MAX_ORDNERNAME + ' Zeichen)', 'Neuer Ordner', ST().MAX_ORDNERNAME,
      (w) => (!w.trim() ? 'Der Ordner braucht einen Namen.' : ''),
      async (w) => {
        const o = await h.aendere((p) => ST().ordnerAnlegen(p, nr, eltern === undefined ? null : eltern, w));
        schliesseTafel();
        meldung('Ordner „' + o.name + '“ angelegt');
      });
  }
  function ordnerMenue(o) {
    const id = o.id;
    tafel('Ordner · ' + o.name, (inhalt) => {
      const jetzt = ordnerJetzt(id);
      if (!jetzt) { zurueck(); return; }
      $('tafelTitel').textContent = 'Ordner · ' + jetzt.name;
      const liste = el('div', undefined, 't-liste t-menue');
      liste.appendChild(knopf('Öffnen', () => { schliesseTafel(); if (A()) A().oeffneOrdner(id); }));
      liste.appendChild(knopf('Umbenennen', () => ordnerUmbenennen(id)));
      liste.appendChild(knopf('Verschieben', () => ordnerVerschieben(id)));
      liste.appendChild(knopf('Löschen', () => ordnerLoeschen(id), 'gefahr'));
      inhalt.appendChild(liste);
    });
  }
  function ordnerUmbenennen(id) {
    const o = ordnerJetzt(id), nr = offen();
    if (!o) return;
    eingabeTafel('Ordner umbenennen', 'Name (höchstens ' + ST().MAX_ORDNERNAME + ' Zeichen)', o.name, ST().MAX_ORDNERNAME,
      (w) => (!w.trim() ? 'Der Ordner braucht einen Namen.' : ''),
      async (w) => { await h.aendere((p) => ST().ordnerUmbenennen(p, nr, id, w)); meldung('Ordner umbenannt'); zurueck(); });
  }
  // Elternordner wählen: „Oberste Ebene“ und alle Ordner der Version (eingerückt), ohne den Ordner selbst und seine
  // Unterordner; der jetzige Elternordner ist markiert und nicht wählbar.
  function ordnerVerschieben(id) {
    const nr = offen();
    tafel('Verschieben nach …', (inhalt) => {
      const v = versionJetzt(), o = ordnerJetzt(id);
      if (!v || !o) { zurueck(); return; }
      const aus = ST().nachfahren(v, id);
      aus.add(id);
      inhalt.appendChild(el('p', '„' + o.name + '“ verschieben nach:', 't-klein'));
      const liste = el('div', undefined, 't-liste');
      const ziele = [{ id: null, name: 'Oberste Ebene (Alle)', ebene: 0 }]
        .concat(ST().ordnerBaum(v).filter((x) => !aus.has(x.ordner.id)).map((x) => ({ id: x.ordner.id, name: x.ordner.name, ebene: x.ebene + 1 })));
      for (const z of ziele) {
        const b = knopf(z.name + (z.id === o.eltern ? ' (jetzt hier)' : ''), async () => {
          try { await h.aendere((p) => ST().ordnerVerschieben(p, nr, id, z.id)); meldung('Ordner verschoben'); schliesseTafel(); } catch (e) { fehlerZeigen(e); }
        });
        b.setAttribute('data-ziel', z.id === null ? '' : z.id);
        b.style.paddingLeft = (14 + z.ebene * 22) + 'px';
        b.disabled = z.id === o.eltern;
        liste.appendChild(b);
      }
      inhalt.appendChild(liste);
    });
  }
  async function ordnerLoeschen(id) {
    const o = ordnerJetzt(id), nr = offen();
    if (!o) return;
    if (!frage('Ordner „' + o.name + '“ löschen? Die Seiten bleiben erhalten und verlieren nur diese Zuordnung; Unterordner wandern in den Elternordner.')) return;
    try { await h.aendere((p) => ST().ordnerLoeschen(p, nr, id)); meldung('Ordner gelöscht'); } catch (e) { return; }
    schliesseTafel();
  }

  /* ---------- Seiten (Teil D) ---------- */
  function seiteJetzt(id) { const v = versionJetzt(); return v ? v.seiten.find((x) => x.id === id) || null : null; }
  function heute() { const ae = AE(); return ae && typeof ae.heute === 'function' ? ae.heute() : new Date().toISOString().slice(0, 10); }
  // HTML, wie die Seite gerade dargestellt wird (Basis + Änderungsschicht) – für Kopien
  function htmlJetzt(nr, seite) { const ae = AE(); return ae && typeof ae.htmlMitSchicht === 'function' ? ae.htmlMitSchicht(nr, seite) : seite.html; }
  // Kleine Skizze einer Vorlage (nur Flächen, kein Text außer den Zahlen)
  function skizze(id) {
    const d = el('div', undefined, 'skizze' + (id === 'bild-video' ? ' gesperrt' : ''));
    d.setAttribute('aria-hidden', 'true');
    const i = (k) => el('i', undefined, k || '');
    if (id === 'titel-text') d.append(i('t'), i(), i(), i(), i('p'));
    else if (id === 'liste-status') d.append(i('t'), i(), i(), i(), i('p'));
    else if (id === 'kennzahlen') { const z = el('div', undefined, 'zahlen'); for (let n = 0; n < 3; n++) z.appendChild(el('b', '42')); d.append(i('t'), z); }
    else if (id === 'zwei-kaesten') { const z = el('div', undefined, 'kaesten'); z.append(el('span'), el('span')); d.append(i('t'), z); }
    else if (id === 'bild-video') { const z = el('div', undefined, 'kaesten'); z.append(el('span')); d.append(i('t'), z); }
    return d;
  }
  // Neue Seite anlegen und im Vollbild öffnen
  async function anlegen(opt) {
    const nr = offen();
    try {
      const s = await h.aendere((p) => ST().seiteAnlegen(p, nr, Object.assign({ heute: heute() }, opt)));
      schliesseTafel();
      if (A()) await A().oeffneDok(s.id);
      meldung('Seite ' + s.id + ' angelegt');
      return s;
    } catch (e) { return null; }
  }
  function neueSeiteTafel() {
    let wahl = null;   // { vorlage } | { kopieVon }
    tafel('Neue Seite', (inhalt) => {
      const v = versionJetzt();
      if (!v) { schliesseTafel(); return; }
      const oid = A() ? A().aktuellerOrdner() : null, o = oid ? v.ordner.find((x) => x.id === oid) : null;
      inhalt.appendChild(el('p', 'Ordner: ' + (o ? o.name : 'Alle (ohne Ordner)'), 't-klein'));
      inhalt.appendChild(abschnitt('Aus Vorlage'));
      const gitter = el('div', undefined, 'vorlagen');
      const anlegenKnopf = knopf('Anlegen', () => {
        if (!wahl) return;
        if (wahl.kopieVon) {
          const q = seiteJetzt(wahl.kopieVon);
          if (q) anlegen({ kopieVon: q.id, html: htmlJetzt(offen(), q), ordner: o ? [o.id] : [] });
        } else anlegen({ vorlage: wahl.vorlage, ordner: o ? [o.id] : [] });
      }, 'primary');
      anlegenKnopf.id = 'btnAnlegen';
      const auswahl = el('select');
      auswahl.id = 'kopieQuelle';
      auswahl.setAttribute('aria-label', 'Kopie einer bestehenden Seite');
      const zeige = () => {
        for (const b of gitter.querySelectorAll('button[data-vorlage]')) b.setAttribute('aria-pressed', String(!!wahl && wahl.vorlage === b.getAttribute('data-vorlage')));
        auswahl.value = wahl && wahl.kopieVon ? wahl.kopieVon : '';
        anlegenKnopf.disabled = !wahl;
      };
      for (const vl of ST().VORLAGEN) {
        const b = knopf('', () => { wahl = { vorlage: vl.id }; zeige(); }, 'vorlage');
        b.setAttribute('data-vorlage', vl.id);
        b.append(skizze(vl.id), el('span', vl.name));
        if (vl.gesperrt) { b.disabled = true; b.appendChild(el('small', vl.hinweis)); b.title = vl.name + ' kommt ' + vl.hinweis; }
        gitter.appendChild(b);
      }
      inhalt.appendChild(gitter);
      inhalt.appendChild(abschnitt('Oder'));
      const leer = el('option', 'Kopie einer bestehenden Seite …');
      leer.value = '';
      auswahl.appendChild(leer);
      for (const x of v.seiten) { const op = el('option', x.id + ' · ' + x.titel); op.value = x.id; auswahl.appendChild(op); }
      auswahl.addEventListener('change', () => { wahl = auswahl.value ? { kopieVon: auswahl.value } : null; zeige(); });
      inhalt.appendChild(auswahl);
      const row = el('div', undefined, 'row t-unten');
      row.append(knopf('Abbrechen', () => schliesseTafel()), anlegenKnopf);
      inhalt.appendChild(row);
      zeige();
    });
  }
  function seitenMenue(dok) {
    const id = dok.id;
    tafel(id + ' · ' + dok.titel, (inhalt) => {
      const s = seiteJetzt(id);
      if (!s) { zurueck(); return; }
      $('tafelTitel').textContent = s.id + ' · ' + s.titel;
      const nr = offen();
      const liste = el('div', undefined, 't-liste t-menue');
      liste.appendChild(knopf('Öffnen', () => { schliesseTafel(); if (A()) A().oeffneDok(id); }));
      liste.appendChild(knopf('Kopie anlegen', () => anlegen({ kopieVon: id, html: htmlJetzt(nr, s), ordner: s.ordner.slice() })));
      liste.appendChild(knopf('Umbenennen', () => seiteUmbenennen(id)));
      liste.appendChild(knopf('In Ordner …', () => inOrdnerTafel(id)));
      const gr = window.AetherFlyerGrafik;
      if (gr && typeof gr.seitenTafel === 'function') liste.appendChild(knopf('Grafiken & Daten exportieren', () => gr.seitenTafel(id)));
      if (s.herkunft === 'eigen') liste.appendChild(knopf('Löschen', () => seiteLoeschen(id), 'gefahr'));
      else {
        liste.appendChild(knopf(s.ausgeblendet ? 'Einblenden' : 'Ausblenden', () => {
          const an = !s.ausgeblendet;
          aendere((p) => ST().seiteAusblenden(p, nr, id, an), 'Seite ' + id + (an ? ' ausgeblendet' : ' eingeblendet')).then(() => schliesseTafel(), () => {});
        }));
        const b = knopf('Löschen (nur eigene Seiten)', () => {});
        b.disabled = true;
        liste.appendChild(b);
      }
      inhalt.appendChild(liste);
    });
  }
  function seiteUmbenennen(id) {
    const s = seiteJetzt(id), nr = offen();
    if (!s) return;
    eingabeTafel('Seite umbenennen', 'Name der Kachel (der Inhalt der Seite bleibt)', s.titel, ST().MAX_SEITENNAME,
      (w) => (!w.trim() ? 'Die Seite braucht einen Namen.' : ''),
      async (w) => { await h.aendere((p) => ST().seiteUmbenennen(p, nr, id, w)); meldung('Seite umbenannt'); zurueck(); });
  }
  // F3: Ankreuzliste aller Ordner der Version, eingerückt nach Ebene, mehrere möglich (wirkt sofort)
  function inOrdnerTafel(id) {
    const nr = offen();
    tafel('In Ordner · ' + id, (inhalt) => {
      const v = versionJetzt(), s = seiteJetzt(id);
      if (!v || !s) { zurueck(); return; }
      inhalt.appendChild(abschnitt('In Ordner (mehrere möglich)'));
      const baum = ST().ordnerBaum(v);
      if (!baum.length) { inhalt.appendChild(el('p', 'In dieser Version gibt es noch keine Ordner.', 't-klein')); return; }
      const liste = el('div', undefined, 't-liste');
      for (const x of baum) {
        const lab = el('label', undefined, 't-check');
        lab.style.paddingLeft = (6 + x.ebene * 22) + 'px';
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = s.ordner.indexOf(x.ordner.id) >= 0;
        cb.setAttribute('data-ordner', x.ordner.id);
        cb.addEventListener('change', () => {
          const jetzt = seiteJetzt(id);
          if (!jetzt) return;
          const ids = new Set(jetzt.ordner);
          if (cb.checked) ids.add(x.ordner.id); else ids.delete(x.ordner.id);
          aendere((p) => ST().seiteInOrdner(p, nr, id, Array.from(ids))).then(neuZeichnen, neuZeichnen);
        });
        lab.append(cb, el('span', x.ordner.name));
        liste.appendChild(lab);
      }
      inhalt.appendChild(liste);
    });
  }
  async function seiteLoeschen(id) {
    const s = seiteJetzt(id), nr = offen();
    if (!s) return;
    if (!frage('Seite ' + id + ' („' + s.titel + '“) löschen? Das lässt sich nicht rückgängig machen.')) return;
    try {
      await aendere((p) => ST().seiteLoeschen(p, nr, id));
      const ae = AE();
      if (ae && typeof ae.entferne === 'function') await ae.entferne(nr, id);
      meldung('Seite ' + id + ' gelöscht');
    } catch (e) { return; }
    schliesseTafel();
  }
  function knopfNeueSeite() { const b = $('btnNeueSeite'); if (b) b.hidden = !paket(); }

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
    document.addEventListener('flyer:kategorie', () => { versionsKnopf(); knopfNeueSeite(); });
    const ns = $('btnNeueSeite');
    if (ns) ns.addEventListener('click', neueSeiteTafel);
    if (A() && typeof A().setzeUebersicht === 'function') {
      A().setzeUebersicht({ ordnerMenue: (o) => ordnerMenue(o), neuerOrdner: (eltern) => neuerOrdner(eltern), seitenMenue: (d) => seitenMenue(d) });
    }
    versionsKnopf();
    knopfNeueSeite();
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
    neueVersion: neueVersion,
    neuerOrdner: neuerOrdner,
    ordnerMenue: ordnerMenue,
    neueSeiteTafel: neueSeiteTafel,
    seitenMenue: seitenMenue
  });
})();
