import { computeHoverPointTelemetry } from '../domain/telemetry/pointMetricsEngine';

export function runMobileTelemetryPillTests(): boolean {
  console.log('📱 Running Mobile Telemetry & Touch Interaction Tests...');
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

  // 1. Full point telemetry for mobile display
  const p1 = {
    lat: 47.4,
    lng: 11.2,
    ele: 1250,
    slope: 8.5,
    hr: 155,
    power: 260,
    speed: 18.5,
    dist: 14500
  };
  const res1 = computeHoverPointTelemetry(p1, undefined, { maxHr: 190 });
  assert(res1.success, 'Extracts complete telemetry for mobile point');
  if (res1.success) {
    assert(res1.data.elevationM === 1250, 'Extracts correct elevation (1250m)');
    assert(res1.data.slope.formatted === '+8.5%', 'Formats slope string with sign');
    assert(res1.data.slope.label === 'Steilanstieg', 'Labels slope severity correctly');
    assert(res1.data.heartRate?.bpm === 155, 'Extracts heart rate bpm');
    assert(res1.data.heartRate?.label === 'Z4', 'Classifies heart rate into threshold zone');
    assert(res1.data.powerWatts === 260, 'Extracts power wattage');
    assert(res1.data.speedKmh === 18.5, 'Extracts speed km/h');
  }

  // 2. Telemetry with sparse/minimal data
  const pSparse = {
    lat: 47.4,
    lng: 11.2,
    ele: 600
  };
  const resSparse = computeHoverPointTelemetry(pSparse);
  assert(resSparse.success, 'Handles sparse point without HR/Power/Speed gracefully');
  if (resSparse.success) {
    assert(resSparse.data.elevationM === 600, 'Elevation preserved');
    assert(resSparse.data.heartRate === null, 'Heart rate is null when not measured');
    assert(resSparse.data.powerWatts === null, 'Power is null when not measured');
    assert(resSparse.data.speedKmh === null, 'Speed is null when not measured');
  }

  // 3. Negative gradient on descent
  const pDescent = {
    lat: 47.4,
    lng: 11.2,
    ele: 900,
    slope: -7.2
  };
  const resDescent = computeHoverPointTelemetry(pDescent);
  assert(resDescent.success, 'Handles descent slope correctly');
  if (resDescent.success) {
    assert(resDescent.data.slope.formatted === '-7.2%', 'Formats negative slope');
    assert(resDescent.data.slope.arrow === '↘', 'Displays descent arrow (↘)');
  }

  return failed === 0;
}
