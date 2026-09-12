import { sanitizeTracksForStorage, saveWorkspaceTracks, loadWorkspaceTracks, safeSetItem, safeGetItem } from '../utils/storage';
import { GPXTrack } from '../types';

export function runStorageAndArchitectureTests() {
  console.log('🧪 Starting Storage & Architectural Stability Unit Tests...\n');
  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string) {
    if (condition) {
      console.log(`  ✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`  ❌ [FAIL] ${testName}`);
      failed++;
    }
  }

  // Test 1: sanitizeTracksForStorage strips heavy raw buffers
  const mockTrack: any = {
    id: 'track-1',
    name: 'Alpe d Huez Climb',
    distance: 13.8,
    ascent: 1110,
    descent: 20,
    color: '#ef4444',
    rawRecord: { bigRawPayload: new Array(10000).fill('data') },
    raw_file_json: '{"heavy":"blob"}',
    points: [
      { lat: 45.09, lng: 6.06, ele: 720 },
      { lat: 45.10, lng: 6.07, ele: 850 }
    ]
  };

  const sanitized = sanitizeTracksForStorage([mockTrack]);
  assert(sanitized.length === 1, 'sanitizeTracksForStorage keeps valid tracks');
  assert(sanitized[0].rawRecord === undefined, 'sanitizeTracksForStorage strips rawRecord');
  assert(sanitized[0].raw_file_json === undefined, 'sanitizeTracksForStorage strips raw_file_json');
  assert(sanitized[0].points.length === 2, 'sanitizeTracksForStorage preserves track points');

  // Test 2: Safe storage handles empty/null gracefully
  const emptySanitized = sanitizeTracksForStorage([] as any);
  assert(Array.isArray(emptySanitized) && emptySanitized.length === 0, 'sanitizeTracksForStorage handles empty array');

  // Setup mock localStorage on globalThis for testing storage operations
  const mockStorage: Record<string, string> = {};
  (globalThis as any).window = {
    localStorage: {
      setItem: (k: string, v: string) => { mockStorage[k] = v; },
      getItem: (k: string) => mockStorage[k] !== undefined ? mockStorage[k] : null,
      removeItem: (k: string) => { delete mockStorage[k]; }
    }
  };

  // Test 3: safeSetItem & safeGetItem in memory/browser
  const testKey = 'test_architecture_key';
  const testVal = 'architecture_stable_v1';
  const setOk = safeSetItem(testKey, testVal);
  assert(setOk, 'safeSetItem succeeds when localStorage available');
  const readVal = safeGetItem(testKey);
  assert(readVal === testVal, 'safeGetItem retrieves correct value');

  // Test 4: Cyclic structure immunity in saveWorkspaceTracks
  const cyclicTrack: any = {
    id: 'track-cyclic-test',
    name: 'Cyclic Track',
    distance: 10,
    ascent: 200,
    descent: 200,
    color: '#3b82f6',
    points: [
      { lat: 47.0, lng: 11.0, ele: 600 }
    ]
  };
  // Introduce direct cyclic reference:
  cyclicTrack.self = cyclicTrack;
  cyclicTrack.points[0].parent = cyclicTrack;

  let cyclicSaveSuccess = false;
  try {
    cyclicSaveSuccess = saveWorkspaceTracks([cyclicTrack]);
  } catch (err) {
    cyclicSaveSuccess = false;
  }
  assert(cyclicSaveSuccess, 'saveWorkspaceTracks survives and succeeds with circular reference without throwing');

  // Test 5: Verify loaded cyclic track does not break loadWorkspaceTracks
  const loadedTracks = loadWorkspaceTracks();
  assert(loadedTracks.length === 1 && loadedTracks[0].id === 'track-cyclic-test', 'loadWorkspaceTracks recovers sanitized track');

  console.log(`\n📊 Storage & Architecture Test Summary: ${passed} Passed, ${failed} Failed`);
  return { passed, failed };
}

if (typeof process !== 'undefined' && process.argv && process.argv[1]?.includes('storageAndArchitecture.test')) {
  const { failed } = runStorageAndArchitectureTests();
  if (failed > 0) process.exit(1);
}
