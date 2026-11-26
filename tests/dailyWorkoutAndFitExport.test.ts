import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { fit2json, parseRecords } = require('fit-decoder');
import {
  suggestDailyWorkout,
  getWorkoutStepVisuals,
  type DailyWorkoutInput,
  type DailyActivitySummary,
} from '../utils/dailyWorkoutEngine';
import {
  encodeWorkoutToFit,
  encodeWorkoutToTcx,
  encodeWorkoutToZwo,
} from '../utils/garminWorkoutExporter';
import type { PlannedWorkout } from '../utils/trainingPlanEngine';

function makeBaseDailyInput(overrides: {
  requestedSport?: DailyWorkoutInput['requestedSport'];
  timeBudgetMin?: DailyWorkoutInput['timeBudgetMin'];
  userFeel?: DailyWorkoutInput['userFeel'];
  useVitalsAdaptation?: boolean;
  goal?: Partial<DailyWorkoutInput['goal']>;
  athlete?: Partial<DailyWorkoutInput['athlete']>;
  load?: Partial<DailyWorkoutInput['load']>;
  recentActivities?: DailyActivitySummary[];
  vitals?: DailyWorkoutInput['vitals'];
  now?: Date;
} = {}): DailyWorkoutInput {
  return {
    now: overrides.now ?? new Date('2026-06-15T09:00:00Z'),
    requestedSport: overrides.requestedSport ?? 'auto',
    timeBudgetMin: overrides.timeBudgetMin ?? 'auto',
    userFeel: overrides.userFeel ?? 'auto',
    useVitalsAdaptation: overrides.useVitalsAdaptation ?? true,
    goal: {
      sport: 'cycling',
      distanceKm: 120,
      elevationM: 1800,
      phase: 'Build',
      isHillyGoal: true,
      ...overrides.goal,
    },
    athlete: {
      ftp: 270,
      estimatedFtp: 270,
      weightKg: 74,
      age: 34,
      maxHr: 188,
      rhrBaseline: 50,
      estimatedVdot: 52,
      recentAvgRunningPaceSecKm: 285,
      ...overrides.athlete,
    },
    load: {
      ctl: 58,
      atl: 54,
      tsb: 4,
      acwr: 0.95,
      monotony: 1.2,
      z3GreyZonePct: 14,
      ...overrides.load,
    },
    recentActivities: overrides.recentActivities ?? [
      {
        date: '2026-06-11T08:00:00Z',
        type: 'cycling',
        name: 'Sweet Spot',
        distance: 55,
        duration: 4500,
        tss: 92,
        avg_hr: 158,
      },
      {
        date: '2026-06-13T08:00:00Z',
        type: 'cycling',
        name: 'Locker GA1',
        distance: 45,
        duration: 4800,
        tss: 52,
        avg_hr: 132,
      },
    ],
    vitals:
      overrides.vitals === undefined
        ? {
            readinessScore: 86,
            sleepHoursAvg7d: 7.9,
            sleepScoreAvg7d: 84,
            sleepHoursLatest: 8.1,
            sleepScoreLatest: 86,
            rhrLatest: 49,
            rhrBaseline: 50,
            rhr7dDelta: -0.5,
            rhrTodayDelta: -1.0,
            stressAvg7d: 24,
            stressLatest: 22,
            stepsAvg7d: 9200,
          }
        : overrides.vitals,
  };
}

function decodeFitBuffer(bytes: Uint8Array) {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const raw = fit2json(ab);
  return parseRecords(raw);
}

export function runDailyWorkoutAndFitExportTests(): boolean {
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

  console.log('\n🧪 Running Daily Suggested Workout & Garmin FIT Export Tests...');

  check('Acute bad sleep night or acute RHR spike enforces rest recovery level', () => {
    const badSleep = suggestDailyWorkout(
      makeBaseDailyInput({
        vitals: {
          readinessScore: 76,
          sleepHoursAvg7d: 7.5,
          sleepScoreAvg7d: 78,
          sleepHoursLatest: 4.8,
          sleepScoreLatest: 48,
          rhrLatest: 50,
          rhrBaseline: 50,
          rhr7dDelta: 0,
          rhrTodayDelta: 0,
          stressAvg7d: 30,
          stressLatest: 32,
          stepsAvg7d: 8000,
        },
      })
    );
    assert.equal(badSleep.intensityLevel, 'rest');
    assert.ok(badSleep.rpeRange[1] <= 2);
    assert.ok(badSleep.targetIf <= 0.58);

    const rhrSpike = suggestDailyWorkout(
      makeBaseDailyInput({
        vitals: {
          readinessScore: 75,
          sleepHoursAvg7d: 7.8,
          sleepScoreAvg7d: 80,
          sleepHoursLatest: 7.6,
          sleepScoreLatest: 80,
          rhrLatest: 55,
          rhrBaseline: 50,
          rhr7dDelta: 0.8,
          rhrTodayDelta: 5.0,
          stressAvg7d: 25,
          stressLatest: 25,
          stepsAvg7d: 8500,
        },
      })
    );
    assert.equal(rhrSpike.intensityLevel, 'rest');
  });

  check('Hard session < 24h ago blocks back-to-back threshold/VO2max intervals', () => {
    const now = new Date('2026-06-15T09:00:00Z');
    const rec = suggestDailyWorkout(
      makeBaseDailyInput({
        now,
        recentActivities: [
          {
            date: '2026-06-14T16:00:00Z', // 17h ago
            type: 'cycling',
            name: 'Hard Crit Intervals',
            distance: 62,
            duration: 5400,
            tss: 112,
            avg_hr: 170,
          },
        ],
      })
    );
    assert.ok(rec.recentSummary.hoursSinceLastHardSession !== null && rec.recentSummary.hoursSinceLastHardSession < 24);
    assert.ok(rec.intensityLevel === 'easy' || rec.intensityLevel === 'rest');
    assert.ok(rec.primaryWorkout.category === 'recovery');
  });

  check('Fresh well-rested athlete unlocks threshold or vo2max with high readiness & alternatives', () => {
    const rec = suggestDailyWorkout(makeBaseDailyInput());
    assert.ok(rec.dailyReadinessScore >= 80);
    assert.ok(rec.intensityLevel === 'threshold' || rec.intensityLevel === 'vo2max');
    assert.ok(rec.targetIf >= 0.84);
    assert.ok(rec.rpeRange[0] >= 6);
    assert.ok(rec.estimatedRecoveryHours >= 24);
    assert.ok(rec.alternatives.length >= 2);
    const visuals = getWorkoutStepVisuals(rec.primaryWorkout, rec.resolvedSport, 270, 188, 50);
    assert.ok(visuals.length >= 3);
  });

  check('Time budget scaling honors 30m and 90m requests and feel tired downgrades intensity', () => {
    const shortPlan = suggestDailyWorkout(makeBaseDailyInput({ timeBudgetMin: 30 }));
    const longPlan = suggestDailyWorkout(makeBaseDailyInput({ timeBudgetMin: 90 }));
    assert.ok(shortPlan.primaryWorkout.estimatedDurationMin <= 36);
    assert.ok(longPlan.primaryWorkout.estimatedDurationMin >= 82);

    const tiredPlan = suggestDailyWorkout(makeBaseDailyInput({ userFeel: 'tired' }));
    assert.ok(tiredPlan.intensityLevel === 'easy' || tiredPlan.intensityLevel === 'rest');
  });

  check('Auto sport triggers cycling cross-training after heavy recent running load', () => {
    const now = new Date('2026-06-15T09:00:00Z');
    const rec = suggestDailyWorkout(
      makeBaseDailyInput({
        now,
        requestedSport: 'auto',
        goal: { sport: 'running', distanceKm: 42.2, elevationM: 250, isHillyGoal: false },
        recentActivities: [
          {
            date: '2026-06-14T11:00:00Z', // hard run 22h ago
            type: 'running',
            name: 'Hard 15K Tempo',
            distance: 15,
            duration: 3900,
            tss: 98,
            avg_hr: 170,
          },
          {
            date: '2026-06-13T08:00:00Z',
            type: 'running',
            name: 'Easy Run',
            distance: 10,
            duration: 3200,
            tss: 55,
            avg_hr: 145,
          },
          {
            date: '2026-06-12T08:00:00Z',
            type: 'cycling',
            name: 'Cross Spin',
            distance: 40,
            duration: 4500,
            tss: 48,
            avg_hr: 128,
          },
        ],
      })
    );
    assert.equal(rec.resolvedSport, 'cycling');
  });

  check('FIT binary round-trip via fit-decoder encodes cycling power workout with repeat_steps', () => {
    const workout: PlannedWorkout = {
      dayLabel: 'Heute',
      title: 'VO2max Power 4x4m',
      category: 'intensity',
      description: 'Test FIT cycling power workout',
      rationale: 'Test',
      tss: 74,
      estimatedDurationMin: 50,
      steps: [
        { name: 'Warm-up', durationMinutes: 10, targetFtpPercent: 58, targetWattsRange: [145, 165], targetHrBpmRange: [120, 136] },
        {
          name: 'VO2max',
          durationMinutes: 4,
          reps: 4,
          restDurationMinutes: 3,
          targetFtpPercent: 114,
          targetWattsRange: [290, 320],
          targetHrBpmRange: [168, 180],
        },
        { name: 'Cool-down', durationMinutes: 10, targetFtpPercent: 50, targetWattsRange: [125, 145], targetHrBpmRange: [110, 128] },
      ],
    };

    const fitBytes = encodeWorkoutToFit(workout, {
      sport: 'cycling',
      targetMode: 'power',
      ftp: 270,
      maxHr: 188,
      rhr: 50,
    });

    const decoded = decodeFitBuffer(fitBytes);
    const fileId = decoded.records.find((r: any) => r.type === 'file_id');
    const workoutRec = decoded.records.find((r: any) => r.type === 'workout');
    const steps = decoded.records.filter((r: any) => r.type === 'workout_step');

    assert.ok(fileId && (fileId.data.type === 5 || fileId.data.type === 'workout'));
    assert.ok(workoutRec && (workoutRec.data.sport === 'cycling' || workoutRec.data.sport === 2));
    assert.equal(workoutRec.data.wkt_name, 'VO2max Power 4x4m');
    assert.equal(workoutRec.data.num_valid_steps, steps.length);

    const workIntervalStep = steps.find((s: any) => s.data.wkt_step_name === 'VO2max');
    assert.ok(workIntervalStep);
    assert.ok(workIntervalStep.data.target_type === 4 || workIntervalStep.data.target_type === 'power');
    assert.equal(workIntervalStep.data.custom_target_value_low, 1290); // 290W + 1000
    assert.equal(workIntervalStep.data.custom_target_value_high, 1320); // 320W + 1000

    const repeatStep = steps.find(
      (s: any) => s.data.duration_type === 6 || s.data.duration_type === 'repeat_until_steps_cmplt'
    );
    assert.ok(repeatStep);
    assert.equal(repeatStep.data.target_value, 4);
    assert.equal(repeatStep.data.duration_value, 1); // points back to workIntervalStep index
    assert.equal(repeatStep.data.target_type, 0xff);
    assert.equal(repeatStep.data.intensity, 0xff);
  });

  check('Alternatives expose zoneBadge/tone/recoveryHours and DESC 60-item history sees index 0 recent hard session', () => {
    const now = new Date('2026-06-15T09:00:00Z');
    const fresh = suggestDailyWorkout(makeBaseDailyInput({ now }));
    assert.ok(fresh.alternatives.length >= 2);
    for (const alt of fresh.alternatives) {
      assert.ok(alt.zoneBadge.length > 0);
      assert.ok(alt.tone.length > 0);
      assert.ok(alt.estimatedRecoveryHours >= 6);
    }

    // Simulated DB DESC order (newest at index 0, older 59 sessions afterwards)
    const descActs: DailyActivitySummary[] = [
      {
        date: '2026-06-14T18:00:00Z',
        type: 'cycling',
        name: 'Hard Race',
        distance: 80,
        duration: 6000,
        tss: 130,
        avg_hr: 172,
      },
      ...Array.from({ length: 59 }, (_, i) => ({
        date: new Date(now.getTime() - (i + 5) * 86400 * 1000).toISOString(),
        type: 'cycling',
        name: `Old Spin ${i}`,
        distance: 30,
        duration: 3600,
        tss: 40,
        avg_hr: 130,
      })),
    ];
    const slicedNewest40 = [...descActs]
      .sort((a, b) => String(b.date || '').localeCompare(String(a.date || '')))
      .slice(0, 40);
    const rec = suggestDailyWorkout(makeBaseDailyInput({ now, recentActivities: slicedNewest40 }));
    assert.ok(rec.recentSummary.hoursSinceLastHardSession !== null && rec.recentSummary.hoursSinceLastHardSession < 24);
    assert.ok(rec.intensityLevel === 'easy' || rec.intensityLevel === 'rest');
  });

  check('FIT binary round-trip encodes running pace (mm/s) and HR (+100) targets accurately', () => {
    const runWorkout: PlannedWorkout = {
      dayLabel: 'Heute',
      title: 'Schwelle 3x8m',
      category: 'threshold',
      description: 'Run pace test',
      rationale: 'VDOT',
      tss: 68,
      estimatedDurationMin: 48,
      steps: [
        { name: 'Einlaufen', durationMinutes: 10, targetHrBpmRange: [122, 138], targetPaceRangeSecKm: [330, 355] },
        { name: 'Schwelle', durationMinutes: 8, reps: 3, restDurationMinutes: 2, targetHrBpmRange: [158, 172], targetPaceRangeSecKm: [250, 265] },
      ],
    };

    const paceFit = decodeFitBuffer(encodeWorkoutToFit(runWorkout, { sport: 'running', targetMode: 'pace', maxHr: 188, rhr: 50 }));
    const paceWkt = paceFit.records.find((r: any) => r.type === 'workout');
    const paceSteps = paceFit.records.filter((r: any) => r.type === 'workout_step');
    assert.ok(paceWkt.data.sport === 'running' || paceWkt.data.sport === 1);
    const thrStep = paceSteps.find((s: any) => s.data.wkt_step_name === 'Schwelle');
    assert.ok(thrStep);
    assert.ok(thrStep.data.target_type === 0 || thrStep.data.target_type === 'speed');
    assert.ok(thrStep.data.custom_target_value_low < thrStep.data.custom_target_value_high);

    const hrFit = decodeFitBuffer(encodeWorkoutToFit(runWorkout, { sport: 'running', targetMode: 'hr', maxHr: 188, rhr: 50 }));
    const hrSteps = hrFit.records.filter((r: any) => r.type === 'workout_step');
    const hrThr = hrSteps.find((s: any) => s.data.wkt_step_name === 'Schwelle');
    assert.ok(hrThr.data.target_type === 1 || hrThr.data.target_type === 'heart_rate');
    assert.equal(hrThr.data.custom_target_value_low, 258); // 158 + 100
    assert.equal(hrThr.data.custom_target_value_high, 272); // 172 + 100
  });

  check('TCX and ZWO exporters generate valid escaped XML with expected workout nodes', () => {
    const workout: PlannedWorkout = {
      dayLabel: 'Heute',
      title: 'Sweet & Spot <Build>',
      category: 'threshold',
      description: 'Test <deg> & watts',
      rationale: 'Build',
      tss: 70,
      estimatedDurationMin: 50,
      steps: [
        { name: 'Warm-up', durationMinutes: 10, targetFtpPercent: 55, targetWattsRange: [130, 150] },
        { name: 'SST Block', durationMinutes: 10, reps: 2, restDurationMinutes: 4, targetFtpPercent: 90, targetWattsRange: [220, 240] },
        { name: 'Cool-down', durationMinutes: 10, targetFtpPercent: 50, targetWattsRange: [115, 135] },
      ],
    };

    const tcx = encodeWorkoutToTcx(workout, { sport: 'cycling', targetMode: 'power', ftp: 250 });
    assert.ok(tcx.includes('<Workout Sport="Biking">'));
    assert.ok(tcx.includes('&amp;'));
    assert.ok(tcx.includes('<Low>220</Low>'));

    const zwo = encodeWorkoutToZwo(workout, { sport: 'cycling', ftp: 250 });
    assert.ok(zwo.includes('<workout_file>'));
    assert.ok(zwo.includes('<IntervalsT Repeat="2"'));
    assert.ok(zwo.includes('&lt;Build&gt;'));
  });

  console.log(`📊 Daily Workout & FIT Export tests: ${passed} passed, ${failed} failed.`);
  return failed === 0;
}
