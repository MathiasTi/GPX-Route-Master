import type { GPXPoint, RouteTurnCue, RouteTurnDirection } from '../types';
import { haversineDistanceKm } from './routePlanner';

export type ValhallaRouteProfile = 'road' | 'gravel' | 'mtb' | 'running';

export const VALID_VALHALLA_PROFILES: readonly ValhallaRouteProfile[] = [
  'road',
  'gravel',
  'mtb',
  'running'
] as const;

export interface ValhallaWaypointInput {
  lat: number;
  lng: number;
}

export interface ValidatedValhallaRequest {
  waypoints: ValhallaWaypointInput[];
  profile: ValhallaRouteProfile;
  language: 'de-DE' | 'en-US';
}

export interface ValhallaSnappedRouteResult {
  points: GPXPoint[];
  maneuvers: RouteTurnCue[];
  totalDistanceKm: number;
  ascentM: number;
  descentM: number;
  maxSlope: number;
  estimatedDurationSec: number;
  elevationAvailable: boolean;
  source: 'valhalla';
}

// Fixed, hardcoded FOSSGIS OpenStreetMap Valhalla endpoints (never user-supplied)
const VALHALLA_ROUTE_URL = 'https://valhalla1.openstreetmap.de/route';
const VALHALLA_HEIGHT_URL = 'https://valhalla1.openstreetmap.de/height';

export function validateValhallaRouteRequest(
  body: unknown
): { ok: true; data: ValidatedValhallaRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') {
    return { ok: false, error: 'Missing request body.' };
  }
  const raw = body as Record<string, unknown>;
  const rawWaypoints = raw.waypoints;
  if (!Array.isArray(rawWaypoints) || rawWaypoints.length < 2) {
    return { ok: false, error: 'At least 2 waypoints are required.' };
  }
  if (rawWaypoints.length > 25) {
    return { ok: false, error: 'Maximum of 25 waypoints allowed per request.' };
  }

  const waypoints: ValhallaWaypointInput[] = [];
  for (const item of rawWaypoints) {
    if (!item || typeof item !== 'object') {
      return { ok: false, error: 'Invalid waypoint format.' };
    }
    const lat = Number((item as Record<string, unknown>).lat);
    const lng = Number((item as Record<string, unknown>).lng);
    if (
      !Number.isFinite(lat) ||
      !Number.isFinite(lng) ||
      lat < -90 ||
      lat > 90 ||
      lng < -180 ||
      lng > 180
    ) {
      return { ok: false, error: 'Waypoint coordinates are out of valid geographic bounds.' };
    }
    waypoints.push({
      lat: Number(lat.toFixed(6)),
      lng: Number(lng.toFixed(6))
    });
  }

  const rawProfile = typeof raw.profile === 'string' ? raw.profile.trim().toLowerCase() : 'road';
  if (!VALID_VALHALLA_PROFILES.includes(rawProfile as ValhallaRouteProfile)) {
    return {
      ok: false,
      error: `Invalid profile "${rawProfile}". Allowed: road, gravel, mtb, running.`
    };
  }

  const rawLang = typeof raw.language === 'string' ? raw.language.trim() : 'de-DE';
  const language: 'de-DE' | 'en-US' = rawLang.toLowerCase().startsWith('en') ? 'en-US' : 'de-DE';

  return {
    ok: true,
    data: {
      waypoints,
      profile: rawProfile as ValhallaRouteProfile,
      language
    }
  };
}

/**
 * Builds the exact Valhalla /route JSON payload for Road, Gravel, MTB, or Running.
 */
export function buildValhallaRoutePayload(
  waypoints: readonly ValhallaWaypointInput[],
  profile: ValhallaRouteProfile,
  language: 'de-DE' | 'en-US' = 'de-DE'
): Record<string, unknown> {
  const locations = waypoints.map((wp, idx) => ({
    lat: wp.lat,
    lon: wp.lng,
    type: idx === 0 || idx === waypoints.length - 1 ? 'break' : 'through'
  }));

  if (profile === 'running') {
    return {
      locations,
      costing: 'pedestrian',
      costing_options: {
        pedestrian: {
          walking_speed: 9.5,
          use_tracks: 0.85,
          walkway_factor: 0.8,
          sidewalk_factor: 0.9,
          use_hills: 0.5
        }
      },
      units: 'kilometers',
      directions_options: {
        language
      }
    };
  }

  const bicycleOptions =
    profile === 'road'
      ? {
          bicycle_type: 'Road',
          cycling_speed: 26.0,
          use_roads: 0.75,
          use_hills: 0.5,
          avoid_bad_surfaces: 0.85
        }
      : profile === 'gravel'
      ? {
          bicycle_type: 'Cross',
          cycling_speed: 20.0,
          use_roads: 0.35,
          use_hills: 0.5,
          avoid_bad_surfaces: 0.2
        }
      : {
          // mtb
          bicycle_type: 'Mountain',
          cycling_speed: 16.0,
          use_roads: 0.1,
          use_hills: 0.6,
          avoid_bad_surfaces: 0.0
        };

  return {
    locations,
    costing: 'bicycle',
    costing_options: {
      bicycle: bicycleOptions
    },
    units: 'kilometers',
    directions_options: {
      language
    }
  };
}

/**
 * Decodes a Valhalla precision-6 (1e-6) encoded polyline string into lat/lng coordinates.
 */
export function decodePolyline6(encoded: string): Array<{ lat: number; lng: number }> {
  if (!encoded || typeof encoded !== 'string') return [];
  const coordinates: Array<{ lat: number; lng: number }> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;
  const len = encoded.length;

  while (index < len) {
    let shift = 0;
    let result = 0;
    let byte = 0;
    do {
      if (index >= len) break;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLat = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lat += dLat;

    shift = 0;
    result = 0;
    do {
      if (index >= len) break;
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);
    const dLng = (result & 1) !== 0 ? ~(result >> 1) : result >> 1;
    lng += dLng;

    coordinates.push({
      lat: Number((lat / 1e6).toFixed(6)),
      lng: Number((lng / 1e6).toFixed(6))
    });
  }

  return coordinates;
}

/**
 * Maps Valhalla maneuver type enum codes to clean semantic turn directions.
 * Reference: Valhalla Turn-by-Turn API maneuver types (1..37).
 */
export function mapValhallaManeuverType(type: number): RouteTurnDirection {
  switch (type) {
    case 1:
    case 2:
    case 3:
      return 'start';
    case 4:
    case 5:
    case 6:
      return 'arrive';
    case 9:
    case 18:
    case 20:
      return 'slight-right';
    case 10:
      return 'right';
    case 11:
      return 'sharp-right';
    case 12:
    case 13:
      return 'uturn';
    case 14:
      return 'sharp-left';
    case 15:
      return 'left';
    case 16:
    case 19:
    case 21:
      return 'slight-left';
    default:
      return 'straight';
  }
}

/**
 * Computes cumulative distance (meters), point-wise smoothed slope (%), ascent, descent, and max slope.
 */
export function computeRouteElevationMetrics(points: GPXPoint[]): {
  points: GPXPoint[];
  totalDistanceKm: number;
  ascentM: number;
  descentM: number;
  maxSlope: number;
} {
  if (points.length === 0) {
    return { points: [], totalDistanceKm: 0, ascentM: 0, descentM: 0, maxSlope: 0 };
  }

  const enriched: GPXPoint[] = points.map((p) => ({ ...p }));
  let cumMeters = 0;
  let ascentM = 0;
  let descentM = 0;
  let maxSlope = 0;

  enriched[0].dist = 0;
  enriched[0].slope = 0;

  // Hysteresis accumulator for realistic elevation gain/loss (prevents tiny DEM jitter inflation)
  let lastEleAnchor = Number.isFinite(enriched[0].ele) ? (enriched[0].ele as number) : null;

  for (let i = 1; i < enriched.length; i++) {
    const segM = haversineDistanceKm(enriched[i - 1], enriched[i]) * 1000;
    cumMeters += segM;
    enriched[i].dist = Math.round(cumMeters);

    const prevEle = enriched[i - 1].ele;
    const currEle = enriched[i].ele;
    if (
      typeof prevEle === 'number' &&
      Number.isFinite(prevEle) &&
      typeof currEle === 'number' &&
      Number.isFinite(currEle)
    ) {
      if (lastEleAnchor === null) {
        lastEleAnchor = currEle;
      } else {
        const diff = currEle - lastEleAnchor;
        if (Math.abs(diff) >= 2.5) {
          if (diff > 0) ascentM += diff;
          else descentM += Math.abs(diff);
          lastEleAnchor = currEle;
        }
      }

      if (segM >= 8) {
        const rawSlope = ((currEle - prevEle) / segM) * 100;
        const clamped = Math.max(-30, Math.min(30, rawSlope));
        enriched[i].slope = Number(clamped.toFixed(1));
        if (Math.abs(clamped) > maxSlope) {
          maxSlope = Math.abs(clamped);
        }
      } else {
        enriched[i].slope = enriched[i - 1].slope ?? 0;
      }
    } else {
      enriched[i].slope = 0;
    }
  }

  return {
    points: enriched,
    totalDistanceKm: Number((cumMeters / 1000).toFixed(3)),
    ascentM: Math.round(ascentM),
    descentM: Math.round(descentM),
    maxSlope: Number(maxSlope.toFixed(1))
  };
}

/**
 * Fetches elevation samples from fixed Valhalla /height endpoint and linearly interpolates across all shape points.
 */
async function enrichPointsWithValhallaHeight(
  coords: Array<{ lat: number; lng: number }>
): Promise<{ elevations: number[] | null }> {
  if (coords.length < 2) return { elevations: null };

  const MAX_SAMPLES = 180;
  const sampleIndices: number[] = [];
  if (coords.length <= MAX_SAMPLES) {
    for (let i = 0; i < coords.length; i++) sampleIndices.push(i);
  } else {
    const stride = (coords.length - 1) / (MAX_SAMPLES - 1);
    for (let s = 0; s < MAX_SAMPLES; s++) {
      const idx = Math.min(coords.length - 1, Math.round(s * stride));
      if (sampleIndices[sampleIndices.length - 1] !== idx) {
        sampleIndices.push(idx);
      }
    }
    if (sampleIndices[sampleIndices.length - 1] !== coords.length - 1) {
      sampleIndices.push(coords.length - 1);
    }
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 6500);
  try {
    const res = await fetch(VALHALLA_HEIGHT_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GPX-Route-Master/2.9 (OSM Valhalla Height Client)'
      },
      body: JSON.stringify({
        range: false,
        shape: sampleIndices.map((idx) => ({
          lat: coords[idx].lat,
          lon: coords[idx].lng
        }))
      }),
      signal: controller.signal
    });
    if (!res.ok) return { elevations: null };
    const data = (await res.json()) as { height?: Array<number | null> };
    const heights = data?.height;
    if (!Array.isArray(heights) || heights.length !== sampleIndices.length) {
      return { elevations: null };
    }

    const validCount = heights.filter((h) => typeof h === 'number' && Number.isFinite(h)).length;
    if (validCount < 2) return { elevations: null };

    // Fill any single null height from nearest valid neighbor
    const filledSamples = heights.map((h, idx) => {
      if (typeof h === 'number' && Number.isFinite(h)) return h;
      for (let d = 1; d < heights.length; d++) {
        const left = heights[idx - d];
        if (typeof left === 'number' && Number.isFinite(left)) return left;
        const right = heights[idx + d];
        if (typeof right === 'number' && Number.isFinite(right)) return right;
      }
      return 0;
    });

    // Interpolate back onto full coordinate list
    const fullElevations = new Array<number>(coords.length).fill(0);
    for (let s = 0; s < sampleIndices.length - 1; s++) {
      const startIdx = sampleIndices[s];
      const endIdx = sampleIndices[s + 1];
      const startEle = filledSamples[s];
      const endEle = filledSamples[s + 1];
      const span = Math.max(1, endIdx - startIdx);
      for (let idx = startIdx; idx <= endIdx; idx++) {
        const t = (idx - startIdx) / span;
        fullElevations[idx] = Number((startEle + (endEle - startEle) * t).toFixed(1));
      }
    }
    return { elevations: fullElevations };
  } catch {
    return { elevations: null };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Calls the public OSM Valhalla /route and /height endpoints server-side to snap waypoints to real roads/trails.
 */
export async function fetchValhallaSnappedRoute(
  waypoints: readonly ValhallaWaypointInput[],
  profile: ValhallaRouteProfile,
  language: 'de-DE' | 'en-US' = 'de-DE'
): Promise<ValhallaSnappedRouteResult> {
  const payload = buildValhallaRoutePayload(waypoints, profile, language);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  let routeJson: any;
  try {
    const res = await fetch(VALHALLA_ROUTE_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'User-Agent': 'GPX-Route-Master/2.9 (OSM Valhalla Routing Proxy)'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`Valhalla routing error (${res.status}): ${errText.slice(0, 160)}`);
    }
    routeJson = await res.json();
  } finally {
    clearTimeout(timeout);
  }

  const trip = routeJson?.trip;
  const legs = Array.isArray(trip?.legs) ? trip.legs : [];
  if (legs.length === 0) {
    throw new Error('Valhalla returned no route legs.');
  }

  const combinedCoords: Array<{ lat: number; lng: number }> = [];
  const rawManeuvers: RouteTurnCue[] = [];
  let legDistancePrefixKm = 0;

  for (const leg of legs) {
    const legCoords = decodePolyline6(String(leg?.shape || ''));
    const shapeOffset = combinedCoords.length > 0 ? combinedCoords.length - 1 : 0;

    for (let i = 0; i < legCoords.length; i++) {
      if (combinedCoords.length > 0 && i === 0) continue; // join shared leg boundary point cleanly
      combinedCoords.push(legCoords[i]);
    }

    const maneuvers = Array.isArray(leg?.maneuvers) ? leg.maneuvers : [];
    let runningDistKm = legDistancePrefixKm;

    for (const m of maneuvers) {
      const localShapeIdx = Number(m?.begin_shape_index ?? 0);
      const globalIdx = Math.max(
        0,
        Math.min(combinedCoords.length - 1, shapeOffset + localShapeIdx)
      );
      const coord = combinedCoords[globalIdx];
      if (coord) {
        const streetNames = Array.isArray(m?.street_names) ? m.street_names : [];
        const instruction =
          typeof m?.instruction === 'string' && m.instruction.trim()
            ? m.instruction.trim()
            : '';
        if (instruction) {
          rawManeuvers.push({
            index: globalIdx,
            lat: coord.lat,
            lng: coord.lng,
            distFromStartKm: Number(runningDistKm.toFixed(3)),
            direction: mapValhallaManeuverType(Number(m?.type ?? 8)),
            instruction,
            streetName: typeof streetNames[0] === 'string' ? streetNames[0] : undefined
          });
        }
      }
      const mLenKm = Number(m?.length ?? 0);
      if (Number.isFinite(mLenKm) && mLenKm > 0) {
        runningDistKm += mLenKm;
      }
    }

    const legLen = Number(leg?.summary?.length ?? 0);
    if (Number.isFinite(legLen) && legLen > 0) {
      legDistancePrefixKm += legLen;
    }
  }

  if (combinedCoords.length < 2) {
    throw new Error('Valhalla returned an empty route geometry.');
  }

  const { elevations } = await enrichPointsWithValhallaHeight(combinedCoords);
  const rawPoints: GPXPoint[] = combinedCoords.map((c, idx) => ({
    lat: c.lat,
    lng: c.lng,
    ele: elevations ? elevations[idx] : 0
  }));

  const metrics = computeRouteElevationMetrics(rawPoints);
  const summaryTimeSec = Number(trip?.summary?.time ?? 0);
  const summaryDistKm = Number(trip?.summary?.length ?? metrics.totalDistanceKm);

  return {
    points: metrics.points,
    maneuvers: rawManeuvers,
    totalDistanceKm: Number(
      (Number.isFinite(summaryDistKm) && summaryDistKm > 0 ? summaryDistKm : metrics.totalDistanceKm).toFixed(3)
    ),
    ascentM: metrics.ascentM,
    descentM: metrics.descentM,
    maxSlope: metrics.maxSlope,
    estimatedDurationSec:
      Number.isFinite(summaryTimeSec) && summaryTimeSec > 0
        ? Math.round(summaryTimeSec)
        : Math.round((metrics.totalDistanceKm / (profile === 'running' ? 9.5 : 20)) * 3600),
    elevationAvailable: Boolean(elevations),
    source: 'valhalla'
  };
}
