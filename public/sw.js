const CACHE_VERSION = 'velo-v2';
const SHELL_CACHE = `velo-shell-${CACHE_VERSION}`;
const TILE_CACHE = `velo-tiles-${CACHE_VERSION}`;
const API_CACHE = `velo-api-${CACHE_VERSION}`;

const MAX_TILE_CACHE_SIZE = 1500;

// Essential shell resources to precache
const PRECACHE_ASSETS = [
  '/',
  '/index.html'
];

// Helper: Determine if URL is a map tile request
function isTileRequest(url) {
  try {
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
  } catch (e) {
    return false;
  }
}

// Helper: Trim cache to max items (LRU style)
async function trimCache(cacheName, maxItems) {
  try {
    const cache = await caches.open(cacheName);
    const keys = await cache.keys();
    if (keys.length > maxItems) {
      const itemsToDelete = keys.slice(0, keys.length - maxItems);
      await Promise.all(itemsToDelete.map(key => cache.delete(key).catch(() => {})));
    }
  } catch (e) {
    // Ignore cache trim failures
  }
}

// Install Event
self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        // Add all with individual resilience
        for (const asset of PRECACHE_ASSETS) {
          try {
            await cache.add(asset);
          } catch (err) {
            // Non-blocking precache error
          }
        }
      } catch (err) {
        console.warn('[SW] Precache initialization notice:', err);
      }
      await self.skipWaiting();
    })()
  );
});

// Activate Event - Clean up old cache versions
self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      try {
        const cacheNames = await caches.keys();
        const validCaches = [SHELL_CACHE, TILE_CACHE, API_CACHE];
        
        await Promise.all(
          cacheNames.map((cacheName) => {
            if (!validCaches.includes(cacheName)) {
              console.info('[SW] Purging obsolete cache:', cacheName);
              return caches.delete(cacheName);
            }
          })
        );
      } catch (e) {
        console.warn('[SW] Cache activation cleanup notice:', e);
      }
      await self.clients.claim();
    })()
  );
});

// Fetch Event
self.addEventListener('fetch', (event) => {
  const { request } = event;

  // Skip non-GET requests
  if (request.method !== 'GET') return;

  let url;
  try {
    url = new URL(request.url);
  } catch (e) {
    return;
  }

  // Only handle HTTP/HTTPS protocols (ignore chrome-extension, blob, data, etc.)
  if (!url.protocol.startsWith('http')) return;

  // Bypass Vite development server internals, HMR, and source modules
  if (
    url.pathname.includes('/@vite') ||
    url.pathname.includes('/@fs') ||
    url.pathname.includes('/@id') ||
    url.pathname.endsWith('.tsx') ||
    url.pathname.endsWith('.ts') ||
    url.searchParams.has('import') ||
    url.searchParams.has('t') ||
    url.pathname.includes('node_modules')
  ) {
    return;
  }

  // 1. Map Tiles - Cache First with Network Fallback
  if (isTileRequest(url)) {
    event.respondWith(
      (async () => {
        try {
          const cache = await caches.open(TILE_CACHE);
          const cachedResponse = await cache.match(request);
          
          if (cachedResponse) {
            return cachedResponse;
          }

          try {
            // Standard fetch without overriding CORS mode to support opaque tile servers
            const networkResponse = await fetch(request);

            if (networkResponse && (networkResponse.status === 200 || networkResponse.type === 'opaque')) {
              try {
                cache.put(request, networkResponse.clone());
                trimCache(TILE_CACHE, MAX_TILE_CACHE_SIZE).catch(() => {});
              } catch (putErr) {
                // Ignore quota or cache put error
              }
            }
            return networkResponse;
          } catch (netError) {
            // If offline and tile not cached, return transparent empty response (HTTP 404/204)
            return new Response('', {
              status: 404,
              statusText: 'Tile Not Cached'
            });
          }
        } catch (fatalErr) {
          return fetch(request).catch(() => new Response('', { status: 404 }));
        }
      })()
    );
    return;
  }

  // 2. API requests - Network First, Cache Fallback (Avoid caching mutation endpoints)
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      (async () => {
        try {
          const cache = await caches.open(API_CACHE);
          try {
            const networkResponse = await fetch(request);
            if (networkResponse && networkResponse.status === 200) {
              try {
                cache.put(request, networkResponse.clone());
              } catch (e) {}
            }
            return networkResponse;
          } catch (netError) {
            const cachedResponse = await cache.match(request);
            if (cachedResponse) {
              return cachedResponse;
            }
            return new Response(JSON.stringify({ error: 'Offline - Keine Verbindung zum Server' }), {
              status: 503,
              headers: { 'Content-Type': 'application/json; charset=utf-8' }
            });
          }
        } catch (fatalErr) {
          return new Response(JSON.stringify({ error: 'Service Worker Network Error' }), {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' }
          });
        }
      })()
    );
    return;
  }

  // 3. Application Shell & Static Assets - Network with Cache Fallback / SPA Fallback
  event.respondWith(
    (async () => {
      try {
        const cache = await caches.open(SHELL_CACHE);
        
        // Attempt network first for active development / fresh updates
        try {
          const networkResponse = await fetch(request);
          if (networkResponse && networkResponse.status === 200 && (networkResponse.type === 'basic' || networkResponse.type === 'cors')) {
            try {
              cache.put(request, networkResponse.clone());
            } catch (e) {}
          }
          return networkResponse;
        } catch (netError) {
          // If network fails (offline), fallback to cache
          const cachedResponse = await cache.match(request);
          if (cachedResponse) {
            return cachedResponse;
          }

          // If navigation request and offline, return cached app shell
          if (request.mode === 'navigate') {
            const shell = (await cache.match('/index.html')) || (await cache.match('/'));
            if (shell) return shell;
          }

          return new Response('Offline - Ressource momentan nicht verfügbar', { 
            status: 503,
            headers: { 'Content-Type': 'text/plain; charset=utf-8' }
          });
        }
      } catch (fatalErr) {
        return fetch(request).catch(() => new Response('Offline', { status: 503 }));
      }
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
      
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({
          tileCount: tileKeys.length,
          shellCount: shellKeys.length
        });
      }
    } catch (e) {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ tileCount: 0, shellCount: 0 });
      }
    }
  } else if (event.data.type === 'CLEAR_TILE_CACHE') {
    try {
      await caches.delete(TILE_CACHE);
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: true });
      }
    } catch (e) {
      if (event.ports && event.ports[0]) {
        event.ports[0].postMessage({ success: false });
      }
    }
  }
});

