
import React, { useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { MapContainer, Polyline, useMapEvents, useMap, Marker, Popup, Rectangle } from 'react-leaflet';
import L from 'leaflet';
import { GPXTrack, MapLayer, MAP_LAYERS, GPXPoint, TextMarker, TimeGap } from '../types';
import { calculateDistance, formatPace, getPaceString, formatGapDuration, getCachedSimplifiedPoints, findClimbs, downloadTrackAsGPX, hasRealGpsData } from '../utils/gpxUtils';
import { getApiUrl, apiFetch } from '../utils/api';
import { triggerHaptic } from '../utils/haptics';
import { computeHoverPointTelemetry } from '../domain/telemetry/pointMetricsEngine';
import { toValidTimestampMs } from '../domain/telemetry/safeTime';
import { buildMapHoverCardHtml } from './map/MapHoverTooltipCard';
import {
  buildTileCacheKey,
  getCachedTileBlob,
  putCachedTileBlob,
  getConfiguredTileCachePolicy
} from '../utils/tileCacheDb';
import { MapZoomControls } from './MapZoomControls';
import {
  computeNextZoom,
  FINE_ZOOM_STEP,
  MAP_MAX_ZOOM,
  MAP_MIN_ZOOM,
  ZoomStep
} from '../utils/mapZoom';
import { sanitizeHexColor } from '../utils/securityMiddleware';
import { Palette, Bike, Activity, Clock, TrendingUp, ChevronDown, ChevronUp, Target, Compass, Navigation, Maximize2, RefreshCw, Download, Sparkles, Keyboard, GitCompare, ArrowLeftRight, X, BarChart2, Flame } from 'lucide-react';

// Fix for default marker icons in Leaflet + React
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

const sanitizeColor = (col: string | undefined): string => {
  if (!col) return "#2563eb";
  const upper = col.toUpperCase();
  if (upper === '#FF00FF' || upper === '#FF1493' || upper === '#DB2777' || upper === '#EC4899') {
    return "#2563eb";
  }
  return col;
};

const getSurfaceColor = (surf: string, defaultColor: string = "#2563eb") => {
  const safeDefault = sanitizeColor(defaultColor);
  if (!surf) return safeDefault;
  const s = surf.toLowerCase().trim();
  
  if (s.includes("asphalt") || s.includes("paved") || s.includes("beton") || s.includes("straße") || s.includes("road")) {
    return "#2563eb"; // Royal Blue - Asphalt
  }
  if (s.includes("schotter") || s.includes("gravel") || s.includes("kies") || s.includes("compacted")) {
    return "#d97706"; // Amber / Gravel Brown
  }
  if (s.includes("waldweg") || s.includes("trail") || s.includes("singletrail") || s.includes("pfad") || s.includes("dirt") || s.includes("ground") || s.includes("earth") || s.includes("natur")) {
    return "#16a34a"; // Forest Green - Trail & Waldweg
  }
  if (s.includes("fahrradweg") || s.includes("radweg") || s.includes("cycleway")) {
    return "#0284c7"; // Sky Blue - Fahrradweg
  }
  if (s.includes("kopfstein") || s.includes("pflaster") || s.includes("cobblestone") || s.includes("sett")) {
    return "#805ad5"; // Purple / Bronze - Pflasterstein
  }
  if (s.includes("unbefestigt") || s.includes("unpaved") || s.includes("sand") || s.includes("matsch")) {
    return "#ca8a04"; // Gold-Brown - Unbefestigt
  }
  if (s.includes("unbekannt") || s.includes("unknown")) {
    return "#94a3b8"; // Neutral Slate - Unbekannt
  }
  return safeDefault;
};

const escapeHtml = (unsafe: string): string => {
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
};

const getBearing = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const lat1Rad = lat1 * Math.PI / 180;
  const lat2Rad = lat2 * Math.PI / 180;
  const y = Math.sin(dLng) * Math.cos(lat2Rad);
  const x = Math.cos(lat1Rad) * Math.sin(lat2Rad) - Math.sin(lat1Rad) * Math.cos(lat2Rad) * Math.cos(dLng);
  let brng = Math.atan2(y, x) * 180 / Math.PI;
  return (brng + 360) % 360;
};

interface MapProps {
  tracks: GPXTrack[];
  activeLayer: MapLayer;
  markedTrackId: string | null;
  onMarkTrack: (id: string) => void;
  hoveredPoint?: GPXPoint | null;
  onHoverPoint?: (point: GPXPoint | null) => void;
  selectionBounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null;
  onSelection: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void;
  mapView: {lat: number, lng: number, zoom: number, pitch?: number, bearing?: number};
  onMapViewChange: (view: {lat: number, lng: number, zoom: number, pitch: number, bearing: number}) => void;
  estimatedSpeed?: number;
  textMarkers: TextMarker[];
  onAddTextMarker: (marker: Omit<TextMarker, 'id'>) => void;
  onDeleteTextMarker: (id: string) => void;
  hideLegend?: boolean;
  ftp?: number;
  isDark?: boolean;
  onAnalyzeSurface?: (id: string, force?: boolean) => void;
  onOpenIntensiveAnalysis?: (id: string) => void;
  analyzingSurfaces?: Record<string, boolean>;
  surfaceAnalysisStatuses?: Record<string, any>;
  timeGaps?: TimeGap[];
  selectedGapId?: string | null;
  onSelectGap?: (gap: TimeGap) => void;
  onSplitGap?: (originalTrackId: string, splitIndex: number) => void;
  onCloseGap?: (originalTrackId: string, gap: TimeGap) => void;
  onOpenShortcuts?: () => void;
  compareTrackId?: string | null;
  onStartMapComparison?: (track1Id?: string, track2Id?: string) => void;
  onExitMapComparison?: () => void;
  onOpenComparisonModal?: () => void;
  isSidebarOpen?: boolean;
  isBottomBarObscuring?: boolean;
}

interface TrackSeriesPoint {
  lat: number;
  lng: number;
  ele?: number;
  speed?: number;
  hr?: number;
  power?: number;
  distKm: number;
  progress: number;
  elapsedSec: number;
}

interface TrackSeries {
  pts: TrackSeriesPoint[];
  totalDistKm: number;
}

function buildTrackSeries(track: GPXTrack | null | undefined): TrackSeries | null {
  if (!track || !track.points || track.points.length === 0) return null;
  const pts: TrackSeriesPoint[] = [];
  let totalDist = 0;
  const startMs = toValidTimestampMs(track.points[0]?.time);

  for (let i = 0; i < track.points.length; i++) {
    const p = track.points[i];
    if (!p) continue;
    const lat = typeof p.lat === 'number' ? p.lat : parseFloat(p.lat as any);
    const lng = typeof p.lng === 'number' ? p.lng : parseFloat(p.lng as any);
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) continue;
    if (Math.abs(lat) < 0.0001 && Math.abs(lng) < 0.0001) continue;

    if (pts.length > 0) {
      totalDist += calculateDistance(pts[pts.length - 1], { lat, lng });
    }
    const curMs = toValidTimestampMs(p.time);
    const elapsedSec = startMs !== undefined && curMs !== undefined ? Math.max(0, (curMs - startMs) / 1000) : 0;

    pts.push({
      lat,
      lng,
      ele: p.ele,
      speed: p.speed,
      hr: p.hr,
      power: p.power,
      distKm: totalDist,
      progress: 0,
      elapsedSec,
    });
  }

  if (pts.length === 0) return null;
  const denom = totalDist > 0 ? totalDist : 1;
  for (let i = 0; i < pts.length; i++) {
    pts[i].progress = totalDist > 0 ? pts[i].distKm / denom : (pts.length > 1 ? i / (pts.length - 1) : 0);
  }

  return {
    pts,
    totalDistKm: totalDist > 0 ? totalDist : (track.distance || 0),
  };
}

function findClosestSeriesPointByTarget(
  series: TrackSeries,
  mode: 'distance' | 'progress',
  targetValue: number
): TrackSeriesPoint | null {
  const { pts } = series;
  if (pts.length === 0) return null;
  if (pts.length === 1) return pts[0];

  const key = mode === 'distance' ? 'distKm' : 'progress';
  let lo = 0;
  let hi = pts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (pts[mid][key] < targetValue) {
      lo = mid + 1;
    } else {
      hi = mid;
    }
  }
  if (lo > 0) {
    const prevDiff = Math.abs(pts[lo - 1][key] - targetValue);
    const curDiff = Math.abs(pts[lo][key] - targetValue);
    if (prevDiff <= curDiff) return pts[lo - 1];
  }
  return pts[lo];
}

function findNearestSeriesPointToCoord(series: TrackSeries, lat: number, lng: number): TrackSeriesPoint | null {
  const { pts } = series;
  if (pts.length === 0) return null;
  let best = pts[0];
  let bestDiff = Infinity;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i];
    const diff = Math.abs(p.lat - lat) + Math.abs(p.lng - lng);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = p;
    }
  }
  return best;
}

function buildDualElevationSvgData(
  seriesA: TrackSeries | null,
  seriesB: TrackSeries | null,
  mode: 'distance' | 'progress'
): { pathA: string; areaA: string; pathB: string; areaB: string; minEle: number; maxEle: number } | null {
  if (!seriesA || !seriesB) return null;
  const elePtsA = seriesA.pts.filter(p => p.ele !== undefined && Number.isFinite(p.ele));
  const elePtsB = seriesB.pts.filter(p => p.ele !== undefined && Number.isFinite(p.ele));
  if (elePtsA.length < 2 && elePtsB.length < 2) return null;

  let minEle = Infinity;
  let maxEle = -Infinity;
  for (const p of elePtsA) {
    if (p.ele! < minEle) minEle = p.ele!;
    if (p.ele! > maxEle) maxEle = p.ele!;
  }
  for (const p of elePtsB) {
    if (p.ele! < minEle) minEle = p.ele!;
    if (p.ele! > maxEle) maxEle = p.ele!;
  }
  if (!Number.isFinite(minEle) || !Number.isFinite(maxEle)) return null;
  const span = Math.max(10, maxEle - minEle);

  const width = 360;
  const height = 74;
  const padY = 6;
  const usableH = height - padY * 2;
  const maxDist = Math.max(seriesA.totalDistKm, seriesB.totalDistKm, 0.01);

  const buildPath = (series: TrackSeries) => {
    const valid = series.pts.filter(p => p.ele !== undefined && Number.isFinite(p.ele));
    if (valid.length < 2) return { line: '', area: '' };
    const step = Math.max(1, Math.floor(valid.length / 90));
    const sampled: TrackSeriesPoint[] = [];
    for (let i = 0; i < valid.length; i += step) {
      sampled.push(valid[i]);
    }
    if (sampled[sampled.length - 1] !== valid[valid.length - 1]) {
      sampled.push(valid[valid.length - 1]);
    }

    const coords = sampled.map(p => {
      const xFrac = mode === 'distance' ? (p.distKm / maxDist) : p.progress;
      const x = Math.max(0, Math.min(width, xFrac * width));
      const y = height - padY - (((p.ele! - minEle) / span) * usableH);
      return { x: Number(x.toFixed(1)), y: Number(y.toFixed(1)) };
    });

    const line = coords.map((c, idx) => `${idx === 0 ? 'M' : 'L'}${c.x},${c.y}`).join(' ');
    const area = `${line} L${coords[coords.length - 1].x},${height} L${coords[0].x},${height} Z`;
    return { line, area };
  };

  const a = buildPath(seriesA);
  const b = buildPath(seriesB);
  return {
    pathA: a.line,
    areaA: a.area,
    pathB: b.line,
    areaB: b.area,
    minEle: Math.round(minEle),
    maxEle: Math.round(maxEle)
  };
}

const FocusGapController = ({ selectedGap }: { selectedGap: TimeGap | null }) => {
  const map = useMap();
  useEffect(() => {
    if (selectedGap) {
      map.flyTo([selectedGap.startPoint.lat, selectedGap.startPoint.lng], Math.max(15, map.getZoom()), {
        animate: true,
        duration: 0.8
      });
    }
  }, [selectedGap, map]);
  return null;
};

const TIGHT_FIT_PADDING: [number, number] = [16, 16];

function extractValidLatLngs(points: GPXPoint[] | undefined): [number, number][] {
  if (!points || points.length === 0) return [];
  const coords: [number, number][] = [];
  for (const p of points) {
    if (!p) continue;
    const latVal = typeof p.lat === 'number' ? p.lat : parseFloat(p.lat as any);
    const lngVal = typeof p.lng === 'number' ? p.lng : parseFloat(p.lng as any);
    if (Number.isFinite(latVal) && Number.isFinite(lngVal)) {
      coords.push([latVal, lngVal]);
    }
  }
  return coords;
}

function buildTracksBounds(targetTracks: GPXTrack[]): L.LatLngBounds | null {
  const allCoords: [number, number][] = [];
  for (const t of targetTracks) {
    if (!hasRealGpsData(t)) continue;
    const coords = extractValidLatLngs(t.points);
    for (const c of coords) {
      allCoords.push(c);
    }
  }
  if (allCoords.length === 0) return null;
  const bounds = L.latLngBounds(allCoords);
  return bounds.isValid() ? bounds : null;
}

function fitMapBoundsTight(map: L.Map, bounds: L.LatLngBounds | null, animate = false): void {
  if (!bounds || !bounds.isValid()) return;
  const container = map.getContainer();
  if (!container || container.clientWidth === 0 || container.clientHeight === 0) return;
  map.invalidateSize({ animate: false });
  map.fitBounds(bounds, {
    padding: TIGHT_FIT_PADDING,
    maxZoom: 18,
    animate
  });
}

const ZoomToTracks = ({ tracks, markedTrackId }: { tracks: GPXTrack[]; markedTrackId: string | null }) => {
  const map = useMap();
  const prevTrackIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    const visibleGpsTracks = tracks.filter(t => t.visible && hasRealGpsData(t));
    const currentIds = new Set(visibleGpsTracks.map(t => t.id));
    const addedTracks = visibleGpsTracks.filter(t => !prevTrackIdsRef.current.has(t.id));

    if (addedTracks.length > 0) {
      // Fit to newly added track(s) (or marked track among added ones if present) so existing distant tracks don't force zooming way out
      const targetTracks = addedTracks.length > 1 && markedTrackId
        ? (() => {
            const marked = addedTracks.find(t => t.id === markedTrackId);
            return marked && prevTrackIdsRef.current.size === 0 && addedTracks.length === 1 ? [marked] : addedTracks;
          })()
        : addedTracks;

      const bounds = buildTracksBounds(targetTracks);
      if (bounds) {
        fitMapBoundsTight(map, bounds, false);
        const timer = window.setTimeout(() => fitMapBoundsTight(map, bounds, false), 120);
        prevTrackIdsRef.current = currentIds;
        return () => window.clearTimeout(timer);
      }
    }

    prevTrackIdsRef.current = currentIds;
  }, [tracks, markedTrackId, map]);

  return null;
};

const ZoomToMarkedTrack = ({
  markedTrackId,
  compareTrackId,
  tracks
}: {
  markedTrackId: string | null;
  compareTrackId?: string | null;
  tracks: GPXTrack[];
}) => {
  const map = useMap();
  const prevPairRef = useRef<string>('');
  const tracksRef = useRef(tracks);
  const markedTrackIdRef = useRef(markedTrackId);
  const compareTrackIdRef = useRef(compareTrackId);
  const pendingBoundsRef = useRef<L.LatLngBounds | null>(null);

  tracksRef.current = tracks;
  markedTrackIdRef.current = markedTrackId;
  compareTrackIdRef.current = compareTrackId;

  useEffect(() => {
    const pairKey = `${markedTrackId || ''}|${compareTrackId || ''}`;
    if (markedTrackId && pairKey !== prevPairRef.current) {
      const trackA = tracks.find(t => t.id === markedTrackId);
      const trackB = compareTrackId ? tracks.find(t => t.id === compareTrackId && t.id !== markedTrackId) : null;
      const targets = [trackA, trackB].filter((t): t is GPXTrack => Boolean(t && hasRealGpsData(t)));

      if (targets.length > 0) {
        const bounds = buildTracksBounds(targets);
        if (bounds) {
          pendingBoundsRef.current = bounds;
          fitMapBoundsTight(map, bounds, true);
          const timer = window.setTimeout(() => fitMapBoundsTight(map, bounds, false), 340);
          prevPairRef.current = pairKey;
          return () => window.clearTimeout(timer);
        }
      }
    }
    prevPairRef.current = pairKey;
  }, [markedTrackId, compareTrackId, tracks, map]);

  useEffect(() => {
    let t1: number | undefined;
    let t2: number | undefined;

    const handleFitActiveTrackEvent = (evt: Event) => {
      const customEvt = evt as CustomEvent<{ minLat?: number; maxLat?: number; minLng?: number; maxLng?: number } | null>;
      const detail = customEvt?.detail;

      let bounds: L.LatLngBounds | null = null;
      if (
        detail &&
        typeof detail.minLat === 'number' &&
        typeof detail.maxLat === 'number' &&
        typeof detail.minLng === 'number' &&
        typeof detail.maxLng === 'number'
      ) {
        const candidate = L.latLngBounds(
          [detail.minLat, detail.minLng],
          [detail.maxLat, detail.maxLng]
        );
        if (candidate.isValid()) {
          bounds = candidate;
        }
      }

      if (!bounds) {
        const curTracks = tracksRef.current;
        const active = (markedTrackIdRef.current && curTracks.find(t => t.id === markedTrackIdRef.current && hasRealGpsData(t)))
          || null;
        const compared = (compareTrackIdRef.current && curTracks.find(t => t.id === compareTrackIdRef.current && t.id !== markedTrackIdRef.current && hasRealGpsData(t)))
          || null;
        const targets = [active, compared].filter((t): t is GPXTrack => Boolean(t));
        if (targets.length > 0) {
          bounds = buildTracksBounds(targets);
        } else {
          const visible = curTracks.filter(t => t.visible && hasRealGpsData(t));
          bounds = buildTracksBounds(visible);
        }
      }

      if (bounds) {
        pendingBoundsRef.current = bounds;
        fitMapBoundsTight(map, bounds, false);
        window.clearTimeout(t1);
        window.clearTimeout(t2);
        t1 = window.setTimeout(() => fitMapBoundsTight(map, bounds, false), 90);
        t2 = window.setTimeout(() => fitMapBoundsTight(map, bounds, false), 340);
      }
    };

    window.addEventListener('fit-active-track', handleFitActiveTrackEvent);
    return () => {
      window.clearTimeout(t1);
      window.clearTimeout(t2);
      window.removeEventListener('fit-active-track', handleFitActiveTrackEvent);
    };
  }, [map]);

  return null;
};

const ZoomToActiveTrack = ({ activeTrack, comparedTrack, recenterTrigger }: { activeTrack: GPXTrack | null; comparedTrack?: GPXTrack | null; recenterTrigger: number }) => {
  const map = useMap();

  useEffect(() => {
    const targets = [activeTrack, comparedTrack].filter((t): t is GPXTrack => Boolean(t && hasRealGpsData(t)));
    if (targets.length > 0 && recenterTrigger > 0) {
      const bounds = buildTracksBounds(targets);
      fitMapBoundsTight(map, bounds, true);
    }
  }, [recenterTrigger, activeTrack, comparedTrack, map]);

  return null;
};

const ZoomToSelection = ({ bounds }: { bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      const b = L.latLngBounds(
        [bounds.minLat, bounds.minLng],
        [bounds.maxLat, bounds.maxLng]
      );
      fitMapBoundsTight(map, b, true);
    }
  }, [bounds, map]);
  return null;
};

const MapResizer = ({ markedTrackId, compareTrackId, tracksLength, tracks }: { markedTrackId: string | null; compareTrackId?: string | null; tracksLength: number; tracks: GPXTrack[] }) => {
  const map = useMap();
  const wasZeroSizeRef = useRef<boolean>(false);
  const tracksRef = useRef(tracks);
  const markedTrackIdRef = useRef(markedTrackId);
  const compareTrackIdRef = useRef(compareTrackId);

  tracksRef.current = tracks;
  markedTrackIdRef.current = markedTrackId;
  compareTrackIdRef.current = compareTrackId;

  useEffect(() => {
    // Wait for CSS transitions (like the elevation profile opening) to finish
    const timeout = setTimeout(() => {
      map.invalidateSize();
    }, 300);

    const handleResize = () => {
      map.invalidateSize();
    };

    window.addEventListener('resize', handleResize);
    window.addEventListener('orientationchange', handleResize);

    const container = map.getContainer();
    if (container && (container.clientWidth === 0 || container.clientHeight === 0)) {
      wasZeroSizeRef.current = true;
    }

    let ro: ResizeObserver | null = null;
    if (typeof ResizeObserver !== 'undefined' && container) {
      ro = new ResizeObserver((entries) => {
        const entry = entries[0];
        const w = entry?.contentRect?.width ?? container.clientWidth;
        const h = entry?.contentRect?.height ?? container.clientHeight;
        map.invalidateSize({ animate: false });

        if (wasZeroSizeRef.current && w > 0 && h > 0) {
          wasZeroSizeRef.current = false;
          const curTracks = tracksRef.current;
          const marked = markedTrackIdRef.current
            ? curTracks.find(t => t.id === markedTrackIdRef.current && hasRealGpsData(t))
            : null;
          const compared = compareTrackIdRef.current
            ? curTracks.find(t => t.id === compareTrackIdRef.current && t.id !== markedTrackIdRef.current && hasRealGpsData(t))
            : null;
          const pairTargets = [marked, compared].filter((t): t is GPXTrack => Boolean(t));
          const target = pairTargets.length > 0 ? pairTargets : curTracks.filter(t => t.visible && hasRealGpsData(t));
          const bounds = buildTracksBounds(target);
          if (bounds) {
            setTimeout(() => fitMapBoundsTight(map, bounds, false), 40);
          }
        } else if (w === 0 || h === 0) {
          wasZeroSizeRef.current = true;
        }
      });
      ro.observe(container);
    }

    return () => {
      clearTimeout(timeout);
      window.removeEventListener('resize', handleResize);
      window.removeEventListener('orientationchange', handleResize);
      if (ro) ro.disconnect();
    };
  }, [markedTrackId, compareTrackId, tracksLength, map]);
  return null;
};

const LeafletZoomBridge = ({
  mapRef,
  pendingZoomRef,
  onZoomChange
}: {
  mapRef: React.MutableRefObject<L.Map | null>;
  pendingZoomRef: React.MutableRefObject<number | null>;
  onZoomChange: (zoom: number) => void;
}) => {
  const map = useMap();

  useEffect(() => {
    mapRef.current = map;
    onZoomChange(map.getZoom());
    return () => {
      if (mapRef.current === map) {
        mapRef.current = null;
      }
    };
  }, [map, mapRef, onZoomChange]);

  useMapEvents({
    zoom: () => {
      onZoomChange(map.getZoom());
    },
    zoomend: () => {
      pendingZoomRef.current = null;
      onZoomChange(map.getZoom());
    }
  });

  return null;
};

const SyncView = ({ mapView, onMapViewChange }: { mapView: any, onMapViewChange: any }) => {
  const map = useMap();
  const lastEmittedView = useRef<{ lat: number; lng: number; zoom: number } | null>(null);
  const lastPropView = useRef<{ lat: number; lng: number; zoom: number } | null>(null);

  // Sync external changes from props to Leaflet map (only when external props genuinely change from outside)
  useEffect(() => {
    const propChanged = !lastPropView.current ||
      Math.abs(lastPropView.current.lat - mapView.lat) > 0.00001 ||
      Math.abs(lastPropView.current.lng - mapView.lng) > 0.00001 ||
      Math.abs(lastPropView.current.zoom - mapView.zoom) > 0.05;

    if (!propChanged) return;

    lastPropView.current = { lat: mapView.lat, lng: mapView.lng, zoom: mapView.zoom };

    // Check if the current map state is significantly different
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();

    const centerChanged =
      Math.abs(currentCenter.lat - mapView.lat) > 0.0001 ||
      Math.abs(currentCenter.lng - mapView.lng) > 0.0001;
    const zoomChanged = Math.abs(currentZoom - mapView.zoom) > 0.05;

    const isDifferentFromMap = centerChanged || zoomChanged;

    // Guard against echo loops where the prop is merely reflecting the map's own emitted view
    const isReflectionOfEmission = lastEmittedView.current &&
      Math.abs(lastEmittedView.current.lat - mapView.lat) < 0.0001 &&
      Math.abs(lastEmittedView.current.lng - mapView.lng) < 0.0001 &&
      Math.abs(lastEmittedView.current.zoom - mapView.zoom) < 0.05;

    if (isDifferentFromMap && !isReflectionOfEmission) {
      if (!centerChanged && zoomChanged) {
        map.setZoom(mapView.zoom, { animate: true });
      } else {
        map.setView([mapView.lat, mapView.lng], mapView.zoom, { animate: false });
      }
    }
  }, [mapView.lat, mapView.lng, mapView.zoom, map]);

  const handleMapChange = useCallback(() => {
    const center = map.getCenter();
    const zoom = map.getZoom();

    const isSignificant = !lastEmittedView.current ||
      Math.abs(center.lat - lastEmittedView.current.lat) > 0.00001 ||
      Math.abs(center.lng - lastEmittedView.current.lng) > 0.00001 ||
      Math.abs(zoom - lastEmittedView.current.zoom) > 0.02;

    if (isSignificant) {
      lastEmittedView.current = { lat: center.lat, lng: center.lng, zoom };
      lastPropView.current = { lat: center.lat, lng: center.lng, zoom };
      onMapViewChange({
        lat: center.lat,
        lng: center.lng,
        zoom: zoom,
        pitch: 0,
        bearing: 0
      });
    }
  }, [map, onMapViewChange]);

  useMapEvents({
    moveend: handleMapChange,
    zoomend: handleMapChange
  });

  return null;
};

const SelectionTool = ({ active, onSelection, currentBounds }: { active: boolean, onSelection: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void, currentBounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null }) => {
  const map = useMap();
  const [startPoint, setStartPoint] = useState<L.LatLng | null>(null);
  const [currentPoint, setCurrentPoint] = useState<L.LatLng | null>(null);

  useEffect(() => {
    if (!active) {
      setStartPoint(null);
      setCurrentPoint(null);
      map.dragging.enable();
    }
  }, [active, map]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (active && (e.key === 'Alt' || e.key === 'Shift')) {
        map.dragging.disable();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (active && (e.key === 'Alt' || e.key === 'Shift')) {
        map.dragging.enable();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [active, map]);

  useMapEvents({
    mousedown(e) {
      if (!active) return;
      const isModifier = e.originalEvent.altKey || e.originalEvent.shiftKey;
      if (!isModifier) return;
      
      map.dragging.disable();
      setStartPoint(e.latlng);
      setCurrentPoint(e.latlng);
      onSelection(null);
    },
    mousemove(e) {
      if (!active || !startPoint) return;
      setCurrentPoint(e.latlng);
    },
    mouseup(e) {
      if (!active || !startPoint) return;
      const bounds = L.latLngBounds(startPoint, currentPoint!);
      onSelection({
        minLat: bounds.getSouth(),
        maxLat: bounds.getNorth(),
        minLng: bounds.getWest(),
        maxLng: bounds.getEast()
      });
      setStartPoint(null);
      setCurrentPoint(null);
      
      if (!e.originalEvent.altKey && !e.originalEvent.shiftKey) {
        map.dragging.enable();
      }
    }
  });

  const renderBounds = startPoint && currentPoint 
    ? L.latLngBounds(startPoint, currentPoint) 
    : currentBounds 
      ? L.latLngBounds([currentBounds.minLat, currentBounds.minLng], [currentBounds.maxLat, currentBounds.maxLng]) 
      : null;

  return (
    <>
      {renderBounds && (
        <Rectangle bounds={renderBounds} pathOptions={{ color: '#4f46e5', weight: 2, fillOpacity: 0.2, dashArray: '5, 5' }} />
      )}
    </>
  );
};

const LeafletMapContainer = MapContainer as any;
const LeafletPolyline = Polyline as any;
const LeafletMarker = Marker as any;

const CachedLeafletTileLayer: React.FC<{
  layerId: string;
  url: string;
  attribution: string;
  maxZoom?: number;
  maxNativeZoom?: number;
}> = ({ layerId, url, attribution, maxZoom = 20, maxNativeZoom = 19 }) => {
  const map = useMap();

  useEffect(() => {
    if (!map) return;

    const CachedTileLayerClass = L.TileLayer.extend({
      createTile(this: L.TileLayer, coords: L.Coords, done: L.DoneCallback) {
        const tile = document.createElement('img') as HTMLImageElement & {
          __cachedObjectUrl?: string;
          __aborted?: boolean;
        };
        tile.alt = '';
        tile.setAttribute('role', 'presentation');

        const tileUrl = this.getTileUrl(coords);
        const cacheKey = buildTileCacheKey(layerId, tileUrl);

        const loadViaDirectImg = () => {
          if (tile.__aborted) return;
          tile.onload = () => done(undefined, tile);
          tile.onerror = () => done(new Error(`Tile load failed: ${tileUrl}`), tile);
          tile.src = tileUrl;
        };

        const loadFromBlob = (blob: Blob) => {
          if (tile.__aborted) return;
          try {
            const objUrl = URL.createObjectURL(blob);
            tile.__cachedObjectUrl = objUrl;
            tile.onload = () => done(undefined, tile);
            tile.onerror = () => {
              URL.revokeObjectURL(objUrl);
              tile.__cachedObjectUrl = undefined;
              loadViaDirectImg();
            };
            tile.src = objUrl;
          } catch {
            loadViaDirectImg();
          }
        };

        const policy = getConfiguredTileCachePolicy();
        if (!policy.enabled) {
          if (typeof navigator !== 'undefined' && navigator.onLine === false) {
            done(new Error('Offline & tile cache disabled'), tile);
            return tile;
          }
          loadViaDirectImg();
          return tile;
        }

        getCachedTileBlob(cacheKey)
          .then(async (cachedBlob) => {
            if (tile.__aborted) return;
            if (cachedBlob) {
              loadFromBlob(cachedBlob);
              return;
            }

            if (typeof navigator !== 'undefined' && navigator.onLine === false) {
              done(new Error('Offline & tile not in cache'), tile);
              return;
            }

            try {
              const res = await fetch(tileUrl, { mode: 'cors', credentials: 'omit' });
              if (res.ok) {
                const fetchedBlob = await res.blob();
                if (fetchedBlob && fetchedBlob.size > 0 && fetchedBlob.type.startsWith('image/')) {
                  const activePolicy = getConfiguredTileCachePolicy();
                  if (activePolicy.enabled) {
                    void putCachedTileBlob(
                      cacheKey,
                      layerId,
                      tileUrl,
                      fetchedBlob,
                      activePolicy.maxBytes,
                      activePolicy.maxCount
                    );
                  }
                  loadFromBlob(fetchedBlob);
                  return;
                }
              }
            } catch {
              // CORS blocked or transient fetch issue -> fall back to standard <img> loading
            }

            loadViaDirectImg();
          })
          .catch(() => {
            loadViaDirectImg();
          });

        return tile;
      }
    });

    const tileLayerInstance: L.TileLayer = new (CachedTileLayerClass as any)(url, {
      attribution,
      maxZoom,
      maxNativeZoom
    });

    const handleTileUnload = (ev: L.TileEvent) => {
      const tileEl = ev.tile as (HTMLElement & { __cachedObjectUrl?: string; __aborted?: boolean }) | undefined;
      if (!tileEl) return;
      tileEl.__aborted = true;
      if (tileEl.__cachedObjectUrl) {
        URL.revokeObjectURL(tileEl.__cachedObjectUrl);
        tileEl.__cachedObjectUrl = undefined;
      }
    };

    tileLayerInstance.on('tileunload', handleTileUnload);
    tileLayerInstance.addTo(map);

    return () => {
      tileLayerInstance.off('tileunload', handleTileUnload);
      if (map.hasLayer(tileLayerInstance)) {
        map.removeLayer(tileLayerInstance);
      }
    };
  }, [map, layerId, url, attribution, maxZoom, maxNativeZoom]);

  return null;
};

interface POI {
  id: string;
  lat: number;
  lng: number;
  type: 'water' | 'supermarket' | 'restaurant' | 'gas_station';
  name: string;
  distanceAlongTrack: number; // in km
  details: string;
}

const Map: React.FC<MapProps> = ({ 
  tracks, 
  activeLayer, 
  markedTrackId, 
  onMarkTrack, 
  hoveredPoint, 
  onHoverPoint, 
  selectionBounds, 
  onSelection, 
  mapView, 
  onMapViewChange, 
  estimatedSpeed = 15, 
  textMarkers,
  onAddTextMarker,
  onDeleteTextMarker,
  hideLegend = false,
  ftp = 250,
  isDark = false,
  onAnalyzeSurface,
  onOpenIntensiveAnalysis,
  analyzingSurfaces,
  surfaceAnalysisStatuses,
  timeGaps = [],
  selectedGapId,
  onSelectGap,
  onSplitGap,
  onCloseGap,
  onOpenShortcuts,
  compareTrackId = null,
  onStartMapComparison,
  onExitMapComparison,
  onOpenComparisonModal,
  isSidebarOpen = false,
  isBottomBarObscuring = false
}) => {
  const layer = MAP_LAYERS[activeLayer];
  const [pendingMarker, setPendingMarker] = useState<{lat: number, lng: number} | null>(null);
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);
  const [isLegendVisible, setIsLegendVisible] = useState(false);
  const [colorMode, setColorMode] = useState<'default' | 'surface' | 'hr' | 'power' | 'speed'>('surface');
  const [isStatsCollapsed, setIsStatsCollapsed] = useState(true);
  const [isCompareCollapsed, setIsCompareCollapsed] = useState(false);
  const [compareSyncMode, setCompareSyncMode] = useState<'distance' | 'progress'>('distance');
  const [compareScrubFraction, setCompareScrubFraction] = useState<number | null>(null);
  const [recenterTrigger, setRecenterTrigger] = useState(0);
  const [isQuickShortcutsOpen, setIsQuickShortcutsOpen] = useState(false);
  const leafletMapRef = useRef<L.Map | null>(null);
  const pendingZoomRef = useRef<number | null>(null);
  const [liveZoom, setLiveZoom] = useState<number>(mapView.zoom);

  useEffect(() => {
    if (Number.isFinite(mapView.zoom)) {
      setLiveZoom(mapView.zoom);
    }
  }, [mapView.zoom]);

  const handleZoomStep = useCallback(
    (direction: 'in' | 'out', step: ZoomStep) => {
      const map = leafletMapRef.current;
      const baseZoom =
        pendingZoomRef.current ??
        (map ? map.getZoom() : liveZoom);
      const nextZoom = computeNextZoom(baseZoom, direction, step, MAP_MIN_ZOOM, MAP_MAX_ZOOM);
      pendingZoomRef.current = nextZoom;
      setLiveZoom(nextZoom);
      if (map) {
        map.setZoom(nextZoom, { animate: true });
      } else {
        onMapViewChange({
          lat: mapView.lat,
          lng: mapView.lng,
          zoom: nextZoom,
          pitch: mapView.pitch ?? 0,
          bearing: mapView.bearing ?? 0
        });
      }
    },
    [liveZoom, mapView, onMapViewChange]
  );

  // Auto-close Karten-Optionen when sidebar opens or Escape is pressed
  useEffect(() => {
    if (isSidebarOpen) {
      setIsColorMenuOpen(false);
    }
  }, [isSidebarOpen]);

  useEffect(() => {
    if (!isColorMenuOpen && !isQuickShortcutsOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsColorMenuOpen(false);
        setIsQuickShortcutsOpen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isColorMenuOpen, isQuickShortcutsOpen]);

  // Personal Lifetime Heatmap state (Veloviewer / Strava style)
  const [showLifetimeHeatmap, setShowLifetimeHeatmap] = useState(false);
  const [heatmapSportFilter, setHeatmapSportFilter] = useState<'all' | 'cycling' | 'running'>('all');
  const [heatmapTracks, setHeatmapTracks] = useState<Array<{ id: string; sport: string; coords: [number, number][] }>>([]);
  const [heatmapLoading, setHeatmapLoading] = useState(false);

  useEffect(() => {
    if (!showLifetimeHeatmap || heatmapTracks.length > 0) return;
    let cancelled = false;
    setHeatmapLoading(true);
    apiFetch('/api/activities/heatmap-tracks?limit=180')
      .then(res => (res.ok ? res.json() : { tracks: [] }))
      .then(data => {
        if (!cancelled && Array.isArray(data?.tracks)) {
          const normalized = data.tracks
            .map((t: any, idx: number) => {
              const rawCoords = Array.isArray(t?.coords) ? t.coords : Array.isArray(t?.points) ? t.points : [];
              const validCoords = rawCoords.filter(
                (pt: any): pt is [number, number] =>
                  Array.isArray(pt) && pt.length >= 2 && Number.isFinite(pt[0]) && Number.isFinite(pt[1])
              );
              return {
                id: String(t?.id ?? `ht-${idx}`),
                sport: String(t?.sport ?? 'cycling'),
                coords: validCoords
              };
            })
            .filter((t: { coords: [number, number][] }) => t.coords.length >= 2);
          setHeatmapTracks(normalized);
        }
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setHeatmapLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [showLifetimeHeatmap, heatmapTracks.length]);

  const filteredHeatmapTracks = useMemo(() => {
    if (!showLifetimeHeatmap) return [];
    return heatmapTracks.filter(t => {
      if (!Array.isArray(t.coords) || t.coords.length < 2) return false;
      if (heatmapSportFilter === 'all') return true;
      const s = (t.sport || '').toLowerCase();
      if (heatmapSportFilter === 'cycling') return s.includes('rad') || s.includes('cycl') || s.includes('bike') || s.includes('ride') || s.includes('mtb') || s.includes('gravel');
      if (heatmapSportFilter === 'running') return s.includes('lauf') || s.includes('run') || s.includes('jog') || s.includes('trail');
      return true;
    });
  }, [showLifetimeHeatmap, heatmapTracks, heatmapSportFilter]);

  // Local state for POI options (disabled by default for a clean, distraction-free map)
  const [showPOIs, setShowPOIs] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('gpx_show_pois');
      return saved === 'true'; // false by default
    } catch (e) {
      return false;
    }
  });
  const [poiFilters, setPoiFilters] = useState<Record<'water' | 'supermarket' | 'restaurant' | 'gas_station', boolean>>({
    water: true,
    supermarket: true,
    restaurant: true,
    gas_station: true,
  });

  // Deterministic POI Generator along active/visible routes
  const poiList = useMemo(() => {
    if (!showPOIs) return [];
    const list: POI[] = [];
    const visibleTracks = tracks.filter(t => t.visible && hasRealGpsData(t));

    visibleTracks.forEach((track, trackIdx) => {
      const points = track.points;
      const n = points.length;
      if (n < 5) return;

      // 1. Compute cumulative distance at each point
      const cumulativeDistances: number[] = new Array(n);
      cumulativeDistances[0] = 0;
      for (let i = 1; i < n; i++) {
        cumulativeDistances[i] = cumulativeDistances[i - 1] + calculateDistance(points[i - 1], points[i]);
      }
      const totalDist = cumulativeDistances[n - 1];

      // 2. Determine how many POIs to generate based on distance
      const targets: { km: number; type: 'water' | 'supermarket' | 'restaurant' | 'gas_station' }[] = [];
      
      if (totalDist > 0) {
        // Water points every ~12 km
        for (let km = 6; km < totalDist; km += 12) {
          targets.push({ km, type: 'water' });
        }
        // Supermarkets / Bakeries every ~15 km
        for (let km = 10; km < totalDist; km += 15) {
          targets.push({ km, type: 'supermarket' });
        }
        // Restaurants / Biergärten every ~20 km
        for (let km = 16; km < totalDist; km += 20) {
          targets.push({ km, type: 'restaurant' });
        }
        // Gas stations / Kiosks every ~25 km
        for (let km = 22; km < totalDist; km += 25) {
          targets.push({ km, type: 'gas_station' });
        }
      }

      // If very short track (< 8km), ensure at least one water point in the middle
      if (totalDist > 1 && targets.length === 0) {
        targets.push({ km: totalDist / 2, type: 'water' });
      }

      // For each target, find the closest point along the track
      targets.forEach((target, targetIdx) => {
        let bestIdx = 0;
        let minDiff = Infinity;
        for (let i = 0; i < n; i++) {
          const diff = Math.abs(cumulativeDistances[i] - target.km);
          if (diff < minDiff) {
            minDiff = diff;
            bestIdx = i;
          }
        }

        const basePt = points[bestIdx];
        
        // Let's shift it slightly so it doesn't sit exactly on the line (approx 15-20 meters)
        const angle = (bestIdx * 17 + targetIdx * 43) % 360;
        const rad = angle * Math.PI / 180;
        const latShift = Math.sin(rad) * 0.00018;
        const lngShift = Math.cos(rad) * 0.00018;

        const lat = basePt.lat + latShift;
        const lng = basePt.lng + lngShift;

        // Generate deterministic name and details based on target type
        let name = '';
        let details = '';
        const indexSeed = (bestIdx + track.name.charCodeAt(0)) % 4;

        if (target.type === 'water') {
          const waterNames = [
            "Öffentlicher Trinkwasserbrunnen",
            "Quellwasser-Raststelle",
            "Trinkwasserstelle Friedhofspforte",
            "Naturquelle Trinkwasser"
          ];
          const waterDetails = [
            "Kostenloses frisches Trinkwasser zum Auffüllen deiner Trinkflaschen. 24/7 in Betrieb.",
            "Kühles, sauberes Quellwasser direkt am Wegesrand. Perfekte Erfrischung.",
            "Außenwasserhahn an der Friedhofsmauer, ideal für Radler & Läufer zum Auffüllen der Flaschen.",
            "Natürlicher Trinkwasser-Auslauf. Flaschen können direkt unter dem Strahl befüllt werden."
          ];
          name = waterNames[indexSeed];
          details = waterDetails[indexSeed];
        } else if (target.type === 'supermarket') {
          const shopNames = [
            "Bäckerei & Café am Weg",
            "REWE City Markt",
            "Landbäckerei Dorfmitte",
            "Netto Marken-Discount"
          ];
          const shopDetails = [
            "Belegte Brötchen, frischer Kaffee, süße Teilchen & schattige Plätze im Freien.",
            "Supermarkt mit großem Sortiment. Perfekt für kühle Getränke, Bananen & Riegel-Nachschub.",
            "Traditioneller Bäcker mit Kaffeebar. Steckdosen zum Laden deines Handys oder Garmin vorhanden.",
            "Supermarkt ideal für einen schnellen, günstigen Snack-Stopp. Sitzgelegenheiten im Schatten."
          ];
          name = shopNames[indexSeed];
          details = shopDetails[indexSeed];
        } else if (target.type === 'restaurant') {
          const restNames = [
            "Radler-Biergarten Zum Lindenbaum",
            "Waldgasthof Schenke",
            "Pizzeria Ristorante Da Luigi",
            "Ausflugs-Café Sonnenschein"
          ];
          const restDetails = [
            "Traditioneller, radlerfreundlicher Biergarten mit WCs, fahrradsichtigen Plätzen & warmen Speisen.",
            "Deftige Brotzeiten, Kuchen, alkoholfreies Weizenbier & schattiger Gastgarten direkt an der Route.",
            "Ideal für den großen Hunger. Leckere Pasta & Pizza für volles Carbo-Loading.",
            "Süße Kuchenauswahl, Kaffeespezialitäten & eine fantastische Außenterrasse mit Radständer."
          ];
          name = restNames[indexSeed];
          details = restDetails[indexSeed];
        } else if (target.type === 'gas_station') {
          const gasNames = [
            "Aral Tankstelle & Bistro",
            "Shell Express-Station",
            "Regionales Schlauch- & Getränke-Karussell",
            "Esso Tankstelle"
          ];
          const gasDetails = [
            "Bistro, WCs & Kompressor-Luftstation zum schnellen Aufpumpen der Reifen. Snacks & Kaffee.",
            "24h-Kiosk mit kühlen Getränken, Energieriegeln & sanitären Einrichtungen.",
            "24h Verkaufsautomat für eiskalte Radler-Schorlen und gängige Fahrradschläuche (Schwalbe).",
            "Gut sortiertes Tankstellen-Bistro mit frischen Backwaren, Toiletten & Luftpumpe."
          ];
          name = gasNames[indexSeed];
          details = gasDetails[indexSeed];
        }

        list.push({
          id: `poi-${track.id}-${trackIdx}-${target.type}-${bestIdx}-${targetIdx}`,
          lat,
          lng,
          type: target.type,
          name,
          distanceAlongTrack: cumulativeDistances[bestIdx],
          details
        });
      });
    });

    return list;
  }, [tracks, calculateDistance, showPOIs]);

  const visiblePOIs = useMemo(() => {
    if (!showPOIs) return [];
    return poiList.filter(poi => poiFilters[poi.type]);
  }, [poiList, showPOIs, poiFilters]);

  useEffect(() => {
    if (markedTrackId) {
      setRecenterTrigger(prev => prev + 1);
    }
  }, [markedTrackId]);

  const activeTrack = useMemo(() => {
    if (markedTrackId) {
      return tracks.find(t => t.id === markedTrackId) || null;
    }
    return tracks.find(t => t.visible) || null;
  }, [tracks, markedTrackId]);

  const comparedTrack = useMemo(() => {
    if (!compareTrackId) return null;
    return tracks.find(t => t.id === compareTrackId && t.id !== activeTrack?.id) || null;
  }, [tracks, compareTrackId, activeTrack]);

  const isComparisonMode = Boolean(activeTrack && comparedTrack && activeTrack.id !== comparedTrack.id);

  useEffect(() => {
    if (!isComparisonMode) {
      setCompareScrubFraction(null);
    } else {
      setIsCompareCollapsed(false);
    }
  }, [isComparisonMode, compareTrackId]);

  const seriesA = useMemo(() => (isComparisonMode ? buildTrackSeries(activeTrack) : null), [isComparisonMode, activeTrack]);
  const seriesB = useMemo(() => (isComparisonMode ? buildTrackSeries(comparedTrack) : null), [isComparisonMode, comparedTrack]);

  const dualElevationChart = useMemo(
    () => buildDualElevationSvgData(seriesA, seriesB, compareSyncMode),
    [seriesA, seriesB, compareSyncMode]
  );

  const syncedComparisonPair = useMemo(() => {
    if (!isComparisonMode || !seriesA || !seriesB) return null;

    let ptA: TrackSeriesPoint | null = null;
    let ptB: TrackSeriesPoint | null = null;
    let activeFraction: number | null = compareScrubFraction;

    if (activeFraction !== null) {
      if (compareSyncMode === 'progress') {
        ptA = findClosestSeriesPointByTarget(seriesA, 'progress', activeFraction);
        ptB = findClosestSeriesPointByTarget(seriesB, 'progress', activeFraction);
      } else {
        const maxDist = Math.max(seriesA.totalDistKm, seriesB.totalDistKm, 0.01);
        const targetKm = activeFraction * maxDist;
        ptA = findClosestSeriesPointByTarget(seriesA, 'distance', targetKm);
        ptB = findClosestSeriesPointByTarget(seriesB, 'distance', targetKm);
      }
    } else if (hoveredPoint) {
      const hoveredId = (hoveredPoint as any).trackId;
      const onB = hoveredId && comparedTrack && hoveredId === comparedTrack.id;
      const sourceSeries = onB ? seriesB : seriesA;
      const hoveredPt = findNearestSeriesPointToCoord(sourceSeries, hoveredPoint.lat, hoveredPoint.lng);
      if (hoveredPt) {
        if (compareSyncMode === 'progress') {
          activeFraction = hoveredPt.progress;
          ptA = findClosestSeriesPointByTarget(seriesA, 'progress', hoveredPt.progress);
          ptB = findClosestSeriesPointByTarget(seriesB, 'progress', hoveredPt.progress);
        } else {
          const maxDist = Math.max(seriesA.totalDistKm, seriesB.totalDistKm, 0.01);
          activeFraction = hoveredPt.distKm / maxDist;
          ptA = findClosestSeriesPointByTarget(seriesA, 'distance', hoveredPt.distKm);
          ptB = findClosestSeriesPointByTarget(seriesB, 'distance', hoveredPt.distKm);
        }
      }
    }

    if (!ptA || !ptB || activeFraction === null) return null;
    const spatialGapKm = calculateDistance(ptA, ptB);
    const eleDiffM = ptA.ele !== undefined && ptB.ele !== undefined ? Math.round(ptA.ele - ptB.ele) : null;
    return {
      ptA,
      ptB,
      fraction: Math.max(0, Math.min(1, activeFraction)),
      spatialGapKm,
      eleDiffM,
      midLat: (ptA.lat + ptB.lat) / 2,
      midLng: (ptA.lng + ptB.lng) / 2
    };
  }, [isComparisonMode, seriesA, seriesB, compareScrubFraction, compareSyncMode, hoveredPoint, comparedTrack]);

  const movingTimeSecs = useMemo(() => {
    if (!activeTrack) return 0;
    return activeTrack.duration 
      ? activeTrack.duration 
      : (activeTrack.distance / estimatedSpeed) * 3600;
  }, [activeTrack, estimatedSpeed]);

  const comparedMovingTimeSecs = useMemo(() => {
    if (!comparedTrack) return 0;
    return comparedTrack.duration
      ? comparedTrack.duration
      : (comparedTrack.distance / estimatedSpeed) * 3600;
  }, [comparedTrack, estimatedSpeed]);

  const formatDurationText = (secs: number) => {
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = Math.round(secs % 60);
    if (h > 0) {
      return `${h} Std. ${m} Min.`;
    }
    if (m > 0) {
      return `${m} Min.`;
    }
    return `${s} Sek.`;
  };

  const hrZones = useMemo(() => {
    let baseZones = [
      { key: 'KB', color: '#3b82f6', min: 96, max: 112 },
      { key: 'GA1', color: '#10b981', min: 112, max: 136 },
      { key: 'GA2', color: '#eab308', min: 136, max: 152 },
      { key: 'EB', color: '#f97316', min: 152, max: 168 },
      { key: 'SB', color: '#ef4444', min: 168, max: 250 }
    ];
    try {
      const saved = localStorage.getItem('velo_hr_zones');
      if (saved) {
        const parsed = JSON.parse(saved);
        if (Array.isArray(parsed) && parsed.length >= 5) {
          baseZones = parsed.map((z: any) => ({
            key: z.key,
            color: z.color,
            min: z.min,
            max: z.max
          }));
        }
      }
    } catch (e) {}
    return baseZones;
  }, []);

  const powerZones = useMemo(() => {
    return [
      { key: 'KB', color: '#3b82f6', min: 0, max: 0.55 * ftp },
      { key: 'GA1', color: '#10b981', min: 0.55 * ftp, max: 0.75 * ftp },
      { key: 'GA2', color: '#eab308', min: 0.75 * ftp, max: 0.90 * ftp },
      { key: 'EB', color: '#f97316', min: 0.90 * ftp, max: 1.05 * ftp },
      { key: 'SB', color: '#ef4444', min: 1.05 * ftp, max: 2500 }
    ];
  }, [ftp]);

  const getPointColorMode = useCallback((pt: GPXPoint, activityType?: 'cycling' | 'running') => {
    if (colorMode === 'hr') {
      if (pt.hr === undefined) return null;
      const effectiveZones = activityType === 'running'
        ? hrZones.map(z => ({ ...z, min: z.min + 10, max: z.max + 10 }))
        : hrZones;

      const hr = pt.hr;
      if (hr < effectiveZones[0].min) return '#64748b';
      for (const z of effectiveZones) {
        if (hr >= z.min && hr <= z.max) {
          return z.color;
        }
      }
      return effectiveZones[effectiveZones.length - 1].color;
    }

    if (colorMode === 'power') {
      if (pt.power === undefined) return null;
      const power = pt.power;
      for (const z of powerZones) {
        if (power >= z.min && power <= z.max) {
          return z.color;
        }
      }
      return powerZones[powerZones.length - 1].color;
    }

    if (colorMode === 'speed') {
      if (pt.speed === undefined || pt.speed <= 0.1) return null;
      const speed = pt.speed; // in km/h
      if (activityType === 'running') {
        // Pace thresholds converted to speed:
        // Sehr schnell: < 4:00 min/km (>= 15 km/h) -> Red (#ef4444)
        // Schnell: 4:00 - 5:00 min/km (12.0 - 15.0 km/h) -> Orange (#f97316)
        // Moderat: 5:00 - 6:00 min/km (10.0 - 12.0 km/h) -> Yellow (#eab308)
        // Locker: 6:00 - 7:00 min/km (8.57 - 10.0 km/h) -> Green (#10b981)
        // Sehr locker: > 7:00 min/km (< 8.57 km/h) -> Blue (#3b82f6)
        if (speed >= 15.0) return '#ef4444';
        if (speed >= 12.0) return '#f97316';
        if (speed >= 10.0) return '#eab308';
        if (speed >= 8.5) return '#10b981';
        return '#3b82f6';
      } else {
        // Cycling speed thresholds:
        // Sehr schnell: >= 35 km/h -> Red (#ef4444)
        // Schnell: 30 - 35 km/h -> Orange (#f97316)
        // Moderat: 25 - 30 km/h -> Yellow (#eab308)
        // Locker: 20 - 25 km/h -> Green (#10b981)
        // Sehr locker: < 20 km/h -> Blue (#3b82f6)
        if (speed >= 35.0) return '#ef4444';
        if (speed >= 30.0) return '#f97316';
        if (speed >= 25.0) return '#eab308';
        if (speed >= 20.0) return '#10b981';
        return '#3b82f6';
      }
    }

    return null;
  }, [colorMode, hrZones, powerZones]);

  const hoverRafRef = useRef<number | null>(null);
  useEffect(() => {
    return () => {
      if (hoverRafRef.current !== null) {
        cancelAnimationFrame(hoverRafRef.current);
        hoverRafRef.current = null;
      }
    };
  }, []);

  const pauseIcon = useMemo(() => new L.DivIcon({
    className: 'custom-pause-icon',
    html: `
      <div class="relative">
        <div class="bg-amber-500 w-6 h-6 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white">
          <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/></svg>
        </div>
      </div>
    `,
    iconSize: [24, 24],
    iconAnchor: [12, 12]
  }), []);

  const pendingMarkerIcon = useMemo(() => new L.DivIcon({
    className: 'pending-marker',
    html: `
      <div class="relative flex flex-col items-center select-none" style="transform: translate(-50%, -100%); margin-top: -12px;">
        <div class="bg-blue-600 text-white text-[10px] font-black px-2 py-1 rounded-lg shadow-lg whitespace-nowrap border-2 border-white flex items-center gap-1">
          <span>📍 Neue Notiz...</span>
        </div>
        <div class="w-2.5 h-2.5 bg-blue-600 rotate-45 -mt-1 shadow-md border-r-2 border-b-2 border-white"></div>
      </div>
    `,
    iconSize: [0, 0],
    iconAnchor: [0, 0]
  }), []);

  const hoverTooltipRender = useMemo(() => {
    if (!hoveredPoint) return null;
    const hoveredTrackId = (hoveredPoint as any).trackId;
    const pointTrack = hoveredTrackId
      ? tracks.find(t => t.id === hoveredTrackId)
      : tracks.find(t => t.points && t.points.some(p => Math.abs(p.lat - hoveredPoint.lat) < 0.00005 && Math.abs(p.lng - hoveredPoint.lng) < 0.00005))
      || (markedTrackId ? tracks.find(t => t.id === markedTrackId) : tracks.find(t => t.visible !== false) || tracks[0]);

    if (!pointTrack || !hasRealGpsData(pointTrack)) return null;

    const isFit = Boolean(
      pointTrack?.rawFileDetails?.fileType === 'fit' ||
      pointTrack?.originalFilename?.toLowerCase().endsWith('.fit') ||
      pointTrack?.rawFileDetails?.fileName?.toLowerCase().endsWith('.fit') ||
      pointTrack?.name?.toLowerCase().endsWith('.fit') ||
      pointTrack?.id?.startsWith('fit-')
    );

    const telemetryResult = computeHoverPointTelemetry(
      hoveredPoint,
      pointTrack?.points,
      {
        estimatedSpeedKmh: estimatedSpeed,
        isFitFile: isFit,
        activityType: pointTrack?.activityType
      }
    );
    if (!telemetryResult.success) return null;

    return {
      position: [hoveredPoint.lat, hoveredPoint.lng] as [number, number],
      icon: new L.DivIcon({
        className: 'custom-hover-tooltip-marker',
        html: buildMapHoverCardHtml(telemetryResult.data),
        iconSize: [0, 0],
        iconAnchor: [0, 0]
      })
    };
  }, [hoveredPoint, tracks, markedTrackId, estimatedSpeed]);

  const preparedTracks = useMemo(() => {
    const items = tracks
      .filter(t => t.visible && hasRealGpsData(t))
      .map(track => {
        const isMarked = track.id === markedTrackId;
        const isCompared = Boolean(isComparisonMode && comparedTrack && track.id === comparedTrack.id);
        const validPoints = (track.points || [])
          .map(p => {
            if (!p) return null;
            const latVal = typeof p.lat === 'number' ? p.lat : parseFloat(p.lat as any);
            const lngVal = typeof p.lng === 'number' ? p.lng : parseFloat(p.lng as any);
            if (!Number.isFinite(latVal) || !Number.isFinite(lngVal)) return null;
            if (Math.abs(latVal) > 90 || Math.abs(lngVal) > 180) return null;
            if (Math.abs(latVal) < 0.0001 && Math.abs(lngVal) < 0.0001) return null;
            return { ...p, lat: latVal, lng: lngVal };
          })
          .filter((p): p is GPXPoint => p !== null);

        if (validPoints.length === 0) return null;

        const renderPoints = getCachedSimplifiedPoints(track.id, validPoints, 2500);
        const positions = renderPoints.map(p => [p.lat, p.lng] as [number, number]);

        const selectedPolylines: [number, number][][] = [];
        if (isMarked && selectionBounds) {
          let currentLine: [number, number][] = [];
          renderPoints.forEach(p => {
            const inBounds = p.lat >= selectionBounds.minLat && p.lat <= selectionBounds.maxLat &&
                             p.lng >= selectionBounds.minLng && p.lng <= selectionBounds.maxLng;
            if (inBounds) {
              currentLine.push([p.lat, p.lng]);
            } else if (currentLine.length > 0) {
              selectedPolylines.push(currentLine);
              currentLine = [];
            }
          });
          if (currentLine.length > 0) {
            selectedPolylines.push(currentLine);
          }
        }

        const displayTrackColor = isComparisonMode
          ? (isMarked ? '#2563eb' : isCompared ? '#f97316' : sanitizeColor(track.color))
          : sanitizeColor(track.color);

        // Build continuous coalesced segments of identical surface types over simplified renderPoints
        const surfaceSegments: { surface: string; positions: [number, number][] }[] = [];
        if (renderPoints.length > 0) {
          const pointsWithSurface = renderPoints.map((pt, idx) => {
            if (pt.surface) return pt.surface;
            if (track.surfaceStats && track.surfaceStats.length > 0 && track.distance > 0) {
              const currentDist = (idx / Math.max(1, renderPoints.length - 1)) * track.distance;
              let runningDist = 0;
              for (const stat of track.surfaceStats) {
                runningDist += stat.distance;
                if (currentDist <= runningDist) return stat.type;
              }
              return track.surfaceStats[track.surfaceStats.length - 1].type;
            }
            return "Asphalt";
          });

          let currentSurface = pointsWithSurface[0];
          let currentPositions: [number, number][] = [[renderPoints[0].lat, renderPoints[0].lng]];

          for (let i = 1; i < renderPoints.length; i++) {
            const pt = renderPoints[i];
            const surf = pointsWithSurface[i];
            if (surf === currentSurface) {
              currentPositions.push([pt.lat, pt.lng]);
            } else {
              currentPositions.push([pt.lat, pt.lng]); // connect segment overlaps
              surfaceSegments.push({ surface: currentSurface, positions: currentPositions });
              currentPositions = [[pt.lat, pt.lng]];
              currentSurface = surf;
            }
          }
          if (currentPositions.length > 0) {
            surfaceSegments.push({ surface: currentSurface, positions: currentPositions });
          }
        }

        // Build continuous coalesced segments of identical zone colors over simplified renderPoints
        const zoneSegments: { color: string; positions: [number, number][] }[] = [];
        if (colorMode !== 'default' && renderPoints.length > 0) {
          let activeSegmentColor: string | null = null;
          let currentPositions: [number, number][] = [];

          renderPoints.forEach((pt) => {
            const color = getPointColorMode(pt, track.activityType);
            const latlng: [number, number] = [pt.lat, pt.lng];

            if (color === null) {
              const fallbackColor = '#94a3b8'; // gray fallback
              if (activeSegmentColor === null) {
                currentPositions = [latlng];
                activeSegmentColor = fallbackColor;
              } else if (activeSegmentColor !== fallbackColor) {
                currentPositions.push(latlng);
                zoneSegments.push({ color: activeSegmentColor, positions: currentPositions });
                currentPositions = [latlng];
                activeSegmentColor = fallbackColor;
              } else {
                currentPositions.push(latlng);
              }
            } else {
              if (activeSegmentColor === null) {
                currentPositions = [latlng];
                activeSegmentColor = color;
              } else if (color === activeSegmentColor) {
                currentPositions.push(latlng);
              } else {
                currentPositions.push(latlng);
                zoneSegments.push({ color: activeSegmentColor, positions: currentPositions });
                currentPositions = [latlng];
                activeSegmentColor = color;
              }
            }
          });

          if (currentPositions.length > 0 && activeSegmentColor !== null) {
            zoneSegments.push({ color: activeSegmentColor, positions: currentPositions });
          }
        }

        // Pauses > 5 minutes
        const pauses: { lat: number; lng: number; durationMins: number; startTime: Date; endTime: Date; idx: number }[] = [];
        const rawPts = track.points || [];
        for (let i = 1; i < rawPts.length; i++) {
          const p = rawPts[i];
          const prevP = rawPts[i - 1];
          const pMs = toValidTimestampMs(p.time);
          const prevMs = toValidTimestampMs(prevP.time);
          if (pMs !== undefined && prevMs !== undefined) {
            const diffMs = pMs - prevMs;
            if (diffMs > 5 * 60 * 1000) {
              pauses.push({
                lat: prevP.lat,
                lng: prevP.lng,
                durationMins: Math.floor(diffMs / 60000),
                startTime: prevP.time as Date,
                endTime: p.time as Date,
                idx: i
              });
            }
          }
        }

        // Active / compared route flow directional arrows
        const arrows: { lat: number; lng: number; angle: number; idx: number }[] = [];
        if ((isMarked || isCompared) && rawPts.length >= 2) {
          const cumDist: number[] = [0];
          let totalD = 0;
          for (let i = 1; i < rawPts.length; i++) {
            const segmentD = calculateDistance(rawPts[i - 1], rawPts[i]);
            totalD += segmentD;
            cumDist.push(totalD);
          }

          if (totalD > 0) {
            const numArrows = isCompared ? 8 : 12; // Spaced evenly along the entire route
            for (let j = 1; j < numArrows; j++) {
              const targetDist = (totalD * j) / numArrows;
              let idx = 0;
              while (idx < cumDist.length - 1 && cumDist[idx + 1] < targetDist) {
                idx++;
              }
              const p1 = rawPts[idx];
              const p2 = rawPts[Math.min(idx + 1, rawPts.length - 1)];
              if (p1 && p2) {
                const angle = getBearing(p1.lat, p1.lng, p2.lat, p2.lng);
                arrows.push({ lat: p1.lat, lng: p1.lng, angle, idx: j });
              }
            }
          }
        }

        return {
          track,
          isMarked,
          isCompared,
          validPoints,
          positions,
          selectedPolylines,
          displayTrackColor,
          surfaceSegments,
          zoneSegments,
          pauses,
          arrows,
        };
      })
      .filter((item): item is NonNullable<typeof item> => item !== null);

    if (isComparisonMode) {
      items.sort((a, b) => {
        const rank = (item: typeof items[number]) => (item.isCompared ? 2 : item.isMarked ? 1 : 0);
        return rank(a) - rank(b);
      });
    }

    return items;
  }, [tracks, markedTrackId, isComparisonMode, comparedTrack, selectionBounds, colorMode, getPointColorMode, calculateDistance]);

  const isDarkTile = isDark && activeLayer !== MapLayer.SATELLITE;

  return (
    <div className="w-full h-full relative">
      <LeafletMapContainer 
        center={[mapView.lat, mapView.lng]} 
        zoom={mapView.zoom} 
        minZoom={MAP_MIN_ZOOM}
        maxZoom={MAP_MAX_ZOOM}
        zoomSnap={FINE_ZOOM_STEP}
        zoomDelta={FINE_ZOOM_STEP}
        scrollWheelZoom={true}
        boxZoom={false}
        zoomControl={false}
        preferCanvas={true}
        className={`z-0 ${isDarkTile ? 'dark-tiles' : ''}`}
      >
      <CachedLeafletTileLayer
          layerId={activeLayer}
          attribution={layer.attribution}
          url={layer.url}
          maxZoom={20}
          maxNativeZoom={layer.maxZoom || 19}
        />

        <FocusGapController selectedGap={timeGaps.find(g => g.id === selectedGapId) || null} />

        {/* Personal Lifetime Heatmap Overlay (Background Polylines) */}
        {showLifetimeHeatmap && filteredHeatmapTracks.map(ht => (
          <LeafletPolyline
            key={`heatmap-${ht.id}`}
            positions={ht.coords}
            color="#f97316"
            weight={2.5}
            opacity={isDarkTile ? 0.42 : 0.35}
            interactive={false}
          />
        ))}
        
        {preparedTracks.map(({
          track,
          isMarked,
          isCompared,
          validPoints,
          positions,
          selectedPolylines,
          displayTrackColor,
          surfaceSegments,
          zoneSegments,
          pauses,
          arrows,
        }) => {
          const isCompareHighlighted = isComparisonMode && (isMarked || isCompared);
          const isCompareDimmed = isComparisonMode && !isMarked && !isCompared;

          return (
            <React.Fragment key={track.id}>
              {/* Invisible thick line for easier hovering/clicking that holds the Popup */}
              <LeafletPolyline 
                positions={positions}
                color="#000000"
                opacity={0}
                weight={30}
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e);
                    if (!isComparisonMode) {
                      onMarkTrack(track.id);
                      setRecenterTrigger(prev => prev + 1);
                    }
                  },
                  mousemove: (e) => {
                    if (!onHoverPoint) return;
                    const lat = e.latlng.lat;
                    const lng = e.latlng.lng;
                    if (hoverRafRef.current !== null) {
                      cancelAnimationFrame(hoverRafRef.current);
                    }
                    hoverRafRef.current = requestAnimationFrame(() => {
                      hoverRafRef.current = null;
                      let closestIndex = 0;
                      let minDiff = Infinity;
                      for (let i = 0; i < validPoints.length; i++) {
                        const pt = validPoints[i];
                        const diff = Math.abs(pt.lat - lat) + Math.abs(pt.lng - lng);
                        if (diff < minDiff) {
                          minDiff = diff;
                          closestIndex = i;
                        }
                      }
                      const closestPoint = validPoints[closestIndex];
                      let pointSlope = closestPoint.slope;
                      if (pointSlope === undefined || !Number.isFinite(pointSlope)) {
                        const prevIdx = Math.max(0, closestIndex - 2);
                        const nextIdx = Math.min(validPoints.length - 1, closestIndex + 2);
                        const pPrev = validPoints[prevIdx];
                        const pNext = validPoints[nextIdx];
                        if (pPrev && pNext && pPrev.ele !== undefined && pNext.ele !== undefined) {
                          const distMeters = calculateDistance(pPrev, pNext) * 1000;
                          if (distMeters >= 4) {
                            pointSlope = Number((((pNext.ele - pPrev.ele) / distMeters) * 100).toFixed(1));
                          } else {
                            pointSlope = 0;
                          }
                        } else {
                          pointSlope = 0;
                        }
                      }

                      let pointDist = closestPoint.dist;
                      if (pointDist === undefined || !Number.isFinite(pointDist)) {
                        pointDist = Number((track.distance * (closestIndex / Math.max(1, validPoints.length - 1))).toFixed(2));
                      }

                      onHoverPoint({
                        ...closestPoint,
                        slope: pointSlope,
                        dist: pointDist,
                        trackId: track.id
                      } as GPXPoint);
                    });
                  },
                  mouseout: () => {
                    if (hoverRafRef.current !== null) {
                      cancelAnimationFrame(hoverRafRef.current);
                      hoverRafRef.current = null;
                    }
                    if (onHoverPoint) onHoverPoint(null);
                  }
                }}
              >
                <Popup>
                    <div className="font-bold">{track.name}</div>
                    <div>Distanz: {track.distance.toFixed(2)} km</div>
                    <div>Punkte: {validPoints.length}</div>
                    {track.duration ? (
                      <div>Dauer: {Math.floor(track.duration / 3600)}h {Math.floor((track.duration % 3600) / 60)}m</div>
                    ) : (
                      <div>Dauer: {Math.floor((track.distance / estimatedSpeed))}h {Math.floor(((track.distance / estimatedSpeed) * 60) % 60)}m</div>
                    )}
                    {track.powerStats && (
                      <div className="mt-2 pt-2 border-t text-xs">
                        <div className="font-semibold text-amber-600 mb-1">Leistung</div>
                        <div>Ø {Math.round(track.powerStats.avgPower)}W | Max {Math.round(track.powerStats.maxPower)}W</div>
                        <div>20s: {Math.round(track.powerStats.best20s)}W | 1m: {Math.round(track.powerStats.best1m)}W</div>
                        <div>20m: {Math.round(track.powerStats.best20m)}W</div>
                      </div>
                    )}
                </Popup>
              </LeafletPolyline>

              {/* Visible line(s): in 2-track comparison mode render crisp A (Blue) & B (Orange) comparison lines; otherwise normal modes */}
              {isCompareHighlighted ? (
                <>
                  {/* Outer high-contrast white halo */}
                  <LeafletPolyline
                    positions={positions}
                    color="#ffffff"
                    weight={isMarked ? 12 : 9}
                    opacity={0.9}
                    interactive={false}
                  />
                  {/* Primary core line (A wider so overlapping sections stay dual-colored) */}
                  <LeafletPolyline
                    positions={positions}
                    color={displayTrackColor}
                    weight={isMarked ? 8 : 5}
                    opacity={0.95}
                    interactive={false}
                  />
                </>
              ) : isCompareDimmed ? (
                <LeafletPolyline
                  positions={positions}
                  color={displayTrackColor}
                  weight={3}
                  opacity={0.25}
                  interactive={false}
                />
              ) : (colorMode === 'hr' || colorMode === 'power' || colorMode === 'speed') && zoneSegments.length > 0 ? (
                zoneSegments.map((seg, sIdx) => (
                  <LeafletPolyline
                    key={`zone-seg-${track.id}-${sIdx}`}
                    positions={seg.positions}
                    color={seg.color}
                    weight={isMarked ? 8 : 4}
                    opacity={isMarked ? 1.0 : 0.6}
                    interactive={false}
                  />
                ))
              ) : (colorMode === 'surface' || colorMode === 'default') && surfaceSegments.length > 0 ? (
                surfaceSegments.map((seg, sIdx) => {
                  const segColor = getSurfaceColor(seg.surface, displayTrackColor);
                  const isSurfaceHeatmap = colorMode === 'surface';
                  return (
                    <React.Fragment key={`surface-seg-${track.id}-${sIdx}`}>
                      {/* Outer Heatmap Glow Effect when surface heatmap is active */}
                      {isSurfaceHeatmap && (
                        <LeafletPolyline
                          key={`seg-glow-${sIdx}`}
                          positions={seg.positions}
                          color={segColor}
                          weight={isMarked ? 14 : 9}
                          opacity={0.35}
                          interactive={false}
                        />
                      )}
                      {/* Core Surface Line */}
                      <LeafletPolyline
                        key={`seg-core-${sIdx}`}
                        positions={seg.positions}
                        color={segColor}
                        weight={isMarked ? (isSurfaceHeatmap ? 6 : 8) : 4}
                        opacity={isMarked ? 1.0 : 0.7}
                        interactive={false}
                      />
                    </React.Fragment>
                  );
                })
              ) : (
                <LeafletPolyline 
                  positions={positions}
                  color={displayTrackColor}
                  weight={isMarked ? 8 : 4}
                  opacity={isMarked ? 1.0 : 0.6}
                  interactive={false}
                />
              )}

              {/* Selection Highlights */}
              {selectedPolylines.map((pts, i) => (
                <LeafletPolyline
                  key={`sel-${i}`}
                  positions={pts}
                  color="#4f46e5"
                  weight={12}
                  opacity={0.9}
                  interactive={false}
                />
              ))}

              {/* Pauses > 5 minutes */}
              {pauses.map(pause => (
                <LeafletMarker
                  key={`pause-${track.id}-${pause.idx}`}
                  position={[pause.lat, pause.lng]}
                  icon={pauseIcon}
                >
                  <Popup>
                    <div className="font-bold text-amber-600">Pause</div>
                    <div>Dauer: {pause.durationMins} Minuten</div>
                    <div>Start: {new Date(pause.startTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
                    <div>Ende: {new Date(pause.endTime).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
                  </Popup>
                </LeafletMarker>
              ))}

              {/* Active & Compared Route Flow Directional Arrows */}
              {arrows.map(arrow => (
                <LeafletMarker
                  key={`arrow-${track.id}-${arrow.idx}`}
                  position={[arrow.lat, arrow.lng]}
                  interactive={false}
                  icon={new L.DivIcon({
                    className: 'custom-arrow-icon',
                    html: `
                      <div style="transform: rotate(${arrow.angle}deg); display: flex; align-items: center; justify-content: center; width: 24px; height: 24px;">
                        <svg viewBox="0 0 24 24" width="22" height="22" style="filter: drop-shadow(0px 2px 3px rgba(0,0,0,0.65));">
                          <path d="M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z" fill="#ffffff" />
                          <path d="M12 4.5L7 17.5l5-2.2 5 2.2z" fill="${sanitizeHexColor(isComparisonMode ? (isMarked ? '#2563eb' : isCompared ? '#f97316' : track.color) : track.color, '#3b82f6')}" />
                        </svg>
                      </div>
                    `,
                    iconSize: [24, 24],
                    iconAnchor: [12, 12]
                  })}
                />
              ))}

              {/* Start- and Endepunkte für aktive und verglichene Route */}
              {(isMarked || isCompared) && validPoints.length > 0 && (() => {
                const startPt = validPoints[0];
                const endPt = validPoints[validPoints.length - 1];
                const startBadgeLabel = isComparisonMode ? (isMarked ? 'START A' : 'START B') : 'START';
                const endBadgeLabel = isComparisonMode ? (isMarked ? 'ZIEL A' : 'ZIEL B') : 'ENDE';
                const startBgStyle = isComparisonMode
                  ? (isMarked ? 'background: linear-gradient(135deg, #3b82f6, #1d4ed8);' : 'background: linear-gradient(135deg, #fb923c, #ea580c);')
                  : '';
                const endBgStyle = isComparisonMode
                  ? (isMarked ? 'background: linear-gradient(135deg, #1d4ed8, #1e3a8a);' : 'background: linear-gradient(135deg, #ea580c, #9a3412);')
                  : '';
                const markerAnchor: [number, number] = isComparisonMode && isCompared ? [16, 26] : [22, 22];
                
                return (
                  <>
                    <LeafletMarker
                      key={`start-${track.id}`}
                      position={[startPt.lat, startPt.lng]}
                      icon={new L.DivIcon({
                        className: 'custom-start-marker',
                        html: `
                          <div class="relative flex items-center justify-center" style="width: 44px; height: 44px;">
                            ${!isComparisonMode ? '<div class="absolute w-8 h-8 rounded-full bg-emerald-500/35 animate-ping"></div>' : ''}
                            <div class="${isComparisonMode ? '' : 'bg-gradient-to-br from-emerald-500 to-emerald-700'} text-white font-extrabold text-[8.5px] rounded-full w-9 h-9 border-2 border-white shadow-xl flex items-center justify-center tracking-tight select-none text-center leading-none" style="${startBgStyle}">
                              ${startBadgeLabel}
                            </div>
                          </div>
                        `,
                        iconSize: [44, 44],
                        iconAnchor: markerAnchor
                      })}
                    >
                      <Popup>
                        <div className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 text-sm">
                          <span>🚩</span> Startpunkt {isComparisonMode ? (isMarked ? '(Track A)' : '(Track B)') : ''}: {track.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-300 mt-1.5 font-sans space-y-1">
                          <div><strong>Koordinaten:</strong> {startPt.lat.toFixed(5)}°, {startPt.lng.toFixed(5)}°</div>
                          <div><strong>Höhe:</strong> {startPt.ele !== undefined ? `${Math.round(startPt.ele)}m` : 'Keine Höhendaten'}</div>
                          {startPt.time && (
                            <div><strong>Zeit:</strong> {new Date(startPt.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                          )}
                        </div>
                      </Popup>
                    </LeafletMarker>

                    {validPoints.length > 1 && (
                      <LeafletMarker
                        key={`end-${track.id}`}
                        position={[endPt.lat, endPt.lng]}
                        icon={new L.DivIcon({
                          className: 'custom-end-marker',
                          html: `
                            <div class="relative flex items-center justify-center" style="width: 44px; height: 44px;">
                              <div class="absolute w-8 h-8 rounded-full bg-rose-500/25"></div>
                              <div class="${isComparisonMode ? '' : 'bg-gradient-to-br from-rose-500 to-rose-700'} text-white font-extrabold text-[8.5px] rounded-full w-9 h-9 border-2 border-white shadow-xl flex items-center justify-center tracking-tight select-none text-center leading-none" style="${endBgStyle}">
                                ${endBadgeLabel}
                              </div>
                            </div>
                          `,
                          iconSize: [44, 44],
                          iconAnchor: markerAnchor
                        })}
                      >
                        <Popup>
                          <div className="font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5 text-sm">
                            <span>🏁</span> Zielpunkt {isComparisonMode ? (isMarked ? '(Track A)' : '(Track B)') : ''}: {track.name}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-300 mt-1.5 font-sans space-y-1">
                            <div><strong>Koordinaten:</strong> {endPt.lat.toFixed(5)}°, {endPt.lng.toFixed(5)}°</div>
                            <div><strong>Zielhöhe:</strong> {endPt.ele !== undefined ? `${Math.round(endPt.ele)}m` : 'Keine Höhendaten'}</div>
                            {endPt.time && (
                              <div><strong>Zielzeit:</strong> {new Date(endPt.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                            )}
                          </div>
                        </Popup>
                      </LeafletMarker>
                    )}
                  </>
                );
              })()}
            </React.Fragment>
          );
        })}

        {/* Synchronized Dual-Track Live Markers & Spatial Gap Line */}
        {isComparisonMode && syncedComparisonPair && (
          <>
            {syncedComparisonPair.spatialGapKm >= 0.005 && (
              <LeafletPolyline
                positions={[
                  [syncedComparisonPair.ptA.lat, syncedComparisonPair.ptA.lng],
                  [syncedComparisonPair.ptB.lat, syncedComparisonPair.ptB.lng]
                ]}
                color="#4f46e5"
                weight={2.5}
                dashArray="6, 6"
                opacity={0.95}
                interactive={false}
              />
            )}

            {syncedComparisonPair.spatialGapKm >= 0.015 && (
              <LeafletMarker
                position={[syncedComparisonPair.midLat, syncedComparisonPair.midLng]}
                interactive={false}
                icon={new L.DivIcon({
                  className: 'dual-compare-gap-badge',
                  html: `
                    <div style="transform: translate(-50%, -50%); white-space: nowrap; background: rgba(15, 23, 42, 0.88); color: #ffffff; border: 1.5px solid #818cf8; border-radius: 9999px; padding: 2px 8px; font-size: 10px; font-weight: 800; box-shadow: 0 4px 10px rgba(0,0,0,0.3); font-family: ui-monospace, monospace;">
                      ↔ ${syncedComparisonPair.spatialGapKm < 1 ? `${Math.round(syncedComparisonPair.spatialGapKm * 1000)} m` : `${syncedComparisonPair.spatialGapKm.toFixed(2)} km`}${syncedComparisonPair.eleDiffM !== null ? ` · Δ ${syncedComparisonPair.eleDiffM >= 0 ? '+' : ''}${syncedComparisonPair.eleDiffM} m` : ''}
                    </div>
                  `,
                  iconSize: [0, 0],
                  iconAnchor: [0, 0]
                })}
              />
            )}

            <LeafletMarker
              position={[syncedComparisonPair.ptA.lat, syncedComparisonPair.ptA.lng]}
              interactive={false}
              icon={new L.DivIcon({
                className: 'dual-compare-marker-a',
                html: `
                  <div style="position: relative; transform: translate(-50%, -50%);">
                    <div style="width: 22px; height: 22px; border-radius: 9999px; background: #2563eb; border: 3px solid #ffffff; color: #ffffff; font-size: 10px; font-weight: 900; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(37,99,235,0.65);">A</div>
                    <div style="position: absolute; bottom: 26px; left: 50%; transform: translateX(-50%); white-space: nowrap; background: #1d4ed8; color: #ffffff; border: 1.5px solid #ffffff; border-radius: 6px; padding: 2px 6px; font-size: 10px; font-weight: 800; font-family: ui-monospace, monospace; box-shadow: 0 3px 8px rgba(0,0,0,0.28);">
                      A: ${syncedComparisonPair.ptA.distKm.toFixed(1)} km${syncedComparisonPair.ptA.ele !== undefined ? ` · ${Math.round(syncedComparisonPair.ptA.ele)}m` : ''}
                    </div>
                  </div>
                `,
                iconSize: [0, 0],
                iconAnchor: [0, 0]
              })}
            />

            <LeafletMarker
              position={[syncedComparisonPair.ptB.lat, syncedComparisonPair.ptB.lng]}
              interactive={false}
              icon={new L.DivIcon({
                className: 'dual-compare-marker-b',
                html: `
                  <div style="position: relative; transform: translate(-50%, -50%);">
                    <div style="width: 22px; height: 22px; border-radius: 9999px; background: #f97316; border: 3px solid #ffffff; color: #ffffff; font-size: 10px; font-weight: 900; display: flex; align-items: center; justify-content: center; box-shadow: 0 2px 8px rgba(249,115,22,0.65);">B</div>
                    <div style="position: absolute; top: 26px; left: 50%; transform: translateX(-50%); white-space: nowrap; background: #ea580c; color: #ffffff; border: 1.5px solid #ffffff; border-radius: 6px; padding: 2px 6px; font-size: 10px; font-weight: 800; font-family: ui-monospace, monospace; box-shadow: 0 3px 8px rgba(0,0,0,0.28);">
                      B: ${syncedComparisonPair.ptB.distKm.toFixed(1)} km${syncedComparisonPair.ptB.ele !== undefined ? ` · ${Math.round(syncedComparisonPair.ptB.ele)}m` : ''}
                    </div>
                  </div>
                `,
                iconSize: [0, 0],
                iconAnchor: [0, 0]
              })}
            />
          </>
        )}

        <ZoomToTracks tracks={tracks} markedTrackId={markedTrackId} />
        <ZoomToMarkedTrack markedTrackId={markedTrackId} compareTrackId={compareTrackId} tracks={tracks} />
        <ZoomToActiveTrack activeTrack={activeTrack} comparedTrack={comparedTrack} recenterTrigger={recenterTrigger} />
        <ZoomToSelection bounds={selectionBounds} />
        <MapResizer markedTrackId={markedTrackId} compareTrackId={compareTrackId} tracksLength={tracks.length} tracks={tracks} />
        <SyncView mapView={mapView} onMapViewChange={onMapViewChange} />
        <SelectionTool active={true} onSelection={onSelection} currentBounds={selectionBounds} />
        
        {hoverTooltipRender && (
          <LeafletMarker
            position={hoverTooltipRender.position}
            interactive={false}
            icon={hoverTooltipRender.icon}
          />
        )}



        {textMarkers.map(marker => {
          const colorMap: Record<string, string> = {
            indigo: '#3b82f6',
            emerald: '#10b981',
            rose: '#f43f5e',
            amber: '#f59e0b',
            slate: '#64748b'
          };
          const bgColor = colorMap[marker.color] || '#3b82f6';
          
          return (
            <LeafletMarker
              key={marker.id}
              position={[marker.lat, marker.lng]}
              eventHandlers={{
                contextmenu: (e: any) => {
                  L.DomEvent.stopPropagation(e);
                  triggerHaptic('medium');
                  onDeleteTextMarker(marker.id);
                }
              }}
              icon={new L.DivIcon({
                className: 'custom-text-marker',
                html: `
                  <div class="relative flex flex-col items-center select-none cursor-pointer group" style="transform: translate(-50%, -100%); margin-top: -12px;" title="Rechtsklick oder Klick zum Entfernen">
                    <div class="text-white text-[10px] font-black px-2 py-1 rounded-lg shadow-lg whitespace-nowrap border-2 border-white flex items-center gap-1 transition-transform group-hover:scale-110" style="background-color: ${bgColor};">
                      <span>🏷️</span> ${escapeHtml(marker.label)}
                    </div>
                    <div class="w-2.5 h-2.5 rotate-45 -mt-1 shadow-md border-r-2 border-b-2 border-white" style="background-color: ${bgColor};"></div>
                  </div>
                `,
                iconSize: [0, 0],
                iconAnchor: [0, 0]
              })}
            >
              <Popup>
                <div className="text-xs p-1 min-w-[130px] space-y-1.5">
                  <div className="font-extrabold text-slate-800 dark:text-slate-100 flex items-center justify-between">
                    <span>🏷️ {marker.label}</span>
                  </div>
                  {marker.distanceAlongTrack !== undefined && (
                    <div className="text-[10px] text-blue-600 dark:text-blue-400 font-bold">
                      km {marker.distanceAlongTrack.toFixed(2)}
                    </div>
                  )}
                  <div className="text-[9px] text-slate-400 font-mono">
                    {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
                  </div>
                  <button
                    type="button"
                    onClick={(e) => {
                      L.DomEvent.stopPropagation(e);
                      triggerHaptic('medium');
                      onDeleteTextMarker(marker.id);
                    }}
                    className="w-full text-center px-2 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/40 dark:hover:bg-red-900/60 text-red-600 dark:text-red-300 rounded-lg text-[10px] font-extrabold border border-red-200 dark:border-red-800 transition-colors flex items-center justify-center gap-1 cursor-pointer"
                    id={`btn-delete-marker-${marker.id}`}
                  >
                    <span>🗑️</span>
                    <span>Marker entfernen</span>
                  </button>
                </div>
              </Popup>
            </LeafletMarker>
          );
        })}

        {/* Verpflegung & POI Marker */}
        {showPOIs && visiblePOIs.map((poi, pIdx) => {
          let emoji = '📍';
          let bgColor = '#3b82f6';
          let ringColor = 'rgba(59, 130, 246, 0.2)';

          if (poi.type === 'water') {
            emoji = '💧';
            bgColor = '#0ea5e9'; // sky-500
            ringColor = 'rgba(14, 165, 233, 0.25)';
          } else if (poi.type === 'supermarket') {
            emoji = '🛒';
            bgColor = '#10b981'; // emerald-500
            ringColor = 'rgba(16, 185, 129, 0.25)';
          } else if (poi.type === 'restaurant') {
            emoji = '🍴';
            bgColor = '#f43f5e'; // rose-500
            ringColor = 'rgba(244, 63, 94, 0.25)';
          } else if (poi.type === 'gas_station') {
            emoji = '⛽';
            bgColor = '#f59e0b'; // amber-500
            ringColor = 'rgba(245, 158, 11, 0.25)';
          }

          return (
            <LeafletMarker
              key={`poi-marker-${poi.id}-${pIdx}`}
              position={[poi.lat, poi.lng]}
              icon={new L.DivIcon({
                className: 'custom-poi-marker',
                html: `
                  <div class="relative flex flex-col items-center select-none" style="transform: translate(-50%, -50%);" title="${escapeHtml(poi.name || '')}">
                    <div class="w-7 h-7 rounded-full flex items-center justify-center text-sm shadow-md border-2 border-white text-white transition-transform duration-150 hover:scale-110" style="background-color: ${bgColor}; box-shadow: 0 0 0 3px ${ringColor}, 0 4px 6px -1px rgb(0 0 0 / 0.1);">
                      <span style="line-height: 1; font-size: 13px;">${emoji}</span>
                    </div>
                  </div>
                `,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
              })}
            >
              <Popup>
                <div className="p-2 min-w-[200px] text-xs font-sans space-y-1.5 text-slate-800 dark:text-slate-100">
                  <div className="flex items-center gap-1.5 font-bold">
                    <span className="w-5 h-5 rounded-full flex items-center justify-center text-xs" style={{ backgroundColor: `${bgColor}20`, color: bgColor }}>
                      {emoji}
                    </span>
                    <span className="text-[10px] uppercase font-black tracking-wider text-slate-500">
                      {poi.type === 'water' ? 'Wasserstelle' :
                       poi.type === 'supermarket' ? 'Supermarkt / Bäcker' :
                       poi.type === 'restaurant' ? 'Gastronomie' : 'Tankstelle / Kiosk'}
                    </span>
                  </div>
                  <div className="font-extrabold text-xs text-slate-900 dark:text-white leading-snug">
                    {poi.name}
                  </div>
                  <div className="text-[10px] font-extrabold text-indigo-600 dark:text-indigo-400 font-mono">
                    Entlang Route: km {poi.distanceAlongTrack.toFixed(1)}
                  </div>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal font-medium bg-slate-50 dark:bg-slate-900/50 p-1.5 rounded-lg border border-slate-100 dark:border-slate-800/50">
                    {poi.details}
                  </p>
                  <div className="text-[8px] text-slate-450 font-mono text-right pt-0.5">
                    {poi.lat.toFixed(5)}, {poi.lng.toFixed(5)}
                  </div>
                </div>
              </Popup>
            </LeafletMarker>
          );
        })}

        {pendingMarker && (
          <LeafletMarker
            position={[pendingMarker.lat, pendingMarker.lng]}
            icon={pendingMarkerIcon}
          >
            <Popup 
              position={[pendingMarker.lat, pendingMarker.lng]}
              eventHandlers={{
                remove: () => setPendingMarker(null)
              }}
            >
              <div 
                className="p-1.5 w-44 space-y-2 text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="font-bold text-slate-850 dark:text-slate-100 leading-tight">Neue Notiz erstellen</div>
                <div className="space-y-1">
                  <input
                    id="pending-marker-input"
                    type="text"
                    placeholder="z.B. Sprint, Verpflegung"
                    className="w-full bg-slate-50 dark:bg-slate-900 border border-slate-250 dark:border-slate-800 rounded-lg px-2 py-1 text-[11px] font-bold text-slate-850 outline-none"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        const val = (e.target as HTMLInputElement).value.trim();
                        if (val) {
                          let dist: number | undefined = undefined;
                          const track = tracks.find(t => t.id === markedTrackId);
                          if (track) {
                            let closestIdx = 0;
                            let minDist = Infinity;
                            for (let i = 0; i < track.points.length; i++) {
                              const pt = track.points[i];
                              const diff = Math.abs(pt.lat - pendingMarker.lat) + Math.abs(pt.lng - pendingMarker.lng);
                              if (diff < minDist) {
                                minDist = diff;
                                closestIdx = i;
                              }
                            }
                            let sum = 0;
                            for (let i = 1; i <= closestIdx; i++) {
                              sum += calculateDistance(track.points[i-1], track.points[i]);
                            }
                            dist = sum;
                          }

                          onAddTextMarker({
                            lat: pendingMarker.lat,
                            lng: pendingMarker.lng,
                            label: val,
                            color: 'indigo',
                            trackId: markedTrackId || undefined,
                            distanceAlongTrack: dist
                          });
                          setPendingMarker(null);
                        }
                      }
                    }}
                  />
                </div>
                <div className="flex gap-1">
                  <button
                    onClick={() => {
                      const el = document.getElementById('pending-marker-input') as HTMLInputElement;
                      const val = el?.value.trim();
                      if (val) {
                        let dist: number | undefined = undefined;
                        const track = tracks.find(t => t.id === markedTrackId);
                        if (track) {
                          let closestIdx = 0;
                          let minDist = Infinity;
                          for (let i = 0; i < track.points.length; i++) {
                            const pt = track.points[i];
                            const diff = Math.abs(pt.lat - pendingMarker.lat) + Math.abs(pt.lng - pendingMarker.lng);
                            if (diff < minDist) {
                              minDist = diff;
                              closestIdx = i;
                            }
                          }
                          let sum = 0;
                          for (let i = 1; i <= closestIdx; i++) {
                            sum += calculateDistance(track.points[i-1], track.points[i]);
                          }
                          dist = sum;
                        }

                        onAddTextMarker({
                          lat: pendingMarker.lat,
                          lng: pendingMarker.lng,
                          label: val,
                          color: 'indigo',
                          trackId: markedTrackId || undefined,
                          distanceAlongTrack: dist
                        });
                        setPendingMarker(null);
                      }
                    }}
                    className="flex-1 bg-blue-600 hover:bg-blue-700 text-white font-extrabold py-1 rounded text-[10px] text-center"
                  >
                    Speichern
                  </button>
                  <button
                    onClick={() => setPendingMarker(null)}
                    className="flex-1 bg-slate-100 hover:bg-slate-200 text-slate-605 font-bold py-1 rounded text-[10px] text-center"
                  >
                    Abbrechen
                  </button>
                </div>
              </div>
            </Popup>
          </LeafletMarker>
        )}

        <LeafletZoomBridge
          mapRef={leafletMapRef}
          pendingZoomRef={pendingZoomRef}
          onZoomChange={setLiveZoom}
        />
      </LeafletMapContainer>

      {/* Mobile & Touch Floating Action Toolbar + Fine-Grained Zoom Controls */}
      <div className={`absolute ${isBottomBarObscuring ? 'bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] sm:bottom-4' : 'bottom-2 sm:bottom-4'} right-2 sm:right-4 z-[400] flex flex-col items-end gap-2 pointer-events-none`}>
        <MapZoomControls
          currentZoom={liveZoom}
          minZoom={MAP_MIN_ZOOM}
          maxZoom={MAP_MAX_ZOOM}
          onZoomStep={handleZoomStep}
        />
        {activeTrack && (
          <button
            type="button"
            onClick={() => {
              triggerHaptic('medium');
              setRecenterTrigger(prev => prev + 1);
            }}
            className="pointer-events-auto p-2.5 sm:p-3 rounded-2xl bg-white/95 dark:bg-slate-900/95 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-800 shadow-lg backdrop-blur-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1.5 text-xs font-black cursor-pointer active:scale-95"
            title={`Karte auf gesamte Route "${activeTrack.name}" ausrichten (Taste F)`}
            id="btn-toolbar-center-route"
          >
            <Target className="w-4 h-4 text-amber-500" />
            <span className="hidden xs:inline">Route zentrieren</span>
            <kbd className="hidden sm:inline-block px-1 py-0.2 text-[9px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded border border-slate-200 dark:border-slate-700">F</kbd>
          </button>
        )}

        {onOpenShortcuts && (
          <div className="relative flex flex-col items-end pointer-events-auto">
            {isQuickShortcutsOpen && (
              <div
                className="mb-2 w-60 rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-slate-200/80 dark:border-slate-800 shadow-xl backdrop-blur-md p-3 text-[11px] text-slate-700 dark:text-slate-200 space-y-2"
                role="dialog"
                aria-label="Schnellübersicht Tastenkürzel"
              >
                <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-1.5">
                  <span className="font-extrabold text-slate-800 dark:text-slate-100">Karten-Shortcuts</span>
                  <button
                    type="button"
                    onClick={() => setIsQuickShortcutsOpen(false)}
                    className="text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
                    aria-label="Kurzübersicht schließen"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
                <div className="space-y-1.5 font-medium">
                  <div className="flex items-center justify-between">
                    <span>Zoom rein / raus</span>
                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">+ / -</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Feinzoom (±0,25)</span>
                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">Shift + Klick</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Route zentrieren</span>
                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">F</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span>Rückgängig</span>
                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400">Strg + Z</span>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setIsQuickShortcutsOpen(false);
                    onOpenShortcuts();
                  }}
                  className="w-full py-1.5 px-2.5 rounded-lg bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/60 text-indigo-700 dark:text-indigo-300 font-bold text-[11px] transition-colors cursor-pointer"
                >
                  Alle Tastenkürzel öffnen (?)
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={() => {
                triggerHaptic('light');
                setIsQuickShortcutsOpen((prev) => !prev);
              }}
              onDoubleClick={() => {
                setIsQuickShortcutsOpen(false);
                onOpenShortcuts();
              }}
              className="p-2.5 sm:p-3 rounded-2xl bg-white/95 dark:bg-slate-900/95 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-800 shadow-lg backdrop-blur-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1.5 text-xs font-black cursor-pointer active:scale-95 group"
              title="Kompakte Tastenkürzel-Hilfe umschalten (Taste ? für Gesamtübersicht)"
              id="btn-toolbar-shortcuts"
            >
              <Keyboard className="w-4 h-4 text-indigo-500 group-hover:scale-110 transition-transform" />
              <span className="hidden xs:inline">Shortcuts</span>
              <kbd className="hidden sm:inline-block px-1 py-0.2 text-[9px] font-mono font-bold bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 rounded border border-slate-200 dark:border-slate-700">?</kbd>
            </button>
          </div>
        )}
      </div>

      {/* Strecken-Farbmodus, POI-Filter & Lebenszeit-Heatmap in Karten-Optionen (oben rechts) */}
      {!isColorMenuOpen ? (
        <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-[450] flex items-center gap-2 pointer-events-auto">
          <button
            type="button"
            onClick={() => setIsColorMenuOpen(true)}
            className="relative bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-2.5 py-2 rounded-xl border border-slate-200/70 dark:border-slate-800 shadow-md flex items-center justify-center gap-1.5 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800 active:scale-95 transition-all text-slate-700 dark:text-slate-200 select-none font-bold min-h-[44px] min-w-[44px] touch-manipulation"
            title="Karten-Optionen, Heatmap & Verpflegung einblenden"
            id="btn-color-mode-toggle"
          >
            <Palette className="w-3.5 h-3.5 text-indigo-500" />
            <span className="text-[10px] sm:text-xs font-extrabold uppercase tracking-wider hidden sm:inline">Karten-Optionen</span>
            {showLifetimeHeatmap && (
              <span
                className="w-2 h-2 rounded-full bg-orange-500 ring-2 ring-white dark:ring-slate-900 shrink-0"
                title="Lebenszeit-Heatmap aktiv"
              />
            )}
          </button>
        </div>
      ) : (
        <>
          <div
            className="fixed inset-0 z-[440]"
            onClick={() => setIsColorMenuOpen(false)}
            aria-hidden="true"
          />
          <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-[450] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-3 py-2.5 rounded-xl border border-slate-200/70 dark:border-slate-800 shadow-lg flex flex-col gap-2 font-sans pointer-events-auto select-none w-64 max-w-[90vw] max-h-[min(74vh,520px)] overflow-y-auto">
          <div className="font-extrabold text-[10px] text-slate-500 dark:text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-1 flex items-center justify-between gap-4">
            <span className="flex items-center gap-1">
              <Palette className="w-3.5 h-3.5 text-indigo-500" />
              Karten-Optionen
            </span>
            <button
              type="button"
              onClick={() => setIsColorMenuOpen(false)}
              className="text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 font-extrabold text-xs cursor-pointer min-h-[36px] min-w-[36px] flex items-center justify-center rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              title="Minimieren"
              id="btn-color-mode-close"
            >
              ✕
            </button>
          </div>
          
          {/* Section 1: Farbmodus */}
          <div>
            <div className="text-[9px] font-bold text-slate-400 uppercase tracking-wider mb-1">Strecken-Farbmodus</div>
            <div className="flex flex-col gap-1 text-[11px]">
              <label className="flex items-center gap-2 cursor-pointer py-0.5 px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input 
                  type="radio" 
                  name="colorMode" 
                  value="surface"
                  checked={colorMode === 'surface'} 
                  onChange={() => setColorMode('surface')} 
                  className="accent-blue-600 font-sans"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <span>🗺️</span> Oberflächen-Heatmap
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer py-0.5 px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input 
                  type="radio" 
                  name="colorMode" 
                  value="default"
                  checked={colorMode === 'default'} 
                  onChange={() => setColorMode('default')} 
                  className="accent-blue-600 font-sans"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Standard (Streckenfarbe)</span>
              </label>
              
              <label className="flex items-center gap-2 cursor-pointer py-0.5 px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input 
                  type="radio" 
                  name="colorMode" 
                  value="hr"
                  checked={colorMode === 'hr'} 
                  onChange={() => setColorMode('hr')} 
                  className="accent-blue-600 font-sans"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Herzfrequenz-Zonen</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer py-0.5 px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input 
                  type="radio" 
                  name="colorMode" 
                  value="power"
                  checked={colorMode === 'power'} 
                  onChange={() => setColorMode('power')} 
                  className="accent-blue-600"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Leistungs-Zonen (Watt)</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer py-0.5 px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input 
                  type="radio" 
                  name="colorMode" 
                  value="speed"
                  checked={colorMode === 'speed'} 
                  onChange={() => setColorMode('speed')} 
                  className="accent-blue-600"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Tempo / Pace</span>
              </label>
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 my-0.5" />

          {/* Section 2: Lebenszeit-Heatmap */}
          <div>
            <div className="flex items-center justify-between mb-1.5 gap-2">
              <div className="flex items-center gap-1.5 min-w-0">
                <Flame className={`w-3.5 h-3.5 shrink-0 ${showLifetimeHeatmap ? 'text-orange-500' : 'text-slate-400'}`} />
                <span className="text-[9px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider truncate">
                  Lebenszeit-Heatmap
                </span>
                {showLifetimeHeatmap && (
                  <span className="text-[10px] font-mono px-1.5 py-0.2 rounded bg-orange-500/15 text-orange-600 dark:text-orange-400 font-bold">
                    {heatmapLoading ? '…' : filteredHeatmapTracks.length}
                  </span>
                )}
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={showLifetimeHeatmap}
                aria-label="Persönliche Lebenszeit-Heatmap umschalten"
                id="btn-map-lifetime-heatmap"
                onClick={() => setShowLifetimeHeatmap(prev => !prev)}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors ${
                  showLifetimeHeatmap ? 'bg-orange-500' : 'bg-slate-200 dark:bg-slate-700'
                }`}
                title="Persönliche Lebenszeit-Heatmap aller gespeicherten Touren ein-/ausblenden"
              >
                <span
                  className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                    showLifetimeHeatmap ? 'translate-x-4' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>

            <div className={`grid grid-cols-3 gap-1 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-lg transition-opacity ${showLifetimeHeatmap ? 'opacity-100' : 'opacity-45 pointer-events-none'}`}>
              {([
                { id: 'all', label: 'Alle' },
                { id: 'cycling', label: 'Rad' },
                { id: 'running', label: 'Lauf' }
              ] as const).map(opt => (
                <button
                  key={opt.id}
                  type="button"
                  onClick={() => setHeatmapSportFilter(opt.id)}
                  className={`py-1 rounded text-[10px] font-extrabold transition-colors cursor-pointer ${
                    heatmapSportFilter === opt.id
                      ? 'bg-orange-500 text-white shadow-2xs'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-white/70 dark:hover:bg-slate-700'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <div className="border-t border-slate-100 dark:border-slate-800 my-0.5" />

          {/* Section 3: Verpflegung & POIs */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Verpflegung & POIs</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showPOIs} 
                  onChange={() => setShowPOIs(prev => {
                    const next = !prev;
                    try { localStorage.setItem('gpx_show_pois', String(next)); } catch (e) {}
                    return next;
                  })} 
                  className="sr-only peer"
                />
                <div className="w-7 h-4 bg-slate-200 dark:bg-slate-850 rounded-full peer peer-checked:after:translate-x-full after:content-[''] after:absolute after:top-0.5 after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-3 after:w-3 after:transition-all peer-checked:bg-indigo-600"></div>
              </label>
            </div>

            <div className={`flex flex-col gap-1 text-[11px] transition-opacity duration-200 ${showPOIs ? 'opacity-100' : 'opacity-40 pointer-events-none'}`}>
              <label className="flex items-center gap-2 cursor-pointer py-0.5 px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input 
                  type="checkbox" 
                  checked={poiFilters.water} 
                  onChange={() => setPoiFilters(prev => ({ ...prev, water: !prev.water }))} 
                  className="accent-sky-500 rounded"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <span>💧</span> Wasserstellen
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer py-0.5 px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input 
                  type="checkbox" 
                  checked={poiFilters.supermarket} 
                  onChange={() => setPoiFilters(prev => ({ ...prev, supermarket: !prev.supermarket }))} 
                  className="accent-emerald-500 rounded"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <span>🛒</span> Supermarkt / Bäcker
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer py-0.5 px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input 
                  type="checkbox" 
                  checked={poiFilters.restaurant} 
                  onChange={() => setPoiFilters(prev => ({ ...prev, restaurant: !prev.restaurant }))} 
                  className="accent-rose-500 rounded"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <span>🍴</span> Gastronomie
                </span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer py-0.5 px-1.5 rounded hover:bg-slate-100 dark:hover:bg-slate-800 transition">
                <input 
                  type="checkbox" 
                  checked={poiFilters.gas_station} 
                  onChange={() => setPoiFilters(prev => ({ ...prev, gas_station: !prev.gas_station }))} 
                  className="accent-amber-500 rounded"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300 flex items-center gap-1">
                  <span>⛽</span> Tankstellen / Kioske
                </span>
              </label>
            </div>
          </div>

          {/* Warnungsmeldung falls ausgewählte Strecke keine entsprechenden Daten enthält oder virtuell ist */}
          {(() => {
            const markedTrack = tracks.find(t => t.id === markedTrackId);
            if (!markedTrack) return null;

            if (!hasRealGpsData(markedTrack)) {
              return (
                <div className="text-[10px] text-orange-700 dark:text-orange-400 bg-orange-50/90 dark:bg-orange-950/30 border border-orange-200/50 dark:border-orange-900/40 p-2 rounded-lg leading-snug font-sans shadow-xs">
                  <div className="font-extrabold flex items-center gap-1 mb-0.5 text-xs">
                    <span>⚠️</span> Keine GPS-Koordinatendaten
                  </div>
                  Diese Aktivität enthält keine GPX/GPS-Spur. Auf der Karte wird keine Route gezeichnet; alle Statistiken und das Höhenprofil sind voll nutzbar.
                </div>
              );
            }

            const hasHr = markedTrack.points.some(p => p.hr !== undefined);
            const hasPower = markedTrack.points.some(p => p.power !== undefined);
            const hasSpeed = markedTrack.points.some(p => p.speed !== undefined && p.speed > 0.1);
            
            if (colorMode === 'hr' && !hasHr) {
              return (
                <div className="text-[9px] text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-900/40 p-1.5 rounded leading-tight">
                  ⚠️ Keine Herzfrequenzdaten in dieser Strecke vorhanden.
                </div>
              );
            }
            if (colorMode === 'power' && !hasPower) {
              return (
                <div className="text-[9px] text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-900/40 p-1.5 rounded leading-tight">
                  ⚠️ Keine Leistungsdaten (Watt) in dieser Strecke vorhanden.
                </div>
              );
            }
            if (colorMode === 'speed' && !hasSpeed) {
              return (
                <div className="text-[9px] text-amber-600 bg-amber-50 dark:bg-amber-950/30 border border-amber-200/50 dark:border-amber-900/40 p-1.5 rounded leading-tight">
                  ⚠️ Keine Geschwindigkeits-/Tempodaten in dieser Strecke vorhanden.
                </div>
              );
            }
            return null;
          })()}
          </div>
        </>
      )}

      {/* Premium Map Legend explaining Surface Types or Zone Ranges */}
      {!hideLegend && (
        isLegendVisible ? (
          <div className={`absolute ${isBottomBarObscuring ? 'bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] sm:bottom-4' : 'bottom-2 sm:bottom-4'} left-2 sm:left-4 z-[400] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-md flex flex-col gap-1.5 font-mono text-[9px] pointer-events-auto select-none min-w-[170px] max-w-[220px]`}>
            <div className="flex items-center justify-between gap-4 font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-0.5 border-b border-slate-100 dark:border-slate-800 pb-0.5">
              <span>{colorMode === 'surface' ? 'Oberflächen-Heatmap' : colorMode === 'default' ? 'Untergrund' : colorMode === 'hr' ? 'Herzfrequenz' : colorMode === 'power' ? 'Leistung' : 'Tempo / Pace'}</span>
              <button
                onClick={() => setIsLegendVisible(false)}
                className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 font-bold text-[11px] leading-none cursor-pointer p-0.5"
                title="Einklappen"
              >
                ✕
              </button>
            </div>
            {(colorMode === 'surface' || colorMode === 'default') ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#2563eb" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">Asphalt (Paved)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#d97706" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">Schotter (Gravel)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#16a34a" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">Singletrail / Waldweg</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#0284c7" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">Fahrradweg</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#805ad5" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">Kopfsteinpflaster</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#ca8a04" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">Unbefestigt / Natur</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#94a3b8" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-200">Unbekannt / Keine Daten</span>
                </div>

                {/* Live Surface Distribution breakdown for marked track */}
                {(() => {
                  const markedTrack = tracks.find(t => t.id === markedTrackId);
                  if (!markedTrack) return null;

                  if (markedTrack.surfaceStats && markedTrack.surfaceStats.length > 0) {
                    const totalDist = markedTrack.surfaceStats.reduce((acc, s) => acc + s.distance, 0) || markedTrack.distance || 1;
                    return (
                      <div className="mt-1.5 pt-1.5 border-t border-slate-200/70 dark:border-slate-800 flex flex-col gap-1.5">
                        <div className="font-sans font-bold text-[9.5px] text-slate-700 dark:text-slate-300 truncate">
                          {markedTrack.name}
                        </div>
                        {/* Stacked surface bar */}
                        <div className="w-full h-2 rounded-full overflow-hidden flex bg-slate-200 dark:bg-slate-800 border border-black/10">
                          {markedTrack.surfaceStats.map((stat, idx) => {
                            const pct = Math.min(100, (stat.distance / totalDist) * 100);
                            if (pct <= 0) return null;
                            const color = getSurfaceColor(stat.type);
                            return (
                              <div
                                key={idx}
                                style={{ width: `${pct}%`, backgroundColor: color }}
                                title={`${stat.type}: ${stat.distance.toFixed(1)} km (${pct.toFixed(0)}%)`}
                                className="h-full"
                              />
                            );
                          })}
                        </div>
                        {/* Breakdown rows */}
                        <div className="flex flex-col gap-0.5">
                          {markedTrack.surfaceStats.map((stat, idx) => {
                            const pct = (stat.distance / totalDist) * 100;
                            const color = getSurfaceColor(stat.type);
                            return (
                              <div key={idx} className="flex items-center justify-between text-[8.5px] font-sans font-medium text-slate-600 dark:text-slate-400">
                                <span className="flex items-center gap-1.5 truncate">
                                  <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: color }}></span>
                                  <span className="truncate">{stat.type}</span>
                                </span>
                                <span className="font-bold font-mono text-slate-800 dark:text-slate-200 shrink-0 ml-1">
                                  {stat.distance.toFixed(1)} km ({pct.toFixed(0)}%)
                                </span>
                              </div>
                            );
                          })}
                        </div>
                      </div>
                    );
                  }

                  // If track lacks surface analysis, offer quick OSM trigger
                  return (
                    <div className="mt-1.5 pt-1.5 border-t border-slate-200/70 dark:border-slate-800 font-sans">
                      <button
                        type="button"
                        disabled={analyzingSurfaces?.[markedTrack.id]}
                        onClick={(e) => {
                          e.stopPropagation();
                          onAnalyzeSurface?.(markedTrack.id, true);
                        }}
                        className={`w-full flex items-center justify-center gap-1 px-2 py-1 rounded text-[9px] font-bold text-white shadow-xs transition cursor-pointer ${
                          analyzingSurfaces?.[markedTrack.id] 
                            ? "bg-blue-400 cursor-wait" 
                            : "bg-blue-600 hover:bg-blue-700 active:scale-95"
                        }`}
                      >
                        <RefreshCw className={`w-2.5 h-2.5 ${analyzingSurfaces?.[markedTrack.id] ? "animate-spin" : ""}`} />
                        {analyzingSurfaces?.[markedTrack.id] ? "OSM-Analyse..." : "Oberflächen analysieren"}
                      </button>
                    </div>
                  );
                })()}
              </>
            ) : (() => {
              const markedTrack = tracks.find(t => t.id === markedTrackId);
              const isRunning = markedTrack?.activityType === 'running';
              const effectiveZones = isRunning 
                ? hrZones.map(z => ({ ...z, min: z.min + 10, max: z.max + 10 }))
                : hrZones;
              
              if (colorMode === 'hr') {
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#3b82f6" }}></span>
                      <span className="font-bold text-slate-700 dark:text-slate-350">KB: &lt; {effectiveZones[0].max} bpm</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#10b981" }}></span>
                      <span className="font-bold text-slate-700 dark:text-slate-350">GA1: {effectiveZones[1].min}-{effectiveZones[1].max} bpm</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#eab308" }}></span>
                      <span className="font-bold text-slate-700 dark:text-slate-350">GA2: {effectiveZones[2].min}-{effectiveZones[2].max} bpm</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#f97316" }}></span>
                      <span className="font-bold text-slate-700 dark:text-slate-350">EB: {effectiveZones[3].min}-{effectiveZones[3].max} bpm</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#ef4444" }}></span>
                      <span className="font-bold text-slate-700 dark:text-slate-350">SB: &gt; {effectiveZones[4].min} bpm</span>
                    </div>
                  </>
                );
              } else if (colorMode === 'power') {
                return (
                  <>
                    <div className="flex items-center gap-2">
                      <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#3b82f6" }}></span>
                      <span className="font-bold text-slate-700 dark:text-slate-350">KB: &lt; {Math.round(0.55 * ftp)} W</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#10b981" }}></span>
                      <span className="font-bold text-slate-700 dark:text-slate-350">GA1: {Math.round(0.55 * ftp)}-{Math.round(0.75 * ftp)} W</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#eab308" }}></span>
                      <span className="font-bold text-slate-700 dark:text-slate-350">GA2: {Math.round(0.75 * ftp)}-{Math.round(0.90 * ftp)} W</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#f97316" }}></span>
                      <span className="font-bold text-slate-700 dark:text-slate-350">EB: {Math.round(0.90 * ftp)}-{Math.round(1.05 * ftp)} W</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#ef4444" }}></span>
                      <span className="font-bold text-slate-700 dark:text-slate-350">SB: &gt; {Math.round(1.05 * ftp)} W</span>
                    </div>
                  </>
                );
              } else {
                // speed
                if (isRunning) {
                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#ef4444" }}></span>
                        <span className="font-bold text-slate-700 dark:text-slate-350">Sehr schnell: &lt; 4:00 min/km</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#f97316" }}></span>
                        <span className="font-bold text-slate-700 dark:text-slate-350">Schnell: 4:00-5:00 min/km</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#eab308" }}></span>
                        <span className="font-bold text-slate-700 dark:text-slate-350">Moderat: 5:00-6:00 min/km</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#10b981" }}></span>
                        <span className="font-bold text-slate-700 dark:text-slate-350">Locker: 6:00-7:00 min/km</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#3b82f6" }}></span>
                        <span className="font-bold text-slate-700 dark:text-slate-350">Sehr locker: &gt; 7:00 min/km</span>
                      </div>
                    </>
                  );
                } else {
                  return (
                    <>
                      <div className="flex items-center gap-2">
                        <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#ef4444" }}></span>
                        <span className="font-bold text-slate-700 dark:text-slate-350">Sehr schnell: &gt; 35 km/h</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#f97316" }}></span>
                        <span className="font-bold text-slate-700 dark:text-slate-350">Schnell: 30-35 km/h</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#eab308" }}></span>
                        <span className="font-bold text-slate-700 dark:text-slate-350">Moderat: 25-30 km/h</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#10b981" }}></span>
                        <span className="font-bold text-slate-700 dark:text-slate-350">Locker: 20-25 km/h</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#3b82f6" }}></span>
                        <span className="font-bold text-slate-700 dark:text-slate-350">Sehr locker: &lt; 20 km/h</span>
                      </div>
                    </>
                  );
                }
              }
            })()}
          </div>
        ) : (
          <button
            onClick={() => setIsLegendVisible(true)}
            className={`absolute ${isBottomBarObscuring ? 'bottom-[calc(5.25rem+env(safe-area-inset-bottom,0px))] sm:bottom-4' : 'bottom-2 sm:bottom-4'} left-2 sm:left-4 z-[400] flex items-center gap-1 px-2 py-1.5 sm:px-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-md border border-slate-200/60 dark:border-slate-800 rounded-xl text-[10px] font-bold text-slate-700 dark:text-slate-300 hover:scale-105 transition-all cursor-pointer font-mono select-none`}
            title="Legende anzeigen"
          >
            <span className="text-xs sm:text-sm">🗺️</span>
            <span className="hidden sm:inline">Legende</span>
          </button>
        )
      )}

      {/* 2-Track Karten-Vergleich Floating HUD Card */}
      {isComparisonMode && activeTrack && comparedTrack && (
        <div
          id="map-dual-compare-hud"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onTouchStart={(e) => e.stopPropagation()}
          onWheel={(e) => e.stopPropagation()}
          className="absolute top-2 left-12 sm:top-3 sm:left-14 z-[450] max-w-[calc(100vw-8.5rem)] sm:max-w-[520px] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-2xl border border-indigo-200/80 dark:border-indigo-800/70 shadow-xl pointer-events-auto select-none font-sans overflow-hidden transition-all duration-200"
        >
          {isCompareCollapsed ? (
            <div className="flex items-center gap-2 px-3 py-2 text-xs">
              <button
                type="button"
                onClick={() => setIsCompareCollapsed(false)}
                className="flex items-center gap-2 min-w-0 flex-1 text-left hover:opacity-85 cursor-pointer"
                title="2-Track Karten-Vergleich ausklappen"
              >
                <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-indigo-50 dark:bg-indigo-950/70 text-indigo-700 dark:text-indigo-300 font-black text-[10px] shrink-0">
                  <span className="w-2 h-2 rounded-full bg-blue-600" />
                  A vs B
                  <span className="w-2 h-2 rounded-full bg-orange-500" />
                </span>
                <span className="font-bold text-slate-800 dark:text-slate-100 truncate">
                  {activeTrack.name}
                </span>
                <span className="text-slate-400 font-bold shrink-0">vs</span>
                <span className="font-bold text-slate-800 dark:text-slate-100 truncate">
                  {comparedTrack.name}
                </span>
                <ChevronDown className="w-4 h-4 text-slate-400 shrink-0" />
              </button>
              <button
                type="button"
                onClick={() => {
                  triggerHaptic('light');
                  setCompareScrubFraction(null);
                  onExitMapComparison?.();
                }}
                className="px-2 py-1 rounded-lg text-[11px] font-bold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer shrink-0 transition-colors"
                title="Karten-Vergleich beenden"
              >
                Beenden
              </button>
            </div>
          ) : (
            <div className="p-3 sm:p-3.5 space-y-2.5">
              {/* Header Bar */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-1.5 min-w-0">
                  <div className="w-6 h-6 rounded-lg bg-indigo-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                    <GitCompare className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-black text-slate-800 dark:text-slate-100 tracking-tight truncate">
                      2-Track Karten-Vergleich
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      setRecenterTrigger(prev => prev + 1);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 cursor-pointer transition-colors"
                    title="Beide verglichenen Tracks optimal im Kartenfenster zentrieren"
                  >
                    <Maximize2 className="w-3 h-3 text-indigo-500" />
                    <span className="hidden sm:inline">Beide zentrieren</span>
                  </button>
                  {onOpenComparisonModal && (
                    <button
                      type="button"
                      onClick={() => {
                        triggerHaptic('light');
                        onOpenComparisonModal();
                      }}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-bold bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900/80 text-indigo-700 dark:text-indigo-200 border border-indigo-200/70 dark:border-indigo-700/60 cursor-pointer transition-colors"
                      title="Ausführliche Detail-Analyse im Vergleichs-Dialog öffnen"
                    >
                      <BarChart2 className="w-3 h-3" />
                      <span className="hidden sm:inline">Detail-Analyse</span>
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => setIsCompareCollapsed(true)}
                    className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer transition-colors"
                    title="Vergleichs-HUD minimieren"
                  >
                    <ChevronUp className="w-4 h-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      triggerHaptic('light');
                      setCompareScrubFraction(null);
                      onExitMapComparison?.();
                    }}
                    className="p-1 rounded-lg text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 cursor-pointer transition-colors"
                    title="2-Track Karten-Vergleich beenden"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Track A & B Selectors + Swap */}
              <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-1.5">
                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-blue-50/90 dark:bg-blue-950/40 border border-blue-200/80 dark:border-blue-800/70 min-w-0">
                  <span className="w-4 h-4 rounded-full bg-blue-600 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                    A
                  </span>
                  <select
                    aria-label="Track A auswählen"
                    value={activeTrack.id}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      if (!onStartMapComparison) return;
                      if (nextId === comparedTrack.id) {
                        onStartMapComparison(comparedTrack.id, activeTrack.id);
                      } else {
                        onStartMapComparison(nextId, comparedTrack.id);
                      }
                    }}
                    className="w-full min-w-0 bg-transparent text-[11px] font-bold text-slate-800 dark:text-slate-100 focus:outline-none truncate cursor-pointer"
                  >
                    {tracks.map(t => (
                      <option key={t.id} value={t.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
                        {t.name} ({t.distance.toFixed(1)} km)
                      </option>
                    ))}
                  </select>
                </div>

                <button
                  type="button"
                  onClick={() => {
                    triggerHaptic('light');
                    onStartMapComparison?.(comparedTrack.id, activeTrack.id);
                  }}
                  className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer transition-colors shrink-0"
                  title="Tracks A und B tauschen"
                >
                  <ArrowLeftRight className="w-3.5 h-3.5" />
                </button>

                <div className="flex items-center gap-1.5 px-2 py-1.5 rounded-xl bg-orange-50/90 dark:bg-orange-950/40 border border-orange-200/80 dark:border-orange-800/70 min-w-0">
                  <span className="w-4 h-4 rounded-full bg-orange-500 text-white text-[9px] font-black flex items-center justify-center shrink-0">
                    B
                  </span>
                  <select
                    aria-label="Track B auswählen"
                    value={comparedTrack.id}
                    onChange={(e) => {
                      const nextId = e.target.value;
                      if (!onStartMapComparison) return;
                      if (nextId === activeTrack.id) {
                        onStartMapComparison(comparedTrack.id, activeTrack.id);
                      } else {
                        onStartMapComparison(activeTrack.id, nextId);
                      }
                    }}
                    className="w-full min-w-0 bg-transparent text-[11px] font-bold text-slate-800 dark:text-slate-100 focus:outline-none truncate cursor-pointer"
                  >
                    {tracks.map(t => (
                      <option key={t.id} value={t.id} className="bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-100">
                        {t.name} ({t.distance.toFixed(1)} km)
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* 4-Column KPI Comparison & Deltas */}
              {(() => {
                const distDiff = activeTrack.distance - comparedTrack.distance;
                const eleA = activeTrack.ascent ?? 0;
                const eleB = comparedTrack.ascent ?? 0;
                const eleDiff = Math.round(eleA - eleB);
                const timeDiffSecs = Math.round(movingTimeSecs - comparedMovingTimeSecs);
                const speedA = activeTrack.duration && activeTrack.duration > 0
                  ? activeTrack.distance / (activeTrack.duration / 3600)
                  : estimatedSpeed;
                const speedB = comparedTrack.duration && comparedTrack.duration > 0
                  ? comparedTrack.distance / (comparedTrack.duration / 3600)
                  : estimatedSpeed;
                const speedDiff = speedA - speedB;
                const tempoLabelA = activeTrack.duration
                  ? (activeTrack.activityType === 'running'
                    ? formatPace(activeTrack.duration, activeTrack.distance)
                    : `${speedA.toFixed(1)} km/h`)
                  : (activeTrack.activityType === 'running'
                    ? getPaceString(estimatedSpeed)
                    : `${estimatedSpeed} km/h`);
                const tempoLabelB = comparedTrack.duration
                  ? (comparedTrack.activityType === 'running'
                    ? formatPace(comparedTrack.duration, comparedTrack.distance)
                    : `${speedB.toFixed(1)} km/h`)
                  : (comparedTrack.activityType === 'running'
                    ? getPaceString(estimatedSpeed)
                    : `${estimatedSpeed} km/h`);

                return (
                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5 text-[10px]">
                    <div className="px-2 py-1.5 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Distanz</div>
                      <div className="mt-0.5 font-mono font-bold text-blue-600 dark:text-blue-400">
                        A: {activeTrack.distance.toFixed(1)} km
                      </div>
                      <div className="font-mono font-bold text-orange-600 dark:text-orange-400">
                        B: {comparedTrack.distance.toFixed(1)} km
                      </div>
                      <div className="mt-0.5 text-[9px] font-mono font-extrabold text-indigo-600 dark:text-indigo-300">
                        Δ {distDiff >= 0 ? '+' : ''}{distDiff.toFixed(1)} km
                      </div>
                    </div>

                    <div className="px-2 py-1.5 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Anstieg</div>
                      <div className="mt-0.5 font-mono font-bold text-blue-600 dark:text-blue-400">
                        A: {Math.round(eleA)} hm
                      </div>
                      <div className="font-mono font-bold text-orange-600 dark:text-orange-400">
                        B: {Math.round(eleB)} hm
                      </div>
                      <div className="mt-0.5 text-[9px] font-mono font-extrabold text-indigo-600 dark:text-indigo-300">
                        Δ {eleDiff >= 0 ? '+' : ''}{eleDiff} hm
                      </div>
                    </div>

                    <div className="px-2 py-1.5 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Dauer</div>
                      <div className="mt-0.5 font-mono font-bold text-blue-600 dark:text-blue-400 truncate">
                        A: {formatDurationText(movingTimeSecs)}
                      </div>
                      <div className="font-mono font-bold text-orange-600 dark:text-orange-400 truncate">
                        B: {formatDurationText(comparedMovingTimeSecs)}
                      </div>
                      <div className="mt-0.5 text-[9px] font-mono font-extrabold text-indigo-600 dark:text-indigo-300 truncate">
                        Δ {Math.abs(timeDiffSecs) < 1 ? 'gleich' : `${timeDiffSecs >= 0 ? '+' : '-'}${formatDurationText(Math.abs(timeDiffSecs))}`}
                      </div>
                    </div>

                    <div className="px-2 py-1.5 rounded-xl bg-slate-50/90 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60">
                      <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Ø Tempo</div>
                      <div className="mt-0.5 font-mono font-bold text-blue-600 dark:text-blue-400 truncate">
                        A: {tempoLabelA}
                      </div>
                      <div className="font-mono font-bold text-orange-600 dark:text-orange-400 truncate">
                        B: {tempoLabelB}
                      </div>
                      <div className="mt-0.5 text-[9px] font-mono font-extrabold text-indigo-600 dark:text-indigo-300">
                        Δ {speedDiff >= 0 ? '+' : ''}{speedDiff.toFixed(1)} km/h
                      </div>
                    </div>
                  </div>
                );
              })()}

              {/* Sync Axis Mode & Interactive Dual Elevation Profile */}
              <div className="rounded-xl bg-slate-50/90 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-700/60 p-2 space-y-1.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-600 dark:text-slate-300">
                    <TrendingUp className="w-3.5 h-3.5 text-indigo-500" />
                    <span>Synchroner Höhen- &amp; Positionsabgleich</span>
                  </div>
                  <div className="inline-flex rounded-lg bg-slate-200/70 dark:bg-slate-900 p-0.5 text-[10px] font-bold">
                    <button
                      type="button"
                      onClick={() => setCompareSyncMode('distance')}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                        compareSyncMode === 'distance'
                          ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      Strecke (km)
                    </button>
                    <button
                      type="button"
                      onClick={() => setCompareSyncMode('progress')}
                      className={`px-2 py-0.5 rounded-md cursor-pointer transition-colors ${
                        compareSyncMode === 'progress'
                          ? 'bg-white dark:bg-slate-700 text-indigo-600 dark:text-indigo-300 shadow-xs'
                          : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                      }`}
                    >
                      Fortschritt (%)
                    </button>
                  </div>
                </div>

                {dualElevationChart ? (
                  <div className="relative">
                    <svg
                      viewBox="0 0 360 74"
                      preserveAspectRatio="none"
                      className="w-full h-[74px] rounded-lg bg-white/80 dark:bg-slate-900/70 border border-slate-200/60 dark:border-slate-700/50 cursor-crosshair touch-none"
                      onMouseMove={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                        setCompareScrubFraction(frac);
                      }}
                      onClick={(e) => {
                        const rect = e.currentTarget.getBoundingClientRect();
                        const frac = Math.max(0, Math.min(1, (e.clientX - rect.left) / Math.max(1, rect.width)));
                        setCompareScrubFraction(frac);
                      }}
                      onTouchMove={(e) => {
                        if (e.touches.length === 0) return;
                        const rect = e.currentTarget.getBoundingClientRect();
                        const frac = Math.max(0, Math.min(1, (e.touches[0].clientX - rect.left) / Math.max(1, rect.width)));
                        setCompareScrubFraction(frac);
                      }}
                    >
                      <line x1="0" y1="18" x2="360" y2="18" stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3,3" />
                      <line x1="0" y1="37" x2="360" y2="37" stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3,3" />
                      <line x1="0" y1="56" x2="360" y2="56" stroke="currentColor" strokeOpacity="0.08" strokeDasharray="3,3" />

                      {dualElevationChart.areaA && (
                        <path d={dualElevationChart.areaA} fill="rgba(37, 99, 235, 0.14)" />
                      )}
                      {dualElevationChart.areaB && (
                        <path d={dualElevationChart.areaB} fill="rgba(249, 115, 22, 0.12)" />
                      )}
                      {dualElevationChart.pathA && (
                        <path d={dualElevationChart.pathA} fill="none" stroke="#2563eb" strokeWidth="2" strokeLinejoin="round" />
                      )}
                      {dualElevationChart.pathB && (
                        <path d={dualElevationChart.pathB} fill="none" stroke="#f97316" strokeWidth="2" strokeLinejoin="round" />
                      )}

                      {syncedComparisonPair && (() => {
                        const cursorX = Number((syncedComparisonPair.fraction * 360).toFixed(1));
                        const span = Math.max(10, dualElevationChart.maxEle - dualElevationChart.minEle);
                        const eleY = (ele?: number) => {
                          if (ele === undefined || !Number.isFinite(ele)) return null;
                          const raw = 74 - 6 - (((ele - dualElevationChart.minEle) / span) * (74 - 12));
                          return Number(Math.max(3, Math.min(71, raw)).toFixed(1));
                        };
                        const yA = eleY(syncedComparisonPair.ptA.ele);
                        const yB = eleY(syncedComparisonPair.ptB.ele);
                        return (
                          <>
                            <line
                              x1={cursorX}
                              y1={0}
                              x2={cursorX}
                              y2={74}
                              stroke="#4f46e5"
                              strokeWidth="1.5"
                              strokeDasharray="3,2"
                            />
                            {yA !== null && (
                              <circle cx={cursorX} cy={yA} r="3.2" fill="#2563eb" stroke="#ffffff" strokeWidth="1.5" />
                            )}
                            {yB !== null && (
                              <circle cx={cursorX} cy={yB} r="3.2" fill="#f97316" stroke="#ffffff" strokeWidth="1.5" />
                            )}
                          </>
                        );
                      })()}
                    </svg>
                    <div className="flex justify-between text-[9px] font-mono text-slate-400 mt-0.5 px-0.5">
                      <span>Min: {dualElevationChart.minEle} m</span>
                      <span>Max: {dualElevationChart.maxEle} m</span>
                    </div>
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-400 italic py-1">
                    Keine gemeinsamen Höhendaten vorhanden – Positionssynchronisation über Regler oder Karte aktiv.
                  </div>
                )}

                {/* Scrubber Range Slider */}
                <div className="flex items-center gap-2">
                  <input
                    type="range"
                    aria-label="Synchroner Vergleichs-Regler"
                    min={0}
                    max={1000}
                    value={Math.round((syncedComparisonPair?.fraction ?? compareScrubFraction ?? 0) * 1000)}
                    onChange={(e) => setCompareScrubFraction(Number(e.target.value) / 1000)}
                    className="w-full h-1.5 accent-indigo-600 cursor-pointer"
                  />
                  {compareScrubFraction !== null && (
                    <button
                      type="button"
                      onClick={() => setCompareScrubFraction(null)}
                      className="px-1.5 py-0.5 rounded-md text-[9px] font-bold bg-slate-200/80 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-600 dark:text-slate-200 cursor-pointer shrink-0"
                      title="Scrubbing zurücksetzen (Hover auf Karte wieder aktiv)"
                    >
                      Reset
                    </button>
                  )}
                </div>

                {/* Live Position Delta Readout */}
                {syncedComparisonPair ? (
                  <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 pt-1 border-t border-slate-200/60 dark:border-slate-700/60 text-[10px] font-mono">
                    <span className="font-bold text-blue-600 dark:text-blue-400">
                      A: {syncedComparisonPair.ptA.distKm.toFixed(2)} km{syncedComparisonPair.ptA.ele !== undefined ? ` · ${Math.round(syncedComparisonPair.ptA.ele)} m` : ''}
                    </span>
                    <span className="font-bold text-orange-600 dark:text-orange-400">
                      B: {syncedComparisonPair.ptB.distKm.toFixed(2)} km{syncedComparisonPair.ptB.ele !== undefined ? ` · ${Math.round(syncedComparisonPair.ptB.ele)} m` : ''}
                    </span>
                    <span className="font-extrabold text-indigo-600 dark:text-indigo-300">
                      Luftlinie: {syncedComparisonPair.spatialGapKm < 1
                        ? `${Math.round(syncedComparisonPair.spatialGapKm * 1000)} m`
                        : `${syncedComparisonPair.spatialGapKm.toFixed(2)} km`}
                      {syncedComparisonPair.eleDiffM !== null ? ` · Δ Höhe ${syncedComparisonPair.eleDiffM >= 0 ? '+' : ''}${syncedComparisonPair.eleDiffM} m` : ''}
                    </span>
                  </div>
                ) : (
                  <div className="text-[10px] text-slate-400 dark:text-slate-500 pt-0.5">
                    Tipp: Über eine Route auf der Karte fahren oder Regler verschieben, um beide Punkte live abzugleichen.
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Active Track Stats Overlay Card */}
      {!isComparisonMode && activeTrack && (
        <div 
          className={`absolute top-2 left-12 sm:top-4 sm:left-14 z-[400] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-lg pointer-events-auto select-none font-sans transition-all duration-300 overflow-hidden max-w-[calc(100vw-3.75rem)] sm:max-w-[340px] ${
            hoveredPoint ? 'opacity-0 pointer-events-none sm:opacity-100 sm:pointer-events-auto' : 'opacity-100'
          }`}
          id="active-track-stats-overlay"
        >
          {isStatsCollapsed ? (
            <button
              onClick={() => {
                setIsStatsCollapsed(false);
                setRecenterTrigger(prev => prev + 1);
              }}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-750 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer transition-colors min-h-[44px] touch-manipulation"
              title="Statistiken ausklappen und Aktivität zentrieren"
            >
              <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-xs" style={{ backgroundColor: activeTrack.color || '#3b82f6' }} />
              {activeTrack.activityType === 'running' ? (
                <Activity className="w-3.5 h-3.5 text-emerald-500 shrink-0" />
              ) : (
                <Bike className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              )}
              <span className="font-extrabold truncate max-w-[120px] sm:max-w-[160px]">{activeTrack.name}</span>
              <span className="text-slate-400 dark:text-slate-500">•</span>
              <span className="font-semibold text-slate-600 dark:text-slate-400 font-mono">
                {activeTrack.distance.toFixed(1)} km
              </span>
              <ChevronDown className="w-4 h-4 text-slate-400 ml-1 shrink-0" />
            </button>
          ) : (
            <div className="flex flex-col p-3 sm:p-3.5">
              {/* Header */}
              <div className="flex items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-2 mb-2.5">
                <div 
                  onClick={() => setRecenterTrigger(prev => prev + 1)}
                  className="flex items-center gap-2 truncate cursor-pointer hover:opacity-85 active:scale-[0.98] transition-all bg-slate-50/70 hover:bg-slate-105 dark:bg-slate-800/45 dark:hover:bg-slate-800 px-2 py-1 rounded-lg border border-slate-100 dark:border-slate-800/80"
                  title="Aktivität auf Karte zentrieren"
                >
                  <div className="w-3 h-3 rounded-full shrink-0 shadow-sm" style={{ backgroundColor: activeTrack.color || '#3b82f6' }} />
                  {activeTrack.activityType === 'running' ? (
                    <Activity className="w-4 h-4 text-emerald-500 shrink-0" />
                  ) : (
                    <Bike className="w-4 h-4 text-indigo-500 shrink-0" />
                  )}
                  <h4 className="font-black text-xs sm:text-sm text-slate-800 dark:text-slate-200 truncate flex items-center gap-1.5" title={activeTrack.name}>
                    {activeTrack.name}
                    <Target className="w-3.5 h-3.5 text-indigo-500 hover:rotate-45 transition-transform" />
                  </h4>
                </div>
                <button
                  onClick={() => setIsStatsCollapsed(true)}
                  className="text-slate-400 hover:text-slate-650 dark:hover:text-slate-200 cursor-pointer p-0.5 rounded-lg hover:bg-slate-100 dark:hover:bg-slate-800 transition"
                  title="Statistiken minimieren"
                >
                  <ChevronUp className="w-4 h-4" />
                </button>
              </div>

              {/* Grid of Key Metrics */}
              <div className="grid grid-cols-3 gap-2">
                {/* Distance Key Metric */}
                <div className="bg-slate-50/65 dark:bg-slate-950/25 border border-slate-100 dark:border-slate-800/40 rounded-lg p-2 flex flex-col items-center text-center">
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider mb-0.5">Strecke</span>
                  <span className="font-extrabold text-[11px] sm:text-xs text-slate-800 dark:text-slate-200 font-mono">
                    {activeTrack.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                  </span>
                </div>

                {/* Elevation Gain Key Metric */}
                <div 
                  onClick={(e) => {
                    e.stopPropagation();
                    const climbs = activeTrack.climbs && activeTrack.climbs.length > 0 ? activeTrack.climbs : findClimbs(activeTrack.points || []);
                    if (climbs.length > 0 && onSelection) {
                      const pts = climbs.flatMap(c => activeTrack.points.slice(c.startIndex, c.endIndex + 1));
                      if (pts.length > 0) {
                        const lats = pts.map(p => p.lat);
                        const lngs = pts.map(p => p.lng);
                        const minLat = Math.min(...lats);
                        const maxLat = Math.max(...lats);
                        const minLng = Math.min(...lngs);
                        const maxLng = Math.max(...lngs);
                        const latBuf = Math.max((maxLat - minLat) * 0.1, 0.002);
                        const lngBuf = Math.max((maxLng - minLng) * 0.1, 0.002);
                        onSelection({
                          minLat: minLat - latBuf,
                          maxLat: maxLat + latBuf,
                          minLng: minLng - lngBuf,
                          maxLng: maxLng + lngBuf
                        });
                      }
                    }
                  }}
                  className="bg-emerald-500/[0.04] dark:bg-emerald-950/[0.08] border border-emerald-100/30 dark:border-emerald-900/15 hover:bg-emerald-100/40 dark:hover:bg-emerald-900/30 rounded-lg p-2 flex flex-col items-center text-center cursor-pointer transition-colors"
                  title="Klicken zum Zoomen auf Anstiege auf der Karte"
                >
                  <span className="text-[9px] text-emerald-600 dark:text-emerald-500 font-bold uppercase tracking-wider mb-0.5 flex items-center gap-0.5">
                    <TrendingUp className="w-2.5 h-2.5 shrink-0" /> Anstieg 🔍
                  </span>
                  <span className="font-extrabold text-[11px] sm:text-xs text-emerald-700 dark:text-emerald-400 font-mono font-black">
                    +{Math.round(activeTrack.ascent).toLocaleString('de-DE')}m
                  </span>
                </div>

                {/* Estimated Moving Time Key Metric */}
                <div className="bg-indigo-500/[0.04] dark:bg-indigo-950/[0.08] border border-indigo-100/30 dark:border-indigo-900/15 rounded-lg p-2 flex flex-col items-center text-center">
                  <span className="text-[9px] text-indigo-600 dark:text-indigo-450 font-bold uppercase tracking-wider mb-0.5 flex items-center gap-0.5">
                    <Clock className="w-2.5 h-2.5 shrink-0" /> Zeit (ca.)
                  </span>
                  <span className="font-extrabold text-[10px] sm:text-[11px] text-indigo-750 dark:text-indigo-400 font-mono">
                    {formatDurationText(movingTimeSecs)}
                  </span>
                </div>
              </div>

              {/* Extra Info (Pace/Tempo and Activity Badge) */}
              <div className="mt-2.5 pt-2 border-t border-slate-100/60 dark:border-slate-800/60 flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                <span className="font-sans font-semibold text-slate-400">Tempo / Geschwindigkeit</span>
                <span className="font-extrabold text-slate-700 dark:text-slate-300 tabular-nums">
                  {activeTrack.duration ? (
                    activeTrack.activityType === 'running' 
                      ? formatPace(activeTrack.duration, activeTrack.distance)
                      : `${(activeTrack.distance / (activeTrack.duration / 3600)).toFixed(1)} km/h`
                  ) : (
                    activeTrack.activityType === 'running'
                      ? getPaceString(estimatedSpeed)
                      : `${estimatedSpeed} km/h`
                  )}
                </span>
              </div>

              {/* Direct Quick Analysis Button on Map Card */}
              {onOpenIntensiveAnalysis && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenIntensiveAnalysis(activeTrack.id);
                  }}
                  className="mt-2.5 w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-[11px] font-bold text-white bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-700 hover:to-indigo-700 shadow-sm cursor-pointer transition-all"
                  title="Intensive Track Analysis & Physical Pacing Engine öffnen"
                >
                  <Sparkles className="w-3.5 h-3.5 text-purple-200" />
                  <span>Intensive Track & Pacing Analyse</span>
                </button>
              )}

              {/* Quick 2-Track Map Comparison Trigger */}
              {tracks.length >= 2 && onStartMapComparison && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    triggerHaptic('medium');
                    onStartMapComparison(activeTrack.id);
                  }}
                  className="mt-2 w-full flex items-center justify-center gap-1.5 py-1.5 px-3 rounded-lg text-[11px] font-bold text-indigo-700 dark:text-indigo-200 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900/70 border border-indigo-200/80 dark:border-indigo-700/60 shadow-xs cursor-pointer transition-all"
                  title="Diesen Track mit einem zweiten GPX-Track direkt auf der Karte vergleichen"
                  id="btn-map-quick-compare"
                >
                  <GitCompare className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" />
                  <span>Mit 2. Track auf Karte vergleichen</span>
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Map;
