export function getOriginFromString(urlStr: string): string {
  if (!urlStr) return '';
  // Match protocol and host: e.g. http://localhost:3000 or https://sub.domain.com
  const match = urlStr.match(/^(https?:\/\/[^\/]+)/i);
  return match ? match[1] : '';
}

export function getApiUrl(path: string): string {
  let origin = '';

  // 1. Try to extract from import.meta.url
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      origin = getOriginFromString(import.meta.url);
    }
  } catch (e) {
    console.warn("Failed to extract origin from import.meta.url", e);
  }

  // 2. Try to extract from window.location.href
  if (!origin && typeof window !== 'undefined' && window.location) {
    try {
      if (window.location.href && window.location.href.startsWith('http')) {
        origin = getOriginFromString(window.location.href);
      }
    } catch (e) {}
  }

  // 3. Try to extract from document.baseURI
  if (!origin && typeof document !== 'undefined' && document.baseURI) {
    try {
      if (document.baseURI.startsWith('http')) {
        origin = getOriginFromString(document.baseURI);
      }
    } catch (e) {}
  }

  // 4. Try to extract from any script or link in the document
  if (!origin && typeof document !== 'undefined') {
    try {
      const scripts = document.querySelectorAll('script');
      for (const script of Array.from(scripts)) {
        const src = script.getAttribute('src') || (script as any).src;
        if (src && (src.startsWith('http://') || src.startsWith('https://'))) {
          origin = getOriginFromString(src);
          if (origin) break;
        }
      }
    } catch (e) {}

    if (!origin) {
      try {
        const links = document.querySelectorAll('link');
        for (const link of Array.from(links)) {
          const href = link.getAttribute('href') || (link as any).href;
          if (href && (href.startsWith('http://') || href.startsWith('https://'))) {
            origin = getOriginFromString(href);
            if (origin) break;
          }
        }
      } catch (e) {}
    }
  }

  // 5. Try ancestorOrigins
  if (!origin && typeof window !== 'undefined' && window.location && (window.location as any).ancestorOrigins) {
    try {
      const ancestors = (window.location as any).ancestorOrigins;
      if (ancestors && ancestors.length > 0) {
        for (let i = 0; i < ancestors.length; i++) {
          const ancestor = ancestors[i];
          if (ancestor && ancestor !== 'null' && ancestor.startsWith('http')) {
            origin = ancestor;
            break;
          }
        }
      }
    } catch (e) {}
  }

  // 6. Native URL fallback if everything else failed
  if (!origin && typeof window !== 'undefined' && window.location) {
    if (window.location.origin && window.location.origin !== 'null') {
      origin = window.location.origin;
    } else if (window.location.host) {
      const protocol = window.location.protocol && window.location.protocol !== 'about:' ? window.location.protocol : 'https:';
      origin = `${protocol}//${window.location.host}`;
    }
  }

  if (!origin || origin === 'null') {
    return path;
  }

  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  return `${origin}${cleanPath}`;
}
