
import { GPXPoint, GPXTrack, PowerStats, ClimbSegment } from '../types';

export const findClimbs = (points: GPXPoint[]): ClimbSegment[] => {
  if (points.length < 5) return [];
  
  const minClimbDistance = 150; // meters (highly inclusive minimum length)
  const minAvgGradient = 1.5; // percent (very mild, ensures rolling hills and gentle climbs are detected)
  
  // Calculate cumulative distance and filled elevation
  const cumDist = new Float64Array(points.length);
  const filledEle = new Float64Array(points.length);
  let lastEle = points.find(p => p.ele !== undefined)?.ele || 0;
  
  for (let i = 0; i < points.length; i++) {
    if (points[i].ele !== undefined) lastEle = points[i].ele!;
    filledEle[i] = lastEle;
    if (i > 0) {
      cumDist[i] = cumDist[i - 1] + calculateDistance(points[i - 1], points[i]) * 1000;
    } else {
      cumDist[0] = 0;
    }
  }

  // Smooth elevation data first to eliminate GPS micro-jitter (using a 30m rolling window)
  const smoothedEle = new Float64Array(points.length);
  const SMOOTH_WINDOW_M = 30;
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
    // Look for a point at least 150m ahead
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
        
        if (finalDist >= minClimbDistance && finalAvgGrad >= minAvgGradient) {
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
        if (points[j].ele !== undefined) {
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

        if (p.time && pPrev.time) {
          const dt = (p.time.getTime() - pPrev.time.getTime()) / 1000;
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
      if (points[j].ele !== undefined) {
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

      if (p.time && pPrev.time) {
        const dt = (p.time.getTime() - pPrev.time.getTime()) / 1000;
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
    if (p1.power !== undefined && p2.power !== undefined && p1.time && p2.time) {
      const dt = (p2.time.getTime() - p1.time.getTime()) / 1000;
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

  const startTime = timedPoints[0].time!.getTime();
  const endTime = timedPoints[timedPoints.length - 1].time!.getTime();
  const durationSec = Math.floor((endTime - startTime) / 1000);
  
  if (durationSec < 5) return { avgPower, maxPower, best20s: avgPower, best1m: avgPower, best20m: avgPower, work };

  const power1s = new Float32Array(durationSec + 1);
  let pIdx = 0;
  for (let t = 0; t <= durationSec; t++) {
    const targetTime = startTime + t * 1000;
    while (pIdx < timedPoints.length - 1 && timedPoints[pIdx + 1].time!.getTime() < targetTime) {
      pIdx++;
    }
    const p1 = timedPoints[pIdx];
    const p2 = timedPoints[pIdx + 1];
    if (p2) {
      const t1 = p1.time!.getTime();
      const t2 = p2.time!.getTime();
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

  // Pre-fill missing elevation data
  const filledEle = new Float64Array(points.length);
  let lastValidEle = points.find(p => p.ele !== undefined)?.ele || 0;
  for (let i = 0; i < points.length; i++) {
    if (points[i].ele !== undefined) {
      lastValidEle = points[i].ele!;
    }
    filledEle[i] = lastValidEle;
  }

  // 1. Smooth elevation data (distance-based, 20m window)
  const smoothedEle = new Float64Array(points.length);
  const SMOOTH_WINDOW_KM = 0.020; 
  
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

  // 2. Calculate ascent/descent
  for (let i = 1; i < points.length; i++) {
    const e1 = smoothedEle[i - 1];
    const e2 = smoothedEle[i];
    if (!isNaN(e1) && !isNaN(e2)) {
      const diff = e2 - e1;
      if (diff > 0.05) ascent += diff;
      else if (diff < -0.05) descent += Math.abs(diff);
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

export const generateMockSurfaceStats = (totalDist: number) => {
  if (totalDist === 0) return [];
  
  const types = ['Asphalt', 'Fahrradweg', 'Schotter', 'Waldweg', 'Straße'];
  const segments = [];
  let remainingDist = totalDist;
  
  const numSegments = Math.floor(Math.random() * 3) + 2;
  
  for (let i = 0; i < numSegments - 1; i++) {
    const dist = remainingDist * (Math.random() * 0.4 + 0.1);
    segments.push({
      type: types[Math.floor(Math.random() * types.length)],
      distance: dist
    });
    remainingDist -= dist;
  }
  
  segments.push({
    type: types[Math.floor(Math.random() * types.length)],
    distance: remainingDist
  });
  
  const grouped = segments.reduce((acc, curr) => {
    acc[curr.type] = (acc[curr.type] || 0) + curr.distance;
    return acc;
  }, {} as Record<string, number>);
  
  return Object.entries(grouped)
    .map(([type, distance]) => ({ type, distance: distance as number }))
    .sort((a, b) => b.distance - a.distance);
};

const HIGH_CONTRAST_COLORS = [
  '#FF00FF', // Magenta
  '#FF4500', // Orange Red
  '#FFD700', // Gold
  '#00FFFF', // Cyan
  '#FF1493', // Deep Pink
  '#8A2BE2', // Blue Violet
  '#FF0000', // Red
  '#00FF00', // Lime
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
    let node = parent.querySelector(tagName);
    if (node) return node;

    const allChildren = parent.getElementsByTagName("*");
    const targetLower = tagName.toLowerCase();
    for (let i = 0; i < allChildren.length; i++) {
      const child = allChildren[i];
      const localName = (child.localName || child.nodeName).toLowerCase();
      if (localName === targetLower) {
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
      const dt = (pCurr.time!.getTime() - pPrev.time!.getTime()) / 1000;
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
    
    const points: GPXPoint[] = Array.from(trkpts).map((pt) => {
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

      return { lat, lng, ele, time, power, hr, cadence };
    });

    const hasTimestamps = points.some(p => p.time !== undefined);
    if (hasTimestamps && points.length > 0) {
      // Shift timestamps to start at current date/time for GPX tracks
      const now = new Date();
      const firstTimePt = points.find(p => p.time !== undefined);
      if (firstTimePt && firstTimePt.time) {
        const offsetMs = now.getTime() - firstTimePt.time.getTime();
        points.forEach(p => {
          if (p.time) {
            p.time = new Date(p.time.getTime() + offsetMs);
          }
        });
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
    
    let activityName = `${dateStr}, ${timeStr}`;
    if (firstPoint?.lat !== undefined && firstPoint?.lng !== undefined) {
      const location = await getLocationName(firstPoint.lat, firstPoint.lng);
      activityName += ` (${location})`;
    } else {
      activityName += ` - ${fileName.replace(/\.[^/.]+$/, "") || "Unbenannter Track"}`;
    }

    const activityType = detectActivityType(points, activityName, fileName);
    const { ascent, descent, maxSlope, totalDist } = calculateElevationStats(points);
    const powerStats = calculatePowerStats(points, 250, 75, 15, activityType);
    const surfaceStats = generateMockSurfaceStats(totalDist);
    const climbs = findClimbs(points);
    
    let duration: number | undefined;
    const trackHasTimestamps = points.some(p => p.time !== undefined);
    if (trackHasTimestamps && points.length > 1) {
      const firstTime = points.find(p => p.time !== undefined)?.time;
      const lastTime = [...points].reverse().find(p => p.time !== undefined)?.time;
      if (firstTime && lastTime) {
        duration = (lastTime.getTime() - firstTime.getTime()) / 1000;
      }
    }

    const color = HIGH_CONTRAST_COLORS[colorIndex % HIGH_CONTRAST_COLORS.length];
    colorIndex++;

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
      hasTimestamps
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
  const surfaceStats = generateMockSurfaceStats(totalDist);
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
