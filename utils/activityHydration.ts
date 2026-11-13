import { GPXPoint, GPXTrack } from '../types';
import {
  calculateElevationStats,
  calculatePowerStats,
  calculateSurfaceStatsFromPoints,
  generateVirtualRoute,
  hasRealGpsData,
  hydratePointsWithSurface,
  parseLocationCoords
} from './gpxUtils';

const SEMICIRCLE_TO_DEG = 180 / 2147483648;

function extractNumericField(p: any, keys: string[]): number | undefined {
  if (!p || typeof p !== 'object') return undefined;
  for (const key of keys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  for (const key of Object.keys(p)) {
    if (keys.includes(key.toLowerCase())) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  return undefined;
}

function normalizeCoordPair(rawLat?: number, rawLng?: number): { lat: number; lng: number } | null {
  if (rawLat === undefined || rawLng === undefined || isNaN(rawLat) || isNaN(rawLng)) {
    return null;
  }

  let lat = rawLat;
  let lng = rawLng;

  // Convert Garmin FIT semicircles to decimal degrees if raw integer values are stored
  if (Math.abs(lat) > 180 || Math.abs(lng) > 180) {
    lat = lat * SEMICIRCLE_TO_DEG;
    lng = lng * SEMICIRCLE_TO_DEG;
  }

  // Handle swapped [lng, lat] if latitude exceeds +-90 while longitude is within +-90
  if (Math.abs(lat) > 90 && Math.abs(lng) <= 90) {
    const tmp = lat;
    lat = lng;
    lng = tmp;
  }

  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) return null;

  return { lat, lng };
}

function extractPointCoordinates(p: any): { lat: number; lng: number; ele?: number } | null {
  if (!p) return null;

  if (Array.isArray(p)) {
    const a = p[0] !== undefined ? parseFloat(p[0]) : undefined;
    const b = p[1] !== undefined ? parseFloat(p[1]) : undefined;
    const ele = p[2] !== undefined ? parseFloat(p[2]) : undefined;
    const pair = normalizeCoordPair(a, b);
    if (!pair) return null;
    return {
      ...pair,
      ele: ele !== undefined && !isNaN(ele) ? ele : undefined
    };
  }

  const rawLat = extractNumericField(p, [
    'lat',
    'latitude',
    'lat_deg',
    'position_lat',
    'position_latitude',
    'y'
  ]);
  const rawLng = extractNumericField(p, [
    'lng',
    'longitude',
    'lon',
    'lon_deg',
    'lng_deg',
    'position_lon',
    'position_long',
    'position_longitude',
    'x'
  ]);

  const pair = normalizeCoordPair(rawLat, rawLng);
  if (!pair) return null;

  const ele = extractNumericField(p, [
    'ele',
    'elevation',
    'alt',
    'altitude',
    'altitude_m',
    'height',
    'enhanced_altitude',
    'enhanced_altitude_m'
  ]);

  return { ...pair, ele };
}

export function inferTrackActivityType(rawType?: string, name?: string): 'cycling' | 'running' {
  const t = (rawType || '').toLowerCase();
  const n = (name || '').toLowerCase();
  const combined = `${t} ${n}`;
  if (
    combined.includes('run') ||
    combined.includes('lauf') ||
    combined.includes('jog') ||
    combined.includes('walk') ||
    combined.includes('hike') ||
    combined.includes('wander')
  ) {
    return 'running';
  }
  return 'cycling';
}

export function hydrateLibraryTrackPayload(rawTrack: any): GPXTrack {
  const points: GPXPoint[] = Array.isArray(rawTrack.points)
    ? rawTrack.points
        .map((p: any) => {
          const coords = extractPointCoordinates(p);
          if (!coords) return null;
          return {
            ...p,
            lat: coords.lat,
            lng: coords.lng,
            ele: coords.ele ?? p.ele,
            time: p.time ? new Date(p.time) : undefined
          } as GPXPoint;
        })
        .filter((p: GPXPoint | null): p is GPXPoint => p !== null)
    : [];

  const hasElevation = points.some(
    (p) => p.ele !== undefined && p.ele !== null && !isNaN(Number(p.ele)) && p.ele !== 0
  );
  if (!hasElevation && points.length > 0) {
    const ptsCount = points.length;
    const finalAscent = Number(rawTrack.ascent || 0);
    if (finalAscent > 0 && ptsCount > 1) {
      points.forEach((p, idx) => {
        const angle = (idx / (ptsCount - 1)) * Math.PI;
        p.ele = Math.round(100 + Math.sin(angle) * finalAscent);
      });
    } else if (ptsCount > 1) {
      points.forEach((p, idx) => {
        const angle1 = (idx / (ptsCount - 1)) * Math.PI * 4;
        const angle2 = (idx / (ptsCount - 1)) * Math.PI * 10;
        p.ele = Math.round(150 + Math.sin(angle1) * 15 + Math.cos(angle2) * 4);
      });
    }
  }

  let maxSlope = rawTrack.maxSlope;
  if ((maxSlope === undefined || maxSlope === null) && points.length > 1) {
    try {
      maxSlope = calculateElevationStats(points).maxSlope || 0;
    } catch {
      maxSlope = 0;
    }
  }

  const calcSurface = points.length > 1 ? calculateSurfaceStatsFromPoints(points) : [];
  const surfaceStats =
    calcSurface.length > 0
      ? calcSurface
      : Array.isArray(rawTrack.surfaceStats)
      ? rawTrack.surfaceStats
      : [];

  if (points.length > 1 && surfaceStats.length > 0) {
    hydratePointsWithSurface(points, surfaceStats, Number(rawTrack.distance || 0));
  }

  const taggedVirtual = Boolean(
    rawTrack.isVirtual ||
    (Array.isArray(rawTrack.tags) &&
      rawTrack.tags.some((t: any) => String(t).trim().toLowerCase() === 'indoor/virtuell')) ||
    rawTrack.rawFileDetails?.metadata?.isVirtual
  );
  const hasRealGps = !taggedVirtual && hasRealGpsData({ ...rawTrack, points, isVirtual: false });

  return {
    ...rawTrack,
    points,
    maxSlope: maxSlope ?? 0,
    surfaceStats,
    isVirtual: !hasRealGps,
    visible: true
  };
}

export function isTwoPointSeedStub(points: any[], distanceKm: number): boolean {
  return (
    Array.isArray(points) &&
    points.length > 0 &&
    points.length <= 2 &&
    distanceKm > 0.5 &&
    !points.some(
      (p) =>
        p &&
        (p.time !== undefined ||
          p.hr !== undefined ||
          p.power !== undefined ||
          p.cadence !== undefined ||
          p.speed !== undefined)
    )
  );
}

export function hydrateGarminActivityPayload(
  act: any,
  options?: { ftp?: number; userWeight?: number; estimatedSpeed?: number }
): GPXTrack {
  let startCoords =
    parseLocationCoords(act.location) ||
    parseLocationCoords(act.name) || { lat: 48.1351, lng: 11.5820 };

  const durationSec = Number(act.duration || 3600);
  const distanceKm = Number(act.distance || 10);
  const ascent = Math.round(Number(act.ascent || 0));
  const descent = Math.round(Number(act.descent || 0));
  const avgHr = act.avg_hr ? Number(act.avg_hr) : undefined;
  const activityType = inferTrackActivityType(act.type, act.name);

  let isVirtual = false;
  let points: GPXPoint[] = [];

  if (act.points_json) {
    try {
      const parsed = typeof act.points_json === 'string' ? JSON.parse(act.points_json) : act.points_json;
      if (Array.isArray(parsed) && parsed.length > 0) {
        points = parsed
          .map((p: any) => {
            const coords = extractPointCoordinates(p);
            if (!coords) return null;
            const hr = extractNumericField(p, [
              'hr',
              'heartrate',
              'heart_rate',
              'average_hr',
              'avg_hr',
              'hf',
              'herzfrequenz',
              'puls',
              'heartrate_bpm',
              'heart_rate_bpm'
            ]);
            const cadence = extractNumericField(p, [
              'cadence',
              'cad',
              'average_cadence',
              'avg_cadence',
              'bike_cadence',
              'run_cadence',
              'trittfrequenz',
              'cadence_rpm'
            ]);
            const power = extractNumericField(p, [
              'power',
              'watts',
              'average_power',
              'avg_power',
              'pwr',
              'leistung',
              'power_watts'
            ]);
            const speed = extractNumericField(p, [
              'speed',
              'velocity',
              'enhanced_speed',
              'speed_m_s',
              'geschwindigkeit'
            ]);
            const temp = extractNumericField(p, ['temp', 'temperature', 'air_temp']);
            return {
              lat: coords.lat,
              lng: coords.lng,
              ele: coords.ele,
              time: p.time ? new Date(p.time) : p.timestamp ? new Date(p.timestamp) : undefined,
              hr: hr && hr > 0 ? hr : undefined,
              cadence,
              power,
              speed,
              temp
            } as GPXPoint;
          })
          .filter((p: GPXPoint | null): p is GPXPoint => p !== null);
      }
    } catch (err) {
      console.error('Failed to parse Garmin points_json during hydration:', err);
    }
  }

  if (isTwoPointSeedStub(points, distanceKm)) {
    startCoords = { lat: points[0].lat, lng: points[0].lng };
    points = [];
  }

  let finalAscent = ascent;
  let finalDescent = descent;

  if (points.length > 1 && (finalAscent === 0 || finalDescent === 0)) {
    const stats = calculateElevationStats(points);
    if (finalAscent === 0) finalAscent = stats.ascent;
    if (finalDescent === 0) finalDescent = stats.descent;
  }

  const hasElevation = points.some(
    (p) => p.ele !== undefined && p.ele !== null && !isNaN(p.ele) && p.ele !== 0
  );
  if (!hasElevation && points.length > 1) {
    const ptsCount = points.length;
    if (finalAscent > 0) {
      points.forEach((p, idx) => {
        const angle = (idx / (ptsCount - 1)) * Math.PI;
        p.ele = Math.round(100 + Math.sin(angle) * finalAscent);
      });
    } else {
      points.forEach((p, idx) => {
        const angle1 = (idx / (ptsCount - 1)) * Math.PI * 4;
        const angle2 = (idx / (ptsCount - 1)) * Math.PI * 10;
        p.ele = Math.round(150 + Math.sin(angle1) * 15 + Math.cos(angle2) * 4);
      });
    }
  }

  if (points.length <= 1 || !hasRealGpsData({ points, isVirtual: false })) {
    if (points.length === 1) {
      startCoords = { lat: points[0].lat, lng: points[0].lng };
    }
    isVirtual = true;
    points = generateVirtualRoute(
      startCoords.lat,
      startCoords.lng,
      distanceKm,
      durationSec,
      finalAscent,
      finalDescent,
      avgHr,
      activityType
    );
  }

  const { maxSlope } =
    points.length > 1 ? calculateElevationStats(points) : { maxSlope: 0 };

  const track: GPXTrack = {
    id: `garmin-act-${act.id || Date.now()}`,
    name: act.name || 'Garmin Aktivität',
    points,
    color: '#f97316',
    distance: distanceKm,
    ascent: Math.round(finalAscent),
    descent: Math.round(finalDescent),
    maxSlope: maxSlope || 0,
    visible: true,
    activityType,
    duration: durationSec,
    hasTimestamps: points.some((p) => !!p.time),
    dateCreated: act.date || undefined,
    tags: act.location ? [String(act.location)] : undefined,
    description:
      act.description ||
      (act.location ? `Garmin Aktivität in ${act.location}` : undefined),
    isVirtual
  };

  if (options?.ftp && options?.userWeight && options?.estimatedSpeed && points.length > 1) {
    try {
      track.powerStats = calculatePowerStats(
        points,
        options.ftp,
        options.userWeight,
        options.estimatedSpeed,
        activityType
      );
    } catch {
      // Optional enrichment
    }
  }

  return track;
}
