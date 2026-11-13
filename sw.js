// Service Worker des Aether-Dashboards: hält nur die App-Hülle (diese Seite, Manifest, Icons,
// engine-map.json, Screen-Editor, Logo-Seite, gemeinsam.js, Schriften des Logo-Editors) für den Offline-Start vor. Build-Dateien verwaltet die Seite selbst im Cache "aether-builds-v1".
// Anfragen an api.github.com (mit Token im Authorization-Header) werden hier nie angefasst,
// also auch nie in einem Cache abgelegt.
'use strict';

var SHELL_CACHE = 'aether-shell-v1';
// Ein geändertes sw.js wird neu installiert und legt dabei alle Einträge (auch neue) in denselben
// Hüllen-Cache; der Name muss dafür nicht hochgezählt werden.
// Der Screen-Editor (screen-editor.html mit three.js aus vendor/) gehört dazu, damit er offline startet, ebenso
// die Logo-Seite (logo.html; ihre API-Antworten und das Token kommen nie hierher, siehe unten) und gemeinsam.js
// (Hilfsfunktionen dieser drei Seiten; ohne sie starten sie offline nicht).
// Schriften des Logo-Editors (logo.html, fonts/<name>/, Lizenzen in fonts/<name>/OFL.txt): alle Stärken und Stile,
// damit der Editor offline jede Schrift zeichnen kann (zusammen ca. 1,4 MB). Nur vom eigenen Ursprung.
var SCHRIFT_DATEIEN = [
  // jost
  'fonts/jost/jost-latin-100-italic.woff', 'fonts/jost/jost-latin-100-normal.woff', 'fonts/jost/jost-latin-200-italic.woff', 'fonts/jost/jost-latin-200-normal.woff', 'fonts/jost/jost-latin-300-italic.woff', 'fonts/jost/jost-latin-300-normal.woff', 'fonts/jost/jost-latin-400-italic.woff', 'fonts/jost/jost-latin-400-normal.woff', 'fonts/jost/jost-latin-500-italic.woff', 'fonts/jost/jost-latin-500-normal.woff', 'fonts/jost/jost-latin-600-italic.woff', 'fonts/jost/jost-latin-600-normal.woff', 'fonts/jost/jost-latin-700-italic.woff', 'fonts/jost/jost-latin-700-normal.woff', 'fonts/jost/jost-latin-800-italic.woff', 'fonts/jost/jost-latin-800-normal.woff', 'fonts/jost/jost-latin-900-italic.woff', 'fonts/jost/jost-latin-900-normal.woff',
  // exo-2
  'fonts/exo-2/exo-2-latin-100-italic.woff', 'fonts/exo-2/exo-2-latin-100-normal.woff', 'fonts/exo-2/exo-2-latin-200-italic.woff', 'fonts/exo-2/exo-2-latin-200-normal.woff', 'fonts/exo-2/exo-2-latin-300-italic.woff', 'fonts/exo-2/exo-2-latin-300-normal.woff', 'fonts/exo-2/exo-2-latin-400-italic.woff', 'fonts/exo-2/exo-2-latin-400-normal.woff', 'fonts/exo-2/exo-2-latin-500-italic.woff', 'fonts/exo-2/exo-2-latin-500-normal.woff', 'fonts/exo-2/exo-2-latin-600-italic.woff', 'fonts/exo-2/exo-2-latin-600-normal.woff', 'fonts/exo-2/exo-2-latin-700-italic.woff', 'fonts/exo-2/exo-2-latin-700-normal.woff', 'fonts/exo-2/exo-2-latin-800-italic.woff', 'fonts/exo-2/exo-2-latin-800-normal.woff', 'fonts/exo-2/exo-2-latin-900-italic.woff', 'fonts/exo-2/exo-2-latin-900-normal.woff',
  // orbitron
  'fonts/orbitron/Orbitron-Black.ttf', 'fonts/orbitron/Orbitron-Bold.ttf', 'fonts/orbitron/Orbitron-ExtraBold.ttf', 'fonts/orbitron/Orbitron-Medium.ttf', 'fonts/orbitron/Orbitron-Regular.ttf', 'fonts/orbitron/Orbitron-SemiBold.ttf',
  // rajdhani
  'fonts/rajdhani/rajdhani-latin-300-normal.woff', 'fonts/rajdhani/rajdhani-latin-400-normal.woff', 'fonts/rajdhani/rajdhani-latin-500-normal.woff', 'fonts/rajdhani/rajdhani-latin-600-normal.woff', 'fonts/rajdhani/rajdhani-latin-700-normal.woff',
  // saira
  'fonts/saira/saira-latin-100-italic.woff', 'fonts/saira/saira-latin-100-normal.woff', 'fonts/saira/saira-latin-200-italic.woff', 'fonts/saira/saira-latin-200-normal.woff', 'fonts/saira/saira-latin-300-italic.woff', 'fonts/saira/saira-latin-300-normal.woff', 'fonts/saira/saira-latin-400-italic.woff', 'fonts/saira/saira-latin-400-normal.woff', 'fonts/saira/saira-latin-500-italic.woff', 'fonts/saira/saira-latin-500-normal.woff', 'fonts/saira/saira-latin-600-italic.woff', 'fonts/saira/saira-latin-600-normal.woff', 'fonts/saira/saira-latin-700-italic.woff', 'fonts/saira/saira-latin-700-normal.woff', 'fonts/saira/saira-latin-800-italic.woff', 'fonts/saira/saira-latin-800-normal.woff', 'fonts/saira/saira-latin-900-italic.woff', 'fonts/saira/saira-latin-900-normal.woff',
  // space-grotesk
  'fonts/space-grotesk/space-grotesk-latin-300-normal.woff', 'fonts/space-grotesk/space-grotesk-latin-400-normal.woff', 'fonts/space-grotesk/space-grotesk-latin-500-normal.woff', 'fonts/space-grotesk/space-grotesk-latin-600-normal.woff', 'fonts/space-grotesk/space-grotesk-latin-700-normal.woff',
  // michroma
  'fonts/michroma/michroma-latin-400-normal.woff',
  // audiowide
  'fonts/audiowide/Audiowide-Regular.ttf'
];
var SHELL = ['./', 'index.html', 'manifest.json', 'engine-map.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'screen-editor.html', 'vendor/three-r128.min.js', 'logo.html', 'gemeinsam.js'].concat(SCHRIFT_DATEIEN);

function shellKey(url) {
  // Ohne Query und Hash, damit "…/?x#projekt" denselben Eintrag trifft wie "…/".
  var u = new URL(url);
  return u.origin + u.pathname;
}

var shellUrls = SHELL.map(function (p) { return shellKey(new URL(p, self.location.href).href); });

self.addEventListener('install', function (ev) {
  ev.waitUntil(caches.open(SHELL_CACHE).then(function (cache) {
    return Promise.all(SHELL.map(function (p) {
      return fetch(p, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status + ' für ' + p);
        return cache.put(shellKey(new URL(p, self.location.href).href), res);
      });
    }));
  }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (ev) {
  ev.waitUntil(caches.keys().then(function (names) {
    return Promise.all(names.filter(function (n) { return n.indexOf('aether-shell-') === 0 && n !== SHELL_CACHE; })
      .map(function (n) { return caches.delete(n); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (ev) {
  var req = ev.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  // Fremde Ursprünge (api.github.com) gehen unverändert ins Netz, ohne diesen Worker.
  if (url.origin !== self.location.origin) return;
  var key = shellKey(req.url);
  var isShell = req.mode === 'navigate' || shellUrls.indexOf(key) >= 0;
  if (!isShell) return;
  // Netz zuerst (immer die aktuelle Seite, solange es Verbindung gibt), sonst Cache.
  ev.respondWith(fetch(key, { cache: 'no-cache', credentials: 'same-origin' }).then(function (res) {
    if (res.ok) {
      var copy = res.clone();
      caches.open(SHELL_CACHE).then(function (cache) { return cache.put(key, copy); }).catch(function () { /* Speicher voll o. ä. */ });
    }
    return res;
  }).catch(function () {
    return caches.match(key).then(function (hit) {
      if (hit) return hit;
      if (req.mode === 'navigate') return caches.match(shellUrls[0]);
      return Response.error();
    });
  }));
});
