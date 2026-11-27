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
  appUrlEnv: string | undefined = process.env.APP_URL,
  requestProtocol?: 'http' | 'https'
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

  // 1. Exact host+port (+ optional protocol) match
  const reqHostRaw = String(requestHostHeader || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const effectiveProto =
    requestProtocol === 'https' || requestProtocol === 'http'
      ? `${requestProtocol}:`
      : null;
  const defaultPort = parsedOrigin.protocol === 'https:' ? ':443' : ':80';
  const normalizedReqHost = reqHostRaw.endsWith(defaultPort)
    ? reqHostRaw.slice(0, -defaultPort.length)
    : reqHostRaw;
  const reqHostname = normalizedReqHost.split(':')[0];
  // Allow HTTPS origins to match internal HTTP backends (e.g. TLS-terminating reverse proxy),
  // while still blocking HTTP origin downgrades when the server already sees HTTPS.
  const protoMatches =
    !effectiveProto ||
    parsedOrigin.protocol === effectiveProto ||
    (effectiveProto === 'http:' && parsedOrigin.protocol === 'https:');

  if (normalizedReqHost && protoMatches && originHostWithPort === normalizedReqHost) {
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
  requestProtocol?: 'http' | 'https';
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
    params.appUrlEnv,
    params.requestProtocol
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

/**
 * Masks raw internal exception messages in production responses to prevent leaking
 * database paths, upstream URLs, or runtime internals.
 */
export function getSafeApiErrorMessage(
  err: unknown,
  fallback: string,
  isProduction: boolean = process.env.NODE_ENV === 'production'
): string {
  if (isProduction) return fallback;
  const msg =
    err && typeof err === 'object' && 'message' in err && typeof (err as { message?: unknown }).message === 'string'
      ? (err as { message: string }).message.trim()
      : '';
  return msg || fallback;
}

/**
 * Strictly validates and normalizes a Garmin activity ID before using it in API URLs or filenames.
 */
export function sanitizeGarminActivityId(rawId: unknown): string | null {
  if (typeof rawId !== 'string' && typeof rawId !== 'number') return null;
  const cleaned = String(rawId).trim().replace(/^garmin-act-/, '');
  if (!cleaned || cleaned.includes('..') || !/^[A-Za-z0-9._-]{1,64}$/.test(cleaned)) {
    return null;
  }
  return cleaned;
}

const AI_STUDIO_PREVIEW_HOST_REGEX =
  /(?:^|\.)ais-(?:dev|pre)-[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app(?::\d+)?$/i;
const AI_STUDIO_FRAME_ANCESTORS =
  "'self' https://aistudio.google.com https://ai.studio https://*.ai.studio https://*.google.com https://*.usercontent.goog https://*.googleusercontent.com https://*.gstatic.com";

/**
 * Resolves the Content-Security-Policy `frame-ancestors` directive and whether to emit
 * `X-Frame-Options: SAMEORIGIN`.
 * - Honors an explicit `FRAME_ANCESTORS` env var when configured.
 * - Automatically allows Google AI Studio iframe ancestors on AI Studio preview/shared hosts
 *   so Firefox/Chrome do not block the embedded preview while keeping clickjacking protection.
 * - Defaults strictly to `'self'` + `X-Frame-Options: SAMEORIGIN` for self-hosted deployments.
 */
export function resolveFrameAncestorsHeader(params: {
  frameAncestorsEnv?: string;
  requestHost?: string;
  appUrlEnv?: string;
  isAiStudioNginx?: boolean;
}): { frameAncestors: string; includeXFrameOptionsSameOrigin: boolean } {
  const custom = (params.frameAncestorsEnv || '').replace(/[\r\n;]/g, '').trim();
  if (custom) {
    return {
      frameAncestors: custom,
      includeXFrameOptionsSameOrigin: custom === "'self'"
    };
  }

  const reqHost = String(params.requestHost || '').split(',')[0].trim().toLowerCase();
  let appUrlHost = '';
  if (params.appUrlEnv) {
    try {
      appUrlHost = new URL(params.appUrlEnv).host.toLowerCase();
    } catch {
      appUrlHost = '';
    }
  }

  const isAiStudioPreview =
    Boolean(params.isAiStudioNginx) ||
    AI_STUDIO_PREVIEW_HOST_REGEX.test(reqHost) ||
    AI_STUDIO_PREVIEW_HOST_REGEX.test(appUrlHost);

  if (isAiStudioPreview) {
    return {
      frameAncestors: AI_STUDIO_FRAME_ANCESTORS,
      includeXFrameOptionsSameOrigin: false
    };
  }

  return {
    frameAncestors: "'self'",
    includeXFrameOptionsSameOrigin: true
  };
}

