/**
 * Helper utility for Service Worker management, offline status, and map tile caching stats.
 */

export interface SWCacheStats {
  tileCount: number;
  shellCount: number;
}

export function registerServiceWorker(onUpdate?: () => void) {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((registration) => {
          console.log('[SW] ServiceWorker registered successfully with scope:', registration.scope);

          registration.onupdatefound = () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed') {
                  if (navigator.serviceWorker.controller) {
                    console.log('[SW] New content is available; please refresh.');
                    if (onUpdate) onUpdate();
                  } else {
                    console.log('[SW] Content is cached for offline use.');
                  }
                }
              };
            }
          };
        })
        .catch((error) => {
          console.error('[SW] ServiceWorker registration failed:', error);
        });
    });
  }
}

export async function getSWCacheStats(): Promise<SWCacheStats> {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    return { tileCount: 0, shellCount: 0 };
  }

  return new Promise((resolve) => {
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => {
      if (event.data) {
        resolve({
          tileCount: event.data.tileCount || 0,
          shellCount: event.data.shellCount || 0
        });
      } else {
        resolve({ tileCount: 0, shellCount: 0 });
      }
    };

    navigator.serviceWorker.controller?.postMessage(
      { type: 'GET_CACHE_STATS' },
      [messageChannel.port2]
    );

    // Timeout fallback after 1 second
    setTimeout(() => {
      resolve({ tileCount: 0, shellCount: 0 });
    }, 1000);
  });
}

export async function clearSWTileCache(): Promise<boolean> {
  if (!('serviceWorker' in navigator) || !navigator.serviceWorker.controller) {
    return false;
  }

  return new Promise((resolve) => {
    const messageChannel = new MessageChannel();
    messageChannel.port1.onmessage = (event) => {
      resolve(event.data?.success || false);
    };

    navigator.serviceWorker.controller?.postMessage(
      { type: 'CLEAR_TILE_CACHE' },
      [messageChannel.port2]
    );

    setTimeout(() => {
      resolve(false);
    }, 1500);
  });
}
