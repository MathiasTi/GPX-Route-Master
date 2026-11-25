import type { GPXTrack, TextMarker } from '../types';
import { sanitizeHexColor } from './securityMiddleware';

const ALLOWED_NAMED_MARKER_COLORS = new Set(['indigo', 'emerald', 'rose', 'amber', 'slate']);
const FORBIDDEN_OBJECT_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

// Dangerous container elements whose inner content should be stripped completely
const DANGEROUS_BLOCK_REGEX =
  /<\s*(script|style|iframe|object|embed|svg|math|template|noscript)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi;

// Standalone/unclosed dangerous tags (without consuming subsequent benign text)
const DANGEROUS_STANDALONE_TAG_REGEX =
  /<\s*\/?\s*(?:script|style|iframe|object|embed|svg|math|template|noscript)\b[^>]*>/gi;

// Generic HTML/XML tags (opening, closing, self-closing, comments, processing instructions)
const HTML_TAG_REGEX = /<!--[\s\S]*?-->|<\/?[a-zA-Z!?][^>]*>/g;

// Unclosed tag fragment at end of string (e.g. "<img src=x onerror=alert(1)")
const UNCLOSED_TAG_FRAGMENT_REGEX = /<[a-zA-Z!?][^>]*$/g;

// Dangerous URI schemes (including whitespace/control-char obfuscation)
const DANGEROUS_PROTOCOL_REGEX =
  /(?:(?:java\s*script|vb\s*script)\s*:|data\s*:\s*(?:text\/html|image\/svg\+xml|application\/xhtml\+xml)(?:\s*[,;])?)/gi;

// Inline DOM event handler attribute payloads (e.g. onclick=, onerror=, onload=)
const INLINE_EVENT_HANDLER_REGEX = /\bon[a-z]{2,24}\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>"'<&]+)/gi;

// ASCII control chars excluding tab/newline/CR (and NUL bytes)
const CONTROL_CHAR_REGEX = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

// Encoded script/event patterns used in GPX upload pre-check inspection
const PRECHECK_XSS_PATTERNS: RegExp[] = [
  /<\s*script\b/i,
  /<\s*\/\s*script\s*>/i,
  /<\s*(?:iframe|object|embed|svg|math)\b/i,
  /<\s*(?:img|body|input|details|marquee|video|audio|a|div|span|style|link|meta)\b[^>]*\bon[a-z]{2,24}\s*=/i,
  /\bon(?:error|load|click|mouseover|mouseenter|focus|blur|animationstart|toggle|pointerover)\s*=\s*(?:"|'|[^\s>])/i,
  /(?:java\s*script|vb\s*script)\s*:/i,
  /data\s*:\s*(?:text\/html|image\/svg\+xml|application\/xhtml\+xml)/i,
  /(?:&lt;|&#0*60;|&#x0*3c;)\s*(?:script|iframe|svg|img|object|embed)\b/i
];

export interface GpxUploadPreCheckResult {
  isSafe: boolean;
  blocked: boolean;
  hasUnsafeMarkup: boolean;
  error?: string;
  warning?: string;
  sanitizedXml?: string;
}

/**
 * Strips HTML/script payloads, inline event handlers, dangerous URI schemes,
 * and raw angle brackets from untrusted text while preserving normal UTF-8 punctuation.
 */
export function sanitizePlainText(input: unknown, maxLength: number = 500): string {
  if (input === null || input === undefined) return '';
  let text = String(input).replace(CONTROL_CHAR_REGEX, '');

  // Iteratively strip nested/obfuscated tags until stable (bounded to 8 passes)
  for (let pass = 0; pass < 8; pass++) {
    const before = text;
    text = text
      .replace(DANGEROUS_BLOCK_REGEX, '')
      .replace(DANGEROUS_STANDALONE_TAG_REGEX, '')
      .replace(HTML_TAG_REGEX, '')
      .replace(UNCLOSED_TAG_FRAGMENT_REGEX, '')
      .replace(INLINE_EVENT_HANDLER_REGEX, '')
      .replace(DANGEROUS_PROTOCOL_REGEX, '');
    if (text === before) break;
  }

  // Remove any leftover angle brackets so concatenated strings can never form HTML tags
  text = text.replace(/[<>]/g, '');

  // Collapse repeated horizontal whitespace and trim
  text = text.replace(/[ \t]{2,}/g, ' ').trim();

  if (maxLength > 0 && text.length > maxLength) {
    text = text.slice(0, maxLength).trim();
  }

  return text;
}

/**
 * Checks whether a string contains HTML/script markup, inline event handlers,
 * or dangerous URI schemes that require sanitization.
 */
export function containsUnsafeMarkup(input: unknown): boolean {
  if (typeof input !== 'string' || !input) return false;
  if (CONTROL_CHAR_REGEX.test(input)) return true;
  if (DANGEROUS_PROTOCOL_REGEX.test(input)) {
    DANGEROUS_PROTOCOL_REGEX.lastIndex = 0;
    return true;
  }
  DANGEROUS_PROTOCOL_REGEX.lastIndex = 0;

  if (INLINE_EVENT_HANDLER_REGEX.test(input)) {
    INLINE_EVENT_HANDLER_REGEX.lastIndex = 0;
    return true;
  }
  INLINE_EVENT_HANDLER_REGEX.lastIndex = 0;

  for (const rx of PRECHECK_XSS_PATTERNS) {
    if (rx.test(input)) return true;
  }

  if (HTML_TAG_REGEX.test(input)) {
    HTML_TAG_REGEX.lastIndex = 0;
    return true;
  }
  HTML_TAG_REGEX.lastIndex = 0;

  return input.includes('<') || input.includes('>');
}

/**
 * Validates and sanitizes an optional external URL stored inside track metadata
 * (e.g. Komoot source URLs), allowing only http:// and https:// URLs.
 */
export function sanitizeSafeHttpUrl(input: unknown, maxLength: number = 1024): string {
  if (typeof input !== 'string') return '';
  const cleaned = input.replace(CONTROL_CHAR_REGEX, '').trim();
  if (!cleaned) return '';
  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    const serialized = parsed.toString();
    if (serialized.includes('<') || serialized.includes('>')) {
      return '';
    }
    return serialized.slice(0, maxLength);
  } catch {
    return '';
  }
}

/**
 * Recursively sanitizes arbitrary nested track metadata objects and arrays.
 * Preserves numbers, booleans, Dates, and valid http(s) URLs in URL fields,
 * drops prototype-polluting keys, and sanitizes all string leaves.
 */
export function sanitizeMetadataRecursive<T>(
  value: T,
  options?: { maxDepth?: number; maxStringLength?: number; keyHint?: string; _depth?: number; _seen?: WeakSet<object> }
): T {
  const maxDepth = options?.maxDepth ?? 10;
  const maxStringLength = options?.maxStringLength ?? 500;
  const depth = options?._depth ?? 0;
  const seen = options?._seen ?? new WeakSet<object>();

  if (value === null || value === undefined) return value;

  if (typeof value === 'string') {
    const keyHint = (options?.keyHint || '').toLowerCase();
    if (keyHint === 'sourceurl' || keyHint === 'komootcollectionurl' || keyHint.endsWith('url')) {
      return sanitizeSafeHttpUrl(value, 1024) as unknown as T;
    }
    const fieldMaxLen =
      keyHint === 'description' || keyHint === 'desc' || keyHint === 'note'
        ? Math.max(maxStringLength, 4000)
        : maxStringLength;
    return sanitizePlainText(value, fieldMaxLen) as unknown as T;
  }

  if (typeof value !== 'object') {
    return value;
  }

  if (value instanceof Date) {
    return new Date(value.getTime()) as unknown as T;
  }

  if (depth >= maxDepth || seen.has(value as object)) {
    return (Array.isArray(value) ? [] : {}) as unknown as T;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) =>
      sanitizeMetadataRecursive(item, {
        maxDepth,
        maxStringLength,
        keyHint: options?.keyHint,
        _depth: depth + 1,
        _seen: seen
      })
    ) as unknown as T;
  }

  const out: Record<string, unknown> = {};
  for (const [rawKey, rawVal] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_OBJECT_KEYS.has(rawKey)) continue;
    const safeKey = sanitizePlainText(rawKey, 128);
    if (!safeKey || FORBIDDEN_OBJECT_KEYS.has(safeKey)) continue;
    out[safeKey] = sanitizeMetadataRecursive(rawVal, {
      maxDepth,
      maxStringLength,
      keyHint: safeKey,
      _depth: depth + 1,
      _seen: seen
    });
  }
  return out as T;
}

/**
 * Recursively detects whether any string leaf inside a metadata object/array contains unsafe markup.
 */
export function hasUnsafeMetadataRecursive(
  value: unknown,
  options?: { maxDepth?: number; keyHint?: string; _depth?: number; _seen?: WeakSet<object> }
): boolean {
  const maxDepth = options?.maxDepth ?? 10;
  const depth = options?._depth ?? 0;
  const seen = options?._seen ?? new WeakSet<object>();

  if (value === null || value === undefined) return false;

  if (typeof value === 'string') {
    const keyHint = (options?.keyHint || '').toLowerCase();
    if (keyHint === 'sourceurl' || keyHint === 'komootcollectionurl' || keyHint.endsWith('url')) {
      const trimmed = value.trim();
      if (!trimmed) return false;
      return sanitizeSafeHttpUrl(trimmed) === '';
    }
    return containsUnsafeMarkup(value);
  }

  if (typeof value !== 'object' || value instanceof Date) return false;
  if (depth >= maxDepth || seen.has(value as object)) return false;
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.some((item) =>
      hasUnsafeMetadataRecursive(item, {
        maxDepth,
        keyHint: options?.keyHint,
        _depth: depth + 1,
        _seen: seen
      })
    );
  }

  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN_OBJECT_KEYS.has(k) || containsUnsafeMarkup(k)) return true;
    if (
      hasUnsafeMetadataRecursive(v, {
        maxDepth,
        keyHint: k,
        _depth: depth + 1,
        _seen: seen
      })
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Validates and sanitizes a TextMarker color (supports named palette keys or strict hex codes).
 */
export function sanitizeMarkerColor(color: unknown, fallback: string = 'indigo'): string {
  if (typeof color !== 'string') return fallback;
  const trimmed = color.trim();
  const lower = trimmed.toLowerCase();
  if (ALLOWED_NAMED_MARKER_COLORS.has(lower)) {
    return lower;
  }
  if (trimmed.startsWith('#')) {
    return sanitizeHexColor(trimmed, '#3b82f6');
  }
  return fallback;
}

/**
 * Sanitizes a single user-defined TextMarker (label, color, id, trackId, coordinates).
 */
export function sanitizeTextMarker(marker: TextMarker): TextMarker {
  const cleanLabel = sanitizePlainText(marker.label, 120) || 'Marker';
  const cleanId =
    sanitizePlainText(marker.id, 128).replace(/[^\w\-.:]/g, '') ||
    `marker-${Date.now()}`;
  const cleanColor = sanitizeMarkerColor(marker.color, 'indigo');
  const cleanTrackId =
    typeof marker.trackId === 'string' && marker.trackId.trim()
      ? sanitizePlainText(marker.trackId, 128)
      : undefined;
  const lat = Number(marker.lat);
  const lng = Number(marker.lng);
  const safeLat = Number.isFinite(lat) ? Math.max(-90, Math.min(90, lat)) : 0;
  const safeLng = Number.isFinite(lng) ? Math.max(-180, Math.min(180, lng)) : 0;
  const safeDist =
    typeof marker.distanceAlongTrack === 'number' &&
    Number.isFinite(marker.distanceAlongTrack) &&
    marker.distanceAlongTrack >= 0
      ? marker.distanceAlongTrack
      : undefined;

  return {
    id: cleanId,
    lat: safeLat,
    lng: safeLng,
    label: cleanLabel,
    color: cleanColor,
    ...(cleanTrackId ? { trackId: cleanTrackId } : {}),
    ...(safeDist !== undefined ? { distanceAlongTrack: safeDist } : {})
  };
}

/**
 * Sanitizes an untrusted array of saved TextMarker objects (from localStorage, API settings, or imports).
 */
export function sanitizeTextMarkers(rawMarkers: unknown, maxCount: number = 500): TextMarker[] {
  if (!Array.isArray(rawMarkers)) return [];
  const out: TextMarker[] = [];
  for (const item of rawMarkers) {
    if (out.length >= maxCount) break;
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Partial<TextMarker>;
    const lat = Number(candidate.lat);
    const lng = Number(candidate.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || lat < -90 || lat > 90 || lng < -180 || lng > 180) {
      continue;
    }
    out.push(
      sanitizeTextMarker({
        id: typeof candidate.id === 'string' && candidate.id.trim() ? candidate.id : `marker-${out.length + 1}`,
        lat,
        lng,
        label: typeof candidate.label === 'string' ? candidate.label : 'Marker',
        color: typeof candidate.color === 'string' ? candidate.color : 'indigo',
        trackId: candidate.trackId,
        distanceAlongTrack: candidate.distanceAlongTrack
      })
    );
  }
  return out;
}

/**
 * Recursively sanitizes all user-controlled metadata fields on a GPXTrack
 * (name, description, tags, tourGroup, originalFilename, color, surfaceStats,
 * routeManeuvers, point surface tags, and nested rawFileDetails / rawRecords).
 */
export function sanitizeTrackMetadata(track: GPXTrack): {
  track: GPXTrack;
  sanitizedFieldsCount: number;
} {
  if (!track || typeof track !== 'object') {
    return { track, sanitizedFieldsCount: 0 };
  }

  let sanitizedFieldsCount = 0;

  const cleanName = sanitizePlainText(track.name, 200) || 'Unbenannter Track';
  if (cleanName !== (track.name || '')) sanitizedFieldsCount++;

  const cleanDescription =
    track.description !== undefined ? sanitizePlainText(track.description, 4000) : undefined;
  if (track.description !== undefined && cleanDescription !== track.description) sanitizedFieldsCount++;

  const cleanTourGroup =
    track.tourGroup !== undefined ? sanitizePlainText(track.tourGroup, 120) : undefined;
  if (track.tourGroup !== undefined && cleanTourGroup !== track.tourGroup) sanitizedFieldsCount++;

  const cleanOriginalFilename =
    track.originalFilename !== undefined ? sanitizePlainText(track.originalFilename, 255) : undefined;
  if (track.originalFilename !== undefined && cleanOriginalFilename !== track.originalFilename) {
    sanitizedFieldsCount++;
  }

  const cleanColor = sanitizeHexColor(track.color, '#3b82f6');
  if (cleanColor !== track.color) sanitizedFieldsCount++;

  const cleanTags = Array.isArray(track.tags)
    ? track.tags
        .map((t) => sanitizePlainText(t, 64))
        .filter((t) => t.length > 0)
    : track.tags;
  if (
    Array.isArray(track.tags) &&
    Array.isArray(cleanTags) &&
    (cleanTags.length !== track.tags.length || cleanTags.some((t, i) => t !== track.tags![i]))
  ) {
    sanitizedFieldsCount++;
  }

  const cleanSurfaceStats = Array.isArray(track.surfaceStats)
    ? track.surfaceStats.map((seg) => {
        const cleanType = sanitizePlainText(seg.type, 80) || 'Unbekannt';
        if (cleanType !== seg.type) sanitizedFieldsCount++;
        return { ...seg, type: cleanType };
      })
    : track.surfaceStats;

  const cleanManeuvers = Array.isArray(track.routeManeuvers)
    ? track.routeManeuvers.map((cue) => {
        const cleanInstruction = sanitizePlainText(cue.instruction, 240);
        const cleanStreet =
          cue.streetName !== undefined ? sanitizePlainText(cue.streetName, 160) : undefined;
        if (cleanInstruction !== cue.instruction || cleanStreet !== cue.streetName) {
          sanitizedFieldsCount++;
        }
        return {
          ...cue,
          instruction: cleanInstruction,
          ...(cleanStreet !== undefined ? { streetName: cleanStreet } : {})
        };
      })
    : track.routeManeuvers;

  let pointsModified = false;
  const cleanPoints = Array.isArray(track.points)
    ? track.points.map((pt) => {
        if (typeof pt.surface === 'string') {
          const cleanSurface = sanitizePlainText(pt.surface, 80);
          if (cleanSurface !== pt.surface) {
            pointsModified = true;
            return { ...pt, surface: cleanSurface || undefined };
          }
        }
        return pt;
      })
    : track.points;
  if (pointsModified) sanitizedFieldsCount++;

  let cleanRawFileDetails = track.rawFileDetails;
  if (track.rawFileDetails && typeof track.rawFileDetails === 'object') {
    const beforeUnsafe = hasUnsafeMetadataRecursive(track.rawFileDetails);
    cleanRawFileDetails = sanitizeMetadataRecursive(track.rawFileDetails, {
      maxDepth: 10,
      maxStringLength: 500
    });
    if (beforeUnsafe) sanitizedFieldsCount++;
  }

  return {
    track: {
      ...track,
      name: cleanName,
      color: cleanColor,
      points: cleanPoints,
      ...(cleanDescription !== undefined ? { description: cleanDescription } : {}),
      ...(cleanTourGroup !== undefined ? { tourGroup: cleanTourGroup } : {}),
      ...(cleanOriginalFilename !== undefined ? { originalFilename: cleanOriginalFilename } : {}),
      ...(cleanTags !== undefined ? { tags: cleanTags } : {}),
      ...(cleanSurfaceStats !== undefined ? { surfaceStats: cleanSurfaceStats } : {}),
      ...(cleanManeuvers !== undefined ? { routeManeuvers: cleanManeuvers } : {}),
      ...(cleanRawFileDetails !== undefined ? { rawFileDetails: cleanRawFileDetails } : {})
    },
    sanitizedFieldsCount
  };
}

/**
 * Checks whether a GPXTrack or any associated TextMarkers contain unsafe HTML/XSS markup.
 */
export function detectUnsafeTrackAndMarkerMetadata(
  track: GPXTrack,
  textMarkers: TextMarker[] = []
): { count: number; fields: string[] } {
  const fields: string[] = [];

  if (containsUnsafeMarkup(track.name)) fields.push('name');
  if (containsUnsafeMarkup(track.description)) fields.push('description');
  if (containsUnsafeMarkup(track.tourGroup)) fields.push('tourGroup');
  if (containsUnsafeMarkup(track.originalFilename)) fields.push('originalFilename');
  if (typeof track.color === 'string' && sanitizeHexColor(track.color, '') === '') {
    fields.push('color');
  }
  if (Array.isArray(track.tags) && track.tags.some((t) => containsUnsafeMarkup(t))) {
    fields.push('tags');
  }
  if (Array.isArray(track.surfaceStats) && track.surfaceStats.some((s) => containsUnsafeMarkup(s.type))) {
    fields.push('surfaceStats');
  }
  if (
    Array.isArray(track.routeManeuvers) &&
    track.routeManeuvers.some(
      (c) => containsUnsafeMarkup(c.instruction) || containsUnsafeMarkup(c.streetName)
    )
  ) {
    fields.push('routeManeuvers');
  }
  if (Array.isArray(track.points) && track.points.some((p) => containsUnsafeMarkup(p.surface))) {
    fields.push('points.surface');
  }
  if (track.rawFileDetails && hasUnsafeMetadataRecursive(track.rawFileDetails)) {
    fields.push('rawFileDetails');
  }

  for (const m of textMarkers) {
    if (
      containsUnsafeMarkup(m.label) ||
      (m.trackId && containsUnsafeMarkup(m.trackId)) ||
      sanitizeMarkerColor(m.color, '__invalid__') === '__invalid__'
    ) {
      fields.push(`textMarker:${m.id}`);
    }
  }

  return { count: fields.length, fields };
}

/**
 * Runs security pre-check on raw GPX XML text prior to DOM/stream parsing.
 * - Hard-blocks DOCTYPE / ENTITY / SYSTEM directives (XXE/Billion-Laughs protection).
 * - Detects and strips active HTML/script/event-handler payloads inside GPX metadata and waypoint tags.
 */
export function preCheckGpxUploadContent(rawXml: string): GpxUploadPreCheckResult {
  if (typeof rawXml !== 'string') {
    return {
      isSafe: false,
      blocked: true,
      hasUnsafeMarkup: false,
      error: 'Ungültiger GPX-Inhalt.'
    };
  }

  const lower = rawXml.toLowerCase();
  if (lower.includes('<!entity') || lower.includes('<!doctype') || lower.includes('<!system')) {
    return {
      isSafe: false,
      blocked: true,
      hasUnsafeMarkup: true,
      error:
        'Sicherheitsfehler: Benutzerdefinierte DOCTYPE- oder ENTITY-Definitionen sind im GPX nicht erlaubt.'
    };
  }

  const hasUnsafeMarkup = PRECHECK_XSS_PATTERNS.some((rx) => rx.test(rawXml));
  if (!hasUnsafeMarkup) {
    return {
      isSafe: true,
      blocked: false,
      hasUnsafeMarkup: false,
      sanitizedXml: rawXml
    };
  }

  // Neutralize dangerous active blocks & inline handlers inside text/CDATA sections
  // while keeping valid GPX XML structure intact for downstream recursive metadata sanitization.
  let sanitizedXml = rawXml;
  for (let pass = 0; pass < 6; pass++) {
    const before = sanitizedXml;
    sanitizedXml = sanitizedXml
      .replace(DANGEROUS_BLOCK_REGEX, '')
      .replace(DANGEROUS_STANDALONE_TAG_REGEX, '')
      .replace(
        /(?:&lt;|&#0*60;|&#x0*3c;)\s*\/?\s*(?:script|iframe|svg|img|object|embed)\b[^&<>]*(?:&gt;|&#0*62;|&#x0*3e;)?/gi,
        ''
      )
      .replace(INLINE_EVENT_HANDLER_REGEX, '')
      .replace(DANGEROUS_PROTOCOL_REGEX, '');
    if (sanitizedXml === before) break;
  }

  return {
    isSafe: true,
    blocked: false,
    hasUnsafeMarkup: true,
    warning:
      'Potenziell unsichere HTML-/Skript-Inhalte in den GPX-Metadaten wurden automatisch bereinigt.',
    sanitizedXml
  };
}
