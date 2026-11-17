import { GPXTrack } from '../types';
import {
  calculateDistance,
  estimateMedianSamplingIntervalSec,
  isRecordingPauseGap,
} from './gpxUtils';
import { resolveTrackPointSpeedsKmh } from '../domain/telemetry/pointMetricsEngine';
import {
  resolveTrackCapabilities,
  isFitTrackFile,
  computeTrackAvgSpeedKmh,
  TrackTelemetryCapabilities,
} from './trackTelemetryCapabilities';

export interface DbalPoint {
  index: number;
  distanceKm: number;
  elapsedSec: number;
  ele: number;
  gradePct: number;
  speedKmh: number;
  gapSpeedKmh: number;
  paceSecKm: number | null;
  gapPaceSecKm: number | null;
  dbalMeters: number;
  dbalPct: number;
  isPause: boolean;
  lat: number;
  lng: number;
}

export interface DbalMatch {
  id: string;
  matchNumber: number;
  startIndex: number;
  endIndex: number;
  startKm: number;
  endKm: number;
  durationSec: number;
  avgGapPaceFormatted: string;
  peakGapPaceFormatted: string;
  metersBurned: number;
  pctDPrimeBurned: number;
  minDbalPct: number;
  lat: number;
  lng: number;
}

export interface RunningMetricsResult {
  capabilities: TrackTelemetryCapabilities;
  hasData: boolean;
  movingTimeSec: number;
  elapsedTimeSec: number;
  pauseTimeSec: number;
  activeDistanceKm: number;

  // Pace & Grade Adjusted Pace
  avgSpeedKmh: number | null;
  avgPaceSecKm: number | null;
  avgPaceFormatted: string | null;
  avgGapSpeedKmh: number | null;
  avgGapPaceSecKm: number | null;
  avgGapPaceFormatted: string | null;
  ngpSpeedKmh: number | null;
  ngpPaceSecKm: number | null;
  ngpPaceFormatted: string | null;

  // Critical Speed & D'bal
  criticalSpeedMs: number;
  criticalSpeedKmh: number;
  criticalPaceSecKm: number;
  criticalPaceFormatted: string;
  dPrimeMeters: number;
  rTss: number | null;
  intensityFactor: number | null;
  minDbalMeters: number;
  minDbalPct: number;
  minDbalDistKm: number;
  timeAboveCsSec: number;
  distAboveCsM: number;
  matches: DbalMatch[];
  series: DbalPoint[];

  // Pa:HR (Pace-to-Heart Rate Efficiency & Aerobic Decoupling)
  paHrEf: number | null; // m/min per bpm
  paHrFirstHalfEf: number | null;
  paHrSecondHalfEf: number | null;
  paHrFirstHalfAvgHr: number | null;
  paHrSecondHalfAvgHr: number | null;
  paHrFirstHalfPaceFormatted: string | null;
  paHrSecondHalfPaceFormatted: string | null;
  aerobicDecouplingPct: number | null;
  hasValidDecoupling: boolean;

  // Running Cadence (spm)
  avgCadenceSpm: number | null;
  maxCadenceSpm: number | null;
  flatCadenceSpm: number | null;
  uphillCadenceSpm: number | null;
  downhillCadenceSpm: number | null;
  wasNormalizedFromCycles: boolean;
}

export function formatPaceSeconds(secPerKm: number | null | undefined): string {
  if (secPerKm === null || secPerKm === undefined || !Number.isFinite(secPerKm) || secPerKm <= 60 || secPerKm > 1800) {
    return '--:--';
  }
  const mins = Math.floor(secPerKm / 60);
  const secs = Math.round(secPerKm % 60);
  if (secs === 60) {
    return `${mins + 1}:00`;
  }
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Minetti et al. (2002) metabolic energy cost of running on inclines/declines [-30%, +30%].
 * Returns multiplicative factor relative to flat running (grade = 0 -> factor = 1.0).
 */
export function minettiGapFactor(gradeDecimal: number): number {
  const i = Math.max(-0.30, Math.min(0.30, gradeDecimal));
  const c0 = 3.6;
  const cost =
    155.4 * Math.pow(i, 5) -
    30.4 * Math.pow(i, 4) -
    43.3 * Math.pow(i, 3) +
    46.3 * Math.pow(i, 2) +
    19.5 * i +
    c0;
  // Practical trail/downhill safety clamp (downhill braking/impact limits speed gain)
  return Math.max(0.55, Math.min(3.8, cost / c0));
}

export function deriveDefaultCriticalSpeedMs(track: GPXTrack, resolvedSpeeds?: (number | undefined)[]): number {
  // Check saved threshold pace in localStorage if running in browser
  if (typeof window !== 'undefined') {
    try {
      const savedPace = localStorage.getItem('gpx_threshold_pace');
      if (savedPace) {
        const paceSec = Number(savedPace);
        if (Number.isFinite(paceSec) && paceSec >= 150 && paceSec <= 600) {
          // Critical Speed (~35-45 min effort) is ~2% faster than 60-min threshold pace
          return (1000 / paceSec) * 1.02;
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  // Fallback: estimate from track average/p75 pace so D'bal scale stays realistic
  const validSpeeds = (resolvedSpeeds || [])
    .filter((s): s is number => typeof s === 'number' && Number.isFinite(s) && s >= 4.0 && s <= 26.0)
    .sort((a, b) => a - b);

  if (validSpeeds.length >= 10) {
    const p75Kmh = validSpeeds[Math.floor(validSpeeds.length * 0.78)];
    return Math.max(2.2, Math.min(5.8, (p75Kmh / 3.6) * 1.03));
  }

  const trackAvgSpeed = computeTrackAvgSpeedKmh(track);
  if (trackAvgSpeed && trackAvgSpeed >= 4 && trackAvgSpeed <= 25) {
    return Math.max(2.2, Math.min(5.8, (trackAvgSpeed / 3.6) * 1.08));
  }

  return 3.57; // ~4:40 min/km (~12.85 km/h)
}

export function computePauseAwareRunningMetrics(
  track: GPXTrack,
  options: {
    criticalSpeedMs?: number;
    criticalPaceSecKm?: number;
    dPrimeMeters?: number;
  } = {}
): RunningMetricsResult {
  const capabilities = resolveTrackCapabilities(track);
  const points = track.points || [];

  const csMs =
    options.criticalSpeedMs && options.criticalSpeedMs > 1.2
      ? options.criticalSpeedMs
      : options.criticalPaceSecKm && options.criticalPaceSecKm >= 150
      ? 1000 / options.criticalPaceSecKm
      : deriveDefaultCriticalSpeedMs(track);

  const dPrimeMeters = Math.max(60, Math.min(600, options.dPrimeMeters || 200));
  const criticalSpeedKmh = Number((csMs * 3.6).toFixed(1));
  const criticalPaceSecKm = Math.round(1000 / csMs);
  const criticalPaceFormatted = formatPaceSeconds(criticalPaceSecKm);

  if (!capabilities.isRunning || !capabilities.hasPoints || !capabilities.hasPaceOrSpeed) {
    return {
      capabilities,
      hasData: false,
      movingTimeSec: 0,
      elapsedTimeSec: 0,
      pauseTimeSec: 0,
      activeDistanceKm: 0,
      avgSpeedKmh: null,
      avgPaceSecKm: null,
      avgPaceFormatted: null,
      avgGapSpeedKmh: null,
      avgGapPaceSecKm: null,
      avgGapPaceFormatted: null,
      ngpSpeedKmh: null,
      ngpPaceSecKm: null,
      ngpPaceFormatted: null,
      criticalSpeedMs: csMs,
      criticalSpeedKmh,
      criticalPaceSecKm,
      criticalPaceFormatted,
      dPrimeMeters,
      rTss: null,
      intensityFactor: null,
      minDbalMeters: dPrimeMeters,
      minDbalPct: 100,
      minDbalDistKm: 0,
      timeAboveCsSec: 0,
      distAboveCsM: 0,
      matches: [],
      series: [],
      paHrEf: null,
      paHrFirstHalfEf: null,
      paHrSecondHalfEf: null,
      paHrFirstHalfAvgHr: null,
      paHrSecondHalfAvgHr: null,
      paHrFirstHalfPaceFormatted: null,
      paHrSecondHalfPaceFormatted: null,
      aerobicDecouplingPct: null,
      hasValidDecoupling: false,
      avgCadenceSpm: null,
      maxCadenceSpm: null,
      flatCadenceSpm: null,
      uphillCadenceSpm: null,
      downhillCadenceSpm: null,
      wasNormalizedFromCycles: false,
    };
  }

  const resolvedSpeedsKmh = resolveTrackPointSpeedsKmh(points, {
    isFitFile: isFitTrackFile(track),
    activityType: 'running',
    trackDistanceKm: track.distance,
    trackDurationSec: track.duration,
  });

  // If caller didn't supply explicit CS, re-derive once with resolved speeds if needed
  const effectiveCsMs =
    options.criticalSpeedMs || options.criticalPaceSecKm
      ? csMs
      : deriveDefaultCriticalSpeedMs(track, resolvedSpeedsKmh);
  const effectiveCsKmh = Number((effectiveCsMs * 3.6).toFixed(1));
  const effectiveCsPaceSec = Math.round(1000 / effectiveCsMs);
  const effectiveCsPaceFormatted = formatPaceSeconds(effectiveCsPaceSec);

  // Smooth elevation (±3 points) when real elevation exists
  const eleSmoothed = new Float64Array(points.length);
  if (capabilities.hasRealElevation) {
    for (let i = 0; i < points.length; i++) {
      let sum = 0;
      let count = 0;
      for (let j = Math.max(0, i - 3); j <= Math.min(points.length - 1, i + 3); j++) {
        const e = points[j].ele;
        if (typeof e === 'number' && Number.isFinite(e)) {
          sum += e;
          count++;
        }
      }
      eleSmoothed[i] = count > 0 ? sum / count : 0;
    }
  }

  // Cadence normalization check (half-cadence strides vs full steps/min)
  let wasNormalizedFromCycles = false;
  let cadenceMultiplier = 1;
  if (capabilities.hasCadence) {
    const rawCads = points
      .map((p) => p.cadence)
      .filter((c): c is number => typeof c === 'number' && Number.isFinite(c) && c > 20 && c < 250)
      .sort((a, b) => a - b);
    if (rawCads.length > 0 && rawCads[Math.floor(rawCads.length / 2)] < 110) {
      cadenceMultiplier = 2;
      wasNormalizedFromCycles = true;
    }
  }

  const medianDtSec = estimateMedianSamplingIntervalSec(points);
  const trackAvgSpeed = computeTrackAvgSpeedKmh(track);
  const fallbackSpeedKmh = trackAvgSpeed && trackAvgSpeed >= 3 ? trackAvgSpeed : effectiveCsKmh * 0.9;

  let currentDbalM = dPrimeMeters;
  let minDbalM = dPrimeMeters;
  let minDbalDistKm = 0;
  let cumDistKm = 0;
  let activeDistKm = 0;
  let movingTimeSec = 0;
  let pauseTimeSec = 0;
  let elapsedTimeSec = 0;
  let gapEquivDistM = 0;
  let timeAboveCsSec = 0;
  let distAboveCsM = 0;

  // Active NGP buffer
  const gapSpeedTimeline: Array<{ dt: number; gapSpeedMs: number }> = [];

  // Pa:HR half-split buffer (pause-free)
  interface PaHrSample {
    weight: number;
    gapSpeedMs: number;
    hr: number;
  }
  const paHrSamples: PaHrSample[] = [];

  // Cadence accumulators (pause-free)
  let cadSum = 0;
  let cadWeight = 0;
  let maxCadence = 0;
  let flatCadSum = 0;
  let flatCadWeight = 0;
  let climbCadSum = 0;
  let climbCadWeight = 0;
  let descentCadSum = 0;
  let descentCadWeight = 0;

  // D'bal match state
  const matches: DbalMatch[] = [];
  let inMatch = false;
  let matchStartIdx = 0;
  let matchStartKm = 0;
  let matchDurationSec = 0;
  let matchGapSpeedWeightedSum = 0;
  let matchPeakGapSpeedMs = 0;
  let matchBurnedM = 0;
  let matchMinDbalPct = 100;

  const series: DbalPoint[] = [];

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    let dt = 0;
    let distStepKm = 0;
    let grade = 0;
    let isPause = false;

    const ptSpeedKmh = resolvedSpeedsKmh[i] ?? 0;

    if (i > 0) {
      const prev = points[i - 1];
      distStepKm = calculateDistance(prev, pt);
      if (!Number.isFinite(distStepKm) || distStepKm < 0) distStepKm = 0;
      const distM = distStepKm * 1000;

      if (capabilities.hasTimestamps && pt.time && prev.time) {
        const t2 = pt.time instanceof Date ? pt.time.getTime() : new Date(pt.time).getTime();
        const t1 = prev.time instanceof Date ? prev.time.getTime() : new Date(prev.time).getTime();
        const diffSec = (t2 - t1) / 1000;

        if (Number.isFinite(diffSec) && diffSec > 0) {
          if (diffSec >= 600 || isRecordingPauseGap(diffSec, distStepKm, medianDtSec)) {
            isPause = true;
            dt = Math.min(diffSec, 3600);
          } else {
            dt = diffSec;
          }
        }
      } else if (distM > 0) {
        const vKmh = ptSpeedKmh >= 1.6 ? ptSpeedKmh : fallbackSpeedKmh;
        dt = distM / (vKmh / 3.6);
      }

      if (capabilities.hasRealElevation && distM > 1) {
        grade = Math.max(-0.30, Math.min(0.30, (eleSmoothed[i] - eleSmoothed[i - 1]) / distM));
      }

      // Compute step speed (km/h)
      let stepSpeedKmh = ptSpeedKmh;
      if (!isPause && dt > 0 && distM > 0 && stepSpeedKmh <= 0.1) {
        stepSpeedKmh = (distM / dt) * 3.6;
      }
      if (!isPause && stepSpeedKmh < 1.6) {
        isPause = true;
      }

      elapsedTimeSec += dt;
      if (isPause) {
        pauseTimeSec += dt;
        // Reconstitute D'bal physiologically during real pause duration (v = 0 m/s)
        if (dt > 0) {
          const tauD = 546 * Math.exp(-0.45 * effectiveCsMs) + 316;
          currentDbalM = dPrimeMeters - (dPrimeMeters - currentDbalM) * Math.exp(-Math.min(dt, 1800) / tauD);
          currentDbalM = Math.min(dPrimeMeters, Math.max(0, currentDbalM));
        }
        // Flush any open match on pause
        if (inMatch) {
          const minBurnM = Math.max(20, dPrimeMeters * 0.15);
          if (matchBurnedM >= minBurnM && matchDurationSec >= 10) {
            const startPt = points[matchStartIdx] || pt;
            const avgMatchMs = matchGapSpeedWeightedSum / Math.max(1, matchDurationSec);
            matches.push({
              id: `dbal-match-${matches.length + 1}-${matchStartIdx}`,
              matchNumber: matches.length + 1,
              startIndex: matchStartIdx,
              endIndex: i - 1,
              startKm: Number(matchStartKm.toFixed(2)),
              endKm: Number(cumDistKm.toFixed(2)),
              durationSec: Math.round(matchDurationSec),
              avgGapPaceFormatted: formatPaceSeconds(1000 / Math.max(0.5, avgMatchMs)),
              peakGapPaceFormatted: formatPaceSeconds(1000 / Math.max(0.5, matchPeakGapSpeedMs)),
              metersBurned: Math.round(matchBurnedM),
              pctDPrimeBurned: Math.round((matchBurnedM / dPrimeMeters) * 100),
              minDbalPct: Math.max(0, Math.round(matchMinDbalPct)),
              lat: startPt.lat,
              lng: startPt.lng,
            });
          }
          inMatch = false;
        }
      } else {
        cumDistKm += distStepKm;
        activeDistKm += distStepKm;
        movingTimeSec += dt;

        const actualSpeedMs = Math.max(0.45, Math.min(9.5, stepSpeedKmh / 3.6));
        const gFactor = capabilities.hasRealElevation ? minettiGapFactor(grade) : 1.0;
        const gapSpeedMs = actualSpeedMs * gFactor;

        gapEquivDistM += distM * gFactor;
        gapSpeedTimeline.push({ dt: Math.max(0.5, dt), gapSpeedMs });

        // D'bal depletion / reconstitution
        if (dt > 0) {
          if (gapSpeedMs > effectiveCsMs) {
            const excessM = (gapSpeedMs - effectiveCsMs) * dt;
            currentDbalM = Math.max(0, currentDbalM - excessM);
            timeAboveCsSec += dt;
            distAboveCsM += excessM;

            if (!inMatch) {
              inMatch = true;
              matchStartIdx = i - 1;
              matchStartKm = Math.max(0, cumDistKm - distStepKm);
              matchDurationSec = 0;
              matchGapSpeedWeightedSum = 0;
              matchPeakGapSpeedMs = 0;
              matchBurnedM = 0;
              matchMinDbalPct = (currentDbalM / dPrimeMeters) * 100;
            }
            matchDurationSec += dt;
            matchGapSpeedWeightedSum += gapSpeedMs * dt;
            if (gapSpeedMs > matchPeakGapSpeedMs) matchPeakGapSpeedMs = gapSpeedMs;
            matchBurnedM += excessM;
            const pctNow = (currentDbalM / dPrimeMeters) * 100;
            if (pctNow < matchMinDbalPct) matchMinDbalPct = pctNow;
          } else {
            const dV = Math.max(0, effectiveCsMs - gapSpeedMs);
            const tauD = 546 * Math.exp(-0.45 * dV) + 316;
            currentDbalM = dPrimeMeters - (dPrimeMeters - currentDbalM) * Math.exp(-dt / tauD);
            currentDbalM = Math.min(dPrimeMeters, Math.max(0, currentDbalM));

            if (inMatch) {
              const minBurnM = Math.max(20, dPrimeMeters * 0.15);
              if (matchBurnedM >= minBurnM && matchDurationSec >= 10) {
                const startPt = points[matchStartIdx] || pt;
                const avgMatchMs = matchGapSpeedWeightedSum / Math.max(1, matchDurationSec);
                matches.push({
                  id: `dbal-match-${matches.length + 1}-${matchStartIdx}`,
                  matchNumber: matches.length + 1,
                  startIndex: matchStartIdx,
                  endIndex: i - 1,
                  startKm: Number(matchStartKm.toFixed(2)),
                  endKm: Number(cumDistKm.toFixed(2)),
                  durationSec: Math.round(matchDurationSec),
                  avgGapPaceFormatted: formatPaceSeconds(1000 / Math.max(0.5, avgMatchMs)),
                  peakGapPaceFormatted: formatPaceSeconds(1000 / Math.max(0.5, matchPeakGapSpeedMs)),
                  metersBurned: Math.round(matchBurnedM),
                  pctDPrimeBurned: Math.round((matchBurnedM / dPrimeMeters) * 100),
                  minDbalPct: Math.max(0, Math.round(matchMinDbalPct)),
                  lat: startPt.lat,
                  lng: startPt.lng,
                });
              }
              inMatch = false;
            }
          }
        }

        // Pa:HR sample collection
        if (
          capabilities.hasHeartRate &&
          typeof pt.hr === 'number' &&
          Number.isFinite(pt.hr) &&
          pt.hr > 40 &&
          pt.hr < 240 &&
          stepSpeedKmh >= 1.8
        ) {
          paHrSamples.push({
            weight: dt > 0 ? dt : Math.max(0.1, distM),
            gapSpeedMs,
            hr: pt.hr,
          });
        }

        // Cadence accumulators (pause-free)
        if (
          capabilities.hasCadence &&
          typeof pt.cadence === 'number' &&
          Number.isFinite(pt.cadence) &&
          pt.cadence > 20 &&
          pt.cadence < 250
        ) {
          const spm = Math.round(pt.cadence * cadenceMultiplier);
          const w = dt > 0 ? dt : 1;
          cadSum += spm * w;
          cadWeight += w;
          if (spm > maxCadence) maxCadence = spm;

          const gradePct = grade * 100;
          if (gradePct > 3) {
            climbCadSum += spm * w;
            climbCadWeight += w;
          } else if (gradePct < -3) {
            descentCadSum += spm * w;
            descentCadWeight += w;
          } else if (Math.abs(gradePct) <= 2) {
            flatCadSum += spm * w;
            flatCadWeight += w;
          }
        }
      }

      if (currentDbalM < minDbalM) {
        minDbalM = currentDbalM;
        minDbalDistKm = cumDistKm;
      }

      const dbalPct = Math.max(0, Math.min(100, Number(((currentDbalM / dPrimeMeters) * 100).toFixed(1))));
      const effSpeedKmh = isPause ? 0 : stepSpeedKmh;
      const gFactorOut = capabilities.hasRealElevation ? minettiGapFactor(grade) : 1.0;
      const gapKmhOut = isPause ? 0 : Number((effSpeedKmh * gFactorOut).toFixed(1));

      series.push({
        index: i,
        distanceKm: Number(cumDistKm.toFixed(3)),
        elapsedSec: Math.round(elapsedTimeSec),
        ele: Math.round(pt.ele || 0),
        gradePct: Number((grade * 100).toFixed(1)),
        speedKmh: Number(effSpeedKmh.toFixed(1)),
        gapSpeedKmh: gapKmhOut,
        paceSecKm: effSpeedKmh >= 1.6 ? Math.round(3600 / effSpeedKmh) : null,
        gapPaceSecKm: gapKmhOut >= 1.6 ? Math.round(3600 / gapKmhOut) : null,
        dbalMeters: Math.round(currentDbalM),
        dbalPct,
        isPause,
        lat: pt.lat,
        lng: pt.lng,
      });
    } else {
      series.push({
        index: 0,
        distanceKm: 0,
        elapsedSec: 0,
        ele: Math.round(pt.ele || 0),
        gradePct: 0,
        speedKmh: Number(ptSpeedKmh.toFixed(1)),
        gapSpeedKmh: Number(ptSpeedKmh.toFixed(1)),
        paceSecKm: ptSpeedKmh >= 1.6 ? Math.round(3600 / ptSpeedKmh) : null,
        gapPaceSecKm: ptSpeedKmh >= 1.6 ? Math.round(3600 / ptSpeedKmh) : null,
        dbalMeters: Math.round(dPrimeMeters),
        dbalPct: 100,
        isPause: false,
        lat: pt.lat,
        lng: pt.lng,
      });
    }
  }

  // Flush open match at end
  if (inMatch) {
    const minBurnM = Math.max(20, dPrimeMeters * 0.15);
    if (matchBurnedM >= minBurnM && matchDurationSec >= 10) {
      const lastPt = points[points.length - 1];
      const avgMatchMs = matchGapSpeedWeightedSum / Math.max(1, matchDurationSec);
      matches.push({
        id: `dbal-match-${matches.length + 1}-${matchStartIdx}`,
        matchNumber: matches.length + 1,
        startIndex: matchStartIdx,
        endIndex: points.length - 1,
        startKm: Number(matchStartKm.toFixed(2)),
        endKm: Number(cumDistKm.toFixed(2)),
        durationSec: Math.round(matchDurationSec),
        avgGapPaceFormatted: formatPaceSeconds(1000 / Math.max(0.5, avgMatchMs)),
        peakGapPaceFormatted: formatPaceSeconds(1000 / Math.max(0.5, matchPeakGapSpeedMs)),
        metersBurned: Math.round(matchBurnedM),
        pctDPrimeBurned: Math.round((matchBurnedM / dPrimeMeters) * 100),
        minDbalPct: Math.max(0, Math.round(matchMinDbalPct)),
        lat: lastPt.lat,
        lng: lastPt.lng,
      });
    }
  }

  // Summary Pace & GAP (pause-aware)
  const avgSpeedKmh =
    movingTimeSec > 0 && activeDistKm > 0.05
      ? Number(((activeDistKm / movingTimeSec) * 3600).toFixed(1))
      : null;
  const avgPaceSecKm = avgSpeedKmh && avgSpeedKmh >= 1.6 ? Math.round(3600 / avgSpeedKmh) : null;
  const avgPaceFormatted = avgPaceSecKm ? formatPaceSeconds(avgPaceSecKm) : null;

  const avgGapSpeedMs =
    capabilities.hasGapData && movingTimeSec > 0 && gapEquivDistM > 50
      ? gapEquivDistM / movingTimeSec
      : null;
  const avgGapSpeedKmh = avgGapSpeedMs ? Number((avgGapSpeedMs * 3.6).toFixed(1)) : null;
  const avgGapPaceSecKm = avgGapSpeedMs ? Math.round(1000 / avgGapSpeedMs) : null;
  const avgGapPaceFormatted = avgGapPaceSecKm ? formatPaceSeconds(avgGapPaceSecKm) : null;

  // NGP (30s 4th-power rolling velocity over active seconds) & rTSS
  let ngpSpeedMs: number | null = null;
  if (capabilities.hasTimestamps && movingTimeSec >= 30 && gapSpeedTimeline.length > 0) {
    const activeSecTotal = Math.min(86400, Math.round(movingTimeSec));
    if (activeSecTotal >= 30) {
      const gap1s = new Float32Array(activeSecTotal);
      let cursor = 0;
      for (let i = 0; i < gapSpeedTimeline.length && cursor < activeSecTotal; i++) {
        const seg = gapSpeedTimeline[i];
        const steps = Math.max(1, Math.round(seg.dt));
        for (let k = 0; k < steps && cursor < activeSecTotal; k++) {
          gap1s[cursor++] = seg.gapSpeedMs;
        }
      }
      if (cursor >= 30) {
        let rollSum = 0;
        for (let i = 0; i < 30; i++) rollSum += gap1s[i];
        let pow4Sum = Math.pow(rollSum / 30, 4);
        let pow4Count = 1;
        for (let i = 30; i < cursor; i++) {
          rollSum += gap1s[i] - gap1s[i - 30];
          pow4Sum += Math.pow(rollSum / 30, 4);
          pow4Count++;
        }
        ngpSpeedMs = Math.pow(pow4Sum / pow4Count, 0.25);
      }
    }
  } else if (capabilities.hasTimestamps && movingTimeSec > 0 && gapEquivDistM > 50) {
    ngpSpeedMs = gapEquivDistM / movingTimeSec;
  }

  const ngpSpeedKmh = ngpSpeedMs ? Number((ngpSpeedMs * 3.6).toFixed(1)) : null;
  const ngpPaceSecKm = ngpSpeedMs ? Math.round(1000 / ngpSpeedMs) : null;
  const ngpPaceFormatted = ngpPaceSecKm ? formatPaceSeconds(ngpPaceSecKm) : null;

  let rTss: number | null = null;
  let intensityFactor: number | null = null;
  if (capabilities.hasRtssData && ngpSpeedMs && movingTimeSec > 0) {
    intensityFactor = Number((ngpSpeedMs / effectiveCsMs).toFixed(2));
    rTss = Math.round(((movingTimeSec * ngpSpeedMs * intensityFactor) / (effectiveCsMs * 3600)) * 100);
  }

  // Pa:HR & Aerobic Decoupling
  let paHrEf: number | null = null;
  let paHrFirstHalfEf: number | null = null;
  let paHrSecondHalfEf: number | null = null;
  let paHrFirstHalfAvgHr: number | null = null;
  let paHrSecondHalfAvgHr: number | null = null;
  let paHrFirstHalfPaceFormatted: string | null = null;
  let paHrSecondHalfPaceFormatted: string | null = null;
  let aerobicDecouplingPct: number | null = null;
  let hasValidDecoupling = false;

  if (capabilities.hasPaHrData && paHrSamples.length >= 4) {
    let totalW = 0;
    let totalSpeedW = 0;
    let totalHrW = 0;
    for (const s of paHrSamples) {
      totalW += s.weight;
      totalSpeedW += s.gapSpeedMs * s.weight;
      totalHrW += s.hr * s.weight;
    }
    if (totalW > 0 && totalHrW > 0) {
      const avgSpeedMMin = (totalSpeedW / totalW) * 60;
      const avgHr = totalHrW / totalW;
      paHrEf = Number((avgSpeedMMin / avgHr).toFixed(2));
    }

    const halfW = totalW / 2;
    let accW = 0;
    let w1 = 0, spd1 = 0, hr1 = 0;
    let w2 = 0, spd2 = 0, hr2 = 0;

    for (const s of paHrSamples) {
      if (accW < halfW) {
        w1 += s.weight;
        spd1 += s.gapSpeedMs * s.weight;
        hr1 += s.hr * s.weight;
      } else {
        w2 += s.weight;
        spd2 += s.gapSpeedMs * s.weight;
        hr2 += s.hr * s.weight;
      }
      accW += s.weight;
    }

    if (w1 > 0 && w2 > 0 && hr1 > 0 && hr2 > 0) {
      const s1Ms = spd1 / w1;
      const s2Ms = spd2 / w2;
      const h1 = hr1 / w1;
      const h2 = hr2 / w2;

      const ef1 = (s1Ms * 60) / h1;
      const ef2 = (s2Ms * 60) / h2;
      paHrFirstHalfEf = Number(ef1.toFixed(2));
      paHrSecondHalfEf = Number(ef2.toFixed(2));
      paHrFirstHalfAvgHr = Math.round(h1);
      paHrSecondHalfAvgHr = Math.round(h2);
      paHrFirstHalfPaceFormatted = formatPaceSeconds(1000 / Math.max(0.5, s1Ms));
      paHrSecondHalfPaceFormatted = formatPaceSeconds(1000 / Math.max(0.5, s2Ms));

      hasValidDecoupling =
        paHrSamples.length >= 20 &&
        (capabilities.hasTimestamps ? movingTimeSec >= 600 : activeDistKm >= 2);
      if (hasValidDecoupling && ef1 > 0) {
        aerobicDecouplingPct = Number((((ef1 - ef2) / ef1) * 100).toFixed(1));
      }
    }
  }

  return {
    capabilities,
    hasData: true,
    movingTimeSec: Math.round(movingTimeSec),
    elapsedTimeSec: Math.round(elapsedTimeSec),
    pauseTimeSec: Math.round(pauseTimeSec),
    activeDistanceKm: Number(activeDistKm.toFixed(2)),
    avgSpeedKmh,
    avgPaceSecKm,
    avgPaceFormatted,
    avgGapSpeedKmh,
    avgGapPaceSecKm,
    avgGapPaceFormatted,
    ngpSpeedKmh,
    ngpPaceSecKm,
    ngpPaceFormatted,
    criticalSpeedMs: effectiveCsMs,
    criticalSpeedKmh: effectiveCsKmh,
    criticalPaceSecKm: effectiveCsPaceSec,
    criticalPaceFormatted: effectiveCsPaceFormatted,
    dPrimeMeters,
    rTss,
    intensityFactor,
    minDbalMeters: Math.round(minDbalM),
    minDbalPct: Math.max(0, Math.round((minDbalM / dPrimeMeters) * 100)),
    minDbalDistKm: Number(minDbalDistKm.toFixed(1)),
    timeAboveCsSec: Math.round(timeAboveCsSec),
    distAboveCsM: Math.round(distAboveCsM),
    matches,
    series,
    paHrEf,
    paHrFirstHalfEf,
    paHrSecondHalfEf,
    paHrFirstHalfAvgHr,
    paHrSecondHalfAvgHr,
    paHrFirstHalfPaceFormatted,
    paHrSecondHalfPaceFormatted,
    aerobicDecouplingPct,
    hasValidDecoupling,
    avgCadenceSpm: cadWeight > 0 ? Math.round(cadSum / cadWeight) : null,
    maxCadenceSpm: maxCadence > 0 ? maxCadence : null,
    flatCadenceSpm: flatCadWeight > 0 ? Math.round(flatCadSum / flatCadWeight) : null,
    uphillCadenceSpm: climbCadWeight > 0 ? Math.round(climbCadSum / climbCadWeight) : null,
    downhillCadenceSpm: descentCadWeight > 0 ? Math.round(descentCadSum / descentCadWeight) : null,
    wasNormalizedFromCycles,
  };
}
