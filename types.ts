
export interface GPXPoint {
  lat: number;
  lng: number;
  ele?: number;
  time?: Date;
  power?: number;
  hr?: number;
  cadence?: number;
  surface?: string;
  temp?: number;
  speed?: number;
  slope?: number;
  dist?: number;
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
  isVirtual?: boolean;
}

export interface TimeGap {
  id: string;
  trackId: string;
  trackName: string;
  startIndex: number; // Index of point before gap
  endIndex: number;   // Index of point after gap
  startTime?: Date;
  endTime?: Date;
  gapSeconds: number; // Duration of time gap in seconds
  distanceMeters: number; // Spatial distance between start and end point in meters
  distanceFromStartKm: number; // Accumulated distance from track start in km
  startPoint: GPXPoint;
  endPoint: GPXPoint;
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
  feelsLike?: number;
  uvIndex?: number;
  condition: string;
  conditionDetail: string;
  humidity?: number;
  windSpeed?: number;
  precipitationProbability?: number;
  sourceUrl?: string;
  forecastSummary: string;
  isFallback?: boolean;
  fallbackNotice?: string;
  pointType?: 'start' | 'summit' | 'end';
  elevation?: number;
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

export type ValidationIssueType =
  | 'coord_out_of_bounds'
  | 'null_island'
  | 'coord_extreme_jump'
  | 'missing_elevation'
  | 'elevation_spike'
  | 'missing_time';

export type ValidationSeverity = 'clean' | 'info' | 'warning' | 'error';

export interface ValidationIssue {
  id: string;
  type: ValidationIssueType;
  severity: 'info' | 'warning' | 'error';
  title: string;
  description: string;
  affectedCount: number;
  affectedIndices?: number[];
  autoFixable: boolean;
  fixDescription?: string;
}

export interface TrackValidationReport {
  trackId: string;
  trackName: string;
  status: ValidationSeverity;
  issues: ValidationIssue[];
  stats: {
    totalPoints: number;
    pointsWithElevation: number;
    missingElevationCount: number;
    outlierCoordinateCount: number;
    nullIslandCount: number;
    extremeJumpCount: number;
    elevationSpikeCount: number;
    minElevation?: number;
    maxElevation?: number;
    maxSpeedJumpKmh?: number;
  };
}

export interface TrackSplit {
  km: number;
  splitDistanceKm: number;
  ascentMeters: number;
  avgGradient: number;
  estimatedTimeSeconds: number;
  estimatedCalories: number;
  description?: string;
}

export type POICategory = 'water' | 'food' | 'bakery' | 'supermarket' | 'cafe' | 'hut' | 'gas_station' | 'shelter' | 'viewpoint';

export interface RoutePOI {
  id: string;
  name: string;
  category: POICategory;
  lat: number;
  lng: number;
  distanceAlongTrackKm: number;
  distanceOffTrackMeters: number;
  description: string;
  openingHours?: string;
  address?: string;
}

export interface RouteEventAlert {
  id: string;
  type: 'problem' | 'event' | 'info';
  title: string;
  description: string;
  category: 'road_closure' | 'construction' | 'traffic' | 'sport_event' | 'festival' | 'market' | 'weather_hazard' | 'local_tip';
  severity: 'high' | 'medium' | 'low';
  locationName?: string;
  approxDistanceKm?: number;
  sourceUrl?: string;
}

export interface RouteTacticalTip {
  id: string;
  category: 'pacing' | 'climb' | 'descent' | 'equipment' | 'hydration' | 'safety' | 'surface';
  title: string;
  content: string;
  importance: 'essential' | 'recommended' | 'tip';
  kmMarker?: number;
}

export interface IntensiveAnalysisOptions {
  date?: string;
  activityType?: 'cycling' | 'running' | 'hiking';
  subType?: 'road' | 'gravel' | 'mtb' | 'ebike' | 'trail' | 'hike';
  fitnessLevel?: 'recreational' | 'moderate' | 'advanced' | 'elite';
  userWeightKg?: number;
  bikeWeightKg?: number;
  targetFtp?: number;
  customPaceMinKm?: number;
  includeEvents?: boolean;
  includePOIs?: boolean;
}

export interface IntensiveTrackAnalysisResult {
  trackId: string;
  trackName: string;
  date: string;
  activityType: 'cycling' | 'running' | 'hiking';
  subType: string;
  fitnessLevel: 'recreational' | 'moderate' | 'advanced' | 'elite';
  userWeightKg: number;
  totalDistanceKm: number;
  totalAscentMeters: number;
  totalDescentMeters: number;
  maxSlopePercent: number;
  minElevationMeters: number;
  maxElevationMeters: number;
  
  // Time & Pacing
  estimatedMovingTimeSeconds: number;
  estimatedElapsedTimeSeconds: number;
  estimatedAvgSpeedKmh: number;
  recommendedRestMinutes: number;
  difficultyScore: number; // 1 to 10
  difficultyLabel: string;
  
  // Energy & Nutrition
  totalCaloriesKcal: number;
  caloriesPerHour: number;
  carbsBurnedGrams: number;
  fatBurnedGrams: number;
  recommendedCarbsPerHourGrams: number;
  recommendedFluidMlPerHour: number;
  totalFluidRecommendedLiters: number;
  electrolyteRecommendation: string;
  
  // Tactical Tips & Route Breakdown
  tacticalTips: RouteTacticalTip[];
  splits: TrackSplit[];
  
  // Food & Water along the route
  foodAndWaterPOIs: RoutePOI[];
  
  // Date-Specific Events & Road Alerts
  dateEventsAndAlerts: RouteEventAlert[];
  
  locationStart?: string;
  locationSummit?: string;
  locationEnd?: string;
  aiSummary: string;
  aiGroundingSources?: { title: string; url: string }[];
  isAiEnhanced: boolean;
}



