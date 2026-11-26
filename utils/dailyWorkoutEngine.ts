import {
  PlannedWorkout,
  WorkoutStep,
  TrainingVitalsSnapshot,
  computeKarvonenBpmRange,
  computeRunningPaceTargets,
  formatPaceMinPerKm,
} from './trainingPlanEngine';
import { isCyclingType, isRunningType, isStopWatchType } from './gpxUtils';

export type DailySportChoice = 'auto' | 'running' | 'cycling';
export type DailyTimeBudgetMin = 'auto' | 30 | 45 | 60 | 90 | 120;
export type DailyFeelChoice = 'auto' | 'fresh' | 'normal' | 'tired';
export type DailyIntensityLevel = 'rest' | 'easy' | 'endurance' | 'threshold' | 'vo2max';

export interface DailyActivitySummary {
  date: string;
  type?: string;
  name?: string;
  distance?: number;
  duration?: number;
  ascent?: number;
  tss?: number;
  avg_hr?: number;
  ifScore?: number;
}

export interface DailyFactorAssessment {
  label: string;
  value: string;
  impact: 'positive' | 'neutral' | 'caution' | 'limit';
  detail: string;
}

export interface DailyWorkoutOption {
  label: string;
  sport: 'running' | 'cycling';
  intensityLevel: DailyIntensityLevel;
  zoneBadge: string;
  tone: 'slate' | 'sky' | 'emerald' | 'amber' | 'rose';
  estimatedRecoveryHours: number;
  workout: PlannedWorkout;
  targetIf: number;
  rpeRange: [number, number];
}

export interface DailyWorkoutInput {
  now?: Date;
  requestedSport: DailySportChoice;
  timeBudgetMin: DailyTimeBudgetMin;
  userFeel: DailyFeelChoice;
  useVitalsAdaptation: boolean;
  goal: {
    sport: 'running' | 'cycling';
    distanceKm: number;
    elevationM: number;
    phase?: string;
    isHillyGoal?: boolean;
  };
  athlete: {
    ftp: number;
    estimatedFtp?: number | null;
    weightKg: number;
    age: number;
    maxHr: number;
    rhrBaseline: number;
    estimatedVdot?: number | null;
    recentAvgRunningPaceSecKm?: number | null;
  };
  load: {
    ctl: number;
    atl: number;
    tsb: number;
    acwr: number;
    monotony?: number | null;
    z3GreyZonePct?: number;
  };
  recentActivities: DailyActivitySummary[];
  vitals?: TrainingVitalsSnapshot | null;
}

export interface DailyWorkoutRecommendation {
  resolvedSport: 'running' | 'cycling';
  sportReason: string;
  dailyReadinessScore: number;
  intensityLevel: DailyIntensityLevel;
  intensityLabel: string;
  zoneBadge: string;
  tone: 'slate' | 'sky' | 'emerald' | 'amber' | 'rose';
  rpeRange: [number, number];
  targetIf: number;
  estimatedRecoveryHours: number;
  headline: string;
  factors: DailyFactorAssessment[];
  recentSummary: {
    hoursSinceLastHardSession: number | null;
    yesterdayTss: number;
    last48hTss: number;
    consecutiveTrainingDays: number;
    last7dHardSessionCount: number;
    daysSinceLastSession: number | null;
  };
  primaryWorkout: PlannedWorkout;
  alternatives: DailyWorkoutOption[];
}

export interface StepVisualSegment {
  label: string;
  minutes: number;
  heightPct: number;
  colorClass: string;
  isRest: boolean;
}

const INTENSITY_ORDER: DailyIntensityLevel[] = ['rest', 'easy', 'endurance', 'threshold', 'vo2max'];

function clampIntensityCap(level: DailyIntensityLevel, cap: DailyIntensityLevel): DailyIntensityLevel {
  const idx = INTENSITY_ORDER.indexOf(level);
  const capIdx = INTENSITY_ORDER.indexOf(cap);
  return INTENSITY_ORDER[Math.min(idx, capIdx)];
}

function stepIntensityUp(level: DailyIntensityLevel): DailyIntensityLevel {
  const idx = INTENSITY_ORDER.indexOf(level);
  return INTENSITY_ORDER[Math.min(INTENSITY_ORDER.length - 1, idx + 1)];
}

function stepIntensityDown(level: DailyIntensityLevel, by = 1): DailyIntensityLevel {
  const idx = INTENSITY_ORDER.indexOf(level);
  return INTENSITY_ORDER[Math.max(0, idx - by)];
}

const LEVEL_META: Record<
  DailyIntensityLevel,
  {
    label: string;
    zoneBadge: string;
    tone: 'slate' | 'sky' | 'emerald' | 'amber' | 'rose';
    rpeRange: [number, number];
    targetIf: number;
    recoveryHours: number;
    defaultDurationMin: { running: number; cycling: number };
  }
> = {
  rest: {
    label: 'Ruhetag / Aktive Erholung',
    zoneBadge: 'Z1 · Regenerativ',
    tone: 'rose',
    rpeRange: [1, 2],
    targetIf: 0.52,
    recoveryHours: 8,
    defaultDurationMin: { running: 25, cycling: 30 },
  },
  easy: {
    label: 'Locker / Erholungslauf/-fahrt',
    zoneBadge: 'Z1–Z2 · Locker',
    tone: 'sky',
    rpeRange: [3, 4],
    targetIf: 0.64,
    recoveryHours: 14,
    defaultDurationMin: { running: 35, cycling: 45 },
  },
  endurance: {
    label: 'Aerobe Grundlage (GA1)',
    zoneBadge: 'Z2 · Ausdauer',
    tone: 'emerald',
    rpeRange: [4, 5],
    targetIf: 0.72,
    recoveryHours: 20,
    defaultDurationMin: { running: 50, cycling: 70 },
  },
  threshold: {
    label: 'Tempo / Schwelle (GA2–EB)',
    zoneBadge: 'Z3–Z4 · Schwelle',
    tone: 'amber',
    rpeRange: [6, 7],
    targetIf: 0.86,
    recoveryHours: 32,
    defaultDurationMin: { running: 50, cycling: 65 },
  },
  vo2max: {
    label: 'Hochintensiv / VO2max-Reiz',
    zoneBadge: 'Z5 · VO2max',
    tone: 'amber',
    rpeRange: [8, 9],
    targetIf: 0.94,
    recoveryHours: 42,
    defaultDurationMin: { running: 48, cycling: 60 },
  },
};

function toLocalDayKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function computeTotalWorkoutMinutes(steps: WorkoutStep[]): number {
  return Math.round(
    steps.reduce((sum, st) => {
      const reps = st.reps && st.reps > 1 ? st.reps : 1;
      const workMin = st.durationMinutes * reps;
      const restMin = st.restDurationMinutes && reps > 1 ? st.restDurationMinutes * (reps - 1) : 0;
      return sum + workMin + restMin;
    }, 0)
  );
}

function buildDailyWorkout(params: {
  sport: 'running' | 'cycling';
  level: DailyIntensityLevel;
  timeBudgetMin: DailyTimeBudgetMin;
  effectiveFtp: number;
  maxHr: number;
  effectiveRhr: number;
  runningPaces: ReturnType<typeof computeRunningPaceTargets>;
  estSpeedKmh: number;
  isHillyGoal: boolean;
  headlineReason: string;
}): PlannedWorkout {
  const {
    sport,
    level,
    timeBudgetMin,
    effectiveFtp,
    maxHr,
    effectiveRhr,
    runningPaces,
    estSpeedKmh,
    isHillyGoal,
    headlineReason,
  } = params;

  const meta = LEVEL_META[level];
  const targetTotalMin =
    timeBudgetMin === 'auto' ? meta.defaultDurationMin[sport] : Math.max(20, Math.min(180, timeBudgetMin));

  const makeStep = (cfg: {
    name: string;
    durationMinutes: number;
    reps?: number;
    restDurationMinutes?: number;
    ftpPct?: number;
    hrrLow: number;
    hrrHigh: number;
    paceSecKm?: number;
  }): WorkoutStep => {
    const hrr = computeKarvonenBpmRange(cfg.hrrLow, cfg.hrrHigh, maxHr, effectiveRhr);
    const midHrrPct = Math.round(((cfg.hrrLow + cfg.hrrHigh) / 2) * 100);
    const wattsMid = cfg.ftpPct ? Math.round((effectiveFtp * cfg.ftpPct) / 100) : undefined;
    const wattsRange: [number, number] | undefined = wattsMid
      ? [Math.round(wattsMid * 0.94), Math.round(wattsMid * 1.06)]
      : undefined;
    const paceRange: [number, number] | undefined = cfg.paceSecKm
      ? [Math.max(170, Math.round(cfg.paceSecKm * 0.97)), Math.round(cfg.paceSecKm * 1.04)]
      : undefined;

    return {
      name: cfg.name,
      durationMinutes: Math.max(1, Math.round(cfg.durationMinutes * 10) / 10),
      reps: cfg.reps,
      restDurationMinutes: cfg.restDurationMinutes,
      targetFtpPercent: cfg.ftpPct,
      targetWattsRange: wattsRange,
      targetHrrPercent: midHrrPct,
      targetHrPercent: Math.round((hrr.midBpm / Math.max(1, maxHr)) * 100),
      targetHrBpmRange: [hrr.lowBpm, hrr.highBpm],
      targetPaceRangeSecKm: paceRange,
    };
  };

  let steps: WorkoutStep[] = [];
  let title = '';
  let category: PlannedWorkout['category'] = 'endurance';
  let description = '';

  const warmupMin = targetTotalMin <= 35 ? 6 : targetTotalMin <= 50 ? 10 : 12;
  const cooldownMin = targetTotalMin <= 35 ? 5 : 8;
  const mainBudget = Math.max(10, targetTotalMin - warmupMin - cooldownMin);

  if (level === 'rest') {
    category = 'recovery';
    const flushMin = Math.min(40, targetTotalMin);
    title =
      sport === 'cycling'
        ? `Aktive Z1-Erholungsfahrt (${flushMin} Min)`
        : `Regenerations-Spaziergang / Lockerer Z1-Jog (${flushMin} Min)`;
    description =
      'Vollständiger Ruhetag empfohlen — falls du dich bewegen möchtest, maximal sehr lockere Durchblutung im tiefen Z1 ohne Laktat- oder Sehnenstress.';
    steps = [
      makeStep({
        name: 'Aktive Z1 Erholung (oder Pause)',
        durationMinutes: flushMin,
        ftpPct: 48,
        hrrLow: 0.45,
        hrrHigh: 0.56,
        paceSecKm: runningPaces.easySecKm + 30,
      }),
    ];
  } else if (level === 'easy') {
    category = 'recovery';
    title =
      sport === 'cycling'
        ? `Lockere GA1-Regenerationsrunde (${targetTotalMin} Min)`
        : `Lockerer Erholungslauf (${targetTotalMin} Min)`;
    description =
      'Durchblutungsfördernde Bewegung unterhalb der aeroben Schwelle zur Beschleunigung der Erholung nach vorangegangener Belastung.';
    steps = [
      makeStep({
        name: 'Einrollen / Einlaufen (Z1)',
        durationMinutes: warmupMin,
        ftpPct: 52,
        hrrLow: 0.50,
        hrrHigh: 0.58,
        paceSecKm: runningPaces.easySecKm + 20,
      }),
      makeStep({
        name: 'Lockeres Grundtempo (Z1–Z2)',
        durationMinutes: mainBudget,
        ftpPct: 60,
        hrrLow: 0.56,
        hrrHigh: 0.65,
        paceSecKm: runningPaces.easySecKm + 10,
      }),
      makeStep({
        name: 'Ausfahren / Auslaufen',
        durationMinutes: cooldownMin,
        ftpPct: 48,
        hrrLow: 0.48,
        hrrHigh: 0.56,
        paceSecKm: runningPaces.easySecKm + 25,
      }),
    ];
  } else if (level === 'endurance') {
    category = 'endurance';
    title =
      sport === 'cycling'
        ? `Stabile GA1 Grundlagenfahrt (${targetTotalMin} Min)`
        : `Ruhiger GA1 Ausdauerlauf (${targetTotalMin} Min)`;
    description =
      'Strikter Fettstoffwechsel- und Kapillarisierungsreiz im sauberen Zone-2-Korridor — keine Grey-Zone-Beschleunigungen an Anstiegen.';
    steps = [
      makeStep({
        name: 'Warm-up (Z1–Z2)',
        durationMinutes: warmupMin,
        ftpPct: 56,
        hrrLow: 0.54,
        hrrHigh: 0.63,
        paceSecKm: runningPaces.easySecKm + 15,
      }),
      makeStep({
        name: 'Aerobe Grundlage GA1 (Z2)',
        durationMinutes: mainBudget,
        ftpPct: 67,
        hrrLow: 0.62,
        hrrHigh: 0.71,
        paceSecKm: runningPaces.easySecKm,
      }),
      makeStep({
        name: 'Cool-down (Z1)',
        durationMinutes: cooldownMin,
        ftpPct: 50,
        hrrLow: 0.50,
        hrrHigh: 0.58,
        paceSecKm: runningPaces.easySecKm + 20,
      }),
    ];
  } else if (level === 'threshold') {
    if (sport === 'cycling' && isHillyGoal) {
      category = 'climbing';
      const cycleUnit = 11; // 7m work + 4m rest
      const reps = Math.max(2, Math.min(5, Math.floor((mainBudget + 4) / cycleUnit)));
      const workMin = Math.max(5, Math.min(12, Math.floor((mainBudget - (reps - 1) * 3) / reps)));
      title = `Berg-Sweet-Spot & Drehmoment ${reps}×${workMin}m`;
      description = `Zielspezifische Sweet-Spot-Blöcke (86–92% FTP, 65–75 rpm am Berg) passend zu deinem heutigen Belastungsbudget.`;
      steps = [
        makeStep({
          name: 'Warm-up (GA1)',
          durationMinutes: warmupMin,
          ftpPct: 58,
          hrrLow: 0.56,
          hrrHigh: 0.65,
        }),
        makeStep({
          name: 'Berg-Sweet-Spot (70 rpm)',
          durationMinutes: workMin,
          reps,
          restDurationMinutes: 3,
          ftpPct: 89,
          hrrLow: 0.76,
          hrrHigh: 0.85,
        }),
        makeStep({
          name: 'Ausfahren (Z1)',
          durationMinutes: cooldownMin,
          ftpPct: 52,
          hrrLow: 0.50,
          hrrHigh: 0.59,
        }),
      ];
    } else if (sport === 'cycling') {
      category = 'threshold';
      const reps = targetTotalMin >= 75 ? 3 : 2;
      const restMin = 4;
      const workMin = Math.max(6, Math.min(18, Math.floor((mainBudget - (reps - 1) * restMin) / reps)));
      title = `Sweet-Spot / Schwellenblock ${reps}×${workMin}m`;
      description = `Gezielter Laktatschwellen-Ausbau bei 88–94% FTP (${effectiveFtp} W Basis) mit kontrollierten Trab-/Rollpausen.`;
      steps = [
        makeStep({
          name: 'Warm-up (GA1 Progressiv)',
          durationMinutes: warmupMin,
          ftpPct: 60,
          hrrLow: 0.56,
          hrrHigh: 0.66,
        }),
        makeStep({
          name: 'Sweet-Spot / Schwelle',
          durationMinutes: workMin,
          reps,
          restDurationMinutes: restMin,
          ftpPct: 91,
          hrrLow: 0.78,
          hrrHigh: 0.86,
        }),
        makeStep({
          name: 'Cool-down (Z1)',
          durationMinutes: cooldownMin,
          ftpPct: 52,
          hrrLow: 0.50,
          hrrHigh: 0.58,
        }),
      ];
    } else {
      category = 'threshold';
      const reps = targetTotalMin >= 60 ? 4 : targetTotalMin >= 42 ? 3 : 2;
      const restMin = 2.5;
      const workMin = Math.max(4, Math.min(10, Math.floor((mainBudget - (reps - 1) * restMin) / reps)));
      title = `Schwellen-Tempodauerlauf ${reps}×${workMin}m`;
      description = `Sauberes Schwellentempo (${formatPaceMinPerKm(runningPaces.thresholdSecKm)}, ${runningPaces.sourceLabel}) zur Steigerung der Laktat-Clearance.`;
      steps = [
        makeStep({
          name: 'Einlaufen (GA1)',
          durationMinutes: warmupMin,
          hrrLow: 0.56,
          hrrHigh: 0.66,
          paceSecKm: runningPaces.easySecKm,
        }),
        makeStep({
          name: 'Schwellenblock (Z4)',
          durationMinutes: workMin,
          reps,
          restDurationMinutes: restMin,
          hrrLow: 0.79,
          hrrHigh: 0.87,
          paceSecKm: runningPaces.thresholdSecKm,
        }),
        makeStep({
          name: 'Auslaufen (Locker)',
          durationMinutes: cooldownMin,
          hrrLow: 0.52,
          hrrHigh: 0.60,
          paceSecKm: runningPaces.easySecKm + 15,
        }),
      ];
    }
  } else {
    // vo2max
    category = 'intensity';
    if (sport === 'cycling') {
      const restMin = 3;
      const workMin = targetTotalMin <= 38 ? 3 : 4;
      const reps = Math.max(3, Math.min(6, Math.floor((mainBudget + restMin) / (workMin + restMin))));
      title = `VO2max Power-Intervalle ${reps}×${workMin}m`;
      description = `Maximale Sauerstoffaufnahme-Steigerung bei 110–118% FTP — grüne Vitalwerte und ausreichend Erholung seit der letzten harten Einheit liegen vor.`;
      steps = [
        makeStep({
          name: 'Warm-up + 2×20s Antritte',
          durationMinutes: warmupMin,
          ftpPct: 60,
          hrrLow: 0.56,
          hrrHigh: 0.67,
        }),
        makeStep({
          name: 'VO2max Intervall (114% FTP)',
          durationMinutes: workMin,
          reps,
          restDurationMinutes: restMin,
          ftpPct: 114,
          hrrLow: 0.86,
          hrrHigh: 0.94,
        }),
        makeStep({
          name: 'Cool-down (Z1)',
          durationMinutes: cooldownMin,
          ftpPct: 50,
          hrrLow: 0.50,
          hrrHigh: 0.58,
        }),
      ];
    } else {
      const restMin = 2.5;
      const workMin = targetTotalMin <= 38 ? 2 : 3;
      const reps = Math.max(3, Math.min(6, Math.floor((mainBudget + restMin) / (workMin + restMin))));
      title = `VO2max Intervalltraining ${reps}×${workMin}m`;
      description = `Schnelle aerobe Spitzenreize im VDOT-Intervalltempo (${formatPaceMinPerKm(runningPaces.intervalSecKm)}) mit Trabpausen.`;
      steps = [
        makeStep({
          name: 'Einlaufen + Lauf-ABC',
          durationMinutes: warmupMin,
          hrrLow: 0.56,
          hrrHigh: 0.66,
          paceSecKm: runningPaces.easySecKm,
        }),
        makeStep({
          name: 'VO2max Intervall (Z5)',
          durationMinutes: workMin,
          reps,
          restDurationMinutes: restMin,
          hrrLow: 0.87,
          hrrHigh: 0.95,
          paceSecKm: runningPaces.intervalSecKm,
        }),
        makeStep({
          name: 'Auslaufen',
          durationMinutes: cooldownMin,
          hrrLow: 0.52,
          hrrHigh: 0.60,
          paceSecKm: runningPaces.easySecKm + 20,
        }),
      ];
    }
  }

  const totalBeforePad = computeTotalWorkoutMinutes(steps);
  if (timeBudgetMin !== 'auto' && level !== 'rest' && targetTotalMin - totalBeforePad >= 8) {
    const extraAerobMin = Math.round(targetTotalMin - totalBeforePad);
    const coolIdx = Math.max(1, steps.length - 1);
    const aerobPad = makeStep({
      name: sport === 'cycling' ? 'Aerobe GA1-Verlängerung (Z2)' : 'Ruhiges GA1-Auslaufen (Z2)',
      durationMinutes: extraAerobMin,
      ftpPct: 65,
      hrrLow: 0.60,
      hrrHigh: 0.70,
      paceSecKm: runningPaces.easySecKm,
    });
    steps.splice(coolIdx, 0, aerobPad);
  }

  const totalMin = Math.max(15, computeTotalWorkoutMinutes(steps));
  const tss = Math.max(12, Math.round((totalMin / 60) * meta.targetIf * meta.targetIf * 100));
  const estWorkoutSpeed =
    sport === 'cycling'
      ? Math.max(16, estSpeedKmh * (level === 'threshold' || level === 'vo2max' ? 1.03 : 0.9))
      : 3600 / (level === 'threshold' ? runningPaces.thresholdSecKm : runningPaces.easySecKm);
  const targetDistanceKm = Number(((totalMin / 60) * estWorkoutSpeed).toFixed(1));

  return {
    dayLabel: 'Heute',
    title,
    category,
    description,
    rationale: headlineReason,
    tss,
    estimatedDurationMin: totalMin,
    targetDistanceKm: level === 'rest' ? undefined : targetDistanceKm,
    steps,
  };
}

export function getWorkoutStepVisuals(
  workout: PlannedWorkout,
  sport: 'running' | 'cycling',
  ftp: number,
  maxHr: number,
  rhr: number
): StepVisualSegment[] {
  const segments: StepVisualSegment[] = [];
  const safeFtp = Math.max(80, ftp || 250);
  const safeMaxHr = Math.max(120, maxHr || 185);
  const safeRhr = Math.max(35, Math.min(safeMaxHr - 30, rhr || 55));

  const classifyPctToStyle = (intensityNorm: number, isRest: boolean): { heightPct: number; colorClass: string } => {
    if (isRest || intensityNorm < 0.58) return { heightPct: 28, colorClass: 'bg-sky-400 dark:bg-sky-500' };
    if (intensityNorm < 0.72) return { heightPct: 48, colorClass: 'bg-emerald-500' };
    if (intensityNorm < 0.85) return { heightPct: 68, colorClass: 'bg-amber-400 dark:bg-amber-500' };
    if (intensityNorm < 0.98) return { heightPct: 86, colorClass: 'bg-orange-500' };
    return { heightPct: 100, colorClass: 'bg-rose-500' };
  };

  const getNormIntensity = (step: WorkoutStep): number => {
    if (sport === 'cycling' && (step.targetFtpPercent || step.targetWattsRange)) {
      const pct = step.targetFtpPercent
        ? step.targetFtpPercent / 100
        : ((step.targetWattsRange![0] + step.targetWattsRange![1]) / 2) / safeFtp;
      return Math.max(0.4, Math.min(1.25, pct));
    }
    if (step.targetHrrPercent) return step.targetHrrPercent / 100;
    if (step.targetHrBpmRange) {
      const mid = (step.targetHrBpmRange[0] + step.targetHrBpmRange[1]) / 2;
      return (mid - safeRhr) / Math.max(30, safeMaxHr - safeRhr);
    }
    if (step.targetHrPercent) return step.targetHrPercent / 100;
    return 0.65;
  };

  for (const step of workout.steps) {
    const reps = step.reps && step.reps > 1 ? step.reps : 1;
    const norm = getNormIntensity(step);
    const visual = classifyPctToStyle(norm, step.name.toLowerCase().includes('erhol'));
    if (reps > 1) {
      for (let r = 0; r < reps; r++) {
        segments.push({
          label: `${step.name} ${r + 1}/${reps}`,
          minutes: step.durationMinutes,
          ...visual,
          isRest: false,
        });
        if (step.restDurationMinutes && step.restDurationMinutes > 0 && r < reps - 1) {
          segments.push({
            label: 'Pause (Z1)',
            minutes: step.restDurationMinutes,
            heightPct: 24,
            colorClass: 'bg-slate-300 dark:bg-slate-600',
            isRest: true,
          });
        }
      }
    } else {
      segments.push({
        label: step.name,
        minutes: step.durationMinutes,
        ...visual,
        isRest: step.name.toLowerCase().includes('pause') || step.name.toLowerCase().includes('erhol'),
      });
    }
  }

  return segments;
}

export function suggestDailyWorkout(input: DailyWorkoutInput): DailyWorkoutRecommendation {
  const now = input.now ? new Date(input.now) : new Date();
  const nowMs = now.getTime();
  const { goal, athlete, load, recentActivities, vitals, useVitalsAdaptation } = input;

  const safeWeight = Math.max(35, Number(athlete.weightKg) || 75);
  const safeMaxHr = Math.max(110, Math.round(athlete.maxHr || 185));
  const safeRhr = Math.max(35, Math.min(Math.max(45, safeMaxHr - 35), Math.round(athlete.rhrBaseline || 55)));
  const effectiveFtp = Math.max(80, Math.round(athlete.ftp > 0 ? athlete.ftp : athlete.estimatedFtp || 220));
  const runningPaces = computeRunningPaceTargets(athlete.estimatedVdot, athlete.recentAvgRunningPaceSecKm);

  const elevDensity = goal.distanceKm > 0 ? goal.elevationM / goal.distanceKm : 0;
  const isHillyGoal = goal.isHillyGoal ?? (elevDensity >= 15 || goal.elevationM >= 1200);
  const estSpeedKmh = Math.max(18, Math.min(34, 17 + (effectiveFtp / safeWeight) * 3.6 - elevDensity * 0.25));

  // 1. Inspect recent 14 days of activities
  const validRecent = (recentActivities || [])
    .filter((a) => a && a.date && !isStopWatchType(a.type))
    .map((a) => {
      const ts = new Date(a.date).getTime();
      return { ...a, ts };
    })
    .filter((a) => Number.isFinite(a.ts) && a.ts <= nowMs + 6 * 3600 * 1000 && nowMs - a.ts <= 14 * 86400 * 1000)
    .sort((a, b) => b.ts - a.ts);

  const isHardActivity = (a: (typeof validRecent)[number]): boolean => {
    const tssVal = Number(a.tss || 0);
    const ifVal = Number(a.ifScore || 0);
    const hrVal = Number(a.avg_hr || 0);
    const hrrRatio = hrVal > 0 ? (hrVal - safeRhr) / Math.max(30, safeMaxHr - safeRhr) : 0;
    return tssVal >= 85 || ifVal >= 0.84 || (hrrRatio >= 0.80 && Number(a.duration || 0) >= 1800);
  };

  let hoursSinceLastHardSession: number | null = null;
  let lastHardIsRun = false;
  let yesterdayTss = 0;
  let last48hTss = 0;
  let last7dHardSessionCount = 0;
  let last7dRunSessions = 0;
  let last7dBikeSessions = 0;
  let last4dRunSessions = 0;
  let daysSinceLastSession: number | null = null;

  const todayKey = toLocalDayKey(now);
  const yesterdayDate = new Date(nowMs - 86400 * 1000);
  const yesterdayKey = toLocalDayKey(yesterdayDate);
  const activeDayKeys = new Set<string>();

  for (const act of validRecent) {
    const diffHours = Math.max(0, (nowMs - act.ts) / 3600000);
    const dayKey = toLocalDayKey(new Date(act.ts));
    activeDayKeys.add(dayKey);

    if (daysSinceLastSession === null) {
      daysSinceLastSession = Number((diffHours / 24).toFixed(1));
    }

    const actTss = Number(act.tss || 0) > 0 ? Number(act.tss) : Math.round((Number(act.duration || 0) / 3600) * 52);
    if (dayKey === yesterdayKey || (diffHours >= 10 && diffHours <= 34)) {
      yesterdayTss += actTss;
    }
    if (diffHours <= 48) {
      last48hTss += actTss;
    }

    const isRun = isRunningType(act.type, act.name);
    const isBike = isCyclingType(act.type, act.name);

    if (diffHours <= 7 * 24) {
      if (isRun) last7dRunSessions++;
      if (isBike) last7dBikeSessions++;
      if (isHardActivity(act)) last7dHardSessionCount++;
    }
    if (diffHours <= 4 * 24 && isRun) {
      last4dRunSessions++;
    }
    if (hoursSinceLastHardSession === null && isHardActivity(act)) {
      hoursSinceLastHardSession = Math.round(diffHours);
      lastHardIsRun = isRun;
    }
  }

  yesterdayTss = Math.round(yesterdayTss);
  last48hTss = Math.round(last48hTss);

  let consecutiveTrainingDays = 0;
  for (let dOffset = activeDayKeys.has(todayKey) ? 0 : 1; dOffset <= 14; dOffset++) {
    const checkKey = toLocalDayKey(new Date(nowMs - dOffset * 86400 * 1000));
    if (activeDayKeys.has(checkKey)) {
      consecutiveTrainingDays++;
    } else {
      break;
    }
  }

  // 2. Resolve Sport (Run vs Bike vs Smart Cross-Training)
  let resolvedSport: 'running' | 'cycling' = goal.sport;
  let sportReason = '';

  if (input.requestedSport !== 'auto') {
    resolvedSport = input.requestedSport;
    sportReason =
      resolvedSport === 'running'
        ? 'Manuell gewählt: Lauftraining auf VDOT- & Karvonen-Basis.'
        : 'Manuell gewählt: Radtraining auf FTP- & Karvonen-Basis.';
  } else {
    const canBikeCrossTrain = last7dBikeSessions > 0 || athlete.ftp > 0;
    if (goal.sport === 'running' && canBikeCrossTrain && ((lastHardIsRun && hoursSinceLastHardSession !== null && hoursSinceLastHardSession < 36) || last4dRunSessions >= 3)) {
      resolvedSport = 'cycling';
      sportReason =
        'Auto Cross-Training: Nach jüngster Laufbelastung schont lockeres/aerobes Radfahren Sehnen & Gelenke bei weiterem Herz-Kreislauf-Reiz.';
    } else if (goal.sport === 'cycling' && last7dRunSessions > 0 && last7dBikeSessions === 0 && athlete.estimatedVdot) {
      resolvedSport = 'running';
      sportReason = 'Auto-Auswahl anhand deiner dominierenden Laufaktivitäten der letzten 7 Tage.';
    } else {
      resolvedSport = goal.sport;
      sportReason = `Abgestimmt auf dein aktives Ziel (${goal.sport === 'running' ? 'Laufen' : 'Radsport'}).`;
    }
  }

  // 3. Score + Transparent Factors + Intensity Cap
  const factors: DailyFactorAssessment[] = [];
  let score = vitals?.readinessScore ?? (load.tsb >= 5 ? 84 : load.tsb >= -10 ? 78 : 64);
  let hardCap: DailyIntensityLevel = 'vo2max';
  const limitReasons: string[] = [];

  // Factor A: Vitals (last night / today + 7d baseline)
  if (useVitalsAdaptation && vitals) {
    const sleepNight = vitals.sleepHoursLatest ?? vitals.sleepHoursAvg7d;
    const rhrDelta = vitals.rhrTodayDelta ?? vitals.rhr7dDelta;
    const stressVal = vitals.stressLatest ?? vitals.stressAvg7d;

    if (sleepNight !== null && sleepNight !== undefined) {
      if (sleepNight < 5.5) {
        score -= 26;
        hardCap = clampIntensityCap(hardCap, 'rest');
        limitReasons.push(`Schlaf (${sleepNight.toFixed(1)} h) kritisch`);
        factors.push({
          label: 'Schlaf (letzte Nacht / 7d)',
          value: `${sleepNight.toFixed(1)} h`,
          impact: 'limit',
          detail: 'Unter 5.5 h Schlaf — hohe Infekt-/Verletzungsgefahr bei Intensität.',
        });
      } else if (sleepNight < 6.4) {
        score -= 12;
        hardCap = clampIntensityCap(hardCap, 'endurance');
        limitReasons.push(`Kurzer Schlaf (${sleepNight.toFixed(1)} h)`);
        factors.push({
          label: 'Schlaf (letzte Nacht / 7d)',
          value: `${sleepNight.toFixed(1)} h`,
          impact: 'caution',
          detail: 'Verkürzter Schlaf dämpft intensive Intervalle.',
        });
      } else {
        score += sleepNight >= 7.6 ? 6 : 0;
        factors.push({
          label: 'Schlaf',
          value: `${sleepNight.toFixed(1)} h`,
          impact: sleepNight >= 7.5 ? 'positive' : 'neutral',
          detail: 'Ausreichende Schlafdauer für heutige Trainingsreize.',
        });
      }
    }

    if (rhrDelta !== null && rhrDelta !== undefined) {
      if (rhrDelta >= 4.5) {
        score -= 24;
        hardCap = clampIntensityCap(hardCap, 'rest');
        limitReasons.push(`Ruhepuls +${rhrDelta.toFixed(1)} bpm`);
        factors.push({
          label: 'Ruhepuls vs. Baseline',
          value: `+${rhrDelta.toFixed(1)} bpm`,
          impact: 'limit',
          detail: 'Deutlicher vegetativer Anstieg — Ruhetag oder nur Z1 sinnvoll.',
        });
      } else if (rhrDelta >= 2.2) {
        score -= 10;
        hardCap = clampIntensityCap(hardCap, 'endurance');
        factors.push({
          label: 'Ruhepuls vs. Baseline',
          value: `+${rhrDelta.toFixed(1)} bpm`,
          impact: 'caution',
          detail: 'Leicht erhöhter Ruhepuls: heute maximal aerobe Z2/Z1-Last.',
        });
      } else {
        score += rhrDelta <= -0.5 ? 4 : 0;
        factors.push({
          label: 'Ruhepuls vs. Baseline',
          value: `${rhrDelta >= 0 ? '+' : ''}${rhrDelta.toFixed(1)} bpm`,
          impact: rhrDelta <= 0.5 ? 'positive' : 'neutral',
          detail: 'Vegetatives System stabil im Normbereich.',
        });
      }
    }

    if (stressVal !== null && stressVal !== undefined && stressVal > 58) {
      score -= 10;
      hardCap = clampIntensityCap(hardCap, 'easy');
      factors.push({
        label: 'Alltagsstress',
        value: `${Math.round(stressVal)}/100`,
        impact: 'caution',
        detail: 'Hoher Stress reduziert die Stress-Toleranz für Schwellenreize.',
      });
    }
  } else {
    factors.push({
      label: 'Vitaldaten',
      value: useVitalsAdaptation ? 'Keine Daten' : 'Manuell aus',
      impact: 'neutral',
      detail: useVitalsAdaptation
        ? 'Steuerung erfolgt primär über Trainingslast & Aktivitätshistorie.'
        : 'Vitaldaten-Bremse deaktiviert.',
    });
  }

  // Factor B: Longitudinal ACWR & TSB
  if (load.acwr > 1.48 || load.tsb < -25) {
    score -= 25;
    hardCap = clampIntensityCap(hardCap, 'rest');
    limitReasons.push(load.acwr > 1.48 ? `ACWR ${load.acwr.toFixed(2)}` : `TSB ${load.tsb}`);
    factors.push({
      label: 'Belastungs-Ratio (ACWR / TSB)',
      value: `${load.acwr.toFixed(2)} / TSB ${load.tsb}`,
      impact: 'limit',
      detail: 'Akute Überlastung — dringende Entlastung zur Vermeidung von Übertraining.',
    });
  } else if (load.acwr > 1.30 || load.tsb < -14) {
    score -= 12;
    hardCap = clampIntensityCap(hardCap, 'easy');
    limitReasons.push(`Ermüdungsbilanz (ACWR ${load.acwr.toFixed(2)}, TSB ${load.tsb})`);
    factors.push({
      label: 'Belastungs-Ratio (ACWR / TSB)',
      value: `${load.acwr.toFixed(2)} / TSB ${load.tsb}`,
      impact: 'caution',
      detail: 'Erhöhte akute Ermüdung: heute lockeres aerobes Training.',
    });
  } else {
    if (load.tsb >= 0 && load.acwr >= 0.8 && load.acwr <= 1.25) score += 6;
    factors.push({
      label: 'Belastungs-Ratio (ACWR / TSB)',
      value: `${load.acwr.toFixed(2)} / TSB ${load.tsb}`,
      impact: load.tsb >= -6 ? 'positive' : 'neutral',
      detail: 'Trainingslast im produktiven Sweet-Spot-Korridor.',
    });
  }

  // Factor C: Recent 48h & Hard Session Spacing
  if (hoursSinceLastHardSession !== null && hoursSinceLastHardSession < 36) {
    score -= 14;
    hardCap = clampIntensityCap(hardCap, 'easy');
    limitReasons.push(`Harte Einheit vor ${hoursSinceLastHardSession} h`);
    factors.push({
      label: 'Erholung seit letztem Hartreiz',
      value: `${hoursSinceLastHardSession} h`,
      impact: 'limit',
      detail: 'Keine Back-to-Back-Intervalle unter 36–48 h Regeneration.',
    });
  } else if (yesterdayTss >= 95 || last48hTss >= 175) {
    score -= 10;
    hardCap = clampIntensityCap(hardCap, 'endurance');
    limitReasons.push(`Vorlast ${yesterdayTss} TSS gestern`);
    factors.push({
      label: '48h-Vorbelastung',
      value: `${yesterdayTss} TSS gestern / ${last48hTss} TSS (48h)`,
      impact: 'caution',
      detail: 'Gestrige hohe Umfangslast — heute kontrollierte Z2-Grundlage ohne Druck.',
    });
  } else {
    factors.push({
      label: 'Abstand zur letzten harten Einheit',
      value: hoursSinceLastHardSession !== null ? `${hoursSinceLastHardSession} h` : 'Frisch (>14d)',
      impact: 'positive',
      detail: 'Muskulär & metabolisch wieder bereit für gezielte Reize.',
    });
  }

  // Factor D: Consecutive training streak & weekly polarization
  if (consecutiveTrainingDays >= 6) {
    score -= 16;
    hardCap = clampIntensityCap(hardCap, 'rest');
    limitReasons.push(`${consecutiveTrainingDays} Trainingstage am Stück`);
    factors.push({
      label: 'Trainingsserie',
      value: `${consecutiveTrainingDays} Tage in Folge`,
      impact: 'limit',
      detail: 'Mindestens 1 Ruhe- oder aktiver Regenerationstag pro Woche einhalten.',
    });
  } else if (last7dHardSessionCount >= 2 || (load.monotony ?? 0) > 2.0) {
    hardCap = clampIntensityCap(hardCap, 'endurance');
    factors.push({
      label: 'Wochen-Polarisierung (7d)',
      value: `${last7dHardSessionCount} harte Einheiten`,
      impact: 'caution',
      detail: '80/20-Regel schützt dich heute vor einer 3. intensiven Einheit in 7 Tagen.',
    });
  } else if ((load.z3GreyZonePct ?? 0) >= 35) {
    factors.push({
      label: 'Polarisierungs-Balance',
      value: `${load.z3GreyZonePct}% Grey-Zone (Z3)`,
      impact: 'caution',
      detail: 'Achte bei lockeren Tagen streng auf Zone 1/2 (<75% FTP / <70% HRR).',
    });
  }

  if (athlete.age >= 50) {
    // Masters recovery spacing guard after >=85 TSS within 48h
    if (hoursSinceLastHardSession !== null && hoursSinceLastHardSession < 48) {
      hardCap = clampIntensityCap(hardCap, 'endurance');
    }
  }

  const dailyReadinessScore = Math.max(15, Math.min(99, Math.round(score)));

  // Determine base intensity from score
  let level: DailyIntensityLevel;
  if (dailyReadinessScore < 46) level = 'rest';
  else if (dailyReadinessScore < 62) level = 'easy';
  else if (dailyReadinessScore < 76) level = 'endurance';
  else if (dailyReadinessScore < 88) level = 'threshold';
  else level = 'vo2max';

  // Honor safety hardCap
  level = clampIntensityCap(level, hardCap);

  // User subjective feel adjustment
  if (input.userFeel === 'tired') {
    level = clampIntensityCap(stepIntensityDown(level, 1), 'easy');
    factors.push({
      label: 'Tagesgefühl',
      value: 'Müde / Schwer',
      impact: 'caution',
      detail: 'Subjektives Feedback senkt die heutige Zielintensität auf maximal Locker (Z1–Z2).',
    });
  } else if (input.userFeel === 'fresh') {
    // Only boost if hardCap permits
    const nudged = stepIntensityUp(level);
    level = clampIntensityCap(nudged, hardCap);
    factors.push({
      label: 'Tagesgefühl',
      value: 'Frisch / Bereit',
      impact: 'positive',
      detail: 'Nutzt die volle physiologisch sichere Trainingsfreigabe.',
    });
  }

  const meta = LEVEL_META[level];
  const headlineReason =
    limitReasons.length > 0
      ? `Steuerung über: ${limitReasons.slice(0, 2).join(' · ')}.`
      : `Readiness ${dailyReadinessScore}/100, TSB ${load.tsb} & ${
          hoursSinceLastHardSession !== null ? `${hoursSinceLastHardSession} h seit Hartreiz` : 'frische Beine'
        } erlauben ${meta.zoneBadge}.`;

  const primaryWorkout = buildDailyWorkout({
    sport: resolvedSport,
    level,
    timeBudgetMin: input.timeBudgetMin,
    effectiveFtp,
    maxHr: safeMaxHr,
    effectiveRhr: safeRhr,
    runningPaces,
    estSpeedKmh,
    isHillyGoal,
    headlineReason,
  });

  // Build helpful 1-click alternatives
  const alternatives: DailyWorkoutOption[] = [];

  // Alt 1: Gentler or compact alternative
  const gentlerLevel: DailyIntensityLevel =
    level === 'vo2max' || level === 'threshold' ? 'endurance' : level === 'endurance' ? 'easy' : 'rest';
  if (gentlerLevel !== level || input.timeBudgetMin === 'auto') {
    const altLevel = gentlerLevel === level ? 'easy' : gentlerLevel;
    const altMeta = LEVEL_META[altLevel];
    alternatives.push({
      label: `Sanftere Option: ${altMeta.zoneBadge}`,
      sport: resolvedSport,
      intensityLevel: altLevel,
      zoneBadge: altMeta.zoneBadge,
      tone: altMeta.tone,
      estimatedRecoveryHours: altMeta.recoveryHours,
      targetIf: altMeta.targetIf,
      rpeRange: altMeta.rpeRange,
      workout: buildDailyWorkout({
        sport: resolvedSport,
        level: altLevel,
        timeBudgetMin: altLevel === 'easy' || altLevel === 'rest' ? 30 : input.timeBudgetMin,
        effectiveFtp,
        maxHr: safeMaxHr,
        effectiveRhr: safeRhr,
        runningPaces,
        estSpeedKmh,
        isHillyGoal,
        headlineReason: 'Bewusst gelenkschonendere / stressärmere Alternative für heute.',
      }),
    });
  }

  // Alt 2: Cross-training sport switch at the same safe intensity level
  const otherSport: 'running' | 'cycling' = resolvedSport === 'running' ? 'cycling' : 'running';
  alternatives.push({
    label: otherSport === 'cycling' ? 'Wechsel zu Radfahren' : 'Wechsel zu Laufen',
    sport: otherSport,
    intensityLevel: level,
    zoneBadge: meta.zoneBadge,
    tone: meta.tone,
    estimatedRecoveryHours: meta.recoveryHours,
    targetIf: meta.targetIf,
    rpeRange: meta.rpeRange,
    workout: buildDailyWorkout({
      sport: otherSport,
      level,
      timeBudgetMin: input.timeBudgetMin,
      effectiveFtp,
      maxHr: safeMaxHr,
      effectiveRhr: safeRhr,
      runningPaces,
      estSpeedKmh,
      isHillyGoal,
      headlineReason: `Alternativer Cross-Training-Vorschlag (${otherSport === 'cycling' ? 'Radsport' : 'Laufen'}) im selben Zielbereich.`,
    }),
  });

  return {
    resolvedSport,
    sportReason,
    dailyReadinessScore,
    intensityLevel: level,
    intensityLabel: meta.label,
    zoneBadge: meta.zoneBadge,
    tone: meta.tone,
    rpeRange: meta.rpeRange,
    targetIf: meta.targetIf,
    estimatedRecoveryHours: meta.recoveryHours,
    headline: `${meta.label} (${meta.zoneBadge}) — RPE ${meta.rpeRange[0]}–${meta.rpeRange[1]} · Ziel-IF ${meta.targetIf.toFixed(2)}`,
    factors,
    recentSummary: {
      hoursSinceLastHardSession,
      yesterdayTss,
      last48hTss,
      consecutiveTrainingDays,
      last7dHardSessionCount,
      daysSinceLastSession,
    },
    primaryWorkout,
    alternatives,
  };
}
