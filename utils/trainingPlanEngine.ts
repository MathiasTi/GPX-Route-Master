import { predictRaceTimeFromVdot, formatRaceTime, formatPaceMinPerKm } from './sportsMetricsEngine';

export interface TrainingVitalsSnapshot {
  readinessScore: number | null;
  readinessLabel?: string;
  readinessTone?: 'emerald' | 'amber' | 'rose' | 'slate';
  sleepHoursAvg7d: number | null;
  sleepScoreAvg7d: number | null;
  sleepHoursLatest?: number | null;
  sleepScoreLatest?: number | null;
  rhrLatest: number | null;
  rhrBaseline: number | null;
  rhr7dDelta: number | null;
  rhrTodayDelta?: number | null;
  stressAvg7d: number | null;
  stressLatest?: number | null;
  stepsAvg7d: number | null;
}

export type TrainingGoalType = '10k' | 'halfmarathon' | 'marathon' | 'granfondo' | 'tour';

export interface TrainingPlanInput {
  goal: {
    name: string;
    type: TrainingGoalType;
    sport: 'running' | 'cycling';
    distanceKm: number;
    elevationM: number;
    planWeeks: 4 | 8 | 12;
    sessionsPerWeek: 'auto' | 3 | 4 | 5 | 6;
    useVitalsAdaptation: boolean;
  };
  athlete: {
    ftp: number;
    estimatedFtp?: number | null;
    weightKg: number;
    bikeWeightKg: number;
    age: number;
    maxHr: number;
    rhrBaseline: number;
  };
  load: {
    ctl: number;
    atl: number;
    tsb: number;
    acwr: number;
    weeklyRampRate?: number | null;
    monotony?: number | null;
    strain?: number | null;
    polarizationClass?: string;
    z3GreyZonePct?: number;
  };
  history: {
    avgWeeklySessions: number;
    avgWeeklyDistanceKm: number;
    avgWeeklyDurationHrs: number;
    avgWeeklyAscentM: number;
    longestSessionDistanceKm: number;
    longestSessionDurationMin: number;
    recentAvgCyclingSpeedKmh?: number | null;
    recentAvgRunningPaceSecKm?: number | null;
    estimatedVdot?: number | null;
  };
  vitals?: TrainingVitalsSnapshot | null;
}

export interface WorkoutStep {
  name: string;
  durationMinutes: number;
  reps?: number;
  restDurationMinutes?: number;
  targetFtpPercent?: number;
  targetWattsRange?: [number, number];
  targetHrrPercent?: number;
  targetHrPercent?: number;
  targetHrBpmRange?: [number, number];
  targetPaceRangeSecKm?: [number, number];
}

export type WorkoutCategory = 'intensity' | 'threshold' | 'climbing' | 'endurance' | 'recovery';

export interface PlannedWorkout {
  dayLabel: string;
  title: string;
  category: WorkoutCategory;
  description: string;
  rationale: string;
  tss: number;
  estimatedDurationMin: number;
  targetDistanceKm?: number;
  steps: WorkoutStep[];
}

export interface PlannedWeek {
  weekNumber: number;
  phase: string;
  phaseDesc: string;
  targetTss: number;
  estimatedHours: number;
  isDeload: boolean;
  vitalsAdapted: boolean;
  workouts: PlannedWorkout[];
}

export interface VitalsModulationResult {
  status: 'optimal' | 'caution' | 'recovery';
  appliedMultiplier: number;
  intensityCap: 'full' | 'tempo' | 'aerobic';
  vitalsUsed: boolean;
  rawTriggers: string[];
  headline: string;
}

export interface RunningPaceTargets {
  vdot: number | null;
  easySecKm: number;
  marathonSecKm: number;
  thresholdSecKm: number;
  intervalSecKm: number;
  sourceLabel: string;
}

export interface GoalAssessment {
  estDurationHours: number;
  estSpeedKmh: number;
  estPaceSecKm: number | null;
  estTss: number;
  targetCtl: number;
  ctlGap: number;
  weeklyTssTargetRange: [number, number];
  readinessScore: number;
  userCtlLevel: string;
  safeWeeklyCtlRamp: number;
  deloadRatioLabel: string;
  elevDensityMPerKm: number;
  isHillyGoal: boolean;
}

export interface CoachingSignal {
  tone: 'emerald' | 'amber' | 'rose' | 'indigo';
  title: string;
  detail: string;
}

export interface AdaptivePlanResult {
  assessment: GoalAssessment;
  vitalsModulation: VitalsModulationResult;
  coachingSignals: CoachingSignal[];
  resolvedSessionsPerWeek: number;
  effectiveFtp: number;
  effectiveRhr: number;
  useKarvonen: boolean;
  runningPaces: RunningPaceTargets;
  weeks: PlannedWeek[];
}

/**
 * Computes low and high target BPM using Karvonen Heart Rate Reserve when valid,
 * or falls back cleanly to % of maxHR. Guaranteed within [effectiveRhr, maxHr].
 */
export function computeKarvonenBpmRange(
  lowHrrRatio: number,
  highHrrRatio: number,
  maxHr: number,
  rhr: number
): {
  lowBpm: number;
  highBpm: number;
  midBpm: number;
  effectiveRhr: number;
  usesKarvonen: boolean;
} {
  const safeMaxHr = Number.isFinite(maxHr) && maxHr >= 100 ? Math.round(maxHr) : 185;
  const effectiveRhr = Math.max(30, Math.min(Math.max(45, safeMaxHr - 35), Math.round(rhr || 55)));
  const usesKarvonen = safeMaxHr > effectiveRhr + 30;
  const clampBpm = (val: number) => Math.max(effectiveRhr, Math.min(safeMaxHr, Math.round(val)));

  const lowBpm = usesKarvonen
    ? clampBpm(effectiveRhr + (safeMaxHr - effectiveRhr) * lowHrrRatio)
    : clampBpm(safeMaxHr * lowHrrRatio);
  const highBpm = usesKarvonen
    ? clampBpm(effectiveRhr + (safeMaxHr - effectiveRhr) * highHrrRatio)
    : clampBpm(safeMaxHr * highHrrRatio);

  const orderedLow = Math.min(lowBpm, highBpm);
  const orderedHigh = Math.max(lowBpm, highBpm);
  return {
    lowBpm: orderedLow,
    highBpm: orderedHigh,
    midBpm: Math.round((orderedLow + orderedHigh) / 2),
    effectiveRhr,
    usesKarvonen
  };
}

/**
 * Derives structured running training paces from VDOT (when available) or recent running pace.
 */
export function computeRunningPaceTargets(
  estimatedVdot?: number | null,
  fallbackPaceSecKm?: number | null
): RunningPaceTargets {
  if (estimatedVdot && Number.isFinite(estimatedVdot) && estimatedVdot >= 25 && estimatedVdot <= 85) {
    const t10kSec = predictRaceTimeFromVdot(estimatedVdot, 10000);
    const tHmSec = predictRaceTimeFromVdot(estimatedVdot, 21097.5);
    const tMarSec = predictRaceTimeFromVdot(estimatedVdot, 42195);
    const t5kSec = predictRaceTimeFromVdot(estimatedVdot, 5000);

    const thresholdSecKm = Math.round(tHmSec / 21.0975);
    const marathonSecKm = Math.round(tMarSec / 42.195);
    const intervalSecKm = Math.round((t5kSec / 5.0) * 0.96);
    const easySecKm = Math.round((t10kSec / 10.0) * 1.24);

    return {
      vdot: Number(estimatedVdot.toFixed(1)),
      easySecKm,
      marathonSecKm,
      thresholdSecKm,
      intervalSecKm,
      sourceLabel: `Daniels VDOT ${estimatedVdot.toFixed(1)}`
    };
  }

  const basePace =
    fallbackPaceSecKm && Number.isFinite(fallbackPaceSecKm) && fallbackPaceSecKm >= 180 && fallbackPaceSecKm <= 600
      ? fallbackPaceSecKm
      : 345; // 5:45 min/km general default

  return {
    vdot: null,
    easySecKm: Math.round(basePace * 1.12),
    marathonSecKm: Math.round(basePace * 0.98),
    thresholdSecKm: Math.round(basePace * 0.89),
    intervalSecKm: Math.round(basePace * 0.82),
    sourceLabel: fallbackPaceSecKm ? 'Historische Laufpace' : 'Standard-Modell'
  };
}

/**
 * Evaluates Garmin vitals + longitudinal load safety to compute Week-1 intensity/volume modulation.
 */
export function evaluateVitalsAndLoadGuard(
  vitals: TrainingVitalsSnapshot | null | undefined,
  load: TrainingPlanInput['load'],
  useVitalsAdaptation: boolean
): VitalsModulationResult {
  const vitalTriggers: string[] = [];
  const loadTriggers: string[] = [];
  let vitalLevel: 'optimal' | 'caution' | 'recovery' = 'optimal';
  let loadLevel: 'optimal' | 'caution' | 'recovery' = 'optimal';

  if (vitals) {
    if (vitals.sleepHoursLatest !== null && vitals.sleepHoursLatest !== undefined && vitals.sleepHoursLatest < 5.5) {
      vitalLevel = 'recovery';
      vitalTriggers.push(`Akutes Schlafdefizit (${vitals.sleepHoursLatest.toFixed(1)} h letzte Nacht)`);
    } else if (vitals.sleepHoursLatest !== null && vitals.sleepHoursLatest !== undefined && vitals.sleepHoursLatest < 6.3) {
      if (vitalLevel === 'optimal') vitalLevel = 'caution';
      vitalTriggers.push(`Kurzer Schlaf letzte Nacht (${vitals.sleepHoursLatest.toFixed(1)} h)`);
    }

    if (vitals.rhrTodayDelta !== null && vitals.rhrTodayDelta !== undefined && vitals.rhrTodayDelta >= 4.5) {
      vitalLevel = 'recovery';
      vitalTriggers.push(`Akuter Ruhepuls-Sprung (+${vitals.rhrTodayDelta.toFixed(1)} bpm heute)`);
    } else if (vitals.rhrTodayDelta !== null && vitals.rhrTodayDelta !== undefined && vitals.rhrTodayDelta >= 2.5) {
      if (vitalLevel === 'optimal') vitalLevel = 'caution';
      vitalTriggers.push(`Ruhepuls heute leicht erhöht (+${vitals.rhrTodayDelta.toFixed(1)} bpm)`);
    }

    if (vitals.readinessScore !== null && vitals.readinessScore < 58) {
      vitalLevel = 'recovery';
      vitalTriggers.push(`Readiness niedrig (${vitals.readinessScore}/100)`);
    } else if (vitals.readinessScore !== null && vitals.readinessScore < 75) {
      if (vitalLevel === 'optimal') vitalLevel = 'caution';
      vitalTriggers.push(`Readiness moderat (${vitals.readinessScore}/100)`);
    }

    if (vitals.sleepHoursAvg7d !== null && vitals.sleepHoursAvg7d < 6.0) {
      vitalLevel = 'recovery';
      vitalTriggers.push(`Schlafdefizit 7d (Ø ${vitals.sleepHoursAvg7d.toFixed(1)} h)`);
    } else if (vitals.sleepHoursAvg7d !== null && vitals.sleepHoursAvg7d < 6.8) {
      if (vitalLevel === 'optimal') vitalLevel = 'caution';
      vitalTriggers.push(`Kurzer Schlaf 7d (Ø ${vitals.sleepHoursAvg7d.toFixed(1)} h)`);
    }

    if (vitals.rhr7dDelta !== null && vitals.rhr7dDelta >= 4.0) {
      vitalLevel = 'recovery';
      vitalTriggers.push(`Ruhepuls erhöht (+${vitals.rhr7dDelta.toFixed(1)} bpm vs. 30d)`);
    } else if (vitals.rhr7dDelta !== null && vitals.rhr7dDelta >= 2.0) {
      if (vitalLevel === 'optimal') vitalLevel = 'caution';
      vitalTriggers.push(`Ruhepuls leicht erhöht (+${vitals.rhr7dDelta.toFixed(1)} bpm)`);
    }

    if (vitals.stressAvg7d !== null && vitals.stressAvg7d > 55) {
      vitalLevel = 'recovery';
      vitalTriggers.push(`Hoher Alltagsstress 7d (Ø ${Math.round(vitals.stressAvg7d)})`);
    } else if (vitals.stressAvg7d !== null && vitals.stressAvg7d > 42) {
      if (vitalLevel === 'optimal') vitalLevel = 'caution';
      vitalTriggers.push(`Erhöhter Stress 7d (Ø ${Math.round(vitals.stressAvg7d)})`);
    }
  }

  if (load.acwr > 1.45 || load.tsb < -25) {
    loadLevel = 'recovery';
    if (load.acwr > 1.45) loadTriggers.push(`Hohe ACWR-Spitze (${load.acwr.toFixed(2)})`);
    if (load.tsb < -25) loadTriggers.push(`Tiefe Ermüdung (TSB ${load.tsb})`);
  } else if (load.acwr > 1.3 || (load.monotony !== null && load.monotony !== undefined && load.monotony > 2.0)) {
    loadLevel = 'caution';
    if (load.acwr > 1.3) loadTriggers.push(`ACWR erhöht (${load.acwr.toFixed(2)})`);
    if (load.monotony && load.monotony > 2.0) loadTriggers.push(`Hohe Trainingsmonotonie (${load.monotony.toFixed(2)})`);
  }

  const rawTriggers = [...vitalTriggers, ...loadTriggers];
  const rank = { optimal: 0, caution: 1, recovery: 2 };
  const combinedLevel: 'optimal' | 'caution' | 'recovery' =
    rank[vitalLevel] >= rank[loadLevel] ? vitalLevel : loadLevel;

  if (!useVitalsAdaptation) {
    return {
      status: combinedLevel,
      appliedMultiplier: 1.0,
      intensityCap: 'full',
      vitalsUsed: false,
      rawTriggers,
      headline:
        rawTriggers.length > 0
          ? `Vital-/Last-Anpassung deaktiviert (erkannte Signale: ${rawTriggers.join(', ')}).`
          : 'Basisplan ohne Vital-Modulation aktiv.'
    };
  }

  if (combinedLevel === 'recovery') {
    return {
      status: 'recovery',
      appliedMultiplier: 0.75,
      intensityCap: 'aerobic',
      vitalsUsed: true,
      rawTriggers,
      headline: `Erholungsschutz für Woche 1 (−25% TSS, nur Z1/Z2): ${rawTriggers.join(' · ')}.`
    };
  }

  if (combinedLevel === 'caution') {
    return {
      status: 'caution',
      appliedMultiplier: 0.90,
      intensityCap: 'tempo',
      vitalsUsed: true,
      rawTriggers,
      headline: `Vorsichtige Woche 1 (−10% TSS, max. Tempo/SST): ${rawTriggers.join(' · ')}.`
    };
  }

  const boostReady =
    vitals?.readinessScore !== null &&
    vitals?.readinessScore !== undefined &&
    vitals.readinessScore >= 85 &&
    load.tsb >= 0;

  return {
    status: 'optimal',
    appliedMultiplier: boostReady ? 1.04 : 1.0,
    intensityCap: 'full',
    vitalsUsed: true,
    rawTriggers,
    headline: boostReady
      ? 'Top-Erholung & frische Vitalwerte: volle Reizfreigabe für Woche 1.'
      : 'Vitalwerte und Belastungsbalance im grünen Korridor.'
  };
}

const DAY_SCHEDULES: Record<number, string[]> = {
  3: ['Di', 'Do', 'So'],
  4: ['Di', 'Do', 'Sa', 'So'],
  5: ['Di', 'Mi', 'Fr', 'Sa', 'So'],
  6: ['Di', 'Mi', 'Do', 'Fr', 'Sa', 'So']
};

export function generateAdaptiveTrainingPlan(input: TrainingPlanInput): AdaptivePlanResult {
  const { goal, athlete, load, history, vitals } = input;
  const safeDistance = Math.max(1, Number(goal.distanceKm) || 10);
  const safeElevation = Math.max(0, Number(goal.elevationM) || 0);
  const safeWeight = Math.max(35, Number(athlete.weightKg) || 75);
  const safeMaxHr = Math.max(110, Math.round(athlete.maxHr || 185));
  const effectiveFtp = Math.max(
    80,
    Math.round(athlete.ftp > 0 ? athlete.ftp : athlete.estimatedFtp || 220)
  );
  const wkg = effectiveFtp / safeWeight;
  const userAge = Math.max(14, Math.min(95, Math.round(athlete.age || 35)));

  const karvonenSample = computeKarvonenBpmRange(0.65, 0.75, safeMaxHr, athlete.rhrBaseline);
  const effectiveRhr = karvonenSample.effectiveRhr;
  const useKarvonen = karvonenSample.usesKarvonen;

  const runningPaces = computeRunningPaceTargets(
    history.estimatedVdot,
    history.recentAvgRunningPaceSecKm
  );

  const elevDensity = safeElevation / safeDistance; // m/km
  const isHillyGoal = elevDensity >= 15 || safeElevation >= 1200;

  // 1. Estimate realistic goal speed, duration, Event TSS & Target CTL
  let estSpeedKmh = 22;
  let estPaceSecKm: number | null = null;

  if (goal.sport === 'running') {
    const flatPaceSec = runningPaces.vdot
      ? predictRaceTimeFromVdot(runningPaces.vdot, safeDistance * 1000) / safeDistance
      : runningPaces.marathonSecKm;
    // Grade penalty (~6 sec/km per 10 m/km elevation gain)
    const hillPenaltySecKm = elevDensity * 0.6;
    estPaceSecKm = Math.max(180, Math.round(flatPaceSec + hillPenaltySecKm));
    estSpeedKmh = 3600 / estPaceSecKm;
  } else {
    const baselineFlatKmh =
      history.recentAvgCyclingSpeedKmh && history.recentAvgCyclingSpeedKmh >= 12
        ? history.recentAvgCyclingSpeedKmh
        : Math.max(18, Math.min(36, 17 + wkg * 3.8));
    // Climbing slows average speed proportional to elevation density
    estSpeedKmh = Math.max(11, baselineFlatKmh - elevDensity * 0.28);
  }

  const estDurationHours = Math.max(0.4, safeDistance / Math.max(4, estSpeedKmh));
  const estIf =
    goal.sport === 'running'
      ? goal.type === '10k'
        ? 0.96
        : goal.type === 'halfmarathon'
          ? 0.90
          : 0.82
      : safeDistance >= 140
        ? 0.68
        : 0.75;
  const estTss = Math.round(estDurationHours * Math.pow(estIf, 2) * 100);

  let targetCtl = 45;
  if (goal.type === '10k') targetCtl = 38;
  else if (goal.type === 'halfmarathon') targetCtl = 48;
  else if (goal.type === 'marathon') targetCtl = 65;
  else if (goal.type === 'granfondo') targetCtl = Math.max(55, Math.min(95, Math.round(estTss / 4.2)));
  else targetCtl = Math.max(32, Math.min(95, Math.round(estTss / 4.3)));

  // Terrain bonus to CTL demand for alpine events
  if (isHillyGoal && goal.type !== 'marathon' && goal.type !== 'halfmarathon') {
    targetCtl = Math.min(100, targetCtl + Math.round(safeElevation / 600) * 3);
  }

  const userCtl = Math.max(0, Number(load.ctl) || 0);
  const ctlBaseline = Math.max(18, userCtl || 25);
  const ctlGap = Math.max(0, targetCtl - userCtl);

  // Safe CTL ramp rate adapted for age
  const safeWeeklyCtlRamp = userAge >= 55 ? 3 : userAge >= 45 ? 4 : 5;
  const deloadRatioLabel = userAge >= 45 ? '2:1 (Masters)' : '3:1 (Klassisch)';

  const desiredCtlIncrement = Math.min(safeWeeklyCtlRamp, ctlGap / Math.max(1, goal.planWeeks - 2));
  const weeklyTssTarget = Math.round(ctlBaseline * 7 * 0.96 + desiredCtlIncrement * 16);

  // Composite Readiness Score combining CTL (60%), longest session (20%), climbing (10%), vitals (10%)
  const ctlScore = userCtl >= targetCtl ? 100 : Math.min(100, Math.round((userCtl / Math.max(1, targetCtl)) * 100));
  const targetPeakLongKm =
    goal.sport === 'running'
      ? Math.min(34, safeDistance * 0.78)
      : Math.min(150, safeDistance * 0.8);
  const longDistScore =
    history.longestSessionDistanceKm > 0
      ? Math.min(100, Math.round((history.longestSessionDistanceKm / Math.max(5, targetPeakLongKm * 0.65)) * 100))
      : 50;
  const climbScore = !isHillyGoal
    ? 90
    : history.avgWeeklyAscentM > 0
      ? Math.min(100, Math.round((history.avgWeeklyAscentM / Math.max(300, safeElevation * 0.6)) * 100))
      : 45;
  const vitalComponent =
    vitals?.readinessScore !== null && vitals?.readinessScore !== undefined
      ? vitals.readinessScore
      : 72;

  const readinessScore = Math.max(
    15,
    Math.min(
      98,
      Math.round(ctlScore * 0.6 + longDistScore * 0.2 + climbScore * 0.1 + vitalComponent * 0.1)
    )
  );

  // 2. Vitals + Load Guard
  const vitalsModulation = evaluateVitalsAndLoadGuard(vitals, load, goal.useVitalsAdaptation);

  // 3. Resolve sessions/week
  const resolvedSessionsPerWeek =
    goal.sessionsPerWeek === 'auto'
      ? Math.max(3, Math.min(6, Math.round(history.avgWeeklySessions || (userCtl >= 55 ? 5 : userCtl >= 35 ? 4 : 3))))
      : goal.sessionsPerWeek;

  // 4. Build Coaching Signals
  const coachingSignals: CoachingSignal[] = [];

  if (vitalsModulation.status === 'recovery') {
    coachingSignals.push({
      tone: 'rose',
      title: 'Vitaldaten & Belastungsschutz aktiv',
      detail: vitalsModulation.headline
    });
  } else if (vitalsModulation.status === 'caution') {
    coachingSignals.push({
      tone: 'amber',
      title: 'Dosierter Einstieg in Woche 1',
      detail: vitalsModulation.headline
    });
  } else {
    coachingSignals.push({
      tone: 'emerald',
      title: 'Trainingsbereitschaft bestätigt',
      detail: vitalsModulation.headline
    });
  }

  if (userAge >= 45) {
    coachingSignals.push({
      tone: 'indigo',
      title: `Altersangepasste Periodisierung (${userAge} J.)`,
      detail: `2:1 Belastungs-/Entlastungsrhythmus und maximal +${safeWeeklyCtlRamp} CTL/Woche schützen Bindegewebe und Hormonhaushalt.`
    });
  }

  if (isHillyGoal) {
    coachingSignals.push({
      tone: 'indigo',
      title: `Höhenmeter-Fokus (${safeElevation} hm / ${Math.round(elevDensity)} hm/km)`,
      detail:
        goal.sport === 'cycling'
          ? 'Spezifische Kraftausdauer-Intervalle (70–75 rpm am Berg) im Wochenplan integriert.'
          : 'Berganstiegs-Wiederholungen und hügelige Dauerläufe im Wochenplan verankert.'
    });
  }

  if ((load.z3GreyZonePct || 0) >= 35) {
    coachingSignals.push({
      tone: 'amber',
      title: `Grey-Zone-Korrektur (${Math.round(load.z3GreyZonePct!)}% in Z3)`,
      detail:
        'Deine Historie zeigt viel moderates Mitteltempo (Z3). Die Grundlagen-Einheiten sind strikt in Z1/Z2 gehalten, damit deine Intervalle in Z4/Z5 voll zünden.'
    });
  }

  if (athlete.estimatedFtp && Math.abs(athlete.estimatedFtp - athlete.ftp) >= 10) {
    coachingSignals.push({
      tone: 'indigo',
      title: `eFTP-Abweichung erkannt (${athlete.estimatedFtp} W vs. ${athlete.ftp} W)`,
      detail: `Aus deinen Leistungsdaten ergibt sich eine geschätzte FTP von ${athlete.estimatedFtp} W (${(athlete.estimatedFtp / safeWeight).toFixed(2)} W/kg).`
    });
  }

  // 5. Generate periodized weeks
  const weeksCount = goal.planWeeks;
  const isMasters = userAge >= 45;
  const isTrained = userCtl > 35 || history.avgWeeklySessions >= 3;
  const baseTss = Math.max(120, Math.min(isTrained ? 780 : 250, ctlBaseline * 7 * 0.95));

  const daySlots = DAY_SCHEDULES[resolvedSessionsPerWeek] || DAY_SCHEDULES[4];

  // Helper to construct HR/Power/Pace step
  const makeStep = (params: {
    name: string;
    durationMinutes: number;
    reps?: number;
    restDurationMinutes?: number;
    ftpPct?: number;
    hrrLow: number;
    hrrHigh: number;
    paceSecKm?: number;
  }): WorkoutStep => {
    const hr = computeKarvonenBpmRange(params.hrrLow, params.hrrHigh, safeMaxHr, effectiveRhr);
    const step: WorkoutStep = {
      name: params.name,
      durationMinutes: params.durationMinutes,
      reps: params.reps,
      restDurationMinutes: params.restDurationMinutes,
      targetHrrPercent: Math.round(((params.hrrLow + params.hrrHigh) / 2) * 100),
      targetHrPercent: Math.round((hr.midBpm / safeMaxHr) * 100),
      targetHrBpmRange: [hr.lowBpm, hr.highBpm]
    };

    if (goal.sport === 'cycling' && params.ftpPct) {
      step.targetFtpPercent = params.ftpPct;
      const centerW = Math.round((effectiveFtp * params.ftpPct) / 100);
      step.targetWattsRange = [Math.round(centerW * 0.94), Math.round(centerW * 1.06)];
    }

    if (goal.sport === 'running' && params.paceSecKm) {
      step.targetPaceRangeSecKm = [
        Math.round(params.paceSecKm * 0.97),
        Math.round(params.paceSecKm * 1.03)
      ];
    }

    return step;
  };

  // Anchor Week-1 longest ride/run to recent longest session (+10% max)
  const baselineLongKm =
    history.longestSessionDistanceKm > 0
      ? Math.max(goal.sport === 'running' ? 8 : 30, history.longestSessionDistanceKm)
      : goal.sport === 'running'
        ? 11
        : 45;

  const weeks: PlannedWeek[] = [];

  for (let w = 0; w < weeksCount; w++) {
    let phase = '';
    let phaseDesc = '';
    let loadMultiplier = 1.0;
    let isDeload = false;

    if (weeksCount === 4) {
      if (w === 0) {
        phase = 'Build (Belastungsaufbau)';
        phaseDesc = 'Aufbau von Schwellen- und Grundlagenkapazität abgestimmt auf deine Erholungslage.';
        loadMultiplier = 1.05;
      } else if (w === 1) {
        phase = 'Peak (Hauptbelastung)';
        phaseDesc = 'Spezifische Zielpace- und VO2max-Reize bei kontrolliertem Umfang.';
        loadMultiplier = 1.22;
      } else if (w === 2) {
        phase = 'Tapering I (Entlastung)';
        phaseDesc = 'Umfangsreduktion um ca. 30% bei kurzen, spritzigen Aktivierungsspitzen.';
        loadMultiplier = 0.78;
        isDeload = true;
      } else {
        phase = 'Wettkampf-Woche';
        phaseDesc = 'Volle Glykogenspeicher und neuronale Frische am Event-Tag.';
        loadMultiplier = 0.48;
        isDeload = true;
      }
    } else if (weeksCount === 8) {
      if (isMasters ? w === 2 || w === 5 : w === 3) {
        phase = 'Deload (Superkompensation)';
        phaseDesc = isMasters
          ? 'Geplante 2:1-Regenerationswoche für tiefe Anpassung und Verletzungsprophylaxe.'
          : 'Aktive Entlastungswoche zur Absorption des vorangegangenen Trainingsblocks.';
        loadMultiplier = 0.72;
        isDeload = true;
      } else if (w < 2) {
        phase = 'Base (Fundament)';
        phaseDesc = 'Aerober Grundlagenaufbau, Fettstoffwechsel und saubere 80/20-Polarisierung.';
        loadMultiplier = 0.96 + w * 0.08;
      } else if (w < 4) {
        phase = 'Build (Schwellenausbau)';
        phaseDesc = 'Fortschreitende Schwellen- und Kraftausdauerreize nahe der Wettkampfintensität.';
        loadMultiplier = 1.15;
      } else if (w < 6) {
        phase = 'Peak (Zielspezifik)';
        phaseDesc = 'Höchste spezifische Beanspruchung mit wettkampfnahen Koppeln und Bergreizen.';
        loadMultiplier = 1.28;
      } else if (w === 6) {
        phase = 'Tapering I';
        phaseDesc = 'Volumen um 25% senken, Schwellen-Spannkraft mit kurzen Intervallen halten.';
        loadMultiplier = 0.80;
        isDeload = true;
      } else {
        phase = 'Tapering II & Event';
        phaseDesc = 'Maximale Frische (positiver TSB) am Zieltag.';
        loadMultiplier = 0.48;
        isDeload = true;
      }
    } else {
      // 12 Weeks
      const isMastersDeload = isMasters && (w === 2 || w === 5 || w === 8);
      const isClassicDeload = !isMasters && (w === 3 || w === 7);
      if (isMastersDeload || isClassicDeload) {
        phase = 'Deload (Anpassung)';
        phaseDesc = isMasters
          ? 'Altersgerechter 2:1-Regenerationszyklus für volle muskuläre und vegetative Erholung.'
          : 'Superkompensationswoche vor dem nächsten Steigerungsblock.';
        loadMultiplier = 0.72;
        isDeload = true;
      } else if (w < 3) {
        phase = 'Base I (Fundament)';
        phaseDesc = 'Mitochondriendichte und orthopädische Robustheit durch ruhige GA1-Umfänge.';
        loadMultiplier = 0.94 + w * 0.06;
      } else if (w < 7) {
        phase = 'Build (Kraftausdauer & Schwelle)';
        phaseDesc = 'Systematische Verschiebung der Laktatschwelle und Ausbau der Steigfähigkeit.';
        loadMultiplier = 1.12 + ((w - 3) * 0.04);
      } else if (w < 10) {
        phase = 'Peak (Wettkampfsimulation)';
        phaseDesc = 'Spezifische Wettkampf-Pace/Leistung und lange Ausdauerspitzen.';
        loadMultiplier = 1.28;
      } else if (w === 10) {
        phase = 'Tapering I';
        phaseDesc = 'Deutliche Umfangsreduktion zur Abbau akuter Ermüdung (ATL).';
        loadMultiplier = 0.82;
        isDeload = true;
      } else {
        phase = 'Tapering II & Wettkampf';
        phaseDesc = 'Top-Form und volle Energiespeicher für deinen Zieltag.';
        loadMultiplier = 0.48;
        isDeload = true;
      }
    }

    const applyVitalsThisWeek = w === 0 && vitalsModulation.vitalsUsed && vitalsModulation.appliedMultiplier !== 1.0;
    const weekMultiplier = loadMultiplier * (w === 0 ? vitalsModulation.appliedMultiplier : 1.0);
    const weekTss = Math.max(85, Math.round(baseTss * weekMultiplier));

    const effectiveCap: 'full' | 'tempo' | 'aerobic' =
      w === 0 && vitalsModulation.vitalsUsed ? vitalsModulation.intensityCap : 'full';

    const buildRatio = w / Math.max(1, weeksCount - 2);
    const isPeakPhase = phase.toLowerCase().includes('peak');
    const isTaperPhase = phase.toLowerCase().includes('taper') || phase.toLowerCase().includes('wettkampf');
    const isBuildPhase = phase.toLowerCase().includes('build');

    // Long Session Progression capped cleanly vs history
    const longProgressionMult = isDeload || isTaperPhase ? 0.72 : Math.min(1.85, 1.0 + buildRatio * 0.55);
    const plannedLongKm = Number(
      Math.max(
        goal.sport === 'running' ? 8 : 30,
        Math.min(targetPeakLongKm, baselineLongKm * longProgressionMult)
      ).toFixed(1)
    );

    const workouts: PlannedWorkout[] = [];

    // Slot 1: Key Intensity / Threshold (or downgraded aerobic session if vitals red)
    const tssShareKey = isDeload ? 0.28 : 0.30;
    const keyTss = Math.round(weekTss * tssShareKey);
    if (effectiveCap === 'aerobic') {
      workouts.push({
        dayLabel: daySlots[0],
        title: `Vital-Schutz: Ruhige GA1-Grundlage W${w + 1}`,
        category: 'recovery',
        description:
          'Aufgrund aktueller Erholungs-/Belastungssignale werden Intervalle in Woche 1 durch striktes Z1/Z2-Grundlagentempo ersetzt.',
        rationale: vitalsModulation.headline,
        tss: keyTss,
        estimatedDurationMin: goal.sport === 'cycling' ? 60 : 45,
        steps: [
          makeStep({ name: 'Einlaufen / Warm-up', durationMinutes: 10, ftpPct: 52, hrrLow: 0.52, hrrHigh: 0.60, paceSecKm: runningPaces.easySecKm + 15 }),
          makeStep({ name: 'Stabiles GA1 (Z2)', durationMinutes: goal.sport === 'cycling' ? 40 : 28, ftpPct: 65, hrrLow: 0.62, hrrHigh: 0.70, paceSecKm: runningPaces.easySecKm }),
          makeStep({ name: 'Cool-down', durationMinutes: 10, ftpPct: 48, hrrLow: 0.50, hrrHigh: 0.58, paceSecKm: runningPaces.easySecKm + 20 })
        ]
      });
    } else if (goal.sport === 'cycling') {
      const wantVo2 = isPeakPhase && effectiveCap === 'full';
      const wantSst = isBuildPhase || (isPeakPhase && effectiveCap === 'tempo');
      const mainTitle = isDeload || isTaperPhase
        ? `Schwellen-Spritzigkeit W${w + 1}`
        : wantVo2
          ? `VO2max Power-Intervalle W${w + 1}`
          : wantSst
            ? `Sweet-Spot Schwellenblock W${w + 1}`
            : `Aerobe Tempo-Aktivierung W${w + 1}`;
      const mainStep = wantVo2
        ? makeStep({ name: 'VO2max Intervall', durationMinutes: 4, reps: 5, restDurationMinutes: 4, ftpPct: 114, hrrLow: 0.86, hrrHigh: 0.94 })
        : wantSst
          ? makeStep({ name: 'Sweet Spot (88–92% FTP)', durationMinutes: 15, reps: 2, restDurationMinutes: 5, ftpPct: 90, hrrLow: 0.76, hrrHigh: 0.85 })
          : isDeload || isTaperPhase
            ? makeStep({ name: 'Kurze Schwellenreize', durationMinutes: 4, reps: 3, restDurationMinutes: 3, ftpPct: 95, hrrLow: 0.78, hrrHigh: 0.86 })
            : makeStep({ name: 'GA2-Tempoblock', durationMinutes: 10, reps: 2, restDurationMinutes: 5, ftpPct: 80, hrrLow: 0.70, hrrHigh: 0.78 });

      const repsDur = mainStep.durationMinutes * (mainStep.reps || 1) + (mainStep.restDurationMinutes || 0) * Math.max(0, (mainStep.reps || 1) - 1);
      workouts.push({
        dayLabel: daySlots[0],
        title: mainTitle,
        category: wantVo2 ? 'intensity' : 'threshold',
        description:
          effectiveCap === 'tempo'
            ? 'Leicht gedrosselte Schwellen-/Tempo-Steuerung passend zu deinem heutigen Vital- & Lastprofil.'
            : 'Gezielte Verschiebung deiner funktionellen Leistungsschwelle (FTP) und Sauerstoffaufnahme.',
        rationale: `Watt-Ziel auf ${effectiveFtp} W FTP & Karvonen HRR (${effectiveRhr}–${safeMaxHr} bpm) kalibriert.`,
        tss: keyTss,
        estimatedDurationMin: 25 + repsDur,
        steps: [
          makeStep({ name: 'Warm-up (GA1)', durationMinutes: 15, ftpPct: 58, hrrLow: 0.56, hrrHigh: 0.65 }),
          mainStep,
          makeStep({ name: 'Cool-down', durationMinutes: 10, ftpPct: 50, hrrLow: 0.50, hrrHigh: 0.58 })
        ]
      });
    } else {
      const wantVo2 = isPeakPhase && effectiveCap === 'full';
      const wantThresh = isBuildPhase || (isPeakPhase && effectiveCap === 'tempo');
      const mainTitle = isDeload || isTaperPhase
        ? `Neuromuskuläre Aktivierung W${w + 1}`
        : wantVo2
          ? `VO2max Bahn-/Tempointervalle W${w + 1}`
          : wantThresh
            ? `Schwellen-Tempodauerlauf W${w + 1}`
            : `Steigerungs- & Ökonomielauf W${w + 1}`;
      const mainStep = wantVo2
        ? makeStep({ name: 'VO2max Intervall', durationMinutes: 3, reps: 5, restDurationMinutes: 3, hrrLow: 0.86, hrrHigh: 0.94, paceSecKm: runningPaces.intervalSecKm })
        : wantThresh
          ? makeStep({ name: 'Schwellentempo (Z4)', durationMinutes: 8, reps: 3, restDurationMinutes: 3, hrrLow: 0.78, hrrHigh: 0.87, paceSecKm: runningPaces.thresholdSecKm })
          : isDeload || isTaperPhase
            ? makeStep({ name: 'Zielpace-Steigerung', durationMinutes: 3, reps: 3, restDurationMinutes: 3, hrrLow: 0.76, hrrHigh: 0.84, paceSecKm: runningPaces.marathonSecKm })
            : makeStep({ name: 'Kontrollierte Steigerung', durationMinutes: 4, reps: 4, restDurationMinutes: 2, hrrLow: 0.72, hrrHigh: 0.81, paceSecKm: runningPaces.marathonSecKm });
      const repsDur = mainStep.durationMinutes * (mainStep.reps || 1) + (mainStep.restDurationMinutes || 0) * Math.max(0, (mainStep.reps || 1) - 1);
      workouts.push({
        dayLabel: daySlots[0],
        title: mainTitle,
        category: wantVo2 ? 'intensity' : 'threshold',
        description: `Pace-Orientierung (${runningPaces.sourceLabel}): ${formatPaceMinPerKm(runningPaces.thresholdSecKm)} Schwelle · ${formatPaceMinPerKm(runningPaces.intervalSecKm)} Intervall.`,
        rationale: `Basierend auf ${runningPaces.sourceLabel} und Karvonen-HF (${effectiveRhr}–${safeMaxHr} bpm).`,
        tss: keyTss,
        estimatedDurationMin: 22 + repsDur,
        steps: [
          makeStep({ name: 'Einlaufen (Locker Z1/Z2)', durationMinutes: 12, hrrLow: 0.56, hrrHigh: 0.66, paceSecKm: runningPaces.easySecKm }),
          mainStep,
          makeStep({ name: 'Auslaufen', durationMinutes: 10, hrrLow: 0.52, hrrHigh: 0.60, paceSecKm: runningPaces.easySecKm + 15 })
        ]
      });
    }

    // Slot 2 (placed safely between hard days when >=4 sessions): Climbing / Aerobic Support
    if (resolvedSessionsPerWeek >= 4) {
      const slotDay = daySlots[1];
      const supportTss = Math.round(weekTss * 0.19);
      if (isHillyGoal && effectiveCap !== 'aerobic' && !isTaperPhase) {
        if (goal.sport === 'cycling') {
          workouts.push({
            dayLabel: slotDay,
            title: `Berg-Kraftausdauer (70 rpm) W${w + 1}`,
            category: 'climbing',
            description: `Spezifische Vorbereitung auf ${safeElevation} hm Gesamtanstieg bei gedrosselter Trittfrequenz.`,
            rationale: `Höhendichte von ${Math.round(elevDensity)} hm/km im Ziel erfordert Drehmoment-Stabilität am Berg.`,
            tss: supportTss,
            estimatedDurationMin: 65,
            steps: [
              makeStep({ name: 'Einfahren (GA1)', durationMinutes: 15, ftpPct: 58, hrrLow: 0.55, hrrHigh: 0.65 }),
              makeStep({ name: 'Bergintervall (65–75 rpm)', durationMinutes: 8, reps: 3, restDurationMinutes: 4, ftpPct: 86, hrrLow: 0.74, hrrHigh: 0.83 }),
              makeStep({ name: 'Ausfahren', durationMinutes: 15, ftpPct: 52, hrrLow: 0.52, hrrHigh: 0.60 })
            ]
          });
        } else {
          workouts.push({
            dayLabel: slotDay,
            title: `Hügel-Intervalle & Laufkraft W${w + 1}`,
            category: 'climbing',
            description: `Gezielte Steigläufe für Abdruckkraft und Laufökonomie bei ${safeElevation} hm Profil.`,
            rationale: `Spezifische Anpassung an das Höhenprofil (${Math.round(elevDensity)} hm/km).`,
            tss: supportTss,
            estimatedDurationMin: 50,
            steps: [
              makeStep({ name: 'Einlaufen (GA1)', durationMinutes: 15, hrrLow: 0.56, hrrHigh: 0.65, paceSecKm: runningPaces.easySecKm }),
              makeStep({ name: 'Bergansprint / Steiglauf (5–8%)', durationMinutes: 2, reps: 6, restDurationMinutes: 2.5, hrrLow: 0.78, hrrHigh: 0.88 }),
              makeStep({ name: 'Auslaufen (Flach)', durationMinutes: 10, hrrLow: 0.52, hrrHigh: 0.62, paceSecKm: runningPaces.easySecKm })
            ]
          });
        }
      } else {
        workouts.push({
          dayLabel: slotDay,
          title: `Polarisierte GA1-Ausfahrt / -Lauf W${w + 1}`,
          category: 'endurance',
          description:
            'Ruhige aerobe Ausdauereinheit strikt unterhalb der aeroben Schwelle (Z2) ohne Grey-Zone-Abdrift.',
          rationale: (load.z3GreyZonePct || 0) >= 35
            ? 'Gegensteuerung zu hohem Z3-Anteil in deiner Historie.'
            : 'Stärkt Kapillarisierung und Erholung zwischen intensiven Reizen.',
          tss: supportTss,
          estimatedDurationMin: goal.sport === 'cycling' ? 60 : 45,
          steps: [
            makeStep({ name: 'Stabiles GA1 (Z2)', durationMinutes: goal.sport === 'cycling' ? 60 : 45, ftpPct: 65, hrrLow: 0.60, hrrHigh: 0.70, paceSecKm: runningPaces.easySecKm })
          ]
        });
      }
    }

    // Slot 3 (when >=5 sessions): Active Recovery / Technique
    if (resolvedSessionsPerWeek >= 5) {
      workouts.push({
        dayLabel: daySlots[2],
        title: goal.sport === 'cycling' ? `Regenerative Technikfahrt W${w + 1}` : `Lockerer Technik- & Mobilitätslauf W${w + 1}`,
        category: 'recovery',
        description: 'Aktive Durchblutung, Kadenz- und Schrittfrequenzpflege bei minimaler Belastung (Z1).',
        rationale: `Verhindert Back-to-Back-Ermüdung bei ${resolvedSessionsPerWeek} Wochen-Einheiten.`,
        tss: Math.round(weekTss * 0.10),
        estimatedDurationMin: goal.sport === 'cycling' ? 40 : 30,
        steps: [
          makeStep({ name: 'Lockere Z1-Bewegung', durationMinutes: goal.sport === 'cycling' ? 40 : 30, ftpPct: 50, hrrLow: 0.48, hrrHigh: 0.58, paceSecKm: runningPaces.easySecKm + 20 })
        ]
      });
    }

    // Slot 4 (when === 6 sessions): Aerobic Tempo / Second Endurance Block
    if (resolvedSessionsPerWeek >= 6) {
      workouts.push({
        dayLabel: daySlots[3],
        title: goal.sport === 'cycling' ? `Aerobe GA1+ Trittökonomie W${w + 1}` : `Ruhiger GA1 Grundlagenlauf W${w + 1}`,
        category: 'endurance',
        description: 'Solider Grundlagenreiz im oberen Z2-Bereich zur Steigerung des aeroben Wochenvolumens.',
        rationale: 'Nutzt deine hohe Trainingsfrequenz für nachhaltigen Mitochondrienaufbau.',
        tss: Math.round(weekTss * 0.14),
        estimatedDurationMin: goal.sport === 'cycling' ? 70 : 50,
        steps: [
          makeStep({ name: 'GA1 Ausdauer (oberes Z2)', durationMinutes: goal.sport === 'cycling' ? 70 : 50, ftpPct: 68, hrrLow: 0.63, hrrHigh: 0.72, paceSecKm: runningPaces.easySecKm })
        ]
      });
    }

    // Slot N-1: Long Ride / Long Run (anchored on history longest session)
    const longTss = Math.round(weekTss * (isDeload ? 0.36 : 0.42));
    const longSlotIdx = Math.max(1, daySlots.length - 2);
    const longDay = resolvedSessionsPerWeek === 3 ? daySlots[1] : daySlots[longSlotIdx];
    const longSpeedKmh = goal.sport === 'cycling' ? Math.max(18, estSpeedKmh) : 3600 / runningPaces.easySecKm;
    const longMinutes = Math.max(
      goal.sport === 'cycling' ? 75 : 45,
      Math.min(goal.sport === 'cycling' ? 300 : 190, Math.round((plannedLongKm / longSpeedKmh) * 60))
    );

    workouts.push({
      dayLabel: longDay,
      title: goal.sport === 'cycling' ? `Lange Grundlagenfahrt (~${plannedLongKm} km) W${w + 1}` : `Langer GA1 Dauerlauf (~${plannedLongKm} km) W${w + 1}`,
      category: 'endurance',
      description:
        goal.sport === 'cycling'
          ? `Ausdauer-Schwerpunkt über ~${plannedLongKm} km (${(longMinutes / 60).toFixed(1)} Std) im strikten Fettstoffwechselbereich.`
          : `Fokus Fettstoffwechsel & orthopädische Robustheit über ${plannedLongKm} km (${formatPaceMinPerKm(runningPaces.easySecKm)}).`,
      rationale: `Fortschritt abgeleitet von deiner bisherigen längsten Einheit (${baselineLongKm.toFixed(1)} km, ≤ +12%/Woche).`,
      tss: longTss,
      estimatedDurationMin: longMinutes,
      targetDistanceKm: plannedLongKm,
      steps: [
        makeStep({ name: 'Einlaufen / Locker Start', durationMinutes: 10, ftpPct: 52, hrrLow: 0.52, hrrHigh: 0.60, paceSecKm: runningPaces.easySecKm + 15 }),
        makeStep({
          name: 'GA1 Dauerbereich (Z2)',
          durationMinutes: Math.max(30, longMinutes - 20),
          ftpPct: 65,
          hrrLow: 0.60,
          hrrHigh: 0.70,
          paceSecKm: runningPaces.easySecKm
        }),
        makeStep({ name: 'Cool-down', durationMinutes: 10, ftpPct: 50, hrrLow: 0.50, hrrHigh: 0.58, paceSecKm: runningPaces.easySecKm + 20 })
      ]
    });

    // Final Slot: Active Recovery / Easy Spin or Run
    const recDay = daySlots[daySlots.length - 1];
    const usedTss = workouts.reduce((s, item) => s + item.tss, 0);
    const remainingTss = Math.max(15, weekTss - usedTss);
    workouts.push({
      dayLabel: recDay,
      title: goal.sport === 'cycling' ? `Regeneratives Ausfahren W${w + 1}` : `Regenerativer Ausgleichslauf W${w + 1}`,
      category: 'recovery',
      description: 'Aktive Regeneration zur Senkung muskulärer Spannung und Vorbereitung auf die nächste Woche.',
      rationale: 'Fördert parasympathische Erholung (HRV / Ruhepuls).',
      tss: remainingTss,
      estimatedDurationMin: goal.sport === 'cycling' ? 45 : 30,
      steps: [
        makeStep({
          name: 'Aktive Erholung (Z1)',
          durationMinutes: goal.sport === 'cycling' ? 45 : 30,
          ftpPct: 48,
          hrrLow: 0.48,
          hrrHigh: 0.58,
          paceSecKm: runningPaces.easySecKm + 25
        })
      ]
    });

    const totalWeekMin = workouts.reduce((sum, wo) => sum + wo.estimatedDurationMin, 0);

    weeks.push({
      weekNumber: w + 1,
      phase,
      phaseDesc,
      targetTss: weekTss,
      estimatedHours: Number((totalWeekMin / 60).toFixed(1)),
      isDeload,
      vitalsAdapted: applyVitalsThisWeek,
      workouts
    });
  }

  return {
    assessment: {
      estDurationHours: Number(estDurationHours.toFixed(1)),
      estSpeedKmh: Number(estSpeedKmh.toFixed(1)),
      estPaceSecKm,
      estTss,
      targetCtl,
      ctlGap,
      weeklyTssTargetRange: [Math.max(100, weeklyTssTarget - 45), weeklyTssTarget + 45],
      readinessScore,
      userCtlLevel:
        userCtl < 35
          ? 'Einsteiger / Wiedereinstieg'
          : userCtl < 65
            ? 'Fortgeschritten'
            : 'Ambitioniert / Leistungssport',
      safeWeeklyCtlRamp,
      deloadRatioLabel,
      elevDensityMPerKm: Number(elevDensity.toFixed(1)),
      isHillyGoal
    },
    vitalsModulation,
    coachingSignals,
    resolvedSessionsPerWeek,
    effectiveFtp,
    effectiveRhr,
    useKarvonen,
    runningPaces,
    weeks
  };
}

export { formatRaceTime, formatPaceMinPerKm };
