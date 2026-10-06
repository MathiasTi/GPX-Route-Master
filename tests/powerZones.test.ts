import {
  calculateCyclingPowerZones,
  calculateRunningPowerZones,
  calculateRunningPaceZones,
  calculateActivityPowerDistribution,
  formatSecondsToPace
} from '../domain/training/powerZones';
import { isOk, isErr } from '../domain/core/result';

export function runPowerZonesTests(): boolean {
  console.log('⚡ Running Power Zones & Sport Modality Test Suite...');
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

  // 1. Cycling Coggan Model Tests
  console.log('  --- 1. Cycling Coggan 7-Zone Formula Tests ---');
  const ftp250 = calculateCyclingPowerZones(250);
  assert(isOk(ftp250), 'Successfully computes cycling power zones for 250W FTP');
  if (isOk(ftp250)) {
    const zones = ftp250.data;
    assert(zones.length === 7, 'Generates exactly 7 Coggan power zones');
    assert(zones[0].maxWatts === 138, 'Z1 Active Recovery upper bound is 138W (55% of 250W)');
    assert(zones[1].minWatts === 139 && zones[1].maxWatts === 188, 'Z2 Endurance is 139W–188W (56%–75% FTP)');
    assert(zones[2].minWatts === 189 && zones[2].maxWatts === 225, 'Z3 Tempo is 189W–225W (76%–90% FTP)');
    assert(zones[3].minWatts === 226 && zones[3].maxWatts === 263, 'Z4 Threshold is 226W–263W (91%–105% FTP)');
    assert(zones[4].minWatts === 264 && zones[4].maxWatts === 300, 'Z5 VO2max is 264W–300W (106%–120% FTP)');
    assert(zones[5].minWatts === 301 && zones[5].maxWatts === 375, 'Z6 Anaerobic is 301W–375W (121%–150% FTP)');
    assert(zones[6].minWatts === 376, 'Z7 Neuromuscular starts at 376W (>150% FTP)');
  }

  const invalidFtp = calculateCyclingPowerZones(-50);
  assert(isErr(invalidFtp) && invalidFtp.error.code === 'INVALID_FTP', 'Rejects negative FTP');

  // 2. Running Vance / Stryd Model Tests
  console.log('  --- 2. Running Power 5-Zone Formula Tests ---');
  const rFtp280 = calculateRunningPowerZones(280);
  assert(isOk(rFtp280), 'Successfully computes running power zones for 280W rFTPw');
  if (isOk(rFtp280)) {
    const zones = rFtp280.data;
    assert(zones.length === 5, 'Generates exactly 5 running power zones');
    assert(zones[0].maxWatts === 224, 'Running Z1 upper bound is 224W (80% of 280W, accounting for gravity support)');
    assert(zones[1].minWatts === 225 && zones[1].maxWatts === 249, 'Running Z2 Endurance is 225W–249W (81%–89% rFTPw)');
    assert(zones[2].minWatts === 250 && zones[2].maxWatts === 280, 'Running Z3 Threshold is 250W–280W (90%–100% rFTPw)');
    assert(zones[3].minWatts === 281 && zones[3].maxWatts === 322, 'Running Z4 Interval is 281W–322W (101%–115% rFTPw)');
    assert(zones[4].minWatts === 323, 'Running Z5 Sprint is >322W (>115% rFTPw)');
  }

  // 3. Running Pace Model Tests
  console.log('  --- 3. Running Pace Formula Tests ---');
  const paceZones = calculateRunningPaceZones(270); // 4:30 min/km
  assert(isOk(paceZones), 'Successfully computes pace zones for 4:30 min/km threshold');
  if (isOk(paceZones)) {
    const zones = paceZones.data;
    assert(zones.length === 5, 'Generates 5 running pace zones');
    assert(formatSecondsToPace(270) === '4:30/km', 'Formats 270 seconds correctly to 4:30/km');
    assert(zones[0].minPaceSecPerKm === 338, 'Z1 Recom pace is slower than 5:38/km (125% of 270s)');
    assert(zones[3].minPaceSecPerKm === 257 && zones[3].maxPaceSecPerKm === 284, 'Z4 Threshold pace is ~4:17 to ~4:44/km');
  }

  // 4. Activity Distribution Tests
  console.log('  --- 4. Dynamic Activity Distribution Analysis ---');
  const mockCyclingPoints = [
    { power: 120, speed: 7.5, time: new Date('2026-01-01T10:00:00Z') },
    { power: 180, speed: 8.0, time: new Date('2026-01-01T10:05:00Z') },
    { power: 240, speed: 8.5, time: new Date('2026-01-01T10:10:00Z') },
    { power: 280, speed: 9.0, time: new Date('2026-01-01T10:15:00Z') },
  ];

  const cyclingDist = calculateActivityPowerDistribution({
    points: mockCyclingPoints,
    activityType: 'cycling',
    cyclingFtpWatts: 250,
    trackDurationSec: 900
  });

  assert(isOk(cyclingDist), 'Successfully calculates cycling distribution');
  if (isOk(cyclingDist)) {
    assert(cyclingDist.data.activityType === 'cycling', 'Result flags activityType as cycling');
    assert(cyclingDist.data.zonesDistribution.length === 7, 'Outputs 7 Coggan distribution zones for cycling');
    assert(cyclingDist.data.modelName.includes('Coggan'), 'Identifies Andy Coggan model for cycling');
  }

  const mockRunningPoints = [
    { power: 210, speed: 3.2, time: new Date('2026-01-01T10:00:00Z') },
    { power: 235, speed: 3.5, time: new Date('2026-01-01T10:05:00Z') },
    { power: 270, speed: 3.8, time: new Date('2026-01-01T10:10:00Z') },
    { power: 310, speed: 4.2, time: new Date('2026-01-01T10:15:00Z') },
  ];

  const runningDist = calculateActivityPowerDistribution({
    points: mockRunningPoints,
    activityType: 'running',
    runningFtpWatts: 280,
    thresholdPaceSecPerKm: 270,
    trackDurationSec: 900
  });

  assert(isOk(runningDist), 'Successfully calculates running distribution');
  if (isOk(runningDist)) {
    assert(runningDist.data.activityType === 'running', 'Result flags activityType as running');
    assert(runningDist.data.zonesDistribution.length === 5, 'Outputs 5 Vance running distribution zones');
    assert(runningDist.data.modelName.includes('Vance'), 'Identifies Jim Vance / Stryd model for running');
  }

  console.log(`Power Zones Tests: ${passed} passed, ${failed} failed.`);
  return failed === 0;
}
