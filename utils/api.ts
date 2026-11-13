import { safeGetItem, safeSetItem, safeRemoveItem } from './storage';

declare const __APP_URL__: string | undefined;

function isDisallowedHost(origin: string): boolean {
  if (!origin) return true;
  const lower = origin.toLowerCase();
  return lower.includes('google.com') || lower.includes('ai.studio') || lower.includes('googleusercontent.com');
}

export function getOriginFromString(urlStr: string): string {
  if (!urlStr) return '';
  // Match protocol and host anywhere in string, e.g. blob:https://sub.domain.com/path or https://domain.com
  const match = urlStr.match(/(https?:\/\/[^\/\s\?#]+)/i);
  const found = match ? match[1] : '';
  if (isDisallowedHost(found)) {
    return '';
  }
  return found;
}

export function getApiUrl(path: string): string {
  if (!path) return '/';
  if (path.startsWith('http://') || path.startsWith('https://')) {
    return path;
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;

  // 1. If running in browser with a valid origin, prefer relative path
  // Standard relative paths like '/api/tracks' are natively resolved by the browser
  // against the current host (whether ais-dev, ais-pre, localhost, or custom domain).
  // This completely eliminates cross-origin issues, cookie drops, and 401 errors.
  if (typeof window !== 'undefined' && window.location) {
    const locOrigin = window.location.origin;
    if (locOrigin && locOrigin !== 'null' && locOrigin.startsWith('http') && !isDisallowedHost(locOrigin)) {
      return cleanPath;
    }
  }

  // 2. If running inside a sandboxed iframe without direct origin (origin === 'null' / 'about:blank'),
  // we must build an absolute URL so WebKit/Safari doesn't throw.
  let origin = '';

  // Check window.__APP_ORIGIN__
  if (typeof window !== 'undefined' && (window as any).__APP_ORIGIN__) {
    const candidate = getOriginFromString(String((window as any).__APP_ORIGIN__));
    if (candidate && !isDisallowedHost(candidate)) {
      origin = candidate;
    }
  }

  // Check build-time defined __APP_URL__
  if (!origin) {
    try {
      if (typeof __APP_URL__ !== 'undefined' && __APP_URL__) {
        const candidate = getOriginFromString(__APP_URL__);
        if (candidate && !isDisallowedHost(candidate)) {
          origin = candidate;
        }
      }
    } catch (e) {}
  }

  // Check process.env.APP_URL
  if (!origin) {
    try {
      if (typeof process !== 'undefined' && process.env && process.env.APP_URL) {
        const candidate = getOriginFromString(process.env.APP_URL);
        if (candidate && !isDisallowedHost(candidate)) {
          origin = candidate;
        }
      }
    } catch (e) {}
  }

  // Check script tags for host derivation
  if (!origin && typeof document !== 'undefined') {
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of Array.from(scripts)) {
        const src = (script as HTMLScriptElement).src;
        if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
          const candidate = getOriginFromString(src);
          if (candidate && !isDisallowedHost(candidate)) {
            origin = candidate;
            break;
          }
        }
      }
    } catch (e) {}
  }

  // Fallback if inside sandboxed iframe:
  // Determine whether current context is pre or dev
  if (!origin || origin === 'null' || origin === 'about:blank') {
    origin = 'https://ais-pre-j64utg4foiwsokqspyv354-50605485163.europe-west2.run.app';
  }

  const fullUrl = `${origin}${cleanPath}`;

  try {
    new URL(fullUrl);
    return fullUrl;
  } catch (e) {
    return cleanPath;
  }
}

const AUTH_SESSION_TOKEN_KEY = 'velo_auth_session_token';
let inMemorySessionToken: string | null = null;

export function getSessionToken(): string | null {
  if (inMemorySessionToken) return inMemorySessionToken;
  const stored = safeGetItem(AUTH_SESSION_TOKEN_KEY, null);
  if (stored && stored.trim()) {
    inMemorySessionToken = stored.trim();
    return inMemorySessionToken;
  }
  return null;
}

export function setSessionToken(token: string | null): void {
  if (token && token.trim()) {
    const clean = token.trim();
    inMemorySessionToken = clean;
    safeSetItem(AUTH_SESSION_TOKEN_KEY, clean);
  } else {
    clearSessionToken();
  }
}

export function clearSessionToken(): void {
  inMemorySessionToken = null;
  safeRemoveItem(AUTH_SESSION_TOKEN_KEY);
}

export function getAuthHeaders(extraHeaders?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extraHeaders || {}) };
  const token = getSessionToken();
  if (token && !headers['Authorization'] && !headers['authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

function isInternalApiRequest(input: RequestInfo | URL): boolean {
  let urlStr = '';
  if (typeof input === 'string') {
    urlStr = input;
  } else if (typeof URL !== 'undefined' && input instanceof URL) {
    urlStr = input.toString();
  } else if (input && typeof (input as Request).url === 'string') {
    urlStr = (input as Request).url;
  }

  if (!urlStr) return false;
  if (urlStr.startsWith('/api/') || urlStr === '/api') return true;
  try {
    const parsed = new URL(urlStr, typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000');
    return parsed.pathname.startsWith('/api/');
  } catch {
    return urlStr.includes('/api/');
  }
}

const baseFetch: typeof fetch =
  typeof window !== 'undefined' && typeof window.fetch === 'function'
    ? window.fetch.bind(window)
    : typeof fetch === 'function'
      ? fetch
      : ((async () => {
          throw new Error('fetch is not available');
        }) as unknown as typeof fetch);

/**
 * Fetch wrapper that automatically attaches the Bearer session token and credentials
 * for internal `/api/*` requests, even in sandboxed iframes or environments where
 * `window.fetch` is a read-only property.
 */
export async function apiFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (isInternalApiRequest(input)) {
    const nextInit: RequestInit = { ...(init || {}) };
    const headers = new Headers(
      nextInit.headers ||
        (typeof Request !== 'undefined' && input instanceof Request ? input.headers : undefined)
    );
    const token = getSessionToken();
    if (token && !headers.has('Authorization')) {
      headers.set('Authorization', `Bearer ${token}`);
    }
    nextInit.headers = headers;
    if (!nextInit.credentials) {
      nextInit.credentials = 'include';
    }
    const response = await baseFetch(input, nextInit);
    if (response.status === 401 && typeof window !== 'undefined') {
      let reqUrl = '';
      if (typeof input === 'string') reqUrl = input;
      else if (typeof URL !== 'undefined' && input instanceof URL) reqUrl = input.toString();
      else if (input && typeof (input as Request).url === 'string') reqUrl = (input as Request).url;

      if (
        !reqUrl.includes('/api/auth/me') &&
        !reqUrl.includes('/api/auth/logout') &&
        !reqUrl.includes('/api/auth/unlock') &&
        !reqUrl.includes('/api/auth/login')
      ) {
        window.dispatchEvent(new CustomEvent('velo:auth-unauthorized'));
      }
    }
    return response;
  }
  return baseFetch(input, init);
}

// Best-effort global window.fetch wrapper for any callers using raw fetch().
// Wrapped in try/catch because sandboxed preview environments (e.g. WebKit/AI Studio iframe)
// may define window.fetch as a read-only property.
let isGlobalFetchWrapped = false;
if (typeof window !== 'undefined' && typeof window.fetch === 'function' && !isGlobalFetchWrapped) {
  isGlobalFetchWrapped = true;
  try {
    const desc = Object.getOwnPropertyDescriptor(window, 'fetch');
    if (!desc || desc.writable) {
      window.fetch = apiFetch;
    } else if (desc.configurable) {
      Object.defineProperty(window, 'fetch', {
        value: apiFetch,
        writable: true,
        configurable: true,
        enumerable: desc.enumerable ?? true
      });
    }
  } catch {
    // Ignore TypeError: Attempted to assign to readonly property in locked-down environments;
    // explicit apiFetch() and fetchApiJson() calls still attach auth headers.
  }
}

/**
 * Defensive JSON fetch helper that safely parses JSON responses and prevents syntax errors
 * on HTML error pages, 204 No Content, or invalid patterns.
 */
export async function fetchApiJson<T = any>(url: string, options?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const res = await apiFetch(url, options);
    if (!res.ok) {
      if (res.status === 401) {
        return {
          ok: false,
          status: 401,
          data: null,
          error: '401 Nicht autorisiert: Bitte melde dich erneut an.'
        };
      }
      return { ok: false, status: res.status, data: null, error: `HTTP ${res.status}` };
    }
    const text = await res.text();
    if (!text || text.trim() === '') {
      return { ok: true, status: res.status, data: null };
    }
    const trimmed = text.trim();
    if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
      try {
        const data = JSON.parse(trimmed);
        return { ok: true, status: res.status, data };
      } catch (parseErr: any) {
        return { ok: false, status: res.status, data: null, error: parseErr.message };
      }
    }
    return { ok: false, status: res.status, data: null, error: 'Response was not valid JSON' };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, error: err.message || 'Fetch failed' };
  }
}

