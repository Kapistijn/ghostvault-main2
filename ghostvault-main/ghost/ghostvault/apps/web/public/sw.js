const STATIC_CACHE = 'ghostvault-static-v2';
const DYNAMIC_CACHE = 'ghostvault-dynamic-v2';

// Only assets we are confident exist. Anything missing is tolerated below.
const STATIC_ASSETS = ['/', '/index.html'];

// Install - cache static assets individually so one 404 does not abort install.
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(STATIC_CACHE);
      await Promise.all(
        STATIC_ASSETS.map((asset) =>
          cache.add(asset).catch((err) => {
            console.warn('[sw] skip caching', asset, err);
          })
        )
      );
      await self.skipWaiting();
    })()
  );
});

// Activate - drop old caches and take control of open clients immediately.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const names = await caches.keys();
      await Promise.all(
        names
          .filter((n) => n !== STATIC_CACHE && n !== DYNAMIC_CACHE)
          .map((n) => caches.delete(n))
      );
      await self.clients.claim();
    })()
  );
});

// Paths that must never be served from cache (Vite dev server / HMR / source).
function isDevOrModuleRequest(url) {
  if (url.search.includes('t=') || url.search.includes('import')) return true;
  return (
    url.pathname.startsWith('/@vite') ||
    url.pathname.startsWith('/@id') ||
    url.pathname.startsWith('/@react') ||
    url.pathname.startsWith('/src/') ||
    url.pathname.startsWith('/node_modules/') ||
    url.pathname.startsWith('/api')
  );
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Only handle same-origin GET requests.
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;
  if (url.protocol === 'ws:' || url.protocol === 'wss:') return;
  if (isDevOrModuleRequest(url)) return; // let the dev server handle it

  // Navigations: network-first so users get fresh HTML, fall back to cache offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request).catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    );
    return;
  }

  // Other static GETs: cache-first, then network (and cache the result).
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached;
      return fetch(request).then((response) => {
        if (!response || response.status !== 200 || response.type !== 'basic') {
          return response;
        }
        const copy = response.clone();
        caches.open(DYNAMIC_CACHE).then((cache) => cache.put(request, copy));
        return response;
      });
    })
  );
});
