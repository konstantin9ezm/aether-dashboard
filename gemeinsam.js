// Gemeinsame Hilfsfunktionen für index.html (Projektansicht), screen-editor.html und logo.html.
// Hier steht jede Funktion genau einmal; die Seiten binden die Datei per <script src="gemeinsam.js"> ein.
// Regeln: keine Seiten-Texte außer den gemeinsamen Fehlermeldungen, keine Konfiguration einer Seite
// (die kommt per Parameter), KEIN Speicher: kein localStorage, kein Cache, kein Token-Lesen oder -Schreiben.
// Das Token reicht die aufrufende Seite pro Anfrage herein; es wird hier nirgends abgelegt.
// Nicht für das Spiel-iframe (wird dort nie geladen) und nicht für webgpu-check.html (bewusst eigenständig).
(function () {
  'use strict';

  // ---------------------------------------------------------------------------
  // Fehler
  // ---------------------------------------------------------------------------
  function AppError(kind, title, text) {
    this.kind = kind;
    this.title = title;
    this.text = text || '';
    this.message = title;
  }
  AppError.prototype = Object.create(Error.prototype);

  function fmtTime(d) {
    return d.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  }

  function shortSha(sha) { return /^[0-9a-f]{7,40}$/i.test(String(sha || '')) ? String(sha).slice(0, 7).toLowerCase() : ''; }

  function needTokenError(repoFull) {
    return new AppError('notoken', 'Kein Token gespeichert.', 'Für die Projektübersicht braucht das Dashboard ein GitHub-Token mit Lesezugriff auf ' + repoFull + '.');
  }

  // ---------------------------------------------------------------------------
  // Zeitlimit je Anfrage (Projektansicht und Logo-Seite)
  // ---------------------------------------------------------------------------
  // Selbst gewählt: 15 s. Danach gilt GitHub als nicht erreichbar, statt dass eine Karte dauerhaft „Lade …“
  // zeigt (z. B. Flugmodus, ohne dass der Browser „offline“ meldet).
  var PROJECT_TIMEOUT_MS = 15 * 1000;
  // Nur für die E2E-Tests: kürzeres Zeitlimit, gesetzt bevor dieses Skript läuft.
  var projTimeoutMs = (typeof window.AETHER_TEST_PROJECT_TIMEOUT_MS === 'number' && window.AETHER_TEST_PROJECT_TIMEOUT_MS > 0)
    ? window.AETHER_TEST_PROJECT_TIMEOUT_MS : PROJECT_TIMEOUT_MS;

  function projTimeoutError() {
    return new AppError('timeout', 'GitHub antwortet nicht.', 'Prüfe die Internetverbindung und versuche es erneut.');
  }
  // Höchstens projTimeoutMs auf p warten, sonst mit Zeitlimit-Fehler abbrechen.
  function withProjTimeout(p) {
    var timer;
    return Promise.race([p, new Promise(function (resolve, reject) {
      timer = setTimeout(function () { reject(projTimeoutError()); }, projTimeoutMs);
    })]).finally(function () { clearTimeout(timer); });
  }

  // ---------------------------------------------------------------------------
  // GitHub-API
  // ---------------------------------------------------------------------------
  // cfg (von der Seite, nichts davon wird hier gespeichert außer der Konfiguration selbst):
  //   apiBase       'https://api.github.com'
  //   repoFull      'besitzer/repo' (für Fehlertexte)
  //   repoPath      '/repos/besitzer/repo'
  //   ref           Zweig für contentsPath
  //   tokenOrt      Ende des 401-Textes: „… und gib es <tokenOrt> ein.“
  //   ohneTokenArt  kind des Fehlers, wenn kein Token übergeben wurde
  //   standardToken optional: function () → Token der Seite, wenn opts.token fehlt
  //   beiAntwort    optional: function (res) – wird bei jeder Antwort vor der Fehlerprüfung aufgerufen
  function githubApi(cfg) {
    async function errorFromResponse(res, ctx) {
      var status = res.status;
      var remaining = res.headers.get('x-ratelimit-remaining');
      var reset = res.headers.get('x-ratelimit-reset');
      var retryAfter = res.headers.get('retry-after');
      var bodyMsg = '';
      try { var j = await res.clone().json(); bodyMsg = String((j && j.message) || ''); } catch (e) { /* kein JSON */ }

      if (status === 401) {
        return new AppError('auth', 'GitHub lehnt das Token ab.',
          'Das Token ist falsch, abgelaufen oder wurde widerrufen. Erzeuge auf GitHub ein neues Token und gib es ' + cfg.tokenOrt + ' ein.');
      }
      if ((status === 403 || status === 429) && (remaining === '0' || retryAfter || /rate limit/i.test(bodyMsg))) {
        var when = '';
        if (reset && /^\d+$/.test(reset)) {
          var d = new Date(Number(reset) * 1000);
          var mins = Math.max(1, Math.ceil((d.getTime() - Date.now()) / 60000));
          when = ' Wieder möglich ab ' + fmtTime(d) + ' Uhr (in ca. ' + mins + ' Min.).';
        } else if (retryAfter && /^\d+$/.test(retryAfter)) {
          when = ' Bitte ca. ' + Math.max(1, Math.ceil(Number(retryAfter) / 60)) + ' Min. warten.';
        }
        return new AppError('ratelimit', 'GitHub-Rate-Limit erreicht.',
          'Es wurden zu viele Anfragen an die GitHub-API geschickt.' + when);
      }
      if (status === 403) {
        return new AppError('forbidden', 'Das Token hat keinen Zugriff.',
          'Das Token braucht für ' + cfg.repoFull + ' die Berechtigung „' + ((ctx && ctx.perm) || 'Contents: Read-only') + '“. ' +
          'Falls das Repo einer Organisation gehört, muss diese Fine-grained Tokens erlauben.');
      }
      if (status === 404 && ctx && ctx.notFound) {
        return typeof ctx.notFound === 'function' ? await ctx.notFound() : ctx.notFound;
      }
      if (status === 404) {
        return new AppError('notfound', 'Nicht gefunden.', 'GitHub meldet 404 für eine benötigte Datei.');
      }
      if (status >= 500) {
        return new AppError('server', 'GitHub hat gerade Probleme (HTTP ' + status + ').', 'Versuche es in ein paar Minuten noch einmal.');
      }
      return new AppError('http', 'Unerwartete Antwort von GitHub (HTTP ' + status + ').', bodyMsg);
    }

    async function api(path, opts) {
      opts = opts || {};
      var useToken = opts.token || (cfg.standardToken ? cfg.standardToken() : null);
      if (!useToken) throw new AppError(cfg.ohneTokenArt, 'Kein Token gespeichert.', 'Bitte zuerst ein Token eingeben.');
      var res;
      try {
        res = await fetch(cfg.apiBase + path, {
          method: 'GET',
          headers: {
            'Accept': opts.accept || 'application/vnd.github+json',
            'Authorization': 'Bearer ' + useToken
          },
          cache: 'no-store',
          credentials: 'omit',
          referrerPolicy: 'no-referrer',
          signal: opts.signal
        });
      } catch (e) {
        if (e && e.name === 'AbortError') throw e;
        throw new AppError('network', 'Keine Verbindung zu GitHub.', 'Prüfe die Internetverbindung und versuche es erneut.');
      }
      if (cfg.beiAntwort) cfg.beiAntwort(res);
      if (!res.ok) throw await errorFromResponse(res, opts);
      return res;
    }

    function contentsPath(p) {
      var clean = String(p).replace(/^\/+|\/+$/g, '');
      return cfg.repoPath + '/contents/' + clean.split('/').map(encodeURIComponent).join('/') + '?ref=' + encodeURIComponent(cfg.ref);
    }

    return Object.freeze({ errorFromResponse: errorFromResponse, api: api, contentsPath: contentsPath });
  }

  // ---------------------------------------------------------------------------
  // Sichern (Screen-Editor „Als Bild sichern“, Logo „SVG/PNG sichern“)
  // ---------------------------------------------------------------------------
  // Nur echte Nutzergeste (Antippen/Klick) – sonst lehnt iOS navigator.share ab.
  function mitGeste(ev) {
    if (!ev || ev.isTrusted !== true) return false;
    return !(navigator.userActivation && navigator.userActivation.isActive === false);
  }
  // Kurze Meldung im Element #toast der Seite.
  var toastT = null;
  function meldung(t) {
    var el = document.getElementById('toast');
    el.textContent = t;
    el.classList.add('on');
    clearTimeout(toastT);
    toastT = setTimeout(function () { el.classList.remove('on'); }, t.length > 60 ? 5000 : 2600);
  }
  // Teilen-Dialog mit diesen Dateien möglich?
  function kannTeilen(files) {
    try { return typeof navigator.share === 'function' && typeof navigator.canShare === 'function' && navigator.canShare({ files: files }); } catch (e) { return false; }
  }
  // Download über einen Link möglich?
  function kannHerunterladen() { return 'download' in HTMLAnchorElement.prototype; }
  // Eine Datei über einen unsichtbaren Link herunterladen.
  function herunterladen(url, name) {
    var a = document.createElement('a'); a.href = url; a.download = name; a.hidden = true;
    document.body.appendChild(a); a.click(); a.remove();
  }

  window.AetherGemeinsam = Object.freeze({
    AppError: AppError,
    fmtTime: fmtTime,
    shortSha: shortSha,
    needTokenError: needTokenError,
    projTimeoutMs: projTimeoutMs,
    projTimeoutError: projTimeoutError,
    withProjTimeout: withProjTimeout,
    githubApi: githubApi,
    mitGeste: mitGeste,
    meldung: meldung,
    kannTeilen: kannTeilen,
    kannHerunterladen: kannHerunterladen,
    herunterladen: herunterladen
  });
})();
