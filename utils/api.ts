export function getApiUrl(path: string): string {
  let origin = '';
  try {
    if (typeof import.meta !== 'undefined' && import.meta.url) {
      origin = new URL(import.meta.url).origin;
    }
  } catch (e) {
    console.warn("Failed to extract origin from import.meta.url", e);
  }

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
