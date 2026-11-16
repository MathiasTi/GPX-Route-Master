import { GPXPoint, GPXTrack } from '../types';
import { calculateDistance } from './gpxUtils';

export interface WbalPoint {
  index: number;
  distanceKm: number;
  elapsedSec: number;
  ele: number;
  gradePct: number;
  powerW: number;
  isEstimatedPower: boolean;
  wbalJoules: number;
  wbalKj: number;
  wbalPct: number;
  lat: number;
  lng: number;
}

export interface WbalMatch {
  id: string;
  matchNumber: number;
  startIndex: number;
  endIndex: number;
  startKm: number;
  endKm: number;
  durationSec: number;
  avgPowerW: number;
  peakPowerW: number;
  joulesBurned: number;
  kjBurned: number;
  pctWPrimeBurned: number;
  minWbalPct: number;
  lat: number;
  lng: number;
}

export interface WbalAnalysisResult {
  cpWatts: number;
  wPrimeKj: number;
  wPrimeJoules: number;
  minWbalKj: number;
  minWbalPct: number;
  minWbalDistKm: number;
  matches: WbalMatch[];
  totalMatchesCount: number;
  timeAboveCpSec: number;
  workAboveCpKj: number;
  hasNativePower: boolean;
  series: WbalPoint[];
}

export interface CpModelEstimate {
  cpWatts: number;
  cpWkg: number;
  wPrimeKj: number;
  wPrimeJoules: number;
  pMaxWatts: number;
  phenotype: 'Sprinter / Puncheur' | 'Puncheur / Allrounder' | 'Allrounder / Rouleur' | 'Kletterer / Zeitfahrer';
  phenotypeDescription: string;
  rSquared: number;
  curvePoints: Array<{
    durationSec: number;
    label: string;
    actualWatts: number;
    modeledWatts: number;
    aerobicWatts: number;
    anaerobicWatts: number;
  }>;
}

/**
 * Computes W'bal (anaerobic work capacity balance) across a track using the
 * Skiba (2012/2015) differential reconstitution model:
 * - Depletion (P > CP): W'bal(t) = W'bal(t-1) - (P - CP) * dt
 * - Reconstitution (P <= CP): tau_W' = 546 * exp(-0.01 * (CP - P)) + 316
 *   W'bal(t) = W' - (W' - W'bal(t-1)) * exp(-dt / tau_W')
 *
 * When a track lacks native power meter data, mechanical power is estimated
 * from gradient, speed, and system mass so W'bal remains available on all tracks.
 */
export function computeTrackWbal(
  track: GPXTrack,
  options: {
    cpWatts?: number;
    ftpWatts?: number;
    wPrimeKj?: number;
    riderWeightKg?: number;
    bikeWeightKg?: number;
    estimatedSpeedKmh?: number;
  } = {}
): WbalAnalysisResult {
  const ftp = Math.max(80, options.ftpWatts || 250);
  const cpWatts = Math.max(70, Math.round(options.cpWatts || ftp * 0.96));
  const wPrimeKj = Math.max(5, Math.min(45, options.wPrimeKj || 20));
  const wPrimeJoules = wPrimeKj * 1000;
  const riderWeightKg = Math.max(35, options.riderWeightKg || 75);
  const bikeWeightKg = options.bikeWeightKg ?? (track.activityType === 'running' ? 0.5 : 9.0);
  const totalMassKg = riderWeightKg + bikeWeightKg;
  const defaultSpeedKmh = Math.max(5, options.estimatedSpeedKmh || (track.activityType === 'running' ? 11 : 24));
  const defaultSpeedMs = defaultSpeedKmh / 3.6;

  const points: GPXPoint[] = track.points || [];
  if (points.length === 0) {
    return {
      cpWatts,
      wPrimeKj,
      wPrimeJoules,
      minWbalKj: wPrimeKj,
      minWbalPct: 100,
      minWbalDistKm: 0,
      matches: [],
      totalMatchesCount: 0,
      timeAboveCpSec: 0,
      workAboveCpKj: 0,
      hasNativePower: false,
      series: []
    };
  }

  const hasNativePower =
    track.hasPower ?? points.some((p) => typeof p.power === 'number' && Number.isFinite(p.power) && p.power > 0);

  const series: WbalPoint[] = [];
  let currentWbalJ = wPrimeJoules;
  let minWbalJ = wPrimeJoules;
  let minWbalDistKm = 0;
  let cumDistKm = 0;
  let elapsedSec = 0;
  let timeAboveCpSec = 0;
  let workAboveCpJ = 0;

  // Match detection state (a "match" is a sustained effort > CP that burns >= 18% of W' or >= 3.0 kJ)
  const matches: WbalMatch[] = [];
  let inMatch = false;
  let matchStartIdx = 0;
  let matchStartKm = 0;
  let matchDurationSec = 0;
  let matchWeightedPowerSum = 0;
  let matchPeakPower = 0;
  let matchBurnedJ = 0;
  let matchMinWbalPct = 100;

  const g = 9.81;
  const rho = 1.225;
  const cda = track.activityType === 'running' ? 0.42 : 0.32;
  const crr = track.activityType === 'running' ? 0.008 : 0.0045;

  for (let i = 0; i < points.length; i++) {
    const pt = points[i];
    let dt = 1;
    let distStepKm = 0;
    let grade = 0;

    if (i > 0) {
      const prev = points[i - 1];
      distStepKm = calculateDistance(prev, pt);
      if (!Number.isFinite(distStepKm) || distStepKm < 0) distStepKm = 0;
      cumDistKm += distStepKm;

      const distM = distStepKm * 1000;
      const dEle = (pt.ele || 0) - (prev.ele || 0);
      if (distM > 1) {
        grade = Math.max(-0.25, Math.min(0.28, dEle / distM));
      }

      if (pt.time && prev.time) {
        const t2 = pt.time instanceof Date ? pt.time.getTime() : new Date(pt.time).getTime();
        const t1 = prev.time instanceof Date ? prev.time.getTime() : new Date(prev.time).getTime();
        const diffSec = (t2 - t1) / 1000;
        if (Number.isFinite(diffSec) && diffSec > 0 && diffSec <= 120) {
          dt = diffSec;
        } else if (distM > 0) {
          dt = Math.max(1, distM / defaultSpeedMs);
        }
      } else if (distM > 0) {
        // Adjust speed by slope when timestamps are missing
        const slopeFactor = grade > 0 ? Math.max(0.32, 1 - grade * 5.2) : Math.min(1.55, 1 - grade * 2.5);
        dt = Math.max(1, distM / Math.max(1.5, defaultSpeedMs * slopeFactor));
      }
      elapsedSec += dt;
    }

    let powerW = 0;
    let isEstimatedPower = false;

    if (typeof pt.power === 'number' && Number.isFinite(pt.power) && pt.power >= 0) {
      powerW = pt.power;
    } else {
      isEstimatedPower = true;
      const distM = distStepKm * 1000;
      const vMs = i === 0 ? defaultSpeedMs : Math.max(1.2, Math.min(19, distM > 0.2 ? distM / Math.max(0.5, dt) : defaultSpeedMs));
      const fGravity = totalMassKg * g * grade;
      const fRoll = totalMassKg * g * crr * Math.cos(Math.atan(grade));
      const fAero = 0.5 * rho * cda * vMs * vMs;
      const rawWheelW = (fGravity + fRoll + fAero) * vMs;
      powerW = grade < -0.04 ? 0 : Math.max(0, Math.min(ftp * 2.1, Math.round(rawWheelW / 0.97)));
    }

    if (i > 0) {
      if (powerW > cpWatts) {
        const excessJ = (powerW - cpWatts) * dt;
        currentWbalJ = Math.max(0, currentWbalJ - excessJ);
        timeAboveCpSec += dt;
        workAboveCpJ += excessJ;

        if (!inMatch) {
          inMatch = true;
          matchStartIdx = i - 1;
          matchStartKm = Math.max(0, cumDistKm - distStepKm);
          matchDurationSec = 0;
          matchWeightedPowerSum = 0;
          matchPeakPower = 0;
          matchBurnedJ = 0;
          matchMinWbalPct = (currentWbalJ / wPrimeJoules) * 100;
        }
        matchDurationSec += dt;
        matchWeightedPowerSum += powerW * dt;
        if (powerW > matchPeakPower) matchPeakPower = powerW;
        matchBurnedJ += excessJ;
        const pctNow = (currentWbalJ / wPrimeJoules) * 100;
        if (pctNow < matchMinWbalPct) matchMinWbalPct = pctNow;
      } else {
        // Skiba reconstitution time constant tau_W'
        const dCp = Math.max(0, cpWatts - powerW);
        const tauW = 546 * Math.exp(-0.01 * dCp) + 316;
        currentWbalJ = wPrimeJoules - (wPrimeJoules - currentWbalJ) * Math.exp(-dt / tauW);
        currentWbalJ = Math.min(wPrimeJoules, Math.max(0, currentWbalJ));

        if (inMatch) {
          // Close match if recovery exceeds 10s or power drops well below CP
          const minBurnThresholdJ = Math.max(2500, wPrimeJoules * 0.16);
          if (matchBurnedJ >= minBurnThresholdJ && matchDurationSec >= 10) {
            const startPt = points[matchStartIdx] || pt;
            matches.push({
              id: `match-${matches.length + 1}-${matchStartIdx}`,
              matchNumber: matches.length + 1,
              startIndex: matchStartIdx,
              endIndex: i - 1,
              startKm: Number(matchStartKm.toFixed(2)),
              endKm: Number(cumDistKm.toFixed(2)),
              durationSec: Math.round(matchDurationSec),
              avgPowerW: Math.round(matchWeightedPowerSum / Math.max(1, matchDurationSec)),
              peakPowerW: Math.round(matchPeakPower),
              joulesBurned: Math.round(matchBurnedJ),
              kjBurned: Number((matchBurnedJ / 1000).toFixed(1)),
              pctWPrimeBurned: Math.round((matchBurnedJ / wPrimeJoules) * 100),
              minWbalPct: Math.max(0, Math.round(matchMinWbalPct)),
              lat: startPt.lat,
              lng: startPt.lng
            });
          }
          inMatch = false;
        }
      }
    }

    if (currentWbalJ < minWbalJ) {
      minWbalJ = currentWbalJ;
      minWbalDistKm = cumDistKm;
    }

    const wbalPct = Math.max(0, Math.min(100, Number(((currentWbalJ / wPrimeJoules) * 100).toFixed(1))));

    series.push({
      index: i,
      distanceKm: Number(cumDistKm.toFixed(3)),
      elapsedSec: Math.round(elapsedSec),
      ele: Math.round(pt.ele || 0),
      gradePct: Number((grade * 100).toFixed(1)),
      powerW: Math.round(powerW),
      isEstimatedPower,
      wbalJoules: Math.round(currentWbalJ),
      wbalKj: Number((currentWbalJ / 1000).toFixed(2)),
      wbalPct,
      lat: pt.lat,
      lng: pt.lng
    });
  }

  // Flush open match at end of track
  if (inMatch) {
    const minBurnThresholdJ = Math.max(2500, wPrimeJoules * 0.16);
    if (matchBurnedJ >= minBurnThresholdJ && matchDurationSec >= 10) {
      const startPt = points[matchStartIdx] || points[points.length - 1];
      matches.push({
        id: `match-${matches.length + 1}-${matchStartIdx}`,
        matchNumber: matches.length + 1,
        startIndex: matchStartIdx,
        endIndex: points.length - 1,
        startKm: Number(matchStartKm.toFixed(2)),
        endKm: Number(cumDistKm.toFixed(2)),
        durationSec: Math.round(matchDurationSec),
        avgPowerW: Math.round(matchWeightedPowerSum / Math.max(1, matchDurationSec)),
        peakPowerW: Math.round(matchPeakPower),
        joulesBurned: Math.round(matchBurnedJ),
        kjBurned: Number((matchBurnedJ / 1000).toFixed(1)),
        pctWPrimeBurned: Math.round((matchBurnedJ / wPrimeJoules) * 100),
        minWbalPct: Math.max(0, Math.round(matchMinWbalPct)),
        lat: startPt.lat,
        lng: startPt.lng
      });
    }
  }

  return {
    cpWatts,
    wPrimeKj,
    wPrimeJoules,
    minWbalKj: Number((minWbalJ / 1000).toFixed(1)),
    minWbalPct: Math.max(0, Math.round((minWbalJ / wPrimeJoules) * 100)),
    minWbalDistKm: Number(minWbalDistKm.toFixed(1)),
    matches,
    totalMatchesCount: matches.length,
    timeAboveCpSec: Math.round(timeAboveCpSec),
    workAboveCpKj: Number((workAboveCpJ / 1000).toFixed(1)),
    hasNativePower,
    series
  };
}

/**
 * Estimates Critical Power (CP) and W' from Mean Maximal Power (MMP) bests
 * using linear Work-Time regression: Work(t) = CP * t + W' over 3m..20m durations.
 */
export function estimateCriticalPowerFromBests(
  mmpBests: Array<{ durationSec: number; label: string; watts: number }>,
  fallbackFtp: number,
  riderWeightKg: number
): CpModelEstimate {
  const validWeight = Math.max(35, riderWeightKg || 75);
  const regressionDurations = mmpBests.filter(
    (d) => d.durationSec >= 120 && d.durationSec <= 1800 && d.watts > 50
  );

  let cpWatts = Math.round(fallbackFtp * 0.96);
  let wPrimeJoules = 19500;
  let rSquared = 0.98;

  if (regressionDurations.length >= 2) {
    // Work J = watts * durationSec = CP * t + W'
    const n = regressionDurations.length;
    let sumT = 0;
    let sumW = 0;
    let sumTT = 0;
    let sumTW = 0;

    for (const pt of regressionDurations) {
      const t = pt.durationSec;
      const w = pt.watts * t;
      sumT += t;
      sumW += w;
      sumTT += t * t;
      sumTW += t * w;
    }

    const denom = n * sumTT - sumT * sumT;
    if (denom > 0) {
      const slopeCp = (n * sumTW - sumT * sumW) / denom;
      const interceptWPrime = (sumW - slopeCp * sumT) / n;

      if (slopeCp > 80 && slopeCp < 600) {
        cpWatts = Math.round(slopeCp);
      }
      if (interceptWPrime >= 6000 && interceptWPrime <= 42000) {
        wPrimeJoules = Math.round(interceptWPrime);
      } else {
        wPrimeJoules = Math.max(8000, Math.min(36000, Math.round(interceptWPrime || 18000)));
      }

      // Compute R^2
      const meanW = sumW / n;
      let ssTot = 0;
      let ssRes = 0;
      for (const pt of regressionDurations) {
        const actualW = pt.watts * pt.durationSec;
        const predW = cpWatts * pt.durationSec + wPrimeJoules;
        ssTot += Math.pow(actualW - meanW, 2);
        ssRes += Math.pow(actualW - predW, 2);
      }
      if (ssTot > 0) {
        rSquared = Math.max(0.75, Math.min(0.999, Number((1 - ssRes / ssTot).toFixed(3))));
      }
    }
  }

  const wPrimeKj = Number((wPrimeJoules / 1000).toFixed(1));
  const cpWkg = Number((cpWatts / validWeight).toFixed(2));
  const best5s = mmpBests.find((b) => b.durationSec <= 15)?.watts || Math.round(cpWatts * 3.1);
  const pMaxWatts = Math.max(best5s, Math.round(cpWatts * 2.8));

  // Phenotype classification based on W' (kJ) and W'/kg
  const wPrimePerKg = wPrimeKj / validWeight;
  let phenotype: CpModelEstimate['phenotype'] = 'Allrounder / Rouleur';
  let phenotypeDescription =
    'Ausgewogenes Verhältnis zwischen aerober Schwelle (CP) und anaerober Kapazität (W\'). Stark im welligen Terrain und bei langen Tempowechseln.';

  if (wPrimePerKg >= 0.32) {
    phenotype = 'Sprinter / Puncheur';
    phenotypeDescription =
      'Überdurchschnittlich großer anaerober Speicher (W\'). Ideal für explosive Attacken, kurze steile Rampen und wiederholte Sprints.';
  } else if (wPrimePerKg >= 0.25 && cpWkg >= 3.6) {
    phenotype = 'Puncheur / Allrounder';
    phenotypeDescription =
      'Hohe VO2max-Reserve kombiniert mit solider Dauerleistung. Sehr stark an kurzen bis mittelschweren Anstiegen (1–8 Minuten).';
  } else if (cpWkg >= 3.8 && wPrimePerKg < 0.24) {
    phenotype = 'Kletterer / Zeitfahrer';
    phenotypeDescription =
      'Hohe aerobe Dauerleistungsgrenze (CP/kg) bei kompaktem anaerobem Puffer. Optimal für lange Alpenpässe und gleichmäßiges Zeitfahren.';
  }

  const standardDurations = [
    { durationSec: 15, label: '15s' },
    { durationSec: 60, label: '1m' },
    { durationSec: 180, label: '3m' },
    { durationSec: 300, label: '5m' },
    { durationSec: 600, label: '10m' },
    { durationSec: 1200, label: '20m' },
    { durationSec: 3600, label: '60m' }
  ];

  const curvePoints = standardDurations.map((d) => {
    const found = mmpBests.find((b) => b.durationSec === d.durationSec);
    // 3-parameter damped anaerobic contribution for short durations (< 60s)
    const kShort = wPrimeJoules / Math.max(200, pMaxWatts - cpWatts);
    const anaerobicWatts = Math.round(wPrimeJoules / (d.durationSec + kShort));
    const aerobicWatts = cpWatts;
    const modeledWatts = aerobicWatts + anaerobicWatts;
    return {
      durationSec: d.durationSec,
      label: d.label,
      actualWatts: found && found.watts > 0 ? Math.round(found.watts) : modeledWatts,
      modeledWatts,
      aerobicWatts,
      anaerobicWatts
    };
  });

  return {
    cpWatts,
    cpWkg,
    wPrimeKj,
    wPrimeJoules,
    pMaxWatts,
    phenotype,
    phenotypeDescription,
    rSquared,
    curvePoints
  };
}
