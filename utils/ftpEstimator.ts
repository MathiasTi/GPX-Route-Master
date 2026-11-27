import { isCyclingType, calculateDistance } from './gpxUtils';
import { estimateCriticalPowerFromBests } from './wbalEngine';

export type FtpMethodId = 'mmp_60m' | 'critical_power' | 'mmp_20m' | 'mmp_8m' | 'climbing_physics';
export type FtpFieldTestType = '20min' | '8min' | 'ramp' | '60min';
export type FtpConfidence = 'high' | 'medium' | 'low' | 'none';

export interface FtpEstimateCandidate {
  method: FtpMethodId;
  label: string;
  ftpWatts: number;
  wkg: number;
  confidence: 'high' | 'medium' | 'low';
  basisValue: string;
  activityName?: string;
  activityDate?: string;
  isRecent90d: boolean;
}

export interface FtpEstimationReport {
  recommendedFtp: number | null;
  recommendedWkg: number | null;
  confidence: FtpConfidence;
  bestMethod: FtpEstimateCandidate | null;
  candidates: FtpEstimateCandidate[];
  powerActivityCount: number;
  climbActivityCount: number;
  summary: string;
}

export interface FtpActivityPoint {
  lat?: number;
  lng?: number;
  ele?: number;
  time?: string | number;
  power?: number;
  hr?: number;
}

export interface FtpActivityInput {
  id?: string;
  name?: string;
  type?: string;
  date?: string;
  distance?: number;
  duration?: number;
  ascent?: number;
  points_json?: string | null;
  points?: FtpActivityPoint[] | null;
  powerSamples?: number[];
  peaks?: Record<number, number> | null;
  hasPower?: boolean;
}

const FIELD_TEST_META: Record<FtpFieldTestType, { factor: number; label: string }> = {
  '20min': { factor: 0.95, label: '20-Min-Feldtest (×0.95)' },
  '8min': { factor: 0.90, label: '8-Min-Feldtest (×0.90)' },
  ramp: { factor: 0.75, label: 'Ramp-Test 1-Min-MAP (×0.75)' },
  '60min': { factor: 1.0, label: '60-Min-Zeitfahren (×1.00)' }
};

export function calculateFtpFromFieldTest(
  testType: FtpFieldTestType,
  avgWatts: number,
  userWeightKg: number = 75
): { ftpWatts: number; wkg: number; factor: number; label: string } | null {
  if (!Number.isFinite(avgWatts) || avgWatts <= 0) {
    return null;
  }
  const meta = FIELD_TEST_META[testType];
  if (!meta) return null;
  const safeWeight = Number.isFinite(userWeightKg) && userWeightKg >= 30 ? userWeightKg : 75;
  const ftpWatts = Math.round(avgWatts * meta.factor);
  if (!Number.isFinite(ftpWatts) || ftpWatts <= 0) {
    return null;
  }
  const wkg = Number((ftpWatts / safeWeight).toFixed(2));
  return {
    ftpWatts,
    wkg,
    factor: meta.factor,
    label: meta.label
  };
}

function isLikelyCyclingActivity(type?: string, name?: string): boolean {
  const raw = `${type || ''} ${name || ''}`.toLowerCase();
  if (!raw.trim()) return false;
  if (
    raw.includes('run') ||
    raw.includes('lauf') ||
    raw.includes('jog') ||
    raw.includes('trail') ||
    raw.includes('walk') ||
    raw.includes('hike') ||
    raw.includes('wand') ||
    raw.includes('swim') ||
    raw.includes('strength') ||
    raw.includes('kraft') ||
    raw.includes('yoga') ||
    raw.includes('e_bik') ||
    raw.includes('ebike') ||
    raw.includes('e-bike') ||
    raw.includes('pedelec') ||
    raw.includes('chrono')
  ) {
    return false;
  }
  return isCyclingType(type, name);
}

function parsePointsFromActivity(act: FtpActivityInput): FtpActivityPoint[] {
  if (Array.isArray(act.points) && act.points.length > 0) {
    return act.points;
  }
  if (typeof act.points_json === 'string' && act.points_json.trim().startsWith('[')) {
    try {
      const parsed = JSON.parse(act.points_json);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

function parseTimeMs(val: string | number | undefined): number | null {
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return null;
    return val > 1e11 ? val : val * 1000;
  }
  if (typeof val === 'string' && val.trim()) {
    const ms = new Date(val).getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function computeActivityDurationSec(act: FtpActivityInput, pts: FtpActivityPoint[]): number {
  if (Number.isFinite(Number(act.duration)) && Number(act.duration) > 0) {
    return Number(act.duration);
  }
  if (pts.length >= 2) {
    const firstMs = parseTimeMs(pts[0]?.time);
    const lastMs = parseTimeMs(pts[pts.length - 1]?.time);
    if (firstMs !== null && lastMs !== null && lastMs > firstMs) {
      return Math.round((lastMs - firstMs) / 1000);
    }
    return pts.length - 1;
  }
  return 0;
}

function buildOneHzPowerTimeline(
  pts: FtpActivityPoint[],
  fallbackPowerSamples: number[],
  durSec: number
): { samples: number[]; dtSec: number } {
  const timedSamples: Array<{ tSec: number; watts: number }> = [];
  for (const p of pts) {
    const w = Number(p?.power);
    const tMs = parseTimeMs(p?.time);
    if (Number.isFinite(w) && w >= 0 && w <= 2500 && tMs !== null) {
      timedSamples.push({ tSec: Math.round(tMs / 1000), watts: w });
    }
  }

  if (timedSamples.length >= 10) {
    const rawStepSecs: number[] = [];
    for (let i = 1; i < timedSamples.length; i++) {
      const dt = timedSamples[i].tSec - timedSamples[i - 1].tSec;
      if (dt > 0 && dt <= 60) rawStepSecs.push(dt);
    }
    rawStepSecs.sort((a, b) => a - b);
    const medianDt = rawStepSecs.length > 0 ? rawStepSecs[Math.floor(rawStepSecs.length / 2)] : 1;
    // Distinguish genuine recording pauses from regular coarse downsampling intervals
    const pauseThresholdSec = Math.max(15, Math.round(medianDt * 2.5));

    const timeline: number[] = [timedSamples[0].watts];
    for (let i = 1; i < timedSamples.length; i++) {
      const prev = timedSamples[i - 1];
      const curr = timedSamples[i];
      const gap = curr.tSec - prev.tSec;
      if (gap <= 0) {
        timeline[timeline.length - 1] = curr.watts;
        continue;
      }
      if (gap <= pauseThresholdSec) {
        const fillCount = Math.min(gap - 1, 120);
        for (let k = 0; k < fillCount; k++) {
          timeline.push(prev.watts);
        }
      } else {
        // Pause gap: dilute contiguous rolling windows with explicit 0W coasting/rest seconds (capped)
        const zeroFill = Math.min(gap - 1, 1800);
        for (let k = 0; k < zeroFill; k++) {
          timeline.push(0);
        }
      }
      timeline.push(curr.watts);
      if (timeline.length > 86400) break;
    }

    if (timeline.length >= 10) {
      return { samples: timeline, dtSec: 1 };
    }
  }

  const totalPtsForDt = Math.max(pts.length, fallbackPowerSamples.length);
  const dtSec = durSec > 0 && totalPtsForDt > 1 ? Math.max(1, durSec / (totalPtsForDt - 1)) : 1;
  return { samples: fallbackPowerSamples, dtSec };
}

function computeRollingPeakWatts(powerSamples: number[], dtSec: number, durationSec: number): number {
  const winPts = Math.max(5, Math.round(durationSec / Math.max(0.5, dtSec)));
  if (powerSamples.length < winPts) return 0;

  let currentSum = 0;
  for (let i = 0; i < winPts; i++) {
    currentSum += powerSamples[i];
  }
  let maxSum = currentSum;
  for (let i = winPts; i < powerSamples.length; i++) {
    currentSum += powerSamples[i] - powerSamples[i - winPts];
    if (currentSum > maxSum) {
      maxSum = currentSum;
    }
  }
  return Math.round(maxSum / winPts);
}

/**
 * Estimates peak sustained climbing FTP from steep continuous ascents (>= 10 min, >= 4% avg grade)
 * using road/gravel mechanical physics (gravity + rolling resistance + aerodynamic drag).
 */
function estimateClimbingPhysicsFtp(
  act: FtpActivityInput,
  pts: FtpActivityPoint[],
  systemMassKg: number
): { ftpWatts: number; climbWatts: number; durationMin: number; ascentM: number; gradePct: number } | null {
  const C_RR = 0.005;
  const CDA = 0.35;
  const AIR_DENSITY = 1.225;
  const DRIVETRAIN_EFF = 0.97;
  const G = 9.80665;

  const evalSegment = (distKm: number, ascentM: number, durSec: number) => {
    if (durSec < 600 || ascentM < 250 || distKm <= 0.5) return null;
    const distM = distKm * 1000;
    const grade = ascentM / distM;
    if (grade < 0.04 || grade > 0.25) return null;

    const speedMs = distM / durSec;
    if (!Number.isFinite(speedMs) || speedMs < 0.8 || speedMs > 14) return null;

    const theta = Math.atan(grade);
    const pGravity = systemMassKg * G * speedMs * Math.sin(theta);
    const pRolling = systemMassKg * G * C_RR * speedMs * Math.cos(theta);
    const pAero = 0.5 * AIR_DENSITY * CDA * Math.pow(speedMs, 3);
    const climbWatts = Math.round((pGravity + pRolling + pAero) / DRIVETRAIN_EFF);

    if (!Number.isFinite(climbWatts) || climbWatts < 60 || climbWatts > 600) return null;
    const factor = durSec >= 1800 ? 0.96 : durSec >= 900 ? 0.94 : 0.90;
    const ftpWatts = Math.round(climbWatts * factor);
    if (ftpWatts < 80 || ftpWatts > 550) return null;

    return {
      ftpWatts,
      climbWatts,
      durationMin: Math.round(durSec / 60),
      ascentM: Math.round(ascentM),
      gradePct: Number((grade * 100).toFixed(1))
    };
  };

  let best: ReturnType<typeof evalSegment> = null;

  if (pts.length >= 20) {
    const actDur = computeActivityDurationSec(act, pts);
    const defaultDt = actDur > 0 ? Math.max(1, actDur / Math.max(1, pts.length - 1)) : 5;

    // 3-point moving-average elevation smoothing reduces GPS altitude jitter on flat roads
    const smoothedEle: Array<number | null> = pts.map((_, idx) => {
      let sum = 0;
      let cnt = 0;
      for (let k = Math.max(0, idx - 1); k <= Math.min(pts.length - 1, idx + 1); k++) {
        const rawEle = Number(pts[k]?.ele);
        if (pts[k]?.ele !== undefined && Number.isFinite(rawEle)) {
          sum += rawEle;
          cnt++;
        }
      }
      return cnt > 0 ? sum / cnt : null;
    });

    // Scan sustained ascending segments over GPS+elevation points
    let segStart = -1;
    let segStartEle = 0;
    let segMaxEle = 0;
    let segDistKm = 0;
    let segDurSec = 0;
    let dipGrace = 0;

    const finalizeSegment = () => {
      const netGainM = Math.max(0, segMaxEle - segStartEle);
      const candidate = evalSegment(segDistKm, netGainM, segDurSec);
      if (candidate && (!best || candidate.climbWatts > best.climbWatts)) {
        best = candidate;
      }
      segStart = -1;
      segStartEle = 0;
      segMaxEle = 0;
      segDistKm = 0;
      segDurSec = 0;
      dipGrace = 0;
    };

    for (let i = 1; i < pts.length; i++) {
      const prev = pts[i - 1];
      const curr = pts[i];
      const prevEle = smoothedEle[i - 1];
      const currEle = smoothedEle[i];
      if (
        prev?.lat === undefined ||
        prev?.lng === undefined ||
        curr?.lat === undefined ||
        curr?.lng === undefined ||
        prevEle === null ||
        currEle === null
      ) {
        if (segStart >= 0) finalizeSegment();
        continue;
      }

      const lat1 = Number(prev.lat);
      const lng1 = Number(prev.lng);
      const lat2 = Number(curr.lat);
      const lng2 = Number(curr.lng);
      const eleDiff = currEle - prevEle;
      const stepDistKm = calculateDistance({ lat: lat1, lng: lng1 }, { lat: lat2, lng: lng2 });
      const t1 = parseTimeMs(prev.time);
      const t2 = parseTimeMs(curr.time);
      const rawStepDur = t1 !== null && t2 !== null && t2 > t1 ? (t2 - t1) / 1000 : defaultDt;

      // Split climb segments cleanly across pause gaps > 60s
      if (rawStepDur > 60) {
        if (segStart >= 0) finalizeSegment();
        continue;
      }

      const stepDur = rawStepDur;
      if (!Number.isFinite(stepDistKm) || stepDistKm > 0.5 || !Number.isFinite(eleDiff)) continue;

      const stepGrade = stepDistKm > 0.002 ? eleDiff / (stepDistKm * 1000) : 0;
      if (stepGrade >= 0.03) {
        if (segStart < 0) {
          segStart = i - 1;
          segStartEle = prevEle;
          segMaxEle = currEle;
        } else if (currEle > segMaxEle) {
          segMaxEle = currEle;
        }
        segDistKm += stepDistKm;
        segDurSec += stepDur;
        dipGrace = 0;
      } else if (segStart >= 0 && dipGrace < 3 && eleDiff >= -3) {
        segDistKm += stepDistKm;
        segDurSec += stepDur;
        if (currEle > segMaxEle) segMaxEle = currEle;
        dipGrace++;
      } else if (segStart >= 0) {
        finalizeSegment();
      }
    }
    if (segStart >= 0) finalizeSegment();
  }

  // Fallback on aggregate climbing ride stats only when no detailed point series exists
  if (!best && pts.length < 20 && Number(act.ascent || 0) >= 400 && Number(act.distance || 0) > 5 && Number(act.duration || 0) >= 900) {
    best = evalSegment(Number(act.distance), Number(act.ascent), Number(act.duration));
  }

  return best;
}

interface DurationPeakRecord {
  watts: number;
  activityName?: string;
  activityDate?: string;
  isRecent90d: boolean;
}

export function estimateFtpFromActivities(
  activities: FtpActivityInput[],
  options: {
    userWeightKg?: number;
    bikeWeightKg?: number;
    lookbackDays?: number;
    now?: Date;
  } = {}
): FtpEstimationReport {
  const safeWeight = Number.isFinite(Number(options.userWeightKg)) && Number(options.userWeightKg) >= 30
    ? Number(options.userWeightKg)
    : 75;
  const safeBikeWeight = Number.isFinite(Number(options.bikeWeightKg)) && Number(options.bikeWeightKg) >= 0
    ? Number(options.bikeWeightKg)
    : 8.5;
  const lookbackDays = Number.isFinite(Number(options.lookbackDays)) && Number(options.lookbackDays) > 0
    ? Number(options.lookbackDays)
    : 90;
  const nowMs = (options.now || new Date()).getTime();
  const cutoffMs = nowMs - lookbackDays * 86400 * 1000;

  const durations = [300, 480, 1200, 3600] as const;
  const recentPeaks: Record<number, DurationPeakRecord> = {};
  const allTimePeaks: Record<number, DurationPeakRecord> = {};

  let powerActivityCount = 0;
  let climbActivityCount = 0;

  interface ClimbCandidateBest {
    ftpWatts: number;
    climbWatts: number;
    durationMin: number;
    ascentM: number;
    gradePct: number;
    activityName?: string;
    activityDate?: string;
    isRecent90d: boolean;
  }
  let bestRecentClimb: ClimbCandidateBest | null = null;
  let bestAllTimeClimb: ClimbCandidateBest | null = null;

  for (const act of activities || []) {
    if (!isLikelyCyclingActivity(act?.type, act?.name)) continue;

    const actMs = act?.date ? new Date(act.date).getTime() : NaN;
    const isRecent = Number.isFinite(actMs) ? actMs >= cutoffMs : false;
    const actDateStr = typeof act?.date === 'string' ? act.date.slice(0, 10) : undefined;

    const pts = parsePointsFromActivity(act);
    const durSec = computeActivityDurationSec(act, pts);

    // 1. Power-meter MMP extraction
    let powerSamples: number[] = [];
    if (Array.isArray(act.powerSamples) && act.powerSamples.length >= 10) {
      powerSamples = act.powerSamples.filter((w) => Number.isFinite(w) && w >= 0 && w <= 2500);
    } else if (pts.length >= 10) {
      for (const p of pts) {
        const w = Number(p?.power);
        if (Number.isFinite(w) && w >= 0 && w <= 2500) {
          powerSamples.push(w);
        }
      }
    }

    const hasGenuinePowerSamples = powerSamples.some((w) => w > 10);
    const hasPrecomputedPeaks =
      Boolean(act.hasPower !== false) &&
      act.peaks &&
      typeof act.peaks === 'object' &&
      Object.values(act.peaks).some((v) => Number(v) > 10);

    if (hasGenuinePowerSamples || hasPrecomputedPeaks) {
      powerActivityCount++;
      const timeline = hasGenuinePowerSamples
        ? buildOneHzPowerTimeline(pts, powerSamples, durSec)
        : null;

      for (const d of durations) {
        let peakW = 0;
        const durationEligible = durSec <= 0 || durSec >= d * 0.9;
        // Prefer full-resolution precomputed 1-Hz telemetry peaks first when available
        if (durationEligible && act.hasPower !== false && act.peaks && Number(act.peaks[d] || 0) > 10) {
          peakW = Math.round(Number(act.peaks[d]));
        }
        if (peakW <= 0 && hasGenuinePowerSamples && timeline && durationEligible) {
          peakW = computeRollingPeakWatts(timeline.samples, timeline.dtSec, d);
        }
        if (peakW <= 20 || peakW > 2000) continue;

        if (!allTimePeaks[d] || peakW > allTimePeaks[d].watts) {
          allTimePeaks[d] = {
            watts: peakW,
            activityName: act.name,
            activityDate: actDateStr,
            isRecent90d: isRecent
          };
        }
        if (isRecent && (!recentPeaks[d] || peakW > recentPeaks[d].watts)) {
          recentPeaks[d] = {
            watts: peakW,
            activityName: act.name,
            activityDate: actDateStr,
            isRecent90d: true
          };
        }
      }
    }

    // 2. Climbing-physics candidate (for rides with GPS+elevation or climbing summary)
    const climbEst = estimateClimbingPhysicsFtp(act, pts, safeWeight + safeBikeWeight);
    if (climbEst) {
      climbActivityCount++;
      const rec: ClimbCandidateBest = {
        ...climbEst,
        activityName: act.name,
        activityDate: actDateStr,
        isRecent90d: isRecent
      };
      if (!bestAllTimeClimb || rec.ftpWatts > bestAllTimeClimb.ftpWatts) {
        bestAllTimeClimb = rec;
      }
      if (isRecent && (!bestRecentClimb || rec.ftpWatts > bestRecentClimb.ftpWatts)) {
        bestRecentClimb = rec;
      }
    }
  }

  const useRecentPowerWindow = Object.keys(recentPeaks).some((k) => Number(k) >= 480);
  const selectedPeaks = useRecentPowerWindow ? recentPeaks : allTimePeaks;
  const candidates: FtpEstimateCandidate[] = [];

  const toWkg = (watts: number) => Number((watts / safeWeight).toFixed(2));

  // Method A: 60-min MMP
  const p60 = selectedPeaks[3600];
  if (p60 && p60.watts >= 80 && p60.watts <= 600) {
    const ftpWatts = Math.round(p60.watts);
    candidates.push({
      method: 'mmp_60m',
      label: '60-Min-Leistungsmaximum (100%)',
      ftpWatts,
      wkg: toWkg(ftpWatts),
      confidence: 'high',
      basisValue: `${p60.watts} W über 60 Min`,
      activityName: p60.activityName,
      activityDate: p60.activityDate,
      isRecent90d: p60.isRecent90d
    });
  }

  // Method B: Critical Power Monod-Scherrer regression (5m + 8m/20m)
  const p20 = selectedPeaks[1200];
  const cpInputs: Array<{ durationSec: number; label: string; watts: number }> = [];
  if (selectedPeaks[300]?.watts) cpInputs.push({ durationSec: 300, label: '5m', watts: selectedPeaks[300].watts });
  if (selectedPeaks[480]?.watts) cpInputs.push({ durationSec: 480, label: '8m', watts: selectedPeaks[480].watts });
  if (selectedPeaks[1200]?.watts) cpInputs.push({ durationSec: 1200, label: '20m', watts: selectedPeaks[1200].watts });

  if (cpInputs.length >= 2 && (selectedPeaks[1200] || selectedPeaks[480])) {
    const n = cpInputs.length;
    const meanX = cpInputs.reduce((acc, p) => acc + p.durationSec, 0) / n;
    const meanY = cpInputs.reduce((acc, p) => acc + p.watts * p.durationSec, 0) / n;
    let num = 0;
    let den = 0;
    for (const p of cpInputs) {
      const dx = p.durationSec - meanX;
      num += dx * (p.watts * p.durationSec - meanY);
      den += dx * dx;
    }
    const rawSlopeCp = den > 0 ? num / den : 0;
    const rawWPrimeJ = meanY - rawSlopeCp * meanX;

    const cpEst = estimateCriticalPowerFromBests(cpInputs, 240, safeWeight);
    const cpImpossible =
      !Number.isFinite(rawWPrimeJ) ||
      rawWPrimeJ < 3000 ||
      (p20 && cpEst.cpWatts > p20.watts);

    if (!cpImpossible && cpEst.cpWatts >= 80 && cpEst.cpWatts <= 600) {
      const isReliableCp =
        cpInputs.length >= 3 &&
        cpEst.rSquared >= 0.97 &&
        rawWPrimeJ >= 8000 &&
        rawWPrimeJ <= 38000 &&
        (!p20 || cpEst.cpWatts <= Math.round(p20.watts * 0.98));

      candidates.push({
        method: 'critical_power',
        label: `Critical Power Regression (R² ${cpEst.rSquared})`,
        ftpWatts: cpEst.cpWatts,
        wkg: toWkg(cpEst.cpWatts),
        confidence: isReliableCp ? 'high' : 'medium',
        basisValue: `${cpInputs.map((c) => `${c.label}: ${c.watts}W`).join(' · ')} (W' ${cpEst.wPrimeKj} kJ)`,
        activityName: selectedPeaks[1200]?.activityName || selectedPeaks[480]?.activityName,
        activityDate: selectedPeaks[1200]?.activityDate || selectedPeaks[480]?.activityDate,
        isRecent90d: cpInputs.every((c) => Boolean(recentPeaks[c.durationSec]))
      });
    }
  }

  // Method C: 20-min Peak * 0.95
  if (p20) {
    const ftpWatts = Math.round(p20.watts * 0.95);
    if (ftpWatts >= 80 && ftpWatts <= 600) {
      candidates.push({
        method: 'mmp_20m',
        label: '20-Min-Peak × 0.95',
        ftpWatts,
        wkg: toWkg(ftpWatts),
        confidence: 'high',
        basisValue: `${p20.watts} W über 20 Min`,
        activityName: p20.activityName,
        activityDate: p20.activityDate,
        isRecent90d: p20.isRecent90d
      });
    }
  }

  // Method D: 8-min Peak * 0.90
  const p8 = selectedPeaks[480];
  if (p8) {
    const ftpWatts = Math.round(p8.watts * 0.9);
    if (ftpWatts >= 80 && ftpWatts <= 600) {
      candidates.push({
        method: 'mmp_8m',
        label: '8-Min-Peak × 0.90',
        ftpWatts,
        wkg: toWkg(ftpWatts),
        confidence: 'medium',
        basisValue: `${p8.watts} W über 8 Min`,
        activityName: p8.activityName,
        activityDate: p8.activityDate,
        isRecent90d: p8.isRecent90d
      });
    }
  }

  // Method E: Climbing Physics VAM Fallback
  const chosenClimb = bestRecentClimb || bestAllTimeClimb;
  if (chosenClimb) {
    candidates.push({
      method: 'climbing_physics',
      label: 'Steigungs-Physik (ohne Powermeter)',
      ftpWatts: chosenClimb.ftpWatts,
      wkg: toWkg(chosenClimb.ftpWatts),
      confidence: chosenClimb.durationMin >= 20 ? 'medium' : 'low',
      basisValue: `${chosenClimb.climbWatts} W über ${chosenClimb.durationMin} Min (${chosenClimb.ascentM} hm @ ${chosenClimb.gradePct}%)`,
      activityName: chosenClimb.activityName,
      activityDate: chosenClimb.activityDate,
      isRecent90d: chosenClimb.isRecent90d
    });
  }

  // Priority ranking: native 60m > high-R² CP > 20m > 8m > climbing physics
  const priorityOrder: FtpMethodId[] = [
    'mmp_60m',
    'critical_power',
    'mmp_20m',
    'mmp_8m',
    'climbing_physics'
  ];

  let bestMethod: FtpEstimateCandidate | null = null;
  for (const methodId of priorityOrder) {
    const found = candidates.find((c) => c.method === methodId);
    if (found) {
      // Skip low-R² CP ahead of clean 20m peak if 20m peak exists
      if (methodId === 'critical_power' && found.confidence === 'medium' && candidates.some((c) => c.method === 'mmp_20m')) {
        continue;
      }
      bestMethod = found;
      break;
    }
  }

  if (!bestMethod) {
    return {
      recommendedFtp: null,
      recommendedWkg: null,
      confidence: 'none',
      bestMethod: null,
      candidates: [],
      powerActivityCount,
      climbActivityCount,
      summary:
        'Keine Radaktivitäten mit Leistungsdaten (Powermeter) oder längeren Bergauffahrten (>=10 Min, >=4%) gefunden.'
    };
  }

  const windowTag = bestMethod.isRecent90d ? 'letzte 90 Tage' : 'Gesamthistorie';
  return {
    recommendedFtp: bestMethod.ftpWatts,
    recommendedWkg: bestMethod.wkg,
    confidence: bestMethod.confidence,
    bestMethod,
    candidates,
    powerActivityCount,
    climbActivityCount,
    summary: `Empfohlene eFTP: ${bestMethod.ftpWatts} W (${bestMethod.wkg} W/kg) via ${bestMethod.label} (${windowTag}).`
  };
}
