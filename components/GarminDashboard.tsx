import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Database, Upload, AlertCircle, CheckCircle, RefreshCw, Trash2, 
  Heart, Moon, Sparkles, Footprints, Flame, Scale, TrendingUp, Info,
  FileText, Download
} from 'lucide-react';
import { 
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, 
  Tooltip, CartesianGrid, AreaChart, Area, ScatterChart, Scatter, ZAxis, Legend 
} from 'recharts';
import { getApiUrl } from '../utils/api';
import { parseLocationCoords, generateVirtualRoute } from '../utils/gpxUtils';

interface GarminDashboardProps {
  onClose: () => void;
  onLoadTrack?: (track: any) => void;
}

interface SleepRecord {
  date: string;
  duration: number; // minutes
  deep?: number;
  light?: number;
  rem?: number;
  awake?: number;
}

interface WeightRecord {
  date: string;
  weight: number;
  bmi?: number;
  body_fat?: number;
}

interface StressRecord {
  date: string;
  avg_stress: number;
}

interface RhrRecord {
  date: string;
  rhr: number;
}

interface StepsRecord {
  date: string;
  steps: number;
  calories?: number;
  distance?: number;
}

interface GarminActivity {
  id: string;
  name: string;
  type: string;
  date: string;
  distance: number;
  duration: number;
  ascent?: number;
  descent?: number;
  calories?: number;
  avg_hr?: number;
  points_json?: string;
  description?: string;
  location?: string;
}

interface HealthData {
  sleep: SleepRecord[];
  weight: WeightRecord[];
  stress: StressRecord[];
  rhr: RhrRecord[];
  steps: StepsRecord[];
  activities: GarminActivity[];
}

// Robust helper to extract heart rate
function extractHeartRate(p: any): number | undefined {
  if (!p) return undefined;
  const keys = ["hr", "heartrate", "heart_rate", "average_hr", "avg_hr", "hf", "herzfrequenz", "puls", "heartrate_bpm", "heart_rate_bpm"];
  for (const key of keys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val) && val > 0) return val;
    }
  }
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (keys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val) && val > 0) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to extract cadence
function extractCadence(p: any): number | undefined {
  if (!p) return undefined;
  const keys = ["cadence", "cad", "average_cadence", "avg_cadence", "bike_cadence", "run_cadence", "trittfrequenz", "cadence_rpm"];
  for (const key of keys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (keys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to extract power
function extractPower(p: any): number | undefined {
  if (!p) return undefined;
  const keys = ["power", "watts", "average_power", "avg_power", "pwr", "leistung", "power_watts"];
  for (const key of keys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (keys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to extract speed
function extractSpeed(p: any): number | undefined {
  if (!p) return undefined;
  const keys = ["speed", "velocity", "enhanced_speed", "speed_m_s", "geschwindigkeit"];
  for (const key of keys) {
    if (p[key] !== undefined && p[key] !== null) {
      const val = parseFloat(p[key]);
      if (!isNaN(val)) return val;
    }
  }
  if (typeof p === 'object') {
    for (const key of Object.keys(p)) {
      if (keys.includes(key.toLowerCase())) {
        const val = parseFloat(p[key]);
        if (!isNaN(val)) return val;
      }
    }
  }
  return undefined;
}

// Robust helper to normalize activity type
function isRunningType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return t.includes('run') || t.includes('laufen') || t.includes('jog') || t.includes('walk') || t.includes('hike');
}

function isCyclingType(type: string | undefined): boolean {
  if (!type) return false;
  const t = type.toLowerCase();
  return t.includes('cycle') || t.includes('bike') || t.includes('rad') || t.includes('road_biking') || t.includes('indoor_cycling') || t.includes('gravel_biking') || t.includes('mountain_biking');
}

function normalizeCoordinateClient(val: number, isLng: boolean = false): number {
  if (isNaN(val)) return val;
  const absVal = Math.abs(val);
  if (absVal <= 180) return val;

  const maxLimit = isLng ? 180 : 90;

  // Candidate conversions
  const semi = val * 180 / 2147483648;
  const e7 = val / 10000000;
  const e6 = val / 1000000;
  const e5 = val / 100000;

  const candidates = [
    { name: 'semicircles', val: semi },
    { name: 'e7', val: e7 },
    { name: 'e6', val: e6 },
    { name: 'e5', val: e5 }
  ];

  let bestCand = candidates[0];
  let bestScore = -1;

  for (const cand of candidates) {
    const absC = Math.abs(cand.val);
    if (absC > maxLimit) continue; // mathematically invalid

    let score = 0;
    // Human inhabited latitude/longitude bias
    if (absC >= 15 && absC <= 80) {
      score += 10;
    } else if (absC >= 2 && absC <= 85) {
      score += 5;
    } else {
      score += 1;
    }

    // Slight tie-breaker preference for semicircles and E7/E6 over E5
    if (cand.name === 'semicircles') score += 0.1;
    if (cand.name === 'e7') score += 0.05;

    if (score > bestScore) {
      bestScore = score;
      bestCand = cand;
    }
  }

  return bestCand.val;
}

// Helper to calculate total track distance in kilometers on the client
function calculateTotalTrackDistanceClient(pts: { lat: number, lng: number }[]): number {
  let d = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    d += calculateHaversineClient(pts[i].lat, pts[i].lng, pts[i + 1].lat, pts[i + 1].lng);
  }
  return d;
}

function calculateHaversineClient(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth's radius in km
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = 
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
    Math.sin(dLng / 2) * Math.sin(dLng / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Adaptive scale detector to support Degrees, Semicircles, E7, E6, E5 on the client
function normalizeTrackPointsWithScaleDetectionClient(rawPoints: any[], targetDistanceKm: number = 0): any[] {
  if (!rawPoints || rawPoints.length === 0) return [];

  // Find first point with non-zero coordinates to inspect raw values
  const sample = rawPoints.find(p => p.lat !== undefined && p.lng !== undefined && p.lat !== 0 && p.lng !== 0) || rawPoints[0];
  if (!sample) return rawPoints;

  const rawLat = Math.abs(parseFloat(sample.lat));
  const rawLng = Math.abs(parseFloat(sample.lng));

  if (isNaN(rawLat) || isNaN(rawLng)) return rawPoints;

  if (rawLat <= 180 && rawLng <= 180) {
    // Already in degrees
    return rawPoints.map(p => ({
      ...p,
      lat: parseFloat(p.lat),
      lng: parseFloat(p.lng)
    }));
  }

  // Candidate scales
  const candidates = [
    { name: 'semicircles', scale: 180 / 2147483648 },
    { name: 'e7', scale: 1 / 10000000 },
    { name: 'e6', scale: 1 / 1000000 },
    { name: 'e5', scale: 1 / 100000 }
  ];

  let bestCandidate = candidates[0];

  if (targetDistanceKm > 0.1) {
    // Choose scale that gets closest to target distance
    let minDiff = Infinity;
    for (const cand of candidates) {
      // Project a subset of points (e.g. first 200 points for speed) to compute track distance
      const subsetPts = rawPoints.slice(0, 200).map(p => ({
        lat: parseFloat(p.lat) * cand.scale,
        lng: parseFloat(p.lng) * cand.scale
      }));
      const subsetDist = calculateTotalTrackDistanceClient(subsetPts);
      // Estimate full distance based on subset ratio
      const estFullDist = subsetDist * (rawPoints.length / Math.min(rawPoints.length, 200));
      const diff = Math.abs(estFullDist - targetDistanceKm);
      
      // Ensure resulting coordinates are mathematically valid
      const testLat = rawLat * cand.scale;
      const testLng = rawLng * cand.scale;
      const isValid = Math.abs(testLat) <= 90 && Math.abs(testLng) <= 180;

      if (isValid && diff < minDiff) {
        minDiff = diff;
        bestCandidate = cand;
      }
    }
  } else {
    // Fallback to range-based detection
    let bestScore = -1;
    for (const cand of candidates) {
      const testLat = rawLat * cand.scale;
      const testLng = rawLng * cand.scale;
      const isValid = Math.abs(testLat) <= 90 && Math.abs(testLng) <= 180;
      if (!isValid) continue;

      let score = 0;
      if (Math.abs(testLat) >= 15 && Math.abs(testLat) <= 80) {
        score += 10;
      } else if (Math.abs(testLat) >= 2 && Math.abs(testLat) <= 85) {
        score += 5;
      } else {
        score += 1;
      }
      
      if (score > bestScore) {
        bestScore = score;
        bestCandidate = cand;
      }
    }
  }

  // Apply the chosen scale factor to all points
  return rawPoints.map(p => ({
    ...p,
    lat: parseFloat(p.lat) * bestCandidate.scale,
    lng: parseFloat(p.lng) * bestCandidate.scale
  }));
}

function parseFloatOrUndefined(val: any): number | undefined {
  if (val === undefined || val === null) return undefined;
  const parsed = parseFloat(val);
  return isNaN(parsed) ? undefined : parsed;
}


export const GarminDashboard: React.FC<GarminDashboardProps> = ({ onClose, onLoadTrack }) => {
  const [data, setData] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'sleep' | 'weight' | 'rhr' | 'steps' | 'stress' | 'activities' | 'analytics' | 'diagnostics'>('overview');
  const [isDragging, setIsDragging] = useState(false);
  const [dbUploadProgress, setDbUploadProgress] = useState<{ percentage: number; statusText: string } | null>(null);
  const [activitySearchQuery, setActivitySearchQuery] = useState('');
  const [localFiles, setLocalFiles] = useState<{ filename: string; path: string; size: number; mtime: string }[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [selectedCorrelation, setSelectedCorrelation] = useState<'hr_speed' | 'speed_ascent' | 'hr_ascent'>('hr_speed');
  
  // Database deep diagnostics states
  const [diagnosticFile, setDiagnosticFile] = useState<string>('');
  const [diagnosticReport, setDiagnosticReport] = useState<any | null>(null);
  const [isDiagnosing, setIsDiagnosing] = useState<boolean>(false);
  const [diagnoseError, setDiagnoseError] = useState<string | null>(null);

  const handleRunDiagnosis = async (filepath: string) => {
    setIsDiagnosing(true);
    setDiagnoseError(null);
    setDiagnosticFile(filepath);
    setActiveTab('diagnostics');
    try {
      const res = await fetch(getApiUrl('/api/garmin/diagnose'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath })
      });
      const json = await res.json();
      if (json.success) {
        setDiagnosticReport(json.report);
      } else {
        setDiagnoseError(json.error || 'Diagnose fehlgeschlagen.');
      }
    } catch (err: any) {
      setDiagnoseError(err.message || 'Netzwerkfehler bei der Diagnose.');
    } finally {
      setIsDiagnosing(false);
    }
  };

  const handleDownloadDiagnosticReport = () => {
    if (!diagnosticReport) return;
    try {
      const jsonString = `data:text/json;charset=utf-8,${encodeURIComponent(
        JSON.stringify(diagnosticReport, null, 2)
      )}`;
      const downloadAnchor = document.createElement('a');
      downloadAnchor.setAttribute('href', jsonString);
      downloadAnchor.setAttribute('download', `garmin_diagnostics_${diagnosticReport.filename}.json`);
      document.body.appendChild(downloadAnchor);
      downloadAnchor.click();
      downloadAnchor.remove();
    } catch (e) {
      console.error('Failed to download diagnostic report:', e);
    }
  };
  
  // Server-side SQLite Import Debug Logs State
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [showLogs, setShowLogs] = useState<boolean>(false);
  const [isRefreshingLogs, setIsRefreshingLogs] = useState<boolean>(false);

  const fetchDebugLogs = async () => {
    setIsRefreshingLogs(true);
    try {
      const res = await fetch(getApiUrl('/api/import-debug-logs'));
      const json = await res.json();
      if (json.success) {
        setDebugLogs(json.logs || []);
      }
    } catch (err) {
      console.error('Failed to fetch debug logs', err);
    } finally {
      setIsRefreshingLogs(false);
    }
  };

  const clearDebugLogs = async () => {
    if (!window.confirm('Möchtest du das Server-Protokoll wirklich leeren?')) return;
    try {
      const res = await fetch(getApiUrl('/api/import-debug-logs/clear'), { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setDebugLogs([]);
      }
    } catch (err) {
      console.error('Failed to clear debug logs', err);
    }
  };

  // Auto-fetch logs when showLogs is toggled
  useEffect(() => {
    if (showLogs) {
      fetchDebugLogs();
    }
  }, [showLogs]);

  const activityPoints = useMemo(() => {
    return analyticsData?.activityCorrelations?.points || [];
  }, [analyticsData]);

  const correlationDetails = useMemo(() => {
    const corr = analyticsData?.activityCorrelations || {};
    switch (selectedCorrelation) {
      case 'hr_speed':
        return {
          r: corr.hrSpeed ?? 0,
          xKey: 'speedKmh',
          yKey: 'avgHr',
          xLabel: 'Geschwindigkeit (km/h)',
          yLabel: 'Durchschnittspuls (bpm)',
          title: 'Herzfrequenz vs. Geschwindigkeit',
          desc: 'Diese Analyse zeigt, wie deine Herzfrequenz auf unterschiedliche Geschwindigkeiten reagiert. Bei gutem Trainingszustand (aerobe Kapazität) bleibt die Herzfrequenz bei tempo- und ausdauerintensiven Läufen niedriger.'
        };
      case 'speed_ascent':
        return {
          r: corr.speedAscent ?? 0,
          xKey: 'ascent',
          yKey: 'speedKmh',
          xLabel: 'Höhenmeter (m)',
          yLabel: 'Geschwindigkeit (km/h)',
          title: 'Geschwindigkeit vs. Höhenmeter',
          desc: 'Zeigt den Einfluss von Steigungen auf deine Durchschnittsgeschwindigkeit. Mehr Höhenmeter bedeuten typischerweise ein geringeres Gesamttempo durch die zusätzliche Hubarbeit.'
        };
      case 'hr_ascent':
        return {
          r: corr.hrAscent ?? 0,
          xKey: 'ascent',
          yKey: 'avgHr',
          xLabel: 'Höhenmeter (m)',
          yLabel: 'Durchschnittspuls (bpm)',
          title: 'Herzfrequenz vs. Höhenmeter',
          desc: 'Untersucht, ob anspruchsvolle Anstiege mit einem höheren durchschnittlichen Puls einhergehen. Hügelige Strecken fordern Herz und Kreislauf intensiver.'
        };
    }
  }, [selectedCorrelation, analyticsData]);

  const chartData = useMemo(() => {
    const pts = activityPoints;
    if (selectedCorrelation === 'hr_speed' || selectedCorrelation === 'hr_ascent') {
      return pts.filter((p: any) => p.avgHr !== undefined);
    }
    return pts;
  }, [activityPoints, selectedCorrelation]);

  const chartGroupedData = useMemo(() => {
    const pts = chartData;
    const running = pts.filter((pt: any) => {
      const t = pt.type ? pt.type.toLowerCase() : 'other';
      return t.includes('run') || t === 'running';
    });
    const cycling = pts.filter((pt: any) => {
      const t = pt.type ? pt.type.toLowerCase() : 'other';
      return t.includes('cycle') || t.includes('bike') || t === 'cycling';
    });
    const other = pts.filter((pt: any) => {
      const t = pt.type ? pt.type.toLowerCase() : 'other';
      return !t.includes('run') && t !== 'running' && !t.includes('cycle') && !t.includes('bike') && t !== 'cycling';
    });
    return { running, cycling, other };
  }, [chartData]);

  const getCorrBadgeColor = (r: number) => {
    const absR = Math.abs(r);
    if (absR > 0.5) return 'bg-rose-100 dark:bg-rose-950/40 text-rose-700 dark:text-rose-400 border border-rose-200 dark:border-rose-900/30';
    if (absR > 0.2) return 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400 border border-orange-200 dark:border-orange-900/30';
    return 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700';
  };

  const getCorrStrengthText = (r: number) => {
    const absR = Math.abs(r);
    let strength = 'Keine';
    if (absR > 0.7) strength = 'Sehr starke';
    else if (absR > 0.5) strength = 'Starke';
    else if (absR > 0.3) strength = 'Moderate';
    else if (absR > 0.1) strength = 'Schwache';
    
    const direction = r > 0 ? 'positive' : r < 0 ? 'negative' : '';
    return `${strength} ${direction} Korrelation`;
  };

  const filteredActivities = useMemo(() => {
    if (!data || !data.activities) return [];
    if (!activitySearchQuery.trim()) return data.activities;
    const query = activitySearchQuery.toLowerCase();
    return data.activities.filter((act) => {
      const nameMatch = act.name?.toLowerCase().includes(query);
      const typeMatch = act.type?.toLowerCase().includes(query);
      const dateMatch = act.date?.toLowerCase().includes(query);
      return nameMatch || typeMatch || dateMatch;
    });
  }, [data, activitySearchQuery]);

  // Fetch metrics from backend
  const fetchHealthMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl('/api/health-metrics'));
      const json = await res.json();
      if (json.success) {
        setData(json.data);
      } else {
        setError(json.error || 'Fehler beim Laden der Gesundheitsdaten.');
      }
    } catch (err: any) {
      console.error(err);
      setError('Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  // Fetch workspace files list (bypasses browser upload limits for large databases)
  const fetchLocalDbs = useCallback(async () => {
    try {
      const res = await fetch(getApiUrl('/api/list-local-dbs'));
      const json = await res.json();
      if (json.success && json.files) {
        setLocalFiles(json.files);
      }
    } catch (err) {
      console.error('Failed to load local DB files:', err);
    }
  }, []);

  // Fetch computed health analytics
  const fetchAnalytics = useCallback(async () => {
    setIsAnalyticsLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/health-analytics'));
      const json = await res.json();
      if (json.success && json.analytics) {
        setAnalyticsData(json.analytics);
      }
    } catch (err) {
      console.error('Failed to load advanced analytics:', err);
    } finally {
      setIsAnalyticsLoading(false);
    }
  }, []);

  // Load Garmin Activity into current workspace (generates virtual route)
  const handleLoadActivity = useCallback((act: GarminActivity) => {
    if (!onLoadTrack) return;
    try {
      // Find starting coordinates
      let startCoords = parseLocationCoords((act as any).location);
      if (!startCoords) {
        // Fallback: Munich, Germany
        startCoords = { lat: 48.1351, lng: 11.5820 };
      }
      
      const durationSec = act.duration || 3600;
      const distanceKm = act.distance || 10;
      const ascent = act.ascent || 0;
      const descent = act.descent || 0;
      const avgHr = act.avg_hr || undefined;
      const activityType = isRunningType(act.type) ? 'running' : 'cycling';
      
      let isVirtual = false;
      let points: any[] = [];
      if (act.points_json) {
        try {
          let parsed = JSON.parse(act.points_json);
          // Auto-unwrap nested coordinate object lists if needed
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const arrayKey = Object.keys(parsed).find(k => Array.isArray((parsed as any)[k]));
            if (arrayKey) {
              parsed = (parsed as any)[arrayKey];
            }
          }

          if (Array.isArray(parsed) && parsed.length > 0) {
            // Determine lat/lng index if they are nested arrays
            let latIndex = 0;
            let lngIndex = 1;
            const firstArrayItem = parsed.find(item => Array.isArray(item));
            if (firstArrayItem) {
              const val0 = parseFloat(firstArrayItem[0]);
              const val1 = parseFloat(firstArrayItem[1]);
              if (!isNaN(val0) && !isNaN(val1)) {
                const norm0 = normalizeCoordinateClient(val0, false);
                if (Math.abs(norm0) > 90) {
                  latIndex = 1;
                  lngIndex = 0;
                }
              }
            }

            points = parsed.map((p: any) => {
              if (!p) return null;
              if (Array.isArray(p)) {
                const rawLat = parseFloat(p[latIndex]);
                const rawLng = parseFloat(p[lngIndex]);
                if (isNaN(rawLat) || isNaN(rawLng)) return null;
                return {
                  lat: rawLat,
                  lng: rawLng,
                  ele: p[2] !== undefined && p[2] !== null ? parseFloatOrUndefined(p[2]) : undefined,
                  time: p[3] ? new Date(p[3]) : undefined,
                  hr: p[4] !== undefined && p[4] !== null ? parseFloatOrUndefined(p[4]) : undefined,
                  cadence: p[5] !== undefined && p[5] !== null ? parseFloatOrUndefined(p[5]) : undefined,
                  power: p[6] !== undefined && p[6] !== null ? parseFloatOrUndefined(p[6]) : undefined,
                  speed: p[7] !== undefined && p[7] !== null ? parseFloatOrUndefined(p[7]) : undefined,
                };
              } else if (typeof p === 'object') {
                const latKey = Object.keys(p).find(k => ["lat", "latitude", "lat_deg", "position_lat", "position_latitude", "y"].includes(k.toLowerCase()));
                const lngKey = Object.keys(p).find(k => ["lng", "longitude", "lon", "lon_deg", "lng_deg", "position_lon", "position_longitude", "x"].includes(k.toLowerCase()));
                if (!latKey || !lngKey) return null;
                
                const rawLat = parseFloat(p[latKey]);
                const rawLng = parseFloat(p[lngKey]);
                if (isNaN(rawLat) || isNaN(rawLng)) return null;

                const eleKey = Object.keys(p).find(k => ["ele", "elevation", "alt", "altitude", "altitude_m", "height", "enhanced_altitude", "enhanced_altitude_m"].includes(k.toLowerCase()));
                const timeKey = Object.keys(p).find(k => ["time", "timestamp", "date", "ts", "time_val"].includes(k.toLowerCase()));

                return {
                  lat: rawLat,
                  lng: rawLng,
                  ele: eleKey && p[eleKey] !== undefined && p[eleKey] !== null ? parseFloatOrUndefined(p[eleKey]) : undefined,
                  time: timeKey && p[timeKey] ? new Date(p[timeKey]) : undefined,
                  hr: extractHeartRate(p),
                  cadence: extractCadence(p),
                  power: extractPower(p),
                  speed: extractSpeed(p),
                };
              }
              return null;
            }).filter((p): p is any => p !== null);

            // Apply track-wide adaptive scale detection to resolve raw coordinate scales correctly
            points = normalizeTrackPointsWithScaleDetectionClient(points, distanceKm);
          }
        } catch (pe) {
          console.error('Failed to parse points_json from database:', pe);
        }
      }

      if (points.length <= 1) {
        isVirtual = true;
        points = generateVirtualRoute(
          startCoords.lat,
          startCoords.lng,
          distanceKm,
          durationSec,
          ascent,
          descent,
          avgHr,
          activityType
        );
      }
      
      const track = {
        id: `garmin-act-${act.id || Date.now()}`,
        name: act.name || 'Garmin Aktivität',
        points,
        color: '#f97316', // Orange Garmin-branding
        distance: distanceKm,
        ascent,
        descent,
        maxSlope: 0,
        visible: true,
        activityType,
        duration: durationSec,
        hasTimestamps: true,
        description: (act as any).description || `Garmin Aktivität in ${(act as any).location || 'Unbekannt'}`,
        isVirtual
      };
      
      onLoadTrack(track);
      setSuccessMsg('Aktivität erfolgreich in den Workspace geladen!');
      // Clear success after 3 seconds
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err) {
      console.error('Failed to load Garmin activity:', err);
      setError('Konnte Garmin-Aktivität nicht in Workspace laden.');
      setTimeout(() => setError(null), 4000);
    }
  }, [onLoadTrack]);

  useEffect(() => {
    fetchHealthMetrics();
    fetchLocalDbs();
  }, [fetchHealthMetrics, fetchLocalDbs]);

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchAnalytics();
    }
  }, [activeTab, fetchAnalytics]);

  // Handle SQLite File Import with Upload Progress Tracker
  const handleFileUpload = async (file: File) => {
    setError(null);
    setSuccessMsg(null);

    // Prevent direct HTTP upload of very large files to avoid network failure
    const MAX_DIRECT_UPLOAD_SIZE = 150 * 1024 * 1024; // 150 MB
    if (file.size > MAX_DIRECT_UPLOAD_SIZE) {
      setDbUploadProgress(null);
      setIsLoading(false);
      setError(
        <div className="space-y-3 p-2">
          <div className="flex items-center gap-2 text-red-800 dark:text-red-400 font-bold text-base">
            <AlertCircle className="w-5 h-5 text-red-600 shrink-0" />
            <span>Datenbank-Datei ist zu groß für den Web-Upload ({formatFileSize(file.size)})</span>
          </div>
          <p className="text-xs leading-relaxed text-slate-600 dark:text-slate-300">
            Dateien über 150 MB (wie deine 10 GB Garmin-Backup-Datei) können aufgrund von Browser- und Netzwerk-Timeouts der Cloud-Plattform nicht direkt über ein Web-Formular hochgeladen werden (dies bricht meist mit einem Netzwerkfehler ab).
          </p>
          <div className="bg-white dark:bg-slate-900 p-4 rounded-xl border border-red-200 dark:border-red-900/50 text-slate-700 dark:text-slate-300 text-xs space-y-2.5">
            <p className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <Database className="w-4 h-4 text-orange-500" />
              Einfache & stabile Lösung direkt im Workspace:
            </p>
            <ol className="list-decimal list-inside space-y-2 text-[11px]">
              <li>
                Ziehe deine Datei <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded font-mono font-bold text-orange-600 dark:text-orange-400">{file.name}</code> links in den **Dateiexplorer von AI Studio** (oder nutze dort das Upload-Symbol).
              </li>
              <li>
                Sobald der Upload im AI Studio-Dateiexplorer abgeschlossen ist (geht dank direkter Synchronisation absolut stabil), lade dieses Fenster einmal neu.
              </li>
              <li>
                Die Datei wird automatisch erkannt und erscheint rechts in der Liste unter **'Lokale Dateien im Workspace'**.
              </li>
              <li>
                Klicke dort einfach auf **'Importieren'** – der Server liest die 10 GB SQLite-Datei direkt von der Festplatte ein (Dauer: wenige Sekunden, 0% RAM-Belastung!).
              </li>
            </ol>
          </div>
        </div>
      );
      return;
    }

    setIsLoading(true);
    setDbUploadProgress({ percentage: 0, statusText: 'Bereite Upload vor...' });

    try {
      const result = await new Promise<{ success: boolean; stats?: any; error?: string }>((resolve) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', getApiUrl('/api/import-sqlite'), true);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');

        // Track upload progress
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percentage = Math.round((e.loaded / e.total) * 100);
            setDbUploadProgress({
              percentage,
              statusText: percentage < 100 
                ? `Datenbank-Upload läuft: ${percentage}%` 
                : 'Upload abgeschlossen. Server importiert und analysiert Ihre Garmin-Daten...'
            });
          }
        };

        xhr.onload = () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            try {
              const res = JSON.parse(xhr.responseText);
              resolve(res);
            } catch (err) {
              resolve({ success: false, error: 'Ungültige Antwort vom Server beim Einlesen der Antwort.' });
            }
          } else {
            try {
              const res = JSON.parse(xhr.responseText);
              resolve({ success: false, error: res.error || `Server-Fehler: Status ${xhr.status}` });
            } catch (err) {
              resolve({ success: false, error: `Der Server hat mit Statuscode ${xhr.status} geantwortet.` });
            }
          }
        };

        xhr.onerror = () => {
          resolve({ success: false, error: 'Netzwerkfehler: Verbindung zum Server fehlgeschlagen. Bitte prüfen Sie Ihre Verbindung.' });
        };

        xhr.send(file);
      });

      if (result.success && result.stats) {
        const s = result.stats;
        setSuccessMsg(
          `Erfolgreich importiert: ${s.sleep} Schlafdatensätze, ${s.weight} Gewichtseinträge, ${s.stress} Stresstage, ${s.rhr} Pulsdaten, ${s.steps} Schrittdaten & ${s.activities} Aktivitäten!`
        );
        fetchHealthMetrics();
        fetchDebugLogs();
        setShowLogs(true);
      } else {
        setError(result.error || 'Fehler beim Analysieren der SQLite-Datenbank.');
        fetchDebugLogs();
        setShowLogs(true);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || 'Ein unerwarteter Fehler ist beim Hochladen aufgetreten.');
    } finally {
      setIsLoading(false);
      setDbUploadProgress(null);
    }
  };

  const formatFileSize = (bytes: number) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  const handleLocalDbImport = async (filepath: string) => {
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const res = await fetch(getApiUrl('/api/import-local-db'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filepath })
      });
      const json = await res.json();
      if (json.success && json.stats) {
        const s = json.stats;
        setSuccessMsg(
          `Erfolgreich aus lokaler Datei importiert: ${s.sleep} Schlafdatensätze, ${s.weight} Gewichtseinträge, ${s.stress} Stresstage, ${s.rhr} Pulsdaten, ${s.steps} Schrittdaten & ${s.activities} Aktivitäten!`
        );
        fetchHealthMetrics();
        fetchDebugLogs();
        setShowLogs(true);
      } else {
        setError(json.error || 'Fehler beim Importieren der lokalen Datenbank.');
        fetchDebugLogs();
        setShowLogs(true);
      }
    } catch (err: any) {
      console.error(err);
      setError('Verbindung zum Server fehlgeschlagen.');
    } finally {
      setIsLoading(false);
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (file.name.endsWith('.db') || file.name.endsWith('.sqlite')) {
        handleFileUpload(file);
      } else {
        setError('Bitte lade eine gültige SQLite-Datenbankdatei (.db oder .sqlite) hoch.');
      }
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileUpload(files[0]);
    }
  };

  // Clear all data
  const handleClearData = async () => {
    if (!window.confirm('Möchtest du wirklich alle importierten Garmin-Gesundheitsdaten löschen?')) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await fetch(getApiUrl('/api/health-metrics/clear'), { method: 'POST' });
      const json = await res.json();
      if (json.success) {
        setData({ sleep: [], weight: [], stress: [], rhr: [], steps: [], activities: [] });
        setSuccessMsg('Gesundheitsdaten erfolgreich zurückgesetzt!');
      } else {
        setError(json.error || 'Fehler beim Löschen der Daten.');
      }
    } catch (err) {
      setError('Fehler beim Zurücksetzen der Daten.');
    } finally {
      setIsLoading(false);
    }
  };

  // Helper formatting values
  const formatMinutes = (mins: number) => {
    const hrs = Math.floor(mins / 60);
    const m = Math.round(mins % 60);
    return hrs > 0 ? `${hrs} Std. ${m} Min.` : `${m} Min.`;
  };

  // Stats calculation
  const latestWeight = data?.weight && data.weight.length > 0 ? data.weight[data.weight.length - 1] : null;
  const avgRhr = data?.rhr && data.rhr.length > 0 
    ? Math.round(data.rhr.reduce((acc, r) => acc + r.rhr, 0) / data.rhr.length) 
    : null;
  const avgSteps = data?.steps && data.steps.length > 0
    ? Math.round(data.steps.reduce((acc, s) => acc + s.steps, 0) / data.steps.length)
    : null;
  const avgSleep = data?.sleep && data.sleep.length > 0
    ? Math.round(data.sleep.reduce((acc, s) => acc + s.duration, 0) / data.sleep.length)
    : null;

  const renderDebugTerminal = () => {
    return (
      <div className="border border-slate-200 dark:border-slate-800 rounded-3xl bg-white dark:bg-slate-900 overflow-hidden shadow-xs mt-6 text-left">
        <button
          type="button"
          onClick={() => setShowLogs(!showLogs)}
          className="w-full flex items-center justify-between p-5 text-left font-bold text-sm text-slate-800 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-850/35 transition-colors cursor-pointer"
        >
          <div className="flex items-center gap-2">
            <span className="flex h-2 w-2 relative">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-orange-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-orange-500"></span>
            </span>
            <span>Server-Import-Protokoll & Diagnose</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-slate-400 dark:text-slate-500">
            <span>{showLogs ? 'Ausblenden' : 'Einblenden'}</span>
            <span className="text-slate-300 dark:text-slate-700">|</span>
            <span>{debugLogs.length} Einträge</span>
          </div>
        </button>

        {showLogs && (
          <div className="border-t border-slate-150 dark:border-slate-800/80 p-5 space-y-4 bg-slate-950 text-slate-200">
            <div className="flex items-center justify-between text-xs pb-3 border-b border-slate-800">
              <div className="flex items-center gap-1.5 font-mono text-slate-400">
                <span className="text-orange-500 font-extrabold">$</span>
                <span>tail -f /var/log/garmin_import.log</span>
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={fetchDebugLogs}
                  disabled={isRefreshingLogs}
                  className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 border border-slate-800 rounded text-[10px] font-bold text-slate-300 flex items-center gap-1 cursor-pointer disabled:opacity-50"
                >
                  <RefreshCw className={`w-3 h-3 ${isRefreshingLogs ? 'animate-spin' : ''}`} />
                  Aktualisieren
                </button>
                <button
                  type="button"
                  onClick={clearDebugLogs}
                  className="px-2.5 py-1 bg-slate-900 hover:bg-slate-850 border border-slate-800 hover:border-red-950 rounded text-[10px] font-bold text-red-450 flex items-center gap-1 cursor-pointer"
                >
                  <Trash2 className="w-3 h-3" />
                  Leeren
                </button>
              </div>
            </div>

            <div className="font-mono text-[10px] leading-relaxed max-h-80 overflow-y-auto space-y-1 pr-2 scrollbar-thin select-text">
              {debugLogs.length === 0 ? (
                <p className="text-slate-500 italic py-2">Keine Protokolleinträge vorhanden. Starte einen Import, um Logdaten zu generieren.</p>
              ) : (
                debugLogs.map((log, idx) => {
                  let colorClass = "text-slate-300";
                  if (log.includes("[FEHLER]") || log.includes("[Error]")) {
                    colorClass = "text-red-400 font-bold";
                  } else if (log.includes("[Warnung]") || log.includes("[Pivot-Warnung]")) {
                    colorClass = "text-amber-400 font-semibold";
                  } else if (log.includes("[Pivot-Erfolg]") || log.includes("[Pivot-Normalisiert-Punkt")) {
                    colorClass = "text-emerald-400";
                  } else if (log.includes("==== STARTE")) {
                    colorClass = "text-orange-400 font-extrabold border-b border-orange-950 pb-1 mt-3 block";
                  } else if (log.includes("[Pivot-Setup]")) {
                    colorClass = "text-blue-400";
                  } else if (log.includes("[Pivot-Diagnose]")) {
                    colorClass = "text-cyan-400 font-medium";
                  }
                  return (
                    <div key={idx} className={`${colorClass} whitespace-pre-wrap break-all`}>
                      {log}
                    </div>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="relative w-full max-w-6xl h-[88vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col"
      >
        {/* DB Upload Progress Overlay */}
        <AnimatePresence>
          {dbUploadProgress && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-slate-950/70 backdrop-blur-md flex flex-col items-center justify-center p-8 text-center"
            >
              <div className="bg-white dark:bg-slate-900 rounded-3xl p-8 max-w-md w-full shadow-2xl border border-slate-150 dark:border-slate-800 space-y-6">
                <div className="flex justify-center">
                  <div className="relative flex items-center justify-center">
                    <RefreshCw className="w-12 h-12 text-orange-500 animate-spin" />
                    <span className="absolute text-[10px] font-bold text-slate-800 dark:text-slate-100">{dbUploadProgress.percentage}%</span>
                  </div>
                </div>
                
                <div className="space-y-2">
                  <h3 className="text-lg font-bold text-slate-800 dark:text-slate-100">Synchronisiere Garmin-Daten...</h3>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed min-h-[3rem]">
                    {dbUploadProgress.statusText}
                  </p>
                </div>

                {/* Progress Bar */}
                <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-3.5 overflow-hidden border border-slate-200/50 dark:border-slate-700/50">
                  <motion.div 
                    className="bg-gradient-to-r from-orange-500 to-amber-500 h-full rounded-full"
                    initial={{ width: 0 }}
                    animate={{ width: `${dbUploadProgress.percentage}%` }}
                    transition={{ duration: 0.1 }}
                  />
                </div>

                <div className="text-[10px] text-slate-400 dark:text-slate-500 italic">
                  Bitte lassen Sie dieses Fenster geöffnet, bis der Vorgang abgeschlossen ist.
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
        {/* Header */}
        <div className="flex items-center justify-between p-6 bg-slate-50 dark:bg-slate-850 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-orange-100 dark:bg-orange-950/40 rounded-xl text-orange-600 dark:text-orange-400">
              <Database className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2">
                Garmin Connect Fitness & Gesundheit
                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 font-extrabold px-2 py-0.5 rounded-full uppercase tracking-wider">
                  SQLite Kompatibel
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Importiere und analysiere deine lokalen SQLite-Datenbanken aus <b>garmin-health-data</b> und <b>python-garminconnect</b>.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-1.5 hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Content Area */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Messages */}
          {error && (
            <div className="flex items-start gap-2.5 p-4 bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400 rounded-2xl border border-red-200/50 dark:border-red-900/30 text-sm">
              <AlertCircle className="w-5 h-5 shrink-0" />
              <span>{error}</span>
            </div>
          )}
          {successMsg && (
            <div className="flex items-start gap-2.5 p-4 bg-emerald-50 dark:bg-emerald-950/20 text-emerald-700 dark:text-emerald-400 rounded-2xl border border-emerald-200/50 dark:border-emerald-900/30 text-sm">
              <CheckCircle className="w-5 h-5 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {/* Import Panel if no data imported yet */}
          {(!data || (data.sleep.length === 0 && data.weight.length === 0 && data.rhr.length === 0 && data.steps.length === 0)) ? (
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
              {/* Dropzone */}
              <div className="lg:col-span-6 flex flex-col">
                <div 
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex-1 min-h-[320px] border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-8 text-center transition-all ${
                    isDragging 
                      ? 'border-orange-500 bg-orange-50/20 dark:bg-orange-950/10 scale-[0.99]' 
                      : 'border-slate-200 dark:border-slate-800 hover:border-slate-350 dark:hover:border-slate-700 bg-slate-50/50 dark:bg-slate-900/20'
                  }`}
                >
                  <div className="p-4 bg-orange-50 dark:bg-orange-950/20 text-orange-600 dark:text-orange-400 rounded-2xl mb-4">
                    <Upload className="w-10 h-10 animate-bounce" />
                  </div>
                  <h3 className="text-base font-bold text-slate-800 dark:text-slate-200 mb-1">
                    Ziehe deine Garmin SQLite-Datenbank hierher
                  </h3>
                  <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mb-4">
                    Unterstützt Dateien wie <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">garmin.db</code> (bis zu 300 MB).
                  </p>
                  
                  <label className="px-5 py-2.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-sm font-bold shadow-md shadow-orange-100 cursor-pointer transition-all flex items-center gap-2">
                    <Upload className="w-4 h-4" />
                    Datei auswählen
                    <input 
                      type="file" 
                      accept=".db,.sqlite" 
                      onChange={handleFileInput} 
                      className="hidden" 
                    />
                  </label>
                </div>
              </div>

              {/* Workspace Direct Import & Docs */}
              <div className="lg:col-span-6 bg-slate-50 dark:bg-slate-850 rounded-3xl p-6 border border-slate-100 dark:border-slate-800/60 flex flex-col justify-between space-y-6">
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-2">
                    <Database className="w-4 h-4 text-orange-500" />
                    Lokale Dateien im Workspace (bis zu 10 GB)
                  </h4>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mb-3 leading-relaxed">
                    Für extrem große Datenbanken (z.B. deine 10 GB Garmin-Backup-Datei) kannst du die Datei direkt im Workspace platzieren. Der Server liest sie ohne Browser-Upload direkt von der Festplatte ein.
                  </p>
                  
                  {localFiles.length === 0 ? (
                    <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-150 dark:border-slate-800 text-center text-[11px] text-slate-500">
                      Keine .db- oder .sqlite-Dateien im Workspace gefunden.
                      <div className="mt-2 text-[10px] text-slate-400">
                        Platziere deine <code className="bg-slate-200 dark:bg-slate-700 px-1 rounded">garmin.db</code> im Hauptverzeichnis des Projekts, um sie hier direkt zu importieren!
                      </div>
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                      {localFiles.map((f) => (
                        <div key={f.path} className="flex items-center justify-between p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-150 dark:border-slate-800 text-xs">
                          <div className="truncate pr-2">
                            <p className="font-semibold text-slate-800 dark:text-slate-200 truncate" title={f.filename}>{f.filename}</p>
                            <p className="text-[10px] text-slate-400">{formatFileSize(f.size)}</p>
                          </div>
                          <div className="flex gap-1.5 shrink-0">
                            <button
                              onClick={() => handleRunDiagnosis(f.path)}
                              disabled={isDiagnosing}
                              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-lg text-[10px] font-bold cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1"
                              title="Datenbankstruktur und Spalten diagnostizieren"
                            >
                              🔍 Diagnose
                            </button>
                            <button
                              onClick={() => handleLocalDbImport(f.path)}
                              disabled={isLoading}
                              className="px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all disabled:opacity-50"
                            >
                              Importieren
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <div className="pt-3 border-t border-slate-200 dark:border-slate-800/80">
                  <h5 className="text-[11px] font-bold text-slate-700 dark:text-slate-300 mb-1 flex items-center gap-1">
                    <Info className="w-3.5 h-3.5 text-slate-400" />
                    Wie erhalte ich das Garmin-Backup?
                  </h5>
                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-normal">
                    Führe das Open-Source-Tool <code className="bg-slate-150 dark:bg-slate-800 px-1 rounded text-orange-600 dark:text-orange-400">garmin-health-data</code> aus, um deine Daten in eine <code className="bg-slate-150 dark:bg-slate-800 px-1 rounded">garmin.db</code> Datei herunterzuladen:
                  </p>
                  <pre className="mt-1.5 p-1.5 bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 rounded-lg text-[9px] font-mono overflow-x-auto text-slate-700 dark:text-slate-300">
                    pip install garmin-health-data{"\n"}
                    garmin-health-data --backup-dir ./backup
                  </pre>
                </div>
              </div>
            </div>
          ) : (
            /* Main Dashboard View */
            <div className="space-y-6">
              {/* Bento-Grid Quick Stats */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {/* Steps */}
                <div className="bg-emerald-50/40 dark:bg-emerald-950/10 p-5 rounded-2xl border border-emerald-100/40 dark:border-emerald-900/20 flex items-center gap-4">
                  <div className="p-3 bg-emerald-100 dark:bg-emerald-950/50 text-emerald-600 dark:text-emerald-400 rounded-xl">
                    <Footprints className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Ø Schritte / Tag</span>
                    <span className="text-lg font-black text-slate-800 dark:text-slate-100">
                      {avgSteps ? avgSteps.toLocaleString('de-DE') : '-'}
                    </span>
                  </div>
                </div>

                {/* Weight */}
                <div className="bg-blue-50/40 dark:bg-blue-950/10 p-5 rounded-2xl border border-blue-100/40 dark:border-blue-900/20 flex items-center gap-4">
                  <div className="p-3 bg-blue-100 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400 rounded-xl">
                    <Scale className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Letztes Gewicht</span>
                    <span className="text-lg font-black text-slate-800 dark:text-slate-100">
                      {latestWeight ? `${latestWeight.weight.toFixed(1)} kg` : '-'}
                    </span>
                  </div>
                </div>

                {/* RHR */}
                <div className="bg-rose-50/40 dark:bg-rose-950/10 p-5 rounded-2xl border border-rose-100/40 dark:border-rose-900/20 flex items-center gap-4">
                  <div className="p-3 bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 rounded-xl">
                    <Heart className="w-5 h-5 animate-pulse" />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Ø Ruhepuls (RHR)</span>
                    <span className="text-lg font-black text-slate-800 dark:text-slate-100">
                      {avgRhr ? `${avgRhr} bpm` : '-'}
                    </span>
                  </div>
                </div>

                {/* Sleep */}
                <div className="bg-indigo-50/40 dark:bg-indigo-950/10 p-5 rounded-2xl border border-indigo-100/40 dark:border-indigo-900/20 flex items-center gap-4">
                  <div className="p-3 bg-indigo-100 dark:bg-indigo-950/50 text-indigo-600 dark:text-indigo-400 rounded-xl">
                    <Moon className="w-5 h-5" />
                  </div>
                  <div>
                    <span className="text-[10px] text-slate-400 dark:text-slate-500 font-bold uppercase tracking-wider block">Ø Schlafdauer</span>
                    <span className="text-lg font-black text-slate-800 dark:text-slate-100">
                      {avgSleep ? formatMinutes(avgSleep) : '-'}
                    </span>
                  </div>
                </div>
              </div>

              {/* Navigation Tabs */}
              <div className="flex gap-1 bg-slate-50 dark:bg-slate-850 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-x-auto">
                {(['overview', 'sleep', 'weight', 'rhr', 'steps', 'stress', 'activities', 'analytics', 'diagnostics'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer whitespace-nowrap ${
                      activeTab === tab
                        ? 'bg-orange-600 text-white shadow-md shadow-orange-100'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tab === 'overview' 
                      ? 'Übersicht' 
                      : tab === 'activities' 
                      ? 'Aktivitäten' 
                      : tab === 'analytics' 
                      ? 'Erweiterte Analyse 📊' 
                      : tab === 'diagnostics'
                      ? '🔍 Diagnosetool'
                      : tab}
                  </button>
                ))}
              </div>

              {/* Dynamic Tab Panel */}
              <div className="bg-slate-50/40 dark:bg-slate-900/40 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 min-h-[380px] flex flex-col">
                <AnimatePresence mode="wait">
                  {/* Tab 1: OVERVIEW */}
                  {activeTab === 'overview' && (
                    <motion.div 
                      key="overview"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-6 flex-1 flex flex-col justify-between"
                    >
                      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        {/* Ruhepuls & Gewicht */}
                        <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/60 shadow-xs">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                            <span>Ruhepuls Trend (bpm)</span>
                            <Heart className="w-3.5 h-3.5 text-rose-500" />
                          </h4>
                          <div className="h-48 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <LineChart data={data?.rhr.slice(-30)}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                                <YAxis domain={['dataMin - 5', 'dataMax + 5']} stroke="#94a3b8" fontSize={9} />
                                <Tooltip contentStyle={{ borderRadius: '12px' }} />
                                <Line type="monotone" dataKey="rhr" name="Ruhepuls" stroke="#e11d48" strokeWidth={3} dot={false} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        {/* Schritte Verlauf */}
                        <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/60 shadow-xs">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                            <span>Tägliche Schritte</span>
                            <Footprints className="w-3.5 h-3.5 text-emerald-500" />
                          </h4>
                          <div className="h-48 w-full">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={data?.steps.slice(-15)}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                                <YAxis stroke="#94a3b8" fontSize={9} />
                                <Tooltip contentStyle={{ borderRadius: '12px' }} />
                                <Bar dataKey="steps" name="Schritte" fill="#10b981" radius={[4, 4, 0, 0]} />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>

                      {/* Local Files in Workspace when data is loaded */}
                      {localFiles.length > 0 && (
                        <div className="p-4 bg-slate-100/40 dark:bg-slate-900/40 rounded-2xl border border-slate-200/50 dark:border-slate-800/80">
                          <h5 className="text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center gap-1.5 mb-2">
                            <Database className="w-3.5 h-3.5 text-orange-500" />
                            Lokale Dateien im Workspace (für große DBs bis zu 10 GB)
                          </h5>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                            {localFiles.map((f) => (
                              <div key={f.path} className="flex items-center justify-between p-2.5 bg-white dark:bg-slate-850 rounded-xl border border-slate-150 dark:border-slate-800 text-xs">
                                <div className="truncate pr-2">
                                  <p className="font-semibold text-slate-800 dark:text-slate-200 truncate" title={f.filename}>{f.filename}</p>
                                  <p className="text-[10px] text-slate-400">{formatFileSize(f.size)}</p>
                                </div>
                                <div className="flex gap-1.5 shrink-0">
                                  <button
                                    onClick={() => handleRunDiagnosis(f.path)}
                                    disabled={isDiagnosing}
                                    className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-750 text-slate-700 dark:text-slate-300 rounded-lg text-[10px] font-bold cursor-pointer transition-all disabled:opacity-50 flex items-center gap-1"
                                    title="Datenbankstruktur und Spalten diagnostizieren"
                                  >
                                    🔍 Diagnose
                                  </button>
                                  <button
                                    onClick={() => handleLocalDbImport(f.path)}
                                    disabled={isLoading}
                                    className="shrink-0 px-3 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-[10px] font-bold cursor-pointer transition-all disabled:opacity-50"
                                  >
                                    Importieren
                                  </button>
                                </div>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Dropzone again to let them update existing db */}
                      <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                          <Info className="w-4 h-4 text-slate-500" />
                          Du kannst jederzeit eine neuere Datenbankdatei hochladen, um deine Daten zu aktualisieren.
                        </div>
                        <div className="flex gap-2">
                          <label className="px-3.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-755 text-slate-700 dark:text-slate-300 rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center gap-1">
                            <Upload className="w-3.5 h-3.5" />
                            Neue DB importieren
                            <input type="file" accept=".db,.sqlite" onChange={handleFileInput} className="hidden" />
                          </label>
                          <button
                            onClick={handleClearData}
                            className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold transition-all flex items-center gap-1"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                            Daten zurücksetzen
                          </button>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 2: SLEEP */}
                  {activeTab === 'sleep' && (
                    <motion.div 
                      key="sleep"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Schlafverlauf & Schlafphasen</h4>
                      <p className="text-xs text-slate-500">Zeigt deine gesamte Schlafdauer und die Verteilung von Leicht-, Tief- und REM-Schlafphasen.</p>
                      <div className="h-64 w-full bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={data?.sleep.slice(-30)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                            <YAxis unit=" Std." tickFormatter={(v) => (v / 60).toFixed(0)} stroke="#94a3b8" fontSize={9} />
                            <Tooltip 
                              contentStyle={{ borderRadius: '12px' }}
                              formatter={(value: any, name: any) => [formatMinutes(Number(value)), name]}
                            />
                            <Bar dataKey="deep" name="Tiefschlaf" stackId="a" fill="#1e3a8a" />
                            <Bar dataKey="rem" name="REM" stackId="a" fill="#8b5cf6" />
                            <Bar dataKey="light" name="Leichtschlaf" stackId="a" fill="#3b82f6" />
                            <Bar dataKey="awake" name="Wach" stackId="a" fill="#f59e0b" />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 3: WEIGHT */}
                  {activeTab === 'weight' && (
                    <motion.div 
                      key="weight"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Körpergewicht & Zusammensetzung</h4>
                      <p className="text-xs text-slate-500">Überwache die Entwicklung deines Körpergewichts, Body-Mass-Index (BMI) und des Körperfettanteils.</p>
                      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="md:col-span-2 h-64 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                          <ResponsiveContainer width="100%" height="100%">
                            <LineChart data={data?.weight}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                              <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                              <YAxis domain={['dataMin - 1', 'dataMax + 1']} stroke="#94a3b8" fontSize={9} unit=" kg" />
                              <Tooltip contentStyle={{ borderRadius: '12px' }} />
                              <Line type="monotone" dataKey="weight" name="Gewicht" stroke="#ff7300" strokeWidth={3} dot={{ r: 3 }} />
                            </LineChart>
                          </ResponsiveContainer>
                        </div>

                        <div className="space-y-4">
                          <div className="bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col justify-between h-[120px]">
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Body-Mass-Index (BMI)</span>
                            <span className="text-3xl font-black text-slate-800 dark:text-slate-100">
                              {latestWeight?.bmi ? latestWeight.bmi.toFixed(1) : '-'}
                            </span>
                            <span className="text-[10px] text-slate-400">basierend auf der letzten Messung</span>
                          </div>

                          <div className="bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800 flex flex-col justify-between h-[120px]">
                            <span className="text-[10px] text-slate-400 font-bold uppercase block">Körperfett (%)</span>
                            <span className="text-3xl font-black text-slate-800 dark:text-slate-100">
                              {latestWeight?.body_fat ? `${latestWeight.body_fat.toFixed(1)} %` : '-'}
                            </span>
                            <span className="text-[10px] text-slate-400">Verhältnis von Fett- zu Muskelmasse</span>
                          </div>
                        </div>
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 4: RHR */}
                  {activeTab === 'rhr' && (
                    <motion.div 
                      key="rhr"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Ruheherzfrequenz (RHR)</h4>
                      <p className="text-xs text-slate-500">Ein hervorragender Indikator für deine Regeneration, Ausdauerleistung und Fitnessentwicklung über Zeit.</p>
                      <div className="h-64 w-full bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={data?.rhr}>
                            <defs>
                              <linearGradient id="colorRhr" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                            <YAxis domain={['dataMin - 5', 'dataMax + 5']} stroke="#94a3b8" fontSize={9} />
                            <Tooltip contentStyle={{ borderRadius: '12px' }} />
                            <Area type="monotone" dataKey="rhr" name="Ruhepuls" stroke="#f43f5e" strokeWidth={3} fillOpacity={1} fill="url(#colorRhr)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 5: STEPS */}
                  {activeTab === 'steps' && (
                    <motion.div 
                      key="steps"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Schritte & Kalorienverbrauch</h4>
                      <p className="text-xs text-slate-500">Überwache deine tägliche Aktivität im Alltag, Distanzen und verbrannte Kalorien.</p>
                      <div className="h-64 w-full bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                        <ResponsiveContainer width="100%" height="100%">
                          <BarChart data={data?.steps.slice(-30)}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                            <YAxis yAxisId="left" stroke="#10b981" fontSize={9} />
                            <YAxis yAxisId="right" orientation="right" stroke="#ef4444" fontSize={9} unit=" kcal" />
                            <Tooltip contentStyle={{ borderRadius: '12px' }} />
                            <Bar yAxisId="left" dataKey="steps" name="Schritte" fill="#10b981" radius={[3, 3, 0, 0]} />
                            <Bar yAxisId="right" dataKey="calories" name="Kalorien" fill="#ef4444" radius={[3, 3, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 6: STRESS */}
                  {activeTab === 'stress' && (
                    <motion.div 
                      key="stress"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Tägliche Stressbelastung</h4>
                      <p className="text-xs text-slate-500">Dein Stress-Score (0-100) berechnet aus der Herzfrequenzvariabilität (HRV) für tiefere Regenerationseinblicke.</p>
                      <div className="h-64 w-full bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={data?.stress}>
                            <defs>
                              <linearGradient id="colorStress" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#ef4444" stopOpacity={0.2}/>
                                <stop offset="95%" stopColor="#ef4444" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                            <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                            <YAxis domain={[0, 100]} stroke="#94a3b8" fontSize={9} />
                            <Tooltip contentStyle={{ borderRadius: '12px' }} />
                            <Area type="monotone" dataKey="avg_stress" name="Ø Stress-Level" stroke="#ef4444" strokeWidth={3} fillOpacity={1} fill="url(#colorStress)" />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 7: ACTIVITIES */}
                  {activeTab === 'activities' && (
                    <motion.div 
                      key="activities"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-4"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-black text-slate-800 dark:text-slate-200">Importierte Aktivitäten</h4>
                          <p className="text-xs text-slate-500">Eine Übersicht über deine Aktivitäten, die direkt aus deiner SQLite-Datenbank gelesen wurden.</p>
                        </div>
                        <div className="flex items-center gap-2">
                          {activitySearchQuery && (
                            <span className="text-xs text-indigo-600 dark:text-indigo-400 font-semibold">
                              Gefunden: {filteredActivities.length} / 
                            </span>
                          )}
                          <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full font-bold">
                            Insgesamt: {data?.activities.length || 0}
                          </span>
                        </div>
                      </div>

                      {/* Search Bar */}
                      <div className="relative">
                        <input
                          id="activity-search-input"
                          type="text"
                          value={activitySearchQuery}
                          onChange={(e) => setActivitySearchQuery(e.target.value)}
                          placeholder="Aktivitäten nach Name, Typ oder Datum filtern..."
                          className="w-full px-4 py-2 text-xs bg-slate-50 dark:bg-slate-850 border border-slate-150 dark:border-slate-800 rounded-xl focus:outline-none focus:border-indigo-500 text-slate-700 dark:text-slate-300 placeholder-slate-400"
                        />
                        {activitySearchQuery && (
                          <button
                            id="clear-activity-search"
                            onClick={() => setActivitySearchQuery('')}
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 text-sm"
                          >
                            ✕
                          </button>
                        )}
                      </div>

                      <div className="max-h-[300px] overflow-y-auto border border-slate-150 dark:border-slate-800 rounded-2xl">
                        {filteredActivities.length === 0 ? (
                          <div className="p-8 text-center text-xs text-slate-500">
                            Keine Aktivitäten gefunden, die dem Suchbegriff entsprechen.
                          </div>
                        ) : (
                          <table className="w-full text-left border-collapse text-xs">
                            <thead>
                              <tr className="bg-slate-50 dark:bg-slate-850 border-b border-slate-150 dark:border-slate-800 text-slate-400 font-bold uppercase tracking-wider">
                                <th className="p-3">Aktivität</th>
                                <th className="p-3">Datum</th>
                                <th className="p-3">Distanz</th>
                                <th className="p-3">Dauer</th>
                                <th className="p-3">Höhenmeter</th>
                                <th className="p-3">Kalorien</th>
                                <th className="p-3 text-right">Aktion</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                              {filteredActivities.map((act) => (
                                <tr key={act.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/40">
                                  <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                                    <div className="flex flex-col gap-0.5">
                                      <div className="flex items-center gap-1.5 flex-wrap">
                                        <span>{isRunningType(act.type) ? '🏃' : isCyclingType(act.type) ? '🚴' : '🏅'}</span>
                                        <span>{act.name}</span>
                                        {!act.points_json && (
                                          <span className="text-[9px] bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400 font-normal px-1.5 py-0.5 rounded border border-slate-200/50 dark:border-slate-700/50 cursor-help inline-flex shrink-0" title="Diese Aktivität enthält keine GPS-Spur in der SQLite-Datenbank. Beim Laden wird eine virtuelle Route erzeugt.">
                                            NUR STATS
                                          </span>
                                        )}
                                        {act.location && (
                                          <span className="text-[9px] bg-indigo-55/70 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 font-bold px-1.5 py-0.5 rounded border border-indigo-100/30 dark:border-indigo-900/30 shrink-0" title="Standort">
                                            📍 {act.location}
                                          </span>
                                        )}
                                      </div>
                                      {act.description && (
                                        <p className="text-[10px] text-slate-400 dark:text-slate-500 font-medium max-w-md italic tracking-wide mt-0.5">
                                          {act.description}
                                        </p>
                                      )}
                                    </div>
                                  </td>
                                  <td className="p-3 text-slate-500">{act.date}</td>
                                  <td className="p-3">{act.distance.toFixed(1)} km</td>
                                  <td className="p-3">{formatMinutes(act.duration / 60)}</td>
                                  <td className="p-3">
                                    {act.ascent !== undefined && act.ascent !== null ? `+${Math.round(act.ascent)}m` : '-'}
                                  </td>
                                  <td className="p-3">
                                    {act.calories !== undefined && act.calories !== null ? `${Math.round(act.calories)} kcal` : '-'}
                                  </td>
                                  <td className="p-3 text-right">
                                    {onLoadTrack && (
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          handleLoadActivity(act);
                                        }}
                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-md text-[10px] cursor-pointer shadow-3xs transition-colors"
                                        title="In Workspace laden"
                                      >
                                        In Workspace laden
                                      </button>
                                    )}
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </div>
                    </motion.div>
                  )}

                  {/* Tab 8: ERWEITERTE ANALYSE */}
                  {activeTab === 'analytics' && (
                    <motion.div
                      key="analytics"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-6 flex-1"
                    >
                      <div className="flex items-center justify-between">
                        <div>
                          <h4 className="text-sm font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                            <Sparkles className="w-4 h-4 text-orange-500" />
                            Erweiterte Gesundheits- und Leistungsanalyse
                          </h4>
                          <p className="text-xs text-slate-500">
                            Tiefgehende mathematische Analysen und Korrelationen deiner Garmin-Historie.
                          </p>
                        </div>
                        {isAnalyticsLoading && (
                          <div className="flex items-center gap-1.5 text-xs text-orange-600 dark:text-orange-400 font-bold">
                            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
                            Berechne Korrelationen...
                          </div>
                        )}
                      </div>

                      {!analyticsData ? (
                        <div className="p-12 text-center bg-white dark:bg-slate-850 rounded-3xl border border-slate-150 dark:border-slate-800/80 flex flex-col items-center justify-center space-y-3">
                          <AlertCircle className="w-8 h-8 text-slate-400" />
                          <p className="text-xs text-slate-500 max-w-sm">
                            Nicht genügend Daten für tiefe mathematische Korrelationen vorhanden oder Berechnungen laufen noch.
                          </p>
                          <p className="text-[10px] text-slate-400">
                            Bitte importiere eine Garmin-Datenbank, die Schlaf-, Stress- und Aktivitätsdaten enthält.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {/* Top row: Sleep-Stress and Weight-Fat Pearson Correlations */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            
                            {/* Card 1: Sleep vs Stress */}
                            <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/60 pb-2">
                                <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                  Schlafqualität vs. Alltagsstress
                                </h5>
                                <span className={`text-[10px] font-extrabold px-2 py-0.5 rounded-full ${
                                  Math.abs(analyticsData.sleepStressCorrelation.coefficient) > 0.3 
                                    ? 'bg-orange-100 dark:bg-orange-950/40 text-orange-700 dark:text-orange-400' 
                                    : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                                }`}>
                                  r = {analyticsData.sleepStressCorrelation.coefficient.toFixed(2)}
                                </span>
                              </div>
                              
                              <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed font-medium">
                                <span className="font-bold text-slate-800 dark:text-slate-100">Analyse: </span>
                                {analyticsData.sleepStressCorrelation.interpretation}
                              </p>

                              {/* Small explanatory visual */}
                              <div className="text-[10px] text-slate-400 leading-relaxed bg-slate-50/50 dark:bg-slate-900/20 p-3 rounded-xl border border-slate-100 dark:border-slate-800">
                                <p className="font-bold text-slate-500 mb-1">💡 Verständnis:</p>
                                Ein negativer Pearson-Koeffizient (r &lt; 0) bedeutet, dass längere Schlafdauer signifikant mit geringerem durchschnittlichen Stress tagsüber korreliert. Je näher der Wert bei -1 liegt, desto stärker ist dieser beruhigende Effekt.
                              </div>
                            </div>

                            {/* Card 2: Weight vs Body Fat */}
                            <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800/60 pb-2">
                                <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                  Körpergewicht & Körperfettanteil
                                </h5>
                                <span className="text-[10px] font-extrabold px-2 py-0.5 rounded-full bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400">
                                  r = {analyticsData.weightFatCorrelation.coefficient.toFixed(2)}
                                </span>
                              </div>

                              <p className="text-xs text-slate-600 dark:text-slate-350 leading-relaxed font-medium">
                                <span className="font-bold text-slate-800 dark:text-slate-100">Analyse: </span>
                                {analyticsData.weightFatCorrelation.interpretation}
                              </p>

                              {/* Weight/Fat mini-chart */}
                              {analyticsData.weightFatCorrelation.dataPoints && analyticsData.weightFatCorrelation.dataPoints.length > 1 ? (
                                <div className="h-28 w-full">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={analyticsData.weightFatCorrelation.dataPoints.slice(-15)}>
                                      <XAxis dataKey="date" hide />
                                      <YAxis yAxisId="left" stroke="#3b82f6" fontSize={8} domain={['dataMin - 1', 'dataMax + 1']} />
                                      <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={8} domain={['dataMin - 1', 'dataMax + 1']} />
                                      <Tooltip contentStyle={{ borderRadius: '8px', fontSize: '10px' }} />
                                      <Line yAxisId="left" type="monotone" dataKey="weight" name="Gewicht (kg)" stroke="#3b82f6" strokeWidth={2} dot={false} />
                                      <Line yAxisId="right" type="monotone" dataKey="bodyFat" name="Körperfett (%)" stroke="#10b981" strokeWidth={2} dot={false} />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                              ) : (
                                <div className="h-28 bg-slate-50 dark:bg-slate-900/30 rounded-xl flex items-center justify-center text-[10px] text-slate-400 border border-slate-100 dark:border-slate-800">
                                  Trage mindestens 2 Gewichts- & Körperfett-Einträge für den Verlauf ein.
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Middle row: Fitness Adaption (RHR vs. Training Volume) */}
                          <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                            <div>
                              <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                Aerobe Fitness-Adaption (Wöchentliches Trainingsvolumen vs. Ruhepuls)
                              </h5>
                              <p className="text-[10px] text-slate-400 mt-1">
                                Verfolgt, wie sich ein steigendes wöchentliches Lauf-/Fahrradvolumen langfristig senkend auf deinen durchschnittlichen Ruhepuls (RHR) auswirkt.
                              </p>
                            </div>

                            {analyticsData.weeklyRhrTrainingTrend && analyticsData.weeklyRhrTrainingTrend.length > 0 ? (
                              <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 items-center">
                                <div className="lg:col-span-3 h-48 w-full">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <LineChart data={analyticsData.weeklyRhrTrainingTrend.slice(-12)}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                      <XAxis dataKey="week" stroke="#94a3b8" fontSize={9} />
                                      <YAxis yAxisId="left" stroke="#ef4444" fontSize={9} domain={['dataMin - 2', 'dataMax + 2']} label={{ value: 'Puls (bpm)', angle: -90, position: 'insideLeft', style: {fontSize: 8} }} />
                                      <YAxis yAxisId="right" orientation="right" stroke="#10b981" fontSize={9} label={{ value: 'Aktivität (km)', angle: 90, position: 'insideRight', style: {fontSize: 8} }} />
                                      <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '11px' }} />
                                      <Line yAxisId="left" type="monotone" dataKey="avgRhr" name="Mittel Ruhepuls" stroke="#ef4444" strokeWidth={3} activeDot={{ r: 6 }} />
                                      <Line yAxisId="right" type="monotone" dataKey="totalDistance" name="Gesamtstrecke (km)" stroke="#10b981" strokeWidth={2} dot={true} />
                                    </LineChart>
                                  </ResponsiveContainer>
                                </div>
                                <div className="p-4 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800 space-y-3">
                                  <h6 className="text-[11px] font-bold text-slate-700 dark:text-slate-300">📈 Leistungsdiagnostik</h6>
                                  <p className="text-[10px] text-slate-500 dark:text-slate-400 leading-relaxed">
                                    Mit zunehmender kardiovaskulärer Fitness vergrößert sich das Schlagvolumen deines Herzens. Dadurch muss es im Ruhezustand seltener schlagen, um den Körper mit Sauerstoff zu versorgen.
                                  </p>
                                  <p className="text-[9px] text-rose-500 dark:text-rose-400 italic">
                                    Tipp: Ein dauerhaft sinkender Ruhepuls bei gleichem oder höherem Trainingsvolumen signalisiert ein verbessertes Fitnesslevel!
                                  </p>
                                </div>
                              </div>
                            ) : (
                              <div className="h-40 bg-slate-50 dark:bg-slate-900/30 rounded-xl flex items-center justify-center text-xs text-slate-400 border border-slate-100 dark:border-slate-800">
                                Keine Trainingsvolumen- oder Pulstrends im Verlauf gefunden.
                              </div>
                            )}
                          </div>

                          {/* Bottom Row: Weekday Trends & Monthly Sleep Trends */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            
                            {/* Weekday Trends */}
                            <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                              <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                Wochentags-Muster (Aktivität & Belastung)
                              </h5>
                              <div className="h-44 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                  <BarChart data={analyticsData.weekdayTrends}>
                                    <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                    <XAxis dataKey="dayName" stroke="#94a3b8" fontSize={9} />
                                    <YAxis yAxisId="left" stroke="#10b981" fontSize={8} />
                                    <YAxis yAxisId="right" orientation="right" stroke="#f59e0b" fontSize={8} domain={[0, 100]} />
                                    <Tooltip contentStyle={{ borderRadius: '12px', fontSize: '10px' }} />
                                    <Bar yAxisId="left" dataKey="avgSteps" name="Mittel Schritte" fill="#10b981" radius={[3, 3, 0, 0]} />
                                    <Line yAxisId="right" type="monotone" dataKey="avgStress" name="Ø Stress-Wert" stroke="#f59e0b" strokeWidth={2} />
                                  </BarChart>
                                </ResponsiveContainer>
                              </div>
                            </div>

                            {/* Monthly Sleep Quality Trends */}
                            <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                              <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                Monatliche Schlafdauer & Tiefschlaf
                              </h5>
                              {analyticsData.monthlySleepAnalysis && analyticsData.monthlySleepAnalysis.length > 0 ? (
                                <div className="h-44 w-full">
                                  <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={analyticsData.monthlySleepAnalysis}>
                                      <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                      <XAxis dataKey="month" stroke="#94a3b8" fontSize={9} />
                                      <YAxis unit="h" tickFormatter={(v) => (v / 60).toFixed(0)} stroke="#94a3b8" fontSize={8} />
                                      <Tooltip 
                                        contentStyle={{ borderRadius: '12px', fontSize: '10px' }}
                                        formatter={(val: any, name: any) => [formatMinutes(Number(val)), name]}
                                      />
                                      <Area type="monotone" dataKey="avgDuration" name="Gesamtschlaf" stroke="#6366f1" fill="#818cf8" fillOpacity={0.2} strokeWidth={2.5} />
                                      <Area type="monotone" dataKey="avgDeep" name="Tiefschlaf" stroke="#4f46e5" fill="#4f46e5" fillOpacity={0.3} strokeWidth={1.5} />
                                    </AreaChart>
                                  </ResponsiveContainer>
                                </div>
                              ) : (
                                <div className="h-44 bg-slate-50 dark:bg-slate-900/30 rounded-xl flex items-center justify-center text-xs text-slate-400 border border-slate-100 dark:border-slate-800">
                                  Keine historischen Schlafdaten für eine Monatsanalyse vorhanden.
                                </div>
                              )}
                            </div>
                          </div>

                          {/* Row 4: Sport efficiency card */}
                          <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-4">
                            <div>
                              <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider">
                                Sportarten-Effizienz & Kalorienverbrauch
                              </h5>
                              <p className="text-[10px] text-slate-400 mt-1">
                                Vergleich des stündlichen Kalorienverbrauchs (kcal/h) und der durchschnittlichen Herzfrequenz nach Aktivitätstyp.
                              </p>
                            </div>

                            {analyticsData.sportEfficiency && analyticsData.sportEfficiency.length > 0 ? (
                              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                                {analyticsData.sportEfficiency.map((sport: any) => (
                                  <div key={sport.type} className="p-4 bg-slate-50 dark:bg-slate-900/30 border border-slate-100 dark:border-slate-800 rounded-xl space-y-2">
                                    <div className="flex items-center justify-between">
                                      <span className="text-xs font-black capitalize text-slate-800 dark:text-slate-200">
                                        {sport.type === 'running' ? '🏃 Laufen' : sport.type === 'cycling' ? '🚴 Radfahren' : `🏅 ${sport.type}`}
                                      </span>
                                      <span className="text-[10px] text-slate-400">
                                        {sport.count}x ausgeführt
                                      </span>
                                    </div>
                                    <div className="grid grid-cols-2 gap-2 text-[10px]">
                                      <div className="p-2 bg-white dark:bg-slate-950/40 rounded-lg">
                                        <p className="text-slate-400">Verbrennung</p>
                                        <p className="font-extrabold text-orange-600 dark:text-orange-400 text-xs">
                                          {Math.round(sport.calorieBurnRatePerHour)} kcal/h
                                        </p>
                                      </div>
                                      <div className="p-2 bg-white dark:bg-slate-950/40 rounded-lg">
                                        <p className="text-slate-400">Ø Puls</p>
                                        <p className="font-extrabold text-rose-600 dark:text-rose-400 text-xs">
                                          {sport.avgHr ? `${Math.round(sport.avgHr)} bpm` : '-'}
                                        </p>
                                      </div>
                                    </div>
                                    <div className="text-[9px] text-slate-400 pt-1 flex justify-between">
                                      <span>Gesamtdistanz: {sport.totalDistance.toFixed(1)} km</span>
                                      <span>Ø Dauer: {formatMinutes(sport.totalDuration / sport.count / 60)}</span>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="p-6 bg-slate-50 dark:bg-slate-900/30 rounded-xl text-center text-xs text-slate-400 border border-slate-100 dark:border-slate-800">
                                Keine Sportaktivitäten in der Garmin-Datenbank für eine Effizienzanalyse gefunden.
                              </div>
                            )}
                          </div>

                          {/* Row 5: Multi-variable Performance Correlations Scatter plot */}
                          <div className="bg-white dark:bg-slate-850 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-6">
                            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
                              <div>
                                <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                                  Multi-Variable Leistungs-Korrelationen
                                </h5>
                                <p className="text-[10px] text-slate-400 mt-1">
                                  Visualisiert die Wechselwirkungen zwischen Puls, Geschwindigkeit und bewältigten Höhenmetern in all deinen importierten Garmin-Aktivitäten.
                                </p>
                              </div>

                              {/* Selected Correlation Selector */}
                              <div className="flex flex-wrap gap-1 bg-slate-50 dark:bg-slate-900/50 p-1 rounded-xl border border-slate-100 dark:border-slate-800">
                                <button
                                  onClick={() => setSelectedCorrelation('hr_speed')}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    selectedCorrelation === 'hr_speed'
                                      ? 'bg-orange-600 text-white shadow-xs'
                                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  Puls vs. Tempo
                                </button>
                                <button
                                  onClick={() => setSelectedCorrelation('speed_ascent')}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    selectedCorrelation === 'speed_ascent'
                                      ? 'bg-orange-600 text-white shadow-xs'
                                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  Tempo vs. Höhenmeter
                                </button>
                                <button
                                  onClick={() => setSelectedCorrelation('hr_ascent')}
                                  className={`px-3 py-1.5 rounded-lg text-xs font-bold transition-all ${
                                    selectedCorrelation === 'hr_ascent'
                                      ? 'bg-orange-600 text-white shadow-xs'
                                      : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                                  }`}
                                >
                                  Puls vs. Höhenmeter
                                </button>
                              </div>
                            </div>

                            {/* Correlation Strength Indicator & Summary */}
                            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                              {/* Scatter Chart Column */}
                              <div className="lg:col-span-8 flex flex-col space-y-2">
                                {chartData.length === 0 ? (
                                  <div className="h-64 bg-slate-50 dark:bg-slate-900/30 rounded-xl flex flex-col items-center justify-center text-center p-4 border border-slate-150 dark:border-slate-800">
                                    <AlertCircle className="w-7 h-7 text-slate-400 mb-2" />
                                    <p className="text-xs text-slate-500 font-bold">Keine ausreichenden Aktivitätsdaten vorhanden</p>
                                    <p className="text-[10px] text-slate-400 mt-1 max-w-xs">
                                      Für diese Auswertung müssen Aktivitäten mit Pulsdaten (Ø Puls) und Höhendifferenzen in der Garmin-Datenbank hinterlegt sein.
                                    </p>
                                  </div>
                                ) : (
                                  <div className="h-72 w-full bg-slate-50/40 dark:bg-slate-900/10 rounded-xl p-2 border border-slate-100 dark:border-slate-800/80">
                                    <ResponsiveContainer width="100%" height="100%">
                                      <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
                                        <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" />
                                        <XAxis 
                                          type="number" 
                                          dataKey={correlationDetails.xKey} 
                                          name={correlationDetails.xLabel} 
                                          unit={selectedCorrelation === 'hr_speed' ? ' km/h' : ' m'}
                                          fontSize={9}
                                          stroke="#94a3b8"
                                        />
                                        <YAxis 
                                          type="number" 
                                          dataKey={correlationDetails.yKey} 
                                          name={correlationDetails.yLabel} 
                                          unit={selectedCorrelation === 'speed_ascent' ? ' km/h' : ' bpm'}
                                          fontSize={9}
                                          stroke="#94a3b8"
                                          domain={['auto', 'auto']}
                                        />
                                        <ZAxis type="number" range={[40, 40]} />
                                        <Tooltip content={(props) => {
                                          if (props.active && props.payload && props.payload.length) {
                                            const pt = props.payload[0].payload;
                                            return (
                                              <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-800 shadow-xl text-[11px] space-y-1 max-w-[240px]">
                                                <p className="font-bold text-slate-100 truncate">{pt.name}</p>
                                                <p className="text-[10px] text-slate-400">{pt.date} | {pt.type === 'running' ? '🏃 Laufen' : pt.type === 'cycling' ? '🚴 Radfahren' : pt.type}</p>
                                                <div className="border-t border-slate-800 my-1 pt-1 space-y-0.5">
                                                  <div className="flex justify-between">
                                                    <span className="text-slate-400">Distanz:</span>
                                                    <span className="font-semibold text-slate-200">{pt.distance} km</span>
                                                  </div>
                                                  <div className="flex justify-between">
                                                    <span className="text-slate-400">Dauer:</span>
                                                    <span className="font-semibold text-slate-200">{pt.durationMinutes} min</span>
                                                  </div>
                                                  <div className="flex justify-between">
                                                    <span className="text-slate-400">Tempo:</span>
                                                    <span className="font-bold text-teal-400">{pt.speedKmh} km/h</span>
                                                  </div>
                                                  {pt.avgHr && (
                                                    <div className="flex justify-between">
                                                      <span className="text-slate-400">Ø Puls:</span>
                                                      <span className="font-bold text-rose-400">{pt.avgHr} bpm</span>
                                                    </div>
                                                  )}
                                                  <div className="flex justify-between">
                                                    <span className="text-slate-400">Höhenmeter:</span>
                                                    <span className="font-bold text-amber-400">+{pt.ascent} m</span>
                                                  </div>
                                                </div>
                                              </div>
                                            );
                                          }
                                          return null;
                                        }} />
                                        <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px' }} />
                                        <Scatter name="🏃 Laufen" data={chartGroupedData.running} fill="#f97316" />
                                        <Scatter name="🚴 Radfahren" data={chartGroupedData.cycling} fill="#3b82f6" />
                                        <Scatter name="🏅 Andere" data={chartGroupedData.other} fill="#a855f7" />
                                      </ScatterChart>
                                    </ResponsiveContainer>
                                  </div>
                                )}
                              </div>

                              {/* Interactive Diagnostic / Physiology panel */}
                              <div className="lg:col-span-4 flex flex-col justify-between p-4 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800 space-y-4">
                                <div className="space-y-3">
                                  <h6 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase">
                                    {correlationDetails.title}
                                  </h6>

                                  <div className="flex items-center gap-2">
                                    <span className={`text-xs font-extrabold px-2.5 py-1 rounded-lg ${getCorrBadgeColor(correlationDetails.r)}`}>
                                      r = {correlationDetails.r.toFixed(2)}
                                    </span>
                                    <span className="text-[10px] text-slate-500 dark:text-slate-400 font-bold">
                                      {getCorrStrengthText(correlationDetails.r)}
                                    </span>
                                  </div>

                                  <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                                    {correlationDetails.desc}
                                  </p>
                                </div>

                                <div className="text-[10px] text-orange-600 dark:text-orange-400 leading-relaxed bg-orange-50/20 dark:bg-orange-950/10 p-3 rounded-lg border border-orange-100/50 dark:border-orange-900/20">
                                  <p className="font-bold mb-1">💡 Trainingstipp:</p>
                                  {selectedCorrelation === 'hr_speed' ? (
                                    "Ein flacherer Kurvenverlauf (höheres Tempo bei gleichem oder geringerem Puls) im historischen Vergleich zeigt eine signifikante Ökonomisierung deines Herzkreislaufsystems."
                                  ) : selectedCorrelation === 'speed_ascent' ? (
                                    "Versuche bei stark hügeligen Strecken, deine mechanische Leistung am Berg gezielt zu drosseln, um anaerobe Belastungsspitzen und schnellen Ermüdungsaufbau zu vermeiden."
                                  ) : (
                                    "Achte auf deine Herzfrequenz-Zonen bei langen Anstiegen. Kontrolliertes Klettern in Zone 2 bis 3 schützt vor vorzeitigem Erschöpfen deiner Glykogenspeicher."
                                  )}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}

                  {activeTab === 'diagnostics' && (
                    <motion.div
                      key="diagnostics"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="space-y-6 flex-1"
                    >
                      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-slate-100 dark:border-slate-800/80 pb-4">
                        <div>
                          <h4 className="text-sm font-black text-slate-850 dark:text-slate-100 flex items-center gap-2">
                            <Database className="w-4 h-4 text-orange-500" />
                            Garmin-Datenbank Diagnosezentrum & Inspektor
                          </h4>
                          <p className="text-xs text-slate-500">
                            Analysiere Tabellenschemata, GPS-Spalten und Rohwerte, um Einleseprobleme präzise zu debuggen.
                          </p>
                        </div>
                        {diagnosticReport && (
                          <button
                            onClick={handleDownloadDiagnosticReport}
                            className="px-3.5 py-1.5 bg-orange-600 hover:bg-orange-700 text-white rounded-xl text-xs font-bold transition-all flex items-center gap-1.5 cursor-pointer shadow-xs"
                          >
                            <Download className="w-3.5 h-3.5" />
                            Diagnosebericht herunterladen (JSON)
                          </button>
                        )}
                      </div>

                      {isDiagnosing && (
                        <div className="p-12 text-center bg-white dark:bg-slate-850 rounded-3xl border border-slate-150 dark:border-slate-800/80 flex flex-col items-center justify-center space-y-4">
                          <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
                          <p className="text-xs text-slate-600 font-bold">Führe tiefe Datenbank-Strukturanalyse aus...</p>
                          <p className="text-[10px] text-slate-400">Prüfe Tabellenschemata und min/max GPS-Wertebereiche.</p>
                        </div>
                      )}

                      {diagnoseError && (
                        <div className="p-5 bg-red-50 dark:bg-red-950/20 border border-red-150 dark:border-red-900/40 rounded-2xl flex gap-3">
                          <AlertCircle className="w-5 h-5 text-red-500 shrink-0 mt-0.5" />
                          <div>
                            <h5 className="text-xs font-bold text-red-800 dark:text-red-400">Diagnosefehler</h5>
                            <p className="text-xs text-red-600 dark:text-red-300 mt-1">{diagnoseError}</p>
                          </div>
                        </div>
                      )}

                      {!isDiagnosing && !diagnosticReport && (
                        <div className="p-12 text-center bg-white dark:bg-slate-850 rounded-3xl border border-slate-150 dark:border-slate-800/80 flex flex-col items-center justify-center space-y-3">
                          <Info className="w-8 h-8 text-slate-400" />
                          <p className="text-xs text-slate-500 font-bold max-w-sm leading-normal">
                            Bisher wurde kein Diagnosebericht generiert.
                          </p>
                          <p className="text-[10px] text-slate-400 max-w-sm">
                            Klicke in der Dateiliste auf <strong className="text-orange-500">🔍 Diagnose</strong> neben einer deiner SQLite-Dateien im Workspace, um eine vollständige Tiefenanalyse zu starten.
                          </p>
                        </div>
                      )}

                      {!isDiagnosing && diagnosticReport && (
                        <div className="space-y-6">
                          {/* File metadata info */}
                          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                            <div className="p-3 bg-white dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800/60">
                              <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-bold">Analysierte Datei</span>
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300 truncate block" title={diagnosticReport.filename}>
                                {diagnosticReport.filename}
                              </span>
                            </div>
                            <div className="p-3 bg-white dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800/60">
                              <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-bold">Dateigröße</span>
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                {formatFileSize(diagnosticReport.filesize)}
                              </span>
                            </div>
                            <div className="p-3 bg-white dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800/60">
                              <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-bold">Gefundene Tabellen</span>
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                {diagnosticReport.tables.length} Tabellen
                              </span>
                            </div>
                            <div className="p-3 bg-white dark:bg-slate-850 rounded-xl border border-slate-100 dark:border-slate-800/60">
                              <span className="text-[9px] text-slate-400 uppercase tracking-wider block font-bold">Zeitpunkt</span>
                              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                {new Date(diagnosticReport.timestamp).toLocaleTimeString('de-DE')} Uhr
                              </span>
                            </div>
                          </div>

                          {/* Key insights list */}
                          <div className="p-5 bg-white dark:bg-slate-850 border border-slate-100 dark:border-slate-800 rounded-2xl space-y-3">
                            <h5 className="text-xs font-black text-slate-850 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                              <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                              Wichtigste Erkenntnisse & Strukturprüfungen
                            </h5>
                            <div className="space-y-2 pt-1">
                              {diagnosticReport.insights.map((insight: string, idx: number) => {
                                const isWarning = insight.toLowerCase().includes('warnung:');
                                const isSuccess = insight.toLowerCase().includes('erkannt:') || insight.toLowerCase().includes('aktivitätstabelle \'');
                                return (
                                  <div 
                                    key={idx} 
                                    className={`p-2.5 rounded-xl border flex gap-2 text-[11px] leading-relaxed ${
                                      isWarning 
                                        ? 'bg-amber-50/40 dark:bg-amber-950/5 border-amber-200/50 dark:border-amber-900/30 text-amber-800 dark:text-amber-400' 
                                        : isSuccess 
                                        ? 'bg-emerald-50/40 dark:bg-emerald-950/5 border-emerald-200/50 dark:border-emerald-900/30 text-emerald-800 dark:text-emerald-400'
                                        : 'bg-slate-50/40 dark:bg-slate-900/10 border-slate-150 dark:border-slate-800/80 text-slate-600 dark:text-slate-400'
                                    }`}
                                  >
                                    {isWarning ? (
                                      <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-amber-500" />
                                    ) : isSuccess ? (
                                      <CheckCircle className="w-3.5 h-3.5 shrink-0 mt-0.5 text-emerald-500" />
                                    ) : (
                                      <Info className="w-3.5 h-3.5 shrink-0 mt-0.5 text-slate-400" />
                                    )}
                                    <span>{insight}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </div>

                          {/* Coordinate Ranges & Table counts side-by-side */}
                          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                            {/* Table row counts */}
                            <div className="bg-white dark:bg-slate-850 p-5 border border-slate-100 dark:border-slate-800 rounded-2xl space-y-3">
                              <h5 className="text-xs font-black text-slate-850 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                <Database className="w-3.5 h-3.5 text-slate-400" />
                                Gefundene Datenbank-Tabellen
                              </h5>
                              <div className="max-h-[180px] overflow-y-auto pr-1 border border-slate-100 dark:border-slate-800/60 rounded-xl">
                                <table className="w-full text-left border-collapse text-[11px]">
                                  <thead>
                                    <tr className="bg-slate-50 dark:bg-slate-900 text-slate-400 font-bold border-b border-slate-100 dark:border-slate-800">
                                      <th className="p-2">Tabellenname</th>
                                      <th className="p-2 text-right">Zeilenanzahl</th>
                                    </tr>
                                  </thead>
                                  <tbody>
                                    {diagnosticReport.tables.map((t: any) => {
                                      const isImportant = ["activity", "activities", "activity_ts_metric", "sleep", "weight", "steps", "stress", "rhr"].some(n => t.name.toLowerCase().includes(n));
                                      return (
                                        <tr 
                                          key={t.name} 
                                          className={`border-b border-slate-100 dark:border-slate-800/40 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 ${
                                            isImportant ? 'font-semibold text-slate-800 dark:text-slate-100' : 'text-slate-500'
                                          }`}
                                        >
                                          <td className="p-2 truncate max-w-[180px]" title={t.name}>{t.name}</td>
                                          <td className="p-2 text-right">
                                            {t.rows === -1 ? (
                                              <span className="text-red-500">Fehler</span>
                                            ) : (
                                              t.rows.toLocaleString('de-DE')
                                            )}
                                          </td>
                                        </tr>
                                      );
                                    })}
                                  </tbody>
                                </table>
                              </div>
                            </div>

                            {/* Coordinate format analysis */}
                            <div className="bg-white dark:bg-slate-850 p-5 border border-slate-100 dark:border-slate-800 rounded-2xl space-y-3 flex flex-col justify-between">
                              <div>
                                <h5 className="text-xs font-black text-slate-850 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                  <FileText className="w-3.5 h-3.5 text-slate-400" />
                                  GPS-Koordinaten Wertebereiche
                                </h5>
                                <p className="text-[10px] text-slate-400 mt-1 leading-normal">
                                  Prüft, ob Breitengrade in Grad (z.B. 48.13), Semicircles (z.B. 574293847) oder E7 vorliegen.
                                </p>
                              </div>

                              <div className="space-y-2 pt-1">
                                {Object.keys(diagnosticReport.coordinateAnalysis).length === 0 ? (
                                  <div className="p-4 bg-slate-50 dark:bg-slate-900/20 text-center text-[10px] text-slate-400 rounded-xl">
                                    Keine Koordinatendaten im Garmin-Zeitreihenformat gefunden.
                                  </div>
                                ) : (
                                  ['latitude', 'longitude', 'elevation'].map((k) => {
                                    const stats = diagnosticReport.coordinateAnalysis[k];
                                    if (!stats) return null;
                                    return (
                                      <div key={k} className="p-2.5 bg-slate-50/40 dark:bg-slate-900/10 border border-slate-150 dark:border-slate-800/80 rounded-xl text-[10px] flex justify-between items-center">
                                        <div>
                                          <span className="font-extrabold capitalize text-slate-700 dark:text-slate-300">
                                            {k === 'latitude' ? 'Breitengrad (Lat)' : k === 'longitude' ? 'Längengrad (Lng)' : 'Höhe (Ele)'}
                                          </span>
                                          <span className="text-[9px] text-slate-400 block mt-0.5">
                                            {stats.count.toLocaleString('de-DE')} Datenpunkte gefunden
                                          </span>
                                        </div>
                                        <div className="text-right font-mono text-[9px] text-slate-600 dark:text-slate-400">
                                          <div>Min: <span className="font-bold text-slate-800 dark:text-slate-200">{stats.min !== null ? stats.min : 'n/a'}</span></div>
                                          <div>Max: <span className="font-bold text-slate-800 dark:text-slate-200">{stats.max !== null ? stats.max : 'n/a'}</span></div>
                                        </div>
                                      </div>
                                    );
                                  })
                                )}
                              </div>
                            </div>
                          </div>

                          {/* Data Samples Inspector */}
                          {Object.keys(diagnosticReport.samples).length > 0 && (
                            <div className="bg-white dark:bg-slate-850 p-5 border border-slate-100 dark:border-slate-800 rounded-2xl space-y-4">
                              <h5 className="text-xs font-black text-slate-850 dark:text-slate-200 uppercase tracking-wider flex items-center gap-1.5">
                                <FileText className="w-3.5 h-3.5 text-slate-400" />
                                Rohdaten-Stichprobe (Erste Zeilen)
                              </h5>
                              
                              <div className="space-y-4">
                                {Object.keys(diagnosticReport.samples).map((tblName) => {
                                  const sampleRows = diagnosticReport.samples[tblName];
                                  if (!Array.isArray(sampleRows) || sampleRows.length === 0) return null;
                                  
                                  const keys = Object.keys(sampleRows[0]);
                                  
                                  return (
                                    <div key={tblName} className="space-y-2 border-t border-slate-100 dark:border-slate-800/80 pt-3 first:border-0 first:pt-0">
                                      <h6 className="text-[11px] font-extrabold text-orange-600 dark:text-orange-400 flex items-center gap-1">
                                        <Database className="w-3 h-3" />
                                        Tabelle: <span className="underline font-mono">{tblName}</span>
                                      </h6>
                                      
                                      <div className="overflow-x-auto border border-slate-100 dark:border-slate-800/60 rounded-xl">
                                        <table className="w-full text-left border-collapse text-[9px] font-mono whitespace-nowrap">
                                          <thead>
                                            <tr className="bg-slate-50 dark:bg-slate-900 text-slate-400 font-bold border-b border-slate-100 dark:border-slate-800">
                                              {keys.map(k => (
                                                <th key={k} className="p-1.5 border-r border-slate-100 dark:border-slate-800">{k}</th>
                                              ))}
                                            </tr>
                                          </thead>
                                          <tbody>
                                            {sampleRows.map((row: any, rIdx: number) => (
                                              <tr key={rIdx} className="border-b border-slate-100 dark:border-slate-800/40 hover:bg-slate-50/50 dark:hover:bg-slate-900/10">
                                                {keys.map(k => (
                                                  <td key={k} className="p-1.5 border-r border-slate-100 dark:border-slate-800 max-w-[200px] truncate" title={String(row[k])}>
                                                    {row[k] === null || row[k] === undefined ? (
                                                      <span className="text-slate-300 italic">NULL</span>
                                                    ) : typeof row[k] === 'object' ? (
                                                      JSON.stringify(row[k])
                                                    ) : (
                                                      String(row[k])
                                                    )}
                                                  </td>
                                                ))}
                                              </tr>
                                            ))}
                                          </tbody>
                                        </table>
                                      </div>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          )}
                        </div>
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          )}
          
          {/* Real-time Server Import & Diagnostic Terminal */}
          {renderDebugTerminal()}
        </div>
      </motion.div>
    </div>
  );
};
