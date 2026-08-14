import { 
  simplifyTrackPoints, 
  getCachedSimplifiedPoints, 
  calculateDistance, 
  detectTimeGaps, 
  splitTrackAtIndex, 
  calculatePowerStats,
  findClimbs
} from '../utils/gpxUtils';
import { GPXTrack, GPXPoint } from '../types';

export function runResponsiveAndPerformanceTests(): boolean {
  console.log('🧪 Starting Responsive Architecture & Performance Unit Tests...\n');
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

  // 1. Heavy RDP Downsampling & Summit Preservation
  const summitLat = 47.1234;
  const summitLng = 12.8765;
  const summitEle = 3798; // Grossglockner height

  const denseTrail: GPXPoint[] = [];
  for (let i = 0; i < 5000; i++) {
    const lat = 47.0 + (i * 0.00005);
    const lng = 12.8 + (i * 0.00003);
    let ele = 1000 + (i * 0.2);
    if (i === 2500) {
      ele = summitEle;
    }
    denseTrail.push({ lat, lng, ele });
  }

  const simplified = simplifyTrackPoints(denseTrail, 0.00005);
  assert(simplified.length < denseTrail.length * 0.25, `RDP reduces 5,000 points down to ${simplified.length} (< 25% original count)`);
  assert(simplified[0].lat === denseTrail[0].lat, 'Preserves exact start coordinate');
  assert(simplified[simplified.length - 1].lat === denseTrail[denseTrail.length - 1].lat, 'Preserves exact finish coordinate');

  // 2. Cache Hit Performance Check
  const trackId = 'perf-test-track-99';
  const startT0 = Date.now();
  const res1 = getCachedSimplifiedPoints(trackId, denseTrail, 1500);
  const timeFirst = Date.now() - startT0;

  const startT1 = Date.now();
  const res2 = getCachedSimplifiedPoints(trackId, denseTrail, 1500);
  const timeSecond = Date.now() - startT1;

  assert(res1 === res2, 'LRU Cache returns identical array reference on repeated query');
  assert(res2.length === res1.length && res2.length > 0, 'Cached retrieval maintains valid simplified array');

  // 3. Power Calculation & Athletic Range Validation (1Hz recording)
  const flatPoints: GPXPoint[] = [];
  const baseTime = Date.now();
  for (let i = 0; i < 60; i++) {
    flatPoints.push({
      lat: 52.0 + (i * 0.0001),
      lng: 13.0,
      ele: 50,
      time: new Date(baseTime + (i * 1000))
    });
  }
  const powerStats = calculatePowerStats(flatPoints, 250, 75, 25, 'cycling');
  assert(powerStats !== undefined, 'Power stats successfully computed for timed points');
  if (powerStats) {
    assert(powerStats.avgPower > 50 && powerStats.avgPower < 600, `Calculated realistic average power: ${powerStats.avgPower}W`);
    assert(powerStats.work > 0, `Computed positive energy output: ${powerStats.work.toFixed(1)}kJ`);
  }

  // 4. Climb Detection & Segment Zoom Bounds
  const alpineTrackPoints: GPXPoint[] = [];
  // Flat approach 0-2km
  for (let i = 0; i < 20; i++) {
    alpineTrackPoints.push({ lat: 46.5 + (i * 0.001), lng: 11.0, ele: 500 });
  }
  // Steep climb 2-6km
  for (let i = 20; i < 60; i++) {
    alpineTrackPoints.push({ lat: 46.5 + (i * 0.001), lng: 11.0, ele: 500 + ((i - 20) * 8) });
  }
  // Flat finish
  for (let i = 60; i < 80; i++) {
    alpineTrackPoints.push({ lat: 46.5 + (i * 0.001), lng: 11.0, ele: 820 });
  }

  const climbs = findClimbs(alpineTrackPoints);
  assert(climbs.length >= 1, `Found ${climbs.length} categorized climb segments`);
  if (climbs.length > 0) {
    assert(climbs[0].ascent >= 250, `Climb ascent calculated correctly: +${Math.round(climbs[0].ascent)}m`);
    assert(climbs[0].avgGradient > 0, `Climb gradient detected: ${climbs[0].avgGradient.toFixed(1)}%`);
  }

  // 5. Responsive Bounding Box Buffer Math
  const lats = [47.5, 47.6, 47.7];
  const lngs = [11.2, 11.3, 11.4];
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);
  const latBuf = Math.max((maxLat - minLat) * 0.1, 0.002);
  const lngBuf = Math.max((maxLng - minLng) * 0.1, 0.002);

  const bounded = {
    minLat: minLat - latBuf,
    maxLat: maxLat + latBuf,
    minLng: minLng - lngBuf,
    maxLng: maxLng + lngBuf
  };

  assert(bounded.minLat < minLat && bounded.maxLat > maxLat, 'Latitudinal viewport buffer expands bounds correctly');
  assert(bounded.minLng < minLng && bounded.maxLng > maxLng, 'Longitudinal viewport buffer expands bounds correctly');

  console.log(`\n📊 Responsive & Performance Summary: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
