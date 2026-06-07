
import React, { useEffect, useState, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, useMapEvents, useMap, Marker, Popup, Rectangle } from 'react-leaflet';
import L from 'leaflet';
import { GPXTrack, MapLayer, MAP_LAYERS, GPXPoint, TextMarker } from '../types';
import { calculateDistance } from '../utils/gpxUtils';

// Fix for default marker icons in Leaflet + React
// @ts-ignore
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

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
        Math.abs(currentCenter.lat - mapView.lat) > 0.001 || 
        Math.abs(currentCenter.lng - mapView.lng) > 0.001 || 
        Math.abs(currentZoom - mapView.zoom) > 0.2;

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
        Math.abs(center.lat - mapView.lat) > 0.001 ||
        Math.abs(center.lng - mapView.lng) > 0.001 ||
        Math.abs(zoom - mapView.zoom) > 0.2;

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
  onDeleteTextMarker
}) => {
  const layer = MAP_LAYERS[activeLayer];
  const [pendingMarker, setPendingMarker] = useState<{lat: number, lng: number} | null>(null);

  const MapClickHandle = () => {
    useMapEvents({
      click(e) {
        setPendingMarker({ lat: e.latlng.lat, lng: e.latlng.lng });
      }
    });
    return null;
  };

  return (
    <div className="w-full h-full relative">
      <LeafletMapContainer 
        center={[mapView.lat, mapView.lng]} 
        zoom={mapView.zoom} 
        scrollWheelZoom={true}
        boxZoom={false}
        className="z-0"
      >
        <LeafletTileLayer
          attribution={layer.attribution}
          url={layer.url}
          maxZoom={layer.maxZoom || 19}
        />
        
        {tracks.filter(t => t.visible).map(track => {
          const isMarked = track.id === markedTrackId;
          const positions = track.points.map(p => [p.lat, p.lng] as [number, number]);
          
          let selectedPolylines: [number, number][][] = [];
          if (isMarked && selectionBounds) {
            let currentLine: [number, number][] = [];
            track.points.forEach(p => {
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

          return (
            <React.Fragment key={track.id}>
              {/* Invisible thick line for easier hovering/clicking */}
              <LeafletPolyline 
                positions={positions}
                color="#000000"
                opacity={0}
                weight={30}
                eventHandlers={{
                  click: (e) => {
                    L.DomEvent.stopPropagation(e);
                    onMarkTrack(track.id);
                  },
                  mousemove: (e) => {
                    if (onHoverPoint) {
                      let closestPoint = track.points[0];
                      let minDiff = Infinity;
                      for (const pt of track.points) {
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
              />
              {/* Visible line */}
              <LeafletPolyline 
                positions={positions}
                color={track.color}
                weight={isMarked ? 8 : 4}
                opacity={isMarked ? 1.0 : 0.6}
                interactive={false}
              >
                <Popup>
                    <div className="font-bold">{track.name}</div>
                    <div>Distanz: {track.distance.toFixed(2)} km</div>
                    <div>Punkte: {track.points.length}</div>
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
            </React.Fragment>
          );
        })}

        <ZoomToTracks tracks={tracks} />
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

        <MapClickHandle />

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
                      <span>🏷️</span> ${marker.label}
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
      </LeafletMapContainer>
    </div>
  );
};

export default Map;
