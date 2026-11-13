import { GPXPoint, GPXTrack } from '../types';
import { 
  detectImpossibleGradientAnomalies, 
  repairGradientAnomalies, 
  repairTrackGradientAnomalies, 
  filterElevationProfile,
  autoFixTrackValidation,
  analyzeTrackValidation
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

  // Test 9: Multi-point (>4 points) barometric step cliff does NOT shift cliff to eIdx + 1
  const multiPointCliff: GPXPoint[] = [
    { lat: 46.5000, lng: 11.500, ele: 1000 },
    { lat: 46.5002, lng: 11.500, ele: 1002 },
    { lat: 46.5004, lng: 11.500, ele: 1080 }, // +78m step cliff
    { lat: 46.5006, lng: 11.500, ele: 1082 },
    { lat: 46.5008, lng: 11.500, ele: 1084 },
    { lat: 46.5010, lng: 11.500, ele: 1085 },
    { lat: 46.5012, lng: 11.500, ele: 1086 },
    { lat: 46.5014, lng: 11.500, ele: 1088 },
  ];
  const multiCliffRepaired = repairGradientAnomalies(multiPointCliff);
  assert(
    detectImpossibleGradientAnomalies(multiCliffRepaired.repairedPoints).length === 0,
    'Multi-point (>4 pts) cliff repair leaves 0 residual gradient anomalies'
  );

  // Test 10: Dense 1Hz GPS points (<15m spacing) with negative abyss spike & 3-point plateau glitch
  const dense1HzPoints: GPXPoint[] = [];
  for (let i = 0; i < 30; i++) {
    let ele = 500 + i * 0.5;
    if (i === 8) ele = 420; // Negative abyss drop (-84m)
    if (i >= 18 && i <= 20) ele = 610; // 3-point plateau spike (+100m)
    dense1HzPoints.push({
      lat: 46.5000 + i * 0.00005, // ~5.5m per step (< 15m)
      lng: 11.5000,
      ele
    });
  }
  const denseAnomaliesBefore = detectImpossibleGradientAnomalies(dense1HzPoints);
  assert(denseAnomaliesBefore.length >= 2, 'Detects negative abyss drop and plateau spike on dense 1Hz track');
  const denseRepaired = repairGradientAnomalies(dense1HzPoints);
  assert(
    detectImpossibleGradientAnomalies(denseRepaired.repairedPoints).length === 0,
    'Dense 1Hz track has 0 remaining anomalies after repairGradientAnomalies'
  );

  // Test 11: autoFixTrackValidation also repairs vertical cliff / gradient anomalies
  const cliffTrackForValidation: GPXTrack = {
    id: 'val-cliff-track',
    name: 'Validation Cliff Track',
    points: dense1HzPoints,
    distance: 0.2,
    ascent: 200,
    descent: 200,
    color: '#ef4444',
    visible: true,
    maxSlope: 180
  };
  const autoFixedTrack = autoFixTrackValidation(cliffTrackForValidation);
  assert(
    detectImpossibleGradientAnomalies(autoFixedTrack.points).length === 0,
    'autoFixTrackValidation eliminates all gradient anomalies'
  );
  assert(
    analyzeTrackValidation(autoFixedTrack).status === 'clean',
    'autoFixTrackValidation produces clean validation status'
  );

  console.log(`\nGradient Anomaly & Repair Test Results: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
};
