// Madhuram cloud – service worker. Makes the app installable and opens the screens fast.
// Data (prices, bills, stock) always comes from the server; only the program files are kept on the PC.
const VERSION = 'mpc-2026.11.28-14';
const SHELL = ['/', '/app.css', '/app.js', '/icons.js', '/splash.js', '/pos.js', '/more.js', '/manifest.webmanifest', '/img/logo.webp', '/img/logo-full.webp', '/img/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.endsWith('.bat')) return;
  // program files: use the network when it answers (so updates show at once), fall back to the saved copy
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('/'))));
});
