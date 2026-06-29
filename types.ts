
export interface GPXPoint {
  lat: number;
  lng: number;
  ele?: number;
  time?: Date;
  power?: number;
  hr?: number;
  cadence?: number;
  surface?: string;
}

export interface PowerStats {
  avgPower: number;
  maxPower: number;
  best20s: number;
  best1m: number;
  best20m: number;
  normalizedPower?: number;
  intensityFactor?: number;
  tss?: number;
  variabilityIndex?: number;
  work?: number; // in kJ
}

export interface SurfaceSegment {
  type: string;
  distance: number;
}

export interface ClimbSegment {
  startIndex: number;
  endIndex: number;
  distance: number; // meters
  ascent: number; // meters
  avgGradient: number; // percent
  maxGradient: number; // percent
}

export interface RawFileDetails {
  fileType: 'fit' | 'gpx';
  fileName: string;
  fileSize?: number;
  metadata: {
    creator?: string;
    version?: string;
    deviceManufacturer?: string;
    deviceModel?: string;
    serialNumber?: string;
    softwareVersion?: string;
    sportName?: string;
    sessionDuration?: number;
    sessionDistance?: number;
    lapCount?: number;
    rawRecords?: { type: string; data: Record<string, any> }[];
  };
}

export interface GPXTrack {
  id: string;
  name: string;
  points: GPXPoint[];
  color: string;
  distance: number; // in kilometers
  ascent: number; // in meters
  descent: number; // in meters
  maxSlope: number; // in percent
  visible: boolean;
  activityType?: 'cycling' | 'running';
  powerStats?: PowerStats;
  surfaceStats?: SurfaceSegment[];
  climbs?: ClimbSegment[];
  duration?: number; // in seconds
  hasTimestamps?: boolean;
  description?: string;
  rawFileDetails?: RawFileDetails;
}

export enum MapLayer {
  OSM = 'OpenStreetMap',
  TOPOLOGY = 'OpenTopoMap',
  SATELLITE = 'Satellite (Esri)'
}

export interface MapLayerConfig {
  id: MapLayer;
  url: string;
  attribution: string;
  maxZoom?: number;
}

export const MAP_LAYERS: Record<MapLayer, MapLayerConfig> = {
  [MapLayer.OSM]: {
    id: MapLayer.OSM,
    url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
  },
  [MapLayer.TOPOLOGY]: {
    id: MapLayer.TOPOLOGY,
    url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png',
    attribution: 'Map data: &copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors, <a href="http://viewfinderpanoramas.org">SRTM</a> | Map style: &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (<a href="https://creativecommons.org/licenses/by-sa/3.0/">CC-BY-SA</a>)',
    maxZoom: 17
  },
  [MapLayer.SATELLITE]: {
    id: MapLayer.SATELLITE,
    url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
  }
};

export interface WeatherData {
  locationName: string;
  temperature: number;
  tempHigh: number;
  tempLow: number;
  condition: string;
  conditionDetail: string;
  humidity?: number;
  windSpeed?: number;
  precipitationProbability?: number;
  sourceUrl?: string;
  forecastSummary: string;
  isFallback?: boolean;
  fallbackNotice?: string;
}

export interface TextMarker {
  id: string;
  lat: number;
  lng: number;
  label: string;
  color: string; // Hex code or tailwind color name
  trackId?: string; // Associated track if created from a track point
  distanceAlongTrack?: number; // Distance in km from start of that track
}

export interface LeaderboardEntry {
  id: string;
  rank: number;
  athleteName: string;
  timeInSeconds: number;
  avgPower?: number;
  avgSpeedKmh: number;
  date: string;
  isUser?: boolean;
}

export interface Segment {
  id: string;
  name: string;
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
  distanceMeter: number;
  ascentMeter: number;
  avgGradient: number;
  leaderboard: LeaderboardEntry[];
  isCustom?: boolean;
}


