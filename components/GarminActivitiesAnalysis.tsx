import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Database, Search, AlertCircle, CheckCircle, RefreshCw, 
  Activity, Calendar, Clock, Flame, Heart, MapPin, BarChart2, 
  GitCompare, Plus, Check, Info, Filter, HelpCircle, ArrowUpRight, TrendingUp
} from 'lucide-react';
import { 
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, 
  Tooltip, CartesianGrid, AreaChart, Area, Legend, ScatterChart, Scatter
} from 'recharts';
import { getApiUrl } from '../utils/api';
import { parseLocationCoords, generateVirtualRoute } from '../utils/gpxUtils';
import { GarminActivitiesCalendar } from './GarminActivitiesCalendar';

interface GarminActivitiesAnalysisProps {
  onClose: () => void;
  onLoadTrack?: (track: any) => void;
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
  description?: string;
  location?: string;
  points_json?: string;
}

function isRunningType(type: string | undefined, name?: string): boolean {
  if (!type && !name) return false;
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  return t.includes('run') || t.includes('laufen') || t.includes('jog') || t.includes('walk') || t.includes('hike') ||
         n.includes('run') || n.includes('laufen') || n.includes('jog') || n.includes('walk') || n.includes('hike');
}

function isCyclingType(type: string | undefined, name?: string): boolean {
  if (!type && !name) return false;
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  return t.includes('cycle') || t.includes('bike') || t.includes('rad') || t.includes('road_biking') || t.includes('indoor_cycling') || t.includes('gravel_biking') || t.includes('mountain_biking') || t.includes('spin') ||
         n.includes('cycle') || n.includes('bike') || n.includes('rad') || n.includes('road_biking') || n.includes('indoor_cycling') || n.includes('gravel_biking') || n.includes('mountain_biking') || n.includes('spin') || n.includes('fahrrad') || n.includes('biking') || n.includes('cycling');
}

export const GarminActivitiesAnalysis: React.FC<GarminActivitiesAnalysisProps> = ({ onClose, onLoadTrack }) => {
  const [activities, setActivities] = useState<GarminActivity[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'compare' | 'calendar'>('calendar');

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'cycling' | 'running' | 'other'>('all');
  const [minDistance, setMinDistance] = useState<number | ''>('');
  const [maxDistance, setMaxDistance] = useState<number | ''>('');

  // Selected for comparison
  const [selectedToCompare, setSelectedToCompare] = useState<string[]>([]);

  // Fetch activities from API
  const fetchActivities = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(getApiUrl('/api/health-metrics'));
      const json = await res.json();
      if (json.success && json.data && json.data.activities) {
        setActivities(json.data.activities);
      } else if (!json.success) {
        setError(json.error || 'Fehler beim Laden der Garmin-Aktivitäten.');
      } else {
        setActivities([]);
      }
    } catch (err: any) {
      console.error(err);
      setError('Verbindung zum Server fehlgeschlagen. Bitte stelle sicher, dass der Server läuft.');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchActivities();
  }, [fetchActivities]);

  // Format Helpers
  const formatDuration = (seconds: number) => {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    if (hrs > 0) {
      return `${hrs} Std. ${mins} Min.`;
    }
    return `${mins} Min. ${secs} Sek.`;
  };

  const formatSpeed = (distanceKm: number, durationSec: number, type: string) => {
    if (durationSec <= 0) return '0';
    const hours = durationSec / 3600;
    const speedKmh = distanceKm / hours;
    if (isRunningType(type)) {
      // Pace: minutes per km
      const paceMinPerKm = (durationSec / 60) / distanceKm;
      const mins = Math.floor(paceMinPerKm);
      const secs = Math.round((paceMinPerKm - mins) * 60);
      return `${mins}:${secs.toString().padStart(2, '0')} min/km`;
    }
    return `${speedKmh.toFixed(1)} km/h`;
  };

  const getNumericSpeedKmh = (distanceKm: number, durationSec: number): number => {
    if (durationSec <= 0) return 0;
    return distanceKm / (durationSec / 3600);
  };

  const getPaceMinutes = (distanceKm: number, durationSec: number): number => {
    if (distanceKm <= 0) return 0;
    return (durationSec / 60) / distanceKm;
  };

  // Filter activities
  const filteredActivities = useMemo(() => {
    return activities.filter(act => {
      // Search
      const query = searchQuery.toLowerCase();
      const matchesSearch = 
        act.name?.toLowerCase().includes(query) || 
        act.type?.toLowerCase().includes(query) ||
        act.location?.toLowerCase().includes(query) ||
        act.date?.includes(query);

      // Type
      let matchesType = true;
      if (typeFilter === 'cycling') {
        matchesType = isCyclingType(act.type, act.name);
      } else if (typeFilter === 'running') {
        matchesType = isRunningType(act.type, act.name);
      } else if (typeFilter === 'other') {
        matchesType = !isCyclingType(act.type, act.name) && !isRunningType(act.type, act.name);
      }

      // Distance
      const matchesMinDist = minDistance === '' || act.distance >= minDistance;
      const matchesMaxDist = maxDistance === '' || act.distance <= maxDistance;

      return matchesSearch && matchesType && matchesMinDist && matchesMaxDist;
    });
  }, [activities, searchQuery, typeFilter, minDistance, maxDistance]);

  // Overall statistics of filtered activities
  const stats = useMemo(() => {
    const count = filteredActivities.length;
    if (count === 0) return { count: 0, distance: 0, duration: 0, calories: 0, ascent: 0, avgHr: 0 };

    let totalDist = 0;
    let totalDur = 0;
    let totalCal = 0;
    let totalAsc = 0;
    let hrSum = 0;
    let hrCount = 0;

    filteredActivities.forEach(act => {
      totalDist += act.distance;
      totalDur += act.duration;
      totalCal += act.calories || 0;
      totalAsc += act.ascent || 0;
      if (act.avg_hr) {
        hrSum += act.avg_hr;
        hrCount++;
      }
    });

    return {
      count,
      distance: totalDist,
      duration: totalDur,
      calories: totalCal,
      ascent: totalAsc,
      avgHr: hrCount > 0 ? Math.round(hrSum / hrCount) : 0
    };
  }, [filteredActivities]);

  // Toggle selection for comparison
  const toggleComparisonSelection = (id: string) => {
    setSelectedToCompare(prev => {
      if (prev.includes(id)) {
        return prev.filter(item => item !== id);
      } else {
        if (prev.length >= 5) {
          // Limit to 5 for layout readability
          return prev;
        }
        return [...prev, id];
      }
    });
  };

  // Get compared activities records
  const comparedActivities = useMemo(() => {
    return activities.filter(act => selectedToCompare.includes(act.id));
  }, [activities, selectedToCompare]);

  // Find "best" values in compared set to highlight them
  const comparisonHighlights = useMemo(() => {
    if (comparedActivities.length < 2) return null;

    let maxDistIdx = -1; let maxDist = -1;
    let minDurIdx = -1; let minDur = Infinity;
    let maxSpeedIdx = -1; let maxSpeed = -1;
    let maxAscIdx = -1; let maxAsc = -1;
    let minHrIdx = -1; let minHr = Infinity;
    let maxCalIdx = -1; let maxCal = -1;

    comparedActivities.forEach((act, idx) => {
      if (act.distance > maxDist) {
        maxDist = act.distance;
        maxDistIdx = idx;
      }
      if (act.duration < minDur) {
        minDur = act.duration;
        minDurIdx = idx;
      }
      const speed = getNumericSpeedKmh(act.distance, act.duration);
      if (speed > maxSpeed) {
        maxSpeed = speed;
        maxSpeedIdx = idx;
      }
      if ((act.ascent || 0) > maxAsc) {
        maxAsc = act.ascent || 0;
        maxAscIdx = idx;
      }
      if (act.avg_hr && act.avg_hr < minHr) {
        minHr = act.avg_hr;
        minHrIdx = idx;
      }
      if ((act.calories || 0) > maxCal) {
        maxCal = act.calories || 0;
        maxCalIdx = idx;
      }
    });

    return { maxDistIdx, minDurIdx, maxSpeedIdx, maxAscIdx, minHrIdx, maxCalIdx };
  }, [comparedActivities]);

  // Load Garmin Activity into main workspace map & charts
  const handleLoadActivity = useCallback(async (act: GarminActivity) => {
    if (!onLoadTrack) return;
    try {
      let pointsJson = act.points_json;
      setIsLoading(true);

      // Attempt to load the full path
      try {
        const res = await fetch(getApiUrl(`/api/activity-track-full?id=${act.id}`));
        const json = await res.json();
        if (json.success && json.points_json) {
          pointsJson = json.points_json;
        }
      } catch (err) {
        console.error('Failed to fetch full track points, using fallback:', err);
      }

      let startCoords = parseLocationCoords(act.location);
      if (!startCoords) {
        startCoords = { lat: 48.1351, lng: 11.5820 }; // Munich default fallback
      }

      const durationSec = act.duration || 3600;
      const distanceKm = act.distance || 10;
      const ascent = act.ascent || 0;
      const descent = act.descent || 0;
      const avgHr = act.avg_hr || undefined;
      const activityType = isRunningType(act.type, act.name) ? 'running' : 'cycling';

      let isVirtual = false;
      let points: any[] = [];

      if (pointsJson) {
        try {
          let parsed = JSON.parse(pointsJson);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const arrayKey = Object.keys(parsed).find(k => Array.isArray((parsed as any)[k]));
            if (arrayKey) parsed = (parsed as any)[arrayKey];
          }

          if (Array.isArray(parsed) && parsed.length > 0) {
            points = parsed.map((p: any) => {
              if (!p) return null;
              if (Array.isArray(p)) {
                return {
                  lat: parseFloat(p[0]),
                  lng: parseFloat(p[1]),
                  ele: p[2] !== undefined ? parseFloat(p[2]) : undefined,
                  time: p[3] ? new Date(p[3]) : undefined,
                  hr: p[4] !== undefined ? parseFloat(p[4]) : undefined,
                  cadence: p[5] !== undefined ? parseFloat(p[5]) : undefined,
                  power: p[6] !== undefined ? parseFloat(p[6]) : undefined,
                  speed: p[7] !== undefined ? parseFloat(p[7]) : undefined,
                };
              } else if (typeof p === 'object') {
                return {
                  lat: parseFloat(p.lat || p.latitude),
                  lng: parseFloat(p.lng || p.longitude),
                  ele: p.ele !== undefined ? parseFloat(p.ele) : undefined,
                  time: p.time ? new Date(p.time) : undefined,
                  hr: p.hr || p.heartrate || p.avg_hr,
                  cadence: p.cadence || p.cad,
                  power: p.power || p.watts,
                  speed: p.speed,
                };
              }
              return null;
            }).filter(Boolean);
          }
        } catch (pe) {
          console.error('Failed to parse points_json:', pe);
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
        id: `garmin-act-${act.id}`,
        name: act.name || 'Garmin Aktivität',
        points,
        color: '#f97316', // Orange Garmin-brand accent
        distance: distanceKm,
        ascent,
        descent,
        maxSlope: 0,
        visible: true,
        activityType,
        duration: durationSec,
        hasTimestamps: true,
        description: act.description || `Garmin-Aktivität in ${act.location || 'Unbekannt'}`,
        isVirtual
      };

      onLoadTrack(track);
      setSuccessMsg(`"${act.name}" erfolgreich in den Workspace geladen!`);
      setTimeout(() => setSuccessMsg(null), 3000);
    } catch (err) {
      console.error('Failed to load Garmin activity:', err);
      setError('Konnte Garmin-Aktivität nicht in Workspace laden.');
    } finally {
      setIsLoading(false);
    }
  }, [onLoadTrack]);

  // Timeline chart data sorted chronologically
  const timelineData = useMemo(() => {
    return [...filteredActivities]
      .filter(act => act.date)
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .map(act => {
        const speedKmh = getNumericSpeedKmh(act.distance, act.duration);
        const formattedDate = new Date(act.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: '2-digit' });
        return {
          id: act.id,
          name: act.name,
          dateStr: formattedDate,
          distance: parseFloat(act.distance.toFixed(1)),
          durationMin: parseFloat((act.duration / 60).toFixed(1)),
          speed: parseFloat(speedKmh.toFixed(1)),
          avgHr: act.avg_hr || 0,
          calories: act.calories || 0,
          ascent: act.ascent || 0,
          type: isRunningType(act.type, act.name) ? 'Laufen' : isCyclingType(act.type, act.name) ? 'Rad' : 'Andere'
        };
      });
  }, [filteredActivities]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-xs">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95, y: 15 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.95, y: 15 }}
        className="relative w-full max-w-6xl h-[90vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col font-sans"
      >
        {/* Header */}
        <header className="px-6 py-4 border-b border-slate-150 dark:border-slate-800/80 bg-slate-50 dark:bg-slate-900/50 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-orange-100 dark:bg-orange-950/40 text-orange-600 dark:text-orange-400 rounded-xl">
              <GitCompare className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-slate-850 dark:text-slate-100">
                Garmin Connect Aktivitäten-Analyse & Vergleich
              </h1>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Analysiere deine Läufe, Radtouren und Trainingsdaten aus der SQLite-Datenbank und vergleiche Einheiten direkt.
              </p>
            </div>
          </div>
          <button 
            onClick={onClose}
            className="p-2 bg-slate-150 dark:bg-slate-800 text-slate-600 dark:text-slate-350 hover:bg-slate-200 dark:hover:bg-slate-700 rounded-xl transition-all cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </header>

        {/* Info/Success/Error overlays */}
        <AnimatePresence>
          {successMsg && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-16 left-6 right-6 z-50 p-4 bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-900/40 text-emerald-800 dark:text-emerald-350 rounded-2xl flex items-center gap-2 text-sm font-semibold shadow-md"
            >
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
              <span>{successMsg}</span>
            </motion.div>
          )}

          {error && (
            <motion.div 
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="absolute top-16 left-6 right-6 z-50 p-4 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900/40 text-rose-800 dark:text-rose-350 rounded-2xl flex items-center gap-2 text-sm font-semibold shadow-md"
            >
              <AlertCircle className="w-4 h-4 text-rose-600 shrink-0" />
              <span>{error}</span>
            </motion.div>
          )}
        </AnimatePresence>

         {/* Tabs navigation */}
        <div className="px-6 py-2 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 flex justify-between items-center shrink-0">
          <div className="flex gap-2">
            <button
              onClick={() => setActiveTab('calendar')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'calendar'
                  ? 'bg-amber-500 text-white shadow-md shadow-amber-500/10'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-750'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <Calendar className="w-4 h-4" />
                <span>Kalender-Ansicht</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('overview')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer ${
                activeTab === 'overview'
                  ? 'bg-orange-500 text-white shadow-md shadow-orange-500/10'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-750'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <BarChart2 className="w-4 h-4" />
                <span>Analytische Trends</span>
              </div>
            </button>
            <button
              onClick={() => setActiveTab('compare')}
              className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer relative ${
                activeTab === 'compare'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-550/10'
                  : 'bg-slate-50 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-750'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <GitCompare className="w-4 h-4" />
                <span>Aktivitäten vergleichen</span>
                {selectedToCompare.length > 0 && (
                  <span className="bg-red-500 text-white text-[9px] font-extrabold w-4.5 h-4.5 rounded-full flex items-center justify-center animate-pulse">
                    {selectedToCompare.length}
                  </span>
                )}
              </div>
            </button>
          </div>

          <div className="text-[11px] font-mono text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
            <Database className="w-3.5 h-3.5" />
            <span>SQLite Datenbank: <strong>{activities.length}</strong> Aktivitäten</span>
          </div>
        </div>

        {/* Filter Toolbar (Visible in both tabs for better usability) */}
        <div className="px-6 py-3 bg-slate-50/50 dark:bg-slate-850/20 border-b border-slate-100 dark:border-slate-800 shrink-0">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3">
            {/* Search */}
            <div className="relative">
              <span className="absolute inset-y-0 left-0 flex items-center pl-3 text-slate-400 dark:text-slate-500">
                <Search className="w-4 h-4" />
              </span>
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Aktivität, Ort oder Datum..."
                className="w-full pl-9 pr-3 py-2 text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl focus:outline-none focus:ring-2 focus:ring-orange-500/25 text-slate-700 dark:text-slate-200"
              />
            </div>

            {/* Type */}
            <div className="flex items-center gap-1">
              <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap mr-1">Typ:</span>
              <div className="grid grid-cols-4 gap-1 w-full bg-slate-100 dark:bg-slate-850 p-1 rounded-xl">
                {(['all', 'cycling', 'running', 'other'] as const).map((t) => (
                  <button
                    key={t}
                    onClick={() => setTypeFilter(t)}
                    className={`py-1 text-[10px] font-black uppercase rounded-lg transition-all cursor-pointer text-center ${
                      typeFilter === t
                        ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-slate-50 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
                    }`}
                  >
                    {t === 'all' ? 'Alle' : t === 'cycling' ? 'Rad' : t === 'running' ? 'Lauf' : 'Andere'}
                  </button>
                ))}
              </div>
            </div>

            {/* Distance min/max */}
            <div className="flex items-center gap-1.5 md:col-span-2">
              <span className="text-[11px] font-bold text-slate-400 whitespace-nowrap">Distanz (km):</span>
              <div className="flex items-center gap-1 w-full">
                <input
                  type="number"
                  value={minDistance}
                  onChange={(e) => setMinDistance(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="Min"
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/25 text-slate-700 dark:text-slate-200"
                />
                <span className="text-slate-400 font-bold text-xs">-</span>
                <input
                  type="number"
                  value={maxDistance}
                  onChange={(e) => setMaxDistance(e.target.value === '' ? '' : parseFloat(e.target.value))}
                  placeholder="Max"
                  className="w-full px-2.5 py-1.5 text-xs font-mono bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-lg focus:outline-none focus:ring-2 focus:ring-orange-500/25 text-slate-700 dark:text-slate-200"
                />
                {(minDistance !== '' || maxDistance !== '' || searchQuery !== '' || typeFilter !== 'all') && (
                  <button
                    onClick={() => {
                      setSearchQuery('');
                      setTypeFilter('all');
                      setMinDistance('');
                      setMaxDistance('');
                    }}
                    className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-400 dark:text-slate-500 rounded-lg transition-colors cursor-pointer"
                    title="Filter zurücksetzen"
                  >
                    <X className="w-4 h-4" />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Content area */}
        <div className="flex-1 overflow-y-auto p-6 bg-slate-50 dark:bg-slate-900/40">
          {isLoading && activities.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center space-y-3">
              <RefreshCw className="w-8 h-8 text-orange-500 animate-spin" />
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 animate-pulse">Lade Garmin-Aktivitäten aus SQLite...</p>
            </div>
          ) : activeTab === 'calendar' ? (
            <GarminActivitiesCalendar 
              activities={filteredActivities} 
              onLoadActivity={handleLoadActivity} 
            />
          ) : filteredActivities.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center p-8 text-center space-y-4">
              <div className="p-4 bg-slate-100 dark:bg-slate-800 rounded-full text-slate-400 dark:text-slate-500">
                <Database className="w-10 h-10" />
              </div>
              <div className="max-w-md space-y-1.5">
                <h3 className="font-bold text-slate-850 dark:text-slate-200 text-base">Keine passenden Aktivitäten gefunden</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                  Überprüfe deine Filter oder lade im <strong>Garmin Fitness & Gesundheit</strong>-Modul (über die Seitenleiste) deine Garmin-SQLite-Datenbankdatei (.db) hoch, falls noch keine Daten vorhanden sind.
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-6">
              {/* Filtered statistics cards */}
              <div className="grid grid-cols-2 md:grid-cols-6 gap-3">
                <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 p-3.5 rounded-2xl flex flex-col items-center text-center justify-center shadow-xs">
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider mb-1">Aktivitäten</span>
                  <span className="text-xl font-black text-slate-800 dark:text-slate-100">{stats.count}</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 p-3.5 rounded-2xl flex flex-col items-center text-center justify-center shadow-xs">
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider mb-1">Strecke gesamt</span>
                  <span className="text-xl font-black text-slate-800 dark:text-slate-100">{Math.round(stats.distance).toLocaleString('de-DE')} km</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 p-3.5 rounded-2xl flex flex-col items-center text-center justify-center shadow-xs">
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider mb-1">Dauer gesamt</span>
                  <span className="text-xs font-black text-slate-800 dark:text-slate-100 max-w-full truncate">{Math.round(stats.duration / 3600)} Std.</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 p-3.5 rounded-2xl flex flex-col items-center text-center justify-center shadow-xs">
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider mb-1">Höhenmeter</span>
                  <span className="text-xl font-black text-emerald-600 dark:text-emerald-400">+{Math.round(stats.ascent).toLocaleString('de-DE')}m</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 p-3.5 rounded-2xl flex flex-col items-center text-center justify-center shadow-xs">
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider mb-1">Kalorien</span>
                  <span className="text-xl font-black text-orange-600 dark:text-orange-400">{Math.round(stats.calories).toLocaleString('de-DE')} kcal</span>
                </div>
                <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800/80 p-3.5 rounded-2xl flex flex-col items-center text-center justify-center shadow-xs">
                  <span className="text-[9px] text-slate-400 dark:text-slate-500 font-extrabold uppercase tracking-wider mb-1">Ø Herzfrequenz</span>
                  <span className="text-xl font-black text-rose-500">{stats.avgHr > 0 ? `${stats.avgHr} bpm` : '--'}</span>
                </div>
              </div>

              {/* TAB 1: Trend-Analyse */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  {/* Recharts trend graphs */}
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {/* Graph 1: Distance & Altitude over time */}
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-xs">
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-1.5">
                        <Activity className="w-4 h-4 text-orange-500" />
                        Aktivitäts-Distanz & Höhenmeter Verlauf
                      </h3>
                      <div className="h-64 font-mono text-[10px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <AreaChart data={timelineData}>
                            <defs>
                              <linearGradient id="colorDistance" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#f97316" stopOpacity={0.25}/>
                                <stop offset="95%" stopColor="#f97316" stopOpacity={0}/>
                              </linearGradient>
                              <linearGradient id="colorAscent" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                                <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" className="dark:stroke-slate-800" />
                            <XAxis dataKey="dateStr" stroke="#94a3b8" />
                            <YAxis yAxisId="left" stroke="#f97316" label={{ value: 'km', angle: -90, position: 'insideLeft', style: { fill: '#f97316', fontWeight: 'bold' } }} />
                            <YAxis yAxisId="right" orientation="right" stroke="#10b981" label={{ value: 'm', angle: 90, position: 'insideRight', style: { fill: '#10b981', fontWeight: 'bold' } }} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: '12px', color: '#fff' }}
                              labelFormatter={(lbl, items) => {
                                const payload = items[0]?.payload;
                                return payload ? `${payload.name} (${payload.dateStr})` : lbl;
                              }}
                            />
                            <Area yAxisId="left" type="monotone" dataKey="distance" name="Distanz" stroke="#f97316" strokeWidth={2.5} fillOpacity={1} fill="url(#colorDistance)" />
                            <Area yAxisId="right" type="monotone" dataKey="ascent" name="Höhenmeter" stroke="#10b981" strokeWidth={2.5} fillOpacity={1} fill="url(#colorAscent)" />
                            <Legend />
                          </AreaChart>
                        </ResponsiveContainer>
                      </div>
                    </div>

                    {/* Graph 2: Speed and Avg HR correlation over time */}
                    <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-xs">
                      <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-1.5">
                        <TrendingUp className="w-4 h-4 text-indigo-500" />
                        Geschwindigkeit & Ø Puls im Verlauf
                      </h3>
                      <div className="h-64 font-mono text-[10px]">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={timelineData}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" className="dark:stroke-slate-800" />
                            <XAxis dataKey="dateStr" stroke="#94a3b8" />
                            <YAxis yAxisId="left" stroke="#6366f1" label={{ value: 'km/h', angle: -90, position: 'insideLeft', style: { fill: '#6366f1', fontWeight: 'bold' } }} />
                            <YAxis yAxisId="right" orientation="right" stroke="#f43f5e" label={{ value: 'bpm', angle: 90, position: 'insideRight', style: { fill: '#f43f5e', fontWeight: 'bold' } }} />
                            <Tooltip 
                              contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: '12px', color: '#fff' }}
                              labelFormatter={(lbl, items) => {
                                const payload = items[0]?.payload;
                                return payload ? `${payload.name} (${payload.dateStr})` : lbl;
                              }}
                            />
                            <Line yAxisId="left" type="monotone" dataKey="speed" name="Geschwindigkeit" stroke="#6366f1" strokeWidth={3} activeDot={{ r: 6 }} />
                            <Line yAxisId="right" type="monotone" dataKey="avgHr" name="Herzfrequenz" stroke="#f43f5e" strokeWidth={3} activeDot={{ r: 6 }} />
                            <Legend />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    </div>
                  </div>

                  {/* Activities list/table for loading/comparing */}
                  <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-150 dark:border-slate-800/80 overflow-hidden shadow-xs">
                    <div className="p-5 border-b border-slate-150 dark:border-slate-800 flex justify-between items-center">
                      <div>
                        <h3 className="font-bold text-slate-800 dark:text-slate-100 text-sm">
                          Datenbank-Aktivitäten ({filteredActivities.length})
                        </h3>
                        <p className="text-[11px] text-slate-500">
                          Wähle Aktivitäten aus, um sie zu vergleichen, oder lade sie direkt auf die Karte.
                        </p>
                      </div>
                      <div className="flex gap-1.5">
                        {selectedToCompare.length > 0 && (
                          <button
                            onClick={() => setSelectedToCompare([])}
                            className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-rose-600 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/20 dark:hover:bg-rose-950/40 rounded-xl transition-all cursor-pointer"
                          >
                            Auswahl aufheben
                          </button>
                        )}
                        {selectedToCompare.length >= 2 && (
                          <button
                            onClick={() => setActiveTab('compare')}
                            className="px-4 py-1.5 text-[10px] font-black uppercase tracking-wider text-white bg-indigo-650 hover:bg-indigo-700 rounded-xl transition-all shadow-sm shadow-indigo-500/10 flex items-center gap-1 cursor-pointer"
                          >
                            <GitCompare className="w-3.5 h-3.5" />
                            Vergleichen ({selectedToCompare.length})
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-xs">
                        <thead className="bg-slate-50 dark:bg-slate-900/60 text-slate-400 font-extrabold uppercase tracking-wider border-b border-slate-150 dark:border-slate-800">
                          <tr>
                            <th className="p-4 w-12 text-center">Vergleich</th>
                            <th className="p-4">Aktivität</th>
                            <th className="p-4">Typ</th>
                            <th className="p-4">Datum</th>
                            <th className="p-4 text-right">Distanz</th>
                            <th className="p-4 text-right">Dauer</th>
                            <th className="p-4 text-right">Höhenmeter</th>
                            <th className="p-4 text-right">Ø Puls</th>
                            <th className="p-4 text-right">Tempo / Speed</th>
                            <th className="p-4 text-right">Aktionen</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-slate-700 dark:text-slate-300">
                          {filteredActivities.map((act) => {
                            const isSelected = selectedToCompare.includes(act.id);
                            const isRunning = isRunningType(act.type, act.name);
                            const isCycling = isCyclingType(act.type, act.name);
                            
                            return (
                              <tr 
                                key={act.id}
                                className={`hover:bg-slate-50/70 dark:hover:bg-slate-850/10 transition-colors ${
                                  isSelected ? 'bg-indigo-500/[0.04] dark:bg-indigo-500/[0.02]' : ''
                                }`}
                              >
                                <td className="p-4 text-center">
                                  <button
                                    type="button"
                                    onClick={() => toggleComparisonSelection(act.id)}
                                    className={`w-5 h-5 mx-auto rounded-md border flex items-center justify-center transition-all cursor-pointer ${
                                      isSelected
                                        ? 'bg-indigo-600 border-indigo-600 text-white shadow-sm'
                                        : 'bg-white dark:bg-slate-900 border-slate-300 dark:border-slate-700 text-transparent hover:border-slate-400'
                                    }`}
                                  >
                                    <Check className="w-3.5 h-3.5 stroke-[3]" />
                                  </button>
                                </td>
                                <td className="p-4 font-sans text-slate-850 dark:text-slate-150 font-bold max-w-xs truncate">
                                  <div className="flex flex-col">
                                    <span title={act.name} className="truncate">{act.name}</span>
                                    {act.location && (
                                      <span className="text-[10px] text-slate-400 font-medium flex items-center gap-0.5 mt-0.5">
                                        <MapPin className="w-3 h-3 text-slate-350" />
                                        {act.location}
                                      </span>
                                    )}
                                  </div>
                                </td>
                                <td className="p-4 font-sans font-semibold">
                                  {isRunning ? (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-emerald-50 dark:bg-emerald-950/30 text-emerald-600 dark:text-emerald-450 border border-emerald-200/40 dark:border-emerald-900/30">🏃 Lauf</span>
                                  ) : isCycling ? (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-blue-50 dark:bg-blue-950/30 text-blue-600 dark:text-blue-450 border border-blue-200/40 dark:border-blue-900/30">🚴 Rad</span>
                                  ) : (
                                    <span className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400">Other</span>
                                  )}
                                </td>
                                <td className="p-4 text-slate-500 text-xs">
                                  {act.date ? new Date(act.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' }) : '--'}
                                </td>
                                <td className="p-4 text-right font-bold text-slate-800 dark:text-slate-200">
                                  {act.distance.toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 })} km
                                </td>
                                <td className="p-4 text-right">
                                  {formatDuration(act.duration)}
                                </td>
                                <td className="p-4 text-right text-emerald-650 dark:text-emerald-400">
                                  {act.ascent ? `+${Math.round(act.ascent)}m` : '0m'}
                                </td>
                                <td className="p-4 text-right text-rose-500 font-bold">
                                  {act.avg_hr ? `${Math.round(act.avg_hr)} bpm` : '--'}
                                </td>
                                <td className="p-4 text-right font-bold text-slate-800 dark:text-slate-200">
                                  {formatSpeed(act.distance, act.duration, act.type)}
                                </td>
                                <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                                  <button
                                    onClick={() => handleLoadActivity(act)}
                                    className="px-2.5 py-1 bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/30 dark:hover:bg-orange-950/50 text-orange-700 dark:text-orange-400 text-[10px] font-black uppercase rounded-lg border border-orange-200/30 dark:border-orange-900/20 transition-all flex items-center gap-1 ml-auto cursor-pointer"
                                    title="Aktivität in den Karten-Workspace laden"
                                  >
                                    <ArrowUpRight className="w-3 h-3" />
                                    Workspace
                                  </button>
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: Aktivitäten-Vergleich */}
              {activeTab === 'compare' && (
                <div className="space-y-6">
                  {comparedActivities.length < 2 ? (
                    <div className="bg-white dark:bg-slate-900 border border-slate-150 dark:border-slate-800 p-8 rounded-3xl text-center flex flex-col items-center justify-center space-y-4">
                      <div className="p-4 bg-indigo-50 dark:bg-indigo-950/40 text-indigo-600 dark:text-indigo-400 rounded-full">
                        <GitCompare className="w-8 h-8 animate-pulse" />
                      </div>
                      <div className="max-w-md space-y-1.5">
                        <h4 className="font-bold text-slate-800 dark:text-slate-200">Vergleich erfordert mindestens 2 Aktivitäten</h4>
                        <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                          Wähle im Tab <strong>'Analytische Trends'</strong> (oder über die Checkboxen in der obigen Filtertabelle) mindestens 2 Aktivitäten aus (maximal 5), um eine detaillierte Gegenüberstellung zu aktivieren.
                        </p>
                      </div>
                      <button
                        onClick={() => setActiveTab('overview')}
                        className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-black uppercase tracking-wider transition-all cursor-pointer"
                      >
                        Aktivitäten auswählen
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-6">
                      {/* Compare Stats Comparison Bar Chart */}
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                        {/* Bar Chart 1: Distance Comparison */}
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-xs">
                          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-1.5">
                            <Activity className="w-4 h-4 text-orange-500" />
                            Gegenüberstellung: Distanz & Höhenmeter
                          </h3>
                          <div className="h-64 font-mono text-[10px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={comparedActivities.map(act => ({
                                name: act.name.length > 15 ? act.name.substring(0, 15) + '...' : act.name,
                                'Distanz (km)': parseFloat(act.distance.toFixed(1)),
                                'Höhenmeter (m)': act.ascent || 0
                              }))}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" className="dark:stroke-slate-800" vertical={false} />
                                <XAxis dataKey="name" stroke="#94a3b8" />
                                <YAxis yAxisId="left" stroke="#f97316" label={{ value: 'km', angle: -90, position: 'insideLeft', style: { fill: '#f97316', fontWeight: 'bold' } }} />
                                <YAxis yAxisId="right" orientation="right" stroke="#10b981" label={{ value: 'm', angle: 90, position: 'insideRight', style: { fill: '#10b981', fontWeight: 'bold' } }} />
                                <Tooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: '12px', color: '#fff' }} />
                                <Bar yAxisId="left" dataKey="Distanz (km)" fill="#f97316" radius={[4, 4, 0, 0]} maxBarSize={45} />
                                <Bar yAxisId="right" dataKey="Höhenmeter (m)" fill="#10b981" radius={[4, 4, 0, 0]} maxBarSize={45} />
                                <Legend />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>

                        {/* Bar Chart 2: Speed and Calories Comparison */}
                        <div className="bg-white dark:bg-slate-900 p-5 rounded-3xl border border-slate-150 dark:border-slate-800/80 shadow-xs">
                          <h3 className="text-xs font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-4 flex items-center gap-1.5">
                            <Flame className="w-4 h-4 text-rose-500" />
                            Ø Puls & Geschwindigkeit im Vergleich
                          </h3>
                          <div className="h-64 font-mono text-[10px]">
                            <ResponsiveContainer width="100%" height="100%">
                              <BarChart data={comparedActivities.map(act => {
                                const speedKmh = getNumericSpeedKmh(act.distance, act.duration);
                                return {
                                  name: act.name.length > 15 ? act.name.substring(0, 15) + '...' : act.name,
                                  'Ø Puls (bpm)': act.avg_hr || 0,
                                  'Ø Speed (km/h)': parseFloat(speedKmh.toFixed(1))
                                };
                              })}>
                                <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" className="dark:stroke-slate-800" vertical={false} />
                                <XAxis dataKey="name" stroke="#94a3b8" />
                                <YAxis yAxisId="left" stroke="#f43f5e" label={{ value: 'bpm', angle: -90, position: 'insideLeft', style: { fill: '#f43f5e', fontWeight: 'bold' } }} />
                                <YAxis yAxisId="right" orientation="right" stroke="#6366f1" label={{ value: 'km/h', angle: 90, position: 'insideRight', style: { fill: '#6366f1', fontWeight: 'bold' } }} />
                                <Tooltip contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.95)', border: 'none', borderRadius: '12px', color: '#fff' }} />
                                <Bar yAxisId="left" dataKey="Ø Puls (bpm)" fill="#f43f5e" radius={[4, 4, 0, 0]} maxBarSize={45} />
                                <Bar yAxisId="right" dataKey="Ø Speed (km/h)" fill="#6366f1" radius={[4, 4, 0, 0]} maxBarSize={45} />
                                <Legend />
                              </BarChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                      </div>

                      {/* Side-by-side table */}
                      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-150 dark:border-slate-800 overflow-hidden shadow-sm">
                        <div className="p-5 border-b border-slate-150 dark:border-slate-800 flex justify-between items-center">
                          <div>
                            <h3 className="font-bold text-slate-850 dark:text-slate-100 text-sm">Vergleichsmatrix</h3>
                            <p className="text-[11px] text-slate-500">
                              Direkter Kennzahlen-Vergleich. Grüne Hervorhebungen zeigen Bestwerte an.
                            </p>
                          </div>
                          <span className="text-[10px] font-mono bg-indigo-50 dark:bg-indigo-950/30 border border-indigo-200/50 dark:border-indigo-900/30 text-indigo-750 dark:text-indigo-400 px-3 py-1 rounded-lg">
                            {comparedActivities.length} Aktivitäten ausgewählt
                          </span>
                        </div>

                        <div className="overflow-x-auto">
                          <table className="w-full text-left text-xs border-collapse">
                            <thead>
                              <tr className="bg-slate-50 dark:bg-slate-900/60 text-slate-400 font-extrabold uppercase tracking-wider border-b border-slate-150 dark:border-slate-800">
                                <th className="p-4 w-44">Parameter</th>
                                {comparedActivities.map(act => (
                                  <th key={act.id} className="p-4 border-l border-slate-100 dark:border-slate-800/80 min-w-[150px]">
                                    <div className="flex flex-col">
                                      <span className="text-slate-850 dark:text-slate-150 font-black truncate max-w-[200px]" title={act.name}>
                                        {act.name}
                                      </span>
                                      <span className="text-[10px] font-medium text-slate-400 mt-0.5">
                                        {act.date ? new Date(act.date).toLocaleDateString('de-DE') : ''}
                                      </span>
                                    </div>
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 font-mono text-slate-700 dark:text-slate-300">
                              {/* 1. TYP */}
                              <tr>
                                <td className="p-4 font-sans font-bold bg-slate-50/20 dark:bg-slate-900/10">Aktivitätstyp</td>
                                {comparedActivities.map(act => {
                                  const isRunning = isRunningType(act.type, act.name);
                                  const isCycling = isCyclingType(act.type, act.name);
                                  return (
                                    <td key={act.id} className="p-4 border-l border-slate-100 dark:border-slate-800/60 font-sans font-bold">
                                      {isRunning ? '🏃 Laufen' : isCycling ? '🚴 Radsport' : 'Other'}
                                    </td>
                                  );
                                })}
                              </tr>

                              {/* 2. DISTANCE */}
                              <tr>
                                <td className="p-4 font-sans font-bold bg-slate-50/20 dark:bg-slate-900/10">Distanz</td>
                                {comparedActivities.map((act, idx) => {
                                  const isBest = comparisonHighlights?.maxDistIdx === idx;
                                  return (
                                    <td 
                                      key={act.id} 
                                      className={`p-4 border-l border-slate-100 dark:border-slate-800/60 font-bold ${
                                        isBest ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'
                                      }`}
                                    >
                                      {act.distance.toLocaleString('de-DE', { minimumFractionDigits: 1 })} km
                                      {isBest && <span className="text-[8px] uppercase tracking-wider font-extrabold ml-1.5 px-1 py-0.5 bg-emerald-500/20 rounded">Maximum</span>}
                                    </td>
                                  );
                                })}
                              </tr>

                              {/* 3. DURATION */}
                              <tr>
                                <td className="p-4 font-sans font-bold bg-slate-50/20 dark:bg-slate-900/10">Dauer (Dauer)</td>
                                {comparedActivities.map((act, idx) => {
                                  const isBest = comparisonHighlights?.minDurIdx === idx;
                                  return (
                                    <td 
                                      key={act.id} 
                                      className={`p-4 border-l border-slate-100 dark:border-slate-800/60 ${
                                        isBest ? 'bg-emerald-500/[0.04] text-slate-800 dark:text-slate-200' : ''
                                      }`}
                                    >
                                      {formatDuration(act.duration)}
                                      {isBest && <span className="text-[8px] uppercase tracking-wider font-extrabold ml-1.5 px-1 py-0.5 bg-emerald-500/20 rounded text-emerald-750 dark:text-emerald-450">Kürzeste</span>}
                                    </td>
                                  );
                                })}
                              </tr>

                              {/* 4. SPEED */}
                              <tr>
                                <td className="p-4 font-sans font-bold bg-slate-50/20 dark:bg-slate-900/10">Geschwindigkeit / Pace</td>
                                {comparedActivities.map((act, idx) => {
                                  const isBest = comparisonHighlights?.maxSpeedIdx === idx;
                                  return (
                                    <td 
                                      key={act.id} 
                                      className={`p-4 border-l border-slate-100 dark:border-slate-800/60 font-bold ${
                                        isBest ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400' : 'text-slate-800 dark:text-slate-200'
                                      }`}
                                    >
                                      {formatSpeed(act.distance, act.duration, act.type)}
                                      {isBest && <span className="text-[8px] uppercase tracking-wider font-extrabold ml-1.5 px-1 py-0.5 bg-emerald-500/20 rounded">Schnellste</span>}
                                    </td>
                                  );
                                })}
                              </tr>

                              {/* 5. ASCENT */}
                              <tr>
                                <td className="p-4 font-sans font-bold bg-slate-50/20 dark:bg-slate-900/10">Höhenmeter</td>
                                {comparedActivities.map((act, idx) => {
                                  const isBest = comparisonHighlights?.maxAscIdx === idx && (act.ascent || 0) > 0;
                                  return (
                                    <td 
                                      key={act.id} 
                                      className={`p-4 border-l border-slate-100 dark:border-slate-800/60 ${
                                        isBest ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-bold' : ''
                                      }`}
                                    >
                                      +{Math.round(act.ascent || 0)}m
                                      {isBest && <span className="text-[8px] uppercase tracking-wider font-extrabold ml-1.5 px-1 py-0.5 bg-emerald-500/20 rounded">Meiste</span>}
                                    </td>
                                  );
                                })}
                              </tr>

                              {/* 6. HEART RATE */}
                              <tr>
                                <td className="p-4 font-sans font-bold bg-slate-50/20 dark:bg-slate-900/10">Ø Herzfrequenz</td>
                                {comparedActivities.map((act, idx) => {
                                  const isBest = comparisonHighlights?.minHrIdx === idx && act.avg_hr;
                                  return (
                                    <td 
                                      key={act.id} 
                                      className={`p-4 border-l border-slate-100 dark:border-slate-800/60 ${
                                        isBest ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-bold' : ''
                                      }`}
                                    >
                                      {act.avg_hr ? `${Math.round(act.avg_hr)} bpm` : '--'}
                                      {isBest && <span className="text-[8px] uppercase tracking-wider font-extrabold ml-1.5 px-1 py-0.5 bg-emerald-500/20 rounded">Niedrigste</span>}
                                    </td>
                                  );
                                })}
                              </tr>

                              {/* 7. EFFICIENCY INDEX */}
                              <tr>
                                <td className="p-4 font-sans font-bold bg-slate-50/20 dark:bg-slate-900/10" title="Verhältnis von Geschwindigkeit (km/h) zu Herzfrequenz (bpm). Je höher, desto effizienter arbeitet dein Herz-Kreislauf-System bei diesem Lauf.">
                                  Effizienz-Index
                                  <span className="ml-1 cursor-help text-[10px] text-slate-400">ℹ️</span>
                                </td>
                                {comparedActivities.map(act => {
                                  const speed = getNumericSpeedKmh(act.distance, act.duration);
                                  const hr = act.avg_hr || 0;
                                  const efficiency = hr > 0 ? (speed / hr) * 100 : 0;
                                  return (
                                    <td key={act.id} className="p-4 border-l border-slate-100 dark:border-slate-800/60">
                                      {efficiency > 0 ? `${efficiency.toFixed(1)} Pts` : '--'}
                                    </td>
                                  );
                                })}
                              </tr>

                              {/* 8. CALORIES */}
                              <tr>
                                <td className="p-4 font-sans font-bold bg-slate-50/20 dark:bg-slate-900/10">Kalorienverbrauch</td>
                                {comparedActivities.map((act, idx) => {
                                  const isBest = comparisonHighlights?.maxCalIdx === idx && (act.calories || 0) > 0;
                                  return (
                                    <td 
                                      key={act.id} 
                                      className={`p-4 border-l border-slate-100 dark:border-slate-800/60 ${
                                        isBest ? 'bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 font-bold' : ''
                                      }`}
                                    >
                                      {act.calories ? `${Math.round(act.calories).toLocaleString('de-DE')} kcal` : '--'}
                                      {isBest && <span className="text-[8px] uppercase tracking-wider font-extrabold ml-1.5 px-1 py-0.5 bg-emerald-500/20 rounded">Höchster</span>}
                                    </td>
                                  );
                                })}
                              </tr>

                              {/* ACTIONS ROW */}
                              <tr>
                                <td className="p-4 font-sans font-bold bg-slate-50/20 dark:bg-slate-900/10">Aktionen</td>
                                {comparedActivities.map(act => (
                                  <td key={act.id} className="p-4 border-l border-slate-100 dark:border-slate-800/60" onClick={(e) => e.stopPropagation()}>
                                    <div className="flex flex-col gap-1.5">
                                      <button
                                        onClick={() => handleLoadActivity(act)}
                                        className="w-full py-1.5 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/20 dark:hover:bg-orange-950/40 text-orange-600 dark:text-orange-400 text-[10px] font-black uppercase rounded-lg border border-orange-200/30 dark:border-orange-900/20 transition-all flex items-center justify-center gap-1 cursor-pointer"
                                      >
                                        <ArrowUpRight className="w-3.5 h-3.5" />
                                        In Workspace laden
                                      </button>
                                      <button
                                        onClick={() => toggleComparisonSelection(act.id)}
                                        className="w-full py-1.5 text-slate-500 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/20 dark:text-slate-400 text-[10px] font-bold uppercase rounded-lg transition-all cursor-pointer"
                                      >
                                        Aus Vergleich entfernen
                                      </button>
                                    </div>
                                  </td>
                                ))}
                              </tr>
                            </tbody>
                          </table>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
};
