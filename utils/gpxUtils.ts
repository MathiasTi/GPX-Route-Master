
import { GPXPoint, GPXTrack, PowerStats, ClimbSegment, TimeGap, TrackValidationReport, ValidationIssue } from '../types';

export const toDate = (timeVal: any): Date | undefined => {
  if (!timeVal) return undefined;
  if (timeVal instanceof Date) return timeVal;
  const d = new Date(timeVal);
  return isNaN(d.getTime()) ? undefined : d;
};

/**
 * Linearly interpolates missing elevation values (null, undefined, or NaN)
 * in a robust manner to ensure a continuous and realistic ground profile.
 * Handles negative elevations correctly.
 */
export const interpolateMissingElevations = (points: GPXPoint[]): void => {
  if (!points || points.length === 0) return;

  const n = points.length;
  // Find the first point that has a valid numerical elevation (could be negative or 0)
  const firstValidIndex = points.findIndex(
    p => p.ele !== undefined && p.ele !== null && !isNaN(p.ele)
  );

  if (firstValidIndex === -1) {
    // If absolutely no valid elevation data is present, default everything to flat 0m
    for (const p of points) {
      p.ele = 0;
    }
    return;
  }

  // Backfill any points before the first valid index with that index's elevation value
  const firstValidEle = points[firstValidIndex].ele!;
  for (let i = 0; i < firstValidIndex; i++) {
    points[i].ele = firstValidEle;
  }

  // Iteratively process and linearly interpolate any internal gaps of missing elevations
  let i = firstValidIndex;
  while (i < n) {
    if (points[i].ele === undefined || points[i].ele === null || isNaN(points[i].ele!)) {
      // Find the next point that has a valid elevation
      let nextValidIndex = -1;
      for (let j = i + 1; j < n; j++) {
        if (points[j].ele !== undefined && points[j].ele !== null && !isNaN(points[j].ele)) {
          nextValidIndex = j;
          break;
        }
      }

      if (nextValidIndex !== -1) {
        // Linearly interpolate between points[i - 1] and points[nextValidIndex]
        const startVal = points[i - 1].ele!;
        const endVal = points[nextValidIndex].ele!;
        const totalSteps = nextValidIndex - (i - 1);
        for (let k = i; k < nextValidIndex; k++) {
          const ratio = (k - (i - 1)) / totalSteps;
          points[k].ele = Number((startVal + ratio * (endVal - startVal)).toFixed(2));
        }
        i = nextValidIndex + 1;
      } else {
        // If there are no more valid elevations, forward-fill the remaining points with points[i - 1]'s value
        const lastVal = points[i - 1].ele!;
        for (let k = i; k < n; k++) {
          points[k].ele = lastVal;
        }
        break;
      }
    } else {
      i++;
    }
  }
};

/**
 * Sanitizes GPX/FIT trackpoints by filtering out unrealistic sensor values.
 * Unrealistic values (e.g. Heart Rate = 255 or >= 230, Power > 2500W, Cadence > 250rpm)
 * are smoothly interpolated using linear interpolation from surrounding valid points.
 */
export const sanitizeGPXPoints = (points: GPXPoint[]): GPXPoint[] => {
  if (!points || points.length === 0) return points;

  const isInvalidHr = (hr: number | undefined): boolean => {
    if (hr === undefined || isNaN(hr)) return false;
    return hr === 255 || hr >= 230 || hr <= 30;
  };

  const isInvalidPower = (pwr: number | undefined): boolean => {
    if (pwr === undefined || isNaN(pwr)) return false;
    return pwr >= 2500 || pwr < 0;
  };

  const isInvalidCadence = (cad: number | undefined): boolean => {
    if (cad === undefined || isNaN(cad)) return false;
    return cad >= 250 || cad < 0;
  };

  const sanitized = points.map(p => ({ ...p }));

  const interpolateKey = (key: 'hr' | 'power' | 'cadence', isInvalidFn: (val: number | undefined) => boolean) => {
    for (let i = 0; i < sanitized.length; i++) {
      const val = sanitized[i][key];
      if (val !== undefined && isInvalidFn(val)) {
        let prevValidVal: number | undefined = undefined;
        let prevIndex = -1;
        for (let j = i - 1; j >= 0; j--) {
          const v = sanitized[j][key];
          if (v !== undefined && !isInvalidFn(v)) {
            prevValidVal = v;
            prevIndex = j;
            break;
          }
        }

        let nextValidVal: number | undefined = undefined;
        let nextIndex = -1;
        for (let j = i + 1; j < sanitized.length; j++) {
          const v = sanitized[j][key];
          if (v !== undefined && !isInvalidFn(v)) {
            nextValidVal = v;
            nextIndex = j;
            break;
          }
        }

        if (prevValidVal !== undefined && nextValidVal !== undefined) {
          const fraction = (i - prevIndex) / (nextIndex - prevIndex);
          sanitized[i][key] = Math.round(prevValidVal + fraction * (nextValidVal - prevValidVal));
        } else if (prevValidVal !== undefined) {
          sanitized[i][key] = prevValidVal;
        } else if (nextValidVal !== undefined) {
          sanitized[i][key] = nextValidVal;
        } else {
          sanitized[i][key] = undefined;
        }
      }
    }
  };

  interpolateKey('hr', isInvalidHr);
  interpolateKey('power', isInvalidPower);
  interpolateKey('cadence', isInvalidCadence);

  return sanitized;
};

export interface ClimbCriteria {
  type: 'standard' | 'strava' | 'garmin' | 'custom';
  minDistance: number;
  minGradient: number;
  minScore: number;
  smoothingWindow: number;
}

export const getActiveClimbCriteria = (): ClimbCriteria => {
  if (typeof window === 'undefined') {
    return { type: 'garmin', minDistance: 500, minGradient: 3.0, minScore: 1500, smoothingWindow: 30 };
  }
  try {
    const stored = localStorage.getItem('gpx_climb_criteria');
    if (stored) {
      const parsed = JSON.parse(stored);
      if (parsed && typeof parsed === 'object' && parsed.type) {
        return parsed;
      }
    }
  } catch (e) {}
  return { type: 'garmin', minDistance: 500, minGradient: 3.0, minScore: 1500, smoothingWindow: 30 };
};

export const findClimbs = (
  points: GPXPoint[],
  criteria: ClimbCriteria = getActiveClimbCriteria()
): ClimbSegment[] => {
  if (points.length < 5) return [];
  
  const minClimbDistance = criteria.minDistance;
  const minAvgGradient = criteria.minGradient;
  const minScore = criteria.minScore || 0;
  const SMOOTH_WINDOW_M = criteria.smoothingWindow || 30;
  
  // Calculate cumulative distance and filled elevation
  const cumDist = new Float64Array(points.length);
  const filledEle = new Float64Array(points.length);
  const tempPoints = points.map(p => ({ ...p }));
  interpolateMissingElevations(tempPoints);
  
  for (let i = 0; i < points.length; i++) {
    filledEle[i] = tempPoints[i].ele!;
    if (i > 0) {
      cumDist[i] = cumDist[i - 1] + calculateDistance(points[i - 1], points[i]) * 1000;
    } else {
      cumDist[0] = 0;
    }
  }

  // Smooth elevation data first to eliminate GPS micro-jitter (using a rolling window)
  const smoothedEle = new Float64Array(points.length);
  for (let i = 0; i < points.length; i++) {
    let sum = 0, count = 0;
    let j = i;
    while (j >= 0 && cumDist[i] - cumDist[j] <= SMOOTH_WINDOW_M / 2) {
      sum += filledEle[j];
      count++;
      j--;
    }
    j = i + 1;
    while (j < points.length && cumDist[j] - cumDist[i] <= SMOOTH_WINDOW_M / 2) {
      sum += filledEle[j];
      count++;
      j++;
    }
    smoothedEle[i] = count > 0 ? sum / count : filledEle[i];
  }

  const climbs: ClimbSegment[] = [];
  
  for (let i = 0; i < points.length - 2; i++) {
    // Look for a point at least minClimbDistance ahead
    for (let j = i + 1; j < points.length; j++) {
      const dist = cumDist[j] - cumDist[i];
      if (dist < minClimbDistance) continue;
      
      const eleDiff = smoothedEle[j] - smoothedEle[i];
      const avgGrad = (eleDiff / dist) * 100;
      
      if (avgGrad >= minAvgGradient) {
        // Potential climb found, now try to extend it point-by-point
        let currentEnd = j;
        let runningMaxGrad = avgGrad;
        
        while (currentEnd < points.length - 1) {
          const nextDist = cumDist[currentEnd + 1] - cumDist[currentEnd];
          const nextEle = smoothedEle[currentEnd + 1] - smoothedEle[currentEnd];
          const segmentGrad = nextDist > 0 ? (nextEle / nextDist) * 105 : 0; // slight scaling factor for short intervals
          
          // Allow minor flats or downhills (up to -2.0%) as part of a climb
          // as long as the overall average gradient remains above the minimum average gradient
          const overallAvgGrad = ((smoothedEle[currentEnd + 1] - smoothedEle[i]) / (cumDist[currentEnd + 1] - cumDist[i])) * 100;
          if (segmentGrad > -2.0 || overallAvgGrad > minAvgGradient) {
            currentEnd += 1;
            if (segmentGrad > runningMaxGrad) runningMaxGrad = segmentGrad;
          } else {
            break;
          }
        }
        
        const finalDist = cumDist[currentEnd] - cumDist[i];
        const finalAscent = smoothedEle[currentEnd] - smoothedEle[i];
        const finalAvgGrad = (finalAscent / finalDist) * 100;
        const finalScore = finalDist * finalAvgGrad;
        
        if (finalDist >= minClimbDistance && finalAvgGrad >= minAvgGradient && finalScore >= minScore) {
          climbs.push({
            startIndex: i,
            endIndex: currentEnd,
            distance: finalDist,
            ascent: finalAscent,
            avgGradient: finalAvgGrad,
            maxGradient: runningMaxGrad
          });
          i = currentEnd; // Skip processed points
          break;
        }
      } else if (avgGrad < -3) {
        // If it's a significant descent, stop looking from this start point
        break;
      }
    }
  }
  
  return climbs;
};

export const estimateTrackPower = (points: GPXPoint[], weightKg: number = 75, speedKmh: number = 15, activityType?: 'cycling' | 'running'): GPXPoint[] => {
  if (activityType === 'running') {
    // Smooth elevations to reduce GPS noise
    const eleSmoothed = new Float64Array(points.length);
    const windowHalf = 5;
    for (let i = 0; i < points.length; i++) {
      let sum = 0, count = 0;
      for (let j = Math.max(0, i - windowHalf); j <= Math.min(points.length - 1, i + windowHalf); j++) {
        if (points[j].ele !== undefined && points[j].ele !== null && !isNaN(points[j].ele!)) {
          sum += points[j].ele!;
          count++;
        }
      }
      eleSmoothed[i] = count > 0 ? sum / count : (points[i].ele ?? 0);
    }

    return points.map((p, i) => {
      if (p.power !== undefined) return p;

      let slope = 0;
      let speedMs = speedKmh / 3.6;

      if (i > 0) {
        const pPrev = points[i - 1];
        const distM = calculateDistance(pPrev, p) * 1000;
        
        if (distM > 1) {
          const eleDiff = eleSmoothed[i] - eleSmoothed[i - 1];
          slope = eleDiff / distM;
        }

        const t1 = toDate(p.time);
        const t2 = toDate(pPrev.time);
        if (t1 && t2) {
          const dt = (t1.getTime() - t2.getTime()) / 1000;
          if (dt > 0 && dt < 120 && distM > 0) {
            speedMs = distM / dt;
          }
        }
      }

      // Biomechanical running power formula: P = metabolic efficiency coef * bodyMass * speed
      // Typically running on level ground of 1 m/s requires ~1.04 W/kg of mechanical-equivalent power (like Stryd).
      const runningFactor = 1.04; 
      let power = runningFactor * weightKg * speedMs;

      // Adjust for graded hills
      slope = Math.max(-0.25, Math.min(0.25, slope));
      if (slope > 0) {
        // High steepness increases energy requirement dramatically
        power *= (1 + slope * 3.6);
      } else if (slope < 0) {
        // Flat downhill requires less, but we active/braking limits it, at least 60% of flat running power
        power *= Math.max(0.60, 1 + slope * 1.5);
      }

      if (speedMs < 0.2) {
        power = 0;
      }

      return {
        ...p,
        power: Math.round(power)
      };
    });
  }

  const totalMass = weightKg + 8.5; // Rider + active equipment
  const g = 9.81;
  const Crr = 0.005; // Rolling resistance coefficient
  const CdA = 0.35;  // Coefficient of aerodynamic drag * area
  const rho = 1.225; // Air density

  // Smooth elevations to reduce GPS noise
  const eleSmoothed = new Float64Array(points.length);
  const windowHalf = 5;
  for (let i = 0; i < points.length; i++) {
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - windowHalf); j <= Math.min(points.length - 1, i + windowHalf); j++) {
      if (points[j].ele !== undefined && points[j].ele !== null && !isNaN(points[j].ele!)) {
        sum += points[j].ele!;
        count++;
      }
    }
    eleSmoothed[i] = count > 0 ? sum / count : (points[i].ele ?? 0);
  }

  return points.map((p, i) => {
    if (p.power !== undefined) return p;

    let slope = 0;
    let speedMs = speedKmh / 3.6;

    if (i > 0) {
      const pPrev = points[i - 1];
      const distM = calculateDistance(pPrev, p) * 1000;
      
      if (distM > 1) {
        const eleDiff = eleSmoothed[i] - eleSmoothed[i - 1];
        slope = eleDiff / distM;
      }

      const t1 = toDate(p.time);
      const t2 = toDate(pPrev.time);
      if (t1 && t2) {
        const dt = (t1.getTime() - t2.getTime()) / 1000;
        if (dt > 0 && dt < 120 && distM > 0) {
          speedMs = distM / dt;
        }
      }
    }

    // Clip gradient extremes
    slope = Math.max(-0.22, Math.min(0.22, slope));

    const fGrav = totalMass * g * Math.sin(Math.atan(slope));
    const fRoll = totalMass * g * Math.cos(Math.atan(slope)) * Crr;
    const fAero = 0.5 * rho * CdA * speedMs * speedMs;
    
    let fNet = fGrav + fRoll + fAero;
    let rawPower = fNet * speedMs;
    let power = rawPower / 0.95; // Drivetrain transfer factor

    if (slope < -0.04) {
      power = 0; // Coasting
    } else {
      power = Math.max(10, Math.min(950, power));
    }

    if (speedMs < 0.2) {
      power = 0; // Standing still
    }

    return {
      ...p,
      power: Math.round(power)
    };
  });
};

export const calculatePowerStats = (
  points: GPXPoint[],
  ftp: number = 250,
  userWeight: number = 75,
  estimatedSpeed: number = 15,
  activityType?: 'cycling' | 'running'
): PowerStats | undefined => {
  // Check if track has power. If not, estimate it
  const hasRealPower = points.some(p => p.power !== undefined);
  const processedPoints = hasRealPower ? points : estimateTrackPower(points, userWeight, estimatedSpeed, activityType);

  const powerPoints = processedPoints.filter(p => p.power !== undefined && p.time);
  if (powerPoints.length < 2) return undefined;

  // 1. Smooth power data (5-point moving average)
  const smoothedPower = processedPoints.map((p, i) => {
    if (p.power === undefined) return undefined;
    const window = 2;
    let sum = 0, count = 0;
    for (let j = Math.max(0, i - window); j <= Math.min(processedPoints.length - 1, i + window); j++) {
      if (processedPoints[j].power !== undefined) {
        sum += Math.min(processedPoints[j].power!, 2500);
        count++;
      }
    }
    return sum / count;
  });

  // 2. Time-weighted Average Power and Work
  let totalEnergy = 0;
  let totalTime = 0;
  for (let i = 1; i < processedPoints.length; i++) {
    const p1 = processedPoints[i - 1];
    const p2 = processedPoints[i];
    const t1 = toDate(p1.time);
    const t2 = toDate(p2.time);
    if (p1.power !== undefined && p2.power !== undefined && t1 && t2) {
      const dt = (t2.getTime() - t1.getTime()) / 1000;
      if (dt > 0 && dt < 30) {
        const avgP = (smoothedPower[i]! + smoothedPower[i - 1]!) / 2;
        totalEnergy += avgP * dt;
        totalTime += dt;
      }
    }
  }
  const avgPower = totalTime > 0 ? totalEnergy / totalTime : 0;
  const work = totalEnergy / 1000; // Joules to kJ

  // 3. Max Power (from smoothed data)
  const validSmoothed = smoothedPower.filter(p => p !== undefined) as number[];
  const maxPower = validSmoothed.length > 0 ? Math.max(...validSmoothed) : 0;

  // 4. Best 20s, 1m, 20m using 1s interpolation
  const timedPoints = processedPoints.map((p, i) => ({ ...p, power: smoothedPower[i] })).filter(p => p.time && p.power !== undefined);
  if (timedPoints.length < 2) return { avgPower, maxPower, best20s: avgPower, best1m: avgPower, best20m: avgPower, work };

  const tStart = toDate(timedPoints[0].time);
  const tEnd = toDate(timedPoints[timedPoints.length - 1].time);
  if (!tStart || !tEnd) return { avgPower, maxPower, best20s: avgPower, best1m: avgPower, best20m: avgPower, work };

  const startTime = tStart.getTime();
  const endTime = tEnd.getTime();
  const durationSec = Math.floor((endTime - startTime) / 1000);
  
  if (durationSec < 5) return { avgPower, maxPower, best20s: avgPower, best1m: avgPower, best20m: avgPower, work };

  const power1s = new Float32Array(durationSec + 1);
  let pIdx = 0;
  for (let t = 0; t <= durationSec; t++) {
    const targetTime = startTime + t * 1000;
    while (pIdx < timedPoints.length - 1 && (toDate(timedPoints[pIdx + 1].time)?.getTime() ?? 0) < targetTime) {
      pIdx++;
    }
    const p1 = timedPoints[pIdx];
    const p2 = timedPoints[pIdx + 1];
    if (p2) {
      const t1 = toDate(p1.time)?.getTime() ?? 0;
      const t2 = toDate(p2.time)?.getTime() ?? 0;
      if (t2 - t1 > 5000) { // Gap larger than 5 seconds
        if (targetTime - t1 <= 2000) power1s[t] = p1.power!;
        else if (t2 - targetTime <= 2000) power1s[t] = p2.power!;
        else power1s[t] = 0;
      } else {
        const ratio = (targetTime - t1) / (t2 - t1);
        power1s[t] = p1.power! + (p2.power! - p1.power!) * ratio;
      }
    } else {
      power1s[t] = p1.power!;
    }
  }

  const getBestRolling = (window: number) => {
    if (power1s.length < window) return avgPower;
    let currentSum = 0;
    for (let i = 0; i < window; i++) currentSum += power1s[i];
    let maxSum = currentSum;
    for (let i = window; i < power1s.length; i++) {
      currentSum += power1s[i] - power1s[i - window];
      if (currentSum > maxSum) maxSum = currentSum;
    }
    return maxSum / window;
  };

  // 5. Normalized Power (NP)
  let normalizedPower = avgPower;
  if (power1s.length >= 30) {
    let rollingSum30 = 0;
    for (let i = 0; i < 30; i++) rollingSum30 += power1s[i];
    
    let sumPowers = Math.pow(rollingSum30 / 30, 4);
    let count = 1;
    
    for (let i = 30; i < power1s.length; i++) {
      rollingSum30 += power1s[i] - power1s[i - 30];
      sumPowers += Math.pow(rollingSum30 / 30, 4);
      count++;
    }
    normalizedPower = Math.pow(sumPowers / count, 0.25);
  }

  const intensityFactor = normalizedPower / ftp;
  const tss = (totalTime * normalizedPower * intensityFactor) / (ftp * 36) ; // (s * watts * IF) / (ftp * 3600) * 100
  const variabilityIndex = avgPower > 0 ? normalizedPower / avgPower : 1;

  return {
    avgPower,
    maxPower,
    best20s: getBestRolling(20),
    best1m: getBestRolling(60),
    best20m: getBestRolling(1200),
    normalizedPower,
    intensityFactor,
    tss,
    variabilityIndex,
    work
  };
};

export const formatPace = (durationSecs: number, distanceKm: number): string => {
  if (!distanceKm || !durationSecs) return "--:-- min/km";
  const paceTotalSec = durationSecs / distanceKm;
  if (paceTotalSec > 3600) return ">60:00 min/km";
  const mins = Math.floor(paceTotalSec / 60);
  const secs = Math.round(paceTotalSec % 60);
  return `${mins}:${secs.toString().padStart(2, '0')} min/km`;
};

export const getPaceString = (speedKmh: number): string => {
  if (speedKmh <= 0.1) return "--:-- min/km";
  const paceMinKm = 60 / speedKmh;
  if (paceMinKm > 60) return ">60:00 min/km";
  const mins = Math.floor(paceMinKm);
  const secs = Math.floor((paceMinKm % 1) * 60);
  return `${mins}:${secs.toString().padStart(2, '0')} min/km`;
};

/**
 * Basic Haversine distance calculation in kilometers
 */
export const calculateDistance = (p1: GPXPoint, p2: GPXPoint): number => {
  const R = 6371; // Earth's radius in km
  const dLat = (p2.lat - p1.lat) * Math.PI / 180;
  const dLng = (p2.lng - p1.lng) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1.lat * Math.PI / 180) * Math.cos(p2.lat * Math.PI / 180) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
};

/**
 * Calculates the bearing between two points in degrees
 */
export const calculateBearing = (p1: GPXPoint, p2: GPXPoint): number => {
  const lat1 = p1.lat * Math.PI / 180;
  const lat2 = p2.lat * Math.PI / 180;
  const lon1 = p1.lng * Math.PI / 180;
  const lon2 = p2.lng * Math.PI / 180;

  const y = Math.sin(lon2 - lon1) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) -
            Math.sin(lat1) * Math.cos(lat2) * Math.cos(lon2 - lon1);
  const θ = Math.atan2(y, x);
  return (θ * 180 / Math.PI + 360) % 360;
};

export const calculateElevationStats = (points: GPXPoint[]) => {
  let ascent = 0;
  let descent = 0;
  let maxSlope = 0;
  let totalDist = 0;

  if (points.length < 2) return { ascent, descent, maxSlope, totalDist };

  // Calculate cumulative distance for each point
  const cumDist = new Float64Array(points.length);
  cumDist[0] = 0;
  for (let i = 1; i < points.length; i++) {
    const d = calculateDistance(points[i - 1], points[i]);
    cumDist[i] = cumDist[i - 1] + d;
    totalDist += d;
  }

  // Pre-fill missing elevation data using linear interpolation
  const filledEle = new Float64Array(points.length);
  const tempPoints = points.map(p => ({ ...p }));
  interpolateMissingElevations(tempPoints);
  for (let i = 0; i < tempPoints.length; i++) {
    filledEle[i] = tempPoints[i].ele!;
  }

  // 1. Smooth elevation data (distance-based, 60m window to robustly filter GPS micro-jitter)
  const smoothedEle = new Float64Array(points.length);
  const SMOOTH_WINDOW_KM = 0.060; 
  
  for (let i = 0; i < points.length; i++) {
    let sum = 0;
    let count = 0;
    
    let j = i;
    while (j >= 0 && cumDist[i] - cumDist[j] <= SMOOTH_WINDOW_KM / 2) {
      sum += filledEle[j];
      count++;
      j--;
    }
    
    j = i + 1;
    while (j < points.length && cumDist[j] - cumDist[i] <= SMOOTH_WINDOW_KM / 2) {
      sum += filledEle[j];
      count++;
      j++;
    }
    
    smoothedEle[i] = count > 0 ? sum / count : filledEle[i];
  }

  // 2. Calculate ascent/descent using a cumulative deadband filter to prevent noise while keeping gentle slopes
  let lastAcceptedEle = smoothedEle[0];
  const ELE_THRESHOLD = 1.5; // 1.5 meters threshold for robust noise filtering matching Garmin/Strava
  for (let i = 1; i < points.length; i++) {
    const e = smoothedEle[i];
    if (!isNaN(e)) {
      const diff = e - lastAcceptedEle;
      if (diff >= ELE_THRESHOLD) {
        ascent += diff;
        lastAcceptedEle = e;
      } else if (diff <= -ELE_THRESHOLD) {
        descent += Math.abs(diff);
        lastAcceptedEle = e;
      }
    }
  }

  // 3. Calculate max slope over a fixed distance window (50 meters)
  const SLOPE_WINDOW_KM = 0.050; 
  
  for (let i = 0; i < points.length; i++) {
    if (isNaN(smoothedEle[i])) continue;
    
    let j = i + 1;
    while (j < points.length && cumDist[j] - cumDist[i] < SLOPE_WINDOW_KM) {
      j++;
    }
    
    if (j < points.length) {
      const dSum = cumDist[j] - cumDist[i];
      if (dSum >= SLOPE_WINDOW_KM * 0.5) { // At least 25m to calculate a stable slope
        const eleDiff = smoothedEle[j] - smoothedEle[i];
        const slope = (eleDiff / (dSum * 1000)) * 100;
        if (slope > maxSlope) {
          maxSlope = slope;
        }
      }
    }
  }

  return { ascent, descent, maxSlope, totalDist };
};

export const normalizeSurfaceName = (rawSurface?: string): string => {
  if (!rawSurface) return 'Asphalt';
  const s = rawSurface.trim().toLowerCase();
  
  if (s.includes('schotter') || s.includes('gravel') || s.includes('dirt') || s.includes('unpaved') || s.includes('compacted') || s.includes('pebble') || s.includes('fine_gravel') || s.includes('grit')) {
    return 'Schotter';
  }
  if (s.includes('wald') || s.includes('trail') || s.includes('path') || s.includes('forest') || s.includes('ground') || s.includes('earth') || s.includes('singletrack') || s.includes('wood') || s.includes('grass')) {
    return 'Waldweg';
  }
  if (s.includes('fahrrad') || s.includes('radweg') || s.includes('cycleway') || s.includes('bike')) {
    return 'Fahrradweg';
  }
  if (s.includes('asphalt') || s.includes('paved') || s.includes('concrete') || s.includes('straß') || s.includes('strasse') || s.includes('road') || s.includes('tar') || s.includes('cement') || s.includes('cobblestone') || s.includes('paving')) {
    return 'Asphalt';
  }
  
  return rawSurface.charAt(0).toUpperCase() + rawSurface.slice(1);
};

export const calculateSurfaceStatsFromPoints = (points: GPXPoint[]): { type: string; distance: number }[] => {
  if (!points || points.length < 2) return [];
  
  let hasSurface = false;
  const surfaceDistances: Record<string, number> = {};

  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const stepDist = calculateDistance(p1, p2);
    const sType = p1.surface || p2.surface;
    if (sType) {
      hasSurface = true;
      const normType = normalizeSurfaceName(sType);
      surfaceDistances[normType] = (surfaceDistances[normType] || 0) + stepDist;
    }
  }

  if (!hasSurface) return [];

  return Object.entries(surfaceDistances)
    .map(([type, distance]) => ({ type, distance: Math.round(distance * 10) / 10 }))
    .filter(s => s.distance > 0)
    .sort((a, b) => b.distance - a.distance);
};

export const hydratePointsWithSurface = (points: GPXPoint[], surfaceStats: { type: string; distance: number }[], totalDist: number) => {
  if (!points || points.length === 0 || !surfaceStats || surfaceStats.length === 0) return;
  const numPts = points.length;
  const trackDist = totalDist > 0 ? totalDist : calculateElevationStats(points).totalDist;

  if (trackDist <= 0) {
    const defaultSurf = surfaceStats[0]?.type || 'Asphalt';
    points.forEach(p => { if (!p.surface) p.surface = defaultSurf; });
    return;
  }

  points.forEach((pt, idx) => {
    if (pt.surface) return;
    const currentDist = (idx / Math.max(1, numPts - 1)) * trackDist;
    let accDist = 0;
    let matchedType = surfaceStats[surfaceStats.length - 1].type;
    for (const stat of surfaceStats) {
      accDist += stat.distance;
      if (currentDist <= accDist) {
        matchedType = stat.type;
        break;
      }
    }
    pt.surface = matchedType;
  });
};

const HIGH_CONTRAST_COLORS = [
  '#2563eb', // Velo Royal Blue
  '#0284c7', // Ocean Sky Blue
  '#059669', // Emerald Green
  '#d97706', // Amber Gold
  '#6366f1', // Indigo Blue
  '#0891b2', // Teal
  '#dc2626', // Classic Crimson
  '#7c3aed', // Deep Violet
];

let colorIndex = 0;

export const getLocationName = async (lat: number, lng: number): Promise<string> => {
  try {
    const response = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=10&addressdetails=1`, {
      headers: {
        'Accept-Language': 'de-DE, de;q=0.9, en;q=0.8'
      }
    });
    const data = await response.json();
    if (data.address) {
      return data.address.city || data.address.town || data.address.village || data.address.suburb || data.address.county || "Unbekannter Ort";
    }
    return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
  } catch (error) {
    console.error("Geocoding error:", error);
    return `${lat.toFixed(2)}, ${lng.toFixed(2)}`;
  }
};

export const getGPXPoints = (xml: Document): Element[] => {
  try {
    const allElements = xml.getElementsByTagName("*");
    const trkpts: Element[] = [];
    const rtepts: Element[] = [];
    const wpts: Element[] = [];

    for (let i = 0; i < allElements.length; i++) {
      const elem = allElements[i];
      const localName = (elem.localName || elem.nodeName).toLowerCase();
      if (localName === "trkpt" || localName === "trackpoint") {
        trkpts.push(elem);
      } else if (localName === "rtept" || localName === "routepoint") {
        rtepts.push(elem);
      } else if (localName === "wpt" || localName === "waypoint") {
        wpts.push(elem);
      }
    }

    if (trkpts.length > 0) return trkpts;
    if (rtepts.length > 0) return rtepts;
    return wpts;
  } catch (e) {
    console.error("Error extracting GPX points:", e);
    return [];
  }
};

export const getChildNode = (parent: Element, tagName: string): Element | null => {
  try {
    let node: Element | null = null;
    if (!tagName.includes(':')) {
      try {
        node = parent.querySelector(tagName);
      } catch (e) {
        // ignore invalid query selector
      }
    }
    if (node) return node;

    // Direct match with colon support or querySelector with namespaces
    const escapedTag = tagName.replace(/:/g, '\\:');
    try {
      node = parent.querySelector(escapedTag);
      if (node) return node;
    } catch (e) {
      // ignore
    }

    const allChildren = parent.getElementsByTagName("*");
    const targetLower = tagName.toLowerCase();
    for (let i = 0; i < allChildren.length; i++) {
      const child = allChildren[i];
      const localName = (child.localName || "").toLowerCase();
      const nodeName = child.nodeName.toLowerCase();
      if (localName === targetLower || nodeName === targetLower || nodeName.endsWith(":" + targetLower)) {
        return child;
      }
    }
  } catch (e) {
    // ignore
  }
  return null;
};

export const validateGPX = (xmlString: string): { isValid: boolean; error?: string } => {
  try {
    // Security check: Ignore custom ENTITY, DOCTYPE, or SYSTEM tags to avoid XXE/Billion-Laughs attacks
    const lowerXml = xmlString.toLowerCase();
    if (lowerXml.includes('<!entity') || lowerXml.includes('<!doctype') || lowerXml.includes('<!system')) {
      return { isValid: false, error: "Sicherheitsfehler: Benutzerdefinierte DOCTYPE- oder ENTITY-Definitionen sind im GPX nicht erlaubt." };
    }

    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlString, "text/xml");
    
    // Check for XML parsing errors
    const parserError = xml.getElementsByTagName("parsererror");
    if (parserError.length > 0) {
      return { isValid: false, error: "Ungültiges XML-Format." };
    }

    // Check for root <gpx> element (ignoring namespace or casing)
    const rootName = (xml.documentElement.localName || xml.documentElement.nodeName).toLowerCase().split(":").pop();
    if (rootName !== "gpx") {
      // Find out if we have any trackpoints anyway
      const ptsCount = getGPXPoints(xml).length;
      if (ptsCount === 0) {
        return { isValid: false, error: "Keine gültige GPX-Datei (Root-Element fehlt)." };
      }
    }

    // Check for any points (trackpoints, routepoints, or waypoints)
    const pts = getGPXPoints(xml);
    if (pts.length === 0) {
      return { isValid: false, error: "Die Datei enthält keine gültigen Trackpunkte oder Routepunkte." };
    }

    return { isValid: true };
  } catch (e) {
    return { isValid: false, error: "Fehler beim Validieren der Datei." };
  }
};

export const detectActivityType = (points: GPXPoint[], name: string, fileName: string): 'cycling' | 'running' => {
  const combined = (name + " " + fileName).toLowerCase();
  const keywords = ['run', 'lauf', 'jog', 'walk', 'hiking', 'running', 'laufen', 'jogging', 'spazier', 'wander', 'pace', 'lauft'];
  for (const kw of keywords) {
    if (combined.includes(kw)) return 'running';
  }

  // Speed check
  const hasTime = points.filter(p => p.time !== undefined);
  if (hasTime.length > 5) {
    let distSum = 0;
    let timeSum = 0;
    for (let i = 1; i < hasTime.length; i++) {
      const pPrev = hasTime[i - 1];
      const pCurr = hasTime[i];
      const d = calculateDistance(pPrev, pCurr);
      const t1 = toDate(pCurr.time);
      const t2 = toDate(pPrev.time);
      const dt = t1 && t2 ? (t1.getTime() - t2.getTime()) / 1000 : 0;
      if (dt > 0 && dt < 120) {
        distSum += d;
        timeSum += dt;
      }
    }
    if (timeSum > 0) {
      const avgKmh = distSum / (timeSum / 3600);
      if (avgKmh < 15.5) {
        return 'running';
      }
    }
  }
  return 'cycling';
};

export const parseGPX = async (xmlString: string, fileName: string): Promise<GPXTrack | null> => {
  const validation = validateGPX(xmlString);
  if (!validation.isValid) {
    console.error("GPX Validation Error:", validation.error);
    return null;
  }

  try {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlString, "text/xml");
    const trkpts = getGPXPoints(xml);
    
    // Try to extract name and description from GPX XML
    const gpxNameNode = xml.querySelector("gpx > metadata > name") || xml.querySelector("gpx > name") || xml.querySelector("trk > name") || xml.querySelector("rte > name");
    const parsedGpxName = gpxNameNode?.textContent?.trim() || "";

    const gpxDescNode = xml.querySelector("gpx > metadata > desc") || xml.querySelector("gpx > desc") || xml.querySelector("trk > desc") || xml.querySelector("rte > desc") || xml.querySelector("gpx > metadata > comment") || xml.querySelector("gpx > comment");
    const parsedGpxDesc = gpxDescNode?.textContent?.trim() || "";

    const rawPoints: GPXPoint[] = Array.from(trkpts).map((pt) => {
      const latAttr = pt.getAttribute("lat") || pt.getAttribute("latitude") || "0";
      const lngAttr = pt.getAttribute("lon") || pt.getAttribute("lng") || pt.getAttribute("longitude") || "0";
      const lat = parseFloat(latAttr);
      const lng = parseFloat(lngAttr);
      const eleNode = getChildNode(pt, "ele");
      const ele = eleNode ? parseFloat(eleNode.textContent || "0") : undefined;
      const timeStr = getChildNode(pt, "time")?.textContent;
      const time = timeStr ? new Date(timeStr) : undefined;
      
      // Extract power from extensions
      let power: number | undefined;
      const powerNode = getChildNode(pt, "power");
      if (powerNode) {
        power = parseFloat(powerNode.textContent || "0");
      }

      // Extract HR from extensions
      let hr: number | undefined;
      const hrNode = getChildNode(pt, "hr");
      if (hrNode) {
        hr = parseInt(hrNode.textContent || "0", 10);
      }

      // Extract Cadence from extensions
      let cadence: number | undefined;
      const cadNode = getChildNode(pt, "cad");
      if (cadNode) {
        cadence = parseInt(cadNode.textContent || "0", 10);
      }

      // Extract Surface from extensions or comment tags
      let surface: string | undefined;
      const surfaceNode = getChildNode(pt, "surface") || getChildNode(pt, "brouter:surface") || getChildNode(pt, "komoot:surface");
      if (surfaceNode && surfaceNode.textContent?.trim()) {
        surface = normalizeSurfaceName(surfaceNode.textContent);
      } else {
        const cmtNode = getChildNode(pt, "cmt") || getChildNode(pt, "comment");
        if (cmtNode && cmtNode.textContent) {
          const cmtText = cmtNode.textContent.toLowerCase();
          if (cmtText.includes("surface:") || cmtText.includes("untergrund:")) {
            const parts = cmtText.split(/surface:|untergrund:/i);
            if (parts[1]) {
              surface = normalizeSurfaceName(parts[1].trim());
            }
          }
        }
      }

      return { lat, lng, ele, time, power, hr, cadence, surface };
    });

    const points = sanitizeGPXPoints(rawPoints);

    // Validate elevation data existence and provide a meaningful default if missing
    interpolateMissingElevations(points);

    const hasTimestamps = points.some(p => p.time !== undefined);
    if (hasTimestamps && points.length > 0) {
      // Shift timestamps to start at current date/time for GPX tracks
      const now = new Date();
      const firstTimePt = points.find(p => p.time !== undefined);
      if (firstTimePt && firstTimePt.time) {
        const firstDate = toDate(firstTimePt.time);
        if (firstDate) {
          const offsetMs = now.getTime() - firstDate.getTime();
          points.forEach(p => {
            const pDate = toDate(p.time);
            if (pDate) {
              p.time = new Date(pDate.getTime() + offsetMs);
            }
          });
        }
      }
    } else if (points.length > 0) {
      let currentTimeMs = Date.now() - 3600 * 2000; // Start 2 hours ago
      points[0].time = new Date(currentTimeMs);
      for (let i = 1; i < points.length; i++) {
        const distKm = calculateDistance(points[i - 1], points[i]);
        const timeDeltaHours = distKm / 20.0; // 20 km/h baseline speed
        currentTimeMs += timeDeltaHours * 3600 * 1000;
        points[i].time = new Date(currentTimeMs);
      }
    }

    let activityName = parsedGpxName;
    if (!activityName || activityName === "0" || activityName.trim() === "") {
      const firstPoint = points.find(p => p.time !== undefined) || points[0];
      const startDate = firstPoint?.time || new Date();
      const dateStr = startDate.toLocaleDateString('de-DE', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      });
      const timeStr = startDate.toLocaleTimeString('de-DE', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      activityName = `${dateStr}, ${timeStr}`;
      if (firstPoint?.lat !== undefined && firstPoint?.lng !== undefined) {
        const location = await getLocationName(firstPoint.lat, firstPoint.lng);
        activityName += ` (${location})`;
      } else {
        activityName += ` - ${fileName.replace(/\.[^/.]+$/, "") || "Unbenannter Track"}`;
      }
    }

    const activityType = detectActivityType(points, activityName, fileName);
    const { ascent, descent, maxSlope, totalDist } = calculateElevationStats(points);
    const powerStats = calculatePowerStats(points, 250, 75, 15, activityType);
    
    const realSurfaceStats = calculateSurfaceStatsFromPoints(points);
    const surfaceStats = realSurfaceStats;
    hydratePointsWithSurface(points, surfaceStats, totalDist);

    const climbs = findClimbs(points);
    
    let duration: number | undefined;
    const trackHasTimestamps = points.some(p => p.time !== undefined);
    if (trackHasTimestamps && points.length > 1) {
      const firstTime = points.find(p => p.time !== undefined)?.time;
      const lastTime = [...points].reverse().find(p => p.time !== undefined)?.time;
      if (firstTime && lastTime) {
        const fDate = toDate(firstTime);
        const lDate = toDate(lastTime);
        if (fDate && lDate) {
          duration = (lDate.getTime() - fDate.getTime()) / 1000;
        }
      }
    }

    const color = HIGH_CONTRAST_COLORS[colorIndex % HIGH_CONTRAST_COLORS.length];
    colorIndex++;

    // Extrakt für GPX-Rohdaten
    const creator = xml.querySelector("gpx")?.getAttribute("creator") || undefined;
    const version = xml.querySelector("gpx")?.getAttribute("version") || undefined;
    const wpts = xml.querySelectorAll("gpx > wpt");
    const rawRecords: { type: string; data: Record<string, any> }[] = [];

    // Erfasse Waypoints als Rohdaten-Sätze
    wpts.forEach((wpt, i) => {
      if (i < 100) {
        rawRecords.push({
          type: 'waypoint',
          data: {
            name: wpt.querySelector("name")?.textContent || `Wegpunkt #${i+1}`,
            lat: wpt.getAttribute("lat"),
            lon: wpt.getAttribute("lon"),
            ele: wpt.querySelector("ele")?.textContent || undefined,
            desc: wpt.querySelector("desc")?.textContent || undefined,
            sym: wpt.querySelector("sym")?.textContent || undefined,
          }
        });
      }
    });

    // Erfasse Metadaten-Infos
    const boundsNode = xml.querySelector("gpx > metadata > bounds");
    if (boundsNode) {
      rawRecords.push({
        type: 'bounds',
        data: {
          minlat: boundsNode.getAttribute("minlat") || '',
          minlon: boundsNode.getAttribute("minlon") || '',
          maxlat: boundsNode.getAttribute("maxlat") || '',
          maxlon: boundsNode.getAttribute("maxlon") || ''
        }
      });
    }

    const metadataTime = xml.querySelector("gpx > metadata > time")?.textContent;
    if (metadataTime) {
      rawRecords.push({
        type: 'metadata_time',
        data: { timestamp: metadataTime }
      });
    }

    const trks = xml.querySelectorAll("gpx > trk");
    trks.forEach((trk, i) => {
      rawRecords.push({
        type: 'track_info',
        data: {
          index: i + 1,
          name: trk.querySelector("name")?.textContent || `Track #${i+1}`,
          desc: trk.querySelector("desc")?.textContent || '',
          pointsCount: trk.querySelectorAll("trkpt").length
        }
      });
    });

    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `track-${Date.now()}-${Math.random()}`,
      name: activityName,
      points,
      color,
      distance: totalDist,
      ascent,
      descent,
      maxSlope,
      visible: true,
      activityType,
      powerStats,
      surfaceStats,
      climbs,
      duration,
      hasTimestamps,
      description: parsedGpxDesc,
      rawFileDetails: {
        fileType: 'gpx',
        fileName,
        metadata: {
          creator,
          version,
          rawRecords
        }
      }
    };
  } catch (error) {
    console.error("Error parsing GPX:", error);
    return null;
  }
};

export const mergeTracks = (tracks: GPXTrack[]): GPXTrack => {
  const combinedPoints: GPXPoint[] = tracks.flatMap(t => t.points);
  const names = tracks.map(t => t.name).join(" → ");
  const { ascent, descent, maxSlope, totalDist } = calculateElevationStats(combinedPoints);
  const activityType = tracks[0]?.activityType || 'cycling';
  const powerStats = calculatePowerStats(combinedPoints, 250, 75, 15, activityType);
  
  const realSurfaceStats = calculateSurfaceStatsFromPoints(combinedPoints);
  const surfaceStats = realSurfaceStats;
  hydratePointsWithSurface(combinedPoints, surfaceStats, totalDist);

  const climbs = findClimbs(combinedPoints);
  
  return {
    id: crypto.randomUUID ? crypto.randomUUID() : `merged-${Date.now()}-${Math.random()}`,
    name: `Kombiniert: ${names.substring(0, 40)}${names.length > 40 ? '...' : ''}`,
    points: combinedPoints,
    color: "#ef4444",
    distance: totalDist,
    ascent,
    descent,
    maxSlope,
    visible: true,
    activityType,
    powerStats,
    surfaceStats,
    climbs
  };
};

/**
 * Reverses the directional flow of a GPX track, recalculating ascent, descent, max slope,
 * power statistics, climbs, and maintaining forward chronological timestamps if present.
 */
export const reverseTrack = (
  track: GPXTrack, 
  ftp: number = 250, 
  userWeight: number = 75, 
  speed: number = 25
): GPXTrack => {
  if (!track || !track.points || track.points.length === 0) return track;

  // 1. Reverse the points array
  const reversedPoints = [...track.points].reverse().map(p => ({ ...p }));

  // 2. Re-sequence timestamps forward in time if original track had time data
  if (track.hasTimestamps && track.points.some(p => p.time !== undefined)) {
    const validTimes = track.points
      .map(p => p.time)
      .filter((t): t is Date => t instanceof Date && !isNaN(t.getTime()));
    
    if (validTimes.length > 0) {
      const startTime = validTimes[0].getTime();
      // Measure inter-point deltas from original points
      const deltas: number[] = [0];
      for (let i = 1; i < track.points.length; i++) {
        const t1 = track.points[i - 1].time?.getTime();
        const t2 = track.points[i].time?.getTime();
        if (t1 !== undefined && t2 !== undefined && t2 >= t1) {
          deltas.push(t2 - t1);
        } else {
          deltas.push(1000); // Default 1-second step
        }
      }
      
      const reversedDeltas = [...deltas].reverse();
      let currentMs = startTime;
      reversedPoints[0].time = new Date(currentMs);
      for (let i = 1; i < reversedPoints.length; i++) {
        currentMs += reversedDeltas[i - 1] || 1000;
        reversedPoints[i].time = new Date(currentMs);
      }
    }
  }

  // 3. Recalculate elevation statistics, power stats, and climbs
  const { ascent, descent, maxSlope, totalDist } = calculateElevationStats(reversedPoints);
  const powerStats = calculatePowerStats(reversedPoints, ftp, userWeight, speed, track.activityType);
  const climbs = findClimbs(reversedPoints);

  // 4. Update surface stats if available
  const realSurfaceStats = calculateSurfaceStatsFromPoints(reversedPoints);
  hydratePointsWithSurface(reversedPoints, realSurfaceStats, totalDist);

  const newName = track.name.includes('(Umgekehrt)') 
    ? track.name 
    : `${track.name} (Umgekehrt)`;

  return {
    ...track,
    name: newName,
    points: reversedPoints,
    distance: Number(totalDist.toFixed(2)),
    ascent,
    descent,
    maxSlope,
    powerStats,
    surfaceStats: realSurfaceStats,
    climbs
  };
};

export const exportToGPX = (track: GPXTrack): string => {
  const escapeXml = (unsafe: string): string => {
    return (unsafe || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&apos;');
  };

  let xml = `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="GPX Route Master" 
  xmlns="http://www.topografix.com/GPX/1/1"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/GpxExtensions/v3 http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd"
  xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"
  xmlns:gpxx="http://www.garmin.com/xmlschemas/GpxExtensions/v3">
  <metadata>
    <name>${escapeXml(track.name)}</name>
    <desc>${escapeXml(track.description || '')}</desc>
    ${track.rawFileDetails?.metadata?.creator ? `<creator>${escapeXml(String(track.rawFileDetails.metadata.creator))}</creator>` : '<creator>GPX Route Master</creator>'}
  </metadata>
  <trk>
    <name>${escapeXml(track.name)}</name>
    <desc>${escapeXml(track.description || '')}</desc>
    <type>${escapeXml(track.activityType || 'cycling')}</type>
    <extensions>
      <gpxx:TrackExtension>
        <gpxx:DisplayColor>${escapeXml(track.color || 'Cyan')}</gpxx:DisplayColor>
      </gpxx:TrackExtension>
    </extensions>
    <trkseg>`;

  track.points.forEach(p => {
    const lat = p.lat;
    const lon = p.lng;
    const eleStr = p.ele !== undefined && p.ele !== null && !isNaN(p.ele) ? `\n        <ele>${p.ele}</ele>` : '';
    
    let timeStr = '';
    if (p.time) {
      try {
        const d = p.time instanceof Date ? p.time : new Date(p.time);
        if (!isNaN(d.getTime())) {
          timeStr = `\n        <time>${d.toISOString()}</time>`;
        }
      } catch (e) {}
    }

    const powerStr = p.power !== undefined && p.power !== null && !isNaN(p.power) ? `\n        <power>${p.power}</power>` : '';
    
    let extensionStr = '';
    const hasHr = p.hr !== undefined && p.hr !== null && !isNaN(p.hr);
    const hasCad = p.cadence !== undefined && p.cadence !== null && !isNaN(p.cadence);
    const hasSurface = !!p.surface;
    
    if (hasHr || hasCad || hasSurface) {
      extensionStr = `\n        <extensions>`;
      if (hasSurface) {
        extensionStr += `\n          <surface>${escapeXml(p.surface!)}</surface>`;
      }
      if (hasHr || hasCad) {
        extensionStr += `\n          <gpxtpx:TrackPointExtension>`;
        if (hasHr) {
          extensionStr += `\n            <gpxtpx:hr>${p.hr}</gpxtpx:hr>`;
        }
        if (hasCad) {
          extensionStr += `\n            <gpxtpx:cad>${p.cadence}</gpxtpx:cad>`;
        }
        extensionStr += `\n          </gpxtpx:TrackPointExtension>`;
      }
      extensionStr += `\n        </extensions>`;
    }

    xml += `\n      <trkpt lat="${lat}" lon="${lon}">${eleStr}${timeStr}${powerStr}${extensionStr}\n      </trkpt>`;
  });

  xml += `\n    </trkseg>\n  </trk>\n</gpx>`;
  return xml;
};

export const parseGPXStream = async (blob: Blob, fileName: string): Promise<GPXTrack | null> => {
  try {
    const stream = blob.stream();
    const reader = stream.getReader();
    const decoder = new TextDecoder('utf-8');
    let buffer = '';

    const trkpts: GPXPoint[] = [];
    const rtepts: GPXPoint[] = [];
    const wpts: GPXPoint[] = [];
    let foundMeta = false;
    let creator: string | undefined;
    let version: string | undefined;
    let gpxName: string | undefined;
    let gpxDesc: string | undefined;

    while (true) {
      const { done, value } = await reader.read();
      if (value) {
        buffer += decoder.decode(value, { stream: true });
      }

      // Extract metadata on the first chunk(s)
      if (!foundMeta && buffer.length > 0) {
        const creatorMatch = buffer.match(/<gpx[^>]*creator="([^"]*)"/i);
        if (creatorMatch) creator = creatorMatch[1];
        const verMatch = buffer.match(/<gpx[^>]*version="([^"]*)"/i);
        if (verMatch) version = verMatch[1];

        const nameMatch = buffer.match(/<(?:metadata|trk|rte)>(?:[\s\S]*?)<name>([\s\S]*?)<\/name>/i);
        if (nameMatch) gpxName = nameMatch[1].trim();

        const descMatch = buffer.match(/<(?:metadata|trk|rte)>(?:[\s\S]*?)<desc>([\s\S]*?)<\/desc>/i);
        if (descMatch) gpxDesc = descMatch[1].trim();

        if (buffer.includes('<trkseg>') || buffer.includes('<trkpt') || buffer.includes('<rtept') || buffer.includes('<wpt') || buffer.length > 100000) {
          foundMeta = true;
        }
      }

      // Process complete trackpoints / routepoints / waypoints in the buffer
      while (true) {
        const trkptStart = buffer.search(/<(?:trkpt|rtept|wpt)/i);
        if (trkptStart === -1) {
          if (buffer.length > 200) {
            buffer = buffer.slice(-100);
          }
          break;
        }

        const tagMatch = buffer.slice(trkptStart).match(/^<(trkpt|rtept|wpt)/i);
        if (!tagMatch) {
          // partial tag at the end of buffer, wait for more data
          break;
        }
        const tagName = tagMatch[1];
        const endTag = `</${tagName}>`;
        const trkptEnd = buffer.indexOf(endTag, trkptStart);

        if (trkptEnd === -1) {
          if (buffer.length > 10 * 1024 * 1024) {
            buffer = ''; // safeguard
          }
          break;
        }

        const trkptXml = buffer.slice(trkptStart, trkptEnd + endTag.length);
        buffer = buffer.slice(trkptEnd + endTag.length);

        const latMatch = trkptXml.match(/lat="([^"]*)"/i);
        const lonMatch = trkptXml.match(/(?:lon|longitude)="([^"]*)"/i);
        if (latMatch && lonMatch) {
          const lat = parseFloat(latMatch[1]);
          const lng = parseFloat(lonMatch[1]);

          const eleMatch = trkptXml.match(/<ele(?:\s[^>]*)?>([^<]*)<\/ele>/i);
          const ele = eleMatch ? parseFloat(eleMatch[1]) : undefined;

          const timeMatch = trkptXml.match(/<time(?:\s[^>]*)?>([^<]*)<\/time>/i);
          const time = timeMatch ? new Date(timeMatch[1]) : undefined;

          const powerMatch = trkptXml.match(/<power(?:\s[^>]*)?>([^<]*)<\/power>/i);
          const power = powerMatch ? parseFloat(powerMatch[1]) : undefined;

          const hrMatch = trkptXml.match(/<(?:[a-zA-Z0-9]+:)?hr(?:\s[^>]*)?>([^<]*)<\/(?:[a-zA-Z0-9]+:)?hr>/i);
          const hr = hrMatch ? parseInt(hrMatch[1], 10) : undefined;

          const cadMatch = trkptXml.match(/<(?:[a-zA-Z0-9]+:)?cad(?:\s[^>]*)?>([^<]*)<\/(?:[a-zA-Z0-9]+:)?cad>/i);
          const cadence = cadMatch ? parseInt(cadMatch[1], 10) : undefined;

          const surfaceMatch = trkptXml.match(/<(?:[a-zA-Z0-9]+:)?surface(?:\s[^>]*)?>([^<]*)<\/(?:[a-zA-Z0-9]+:)?surface>/i) ||
                              trkptXml.match(/<cmt(?:\s[^>]*)?>.*?(?:surface|untergrund):\s*([^<;]+).*?<\/cmt>/i);
          const surface = surfaceMatch ? normalizeSurfaceName(surfaceMatch[1]) : undefined;

          const ptObj = { lat, lng, ele, time, power, hr, cadence, surface };
          const tagNameLower = tagName.toLowerCase();
          if (tagNameLower === 'trkpt') {
            trkpts.push(ptObj);
          } else if (tagNameLower === 'rtept') {
            rtepts.push(ptObj);
          } else {
            wpts.push(ptObj);
          }
        }
      }

      if (done) {
        break;
      }
    }

    const selectedPoints = trkpts.length > 0 ? trkpts : (rtepts.length > 0 ? rtepts : wpts);
    const sanitizedPoints = sanitizeGPXPoints(selectedPoints);

    if (sanitizedPoints.length === 0) {
      console.error("GPX parsing error: No valid points found");
      return null;
    }

    // Validate elevation data existence and provide a meaningful default if missing
    interpolateMissingElevations(sanitizedPoints);

    const hasTimestamps = sanitizedPoints.some(p => p.time !== undefined);
    if (hasTimestamps && sanitizedPoints.length > 0) {
      const now = new Date();
      const firstTimePt = sanitizedPoints.find(p => p.time !== undefined);
      if (firstTimePt && firstTimePt.time) {
        const firstDate = toDate(firstTimePt.time);
        if (firstDate) {
          const offsetMs = now.getTime() - firstDate.getTime();
          sanitizedPoints.forEach(p => {
            const pDate = toDate(p.time);
            if (pDate) {
              p.time = new Date(pDate.getTime() + offsetMs);
            }
          });
        }
      }
    } else if (sanitizedPoints.length > 0) {
      let currentTimeMs = Date.now() - 3600 * 2000;
      sanitizedPoints[0].time = new Date(currentTimeMs);
      for (let i = 1; i < sanitizedPoints.length; i++) {
        const distKm = calculateDistance(sanitizedPoints[i - 1], sanitizedPoints[i]);
        const timeDeltaHours = distKm / 20.0;
        currentTimeMs += timeDeltaHours * 3600 * 1000;
        sanitizedPoints[i].time = new Date(currentTimeMs);
      }
    }

    let activityName = gpxName;
    if (!activityName || activityName === "0" || activityName.trim() === "") {
      const firstPoint = sanitizedPoints.find(p => p.time !== undefined) || sanitizedPoints[0];
      const startDate = firstPoint?.time || new Date();
      const dateStr = startDate.toLocaleDateString('de-DE', { 
        year: 'numeric', 
        month: '2-digit', 
        day: '2-digit' 
      });
      const timeStr = startDate.toLocaleTimeString('de-DE', { 
        hour: '2-digit', 
        minute: '2-digit' 
      });
      
      activityName = `${dateStr}, ${timeStr}`;
      if (firstPoint?.lat !== undefined && firstPoint?.lng !== undefined) {
        const location = await getLocationName(firstPoint.lat, firstPoint.lng);
        activityName += ` (${location})`;
      } else {
        activityName += ` - ${fileName.replace(/\.[^/.]+$/, "") || "Unbenannter Track"}`;
      }
    }

    const activityType = detectActivityType(sanitizedPoints, activityName, fileName);
    const { ascent, descent, maxSlope, totalDist } = calculateElevationStats(sanitizedPoints);
    const powerStats = calculatePowerStats(sanitizedPoints, 250, 75, 15, activityType);
    
    const realSurfaceStats = calculateSurfaceStatsFromPoints(sanitizedPoints);
    const surfaceStats = realSurfaceStats;
    hydratePointsWithSurface(sanitizedPoints, surfaceStats, totalDist);

    const climbs = findClimbs(sanitizedPoints);
    
    let duration: number | undefined;
    if (hasTimestamps && sanitizedPoints.length > 1) {
      const firstTime = sanitizedPoints.find(p => p.time !== undefined)?.time;
      const lastTime = [...sanitizedPoints].reverse().find(p => p.time !== undefined)?.time;
      if (firstTime && lastTime) {
        const fDate = toDate(firstTime);
        const lDate = toDate(lastTime);
        if (fDate && lDate) {
          duration = (lDate.getTime() - fDate.getTime()) / 1000;
        }
      }
    }

    const color = HIGH_CONTRAST_COLORS[colorIndex % HIGH_CONTRAST_COLORS.length];
    colorIndex++;

    const rawRecords: { type: string; data: Record<string, any> }[] = [];
    if (activityName) {
      rawRecords.push({
        type: 'track_info',
        data: {
          name: activityName,
          pointsCount: sanitizedPoints.length
        }
      });
    }

    // Add waypoints to rawRecords for completeness
    wpts.forEach((wpt, i) => {
      if (i < 100) {
        rawRecords.push({
          type: 'waypoint',
          data: {
            name: `Wegpunkt #${i+1}`,
            lat: wpt.lat.toString(),
            lon: wpt.lng.toString(),
            ele: wpt.ele !== undefined ? wpt.ele.toString() : undefined,
          }
        });
      }
    });

    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `track-${Date.now()}-${Math.random()}`,
      name: activityName,
      points: sanitizedPoints,
      color,
      distance: totalDist,
      ascent,
      descent,
      maxSlope,
      visible: true,
      activityType,
      powerStats,
      surfaceStats,
      climbs,
      duration,
      hasTimestamps,
      description: gpxDesc || '',
      rawFileDetails: {
        fileType: 'gpx',
        fileName,
        metadata: {
          creator,
          version,
          rawRecords
        }
      }
    };
  } catch (error) {
    console.error("Error parsing GPX stream:", error);
    return null;
  }
};

/**
 * Parses a location string and returns lat/lng coordinates if a match is found.
 */
export const parseLocationCoords = (locationStr?: string): { lat: number; lng: number } | null => {
  if (!locationStr) return null;
  
  // Try to match coordinates like "48.1351, 11.5820" or "48.1351;11.5820"
  const coordRegex = /(-?\d+\.\d+)\s*[,;]\s*(-?\d+\.\d+)/;
  const match = locationStr.match(coordRegex);
  if (match) {
    const lat = parseFloat(match[1]);
    const lng = parseFloat(match[2]);
    if (!isNaN(lat) && !isNaN(lng)) {
      return { lat, lng };
    }
  }
  
  // City mapping
  const city = locationStr.toLowerCase();
  const cities: Record<string, { lat: number; lng: number }> = {
    'münchen': { lat: 48.1351, lng: 11.5820 },
    'munich': { lat: 48.1351, lng: 11.5820 },
    'berlin': { lat: 52.5200, lng: 13.4050 },
    'frankfurt': { lat: 50.1109, lng: 8.6821 },
    'hamburg': { lat: 53.5511, lng: 9.9937 },
    'stuttgart': { lat: 48.7758, lng: 9.1829 },
    'köln': { lat: 50.9375, lng: 6.9603 },
    'cologne': { lat: 50.9375, lng: 6.9603 },
    'düsseldorf': { lat: 51.2271, lng: 6.7735 },
    'dresden': { lat: 51.0504, lng: 13.7373 },
    'leipzig': { lat: 51.3397, lng: 12.3731 },
    'nürnberg': { lat: 49.4521, lng: 11.0767 },
    'wien': { lat: 48.2082, lng: 16.3738 },
    'vienna': { lat: 48.2082, lng: 16.3738 },
    'zürich': { lat: 47.3769, lng: 8.5417 },
    'zurich': { lat: 47.3769, lng: 8.5417 },
    'mainz': { lat: 49.9929, lng: 8.2473 },
    'freiburg': { lat: 47.9990, lng: 7.8421 },
    'london': { lat: 51.5074, lng: -0.1278 },
    'paris': { lat: 48.8566, lng: 2.3522 },
  };
  
  for (const [name, coords] of Object.entries(cities)) {
    if (city.includes(name)) {
      return coords;
    }
  }
  
  return null;
};

/**
 * Generates a virtual track route in the form of a loop starting at the specified coordinates.
 */
export const generateVirtualRoute = (
  startLat: number, 
  startLng: number, 
  distanceKm: number, 
  durationSec: number, 
  ascentM: number, 
  descentM: number, 
  avgHr?: number,
  activityType?: string
): GPXPoint[] => {
  const pointsCount = 100;
  const points: GPXPoint[] = [];
  
  // Calculate radius for a circular path. Circumference = distanceKm
  const circumference = distanceKm || 1; // avoid 0
  const radiusKm = circumference / (2 * Math.PI);
  
  // Convert radius in Km to degrees latitude and longitude approx
  const rLat = radiusKm / 111;
  const rLng = radiusKm / (111 * Math.cos(startLat * Math.PI / 180));
  
  const startTime = new Date();
  
  for (let i = 0; i < pointsCount; i++) {
    const angle = (i / (pointsCount - 1)) * 2 * Math.PI;
    
    // Create a beautiful loop shape (tear-drop / bean shape)
    const lat = startLat + rLat * Math.sin(angle);
    const lng = startLng + rLng * (1 - Math.cos(angle)) * 0.5;
    
    // Elevation: distribute ascent and descent smoothly in a sinusoidal pattern
    let ele = 100;
    const elevationPhase = Math.sin((i / (pointsCount - 1)) * Math.PI);
    ele += elevationPhase * (ascentM || 0);
    
    // Heart Rate: average heart rate with some small realistic noise
    let hr = avgHr;
    if (hr) {
      const hrNoise = Math.sin(angle * 3) * 5 + (Math.random() - 0.5) * 3;
      hr = Math.round(hr + hrNoise);
    }
    
    // Cadence
    let cadence = activityType === 'running' ? 165 : 85;
    cadence += Math.round((Math.random() - 0.5) * 6);
    
    // Power (if cycling or running power)
    let power: number | undefined = undefined;
    if (activityType !== 'running') {
      power = 180 + Math.round(Math.sin(angle * 2) * 40 + (Math.random() - 0.5) * 15);
      if (power < 0) power = 0;
    }
    
    // Time
    const timeOffsetSec = (i / (pointsCount - 1)) * durationSec;
    const time = new Date(startTime.getTime() + timeOffsetSec * 1000);
    
    points.push({
      lat,
      lng,
      ele: parseFloat(ele.toFixed(1)),
      time,
      hr,
      cadence,
      power
    });
  }
  
  return points;
};

export interface DuplicateCheckResult {
  isDuplicate: boolean;
  confidence: number; // 0 to 100
  similarityPercentage: number; // 0 to 100
  matchedTrackName?: string;
  matchedTrackId?: string;
  reason?: string;
  matchType?: 'exact_coords' | 'pattern_overlap' | 'timestamp_and_start' | 'name_and_distance';
}

/**
 * Checks if a track (candidate) is a duplicate of any existing track by comparing
 * exact GPS coordinates, spatial path patterns, timestamps, start/end locations, and distance.
 */
export const checkTrackDuplicateGPS = (
  candidate: GPXTrack,
  existingTracks: GPXTrack[]
): DuplicateCheckResult => {
  if (!existingTracks || existingTracks.length === 0 || !candidate) {
    return { isDuplicate: false, confidence: 0, similarityPercentage: 0 };
  }

  const candPts = candidate.points || [];
  const candNameLower = candidate.name ? candidate.name.toLowerCase().trim() : '';

  if (candPts.length === 0) {
    const nameMatch = existingTracks.find(t => 
      t.id !== candidate.id &&
      t.name.toLowerCase().trim() === candNameLower &&
      Math.abs(t.distance - candidate.distance) < 0.05
    );
    if (nameMatch) {
      return {
        isDuplicate: true,
        confidence: 90,
        similarityPercentage: 100,
        matchedTrackName: nameMatch.name,
        matchedTrackId: nameMatch.id,
        reason: `Exakter Name "${nameMatch.name}" und identische Distanz (${nameMatch.distance.toFixed(2)} km)`,
        matchType: 'name_and_distance'
      };
    }
    return { isDuplicate: false, confidence: 0, similarityPercentage: 0 };
  }

  let bestMatch: DuplicateCheckResult = { isDuplicate: false, confidence: 0, similarityPercentage: 0 };

  const candStart = candPts[0];
  const candEnd = candPts[candPts.length - 1];

  for (const existing of existingTracks) {
    if (candidate.id && existing.id && candidate.id === existing.id) {
      return {
        isDuplicate: true,
        confidence: 100,
        similarityPercentage: 100,
        matchedTrackName: existing.name,
        matchedTrackId: existing.id,
        reason: `Identische ID (${existing.id}) bereits im Workspace geladen`,
        matchType: 'exact_coords'
      };
    }

    const exPts = existing.points || [];
    if (exPts.length === 0) continue;

    const exNameLower = existing.name ? existing.name.toLowerCase().trim() : '';

    // 1. Distance difference check
    const distDiffKm = Math.abs(candidate.distance - existing.distance);
    const maxDist = Math.max(0.1, candidate.distance, existing.distance);
    const distDiffRatio = distDiffKm / maxDist;

    // Fast skip: if total distances differ by more than 25% AND more than 2.5 km, skip heavy spatial check
    if (distDiffRatio > 0.25 && distDiffKm > 2.5) {
      continue;
    }

    // 2. Start & End Proximity (in meters)
    const exStart = exPts[0];
    const exEnd = exPts[exPts.length - 1];

    const startDistM = calculateDistance(candStart, exStart) * 1000;
    const endDistM = calculateDistance(candEnd, exEnd) * 1000;

    // Reverse direction check
    const startEndDistM = calculateDistance(candStart, exEnd) * 1000;
    const endStartDistM = calculateDistance(candEnd, exStart) * 1000;
    const isReversed = (startEndDistM < 50 && endStartDistM < 50) && (startDistM > 200 || endDistM > 200);

    const effStartDistM = isReversed ? startEndDistM : startDistM;
    const effEndDistM = isReversed ? endStartDistM : endDistM;

    // 3. Exact Point Count & Identical Start/End match
    const samePointCount = candPts.length === exPts.length;
    if (samePointCount && effStartDistM < 30 && effEndDistM < 30 && distDiffKm < 0.05) {
      // Check sampled points for exact coordinate match
      let exactMatches = 0;
      const sampleSize = Math.min(15, candPts.length);
      const step = Math.max(1, Math.floor(candPts.length / sampleSize));
      let evaluatedCount = 0;

      for (let i = 0; i < candPts.length; i += step) {
        evaluatedCount++;
        const targetIdx = isReversed ? (exPts.length - 1 - i) : i;
        if (targetIdx >= 0 && targetIdx < exPts.length) {
          const d = calculateDistance(candPts[i], exPts[targetIdx]) * 1000;
          if (d < 15) exactMatches++;
        }
      }

      if (evaluatedCount > 0 && (exactMatches / evaluatedCount) >= 0.8) {
        return {
          isDuplicate: true,
          confidence: 100,
          similarityPercentage: 100,
          matchedTrackName: existing.name,
          matchedTrackId: existing.id,
          reason: `Exakte GPS-Koordinaten und Punktanzahl (${candPts.length} Punkte)`,
          matchType: 'exact_coords'
        };
      }
    }

    // 4. Timestamp & Start Location check (if both recorded with timestamps)
    const candTime = candPts.find(p => p.time)?.time ? toDate(candPts.find(p => p.time)?.time) : undefined;
    const exTime = exPts.find(p => p.time)?.time ? toDate(exPts.find(p => p.time)?.time) : undefined;
    if (candTime && exTime) {
      const timeDiffSec = Math.abs((candTime.getTime() - exTime.getTime()) / 1000);
      if (timeDiffSec < 120 && effStartDistM < 100 && distDiffKm < 0.3) {
        return {
          isDuplicate: true,
          confidence: 99,
          similarityPercentage: 99,
          matchedTrackName: existing.name,
          matchedTrackId: existing.id,
          reason: `Gleicher Aufzeichnungszeitpunkt (${candTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}) und Startort`,
          matchType: 'timestamp_and_start'
        };
      }
    }

    // 5. GPS Coordinate Pattern & Spatial Overlap Analysis
    // Sample up to 35 equidistant points along candidate track
    const SAMPLE_COUNT = Math.min(35, candPts.length);
    const candStep = Math.max(1, Math.floor(candPts.length / SAMPLE_COUNT));
    
    let matchedSamplesCount = 0;
    let totalSampleDistM = 0;
    let sampledPointsEvaluated = 0;

    for (let i = 0; i < candPts.length; i += candStep) {
      const pCand = candPts[i];
      sampledPointsEvaluated++;

      // Fast windowed search around expected relative position
      const relPos = i / candPts.length;
      const targetCenterIdx = Math.floor((isReversed ? (1 - relPos) : relPos) * exPts.length);
      const windowSize = Math.max(60, Math.floor(exPts.length * 0.15));
      const startIdx = Math.max(0, targetCenterIdx - windowSize);
      const endIdx = Math.min(exPts.length - 1, targetCenterIdx + windowSize);

      let minDistM = Infinity;
      for (let j = startIdx; j <= endIdx; j++) {
        const d = calculateDistance(pCand, exPts[j]) * 1000;
        if (d < minDistM) {
          minDistM = d;
        }
      }

      // If local window didn't find a close point, check coarse global step
      if (minDistM > 80) {
        const globalStep = Math.max(1, Math.floor(exPts.length / 40));
        for (let j = 0; j < exPts.length; j += globalStep) {
          const d = calculateDistance(pCand, exPts[j]) * 1000;
          if (d < minDistM) {
            minDistM = d;
          }
        }
      }

      if (minDistM <= 40) { // Point is within 40m of existing track
        matchedSamplesCount++;
      }
      totalSampleDistM += Math.min(minDistM, 800);
    }

    const overlapRatio = sampledPointsEvaluated > 0 ? (matchedSamplesCount / sampledPointsEvaluated) : 0;
    const avgSampleDistM = sampledPointsEvaluated > 0 ? (totalSampleDistM / sampledPointsEvaluated) : Infinity;
    const similarityPct = Math.round(overlapRatio * 100);

    const isHighGPSMatch = (overlapRatio >= 0.80 && avgSampleDistM < 35 && (distDiffRatio < 0.15 || distDiffKm < 0.5)) ||
                           (overlapRatio >= 0.90 && avgSampleDistM < 50);

    const sameName = candNameLower.length > 0 && candNameLower === exNameLower;

    if (isHighGPSMatch || (sameName && overlapRatio >= 0.55 && distDiffKm < 0.3)) {
      const confidence = isHighGPSMatch ? Math.min(99, Math.round(similarityPct + Math.max(0, 20 - avgSampleDistM))) : 88;

      if (confidence > bestMatch.confidence) {
        bestMatch = {
          isDuplicate: true,
          confidence,
          similarityPercentage: similarityPct,
          matchedTrackName: existing.name,
          matchedTrackId: existing.id,
          reason: `${similarityPct}% GPS-Musterübereinstimmung mit "${existing.name}" (Ø Abweichung: ${Math.round(avgSampleDistM)}m)`,
          matchType: 'pattern_overlap'
        };
      }
    }
  }

  return bestMatch;
};

/**
 * Detects time gaps larger than minSeconds (default 30s) within a GPXTrack's points.
 */
export const detectTimeGaps = (track: GPXTrack, minSeconds: number = 30): TimeGap[] => {
  if (!track || !track.points || track.points.length < 2) return [];

  const gaps: TimeGap[] = [];
  let cumDistKm = 0;

  for (let i = 0; i < track.points.length - 1; i++) {
    const p1 = track.points[i];
    const p2 = track.points[i + 1];

    if (i > 0) {
      cumDistKm += calculateDistance(track.points[i - 1], p1);
    }

    if (!p1.time || !p2.time) continue;

    const t1 = toDate(p1.time);
    const t2 = toDate(p2.time);

    if (!t1 || !t2) continue;

    const diffSec = (t2.getTime() - t1.getTime()) / 1000;

    if (diffSec >= minSeconds) {
      const distM = calculateDistance(p1, p2) * 1000;
      gaps.push({
        id: `${track.id}-gap-${i}`,
        trackId: track.id,
        trackName: track.name,
        startIndex: i,
        endIndex: i + 1,
        startTime: t1,
        endTime: t2,
        gapSeconds: Math.round(diffSec),
        distanceMeters: Math.round(distM),
        distanceFromStartKm: parseFloat(cumDistKm.toFixed(2)),
        startPoint: p1,
        endPoint: p2,
      });
    }
  }

  return gaps;
};

/**
 * Splits a track into two separate tracks at a given point index (gap.startIndex).
 */
export const splitTrackAtIndex = (
  track: GPXTrack,
  splitIndex: number,
  ftp: number = 250,
  userWeight: number = 75,
  estimatedSpeed: number = 20
): { track1: GPXTrack; track2: GPXTrack } | null => {
  if (!track || !track.points || splitIndex < 0 || splitIndex >= track.points.length - 1) {
    return null;
  }

  const points1 = track.points.slice(0, splitIndex + 1);
  const points2 = track.points.slice(splitIndex + 1);

  if (points1.length === 0 || points2.length === 0) return null;

  const buildSubTrack = (pts: GPXPoint[], partName: string, idSuffix: string): GPXTrack => {
    let dist = 0;
    for (let j = 0; j < pts.length - 1; j++) {
      dist += calculateDistance(pts[j], pts[j + 1]);
    }

    const eleStats = calculateElevationStats(pts);
    const surfaceStats = calculateSurfaceStatsFromPoints(pts);
    hydratePointsWithSurface(pts, surfaceStats, dist);

    let duration: number | undefined = undefined;
    const startTime = pts[0]?.time ? toDate(pts[0].time) : undefined;
    const endTime = pts[pts.length - 1]?.time ? toDate(pts[pts.length - 1].time) : undefined;
    if (startTime && endTime) {
      duration = Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 1000));
    }

    const powerStats = calculatePowerStats(pts, ftp, userWeight, estimatedSpeed, track.activityType);

    return {
      id: crypto.randomUUID ? crypto.randomUUID() : `${track.id}-${idSuffix}-${Date.now()}`,
      name: `${track.name} (${partName})`,
      points: pts,
      color: track.color,
      distance: parseFloat(dist.toFixed(2)),
      ascent: eleStats.ascent,
      descent: eleStats.descent,
      maxSlope: eleStats.maxSlope,
      duration,
      visible: true,
      activityType: track.activityType,
      powerStats,
      surfaceStats,
      hasTimestamps: pts.some(p => p.time !== undefined)
    };
  };

  const track1 = buildSubTrack(points1, "Teil 1", "part1");
  const track2 = buildSubTrack(points2, "Teil 2", "part2");

  return { track1, track2 };
};

/**
 * Adjusts timestamps in a track to close or reduce a time gap without splitting the track.
 */
export const closeTimeGapInTrack = (
  track: GPXTrack,
  gap: TimeGap,
  targetPauseSeconds: number = 0,
  ftp: number = 250,
  userWeight: number = 75,
  estimatedSpeed: number = 20
): GPXTrack => {
  if (!track || !track.points || gap.endIndex >= track.points.length) return track;

  const originalGapSec = gap.gapSeconds;
  const shiftSec = originalGapSec - targetPauseSeconds;

  if (shiftSec <= 0) return track;

  const shiftMs = shiftSec * 1000;
  const newPoints = track.points.map((p, idx) => {
    if (idx >= gap.endIndex && p.time) {
      const pDate = toDate(p.time);
      if (pDate) {
        return {
          ...p,
          time: new Date(pDate.getTime() - shiftMs)
        };
      }
    }
    return p;
  });

  const startTime = newPoints[0]?.time ? toDate(newPoints[0].time) : undefined;
  const endTime = newPoints[newPoints.length - 1]?.time ? toDate(newPoints[newPoints.length - 1].time) : undefined;
  const duration = (startTime && endTime) ? Math.max(0, Math.round((endTime.getTime() - startTime.getTime()) / 1000)) : track.duration;

  const powerStats = calculatePowerStats(newPoints, ftp, userWeight, estimatedSpeed, track.activityType);

  return {
    ...track,
    points: newPoints,
    duration,
    powerStats
  };
};

/**
 * Helper to format gap seconds into human readable German string
 */
export const formatGapDuration = (seconds: number): string => {
  if (seconds < 60) return `${seconds} Sek`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  if (m < 60) {
    return s > 0 ? `${m} Min ${s} Sek` : `${m} Min`;
  }
  const h = Math.floor(m / 60);
  const remM = m % 60;
  return remM > 0 ? `${h} Std ${remM} Min` : `${h} Std`;
};

/**
 * Perpendicular distance squared from point p to line segment (p1, p2) in lat/lng space.
 */
function getPerpendicularDistanceSq(p: GPXPoint, p1: GPXPoint, p2: GPXPoint): number {
  let x = p1.lng, y = p1.lat;
  let dx = p2.lng - x, dy = p2.lat - y;

  if (dx !== 0 || dy !== 0) {
    const t = ((p.lng - x) * dx + (p.lat - y) * dy) / (dx * dx + dy * dy);
    if (t > 1) {
      x = p2.lng;
      y = p2.lat;
    } else if (t > 0) {
      x += dx * t;
      y += dy * t;
    }
  }

  dx = p.lng - x;
  dy = p.lat - y;
  return dx * dx + dy * dy;
}

/**
 * Simplifies a sequence of GPXTrack points using the Ramer-Douglas-Peucker (RDP) algorithm.
 * Reduces point counts by up to 90% while maintaining visual fidelity for 60 FPS Leaflet rendering.
 */
export const simplifyTrackPoints = (points: GPXPoint[], toleranceSq: number = 0.0000002): GPXPoint[] => {
  if (!points || points.length <= 2) return points || [];

  const last = points.length - 1;
  const simplified: GPXPoint[] = [points[0]];

  function simplifySection(start: number, end: number) {
    if (end <= start + 1) return;

    let maxDistSq = toleranceSq;
    let index = -1;

    for (let i = start + 1; i < end; i++) {
      const distSq = getPerpendicularDistanceSq(points[i], points[start], points[end]);
      if (distSq > maxDistSq) {
        maxDistSq = distSq;
        index = i;
      }
    }

    if (index !== -1) {
      simplifySection(start, index);
      simplified.push(points[index]);
      simplifySection(index, end);
    }
  }

  simplifySection(0, last);
  simplified.push(points[last]);

  return simplified;
};

// Internal cache for simplified track point coordinates
const simplifiedPointCache = new Map<string, { count: number; simplified: GPXPoint[] }>();

/**
 * Retrieves simplified track points using LRU/Map memoization cache.
 */
export const getCachedSimplifiedPoints = (trackId: string, points: GPXPoint[], targetMaxPoints: number = 1500): GPXPoint[] => {
  if (!points || points.length <= targetMaxPoints) return points || [];

  const cacheKey = `${trackId}-${points.length}`;
  const cached = simplifiedPointCache.get(cacheKey);
  if (cached && cached.count === points.length) {
    return cached.simplified;
  }

  // Calculate tolerance based on point count ratio
  const ratio = points.length / targetMaxPoints;
  const toleranceSq = Math.min(0.000005, 0.0000001 * ratio * ratio);

  const simplified = simplifyTrackPoints(points, toleranceSq);
  
  // Keep cache small
  if (simplifiedPointCache.size > 50) {
    const firstKey = simplifiedPointCache.keys().next().value;
    if (firstKey) simplifiedPointCache.delete(firstKey);
  }
  
  simplifiedPointCache.set(cacheKey, { count: points.length, simplified });
  return simplified;
};

/**
 * Performs a comprehensive validation pre-check on a track to identify coordinate errors,
 * extreme outliers, Null Island drops, missing elevations, and sensor spikes.
 */
export const analyzeTrackValidation = (track: GPXTrack): TrackValidationReport => {
  const points = track.points || [];
  const totalPoints = points.length;
  const issues: ValidationIssue[] = [];

  let outOfBoundsCount = 0;
  const outOfBoundsIndices: number[] = [];

  let nullIslandCount = 0;
  const nullIslandIndices: number[] = [];

  let missingEleCount = 0;
  const missingEleIndices: number[] = [];

  let eleSpikeCount = 0;
  const eleSpikeIndices: number[] = [];

  let extremeJumpCount = 0;
  const extremeJumpIndices: number[] = [];

  let minElevation: number | undefined = undefined;
  let maxElevation: number | undefined = undefined;
  let maxSpeedJumpKmh: number | null = null;

  for (let i = 0; i < totalPoints; i++) {
    const p = points[i];

    // 1. Check coordinates out of valid geographic ranges
    if (isNaN(p.lat) || isNaN(p.lng) || p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) {
      outOfBoundsCount++;
      outOfBoundsIndices.push(i);
    } else if (Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001) {
      // 2. Check "Null Island" (0,0) GPS dropoff
      nullIslandCount++;
      nullIslandIndices.push(i);
    }

    // 3. Check elevation
    if (p.ele === undefined || p.ele === null || isNaN(p.ele)) {
      missingEleCount++;
      missingEleIndices.push(i);
    } else {
      if (minElevation === undefined || p.ele < minElevation) minElevation = p.ele;
      if (maxElevation === undefined || p.ele > maxElevation) maxElevation = p.ele;

      // Impossible elevation limits (< -430m or > 8900m)
      if (p.ele < -430 || p.ele > 8900) {
        eleSpikeCount++;
        eleSpikeIndices.push(i);
      }
    }

    // 4. Consecutive jump checks
    if (i > 0) {
      const prev = points[i - 1];
      const isValidCoord = (pt: GPXPoint) => !isNaN(pt.lat) && !isNaN(pt.lng) && Math.abs(pt.lat) <= 90 && Math.abs(pt.lng) <= 180 && !(Math.abs(pt.lat) < 0.0001 && Math.abs(pt.lng) < 0.0001);
      
      if (isValidCoord(p) && isValidCoord(prev)) {
        const stepDistKm = calculateDistance(prev, p);
        
        // Jump > 25 km in a single step
        if (stepDistKm > 25) {
          extremeJumpCount++;
          extremeJumpIndices.push(i);
        }

        // Speed check if timestamps exist
        if (p.time && prev.time) {
          const t1 = toDate(prev.time);
          const t2 = toDate(p.time);
          if (t1 && t2) {
            const dtSec = (t2.getTime() - t1.getTime()) / 1000;
            if (dtSec > 0 && dtSec < 3600) {
              const speedKmh = stepDistKm / (dtSec / 3600);
              if (maxSpeedJumpKmh === null || speedKmh > maxSpeedJumpKmh) {
                maxSpeedJumpKmh = Math.round(speedKmh);
              }
              if (speedKmh > 300 && stepDistKm > 2) {
                if (!extremeJumpIndices.includes(i)) {
                  extremeJumpCount++;
                  extremeJumpIndices.push(i);
                }
              }
            }
          }
        }

        // Sudden extreme vertical cliff (> 300m height difference in < 50m distance)
        if (p.ele !== undefined && prev.ele !== undefined && !isNaN(p.ele) && !isNaN(prev.ele)) {
          const eleDiff = Math.abs(p.ele - prev.ele);
          if (eleDiff > 300 && stepDistKm < 0.05) {
            if (!eleSpikeIndices.includes(i)) {
              eleSpikeCount++;
              eleSpikeIndices.push(i);
            }
          }
        }
      }
    }
  }

  // 5. Isolated outlier coordinate spike check (p[i] jumping away while p[i-1] and p[i+1] are close)
  for (let i = 1; i < totalPoints - 1; i++) {
    const prev = points[i - 1];
    const curr = points[i];
    const next = points[i + 1];
    
    if (!extremeJumpIndices.includes(i)) {
      const d1 = calculateDistance(prev, curr);
      const d2 = calculateDistance(curr, next);
      const dDirect = calculateDistance(prev, next);

      if (d1 > 15 && d2 > 15 && dDirect < 2) {
        extremeJumpCount++;
        extremeJumpIndices.push(i);
      }
    }
  }

  // Construct structured issues
  if (outOfBoundsCount > 0) {
    issues.push({
      id: 'issue-coord-oob',
      type: 'coord_out_of_bounds',
      severity: 'error',
      title: 'Geografisch ungültige Koordinaten',
      description: `${outOfBoundsCount} Punkt(e) liegen außerhalb der gültigen Erdkoordinaten (-90°..+90° Lat, -180°..+180° Lng).`,
      affectedCount: outOfBoundsCount,
      affectedIndices: outOfBoundsIndices,
      autoFixable: true,
      fixDescription: 'Ungültige Punkte werden automatisch aus dem Streckenverlauf entfernt.'
    });
  }

  if (nullIslandCount > 0) {
    issues.push({
      id: 'issue-null-island',
      type: 'null_island',
      severity: 'warning',
      title: 'GPS-Abbruch / Null-Island (0.0°, 0.0°)',
      description: `${nullIslandCount} Punkt(e) weisen Koordinaten am Äquator/Nullmeridian auf (typischer GPS-Fix-Verlust).`,
      affectedCount: nullIslandCount,
      affectedIndices: nullIslandIndices,
      autoFixable: true,
      fixDescription: 'Null-Island-Ausreißer werden restlos herausgefiltert.'
    });
  }

  if (extremeJumpCount > 0) {
    issues.push({
      id: 'issue-extreme-jumps',
      type: 'coord_extreme_jump',
      severity: 'warning',
      title: 'Extreme GPS-Distanzsprünge / Ausreißer',
      description: `${extremeJumpCount} Punkt(e) weisen extreme Koordinatensprünge (> 25 km oder > 300 km/h) auf.`,
      affectedCount: extremeJumpCount,
      affectedIndices: extremeJumpIndices,
      autoFixable: true,
      fixDescription: 'Teleportations-Ausreißer werden isoliert und bereinigt.'
    });
  }

  if (missingEleCount === totalPoints && totalPoints > 0) {
    issues.push({
      id: 'issue-missing-ele-all',
      type: 'missing_elevation',
      severity: 'warning',
      title: 'Vollständig fehlende Höhendaten',
      description: `Alle ${totalPoints} Punkte besitzen keine Höhenangaben (ele).`,
      affectedCount: missingEleCount,
      affectedIndices: missingEleIndices,
      autoFixable: true,
      fixDescription: 'Wird mit einer flachen Baseline (0m) initialisiert oder über Höhenmodelle geglättet.'
    });
  } else if (missingEleCount > 0) {
    const percent = Math.round((missingEleCount / totalPoints) * 100);
    issues.push({
      id: 'issue-missing-ele-partial',
      type: 'missing_elevation',
      severity: percent > 20 ? 'warning' : 'info',
      title: 'Lückenhafte Höhendaten',
      description: `${missingEleCount} von ${totalPoints} Punkten (${percent}%) haben keine Höhendaten.`,
      affectedCount: missingEleCount,
      affectedIndices: missingEleIndices,
      autoFixable: true,
      fixDescription: 'Fehlende Höhenwerte werden nahtlos linear zwischen benachbarten Höhenpunkten interpoliert.'
    });
  }

  if (eleSpikeCount > 0) {
    issues.push({
      id: 'issue-ele-spikes',
      type: 'elevation_spike',
      severity: 'warning',
      title: 'Unrealistische Höhenausreißer / Sensor-Spitzen',
      description: `${eleSpikeCount} Punkt(e) weisen physikalisch unplausible Höhen (< -430m, > 8900m) oder vertikale Klippen auf.`,
      affectedCount: eleSpikeCount,
      affectedIndices: eleSpikeIndices,
      autoFixable: true,
      fixDescription: 'Unrealistische Höhenspitzen werden geglättet und durch realistische Näherungswerte ersetzt.'
    });
  }

  let overallStatus: 'clean' | 'info' | 'warning' | 'error' = 'clean';
  if (issues.some(i => i.severity === 'error')) {
    overallStatus = 'error';
  } else if (issues.some(i => i.severity === 'warning')) {
    overallStatus = 'warning';
  } else if (issues.length > 0) {
    overallStatus = 'info';
  }

  return {
    trackId: track.id,
    trackName: track.name,
    status: overallStatus,
    issues,
    stats: {
      totalPoints,
      pointsWithElevation: totalPoints - missingEleCount,
      missingElevationCount: missingEleCount,
      outlierCoordinateCount: outOfBoundsCount + nullIslandCount + extremeJumpCount,
      nullIslandCount,
      extremeJumpCount,
      elevationSpikeCount: eleSpikeCount,
      minElevation,
      maxElevation,
      maxSpeedJumpKmh
    }
  };
};

/**
 * Automatically repairs detected validation anomalies: removes out-of-bounds and null island points,
 * filters isolated teleportation outliers, interpolates missing elevation values, and recalculates track statistics.
 */
export const autoFixTrackValidation = (
  track: GPXTrack,
  ftp: number = 250,
  userWeight: number = 75,
  estimatedSpeed: number = 25
): GPXTrack => {
  if (!track.points || track.points.length === 0) return track;

  // 1. Filter out invalid coords and Null Island
  const isValidCoord = (p: GPXPoint) => {
    if (isNaN(p.lat) || isNaN(p.lng)) return false;
    if (p.lat < -90 || p.lat > 90 || p.lng < -180 || p.lng > 180) return false;
    if (Math.abs(p.lat) < 0.0001 && Math.abs(p.lng) < 0.0001) return false;
    return true;
  };

  let validPoints: GPXPoint[] = track.points.filter(isValidCoord).map(p => ({ ...p }));

  if (validPoints.length === 0) {
    // If all were invalid, fallback to original to prevent empty track
    validPoints = track.points.map(p => ({ ...p }));
  }

  // 2. Remove isolated outlier coordinate spikes
  if (validPoints.length > 3) {
    const filteredPoints: GPXPoint[] = [];
    filteredPoints.push(validPoints[0]);

    for (let i = 1; i < validPoints.length - 1; i++) {
      const prev = filteredPoints[filteredPoints.length - 1];
      const curr = validPoints[i];
      const next = validPoints[i + 1];

      const d1 = calculateDistance(prev, curr);
      const d2 = calculateDistance(curr, next);
      const dDirect = calculateDistance(prev, next);

      // If current point jumps far away while neighbors are close, skip it
      if (d1 > 15 && d2 > 15 && dDirect < 3) {
        continue; // skip outlier
      }
      filteredPoints.push(curr);
    }
    filteredPoints.push(validPoints[validPoints.length - 1]);
    validPoints = filteredPoints;
  }

  // 3. Clean and clamp extreme elevation spikes (< -430 or > 8900)
  for (const p of validPoints) {
    if (p.ele !== undefined && p.ele !== null) {
      if (p.ele < -430 || p.ele > 8900) {
        p.ele = undefined;
      }
    }
  }

  // 4. Linearly interpolate missing elevations
  interpolateMissingElevations(validPoints);

  // 5. Recalculate track distance, ascent, descent, maxSlope
  let distance = 0;
  let ascent = 0;
  let descent = 0;
  let maxSlope = 0;

  for (let i = 1; i < validPoints.length; i++) {
    const prev = validPoints[i - 1];
    const curr = validPoints[i];
    const d = calculateDistance(prev, curr);
    distance += d;

    if (curr.ele !== undefined && prev.ele !== undefined) {
      const eleDiff = curr.ele - prev.ele;
      if (eleDiff > 0) {
        ascent += eleDiff;
      } else {
        descent += Math.abs(eleDiff);
      }

      if (d > 0.01) {
        const slope = Math.abs((eleDiff / (d * 1000)) * 100);
        if (slope > maxSlope && slope < 40) {
          maxSlope = slope;
        }
      }
    }
  }

  // Calculate climbs and power stats
  const climbs = findClimbs(validPoints);
  const powerStats = calculatePowerStats(validPoints, ftp, userWeight, estimatedSpeed);

  const cleanName = track.name.includes('(Bereinigt)') ? track.name : `${track.name} (Bereinigt)`;

  return {
    ...track,
    name: cleanName,
    points: validPoints,
    distance: Number(distance.toFixed(2)),
    ascent: Math.round(ascent),
    descent: Math.round(descent),
    maxSlope: Number(maxSlope.toFixed(1)),
    climbs,
    powerStats
  };
};



