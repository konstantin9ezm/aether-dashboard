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
        if (e && e.blob && d.art !== 'foto') {
          const url = URL.createObjectURL(e.blob), img = zeige(url);
          if (img) I().urlMerken(url, img); else URL.revokeObjectURL(url);   // freigegeben, sobald das Bild weg ist
          return;
        }
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
        const b = knopf('Abspielen', () => { if (pl && typeof pl.abspielen === 'function') pl.abspielen(box.querySelector('.ae-pl')); });
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

  /* ---------- „Medien online stellen“ (Teil E) ---------- */
  // Alle Dateien „nur Gerät“ mit dem Dateinamen im Repo; über 25 MiB mit Hinweis (E5) und nicht in „Alle sichern“.
  // „Alle sichern“: eine ZIP („stored“, CRC stückweise vorab, Inhalte als Blob-Teile – nichts doppelt im Speicher) bis
  // 512 MiB, darüber die Dateien einzeln (Teilen mit mehreren Dateien, sonst Herunterladen je Datei).
  function sicherungsTag() { return heute(); }
  function commitText(n) { return 'Medien ' + sicherungsTag() + '.' + n + ' [skip ci]'; }
  async function naechsteNummer() {
    const s = S(), w = s && typeof s.ladeGeraet === 'function' ? await s.ladeGeraet('medienSicherung') : null;
    const m = /^(\d{4}-\d{2}-\d{2})\.(\d+)$/.exec(String(w || ''));
    return m && m[1] === sicherungsTag() ? Number(m[2]) + 1 : 1;
  }
  function nurGeraet() { return M().dateien(pk()).filter((d) => I().statusVon(d) === 'geraet'); }
  // Vorbereiten (beim Öffnen der Tafel, damit das Teilen synchron im Klick geht) → { art: 'zip'|'einzeln', datei|dateien, n, bytes }
  async function sicherungVorbereiten(liste) {
    const s = S(), Z = window.AetherFlyerZip;
    const teile = [];
    for (const d of liste) {
      const e = s ? await s.ladeMedienInhalt(d.id) : null;
      if (e && e.blob) teile.push({ d: d, blob: e.blob });
    }
    const bytes = teile.reduce((x, t) => x + t.blob.size, 0);
    if (!teile.length) return { art: 'leer', n: 0, bytes: 0, fehlen: liste.length };
    if (bytes <= M().ZIP_MAX && Z && typeof Z.schreiber === 'function') {
      const sch = Z.schreiber(new Date());
      for (const t of teile) sch.add(t.d.datei, t.blob, { crc: await M().crc32Blob(t.blob) });
      const datei = new File(sch.teile(), 'aether-medien-' + sicherungsTag() + '.zip', { type: 'application/zip' });
      return { art: 'zip', datei: datei, n: teile.length, bytes: bytes, fehlen: liste.length - teile.length };
    }
    return { art: 'einzeln', dateien: teile.map((t) => new File([t.blob], t.d.datei, { type: t.d.mime })), n: teile.length, bytes: bytes, fehlen: liste.length - teile.length };
  }
  function allesSichern(vb, ev, fertig) {
    if (!vb || !vb.n) return;
    const g = G();
    if (!g.mitGeste(ev)) { meldung('Bitte den Knopf antippen'); return; }
    const gemerkt = () => { const s = S(); if (s && typeof s.speichereGeraet === 'function') s.speichereGeraet('medienSicherung', sicherungsTag() + '.' + vb.nummer).catch(() => {}); if (fertig) fertig(); };
    if (vb.art === 'zip') {
      const b = B();
      if (b && typeof b.weitergeben === 'function') b.weitergeben(vb.datei, 'Aether Medien', () => { meldung(vb.n + (vb.n === 1 ? ' Datei' : ' Dateien') + ' als ZIP gesichert'); gemerkt(); });
      else if (EX()) { EX().herunterladenUndFreigeben(vb.datei); gemerkt(); }
      return;
    }
    // Über der ZIP-Grenze: Dateien einzeln (ein Teilen-Dialog mit allen Dateien, sonst je Datei herunterladen)
    if (g.kannTeilen(vb.dateien)) {
      navigator.share({ files: vb.dateien, title: 'Aether Medien' }).then(() => { meldung(vb.n + ' Dateien gesichert'); gemerkt(); }).catch(() => {});
      return;
    }
    if (EX()) { for (const f of vb.dateien) EX().herunterladenUndFreigeben(f); meldung(vb.n + ' Dateien werden heruntergeladen'); gemerkt(); }
  }
  function onlineStellen() {
    const u = U();
    if (!u) return;
    let vb = null, nummer = 1, vbNr = 0;
    u.tafel('Medien online stellen', (inhalt) => {
      const alle = nurGeraet();
      const klein = alle.filter((d) => !M().zuGrossFuerUpload(d.groesse));
      const summe = alle.reduce((x, d) => x + d.groesse, 0);
      const kopf = el('p', alle.length ? alle.length + (alle.length === 1 ? ' neue Datei' : ' neue Dateien') + ' nur auf diesem Gerät · zusammen ' + M().groesseText(summe)
        : 'Alle Dateien der Bibliothek liegen online in aether-medien (oder es gibt noch keine).', 'm-kenn');
      kopf.id = 'mOnlineKopf';
      inhalt.appendChild(kopf);
      const liste = el('div', undefined, 'm-liste');
      for (const d of alle) {
        const gross = M().zuGrossFuerUpload(d.groesse);
        const z = el('div', undefined, 'm-zeile' + (gross ? ' zu-gross' : ''));
        z.setAttribute('data-id', d.id);
        const t = el('div', undefined, 'm-dname');
        t.appendChild(el('div', d.datei));
        if (gross) t.appendChild(el('div', M().HINWEIS_GROSS, 't-hinweis'));
        if (!M().hatInhalt(d.id)) t.appendChild(el('div', 'Inhalt nicht auf diesem Gerät – von dem Gerät aus hochladen, auf dem die Datei hinzugefügt wurde.', 't-hinweis'));
        z.append(t, el('span', M().groesseText(d.groesse), 'm-dgroesse'));
        liste.appendChild(z);
      }
      inhalt.appendChild(liste);
      const ol = el('ol', undefined, 'm-anleitung');
      const schritt = (teile) => { const li = el('li'); for (const x of teile) li.appendChild(typeof x === 'string' ? document.createTextNode(x) : x); ol.appendChild(li); };
      const code = (t) => el('code', t);
      schritt(['„Alle sichern“ → in der Dateien-App ablegen (ZIP vorher in der Dateien-App entpacken)']);
      schritt(['Upload-Seite öffnen: github.com/konstantin9ezm/aether-medien/upload/main/medien']);
      const ct = code(commitText(nummer));
      ct.id = 'mCommit';
      schritt(['Dateien hineinziehen bzw. auswählen, Nachricht ', ct]);
      schritt(['„Commit changes“']);
      schritt(['Danach wie gewohnt „Paket exportieren“ und das Paket ins Repo aether hochladen (das Paket kennt Dateinamen und Prüfsummen). Dann „Online prüfen“: die Dateien werden grün.']);
      inhalt.appendChild(ol);
      const row = el('div', undefined, 'row');
      const sichern = knopf('Alle sichern', (ev) => allesSichern(vb, ev, () => { nummer++; ct.textContent = commitText(nummer); }), 'g-sel');
      sichern.id = 'mAlleSichern';
      sichern.disabled = true;
      sichern.style.width = 'auto';
      sichern.style.margin = '0';
      const link = el('a', 'Upload-Seite öffnen');
      link.href = M().UPLOAD_SEITE;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      link.id = 'mUploadSeite';
      link.className = 'g-knopf-link';
      row.append(sichern, link);
      inhalt.appendChild(row);
      const stand = el('p', '', 't-klein');
      stand.id = 'mSicherungStand';
      stand.setAttribute('role', 'status');
      inhalt.appendChild(stand);
      inhalt.appendChild(el('p', 'Dateien über 25 MiB: GitHub nimmt im Browser höchstens 25 MiB je Datei an – sie bleiben vorerst nur auf diesem Gerät und kommen nicht in „Alle sichern“.', 't-hinweis'));
      // Vorbereiten (einmal je Inhalt der Tafel)
      const nr = ++vbNr;
      if (!klein.length) { stand.textContent = alle.length ? 'Keine Datei bis 25 MiB zum Sichern.' : ''; return; }
      stand.textContent = 'Wird vorbereitet …';
      Promise.all([naechsteNummer(), sicherungVorbereiten(klein)]).then(([n, v]) => {
        if (nr !== vbNr) return;
        nummer = n; ct.textContent = commitText(nummer);
        vb = v; vb.nummer = n;
        sichern.disabled = !v.n;
        stand.textContent = v.art === 'zip' ? 'Bereit: ' + v.n + (v.n === 1 ? ' Datei' : ' Dateien') + ' als ZIP (' + M().groesseText(v.datei.size) + ')'
          : v.art === 'einzeln' ? 'Bereit: ' + v.n + ' Dateien einzeln (zusammen über ' + M().groesseText(M().ZIP_MAX) + ' – zu groß für eine ZIP)' : 'Kein Inhalt auf diesem Gerät.';
        if (v.fehlen) stand.textContent += ' · ' + v.fehlen + ' ohne Inhalt auf diesem Gerät';
      }, (e) => { if (nr === vbNr) stand.textContent = 'Sichern nicht möglich: ' + ((e && e.message) || e); });
    });
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
    neueSeite: neueSeite,
    onlineStellen: onlineStellen,
    sicherungVorbereiten: sicherungVorbereiten
  });
})();
