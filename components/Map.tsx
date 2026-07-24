
import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, useMapEvents, useMap, Marker, Popup, Rectangle, Circle } from 'react-leaflet';
import L from 'leaflet';
import { GPXTrack, MapLayer, MAP_LAYERS, GPXPoint, TextMarker } from '../types';
import { calculateDistance, formatPace, getPaceString } from '../utils/gpxUtils';
import { getApiUrl } from '../utils/api';
import { triggerHaptic, shareTrackNative } from '../utils/haptics';
import { Palette, Bike, Activity, Clock, TrendingUp, ChevronDown, ChevronUp, Target, Locate, Share2, Compass, Navigation, Plus, Minus, Maximize2 } from 'lucide-react';

// Fix for default marker icons in Leaflet + React
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

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
  isFlying?: boolean;
  textMarkers: TextMarker[];
  onAddTextMarker: (marker: Omit<TextMarker, 'id'>) => void;
  onDeleteTextMarker: (id: string) => void;
  hideLegend?: boolean;
  ftp?: number;
  isDark?: boolean;
  showCyclingHeatmap?: boolean;
  showRunningHeatmap?: boolean;
  showDbCyclingHeatmap?: boolean;
  showDbRunningHeatmap?: boolean;
}

const ZoomToTracks = ({ tracks }: { tracks: GPXTrack[] }) => {
  const map = useMap();
  const prevTracksLength = React.useRef(tracks.length);

  useEffect(() => {
    const visibleTracks = tracks.filter(t => t.visible);
    if (visibleTracks.length > prevTracksLength.current && visibleTracks.length > 0) {
      const bounds = L.latLngBounds(visibleTracks[0].points.map(p => [p.lat, p.lng]));
      visibleTracks.forEach(t => {
        t.points.forEach(p => bounds.extend([p.lat, p.lng]));
      });
      map.fitBounds(bounds, { padding: [50, 50] });
    }
    prevTracksLength.current = tracks.length;
  }, [tracks, map]);
  return null;
};

const ZoomToMarkedTrack = ({ markedTrackId, tracks }: { markedTrackId: string | null; tracks: GPXTrack[] }) => {
  const map = useMap();
  const prevMarkedId = React.useRef<string | null>(null);

  useEffect(() => {
    if (markedTrackId && markedTrackId !== prevMarkedId.current) {
      const track = tracks.find(t => t.id === markedTrackId);
      if (track && !track.isVirtual && track.points && track.points.length > 0) {
        const validPoints = track.points
          .map(p => {
            if (!p) return null;
            const latVal = typeof p.lat === 'number' ? p.lat : parseFloat(p.lat as any);
            const lngVal = typeof p.lng === 'number' ? p.lng : parseFloat(p.lng as any);
            if (isNaN(latVal) || isNaN(lngVal)) return null;
            return { ...p, lat: latVal, lng: lngVal };
          })
          .filter((p): p is GPXPoint => p !== null);

        if (validPoints.length > 0) {
          const bounds = L.latLngBounds(validPoints.map(p => [p.lat, p.lng]));
          map.fitBounds(bounds, { padding: [50, 50] });
        }
      }
    }
    prevMarkedId.current = markedTrackId;
  }, [markedTrackId, tracks, map]);

  return null;
};

const ZoomToActiveTrack = ({ activeTrack, recenterTrigger }: { activeTrack: GPXTrack | null; recenterTrigger: number }) => {
  const map = useMap();

  useEffect(() => {
    if (activeTrack && !activeTrack.isVirtual && activeTrack.points && activeTrack.points.length > 0 && recenterTrigger > 0) {
      const validPoints = activeTrack.points
        .map(p => {
          if (!p) return null;
          const latVal = typeof p.lat === 'number' ? p.lat : parseFloat(p.lat as any);
          const lngVal = typeof p.lng === 'number' ? p.lng : parseFloat(p.lng as any);
          if (isNaN(latVal) || isNaN(lngVal)) return null;
          return { ...p, lat: latVal, lng: lngVal };
        })
        .filter((p): p is GPXPoint => p !== null);

      if (validPoints.length > 0) {
        const bounds = L.latLngBounds(validPoints.map(p => [p.lat, p.lng]));
        map.fitBounds(bounds, { padding: [50, 50] });
      }
    }
  }, [recenterTrigger, activeTrack, map]);

  return null;
};

const ZoomToSelection = ({ bounds }: { bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null }) => {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds([
        [bounds.minLat, bounds.minLng],
        [bounds.maxLat, bounds.maxLng]
      ], { padding: [50, 50] });
    }
  }, [bounds, map]);
  return null;
};

const MapResizer = ({ markedTrackId, tracksLength }: { markedTrackId: string | null, tracksLength: number }) => {
  const map = useMap();
  useEffect(() => {
    // Wait for CSS transitions (like the elevation profile opening) to finish
    const timeout = setTimeout(() => {
      map.invalidateSize();
    }, 300);
    return () => clearTimeout(timeout);
  }, [markedTrackId, tracksLength, map]);
  return null;
};

const FlyoverFollow = ({ point, active }: { point: GPXPoint | null, active: boolean }) => {
  const map = useMap();
  const lastTargetRef = useRef<[number, number] | null>(null);

  useEffect(() => {
    if (active && point) {
      // Use a smaller threshold for following during flight to ensure smoothness
      const isSignificant = !lastTargetRef.current || 
        Math.abs(lastTargetRef.current[0] - point.lat) > 0.00005 ||
        Math.abs(lastTargetRef.current[1] - point.lng) > 0.00005;

      if (isSignificant) {
        lastTargetRef.current = [point.lat, point.lng];
        // Short duration prevents animation queue buildup
        map.panTo([point.lat, point.lng], { animate: true, duration: 0.3, easeLinearity: 0.1 });
      }
    }
  }, [point, active, map]);
  return null;
};

const UserLocationMarker = ({ isTracking, autoCenter }: { isTracking: boolean; autoCenter: boolean }) => {
  const map = useMap();
  const [position, setPosition] = useState<{ lat: number; lng: number; accuracy: number } | null>(null);

  useEffect(() => {
    if (!isTracking || typeof window === 'undefined' || !('geolocation' in navigator)) {
      setPosition(null);
      return;
    }

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const { latitude: lat, longitude: lng, accuracy } = pos.coords;
        setPosition({ lat, lng, accuracy });
        if (autoCenter) {
          map.panTo([lat, lng], { animate: true });
        }
      },
      (err) => {
        console.warn('Geolocation error:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 3000 }
    );

    return () => {
      navigator.geolocation.clearWatch(watchId);
    };
  }, [isTracking, autoCenter, map]);

  if (!isTracking || !position) return null;

  const userIcon = L.divIcon({
    className: 'user-location-pulse',
    html: `
      <div style="width: 18px; height: 18px; background-color: #2563eb; border: 3px solid #ffffff; border-radius: 50%; box-shadow: 0 0 10px rgba(37,99,235,0.8);"></div>
    `,
    iconSize: [18, 18],
    iconAnchor: [9, 9],
  });

  return (
    <>
      <LeafletMarker position={[position.lat, position.lng]} icon={userIcon}>
        <Popup>
          <div className="text-xs font-bold text-slate-800 p-1">
            📍 Ihr aktueller Standort<br/>
            <span className="text-[10px] text-slate-500 font-normal">Genauigkeit: ~{Math.round(position.accuracy)}m</span>
          </div>
        </Popup>
      </LeafletMarker>
      {position.accuracy > 0 && position.accuracy < 500 && (
        <LeafletCircle
          center={[position.lat, position.lng]}
          radius={position.accuracy}
          pathOptions={{ fillColor: '#3b82f6', fillOpacity: 0.15, color: '#60a5fa', weight: 1.5, dashArray: '3 4' }}
        />
      )}
    </>
  );
};

const MobileZoomControls = ({ tracks, markedTrackId }: { tracks: GPXTrack[]; markedTrackId: string | null }) => {
  const map = useMap();

  const stopEvent = (e: React.SyntheticEvent) => {
    e.stopPropagation();
  };

  const handleZoomIn = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    triggerHaptic('light');
    map.zoomIn();
  };

  const handleZoomOut = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    triggerHaptic('light');
    map.zoomOut();
  };

  const handleFitToTracks = (e: React.SyntheticEvent) => {
    e.stopPropagation();
    e.preventDefault();
    triggerHaptic('medium');

    const targetTracks = tracks.filter(t => t.visible || t.id === markedTrackId);
    const allPoints: [number, number][] = [];

    targetTracks.forEach(t => {
      if (t.points && t.points.length > 0) {
        t.points.forEach(p => {
          if (p && typeof p.lat === 'number' && typeof p.lng === 'number' && !isNaN(p.lat) && !isNaN(p.lng)) {
            allPoints.push([p.lat, p.lng]);
          }
        });
      }
    });

    if (allPoints.length > 0) {
      const bounds = L.latLngBounds(allPoints);
      map.fitBounds(bounds, { padding: [50, 50], animate: true });
    }
  };

  return (
    <div 
      className="leaflet-control absolute bottom-36 right-2.5 sm:bottom-28 sm:right-4 z-[400] flex flex-col gap-2 pointer-events-auto select-none"
      onClick={stopEvent}
      onDoubleClick={stopEvent}
      onMouseDown={stopEvent}
      onTouchStart={stopEvent}
      onPointerDown={stopEvent}
    >
      <div className="flex flex-col rounded-2xl bg-white/95 dark:bg-slate-900/95 border border-slate-200/80 dark:border-slate-800 shadow-xl backdrop-blur-md overflow-hidden">
        <button
          type="button"
          onClick={handleZoomIn}
          onMouseDown={stopEvent}
          onTouchStart={stopEvent}
          className="w-13 h-13 sm:w-12 sm:h-12 flex items-center justify-center text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-blue-500 active:text-white dark:active:bg-blue-600 transition-all cursor-pointer border-b border-slate-200/80 dark:border-slate-800 active:scale-95 touch-manipulation"
          title="Karte vergrößern (+)"
          aria-label="Karte vergrößern"
        >
          <Plus className="w-6.5 h-6.5 stroke-[3]" />
        </button>
        <button
          type="button"
          onClick={handleZoomOut}
          onMouseDown={stopEvent}
          onTouchStart={stopEvent}
          className="w-13 h-13 sm:w-12 sm:h-12 flex items-center justify-center text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-blue-500 active:text-white dark:active:bg-blue-600 transition-all cursor-pointer border-b border-slate-200/80 dark:border-slate-800 active:scale-95 touch-manipulation"
          title="Karte verkleinern (-)"
          aria-label="Karte verkleinern"
        >
          <Minus className="w-6.5 h-6.5 stroke-[3]" />
        </button>
        <button
          type="button"
          onClick={handleFitToTracks}
          onMouseDown={stopEvent}
          onTouchStart={stopEvent}
          className="w-13 h-13 sm:w-12 sm:h-12 flex items-center justify-center text-slate-800 dark:text-slate-100 hover:bg-slate-100 dark:hover:bg-slate-800 active:bg-indigo-500 active:text-white dark:active:bg-indigo-600 transition-all cursor-pointer active:scale-95 touch-manipulation"
          title="Karte auf alle ausgewählten und sichtbaren Strecken ausrichten"
          aria-label="Auf ausgewählte und sichtbare Strecken zoomen"
          id="btn-fit-tracks-zoom"
        >
          <Maximize2 className="w-5.5 h-5.5 stroke-[2.5] text-indigo-600 dark:text-indigo-400" />
        </button>
      </div>
    </div>
  );
};

const SyncView = ({ mapView, onMapViewChange, isFlying }: { mapView: any, onMapViewChange: any, isFlying: boolean }) => {
  const map = useMap();
  const isInternalUpdate = useRef(false);
  
  // Sync map instance to mapView prop (only when external change)
  useEffect(() => {
    if (isFlying || isInternalUpdate.current) {
      isInternalUpdate.current = false;
      return;
    }
    
    const currentCenter = map.getCenter();
    const currentZoom = map.getZoom();
    
    const isDifferent = 
        Math.abs(currentCenter.lat - mapView.lat) > 0.00001 || 
        Math.abs(currentCenter.lng - mapView.lng) > 0.00001 || 
        Math.abs(currentZoom - mapView.zoom) > 0.05;

    if (isDifferent) {
      map.setView([mapView.lat, mapView.lng], mapView.zoom, { animate: false });
    }
  }, [mapView.lat, mapView.lng, mapView.zoom, map, isFlying]);

  useMapEvents({
    moveend() {
      if (isFlying) return;
      const center = map.getCenter();
      const zoom = map.getZoom();
      
      const isSignificant =
        Math.abs(center.lat - mapView.lat) > 0.00001 ||
        Math.abs(center.lng - mapView.lng) > 0.00001 ||
        Math.abs(zoom - mapView.zoom) > 0.05;

      if (isSignificant) {
        isInternalUpdate.current = true;
        onMapViewChange({
          lat: center.lat,
          lng: center.lng,
          zoom: zoom,
          pitch: 0,
          bearing: 0
        });
      }
    }
  });

  return null;
};

const SelectionTool = ({ active, onSelection, currentBounds }: { active: boolean, onSelection: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void, currentBounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null }) => {
  const map = useMap();
  const [startPoint, setStartPoint] = useState<L.LatLng | null>(null);
  const [currentPoint, setCurrentPoint] = useState<L.LatLng | null>(null);
  const [selectionMode, setSelectionMode] = useState(false);

  useEffect(() => {
    if (!active) {
      setStartPoint(null);
      setCurrentPoint(null);
      setSelectionMode(false);
      map.dragging.enable();
    }
  }, [active, map]);

  useEffect(() => {
    if (selectionMode) {
      map.dragging.disable();
    } else {
      map.dragging.enable();
    }
  }, [selectionMode, map]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (active && e.key === 'Alt') {
        map.dragging.disable();
      }
    };
    const handleKeyUp = (e: KeyboardEvent) => {
      if (active && e.key === 'Alt') {
        if (!selectionMode) {
          map.dragging.enable();
        }
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, [active, map, selectionMode]);

  useMapEvents({
    mousedown(e) {
      if (!active) return;
      const isAlt = e.originalEvent.altKey;
      if (!isAlt && !selectionMode) return;
      
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
      
      if (!e.originalEvent.altKey && !selectionMode) {
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
      <div className="leaflet-top leaflet-left mt-20 ml-3 pointer-events-auto">
        <div className="leaflet-bar leaflet-control">
          <button
            className={`w-8 h-8 flex items-center justify-center bg-white hover:bg-slate-50 transition-colors ${selectionMode ? 'text-indigo-600 bg-indigo-50' : 'text-slate-600'}`}
            onClick={(e) => {
              L.DomEvent.stopPropagation(e);
              setSelectionMode(!selectionMode);
            }}
            title={selectionMode ? "Auswahlmodus beenden" : "Auswahlmodus aktivieren (für Mobile/iPad)"}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <rect width="18" height="18" x="3" y="3" rx="2" />
              <path d="M3 9h18" />
              <path d="M9 21V9" />
            </svg>
          </button>
        </div>
      </div>
    </>
  );
};

const LeafletMapContainer = MapContainer as any;
const LeafletTileLayer = TileLayer as any;
const LeafletPolyline = Polyline as any;
const LeafletMarker = Marker as any;
const LeafletCircle = Circle as any;

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
  isFlying = false,
  textMarkers,
  onAddTextMarker,
  onDeleteTextMarker,
  hideLegend = false,
  ftp = 250,
  isDark = false,
  showCyclingHeatmap = false,
  showRunningHeatmap = false,
  showDbCyclingHeatmap = false,
  showDbRunningHeatmap = false
}) => {
  const layer = MAP_LAYERS[activeLayer];
  const [pendingMarker, setPendingMarker] = useState<{lat: number, lng: number} | null>(null);
  const [isColorMenuOpen, setIsColorMenuOpen] = useState(false);
  const [isLegendVisible, setIsLegendVisible] = useState(false);
  const [colorMode, setColorMode] = useState<'default' | 'hr' | 'power' | 'speed'>('default');
  const [isStatsCollapsed, setIsStatsCollapsed] = useState(true);
  const [recenterTrigger, setRecenterTrigger] = useState(0);
  const [isTrackingLocation, setIsTrackingLocation] = useState(false);
  const [autoCenterLocation, setAutoCenterLocation] = useState(true);

  // States for database activity heatmaps
  const [dbCyclingPaths, setDbCyclingPaths] = useState<[number, number][][]>([]);
  const [dbRunningPaths, setDbRunningPaths] = useState<[number, number][][]>([]);
  const [isLoadingDbCycling, setIsLoadingDbCycling] = useState(false);
  const [isLoadingDbRunning, setIsLoadingDbRunning] = useState(false);

  // Helper to normalize raw database track points
  const normalizeDbPoints = (rawPoints: any[]): [number, number][] => {
    if (!rawPoints || rawPoints.length === 0) return [];
    const sample = rawPoints.find(p => p.lat !== undefined && p.lng !== undefined && p.lat !== 0 && p.lng !== 0) || rawPoints[0];
    if (!sample) return [];

    const rawLat = Math.abs(parseFloat(sample.lat));
    const rawLng = Math.abs(parseFloat(sample.lng));

    if (isNaN(rawLat) || isNaN(rawLng)) return [];

    let scale = 1.0;
    if (rawLat > 180 || rawLng > 180) {
      if (rawLat > 10000000) {
        scale = 180 / 2147483648;
      } else {
        scale = 1 / 10000000;
      }
    }

    return rawPoints
      .map(p => {
        const latVal = parseFloat(p.lat) * scale;
        const lngVal = parseFloat(p.lng) * scale;
        if (isNaN(latVal) || isNaN(lngVal)) return null;
        return [latVal, lngVal] as [number, number];
      })
      .filter((coords): coords is [number, number] => coords !== null);
  };

  useEffect(() => {
    if (showDbCyclingHeatmap && dbCyclingPaths.length === 0) {
      setIsLoadingDbCycling(true);
      fetch(getApiUrl('/api/garmin-activities?activityType=cycling'))
        .then(res => res.json())
        .then(json => {
          if (json.success && Array.isArray(json.activities)) {
            const paths: [number, number][][] = [];
            json.activities.forEach((act: any) => {
              if (act.points_json) {
                try {
                  const pts = JSON.parse(act.points_json);
                  if (Array.isArray(pts) && pts.length > 1) {
                    const normalized = normalizeDbPoints(pts);
                    if (normalized.length > 1) {
                      paths.push(normalized);
                    }
                  }
                } catch (e) {
                  console.error('Error parsing heatmap points:', e);
                }
              }
            });
            setDbCyclingPaths(paths);
          }
        })
        .catch(err => console.error('Failed to fetch cycling heatmap:', err))
        .finally(() => setIsLoadingDbCycling(false));
    }
  }, [showDbCyclingHeatmap, dbCyclingPaths.length]);

  useEffect(() => {
    if (showDbRunningHeatmap && dbRunningPaths.length === 0) {
      setIsLoadingDbRunning(true);
      fetch(getApiUrl('/api/garmin-activities?activityType=running'))
        .then(res => res.json())
        .then(json => {
          if (json.success && Array.isArray(json.activities)) {
            const paths: [number, number][][] = [];
            json.activities.forEach((act: any) => {
              if (act.points_json) {
                try {
                  const pts = JSON.parse(act.points_json);
                  if (Array.isArray(pts) && pts.length > 1) {
                    const normalized = normalizeDbPoints(pts);
                    if (normalized.length > 1) {
                      paths.push(normalized);
                    }
                  }
                } catch (e) {
                  console.error('Error parsing heatmap points:', e);
                }
              }
            });
            setDbRunningPaths(paths);
          }
        })
        .catch(err => console.error('Failed to fetch running heatmap:', err))
        .finally(() => setIsLoadingDbRunning(false));
    }
  }, [showDbRunningHeatmap, dbRunningPaths.length]);

  // Local state for POI options
  const [showPOIs, setShowPOIs] = useState(true);
  const [poiFilters, setPoiFilters] = useState<Record<'water' | 'supermarket' | 'restaurant' | 'gas_station', boolean>>({
    water: true,
    supermarket: true,
    restaurant: true,
    gas_station: true,
  });

  // Deterministic POI Generator along active/visible routes
  const poiList = React.useMemo(() => {
    const list: POI[] = [];
    const visibleTracks = tracks.filter(t => t.visible && !t.isVirtual && t.points && t.points.length > 0);

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
  }, [tracks, calculateDistance]);

  const visiblePOIs = React.useMemo(() => {
    if (!showPOIs) return [];
    return poiList.filter(poi => poiFilters[poi.type]);
  }, [poiList, showPOIs, poiFilters]);

  useEffect(() => {
    if (markedTrackId) {
      setRecenterTrigger(prev => prev + 1);
    }
  }, [markedTrackId]);

  const activeTrack = React.useMemo(() => {
    if (markedTrackId) {
      return tracks.find(t => t.id === markedTrackId) || null;
    }
    return tracks.find(t => t.visible) || null;
  }, [tracks, markedTrackId]);

  const movingTimeSecs = React.useMemo(() => {
    if (!activeTrack) return 0;
    return activeTrack.duration 
      ? activeTrack.duration 
      : (activeTrack.distance / estimatedSpeed) * 3600;
  }, [activeTrack, estimatedSpeed]);

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

  const hrZones = React.useMemo(() => {
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

  const powerZones = React.useMemo(() => {
    return [
      { key: 'KB', color: '#3b82f6', min: 0, max: 0.55 * ftp },
      { key: 'GA1', color: '#10b981', min: 0.55 * ftp, max: 0.75 * ftp },
      { key: 'GA2', color: '#eab308', min: 0.75 * ftp, max: 0.90 * ftp },
      { key: 'EB', color: '#f97316', min: 0.90 * ftp, max: 1.05 * ftp },
      { key: 'SB', color: '#ef4444', min: 1.05 * ftp, max: 2500 }
    ];
  }, [ftp]);

  const getPointColorMode = (pt: GPXPoint, activityType?: 'cycling' | 'running') => {
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
  };

  const isDarkTile = isDark && activeLayer !== MapLayer.SATELLITE;

  return (
    <div className="w-full h-full relative">
      <LeafletMapContainer 
        center={[mapView.lat, mapView.lng]} 
        zoom={mapView.zoom} 
        scrollWheelZoom={true}
        boxZoom={false}
        zoomControl={false}
        className={`z-0 ${isDarkTile ? 'dark-tiles' : ''}`}
      >
        <LeafletTileLayer
          attribution={layer.attribution}
          url={layer.url}
          maxZoom={layer.maxZoom || 19}
        />
        
        {showCyclingHeatmap && (
          <LeafletTileLayer
            url="https://tile.waymarkedtrails.org/cycling/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://cycling.waymarkedtrails.org">Waymarked Trails</a>'
            maxZoom={18}
            opacity={0.85}
          />
        )}
        
        {showRunningHeatmap && (
          <LeafletTileLayer
            url="https://tile.waymarkedtrails.org/hiking/{z}/{x}/{y}.png"
            attribution='&copy; <a href="https://hiking.waymarkedtrails.org">Waymarked Trails</a>'
            maxZoom={18}
            opacity={0.85}
          />
        )}

        {/* Eigene Garmin DB-Heatmaps */}
        {showDbCyclingHeatmap && dbCyclingPaths.map((path, idx) => (
          <React.Fragment key={`db-cycling-${idx}`}>
            {/* Outer glow line */}
            <LeafletPolyline
              positions={path}
              color="#3b82f6"
              weight={6}
              opacity={0.15}
              lineCap="round"
              lineJoin="round"
            />
            {/* Core glowing line */}
            <LeafletPolyline
              positions={path}
              color="#3b82f6"
              weight={2.5}
              opacity={0.4}
              lineCap="round"
              lineJoin="round"
            />
          </React.Fragment>
        ))}

        {showDbRunningHeatmap && dbRunningPaths.map((path, idx) => (
          <React.Fragment key={`db-running-${idx}`}>
            {/* Outer glow line */}
            <LeafletPolyline
              positions={path}
              color="#f43f5e"
              weight={6}
              opacity={0.15}
              lineCap="round"
              lineJoin="round"
            />
            {/* Core glowing line */}
            <LeafletPolyline
              positions={path}
              color="#f43f5e"
              weight={2.5}
              opacity={0.4}
              lineCap="round"
              lineJoin="round"
            />
          </React.Fragment>
        ))}
        
        {tracks.filter(t => t.visible && !t.isVirtual).map(track => {
          const isMarked = track.id === markedTrackId;
          const validPoints = (track.points || [])
            .map(p => {
              if (!p) return null;
              const latVal = typeof p.lat === 'number' ? p.lat : parseFloat(p.lat as any);
              const lngVal = typeof p.lng === 'number' ? p.lng : parseFloat(p.lng as any);
              if (isNaN(latVal) || isNaN(lngVal)) return null;
              return { ...p, lat: latVal, lng: lngVal };
            })
            .filter((p): p is GPXPoint => p !== null);
          
          if (validPoints.length === 0) return null;

          const positions = validPoints.map(p => [p.lat, p.lng] as [number, number]);
          
          let selectedPolylines: [number, number][][] = [];
          if (isMarked && selectionBounds) {
            let currentLine: [number, number][] = [];
            validPoints.forEach(p => {
              const inBounds = p.lat >= selectionBounds.minLat && p.lat <= selectionBounds.maxLat &&
                               p.lng >= selectionBounds.minLng && p.lng <= selectionBounds.maxLng;
              if (inBounds) {
                currentLine.push([p.lat, p.lng]);
              } else {
                if (currentLine.length > 0) {
                  selectedPolylines.push(currentLine);
                  currentLine = [];
                }
              }
            });
            if (currentLine.length > 0) {
              selectedPolylines.push(currentLine);
            }
          }

          // Helper to avoid bright pink/magenta colors
          const sanitizeColor = (col: string | undefined): string => {
            if (!col) return "#2563eb";
            const upper = col.toUpperCase();
            if (upper === '#FF00FF' || upper === '#FF1493' || upper === '#DB2777' || upper === '#EC4899') {
              return "#2563eb";
            }
            return col;
          };

          const displayTrackColor = sanitizeColor(track.color);

          // Build continuous segments of identical surface types
          const surfaceSegments: { surface: string; positions: [number, number][] }[] = [];
          if (validPoints.length > 0) {
            // Map surface either from point or from track surfaceStats
            const pointsWithSurface = validPoints.map((pt, idx) => {
              if (pt.surface) return pt.surface;
              if (track.surfaceStats && track.surfaceStats.length > 0 && track.distance > 0) {
                const currentDist = (idx / Math.max(1, validPoints.length - 1)) * track.distance;
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
            let currentPositions: [number, number][] = [[validPoints[0].lat, validPoints[0].lng]];

            for (let i = 1; i < validPoints.length; i++) {
              const pt = validPoints[i];
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

          // Build continuous segments of identical zone colors
          const zoneSegments: { color: string; positions: [number, number][] }[] = [];
          if (colorMode !== 'default' && validPoints.length > 0) {
            let activeSegmentColor: string | null = null;
            let currentPositions: [number, number][] = [];

            validPoints.forEach((pt) => {
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

          const getSurfaceColor = (surf: string, defaultColor: string) => {
            const safeDefault = sanitizeColor(defaultColor);
            switch (surf) {
              case "Asphalt": return "#2563eb"; // Royal Blue
              case "Schotter": return "#d97706"; // Amber / Gravel Brown
              case "Waldweg": return "#16a34a"; // Forest Green
              case "Fahrradweg": return "#0284c7"; // Sky Blue
              case "Kopfsteinpflaster": return "#78350f"; // Bronze / Cobble Brown
              case "Straße": return "#4f46e5"; // Indigo Road
              default: return safeDefault;
            }
          };

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
                    onMarkTrack(track.id);
                    setRecenterTrigger(prev => prev + 1);
                  },
                  mousemove: (e) => {
                    if (onHoverPoint) {
                      let closestPoint = validPoints[0];
                      let minDiff = Infinity;
                      for (const pt of validPoints) {
                        const diff = Math.abs(pt.lat - e.latlng.lat) + Math.abs(pt.lng - e.latlng.lng);
                        if (diff < minDiff) {
                          minDiff = diff;
                          closestPoint = pt;
                        }
                      }
                      onHoverPoint(closestPoint);
                    }
                  },
                  mouseout: () => {
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

              {/* Visible line(s) either segmented by surface, training zones or solid default */}
              {colorMode !== 'default' && zoneSegments.length > 0 ? (
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
              ) : surfaceSegments.length > 1 ? (
                surfaceSegments.map((seg, sIdx) => (
                  <LeafletPolyline
                    key={`seg-${sIdx}`}
                    positions={seg.positions}
                    color={getSurfaceColor(seg.surface, displayTrackColor)}
                    weight={isMarked ? 8 : 4}
                    opacity={isMarked ? 1.0 : 0.6}
                    interactive={false}
                  />
                ))
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
              {(() => {
                const pauses = [];
                for (let i = 1; i < track.points.length; i++) {
                  const p = track.points[i];
                  const prevP = track.points[i - 1];
                  if (p.time && prevP.time) {
                    const diffMs = p.time.getTime() - prevP.time.getTime();
                    if (diffMs > 5 * 60 * 1000) {
                      pauses.push({
                        lat: prevP.lat,
                        lng: prevP.lng,
                        durationMins: Math.floor(diffMs / 60000),
                        startTime: prevP.time,
                        endTime: p.time,
                        idx: i
                      });
                    }
                  }
                }
                return pauses.map(pause => (
                  <LeafletMarker
                    key={`pause-${track.id}-${pause.idx}`}
                    position={[pause.lat, pause.lng]}
                    icon={new L.DivIcon({
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
                    })}
                  >
                    <Popup>
                      <div className="font-bold text-amber-600">Pause</div>
                      <div>Dauer: {pause.durationMins} Minuten</div>
                      <div>Start: {pause.startTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
                      <div>Ende: {pause.endTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
                    </Popup>
                  </LeafletMarker>
                ));
              })()}

              {/* Active Route Flow Directional Arrows */}
              {isMarked && (() => {
                const pts = track.points;
                if (pts.length < 2) return null;
                
                const cumDist: number[] = [0];
                let totalD = 0;
                for (let i = 1; i < pts.length; i++) {
                  const segmentD = calculateDistance(pts[i - 1], pts[i]);
                  totalD += segmentD;
                  cumDist.push(totalD);
                }
                
                const arrows: { lat: number, lng: number, angle: number, idx: number }[] = [];
                if (totalD > 0) {
                  const numArrows = 12; // Spaced evenly along the entire route
                  for (let j = 1; j < numArrows; j++) {
                    const targetDist = (totalD * j) / numArrows;
                    let idx = 0;
                    while (idx < cumDist.length - 1 && cumDist[idx + 1] < targetDist) {
                      idx++;
                    }
                    const p1 = pts[idx];
                    const p2 = pts[Math.min(idx + 1, pts.length - 1)];
                    if (p1 && p2) {
                      const angle = getBearing(p1.lat, p1.lng, p2.lat, p2.lng);
                      arrows.push({ lat: p1.lat, lng: p1.lng, angle, idx: j });
                    }
                  }
                }
                
                return arrows.map(arrow => (
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
                            <path d="M12 4.5L7 17.5l5-2.2 5 2.2z" fill="${track.color || '#3b82f6'}" />
                          </svg>
                        </div>
                      `,
                      iconSize: [24, 24],
                      iconAnchor: [12, 12]
                    })}
                  />
                ));
              })()}

              {/* Start- and Endepunkte für die aktive Route */}
              {isMarked && track.points.length > 0 && (() => {
                const pts = track.points;
                const startPt = pts[0];
                const endPt = pts[pts.length - 1];
                
                return (
                  <>
                    <LeafletMarker
                      key={`start-${track.id}`}
                      position={[startPt.lat, startPt.lng]}
                      icon={new L.DivIcon({
                        className: 'custom-start-marker',
                        html: `
                          <div class="relative flex items-center justify-center" style="width: 44px; height: 44px;">
                            <div class="absolute w-8 h-8 rounded-full bg-emerald-500/35 animate-ping"></div>
                            <div class="bg-gradient-to-br from-emerald-500 to-emerald-700 text-white font-extrabold text-[9px] rounded-full w-9 h-9 border-2 border-white shadow-xl flex items-center justify-center tracking-tight select-none">
                              START
                            </div>
                          </div>
                        `,
                        iconSize: [44, 44],
                        iconAnchor: [22, 22]
                      })}
                    >
                      <Popup>
                        <div className="font-bold text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5 text-sm">
                          <span>🏁</span> Startpunkt: {track.name}
                        </div>
                        <div className="text-xs text-slate-500 dark:text-slate-300 mt-1.5 font-sans space-y-1">
                          <div><strong>Höhe:</strong> {startPt.ele !== undefined ? `${Math.round(startPt.ele)}m` : 'Keine Höhendaten'}</div>
                          {startPt.time && (
                            <div><strong>Zeit:</strong> {new Date(startPt.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}</div>
                          )}
                        </div>
                      </Popup>
                    </LeafletMarker>

                    {pts.length > 1 && (
                      <LeafletMarker
                        key={`end-${track.id}`}
                        position={[endPt.lat, endPt.lng]}
                        icon={new L.DivIcon({
                          className: 'custom-end-marker',
                          html: `
                            <div class="relative flex items-center justify-center" style="width: 44px; height: 44px;">
                              <div class="absolute w-8 h-8 rounded-full bg-rose-500/35 animate-pulse"></div>
                              <div class="bg-gradient-to-br from-rose-500 to-rose-700 text-white font-extrabold text-[9px] rounded-full w-9 h-9 border-2 border-white shadow-xl flex items-center justify-center tracking-tight select-none">
                                ENDE
                              </div>
                            </div>
                          `,
                          iconSize: [44, 44],
                          iconAnchor: [22, 22]
                        })}
                      >
                        <Popup>
                          <div className="font-bold text-rose-600 dark:text-rose-400 flex items-center gap-1.5 text-sm">
                            <span>🏆</span> Zielpunkt: {track.name}
                          </div>
                          <div className="text-xs text-slate-500 dark:text-slate-300 mt-1.5 font-sans space-y-1">
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

        <ZoomToTracks tracks={tracks} />
        <ZoomToMarkedTrack markedTrackId={markedTrackId} tracks={tracks} />
        <ZoomToActiveTrack activeTrack={activeTrack} recenterTrigger={recenterTrigger} />
        <ZoomToSelection bounds={selectionBounds} />
        <MapResizer markedTrackId={markedTrackId} tracksLength={tracks.length} />
        <FlyoverFollow point={hoveredPoint || null} active={isFlying} />
        <SyncView mapView={mapView} onMapViewChange={onMapViewChange} isFlying={isFlying} />
        <SelectionTool active={true} onSelection={onSelection} currentBounds={selectionBounds} />
        
        {hoveredPoint && (
          <LeafletMarker 
            position={[hoveredPoint.lat, hoveredPoint.lng]} 
            interactive={false}
            icon={new L.DivIcon({
              className: 'custom-div-icon',
              html: `
                <div class="relative">
                  <div class="bg-emerald-500 w-4 h-4 rounded-full border-2 border-white shadow-md pointer-events-none"></div>
                  <div class="absolute top-5 left-1/2 -translate-x-1/2 bg-white px-2 py-1 rounded shadow text-xs font-mono whitespace-nowrap pointer-events-none text-slate-700 font-bold border border-slate-200">
                    ${hoveredPoint.time ? new Date(hoveredPoint.time).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : 
                      markedTrackId && tracks.find(t => t.id === markedTrackId) ? (() => {
                        const track = tracks.find(t => t.id === markedTrackId)!;
                        let dist = 0;
                        for (let i = 1; i < track.points.length; i++) {
                          dist += calculateDistance(track.points[i-1], track.points[i]);
                          if (track.points[i].lat === hoveredPoint.lat && track.points[i].lng === hoveredPoint.lng) break;
                        }
                        return `+${Math.floor((dist / estimatedSpeed))}h ${Math.floor(((dist / estimatedSpeed) * 60) % 60)}m`;
                      })() : ''
                    }
                    ${hoveredPoint.hr ? `<br><span class="text-red-500">HF: ${hoveredPoint.hr} bpm</span>` : ''}
                    ${hoveredPoint.power ? `<br><span class="text-amber-600">P: ${Math.round(hoveredPoint.power)} W</span>` : ''}
                  </div>
                </div>
              `,
              iconSize: [16, 16],
              iconAnchor: [8, 8]
            })} 
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
              icon={new L.DivIcon({
                className: 'custom-text-marker',
                html: `
                  <div class="relative flex flex-col items-center select-none" style="transform: translate(-50%, -100%); margin-top: -12px;">
                    <div class="text-white text-[10px] font-black px-2 py-1 rounded-lg shadow-lg whitespace-nowrap border-2 border-white flex items-center gap-1" style="background-color: ${bgColor};">
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
                <div className="text-xs p-1 min-w-[124px]">
                  <div className="font-bold mb-1 text-slate-800 dark:text-slate-100">{marker.label}</div>
                  {marker.distanceAlongTrack !== undefined && (
                    <div className="text-[10px] text-blue-600 dark:text-blue-400 font-bold mb-1">km {marker.distanceAlongTrack.toFixed(2)}</div>
                  )}
                  <div className="text-[9px] text-slate-400 font-mono mb-2">
                    {marker.lat.toFixed(5)}, {marker.lng.toFixed(5)}
                  </div>
                  <button
                    onClick={(e) => {
                      L.DomEvent.stopPropagation(e);
                      onDeleteTextMarker(marker.id);
                    }}
                    className="w-full text-center px-1.5 py-1 bg-red-50 hover:bg-red-100 text-red-600 rounded-lg text-[10px] font-bold border border-red-200 transition-colors"
                  >
                    Notiz löschen
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
                  <div class="relative flex flex-col items-center select-none" style="transform: translate(-50%, -50%);" title="${poi.name.replace(/"/g, '&quot;')}">
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
            icon={new L.DivIcon({
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
            })}
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

        <UserLocationMarker isTracking={isTrackingLocation} autoCenter={autoCenterLocation} />
        <MobileZoomControls tracks={tracks} markedTrackId={markedTrackId} />
      </LeafletMapContainer>

      {/* Mobile & Touch Floating Action Toolbar */}
      <div className="absolute bottom-20 right-2 sm:bottom-4 sm:right-4 z-[400] flex flex-col gap-2 pointer-events-auto">
        <button
          onClick={() => {
            triggerHaptic('medium');
            setIsTrackingLocation(prev => !prev);
          }}
          className={`p-2.5 sm:p-3 rounded-2xl shadow-lg border backdrop-blur-md transition-all flex items-center gap-1.5 text-xs font-black cursor-pointer active:scale-95 ${
            isTrackingLocation 
              ? 'bg-blue-600 text-white border-blue-400 ring-2 ring-blue-500/30' 
              : 'bg-white/95 dark:bg-slate-900/95 text-slate-700 dark:text-slate-200 border-slate-200/80 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800'
          }`}
          title={isTrackingLocation ? "GPS Standort deaktivieren" : "Meinen GPS-Standort auf der Karte anzeigen"}
        >
          <Locate className={`w-4 h-4 ${isTrackingLocation ? 'animate-pulse text-white' : 'text-blue-500'}`} />
          <span className="hidden xs:inline">{isTrackingLocation ? 'GPS Aktiv' : 'Standort'}</span>
        </button>

        {activeTrack && (
          <button
            onClick={() => {
              triggerHaptic('medium');
              shareTrackNative({
                title: activeTrack.name,
                text: `🚴 GPX Route: ${activeTrack.name}\n📏 Länge: ${activeTrack.distance.toFixed(1)} km\n⛰️ Anstieg: +${Math.round(activeTrack.ascent)}m`
              });
            }}
            className="p-2.5 sm:p-3 rounded-2xl bg-white/95 dark:bg-slate-900/95 text-slate-700 dark:text-slate-200 border border-slate-200/80 dark:border-slate-800 shadow-lg backdrop-blur-md hover:bg-slate-50 dark:hover:bg-slate-800 transition-all flex items-center gap-1.5 text-xs font-black cursor-pointer active:scale-95"
            title="Aktivität auf Smartphone teilen (WhatsApp, Mail, Messages)"
          >
            <Share2 className="w-4 h-4 text-emerald-500" />
            <span className="hidden xs:inline">Teilen</span>
          </button>
        )}
      </div>

      {/* Strecken-Farbmodus & POI-Filter Switcher (oben rechts) */}
      {!isColorMenuOpen ? (
        <button
          onClick={() => setIsColorMenuOpen(true)}
          className="absolute top-2 right-2 sm:top-4 sm:right-4 z-[1050] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md p-1.5 sm:p-2 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-md flex items-center gap-1.5 cursor-pointer pointer-events-auto hover:bg-slate-50 dark:hover:bg-slate-850 active:scale-95 transition-all text-slate-700 dark:text-slate-300 select-none font-bold"
          title="Karten-Optionen & Verpflegung einblenden"
          id="btn-color-mode-toggle"
        >
          <Palette className="w-3.5 h-3.5 text-indigo-500" />
          <span className="text-[10px] sm:text-xs font-black uppercase tracking-wider hidden sm:inline">Karten-Optionen</span>
        </button>
      ) : (
        <div className="absolute top-2 right-2 sm:top-4 sm:right-4 z-[1050] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md px-3 py-2.5 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-lg flex flex-col gap-2 font-sans pointer-events-auto select-none w-60 max-w-[90vw]">
          <div className="font-extrabold text-[10px] text-slate-505 dark:text-slate-400 uppercase tracking-wider border-b border-slate-100 dark:border-slate-800 pb-1 flex items-center justify-between gap-4">
            <span className="flex items-center gap-1">
              <Palette className="w-3.5 h-3.5 text-indigo-500" />
              Karten-Optionen
            </span>
            <button
              onClick={() => setIsColorMenuOpen(false)}
              className="text-slate-400 hover:text-slate-650 dark:hover:text-slate-200 font-extrabold text-[10px] cursor-pointer"
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
                  value="default"
                  checked={colorMode === 'default'} 
                  onChange={() => setColorMode('default')} 
                  className="accent-blue-600 font-sans"
                />
                <span className="font-semibold text-slate-700 dark:text-slate-300">Standard / Untergrund</span>
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

          {/* Section 2: Verpflegung & POIs */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] font-bold text-slate-400 uppercase tracking-wider">Verpflegung & POIs</span>
              <label className="relative inline-flex items-center cursor-pointer">
                <input 
                  type="checkbox" 
                  checked={showPOIs} 
                  onChange={() => setShowPOIs(prev => !prev)} 
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

            if (markedTrack.isVirtual) {
              return (
                <div className="text-[10px] text-orange-650 dark:text-orange-400 bg-orange-50/90 dark:bg-orange-955/20 border border-orange-200/50 dark:border-orange-900/40 p-2 rounded-lg leading-snug font-sans shadow-2xs">
                  <div className="font-extrabold flex items-center gap-1 mb-0.5 text-xs">
                    <span>⚠️</span> Keine GPS-Koordinatendaten
                  </div>
                  Diese Aktivität enthält keine GPS-Spur. Visualisierungen auf der Karte wurden deaktiviert, um eine fehlerhafte Kreisdarstellung zu vermeiden. Alle anderen Statistiken sind voll nutzbar.
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
      )}

      {/* Premium Map Legend explaining Surface Types or Zone Ranges */}
      {!hideLegend && (
        isLegendVisible ? (
          <div className="absolute bottom-2 left-2 sm:bottom-4 sm:left-4 z-[400] bg-white/95 dark:bg-slate-905/95 backdrop-blur-md px-3 py-2 rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-md flex flex-col gap-1.5 font-mono text-[9px] pointer-events-auto select-none min-w-[170px] max-w-[220px]">
            <div className="flex items-center justify-between gap-4 font-extrabold text-slate-500 uppercase tracking-wider mb-0.5 border-b border-slate-100 dark:border-slate-800 pb-0.5">
              <span>{colorMode === 'default' ? 'Untergrund' : colorMode === 'hr' ? 'Herzfrequenz' : colorMode === 'power' ? 'Leistung' : 'Tempo / Pace'}</span>
              <button
                onClick={() => setIsLegendVisible(false)}
                className="text-slate-400 hover:text-slate-600 dark:text-slate-500 dark:hover:text-slate-300 font-bold text-[11px] leading-none cursor-pointer p-0.5"
                title="Einklappen"
              >
                ✕
              </button>
            </div>
            {colorMode === 'default' ? (
              <>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#2563eb" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-350">Asphalt</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#d97706" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-350">Schotter (Gravel)</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#16a34a" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-350">Waldweg / Trail</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#0284c7" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-350">Fahrradweg</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className="w-4.5 h-2 rounded-sm shrink-0 border border-black/10" style={{ backgroundColor: "#78350f" }}></span>
                  <span className="font-bold text-slate-700 dark:text-slate-350">Kopfsteinpflaster</span>
                </div>
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
            className="absolute bottom-2 left-2 sm:bottom-4 sm:left-4 z-[400] flex items-center gap-1 px-2 py-1.5 sm:px-3 bg-white/90 dark:bg-slate-900/90 backdrop-blur-md shadow-md border border-slate-200/60 dark:border-slate-800 rounded-xl text-[10px] font-bold text-slate-700 dark:text-slate-300 hover:scale-105 transition-all cursor-pointer font-mono select-none"
            title="Legende anzeigen"
          >
            <span className="text-xs sm:text-sm">🗺️</span>
            <span className="hidden sm:inline">Legende</span>
          </button>
        )
      )}

      {/* Active Track Stats Overlay Card */}
      {activeTrack && (
        <div 
          className="absolute top-2 left-12 sm:top-4 sm:left-14 z-[400] bg-white/95 dark:bg-slate-900/95 backdrop-blur-md rounded-xl border border-slate-200/60 dark:border-slate-800 shadow-lg pointer-events-auto select-none font-sans transition-all duration-300 overflow-hidden max-w-[280px] sm:max-w-[340px]"
          id="active-track-stats-overlay"
        >
          {isStatsCollapsed ? (
            <button
              onClick={() => {
                setIsStatsCollapsed(false);
                setRecenterTrigger(prev => prev + 1);
              }}
              className="flex items-center gap-2 px-3 py-2 text-xs font-bold text-slate-750 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-850 cursor-pointer transition-colors"
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
                <div className="bg-emerald-500/[0.04] dark:bg-emerald-950/[0.08] border border-emerald-100/30 dark:border-emerald-900/15 rounded-lg p-2 flex flex-col items-center text-center">
                  <span className="text-[9px] text-emerald-600 dark:text-emerald-500 font-bold uppercase tracking-wider mb-0.5 flex items-center gap-0.5">
                    <TrendingUp className="w-2.5 h-2.5 shrink-0" /> Anstieg
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
                <span className="font-extrabold text-slate-700 dark:text-slate-300">
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
            </div>
          )}
        </div>
      )}
      {(isLoadingDbCycling || isLoadingDbRunning) && (
        <div className="absolute top-4 left-1/2 -translate-x-1/2 z-[1000] bg-indigo-600/95 dark:bg-indigo-500/95 text-white font-sans text-[11px] font-bold px-3 py-1.5 rounded-full shadow-lg flex items-center gap-2 animate-pulse backdrop-blur-xs">
          <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />
          <span>Generiere DB-Heatmap...</span>
        </div>
      )}
    </div>
  );
};

export default Map;
