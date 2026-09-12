import { calculateWorkspaceSummary, getVisibleTracksBoundingBox, WorkspaceSummaryStats } from '../components/WorkspaceSummaryDashboard';
import { GPXTrack, GPXPoint } from '../types';

export function runWorkspaceSummaryDashboardTests(): boolean {
  console.log('🧪 Running Workspace Summary Dashboard & Multi-Track Aggregation Test Suite...');
  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      passed++;
      console.log(`  ✅ [PASS] ${msg}`);
    } else {
      failed++;
      console.error(`  ❌ [FAIL] ${msg}`);
    }
  };

  // Helper to create mock tracks
  const createMockTrack = (
    id: string,
    name: string,
    distance: number,
    ascent: number,
    descent: number,
    visible: boolean,
    points: GPXPoint[] = [],
    duration?: number,
    activityType: 'cycling' | 'running' = 'cycling'
  ): GPXTrack => ({
    id,
    name,
    distance,
    ascent,
    descent,
    maxSlope: 8.5,
    color: '#6366f1',
    visible,
    points,
    duration,
    activityType
  });

  // Test 1: Empty tracks array
  const emptySummary = calculateWorkspaceSummary([], 75, 25);
  assert(emptySummary.totalTracks === 0, 'Empty tracks list returns totalTracks = 0');
  assert(emptySummary.visibleTracksCount === 0, 'Empty tracks list returns visibleTracksCount = 0');
  assert(emptySummary.totalDistanceKm === 0, 'Empty tracks list returns totalDistanceKm = 0');
  assert(emptySummary.totalAscentM === 0, 'Empty tracks list returns totalAscentM = 0');
  assert(emptySummary.totalDescentM === 0, 'Empty tracks list returns totalDescentM = 0');
  assert(emptySummary.minElevationM === null && emptySummary.maxElevationM === null, 'Empty tracks list min/max elevation is null');

  // Test 2: Multiple tracks with all hidden (visible = false)
  const trackA = createMockTrack('1', 'Track 1', 45.5, 1200, 1150, false);
  const trackB = createMockTrack('2', 'Track 2', 30.0, 800, 850, false);
  const hiddenSummary = calculateWorkspaceSummary([trackA, trackB], 75, 25);
  assert(hiddenSummary.totalTracks === 2, 'Total tracks count correctly reflects hidden tracks (2)');
  assert(hiddenSummary.visibleTracksCount === 0, 'Visible tracks count is 0 when all tracks are hidden');
  assert(hiddenSummary.totalDistanceKm === 0, 'Cumulative distance is 0 for hidden tracks');
  assert(hiddenSummary.totalAscentM === 0, 'Total ascentM is 0 for hidden tracks');

  // Test 3: Multiple visible tracks combined calculations
  const track1 = createMockTrack('t1', 'Berg-Tour Süd', 52.4, 1420, 1400, true, [
    { lat: 47.5, lng: 11.2, ele: 650, dist: 0 },
    { lat: 47.6, lng: 11.3, ele: 1850, dist: 26.2 },
    { lat: 47.7, lng: 11.4, ele: 670, dist: 52.4 }
  ], 7200); // 2 hours

  const track2 = createMockTrack('t2', 'Pass-Überquerung', 38.6, 1150, 1120, true, [
    { lat: 47.4, lng: 11.0, ele: 520, dist: 0 },
    { lat: 47.55, lng: 11.15, ele: 2100, dist: 19.3 },
    { lat: 47.65, lng: 11.25, ele: 550, dist: 38.6 }
  ], 5400); // 1.5 hours

  const track3 = createMockTrack('t3', 'Versteckter Track', 100.0, 3000, 3000, false);

  const combinedSummary = calculateWorkspaceSummary([track1, track2, track3], 75, 25);
  assert(combinedSummary.totalTracks === 3, 'Total tracks count is 3');
  assert(combinedSummary.visibleTracksCount === 2, 'Visible tracks count is 2');
  
  // Distance: 52.4 + 38.6 = 91.0 km
  assert(Math.abs(combinedSummary.totalDistanceKm - 91.0) < 0.001, `Cumulative distance is 91.0 km (got ${combinedSummary.totalDistanceKm})`);
  
  // Ascent: 1420 + 1150 = 2570 m
  assert(combinedSummary.totalAscentM === 2570, `Total ascent is 2570 m (got ${combinedSummary.totalAscentM})`);
  
  // Descent: 1400 + 1120 = 2520 m
  assert(combinedSummary.totalDescentM === 2520, `Total descent is 2520 m (got ${combinedSummary.totalDescentM})`);
  
  // Net elevation: 2570 - 2520 = 50 m
  assert(combinedSummary.netElevationM === 50, `Net elevation is 50 m (got ${combinedSummary.netElevationM})`);

  // Elevation extremes: Min across visible points = 520 m, Max = 2100 m
  assert(combinedSummary.minElevationM === 520, `Min elevation is 520 m (got ${combinedSummary.minElevationM})`);
  assert(combinedSummary.maxElevationM === 2100, `Max elevation is 2100 m (got ${combinedSummary.maxElevationM})`);

  // Duration: 7200 + 5400 = 12600 seconds
  assert(combinedSummary.totalDurationSeconds === 12600, `Total duration is 12600 s (got ${combinedSummary.totalDurationSeconds})`);

  // Estimated Calories > 0
  assert(combinedSummary.estimatedCaloriesKcal > 0, `Estimated calories is positive (${combinedSummary.estimatedCaloriesKcal} kcal)`);

  // Test 4: Duration estimation fallback when track.duration is missing
  const trackNoDuration = createMockTrack('t4', 'Ohne Zeitstempel', 50.0, 500, 500, true);
  const summarySpeedFallback = calculateWorkspaceSummary([trackNoDuration], 75, 25);
  // 50 km at 25 km/h = 2 hours = 7200 seconds
  assert(Math.abs(summarySpeedFallback.totalDurationSeconds - 7200) < 1, `Estimated duration fallback is 7200s (got ${summarySpeedFallback.totalDurationSeconds})`);

  // Test 5: Bounding Box Calculation for Visible Tracks (with buffer)
  const bbox = getVisibleTracksBoundingBox([track1, track2, track3]);
  assert(bbox !== null, 'Bounding box is computed for visible tracks');
  if (bbox) {
    // Expected bounds without buffer: lat 47.4 to 47.7, lng 11.0 to 11.4
    // lat range = 0.3, buffer = 0.3 * 0.08 = 0.024 -> minLat = 47.376, maxLat = 47.724
    // lng range = 0.4, buffer = 0.4 * 0.08 = 0.032 -> minLng = 10.968, maxLng = 11.432
    assert(bbox.minLat < 47.4 && bbox.maxLat > 47.7, `BBox covers full latitude range [${bbox.minLat}, ${bbox.maxLat}]`);
    assert(bbox.minLng < 11.0 && bbox.maxLng > 11.4, `BBox covers full longitude range [${bbox.minLng}, ${bbox.maxLng}]`);
  }

  // Test 6: Bounding Box returns null when no visible tracks exist
  const emptyBbox = getVisibleTracksBoundingBox([track3]);
  assert(emptyBbox === null, 'Bounding box returns null when all tracks are hidden');

  // Test 7: Cycling vs Running activity breakdown
  const cyclingTrack = createMockTrack('c1', 'Rennrad', 80, 1000, 1000, true, [], undefined, 'cycling');
  const runningTrack = createMockTrack('r1', 'Lauf', 15, 200, 200, true, [], undefined, 'running');
  const activitySummary = calculateWorkspaceSummary([cyclingTrack, runningTrack], 75, 25);
  assert(activitySummary.activityBreakdown.cycling === 1 && activitySummary.activityBreakdown.running === 1, 'Summary detects both cycling and running visible tracks');

  console.log(`\nWorkspace Summary Dashboard Test Suite: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
