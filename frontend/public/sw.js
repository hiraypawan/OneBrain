/* OneBrain service worker: offline cache + background sync + notification actions.
   Strategy: NETWORK-FIRST for pages (never stuck on stale UI),
   cache-first for static assets, network-first for API. */
const CACHE = 'onebrain-v4';
const CORE = ['/offline', '/manifest.json', '/icon-192.png'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(CORE).catch(() => {})).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((ks) => Promise.all(ks.map((k) => (k !== CACHE ? caches.delete(k) : null))))
      .then(() => self.clients.claim())
  );
});
self.addEventListener('fetch', (e) => {
  const { request } = e;
  if (request.method !== 'GET') return;

  // Page navigations: always try network first so updates show immediately.
  if (request.mode === 'navigate') {
    e.respondWith(
      fetch(request)
        .then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(request).then((r) => r || caches.match('/offline')))
    );
    return;
  }

  if (request.url.includes('/api/')) {
    e.respondWith(fetch(request).catch(() => caches.match(request).then((r) => r || new Response('Offline', { status: 503 }))));
    return;
  }

  // Static assets: cache-first, then network.
  e.respondWith(
    caches.match(request).then(
      (r) =>
        r ||
        fetch(request).then((res) => {
          const clone = res.clone();
          caches.open(CACHE).then((c) => c.put(request, clone)).catch(() => {});
          return res;
        })
    )
  );
});
self.addEventListener('sync', (e) => {
  if (e.tag === 'sync-memory') e.waitUntil(syncMemory());
});

// Periodic Background Sync (Android Chrome + installed PWA only; iOS
// Safari does not implement it). All it can honestly do: re-show the
// "Active" notification if the OS dismissed it. It cannot revive the mic.
self.addEventListener('periodicsync', (e) => {
  if (e.tag === 'onebrain-keepalive') {
    e.waitUntil(
      self.registration.showNotification('OneBrain Active', {
        body: 'Listening... Tap to open.',
        icon: '/icon-192.png',
        tag: 'onebrain-active',
        requireInteraction: true,
      }).catch(() => {})
    );
  }
});
self.addEventListener('notificationclick', (e) => {
  // Stop action: kill the session in every open tab.
  if (e.action === 'stop') {
    e.notification.close();
    e.waitUntil(self.clients.matchAll().then((clients) => {
      clients.forEach((c) => c.postMessage({ type: 'STOP_ASSISTANT' }));
    }));
    return;
  }
  // Tap (or Open action): focus the app, or launch it.
  e.notification.close();
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
      for (const c of clients) {
        if ('focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow('/active');
    })
  );
});
async function syncMemory() {
  try {
    indexedDB.open('onebrain');
    // pendingSync store drained by client on next launch as backup
  } catch {}
}
