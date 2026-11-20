// Player und Medien in Seiten (flyer.html, F3b Teil D): eigene Steuerleiste (Abspielen/Pause, Zeit „0:12 / 0:42“,
// Zeitleiste zum Springen, Ton an/aus, Schleife, Tempo 0,5×/1×/1,5×/2×, Vollbild), playsinline, Tippflächen ≥ 44 px
// auf dem Bildschirm (auch in einer verkleinert dargestellten Seite), Leertaste Abspielen/Pause außerhalb von Textfeldern.
// Standard: Ton an, Schleife aus, Autostart aus; Autostart nur zusammen mit „Ton aus“ (sonst Hinweis, F7).
// Ein Video wird erst beim Abspielen gelesen: Object-URL aus dem Geräte-Speicher (preload „none“), sonst online
// nachladen (AetherFlyerMedien.inhalt → flyer-medien-online.js); Object-URLs werden wieder freigegeben, sobald der Player
// nicht mehr im Dokument steht (dann wird auch angehalten).
// Seiten aus der Vorlage „Bild / Video“ tragen nur den Verweis data-medium="m<n>" (F8): anpassen(wurzel, dok, ort) setzt
// bei jeder Darstellung den Inhalt ein – im Vollbild den Player (bzw. das Bild, Animationen laufen wie Bilder in
// Schleife), in Kachel, Druck, „Bild“ und Grafik-Export das Startbild (Video) bzw. das erste Bild (Animation) (F9);
// fehlt die Datei: Platzhalter „Medium fehlt (m<n>)“. Im Vollbild neuer Modus „Medium“: Medium wählen, Startbild
// (Zeitpunkt), Ton aus, Schleife, Autostart – geändert wird das HTML der Seite über h.aendere (nur Verweis und Schalter).
// Alles nur über DOM-Methoden (kein HTML-Text); die Steuerleiste bringt ihre Stile selbst mit (sie steht auch im
// Shadow Root einer Seite, wo die Regeln von flyer.html nicht gelten).
(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const M = () => window.AetherFlyerMedien;
  const S = () => window.AetherFlyerSpeicher || null;
  const A = () => window.AetherFlyerAnsicht || null;
  const B = () => window.AetherFlyerBearbeiten || null;
  const G = () => window.AetherGemeinsam;
  const TEMPI = [0.5, 1, 1.5, 2];
  const TIPP_PX = 44;
  const KNOPF_TYPEN = ['button', 'submit', 'reset', 'image', 'hidden', 'file', 'checkbox', 'radio', 'range'];
  // Stile der Steuerleiste (Klassen mit Präfix ae-pl, damit weder Seite noch Paket-CSS hineinwirken); --ae-k gleicht
  // eine verkleinerte Darstellung aus, damit Tippflächen auf dem Bildschirm mindestens 44 px groß bleiben.
  const STIL = '.ae-pl{position:relative;display:block;width:100%;height:100%;min-height:120px;background:#000;overflow:hidden;font:500 calc(15px*var(--ae-k,1))/1.2 system-ui,-apple-system,"Segoe UI",sans-serif;color:#fff;--ae-k:1}' +
    '.ae-pl video{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;background:#000;display:block}' +
    '.ae-pl .ae-pl-leiste{position:absolute;left:calc(8px*var(--ae-k));right:calc(8px*var(--ae-k));bottom:calc(8px*var(--ae-k));display:flex;flex-wrap:wrap;align-items:center;gap:0 calc(4px*var(--ae-k));padding:0 calc(6px*var(--ae-k));border-radius:calc(10px*var(--ae-k));background:rgba(0,0,0,.78)}' +
    '.ae-pl button{all:unset;box-sizing:border-box;display:inline-flex;align-items:center;justify-content:center;min-width:calc(44px*var(--ae-k));min-height:calc(44px*var(--ae-k));padding:0 calc(8px*var(--ae-k));border-radius:calc(8px*var(--ae-k));cursor:pointer;color:#fff;font:inherit;white-space:nowrap}' +
    '.ae-pl button:focus-visible{outline:2px solid #ffa02e;outline-offset:-2px}.ae-pl button[aria-pressed="true"]{color:#ffa02e}' +
    '.ae-pl .ae-pl-spiel{font-size:calc(20px*var(--ae-k))}' +
    '.ae-pl .ae-pl-zeit{font-variant-numeric:tabular-nums;white-space:nowrap;padding:0 calc(4px*var(--ae-k))}' +
    '.ae-pl input[type=range]{flex:1 1 calc(80px*var(--ae-k));min-width:calc(80px*var(--ae-k));height:calc(44px*var(--ae-k));margin:0;accent-color:#ffa02e;background:transparent;cursor:pointer}' +
    '.ae-pl .ae-pl-hinweis{position:absolute;left:calc(8px*var(--ae-k));right:calc(8px*var(--ae-k));top:calc(8px*var(--ae-k));margin:0;padding:calc(6px*var(--ae-k)) calc(10px*var(--ae-k));border-radius:calc(8px*var(--ae-k));background:rgba(0,0,0,.78);font-size:calc(14px*var(--ae-k))}' +
    '.ae-pl .ae-pl-hinweis[hidden]{display:none}';
  const PLATZ_STIL = 'position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;text-align:center;color:#c9cbe0;background:#0b1222;font-size:22px;line-height:1.3;font-weight:600';
  const BILD_STIL = 'position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block';

  let h = null;
  let eingerichtet = false;
  const player = new Set();     // { el, video, url, d }
  let geladenNr = 0;

  function el(tag, text, klasse) { const e = document.createElement(tag); if (text !== undefined && text !== null) e.textContent = text; if (klasse) e.className = klasse; return e; }
  function knopf(text, klasse, label) { const b = el('button', text, klasse); b.type = 'button'; if (label) b.setAttribute('aria-label', label); return b; }
  function pk() { try { return h ? h.paketV2() : null; } catch (e) { return null; } }
  function tempoText(t) { return String(t).replace('.', ',') + '×'; }
  function meldung(t) { try { G().meldung(t); } catch (e) { /* egal */ } }

  /* ---------- Player ---------- */
  // Steuerleiste auf dem Bildschirm mindestens 44 px: Verkleinerung der Darstellung (transform) ausgleichen
  function masse(p) {
    const r = p.el.getBoundingClientRect(), w = p.el.offsetWidth;
    if (!w || !r.width) return;
    const k = Math.max(1, Math.min(4, w / r.width));
    p.el.style.setProperty('--ae-k', String(Math.round(k * 1000) / 1000));
  }
  function aufraeumen() {
    for (const p of Array.from(player)) {
      if (p.el.isConnected) continue;
      try { p.video.pause(); p.video.removeAttribute('src'); p.video.load(); } catch (e) { /* egal */ }
      if (p.url) { try { URL.revokeObjectURL(p.url); } catch (e) { /* egal */ } }
      if (p.beob) p.beob.disconnect();
      player.delete(p);
    }
  }
  function hinweis(p, text) { p.hinweis.textContent = text || ''; p.hinweis.hidden = !text; }
  function zeitZeigen(p) {
    const v = p.video;
    const d = isFinite(v.duration) && v.duration > 0 ? v.duration : (typeof p.d.dauer === 'number' ? p.d.dauer : 0);
    p.zeit.textContent = M().dauerText(v.currentTime || 0) + ' / ' + M().dauerText(d);
    p.leiste.max = String(d || 0);
    if (!p.ziehen) p.leiste.value = String(v.currentTime || 0);
    p.spiel.textContent = v.paused ? '▶' : '❚❚';
    p.spiel.setAttribute('aria-label', v.paused ? 'Abspielen' : 'Pause');
    p.ton.setAttribute('aria-pressed', String(!v.muted));
    p.ton.setAttribute('aria-label', v.muted ? 'Ton aus' : 'Ton an');
    p.schleife.setAttribute('aria-pressed', String(v.loop));
    p.tempo.textContent = tempoText(v.playbackRate || 1);
  }
  // Inhalt bereitstellen (aus dem Gerät, sonst online) → true, wenn video.src gesetzt ist
  async function quelleSetzen(p) {
    if (p.url) return true;
    if (p.laedt) return p.laedt;
    p.laedt = (async () => {
      hinweis(p, M().hatInhalt(p.d.id) ? '' : 'Lädt …');
      let blob = null;
      try { blob = await M().inhalt(p.d); } catch (e) { blob = null; }
      if (!blob) { hinweis(p, navigator.onLine === false ? 'offline nicht verfügbar' : 'Video nicht auf diesem Gerät (und online nicht ladbar)'); return false; }
      if (!p.el.isConnected && p.eingesetzt) return false;
      p.url = URL.createObjectURL(blob);
      p.video.src = p.url;
      hinweis(p, '');
      return true;
    })().finally(() => { p.laedt = null; });
    return p.laedt;
  }
  function spielen(p) {
    const v = p.video;
    const los = () => {
      const r = v.play();
      if (r && typeof r.catch === 'function') r.catch((e) => {
        if (e && e.name === 'NotAllowedError') hinweis(p, 'Zum Abspielen bitte noch einmal antippen.');
        else if (e && e.name === 'NotSupportedError') hinweis(p, 'Dieser Browser spielt das Format (' + M().formatKurz(p.d) + ') nicht ab.');
      });
    };
    if (p.url) { los(); return Promise.resolve(true); }
    return quelleSetzen(p).then((ok) => { if (ok) los(); return ok; });
  }
  function umschalten(p) { if (p.video.paused) spielen(p); else p.video.pause(); }
  function vollbild(p) {
    const doc = document, c = p.el, v = p.video;
    const aktiv = doc.fullscreenElement || doc.webkitFullscreenElement;
    if (aktiv) { (doc.exitFullscreen || doc.webkitExitFullscreen).call(doc); return; }
    const req = c.requestFullscreen || c.webkitRequestFullscreen;
    if (req) { try { const r = req.call(c); if (r && r.catch) r.catch(() => {}); return; } catch (e) { /* weiter */ } }
    if (typeof v.webkitEnterFullscreen === 'function') { quelleSetzen(p).then((ok) => { if (ok) { try { v.webkitEnterFullscreen(); } catch (e) { /* egal */ } } }); return; }
    hinweis(p, 'Vollbild ist in diesem Browser nicht möglich.');
  }
  // Player für eine Datei d. opt = { ort, tonAus, schleife, autostart } → Element (div.ae-pl)
  function neuerPlayer(d, opt) {
    const o = opt || {};
    aufraeumen();
    const wurzel = el('div', undefined, 'ae-pl');
    wurzel.setAttribute('data-medium-player', d.id);
    wurzel.appendChild(el('style', STIL));
    const v = el('video');
    v.setAttribute('playsinline', '');
    v.playsInline = true;
    v.preload = 'none';
    v.muted = o.tonAus === true;
    if (o.tonAus === true) v.setAttribute('muted', '');
    v.loop = o.schleife === true;
    const sb = M().bild(d.id, 'b');
    if (sb) v.poster = o.ort === 'bild' ? sb.daten : sb.url;
    else M().bildLaden(d.id, 'b').then((x) => { if (x && !v.poster) v.poster = x.url; }, () => {});
    const leiste = el('div', undefined, 'ae-pl-leiste');
    leiste.setAttribute('role', 'group');
    leiste.setAttribute('aria-label', 'Video ' + d.name);
    const spiel = knopf('▶', 'ae-pl-spiel', 'Abspielen');
    const zeit = el('span', '0:00 / ' + M().dauerText(d.dauer || 0), 'ae-pl-zeit');
    const zl = el('input');
    zl.type = 'range'; zl.min = '0'; zl.step = '0.1'; zl.value = '0'; zl.max = String(d.dauer || 0);
    zl.setAttribute('aria-label', 'Zeitleiste');
    const ton = knopf('Ton', 'ae-pl-ton', 'Ton an');
    const schleife = knopf('Schleife', 'ae-pl-schleife', 'Schleife');
    const tempo = knopf('1×', 'ae-pl-tempo', 'Tempo');
    const voll = knopf('Vollbild', 'ae-pl-voll', 'Vollbild');
    leiste.append(spiel, zeit, zl, ton, schleife, tempo, voll);
    const hw = el('p', '', 'ae-pl-hinweis');
    hw.setAttribute('role', 'status');
    hw.hidden = true;
    wurzel.append(v, leiste, hw);
    const p = { el: wurzel, video: v, url: null, d: d, spiel: spiel, zeit: zeit, leiste: zl, ton: ton, schleife: schleife, tempo: tempo, hinweis: hw, ziehen: false, eingesetzt: false };
    player.add(p);
    spiel.addEventListener('click', (e) => { e.stopPropagation(); umschalten(p); });
    v.addEventListener('click', () => umschalten(p));
    ton.addEventListener('click', (e) => { e.stopPropagation(); v.muted = !v.muted; if (!v.muted) v.removeAttribute('muted'); zeitZeigen(p); });
    schleife.addEventListener('click', (e) => { e.stopPropagation(); v.loop = !v.loop; zeitZeigen(p); });
    tempo.addEventListener('click', (e) => {
      e.stopPropagation();
      const i = TEMPI.indexOf(v.playbackRate);
      v.playbackRate = TEMPI[(i + 1) % TEMPI.length];
      v.defaultPlaybackRate = v.playbackRate;
      zeitZeigen(p);
    });
    voll.addEventListener('click', (e) => { e.stopPropagation(); vollbild(p); });
    zl.addEventListener('input', () => {
      p.ziehen = true;
      const t = Number(zl.value) || 0;
      quelleSetzen(p).then((ok) => { if (ok) { try { v.currentTime = t; } catch (x) { /* egal */ } } p.ziehen = false; zeitZeigen(p); });
    });
    zl.addEventListener('change', () => { p.ziehen = false; });
    for (const ev of ['play', 'pause', 'timeupdate', 'durationchange', 'loadedmetadata', 'ratechange', 'volumechange', 'ended', 'seeked']) v.addEventListener(ev, () => zeitZeigen(p));
    v.addEventListener('error', () => { if (p.url) hinweis(p, 'Dieser Browser spielt das Format (' + M().formatKurz(d) + ') nicht ab.'); });
    // Liegt der Inhalt auf dem Gerät, die Object-URL schon jetzt setzen (preload none: gelesen wird erst beim Abspielen)
    // – so startet „Abspielen“ synchron im Antippen (iOS verlangt dafür eine frische Nutzergeste).
    if (M().hatInhalt(d.id) && o.ort !== 'bild') quelleSetzen(p);
    if (o.autostart === true) {
      if (o.tonAus === true) {
        const start = () => { if (!wurzel.isConnected) { if (++p.versuche < 50) setTimeout(start, 50); return; } p.eingesetzt = true; v.muted = true; spielen(p); };
        p.versuche = 0;
        setTimeout(start, 0);
      } else hinweis(p, 'Autostart nur mit „Ton aus“ – Video bitte antippen.');
    }
    if (typeof ResizeObserver === 'function') {
      p.beob = new ResizeObserver(() => masse(p));
      p.beob.observe(wurzel);
    }
    setTimeout(() => { if (wurzel.isConnected) { p.eingesetzt = true; masse(p); } }, 0);
    zeitZeigen(p);
    return wurzel;
  }
  function playerVon(elem) { for (const p of player) if (p.el === elem) return p; return null; }
  function abspielen(elem) { const p = elem ? playerVon(elem) : null; return p ? spielen(p) : Promise.resolve(false); }

  /* ---------- Medien in Seiten (data-medium) ---------- */
  function platzhalter(text) { const d = el('div', text); d.setAttribute('style', PLATZ_STIL); d.setAttribute('data-medium-platzhalter', ''); return d; }
  function bildEl(url, alt) { const i = el('img'); i.setAttribute('style', BILD_STIL); i.alt = alt || ''; i.src = url; i.setAttribute('data-medium-bild', ''); return i; }
  function mitAttr(w, attr) { const r = []; if (w.nodeType === 1 && w.hasAttribute(attr)) r.push(w); for (const e of w.querySelectorAll('[' + attr + ']')) r.push(e); return r; }
  // Für jede Darstellung (Kachel, Vollbild, Druck, Bild): Inhalt der Medium-Plätze einsetzen
  function anpassen(wurzel, dok, ort) {
    const plaetze = mitAttr(wurzel, 'data-medium');
    if (!plaetze.length) return;
    const p = pk();
    for (const platz of plaetze) {
      while (platz.firstChild) platz.removeChild(platz.firstChild);
      const id = platz.getAttribute('data-medium') || '';
      if (!id) { platz.appendChild(platzhalter(ort === 'vollbild' ? 'Kein Medium gewählt – Modus „Medium“' : 'Kein Medium gewählt')); continue; }
      const d = p ? M().datei(p, id) : null;
      if (!d) { platz.appendChild(platzhalter('Medium fehlt (' + id + ')')); continue; }
      const sb = M().bild(id, 'b');
      if (ort === 'vollbild' && d.art === 'video') {
        platz.appendChild(neuerPlayer(d, { ort: 'seite', tonAus: platz.getAttribute('data-ton') === 'aus', schleife: platz.getAttribute('data-schleife') === 'an', autostart: platz.getAttribute('data-autostart') === 'an' }));
        continue;
      }
      if (ort === 'vollbild' && d.art === 'animation' && M().hatInhalt(id)) {
        // Animation läuft wie ein Bild in Schleife: Inhalt (Object-URL) statt des ersten Bildes
        const img = bildEl(sb ? sb.url : '', d.name);
        if (!sb) img.removeAttribute('src');
        platz.appendChild(img);
        const s = S();
        if (s) s.ladeMedienInhalt(id).then((e) => {
          if (!e || !e.blob) return;
          const url = URL.createObjectURL(e.blob);
          img.src = url;
          const p2 = { el: img, video: { pause() {}, removeAttribute() {}, load() {} }, url: url, d: d };
          player.add(p2);
        }, () => {});
        continue;
      }
      if (sb) { platz.appendChild(bildEl(ort === 'bild' ? sb.daten : sb.url, d.name)); continue; }
      platz.appendChild(platzhalter(M().hatInhalt(id) ? (d.art === 'video' ? 'Startbild fehlt' : 'Vorschau in diesem Browser nicht möglich') : (navigator.onLine === false ? 'offline nicht verfügbar' : 'Medium nicht auf diesem Gerät (' + id + ')')));
      // Bild später da: Seite neu darstellen (nur Kachel und Vollbild; Druck und Bild bereitet vorladen vor)
      if (ort === 'kachel' || ort === 'vollbild') nachladen(id, dok.id);
    }
  }
  const nachladend = new Set();
  function nachladen(id, dokId) {
    const k = id + '|' + dokId;
    if (nachladend.has(k)) return;
    nachladend.add(k);
    M().bildLaden(id, 'b').then((e) => { if (e) { const a = A(); if (a) a.aktualisiere(dokId); } }, () => {}).finally(() => { setTimeout(() => nachladend.delete(k), 1000); });
  }
  // Startbilder aller Medien der geöffneten Version vorladen (für Druck, „Bild“ und Grafik-Export, die synchron zeichnen)
  async function vorladen() {
    const p = pk();
    if (!p) return;
    const nr = ++geladenNr;
    const ids = M().verwendetIn(p, h.version());
    const fehlten = Array.from(ids).filter((id) => !M().bild(id, 'b'));
    await M().bilderBereit(ids, 'b');
    if (nr !== geladenNr || !fehlten.some((id) => M().bild(id, 'b'))) return;
    const a = A(), s = h.sicht();
    if (!a || !s) return;
    for (const d of s.dokumente) if (fehlten.some((id) => M().verweiseIn(d.html).has(id) && M().bild(id, 'b'))) await a.aktualisiere(d.id);
  }

  /* ---------- Modus „Medium“ im Vollbild ---------- */
  function offenesDok() { const a = A(); return a ? a.offenesDokument() : null; }
  function seiteJetzt(dok) {
    const p = pk(), v = p ? p.versionen.find((x) => x.nummer === h.version()) : null;
    return v && dok ? v.seiten.find((s) => s.id === dok.id) || null : null;
  }
  function knopfZeigen() {
    const b = document.querySelector('#vbModus button[data-modus="medium"]');
    const s = seiteJetzt(offenesDok());
    const hat = !!s && M().hatMediumPlatz(s.html);
    if (b) b.hidden = !hat;
    const bb = B();
    if (!hat && bb && typeof bb.modus === 'function' && bb.modus() === 'medium') bb.setzeModus('ansehen');
    leisteZeigen();
  }
  function leisteZeigen() {
    const box = $('vbMedium');
    if (!box) return;
    const bb = B(), dok = offenesDok(), s = seiteJetzt(dok);
    const an = !!bb && typeof bb.modus === 'function' && bb.modus() === 'medium' && !!s && M().hatMediumPlatz(s.html);
    box.hidden = !an;
    if (!an) return;
    const w = M().mediumVon(s.html) || { medium: '', tonAus: false, schleife: false, autostart: false };
    $('vbMediumLabel').textContent = s.id + ' · Medium' + (w.medium ? ' ' + w.medium : '') + ' (gilt für diese Seite; nur der Verweis steht im Paket)';
    const wahl = $('vbMediumWahl');
    while (wahl.firstChild) wahl.removeChild(wahl.firstChild);
    const leer = el('option', '– kein Medium –'); leer.value = ''; wahl.appendChild(leer);
    for (const d of M().dateien(pk())) { const o = el('option', d.name + ' · ' + M().ART_NAME[d.art] + ' (' + d.id + ')'); o.value = d.id; wahl.appendChild(o); }
    if (w.medium && !M().datei(pk(), w.medium)) { const o = el('option', 'Medium fehlt (' + w.medium + ')'); o.value = w.medium; wahl.appendChild(o); }
    wahl.value = w.medium;
    $('vbMediumTonAus').checked = w.tonAus;
    $('vbMediumSchleife').checked = w.schleife;
    $('vbMediumAutostart').checked = w.autostart;
    const d = w.medium ? M().datei(pk(), w.medium) : null;
    const video = !!d && d.art === 'video';
    for (const id of ['vbMediumTonAus', 'vbMediumSchleife', 'vbMediumAutostart']) $(id).disabled = !video;
    const zeile = $('vbMediumStartZeile');
    zeile.hidden = !video;
    if (video) {
      const r = $('vbMediumStart');
      r.max = String(d.dauer || 0);
      r.value = String(typeof d.startbild === 'number' ? d.startbild : 0);
      $('vbMediumStartZeit').textContent = M().dauerText(Number(r.value)) + ' (' + String(Number(r.value).toFixed(1)).replace('.', ',') + ' s)';
    }
    if (!video) $('vbMediumHinweis').textContent = d ? 'Ton, Schleife und Autostart gibt es nur bei Videos. Animationen laufen wie Bilder in Schleife.' : '';
  }
  async function setzeWerte(werte) {
    const dok = offenesDok(), hw = $('vbMediumHinweis');
    if (!dok) return false;
    hw.textContent = '';
    try { await h.aendere((p) => M().seiteMitMedium(p, h.version(), dok.id, werte)); return true; } catch (e) {
      hw.textContent = [(e && e.title) || 'Nicht möglich.', e && e.text].filter(Boolean).join(' ');
      leisteZeigen();
      hw.textContent = [(e && e.title) || 'Nicht möglich.', e && e.text].filter(Boolean).join(' ');
      return false;
    }
  }
  // Startbild-Zeitpunkt ändern: Bild aus dem Video neu erzeugen (Gerät) und den Zeitpunkt ins Paket
  async function startbildSetzen() {
    const s = seiteJetzt(offenesDok()), w = s ? M().mediumVon(s.html) : null;
    const d = w && w.medium ? M().datei(pk(), w.medium) : null, hw = $('vbMediumHinweis');
    if (!d || d.art !== 'video') return false;
    const t = Number($('vbMediumStart').value) || 0;
    hw.textContent = 'Startbild wird erzeugt …';
    const blob = await M().inhalt(d);
    if (!blob) { hw.textContent = navigator.onLine === false ? 'Video offline nicht verfügbar.' : 'Video nicht auf diesem Gerät.'; return false; }
    const r = await M().videoBild(blob, t, d.mime);
    if (!r.b) { hw.textContent = 'Startbild ließ sich in diesem Browser nicht erzeugen.'; return false; }
    const st = S();
    if (st) await st.speichereMedienBilder(d.id, { b: r.b, k: r.k });
    M().bildVergessen(d.id);
    await M().bildLaden(d.id, 'b');
    try { await h.aendere((p) => M().setzeStartbild(p, d.id, r.t !== null ? r.t : t)); } catch (e) { hw.textContent = (e && e.title) || 'Nicht möglich.'; return false; }
    $('vbMediumHinweis').textContent = 'Startbild bei ' + M().dauerText(t) + ' übernommen.';
    meldung('Startbild übernommen');
    return true;
  }

  /* ---------- Tasten ---------- */
  function tiefesAktives() { let a = document.activeElement; while (a && a.shadowRoot && a.shadowRoot.activeElement) a = a.shadowRoot.activeElement; return a; }
  function istEingabe(e) {
    if (!e) return false;
    if (e.isContentEditable) return true;
    const n = String(e.localName || '').toLowerCase();
    if (n === 'input') return !KNOPF_TYPEN.includes(String(e.type || 'text').toLowerCase());
    return n === 'textarea' || n === 'select';
  }
  function istBedienelement(e) { const n = String((e && e.localName) || '').toLowerCase(); return n === 'button' || n === 'a' || n === 'select' || (n === 'input' && !istEingabe(e)); }
  // Sichtbarer Player: in der obersten Tafel, sonst im Vollbild
  function aktiverPlayer() {
    aufraeumen();
    const t = $('tafel'), vb = $('vollbild'), m = $('modal');
    if (m && !m.hidden) return null;
    const liste = Array.from(player).filter((p) => p.video && typeof p.video.play === 'function' && p.el.isConnected);
    if (t && !t.hidden) return liste.find((p) => t.contains(p.el)) || null;
    if (vb && !vb.hidden) return liste.find((p) => !t || !t.contains(p.el)) || null;
    return null;
  }
  function taste(e) {
    if (e.key !== ' ' || e.metaKey || e.ctrlKey || e.altKey) return;
    const a = tiefesAktives();
    if (istEingabe(a) || istBedienelement(a)) return;   // Textfelder behalten die Leertaste, Knöpfe lösen selbst aus
    const p = aktiverPlayer();
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();
    if (!e.repeat) umschalten(p);
  }

  /* ---------- Einrichten ---------- */
  function einrichten(hilfen) {
    h = hilfen;
    if (eingerichtet) return;
    eingerichtet = true;
    window.addEventListener('keydown', taste, true);
    document.addEventListener('flyer:vollbild', () => { aufraeumen(); knopfZeigen(); });
    document.addEventListener('flyer:modus', () => leisteZeigen());
    document.addEventListener('flyer:aktualisiert', () => aufraeumen());
    document.addEventListener('flyer:struktur', () => { knopfZeigen(); vorladen(); });
    document.addEventListener('flyer:kategorie', () => vorladen());
    document.addEventListener('flyer:medien', () => vorladen());
    const t = $('tafel');
    if (t && typeof MutationObserver === 'function') new MutationObserver(() => aufraeumen()).observe(t, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    setInterval(aufraeumen, 5000);
    const wahl = $('vbMediumWahl');
    if (wahl) wahl.addEventListener('change', () => { setzeWerte({ medium: wahl.value }); });
    const schalter = [['vbMediumTonAus', 'tonAus'], ['vbMediumSchleife', 'schleife'], ['vbMediumAutostart', 'autostart']];
    for (const [id, k] of schalter) {
      const cb = $(id);
      if (cb) cb.addEventListener('change', () => { const w = {}; w[k] = cb.checked; setzeWerte(w); });
    }
    const r = $('vbMediumStart');
    if (r) r.addEventListener('input', () => { $('vbMediumStartZeit').textContent = M().dauerText(Number(r.value)) + ' (' + String(Number(r.value).toFixed(1)).replace('.', ',') + ' s)'; });
    const ok = $('vbMediumStartOk');
    if (ok) ok.addEventListener('click', () => { startbildSetzen(); });
    vorladen();
  }

  window.AetherFlyerPlayer = Object.freeze({
    einrichten: einrichten,
    anpassen: anpassen,
    player: neuerPlayer,
    abspielen: abspielen,
    vorladen: vorladen,
    startbildSetzen: startbildSetzen,
    aufraeumen: aufraeumen,
    anzahl: () => { aufraeumen(); return player.size; },
    TEMPI: TEMPI,
    TIPP_PX: TIPP_PX
  });
})();
