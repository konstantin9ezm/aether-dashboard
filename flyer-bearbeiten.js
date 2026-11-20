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
  // F1: ab 20 MB ein deutlicher Hinweis (die GitHub-Weboberfläche nimmt nach Angabe des Chats ca. 25 MB je Datei an –
  // nicht nachgeprüft). Exportiert wird trotzdem vollständig: nie still teilen oder kürzen.
  const GROSS_BYTES = 20 * 1024 * 1024;

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
  function mb(bytes) { return (Math.round(bytes / 1024 / 1024 * 10) / 10).toLocaleString('de-DE'); }
  // Mehr als eine Version im Paket? Dann steht die Version vor jeder Konfliktzeile.
  function mehrereVersionen() { try { const pk = h && h.paketV2 ? h.paketV2() : null; return !!pk && pk.versionen.length > 1; } catch (e) { return false; } }
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

  /* ---------- Weitergabe (wie beim Bild) ---------- */
  function dialogMitLink(datei, titel, beiKlick) {
    const m = $('modal'), box = $('mInhalt');
    if (!m || !box) return false;
    $('mTitel').textContent = titel;
    $('mText').textContent = 'Die Datei ließ sich nicht direkt weitergeben. Link antippen (bzw. lange drücken) und sichern.';
    leeren(box);
    const url = URL.createObjectURL(datei);
    const a = el('a', datei.name);
    a.href = url; a.download = datei.name;
    a.addEventListener('click', () => { if (beiKlick) beiKlick(); });
    box.appendChild(a);
    m.hidden = false;
    // Blob-URL freigeben, sobald der Dialog zu ist – egal wie (Schließen, Esc/Backspace in flyer-export.js)
    const beob = new MutationObserver(() => {
      if (!m.hidden) return;
      beob.disconnect();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch (x) { /* egal */ } }, 1000);
    });
    beob.observe(m, { attributes: true, attributeFilter: ['hidden'] });
    const zu = $('mZu');
    if (zu) {
      // Ohne flyer-export.js hätte „Schließen“ sonst keine Wirkung
      zu.addEventListener('click', () => { m.hidden = true; }, { once: true });
      zu.focus();
    }
    return true;
  }
  // Datei weitergeben; nachher() nur, wenn sie wirklich weitergegeben wurde (Teilen erfolgreich, Download gestartet,
  // Link im Dialog angetippt). Muss synchron in der Klick-Behandlung laufen (Nutzergeste für navigator.share).
  function weitergeben(datei, titel, nachher) {
    const g = G();
    const files = [datei];
    if (g.kannTeilen(files)) {
      navigator.share({ files: files, title: titel })
        .then(() => { if (nachher) nachher('geteilt'); })
        .catch((e) => {
          if (e && e.name === 'AbortError') return;
          // Wie beim Bild (Teil 1): Nutzergeste ist verbraucht – kein Download ohne Geste, sondern der Dialog mit Link
          dialogMitLink(datei, titel, () => { if (nachher) nachher('dialog'); });
        });
      return 'teilen';
    }
    if (g.kannHerunterladen()) { herunterladen(datei); if (nachher) nachher('heruntergeladen'); return 'download'; }
    dialogMitLink(datei, titel, () => { if (nachher) nachher('dialog'); });
    return 'dialog';
  }
  function herunterladen(datei) {
    const ex = EX();
    if (ex && typeof ex.herunterladenUndFreigeben === 'function') { ex.herunterladenUndFreigeben(datei); return; }
    const url = URL.createObjectURL(datei);
    G().herunterladen(url, datei.name);
    setTimeout(() => { try { URL.revokeObjectURL(url); } catch (x) { /* egal */ } }, 60000);
  }

  /* ---------- Export (Teil E) ---------- */
  function exportieren(ev) {
    const g = G();
    if (!g.mitGeste(ev)) { meldung('Bitte den Knopf antippen'); return; }
    let r;
    try { r = AE().exportPaket(onlineVersion); } catch (e) { fehlerZeigen(e); return; }
    try {
      if (r.bytes >= GROSS_BYTES) {
        h.fehler('Großes Paket: ' + mb(r.bytes) + ' MB', 'Die GitHub-Weboberfläche nimmt nach bisheriger Angabe nur ca. 25 MB je Datei an. ' +
          'Das Paket wird trotzdem vollständig exportiert (nicht geteilt, nicht gekürzt). Bei Problemen weniger Versionen behalten.', false);
      } else h.fehlerWeg();
    } catch (e) { /* egal */ }
    const datei = new File([r.text], DATEI_PAKET, { type: 'application/json' });
    weitergeben(datei, 'Aether Flyer-Paket ' + r.fassung, (wie) => {
      AE().markiereExportiert(r.fassung).then(() => {
        hilfeZeigen();
        meldung('Paket ' + r.fassung + (wie === 'heruntergeladen' ? ' wird heruntergeladen' : ' exportiert'));
      });
    });
  }
  function hilfeZeigen() {
    const f = AE().letzteFassung();
    $('hilfeFassung').textContent = f || 'noch nicht exportiert';
    $('hilfeCommit').textContent = COMMIT(f || '<Fassung>');
    $('hilfeKopieren').disabled = !f;
  }
  function kopieren() {
    const f = AE().letzteFassung();
    if (!f) return;
    const t = COMMIT(f);
    const ok = () => meldung('Kopiert: ' + t);
    try {
      if (navigator.clipboard && typeof navigator.clipboard.writeText === 'function') {
        navigator.clipboard.writeText(t).then(ok, () => auswaehlen());
        return;
      }
    } catch (e) { /* weiter unten */ }
    auswaehlen();
  }
  // Ohne Zwischenablage: Text markieren (zum Kopieren per Menü)
  function auswaehlen() {
    try {
      const r = document.createRange();
      r.selectNodeContents($('hilfeCommit'));
      const s = window.getSelection();
      s.removeAllRanges(); s.addRange(r);
      meldung('Text markiert – bitte kopieren');
    } catch (e) { meldung('Kopieren nicht möglich'); }
  }

  /* ---------- Sicherung (Teil G) ---------- */
  function sichern(ev) {
    const g = G();
    if (!g.mitGeste(ev)) { meldung('Bitte den Knopf antippen'); return; }
    const s = AE().sicherung();
    // F3a: Struktur-Änderungen der geöffneten Version (neue, kopierte, umbenannte, ausgeblendete, gelöschte Seiten …)
    try { s.struktur = h && typeof h.strukturSicherung === 'function' ? h.strukturSicherung() : []; } catch (e) { s.struktur = []; }
    const datei = new File([JSON.stringify(s, null, 2)], DATEI_SICHERUNG, { type: 'application/json' });
    // F3b: die Sicherung erfasst nur die Metadaten der Bibliothek – die Dateien selbst über „Medien online stellen“
    const mitMedien = s.struktur.some((f) => /^(M|MO)\|\*\|/.test(f.k));
    weitergeben(datei, 'Aether Flyer-Änderungen', () => meldung(s.eintraege.length + ' Einträge' + (s.struktur.length ? ' und ' + s.struktur.length + ' Struktur-Felder' : '') + ' gesichert' +
      (mitMedien ? ' – Dateien der Bibliothek nicht darin: über „Medien online stellen“ bzw. „Alle sichern“' : '')));
  }
  async function einspielen(datei) {
    // Größe vor dem Lesen prüfen (eine sehr große falsche Datei nicht erst ganz in den Speicher holen)
    if (datei && typeof datei.size === 'number' && datei.size > 5 * 1024 * 1024) throw new (G().AppError)('format', 'Datei zu groß.', 'Eine Sicherung hat höchstens 5 MB.');
    let text;
    try { text = await datei.text(); } catch (e) { throw new (G().AppError)('datei', 'Datei ließ sich nicht lesen.', String((e && e.message) || e || '')); }
    // F3a: erst prüfen (Einträge und Struktur), dann die Struktur einspielen (neue Seiten sind danach da), dann die Einträge
    const gelesen = AE().leseSicherung(text);
    let rs = { uebernommen: 0, verworfen: 0, konflikte: 0 };
    if (gelesen.struktur.length && h && typeof h.strukturEinspielen === 'function') rs = await h.strukturEinspielen(gelesen.struktur);
    const r = await AE().einspielenEintraege(gelesen.eintraege);
    try { h.fehlerWeg(); } catch (e) { /* egal */ }
    await neuDarstellen(r.doks);
    const n = r.uebernommen + rs.uebernommen, k = r.konflikte + rs.konflikte, v = r.verworfen + rs.verworfen;
    meldung(n + ' Änderungen eingespielt' + (k ? ', ' + k + ' Konflikte' : '') + (v ? ', ' + v + ' schon vorhanden' : ''));
    konflikteZeigen();
    return { uebernommen: r.uebernommen, verworfen: r.verworfen, konflikte: r.konflikte, doks: r.doks, struktur: rs };
  }
  function strukturZahl() { try { return h && typeof h.strukturSicherung === 'function' ? h.strukturSicherung().length : 0; } catch (e) { return 0; } }
  // F3b: Struktur-Felder, die „Alle Änderungen verwerfen“ zurücknimmt (geöffnete Version; die Bibliothek bleibt)
  function verwerfbarZahl() {
    try { return h && typeof h.strukturVerwerfbar === 'function' ? h.strukturVerwerfbar() : strukturZahl(); } catch (e) { return 0; }
  }
  // „Alle Änderungen verwerfen“: Texte, Status und Struktur der geöffneten Version
  async function verwerfen() {
    const n = AE().alle().length, ns = verwerfbarZahl();
    if (!n && !ns) { meldung('Keine Änderungen'); return false; }
    let ja = false;
    try { ja = window.confirm('Alle Änderungen verwerfen? Das lässt sich nicht rückgängig machen.'); } catch (e) { ja = false; }
    if (!ja) return false;
    const doks = Array.from(new Set(AE().alle().map((e) => e.dok)));
    leisteZu(false);
    if (ns && h && typeof h.strukturVerwerfen === 'function') { try { await h.strukturVerwerfen(); } catch (e) { fehlerZeigen(e); } }
    await AE().verwerfen();
    await neuDarstellen(doks);
    knopfReset();
    meldung('Alle Änderungen verworfen');
    return true;
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

  /* ---------- Konflikte (Teil F) ---------- */
  function wertText(art, v) {
    if (v === null || v === undefined) return '–';
    if (art === 'status') return STATUS_NAMEN[v] || v;
    return v === '' ? '(leer)' : v;
  }
  // F3a: Struktur-Konflikte (Versionen, Ordner, Seiten) aus flyer.js
  function strukturKonflikte() { try { return h && typeof h.strukturKonflikte === 'function' ? h.strukturKonflikte() : []; } catch (e) { return []; } }
  function strukturKarte(k) {
    const karte = el('div', undefined, 'konflikt struktur');
    karte.setAttribute('data-schluessel', k.id);
    karte.appendChild(el('b', k.was));
    const dl = el('dl');
    const andere = k.quelle === 'sicherung' ? 'Sicherung' : 'Online';
    for (const z of k.zeilen) {
      dl.appendChild(el('dt', z.feld));
      const dd = el('dd');
      dd.append(el('span', 'Lokal: ' + z.lokal, 'k-lokal'), document.createElement('br'), el('span', andere + ': ' + z.andere, 'k-andere'));
      dl.appendChild(dd);
    }
    karte.appendChild(dl);
    const row = el('div', undefined, 'row');
    const lokal = el('button', 'Lokal behalten'); lokal.type = 'button'; lokal.setAttribute('data-wahl', 'lokal');
    const fremd = el('button', andere + ' übernehmen'); fremd.type = 'button'; fremd.setAttribute('data-wahl', 'andere');
    const waehle = async (wahl) => {
      lokal.disabled = fremd.disabled = true;
      try { await h.strukturEntscheide(k.id, wahl); } catch (e) { fehlerZeigen(e); }
      konflikteZeigen();
    };
    lokal.addEventListener('click', () => { waehle('lokal'); });
    fremd.addEventListener('click', () => { waehle('andere'); });
    row.append(lokal, fremd);
    karte.appendChild(row);
    return karte;
  }
  function konflikteZeigen() {
    const liste = AE().konflikte(), struktur = strukturKonflikte();
    const banner = $('konflikte'), box = $('konfliktListe');
    if (!banner || !box) return;
    const n = liste.length + struktur.length;
    banner.hidden = !n;
    $('konflikteText').textContent = n + (n === 1 ? ' Konflikt' : ' Konflikte') + ' nach dem Abgleich mit der neuen Fassung';
    if (!n) listeOffen = false;
    $('konflikteZeigen').textContent = listeOffen ? 'Ausblenden' : 'Anzeigen';
    $('konflikteZeigen').setAttribute('aria-expanded', String(listeOffen));
    box.hidden = !listeOffen;
    leeren(box);
    if (!listeOffen) return;
    for (const k of liste) {
      const karte = el('div', undefined, 'konflikt');
      karte.setAttribute('data-schluessel', k.schluessel);
      karte.appendChild(el('b', (mehrereVersionen() ? 'Version ' + k.ver + ' · ' : '') + k.dok + (k.titel ? ' · ' + k.titel : '') + ' – ' + (k.art === 'text' ? 'Text ' : k.art === 'status' ? 'Status ' : 'Stand ') + k.k));
      const dl = el('dl');
      const zeile = (t, v) => { dl.appendChild(el('dt', t)); const dd = el('dd', v); dl.appendChild(dd); return dd; };
      zeile('Basis', wertText(k.art, k.basis)).className = 'k-basis';
      zeile('Meins', wertText(k.art, k.meins)).className = 'k-meins';
      zeile('Online', k.fehlt ? 'nicht mehr im Paket' : wertText(k.art, k.online)).className = 'k-online';
      karte.appendChild(dl);
      const row = el('div', undefined, 'row');
      const meins = el('button', 'Meins behalten'); meins.type = 'button'; meins.setAttribute('data-wahl', 'meins');
      const online = el('button', 'Online übernehmen'); online.type = 'button'; online.setAttribute('data-wahl', 'online');
      const waehle = async (wahl) => {
        meins.disabled = online.disabled = true;
        await AE().entscheide(k.schluessel, wahl);
        await neuDarstellen([k.dok]);
      };
      meins.addEventListener('click', () => { waehle('meins'); });
      online.addEventListener('click', () => { waehle('online'); });
      row.append(meins, online);
      karte.appendChild(row);
      box.appendChild(karte);
    }
    for (const k of struktur) box.appendChild(strukturKarte(k));
  }

  /* ---------- Einrichten ---------- */
  function knoepfeZeigen() {
    const n = AE().alle().length + strukturZahl();
    const pk = !!paket();
    for (const id of ['btnExport', 'btnSichern', 'btnEinspielen', 'btnVerwerfen']) { const b = $(id); if (b) b.hidden = !pk; }
    const v = $('btnVerwerfen'); if (v) v.disabled = !(AE().alle().length + verwerfbarZahl());
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
    $('btnExport').addEventListener('click', exportieren);
    $('btnSichern').addEventListener('click', sichern);
    $('btnEinspielen').addEventListener('click', () => { $('dateiEinspielen').click(); });
    $('dateiEinspielen').addEventListener('change', async () => {
      const eingabe = $('dateiEinspielen'), knopf = $('btnEinspielen');
      const datei = eingabe.files && eingabe.files[0];
      if (!datei) return;
      knopf.disabled = true;
      try { await einspielen(datei); } catch (e) {
        if (e && e.kind === 'zuneu') { try { h.fehler('Sicherung zu neu', e.text, false); } catch (x) { /* egal */ } } else fehlerZeigen(e);
      } finally { eingabe.value = ''; knopf.disabled = false; }
    });
    $('btnVerwerfen').addEventListener('click', () => { verwerfen(); });
    $('hilfeKopieren').addEventListener('click', kopieren);
    $('konflikteZeigen').addEventListener('click', () => { listeOffen = !listeOffen; konflikteZeigen(); });
    // Vollbild: beim Schließen zurück auf „Ansehen“; beim Blättern Leiste zu
    document.addEventListener('flyer:vollbild', (e) => {
      const d = e && e.detail;
      if (d && d.offen === false) { setzeModus('ansehen', false); return; }
      if (offen && d && d.dok && offen.dok.id !== d.dok.id) leisteZu(false);
      knopfReset();
    });
    document.addEventListener('flyer:aenderungen', () => { knoepfeZeigen(); konflikteZeigen(); knopfReset(); hilfeZeigen(); });
    // Neues Paket gezeigt (auch nach einem Abgleich): Knöpfe und Konfliktliste (Titel aus der neuen Basis) neu
    document.addEventListener('flyer:kategorie', () => { knoepfeZeigen(); konflikteZeigen(); });
    document.addEventListener('flyer:struktur', () => { knoepfeZeigen(); konflikteZeigen(); });
    document.addEventListener('flyer:onlinefassung', (e) => { const v = e && e.detail && e.detail.version; if (typeof v === 'string' && v) onlineVersion = v; });
    knoepfeZeigen();
    hilfeZeigen();
    konflikteZeigen();
    return Promise.resolve(h.onlineVersion()).then((v) => { if (typeof v === 'string' && v && !onlineVersion) onlineVersion = v; }).catch(() => {});
  }

  window.AetherFlyerBearbeiten = Object.freeze({
    einrichten: einrichten,
    modus: () => modus,
    setzeModus: (m) => setzeModus(m),
    exportieren: exportieren,
    sichern: sichern,
    einspielen: einspielen,
    verwerfen: verwerfen,
    konflikteZeigen: konflikteZeigen,
    onlineVersion: () => onlineVersion,
    weitergeben: weitergeben   // F3a: auch für den Export „Grafiken & Daten“ (flyer-grafik.js)
  });
})();
