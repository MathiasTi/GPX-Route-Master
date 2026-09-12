import { ok, err, isOk, isErr, mapOk } from '../domain/core/result';
import { calculateTrainingStressBalance, classifyFormCategory } from '../domain/training/trainingStress';
import { calculateMechanicalPower } from '../domain/physics/cyclingPhysics';
import { computeVirtualWindow } from '../domain/performance/virtualizer';

export function runCleanArchitectureDomainTests(): boolean {
  console.log('🏛️ Running Clean Architecture & Domain Engine Test Suite...');
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

  // --- 1. Core Result Pattern Tests ---
  console.log('  --- 1. Result Pattern & Type Guards ---');
  const successRes = ok({ value: 42 });
  assert(isOk(successRes) && successRes.data.value === 42, 'ok() returns success result');
  assert(!isErr(successRes), 'ok() is not an error');

  const errorRes = err(new Error('Test failure'));
  assert(isErr(errorRes) && errorRes.error.message === 'Test failure', 'err() returns error result');
  assert(!isOk(errorRes), 'err() is not a success');

  const mapped = mapOk(successRes, x => x.value * 2);
  assert(isOk(mapped) && mapped.data === 84, 'mapOk() transforms data correctly');

  // --- 2. Training Stress Engine (CTL/ATL/TSB) ---
  console.log('  --- 2. Training Load & Physiology Engine ---');
  const emptyRes = calculateTrainingStressBalance([]);
  assert(isOk(emptyRes) && emptyRes.data.length === 0, 'Empty TSS history returns empty array');

  const invalidTssRes = calculateTrainingStressBalance([{ date: '2026-01-01', tss: -10 }]);
  assert(isErr(invalidTssRes) && invalidTssRes.error.code === 'NEGATIVE_TSS', 'Rejects negative TSS');

  // 14 days of 100 TSS daily
  const daily100 = Array.from({ length: 14 }, (_, i) => ({
    date: `2026-01-${String(i + 1).padStart(2, '0')}`,
    tss: 100
  }));
  const loadRes = calculateTrainingStressBalance(daily100);
  assert(isOk(loadRes) && loadRes.data.length === 14, 'Computes 14 days of stress metrics');
  if (isOk(loadRes)) {
    const lastDay = loadRes.data[13];
    // ATL (7 days) should rise much faster than CTL (42 days)
    assert(lastDay.atl > lastDay.ctl, `Fatigue (ATL=${lastDay.atl}) exceeds Fitness (CTL=${lastDay.ctl}) during overload block`);
    assert(lastDay.tsb < 0, `TSB is negative during intense block (got ${lastDay.tsb})`);
    assert(lastDay.formCategory === 'fatigued' || lastDay.formCategory === 'overtrained', `Classified as fatigued/overtrained (got ${lastDay.formCategory})`);
  }

  assert(classifyFormCategory(15) === 'optimal', 'TSB +15 is classified as optimal (peak form)');
  assert(classifyFormCategory(30) === 'fresh', 'TSB +30 is classified as fresh');
  assert(classifyFormCategory(-35) === 'overtrained', 'TSB -35 is classified as overtrained');

  // --- 3. Cycling Physics & Power Breakdown ---
  console.log('  --- 3. Cycling Physics Mechanical Power Engine ---');
  const flatRide = calculateMechanicalPower({
    riderWeightKg: 75,
    bikeWeightKg: 8,
    speedKmh: 40,
    gradientPercent: 0
  });
  assert(isOk(flatRide), 'Calculates mechanical power on flat road');
  if (isOk(flatRide)) {
    assert(flatRide.data.gravityWatts === 0, 'Gravity watts is 0 on flat road');
    assert(flatRide.data.aeroWatts > flatRide.data.rollingWatts, 'Aerodynamic drag dominates at 40 km/h');
    assert(flatRide.data.totalWatts > 250 && flatRide.data.totalWatts < 450, `Realistic total power at 40 km/h (got ${flatRide.data.totalWatts}W)`);
  }

  const steepClimb = calculateMechanicalPower({
    riderWeightKg: 70,
    bikeWeightKg: 7,
    speedKmh: 12,
    gradientPercent: 10
  });
  assert(isOk(steepClimb), 'Calculates mechanical power on 10% steep climb');
  if (isOk(steepClimb)) {
    assert(steepClimb.data.gravityWatts > steepClimb.data.aeroWatts * 4, 'Gravity power accounts for majority of wattage on 10% climb');
    assert(steepClimb.data.totalWatts > 200 && steepClimb.data.totalWatts < 350, `Realistic climb power at 12 km/h on 10% (got ${steepClimb.data.totalWatts}W)`);
  }

  const invalidWeight = calculateMechanicalPower({
    riderWeightKg: -10,
    bikeWeightKg: 8,
    speedKmh: 20,
    gradientPercent: 0
  });
  assert(isErr(invalidWeight) && invalidWeight.error.code === 'INVALID_WEIGHT', 'Rejects negative rider weight');

  // --- 4. Virtualizer Windowing Engine ---
  console.log('  --- 4. Virtualizer Windowing Engine ---');
  const virtZero = computeVirtualWindow({
    totalItems: 0,
    itemHeight: 40,
    viewportHeight: 400,
    scrollTop: 0
  });
  assert(isOk(virtZero) && virtZero.data.totalHeightPx === 0 && virtZero.data.visibleCount === 0, 'Handles 0 items cleanly');

  const virt10k = computeVirtualWindow({
    totalItems: 10000,
    itemHeight: 40,
    viewportHeight: 400,
    scrollTop: 2000,
    overscan: 2
  });
  assert(isOk(virt10k), 'Computes window for 10,000 items');
  if (isOk(virt10k)) {
    assert(virt10k.data.totalHeightPx === 400000, 'Total virtual height is exactly 400,000 px');
    assert(virt10k.data.startIndex <= 50, `Start index reflects scrollTop with overscan (got ${virt10k.data.startIndex})`);
    assert(virt10k.data.endIndex >= 60, `End index covers viewport (got ${virt10k.data.endIndex})`);
    assert(virt10k.data.startOffsetPx === virt10k.data.startIndex * 40, 'Start offset aligns with startIndex * itemHeight');
  }

  const invalidVirt = computeVirtualWindow({
    totalItems: 100,
    itemHeight: -5,
    viewportHeight: 400,
    scrollTop: 0
  });
  assert(isErr(invalidVirt) && invalidVirt.error.code === 'INVALID_DIMENSIONS', 'Rejects negative itemHeight');

  console.log(`\nDomain Tests Completed: ${passed} passed, ${failed} failed.\n`);
  return failed === 0;
}
