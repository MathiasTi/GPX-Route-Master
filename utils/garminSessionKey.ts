/**
 * Ephemeral in-memory storage for the Garmin Connect Personal API Key.
 * Kept strictly in browser-tab JavaScript heap memory (never written to
 * localStorage, sessionStorage, cookies, or IndexedDB) so it is automatically
 * wiped as soon as the browser tab is closed or reloaded.
 */
import { apiFetch, getApiUrl } from './api';

let ephemeralTabGarminKey = '';
const listeners = new Set<() => void>();

function notifyServerSessionCleared(): void {
  if (typeof window === 'undefined' || typeof fetch !== 'function') return;
  try {
    apiFetch(getApiUrl('/api/garmin/personal/clear-session'), {
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

/**
 * Strips whitespace, line breaks, and invisible copy-paste characters (BOM, zero-width spaces)
 * that frequently sneak in when copying API keys from browsers or PDFs.
 */
export function sanitizeGarminSessionKey(rawKey: string): string {
  return String(rawKey || '')
    .replace(/[\u200B-\u200D\uFEFF\u00AD\r\n]+/g, '')
    .trim();
}

/**
 * HTTP request headers (Fetch ByteString) only accept printable ASCII / ISO-8859-1
 * without control characters. Garmin API Keys and JWTs are strictly printable ASCII (0x20-0x7E).
 */
export function isValidHttpHeaderValue(value: string): boolean {
  if (!value) return false;
  return /^[\x20-\x7E]+$/.test(value);
}

export function validateGarminSessionKey(rawKey: string): {
  valid: boolean;
  sanitized: string;
  error?: string;
} {
  const sanitized = sanitizeGarminSessionKey(rawKey);
  if (!sanitized) {
    return {
      valid: false,
      sanitized: '',
      error: 'Bitte gib deinen Garmin Personal API Key für diese Browser-Tab-Sitzung ein.'
    };
  }
  if (!isValidHttpHeaderValue(sanitized)) {
    return {
      valid: false,
      sanitized,
      error:
        'Der eingegebene Garmin Personal API Key enthält ungültige Sonder- oder Steuerzeichen (z. B. Umlaute, Aufzählungspunkte • oder nicht-ASCII-Zeichen). Bitte kopiere den reinen ASCII-Schlüssel bzw. Token erneut.'
    };
  }
  return { valid: true, sanitized };
}

export function getSessionGarminKey(): string {
  return ephemeralTabGarminKey;
}

export function setSessionGarminKey(rawKey: string): void {
  const next = sanitizeGarminSessionKey(rawKey);
  if (next && !isValidHttpHeaderValue(next)) {
    return;
  }
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
 * Wrapper around apiFetch that attaches the ephemeral browser-tab
 * Garmin Personal API Key via the `X-Garmin-Personal-Key` request header
 * whenever a valid non-persistent session key is active.
 */
export async function garminFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  const safeKey = sanitizeGarminSessionKey(ephemeralTabGarminKey);
  if (safeKey && !headers.has('X-Garmin-Personal-Key') && isValidHttpHeaderValue(safeKey)) {
    try {
      headers.set('X-Garmin-Personal-Key', safeKey);
    } catch {
      // Never crash synchronously on Fetch Headers.set
    }
  }
  return apiFetch(input, {
    ...init,
    headers
  });
}
