import { performLocalIntensiveAnalysis, calculateCumulativeDistances, formatSecondsToTime, formatSecondsToDigital, getClimbHexColor } from '../utils/intensiveAnalysis';
import { GPXTrack } from '../types';

export function runIntensiveAnalysisTests(): boolean {
  console.log('🧪 Running Intensive Analysis Test Suite...');
  let passed = 0;
  let failed = 0;

  const assert = (condition: boolean, msg: string) => {
    if (condition) {
      passed++;
      console.log(`  ✓ ${msg}`);
    } else {
      failed++;
      console.error(`  ✗ ${msg}`);
    }
  };

  // Mock Track: 20km with 500m ascent
  const mockPoints = [
    { lat: 47.5, lng: 11.0, ele: 500, time: new Date('2026-06-15T08:00:00.000Z') },
    { lat: 47.55, lng: 11.05, ele: 750, time: new Date('2026-06-15T08:30:00.000Z') },
    { lat: 47.6, lng: 11.1, ele: 1000, time: new Date('2026-06-15T09:00:00.000Z') },
    { lat: 47.65, lng: 11.15, ele: 800, time: new Date('2026-06-15T09:30:00.000Z') },
    { lat: 47.7, lng: 11.2, ele: 600, time: new Date('2026-06-15T10:00:00.000Z') }
  ];

  const mockTrack: GPXTrack = {
    id: 'test-track-1',
    name: 'Mountain Pass Test',
    points: mockPoints,
    distance: 25.5,
    ascent: 500,
    descent: 400,
    maxSlope: 12.5,
    color: '#3b82f6',
    visible: true,
    activityType: 'cycling'
  };

  // 1. Test Local Deterministic Analysis calculation
  const result = performLocalIntensiveAnalysis(mockTrack, {
    date: '2026-06-15',
    activityType: 'cycling',
    subType: 'road',
    fitnessLevel: 'moderate',
    userWeightKg: 75,
    targetFtp: 250
  });

  assert(result.totalDistanceKm > 0, `Total distance calculated properly (${result.totalDistanceKm} km)`);
  assert(result.totalAscentMeters >= 500, `Ascent preserved or computed (${result.totalAscentMeters} m)`);
  assert(result.estimatedMovingTimeSeconds > 0, `Estimated moving time computed (${result.estimatedMovingTimeSeconds} s)`);
  assert(result.totalCaloriesKcal > 100, `Calories computed realistic (${result.totalCaloriesKcal} kcal)`);
  assert(result.carbsBurnedGrams > 0, `Carbohydrates calculated (${result.carbsBurnedGrams} g)`);
  assert(result.totalFluidRecommendedLiters > 0, `Fluid recommendations computed (${result.totalFluidRecommendedLiters} L)`);
  assert(result.difficultyScore >= 1 && result.difficultyScore <= 10, `Difficulty score in 1-10 range (${result.difficultyScore})`);
  assert(result.tacticalTips.length > 0, `Tactical tips generated (${result.tacticalTips.length} tips)`);
  assert(result.splits.length > 0, `Stage splits generated (${result.splits.length} splits)`);
  assert(Array.isArray(result.climbs), `Climbs array returned in intensive analysis result (${result.climbs.length} climbs)`);
  assert(typeof result.totalClimbAscentMeters === 'number', `totalClimbAscentMeters is number (${result.totalClimbAscentMeters} m)`);
  assert(typeof result.totalClimbDistanceKm === 'number', `totalClimbDistanceKm is number (${result.totalClimbDistanceKm} km)`);
  if (result.climbs.length > 0) {
    const firstClimb = result.climbs[0];
    assert(firstClimb.vam > 0, `First climb has valid VAM (${firstClimb.vam} m/h)`);
    assert(firstClimb.categoryLabel.length > 0, `First climb has category label (${firstClimb.categoryLabel})`);
    assert(firstClimb.estimatedTimeSeconds > 0, `First climb has estimated time (${firstClimb.estimatedTimeSeconds} s)`);
    assert(typeof firstClimb.hexColor === 'string' && firstClimb.hexColor.startsWith('#'), `First climb has hexColor (${firstClimb.hexColor})`);
  }

  // 1.1 Test Climb Category Color helper
  assert(getClimbHexColor('HC') === '#9333ea', 'HC climb returns purple hex color');
  assert(getClimbHexColor('Kat 1') === '#e11d48', 'Kat 1 climb returns rose hex color');
  assert(getClimbHexColor('Kat 2') === '#f97316', 'Kat 2 climb returns orange hex color');
  assert(getClimbHexColor('Kat 3') === '#f59e0b', 'Kat 3 climb returns amber hex color');
  assert(getClimbHexColor('Kat 4') === '#3b82f6', 'Kat 4 climb returns blue hex color');

  // 2. Test Running mode
  const runResult = performLocalIntensiveAnalysis(mockTrack, {
    date: '2026-06-15',
    activityType: 'running',
    subType: 'trail',
    fitnessLevel: 'advanced',
    userWeightKg: 70
  });

  assert(runResult.activityType === 'running', 'Running activity type preserved');
  assert(runResult.totalCaloriesKcal > result.totalCaloriesKcal * 0.5, 'Running calorie calculation reasonable');

  // 3. Test Cumulative Distances helper
  const distances = calculateCumulativeDistances(mockPoints);
  assert(distances.length === mockPoints.length, 'Cumulative distances matching point count');
  assert(distances[0] === 0, 'First distance is 0');
  assert(distances[distances.length - 1] > 0, `Total cumulative distance > 0 (${distances[distances.length - 1]} km)`);

  // 4. Test Time Formatting
  assert(formatSecondsToTime(3665) === '1h 01m', `formatSecondsToTime correctly formatted ('${formatSecondsToTime(3665)}')`);
  assert(formatSecondsToDigital(3665) === '1:01:05', `formatSecondsToDigital correctly formatted ('${formatSecondsToDigital(3665)}')`);

  console.log(`\nIntensive Analysis Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
