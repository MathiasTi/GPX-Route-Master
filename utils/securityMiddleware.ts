import type express from 'express';

export interface RateLimiterOptions {
  windowMs: number;
  maxRequests: number;
  message: string;
  keyPrefix?: string;
  maxTrackedKeys?: number;
}

interface RateBucket {
  count: number;
  resetAt: number;
}

/**
 * Extracts a normalized client identifier for rate limiting.
 * Relies on Express `trust proxy` configuration rather than blindly trusting raw spoofable headers.
 */
export function getClientIp(req: Pick<express.Request, 'ip' | 'socket'>): string {
  const raw = String(req.ip || req.socket?.remoteAddress || 'unknown').trim();
  // Normalize IPv4-mapped IPv6 addresses (e.g. ::ffff:127.0.0.1 -> 127.0.0.1)
  return raw.replace(/^::ffff:/i, '') || 'unknown';
}

/**
 * Memory-bounded sliding/fixed-window rate limiter middleware.
 */
export function createRateLimiter(options: RateLimiterOptions) {
  const {
    windowMs,
    maxRequests,
    message,
    keyPrefix = 'rl',
    maxTrackedKeys = 10_000
  } = options;

  const buckets = new Map<string, RateBucket>();

  const pruneExpired = (now: number) => {
    if (buckets.size < maxTrackedKeys) return;
    for (const [k, b] of buckets.entries()) {
      if (b.resetAt <= now) {
        buckets.delete(k);
      }
    }
    // Hard cap safeguard against IP-spray memory exhaustion
    if (buckets.size >= maxTrackedKeys) {
      const oldestKeys = Array.from(buckets.keys()).slice(0, Math.floor(maxTrackedKeys / 4));
      for (const k of oldestKeys) buckets.delete(k);
    }
  };

  const check = (clientKey: string, now: number = Date.now()): {
    allowed: boolean;
    remaining: number;
    retryAfterSec: number;
  } => {
    pruneExpired(now);
    const fullKey = `${keyPrefix}:${clientKey}`;
    const existing = buckets.get(fullKey);

    if (!existing || existing.resetAt <= now) {
      buckets.set(fullKey, { count: 1, resetAt: now + windowMs });
      return {
        allowed: true,
        remaining: Math.max(0, maxRequests - 1),
        retryAfterSec: Math.ceil(windowMs / 1000)
      };
    }

    existing.count += 1;
    const retryAfterSec = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    if (existing.count > maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        retryAfterSec
      };
    }

    return {
      allowed: true,
      remaining: Math.max(0, maxRequests - existing.count),
      retryAfterSec
    };
  };

  const reset = (clientKey: string) => {
    buckets.delete(`${keyPrefix}:${clientKey}`);
  };

  const middleware: express.RequestHandler = (req, res, next) => {
    const ip = getClientIp(req);
    const result = check(ip);
    res.setHeader('RateLimit-Limit', String(maxRequests));
    res.setHeader('RateLimit-Remaining', String(result.remaining));
    if (!result.allowed) {
      res.setHeader('Retry-After', String(result.retryAfterSec));
      return res.status(429).json({
        success: false,
        authenticated: false,
        error: message,
        retryAfterSeconds: result.retryAfterSec
      });
    }
    next();
  };

  return { middleware, check, reset };
}

/**
 * Resolves whether an incoming `Origin` header is explicitly trusted for credentialed CORS.
 * Rejects `null`, wildcard patterns, and untrusted third-party origins.
 */
export function resolveAllowedCorsOrigin(
  rawOrigin: string | undefined,
  requestHostHeader: string | undefined,
  extraAllowedOriginsEnv: string | undefined = process.env.CORS_ALLOWED_ORIGINS,
  appUrlEnv: string | undefined = process.env.APP_URL
): string | null {
  if (!rawOrigin || typeof rawOrigin !== 'string') return null;

  const sanitizedOrigin = rawOrigin.replace(/[\r\n]/g, '').trim();
  if (!sanitizedOrigin || sanitizedOrigin.toLowerCase() === 'null') {
    return null;
  }

  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(sanitizedOrigin);
  } catch {
    return null;
  }

  if (parsedOrigin.protocol !== 'https:' && parsedOrigin.protocol !== 'http:') {
    return null;
  }

  const originHostname = parsedOrigin.hostname.toLowerCase();
  const originHostWithPort = parsedOrigin.host.toLowerCase();

  // 1. Exact same-host match (honoring X-Forwarded-Host or Host)
  const reqHostRaw = String(requestHostHeader || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const reqHostname = reqHostRaw.split(':')[0];

  if (reqHostRaw && (originHostWithPort === reqHostRaw || originHostname === reqHostname)) {
    return parsedOrigin.origin;
  }

  // 2. Local development loopback ONLY when the server itself is reached via loopback
  const isReqLocal = reqHostname === 'localhost' || reqHostname === '127.0.0.1';
  const isOriginLocal = originHostname === 'localhost' || originHostname === '127.0.0.1';
  if (isReqLocal && isOriginLocal) {
    return parsedOrigin.origin;
  }

  // 3. Explicit allowlist via CORS_ALLOWED_ORIGINS + APP_URL
  const explicitAllowed = new Set<string>();
  const addConfigured = (raw: string | undefined) => {
    if (!raw) return;
    for (const part of raw.split(',')) {
      const candidate = part.trim();
      if (!candidate) continue;
      try {
        const u = new URL(candidate);
        if (u.protocol === 'https:' || u.protocol === 'http:') {
          explicitAllowed.add(u.origin);
        }
      } catch {
        // Ignore malformed configured origin
      }
    }
  };
  addConfigured(extraAllowedOriginsEnv);
  addConfigured(appUrlEnv);

  if (explicitAllowed.has(parsedOrigin.origin)) {
    return parsedOrigin.origin;
  }

  return null;
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * Validates CSRF protection for state-changing requests.
 * - Requests authenticated via explicit `Authorization: Bearer` header are inherently CSRF-safe.
 * - Requests authenticated via browser cookies must provide either a trusted same-origin `Origin`
 *   or a non-simple custom header (`X-Requested-With`).
 */
export function isCsrfSafeRequest(params: {
  method: string;
  hasBearerAuth: boolean;
  hasCookieAuth: boolean;
  origin?: string;
  requestHost?: string;
  xRequestedWith?: string;
  extraAllowedOriginsEnv?: string;
  appUrlEnv?: string;
}): boolean {
  const method = (params.method || 'GET').toUpperCase();
  if (!MUTATING_METHODS.has(method)) return true;
  if (params.hasBearerAuth) return true;
  if (!params.hasCookieAuth) return true;

  const hasCustomHeader =
    typeof params.xRequestedWith === 'string' && params.xRequestedWith.trim().length > 0;
  const allowedOrigin = resolveAllowedCorsOrigin(
    params.origin,
    params.requestHost,
    params.extraAllowedOriginsEnv,
    params.appUrlEnv
  );

  // If Origin is present, it MUST be an allowed origin (even if custom header is set)
  if (params.origin && !allowedOrigin) {
    return false;
  }

  return Boolean(allowedOrigin || hasCustomHeader);
}

/**
 * Strictly validates a hex CSS color string before interpolating into SVG/HTML strings.
 */
export function sanitizeHexColor(color: unknown, fallback: string = '#3b82f6'): string {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/.test(trimmed)
    ? trimmed
    : fallback;
}
