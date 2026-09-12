declare const __APP_URL__: string | undefined;

export function getOriginFromString(urlStr: string): string {
  if (!urlStr) return '';
  // Match protocol and host anywhere in string, e.g. blob:https://sub.domain.com/path or https://domain.com
  const match = urlStr.match(/(https?:\/\/[^\/\s\?#]+)/i);
  return match ? match[1] : '';
}

export function getApiUrl(path: string): string {
  let origin = '';

  // 1. Check window.__APP_ORIGIN__ injected dynamically by server/Vite transform
  if (typeof window !== 'undefined' && (window as any).__APP_ORIGIN__) {
    origin = getOriginFromString(String((window as any).__APP_ORIGIN__));
  }

  // 2. Check build-time defined __APP_URL__
  if (!origin) {
    try {
      if (typeof __APP_URL__ !== 'undefined' && __APP_URL__) {
        origin = getOriginFromString(__APP_URL__);
      }
    } catch (e) {}
  }

  // 3. Check process.env.APP_URL
  if (!origin) {
    try {
      if (typeof process !== 'undefined' && process.env && process.env.APP_URL) {
        origin = getOriginFromString(process.env.APP_URL);
      }
    } catch (e) {}
  }

  // 4. Check <base> tag in document
  if (!origin && typeof document !== 'undefined') {
    try {
      const baseEl = document.querySelector('base');
      if (baseEl && baseEl.href && baseEl.href.startsWith('http')) {
        origin = getOriginFromString(baseEl.href);
      }
    } catch (e) {}
  }

  // 5. Check window.location
  if (!origin && typeof window !== 'undefined' && window.location) {
    try {
      if (window.location.origin && window.location.origin.startsWith('http') && window.location.origin !== 'null') {
        origin = window.location.origin;
      } else if (window.location.href && window.location.href.startsWith('http')) {
        origin = getOriginFromString(window.location.href);
      }
    } catch (e) {}
  }

  // 6. Check document.baseURI
  if (!origin && typeof document !== 'undefined' && document.baseURI) {
    try {
      if (document.baseURI.startsWith('http')) {
        origin = getOriginFromString(document.baseURI);
      }
    } catch (e) {}
  }

  // 7. Check script DOM elements (.src property returns the resolved absolute URL)
  if (!origin && typeof document !== 'undefined') {
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of Array.from(scripts)) {
        const src = (script as HTMLScriptElement).src;
        if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
          origin = getOriginFromString(src);
          if (origin) break;
        }
      }
    } catch (e) {}
  }

  // 8. Try to extract from import.meta.url
  if (!origin) {
    try {
      if (typeof import.meta !== 'undefined' && import.meta.url) {
        origin = getOriginFromString(import.meta.url);
      }
    } catch (e) {}
  }

  // 9. If all dynamic origin discovery failed, use the container URL fallback
  // This guarantees WebKit/Safari in sandboxed iframes (about:srcdoc) NEVER throws
  // "The string did not match the expected pattern" on relative URL completion.
  if (!origin || origin === 'null' || origin === 'about:blank') {
    origin = 'https://ais-dev-j64utg4foiwsokqspyv354-50605485163.europe-west2.run.app';
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  const fullUrl = `${origin}${cleanPath}`;

  // Validate constructed URL format
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

