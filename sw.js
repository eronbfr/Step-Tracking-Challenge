// Team 8 · Step Challenge — service worker.
// Bump VERSION on every release so installed apps pick up the new files.
const VERSION = 'v2.1.0';
const SHELL = `t8-shell-${VERSION}`;
const ASSETS = [
  './', './index.html', './manifest.webmanifest', './css/app.css',
  './js/app.js', './js/views.js', './js/api.js', './js/config.js', './js/metrics.js', './js/charts.js', './js/ui.js', './js/ocr.js',
  './js/i18n.js', './js/strings.js', './js/avatars.js', './js/ledger.js', './js/device.js', './js/worldmap.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/maskable-512.png', './icons/apple-touch-icon.png',
  './assets/reminder.ics',
];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(ASSETS.map(u => new Request(u, { cache: 'reload' })))));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('t8-shell-') && k !== SHELL).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', event => { if (event.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Android share target: keep the screenshot and hand it to the app.
  if (req.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith((async () => {
      const form = await req.formData();
      const file = form.get('image') || [...form.values()].find(v => v instanceof File);
      if (file) {
        const cache = await caches.open('t8-share');
        await cache.put('./__shared-image', new Response(file, { headers: { 'Content-Type': file.type || 'image/png' } }));
      }
      return Response.redirect('./?shared=1', 303);
    })());
    return;
  }

  if (req.method !== 'GET' || url.origin !== self.location.origin) return; // relay, GitHub & CDNs go straight to the network
  // Ledger snapshot and spreadsheet change every few minutes: never serve them from the cache.
  if (url.pathname.includes('/data/') || url.pathname.endsWith('.xlsx')) return;

  // Pages: network first (fresh deploys), cached shell when offline.
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(SHELL);
        cache.put('./index.html', res.clone());
        return res;
      } catch {
        return (await caches.match('./index.html')) || Response.error();
      }
    })());
    return;
  }

  // Static files (shell, avatars, map imagery): cache first, then network (and remember it).
  event.respondWith((async () => {
    const hit = await caches.match(req, { ignoreSearch: true });
    if (hit) return hit;
    const res = await fetch(req);
    if (res.ok) (await caches.open(SHELL)).put(req, res.clone());
    return res;
  })());
});
