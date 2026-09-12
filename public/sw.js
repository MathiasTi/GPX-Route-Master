// Universal Service Worker Kill-Switch & Cleanup Worker
// Replaces any stale, buggy service worker and completely unregisters itself.

self.addEventListener('install', (event) => {
  // Activate immediately, replacing any existing active worker
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    // Take immediate control of all client tabs
    self.clients.claim()
      .then(() => {
        // Delete all caches created by previous service workers
        if (typeof caches !== 'undefined') {
          return caches.keys().then((keys) => {
            return Promise.all(keys.map((key) => caches.delete(key)));
          });
        }
      })
      .then(() => {
        // Unregister this service worker registration
        return self.registration.unregister();
      })
      .then(() => {
        // Notify or reload any open clients so they load directly from network
        return self.clients.matchAll({ type: 'window' }).then((clients) => {
          clients.forEach((client) => {
            try {
              if (client.navigate && client.url) {
                client.navigate(client.url);
              }
            } catch (e) {}
          });
        });
      })
      .catch((err) => {
        console.warn('[SW Kill-Switch] Activation cleanup error:', err);
      })
  );
});

// Pass-through fetch handler that NEVER blocks, caches, or throws
self.addEventListener('fetch', (event) => {
  try {
    event.respondWith(
      fetch(event.request).catch(() => {
        return fetch(event.request, { cache: 'no-store' });
      })
    );
  } catch (err) {
    // If respondWith fails or request cannot be fetched, let browser handle natively
  }
});
