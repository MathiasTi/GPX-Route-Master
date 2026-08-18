import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import Map, { Source, Layer, MapRef, Marker } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GPXTrack, GPXPoint } from '../types';
import { calculateBearing, calculateDistance } from '../utils/gpxUtils';
import {
  Mountain, Compass, TrendingUp, TrendingDown,
  Layers, Eye, Maximize2, Minimize2, ChevronDown,
  ChevronUp, Zap, Heart, Gauge, MapPin, Sparkles, Navigation
} from 'lucide-react';
import { triggerHaptic } from '../utils/haptics';

interface TerrainHoverPreview3DProps {
  hoveredPoint: GPXPoint | null;
  track: GPXTrack | null;
  allTracks?: GPXTrack[];
  isDark?: boolean;
  onFocusCoordinates?: (lat: number, lng: number) => void;
}

type MapLayerType = 'topo' | 'satellite' | 'standard';

export const TerrainHoverPreview3D: React.FC<TerrainHoverPreview3DProps> = ({
  hoveredPoint,
  track,
  allTracks = [],
  isDark = false,
  onFocusCoordinates
}) => {
  const mapRef = useRef<MapRef>(null);
  const [isCollapsed, setIsCollapsed] = useState<boolean>(() => {
    try {
      return localStorage.getItem('velo_3d_terrain_collapsed') === 'true';
    } catch (e) {
      return false;
    }
  });

  const [pitchMode, setPitchMode] = useState<number>(65); // 45, 65, 80
  const [exaggeration, setExaggeration] = useState<number>(1.6); // 1.0, 1.6, 2.4
  const [layerType, setLayerType] = useState<MapLayerType>('topo');
  const [isExpandedHeight, setIsExpandedHeight] = useState<boolean>(false);

  const toggleCollapsed = () => {
    setIsCollapsed(prev => {
      const next = !prev;
      try {
        localStorage.setItem('velo_3d_terrain_collapsed', String(next));
      } catch (e) {}
      return next;
    });
    triggerHaptic('light');
  };

  // Determine active point to display: either the hoveredPoint or fallback to track midpoint/summit
  const activePoint = useMemo(() => {
    if (hoveredPoint && !isNaN(hoveredPoint.lat) && !isNaN(hoveredPoint.lng)) {
      return hoveredPoint;
    }
    if (track && track.points && track.points.length > 0) {
      // Return highest point or midpoint as idle preview
      let highestPt = track.points[0];
      for (const p of track.points) {
        if (p.ele !== undefined && (highestPt.ele === undefined || p.ele > highestPt.ele)) {
          highestPt = p;
        }
      }
      return highestPt;
    }
    return null;
  }, [hoveredPoint, track]);

  // Compute track index, bearing, slope, and distance if missing on activePoint
  const telemetry = useMemo(() => {
    if (!activePoint) return null;

    let slope = activePoint.slope;
    let dist = activePoint.dist;
    let bearing = 0;
    let pointIndex = -1;

    if (track && track.points && track.points.length > 1) {
      // Find point index
      let minDist = Infinity;
      for (let i = 0; i < track.points.length; i++) {
        const p = track.points[i];
        const d = Math.abs(p.lat - activePoint.lat) + Math.abs(p.lng - activePoint.lng);
        if (d < minDist) {
          minDist = d;
          pointIndex = i;
        }
      }

      if (pointIndex !== -1) {
        // Calculate bearing oriented forward along route
        const nextIdx = Math.min(pointIndex + 4, track.points.length - 1);
        const prevIdx = Math.max(0, pointIndex - 4);
        const pPrev = track.points[prevIdx];
        const pNext = track.points[nextIdx];

        if (pPrev && pNext && (pPrev.lat !== pNext.lat || pPrev.lng !== pNext.lng)) {
          bearing = Math.round(calculateBearing(pPrev, pNext));
        }

        // Calculate slope if undefined
        if (slope === undefined) {
          const sPrev = track.points[Math.max(0, pointIndex - 2)];
          const sNext = track.points[Math.min(track.points.length - 1, pointIndex + 2)];
          if (sPrev && sNext && sPrev.ele !== undefined && sNext.ele !== undefined) {
            const stepMeters = calculateDistance(sPrev, sNext) * 1000;
            if (stepMeters > 5) {
              slope = ((sNext.ele - sPrev.ele) / stepMeters) * 100;
            }
          }
        }

        // Calculate distance if undefined
        if (dist === undefined) {
          let cumDist = 0;
          for (let i = 1; i <= pointIndex; i++) {
            cumDist += calculateDistance(track.points[i - 1], track.points[i]);
          }
          dist = cumDist;
        }
      }
    }

    const ele = activePoint.ele ?? 0;
    const finalSlope = slope !== undefined ? Number(slope.toFixed(1)) : 0;
    const finalDist = dist !== undefined ? Number(dist.toFixed(2)) : 0;

    // Categorize slope
    let slopeCategory: { label: string; bg: string; text: string; icon: string } = {
      label: 'Flach',
      bg: 'bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border-emerald-500/30',
      text: 'text-emerald-500',
      icon: '➔'
    };

    if (finalSlope >= 14) {
      slopeCategory = {
        label: 'Extrem-Rampe',
        bg: 'bg-purple-550/20 text-purple-600 dark:text-purple-300 border-purple-500/40 animate-pulse',
        text: 'text-purple-500',
        icon: '▲▲'
      };
    } else if (finalSlope >= 8) {
      slopeCategory = {
        label: 'Steilanstieg',
        bg: 'bg-rose-500/20 text-rose-600 dark:text-rose-400 border-rose-500/40',
        text: 'text-rose-500',
        icon: '▲'
      };
    } else if (finalSlope >= 3.5) {
      slopeCategory = {
        label: 'Mäßiger Anstieg',
        bg: 'bg-amber-500/20 text-amber-600 dark:text-amber-400 border-amber-500/30',
        text: 'text-amber-500',
        icon: '↗'
      };
    } else if (finalSlope <= -8) {
      slopeCategory = {
        label: 'Steilabfahrt',
        bg: 'bg-blue-600/20 text-blue-600 dark:text-blue-400 border-blue-500/40',
        text: 'text-blue-500',
        icon: '▼▼'
      };
    } else if (finalSlope <= -3.5) {
      slopeCategory = {
        label: 'Gefälle',
        bg: 'bg-cyan-500/20 text-cyan-600 dark:text-cyan-400 border-cyan-500/30',
        text: 'text-cyan-500',
        icon: '↘'
      };
    }

    return {
      ele: Math.round(ele),
      slope: finalSlope,
      dist: finalDist,
      bearing,
      pointIndex,
      slopeCategory,
      power: activePoint.power,
      hr: activePoint.hr,
      speed: activePoint.speed,
      cadence: activePoint.cadence,
      surface: activePoint.surface,
      lat: activePoint.lat,
      lng: activePoint.lng
    };
  }, [activePoint, track]);

  // Dynamic Tile Layer Sources
  const tileUrl = useMemo(() => {
    switch (layerType) {
      case 'satellite':
        return 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}';
      case 'topo':
        return 'https://a.tile.opentopomap.org/{z}/{x}/{y}.png';
      case 'standard':
      default:
        return 'https://a.tile.openstreetmap.org/{z}/{x}/{y}.png';
    }
  }, [layerType]);

  const mapStyle = useMemo(() => {
    return {
      version: 8 as const,
      sources: {
        'basemap': {
          type: 'raster' as const,
          tiles: [tileUrl],
          tileSize: 256,
          attribution: '© OpenStreetMap contributors / Terrain DEM',
          maxzoom: 19
        },
        'terrain': {
          type: 'raster-dem' as const,
          tiles: ['https://demotiles.maplibre.org/terrain-tiles/{z}/{x}/{y}.png'],
          encoding: 'mapbox' as const,
          tileSize: 256,
          maxzoom: 12
        }
      },
      layers: [
        {
          id: 'background',
          type: 'background' as const,
          paint: {
            'background-color': isDark ? '#0f172a' : '#87CEEB'
          }
        },
        {
          id: 'basemap-layer',
          type: 'raster' as const,
          source: 'basemap',
          minzoom: 0
        }
      ],
      terrain: {
        source: 'terrain',
        exaggeration: exaggeration
      }
    };
  }, [tileUrl, exaggeration, isDark]);

  // GeoJSON Track Line Overlay
  const trackGeoJSON = useMemo(() => {
    const activeTracks = track ? [track] : allTracks.filter(t => t.visible);
    return {
      type: 'FeatureCollection' as const,
      features: activeTracks.map(t => ({
        type: 'Feature' as const,
        properties: {
          id: t.id,
          color: t.color || '#6366f1'
        },
        geometry: {
          type: 'LineString' as const,
          coordinates: (t.points || []).map(p => [p.lng, p.lat])
        }
      }))
    };
  }, [track, allTracks]);

  // Synchronize 3D Camera instantaneously when active point updates
  useEffect(() => {
    if (!activePoint || isCollapsed) return;

    const map = mapRef.current?.getMap();
    if (!map) return;

    const targetBearing = telemetry?.bearing ?? 0;
    const targetCenter: [number, number] = [activePoint.lng, activePoint.lat];

    // High performance instant camera update
    try {
      if (hoveredPoint) {
        // When user is actively scrubbing over the profile, use responsive short easeTo
        map.easeTo({
          center: targetCenter,
          zoom: 15.5,
          pitch: pitchMode,
          bearing: targetBearing,
          duration: 70,
          easing: (t) => t
        });
      } else {
        // Smooth initial center
        map.flyTo({
          center: targetCenter,
          zoom: 15,
          pitch: pitchMode,
          bearing: targetBearing,
          duration: 500
        });
      }
    } catch (e) {
      // MapLibre might still be mounting
    }
  }, [activePoint, hoveredPoint, pitchMode, telemetry?.bearing, isCollapsed]);

  // Trigger resize on expand/collapse
  useEffect(() => {
    const timer = setTimeout(() => {
      const map = mapRef.current?.getMap();
      if (map && typeof map.resize === 'function') {
        map.resize();
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [isCollapsed, isExpandedHeight]);

  if (!track && allTracks.length === 0) {
    return null;
  }

  const isLiveHover = !!hoveredPoint;

  return (
    <section 
      className="bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden transition-all duration-200"
      id="section-3d-terrain-hover-preview"
    >
      {/* Header Bar */}
      <div className="p-3 bg-slate-50/90 dark:bg-slate-850 border-b border-slate-200/80 dark:border-slate-800 flex items-center justify-between gap-2">
        <button
          onClick={toggleCollapsed}
          className="flex items-center gap-2 text-left cursor-pointer flex-1 min-w-0 group"
          title={isCollapsed ? '3D-Terrain-Vorschau ausklappen' : '3D-Terrain-Vorschau einklappen'}
        >
          <div className="p-1.5 rounded-lg bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 group-hover:bg-indigo-500/20 transition-colors shrink-0">
            <Mountain className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h3 className="text-xs font-black text-slate-800 dark:text-slate-100 truncate">
                3D-Terrain Hover-Vorschau
              </h3>
              {isLiveHover ? (
                <span className="flex items-center gap-1 px-1.5 py-0.2 rounded-full bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 text-[9px] font-black tracking-wider uppercase border border-emerald-500/30 animate-pulse">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                  Live
                </span>
              ) : (
                <span className="px-1.5 py-0.2 rounded-full bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400 text-[9px] font-bold">
                  Bereit
                </span>
              )}
            </div>
            <p className="text-[10px] text-slate-500 dark:text-slate-400 truncate">
              {isLiveHover ? 'Echtzeit-Steigung & Höhenprofil' : 'Maus über Höhenprofil bewegen'}
            </p>
          </div>
        </button>

        <div className="flex items-center gap-1 shrink-0">
          {!isCollapsed && (
            <button
              onClick={() => setIsExpandedHeight(prev => !prev)}
              className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
              title={isExpandedHeight ? 'Kompakte Ansicht' : 'Vergrößerte Ansicht'}
            >
              {isExpandedHeight ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
            </button>
          )}
          <button
            onClick={toggleCollapsed}
            className="p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 rounded-md hover:bg-slate-200 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title={isCollapsed ? 'Ausklappen' : 'Einklappen'}
          >
            {isCollapsed ? <ChevronDown size={15} /> : <ChevronUp size={15} />}
          </button>
        </div>
      </div>

      {!isCollapsed && (
        <div className="p-3 space-y-3">
          {/* Instantaneous HUD Readout Panel */}
          {telemetry ? (
            <div className="grid grid-cols-2 gap-2 bg-slate-50 dark:bg-slate-850/80 p-2.5 rounded-xl border border-slate-200/70 dark:border-slate-800">
              {/* Altitude readout */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                  <Mountain className="w-3 h-3 text-indigo-500" />
                  <span>Aktuelle Höhe</span>
                </div>
                <div className="flex items-baseline gap-1">
                  <span className="text-lg font-black text-slate-900 dark:text-white font-mono tracking-tight">
                    {telemetry.ele}
                  </span>
                  <span className="text-[10px] font-bold text-slate-500">m ü.NN</span>
                </div>
              </div>

              {/* Instantaneous Slope readout */}
              <div className="space-y-0.5">
                <div className="flex items-center gap-1 text-[9px] font-bold text-slate-400 uppercase tracking-wider">
                  {telemetry.slope >= 0 ? (
                    <TrendingUp className="w-3 h-3 text-amber-500" />
                  ) : (
                    <TrendingDown className="w-3 h-3 text-blue-500" />
                  )}
                  <span>Momentan-Steigung</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className={`text-lg font-black font-mono tracking-tight ${telemetry.slopeCategory.text}`}>
                    {telemetry.slope > 0 ? `+${telemetry.slope}%` : `${telemetry.slope}%`}
                  </span>
                  <span className={`px-1.5 py-0.5 rounded text-[8.5px] font-extrabold uppercase tracking-tight border ${telemetry.slopeCategory.bg}`}>
                    {telemetry.slopeCategory.label}
                  </span>
                </div>
              </div>

              {/* Secondary stats row */}
              <div className="col-span-2 pt-1 border-t border-slate-200/60 dark:border-slate-800 flex items-center justify-between text-[10px] text-slate-600 dark:text-slate-300 font-mono flex-wrap gap-x-2 gap-y-1">
                <div className="flex items-center gap-1" title="Position im Streckenverlauf">
                  <Navigation className="w-2.5 h-2.5 text-indigo-400" />
                  <span>km {telemetry.dist.toFixed(1)}</span>
                  {track && track.distance > 0 && (
                    <span className="text-slate-400 text-[9px]">
                      ({Math.round((telemetry.dist / track.distance) * 100)}%)
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1" title="Kompass-Richtung">
                  <Compass className="w-2.5 h-2.5 text-slate-400" />
                  <span>{telemetry.bearing}°</span>
                </div>

                {telemetry.power !== undefined && telemetry.power > 0 && (
                  <div className="flex items-center gap-0.5 text-amber-500 font-bold" title="Leistung">
                    <Zap className="w-2.5 h-2.5" />
                    <span>{Math.round(telemetry.power)}W</span>
                  </div>
                )}

                {telemetry.hr !== undefined && telemetry.hr > 0 && (
                  <div className="flex items-center gap-0.5 text-rose-500 font-bold" title="Herzfrequenz">
                    <Heart className="w-2.5 h-2.5" />
                    <span>{Math.round(telemetry.hr)} bpm</span>
                  </div>
                )}

                {telemetry.surface && (
                  <div className="px-1.5 py-0.2 rounded bg-slate-200 dark:bg-slate-800 text-[9px] text-slate-600 dark:text-slate-300 capitalize truncate max-w-[90px]">
                    {telemetry.surface}
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-850 text-center text-xs text-slate-400 italic">
              Keine Höhendaten am Cursor
            </div>
          )}

          {/* Controls Bar for 3D Viewport */}
          <div className="flex items-center justify-between gap-1 text-[10px]">
            {/* Layer selector */}
            <div className="flex bg-slate-100 dark:bg-slate-800 p-0.5 rounded-lg border border-slate-200 dark:border-slate-700">
              <button
                onClick={() => setLayerType('topo')}
                className={`px-2 py-0.5 rounded-md font-bold transition-all cursor-pointer ${
                  layerType === 'topo'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-3xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
                title="Topografische Reliefkarte"
              >
                Topo
              </button>
              <button
                onClick={() => setLayerType('satellite')}
                className={`px-2 py-0.5 rounded-md font-bold transition-all cursor-pointer ${
                  layerType === 'satellite'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-3xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
                title="Satellitenansicht"
              >
                Sat
              </button>
              <button
                onClick={() => setLayerType('standard')}
                className={`px-2 py-0.5 rounded-md font-bold transition-all cursor-pointer ${
                  layerType === 'standard'
                    ? 'bg-white dark:bg-slate-900 text-indigo-600 dark:text-indigo-400 shadow-3xs'
                    : 'text-slate-500 hover:text-slate-800 dark:hover:text-slate-200'
                }`}
                title="OSM Standardkarte"
              >
                OSM
              </button>
            </div>

            {/* Pitch perspective button */}
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  const nextPitch = pitchMode === 45 ? 65 : pitchMode === 65 ? 80 : 45;
                  setPitchMode(nextPitch);
                  triggerHaptic('light');
                }}
                className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer flex items-center gap-1"
                title={`Kameraneigung anpassen (Aktuell: ${pitchMode}°)`}
              >
                <Eye className="w-3 h-3 text-indigo-500" />
                <span>{pitchMode}°</span>
              </button>

              {/* Relief exaggeration button */}
              <button
                onClick={() => {
                  const nextExag = exaggeration === 1.0 ? 1.6 : exaggeration === 1.6 ? 2.4 : 1.0;
                  setExaggeration(nextExag);
                  triggerHaptic('light');
                }}
                className="px-2 py-1 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-bold rounded-lg border border-slate-200 dark:border-slate-700 cursor-pointer flex items-center gap-1"
                title={`Höhenüberhöhung für 3D-Relief (Aktuell: ${exaggeration}x)`}
              >
                <Mountain className="w-3 h-3 text-amber-500" />
                <span>{exaggeration}x</span>
              </button>
            </div>
          </div>

          {/* Embedded 3D Viewport */}
          <div
            className={`w-full ${
              isExpandedHeight ? 'h-64 sm:h-72' : 'h-48'
            } relative rounded-xl overflow-hidden border border-slate-200/80 dark:border-slate-800 shadow-inner bg-slate-950`}
          >
            {activePoint ? (
              <Map
                ref={mapRef}
                initialViewState={{
                  longitude: activePoint.lng,
                  latitude: activePoint.lat,
                  zoom: 15.5,
                  pitch: pitchMode,
                  bearing: telemetry?.bearing || 0
                }}
                mapLib={import('maplibre-gl')}
                mapStyle={mapStyle}
                style={{ width: '100%', height: '100%' }}
                attributionControl={false}
                dragRotate={true}
                pitchWithRotate={true}
                maxPitch={85}
              >
                {/* Track Polyline Layer */}
                <Source id="preview-3d-track" type="geojson" data={trackGeoJSON}>
                  <Layer
                    id="preview-3d-track-casing"
                    type="line"
                    paint={{
                      'line-color': '#000000',
                      'line-width': 4.5,
                      'line-opacity': 0.6
                    }}
                  />
                  <Layer
                    id="preview-3d-track-line"
                    type="line"
                    paint={{
                      'line-color': ['get', 'color'],
                      'line-width': 3,
                      'line-opacity': 0.95
                    }}
                  />
                </Source>

                {/* 3D Pulsing Marker at exact cursor coordinate */}
                <Marker
                  longitude={activePoint.lng}
                  latitude={activePoint.lat}
                  anchor="center"
                >
                  <div className="relative flex items-center justify-center pointer-events-none">
                    {/* Glowing radar pulses */}
                    <div className="absolute w-8 h-8 rounded-full bg-indigo-500/40 animate-ping" />
                    <div className="absolute w-5 h-5 rounded-full bg-indigo-500/60" />
                    <div className="relative w-3.5 h-3.5 rounded-full bg-white border-2 border-indigo-600 shadow-lg" />
                  </div>
                </Marker>
              </Map>
            ) : (
              <div className="w-full h-full flex items-center justify-center p-4 text-center text-xs text-slate-400">
                Wähle eine Route für die 3D-Terrain-Vorschau
              </div>
            )}

            {/* Overlay hint banner when not actively hovering */}
            {!isLiveHover && (
              <div className="absolute bottom-2 inset-x-2 bg-slate-900/80 backdrop-blur-md text-white px-2.5 py-1.5 rounded-lg text-[10px] font-medium border border-slate-700/60 flex items-center justify-between pointer-events-none z-10 shadow-lg">
                <div className="flex items-center gap-1.5 truncate">
                  <Sparkles className="w-3 h-3 text-amber-400 shrink-0" />
                  <span className="truncate">Bewege die Maus über das Höhenprofil</span>
                </div>
                <span className="text-[9px] text-indigo-300 font-bold shrink-0">3D Live-Sync</span>
              </div>
            )}
          </div>
        </div>
      )}
    </section>
  );
};

export default TerrainHoverPreview3D;
