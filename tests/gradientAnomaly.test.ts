import { GPXPoint, GPXTrack } from '../types';
import { 
  detectImpossibleGradientAnomalies, 
  repairGradientAnomalies, 
  repairTrackGradientAnomalies, 
  filterElevationProfile 
} from '../utils/gpxUtils';

export const runGradientAnomalyTests = (): boolean => {
  console.log('🧪 Running Impossible Gradient Anomaly & Repair Tests...');
  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      passed++;
      console.log(`  ✅ PASS: ${msg}`);
    } else {
      failed++;
      console.error(`  ❌ FAIL: ${msg}`);
    }
  };

  // Test 1: Normal smooth track without anomalies
  const normalPoints: GPXPoint[] = [
    { lat: 46.500, lng: 11.500, ele: 1000 },
    { lat: 46.501, lng: 11.500, ele: 1008 },
    { lat: 46.502, lng: 11.500, ele: 1015 },
    { lat: 46.503, lng: 11.500, ele: 1022 },
    { lat: 46.504, lng: 11.500, ele: 1030 },
  ];
  const normalAnomalies = detectImpossibleGradientAnomalies(normalPoints);
  assert(normalAnomalies.length === 0, 'Clean track returns 0 gradient anomalies');

  // Test 2: Severe elevation spike / vertical cliff (e.g. +80m over 20m)
  const cliffSpikePoints: GPXPoint[] = [
    { lat: 46.5000, lng: 11.500, ele: 1000 },
    { lat: 46.5002, lng: 11.500, ele: 1002 },
    { lat: 46.5004, lng: 11.500, ele: 1080 }, // +78m vertical jump in ~22m
    { lat: 46.5006, lng: 11.500, ele: 1082 },
  ];
  const cliffAnomalies = detectImpossibleGradientAnomalies(cliffSpikePoints);
  assert(cliffAnomalies.length >= 1, 'Detects severe vertical elevation jump/cliff');
  if (cliffAnomalies.length >= 1) {
    assert(cliffAnomalies[0].gradient > 40, `Calculates high anomaly gradient (${cliffAnomalies[0].gradient}%)`);
  }

  // Test 3: Needle summit spike (climb +40% then immediate drop -40% over short distance)
  const needleSummitPoints: GPXPoint[] = [
    { lat: 46.5000, lng: 11.500, ele: 2000 },
    { lat: 46.5005, lng: 11.500, ele: 2040 },
    { lat: 46.5010, lng: 11.500, ele: 2120 }, // Needle peak
    { lat: 46.5015, lng: 11.500, ele: 2040 },
    { lat: 46.5020, lng: 11.500, ele: 2000 },
  ];
  const needleAnomalies = detectImpossibleGradientAnomalies(needleSummitPoints);
  assert(needleAnomalies.length >= 1, 'Detects needle summit spike / bad culmination point');
  if (needleAnomalies.length >= 1) {
    assert(needleAnomalies[0].peakIndex === 2, 'Accurately identifies summit peak index');
  }

  // Test 4: Empty or single point
  assert(detectImpossibleGradientAnomalies([]).length === 0, 'Handles empty point list gracefully');
  assert(detectImpossibleGradientAnomalies([{ lat: 46.5, lng: 11.5, ele: 1000 }]).length === 0, 'Handles single point list gracefully');

  // Test 5: Repair Cliff Spike via repairGradientAnomalies
  const cliffResult = repairGradientAnomalies(cliffSpikePoints);
  const remainingCliffAnomalies = detectImpossibleGradientAnomalies(cliffResult.repairedPoints);
  assert(cliffResult.fixedCount >= 1, 'repairGradientAnomalies reports at least 1 fix');
  assert(remainingCliffAnomalies.length === 0, 'repairGradientAnomalies completely eliminates cliff anomaly');
  assert(cliffResult.repairedPoints[2].ele! < 1050 && cliffResult.repairedPoints[2].ele! > 1000, 'repairedCliff smoothly interpolates midpoint elevation');

  // Test 6: Repair Needle Summit via repairGradientAnomalies
  const needleResult = repairGradientAnomalies(needleSummitPoints);
  const remainingNeedleAnomalies = detectImpossibleGradientAnomalies(needleResult.repairedPoints);
  assert(needleResult.fixedCount >= 1, 'repairGradientAnomalies reports fixed needle count');
  assert(remainingNeedleAnomalies.length === 0, 'repairGradientAnomalies completely eliminates needle summit anomaly');
  assert(needleResult.repairedPoints[2].ele! < 2120, 'repairedNeedle attenuates artificial summit needle');

  // Test 7: repairTrackGradientAnomalies recalculates metrics
  const dummyTrack: GPXTrack = {
    id: 'test-track-1',
    name: 'Spiky Track',
    points: cliffSpikePoints,
    distance: 0.1,
    ascent: 82,
    descent: 0,
    color: '#3b82f6',
    visible: true,
    maxSlope: 350
  };
  const repairedTrack = repairTrackGradientAnomalies(dummyTrack, 250, 75, 20);
  assert(repairedTrack.ascent < dummyTrack.ascent, 'repairedTrack reduces exaggerated ascent metric');
  assert(repairedTrack.points.length === dummyTrack.points.length, 'repairedTrack preserves point count');
  assert(repairedTrack.maxSlope !== undefined && repairedTrack.maxSlope < dummyTrack.maxSlope!, 'repairedTrack reduces extreme maxSlope value');

  // Test 8: filterElevationProfile (Noise reduction with summit preservation)
  const noisyPoints: GPXPoint[] = [
    { lat: 46.500, lng: 11.500, ele: 500.2 },
    { lat: 46.501, lng: 11.500, ele: 499.7 },
    { lat: 46.502, lng: 11.500, ele: 500.4 },
    { lat: 46.503, lng: 11.500, ele: 499.9 },
    { lat: 46.504, lng: 11.500, ele: 500.3 },
    { lat: 46.505, lng: 11.500, ele: 550.0 }, // True summit peak
    { lat: 46.506, lng: 11.500, ele: 500.1 },
    { lat: 46.507, lng: 11.500, ele: 499.8 },
  ];
  const filteredLight = filterElevationProfile(noisyPoints, 'light');
  assert(filteredLight.length === noisyPoints.length, 'filterElevationProfile preserves point array length');
  assert(Math.abs(filteredLight[0].ele! - 500) < 1.0, 'filterElevationProfile smooths barometric jitter');
  assert(filteredLight[5].ele! > 540, 'filterElevationProfile preserves prominent true summit');

  const filteredOff = filterElevationProfile(noisyPoints, 'off');
  assert(filteredOff[0].ele === noisyPoints[0].ele, 'filterElevationProfile with "off" returns identical points');

  console.log(`\nGradient Anomaly & Repair Test Results: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
};
