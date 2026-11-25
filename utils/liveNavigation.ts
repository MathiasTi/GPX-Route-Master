import type { GPXPoint, GPXTrack, RouteTurnCue, RouteTurnDirection } from '../types';
import { haversineDistanceKm } from './routePlanner';

export interface LiveGpsFix {
  lat: number;
  lng: number;
  accuracyM: number;
  speedKmh?: number | null;
  heading?: number | null;
  timestampMs?: number;
}

export interface LiveNextTurn {
  cue: RouteTurnCue;
  distanceToTurnM: number;
}

export interface LiveTrackProgress {
  nearestPointIndex: number;
  nearestLat: number;
  nearestLng: number;
  distanceToTrackM: number;
  bearingBackToTrackDeg: number;
  isOffRoute: boolean;
  distanceCompletedKm: number;
  distanceRemainingKm: number;
  totalDistanceKm: number;
  ascentRemainingM: number;
  progressPct: number;
  nextTurn: LiveNextTurn | null;
}

export const OFF_ROUTE_ENTER_METERS = 45;
export const OFF_ROUTE_EXIT_METERS = 30;

export function computeBearingDeg(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/**
 * Signed turn angle in degrees in range (-180, 180].
 * Positive = right turn, Negative = left turn.
 */
export function computeTurnAngleDeg(bearingIn: number, bearingOut: number): number {
  let diff = (bearingOut - bearingIn + 540) % 360 - 180;
  if (diff <= -180) diff += 360;
  return diff;
}

export function classifyTurnDirection(angleDeg: number): RouteTurnDirection | null {
  const abs = Math.abs(angleDeg);
  if (abs < 35) return null;
  if (abs >= 145) return 'uturn';
  if (angleDeg > 0) {
    if (abs >= 115) return 'sharp-right';
    if (abs >= 55) return 'right';
    return 'slight-right';
  }
  if (abs >= 115) return 'sharp-left';
  if (abs >= 55) return 'left';
  return 'slight-left';
}

export function formatTurnInstruction(
  direction: RouteTurnDirection,
  language: 'de' | 'en' = 'de'
): string {
  const isEn = language === 'en';
  switch (direction) {
    case 'left':
      return isEn ? 'Turn left' : 'Links abbiegen';
    case 'slight-left':
      return isEn ? 'Keep slight left' : 'Leicht links halten';
    case 'sharp-left':
      return isEn ? 'Sharp left turn' : 'Scharf links abbiegen';
    case 'right':
      return isEn ? 'Turn right' : 'Rechts abbiegen';
    case 'slight-right':
      return isEn ? 'Keep slight right' : 'Leicht rechts halten';
    case 'sharp-right':
      return isEn ? 'Sharp right turn' : 'Scharf rechts abbiegen';
    case 'uturn':
      return isEn ? 'Make a U-turn' : 'Wenden';
    case 'arrive':
      return isEn ? 'Arrive at finish' : 'Ziel erreicht';
    case 'start':
      return isEn ? 'Start route' : 'Route starten';
    default:
      return isEn ? 'Continue straight' : 'Geradeaus weiter';
  }
}

export function formatTurnDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) return '0 m';
  if (meters < 100) {
    return `${Math.max(5, Math.round(meters / 5) * 5)} m`;
  }
  if (meters < 1000) {
    return `${Math.round(meters / 10) * 10} m`;
  }
  return `${(Math.round(meters / 100) / 10).toFixed(1)} km`;
}

const cumulativeKmWeakCache = new WeakMap<readonly GPXPoint[], number[]>();

/**
 * Computes cumulative distance (km) along a list of GPXPoints (WeakMap-cached per points reference).
 */
export function buildCumulativeKmArray(points: readonly GPXPoint[]): number[] {
  if (points.length === 0) return [];
  const cached = cumulativeKmWeakCache.get(points);
  if (cached && cached.length === points.length) {
    return cached;
  }
  const cum = new Array<number>(points.length).fill(0);
  for (let i = 1; i < points.length; i++) {
    cum[i] = cum[i - 1] + haversineDistanceKm(points[i - 1], points[i]);
  }
  cumulativeKmWeakCache.set(points, cum);
  return cum;
}

/**
 * Derives clean geometric turn cues from any GPX track's geometry when Valhalla maneuvers are absent.
 */
export function extractGeometricTurnCues(
  points: readonly GPXPoint[],
  language: 'de' | 'en' = 'de'
): RouteTurnCue[] {
  if (points.length < 3) return [];
  const cumKm = buildCumulativeKmArray(points);
  const cues: RouteTurnCue[] = [];
  const LOOKAHEAD_KM = 0.035; // 35m smoothing window
  const MIN_SPACING_KM = 0.12; // 120m between cues
  let lastCueKm = -1;

  for (let i = 1; i < points.length - 1; i++) {
    if (lastCueKm >= 0 && cumKm[i] - lastCueKm < MIN_SPACING_KM) continue;

    // Find point ~35m before i
    let prevIdx = i - 1;
    while (prevIdx > 0 && cumKm[i] - cumKm[prevIdx] < LOOKAHEAD_KM) {
      prevIdx--;
    }
    // Find point ~35m after i
    let nextIdx = i + 1;
    while (nextIdx < points.length - 1 && cumKm[nextIdx] - cumKm[i] < LOOKAHEAD_KM) {
      nextIdx++;
    }

    if (cumKm[i] - cumKm[prevIdx] < 0.015 || cumKm[nextIdx] - cumKm[i] < 0.015) {
      continue;
    }

    const bIn = computeBearingDeg(points[prevIdx], points[i]);
    const bOut = computeBearingDeg(points[i], points[nextIdx]);
    const angle = computeTurnAngleDeg(bIn, bOut);
    const direction = classifyTurnDirection(angle);

    if (direction) {
      cues.push({
        index: i,
        lat: points[i].lat,
        lng: points[i].lng,
        distFromStartKm: Number(cumKm[i].toFixed(3)),
        direction,
        instruction: formatTurnInstruction(direction, language)
      });
      lastCueKm = cumKm[i];
    }
  }

  const lastIdx = points.length - 1;
  cues.push({
    index: lastIdx,
    lat: points[lastIdx].lat,
    lng: points[lastIdx].lng,
    distFromStartKm: Number(cumKm[lastIdx].toFixed(3)),
    direction: 'arrive',
    instruction: formatTurnInstruction('arrive', language)
  });

  return cues;
}

export function resolveTrackTurnCues(
  track: GPXTrack | null | undefined,
  language: 'de' | 'en' = 'de'
): RouteTurnCue[] {
  if (!track || !track.points || track.points.length < 2) return [];
  if (Array.isArray(track.routeManeuvers) && track.routeManeuvers.length > 0) {
    return track.routeManeuvers;
  }
  return extractGeometricTurnCues(track.points, language);
}

/**
 * Projects a live GPS position onto the nearest segment of a track and returns
 * remaining distance, remaining ascent, off-route status (with hysteresis), and next turn cue.
 */
export function computeLiveTrackProgress(
  fix: LiveGpsFix,
  track: GPXTrack,
  cues: readonly RouteTurnCue[],
  previous?: { wasOffRoute?: boolean }
): LiveTrackProgress | null {
  const points = track.points;
  if (!points || points.length < 2) return null;

  const cumKm = buildCumulativeKmArray(points);
  const totalDistanceKm = cumKm[cumKm.length - 1];
  const cosLat = Math.cos((fix.lat * Math.PI) / 180);

  const metersPerDegLng = cosLat * 111320;
  let bestDistSq = Infinity;
  let bestIdx = 0;
  let bestLat = points[0].lat;
  let bestLng = points[0].lng;
  let bestCompletedKm = 0;

  for (let i = 0; i < points.length - 1; i++) {
    const a = points[i];
    const b = points[i + 1];

    // Local equirectangular projection in meters relative to A
    const bx = (b.lng - a.lng) * metersPerDegLng;
    const by = (b.lat - a.lat) * 111320;
    const px = (fix.lng - a.lng) * metersPerDegLng;
    const py = (fix.lat - a.lat) * 111320;

    const abLenSq = bx * bx + by * by;
    let t = 0;
    if (abLenSq > 1e-6) {
      t = Math.max(0, Math.min(1, (px * bx + py * by) / abLenSq));
    }

    const dx = px - bx * t;
    const dy = py - by * t;
    const distSq = dx * dx + dy * dy;

    if (distSq < bestDistSq) {
      bestDistSq = distSq;
      bestIdx = t >= 0.5 ? i + 1 : i;
      bestLat = a.lat + (b.lat - a.lat) * t;
      bestLng = a.lng + (b.lng - a.lng) * t;
      const segKm = cumKm[i + 1] - cumKm[i];
      bestCompletedKm = cumKm[i] + segKm * t;
    }
  }
  const bestDistM = Math.sqrt(bestDistSq);

  // Off-route hysteresis to avoid jittery toggling at the threshold
  const wasOffRoute = Boolean(previous?.wasOffRoute);
  const isOffRoute = wasOffRoute
    ? bestDistM > OFF_ROUTE_EXIT_METERS
    : bestDistM > OFF_ROUTE_ENTER_METERS;

  const distanceRemainingKm = Math.max(0, totalDistanceKm - bestCompletedKm);
  const progressPct =
    totalDistanceKm > 0
      ? Math.max(0, Math.min(100, (bestCompletedKm / totalDistanceKm) * 100))
      : 0;

  // Remaining elevation gain from nearestPointIndex onward (2.5m hysteresis)
  let ascentRemainingM = 0;
  let eleAnchor =
    typeof points[bestIdx]?.ele === 'number' && Number.isFinite(points[bestIdx].ele)
      ? (points[bestIdx].ele as number)
      : null;
  for (let i = bestIdx + 1; i < points.length; i++) {
    const ele = points[i].ele;
    if (typeof ele !== 'number' || !Number.isFinite(ele)) continue;
    if (eleAnchor === null) {
      eleAnchor = ele;
    } else {
      const diff = ele - eleAnchor;
      if (Math.abs(diff) >= 2.5) {
        if (diff > 0) ascentRemainingM += diff;
        eleAnchor = ele;
      }
    }
  }

  // Next upcoming turn cue at least 15m ahead along the route
  let nextTurn: LiveNextTurn | null = null;
  for (const cue of cues) {
    if (cue.direction === 'start') continue;
    const distAheadM = (cue.distFromStartKm - bestCompletedKm) * 1000;
    if (distAheadM >= 15) {
      nextTurn = {
        cue,
        distanceToTurnM: Math.round(distAheadM)
      };
      break;
    }
  }
  if (!nextTurn && cues.length > 0) {
    const lastCue = cues[cues.length - 1];
    const distAheadM = Math.max(0, Math.round((lastCue.distFromStartKm - bestCompletedKm) * 1000));
    nextTurn = { cue: lastCue, distanceToTurnM: distAheadM };
  }

  const bearingBackToTrackDeg = computeBearingDeg(
    { lat: fix.lat, lng: fix.lng },
    { lat: bestLat, lng: bestLng }
  );

  return {
    nearestPointIndex: bestIdx,
    nearestLat: bestLat,
    nearestLng: bestLng,
    distanceToTrackM: Math.round(bestDistM),
    bearingBackToTrackDeg: Math.round(bearingBackToTrackDeg),
    isOffRoute,
    distanceCompletedKm: Number(bestCompletedKm.toFixed(2)),
    distanceRemainingKm: Number(distanceRemainingKm.toFixed(2)),
    totalDistanceKm: Number(totalDistanceKm.toFixed(2)),
    ascentRemainingM: Math.round(ascentRemainingM),
    progressPct: Number(progressPct.toFixed(1)),
    nextTurn
  };
}
