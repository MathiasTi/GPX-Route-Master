import assert from 'node:assert/strict';
import {
  calculateFtpFromFieldTest,
  estimateFtpFromActivities,
  type FtpActivityInput,
  type FtpActivityPoint,
} from '../utils/ftpEstimator';
import {
  computeKarvonenBpmRange,
  computeRunningPaceTargets,
  evaluateVitalsAndLoadGuard,
  generateAdaptiveTrainingPlan,
  type TrainingPlanInput,
  type TrainingVitalsSnapshot,
} from '../utils/trainingPlanEngine';

function buildPowerTrackPoints(startIso: string, durationSec: number, stepSec: number, watts: number, stepLatDeg = 0.0005): FtpActivityPoint[] {
  const startMs = new Date(startIso).getTime();
  const points: FtpActivityPoint[] = [];
  const count = Math.floor(durationSec / stepSec) + 1;
  for (let i = 0; i < count; i++) {
    points.push({
      lat: 47.0 + i * stepLatDeg,
      lng: 11.0,
      ele: 600 + i * 0.2,
      time: new Date(startMs + i * stepSec * 1000).toISOString(),
      power: watts,
      hr: 162,
    });
  }
  return points;
}

function buildClimbingTrackPoints(startIso: string, count: number, stepSec: number, stepLatDeg: number, eleGainPerStepM: number): FtpActivityPoint[] {
  const startMs = new Date(startIso).getTime();
  const points: FtpActivityPoint[] = [];
  for (let i = 0; i < count; i++) {
    points.push({
      lat: 47.1 + i * stepLatDeg,
      lng: 11.2,
      ele: 800 + i * eleGainPerStepM,
      time: new Date(startMs + i * stepSec * 1000).toISOString(),
      hr: 168,
    });
  }
  return points;
}

function makeVitals(overrides: Partial<TrainingVitalsSnapshot> = {}): TrainingVitalsSnapshot {
  return {
    readinessScore: 85,
    sleepHoursAvg7d: 7.8,
    sleepScoreAvg7d: 82,
    rhrLatest: 50,
    rhrBaseline: 50,
    rhr7dDelta: 0,
    stressAvg7d: 25,
    stepsAvg7d: 9000,
    ...overrides,
  };
}

function makePlanInput(overrides: {
  goal?: Partial<TrainingPlanInput['goal']>;
  athlete?: Partial<TrainingPlanInput['athlete']>;
  load?: Partial<TrainingPlanInput['load']>;
  history?: Partial<TrainingPlanInput['history']>;
  vitals?: TrainingVitalsSnapshot | null;
} = {}): TrainingPlanInput {
  return {
    goal: {
      name: 'Test Goal',
      type: 'granfondo',
      sport: 'cycling',
      distanceKm: 120,
      elevationM: 1800,
      planWeeks: 8,
      sessionsPerWeek: 4,
      useVitalsAdaptation: true,
      ...overrides.goal,
    },
    athlete: {
      ftp: 260,
      estimatedFtp: 260,
      weightKg: 74,
      bikeWeightKg: 8.5,
      age: 34,
      maxHr: 188,
      rhrBaseline: 52,
      ...overrides.athlete,
    },
    load: {
      ctl: 55,
      atl: 54,
      tsb: 1,
      acwr: 0.98,
      weeklyRampRate: 3,
      monotony: 1.2,
      strain: 350,
      polarizationClass: 'Polarisiert',
      z3GreyZonePct: 12,
      ...overrides.load,
    },
    history: {
      avgWeeklySessions: 4,
      avgWeeklyDistanceKm: 160,
      avgWeeklyDurationHrs: 6.5,
      avgWeeklyAscentM: 1800,
      longestSessionDistanceKm: 85,
      longestSessionDurationMin: 210,
      recentAvgCyclingSpeedKmh: 28,
      recentAvgRunningPaceSecKm: null,
      estimatedVdot: null,
      ...overrides.history,
    },
    vitals: overrides.vitals === undefined ? makeVitals() : overrides.vitals,
  };
}

export function runTrainingPlanAndFtpTests(): boolean {
  let passed = 0;
  let failed = 0;

  const check = (name: string, fn: () => void) => {
    try {
      fn();
      console.log(`  ✅ ${name}`);
      passed++;
    } catch (err) {
      console.error(`  ❌ ${name}:`, err);
      failed++;
    }
  };

  console.log('\n🧪 Running FTP Estimator & Adaptive Training Plan Tests...');

  check('calculateFtpFromFieldTest handles 20min, 8min, ramp, 60min and invalid inputs', () => {
    const r20 = calculateFtpFromFieldTest('20min', 300, 75);
    assert.ok(r20);
    assert.equal(r20.ftpWatts, 285);
    assert.equal(r20.factor, 0.95);
    assert.equal(r20.wkg, 3.8);

    const r8 = calculateFtpFromFieldTest('8min', 300, 75);
    assert.ok(r8);
    assert.equal(r8.ftpWatts, 270);

    const rRamp = calculateFtpFromFieldTest('ramp', 400, 80);
    assert.ok(rRamp);
    assert.equal(rRamp.ftpWatts, 300);

    const r60 = calculateFtpFromFieldTest('60min', 265, 70);
    assert.ok(r60);
    assert.equal(r60.ftpWatts, 265);

    assert.equal(calculateFtpFromFieldTest('20min', 0, 75), null);
    assert.equal(calculateFtpFromFieldTest('ramp', -10, 75), null);
  });

  check('estimateFtpFromActivities estimates high-confidence FTP from 20m power data', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const ride20: FtpActivityInput = {
      id: 'ride-20m',
      name: 'Threshold Test',
      type: 'cycling',
      date: '2026-06-10T08:00:00Z',
      distance: 15,
      duration: 1300,
      ascent: 120,
      hasPower: true,
      peaks: { 1200: 300 },
    };

    const report = estimateFtpFromActivities([ride20], {
      userWeightKg: 75,
      bikeWeightKg: 8.5,
      lookbackDays: 90,
      now,
    });

    assert.ok(report.recommendedFtp !== null);
    assert.equal(report.bestMethod?.method, 'mmp_20m');
    assert.equal(report.recommendedFtp, 285);
    assert.ok(report.confidence === 'high' || report.confidence === 'medium');
    assert.ok(report.candidates.some((c) => c.method === 'mmp_20m' && c.ftpWatts === 285));
  });

  check('estimateFtpFromActivities derives Critical Power when multi-duration MMP points exist', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const ride5: FtpActivityInput = {
      id: 'ride-5m-cp',
      name: '5m Max',
      type: 'cycling',
      date: '2026-06-11T08:00:00Z',
      distance: 4,
      duration: 360,
      ascent: 50,
      points: buildPowerTrackPoints('2026-06-11T08:00:00Z', 360, 10, 360),
    };
    const ride20: FtpActivityInput = {
      id: 'ride-20m-cp',
      name: '20m Max',
      type: 'cycling',
      date: '2026-06-12T08:00:00Z',
      distance: 15,
      duration: 1260,
      ascent: 120,
      points: buildPowerTrackPoints('2026-06-12T08:00:00Z', 1260, 15, 300),
    };

    const report = estimateFtpFromActivities([ride5, ride20], {
      userWeightKg: 75,
      bikeWeightKg: 8.5,
      lookbackDays: 90,
      now,
    });

    assert.ok(report.candidates.some((c) => c.method === 'critical_power'));
    assert.ok(report.candidates.some((c) => c.method === 'mmp_20m' && c.ftpWatts === 285));
    assert.equal(report.confidence, 'high');
  });

  check('estimateFtpFromActivities prioritizes 60m effort when available', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const ride60: FtpActivityInput = {
      id: 'ride-60m',
      name: '1h TT',
      type: 'road_biking',
      date: '2026-06-12T08:00:00Z',
      distance: 40,
      duration: 3650,
      ascent: 200,
      points: buildPowerTrackPoints('2026-06-12T08:00:00Z', 3650, 30, 275),
    };
    const ride5: FtpActivityInput = {
      id: 'ride-5m',
      name: 'VO2max Effort',
      type: 'cycling',
      date: '2026-06-11T08:00:00Z',
      distance: 4,
      duration: 360,
      ascent: 50,
      points: buildPowerTrackPoints('2026-06-11T08:00:00Z', 360, 10, 340),
    };

    const report = estimateFtpFromActivities([ride60, ride5], {
      userWeightKg: 72,
      bikeWeightKg: 8,
      lookbackDays: 90,
      now,
    });

    assert.ok(report.recommendedFtp !== null);
    assert.equal(report.bestMethod?.method, 'mmp_60m');
    assert.equal(report.recommendedFtp, 275);
    assert.equal(report.confidence, 'high');
  });

  check('estimateFtpFromActivities falls back to climbing physics and scales with user weight', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    // 30 points * 30s = 870s (>= 600s), 0.0018 deg lat ~= 0.20 km/step (<= 0.5 km), 15m/step = 435m (>= 250m), ~7.5% grade
    const climb: FtpActivityInput = {
      id: 'climb-no-pm',
      name: 'Alpine Pass',
      type: 'cycling',
      date: '2026-06-11T09:00:00Z',
      distance: 6,
      duration: 900,
      ascent: 435,
      points: buildClimbingTrackPoints('2026-06-11T09:00:00Z', 30, 30, 0.0018, 15),
    };

    const lightReport = estimateFtpFromActivities([climb], {
      userWeightKg: 65,
      bikeWeightKg: 8.5,
      lookbackDays: 90,
      now,
    });
    const heavyReport = estimateFtpFromActivities([climb], {
      userWeightKg: 85,
      bikeWeightKg: 8.5,
      lookbackDays: 90,
      now,
    });

    assert.ok(lightReport.recommendedFtp !== null && heavyReport.recommendedFtp !== null);
    assert.equal(lightReport.bestMethod?.method, 'climbing_physics');
    assert.equal(heavyReport.bestMethod?.method, 'climbing_physics');
    assert.ok(lightReport.confidence === 'low' || lightReport.confidence === 'medium');
    assert.ok(heavyReport.recommendedFtp > lightReport.recommendedFtp);
  });

  check('estimateFtpFromActivities returns none for running-only or empty activities', () => {
    const now = new Date('2026-06-15T12:00:00Z');
    const runOnly: FtpActivityInput = {
      id: 'run-1',
      name: 'Morning Run',
      type: 'running',
      date: '2026-06-12T07:00:00Z',
      distance: 10,
      duration: 2700,
      ascent: 60,
      points: buildPowerTrackPoints('2026-06-12T07:00:00Z', 2700, 30, 320),
    };

    assert.equal(estimateFtpFromActivities([], { now }).recommendedFtp, null);
    assert.equal(estimateFtpFromActivities([], { now }).confidence, 'none');
    assert.equal(estimateFtpFromActivities([runOnly], { now }).recommendedFtp, null);
    assert.equal(estimateFtpFromActivities([runOnly], { now }).confidence, 'none');
  });

  check('computeKarvonenBpmRange and computeRunningPaceTargets compute physiological targets', () => {
    const hrr = computeKarvonenBpmRange(0.7, 0.8, 190, 50);
    // 50 + (190-50)*0.7 = 148, 50 + 140*0.8 = 162
    assert.equal(hrr.lowBpm, 148);
    assert.equal(hrr.highBpm, 162);
    assert.equal(hrr.usesKarvonen, true);

    const fastTargets = computeRunningPaceTargets(55, null);
    const slowTargets = computeRunningPaceTargets(40, null);
    assert.ok(fastTargets.thresholdSecKm < slowTargets.thresholdSecKm);
    assert.ok(fastTargets.intervalSecKm < slowTargets.intervalSecKm);
    assert.ok(fastTargets.easySecKm > fastTargets.thresholdSecKm);
  });

  check('Vitals & Load Guard triggers recovery modulation on poor vitals or high ACWR/deep TSB', () => {
    const poorVitalsInput = makePlanInput({
      goal: { useVitalsAdaptation: true },
      load: { ctl: 55, atl: 58, tsb: -3, acwr: 1.05, monotony: 1.2 },
      vitals: makeVitals({
        readinessScore: 48,
        sleepHoursAvg7d: 5.5,
        rhr7dDelta: 4.5,
        stressAvg7d: 62,
      }),
    });

    const recoveryPlan = generateAdaptiveTrainingPlan(poorVitalsInput);
    const unadaptedPlan = generateAdaptiveTrainingPlan(
      makePlanInput({
        goal: { useVitalsAdaptation: false },
        load: poorVitalsInput.load,
        vitals: poorVitalsInput.vitals,
      })
    );

    assert.equal(recoveryPlan.vitalsModulation.status, 'recovery');
    assert.equal(recoveryPlan.vitalsModulation.appliedMultiplier, 0.75);
    assert.equal(recoveryPlan.vitalsModulation.intensityCap, 'aerobic');
    assert.ok(recoveryPlan.weeks[0].targetTss < unadaptedPlan.weeks[0].targetTss);
    assert.equal(recoveryPlan.weeks[0].workouts[0].category, 'recovery');

    // Load guard alone triggers even when vitals is null
    const highAcwrGuard = evaluateVitalsAndLoadGuard(
      null,
      { ctl: 50, atl: 80, tsb: -30, acwr: 1.55, monotony: 1.3 },
      true
    );
    assert.equal(highAcwrGuard.status, 'recovery');
    assert.equal(highAcwrGuard.appliedMultiplier, 0.75);
  });

  check('Masters age (>=45) uses 2:1 deload schedule and lower CTL ramp', () => {
    const mastersPlan = generateAdaptiveTrainingPlan(
      makePlanInput({
        athlete: { age: 52, maxHr: 185, rhrBaseline: 50 },
        vitals: makeVitals({ readinessScore: 85, sleepHoursAvg7d: 7.8, rhr7dDelta: -0.5, stressAvg7d: 25 }),
      })
    );
    const youngerPlan = generateAdaptiveTrainingPlan(
      makePlanInput({
        athlete: { age: 30, maxHr: 185, rhrBaseline: 50 },
        vitals: makeVitals({ readinessScore: 85, sleepHoursAvg7d: 7.8, rhr7dDelta: -0.5, stressAvg7d: 25 }),
      })
    );

    assert.equal(mastersPlan.assessment.deloadRatioLabel, '2:1 (Masters)');
    assert.equal(mastersPlan.assessment.safeWeeklyCtlRamp, 4);
    assert.equal(mastersPlan.weeks[2].isDeload, true); // Week 3
    assert.equal(mastersPlan.weeks[5].isDeload, true); // Week 6

    assert.equal(youngerPlan.assessment.safeWeeklyCtlRamp, 5);
    assert.equal(youngerPlan.weeks[3].isDeload, true); // Week 4
    assert.equal(youngerPlan.weeks[2].isDeload, false);
  });

  check('Hilly cycling goal with 5 sessions schedules 5 days and includes climbing workout', () => {
    const plan = generateAdaptiveTrainingPlan(
      makePlanInput({
        goal: {
          type: 'granfondo',
          sport: 'cycling',
          distanceKm: 135,
          elevationM: 2400,
          planWeeks: 8,
          sessionsPerWeek: 5,
          useVitalsAdaptation: true,
        },
        athlete: { ftp: 270, weightKg: 72, maxHr: 186, rhrBaseline: 48, age: 33 },
        vitals: makeVitals({ readinessScore: 88, sleepHoursAvg7d: 8.0, rhr7dDelta: 0, stressAvg7d: 22 }),
        load: { ctl: 62, atl: 58, tsb: 4, acwr: 0.94, monotony: 1.1 },
      })
    );

    assert.equal(plan.weeks[0].workouts.length, 5);
    assert.deepEqual(
      plan.weeks[0].workouts.map((w) => w.dayLabel),
      ['Di', 'Mi', 'Fr', 'Sa', 'So']
    );
    assert.ok(plan.weeks[0].workouts.some((w) => w.category === 'climbing'));

    // Every step HR range stays within [rhrBaseline, maxHr]
    for (const week of plan.weeks) {
      for (const workout of week.workouts) {
        for (const step of workout.steps) {
          if (step.targetHrBpmRange) {
            assert.ok(step.targetHrBpmRange[0] >= 48);
            assert.ok(step.targetHrBpmRange[1] <= 186);
            assert.ok(step.targetHrBpmRange[0] <= step.targetHrBpmRange[1]);
          }
        }
      }
    }
  });

  console.log(`📊 FTP & Training Plan tests: ${passed} passed, ${failed} failed.`);
  return failed === 0;
}
