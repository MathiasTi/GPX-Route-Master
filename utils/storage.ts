import { GPXTrack } from '../types';

const WORKSPACE_TRACKS_KEY = 'velo_workspace_tracks';
const TEXT_MARKERS_KEY = 'velo_text_markers';
const MARKED_TRACK_KEY = 'velo_workspace_marked_track';
const ACTIVE_LAYER_KEY = 'velo_workspace_active_layer';
const THEME_KEY = 'gpx_theme';
const MAX_SAFE_LOCALSTORAGE_BYTES = 3.5 * 1024 * 1024; // 3.5 MB threshold

/**
 * Safely writes to localStorage with quota protection and fallback handling
 */
export function safeSetItem(key: string, value: string): boolean {
  if (typeof window === 'undefined' || !window.localStorage) return false;
  try {
    localStorage.setItem(key, value);
    return true;
  } catch (err: any) {
    console.warn(`[SafeStorage] Failed to save key "${key}":`, err.message || err);
    return false;
  }
}

/**
 * Safely reads from localStorage
 */
export function safeGetItem(key: string, defaultValue: string | null = null): string | null {
  if (typeof window === 'undefined' || !window.localStorage) return defaultValue;
  try {
    const item = localStorage.getItem(key);
    return item !== null ? item : defaultValue;
  } catch (err: any) {
    console.warn(`[SafeStorage] Failed to read key "${key}":`, err.message || err);
    return defaultValue;
  }
}

/**
 * Safely removes an item from localStorage
 */
export function safeRemoveItem(key: string): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    localStorage.removeItem(key);
  } catch (e) {}
}

/**
 * Strips heavy transient properties (raw blobs, unparsed XML buffers) from tracks before serialization
 */
export function sanitizeTracksForStorage(tracks: GPXTrack[]): any[] {
  if (!tracks || !Array.isArray(tracks)) return [];
  
  return tracks.map(t => {
    const {
      rawRecord,
      raw_file_json,
      ...essentialTrackData
    } = t as any;

    return essentialTrackData;
  });
}

/**
 * Saves workspace tracks with automatic payload size check & progressive optimization
 */
export function saveWorkspaceTracks(tracks: GPXTrack[]): boolean {
  if (!tracks || tracks.length === 0) {
    safeRemoveItem(WORKSPACE_TRACKS_KEY);
    return true;
  }

  const cleanTracks = sanitizeTracksForStorage(tracks);
  let serialized = '';
  
  try {
    serialized = JSON.stringify(cleanTracks);
  } catch (err: any) {
    console.error('[SafeStorage] JSON serialization failed:', err);
    return false;
  }

  // If within safe quota limit, save directly
  if (serialized.length <= MAX_SAFE_LOCALSTORAGE_BYTES) {
    const success = safeSetItem(WORKSPACE_TRACKS_KEY, serialized);
    if (success) return true;
  }

  // Quota optimization fallback: strip non-essential properties if dataset is too large
  try {
    const lightweightTracks = cleanTracks.map(t => ({
      id: t.id,
      name: t.name,
      distance: t.distance,
      ascent: t.ascent,
      descent: t.descent,
      duration: t.duration,
      activityType: t.activityType,
      color: t.color,
      visible: t.visible,
      date: t.date,
      surfaceStats: t.surfaceStats,
      powerStats: t.powerStats,
      climbs: t.climbs,
      points: t.points.map((p: any) => ({
        lat: p.lat,
        lng: p.lng,
        ele: p.ele,
        time: p.time,
        hr: p.hr,
        power: p.power,
        cadence: p.cadence,
        surface: p.surface
      }))
    }));

    return safeSetItem(WORKSPACE_TRACKS_KEY, JSON.stringify(lightweightTracks));
  } catch (fallbackErr: any) {
    console.error('[SafeStorage] Progressive optimization fallback failed:', fallbackErr);
    return false;
  }
}

/**
 * Loads and validates workspace tracks from localStorage
 */
export function loadWorkspaceTracks(): GPXTrack[] {
  const raw = safeGetItem(WORKSPACE_TRACKS_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.length > 0) {
      return parsed.filter(t => t && t.id && Array.isArray(t.points));
    }
  } catch (e: any) {
    console.warn('[SafeStorage] Failed to parse workspace tracks from localStorage:', e.message);
  }
  return [];
}
