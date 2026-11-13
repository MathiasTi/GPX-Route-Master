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
  getGarminActivityById,
  findExistingActivityDuplicate,
  backfillMissingHealthMetricsFromExistingData
} from './db';
import { parseFIT } from './fitUtils';
import { parseGPX, calculateElevationStats, calculatePowerStats, findClimbs, calculateSurfaceStatsFromPoints, hydratePointsWithSurface, generateVirtualRoute } from './gpxUtils';
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

export type GarminSyncPhase =
  | 'idle'
  | 'auth'
  | 'activities_list'
  | 'fit_download'
  | 'health_dailies'
  | 'health_sleep'
  | 'health_weight'
  | 'done'
  | 'error';

export interface GarminSyncProgress {
  active: boolean;
  phase: GarminSyncPhase;
  message: string;
  percent: number;
  updatedAt: string;
  stats: {
    newActivities: number;
    updatedActivities: number;
    skippedDuplicates: number;
    fitDownloaded: number;
    fitRepaired: number;
    fitFailed: number;
    healthDays: number;
  };
}

let activeSyncJobs = 0;
let syncProgressState: GarminSyncProgress = {
  active: false,
  phase: 'idle',
  message: 'Bereit für Synchronisation',
  percent: 0,
  updatedAt: new Date().toISOString(),
  stats: {
    newActivities: 0,
    updatedActivities: 0,
    skippedDuplicates: 0,
    fitDownloaded: 0,
    fitRepaired: 0,
    fitFailed: 0,
    healthDays: 0
  }
};

export function getGarminSyncProgress(): GarminSyncProgress {
  return {
    ...syncProgressState,
    stats: { ...syncProgressState.stats }
  };
}

function resetSyncProgressIfIdle() {
  if (activeSyncJobs === 0) {
    syncProgressState = {
      active: true,
      phase: 'auth',
      message: 'Verbinde mit Garmin Connect Cloud...',
      percent: 5,
      updatedAt: new Date().toISOString(),
      stats: {
        newActivities: 0,
        updatedActivities: 0,
        skippedDuplicates: 0,
        fitDownloaded: 0,
        fitRepaired: 0,
        fitFailed: 0,
        healthDays: 0
      }
    };
  }
}

function updateSyncProgress(
  patch: Partial<Omit<GarminSyncProgress, 'stats'>> & { stats?: Partial<GarminSyncProgress['stats']> }
) {
  syncProgressState = {
    ...syncProgressState,
    ...patch,
    updatedAt: new Date().toISOString(),
    stats: {
      ...syncProgressState.stats,
      ...(patch.stats || {})
    }
  };
}

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

  const cleanRawKey = rawKey.replace(/[\u200B-\u200D\uFEFF\u00AD\r\n]+/g, '').trim();
  if (!/^[\x20-\x7E]+$/.test(cleanRawKey)) {
    throw new Error('Ungültiger Garmin Personal API Key: Der Schlüssel enthält ungültige nicht-ASCII-Zeichen.');
  }

  const keySignature = buildKeySignature(baseUrl, cleanRawKey);

  // If the user provided a direct Bearer JWT token (e.g. eyJ...), allow direct usage
  if (cleanRawKey.startsWith('Bearer ') || (cleanRawKey.startsWith('eyJ') && cleanRawKey.split('.').length === 3)) {
    const cleanJwt = cleanRawKey.replace(/^Bearer\s+/i, '').trim();
    const expiresAtMs = resolveTokenExpiryMs(cleanJwt, 86400);
    const iso = new Date(expiresAtMs).toISOString();
    ephemeralVerifiedMeta = {
      expiresAtMs,
      apiKeyHash: keySignature
    };
    return { accessToken: cleanJwt, expiresAt: iso };
  }

  const tokenUrl = `${baseUrl}${TOKEN_ENDPOINT_PATH}`;
  const cleanApiKey = cleanRawKey.replace(/^(ApiKey|Bearer)\s+/i, '').trim();

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

function isEmptyGarminPayload(parsed: any): boolean {
  if (parsed === null || parsed === undefined) return true;
  if (Array.isArray(parsed)) return parsed.length === 0;
  if (typeof parsed === 'object') {
    const keys = Object.keys(parsed);
    if (keys.length === 0) return true;
    const arrayKeys = ['dailies', 'stressDetails', 'userMetrics', 'data', 'sleeps', 'dateWeightList', 'bodyComps'];
    const hasKnownArray = arrayKeys.some((k) => Array.isArray(parsed[k]));
    if (hasKnownArray && arrayKeys.every((k) => !Array.isArray(parsed[k]) || parsed[k].length === 0)) {
      return true;
    }
  }
  return false;
}

async function fetchGarminJsonWithFallback(
  urls: string[],
  accessToken: string,
  options?: { allowNotFoundAsEmpty?: boolean }
): Promise<{ data: any; usedUrl: string }> {
  const errors: string[] = [];
  let allNotFound = true;
  let lastEmptyResult: { data: any; usedUrl: string } | null = null;

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
          lastEmptyResult = { data: [], usedUrl: url };
          continue;
        }
        try {
          const parsed = JSON.parse(text);
          if (isEmptyGarminPayload(parsed)) {
            lastEmptyResult = { data: parsed, usedUrl: url };
            continue;
          }
          return { data: parsed, usedUrl: url };
        } catch {
          lastEmptyResult = { data: [], usedUrl: url };
          continue;
        }
      } else {
        if (res.status !== 404 && res.status !== 204) {
          allNotFound = false;
        }
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
      allNotFound = false;
      errors.push(`${url}: ${e?.message || 'Netzwerkfehler'}`);
    }
  }

  if (lastEmptyResult) {
    return lastEmptyResult;
  }

  if (options?.allowNotFoundAsEmpty && allNotFound) {
    return { data: [], usedUrl: urls[0] || '' };
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

function hasDetailedGpsPointsJson(rawJson?: string | null): boolean {
  if (!rawJson || typeof rawJson !== 'string') return false;
  try {
    const parsed = JSON.parse(rawJson);
    return Array.isArray(parsed) && parsed.length > 2;
  } catch {
    return false;
  }
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
  integrityStatus: 'valid' | 'repaired' | 'fallback';
  repairedIssues: string[];
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
      if (!parsedTrack || !parsedTrack.points || parsedTrack.points.length === 0) {
        throw new Error('FIT-Datei korrupt oder ohne verwertbare Datensätze');
      }
    }
  } catch {
    // Fallback to JSON activity details if binary FIT endpoint is unavailable for this activity
    try {
      const detailUrls = [
        `${baseUrl}/personal-api/activities/${encodeURIComponent(cleanId)}/details`,
        `${baseUrl}/activity-service/activity/${encodeURIComponent(cleanId)}/details`,
        `${baseUrl}/activity-service/activity/${encodeURIComponent(cleanId)}`
      ];
      const { data: detailData } = await fetchGarminJsonWithFallback(detailUrls, accessToken, { allowNotFoundAsEmpty: true });
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
      }
    } catch {
      // Continue to virtual route fallback below
    }
  }

  if (!parsedTrack || !parsedTrack.points || parsedTrack.points.length === 0) {
    const distKm = existingRecord?.distance || 5;
    const durSec = existingRecord?.duration || 1800;
    const actType = existingRecord?.type === 'running' ? 'running' : 'cycling';
    const virtualPts = generateVirtualRoute(
      48.137154,
      11.576124,
      distKm,
      durSec,
      existingRecord?.ascent || 20,
      existingRecord?.descent || 20,
      existingRecord?.avg_hr,
      actType
    );
    parsedTrack = {
      id: `garmin-fit-${cleanId}`,
      name: existingRecord?.name || `Garmin Aktivität #${cleanId}`,
      points: virtualPts,
      color: '#0284c7',
      distance: Number(distKm.toFixed(2)),
      ascent: existingRecord?.ascent || 20,
      descent: existingRecord?.descent || 20,
      maxSlope: 2,
      visible: true,
      activityType: actType,
      duration: durSec,
      hasTimestamps: true,
      isVirtual: true,
      tags: ['Indoor/Virtuell']
    };
  }

  if (existingRecord?.name) {
    parsedTrack.name = existingRecord.name;
  }

  // Persist points_json back to garmin_activities ONLY when genuine GPS points exist.
  // Virtual/indoor activities stay without fake coordinates in SQLite so maps remain clean.
  const compactPoints = !parsedTrack.isVirtual
    ? parsedTrack.points.map(p => ({
        lat: Number(p.lat.toFixed(6)),
        lng: Number(p.lng.toFixed(6)),
        ele: Number((p.ele ?? 0).toFixed(1)),
        time: p.time instanceof Date ? p.time.toISOString() : p.time,
        hr: p.hr,
        cadence: p.cadence,
        power: p.power,
        slope: p.slope !== undefined ? Number(p.slope.toFixed(1)) : undefined
      }))
    : null;

  const authenticGarminDate =
    existingRecord?.date ||
    parsedTrack.dateCreated ||
    (parsedTrack.points[0]?.time instanceof Date
      ? parsedTrack.points[0].time.toISOString()
      : new Date().toISOString());

  saveGarminActivity(
    cleanId,
    parsedTrack.name,
    existingRecord?.type || parsedTrack.activityType || 'cycling',
    authenticGarminDate,
    parsedTrack.distance || existingRecord?.distance || 0,
    parsedTrack.duration || existingRecord?.duration || 0,
    parsedTrack.ascent ?? existingRecord?.ascent,
    parsedTrack.descent ?? existingRecord?.descent,
    existingRecord?.calories ?? parsedTrack.powerStats?.work,
    existingRecord?.avg_hr,
    existingRecord?.description || parsedTrack.description,
    existingRecord?.location,
    compactPoints ? JSON.stringify(compactPoints) : existingRecord?.points_json || undefined
  );

  if (options?.saveToWorkspaceTracks === true) {
    try {
      saveTrack({
        ...parsedTrack,
        dateCreated: parsedTrack.dateCreated || existingRecord?.date,
        originalFilename: `garmin_${cleanId}.fit`,
        tags: Array.isArray(parsedTrack.tags) ? parsedTrack.tags.join(',') : parsedTrack.tags
      });
    } catch (e) {
      console.warn('Warning saving FIT track to tracks table:', e);
    }
  }

  const fitMeta = (parsedTrack.rawFileDetails?.metadata || {}) as any;
  const repairedIssues: string[] = Array.isArray(fitMeta.repairedIssues) ? fitMeta.repairedIssues : [];
  const integrityStatus: 'valid' | 'repaired' | 'fallback' =
    sourceFormat === 'json_details' || parsedTrack.isVirtual
      ? 'fallback'
      : repairedIssues.length > 0 || fitMeta.integrityStatus === 'repaired'
      ? 'repaired'
      : 'valid';

  return {
    track: parsedTrack,
    pointsCount: parsedTrack.isVirtual ? 0 : parsedTrack.points.length,
    sourceFormat,
    integrityStatus,
    repairedIssues
  };
}

function extractActivityArrayFromPayload(rawPayload: any): any[] {
  if (Array.isArray(rawPayload)) return rawPayload;
  if (Array.isArray(rawPayload?.activities)) return rawPayload.activities;
  if (Array.isArray(rawPayload?.activityList)) return rawPayload.activityList;
  if (Array.isArray(rawPayload?.data)) return rawPayload.data;
  return [];
}

function extractActivityDateStr(item: any): string {
  const rawDate =
    item.startTimeLocal ||
    item.startTimeGMT ||
    (item.startTimeInSeconds ? new Date(item.startTimeInSeconds * 1000).toISOString() : null) ||
    item.date ||
    new Date().toISOString();
  return String(rawDate);
}

/**
 * Synchronizes activities from the Garmin Connect Personal API within a date range,
 * saving summaries into `garmin_activities` and optionally downloading .FIT GPS routes.
 * Automatically paginates backwards through history and falls back to parameterless
 * search endpoints if Garmin's date-filtered search returns HTTP 500.
 */
export async function syncGarminPersonalActivities(options: {
  startDate?: string;
  endDate?: string;
  limit?: number;
  downloadFitRoutes?: boolean;
  overrideApiKey?: string;
}): Promise<{
  syncedCount: number;
  newActivities: number;
  updatedActivities: number;
  skippedDuplicates: number;
  fitDownloadedCount: number;
  fitRepairedCount: number;
  fitFailedCount: number;
  activities: any[];
  endpointUsed: string;
}> {
  resetSyncProgressIfIdle();
  activeSyncJobs++;
  try {
    updateSyncProgress({
      active: true,
      phase: 'auth',
      message: 'Prüfe OAuth2-Token & lade Aktivitätenliste...',
      percent: 10
    });
    const { baseUrl } = getActiveGarminApiKey(options.overrideApiKey);
    const { accessToken } = await getGarminBearerToken(options.overrideApiKey);

    const end = options.endDate || new Date().toISOString().slice(0, 10);
    const start = options.startDate || new Date(Date.now() - 30 * 86400 * 1000).toISOString().slice(0, 10);
    // Internal page size: 50 is reliable on Garmin Connect; falls back to 20 if needed
    const pageSize = options.limit ? Math.min(50, Math.max(10, Number(options.limit))) : 50;
    const maxPages = 20;

    const startEpochSec = Math.floor(new Date(`${start}T00:00:00Z`).getTime() / 1000);
    const endEpochSec = Math.floor(new Date(`${end}T23:59:59Z`).getTime() / 1000);

    const collectedItems: any[] = [];
    const seenActivityIds = new Set<string>();
    let offset = 0;
    let lastUsedUrl = '';

    for (let page = 0; page < maxPages; page++) {
      const candidateUrls = [
        `${baseUrl}/activitylist-service/activities/search/activities?start=${offset}&limit=${pageSize}&startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
        `${baseUrl}/activitylist-service/activities/search/activities?start=${offset}&limit=${pageSize}`,
        `${baseUrl}/activitylist-service/activities/search/activities?start=${offset}&limit=20`,
        `${baseUrl}/activitylist-service/activities?start=${offset}&limit=20`,
        ...(offset === 0
          ? [
              `${baseUrl}/personal-api/activities?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}&limit=${pageSize}`,
              `${baseUrl}/wellness-api/rest/activities?uploadStartTimeInSeconds=${startEpochSec}&uploadEndTimeInSeconds=${endEpochSec}`
            ]
          : [])
      ];

      updateSyncProgress({
        phase: 'activities_list',
        message: `Rufe Aktivitäten (${start} bis ${end}, Seite ${page + 1}) ab...`,
        percent: Math.min(40, 15 + page * 3)
      });

      const { data: rawPayload, usedUrl } = await fetchGarminJsonWithFallback(candidateUrls, accessToken, {
        allowNotFoundAsEmpty: page > 0
      });
      lastUsedUrl = usedUrl;

      const pageItems = extractActivityArrayFromPayload(rawPayload);
      if (pageItems.length === 0) {
        break;
      }

      let reachedBeforeStart = false;
      for (const item of pageItems) {
        const id = String(item.activityId || item.id || item.summaryId || '');
        const dateYmd = extractActivityDateStr(item).slice(0, 10);

        if (dateYmd && dateYmd < start) {
          reachedBeforeStart = true;
          continue;
        }
        if (dateYmd && dateYmd > end) {
          continue;
        }
        if (id && seenActivityIds.has(id)) {
          continue;
        }
        if (id) seenActivityIds.add(id);
        collectedItems.push(item);
      }

      offset += pageItems.length;

      // Determine effective limit used by the winning URL to detect the final page
      const limitMatch = usedUrl.match(/[?&]limit=(\d+)/);
      const effectiveLimit = limitMatch ? Number(limitMatch[1]) : pageSize;
      if (reachedBeforeStart || pageItems.length < effectiveLimit || usedUrl.includes('/wellness-api/')) {
        break;
      }
    }

    const rawList = collectedItems;
    const usedUrl = lastUsedUrl;

    const normalizedActivities: any[] = [];
    let newActivities = 0;
    let updatedActivities = 0;
    let skippedDuplicates = 0;

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

        // 2-stage duplicate check (ID + Timestamp/Distance/Duration fingerprint across garmin_activities & tracks)
        const dupMatch = findExistingActivityDuplicate({
          id,
          date: String(rawDate),
          distanceKm,
          durationSec,
          name
        });

        let samplePointsJson: string | undefined;
        if (Array.isArray(item.samples)) {
          const pts = extractPointsFromGarminDetailsJson(item);
          if (pts.length > 2) {
            samplePointsJson = JSON.stringify(pts);
          }
        }

        if (dupMatch.matched && dupMatch.hasDetailedGps) {
          skippedDuplicates++;
          continue;
        }

        const targetId = dupMatch.matched && dupMatch.source === 'garmin' && dupMatch.existingId
          ? dupMatch.existingId
          : id;

        const existing = getGarminActivityById(targetId);
        const pointsJson = hasDetailedGpsPointsJson(existing?.points_json)
          ? existing?.points_json
          : samplePointsJson;

        if (dupMatch.matched) {
          updatedActivities++;
        } else {
          newActivities++;
        }

        saveGarminActivity(
          targetId,
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
          id: targetId,
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
          hasGps: hasDetailedGpsPointsJson(pointsJson)
        });
      }
    });

    updateSyncProgress({
      phase: 'fit_download',
      message: `${newActivities} neu, ${updatedActivities} aktualisiert, ${skippedDuplicates} Dupletten übersprungen.`,
      percent: 45,
      stats: {
        newActivities,
        updatedActivities,
        skippedDuplicates
      }
    });

    let fitDownloadedCount = 0;
    let fitRepairedCount = 0;
    let fitFailedCount = 0;

    if (options.downloadFitRoutes && normalizedActivities.length > 0) {
      const batch = normalizedActivities.filter((a) => !a.hasGps);
      for (let i = 0; i < batch.length; i++) {
        const act = batch[i];
        const pct = 45 + Math.round(((i + 1) / Math.max(1, batch.length)) * 45);
        updateSyncProgress({
          phase: 'fit_download',
          message: `Lade & prüfe FIT-Datei ${i + 1}/${batch.length}: ${act.name}`,
          percent: pct
        });
        try {
          const fitRes = await downloadAndParseGarminActivityFit(act.id, {
            // Avoid creating redundant garmin-fit-* rows in tracks; store GPS directly on garmin_activities
            saveToWorkspaceTracks: false,
            overrideApiKey: options.overrideApiKey,
            accessToken
          });
          fitDownloadedCount++;
          if (fitRes.integrityStatus === 'repaired') {
            fitRepairedCount++;
          }
          act.hasGps = fitRes.pointsCount > 0;
        } catch {
          fitFailedCount++;
        }
        updateSyncProgress({
          stats: {
            fitDownloaded: fitDownloadedCount,
            fitRepaired: fitRepairedCount,
            fitFailed: fitFailedCount
          }
        });
      }
    }

    const nowIso = new Date().toISOString();
    saveSetting('garmin_personal_last_sync_at', nowIso);

    return {
      syncedCount: newActivities + updatedActivities,
      newActivities,
      updatedActivities,
      skippedDuplicates,
      fitDownloadedCount,
      fitRepairedCount,
      fitFailedCount,
      activities: normalizedActivities,
      endpointUsed: usedUrl
    };
  } catch (err: any) {
    updateSyncProgress({
      phase: 'error',
      message: err?.message || 'Aktivitäten-Sync fehlgeschlagen'
    });
    throw err;
  } finally {
    activeSyncJobs = Math.max(0, activeSyncJobs - 1);
    if (activeSyncJobs === 0 && syncProgressState.phase !== 'error') {
      updateSyncProgress({
        active: false,
        phase: 'done',
        percent: 100,
        message: 'Cloud-Synchronisation abgeschlossen.'
      });
    } else if (activeSyncJobs === 0) {
      updateSyncProgress({ active: false });
    }
  }
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
  resetSyncProgressIfIdle();
  activeSyncJobs++;
  try {
    updateSyncProgress({
      active: true,
      phase: 'health_dailies',
      message: 'Synchronisiere Tageswerte (Schritte, Ruhepuls, Stress)...',
      percent: Math.max(syncProgressState.percent, 20)
    });
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

  // 1. Fetch Dailies (Steps, RHR, Stress, Calories) in <= 20-day chunks (Garmin limits daily stats to 28 days)
  const buildDateChunks = (sStr: string, eStr: string, maxDays = 20): Array<{ chunkStart: string; chunkEnd: string; chunkStartSec: number; chunkEndSec: number }> => {
    const chunks: Array<{ chunkStart: string; chunkEnd: string; chunkStartSec: number; chunkEndSec: number }> = [];
    const sDate = new Date(`${sStr}T00:00:00Z`);
    const eDate = new Date(`${eStr}T00:00:00Z`);
    if (isNaN(sDate.getTime()) || isNaN(eDate.getTime()) || sDate > eDate) {
      return [{ chunkStart: sStr, chunkEnd: eStr, chunkStartSec: startEpochSec, chunkEndSec: endEpochSec }];
    }
    let cursor = new Date(sDate);
    while (cursor <= eDate) {
      const chunkEndDt = new Date(cursor);
      chunkEndDt.setUTCDate(chunkEndDt.getUTCDate() + maxDays - 1);
      if (chunkEndDt > eDate) chunkEndDt.setTime(eDate.getTime());
      const cStart = cursor.toISOString().slice(0, 10);
      const cEnd = chunkEndDt.toISOString().slice(0, 10);
      chunks.push({
        chunkStart: cStart,
        chunkEnd: cEnd,
        chunkStartSec: Math.floor(new Date(`${cStart}T00:00:00Z`).getTime() / 1000),
        chunkEndSec: Math.floor(new Date(`${cEnd}T23:59:59Z`).getTime() / 1000)
      });
      cursor = new Date(chunkEndDt);
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return chunks;
  };

  const extractDailiesList = (payload: any): any[] => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.dailies)) return payload.dailies;
    if (Array.isArray(payload?.stressDetails)) return payload.stressDetails;
    if (Array.isArray(payload?.userMetrics)) return payload.userMetrics;
    const metricsMap = payload?.allMetrics?.metricsMap;
    if (metricsMap && typeof metricsMap === 'object') {
      const byDate = new Map<string, any>();
      const mergeMetricArray = (arr: any[], fieldName: string) => {
        if (!Array.isArray(arr)) return;
        for (const entry of arr) {
          const dStr = String(entry?.calendarDate || entry?.date || '').slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dStr)) continue;
          const prev = byDate.get(dStr) || { calendarDate: dStr };
          if (entry?.value !== undefined && entry?.value !== null) {
            prev[fieldName] = entry.value;
          }
          byDate.set(dStr, { ...prev, ...entry });
        }
      };
      mergeMetricArray(metricsMap.WELLNESS_TOTAL_STEPS, 'totalSteps');
      mergeMetricArray(metricsMap.WELLNESS_RESTING_HEART_RATE, 'restingHeartRate');
      mergeMetricArray(metricsMap.WELLNESS_AVERAGE_STRESS, 'averageStressLevel');
      mergeMetricArray(metricsMap.WELLNESS_TOTAL_CALORIES, 'totalKilocalories');
      mergeMetricArray(metricsMap.WELLNESS_TOTAL_DISTANCE, 'totalDistanceMeters');
      mergeMetricArray(metricsMap.SLEEP_DURATION ?? metricsMap.WELLNESS_SLEEP_SECONDS ?? metricsMap.SLEEP_TIME_SECONDS, 'sleepingSeconds');
      mergeMetricArray(metricsMap.SLEEP_DEEP ?? metricsMap.WELLNESS_DEEP_SLEEP_SECONDS, 'deepSleepSeconds');
      mergeMetricArray(metricsMap.SLEEP_LIGHT ?? metricsMap.WELLNESS_LIGHT_SLEEP_SECONDS, 'lightSleepSeconds');
      mergeMetricArray(metricsMap.SLEEP_REM ?? metricsMap.WELLNESS_REM_SLEEP_SECONDS, 'remSleepSeconds');
      mergeMetricArray(metricsMap.SLEEP_AWAKE ?? metricsMap.WELLNESS_AWAKE_SLEEP_SECONDS, 'awakeSleepSeconds');
      if (byDate.size > 0) return Array.from(byDate.values());
    }
    if (Array.isArray(payload?.data)) return payload.data;
    if (payload && typeof payload === 'object' && (payload.calendarDate || payload.date || payload.startTimeInSeconds)) {
      return [payload];
    }
    return [];
  };

  const ingestDailiesList = (list: any[], metricHint: 'auto' | 'steps' | 'rhr' | 'stress' = 'auto') => {
    if (list.length === 0) return;
    runInTransaction(() => {
      for (const raw of list) {
        if (!raw || typeof raw !== 'object') continue;
        const d = raw.values && typeof raw.values === 'object' ? { ...raw, ...raw.values } : raw;
        const dateStr = String(
          d.calendarDate ||
          d.date ||
          (d.startTimeInSeconds ? new Date(d.startTimeInSeconds * 1000).toISOString().slice(0, 10) : '')
        ).slice(0, 10);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

        const steps = Number(
          d.totalSteps ??
          d.steps ??
          (metricHint === 'steps' ? d.value : undefined) ??
          (metricHint === 'auto' && d.restingHeartRate === undefined && d.rhr === undefined && d.averageStressLevel === undefined && d.overallStressLevel === undefined
            ? d.value
            : undefined) ??
          0
        );
        const calories = Number(d.totalKilocalories ?? d.activeKilocalories ?? d.calories ?? 0) || undefined;
        const distMeters = Number(d.totalDistanceMeters ?? d.distanceInMeters ?? d.distance ?? 0);
        const distKm = distMeters > 100 ? Number((distMeters / 1000).toFixed(2)) : distMeters || undefined;

        if (!isNaN(steps) && steps > 0) {
          saveSteps(dateStr, Math.round(steps), calories ? Math.round(calories) : undefined, distKm);
          stepsCount++;
        }

        const rhr = Number(
          d.restingHeartRateInBeatsPerMinute ??
          d.restingHeartRate ??
          d.restingHeartRateValue ??
          d.currentDayRestingHeartRate ??
          d.rhr ??
          (metricHint === 'rhr' ? d.value : undefined) ??
          0
        );
        if (!isNaN(rhr) && rhr >= 30 && rhr <= 140) {
          saveRhr(dateStr, Math.round(rhr));
          rhrCount++;
        }

        let avgStress = Number(
          d.averageStressLevel ??
          d.overallStressLevel ??
          d.avgStressLevel ??
          d.avg_stress ??
          (metricHint === 'stress' ? d.value : undefined) ??
          0
        );
        if ((!avgStress || isNaN(avgStress) || avgStress <= 0) && d.timeOffsetStressLevelValues && typeof d.timeOffsetStressLevelValues === 'object') {
          const validStressVals = Object.values(d.timeOffsetStressLevelValues)
            .map((v) => Number(v))
            .filter((v) => Number.isFinite(v) && v >= 0 && v <= 100);
          if (validStressVals.length > 0) {
            avgStress = validStressVals.reduce((sum, v) => sum + v, 0) / validStressVals.length;
          }
        }
        if (!isNaN(avgStress) && avgStress > 0 && avgStress <= 100) {
          saveStress(dateStr, Math.round(avgStress));
          stressCount++;
        }

        const dailySleepMin = pickSleepMinutes(
          d.sleepingSeconds ?? d.sleepTimeSeconds ?? d.sleepDurationInSeconds,
          d.sleepingMinutes ?? d.sleepMinutes
        );
        if (dailySleepMin && dailySleepMin > 0) {
          const dailyDeepMin = pickSleepMinutes(d.deepSleepSeconds ?? d.deepSleepDurationInSeconds, d.deepSleepMinutes);
          const dailyLightMin = pickSleepMinutes(d.lightSleepSeconds ?? d.lightSleepDurationInSeconds, d.lightSleepMinutes);
          const dailyRemMin = pickSleepMinutes(d.remSleepSeconds ?? d.remSleepDurationInSeconds, d.remSleepMinutes);
          const dailyAwakeMin = pickSleepMinutes(d.awakeSleepSeconds ?? d.awakeDurationInSeconds, d.awakeSleepMinutes);
          saveSleep(dateStr, dailySleepMin, dailyDeepMin, dailyLightMin, dailyRemMin, dailyAwakeMin);
          sleepCount++;
        }
      }
    });
  };

  const toMinutesFromGarminSleepField = (rawVal: unknown, isSecondsField: boolean): number | undefined => {
    const num = Number(rawVal);
    if (!Number.isFinite(num) || num <= 0) return undefined;
    if (isSecondsField) {
      const mins = Math.round(num / 60);
      return mins > 0 ? mins : undefined;
    }
    return num > 600 ? Math.round(num / 60) : Math.round(num);
  };

  const pickSleepMinutes = (secondsVal: unknown, fallbackMinutesVal?: unknown): number | undefined => {
    if (secondsVal !== undefined && secondsVal !== null && secondsVal !== '') {
      return toMinutesFromGarminSleepField(secondsVal, true);
    }
    if (fallbackMinutesVal !== undefined && fallbackMinutesVal !== null && fallbackMinutesVal !== '') {
      return toMinutesFromGarminSleepField(fallbackMinutesVal, false);
    }
    return undefined;
  };

  try {
    const chunks = buildDateChunks(start, end, 20);
    for (const { chunkStart, chunkEnd, chunkStartSec, chunkEndSec } of chunks) {
      const dailiesUrls = [
        `${baseUrl}/usersummary-service/usersummary/daily?startDate=${encodeURIComponent(chunkStart)}&endDate=${encodeURIComponent(chunkEnd)}`,
        `${baseUrl}/usersummary-service/usersummary/daily/${encodeURIComponent(chunkStart)}/${encodeURIComponent(chunkEnd)}`,
        `${baseUrl}/userstats-service/wellness/daily/${encodeURIComponent(chunkStart)}?untilDate=${encodeURIComponent(chunkEnd)}`,
        `${baseUrl}/wellness-api/rest/dailies?uploadStartTimeInSeconds=${chunkStartSec}&uploadEndTimeInSeconds=${chunkEndSec}`,
        `${baseUrl}/personal-api/dailies?startDate=${encodeURIComponent(chunkStart)}&endDate=${encodeURIComponent(chunkEnd)}`
      ];
      const { data: dailiesPayload } = await fetchGarminJsonWithFallback(dailiesUrls, accessToken, { allowNotFoundAsEmpty: true });
      ingestDailiesList(extractDailiesList(dailiesPayload), 'auto');
    }

    if (stepsCount === 0) {
      for (const { chunkStart, chunkEnd } of chunks) {
        const stepsFallbackUrls = [
          `${baseUrl}/usersummary-service/stats/steps/daily/${encodeURIComponent(chunkStart)}/${encodeURIComponent(chunkEnd)}`,
          `${baseUrl}/userstats-service/wellness/daily/${encodeURIComponent(chunkStart)}?untilDate=${encodeURIComponent(chunkEnd)}`
        ];
        const { data: stepsPayload } = await fetchGarminJsonWithFallback(stepsFallbackUrls, accessToken, { allowNotFoundAsEmpty: true });
        ingestDailiesList(extractDailiesList(stepsPayload), 'steps');
      }
    }

    if (rhrCount === 0) {
      for (const { chunkStart, chunkEnd } of chunks) {
        const rhrFallbackUrls = [
          `${baseUrl}/usersummary-service/stats/rhr/daily/${encodeURIComponent(chunkStart)}/${encodeURIComponent(chunkEnd)}`,
          `${baseUrl}/userstats-service/wellness/daily/${encodeURIComponent(chunkStart)}?untilDate=${encodeURIComponent(chunkEnd)}`
        ];
        const { data: rhrPayload } = await fetchGarminJsonWithFallback(rhrFallbackUrls, accessToken, { allowNotFoundAsEmpty: true });
        ingestDailiesList(extractDailiesList(rhrPayload), 'rhr');
      }
    }

    if (stressCount === 0) {
      for (const { chunkStart, chunkEnd, chunkStartSec, chunkEndSec } of chunks) {
        const stressFallbackUrls = [
          `${baseUrl}/usersummary-service/stats/stress/daily/${encodeURIComponent(chunkStart)}/${encodeURIComponent(chunkEnd)}`,
          `${baseUrl}/wellness-api/rest/stressDetails?uploadStartTimeInSeconds=${chunkStartSec}&uploadEndTimeInSeconds=${chunkEndSec}`
        ];
        const { data: stressPayload } = await fetchGarminJsonWithFallback(stressFallbackUrls, accessToken, { allowNotFoundAsEmpty: true });
        ingestDailiesList(extractDailiesList(stressPayload), 'stress');
      }
    }
  } catch (e: any) {
    if (e?.message?.includes('404') || e?.message?.includes('NOT_FOUND')) {
      console.log('[Garmin Personal API] Keine Dailies-Einträge in Garmin Cloud für diesen Zeitraum.');
    } else {
      console.warn('[Garmin Personal API] Dailies sync info:', e?.message);
    }
  }

  // 2. Fetch Sleep Summaries (chunked across multi-day ranges without single-day short-circuit)
  try {
    const sleepChunks = buildDateChunks(start, end, 20);
    const seenSleepDates = new Set<string>();

    const ingestSleepList = (sleepList: any[]) => {
      if (sleepList.length === 0) return;
      runInTransaction(() => {
        for (const s of sleepList) {
          const dto = s?.dailySleepDTO || s;
          if (!dto) continue;
          const dateStr = String(
            dto.calendarDate ||
            dto.date ||
            (dto.startTimeInSeconds ? new Date(dto.startTimeInSeconds * 1000).toISOString().slice(0, 10) : '')
          ).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) continue;

          const durationMin = pickSleepMinutes(
            dto.sleepTimeSeconds ?? dto.durationInSeconds ?? dto.sleepingSeconds,
            dto.duration ?? dto.sleepMinutes
          );
          if (!durationMin || durationMin <= 0) continue;

          const deepMin = pickSleepMinutes(dto.deepSleepSeconds ?? dto.deepSleepDurationInSeconds, dto.deep);
          const lightMin = pickSleepMinutes(dto.lightSleepSeconds ?? dto.lightSleepDurationInSeconds, dto.light);
          const remMin = pickSleepMinutes(dto.remSleepSeconds ?? dto.remSleepInSeconds ?? dto.remSleepDurationInSeconds, dto.rem);
          const awakeMin = pickSleepMinutes(dto.awakeSleepSeconds ?? dto.awakeDurationInSeconds, dto.awake);

          saveSleep(dateStr, durationMin, deepMin, lightMin, remMin, awakeMin);
          if (!seenSleepDates.has(dateStr)) {
            seenSleepDates.add(dateStr);
            sleepCount++;
          }

          const sleepRhr = Number(s?.restingHeartRate ?? dto.restingHeartRate ?? 0);
          if (!isNaN(sleepRhr) && sleepRhr >= 30 && sleepRhr <= 140) {
            saveRhr(dateStr, Math.round(sleepRhr));
            rhrCount++;
          }

          const sleepStress = Number(dto.avgSleepStress ?? s?.avgSleepStress ?? 0);
          if (!isNaN(sleepStress) && sleepStress > 0 && sleepStress <= 100) {
            saveStress(dateStr, Math.round(sleepStress));
            stressCount++;
          }
        }
      });
    };

    const extractSleepList = (sleepPayload: any): any[] => {
      if (!sleepPayload) return [];
      if (Array.isArray(sleepPayload)) return sleepPayload;
      if (Array.isArray(sleepPayload.sleeps)) return sleepPayload.sleeps;
      if (Array.isArray(sleepPayload.dailySleepSummaries)) return sleepPayload.dailySleepSummaries;
      if (Array.isArray(sleepPayload.items)) return sleepPayload.items;
      if (sleepPayload.dailySleepDTO) return [sleepPayload.dailySleepDTO];
      if (Array.isArray(sleepPayload.data)) return sleepPayload.data;
      return [];
    };

    for (const chunk of sleepChunks) {
      const sleepRangeUrls = [
        `${baseUrl}/sleep-service/sleep/dailySleepSummariesByDate?startDate=${encodeURIComponent(chunk.chunkStart)}&endDate=${encodeURIComponent(chunk.chunkEnd)}`,
        `${baseUrl}/wellness-api/rest/sleeps?uploadStartTimeInSeconds=${chunk.chunkStartSec}&uploadEndTimeInSeconds=${chunk.chunkEndSec}`,
        `${baseUrl}/personal-api/sleep?startDate=${encodeURIComponent(chunk.chunkStart)}&endDate=${encodeURIComponent(chunk.chunkEnd)}`
      ];
      const { data: sleepPayload } = await fetchGarminJsonWithFallback(sleepRangeUrls, accessToken, { allowNotFoundAsEmpty: true });
      ingestSleepList(extractSleepList(sleepPayload));
    }

    // Fallback to single-day sleep endpoint only if all multi-day range queries returned nothing
    if (seenSleepDates.size === 0) {
      const endDateObj = new Date(`${end}T00:00:00Z`);
      const startDateObj = new Date(`${start}T00:00:00Z`);
      for (let i = 0; i < 7; i++) {
        const d = new Date(endDateObj);
        d.setUTCDate(endDateObj.getUTCDate() - i);
        if (d < startDateObj) break;
        const dStr = d.toISOString().slice(0, 10);
        const dayUrls = [
          `${baseUrl}/sleep-service/sleep/dailySleepData?date=${encodeURIComponent(dStr)}&nonSleepBufferMinutes=60`,
          `${baseUrl}/sleep-service/sleep/dailySleep?date=${encodeURIComponent(dStr)}`
        ];
        const { data: dayPayload } = await fetchGarminJsonWithFallback(dayUrls, accessToken, { allowNotFoundAsEmpty: true });
        ingestSleepList(extractSleepList(dayPayload));
      }
    }
  } catch (e: any) {
    if (e?.message?.includes('404') || e?.message?.includes('NOT_FOUND')) {
      console.log('[Garmin Personal API] Keine Schlaf-Einträge in Garmin Cloud für diesen Zeitraum.');
    } else {
      console.warn('[Garmin Personal API] Sleep sync info:', e?.message);
    }
  }

  // 3. Fetch Weight / Body Composition
  try {
    const weightUrls = [
      `${baseUrl}/weight-service/weight/dateRange?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`,
      `${baseUrl}/weight-service/weight/range/${encodeURIComponent(start)}/${encodeURIComponent(end)}`,
      `${baseUrl}/weight-service/weight/all/${encodeURIComponent(start)}/${encodeURIComponent(end)}`,
      `${baseUrl}/wellness-api/rest/bodyComps?uploadStartTimeInSeconds=${startEpochSec}&uploadEndTimeInSeconds=${endEpochSec}`,
      `${baseUrl}/personal-api/weight?startDate=${encodeURIComponent(start)}&endDate=${encodeURIComponent(end)}`
    ];
    const { data: weightPayload } = await fetchGarminJsonWithFallback(weightUrls, accessToken, { allowNotFoundAsEmpty: true });
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
    if (e?.message?.includes('404') || e?.message?.includes('NOT_FOUND')) {
      console.log('[Garmin Personal API] Keine Gewichts-Einträge in Garmin Cloud für diesen Zeitraum.');
    } else {
      console.warn('[Garmin Personal API] Weight sync info:', e?.message);
    }
  }

    if (rhrCount === 0 || stressCount === 0 || stepsCount === 0) {
      backfillMissingHealthMetricsFromExistingData();
    }

    saveSetting('garmin_personal_last_sync_at', new Date().toISOString());
    const healthDays = Math.max(sleepCount, rhrCount, stressCount, stepsCount, weightCount);
    updateSyncProgress({
      stats: { healthDays }
    });

    return {
      sleepCount,
      rhrCount,
      stressCount,
      stepsCount,
      weightCount
    };
  } catch (err: any) {
    updateSyncProgress({
      phase: 'error',
      message: err?.message || 'Gesundheitsdaten-Sync fehlgeschlagen'
    });
    throw err;
  } finally {
    activeSyncJobs = Math.max(0, activeSyncJobs - 1);
    if (activeSyncJobs === 0 && syncProgressState.phase !== 'error') {
      updateSyncProgress({
        active: false,
        phase: 'done',
        percent: 100,
        message: 'Cloud-Synchronisation abgeschlossen.'
      });
    } else if (activeSyncJobs === 0) {
      updateSyncProgress({ active: false });
    }
  }
}
