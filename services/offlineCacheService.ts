import { 
  StorageQuotaEstimate, 
  OfflineSyncState, 
  calculateOccupancyPercentage, 
  evaluateSyncState 
} from '../domain/offline/offlineCacheEngine';
import { Result, ok, err } from '../domain/core/result';
import { clearSWTileCache } from '../utils/serviceWorker';
import {
  DEFAULT_MAX_TILE_CACHE_BYTES,
  getTileCacheStats,
  clearTileCache
} from '../utils/tileCacheDb';
import { GPXTrack } from '../types';

export interface OfflineStatusSnapshot {
  readonly quota: StorageQuotaEstimate;
  readonly tileCount: number;
  readonly tileCacheBytes: number;
  readonly maxTileCacheBytes: number;
  readonly tileLayers: Record<string, { count: number; bytes: number }>;
  readonly shellCount: number;
  readonly trackCount: number;
  readonly totalPoints: number;
  readonly tracksPayloadBytes: number;
  readonly isOnline: boolean;
  readonly isSyncing: boolean;
  readonly syncState: OfflineSyncState;
  readonly lastChecked: number;
}

const LEGACY_TILE_CACHE_NAME = 'velo-tiles-velo-v2';

/**
 * Queries storage quota estimates from the StorageManager API.
 */
async function queryStorageQuota(): Promise<StorageQuotaEstimate> {
  let usage = 0;
  let quota = 1024 * 1024 * 1024; // Default fallback to 1 GB

  if (typeof navigator !== 'undefined' && navigator.storage && typeof navigator.storage.estimate === 'function') {
    try {
      const estimate = await navigator.storage.estimate();
      if (typeof estimate.usage === 'number' && Number.isFinite(estimate.usage)) {
        usage = estimate.usage;
      }
      if (typeof estimate.quota === 'number' && Number.isFinite(estimate.quota) && estimate.quota > 0) {
        quota = estimate.quota;
      }
    } catch {
      // Sandboxed iframe restrictions or permission denial
    }
  }

  // Calculate percentage via domain engine
  const percentResult = calculateOccupancyPercentage(usage, quota);
  const usagePercentage = percentResult.success ? percentResult.data : 0;

  return {
    usageBytes: usage,
    quotaBytes: quota,
    usagePercentage
  };
}

/**
 * Aggregates points and byte size for in-memory workspace tracks.
 */
function analyzeTrackFootprint(tracks: readonly GPXTrack[]): { 
  count: number; 
  points: number; 
  payloadBytes: number; 
} {
  const count = tracks.length;
  let points = 0;

  for (const track of tracks) {
    points += track.points ? track.points.length : 0;
  }

  let payloadBytes = 0;
  if (typeof window !== 'undefined' && window.localStorage) {
    try {
      const stored = localStorage.getItem('velo_workspace_tracks');
      if (stored) {
        payloadBytes = stored.length * 2; // UTF-16 approximation
      }
    } catch {
      payloadBytes = 0;
    }
  }

  return { count, points, payloadBytes };
}

/**
 * Service to retrieve a snapshot of offline storage and IndexedDB tile cache states.
 */
export async function getOfflineStatusSnapshot(
  tracks: readonly GPXTrack[],
  isOnline: boolean,
  isSyncing: boolean = false
): Promise<Result<OfflineStatusSnapshot, Error>> {
  try {
    const [quota, idbStats] = await Promise.all([
      queryStorageQuota(),
      getTileCacheStats(DEFAULT_MAX_TILE_CACHE_BYTES)
    ]);

    const trackFootprint = analyzeTrackFootprint(tracks);
    const syncState = evaluateSyncState({
      isOnline,
      isSyncing,
      tileCount: idbStats.tileCount,
      trackCount: trackFootprint.count
    });

    const snapshot: OfflineStatusSnapshot = {
      quota,
      tileCount: idbStats.tileCount,
      tileCacheBytes: idbStats.tileCacheBytes,
      maxTileCacheBytes: idbStats.maxTileCacheBytes,
      tileLayers: idbStats.layers,
      shellCount: 1,
      trackCount: trackFootprint.count,
      totalPoints: trackFootprint.points,
      tracksPayloadBytes: trackFootprint.payloadBytes,
      isOnline,
      isSyncing,
      syncState,
      lastChecked: Date.now()
    };

    return ok(snapshot);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Unknown storage inspection error';
    return err(new Error(message));
  }
}

/**
 * Clears the IndexedDB offline map tile cache (and any legacy SW caches) and returns operation result.
 */
export async function purgeTileCache(): Promise<Result<boolean, Error>> {
  try {
    const idbCleared = await clearTileCache();

    if (typeof window !== 'undefined' && 'caches' in window) {
      try {
        await caches.delete(LEGACY_TILE_CACHE_NAME);
      } catch {
        // Ignore legacy CacheStorage cleanup errors
      }
    }

    try {
      await clearSWTileCache();
    } catch {
      // Ignore if SW inactive
    }

    return ok(idbCleared);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Failed to clear offline tile cache';
    return err(new Error(message));
  }
}
