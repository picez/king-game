// ---------------------------------------------------------------------------
// King — minimal service worker (app-shell offline + installability).
//
// Strategy: NETWORK-FIRST with a runtime cache fallback. No hardcoded precache
// list (so hashed Vite asset names never go stale), no aggressive caching:
//   • online → always fetch fresh, then cache the response for offline use;
//   • offline → serve the cached asset, or cached index.html for navigations.
//
// It only ever sees same-origin HTTP(S) GETs. WebSocket (ws://, wss://) traffic
// does NOT pass through the fetch handler, so online game state is never cached.
// Registered only in production builds (see src/main.tsx).
// ---------------------------------------------------------------------------

const CACHE = 'king-shell-v1';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // only our own app shell

  event.respondWith(
    fetch(req)
      .then((res) => {
        // Cache a copy of successful responses for offline use.
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(async () => {
        const cached = await caches.match(req);
        if (cached) return cached;
        // Offline navigation → fall back to the cached app shell.
        if (req.mode === 'navigate') {
          const shell = await caches.match('/index.html') || await caches.match('/');
          if (shell) return shell;
        }
        return Response.error();
      }),
  );
});
