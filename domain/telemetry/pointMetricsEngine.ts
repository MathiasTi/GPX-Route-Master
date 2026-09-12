import { Result, ok, err } from '../core/result';

export interface HeartRateZoneInfo {
  readonly zoneNumber: number; // 1 to 5
  readonly name: string;        // 'Erholung', 'GA1', 'GA2', 'Schwelle', 'VO2max'
  readonly label: string;       // 'Z1', 'Z2', 'Z3', 'Z4', 'Z5'
  readonly colorHex: string;    // e.g. '#3b82f6'
  readonly minBpm: number;
  readonly maxBpm: number;
  readonly bpm: number;
  readonly percentOfMax: number;
}

export type SlopeSeverity = 'extreme' | 'steep' | 'moderate' | 'flat' | 'descent' | 'steep_descent';

export interface SlopeMetrics {
  readonly slopePercent: number;
  readonly formatted: string;
  readonly severity: SlopeSeverity;
  readonly label: string;
  readonly colorHex: string;
  readonly arrow: string;
}

export interface HoverPointCoordinate {
  readonly lat: number;
  readonly lng: number;
  readonly ele?: number;
  readonly time?: string | Date;
  readonly hr?: number;
  readonly power?: number;
  readonly speed?: number;
  readonly cadence?: number;
  readonly slope?: number;
  readonly dist?: number;
}

export interface HoverPointTelemetry {
  readonly lat: number;
  readonly lng: number;
  readonly elevationM: number | null;
  readonly slope: SlopeMetrics;
  readonly heartRate: HeartRateZoneInfo | null;
  readonly powerWatts: number | null;
  readonly speedKmh: number | null;
  readonly timeFormatted: string | null;
  readonly distanceKm: number | null;
  readonly durationEstimate: string | null;
}

/**
 * Pure Haversine distance calculation in kilometers.
 */
export function calculatePointDistanceKm(
  p1: { lat: number; lng: number },
  p2: { lat: number; lng: number }
): number {
  const earthRadiusKm = 6371;
  const dLat = (p2.lat - p1.lat) * (Math.PI / 180);
  const dLng = (p2.lng - p1.lng) * (Math.PI / 180);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(p1.lat * (Math.PI / 180)) *
      Math.cos(p2.lat * (Math.PI / 180)) *
      Math.sin(dLng / 2) *
      Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusKm * c;
}

/**
 * Classifies an instantaneous heart rate value into 5 standard training zones.
 */
export function classifyHeartRate(bpm: number, maxHr: number = 185): Result<HeartRateZoneInfo, Error> {
  if (!Number.isFinite(bpm) || bpm <= 0 || bpm > 260) {
    return err(new Error(`Invalid heart rate value: ${bpm}`));
  }
  if (!Number.isFinite(maxHr) || maxHr < 100 || maxHr > 250) {
    return err(new Error(`Invalid maximum heart rate value: ${maxHr}`));
  }

  const roundedBpm = Math.round(bpm);
  const percentOfMax = Math.round((roundedBpm / maxHr) * 1000) / 10;

  if (percentOfMax >= 90) {
    return ok({
      zoneNumber: 5,
      name: 'VO2max / Maximal',
      label: 'Z5',
      colorHex: '#ef4444',
      minBpm: Math.round(maxHr * 0.90),
      maxBpm: Math.round(maxHr),
      bpm: roundedBpm,
      percentOfMax
    });
  }
  if (percentOfMax >= 80) {
    return ok({
      zoneNumber: 4,
      name: 'Schwelle / EB',
      label: 'Z4',
      colorHex: '#f97316',
      minBpm: Math.round(maxHr * 0.80),
      maxBpm: Math.round(maxHr * 0.90) - 1,
      bpm: roundedBpm,
      percentOfMax
    });
  }
  if (percentOfMax >= 70) {
    return ok({
      zoneNumber: 3,
      name: 'GA2 / Tempo',
      label: 'Z3',
      colorHex: '#f59e0b',
      minBpm: Math.round(maxHr * 0.70),
      maxBpm: Math.round(maxHr * 0.80) - 1,
      bpm: roundedBpm,
      percentOfMax
    });
  }
  if (percentOfMax >= 60) {
    return ok({
      zoneNumber: 2,
      name: 'GA1 / Ausdauer',
      label: 'Z2',
      colorHex: '#10b981',
      minBpm: Math.round(maxHr * 0.60),
      maxBpm: Math.round(maxHr * 0.70) - 1,
      bpm: roundedBpm,
      percentOfMax
    });
  }

  // Under 60% is categorized as Z1 (Regeneration & Warmup)
  return ok({
    zoneNumber: 1,
    name: 'Erholung / Warmup',
    label: 'Z1',
    colorHex: '#3b82f6',
    minBpm: Math.round(maxHr * 0.50),
    maxBpm: Math.round(maxHr * 0.60) - 1,
    bpm: roundedBpm,
    percentOfMax
  });
}

/**
 * Classifies a slope gradient percentage into severity tiers.
 */
export function classifySlope(gradientPercent: number): SlopeMetrics {
  const rounded = Math.round(gradientPercent * 10) / 10;
  const formatted = rounded > 0 ? `+${rounded.toFixed(1)}%` : `${rounded.toFixed(1)}%`;

  if (rounded >= 14) {
    return {
      slopePercent: rounded,
      formatted,
      severity: 'extreme',
      label: 'Extrem-Rampe',
      colorHex: '#a855f7',
      arrow: '▲▲'
    };
  }
  if (rounded >= 8) {
    return {
      slopePercent: rounded,
      formatted,
      severity: 'steep',
      label: 'Steilanstieg',
      colorHex: '#f43f5e',
      arrow: '▲'
    };
  }
  if (rounded >= 3.5) {
    return {
      slopePercent: rounded,
      formatted,
      severity: 'moderate',
      label: 'Mäßig',
      colorHex: '#f59e0b',
      arrow: '↗'
    };
  }
  if (rounded >= -3.5) {
    return {
      slopePercent: rounded,
      formatted,
      severity: 'flat',
      label: 'Flach',
      colorHex: '#10b981',
      arrow: '➔'
    };
  }
  if (rounded >= -8) {
    return {
      slopePercent: rounded,
      formatted,
      severity: 'descent',
      label: 'Gefälle',
      colorHex: '#06b6d4',
      arrow: '↘'
    };
  }

  return {
    slopePercent: rounded,
    formatted,
    severity: 'steep_descent',
    label: 'Steilabfahrt',
    colorHex: '#3b82f6',
    arrow: '▼▼'
  };
}

/**
 * Calculates or interpolates instantaneous slope at a specific point index in a track.
 */
export function calculateSlopeAtPoint(
  targetPoint: HoverPointCoordinate,
  surroundingPoints?: readonly HoverPointCoordinate[]
): SlopeMetrics {
  if (targetPoint.slope !== undefined && Number.isFinite(targetPoint.slope)) {
    return classifySlope(targetPoint.slope);
  }

  if (surroundingPoints && surroundingPoints.length > 1) {
    // Find index of targetPoint in surroundingPoints
    let index = surroundingPoints.findIndex(
      p => Math.abs(p.lat - targetPoint.lat) < 0.00001 && Math.abs(p.lng - targetPoint.lng) < 0.00001
    );

    // If exact coordinate match not found, find closest point within proximity (~100m)
    if (index === -1) {
      let minDiff = 0.001;
      for (let i = 0; i < surroundingPoints.length; i++) {
        const p = surroundingPoints[i];
        const diff = Math.abs(p.lat - targetPoint.lat) + Math.abs(p.lng - targetPoint.lng);
        if (diff < minDiff) {
          minDiff = diff;
          index = i;
        }
      }
    }

    if (index >= 0) {
      const matchedPoint = surroundingPoints[index];
      if (matchedPoint && matchedPoint.slope !== undefined && Number.isFinite(matchedPoint.slope)) {
        return classifySlope(matchedPoint.slope);
      }

      const prevIdx = Math.max(0, index - 2);
      const nextIdx = Math.min(surroundingPoints.length - 1, index + 2);
      const pPrev = surroundingPoints[prevIdx];
      const pNext = surroundingPoints[nextIdx];

      if (
        pPrev &&
        pNext &&
        pPrev.ele !== undefined &&
        pNext.ele !== undefined &&
        Number.isFinite(pPrev.ele) &&
        Number.isFinite(pNext.ele)
      ) {
        const distMeters = calculatePointDistanceKm(pPrev, pNext) * 1000;
        if (distMeters >= 4) {
          const rawGradient = ((pNext.ele - pPrev.ele) / distMeters) * 100;
          return classifySlope(rawGradient);
        }
      }
    }
  }

  return classifySlope(0);
}

/**
 * Aggregates complete hover telemetry safely into a unified data structure.
 */
export function computeHoverPointTelemetry(
  point: HoverPointCoordinate,
  trackPoints?: readonly HoverPointCoordinate[],
  options?: { maxHr?: number; estimatedSpeedKmh?: number }
): Result<HoverPointTelemetry, Error> {
  if (!point || !Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
    return err(new Error('Invalid point coordinates'));
  }

  const maxHr = options?.maxHr ?? 185;
  const estimatedSpeed = options?.estimatedSpeedKmh ?? 15;

  // 1. Heart rate classification
  let heartRateInfo: HeartRateZoneInfo | null = null;
  if (point.hr !== undefined && point.hr > 0) {
    const hrResult = classifyHeartRate(point.hr, maxHr);
    if (hrResult.success) {
      heartRateInfo = hrResult.data;
    }
  }

  // 2. Slope calculation
  const slope = calculateSlopeAtPoint(point, trackPoints);

  // 3. Time formatting
  let timeFormatted: string | null = null;
  if (point.time) {
    const date = point.time instanceof Date ? point.time : new Date(point.time);
    if (!isNaN(date.getTime())) {
      timeFormatted = date.toLocaleTimeString('de-DE', {
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });
    }
  }

  // 4. Distance & Duration estimation
  let distanceKm: number | null = null;
  let durationEstimate: string | null = null;

  if (point.dist !== undefined && Number.isFinite(point.dist)) {
    distanceKm = Math.round(point.dist * 100) / 100;
  } else if (trackPoints && trackPoints.length > 1) {
    let accumulated = 0;
    for (let i = 1; i < trackPoints.length; i++) {
      accumulated += calculatePointDistanceKm(trackPoints[i - 1], trackPoints[i]);
      if (
        Math.abs(trackPoints[i].lat - point.lat) < 0.00001 &&
        Math.abs(trackPoints[i].lng - point.lng) < 0.00001
      ) {
        break;
      }
    }
    distanceKm = Math.round(accumulated * 100) / 100;
  }

  if (distanceKm !== null && !timeFormatted && estimatedSpeed > 0) {
    const hours = distanceKm / estimatedSpeed;
    const h = Math.floor(hours);
    const m = Math.floor((hours * 60) % 60);
    durationEstimate = `+${h}h ${m}m`;
  }

  const elevationM = point.ele !== undefined && Number.isFinite(point.ele) ? Math.round(point.ele) : null;
  const powerWatts = point.power !== undefined && Number.isFinite(point.power) ? Math.round(point.power) : null;
  const speedKmh = point.speed !== undefined && Number.isFinite(point.speed) ? Math.round(point.speed * 10) / 10 : null;

  return ok({
    lat: point.lat,
    lng: point.lng,
    elevationM,
    slope,
    heartRate: heartRateInfo,
    powerWatts,
    speedKmh,
    timeFormatted,
    distanceKm,
    durationEstimate
  });
}
