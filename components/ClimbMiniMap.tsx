import React, { useEffect, useRef } from 'react';
import { MapContainer, TileLayer, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import { GPXPoint, MapLayer, MAP_LAYERS } from '../types';

const LeafletMapContainer = MapContainer as any;
const LeafletTileLayer = TileLayer as any;
const LeafletPolyline = Polyline as any;

interface ClimbMiniMapProps {
  points: GPXPoint[];
  color: string;
  activeLayer: MapLayer;
}

const FitClimbBounds: React.FC<{ points: GPXPoint[] }> = ({ points }) => {
  const map = useMap();
  useEffect(() => {
    if (points.length > 0) {
      const bounds = L.latLngBounds(points.map(p => [p.lat, p.lng]));
      map.fitBounds(bounds, { padding: [15, 15], animate: false });
    }
  }, [points, map]);
  return null;
};

export const ClimbMiniMap: React.FC<ClimbMiniMapProps> = ({ points, color, activeLayer }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const layerConfig = MAP_LAYERS[activeLayer];

  if (points.length === 0) {
    return (
      <div className="h-full bg-slate-100 dark:bg-slate-950 flex items-center justify-center text-xs text-slate-400">
        Keine Kartendaten verfügbar
      </div>
    );
  }

  return (
    <div className="h-full w-full relative overflow-hidden rounded-t-2xl" ref={containerRef}>
      <LeafletMapContainer
        center={[points[0].lat, points[0].lng]}
        zoom={14}
        zoomControl={false}
        dragging={false}
        scrollWheelZoom={false}
        doubleClickZoom={false}
        boxZoom={false}
        touchZoom={false}
        style={{ height: '100%', width: '100%', zIndex: 10 }}
      >
        <LeafletTileLayer
          url={layerConfig.url}
          attribution={layerConfig.attribution}
          maxZoom={20}
          maxNativeZoom={layerConfig.maxZoom || 19}
        />
        <LeafletPolyline
          positions={points.map(p => [p.lat, p.lng])}
          color={color || '#6366f1'}
          weight={4}
          opacity={0.9}
        />
        <FitClimbBounds points={points} />
      </LeafletMapContainer>
    </div>
  );
};
