import { Result, ok, err } from '../core/result';

/**
 * Storage quota measurement data transfer object
 */
export interface StorageQuotaEstimate {
  readonly usageBytes: number;
  readonly quotaBytes: number;
  readonly usagePercentage: number;
}

/**
 * Offline PWA Synchronization States
 */
export type OfflineSyncState = 'synced' | 'syncing' | 'offline' | 'empty' | 'stale';

export interface EvaluateSyncStateParams {
  readonly isOnline: boolean;
  readonly isSyncing: boolean;
  readonly tileCount: number;
  readonly trackCount: number;
}

export type StorageWarningLevel = 'normal' | 'elevated' | 'critical';

/**
 * Pure domain function to calculate storage occupancy percentage safely.
 * Returns a Result type with explicit error validation.
 */
export function calculateOccupancyPercentage(
  usageBytes: number,
  quotaBytes: number
): Result<number, Error> {
  if (usageBytes < 0) {
    return err(new Error('usageBytes must be greater than or equal to 0'));
  }
  if (quotaBytes <= 0 || !Number.isFinite(quotaBytes)) {
    return err(new Error('quotaBytes must be a positive finite number'));
  }

  const ratio = (usageBytes / quotaBytes) * 100;
  const clamped = Math.min(100, Math.max(0, ratio));
  const rounded = Math.round(clamped * 10) / 10;
  return ok(rounded);
}

/**
 * Pure domain function to format bytes into human-readable metric units.
 */
export function formatStorageSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return '0 B';
  }

  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  const base = 1024;
  const digitGroups = Math.min(
    units.length - 1,
    Math.floor(Math.log(bytes) / Math.log(base))
  );

  const value = bytes / Math.pow(base, digitGroups);
  const formatted = digitGroups === 0 ? Math.round(value) : value.toFixed(1);
  return `${formatted} ${units[digitGroups]}`;
}

/**
 * Pure domain function evaluating the synchronization lifecycle state.
 */
export function evaluateSyncState(params: EvaluateSyncStateParams): OfflineSyncState {
  const { isOnline, isSyncing, tileCount, trackCount } = params;

  if (isSyncing) {
    return 'syncing';
  }

  if (!isOnline) {
    return 'offline';
  }

  if (tileCount === 0 && trackCount === 0) {
    return 'empty';
  }

  return 'synced';
}

/**
 * Pure domain function to classify storage risk thresholds.
 */
export function getStorageWarningLevel(percentage: number): StorageWarningLevel {
  if (percentage >= 90) {
    return 'critical';
  }
  if (percentage >= 70) {
    return 'elevated';
  }
  return 'normal';
}
