// Tafeln der Bibliothek (flyer.html, F3b): „+ Hinzufügen“ (Aus Fotos, Aus Dateien, Grafik aus einem Flyer), Menü einer
// Datei (großes Vorschaubild bzw. Player, Kenndaten, Abspielen/Ansehen, Umbenennen, In Ordner …, In Seite einsetzen …,
// Herunterladen / Teilen, „Bearbeiten (ab F3d)“ ausgegraut, Löschen) und „Medien online stellen“.
// Hinzufügen: Format (F5) → Annahme bis 500 MB (F4) → Platz prüfen (navigator.storage.estimate) → SVG bereinigen →
// einlesen (Maße, Dauer, Startbild aus der ersten Sekunde, Mini) → Git-Blob-SHA → Metadaten ins Paket (h.aendere) →
// Inhalt und Bilder ins Gerät (Store „medien“). Nichts wird still gekürzt oder abgelehnt: Die Tafel „Hinzugefügt“
// nennt je Datei die tatsächliche Größe, den 25-MiB-Hinweis (E5) bzw. den Grund einer Ablehnung.
// iOS: „Aus Fotos“ öffnet mit accept „image/*,video/*“ die Auswahl mit der Fotos-Mediathek, „Aus Dateien“ (Endungen)
// die Dateien-App – beide mit Mehrfachauswahl. Teilen braucht eine frische Nutzergeste: Der Inhalt wird beim Öffnen
// des Menüs vorbereitet, geteilt wird synchron im Klick. Nichts wird als HTML eingesetzt; kein Netz, kein Token.
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const G = () => window.AetherGemeinsam;
  const M = () => window.AetherFlyerMedien;
  const S = () => window.AetherFlyerSpeicher || null;
  const ST = () => window.AetherFlyerStruktur;
  const U = () => window.AetherFlyerUebersicht || null;
  const A = () => window.AetherFlyerAnsicht || null;
  const AE = () => window.AetherFlyerAenderungen || null;
  const B = () => window.AetherFlyerBearbeiten || null;
  const EX = () => window.AetherFlyerExport || null;
  const BI = () => window.AetherFlyerBibliothek;
  const PL = () => window.AetherFlyerPlayer || null;
  const GR = () => window.AetherFlyerGrafik || null;
  const I = () => BI().intern;
  // Selbst gewählt: Animationen erkennen an höchstens den ersten 64 MiB (GIF, APNG, WebP)
  const KOPF_MAX = 64 * 1024 * 1024;

  let eingerichtet = false;
  let zielOrdner = null;          // Ordner, in den „+ Hinzufügen“ legt (null = oberste Ebene)
  let lauf = null;                // laufendes Hinzufügen: { gesamt, fertig, aktuell, ergebnisse: [...] }

  function el(t, x, k) { return I().el(t, x, k); }
  function knopf(t, fn, k) { return I().knopf(t, fn, k); }
  function meldung(t) { I().meldung(t); }
  function h() { return I().h(); }
  function pk() { return I().pk(); }
  function heute() { const ae = AE(); return ae && typeof ae.heute === 'function' ? ae.heute() : new Date().toISOString().slice(0, 10); }
  function zielText(id) {
    const p = pk();
    const pf = id ? M().pfad(p, id).map((o) => o.name) : [];
    return 'Ziel: ' + ['Bibliothek'].concat(pf).join(' › ');
  }
  function grossKnopf(titel, unter, fn, k) {
    const b = el('button', null, 'g-knopf');
    b.type = 'button';
    if (k) b.setAttribute('data-k', k);
    const t = el('span', undefined, 'g-text');
    t.append(el('b', titel), el('small', unter));
    b.append(t, el('span', '›', 'g-pfeil'));
    b.addEventListener('click', fn);
    return b;
  }

  /* ---------- „+ Hinzufügen“ ---------- */
  function hinzufuegen(ordner) {
    const u = U();
    if (!u) return;
    zielOrdner = ordner && M().ordnerVon(pk(), ordner) ? ordner : null;
    u.tafel('Hinzufügen', (inhalt) => {
      inhalt.appendChild(el('p', zielText(zielOrdner), 't-klein'));
      const liste = el('div', undefined, 't-liste');
      liste.appendChild(grossKnopf('Aus Fotos', 'Fotos und Videos aus der Fotos-App', () => waehlen('fotos'), 'fotos'));
      liste.appendChild(grossKnopf('Aus Dateien', 'JPG, PNG, WebP, HEIC, GIF, SVG, MP4, MOV, WebM', () => waehlen('dateien'), 'dateien'));
      liste.appendChild(grossKnopf('Grafik aus einem Flyer', 'eine Grafik einer Seite als eigene Datei übernehmen', () => flyerSeitenTafel(), 'flyer'));
      inhalt.appendChild(liste);
      const p = el('p', 'Neue Dateien liegen zuerst nur auf diesem Gerät (orange). „Medien online“ zeigt, was du ins Repo aether-medien hochladen musst. ' +
        'Größer als 25 MiB: Hinweis „zu groß für den Upload im Browser“ – die Datei bleibt trotzdem hier (bis 500 MB je Datei).', 't-klein');
      inhalt.appendChild(p);
    });
  }
  // Datei-Auswahl öffnen (synchron im Klick); beim ersten Hinzufügen dauerhaften Speicher anfragen (F2)
  function waehlen(art) {
    const ein = $(art === 'fotos' ? 'bDateiFotos' : 'bDateiDateien');
    if (!ein) return;
    ein.accept = art === 'fotos' ? M().ACCEPT_FOTOS : M().ACCEPT_DATEIEN;
    try { if (h() && typeof h().persistAnfragen === 'function') h().persistAnfragen(); } catch (e) { /* egal */ }
    ein.click();
  }
  async function auswahl(ein) {
    const dateien = Array.from(ein.files || []);
    ein.value = '';
    if (!dateien.length) return;
    await dateienHinzufuegen(dateien, zielOrdner);
  }
  // Fortschritt und Ergebnis in einer Tafel (wird nach jeder Datei neu gezeichnet)
  let laufInhalt = null;
  function laufZeichnen() {
    const inhalt = laufInhalt;
    if (!inhalt || !inhalt.isConnected || !lauf) return;
    while (inhalt.firstChild) inhalt.removeChild(inhalt.firstChild);
    inhalt.appendChild(el('p', zielText(lauf.ziel), 't-klein'));
    const st = el('p', lauf.fertig < lauf.gesamt ? 'Datei ' + (lauf.fertig + 1) + ' von ' + lauf.gesamt + ': ' + (lauf.aktuell || '') + ' …' : 'Fertig: ' + lauf.ergebnisse.filter((r) => r.datei).length + ' von ' + lauf.gesamt + ' hinzugefügt', lauf.fertig < lauf.gesamt ? 't-klein' : 'g-fertig');
    st.setAttribute('role', 'status');
    st.id = 'mLaufStatus';
    inhalt.appendChild(st);
    const liste = el('div', undefined, 'm-liste');
    for (const r of lauf.ergebnisse) {
      const z = el('div', undefined, 'm-zeile' + (r.fehler ? ' zu-gross' : ''));
      z.setAttribute('data-ergebnis', r.datei ? 'ok' : 'abgelehnt');
      const t = el('div', undefined, 'm-dname');
      t.appendChild(el('div', r.datei ? r.datei.name : r.name));
      if (r.datei) t.appendChild(el('div', M().ART_NAME[r.datei.art] + ' · ' + I().artZeile(r.datei) + ' (tatsächliche Größe)', 't-klein'));
      for (const x of r.hinweise || []) t.appendChild(el('div', x, 't-hinweis'));
      if (r.fehler) t.appendChild(el('div', r.fehler, 't-hinweis'));
      z.appendChild(t);
      liste.appendChild(z);
    }
    inhalt.appendChild(liste);
    if (lauf.fertig >= lauf.gesamt) {
      const row = el('div', undefined, 'row');
      row.appendChild(knopf('Fertig', () => U().schliesseTafel(), 'primary'));
      inhalt.appendChild(row);
    }
  }
  async function dateienHinzufuegen(dateien, ziel) {
    const u = U();
    lauf = { gesamt: dateien.length, fertig: 0, aktuell: '', ergebnisse: [], ziel: ziel };
    if (u) { if (u.tafelOffen()) u.schliesseTafel(); u.tafel('Hinzufügen', (inhalt) => { laufInhalt = inhalt; laufZeichnen(); }); }
    for (const f of dateien) {
      lauf.aktuell = f.name;
      laufZeichnen();
      let r;
      try { r = await eineDatei(f, ziel); } catch (e) { r = { name: f.name, fehler: [(e && e.title) || 'Nicht hinzugefügt.', e && e.text].filter(Boolean).join(' ') }; }
      lauf.ergebnisse.push(r);
      lauf.fertig++;
      laufZeichnen();
    }
    const n = lauf.ergebnisse.filter((r) => r.datei).length;
    meldung(n + ' von ' + lauf.gesamt + (lauf.gesamt === 1 ? ' Datei' : ' Dateien') + ' hinzugefügt');
    const fertig = lauf;
    return fertig.ergebnisse;
  }
  // Eine Datei → { datei, hinweise } | { name, fehler }
  async function eineDatei(f, ziel) {
    const fmt = M().formatVon(f.name, f.type);
    if (!fmt) return { name: f.name, fehler: 'Format nicht unterstützt (' + (M().endungVon(f.name) || f.type || '?') + '). Möglich: JPG, PNG, WebP, HEIC, GIF, SVG, MP4, MOV, WebM.' };
    const zu = M().annahmeMeldung(f.size);
    if (zu) return { name: f.name, fehler: zu };
    const s = S();
    const platz = s && typeof s.platz === 'function' ? await s.platz() : null;
    const pm = M().platzMeldung(f.size, platz);
    if (pm) return { name: f.name, fehler: pm };
    let blob = f;
    if (fmt.endung === 'svg') blob = new Blob([M().svgBereinigen(await f.text())], { type: 'image/svg+xml' });
    const kopf = fmt.endung === 'gif' || fmt.endung === 'png' || fmt.endung === 'webp' ? await M().stueckLesen(blob, 0, Math.min(blob.size, KOPF_MAX)) : null;
    const info = await M().einlesen(blob, fmt, kopf);
    const sha = await M().gitSha(blob);
    return speichern(blob, {
      name: M().ohneEndung(f.name), art: info.art, mime: fmt.mime, groesse: blob.size, breite: info.breite, hoehe: info.hoehe,
      dauer: info.dauer, endung: fmt.endung, gitSha: sha, herkunft: 'eigen', startbild: info.startbild, ordner: ziel ? [ziel] : []
    }, info);
  }
  // Metadaten ins Paket, Inhalt und Bilder ins Gerät; gelingt das Speichern nicht, wird die Datei wieder entfernt
  async function speichern(blob, meta, info) {
    const d = await h().aendere((p) => M().dateiAnlegen(p, meta));
    const s = S();
    const ok = s ? await s.speichereMedienInhalt(d.id, { blob: blob, sha: meta.gitSha, mime: meta.mime }) : false;
    if (!ok) {
      try { await h().aendere((p) => M().dateiLoeschen(p, d.id)); } catch (e) { /* bleibt als Eintrag ohne Inhalt */ }
      return { name: meta.name, fehler: 'Nicht gespeichert – der Browser-Speicher hat die Datei nicht angenommen (voll oder gesperrt?).' };
    }
    if (info.b || info.k) await s.speichereMedienBilder(d.id, { b: info.b || null, k: info.k || null });
    M().bildVergessen(d.id);
    M().inhaltDa(d.id, true);
    const hinweise = [];
    if (M().zuGrossFuerUpload(d.groesse)) hinweise.push(M().HINWEIS_GROSS);
    if (!info.vorschau && d.art !== 'video') hinweise.push('Vorschau in diesem Browser nicht möglich');
    if (d.art === 'video' && !info.abspielbar) hinweise.push('Dieser Browser spielt das Format (' + M().formatKurz(d) + ') nicht ab – auf dem iPad bzw. iPhone prüfen.');
    return { datei: d, hinweise: hinweise };
  }

  /* ---------- Grafik aus einem Flyer ---------- */
  function flyerSeitenTafel() {
    const u = U();
    const nr = BI().gewaehlteVersion();
    u.tafel('Grafik aus einem Flyer', (inhalt) => {
      inhalt.appendChild(el('p', 'Version ' + nr + ' – Seite wählen', 't-klein'));
      const liste = el('div', undefined, 't-liste');
      for (const d of I().seitenDer(nr)) liste.appendChild(knopf(d.id + ' · ' + d.titel, () => flyerGrafikWahl(nr, d.id)));
      inhalt.appendChild(liste);
    });
  }
  function flyerGrafikWahl(nr, id) {
    const u = U();
    let wahl = null;
    u.tafel(id + ' · Grafik wählen', (inhalt) => {
      const c = I().flyerCacheFuer(nr, false), s = c && c.seiten.get(id);
      if (!s) {
        inhalt.appendChild(el('p', 'Grafiken werden erkannt …', 't-klein'));
        BI().flyerVorbereiten(nr, (fertig) => { if (fertig === id && inhalt.isConnected) { while (inhalt.firstChild) inhalt.removeChild(inhalt.firstChild); bauen(inhalt); } });
        return;
      }
      bauen(inhalt);
    });
    function bauen(inhalt) {
      const s = I().flyerCacheFuer(nr, false).seiten.get(id);
      if (!s.grafiken.length) { inhalt.appendChild(el('p', 'Auf dieser Seite wurden keine Grafiken erkannt.', 't-klein')); return; }
      const raster = el('div', undefined, 'g-raster');
      const ok = knopf('Als eigene Datei übernehmen', () => { if (wahl) grafikUebernehmen(s, wahl); }, 'g-sel');
      ok.disabled = true;
      for (const g of s.grafiken) {
        const b = I().grafikKnopf(s, g, () => {
          wahl = g;
          for (const x of raster.querySelectorAll('button')) x.setAttribute('aria-pressed', String(x === b));
          ok.disabled = !g.png;
        });
        b.setAttribute('aria-pressed', 'false');
        raster.appendChild(b);
      }
      inhalt.append(raster, ok);
    }
  }
  // E3: Grafik als eigene, benennbare PNG-Datei der Bibliothek („<Seite> · <Grafik-Art>“)
  async function grafikUebernehmen(s, g) {
    if (!g || !g.png) return null;
    const blob = new Blob([g.png], { type: 'image/png' });
    let r;
    try {
      const fmt = M().formatVon('x.png', 'image/png');
      const info = await M().einlesen(blob, fmt, g.png);
      const sha = await M().gitSha(blob);
      r = await speichern(blob, {
        name: s.dok.id + ' · ' + (I().ART_GRAFIK[g.art] || g.art), art: 'grafik', mime: 'image/png', groesse: blob.size,
        breite: info.breite, hoehe: info.hoehe, dauer: null, endung: 'png', gitSha: sha, herkunft: 'flyer-kopie',
        quelle: { version: s.nr, seite: s.dok.id, grafik: g.nr }, startbild: null, ordner: zielOrdner ? [zielOrdner] : []
      }, Object.assign(info, { art: 'grafik' }));
    } catch (e) { r = { fehler: [(e && e.title) || 'Nicht übernommen.', e && e.text].filter(Boolean).join(' ') }; }
    if (r.fehler) { meldung(r.fehler); return null; }
    meldung('Als eigene Datei übernommen: ' + r.datei.name);
    const u = U(); if (u) u.schliesseTafel();
    return r.datei;
  }

  /* ---------- Menü einer Datei ---------- */
  function kenndaten(d) {
    const t = [M().formatKurz(d)];
    if (d.breite && d.hoehe) t.push(Math.round(d.breite) + ' × ' + Math.round(d.hoehe));
    if (typeof d.dauer === 'number' && (d.art === 'video' || d.art === 'animation')) t.push(M().dauerText(d.dauer));
    t.push(M().groesseText(d.groesse));
    const st = I().statusVon(d);
    t.push(st === 'online' ? 'online in aether-medien' : 'nur auf diesem Gerät');
    return M().ART_NAME[d.art] + ' · ' + t.join(' · ');
  }
  // Vorschau: Video → Player (flyer-player.js), Animation → Inhalt (läuft wie ein Bild in Schleife), Foto/Grafik → Bild
  function vorschau(d, ziel) {
    const box = el('div', undefined, 'm-vorschau');
    ziel.appendChild(box);
    const pl = PL();
    if (d.art === 'video' && pl && typeof pl.player === 'function') { box.appendChild(pl.player(d, { ort: 'bibliothek' })); return box; }
    const ersatz = el('div', M().hatInhalt(d.id) ? 'Vorschau wird geladen …' : (navigator.onLine === false ? 'offline nicht verfügbar' : 'nicht auf diesem Gerät'), 'm-ersatz');
    box.appendChild(ersatz);
    const zeige = (url) => {
      if (!url || !box.isConnected) return;
      const img = el('img');
      img.alt = d.name;
      img.src = url;
      ersatz.remove();
      box.insertBefore(img, box.firstChild);
      return img;
    };
    (async () => {
      if (d.art === 'animation' || (d.art === 'grafik' && d.mime === 'image/svg+xml') || d.art === 'foto') {
        const s = S(), e = s ? await s.ladeMedienInhalt(d.id) : null;
        if (e && e.blob && d.art !== 'foto') { const img = zeige(I().urlMerken(URL.createObjectURL(e.blob), null)); if (img) I().urlMerken('', img); return; }
      }
      const b = await M().bildLaden(d.id, 'b');
      if (b) zeige(b.url);
      else if (M().hatInhalt(d.id)) ersatz.textContent = 'Vorschau in diesem Browser nicht möglich';
    })().catch(() => {});
    return box;
  }
  function dateiMenue(id) {
    const u = U(), d0 = M().datei(pk(), id);
    if (!u || !d0) return;
    let teilen = null;   // vorbereitete Datei fürs Teilen (synchron im Klick)
    u.tafel(d0.name, (inhalt) => {
      const d = M().datei(pk(), id);
      if (!d) { u.zurueck(); return; }
      $('tafelTitel').textContent = d.name;
      const box = vorschau(d, inhalt);
      inhalt.appendChild(el('p', kenndaten(d), 'm-kenn'));
      if (I().statusVon(d) === 'geraet' && M().zuGrossFuerUpload(d.groesse)) inhalt.appendChild(el('p', M().HINWEIS_GROSS, 't-hinweis'));
      const liste = el('div', undefined, 't-liste t-menue');
      const pl = PL();
      if (d.art === 'video') {
        const b = knopf('Abspielen', () => { if (pl && typeof pl.abspielen === 'function') pl.abspielen(box.querySelector('.pl')); });
        b.disabled = !pl;
        liste.appendChild(b);
      } else liste.appendChild(knopf('Ansehen', () => ansehen(id)));
      liste.appendChild(knopf('Umbenennen', () => umbenennen(id)));
      liste.appendChild(knopf('In Ordner …', () => inOrdnerTafel(id)));
      liste.appendChild(knopf('In Seite einsetzen …', () => inSeiteTafel(id)));
      const tb = knopf('Herunterladen / Teilen', (ev) => weitergeben(d, teilen, ev));
      tb.setAttribute('data-k', 'teilen');
      tb.disabled = !teilen;
      liste.appendChild(tb);
      const be = knopf('Bearbeiten (ab F3d)', () => {});
      be.disabled = true;
      liste.appendChild(be);
      liste.appendChild(knopf('Löschen', () => loeschen(id), 'gefahr'));
      inhalt.appendChild(liste);
      if (!teilen) {
        M().inhalt(d).then((blob) => {
          if (!blob) { tb.textContent = navigator.onLine === false ? 'Herunterladen / Teilen (offline nicht verfügbar)' : 'Herunterladen / Teilen (nicht auf diesem Gerät)'; return; }
          teilen = new File([blob], d.datei, { type: d.mime });
          tb.disabled = false;
        }, () => {});
      }
    });
  }
  function weitergeben(d, datei, ev) {
    if (!datei) return;
    const g = G();
    if (!g.mitGeste(ev)) { meldung('Bitte den Knopf antippen'); return; }
    const b = B();
    if (b && typeof b.weitergeben === 'function') b.weitergeben(datei, d.name, () => meldung(d.name + ' gesichert'));
    else if (EX()) { EX().herunterladenUndFreigeben(datei); meldung(d.name + ' wird heruntergeladen'); }
  }
  function ansehen(id) {
    const u = U(), d = M().datei(pk(), id);
    if (!d) return;
    u.tafel(d.name, (inhalt) => { vorschau(d, inhalt); inhalt.appendChild(el('p', kenndaten(d), 'm-kenn')); });
  }
  function umbenennen(id) {
    const u = U(), d = M().datei(pk(), id);
    if (!d) return;
    u.eingabeTafel('Datei umbenennen', 'Name in der Bibliothek (der Dateiname im Repo bleibt ' + d.datei + ')', d.name, M().MAX_NAME,
      (w) => (!w.trim() ? 'Die Datei braucht einen Namen.' : ''),
      async (w) => { await h().aendere((p) => M().dateiUmbenennen(p, id, w)); meldung('Datei umbenannt'); u.zurueck(); });
  }
  // Ankreuzliste aller Ordner der Bibliothek (mehrere möglich, wirkt sofort)
  function inOrdnerTafel(id) {
    const u = U();
    u.tafel('In Ordner', (inhalt) => {
      const p = pk(), d = M().datei(p, id);
      if (!d) { u.zurueck(); return; }
      inhalt.appendChild(I().abschnitt('In Ordner (mehrere möglich)'));
      const baum = M().ordnerBaum(p);
      if (!baum.length) { inhalt.appendChild(el('p', 'In der Bibliothek gibt es noch keine Ordner.', 't-klein')); return; }
      const liste = el('div', undefined, 't-liste');
      for (const x of baum) {
        const lab = el('label', undefined, 't-check');
        lab.style.paddingLeft = (6 + x.ebene * 22) + 'px';
        const cb = el('input');
        cb.type = 'checkbox';
        cb.checked = d.ordner.indexOf(x.ordner.id) >= 0;
        cb.setAttribute('data-ordner', x.ordner.id);
        cb.addEventListener('change', () => {
          const jetzt = M().datei(pk(), id);
          if (!jetzt) return;
          const ids = new Set(jetzt.ordner);
          if (cb.checked) ids.add(x.ordner.id); else ids.delete(x.ordner.id);
          I().aendere((q) => M().dateiInOrdner(q, id, Array.from(ids))).catch(() => {});
        });
        lab.append(cb, el('span', x.ordner.name));
        liste.appendChild(lab);
      }
      inhalt.appendChild(liste);
    });
  }
  // Seiten der geöffneten Version mit Medium-Platz (Vorlage „Bild / Video“) oder eine neue Seite mit diesem Medium
  function inSeiteTafel(id) {
    const u = U();
    u.tafel('In Seite einsetzen', (inhalt) => {
      const p = pk(), nr = I().offen(), v = ST().version(p, nr);
      if (!v || !M().datei(p, id)) { u.zurueck(); return; }
      inhalt.appendChild(el('p', 'Version ' + nr + ' – Seiten aus der Vorlage „Bild / Video“', 't-klein'));
      const liste = el('div', undefined, 't-liste');
      const plaetze = v.seiten.filter((s) => M().hatMediumPlatz(s.html));
      for (const s of plaetze) {
        const jetzt = Array.from(M().verweiseIn(s.html));
        const b = knopf(s.id + ' · ' + s.titel + (jetzt.length ? ' (zeigt jetzt ' + jetzt.join(', ') + ')' : ' (noch leer)'), async () => {
          try { await I().aendere((q) => M().seiteMitMedium(q, nr, s.id, { medium: id }), 'Medium in ' + s.id + ' eingesetzt'); u.schliesseTafel(); } catch (e) { /* Meldung gezeigt */ }
        });
        b.disabled = jetzt.length === 1 && jetzt[0] === id;
        liste.appendChild(b);
      }
      if (!plaetze.length) liste.appendChild(el('p', 'In dieser Version gibt es noch keine Seite aus der Vorlage „Bild / Video“.', 't-klein'));
      const vl = ST().VORLAGEN.find((x) => x.id === 'bild-video');
      const neu = knopf('Neue Seite mit diesem Medium', () => neueSeite(id), 'neu');
      neu.disabled = !vl || vl.gesperrt === true;
      liste.appendChild(neu);
      inhalt.appendChild(liste);
    });
  }
  async function neueSeite(id) {
    const nr = I().offen(), a = A();
    const oid = a && typeof a.aktuellerOrdner === 'function' ? a.aktuellerOrdner() : null;
    let s;
    try { s = await I().aendere((p) => ST().seiteAnlegen(p, nr, { vorlage: 'bild-video', medium: id, heute: heute(), ordner: oid ? [oid] : [] })); } catch (e) { return null; }
    const u = U(); if (u) u.schliesseTafel();
    BI().setzeReiter('seiten');
    if (a) await a.oeffneDok(s.id);
    meldung('Seite ' + s.id + ' mit Medium ' + id + ' angelegt');
    return s;
  }
  // Löschen: Rückfrage nennt die Seiten (Version · Kennung), die danach „Medium fehlt“ zeigen, und – wenn online –
  // dass die Datei im Repo aether-medien bleibt, bis Konstantin sie dort selbst löscht
  async function loeschen(id) {
    const p = pk(), d = M().datei(p, id);
    if (!d) return false;
    const verw = M().verwendung(p, id);
    const online = I().statusVon(d) === 'online';
    const text = 'Datei „' + d.name + '“ löschen?' +
      (verw.length ? ' Sie wird verwendet in: ' + verw.map((x) => x.version + ' · ' + x.seite).join(', ') + ' – diese Seiten zeigen danach „Medium fehlt (' + id + ')“.' : '') +
      (online ? ' Die Datei bleibt im Repo aether-medien (' + d.datei + '), bis du sie dort selbst löschst.' : ' Sie liegt nur auf diesem Gerät und ist danach weg.');
    if (!I().frage(text)) return false;
    try { await I().aendere((q) => M().dateiLoeschen(q, id), 'Datei gelöscht'); } catch (e) { return false; }
    const s = S();
    if (s) await s.entferneMedium(id);
    M().bildVergessen(id);
    M().inhaltDa(id, false);
    const u = U(); if (u) u.schliesseTafel();
    return true;
  }

  /* ---------- Einrichten ---------- */
  function einrichten() {
    if (eingerichtet) return;
    eingerichtet = true;
    for (const id of ['bDateiFotos', 'bDateiDateien']) { const e = $(id); if (e) e.addEventListener('change', () => { auswahl(e); }); }
    try { BI().zeichnen(); } catch (e) { /* egal */ }
  }

  window.AetherFlyerMedienTafeln = Object.freeze({
    einrichten: einrichten,
    hinzufuegen: hinzufuegen,
    dateienHinzufuegen: dateienHinzufuegen,
    grafikUebernehmen: grafikUebernehmen,
    dateiMenue: dateiMenue,
    loeschen: loeschen,
    inSeiteTafel: inSeiteTafel,
    neueSeite: neueSeite
  });
})();
