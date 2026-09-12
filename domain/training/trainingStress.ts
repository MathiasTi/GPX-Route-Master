import { Result, ok, err } from '../core/result';

export class TrainingCalculationError extends Error {
  constructor(message: string, public readonly code: 'INVALID_INPUT' | 'NEGATIVE_TSS' | 'CALCULATION_OVERFLOW') {
    super(message);
    this.name = 'TrainingCalculationError';
  }
}

export interface DailyStressScore {
  readonly date: string; // YYYY-MM-DD
  readonly tss: number;
}

export type FormCategory = 'overtrained' | 'fatigued' | 'neutral' | 'optimal' | 'fresh';

export interface FormStateMetrics {
  readonly date: string;
  readonly dailyTss: number;
  readonly ctl: number; // Chronic Training Load (Fitness, ~42 day EMA)
  readonly atl: number; // Acute Training Load (Fatigue, ~7 day EMA)
  readonly tsb: number; // Training Stress Balance (Form = CTL - ATL)
  readonly formCategory: FormCategory;
}

export interface TrainingLoadConfig {
  readonly ctlDays?: number; // default 42
  readonly atlDays?: number; // default 7
  readonly initialCtl?: number; // default 0
  readonly initialAtl?: number; // default 0
}

/**
 * Categorizes athlete form according to scientific Banister/Coggan TSB ranges.
 */
export function classifyFormCategory(tsb: number): FormCategory {
  if (tsb < -30) return 'overtrained';
  if (tsb < -10) return 'fatigued';
  if (tsb <= 10) return 'neutral';
  if (tsb <= 25) return 'optimal';
  return 'fresh';
}

/**
 * Calculates Chronic Training Load (CTL), Acute Training Load (ATL),
 * and Training Stress Balance (TSB) across a daily TSS series.
 */
export function calculateTrainingStressBalance(
  history: readonly DailyStressScore[],
  config: TrainingLoadConfig = {}
): Result<readonly FormStateMetrics[], TrainingCalculationError> {
  const ctlDays = config.ctlDays ?? 42;
  const atlDays = config.atlDays ?? 7;

  if (ctlDays <= 0 || atlDays <= 0) {
    return err(new TrainingCalculationError(
      'Decay time constants must be strictly positive integers.',
      'INVALID_INPUT'
    ));
  }

  // Pre-validate all TSS scores
  for (const entry of history) {
    if (typeof entry.tss !== 'number' || !Number.isFinite(entry.tss)) {
      return err(new TrainingCalculationError(
        `TSS for date ${entry.date} is not a valid finite number.`,
        'INVALID_INPUT'
      ));
    }
    if (entry.tss < 0) {
      return err(new TrainingCalculationError(
        `Negative TSS score (${entry.tss}) encountered on ${entry.date}.`,
        'NEGATIVE_TSS'
      ));
    }
  }

  if (history.length === 0) {
    return ok([]);
  }

  // Decay weighting constants for Exponential Moving Average
  const lambdaCtl = Math.exp(-1 / ctlDays);
  const lambdaAtl = Math.exp(-1 / atlDays);

  const metrics: FormStateMetrics[] = [];
  let currentCtl = config.initialCtl ?? 0;
  let currentAtl = config.initialAtl ?? 0;

  for (const entry of history) {
    // Standard Banister / Coggan EMA formula: Load_t = Load_{t-1} * exp(-1/tau) + TSS_t * (1 - exp(-1/tau))
    currentCtl = currentCtl * lambdaCtl + entry.tss * (1 - lambdaCtl);
    currentAtl = currentAtl * lambdaAtl + entry.tss * (1 - lambdaAtl);

    const roundedCtl = Math.round(currentCtl * 10) / 10;
    const roundedAtl = Math.round(currentAtl * 10) / 10;
    const tsb = Math.round((roundedCtl - roundedAtl) * 10) / 10;

    metrics.push({
      date: entry.date,
      dailyTss: entry.tss,
      ctl: roundedCtl,
      atl: roundedAtl,
      tsb,
      formCategory: classifyFormCategory(tsb)
    });
  }

  return ok(metrics);
}
