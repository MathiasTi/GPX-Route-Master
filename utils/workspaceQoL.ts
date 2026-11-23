import type { GPXTrack } from '../types';
import { getKomootSourceMeta } from './komootVersioning';
import { getPaceString } from './gpxUtils';

export type WorkspaceActivityFilter = 'all' | 'cycling' | 'running';
export type WorkspaceSourceFilter = 'all' | 'komoot';

export interface WorkspaceFilterOptions {
  query?: string;
  activityFilter?: WorkspaceActivityFilter;
  sourceFilter?: WorkspaceSourceFilter;
}

const GENERIC_KOMOOT_NAME_RE = /^komoot(?:\s+tour)?(?:\s+#?\d+)?$/i;

/**
 * Resolves the best display name when refreshing a Komoot or URL-imported track.
 * Prefers a real (non-generic) suggestedName over empty/fallback/generic GPX names,
 * while avoiding overwriting a real GPX title with a generic "Komoot Tour <id>" placeholder.
 */
export function resolveRefreshedTrackName(
  parsedName: string | undefined,
  suggestedName: string | undefined,
  fallbackBaseName?: string
): string {
  const cleanParsed = (parsedName || '').trim();
  const cleanSuggested = (suggestedName || '').trim();
  const cleanFallback = (fallbackBaseName || '').trim();

  const parsedIsGeneric =
    !cleanParsed ||
    (cleanFallback !== '' && cleanParsed === cleanFallback) ||
    GENERIC_KOMOOT_NAME_RE.test(cleanParsed);

  const suggestedIsReal =
    cleanSuggested !== '' && !GENERIC_KOMOOT_NAME_RE.test(cleanSuggested);

  if (suggestedIsReal && (parsedIsGeneric || cleanSuggested !== cleanParsed)) {
    return cleanSuggested;
  }

  if (cleanParsed) return cleanParsed;
  if (cleanSuggested) return cleanSuggested;
  if (cleanFallback) return cleanFallback;
  return 'Route';
}

/**
 * Filters workspace tracks by search query, activity type, and source (e.g. Komoot).
 */
export function filterWorkspaceTracks(
  tracks: GPXTrack[],
  options: WorkspaceFilterOptions
): GPXTrack[] {
  const activityFilter = options.activityFilter || 'all';
  const sourceFilter = options.sourceFilter || 'all';
  const normalizedQuery = (options.query || '').trim().toLowerCase();

  return tracks.filter((track) => {
    if (activityFilter !== 'all' && track.activityType !== activityFilter) {
      return false;
    }

    const komootMeta = getKomootSourceMeta(track);
    if (sourceFilter === 'komoot' && !komootMeta) {
      return false;
    }

    if (normalizedQuery) {
      const haystacks: string[] = [
        track.name || '',
        track.tourGroup || '',
        track.originalFilename || '',
        ...(Array.isArray(track.tags) ? track.tags : []),
        komootMeta?.komootCollectionTitle || '',
        komootMeta?.komootTourId || ''
      ];
      const matched = haystacks.some((item) => item.toLowerCase().includes(normalizedQuery));
      if (!matched) return false;
    }

    return true;
  });
}

function formatDurationCompact(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '—';
  const totalMinutes = Math.round(seconds / 60);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours > 0) {
    return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  }
  return `${minutes} min`;
}

/**
 * Formats a clean, plain-text German summary of a GPX/FIT track for quick clipboard sharing.
 */
export function formatTrackQuickSummary(
  track: GPXTrack,
  estimatedSpeedKmh = 25
): string {
  const isRunning = track.activityType === 'running';
  const sportLabel = isRunning ? 'Laufen' : 'Radsport';
  const distKm = Number.isFinite(track.distance) ? track.distance : 0;
  const ascentM = Number.isFinite(track.ascent) ? Math.round(track.ascent) : 0;
  const descentM = Number.isFinite(track.descent) ? Math.round(track.descent) : 0;

  let durationSec = 0;
  let isEstimatedDuration = false;
  if (track.duration && track.duration > 0) {
    durationSec = track.duration;
  } else if (distKm > 0 && estimatedSpeedKmh > 0) {
    const speedForEstimate = isRunning ? Math.min(estimatedSpeedKmh, 12) : estimatedSpeedKmh;
    durationSec = (distKm / speedForEstimate) * 3600;
    isEstimatedDuration = true;
  }

  const lines: string[] = [
    `${track.name || 'Unbenannte Route'} (${sportLabel})`,
    `Distanz: ${distKm.toFixed(2)} km | Anstieg: +${ascentM} hm | Abstieg: -${descentM} hm`
  ];

  const perfParts: string[] = [];
  if (durationSec > 0) {
    perfParts.push(`Dauer: ${isEstimatedDuration ? '~' : ''}${formatDurationCompact(durationSec)}`);
  }

  if (distKm > 0 && durationSec > 0) {
    const avgKmh = distKm / (durationSec / 3600);
    if (isRunning) {
      perfParts.push(`Pace: ${getPaceString(avgKmh)}`);
    } else {
      perfParts.push(`Schnitt: ${avgKmh.toFixed(1)} km/h`);
    }
  }

  const hrValues = (track.points || [])
    .map((p) => p?.hr)
    .filter((hr): hr is number => typeof hr === 'number' && Number.isFinite(hr) && hr > 0);
  if (hrValues.length > 0) {
    const avgHr = hrValues.reduce((sum, val) => sum + val, 0) / hrValues.length;
    perfParts.push(`Ø Puls: ${Math.round(avgHr)} bpm`);
  }

  if (track.powerStats?.avgPower && track.powerStats.avgPower > 0) {
    perfParts.push(`Ø Leistung: ${Math.round(track.powerStats.avgPower)} W`);
  }

  if (perfParts.length > 0) {
    lines.push(perfParts.join(' | '));
  }

  const komootMeta = getKomootSourceMeta(track);
  if (komootMeta?.sourceUrl && /^https?:\/\//i.test(komootMeta.sourceUrl)) {
    lines.push(`Quelle: ${komootMeta.sourceUrl}`);
  }

  return lines.join('\n');
}
