// Madhuram online shop – service worker. Lets customers install the shop as an app and opens it fast.
// Prices, stock, orders and accounts always come from the server; only program files, fonts and pictures are kept.
const VERSION = 'shop-2026.11.28-5';
const SHELL = ['/', '/shop.css?v=2026.11.28e', '/shop.js?v=2026.11.28e', '/icons.js?v=2026.11.28e', '/splash.js?v=2026.11.28e',
  '/shop.webmanifest', '/fonts/poppins-400.woff2', '/fonts/poppins-500.woff2', '/fonts/poppins-600.woff2', '/fonts/poppins-700.woff2',
  '/img/shop-logo.webp?v=2', '/img/shop-icon-192.png?v=2'];
const PICTURE = /^\/(img|fe|photos|fonts)\//;

self.addEventListener('install', (e) => {
  // one missing file must not stop the rest
  e.waitUntil(caches.open(VERSION).then((c) => Promise.all(SHELL.map((u) => c.add(u).catch(() => {})))).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith('shop-') && k !== VERSION).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

const put = (req, res) => { if (res && res.ok && res.type === 'basic') { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); } return res; };

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin || url.pathname.startsWith('/api/') || url.pathname.startsWith('/internal/')) return;
  // the page: the newest one when the network answers quickly, else the saved one (opens at once on a weak signal)
  if (req.mode === 'navigate') {
    e.respondWith(new Promise((resolve) => {
      let done = false;
      const fromCache = () => caches.match('/').then((r) => { if (!done && r) { done = true; resolve(r); } });
      const timer = setTimeout(fromCache, 2500);
      fetch(req).then((res) => {
        clearTimeout(timer);
        if (res.ok && url.pathname === '/') put('/', res.clone());
        if (!done) { done = true; resolve(res); }
      }).catch(() => { clearTimeout(timer); caches.match('/').then((r) => { if (!done) { done = true; resolve(r || Response.error()); } }); });
    }));
    return;
  }
  // program files with a version number, fonts and pictures never change: the saved copy, else the network
  if (url.searchParams.has('v') || PICTURE.test(url.pathname)) {
    e.respondWith(caches.match(req).then((r) => r || fetch(req).then((res) => put(req, res))));
    return;
  }
  e.respondWith(fetch(req).then((res) => put(req, res)).catch(() => caches.match(req, { ignoreSearch: true })));
});
