import type { GPXPoint, GPXTrack, RouteTurnCue } from '../types';

export type RouteProfile = 'road' | 'gravel' | 'mtb' | 'running';

export interface RouteProfileMeta {
  id: RouteProfile;
  labelDe: string;
  labelEn: string;
  defaultSpeedKmh: number;
  activityType: 'cycling' | 'running';
  colorHex: string;
  tagDe: string;
}

export const ROUTE_PROFILE_META: Record<RouteProfile, RouteProfileMeta> = {
  road: {
    id: 'road',
    labelDe: 'Rennrad',
    labelEn: 'Road',
    defaultSpeedKmh: 26,
    activityType: 'cycling',
    colorHex: '#4f46e5',
    tagDe: 'Rennrad'
  },
  gravel: {
    id: 'gravel',
    labelDe: 'Gravel',
    labelEn: 'Gravel',
    defaultSpeedKmh: 20,
    activityType: 'cycling',
    colorHex: '#d97706',
    tagDe: 'Gravel'
  },
  mtb: {
    id: 'mtb',
    labelDe: 'MTB',
    labelEn: 'MTB',
    defaultSpeedKmh: 16,
    activityType: 'cycling',
    colorHex: '#10b981',
    tagDe: 'MTB'
  },
  running: {
    id: 'running',
    labelDe: 'Lauf',
    labelEn: 'Run',
    defaultSpeedKmh: 10,
    activityType: 'running',
    colorHex: '#f97316',
    tagDe: 'Laufplanung'
  }
};

export interface RouteWaypoint {
  id: string;
  lat: number;
  lng: number;
  label?: string;
}

export interface RoutePreview {
  points: GPXPoint[];
  segmentDistancesKm: number[];
  totalDistanceKm: number;
  ascentM: number;
  descentM: number;
  maxSlope: number;
  estimatedDurationSec: number;
  estimatedSpeedKmh: number;
  pacePerKmFormatted: string;
  maneuvers: RouteTurnCue[];
  engineId: 'direct-local' | 'valhalla';
  elevationAvailable: boolean;
}

export interface RouteEngineOptions {
  cyclingSpeedKmh?: number;
  runningSpeedKmh?: number;
  maxSegmentStepKm?: number;
  maxTotalPoints?: number;
}

export interface RouteEngineAdapter {
  readonly id: string;
  readonly label: string;
  computeRoute(
    waypoints: readonly RouteWaypoint[],
    profile: RouteProfile | 'cycling',
    options?: RouteEngineOptions
  ): RoutePreview;
}

export const DEFAULT_CYCLING_SPEED_KMH = 24;
export const DEFAULT_RUNNING_SPEED_KMH = 10; // 6:00 min/km

export function normalizeRouteProfile(profile: RouteProfile | 'cycling'): RouteProfile {
  if (profile === 'cycling') return 'road';
  return ROUTE_PROFILE_META[profile] ? profile : 'road';
}

export function haversineDistanceKm(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number }
): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;

  const sinDLat = Math.sin(dLat / 2);
  const sinDLng = Math.sin(dLng / 2);
  const h =
    sinDLat * sinDLat + Math.cos(lat1) * Math.cos(lat2) * sinDLng * sinDLng;
  return 2 * R * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function formatRoutePacePerKm(speedKmh: number): string {
  if (!Number.isFinite(speedKmh) || speedKmh <= 0) return '--:-- /km';
  const totalSecPerKm = Math.round(3600 / speedKmh);
  const mins = Math.floor(totalSecPerKm / 60);
  const secs = totalSecPerKm % 60;
  return `${mins}:${String(secs).padStart(2, '0')} /km`;
}

export function formatRouteDuration(durationSec: number): string {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return '0 min';
  const totalMinutes = Math.max(1, Math.round(durationSec / 60));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (hours === 0) return `${minutes} min`;
  return `${hours}h ${String(minutes).padStart(2, '0')}m`;
}

export function resolveProfileSpeedKmh(
  profile: RouteProfile | 'cycling',
  options?: RouteEngineOptions
): number {
  const normalized = normalizeRouteProfile(profile);
  if (normalized === 'running') {
    const candidate = options?.runningSpeedKmh;
    return candidate && Number.isFinite(candidate) && candidate > 0
      ? candidate
      : DEFAULT_RUNNING_SPEED_KMH;
  }
  if (normalized === 'road' && options?.cyclingSpeedKmh && Number.isFinite(options.cyclingSpeedKmh) && options.cyclingSpeedKmh > 0) {
    return options.cyclingSpeedKmh;
  }
  return ROUTE_PROFILE_META[normalized].defaultSpeedKmh;
}

/**
 * Local-first geodesic waypoint routing engine (instant offline fallback).
 */
export const DirectWaypointRouteEngine: RouteEngineAdapter = {
  id: 'direct-local',
  label: 'Direkt (Offline)',
  computeRoute(
    waypoints: readonly RouteWaypoint[],
    profile: RouteProfile | 'cycling',
    options?: RouteEngineOptions
  ): RoutePreview {
    const normalized = normalizeRouteProfile(profile);
    const speedKmh = resolveProfileSpeedKmh(normalized, options);
    const pacePerKmFormatted = formatRoutePacePerKm(speedKmh);

    if (waypoints.length === 0) {
      return {
        points: [],
        segmentDistancesKm: [],
        totalDistanceKm: 0,
        ascentM: 0,
        descentM: 0,
        maxSlope: 0,
        estimatedDurationSec: 0,
        estimatedSpeedKmh: speedKmh,
        pacePerKmFormatted,
        maneuvers: [],
        engineId: 'direct-local',
        elevationAvailable: false
      };
    }

    if (waypoints.length === 1) {
      return {
        points: [
          {
            lat: waypoints[0].lat,
            lng: waypoints[0].lng,
            ele: 0,
            dist: 0,
            slope: 0
          }
        ],
        segmentDistancesKm: [],
        totalDistanceKm: 0,
        ascentM: 0,
        descentM: 0,
        maxSlope: 0,
        estimatedDurationSec: 0,
        estimatedSpeedKmh: speedKmh,
        pacePerKmFormatted,
        maneuvers: [],
        engineId: 'direct-local',
        elevationAvailable: false
      };
    }

    const segmentDistancesKm: number[] = [];
    let totalDistanceKm = 0;

    for (let i = 1; i < waypoints.length; i++) {
      const segKm = haversineDistanceKm(waypoints[i - 1], waypoints[i]);
      segmentDistancesKm.push(segKm);
      totalDistanceKm += segKm;
    }

    const maxStepKm = Math.max(0.05, options?.maxSegmentStepKm ?? 0.25);
    const maxTotalPoints = Math.max(waypoints.length, options?.maxTotalPoints ?? 600);
    const effectiveStepKm =
      totalDistanceKm > 0
        ? Math.max(maxStepKm, totalDistanceKm / Math.max(1, maxTotalPoints - waypoints.length))
        : maxStepKm;

    const points: GPXPoint[] = [];
    let cumulativeMeters = 0;

    for (let i = 0; i < waypoints.length - 1; i++) {
      const start = waypoints[i];
      const end = waypoints[i + 1];
      const segKm = segmentDistancesKm[i];
      const steps = Math.max(1, Math.ceil(segKm / effectiveStepKm));

      for (let s = 0; s < steps; s++) {
        if (i > 0 && s === 0) continue;
        const t = s / steps;
        const lat = start.lat + (end.lat - start.lat) * t;
        const lng = start.lng + (end.lng - start.lng) * t;
        const distM = cumulativeMeters + segKm * 1000 * t;
        points.push({
          lat,
          lng,
          ele: 0,
          dist: Math.round(distM),
          slope: 0
        });
      }
      cumulativeMeters += segKm * 1000;
    }

    const last = waypoints[waypoints.length - 1];
    points.push({
      lat: last.lat,
      lng: last.lng,
      ele: 0,
      dist: Math.round(cumulativeMeters),
      slope: 0
    });

    const estimatedDurationSec =
      totalDistanceKm > 0 ? Math.round((totalDistanceKm / speedKmh) * 3600) : 0;

    return {
      points,
      segmentDistancesKm,
      totalDistanceKm: Number(totalDistanceKm.toFixed(3)),
      ascentM: 0,
      descentM: 0,
      maxSlope: 0,
      estimatedDurationSec,
      estimatedSpeedKmh: speedKmh,
      pacePerKmFormatted,
      maneuvers: [],
      engineId: 'direct-local',
      elevationAvailable: false
    };
  }
};

export function createRouteWaypoint(lat: number, lng: number, index: number): RouteWaypoint {
  return {
    id: `wp-${Date.now()}-${index}-${Math.random().toString(36).slice(2, 6)}`,
    lat: Number(lat.toFixed(6)),
    lng: Number(lng.toFixed(6))
  };
}

export function addRouteWaypoint(
  waypoints: readonly RouteWaypoint[],
  lat: number,
  lng: number
): RouteWaypoint[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [...waypoints];
  return [...waypoints, createRouteWaypoint(lat, lng, waypoints.length)];
}

export function moveRouteWaypoint(
  waypoints: readonly RouteWaypoint[],
  id: string,
  lat: number,
  lng: number
): RouteWaypoint[] {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return [...waypoints];
  return waypoints.map((wp) =>
    wp.id === id
      ? { ...wp, lat: Number(lat.toFixed(6)), lng: Number(lng.toFixed(6)) }
      : wp
  );
}

export function removeRouteWaypoint(
  waypoints: readonly RouteWaypoint[],
  id: string
): RouteWaypoint[] {
  return waypoints.filter((wp) => wp.id !== id);
}

export function reverseRouteWaypoints(
  waypoints: readonly RouteWaypoint[]
): RouteWaypoint[] {
  return [...waypoints].reverse();
}

export function closeRouteLoop(
  waypoints: readonly RouteWaypoint[]
): RouteWaypoint[] {
  if (waypoints.length < 2) return [...waypoints];
  const first = waypoints[0];
  const last = waypoints[waypoints.length - 1];
  if (haversineDistanceKm(first, last) < 0.015) {
    return [...waypoints];
  }
  return [...waypoints, createRouteWaypoint(first.lat, first.lng, waypoints.length)];
}

export function buildDefaultPlannedRouteName(
  profile: RouteProfile | 'cycling',
  distanceKm: number,
  language: 'de' | 'en' = 'de'
): string {
  const normalized = normalizeRouteProfile(profile);
  const formattedDist = `${distanceKm.toFixed(1)} km`;
  if (language === 'en') {
    if (normalized === 'running') return `Planned Run (${formattedDist})`;
    if (normalized === 'gravel') return `Gravel Route (${formattedDist})`;
    if (normalized === 'mtb') return `MTB Trail (${formattedDist})`;
    return `Road Ride (${formattedDist})`;
  }
  if (normalized === 'running') return `Geplanter Lauf (${formattedDist})`;
  if (normalized === 'gravel') return `Gravel-Tour (${formattedDist})`;
  if (normalized === 'mtb') return `MTB-Tour (${formattedDist})`;
  return `Rennrad-Tour (${formattedDist})`;
}

export function buildGpxTrackFromPlannedRoute(params: {
  waypoints: readonly RouteWaypoint[];
  profile: RouteProfile | 'cycling';
  customName?: string;
  language?: 'de' | 'en';
  color?: string;
  options?: RouteEngineOptions;
  engine?: RouteEngineAdapter;
  snappedPreview?: RoutePreview | null;
}): GPXTrack | null {
  const {
    waypoints,
    profile,
    customName,
    language = 'de',
    color,
    options,
    engine = DirectWaypointRouteEngine,
    snappedPreview
  } = params;

  if (waypoints.length < 2) return null;

  const normalized = normalizeRouteProfile(profile);
  const meta = ROUTE_PROFILE_META[normalized];
  const preview =
    snappedPreview && snappedPreview.points.length >= 2
      ? snappedPreview
      : engine.computeRoute(waypoints, normalized, options);

  const trimmedName = (customName || '').trim();
  const trackName =
    trimmedName || buildDefaultPlannedRouteName(normalized, preview.totalDistanceKm, language);

  const trackColor = color || meta.colorHex;
  const nowIso = new Date().toISOString();

  return {
    id: `planned-route-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: trackName,
    points: preview.points,
    color: trackColor,
    visible: true,
    distance: Number(preview.totalDistanceKm.toFixed(2)),
    ascent: Math.round(preview.ascentM || 0),
    descent: Math.round(preview.descentM || 0),
    maxSlope: Number((preview.maxSlope || 0).toFixed(1)),
    duration: preview.estimatedDurationSec,
    activityType: meta.activityType,
    routeManeuvers: preview.maneuvers.length > 0 ? preview.maneuvers : undefined,
    dateCreated: nowIso,
    tags: [meta.tagDe, 'Routenplaner', preview.engineId === 'valhalla' ? 'OSM-Routing' : 'Direkt'],
    description:
      language === 'en'
        ? `Created with ${meta.labelEn} Route Planner (${waypoints.length} waypoints, ${preview.totalDistanceKm.toFixed(2)} km${preview.ascentM > 0 ? `, +${Math.round(preview.ascentM)} m` : ''}).`
        : `Erstellt mit dem ${meta.labelDe}-Routenplaner (${waypoints.length} Wegpunkte, ${preview.totalDistanceKm.toFixed(2)} km${preview.ascentM > 0 ? `, +${Math.round(preview.ascentM)} hm` : ''}).`
  };
}
