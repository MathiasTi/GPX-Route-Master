import dns from 'dns/promises';
import net from 'net';
import { computeCanonicalTrackContentHash } from './komootVersioning';

const MAX_IMPORT_BYTES = 15 * 1024 * 1024; // 15 MB
const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 4;

export interface ImportedUrlGpxResult {
  kind?: 'track';
  gpxContent: string;
  suggestedName: string;
  activityType: 'cycling' | 'running';
  sourceType: 'komoot' | 'gpx';
  sourceUrl: string;
  pointCount: number;
  komootTourId?: string;
  komootShareToken?: string | null;
  contentHash: string;
  remoteUpdatedAt?: string;
}

export interface KomootCollectionTourStub {
  id: string;
  name: string;
  sport?: string;
  activityType: 'cycling' | 'running';
  distanceKm?: number;
  ascentM?: number;
  durationSec?: number;
  tourUrl: string;
  shareToken?: string | null;
}

export interface ImportedUrlCollectionResult {
  kind: 'collection';
  collectionId: string;
  title: string;
  sourceUrl: string;
  tours: KomootCollectionTourStub[];
}

export type ImportedUrlResult = (ImportedUrlGpxResult & { kind: 'track' }) | ImportedUrlCollectionResult;

export interface KomootTourRef {
  tourId: string;
  shareToken: string | null;
  canonicalUrl: string;
  apiTourUrl: string;
  apiCoordinatesUrl: string;
}

export interface KomootCollectionRef {
  collectionId: string;
  shareToken: string | null;
  canonicalUrl: string;
  apiContentsUrl: string;
}

export interface KomootCoordinatePoint {
  lat: number;
  lng: number;
  alt?: number;
  t?: number;
}

export interface ExtractedKomootTour {
  name: string;
  sport?: string;
  date?: string;
  changedAt?: string;
  coordinates: KomootCoordinatePoint[];
}

export class UrlImportError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 400) {
    super(message);
    this.name = 'UrlImportError';
    this.statusCode = statusCode;
  }
}

function parseIpv4ToInt(ip: string): number | null {
  const parts = ip.split('.');
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const num = Number(part);
    if (!Number.isInteger(num) || num < 0 || num > 255) return null;
    value = ((value << 8) | num) >>> 0;
  }
  return value;
}

function isBlockedIpv4(ip: string): boolean {
  const num = parseIpv4ToInt(ip);
  if (num === null) return true;

  const first = (num >>> 24) & 0xff;
  const second = (num >>> 16) & 0xff;
  const third = (num >>> 8) & 0xff;

  if (first === 0) return true; // 0.0.0.0/8
  if (first === 10) return true; // 10.0.0.0/8
  if (first === 100 && second >= 64 && second <= 127) return true; // 100.64.0.0/10 (CGNAT)
  if (first === 127) return true; // 127.0.0.0/8 (loopback)
  if (first === 169 && second === 254) return true; // 169.254.0.0/16 (link-local / cloud metadata)
  if (first === 172 && second >= 16 && second <= 31) return true; // 172.16.0.0/12
  if (first === 192 && second === 0 && (third === 0 || third === 2)) return true; // 192.0.0.0/24, 192.0.2.0/24
  if (first === 192 && second === 168) return true; // 192.168.0.0/16
  if (first === 198 && (second === 18 || second === 19)) return true; // 198.18.0.0/15
  if (first === 198 && second === 51 && third === 100) return true; // 198.51.100.0/24
  if (first === 203 && second === 0 && third === 113) return true; // 203.0.113.0/24
  if (first >= 224) return true; // Multicast & Reserved (224.0.0.0/4 + 240.0.0.0/4)

  return false;
}

function parseIpv6Hextets(cleanIp: string): number[] | null {
  const lower = cleanIp.toLowerCase();
  const doubleColonParts = lower.split('::');
  if (doubleColonParts.length > 2) return null;

  const parseSegment = (segment: string): number[] | null => {
    if (!segment) return [];
    const parts = segment.split(':');
    const result: number[] = [];
    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (part.includes('.')) {
        // Embedded IPv4 must appear only as the final element
        if (i !== parts.length - 1 || !net.isIPv4(part)) return null;
        const octets = part.split('.').map((o) => Number(o));
        if (octets.length !== 4 || octets.some((o) => !Number.isInteger(o) || o < 0 || o > 255)) {
          return null;
        }
        result.push((octets[0] << 8) | octets[1], (octets[2] << 8) | octets[3]);
      } else {
        if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
        result.push(parseInt(part, 16));
      }
    }
    return result;
  };

  if (doubleColonParts.length === 1) {
    const hextets = parseSegment(doubleColonParts[0]);
    return hextets && hextets.length === 8 ? hextets : null;
  }

  const head = parseSegment(doubleColonParts[0]);
  const tail = parseSegment(doubleColonParts[1]);
  if (!head || !tail) return null;
  const missing = 8 - (head.length + tail.length);
  if (missing < 1) return null;
  return [...head, ...new Array<number>(missing).fill(0), ...tail];
}

function hextetsToIpv4(hi: number, lo: number): string {
  return `${(hi >> 8) & 0xff}.${hi & 0xff}.${(lo >> 8) & 0xff}.${lo & 0xff}`;
}

export function isBlockedIpAddress(rawIp: string): boolean {
  const cleanIp = rawIp.trim().replace(/^\[|\]$/g, '').split('%')[0];
  const ipVersion = net.isIP(cleanIp);
  if (ipVersion === 4) {
    return isBlockedIpv4(cleanIp);
  }
  if (ipVersion === 6) {
    const h = parseIpv6Hextets(cleanIp);
    if (!h) return true;

    const firstFiveZero = h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0;
    const firstSixZero = firstFiveZero && h[5] === 0;

    // Unspecified (::) and Loopback (::1)
    if (firstSixZero && h[6] === 0 && (h[7] === 0 || h[7] === 1)) {
      return true;
    }

    // IPv4-mapped IPv6 (::ffff:0:0/96) — covers canonical & expanded forms
    if (firstFiveZero && h[5] === 0xffff) {
      return isBlockedIpv4(hextetsToIpv4(h[6], h[7]));
    }

    // IPv4-translated IPv6 (::ffff:0:0:0/96)
    if (h[0] === 0 && h[1] === 0 && h[2] === 0 && h[3] === 0 && h[4] === 0xffff && h[5] === 0) {
      return isBlockedIpv4(hextetsToIpv4(h[6], h[7]));
    }

    // Deprecated IPv4-compatible IPv6 (::/96)
    if (firstSixZero) {
      return isBlockedIpv4(hextetsToIpv4(h[6], h[7]));
    }

    // NAT64 well-known prefix (64:ff9b::/96)
    if (h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0 && h[3] === 0 && h[4] === 0 && h[5] === 0) {
      return isBlockedIpv4(hextetsToIpv4(h[6], h[7]));
    }

    // NAT64 local-use prefix (64:ff9b:1::/48)
    if (h[0] === 0x0064 && h[1] === 0xff9b && h[2] === 0x0001) {
      return true;
    }

    // 6to4 (2002::/16) — embeds IPv4 in hextets [1] and [2]
    if (h[0] === 0x2002) {
      return isBlockedIpv4(hextetsToIpv4(h[1], h[2]));
    }

    // Teredo tunneling (2001:0000::/32)
    if (h[0] === 0x2001 && h[1] === 0x0000) {
      return true;
    }

    // Discard-only (100::/64)
    if (h[0] === 0x0100 && h[1] === 0 && h[2] === 0 && h[3] === 0) {
      return true;
    }

    // Documentation (2001:db8::/32), Benchmarking (2001:2::/48), ORCHID (2001:10::/28, 2001:20::/28)
    if (h[0] === 0x2001) {
      if (h[1] === 0x0db8) return true;
      if (h[1] === 0x0002 && h[2] === 0) return true;
      if ((h[1] & 0xfff0) === 0x0010 || (h[1] & 0xfff0) === 0x0020) return true;
    }

    // fc00::/7 (Unique Local Addresses)
    if ((h[0] & 0xfe00) === 0xfc00) return true;
    // fe80::/10 (Link-local)
    if ((h[0] & 0xffc0) === 0xfe80) return true;
    // fec0::/10 (Deprecated Site-local)
    if ((h[0] & 0xffc0) === 0xfec0) return true;
    // ff00::/8 (Multicast)
    if ((h[0] & 0xff00) === 0xff00) return true;

    return false;
  }
  return true;
}

export type DnsLookupFn = (
  hostname: string
) => Promise<Array<{ address: string; family: number }>>;

const defaultDnsLookup: DnsLookupFn = async (hostname: string) => {
  return dns.lookup(hostname, { all: true });
};

export async function assertSafeExternalUrl(
  rawUrl: string,
  lookupFn: DnsLookupFn = defaultDnsLookup
): Promise<URL> {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    throw new UrlImportError('Bitte gib eine gültige URL ein.', 400);
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new UrlImportError('Ungültiges URL-Format. Erwartet wird http:// oder https://.', 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new UrlImportError('Nur http:// und https:// URLs sind erlaubt.', 400);
  }

  if (parsed.username || parsed.password) {
    throw new UrlImportError('URLs mit eingebetteten Zugangsdaten sind nicht erlaubt.', 400);
  }

  const hostname = parsed.hostname.replace(/^\[|\]$/g, '').replace(/\.+$/, '').toLowerCase();
  if (!hostname) {
    throw new UrlImportError('Ungültiger Hostname in der URL.', 400);
  }

  const blockedHostnames = [
    'localhost',
    'localhost.localdomain',
    'ip6-localhost',
    'ip6-loopback',
    'metadata.google.internal'
  ];
  if (
    blockedHostnames.includes(hostname) ||
    hostname.endsWith('.localhost') ||
    hostname.endsWith('.local') ||
    hostname.endsWith('.internal') ||
    hostname.endsWith('.home.arpa')
  ) {
    throw new UrlImportError('Lokale oder interne Netzwerkziele sind aus Sicherheitsgründen blockiert.', 403);
  }

  if (net.isIP(hostname) !== 0) {
    if (isBlockedIpAddress(hostname)) {
      throw new UrlImportError('Private oder reservierte IP-Adressen sind aus Sicherheitsgründen blockiert.', 403);
    }
    return parsed;
  }

  let resolved: Array<{ address: string; family: number }>;
  try {
    resolved = await lookupFn(hostname);
  } catch {
    throw new UrlImportError(`Hostname "${hostname}" konnte nicht aufgelöst werden.`, 422);
  }

  if (!Array.isArray(resolved) || resolved.length === 0) {
    throw new UrlImportError(`Keine IP-Adresse für "${hostname}" gefunden.`, 422);
  }

  for (const record of resolved) {
    if (isBlockedIpAddress(record.address)) {
      throw new UrlImportError('Ziel-Domain verweist auf eine private oder interne IP-Adresse.', 403);
    }
  }

  return parsed;
}

export function parseKomootTourUrl(rawUrl: string): KomootTourRef | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!/^(?:www\.|m\.)?komoot\.(?:com|de|fr|it|es|nl|org|at|ch|co\.uk)$/.test(host)) {
    return null;
  }

  const tourMatch = parsed.pathname.match(
    /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:tour|smarttour|invite-tour)\/(\d+)(?:\/.*)?$/i
  );
  if (!tourMatch || !tourMatch[1]) {
    return null;
  }

  const tourId = tourMatch[1];
  const shareTokenRaw = parsed.searchParams.get('share_token');
  const shareToken = shareTokenRaw && /^[A-Za-z0-9_-]{4,128}$/.test(shareTokenRaw) ? shareTokenRaw : null;
  const tokenQuery = shareToken ? `?share_token=${encodeURIComponent(shareToken)}` : '';

  return {
    tourId,
    shareToken,
    canonicalUrl: `https://www.komoot.com/tour/${tourId}${tokenQuery}`,
    apiTourUrl: `https://api.komoot.de/v007/tours/${tourId}${tokenQuery}`,
    apiCoordinatesUrl: `https://api.komoot.de/v007/tours/${tourId}/coordinates${tokenQuery}`
  };
}

export function parseKomootCollectionUrl(rawUrl: string): KomootCollectionRef | null {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl.trim());
  } catch {
    return null;
  }

  const host = parsed.hostname.toLowerCase();
  if (!/^(?:www\.|m\.)?komoot\.(?:com|de|fr|it|es|nl|org|at|ch|co\.uk)$/.test(host)) {
    return null;
  }

  const directMatch = parsed.pathname.match(
    /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?(?:collection|collections|kollektion)\/(\d+)(?:\/.*)?$/i
  );
  const userCollectionMatch = parsed.pathname.match(
    /^\/(?:[a-z]{2}(?:-[a-z]{2})?\/)?user\/[^/]+\/collections\/(\d+)(?:\/.*)?$/i
  );

  const collectionId = directMatch?.[1] || userCollectionMatch?.[1];
  if (!collectionId) {
    return null;
  }

  const shareTokenRaw = parsed.searchParams.get('share_token');
  const shareToken = shareTokenRaw && /^[A-Za-z0-9_-]{4,128}$/.test(shareTokenRaw) ? shareTokenRaw : null;
  const tokenQuery = shareToken ? `?share_token=${encodeURIComponent(shareToken)}` : '';

  return {
    collectionId,
    shareToken,
    canonicalUrl: `https://www.komoot.com/collection/${collectionId}${tokenQuery}`,
    apiContentsUrl: `https://api.komoot.de/v007/collections/${collectionId}/contents${tokenQuery}`
  };
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

export function mapKomootSportToActivityType(sport?: string): 'cycling' | 'running' {
  const s = String(sport || '').toLowerCase().trim();
  if (
    s.includes('jogging') ||
    s.includes('running') ||
    s.includes('trail') ||
    s.includes('hike') ||
    s.includes('hiking') ||
    s.includes('mountaineering') ||
    s.includes('walk')
  ) {
    return 'running';
  }
  return 'cycling';
}

function normalizeKomootCoordinates(rawItems: unknown): KomootCoordinatePoint[] {
  if (!Array.isArray(rawItems)) return [];
  const points: KomootCoordinatePoint[] = [];

  for (const raw of rawItems) {
    if (!raw || typeof raw !== 'object') continue;
    const rec = raw as Record<string, unknown>;
    const lat = Number(rec.lat ?? rec.latitude);
    const lng = Number(rec.lng ?? rec.lon ?? rec.longitude);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    if (Math.abs(lat) < 0.00001 && Math.abs(lng) < 0.00001) continue;

    const altRaw = rec.alt ?? rec.ele ?? rec.altitude;
    const alt = altRaw !== undefined && altRaw !== null && Number.isFinite(Number(altRaw))
      ? Number(altRaw)
      : undefined;

    const tRaw = rec.t ?? rec.timeOffset;
    const t = tRaw !== undefined && tRaw !== null && Number.isFinite(Number(tRaw))
      ? Number(tRaw)
      : undefined;

    points.push({ lat, lng, alt, t });
  }

  return points;
}

function findCoordinatesDeep(node: unknown, depth = 0): { items: unknown[]; parent?: Record<string, unknown> } | null {
  if (!node || typeof node !== 'object' || depth > 7) return null;
  if (Array.isArray(node)) {
    if (node.length >= 2) {
      const sample = node[0] as any;
      if (sample && typeof sample === 'object' && ('lat' in sample) && ('lng' in sample || 'lon' in sample)) {
        return { items: node };
      }
    }
    return null;
  }

  const obj = node as Record<string, unknown>;
  if (Array.isArray(obj.items) && obj.items.length >= 2) {
    const sample = obj.items[0] as any;
    if (sample && typeof sample === 'object' && ('lat' in sample) && ('lng' in sample || 'lon' in sample)) {
      return { items: obj.items, parent: obj };
    }
  }

  const prioritizedKeys = ['_embedded', 'coordinates', 'pageProps', 'tour', 'data'];
  for (const key of prioritizedKeys) {
    if (obj[key] && typeof obj[key] === 'object') {
      const found = findCoordinatesDeep(obj[key], depth + 1);
      if (found) return found;
    }
  }

  for (const [k, val] of Object.entries(obj)) {
    if (prioritizedKeys.includes(k)) continue;
    if (val && typeof val === 'object') {
      const found = findCoordinatesDeep(val, depth + 1);
      if (found) return found;
    }
  }

  return null;
}

export function decodeHtmlEntities(input: string): string {
  const named: Record<string, string> = {
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&apos;': "'",
    '&#39;': "'",
    '&nbsp;': ' ',
    '&auml;': 'ä',
    '&ouml;': 'ö',
    '&uuml;': 'ü',
    '&Auml;': 'Ä',
    '&Ouml;': 'Ö',
    '&Uuml;': 'Ü',
    '&szlig;': 'ß',
    '&ndash;': '–',
    '&mdash;': '—'
  };

  return input
    .replace(/&(amp|lt|gt|quot|apos|nbsp|auml|ouml|uuml|Auml|Ouml|Uuml|szlig|ndash|mdash|#39);/g, (m) => named[m] ?? m)
    .replace(/&#x([0-9a-f]+);/gi, (match, hex) => {
      const cp = parseInt(hex, 16);
      return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    })
    .replace(/&#(\d+);/g, (match, dec) => {
      const cp = parseInt(dec, 10);
      return Number.isInteger(cp) && cp >= 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : match;
    });
}

export function isGenericKomootTourName(name?: string | null, tourId?: string): boolean {
  const trimmed = String(name || '').trim();
  if (!trimmed) return true;
  if (/^komoot(?:\s+tour(?:\s+\d+)?)?$/i.test(trimmed)) return true;
  if (tourId && trimmed.toLowerCase() === `komoot tour ${tourId}`.toLowerCase()) return true;
  if (/^tour\s+#?\d+$/i.test(trimmed)) return true;
  return false;
}

export function cleanKomootTourTitle(rawTitle: string): string {
  const decoded = decodeHtmlEntities(String(rawTitle || '')).replace(/\s+/g, ' ').trim();
  if (!decoded) return '';

  const stripped = decoded
    .replace(/\s*\|\s*komoot\b.*$/i, '')
    .replace(/\s*[–—-]\s*komoot\b.*$/i, '')
    .replace(
      /\s*[|–—]\s*(?:rennrad|fahrrad|rad|mountainbike|mtb|gravel|e-bike|wander|berg|lauf|jogging|trail|bike|cycling|road|hiking|hike|running|tour|route)(?:[\s-][^|–—]*)?$/i,
      ''
    )
    .replace(/\s*\|\s*komoot\b.*$/i, '')
    .trim();

  if (!stripped || /^komoot$/i.test(stripped)) return '';
  return stripped;
}

function isLikelyUserOrCreatorObject(obj: Record<string, unknown>): boolean {
  return (
    'username' in obj ||
    'display_name' in obj ||
    'avatar' in obj ||
    obj.content_type === 'user' ||
    obj.type === 'user'
  );
}

function findTourMetadataDeep(
  node: unknown,
  depth = 0
): { name?: string; sport?: string; date?: string; changedAt?: string } {
  if (!node || typeof node !== 'object' || depth > 7) return {};
  const obj = node as Record<string, unknown>;

  if (!isLikelyUserOrCreatorObject(obj)) {
    const rawName = typeof obj.name === 'string' && obj.name.trim()
      ? obj.name.trim()
      : typeof obj.title === 'string' && obj.title.trim()
      ? obj.title.trim()
      : undefined;

    const hasTourMarker =
      typeof obj.sport === 'string' ||
      typeof obj.distance === 'number' ||
      typeof obj.elevation_up === 'number' ||
      typeof obj.duration === 'number' ||
      (typeof obj.type === 'string' && /tour|route/i.test(obj.type)) ||
      Array.isArray(obj.coordinates) ||
      Boolean((obj._embedded as Record<string, unknown> | undefined)?.coordinates);

    if (rawName && hasTourMarker) {
      const changedAtRaw = obj.changed_at ?? obj.updated_at ?? obj.date;
      return {
        name: cleanKomootTourTitle(rawName) || rawName,
        sport: typeof obj.sport === 'string' ? obj.sport : undefined,
        date: typeof obj.date === 'string' ? obj.date : undefined,
        changedAt: typeof changedAtRaw === 'string' ? changedAtRaw : undefined
      };
    }
  }

  for (const key of ['tour', 'pageProps', 'props', '_embedded', 'data', 'entity', 'route', 'smartTour', 'initialState']) {
    if (obj[key] && typeof obj[key] === 'object') {
      const res = findTourMetadataDeep(obj[key], depth + 1);
      if (res.name || res.sport) return res;
    }
  }

  return {};
}

function extractMetaTagContent(html: string, attrName: 'property' | 'name', attrValue: string): string | null {
  const escapedVal = attrValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patternA = new RegExp(
    `<meta[^>]+${attrName}=["']${escapedVal}["'][^>]+content=["']([^"']+)["']`,
    'i'
  );
  const patternB = new RegExp(
    `<meta[^>]+content=["']([^"']+)["'][^>]+${attrName}=["']${escapedVal}["']`,
    'i'
  );
  return html.match(patternA)?.[1] || html.match(patternB)?.[1] || null;
}

export function extractKomootTourTitleFromHtml(html: string, fallbackTourId?: string): string | null {
  const trimmed = String(html || '').trim();
  if (!trimmed) return null;

  // 1. kmtBoot.setProps JSON
  const kmtBootRegex = /kmtBoot\.setProps\(\s*("(?:[^"\\]|\\.)*"|\{[\s\S]*?\})\s*\)\s*;?/g;
  let bootMatch: RegExpExecArray | null;
  while ((bootMatch = kmtBootRegex.exec(trimmed)) !== null) {
    const candidate = tryParseJsonCandidate(bootMatch[1]);
    if (!candidate) continue;
    const meta = findTourMetadataDeep(candidate);
    if (meta.name && !isGenericKomootTourName(meta.name, fallbackTourId)) {
      return meta.name;
    }
  }

  // 2. JSON-LD structured data (<script type="application/ld+json">)
  const ldJsonRegex = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let ldMatch: RegExpExecArray | null;
  while ((ldMatch = ldJsonRegex.exec(trimmed)) !== null) {
    const parsed = tryParseJsonCandidate(ldMatch[1].trim());
    const nodes = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    for (const item of nodes) {
      if (!item || typeof item !== 'object') continue;
      const candidateName = cleanKomootTourTitle(String((item as any).name || (item as any).headline || ''));
      if (candidateName && !isGenericKomootTourName(candidateName, fallbackTourId)) {
        return candidateName;
      }
    }
  }

  // 3. OpenGraph / Twitter / <title> / <h1>
  const rawCandidates = [
    extractMetaTagContent(trimmed, 'property', 'og:title'),
    extractMetaTagContent(trimmed, 'name', 'twitter:title'),
    trimmed.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || null,
    trimmed.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i)?.[1]?.replace(/<[^>]+>/g, ' ') || null
  ];

  for (const raw of rawCandidates) {
    if (!raw) continue;
    const cleaned = cleanKomootTourTitle(raw);
    if (cleaned && !isGenericKomootTourName(cleaned, fallbackTourId)) {
      return cleaned;
    }
  }

  return null;
}

function tryParseJsonCandidate(raw: string): any | null {
  try {
    const first = JSON.parse(raw);
    if (typeof first === 'string') {
      try {
        return JSON.parse(first);
      } catch {
        return null;
      }
    }
    return first;
  } catch {
    return null;
  }
}

export function extractKomootTourFromPayload(
  payload: string | Record<string, unknown>,
  fallbackTourId = 'komoot'
): ExtractedKomootTour | null {
  if (typeof payload === 'object' && payload !== null) {
    const meta = findTourMetadataDeep(payload);
    const coordMatch = findCoordinatesDeep(payload);
    const coordinates = coordMatch ? normalizeKomootCoordinates(coordMatch.items) : [];
    if (coordinates.length >= 2) {
      return {
        name: meta.name || `Komoot Tour ${fallbackTourId}`,
        sport: meta.sport,
        date: meta.date,
        changedAt: meta.changedAt,
        coordinates
      };
    }
    return null;
  }

  const trimmed = String(payload || '').trim();
  if (!trimmed) return null;

  // Direct JSON response (e.g. from onlyprops or api.komoot.de)
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsedJson = tryParseJsonCandidate(trimmed);
    if (parsedJson) {
      return extractKomootTourFromPayload(parsedJson, fallbackTourId);
    }
  }

  // HTML page extraction strategies
  const bestMeta: { name?: string; sport?: string; date?: string; changedAt?: string } = {};

  const htmlTitle = extractKomootTourTitleFromHtml(trimmed, fallbackTourId);
  if (htmlTitle) {
    bestMeta.name = htmlTitle;
  }

  const pickBestName = (candidateName?: string): string => {
    if (candidateName && !isGenericKomootTourName(candidateName, fallbackTourId)) {
      return candidateName;
    }
    if (bestMeta.name && !isGenericKomootTourName(bestMeta.name, fallbackTourId)) {
      return bestMeta.name;
    }
    return `Komoot Tour ${fallbackTourId}`;
  };

  // Strategy 1: kmtBoot.setProps("...") or kmtBoot.setProps({...})
  const kmtBootRegex = /kmtBoot\.setProps\(\s*("(?:[^"\\]|\\.)*"|\{[\s\S]*?\})\s*\)\s*;?/g;
  let bootMatch: RegExpExecArray | null;
  while ((bootMatch = kmtBootRegex.exec(trimmed)) !== null) {
    const candidate = tryParseJsonCandidate(bootMatch[1]);
    if (!candidate) continue;
    const meta = findTourMetadataDeep(candidate);
    if (meta.name && !isGenericKomootTourName(meta.name, fallbackTourId)) bestMeta.name = meta.name;
    if (meta.sport) bestMeta.sport = meta.sport;
    if (meta.date) bestMeta.date = meta.date;
    if (meta.changedAt) bestMeta.changedAt = meta.changedAt;

    const coordMatch = findCoordinatesDeep(candidate);
    if (coordMatch) {
      const coordinates = normalizeKomootCoordinates(coordMatch.items);
      if (coordinates.length >= 2) {
        return {
          name: pickBestName(meta.name),
          sport: bestMeta.sport,
          date: bestMeta.date,
          changedAt: bestMeta.changedAt,
          coordinates
        };
      }
    }
  }

  // Strategy 2: <script id="__NEXT_DATA__" ...> or embedded JSON script blocks
  const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
  let scriptMatch: RegExpExecArray | null;
  while ((scriptMatch = scriptRegex.exec(trimmed)) !== null) {
    const body = scriptMatch[1].trim();
    if (!body.includes('"lat"') && !body.includes('coordinates')) continue;

    if (body.startsWith('{')) {
      const parsed = tryParseJsonCandidate(body);
      if (parsed) {
        const res = extractKomootTourFromPayload(parsed, fallbackTourId);
        if (res) {
          return {
            name: pickBestName(res.name),
            sport: res.sport || bestMeta.sport,
            date: res.date || bestMeta.date,
            changedAt: res.changedAt || bestMeta.changedAt,
            coordinates: res.coordinates
          };
        }
      }
    }

    // Strategy 3: Inline `"items":[{"lat":...,"lng":...}]` block inside JS assignment
    const itemsArrayMatch = body.match(/"coordinates"\s*:\s*\{\s*"items"\s*:\s*(\[\s*\{[\s\S]*?\}\s*\])/);
    if (itemsArrayMatch && itemsArrayMatch[1]) {
      const items = tryParseJsonCandidate(itemsArrayMatch[1]);
      const coordinates = normalizeKomootCoordinates(items);
      if (coordinates.length >= 2) {
        return {
          name: pickBestName(),
          sport: bestMeta.sport,
          date: bestMeta.date,
          coordinates
        };
      }
    }
  }

  return null;
}

function cleanKomootCollectionTitle(rawTitle: string, fallbackId: string): string {
  const cleaned = rawTitle
    .replace(/\s*\|\s*Komoot.*$/i, '')
    .replace(/\s*[-–|]\s*Collection\s+(?:von|by)\s+.*$/i, '')
    .replace(/\s*[-–]\s*Komoot.*$/i, '')
    .trim();
  return cleaned || `Komoot Collection ${fallbackId}`;
}

function normalizeKomootCollectionTourCandidate(
  raw: unknown,
  inheritedShareToken?: string | null
): KomootCollectionTourStub | null {
  if (!raw || typeof raw !== 'object') return null;
  const outer = raw as Record<string, unknown>;
  const embeddedOuter = outer._embedded as Record<string, unknown> | undefined;
  const candidate =
    (outer.tour && typeof outer.tour === 'object' ? (outer.tour as Record<string, unknown>) : null) ||
    (embeddedOuter?.tour && typeof embeddedOuter.tour === 'object'
      ? (embeddedOuter.tour as Record<string, unknown>)
      : null) ||
    outer;

  // Reject highlights or pure image objects unless they clearly represent a tour
  const typeVal = String(candidate.type || outer.type || '').toLowerCase();
  if (typeVal && !typeVal.includes('tour') && typeVal !== 'route') {
    if (!('distance' in candidate) && !('elevation_up' in candidate)) {
      return null;
    }
  }

  let tourId: string | null = null;
  if (candidate.id !== undefined && candidate.id !== null && /^\d+$/.test(String(candidate.id))) {
    tourId = String(candidate.id);
  } else if (typeof candidate.href === 'string') {
    const m = candidate.href.match(/\/tours?\/(\d+)/);
    if (m) tourId = m[1];
  } else {
    const links = candidate._links as Record<string, any> | undefined;
    const selfHref = typeof links?.self?.href === 'string' ? links.self.href : '';
    const m = selfHref.match(/\/tours?\/(\d+)/);
    if (m) tourId = m[1];
  }

  if (!tourId) return null;

  const rawName = typeof candidate.name === 'string' && candidate.name.trim()
    ? candidate.name.trim()
    : typeof outer.name === 'string' && outer.name.trim()
    ? outer.name.trim()
    : `Komoot Tour ${tourId}`;

  const sport = typeof candidate.sport === 'string' ? candidate.sport : undefined;
  const distMeters = Number(candidate.distance);
  const distanceKm = Number.isFinite(distMeters) && distMeters > 0 ? Math.round((distMeters / 1000) * 10) / 10 : undefined;
  const ascentRaw = Number(candidate.elevation_up ?? candidate.ascent);
  const ascentM = Number.isFinite(ascentRaw) && ascentRaw >= 0 ? Math.round(ascentRaw) : undefined;
  const durRaw = Number(candidate.duration);
  const durationSec = Number.isFinite(durRaw) && durRaw > 0 ? Math.round(durRaw) : undefined;

  const candToken =
    typeof candidate.share_token === 'string' && /^[A-Za-z0-9_-]{4,128}$/.test(candidate.share_token)
      ? candidate.share_token
      : inheritedShareToken || null;
  const tokenQuery = candToken ? `?share_token=${encodeURIComponent(candToken)}` : '';

  return {
    id: tourId,
    name: rawName,
    sport,
    activityType: mapKomootSportToActivityType(sport),
    distanceKm,
    ascentM,
    durationSec,
    tourUrl: `https://www.komoot.com/tour/${tourId}${tokenQuery}`,
    shareToken: candToken
  };
}

function collectCollectionToursDeep(
  node: unknown,
  foundMap: Map<string, KomootCollectionTourStub>,
  inheritedShareToken?: string | null,
  depth = 0
): void {
  if (!node || typeof node !== 'object' || depth > 7) return;

  if (Array.isArray(node)) {
    for (const item of node) {
      const stub = normalizeKomootCollectionTourCandidate(item, inheritedShareToken);
      if (stub) {
        const prev = foundMap.get(stub.id);
        if (!prev || (stub.distanceKm !== undefined && prev.distanceKm === undefined)) {
          foundMap.set(stub.id, stub);
        }
      } else if (item && typeof item === 'object') {
        collectCollectionToursDeep(item, foundMap, inheritedShareToken, depth + 1);
      }
    }
    return;
  }

  const obj = node as Record<string, unknown>;
  const priorityKeys = ['_embedded', 'tours', 'contents', 'items', 'pageProps', 'collection', 'data'];
  for (const key of priorityKeys) {
    if (obj[key] && typeof obj[key] === 'object') {
      collectCollectionToursDeep(obj[key], foundMap, inheritedShareToken, depth + 1);
    }
  }
  for (const [key, val] of Object.entries(obj)) {
    if (priorityKeys.includes(key)) continue;
    if (val && typeof val === 'object') {
      collectCollectionToursDeep(val, foundMap, inheritedShareToken, depth + 1);
    }
  }
}

function findCollectionTitleDeep(node: unknown, depth = 0): string | null {
  if (!node || typeof node !== 'object' || depth > 6) return null;
  const obj = node as Record<string, unknown>;

  if (obj.collection && typeof obj.collection === 'object') {
    const col = obj.collection as Record<string, unknown>;
    if (typeof col.name === 'string' && col.name.trim()) return col.name.trim();
    if (typeof col.title === 'string' && col.title.trim()) return col.title.trim();
  }

  if (
    typeof obj.name === 'string' &&
    obj.name.trim() &&
    ('tours' in obj || 'contents' in obj || '_embedded' in obj) &&
    !('lat' in obj)
  ) {
    return obj.name.trim();
  }

  for (const key of ['pageProps', '_embedded', 'data', 'collection']) {
    if (obj[key] && typeof obj[key] === 'object') {
      const found = findCollectionTitleDeep(obj[key], depth + 1);
      if (found) return found;
    }
  }
  return null;
}

export function extractKomootCollectionFromPayload(
  payload: string | Record<string, unknown>,
  fallbackCollectionId = 'collection',
  inheritedShareToken?: string | null
): { title: string; tours: KomootCollectionTourStub[] } | null {
  const tourMap = new Map<string, KomootCollectionTourStub>();

  if (typeof payload === 'object' && payload !== null) {
    const title = cleanKomootCollectionTitle(
      findCollectionTitleDeep(payload) || '',
      fallbackCollectionId
    );
    collectCollectionToursDeep(payload, tourMap, inheritedShareToken);
    if (tourMap.size > 0) {
      return { title, tours: Array.from(tourMap.values()) };
    }
    return null;
  }

  const trimmed = String(payload || '').trim();
  if (!trimmed) return null;

  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    const parsedJson = tryParseJsonCandidate(trimmed);
    if (parsedJson) {
      return extractKomootCollectionFromPayload(parsedJson, fallbackCollectionId, inheritedShareToken);
    }
  }

  let bestTitle = '';
  const metaTitleMatch =
    trimmed.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i) ||
    trimmed.match(/<title>([^<]+)<\/title>/i);
  if (metaTitleMatch?.[1]) {
    bestTitle = cleanKomootCollectionTitle(metaTitleMatch[1], fallbackCollectionId);
  }

  // Strategy 1: kmtBoot.setProps("...") or kmtBoot.setProps({...})
  const kmtBootRegex = /kmtBoot\.setProps\(\s*("(?:[^"\\]|\\.)*"|\{[\s\S]*?\})\s*\)\s*;?/g;
  let bootMatch: RegExpExecArray | null;
  while ((bootMatch = kmtBootRegex.exec(trimmed)) !== null) {
    const candidate = tryParseJsonCandidate(bootMatch[1]);
    if (!candidate) continue;
    const foundTitle = findCollectionTitleDeep(candidate);
    if (foundTitle) {
      bestTitle = cleanKomootCollectionTitle(foundTitle, fallbackCollectionId);
    }
    collectCollectionToursDeep(candidate, tourMap, inheritedShareToken);
  }

  // Strategy 2: <script> JSON blocks
  if (tourMap.size === 0) {
    const scriptRegex = /<script[^>]*>([\s\S]*?)<\/script>/gi;
    let scriptMatch: RegExpExecArray | null;
    while ((scriptMatch = scriptRegex.exec(trimmed)) !== null) {
      const body = scriptMatch[1].trim();
      if (!body.startsWith('{')) continue;
      const parsed = tryParseJsonCandidate(body);
      if (!parsed) continue;
      const foundTitle = findCollectionTitleDeep(parsed);
      if (foundTitle && !bestTitle) {
        bestTitle = cleanKomootCollectionTitle(foundTitle, fallbackCollectionId);
      }
      collectCollectionToursDeep(parsed, tourMap, inheritedShareToken);
    }
  }

  // Strategy 3: HTML anchor links to /tour/<id> inside collection page
  if (tourMap.size === 0) {
    const anchorRegex = /<a[^>]+href=["']([^"']*\/tour\/(\d+)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
    let anchorMatch: RegExpExecArray | null;
    while ((anchorMatch = anchorRegex.exec(trimmed)) !== null) {
      const href = anchorMatch[1];
      const tourId = anchorMatch[2];
      const rawInner = anchorMatch[3].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (!tourId || tourMap.has(tourId)) continue;

      let shareToken = inheritedShareToken || null;
      const tokenMatch = href.match(/[?&]share_token=([A-Za-z0-9_-]{4,128})/);
      if (tokenMatch?.[1]) shareToken = tokenMatch[1];
      const tokenQuery = shareToken ? `?share_token=${encodeURIComponent(shareToken)}` : '';

      tourMap.set(tourId, {
        id: tourId,
        name: rawInner.length >= 3 && rawInner.length <= 120 ? rawInner : `Komoot Tour ${tourId}`,
        activityType: 'cycling',
        tourUrl: `https://www.komoot.com/tour/${tourId}${tokenQuery}`,
        shareToken
      });
    }
  }

  if (tourMap.size === 0) {
    return null;
  }

  return {
    title: bestTitle || `Komoot Collection ${fallbackCollectionId}`,
    tours: Array.from(tourMap.values())
  };
}

export function buildGpxFromKomootTour(tour: ExtractedKomootTour): string {
  if (!tour.coordinates || tour.coordinates.length < 2) {
    throw new UrlImportError('Die Komoot-Tour enthält zu wenige gültige GPS-Koordinaten.', 422);
  }

  const baseDateMs = tour.date ? Date.parse(tour.date) : NaN;
  const hasValidBaseDate = Number.isFinite(baseDateMs);
  const safeName = escapeXml((tour.name || 'Komoot Tour').trim());
  const safeType = escapeXml((tour.sport || 'cycling').trim());

  const lines: string[] = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<gpx version="1.1" creator="Komoot URL Importer" xmlns="http://www.topografix.com/GPX/1/1">',
    '  <metadata>',
    `    <name>${safeName}</name>`,
    ...(hasValidBaseDate ? [`    <time>${new Date(baseDateMs).toISOString()}</time>`] : []),
    '  </metadata>',
    '  <trk>',
    `    <name>${safeName}</name>`,
    `    <type>${safeType}</type>`,
    '    <trkseg>'
  ];

  for (const pt of tour.coordinates) {
    const latStr = pt.lat.toFixed(6);
    const lngStr = pt.lng.toFixed(6);
    lines.push(`      <trkpt lat="${latStr}" lon="${lngStr}">`);
    if (pt.alt !== undefined && Number.isFinite(pt.alt)) {
      lines.push(`        <ele>${pt.alt.toFixed(1)}</ele>`);
    }
    if (hasValidBaseDate && pt.t !== undefined && Number.isFinite(pt.t) && pt.t >= 0) {
      lines.push(`        <time>${new Date(baseDateMs + pt.t).toISOString()}</time>`);
    }
    lines.push('      </trkpt>');
  }

  lines.push('    </trkseg>', '  </trk>', '</gpx>');
  return lines.join('\n');
}

async function readResponseTextWithLimit(response: Response, maxBytes = MAX_IMPORT_BYTES): Promise<string> {
  const declaredLength = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new UrlImportError('Die abgerufene Datei überschreitet das Limit von 15 MB.', 413);
  }

  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, 'utf8') > maxBytes) {
      throw new UrlImportError('Die abgerufene Datei überschreitet das Limit von 15 MB.', 413);
    }
    return text;
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        try {
          await reader.cancel();
        } catch {
          // ignore
        }
        throw new UrlImportError('Die abgerufene Datei überschreitet das Limit von 15 MB.', 413);
      }
      chunks.push(value);
    }
  }

  const combined = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder('utf-8').decode(combined);
}

async function fetchWithSsrfGuard(
  rawUrl: string,
  extraHeaders: Record<string, string> = {},
  lookupFn: DnsLookupFn = defaultDnsLookup
): Promise<{ response: Response; text: string; finalUrl: string }> {
  let currentUrl = rawUrl;

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const validatedUrl = await assertSafeExternalUrl(currentUrl, lookupFn);

    let response: Response;
    try {
      response = await fetch(validatedUrl.toString(), {
        method: 'GET',
        redirect: 'manual',
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
        headers: {
          'User-Agent':
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
          'Accept-Language': 'de-DE,de;q=0.9,en;q=0.8',
          ...extraHeaders
        }
      });
    } catch (err: any) {
      if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
        throw new UrlImportError('Zeitüberschreitung beim Abrufen der URL (max. 12 Sekunden).', 504);
      }
      throw new UrlImportError(`Verbindung zu ${validatedUrl.hostname} fehlgeschlagen.`, 502);
    }

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new UrlImportError('Fehlerhafte Weiterleitung ohne Ziel-URL.', 502);
      }
      if (hop >= MAX_REDIRECTS) {
        throw new UrlImportError('Zu viele Weiterleitungen beim Abrufen der URL.', 502);
      }
      try {
        currentUrl = new URL(location, validatedUrl).toString();
      } catch {
        throw new UrlImportError('Ungültige Weiterleitungs-URL vom Zielserver.', 502);
      }
      continue;
    }

    const text = await readResponseTextWithLimit(response);
    return { response, text, finalUrl: validatedUrl.toString() };
  }

  throw new UrlImportError('Zu viele Weiterleitungen beim Abrufen der URL.', 502);
}

function inferFilenameFromUrl(rawUrl: string, contentDisposition?: string | null): string {
  if (contentDisposition) {
    const utfMatch = contentDisposition.match(/filename\*=UTF-8''([^;\n]+)/i);
    if (utfMatch && utfMatch[1]) {
      try {
        return decodeURIComponent(utfMatch[1].replace(/["']/g, '').trim());
      } catch {
        // fallback below
      }
    }
    const plainMatch = contentDisposition.match(/filename="?([^";\n]+)"?/i);
    if (plainMatch && plainMatch[1]) {
      return plainMatch[1].trim();
    }
  }

  try {
    const parsed = new URL(rawUrl);
    const segment = decodeURIComponent(parsed.pathname.split('/').filter(Boolean).pop() || '');
    if (segment) {
      return segment.replace(/\.gpx$/i, '');
    }
  } catch {
    // ignore
  }
  return 'URL-Import Route';
}

export function validateDirectGpxText(rawText: string): void {
  const trimmed = rawText.trim();
  if (!trimmed) {
    throw new UrlImportError('Die abgerufene URL hat eine leere Antwort geliefert.', 422);
  }

  const lower = trimmed.toLowerCase();
  if (lower.includes('<!entity') || lower.includes('<!doctype') || lower.includes('<!system')) {
    if (!lower.includes('<html')) {
      throw new UrlImportError('Sicherheitsfehler: Ungültige XML/DOCTYPE-Deklaration in GPX-Datei.', 422);
    }
  }

  if (lower.startsWith('<!doctype html') || lower.startsWith('<html')) {
    throw new UrlImportError(
      'Die URL liefert eine HTML-Webseite statt einer direkten GPX-Datei. Bitte verwende einen direkten .gpx-Downloadlink oder einen Komoot-Tour-Link.',
      422
    );
  }

  if (!lower.includes('<gpx') || (!lower.includes('<trkpt') && !lower.includes('<rtept') && !lower.includes('<wpt'))) {
    throw new UrlImportError(
      'Die abgerufene Datei ist keine gültige GPX-Datei (fehlende <gpx>- oder Punkt-Tags).',
      422
    );
  }
}

function extractGpxPointsForHash(gpxXml: string): Array<{ lat: number; lng: number; ele?: number }> {
  const points: Array<{ lat: number; lng: number; ele?: number }> = [];
  const ptRegex = /<(?:trkpt|rtept)\b([^>]*?)(?:\/>|>([\s\S]*?)<\/(?:trkpt|rtept)>)/gi;
  let m: RegExpExecArray | null;
  while ((m = ptRegex.exec(gpxXml)) !== null) {
    const attrs = m[1] || '';
    const inner = m[2] || '';
    const latM = attrs.match(/\blat=["']([^"']+)["']/i);
    const lonM = attrs.match(/\blon=["']([^"']+)["']/i);
    if (!latM || !lonM) continue;
    const lat = Number(latM[1]);
    const lng = Number(lonM[1]);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const eleM = inner.match(/<ele>([^<]+)<\/ele>/i);
    const eleVal = eleM ? Number(eleM[1]) : undefined;
    points.push({
      lat,
      lng,
      ele: eleVal !== undefined && Number.isFinite(eleVal) ? eleVal : undefined
    });
  }
  return points;
}

export async function importGpxFromUrl(rawUrl: string, allowRedirectToKomoot = true): Promise<ImportedUrlGpxResult> {
  await assertSafeExternalUrl(rawUrl);
  const komootRef = parseKomootTourUrl(rawUrl);

  if (komootRef) {
    // Strategy 1: Fetch official tour metadata (apiTourUrl + onlyprops) & coordinates endpoint
    const jsonCandidateUrls = [
      { url: komootRef.apiTourUrl, headers: { Accept: 'application/json' } },
      { url: komootRef.canonicalUrl, headers: { onlyprops: 'true', Accept: 'application/json, text/plain, */*' } },
      { url: komootRef.apiCoordinatesUrl, headers: { Accept: 'application/json' } }
    ];

    let extractedMetaName: string | undefined;
    let extractedMetaSport: string | undefined;
    let extractedMetaDate: string | undefined;
    let extractedMetaChangedAt: string | undefined;
    let extractedCoords: KomootCoordinatePoint[] | null = null;

    const finalizeKomootTourResult = (tour: ExtractedKomootTour): ImportedUrlGpxResult => {
      const activityType = mapKomootSportToActivityType(tour.sport);
      const gpxContent = buildGpxFromKomootTour(tour);
      const contentHash = computeCanonicalTrackContentHash({
        name: tour.name,
        activityType,
        points: tour.coordinates.map((c) => ({ lat: c.lat, lng: c.lng, ele: c.alt }))
      });
      return {
        gpxContent,
        suggestedName: tour.name,
        activityType,
        sourceType: 'komoot',
        sourceUrl: komootRef.canonicalUrl,
        pointCount: tour.coordinates.length,
        komootTourId: komootRef.tourId,
        komootShareToken: komootRef.shareToken,
        contentHash,
        remoteUpdatedAt: tour.changedAt || tour.date
      };
    };

    for (const candidate of jsonCandidateUrls) {
      try {
        const res = await fetchWithSsrfGuard(candidate.url, candidate.headers);
        if (!res.response.ok) continue;

        const parsedJson = tryParseJsonCandidate(res.text);
        if (parsedJson) {
          const meta = findTourMetadataDeep(parsedJson);
          if (meta.name && !isGenericKomootTourName(meta.name, komootRef.tourId)) {
            extractedMetaName = meta.name;
          }
          if (meta.sport && !extractedMetaSport) extractedMetaSport = meta.sport;
          if (meta.date && !extractedMetaDate) extractedMetaDate = meta.date;
          if (meta.changedAt && !extractedMetaChangedAt) extractedMetaChangedAt = meta.changedAt;

          const extracted = extractKomootTourFromPayload(parsedJson, komootRef.tourId);
          if (extracted && extracted.coordinates.length >= 2) {
            if (!isGenericKomootTourName(extracted.name, komootRef.tourId)) {
              extractedMetaName = extracted.name;
            }
            if (extracted.sport && !extractedMetaSport) extractedMetaSport = extracted.sport;
            if (extracted.date && !extractedMetaDate) extractedMetaDate = extracted.date;
            if (extracted.changedAt && !extractedMetaChangedAt) extractedMetaChangedAt = extracted.changedAt;
            extractedCoords = extracted.coordinates;
            // Stop early only once we have BOTH coordinates AND a real tour name
            if (!isGenericKomootTourName(extractedMetaName, komootRef.tourId)) {
              return finalizeKomootTourResult({
                name: extractedMetaName!,
                sport: extractedMetaSport,
                date: extractedMetaDate,
                changedAt: extractedMetaChangedAt,
                coordinates: extractedCoords
              });
            }
          }
        }
      } catch (err) {
        if (err instanceof UrlImportError && err.statusCode === 403) {
          throw err;
        }
        // continue to next candidate / HTML fallback
      }
    }

    // Strategy 2: Fetch public HTML tour page (needed either for coordinates OR to resolve the real tour title)
    const htmlRes = await fetchWithSsrfGuard(komootRef.canonicalUrl, {
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    });

    if (htmlRes.response.ok) {
      const htmlTitle = extractKomootTourTitleFromHtml(htmlRes.text, komootRef.tourId);
      if (htmlTitle && !isGenericKomootTourName(htmlTitle, komootRef.tourId)) {
        extractedMetaName = htmlTitle;
      }

      const extractedFromHtml = extractKomootTourFromPayload(htmlRes.text, komootRef.tourId);
      if (extractedFromHtml && extractedFromHtml.coordinates.length >= 2) {
        const bestName = !isGenericKomootTourName(extractedFromHtml.name, komootRef.tourId)
          ? extractedFromHtml.name
          : !isGenericKomootTourName(extractedMetaName, komootRef.tourId)
          ? extractedMetaName!
          : `Komoot Tour ${komootRef.tourId}`;
        return finalizeKomootTourResult({
          name: bestName,
          sport: extractedFromHtml.sport || extractedMetaSport,
          date: extractedFromHtml.date || extractedMetaDate,
          changedAt: extractedFromHtml.changedAt || extractedMetaChangedAt,
          coordinates: extractedFromHtml.coordinates
        });
      }
    }

    // If Strategy 1 already obtained valid coordinates (e.g. from apiCoordinatesUrl), return with best resolved name
    if (extractedCoords && extractedCoords.length >= 2) {
      return finalizeKomootTourResult({
        name: extractedMetaName || `Komoot Tour ${komootRef.tourId}`,
        sport: extractedMetaSport,
        date: extractedMetaDate,
        changedAt: extractedMetaChangedAt,
        coordinates: extractedCoords
      });
    }

    if (htmlRes.response.status === 401 || htmlRes.response.status === 403) {
      throw new UrlImportError(
        'Diese Komoot-Tour ist privat. Bitte stelle sie auf „Öffentlich“ oder kopiere den Freigabe-Link inklusive share_token.',
        403
      );
    }

    if (htmlRes.response.status === 404) {
      throw new UrlImportError('Komoot-Tour wurde nicht gefunden (404). Bitte prüfe den Link.', 404);
    }

    if (!htmlRes.response.ok) {
      throw new UrlImportError(
        `Komoot hat mit Status ${htmlRes.response.status} geantwortet.`,
        htmlRes.response.status >= 400 && htmlRes.response.status < 500 ? htmlRes.response.status : 502
      );
    }

    const lowerHtml = htmlRes.text.toLowerCase();
    if (
      htmlRes.finalUrl.includes('/login') ||
      htmlRes.finalUrl.includes('/signin') ||
      lowerHtml.includes('private tour') ||
      lowerHtml.includes('diese tour ist privat')
    ) {
      throw new UrlImportError(
        'Diese Komoot-Tour ist privat oder erfordert eine Anmeldung. Bitte nutze einen öffentlichen Tour-Link oder einen Freigabe-Link mit share_token.',
        403
      );
    }

    throw new UrlImportError(
      'Keine öffentlichen GPS-Koordinaten in dieser Komoot-Tour gefunden. Stelle die Tour auf „Öffentlich“ oder exportiere sie in Komoot direkt als GPX-Datei.',
      422
    );
  }

  // Direct GPX URL flow (also detects Komoot share shortlinks that redirect to /tour/<id>)
  const directRes = await fetchWithSsrfGuard(rawUrl, {
    Accept: 'application/gpx+xml, application/xml, text/xml, text/plain, */*'
  });

  if (allowRedirectToKomoot && directRes.finalUrl !== rawUrl && parseKomootTourUrl(directRes.finalUrl)) {
    return importGpxFromUrl(directRes.finalUrl, false);
  }

  if (!directRes.response.ok) {
    throw new UrlImportError(
      `GPX-URL konnte nicht abgerufen werden (HTTP ${directRes.response.status}).`,
      directRes.response.status >= 400 && directRes.response.status < 500 ? directRes.response.status : 502
    );
  }

  validateDirectGpxText(directRes.text);

  const nameMatch = directRes.text.match(/<trk>[\s\S]*?<name>([^<]+)<\/name>/i)
    || directRes.text.match(/<metadata>[\s\S]*?<name>([^<]+)<\/name>/i);
  const fallbackName = inferFilenameFromUrl(
    directRes.finalUrl,
    directRes.response.headers.get('content-disposition')
  );
  const suggestedName = (nameMatch?.[1] || fallbackName || 'URL-Import Route').trim();
  const parsedPts = extractGpxPointsForHash(directRes.text);
  const pointCount = parsedPts.length || (directRes.text.match(/<(?:trkpt|rtept)\b/gi) || []).length;
  const contentHash = computeCanonicalTrackContentHash({
    name: suggestedName,
    activityType: 'cycling',
    points: parsedPts
  });
  const lastModifiedHeader = directRes.response.headers.get('last-modified') || undefined;

  return {
    gpxContent: directRes.text,
    suggestedName,
    activityType: 'cycling',
    sourceType: 'gpx',
    sourceUrl: directRes.finalUrl,
    pointCount,
    contentHash,
    remoteUpdatedAt: lastModifiedHeader
  };
}

async function resolveKomootCollection(
  collectionRef: KomootCollectionRef
): Promise<ImportedUrlCollectionResult> {
  // Strategy 1: Try onlyprops JSON & internal collection contents API
  const jsonCandidates = [
    {
      url: collectionRef.canonicalUrl,
      headers: { onlyprops: 'true', Accept: 'application/json, text/plain, */*' }
    },
    {
      url: collectionRef.apiContentsUrl,
      headers: { Accept: 'application/json' }
    }
  ];

  for (const candidate of jsonCandidates) {
    try {
      const res = await fetchWithSsrfGuard(candidate.url, candidate.headers);
      if (!res.response.ok) continue;
      const parsedJson = tryParseJsonCandidate(res.text);
      if (!parsedJson) continue;
      const extracted = extractKomootCollectionFromPayload(
        parsedJson,
        collectionRef.collectionId,
        collectionRef.shareToken
      );
      if (extracted && extracted.tours.length > 0) {
        return {
          kind: 'collection',
          collectionId: collectionRef.collectionId,
          title: extracted.title,
          sourceUrl: collectionRef.canonicalUrl,
          tours: extracted.tours
        };
      }
    } catch (err) {
      if (err instanceof UrlImportError && err.statusCode === 403) {
        throw err;
      }
    }
  }

  // Strategy 2: Fetch public HTML collection page and parse kmtBoot / embedded JSON / tour links
  const htmlRes = await fetchWithSsrfGuard(collectionRef.canonicalUrl, {
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
  });

  if (htmlRes.response.status === 401 || htmlRes.response.status === 403) {
    throw new UrlImportError(
      'Diese Komoot-Collection ist privat. Bitte stelle sie auf „Öffentlich“ oder nutze den Freigabe-Link mit share_token.',
      403
    );
  }

  if (htmlRes.response.status === 404) {
    throw new UrlImportError(
      'Komoot-Collection wurde nicht gefunden (404). Bitte prüfe den Link.',
      404
    );
  }

  if (!htmlRes.response.ok) {
    throw new UrlImportError(
      `Komoot hat mit Status ${htmlRes.response.status} geantwortet.`,
      htmlRes.response.status >= 400 && htmlRes.response.status < 500
        ? htmlRes.response.status
        : 502
    );
  }

  const extractedFromHtml = extractKomootCollectionFromPayload(
    htmlRes.text,
    collectionRef.collectionId,
    collectionRef.shareToken
  );

  if (extractedFromHtml && extractedFromHtml.tours.length > 0) {
    return {
      kind: 'collection',
      collectionId: collectionRef.collectionId,
      title: extractedFromHtml.title,
      sourceUrl: collectionRef.canonicalUrl,
      tours: extractedFromHtml.tours
    };
  }

  const lowerHtml = htmlRes.text.toLowerCase();
  if (
    htmlRes.finalUrl.includes('/login') ||
    htmlRes.finalUrl.includes('/signin') ||
    lowerHtml.includes('private collection') ||
    lowerHtml.includes('diese collection ist privat')
  ) {
    throw new UrlImportError(
      'Diese Komoot-Collection ist privat oder erfordert eine Anmeldung. Bitte nutze eine öffentliche Collection oder einen Freigabe-Link mit share_token.',
      403
    );
  }

  throw new UrlImportError(
    'In dieser Komoot-Collection wurden keine öffentlichen Touren gefunden.',
    422
  );
}

export async function resolveUrlImport(rawUrl: string): Promise<ImportedUrlResult> {
  await assertSafeExternalUrl(rawUrl);
  const collectionRef = parseKomootCollectionUrl(rawUrl);

  if (collectionRef) {
    return resolveKomootCollection(collectionRef);
  }

  if (parseKomootTourUrl(rawUrl)) {
    const singleTrack = await importGpxFromUrl(rawUrl);
    return {
      kind: 'track',
      ...singleTrack
    };
  }

  // Non-direct Komoot URL (direct GPX or shortlink that may redirect to a Komoot tour or collection)
  const directRes = await fetchWithSsrfGuard(rawUrl, {
    Accept: 'application/gpx+xml, application/xml, text/xml, text/plain, */*'
  });

  if (directRes.finalUrl !== rawUrl) {
    const redirectedCollection = parseKomootCollectionUrl(directRes.finalUrl);
    if (redirectedCollection) {
      await assertSafeExternalUrl(redirectedCollection.canonicalUrl);
      return resolveKomootCollection(redirectedCollection);
    }

    if (parseKomootTourUrl(directRes.finalUrl)) {
      const redirectedTrack = await importGpxFromUrl(directRes.finalUrl, false);
      return {
        kind: 'track',
        ...redirectedTrack
      };
    }
  }

  if (!directRes.response.ok) {
    throw new UrlImportError(
      `GPX-URL konnte nicht abgerufen werden (HTTP ${directRes.response.status}).`,
      directRes.response.status >= 400 && directRes.response.status < 500 ? directRes.response.status : 502
    );
  }

  validateDirectGpxText(directRes.text);

  const nameMatch = directRes.text.match(/<trk>[\s\S]*?<name>([^<]+)<\/name>/i)
    || directRes.text.match(/<metadata>[\s\S]*?<name>([^<]+)<\/name>/i);
  const fallbackName = inferFilenameFromUrl(
    directRes.finalUrl,
    directRes.response.headers.get('content-disposition')
  );
  const suggestedName = (nameMatch?.[1] || fallbackName || 'URL-Import Route').trim();
  const parsedPts = extractGpxPointsForHash(directRes.text);
  const pointCount = parsedPts.length || (directRes.text.match(/<(?:trkpt|rtept)\b/gi) || []).length;
  const contentHash = computeCanonicalTrackContentHash({
    name: suggestedName,
    activityType: 'cycling',
    points: parsedPts
  });
  const lastModifiedHeader = directRes.response.headers.get('last-modified') || undefined;

  return {
    kind: 'track',
    gpxContent: directRes.text,
    suggestedName,
    activityType: 'cycling',
    sourceType: 'gpx',
    sourceUrl: directRes.finalUrl,
    pointCount,
    contentHash,
    remoteUpdatedAt: lastModifiedHeader
  };
}
