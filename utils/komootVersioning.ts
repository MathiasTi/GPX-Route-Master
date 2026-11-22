import type { GPXTrack, KomootSourceMeta, TrackSourceVersionEntry } from '../types';

const MAX_VERSION_HISTORY = 25;

export interface KomootSourceAttachParams {
  sourceType: 'komoot' | 'gpx';
  sourceUrl: string;
  komootTourId?: string;
  komootShareToken?: string | null;
  komootCollectionId?: string;
  komootCollectionTitle?: string;
  komootCollectionUrl?: string;
  contentHash?: string;
  remoteUpdatedAt?: string;
  nowIso?: string;
}

export interface KomootRefreshResult {
  updated: boolean;
  previousVersion: number;
  newVersion: number;
  track: GPXTrack;
}

/**
 * Pure deterministic dual-64-bit FNV-1a hash producing a 16-char hex digest.
 * Runs identically in Node.js (server) and browsers (client) with zero dependencies.
 */
function fnv1aDualHex(input: string): string {
  let h1 = 0x811c9dc5 >>> 0;
  let h2 = 0x9e3779b9 >>> 0;
  for (let i = 0; i < input.length; i++) {
    const c = input.charCodeAt(i);
    h1 ^= c;
    h1 = Math.imul(h1, 0x01000193) >>> 0;
    h2 ^= c ^ (i & 0xff);
    h2 = Math.imul(h2, 0x85ebca6b) >>> 0;
  }
  return `${h1.toString(16).padStart(8, '0')}${h2.toString(16).padStart(8, '0')}`;
}

/**
 * Computes a canonical fingerprint for a GPX track's geometry and core metadata.
 * Identical coordinates, elevations, title, and sport produce the exact same hash.
 */
export function computeCanonicalTrackContentHash(input: {
  name?: string;
  activityType?: string;
  points: Array<{ lat: number; lng: number; ele?: number }>;
}): string {
  const normName = String(input.name || '').trim();
  const normActivity = input.activityType === 'running' ? 'running' : 'cycling';
  const pts = Array.isArray(input.points) ? input.points : [];
  const parts: string[] = [`n:${normName}`, `a:${normActivity}`, `c:${pts.length}`];

  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lng)) continue;
    const eleStr =
      p.ele !== undefined && p.ele !== null && Number.isFinite(p.ele)
        ? p.ele.toFixed(1)
        : '';
    parts.push(`${p.lat.toFixed(6)},${p.lng.toFixed(6)},${eleStr}`);
  }

  return `kh_${fnv1aDualHex(parts.join('|'))}`;
}

export function extractKomootTourIdFromUrl(rawUrl?: string): string | undefined {
  if (!rawUrl) return undefined;
  const match = String(rawUrl).match(/\/tours?\/(\d+)(?:[/?#]|$)/i);
  return match?.[1];
}

export function normalizeSourceUrlForMatch(rawUrl?: string): string {
  if (!rawUrl) return '';
  try {
    const u = new URL(rawUrl.trim());
    u.hash = '';
    // Keep share_token if present; drop tracking noise
    const shareToken = u.searchParams.get('share_token');
    u.search = shareToken ? `?share_token=${shareToken}` : '';
    return u.toString().replace(/\/+$/, '').toLowerCase();
  } catch {
    return String(rawUrl).trim().replace(/\/+$/, '').toLowerCase();
  }
}

export function getKomootSourceMeta(
  trackOrMeta?: { rawFileDetails?: { metadata?: Record<string, unknown> } } | null
): KomootSourceMeta | null {
  const candidate = trackOrMeta?.rawFileDetails?.metadata?.komootSource;
  if (!candidate || typeof candidate !== 'object') return null;
  const rec = candidate as Record<string, unknown>;
  if (typeof rec.sourceUrl !== 'string' || !rec.sourceUrl.trim()) return null;

  const version =
    typeof rec.version === 'number' && Number.isFinite(rec.version) && rec.version >= 1
      ? Math.floor(rec.version)
      : 1;
  const history = Array.isArray(rec.versionHistory)
    ? (rec.versionHistory as TrackSourceVersionEntry[])
    : [];

  return {
    sourceType: rec.sourceType === 'gpx' ? 'gpx' : 'komoot',
    sourceUrl: rec.sourceUrl.trim(),
    komootTourId:
      typeof rec.komootTourId === 'string' && rec.komootTourId.trim()
        ? rec.komootTourId.trim()
        : extractKomootTourIdFromUrl(rec.sourceUrl),
    komootShareToken:
      typeof rec.komootShareToken === 'string' ? rec.komootShareToken : null,
    komootCollectionId:
      typeof rec.komootCollectionId === 'string' && rec.komootCollectionId.trim()
        ? rec.komootCollectionId.trim()
        : undefined,
    komootCollectionTitle:
      typeof rec.komootCollectionTitle === 'string' && rec.komootCollectionTitle.trim()
        ? rec.komootCollectionTitle.trim()
        : undefined,
    komootCollectionUrl:
      typeof rec.komootCollectionUrl === 'string' && rec.komootCollectionUrl.trim()
        ? rec.komootCollectionUrl.trim()
        : undefined,
    version,
    contentHash: typeof rec.contentHash === 'string' ? rec.contentHash : '',
    importedAt:
      typeof rec.importedAt === 'string' && rec.importedAt
        ? rec.importedAt
        : new Date().toISOString(),
    lastCheckedAt:
      typeof rec.lastCheckedAt === 'string' && rec.lastCheckedAt
        ? rec.lastCheckedAt
        : new Date().toISOString(),
    remoteUpdatedAt:
      typeof rec.remoteUpdatedAt === 'string' && rec.remoteUpdatedAt
        ? rec.remoteUpdatedAt
        : undefined,
    versionHistory: history
  };
}

export function attachKomootSourceToTrack(
  track: GPXTrack,
  params: KomootSourceAttachParams
): GPXTrack {
  const nowIso = params.nowIso || new Date().toISOString();
  const contentHash =
    params.contentHash || computeCanonicalTrackContentHash(track);
  const komootTourId =
    params.komootTourId ||
    (params.sourceType === 'komoot'
      ? extractKomootTourIdFromUrl(params.sourceUrl)
      : undefined);

  const existingMeta = getKomootSourceMeta(track);
  const version = existingMeta?.version ?? 1;

  const entry: TrackSourceVersionEntry = {
    version,
    contentHash,
    importedAt: nowIso,
    remoteUpdatedAt: params.remoteUpdatedAt,
    pointCount: track.points?.length || 0,
    distanceKm: Math.round((track.distance || 0) * 100) / 100,
    ascentM: Math.round(track.ascent || 0),
    note: version === 1 ? 'Initial import' : undefined
  };

  const komootSource: KomootSourceMeta = {
    sourceType: params.sourceType,
    sourceUrl: params.sourceUrl,
    komootTourId,
    komootShareToken: params.komootShareToken ?? existingMeta?.komootShareToken ?? null,
    komootCollectionId: params.komootCollectionId ?? existingMeta?.komootCollectionId,
    komootCollectionTitle:
      params.komootCollectionTitle ?? existingMeta?.komootCollectionTitle,
    komootCollectionUrl:
      params.komootCollectionUrl ?? existingMeta?.komootCollectionUrl,
    version,
    contentHash,
    importedAt: existingMeta?.importedAt || nowIso,
    lastCheckedAt: nowIso,
    remoteUpdatedAt: params.remoteUpdatedAt ?? existingMeta?.remoteUpdatedAt,
    versionHistory:
      existingMeta && existingMeta.versionHistory.length > 0
        ? existingMeta.versionHistory
        : [entry]
  };

  return {
    ...track,
    rawFileDetails: {
      fileType: track.rawFileDetails?.fileType || 'gpx',
      fileName:
        track.rawFileDetails?.fileName ||
        track.originalFilename ||
        `${track.name || 'track'}.gpx`,
      ...(track.rawFileDetails?.fileSize !== undefined
        ? { fileSize: track.rawFileDetails.fileSize }
        : {}),
      metadata: {
        ...(track.rawFileDetails?.metadata || {}),
        version: `v${version}`,
        komootSource
      }
    }
  };
}

export function applyKomootRefreshToTrack(
  existingTrack: GPXTrack,
  incomingTrack: GPXTrack,
  params: KomootSourceAttachParams
): KomootRefreshResult {
  const nowIso = params.nowIso || new Date().toISOString();
  const prevMeta = getKomootSourceMeta(existingTrack);
  const prevVersion = prevMeta?.version ?? 1;
  const previousHash =
    prevMeta?.contentHash || computeCanonicalTrackContentHash(existingTrack);
  const newHash =
    params.contentHash || computeCanonicalTrackContentHash(incomingTrack);

  const komootTourId =
    params.komootTourId ||
    prevMeta?.komootTourId ||
    (params.sourceType === 'komoot'
      ? extractKomootTourIdFromUrl(params.sourceUrl)
      : undefined);

  const mergedCollectionId =
    params.komootCollectionId ?? prevMeta?.komootCollectionId;
  const mergedCollectionTitle =
    params.komootCollectionTitle ?? prevMeta?.komootCollectionTitle;
  const mergedCollectionUrl =
    params.komootCollectionUrl ?? prevMeta?.komootCollectionUrl;
  const mergedShareToken =
    params.komootShareToken !== undefined
      ? params.komootShareToken
      : (prevMeta?.komootShareToken ?? null);

  if (previousHash === newHash) {
    const existingHistory =
      prevMeta && prevMeta.versionHistory.length > 0
        ? prevMeta.versionHistory
        : [
            {
              version: prevVersion,
              contentHash: previousHash,
              importedAt: prevMeta?.importedAt || nowIso,
              remoteUpdatedAt: prevMeta?.remoteUpdatedAt || params.remoteUpdatedAt,
              pointCount: existingTrack.points?.length || 0,
              distanceKm: Math.round((existingTrack.distance || 0) * 100) / 100,
              ascentM: Math.round(existingTrack.ascent || 0),
              note: 'Baseline'
            }
          ];

    const updatedMeta: KomootSourceMeta = {
      sourceType: params.sourceType,
      sourceUrl: params.sourceUrl || prevMeta?.sourceUrl || '',
      komootTourId,
      komootShareToken: mergedShareToken,
      komootCollectionId: mergedCollectionId,
      komootCollectionTitle: mergedCollectionTitle,
      komootCollectionUrl: mergedCollectionUrl,
      version: prevVersion,
      contentHash: previousHash,
      importedAt: prevMeta?.importedAt || nowIso,
      lastCheckedAt: nowIso,
      remoteUpdatedAt: params.remoteUpdatedAt ?? prevMeta?.remoteUpdatedAt,
      versionHistory: existingHistory
    };

    const touchedTrack: GPXTrack = {
      ...existingTrack,
      rawFileDetails: {
        fileType: existingTrack.rawFileDetails?.fileType || 'gpx',
        fileName:
          existingTrack.rawFileDetails?.fileName ||
          existingTrack.originalFilename ||
          `${existingTrack.name || 'track'}.gpx`,
        ...(existingTrack.rawFileDetails?.fileSize !== undefined
          ? { fileSize: existingTrack.rawFileDetails.fileSize }
          : {}),
        metadata: {
          ...(existingTrack.rawFileDetails?.metadata || {}),
          version: `v${prevVersion}`,
          komootSource: updatedMeta
        }
      }
    };

    return {
      updated: false,
      previousVersion: prevVersion,
      newVersion: prevVersion,
      track: touchedTrack
    };
  }

  const nextVersion = prevVersion + 1;
  const baselineHistory: TrackSourceVersionEntry[] =
    prevMeta && prevMeta.versionHistory.length > 0
      ? [...prevMeta.versionHistory]
      : [
          {
            version: prevVersion,
            contentHash: previousHash,
            importedAt: prevMeta?.importedAt || nowIso,
            remoteUpdatedAt: prevMeta?.remoteUpdatedAt,
            pointCount: existingTrack.points?.length || 0,
            distanceKm: Math.round((existingTrack.distance || 0) * 100) / 100,
            ascentM: Math.round(existingTrack.ascent || 0),
            note: 'Previous version'
          }
        ];

  const newEntry: TrackSourceVersionEntry = {
    version: nextVersion,
    contentHash: newHash,
    importedAt: nowIso,
    remoteUpdatedAt: params.remoteUpdatedAt,
    pointCount: incomingTrack.points?.length || 0,
    distanceKm: Math.round((incomingTrack.distance || 0) * 100) / 100,
    ascentM: Math.round(incomingTrack.ascent || 0),
    note: `Updated from v${prevVersion}`
  };

  const nextHistory = [...baselineHistory, newEntry].slice(-MAX_VERSION_HISTORY);

  const mergedTags = Array.from(
    new Set([
      ...(existingTrack.tags || []),
      ...(incomingTrack.tags || [])
    ])
  ).filter(Boolean);

  const nextSourceMeta: KomootSourceMeta = {
    sourceType: params.sourceType,
    sourceUrl: params.sourceUrl || prevMeta?.sourceUrl || '',
    komootTourId,
    komootShareToken: mergedShareToken,
    komootCollectionId: mergedCollectionId,
    komootCollectionTitle: mergedCollectionTitle,
    komootCollectionUrl: mergedCollectionUrl,
    version: nextVersion,
    contentHash: newHash,
    importedAt: prevMeta?.importedAt || nowIso,
    lastCheckedAt: nowIso,
    remoteUpdatedAt: params.remoteUpdatedAt ?? prevMeta?.remoteUpdatedAt,
    versionHistory: nextHistory
  };

  const refreshedTrack: GPXTrack = {
    ...incomingTrack,
    id: existingTrack.id,
    color: existingTrack.color || incomingTrack.color,
    visible: existingTrack.visible,
    tourGroup: existingTrack.tourGroup || incomingTrack.tourGroup,
    dateCreated: existingTrack.dateCreated || incomingTrack.dateCreated,
    description: existingTrack.description || incomingTrack.description,
    tags: mergedTags,
    rawFileDetails: {
      fileType: incomingTrack.rawFileDetails?.fileType || existingTrack.rawFileDetails?.fileType || 'gpx',
      fileName:
        existingTrack.rawFileDetails?.fileName ||
        incomingTrack.rawFileDetails?.fileName ||
        `${incomingTrack.name || existingTrack.name}.gpx`,
      ...(incomingTrack.rawFileDetails?.fileSize !== undefined
        ? { fileSize: incomingTrack.rawFileDetails.fileSize }
        : {}),
      metadata: {
        ...(existingTrack.rawFileDetails?.metadata || {}),
        ...(incomingTrack.rawFileDetails?.metadata || {}),
        version: `v${nextVersion}`,
        komootSource: nextSourceMeta
      }
    }
  };

  return {
    updated: true,
    previousVersion: prevVersion,
    newVersion: nextVersion,
    track: refreshedTrack
  };
}

export function findMatchingExistingKomootTrack<
  T extends { id: string; rawFileDetails?: { metadata?: Record<string, unknown> } }
>(
  items: T[],
  criteria: { komootTourId?: string; sourceUrl?: string }
): T | null {
  const targetTourId =
    criteria.komootTourId || extractKomootTourIdFromUrl(criteria.sourceUrl);
  const normTargetUrl = normalizeSourceUrlForMatch(criteria.sourceUrl);

  for (const item of items) {
    const meta = getKomootSourceMeta(item);
    if (!meta) continue;
    if (targetTourId && meta.komootTourId && meta.komootTourId === targetTourId) {
      return item;
    }
    if (normTargetUrl && normalizeSourceUrlForMatch(meta.sourceUrl) === normTargetUrl) {
      return item;
    }
  }
  return null;
}

export function getVersionedGpxFilename(
  track: { name?: string; rawFileDetails?: { metadata?: Record<string, unknown> } },
  prefix = ''
): string {
  const safeName = (track.name || 'track')
    .trim()
    .replace(/[/\\?%*:|"<>]/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^_+|_+$/g, '');
  const meta = getKomootSourceMeta(track);
  const versionSuffix = meta && meta.version >= 1 ? `_v${meta.version}` : '';
  return `${prefix}${safeName || 'track'}${versionSuffix}.gpx`;
}
