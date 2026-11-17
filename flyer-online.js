// Online-Prüfung der Flyer-Seite (flyer.html, Teil B): schaut nach, ob im Repo konstantin9ezm/aether (Zweig „main“)
// unter docs/flyer/aether-flyer-paket.json eine andere Fassung des Flyer-Pakets liegt, lädt sie (ohne lokales Paket)
// sofort oder bietet sie im Banner an. Ablauf: Ordnerliste (contents-API) → sha vergleichen → nur wenn nötig die
// Datei laden (raw) → Format prüfen (AetherFlyerPaket.lies) → laden, anbieten oder „Aktuell …“ melden.
// „Laden“ im Banner übernimmt genau die angebotene Fassung: liegt sie nicht schon im Speicher, wird sie über ihren sha
// geladen (git/blobs, unveränderlich – nicht „was jetzt gerade online liegt“). Vor dem Übernehmen wird noch einmal mit
// dem gespeicherten Paket verglichen (es kann inzwischen importiert worden sein): Ist die Online-Fassung jetzt älter,
// zeigt das Banner „Online liegt eine ältere Version …“ mit „Trotzdem laden“, statt sie zu übernehmen. Nach einem
// Import (nachImport) gelten Banner und Hinweis nicht mehr; es wird neu geprüft.
// Nur lesende GET-Anfragen an api.github.com, jede mit Zeitlimit (withProjTimeout, 15 s; danach auch abgebrochen),
// nie zwei Prüfungen gleichzeitig. Geprüft wird beim Öffnen, per „Online prüfen“, beim online-Ereignis und alle
// 10 Minuten, solange die Seite offen ist.
// Token: kommt nur über h.token() von flyer.js herein, geht nur als Authorization-Header an api.github.com
// (githubApi in gemeinsam.js) und wird hier nirgends abgelegt, in keine Adresse geschrieben und nie protokolliert.
// Gespeichert wird nur über flyer.js (uebernehme, merkeOnline): das Paket bzw. { sha, version, stand } – nie das Token.
(function () {
  'use strict';

  const QUELLE = Object.freeze({ repo: 'konstantin9ezm/aether', ref: 'main', ordner: 'docs/flyer', datei: 'aether-flyer-paket.json' });
  // Selbst gewählt: alle 10 Minuten nachsehen (Tests setzen window.AETHER_TEST_FLYER_INTERVALL_MS vor dem Laden).
  const INTERVALL_MS = 10 * 60 * 1000;
  // Obergrenzen für die Arbeiten im Browser-Speicher (über flyer.js), damit „Prüfe online …“ nie stehen bleibt.
  // Bewusst unabhängig vom (in Tests kurzen) Zeitlimit der Anfragen; Übernehmen stellt zusätzlich alles neu dar.
  const LOKAL_FRIST_MS = 20 * 1000;
  const UEBERNEHMEN_FRIST_MS = 60 * 1000;
  const RAW = 'application/vnd.github.raw+json';
  const TEXT = Object.freeze({
    pruefe: 'Prüfe online …',
    lade: 'Lade online …',
    ohneToken: 'Ohne Token keine Online-Prüfung – gezeigt wird der gespeicherte Stand.',
    offline: 'Offline – gezeigt wird der gespeicherte Stand.',
    keine: 'Noch keine Online-Version.',
    kaputt: 'Online-Datei ist kein gültiges Flyer-Paket.'
  });

  const QUELLE_PFAD = '/repos/' + QUELLE.repo;
  let h = null;        // Hilfen von flyer.js (siehe einrichten)
  let gh = null;       // { api, contentsPath } aus gemeinsam.js
  let laeuft = null;   // Promise der laufenden Prüfung bzw. des laufenden Ladens (nie zwei gleichzeitig)
  let angebot = null;  // im Banner angebotene Online-Fassung: { paket|null, sha, version, stand }

  const $ = (id) => document.getElementById(id);
  const G = () => window.AetherGemeinsam;
  const P = () => window.AetherFlyerPaket;

  /* ---------- Anzeige ---------- */
  function hinweis(text) { const el = $('onlineHinweis'); if (el) el.textContent = text || ''; }
  function aktuellText(version) { return 'Aktuell (Version ' + version + ') · geprüft ' + G().fmtTime(new Date()) + ' Uhr'; }
  function beschaeftigt(an) {
    const b = $('btnOnline'); if (b) b.disabled = an;
    const l = $('bannerLaden'); if (l) l.disabled = an;
  }
  function bannerWeg() { angebot = null; const b = $('banner'); if (b) b.hidden = true; }
  function meldung(t) { try { G().meldung(t); } catch (e) { /* ohne #toast nur der Hinweis */ } }
  function fehlerWeg() { try { h.fehlerWeg(); } catch (e) { /* Seite läuft weiter */ } }
  // Erfolgreiche Prüfung: Banner weg, kleiner Hinweis, Fehlerbox weg.
  function fertig(text) { bannerWeg(); hinweis(text); fehlerWeg(); }
  // Online-Fassung im Banner anbieten; „Laden“ übernimmt sie (lädt sie vorher, wenn nur die Version bekannt ist).
  // a.neuer merkt sich, ob der Knopf „Laden“ (neuer/gleich) oder „Trotzdem laden“ (älter) heißt.
  function anbieten(a, lokalesPaket) {
    const neuer = P().vergleicheVersion(a.version, lokalesPaket.version) >= 0;
    a.neuer = neuer;
    angebot = a;
    $('bannerText').textContent = neuer
      ? 'Neue Version online: ' + a.version + (a.stand ? ' (Stand ' + P().datum(a.stand) + ')' : '')
      : 'Online liegt eine ältere Version (' + a.version + ')';
    $('bannerLaden').textContent = neuer ? 'Laden' : 'Trotzdem laden';
    $('banner').hidden = false;
    hinweis('');
    fehlerWeg();
  }

  /* ---------- Hilfen von flyer.js (mit Obergrenze, damit nichts hängen bleibt) ---------- */
  function mitFrist(arbeit, ms) {
    let t;
    const zeit = new Promise((_, nein) => {
      t = setTimeout(() => nein(new (G().AppError)('speicher', 'Der Browser-Speicher antwortet nicht.', 'Bitte die Seite neu laden.')), ms);
    });
    return Promise.race([Promise.resolve().then(arbeit), zeit]).finally(() => clearTimeout(t));
  }
  function tokenLesen() {
    try { const t = h.token(); return typeof t === 'string' && t ? t : null; } catch (e) { return null; }
  }
  async function lokalLesen() {
    const l = await mitFrist(() => h.lokal(), LOKAL_FRIST_MS);
    return { paket: (l && l.paket) || null, basisSha: (l && l.basisSha) || null, online: (l && l.online) || null };
  }
  // nurWennLeer: nur übernehmen, wenn (in der Reihe der Übernahmen von flyer.js) noch kein Paket da ist – sonst
  // 'schonDa' (z. B. während des ersten Downloads importiert: das Import-Paket wird nicht ungefragt ersetzt).
  function uebernehmen(paket, sha, nurWennLeer) {
    return mitFrist(() => h.uebernehme(paket, { quelle: 'online', sha: sha || null, nurWennLeer: nurWennLeer === true }), UEBERNEHMEN_FRIST_MS);
  }
  function gleich(a, b) { try { return JSON.stringify(a) === JSON.stringify(b); } catch (e) { return false; } }

  /* ---------- GitHub ---------- */
  // Eine GET-Anfrage samt Lesen der Antwort mit Zeitlimit; nach Ablauf wird sie auch abgebrochen.
  // 404 → AppError „keineonline“ (kein Fehler, nur Hinweis „Noch keine Online-Version.“).
  function hole(pfad, token, alsJson, accept, notFound) {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    const keine = notFound || new (G().AppError)('keineonline', TEXT.keine, '');
    const p = gh.api(pfad, { token: token, accept: accept, signal: ctrl ? ctrl.signal : undefined, notFound: keine })
      .then((res) => alsJson ? res.json() : res.text());
    return G().withProjTimeout(p).catch((e) => { if (ctrl) ctrl.abort(); throw e; });
  }
  // Version aus einer (für diese Seite zu neuen) Paket-Datei, nur für den Hinweis.
  function versionAus(text) {
    try { const o = JSON.parse(text); return typeof o.version === 'string' && o.version ? o.version : '?'; } catch (e) { return '?'; }
  }
  // Git-sha (40 bzw. 64 Hex-Zeichen) – nur so geht er in eine Adresse.
  function istSha(sha) { return typeof sha === 'string' && /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i.test(sha); }
  // Paket-Datei laden und prüfen → { paket } oder { ergebnis } (zu neu/kaputt: schon gemeldet, nichts überschrieben).
  // perSha: genau die Fassung mit diesem sha laden (git/blobs, raw; 404 → AppError „blobweg“), sonst die Datei, die
  // gerade auf main liegt (contents, raw).
  async function ladeDatei(token, sha, perSha) {
    const text = perSha
      ? await hole(QUELLE_PFAD + '/git/blobs/' + encodeURIComponent(sha), token, false, RAW,
        new (G().AppError)('blobweg', 'Online-Fassung nicht mehr da.', ''))
      : await hole(gh.contentsPath(QUELLE.ordner + '/' + QUELLE.datei), token, false, RAW);
    let paket;
    try {
      paket = P().lies(text);
    } catch (e) {
      if (e && e.kind === 'zuneu') {
        fertig('Paket zu neu: Online-Version ' + versionAus(text) + ' braucht ein neueres Dashboard.');
        return { ergebnis: 'zuneu' };
      }
      bannerWeg(); hinweis('');
      const grund = e ? [e.title, e.text].filter(Boolean).join(' ') || String(e.message || e) : '';
      try { h.fehler(TEXT.kaputt, grund, false); } catch (x) { /* Seite läuft weiter */ }
      return { ergebnis: 'kaputt' };
    }
    // Nur eine Merkhilfe (spart beim nächsten Mal den Download): Fehler dabei ändern am Ergebnis nichts.
    try { await mitFrist(() => h.merkeOnline({ sha: sha, version: paket.version, stand: paket.stand }), LOKAL_FRIST_MS); } catch (e) { /* egal */ }
    return { paket: paket };
  }

  /* ---------- Ablauf ---------- */
  // Fehler einer Prüfung: Netz/Zeitlimit wie offline (kleiner Hinweis), sonst Fehlerbox; die Seite zeigt weiter den
  // gespeicherten Stand. Das Banner bleibt dabei, wie es war.
  function fehlerBehandeln(e) {
    const f = e instanceof G().AppError ? e : new (G().AppError)('unknown', 'Unerwarteter Fehler.', String((e && e.message) || e));
    if (f.kind === 'keineonline') { fertig(TEXT.keine); return 'keine'; }
    if (f.kind === 'network' || f.kind === 'timeout') { hinweis(TEXT.offline); return 'offline'; }
    if (f.kind === 'notoken') { hinweis(TEXT.ohneToken); return 'ohnetoken'; }
    hinweis('');
    try { h.fehler(f.title, f.text, f.kind === 'auth' || f.kind === 'forbidden'); } catch (x) { /* Seite läuft weiter */ }
    return 'fehler';
  }
  // Führt arbeit() aus, solange nichts anderes läuft; sonst bekommt der Aufrufer die laufende Arbeit zurück.
  // Endet immer (jeder Schritt hat ein Zeitlimit) und räumt „Prüfe online …“ und die gesperrten Knöpfe wieder auf.
  function exklusiv(text, arbeit) {
    if (laeuft) return laeuft;
    beschaeftigt(true);
    hinweis(text);
    laeuft = (async () => {
      try { return await arbeit(); }
      catch (e) { return fehlerBehandeln(e); }
      finally {
        laeuft = null;
        beschaeftigt(false);
        const el = $('onlineHinweis');
        if (el && el.textContent === text) el.textContent = '';
      }
    })();
    return laeuft;
  }

  async function pruefen() {
    // 1. Ohne Token oder ohne Netz: nur ein kleiner Hinweis, kein Fehler.
    const token = tokenLesen();
    if (!token) { hinweis(TEXT.ohneToken); return 'ohnetoken'; }
    if (navigator.onLine === false) { hinweis(TEXT.offline); return 'offline'; }
    // 2. Ordnerliste
    const liste = await hole(gh.contentsPath(QUELLE.ordner), token, true);
    const dateien = (Array.isArray(liste) ? liste : []).filter((e) => e && e.type === 'file' && typeof e.name === 'string');
    const eintrag = dateien.find((e) => e.name === QUELLE.datei);
    if (!eintrag) {
      const andere = dateien.map((e) => e.name).filter((n) => /\.json$/i.test(n));
      if (!andere.length) { fertig(TEXT.keine); return 'keine'; }
      fertig('In ' + QUELLE.ordner + ' liegt keine Datei mit genau dem Namen ' + QUELLE.datei + ' (gefunden: ' + andere.join(', ') + ')');
      return 'falschername';
    }
    const sha = typeof eintrag.sha === 'string' ? eintrag.sha : '';
    // 3. Gleiche Datei wie das gespeicherte Paket → nichts laden.
    let lokal = await lokalLesen();
    if (lokal.paket && sha && sha === lokal.basisSha) { fertig(aktuellText(lokal.paket.version)); return 'aktuell'; }
    // Schon einmal gesehen und die Version ist bekannt → Entscheidung ohne Download („Laden“ lädt dann über den sha;
    // liegt die Datei vom letzten Angebot noch im Speicher, wird sie verwendet). Nicht bei einem importierten Paket mit
    // derselben Version: Das kann genau diese Datei sein – dann laden und den Inhalt vergleichen (unten).
    const on = lokal.online;
    if (lokal.paket && sha && on && on.sha === sha && typeof on.version === 'string' && on.version &&
        (lokal.basisSha || on.version !== lokal.paket.version)) {
      const schonDa = angebot && angebot.sha === sha ? angebot.paket : null;
      anbieten({ paket: schonDa, sha: sha, version: on.version, stand: typeof on.stand === 'string' ? on.stand : '' }, lokal.paket);
      return 'angebot';
    }
    const r = await ladeDatei(token, sha);
    if (!r.paket) return r.ergebnis;
    const paket = r.paket;
    // 4. Neu lesen: falls während des Downloads ein Paket importiert wurde, wird es nicht ungefragt ersetzt (auch
    // nicht, wenn der Import noch in der Reihe der Übernahmen steht: nurWennLeer).
    lokal = await lokalLesen();
    if (!lokal.paket) {
      const uebernommen = await uebernehmen(paket, sha, true);
      if (uebernommen !== 'schonDa') {
        meldung('Paket geladen (Version ' + paket.version + ')');
        fertig(aktuellText(paket.version));
        return 'geladen';
      }
      lokal = await lokalLesen();
      if (!lokal.paket) { fertig(''); return 'fehler'; }
    }
    if (gleich(paket, lokal.paket)) {
      // Gleicher Inhalt (z. B. vorher importiert): sha als Basis merken, damit die nächste Prüfung nichts lädt.
      if (lokal.basisSha !== sha) await uebernehmen(paket, sha);
      fertig(aktuellText(lokal.paket.version));
      return 'aktuell';
    }
    anbieten({ paket: paket, sha: sha, version: paket.version, stand: paket.stand }, lokal.paket);
    return 'angebot';
  }

  // „Laden“ bzw. „Trotzdem laden“ im Banner: angebotene Fassung übernehmen (ersetzt das gespeicherte Paket).
  async function laden() {
    const a = angebot;
    if (!a) return 'aus';
    let paket = a.paket;
    if (!paket) {
      const token = tokenLesen();
      if (!token) { hinweis(TEXT.ohneToken); return 'ohnetoken'; }
      if (navigator.onLine === false) { hinweis(TEXT.offline); return 'offline'; }
      // Genau die angebotene Fassung (über ihren sha); ohne gültigen sha oder wenn es sie nicht mehr gibt: neu prüfen.
      if (!istSha(a.sha)) return pruefen();
      let r;
      try { r = await ladeDatei(token, a.sha, true); } catch (e) {
        if (e && e.kind === 'blobweg') return pruefen();
        throw e;
      }
      if (!r.paket) return r.ergebnis;
      paket = r.paket;
      // Gemerkte Version passte nicht zu dieser Datei: mit der echten Version neu anbieten, nicht ungefragt übernehmen.
      if (paket.version !== a.version) {
        const l = await lokalLesen();
        if (!l.paket) return pruefen();
        anbieten({ paket: paket, sha: a.sha, version: paket.version, stand: paket.stand }, l.paket);
        return 'angebot';
      }
    }
    // Vor dem Übernehmen noch einmal vergleichen: inzwischen importiert?
    const lokal = await lokalLesen();
    if (lokal.paket) {
      if (gleich(paket, lokal.paket)) {
        if (lokal.basisSha !== a.sha) await uebernehmen(paket, a.sha);
        fertig(aktuellText(lokal.paket.version));
        return 'aktuell';
      }
      // Das Banner hieß „Laden“ (neuer), jetzt ist die Online-Fassung älter: nur über „Trotzdem laden“.
      if (a.neuer !== false && P().vergleicheVersion(paket.version, lokal.paket.version) < 0) {
        anbieten({ paket: paket, sha: a.sha, version: paket.version, stand: paket.stand }, lokal.paket);
        return 'angebot';
      }
    }
    await uebernehmen(paket, a.sha);
    meldung('Paket geladen (Version ' + paket.version + ')');
    fertig(aktuellText(paket.version));
    return 'geladen';
  }

  /* ---------- Schnittstelle ---------- */
  // Eine Prüfung starten (läuft schon eine, kommt deren Promise zurück). Lehnt nie ab; Ergebnis ist ein kurzes Wort
  // ('aktuell', 'angebot', 'geladen', 'keine', 'falschername', 'zuneu', 'kaputt', 'ohnetoken', 'offline', 'fehler').
  function pruefe() {
    if (!h || !gh) return Promise.resolve('aus');
    return exklusiv(TEXT.pruefe, pruefen);
  }

  // Nach einem Import (flyer.js): Banner und „Aktuell …“ gehörten zum vorigen Paket – weg damit und neu prüfen (läuft
  // gerade eine Prüfung oder ein Laden, danach; deren Ergebnis beruhte womöglich noch auf dem vorigen Paket).
  function nachImport() {
    if (!h || !gh) return Promise.resolve('aus');
    bannerWeg();
    if (!laeuft) hinweis('');
    const neu = () => pruefe();
    return laeuft ? laeuft.then(neu, neu) : neu();
  }

  // h = { token(), lokal(), uebernehme(paket, {quelle, sha, nurWennLeer}), merkeOnline({sha, version, stand}), fehler(titel, text,
  // mitTokenLink), fehlerWeg() } von flyer.js. Zeigt „Online prüfen“ und startet die erste Prüfung (gibt ihr Promise zurück).
  function einrichten(hilfen) {
    const erstesMal = !h;
    h = hilfen;
    if (!erstesMal) return pruefe();
    gh = G().githubApi({
      apiBase: 'https://api.github.com', repoFull: QUELLE.repo, repoPath: '/repos/' + QUELLE.repo, ref: QUELLE.ref,
      tokenOrt: 'im Dashboard', ohneTokenArt: 'notoken'
    });
    const btn = $('btnOnline');
    if (btn) { btn.hidden = false; btn.addEventListener('click', () => { pruefe(); }); }
    const l = $('bannerLaden');
    if (l) l.addEventListener('click', () => { if (angebot) exklusiv(TEXT.lade, laden); });
    window.addEventListener('online', () => { pruefe(); });
    const t = window.AETHER_TEST_FLYER_INTERVALL_MS;
    setInterval(() => { pruefe(); }, (typeof t === 'number' && t > 0) ? t : INTERVALL_MS);
    return pruefe();
  }

  window.AetherFlyerOnline = Object.freeze({ einrichten: einrichten, pruefe: pruefe, nachImport: nachImport, QUELLE: QUELLE });
})();
