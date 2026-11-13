import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Database, AlertCircle, CheckCircle, RefreshCw, Trash2, 
  Heart, Moon, Sparkles, Footprints, Flame, TrendingUp, Info,
  Zap, Key
} from 'lucide-react';
import { 
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, 
  Tooltip, CartesianGrid, AreaChart, Area, ScatterChart, Scatter, ZAxis, Legend 
} from 'recharts';
import { getApiUrl, apiFetch } from '../utils/api';
import { resolveGarminTrackForMap } from '../utils/garminClient';
import FitnessPerformanceAnalysis from './FitnessPerformanceAnalysis';
import { GarminPersonalApiPanel } from './GarminPersonalApiPanel';
import { GarminActivitiesAnalysis } from './GarminActivitiesAnalysis';

export type GarminDashboardTab =
  | 'overview'
  | 'performance'
  | 'calendar'
  | 'compare'
  | 'activities'
  | 'analytics'
  | 'sleep'
  | 'rhr'
  | 'steps'
  | 'stress'
  | 'personal-api';

interface GarminDashboardProps {
  onClose?: () => void;
  onLoadTrack?: (track: any) => void;
  onDataSynced?: () => void;
  onTabChange?: (tab: GarminDashboardTab) => void;
  initialTab?: GarminDashboardTab;
  variant?: 'modal' | 'page';
  userWeight?: number;
  userAge?: number;
  userMaxHr?: number;
  ftp?: number;
  onUpdateFtp?: (ftp: number) => void;
  onUpdateMaxHr?: (maxHr: number) => void;
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

// Robust helper to normalize activity type
function isRunningType(type: string | undefined, name?: string): boolean {
  if (!type && !name) return false;
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  return t.includes('run') || t.includes('laufen') || t.includes('jog') || t.includes('walk') || t.includes('hike') ||
         n.includes('run') || n.includes('laufen') || n.includes('jog') || n.includes('walk') || n.includes('hike') || n.includes('run');
}

function isCyclingType(type: string | undefined, name?: string): boolean {
  if (!type && !name) return false;
  const t = (type || '').toLowerCase();
  const n = (name || '').toLowerCase();
  return t.includes('cycle') || t.includes('bike') || t.includes('rad') || t.includes('road_biking') || t.includes('indoor_cycling') || t.includes('gravel_biking') || t.includes('mountain_biking') || t.includes('spin') ||
         n.includes('cycle') || n.includes('bike') || n.includes('rad') || n.includes('road_biking') || n.includes('indoor_cycling') || n.includes('gravel_biking') || n.includes('mountain_biking') || n.includes('spin') || n.includes('fahrrad') || n.includes('biking') || n.includes('cycling');
}

export const GarminDashboard: React.FC<GarminDashboardProps> = ({ 
  onClose, 
  onLoadTrack,
  onDataSynced,
  onTabChange,
  initialTab = 'overview',
  variant = 'modal',
  userWeight = 75,
  userAge = 35,
  userMaxHr = 185,
  ftp = 250,
  onUpdateFtp,
  onUpdateMaxHr
}) => {
  const [data, setData] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<React.ReactNode | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<GarminDashboardTab>(initialTab);
  const [activitySearchQuery, setActivitySearchQuery] = useState('');

  const handleSelectTab = (tab: GarminDashboardTab) => {
    setActiveTab(tab);
    onTabChange?.(tab);
  };
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);
  const [selectedCorrelation, setSelectedCorrelation] = useState<'hr_speed' | 'speed_ascent' | 'hr_ascent'>('hr_speed');

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

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

  const rhrData = useMemo(() => {
    if (!Array.isArray(data?.rhr)) return [];
    return data.rhr
      .map((d: any) => ({
        date: typeof d?.date === 'string' ? d.date : String(d?.date || ''),
        rhr: Number(d?.rhr)
      }))
      .filter((d) => Boolean(d.date) && Number.isFinite(d.rhr) && d.rhr > 0);
  }, [data?.rhr]);

  const stepsData = useMemo(() => {
    if (!Array.isArray(data?.steps)) return [];
    return data.steps
      .map((d: any) => {
        const steps = Number(d?.steps);
        const caloriesRaw = d?.calories !== undefined && d?.calories !== null ? Number(d.calories) : undefined;
        return {
          date: typeof d?.date === 'string' ? d.date : String(d?.date || ''),
          steps,
          calories: caloriesRaw !== undefined && Number.isFinite(caloriesRaw) && caloriesRaw >= 0 ? caloriesRaw : undefined
        };
      })
      .filter((d) => Boolean(d.date) && Number.isFinite(d.steps) && d.steps >= 0);
  }, [data?.steps]);

  const stressData = useMemo(() => {
    if (!Array.isArray(data?.stress)) return [];
    return data.stress
      .map((d: any) => ({
        date: typeof d?.date === 'string' ? d.date : String(d?.date || ''),
        avg_stress: Number(d?.avg_stress ?? d?.averageStressLevel ?? d?.stressLevel)
      }))
      .filter((d) => Boolean(d.date) && Number.isFinite(d.avg_stress) && d.avg_stress >= 0);
  }, [data?.stress]);

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

  const last4WeeksActivities = useMemo(() => {
    if (!data || !data.activities || data.activities.length === 0) return [];
    
    const sorted = [...data.activities].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
    const latestDate = new Date(sorted[0].date);
    const fourWeeksAgo = new Date(latestDate.getTime() - 28 * 24 * 60 * 60 * 1000);
    
    return data.activities
      .filter(act => {
        const actDate = new Date(act.date);
        return actDate >= fourWeeksAgo && actDate <= latestDate;
      })
      .map(act => {
        const speedKmh = act.duration > 0 ? (act.distance / (act.duration / 3600)) : 0;
        return {
          ...act,
          formattedDate: new Date(act.date).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }),
          avgSpeed: parseFloat(speedKmh.toFixed(1)),
          avgHr: act.avg_hr || 0
        };
      })
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }, [data]);

  // Fetch metrics from backend
  const fetchHealthMetrics = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await apiFetch(getApiUrl('/api/health-metrics'));
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

  // Fetch computed health analytics
  const fetchAnalytics = useCallback(async () => {
    setIsAnalyticsLoading(true);
    try {
      const res = await apiFetch(getApiUrl('/api/health-analytics'));
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

  // Load Garmin Activity into current workspace using unified hydration + optional auto-FIT fetch
  const handleLoadActivity = useCallback(async (act: GarminActivity) => {
    if (!onLoadTrack) return;
    try {
      let pointsJson = act.points_json;
      
      // Attempt to load the full, un-downsampled track from the server!
      try {
        const res = await apiFetch(getApiUrl(`/api/activity-track-full?id=${encodeURIComponent(act.id)}`));
        const json = await res.json();
        if (json.success && json.points_json) {
          pointsJson = json.points_json;
        }
      } catch (err) {
        console.error('Failed to fetch full track points, using fallback list track:', err);
      }

      const track = await resolveGarminTrackForMap(
        {
          ...act,
          points_json: pointsJson
        },
        { ftp, userWeight }
      );
      
      onLoadTrack(track);
      setSuccessMsg('Aktivität erfolgreich in den Workspace geladen!');
      setTimeout(() => setSuccessMsg(null), 3500);
    } catch (err) {
      console.error('Failed to load Garmin activity:', err);
      setError('Konnte Garmin-Aktivität nicht in Workspace laden.');
      setTimeout(() => setError(null), 4000);
    }
  }, [onLoadTrack, ftp, userWeight]);

  const handlePanelDataSynced = useCallback(() => {
    fetchHealthMetrics();
    onDataSynced?.();
  }, [fetchHealthMetrics, onDataSynced]);

  useEffect(() => {
    fetchHealthMetrics();
  }, [fetchHealthMetrics]);

  useEffect(() => {
    if (activeTab === 'analytics') {
      fetchAnalytics();
    }
  }, [activeTab, fetchAnalytics]);

  // Clear all data
  const handleClearData = async () => {
    if (!window.confirm('Möchtest du wirklich alle importierten Garmin-Gesundheitsdaten löschen?')) {
      return;
    }
    setIsLoading(true);
    try {
      const res = await apiFetch(getApiUrl('/api/health-metrics/clear'), { method: 'POST' });
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
  const avgRhr = rhrData.length > 0
    ? Math.round(rhrData.reduce((acc, r) => acc + r.rhr, 0) / rhrData.length)
    : null;
  const avgSteps = stepsData.length > 0
    ? Math.round(stepsData.reduce((acc, s) => acc + s.steps, 0) / stepsData.length)
    : null;
  const avgSleep = data?.sleep && data.sleep.length > 0
    ? Math.round(data.sleep.reduce((acc, s) => acc + s.duration, 0) / data.sleep.length)
    : null;



  useEffect(() => {
    setActiveTab(initialTab);
  }, [initialTab]);

  useEffect(() => {
    if (variant !== 'modal') return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = originalOverflow;
    };
  }, [onClose, variant]);

  const dashboardCard = (
      <motion.div 
        initial={variant === 'modal' ? { opacity: 0, scale: 0.95, y: 15 } : false}
        animate={variant === 'modal' ? { opacity: 1, scale: 1, y: 0 } : undefined}
        exit={variant === 'modal' ? { opacity: 0, scale: 0.95, y: 15 } : undefined}
        className={
          variant === 'page'
            ? 'flex-1 flex flex-col min-h-0 w-full bg-white dark:bg-slate-900 overflow-hidden cursor-default'
            : 'relative w-full max-w-6xl h-[calc(100dvh-1rem)] sm:h-[88vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col cursor-default'
        }
        onClick={variant === 'modal' ? (e) => e.stopPropagation() : undefined}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 sm:p-6 bg-slate-50 dark:bg-slate-850 border-b border-slate-100 dark:border-slate-800 shrink-0 gap-2">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0 flex-1">
            <div className="p-2 sm:p-2.5 bg-orange-100 dark:bg-orange-950/40 rounded-xl text-orange-600 dark:text-orange-400 shrink-0">
              <Database className="w-5 h-5 sm:w-6 sm:h-6" />
            </div>
            <div className="min-w-0 flex-1">
              <h2 className="text-sm sm:text-xl font-black text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-2 truncate">
                Garmin Fitness &amp; Gesundheit
                <span className="text-[10px] bg-emerald-100 dark:bg-emerald-950/50 text-emerald-700 dark:text-emerald-400 font-extrabold px-2 py-0.5 rounded-md uppercase tracking-wider hidden sm:inline-block">
                  Personal API
                </span>
              </h2>
              <p className="text-[10px] sm:text-xs text-slate-500 dark:text-slate-400 truncate hidden sm:block">
                Synchronisiere Aktivitäten (.FIT), GPS-Tracks &amp; Gesundheitsdaten direkt über die <b>Garmin Connect Personal API</b>.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => handleSelectTab(activeTab === 'personal-api' ? 'overview' : 'personal-api')}
              className={`px-3.5 py-2 rounded-xl text-xs font-extrabold flex items-center gap-1.5 transition-all cursor-pointer ${
                activeTab === 'personal-api'
                  ? 'bg-orange-600 text-white shadow-sm'
                  : 'bg-orange-100 hover:bg-orange-200 dark:bg-orange-950/50 dark:hover:bg-orange-900/60 text-orange-700 dark:text-orange-300 border border-orange-200 dark:border-orange-800/60'
              }`}
            >
              <Key className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{activeTab === 'personal-api' ? 'Zurück zur Übersicht' : 'Garmin Personal API'}</span>
              <span className="sm:hidden">API</span>
            </button>
            {variant === 'modal' && onClose && (
              <button 
                onClick={onClose}
                className="p-2 min-w-[44px] min-h-[44px] flex items-center justify-center hover:bg-slate-200 dark:hover:bg-slate-800 rounded-xl transition-all text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
                title="Schließen"
                aria-label="Schließen"
              >
                <X className="w-5 h-5" />
              </button>
            )}
          </div>
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

          {/* Personal API Sync Panel if no data imported yet */}
          {(!data || (data.sleep.length === 0 && data.stress.length === 0 && data.rhr.length === 0 && data.steps.length === 0 && data.activities.length === 0)) ? (
            <div className="space-y-5">
              <div className="p-5 rounded-3xl bg-gradient-to-r from-orange-50 to-amber-50 dark:from-orange-950/30 dark:to-slate-900 border border-orange-200 dark:border-orange-900/50 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
                <div className="space-y-1">
                  <h3 className="text-sm font-black text-slate-900 dark:text-slate-100 flex items-center gap-2">
                    <Key className="w-4 h-4 text-orange-600 dark:text-orange-400" />
                    Direkt-Synchronisation über Garmin Connect Personal API
                  </h3>
                  <p className="text-xs text-slate-700 dark:text-slate-300">
                    Verbinde deinen persönlichen Garmin API-Schlüssel, um Aktivitäten (inkl. .FIT GPS-Tracks) und Gesundheitsdaten direkt herunterzuladen.
                  </p>
                </div>
              </div>
              <GarminPersonalApiPanel
                onDataSynced={handlePanelDataSynced}
                onLoadTrack={onLoadTrack}
                onCloseModal={onClose}
              />
            </div>
          ) : (
            /* Main Dashboard View */
            <div className="space-y-6">
              {/* Bento-Grid Quick Stats (only shown on overview tab) */}
              {activeTab === 'overview' && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
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

                {/* RHR */}
                <div className="bg-rose-50/40 dark:bg-rose-950/10 p-5 rounded-2xl border border-rose-100/40 dark:border-rose-900/20 flex items-center gap-4">
                  <div className="p-3 bg-rose-100 dark:bg-rose-950/50 text-rose-600 dark:text-rose-400 rounded-xl">
                    <Heart className="w-5 h-5" />
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
              )}

              {/* Navigation Tabs */}
              <div className="flex gap-1 bg-slate-50 dark:bg-slate-850 p-1 rounded-2xl border border-slate-100 dark:border-slate-800 overflow-x-auto">
                {(['overview', 'personal-api', 'performance', 'calendar', 'compare', 'activities', 'analytics', 'sleep', 'rhr', 'steps', 'stress'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => handleSelectTab(tab)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer whitespace-nowrap flex items-center gap-1.5 ${
                      activeTab === tab
                        ? 'bg-orange-600 text-white shadow-md shadow-orange-100'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tab === 'overview' 
                      ? 'Übersicht' 
                      : tab === 'personal-api'
                      ? '🔑 Personal API & Cloud-Suche'
                      : tab === 'performance'
                      ? '⚡ Leistungs- & Fitness-Analyse'
                      : tab === 'calendar'
                      ? '📅 Kalender'
                      : tab === 'compare'
                      ? '⚖️ Einheiten-Vergleich'
                      : tab === 'activities' 
                      ? 'Aktivitäten' 
                      : tab === 'analytics' 
                      ? 'Trends & Korrelationen 📊' 
                      : tab === 'sleep'
                      ? 'Schlaf'
                      : tab === 'rhr'
                      ? 'Ruhepuls'
                      : tab === 'steps'
                      ? 'Schritte'
                      : tab === 'stress'
                      ? 'Stress'
                      : tab}
                  </button>
                ))}
              </div>

              {/* Dynamic Tab Panel */}
              <div className="bg-slate-50/40 dark:bg-slate-900/40 p-6 rounded-3xl border border-slate-100 dark:border-slate-800 min-h-[380px] flex flex-col">
                <AnimatePresence mode="wait">
                  {/* Tab: PERSONAL API */}
                  {activeTab === 'personal-api' && (
                    <motion.div
                      key="personal-api"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="w-full flex-1 flex flex-col"
                    >
                      <GarminPersonalApiPanel
                        onDataSynced={handlePanelDataSynced}
                        onLoadTrack={onLoadTrack}
                        onCloseModal={onClose}
                      />
                    </motion.div>
                  )}

                  {/* Tab: PERFORMANCE ANALYSIS */}
                  {activeTab === 'performance' && (
                    <motion.div
                      key="performance"
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="w-full flex-1 flex flex-col"
                    >
                      <FitnessPerformanceAnalysis 
                        isEmbedded={true}
                        onClose={onClose}
                        userWeight={userWeight}
                        userAge={userAge}
                        userMaxHr={userMaxHr}
                        ftp={ftp}
                        onUpdateFtp={onUpdateFtp}
                        onUpdateMaxHr={onUpdateMaxHr}
                      />
                    </motion.div>
                  )}

                  {/* Tab: CALENDAR & COMPARE (GarminActivitiesAnalysis embedded) */}
                  {(activeTab === 'calendar' || activeTab === 'compare') && (
                    <motion.div
                      key={activeTab}
                      initial={{ opacity: 0, y: 5 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -5 }}
                      className="w-full flex-1 flex flex-col"
                    >
                      <GarminActivitiesAnalysis
                        embedded
                        initialTab={activeTab === 'compare' ? 'compare' : 'calendar'}
                        onLoadTrack={onLoadTrack}
                      />
                    </motion.div>
                  )}

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
                          <div className="h-48 w-full min-w-0">
                            {rhrData.length === 0 ? (
                              <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                                <span>Keine Ruhepuls-Daten vorhanden.</span>
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('personal-api')}
                                  className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2"
                                >
                                  Über Garmin Personal API synchronisieren
                                </button>
                              </div>
                            ) : (
                              <ResponsiveContainer width="100%" height={192} minWidth={0}>
                                <LineChart data={rhrData.slice(-30)}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                                  <YAxis
                                    domain={[(min: number) => Math.max(25, Math.floor(min - 5)), (max: number) => Math.ceil(max + 5)]}
                                    stroke="#94a3b8"
                                    fontSize={9}
                                  />
                                  <Tooltip contentStyle={{ borderRadius: '12px' }} />
                                  <Line
                                    type="monotone"
                                    dataKey="rhr"
                                    name="Ruhepuls"
                                    stroke="#e11d48"
                                    strokeWidth={3}
                                    dot={rhrData.slice(-30).length <= 3 ? { r: 4, fill: '#e11d48' } : false}
                                  />
                                </LineChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                        </div>

                        {/* Schritte Verlauf */}
                        <div className="bg-white dark:bg-slate-850 p-5 rounded-2xl border border-slate-100 dark:border-slate-800/60 shadow-xs">
                          <h4 className="text-xs font-black text-slate-400 uppercase tracking-wider mb-4 flex items-center justify-between">
                            <span>Tägliche Schritte</span>
                            <Footprints className="w-3.5 h-3.5 text-emerald-500" />
                          </h4>
                          <div className="h-48 w-full min-w-0">
                            {stepsData.length === 0 ? (
                              <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                                <span>Keine Schrittdaten vorhanden.</span>
                                <button
                                  type="button"
                                  onClick={() => setActiveTab('personal-api')}
                                  className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2"
                                >
                                  Über Garmin Personal API synchronisieren
                                </button>
                              </div>
                            ) : (
                              <ResponsiveContainer width="100%" height={192} minWidth={0}>
                                <BarChart data={stepsData.slice(-15)}>
                                  <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                  <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                                  <YAxis stroke="#94a3b8" fontSize={9} />
                                  <Tooltip contentStyle={{ borderRadius: '12px' }} />
                                  <Bar dataKey="steps" name="Schritte" fill="#10b981" radius={[4, 4, 0, 0]} />
                                </BarChart>
                              </ResponsiveContainer>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Personal API sync & data reset footer */}
                      <div className="mt-6 pt-6 border-t border-slate-200 dark:border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
                        <div className="text-xs text-slate-400 dark:text-slate-500 flex items-center gap-1.5">
                          <Info className="w-4 h-4 text-slate-500 shrink-0" />
                          <span>Aktualisiere deine Aktivitäten und Gesundheitswerte jederzeit direkt über die Garmin Connect Personal API.</span>
                        </div>
                        <div className="flex gap-2">
                          <button
                            type="button"
                            onClick={() => handleSelectTab('personal-api')}
                            className="px-3.5 py-1.5 bg-orange-50 hover:bg-orange-100 dark:bg-orange-950/30 dark:hover:bg-orange-950/50 text-orange-700 dark:text-orange-300 border border-orange-200/70 dark:border-orange-800/60 rounded-xl text-xs font-bold cursor-pointer transition-all flex items-center gap-1.5"
                          >
                            <Key className="w-3.5 h-3.5" />
                            Über Personal API synchronisieren
                          </button>
                          <button
                            type="button"
                            onClick={handleClearData}
                            className="px-3.5 py-1.5 bg-red-50 hover:bg-red-100 dark:bg-red-950/20 text-red-600 dark:text-red-400 rounded-xl text-xs font-bold transition-all flex items-center gap-1 cursor-pointer"
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
                      <div className={`${variant === 'page' ? 'h-80 sm:h-96' : 'h-64'} w-full bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800`}>
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
                      <div className={`${variant === 'page' ? 'h-80 sm:h-96' : 'h-64'} w-full min-w-0 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800`}>
                        {rhrData.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                            <span>Keine Ruhepuls-Daten vorhanden.</span>
                            <button
                              type="button"
                              onClick={() => setActiveTab('personal-api')}
                              className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2"
                            >
                              Über Garmin Personal API synchronisieren
                            </button>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height={variant === 'page' ? 320 : 224} minWidth={0}>
                            <AreaChart data={rhrData}>
                              <defs>
                                <linearGradient id="colorRhr" x1="0" y1="0" x2="0" y2="1">
                                  <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.2}/>
                                  <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                                </linearGradient>
                              </defs>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                              <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                              <YAxis
                                domain={[(min: number) => Math.max(25, Math.floor(min - 5)), (max: number) => Math.ceil(max + 5)]}
                                stroke="#94a3b8"
                                fontSize={9}
                              />
                              <Tooltip contentStyle={{ borderRadius: '12px' }} />
                              <Area
                                type="monotone"
                                dataKey="rhr"
                                name="Ruhepuls"
                                stroke="#f43f5e"
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorRhr)"
                                dot={rhrData.length <= 3 ? { r: 4, fill: '#f43f5e' } : false}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
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
                      <div className={`${variant === 'page' ? 'h-80 sm:h-96' : 'h-64'} w-full min-w-0 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800`}>
                        {stepsData.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                            <span>Keine Schrittdaten vorhanden.</span>
                            <button
                              type="button"
                              onClick={() => setActiveTab('personal-api')}
                              className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2"
                            >
                              Über Garmin Personal API synchronisieren
                            </button>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height={variant === 'page' ? 320 : 224} minWidth={0}>
                            <BarChart data={stepsData.slice(-30)}>
                              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                              <XAxis dataKey="date" stroke="#94a3b8" fontSize={9} />
                              <YAxis yAxisId="left" stroke="#10b981" fontSize={9} />
                              {stepsData.slice(-30).some((d) => d.calories !== undefined && d.calories > 0) && (
                                <YAxis yAxisId="right" orientation="right" stroke="#ef4444" fontSize={9} unit=" kcal" />
                              )}
                              <Tooltip contentStyle={{ borderRadius: '12px' }} />
                              <Bar yAxisId="left" dataKey="steps" name="Schritte" fill="#10b981" radius={[3, 3, 0, 0]} />
                              {stepsData.slice(-30).some((d) => d.calories !== undefined && d.calories > 0) && (
                                <Bar yAxisId="right" dataKey="calories" name="Kalorien" fill="#ef4444" radius={[3, 3, 0, 0]} />
                              )}
                            </BarChart>
                          </ResponsiveContainer>
                        )}
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
                      <div className={`${variant === 'page' ? 'h-80 sm:h-96' : 'h-64'} w-full min-w-0 bg-white dark:bg-slate-850 p-4 rounded-2xl border border-slate-100 dark:border-slate-800`}>
                        {stressData.length === 0 ? (
                          <div className="h-full flex flex-col items-center justify-center text-center px-4 text-xs text-slate-400 gap-2">
                            <span>Keine Stress-Daten vorhanden.</span>
                            <button
                              type="button"
                              onClick={() => setActiveTab('personal-api')}
                              className="text-indigo-500 hover:text-indigo-600 font-semibold underline underline-offset-2"
                            >
                              Über Garmin Personal API synchronisieren
                            </button>
                          </div>
                        ) : (
                          <ResponsiveContainer width="100%" height={variant === 'page' ? 320 : 224} minWidth={0}>
                            <AreaChart data={stressData}>
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
                              <Area
                                type="monotone"
                                dataKey="avg_stress"
                                name="Ø Stress-Level"
                                stroke="#ef4444"
                                strokeWidth={3}
                                fillOpacity={1}
                                fill="url(#colorStress)"
                                dot={stressData.length <= 3 ? { r: 4, fill: '#ef4444' } : false}
                              />
                            </AreaChart>
                          </ResponsiveContainer>
                        )}
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
                          <p className="text-xs text-slate-500">Eine Übersicht über deine über die Garmin Personal API synchronisierten Aktivitäten.</p>
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

                      <div className={`${variant === 'page' ? 'max-h-[55vh]' : 'max-h-[300px]'} overflow-y-auto border border-slate-150 dark:border-slate-800 rounded-2xl`}>
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
                                        <span>{isRunningType(act.type, act.name) ? '🏃' : isCyclingType(act.type, act.name) ? '🚴' : '🏅'}</span>
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
                                        className="inline-flex items-center gap-1 px-2.5 py-1 bg-orange-600 hover:bg-orange-700 text-white font-bold rounded-md text-[10px] cursor-pointer shadow-xs transition-colors"
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
                            Bitte synchronisiere Garmin-Daten über die Personal API, die Schlaf-, Stress- und Aktivitätsdaten enthalten.
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-6">
                          {/* Top row: Sleep-Stress Pearson Correlation */}
                          <div className="grid grid-cols-1 gap-6">
                            
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
                                                    <span className="font-bold text-amber-400">+{Math.round(pt.ascent)} m</span>
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

                            {/* Row 6: 4-Week Training Performance Development Chart */}
                            <div className="bg-white dark:bg-slate-850 p-6 rounded-2xl border border-slate-100 dark:border-slate-800 shadow-xs space-y-6">
                              <div>
                                <h5 className="text-xs font-black text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
                                  <Sparkles className="w-3.5 h-3.5 text-orange-500" />
                                  Trainingsleistung Entwicklung (Letzte 4 Wochen)
                                </h5>
                                <p className="text-[10px] text-slate-400 mt-1">
                                  Verfolgt deine kardiovaskuläre Effizienz, indem Herzfrequenz- und Geschwindigkeitsentwicklungen über die letzten 4 Wochen basierend auf den importierten Track-Daten korreliert werden.
                                </p>
                              </div>

                              {last4WeeksActivities.length > 0 ? (
                                <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-stretch">
                                  {/* Chart Section */}
                                  <div className="lg:col-span-8 flex flex-col space-y-2">
                                    <div className="h-72 w-full bg-slate-50/40 dark:bg-slate-900/10 rounded-xl p-2 border border-slate-100 dark:border-slate-800/80">
                                      <ResponsiveContainer width="100%" height="100%">
                                        <LineChart data={last4WeeksActivities} margin={{ top: 20, right: 20, bottom: 20, left: 10 }}>
                                          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
                                          <XAxis 
                                            dataKey="formattedDate" 
                                            stroke="#94a3b8" 
                                            fontSize={9} 
                                          />
                                          <YAxis 
                                            yAxisId="left" 
                                            stroke="#ef4444" 
                                            fontSize={9} 
                                            domain={['dataMin - 5', 'dataMax + 5']} 
                                            label={{ value: 'Ø Puls (bpm)', angle: -90, position: 'insideLeft', style: {fontSize: 8, fill: '#ef4444'} }} 
                                          />
                                          <YAxis 
                                            yAxisId="right" 
                                            orientation="right" 
                                            stroke="#3b82f6" 
                                            fontSize={9} 
                                            domain={['dataMin - 2', 'dataMax + 2']} 
                                            label={{ value: 'Ø Tempo (km/h)', angle: 90, position: 'insideRight', style: {fontSize: 8, fill: '#3b82f6'} }} 
                                          />
                                          <Tooltip content={(props) => {
                                            if (props.active && props.payload && props.payload.length) {
                                              const pt = props.payload[0].payload;
                                              return (
                                                <div className="bg-slate-900/95 text-white p-3 rounded-xl border border-slate-800 shadow-xl text-[11px] space-y-1">
                                                  <p className="font-bold text-slate-100">{pt.name}</p>
                                                  <p className="text-[10px] text-slate-400">{pt.date}</p>
                                                  <div className="border-t border-slate-800 my-1 pt-1 space-y-0.5">
                                                    <div className="flex justify-between gap-4">
                                                      <span className="text-slate-400">Ø Puls:</span>
                                                      <span className="font-bold text-rose-400">{pt.avgHr > 0 ? `${pt.avgHr} bpm` : 'Keine Pulsdaten'}</span>
                                                    </div>
                                                    <div className="flex justify-between gap-4">
                                                      <span className="text-slate-400">Ø Tempo:</span>
                                                      <span className="font-bold text-blue-400">{pt.avgSpeed} km/h</span>
                                                    </div>
                                                    <div className="flex justify-between gap-4">
                                                      <span className="text-slate-400">Distanz:</span>
                                                      <span className="font-semibold text-slate-200">{pt.distance} km</span>
                                                    </div>
                                                  </div>
                                                </div>
                                              );
                                            }
                                            return null;
                                          }} />
                                          <Legend verticalAlign="top" height={36} wrapperStyle={{ fontSize: '10px' }} />
                                          <Line yAxisId="left" type="monotone" dataKey="avgHr" name="Herzfrequenz (bpm)" stroke="#ef4444" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
                                          <Line yAxisId="right" type="monotone" dataKey="avgSpeed" name="Tempo (km/h)" stroke="#3b82f6" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls />
                                        </LineChart>
                                      </ResponsiveContainer>
                                    </div>
                                  </div>

                                  {/* Physiology Explanation column */}
                                  <div className="lg:col-span-4 flex flex-col justify-between p-4 bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800 space-y-4">
                                    <div className="space-y-3">
                                      <h6 className="text-xs font-black text-slate-800 dark:text-slate-200 uppercase">
                                        Leistungsdiagnostik & Trend
                                      </h6>
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                                        Hier siehst du den direkten Verlauf deiner Trainingseinheiten der letzten 4 Wochen. 
                                      </p>
                                      <p className="text-[11px] text-slate-500 dark:text-slate-400 leading-relaxed font-medium">
                                        Ein positiver Trainingseffekt wird dadurch angezeigt, dass deine <span className="text-blue-600 dark:text-blue-400 font-bold">Geschwindigkeitskurve ansteigt</span>, während deine <span className="text-rose-600 dark:text-rose-400 font-bold">Herzfrequenzkurve sinkt oder stabil bleibt</span>. Das bedeutet, du läufst oder fährst schneller bei geringerer kardialer Belastung!
                                      </p>
                                    </div>

                                    <div className="text-[10px] text-orange-600 dark:text-orange-400 leading-relaxed bg-orange-50/20 dark:bg-orange-950/10 p-3 rounded-lg border border-orange-100/50 dark:border-orange-900/20">
                                      <p className="font-bold mb-1">📊 Auswertungsdaten:</p>
                                      Es wurden <span className="font-bold">{last4WeeksActivities.length} Aktivitäten</span> in den letzten 4 Wochen analysiert. Nutze den Track-Import oder Garmin-Connect, um weitere Läufe oder Fahrten hinzuzufügen.
                                    </div>
                                  </div>
                                </div>
                              ) : (
                                <div className="p-8 text-center bg-slate-50 dark:bg-slate-900/30 rounded-xl border border-slate-100 dark:border-slate-800">
                                  <AlertCircle className="w-8 h-8 text-slate-400 mx-auto mb-2" />
                                  <p className="text-xs text-slate-500 font-bold">Keine Aktivitäten in den letzten 4 Wochen gefunden</p>
                                  <p className="text-[10px] text-slate-400 mt-1 max-w-sm mx-auto">
                                    Es wurden keine Garmin-Aktivitäten mit einem Datum in den letzten 4 Wochen gefunden. Importiere Aktivitäten oder lade Garmin-Daten hoch, um diesen Verlauf zu aktivieren.
                                  </p>
                                </div>
                              )}
                            </div>
                          </div>
                        </div>
                      )}
                    </motion.div>
                  )}

                </AnimatePresence>
              </div>
            </div>
          )}
        </div>
      </motion.div>
  );

  if (variant === 'page') {
    return dashboardCard;
  }

  return (
    <div 
      className="fixed inset-0 z-[2000] flex items-center justify-center p-2 sm:p-4 pt-[max(0.5rem,env(safe-area-inset-top))] pb-[max(0.5rem,env(safe-area-inset-bottom))] bg-black/60 backdrop-blur-xs cursor-pointer" 
      onClick={onClose}
    >
      {dashboardCard}
    </div>
  );
};
