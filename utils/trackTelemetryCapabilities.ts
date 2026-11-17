import { GPXPoint, GPXTrack } from '../types';
import { computeActiveTrackStats } from './gpxUtils';

export interface TrackTelemetryCapabilities {
  activityType: 'cycling' | 'running';
  isRunning: boolean;
  isCycling: boolean;
  hasPoints: boolean;
  hasRealElevation: boolean;
  hasTimestamps: boolean;
  hasRecordedSpeed: boolean;
  hasPaceOrSpeed: boolean;
  hasHeartRate: boolean;
  hasCadence: boolean;
  hasNativePower: boolean;
  hasPauses: boolean;
  /** Cycling W'bal curve & match analysis (only for cycling with power or timestamps) */
  hasWbalData: boolean;
  /** Running Critical Speed & D'bal curve & match analysis */
  hasDbalData: boolean;
  /** Running Grade Adjusted Pace (requires running + pace/speed + real elevation) */
  hasGapData: boolean;
  /** Running NGP & rTSS (requires running + real timestamps) */
  hasRtssData: boolean;
  /** Running Pace-to-Heart-Rate Efficiency Factor & Aerobic Decoupling */
  hasPaHrData: boolean;
  /** Whether Zones Tab has at least one real zone dimension */
  hasZonesTabData: boolean;
  /** Whether Power/Running Physics Tab has real telemetry to render */
  hasPowerPhysicsTabData: boolean;
  /** Whether either Power/Running or Zones tab has real data */
  hasAnyPerformanceOrSensorTab: boolean;
}

export function checkHasRealElevation(track: GPXTrack | null | undefined): boolean {
  if (!track || !track.points || track.points.length < 2) return false;
  let validEleCount = 0;
  let hasNonZeroEle = false;
  for (let i = 0; i < track.points.length; i++) {
    const ele = track.points[i].ele;
    if (typeof ele === 'number' && Number.isFinite(ele)) {
      validEleCount++;
      if (Math.abs(ele) > 0.05) {
        hasNonZeroEle = true;
      }
      if (validEleCount >= 2 && hasNonZeroEle) return true;
    }
  }
  return validEleCount >= 2 && ((track.ascent ?? 0) > 1 || (track.descent ?? 0) > 1);
}

export function checkHasTimestamps(points: GPXPoint[]): boolean {
  if (!points || points.length < 2) return false;
  let firstMs: number | null = null;
  let lastMs: number | null = null;
  let validCount = 0;

  for (let i = 0; i < points.length; i++) {
    const t = points[i].time;
    if (!t) continue;
    const ms = t instanceof Date ? t.getTime() : new Date(t).getTime();
    if (!Number.isFinite(ms)) continue;
    validCount++;
    if (firstMs === null) firstMs = ms;
    lastMs = ms;
  }

  return validCount >= 2 && firstMs !== null && lastMs !== null && lastMs > firstMs + 5000;
}

export function isFitTrackFile(track: GPXTrack | null | undefined): boolean {
  if (!track) return false;
  return Boolean(
    track.rawFileDetails?.fileType === 'fit' ||
    track.originalFilename?.toLowerCase().endsWith('.fit') ||
    track.rawFileDetails?.fileName?.toLowerCase().endsWith('.fit') ||
    track.id?.startsWith('fit-')
  );
}

export function computeTrackAvgSpeedKmh(track: GPXTrack | null | undefined): number | undefined {
  if (!track || !(track.distance > 0)) return undefined;
  const pts = track.points || [];
  if (checkHasTimestamps(pts)) {
    const active = computeActiveTrackStats(pts);
    if (active.activeDurationSeconds > 0) {
      return active.activeDistanceKm / (active.activeDurationSeconds / 3600);
    }
  }
  if (track.duration && track.duration > 0) {
    return track.distance / (track.duration / 3600);
  }
  return undefined;
}

export function resolveTrackCapabilities(
  track: GPXTrack | null | undefined
): TrackTelemetryCapabilities {
  const activityType: 'cycling' | 'running' =
    track?.activityType === 'running' ? 'running' : 'cycling';
  const isRunning = activityType === 'running';
  const isCycling = !isRunning;
  const points = track?.points || [];
  const hasPoints = points.length >= 2;

  const hasRealElevation = checkHasRealElevation(track);
  const hasTimestamps = checkHasTimestamps(points);

  let recordedSpeedCount = 0;
  let hrCount = 0;
  let cadenceCount = 0;
  let powerCount = 0;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    if (typeof pt.speed === 'number' && Number.isFinite(pt.speed) && pt.speed > 0.1) {
      recordedSpeedCount++;
    }
    if (typeof pt.hr === 'number' && Number.isFinite(pt.hr) && pt.hr > 35 && pt.hr < 245) {
      hrCount++;
    }
    if (typeof pt.cadence === 'number' && Number.isFinite(pt.cadence) && pt.cadence > 0 && pt.cadence < 260) {
      cadenceCount++;
    }
    if (typeof pt.power === 'number' && Number.isFinite(pt.power) && pt.power > 0) {
      powerCount++;
    }
  }

  const hasRecordedSpeed = recordedSpeedCount >= 2;
  const hasPaceOrSpeed = hasTimestamps || hasRecordedSpeed;
  const hasHeartRate = hrCount >= 2 || Boolean(track?.hasHR && hrCount >= 1);
  const hasCadence = cadenceCount >= 2;
  const hasNativePower = powerCount >= 2 || Boolean(track?.hasPower && powerCount >= 1);
  const hasPauses = hasTimestamps ? computeActiveTrackStats(points).pauseDurationSeconds > 0 : false;

  // Sport-specific derived telemetry gating (no fake telemetry)
  const hasWbalData = isCycling && (hasNativePower || hasTimestamps);
  const hasDbalData = isRunning && hasPaceOrSpeed;
  const hasGapData = isRunning && hasPaceOrSpeed && hasRealElevation;
  const hasRtssData = isRunning && hasTimestamps;
  const hasPaHrData = isRunning && hasPaceOrSpeed && hasHeartRate;

  const hasZonesTabData =
    hasHeartRate ||
    (isRunning && hasPaceOrSpeed) ||
    (isCycling && (hasNativePower || hasTimestamps));

  const hasPowerPhysicsTabData = isRunning
    ? hasPaceOrSpeed || hasCadence || hasNativePower || hasPaHrData
    : hasNativePower || hasTimestamps;

  const hasAnyPerformanceOrSensorTab = hasPowerPhysicsTabData || hasZonesTabData;

  return {
    activityType,
    isRunning,
    isCycling,
    hasPoints,
    hasRealElevation,
    hasTimestamps,
    hasRecordedSpeed,
    hasPaceOrSpeed,
    hasHeartRate,
    hasCadence,
    hasNativePower,
    hasPauses,
    hasWbalData,
    hasDbalData,
    hasGapData,
    hasRtssData,
    hasPaHrData,
    hasZonesTabData,
    hasPowerPhysicsTabData,
    hasAnyPerformanceOrSensorTab,
  };
}
