// Bibliothek der Flyer-Seite (flyer.html, F3b): zweiter Reiter „Seiten | Bibliothek“ neben der Versionswahl (gilt für
// alle Versionen). Pfad „Bibliothek“ mit ‹, Filter „Version: Alle ▾“ (jede Version und „nicht verwendet“), belegter und
// freier Platz, Ordner-Kacheln (verschachtelt, eine Datei in mehreren Ordnern, „+ Neuer Ordner“, Menü „···“) samt dem
// automatischen Ordner „Aus Flyern“ (nur lesen: alle Grafiken der gewählten Version, nach Seite gruppiert – Erkennung
// aus F3a, AetherFlyerGrafik.seiteVorbereiten), Datei-Kacheln (Mini-Bild, Spieldauer bzw. „GIF“, Name, Art · Größe,
// Status-Punkt grün „online“ / orange „nur Gerät“ / grau „Flyer“) und auf der obersten Ebene „Zuletzt hinzugefügt“.
// „Gewählt“ heißt: die im Filter gewählte Version, bei „Alle“ (oder „nicht verwendet“) die geöffnete.
// Safari außerhalb der Home-Bildschirm-App: dauerhafter Hinweis bei Dateien „nur Gerät“ (F10).
// Die Metadaten ändert flyer.js (h.aendere → AetherFlyerMedien auf einer Kopie), die Inhalte liegen im Store „medien“
// (AetherFlyerSpeicher). Nichts aus einem Paket wird als HTML eingesetzt (nur textContent, Bilder über Object-URLs aus
// dem eigenen Speicher). Backspace geht in der Bibliothek einen Ordner zurück (nicht in Textfeldern). Kein Netz, kein Token.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const G = () => window.AetherGemeinsam;
  const M = () => window.AetherFlyerMedien;
  const S = () => window.AetherFlyerSpeicher || null;
  const ST = () => window.AetherFlyerStruktur;
  const U = () => window.AetherFlyerUebersicht || null;
  const A = () => window.AetherFlyerAnsicht || null;
  const GR = () => window.AetherFlyerGrafik || null;
  const AE = () => window.AetherFlyerAenderungen || null;
  const PL = () => window.AetherFlyerPlayer || null;
  const MT = () => window.AetherFlyerMedienTafeln || null;   // Hinzufügen, Menü einer Datei, Löschen, „Medien online stellen“
  const KNOPF_TYPEN = ['button', 'submit', 'reset', 'image', 'hidden', 'file', 'checkbox', 'radio'];
  const ART_GRAFIK = { kasten: 'Kasten', kennzahlen: 'Kennzahlen', balken: 'Balken', symbol: 'Symbol', bild: 'Bild' };

  /* ---------- Zustand ---------- */
  let h = null;                  // Hilfen von flyer.js
  let reiter = 'seiten';         // 'seiten' | 'bibliothek'
  let ordner = null;             // geöffneter Ordner: null (oberste Ebene), M.AUS_FLYERN oder mo<n>
  let filter = 'alle';           // 'alle' | Versionsnummer | 'nicht-verwendet'
  let eingerichtet = false;
  let zeichenNr = 0;             // zählt Darstellungen (späte Bilder alter Darstellungen verwerfen)
  let schichtNr = 0;             // zählt Änderungen der Änderungsschicht (Cache „Aus Flyern“)
  const flyerCache = new Map();  // Version → { pk, schicht, seiten: Map(id → vorbereitete Seite), laeuft }

  /* ---------- Hilfen ---------- */
  function meldung(t) { try { G().meldung(t); } catch (e) { /* ohne #toast */ } }
  function leeren(x) { while (x.firstChild) x.removeChild(x.firstChild); }
  function el(tag, text, klasse) { const e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = text; if (klasse) e.className = klasse; return e; }
  function knopf(text, fn, klasse) { const b = el('button', text, klasse); b.type = 'button'; b.addEventListener('click', (ev) => { fn(ev); }); return b; }
  function zahlText(n, eins, mehr) { return n + ' ' + (n === 1 ? eins : mehr); }
  function zwei(n) { return n < 10 ? '0' + n : String(n); }
  function pk() { try { return h ? h.paketV2() : null; } catch (e) { return null; } }
  function offen() { try { return h ? h.version() : ST().STANDARD_VERSION; } catch (e) { return ST().STANDARD_VERSION; } }
  function fehlerZeigen(e) {
    const t = (e && e.title) || 'Unerwarteter Fehler.', x = (e && e.text) || (e && !e.title ? String(e.message || e) : '');
    meldung(x ? t + ' ' + x : t);
  }
  function frage(text) { try { return window.confirm(text) === true; } catch (e) { return false; } }
  function istTexteingabe(e) {
    if (!e) return false;
    if (e.isContentEditable) return true;
    const n = String(e.localName || '').toLowerCase();
    if (n === 'input') return !KNOPF_TYPEN.includes(String(e.type || 'text').toLowerCase());
    return n === 'textarea' || n === 'select';
  }
  async function aendere(fn, erfolg) {
    try {
      const r = await h.aendere(fn);
      if (erfolg) meldung(typeof erfolg === 'function' ? erfolg(r) : erfolg);
      return r;
    } catch (e) { fehlerZeigen(e); throw e; }
  }
  // Gewählte Version für „Aus Flyern“: Filter-Version, sonst die geöffnete
  function gewaehlteVersion() {
    const p = pk();
    if (filter !== 'alle' && filter !== 'nicht-verwendet' && p && ST().version(p, filter)) return filter;
    return offen();
  }
  function onlineShas() { return M().onlineStand().shas; }
  function statusVon(d) { return M().status(d, onlineShas()); }
  function artZeile(d) {
    const teile = [M().formatKurz(d)];
    if ((d.art === 'video' || d.art === 'animation') && typeof d.dauer === 'number') teile.push(M().dauerText(d.dauer));
    if (d.herkunft === 'flyer-kopie') teile.push('aus Flyer');
    teile.push(M().groesseText(d.groesse));
    return teile.join(' · ');
  }

  /* ---------- Reiter „Seiten | Bibliothek“ ---------- */
  function reiterZeigen() {
    const r = $('reiter'), z = $('reiterZusatz'), main = $('inhalt'), b = $('bibliothek');
    const mt = MT();
    for (const [id, fn] of [['bHinzufuegen', 'hinzufuegen'], ['bOnline', 'onlineStellen']]) { const x = $(id); if (x) x.hidden = !mt || typeof mt[fn] !== 'function'; }
    const da = !!pk();
    if (!da && reiter === 'bibliothek') reiter = 'seiten';
    if (r) {
      r.hidden = !da;
      for (const x of r.querySelectorAll('button[data-reiter]')) x.setAttribute('aria-pressed', String(x.getAttribute('data-reiter') === reiter));
    }
    if (z) z.hidden = !da || reiter !== 'bibliothek';
    if (main) { if (reiter === 'bibliothek') main.setAttribute('data-reiter', 'bibliothek'); else main.removeAttribute('data-reiter'); }
    if (b) b.hidden = reiter !== 'bibliothek';
    // Knöpfe, die nur die Seiten betreffen, bleiben oben stehen (gleiche Werkzeugleiste wie in der Vorschau)
  }
  function setzeReiter(r) {
    const neu = r === 'bibliothek' ? 'bibliothek' : 'seiten';
    if (neu === reiter) { reiterZeigen(); return; }
    reiter = neu;
    const a = A();
    if (a && typeof a.schliesse === 'function' && neu === 'bibliothek') { try { a.schliesse(); } catch (e) { /* egal */ } }
    const s = S();
    if (s && typeof s.speichereGeraet === 'function') s.speichereGeraet('reiter', neu).catch(() => {});
    reiterZeigen();
    if (neu === 'bibliothek') zeichnen();
    melde({ reiter: neu });
  }
  function melde(detail) { try { document.dispatchEvent(new CustomEvent('flyer:bibliothek', { detail: detail || {} })); } catch (e) { /* egal */ } }

  /* ---------- Darstellung ---------- */
  function zeichnen() {
    reiterZeigen();
    if (reiter !== 'bibliothek' || !h) return;
    const p = pk();
    if (!p) return;
    if (ordner && ordner !== M().AUS_FLYERN && !M().ordnerVon(p, ordner)) ordner = null;   // Ordner gibt es nicht mehr
    if (filter !== 'alle' && filter !== 'nicht-verwendet' && !ST().version(p, filter)) filter = 'alle';
    const nr = ++zeichenNr;
    pfadZeichnen(p);
    filterZeichnen(p);
    platzZeigen();
    hinweiseZeigen(p);
    ordnerZeichnen(p);
    abschnitteZeichnen(p, nr);
  }
  function pfadZeichnen(p) {
    const ol = $('bPfadListe'), zur = $('bPfadZurueck');
    if (!ol) return;
    leeren(ol);
    const glieder = [{ id: null, name: 'Bibliothek' }].concat(ordner === M().AUS_FLYERN ? [{ id: M().AUS_FLYERN, name: 'Aus Flyern' }] : M().pfad(p, ordner));
    glieder.forEach((g, i) => {
      const li = el('li');
      if (i) li.appendChild(el('span', '›', 'pfad-trenner'));
      const b = knopf(String(g.name), () => oeffneOrdner(g.id), 'pfad-glied');
      b.setAttribute('data-ordner', g.id === null ? '' : String(g.id));
      if (i === glieder.length - 1) b.setAttribute('aria-current', 'location');
      li.appendChild(b);
      ol.appendChild(li);
    });
    if (zur) zur.disabled = ordner === null;
  }
  function filterZeichnen(p) {
    const f = $('bFilter');
    if (!f) return;
    leeren(f);
    const opt = (wert, text) => { const o = el('option', text); o.value = wert; f.appendChild(o); };
    opt('alle', 'Alle');
    for (const v of p.versionen.slice().sort((a, b) => ST().vergleicheNummer(a.nummer, b.nummer))) opt(v.nummer, v.nummer);
    opt('nicht-verwendet', 'nicht verwendet');
    f.value = filter;
  }
  let platzNr = 0;
  async function platzZeigen() {
    const z = $('bPlatz'), s = S();
    if (!z || !s || typeof s.platz !== 'function') return;
    const n = ++platzNr;
    const pl = await s.platz();
    if (n !== platzNr) return;
    z.textContent = pl ? 'Speicher: ' + M().groesseText(pl.belegt) + ' belegt · ' + M().groesseText(pl.frei) + ' frei' : '';
  }
  function hinweiseZeigen(p) {
    const sa = $('bSafari'), zu = $('bZugriff');
    const nurGeraet = M().dateien(p).some((d) => statusVon(d) === 'geraet');
    if (sa) {
      const an = M().safariHinweisNoetig(navigator.userAgent, M().laeuftAlsApp(), nurGeraet);
      sa.textContent = an ? M().HINWEIS_SAFARI : '';
      sa.hidden = !an;
    }
    if (zu) {
      const st = M().onlineStand();
      zu.textContent = st.zugriff === 'kein' ? 'Kein Zugriff auf aether-medien – Repo anlegen bzw. den Token um das Repo erweitern. Alles andere funktioniert weiter; erneut prüfen mit „Online prüfen“.' : '';
      zu.hidden = st.zugriff !== 'kein';
    }
  }
  function ordnerKachel(text, zahl, beiKlick, menue, marke, id) {
    const k = el('div', undefined, 'ordner-kachel');
    k.setAttribute('data-ordner', id);
    const auf = knopf('', beiKlick, 'ok-oeffnen');
    const kopf = el('span', undefined, 'ok-kopf');
    const sym = el('span', '', 'ok-symbol');
    sym.setAttribute('aria-hidden', 'true');
    kopf.appendChild(sym);
    if (marke) kopf.appendChild(el('span', marke, 'ok-marke'));
    auf.append(kopf, el('span', text, 'ok-name'), el('span', zahl, 'ok-zahl'));
    k.appendChild(auf);
    if (menue) {
      const mehr = knopf('···', menue, 'ok-mehr');
      mehr.setAttribute('aria-label', 'Menü Ordner ' + text);
      k.appendChild(mehr);
    }
    return k;
  }
  function flyerZahlText() {
    const c = flyerCacheFuer(gewaehlteVersion(), false);
    const v = ST().version(pk(), gewaehlteVersion());
    const seiten = v ? v.seiten.filter((s) => s.ausgeblendet !== true) : [];
    if (c && seiten.length && seiten.every((s) => c.seiten.has(s.id))) {
      const n = seiten.reduce((x, s) => x + c.seiten.get(s.id).grafiken.length, 0);
      return zahlText(n, 'Grafik', 'Grafiken') + ' · automatisch';
    }
    return 'Grafiken · automatisch';
  }
  function ordnerZeichnen(p) {
    const ziel = $('bOrdner');
    if (!ziel) return;
    leeren(ziel);
    if (ordner === M().AUS_FLYERN) return;
    const liste = M().gefiltert(p, filter);
    if (ordner === null) ziel.appendChild(ordnerKachel('Aus Flyern', flyerZahlText(), () => oeffneOrdner(M().AUS_FLYERN), null, 'nur lesen', M().AUS_FLYERN));
    for (const o of M().kinderOrdner(p, ordner)) {
      const n = M().inOrdner(liste, o.id).length, u = M().kinderOrdner(p, o.id).length;
      ziel.appendChild(ordnerKachel(o.name, zahlText(n, 'Datei', 'Dateien') + (u ? ' · ' + zahlText(u, 'Ordner', 'Ordner') : ''),
        () => oeffneOrdner(o.id), () => ordnerMenue(o.id), '', o.id));
    }
    const neu = knopf('+ Neuer Ordner', () => neuerOrdner(ordner), 'ordner-neu');
    neu.id = 'bNeuerOrdner';
    ziel.appendChild(neu);
  }
  function abschnitt(text) { return el('div', text, 't-abschnitt'); }
  function abschnitteZeichnen(p, nr) {
    const ziel = $('bAbschnitte');
    if (!ziel) return;
    leeren(ziel);
    if (ordner === M().AUS_FLYERN) { ausFlyernZeichnen(ziel, nr); return; }
    const liste = M().gefiltert(p, filter);
    const raster = (dateien) => { const r = el('div', undefined, 'm-kacheln'); for (const d of dateien) r.appendChild(dateiKachel(d, nr)); return r; };
    if (ordner === null) {
      if (!M().dateien(p).length) { ziel.appendChild(el('p', 'Noch keine Dateien – „+ Hinzufügen“.', 'leer')); return; }
      const z = M().zuletzt(liste);
      if (z.length) { ziel.appendChild(abschnitt('Zuletzt hinzugefügt')); ziel.appendChild(raster(z)); }
      const ohne = M().inOrdner(liste, null);
      if (ohne.length) { ziel.appendChild(abschnitt('Ohne Ordner (' + ohne.length + ')')); ziel.appendChild(raster(ohne)); }
      if (!liste.length) ziel.appendChild(el('p', filter === 'nicht-verwendet' ? 'Jede Datei wird in einer Seite verwendet.' : 'In Version ' + filter + ' wird keine Datei verwendet.', 'leer'));
      return;
    }
    const hier = M().inOrdner(liste, ordner);
    ziel.appendChild(abschnitt('Dateien (' + hier.length + ')'));
    if (hier.length) ziel.appendChild(raster(hier));
    else ziel.appendChild(el('p', filter === 'alle' ? 'In diesem Ordner liegen noch keine Dateien.' : 'Keine Datei in diesem Ordner passt zum Filter.', 'leer'));
  }
  // Datei-Kachel: Mini-Bild (aus dem Speicher, sonst Ersatz), Spieldauer bzw. „GIF“, Name, Art · Größe, Status-Punkt
  function dateiKachel(d, nr) {
    const k = el('button', null, 'm-kachel');
    k.type = 'button';
    k.setAttribute('data-id', d.id);
    const bild = el('span', undefined, 'm-bild');
    bild.setAttribute('aria-hidden', 'true');
    const ersatz = el('span', M().hatInhalt(d.id) ? M().ART_NAME[d.art] : 'nicht auf diesem Gerät', 'm-ersatz');
    bild.appendChild(ersatz);
    const setzeBild = (e) => {
      if (!e || nr !== zeichenNr) return;
      const img = el('img');
      img.alt = '';
      img.src = e.url;
      ersatz.remove();
      bild.insertBefore(img, bild.firstChild);
    };
    const schon = M().bild(d.id, 'k');
    if (schon) setzeBild(schon); else M().bildLaden(d.id, 'k').then(setzeBild, () => {});
    if (d.art === 'video' || d.art === 'animation') bild.appendChild(el('span', '', 'm-spiel'));
    if (d.art === 'video' && typeof d.dauer === 'number') bild.appendChild(el('span', M().dauerText(d.dauer), 'm-dauer'));
    if (d.art === 'animation') bild.appendChild(el('span', M().formatKurz(d) === 'GIF' ? 'GIF' : 'ANIM', 'm-dauer'));
    const st = statusVon(d);
    const status = el('span', M().STATUS_TEXT[st], 'm-status');
    status.setAttribute('data-status', st);
    k.append(bild, el('span', d.name, 'm-name'), el('span', artZeile(d), 'm-art'), status);
    if (st === 'geraet' && M().zuGrossFuerUpload(d.groesse)) k.appendChild(el('span', 'zu groß für den Upload im Browser', 'm-gross'));
    k.setAttribute('aria-label', d.name + ', ' + artZeile(d) + ', ' + M().STATUS_TEXT[st]);
    k.addEventListener('click', () => { const mt = MT(); if (mt && typeof mt.dateiMenue === 'function') mt.dateiMenue(d.id); });
    return k;
  }

  /* ---------- „Aus Flyern“ (nur lesen) ---------- */
  // Darstellungs-Optionen einer Version (Änderungsschicht dieser Version, Medien als Startbild); geöffnete → Standard
  function optionenFuer(nr, dok) {
    if (nr === offen()) return undefined;
    const ae = AE(), pl = PL();
    return { anpassen: (w) => {
      try { if (ae) ae.anwenden(w, dok.id, ae.fuerDok(dok.id, nr), {}); } catch (e) { /* Basis bleibt */ }
      try { if (pl && typeof pl.anpassen === 'function') pl.anpassen(w, dok, 'bild'); } catch (e) { /* egal */ }
    } };
  }
  function flyerCacheFuer(nr, anlegen) {
    const p = pk();
    let c = flyerCache.get(nr);
    if (c && (c.pk !== p || c.schicht !== schichtNr)) { flyerCache.delete(nr); c = null; }
    if (!c && anlegen) { c = { pk: p, schicht: schichtNr, seiten: new Map(), laeuft: null }; flyerCache.set(nr, c); }
    return c;
  }
  function seitenDer(nr) {
    const p = pk(), s = p ? ST().sicht(p, nr) : null;
    return s ? s.dokumente.filter((d) => d.ausgeblendet !== true) : [];
  }
  // Seiten der Version nacheinander vorbereiten (Grafiken erkennen, Mini-Bilder); bei jeder fertigen Seite fertig(id)
  function flyerVorbereiten(nr, fertig) {
    const c = flyerCacheFuer(nr, true);
    if (c.laeuft) { c.beobachter.add(fertig); return c.laeuft; }
    c.beobachter = new Set([fertig]);
    c.laeuft = (async () => {
      const gr = GR();
      if (!gr || typeof gr.seiteVorbereiten !== 'function') return;
      for (const dok of seitenDer(nr)) {
        if (flyerCache.get(nr) !== c) return;
        if (c.seiten.has(dok.id)) { c.beobachter.forEach((f) => { try { f(dok.id); } catch (e) { /* egal */ } }); continue; }
        let s;
        try { s = await gr.seiteVorbereiten(dok, nr, { mini: true, optionen: optionenFuer(nr, dok) }); } catch (e) { s = { dok: dok, nr: nr, grafiken: [], fehler: e }; }
        if (flyerCache.get(nr) !== c) return;
        c.seiten.set(dok.id, s);
        c.beobachter.forEach((f) => { try { f(dok.id); } catch (e) { /* egal */ } });
      }
    })().finally(() => { c.laeuft = null; });
    return c.laeuft;
  }
  function miniKopie(c) {
    if (!c || typeof c.getContext !== 'function') return null;
    const m = document.createElement('canvas');
    m.width = c.width; m.height = c.height;
    m.style.width = c.style.width;
    m.setAttribute('aria-hidden', 'true');
    try { m.getContext('2d').drawImage(c, 0, 0); } catch (e) { return null; }
    return m;
  }
  function grafikKnopf(s, g, beiKlick) {
    const b = el('button', null, 'g-mini f-mini');
    b.type = 'button';
    b.setAttribute('data-seite', s.dok.id);
    b.setAttribute('data-nr', String(g.nr));
    b.setAttribute('aria-label', s.dok.id + ' · Grafik ' + zwei(g.nr) + ' · ' + (ART_GRAFIK[g.art] || g.art));
    const mini = miniKopie(g.mini);
    if (mini) b.appendChild(mini); else b.appendChild(el('span', ART_GRAFIK[g.art] || g.art, 'g-ersatz'));
    b.appendChild(el('small', zwei(g.nr) + ' · ' + (ART_GRAFIK[g.art] || g.art)));
    const st = el('span', 'Flyer', 'm-status');
    st.setAttribute('data-status', 'flyer');
    b.appendChild(st);
    b.addEventListener('click', () => beiKlick(s, g));
    return b;
  }
  function ausFlyernZeichnen(ziel, nr) {
    const v = gewaehlteVersion();
    ziel.appendChild(el('p', 'Alle Grafiken der Seiten von Version ' + v + ' – automatisch erkannt, nur lesen. „Als eigene Datei übernehmen“ macht daraus eine Datei der Bibliothek.', 't-klein'));
    const fortschritt = el('p', '', 't-klein');
    fortschritt.setAttribute('role', 'status');
    ziel.appendChild(fortschritt);
    const seiten = seitenDer(v);
    const bereiche = new Map();
    for (const dok of seiten) {
      const b = el('div', undefined, 'f-seite');
      b.setAttribute('data-seite', dok.id);
      b.appendChild(abschnitt(dok.id + ' · ' + dok.titel));
      const inhalt = el('div', undefined, 'g-raster');
      inhalt.appendChild(el('span', 'wird vorbereitet …', 't-klein'));
      b.appendChild(inhalt);
      ziel.appendChild(b);
      bereiche.set(dok.id, inhalt);
    }
    const zeige = (id) => {
      if (nr !== zeichenNr) return;
      const c = flyerCacheFuer(v, false), s = c && c.seiten.get(id), r = bereiche.get(id);
      if (!s || !r) return;
      leeren(r);
      if (!s.grafiken.length) r.appendChild(el('span', s.fehler ? 'Grafiken nicht erkennbar.' : 'keine Grafiken erkannt', 't-klein'));
      for (const g of s.grafiken) r.appendChild(grafikKnopf(s, g, flyerGrafikMenue));
      const fertig = seiten.filter((d) => c.seiten.has(d.id)).length;
      fortschritt.textContent = fertig < seiten.length ? 'Grafiken werden erkannt … ' + fertig + ' / ' + seiten.length : zahlText(seiten.reduce((x, d) => x + c.seiten.get(d.id).grafiken.length, 0), 'Grafik', 'Grafiken') + ' auf ' + zahlText(seiten.length, 'Seite', 'Seiten');
    };
    fortschritt.textContent = 'Grafiken werden erkannt … 0 / ' + seiten.length;
    flyerVorbereiten(v, zeige);
  }
  // Menü einer Grafik aus „Aus Flyern“ (nur lesen: übernehmen, herunterladen – nie löschen)
  function flyerGrafikMenue(s, g) {
    const u = U();
    if (!u) return;
    u.tafel(s.dok.id + ' · Grafik ' + zwei(g.nr), (inhalt) => {
      const v = el('div', undefined, 'm-vorschau');
      if (g.png) {
        const img = el('img');
        img.alt = s.dok.id + ' · Grafik ' + zwei(g.nr);
        img.src = urlMerken(URL.createObjectURL(new Blob([g.png], { type: 'image/png' })), img);
        v.appendChild(img);
      } else v.appendChild(el('div', 'Vorschau in diesem Browser nicht möglich', 'm-ersatz'));
      inhalt.appendChild(v);
      inhalt.appendChild(el('p', 'PNG · ' + Math.round(g.w) + ' × ' + Math.round(g.h) + ' · Version ' + s.nr + ' · Seite ' + s.dok.id + ' · ' + (ART_GRAFIK[g.art] || g.art) + ' · Flyer (nur lesen)', 'm-kenn'));
      const liste = el('div', undefined, 't-liste t-menue');
      const mt = MT();
      const ueb = knopf('Als eigene Datei übernehmen', () => { if (mt && typeof mt.grafikUebernehmen === 'function') mt.grafikUebernehmen(s, g); });
      ueb.disabled = !g.png || !mt;
      liste.appendChild(ueb);
      const weg = knopf('Löschen (nur eigene Dateien)', () => {});
      weg.disabled = true;
      liste.appendChild(weg);
      inhalt.appendChild(liste);
    });
  }

  /* ---------- Object-URLs der Tafeln (wieder freigeben, sobald das Bild weg ist) ---------- */
  const tafelUrls = new Set();   // { url, el }
  function urlMerken(url, elem) { aufraeumen(); tafelUrls.add({ url: url, el: elem }); return url; }
  function aufraeumen() {
    for (const e of Array.from(tafelUrls)) if (!e.el || !e.el.isConnected) { try { URL.revokeObjectURL(e.url); } catch (x) { /* egal */ } tafelUrls.delete(e); }
  }

  /* ---------- Ordner der Bibliothek (wie die Seiten-Ordner, getrennt davon) ---------- */
  function oeffneOrdner(id) {
    const p = pk();
    const neu = id === null || id === undefined ? null : (id === M().AUS_FLYERN || (p && M().ordnerVon(p, id)) ? id : null);
    ordner = neu;
    zeichnen();
    melde({ ordner: neu });
  }
  function ordnerZurueck() {
    if (ordner === null) return false;
    if (ordner === M().AUS_FLYERN) { oeffneOrdner(null); return true; }
    const o = M().ordnerVon(pk(), ordner);
    oeffneOrdner(o ? o.eltern : null);
    return true;
  }
  function neuerOrdner(eltern) {
    const u = U();
    if (!u) return;
    const e = eltern === M().AUS_FLYERN ? null : eltern;
    u.eingabeTafel('Neuer Ordner', 'Name des Ordners (Bibliothek, für alle Versionen)', '', M().MAX_ORDNERNAME,
      (w) => (!w.trim() ? 'Der Ordner braucht einen Namen.' : ''),
      async (w) => { await h.aendere((p) => M().ordnerAnlegen(p, e, w)); meldung('Ordner angelegt'); u.schliesseTafel(); });
  }
  function ordnerMenue(id) {
    const u = U(), o0 = M().ordnerVon(pk(), id);
    if (!u || !o0) return;
    u.tafel('Ordner · ' + o0.name, (inhalt) => {
      const o = M().ordnerVon(pk(), id);
      if (!o) { u.zurueck(); return; }
      const liste = el('div', undefined, 't-liste t-menue');
      liste.appendChild(knopf('Öffnen', () => { u.schliesseTafel(); oeffneOrdner(id); }));
      liste.appendChild(knopf('Umbenennen', () => u.eingabeTafel('Ordner umbenennen', 'Name des Ordners', o.name, M().MAX_ORDNERNAME,
        (w) => (!w.trim() ? 'Der Ordner braucht einen Namen.' : ''),
        async (w) => { await h.aendere((p) => M().ordnerUmbenennen(p, id, w)); meldung('Ordner umbenannt'); u.zurueck(); })));
      liste.appendChild(knopf('Verschieben …', () => verschiebenTafel(id)));
      liste.appendChild(knopf('Löschen', () => ordnerLoeschen(id), 'gefahr'));
      inhalt.appendChild(liste);
    });
  }
  function verschiebenTafel(id) {
    const u = U();
    u.tafel('Verschieben nach …', (inhalt) => {
      const p = pk(), o = M().ordnerVon(p, id);
      if (!o) { u.zurueck(); return; }
      const verboten = M().nachfahren(p, id);
      verboten.add(id);
      const liste = el('div', undefined, 't-liste');
      const ziel = (eltern, text, ebene) => {
        const b = knopf(text, async () => {
          try { await aendere((q) => M().ordnerVerschieben(q, id, eltern), 'Ordner verschoben'); u.schliesseTafel(); } catch (e) { /* Meldung gezeigt */ }
        });
        b.style.paddingLeft = (14 + ebene * 22) + 'px';
        b.disabled = eltern === o.eltern;
        liste.appendChild(b);
      };
      ziel(null, 'Bibliothek (oberste Ebene)', 0);
      for (const x of M().ordnerBaum(p)) if (!verboten.has(x.ordner.id)) ziel(x.ordner.id, x.ordner.name, x.ebene + 1);
      inhalt.appendChild(liste);
    });
  }
  async function ordnerLoeschen(id) {
    const o = M().ordnerVon(pk(), id);
    if (!o) return;
    if (!frage('Ordner „' + o.name + '“ löschen? Die Dateien bleiben erhalten und verlieren nur diese Zuordnung; Unterordner wandern in den Elternordner.')) return;
    try { await aendere((p) => M().ordnerLoeschen(p, id), 'Ordner gelöscht'); } catch (e) { return; }
    const u = U(); if (u) u.schliesseTafel();
    if (ordner === id) oeffneOrdner(o.eltern);
  }

  /* ---------- Tasten ---------- */
  function taste(e) {
    if (reiter !== 'bibliothek' || e.key !== 'Backspace' || e.metaKey || e.ctrlKey || e.altKey) return;
    const m = $('modal'), t = $('tafel'), vb = $('vollbild');
    if ((m && !m.hidden) || (t && !t.hidden) || (vb && !vb.hidden)) return;
    if (istTexteingabe(document.activeElement)) return;
    // Die Bibliothek ist sichtbar: Backspace gehört ihr (die verborgenen Seiten-Ordner wechseln nicht mit)
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) ordnerZurueck();
  }

  /* ---------- Einrichten ---------- */
  // h = { token, paketV2, version, sicht, aendere, oeffneVersion, fehler, fehlerWeg, persistAnfragen } von flyer.js
  function einrichten(hilfen) {
    h = hilfen;
    if (eingerichtet) { zeichnen(); return; }
    eingerichtet = true;
    const r = $('reiter');
    if (r) for (const b of r.querySelectorAll('button[data-reiter]')) b.addEventListener('click', () => setzeReiter(b.getAttribute('data-reiter')));
    const z = $('bPfadZurueck');
    if (z) z.addEventListener('click', () => { ordnerZurueck(); });
    const f = $('bFilter');
    if (f) f.addEventListener('change', () => { filter = f.value || 'alle'; zeichnen(); });
    const hz = $('bHinzufuegen'), on = $('bOnline');
    if (hz) hz.addEventListener('click', () => { const mt = MT(); if (mt && typeof mt.hinzufuegen === 'function') mt.hinzufuegen(ordner === M().AUS_FLYERN ? null : ordner); });
    if (on) on.addEventListener('click', () => { const mt = MT(); if (mt && typeof mt.onlineStellen === 'function') mt.onlineStellen(); });
    window.addEventListener('keydown', taste, true);
    document.addEventListener('flyer:struktur', () => zeichnen());
    document.addEventListener('flyer:kategorie', () => reiterZeigen());
    document.addEventListener('flyer:medien', () => zeichnen());
    document.addEventListener('flyer:aenderungen', () => { schichtNr++; });
    const t = $('tafel');
    if (t && typeof MutationObserver === 'function') new MutationObserver(() => aufraeumen()).observe(t, { attributes: true, attributeFilter: ['hidden'], childList: true, subtree: true });
    const s = S();
    Promise.resolve(s && typeof s.ladeGeraet === 'function' ? s.ladeGeraet('reiter') : null).then((w) => {
      if (w === 'bibliothek' && reiter !== 'bibliothek' && pk()) setzeReiter('bibliothek'); else reiterZeigen();
    }, () => reiterZeigen());
    M().geraetLaden().catch(() => {});
    reiterZeigen();
  }

  window.AetherFlyerBibliothek = Object.freeze({
    einrichten: einrichten,
    zeichnen: zeichnen,
    setzeReiter: setzeReiter,
    reiter: () => reiter,
    oeffneOrdner: oeffneOrdner,
    ordnerZurueck: ordnerZurueck,
    aktuellerOrdner: () => ordner,
    filter: () => filter,
    setzeFilter: (f) => { filter = f || 'alle'; zeichnen(); },
    gewaehlteVersion: gewaehlteVersion,
    flyerVorbereiten: flyerVorbereiten,
    neuerOrdner: neuerOrdner,
    ordnerMenue: ordnerMenue,
    // für flyer-medien-tafeln.js (Hilfen der Tafeln)
    intern: Object.freeze({ el: el, knopf: knopf, abschnitt: abschnitt, leeren: leeren, meldung: meldung, frage: frage, aendere: aendere, pk: pk, offen: offen,
      fehlerZeigen: fehlerZeigen, artZeile: artZeile, statusVon: statusVon, urlMerken: urlMerken, aufraeumen: aufraeumen, zwei: zwei,
      seitenDer: seitenDer, flyerCacheFuer: flyerCacheFuer, grafikKnopf: grafikKnopf, ART_GRAFIK: ART_GRAFIK, gewaehlteVersion: gewaehlteVersion, h: () => h })
  });
})();
