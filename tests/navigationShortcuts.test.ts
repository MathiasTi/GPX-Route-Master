import { GPXTrack, GPXPoint } from '../types';
import { calculateTrackCenterAndBounds, findClimbs } from '../utils/gpxUtils';

export function runNavigationShortcutsTests(): boolean {
  console.log('🧪 Running Navigation & Pan-to Shortcuts Test Suite...');
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

  // Mock Track 1: Munich Lake Route
  const track1Points: GPXPoint[] = [
    { lat: 48.1351, lng: 11.5820, ele: 520 },
    { lat: 48.1400, lng: 11.5900, ele: 525 },
    { lat: 48.1500, lng: 11.6000, ele: 530 }
  ];
  const track1: GPXTrack = {
    id: 'track-munich',
    name: 'Munich Isar Trail',
    points: track1Points,
    distance: 3.5,
    ascent: 20,
    descent: 10,
    maxSlope: 3,
    color: '#3b82f6',
    visible: true,
    activityType: 'cycling'
  };

  // Mock Track 2: Alpine Pass Route
  const track2Points: GPXPoint[] = [
    { lat: 47.1200, lng: 12.8400, ele: 1100 },
    { lat: 47.1300, lng: 12.8500, ele: 2504 },
    { lat: 47.1400, lng: 12.8600, ele: 1300 }
  ];
  const track2: GPXTrack = {
    id: 'track-alps',
    name: 'Grossglockner Alpine',
    points: track2Points,
    distance: 18.2,
    ascent: 1404,
    descent: 1204,
    maxSlope: 14,
    color: '#10b981',
    visible: true,
    activityType: 'cycling'
  };

  // Mock Track 3: Hidden / Invisible Route
  const track3: GPXTrack = {
    id: 'track-hidden',
    name: 'Hidden Route',
    points: [{ lat: 50.0, lng: 10.0, ele: 200 }],
    distance: 1.0,
    ascent: 0,
    descent: 0,
    maxSlope: 0,
    color: '#ef4444',
    visible: false,
    activityType: 'cycling'
  };

  const allTracks = [track1, track2, track3];
  const visibleTracks = allTracks.filter(t => t.visible && t.points && t.points.length > 0);

  // Test 1: Visible track filtering for cycling
  assert(visibleTracks.length === 2, `Visible tracks correctly filtered (expected 2, got ${visibleTracks.length})`);
  assert(visibleTracks[0].id === 'track-munich', 'First visible track is Munich');
  assert(visibleTracks[1].id === 'track-alps', 'Second visible track is Alps');

  // Test 2: 'C' key cycling logic (Forward Index Calculation)
  // Case A: No track marked -> Select first visible track (index 0)
  let markedId: string | null = null;
  let nextTrackIndex = 0;
  if (markedId) {
    const currentIdx = visibleTracks.findIndex(t => t.id === markedId);
    if (currentIdx !== -1) {
      nextTrackIndex = (currentIdx + 1) % visibleTracks.length;
    }
  }
  assert(nextTrackIndex === 0, 'No marked track starts cycle at first visible track (index 0)');
  assert(visibleTracks[nextTrackIndex].id === 'track-munich', 'Cycles to Track 1');

  // Case B: Track 1 marked -> Select Track 2 (index 1)
  markedId = 'track-munich';
  if (markedId) {
    const currentIdx = visibleTracks.findIndex(t => t.id === markedId);
    if (currentIdx !== -1) {
      nextTrackIndex = (currentIdx + 1) % visibleTracks.length;
    }
  }
  assert(nextTrackIndex === 1, 'Marked Track 1 cycles to index 1');
  assert(visibleTracks[nextTrackIndex].id === 'track-alps', 'Cycles to Track 2 (Alps)');

  // Case C: Track 2 marked -> Loops back to Track 1 (index 0)
  markedId = 'track-alps';
  if (markedId) {
    const currentIdx = visibleTracks.findIndex(t => t.id === markedId);
    if (currentIdx !== -1) {
      nextTrackIndex = (currentIdx + 1) % visibleTracks.length;
    }
  }
  assert(nextTrackIndex === 0, 'Marked Track 2 loops back around to index 0');
  assert(visibleTracks[nextTrackIndex].id === 'track-munich', 'Loops back to Track 1 (Munich)');

  // Test 3: Track Center and Bounds Calculation
  const bounds1 = calculateTrackCenterAndBounds(track1);
  assert(bounds1 !== null, 'Track 1 bounds calculated successfully');
  if (bounds1) {
    assert(bounds1.minLat === 48.1351, 'Track 1 minLat matches');
    assert(bounds1.maxLat === 48.1500, 'Track 1 maxLat matches');
    assert(bounds1.centerLat === (48.1351 + 48.1500) / 2, 'Track 1 centerLat is exact midpoint');
    assert(bounds1.centerLng === (11.5820 + 11.6000) / 2, 'Track 1 centerLng is exact midpoint');
  }

  const bounds2 = calculateTrackCenterAndBounds(track2);
  assert(bounds2 !== null, 'Track 2 bounds calculated successfully');
  if (bounds2) {
    assert(bounds2.minLat === 47.1200, 'Track 2 minLat matches');
    assert(bounds2.maxLat === 47.1400, 'Track 2 maxLat matches');
    assert(bounds2.centerLat === (47.1200 + 47.1400) / 2, 'Track 2 centerLat is exact midpoint');
  }

  // Test 4: 'M' key Pan-to hovered point behavior
  const hoveredPoint: GPXPoint = { lat: 48.1400, lng: 11.5900, ele: 525 };
  let mapView = { lat: 51.0, lng: 10.0, zoom: 6, pitch: 0, bearing: 0 };

  if (hoveredPoint && typeof hoveredPoint.lat === 'number' && typeof hoveredPoint.lng === 'number') {
    mapView = {
      ...mapView,
      lat: hoveredPoint.lat,
      lng: hoveredPoint.lng
    };
  }

  assert(mapView.lat === 48.1400, 'Map view latitude updated to hovered point latitude');
  assert(mapView.lng === 11.5900, 'Map view longitude updated to hovered point longitude');
  assert(mapView.zoom === 6, 'Map view zoom level preserved during point pan');

  // Test 5: Empty & Invalid track safety
  const emptyTrack: GPXTrack = {
    id: 'empty',
    name: 'Empty Track',
    points: [],
    distance: 0,
    ascent: 0,
    descent: 0,
    maxSlope: 0,
    color: '#000',
    visible: true,
    activityType: 'cycling'
  };
  const emptyBounds = calculateTrackCenterAndBounds(emptyTrack);
  assert(emptyBounds === null, 'Empty track returns null bounds without error');

  // Test 6: Climb Culmination / Summit Peak Detection
  // Alpine Pass: Climb from 500m -> Peak 1500m (index 30) -> Descent to 800m (index 50)
  const mountainPoints: GPXPoint[] = [];
  // Uphill: 0 to 3km (points 0-30), 500m to 1500m
  for (let i = 0; i <= 30; i++) {
    mountainPoints.push({
      lat: 47.0 + (i * 0.001),
      lng: 11.0,
      ele: 500 + (i * (1000 / 30)) // Peak at point 30 (1500m)
    });
  }
  // Downhill: 3 to 5km (points 31-50), 1500m down to 800m
  for (let i = 31; i <= 50; i++) {
    mountainPoints.push({
      lat: 47.0 + (i * 0.001),
      lng: 11.0,
      ele: 1500 - ((i - 30) * 35) // Downhill
    });
  }

  const passClimbs = findClimbs(mountainPoints);
  assert(passClimbs.length === 1, `Found exactly 1 climb for mountain pass (got ${passClimbs.length})`);
  if (passClimbs.length > 0) {
    assert(passClimbs[0].endIndex === 30, `Climb ends precisely at summit index 30 (got ${passClimbs[0].endIndex})`);
    assert(mountainPoints[passClimbs[0].endIndex].ele === 1500, `Climb elevation peak is 1500m (got ${mountainPoints[passClimbs[0].endIndex].ele}m)`);
  }

  // Test 7: Multi-Pass Alpine Tour (Pass 1 at 1800m, Valley at 900m, Pass 2 at 2200m)
  const multiPassPoints: GPXPoint[] = [];
  // Pass 1: 0 to 20 (600m to 1800m)
  for (let i = 0; i <= 20; i++) {
    multiPassPoints.push({ lat: 47.1 + i * 0.001, lng: 11.2, ele: 600 + i * 60 });
  }
  // Valley descent: 21 to 40 (1800m to 900m)
  for (let i = 21; i <= 40; i++) {
    multiPassPoints.push({ lat: 47.1 + i * 0.001, lng: 11.2, ele: 1800 - (i - 20) * 45 });
  }
  // Pass 2: 41 to 70 (900m to 2200m)
  for (let i = 41; i <= 70; i++) {
    multiPassPoints.push({ lat: 47.1 + i * 0.001, lng: 11.2, ele: 900 + (i - 40) * (1300 / 30) });
  }
  // Final descent: 71 to 85 (2200m to 1200m)
  for (let i = 71; i <= 85; i++) {
    multiPassPoints.push({ lat: 47.1 + i * 0.001, lng: 11.2, ele: 2200 - (i - 70) * 66 });
  }

  const multiClimbs = findClimbs(multiPassPoints);
  assert(multiClimbs.length === 2, `Multi-pass stage detects exactly 2 passes (got ${multiClimbs.length})`);
  if (multiClimbs.length === 2) {
    assert(multiClimbs[0].endIndex === 20, `Pass 1 summit is index 20 (got ${multiClimbs[0].endIndex})`);
    assert(multiPassPoints[multiClimbs[0].endIndex].ele === 1800, `Pass 1 summit elevation is 1800m`);
    assert(multiClimbs[1].endIndex === 70, `Pass 2 summit is index 70 (got ${multiClimbs[1].endIndex})`);
    assert(multiPassPoints[multiClimbs[1].endIndex].ele === 2200, `Pass 2 summit elevation is 2200m`);
  }

  // Test 8: Summit Plateau / Ridge Pass (Summit at point 20, then 5 points of rolling 1-2m terrain before steep descent)
  const plateauPassPoints: GPXPoint[] = [];
  for (let i = 0; i <= 20; i++) {
    plateauPassPoints.push({ lat: 46.8 + i * 0.001, lng: 10.5, ele: 700 + i * 50 }); // Peak at 20 (1700m)
  }
  // Plateau: 21 to 24 (1698m, 1695m, 1697m, 1693m)
  plateauPassPoints.push({ lat: 46.821, lng: 10.5, ele: 1698 });
  plateauPassPoints.push({ lat: 46.822, lng: 10.5, ele: 1695 });
  plateauPassPoints.push({ lat: 46.823, lng: 10.5, ele: 1697 });
  plateauPassPoints.push({ lat: 46.824, lng: 10.5, ele: 1693 });
  // Downhill: 25 to 40 (1693m to 900m)
  for (let i = 25; i <= 40; i++) {
    plateauPassPoints.push({ lat: 46.8 + i * 0.001, lng: 10.5, ele: 1693 - (i - 24) * 50 });
  }

  const plateauClimbs = findClimbs(plateauPassPoints);
  assert(plateauClimbs.length === 1, `Ridge pass detects exactly 1 climb (got ${plateauClimbs.length})`);
  if (plateauClimbs.length > 0) {
    assert(plateauClimbs[0].endIndex === 20, `Plateau climb terminates precisely at true summit 20 (got ${plateauClimbs[0].endIndex})`);
    assert(plateauPassPoints[plateauClimbs[0].endIndex].ele === 1700, `Plateau climb summit elevation is 1700m`);
  }

  console.log(`\nNavigation & Pan-to Shortcuts Summary: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
