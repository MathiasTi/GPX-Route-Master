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

/**
 * Defensive JSON fetch helper that safely parses JSON responses and prevents syntax errors
 * on HTML error pages, 204 No Content, or invalid patterns.
 */
export async function fetchApiJson<T = any>(url: string, options?: RequestInit): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const res = await fetch(url, options);
    if (!res.ok) {
      if (res.status === 401) {
        return {
          ok: false,
          status: 401,
          data: null,
          error: '401 Nicht autorisiert: Der Server hat die Anfrage abgelehnt. Wenn du die App extern geöffnet hast, nutze bitte den geteilten Vorschaulink (ais-pre).'
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

