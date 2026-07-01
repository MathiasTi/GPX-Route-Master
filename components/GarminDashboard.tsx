import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  X, Database, Upload, AlertCircle, CheckCircle, RefreshCw, Trash2, 
  Heart, Moon, Sparkles, Footprints, Flame, Scale, TrendingUp, Info 
} from 'lucide-react';
import { 
  ResponsiveContainer, LineChart, Line, BarChart, Bar, XAxis, YAxis, 
  Tooltip, CartesianGrid, AreaChart, Area 
} from 'recharts';
import { getApiUrl } from '../utils/api';

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
}

interface HealthData {
  sleep: SleepRecord[];
  weight: WeightRecord[];
  stress: StressRecord[];
  rhr: RhrRecord[];
  steps: StepsRecord[];
  activities: GarminActivity[];
}

export const GarminDashboard: React.FC<GarminDashboardProps> = ({ onClose, onLoadTrack }) => {
  const [data, setData] = useState<HealthData | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'overview' | 'sleep' | 'weight' | 'rhr' | 'steps' | 'stress' | 'activities' | 'analytics'>('overview');
  const [isDragging, setIsDragging] = useState(false);
  const [dbUploadProgress, setDbUploadProgress] = useState<{ percentage: number; statusText: string } | null>(null);
  const [activitySearchQuery, setActivitySearchQuery] = useState('');
  const [localFiles, setLocalFiles] = useState<{ filename: string; path: string; size: number; mtime: string }[]>([]);
  const [analyticsData, setAnalyticsData] = useState<any>(null);
  const [isAnalyticsLoading, setIsAnalyticsLoading] = useState(false);

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
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);
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
      } else {
        setError(result.error || 'Fehler beim Analysieren der SQLite-Datenbank.');
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
      } else {
        setError(json.error || 'Fehler beim Importieren der lokalen Datenbank.');
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
                          <button
                            onClick={() => handleLocalDbImport(f.path)}
                            disabled={isLoading}
                            className="shrink-0 px-3.5 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg text-xs font-bold cursor-pointer transition-all disabled:opacity-50"
                          >
                            Importieren
                          </button>
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
                {(['overview', 'sleep', 'weight', 'rhr', 'steps', 'stress', 'activities', 'analytics'] as const).map((tab) => (
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
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 text-slate-700 dark:text-slate-300">
                              {filteredActivities.map((act) => (
                                <tr key={act.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-850/40">
                                  <td className="p-3 font-semibold text-slate-800 dark:text-slate-200">
                                    <div className="flex items-center gap-1.5">
                                      <span>{act.type === 'running' ? '🏃' : '🚴'}</span>
                                      <span>{act.name}</span>
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
    </div>
  );
};
