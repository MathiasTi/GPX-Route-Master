import React, { useState, useEffect, useCallback } from 'react';
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
  const [activeTab, setActiveTab] = useState<'overview' | 'sleep' | 'weight' | 'rhr' | 'steps' | 'stress' | 'activities'>('overview');
  const [isDragging, setIsDragging] = useState(false);

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

  useEffect(() => {
    fetchHealthMetrics();
  }, [fetchHealthMetrics]);

  // Handle SQLite File Import
  const handleFileUpload = async (file: File) => {
    setIsLoading(true);
    setError(null);
    setSuccessMsg(null);
    try {
      const reader = new FileReader();
      
      const arrayBuffer = await new Promise<ArrayBuffer>((resolve, reject) => {
        reader.onload = () => resolve(reader.result as ArrayBuffer);
        reader.onerror = () => reject(reader.error);
        reader.readAsArrayBuffer(file);
      });

      const response = await fetch(getApiUrl('/api/import-sqlite'), {
        method: 'POST',
        headers: {
          'Content-Type': 'application/octet-stream'
        },
        body: arrayBuffer
      });

      const result = await response.json();
      if (result.success) {
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
      setError('Fehler beim Hochladen der Datei.');
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
        className="w-full max-w-6xl h-[88vh] bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-100 dark:border-slate-800 overflow-hidden flex flex-col"
      >
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
              <div className="lg:col-span-7 flex flex-col">
                <div 
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  onDrop={handleDrop}
                  className={`flex-1 min-h-[300px] border-2 border-dashed rounded-3xl flex flex-col items-center justify-center p-8 text-center transition-all ${
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
                    Unterstützt Dateien wie <code className="bg-slate-100 dark:bg-slate-800 px-1 py-0.5 rounded">garmin.db</code>, die von <b>garmin-health-data</b> oder Export-Skripten erstellt wurden.
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

              {/* Documentation */}
              <div className="lg:col-span-5 bg-slate-50 dark:bg-slate-850 rounded-3xl p-6 border border-slate-100 dark:border-slate-800/60 flex flex-col justify-between">
                <div>
                  <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5 mb-3">
                    <Info className="w-4 h-4 text-slate-500" />
                    Wie erhalte ich diese Datenbank?
                  </h4>
                  <div className="space-y-4 text-xs text-slate-600 dark:text-slate-400">
                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-300 mb-1">
                        1. Über garmin-health-data (empfohlen):
                      </p>
                      <p className="mb-1 leading-relaxed">
                        Das Tool synchronisiert deine Garmin Connect Daten direkt in eine lokale SQLite-Datenbank:
                      </p>
                      <pre className="p-2 bg-slate-100 dark:bg-slate-800 rounded-lg text-[10px] font-mono overflow-x-auto text-slate-700 dark:text-slate-300">
                        pip install garmin-health-data{"\n"}
                        garmin-health-data --backup-dir ./garmin_backup
                      </pre>
                      <p className="mt-1">
                        Das Tool erstellt die Datei <code className="bg-slate-100 dark:bg-slate-800 px-1 rounded">garmin.db</code> im Backup-Verzeichnis.
                      </p>
                    </div>

                    <div>
                      <p className="font-semibold text-slate-800 dark:text-slate-300 mb-1">
                        2. Über python-garminconnect Integration:
                      </p>
                      <p className="leading-relaxed">
                        Die extrahierten Daten zu Gewicht, Schritten, Stress, Puls und Schlafdauer werden nahtlos und vollautomatisch über unseren intelligenten Schema-Mapper analysiert!
                      </p>
                    </div>
                  </div>
                </div>

                <div className="mt-4 pt-4 border-t border-slate-200 dark:border-slate-850 flex items-center gap-2 text-xs text-amber-600 dark:text-amber-400">
                  <Sparkles className="w-4 h-4 shrink-0" />
                  <span>Unser intelligenter Schema-Mapper passt sich automatisch an deine Tabellenspalten an!</span>
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
                {(['overview', 'sleep', 'weight', 'rhr', 'steps', 'stress', 'activities'] as const).map((tab) => (
                  <button
                    key={tab}
                    onClick={() => setActiveTab(tab)}
                    className={`px-4 py-2 rounded-xl text-xs font-bold capitalize transition-all cursor-pointer whitespace-nowrap ${
                      activeTab === tab
                        ? 'bg-orange-600 text-white shadow-md shadow-orange-100'
                        : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {tab === 'overview' ? 'Übersicht' : tab === 'activities' ? 'Aktivitäten' : tab}
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
                        <span className="text-xs bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 px-3 py-1 rounded-full font-bold">
                          Insgesamt: {data?.activities.length || 0}
                        </span>
                      </div>

                      <div className="max-h-[300px] overflow-y-auto border border-slate-150 dark:border-slate-800 rounded-2xl">
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
                            {data?.activities.map((act) => (
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
                      </div>
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
