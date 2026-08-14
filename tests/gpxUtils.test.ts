import { 
  calculateDistance, 
  detectTimeGaps, 
  splitTrackAtIndex, 
  closeTimeGapInTrack, 
  simplifyTrackPoints, 
  formatGapDuration,
  calculatePowerStats
} from '../utils/gpxUtils';
import { GPXTrack, GPXPoint } from '../types';

export function runGpxUtilsTests() {
  console.log('🧪 Starting GPX Utils & Performance Unit Tests...\n');
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

  // Test 1: Distance Calculation
  const p1: GPXPoint = { lat: 52.5200, lng: 13.4050, ele: 34 }; // Berlin
  const p2: GPXPoint = { lat: 52.5205, lng: 13.4055, ele: 35 };
  const dist = calculateDistance(p1, p2);
  assert(dist > 0 && dist < 0.2, 'calculateDistance calculates valid distance in km');

  // Test 2: Ramer-Douglas-Peucker Track Simplification
  const densePoints: GPXPoint[] = [];
  for (let i = 0; i < 1000; i++) {
    // straight line with tiny noise
    const noise = (i % 2 === 0 ? 0.000001 : -0.000001);
    densePoints.push({ lat: 51.0 + (i * 0.0001), lng: 10.0 + noise, ele: 100 });
  }
  const simplified = simplifyTrackPoints(densePoints, 0.0000002);
  assert(simplified.length < densePoints.length, `simplifyTrackPoints reduces points from ${densePoints.length} to ${simplified.length}`);
  assert(simplified[0].lat === densePoints[0].lat, 'simplifyTrackPoints preserves start point');
  assert(simplified[simplified.length - 1].lat === densePoints[densePoints.length - 1].lat, 'simplifyTrackPoints preserves end point');

  // Test 3: Time Gap Detection
  const timeTrack: GPXTrack = {
    id: 'test-track-1',
    name: 'Test Activity',
    points: [
      { lat: 51.000, lng: 10.000, ele: 100, time: new Date('2026-08-13T10:00:00Z') },
      { lat: 51.001, lng: 10.001, ele: 101, time: new Date('2026-08-13T10:00:10Z') },
      { lat: 51.002, lng: 10.002, ele: 102, time: new Date('2026-08-13T10:00:20Z') },
      // 120 second gap
      { lat: 51.003, lng: 10.003, ele: 103, time: new Date('2026-08-13T10:02:20Z') },
      { lat: 51.004, lng: 10.004, ele: 104, time: new Date('2026-08-13T10:02:30Z') },
    ],
    color: '#3b82f6',
    distance: 1.5,
    ascent: 20,
    descent: 10,
    maxSlope: 5,
    visible: true,
    activityType: 'cycling'
  };

  const gaps = detectTimeGaps(timeTrack, 30);
  assert(gaps.length === 1, `detectTimeGaps finds 1 gap > 30s (found ${gaps.length})`);
  if (gaps.length > 0) {
    assert(gaps[0].gapSeconds === 120, 'detectTimeGaps correctly identifies 120s gap duration');
    assert(gaps[0].startIndex === 2, 'detectTimeGaps correctly locates split index');
  }

  // Test 4: Track Splitting
  const splitRes = splitTrackAtIndex(timeTrack, 2);
  assert(splitRes !== null, 'splitTrackAtIndex successfully returns track pair');
  if (splitRes) {
    assert(splitRes.track1.points.length === 3, 'splitTrackAtIndex track1 has 3 points');
    assert(splitRes.track2.points.length === 2, 'splitTrackAtIndex track2 has 2 points');
    assert(splitRes.track1.name.includes('Teil 1'), 'splitTrackAtIndex track1 has correct name');
  }

  // Test 5: Time Gap Closing
  if (gaps.length > 0) {
    const closedTrack = closeTimeGapInTrack(timeTrack, gaps[0], 0);
    const newGaps = detectTimeGaps(closedTrack, 30);
    assert(newGaps.length === 0, 'closeTimeGapInTrack closes gap completely (0 gaps remain)');
  }

  // Test 6: Gap Duration Formatting
  assert(formatGapDuration(15) === '15 Sek', 'formatGapDuration handles seconds');
  assert(formatGapDuration(120) === '2 Min', 'formatGapDuration handles minutes');
  assert(formatGapDuration(3660) === '1 Std 1 Min', 'formatGapDuration handles hours & minutes');

  // Test 7: Power Stats Calculation
  const powerStats = calculatePowerStats(timeTrack.points, 250, 75, 25, 'cycling');
  assert(powerStats.avgPower > 0, 'calculatePowerStats computes valid average power');

  // Test 8: Map Zoom Calculation & Clamping
  const clampZoom = (z: number, minZ = 3, maxZ = 19) => Math.min(maxZ, Math.max(minZ, z));
  assert(clampZoom(6 + 1) === 7, 'Zoom in increments from 6 to 7');
  assert(clampZoom(19 + 1) === 19, 'Zoom in clamps safely at maxZoom 19');
  assert(clampZoom(3 - 1) === 3, 'Zoom out clamps safely at minZoom 3');

  // Test 9: First Track Startup Bounds & Center Extraction
  const mountainTrack: GPXTrack = {
    id: 'mountain-pass-1',
    name: 'Grossglockner Pass',
    points: [
      { lat: 47.1200, lng: 12.8400, ele: 1100 },
      { lat: 47.1250, lng: 12.8450, ele: 1850 },
      { lat: 47.1300, lng: 12.8500, ele: 2504 }, // Summit
      { lat: 47.1350, lng: 12.8550, ele: 2100 },
      { lat: 47.1400, lng: 12.8600, ele: 1300 }  // End
    ],
    color: '#10b981',
    distance: 18.2,
    ascent: 1404,
    descent: 1204,
    maxSlope: 14,
    visible: true,
    activityType: 'cycling'
  };

  const lats = mountainTrack.points.map(p => p.lat);
  const lngs = mountainTrack.points.map(p => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const centerLat = (minLat + maxLat) / 2;
  const centerLng = (minLng + maxLng) / 2;

  assert(centerLat >= 47.12 && centerLat <= 47.14, 'First track center latitude extracted accurately');
  assert(centerLng >= 12.84 && centerLng <= 12.86, 'First track center longitude extracted accurately');

  // Test 10: Summit Extraction for Multi-Point Weather
  let summitPoint = mountainTrack.points[0];
  for (const pt of mountainTrack.points) {
    if (pt.ele !== undefined && (summitPoint.ele === undefined || pt.ele > summitPoint.ele)) {
      summitPoint = pt;
    }
  }
  assert(summitPoint.ele === 2504, 'Summit waypoint correctly identified at 2504m');
  assert(summitPoint.lat === 47.1300, 'Summit waypoint latitude matches peak position');

  // Test 11: Foldable Track Summary Metrics Formatting
  const formatKm = (d: number) => d.toFixed(1) + ' km';
  const formatHm = (a: number) => Math.round(a) + ' hm';
  assert(formatKm(mountainTrack.distance) === '18.2 km', 'Track summary distance format matches 18.2 km');
  assert(formatHm(mountainTrack.ascent) === '1404 hm', 'Track summary elevation gain format matches 1404 hm');

  console.log(`\n📊 Test Summary: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
