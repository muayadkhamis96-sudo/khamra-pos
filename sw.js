/* Khamra POS — service worker
   Precaches the app on install, then serves cache-first so it works fully
   offline. Anything fetched while online (incl. Google Fonts) is cached too.
   Bump CACHE when you change app files to force the iPad to pull the update. */
var CACHE = 'khamra-v11';

var CORE = [
  './',
  'index.html',
  'manifest.json',
  'css/styles.css?v=11',
  'js/data.js?v=11',
  'js/app.js?v=11',
  'assets/logo.png',
  'assets/logo-light.png',
  'assets/icon-152.png',
  'assets/icon-167.png',
  'assets/icon-180.png',
  'assets/icon-192.png',
  'assets/icon-512.png',
  'assets/futureline-sign.png',
  'assets/futureline-sign-light.png',
  'assets/omr.svg',
  'assets/products/karak.jpg',
  'assets/products/red-tea.jpg',
  'assets/products/hibiscus-peach.jpg',
  'assets/products/hibiscus.jpg',
  'assets/products/honeycomb.jpg',
  'assets/products/cinnabon.jpg',
  'assets/products/croissant-butter.jpg',
  'assets/products/croissant-choc.jpg'
];

self.addEventListener('install', function (e) {
  e.waitUntil(
    caches.open(CACHE)
      // addAll fails if any single file 404s; cache them individually instead.
      .then(function (c) { return Promise.all(CORE.map(function (u) {
        return c.add(u).catch(function () { /* ignore a missing optional file */ });
      })); })
      .then(function () { return self.skipWaiting(); })
  );
});

self.addEventListener('activate', function (e) {
  e.waitUntil(
    caches.keys()
      .then(function (keys) { return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); })); })
      .then(function () { return self.clients.claim(); })
  );
});

// App shell (HTML/CSS/JS/JSON) = network-first so updates load when online;
// everything else (images/fonts/svg) = cache-first for speed. Both fall back
// to cache when offline, so the app keeps working with no connection.
function isShell(req) {
  if (req.mode === 'navigate') return true;
  return /\.(?:html|js|css|json)(?:\?|$)/.test(req.url);
}
self.addEventListener('fetch', function (e) {
  if (e.request.method !== 'GET') return;
  var req = e.request;

  if (isShell(req)) {
    e.respondWith(
      fetch(req).then(function (resp) {
        if (resp && resp.ok) { var copy = resp.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return resp;
      }).catch(function () {
        return caches.match(req).then(function (c) { return c || caches.match('index.html'); });
      })
    );
    return;
  }

  e.respondWith(
    caches.match(req).then(function (cached) {
      if (cached) return cached;
      return fetch(req).then(function (resp) {
        if (resp && (resp.ok || resp.type === 'opaque')) {
          var copy = resp.clone();
          caches.open(CACHE).then(function (c) { c.put(req, copy); });
        }
        return resp;
      });
    })
  );
});
