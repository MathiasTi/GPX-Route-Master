import { 
  calculateOccupancyPercentage, 
  formatStorageSize, 
  evaluateSyncState, 
  getStorageWarningLevel 
} from '../domain/offline/offlineCacheEngine';
import { isOk, isErr } from '../domain/core/result';

export function runOfflineCacheEngineTests(): boolean {
  console.log('📦 Running Offline Cache & PWA Storage Engine Test Suite...');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, msg: string) {
    if (condition) {
      console.log(`  ✓ ${msg}`);
      passed++;
    } else {
      console.error(`  ✗ FAIL: ${msg}`);
      failed++;
    }
  }

  // --- 1. calculateOccupancyPercentage ---
  const zeroUsageResult = calculateOccupancyPercentage(0, 1000);
  assert(isOk(zeroUsageResult) && zeroUsageResult.data === 0, 'Returns 0% when usage is 0 bytes');

  const normalUsageResult = calculateOccupancyPercentage(250, 1000);
  assert(isOk(normalUsageResult) && normalUsageResult.data === 25, 'Calculates 25% for 250 of 1000 bytes');

  const decimalUsageResult = calculateOccupancyPercentage(333, 1000);
  assert(isOk(decimalUsageResult) && decimalUsageResult.data === 33.3, 'Rounds to 1 decimal place (33.3%)');

  const overflowResult = calculateOccupancyPercentage(1500, 1000);
  assert(isOk(overflowResult) && overflowResult.data === 100, 'Clamps at 100% on overflow');

  const negativeUsage = calculateOccupancyPercentage(-10, 1000);
  assert(isErr(negativeUsage), 'Rejects negative usage with Result.Err');

  const nonPositiveQuota = calculateOccupancyPercentage(100, 0);
  assert(isErr(nonPositiveQuota), 'Rejects zero quota with Result.Err');

  const negativeQuota = calculateOccupancyPercentage(100, -50);
  assert(isErr(negativeQuota), 'Rejects negative quota with Result.Err');

  // --- 2. formatStorageSize ---
  assert(formatStorageSize(0) === '0 B', 'Formats 0 B');
  assert(formatStorageSize(-50) === '0 B', 'Formats negative value as 0 B');
  assert(formatStorageSize(500) === '500 B', 'Formats bytes without decimals');
  assert(formatStorageSize(1024) === '1.0 KB', 'Formats exactly 1 KB');
  assert(formatStorageSize(1536) === '1.5 KB', 'Formats 1.5 KB');
  assert(formatStorageSize(1048576 * 14.2) === '14.2 MB', 'Formats 14.2 MB');
  assert(formatStorageSize(1073741824 * 2.5) === '2.5 GB', 'Formats 2.5 GB');

  // --- 3. evaluateSyncState ---
  const syncingState = evaluateSyncState({
    isOnline: true,
    isSyncing: true,
    tileCount: 150,
    trackCount: 5
  });
  assert(syncingState === 'syncing', 'Returns syncing when isSyncing is true');

  const offlineState = evaluateSyncState({
    isOnline: false,
    isSyncing: false,
    tileCount: 80,
    trackCount: 3
  });
  assert(offlineState === 'offline', 'Returns offline when device is disconnected');

  const emptyState = evaluateSyncState({
    isOnline: true,
    isSyncing: false,
    tileCount: 0,
    trackCount: 0
  });
  assert(emptyState === 'empty', 'Returns empty when online but nothing cached');

  const syncedState = evaluateSyncState({
    isOnline: true,
    isSyncing: false,
    tileCount: 120,
    trackCount: 4
  });
  assert(syncedState === 'synced', 'Returns synced when online and items cached');

  // --- 4. getStorageWarningLevel ---
  assert(getStorageWarningLevel(15) === 'normal', 'Normal warning level for 15%');
  assert(getStorageWarningLevel(69.9) === 'normal', 'Normal warning level for 69.9%');
  assert(getStorageWarningLevel(70) === 'elevated', 'Elevated warning level for 70%');
  assert(getStorageWarningLevel(89.9) === 'elevated', 'Elevated warning level for 89.9%');
  assert(getStorageWarningLevel(90) === 'critical', 'Critical warning level for 90%');
  assert(getStorageWarningLevel(98.5) === 'critical', 'Critical warning level for 98.5%');

  console.log(`Offline Cache Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
