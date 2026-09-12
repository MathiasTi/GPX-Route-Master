import { 
  classifyHeartRate, 
  classifySlope, 
  calculateSlopeAtPoint, 
  computeHoverPointTelemetry,
  calculatePointDistanceKm 
} from '../domain/telemetry/pointMetricsEngine';
import { isOk, isErr } from '../domain/core/result';

export function runPointMetricsEngineTests(): boolean {
  console.log('💓 Running Point Metrics & Hover Telemetry Engine Tests...');
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

  // --- 1. Heart Rate Classification Tests ---
  const invalidBpmResult = classifyHeartRate(-5);
  assert(isErr(invalidBpmResult), 'Rejects negative heart rate with Result.err');

  const zeroBpmResult = classifyHeartRate(0);
  assert(isErr(zeroBpmResult), 'Rejects zero heart rate with Result.err');

  const extremeBpmResult = classifyHeartRate(300);
  assert(isErr(extremeBpmResult), 'Rejects physiological outlier (>260 bpm) with Result.err');

  // Max HR = 185
  // Z1: < 60% (< 111 bpm)
  const z1Result = classifyHeartRate(100, 185);
  assert(isOk(z1Result) && z1Result.data.zoneNumber === 1 && z1Result.data.label === 'Z1', 'Classifies 100 bpm as Z1');

  // Z2: 60-70% (111 - 129 bpm)
  const z2Result = classifyHeartRate(120, 185);
  assert(isOk(z2Result) && z2Result.data.zoneNumber === 2 && z2Result.data.label === 'Z2' && z2Result.data.colorHex === '#10b981', 'Classifies 120 bpm as Z2 GA1 (#10b981)');

  // Z3: 70-80% (130 - 147 bpm)
  const z3Result = classifyHeartRate(140, 185);
  assert(isOk(z3Result) && z3Result.data.zoneNumber === 3 && z3Result.data.label === 'Z3' && z3Result.data.colorHex === '#f59e0b', 'Classifies 140 bpm as Z3 GA2 (#f59e0b)');

  // Z4: 80-90% (148 - 166 bpm)
  const z4Result = classifyHeartRate(158, 185);
  assert(isOk(z4Result) && z4Result.data.zoneNumber === 4 && z4Result.data.label === 'Z4' && z4Result.data.colorHex === '#f97316', 'Classifies 158 bpm as Z4 Schwelle (#f97316)');

  // Z5: >= 90% (>= 167 bpm)
  const z5Result = classifyHeartRate(175, 185);
  assert(isOk(z5Result) && z5Result.data.zoneNumber === 5 && z5Result.data.label === 'Z5' && z5Result.data.colorHex === '#ef4444', 'Classifies 175 bpm as Z5 VO2max (#ef4444)');

  // Custom Max HR = 200: 175 bpm is 87.5% -> Z4
  const customMaxHrResult = classifyHeartRate(175, 200);
  assert(isOk(customMaxHrResult) && customMaxHrResult.data.zoneNumber === 4, 'Custom max HR (200) classifies 175 bpm as Z4 (87.5%)');

  // --- 2. Slope Classification Tests ---
  const flatSlope = classifySlope(0.8);
  assert(flatSlope.severity === 'flat' && flatSlope.label === 'Flach' && flatSlope.formatted === '+0.8%', 'Classifies +0.8% as Flach');

  const modSlope = classifySlope(5.2);
  assert(modSlope.severity === 'moderate' && modSlope.label === 'Mäßig' && modSlope.colorHex === '#f59e0b', 'Classifies +5.2% as Mäßig');

  const steepSlope = classifySlope(10.5);
  assert(steepSlope.severity === 'steep' && steepSlope.label === 'Steilanstieg' && steepSlope.colorHex === '#f43f5e', 'Classifies +10.5% as Steilanstieg');

  const extremeSlope = classifySlope(16.4);
  assert(extremeSlope.severity === 'extreme' && extremeSlope.label === 'Extrem-Rampe' && extremeSlope.colorHex === '#a855f7', 'Classifies +16.4% as Extrem-Rampe');

  const descentSlope = classifySlope(-5.0);
  assert(descentSlope.severity === 'descent' && descentSlope.label === 'Gefälle' && descentSlope.formatted === '-5.0%', 'Classifies -5.0% as Gefälle');

  const steepDescentSlope = classifySlope(-12.0);
  assert(steepDescentSlope.severity === 'steep_descent' && steepDescentSlope.label === 'Steilabfahrt', 'Classifies -12.0% as Steilabfahrt');

  // --- 3. calculateSlopeAtPoint Tests ---
  const directSlopeResult = calculateSlopeAtPoint({ lat: 47.1, lng: 11.2, slope: 8.5 });
  assert(directSlopeResult.severity === 'steep' && directSlopeResult.slopePercent === 8.5, 'Uses direct slope property when present');

  const testPoints = [
    { lat: 47.000, lng: 11.000, ele: 500 },
    { lat: 47.001, lng: 11.000, ele: 510 },
    { lat: 47.002, lng: 11.000, ele: 520 },
    { lat: 47.003, lng: 11.000, ele: 540 },
    { lat: 47.004, lng: 11.000, ele: 560 }
  ];
  const interpolatedSlope = calculateSlopeAtPoint(testPoints[2], testPoints);
  assert(interpolatedSlope.slopePercent > 0 && interpolatedSlope.severity !== 'flat', 'Interpolates positive slope from elevation delta');

  // --- 4. computeHoverPointTelemetry Tests ---
  const invalidTelemetry = computeHoverPointTelemetry({ lat: NaN, lng: 11.0 });
  assert(isErr(invalidTelemetry), 'Rejects invalid lat/lng with Result.err');

  const telemetryResult = computeHoverPointTelemetry(
    {
      lat: 47.123,
      lng: 11.456,
      ele: 850,
      hr: 155,
      power: 245,
      speed: 28.4,
      slope: 6.5,
      time: '2026-06-15T10:30:00Z'
    },
    [],
    { maxHr: 185 }
  );

  assert(isOk(telemetryResult), 'Computes complete telemetry snapshot successfully');
  if (isOk(telemetryResult)) {
    const t = telemetryResult.data;
    assert(t.elevationM === 850, 'Elevation correctly extracted (850m)');
    assert(t.slope.slopePercent === 6.5 && t.slope.severity === 'moderate', 'Slope correctly extracted (+6.5%)');
    assert(t.heartRate !== null && t.heartRate.zoneNumber === 4, 'Heart rate assigned to Z4');
    assert(t.powerWatts === 245, 'Power correctly rounded (245W)');
    assert(t.speedKmh === 28.4, 'Speed correctly formatted (28.4 km/h)');
    assert(t.timeFormatted !== null, 'Time formatted cleanly');
  }

  // Pure distance test
  const distKm = calculatePointDistanceKm({ lat: 47.0, lng: 11.0 }, { lat: 47.0, lng: 11.1 });
  assert(distKm > 7.0 && distKm < 8.0, 'Calculates distance accurately between coordinates (~7.6 km)');

  console.log(`Point Metrics Tests: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
