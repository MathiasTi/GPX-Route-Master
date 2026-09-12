import { toValidTimestampMs, toValidDate, calculateTimeDeltaSec } from '../domain/telemetry/safeTime';

export function runSafeTimeTests(): boolean {
  console.log('⏱️ Running Safe Time & Timestamp Handling Tests...');
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

  // 1. Valid Date extraction
  const d = new Date('2024-05-10T10:00:00.000Z');
  assert(toValidTimestampMs(d) === d.getTime(), 'Extracts milliseconds from Date instance');

  // 2. ISO String extraction
  const iso = '2024-05-10T10:00:00.000Z';
  assert(toValidTimestampMs(iso) === Date.parse(iso), 'Extracts milliseconds from ISO string');

  // 3. Epoch number
  const epoch = 1715335200000;
  assert(toValidTimestampMs(epoch) === epoch, 'Extracts milliseconds from numeric timestamp');

  // 4. Invalid inputs
  assert(toValidTimestampMs(undefined) === undefined, 'Returns undefined for undefined');
  assert(toValidTimestampMs(null) === undefined, 'Returns undefined for null');
  assert(toValidTimestampMs('') === undefined, 'Returns undefined for empty string');
  assert(toValidTimestampMs('not-a-valid-date') === undefined, 'Returns undefined for malformed date string');
  assert(toValidTimestampMs(NaN) === undefined, 'Returns undefined for NaN');
  assert(toValidTimestampMs(new Date('invalid')) === undefined, 'Returns undefined for invalid Date instance');

  // 5. toValidDate
  const validD = toValidDate('2024-05-10T10:00:00.000Z');
  assert(validD instanceof Date && validD.toISOString() === '2024-05-10T10:00:00.000Z', 'Creates valid Date instance');
  assert(toValidDate('invalid-date') === undefined, 'Returns undefined for invalid string date');

  // 6. calculateTimeDeltaSec
  const tStart = '2024-05-10T10:00:00.000Z';
  const tEnd = new Date('2024-05-10T10:00:30.000Z');
  assert(calculateTimeDeltaSec(tEnd, tStart) === 30, 'Calculates time delta in seconds between mixed Date and ISO string');

  // 7. Negative delta
  assert(calculateTimeDeltaSec(tStart, tEnd) === undefined, 'Returns undefined for negative time delta');

  // 8. Gap limits
  const tEndFar = '2024-05-10T10:10:00.000Z'; // 600s
  assert(calculateTimeDeltaSec(tEndFar, tStart, 300) === undefined, 'Rejects gap exceeding maxAllowedGapSec');
  assert(calculateTimeDeltaSec(tEndFar, tStart, 1000) === 600, 'Accepts gap within maxAllowedGapSec');

  // 9. Identical timestamp
  assert(calculateTimeDeltaSec(tStart, tStart) === 0, 'Handles identical timestamps (0 delta) safely');

  return failed === 0;
}
