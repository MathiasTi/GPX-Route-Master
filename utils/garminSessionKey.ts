/**
 * Ephemeral in-memory storage for the Garmin Connect Personal API Key.
 * Kept strictly in browser-tab JavaScript heap memory (never written to
 * localStorage, sessionStorage, cookies, or IndexedDB) so it is automatically
 * wiped as soon as the browser tab is closed or reloaded.
 */

let ephemeralTabGarminKey = '';
const listeners = new Set<() => void>();

function notifyServerSessionCleared(): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  try {
    fetch('/api/garmin/personal/clear-session', {
      method: 'POST',
      keepalive: true
    }).catch(() => {});
  } catch {
    // Ignore errors during tab unload
  }
}

if (typeof window !== 'undefined' && typeof window.addEventListener === 'function') {
  window.addEventListener('pagehide', () => {
    if (ephemeralTabGarminKey !== '') {
      ephemeralTabGarminKey = '';
      notifyServerSessionCleared();
    }
  });
}

export function getSessionGarminKey(): string {
  return ephemeralTabGarminKey;
}

export function setSessionGarminKey(rawKey: string): void {
  const next = rawKey.trim();
  if (ephemeralTabGarminKey !== next) {
    ephemeralTabGarminKey = next;
    listeners.forEach((fn) => fn());
  }
}

export function clearSessionGarminKey(): void {
  const hadKey = ephemeralTabGarminKey !== '';
  if (hadKey) {
    ephemeralTabGarminKey = '';
    listeners.forEach((fn) => fn());
  }
  notifyServerSessionCleared();
}

export function subscribeSessionGarminKey(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Wrapper around window.fetch that attaches the ephemeral browser-tab
 * Garmin Personal API Key via the `X-Garmin-Personal-Key` request header
 * whenever a non-persistent session key is active.
 */
export async function garminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  if (ephemeralTabGarminKey && !headers.has('X-Garmin-Personal-Key')) {
    headers.set('X-Garmin-Personal-Key', ephemeralTabGarminKey);
  }
  return fetch(input, {
    ...init,
    headers
  });
}
