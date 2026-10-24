import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { unzipSync } from 'fflate';
import {
  getSetting,
  saveSetting,
  deleteSetting,
  clearHealthMetrics,
  saveGarminActivity,
  saveTrack,
  saveSleep,
  saveWeight,
  saveStress,
  saveRhr,
  saveSteps,
  runInTransaction,
  getGarminActivityById
} from './db';
import { parseFIT } from './fitUtils';
import { parseGPX, calculateElevationStats, calculatePowerStats, findClimbs, calculateSurfaceStatsFromPoints, hydratePointsWithSurface } from './gpxUtils';
import { GPXPoint, GPXTrack } from '../types';

const DEFAULT_BASE_URL = 'https://personal.connectapi.garmin.com';
const TOKEN_ENDPOINT_PATH = '/personalapitoken-service/personal-api/personal-api-key/token';
const KEYFILE_PATH = path.join(process.cwd(), '.garmin_secret.key');

interface EphemeralTokenVerificationMeta {
  expiresAtMs: number;
  apiKeyHash: string;
}

let ephemeralVerifiedMeta: EphemeralTokenVerificationMeta | null = null;
let legacySecretsPurged = false;

/**
 * Ensures any legacy persisted Garmin API keys or keyfiles from older versions
 * are permanently removed so keys exist strictly in non-persistent session memory.
 */
export function purgeLegacyPersistentGarminSecrets(): boolean {
  let removed = false;
  try {
    if (deleteSetting('garmin_personal_api_key')) removed = true;
    if (deleteSetting('garmin_personal_api_key_enc')) removed = true;
    if (deleteSetting('garmin_personal_token_expires_at')) removed = true;
  } catch {
    // Ignore DB errors before init
  }
  try {
    if (fs.existsSync(KEYFILE_PATH)) {
      fs.unlinkSync(KEYFILE_PATH);
      removed = true;
    }
  } catch {
    // Ignore filesystem errors
  }
  legacySecretsPurged = true;
  return removed;
}

export function clearGarminCachedToken(): void {
  ephemeralVerifiedMeta = null;
}

/**
 * Validates and normalizes the Garmin Personal API Base-URL.
 * Strictly restricts to official HTTPS garmin.com domains to prevent SSRF and API key exfiltration.
 */
export function validateGarminBaseUrl(rawUrl?: string, throwOnInvalid = false): string {
  const trimmed = (rawUrl || '').trim();
  if (!trimmed) {
    return DEFAULT_BASE_URL;
  }

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    if (throwOnInvalid) {
      throw new Error('Ungültige Garmin API Base-URL. Bitte gib eine gültige HTTPS-URL einer offiziellen garmin.com-Domain an.');
    }
    return DEFAULT_BASE_URL;
  }

  const hostname = parsed.hostname.toLowerCase();
  const isOfficialGarminHost = hostname === 'garmin.com' || hostname.endsWith('.garmin.com');

  if (parsed.protocol !== 'https:' || !isOfficialGarminHost || parsed.username || parsed.password) {
    if (throwOnInvalid) {
      throw new Error('Ungültige Garmin API Base-URL: Aus Sicherheitsgründen (SSRF-Schutz) sind ausschließlich offizielle HTTPS-Domains von garmin.com zulässig.');
    }
    return DEFAULT_BASE_URL;
  }

  const cleanPath = parsed.pathname.replace(/\/+$/, '');
  return `${parsed.origin}${cleanPath}`;
}

export interface GarminPersonalApiStatus {
  configured: boolean;
  source: 'tab-memory' | 'env' | 'none';
  persistent: boolean;
  encrypted: boolean;
  encryptionAlgorithm: 'RAM (Tab-Sitzung)' | null;
  deletable: boolean;
  hasEnvFallback: boolean;
  maskedKey: string | null;
  baseUrl: string;
  tokenValid: boolean;
  tokenExpiresAt: string | null;
  lastSyncAt: string | null;
}

export function maskApiKey(rawKey: string): string {
  const clean = rawKey.trim();
  if (!clean) return '';
  if (clean.length <= 8) {
    return `${clean.slice(0, 2)}••••${clean.slice(-2)}`;
  }
  return `${clean.slice(0, 4)}••••••••${clean.slice(-4)}`;
}

function buildKeySignature(baseUrl: string, rawKey: string): string {
  if (!rawKey) return '';
  const digest = crypto.createHash('sha256').update(`${baseUrl}::${rawKey}`).digest('hex').slice(0, 24);
  return `${baseUrl}:${digest}`;
}

export function getActiveGarminApiKey(overrideApiKey?: string): {
  key: string;
  source: 'tab-memory' | 'env' | 'none';
  persistent: boolean;
  encrypted: boolean;
  hasEnvFallback: boolean;
  baseUrl: string;
} {
  if (!legacySecretsPurged) {
    purgeLegacyPersistentGarminSecrets();
  }

  const cleanOverride = (overrideApiKey || '').trim();
  const envKey = (process.env.GARMIN_PERSONAL_API_KEY || '').trim();
  const rawSavedBaseUrl = getSetting('garmin_personal_api_base_url', DEFAULT_BASE_URL);
  const baseUrl = validateGarminBaseUrl(rawSavedBaseUrl, false);

  if (cleanOverride) {
    return {
      key: cleanOverride,
      source: 'tab-memory',
      persistent: false,
      encrypted: false,
      hasEnvFallback: Boolean(envKey),
      baseUrl
    };
  }

  if (envKey) {
    return {
      key: envKey,
      source: 'env',
      persistent: false,
      encrypted: false,
      hasEnvFallback: true,
      baseUrl
    };
  }

  return {
    key: '',
    source: 'none',
    persistent: false,
    encrypted: false,
    hasEnvFallback: false,
    baseUrl
  };
}

export function getGarminPersonalApiStatus(overrideApiKey?: string): GarminPersonalApiStatus {
  const { key, source, persistent, encrypted, hasEnvFallback, baseUrl } = getActiveGarminApiKey(overrideApiKey);
  const lastSyncAt = getSetting('garmin_personal_last_sync_at', '') || null;

  const now = Date.now();
  const keySig = key ? buildKeySignature(baseUrl, key) : '';

  const isEphemeralValid = Boolean(
    key &&
    keySig &&
    ephemeralVerifiedMeta &&
    ephemeralVerifiedMeta.apiKeyHash === keySig &&
    ephemeralVerifiedMeta.expiresAtMs > now + 60_000
  );

  let resolvedExpiresAt: string | null = null;
  if (key && isEphemeralValid && ephemeralVerifiedMeta) {
    resolvedExpiresAt = new Date(ephemeralVerifiedMeta.expiresAtMs).toISOString();
  }

  return {
    configured: Boolean(key),
    source,
    persistent,
    encrypted,
    encryptionAlgorithm: source === 'tab-memory' ? 'RAM (Tab-Sitzung)' : null,
    deletable: source === 'tab-memory',
    hasEnvFallback,
    maskedKey: key ? maskApiKey(key) : null,
    baseUrl,
    tokenValid: isEphemeralValid,
    tokenExpiresAt: resolvedExpiresAt,
    lastSyncAt
  };
}

export function clearGarminPersonalApiConfig(options?: { clearSyncedData?: boolean }): {
  keyDeleted: boolean;
  dataCleared: boolean;
} {
  const keyDeleted = purgeLegacyPersistentGarminSecrets();
  clearGarminCachedToken();

  let dataCleared = false;
  if (options?.clearSyncedData) {
    clearHealthMetrics();
    deleteSetting('garmin_personal_last_sync_at');
    dataCleared = true;
  }

  return { keyDeleted, dataCleared };
}

/**
 * Extracts expiration timestamp in ms from a JWT payload (`exp` claim) if present,
 * otherwise falls back to `expiresInSec` (default 24h = 86400s).
 */
function resolveTokenExpiryMs(token: string, fallbackSeconds = 86400): number {
  const now = Date.now();
  try {
    const parts = token.split('.');
    if (parts.length === 3 && parts[1]) {
      const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf8');
      const payload = JSON.parse(payloadJson);
      if (typeof payload?.exp === 'number' && payload.exp * 1000 > now) {
        return payload.exp * 1000;
      }
    }
  } catch {
    // Ignore JWT decode errors and use fallback duration
  }
  const safeSec = isNaN(fallbackSeconds) || fallbackSeconds <= 0 ? 86400 : fallbackSeconds;
  return now + safeSec * 1000;
}

/**
 * Parses the raw response body from Garmin's `/personalapitoken-service/personal-api/personal-api-key/token`
 * which returns a `text/plain` JWT string (or JSON object/string).
 */
function extractBearerTokenFromResponse(rawText: string): { token: string | null; json: any } {
  const trimmed = (rawText || '').trim();
  if (!trimmed) {
    return { token: null, json: null };
  }

  let json: any = null;
  try {
    json = JSON.parse(trimmed);
  } catch {
    json = null;
  }

  if (typeof json === 'string' && json.trim().length > 16) {
    return { token: json.trim(), json: null };
  }

  if (json && typeof json === 'object') {
    const candidate =
      json.access_token ||
      json.accessToken ||
      json.token ||
      json.oauthToken ||
      json.jwt ||
      (typeof json.data === 'string' ? json.data : null);
    if (typeof candidate === 'string' && candidate.trim().length > 10) {
      return { token: candidate.trim().replace(/^Bearer\s+/i, '').trim(), json };
    }
  }

  // Handle direct text/plain token response (e.g. raw JWT eyJ... or opaque token)
  const unquoted = trimmed.replace(/^["']|["']$/g, '').replace(/^Bearer\s+/i, '').trim();
  if (
    unquoted.length > 16 &&
    !unquoted.startsWith('{') &&
    !unquoted.startsWith('<') &&
    !/\s/.test(unquoted)
  ) {
    return { token: unquoted, json };
  }

  return { token: null, json };
}

/**
 * Exchanges the Garmin Connect Personal API Key for a 24-hour OAuth2 Bearer access token
 * via https://personal.connectapi.garmin.com/personalapitoken-service/personal-api/personal-api-key/token
 *
 * NOTE on HTTP 406 (NotAcceptableException):
 * Garmin's personalapitoken-service returns the generated JWT token as `text/plain` (or wildcard)
 * and rejects requests that send strict `Accept: application/json` + `Content-Type: application/json`
 * with an empty POST body via Spring/JAX-RS `406 NotAcceptableException`.
 * We therefore send a wildcard Accept header without a `Content-Type` header on the empty POST body,
 * matching Garmin's official specification.
 */
export async function getGarminBearerToken(overrideApiKey?: string, overrideBaseUrl?: string, _forceRefresh = false): Promise<{
  accessToken: string;
  expiresAt: string;
}> {
  const active = getActiveGarminApiKey(overrideApiKey);
  const rawKey = active.key;
  const baseUrl = overrideBaseUrl
    ? validateGarminBaseUrl(overrideBaseUrl, true)
    : active.baseUrl;

  if (!rawKey) {
    throw new Error('Kein Garmin Personal API Key aktiv. Bitte gib deinen Personal API Key für diese Browser-Tab-Sitzung ein.');
  }

  const keySignature = buildKeySignature(baseUrl, rawKey);

  // If the user provided a direct Bearer JWT token (e.g. eyJ...), allow direct usage
  if (rawKey.startsWith('Bearer ') || (rawKey.startsWith('eyJ') && rawKey.split('.').length === 3)) {
    const cleanJwt = rawKey.replace(/^Bearer\s+/i, '').trim();
    const expiresAtMs = resolveTokenExpiryMs(cleanJwt, 86400);
    const iso = new Date(expiresAtMs).toISOString();
    ephemeralVerifiedMeta = {
      expiresAtMs,
      apiKeyHash: keySignature
    };
    return { accessToken: cleanJwt, expiresAt: iso };
  }

  const tokenUrl = `${baseUrl}${TOKEN_ENDPOINT_PATH}`;
  const cleanApiKey = rawKey.replace(/^(ApiKey|Bearer)\s+/i, '').trim();

  // Header profiles ordered by Garmin Personal API compatibility (avoids HTTP 406 NotAcceptableException)
  const headerProfiles: Array<Record<string, string>> = [
    {
      'Authorization': `ApiKey ${cleanApiKey}`,
      'Accept': '*/*'
    },
    {
      'Authorization': `ApiKey ${cleanApiKey}`,
      'Accept': 'text/plain, application/json, */*;q=0.9'
    }
  ];

  let lastStatus = 0;
  let lastDetail = '';

  for (let attempt = 0; attempt < headerProfiles.length; attempt++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 15000);

    try {
      const response = await fetch(tokenUrl, {
        method: 'POST',
        headers: headerProfiles[attempt],
        signal: controller.signal
      });

      clearTimeout(timeoutId);

      const text = await response.text();
      const { token, json } = extractBearerTokenFromResponse(text);

      if (response.ok && token) {
        const expiresInSec = Number(json?.expires_in || json?.expiresIn || 86400);
        const expiresAtMs = resolveTokenExpiryMs(token, expiresInSec);
        const iso = new Date(expiresAtMs).toISOString();

        ephemeralVerifiedMeta = {
          expiresAtMs,
          apiKeyHash: keySignature
        };

        return { accessToken: token, expiresAt: iso };
      }

      lastStatus = response.status;
      lastDetail =
        json?.message ||
        json?.error_description ||
        json?.error ||
        text.trim().slice(0, 200) ||
        `HTTP ${response.status}`;

      // Only retry with next header profile if status was 406 Not Acceptable or 415 Unsupported Media Type
      if (response.status !== 406 && response.status !== 415) {
        break;
      }
    } catch (err: any) {
      clearTimeout(timeoutId);
      if (err?.name === 'AbortError') {
        throw new Error('Zeitüberschreitung bei der Verbindung zu personal.connectapi.garmin.com (15s Timeout).');
      }
      throw err;
    }
  }

  if (lastStatus === 401 || lastStatus === 403) {
    throw new Error(
      `Authentifizierung beim Garmin Token-Service fehlgeschlagen (${lastStatus}): Bitte prüfe, ob dein Personal API Key gültig und noch nicht abgelaufen ist. Details: ${lastDetail}`
    );
  }

  if (lastStatus > 0) {
    throw new Error(`Garmin Token-Endpunkt antwortete mit Status ${lastStatus}: ${lastDetail}`);
  }

  throw new Error('Garmin Token-Service hat kein gültiges OAuth2 Access-Token zurückgegeben.');
}

async function fetchGarminJsonWithFallback(urls: string[], accessToken: string): Promise<{ data: any; usedUrl: string }> {
  const errors: string[] = [];

  for (const url of urls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 20000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/json, text/plain, */*',
          'User-Agent': 'GPX-Route-Master-Personal-API/1.0'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const text = await res.text();
        if (!text || !text.trim()) {
          return { data: [], usedUrl: url };
        }
        const parsed = JSON.parse(text);
        return { data: parsed, usedUrl: url };
      } else {
        const bodyPreview = (await res.text().catch(() => '')).slice(0, 140);
        errors.push(`${res.status} (${new URL(url).pathname}): ${bodyPreview}`);
        // Stop immediately on 401 Unauthorized
        if (res.status === 401) {
          throw new Error(`OAuth2 Token abgelaufen oder unautorisiert (HTTP 401).`);
        }
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      if (e?.message?.includes('HTTP 401')) throw e;
      errors.push(`${url}: ${e?.message || 'Netzwerkfehler'}`);
    }
  }

  throw new Error(`Garmin Personal API Abfrage fehlgeschlagen. Geprüfte Endpunkte: ${errors.join(' | ')}`);
}

const MAX_BINARY_DOWNLOAD_BYTES = 30 * 1024 * 1024; // 30 MB
const MAX_UNZIPPED_FIT_BYTES = 100 * 1024 * 1024; // 100 MB

async function fetchGarminBinaryWithFallback(urls: string[], accessToken: string): Promise<{ buffer: Buffer; contentType: string; usedUrl: string }> {
  const errors: string[] = [];

  for (const url of urls) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 25000);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${accessToken}`,
          'Accept': 'application/octet-stream, application/zip, application/vnd.ant.fit, application/gpx+xml, */*',
          'User-Agent': 'GPX-Route-Master-Personal-API/1.0'
        },
        signal: controller.signal
      });
      clearTimeout(timeoutId);

      if (res.ok) {
        const contentLength = Number(res.headers.get('content-length') || 0);
        if (contentLength > MAX_BINARY_DOWNLOAD_BYTES) {
          throw new Error(`FIT-/ZIP-Download überschreitet das Sicherheitslimit von 30 MB (${Math.round(contentLength / (1024 * 1024))} MB).`);
        }
        const arrayBuf = await res.arrayBuffer();
        if (arrayBuf.byteLength > MAX_BINARY_DOWNLOAD_BYTES) {
          throw new Error(`FIT-/ZIP-Download überschreitet das Sicherheitslimit von 30 MB.`);
        }
        const buf = Buffer.from(arrayBuf);
        if (buf.length > 20) {
          return {
            buffer: buf,
            contentType: res.headers.get('content-type') || 'application/octet-stream',
            usedUrl: url
          };
        }
      } else {
        errors.push(`${res.status} (${new URL(url).pathname})`);
      }
    } catch (e: any) {
      clearTimeout(timeoutId);
      errors.push(`${new URL(url).pathname}: ${e?.message || 'Fehler'}`);
    }
  }

  throw new Error(`Konnte Binär-/FIT-Datei für Aktivität nicht herunterladen (${errors.join(', ')})`);
}

function normalizeGarminSportType(rawType: any): string {
  if (!rawType) return 'cycling';
  const str = typeof rawType === 'string'
    ? rawType.toLowerCase()
    : String(rawType?.typeKey || rawType?.parentTypeId || rawType?.sport || 'cycling').toLowerCase();

  if (str.includes('run') || str.includes('jog') || str.includes('treadmill') || str.includes('trail')) {
    return 'running';
  }
  if (str.includes('hike') || str.includes('walk') || str.includes('mountaineer')) {
    return 'hiking';
  }
  if (str.includes('cycle') || str.includes('bike') || str.includes('biking') || str.includes('gravel') || str.includes('virtual_ride') || str.includes('road')) {
    return 'cycling';
  }
  return str;
}

function extractPointsFromGarminDetailsJson(details: any): GPXPoint[] {
  if (!details) return [];

  // Format 1: geoPolylineDTO.polyline
  if (details.geoPolylineDTO && Array.isArray(details.geoPolylineDTO.polyline)) {
    return details.geoPolylineDTO.polyline
      .filter((pt: any) => typeof pt.lat === 'number' && typeof pt.lon === 'number')
      .map((pt: any) => ({
        lat: pt.lat,
        lng: pt.lon,
        ele: typeof pt.altitude === 'number' ? pt.altitude : 0,
        time: pt.time ? new Date(pt.time) : undefined,
        hr: typeof pt.heartRate === 'number' ? pt.heartRate : undefined,
        cadence: typeof pt.cadence === 'number' ? pt.cadence : undefined,
        power: typeof pt.power === 'number' ? pt.power : undefined
      }));
  }

  // Format 2: metricDescriptors + activityDetailMetrics
  if (Array.isArray(details.metricDescriptors) && Array.isArray(details.activityDetailMetrics)) {
    const idxMap: Record<string, number> = {};
    details.metricDescriptors.forEach((desc: any, i: number) => {
      if (desc?.key) idxMap[desc.key] = desc.metricsIndex ?? i;
    });

    const latIdx = idxMap['directLatitude'];
    const lngIdx = idxMap['directLongitude'];
    const eleIdx = idxMap['directElevation'];
    const timeIdx = idxMap['directTimestamp'];
    const hrIdx = idxMap['directHeartRate'];
    const cadIdx = idxMap['directBikeCadence'] ?? idxMap['directRunCadence'] ?? idxMap['directDoubleCadence'];
    const powIdx = idxMap['directPower'];

    if (latIdx !== undefined && lngIdx !== undefined) {
      const points: GPXPoint[] = [];
      for (const item of details.activityDetailMetrics) {
        const m = item?.metrics;
        if (!Array.isArray(m)) continue;
        const lat = Number(m[latIdx]);
        const lng = Number(m[lngIdx]);
        if (isNaN(lat) || isNaN(lng) || (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001)) continue;
        points.push({
          lat,
          lng,
          ele: eleIdx !== undefined && m[eleIdx] !== null ? Number(m[eleIdx]) : 0,
          time: timeIdx !== undefined && m[timeIdx] ? new Date(Number(m[timeIdx])) : undefined,
          hr: hrIdx !== undefined && m[hrIdx] !== null ? Number(m[hrIdx]) : undefined,
          cadence: cadIdx !== undefined && m[cadIdx] !== null ? Math.round(Number(m[cadIdx])) : undefined,
          power: powIdx !== undefined && m[powIdx] !== null ? Number(m[powIdx]) : undefined
        });
      }
      return points;
    }
  }

  // Format 3: samples array
  if (Array.isArray(details.samples)) {
    return details.samples
      .filter((s: any) => typeof s.latitudeInDegree === 'number' && typeof s.longitudeInDegree === 'number')
      .map((s: any) => ({
        lat: s.latitudeInDegree,
        lng: s.longitudeInDegree,
        ele: typeof s.elevationInMeters === 'number' ? s.elevationInMeters : 0,
        time: s.startTimeInSeconds ? new Date(s.startTimeInSeconds * 1000) : undefined,
        hr: s.heartRate,
        cadence: s.bikeCadenceInRPM ?? s.stepsPerMinute,
        power: s.powerInWatts
      }));
  }

  return [];
}

/**
 * Downloads and parses a binary .FIT file (or ZIP containing .FIT, or GPX/JSON stream)
 * for a given Garmin Activity ID, updating SQLite `garmin_activities` and `tracks`.
 */
export async function downloadAndParseGarminActivityFit(
  activityId: string,
  options?: { saveToWorkspaceTracks?: boolean; overrideApiKey?: string; accessToken?: string }
): Promise<{
  track: GPXTrack;
  pointsCount: number;
  sourceFormat: 'fit' | 'gpx' | 'json_details';
}> {
  const cleanId = String(activityId).trim().replace(/^garmin-act-/, '');
  const { baseUrl } = getActiveGarminApiKey(options?.overrideApiKey);
  const accessToken = options?.accessToken
    ? options.accessToken
    : (await getGarminBearerToken(options?.overrideApiKey)).accessToken;

  const existingRecord = getGarminActivityById(cleanId);

  const binaryUrls = [
    `${baseUrl}/personal-api/activities/${encodeURIComponent(cleanId)}/fit`,
    `${baseUrl}/download-service/files/activity/${encodeURIComponent(cleanId)}`,
    `${baseUrl}/wellness-api/rest/activityFile?id=${encodeURIComponent(cleanId)}`,
    `${baseUrl}/download-service/export/gpx/activity/${encodeURIComponent(cleanId)}`
  ];

  let parsedTrack: GPXTrack | null = null;
  let sourceFormat: 'fit' | 'gpx' | 'json_details' = 'fit';

  try {
    const { buffer } = await fetchGarminBinaryWithFallback(binaryUrls, accessToken);

    // Check if buffer is a PK ZIP archive (0x50 0x4B 0x03 0x04)
    let fitBuffer: Uint8Array = new Uint8Array(buffer);
    if (buffer.length >= 4 && buffer[0] === 0x50 && buffer[1] === 0x4b && buffer[2] === 0x03 && buffer[3] === 0x04) {
      let totalUncompressedBytes = 0;
      const unzipped = unzipSync(new Uint8Array(buffer), {
        filter(file) {
          totalUncompressedBytes += file.originalSize || 0;
          if (totalUncompressedBytes > MAX_UNZIPPED_FIT_BYTES) {
            throw new Error('Entpackte FIT-/ZIP-Datei überschreitet das Sicherheitslimit von 100 MB.');
          }
          return true;
        }
      });
      const fitEntryName = Object.keys(unzipped).find(name => name.toLowerCase().endsWith('.fit')) || Object.keys(unzipped)[0];
      if (fitEntryName && unzipped[fitEntryName]) {
        if (unzipped[fitEntryName].byteLength > MAX_UNZIPPED_FIT_BYTES) {
          throw new Error('Entpackte FIT-Datei überschreitet das Sicherheitslimit von 100 MB.');
        }
        fitBuffer = unzipped[fitEntryName];
      }
    }

    // Check if XML/GPX text
    const headerAscii = Buffer.from(fitBuffer.slice(0, 64)).toString('utf8').trim();
    if (headerAscii.startsWith('<?xml') || headerAscii.startsWith('<gpx')) {
      sourceFormat = 'gpx';
      const gpxString = Buffer.from(fitBuffer).toString('utf8');
      parsedTrack = await parseGPX(gpxString, `garmin_${cleanId}.gpx`);
    } else {
      sourceFormat = 'fit';
      const arrayBuf = fitBuffer.buffer.slice(fitBuffer.byteOffset, fitBuffer.byteOffset + fitBuffer.byteLength);
      parsedTrack = await parseFIT(arrayBuf as ArrayBuffer, `garmin_${cleanId}.fit`);
    }
  } catch (binaryErr) {
    // Fallback to JSON activity details if binary FIT endpoint is unavailable for this activity
    const detailUrls = [
      `${baseUrl}/personal-api/activities/${encodeURIComponent(cleanId)}/details`,
      `${baseUrl}/activity-service/activity/${encodeURIComponent(cleanId)}/details`,
      `${baseUrl}/activity-service/activity/${encodeURIComponent(cleanId)}`
    ];
    const { data: detailData } = await fetchGarminJsonWithFallback(detailUrls, accessToken);
    const pts = extractPointsFromGarminDetailsJson(detailData);
    if (pts.length > 1) {
      sourceFormat = 'json_details';
      const { ascent, descent, maxSlope, totalDist } = calculateElevationStats(pts);
      const actType = existingRecord?.type === 'running' ? 'running' : 'cycling';
      const powerStats = calculatePowerStats(pts, 250, 75, 20, actType);
      const surfaceStats = calculateSurfaceStatsFromPoints(pts);
      hydratePointsWithSurface(pts, surfaceStats, totalDist);
      const climbs = findClimbs(pts);

      parsedTrack = {
        id: `garmin-fit-${cleanId}`,
        name: existingRecord?.name || detailData?.activityName || `Garmin Aktivität #${cleanId}`,
        points: pts,
        color: '#0284c7',
        distance: Number(totalDist.toFixed(2)),
        ascent,
        descent,
        maxSlope,
        visible: true,
        activityType: actType,
        powerStats,
        surfaceStats,
        duration: existingRecord?.duration || detailData?.summaryDTO?.duration,
        hasTimestamps: pts.some(p => p.time !== undefined),
        climbs
      };
    } else {
      throw binaryErr;
    }
  }

  if (!parsedTrack || !parsedTrack.points || parsedTrack.points.length === 0) {
    throw new Error(`Keine gültigen GPS-Punkte in der heruntergeladenen Garmin-Aktivität #${cleanId} gefunden.`);
  }

  if (existingRecord?.name) {
    parsedTrack.name = existingRecord.name;
  }

  // Persist points_json back to garmin_activities
  const compactPoints = parsedTrack.points.map(p => ({
    lat: Number(p.lat.toFixed(6)),
    lng: Number(p.lng.toFixed(6)),
    ele: Number((p.ele ?? 0).toFixed(1)),
    time: p.time instanceof Date ? p.time.toISOString() : p.time,
    hr: p.hr,
    cadence: p.cadence,
    power: p.power,
    slope: p.slope !== undefined ? Number(p.slope.toFixed(1)) : undefined
  }));

  saveGarminActivity(
    cleanId,
    parsedTrack.name,
    existingRecord?.type || parsedTrack.activityType || 'cycling',
    existingRecord?.date || (parsedTrack.points[0]?.time instanceof Date ? parsedTrack.points[0].time.toISOString() : new Date().toISOString()),
    parsedTrack.distance || existingRecord?.distance || 0,
    parsedTrack.duration || existingRecord?.duration || 0,
    parsedTrack.ascent ?? existingRecord?.ascent,
    parsedTrack.descent ?? existingRecord?.descent,
    existingRecord?.calories ?? parsedTrack.powerStats?.work,
    existingRecord?.avg_hr,
    existingRecord?.description || parsedTrack.description,
    existingRecord?.location,
    JSON.stringify(compactPoints)
  );

  if (options?.saveToWorkspaceTracks !== false) {
    try {
      saveTrack({
        ...parsedTrack,
        originalFilename: `garmin_${cleanId}.fit`,
        tags: Array.isArray(parsedTrack.tags) ? parsedTrack.tags.join(',') : parsedTrack.tags
      });
    } catch (e) {
      console.warn('Warning saving FIT track to tracks table:', e);
    }
  }

  return {
    track: parsedTrack,
    pointsCount: parsedTrack.points.length,
    sourceFormat
  };
}

/**
 * Synchronizes activities from the Garmin Connect Personal API within a date range,
 * saving summaries into `garmin_activities` and optionally downloading .FIT GPS routes.
 */
export async function syncGarminPersonalActivities(options: {
  startDate?: string;
  endDate?: string;
  limit?: number;
  downloadFitRoutes?: boolean;
  overrideApiKey?: string;
}): Promise<{
  syncedCount: number;
  fitDownloadedCount: number;
  activities: any[];
  endpointUsed: string;
}> {
  const { baseUrl } = getActiveGarminApiKey(options.overrideApiKey);
  const { accessToken } = await getGarminBearerToken(options.overrideApiKey);

  const end = options.endDate || new Date().toISOString().slice(0, 10);
  const start = options.startDate || new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
  const limit = Math.min(200, Math.max(1, Number(options.limit || 50)));

  const startEpochSec = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
  const endEpochSec = Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000);

  const candidateUrls = [
    `${baseUrl}/personal-api/activities?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&limit=${limit}`,
    `${baseUrl}/activitylist-service/activities/search/activities?start=0&limit=${limit}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
    `${baseUrl}/wellness-api/rest/activities?uploadStartTimeInSeconds=${startEpochSec}&uploadEndTimeInSeconds=${endEpochSec}`
  ];

  const { data: rawPayload, usedUrl } = await fetchGarminJsonWithFallback(candidateUrls, accessToken);

  const rawList: any[] = Array.isArray(rawPayload)
    ? rawPayload
    : Array.isArray(rawPayload?.activities)
    ? rawPayload.activities
    : Array.isArray(rawPayload?.activityList)
    ? rawPayload.activityList
    : Array.isArray(rawPayload?.data)
    ? rawPayload.data
    : [];

  const normalizedActivities: any[] = [];

  runInTransaction(() => {
    for (const item of rawList) {
      const id = String(item.activityId || item.id || item.summaryId || `${Date.now()}-${Math.random()}`);
      const name = String(item.activityName || item.name || item.activityType?.typeKey || 'Garmin Aktivität');
      const sportType = normalizeGarminSportType(item.activityType || item.sportType || item.type);

      const rawDate =
        item.startTimeLocal ||
        item.startTimeGMT ||
        (item.startTimeInSeconds ? new Date(item.startTimeInSeconds * 1000).toISOString() : null) ||
        item.date ||
        new Date().toISOString();

      // Garmin API returns distance in meters
      const rawDist = Number(item.distance ?? item.distanceInMeters ?? 0);
      const distanceKm = rawDist > 300 ? Number((rawDist / 1000).toFixed(2)) : Number(rawDist.toFixed(2));

      const durationSec = Math.round(Number(item.duration ?? item.durationInSeconds ?? item.movingDuration ?? 0));
      const ascentM = item.elevationGain !== undefined
        ? Math.round(Number(item.elevationGain))
        : item.totalElevationGainInMeters !== undefined
        ? Math.round(Number(item.totalElevationGainInMeters))
        : undefined;
      const descentM = item.elevationLoss !== undefined
        ? Math.round(Number(item.elevationLoss))
        : item.totalElevationLossInMeters !== undefined
        ? Math.round(Number(item.totalElevationLossInMeters))
        : undefined;
      const calories = item.calories !== undefined
        ? Math.round(Number(item.calories))
        : item.activeKilocalories !== undefined
        ? Math.round(Number(item.activeKilocalories))
        : undefined;
      const avgHr = item.averageHR !== undefined
        ? Math.round(Number(item.averageHR))
        : item.averageHeartRateInBeatsPerMinute !== undefined
        ? Math.round(Number(item.averageHeartRateInBeatsPerMinute))
        : undefined;

      const location = item.locationName || item.location || undefined;
      const description = item.description || undefined;

      // Preserve existing points_json if already downloaded
      const existing = getGarminActivityById(id);
      let pointsJson = existing?.points_json;

      if (!pointsJson && Array.isArray(item.samples)) {
        const pts = extractPointsFromGarminDetailsJson(item);
        if (pts.length > 1) {
          pointsJson = JSON.stringify(pts);
        }
      } else if (!pointsJson && typeof item.startLatitude === 'number' && typeof item.startLongitude === 'number') {
        const seedPoints = [{ lat: item.startLatitude, lng: item.startLongitude, ele: item.minElevation || 0 }];
        if (typeof item.endLatitude === 'number' && typeof item.endLongitude === 'number') {
          seedPoints.push({ lat: item.endLatitude, lng: item.endLongitude, ele: item.maxElevation || 0 });
        }
        pointsJson = JSON.stringify(seedPoints);
      }

      saveGarminActivity(
        id,
        name,
        sportType,
        String(rawDate),
        distanceKm,
        durationSec,
        ascentM,
        descentM,
        calories,
        avgHr,
        description,
        location,
        pointsJson
      );

      normalizedActivities.push({
        id,
        name,
        type: sportType,
        date: String(rawDate),
        distance: distanceKm,
        duration: durationSec,
        ascent: ascentM,
        descent: descentM,
        calories,
        avg_hr: avgHr,
        location,
        description,
        hasGps: Boolean(pointsJson && pointsJson.length > 80)
      });
    }
  });

  let fitDownloadedCount = 0;
  if (options.downloadFitRoutes && normalizedActivities.length > 0) {
    // Download FIT files for top 10 most recent activities to avoid gateway timeouts
    const batch = normalizedActivities.slice(0, 10);
    for (const act of batch) {
      try {
        await downloadAndParseGarminActivityFit(act.id, {
          saveToWorkspaceTracks: true,
          overrideApiKey: options.overrideApiKey,
          accessToken
        });
        fitDownloadedCount++;
        act.hasGps = true;
      } catch {
        // Continue with remaining activities if an indoor workout has no FIT GPS file
      }
    }
  }

  const nowIso = new Date().toISOString();
  saveSetting('garmin_personal_last_sync_at', nowIso);

  return {
    syncedCount: normalizedActivities.length,
    fitDownloadedCount,
    activities: normalizedActivities,
    endpointUsed: usedUrl
  };
}

/**
 * Synchronizes daily Health Metrics (Sleep, RHR, Stress, Steps, Weight) from the Garmin Connect Personal API.
 */
export async function syncGarminPersonalHealth(options: {
  startDate?: string;
  endDate?: string;
  overrideApiKey?: string;
}): Promise<{
  sleepCount: number;
  rhrCount: number;
  stressCount: number;
  stepsCount: number;
  weightCount: number;
}> {
  const { baseUrl } = getActiveGarminApiKey(options.overrideApiKey);
  const { accessToken } = await getGarminBearerToken(options.overrideApiKey);

  const end = options.endDate || new Date().toISOString().slice(0, 10);
  const start = options.startDate || new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);

  const startEpochSec = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
  const endEpochSec = Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000);

  let sleepCount = 0;
  let rhrCount = 0;
  let stressCount = 0;
  let stepsCount = 0;
  let weightCount = 0;

  // 1. Fetch Dailies (Steps, RHR, Stress, Calories)
  try {
    const dailiesUrls = [
      `${baseUrl}/personal-api/dailies?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
      `${baseUrl}/wellness-api/rest/dailies?uploadStartTimeInSeconds=${startEpochSec}&uploadEndTimeInSeconds=${endEpochSec}`,
      `${baseUrl}/userstats-service/wellness/daily/${encodeURIComponent(start)}?untilDate=${encodeURIComponent(end)}`
    ];
    const { data: dailiesPayload } = await fetchGarminJsonWithFallback(dailiesUrls, accessToken);
    const dailiesList: any[] = Array.isArray(dailiesPayload)
      ? dailiesPayload
      : Array.isArray(dailiesPayload?.dailies)
      ? dailiesPayload.dailies
      : Array.isArray(dailiesPayload?.allMetrics?.metricsMap?.WELLNESS_TOTAL_STEPS)
      ? dailiesPayload.allMetrics.metricsMap.WELLNESS_TOTAL_STEPS
      : Array.isArray(dailiesPayload?.data)
      ? dailiesPayload.data
      : [];

    runInTransaction(() => {
      for (const d of dailiesList) {
        const dateStr = String(
          d.calendarDate ||
          d.date ||
          (d.startTimeInSeconds ? new Date(d.startTimeInSeconds * 1000).toISOString().slice(0, 10) : '')
        ).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

        const steps = Number(d.totalSteps ?? d.steps ?? d.value ?? 0);
        const calories = Number(d.totalKilocalories ?? d.activeKilocalories ?? d.calories ?? 0) || undefined;
        const distMeters = Number(d.totalDistanceMeters ?? d.distanceInMeters ?? d.distance ?? 0);
        const distKm = distMeters > 100 ? Number((distMeters / 1000).toFixed(2)) : distMeters || undefined;

        if (!isNaN(steps) && steps > 0) {
          saveSteps(dateStr, Math.round(steps), calories ? Math.round(calories) : undefined, distKm);
          stepsCount++;
        }

        const rhr = Number(d.restingHeartRateInBeatsPerMinute ?? d.restingHeartRate ?? d.rhr ?? 0);
        if (!isNaN(rhr) && rhr >= 30 && rhr <= 140) {
          saveRhr(dateStr, Math.round(rhr));
          rhrCount++;
        }

        const avgStress = Number(d.averageStressLevel ?? d.overallStressLevel ?? d.avg_stress ?? 0);
        if (!isNaN(avgStress) && avgStress > 0 && avgStress <= 100) {
          saveStress(dateStr, Math.round(avgStress));
          stressCount++;
        }
      }
    });
  } catch (e: any) {
    console.warn('[Garmin Personal API] Dailies sync warning:', e?.message);
  }

  // 2. Fetch Sleep Summaries
  try {
    const sleepUrls = [
      `${baseUrl}/personal-api/sleep?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
      `${baseUrl}/wellness-api/rest/sleeps?uploadStartTimeInSeconds=${startEpochSec}&uploadEndTimeInSeconds=${endEpochSec}`,
      `${baseUrl}/sleep-service/sleep/dailySleepData?date=${encodeURIComponent(end)}&nonSleepBufferMinutes=60`
    ];
    const { data: sleepPayload } = await fetchGarminJsonWithFallback(sleepUrls, accessToken);
    const sleepList: any[] = Array.isArray(sleepPayload)
      ? sleepPayload
      : Array.isArray(sleepPayload?.sleeps)
      ? sleepPayload.sleeps
      : sleepPayload?.dailySleepDTO
      ? [sleepPayload.dailySleepDTO]
      : Array.isArray(sleepPayload?.data)
      ? sleepPayload.data
      : [];

    runInTransaction(() => {
      for (const s of sleepList) {
        const dto = s.dailySleepDTO || s;
        const dateStr = String(
          dto.calendarDate ||
          dto.date ||
          (dto.startTimeInSeconds ? new Date(dto.startTimeInSeconds * 1000).toISOString().slice(0, 10) : '')
        ).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

        const totalSec = Number(dto.sleepTimeSeconds ?? dto.durationInSeconds ?? dto.duration ?? 0);
        // Convert seconds to minutes if > 1000, otherwise assume minutes
        const durationMin = totalSec > 1000 ? Math.round(totalSec / 60) : Math.round(totalSec);
        if (durationMin <= 0) continue;

        const deepSec = Number(dto.deepSleepSeconds ?? dto.deepSleepDurationInSeconds ?? dto.deep ?? 0);
        const lightSec = Number(dto.lightSleepSeconds ?? dto.lightSleepDurationInSeconds ?? dto.light ?? 0);
        const remSec = Number(dto.remSleepSeconds ?? dto.remSleepInSeconds ?? dto.rem ?? 0);
        const awakeSec = Number(dto.awakeSleepSeconds ?? dto.awakeDurationInSeconds ?? dto.awake ?? 0);

        saveSleep(
          dateStr,
          durationMin,
          deepSec > 600 ? Math.round(deepSec / 60) : Math.round(deepSec) || undefined,
          lightSec > 600 ? Math.round(lightSec / 60) : Math.round(lightSec) || undefined,
          remSec > 600 ? Math.round(remSec / 60) : Math.round(remSec) || undefined,
          awakeSec > 600 ? Math.round(awakeSec / 60) : Math.round(awakeSec) || undefined
        );
        sleepCount++;
      }
    });
  } catch (e: any) {
    console.warn('[Garmin Personal API] Sleep sync warning:', e?.message);
  }

  // 3. Fetch Weight / Body Composition
  try {
    const weightUrls = [
      `${baseUrl}/personal-api/weight?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
      `${baseUrl}/weight-service/weight/dateRange?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
      `${baseUrl}/wellness-api/rest/bodyComps?uploadStartTimeInSeconds=${startEpochSec}&uploadEndTimeInSeconds=${endEpochSec}`
    ];
    const { data: weightPayload } = await fetchGarminJsonWithFallback(weightUrls, accessToken);
    const weightList: any[] = Array.isArray(weightPayload)
      ? weightPayload
      : Array.isArray(weightPayload?.dateWeightList)
      ? weightPayload.dateWeightList
      : Array.isArray(weightPayload?.bodyComps)
      ? weightPayload.bodyComps
      : Array.isArray(weightPayload?.data)
      ? weightPayload.data
      : [];

    runInTransaction(() => {
      for (const w of weightList) {
        const dateStr = String(
          w.calendarDate ||
          w.date ||
          (w.measurementTimeInSeconds ? new Date(w.measurementTimeInSeconds * 1000).toISOString().slice(0, 10) : '') ||
          (w.timestampGMT ? new Date(w.timestampGMT).toISOString().slice(0, 10) : '')
        ).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

        const rawWeight = Number(w.weight ?? w.weightInGrams ?? 0);
        // Garmin often stores weight in grams (e.g., 75200 = 75.2 kg)
        const weightKg = rawWeight > 500 ? Number((rawWeight / 1000).toFixed(1)) : Number(rawWeight.toFixed(1));
        if (isNaN(weightKg) || weightKg < 25 || weightKg > 300) continue;

        const bmi = w.bmi !== undefined ? Number(Number(w.bmi).toFixed(1)) : undefined;
        const bodyFat = (w.bodyFat ?? w.bodyFatInPercent) !== undefined ? Number(Number(w.bodyFat ?? w.bodyFatInPercent).toFixed(1)) : undefined;

        saveWeight(dateStr, weightKg, bmi, bodyFat);
        weightCount++;
      }
    });
  } catch (e: any) {
    console.warn('[Garmin Personal API] Weight sync warning:', e?.message);
  }

  saveSetting('garmin_personal_last_sync_at', new Date().toISOString());

  return {
    sleepCount,
    rhrCount,
    stressCount,
    stepsCount,
    weightCount
  };
}
