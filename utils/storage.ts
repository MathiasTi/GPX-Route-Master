import { GPXTrack } from '../types';
import { safeJsonStringify, safeJsonParse } from '../domain/serialization/safeJson';

const WORKSPACE_TRACKS_KEY = 'velo_workspace_tracks';
const TEXT_MARKERS_KEY = 'velo_text_markers';
const MARKED_TRACK_KEY = 'velo_workspace_marked_track';
const ACTIVE_LAYER_KEY = 'velo_workspace_active_layer';
const THEME_KEY = 'gpx_theme';
const MAX_SAFE_LOCALSTORAGE_BYTES = 3.5 * 1024 * 1024; // 3.5 MB threshold

// In-memory fallback map if localStorage is unavailable, blocked, or restricted in sandboxed iframe
const memoryStorage = new Map<string, string>();

function getStorage(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    const storage = window.localStorage;
    if (!storage) return null;
    const testKey = '__velo_storage_probe__';
    storage.setItem(testKey, 'probe');
    storage.removeItem(testKey);
    return storage;
  } catch (e) {
    // In sandboxed iframes or strict browser privacy contexts, window.localStorage throws DOMException
    return null;
  }
}

/**
 * Safely writes to localStorage with quota protection, in-memory fallback, and error handling
 */
export function safeSetItem(key: string, value: string): boolean {
  try {
    const storage = getStorage();
    if (storage) {
      storage.setItem(key, value);
      memoryStorage.set(key, value);
      return true;
    }
  } catch (err: any) {
    console.warn(`[SafeStorage] Failed to save key "${key}" to localStorage:`, err?.message || err);
  }
  memoryStorage.set(key, value);
  return true;
}

/**
 * Safely reads from localStorage or memory fallback
 */
export function safeGetItem(key: string, defaultValue: string | null = null): string | null {
  try {
    const storage = getStorage();
    if (storage) {
      const item = storage.getItem(key);
      if (item !== null) return item;
    }
  } catch (err: any) {
    console.warn(`[SafeStorage] Failed to read key "${key}" from localStorage:`, err?.message || err);
  }
  return memoryStorage.has(key) ? (memoryStorage.get(key) ?? defaultValue) : defaultValue;
}

/**
 * Safely removes an item from localStorage and memory fallback
 */
export function safeRemoveItem(key: string): void {
  try {
    const storage = getStorage();
    if (storage) {
      storage.removeItem(key);
    }
  } catch (e) {}
  memoryStorage.delete(key);
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
  const serializeRes = safeJsonStringify(cleanTracks);
  
  if (!serializeRes.success) {
    console.warn('[SafeStorage] Circular or unhandled serialization issue:', serializeRes.error.message);
    return false;
  }

  const serialized = serializeRes.data;

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
      points: Array.isArray(t.points) ? t.points.map((p: any) => ({
        lat: p.lat,
        lng: p.lng,
        ele: p.ele,
        time: p.time,
        hr: p.hr,
        power: p.power,
        cadence: p.cadence,
        surface: p.surface
      })) : []
    }));

    const lightweightRes = safeJsonStringify(lightweightTracks);
    if (lightweightRes.success) {
      return safeSetItem(WORKSPACE_TRACKS_KEY, lightweightRes.data);
    }
    return false;
  } catch (fallbackErr: any) {
    console.error('[SafeStorage] Progressive optimization fallback failed:', fallbackErr);
    return false;
  }
}

/**
 * Checks if a track is one of the default curated reference tours (e.g. Alpentour stages)
 */
export function isDefaultCuratedTrack(track: { id?: string; name?: string; tags?: string[] } | null | undefined): boolean {
  if (!track) return false;
  if (track.id && track.id.startsWith('gpx-alpentour-tag-')) return true;
  if (typeof track.name === 'string' && track.name.startsWith('Alpentour Tag')) return true;
  if (Array.isArray(track.tags) && track.tags.includes('Alpentour')) return true;
  return false;
}

/**
 * Loads and validates workspace tracks from localStorage.
 * Default reference tours are segregated into the library, keeping the active workspace clean.
 */
export function loadWorkspaceTracks(): GPXTrack[] {
  const defaultsMoved = safeGetItem('velo_defaults_moved_to_library_v1') === 'true';
  const raw = safeGetItem(WORKSPACE_TRACKS_KEY);
  if (!raw) return [];

  const parsedRes = safeJsonParse<GPXTrack[]>(raw, []);
  if (parsedRes.success && Array.isArray(parsedRes.data) && parsedRes.data.length > 0) {
    const valid = parsedRes.data.filter(t => t && t.id && Array.isArray(t.points));
    if (!defaultsMoved) {
      // One-time migration: filter out default reference tracks from workspace so they reside solely in the Library
      const userTracksOnly = valid.filter(t => !isDefaultCuratedTrack(t));
      safeSetItem('velo_defaults_moved_to_library_v1', 'true');
      saveWorkspaceTracks(userTracksOnly);
      return userTracksOnly;
    }
    return valid;
  }
  return [];
}
