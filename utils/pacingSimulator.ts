import { GPXTrack } from '../types';
import { calculateDistance } from './gpxUtils';

export type PacingStrategyMode = 'even' | 'variable_climb' | 'negative_split';

export interface PacingSimulationOptions {
  ftpWatts: number;
  riderWeightKg: number;
  bikeWeightKg: number;
  strategy: PacingStrategyMode;
  targetIfPct: number; // e.g., 75 means 0.75 IF
  windSpeedKmh: number; // positive = headwind, negative = tailwind
  cda: number; // e.g., 0.30 (aero), 0.33 (hoods), 0.38 (upright)
  crr: number; // e.g., 0.0040 (road), 0.0065 (gravel), 0.0095 (mtb)
  segmentLengthKm?: number;
}

export interface PacingSegmentSplit {
  segmentIndex: number;
  startKm: number;
  endKm: number;
  distanceKm: number;
  startEleM: number;
  endEleM: number;
  ascentM: number;
  descentM: number;
  avgGradePct: number;
  terrainType: 'climb' | 'flat' | 'descent';
  targetPowerW: number;
  targetWkg: number;
  targetPctFtp: number;
  simulatedSpeedKmh: number;
  segmentTimeSec: number;
  cumulativeTimeSec: number;
  actualCumulativeTimeSec: number | null;
  timeDeltaSec: number | null; // negative = faster than actual
  endWbalPct: number;
  nutritionCue: string | null;
  lat: number;
  lng: number;
}

export interface PacingSimulationResult {
  totalDistanceKm: number;
  simulatedTotalTimeSec: number;
  actualTotalTimeSec: number | null;
  totalTimeSavedSec: number | null;
  avgTargetPowerW: number;
  normalizedTargetPowerW: number;
  targetIf: number;
  estimatedTss: number;
  estimatedWorkKj: number;
  estimatedCarbsGrams: number;
  minWbalPct: number;
  splits: PacingSegmentSplit[];
}

/**
 * Solves for steady-state velocity v (m/s) given mechanical power P (Watts),
 * road gradient, mass, rolling resistance, aero drag, and headwind using
 * Newton-Raphson / binary search iteration.
 */
function solveVelocityMs(
  wheelPowerW: number,
  grade: number,
  totalMassKg: number,
  cda: number,
  crr: number,
  headwindMs: number
): number {
  const g = 9.81;
  const rho = 1.225;
  const fGravity = totalMassKg * g * Math.sin(Math.atan(grade));
  const fRoll = totalMassKg * g * crr * Math.cos(Math.atan(grade));

  let low = 1.2; // 4.3 km/h min climbing speed
  let high = 23.5; // 84.6 km/h max descent speed

  for (let iter = 0; iter < 22; iter++) {
    const mid = 0.5 * (low + high);
    const vAir = mid + headwindMs;
    const fAero = 0.5 * rho * cda * vAir * Math.abs(vAir);
    const requiredWheelPower = (fGravity + fRoll + fAero) * mid;

    if (requiredWheelPower < wheelPowerW) {
      low = mid;
    } else {
      high = mid;
    }
  }

  return 0.5 * (low + high);
}

/**
 * BestBikeSplit-inspired route pacing & target-time physics simulator.
 */
export function runPacingSimulation(
  track: GPXTrack,
  options: PacingSimulationOptions
): PacingSimulationResult {
  const points = track.points || [];
  const ftp = Math.max(80, options.ftpWatts || 250);
  const riderWeight = Math.max(35, options.riderWeightKg || 75);
  const bikeWeight = Math.max(0, options.bikeWeightKg ?? 8.5);
  const totalMassKg = riderWeight + bikeWeight;
  const baseTargetPower = ftp * (Math.max(40, Math.min(115, options.targetIfPct)) / 100);
  const headwindMs = (options.windSpeedKmh || 0) / 3.6;
  const cda = Math.max(0.18, Math.min(0.65, options.cda || 0.32));
  const crr = Math.max(0.002, Math.min(0.02, options.crr || 0.0045));

  const totalTrackKm = Math.max(0.1, track.distance || 1);
  const segLenKm =
    options.segmentLengthKm ||
    (totalTrackKm <= 25 ? 1 : totalTrackKm <= 80 ? 2.5 : totalTrackKm <= 160 ? 5 : 10);

  if (points.length < 2) {
    return {
      totalDistanceKm: 0,
      simulatedTotalTimeSec: 0,
      actualTotalTimeSec: null,
      totalTimeSavedSec: null,
      avgTargetPowerW: Math.round(baseTargetPower),
      normalizedTargetPowerW: Math.round(baseTargetPower),
      targetIf: Number((baseTargetPower / ftp).toFixed(2)),
      estimatedTss: 0,
      estimatedWorkKj: 0,
      estimatedCarbsGrams: 0,
      minWbalPct: 100,
      splits: []
    };
  }

  const cpWatts = ftp * 0.96;
  const wPrimeJ = 20000;
  let currentWbalJ = wPrimeJ;
  let minWbalPct = 100;

  const firstTimeMs =
    points[0].time instanceof Date
      ? points[0].time.getTime()
      : points[0].time
      ? new Date(points[0].time).getTime()
      : null;
  const lastPt = points[points.length - 1];
  const lastTimeMs =
    lastPt.time instanceof Date
      ? lastPt.time.getTime()
      : lastPt.time
      ? new Date(lastPt.time).getTime()
      : null;
  const hasRealTimestamps =
    firstTimeMs !== null &&
    lastTimeMs !== null &&
    Number.isFinite(firstTimeMs) &&
    Number.isFinite(lastTimeMs) &&
    lastTimeMs > firstTimeMs + 60000;

  const splits: PacingSegmentSplit[] = [];
  let segStartKm = 0;
  let segStartEle = points[0].ele || 0;
  let segAscent = 0;
  let segDescent = 0;
  let cumDistKm = 0;
  let cumulativeSimSec = 0;
  let totalWorkJoules = 0;
  let sumFourthPowerSec = 0;
  let lastNutritionMarkSec = 0;

  for (let i = 1; i < points.length; i++) {
    const p1 = points[i - 1];
    const p2 = points[i];
    const dKm = calculateDistance(p1, p2);
    if (!Number.isFinite(dKm) || dKm <= 0) continue;

    cumDistKm += dKm;
    const dEle = (p2.ele || 0) - (p1.ele || 0);
    if (dEle > 0) segAscent += dEle;
    else segDescent += Math.abs(dEle);

    const isLastPoint = i === points.length - 1;
    const currentSegKm = cumDistKm - segStartKm;

    if (currentSegKm >= segLenKm || (isLastPoint && currentSegKm > 0.05)) {
      const endEle = p2.ele || 0;
      const avgGrade = (endEle - segStartEle) / (currentSegKm * 1000);
      const avgGradePct = Number((avgGrade * 100).toFixed(1));
      const progressRatio = cumDistKm / Math.max(0.1, totalTrackKm);

      let terrainType: PacingSegmentSplit['terrainType'] = 'flat';
      if (avgGradePct >= 2.2) terrainType = 'climb';
      else if (avgGradePct <= -2.0) terrainType = 'descent';

      // Strategy-dependent target power multiplier
      let powerMultiplier = 1.0;
      if (options.strategy === 'variable_climb') {
        // BestBikeSplit optimal pacing: push harder on climbs where aero penalty is low, recover on descents
        if (avgGradePct >= 7) powerMultiplier = 1.13;
        else if (avgGradePct >= 4) powerMultiplier = 1.09;
        else if (avgGradePct >= 2) powerMultiplier = 1.05;
        else if (avgGradePct <= -4.5) powerMultiplier = 0.25;
        else if (avgGradePct <= -2) powerMultiplier = 0.62;
        else powerMultiplier = 0.96;
      } else if (options.strategy === 'negative_split') {
        // Start conservative (-6%), finish strong (+6%)
        const ramp = 0.94 + 0.12 * progressRatio;
        if (avgGradePct <= -4.5) powerMultiplier = 0.3;
        else if (avgGradePct <= -2) powerMultiplier = 0.68 * ramp;
        else powerMultiplier = ramp * (terrainType === 'climb' ? 1.04 : 1.0);
      } else {
        // Even pacing (still coast on steep descents)
        if (avgGradePct <= -4.5) powerMultiplier = 0.3;
        else if (avgGradePct <= -2) powerMultiplier = 0.72;
        else powerMultiplier = 1.0;
      }

      let targetPowerW = Math.round(baseTargetPower * powerMultiplier);
      // Guard W'bal so athlete doesn't blow up mid-climb
      if (targetPowerW > cpWatts) {
        const maxSustainableOverCp = Math.max(cpWatts, cpWatts + (currentWbalJ * 0.65) / 300);
        targetPowerW = Math.round(Math.min(targetPowerW, maxSustainableOverCp));
      }

      const wheelPowerW = targetPowerW * 0.972;
      const vMs = solveVelocityMs(wheelPowerW, avgGrade, totalMassKg, cda, crr, headwindMs);
      const simulatedSpeedKmh = Number((vMs * 3.6).toFixed(1));
      const segmentTimeSec = Math.max(1, Math.round((currentSegKm * 1000) / vMs));
      cumulativeSimSec += segmentTimeSec;

      // Update W'bal across segment
      if (targetPowerW > cpWatts) {
        currentWbalJ = Math.max(0, currentWbalJ - (targetPowerW - cpWatts) * segmentTimeSec);
      } else {
        const tauW = 546 * Math.exp(-0.01 * Math.max(0, cpWatts - targetPowerW)) + 316;
        currentWbalJ = wPrimeJ - (wPrimeJ - currentWbalJ) * Math.exp(-segmentTimeSec / tauW);
      }
      const endWbalPct = Math.max(0, Math.min(100, Math.round((currentWbalJ / wPrimeJ) * 100)));
      if (endWbalPct < minWbalPct) minWbalPct = endWbalPct;

      totalWorkJoules += targetPowerW * segmentTimeSec;
      sumFourthPowerSec += Math.pow(targetPowerW, 4) * segmentTimeSec;

      let actualCumulativeTimeSec: number | null = null;
      let timeDeltaSec: number | null = null;
      if (hasRealTimestamps && firstTimeMs !== null && p2.time) {
        const ptTimeMs = p2.time instanceof Date ? p2.time.getTime() : new Date(p2.time).getTime();
        if (Number.isFinite(ptTimeMs) && ptTimeMs >= firstTimeMs) {
          actualCumulativeTimeSec = Math.round((ptTimeMs - firstTimeMs) / 1000);
          timeDeltaSec = cumulativeSimSec - actualCumulativeTimeSec;
        }
      }

      // Nutrition cue every ~25 minutes or right before a major climb
      let nutritionCue: string | null = null;
      if (cumulativeSimSec - lastNutritionMarkSec >= 1500) {
        const carbsNow = targetPowerW > ftp * 0.8 ? 30 : 25;
        nutritionCue = `${carbsNow}g KH (Gel / Drink) + 200ml Wasser`;
        lastNutritionMarkSec = cumulativeSimSec;
      }

      splits.push({
        segmentIndex: splits.length + 1,
        startKm: Number(segStartKm.toFixed(1)),
        endKm: Number(cumDistKm.toFixed(1)),
        distanceKm: Number(currentSegKm.toFixed(2)),
        startEleM: Math.round(segStartEle),
        endEleM: Math.round(endEle),
        ascentM: Math.round(segAscent),
        descentM: Math.round(segDescent),
        avgGradePct,
        terrainType,
        targetPowerW,
        targetWkg: Number((targetPowerW / riderWeight).toFixed(2)),
        targetPctFtp: Math.round((targetPowerW / ftp) * 100),
        simulatedSpeedKmh,
        segmentTimeSec,
        cumulativeTimeSec: cumulativeSimSec,
        actualCumulativeTimeSec,
        timeDeltaSec,
        endWbalPct,
        nutritionCue,
        lat: p2.lat,
        lng: p2.lng
      });

      segStartKm = cumDistKm;
      segStartEle = endEle;
      segAscent = 0;
      segDescent = 0;
    }
  }

  const avgTargetPowerW =
    cumulativeSimSec > 0 ? Math.round(totalWorkJoules / cumulativeSimSec) : Math.round(baseTargetPower);
  const normalizedTargetPowerW =
    cumulativeSimSec > 0
      ? Math.max(avgTargetPowerW, Math.round(Math.pow(sumFourthPowerSec / cumulativeSimSec, 0.25)))
      : avgTargetPowerW;
  const targetIf = Number((normalizedTargetPowerW / ftp).toFixed(2));
  const estimatedTss = Math.round(((cumulativeSimSec * normalizedTargetPowerW * targetIf) / (ftp * 3600)) * 100);
  const estimatedWorkKj = Math.round(totalWorkJoules / 1000);
  const hours = cumulativeSimSec / 3600;
  const carbsPerHour = targetIf >= 0.85 ? 80 : targetIf >= 0.75 ? 65 : 50;
  const estimatedCarbsGrams = Math.round(hours * carbsPerHour);

  const actualTotalTimeSec =
    hasRealTimestamps && firstTimeMs !== null && lastTimeMs !== null
      ? Math.round((lastTimeMs - firstTimeMs) / 1000)
      : track.duration && track.duration > 60
      ? Math.round(track.duration)
      : null;

  const totalTimeSavedSec =
    actualTotalTimeSec !== null ? actualTotalTimeSec - cumulativeSimSec : null;

  return {
    totalDistanceKm: Number(cumDistKm.toFixed(1)),
    simulatedTotalTimeSec: cumulativeSimSec,
    actualTotalTimeSec,
    totalTimeSavedSec,
    avgTargetPowerW,
    normalizedTargetPowerW,
    targetIf,
    estimatedTss,
    estimatedWorkKj,
    estimatedCarbsGrams,
    minWbalPct,
    splits
  };
}
