/* OneBrain: cache public app shells and immutable assets only.
   APIs, RSC navigation payloads and development chunks are never cache-first. */
const CACHE = "onebrain-workspace-v6";
const CORE = ["/offline", "/manifest.json", "/icon-192.png"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(CORE).catch(() => {}))
      .then(() => self.skipWaiting()),
  );
});
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((key) => key.startsWith("onebrain-") && key !== CACHE)
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});
self.addEventListener("fetch", (event) => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  const publicPage = ["/", "/active", "/offline"].includes(url.pathname);
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (
            publicPage &&
            response.ok &&
            !response.redirected &&
            response.headers.get("content-type")?.includes("text/html")
          ) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(CACHE)
                .then((cache) => cache.put(request, copy))
                .catch(() => {}),
            );
          }
          return response;
        })
        .catch(
          async () =>
            (publicPage ? await caches.match(request) : null) ||
            (await caches.match("/offline")) ||
            new Response("Offline. Reconnect to open OneBrain.", {
              status: 503,
            }),
        ),
    );
    return;
  }
  if (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/backend/")
  ) {
    event.respondWith(
      fetch(request).catch(
        () =>
          new Response(
            JSON.stringify({ error: "Offline. No action was completed." }),
            { status: 503, headers: { "Content-Type": "application/json" } },
          ),
      ),
    );
    return;
  }
  // Next.js uses un-hashed filenames in development; caching those causes stale code and mixed runtimes.
  const immutable =
    url.pathname.startsWith("/_next/static/") &&
    /[.-][a-f0-9]{8,}/i.test(url.pathname);
  const publicAsset =
    CORE.includes(url.pathname) && url.pathname !== "/offline";
  if (!immutable && !publicAsset) return;
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && !response.redirected) {
            const copy = response.clone();
            event.waitUntil(
              caches
                .open(CACHE)
                .then((cache) => cache.put(request, copy))
                .catch(() => {}),
            );
          }
          return response;
        }),
    ),
  );
});

self.addEventListener("sync", (e) => {
  if (e.tag === "sync-memory") e.waitUntil(syncMemory());
});

// A service worker cannot observe the live mic. Do not re-show a 'listening'
// notification from a periodic event after the page may have stopped.
self.addEventListener("notificationclick", (e) => {
  // Stop action: kill the session in every open tab.
  if (e.action === "stop") {
    e.notification.close();
    e.waitUntil(
      self.clients.matchAll().then((clients) => {
        clients.forEach((c) => c.postMessage({ type: "STOP_ASSISTANT" }));
      }),
    );
    return;
  }
  // Tap (or Open action): focus the app, or launch it.
  e.notification.close();
  e.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clients) => {
        for (const c of clients) {
          if ("focus" in c) return c.focus();
        }
        if (self.clients.openWindow) return self.clients.openWindow("/active");
      }),
  );
});
async function syncMemory() {
  try {
    indexedDB.open("onebrain");
    // pendingSync store drained by client on next launch as backup
  } catch {}
}
