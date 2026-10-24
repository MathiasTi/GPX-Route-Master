import React, { useMemo, useEffect, useRef, useState, useCallback } from 'react';
import Map, { Source, Layer, MapRef, NavigationControl, Marker, Popup } from 'react-map-gl/maplibre';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { GPXTrack, MapLayer, MAP_LAYERS, GPXPoint } from '../types';
import { calculateBearing } from '../utils/gpxUtils';
import { Maximize2 } from 'lucide-react';

interface Map3DProps {
  tracks: GPXTrack[];
  activeLayer: MapLayer;
  markedTrackId: string | null;
  onMarkTrack: (id: string) => void;
  hoveredPoint?: GPXPoint | null;
  onHoverPoint?: (point: GPXPoint | null) => void;
  selectionBounds?: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null;
  onSelection?: (bounds: {minLat: number, maxLat: number, minLng: number, maxLng: number} | null) => void;
  mapView: {lat: number, lng: number, zoom: number, pitch: number, bearing: number};
  onMapViewChange: (view: {lat: number, lng: number, zoom: number, pitch: number, bearing: number}) => void;
  estimatedSpeed?: number;
}

const Map3D: React.FC<Map3DProps> = ({ tracks, activeLayer, markedTrackId, onMarkTrack, hoveredPoint, onHoverPoint, selectionBounds, onSelection, mapView, onMapViewChange, estimatedSpeed = 15 }) => {
  const mapRef = useRef<MapRef>(null);
  const layerConfig = MAP_LAYERS[activeLayer];
  const [pitch, setPitch] = useState(mapView.pitch);
  const [bearing, setBearing] = useState(mapView.bearing);
  const lastTargetRef = useRef<{lat: number, lng: number, bearing: number} | null>(null);
  const isInternalUpdateRef = useRef(false);

  // Sync internal state when external mapView changes significantly
  useEffect(() => {
    if (!isInternalUpdateRef.current) {
      if (Math.abs(pitch - mapView.pitch) > 0.1) setPitch(mapView.pitch);
      if (Math.abs(bearing - mapView.bearing) > 0.1) setBearing(mapView.bearing);
    }
  }, [mapView.pitch, mapView.bearing]);

  const mapStyle = useMemo(() => {
    const tileUrls = ['a', 'b', 'c'].map(s => layerConfig.url.replace('{s}', s));

    return {
      version: 8 as const,
      sources: {
        'basemap': {
          type: 'raster' as const,
          tiles: tileUrls,
          tileSize: 256,
          attribution: layerConfig.attribution,
          maxzoom: layerConfig.maxZoom || 19
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
          type: 'background',
          paint: {
            'background-color': '#87CEEB'
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
        exaggeration: 1.5
      }
    };
  }, [layerConfig.url, layerConfig.attribution, layerConfig.maxZoom]);

  const transformRequest = useCallback((url: string, resourceType?: string) => {
    if (resourceType === 'Tile' && url.includes('tile.opentopomap.org')) {
      const match = url.match(/tile\.opentopomap\.org\/(\d+)\/(\d+)\/(\d+)\.png/);
      if (match && parseInt(match[1], 10) > 17) {
        const [, z, x, y] = match;
        return { url: `https://a.tile.openstreetmap.org/${z}/${x}/${y}.png` };
      }
    }
    return { url };
  }, []);

  const handleMapError = useCallback((e: any) => {
    const errorMsg = e?.error?.message || '';
    if (errorMsg.includes('tile') || errorMsg.includes('Load failed') || e?.error?.status === 0) {
      return;
    }
    console.warn('Map3D error:', e);
  }, []);

  const visibleTracks = useMemo(() => {
    return tracks.filter(t => t.visible && t.points.length >= 2);
  }, [tracks]);

  const fitToTracks = () => {
    if (visibleTracks.length > 0 && mapRef.current) {
      const map = mapRef.current.getMap();
      if (!map) return;
      
      // Calculate bounds
      let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
      visibleTracks.forEach(t => {
        if (t && t.points) {
          t.points.forEach(p => {
            if (p && p.lng !== undefined && p.lat !== undefined) {
              if (p.lng < minLng) minLng = p.lng;
              if (p.lng > maxLng) maxLng = p.lng;
              if (p.lat < minLat) minLat = p.lat;
              if (p.lat > maxLat) maxLat = p.lat;
            }
          });
        }
      });

      if (minLng <= maxLng && minLat <= maxLat) {
        try {
          map.fitBounds(
            [[minLng, minLat], [maxLng, maxLat]],
            { padding: 50, duration: 1000 }
          );
        } catch (e) {
          console.error("Error fitting bounds:", e);
        }
      }
    }
  };

  const prevTracksLength = useRef(visibleTracks.length);
  useEffect(() => {
    if (visibleTracks.length > prevTracksLength.current) {
      fitToTracks();
    }
    prevTracksLength.current = visibleTracks.length;
  }, [visibleTracks]);

  const prevMarkedId = useRef<string | null>(null);
  useEffect(() => {
    if (markedTrackId && markedTrackId !== prevMarkedId.current && mapRef.current) {
      const track = tracks.find(t => t.id === markedTrackId);
      if (track && track.points && track.points.length > 0) {
        let minLng = 180, maxLng = -180, minLat = 90, maxLat = -90;
        track.points.forEach(p => {
          if (p && p.lng !== undefined && p.lat !== undefined) {
            if (p.lng < minLng) minLng = p.lng;
            if (p.lng > maxLng) maxLng = p.lng;
            if (p.lat < minLat) minLat = p.lat;
            if (p.lat > maxLat) maxLat = p.lat;
          }
        });
        if (minLng <= maxLng && minLat <= maxLat) {
          const map = mapRef.current?.getMap();
          if (!map) return;
          try {
            map.fitBounds(
              [[minLng, minLat], [maxLng, maxLat]],
              { padding: 50, duration: 1000 }
            );
          } catch (e) {
            console.error("Error fitting bounds to marked track in 3D Map:", e);
          }
        }
      }
    }
    prevMarkedId.current = markedTrackId;
  }, [markedTrackId, tracks]);

  useEffect(() => {
    if (selectionBounds && mapRef.current) {
      const map = mapRef.current.getMap();
      if (!map) return;
      try {
        map.fitBounds(
          [[selectionBounds.minLng, selectionBounds.minLat], [selectionBounds.maxLng, selectionBounds.maxLat]],
          { padding: 50, duration: 1000 }
        );
      } catch (e) {
        console.error("Error fitting bounds to selection:", e);
      }
    }
  }, [selectionBounds]);


  useEffect(() => {
    // Wait for CSS transitions (like the elevation profile opening) to finish
    const timeout = setTimeout(() => {
      if (mapRef.current) {
        const map = mapRef.current.getMap();
        if (map && typeof map.resize === 'function') {
          map.resize();
        }
      }
    }, 300);
    return () => clearTimeout(timeout);
  }, [tracks.length, markedTrackId]);

  const trackSources = useMemo(() => {
    return visibleTracks.map(track => {
      const geojson = {
        type: 'FeatureCollection' as const,
        features: [
          {
            type: 'Feature' as const,
            properties: { id: track.id, name: track.name },
            geometry: {
              type: 'LineString' as const,
              coordinates: track.points
                .filter(p => p && p.lng !== undefined && p.lat !== undefined)
                .map(p => [p.lng, p.lat])
            }
          }
        ]
      };

      let selectedFeatures: any[] = [];
      if (track.id === markedTrackId && selectionBounds) {
        let currentLine: number[][] = [];
        track.points.forEach(p => {
          if (!p || p.lat === undefined || p.lng === undefined) return;
          const inBounds = p.lat >= selectionBounds.minLat && p.lat <= selectionBounds.maxLat &&
                           p.lng >= selectionBounds.minLng && p.lng <= selectionBounds.maxLng;
          if (inBounds) {
            currentLine.push([p.lng, p.lat]);
          } else {
            if (currentLine.length > 0) {
              selectedFeatures.push({
                type: 'Feature',
                properties: {},
                geometry: {
                  type: 'LineString',
                  coordinates: currentLine
                }
              });
              currentLine = [];
            }
          }
        });
        if (currentLine.length > 0) {
          selectedFeatures.push({
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: currentLine
            }
          });
        }
      }

      const selectedGeojson = selectedFeatures.length > 0 ? {
        type: 'FeatureCollection' as const,
        features: selectedFeatures
      } : null;

      return { track, geojson, selectedGeojson };
    });
  }, [visibleTracks, markedTrackId, selectionBounds]);

  return (
    <div className="w-full h-full relative bg-slate-200">
      <Map
        ref={mapRef}
        mapLib={maplibregl}
        style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}
        minZoom={3}
        initialViewState={{
          longitude: mapView.lng,
          latitude: mapView.lat,
          zoom: mapView.zoom,
          pitch: mapView.pitch,
          bearing: mapView.bearing
        }}
        maxPitch={75}
        mapStyle={mapStyle as any}
        transformRequest={transformRequest as any}
        onError={handleMapError}
        onMove={(e) => {
          setPitch(e.viewState.pitch);
          setBearing(e.viewState.bearing);
        }}
        onMoveEnd={(e) => {
          if (isInternalUpdateRef.current) {
            isInternalUpdateRef.current = false;
            return;
          }
          
          const newView = {
            lat: e.viewState.latitude,
            lng: e.viewState.longitude,
            zoom: e.viewState.zoom,
            pitch: e.viewState.pitch,
            bearing: e.viewState.bearing
          };
          
          // Only propagate change back to parent if it's significant to avoid loops
          const isSignificant = 
            Math.abs(newView.lat - mapView.lat) > 0.001 ||
            Math.abs(newView.lng - mapView.lng) > 0.001 ||
            Math.abs(newView.zoom - mapView.zoom) > 0.2 ||
            Math.abs(newView.pitch - mapView.pitch) > 1.0 ||
            Math.abs(newView.bearing - mapView.bearing) > 1.0;

          if (isSignificant) {
            isInternalUpdateRef.current = true;
            onMapViewChange(newView);
          }
        }}
        interactiveLayerIds={visibleTracks.length > 0 ? visibleTracks.map(t => `track-${t.id}-click`) : undefined}
        onClick={(e) => {
          if (e.features && e.features.length > 0) {
            const feature = e.features[0];
            const trackId = feature.properties?.id;
            if (trackId) {
              onMarkTrack(trackId);
            }
          }
        }}
      >
        <NavigationControl position="top-right" visualizePitch={true} />
        {trackSources.map(({ track, geojson, selectedGeojson }) => {
          const isMarked = track.id === markedTrackId;
          
          const pauses = [];
          for (let i = 1; i < track.points.length; i++) {
            const p = track.points[i];
            const prevP = track.points[i - 1];
            if (p && prevP && p.time && prevP.time && p.lat !== undefined && p.lng !== undefined && prevP.lat !== undefined && prevP.lng !== undefined) {
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

          return (
            <React.Fragment key={track.id}>
              <Source id={`track-${track.id}`} type="geojson" data={geojson}>
                {/* Invisible wider line for easier clicking */}
                <Layer
                  id={`track-${track.id}-click`}
                  type="line"
                  paint={{
                    'line-color': 'transparent',
                    'line-width': 30
                  }}
                />
                
                {/* 3D Extrusion Simulation (Shadow/Wall) */}
                {[...Array(6)].map((_, i) => (
                  <Layer
                    key={`track-${track.id}-extrude-${i}`}
                    {...({
                      id: `track-${track.id}-extrude-${i}`,
                      source: `track-${track.id}`,
                      type: "line",
                      paint: {
                        'line-color': track.color || '#ff0000',
                        'line-width': isMarked ? 12 : 8,
                        'line-opacity': 0.1,
                        'line-translate': [0, i * 2], // Translate DOWN to create depth below ground
                        'line-translate-anchor': 'viewport'
                      },
                      layout: {
                        'line-join': 'round',
                        'line-cap': 'round'
                      }
                    } as any)}
                  />
                ))}

                {/* White casing for contrast (Top Layer) */}
                <Layer
                  id={`track-${track.id}-casing`}
                  type="line"
                  paint={{
                    'line-color': '#ffffff',
                    'line-width': isMarked ? 14 : 10,
                    'line-opacity': isMarked ? 0.9 : 0.7,
                    'line-translate': [0, 0], // No translation for accuracy
                    'line-translate-anchor': 'viewport'
                  }}
                  layout={{
                    'line-join': 'round',
                    'line-cap': 'round'
                  }}
                />
                {/* Visible colored line (Top Layer) */}
                <Layer
                  id={`track-${track.id}-line`}
                  type="line"
                  paint={{
                    'line-color': track.color || '#ff0000',
                    'line-width': isMarked ? 8 : 5,
                    'line-opacity': 1.0,
                    'line-translate': [0, 0], // No translation for accuracy
                    'line-translate-anchor': 'viewport'
                  }}
                  layout={{
                    'line-join': 'round',
                    'line-cap': 'round'
                  }}
                />
              </Source>

              {selectedGeojson && (
                <Source id={`track-${track.id}-selected`} type="geojson" data={selectedGeojson}>
                  {/* 3D Extrusion Simulation for Selection */}
                  {[...Array(6)].map((_, i) => (
                    <Layer
                      key={`track-${track.id}-sel-extrude-${i}`}
                      {...({
                        id: `track-${track.id}-sel-extrude-${i}`,
                        source: `track-${track.id}-selected`,
                        type: "line",
                        paint: {
                          'line-color': '#4f46e5',
                          'line-width': 16,
                          'line-opacity': 0.3,
                          'line-translate': [0, -i * 2],
                          'line-translate-anchor': 'viewport'
                        },
                        layout: {
                          'line-join': 'round',
                          'line-cap': 'round'
                        }
                      } as any)}
                    />
                  ))}
                  
                  {/* White casing for selection */}
                  <Layer
                    id={`track-${track.id}-sel-casing`}
                    type="line"
                    paint={{
                      'line-color': '#ffffff',
                      'line-width': 18,
                      'line-opacity': 1.0,
                      'line-translate': [0, -12],
                      'line-translate-anchor': 'viewport'
                    }}
                    layout={{
                      'line-join': 'round',
                      'line-cap': 'round'
                    }}
                  />
                  
                  {/* Visible colored line for selection */}
                  <Layer
                    id={`track-${track.id}-sel-line`}
                    type="line"
                    paint={{
                      'line-color': '#4f46e5',
                      'line-width': 12,
                      'line-opacity': 1.0,
                      'line-translate': [0, -12],
                      'line-translate-anchor': 'viewport'
                    }}
                    layout={{
                      'line-join': 'round',
                      'line-cap': 'round'
                    }}
                  />
                </Source>
              )}

              {/* Pauses > 5 minutes */}
              {pauses.map(pause => (
                <Marker
                  key={`pause-${track.id}-${pause.idx}`}
                  longitude={pause.lng}
                  latitude={pause.lat}
                  anchor="center"
                >
                  <div className="relative group cursor-pointer">
                    <div className="bg-amber-500 w-6 h-6 rounded-full border-2 border-white shadow-md flex items-center justify-center text-white">
                      <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><rect width="4" height="16" x="6" y="4"/><rect width="4" height="16" x="14" y="4"/></svg>
                    </div>
                    
                    {/* Tooltip on hover */}
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 hidden group-hover:block w-max bg-white p-2 rounded shadow-lg border border-slate-200 text-xs z-50">
                      <div className="font-bold text-amber-600 mb-1">Pause</div>
                      <div>Dauer: {pause.durationMins} Minuten</div>
                      <div>Start: {pause.startTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
                      <div>Ende: {pause.endTime.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })}</div>
                      <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-white border-b border-r border-slate-200 rotate-45"></div>
                    </div>
                  </div>
                </Marker>
              ))}
            </React.Fragment>
          );
        })}

        {hoveredPoint && (
          <Source id="hovered-point" type="geojson" data={{
            type: 'Feature',
            geometry: { type: 'Point', coordinates: [hoveredPoint.lng, hoveredPoint.lat] },
            properties: {}
          }}>
            <Layer
              id="hovered-point-layer"
              type="circle"
              paint={{
                'circle-radius': 8,
                'circle-color': '#10b981',
                'circle-stroke-width': 3,
                'circle-stroke-color': '#ffffff',
                'circle-translate': [0, 0], // No translation for accuracy
                'circle-translate-anchor': 'viewport'
              }}
            />
          </Source>
        )}
      </Map>

      <div className="absolute bottom-6 left-6 bg-white/90 backdrop-blur-sm p-4 rounded-xl shadow-lg z-10 w-64 border border-slate-200">
        <div className="mb-3 pb-3 border-b border-slate-200">
          <button
            type="button"
            onClick={fitToTracks}
            className="w-full py-2 px-3 bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 text-white rounded-lg text-xs font-bold transition-all flex items-center justify-center gap-2 shadow cursor-pointer active:scale-95"
            title="Zoom & Zentrieren auf ausgewählte & sichtbare Strecken"
            aria-label="Auf ausgewählte und sichtbare Strecken zoomen"
            id="btn-fit-tracks-3d"
          >
            <Maximize2 className="w-4 h-4" />
            <span>Strecken anpassen</span>
          </button>
        </div>
        <div className="mb-4">
          <label className="flex justify-between text-xs font-bold text-slate-600 mb-2">
            <span>Neigung (Pitch)</span>
            <span className="font-mono text-blue-600">{Math.round(pitch)}°</span>
          </label>
          <input 
            type="range" 
            min="0" 
            max="75" 
            value={pitch} 
            onChange={(e) => {
              const p = Number(e.target.value);
              setPitch(p);
              mapRef.current?.getMap()?.setPitch(p);
            }}
            className="w-full accent-blue-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
        <div>
          <div className="flex justify-between items-center mb-2">
            <label className="text-xs font-bold text-slate-600">
              Drehung (Bearing)
            </label>
            <div className="flex items-center gap-2">
              <button 
                onClick={() => {
                  setBearing(0);
                  mapRef.current?.getMap()?.easeTo({ bearing: 0, duration: 500 });
                }}
                className="text-[9px] bg-slate-200 hover:bg-slate-300 text-slate-700 px-1.5 py-0.5 rounded font-bold transition-colors"
                title="Nach Norden ausrichten"
              >
                NORDEN
              </button>
              <span className="font-mono text-blue-600 text-xs font-bold w-8 text-right">{Math.round(bearing)}°</span>
            </div>
          </div>
          <input 
            type="range" 
            min="0" 
            max="360" 
            value={bearing} 
            onChange={(e) => {
              const b = Number(e.target.value);
              setBearing(b);
              mapRef.current?.getMap()?.setBearing(b);
            }}
            className="w-full accent-blue-600 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer"
          />
        </div>
      </div>
    </div>
  );
};

export default Map3D;
