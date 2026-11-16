import { loadAppPreferences } from './appSettings';

export const DEFAULT_MAX_TILE_CACHE_BYTES = 150 * 1024 * 1024; // 150 MB quota cap
export const DEFAULT_MAX_TILE_COUNT = 3500;

export interface TileCachePolicy {
  enabled: boolean;
  maxBytes: number;
  maxCount: number;
}

export function getConfiguredTileCachePolicy(): TileCachePolicy {
  try {
    const prefs = loadAppPreferences();
    return {
      enabled: prefs.tileCacheEnabled,
      maxBytes: Math.max(25, prefs.tileCacheMaxMb) * 1024 * 1024,
      maxCount: Math.max(250, prefs.tileCacheMaxCount),
    };
  } catch {
    return {
      enabled: true,
      maxBytes: DEFAULT_MAX_TILE_CACHE_BYTES,
      maxCount: DEFAULT_MAX_TILE_COUNT,
    };
  }
}

const DB_NAME = 'gpx_master_tile_cache';
const DB_VERSION = 1;
const STORE_NAME = 'tiles';

export interface CachedTileRecord {
  key: string;
  layerId: string;
  url: string;
  blob: Blob;
  byteSize: number;
  createdAt: number;
  lastAccessedAt: number;
}

export interface TileCacheStats {
  tileCount: number;
  tileCacheBytes: number;
  maxTileCacheBytes: number;
  maxTileCount: number;
  layers: Record<string, { count: number; bytes: number }>;
}

let dbPromise: Promise<IDBDatabase | null> | null = null;
let lastEvictionAt = 0;

function hasIndexedDb(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}

function openTileDb(): Promise<IDBDatabase | null> {
  if (!hasIndexedDb()) return Promise.resolve(null);
  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
          store.createIndex('lastAccessedAt', 'lastAccessedAt', { unique: false });
          store.createIndex('layerId', 'layerId', { unique: false });
        }
      };
      req.onsuccess = () => {
        const db = req.result;
        db.onversionchange = () => {
          db.close();
          dbPromise = null;
        };
        resolve(db);
      };
      req.onerror = () => {
        dbPromise = null;
        resolve(null);
      };
      req.onblocked = () => {
        resolve(null);
      };
    } catch {
      dbPromise = null;
      resolve(null);
    }
  });

  return dbPromise;
}

export function buildTileCacheKey(layerId: string, url: string): string {
  const cleanLayer = (layerId || 'default').trim();
  const cleanUrl = (url || '').trim();
  return `${cleanLayer}::${cleanUrl}`;
}

export async function getCachedTileBlob(key: string): Promise<Blob | null> {
  const db = await openTileDb();
  if (!db) return null;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(key);

      req.onsuccess = () => {
        const record = req.result as CachedTileRecord | undefined;
        if (!record || !(record.blob instanceof Blob) || record.blob.size === 0) {
          resolve(null);
          return;
        }
        // Touch lastAccessedAt asynchronously without blocking image render
        const now = Date.now();
        if (now - (record.lastAccessedAt || 0) > 60_000) {
          touchTileLastAccessed(db, key, now);
        }
        resolve(record.blob);
      };

      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

function touchTileLastAccessed(db: IDBDatabase, key: string, now: number): void {
  try {
    const tx = db.transaction(STORE_NAME, 'readwrite');
    const store = tx.objectStore(STORE_NAME);
    const getReq = store.get(key);
    getReq.onsuccess = () => {
      const rec = getReq.result as CachedTileRecord | undefined;
      if (rec) {
        rec.lastAccessedAt = now;
        store.put(rec);
      }
    };
  } catch {
    // Ignore non-critical LRU timestamp touch failures
  }
}

export async function enforceTileCacheQuota(
  maxBytes?: number,
  maxCount?: number
): Promise<number> {
  const policy = getConfiguredTileCachePolicy();
  const effectiveMaxBytes = maxBytes ?? policy.maxBytes;
  const effectiveMaxCount = maxCount ?? policy.maxCount;
  const db = await openTileDb();
  if (!db) return 0;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const index = store.index('lastAccessedAt');
      const entries: Array<{ key: string; byteSize: number; lastAccessedAt: number }> = [];
      let totalBytes = 0;

      const cursorReq = index.openCursor();
      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const val = cursor.value as CachedTileRecord;
          const size = Number(val.byteSize || val.blob?.size || 0);
          totalBytes += size;
          entries.push({
            key: val.key,
            byteSize: size,
            lastAccessedAt: val.lastAccessedAt || val.createdAt || 0
          });
          cursor.continue();
          return;
        }

        // Cursor iteration finished (already ordered oldest lastAccessedAt -> newest)
        if (totalBytes <= effectiveMaxBytes && entries.length <= effectiveMaxCount) {
          resolve(0);
          return;
        }

        let evicted = 0;
        let currentCount = entries.length;
        for (const entry of entries) {
          if (totalBytes <= effectiveMaxBytes && currentCount <= effectiveMaxCount) break;
          store.delete(entry.key);
          totalBytes -= entry.byteSize;
          currentCount--;
          evicted++;
        }
        resolve(evicted);
      };

      cursorReq.onerror = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}

export async function putCachedTileBlob(
  key: string,
  layerId: string,
  url: string,
  blob: Blob,
  maxBytes?: number,
  maxCount?: number
): Promise<void> {
  const policy = getConfiguredTileCachePolicy();
  if (!policy.enabled) return;
  const effectiveMaxBytes = maxBytes ?? policy.maxBytes;
  const effectiveMaxCount = maxCount ?? policy.maxCount;
  if (!(blob instanceof Blob) || blob.size === 0) return;
  const db = await openTileDb();
  if (!db) return;

  const now = Date.now();
  const record: CachedTileRecord = {
    key,
    layerId: layerId || 'default',
    url,
    blob,
    byteSize: blob.size,
    createdAt: now,
    lastAccessedAt: now
  };

  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      store.put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });

  // Throttle LRU quota sweep so rapid map panning avoids extra cursor scans
  if (now - lastEvictionAt > 15_000) {
    lastEvictionAt = now;
    void enforceTileCacheQuota(effectiveMaxBytes, effectiveMaxCount);
  }
}

export async function getTileCacheStats(
  maxBytes?: number,
  maxCount?: number
): Promise<TileCacheStats> {
  const policy = getConfiguredTileCachePolicy();
  const effectiveMaxBytes = maxBytes ?? policy.maxBytes;
  const effectiveMaxCount = maxCount ?? policy.maxCount;
  const empty: TileCacheStats = {
    tileCount: 0,
    tileCacheBytes: 0,
    maxTileCacheBytes: effectiveMaxBytes,
    maxTileCount: effectiveMaxCount,
    layers: {}
  };

  const db = await openTileDb();
  if (!db) return empty;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const cursorReq = store.openCursor();
      let tileCount = 0;
      let tileCacheBytes = 0;
      const layers: Record<string, { count: number; bytes: number }> = {};

      cursorReq.onsuccess = () => {
        const cursor = cursorReq.result;
        if (cursor) {
          const val = cursor.value as CachedTileRecord;
          const bytes = Number(val.byteSize || val.blob?.size || 0);
          const layerKey = val.layerId || 'default';
          tileCount++;
          tileCacheBytes += bytes;
          if (!layers[layerKey]) {
            layers[layerKey] = { count: 0, bytes: 0 };
          }
          layers[layerKey].count++;
          layers[layerKey].bytes += bytes;
          cursor.continue();
          return;
        }
        resolve({
          tileCount,
          tileCacheBytes,
          maxTileCacheBytes: effectiveMaxBytes,
          maxTileCount: effectiveMaxCount,
          layers
        });
      };

      cursorReq.onerror = () => resolve(empty);
    } catch {
      resolve(empty);
    }
  });
}

export async function clearTileCache(): Promise<boolean> {
  const db = await openTileDb();
  if (!db) return false;

  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}
