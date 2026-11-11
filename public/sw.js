// Service worker: makes SmartSpace installable as an app on phones and tablets, and keeps the
// (large, unchanging) Python runtime cached so it only downloads once.
const CACHE = 'smartspace-python-v1';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== 'GET' || url.origin !== location.origin || !url.pathname.includes('/pyodide/')) return;
  event.respondWith(caches.open(CACHE).then(async (cache) => {
    const hit = await cache.match(event.request);
    if (hit) return hit;
    const res = await fetch(event.request);
    if (res.ok) cache.put(event.request, res.clone());
    return res;
  }));
});
