// ---------------------------------------------------------------------------
// Card Majlis — minimal service worker (app-shell offline + installability).
//
// Strategy: NETWORK-FIRST with a runtime cache fallback. No hardcoded precache
// list (so hashed Vite asset names never go stale), no aggressive caching:
//   • online → always fetch fresh, then cache the response for offline use;
//   • offline → serve the cached asset, or cached index.html for navigations.
//
// It only ever sees same-origin HTTP(S) GETs. WebSocket (ws://, wss://) traffic
// does NOT pass through the fetch handler, so online game state is never cached.
// Registered only in production builds (see src/pwa/pwaClient.ts).
//
// CONTROLLED UPDATES (Stage 21.0): install does NOT call skipWaiting(), so a new
// SW enters the `waiting` state instead of taking over immediately. The client
// (usePwa) shows a non-blocking "Update available" banner and only activates the
// new worker when the user taps Refresh (→ postMessage {type:'SKIP_WAITING'}),
// which triggers `controllerchange` and a single reload. This is why there is no
// auto-refresh during an active game.
// ---------------------------------------------------------------------------

// Bump this on each release that must invalidate any previously-cached shell.
// On activate, every cache whose name !== CACHE is deleted, so a new SW version
// purges the old offline copy (belt-and-suspenders on top of network-first).
const CACHE = 'card-majlis-shell-v3';

// Do NOT skipWaiting() here — wait for the user's explicit Refresh so an update
// never reloads mid-game. (On first-ever install with no active worker, the new
// SW activates immediately anyway, per the spec — nothing to wait for.)
self.addEventListener('install', () => { /* controlled activation via SKIP_WAITING */ });

// The client asks the waiting worker to take over when the user taps Refresh.
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

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
