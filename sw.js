// Service Worker des Aether-Dashboards: hält nur die App-Hülle (diese Seite, Manifest, Icons,
// engine-map.json, Screen-Editor) für den Offline-Start vor. Build-Dateien verwaltet die Seite selbst im Cache "aether-builds-v1".
// Anfragen an api.github.com (mit Token im Authorization-Header) werden hier nie angefasst,
// also auch nie in einem Cache abgelegt.
'use strict';

var SHELL_CACHE = 'aether-shell-v1';
// Ein geändertes sw.js wird neu installiert und legt dabei alle Einträge (auch neue) in denselben
// Hüllen-Cache; der Name muss dafür nicht hochgezählt werden.
// Der Screen-Editor (screen-editor.html mit three.js aus vendor/) gehört dazu, damit er offline startet.
var SHELL = ['./', 'index.html', 'manifest.json', 'engine-map.json',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
  'screen-editor.html', 'vendor/three-r128.min.js'];

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
