// Online-Abgleich der Bibliothek (flyer.html, F3b Teil F): liest die Liste von konstantin9ezm/aether-medien/medien/
// (Zweig main, Contents-API) und lädt Inhalte per git/blobs nach – nur lesend, mit dem Token des Dashboards (nie
// gespeichert, nie in Adressen oder Meldungen). Läuft mit „Online prüfen“ (derselbe Knopf wie das Paket), beim Öffnen,
// beim online-Ereignis und alle 10 Minuten – nur, wenn die Bibliothek Dateien hat (sonst keine Anfrage).
// Anfragen: GET /repos/…/aether-medien/contents/medien?ref=main (Liste: Name, Git-Blob-SHA, Größe); antwortet sie 404,
// zusätzlich GET /repos/…/aether-medien (gibt es das Repo, fehlt nur der Ordner bzw. ist es leer → „noch nichts
// online“); GET /repos/…/aether-medien/git/blobs/<sha> mit Accept application/vnd.github.raw+json (roh, nicht als
// Base64 im JSON – große Videos liegen so nicht doppelt im Speicher). Zeitlimit: die Antwort wie alle Anfragen
// (withProjTimeout, 15 s), der Inhalt danach höchstens 15 s plus 2 s je MiB (selbst gewählt), danach abgebrochen.
// Kein Zugriff: GitHub antwortet für private Repos ohne Recht meist 404 statt 403 – 401, 403 und 404 gelten gleich.
// Dann eine einmalige Meldung („Kein Zugriff auf aether-medien – …“), danach keine automatischen Versuche mehr (kein
// Wiederholen beim Intervall oder online-Ereignis), bis „Online prüfen“ ausdrücklich gedrückt wird; alles andere läuft.
// Beim Prüfen werden nur fehlende Dateien bis 5 MiB nachgeladen, größere erst beim Öffnen bzw. Abspielen
// (AetherFlyerMedien.setzeLader). Jeder geladene Inhalt wird per Git-Blob-SHA geprüft und kommt in den Geräte-Speicher
// (danach offline verfügbar). Die Liste wird gespeichert (Status-Punkte auch offline).
(function () {
  'use strict';

  const QUELLE = Object.freeze({ repo: 'konstantin9ezm/aether-medien', ref: 'main', ordner: 'medien' });
  const RAW = 'application/vnd.github.raw+json';
  const INTERVALL_MS = 10 * 60 * 1000;
  const INHALT_FRIST_MS = 15 * 1000, JE_MIB_MS = 2000;
  const TEXT_KEIN = 'Kein Zugriff auf aether-medien – Repo anlegen bzw. den Token um das Repo erweitern';

  const G = () => window.AetherGemeinsam;
  const M = () => window.AetherFlyerMedien;
  const S = () => window.AetherFlyerSpeicher || null;
  const $ = (id) => document.getElementById(id);

  let h = null, gh = null;
  let laeuft = null;           // laufende Prüfung
  let keinZugriff = false;     // in dieser Sitzung: kein Zugriff → keine automatischen Versuche
  let gemeldet = false;        // Meldung „Kein Zugriff“ schon gezeigt
  const laden = new Map();     // sha → Promise<Blob|null>
  const anfragen = [];         // nur für Tests: Pfade der Anfragen (ohne Token)

  function meldung(t) { try { G().meldung(t); } catch (e) { /* egal */ } }
  function token() { try { const t = h && h.token(); return typeof t === 'string' && t ? t : null; } catch (e) { return null; } }
  function istSha(s) { return typeof s === 'string' && /^[0-9a-f]{40}$/.test(s); }
  function fehler(kind, t, x) { return new (G().AppError)(kind, t, x || ''); }
  // GET mit Zeitlimit für die Antwort; nach Ablauf abgebrochen
  function anfrage(pfad, accept, notFound, ctrl) {
    anfragen.push(pfad.replace(/\?.*$/, ''));
    const p = gh.api(pfad, { token: token(), accept: accept, signal: ctrl ? ctrl.signal : undefined, notFound: notFound });
    return G().withProjTimeout(p).catch((e) => { if (ctrl) ctrl.abort(); throw e; });
  }
  function istKeinZugriff(e) { return !!e && (e.kind === 'auth' || e.kind === 'forbidden' || e.kind === 'keinzugriff'); }

  /* ---------- Liste ---------- */
  async function liste() {
    const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
    try {
      const res = await anfrage(gh.contentsPath(QUELLE.ordner), undefined, fehler('ordnerfehlt', 'Ordner medien fehlt.'), ctrl);
      const j = await G().withProjTimeout(res.json());
      return (Array.isArray(j) ? j : []).filter((x) => x && x.type === 'file' && istSha(x.sha))
        .map((x) => ({ sha: x.sha, name: String(x.name || ''), groesse: typeof x.size === 'number' ? x.size : null }));
    } catch (e) {
      if (!e || e.kind !== 'ordnerfehlt') throw e;
      // 404: Repo da (nur der Ordner fehlt bzw. es ist leer) oder kein Zugriff?
      await anfrage('/repos/' + QUELLE.repo, undefined, fehler('keinzugriff', TEXT_KEIN + '.'), null);
      return [];
    }
  }

  /* ---------- Inhalt laden (git/blobs, roh) ---------- */
  function ladeInhalt(d) {
    if (!d || !istSha(d.gitSha)) return Promise.resolve(null);
    if (laden.has(d.gitSha)) return laden.get(d.gitSha);
    const p = (async () => {
      const st = M().onlineStand();
      if (!gh || !token() || navigator.onLine === false || keinZugriff || !st.shas || !st.shas.has(d.gitSha)) return null;
      const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
      let blob;
      try {
        const res = await anfrage('/repos/' + QUELLE.repo + '/git/blobs/' + d.gitSha, RAW, fehler('blobweg', 'Datei online nicht mehr da.'), ctrl);
        const frist = INHALT_FRIST_MS + Math.ceil((d.groesse || 0) / (1024 * 1024)) * JE_MIB_MS;
        let t;
        blob = await Promise.race([res.blob(), new Promise((_, nein) => { t = setTimeout(() => { if (ctrl) ctrl.abort(); nein(fehler('timeout', 'GitHub antwortet nicht.')); }, frist); })]).finally(() => clearTimeout(t));
      } catch (e) {
        if (istKeinZugriff(e)) zugriffFehlt();
        return null;
      }
      // Prüfsumme: nur genau die Datei des Pakets kommt in den Speicher
      const sha = await M().gitSha(blob);
      if (sha !== d.gitSha) return null;
      const typ = d.mime || blob.type;
      const inhalt = typ && blob.type !== typ ? new Blob([blob], { type: typ }) : blob;
      const s = S();
      if (s && await s.speichereMedienInhalt(d.id, { blob: inhalt, sha: sha, mime: d.mime })) {
        if (!(await s.ladeMedienBild(d.id, 'b'))) {
          const fmt = M().formatVon(d.datei, d.mime);
          if (fmt) {
            try {
              const kopf = fmt.endung === 'gif' || fmt.endung === 'png' || fmt.endung === 'webp' ? await M().stueckLesen(inhalt, 0, Math.min(inhalt.size, 64 * 1024 * 1024)) : null;
              const info = d.art === 'video' ? await M().videoBild(inhalt, typeof d.startbild === 'number' ? d.startbild : M().startZeit(d.dauer), d.mime) : await M().einlesen(inhalt, fmt, kopf);
              if (info.b || info.k) await s.speichereMedienBilder(d.id, { b: info.b || null, k: info.k || null });
            } catch (e) { /* ohne Bild */ }
          }
        }
        M().bildVergessen(d.id);
        M().inhaltDa(d.id, true);
      }
      return inhalt;
    })().finally(() => laden.delete(d.gitSha));
    laden.set(d.gitSha, p);
    return p;
  }

  /* ---------- Prüfen ---------- */
  function zugriffFehlt() {
    keinZugriff = true;
    M().setzeOnline(null, new Date().toISOString(), 'kein');
    const s = S();
    if (s) s.speichereMedienOnline({ zugriff: 'kein', liste: [] }).catch(() => {});
    if (!gemeldet) { gemeldet = true; meldung(TEXT_KEIN); }
  }
  async function pruefen(ausdruecklich) {
    if (!h || !gh) return 'aus';
    if (keinZugriff && !ausdruecklich) return 'kein-zugriff';   // keine Wiederholungsschleife
    // Ohne Dateien in der Bibliothek ist nichts abzugleichen: keine Anfrage (und keine Zugriffs-Meldung für ein Repo,
    // das es noch nicht geben muss)
    if (!M().dateien(h.paketV2()).length) return 'leer';
    if (!token()) return 'ohnetoken';
    if (navigator.onLine === false) return 'offline';
    let l;
    try { l = await liste(); } catch (e) {
      if (istKeinZugriff(e)) { zugriffFehlt(); return 'kein-zugriff'; }
      if (e && (e.kind === 'network' || e.kind === 'timeout' || e.name === 'AbortError')) return 'offline';
      return 'fehler';
    }
    keinZugriff = false;
    const jetzt = new Date().toISOString();
    M().setzeOnline(l.map((x) => x.sha), jetzt, 'ok');
    const s = S();
    if (s) await s.speichereMedienOnline({ zugriff: 'ok', liste: l, geprueft: jetzt });
    // Fehlende, im Paket genannte Dateien bis 5 MiB nachladen (größere erst beim Öffnen bzw. Abspielen)
    const shas = new Set(l.map((x) => x.sha));
    const pk = h.paketV2();
    for (const d of M().dateien(pk)) {
      if (!shas.has(d.gitSha) || M().hatInhalt(d.id) || d.groesse > M().AUTO_LADEN) continue;
      await ladeInhalt(d);
    }
    return 'aktuell';
  }
  function pruefe(opt) {
    const ausdruecklich = !!(opt && opt.ausdruecklich);
    if (laeuft) return laeuft;
    laeuft = pruefen(ausdruecklich).catch(() => 'fehler').finally(() => { laeuft = null; });
    return laeuft;
  }

  // h = Hilfen von flyer.js (token, paketV2 …)
  function einrichten(hilfen) {
    const erstes = !h;
    h = hilfen;
    if (!erstes) return pruefe();
    gh = G().githubApi({ apiBase: 'https://api.github.com', repoFull: QUELLE.repo, repoPath: '/repos/' + QUELLE.repo, ref: QUELLE.ref, tokenOrt: 'im Dashboard', ohneTokenArt: 'notoken' });
    M().setzeLader(ladeInhalt);
    const b = $('btnOnline');
    if (b) b.addEventListener('click', () => { pruefe({ ausdruecklich: true }); });
    window.addEventListener('online', () => { pruefe(); });
    const t = window.AETHER_TEST_FLYER_INTERVALL_MS;
    setInterval(() => { pruefe(); }, (typeof t === 'number' && t > 0) ? t : INTERVALL_MS);
    return M().geraetLaden().catch(() => {}).then(() => pruefe());
  }

  window.AetherFlyerMedienOnline = Object.freeze({
    QUELLE: QUELLE,
    TEXT_KEIN: TEXT_KEIN,
    einrichten: einrichten,
    pruefe: pruefe,
    ladeInhalt: ladeInhalt,
    keinZugriff: () => keinZugriff,
    anfragen: () => anfragen.slice()
  });
})();
