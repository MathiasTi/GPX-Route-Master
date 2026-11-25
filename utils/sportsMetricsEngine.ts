import type { GPXPoint, GPXTrack } from '../types';
import {
  calculateDistance,
  detectActivityType,
  estimateMedianSamplingIntervalSec,
  findClimbs,
  isRecordingPauseGap
} from './gpxUtils';
import { minettiGapFactor } from './runningMetricsEngine';
import { resolveTrackCapabilities } from './trackTelemetryCapabilities';

export type ClimateCondition = 'cool' | 'moderate' | 'warm';

export interface TrackSportsMetricsOptions {
  ftp?: number;
  weightKg?: number;
  maxHr?: number;
  rhr?: number;
  climate?: ClimateCondition;
  estimatedSpeedKmh?: number;
  activityTypeOverride?: 'cycling' | 'running';
}

export interface RacePredictionEntry {
  id: '5k' | '10k' | 'hm' | 'marathon';
  label: string;
  distanceKm: number;
  timeSec: number;
  pacePerKmSec: number;
}

export interface CyclingBenchmarkEntry {
  durationLabel: string;
  durationSec: number;
  watts: number | null;
  wkg: number | null;
  tierLabel: string;
}

export interface PhenotypeAxis {
  id: 'sprint' | 'vo2max' | 'threshold' | 'climbing' | 'endurance';
  label: string;
  score: number; // 0..100
  detail: string;
}

export interface TrackSportsMetrics {
  sport: 'cycling' | 'running';
  movingTimeSec: number;
  distanceKm: number;
  ascentM: number;
  efficiency: {
    ef: number | null;
    unit: string;
    method: 'power' | 'gap' | 'speed' | null;
    decouplingPct: number | null;
    decouplingLabel: 'Pw:Hr' | 'Pa:Hr' | 'Spd:Hr' | null;
    decouplingStatus: 'stable' | 'moderate' | 'high' | null;
    firstHalfEf: number | null;
    secondHalfEf: number | null;
    avgHr: number | null;
    normalizedPower: number | null;
    avgGapSpeedMs: number | null;
    reasonUnavailable?: string;
  };
  durability: {
    retentionPct: number | null;
    totalWorkKj: number | null;
    workPerKg: number | null;
    status: 'strong' | 'moderate' | 'fatigued' | null;
    reasonUnavailable?: string;
  };
  climbing: {
    avgVam: number | null;
    peakClimbVam: number | null;
    climbingWkg: number | null;
    climbingWkgSource: 'power' | 'vam_model' | null;
    climbCount: number;
    splitBalancePct: number | null;
    splitType: 'negative' | 'even' | 'positive' | null;
  };
  fueling: {
    climate: ClimateCondition;
    totalKcal: number;
    totalKj: number | null;
    carbsPerHourG: number;
    totalCarbsG: number;
    fluidPerHourMl: number;
    totalFluidMl: number;
    sodiumPerHourMg: number;
    intensityFactor: number | null;
  };
  performance: {
    estimatedVo2Max: number | null;
    vo2Method: string | null;
    vdot: number | null;
    racePredictions: RacePredictionEntry[];
    cyclingBenchmarks: CyclingBenchmarkEntry[];
    phenotype: {
      primaryLabel: string;
      summary: string;
      axes: PhenotypeAxis[];
    };
  };
  recovery: {
    estimatedHours: number;
    sessionTss: number;
    readinessLabel: 'light' | 'moderate' | 'hard' | 'very_hard';
  };
}

export interface LongitudinalActivityInput {
  id: string;
  name: string;
  date: string; // YYYY-MM-DD or ISO
  sport: 'cycling' | 'running';
  distanceKm: number;
  durationSec: number;
  ascentM?: number;
  tss: number;
  avgHr?: number | null;
  avgPower?: number | null;
  normalizedPower?: number | null;
  peaks?: Record<number, number> | null;
}

export interface LongitudinalDailyPoint {
  date: string;
  formattedDate: string;
  tss: number;
  ctl: number;
  atl: number;
  tsb: number;
}

export interface LongitudinalFitnessMetrics {
  acwr: {
    current: number | null;
    acuteLoad7d: number;
    chronicLoad28d: number;
    status: 'undertraining' | 'optimal' | 'caution' | 'high_risk' | 'insufficient_data';
    series: Array<{
      date: string;
      formattedDate: string;
      acwr: number;
      acuteLoad: number;
      chronicLoad: number;
    }>;
  };
  monotonyStrain: {
    monotony7d: number | null;
    strain7d: number | null;
    weeklyLoad: number;
    activeDays7d: number;
    status: 'balanced' | 'elevated' | 'high_risk' | 'insufficient_data';
  };
  rampRate: {
    weeklyCtlDelta: number | null;
    currentCtl: number;
    previousWeekCtl: number | null;
    status: 'detraining' | 'steady' | 'optimal' | 'aggressive' | 'insufficient_data';
  };
  recovery: {
    estimatedHours: number;
    latestSessionTss: number;
    readinessLabel: 'fresh' | 'light' | 'moderate' | 'hard' | 'very_hard';
  };
  efTrend: {
    points: Array<{
      date: string;
      formattedDate: string;
      name: string;
      sport: 'cycling' | 'running';
      ef: number;
      unit: string;
    }>;
    changePct: number | null;
    direction: 'improving' | 'stable' | 'declining' | 'insufficient_data';
  };
  athleteProfile: {
    sportFocus: 'cycling' | 'running' | 'mixed';
    estimatedVo2Max: number | null;
    vo2Source: string | null;
    vdot: number | null;
    racePredictions: RacePredictionEntry[];
    cyclingBenchmarks: CyclingBenchmarkEntry[];
    phenotype: {
      primaryLabel: string;
      summary: string;
      axes: PhenotypeAxis[];
    };
  };
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toTimestampMs(raw: GPXPoint['time']): number | null {
  if (!raw) return null;
  if (raw instanceof Date) {
    const ms = raw.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  const parsed = Date.parse(String(raw));
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Computes Normalized Power (30-second rolling average fourth power) over a power sample array
 * with per-sample elapsed durations.
 */
export function computeNormalizedPower(
  samples: Array<{ dtSec: number; power: number }>
): number | null {
  if (samples.length < 10) return null;
  // Expand into ~1s bins capped cleanly so large tracks stay fast
  const totalSec = samples.reduce((sum, s) => sum + s.dtSec, 0);
  if (totalSec < 30) return null;

  const stepSec = totalSec > 18000 ? 5 : 1;
  const bins: number[] = [];
  let accTime = 0;
  let accWeightedP = 0;

  for (let i = 0; i < samples.length; i++) {
    const dt = Math.max(0.5, Math.min(15, samples[i].dtSec));
    const p = Math.max(0, samples[i].power);
    accTime += dt;
    accWeightedP += p * dt;
    while (accTime >= stepSec) {
      bins.push(accWeightedP / accTime);
      accTime -= stepSec;
      accWeightedP = p * accTime;
    }
  }

  const windowSize = Math.max(1, Math.round(30 / stepSec));
  if (bins.length < windowSize) return null;

  let windowSum = 0;
  let fourthSum = 0;
  let count = 0;
  for (let i = 0; i < bins.length; i++) {
    windowSum += bins[i];
    if (i >= windowSize) {
      windowSum -= bins[i - windowSize];
    }
    if (i >= windowSize - 1) {
      const avg = windowSum / windowSize;
      fourthSum += avg * avg * avg * avg;
      count++;
    }
  }

  if (count === 0 || fourthSum <= 0) return null;
  return Math.round(Math.pow(fourthSum / count, 0.25));
}

/**
 * Computes best average power over a given duration window (seconds) using a two-pointer sliding window.
 */
function computeBestDurationPower(
  samples: Array<{ cumTimeSec: number; dtSec: number; power: number }>,
  windowSec: number
): number | null {
  if (samples.length < 3) return null;
  const totalSec = samples[samples.length - 1].cumTimeSec;
  if (totalSec < windowSec * 0.85) return null;

  let best = 0;
  let left = 0;
  let sumWork = 0;
  let sumDt = 0;

  for (let right = 0; right < samples.length; right++) {
    const s = samples[right];
    sumWork += s.power * s.dtSec;
    sumDt += s.dtSec;

    while (left < right && sumDt - samples[left].dtSec >= windowSec) {
      sumWork -= samples[left].power * samples[left].dtSec;
      sumDt -= samples[left].dtSec;
      left++;
    }

    if (sumDt >= windowSec * 0.9) {
      const avg = sumWork / sumDt;
      if (avg > best) best = avg;
    }
  }

  return best > 0 ? Math.round(best) : null;
}

/**
 * Jack Daniels VDOT formula from velocity (meters/min) and duration (minutes).
 */
export function calculateVdotFromEffort(distanceMeters: number, durationSec: number): number | null {
  if (!Number.isFinite(distanceMeters) || !Number.isFinite(durationSec)) return null;
  if (distanceMeters < 1500 || durationSec < 240) return null;

  const tMin = durationSec / 60;
  const vMPerMin = distanceMeters / tMin;
  if (vMPerMin < 70 || vMPerMin > 420) return null;

  const vo2 = -4.60 + 0.182258 * vMPerMin + 0.000104 * vMPerMin * vMPerMin;
  const pctVo2Max =
    0.8 +
    0.1894393 * Math.exp(-0.012778 * tMin) +
    0.2989558 * Math.exp(-0.1932605 * tMin);

  if (pctVo2Max <= 0.4 || vo2 <= 15) return null;
  const vdot = vo2 / pctVo2Max;
  if (!Number.isFinite(vdot) || vdot < 20 || vdot > 88) return null;
  return Number(vdot.toFixed(1));
}

/**
 * Solves Daniels VDOT equation for predicted race finish time (seconds) for a given distance (meters).
 */
export function predictRaceTimeFromVdot(vdot: number, distanceMeters: number): number {
  // Binary search duration in minutes such that calculateVdotFromEffort(distanceMeters, tMin*60) ≈ vdot
  let lowMin = Math.max(8, distanceMeters / 420);
  let highMin = Math.min(480, distanceMeters / 70);

  for (let iter = 0; iter < 32; iter++) {
    const midMin = (lowMin + highMin) * 0.5;
    const v = distanceMeters / midMin;
    const vo2 = -4.60 + 0.182258 * v + 0.000104 * v * v;
    const pct =
      0.8 +
      0.1894393 * Math.exp(-0.012778 * midMin) +
      0.2989558 * Math.exp(-0.1932605 * midMin);
    const estVdot = vo2 / pct;
    if (estVdot > vdot) {
      // Mid time is too fast -> increase time
      lowMin = midMin;
    } else {
      highMin = midMin;
    }
  }

  return Math.round(((lowMin + highMin) * 0.5) * 60);
}

export function buildRacePredictions(vdot: number | null): RacePredictionEntry[] {
  if (!vdot || !Number.isFinite(vdot) || vdot < 22) return [];
  const targets: Array<{ id: RacePredictionEntry['id']; label: string; distanceKm: number }> = [
    { id: '5k', label: '5 km', distanceKm: 5 },
    { id: '10k', label: '10 km', distanceKm: 10 },
    { id: 'hm', label: 'Halbmarathon', distanceKm: 21.0975 },
    { id: 'marathon', label: 'Marathon', distanceKm: 42.195 }
  ];

  return targets.map((t) => {
    const timeSec = predictRaceTimeFromVdot(vdot, t.distanceKm * 1000);
    return {
      id: t.id,
      label: t.label,
      distanceKm: t.distanceKm,
      timeSec,
      pacePerKmSec: Math.round(timeSec / t.distanceKm)
    };
  });
}

function classifyWkgTier(durationSec: number, wkg: number | null): string {
  if (wkg === null || !Number.isFinite(wkg) || wkg <= 0) return '–';
  // Reference Coggan-style endurance tiers
  const thresholds: Record<number, [number, number, number, number]> = {
    5: [10.0, 13.5, 16.5, 19.5],
    60: [5.0, 6.5, 8.0, 9.5],
    300: [3.2, 4.2, 5.2, 6.2],
    1200: [2.6, 3.5, 4.4, 5.2],
    3600: [2.4, 3.2, 4.0, 4.8]
  };
  const [t1, t2, t3, t4] = thresholds[durationSec] || [2.5, 3.4, 4.2, 5.0];
  if (wkg >= t4) return 'Elite';
  if (wkg >= t3) return 'Sehr stark';
  if (wkg >= t2) return 'Ambitioniert';
  if (wkg >= t1) return 'Solide';
  return 'Aufbau';
}

export function buildCyclingBenchmarks(
  peaks: Partial<Record<number, number | null>>,
  weightKg: number
): CyclingBenchmarkEntry[] {
  const safeWeight = Math.max(40, weightKg || 75);
  const specs: Array<{ durationLabel: string; durationSec: number }> = [
    { durationLabel: '5 Sek (Sprint)', durationSec: 5 },
    { durationLabel: '1 Min (Anaerob)', durationSec: 60 },
    { durationLabel: '5 Min (VO2max)', durationSec: 300 },
    { durationLabel: '20 Min (Schwelle)', durationSec: 1200 },
    { durationLabel: '60 Min (FTP)', durationSec: 3600 }
  ];

  return specs.map((s) => {
    const w = peaks[s.durationSec];
    const watts = w && Number.isFinite(w) && w > 0 ? Math.round(w) : null;
    const wkg = watts ? Number((watts / safeWeight).toFixed(2)) : null;
    return {
      durationLabel: s.durationLabel,
      durationSec: s.durationSec,
      watts,
      wkg,
      tierLabel: classifyWkgTier(s.durationSec, wkg)
    };
  });
}

function buildPhenotypeProfile(params: {
  sport: 'cycling' | 'running';
  sprintScore: number;
  vo2Score: number;
  thresholdScore: number;
  climbingScore: number;
  enduranceScore: number;
  details: {
    sprint: string;
    vo2max: string;
    threshold: string;
    climbing: string;
    endurance: string;
  };
}): { primaryLabel: string; summary: string; axes: PhenotypeAxis[] } {
  const axes: PhenotypeAxis[] = [
    {
      id: 'sprint',
      label: params.sport === 'running' ? 'Speed / Antritt' : 'Sprint / Explosivität',
      score: clamp(Math.round(params.sprintScore), 15, 100),
      detail: params.details.sprint
    },
    {
      id: 'vo2max',
      label: 'VO2max / Attacke',
      score: clamp(Math.round(params.vo2Score), 15, 100),
      detail: params.details.vo2max
    },
    {
      id: 'threshold',
      label: 'Schwelle / Tempo',
      score: clamp(Math.round(params.thresholdScore), 15, 100),
      detail: params.details.threshold
    },
    {
      id: 'climbing',
      label: 'Klettern / VAM',
      score: clamp(Math.round(params.climbingScore), 15, 100),
      detail: params.details.climbing
    },
    {
      id: 'endurance',
      label: 'Ausdauer / Haltbarkeit',
      score: clamp(Math.round(params.enduranceScore), 15, 100),
      detail: params.details.endurance
    }
  ];

  const sorted = [...axes].sort((a, b) => b.score - a.score);
  const top = sorted[0];
  const second = sorted[1];
  const spread = top.score - sorted[sorted.length - 1].score;

  if (spread <= 8) {
    return {
      primaryLabel: 'Allrounder',
      summary:
        params.sport === 'running'
          ? 'Ausgeglichenes Laufprofil über Tempo, Ausdauer und Höhenmeter.'
          : 'Ausgewogene Stärken über Sprint, Schwelle, Klettern und Langstrecke.',
      axes
    };
  }

  if (params.sport === 'running') {
    const labelMap: Record<PhenotypeAxis['id'], string> = {
      sprint: 'Speed- & Mittelstreckenläufer',
      vo2max: 'Intervall- & 5K/10K-Spezialist',
      threshold: 'Tempodauerläufer',
      climbing: 'Berg- & Trailläufer',
      endurance: 'Langstrecken- & Ausdauerläufer'
    };
    return {
      primaryLabel: labelMap[top.id],
      summary: `Stärkster Bereich: ${top.label} (${top.score}/100), gefolgt von ${second.label}.`,
      axes
    };
  }

  const cyclingLabelMap: Record<PhenotypeAxis['id'], string> = {
    sprint: 'Sprinter',
    vo2max: 'Puncheur',
    threshold: 'Zeitfahrer / Tempohärte',
    climbing: 'Kletterer',
    endurance: 'Langstrecken-Diesel'
  };
  return {
    primaryLabel: cyclingLabelMap[top.id],
    summary: `Stärkster Bereich: ${top.label} (${top.score}/100), gefolgt von ${second.label}.`,
    axes
  };
}

/**
 * Estimates post-workout recovery time in hours from session TSS/rTSS.
 */
export function estimateRecoveryFromTss(sessionTss: number): {
  estimatedHours: number;
  readinessLabel: 'light' | 'moderate' | 'hard' | 'very_hard';
} {
  const safeTss = Math.max(0, Number.isFinite(sessionTss) ? sessionTss : 0);
  if (safeTss < 45) {
    return {
      estimatedHours: Math.max(8, Math.round(8 + (safeTss / 45) * 10)),
      readinessLabel: 'light'
    };
  }
  if (safeTss < 95) {
    return {
      estimatedHours: Math.round(18 + ((safeTss - 45) / 50) * 12),
      readinessLabel: 'moderate'
    };
  }
  if (safeTss < 165) {
    return {
      estimatedHours: Math.round(30 + ((safeTss - 95) / 70) * 16),
      readinessLabel: 'hard'
    };
  }
  return {
    estimatedHours: Math.min(72, Math.round(46 + ((safeTss - 165) / 100) * 20)),
    readinessLabel: 'very_hard'
  };
}

/**
 * Formats seconds into H:MM:SS or MM:SS cleanly for race predictions.
 */
export function formatRaceTime(totalSeconds: number): string {
  if (!Number.isFinite(totalSeconds) || totalSeconds <= 0) return '–';
  const rounded = Math.round(totalSeconds);
  const h = Math.floor(rounded / 3600);
  const m = Math.floor((rounded % 3600) / 60);
  const s = rounded % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${m}:${String(s).padStart(2, '0')}`;
}

export function formatPaceMinPerKm(secPerKm: number): string {
  if (!Number.isFinite(secPerKm) || secPerKm <= 0) return '–';
  const rounded = Math.round(secPerKm);
  const m = Math.floor(rounded / 60);
  const s = rounded % 60;
  return `${m}:${String(s).padStart(2, '0')} /km`;
}

/**
 * Computes all single-track sports & fitness metrics for a GPXTrack, automatically adapting
 * formulas for cycling vs. running and honestly gating metrics when sensor data is missing.
 */
export function computeTrackSportsMetrics(
  track: GPXTrack,
  options: TrackSportsMetricsOptions = {}
): TrackSportsMetrics {
  const sport: 'cycling' | 'running' =
    options.activityTypeOverride ||
    (track.activityType === 'running' || track.activityType === 'cycling'
      ? track.activityType
      : detectActivityType(track.points || [], track.name || '', track.name || ''));

  const capabilities = resolveTrackCapabilities({ ...track, activityType: sport });
  const ftp = Math.max(80, options.ftp || 220);
  const weightKg = Math.max(40, options.weightKg || 75);
  const maxHr = clamp(options.maxHr || 185, 130, 225);
  const rhr = clamp(options.rhr || 55, 35, 100);
  const climate: ClimateCondition = options.climate || 'moderate';
  const fallbackSpeedKmh = options.estimatedSpeedKmh || (sport === 'running' ? 10.5 : 24);

  const points = Array.isArray(track.points) ? track.points : [];
  const distanceKm = Math.max(0, Number(track.distance) || 0);
  const ascentM = Math.max(0, Number(track.ascent) || 0);
  const medianDt = estimateMedianSamplingIntervalSec(points);

  interface MovingSample {
    cumTimeSec: number;
    dtSec: number;
    distM: number;
    eleDiffM: number;
    grade: number;
    speedMs: number;
    gapSpeedMs: number;
    hr?: number;
    power?: number;
  }

  const movingSamples: MovingSample[] = [];
  let cumTimeSec = 0;

  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    const distM = calculateDistance(p1, p2) * 1000;
    const t1 = toTimestampMs(p1.time);
    const t2 = toTimestampMs(p2.time);

    let dtSec = 0;
    if (t1 !== null && t2 !== null && t2 > t1) {
      dtSec = (t2 - t1) / 1000;
      if (isRecordingPauseGap(dtSec, distM, medianDt)) {
        continue;
      }
    } else if (distM > 0.2) {
      dtSec = distM / ((fallbackSpeedKmh / 3.6) || 1);
    } else {
      continue;
    }

    if (dtSec <= 0 || dtSec > 60) continue;
    const speedMs = distM / dtSec;
    // Skip stationary stops when real timestamps exist
    if (capabilities.hasTimestamps && speedMs < (sport === 'running' ? 0.5 : 0.7)) {
      continue;
    }

    const eleDiffM =
      capabilities.hasRealElevation &&
      typeof p1.ele === 'number' &&
      typeof p2.ele === 'number'
        ? p2.ele - p1.ele
        : 0;
    const grade = distM > 2 ? clamp(eleDiffM / distM, -0.35, 0.35) : 0;
    const gapSpeedMs = sport === 'running' ? speedMs * minettiGapFactor(grade) : speedMs;

    const hr =
      typeof p2.hr === 'number' && p2.hr >= 40 && p2.hr <= 230
        ? p2.hr
        : typeof p1.hr === 'number' && p1.hr >= 40 && p1.hr <= 230
        ? p1.hr
        : undefined;

    const power =
      capabilities.hasNativePower && typeof p2.power === 'number' && p2.power >= 0 && p2.power <= 2500
        ? p2.power
        : undefined;

    cumTimeSec += dtSec;
    movingSamples.push({
      cumTimeSec,
      dtSec,
      distM,
      eleDiffM,
      grade,
      speedMs,
      gapSpeedMs,
      hr,
      power
    });
  }

  const movingTimeSec =
    cumTimeSec > 30
      ? Math.round(cumTimeSec)
      : track.duration && track.duration > 0
      ? Math.round(track.duration)
      : Math.round((distanceKm / Math.max(4, fallbackSpeedKmh)) * 3600);

  // --- 1. Aerobic Efficiency (EF) & Decoupling (Pw:Hr / Pa:Hr) ---
  const hrSamples = movingSamples.filter((s) => typeof s.hr === 'number');
  const powerSamples = movingSamples.filter((s) => typeof s.power === 'number');

  const avgHr =
    hrSamples.length >= 10
      ? Math.round(
          hrSamples.reduce((sum, s) => sum + (s.hr || 0) * s.dtSec, 0) /
            Math.max(1, hrSamples.reduce((sum, s) => sum + s.dtSec, 0))
        )
      : null;

  const normalizedPower =
    capabilities.hasNativePower && powerSamples.length >= 10
      ? computeNormalizedPower(powerSamples.map((s) => ({ dtSec: s.dtSec, power: s.power || 0 })))
      : track.powerStats?.normalizedPower && capabilities.hasNativePower
      ? Math.round(track.powerStats.normalizedPower)
      : null;

  const totalMovingGapDist = movingSamples.reduce((sum, s) => sum + s.gapSpeedMs * s.dtSec, 0);
  const totalMovingDt = movingSamples.reduce((sum, s) => sum + s.dtSec, 0);
  const avgGapSpeedMs = totalMovingDt > 30 ? totalMovingGapDist / totalMovingDt : null;

  let ef: number | null = null;
  let efUnit = sport === 'running' ? 'm/min/bpm' : 'W/bpm';
  let efMethod: 'power' | 'gap' | 'speed' | null = null;
  let decouplingPct: number | null = null;
  let decouplingLabel: 'Pw:Hr' | 'Pa:Hr' | 'Spd:Hr' | null = null;
  let decouplingStatus: 'stable' | 'moderate' | 'high' | null = null;
  let firstHalfEf: number | null = null;
  let secondHalfEf: number | null = null;
  let efUnavailableReason: string | undefined;

  if (!avgHr) {
    efUnavailableReason = 'Herzfrequenzdaten erforderlich für EF & aerobe Entkopplung.';
  } else if (sport === 'cycling' && normalizedPower) {
    efMethod = 'power';
    efUnit = 'W/bpm';
    decouplingLabel = 'Pw:Hr';
    ef = Number((normalizedPower / avgHr).toFixed(2));
  } else if (sport === 'running' && avgGapSpeedMs) {
    efMethod = 'gap';
    efUnit = 'm/min/bpm';
    decouplingLabel = 'Pa:Hr';
    ef = Number(((avgGapSpeedMs * 60) / avgHr).toFixed(2));
  } else if (totalMovingDt > 30) {
    const avgSpeedKmh = (movingSamples.reduce((s, x) => s + x.distM, 0) / totalMovingDt) * 3.6;
    if (avgSpeedKmh > 2) {
      efMethod = 'speed';
      efUnit = 'km/h·10/bpm';
      decouplingLabel = 'Spd:Hr';
      ef = Number(((avgSpeedKmh * 10) / avgHr).toFixed(2));
    }
  }

  // Compute 1st half vs 2nd half decoupling when moving time >= 10 minutes
  if (efMethod && hrSamples.length >= 20 && totalMovingDt >= 600) {
    const halfTime = totalMovingDt * 0.5;
    const firstHalf = movingSamples.filter((s) => s.cumTimeSec <= halfTime && typeof s.hr === 'number');
    const secondHalf = movingSamples.filter((s) => s.cumTimeSec > halfTime && typeof s.hr === 'number');

    const computeSegmentEf = (seg: MovingSample[]): number | null => {
      const segDt = seg.reduce((sum, s) => sum + s.dtSec, 0);
      if (segDt < 180) return null;
      const segHr = seg.reduce((sum, s) => sum + (s.hr || 0) * s.dtSec, 0) / segDt;
      if (segHr <= 40) return null;

      if (efMethod === 'power') {
        const segPower = seg.filter((s) => typeof s.power === 'number');
        const segNp = computeNormalizedPower(segPower.map((s) => ({ dtSec: s.dtSec, power: s.power || 0 })));
        if (!segNp) return null;
        return segNp / segHr;
      }
      if (efMethod === 'gap') {
        const segGapSpeed = seg.reduce((sum, s) => sum + s.gapSpeedMs * s.dtSec, 0) / segDt;
        return (segGapSpeed * 60) / segHr;
      }
      const segSpdKmh = (seg.reduce((sum, s) => sum + s.distM, 0) / segDt) * 3.6;
      return (segSpdKmh * 10) / segHr;
    };

    const ef1 = computeSegmentEf(firstHalf);
    const ef2 = computeSegmentEf(secondHalf);
    if (ef1 && ef2 && ef1 > 0) {
      firstHalfEf = Number(ef1.toFixed(2));
      secondHalfEf = Number(ef2.toFixed(2));
      const rawDrift = ((ef1 - ef2) / ef1) * 100;
      decouplingPct = Number(clamp(rawDrift, -30, 50).toFixed(1));
      decouplingStatus =
        decouplingPct < 5 ? 'stable' : decouplingPct <= 10 ? 'moderate' : 'high';
    }
  } else if (efMethod && totalMovingDt < 600) {
    efUnavailableReason = 'Mindestens 10 Min. Bewegungszeit für Entkopplung (1. vs. 2. Hälfte) erforderlich.';
  }

  // --- 2. Durability / Fatigue Resistance ---
  let totalWorkKj: number | null = null;
  if (capabilities.hasNativePower && powerSamples.length >= 10) {
    const joules = powerSamples.reduce((sum, s) => sum + (s.power || 0) * s.dtSec, 0);
    totalWorkKj = Math.round(joules / 1000);
  } else if (sport === 'cycling' && movingTimeSec > 60) {
    // Estimate mechanical kJ from speed/elevation physics when power meter absent
    const estAvgWatts =
      track.powerStats?.avgPower && track.powerStats.avgPower > 30
        ? track.powerStats.avgPower
        : Math.round(ftp * 0.68);
    totalWorkKj = Math.round((estAvgWatts * movingTimeSec) / 1000);
  }
  const workPerKg = totalWorkKj !== null ? Number((totalWorkKj / weightKg).toFixed(1)) : null;

  let retentionPct: number | null = null;
  let durabilityStatus: 'strong' | 'moderate' | 'fatigued' | null = null;
  let durabilityReason: string | undefined;

  if (totalMovingDt >= 1200 && movingSamples.length >= 24) {
    const q1End = totalMovingDt * 0.25;
    const q4Start = totalMovingDt * 0.75;
    const earlySeg = movingSamples.filter((s) => s.cumTimeSec <= q1End);
    const lateSeg = movingSamples.filter((s) => s.cumTimeSec >= q4Start);

    const calcOutput = (seg: MovingSample[]): number | null => {
      const dt = seg.reduce((sum, s) => sum + s.dtSec, 0);
      if (dt < 120) return null;
      if (sport === 'cycling' && capabilities.hasNativePower) {
        const pSeg = seg.filter((s) => typeof s.power === 'number');
        const pDt = pSeg.reduce((sum, s) => sum + s.dtSec, 0);
        if (pDt < 90) return null;
        return pSeg.reduce((sum, s) => sum + (s.power || 0) * s.dtSec, 0) / pDt;
      }
      if (sport === 'running') {
        return seg.reduce((sum, s) => sum + s.gapSpeedMs * s.dtSec, 0) / dt;
      }
      return seg.reduce((sum, s) => sum + s.speedMs * s.dtSec, 0) / dt;
    };

    const earlyOut = calcOutput(earlySeg);
    const lateOut = calcOutput(lateSeg);
    if (earlyOut && lateOut && earlyOut > 0) {
      retentionPct = Math.round(clamp((lateOut / earlyOut) * 100, 40, 125));
      durabilityStatus =
        retentionPct >= 94 ? 'strong' : retentionPct >= 85 ? 'moderate' : 'fatigued';
    }
  } else {
    durabilityReason = 'Mindestens 20 Min. Bewegungszeit für Ermüdungsresistenz (Q4 vs. Q1) erforderlich.';
  }

  // --- 3. Climbing VAM, W/kg & Pacing Split Balance ---
  let avgVam: number | null = null;
  let peakClimbVam: number | null = null;
  let climbingWkg: number | null = null;
  let climbingWkgSource: 'power' | 'vam_model' | null = null;
  const climbs = track.climbs && track.climbs.length > 0 ? track.climbs : findClimbs(points);

  if (capabilities.hasRealElevation && movingSamples.length >= 10) {
    let climbGainM = 0;
    let climbTimeSec = 0;
    let climbPowerWorkJ = 0;
    let climbPowerTimeSec = 0;
    let climbGradeWeighted = 0;

    for (const s of movingSamples) {
      if (s.grade >= 0.03 && s.eleDiffM > 0) {
        climbGainM += s.eleDiffM;
        climbTimeSec += s.dtSec;
        climbGradeWeighted += s.grade * 100 * s.dtSec;
        if (typeof s.power === 'number') {
          climbPowerWorkJ += s.power * s.dtSec;
          climbPowerTimeSec += s.dtSec;
        }
      }
    }

    if (climbGainM >= 40 && climbTimeSec >= 120) {
      avgVam = Math.round(clamp((climbGainM / climbTimeSec) * 3600, 100, 2600));
      const meanClimbGradePct = climbGradeWeighted / climbTimeSec;
      if (climbPowerTimeSec >= 90) {
        climbingWkg = Number((climbPowerWorkJ / climbPowerTimeSec / weightKg).toFixed(2));
        climbingWkgSource = 'power';
      } else if (sport === 'cycling' && meanClimbGradePct >= 3) {
        // Michele Ferrari VAM-to-W/kg climbing model: W/kg ≈ VAM / ((2 + grade%/10) * 100)
        const gradeFactor = (2 + meanClimbGradePct / 10) * 100;
        climbingWkg = Number(clamp(avgVam / gradeFactor, 1.0, 8.5).toFixed(2));
        climbingWkgSource = 'vam_model';
      }
    }

    // Check best categorized climb VAM if timestamps exist
    if (climbs.length > 0 && capabilities.hasTimestamps) {
      let maxVam = 0;
      for (const c of climbs) {
        const startPt = points[c.startIndex];
        const endPt = points[c.endIndex];
        const t1 = startPt ? toTimestampMs(startPt.time) : null;
        const t2 = endPt ? toTimestampMs(endPt.time) : null;
        if (t1 !== null && t2 !== null && t2 - t1 >= 120_000 && c.ascent >= 40) {
          const cVam = (c.ascent / ((t2 - t1) / 1000)) * 3600;
          if (cVam > maxVam && cVam < 2800) {
            maxVam = cVam;
          }
        }
      }
      if (maxVam > 0) {
        peakClimbVam = Math.round(maxVam);
      }
    }
    if (peakClimbVam === null && avgVam !== null) {
      peakClimbVam = avgVam;
    }
  }

  // Pacing Split Balance (2nd half vs 1st half)
  let splitBalancePct: number | null = null;
  let splitType: 'negative' | 'even' | 'positive' | null = null;
  if (totalMovingDt >= 300 && movingSamples.length >= 12) {
    const halfT = totalMovingDt * 0.5;
    const h1 = movingSamples.filter((s) => s.cumTimeSec <= halfT);
    const h2 = movingSamples.filter((s) => s.cumTimeSec > halfT);
    const h1Dt = h1.reduce((sum, s) => sum + s.dtSec, 0);
    const h2Dt = h2.reduce((sum, s) => sum + s.dtSec, 0);
    if (h1Dt > 60 && h2Dt > 60) {
      const s1 = h1.reduce((sum, s) => sum + (sport === 'running' ? s.gapSpeedMs : s.speedMs) * s.dtSec, 0) / h1Dt;
      const s2 = h2.reduce((sum, s) => sum + (sport === 'running' ? s.gapSpeedMs : s.speedMs) * s.dtSec, 0) / h2Dt;
      if (s1 > 0.3) {
        // Positive delta means faster 2nd half (Negative Split)
        splitBalancePct = Number(clamp(((s2 - s1) / s1) * 100, -40, 40).toFixed(1));
        if (splitBalancePct >= 2.0) splitType = 'negative';
        else if (splitBalancePct <= -2.0) splitType = 'positive';
        else splitType = 'even';
      }
    }
  }

  // --- 4. Fueling & Hydration Calculator ---
  const durationHours = Math.max(0.1, movingTimeSec / 3600);
  const intensityFactor =
    sport === 'cycling' && normalizedPower
      ? Number(clamp(normalizedPower / ftp, 0.35, 1.35).toFixed(2))
      : avgHr && maxHr > rhr
      ? Number(clamp(((avgHr - rhr) / (maxHr - rhr)) * 1.05, 0.45, 1.15).toFixed(2))
      : null;

  const effectiveIf = intensityFactor ?? 0.72;
  const totalKcal =
    sport === 'cycling' && totalWorkKj !== null
      ? Math.round(totalWorkKj * 1.04) // ~23.5% gross efficiency -> 1 kJ ≈ 1.04 kcal
      : Math.round(distanceKm * weightKg * 1.036 + ascentM * weightKg * 0.0075);

  let baseCarbsPerHr = 30;
  if (durationHours >= 2.5) {
    baseCarbsPerHr = effectiveIf >= 0.8 ? 85 : 70;
  } else if (durationHours >= 1.25) {
    baseCarbsPerHr = effectiveIf >= 0.8 ? 65 : 50;
  } else if (durationHours >= 0.75) {
    baseCarbsPerHr = effectiveIf >= 0.85 ? 45 : 30;
  }
  const carbsPerHourG = Math.round(baseCarbsPerHr);
  const totalCarbsG = Math.round(carbsPerHourG * durationHours);

  const climateFluidMultiplier = climate === 'cool' ? 0.8 : climate === 'warm' ? 1.35 : 1.0;
  const baseFluidPerHr = sport === 'running' ? 520 : 580;
  const intensityFluidBoost = effectiveIf >= 0.8 ? 1.12 : 1.0;
  const fluidPerHourMl = Math.round(
    (baseFluidPerHr * climateFluidMultiplier * intensityFluidBoost) / 25
  ) * 25;
  const totalFluidMl = Math.round((fluidPerHourMl * durationHours) / 50) * 50;
  const sodiumPerHourMg = climate === 'warm' ? 750 : climate === 'cool' ? 350 : 500;

  // --- 5. VO2max Estimate, Race Predictor & Athlete Phenotype ---
  let estimatedVo2Max: number | null = null;
  let vo2Method: string | null = null;
  let vdot: number | null = null;
  let racePredictions: RacePredictionEntry[] = [];
  let cyclingBenchmarks: CyclingBenchmarkEntry[] = [];

  const peakPowers: Partial<Record<number, number | null>> = {};

  if (sport === 'cycling') {
    const pSeries = powerSamples.map((s) => ({
      cumTimeSec: s.cumTimeSec,
      dtSec: s.dtSec,
      power: s.power || 0
    }));
    peakPowers[5] =
      computeBestDurationPower(pSeries, 5) ??
      (capabilities.hasNativePower ? (track.powerStats?.maxPower ?? null) : null);
    peakPowers[60] =
      computeBestDurationPower(pSeries, 60) ??
      (capabilities.hasNativePower ? (track.powerStats?.best1m ?? null) : null);
    peakPowers[300] = computeBestDurationPower(pSeries, 300);
    peakPowers[1200] =
      computeBestDurationPower(pSeries, 1200) ??
      (capabilities.hasNativePower ? (track.powerStats?.best20m ?? null) : null);
    peakPowers[3600] =
      computeBestDurationPower(pSeries, 3600) ??
      (capabilities.hasNativePower && movingTimeSec >= 3000 ? normalizedPower : null);

    cyclingBenchmarks = buildCyclingBenchmarks(peakPowers, weightKg);

    if (peakPowers[300]) {
      const p5Wkg = peakPowers[300]! / weightKg;
      estimatedVo2Max = Number(clamp(10.8 * p5Wkg + 7, 28, 88).toFixed(1));
      vo2Method = '5-Min Peak-Leistung (Hawley/ACSM)';
    } else if (peakPowers[1200]) {
      const est5mWkg = (peakPowers[1200]! * 1.14) / weightKg;
      estimatedVo2Max = Number(clamp(10.8 * est5mWkg + 7, 28, 88).toFixed(1));
      vo2Method = '20-Min Leistung (ACSM-Schätzung)';
    } else if (ftp > 0 && weightKg > 0) {
      const est5mWkg = (ftp * 1.18) / weightKg;
      estimatedVo2Max = Number(clamp(10.8 * est5mWkg + 7, 28, 88).toFixed(1));
      vo2Method = 'FTP-Profil-Schätzung';
    }
  } else {
    // Running VDOT & VO2max from sustained GAP distance & moving time
    const effectiveRunDistM =
      avgGapSpeedMs && totalMovingDt >= 240 ? avgGapSpeedMs * totalMovingDt : distanceKm * 1000;
    const effectiveRunSec = totalMovingDt >= 240 ? totalMovingDt : movingTimeSec;
    vdot = calculateVdotFromEffort(effectiveRunDistM, effectiveRunSec);
    if (vdot) {
      estimatedVo2Max = vdot;
      vo2Method = 'Daniels VDOT (Steigungsbereinigt / GAP)';
      racePredictions = buildRacePredictions(vdot);
    }
  }

  // Phenotype scoring
  const ftpWkg = ftp / weightKg;
  const sprintScore =
    sport === 'cycling'
      ? peakPowers[5]
        ? clamp(((peakPowers[5]! / weightKg) / 18) * 100, 20, 100)
        : clamp(ftpWkg * 18, 30, 80)
      : avgGapSpeedMs
      ? clamp((avgGapSpeedMs / 5.2) * 100, 25, 100)
      : 50;

  const vo2Score = estimatedVo2Max ? clamp(((estimatedVo2Max - 25) / 50) * 100, 20, 100) : 50;
  const thresholdScore =
    sport === 'cycling'
      ? clamp(((peakPowers[1200] ? peakPowers[1200]! / weightKg : ftpWkg) / 5.0) * 100, 20, 100)
      : vdot
      ? clamp(((vdot - 25) / 45) * 100, 20, 100)
      : 50;
  const climbingScore =
    avgVam !== null
      ? clamp((avgVam / (sport === 'running' ? 1100 : 1350)) * 100, 20, 100)
      : ascentM > 0 && distanceKm > 0
      ? clamp(((ascentM / distanceKm) / 25) * 85, 25, 92)
      : 35;
  const enduranceScore =
    retentionPct !== null
      ? clamp((retentionPct - 65) * 2.5 + (durationHours >= 2 ? 15 : 0), 25, 100)
      : clamp(35 + durationHours * 18, 30, 90);

  const phenotype = buildPhenotypeProfile({
    sport,
    sprintScore,
    vo2Score,
    thresholdScore,
    climbingScore,
    enduranceScore,
    details: {
      sprint:
        sport === 'cycling' && peakPowers[5]
          ? `${(peakPowers[5]! / weightKg).toFixed(1)} W/kg (5s)`
          : `${(avgGapSpeedMs ? avgGapSpeedMs * 3.6 : fallbackSpeedKmh).toFixed(1)} km/h`,
      vo2max: estimatedVo2Max ? `${estimatedVo2Max.toFixed(1)} ml/kg/min` : 'Keine Daten',
      threshold:
        sport === 'cycling'
          ? `${ftpWkg.toFixed(2)} W/kg FTP`
          : vdot
          ? `VDOT ${vdot.toFixed(1)}`
          : 'Keine Daten',
      climbing: avgVam !== null ? `${avgVam} m/h VAM` : `+${Math.round(ascentM)} hm`,
      endurance:
        retentionPct !== null
          ? `${retentionPct}% Haltbarkeit (Q4/Q1)`
          : `${durationHours.toFixed(1)} Std. Umfang`
    }
  });

  // --- 6. Session TSS & Estimated Recovery ---
  const sessionTss =
    track.powerStats?.tss && capabilities.hasNativePower
      ? Math.round(track.powerStats.tss)
      : Math.round(durationHours * effectiveIf * effectiveIf * 100);
  const recovery = estimateRecoveryFromTss(sessionTss);

  return {
    sport,
    movingTimeSec,
    distanceKm,
    ascentM,
    efficiency: {
      ef,
      unit: efUnit,
      method: efMethod,
      decouplingPct,
      decouplingLabel,
      decouplingStatus,
      firstHalfEf,
      secondHalfEf,
      avgHr,
      normalizedPower,
      avgGapSpeedMs,
      reasonUnavailable: efUnavailableReason
    },
    durability: {
      retentionPct,
      totalWorkKj,
      workPerKg,
      status: durabilityStatus,
      reasonUnavailable: durabilityReason
    },
    climbing: {
      avgVam,
      peakClimbVam,
      climbingWkg,
      climbingWkgSource,
      climbCount: climbs.length,
      splitBalancePct,
      splitType
    },
    fueling: {
      climate,
      totalKcal,
      totalKj: totalWorkKj,
      carbsPerHourG,
      totalCarbsG,
      fluidPerHourMl,
      totalFluidMl,
      sodiumPerHourMg,
      intensityFactor
    },
    performance: {
      estimatedVo2Max,
      vo2Method,
      vdot,
      racePredictions,
      cyclingBenchmarks,
      phenotype
    },
    recovery: {
      estimatedHours: recovery.estimatedHours,
      sessionTss,
      readinessLabel: recovery.readinessLabel
    }
  };
}

/**
 * Computes multi-week Load Safety (ACWR, Foster's Monotony & Strain, Weekly CTL Ramp Rate),
 * Longitudinal Efficiency Factor Trend, and Aggregate Athlete Profile from activity history.
 */
export function computeLongitudinalFitnessMetrics(
  activities: LongitudinalActivityInput[],
  dailySeries: LongitudinalDailyPoint[],
  options: { ftp?: number; weightKg?: number; sportFilter?: 'all' | 'cycling' | 'running' } = {}
): LongitudinalFitnessMetrics {
  const weightKg = Math.max(40, options.weightKg || 75);
  const ftp = Math.max(80, options.ftp || 220);

  // 1. ACWR (7-day rolling acute load vs 28-day rolling chronic load)
  const acwrSeries: LongitudinalFitnessMetrics['acwr']['series'] = [];
  for (let i = 0; i < dailySeries.length; i++) {
    const start7 = Math.max(0, i - 6);
    const start28 = Math.max(0, i - 27);
    let sum7 = 0;
    for (let j = start7; j <= i; j++) sum7 += dailySeries[j].tss;
    let sum28 = 0;
    for (let j = start28; j <= i; j++) sum28 += dailySeries[j].tss;

    const acute = sum7 / 7;
    const chronic = sum28 / 28;
    const ratio = chronic >= 5 ? Number(clamp(acute / chronic, 0, 3.0).toFixed(2)) : 0;

    if (i >= 13 && chronic >= 5) {
      acwrSeries.push({
        date: dailySeries[i].date,
        formattedDate: dailySeries[i].formattedDate,
        acwr: ratio,
        acuteLoad: Math.round(acute),
        chronicLoad: Math.round(chronic)
      });
    }
  }

  const latestAcwrPoint = acwrSeries.length > 0 ? acwrSeries[acwrSeries.length - 1] : null;
  let acwrStatus: LongitudinalFitnessMetrics['acwr']['status'] = 'insufficient_data';
  if (latestAcwrPoint) {
    if (latestAcwrPoint.acwr < 0.8) acwrStatus = 'undertraining';
    else if (latestAcwrPoint.acwr <= 1.3) acwrStatus = 'optimal';
    else if (latestAcwrPoint.acwr <= 1.5) acwrStatus = 'caution';
    else acwrStatus = 'high_risk';
  }

  // 2. Foster's Training Monotony & Strain (last 7 calendar days)
  const last7 = dailySeries.slice(-7);
  let monotony7d: number | null = null;
  let strain7d: number | null = null;
  let weeklyLoad = 0;
  let activeDays7d = 0;
  let monotonyStatus: LongitudinalFitnessMetrics['monotonyStrain']['status'] = 'insufficient_data';

  if (last7.length === 7) {
    const loads = last7.map((d) => Math.max(0, d.tss));
    weeklyLoad = Math.round(loads.reduce((sum, v) => sum + v, 0));
    activeDays7d = loads.filter((v) => v > 0).length;
    const mean = weeklyLoad / 7;
    const variance = loads.reduce((sum, v) => sum + (v - mean) * (v - mean), 0) / 7;
    const sd = Math.sqrt(variance);

    if (weeklyLoad > 0) {
      // Guard SD near zero when identical daily loads occur every single day
      const rawMonotony = sd > 1 ? mean / sd : activeDays7d >= 6 ? 3.2 : 1.0;
      monotony7d = Number(clamp(rawMonotony, 0.2, 4.0).toFixed(2));
      strain7d = Math.round(weeklyLoad * monotony7d);
      if (monotony7d > 2.0) monotonyStatus = 'high_risk';
      else if (monotony7d > 1.5) monotonyStatus = 'elevated';
      else monotonyStatus = 'balanced';
    }
  }

  // 3. Weekly CTL Ramp Rate
  const currentCtl = dailySeries.length > 0 ? dailySeries[dailySeries.length - 1].ctl : 0;
  const previousWeekCtl = dailySeries.length >= 8 ? dailySeries[dailySeries.length - 8].ctl : null;
  const weeklyCtlDelta =
    previousWeekCtl !== null ? Number((currentCtl - previousWeekCtl).toFixed(1)) : null;
  let rampStatus: LongitudinalFitnessMetrics['rampRate']['status'] = 'insufficient_data';
  if (weeklyCtlDelta !== null) {
    if (weeklyCtlDelta < -2) rampStatus = 'detraining';
    else if (weeklyCtlDelta <= 2) rampStatus = 'steady';
    else if (weeklyCtlDelta <= 7) rampStatus = 'optimal';
    else rampStatus = 'aggressive';
  }

  // 4. Current Recovery Estimate from latest non-zero session
  const latestNonZeroDay = [...dailySeries].reverse().find((d) => d.tss > 0);
  const latestSessionTss = latestNonZeroDay ? latestNonZeroDay.tss : 0;
  const latestRec = estimateRecoveryFromTss(latestSessionTss);
  const recoveryStatus: LongitudinalFitnessMetrics['recovery'] =
    latestSessionTss <= 10
      ? { estimatedHours: 0, latestSessionTss: 0, readinessLabel: 'fresh' }
      : {
          estimatedHours: latestRec.estimatedHours,
          latestSessionTss,
          readinessLabel: latestRec.readinessLabel
        };

  // 5. Longitudinal Efficiency Factor Trend
  const sortedActs = [...activities].sort((a, b) => a.date.localeCompare(b.date));
  const efPoints: LongitudinalFitnessMetrics['efTrend']['points'] = [];

  for (const act of sortedActs) {
    if (!act.avgHr || act.avgHr < 50 || act.durationSec < 600) continue;
    let efVal: number | null = null;
    let unit = act.sport === 'running' ? 'm/min/bpm' : 'W/bpm';

    if (act.sport === 'cycling' && (act.normalizedPower || act.avgPower)) {
      const p = act.normalizedPower || act.avgPower || 0;
      if (p > 40) {
        efVal = Number((p / act.avgHr).toFixed(2));
        unit = 'W/bpm';
      }
    } else if (act.sport === 'running' && act.distanceKm >= 2) {
      const speedMPerMin = (act.distanceKm * 1000) / (act.durationSec / 60);
      efVal = Number((speedMPerMin / act.avgHr).toFixed(2));
      unit = 'm/min/bpm';
    } else if (act.sport === 'cycling' && act.distanceKm >= 5) {
      const speedKmh = act.distanceKm / (act.durationSec / 3600);
      efVal = Number(((speedKmh * 10) / act.avgHr).toFixed(2));
      unit = 'km/h·10/bpm';
    }

    if (efVal !== null && Number.isFinite(efVal) && efVal > 0) {
      const dStr = act.date.slice(0, 10);
      const dObj = new Date(`${dStr}T12:00:00Z`);
      const formattedDate = Number.isNaN(dObj.getTime())
        ? dStr
        : dObj.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
      efPoints.push({
        date: dStr,
        formattedDate,
        name: act.name,
        sport: act.sport,
        ef: efVal,
        unit
      });
    }
  }

  // Keep EF trend consistent by evaluating a single unit (dominant unit if mixed sports/sensors)
  const unitCounts = new Map<string, number>();
  for (const pt of efPoints) {
    unitCounts.set(pt.unit, (unitCounts.get(pt.unit) || 0) + 1);
  }
  let primaryEfUnit: string | null = null;
  let primaryEfCount = 0;
  for (const [unit, count] of unitCounts.entries()) {
    if (count > primaryEfCount) {
      primaryEfUnit = unit;
      primaryEfCount = count;
    }
  }
  const consistentEfPoints = primaryEfUnit
    ? efPoints.filter((pt) => pt.unit === primaryEfUnit)
    : efPoints;
  // Replace efPoints content with consistent-unit series so chart and delta always share one scale
  efPoints.length = 0;
  efPoints.push(...consistentEfPoints);

  let efChangePct: number | null = null;
  let efDirection: LongitudinalFitnessMetrics['efTrend']['direction'] = 'insufficient_data';
  if (efPoints.length >= 4) {
    const half = Math.floor(efPoints.length / 2);
    const earlyAvg = efPoints.slice(0, half).reduce((s, p) => s + p.ef, 0) / half;
    const recentAvg = efPoints.slice(half).reduce((s, p) => s + p.ef, 0) / (efPoints.length - half);
    if (earlyAvg > 0) {
      efChangePct = Number((((recentAvg - earlyAvg) / earlyAvg) * 100).toFixed(1));
      efDirection =
        efChangePct >= 2 ? 'improving' : efChangePct <= -2 ? 'declining' : 'stable';
    }
  }

  // 6. Aggregate Athlete Profile (VO2max, VDOT Race Predictions & Phenotype)
  const cyclingCount = sortedActs.filter((a) => a.sport === 'cycling').length;
  const runningCount = sortedActs.filter((a) => a.sport === 'running').length;
  const sportFocus: 'cycling' | 'running' | 'mixed' =
    options.sportFilter === 'cycling'
      ? 'cycling'
      : options.sportFilter === 'running'
      ? 'running'
      : cyclingCount > 0 && runningCount > 0
      ? 'mixed'
      : runningCount > cyclingCount
      ? 'running'
      : 'cycling';

  const bestPeaks: Partial<Record<number, number | null>> = {};
  const peakDurations = [5, 60, 300, 1200, 3600];
  let bestVdot: number | null = null;
  let bestRunSpeedMs = 0;
  let maxDurationHr = 0;
  let maxAscentRate = 0;

  for (const act of sortedActs) {
    maxDurationHr = Math.max(maxDurationHr, act.durationSec / 3600);
    if (act.ascentM && act.durationSec >= 900) {
      const estVam = (act.ascentM / (act.durationSec / 3600)) * 2.2; // Climbing fraction proxy
      maxAscentRate = Math.max(maxAscentRate, Math.min(1800, estVam));
    }

    if (act.sport === 'cycling' && act.peaks) {
      for (const dur of peakDurations) {
        const val = act.peaks[dur];
        if (val && val > (bestPeaks[dur] || 0)) {
          bestPeaks[dur] = val;
        }
      }
    }

    if (act.sport === 'running' && act.distanceKm >= 2.5 && act.durationSec >= 480) {
      const actVdot = calculateVdotFromEffort(act.distanceKm * 1000, act.durationSec);
      if (actVdot && (!bestVdot || actVdot > bestVdot)) {
        bestVdot = actVdot;
      }
      bestRunSpeedMs = Math.max(bestRunSpeedMs, (act.distanceKm * 1000) / act.durationSec);
    }
  }

  const cyclingBenchmarks = buildCyclingBenchmarks(bestPeaks, weightKg);
  const racePredictions = buildRacePredictions(bestVdot);

  let aggVo2: number | null = null;
  let vo2Source: string | null = null;

  if (sportFocus !== 'running' && bestPeaks[300]) {
    aggVo2 = Number(clamp(10.8 * (bestPeaks[300]! / weightKg) + 7, 28, 88).toFixed(1));
    vo2Source = 'Beste 5-Min Power (Historie)';
  } else if (sportFocus !== 'cycling' && bestVdot) {
    aggVo2 = bestVdot;
    vo2Source = 'Bester Lauf-VDOT (Historie)';
  } else if (bestVdot) {
    aggVo2 = bestVdot;
    vo2Source = 'Bester Lauf-VDOT (Historie)';
  } else if (ftp > 0 && cyclingCount > 0) {
    aggVo2 = Number(clamp(10.8 * ((ftp * 1.18) / weightKg) + 7, 28, 88).toFixed(1));
    vo2Source = 'FTP-Referenzprofil';
  }

  const phenotypeSport: 'cycling' | 'running' =
    sportFocus === 'running' || (sportFocus === 'mixed' && runningCount > cyclingCount)
      ? 'running'
      : 'cycling';

  const ftpWkg = ftp / weightKg;
  const phenotype = buildPhenotypeProfile({
    sport: phenotypeSport,
    sprintScore:
      phenotypeSport === 'cycling'
        ? bestPeaks[5]
          ? clamp(((bestPeaks[5]! / weightKg) / 18) * 100, 20, 100)
          : clamp(ftpWkg * 18, 30, 80)
        : bestRunSpeedMs > 0
        ? clamp((bestRunSpeedMs / 5.2) * 100, 25, 100)
        : 45,
    vo2Score: aggVo2 ? clamp(((aggVo2 - 25) / 50) * 100, 20, 100) : 45,
    thresholdScore:
      phenotypeSport === 'cycling'
        ? clamp(((bestPeaks[1200] ? bestPeaks[1200]! / weightKg : ftpWkg) / 5.0) * 100, 20, 100)
        : bestVdot
        ? clamp(((bestVdot - 25) / 45) * 100, 20, 100)
        : 45,
    climbingScore:
      maxAscentRate > 0 ? clamp((maxAscentRate / 1250) * 100, 25, 96) : 40,
    enduranceScore: clamp(30 + maxDurationHr * 14 + (currentCtl > 40 ? 15 : 0), 25, 98),
    details: {
      sprint:
        phenotypeSport === 'cycling' && bestPeaks[5]
          ? `${(bestPeaks[5]! / weightKg).toFixed(1)} W/kg (5s)`
          : bestRunSpeedMs > 0
          ? `${(bestRunSpeedMs * 3.6).toFixed(1)} km/h`
          : 'Keine Spitzenwerte',
      vo2max: aggVo2 ? `${aggVo2.toFixed(1)} ml/kg/min` : 'Keine Daten',
      threshold:
        phenotypeSport === 'cycling'
          ? `${ftpWkg.toFixed(2)} W/kg FTP`
          : bestVdot
          ? `VDOT ${bestVdot.toFixed(1)}`
          : 'Keine Daten',
      climbing: maxAscentRate > 0 ? `~${Math.round(maxAscentRate)} m/h VAM` : 'Flachprofil',
      endurance: `Max ${maxDurationHr.toFixed(1)} Std. · CTL ${currentCtl}`
    }
  });

  return {
    acwr: {
      current: latestAcwrPoint ? latestAcwrPoint.acwr : null,
      acuteLoad7d: latestAcwrPoint ? latestAcwrPoint.acuteLoad : 0,
      chronicLoad28d: latestAcwrPoint ? latestAcwrPoint.chronicLoad : 0,
      status: acwrStatus,
      series: acwrSeries
    },
    monotonyStrain: {
      monotony7d,
      strain7d,
      weeklyLoad,
      activeDays7d,
      status: monotonyStatus
    },
    rampRate: {
      weeklyCtlDelta,
      currentCtl,
      previousWeekCtl,
      status: rampStatus
    },
    recovery: recoveryStatus,
    efTrend: {
      points: efPoints,
      changePct: efChangePct,
      direction: efDirection
    },
    athleteProfile: {
      sportFocus,
      estimatedVo2Max: aggVo2,
      vo2Source,
      vdot: bestVdot,
      racePredictions,
      cyclingBenchmarks,
      phenotype
    }
  };
}
