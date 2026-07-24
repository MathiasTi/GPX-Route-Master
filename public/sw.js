const CACHE_VERSION = 'velo-v1';
const SHELL_CACHE = `velo-shell-${CACHE_VERSION}`;
const TILE_CACHE = `velo-tiles-${CACHE_VERSION}`;
const API_CACHE = `velo-api-${CACHE_VERSION}`;

const MAX_TILE_CACHE_SIZE = 1500;

// Essential shell resources to precache
const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css'
];

// Helper: Determine if URL is a map tile request
function isTileRequest(url) {
  const urlObj = typeof url === 'string' ? new URL(url, self.location.origin) : url;
  const href = urlObj.href.toLowerCase();
  const path = urlObj.pathname.toLowerCase();

  return (
    href.includes('tile.openstreetmap.org') ||
    href.includes('tile.opentopomap.org') ||
    href.includes('cartocdn.com') ||
    href.includes('arcgisonline.com') ||
    href.includes('thunderforest.com') ||
    href.includes('waymarkedtrails.org') ||
    href.includes('stamen-tiles') ||
    href.includes('cyclosm') ||
    path.includes('/tiles/') ||
    path.includes('/tile/') ||
    /\/\d+\/\d+\/\d+(\.png|\.jpg|\.webp|\.pbf)?/i.test(path)
  );
}

// Helper: Trim cache to max items (LRU style)
async function trimCache(cacheName, maxItems) {
  const cache = await caches.open(cacheName);
  const keys = await cache.keys();
  if (keys.length > maxItems) {
    const itemsToDelete = keys.slice(0, keys.length - maxItems);
    await Promise.all(itemsToDelete.map(key => cache.delete(key)));
  }
}

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      try {
        await cache.addAll(PRECACHE_ASSETS);
      } catch (err) {
        console.warn('[SW] Precache partial error, proceeding:', err);
      }
      await self.skipWaiting();
    })()
  );
});

// Activate Event - Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const cacheNames = await caches.keys();
      const validCaches = [SHELL_CACHE, TILE_CACHE, API_CACHE];
      
      await Promise.all(
        cacheNames.map((cacheName) => {
          if (!validCaches.includes(cacheName)) {
            console.log('[SW] Deleting obsolete cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
      await self.clients.claim();
    })()
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  // 1. Map Tiles - Cache First with Network Fallback
  if (isTileRequest(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(TILE_CACHE);
        const cachedResponse = await cache.match(request);
        
        if (cachedResponse) {
          return cachedResponse;
        }

        try {
          const networkResponse = await fetch(request, {
            mode: 'cors',
            credentials: 'omit'
          });

          if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
            cache.put(request, networkResponse.clone());
            // Trim cache asynchronously
            trimCache(TILE_CACHE, MAX_TILE_CACHE_SIZE);
          }
          return networkResponse;
        } catch (error) {
          // If offline and tile not cached, return transparent fallback tile or 404
          return new Response('', {
            status: 404,
            statusText: 'Offline Tile Not Cached'
          });
        }
      })()
    );
    return;
  }

  // 2. API requests - Network First, Cache Fallback
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(API_CACHE);
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200) {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        } catch (error) {
          const cachedResponse = await cache.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }
          return new Response(JSON.stringify({ error: 'Offline - Keine Verbindung' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json' }
          });
        }
      })()
    );
    return;
  }

  // 3. Application Shell & Static Assets - Stale While Revalidate / Cache First with SPA Fallback
  event.respondWith(
    (async () => {
      const cache = await caches.open(SHELL_CACHE);
      const cachedResponse = await cache.match(request);

      const fetchPromise = fetch(request)
        .then((networkResponse) => {
          if (networkResponse && networkResponse.status === 200 && networkResponse.type === 'basic') {
            cache.put(request, networkResponse.clone());
          }
          return networkResponse;
        })
        .catch(() => null);

      if (cachedResponse) {
        // Return cached asset immediately, update cache in background
        fetchPromise; // run in background
        return cachedResponse;
      }

      const networkResponse = await fetchPromise;
      if (networkResponse) {
        return networkResponse;
      }

      // If navigation request and offline, return app shell index.html
      if (request.mode === 'navigate') {
        const shell = await cache.match('/index.html') || await cache.match('/');
        if (shell) return shell;
      }

      return new Response('Offline - Ressource nicht verfügbar', { status: 503 });
    })()
  );
});

// Handle messages from client
self.addEventListener('message', async (event) => {
  if (!event.data) return;

  if (event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  } else if (event.data.type === 'GET_CACHE_STATS') {
    try {
      const tileCache = await caches.open(TILE_CACHE);
      const tileKeys = await tileCache.keys();
      const shellCache = await caches.open(SHELL_CACHE);
      const shellKeys = await shellCache.keys();
      
      event.ports[0].postMessage({
        tileCount: tileKeys.length,
        shellCount: shellKeys.length
      });
    } catch (e) {
      if (event.ports[0]) event.ports[0].postMessage({ tileCount: 0, shellCount: 0 });
    }
  } else if (event.data.type === 'CLEAR_TILE_CACHE') {
    try {
      await caches.delete(TILE_CACHE);
      if (event.ports[0]) event.ports[0].postMessage({ success: true });
    } catch (e) {
      if (event.ports[0]) event.ports[0].postMessage({ success: false });
    }
  }
});
