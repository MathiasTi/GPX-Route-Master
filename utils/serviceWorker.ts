/**
 * Helper utility for Service Worker management, offline status, and map tile caching stats.
 */

export interface SWCacheStats {
  tileCount: number;
  shellCount: number;
}

export function registerServiceWorker(onUpdate?: () => void) {
  if (typeof window === 'undefined' || !('serviceWorker' in navigator)) {
    return;
  }

  const isLocalOrHttps = window.location.protocol === 'https:' || 
    window.location.hostname === 'localhost' || 
    window.location.hostname === '127.0.0.1';

  if (!isLocalOrHttps) {
    return;
  }

  const register = () => {
    try {
      navigator.serviceWorker
        .register('/sw.js', { scope: '/' })
        .then((registration) => {
          console.info('[SW] ServiceWorker registered successfully with scope:', registration.scope);

          registration.onupdatefound = () => {
            const installingWorker = registration.installing;
            if (installingWorker) {
              installingWorker.onstatechange = () => {
                if (installingWorker.state === 'installed') {
                  if (navigator.serviceWorker.controller) {
                    console.info('[SW] New content is available; please refresh.');
                    if (onUpdate) onUpdate();
                  } else {
                    console.info('[SW] Content is cached for offline use.');
                  }
                }
              };
            }
          };
        })
        .catch((error: any) => {
          // Gracefully handle iframe / sandboxed preview restrictions without fatal console errors
          console.warn('[SW] ServiceWorker registration unavailable or restricted in current frame context:', error?.message || error);
        });
    } catch (err: any) {
      console.warn('[SW] ServiceWorker initialization skipped:', err?.message || err);
    }
  };

  if (document.readyState === 'complete') {
    register();
  } else {
    window.addEventListener('load', register, { once: true });
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
